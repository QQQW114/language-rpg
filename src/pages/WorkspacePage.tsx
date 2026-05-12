import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Archive,
  BookMarked,
  BookOpen,
  FilePlus2,
  FileText,
  FolderOpen,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { OrnateDivider } from '@/components/ui/Ornaments';
import { toast } from '@/lib/toast';
import { useGameStore } from '@/store/useGameStore';
import {
  selectAllBackgrounds,
  selectAllOutlines,
  selectAllWorldBooks,
  useContentStore,
} from '@/store/useContentStore';
import { seedWorkspaceDocumentsFromSave } from '@/lib/workspaceSeed';
import {
  createWorkspaceDocument,
  deleteWorkspaceDocument,
  getWorkspaceDocuments,
  normalizeWorkspacePath,
  patchWorkspaceDocument,
} from '@/storage/ledgerRepository';
import type { WorkspaceDocument, WorkspaceDocumentKind } from '@/types/workspace';
import { clsx } from '@/lib/utils';

const KIND_OPTIONS: Array<{ value: WorkspaceDocumentKind; label: string }> = [
  { value: 'protagonist', label: '主角' },
  { value: 'character', label: '人物' },
  { value: 'relationship', label: '关系' },
  { value: 'scene', label: '场景' },
  { value: 'director', label: '导演' },
  { value: 'world', label: '世界' },
  { value: 'timeline', label: '时间线' },
  { value: 'foreshadowing', label: '伏笔' },
  { value: 'memory', label: '记忆' },
  { value: 'audit', label: '审校' },
  { value: 'inventory', label: '能力' },
  { value: 'rule', label: '规范' },
  { value: 'misc', label: '杂项' },
];

interface DraftState {
  id?: string;
  path: string;
  title: string;
  kind: WorkspaceDocumentKind;
  summary: string;
  tags: string;
  content: string;
  archived: boolean;
  stale: boolean;
}

function emptyDraft(saveId: string, currentRound: number): DraftState {
  void saveId;
  return {
    path: `misc/new-${String(currentRound).padStart(3, '0')}.md`,
    title: '新档案',
    kind: 'misc',
    summary: '',
    tags: '',
    content: [
      '# 新档案',
      '',
      '> 司书库文件：本文件只属于当前旅程。模型可按需读取；不要把它当成所有故事共享的书库预设。',
      '',
      '- 用途：说明这个文件提供给哪个模型/剧情环节使用。',
      '- 当前可信度：玩家确认 / 模型推测 / 待核对。',
      '- 更新原则：说明什么时候追加、覆盖、归档或标记过期。',
      '',
      '## 内容',
      '',
    ].join('\n'),
    archived: false,
    stale: false,
  };
}

function docToDraft(doc: WorkspaceDocument): DraftState {
  return {
    id: doc.id,
    path: doc.path,
    title: doc.title,
    kind: doc.kind,
    summary: doc.summary ?? '',
    tags: (doc.tags ?? []).join('，'),
    content: doc.content,
    archived: !!doc.archived,
    stale: !!doc.stale,
  };
}

