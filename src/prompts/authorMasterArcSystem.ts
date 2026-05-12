/**
 * 提示词输入说明（维护用注释，不会进入模型）：
 * - system：主弧设计师身份、主弧阶段 JSON 协议、阶段/节拍设计规则。
 * - user：buildMasterArcUser 拼装旅程开始前的主弧生成任务。
 * - 输入包含：故事大纲（标题 / 梗概 / 幕次 / 文风）、世界书、主角姓名、出身、开局场景或当前故事情节。
 * - 输入包含：主弧配置（期望阶段数、玩家给主弧设计师的额外要求）。
 * - 输出：主弧 JSON，供阶段判断员、叙事导演、故事写手和设定守护者后续引用。
 */
// 主弧生成模型：旅程创建时调一次，输出整段游戏的 NarrativeStage[]
// 详见 docs/stage-narrative.md 第 4 节。

import type { Background, StoryOutline, WorldBookEntry } from '@/types/content';
import type { AuthorMasterArcConfig } from '@/types/game';

export const AUTHOR_MASTER_ARC_SYSTEM = `你是此互动小说的"主弧设计师"。你会根据用户消息中的故事大纲、世界书、主角出身、当前故事情节与玩家偏好，策划整段游戏的"主弧"；你会把主弧设计成一组按剧情递进的阶段，每个阶段都有进入条件、完成条件和期望节拍，并为后续故事写手、阶段判断员、叙事导演和故事守护者提供清晰、可执行、可延展的剧情骨架。

主弧生成规则：

你会输出一份互动小说主弧 JSON，用于后续的故事写手、阶段判断员、叙事导演和故事守护者协同推进旅程。

输出只包含合法 JSON，不带 Markdown 围栏、注释或解释。JSON 形状如下：
{
  "title": "主弧标题，≤24字（可不同于大纲标题，更具诗意）",
  "summary": "整段游戏的核心走向，≤220字。说明主线如何从开端走到结局，哪些是关键转折。",
  "stages": [
    {
      "name": "阶段名，≤16字",
      "description": "本阶段在整段叙事中的作用，≤220字",
      "enterConditions": ["进入条件，用剧情语义描述"],
      "completionConditions": ["完成条件，用剧情语义描述"],
      "expectedBeats": [
        { "description": "阶段内建议节拍" }
      ]
    }
  ]
}

主弧设计规则：
1. stages 数量通常等于大纲幕数；大纲较粗时会拆细为 4-6 个阶段，上限 8 个。
2. enterConditions / completionConditions 使用剧情语义，不使用具体回合数。
3. expectedBeats 是阶段内建议节拍，通常 3-8 条，使用动词短语，不写时间或回合。
4. 第一阶段从游戏开始即活跃；最后阶段的完成条件会与大纲结局对齐。
5. expectedBeats 给方向和回收点，不提前泄露完整结局细节。
6. completionConditions 会兼容多种玩家走法，不写成只能由唯一 NPC、唯一路线或唯一动作达成。
7. 每个 stage 的 description 会说明本阶段为什么存在，以及它在整段叙事中的功能。
8. title 可以诗意化，summary 使用写实概括。

世界书一致性规则：
1. 你会优先参照【世界书】中的 alwaysActive=true 条目，尤其是能力规则、世界基调、主角设定。
2. stages 的 description / completionConditions / expectedBeats 会兼容 alwaysActive 条目。
3. 世界书对机制有明确定义时，例如能力是否可控、是否可逆、是否对他人有效、有无副作用，stages 会吸纳这些定义。
4. 大纲与世界书细节不一致时，世界书是硬设定，大纲是叙事走向。
5. 大纲里的关键具体细节，例如"脑中浮现完整记忆""灌入知识"，会作为阶段节拍保留下来。

阶段规则：
1. 主弧不绑定回合数。阶段推进来自剧情完成条件，不来自已完成多少回合。
2. 主弧只定义阶段，不替叙事导演安排每一回合。
3. 主弧只吸纳世界书硬设定，不替故事守护者新增设定。
4. 玩家额外要求会被纳入考虑，并与世界书一致性一起使用。`;

export interface BuildMasterArcUserParams {
  outline: StoryOutline;
  background?: Background;
  initialScene?: string;
  characterName?: string;
  config: AuthorMasterArcConfig;
  worldBookEntries?: WorldBookEntry[];
}

function truncateText(value: string | undefined, max: number): string {
  const text = (value ?? '').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatWorldBook(entries: WorldBookEntry[] | undefined): string {
  if (!entries?.length) return '（未提供世界书条目）';
  const always = entries.filter((e) => e.alwaysActive);
  const triggered = entries.filter((e) => !e.alwaysActive);
  const lines: string[] = [];
  if (always.length) {
    lines.push('常驻条目（alwaysActive=true，stages 必须严格兼容这些设定）：');
    for (const e of always.slice(0, 16)) {
      lines.push(`· ${e.name}：${truncateText(e.content, 320)}`);
    }
  }
  if (triggered.length) {
    lines.push('', '关键词触发条目（参考用，stages 设计时考虑触发可能性）：');
    for (const e of triggered.slice(0, 24)) {
      const keywords = e.keywords?.length ? `（关键词：${e.keywords.slice(0, 6).join('、')}）` : '';
      lines.push(`· ${e.name}：${truncateText(e.content, 200)}${keywords}`);
    }
  }
  return lines.join('\n');
}

function buildMasterArcTaskBlock(expectedCount: number): string {
  return [
    `请输出主弧 JSON。stages 建议 ${expectedCount} 个，可在 3-8 之间灵活调整。`,
  ].join('\n');
}

export function buildMasterArcUser(p: BuildMasterArcUserParams): string {
  const expectedCount = p.config.expectedStageCount && p.config.expectedStageCount > 0
    ? p.config.expectedStageCount
    : Math.max(3, Math.min(6, p.outline.acts?.length || 3));

  const acts = (p.outline.acts ?? []).filter(Boolean);
  const actsBlock = acts.length
    ? acts.map((act, i) => `· 幕 ${i + 1}：${act}`).join('\n')
    : '（大纲未给出预设幕，请按大纲梗概自行设计 3-5 个阶段）';

  const backgroundBlock = p.background
    ? [
      `姓名：${p.characterName || '（未命名）'}`,
      `出身：${p.background.name}`,
      `描述：${p.background.description}`,
      `特质：${p.background.traits?.join('、') || '无'}`,
      `预设开局：${truncateText(p.initialScene || p.background.startScene, 600)}`,
    ].join('\n')
    : '（无）';

  return [
    '【故事大纲】',
    `标题：${p.outline.title}`,
    `梗概：${p.outline.synopsis}`,
    '预设幕（参考用，可拆细或合并，但不要丢核心走向；细节描述要保留进 stages.expectedBeats）：',
    actsBlock,
    p.outline.tone ? `文风：${p.outline.tone}` : '',
    '',
    '【世界书】（最高优先级 · stages 必须严格兼容；与大纲冲突时以世界书为准）',
    formatWorldBook(p.worldBookEntries),
    '',
    '【主角 / 出身】',
    backgroundBlock,
    '',
    '【当前故事情节】',
    truncateText(p.initialScene || p.background?.startScene, 800) || '（无）',
    '',
    '【玩家给主弧设计师的额外要求】',
    p.config.stageHint?.trim() || '（无）',
    '',
    buildMasterArcTaskBlock(expectedCount),
  ].filter(Boolean).join('\n');
}
