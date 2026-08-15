import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertCircle, ArrowLeft, BookOpen, Brain, Check, ChevronDown, ChevronRight, Circle, Clock3, Compass, Loader2, Package, Pencil, RotateCcw, ScrollText, Settings, Sparkles, Users, Wrench, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { confirmDialog } from '@/components/ui/ConfirmDialog';
import { useSettingsStore } from '@/store/useSettingsStore';
import { runTurnV2 } from './engine';
import { useActiveSaveV2, useGameStoreV2 } from './store';
import type { DestinyProgressV2, ModelActivityV2, ModelPhaseV2, NarrativePaceV2, StoryBeatRuntimeV2 } from './types';
import type { LlmUsage } from '@/types/llm';

const PACE_OPTIONS: Array<{ id: NarrativePaceV2; label: string; hint: string }> = [
  { id: 'slow', label: '慢叙事', hint: '细致到每个动作，只推进很小节拍' },
  { id: 'standard', label: '标准', hint: '完成一次主要行动或一个场景' },
  { id: 'fast', label: '快叙事', hint: '按事件发展推进一组行动' },
  { id: 'timeskip', label: '时间跨越', hint: '概述数天以上，保留关键节点' },
];

const BEAT_STATUS: Record<StoryBeatRuntimeV2['status'], string> = {
  pending: '未展开', available: '条件成熟', active: '进行中', satisfied: '已完成',
  weakened: '影响减弱', reframed: '路线改写', superseded: '等价承接',
};

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

const PHASE_LABEL: Record<ModelPhaseV2, string> = {
  planner_pre: '规划故事路径',
  story: '书写故事正文',
  planner_post: '整理状态与命运进展',
};

function tokenCount(value: number | undefined): string {
  return Math.max(0, Math.round(value ?? 0)).toLocaleString('zh-CN');
}

function cacheHitTokens(usage: LlmUsage | undefined): number {
  return usage?.cache?.hitTokens ?? usage?.cache?.cachedTokens ?? 0;
}

function sumUsage(usages: Array<LlmUsage | undefined>): LlmUsage | undefined {
  const present = usages.filter((usage): usage is LlmUsage => !!usage);
  if (!present.length) return undefined;
  const promptTokens = present.reduce((sum, usage) => sum + (usage.promptTokens ?? 0), 0);
  const completionTokens = present.reduce((sum, usage) => sum + (usage.completionTokens ?? 0), 0);
  const hitTokens = present.reduce((sum, usage) => sum + cacheHitTokens(usage), 0);
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, cache: { hitTokens } };
}

