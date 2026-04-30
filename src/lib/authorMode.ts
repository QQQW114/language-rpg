import type {
  AuthorDirectorConfig,
  AuthorLogicCheckConfig,
  AuthorMasterArcConfig,
  AuthorRandomEventConfig,
  AuthorRandomEventMode,
  AuthorSettingGuardConfig,
  AuthorStageJudgeConfig,
  GuaranteedRoundRange,
  StoryArc,
  StoryArcStage,
} from '@/types/game';
import { clamp, genId } from '@/lib/utils';

export const DEFAULT_AUTHOR_RANDOM_EVENT_CONFIG: AuthorRandomEventConfig = {
  mode: 'off',
  poolEventIds: [],
  poolOverrides: {},
  dynamic: {
    enabled: false,
    startRound: 3,
    guaranteedRanges: [],
    cooldownRounds: 4,
    baseProbability: 0.18,
    missProbabilityBonus: 0.08,
    maxProbability: 0.65,
    generatorPrompt:
      '优先参照上文已经出现的人物、关系、承诺、地点和未完成情绪，生成一个能推动主线或关系线的长线事件。',
    preferencePrompt:
      '事件应有明确目标、隐藏意图、阶段节奏和收束回合；可以参考导入的随机事件，但不要机械复刻。',
    referenceEventIds: [],
  },
};

export const DEFAULT_AUTHOR_DIRECTOR_CONFIG: AuthorDirectorConfig = {
  enabled: true,
  everyRounds: 2,
  horizonRounds: 6,
  prompt:
    '像小说编辑一样维护主线阶段、短期目标、人物关系推进和节奏。优先贴合故事大纲与玩家输入；若玩家偏离大纲，给出能自然拉回主线的下一阶段方向，而不是强行否定玩家。',
};

export const DEFAULT_AUTHOR_LOGIC_CHECK_CONFIG: AuthorLogicCheckConfig = {
  enabled: true,
  everyRounds: 3,
  prompt:
    '重点检查人物外观/关系、时间天气、场景位置、背包道具、承诺与伏笔、大纲阶段是否前后矛盾。只给未来修复建议，不要重写已发生正文。',
};

export const DEFAULT_AUTHOR_SETTING_GUARD_CONFIG: AuthorSettingGuardConfig = {
  enabled: true,
  prompt:
    '重点检查故事模型是否会违反 alwaysActive 世界书条目；优先抓"瞎发挥"的设定盲区（餐饮、出行、社交礼仪、校园规则、行业规则等）；玩家偏好画像应贴近最近 5 回合的实际选择，不要过度概括。',
  candidatesAutoAccept: false,
  ambientBeatsEnabled: true,
};

export const DEFAULT_AUTHOR_MASTER_ARC_CONFIG: AuthorMasterArcConfig = {
  enabled: true,
  stageHint: '',
  expectedStageCount: undefined,
};

export const DEFAULT_AUTHOR_STAGE_JUDGE_CONFIG: AuthorStageJudgeConfig = {
  enabled: true,
  prompt:
    '优先尊重玩家当下节奏；当玩家在观察、犹豫、内心独白或试探环境时，判定为 immersive/exploratory，并要求故事模型每回合只推进一个微节拍。',
  autoAdvance: true,
};

function positiveInt(value: unknown, fallback: number, min = 1, max = 999): number {
  const num = Math.floor(Number(value));
  if (!Number.isFinite(num)) return fallback;
  return clamp(num, min, max);
}

function clampProbability(value: unknown, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return clamp(num, 0, 1);
}

function normalizeRanges(raw: unknown): GuaranteedRoundRange[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      const obj = item as Partial<GuaranteedRoundRange>;
      const start = positiveInt(obj.startRound, 1);
      const end = positiveInt(obj.endRound, start);
      return {
        id: obj.id || genId(`range_${index}`),
        startRound: Math.min(start, end),
        endRound: Math.max(start, end),
        consumed: !!obj.consumed,
      };
    })
    .slice(0, 20);
}

export function normalizeAuthorRandomEventConfig(
  input?: Partial<AuthorRandomEventConfig>,
): AuthorRandomEventConfig {
  const base = DEFAULT_AUTHOR_RANDOM_EVENT_CONFIG;
  const mode: AuthorRandomEventMode =
    input?.mode === 'pool' || input?.mode === 'dynamic' || input?.mode === 'off'
      ? input.mode
      : base.mode;
  const dynamic: Partial<AuthorRandomEventConfig['dynamic']> = input?.dynamic ?? {};
  const baseProbability = clampProbability(dynamic.baseProbability, base.dynamic.baseProbability);
  const maxProbability = Math.max(
    baseProbability,
    clampProbability(dynamic.maxProbability, base.dynamic.maxProbability),
  );
  return {
    mode,
    poolEventIds: Array.isArray(input?.poolEventIds)
      ? Array.from(new Set(input.poolEventIds.map(String).filter(Boolean)))
      : [],
    poolOverrides: input?.poolOverrides ?? {},
    dynamic: {
      enabled: mode === 'dynamic' ? dynamic.enabled !== false : !!dynamic.enabled,
      startRound: positiveInt(dynamic.startRound, base.dynamic.startRound),
      guaranteedRanges: normalizeRanges(dynamic.guaranteedRanges),
      cooldownRounds: positiveInt(dynamic.cooldownRounds, base.dynamic.cooldownRounds, 0, 200),
      baseProbability,
      missProbabilityBonus: clampProbability(dynamic.missProbabilityBonus, base.dynamic.missProbabilityBonus),
      maxProbability,
      generatorPrompt: (dynamic.generatorPrompt ?? base.dynamic.generatorPrompt).trim().slice(0, 2000),
      preferencePrompt: (dynamic.preferencePrompt ?? base.dynamic.preferencePrompt).trim().slice(0, 2000),
      referenceEventIds: Array.isArray(dynamic.referenceEventIds)
        ? Array.from(new Set(dynamic.referenceEventIds.map(String).filter(Boolean)))
        : [],
    },
  };
}

