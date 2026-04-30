// 故事主持人（Story GM）提示词构造
// 导出一个函数而非静态字符串，方便根据世界书/随机事件/回合动态拼装。

import type { StoryOutline, Background, WorldBookEntry, RandomEvent } from '@/types/content';
import type { AuthorLogicIssue, AuthorNarrativeState, AuthorRandomEventState, Item, Npc, MemoryAnchor, PlayerPace, SceneRef } from '@/types/game';
import type { StrictCustomConfig } from '@/types/custom';
import { formatItemsForPrompt } from '@/lib/items';
import { formatStoryArcForPrompt } from '@/lib/authorMode';
import {
  buildStrictCustomStoryBlock,
  getStorySystemTemplate,
  renderPromptTemplate,
} from '@/lib/strictCustom';

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

export function buildStorySystem(p: BuildStorySystemParams): string {
  const {
    outline, background, characterName, activeWorldBookEntries,
    summary, longTermMemory, currentRound, totalRounds, triggeredEvent, backpack, usedItems, npcs, anchors, currentScene,
    authorNarrative, authorRandomEventState, finalizeRequested, lengthHint, styleAddendum, strictCustom,
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
      plan.pacingAdvice ? `节奏建议：${plan.pacingAdvice}` : '',
      plan.riskNotes?.length ? `风险提醒：${plan.riskNotes.join('；')}` : '',
    ].filter(Boolean).join('\n')
    : '';

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
    }

    return lines.length ? lines.join('\n') : '';
  })();

  const logicReview = authorNarrative?.logicReview;
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
      `携带：${background.startItems.join('、') || '无'}`,
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
    ? ['【玩家背包】', formatItemsForPrompt(backpack)].join('\n')
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
      '【本回合玩家使用的道具】',
      formatItemsForPrompt(usedItems),
      '请在本回合的叙事中让这些道具发挥合理作用。若其中有"一次性"物品，请在叙事里体现它被消耗的事实。',
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
    '2. 使用第二人称"你"称呼玩家角色。',
    '3. 不要替玩家做出本回合的关键决定；叙述在自然的选择点或悬念处收束，但避免直接写"你会怎么做？"这类元指令。',
    '4. 环境、NPC、时间推移你可以自由推进；玩家的具体行为应依据玩家上一条输入。若玩家输入含糊，你可合理演绎后果。',
    '5. 允许使用 Markdown：**人名/关键地点/物品** 以粗体强调；*内心独白/感官细节* 以斜体表现。',
    '6. 避免陈词滥调的"突然"、"仿佛一切都慢了下来"之类套话。写感官细节、矛盾张力、角色心境。',
    '7. 严禁剧透结局；严禁元叙述（"这是 AI 编写的故事"）。',
    '8. 节奏纪律（最高优先级）：本回合只完成上方【本回合聚焦】指明的一件事。绝不为了"追阶段进度"而把多步动作压在一回合（如：变身 + 走路 + 换装 + 对话 + 反思）。即使玩家输入提到多个动作，也要按 playerPace 对应的纪律拆分——如果玩家是 immersive 或 exploratory，挑最关键的第一步写完即可，停在自然的下一选择点。',
    '9. 阶段纪律：当前阶段未完成时，不要主动让主角触发下一阶段标志性事件。完成条件由【本回合玩家意图与节奏】判断，不是由你判断。',
    '10. 信息优先级（当上方各块出现冲突时按此顺序取舍）：',
    '   ① 本回合玩家意图与节奏（stageJudge）—— 决定本回合做什么、做多少',
    '   ② 当前阶段（masterArc.currentStage）的完成条件与待完成节拍',
    '   ③ 设定守护"必须遵守"补丁 + 偏离风险',
    '   ④ alwaysActive 世界书条目（能力规则、世界基调等硬设定）',
    '   ⑤ 玩家标记的关键记忆（anchors）',
    '   ⑥ 长期一致性记忆 + 已登场人物的细节',
    '   ⑦ 进行中的事件弧、导演计划、审校建议',
    '   ⑧ 历史摘要、当前场景、背包',
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
    narrativePlanBlock,
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
  if (
    settingGuardBlock
    && !rendered.includes('【执笔模式 · 本回合设定守护】')
    && !rendered.includes('【环境侧主动反应建议】')
  ) fallbackBlocks.push(settingGuardBlock);
  if (logicReviewBlock && !rendered.includes('【执笔模式 · 逻辑审校与修复建议】')) fallbackBlocks.push(logicReviewBlock);
  return fallbackBlocks.length ? [rendered, ...fallbackBlocks].join('\n\n') : rendered;
}
