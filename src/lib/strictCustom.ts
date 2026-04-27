import type { StrictCustomConfig, StrictRoundDirective } from '@/types/custom';
import { DECISION_SYSTEM } from '@/prompts/decisionSystem';

export const DEFAULT_STORY_SYSTEM_TEMPLATE = `你是一位世界顶级的互动小说主持人（TRPG GM），正在与玩家共同完成一段长篇角色扮演。
{{roundInfo}}
{{outlineBlock}}
{{backgroundBlock}}
{{worldBookAlwaysBlock}}
{{worldBookTriggeredBlock}}
{{summaryBlock}}
{{memoryBlock}}
{{npcsBlock}}
{{anchorsBlock}}
{{backpackBlock}}
{{currentSceneBlock}}
{{strictCustomBlock}}
{{usedItemsBlock}}
{{writingRulesBlock}}
{{styleAddendumBlock}}
{{specialBlock}}

现在，请根据最近的对话上下文与玩家最新的输入，输出本回合的故事推进。除正文外不要输出任何前言、标题或解释说明。`;

export const DEFAULT_STORY_USER_TEMPLATE = `{{defaultUserMessage}}`;

export const DEFAULT_DECISION_USER_TEMPLATE = `{{summaryBlock}}
{{recentTextBlock}}
【玩家最新看到的故事片段】
{{latestStory}}

【玩家当前背包】
{{backpackSummary}}
{{backpackJsonBlock}}
{{npcBlock}}
{{npcJsonBlock}}
{{currentSceneBlock}}
{{strictCustomDecisionBlock}}
请按协议输出 JSON。注意：
- grants 不要与背包重名；
- 修改/删除已有道具时优先使用【当前背包 JSON】里的 id；新物品才放 grants；
- destroys / itemPatches 的 name 必须与背包中某件道具 name 完全一致，能给 id 就必须给 id；
- 修改/删除已有 NPC 时优先使用【当前已知 NPC JSON】里的 id；同一人物称呼变化时 update 原 id，不要新建；
- 新 NPC 可用 affinity 直接设定初始好感；已有 NPC 可用 affinity 设定当前好感或 affinityDelta 表示变化；
- npcs.details 可记录主角已知外观/服装/习惯/关系猜测，如"粉色美甲""上次见面穿 JK 服""我怀疑她可能暗恋某人"；
- npcs 的 role / description / note 只能写主角已知信息；不了解就写"我不知道"/"我不了解"或省略；
- currentScene 必须贴合最新故事叙述，并同时输出 time 与 weather；availableScenes 只列直接相邻可达处。
- 没有就是空数组或缺省。`;

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
  storySystemPrompt: DEFAULT_STORY_SYSTEM_TEMPLATE,
  storyUserPrompt: DEFAULT_STORY_USER_TEMPLATE,
  decisionSystemPrompt: DECISION_SYSTEM,
  decisionUserPrompt: DEFAULT_DECISION_USER_TEMPLATE,
  detailedOutline: [],
};

function clampRound(n: unknown, fallback: number): number {
  const num = Math.floor(Number(n));
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(999, num));
}

export function normalizeStrictCustomConfig(input?: Partial<StrictCustomConfig>): StrictCustomConfig {
  const base = DEFAULT_STRICT_CUSTOM_CONFIG;
  const promptTemplate = (value: string | undefined, fallback: string, limit = 8000) => {
    const trimmed = (value ?? '').trim();
    return (trimmed || fallback).slice(0, limit);
  };
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
    storySystemPrompt: promptTemplate(input?.storySystemPrompt, base.storySystemPrompt),
    storyUserPrompt: promptTemplate(input?.storyUserPrompt, base.storyUserPrompt),
    decisionSystemPrompt: promptTemplate(input?.decisionSystemPrompt, base.decisionSystemPrompt),
    decisionUserPrompt: promptTemplate(input?.decisionUserPrompt, base.decisionUserPrompt),
    detailedOutline,
  };
}

export function renderPromptTemplate(
  text: string,
  vars: Record<string, string | number | undefined>,
): string {
  const rendered = text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = vars[key];
    return value === undefined || value === null ? '' : String(value);
  });
  return rendered
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

export function getStorySystemTemplate(config: StrictCustomConfig | undefined): string {
  if (!config?.enabled) return DEFAULT_STORY_SYSTEM_TEMPLATE;
  const normalized = normalizeStrictCustomConfig(config);
  return normalized.storySystemPrompt || DEFAULT_STORY_SYSTEM_TEMPLATE;
}

export function getStoryUserTemplate(config: StrictCustomConfig | undefined): string {
  if (!config?.enabled) return DEFAULT_STORY_USER_TEMPLATE;
  const normalized = normalizeStrictCustomConfig(config);
  return normalized.storyUserPrompt || DEFAULT_STORY_USER_TEMPLATE;
}

export function getDecisionSystemTemplate(config: StrictCustomConfig | undefined): string {
  if (!config?.enabled) return DECISION_SYSTEM;
  const normalized = normalizeStrictCustomConfig(config);
  return normalized.decisionSystemPrompt || DECISION_SYSTEM;
}

export function getDecisionUserTemplate(config: StrictCustomConfig | undefined): string {
  if (!config?.enabled) return DEFAULT_DECISION_USER_TEMPLATE;
  const normalized = normalizeStrictCustomConfig(config);
  return normalized.decisionUserPrompt || DEFAULT_DECISION_USER_TEMPLATE;
}
