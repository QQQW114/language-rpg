import type { AuthorNarrativeState, NarrativeStage, PlayerPace, StageJudgeState } from '@/types/game';

export function playerPaceLabel(pace: PlayerPace): string {
  switch (pace) {
    case 'immersive':
      return 'immersive / 沉浸细描';
    case 'exploratory':
      return 'exploratory / 试探探索';
    case 'progressing':
      return 'progressing / 主动推进';
    case 'hurrying':
      return 'hurrying / 快进压缩';
  }
}

function formatStageLine(stage: NarrativeStage | undefined): string[] {
  if (!stage) return [];
  const lines = [
    `当前阶段：${stage.name}（${stage.id}）`,
    `阶段目标：${stage.description}`,
  ];
  if (stage.completionConditions?.length) {
    lines.push(`完成条件：${stage.completionConditions.join('；')}`);
  }
  const pending = stage.expectedBeats?.filter((beat) => beat.status !== 'achieved') ?? [];
  if (pending.length) {
    lines.push(`待完成节拍：${pending.slice(0, 8).map((beat) => `${beat.id}:${beat.description}`).join('；')}`);
  }
  return lines;
}

function formatJudgeLines(judge: StageJudgeState | undefined): string[] {
  if (!judge) return [];
  const lines = [
    `玩家意图：${judge.playerIntent.primary}`,
    `玩家节奏：${playerPaceLabel(judge.playerPace)}`,
    `本回合聚焦：${judge.storyFocus.thisRound}`,
  ];
  if (judge.playerIntent.secondary?.length) {
    lines.push(`顺带诉求：${judge.playerIntent.secondary.join('；')}`);
  }
  if (judge.playerIntent.implicit) {
    lines.push(`隐含意图：${judge.playerIntent.implicit}`);
  }
  if (judge.storyFocus.avoid?.length) {
    lines.push(`本回合避免：${judge.storyFocus.avoid.join('；')}`);
  }
  if (judge.stageStatus.advanceReasoning) {
    lines.push(`阶段判断：${judge.stageStatus.advanceReasoning}`);
  }
  if (judge.lastError) {
    lines.push(`阶段判断错误记录：${judge.lastError}`);
  }
  return lines;
}

export function formatStageNarrativeForPrompt(narrative: AuthorNarrativeState | undefined): string {
  const masterArc = narrative?.masterArc;
  const currentIndex = masterArc?.currentStageIndex ?? 0;
  const current = masterArc?.stages[currentIndex];
  const next = masterArc?.stages[currentIndex + 1];
  const judge = narrative?.stageJudge;
  if (!masterArc && !judge) return '';

  const lines: string[] = ['【阶段化叙事 / 玩家节奏】'];
  if (masterArc) {
    lines.push(`主弧：${masterArc.title}`);
    if (masterArc.summary) lines.push(`主弧走向：${masterArc.summary}`);
  }
  lines.push(...formatStageLine(current));
  if (next) {
    lines.push(`下一阶段参考（不可主动硬推）：${next.name} —— ${next.description.slice(0, 80)}`);
  }
  lines.push(...formatJudgeLines(judge));
  if (lines.length === 1) return '';
  return lines.join('\n');
}
