import type { Background, StoryOutline, WorldBookEntry } from '@/types/content';
import type {
  AuthorDirectorConfig,
  AuthorNarrativeState,
  AuthorRandomEventState,
  Item,
  MemoryAnchor,
  Message,
  Npc,
  SceneRef,
} from '@/types/game';
import type { StrictCustomConfig } from '@/types/custom';
import { formatItemsForPrompt } from '@/lib/items';
import { formatStoryArcForPrompt } from '@/lib/authorMode';
import { formatStageNarrativeForPrompt } from '@/lib/stageNarrative';

export const AUTHOR_DIRECTOR_SYSTEM = `你是互动小说的"叙事导演 / 小说编辑"。你不写正文，不生成玩家选项，只为后续故事模型制定可执行的短期叙事计划。

目标：
- 让故事像一部有逻辑的小说：有阶段目标、短期目标、承上启下、人物关系推进和统一设定。
- 将主弧阶段、阶段判断、详细大纲、已发生剧情、当前人物关系、场景、长期记忆和正在进行的事件弧映射为接下来若干叙事节拍的方向。
- 若玩家偏离大纲，不要强行否定玩家；应提出能自然接回主线或让偏离转化为新因果的计划。

输出协议：
1. 只能输出合法 JSON，禁止 Markdown 围栏、注释和解释。
2. 形状如下：
{
  "currentAct":"当前所处大纲幕/阶段，≤40字",
  "currentStage":"更具体的当前章节阶段，≤40字",
  "stageGoal":"本阶段总体目标，≤160字",
  "nextRoundFocus":"下一节拍最应该服务的单一焦点，≤120字",
  "nextFewBeats":[
    {
      "goal":"接下来一个短节拍目标，≤160字",
      "requiredBeats":["必须出现/推进的情节点"],
      "avoidBeats":["不要做的事"],
      "revealPolicy":"隐藏信息揭示策略，≤120字"
    }
  ],
  "outlineAlignment":"当前剧情与大纲的贴合/偏离判断，≤180字",
  "pacingAdvice":"节奏建议，≤180字",
  "riskNotes":["一致性风险/逻辑风险，最多5条"]
}

规则：
- nextFewBeats 覆盖从【下一节拍】开始的未来 2~5 个短期方向，不绑定具体回合数。
- 每个 beat 只定方向和必达节拍，不替玩家决定关键行动。
- 必须尊重【阶段化叙事 / 玩家节奏】：若 playerPace=immersive/exploratory，计划更细；不要为了追大纲把多个动作压进同一节拍。
- 计划必须尊重玩家已做出的行动、已建立的人物细节、时间天气、背包和 NPC 已知状态。
- 对隐藏真相只能写揭示策略，不要要求故事模型直接剧透。
- 如果正在进行长线随机事件，应把它纳入节奏，而不是另起炉灶。`;

function formatRecent(msgs: Message[]): string {
  if (!msgs.length) return '（无）';
  return msgs.map((m) => {
    const tag = m.role === 'assistant' ? `故事·第${m.round}回合` : `玩家·第${m.round}回合`;
    return `【${tag}】\n${m.content}`;
  }).join('\n\n');
}

function formatNpcs(npcs: Npc[]): string {
  if (!npcs.length) return '（尚无已知 NPC）';
  return npcs.slice(0, 16).map((n) => {
    const aff = n.affinity > 0 ? `+${n.affinity}` : String(n.affinity);
    const details = n.details?.length ? `；细节：${n.details.slice(0, 10).join('、')}` : '';
    return `· ${n.name}${n.role ? `（${n.role}）` : ''}：好感 ${aff}${n.description ? `；${n.description}` : ''}${details}${n.recentNote ? `；最近：${n.recentNote}` : ''}`;
  }).join('\n');
}

function formatScene(scene?: SceneRef): string {
  if (!scene) return '（未知）';
  return [
    scene.name,
    scene.description ? `描述：${scene.description}` : '',
    scene.time ? `时间：${scene.time}` : '',
    scene.weather ? `天气：${scene.weather}` : '',
  ].filter(Boolean).join('\n');
}

function formatStrictOutline(config?: StrictCustomConfig): string {
  const items = config?.detailedOutline ?? [];
  if (!items.length) return '（无）';
  return items
    .slice(0, 20)
    .map((item, index) => `· 详细方向 ${index + 1}（原建议区间仅作软参考）：${item.prompt}`)
    .join('\n');
}

function formatWorldBook(entries: WorldBookEntry[] | undefined): string {
  if (!entries?.length) return '';
  const always = entries.filter((e) => e.alwaysActive);
  const triggered = entries.filter((e) => !e.alwaysActive);
  const lines: string[] = ['【世界设定】'];
  if (always.length) {
    lines.push('常驻：');
    for (const e of always.slice(0, 8)) {
      lines.push(`· ${e.name}：${e.content}`);
    }
  }
  if (triggered.length) {
    lines.push('本回合触发：');
    for (const e of triggered.slice(0, 8)) {
      lines.push(`· ${e.name}：${e.content}`);
    }
  }
  return lines.length > 1 ? lines.join('\n') : '';
}

