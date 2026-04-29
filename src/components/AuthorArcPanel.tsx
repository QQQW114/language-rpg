import { ChevronDown, ScrollText } from 'lucide-react';
import { Card, CardMeta, CardTitle } from '@/components/ui/Card';
import type { AuthorNarrativeState, AuthorRandomEventState, StoryArc } from '@/types/game';

function ArcItem({ arc, muted }: { arc: StoryArc; muted?: boolean }) {
  const stage = arc.stages[arc.currentStageIndex] ?? arc.stages[0];
  return (
    <details className="group rounded border border-parchment-600/35 bg-parchment-900/30 px-3 py-2" open={!muted}>
      <summary className="flex cursor-pointer list-none items-start gap-2">
        <ChevronDown size={14} className="mt-0.5 text-gold/70 transition-transform group-open:rotate-180" />
        <div className="min-w-0 flex-1">
          <div className={`truncate text-sm font-serif ${muted ? 'text-parchment-200/70' : 'text-parchment-50'}`}>
            {arc.title}
          </div>
          <div className="text-[11px] text-parchment-200/55">
            {arc.targetEndRound ? `第 ${arc.startRound}-${arc.targetEndRound} 回合` : `第 ${arc.startRound} 回合起`}
            {' · '}
            {arc.status === 'pending' ? '待注入' : arc.status === 'active' ? '进行中' : '已结束'}
          </div>
        </div>
      </summary>
      <div className="mt-2 space-y-1 pl-6 text-xs leading-relaxed text-parchment-200/70">
        <div>{arc.summary}</div>
        {stage && (
          <div className="text-parchment-100/80">
            当前阶段：{stage.title}（第 {stage.startRound}-{stage.endRound} 回合）
          </div>
        )}
        {arc.progressNote && <div className="italic text-parchment-200/55">{arc.progressNote}</div>}
      </div>
    </details>
  );
}

export function AuthorArcPanel({
  narrative,
  randomEventState,
}: {
  narrative?: AuthorNarrativeState;
  randomEventState?: AuthorRandomEventState;
}) {
  const pending = randomEventState?.pendingEvent ? [randomEventState.pendingEvent] : [];
  const plan = narrative?.plan;
  const active = [
    ...(randomEventState?.activeEvents ?? []),
    ...(narrative?.activeArcs ?? []),
  ];
  const completed = [
    ...(randomEventState?.completedEvents ?? []),
    ...(narrative?.completedArcs ?? []),
  ].slice(-8).reverse();
  const hasAny = plan || pending.length || active.length || completed.length || randomEventState?.lastError;

  return (
    <Card>
      <CardTitle className="flex items-center gap-2 text-base">
        <ScrollText size={16} /> 叙事弧
      </CardTitle>
      <CardMeta>执笔模式的长线事件、章节弧与已触发事件。</CardMeta>
      {!hasAny && (
        <div className="text-xs text-parchment-200/60 leading-relaxed">
          暂无进行中的长线事件。若启用了剧情驱动随机事件，系统会在合适回合自动生成。
        </div>
      )}
      {plan && (
        <div className="mb-2 rounded border border-gold/30 bg-gold/10 px-3 py-2 text-xs leading-relaxed text-parchment-100/85">
          <div className="text-[11px] tracking-[0.25em] text-gold/80 uppercase mb-1">当前导演计划</div>
          {plan.currentStage && <div>阶段：{plan.currentStage}</div>}
          {plan.stageGoal && <div>目标：{plan.stageGoal}</div>}
          {plan.nextRoundFocus && <div>下一回合：{plan.nextRoundFocus}</div>}
        </div>
      )}
      {narrative?.logicReview && (
        <details className="mb-2 rounded border border-parchment-600/35 bg-parchment-900/30 px-3 py-2">
          <summary className="cursor-pointer list-none text-xs text-gold-light">
            逻辑审校 · 第 {narrative.logicReview.updatedAtRound} 回合
            {narrative.logicReview.issues.length > 0 && (
              <span className="ml-2 text-blood/80">风险 {narrative.logicReview.issues.length}</span>
            )}
          </summary>
          <div className="mt-2 space-y-1 text-xs leading-relaxed text-parchment-200/70">
            <div>{narrative.logicReview.overall}</div>
            {narrative.logicReview.repairDirectives.slice(0, 4).map((item, index) => (
              <div key={index}>· {item}</div>
            ))}
          </div>
        </details>
      )}
      <div className="space-y-2">
        {pending.map((arc) => <ArcItem key={`p-${arc.id}`} arc={arc} />)}
        {active.map((arc) => <ArcItem key={`a-${arc.id}`} arc={arc} />)}
        {completed.map((arc) => <ArcItem key={`c-${arc.id}`} arc={arc} muted />)}
      </div>
      {randomEventState?.lastError && (
        <div className="mt-2 text-[11px] text-blood/80 bg-blood/10 border border-blood/40 rounded px-2 py-1">
          事件生成记录：{randomEventState.lastError}
        </div>
      )}
    </Card>
  );
}
