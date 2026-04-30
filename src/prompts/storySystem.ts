// 故事主持人（Story GM）提示词构造
// 导出一个函数而非静态字符串，方便根据世界书/随机事件/回合动态拼装。

import type { StoryOutline, Background, WorldBookEntry, RandomEvent } from '@/types/content';
import type { AuthorLogicIssue, AuthorNarrativeState, AuthorRandomEventState, Item, Npc, MemoryAnchor, SceneRef } from '@/types/game';
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

function buildActPlanBlock(
  acts: string[] | undefined,
  nextRound: number,
  totalRounds: number,
  finalizeRequested?: boolean,
): string {
  const cleanActs = (acts ?? []).map((a) => a.trim()).filter(Boolean);
  if (!cleanActs.length) return '';

  const isInfinite = !totalRounds || totalRounds <= 0;
  const lines = [
    '【阶段路线图】（这是长期剧情骨架，必须纳入规划；不要在正文中直接剧透给玩家）',
  ];

  if (isInfinite) {
    cleanActs.forEach((act, index) => {
      lines.push(`· 第 ${index + 1} 阶段：${act}`);
    });
    if (finalizeRequested) {
      lines.push(`当前阶段参考：玩家已要求完结，请服务于最终阶段：${cleanActs[cleanActs.length - 1]}`);
    } else {
      lines.push(
        '当前阶段参考：无尽模式没有固定回合配比；请结合历史摘要与最近对话判断已经完成到哪一阶段，优先推进尚未充分完成的最早阶段，不要自由脱纲或提前跳到后续幕。',
      );
    }
  } else {
    const ratio = Math.max(0, Math.min(0.999, (nextRound - 1) / Math.max(totalRounds, 1)));
    const currentIndex = finalizeRequested
      ? cleanActs.length - 1
      : Math.min(cleanActs.length - 1, Math.floor(ratio * cleanActs.length));

    cleanActs.forEach((act, index) => {
      const start = Math.floor((index * totalRounds) / cleanActs.length) + 1;
      const end = Math.max(start, Math.floor(((index + 1) * totalRounds) / cleanActs.length));
      lines.push(`· 第 ${index + 1} 阶段（约第 ${start}-${end} 回合）：${act}`);
    });
    lines.push(`当前阶段参考：第 ${nextRound} 回合应服务于第 ${currentIndex + 1} 阶段：${cleanActs[currentIndex]}`);
  }

  lines.push(
    '执行规则：允许因玩家选择微调顺序，但不要无故抛弃路线图；每回合只推进一个清晰 beat，不要在一个回合内跨越多个阶段。',
  );
  return lines.join('\n');
}

function anchorContent(a: MemoryAnchor): string {
  return (a.content?.trim() || a.excerpt?.trim() || '').trim();
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
    ? `这是【无尽模式】：故事没有预设的总回合数，玩家会在合适的时刻主动触发结局。当前即将开始第 ${nextRound} 回合。`
    : `整段故事规划为 ${totalRounds} 回合。当前即将开始第 ${nextRound} 回合（已完成 ${currentRound} 回合，本回合结束后还剩 ${remainingAfter} 回合）。`;

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
    const actPlanBlock = buildActPlanBlock(outline.acts, nextRound, totalRounds, finalizeRequested);
    if (actPlanBlock) outlineLines.push('', actPlanBlock);
  }

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
    arcLines.push('执行规则：若事件弧标注了目标结束回合，请在该回合前后自然收束；不要无故遗忘、跳过或提前解决。');
  }
  const storyArcBlock = arcLines.join('\n');

  const plan = authorNarrative?.plan;
  const narrativePlanBlock = plan
    ? [
      '【执笔模式 · 当前叙事导演计划】',
      plan.currentAct ? `当前幕：${plan.currentAct}` : '',
      plan.currentStage ? `当前阶段：${plan.currentStage}` : '',
      plan.stageGoal ? `阶段目标：${plan.stageGoal}` : '',
      plan.stageStartRound || plan.stageTargetEndRound
        ? `阶段范围：第 ${plan.stageStartRound ?? '?'}-${plan.stageTargetEndRound ?? '?'} 回合`
        : '',
      plan.nextRoundFocus ? `下一回合焦点：${plan.nextRoundFocus}` : '',
      plan.nextFewRoundsPlan?.length
        ? [
          '接下来若干回合方向：',
          ...plan.nextFewRoundsPlan.slice(0, 6).map((item) =>
            `· 第 ${item.startRound}-${item.endRound} 回合：${item.goal}${item.requiredBeats?.length ? `；必达：${item.requiredBeats.join('、')}` : ''}${item.avoidBeats?.length ? `；避免：${item.avoidBeats.join('、')}` : ''}`,
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
      lines.push('', '【环境侧主动反应建议】（可选演绎，不强制全部纳入）：');
      beats.slice(0, 4).forEach((b) => {
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
      critical.slice(0, 6).forEach((i) => lines.push(formatIssue(i)));
    }
    if (warning.length) {
      lines.push('', '建议修复（明显风险，尽快通过剧情自然修补）：');
      warning.slice(0, 6).forEach((i) => lines.push(formatIssue(i)));
    }
    if (info.length) {
      lines.push('', '参考（轻度提示，写作时留意即可）：');
      info.slice(0, 4).forEach((i) => lines.push(formatIssue(i)));
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
    npcLines.push('【已登场人物】（请保持人物一致性：姓名、外形、性格不得与以下记录冲突）');
    for (const n of npcs.slice(0, 12)) {
      const aff = n.affinity > 0 ? `+${n.affinity}` : `${n.affinity}`;
      const role = n.role ? `【${n.role}】` : '';
      const desc = n.description ? ` —— ${n.description}` : '';
      const details = n.details?.length ? `；细节：${n.details.slice(0, 8).join('、')}` : '';
      const note = n.recentNote ? `（最近：${n.recentNote}）` : '';
      npcLines.push(`· ${n.name}${role}（好感 ${aff}）${desc}${details}${note}`);
    }
  }

  const anchorLines: string[] = [];
  if (anchors && anchors.length) {
    anchorLines.push('【玩家标记的关键记忆】（这些是玩家认为重要、不可遗忘的情节，请在后续叙事中显性或隐性地呼应它们）');
    for (const a of anchors.slice(-8)) {
      const note = a.note ? `【${a.note}】` : '';
      const content = anchorContent(a);
      if (!content) continue;
      anchorLines.push(`· 第 ${a.round} 回合${note}：${content}`);
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
