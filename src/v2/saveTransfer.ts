/**
 * 存档备份 / 迁移：JSON 导出与导入。
 *
 * 与游戏页的「导出」下拉菜单严格区分：
 * - 游戏页导出的是**剧情留档**（history / turnRecords，纯文本或完整 JSON），用于阅读复盘，
 *   不能被重新加载成可继续游玩的存档；
 * - 本模块导出的是**可恢复存档**：信封 `{ kind, version, exportedAt, meta?, save }`，导入后回到
 *   一个可继续推进的旅程（state 完整、id 重新分配，不影响现有存档）。
 *
 * 设计约束：
 * - 纯逻辑（信封构造、解析校验、版本守卫、规范化、id/名称分配）全部与 DOM 无关，
 *   便于 node 单测；浏览器下载与文件读取放在文件末尾的 DOM 辅助里。
 * - 导入的规范化复用 `store.ts` 的 hydrate 兜底（`sanitizeSaveV2`），不另写一份字段清洗，
 *   避免"导入能过、刷新就崩"或两套规则漂移。
 * - 信封顶层的可选 `meta` 只服务**离线复盘**（Q19：当时用什么模型/模式/视角、走到哪一幕、
 *   灵魂画像与故事节状态），不参与导入还原，也**绝不包含任何 API Key 或 Base URL**。
 *
 * 已知限制（高版本只读模式）：当 localStorage 里的存档格式版本高于本程序时，store 会进入
 * "只读提示"模式并原样保留原始 JSON；这些存档也会出现在首页列表里、可以点「导出存档」。
 * 此时导出只能按**当前版本**的结构做裁剪（剔除已知的会话字段与提示词留档），不保证保留
 * 未来版本新增的未知字段——它是"用旧程序应急读取新备份"的能力，不能替代用对应版本程序
 * 完成的备份。
 */
import { version as packageVersion } from '../../package.json';
import { useSettingsStore } from '@/store/useSettingsStore';
import type {
  AppSettings,
  InputPerspective,
  PlannerContextPreset,
  ProviderFeatureMode,
  ReasoningEffort,
} from '@/types/settings';
import { genId } from '@/lib/utils';
import { sanitizeSaveV2, toPortableSaveV2, type SaveV2 } from './store';
import type {
  JourneyModeV2,
  NarrativePaceV2,
  StoryAutonomyV2,
  StoryBeatStatusV2,
} from './types';

/** 存档导出信封的 kind。与内容库导出包（`language-rpg.content-library`）区分。 */
export const SAVE_EXPORT_KIND = 'lrpg-save' as const;
/** 存档导出信封的版本（信封结构本身，不是 GameStateV2 的数据版本）。 */
export const SAVE_EXPORT_VERSION = 1;
/** 当前程序能解读的最高 GameStateV2.schemaVersion。 */
export const SUPPORTED_STATE_SCHEMA_VERSION = 2;
/** 重名存档的导入后缀。 */
export const IMPORT_SAVE_NAME_SUFFIX = '（导入）';
/** 导出 meta 最多记录的故事节数（控制备份体积；完整 beats 仍在嵌套 save.state.destiny 中）。 */
export const SAVE_EXPORT_META_BEATS_LIMIT = 20;

/** 设置快照（无密钥、无 URL）。字段顺序固定，便于 diff 与离线复盘。 */
export interface SaveExportSettingsSnapshot {
  mode: JourneyModeV2;
  storyAutonomy: StoryAutonomyV2;
  inputPerspective: InputPerspective;
  narrativePace: NarrativePaceV2;
  storyModel: string;
  plannerModel: string;
  /** 由 storyModel 推导的文风 profile（compact / expressive），便于复盘篇幅策略。 */
  storyProfile: 'compact' | 'expressive';
  temperatureStory: number;
  storyMaxTokens: number;
  plannerContextPreset: PlannerContextPreset;
  plannerToolsEnabled: boolean;
  plannerToolMaxCalls: number;
  plannerWebSearchEnabled: boolean;
  plannerJsonMode: ProviderFeatureMode;
  thinkingMode: ProviderFeatureMode;
  reasoningEffort: ReasoningEffort;
  /** story 阶段是否使用独立 API Base；只记布尔，不记录 URL。 */
  storyApiBaseOverridden: boolean;
  /** story 阶段是否使用独立 API Key；只记布尔，绝不记录 Key 内容。 */
  storyApiKeyOverridden: boolean;
}

/** 导出时点的末态摘要（便于离线复盘；完整状态仍在嵌套 save.state 中）。 */
export interface SaveExportFinalStateSummary {
  /** 当前幕标题：优先按大纲幕序取；无大纲时退回 currentStage / currentActId。 */
  act: string;
  /** 当前幕 0-based 序号（有 outline 时夹取到大纲范围内）。 */
  actIndex: number;
  /** 命运完成度估算（0~100，来自程序权威状态）。 */
  completion: number;
  /** 主角灵魂画像（≤120 字；空串 = 尚未形成）。 */
  soulProfile: string;
  /** 故事节状态摘要（按 destiny.beats 顺序，最多 SAVE_EXPORT_META_BEATS_LIMIT 条）。 */
  beats: Array<{ id: string; status: StoryBeatStatusV2 }>;
}

