import { genId } from './utils';
import type {
  Background,
  ContentExportPackage,
  ContentValidationIssue,
  ContentValidationResult,
  ImportBundle,
  RandomEvent,
  StoryAct,
  StoryBeat,
  StoryOutline,
  WorkspaceTemplate,
  WorldBook,
  WorldBookEntry,
} from '@/types/content';

export const CONTENT_EXPORT_KIND = 'language-rpg.content-library' as const;
export const CONTENT_EXPORT_VERSION = 1 as const;

type RecordLike = Record<string, unknown>;

const isRecord = (value: unknown): value is RecordLike =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const cleanText = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const cleanOptionalText = (value: unknown): string | undefined => cleanText(value) || undefined;
const cleanStrings = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.map(cleanText).filter(Boolean))]
  : [];
const finiteNumber = (value: unknown, fallback: number): number => {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
};
const issue = (
  kind: ContentValidationIssue['kind'],
  path: string,
  code: string,
  message: string,
): ContentValidationIssue => ({ kind, path, code, message });

function uniqueId(raw: unknown, prefix: string, used: Set<string>): string {
  let id = cleanText(raw) || genId(prefix);
  while (used.has(id)) id = genId(prefix);
  used.add(id);
  return id;
}

export function validateStoryOutline(input: unknown): ContentValidationResult<StoryOutline> {
  const issues: ContentValidationIssue[] = [];
  if (!isRecord(input)) {
    return { ok: false, issues: [issue('outline', '$', 'invalid_type', '故事必须是一个 JSON 对象。')] };
  }

  const title = cleanText(input.title);
  const synopsis = cleanText(input.synopsis);
  if (!title) issues.push(issue('outline', 'title', 'required', '故事标题不能为空。'));
  if (!synopsis) issues.push(issue('outline', 'synopsis', 'required', '故事简介不能为空。'));

  const rawActs = Array.isArray(input.acts) ? input.acts : [];
  if (!rawActs.length) issues.push(issue('outline', 'acts', 'required', '故事至少需要一幕。'));
  const actIds = new Set<string>();
  const beatIds = new Set<string>();
  const acts: StoryAct[] = [];

  rawActs.forEach((rawAct, actIndex) => {
    const path = `acts[${actIndex}]`;
    if (!isRecord(rawAct)) {
      issues.push(issue('outline', path, 'invalid_type', '每一幕都必须包含标题、目的和故事节。'));
      return;
    }
    const actTitle = cleanText(rawAct.title);
    const actPurpose = cleanText(rawAct.purpose);
    if (!actTitle) issues.push(issue('outline', `${path}.title`, 'required', '幕标题不能为空。'));
    if (!actPurpose) issues.push(issue('outline', `${path}.purpose`, 'required', '幕的叙事目的不能为空。'));

    const rawBeats = Array.isArray(rawAct.beats) ? rawAct.beats : [];
    if (!rawBeats.length) issues.push(issue('outline', `${path}.beats`, 'required', '每一幕至少需要一个故事节。'));
    const beats: StoryBeat[] = [];
    rawBeats.forEach((rawBeat, beatIndex) => {
      const beatPath = `${path}.beats[${beatIndex}]`;
      if (!isRecord(rawBeat)) {
        issues.push(issue('outline', beatPath, 'invalid_type', '故事节必须包含标题和叙事目的。'));
        return;
      }
      const beatTitle = cleanText(rawBeat.title);
      const beatPurpose = cleanText(rawBeat.purpose);
      if (!beatTitle) issues.push(issue('outline', `${beatPath}.title`, 'required', '故事节标题不能为空。'));
      if (!beatPurpose) issues.push(issue('outline', `${beatPath}.purpose`, 'required', '故事节目的不能为空。'));
      beats.push({
        id: uniqueId(rawBeat.id, 'beat', beatIds),
        title: beatTitle,
        purpose: beatPurpose,
      });
    });

    acts.push({
      id: uniqueId(rawAct.id, 'act', actIds),
      title: actTitle,
      purpose: actPurpose,
      beats,
    });
  });

  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    issues,
    value: {
      id: cleanText(input.id) || genId('outline'),
      title,
      synopsis,
      acts,
      tone: cleanOptionalText(input.tone),
      worldBookIds: cleanStrings(input.worldBookIds),
      coverEmoji: cleanOptionalText(input.coverEmoji),
    },
  };
}

