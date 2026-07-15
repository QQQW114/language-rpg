import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  BookCopy,
  BookOpen,
  BookPlus,
  CheckCircle2,
  Download,
  FilePlus2,
  LibraryBig,
  Link2,
  Plus,
  Save,
  ScrollText,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardMeta, CardTitle } from '@/components/ui/Card';
import { confirmDialog } from '@/components/ui/ConfirmDialog';
import { OrnateDivider } from '@/components/ui/Ornaments';
import { parseContentImport, serializeContentExport } from '@/lib/contentLibrary';
import { PRESET_OUTLINES } from '@/presets/outlines';
import { PRESET_WORLDBOOKS } from '@/presets/worldbooks';
import {
  selectAllWorldBooks,
  useContentStore,
} from '@/store/useContentStore';
import type { StoryOutline, WorldBook } from '@/types/content';
import { OutlineEditor } from './workshop/OutlineEditor';
import { WorldBookEditor } from './workshop/WorldBookEditor';
import {
  clonePresetProject,
  contentExportEnvelope,
  createBlankOutline,
  createBlankWorldBook,
  downloadJson,
  inspectOutline,
  inspectWorldBook,
  normalizeOutlineForSave,
  normalizeWorldBookForSave,
  safeFilename,
  type WorkshopIssue,
} from './workshop/model';

type EditorTab = 'outline' | 'worldbooks' | 'review';
type EditorState =
  | { kind: 'story'; outline: StoryOutline; books: WorldBook[]; dirty: boolean; tab: EditorTab }
  | { kind: 'worldbook'; book: WorldBook; dirty: boolean };

interface Notice {
  tone: 'success' | 'error' | 'info';
  text: string;
}

const REFERENCE_OUTLINE = PRESET_OUTLINES[0];
const REFERENCE_BOOK = PRESET_WORLDBOOKS.find((book) => REFERENCE_OUTLINE?.worldBookIds?.includes(book.id)) ?? PRESET_WORLDBOOKS[0];

