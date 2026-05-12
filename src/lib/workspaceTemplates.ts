import type { Background, StoryOutline, WorkspaceTemplate, WorkspaceTemplateDocument } from '@/types/content';
import type { WorkspaceCreateInput, WorkspaceDocument, WorkspaceDocumentKind } from '@/types/workspace';
import { createWorkspaceDocument } from '@/storage/ledgerRepository';

const WORKSPACE_KINDS: WorkspaceDocumentKind[] = [
  'protagonist',
  'character',
  'relationship',
  'scene',
  'director',
  'world',
  'timeline',
  'foreshadowing',
  'memory',
  'audit',
  'inventory',
  'rule',
  'misc',
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cleanString(value: unknown, fallback = ''): string {
  return String(value ?? fallback).trim();
}

function cleanList(value: unknown): string[] {
  const arr = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,\n，、]+/)
      : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    const text = cleanString(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function normalizeKind(kind: unknown): WorkspaceDocumentKind {
  const value = cleanString(kind);
  return WORKSPACE_KINDS.includes(value as WorkspaceDocumentKind) ? value as WorkspaceDocumentKind : 'misc';
}

export function normalizeWorkspaceTemplateDocument(raw: Partial<WorkspaceTemplateDocument>): WorkspaceTemplateDocument {
  return {
    path: cleanString(raw.path, 'misc/untitled.md') || 'misc/untitled.md',
    title: cleanString(raw.title) || undefined,
    kind: normalizeKind(raw.kind),
    summary: cleanString(raw.summary) || undefined,
    tags: cleanList(raw.tags),
    content: String(raw.content ?? ''),
    archived: !!raw.archived || undefined,
    stale: !!raw.stale || undefined,
  };
}

export function normalizeWorkspaceTemplate(raw: Partial<WorkspaceTemplate>, fallbackId: string): WorkspaceTemplate {
  const docs = (Array.isArray(raw.docs) ? raw.docs : [])
    .map((doc) => normalizeWorkspaceTemplateDocument(doc))
    .filter((doc) => doc.path.trim() && doc.content.trim());
  return {
    id: cleanString(raw.id, fallbackId) || fallbackId,
    name: cleanString(raw.name, '未命名司书库模板') || '未命名司书库模板',
    description: cleanString(raw.description) || undefined,
    outlineIds: cleanList(raw.outlineIds),
    backgroundIds: cleanList(raw.backgroundIds),
    worldBookIds: cleanList(raw.worldBookIds),
    tags: cleanList(raw.tags),
    docs,
  };
}

export function workspaceTemplateFromDocuments(p: {
  id: string;
  name: string;
  description?: string;
  outlineIds?: string[];
  backgroundIds?: string[];
  worldBookIds?: string[];
  tags?: string[];
  docs: WorkspaceDocument[];
}): WorkspaceTemplate {
  return normalizeWorkspaceTemplate({
    id: p.id,
    name: p.name,
    description: p.description,
    outlineIds: p.outlineIds,
    backgroundIds: p.backgroundIds,
    worldBookIds: p.worldBookIds,
    tags: p.tags,
    docs: (p.docs ?? []).map((doc) => ({
      path: doc.path,
      title: doc.title,
      kind: doc.kind,
      summary: doc.summary,
      tags: doc.tags,
      content: doc.content,
      archived: doc.archived,
      stale: doc.stale,
    })),
  }, p.id);
}

export function templateMatchesJourney(
  template: WorkspaceTemplate,
  p: {
    outlineId?: string;
    backgroundId?: string;
    worldBookIds?: string[];
  },
): boolean {
  const hasRule = !!(
    template.outlineIds?.length ||
    template.backgroundIds?.length ||
    template.worldBookIds?.length
  );
  if (!hasRule) return false;
  if (p.outlineId && template.outlineIds?.includes(p.outlineId)) return true;
  if (p.backgroundId && template.backgroundIds?.includes(p.backgroundId)) return true;
  const worldBookIds = new Set(p.worldBookIds ?? []);
  return !!template.worldBookIds?.some((id) => worldBookIds.has(id));
}

function renderTemplateText(text: string, vars: Record<string, string | undefined>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, key) => {
    const value = vars[key];
    return value === undefined ? match : value;
  });
}

export async function applyWorkspaceTemplatesToSave(p: {
  saveId: string;
  currentRound: number;
  templates: WorkspaceTemplate[];
  characterName?: string;
  saveName?: string;
  outline?: StoryOutline;
  background?: Background;
}): Promise<{ createdOrUpdated: number; skipped: number }> {
  const vars: Record<string, string | undefined> = {
    characterName: p.characterName?.trim() || '主角',
    protagonist: p.characterName?.trim() || '主角',
    saveName: p.saveName,
    outlineTitle: p.outline?.title,
    backgroundName: p.background?.name,
  };
  let createdOrUpdated = 0;
  let skipped = 0;

  for (const template of p.templates.map((item, index) => normalizeWorkspaceTemplate(clone(item), item.id || `template_${index}`))) {
    for (const doc of template.docs) {
      if (!doc.path.trim() || !doc.content.trim()) {
        skipped += 1;
        continue;
      }
      const input: WorkspaceCreateInput = {
        saveId: p.saveId,
        path: renderTemplateText(doc.path, vars),
        title: doc.title ? renderTemplateText(doc.title, vars) : undefined,
        kind: doc.kind,
        summary: doc.summary ? renderTemplateText(doc.summary, vars) : undefined,
        tags: doc.tags ?? [],
        content: renderTemplateText(doc.content, vars),
        updatedAtRound: p.currentRound,
        updatedBy: 'template',
        provenance: {
          round: p.currentRound,
          note: `由司书库模板「${template.name}」导入。`,
        },
      };
      await createWorkspaceDocument(input);
      createdOrUpdated += 1;
    }
  }
  return { createdOrUpdated, skipped };
}