/**
 * 导出信封的可选复盘元数据（Gemini Q19）。
 *
 * 只服务"导出后离线复盘/给外部分析"：导入端不读取它，旧信封没有它也必须能导入。
 * 体积目标 <2KB；**绝不包含 apiKey / storyApiKey / Authorization / Base URL**。
 */
export interface SaveExportMeta {
  /** 产生这份备份的程序版本（读 package.json，发版时随其自动同步）。 */
  version: string;
  /** 导出时的设置快照；调用方未提供设置时省略。 */
  settings?: SaveExportSettingsSnapshot;
  outlineId?: string;
  backgroundId?: string;
  finalStateSummary: SaveExportFinalStateSummary;
}

/** buildSaveExport / serializeSaveExport 的可选上下文。 */
export interface SaveExportContext {
  /** 当前设置快照；DOM 导出辅助会自动读取 useSettingsStore。缺省时 meta 省略 settings。 */
  settings?: AppSettings | null;
}

/** 导出信封：字段顺序固定，便于 diff 与人工阅读。 */
export interface SaveExportEnvelope {
  kind: typeof SAVE_EXPORT_KIND;
  version: typeof SAVE_EXPORT_VERSION;
  exportedAt: string;
  /** 可选复盘元数据：旧版本导出没有这个字段，导入端不依赖它。 */
  meta?: SaveExportMeta;
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

const BEAT_STATUSES: readonly StoryBeatStatusV2[] = ['pending', 'available', 'active', 'satisfied', 'weakened', 'reframed', 'superseded'];
const NARRATIVE_PACES: readonly NarrativePaceV2[] = ['slow', 'standard', 'fast', 'timeskip'];
const STORY_AUTONOMIES: readonly StoryAutonomyV2[] = ['strict', 'co_author', 'standard', 'free'];
const PLANNER_CONTEXT_PRESETS: readonly PlannerContextPreset[] = ['compact', 'standard', 'rich', 'custom'];
const PROVIDER_FEATURE_MODES: readonly ProviderFeatureMode[] = ['auto', 'enabled', 'disabled'];
const REASONING_EFFORTS: readonly ReasoningEffort[] = ['low', 'high', 'max'];

const includes = <T,>(values: readonly T[], value: unknown): value is T => values.includes(value as T);
const textOr = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);
const numberOr = (value: unknown, fallback: number): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
);

/**
 * 按 story 模型推导文风 profile（与 `engine.resolveStoryProfile` 同一启发式）。
 *
 * 这里内联而不 import engine：saveTransfer 被首页（首屏主包）引用，而 engine 会把全部提示词、
 * llmClient 等拉进首屏。两侧规则若变更需同步（tests/saveTransfer.test.ts 钉住行为）。
 */
function resolveStoryProfileForMeta(storyModel: string): 'compact' | 'expressive' {
  const model = String(storyModel ?? '').toLowerCase();
  if (/(gemini|claude|opus|sonnet|gpt-5|deepseek-(v4|pro)|deepseek-pro)/.test(model)) return 'expressive';
  return 'compact';
}

function buildSettingsSnapshot(save: SaveV2, settings: AppSettings): SaveExportSettingsSnapshot {
  // 高版本只读存档的 state 结构不可信：这里全部按 unknown 读取，取不到就回退默认值，
  // 保证"导出可用"不会被 meta 的构造拖崩。
  const state = (isRecord(save.state) ? save.state : {}) as Record<string, unknown>;
  return {
    mode: state.mode === 'adventure' ? 'adventure' : 'author',
    storyAutonomy: includes(STORY_AUTONOMIES, state.storyAutonomy) ? state.storyAutonomy : 'standard',
    inputPerspective: settings.inputPerspective === 'director' ? 'director' : 'player',
    narrativePace: includes(NARRATIVE_PACES, state.narrativePace) ? state.narrativePace : 'standard',
    storyModel: textOr(settings.storyModel).trim(),
    plannerModel: textOr(settings.plannerModel).trim(),
    storyProfile: resolveStoryProfileForMeta(settings.storyModel),
    temperatureStory: numberOr(settings.temperatureStory, 0),
    storyMaxTokens: numberOr(settings.storyMaxTokens, 0),
    plannerContextPreset: includes(PLANNER_CONTEXT_PRESETS, settings.plannerContextPreset)
      ? settings.plannerContextPreset
      : 'standard',
    plannerToolsEnabled: settings.plannerToolsEnabled === true,
    plannerToolMaxCalls: numberOr(settings.plannerToolMaxCalls, 2),
    plannerWebSearchEnabled: settings.plannerWebSearchEnabled === true,
    plannerJsonMode: includes(PROVIDER_FEATURE_MODES, settings.plannerJsonMode) ? settings.plannerJsonMode : 'auto',
    thinkingMode: includes(PROVIDER_FEATURE_MODES, settings.thinkingMode) ? settings.thinkingMode : 'auto',
    reasoningEffort: includes(REASONING_EFFORTS, settings.reasoningEffort) ? settings.reasoningEffort : 'high',
    // 只记"是否使用独立连接"的布尔，不记录 URL / Key 内容。
    storyApiBaseOverridden: textOr(settings.storyApiBaseUrl).trim().length > 0,
    storyApiKeyOverridden: textOr(settings.storyApiKey).trim().length > 0,
  };
}

