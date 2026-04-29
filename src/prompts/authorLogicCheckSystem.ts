import type { Background, StoryOutline } from '@/types/content';
import type {
  AuthorLogicCheckConfig,
  AuthorNarrativeState,
  AuthorRandomEventState,
  Item,
  Message,
  Npc,
  SceneRef,
} from '@/types/game';
import { formatStoryArcForPrompt } from '@/lib/authorMode';
import { formatItemsForPrompt } from '@/lib/items';

export const AUTHOR_LOGIC_CHECK_SYSTEM = `你是互动小说的"逻辑审校 / 连续性编辑"。你不写正文，不生成玩家选项，只检查当前故事的连续性风险，并输出未来修复指令。

检查重点：
- 人物：姓名、关系、好感、外观服装、承诺、主角已知/未知信息是否冲突。
- 场景：当前位置、可达地点、时间、天气、行动阻力是否跳变。
- 道具：背包中物品获得/消耗/损毁是否与正文矛盾。
- 大纲/节奏：是否偏离当前阶段，是否提前剧透、跳过关键 beat、无故新增支线。
- 记忆/伏笔：长期记忆、玩家标记、叙事弧是否被遗忘或反复改写。

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

规则：
- 不要为了挑错而臆造问题；没有明显问题也要输出空 issues 和少量保持建议。
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
}): string {
  const plan = p.narrative?.plan;
  return [
    `【审校任务】检查截至第 ${p.currentRound} 回合后的连续性与逻辑风险。`,
    `总回合：${!p.totalRounds || p.totalRounds <= 0 ? '无尽模式' : p.totalRounds}`,
    '',
    '【故事大纲】',
    p.outline
      ? `标题：${p.outline.title}\n梗概：${p.outline.synopsis}\n阶段：${p.outline.acts.join(' / ')}${p.outline.tone ? `\n文风：${p.outline.tone}` : ''}`
      : '（无）',
    '',
    '【主角/出身】',
    p.background
      ? `姓名：${p.characterName || '（未命名）'}\n${p.background.name}：${p.background.description}\n特质：${p.background.traits.join('、')}`
      : '（无）',
    '',
    p.summary?.trim() ? `【历史摘要】\n${p.summary.trim()}\n` : '',
    p.longTermMemory?.trim() ? `【长期一致性记忆】\n${p.longTermMemory.trim()}\n` : '',
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
    '【当前叙事导演计划】',
    plan
      ? [
        plan.currentAct ? `当前幕：${plan.currentAct}` : '',
        plan.currentStage ? `当前阶段：${plan.currentStage}` : '',
        plan.stageGoal ? `阶段目标：${plan.stageGoal}` : '',
        plan.nextRoundFocus ? `下一回合焦点：${plan.nextRoundFocus}` : '',
        plan.nextFewRoundsPlan?.length ? `未来计划：${plan.nextFewRoundsPlan.map((x) => `第${x.startRound}-${x.endRound}回合 ${x.goal}`).join('；')}` : '',
      ].filter(Boolean).join('\n')
      : '（无）',
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