function UsageLine({ usage, total = false }: { usage: LlmUsage; total?: boolean }) {
  const totalTokens = usage.totalTokens ?? (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
  return <div className={`flex flex-wrap gap-x-3 gap-y-1 text-[10px] ${total ? 'text-gold/70' : 'text-parchment-200/40'}`}>
    <span>{total ? '本轮总计' : 'Token'}</span>
    <span>输入 {tokenCount(usage.promptTokens)}</span>
    <span>缓存命中 {tokenCount(cacheHitTokens(usage))}</span>
    <span>输出 {tokenCount(usage.completionTokens)}</span>
    <span>合计 {tokenCount(totalTokens)}</span>
  </div>;
}

function DestinyCard({ destiny }: { destiny: DestinyProgressV2 }) {
  const [open, setOpen] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const completion = Math.max(0, Math.min(100, Math.round(Number(destiny.completionEstimate) || 0)));
  // 玩家面板只展示已经发生的故事节与其证据；available/pending/currentPlan
  // 属于规划模型的未来信息，不能提前泄露。
  const beats = (destiny.beats ?? []).filter((b) => (
    b.status === 'active'
    || b.status === 'satisfied'
    || b.status === 'weakened'
    || b.status === 'reframed'
    || b.status === 'superseded'
  ));
  return (
    <section className="rounded-xl border border-gold/25 bg-parchment-900/45 p-4 shadow-[0_8px_30px_rgba(0,0,0,.2)]">
      <div className="flex items-start justify-between gap-3">
        <div><div className="flex items-center gap-2 text-sm tracking-[.16em] text-gold-light"><Sparkles size={14} />命运线</div><div className="mt-1 text-xs text-parchment-200/50">依附于已发生的事件，仅供规划参考</div></div>
        <div className="text-right"><div className="text-lg text-gold-light">{completion}%</div>{destiny.endingReached && <div className="text-[10px] text-gold/70">结尾曾达成</div>}</div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink/80"><div className="h-full rounded-full bg-gradient-to-r from-gold/50 to-gold-light/90 transition-all" style={{ width: `${completion}%` }} /></div>
      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <div><span className="text-parchment-200/45">当前幕</span><p className="mt-0.5 truncate text-parchment-100" title={destiny.currentStage}>{destiny.currentStage || '尚未定位'}</p></div>
        <div><span className="text-parchment-200/45">当前路径</span><p className="mt-0.5 truncate text-parchment-100" title={destiny.currentPath}>{destiny.currentPath || '自由发展'}</p></div>
      </div>
      {destiny.completionReason && <button type="button" onClick={() => setReasonOpen((v) => !v)} className="mt-2 inline-flex items-center gap-1 text-xs text-gold/75 hover:text-gold-light">{reasonOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{reasonOpen ? '收起完成度说明' : '为什么是这个完成度'}</button>}
      {reasonOpen && destiny.completionReason && <p className="mt-2 border-t border-parchment-600/15 pt-2 text-xs leading-relaxed text-parchment-200/70">{destiny.completionReason}</p>}
      <button type="button" onClick={() => setOpen((v) => !v)} className="mt-2 inline-flex items-center gap-1 text-xs text-gold/75 hover:text-gold-light">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{open ? '收起故事节' : '展开故事节'}</button>
      {open && <div className="mt-2 space-y-1 border-t border-parchment-600/15 pt-2 text-xs">{beats.length ? beats.map((beat) => <div key={beat.beatId} className="flex gap-2"><span className="text-parchment-100">{beat.evidenceSummary || '本故事节已在正文中发生。'}</span><span className="shrink-0 text-gold/70">{BEAT_STATUS[beat.status]}</span></div>) : <span className="text-parchment-200/45">尚未发生可展示的故事节。</span>}</div>}
    </section>
  );
}

function ModelActivityPanel({ activities, thinking, busy }: { activities: ModelActivityV2[]; thinking: Record<ModelPhaseV2, string>; busy: boolean }) {
  const [open, setOpen] = useState(true);
  const [phaseOpen, setPhaseOpen] = useState<Record<ModelPhaseV2, boolean>>({ planner_pre: true, story: false, planner_post: false });
  const previousBusy = useRef(false);
  const phases = (['planner_pre', 'story', 'planner_post'] as ModelPhaseV2[]).map((phase) => {
    const events = activities.filter((item) => item.type === 'phase' && item.phase === phase);
    const phaseTools = activities.filter((item) => item.type === 'tool' && item.phase === phase);
    const phaseWarnings = activities.filter((item) => item.type === 'warning' && item.phase === phase);
    const usageEvents = activities.filter((item) => item.type === 'usage' && item.phase === phase);
    const usageEvent = usageEvents[usageEvents.length - 1];
    return { phase, latest: events[events.length - 1], tools: phaseTools, warnings: phaseWarnings, usage: usageEvent?.type === 'usage' ? usageEvent.usage : undefined };
  });
  const totalUsage = sumUsage(phases.map(({ usage }) => usage));
  const active = phases.find(({ latest }) => latest?.type === 'phase' && latest.status === 'started')?.phase;
  useEffect(() => {
    if (busy && !previousBusy.current) {
      setOpen(true);
      setPhaseOpen({ planner_pre: true, story: false, planner_post: false });
    }
    previousBusy.current = busy;
  }, [busy]);
  useEffect(() => {
    if (active) setPhaseOpen((current) => current[active] ? current : { ...current, [active]: true });
  }, [active]);
  if (!activities.length && !busy) return null;
  return <section className="mb-4 overflow-hidden rounded-xl border border-parchment-600/25 bg-parchment-900/35">
    <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-parchment-700/20">
      <span className={`rounded-full border border-gold/30 p-2 text-gold ${busy ? 'animate-pulse' : ''}`}><Brain size={15} /></span>
      <span className="min-w-0 flex-1"><span className="block text-sm text-parchment-100">{active ? PHASE_LABEL[active] : '本轮模型活动'}</span><span className="block truncate text-xs text-parchment-200/45">{busy ? '模型正在处理，可展开查看实时思考与工具活动' : '本轮处理完成'}</span></span>
      {open ? <ChevronDown size={15} className="text-gold/70" /> : <ChevronRight size={15} className="text-gold/70" />}
    </button>
    {open && <div className="border-t border-parchment-600/20 px-4 py-3">
      {totalUsage && <div className="mb-3 rounded-md border border-gold/15 bg-gold/5 px-3 py-2"><UsageLine usage={totalUsage} total /></div>}
      <div className="relative ml-2 border-l border-parchment-600/30 pl-5">
      {phases.map(({ phase, latest, tools, warnings, usage }, index) => {
        const status = latest?.type === 'phase' ? latest.status : undefined;
        const expanded = phaseOpen[phase];
        const StatusIcon = status === 'started' ? Loader2 : status === 'completed' ? Check : status === 'failed' ? AlertCircle : Circle;
        return <div key={phase} className={`${index < phases.length - 1 ? 'pb-3' : ''} relative`}>
          <StatusIcon size={15} className={`absolute -left-[28px] top-3 bg-parchment-900 ${status === 'started' ? 'animate-spin text-gold-light' : status === 'completed' ? 'text-emerald-400/80' : status === 'failed' ? 'text-blood' : 'text-parchment-200/25'}`} />
          <div className={`rounded-lg border ${status === 'started' ? 'border-gold/30 bg-gold/5' : 'border-parchment-600/15 bg-ink/20'}`}>
            <button type="button" onClick={() => setPhaseOpen((current) => ({ ...current, [phase]: !current[phase] }))} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
              {expanded ? <ChevronDown size={13} className="text-parchment-200/45" /> : <ChevronRight size={13} className="text-parchment-200/45" />}
              <span className="min-w-0 flex-1 text-xs text-gold-light">{PHASE_LABEL[phase]}{latest?.type === 'phase' && <span className="ml-2 text-[10px] font-normal text-parchment-200/35">{latest.model}</span>}</span>
              <span className="text-[10px] text-parchment-200/45">{status === 'started' ? '进行中' : status === 'completed' ? '已完成' : status === 'failed' ? '失败' : '等待'}</span>
            </button>
            {expanded && <div className="border-t border-parchment-600/15 px-3 pb-3 pt-2">
              {latest?.type === 'phase' && latest.error && <div className="mb-2 whitespace-pre-wrap text-[11px] leading-5 text-blood">{latest.error}</div>}
              {usage && <div className="mb-2"><UsageLine usage={usage} /></div>}
              {warnings.length > 0 && <div className="mb-2 space-y-1">{warnings.map((warning, warningIndex) => warning.type === 'warning' && <div key={`${warning.code}-${warning.path}-${warningIndex}`} className="flex items-start gap-1.5 rounded border border-amber-400/20 bg-amber-400/5 px-2 py-1.5 text-[10px] leading-4 text-amber-200/75"><AlertCircle size={11} className="mt-0.5 shrink-0" /><span>{warning.message}</span></div>)}</div>}
              <div className="max-h-64 overflow-auto whitespace-pre-wrap text-xs leading-6 text-parchment-200/65">{thinking[phase] || (status === 'started' ? '正在读取上下文并思考…' : status === 'completed' ? '此阶段未返回可显示的思考内容。' : '等待上一阶段完成。')}</div>
              {tools.length > 0 && <div className="mt-3 space-y-2 border-l border-parchment-600/25 pl-3">{tools.map((tool, toolIndex) => tool.type === 'tool' && <div key={`${tool.callId}-${tool.status}-${toolIndex}`} className="text-[11px] text-parchment-200/55"><div className="flex items-center gap-1.5 text-parchment-100/70"><Wrench size={11} /><span>{tool.status === 'call' ? '调用' : '返回'} · {tool.toolName}</span></div>{tool.argumentsText && <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-ink/30 p-2 text-[10px]">{tool.argumentsText}</pre>}{tool.resultText && <pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap rounded bg-ink/30 p-2 text-[10px]">{tool.resultText}</pre>}</div>)}</div>}
              {!tools.length && latest?.type === 'phase' && latest.toolsEnabled && <div className="mt-2 flex items-center gap-1 text-[10px] text-parchment-200/25"><Wrench size={10} />尚未调用工具</div>}
            </div>}
          </div>
        </div>;
      })}
      </div>
    </div>}
  </section>;
}

function SidePanel({ save }: { save: NonNullable<ReturnType<typeof useActiveSaveV2>> }) {
  const [tab, setTab] = useState<'people' | 'world' | 'items' | 'threads'>('people');
  const [factsOpen, setFactsOpen] = useState(false);
  const tabs = [{ id: 'people' as const, label: '人物', icon: <Users size={14} /> }, { id: 'world' as const, label: '世界', icon: <Compass size={14} /> }, { id: 'items' as const, label: '背包', icon: <Package size={14} /> }, { id: 'threads' as const, label: '故事', icon: <ScrollText size={14} /> }];
  const characterName = (id: string) => id === 'player' ? '主角' : save.state.characters.find((c) => c.id === id)?.name ?? id;
  return <aside className="space-y-4 lg:sticky lg:top-[76px] lg:max-h-[calc(100vh-92px)] lg:overflow-auto">
    <DestinyCard destiny={save.state.destiny} />
    <section className="overflow-hidden rounded-xl border border-parchment-600/25 bg-parchment-900/35">
      <div className="flex border-b border-parchment-600/20">{tabs.map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`flex flex-1 items-center justify-center gap-1 py-3 text-xs transition ${tab === item.id ? 'border-b-2 border-gold text-gold-light' : 'text-parchment-200/55 hover:text-parchment-100'}`}>{item.icon}{item.label}</button>)}</div>
      <div className="p-3 text-sm">
        {tab === 'people' && <div className="space-y-3">
          {save.state.characters.length ? save.state.characters.map((c) => <div key={c.id} className="rounded-lg border border-parchment-600/20 bg-ink/20 p-3"><div className="flex items-center justify-between"><span className="text-gold-light">{c.name}</span><span className="text-[10px] text-parchment-200/45">{c.status}</span></div><div className="mt-1 text-xs text-parchment-200/60">{c.role || c.description || '尚无详细资料'}</div>{c.knownFacts.length > 0 && <div className="mt-2 space-y-0.5 text-[11px] text-parchment-200/50">{c.knownFacts.slice(-3).map((fact, i) => <div key={`${c.id}-f-${i}`}>· {fact}</div>)}</div>}</div>) : <p className="text-xs text-parchment-200/45">故事人物将在正文中出现。</p>}
          {save.state.relationships.length > 0 && <div className="border-t border-parchment-600/15 pt-3"><div className="mb-2 text-xs text-parchment-200/45">关系</div><div className="space-y-1.5">{save.state.relationships.map((rel) => <div key={rel.id} className="rounded border border-parchment-600/15 bg-ink/10 px-2.5 py-1.5 text-xs text-parchment-200/70"><span className="text-parchment-100">{characterName(rel.fromId)}</span><span className="mx-1 text-parchment-200/40">→</span><span className="text-parchment-100">{characterName(rel.toId)}</span>{rel.label && <span className="ml-2 text-gold/70">{rel.label}</span>}<span className="ml-2 text-parchment-200/50">好感 {rel.affinity > 0 ? `+${rel.affinity}` : rel.affinity}</span></div>)}</div></div>}
        </div>}
        {tab === 'world' && <div className="space-y-3">{save.state.currentScene && <div><div className="text-xs text-parchment-200/45">当前场景</div><div className="mt-1 text-gold-light">{save.state.currentScene.name}</div><p className="mt-1 text-xs leading-relaxed text-parchment-200/65">{save.state.currentScene.description}</p><div className="mt-2 text-[11px] text-parchment-200/45">{[save.state.currentScene.time, save.state.currentScene.weather].filter(Boolean).join(' · ')}</div></div>}<div className="border-t border-parchment-600/15 pt-3"><div className="text-xs text-parchment-200/45">最新进展</div><p className="mt-1 text-xs leading-relaxed text-parchment-200/70">{save.state.latestProgress || save.state.summary || '故事刚刚开始。'}</p></div>{save.state.facts.length > 0 && <div className="border-t border-parchment-600/15 pt-3"><button type="button" onClick={() => setFactsOpen((v) => !v)} className="flex w-full items-center justify-between text-xs text-parchment-200/45 hover:text-parchment-100"><span>正史事实（{save.state.facts.length}）</span>{factsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>{factsOpen && <div className="mt-2 space-y-1.5">{save.state.facts.map((fact) => <div key={fact.id} className="rounded border border-parchment-600/15 bg-ink/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-parchment-200/70"><span className="text-parchment-100">{fact.subjectId}</span><span className="mx-1 text-parchment-200/40">·</span>{fact.predicate}<span className="mx-1 text-parchment-200/40">=</span>{fact.value}</div>)}</div>}</div>}</div>}
        {tab === 'items' && <div className="space-y-2">{save.state.inventory.length ? save.state.inventory.map((item) => <div key={item.id} className="flex items-start justify-between rounded-lg border border-parchment-600/20 p-2.5"><div><div className="flex items-center gap-2"><span className="text-parchment-100">{item.name}</span>{item.consumable && <span className="rounded border border-gold/30 bg-gold/5 px-1.5 py-0.5 text-[10px] text-gold/75">消耗品</span>}</div><div className="text-[11px] text-parchment-200/50">{item.description || item.kind}</div></div><span className="text-gold-light">×{item.quantity}</span></div>) : <p className="text-xs text-parchment-200/45">暂无物品。</p>}</div>}
        {tab === 'threads' && <div className="space-y-2">{save.state.storyThreads.length ? save.state.storyThreads.map((thread) => <div key={thread.id} className="rounded-lg border border-parchment-600/20 p-2.5"><div className="flex justify-between gap-2"><span className="text-parchment-100">{thread.title}</span><span className="text-[10px] text-gold/70">{thread.status}</span></div>{thread.currentStep && <p className="mt-1 text-xs text-parchment-200/60">{thread.currentStep}</p>}{thread.progress !== undefined && <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink/60"><div className="h-full rounded-full bg-gold/60" style={{ width: `${Math.max(0, Math.min(100, thread.progress))}%` }} /></div>}</div>) : <p className="text-xs text-parchment-200/45">故事线索将在推进后出现。</p>}</div>}
      </div>
    </section>
    <div className="rounded-xl border border-parchment-600/20 bg-ink/20 p-3 text-xs text-parchment-200/50">
      <div>故事脉动：{save.state.randomEvent.enabled === false ? '随机事件已关闭' : save.state.randomEvent.pending ? '新的事件正在靠近' : '命运沿当前路径流动'}</div>
      {save.state.randomEvent.lastPlan && <div className="mt-2 border-t border-parchment-600/15 pt-2 leading-relaxed text-parchment-200/70"><span className="text-gold/70">随机事件安排：</span>{save.state.randomEvent.lastPlan}</div>}
      {save.state.randomEvent.lastNote && <div className="mt-2 border-t border-parchment-600/15 pt-2 leading-relaxed text-parchment-200/70"><span className="text-gold/70">随机事件结果：</span>{save.state.randomEvent.lastNote}</div>}
    </div>
  </aside>;
}

export default function GamePageV2() {
  const navigate = useNavigate();
  const save = useActiveSaveV2();
  const settings = useSettingsStore((state) => state.settings);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState('');
  const [failedDraft, setFailedDraft] = useState('');
  const [error, setError] = useState('');
  const [queue, setQueue] = useState<QueuedTurn[]>([]);
  const [activeQueueId, setActiveQueueId] = useState<string>();
  const [activeTurn, setActiveTurn] = useState<QueuedTurn>();
  const [queuePaused, setQueuePaused] = useState(false);
  const [editingLastTurn, setEditingLastTurn] = useState(false);
  const [activities, setActivities] = useState<ModelActivityV2[]>([]);
  const [thinking, setThinking] = useState<Record<ModelPhaseV2, string>>({ planner_pre: '', story: '', planner_post: '' });
  const processingRef = useRef(false);
  const abortRef = useRef<AbortController>();
  const lastEnqueueRef = useRef<{ text: string; at: number }>();
  const runIdRef = useRef(0);
  const streamBufferRef = useRef('');

  useEffect(() => () => abortRef.current?.abort(), []);
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
    // 领取任务时立即从等待队列移除。即使存档更新触发重渲染，同一输入也不会再次被 effect 消费。
    setQueue((current) => current.filter((queued) => queued.id !== item.id));
    setBusy(true);
    setError('');
    setStream('');
    setFailedDraft('');
    streamBufferRef.current = '';
    setActivities([]);
    setThinking({ planner_pre: '', story: '', planner_post: '' });
    setFailedDraft('');

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
          onStoryDelta: (delta) => { if (runIdRef.current === runId) { streamBufferRef.current += delta; setStream((current) => current + delta); } },
          onModelActivity: (activity) => {
            if (runIdRef.current === runId && (activity.type === 'phase' || activity.type === 'tool' || activity.type === 'usage' || activity.type === 'warning')) setActivities((current) => [...current, activity]);
          },
          onModelThinkingDelta: (phase, text) => { if (runIdRef.current === runId) setThinking((current) => ({ ...current, [phase]: current[phase] + text })); },
        });
        if (controller.signal.aborted || runIdRef.current !== runId) return;
        const committed = useGameStoreV2.getState().commitSuccessfulTurn(save.id, {
          stateBeforeTurn: latestSave.state,
          input: item.input,
          narrativePace: item.pace,
          nextState: { ...result.state, narrativePace: useGameStoreV2.getState().saves[save.id]?.state.narrativePace ?? item.pace },
        });
        if (!committed) throw new Error('存档在生成期间发生变化，本轮结果未提交。请检查当前故事后重试。');
      } catch (cause) {
        if (runIdRef.current !== runId) return;
        if (controller.signal.aborted) {
          setQueuePaused(true);
          setError('已取消当前模型请求；后续行动队列已暂停。');
        } else {
          // 失败项保留在队首，避免后续行动在缺少本轮上下文时被自动发送。
          if (streamBufferRef.current.trim()) setFailedDraft(streamBufferRef.current);
          setError(cleanError(cause));
          setQueuePaused(true);
          setQueue((current) => current.some((queued) => queued.id === item.id) ? current : [item, ...current]);
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

  if (!save) return <div className="mx-auto max-w-3xl p-8"><Button onClick={() => navigate('/')}>返回主页</Button></div>;
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
  const setPace = (next: NarrativePaceV2) => { if (next !== pace) useGameStoreV2.getState().update(save.id, (current) => ({ ...current, state: { ...current.state, narrativePace: next } })); };
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
  const canReviseLastTurn = !busy && queue.length === 0 && !editingLastTurn && !!save.lastTurnCheckpoint;
  const retryLastTurn = async () => {
    if (!canReviseLastTurn) return;
    const confirmed = await confirmDialog({ title: '重新生成最近回合', message: '将撤销最近一轮已经生成的故事和状态，并使用原输入重新请求模型。确定继续吗？', confirmText: '撤销并重新生成', variant: 'danger' });
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
    const confirmed = await confirmDialog({ title: '确认修改最近回合', message: '确认后才会撤销最近一轮，并使用修改后的输入重新请求。取消不会改变现有故事。', confirmText: '确认修改并重新请求', variant: 'danger' });
    if (!confirmed) return;
    const checkpoint = useGameStoreV2.getState().restoreLastTurn(save.id);
    if (!checkpoint) { setError('最近回合已经发生变化，无法修改。'); setEditingLastTurn(false); return; }
    setEditingLastTurn(false);
    enqueueWithPace(revisedInput, revisedPace);
  };
  const activeItem = activeTurn;
  return <div className="min-h-screen">
    <header className="sticky top-0 z-20 border-b border-gold-line-dim bg-parchment-800/90 shadow-[0_2px_18px_rgba(0,0,0,.45)] backdrop-blur-md"><div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6"><Button variant="ghost" size="sm" className="!h-10 !w-10 !px-0 rounded-full" onClick={() => void leavePage('/')} title="返回主页"><ArrowLeft size={17} /></Button><div className="min-w-0 flex-1"><div className="truncate font-serif tracking-[.08em] text-parchment-100">{save.name}</div><div className="text-[11px] text-parchment-200/50">{save.state.mode === 'author' ? '执笔模式 · 无限回合自由输入' : '游历模式 · 自由行动与命运线'} · 第 {save.state.turn} 回合</div></div><div className="hidden items-center gap-2 md:flex"><span className="rounded-full border border-gold/25 bg-ink/25 px-3 py-1 text-xs text-gold-light">{paceInfo.label}</span><Button variant="ghost" size="sm" onClick={() => void leavePage('/settings')} title="设置"><Settings size={16} /></Button></div><Button variant="ghost" size="sm" className="md:hidden" onClick={() => void leavePage('/settings')}><Settings size={16} /></Button></div></header>
    <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="min-w-0">
        <div className="rounded-xl border border-parchment-600/25 bg-ink/20 px-4 py-5 shadow-[0_12px_35px_rgba(0,0,0,.2)] sm:px-7">
          {save.state.history.length === 0 && <div className="py-20 text-center text-sm text-parchment-200/45">故事将从你的第一个行动开始。</div>}
          {save.state.history.map((message, index) => <article key={message.id} className={message.role === 'user' ? 'my-6 border-l-2 border-gold/55 pl-4' : 'prose-story my-8'}>{message.role === 'user' ? <><div className="mb-1 text-[10px] tracking-[.28em] text-gold/65">你的行动 · 第 {message.turn + 1} 回合</div><div className="whitespace-pre-wrap font-serif text-[15px] italic leading-8 text-parchment-200/90">{message.content}</div></> : <><div className="mb-3 flex items-center gap-2 text-[10px] tracking-[.3em] text-parchment-200/35"><span className="h-px flex-1 bg-gold-line opacity-50" /><span>第 {message.turn + 1} 回合</span><span className="h-px flex-1 bg-gold-line opacity-50" /></div><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown></>}</article>)}
          {busy && activeItem && <article className="my-6 border-l-2 border-gold/55 pl-4"><div className="mb-1 flex items-center gap-2 text-[10px] tracking-[.28em] text-gold/65"><span>正在处理 · 第 {save.state.turn + 1} 回合</span><span className="rounded bg-gold/10 px-1.5 py-0.5 tracking-normal text-gold/70">{PACE_OPTIONS.find((option) => option.id === activeItem.pace)?.label}</span><button type="button" onClick={stopCurrentTurn} className="ml-auto rounded border border-blood/40 px-2 py-1 tracking-normal text-blood hover:bg-blood/10"><X size={11} className="mr-1 inline" />终止本轮</button></div><div className="whitespace-pre-wrap font-serif text-[15px] italic leading-8 text-parchment-200/90">{activeItem.input}</div></article>}
          <ModelActivityPanel activities={activities} thinking={thinking} busy={busy} />
          {stream && <article className="prose-story my-8"><div className="mb-3 text-[10px] tracking-[.3em] text-gold/70">故事之笔正在书写…</div><ReactMarkdown remarkPlugins={[remarkGfm]}>{stream}</ReactMarkdown></article>}
          {!busy && failedDraft && <article className="prose-story my-8 rounded-lg border border-blood/30 bg-blood/5 p-4"><div className="mb-3 text-[10px] tracking-[.22em] text-blood">未提交的故事草稿 · 重试后将被替换</div><ReactMarkdown remarkPlugins={[remarkGfm]}>{failedDraft}</ReactMarkdown></article>}
        </div>
        {save.lastTurnCheckpoint && <div className="mt-3 flex flex-wrap justify-end gap-2"><Button size="xs" variant="ghost" disabled={!canReviseLastTurn} onClick={retryLastTurn}><RotateCcw size={13} />重新生成最近回合</Button><Button size="xs" variant="ghost" disabled={!canReviseLastTurn} onClick={editLastTurn}><Pencil size={13} />修改最近输入</Button></div>}
        {error && <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-blood/50 bg-blood/10 px-4 py-3 text-sm text-blood"><span className="whitespace-pre-wrap">{error}</span>{queuePaused && queue.length > 0 && <Button size="xs" variant="outline" onClick={retryQueue}><RotateCcw size={13} />重试模型请求</Button>}</div>}
        {save.state.mode === 'adventure' && save.state.availableActions.length > 0 && <div className="mt-4 rounded-xl border border-gold/20 bg-parchment-900/35 p-4"><div className="mb-3 flex items-center gap-2 text-xs tracking-[.2em] text-gold/75"><BookOpen size={14} />可选行动</div><div className="grid gap-2 sm:grid-cols-2">{save.state.availableActions.map((action) => <button type="button" key={action.id} onClick={() => enqueue(action.label)} className="rounded-lg border border-parchment-600/35 bg-ink/25 px-3 py-2 text-left text-sm text-parchment-100 transition hover:border-gold/60 hover:bg-gold/5"><span>{action.label}</span>{action.hint && <span className="mt-1 block text-xs text-parchment-200/50">{action.hint}</span>}</button>)}</div></div>}
        <div className="sticky bottom-0 z-10 mt-5 overflow-hidden rounded-xl border border-parchment-600/30 bg-parchment-800/95 shadow-[0_-10px_30px_rgba(0,0,0,.35)] backdrop-blur-md">
          {queue.length > 0 && <div className="border-b border-parchment-600/25 bg-ink/20 px-3 py-2.5 sm:px-4"><div className="mb-2 flex items-center justify-between"><div className="flex items-center gap-2 text-[11px] tracking-[.16em] text-parchment-200/65"><Clock3 size={13} />发送队列 · {queue.length} 项</div>{queuePaused && <span className="text-[11px] text-blood">发生错误，队列已暂停</span>}</div><div className="max-h-36 space-y-1.5 overflow-y-auto pr-1">{queue.map((item, index) => { const active = item.id === activeQueueId; const itemPace = PACE_OPTIONS.find((option) => option.id === item.pace)?.label; return <div key={item.id} className={`group flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs ${active ? 'border-gold/35 bg-gold/8' : 'border-parchment-600/20 bg-ink/20'}`}><span className={`shrink-0 ${active ? 'text-gold-light' : 'text-parchment-200/40'}`}>{active ? '生成中' : `等待 ${index + 1}`}</span><span className="min-w-0 flex-1 truncate text-parchment-100" title={item.input}>{item.input}</span><span className="shrink-0 text-[10px] text-parchment-200/40">{itemPace}</span><button type="button" onClick={() => cancelQueued(item.id)} className="rounded p-1 text-parchment-200/35 transition hover:bg-blood/15 hover:text-blood" title={active ? '取消当前生成' : '从队列移除'}><X size={13} /></button></div>; })}</div></div>}
          <div className="p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2 text-xs tracking-[.18em] text-gold-light"><Sparkles size={14} />{editingLastTurn ? '修改最近回合' : '自由行动'}{busy && <span className="tracking-normal text-parchment-200/45">· 可继续输入，发送后进入队列</span>}</div><div className="flex flex-wrap gap-1">{PACE_OPTIONS.map((option) => <button type="button" key={option.id} onClick={() => setPace(option.id)} className={`rounded-md px-2 py-1 text-[11px] transition ${pace === option.id ? 'bg-gold/15 text-gold-light ring-1 ring-gold/50' : 'text-parchment-200/55 hover:bg-parchment-700/50 hover:text-parchment-100'}`}>{option.label}</button>)}</div></div>
            {editingLastTurn && <div className="mb-3 rounded-lg border border-gold/30 bg-gold/5 px-3 py-2 text-xs text-parchment-200/70">当前仅在编辑副本，原故事尚未删除。点击取消将保留原回合；只有确认后才会撤销并重新请求。</div>}
            <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); if (editingLastTurn) void confirmEditLastTurn(); else enqueue(input); } }} placeholder={`${paceInfo.hint}。描述你想做什么……`} className="min-h-[110px] w-full resize-y rounded-lg border border-parchment-600/35 bg-ink/45 px-3 py-3 font-serif text-[15px] leading-7 text-parchment-50 outline-none transition focus:border-gold/70 placeholder:text-parchment-200/35" />
            <div className="mt-2 flex items-center justify-between gap-2"><span className="text-[11px] text-parchment-200/40">{editingLastTurn ? '取消不会改变现有故事' : 'Ctrl/⌘ + Enter 发送 · 生成期间的新行动会按顺序等待'}</span>{editingLastTurn ? <div className="flex gap-2"><Button variant="ghost" onClick={cancelEditLastTurn}>取消修改</Button><Button disabled={!input.trim()} onClick={() => void confirmEditLastTurn()}>确认并重新请求</Button></div> : <Button disabled={!input.trim()} onClick={() => enqueue(input)}>{busy || queue.length > 0 ? '加入队列' : '发送行动'}</Button>}</div>
          </div>
        </div>
      </section>
      <SidePanel save={save} />
    </main>
  </div>;
}
