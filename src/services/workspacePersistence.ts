import type {
  WorkspaceCreateInput,
  WorkspaceDocument,
  WorkspaceDocumentKind,
  WorkspaceDocumentManifestItem,
  WorkspacePatchInput,
} from '@/types/workspace';
import {
  createWorkspaceDocument,
  getWorkspaceDocumentByPath,
  getWorkspaceManifest,
  normalizeWorkspacePath,
  patchWorkspaceDocument,
  searchWorkspaceDocuments,
} from '@/storage/ledgerRepository';

export type WorkspaceWriteSource =
  | 'system'
  | 'seed'
  | 'tool'
  | 'orchestrator'
  | 'director'
  | 'story'
  | 'decision'
  | 'memory'
  | 'settingGuard'
  | 'logicCheck'
  | 'characterPlanner'
  | 'scenePlanner'
  | 'eventPlanner'
  | 'outlineMapper'
  | 'stageJudge'
  | 'librarian'
  | 'human';

export interface WorkspaceFileWriteOptions {
  title?: string;
  kind?: WorkspaceDocumentKind;
  summary?: string;
  tags?: string[];
  round?: number;
  updatedBy?: WorkspaceWriteSource | string;
  archived?: boolean;
  stale?: boolean;
  overwriteHuman?: boolean;
  note?: string;
}

export interface WorkspaceAppendOptions extends WorkspaceFileWriteOptions {
  heading?: string;
}

export interface WorkspaceListOptions {
  path?: string;
  kind?: WorkspaceDocumentKind;
  tags?: string[];
  includeArchived?: boolean;
  limit?: number;
}

export interface WorkspaceFileDraft extends WorkspaceFileWriteOptions {
  path: string;
  content: string;
}

export interface WorkspacePlanningArtifactResult {
  latest: WorkspaceDocument;
  round?: WorkspaceDocument;
}

function normalizeRound(round: unknown): number {
  return Math.max(0, Math.floor(Number(round) || 0));
}

function normalizeLimit(limit: unknown, fallback = 80): number {
  const n = Math.floor(Number(limit));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(500, n));
}

function titleFromPath(path: string): string {
  const leaf = normalizeWorkspacePath(path).split('/').pop() ?? 'untitled';
  return leaf.replace(/\.[^.]+$/, '') || leaf;
}

function provenanceOf(
  options: WorkspaceFileWriteOptions,
  existing?: WorkspaceDocument,
): WorkspaceCreateInput['provenance'] {
  if (options.round === undefined && options.note === undefined) {
    return existing?.provenance;
  }
  return {
    ...existing?.provenance,
    round: options.round === undefined
      ? existing?.provenance?.round
      : normalizeRound(options.round),
    note: options.note ?? existing?.provenance?.note,
  };
}

async function assertCanOverwriteHuman(
  existing: WorkspaceDocument | undefined,
  overwriteHuman: boolean | undefined,
  path: string,
): Promise<void> {
  if (existing?.updatedBy === 'human' && !overwriteHuman) {
    throw new Error(`拒绝覆盖玩家手写司书库文件：${path}`);
  }
}

function pathMatches(path: string, prefix?: string): boolean {
  if (!prefix?.trim()) return true;
  const normalizedPrefix = normalizeWorkspacePath(prefix).replace(/\/?$/, '/');
  const normalizedPath = normalizeWorkspacePath(path);
  return normalizedPath === normalizedPrefix.slice(0, -1) || normalizedPath.startsWith(normalizedPrefix);
}

function tagsMatch(itemTags: string[] | undefined, requiredTags: string[] | undefined): boolean {
  const required = (requiredTags ?? []).map((tag) => tag.trim()).filter(Boolean);
  if (!required.length) return true;
  const owned = new Set((itemTags ?? []).map((tag) => tag.trim()));
  return required.every((tag) => owned.has(tag));
}

function filterManifest(
  manifest: WorkspaceDocumentManifestItem[],
  options: WorkspaceListOptions = {},
): WorkspaceDocumentManifestItem[] {
  return manifest
    .filter((item) => options.includeArchived || !item.archived)
    .filter((item) => !options.kind || item.kind === options.kind)
    .filter((item) => pathMatches(item.path, options.path))
    .filter((item) => tagsMatch(item.tags, options.tags))
    .slice(0, normalizeLimit(options.limit));
}

function mergeTags(base: string[] | undefined, extra: string[] | undefined): string[] | undefined {
  const merged = Array.from(new Set([...(base ?? []), ...(extra ?? [])].map((tag) => tag.trim()).filter(Boolean)));
  return merged.length ? merged : undefined;
}

/**
 * 内部司书库落盘口：给定 saveId、文件路径和内容即可落盘。
 *
 * 注意：
 * - 这是代码层持久化口子，不是 LLM 工具。
 * - 默认不会覆盖 updatedBy=human 的玩家手写文件。
 * - 后续小模型自动保存 planning artifact 时应优先走这里。
 */
export async function writeWorkspaceFile(
  saveId: string,
  path: string,
  content: string,
  options: WorkspaceFileWriteOptions = {},
): Promise<WorkspaceDocument> {
  const normalizedPath = normalizeWorkspacePath(path);
  const existing = await getWorkspaceDocumentByPath(saveId, normalizedPath);
  await assertCanOverwriteHuman(existing, options.overwriteHuman, normalizedPath);
  return createWorkspaceDocument({
    saveId,
    path: normalizedPath,
    title: options.title ?? existing?.title ?? titleFromPath(normalizedPath),
    kind: options.kind ?? existing?.kind ?? 'misc',
    content,
    summary: options.summary ?? existing?.summary,
    tags: options.tags ?? existing?.tags,
    updatedAtRound: normalizeRound(options.round ?? existing?.updatedAtRound),
    updatedBy: options.updatedBy ?? existing?.updatedBy ?? 'system',
    archived: options.archived ?? existing?.archived,
    stale: options.stale ?? existing?.stale,
    provenance: provenanceOf(options, existing),
  });
}

