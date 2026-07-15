import type { ImportBundle, StoryAct, StoryBeat, StoryOutline, WorldBook, WorldBookEntry } from '@/types/content';
import { genId } from '@/lib/utils';
import { buildContentExport } from '@/lib/contentLibrary';

export type WorkshopIssueLevel = 'error' | 'warning';

export interface WorkshopIssue {
  level: WorkshopIssueLevel;
  path: string;
  message: string;
}

export function createBlankOutline(): StoryOutline {
  return {
    id: genId('outline'),
    title: '未命名故事',
    coverEmoji: '✦',
    synopsis: '',
    tone: '',
    worldBookIds: [],
    acts: [createBlankAct(1)],
  };
}

export function createBlankAct(index: number): StoryAct {
  return {
    id: genId('act'),
    title: `第${toChineseNumber(index)}幕`,
    purpose: '',
    beats: [createBlankBeat()],
  };
}

export function createBlankBeat(): StoryBeat {
  return {
    id: genId('beat'),
    title: '未命名故事节',
    purpose: '',
  };
}

export function createBlankWorldBook(name = '未命名世界书'): WorldBook {
  return {
    id: genId('wb'),
    name,
    description: '',
    entries: [createBlankWorldBookEntry()],
  };
}

export function createBlankWorldBookEntry(): WorldBookEntry {
  return {
    id: genId('wbe'),
    name: '世界基调',
    keywords: [],
    alwaysActive: true,
    priority: 100,
    content: '',
  };
}

export function cloneOutlineAsCustom(source: StoryOutline): StoryOutline {
  return {
    ...structuredClone(source),
    id: genId('outline'),
    title: `${source.title} · 自定义`,
    worldBookIds: [],
    acts: source.acts.map((act) => ({
      ...act,
      id: genId('act'),
      beats: act.beats.map((beat) => ({ ...beat, id: genId('beat') })),
    })),
  };
}

export function cloneWorldBookAsCustom(source: WorldBook): WorldBook {
  return {
    ...structuredClone(source),
    id: genId('wb'),
    name: `${source.name} · 自定义`,
    entries: source.entries.map((entry) => ({ ...entry, id: genId('wbe') })),
  };
}

export function clonePresetProject(
  source: StoryOutline,
  worldBooks: WorldBook[],
): { outline: StoryOutline; worldBooks: WorldBook[] } {
  const clonedOutline = cloneOutlineAsCustom(source);
  const sourceBookIds = new Set(source.worldBookIds ?? []);
  const sourceBooks = worldBooks.filter((book) => sourceBookIds.has(book.id));
  const clonedBooks = sourceBooks.map(cloneWorldBookAsCustom);
  clonedOutline.worldBookIds = clonedBooks.map((book) => book.id);
  return { outline: clonedOutline, worldBooks: clonedBooks };
}

export function inspectOutline(outline: StoryOutline): WorkshopIssue[] {
  const issues: WorkshopIssue[] = [];
  if (!outline.title.trim()) issues.push(error('故事标题', '请填写故事标题。'));
  if (!outline.synopsis.trim()) issues.push(error('故事简介', '请说明故事从哪里开始、向哪里抵达。'));
  if (!outline.acts.length) issues.push(error('命运骨架', '至少需要一幕。'));
  if (!outline.tone?.trim()) issues.push(warning('叙事基调', '建议写明题材、氛围与需要避免的方向。'));
  if (!(outline.worldBookIds?.length)) issues.push(warning('关联世界书', '当前故事没有关联世界书，模型只能依赖大纲自行补全长期设定。'));

  outline.acts.forEach((act, actIndex) => {
    const actPath = `第 ${actIndex + 1} 幕`;
    if (!act.title.trim()) issues.push(error(actPath, '请填写幕标题。'));
    if (!act.purpose.trim()) issues.push(error(actPath, '请说明这一幕必须完成的叙事作用。'));
    if (!act.beats.length) issues.push(error(actPath, '每一幕至少需要一个故事节。'));
    act.beats.forEach((beat, beatIndex) => {
      const path = `${actPath} · 故事节 ${beatIndex + 1}`;
      if (!beat.title.trim()) issues.push(error(path, '请填写故事节标题。'));
      if (!beat.purpose.trim()) issues.push(error(path, '请说明故事节必须实现的结果，而不是锁死发生方式。'));
    });
  });
  return issues;
}

export function inspectWorldBook(book: WorldBook): WorkshopIssue[] {
  const issues: WorkshopIssue[] = [];
  if (!book.name.trim()) issues.push(error('世界书名称', '请填写世界书名称。'));
  if (!book.entries.length) issues.push(error(book.name || '世界书', '至少需要一条世界设定。'));
  if (!book.description?.trim()) issues.push(warning(book.name || '世界书', '建议说明这本世界书负责约束什么。'));
  book.entries.forEach((entry, index) => {
    const path = `${book.name || '世界书'} · 条目 ${index + 1}`;
    if (!entry.name.trim()) issues.push(error(path, '请填写设定条目名称。'));
    if (!entry.content.trim()) issues.push(error(path, '设定正文不能为空。'));
    if (!entry.alwaysActive && !entry.keywords.length) {
      issues.push(warning(path, '非常驻条目没有关键词，游戏中将很难命中。'));
    }
  });
  return issues;
}

export function normalizeOutlineForSave(outline: StoryOutline): StoryOutline {
  return {
    ...outline,
    title: outline.title.trim(),
    synopsis: outline.synopsis.trim(),
    tone: outline.tone?.trim() || undefined,
    coverEmoji: outline.coverEmoji?.trim() || undefined,
    worldBookIds: [...new Set(outline.worldBookIds ?? [])],
    acts: outline.acts.map((act) => ({
      ...act,
      title: act.title.trim(),
      purpose: act.purpose.trim(),
      beats: act.beats.map((beat) => ({
        ...beat,
        title: beat.title.trim(),
        purpose: beat.purpose.trim(),
      })),
    })),
  };
}

export function normalizeWorldBookForSave(book: WorldBook): WorldBook {
  return {
    ...book,
    name: book.name.trim(),
    description: book.description?.trim() || undefined,
    entries: book.entries.map((entry) => ({
      ...entry,
      name: entry.name.trim(),
      content: entry.content.trim(),
      keywords: [...new Set(entry.keywords.map((keyword) => keyword.trim()).filter(Boolean))],
      priority: clampPriority(entry.priority),
    })),
  };
}

export function downloadJson(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
}

export function contentExportEnvelope(content: ImportBundle) {
  return buildContentExport(content);
}

export function safeFilename(value: string): string {
  const normalized = value.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-');
  return normalized || 'language-rpg-content';
}

function error(path: string, message: string): WorkshopIssue {
  return { level: 'error', path, message };
}

function warning(path: string, message: string): WorkshopIssue {
  return { level: 'warning', path, message };
}

function clampPriority(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function toChineseNumber(index: number): string {
  const values = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  return values[index] ?? String(index);
}
