import type { StrictCustomConfig, StrictRoundDirective } from '@/types/custom';

export const DEFAULT_STRICT_CUSTOM_CONFIG: StrictCustomConfig = {
  enabled: false,
  globalPrompt:
    '严格遵循玩家上一条输入的意图，只写本回合直接后果；不要替玩家完成未选择的关键行动，不要主动提供解决方案。',
  pacingPrompt:
    '每回合只推进一个清晰的剧情 beat。若玩家选择等待、观察、拖延、试探，应优先描写环境或 NPC 的即时反应，并停在新的压力点。',
  revealPrompt:
    '隐藏能力、身份秘密、幕后真相、世界机制只作为幕后设定保持一致；除非玩家明确尝试、调查、触发，或详细大纲指定揭示，否则不要写进正文。',
  choicePrompt:
    '选项应围绕当前压力点给出 3~4 个差异明确的行动，不要提前替玩家解决危机，也不要把隐藏设定作为选项前提。',
  detailedOutline: [],
};

function clampRound(n: unknown, fallback: number): number {
  const num = Math.floor(Number(n));
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(999, num));
}

export function normalizeStrictCustomConfig(input?: Partial<StrictCustomConfig>): StrictCustomConfig {
  const base = DEFAULT_STRICT_CUSTOM_CONFIG;
  const detailedOutline = (input?.detailedOutline ?? [])
    .map((item, index) => {
      const start = clampRound(item.startRound, 1);
      const end = clampRound(item.endRound, start);
      const startRound = Math.min(start, end);
      const endRound = Math.max(start, end);
      return {
        id: item.id || `strict_${index}_${Date.now().toString(36)}`,
        startRound,
        endRound,
        prompt: (item.prompt ?? '').trim().slice(0, 2000),
      };
    })
    .filter((item) => item.prompt)
    .sort((a, b) => a.startRound - b.startRound || a.endRound - b.endRound);

  return {
    enabled: Boolean(input?.enabled),
    globalPrompt: (input?.globalPrompt ?? base.globalPrompt).trim().slice(0, 2000),
    pacingPrompt: (input?.pacingPrompt ?? base.pacingPrompt).trim().slice(0, 2000),
    revealPrompt: (input?.revealPrompt ?? base.revealPrompt).trim().slice(0, 2000),
    choicePrompt: (input?.choicePrompt ?? base.choicePrompt).trim().slice(0, 2000),
    detailedOutline,
  };
}

export function getActiveRoundDirectives(
  config: StrictCustomConfig | undefined,
  round: number,
): StrictRoundDirective[] {
  if (!config?.enabled) return [];
  return (config.detailedOutline ?? []).filter((item) =>
    round >= item.startRound && round <= item.endRound && item.prompt.trim(),
  );
}

export function buildStrictCustomStoryBlock(
  config: StrictCustomConfig | undefined,
  round: number,
): string {
  if (!config?.enabled) return '';
  const normalized = normalizeStrictCustomConfig(config);
  const active = getActiveRoundDirectives(normalized, round);
  const lines: string[] = [
    '【严格自定义模式】',
    '以下规则优先级高于常规故事大纲、世界书和默认写作习惯；若发生冲突，以本节为准。',
  ];

  if (normalized.globalPrompt) lines.push('', '【全局叙事约束】', normalized.globalPrompt);
  if (normalized.pacingPrompt) lines.push('', '【推进粒度】', normalized.pacingPrompt);
  if (normalized.revealPrompt) lines.push('', '【隐藏设定揭示规则】', normalized.revealPrompt);

  if (active.length) {
    lines.push('', `【第 ${round} 回合适用的详细大纲】`);
    for (const item of active) {
      lines.push(`· [${item.startRound}]-[${item.endRound}] 回合：${item.prompt}`);
    }
    lines.push('请优先贴合以上详细大纲，但仍只写本回合直接发生的内容。');
  }

  return lines.join('\n');
}

export function buildStrictCustomDecisionBlock(config: StrictCustomConfig | undefined): string {
  if (!config?.enabled) return '';
  const normalized = normalizeStrictCustomConfig(config);
  if (!normalized.choicePrompt) return '';
  return [
    '【严格自定义模式 · 选项规则】',
    normalized.choicePrompt,
  ].join('\n');
}

