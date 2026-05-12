/**
 * 提示词模板输入说明（维护用注释，不会进入模型）：
 * - 本文件不是模型服务入口，但保存严格自定义模式可覆盖的 story/decision 模板与默认变量槽。
 * - 故事模板变量包含：roundInfo、outlineBlock、masterArcBlock、stageJudgeBlock、storyArcBlock、backgroundBlock、worldBookAlwaysBlock、worldBookTriggeredBlock、summaryBlock、memoryBlock。
 * - 故事模板变量包含：outlineMappingBlock、narrativePlanBlock、narrativeBriefBlock、settingGuardBlock、logicReviewBlock、npcsBlock、anchorsBlock、backpackBlock、currentSceneBlock。
 * - 故事模板变量包含：strictCustomBlock、usedItemsBlock、writingRulesBlock、styleAddendumBlock、specialBlock、defaultUserMessage 等。
 * - 决策模板变量包含：summaryBlock、longTermMemoryBlock、recentTextBlock、latestStory、backpackSummary、backpackJsonBlock、npcBlock、npcJsonBlock、anchorsBlock。
 * - 决策模板变量包含：currentSceneBlock、stageNarrativeBlock、narrativePlanBlock、activeArcsBlock、strictCustomDecisionBlock、defaultDecisionUserPrompt。
 * - buildStrictCustomStoryBlock 额外读取：全局叙事约束、推进粒度、隐藏设定揭示规则。
 * - buildStrictCustomDecisionBlock 额外读取：严格自定义选项规则。
 */
import type { StrictCustomConfig } from '@/types/custom';
import { DECISION_SYSTEM } from '@/prompts/decisionSystem';

export const DEFAULT_STORY_SYSTEM_TEMPLATE = `{{roundInfo}}
{{outlineBlock}}
{{masterArcBlock}}
{{stageJudgeBlock}}
{{storyArcBlock}}
{{backgroundBlock}}
{{worldBookAlwaysBlock}}
{{worldBookTriggeredBlock}}
{{summaryBlock}}
{{memoryBlock}}
{{outlineMappingBlock}}
{{narrativePlanBlock}}
{{narrativeBriefBlock}}
{{settingGuardBlock}}
{{logicReviewBlock}}
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

export const DEEPSEEK_COMPAT_STORY_SYSTEM_TEMPLATE = `叙述人称必须完全服从下方【写作规范】中的人称规则；不要因历史文本里的"你/我/主角姓名"示例而切回旧人称。
{{roundInfo}}
{{outlineBlock}}
{{masterArcBlock}}
{{stageJudgeBlock}}
{{storyArcBlock}}
{{backgroundBlock}}
{{worldBookAlwaysBlock}}
{{worldBookTriggeredBlock}}
{{summaryBlock}}
{{memoryBlock}}
{{outlineMappingBlock}}
{{narrativePlanBlock}}
{{narrativeBriefBlock}}
{{settingGuardBlock}}
{{logicReviewBlock}}
{{npcsBlock}}
{{anchorsBlock}}
{{backpackBlock}}
{{currentSceneBlock}}
{{strictCustomBlock}}
{{usedItemsBlock}}
{{writingRulesBlock}}
{{styleAddendumBlock}}
{{specialBlock}}

请只输出本回合故事正文。你可以描写环境、NPC 反应和即时后果，但不要替玩家做出超出输入的关键决定。`;

export const COMPACT_STORY_SYSTEM_TEMPLATE = `基于以下上下文，只写本回合直接发生的剧情。
{{roundInfo}}
{{masterArcBlock}}
{{stageJudgeBlock}}
{{storyArcBlock}}
{{worldBookAlwaysBlock}}
{{memoryBlock}}
{{outlineMappingBlock}}
{{narrativeBriefBlock}}
{{settingGuardBlock}}
{{npcsBlock}}
{{anchorsBlock}}
{{currentSceneBlock}}
{{strictCustomBlock}}
{{usedItemsBlock}}
{{writingRulesBlock}}
{{styleAddendumBlock}}
{{specialBlock}}

若缺少信息，以已知设定和玩家最新输入为准；不要补无关长篇背景。`;

export const FOCUSED_STORY_USER_TEMPLATE = `{{defaultUserMessage}}

请优先处理玩家本回合输入中最关键的一步，并停在自然的下一压力点。`;

export const DEFAULT_DECISION_USER_TEMPLATE = `{{summaryBlock}}
{{longTermMemoryBlock}}
{{recentTextBlock}}
【玩家最新看到的故事片段】
{{latestStory}}

