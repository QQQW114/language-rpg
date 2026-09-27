import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertCircle, ArrowLeft, BookOpen, Brain, Check, ChevronDown, ChevronRight, Circle, Clock3, Compass, Download, Loader2, Package, Pencil, RotateCcw, ScrollText, Settings, Sparkles, Users, Wrench, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { confirmDialog } from '@/components/ui/ConfirmDialog';
import { readDraft, writeDraft } from './draft';
import { diffSidePanelChanges, toChangeMap, type SidePanelChangeKind } from './sidePanelUpdates';
import { UpdateGlow } from '@/components/ui/UpdateGlow';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import { useSettingsStore } from '@/store/useSettingsStore';
import { runTurnV2 } from './engine';
import { useActiveSaveV2, useGameStoreV2 } from './store';
import type { CharacterV2, DestinyProgressV2, GameStateV2, MessageV2, ModelActivityV2, ModelPhaseV2, NarrativePaceV2, PatchStatsV2, RelationshipV2, StoryBeatRuntimeV2, StoryThreadV2, TurnRecordV2 } from './types';
import type { LlmUsage } from '@/types/llm';
import { formatCacheHitRate } from '@/lib/llmUsage';

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

const THREAD_STATUS: Record<StoryThreadV2['status'], string> = {
  candidate: '候选', active: '进行中', completed: '已完成', failed: '已失败', cancelled: '已取消',
};

const CHARACTER_STATUS: Record<CharacterV2['status'], string> = {
  active: '活跃', absent: '暂离', missing: '失踪', dead: '死亡', unknown: '未知',
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
  // 未命中量也要累加，否则合计行算不出缓存命中率（命中率 = 命中 / 完整输入量）。
  // 某阶段缺这一项时按"该阶段输入量 − 命中量"补，避免整体分母偏小。
  const missTokens = present.reduce(
    (sum, usage) => sum + (usage.cache?.missTokens ?? Math.max(0, (usage.promptTokens ?? 0) - cacheHitTokens(usage))),
    0,
  );
  const totalTokens = promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens, cache: { hitTokens, missTokens } };
}

