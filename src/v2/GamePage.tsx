import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Clock3,
  Compass,
  Download,
  Loader2,
  Package,
  Pencil,
  RotateCcw,
  ScrollText,
  Settings,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { confirmDialog } from '@/components/ui/ConfirmDialog';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import { UpdateGlow } from '@/components/ui/UpdateGlow';
import { useSettingsStore } from '@/store/useSettingsStore';
import { readDraft, writeDraft } from './draft';
import { runTurnSettlementV2, runTurnV2, TurnPostFailureV2 } from './engine';
import { ModelActivityPanel } from './ModelActivityPanel';
import {
  ActChapterBanner,
  buildTurnCatalog,
  ReadingNavigator,
  useReaderPreferences,
  useTurnBookmarks,
} from './ReadingNavigator';
import { diffSidePanelChanges, toChangeMap, type SidePanelChangeKind } from './sidePanelUpdates';
import { useActiveSaveV2, useGameStoreV2 } from './store';
import type {
  CharacterV2,
  DestinyProgressV2,
  GameStateV2,
  MessageV2,
  ModelActivityV2,
  ModelPhaseV2,
  NarrativePaceV2,
  RandomEventIntensityV2,
  RandomEventResolutionV2,
  RandomEventTargetKindV2,
  RelationshipV2,
  StoryAutonomyV2,
  StoryBeatRuntimeV2,
  StoryThreadV2,
  TurnPartialV2,
  TurnRecordV2,
} from './types';
import type { StoryAct } from '@/types/content';

const PACE_OPTIONS: Array<{ id: NarrativePaceV2; label: string; hint: string }> = [
  { id: 'slow', label: '慢叙事', hint: '细致到每个动作，只推进很小节拍' },
  { id: 'standard', label: '标准', hint: '完成一次主要行动或一个场景' },
  { id: 'fast', label: '快叙事', hint: '按事件发展推进一组行动' },
  { id: 'timeskip', label: '时间跨越', hint: '概述数天以上，保留关键节点' },
];

/** 故事推进权限：与叙事速度解耦，控制模型能自己把故事推多远。 */
const AUTONOMY_OPTIONS: Array<{ id: StoryAutonomyV2; label: string; hint: string }> = [
  { id: 'strict', label: '严格遵循', hint: '玩家说到哪就写到哪，不自行推进剧情' },
  { id: 'standard', label: '标准推进', hint: '承接行动后沿主线自然推进一小步' },
  { id: 'free', label: '自由发散', hint: '允许模型自行安排场景推进与情节转折' },
];

const BEAT_STATUS: Record<StoryBeatRuntimeV2['status'], string> = {
  pending: '未展开',
  available: '条件成熟',
  active: '进行中',
  satisfied: '已完成',
  weakened: '影响减弱',
  reframed: '路线改写',
  superseded: '等价承接',
};

const THREAD_STATUS: Record<StoryThreadV2['status'], string> = {
  candidate: '候选',
  active: '进行中',
  completed: '已完成',
  failed: '已失败',
  cancelled: '已取消',
};

const CHARACTER_STATUS: Record<CharacterV2['status'], string> = {
  active: '活跃',
  absent: '暂离',
  missing: '失踪',
  dead: '死亡',
  unknown: '未知',
};

// 随机事件三态/强度/绑定目标的界面标签（D7）：玩家看到的应是语义，而不是协议枚举值。
const RANDOM_EVENT_INTENSITY: Record<RandomEventIntensityV2, string> = {
  related: '相关',
  progress: '推进',
  destiny: '命运',
};

const RANDOM_EVENT_RESOLUTION: Record<RandomEventResolutionV2, string> = {
  resolved: '已兑现',
  ongoing_hook: '留钩子',
  interrupted: '被打断',
};

const RANDOM_EVENT_TARGET_KIND: Record<RandomEventTargetKindV2, string> = {
  beat: '故事节',
  thread: '线程',
  relationship: '关系',
  reconvergence: '命运锚',
};

const clampAffinity = (value: number) => Math.max(-100, Math.min(100, Math.round(value) || 0));

function cleanError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return '本次生成已取消。';
  const message = error instanceof Error ? error.message : String(error);
  if (/^模型请求失败/.test(message)) return message;
  if (/401|unauthorized|api key|认证/i.test(message)) return `模型请求失败：API Key无效或没有访问权限。\n${message}`;
  if (/429|rate limit|频率|额度/i.test(message)) return `模型请求失败：请求过于频繁或账户额度不足，请稍后重试。\n${message}`;
  if (/fetch|network|terminated|连接|timeout|超时/i.test(message)) return `模型请求失败：网络连接中断，请检查网络或代理后重试。\n${message}`;
  if (/HTTP|响应|JSON|解析/i.test(message)) return `模型请求失败：${message}`;
  return `本回合处理失败：${message}`;
}

interface QueuedTurn {
  id: string;
  input: string;
  pace: NarrativePaceV2;
  createdAt: number;
}