export function validateWorldBook(input: unknown): ContentValidationResult<WorldBook> {
  const issues: ContentValidationIssue[] = [];
  if (!isRecord(input)) {
    return { ok: false, issues: [issue('worldBook', '$', 'invalid_type', '世界书必须是一个 JSON 对象。')] };
  }

  const name = cleanText(input.name);
  if (!name) issues.push(issue('worldBook', 'name', 'required', '世界书名称不能为空。'));
  const rawEntries = Array.isArray(input.entries) ? input.entries : [];
  if (!rawEntries.length) issues.push(issue('worldBook', 'entries', 'required', '世界书至少需要一个条目。'));
  const entryIds = new Set<string>();
  const entries: WorldBookEntry[] = [];

  rawEntries.forEach((rawEntry, index) => {
    const path = `entries[${index}]`;
    if (!isRecord(rawEntry)) {
      issues.push(issue('worldBook', path, 'invalid_type', '世界书条目必须是一个 JSON 对象。'));
      return;
    }
    const entryName = cleanText(rawEntry.name);
    const content = cleanText(rawEntry.content);
    if (!entryName) issues.push(issue('worldBook', `${path}.name`, 'required', '条目名称不能为空。'));
    if (!content) issues.push(issue('worldBook', `${path}.content`, 'required', '条目内容不能为空。'));
    entries.push({
      id: uniqueId(rawEntry.id, 'wbe', entryIds),
      name: entryName,
      keywords: cleanStrings(rawEntry.keywords),
      content,
      priority: Math.max(-10_000, Math.min(10_000, Math.round(finiteNumber(rawEntry.priority, 0)))),
      alwaysActive: rawEntry.alwaysActive === true,
    });
  });

  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    issues,
    value: {
      id: cleanText(input.id) || genId('wb'),
      name,
      description: cleanOptionalText(input.description),
      entries,
    },
  };
}

export function normalizeStoryOutline(input: StoryOutline): StoryOutline {
  const result = validateStoryOutline(input);
  if (!result.value) throw new Error(result.issues.map((x) => x.message).join('\n'));
  return result.value;
}

export function normalizeWorldBook(input: WorldBook): WorldBook {
  const result = validateWorldBook(input);
  if (!result.value) throw new Error(result.issues.map((x) => x.message).join('\n'));
  return result.value;
}

function normalizeBackground(input: unknown): ContentValidationResult<Background> {
  if (!isRecord(input)) return { ok: false, issues: [issue('background', '$', 'invalid_type', '出身必须是一个对象。')] };
  const name = cleanText(input.name);
  const description = cleanText(input.description);
  const startScene = cleanText(input.startScene);
  const issues: ContentValidationIssue[] = [];
  if (!name) issues.push(issue('background', 'name', 'required', '出身名称不能为空。'));
  if (!description) issues.push(issue('background', 'description', 'required', '出身描述不能为空。'));
  if (!startScene) issues.push(issue('background', 'startScene', 'required', '开局场景不能为空。'));
  if (issues.length) return { ok: false, issues };
  return { ok: true, issues, value: {
    id: cleanText(input.id) || genId('bg'),
    name,
    description,
    traits: cleanStrings(input.traits),
    startItems: cleanStrings(input.startItems),
    startScene,
    coverEmoji: cleanOptionalText(input.coverEmoji),
  } };
}

function normalizeEvent(input: unknown): ContentValidationResult<RandomEvent> {
  if (!isRecord(input)) return { ok: false, issues: [issue('event', '$', 'invalid_type', '随机事件必须是一个对象。')] };
  const name = cleanText(input.name);
  const directive = cleanText(input.directive);
  const issues: ContentValidationIssue[] = [];
  if (!name) issues.push(issue('event', 'name', 'required', '随机事件名称不能为空。'));
  if (!directive) issues.push(issue('event', 'directive', 'required', '随机事件指令不能为空。'));
  if (issues.length) return { ok: false, issues };
  const probability = Math.max(0, Math.min(1, finiteNumber(input.probability, 0)));
  const positiveInt = (value: unknown, allowZero = false): number | undefined => {
    if (value === undefined || value === null || value === '') return undefined;
    const n = Math.floor(finiteNumber(value, allowZero ? 0 : 1));
    return Math.max(allowZero ? 0 : 1, n);
  };
  return { ok: true, issues, value: {
    id: cleanText(input.id) || genId('event'),
    name,
    directive,
    probability,
    minRound: positiveInt(input.minRound),
    cooldown: positiveInt(input.cooldown, true),
    once: input.once === true,
    tags: cleanStrings(input.tags),
  } };
}