function UsageLine({ usage, total = false }: { usage: LlmUsage; total?: boolean }) {
  const totalTokens = usage.totalTokens ?? (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
  const hit = cacheHitTokens(usage);
  const miss = usage.cache?.missTokens ?? Math.max(0, (usage.promptTokens ?? 0) - hit);
  const rate = formatCacheHitRate(usage);
  return <div className={`flex flex-wrap gap-x-3 gap-y-1 text-[10px] ${total ? 'text-gold/70' : 'text-parchment-200/40'}`}>
    <span>{total ? '本轮总计' : 'Token'}</span>
    <span>输入 {tokenCount(usage.promptTokens)}</span>
    {/* 命中率只在数据可信时显示：分母是完整输入量，缺总量时宁可显示"—"也不给假数字。 */}
    <span>缓存命中 {tokenCount(hit)}{rate ? `（${rate}）` : ''}</span>
    <span>未命中 {tokenCount(miss)}</span>
    <span>输出 {tokenCount(usage.completionTokens)}</span>
    <span>合计 {tokenCount(totalTokens)}</span>
  </div>;
}

function DestinyCard({ destiny, showDetails }: { destiny: DestinyProgressV2; showDetails: boolean }) {
  const [open, setOpen] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const completion = Math.max(0, Math.min(100, Math.round(Number(destiny.completionEstimate) || 0)));
  // 默认只展示已经发生的故事节，避免把未来路径提前剧透；
  // 开启“故事推进详情”后，展示全部故事节、下一里程碑与收敛计划。
  const beats = showDetails
    ? (destiny.beats ?? [])
    : (destiny.beats ?? []).filter((b) => (
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
      {showDetails && destiny.nextMilestone && <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2"><div><span className="text-parchment-200/45">下一里程碑</span><p className="mt-0.5 truncate text-parchment-100" title={destiny.nextMilestone}>{destiny.nextMilestone}</p></div>{destiny.convergencePlan && <div><span className="text-parchment-200/45">收敛计划</span><p className="mt-0.5 truncate text-parchment-100" title={destiny.convergencePlan}>{destiny.convergencePlan}</p></div>}</div>}
      {destiny.completionReason && <button type="button" onClick={() => setReasonOpen((v) => !v)} className="mt-2 inline-flex items-center gap-1 text-xs text-gold/75 hover:text-gold-light">{reasonOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{reasonOpen ? '收起完成度说明' : '当前完成度说明'}</button>}
      {reasonOpen && destiny.completionReason && <p className="mt-2 border-t border-parchment-600/15 pt-2 text-xs leading-relaxed text-parchment-200/70">{destiny.completionReason}</p>}
      <button type="button" onClick={() => setOpen((v) => !v)} className="mt-2 inline-flex items-center gap-1 text-xs text-gold/75 hover:text-gold-light">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{open ? '收起故事节' : '展开故事节'}</button>
      {open && <div className="mt-2 space-y-1 border-t border-parchment-600/15 pt-2 text-xs">{beats.length ? beats.map((beat) => <div key={beat.beatId} className="flex gap-2"><span className="text-parchment-100">{showDetails ? (beat.evidenceSummary || beat.currentPlan || '尚未展开。') : (beat.evidenceSummary || '本故事节已在正文中发生。')}</span><span className="shrink-0 text-gold/70">{BEAT_STATUS[beat.status]}</span></div>) : <span className="text-parchment-200/45">尚未发生可展示的故事节。</span>}</div>}
    </section>
  );
}

function ModelActivityPanel({ activities, thinking, busy, patchStats }: { activities: ModelActivityV2[]; thinking: Record<ModelPhaseV2, string>; busy: boolean; patchStats?: PatchStatsV2 }) {
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
  // 结算对账：模型提交了多少条状态变更、程序接受了多少、丢弃了多少、改写了几处枚举。
  // 这些数字以前只以警告文本存在，无法累计观察；现在直接显示，便于判断"模型输出被程序
  // 拒绝"的规模，也是决定是否要做 id 回显的依据。
  const reconciliation = patchStats ? {
    applied: patchStats.characters.applied + patchStats.relationships.applied + patchStats.inventory.applied + patchStats.threads.applied + patchStats.facts.applied,
    input: patchStats.characters.input + patchStats.relationships.input + patchStats.inventory.input + patchStats.threads.input + patchStats.facts.input,
    blocked: patchStats.characters.blocked + patchStats.relationships.blocked + patchStats.inventory.blocked + patchStats.threads.blocked + patchStats.facts.blocked,
    malformed: patchStats.characters.malformed + patchStats.relationships.malformed + patchStats.inventory.malformed + patchStats.threads.malformed + patchStats.facts.malformed,
    coerced: patchStats.coercedEnums,
  } : undefined;
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
              {phase === 'planner_post' && reconciliation && reconciliation.input > 0 && <div className={`mb-2 rounded border px-2 py-1.5 text-[10px] leading-4 ${reconciliation.blocked > 0 || reconciliation.coerced > 0 ? 'border-amber-400/25 bg-amber-400/5 text-amber-200/80' : 'border-parchment-600/20 bg-ink/20 text-parchment-200/55'}`}>
                <span className="text-parchment-100/80">状态提交对账：</span>
                接受 {reconciliation.applied}/{reconciliation.input} 条
                {reconciliation.blocked > 0 && <> · 丢弃 {reconciliation.blocked} 条（其中结构不全 {reconciliation.malformed} 条）</>}
                {reconciliation.coerced > 0 && <> · 改写枚举 {reconciliation.coerced} 处</>}
                {reconciliation.blocked === 0 && reconciliation.coerced === 0 && ' · 无丢弃、无改写'}
              </div>}
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

function CharacterCard({ saveId, character, canEdit }: { saveId: string; character: CharacterV2; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState(character.role ?? '');
  const [description, setDescription] = useState(character.description ?? '');

  const persist = (patch: Partial<Pick<CharacterV2, 'role' | 'description'>>) => {
    useGameStoreV2.getState().update(saveId, (s) => ({
      ...s,
      state: {
        ...s.state,
        characters: s.state.characters.map((c) => c.id === character.id
          ? { ...c, ...patch }
          : c),
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
    <div className="rounded-lg border border-parchment-600/20 bg-ink/20 p-3">
      <div className="flex items-center justify-between">
        <span className="text-gold-light">{character.name}</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-parchment-200/45">{CHARACTER_STATUS[character.status] ?? character.status}</span>
          {canEdit && <button type="button" onClick={() => { setRole(character.role ?? ''); setDescription(character.description ?? ''); setEditing((v) => !v); }} className="rounded p-1 text-parchment-200/45 transition hover:bg-gold/10 hover:text-gold-light" title={editing ? '取消编辑' : '编辑介绍'}><Pencil size={12} /></button>}
          {canEdit && <button type="button" onClick={() => void removeCharacter()} className="rounded p-1 text-parchment-200/45 transition hover:bg-blood/15 hover:text-blood" title="删除人物"><X size={12} /></button>}
        </div>
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <input value={role} onChange={(event) => setRole(event.target.value)} placeholder="角色定位（可选）" className="w-full rounded border border-parchment-600/40 bg-ink/50 px-2 py-1.5 text-xs text-parchment-100 outline-none focus:border-gold/70" />
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="人物介绍" rows={3} className="w-full resize-y rounded border border-parchment-600/40 bg-ink/50 px-2 py-1.5 text-xs leading-5 text-parchment-100 outline-none focus:border-gold/70" />
          <div className="flex gap-2">
            <button type="button" onClick={save} className="rounded border border-gold/40 bg-gold/10 px-2 py-1 text-[11px] text-gold-light hover:bg-gold/20">保存</button>
            <button type="button" onClick={clearIntro} className="rounded border border-parchment-500/40 px-2 py-1 text-[11px] text-parchment-200/70 hover:bg-parchment-700/40">清除介绍</button>
          </div>
        </div>
      ) : (
        <div className="mt-1 text-xs text-parchment-200/60">{character.role || character.description || '尚无详细资料'}</div>
      )}
      {!editing && character.knownFacts.length > 0 && <div className="mt-2 space-y-0.5 text-[11px] text-parchment-200/50">{character.knownFacts.slice(-3).map((fact, i) => <div key={`${character.id}-f-${i}`}>· {fact}</div>)}</div>}
    </div>
  );
}

function RelationshipRow({ saveId, relationship, canEdit, nameById }: { saveId: string; relationship: RelationshipV2; canEdit: boolean; nameById: (id: string) => string }) {
  const [editing, setEditing] = useState(false);
  const [affinity, setAffinity] = useState(String(relationship.affinity));
  const [label, setLabel] = useState(relationship.label ?? '');
  const [note, setNote] = useState(relationship.note ?? '');

  const save = () => {
    useGameStoreV2.getState().update(saveId, (s) => ({
      ...s,
      state: {
        ...s.state,
        relationships: s.state.relationships.map((r) => r.id === relationship.id
          ? { ...r, affinity: clampAffinity(Number(affinity) || 0), label: label.trim() || undefined, note: note.trim() || undefined }
          : r),
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
    <div className="rounded border border-parchment-600/15 bg-ink/10 px-2.5 py-1.5 text-xs text-parchment-200/70">
      {editing ? (
        <div className="space-y-2">
          <div className="text-parchment-100">{nameById(relationship.fromId)} → {nameById(relationship.toId)}</div>
          <label className="block">
            <span className="text-[10px] text-parchment-200/45">好感</span>
            <input type="number" value={affinity} onChange={(event) => setAffinity(event.target.value)} className="mt-0.5 w-full rounded border border-parchment-600/40 bg-ink/50 px-2 py-1.5 text-xs text-parchment-100 outline-none focus:border-gold/70" />
          </label>
          <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="关系标签（可选）" className="w-full rounded border border-parchment-600/40 bg-ink/50 px-2 py-1.5 text-xs text-parchment-100 outline-none focus:border-gold/70" />
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="备注（可选）" className="w-full rounded border border-parchment-600/40 bg-ink/50 px-2 py-1.5 text-xs text-parchment-100 outline-none focus:border-gold/70" />
          <div className="flex gap-2">
            <button type="button" onClick={save} className="rounded border border-gold/40 bg-gold/10 px-2 py-1 text-[11px] text-gold-light hover:bg-gold/20">保存</button>
            <button type="button" onClick={() => setEditing(false)} className="rounded border border-parchment-500/40 px-2 py-1 text-[11px] text-parchment-200/70 hover:bg-parchment-700/40">取消</button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className="text-parchment-100">{nameById(relationship.fromId)}</span>
            <span className="mx-1 text-parchment-200/40">→</span>
            <span className="text-parchment-100">{nameById(relationship.toId)}</span>
            {relationship.label && <span className="ml-2 text-gold/70">{relationship.label}</span>}
            <span className="ml-2 text-parchment-200/50">好感 {relationship.affinity > 0 ? `+${relationship.affinity}` : relationship.affinity}</span>
          </div>
          {canEdit && <div className="flex shrink-0 gap-1">
            <button type="button" onClick={() => { setAffinity(String(relationship.affinity)); setLabel(relationship.label ?? ''); setNote(relationship.note ?? ''); setEditing(true); }} className="rounded p-1 text-parchment-200/45 transition hover:bg-gold/10 hover:text-gold-light" title="编辑关系"><Pencil size={12} /></button>
            <button type="button" onClick={remove} className="rounded p-1 text-parchment-200/45 transition hover:bg-blood/15 hover:text-blood" title="删除关系"><X size={12} /></button>
          </div>}
        </div>
      )}
    </div>
  );
}

/**
 * 故事正文的渲染：流式进行中与最终落盘**共用同一个组件**。
 *
 * 这一点是刻意的：两者此前是两套不同的元素结构（落盘版是 article > div + div > Markdown，
 * 流式版是 article > div + Markdown），回合结束时 React 会卸载一棵树、挂载另一棵树。
 * 而 `index.css` 里 `.prose-story p` 带 `animation: fade-in`，节点一重挂载动画就重放，
 * 表现为"模型输出完成后正文整体重新淡入一次"的闪烁。
 *
 * 共用组件后同一段正文的节点会被复用，动画不会重放；`settled` 再兜一层：
 * 落盘后的重渲染直接禁用正文动画（流式期间逐段淡入仍然保留）。
 */
export function StoryArticle({ turn, content, writing = false, settled = false }: {
  turn: number;
  content: string;
  writing?: boolean;
  settled?: boolean;
}) {
  return <article className="prose-story my-8">
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
  </article>;
}

function SidePanel({ save, canEdit }: { save: NonNullable<ReturnType<typeof useActiveSaveV2>>; canEdit: boolean }) {
  const [tab, setTab] = useState<'people' | 'world' | 'items' | 'threads'>('people');
  const [factsOpen, setFactsOpen] = useState(false);
  const tabs = [{ id: 'people' as const, label: '人物', icon: <Users size={14} /> }, { id: 'world' as const, label: '世界', icon: <Compass size={14} /> }, { id: 'items' as const, label: '背包', icon: <Package size={14} /> }, { id: 'threads' as const, label: '故事', icon: <ScrollText size={14} /> }];

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
    const timer = window.setTimeout(() => setChanges(new Map()), 1600);
    return () => window.clearTimeout(timer);
  }, [changes]);
  const characterName = (id: string) => id === 'player' ? '主角' : save.state.characters.find((c) => c.id === id)?.name ?? id;
  return <aside className="space-y-4 lg:sticky lg:top-[76px] lg:max-h-[calc(100vh-92px)] lg:overflow-auto">
    <UpdateGlow blockId="destiny" change={changes.get('destiny')}><DestinyCard destiny={save.state.destiny} showDetails={canEdit} /></UpdateGlow>
    <section className="overflow-hidden rounded-xl border border-parchment-600/25 bg-parchment-900/35">
      <div className="flex border-b border-parchment-600/20">{tabs.map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`flex flex-1 items-center justify-center gap-1 py-3 text-xs transition ${tab === item.id ? 'border-b-2 border-gold text-gold-light' : 'text-parchment-200/55 hover:text-parchment-100'}`}>{item.icon}{item.label}</button>)}</div>
      <div className="p-3 text-sm">
        {tab === 'people' && <div className="space-y-3">
          {save.state.characters.length ? save.state.characters.map((c) => <UpdateGlow key={c.id} blockId={`character:${c.id}`} change={changes.get(`character:${c.id}`)}><CharacterCard saveId={save.id} character={c} canEdit={canEdit} /></UpdateGlow>) : <p className="text-xs text-parchment-200/45">故事人物将在正文中出现。</p>}
          {save.state.relationships.length > 0 && <div className="border-t border-parchment-600/15 pt-3"><div className="mb-2 text-xs text-parchment-200/45">关系</div><div className="space-y-1.5">{save.state.relationships.map((rel) => <UpdateGlow key={rel.id} blockId={`relationship:${rel.id}`} change={changes.get(`relationship:${rel.id}`)}><RelationshipRow saveId={save.id} relationship={rel} canEdit={canEdit} nameById={characterName} /></UpdateGlow>)}</div></div>}
        </div>}
        {tab === 'world' && <div className="space-y-3">{save.state.currentScene && <UpdateGlow blockId="scene"><div><div className="text-xs text-parchment-200/45">当前场景</div><div className="mt-1 text-gold-light">{save.state.currentScene.name}</div><p className="mt-1 text-xs leading-relaxed text-parchment-200/65">{save.state.currentScene.description}</p><div className="mt-2 text-[11px] text-parchment-200/45">{[save.state.currentScene.time, save.state.currentScene.weather].filter(Boolean).join(' · ')}</div></div></UpdateGlow>}<UpdateGlow blockId="progress" className="border-t border-parchment-600/15 pt-3"><div><div className="text-xs text-parchment-200/45">最新进展</div><p className="mt-1 text-xs leading-relaxed text-parchment-200/70">{save.state.latestProgress || save.state.summary || '故事刚刚开始。'}</p></div></UpdateGlow>{save.state.facts.length > 0 && <div className="border-t border-parchment-600/15 pt-3"><button type="button" onClick={() => setFactsOpen((v) => !v)} className="flex w-full items-center justify-between text-xs text-parchment-200/45 hover:text-parchment-100"><span>正史事实（{save.state.facts.length}）</span>{factsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>{factsOpen && <div className="mt-2 space-y-1.5">{save.state.facts.map((fact) => <UpdateGlow key={fact.id} blockId={`fact:${fact.id}`}><div className="rounded border border-parchment-600/15 bg-ink/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-parchment-200/70"><span className="text-parchment-100">{fact.subjectId}</span><span className="mx-1 text-parchment-200/40">·</span>{fact.predicate}<span className="mx-1 text-parchment-200/40">=</span>{fact.value}</div></UpdateGlow>)}</div>}</div>}</div>}
        {tab === 'items' && <div className="space-y-2">{save.state.inventory.length ? save.state.inventory.map((item) => <UpdateGlow key={item.id} blockId={`item:${item.id}`}><div className="flex items-start justify-between rounded-lg border border-parchment-600/20 p-2.5"><div><div className="flex items-center gap-2"><span className="text-parchment-100">{item.name}</span>{item.consumable && <span className="rounded border border-gold/30 bg-gold/5 px-1.5 py-0.5 text-[10px] text-gold/75">消耗品</span>}</div><div className="text-[11px] text-parchment-200/50">{item.description || item.kind}</div></div><span className="text-gold-light">×{item.quantity}</span></div></UpdateGlow>) : <p className="text-xs text-parchment-200/45">暂无物品。</p>}</div>}
        {tab === 'threads' && <div className="space-y-2">{save.state.storyThreads.length ? save.state.storyThreads.map((thread) => <UpdateGlow key={thread.id} blockId={`thread:${thread.id}`}><div className="rounded-lg border border-parchment-600/20 p-2.5"><div className="flex justify-between gap-2"><span className="text-parchment-100">{thread.title}</span><span className="text-[10px] text-gold/70">{THREAD_STATUS[thread.status] ?? thread.status}</span></div>{thread.currentStep && <p className="mt-1 text-xs text-parchment-200/60">{thread.currentStep}</p>}{thread.progress !== undefined && <div className="mt-2 flex items-center gap-2"><div className="h-1 flex-1 overflow-hidden rounded-full bg-ink/60"><div className="h-full rounded-full bg-gold/60" style={{ width: `${Math.max(0, Math.min(100, thread.progress))}%` }} /></div><span className="text-[10px] tabular-nums text-parchment-200/45">{Math.max(0, Math.min(100, Math.round(thread.progress)))}%</span></div>}</div></UpdateGlow>) : <p className="text-xs text-parchment-200/45">故事线索将在推进后出现。</p>}</div>}
      </div>
    </section>
    <UpdateGlow blockId="randomEvent" className="rounded-xl border border-parchment-600/20 bg-ink/20 p-3 text-xs text-parchment-200/50">
      <div>故事脉动：{save.state.randomEvent.enabled === false ? '随机事件已关闭' : save.state.randomEvent.pending ? '新的事件正在靠近' : '命运沿当前路径流动'}</div>
      {save.state.randomEvent.lastPlan && <div className="mt-2 border-t border-parchment-600/15 pt-2 leading-relaxed text-parchment-200/70"><span className="text-gold/70">随机事件安排：</span>{save.state.randomEvent.lastPlan}</div>}
      {/* note 现在在任何回合都会记录（审计文本），因此只在事件真的触发过之后才显示为"结果"。 */}
      {save.state.randomEvent.lastNote && save.state.randomEvent.lastTriggeredTurn !== undefined && <div className="mt-2 border-t border-parchment-600/15 pt-2 leading-relaxed text-parchment-200/70"><span className="text-gold/70">随机事件结果：</span>{save.state.randomEvent.lastNote}</div>}
    </UpdateGlow>
  </aside>;
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
    return history.filter((m) => m.role === 'assistant').map((m) => m.content).join('\n\n').trim() || '（暂无故事正文）';
  }
  return history.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => {
    const heading = `第 ${m.turn + 1} 回合`;
    if (m.role === 'user') return `${heading}\n玩家：${m.content}`;
    const thinking = mode === 'story-input-thinking' ? `\n思维链：${m.thinking?.trim() || '（无）'}` : '';
    return `${heading}\n正文：${m.content}${thinking}`;
  }).join('\n\n').trim() || '（暂无故事记录）';
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
  const storyEndRef = useRef<HTMLDivElement>(null);
  /** 玩家是否主动往上翻读（此时不要自动滚动打断）。 */
  const userScrolledUpRef = useRef(false);
  /** 首次到达用 auto（瞬时），之后的增量用 smooth，避免开局就平滑滚动一大段。 */
  const scrollBehaviorRef = useRef<ScrollBehavior>('auto');
  /** 已从 localStorage 恢复过草稿的存档 id（每个存档只恢复一次）。 */
  const draftRestoredRef = useRef<string>();
  /** 供 pagehide 落盘使用的输入快照（避免把 effect 依赖到每次按键）。 */
  const inputRef = useRef('');
  // 每次渲染都同步一次最新输入：pagehide 是同步事件，拿不到最新的 React state。
  inputRef.current = input;

  useEffect(() => () => abortRef.current?.abort(), []);

  // ---------------------------------------------------------------------------
  // 自动滚动到底部
  //
  // 规则：新内容到达时滚到底，但**用户主动往上翻读时不打断**——只有当视口已经在
  // 底部附近（或本轮刚由玩家发起）时才自动跟随。否则一边看历史一边被拽回底部。
  // 用 scrollIntoView 而不是 scrollTop：锚点就在文档流里，浏览器自己处理间距与
  // 平滑滚动，也不需要维护"底部还差多少像素"这种容易失效的常量。
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const anchor = storyEndRef.current;
    if (!anchor) return;
    if (userScrolledUpRef.current) return;
    const behavior: ScrollBehavior = scrollBehaviorRef.current;
    scrollBehaviorRef.current = 'smooth';
    anchor.scrollIntoView({ block: 'end', behavior });
  }, [save?.state.history.length, stream, activeTurn, busy, queue.length]);

  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      const remaining = doc.scrollHeight - window.scrollY - window.innerHeight;
      // 120px 是"贴底"的宽容区间：留一点余量，避免因取整误差误判为用户上翻。
      userScrolledUpRef.current = remaining > 120;
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // ---------------------------------------------------------------------------
  // 草稿保留
  //
  // 输入框内容按存档分别存入 localStorage，这样打开设置页、返回主页、或刷新后
  // 重新进入对话时输入都还在。恢复时机放在存档可用之后（首帧 save 可能还是
  // undefined），且每个存档只恢复一次，避免覆盖玩家后续的输入。
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
    // 输入变化频繁，轻量防抖即可：写入本身是同步的，但没必要每个字符都写。
    const timer = window.setTimeout(() => writeDraft(saveId, input), 250);
    return () => window.clearTimeout(timer);
  }, [input, save?.id]);

  // 关闭/刷新页面前把当前草稿落盘，避免防抖窗口内的内容丢失。
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
    // 发送后立刻跟到底部，让玩家看到自己刚发出的行动与开始生成的正文。
    userScrolledUpRef.current = false;
    scrollBehaviorRef.current = 'smooth';
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
  const exportItems = [
    { id: 'story', label: '仅导出故事正文', icon: <Download size={14} />, onClick: () => exportSaveText(save.name, save.state.history, 'story') },
    { id: 'story-input', label: '导出正文与玩家输入', icon: <Download size={14} />, onClick: () => exportSaveText(save.name, save.state.history, 'story-input') },
    { id: 'story-input-thinking', label: '导出正文、输入与思维链', icon: <Download size={14} />, onClick: () => exportSaveText(save.name, save.state.history, 'story-input-thinking') },
    { id: 'all', label: '导出全部信息（JSON）', icon: <Download size={14} />, onClick: () => exportFullJson(save.name, save.state.history, save.state.turnRecords ?? []) },
  ];
  return <div className="min-h-screen">
    <header className="sticky top-0 z-20 border-b border-gold-line-dim bg-parchment-800/90 shadow-[0_2px_18px_rgba(0,0,0,.45)] backdrop-blur-md"><div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6"><Button variant="ghost" size="sm" className="!h-10 !w-10 !px-0 rounded-full" onClick={() => void leavePage('/')} title="返回主页"><ArrowLeft size={17} /></Button><div className="min-w-0 flex-1"><div className="truncate font-serif tracking-[.08em] text-parchment-100">{save.name}</div><div className="text-[11px] text-parchment-200/50">{save.state.mode === 'author' ? '执笔模式 · 无限回合自由输入' : '游历模式 · 自由行动与命运线'} · 第 {save.state.turn} 回合</div></div><div className="hidden items-center gap-2 md:flex"><span className="rounded-full border border-gold/25 bg-ink/25 px-3 py-1 text-xs text-gold-light">{paceInfo.label}</span><DropdownMenu trigger={<Download size={16} />} items={exportItems} align="right" /><Button variant="ghost" size="sm" onClick={() => void leavePage('/settings')} title="设置"><Settings size={16} /></Button></div><div className="flex items-center gap-2 md:hidden"><DropdownMenu trigger={<Download size={16} />} items={exportItems} align="right" /><Button variant="ghost" size="sm" onClick={() => void leavePage('/settings')}><Settings size={16} /></Button></div></div></header>
    <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="min-w-0">
        <div className="rounded-xl border border-parchment-600/25 bg-ink/20 px-4 py-5 shadow-[0_12px_35px_rgba(0,0,0,.2)] sm:px-7">
          {save.state.history.length === 0 && <div className="py-20 text-center text-sm text-parchment-200/45">故事将从你的第一个行动开始。</div>}
          {save.state.history.map((message) => message.role === 'user'
            ? <article key={message.id} className="my-6 border-l-2 border-gold/55 pl-4"><div className="mb-1 text-[10px] tracking-[.28em] text-gold/65">你的行动 · 第 {message.turn + 1} 回合</div><div className="whitespace-pre-wrap font-serif text-[15px] italic leading-8 text-parchment-200/90">{message.content}</div></article>
            : <StoryArticle key={message.id} turn={message.turn} content={message.content} settled />)}
          {busy && activeItem && <article className="my-6 border-l-2 border-gold/55 pl-4"><div className="mb-1 flex items-center gap-2 text-[10px] tracking-[.28em] text-gold/65"><span>正在处理 · 第 {save.state.turn + 1} 回合</span><span className="rounded bg-gold/10 px-1.5 py-0.5 tracking-normal text-gold/70">{PACE_OPTIONS.find((option) => option.id === activeItem.pace)?.label}</span><button type="button" onClick={stopCurrentTurn} className="ml-auto rounded border border-blood/40 px-2 py-1 tracking-normal text-blood hover:bg-blood/10"><X size={11} className="mr-1 inline" />终止本轮</button></div><div className="whitespace-pre-wrap font-serif text-[15px] italic leading-8 text-parchment-200/90">{activeItem.input}</div></article>}
          <ModelActivityPanel activities={activities} thinking={thinking} busy={busy} patchStats={save.state.turnRecords?.[save.state.turnRecords.length - 1]?.patchStats} />
          {stream && <StoryArticle turn={save.state.turn} content={stream} writing />}
          {!busy && failedDraft && <article className="prose-story prose-story--settled my-8 rounded-lg border border-blood/30 bg-blood/5 p-4"><div className="mb-3 text-[10px] tracking-[.22em] text-blood">未提交的故事草稿 · 重试后将被替换</div><ReactMarkdown remarkPlugins={[remarkGfm]}>{failedDraft}</ReactMarkdown></article>}
          {/* 滚动锚点：发送后滚到这里即"到底"。放在文献卡内部、输入框之前，
              所以滚到底时底部输入框自然贴住它，不会盖住正文末尾。 */}
          <div ref={storyEndRef} className="h-px w-full" aria-hidden />
        </div>
        {save.lastTurnCheckpoint && <div className="mt-3 flex flex-wrap justify-end gap-2"><Button size="xs" variant="ghost" disabled={!canReviseLastTurn} onClick={retryLastTurn}><RotateCcw size={13} />重新生成最近回合</Button><Button size="xs" variant="ghost" disabled={!canReviseLastTurn} onClick={editLastTurn}><Pencil size={13} />修改最近输入</Button></div>}
        {error && <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-blood/50 bg-blood/10 px-4 py-3 text-sm text-blood"><span className="whitespace-pre-wrap">{error}</span>{queuePaused && queue.length > 0 && <Button size="xs" variant="outline" onClick={retryQueue}><RotateCcw size={13} />重试模型请求</Button>}</div>}
        {persistError && <div className="mt-4 rounded-lg border border-amber-400/45 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="tracking-[.12em]">进度未能写入本地存储</div>
              <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-amber-100/80">{persistError.message}</p>
              <p className="mt-2 text-[11px] leading-relaxed text-amber-100/60">
                内存中的故事仍在继续，但刷新页面后会回到最后一次成功写入的进度。建议先用右上角「导出」保存正文，再回到主页删除不再需要的旅程。
              </p>
            </div>
          </div>
        </div>}
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
      <SidePanel save={save} canEdit={settings.stateEditingEnabled !== false} />
    </main>
  </div>;
}