export async function writeWorkspaceJson(
  saveId: string,
  path: string,
  value: unknown,
  options: WorkspaceFileWriteOptions = {},
): Promise<WorkspaceDocument> {
  return writeWorkspaceFile(
    saveId,
    path,
    JSON.stringify(value, null, 2),
    {
      kind: 'misc',
      ...options,
      tags: Array.from(new Set([...(options.tags ?? []), 'json'])),
    },
  );
}

export async function writeWorkspaceFiles(
  saveId: string,
  files: WorkspaceFileDraft[],
  defaults: WorkspaceFileWriteOptions = {},
): Promise<WorkspaceDocument[]> {
  const written: WorkspaceDocument[] = [];
  for (const file of files) {
    const { path, content, tags, ...fileOptions } = file;
    written.push(await writeWorkspaceFile(saveId, path, content, {
      ...defaults,
      ...fileOptions,
      tags: mergeTags(defaults.tags, tags),
    }));
  }
  return written;
}

export async function appendWorkspaceFile(
  saveId: string,
  path: string,
  content: string,
  options: WorkspaceAppendOptions = {},
): Promise<WorkspaceDocument> {
  const normalizedPath = normalizeWorkspacePath(path);
  const existing = await getWorkspaceDocumentByPath(saveId, normalizedPath);
  await assertCanOverwriteHuman(existing, options.overwriteHuman, normalizedPath);
  const heading = (options.heading ?? `第 ${normalizeRound(options.round)} 回合更新`).trim();
  const nextContent = existing
    ? `${existing.content.trim()}\n\n## ${heading}\n${content}`.trim()
    : [`# ${options.title ?? titleFromPath(normalizedPath)}`, '', `## ${heading}`, content].join('\n');
  return writeWorkspaceFile(saveId, normalizedPath, nextContent, {
    ...options,
    title: options.title ?? existing?.title ?? titleFromPath(normalizedPath),
    kind: options.kind ?? existing?.kind ?? 'misc',
    summary: options.summary ?? existing?.summary,
    tags: options.tags ?? existing?.tags,
  });
}

export async function patchWorkspaceFileByPath(
  saveId: string,
  path: string,
  patch: WorkspacePatchInput,
  options: Pick<WorkspaceFileWriteOptions, 'overwriteHuman'> = {},
): Promise<WorkspaceDocument | undefined> {
  const normalizedPath = normalizeWorkspacePath(path);
  const existing = await getWorkspaceDocumentByPath(saveId, normalizedPath);
  if (!existing) return undefined;
  await assertCanOverwriteHuman(existing, options.overwriteHuman, normalizedPath);
  return patchWorkspaceDocument(existing.id, patch);
}

export async function readWorkspaceFile(
  saveId: string,
  path: string,
): Promise<WorkspaceDocument | undefined> {
  return getWorkspaceDocumentByPath(saveId, path);
}

export async function readWorkspaceFiles(
  saveId: string,
  paths: string[],
): Promise<WorkspaceDocument[]> {
  const normalizedPaths = Array.from(new Set(paths.map((path) => normalizeWorkspacePath(path))));
  const docs = await Promise.all(normalizedPaths.map((path) => readWorkspaceFile(saveId, path)));
  return docs.filter((doc): doc is WorkspaceDocument => !!doc);
}

export async function listWorkspaceFiles(
  saveId: string,
  options: WorkspaceListOptions = {},
): Promise<WorkspaceDocumentManifestItem[]> {
  return filterManifest(await getWorkspaceManifest(saveId), options);
}

export async function searchWorkspaceFiles(
  saveId: string,
  query: string,
  options: WorkspaceListOptions = {},
): Promise<WorkspaceDocument[]> {
  const docs = await searchWorkspaceDocuments(saveId, query, normalizeLimit(options.limit, 20));
  return docs
    .filter((item) => options.includeArchived || !item.archived)
    .filter((item) => !options.kind || item.kind === options.kind)
    .filter((item) => pathMatches(item.path, options.path))
    .filter((item) => tagsMatch(item.tags, options.tags));
}

export function planningArtifactPath(kind: string, round?: number): {
  latest: string;
  round?: string;
} {
  const safeKind = String(kind ?? 'artifact')
    .replace(/[\\/:*?"<>|#%{}[\]^~`]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 48) || 'artifact';
  const normalizedRound = round === undefined ? undefined : normalizeRound(round);
  return {
    latest: `planning/latest/${safeKind}.json`,
    round: normalizedRound === undefined
      ? undefined
      : `planning/rounds/${String(normalizedRound).padStart(4, '0')}/${safeKind}.json`,
  };
}

export async function writePlanningArtifact(
  saveId: string,
  kind: string,
  value: unknown,
  options: WorkspaceFileWriteOptions = {},
): Promise<WorkspacePlanningArtifactResult> {
  const paths = planningArtifactPath(kind, options.round);
  const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const tags = mergeTags(options.tags, ['planning', kind]);
  const latest = await writeWorkspaceFile(saveId, paths.latest, content, {
    kind: 'audit',
    ...options,
    tags,
    note: options.note ?? `planning artifact: ${kind}/latest`,
  });
  const round = paths.round
    ? await writeWorkspaceFile(saveId, paths.round, content, {
      kind: 'audit',
      ...options,
      tags,
      note: options.note ?? `planning artifact: ${kind}/round`,
    })
    : undefined;
  return { latest, round };
}
