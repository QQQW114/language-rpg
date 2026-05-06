import { CheckCircle2, Circle, FastForward, Gauge, RotateCw, Sparkles } from 'lucide-react';
import { Card, CardMeta, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useGameStore } from '@/store/useGameStore';
import type { AuthorNarrativeState, PlayerPace } from '@/types/game';
import { ThinkToggle } from '@/components/ThinkToggle';

function paceLabel(pace: PlayerPace): string {
  switch (pace) {
    case 'immersive': return '沉浸';
    case 'exploratory': return '探索';
    case 'progressing': return '推进';
    case 'hurrying': return '快进';
  }
}

export function MasterArcPanel({
  saveId,
  narrative,
  onRegenerate,
  regenerating,
}: {
  saveId: string;
  narrative?: AuthorNarrativeState;
  onRegenerate?: () => void;
  regenerating?: boolean;
}) {
  const masterArc = narrative?.masterArc;
  const judge = narrative?.stageJudge;
  const current = masterArc?.stages[masterArc.currentStageIndex];
  const actions = useGameStore.getState();

  if (!masterArc || !current) {
    return (
      <Card>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles size={16} /> 主弧
        </CardTitle>
        <CardMeta>阶段化叙事尚未初始化。新建执笔旅程时会自动生成主弧。</CardMeta>
        {onRegenerate && (
          <Button
            className="mt-3 w-full"
            size="sm"
            variant="outline"
            loading={regenerating}
            onClick={onRegenerate}
          >
            <RotateCw size={14} /> 生成主弧
          </Button>
        )}
      </Card>
    );
  }

  const achieved = current.expectedBeats.filter((b) => b.status === 'achieved').length;
  const total = current.expectedBeats.length;
  const progress = judge?.stageStatus.currentStageId === current.id
    ? judge.stageStatus.completion
    : total > 0
      ? Math.round((achieved / total) * 100)
      : 0;

  return (
    <Card>
      <CardTitle className="flex items-center gap-2 text-base">
        <Sparkles size={16} /> 主弧 · {masterArc.title}
      </CardTitle>
      <CardMeta>阶段不再按回合硬推进，而由剧情条件和玩家节奏判断。</CardMeta>

      <details className="mb-2 rounded border border-parchment-600/35 bg-parchment-900/30 px-3 py-2">
        <summary className="cursor-pointer list-none text-xs text-gold-light">整体走向</summary>
        <div className="mt-2 text-xs leading-relaxed text-parchment-200/75">{masterArc.summary}</div>
        <ThinkToggle content={masterArc.thinking} compact />
      </details>

      <div className="mb-3 space-y-1">
        {masterArc.stages.map((stage, index) => {
          const active = index === masterArc.currentStageIndex;
          const done = stage.status === 'completed';
          return (
            <div
              key={stage.id}
              className={`flex items-center gap-2 rounded px-2 py-1 text-xs transition-all duration-500 ${
                active ? 'bg-gold/10 text-gold-light' : done ? 'text-parchment-100/80' : 'text-parchment-200/45'
              }`}
            >
              {done ? <CheckCircle2 size={13} /> : active ? <Gauge size={13} /> : <Circle size={13} />}
              <span className="truncate">{stage.name}</span>
              {active && <span className="ml-auto text-[11px] tabular-nums transition-all duration-500">{progress}%</span>}
            </div>
          );
        })}
      </div>

      <div className="rounded border border-gold/30 bg-gold/10 px-3 py-2 text-xs leading-relaxed text-parchment-100/85">
        <div className="mb-1 text-[11px] tracking-[0.25em] text-gold/80 uppercase">当前阶段</div>
        <div className="font-serif text-sm text-gold-light">{current.name}</div>
        <div className="mt-1 text-parchment-200/75">{current.description}</div>
        {!!current.completionConditions.length && (
          <div className="mt-2">
            <div className="text-parchment-100">完成条件</div>
            {current.completionConditions.map((cond, index) => (
              <div key={index} className="text-parchment-200/65">○ {cond}</div>
            ))}
          </div>
        )}
        {!!current.expectedBeats.length && (
          <div className="mt-2">
            <div className="text-parchment-100">期望节拍</div>
            {current.expectedBeats.map((beat) => (
              <div key={beat.id} className={beat.status === 'achieved' ? 'text-gold-light' : 'text-parchment-200/65'}>
                {beat.status === 'achieved' ? '✓' : '○'} {beat.description}
              </div>
            ))}
          </div>
        )}
      </div>

      {judge && (
        <div className="mt-2 rounded border border-parchment-600/35 bg-parchment-900/30 px-3 py-2 text-xs leading-relaxed">
          <div className="mb-1 flex items-center gap-2 text-gold-light">
            <FastForward size={13} /> 阶段判断 · {paceLabel(judge.playerPace)}
          </div>
          <div className="text-parchment-100">玩家意图：{judge.playerIntent.primary}</div>
          <div className="mt-1 text-parchment-200/70">本回合聚焦：{judge.storyFocus.thisRound}</div>
          {!!judge.storyFocus.avoid?.length && (
            <div className="mt-1 text-parchment-200/50">避免：{judge.storyFocus.avoid.join('；')}</div>
          )}
          {judge.lastError && (
            <div className="mt-1 text-blood/80">判断记录：{judge.lastError}</div>
          )}
          <ThinkToggle content={judge.thinking} compact />
        </div>
      )}

      <Button
        className="mt-3 w-full"
        size="sm"
        variant="outline"
        onClick={() => actions.advanceMasterArcStage(saveId, '玩家手动标记当前阶段完成')}
        disabled={masterArc.currentStageIndex >= masterArc.stages.length - 1}
      >
        手动标记此阶段完成
      </Button>
      {onRegenerate && (
        <Button
          className="mt-2 w-full"
          size="sm"
          variant="ghost"
          loading={regenerating}
          onClick={onRegenerate}
        >
          <RotateCw size={14} /> 重新生成主弧
        </Button>
      )}
    </Card>
  );
}