【玩家当前能力】
{{backpackSummary}}
{{backpackJsonBlock}}
{{npcBlock}}
{{npcJsonBlock}}
{{anchorsBlock}}
{{currentSceneBlock}}
{{stageNarrativeBlock}}
{{narrativePlanBlock}}
{{activeArcsBlock}}
{{strictCustomDecisionBlock}}
请按协议输出 JSON。注意：
- choices 应服务于上方【当前导演计划】的下一回合焦点和【进行中事件弧】的当前阶段（若有）；与计划无关的随性 choices 应避免；
- 若存在【阶段化叙事 / 玩家节奏】，choices 必须贴合其中的本回合聚焦；玩家处于沉浸/探索节奏时，选项应更微观，不要催促跳阶段；
- grants 不要与能力重名；
- 修改/删除已有能力时优先使用【当前能力 JSON】里的 id；新能力才放 grants；
- destroys / itemPatches 的 name 必须与能力列表中某项的 name 完全一致，能给 id 就必须给 id；
- 修改/删除已有 NPC 时优先使用【当前已知 NPC JSON】里的 id；同一人物称呼变化时 update 原 id，不要新建；
- 新 NPC 可用 affinity 直接设定初始好感；已有 NPC 可用 affinity 设定当前好感或 affinityDelta 表示变化；
- npcs.details 可记录主角已知外观/服装/习惯/关系猜测，如"粉色美甲""上次见面穿 JK 服""我怀疑她可能暗恋某人"；
- 修订 details 时先比对【长期一致性记忆】，已固化稳定事实不要重复；与玩家标记记忆、当前导演计划或进行中事件弧相关的细节优先保留；
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
    '隐藏能力、身份秘密、幕后真相、世界机制只作为幕后设定保持一致；除非玩家明确尝试、调查或触发，否则不要写进正文。',
  choicePrompt:
    '选项应围绕当前压力点给出 3~4 个差异明确的行动，不要提前替玩家解决危机，也不要把隐藏设定作为选项前提。',
  promptOverrideEnabled: false,
  storySystemPrompt: DEFAULT_STORY_SYSTEM_TEMPLATE,
  storyUserPrompt: DEFAULT_STORY_USER_TEMPLATE,
  decisionSystemPrompt: DECISION_SYSTEM,
  decisionUserPrompt: DEFAULT_DECISION_USER_TEMPLATE,
};

export function normalizeStrictCustomConfig(input?: Partial<StrictCustomConfig>): StrictCustomConfig {
  const base = DEFAULT_STRICT_CUSTOM_CONFIG;
  const promptTemplate = (value: string | undefined, fallback: string, limit = 8000) => {
    const trimmed = (value ?? '').trim();
    return (trimmed || fallback).slice(0, limit);
  };

  return {
    enabled: Boolean(input?.enabled),
    globalPrompt: (input?.globalPrompt ?? base.globalPrompt).trim().slice(0, 2000),
    pacingPrompt: (input?.pacingPrompt ?? base.pacingPrompt).trim().slice(0, 2000),
    revealPrompt: (input?.revealPrompt ?? base.revealPrompt).trim().slice(0, 2000),
    choicePrompt: (input?.choicePrompt ?? base.choicePrompt).trim().slice(0, 2000),
    promptOverrideEnabled: Boolean(input?.promptOverrideEnabled),
    storySystemPrompt: promptTemplate(input?.storySystemPrompt, base.storySystemPrompt),
    storyUserPrompt: promptTemplate(input?.storyUserPrompt, base.storyUserPrompt),
    decisionSystemPrompt: promptTemplate(input?.decisionSystemPrompt, base.decisionSystemPrompt),
    decisionUserPrompt: promptTemplate(input?.decisionUserPrompt, base.decisionUserPrompt),
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

export function buildStrictCustomStoryBlock(
  config: StrictCustomConfig | undefined,
  round: number,
): string {
  if (!config?.enabled) return '';
  const normalized = normalizeStrictCustomConfig(config);
  const lines: string[] = [
    '【严格自定义模式】',
    '以下规则优先级高于常规故事大纲、世界书和默认写作习惯；若发生冲突，以本节为准。',
  ];

  if (normalized.globalPrompt) lines.push('', '【全局叙事约束】', normalized.globalPrompt);
  if (normalized.pacingPrompt) lines.push('', '【推进粒度】', normalized.pacingPrompt);
  if (normalized.revealPrompt) lines.push('', '【隐藏设定揭示规则】', normalized.revealPrompt);

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
  if (!normalized.promptOverrideEnabled) return DEFAULT_STORY_SYSTEM_TEMPLATE;
  return normalized.storySystemPrompt || DEFAULT_STORY_SYSTEM_TEMPLATE;
}

export function getStoryUserTemplate(config: StrictCustomConfig | undefined): string {
  if (!config?.enabled) return DEFAULT_STORY_USER_TEMPLATE;
  const normalized = normalizeStrictCustomConfig(config);
  if (!normalized.promptOverrideEnabled) return DEFAULT_STORY_USER_TEMPLATE;
  return normalized.storyUserPrompt || DEFAULT_STORY_USER_TEMPLATE;
}

export function getDecisionSystemTemplate(config: StrictCustomConfig | undefined): string {
  if (!config?.enabled) return DECISION_SYSTEM;
  const normalized = normalizeStrictCustomConfig(config);
  if (!normalized.promptOverrideEnabled) return DECISION_SYSTEM;
  return normalized.decisionSystemPrompt || DECISION_SYSTEM;
}

export function getDecisionUserTemplate(config: StrictCustomConfig | undefined): string {
  if (!config?.enabled) return DEFAULT_DECISION_USER_TEMPLATE;
  const normalized = normalizeStrictCustomConfig(config);
  if (!normalized.promptOverrideEnabled) return DEFAULT_DECISION_USER_TEMPLATE;
  return normalized.decisionUserPrompt || DEFAULT_DECISION_USER_TEMPLATE;
}
