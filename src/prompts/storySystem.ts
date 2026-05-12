/**
 * 提示词输入说明（维护用注释，不会进入模型）：
 * - system：buildStorySystemPrompt 输出故事写手身份、写作规则和人称模式；chat + 司书库启用时 storyAgent 还会追加司书库规则和 systemRules。
 * - user：storyAgent 会先带入未摘要的历史消息，再把 buildStorySystem 的旅程资料与玩家本回合输入合并成最后一条 user 消息。
 * - buildStorySystem 输入包含：回合软参考、故事大纲、主弧、阶段判断、叙事弧 / 长线事件、严格自定义规则。
 * - 输入包含：大纲映射、叙事导演计划、writingBrief、本回合叙事包、人物规划、场景规划、事件规划、设定守护、逻辑审校。
 * - 输入包含：主角出身、世界书常驻/触发条目、历史摘要、长期记忆、已登场人物、玩家标记、能力、当前场景、使用能力、写作规范、风格偏好、特殊指令。
 * - 当前玩家输入来自 storyAgent 的 renderedUserMessage；重新生成时还会加入 regenerationHint；最后可能附加 DeepSeek V4 人称/指令特化 marker。
 * - 输出：只允许故事正文，不输出选项、JSON、规则说明或工具痕迹。
 */
// 故事主持人（Story GM）提示词构造
// 导出一个函数而非静态字符串，方便根据世界书/随机事件/回合动态拼装。

import type { StoryOutline, Background, WorldBookEntry, RandomEvent } from '@/types/content';
import type { AuthorLogicIssue, AuthorNarrativeState, AuthorRandomEventState, Item, Npc, MemoryAnchor, PlayerPace, SceneRef } from '@/types/game';
import type { StrictCustomConfig } from '@/types/custom';
import type { StoryPromptMode } from '@/types/settings';
import { formatItemsForPrompt } from '@/lib/items';
import { formatStoryArcForPrompt } from '@/lib/authorMode';
import {
  buildStrictCustomStoryBlock,
  getStorySystemTemplate,
  renderPromptTemplate,
} from '@/lib/strictCustom';

export const STORY_SYSTEM_RULES = `故事写作规则：
1. 你会根据用户消息中的世界观、故事资料、压缩上下文、最近对话和当前玩家输入，续写一个中文互动小说回合。
2. 你会严格参照用户消息内存在的写作规范、世界书、长期记忆、玩家标记、当前阶段、设定守护、逻辑审校和特殊指令等，以实际消息为准。
3. 你只输出故事正文；不输出规则说明、标题、候选选项、JSON、代码块或元评论。
4. 你不会替玩家做出超出本回合输入的关键决定；会把剧情停在自然的下一压力点或选择点。
5. 若资料冲突，以用户消息中更靠后的【当前上下文】、【本回合特殊指令】、【写作规范】和模型身份职责为准。`;

export const STORY_ASK_DIRECTOR_RULES = `询问导演工具（ask_director）使用纪律：

当你在故事情节写作中缺少某些重要信息/设定时，不要自行编造，可调用 ask_director 一次向导演提问（每轮故事创作仅可使用一次），如果当前信息相对足够，不要使用此工具。

何时使用：
- 你缺少某个出场角色的关键信息（关系、目的、为什么本回合在场）
- 你不清楚主角的某个能力 / 状态 / 设定的边界
- 资料里暗示某件事要本回合落地，但叙事包没明示是否要写

何时不要使用：
- "我应该怎么开头" 这类过宽的写法问题（自己判断）
- "小晴眼睛什么颜色" 这类细节（合理虚构）
- 已能基于现有资料写出故事但想"再保险一点"（直接写作）

提问示例：
- 正例：「我缺少小晴这个角色的信息（关系、目的、为什么本回合在场）」
- 正例：「我不清楚主角的能力设定（能做什么、限制、本回合能不能用）」
- 正例：「我不了解当前事件的状态（涉及什么，边界是什么，本回合不能写什么）」
- 反例：「我应该怎么开头」（过宽）
- 反例：「小晴眼睛什么颜色」（过细）

调用流程：
- 调用 ask_director({ question, missingInfo? })；question 必填，明确告诉导演你的疑问点/卡在哪里
- 触发导演专门答复，导演解决问题后，会在新的消息向你发送答复
- 询问过一次后，本工具本回合不可再用——基于答复创作即可`;

export interface BuildStorySystemParams {
  outline?: StoryOutline;
  background?: Background;
  characterName?: string;
  activeWorldBookEntries: WorldBookEntry[];
  summary?: string;
  longTermMemory?: string;
  currentRound: number;
  totalRounds: number;          // 0 = 无尽模式
  triggeredEvent?: RandomEvent;
  backpack?: Item[];
  usedItems?: Item[];
  npcs?: Npc[];
  anchors?: MemoryAnchor[];
  currentScene?: SceneRef;
  authorNarrative?: AuthorNarrativeState;
  authorRandomEventState?: AuthorRandomEventState;
  finalizeRequested?: boolean;  // 无尽模式下玩家要求本回合收束
  lengthHint?: 'short' | 'standard' | 'long';
  storyPromptMode?: StoryPromptMode;
  styleAddendum?: string;
  strictCustom?: StrictCustomConfig;
}

function anchorContent(a: MemoryAnchor): string {
  return (a.content?.trim() || a.excerpt?.trim() || '').trim();
}