function splitTags(text: string): string[] {
  return text
    .split(/[\n,，、]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function folderOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(0, idx) : 'root';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function WorkspacePage() {
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const saves = useGameStore((s) => s.saves);
  const setActive = useGameStore((s) => s.setActive);
  const saveId = searchParams.get('saveId') ?? undefined;
  const save = saveId ? saves[saveId] : undefined;
  const outlines = useContentStore(selectAllOutlines);
  const backgrounds = useContentStore(selectAllBackgrounds);
  const worldBooks = useContentStore(selectAllWorldBooks);

  const [docs, setDocs] = useState<WorkspaceDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [draft, setDraft] = useState<DraftState | undefined>();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const saveList = useMemo(
    () => Object.values(saves).sort((a, b) => b.updatedAt - a.updatedAt),
    [saves],
  );
  const selected = useMemo(() => docs.find((doc) => doc.id === selectedId), [docs, selectedId]);
  const totalBytes = useMemo(() => new TextEncoder().encode(JSON.stringify(docs)).byteLength, [docs]);

  const filteredDocs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return docs;
    const terms = q.split(/\s+/).filter(Boolean);
    return docs.filter((doc) => {
      const hay = [doc.path, doc.title, doc.kind, doc.summary ?? '', ...(doc.tags ?? []), doc.content]
        .join('\n')
        .toLowerCase();
      return terms.every((term) => hay.includes(term));
    });
  }, [docs, query]);

  const docsByFolder = useMemo(() => {
    const map = new Map<string, WorkspaceDocument[]>();
    for (const doc of filteredDocs) {
      const folder = folderOf(doc.path);
      map.set(folder, [...(map.get(folder) ?? []), doc]);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], 'zh-Hans-CN'));
  }, [filteredDocs]);

  const loadDocs = useCallback(async () => {
    if (!save) return;
    setLoading(true);
    try {
      const next = await getWorkspaceDocuments(save.id);
      setDocs(next);
      setSelectedId((cur) => {
        if (cur && next.some((doc) => doc.id === cur)) return cur;
        return next[0]?.id;
      });
    } catch (err: any) {
      toast.danger(`司书库读取失败：${err?.message ?? String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [save]);

  useEffect(() => {
    void loadDocs();
  }, [loadDocs]);

  useEffect(() => {
    if (selected) {
      setDraft(docToDraft(selected));
    } else if (save) {
      setDraft(emptyDraft(save.id, save.state.currentRound));
    }
  }, [save, selected]);

  async function seedDocs(overwrite = false) {
    if (!save) return;
    setLoading(true);
    try {
      const outline = outlines.find((item) => item.id === save.content.outlineId);
      const background = backgrounds.find((item) => item.id === save.content.backgroundId);
      const worldBookIds = new Set(save.content.worldBookIds ?? []);
      const pickedWorldBooks = worldBooks.filter((item) => worldBookIds.has(item.id));
      const result = await seedWorkspaceDocumentsFromSave(
        save,
        { outline, background, worldBooks: pickedWorldBooks },
        { overwrite },
      );
      toast.success(`司书库已整理：新增 ${result.created}，更新 ${result.updated}，跳过 ${result.skipped}。`);
      await loadDocs();
    } catch (err: any) {
      toast.danger(`整理失败：${err?.message ?? String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  function startNew() {
    if (!save) return;
    setSelectedId(undefined);
    setDraft(emptyDraft(save.id, save.state.currentRound));
  }

  async function saveDraft() {
    if (!save || !draft) return;
    setSaving(true);
    try {
      const path = normalizeWorkspacePath(draft.path);
      if (draft.id) {
        const updated = await patchWorkspaceDocument(draft.id, {
          title: draft.title,
          kind: draft.kind,
          summary: draft.summary,
          tags: splitTags(draft.tags),
          content: draft.content,
          updatedAtRound: save.state.currentRound,
          updatedBy: 'human',
          archived: draft.archived,
          stale: draft.stale,
        });
        if (updated && updated.path !== path) {
          // path 是唯一索引字段；需要改路径时用新文件覆盖，再删除旧文件。
          await createWorkspaceDocument({
            saveId: save.id,
            path,
            title: draft.title,
            kind: draft.kind,
            summary: draft.summary,
            tags: splitTags(draft.tags),
            content: draft.content,
            updatedAtRound: save.state.currentRound,
            updatedBy: 'human',
            provenance: { sourceDocIds: [updated.id], note: '玩家在司书库 UI 中改名 / 移动路径。' },
          });
          await deleteWorkspaceDocument(updated.id);
        }
      } else {
        await createWorkspaceDocument({
          saveId: save.id,
          path,
          title: draft.title,
          kind: draft.kind,
          summary: draft.summary,
          tags: splitTags(draft.tags),
          content: draft.content,
          updatedAtRound: save.state.currentRound,
          updatedBy: 'human',
        });
      }
      toast.success('司书库文件已保存。');
      await loadDocs();
      const next = (await getWorkspaceDocuments(save.id)).find((doc) => doc.path === path);
      if (next) setSelectedId(next.id);
    } catch (err: any) {
      toast.danger(`保存失败：${err?.message ?? String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  async function removeSelected() {
    if (!selected) return;
    try {
      await deleteWorkspaceDocument(selected.id);
      toast.success('司书库文件已删除。');
      setSelectedId(undefined);
      await loadDocs();
    } catch (err: any) {
      toast.danger(`删除失败：${err?.message ?? String(err)}`);
    }
  }

  if (!saveId) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <Button variant="ghost" onClick={() => nav('/')}>
            <ArrowLeft size={16} /> 返回主页
          </Button>
          <div className="text-center">
            <h1 className="font-serif text-2xl text-gold-light tracking-[0.18em]">司书库</h1>
            <div className="text-xs text-parchment-200/55 mt-1">
              每段旅程都有独立的司书库，请先选择要查看的旅程。
            </div>
          </div>
          <div className="w-[88px]" />
        </div>

        <div className="grid gap-3">
          {saveList.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setActive(item.id);
                setSearchParams({ saveId: item.id });
              }}
              className="w-full text-left rounded-xl border border-parchment-600/45 bg-parchment-900/45 p-4 shadow-engraved transition-all hover:border-gold/65 hover:bg-parchment-800/50"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-full border border-gold/35 bg-gold/10 p-2 text-gold-light">
                  <BookMarked size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-serif text-lg text-parchment-50 truncate">{item.name}</div>
                  <div className="mt-1 text-xs text-parchment-200/60">
                    第 {item.state.currentRound} / {item.config.totalRounds || '∞'} 回合 ·
                    {' '}
                    {item.content.mode === 'author' ? '执笔模式' : '游历模式'} ·
                    {' '}
                    {new Date(item.updatedAt).toLocaleString()}
                  </div>
                  <div className="mt-2 text-xs text-parchment-200/50 leading-relaxed">
                    打开这段旅程自己的角色、场景、世界设定、导演计划与记忆文件。
                  </div>
                </div>
                <div className="hidden sm:flex items-center gap-1 text-sm text-gold/75 font-serif">
                  <BookOpen size={15} /> 打开
                </div>
              </div>
            </button>
          ))}
          {!saveList.length && (
            <div className="text-center text-parchment-200/60 py-16 border border-dashed border-parchment-600/45 rounded-xl font-serif">
              暂无旅程。创建旅程后，司书库会按旅程独立生成。
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!save) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-8">
        <Button variant="ghost" onClick={() => nav('/')}>
          <ArrowLeft size={16} /> 返回
        </Button>
        <div className="mt-16 text-center text-parchment-200/70 font-serif">
          未找到这段旅程，无法打开对应司书库。
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => nav('/workspace')}>
            <ArrowLeft size={16} /> 旅程列表
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setActive(save.id);
              nav('/game');
            }}
          >
            <BookOpen size={16} /> 返回旅程
          </Button>
        </div>
        <div className="text-center">
          <h1 className="font-serif text-2xl text-gold-light tracking-[0.18em]">司书库</h1>
          <div className="text-xs text-parchment-200/55 mt-1">
            {save.name} · {docs.length} 份档案 · {formatBytes(totalBytes)}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => seedDocs(false)} loading={loading} title="只补齐缺失文件，不覆盖已有编辑">
            <Sparkles size={15} /> 补齐档案
          </Button>
          <Button onClick={startNew}>
            <FilePlus2 size={15} /> 新建
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <aside className="rounded-xl border border-parchment-600/45 bg-parchment-900/45 p-4 shadow-engraved min-h-[70vh]">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="font-serif text-gold-light flex items-center gap-2">
              <BookMarked size={16} /> 文件
            </div>
            <Button variant="ghost" size="sm" onClick={loadDocs} loading={loading} title="刷新">
              <RefreshCw size={13} />
            </Button>
          </div>
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-parchment-200/45" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索角色 / 场景 / 规范…"
              className="pl-9"
            />
          </div>

          <div className="space-y-4 max-h-[66vh] overflow-auto pr-1">
            {docsByFolder.map(([folder, items]) => (
              <div key={folder}>
                <div className="flex items-center gap-2 text-[11px] text-gold/70 tracking-[0.16em] uppercase mb-1">
                  <FolderOpen size={13} /> {folder}
                </div>
                <div className="space-y-1">
                  {items.map((doc) => (
                    <button
                      key={doc.id}
                      onClick={() => setSelectedId(doc.id)}
                      className={clsx(
                        'w-full text-left rounded-md border px-3 py-2 transition-all',
                        selectedId === doc.id
                          ? 'border-gold/75 bg-gold/10 shadow-glow-sm'
                          : 'border-parchment-700/40 bg-parchment-950/30 hover:border-gold/45 hover:bg-parchment-800/35',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm text-parchment-50 font-serif">{doc.title}</span>
                        <span className="text-[10px] text-parchment-200/45">v{doc.version}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-parchment-200/55">
                        <FileText size={11} />
                        <span className="truncate">{doc.path}</span>
                      </div>
                      {doc.summary && (
                        <div className="mt-1 text-[11px] text-parchment-200/45 line-clamp-2">{doc.summary}</div>
                      )}
                      <div className="mt-1 flex flex-wrap gap-1">
                        <span className="rounded border border-gold/25 px-1.5 py-0.5 text-[10px] text-gold/70">
                          {KIND_OPTIONS.find((item) => item.value === doc.kind)?.label ?? doc.kind}
                        </span>
                        {doc.stale && <span className="text-[10px] text-blood/80">过期</span>}
                        {doc.archived && <span className="text-[10px] text-parchment-200/40">归档</span>}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {!docsByFolder.length && (
              <div className="text-center text-sm text-parchment-200/55 py-10 border border-dashed border-parchment-600/40 rounded-lg">
                暂无档案。可以点击「补齐档案」从当前旅程状态生成基础文件。
              </div>
            )}
          </div>
        </aside>

        <main className="rounded-xl border border-parchment-600/45 bg-parchment-900/45 p-5 shadow-engraved min-h-[70vh]">
          {draft ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div>
                  <div className="font-serif text-xl text-parchment-50">{draft.title || '未命名档案'}</div>
                  <div className="text-xs text-parchment-200/50 mt-1">
                    {draft.id ? `ID: ${draft.id}` : '新建文件'} · 当前回合 {save.state.currentRound}
                  </div>
                </div>
                <div className="flex gap-2">
                  {selected && (
                    <Button variant="danger" size="sm" onClick={removeSelected}>
                      <Trash2 size={14} /> 删除
                    </Button>
                  )}
                  <Button size="sm" onClick={saveDraft} loading={saving}>
                    <Save size={14} /> 保存
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-[1.1fr_0.9fr]">
                <Input
                  label="路径"
                  value={draft.path}
                  onChange={(e) => setDraft({ ...draft, path: e.target.value })}
                  hint="例如 characters/小晴/profile.md、scenes/旧教学楼.md、rules/story-style.md"
                />
                <Input
                  label="标题"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-[220px_1fr]">
                <label className="block mb-4">
                  <span className="block text-sm text-gold-light mb-1.5 tracking-[0.08em]">类型</span>
                  <select
                    value={draft.kind}
                    onChange={(e) => setDraft({ ...draft, kind: e.target.value as WorkspaceDocumentKind })}
                    className="w-full bg-parchment-900/70 text-parchment-100 border border-parchment-600/55 rounded-md px-3 py-2 font-serif focus:outline-none focus:border-gold/75"
                  >
                    {KIND_OPTIONS.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </label>
                <Input
                  label="标签"
                  value={draft.tags}
                  onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
                  hint="用逗号、顿号或换行分隔。"
                />
              </div>

              <Textarea
                label="短摘要 / manifest 摘要"
                value={draft.summary}
                onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
                rows={3}
                hint="以后会先给模型看这个摘要，模型需要全文时再调用 read_doc。"
              />

              <Textarea
                label="文件内容"
                value={draft.content}
                onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                rows={18}
                className="font-mono text-sm"
              />

              <div className="flex flex-wrap items-center gap-4 text-sm text-parchment-200/75">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-gold"
                    checked={draft.stale}
                    onChange={(e) => setDraft({ ...draft, stale: e.target.checked })}
                  />
                  标记为过期
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-gold"
                    checked={draft.archived}
                    onChange={(e) => setDraft({ ...draft, archived: e.target.checked })}
                  />
                  <Archive size={14} /> 归档
                </label>
              </div>

              <OrnateDivider />
              <div className="text-xs text-parchment-200/50 leading-relaxed">
                当前阶段只是司书库主体：文件存储、编辑、搜索、旅程包导入导出、工具函数雏形。后续再把工具调用接入司辰 / 导演 / 审校等模型。
              </div>
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-parchment-200/55 font-serif">
              请选择或新建一份档案。
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