function buildFinalStateSummary(save: SaveV2): SaveExportFinalStateSummary {
  const state = (isRecord(save.state) ? save.state : {}) as Record<string, unknown>;
  const destiny = (isRecord(state.destiny) ? state.destiny : {}) as Record<string, unknown>;
  const acts = Array.isArray(save.outline?.acts) ? save.outline!.acts : [];
  const rawIndex = Math.trunc(numberOr(destiny.currentActIndex, 0));
  // 有 outline 时把序号夹取到大纲范围内，保证 actIndex 与 act 标题指向同一幕；
  // 无 outline（或高版本坏档）时保留原始序号。
  const actIndex = acts.length
    ? Math.min(Math.max(rawIndex, 0), acts.length - 1)
    : Math.max(rawIndex, 0);
  const act = textOr(acts[actIndex]?.title).trim()
    || textOr(destiny.currentStage).trim()
    || textOr(destiny.currentActId).trim();
  const rawBeats: unknown[] = Array.isArray(destiny.beats) ? destiny.beats : [];
  const beats = rawBeats
    .filter(isRecord)
    .map((beat) => ({
      id: textOr(beat.beatId),
      status: includes(BEAT_STATUSES, beat.status) ? beat.status : 'pending' as StoryBeatStatusV2,
    }))
    .filter((beat) => !!beat.id)
    .slice(0, SAVE_EXPORT_META_BEATS_LIMIT);
  return {
    act,
    actIndex,
    completion: numberOr(destiny.completionEstimate, 0),
    soulProfile: textOr(state.soulProfile).slice(0, 120),
    beats,
  };
}

/**
 * 构造信封的可选复盘 meta（设置快照 / 大纲出身 id / 末态摘要）。
 *
 * `settings` 缺省时只省略 `settings` 子字段（纯函数调用方/测试无需伪造设置）；
 * 真正的浏览器导出（`downloadSaveBackup`）总会带上当前设置快照。
 */
export function buildSaveExportMeta(save: SaveV2, settings?: AppSettings | null): SaveExportMeta {
  const settingsSnapshot = settings ? buildSettingsSnapshot(save, settings) : undefined;
  const outlineId = textOr(save.outline?.id).trim();
  const backgroundId = textOr(save.background?.id).trim();
  return {
    // 版本直接读 package.json：发版时 bump package.json 即自动生效，避免硬编码漂移。
    version: typeof packageVersion === 'string' && packageVersion ? packageVersion : '0.0.0',
    ...(settingsSnapshot ? { settings: settingsSnapshot } : {}),
    ...(outlineId ? { outlineId } : {}),
    ...(backgroundId ? { backgroundId } : {}),
    finalStateSummary: buildFinalStateSummary(save),
  };
}

/**
 * 构造导出信封。
 *
 * 导出的存档会被裁剪成"可迁移"形态（与 localStorage 持久化同一份裁剪逻辑）：
 * - 剔除 `lastTurnCheckpoint`（只服务当前页面会话的回合回退，换设备后 revision 对不上）；
 * - 剔除 `turnRecords[].calls[].input`（三阶段完整提示词留档，实测每回合约 208 KB，
 *   会迅速把备份文件撑到几十 MB，且对恢复游玩没有作用）。
 *
 * 顶层另加可选 `meta`（设置快照 / 大纲出身 id / 末态摘要），只用于离线复盘，不含任何密钥。
 * 嵌套 `save` 的内容与文件名逻辑保持原样（导入端仍然只读 `save`）。
 */
export function buildSaveExport(
  save: SaveV2,
  exportedAt: Date | string = new Date(),
  context: SaveExportContext = {},
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
    meta: buildSaveExportMeta(portable, context.settings),
    save: orderedSave,
  };
}

/** 序列化为便于阅读/手动检查的 pretty JSON。 */
export function serializeSaveExport(
  save: SaveV2,
  exportedAt: Date | string = new Date(),
  context: SaveExportContext = {},
): string {
  return JSON.stringify(buildSaveExport(save, exportedAt, context), null, 2);
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
 *
 * 信封顶层的 `meta`（设置快照/末态摘要，纯复盘用途）在这里被**忽略**：导入只认 `save`，
 * 因此旧信封没有 meta 照常可导入，未来新增的顶层复盘字段也不会影响导入。
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
 *
 * 导出时自动带上当前设置快照（`meta.settings`）。快照由 `buildSettingsSnapshot` 白名单构造，
 * 只含模型名/行为开关/是否独立端点，**不含 apiKey、storyApiKey 或任何 Base URL**。
 */
export function downloadSaveBackup(save: SaveV2, now: Date = new Date()): void {
  const settings = useSettingsStore.getState().settings;
  const blob = new Blob([serializeSaveExport(save, now, { settings })], { type: 'application/json;charset=utf-8' });
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