export default function WorkshopPageV2() {
  const nav = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const customOutlines = useContentStore((state) => state.customOutlines);
  const customWorldBooks = useContentStore((state) => state.customWorldBooks);
  const allWorldBooks = useContentStore(selectAllWorldBooks);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (!editor?.dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [editor?.dirty]);

  const leaveEditor = async () => {
    if (editor?.dirty) {
      const ok = await confirmDialog({
        title: '放弃尚未保存的修改？',
        message: '这些内容还没有写入浏览器。离开后，本次修改将丢失。',
        confirmText: '放弃修改',
        variant: 'danger',
      });
      if (!ok) return;
    }
    setEditor(null);
  };

  const openBlankStory = () => {
    const outline = createBlankOutline();
    const book = createBlankWorldBook(`${outline.title} · 世界书`);
    outline.worldBookIds = [book.id];
    setEditor({ kind: 'story', outline, books: [book], dirty: true, tab: 'outline' });
  };

  const openReferenceCopy = () => {
    if (!REFERENCE_OUTLINE) return;
    const copy = clonePresetProject(REFERENCE_OUTLINE, PRESET_WORLDBOOKS);
    setEditor({ kind: 'story', outline: copy.outline, books: copy.worldBooks, dirty: true, tab: 'outline' });
  };

  const editStory = (outline: StoryOutline) => {
    const linked = new Set(outline.worldBookIds ?? []);
    setEditor({
      kind: 'story',
      outline: structuredClone(outline),
      books: customWorldBooks.filter((book) => linked.has(book.id)).map((book) => structuredClone(book)),
      dirty: false,
      tab: 'outline',
    });
  };

  const saveStory = () => {
    if (!editor || editor.kind !== 'story') return;
    const outline = normalizeOutlineForSave(editor.outline);
    const books = editor.books.map(normalizeWorldBookForSave);
    const issues = [...inspectOutline(outline), ...books.flatMap(inspectWorldBook)];
    const errors = issues.filter((issue) => issue.level === 'error');
    if (errors.length) {
      setNotice({ tone: 'error', text: `还有 ${errors.length} 处必填内容未完成，请在“发布检查”中查看。` });
      setEditor({ ...editor, tab: 'review' });
      return;
    }
    const store = useContentStore.getState();
    const results = [store.updateOutline(outline), ...books.map((book) => store.updateWorldBook(book))];
    const failed = results.flatMap((result) => result.ok ? [] : result.issues);
    if (failed.length) {
      setNotice({ tone: 'error', text: failed.map((issue) => issue.message).join('；') });
      return;
    }
    setEditor({ ...editor, outline, books, dirty: false });
    setNotice({ tone: 'success', text: `《${outline.title}》已保存到当前浏览器，可立即在启程页选择。` });
  };

  const saveWorldBook = () => {
    if (!editor || editor.kind !== 'worldbook') return;
    const book = normalizeWorldBookForSave(editor.book);
    const errors = inspectWorldBook(book).filter((issue) => issue.level === 'error');
    if (errors.length) {
      setNotice({ tone: 'error', text: errors.map((issue) => `${issue.path}：${issue.message}`).join('；') });
      return;
    }
    const result = useContentStore.getState().updateWorldBook(book);
    if (!result.ok) {
      setNotice({ tone: 'error', text: result.issues.map((issue) => issue.message).join('；') });
      return;
    }
    setEditor({ kind: 'worldbook', book, dirty: false });
    setNotice({ tone: 'success', text: `《${book.name}》已保存到当前浏览器。` });
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = parseContentImport(await file.text());
      if (!parsed.value) {
        setNotice({ tone: 'error', text: parsed.issues.map((issue) => issue.message).join('；') });
        return;
      }
      const result = useContentStore.getState().importBundle(parsed.value);
      const summary = `新增 ${result.added} 项，更新 ${result.updated} 项，跳过 ${result.skipped} 项。`;
      const firstIssue = [...parsed.issues, ...result.issues][0];
      setNotice({ tone: result.added || result.updated ? 'success' : 'info', text: firstIssue ? `${summary} ${firstIssue.message}` : summary });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const exportAll = () => {
    const json = serializeContentExport({ outlines: customOutlines, worldBooks: customWorldBooks });
    downloadText('language-rpg-content-library.json', json);
  };

  if (editor) {
    const title = editor.kind === 'story' ? editor.outline.title : editor.book.name;
    return (
      <div className="mx-auto min-h-full max-w-7xl px-4 py-6 pb-24 sm:px-6">
        <header className="sticky top-0 z-20 -mx-4 mb-6 border-b border-parchment-600/30 bg-ink/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
            <Button variant="ghost" onClick={leaveEditor}><ArrowLeft size={16} /> 返回工坊</Button>
            <div className="min-w-0 flex-1">
              <div className="truncate font-serif text-base text-parchment-50">{title || '未命名内容'}</div>
              <div className={`text-[11px] ${editor.dirty ? 'text-gold-light' : 'text-moss-light'}`}>
                {editor.dirty ? '有尚未保存的修改' : '已保存到浏览器'}
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                if (editor.kind === 'story') exportStory(editor.outline, editor.books, allWorldBooks);
                else exportBook(editor.book);
              }}
            >
              <Download size={15} /> 导出
            </Button>
            <Button onClick={editor.kind === 'story' ? saveStory : saveWorldBook}>
              <Save size={15} /> 保存到浏览器
            </Button>
          </div>
        </header>

        {notice && <NoticeBar notice={notice} onClose={() => setNotice(null)} />}

        {editor.kind === 'story' ? (
          <StoryEditor
            state={editor}
            allWorldBooks={allWorldBooks}
            customWorldBooks={customWorldBooks}
            onChange={(next) => setEditor({ ...next, dirty: true })}
            onTabChange={(tab) => setEditor({ ...editor, tab })}
          />
        ) : (
          <WorldBookEditor
            value={editor.book}
            reference={REFERENCE_BOOK}
            showReference
            onChange={(book) => setEditor({ kind: 'worldbook', book, dirty: true })}
          />
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-full max-w-7xl px-5 py-8 pb-24 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={() => nav('/')}><ArrowLeft size={16} /> 返回主页</Button>
        <div className="min-w-0 flex-1 text-center">
          <div className="text-xs tracking-[0.35em] text-gold/60">DESTINY · WORKSHOP</div>
          <h1 className="mt-1 font-serif text-3xl tracking-widest text-gold-light">命运工坊</h1>
        </div>
        <Button variant="outline" onClick={() => fileInputRef.current?.click()}><Upload size={15} /> 导入</Button>
        <Button variant="outline" disabled={!customOutlines.length && !customWorldBooks.length} onClick={exportAll}><Download size={15} /> 导出全部</Button>
        <input ref={fileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={(event) => importFile(event.target.files?.[0])} />
      </header>

      <p className="mx-auto max-w-3xl text-center text-sm leading-relaxed text-parchment-200/70">
        编写故事的命运骨架与世界硬设定。内容会保存在当前浏览器，也可以导出为 JSON，在其他设备或版本继续使用。
      </p>
      <OrnateDivider className="mx-auto max-w-4xl" />
      {notice && <NoticeBar notice={notice} onClose={() => setNotice(null)} />}

      <section className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(300px,2fr)]">
        <Card variant="luminous" className="overflow-hidden">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border border-gold/40 bg-parchment-900/45 text-4xl shadow-glow-sm">
              {REFERENCE_OUTLINE?.coverEmoji ?? '🌸'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <CardTitle className="mb-0">以内置《{REFERENCE_OUTLINE?.title ?? '错位青春'}》为范本</CardTitle>
                <span className="rounded border border-gold/35 px-2 py-0.5 text-[10px] tracking-wider text-gold-light">只读提示</span>
              </div>
              <CardMeta className="mb-2">
                {REFERENCE_OUTLINE?.acts.length ?? 0} 幕 · {REFERENCE_OUTLINE?.acts.reduce((sum, act) => sum + act.beats.length, 0) ?? 0} 个故事节 · {REFERENCE_BOOK?.entries.length ?? 0} 条世界设定
              </CardMeta>
              <p className="line-clamp-3 text-xs leading-relaxed text-parchment-100/75">{REFERENCE_OUTLINE?.synopsis}</p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2 border-t border-parchment-600/30 pt-4">
            <Button onClick={openReferenceCopy}><BookCopy size={15} /> 复制为自己的故事</Button>
            <Button variant="outline" onClick={openBlankStory}><FilePlus2 size={15} /> 从空白开始</Button>
          </div>
        </Card>

        <Card>
          <CardTitle className="flex items-center gap-2 text-base"><LibraryBig size={17} /> 如何编写</CardTitle>
          <div className="space-y-3 text-xs leading-relaxed text-parchment-200/70">
            <Guide index="1" title="先写结局方向">明确主角最终要抵达的状态，再拆成若干幕。</Guide>
            <Guide index="2" title="故事节写作用，不写路线">规定必须发生什么改变，但允许模型迁移人物、地点和事件形式。</Guide>
            <Guide index="3" title="硬设定才进世界书">身份、规则、长期关系与世界边界适合常驻；其余用关键词按需激活。</Guide>
          </div>
        </Card>
      </section>

      <SectionHeading title="我的故事" count={customOutlines.length} action={<Button size="sm" onClick={openBlankStory}><Plus size={14} /> 新建故事</Button>} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {customOutlines.map((outline) => (
          <ContentCard
            key={outline.id}
            icon={outline.coverEmoji ?? '✦'}
            title={outline.title}
            meta={`${outline.acts.length} 幕 · ${outline.acts.reduce((sum, act) => sum + act.beats.length, 0)} 个故事节`}
            description={outline.synopsis}
            onEdit={() => editStory(outline)}
            onExport={() => exportStory(outline, [], allWorldBooks)}
            onDelete={async () => {
              const ok = await confirmDialog({ title: '删除自定义故事', message: `确定删除《${outline.title}》吗？关联世界书会保留在资料库中。`, confirmText: '删除', variant: 'danger' });
              if (ok) useContentStore.getState().removeOutline(outline.id);
            }}
          />
        ))}
        {!customOutlines.length && <EmptyCard text="还没有自定义故事。可以复制《错位青春》的结构，也可以从空白开始。" />}
      </div>

      <SectionHeading title="我的世界书" count={customWorldBooks.length} action={<Button size="sm" variant="outline" onClick={() => setEditor({ kind: 'worldbook', book: createBlankWorldBook(), dirty: true })}><BookPlus size={14} /> 新建世界书</Button>} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {customWorldBooks.map((book) => {
          const usedBy = customOutlines.filter((outline) => outline.worldBookIds?.includes(book.id));
          return (
            <ContentCard
              key={book.id}
              icon="📜"
              title={book.name}
              meta={`${book.entries.length} 条设定${usedBy.length ? ` · 被 ${usedBy.length} 个故事使用` : ' · 尚未关联故事'}`}
              description={book.description || '暂无用途说明。'}
              onEdit={() => setEditor({ kind: 'worldbook', book: structuredClone(book), dirty: false })}
              onExport={() => exportBook(book)}
              onDelete={async () => {
                const ok = await confirmDialog({
                  title: '删除自定义世界书',
                  message: usedBy.length
                    ? `这本世界书正被 ${usedBy.map((outline) => `《${outline.title}》`).join('、')} 使用。删除后会同时解除这些关联。`
                    : `确定删除《${book.name}》吗？`,
                  confirmText: '删除',
                  variant: 'danger',
                });
                if (!ok) return;
                const store = useContentStore.getState();
                usedBy.forEach((outline) => store.updateOutline({ ...outline, worldBookIds: outline.worldBookIds?.filter((id) => id !== book.id) }));
                store.removeWorldBook(book.id);
              }}
            />
          );
        })}
        {!customWorldBooks.length && <EmptyCard text="还没有独立世界书。新建故事时也会自动创建一本可扩展的世界书。" />}
      </div>
    </div>
  );
}

function StoryEditor({
  state,
  allWorldBooks,
  customWorldBooks,
  onChange,
  onTabChange,
}: {
  state: Extract<EditorState, { kind: 'story' }>;
  allWorldBooks: WorldBook[];
  customWorldBooks: WorldBook[];
  onChange: (state: Extract<EditorState, { kind: 'story' }>) => void;
  onTabChange: (tab: EditorTab) => void;
}) {
  const draftBookIds = new Set(state.books.map((book) => book.id));
  const linkedIds = new Set(state.outline.worldBookIds ?? []);
  const lockedBooks = allWorldBooks.filter((book) => linkedIds.has(book.id) && !draftBookIds.has(book.id));
  const availableBooks = allWorldBooks.filter((book) => !linkedIds.has(book.id));
  const issues = useMemo(
    () => [...inspectOutline(state.outline), ...state.books.flatMap(inspectWorldBook)],
    [state.outline, state.books],
  );
  const updateOutline = (outline: StoryOutline) => onChange({ ...state, outline });

  return (
    <>
      <nav className="mb-6 flex overflow-x-auto border-b border-parchment-600/35" aria-label="故事编辑步骤">
        {([
          ['outline', '一 · 故事骨架', ScrollText],
          ['worldbooks', '二 · 世界书', BookOpen],
          ['review', '三 · 发布检查', CheckCircle2],
        ] as const).map(([id, label, Icon]) => (
          <button key={id} type="button" onClick={() => onTabChange(id)} className={`flex shrink-0 items-center gap-2 border-b-2 px-5 py-3 text-sm transition-colors ${state.tab === id ? 'border-gold text-gold-light' : 'border-transparent text-parchment-200/60 hover:text-parchment-100'}`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </nav>

      {state.tab === 'outline' && <OutlineEditor value={state.outline} onChange={updateOutline} reference={REFERENCE_OUTLINE} />}

      {state.tab === 'worldbooks' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-serif text-xl text-gold-light">关联世界资料</h2>
              <p className="mt-1 text-xs text-parchment-200/60">可以关联多本世界书。自定义世界书可在这里直接扩写，内置预设保持只读。</p>
            </div>
            <Button size="sm" onClick={() => {
              const book = createBlankWorldBook(`${state.outline.title || '未命名故事'} · 世界书`);
              onChange({ ...state, books: [...state.books, book], outline: { ...state.outline, worldBookIds: [...(state.outline.worldBookIds ?? []), book.id] } });
            }}><Plus size={14} /> 新建并关联世界书</Button>
          </div>

          {lockedBooks.map((book) => (
            <Card key={book.id}>
              <div className="flex items-start gap-3">
                <BookOpen size={18} className="mt-0.5 text-gold" />
                <div className="min-w-0 flex-1"><CardTitle className="mb-1 text-base">{book.name}</CardTitle><CardMeta>{book.entries.length} 条设定 · 内置只读</CardMeta><p className="text-xs text-parchment-200/65">{book.description}</p></div>
                <Button size="xs" variant="ghost" onClick={() => updateOutline({ ...state.outline, worldBookIds: state.outline.worldBookIds?.filter((id) => id !== book.id) })}><X size={13} /> 解除</Button>
              </div>
            </Card>
          ))}

          {state.books.map((book, index) => (
            <div key={book.id} className="rounded-lg border border-gold-dark/35 bg-parchment-900/15 p-3 sm:p-4">
              <div className="mb-4 flex items-center justify-between gap-3 border-b border-parchment-600/30 pb-3">
                <div className="flex items-center gap-2 text-xs text-gold-light"><Link2 size={14} /> 已关联到当前故事</div>
                <Button size="xs" variant="ghost" onClick={() => onChange({ ...state, books: state.books.filter((_, itemIndex) => itemIndex !== index), outline: { ...state.outline, worldBookIds: state.outline.worldBookIds?.filter((id) => id !== book.id) } })}><X size={13} /> 解除关联</Button>
              </div>
              <WorldBookEditor
                value={book}
                reference={REFERENCE_BOOK}
                showReference={index === 0}
                onChange={(nextBook) => onChange({ ...state, books: state.books.map((item, itemIndex) => itemIndex === index ? nextBook : item) })}
              />
            </div>
          ))}

          {!!availableBooks.length && (
            <Card>
              <CardTitle className="text-base">关联已有世界书</CardTitle>
              <div className="grid gap-2 sm:grid-cols-2">
                {availableBooks.map((book) => {
                  const custom = customWorldBooks.some((item) => item.id === book.id);
                  return <button key={book.id} type="button" onClick={() => onChange({ ...state, outline: { ...state.outline, worldBookIds: [...(state.outline.worldBookIds ?? []), book.id] }, books: custom ? [...state.books, structuredClone(book)] : state.books })} className="rounded border border-parchment-600/35 bg-parchment-900/30 p-3 text-left transition-colors hover:border-gold/55">
                    <span className="block text-sm text-parchment-50">{book.name}</span><span className="mt-1 block text-[11px] text-parchment-200/50">{book.entries.length} 条 · {custom ? '自定义可编辑' : '内置只读'}</span>
                  </button>;
                })}
              </div>
            </Card>
          )}
        </div>
      )}

      {state.tab === 'review' && <ReviewPanel outline={state.outline} books={state.books} lockedBooks={lockedBooks} issues={issues} />}
    </>
  );
}

function ReviewPanel({ outline, books, lockedBooks, issues }: { outline: StoryOutline; books: WorldBook[]; lockedBooks: WorldBook[]; issues: WorkshopIssue[] }) {
  const errors = issues.filter((issue) => issue.level === 'error');
  const warnings = issues.filter((issue) => issue.level === 'warning');
  return <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(280px,2fr)]">
    <Card variant={errors.length ? 'engraved' : 'luminous'}>
      <CardTitle className="flex items-center gap-2">{errors.length ? <AlertTriangle size={18} className="text-ember-light" /> : <CheckCircle2 size={18} className="text-moss-light" />} 发布检查</CardTitle>
      <CardMeta>{errors.length ? `还有 ${errors.length} 处必填内容需要完成。` : '核心结构完整，可以保存并在启程页使用。'}</CardMeta>
      <div className="mt-4 space-y-2">
        {[...errors, ...warnings].map((issue, index) => <div key={`${issue.path}-${index}`} className={`rounded border px-3 py-2 text-xs ${issue.level === 'error' ? 'border-ember/45 bg-ember/10 text-parchment-100' : 'border-gold-dark/35 bg-parchment-900/35 text-parchment-200/70'}`}><span className="mr-2 font-serif text-gold-light">{issue.path}</span>{issue.message}</div>)}
        {!issues.length && <div className="rounded border border-moss/45 bg-moss/10 px-3 py-3 text-sm text-moss-light">没有发现结构问题。</div>}
      </div>
    </Card>
    <Card>
      <CardTitle>{outline.coverEmoji} {outline.title || '未命名故事'}</CardTitle>
      <CardMeta>{outline.acts.length} 幕 · {outline.acts.reduce((sum, act) => sum + act.beats.length, 0)} 个故事节 · {books.length + lockedBooks.length} 本世界书</CardMeta>
      <p className="mb-4 text-xs leading-relaxed text-parchment-100/75">{outline.synopsis || '尚未填写故事简介。'}</p>
      <div className="space-y-3">{outline.acts.map((act) => <div key={act.id} className="border-l border-gold-dark/55 pl-3"><div className="text-sm text-gold-light">{act.title || '未命名幕'}</div><div className="mt-1 text-[11px] leading-relaxed text-parchment-200/55">{act.purpose || '尚未填写叙事作用'}</div><div className="mt-2 flex flex-wrap gap-1">{act.beats.map((beat) => <span key={beat.id} className="rounded border border-parchment-600/35 px-2 py-0.5 text-[10px] text-parchment-100/70">{beat.title || '未命名故事节'}</span>)}</div></div>)}</div>
    </Card>
  </div>;
}

function NoticeBar({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  const classes = notice.tone === 'error' ? 'border-ember/50 bg-ember/10' : notice.tone === 'success' ? 'border-moss/50 bg-moss/10' : 'border-gold-dark/40 bg-parchment-900/35';
  return <div className={`mb-5 flex items-start gap-3 rounded-md border px-4 py-3 text-sm text-parchment-100 ${classes}`}><span className="min-w-0 flex-1 leading-relaxed">{notice.text}</span><button type="button" onClick={onClose} className="text-parchment-200/55 hover:text-parchment-50"><X size={15} /></button></div>;
}

function SectionHeading({ title, count, action }: { title: string; count: number; action: React.ReactNode }) {
  return <div className="mb-4 mt-10 flex items-center gap-3 border-b border-parchment-600/30 pb-3"><h2 className="font-serif text-xl text-gold-light">{title}</h2><span className="rounded-full border border-parchment-600/40 px-2 py-0.5 text-[10px] text-parchment-200/55">{count}</span><div className="ml-auto">{action}</div></div>;
}

function ContentCard({ icon, title, meta, description, onEdit, onExport, onDelete }: { icon: string; title: string; meta: string; description: string; onEdit: () => void; onExport: () => void; onDelete: () => void }) {
  return <Card className="flex min-h-[230px] flex-col"><div className="mb-3 flex items-start gap-3"><div className="text-2xl">{icon}</div><div className="min-w-0 flex-1"><CardTitle className="mb-1 truncate text-base">{title}</CardTitle><CardMeta>{meta}</CardMeta></div></div><p className="line-clamp-4 text-xs leading-relaxed text-parchment-200/70">{description}</p><div className="mt-auto flex gap-2 border-t border-parchment-600/30 pt-4"><Button size="sm" className="flex-1" onClick={onEdit}>编辑</Button><Button size="sm" variant="outline" title="导出" onClick={onExport}><Download size={14} /></Button><Button size="sm" variant="ghost" title="删除" onClick={onDelete}><Trash2 size={14} /></Button></div></Card>;
}

function EmptyCard({ text }: { text: string }) {
  return <div className="col-span-full rounded-md border border-dashed border-parchment-600/40 px-5 py-10 text-center text-sm leading-relaxed text-parchment-200/55">{text}</div>;
}

function Guide({ index, title, children }: { index: string; title: string; children: React.ReactNode }) {
  return <div className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-gold/35 text-[11px] text-gold-light">{index}</span><div><div className="font-serif text-parchment-50">{title}</div><div className="mt-0.5 text-parchment-200/60">{children}</div></div></div>;
}

function exportStory(outline: StoryOutline, drafts: WorldBook[], allWorldBooks: WorldBook[]) {
  const ids = new Set(outline.worldBookIds ?? []);
  const draftById = new Map(drafts.map((book) => [book.id, book]));
  const books = allWorldBooks.filter((book) => ids.has(book.id)).map((book) => draftById.get(book.id) ?? book);
  drafts.forEach((book) => { if (ids.has(book.id) && !books.some((item) => item.id === book.id)) books.push(book); });
  downloadJson(`${safeFilename(outline.title)}.json`, contentExportEnvelope({ outlines: [outline], worldBooks: books }));
}

function exportBook(book: WorldBook) {
  downloadJson(`${safeFilename(book.name)}.json`, contentExportEnvelope({ worldBooks: [book] }));
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = href; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
}