function paceToHumanReadable(pace: PlayerPace): string {
  switch (pace) {
    case 'immersive': return 'immersive — 玩家在细致体验，每回合只推进一个微节拍，多写感官与心境';
    case 'exploratory': return 'exploratory — 玩家在试探，每回合一个动作 + NPC 即时反应';
    case 'progressing': return 'progressing — 玩家在主动推进，正常推进一个剧情节拍';
    case 'hurrying': return 'hurrying — 玩家明确想跳过，可压缩多步但仍要点出关键变化';
  }
}

function protagonistNameOf(characterName?: string): string {
  return characterName?.trim() || '主角';
}

function perspectiveRule(mode: StoryPromptMode | undefined, characterName?: string): string {
  const protagonist = protagonistNameOf(characterName);
  switch (mode) {
    case 'deepseek-v4-protagonist':
      return `2. 使用第一人称"我"叙述玩家角色；"我"就是${protagonist}。允许写"我的"感受、观察与即时反应，但不要替玩家做出超出输入的关键决定。`;
    case 'deepseek-v4-instruction':
      return `2. 使用第三人称叙述玩家角色，优先称呼其姓名"${protagonist}"；不要用第二人称"你"指代玩家角色，也不要用第一人称"我"代替${protagonist}行动。`;
    default:
      return '2. 使用第二人称"你"称呼玩家角色。';
  }
}

export function buildStoryRoleBlock(
  mode: StoryPromptMode | undefined,
  characterName?: string,
): string {
  const protagonist = protagonistNameOf(characterName);
  if (mode === 'deepseek-v4-protagonist') {
    return [
      `你是这段互动小说的"故事写手"，也是玩家角色"${protagonist}"的第一人称叙事声音。`,
      `你会用"我"书写"${protagonist}"此刻能感知、能理解、能做出的即时反应。`,
      '你会严格参照上方世界观、当前上下文、玩家输入与写作规范，只推进本回合最自然的一件事。',
    ].join('\n');
  }
  if (mode === 'deepseek-v4-instruction') {
    return [
      '你是这段互动小说的"故事写手"。你站在故事主理人的位置，为玩家书写下一回合正文。',
      `你会用第三人称称呼玩家角色，优先使用"${protagonist}"这个名字，不把自己当成主角。`,
      '你会严格参照上方世界观、当前上下文、玩家输入与写作规范，只推进本回合最自然的一件事。',
    ].join('\n');
  }
  return [
    '你是这段互动小说的"故事写手"。你会承接上文，为玩家书写下一回合正文。',
    `你会把玩家角色"${protagonist}"放在当前场景和关系中处理，保持人物、设定、时间天气和已发生剧情一致。`,
    '你会严格参照上方世界观、当前上下文、玩家输入与写作规范，只推进本回合最自然的一件事。',
  ].join('\n');
}

export function buildStorySystemPrompt(
  mode: StoryPromptMode | undefined,
  characterName?: string,
): string {
  return [
    buildStoryRoleBlock(mode, characterName),
    STORY_SYSTEM_RULES,
    STORY_ASK_DIRECTOR_RULES,
  ].join('\n\n');
}

