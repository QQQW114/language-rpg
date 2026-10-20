/**
 * 存档备份 / 迁移：JSON 导出与导入。
 *
 * 与游戏页的「导出」下拉菜单严格区分：
 * - 游戏页导出的是**剧情留档**（history / turnRecords，纯文本或完整 JSON），用于阅读复盘，
 *   不能被重新加载成可继续游玩的存档；
 * - 本模块导出的是**可恢复存档**：信封 `{ kind, version, exportedAt, save }`，导入后回到
 *   一个可继续推进的旅程（state 完整、id 重新分配，不影响现有存档）。
 *
 * 设计约束：
 * - 纯逻辑（信封构造、解析校验、版本守卫、规范化、id/名称分配）全部与 DOM 无关，
 *   便于 node 单测；浏览器下载与文件读取放在文件末尾的 DOM 辅助里。
 * - 导入的规范化复用 `store.ts` 的 hydrate 兜底（`sanitizeSaveV2`），不另写一份字段清洗，
 *   避免"导入能过、刷新就崩"或两套规则漂移。
 *
 * 已知限制（高版本只读模式）：当 localStorage 里的存档格式版本高于本程序时，store 会进入
 * "只读提示"模式并原样保留原始 JSON；这些存档也会出现在首页列表里、可以点「导出存档」。
 * 此时导出只能按**当前版本**的结构做裁剪（剔除已知的会话字段与提示词留档），不保证保留
 * 未来版本新增的未知字段——它是"用旧程序应急读取新备份"的能力，不能替代用对应版本程序
 * 完成的备份。
 */
import { genId } from '@/lib/utils';
import { sanitizeSaveV2, toPortableSaveV2, type SaveV2 } from './store';

/** 存档导出信封的 kind。与内容库导出包（`language-rpg.content-library`）区分。 */
export const SAVE_EXPORT_KIND = 'lrpg-save' as const;
/** 存档导出信封的版本（信封结构本身，不是 GameStateV2 的数据版本）。 */
export const SAVE_EXPORT_VERSION = 1;
/** 当前程序能解读的最高 GameStateV2.schemaVersion。 */
export const SUPPORTED_STATE_SCHEMA_VERSION = 2;
/** 重名存档的导入后缀。 */
export const IMPORT_SAVE_NAME_SUFFIX = '（导入）';

/** 导出信封：字段顺序固定，便于 diff 与人工阅读。 */
export interface SaveExportEnvelope {
  kind: typeof SAVE_EXPORT_KIND;
  version: typeof SAVE_EXPORT_VERSION;
  exportedAt: string;
  save: SaveV2;
}

/** 导入失败原因。`path` 指向出问题的字段，`message` 是可直接展示给玩家的中文说明。 */
export interface SaveTransferIssue {
  path: string;
  code: string;
  message: string;
}

export interface SaveImportResult {
  ok: boolean;
  /** 已规范化、已重新分配 id、已处理重名的存档；失败时不存在。 */
  save?: SaveV2;
  issues: SaveTransferIssue[];
}

