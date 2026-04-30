import type { Background, StoryOutline, WorldBookEntry } from '@/types/content';
import type {
  AuthorLogicCheckConfig,
  AuthorNarrativeState,
  AuthorRandomEventState,
  Item,
  MemoryAnchor,
  Message,
  Npc,
  SceneRef,
} from '@/types/game';
import { formatStoryArcForPrompt } from '@/lib/authorMode';
import { formatItemsForPrompt } from '@/lib/items';
import { formatStageNarrativeForPrompt } from '@/lib/stageNarrative';

export const AUTHOR_LOGIC_CHECK_SYSTEM = `你是互动小说的"逻辑审校 / 连续性编辑"。你不写正文，不生成玩家选项，只检查当前故事的连续性风险，并输出未来修复指令。

检查重点：
- 人物：姓名、关系、好感、外观服装、承诺、主角已知/未知信息是否冲突。
- 场景：当前位置、可达地点、时间、天气、行动阻力是否跳变。
- 道具：背包中物品获得/消耗/损毁是否与正文矛盾。
- 大纲/节奏：是否偏离当前主弧阶段，是否违反阶段判断的 playerPace/storyFocus，是否提前剧透、跳过关键 beat、无故新增支线。
- 记忆/伏笔：长期记忆、玩家标记、叙事弧是否被遗忘或反复改写。
- ★ 世界书违反：故事是否擅自重写或绕过 alwaysActive 世界书条目（如能力规则被改写、世界基调被打破）——这是最高优先级检查项。

输出协议：
1. 只能输出合法 JSON，禁止 Markdown 围栏、注释和解释。
2. 形状如下：
{
  "overall":"总体审校结论，≤240字",
  "issues":[
    {
      "type":"character|scene|timeline|item|outline|memory|pacing|other",
      "severity":"info|warning|critical",
      "description":"问题描述，≤160字",
      "evidence":"来自上下文的证据，≤160字",
      "repairHint":"后续如何自然修复，≤160字"
    }
  ],
  "repairDirectives":["给后续故事模型的修复指令，最多8条，每条≤120字"],
  "nextRoundWarnings":["下一回合尤其要避免的坑，最多6条，每条≤100字"]
}

severity 判定标准（必须严格执行，不要为了"不打扰"统一标 info）：

- critical：故事的根基被破坏。包括：
  · 违反 alwaysActive 世界书条目（例：世界书写"能力主动可控"，故事写成"被动反向触发"）
  · 与【长期一致性记忆】固化的稳定事实直接冲突（例：记忆写"主角答应明晚去图书馆"，本回合主角去了别处且无人提及约定）
  · 推翻【玩家标记的关键记忆】（玩家显式 anchor 的内容被忽视、改写、提前消解）
  · 主角秘密被无意义提前揭示（违反 revealPolicy）
  · 跨多回合反复出现且未被修正的细节崩坏

- warning：明显的细节矛盾，会让读者明显出戏：
  · NPC 外观/服装/称呼跨回合无故跳变
  · 时间/天气在没有过场的情况下突变（例：刚刚深夜，下一句突然下午）
  · 道具状态与正文不符（例：明明已损毁的道具又出现）
  · 阶段跳过当前导演计划要求的关键 beat
  · 违反 playerPace：在玩家沉浸/探索节奏下，一回合推进多个空间转移、重大决定或阶段事件
  · stageJudge.shouldAdvance=false 时强行触发下一阶段标志性事件
  · 与刚刚发生剧情的因果脱节

- info：轻度提示，不修复也不破坏阅读：
  · 措辞偏差（例："按你口味" / "按我口味" 这种文字级抖动）
  · 早期记忆与新状态的过期残留（例："赤脚"在已购鞋后还偶尔出现）
  · 猜测性观察的小不一致（"我感觉" / "我觉得"措辞抖动）
  · 文风轻微偏离 outline.tone

判定纪律：
- 宁可标高一档，也不要漏抓。审校的价值在于发现问题、推动修复，而不是"不打扰"。
- 如果某个问题反复在多回合出现且前几次只标 info 没被修复，本次必须升级为 warning 或 critical。
- 同一类问题已经在 repairDirectives 中被记录的，新一轮如未修复应明确指出"修复未生效，建议升级强度"。
- 没有问题也要诚实输出空 issues + 简短保持建议；不要为了凑数臆造问题。

规则：
- 修复建议应服务于未来剧情自然修补，不要求重写已发生正文。
- 不得揭示主角尚不知道的隐藏真相；可以说"保持为未揭示"或"以主角视角模糊处理"。`;

function formatRecent(msgs: Message[]): string {
  if (!msgs.length) return '（无）';
  return msgs.map((m) => {
    const tag = m.role === 'assistant' ? `故事·第${m.round}回合` : `玩家·第${m.round}回合`;
    return `【${tag}】\n${m.content}`;
  }).join('\n\n');
}

function formatNpcs(npcs: Npc[]): string {
  if (!npcs.length) return '（尚无已知 NPC）';
  return npcs.slice(0, 20).map((n) => {
    const aff = n.affinity > 0 ? `+${n.affinity}` : String(n.affinity);
    const details = n.details?.length ? `；细节：${n.details.slice(0, 10).join('、')}` : '';
    return `· ${n.name}${n.role ? `（${n.role}）` : ''} id:${n.id} 好感 ${aff}${n.description ? `；${n.description}` : ''}${details}${n.recentNote ? `；最近：${n.recentNote}` : ''}`;
  }).join('\n');
}