function formatAnchors(anchors: MemoryAnchor[] | undefined): string {
  if (!anchors?.length) return '';
  const lines: string[] = ['【玩家标记的关键记忆】（玩家明确标记的不可遗忘节点；制定计划时请确保这些信息得到呼应或推进，不要被规划忽视）'];
  for (const a of anchors.slice(-8)) {
    const note = a.note ? `【${a.note}】` : '';
    const content = (a.content?.trim() || a.excerpt?.trim() || '').trim();
    if (!content) continue;
    lines.push(`· 第 ${a.round} 回合${note}：${content}`);
  }
  return lines.length > 1 ? lines.join('\n') : '';
}

function formatBackpack(backpack: Item[] | undefined): string {
  if (!backpack?.length) return '';
  return ['【玩家背包】', formatItemsForPrompt(backpack)].join('\n');
}

function formatArcs(p: {
  narrative?: AuthorNarrativeState;
  randomEventState?: AuthorRandomEventState;
  nextRound: number;
}): string {
  const arcs = [
    ...(p.randomEventState?.pendingEvent ? [p.randomEventState.pendingEvent] : []),
    ...(p.randomEventState?.activeEvents ?? []),
    ...(p.narrative?.activeArcs ?? []),
  ];
  if (!arcs.length) return '（无）';
  return arcs.slice(0, 10).map((arc) => formatStoryArcForPrompt(arc, p.nextRound)).join('\n');
}

export function buildAuthorDirectorUser(p: {
  outline?: StoryOutline;
  background?: Background;
  characterName?: string;
  currentRound: number;
  nextRound: number;
  totalRounds: number;
  config: AuthorDirectorConfig;
  strictCustom?: StrictCustomConfig;
  summary?: string;
  longTermMemory?: string;
  recent: Message[];
  latestStory?: string;
  npcs: Npc[];
  currentScene?: SceneRef;
  narrative?: AuthorNarrativeState;
  randomEventState?: AuthorRandomEventState;
  worldBookEntries?: WorldBookEntry[];
  backpack?: Item[];
  anchors?: MemoryAnchor[];
}): string {
  const isInfinite = !p.totalRounds || p.totalRounds <= 0;
  const worldBookBlock = formatWorldBook(p.worldBookEntries);
  const anchorsBlock = formatAnchors(p.anchors);
  const backpackBlock = formatBackpack(p.backpack);
  const stageNarrativeBlock = formatStageNarrativeForPrompt(p.narrative);
  return [
    `【规划任务】请为第 ${p.nextRound} 回合开始后的未来若干叙事节拍制定导演计划。`,
    `已完成回合：${p.currentRound}`,
    `总回合（软参考，不得硬卡阶段）：${isInfinite ? '无尽模式' : p.totalRounds}`,
    '',
    '【故事大纲】',
    p.outline
      ? `标题：${p.outline.title}\n梗概：${p.outline.synopsis}\n阶段：${p.outline.acts.join(' / ')}${p.outline.tone ? `\n文风：${p.outline.tone}` : ''}`
      : '（无）',
    '',
    worldBookBlock,
    worldBookBlock ? '' : '',
    '【严格自定义详细大纲】',
    formatStrictOutline(p.strictCustom),
    '',
    '【主角/出身】',
    p.background
      ? `姓名：${p.characterName || '（未命名）'}\n${p.background.name}：${p.background.description}\n特质：${p.background.traits.join('、')}`
      : '（无）',
    '',
    p.summary?.trim() ? `【历史摘要】\n${p.summary.trim()}\n` : '',
    p.longTermMemory?.trim() ? `【长期一致性记忆】\n${p.longTermMemory.trim()}\n` : '',
    anchorsBlock,
    anchorsBlock ? '' : '',
    '【最近上下文】',
    formatRecent(p.recent),
    '',
    p.latestStory?.trim() ? `【最新故事片段】\n${p.latestStory.trim()}\n` : '',
    '【已知 NPC / 关系】',
    formatNpcs(p.npcs),
    '',
    backpackBlock,
    backpackBlock ? '' : '',
    '【当前场景】',
    formatScene(p.currentScene),
    '',
    stageNarrativeBlock,
    stageNarrativeBlock ? '' : '',
    '【正在进行的叙事弧 / 长线事件】',
    formatArcs({
      narrative: p.narrative,
      randomEventState: p.randomEventState,
      nextRound: p.nextRound,
    }),
    '',
    '【玩家给叙事导演的额外要求】',
    p.config.prompt || '（无）',
    '',
    '请输出 JSON。注意：nextRoundFocus 必须是单一可执行节拍；不要输出 stageStartRound / stageTargetEndRound / startRound / endRound；不要写正文，不要生成选项。',
  ].filter(Boolean).join('\n');
}