export interface SaveImportOptions {
  /**
   * 当前已有存档。用于：
   * 1. 分配一个不与已有存档冲突的新 id（导入一律新建，绝不覆盖）；
   * 2. 名称冲突时加「（导入）」后缀。
   */
  existingSaves?: Record<string, SaveV2>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const issue = (path: string, code: string, message: string): SaveTransferIssue => ({ path, code, message });

const fail = (issues: SaveTransferIssue[]): SaveImportResult => ({ ok: false, issues });

/**
 * 构造导出信封。
 *
 * 导出的存档会被裁剪成"可迁移"形态（与 localStorage 持久化同一份裁剪逻辑）：
 * - 剔除 `lastTurnCheckpoint`（只服务当前页面会话的回合回退，换设备后 revision 对不上）；
 * - 剔除 `turnRecords[].calls[].input`（三阶段完整提示词留档，实测每回合约 208 KB，
 *   会迅速把备份文件撑到几十 MB，且对恢复游玩没有作用）。
 */
export function buildSaveExport(
  save: SaveV2,
  exportedAt: Date | string = new Date(),
): SaveExportEnvelope {
  const portable = toPortableSaveV2(save);
  // 顶层字段按固定顺序重建（可选字段缺省时不写键，避免 JSON 里出现 null 噪音）。
  const orderedSave: SaveV2 = {
    id: portable.id,
    name: portable.name,
    createdAt: portable.createdAt,
    updatedAt: portable.updatedAt,
    ...(portable.outline ? { outline: structuredClone(portable.outline) } : {}),
    ...(portable.background ? { background: structuredClone(portable.background) } : {}),
    worldFacts: structuredClone(portable.worldFacts ?? []),
    state: structuredClone(portable.state),
  };
  return {
    kind: SAVE_EXPORT_KIND,
    version: SAVE_EXPORT_VERSION,
    exportedAt: typeof exportedAt === 'string' ? exportedAt : exportedAt.toISOString(),
    save: orderedSave,
  };
}

/** 序列化为便于阅读/手动检查的 pretty JSON。 */
export function serializeSaveExport(
  save: SaveV2,
  exportedAt: Date | string = new Date(),
): string {
  return JSON.stringify(buildSaveExport(save, exportedAt), null, 2);
}

/**
 * 解析并校验一份存档文件（信封或裸 SaveV2）。
 *
 * 永远不抛异常：格式问题一律转成可读的 `issues`。成功时返回的存档已经：
 * - 走完 `store.ts` 的 hydrate 规范化（缺字段补默认值，坏元素被过滤）；
 * - 分配了新 id（即使文件 id 与现有存档相同也不会覆盖）；
 * - 处理了重名（加「（导入）」后缀）。
 */
export function parseSaveImport(
  input: string | unknown,
  options: SaveImportOptions = {},
): SaveImportResult {
  let parsed: unknown;
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input);
    } catch (error) {
      return fail([issue(
        '$',
        'invalid_json',
        `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
      )]);
    }
  } else {
    parsed = input;
  }

  const unwrapped = unwrapSaveExport(parsed);
  if (!unwrapped.ok) return fail(unwrapped.issues);

  const { raw, source } = unwrapped;
  // 信封里的路径加上 `save.` 前缀，让报错能指向文件结构；裸 SaveV2 直接用顶层路径。
  const prefix = source === 'envelope' ? 'save.' : '';
  if (!isRecord(raw)) {
    return fail([issue('$', 'invalid_type', '存档文件必须是一个 JSON 对象。')]);
  }
  if (!isRecord(raw.state)) {
    return fail([issue(
      `${prefix}state`,
      'missing_state',
      '存档缺少 state（游戏状态）字段，无法导入。请确认选择的是由「导出存档」生成的 JSON 文件。',
    )]);
  }

  const schemaVersion = raw.state.schemaVersion;
  if (typeof schemaVersion === 'number' && schemaVersion > SUPPORTED_STATE_SCHEMA_VERSION) {
    return fail([issue(
      `${prefix}state.schemaVersion`,
      'unsupported_schema_version',
      `存档的状态版本为 ${schemaVersion}，高于当前支持的版本 ${SUPPORTED_STATE_SCHEMA_VERSION}。`
        + '它可能由更新版本的程序生成，为避免丢失新版本数据，导入已拒绝；请先更新程序。',
    )]);
  }

  const existingSaves = options.existingSaves ?? {};
  const id = allocateSaveId(existingSaves);
  // 复用 hydrate 的字段兜底：缺 storyThreads / destiny / facts[].keywords 的旧档在这里被补齐，
  // 而不是在导入成功后第一次读状态时崩掉。
  const normalized = sanitizeSaveV2(raw, id);
  if (!normalized) {
    return fail([issue('save', 'invalid_save', '存档结构无法修复（缺少可用的游戏状态），无法导入。')]);
  }

  const save: SaveV2 = {
    ...normalized,
    id,
    name: resolveImportedSaveName(normalized.name, existingSaves),
    // 保留原始创建/更新时间为备份元数据；"导入"本身不是一次游玩，不伪造游玩时间。
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
    // hydrate 规范化会丢弃回退点；这里显式置空，避免调用方误以为导入后还能"重试上一回合"。
    lastTurnCheckpoint: undefined,
  };

  return { ok: true, save, issues: [] };
}

/**
 * 为导入的存档挑一个不冲突的展示名：重名时依次尝试 `名字（导入）`、`名字（导入 2）`…
 */
export function resolveImportedSaveName(
  name: string,
  existingSaves: Record<string, SaveV2>,
): string {
  const used = new Set(Object.values(existingSaves).map((save) => save.name.trim()));
  const base = name.trim() || '未命名旅程';
  if (!used.has(base)) return base;
  const first = `${base}${IMPORT_SAVE_NAME_SUFFIX}`;
  if (!used.has(first)) return first;
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base}（导入 ${index}）`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}（导入 ${Date.now()}）`;
}

type UnwrapResult =
  | { ok: true; raw: unknown; source: 'envelope' | 'bare' }
  | { ok: false; issues: SaveTransferIssue[] };

/**
 * 区分「导出信封」与「裸 SaveV2」，并先做信封层面的版本守卫。
 *
 * 顺序很重要：高版本信封必须先被拒绝，绝不能按当前结构解读后再写回——
 * 那会静默抹掉新版本引入的字段（与 store.ts 对高版本存档的只读策略一致）。
 */
function unwrapSaveExport(value: unknown): UnwrapResult {
  if (!isRecord(value)) {
    return { ok: false, issues: [issue('$', 'invalid_type', '存档文件必须是一个 JSON 对象。')] };
  }
  if (value.kind === undefined) {
    // 裸 SaveV2：兼容手工整理或只保存了存档本体的备份文件。
    return { ok: true, raw: value, source: 'bare' };
  }
  if (value.kind !== SAVE_EXPORT_KIND) {
    return {
      ok: false,
      issues: [issue(
        'kind',
        'unknown_kind',
        `这不是言灵存档文件（kind=${JSON.stringify(value.kind)}）。`
          + '请选择由存档列表「导出存档」生成的 JSON；游戏页的「导出全部信息」是剧情留档，不能导入。',
      )],
    };
  }
  const version = value.version;
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    return {
      ok: false,
      issues: [issue('version', 'invalid_version', '存档文件的版本号（version）缺失或无法识别。')],
    };
  }
  if (version > SAVE_EXPORT_VERSION) {
    return {
      ok: false,
      issues: [issue(
        'version',
        'unsupported_version',
        `存档文件版本为 ${version}，高于当前支持的版本 ${SAVE_EXPORT_VERSION}。`
          + '它可能由更新版本的程序导出，为避免丢失数据，导入已拒绝；请先更新程序。',
      )],
    };
  }
  if (version !== SAVE_EXPORT_VERSION) {
    return {
      ok: false,
      issues: [issue('version', 'invalid_version', `无法识别的存档文件版本 ${version}。`)],
    };
  }
  if (!isRecord(value.save)) {
    return {
      ok: false,
      issues: [issue('save', 'missing_save', '存档文件缺少 save 字段。')],
    };
  }
  return { ok: true, raw: value.save, source: 'envelope' };
}

/** 生成一个与现有存档 id 都不冲突的新 id（导入绝不覆盖已有存档）。 */
function allocateSaveId(existingSaves: Record<string, SaveV2>): string {
  for (;;) {
    const id = genId('save');
    if (!existingSaves[id]) return id;
  }
}

/** 文件名中不允许出现的字符（Windows 最严格：/\:*?"<>|）。 */
export function safeSaveFilename(value: string): string {
  const normalized = String(value ?? '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60);
  return normalized || 'language-rpg-save';
}

/** 存档备份文件名：`<存档名>-存档-YYYY-MM-DD.json`。 */
export function saveExportFilename(save: SaveV2, date: Date = new Date()): string {
  const stamp = Number.isNaN(date.getTime()) ? '' : `-${date.toISOString().slice(0, 10)}`;
  return `${safeSaveFilename(save.name)}-存档${stamp}.json`;
}

/**
 * 浏览器下载：把存档导出为 JSON 备份。
 * DOM 辅助与纯逻辑分离，node 单测只覆盖上面的构造/解析函数。
 */
export function downloadSaveBackup(save: SaveV2, now: Date = new Date()): void {
  const blob = new Blob([serializeSaveExport(save, now)], { type: 'application/json;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = saveExportFilename(save, now);
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
}

/** 浏览器读取：读取用户选择的 .json 文件文本。 */
export function readSaveFileText(file: File): Promise<string> {
  return file.text();
}