function formatScene(scene?: SceneRef, available?: SceneRef[]): string {
  const lines: string[] = [];
  if (scene) {
    lines.push(`当前：${scene.name}${scene.description ? ` —— ${scene.description}` : ''}`);
    if (scene.time) lines.push(`时间：${scene.time}`);
    if (scene.weather) lines.push(`天气：${scene.weather}`);
  } else {
    lines.push('当前：（未知）');
  }
  if (available?.length) {
    lines.push(`可前往：${available.map((s) => `${s.name}${s.description ? `（${s.description}）` : ''}`).join('、')}`);
  }
  return lines.join('\n');
}

function formatArcs(p: {
  narrative?: AuthorNarrativeState;
  randomEventState?: AuthorRandomEventState;
  currentRound: number;
}): string {
  const arcs = [
    ...(p.randomEventState?.pendingEvent ? [p.randomEventState.pendingEvent] : []),
    ...(p.randomEventState?.activeEvents ?? []),
    ...(p.narrative?.activeArcs ?? []),
  ];
  if (!arcs.length) return '（无）';
  return arcs.slice(0, 10).map((arc) => formatStoryArcForPrompt(arc, p.currentRound)).join('\n');
}

function formatNarrativePlan(narrative: AuthorNarrativeState | undefined): string {
  const plan = narrative?.plan;
  if (!plan) return '（无）';
  return [
    plan.currentAct ? `当前幕：${plan.currentAct}` : '',
    plan.currentStage ? `当前阶段：${plan.currentStage}` : '',
    plan.stageGoal ? `阶段目标：${plan.stageGoal}` : '',
    plan.nextRoundFocus ? `下一节拍焦点：${plan.nextRoundFocus}` : '',
    plan.nextFewRoundsPlan?.length
      ? `近期方向：${plan.nextFewRoundsPlan.map((x) => x.goal).join('；')}`
      : '',
    plan.pacingAdvice ? `节奏建议：${plan.pacingAdvice}` : '',
  ].filter(Boolean).join('\n') || '（无）';
}

function formatWorldBook(entries: WorldBookEntry[] | undefined): string {
  if (!entries?.length) return '';
  const always = entries.filter((e) => e.alwaysActive);
  const triggered = entries.filter((e) => !e.alwaysActive);
  const lines: string[] = ['【世界设定】（违反这些设定的细节即为连续性问题，请重点检查）'];
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
  const lines: string[] = ['【玩家标记的关键记忆】（玩家明确标记不可遗忘的节点；如果它被忽视、改写、提前消解，请作为 critical 级问题输出）'];
  for (const a of anchors.slice(-10)) {
    const note = a.note ? `【${a.note}】` : '';
    const content = (a.content?.trim() || a.excerpt?.trim() || '').trim();
    if (!content) continue;
    lines.push(`· 第 ${a.round} 回合${note}：${content}`);
  }
  return lines.length > 1 ? lines.join('\n') : '';
}

export function buildAuthorLogicCheckUser(p: {
  outline?: StoryOutline;
  background?: Background;
  characterName?: string;
  currentRound: number;
  totalRounds: number;
  config: AuthorLogicCheckConfig;
  summary?: string;
  longTermMemory?: string;
  recent: Message[];
  latestStory?: string;
  npcs: Npc[];
  backpack: Item[];
  currentScene?: SceneRef;
  availableScenes?: SceneRef[];
  narrative?: AuthorNarrativeState;
  randomEventState?: AuthorRandomEventState;
  worldBookEntries?: WorldBookEntry[];
  anchors?: MemoryAnchor[];
}): string {
  const worldBookBlock = formatWorldBook(p.worldBookEntries);
  const anchorsBlock = formatAnchors(p.anchors);
  const stageNarrativeBlock = formatStageNarrativeForPrompt(p.narrative);
  return [
    `【审校任务】检查截至第 ${p.currentRound} 回合后的连续性与逻辑风险。`,
    `总回合：${!p.totalRounds || p.totalRounds <= 0 ? '无尽模式' : p.totalRounds}`,
    '',
    '【故事大纲】',
    p.outline
      ? `标题：${p.outline.title}\n梗概：${p.outline.synopsis}\n阶段：${p.outline.acts.join(' / ')}${p.outline.tone ? `\n文风：${p.outline.tone}` : ''}`
      : '（无）',
    '',
    worldBookBlock,
    worldBookBlock ? '' : '',
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
    '【NPC 状态】',
    formatNpcs(p.npcs),
    '',
    '【背包状态】',
    formatItemsForPrompt(p.backpack),
    '',
    '【场景状态】',
    formatScene(p.currentScene, p.availableScenes),
    '',
    stageNarrativeBlock,
    stageNarrativeBlock ? '' : '',
    '【当前叙事导演计划】',
    formatNarrativePlan(p.narrative),
    '',
    '【正在进行的叙事弧 / 长线事件】',
    formatArcs({ narrative: p.narrative, randomEventState: p.randomEventState, currentRound: p.currentRound }),
    '',
    '【玩家给审校模型的额外要求】',
    p.config.prompt || '（无）',
    '',
    '请按系统协议输出 JSON。只检查和给修复建议，不要写故事正文。',
  ].filter(Boolean).join('\n');
}