function normalizeWorkspaceTemplate(input: unknown): ContentValidationResult<WorkspaceTemplate> {
  if (!isRecord(input)) return { ok: false, issues: [issue('workspaceTemplate', '$', 'invalid_type', '模板必须是一个对象。')] };
  const name = cleanText(input.name);
  if (!name) return { ok: false, issues: [issue('workspaceTemplate', 'name', 'required', '模板名称不能为空。')] };
  const docs = Array.isArray(input.docs) ? input.docs.filter(isRecord).map((doc) => ({
    path: cleanText(doc.path),
    title: cleanOptionalText(doc.title),
    kind: doc.kind as WorkspaceTemplate['docs'][number]['kind'],
    summary: cleanOptionalText(doc.summary),
    tags: cleanStrings(doc.tags),
    content: cleanText(doc.content),
    archived: doc.archived === true,
    stale: doc.stale === true,
  })).filter((doc) => doc.path && doc.content) : [];
  return { ok: true, issues: [], value: {
    id: cleanText(input.id) || genId('wst'),
    name,
    description: cleanOptionalText(input.description),
    outlineIds: cleanStrings(input.outlineIds),
    backgroundIds: cleanStrings(input.backgroundIds),
    worldBookIds: cleanStrings(input.worldBookIds),
    tags: cleanStrings(input.tags),
    docs,
  } };
}

export function validateImportBundle(input: unknown): ContentValidationResult<ImportBundle> {
  if (!isRecord(input)) {
    return { ok: false, issues: [issue('bundle', '$', 'invalid_type', '导入内容必须是一个 JSON 对象。')] };
  }
  const packageIssues: ContentValidationIssue[] = [];
  let raw: RecordLike = input;
  if (input.kind === CONTENT_EXPORT_KIND) {
    if (input.version !== CONTENT_EXPORT_VERSION) {
      return {
        ok: false,
        issues: [issue('bundle', 'version', 'unsupported_version', `不支持内容包版本 ${String(input.version)}。`)],
      };
    }
    if (!isRecord(input.content)) {
      return {
        ok: false,
        issues: [...packageIssues, issue('bundle', 'content', 'invalid_type', '内容包的 content 必须是一个 JSON 对象。')],
      };
    }
    raw = input.content;
  }
  const bundle: ImportBundle = { outlines: [], backgrounds: [], worldBooks: [], events: [], workspaceTemplates: [] };
  const issues: ContentValidationIssue[] = [...packageIssues];

  const collect = <T>(
    key: keyof ImportBundle,
    normalize: (value: unknown) => ContentValidationResult<T>,
  ) => {
    const source = raw[key];
    if (source === undefined) return;
    if (!Array.isArray(source)) {
      issues.push(issue('bundle', String(key), 'invalid_type', `${String(key)} 必须是数组。`));
      return;
    }
    const values: T[] = [];
    source.forEach((value, index) => {
      const result = normalize(value);
      if (result.value) values.push(result.value);
      result.issues.forEach((item) => issues.push({ ...item, path: `${String(key)}[${index}].${item.path}` }));
    });
    (bundle[key] as T[]) = values;
  };

  collect('outlines', validateStoryOutline);
  collect('backgrounds', normalizeBackground);
  collect('worldBooks', validateWorldBook);
  collect('events', normalizeEvent);
  collect('workspaceTemplates', normalizeWorkspaceTemplate);

  const hasValues = Object.values(bundle).some((value) => value?.length);
  return { ok: issues.length === 0 && hasValues, value: bundle, issues: hasValues ? issues : [
    ...issues,
    issue('bundle', '$', 'empty', '没有找到可导入的故事或世界书内容。'),
  ] };
}

export function parseContentImport(textOrValue: string | unknown): ContentValidationResult<ImportBundle> {
  if (typeof textOrValue !== 'string') return validateImportBundle(textOrValue);
  try {
    return validateImportBundle(JSON.parse(textOrValue));
  } catch (error) {
    return {
      ok: false,
      issues: [issue('bundle', '$', 'invalid_json', `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`)],
    };
  }
}

export function buildContentExport(content: ImportBundle): ContentExportPackage {
  return {
    kind: CONTENT_EXPORT_KIND,
    version: CONTENT_EXPORT_VERSION,
    exportedAt: Date.now(),
    content: structuredClone(content),
  };
}

export function serializeContentExport(content: ImportBundle, pretty = true): string {
  return JSON.stringify(buildContentExport(content), null, pretty ? 2 : undefined);
}
