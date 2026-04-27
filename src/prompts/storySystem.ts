// 故事主持人（Story GM）提示词构造
// 导出一个函数而非静态字符串，方便根据世界书/随机事件/回合动态拼装。

import type { StoryOutline, Background, WorldBookEntry, RandomEvent } from '@/types/content';
import type { Item, Npc, MemoryAnchor, SceneRef } from '@/types/game';
import type { StrictCustomConfig } from '@/types/custom';
import { formatItemsForPrompt } from '@/lib/items';
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
  currentRound: number;
  totalRounds: number;          // 0 = 无尽模式
  triggeredEvent?: RandomEvent;
  backpack?: Item[];
  usedItems?: Item[];
  npcs?: Npc[];
  anchors?: MemoryAnchor[];
  currentScene?: SceneRef;
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

export function buildStorySystem(p: BuildStorySystemParams): string {
  const {
    outline, background, characterName, activeWorldBookEntries,
    summary, currentRound, totalRounds, triggeredEvent, backpack, usedItems, npcs, anchors, currentScene,
    finalizeRequested, lengthHint, styleAddendum, strictCustom,
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
        '（必须严格遵循上述文风与题材，禁止擅自转向其他类型——例如不要把恋爱故事写成惊悚悬疑，不要把温情成长故事写成动作冒险；情节冲突应源于"题材本身应有的张力"，不要靠外部悬疑/超自然元素凭空制造戏剧性。）',
      );
    }
    const actPlanBlock = buildActPlanBlock(outline.acts, nextRound, totalRounds, finalizeRequested);
    if (actPlanBlock) outlineLines.push('', actPlanBlock);
  }

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

  const npcLines: string[] = [];
  if (npcs && npcs.length) {
    npcLines.push('【已登场人物】（请保持人物一致性：姓名、外形、性格不得与以下记录冲突）');
    for (const n of npcs.slice(0, 12)) {
      const aff = n.affinity > 0 ? `+${n.affinity}` : `${n.affinity}`;
      const role = n.role ? `【${n.role}】` : '';
      const desc = n.description ? ` —— ${n.description}` : '';
      const note = n.recentNote ? `（最近：${n.recentNote}）` : '';
      npcLines.push(`· ${n.name}${role}（好感 ${aff}）${desc}${note}`);
    }
  }

  const anchorLines: string[] = [];
  if (anchors && anchors.length) {
    anchorLines.push('【玩家标记的关键记忆】（这些是玩家认为重要、不可遗忘的情节，请在后续叙事中显性或隐性地呼应它们）');
    for (const a of anchors.slice(-8)) {
      const note = a.note ? `【${a.note}】` : '';
      anchorLines.push(`· 第 ${a.round} 回合${note}：${a.excerpt}`);
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

  return renderPromptTemplate(template, {
    round: nextRound,
    completedRounds: currentRound,
    nextRound,
    totalRounds: isInfinite ? '无尽' : totalRounds,
    remainingAfter: isInfinite ? '无尽' : remainingAfter,
    roundInfo,
    outlineBlock: outlineLines.join('\n'),
    backgroundBlock,
    worldBookAlwaysBlock,
    worldBookTriggeredBlock,
    summaryBlock,
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
}
