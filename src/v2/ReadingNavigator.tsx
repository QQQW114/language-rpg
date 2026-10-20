import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Compass,
  Feather,
  LibraryBig,
  ScrollText,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { OrnateDivider, WaxSeal } from '@/components/ui/Ornaments';
import type { StoryAct } from '@/types/content';
import type { DestinyProgressV2, MessageV2 } from './types';

// ---------------------------------------------------------------------------
// 1. 阅读版式偏好（独立持久化到 lrpg.reader.prefs，绝不触碰 lrpg.v2 存档契约）
// ---------------------------------------------------------------------------

export type ReaderFontSize = 'sm' | 'md' | 'lg';
export type ReaderLineSpacing = 'normal' | 'relaxed';
export type ReaderColumnWidth = 'standard' | 'focused';

export interface ReaderPreferences {
  fontSize: ReaderFontSize;
  lineSpacing: ReaderLineSpacing;
  columnWidth: ReaderColumnWidth;
}

const READER_PREFS_KEY = 'lrpg.reader.prefs';

const DEFAULT_PREFS: ReaderPreferences = {
  fontSize: 'md',
  lineSpacing: 'normal',
  columnWidth: 'standard',
};

const FONT_SIZE_MAP: Record<ReaderFontSize, { label: string; px: string; desc: string }> = {
  sm: { label: '蝇头', px: '15px', desc: '15px · 紧凑长卷' },
  md: { label: '典籍', px: '17px', desc: '17px · 默认字号' },
  lg: { label: '舒朗', px: '19px', desc: '19px · 宽绰护眼' },
};

const LINE_SPACING_MAP: Record<ReaderLineSpacing, { label: string; value: string }> = {
  normal: { label: '标准行距', value: '1.95' },
  relaxed: { label: '疏朗行距', value: '2.22' },
};

const COLUMN_WIDTH_MAP: Record<ReaderColumnWidth, { label: string; className: string }> = {
  standard: { label: '全幅卷面', className: '' },
  focused: { label: '凝神窄栏', className: 'mx-auto max-w-[68ch]' },
};