function createQueueId(): string {
  return `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function DestinyCard({
  destiny,
  showDetails,
  outlineActs,
}: {
  destiny: DestinyProgressV2;
  showDetails: boolean;
  outlineActs?: StoryAct[];
}) {
  const [open, setOpen] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const completion = Math.max(0, Math.min(100, Math.round(Number(destiny.completionEstimate) || 0)));
  // 幕进展：程序权威 currentActIndex + 大纲幕标题优先；缺大纲时退回模型自由文本 currentStage。
  // 旧存档的 currentActIndex 可能是 undefined 或越界，一律收敛到合法范围，避免渲染出「幕 NaN/0」。
  const acts = outlineActs ?? [];
  const rawActIndex = Number(destiny.currentActIndex);
  const currentActIndex = acts.length
    ? Number.isInteger(rawActIndex)
      ? Math.max(0, Math.min(rawActIndex, acts.length - 1))
      : 0
    : 0;
  const currentAct = acts[currentActIndex];
  const actProgress = currentAct
    ? `幕 ${currentActIndex + 1}/${acts.length} · 《${currentAct.title}》`
    : destiny.currentStage || '尚未定位';

  /** 挂账来源用大纲反查幕序号；大纲里找不到时退化为「前幕」。 */
  const carriedLabel = (carriedFromActId?: string): string => {
    if (!carriedFromActId) return '';
    const index = acts.findIndex((act) => act.id === carriedFromActId);
    return index >= 0 ? `挂账自第 ${index + 1} 幕` : '挂账自前幕';
  };

  // 默认只展示已经发生的故事节，避免把未来路径提前剧透；
  // 开启“故事推进详情”后，展示全部故事节、下一里程碑与收敛计划。
  const beats = showDetails
    ? destiny.beats ?? []
    : (destiny.beats ?? []).filter(
        (b) =>
          b.status === 'active'
          || b.status === 'satisfied'
          || b.status === 'weakened'
          || b.status === 'reframed'
          || b.status === 'superseded',
      );

  return (
    <section className="relative overflow-hidden rounded-xl border border-gold/30 bg-gradient-to-b from-parchment-900/65 to-ink/75 p-4 shadow-[0_8px_30px_rgba(0,0,0,.28)]">
      <div className="gold-line-dim absolute inset-x-6 top-0 opacity-60" />

      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-serif text-sm tracking-[.16em] text-gold-light">
            <Sparkles size={14} className="text-gold" />
            <span>命运线 · 命盘刻度</span>
          </div>
          <div className="mt-1 text-xs text-parchment-200/50">依附于已发生的事件，随自由路线汇合演进</div>
        </div>
        <div className="text-right">
          <div className="font-mono text-lg tabular-nums text-gold-light">{completion}%</div>
          {destiny.endingReached && (
            <div className="rounded border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[10px] text-gold-light">
              ✦ 终局曾达成
            </div>
          )}
        </div>
      </div>

      {/* 命盘刻度进度条（带 25% / 50% / 75% 古铜星位刻度） */}
      <div className="relative mt-3 h-2 overflow-hidden rounded-full border border-parchment-600/35 bg-ink/90">
        <div
          className="h-full rounded-full bg-gradient-to-r from-gold-dark via-gold to-gold-light shadow-glow-sm transition-all duration-500"
          style={{ width: `${completion}%` }}
        />
        <span className="pointer-events-none absolute inset-y-0 left-1/4 w-px bg-parchment-400/25" />
        <span className="pointer-events-none absolute inset-y-0 left-2/4 w-px bg-parchment-400/25" />
        <span className="pointer-events-none absolute inset-y-0 left-3/4 w-px bg-parchment-400/25" />
      </div>

      {/* 当前幕与当前路径铭牌 */}
      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <div className="rounded-lg border border-parchment-600/20 bg-ink/35 px-2.5 py-2">
          <span className="text-[10px] tracking-wider text-parchment-200/45">当前幕序</span>
          <p className="mt-0.5 truncate font-serif text-parchment-100" title={actProgress}>
            {actProgress}
          </p>
          {currentAct && destiny.currentStage && destiny.currentStage !== currentAct.title && (
            <p className="mt-0.5 truncate text-[10px] text-parchment-200/40" title={destiny.currentStage}>
              {destiny.currentStage}
            </p>
          )}
        </div>
        <div className="rounded-lg border border-parchment-600/20 bg-ink/35 px-2.5 py-2">
          <span className="text-[10px] tracking-wider text-parchment-200/45">当前路径</span>
          <p className="mt-0.5 truncate font-serif text-parchment-100" title={destiny.currentPath}>
            {destiny.currentPath || '自由发展'}
          </p>
        </div>
      </div>

      {showDetails && destiny.nextMilestone && (
        <div className="mt-2.5 grid gap-2 text-xs sm:grid-cols-2">
          <div className="rounded-lg border border-gold/20 bg-gold/5 px-2.5 py-1.5">
            <span className="text-[10px] text-gold/70">下一里程碑</span>
            <p className="mt-0.5 truncate text-parchment-100" title={destiny.nextMilestone}>
              {destiny.nextMilestone}
            </p>
          </div>
          {destiny.convergencePlan && (
            <div className="rounded-lg border border-gold/20 bg-gold/5 px-2.5 py-1.5">
              <span className="text-[10px] text-gold/70">收敛计划</span>
              <p className="mt-0.5 truncate text-parchment-100" title={destiny.convergencePlan}>
                {destiny.convergencePlan}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-3">
        {destiny.completionReason && (
          <button
            type="button"
            onClick={() => setReasonOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-xs text-gold/75 transition hover:text-gold-light"
          >
            {reasonOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {reasonOpen ? '收起完成度说明' : '当前完成度说明'}
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-xs text-gold/75 transition hover:text-gold-light"
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {open ? '收起故事节' : `展开故事节（${beats.length}）`}
        </button>
      </div>

      {reasonOpen && destiny.completionReason && (
        <p className="mt-2 border-t border-parchment-600/15 pt-2 text-xs leading-relaxed text-parchment-200/70">
          {destiny.completionReason}
        </p>
      )}

      {open && (
        <div className="mt-2 space-y-1.5 border-t border-parchment-600/15 pt-2 text-xs">
          {beats.length ? (
            beats.map((beat) => {
              const carried = carriedLabel(beat.carriedFromActId);
              const isSatisfied = beat.status === 'satisfied' || beat.status === 'superseded';
              return (
                <div
                  key={beat.beatId}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded border border-parchment-600/15 bg-ink/25 px-2 py-1.5"
                >
                  <span className="min-w-0 flex-1 text-parchment-100">
                    {showDetails
                      ? beat.evidenceSummary || beat.currentPlan || '尚未展开。'
                      : beat.evidenceSummary || '本故事节已在正文中发生。'}
                  </span>
                  {carried && (
                    <span className="shrink-0 rounded border border-ember/45 bg-ember/10 px-1.5 py-0.5 text-[10px] text-ember-light">
                      {carried}
                    </span>
                  )}
                  <span
                    className={`shrink-0 text-[11px] ${
                      isSatisfied ? 'text-moss-light' : 'text-gold/80'
                    }`}
                  >
                    {BEAT_STATUS[beat.status]}
                  </span>
                </div>
              );
            })
          ) : (
            <span className="text-parchment-200/45">尚未发生可展示的故事节。</span>
          )}
        </div>
      )}
    </section>
  );
}

function CharacterCard({
  saveId,
  character,
  canEdit,
  blockId,
}: {
  saveId: string;
  character: CharacterV2;
  canEdit: boolean;
  blockId?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState(character.role ?? '');
  const [description, setDescription] = useState(character.description ?? '');

  const persist = (patch: Partial<Pick<CharacterV2, 'role' | 'description'>>) => {
    useGameStoreV2.getState().update(saveId, (s) => ({
      ...s,
      state: {
        ...s.state,
        characters: s.state.characters.map((c) => (c.id === character.id ? { ...c, ...patch } : c)),
      },
    }));
  };
  const save = () => {
    persist({ role: role.trim() || undefined, description: description.trim() || undefined });
    setEditing(false);
  };
  const clearIntro = () => {
    setRole('');
    setDescription('');
    persist({ role: undefined, description: undefined });
    setEditing(false);
  };
  const removeCharacter = async () => {
    const ok = await confirmDialog({
      title: '删除人物？',
      message: `将从状态中删除“${character.name}”，并同步移除涉及该人物的关系、正史事实与故事线程参与记录。`,
      confirmText: '删除',
      variant: 'danger',
    });
    if (!ok) return;
    useGameStoreV2.getState().update(saveId, (s) => ({
      ...s,
      state: {
        ...s.state,
        characters: s.state.characters.filter((c) => c.id !== character.id),
        relationships: s.state.relationships.filter((r) => r.fromId !== character.id && r.toId !== character.id),
        facts: s.state.facts.filter((f) => f.subjectId !== character.id),
        storyThreads: s.state.storyThreads.map((t) => ({
          ...t,
          involvedCharacterIds: t.involvedCharacterIds.filter((id) => id !== character.id),
        })),
      },
    }));
  };

  return (
    <div data-block={blockId} className="rounded-lg border border-parchment-600/20 bg-ink/20 p-3">
      <div className="flex items-center justify-between">
        <span className="text-gold-light">{character.name}</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-parchment-200/45">{CHARACTER_STATUS[character.status] ?? character.status}</span>
          {canEdit && (
            <button
              type="button"
              onClick={() => {
                setRole(character.role ?? '');
                setDescription(character.description ?? '');
                setEditing((v) => !v);
              }}
              className="rounded p-1 text-parchment-200/45 transition hover:bg-gold/10 hover:text-gold-light"
              title={editing ? '取消编辑' : '编辑介绍'}
            >
              <Pencil size={12} />
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => void removeCharacter()}
              className="rounded p-1 text-parchment-200/45 transition hover:bg-blood/15 hover:text-blood"
              title="删除人物"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <input
            value={role}
            onChange={(event) => setRole(event.target.value)}
            placeholder="角色定位（可选）"
            className="w-full rounded border border-parchment-600/40 bg-ink/50 px-2 py-1.5 text-xs text-parchment-100 outline-none focus:border-gold/70"
          />
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="人物介绍"
            rows={3}
            className="w-full resize-y rounded border border-parchment-600/40 bg-ink/50 px-2 py-1.5 text-xs leading-5 text-parchment-100 outline-none focus:border-gold/70"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              className="rounded border border-gold/40 bg-gold/10 px-2 py-1 text-[11px] text-gold-light hover:bg-gold/20"
            >
              保存
            </button>
            <button
              type="button"
              onClick={clearIntro}
              className="rounded border border-parchment-500/40 px-2 py-1 text-[11px] text-parchment-200/70 hover:bg-parchment-700/40"
            >
              清除介绍
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-1 text-xs text-parchment-200/60">{character.role || character.description || '尚无详细资料'}</div>
      )}
      {!editing && character.knownFacts.length > 0 && (
        <div className="mt-2 space-y-0.5 text-[11px] text-parchment-200/50">
          {character.knownFacts.slice(-3).map((fact, i) => (
            <div key={`${character.id}-f-${i}`}>· {fact}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function RelationshipRow({
  saveId,
  relationship,
  canEdit,
  nameById,
  blockId,
}: {
  saveId: string;
  relationship: RelationshipV2;
  canEdit: boolean;
  nameById: (id: string) => string;
  blockId?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [affinity, setAffinity] = useState(String(relationship.affinity));
  const [label, setLabel] = useState(relationship.label ?? '');
  const [note, setNote] = useState(relationship.note ?? '');

  const save = () => {
    useGameStoreV2.getState().update(saveId, (s) => ({
      ...s,
      state: {
        ...s.state,
        relationships: s.state.relationships.map((r) =>
          r.id === relationship.id
            ? {
                ...r,
                affinity: clampAffinity(Number(affinity) || 0),
                label: label.trim() || undefined,
                note: note.trim() || undefined,
              }
            : r,
        ),
      },
    }));
    setEditing(false);
  };
  const remove = () => {
    useGameStoreV2.getState().update(saveId, (s) => ({
      ...s,
      state: {
        ...s.state,
        relationships: s.state.relationships.filter((r) => r.id !== relationship.id),
      },
    }));
  };

  return (
    <div data-block={blockId} className="rounded border border-parchment-600/15 bg-ink/10 px-2.5 py-1.5 text-xs text-parchment-200/70">
      {editing ? (
        <div className="space-y-2">
          <div className="text-parchment-100">
            {nameById(relationship.fromId)} → {nameById(relationship.toId)}
          </div>
          <label className="block">
            <span className="text-[10px] text-parchment-200/45">好感</span>
            <input
              type="number"
              value={affinity}
              onChange={(event) => setAffinity(event.target.value)}
              className="mt-0.5 w-full rounded border border-parchment-600/40 bg-ink/50 px-2 py-1.5 text-xs text-parchment-100 outline-none focus:border-gold/70"
            />
          </label>
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="关系标签（可选）"
            className="w-full rounded border border-parchment-600/40 bg-ink/50 px-2 py-1.5 text-xs text-parchment-100 outline-none focus:border-gold/70"
          />
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="备注（可选）"
            className="w-full rounded border border-parchment-600/40 bg-ink/50 px-2 py-1.5 text-xs text-parchment-100 outline-none focus:border-gold/70"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              className="rounded border border-gold/40 bg-gold/10 px-2 py-1 text-[11px] text-gold-light hover:bg-gold/20"
            >
              保存
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded border border-parchment-500/40 px-2 py-1 text-[11px] text-parchment-200/70 hover:bg-parchment-700/40"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className="text-parchment-100">{nameById(relationship.fromId)}</span>
            <span className="mx-1 text-parchment-200/40">→</span>
            <span className="text-parchment-100">{nameById(relationship.toId)}</span>
            {relationship.label && <span className="ml-2 text-gold/70">{relationship.label}</span>}
            <span className="ml-2 text-parchment-200/50">
              好感 {relationship.affinity > 0 ? `+${relationship.affinity}` : relationship.affinity}
            </span>
          </div>
          {canEdit && (
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={() => {
                  setAffinity(String(relationship.affinity));
                  setLabel(relationship.label ?? '');
                  setNote(relationship.note ?? '');
                  setEditing(true);
                }}
                className="rounded p-1 text-parchment-200/45 transition hover:bg-gold/10 hover:text-gold-light"
                title="编辑关系"
              >
                <Pencil size={12} />
              </button>
              <button
                type="button"
                onClick={remove}
                className="rounded p-1 text-parchment-200/45 transition hover:bg-blood/15 hover:text-blood"
                title="删除关系"
              >
                <X size={12} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 故事正文的渲染：流式进行中与最终落盘**共用同一个组件**。
 *
 * 【重要契约】严禁修改本组件返回的标签骨架（tests/storyArticle.test.ts 会用
 * renderToStaticMarkup 断言流式与落盘 DOM 同构、且仅落盘态带 `prose-story--settled`）。
 * 任何回合级锚点或章节题跋都挂在本组件外层。
 */
export function StoryArticle({
  turn,
  content,
  writing = false,
  settled = false,
}: {
  turn: number;
  content: string;
  writing?: boolean;
  settled?: boolean;
}) {
  return (
    <article className="prose-story my-8">
      <div className="mb-3 flex items-center gap-2 text-[10px] tracking-[.3em] text-parchment-200/35">
        <span className="h-px flex-1 bg-gold-line opacity-50" />
        <span className={writing ? 'text-gold/70 animate-pulse-soft' : undefined}>
          {writing ? '故事之笔正在书写…' : `第 ${turn + 1} 回合`}
        </span>
        <span className="h-px flex-1 bg-gold-line opacity-50" />
      </div>
      <div className={settled ? 'prose-story--settled' : undefined}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </article>
  );
}

function SidePanel({ save, canEdit }: { save: NonNullable<ReturnType<typeof useActiveSaveV2>>; canEdit: boolean }) {
  const [tab, setTab] = useState<'people' | 'world' | 'items' | 'threads'>('people');
  const [factsOpen, setFactsOpen] = useState(false);
  const tabs = [
    { id: 'people' as const, label: '人物', icon: <Users size={14} /> },
    { id: 'world' as const, label: '世界', icon: <Compass size={14} /> },
    { id: 'items' as const, label: '背包', icon: <Package size={14} /> },
    { id: 'threads' as const, label: '故事', icon: <ScrollText size={14} /> },
  ];

  // 本回合哪些块发生了变化（含"新出现的块"）。用 ref 保存上一帧状态做对比：
  // 对比本身是纯函数（sidePanelUpdates.ts），这里只负责驱动特效播放。
  const [changes, setChanges] = useState<Map<string, SidePanelChangeKind>>(() => new Map());
  const previousStateRef = useRef<GameStateV2>();
  useEffect(() => {
    const previous = previousStateRef.current;
    previousStateRef.current = save.state;
    if (!previous) return;
    setChanges(toChangeMap(diffSidePanelChanges(previous, save.state)));
  }, [save.state]);
  // 特效只播一次：变化列表消费掉之后清空，避免块在后续重渲染里反复重播。
  useEffect(() => {
    if (changes.size === 0) return;
    const timer = window.setTimeout(() => setChanges(new Map()), 2450);
    return () => window.clearTimeout(timer);
  }, [changes]);

  const characterName = (id: string) =>
    id === 'player' ? '主角' : save.state.characters.find((c) => c.id === id)?.name ?? id;
  // 「故事脉动」卡的数据源（D7）：最近的滚动事件历史与待兑现绑定。
  const recentRandomEvents = (save.state.randomEvent.history ?? []).slice(-3);
  const activeBinding = save.state.randomEvent.activeBinding;
  const randomPending = save.state.randomEvent.enabled !== false && save.state.randomEvent.pending;

  return (
    <aside className="space-y-4 lg:sticky lg:top-[76px] lg:max-h-[calc(100vh-92px)] lg:overflow-auto pr-0.5">
      <UpdateGlow blockId="destiny" change={changes.get('destiny')}>
        <DestinyCard destiny={save.state.destiny} showDetails={canEdit} outlineActs={save.outline?.acts} />
      </UpdateGlow>

      <section className="overflow-hidden rounded-xl border border-parchment-600/25 bg-parchment-900/35">
        <div className="flex border-b border-parchment-600/20">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`flex flex-1 items-center justify-center gap-1 py-3 text-xs transition ${
                tab === item.id
                  ? 'border-b-2 border-gold text-gold-light'
                  : 'text-parchment-200/55 hover:text-parchment-100'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
        <div className="p-3 text-sm">
          {tab === 'people' && (
            <div className="space-y-3">
              {save.state.characters.length ? (
                save.state.characters.map((c) => (
                  <UpdateGlow key={c.id} blockId={`character:${c.id}`} change={changes.get(`character:${c.id}`)}>
                    <CharacterCard blockId={`character:${c.id}`} saveId={save.id} character={c} canEdit={canEdit} />
                  </UpdateGlow>
                ))
              ) : (
                <p className="text-xs text-parchment-200/45">故事人物将在正文中出现。</p>
              )}
              {save.state.relationships.length > 0 && (
                <div className="border-t border-parchment-600/15 pt-3">
                  <div className="mb-2 text-xs text-parchment-200/45">关系</div>
                  <div className="space-y-1.5">
                    {save.state.relationships.map((rel) => (
                      <UpdateGlow
                        key={rel.id}
                        blockId={`relationship:${rel.id}`}
                        change={changes.get(`relationship:${rel.id}`)}
                      >
                        <RelationshipRow
                          blockId={`relationship:${rel.id}`}
                          saveId={save.id}
                          relationship={rel}
                          canEdit={canEdit}
                          nameById={characterName}
                        />
                      </UpdateGlow>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'world' && (
            <div className="space-y-3">
              {save.state.currentScene && (
                <UpdateGlow blockId="scene" change={changes.get('scene')}>
                  <div data-block="scene">
                    <div className="text-xs text-parchment-200/45">当前场景</div>
                    <div className="mt-1 text-gold-light">{save.state.currentScene.name}</div>
                    <p className="mt-1 text-xs leading-relaxed text-parchment-200/65">
                      {save.state.currentScene.description}
                    </p>
                    <div className="mt-2 text-[11px] text-parchment-200/45">
                      {[save.state.currentScene.time, save.state.currentScene.weather].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                </UpdateGlow>
              )}
              <UpdateGlow blockId="progress" change={changes.get('progress')}>
                <div data-block="progress" className="border-t border-parchment-600/15 pt-3">
                  <div className="text-xs text-parchment-200/45">最新进展</div>
                  <p className="mt-1 text-xs leading-relaxed text-parchment-200/70">
                    {save.state.latestProgress || save.state.summary || '故事刚刚开始。'}
                  </p>
                </div>
              </UpdateGlow>
              {save.state.facts.length > 0 && (
                <div className="border-t border-parchment-600/15 pt-3">
                  <button
                    type="button"
                    onClick={() => setFactsOpen((v) => !v)}
                    className="flex w-full items-center justify-between text-xs text-parchment-200/45 hover:text-parchment-100"
                  >
                    <span>正史事实（{save.state.facts.length}）</span>
                    {factsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>
                  {factsOpen && (
                    <div className="mt-2 space-y-1.5">
                      {save.state.facts.map((fact) => (
                        <UpdateGlow key={fact.id} blockId={`fact:${fact.id}`} change={changes.get(`fact:${fact.id}`)}>
                          <div
                            data-block={`fact:${fact.id}`}
                            className="rounded border border-parchment-600/15 bg-ink/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-parchment-200/70"
                          >
                            <span className="text-parchment-100">{fact.subjectId}</span>
                            <span className="mx-1 text-parchment-200/40">·</span>
                            {fact.predicate}
                            <span className="mx-1 text-parchment-200/40">=</span>
                            {fact.value}
                          </div>
                        </UpdateGlow>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === 'items' && (
            <div className="space-y-2">
              {save.state.inventory.length ? (
                save.state.inventory.map((item) => (
                  <UpdateGlow key={item.id} blockId={`item:${item.id}`} change={changes.get(`item:${item.id}`)}>
                    <div
                      data-block={`item:${item.id}`}
                      className="flex items-start justify-between rounded-lg border border-parchment-600/20 p-2.5"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-parchment-100">{item.name}</span>
                          {item.consumable && (
                            <span className="rounded border border-gold/30 bg-gold/5 px-1.5 py-0.5 text-[10px] text-gold/75">
                              消耗品
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-parchment-200/50">{item.description || item.kind}</div>
                      </div>
                      <span className="text-gold-light">×{item.quantity}</span>
                    </div>
                  </UpdateGlow>
                ))
              ) : (
                <p className="text-xs text-parchment-200/45">暂无物品。</p>
              )}
            </div>
          )}

          {tab === 'threads' && (
            <div className="space-y-2">
              {save.state.storyThreads.length ? (
                save.state.storyThreads.map((thread) => (
                  <UpdateGlow key={thread.id} blockId={`thread:${thread.id}`} change={changes.get(`thread:${thread.id}`)}>
                    <div data-block={`thread:${thread.id}`} className="rounded-lg border border-parchment-600/20 p-2.5">
                      <div className="flex justify-between gap-2">
                        <span className="text-parchment-100">{thread.title}</span>
                        <span className="text-[10px] text-gold/70">{THREAD_STATUS[thread.status] ?? thread.status}</span>
                      </div>
                      {thread.currentStep && <p className="mt-1 text-xs text-parchment-200/60">{thread.currentStep}</p>}
                      {thread.progress !== undefined && (
                        <div className="mt-2 flex items-center gap-2">
                          <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink/60">
                            <div
                              className="h-full rounded-full bg-gold/60"
                              style={{ width: `${Math.max(0, Math.min(100, thread.progress))}%` }}
                            />
                          </div>
                          <span className="text-[10px] tabular-nums text-parchment-200/45">
                            {Math.max(0, Math.min(100, Math.round(thread.progress)))}%
                          </span>
                        </div>
                      )}
                    </div>
                  </UpdateGlow>
                ))
              ) : (
                <p className="text-xs text-parchment-200/45">故事线索将在推进后出现。</p>
              )}
            </div>
          )}
        </div>
      </section>

      <UpdateGlow blockId="randomEvent" change={changes.get('randomEvent')}>
        <div
          data-block="randomEvent"
          className="rounded-xl border border-parchment-600/25 bg-ink/25 p-3.5 text-xs text-parchment-200/55"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 font-serif text-parchment-100">
              <span
                className={`h-2 w-2 rounded-full ${
                  save.state.randomEvent.enabled === false
                    ? 'bg-parchment-600/40'
                    : randomPending
                      ? 'bg-ember-light animate-pulse shadow-[0_0_8px_#e08043]'
                      : activeBinding
                        ? 'bg-gold-light animate-pulse'
                        : 'bg-moss-light/80'
                }`}
              />
              <span>故事脉动</span>
            </span>
            <span className="text-[11px] text-gold/80">
              {save.state.randomEvent.enabled === false
                ? '随机事件已关闭'
                : randomPending
                  ? '新的风波正在靠近'
                  : '命运沿当前路径流动'}
            </span>
          </div>

          {/* 待兑现绑定：写前规划已绑定、等待结算兑现的事件目标 */}
          {activeBinding && (
            <div className="mt-2.5 rounded-lg border border-gold/25 bg-gold/5 px-2.5 py-2 leading-relaxed text-parchment-200/75">
              <span className="text-gold-light">✦ 待兑现绑定：</span>
              {RANDOM_EVENT_TARGET_KIND[activeBinding.targetKind] ?? activeBinding.targetKind}{' '}
              <span className="font-mono text-[10px] text-parchment-200/45">{activeBinding.targetId}</span>
              {activeBinding.summary ? ` · ${activeBinding.summary}` : ''}
            </div>
          )}

          {/* 滚动事件历史：最近 3 条 */}
          {recentRandomEvents.length > 0 && (
            <div className="mt-2.5 border-t border-parchment-600/15 pt-2">
              <div className="text-[10px] tracking-wider text-parchment-200/40">近期脉动轨迹</div>
              <div className="mt-1.5 space-y-1.5 border-l border-gold/25 pl-2.5 leading-relaxed text-parchment-200/65">
                {recentRandomEvents.map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-mono text-[10px] tabular-nums text-parchment-200/45">
                      T{item.turn + 1}
                    </span>
                    <span className="rounded border border-gold/25 bg-gold/5 px-1 text-[10px] text-gold/85">
                      {RANDOM_EVENT_INTENSITY[item.intensity] ?? item.intensity}
                    </span>
                    <span className="truncate text-[11px]" title={`${item.targetKind}:${item.targetId}`}>
                      {RANDOM_EVENT_TARGET_KIND[item.targetKind] ?? item.targetKind} {item.targetId}
                    </span>
                    <span className="ml-auto text-[10px] text-parchment-200/50">
                      {RANDOM_EVENT_RESOLUTION[item.status] ?? item.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {save.state.randomEvent.lastPlan && (
            <div className="mt-2 border-t border-parchment-600/15 pt-2 leading-relaxed text-parchment-200/70">
              <span className="text-gold/75">随机事件安排：</span>
              {save.state.randomEvent.lastPlan}
            </div>
          )}
          {save.state.randomEvent.lastNote && save.state.randomEvent.lastTriggeredTurn !== undefined && (
            <div className="mt-2 border-t border-parchment-600/15 pt-2 leading-relaxed text-parchment-200/70">
              <span className="text-gold/75">随机事件结果：</span>
              {save.state.randomEvent.lastNote}
            </div>
          )}
        </div>
      </UpdateGlow>
    </aside>
  );
}

type ExportMode = 'story' | 'story-input' | 'story-input-thinking';

function downloadTextFile(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildExportText(history: MessageV2[], mode: ExportMode): string {
  if (mode === 'story') {
    return (
      history
        .filter((m) => m.role === 'assistant')
        .map((m) => m.content)
        .join('\n\n')
        .trim() || '（暂无故事正文）'
    );
  }
  return (
    history
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => {
        const heading = `第 ${m.turn + 1} 回合`;
        if (m.role === 'user') return `${heading}\n玩家：${m.content}`;
        const thinking = mode === 'story-input-thinking' ? `\n思维链：${m.thinking?.trim() || '（无）'}` : '';
        return `${heading}\n正文：${m.content}${thinking}`;
      })
      .join('\n\n')
      .trim() || '（暂无故事记录）'
  );
}

function safeExportName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
}

function exportSaveText(name: string, history: MessageV2[], mode: ExportMode) {
  const safeName = safeExportName(name);
  const suffix = mode === 'story' ? '仅正文' : mode === 'story-input' ? '正文与输入' : '正文输入与思维链';
  const text = buildExportText(history, mode);
  downloadTextFile(`${safeName}-${suffix}-${new Date().toISOString().slice(0, 10)}.txt`, text);
}

function exportFullJson(name: string, history: MessageV2[], turnRecords: TurnRecordV2[]) {
  const safeName = safeExportName(name);
  const payload = {
    name,
    exportedAt: new Date().toISOString(),
    history,
    turnRecords,
  };
  downloadTextFile(`${safeName}-全部信息-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2));
}

export default function GamePageV2() {
  const navigate = useNavigate();
  const save = useActiveSaveV2();
  const settings = useSettingsStore((state) => state.settings);
  const persistError = useGameStoreV2((state) => state.persistError);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState('');
  const [failedDraft, setFailedDraft] = useState('');
  /**
   * 正文已生成、仅结算失败时的中间结果。存在它就意味着当前回合可以“只重试结算”：
   * 正文完整保留，重试不会重新调用 planner_pre / story。
   */
  const [failedPartial, setFailedPartial] = useState<TurnPartialV2>();
  const [error, setError] = useState('');
  const [queue, setQueue] = useState<QueuedTurn[]>([]);
  const [activeQueueId, setActiveQueueId] = useState<string>();
  const [activeTurn, setActiveTurn] = useState<QueuedTurn>();
  const [queuePaused, setQueuePaused] = useState(false);
  const [editingLastTurn, setEditingLastTurn] = useState(false);
  const [activities, setActivities] = useState<ModelActivityV2[]>([]);
  const [thinking, setThinking] = useState<Record<ModelPhaseV2, string>>({
    planner_pre: '',
    story: '',
    planner_post: '',
  });

  // 阅读体验状态：当前视口所在回合、阅读进度（0~1）、是否上翻离开底部
  const [activeVisibleTurn, setActiveVisibleTurn] = useState(0);
  const [scrollProgress, setScrollProgress] = useState(1);
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const { prefs, updatePrefs, readerContainerStyle, readerColumnClass } = useReaderPreferences();
  const { bookmarks, toggleBookmark } = useTurnBookmarks(save?.id);

  const processingRef = useRef(false);
  const abortRef = useRef<AbortController>();
  const lastEnqueueRef = useRef<{ text: string; at: number }>();
  const runIdRef = useRef(0);
  const streamBufferRef = useRef('');
  const storyEndRef = useRef<HTMLDivElement>(null);
  const readingCardRef = useRef<HTMLDivElement>(null);
  /** 是否继续把视口跟随到正文末尾（玩家主动上翻时置为 false）。 */
  const autoFollowRef = useRef(true);
  /** 程序自身滚动的时间窗；窗口内的 scroll 事件不算"用户上翻"。 */
  const programmaticScrollUntilRef = useRef(0);
  /** 首次到达用 auto（瞬时），之后的增量用 smooth，避免开局就平滑滚动一大段。 */
  const scrollBehaviorRef = useRef<ScrollBehavior>('auto');
  /** 已从 localStorage 恢复过草稿的存档 id（每个存档只恢复一次）。 */
  const draftRestoredRef = useRef<string>();
  /** 供 pagehide 落盘使用的输入快照（避免把 effect 依赖到每次按键）。 */
  const inputRef = useRef('');
  inputRef.current = input;

  useEffect(() => () => abortRef.current?.abort(), []);

  // 构建回合章节索引表：用于在切幕处渲染 ActChapterBanner
  const turnCatalogMap = useMemo(() => {
    if (!save) return new Map();
    const list = buildTurnCatalog(save.state.history, save.state.destiny, save.outline?.acts);
    return new Map(list.map((entry) => [entry.turn, entry]));
  }, [save]);

  // ---------------------------------------------------------------------------
  // 自动滚动到底部 + 阅读位置实时追踪
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const anchor = storyEndRef.current;
    if (!anchor || !autoFollowRef.current) return;
    const behavior: ScrollBehavior = scrollBehaviorRef.current;
    scrollBehaviorRef.current = 'smooth';
    programmaticScrollUntilRef.current = Date.now() + 800;
    anchor.scrollIntoView({ block: 'end', behavior });
  }, [save?.state.history.length, stream, activeTurn, busy, queue.length]);

  useEffect(() => {
    const onScroll = () => {
      const anchor = storyEndRef.current;
      if (anchor && Date.now() >= programmaticScrollUntilRef.current) {
        const bottom = anchor.getBoundingClientRect().bottom;
        const following = bottom <= window.innerHeight + 4;
        autoFollowRef.current = following;
        setIsScrolledUp(!following);
      }

      // 计算全文阅读进度与当前视口所在的回合
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const currentProgress = docHeight > 20 ? Math.max(0, Math.min(1, window.scrollY / docHeight)) : 1;
      setScrollProgress(currentProgress);

      const container = readingCardRef.current;
      if (!container) return;
      const turnNodes = container.querySelectorAll<HTMLElement>('[data-story-turn]');
      if (!turnNodes.length) return;
      const viewportPivot = window.innerHeight * 0.35;
      let chosenTurn = Number(turnNodes[0].dataset.storyTurn ?? 0);
      for (const node of turnNodes) {
        const rect = node.getBoundingClientRect();
        if (rect.top <= viewportPivot) {
          chosenTurn = Number(node.dataset.storyTurn ?? chosenTurn);
        } else {
          break;
        }
      }
      setActiveVisibleTurn(chosenTurn);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [save?.state.history.length]);

  const jumpToTurn = (turn: number) => {
    const container = readingCardRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>(`[data-story-turn="${turn}"]`);
    if (!target) return;
    autoFollowRef.current = false;
    setIsScrolledUp(true);
    programmaticScrollUntilRef.current = Date.now() + 850;
    target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setActiveVisibleTurn(turn);
  };

  const jumpToLatest = () => {
    autoFollowRef.current = true;
    setIsScrolledUp(false);
    programmaticScrollUntilRef.current = Date.now() + 850;
    storyEndRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  };

  // ---------------------------------------------------------------------------
  // 草稿保留
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const saveId = save?.id;
    if (!saveId || draftRestoredRef.current === saveId) return;
    draftRestoredRef.current = saveId;
    const stored = readDraft(saveId);
    if (stored) setInput((current) => (current ? current : stored));
  }, [save?.id]);

  useEffect(() => {
    const saveId = save?.id;
    if (!saveId) return;
    const timer = window.setTimeout(() => writeDraft(saveId, input), 250);
    return () => window.clearTimeout(timer);
  }, [input, save?.id]);

  useEffect(() => {
    const saveId = save?.id;
    if (!saveId) return;
    const flush = () => writeDraft(saveId, inputRef.current);
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [save?.id]);

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!processingRef.current && queue.length === 0) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [queue.length]);

  useEffect(() => {
    const pauseWhenHidden = () => {
      if (document.visibilityState !== 'hidden' || queue.length === 0) return;
      setQueuePaused(true);
      setError('页面已切换到后台；当前请求可完成，但后续行动队列已暂停，返回后请手动继续。');
    };
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () => document.removeEventListener('visibilitychange', pauseWhenHidden);
  }, [queue.length]);

  useEffect(() => {
    if (!save || processingRef.current || queuePaused || queue.length === 0) return;
    const item = queue[0];
    const controller = new AbortController();
    const runId = ++runIdRef.current;
    processingRef.current = true;
    abortRef.current = controller;
    setActiveQueueId(item.id);
    setActiveTurn(item);
    setQueue((current) => current.filter((queued) => queued.id !== item.id));
    setBusy(true);
    setError('');
    setStream('');
    setFailedDraft('');
    setFailedPartial(undefined);
    streamBufferRef.current = '';
    setActivities([]);
    setThinking({ planner_pre: '', story: '', planner_post: '' });

    void (async () => {
      try {
        const latestSave = useGameStoreV2.getState().saves[save.id];
        if (!latestSave) throw new Error('当前存档已不存在。');
        const latestSettings = useSettingsStore.getState().settings;
        const result = await runTurnV2({
          state: { ...latestSave.state, phase: 'generating', narrativePace: item.pace },
          input: item.input,
          settings: latestSettings,
          outline: latestSave.outline,
          background: latestSave.background,
          worldFacts: latestSave.worldFacts,
          signal: controller.signal,
          onStoryDelta: (delta) => {
            if (runIdRef.current === runId) {
              streamBufferRef.current += delta;
              setStream((current) => current + delta);
            }
          },
          onModelActivity: (activity) => {
            if (
              runIdRef.current === runId
              && (activity.type === 'phase'
                || activity.type === 'tool'
                || activity.type === 'usage'
                || activity.type === 'warning')
            ) {
              setActivities((current) => [...current, activity]);
            }
          },
          onModelThinkingDelta: (phase, text) => {
            if (runIdRef.current === runId) {
              setThinking((current) => ({ ...current, [phase]: current[phase] + text }));
            }
          },
        });
        if (controller.signal.aborted || runIdRef.current !== runId) return;
        const committed = useGameStoreV2.getState().commitSuccessfulTurn(save.id, {
          stateBeforeTurn: latestSave.state,
          input: item.input,
          narrativePace: item.pace,
          nextState: {
            ...result.state,
            narrativePace: useGameStoreV2.getState().saves[save.id]?.state.narrativePace ?? item.pace,
          },
        });
        if (!committed) throw new Error('存档在生成期间发生变化，本轮结果未提交。请检查当前故事后重试。');
      } catch (cause) {
        if (runIdRef.current !== runId) return;
        if (controller.signal.aborted) {
          setQueuePaused(true);
          setError('已取消当前模型请求；后续行动队列已暂停。');
        } else if (cause instanceof TurnPostFailureV2) {
          setFailedPartial(cause.partial);
          setError(`结算失败，正文已保留：\n${cleanError(cause)}`);
          setQueuePaused(true);
        } else {
          if (streamBufferRef.current.trim()) setFailedDraft(streamBufferRef.current);
          setError(cleanError(cause));
          setQueuePaused(true);
          setQueue((current) => (current.some((queued) => queued.id === item.id) ? current : [item, ...current]));
        }
      } finally {
        if (runIdRef.current !== runId) return;
        if (abortRef.current === controller) abortRef.current = undefined;
        processingRef.current = false;
        setActiveQueueId(undefined);
        setActiveTurn(undefined);
        setBusy(false);
        setStream('');
      }
    })();
  }, [queue, queuePaused, save]);

  if (!save) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <Button onClick={() => navigate('/')}>返回主页</Button>
      </div>
    );
  }

  const leavePage = async (target: string) => {
    if (busy || queue.length > 0) {
      const ok = await confirmDialog({
        title: '离开当前生成？',
        message: '离开会取消正在进行的模型请求，并清空尚未发送的行动队列。已经完成的回合不会受到影响。',
        confirmText: '取消生成并离开',
        cancelText: '继续等待',
        variant: 'danger',
      });
      if (!ok) return;
      abortRef.current?.abort();
      setQueue([]);
    }
    navigate(target);
  };

  const pace = save.state.narrativePace ?? 'standard';
  const paceInfo = PACE_OPTIONS.find((x) => x.id === pace) ?? PACE_OPTIONS[1];
  const autonomy = save.state.storyAutonomy ?? 'standard';
  const autonomyInfo = AUTONOMY_OPTIONS.find((x) => x.id === autonomy) ?? AUTONOMY_OPTIONS[1];
  const setPace = (next: NarrativePaceV2) => {
    if (next !== pace) {
      useGameStoreV2.getState().update(save.id, (current) => ({
        ...current,
        state: { ...current.state, narrativePace: next },
      }));
    }
  };
  const setAutonomy = (next: StoryAutonomyV2) => {
    if (next !== autonomy) {
      useGameStoreV2.getState().update(save.id, (current) => ({
        ...current,
        state: { ...current.state, storyAutonomy: next },
      }));
    }
  };

  const enqueueWithPace = (value: string, selectedPace: NarrativePaceV2) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const now = Date.now();
    if (lastEnqueueRef.current?.text === trimmed && now - lastEnqueueRef.current.at < 500) return;
    if (queue.length >= 20) {
      setError('发送队列已达到20项上限，请先等待或取消部分行动。');
      return;
    }
    lastEnqueueRef.current = { text: trimmed, at: now };
    setQueue((current) => [...current, { id: createQueueId(), input: trimmed, pace: selectedPace, createdAt: Date.now() }]);
    setInput('');
    autoFollowRef.current = true;
    setIsScrolledUp(false);
    scrollBehaviorRef.current = 'smooth';
    programmaticScrollUntilRef.current = Date.now() + 800;
    storyEndRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  };

  const enqueue = (value: string) => enqueueWithPace(value, pace);

  const cancelQueued = (id: string) => {
    if (id === activeQueueId) {
      setQueuePaused(true);
      abortRef.current?.abort();
      return;
    }
    setQueue((current) => current.filter((item) => item.id !== id));
  };

  const stopCurrentTurn = () => {
    if (!busy) return;
    if (activeTurn) {
      setInput(activeTurn.input);
      setPace(activeTurn.pace);
    }
    setQueuePaused(true);
    abortRef.current?.abort();
  };

  const retryQueue = () => {
    setError('');
    setQueuePaused(false);
  };

  const retrySettlementOnly = async () => {
    if (!failedPartial || processingRef.current) return;
    const partial = failedPartial;
    const saveId = save.id;
    const controller = new AbortController();
    const runId = ++runIdRef.current;
    processingRef.current = true;
    abortRef.current = controller;
    setBusy(true);
    setError('');
    setActiveQueueId(undefined);
    setActiveTurn({
      id: `settle-${partial.commitId}`,
      input: partial.input,
      pace: partial.narrativePace,
      createdAt: Date.now(),
    });
    try {
      const latestSave = useGameStoreV2.getState().saves[saveId];
      if (!latestSave) throw new Error('当前存档已不存在。');
      const latestSettings = useSettingsStore.getState().settings;
      const result = await runTurnSettlementV2(
        {
          state: latestSave.state,
          input: partial.input,
          settings: latestSettings,
          outline: latestSave.outline,
          background: latestSave.background,
          worldFacts: latestSave.worldFacts,
          signal: controller.signal,
          onModelActivity: (activity) => {
            if (
              runIdRef.current === runId
              && (activity.type === 'phase'
                || activity.type === 'tool'
                || activity.type === 'usage'
                || activity.type === 'warning')
            ) {
              setActivities((current) => [...current, activity]);
            }
          },
          onModelThinkingDelta: (phase, text) => {
            if (runIdRef.current === runId) {
              setThinking((current) => ({ ...current, [phase]: current[phase] + text }));
            }
          },
        },
        partial,
      );
      if (controller.signal.aborted || runIdRef.current !== runId) return;
      const committed = useGameStoreV2.getState().commitSuccessfulTurn(saveId, {
        stateBeforeTurn: latestSave.state,
        input: partial.input,
        narrativePace: partial.narrativePace,
        nextState: {
          ...result.state,
          narrativePace: useGameStoreV2.getState().saves[saveId]?.state.narrativePace ?? partial.narrativePace,
        },
      });
      if (!committed) throw new Error('存档在生成期间发生变化，本轮结果未提交。请检查当前故事后重试。');
      setFailedPartial(undefined);
      setFailedDraft('');
      if (queue.length > 0 && document.visibilityState !== 'visible') {
        setQueuePaused(true);
        setError('结算已完成并提交；页面处于后台，后续行动队列保持暂停，返回后请手动继续。');
      } else {
        setError('');
        setQueuePaused(false);
      }
    } catch (cause) {
      if (runIdRef.current !== runId) return;
      if (controller.signal.aborted) {
        setError('已取消本次结算请求；正文与「仅重试结算」入口仍然保留。');
      } else if (cause instanceof TurnPostFailureV2) {
        setFailedPartial(cause.partial);
        setError(`结算失败，正文已保留：\n${cleanError(cause)}`);
        setQueuePaused(true);
      } else {
        setFailedPartial(undefined);
        setFailedDraft(partial.story);
        setError(cleanError(cause));
        setQueuePaused(true);
        setQueue((current) =>
          current.some((queued) => queued.input === partial.input)
            ? current
            : [{ id: createQueueId(), input: partial.input, pace: partial.narrativePace, createdAt: Date.now() }, ...current],
        );
      }
    } finally {
      if (runIdRef.current !== runId) return;
      if (abortRef.current === controller) abortRef.current = undefined;
      processingRef.current = false;
      setActiveTurn(undefined);
      setBusy(false);
    }
  };

  const regenerateFailedTurn = () => {
    if (!failedPartial || processingRef.current) return;
    const partial = failedPartial;
    setFailedPartial(undefined);
    setFailedDraft('');
    setError('');
    setQueuePaused(false);
    lastEnqueueRef.current = undefined;
    setQueue((current) => [
      { id: createQueueId(), input: partial.input, pace: partial.narrativePace, createdAt: Date.now() },
      ...current,
    ]);
  };

  const canReviseLastTurn = !busy && queue.length === 0 && !editingLastTurn && !failedPartial && !!save.lastTurnCheckpoint;

  const retryLastTurn = async () => {
    if (!canReviseLastTurn) return;
    const confirmed = await confirmDialog({
      title: '重新生成最近回合',
      message: '将撤销最近一轮已经生成的故事和状态，并使用原输入重新请求模型。确定继续吗？',
      confirmText: '撤销并重新生成',
      variant: 'danger',
    });
    if (!confirmed) return;
    const checkpoint = useGameStoreV2.getState().restoreLastTurn(save.id);
    if (!checkpoint) return;
    setActivities([]);
    setThinking({ planner_pre: '', story: '', planner_post: '' });
    setFailedDraft('');
    enqueueWithPace(checkpoint.input, checkpoint.narrativePace);
  };

  const editLastTurn = () => {
    if (!canReviseLastTurn) return;
    const checkpoint = save.lastTurnCheckpoint;
    if (!checkpoint) return;
    setEditingLastTurn(true);
    setPace(checkpoint.narrativePace);
    setInput(checkpoint.input);
    setActivities([]);
    setThinking({ planner_pre: '', story: '', planner_post: '' });
  };

  const cancelEditLastTurn = () => {
    setEditingLastTurn(false);
    setInput('');
  };

  const confirmEditLastTurn = async () => {
    if (!editingLastTurn || !input.trim()) return;
    const revisedInput = input.trim();
    const revisedPace = pace;
    const confirmed = await confirmDialog({
      title: '确认修改最近回合',
      message: '确认后才会撤销最近一轮，并使用修改后的输入重新请求。取消不会改变现有故事。',
      confirmText: '确认修改并重新请求',
      variant: 'danger',
    });
    if (!confirmed) return;
    const checkpoint = useGameStoreV2.getState().restoreLastTurn(save.id);
    if (!checkpoint) {
      setError('最近回合已经发生变化，无法修改。');
      setEditingLastTurn(false);
      return;
    }
    setEditingLastTurn(false);
    enqueueWithPace(revisedInput, revisedPace);
  };

  const activeItem = activeTurn;
  const exportItems = [
    {
      id: 'story',
      label: '仅导出故事正文',
      icon: <Download size={14} />,
      onClick: () => exportSaveText(save.name, save.state.history, 'story'),
    },
    {
      id: 'story-input',
      label: '导出正文与玩家输入',
      icon: <Download size={14} />,
      onClick: () => exportSaveText(save.name, save.state.history, 'story-input'),
    },
    {
      id: 'story-input-thinking',
      label: '导出正文、输入与思维链',
      icon: <Download size={14} />,
      onClick: () => exportSaveText(save.name, save.state.history, 'story-input-thinking'),
    },
    {
      id: 'all',
      label: '导出全部信息（JSON）',
      icon: <Download size={14} />,
      onClick: () => exportFullJson(save.name, save.state.history, save.state.turnRecords ?? []),
    },
  ];

  const totalActs = save.outline?.acts.length ?? 0;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-gold-line-dim bg-parchment-800/90 shadow-[0_2px_18px_rgba(0,0,0,.45)] backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <Button
            variant="ghost"
            size="sm"
            className="!h-10 !w-10 !px-0 rounded-full"
            onClick={() => void leavePage('/')}
            title="返回主页"
          >
            <ArrowLeft size={17} />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="truncate font-serif tracking-[.08em] text-parchment-100">{save.name}</div>
            <div className="text-[11px] text-parchment-200/50">
              {save.state.mode === 'author' ? '执笔模式 · 无限回合自由输入' : '游历模式 · 自由行动与命运线'} · 第{' '}
              {save.state.turn} 回合
            </div>
          </div>
          <div className="hidden items-center gap-2 md:flex">
            <span className="rounded-full border border-gold/25 bg-ink/25 px-3 py-1 text-xs text-gold-light">
              {paceInfo.label}
            </span>
            <DropdownMenu trigger={<Download size={16} />} items={exportItems} align="right" />
            <Button variant="ghost" size="sm" onClick={() => void leavePage('/settings')} title="设置">
              <Settings size={16} />
            </Button>
          </div>
          <div className="flex items-center gap-2 md:hidden">
            <DropdownMenu trigger={<Download size={16} />} items={exportItems} align="right" />
            <Button variant="ghost" size="sm" onClick={() => void leavePage('/settings')}>
              <Settings size={16} />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0">
          {/* 长文阅读导航器：卷宗目录抽屉、当前回合定位、字号/行距/版心调节、右下角回到最新罗盘 */}
          <ReadingNavigator
            saveId={save.id}
            history={save.state.history}
            destiny={save.state.destiny}
            outlineActs={save.outline?.acts}
            currentTurn={save.state.turn}
            activeVisibleTurn={activeVisibleTurn}
            scrollProgress={scrollProgress}
            isScrolledUp={isScrolledUp}
            busy={busy}
            prefs={prefs}
            onUpdatePrefs={updatePrefs}
            bookmarks={bookmarks}
            onToggleBookmark={toggleBookmark}
            onJumpToTurn={jumpToTurn}
            onJumpToLatest={jumpToLatest}
          />

          <div
            ref={readingCardRef}
            style={readerContainerStyle}
            className="rounded-xl border border-parchment-600/25 bg-ink/20 px-4 py-5 shadow-[0_12px_35px_rgba(0,0,0,.2)] sm:px-7"
          >
            <div className={readerColumnClass}>
              {save.state.history.length === 0 && (
                <div className="py-20 text-center text-sm text-parchment-200/45">故事将从你的第一个行动开始。</div>
              )}

              {save.state.history.map((message) => {
                const catalogEntry = message.role === 'user' ? turnCatalogMap.get(message.turn) : undefined;
                const isBookmarked = bookmarks.includes(message.turn);
                if (message.role === 'user') {
                  return (
                    <div key={message.id} data-story-turn={message.turn} style={{ scrollMarginTop: 132 }}>
                      {catalogEntry?.isActStart && (
                        <ActChapterBanner entry={catalogEntry} totalActs={totalActs} />
                      )}
                      <article className="my-6 border-l-2 border-gold/55 pl-4">
                        <div className="mb-1 flex items-center justify-between gap-2 text-[10px] tracking-[.28em] text-gold/65">
                          <span>你的行动 · 第 {message.turn + 1} 回合</span>
                          <button
                            type="button"
                            onClick={() => toggleBookmark(message.turn)}
                            className={`tracking-normal transition ${
                              isBookmarked
                                ? 'text-gold-light'
                                : 'text-parchment-200/30 hover:text-gold/75'
                            }`}
                            title={isBookmarked ? '移除本回合书签' : '添加本回合书签'}
                          >
                            {isBookmarked ? '★ 已签' : '☆ 书签'}
                          </button>
                        </div>
                        <div className="whitespace-pre-wrap font-serif text-[15px] italic leading-8 text-parchment-200/90">
                          {message.content}
                        </div>
                      </article>
                    </div>
                  );
                }
                return <StoryArticle key={message.id} turn={message.turn} content={message.content} settled />;
              })}

              {busy && activeItem && (
                <article className="my-6 border-l-2 border-gold/55 pl-4">
                  <div className="mb-1 flex items-center gap-2 text-[10px] tracking-[.28em] text-gold/65">
                    <span>正在处理 · 第 {save.state.turn + 1} 回合</span>
                    <span className="rounded bg-gold/10 px-1.5 py-0.5 tracking-normal text-gold/70">
                      {PACE_OPTIONS.find((option) => option.id === activeItem.pace)?.label}
                    </span>
                    <button
                      type="button"
                      onClick={stopCurrentTurn}
                      className="ml-auto rounded border border-blood/40 px-2 py-1 tracking-normal text-blood hover:bg-blood/10"
                    >
                      <X size={11} className="mr-1 inline" />
                      终止本轮
                    </button>
                  </div>
                  <div className="whitespace-pre-wrap font-serif text-[15px] italic leading-8 text-parchment-200/90">
                    {activeItem.input}
                  </div>
                </article>
              )}

              <ModelActivityPanel
                activities={activities}
                thinking={thinking}
                busy={busy}
                patchStats={save.state.turnRecords?.[save.state.turnRecords.length - 1]?.patchStats}
              />

              {stream && <StoryArticle turn={save.state.turn} content={stream} writing />}

              {!busy && failedDraft && !failedPartial && (
                <article className="prose-story prose-story--settled my-8 rounded-lg border border-blood/30 bg-blood/5 p-4">
                  <div className="mb-3 text-[10px] tracking-[.22em] text-blood">未提交的故事草稿 · 重试后将被替换</div>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{failedDraft}</ReactMarkdown>
                </article>
              )}

              {failedPartial && (
                <article className="prose-story prose-story--settled my-8 rounded-lg border border-gold/35 bg-gold/5 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[10px] tracking-[.22em] text-gold">正文已生成 · 结算未完成</span>
                    <span className="text-[10px] text-parchment-200/45">
                      正文已保留；仅重试结算不会重新调用写前规划与故事模型
                    </span>
                  </div>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{failedPartial.story}</ReactMarkdown>
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gold/15 pt-3">
                    <Button size="xs" disabled={busy} onClick={() => void retrySettlementOnly()}>
                      {busy ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                      仅重试结算
                    </Button>
                    <Button size="xs" variant="ghost" disabled={busy} onClick={regenerateFailedTurn}>
                      <RotateCcw size={13} />
                      重新生成本回合
                    </Button>
                    {busy && <span className="text-[11px] text-parchment-200/45">正在重试结算，只重跑写后结算…</span>}
                  </div>
                </article>
              )}

              <div ref={storyEndRef} style={{ scrollMarginBottom: 280 }} className="h-px w-full" aria-hidden />
            </div>
          </div>

          {save.lastTurnCheckpoint && (
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button size="xs" variant="ghost" disabled={!canReviseLastTurn} onClick={retryLastTurn}>
                <RotateCcw size={13} />
                重新生成最近回合
              </Button>
              <Button size="xs" variant="ghost" disabled={!canReviseLastTurn} onClick={editLastTurn}>
                <Pencil size={13} />
                修改最近输入
              </Button>
            </div>
          )}

          {error && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-blood/50 bg-blood/10 px-4 py-3 text-sm text-blood">
              <span className="whitespace-pre-wrap">{error}</span>
              {queuePaused && queue.length > 0 && !failedPartial && (
                <Button size="xs" variant="outline" onClick={retryQueue}>
                  <RotateCcw size={13} />
                  重试模型请求
                </Button>
              )}
            </div>
          )}

          {persistError && (
            <div className="mt-4 rounded-lg border border-amber-400/45 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
              <div className="flex items-start gap-2">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="tracking-[.12em]">进度未能写入本地存储</div>
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-amber-100/80">
                    {persistError.message}
                  </p>
                  <p className="mt-2 text-[11px] leading-relaxed text-amber-100/60">
                    内存中的故事仍在继续，但刷新页面后会回到最后一次成功写入的进度。建议先用右上角「导出」保存正文，再回到主页删除不再需要的旅程。
                  </p>
                </div>
              </div>
            </div>
          )}

          {save.state.mode === 'adventure' && save.state.availableActions.length > 0 && (
            <div className="mt-4 rounded-xl border border-gold/20 bg-parchment-900/35 p-4">
              <div className="mb-3 flex items-center gap-2 text-xs tracking-[.2em] text-gold/75">
                <BookOpen size={14} />
                可选行动
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {save.state.availableActions.map((action) => (
                  <button
                    type="button"
                    key={action.id}
                    onClick={() => enqueue(action.label)}
                    className="rounded-lg border border-parchment-600/35 bg-ink/25 px-3 py-2 text-left text-sm text-parchment-100 transition hover:border-gold/60 hover:bg-gold/5"
                  >
                    <span>{action.label}</span>
                    {action.hint && <span className="mt-1 block text-xs text-parchment-200/50">{action.hint}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="sticky bottom-0 z-10 mt-5 overflow-hidden rounded-xl border border-parchment-600/30 bg-parchment-800/95 shadow-[0_-10px_30px_rgba(0,0,0,.35)] backdrop-blur-md">
            {queue.length > 0 && (
              <div className="border-b border-parchment-600/25 bg-ink/20 px-3 py-2.5 sm:px-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[11px] tracking-[.16em] text-parchment-200/65">
                    <Clock3 size={13} />
                    发送队列 · {queue.length} 项
                  </div>
                  {queuePaused && <span className="text-[11px] text-blood">发生错误，队列已暂停</span>}
                </div>
                <div className="max-h-36 space-y-1.5 overflow-y-auto pr-1">
                  {queue.map((item, index) => {
                    const active = item.id === activeQueueId;
                    const itemPace = PACE_OPTIONS.find((option) => option.id === item.pace)?.label;
                    return (
                      <div
                        key={item.id}
                        className={`group flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs ${
                          active ? 'border-gold/35 bg-gold/8' : 'border-parchment-600/20 bg-ink/20'
                        }`}
                      >
                        <span className={`shrink-0 ${active ? 'text-gold-light' : 'text-parchment-200/40'}`}>
                          {active ? '生成中' : `等待 ${index + 1}`}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-parchment-100" title={item.input}>
                          {item.input}
                        </span>
                        <span className="shrink-0 text-[10px] text-parchment-200/40">{itemPace}</span>
                        <button
                          type="button"
                          onClick={() => cancelQueued(item.id)}
                          className="rounded p-1 text-parchment-200/35 transition hover:bg-blood/15 hover:text-blood"
                          title={active ? '取消当前生成' : '从队列移除'}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="p-3 sm:p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs tracking-[.18em] text-gold-light">
                  <Sparkles size={14} />
                  {editingLastTurn ? '修改最近回合' : '自由行动'}
                  {busy && <span className="tracking-normal text-parchment-200/45">· 可继续输入，发送后进入队列</span>}
                </div>
                <div className="flex flex-wrap gap-1">
                  {PACE_OPTIONS.map((option) => (
                    <button
                      type="button"
                      key={option.id}
                      onClick={() => setPace(option.id)}
                      className={`rounded-md px-2 py-1 text-[11px] transition ${
                        pace === option.id
                          ? 'bg-gold/15 text-gold-light ring-1 ring-gold/50'
                          : 'text-parchment-200/55 hover:bg-parchment-700/50 hover:text-parchment-100'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-[10px] tracking-[.18em] text-parchment-200/45">推进权限</span>
                <div className="flex flex-wrap gap-1">
                  {AUTONOMY_OPTIONS.map((option) => (
                    <button
                      type="button"
                      key={option.id}
                      title={option.hint}
                      onClick={() => setAutonomy(option.id)}
                      className={`rounded-md px-2 py-1 text-[11px] transition ${
                        autonomy === option.id
                          ? 'bg-gold/15 text-gold-light ring-1 ring-gold/50'
                          : 'text-parchment-200/55 hover:bg-parchment-700/50 hover:text-parchment-100'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <span className="text-[10px] text-parchment-200/35">{autonomyInfo.hint}</span>
              </div>
              {editingLastTurn && (
                <div className="mb-3 rounded-lg border border-gold/30 bg-gold/5 px-3 py-2 text-xs text-parchment-200/70">
                  当前仅在编辑副本，原故事尚未删除。点击取消将保留原回合；只有确认后才会撤销并重新请求。
                </div>
              )}
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    if (editingLastTurn) void confirmEditLastTurn();
                    else enqueue(input);
                  }
                }}
                placeholder={`${paceInfo.hint} · ${autonomyInfo.hint}。描述你想做什么……`}
                className="min-h-[110px] w-full resize-y rounded-lg border border-parchment-600/35 bg-ink/45 px-3 py-3 font-serif text-[15px] leading-7 text-parchment-50 outline-none transition focus:border-gold/70 placeholder:text-parchment-200/35"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[11px] text-parchment-200/40">
                  {editingLastTurn
                    ? '取消不会改变现有故事'
                    : 'Ctrl/⌘ + Enter 发送 · 生成期间的新行动会按顺序等待'}
                </span>
                {editingLastTurn ? (
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={cancelEditLastTurn}>
                      取消修改
                    </Button>
                    <Button disabled={!input.trim()} onClick={() => void confirmEditLastTurn()}>
                      确认并重新请求
                    </Button>
                  </div>
                ) : (
                  <Button disabled={!input.trim()} onClick={() => enqueue(input)}>
                    {busy || queue.length > 0 ? '加入队列' : '发送行动'}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </section>

        <SidePanel save={save} canEdit={settings.stateEditingEnabled !== false} />
      </main>
    </div>
  );
}