export function normalizeAuthorDirectorConfig(
  input?: Partial<AuthorDirectorConfig>,
): AuthorDirectorConfig {
  const base = DEFAULT_AUTHOR_DIRECTOR_CONFIG;
  return {
    enabled: input?.enabled !== false,
    everyRounds: positiveInt(input?.everyRounds, base.everyRounds, 1, 20),
    horizonRounds: positiveInt(input?.horizonRounds, base.horizonRounds, 2, 30),
    prompt: (input?.prompt ?? base.prompt).trim().slice(0, 3000),
  };
}

export function normalizeAuthorLogicCheckConfig(
  input?: Partial<AuthorLogicCheckConfig>,
): AuthorLogicCheckConfig {
  const base = DEFAULT_AUTHOR_LOGIC_CHECK_CONFIG;
  return {
    enabled: input?.enabled !== false,
    everyRounds: positiveInt(input?.everyRounds, base.everyRounds, 1, 20),
    prompt: (input?.prompt ?? base.prompt).trim().slice(0, 3000),
  };
}

export function normalizeAuthorSettingGuardConfig(
  input?: Partial<AuthorSettingGuardConfig>,
): AuthorSettingGuardConfig {
  const base = DEFAULT_AUTHOR_SETTING_GUARD_CONFIG;
  return {
    enabled: input?.enabled !== false,
    prompt: (input?.prompt ?? base.prompt).trim().slice(0, 3000),
    candidatesAutoAccept: !!input?.candidatesAutoAccept,
    ambientBeatsEnabled: input?.ambientBeatsEnabled !== false,
  };
}

export function normalizeAuthorMasterArcConfig(
  input?: Partial<AuthorMasterArcConfig>,
): AuthorMasterArcConfig {
  const base = DEFAULT_AUTHOR_MASTER_ARC_CONFIG;
  const expectedStageCount = input?.expectedStageCount === undefined || input.expectedStageCount === null
    ? undefined
    : positiveInt(input.expectedStageCount, 0, 0, 8) || undefined;
  return {
    enabled: input?.enabled !== false,
    stageHint: (input?.stageHint ?? base.stageHint).trim().slice(0, 3000),
    expectedStageCount,
  };
}

export function normalizeAuthorStageJudgeConfig(
  input?: Partial<AuthorStageJudgeConfig>,
): AuthorStageJudgeConfig {
  const base = DEFAULT_AUTHOR_STAGE_JUDGE_CONFIG;
  return {
    enabled: input?.enabled !== false,
    prompt: (input?.prompt ?? base.prompt).trim().slice(0, 3000),
    autoAdvance: input?.autoAdvance !== false,
  };
}

export function currentStageForRound(arc: StoryArc, round: number): StoryArcStage | undefined {
  return arc.stages.find((stage) => round >= stage.startRound && round <= stage.endRound)
    ?? arc.stages[arc.currentStageIndex]
    ?? arc.stages[0];
}

export function formatStoryArcForPrompt(arc: StoryArc, round: number): string {
  const stage = currentStageForRound(arc, round);
  const range = arc.targetEndRound
    ? `调度参考：从记录回合 ${arc.startRound} 起，预计在 ${arc.targetEndRound} 前后自然收束（非硬性剧情期限）`
    : `调度参考：记录回合 ${arc.startRound} 起（非硬性剧情期限）`;
  const npcNames = arc.involvedNpcNames?.length ? `；涉及人物：${arc.involvedNpcNames.join('、')}` : '';
  const tags = arc.tags?.length ? `；标签：${arc.tags.join('、')}` : '';
  const lines = [
    `· ${arc.status === 'pending' ? '即将引入' : '进行中'}《${arc.title}》（${range}${npcNames}${tags}）`,
    `  事件摘要：${arc.summary}`,
    `  叙事指令：${arc.directive}`,
  ];
  if (arc.hiddenIntent) {
    lines.push(`  幕后真实意图：${arc.hiddenIntent}（仅供规划，不得在玩家未发现前直接剧透）`);
  }
  if (stage) {
    lines.push(`  当前事件阶段：「${stage.title}」——${stage.goal}`);
    if (stage.requiredBeats?.length) lines.push(`  必达节拍：${stage.requiredBeats.join('；')}`);
    if (stage.avoid) lines.push(`  避免：${stage.avoid}`);
  }
  if (arc.progressNote) lines.push(`  进度记录：${arc.progressNote}`);
  return lines.join('\n');
}