function readReaderPrefs(): ReaderPreferences {
  try {
    if (typeof window === 'undefined') return DEFAULT_PREFS;
    const raw = window.localStorage.getItem(READER_PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<ReaderPreferences>;
    return {
      fontSize: parsed.fontSize === 'sm' || parsed.fontSize === 'md' || parsed.fontSize === 'lg' ? parsed.fontSize : 'md',
      lineSpacing: parsed.lineSpacing === 'normal' || parsed.lineSpacing === 'relaxed' ? parsed.lineSpacing : 'normal',
      columnWidth: parsed.columnWidth === 'standard' || parsed.columnWidth === 'focused' ? parsed.columnWidth : 'standard',
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function writeReaderPrefs(prefs: ReaderPreferences): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(READER_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage 不可用或配额满时静默退化，不影响阅读。
  }
}

export function useReaderPreferences() {
  const [prefs, setPrefs] = useState<ReaderPreferences>(() => readReaderPrefs());

  const updatePrefs = (patch: Partial<ReaderPreferences>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      writeReaderPrefs(next);
      return next;
    });
  };

  const readerContainerStyle: CSSProperties = {
    ['--story-font-size' as string]: FONT_SIZE_MAP[prefs.fontSize].px,
    ['--story-line-height' as string]: LINE_SPACING_MAP[prefs.lineSpacing].value,
  };

  const readerColumnClass = COLUMN_WIDTH_MAP[prefs.columnWidth].className;

  return { prefs, updatePrefs, readerContainerStyle, readerColumnClass };
}

// ---------------------------------------------------------------------------
// 2. 存档级回合书签（独立持久化到 lrpg.bookmarks.<saveId>，不进入 lrpg.v2）
// ---------------------------------------------------------------------------

function readBookmarks(saveId: string): number[] {
  try {
    if (!saveId || typeof window === 'undefined') return [];
    const raw = window.localStorage.getItem(`lrpg.bookmarks.${saveId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is number => typeof item === 'number' && Number.isInteger(item) && item >= 0)
      .slice(0, 100);
  } catch {
    return [];
  }
}

function writeBookmarks(saveId: string, turns: number[]): void {
  try {
    if (!saveId || typeof window === 'undefined') return;
    if (turns.length === 0) {
      window.localStorage.removeItem(`lrpg.bookmarks.${saveId}`);
    } else {
      window.localStorage.setItem(`lrpg.bookmarks.${saveId}`, JSON.stringify(turns.slice(0, 100)));
    }
  } catch {
    // 静默降级
  }
}

export function useTurnBookmarks(saveId: string | undefined) {
  const [bookmarks, setBookmarks] = useState<number[]>(() => (saveId ? readBookmarks(saveId) : []));

  useEffect(() => {
    setBookmarks(saveId ? readBookmarks(saveId) : []);
  }, [saveId]);

  const toggleBookmark = (turn: number) => {
    if (!saveId) return;
    setBookmarks((current) => {
      const exists = current.includes(turn);
      const next = exists
        ? current.filter((t) => t !== turn)
        : [...current, turn].sort((a, b) => a - b);
      writeBookmarks(saveId, next);
      return next;
    });
  };

  return { bookmarks, toggleBookmark };
}

// ---------------------------------------------------------------------------
// 3. 回合与幕结构推导（纯函数，将线性 history 组织为按幕/回合索引的目录）
// ---------------------------------------------------------------------------

export interface TurnCatalogEntry {
  turn: number;
  actIndex: number;
  actId?: string;
  actTitle: string;
  actPurpose?: string;
  isActStart: boolean;
  previousActExitSummary?: string;
  userAction: string;
  storyExcerpt: string;
  storyFullText: string;
  charCount: number;
}

const CHINESE_NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

function toChineseActLabel(index: number): string {
  return `第${CHINESE_NUMERALS[index] ?? String(index + 1)}幕`;
}

function stripMarkdownSnippet(markdown: string, maxLen = 78): string {
  const cleaned = markdown
    .replace(/[#>*_`~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '（本回合暂无正文摘要）';
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen)}…` : cleaned;
}

/**
 * 根据 `destiny.actHistory`、`destiny.currentActIndex` 与 `outline.acts`
 * 推导每一回合所属的幕序号与切幕题跋信息。
 */
export function buildTurnCatalog(
  history: MessageV2[],
  destiny: DestinyProgressV2,
  outlineActs?: StoryAct[],
): TurnCatalogEntry[] {
  const acts = outlineActs ?? [];
  const turnMap = new Map<number, { user?: string; story?: string }>();
  for (const msg of history) {
    const existing = turnMap.get(msg.turn) ?? {};
    if (msg.role === 'user') existing.user = msg.content;
    else if (msg.role === 'assistant') existing.story = msg.content;
    turnMap.set(msg.turn, existing);
  }

  const sortedTurns = Array.from(turnMap.keys()).sort((a, b) => a - b);
  if (sortedTurns.length === 0) return [];

  // 构建幕区间表：优先用 destiny.actHistory 的真实 enteredTurn / exitedTurn
  const actHistory = destiny.actHistory ?? [];
  const rawCurrentActIndex = Number(destiny.currentActIndex);
  const safeCurrentActIndex = acts.length
    ? (Number.isInteger(rawCurrentActIndex) ? Math.max(0, Math.min(rawCurrentActIndex, acts.length - 1)) : 0)
    : 0;

  const resolveActForTurn = (turn: number): {
    actIndex: number;
    actId?: string;
    actTitle: string;
    actPurpose?: string;
  } => {
    if (actHistory.length > 0 && acts.length > 0) {
      for (const entry of actHistory) {
        const start = entry.enteredTurn ?? 0;
        const end = entry.exitedTurn ?? Number.POSITIVE_INFINITY;
        if (turn >= start && turn < end) {
          const idx = acts.findIndex((a) => a.id === entry.actId);
          if (idx >= 0) {
            return {
              actIndex: idx,
              actId: acts[idx].id,
              actTitle: acts[idx].title,
              actPurpose: acts[idx].purpose,
            };
          }
        }
      }
    }
    const fallbackAct = acts[safeCurrentActIndex];
    return {
      actIndex: safeCurrentActIndex,
      actId: fallbackAct?.id ?? destiny.currentActId,
      actTitle: fallbackAct?.title ?? (destiny.currentStage || '当前篇章'),
      actPurpose: fallbackAct?.purpose,
    };
  };

  let lastActIndex = -1;
  return sortedTurns.map((turn, idx) => {
    const pair = turnMap.get(turn) ?? {};
    const actInfo = resolveActForTurn(turn);
    const isActStart = idx === 0 || actInfo.actIndex !== lastActIndex;

    // 若本回合是新幕起点，查找上一幕退出时的 exitSummary
    let previousActExitSummary: string | undefined;
    if (isActStart && idx > 0 && actHistory.length > 0) {
      const exitedRecord = actHistory.find((h) => h.exitedTurn === turn);
      previousActExitSummary = exitedRecord?.exitSummary;
    }
    lastActIndex = actInfo.actIndex;

    const storyText = pair.story ?? '';
    return {
      turn,
      actIndex: actInfo.actIndex,
      actId: actInfo.actId,
      actTitle: actInfo.actTitle,
      actPurpose: actInfo.actPurpose,
      isActStart,
      previousActExitSummary,
      userAction: pair.user?.trim() || '（开篇 / 系统推进）',
      storyExcerpt: stripMarkdownSnippet(storyText, 82),
      storyFullText: storyText,
      charCount: storyText.replace(/\s+/g, '').length,
    };
  });
}

// ---------------------------------------------------------------------------
// 4. 章节/幕切换「卷首题跋」横幅（挂在回合外层，不侵入 StoryArticle DOM）
// ---------------------------------------------------------------------------

export function ActChapterBanner({ entry, totalActs }: {
  entry: TurnCatalogEntry;
  totalActs: number;
}) {
  const [summaryOpen, setSummaryOpen] = useState(false);
  const actLabel = toChineseActLabel(entry.actIndex);

  return (
    <div className="my-8 select-none animate-fade-in">
      {entry.previousActExitSummary && (
        <div className="mx-auto mb-4 max-w-2xl rounded-lg border border-gold/25 bg-parchment-900/60 px-4 py-2.5 text-xs text-parchment-200/70 shadow-inset-deep">
          <button
            type="button"
            onClick={() => setSummaryOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 text-left text-gold/85 hover:text-gold-light"
          >
            <span className="flex items-center gap-1.5 font-serif tracking-[0.16em]">
              <Sparkles size={12} /> 前卷回响 · 幕间纪要
            </span>
            {summaryOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
          {summaryOpen && (
            <p className="mt-2 border-t border-parchment-600/20 pt-2 font-serif leading-relaxed text-parchment-100/80">
              {entry.previousActExitSummary}
            </p>
          )}
        </div>
      )}

      <div className="relative overflow-hidden rounded-xl border border-gold/30 bg-gradient-to-b from-parchment-800/85 via-parchment-900/90 to-ink/95 px-5 py-4 text-center shadow-[0_6px_28px_rgba(0,0,0,0.45)]">
        {/* 顶底双金线 */}
        <div className="gold-line absolute inset-x-8 top-0 opacity-75" />
        <div className="gold-line-dim absolute inset-x-16 bottom-0 opacity-60" />

        <div className="flex items-center justify-center gap-3">
          <span className="h-px w-10 bg-gold-line opacity-60 sm:w-16" />
          <WaxSeal text={CHINESE_NUMERALS[entry.actIndex] ?? String(entry.actIndex + 1)} variant="gold" size={28} pressed />
          <span className="font-serif text-[11px] tracking-[0.32em] text-gold/80">
            {actLabel}{totalActs > 0 ? ` · 共${CHINESE_NUMERALS[totalActs - 1] ?? totalActs}幕` : ''}
          </span>
          <span className="h-px w-10 bg-gold-line opacity-60 sm:w-16" />
        </div>

        <h2 className="mt-2 font-serif text-lg tracking-[0.16em] text-gold-light sm:text-xl">
          《{entry.actTitle}》
        </h2>

        {entry.actPurpose && (
          <p className="mx-auto mt-1.5 max-w-xl font-serif text-xs leading-relaxed text-parchment-200/60">
            {entry.actPurpose}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. 顶栏阅读导航条 + 卷宗目录抽屉 + 右下角悬浮回到最新罗盘
// ---------------------------------------------------------------------------

export interface ReadingNavigatorProps {
  saveId: string;
  history: MessageV2[];
  destiny: DestinyProgressV2;
  outlineActs?: StoryAct[];
  currentTurn: number;
  activeVisibleTurn: number;
  scrollProgress: number;
  isScrolledUp: boolean;
  busy: boolean;
  prefs: ReaderPreferences;
  onUpdatePrefs: (patch: Partial<ReaderPreferences>) => void;
  bookmarks: number[];
  onToggleBookmark: (turn: number) => void;
  onJumpToTurn: (turn: number) => void;
  onJumpToLatest: () => void;
}

export function ReadingNavigator({
  history,
  destiny,
  outlineActs,
  currentTurn,
  activeVisibleTurn,
  scrollProgress,
  isScrolledUp,
  busy,
  prefs,
  onUpdatePrefs,
  bookmarks,
  onToggleBookmark,
  onJumpToTurn,
  onJumpToLatest,
}: ReadingNavigatorProps) {
  const [tocOpen, setTocOpen] = useState(false);
  const [typoOpen, setTypoOpen] = useState(false);
  const [filterTab, setFilterTab] = useState<'all' | 'bookmarks'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const catalog = useMemo(
    () => buildTurnCatalog(history, destiny, outlineActs),
    [history, destiny, outlineActs],
  );

  const totalWordCount = useMemo(
    () => catalog.reduce((sum, item) => sum + item.charCount, 0),
    [catalog],
  );

  const activeEntry = useMemo(
    () => catalog.find((item) => item.turn === activeVisibleTurn) ?? catalog[catalog.length - 1],
    [catalog, activeVisibleTurn],
  );

  const filteredCatalog = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return catalog.filter((item) => {
      if (filterTab === 'bookmarks' && !bookmarks.includes(item.turn)) return false;
      if (!q) return true;
      return (
        item.userAction.toLowerCase().includes(q)
        || item.storyFullText.toLowerCase().includes(q)
        || item.actTitle.toLowerCase().includes(q)
        || `第 ${item.turn + 1} 回合`.includes(q)
        || String(item.turn + 1) === q
      );
    });
  }, [catalog, filterTab, bookmarks, searchQuery]);

  if (catalog.length === 0) return null;

  const isCurrentBookmarked = bookmarks.includes(activeVisibleTurn);
  const turnsBehind = Math.max(0, (catalog[catalog.length - 1]?.turn ?? 0) - activeVisibleTurn);

  return (
    <>
      {/* 吸顶古卷阅读导览条 */}
      <div className="sticky top-16 z-10 mb-5 overflow-visible rounded-xl border border-gold/25 bg-parchment-900/90 shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 sm:px-4">
          {/* 左侧：当前视口所在的幕与回合 */}
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => setTocOpen(true)}
              className="group inline-flex items-center gap-2 rounded-lg border border-gold/30 bg-gold/10 px-2.5 py-1 text-xs text-gold-light transition hover:border-gold/60 hover:bg-gold/15"
              title="打开卷宗目录与回合跳转"
            >
              <LibraryBig size={13} className="text-gold transition-transform group-hover:scale-105" />
              <span className="font-serif tracking-[0.12em]">卷宗目录</span>
              <span className="rounded bg-ink/60 px-1.5 py-0.5 font-mono text-[10px] text-parchment-200/75">
                {catalog.length}回
              </span>
            </button>

            <div className="hidden h-3.5 w-px bg-parchment-600/35 sm:block" />

            <div className="min-w-0 truncate text-xs">
              <span className="text-parchment-200/50">正在阅览：</span>
              <span className="font-serif text-gold-light">
                第 {activeVisibleTurn + 1} 回合
              </span>
              {activeEntry && (
                <span className="ml-1.5 hidden text-parchment-200/55 md:inline">
                  · {toChineseActLabel(activeEntry.actIndex)}《{activeEntry.actTitle}》
                </span>
              )}
            </div>
          </div>

          {/* 右侧：快捷上/下回合、当前回合书签、字号版式、回到最新 */}
          <div className="flex items-center gap-1.5">
            <span className="mr-1 hidden font-mono text-[10px] text-parchment-200/40 xl:inline">
              全文 {(totalWordCount / 1000).toFixed(1)}k 字
            </span>

            {/* 上一回合 / 下一回合微调 */}
            <div className="inline-flex items-center rounded-md border border-parchment-600/30 bg-ink/35 p-0.5">
              <button
                type="button"
                disabled={activeVisibleTurn <= 0}
                onClick={() => onJumpToTurn(Math.max(0, activeVisibleTurn - 1))}
                className="rounded px-1.5 py-1 text-parchment-200/65 transition hover:bg-gold/10 hover:text-gold-light disabled:opacity-30"
                title="跳至上一回合"
              >
                <ArrowUp size={12} />
              </button>
              <span className="px-1.5 font-mono text-[10px] tabular-nums text-parchment-200/65">
                {activeVisibleTurn + 1}/{Math.max(currentTurn, catalog.length)}
              </span>
              <button
                type="button"
                disabled={activeVisibleTurn >= (catalog[catalog.length - 1]?.turn ?? 0)}
                onClick={() => onJumpToTurn(Math.min(catalog[catalog.length - 1]?.turn ?? 0, activeVisibleTurn + 1))}
                className="rounded px-1.5 py-1 text-parchment-200/65 transition hover:bg-gold/10 hover:text-gold-light disabled:opacity-30"
                title="跳至下一回合"
              >
                <ArrowDown size={12} />
              </button>
            </div>

            {/* 标记当前阅读回合为书签 */}
            <button
              type="button"
              onClick={() => onToggleBookmark(activeVisibleTurn)}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition ${
                isCurrentBookmarked
                  ? 'border-gold/65 bg-gold/15 text-gold-light shadow-glow-sm'
                  : 'border-parchment-600/30 bg-ink/30 text-parchment-200/60 hover:border-gold/40 hover:text-parchment-100'
              }`}
              title={isCurrentBookmarked ? '取消本回合书签' : '为本回合添加书签'}
            >
              <span>{isCurrentBookmarked ? '★' : '☆'}</span>
              <span className="hidden sm:inline">{isCurrentBookmarked ? '已签' : '书签'}</span>
              {bookmarks.length > 0 && (
                <span className="rounded-full bg-gold/20 px-1 text-[9px] text-gold-light">
                  {bookmarks.length}
                </span>
              )}
            </button>

            {/* 版式设置弹出按钮 */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setTypoOpen((v) => !v)}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition ${
                  typoOpen
                    ? 'border-gold/65 bg-gold/15 text-gold-light'
                    : 'border-parchment-600/30 bg-ink/30 text-parchment-200/60 hover:border-gold/40 hover:text-parchment-100'
                }`}
                title="调节字号、行距与版心宽度"
              >
                <SlidersHorizontal size={12} />
                <span className="hidden sm:inline">版式</span>
              </button>

              {typoOpen && (
                <div className="absolute right-0 top-full z-30 mt-2 w-64 rounded-xl border border-gold/35 bg-parchment-900/95 p-3.5 shadow-[0_14px_38px_rgba(0,0,0,0.75)] backdrop-blur-md animate-dialog-in">
                  <div className="mb-2.5 flex items-center justify-between border-b border-parchment-600/25 pb-2">
                    <span className="font-serif text-xs tracking-[0.15em] text-gold-light">古卷版式调节</span>
                    <button
                      type="button"
                      onClick={() => setTypoOpen(false)}
                      className="text-parchment-200/45 hover:text-parchment-100"
                    >
                      <X size={13} />
                    </button>
                  </div>

                  {/* 字号三档 */}
                  <div className="mb-3">
                    <div className="mb-1.5 text-[10px] tracking-[0.14em] text-parchment-200/50">正文字号</div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(['sm', 'md', 'lg'] as ReaderFontSize[]).map((sizeKey) => {
                        const active = prefs.fontSize === sizeKey;
                        return (
                          <button
                            key={sizeKey}
                            type="button"
                            onClick={() => onUpdatePrefs({ fontSize: sizeKey })}
                            className={`rounded-md border px-2 py-1.5 text-center text-xs transition ${
                              active
                                ? 'border-gold/70 bg-gold/15 text-gold-light'
                                : 'border-parchment-600/30 bg-ink/35 text-parchment-200/65 hover:border-gold/40'
                            }`}
                          >
                            {FONT_SIZE_MAP[sizeKey].label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 行距两档 */}
                  <div className="mb-3">
                    <div className="mb-1.5 text-[10px] tracking-[0.14em] text-parchment-200/50">段落呼吸感</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(['normal', 'relaxed'] as ReaderLineSpacing[]).map((spaceKey) => {
                        const active = prefs.lineSpacing === spaceKey;
                        return (
                          <button
                            key={spaceKey}
                            type="button"
                            onClick={() => onUpdatePrefs({ lineSpacing: spaceKey })}
                            className={`rounded-md border px-2 py-1.5 text-center text-xs transition ${
                              active
                                ? 'border-gold/70 bg-gold/15 text-gold-light'
                                : 'border-parchment-600/30 bg-ink/35 text-parchment-200/65 hover:border-gold/40'
                            }`}
                          >
                            {LINE_SPACING_MAP[spaceKey].label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 版心宽度 */}
                  <div>
                    <div className="mb-1.5 text-[10px] tracking-[0.14em] text-parchment-200/50">卷面宽度</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(['standard', 'focused'] as ReaderColumnWidth[]).map((colKey) => {
                        const active = prefs.columnWidth === colKey;
                        return (
                          <button
                            key={colKey}
                            type="button"
                            onClick={() => onUpdatePrefs({ columnWidth: colKey })}
                            className={`rounded-md border px-2 py-1.5 text-center text-xs transition ${
                              active
                                ? 'border-gold/70 bg-gold/15 text-gold-light'
                                : 'border-parchment-600/30 bg-ink/35 text-parchment-200/65 hover:border-gold/40'
                            }`}
                          >
                            {COLUMN_WIDTH_MAP[colKey].label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 底部 2px 阅读进度金线 */}
        <div className="relative h-[2px] w-full overflow-hidden bg-ink/80">
          <div
            className="h-full bg-gradient-to-r from-gold-dark via-gold to-gold-light transition-[width] duration-200 ease-out"
            style={{ width: `${Math.max(2, Math.min(100, Math.round(scrollProgress * 100)))}%` }}
          />
        </div>
      </div>

      {/* 右下角悬浮「回到最新」暗金罗盘：仅在玩家上翻远离底部时浮现 */}
      {isScrolledUp && (
        <div className="fixed bottom-28 right-6 z-20 flex items-center gap-1.5 rounded-full border border-gold/45 bg-parchment-900/95 p-1 pl-3 pr-2 text-xs text-parchment-100 shadow-[0_8px_28px_rgba(0,0,0,0.65),0_0_14px_rgba(201,165,102,0.2)] backdrop-blur-md animate-slide-up-in">
          <Compass size={14} className={`text-gold ${busy ? 'animate-spin' : ''}`} />
          <span className="font-serif text-[11px] text-parchment-200/80">
            {busy
              ? '新回合正在书写…'
              : turnsBehind > 0
                ? `距最新 · ${turnsBehind} 回合`
                : '正在翻阅上文'}
          </span>
          <button
            type="button"
            onClick={() => onJumpToTurn(0)}
            className="ml-1 rounded-full border border-parchment-600/35 bg-ink/50 px-2 py-1 text-[10px] text-parchment-200/70 transition hover:border-gold/50 hover:text-gold-light"
            title="跳回第 1 回合（卷首）"
          >
            卷首
          </button>
          <button
            type="button"
            onClick={onJumpToLatest}
            className="inline-flex items-center gap-1 rounded-full border border-gold/50 bg-gold/20 px-2.5 py-1 font-serif text-[11px] text-gold-light transition hover:bg-gold/30"
          >
            <ArrowDown size={12} /> 回到最新
          </button>
        </div>
      )}

      {/* 卷宗目录抽屉（Modal Drawer） */}
      {tocOpen && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/65 backdrop-blur-[2px] animate-fade-in">
          <div
            className="fixed inset-0"
            onClick={() => setTocOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-gold/30 bg-parchment-900/95 shadow-[-12px_0_40px_rgba(0,0,0,0.75)] animate-slide-in-right">
            {/* 抽屉头部 */}
            <div className="border-b border-parchment-600/30 px-5 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-serif text-base tracking-[0.14em] text-gold-light">
                  <ScrollText size={16} className="text-gold" />
                  <span>卷宗目录 · 回合纪要</span>
                </div>
                <button
                  type="button"
                  onClick={() => setTocOpen(false)}
                  className="rounded-full p-1 text-parchment-200/55 transition hover:bg-parchment-700/40 hover:text-gold-light"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="mt-1 flex items-center gap-3 text-[11px] text-parchment-200/50">
                <span>共 {catalog.length} 回合</span>
                <span>·</span>
                <span>累计 {totalWordCount.toLocaleString('zh-CN')} 字</span>
                <span>·</span>
                <span>已签 {bookmarks.length} 处</span>
              </div>

              {/* 搜索与过滤标签 */}
              <div className="mt-3 flex items-center gap-2">
                <div className="relative flex-1">
                  <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-parchment-200/40" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="检索回合、行动或正文关键词…"
                    className="w-full rounded-lg border border-parchment-600/40 bg-ink/55 py-1.5 pl-8 pr-7 text-xs text-parchment-100 outline-none transition focus:border-gold/70 placeholder:text-parchment-200/35"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-parchment-200/40 hover:text-parchment-100"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>

                <div className="flex shrink-0 rounded-lg border border-parchment-600/35 bg-ink/40 p-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setFilterTab('all')}
                    className={`rounded-md px-2.5 py-1 transition ${
                      filterTab === 'all' ? 'bg-gold/20 text-gold-light' : 'text-parchment-200/55 hover:text-parchment-100'
                    }`}
                  >
                    全部
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterTab('bookmarks')}
                    className={`rounded-md px-2.5 py-1 transition ${
                      filterTab === 'bookmarks' ? 'bg-gold/20 text-gold-light' : 'text-parchment-200/55 hover:text-parchment-100'
                    }`}
                  >
                    ★ 书签 ({bookmarks.length})
                  </button>
                </div>
              </div>
            </div>

            {/* 抽屉主体：按回合与幕展示 */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
              {filteredCatalog.length === 0 ? (
                <div className="py-16 text-center text-xs text-parchment-200/45">
                  {filterTab === 'bookmarks'
                    ? '尚未标记任何回合书签。阅读时点击顶栏「☆ 书签」即可收录关键回合。'
                    : '未找到匹配该关键词的回合记录。'}
                </div>
              ) : (
                filteredCatalog.map((item) => {
                  const isCurrent = item.turn === activeVisibleTurn;
                  const isBookmarked = bookmarks.includes(item.turn);
                  return (
                    <div key={item.turn}>
                      {item.isActStart && !searchQuery && filterTab === 'all' && (
                        <OrnateDivider className="!my-3 text-[11px] tracking-[0.2em] text-gold/80">
                          {toChineseActLabel(item.actIndex)} · 《{item.actTitle}》
                        </OrnateDivider>
                      )}
                      <div
                        className={`group relative rounded-xl border p-3 transition ${
                          isCurrent
                            ? 'border-gold/65 bg-gold/10 shadow-glow-sm'
                            : 'border-parchment-600/25 bg-ink/30 hover:border-gold/40 hover:bg-parchment-800/45'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              onJumpToTurn(item.turn);
                              setTocOpen(false);
                            }}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          >
                            <span className={`font-serif text-xs tracking-[0.14em] ${isCurrent ? 'text-gold-light font-semibold' : 'text-gold/80'}`}>
                              第 {item.turn + 1} 回合
                            </span>
                            {isCurrent && (
                              <span className="rounded border border-gold/45 bg-gold/15 px-1.5 py-0.5 text-[9px] text-gold-light">
                                当前视口
                              </span>
                            )}
                            <span className="ml-auto font-mono text-[10px] text-parchment-200/40">
                              {item.charCount} 字
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => onToggleBookmark(item.turn)}
                            className={`rounded p-1 text-xs transition ${
                              isBookmarked
                                ? 'text-gold-light'
                                : 'text-parchment-200/30 hover:text-gold/80'
                            }`}
                            title={isBookmarked ? '移除书签' : '加入书签'}
                          >
                            {isBookmarked ? '★' : '☆'}
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            onJumpToTurn(item.turn);
                            setTocOpen(false);
                          }}
                          className="mt-1.5 block w-full text-left"
                        >
                          <div className="truncate font-serif text-xs italic text-parchment-100/85">
                            「{item.userAction}」
                          </div>
                          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-parchment-200/55">
                            {item.storyExcerpt}
                          </p>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* 抽屉底栏：快速跳至卷首 / 卷末 */}
            <div className="flex items-center justify-between border-t border-parchment-600/30 bg-ink/40 px-5 py-3 text-xs">
              <button
                type="button"
                onClick={() => {
                  onJumpToTurn(0);
                  setTocOpen(false);
                }}
                className="inline-flex items-center gap-1.5 text-parchment-200/70 transition hover:text-gold-light"
              >
                <BookOpen size={13} /> 回到开篇（第 1 回合）
              </button>
              <button
                type="button"
                onClick={() => {
                  onJumpToLatest();
                  setTocOpen(false);
                }}
                className="inline-flex items-center gap-1.5 text-gold-light transition hover:underline"
              >
                <Feather size={13} /> 直达最新回合
                <Check size={12} />
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}