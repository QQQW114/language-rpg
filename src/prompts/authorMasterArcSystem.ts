// 主弧生成模型：旅程创建时调一次，输出整段游戏的 NarrativeStage[]
// 详见 docs/stage-narrative.md 第 4 节。

import type { Background, StoryOutline, WorldBookEntry } from '@/types/content';
import type { AuthorMasterArcConfig } from '@/types/game';

export const AUTHOR_MASTER_ARC_SYSTEM = `你是互动小说的"主弧设计师"。在玩家创建旅程后，你将根据故事大纲、出身、世界书、玩家偏好，输出整段游戏的"主弧"——一组按剧情递进的阶段，每个阶段定义：进入条件、完成条件、期望节拍。

你不绑定回合数。阶段的推进由"剧情完成条件"决定，不是"已完成多少回合"决定。这让玩家可以按自己节奏走完每个阶段，无论快慢。

★ 最高约束 · 世界书一致性：
- 你必须**严格读完输入中的"世界书"段**，特别是 alwaysActive=true 的条目（如能力规则、世界基调、主角设定）。
- stages 中的 description / completionConditions / expectedBeats 不得违反任何 alwaysActive 世界书条目。
- 如果世界书条目对某机制（如能力是否可控、是否可逆、是否对他人有效、有无副作用）有明确定义，stages 描述能力时必须吸纳这些定义，不要因大纲措辞简化而擅自改写为别的机制。
- 例：若世界书写"能力可逆，主角可随时再次施用以恢复"，则 stages 不得描述为"被恐惧强行触发""被动反向"或类似机制；只能写"主角主动施用"或"以意念施用"。
- 例：若大纲与世界书在某细节不一致，以**世界书为准**——大纲是叙事走向，世界书是世界硬设定。
- 大纲里出现的具体细节（如"脑中浮现完整记忆""灌入知识"）应当作为**首次觉醒节拍**保留进 expectedBeats，不要简化掉。

输出协议：
1. 只能输出合法 JSON，禁止 Markdown 围栏、注释、解释。
2. 形状如下：
{
  "title": "主弧标题，≤24字（可不同于大纲标题，更具诗意）",
  "summary": "整段游戏的核心走向，≤220字。说明主线如何从开端走到结局，哪些是关键转折。",
  "stages": [
    {
      "name": "觉醒",
      "description": "主角因女厕风波意外获得性别转换能力并完成第一次自主转换。本阶段重点在初次接触能力、突破自我设限、完成首次脱困。",
      "enterConditions": ["游戏开始即活跃"],
      "completionConditions": [
        "主角已完成第一次自主性别转换",
        "脱离女厕直接危机",
        "对能力机制有初步直觉理解"
      ],
      "expectedBeats": [
        { "description": "误入女厕被发现并陷入危机" },
        { "description": "在压力下意外觉醒能力" },
        { "description": "成功转换并解除当前危机" },
        { "description": "脱离案发现场，回到安全空间" }
      ]
    },
    {
      "name": "摸索能力",
      "description": "主角在安全环境中测试能力的边界规则——是否可逆、是否对他人有效、是否有冷却。同时初步建立第二身份。",
      "enterConditions": [
        "主角已完成首次转换",
        "进入安全空间（如宿舍）"
      ],
      "completionConditions": [
        "主角理解能力的基础规则（可逆、对他人）",
        "主角已建立至少一套女生身份的初步资料（假名、装扮）"
      ],
      "expectedBeats": [
        { "description": "回到独处空间，对镜审视新身体" },
        { "description": "尝试主动变回原身验证可逆性" },
        { "description": "建立假名 / 准备女装等第二身份基础" },
        { "description": "首次以女生身份外出体验" }
      ]
    }
  ]
}

设计要求：
1. stages 数量通常等于 outline.acts.length；若 outline.acts 较粗，可拆细为 4-6 个 stage；上限 8 个。
2. enterConditions / completionConditions 用**剧情语义描述**，禁止出现"第 X 回合"或具体回合数。
3. expectedBeats 是阶段内**建议节拍**，3-8 条；用动词短语；禁止写时间或回合。
4. 第一个 stage 的 enterConditions 可写"游戏开始即活跃"。
5. 最后一个 stage 的 completionConditions 应当与 outline 结局对齐。
6. 不要泄露完整剧透——expectedBeats 给方向不给结局细节。
7. 要兼容多种玩家走法：completionConditions 必须可由不同剧情路径达成（不要写"必须先与 NPC X 对话"这种唯一路径）。
8. 每个 stage 的 description 应有"为什么本阶段存在 / 在整段叙事中承担什么作用"的清晰定位，不只是事件清单。
9. 主弧标题（title）允许诗意化，但 summary 必须是写实概括，可作后续模型参考。

边界纪律：
- 不输出回合数、不输出 startRound / endRound 字段（即使输入或上下文提到）。
- 不要替导演写每回合方向——你只定义阶段。
- 不要替守护者写设定细节——那是世界书的事；但你必须读懂世界书并让 stages 与之兼容。
- 不要在 stages 之外输出多余字段。
- 玩家自定义提示词中的额外要求（见用户消息末尾）需要纳入考量，但不能违反上述协议或世界书一致性约束。`;

export interface BuildMasterArcUserParams {
  outline: StoryOutline;
  background?: Background;
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
    ].join('\n')
    : '（无）';

  return [
    '【主弧设计任务】请根据以下大纲、出身与世界书设计整段游戏的主弧（NarrativeStage[]）。',
    '',
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
    '【玩家给主弧设计师的额外要求】',
    p.config.stageHint?.trim() || '（无）',
    '',
    `请按系统协议输出 JSON。stages 建议 ${expectedCount} 个，可在 3-8 之间灵活调整。所有阶段都不得带回合数。务必先读懂世界书的 alwaysActive 条目再设计 stages。`,
  ].filter(Boolean).join('\n');
}
