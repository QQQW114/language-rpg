// 故事主持人（Story GM）提示词构造
// 导出一个函数而非静态字符串，方便根据世界书/随机事件/回合动态拼装。

import type { StoryOutline, Background, WorldBookEntry, RandomEvent } from '@/types/content';
import type { Item, Npc, MemoryAnchor, SceneRef } from '@/types/game';
import { formatItemsForPrompt } from '@/lib/items';

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
}

function inferAct(currentRound: number, totalRounds: number, acts: string[] | undefined): string {
  if (!acts || acts.length === 0) return '';
  const ratio = Math.max(0, Math.min(1, currentRound / Math.max(totalRounds, 1)));
  const index = Math.min(acts.length - 1, Math.floor(ratio * acts.length));
  return acts[index];
}

export function buildStorySystem(p: BuildStorySystemParams): string {
  const {
    outline, background, characterName, activeWorldBookEntries,
    summary, currentRound, totalRounds, triggeredEvent, backpack, usedItems, npcs, anchors, currentScene,
    finalizeRequested, lengthHint, styleAddendum,
  } = p;

  const isInfinite = !totalRounds || totalRounds <= 0;
  const nextRound = currentRound + 1;
  const remainingAfter = isInfinite ? Infinity : Math.max(0, totalRounds - nextRound);
  const isFinal = !isInfinite ? nextRound >= totalRounds : !!finalizeRequested;
  const nearEnd = !isInfinite && !isFinal && remainingAfter <= 2;

  const parts: string[] = [];

  parts.push(
    '你是一位世界顶级的互动小说主持人（TRPG GM），正在与玩家共同完成一段长篇角色扮演。',
  );
  if (isInfinite) {
    parts.push(`这是【无尽模式】：故事没有预设的总回合数，玩家会在合适的时刻主动触发结局。当前即将开始第 ${nextRound} 回合。`);
  } else {
    parts.push(`整段故事规划为 ${totalRounds} 回合。当前即将开始第 ${nextRound} 回合（已完成 ${currentRound} 回合，本回合结束后还剩 ${remainingAfter} 回合）。`);
  }

  if (outline) {
    parts.push(
      '',
      '【故事大纲】',
      `标题：${outline.title}`,
      `梗概：${outline.synopsis}`,
    );
    if (outline.tone) {
      parts.push(
        `文风/题材：${outline.tone}`,
        '（必须严格遵循上述文风与题材，禁止擅自转向其他类型——例如不要把恋爱故事写成惊悚悬疑，不要把温情成长故事写成动作冒险；情节冲突应源于"题材本身应有的张力"，不要靠外部悬疑/超自然元素凭空制造戏剧性。）',
      );
    }
    const currentAct = inferAct(currentRound, totalRounds, outline.acts);
    if (currentAct) parts.push(`当前阶段：${currentAct}`);
  }

  if (background) {
    parts.push(
      '',
      '【角色卡】',
      `姓名：${characterName || '（未命名）'}`,
      `出身：${background.name} —— ${background.description}`,
      `特质：${background.traits.join('、') || '无'}`,
      `携带：${background.startItems.join('、') || '无'}`,
    );
  }

  const alwaysEntries = activeWorldBookEntries.filter((e) => e.alwaysActive);
  const triggeredEntries = activeWorldBookEntries.filter((e) => !e.alwaysActive);
  if (alwaysEntries.length) {
    parts.push('', '【世界设定 · 常驻】');
    for (const e of alwaysEntries) parts.push(`· ${e.name}：${e.content}`);
  }
  if (triggeredEntries.length) {
    parts.push('', '【世界设定 · 本回合触发】');
    for (const e of triggeredEntries) parts.push(`· ${e.name}：${e.content}`);
  }

  if (summary && summary.trim()) {
    parts.push('', '【历史摘要】', summary.trim());
  }

  if (npcs && npcs.length) {
    parts.push('', '【已登场人物】（请保持人物一致性：姓名、外形、性格不得与以下记录冲突）');
    for (const n of npcs.slice(0, 12)) {
      const aff = n.affinity > 0 ? `+${n.affinity}` : `${n.affinity}`;
      const role = n.role ? `【${n.role}】` : '';
      const desc = n.description ? ` —— ${n.description}` : '';
      const note = n.recentNote ? `（最近：${n.recentNote}）` : '';
      parts.push(`· ${n.name}${role}（好感 ${aff}）${desc}${note}`);
    }
  }

  if (anchors && anchors.length) {
    parts.push(
      '',
      '【玩家标记的关键记忆】（这些是玩家认为重要、不可遗忘的情节，请在后续叙事中显性或隐性地呼应它们）',
    );
    for (const a of anchors.slice(-8)) {
      const note = a.note ? `【${a.note}】` : '';
      parts.push(`· 第 ${a.round} 回合${note}：${a.excerpt}`);
    }
  }

  if (backpack && backpack.length) {
    parts.push('', '【玩家背包】', formatItemsForPrompt(backpack));
  }

  if (currentScene) {
    const desc = currentScene.description ? ` —— ${currentScene.description}` : '';
    parts.push('', `【当前所在场景】${currentScene.name}${desc}`);
    parts.push('若玩家本回合输入显式表达了"前往 XXX"的意图，请在本回合完成场景切换，用感官细节描写抵达过程与新环境；否则继续在当前场景内推进。');
  }

  if (usedItems && usedItems.length) {
    parts.push(
      '',
      '【本回合玩家使用的道具】',
      formatItemsForPrompt(usedItems),
      '请在本回合的叙事中让这些道具发挥合理作用。若其中有"一次性"物品，请在叙事里体现它被消耗的事实。',
    );
  }

  const lengthRule =
    lengthHint === 'short'
      ? '1. 只写本回合的剧情推进，不要跨越多个事件。篇幅约 140~260 个汉字，段落分明（2~3 段）。'
      : lengthHint === 'long'
      ? '1. 只写本回合的剧情推进，不要跨越多个事件。篇幅约 360~600 个汉字，段落分明（3~5 段），多用感官细节。'
      : '1. 只写本回合的剧情推进，不要跨越多个事件。篇幅约 220~420 个汉字，段落分明（2~4 段）。';

  parts.push(
    '',
    '【写作规范】',
    lengthRule,
    '2. 使用第二人称"你"称呼玩家角色。',
    '3. 不要替玩家做出本回合的关键决定；叙述在自然的选择点或悬念处收束，但避免直接写"你会怎么做？"这类元指令。',
    '4. 环境、NPC、时间推移你可以自由推进；玩家的具体行为应依据玩家上一条输入。若玩家输入含糊，你可合理演绎后果。',
    '5. 允许使用 Markdown：**人名/关键地点/物品** 以粗体强调；*内心独白/感官细节* 以斜体表现。',
    '6. 避免陈词滥调的"突然"、"仿佛一切都慢了下来"之类套话。写感官细节、矛盾张力、角色心境。',
    '7. 严禁剧透结局；严禁元叙述（"这是 AI 编写的故事"）。',
  );

  if (styleAddendum && styleAddendum.trim()) {
    parts.push('', '【玩家补充的风格偏好】', styleAddendum.trim());
  }

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
  if (special.length) {
    parts.push('', '【本回合特殊指令】', ...special);
  }

  parts.push(
    '',
    '现在，请根据最近的对话上下文与玩家最新的输入，输出本回合的故事推进。除正文外不要输出任何前言、标题或解释说明。',
  );

  return parts.join('\n');
}