export function buildStorySystem(p: BuildStorySystemParams): string {
  const {
    outline, background, characterName, activeWorldBookEntries,
    summary, longTermMemory, currentRound, totalRounds, triggeredEvent, backpack, usedItems, npcs, anchors, currentScene,
    authorNarrative, authorRandomEventState, finalizeRequested, lengthHint, storyPromptMode, styleAddendum, strictCustom,
  } = p;

  const isInfinite = !totalRounds || totalRounds <= 0;
  const nextRound = currentRound + 1;
  const remainingAfter = isInfinite ? Infinity : Math.max(0, totalRounds - nextRound);
  const isFinal = !isInfinite ? nextRound >= totalRounds : !!finalizeRequested;
  const nearEnd = !isInfinite && !isFinal && remainingAfter <= 2;

  const roundInfo = isInfinite
    ? `【回合软参考】无尽模式；当前即将开始第 ${nextRound} 回合。回合数只用于记录，不用于强行判断剧情阶段。`
    : `【回合软参考】总回合约 ${totalRounds}；当前即将开始第 ${nextRound} 回合，已完成 ${currentRound} 回合。回合数只作节奏参考，不可按回合数硬推进阶段。`;

  const outlineLines: string[] = [];
  if (outline) {
    outlineLines.push(
      '【故事大纲】',
      `标题：${outline.title}`,
      `梗概：${outline.synopsis}`,
    );
    if (outline.acts?.length) {
      outlineLines.push(
        '阶段 / 章节：',
        ...outline.acts.map((act, index) => `· 第 ${index + 1} 幕：${act}`),
      );
    }
    if (outline.tone) {
      outlineLines.push(
        `文风/题材：${outline.tone}`,
        '（请严格遵循上述文风与题材：恋爱故事的张力主要来自人物关系与情绪流动；推理/悬疑故事来自未解谜团与线索拼合；成长/治愈来自内心抉择与日常细节；动作冒险来自外部对抗与抉择代价。让冲突与张力源于该题材自然生长出的可能性，不要为了戏剧性强行混入与题材相悖的元素。）',
      );
    }
  }

  const masterArc = authorNarrative?.masterArc;
  const masterArcBlock = (() => {
    if (!masterArc) return '';
    const current = masterArc.stages[masterArc.currentStageIndex];
    if (!current) return '';
    const lines = [
      '【执笔模式 · 主弧】',
      `主弧：${masterArc.title}`,
      `走向：${masterArc.summary}`,
      '',
      `当前阶段：${current.name}`,
      `阶段目标：${current.description}`,
    ];
    if (current.completionConditions?.length) {
      lines.push('完成条件：');
      current.completionConditions.forEach((c) => lines.push(`· ${c}`));
    }
    const pendingBeats = current.expectedBeats?.filter((b) => b.status === 'pending') ?? [];
    if (pendingBeats.length) {
      lines.push('', '本阶段待完成的节拍（不要一回合压多个）：');
      pendingBeats.slice(0, 8).forEach((b) => lines.push(`· ${b.description}`));
    }
    const next = masterArc.stages[masterArc.currentStageIndex + 1];
    if (next) {
      lines.push('', `下一阶段（仅供参考，不要主动推进过去）：${next.name} —— ${next.description.slice(0, 60)}`);
    }
    return lines.join('\n');
  })();

  const stageJudge = authorNarrative?.stageJudge;
  const stageJudgeBlock = (() => {
    if (!stageJudge) return '';
    const lines = [
      '【执笔模式 · 本回合玩家意图与节奏】（最高优先级，必须遵守）',
      `玩家想做：${stageJudge.playerIntent.primary}`,
    ];
    if (stageJudge.playerIntent.secondary?.length) {
      lines.push(`顺带诉求：${stageJudge.playerIntent.secondary.join('；')}`);
    }
    if (stageJudge.playerIntent.implicit) {
      lines.push(`隐含意图：${stageJudge.playerIntent.implicit}`);
    }
    lines.push(`节奏：${paceToHumanReadable(stageJudge.playerPace)}`);
    if (stageJudge.paceReasoning) lines.push(`节奏依据：${stageJudge.paceReasoning}`);
    lines.push(`本回合聚焦：${stageJudge.storyFocus.thisRound}`);
    if (stageJudge.storyFocus.avoid?.length) {
      lines.push('本回合刻意避免：');
      stageJudge.storyFocus.avoid.forEach((a) => lines.push(`· ${a}`));
    }
    if (stageJudge.stageStatus.advanceReasoning) {
      lines.push(`阶段判断：${stageJudge.stageStatus.advanceReasoning}`);
    }
    return lines.join('\n');
  })();

  const arcLines: string[] = [];
  const activeNarrativeArcs = authorNarrative?.activeArcs ?? [];
  const activeEventArcs = authorRandomEventState?.activeEvents ?? [];
  const pendingEventArc = authorRandomEventState?.pendingForRound === currentRound
    ? authorRandomEventState?.pendingEvent
    : undefined;
  const arcs = [
    ...(pendingEventArc ? [pendingEventArc] : []),
    ...activeEventArcs,
    ...activeNarrativeArcs,
  ];
  if (arcs.length) {
    arcLines.push(
      '【执笔模式 · 叙事弧 / 长线事件】',
      '以下内容是多回合剧情框架，优先级高于普通随机事件；请让本回合服务于当前阶段，但只写玩家当前能感知到的剧情，不要直接剧透幕后真实意图。',
    );
    for (const arc of arcs.slice(0, 8)) {
      arcLines.push(formatStoryArcForPrompt(arc, currentRound));
    }
    arcLines.push('执行规则：长线事件只提供多回合框架；本回合仍必须服从【本回合玩家意图与节奏】，不要为追事件进度压缩多个动作。');
  }
  const storyArcBlock = arcLines.join('\n');

  const plan = authorNarrative?.plan;
  const outlineMappingBlock = (() => {
    const mapping = authorNarrative?.outlineMapping ?? plan?.outlineMapping;
    if (!mapping) return '';
    const lines: string[] = [
      '【执笔模式 · 大纲映射】',
      `贴合状态：${mapping.alignment}`,
    ];
    if (mapping.currentAct) {
      lines.push(`对应大纲：${mapping.currentActIndex !== undefined ? `第 ${mapping.currentActIndex + 1} 幕 · ` : ''}${mapping.currentAct}`);
    }
    if (mapping.currentStageGoal) lines.push(`当前阶段目标：${mapping.currentStageGoal}`);
    if (mapping.stageProgress !== undefined) lines.push(`阶段软进度：${mapping.stageProgress}%`);
    if (mapping.missingBridgeEvents?.length) {
      lines.push('缺少的桥接事件：');
      mapping.missingBridgeEvents.slice(0, 6).forEach((x) => lines.push(`· ${x}`));
    }
    if (mapping.candidateEvents?.length) {
      lines.push('可自然推进的小事件方向：');
      mapping.candidateEvents.slice(0, 6).forEach((x) => lines.push(`· ${x}`));
    }
    if (mapping.driftRisks?.length) {
      lines.push(`偏离风险：${mapping.driftRisks.slice(0, 6).join('；')}`);
    }
    if (mapping.nextMilestone) lines.push(`下一里程碑：${mapping.nextMilestone}`);
    lines.push('执行规则：大纲映射只提供方向，不允许越过【本回合叙事包】的写作边界；如玩家拒绝当前事件，应把偏离转化为新的因果，而不是强行否定玩家。');
    return lines.join('\n');
  })();
  const narrativePlanBlock = plan
    ? [
      '【执笔模式 · 当前叙事导演计划】',
      plan.currentAct ? `当前幕：${plan.currentAct}` : '',
      plan.currentStage ? `当前阶段：${plan.currentStage}` : '',
      plan.stageGoal ? `阶段目标：${plan.stageGoal}` : '',
      plan.nextRoundFocus ? `下一回合焦点：${plan.nextRoundFocus}` : '',
      plan.nextFewRoundsPlan?.length
        ? [
          '近期方向：',
          ...plan.nextFewRoundsPlan.slice(0, 6).map((item) =>
            `· ${item.goal}${item.requiredBeats?.length ? `；必达：${item.requiredBeats.join('、')}` : ''}${item.avoidBeats?.length ? `；避免：${item.avoidBeats.join('、')}` : ''}`,
          ),
        ].join('\n')
        : '',
      plan.outlineAlignment ? `大纲贴合：${plan.outlineAlignment}` : '',
      plan.eventUpdates?.length
        ? [
          '事件状态更新：',
          ...plan.eventUpdates.slice(0, 6).map((u) =>
            `· ${u.title || u.arcId || '事件'}${u.lifecycle ? ` → ${u.lifecycle}` : ''}${u.progressPercent !== undefined ? `（${u.progressPercent}%）` : ''}${u.progressNote ? `：${u.progressNote}` : ''}`,
          ),
        ].join('\n')
        : '',
      plan.pacingAdvice ? `节奏建议：${plan.pacingAdvice}` : '',
      plan.riskNotes?.length ? `风险提醒：${plan.riskNotes.join('；')}` : '',
    ].filter(Boolean).join('\n')
    : '';

  const planningStatesBlock = (() => {
    const lines: string[] = [];
    const characterPlan = authorNarrative?.characterPlan;
    if (characterPlan) {
      lines.push('【执笔模式 · 人物规划】', characterPlan.summary);
      if (characterPlan.characters?.length) {
        characterPlan.characters.slice(0, 8).forEach((c) => {
          lines.push([
            `· ${c.name}${c.role ? `（${c.role}）` : ''}`,
            c.surfaceGoal ? `表面目的：${c.surfaceGoal}` : '',
            c.hiddenIntent ? `隐藏动机：${c.hiddenIntent}（只用于暗示，不得直接剧透）` : '',
            c.visibleBehavior ? `可表现：${c.visibleBehavior}` : '',
            c.doNotReveal?.length ? `不得明说：${c.doNotReveal.join('；')}` : '',
          ].filter(Boolean).join('；'));
        });
      }
      if (characterPlan.relationshipSignals?.length) lines.push(`关系信号：${characterPlan.relationshipSignals.join('；')}`);
      if (characterPlan.absentCharacters?.length) {
        lines.push(`不应登场：${characterPlan.absentCharacters.map((c) => `${c.name}（${c.reason}）`).join('；')}`);
      }
      if (characterPlan.risks?.length) lines.push(`人物风险：${characterPlan.risks.join('；')}`);
      lines.push('');
    }

    const scenePlan = authorNarrative?.scenePlan;
    if (scenePlan) {
      const s = scenePlan.scene;
      lines.push('【执笔模式 · 场景规划】');
      if (s.location) lines.push(`地点：${s.location}`);
      if (s.time) lines.push(`时间：${s.time}`);
      if (s.weather) lines.push(`天气：${s.weather}`);
      if (s.atmosphere) lines.push(`氛围：${s.atmosphere}`);
      if (s.resources?.length) lines.push(`可用资源：${s.resources.join('；')}`);
      if (s.constraints?.length) lines.push(`场景限制：${s.constraints.join('；')}`);
      if (scenePlan.sceneLogic) lines.push(`场景逻辑：${scenePlan.sceneLogic}`);
      if (scenePlan.sceneResources?.length) lines.push(`额外资源：${scenePlan.sceneResources.join('；')}`);
      if (scenePlan.opportunities?.length) lines.push(`机会：${scenePlan.opportunities.join('；')}`);
      if (scenePlan.risks?.length) lines.push(`场景风险：${scenePlan.risks.join('；')}`);
      lines.push('');
    }

    const eventPlan = authorNarrative?.eventPlan;
    if (eventPlan) {
      lines.push('【执笔模式 · 事件规划】', eventPlan.summary);
      if (eventPlan.currentEvent) {
        const ev = eventPlan.currentEvent;
        if (ev.title) lines.push(`事件：${ev.title}`);
        if (ev.lifecycle) lines.push(`生命周期：${ev.lifecycle}`);
        if (ev.objective) lines.push(`事件目标：${ev.objective}`);
        if (ev.progress) lines.push(`当前进度：${ev.progress}`);
        if (ev.stopAt) lines.push(`事件内停止点：${ev.stopAt}`);
        if (ev.completionCriteria?.length) lines.push(`完成标准：${ev.completionCriteria.join('；')}`);
        if (ev.failureCriteria?.length) lines.push(`失败/延后标准：${ev.failureCriteria.join('；')}`);
        if (ev.hiddenIntent) lines.push(`幕后目的：${ev.hiddenIntent}（只用于塑造行为，不得直接剧透）`);
      }
      if (eventPlan.candidateEvents?.length) lines.push(`候选事件：${eventPlan.candidateEvents.join('；')}`);
      if (eventPlan.writingBoundary) lines.push(`建议写作边界：${eventPlan.writingBoundary}`);
      if (eventPlan.successCriteria?.length) lines.push(`成功标准：${eventPlan.successCriteria.join('；')}`);
      if (eventPlan.avoid?.length) lines.push(`避免：${eventPlan.avoid.join('；')}`);
      lines.push('');
    }
    if (!lines.filter((x) => x.trim()).length) return '';
    lines.push('执行规则：以上下级规划低于【本回合叙事包】，但高于故事写手自由发挥；若导演叙事包缺失，请用这些规划维持人物、场景和事件逻辑。');
    return lines.join('\n');
  })();

  const narrativeBriefBlock = (() => {
    const brief = plan?.writingBrief;
    if (!brief) return '';
    const lines: string[] = [
      '【执笔模式 · 本回合叙事包】（最高执行包：故事写手只写这一小段，不要越界）',
      `本回合目标：${brief.objective}`,
    ];
    if (brief.mustFollow?.length) {
      lines.push('必须遵守：');
      brief.mustFollow.slice(0, 10).forEach((x) => lines.push(`· ${x}`));
    }
    if (brief.currentEvent) {
      const ev = brief.currentEvent;
      lines.push('', '当前小事件：');
      if (ev.title) lines.push(`· 名称：${ev.title}`);
      if (ev.lifecycle) lines.push(`· 生命周期：${ev.lifecycle}`);
      if (ev.objective) lines.push(`· 事件目标：${ev.objective}`);
      if (ev.progress) lines.push(`· 当前进度：${ev.progress}`);
      if (ev.stopAt) lines.push(`· 事件内停止点：${ev.stopAt}`);
      if (ev.completionCriteria?.length) lines.push(`· 完成标准：${ev.completionCriteria.join('；')}`);
      if (ev.failureCriteria?.length) lines.push(`· 失败/延后标准：${ev.failureCriteria.join('；')}`);
      if (ev.hiddenIntent) lines.push(`· 幕后目的：${ev.hiddenIntent}（只用于塑造行为，不得直接剧透）`);
    }
    if (brief.characters?.length) {
      lines.push('', '出场/牵动角色：');
      brief.characters.slice(0, 8).forEach((c) => {
        const parts = [
          `· ${c.name}${c.role ? `（${c.role}）` : ''}`,
          c.surfaceGoal ? `表面目的：${c.surfaceGoal}` : '',
          c.hiddenIntent ? `真实动机：${c.hiddenIntent}` : '',
          c.visibleBehavior ? `可表现：${c.visibleBehavior}` : '',
          c.doNotReveal?.length ? `不得明说：${c.doNotReveal.join('；')}` : '',
        ].filter(Boolean);
        lines.push(parts.join('；'));
      });
    }
    if (brief.scene) {
      const s = brief.scene;
      lines.push('', '本回合场景规划：');
      if (s.location) lines.push(`· 地点：${s.location}`);
      if (s.time) lines.push(`· 时间：${s.time}`);
      if (s.weather) lines.push(`· 天气：${s.weather}`);
      if (s.atmosphere) lines.push(`· 氛围：${s.atmosphere}`);
      if (s.resources?.length) lines.push(`· 可用资源：${s.resources.join('；')}`);
      if (s.constraints?.length) lines.push(`· 场景限制：${s.constraints.join('；')}`);
    }
    if (brief.sceneResources?.length) {
      lines.push('', `场景资源：${brief.sceneResources.join('；')}`);
    }
    lines.push('', `写作边界：${brief.writingBoundary}`);
    if (brief.successCriteria?.length) {
      lines.push(`成功标准：${brief.successCriteria.join('；')}`);
    }
    if (brief.avoid?.length) {
      lines.push('本回合避免：');
      brief.avoid.slice(0, 8).forEach((x) => lines.push(`· ${x}`));
    }
    if (brief.hiddenKnowledge?.length) {
      lines.push('', '隐藏信息（只用于暗示，不得旁白直说）：');
      brief.hiddenKnowledge.slice(0, 8).forEach((x) => lines.push(`· ${x}`));
    }
    lines.push('', '执行纪律：本回合严格写到【写作边界】为止；即使知道事件后续，也不要提前完成、提前揭秘或替玩家做重大决定。');
    return lines.join('\n');
  })();

  const settingGuard = authorNarrative?.settingGuard;
  const settingGuardBlock = (() => {
    if (!settingGuard) return '';
    const lines: string[] = [];
    const must = (settingGuard.patches ?? []).filter((p) => p.severity === 'must');
    const should = (settingGuard.patches ?? []).filter((p) => p.severity === 'should');

    if (must.length || should.length) {
      lines.push('【执笔模式 · 本回合设定守护】');
      if (must.length) {
        lines.push('必须遵守（违反即为严重设定问题）：');
        must.slice(0, 6).forEach((p) => lines.push(`· ${p.topic}：${p.advice}`));
      }
      if (should.length) {
        lines.push('建议参考：');
        should.slice(0, 6).forEach((p) => lines.push(`· ${p.topic}：${p.advice}`));
      }
    }

    if (settingGuard.deviation) {
      lines.push('', '⚠ 守护者发现的偏离风险：');
      lines.push(settingGuard.deviation.description);
      if (settingGuard.deviation.affectedEntryNames?.length) {
        lines.push(`涉及世界书：${settingGuard.deviation.affectedEntryNames.join('、')}`);
      }
      lines.push('请在本回合或下一回合通过自然剧情修正方向。');
    }

    const beats = (settingGuard.pendingAmbientBeats ?? [])
      .filter((b) => !b.consumed && b.suggestedAtRound >= currentRound - 3);
    if (beats.length) {
      // 按 playerPace 调节环境侧建议数量：沉浸 / 探索时少打扰
      const judgePace = authorNarrative?.stageJudge?.playerPace;
      const beatLimit =
        judgePace === 'immersive' ? 1
        : judgePace === 'exploratory' ? 2
        : 3;
      lines.push('', '【环境侧主动反应建议】（可选演绎，不强制全部纳入）：');
      const filtered = judgePace === 'immersive'
        ? beats.filter((b) => b.optional)
        : beats;
      filtered.slice(0, beatLimit).forEach((b) => {
        const tag = b.optional ? '' : '【强烈建议】';
        lines.push(`· ${tag}${b.source} · ${b.trigger}：${b.beat}`);
      });
    }

    if (settingGuard.preference?.tendency && settingGuard.preference.confidence !== 'low') {
      lines.push('', `【玩家偏好画像 · 置信度 ${settingGuard.preference.confidence}】`);
      lines.push(settingGuard.preference.tendency);
      if (settingGuard.preference.recentSignals?.length) {
        lines.push(`近期信号：${settingGuard.preference.recentSignals.slice(0, 5).join('；')}`);
      }
    }

    return lines.length ? lines.join('\n') : '';
  })();

  const logicReview = authorNarrative?.logicReview;
  const eventBeat = authorNarrative?.eventBeat;
  const eventBeatBlock = (() => {
    if (!eventBeat?.verdicts?.length) return '';
    const lines: string[] = [
      '【执笔模式 · 本回合事件节奏判定】（来自司事，事件状态以此为准；写作时不要让事件状态与此冲突）',
      `判定回合：第 ${eventBeat.updatedAtRound} 回合`,
    ];
    eventBeat.verdicts.slice(0, 6).forEach((v) => {
      const parts = [
        `· ${v.title || v.arcId}`,
        `→ ${v.lifecycle}`,
        v.progressPercent !== undefined ? `${v.progressPercent}%` : '',
        v.triggeredCompletion ? '【本回合达成完成标准】' : '',
        v.triggeredFailure ? '【本回合达成失败标准】' : '',
      ].filter(Boolean);
      lines.push(parts.join('｜'));
      if (v.progressNote) lines.push(`  推进备注：${v.progressNote}`);
      if (v.outcomeNote) lines.push(`  结算备注：${v.outcomeNote}`);
    });
    lines.push('', '执行规则：事件状态以本块为准，按其 lifecycle 走，不要把已完成事件写成"还在推进"，也不要把进行中事件写成"已收束"。');
    return lines.join('\n');
  })();
  const logicReviewBlock = (() => {
    if (!logicReview) return '';
    const issues = logicReview.issues ?? [];
    const critical = issues.filter((i) => i.severity === 'critical');
    const warning = issues.filter((i) => i.severity === 'warning');
    const info = issues.filter((i) => i.severity === 'info');
    const formatIssue = (issue: AuthorLogicIssue) =>
      `· ${issue.type}：${issue.description}${issue.repairHint ? `；修复：${issue.repairHint}` : ''}`;

    const lines: string[] = [
      '【执笔模式 · 逻辑审校与修复建议】',
      `审校回合：第 ${logicReview.updatedAtRound} 回合`,
    ];
    if (logicReview.overall) lines.push(`总体：${logicReview.overall}`);
    if (critical.length) {
      lines.push('', '⚠ 必须修复（严重一致性问题，本回合或下回合内必须自然处理）：');
      critical.slice(0, 4).forEach((i) => lines.push(formatIssue(i)));
    }
    if (warning.length) {
      lines.push('', '建议修复（明显风险，尽快通过剧情自然修补）：');
      warning.slice(0, 3).forEach((i) => lines.push(formatIssue(i)));
    }
    if (info.length) {
      lines.push('', '参考（轻度提示，写作时留意即可）：');
      info.slice(0, 2).forEach((i) => lines.push(formatIssue(i)));
    }
    if (logicReview.repairDirectives?.length) {
      lines.push('', `后续修复指令：${logicReview.repairDirectives.join('；')}`);
    }
    if (logicReview.nextRoundWarnings?.length) {
      lines.push(`下一回合避免：${logicReview.nextRoundWarnings.join('；')}`);
    }
    lines.push(
      '',
      '执行规则：优先处理"必须修复"项；其他级别参考即可。修复应通过新剧情自然完成，不要重写已发生正文，不要在叙事中暴露"审校/修复"等元信息。',
    );
    return lines.filter(Boolean).join('\n');
  })();

  const backgroundBlock = background
    ? [
      '【角色卡】',
      `姓名：${characterName || '（未命名）'}`,
      `出身：${background.name} —— ${background.description}`,
      `特质：${background.traits.join('、') || '无'}`,
      `初始能力：${background.startItems.join('、') || '无'}`,
      background.startScene ? `开局文本：${background.startScene}` : '',
    ].join('\n')
    : '';

  const alwaysEntries = activeWorldBookEntries.filter((e) => e.alwaysActive);
  const triggeredEntries = activeWorldBookEntries.filter((e) => !e.alwaysActive);
  const worldBookAlwaysBlock = alwaysEntries.length
    ? ['【世界设定 · 常驻】', ...alwaysEntries.map((e) => `· ${e.name}：${e.content}`)].join('\n')
    : '';
  const worldBookTriggeredBlock = triggeredEntries.length
    ? ['【世界设定 · 本回合触发】', ...triggeredEntries.map((e) => `· ${e.name}：${e.content}`)].join('\n')
    : '';

  const summaryBlock = summary?.trim()
    ? ['【历史摘要】', summary.trim()].join('\n')
    : '';

  const memoryBlock = longTermMemory?.trim()
    ? [
      '【长期一致性记忆】',
      '以下记录是系统周期性整理出的外观、服装、关系、承诺、计划、未解线索等连续性信息；写作时请优先保持一致，除非新剧情明确改变它们。',
      longTermMemory.trim(),
    ].join('\n')
    : '';

  const npcLines: string[] = [];
  if (npcs && npcs.length) {
    // 按 lastRound 倒序 + appearances 兜底排序，优先保留最近活跃的 NPC
    const sortedNpcs = [...npcs].sort((a, b) => {
      const aLast = a.lastRound ?? 0;
      const bLast = b.lastRound ?? 0;
      if (aLast !== bLast) return bLast - aLast;
      return (b.appearances ?? 0) - (a.appearances ?? 0);
    });
    npcLines.push('【已登场人物】（按最近活跃度排序，请保持人物一致性：姓名、外形、性格不得与以下记录冲突）');
    for (const n of sortedNpcs.slice(0, 10)) {
      const aff = n.affinity > 0 ? `+${n.affinity}` : `${n.affinity}`;
      const role = n.role ? `【${n.role}】` : '';
      const desc = n.description ? ` —— ${n.description}` : '';
      const details = n.details?.length ? `；细节：${n.details.slice(0, 5).join('、')}` : '';
      const note = n.recentNote ? `（最近：${n.recentNote}）` : '';
      npcLines.push(`· ${n.name}${role}（好感 ${aff}）${desc}${details}${note}`);
    }
    if (sortedNpcs.length > 10) {
      npcLines.push(`（另有 ${sortedNpcs.length - 10} 位较少出场的人物未在此列出，必要时参考长期记忆）`);
    }
  }

  const anchorLines: string[] = [];
  if (anchors && anchors.length) {
    anchorLines.push('【玩家标记的关键记忆】（这些是玩家认为重要、不可遗忘的情节，请在后续叙事中显性或隐性地呼应它们）');
    for (const a of anchors.slice(-8)) {
      const note = a.note ? `【${a.note}】` : '';
      const content = anchorContent(a);
      if (!content) continue;
      const trimmed = content.length > 200 ? `${content.slice(0, 200)}…` : content;
      anchorLines.push(`· 第 ${a.round} 回合${note}：${trimmed}`);
    }
  }

  const backpackBlock = backpack && backpack.length
    ? ['【玩家能力】', formatItemsForPrompt(backpack)].join('\n')
    : '';

  const currentSceneBlock = currentScene
    ? [
      `【当前所在场景】${currentScene.name}${currentScene.description ? ` —— ${currentScene.description}` : ''}`,
      currentScene.time ? `时间：${currentScene.time}` : '',
      currentScene.weather ? `天气：${currentScene.weather}` : '',
      '写作时请把场景、时间、天气作为同一组连续环境条件处理：时间影响光线、人流与作息；天气影响感官细节、行动阻力与氛围，但不要为天气硬造无关危机。',
      '若玩家本回合输入显式表达了"前往 XXX"的意图，请在本回合完成场景切换，用感官细节描写抵达过程与新环境；否则继续在当前场景内推进。',
    ].filter(Boolean).join('\n')
    : '';

  const usedItemsBlock = usedItems && usedItems.length
    ? [
      '【本回合玩家使用的能力】',
      formatItemsForPrompt(usedItems),
      '请在本回合的叙事中让这些能力发挥合理作用。若其中有"一次性"能力，请在叙事里体现它失效的事实。',
    ].join('\n')
    : '';

  const lengthRule =
    lengthHint === 'short'
      ? '1. 只写本回合的剧情推进，不要跨越多个事件。篇幅约 140~260 个汉字，段落分明（2~3 段）。'
      : lengthHint === 'long'
      ? '1. 只写本回合的剧情推进，不要跨越多个事件。篇幅约 360~600 个汉字，段落分明（3~5 段），多用感官细节。'
      : '1. 只写本回合的剧情推进，不要跨越多个事件。篇幅约 220~420 个汉字，段落分明（2~4 段）。';

  const writingRulesBlock = [
    '【写作规范】',
    lengthRule,
    perspectiveRule(storyPromptMode, characterName),
    '3. 不要替玩家做出本回合的关键决定；叙述在自然的选择点或悬念处收束，但避免直接写"你会怎么做？"这类元指令。',
    '4. 环境、NPC、时间推移你可以随故事发展推进；故事主角的具体行为应依据玩家上一条输入与玩家偏好。',
    '5. 允许使用 Markdown：**人名/关键地点/能力** 以粗体强调；*内心独白/感官细节* 以斜体表现。',
    '6. 避免陈词滥调，写感官细节、矛盾张力、角色心境。',
    '7. 严禁剧透结局；严禁将提供的信息（如：故事节奏/事件节奏/大纲等）直接写入故事；严禁元叙述（"这是 AI 编写的故事"）。',
    '8. 叙事与节奏纪律（重要）：故事的发展要严格参照已有信息，谨慎对待后续内容，没有依据的信息不要映射入故事（如：玩家与已有角色的互动不能无角色信息自由发挥，必须了解其角色设定再描写行为）。故事节奏要严格参照故事发展和已有信息，不要脱离节奏自由发挥，不要将多轮回合的事件融入一回合，依据已知信息判断本回合该发展到的情节，不要越界，故事可以在任意地方终止',
    '9.5. 叙事包纪律：若存在【本回合叙事包】，它是本回合最具体的执行包。你可以知道隐藏动机，但只能用动作、语气、停顿、环境呼应来暗示，不得直接旁白揭露；必须写到叙事包给出的边界就停止。',
    '9.6. milestone 纪律：若【叙事弧 / 长线事件】里有 [milestone] 标记的事件，它是主线大事件——写作时更克制，不要一回合压完核心节拍；完成 / 失败的关键时刻应留出余韵，让读者感知到分量。milestone 事件的生命周期判定更严格，按上方给出的 lifecycle 走。',
    '10. 信息优先级（当上方各块出现冲突时按此顺序取舍）：',
      '   ① 本回合玩家意图与节奏（stageJudge）—— 决定本回合做什么、做多少',
      '   ② 本回合叙事包（writingBrief）—— 决定本回合目标、角色动机、事件边界',
      '   ③ 本回合事件节奏判定 —— 决定事件真实 lifecycle 与结算结果',
      '   ④ 下级规划（大纲映射 / 人物规划 / 场景规划 / 事件规划）—— 决定本回合为何发生、谁在场、在哪里、事件进退',
      '   ⑤ 当前阶段（masterArc.currentStage）的完成条件与待完成节拍',
      '   ⑥ 设定守护"必须遵守"补丁 + 偏离风险',
      '   ⑦ alwaysActive 世界书条目（能力规则、世界基调等硬设定）',
      '   ⑧ 玩家标记的关键记忆（anchors）',
      '   ⑨ 长期一致性记忆 + 已登场人物的细节',
      '   ⑩ 进行中的事件弧、导演计划、审校建议',
      '   ⑪ 历史摘要、当前场景、能力',
    '   下方块（如长期记忆）若与上方块冲突，以上方块为准；但同样级别的"硬设定"不要互相覆盖。',
    '11. 如发现【已登场人物】与【长期一致性记忆】对同一人物的描述重复，以更具体、更近期的为准；不要因冗余信息而对人物画像产生分裂。',
  ].join('\n');

  const styleAddendumBlock = styleAddendum?.trim()
    ? ['【玩家补充的风格偏好】', styleAddendum.trim()].join('\n')
    : '';

  const special: string[] = [];
  if (triggeredEvent) {
    special.push(
      `· 本回合请自然地融入以下事件，不要生硬地塞入：${triggeredEvent.name} —— ${triggeredEvent.directive}`,
    );
  }
  if (isFinal) {
    special.push(isInfinite
      ? '· 玩家已主动触发"完结旅程"。这是最终回合，请为整段旅程写出一个有余韵的结局（360~600 字），给予玩家选择和成长的回响。'
      : '· 这是最终回合，请为整段旅程写出一个有余韵的结局（360~520 字），给予玩家选择和成长的回响。');
  } else if (nearEnd) {
    special.push(
      `· 故事已接近尾声（本回合结束后还剩 ${remainingAfter} 回合），请开始向主线高潮/结局收束，不要再引入无关的新支线。`,
    );
  }
  const specialBlock = special.length
    ? ['【本回合特殊指令】', ...special].join('\n')
    : '';

  const strictCustomBlock = buildStrictCustomStoryBlock(strictCustom, nextRound);
  const template = getStorySystemTemplate(strictCustom);

  const rendered = renderPromptTemplate(template, {
    round: nextRound,
    completedRounds: currentRound,
    nextRound,
    totalRounds: isInfinite ? '无尽' : totalRounds,
    remainingAfter: isInfinite ? '无尽' : remainingAfter,
    roundInfo,
    outlineBlock: outlineLines.join('\n'),
    masterArcBlock,
    stageJudgeBlock,
    storyArcBlock,
    backgroundBlock,
    worldBookAlwaysBlock,
    worldBookTriggeredBlock,
    summaryBlock,
    memoryBlock,
    outlineMappingBlock,
    narrativePlanBlock,
    planningStatesBlock,
    narrativeBriefBlock,
    eventBeatBlock,
    settingGuardBlock,
    logicReviewBlock,
    npcsBlock: npcLines.join('\n'),
    anchorsBlock: anchorLines.join('\n'),
    backpackBlock,
    currentSceneBlock,
    strictCustomBlock,
    usedItemsBlock,
    writingRulesBlock,
    styleAddendumBlock,
    specialBlock,
  });
  const fallbackBlocks: string[] = [];
  if (storyArcBlock && !rendered.includes('【执笔模式 · 叙事弧 / 长线事件】')) fallbackBlocks.push(storyArcBlock);
  if (masterArcBlock && !rendered.includes('【执笔模式 · 主弧】')) fallbackBlocks.push(masterArcBlock);
  if (stageJudgeBlock && !rendered.includes('【执笔模式 · 本回合玩家意图与节奏】')) fallbackBlocks.push(stageJudgeBlock);
  if (memoryBlock && !rendered.includes('【长期一致性记忆】')) fallbackBlocks.push(memoryBlock);
  if (narrativePlanBlock && !rendered.includes('【执笔模式 · 当前叙事导演计划】')) fallbackBlocks.push(narrativePlanBlock);
  if (outlineMappingBlock && !rendered.includes('【执笔模式 · 大纲映射】')) fallbackBlocks.push(outlineMappingBlock);
  if (
    planningStatesBlock
    && !rendered.includes('【执笔模式 · 人物规划】')
    && !rendered.includes('【执笔模式 · 场景规划】')
    && !rendered.includes('【执笔模式 · 事件规划】')
  ) fallbackBlocks.push(planningStatesBlock);
  if (narrativeBriefBlock && !rendered.includes('【执笔模式 · 本回合叙事包】')) fallbackBlocks.push(narrativeBriefBlock);
  if (eventBeatBlock && !rendered.includes('【执笔模式 · 本回合事件节奏判定】')) fallbackBlocks.push(eventBeatBlock);
  if (
    settingGuardBlock
    && !rendered.includes('【执笔模式 · 本回合设定守护】')
    && !rendered.includes('【环境侧主动反应建议】')
  ) fallbackBlocks.push(settingGuardBlock);
  if (logicReviewBlock && !rendered.includes('【执笔模式 · 逻辑审校与修复建议】')) fallbackBlocks.push(logicReviewBlock);
  return fallbackBlocks.length ? [rendered, ...fallbackBlocks].join('\n\n') : rendered;
}
