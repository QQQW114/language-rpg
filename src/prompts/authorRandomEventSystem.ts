/**
 * 提示词输入说明（维护用注释，不会进入模型）：
 * - system：动态长线事件导演身份、是否触发随机事件与事件弧 JSON 协议。
 * - user：buildAuthorRandomEventUser 拼装当前随机事件调度/生成任务。
 * - 输入包含：故事大纲、主角出身、历史摘要、长期记忆、最近上下文、最新故事片段、世界书、玩家标记、能力。
 * - 输入包含：当前已知 NPC、当前场景、阶段化叙事 / 玩家节奏、当前叙事导演计划、已在进行中的叙事弧。
 * - 输入包含：动态随机事件配置、mustTrigger、scheduleReason、玩家填写的随机事件生成提示词、事件偏好提示词、参考随机事件池。
 * - chat + 司书库启用时，服务层还会追加司书库 systemRules / manifest，并开放对应工具。
 * - 输出：trigger=false 的原因，或 trigger=true 的长线事件弧 JSON。
 */
import type { Background, RandomEvent, StoryOutline, WorldBookEntry } from '@/types/content';
import type {
  AuthorNarrativeState,
  AuthorRandomEventConfig,
  Item,
  MemoryAnchor,
  Message,
  Npc,
  SceneRef,
} from '@/types/game';
import { formatItemsForPrompt } from '@/lib/items';
import { formatStoryArcForPrompt } from '@/lib/authorMode';
import { formatStageNarrativeForPrompt } from '@/lib/stageNarrative';

export const AUTHOR_RANDOM_EVENT_SYSTEM = `你是这段互动小说的"动态长线事件导演"。你会严格参照用户消息中的故事大纲、世界书、长期记忆、最近上下文、最新故事片段、人物关系、当前场景、叙事计划和玩家事件偏好，判断是否生成一个像小说支线一样有明面目标、隐藏意图、阶段推进和自然收束的事件弧。

动态长线事件规则：不续写正文，只判断下一回合是否应该引入一个贴合上下文的长线事件，并在需要时生成事件弧 JSON。

输出协议：
1. 只能输出合法 JSON，禁止 Markdown 围栏、注释和解释。
2. 若不触发，输出：
   {"trigger":false,"reason":"一句话说明为什么暂不触发"}
3. 若触发，输出：
   {
     "trigger":true,
     "reason":"一句话说明触发依据",
     "arc":{
       "title":"事件名，8~24字",
       "summary":"事件概述，说明明面发生什么",
       "directive":"给故事模型的本事件总指令：如何自然引入、如何推进、玩家可感知的冲突是什么",
       "lifecycle":"candidate",
       "surfaceGoal":"玩家与主角当前可感知的明面目标，≤180字",
       "hiddenIntent":"幕后真实意图/误会/关系试探/反转，仅供规划，不要直接写给玩家",
       "completionCriteria":["事件怎样算阶段性完成"],
       "failureCriteria":["事件怎样算轻度失败/需要补救"],
       "abandonCriteria":["玩家怎样算放弃或绕开此事件"],
       "worldProgressDelta":8,
       "relationshipDeltas":[
         {"npcName":"小晴","affinityDelta":6,"trustDelta":3,"note":"共同经历一次主动邀约"}
       ],
       "progressPercent":0,
       "writingBoundary":"下一回合只写到事件被自然引入，不直接写完整过程",
       "involvedNpcNames":["人物名"],
       "tags":["恋爱","约会","主线推进"],
       "targetEndRound":12,
       "stages":[
         {"startRound":5,"endRound":5,"title":"邀约","goal":"恋爱对象主动提出邀请","requiredBeats":["她给出看似自然的理由"],"avoid":"不要直接揭示隐藏意图"},
         {"startRound":6,"endRound":7,"title":"同行","goal":"二人共同经历一个小波折","requiredBeats":["关系升温或产生误会"]},
         {"startRound":8,"endRound":8,"title":"收束","goal":"事件阶段性结束并留下后续钩子","requiredBeats":["给玩家留下新的行动空间"]}
       ]
     }
   }

生成原则：
- 优先使用上文已经出现的人物、承诺、关系、地点、未解情绪和长期记忆；不要凭空扔入与题材无关的大危机。
- 事件要像小说支线/章节弧：有明面目标、隐藏意图、阶段推进和收束方向；回合字段只作调度参考，不得迫使故事模型压缩剧情。
- lifecycle 初始通常为 candidate；事件真正进入正文后由程序置为 active/progressing。progressPercent 初始通常为 0。
- completionCriteria / failureCriteria / abandonCriteria 用于后续结算；事件失败不是故事失败，只会影响关系、世界/阶段进度或生成替代桥接事件。
- writingBoundary 只约束下一回合的引入/推进边界，避免故事模型一口气写完整条事件。
- 必须尊重【阶段化叙事 / 玩家节奏】：事件触发应服务当前主弧阶段；如果玩家正处于沉浸/探索节奏，不要生成会立刻把剧情推到下一阶段的大事件。
- 每个阶段只规定方向与必达节拍，不要替玩家决定关键行动。
- 若是恋爱/关系线，事件应由现有关系状态自然触发，例如主动邀约、误会澄清、共同完成一件事。
- 若上下文不适合引入新事件，且本轮不是"必须触发"，应 trigger=false。`;

function formatRecent(msgs: Message[]): string {
  if (!msgs.length) return '（无）';
  return msgs
    .map((m) => {
      const tag = m.role === 'assistant' ? `故事·第${m.round}回合` : `玩家·第${m.round}回合`;
      return `【${tag}】\n${m.content}`;
    })
    .join('\n\n');
}

function formatNpcs(npcs: Npc[]): string {
  if (!npcs.length) return '（尚无已知 NPC）';
  return npcs.slice(0, 12).map((n) => {
    const aff = n.affinity > 0 ? `+${n.affinity}` : String(n.affinity);
    const details = n.details?.length ? `；细节：${n.details.join('、')}` : '';
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

function formatReferenceEvents(events: RandomEvent[]): string {
  if (!events.length) return '（无）';
  return events.slice(0, 10).map((ev) =>
    `· ${ev.name}：${ev.directive}（概率 ${Math.round(ev.probability * 100)}%${ev.minRound ? `，第${ev.minRound}回合起` : ''}${ev.cooldown ? `，冷却${ev.cooldown}` : ''}）`,
  ).join('\n');
}

function formatWorldBook(entries: WorldBookEntry[] | undefined): string {
  if (!entries?.length) return '';
  const always = entries.filter((e) => e.alwaysActive);
  const triggered = entries.filter((e) => !e.alwaysActive);
  const lines: string[] = ['【世界设定】（生成事件时不要违反这些设定）'];
  if (always.length) {
    lines.push('常驻：');
    for (const e of always.slice(0, 6)) {
      lines.push(`· ${e.name}：${e.content}`);
    }
  }
  if (triggered.length) {
    lines.push('本回合触发：');
    for (const e of triggered.slice(0, 6)) {
      lines.push(`· ${e.name}：${e.content}`);
    }
  }
  return lines.length > 1 ? lines.join('\n') : '';
}

function formatAnchors(anchors: MemoryAnchor[] | undefined): string {
  if (!anchors?.length) return '';
  const lines: string[] = ['【玩家标记的关键记忆】（玩家明确关注的节点；新事件应能呼应、推进或回收这些线索，不要绕过）'];
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
  return ['【玩家能力】（新事件可以围绕已有能力展开）', formatItemsForPrompt(backpack)].join('\n');
}

function formatNarrativePlan(narrative: AuthorNarrativeState | undefined): string {
  const plan = narrative?.plan;
  if (!plan) return '';
  const lines: string[] = ['【当前叙事导演计划】（新事件必须服务此计划，不要与之冲突）'];
  if (plan.currentAct) lines.push(`当前幕：${plan.currentAct}`);
  if (plan.currentStage) lines.push(`当前阶段：${plan.currentStage}`);
  if (plan.stageGoal) lines.push(`阶段目标：${plan.stageGoal}`);
  if (plan.nextRoundFocus) lines.push(`下一回合焦点：${plan.nextRoundFocus}`);
  if (plan.nextFewRoundsPlan?.length) {
    lines.push('近期计划：');
    plan.nextFewRoundsPlan.slice(0, 4).forEach((item) => {
      lines.push(`· ${item.goal}`);
    });
  }
  if (plan.outlineMapping) {
    const m = plan.outlineMapping;
    lines.push(`大纲映射：${m.alignment}${m.currentAct ? `；${m.currentAct}` : ''}${m.stageProgress !== undefined ? `；阶段进度${m.stageProgress}%` : ''}`);
    if (m.missingBridgeEvents?.length) lines.push(`缺少桥接事件：${m.missingBridgeEvents.join('；')}`);
    if (m.candidateEvents?.length) lines.push(`推荐事件方向：${m.candidateEvents.join('；')}`);
  }
  if (plan.pacingAdvice) lines.push(`节奏建议：${plan.pacingAdvice}`);
  return lines.length > 1 ? lines.join('\n') : '';
}

function formatActiveArcs(narrative: AuthorNarrativeState | undefined, currentRound: number): string {
  const arcs = narrative?.activeArcs ?? [];
  if (!arcs.length) return '';
  const lines: string[] = ['【已在进行中的叙事弧】（不要生成与这些主题或时段冲突的新事件，可让新事件配合或避让）'];
  for (const arc of arcs.slice(0, 5)) {
    lines.push(formatStoryArcForPrompt(arc, currentRound));
  }
  return lines.join('\n');
}

export function buildAuthorRandomEventUser(p: {
  outline?: StoryOutline;
  background?: Background;
  characterName?: string;
  currentRound: number;
  nextRound: number;
  totalRounds: number;
  mustTrigger: boolean;
  scheduleReason: string;
  config: AuthorRandomEventConfig;
  summary?: string;
  longTermMemory?: string;
  latestStory: string;
  recent: Message[];
  npcs: Npc[];
  currentScene?: SceneRef;
  referenceEvents: RandomEvent[];
  worldBookEntries?: WorldBookEntry[];
  backpack?: Item[];
  anchors?: MemoryAnchor[];
  narrative?: AuthorNarrativeState;
}): string {
  const isInfinite = !p.totalRounds || p.totalRounds <= 0;
  const dynamic = p.config.dynamic;
  const worldBookBlock = formatWorldBook(p.worldBookEntries);
  const anchorsBlock = formatAnchors(p.anchors);
  const backpackBlock = formatBackpack(p.backpack);
  const planBlock = formatNarrativePlan(p.narrative);
  const activeArcsBlock = formatActiveArcs(p.narrative, p.currentRound);
  const stageNarrativeBlock = formatStageNarrativeForPrompt(p.narrative);
  return [
    '【世界观 / 故事大纲】',
    p.outline ? `标题：${p.outline.title}\n梗概：${p.outline.synopsis}\n阶段：${p.outline.acts.join(' / ')}${p.outline.tone ? `\n文风：${p.outline.tone}` : ''}` : '（无）',
    '',
    worldBookBlock,
    worldBookBlock ? '' : '',
    '【主角/出身】',
    p.background ? `姓名：${p.characterName || '（未命名）'}\n${p.background.name}：${p.background.description}\n特质：${p.background.traits.join('、')}` : '（无）',
    '',
    p.summary?.trim() ? `【历史摘要】\n${p.summary.trim()}\n` : '',
    p.longTermMemory?.trim() ? `【长期一致性记忆】\n${p.longTermMemory.trim()}\n` : '',
    anchorsBlock,
    anchorsBlock ? '' : '',
    '【最近上下文】',
    formatRecent(p.recent),
    '',
    '【最新故事片段】',
    p.latestStory,
    '',
    '【当前已知 NPC】',
    formatNpcs(p.npcs),
    '',
    backpackBlock,
    backpackBlock ? '' : '',
    '【当前场景】',
    formatScene(p.currentScene),
    '',
    stageNarrativeBlock,
    stageNarrativeBlock ? '' : '',
    planBlock,
    planBlock ? '' : '',
    activeArcsBlock,
    activeArcsBlock ? '' : '',
    '【玩家填写的随机事件生成提示词】',
    dynamic.generatorPrompt || '（无）',
    '',
    '【事件偏好提示词】',
    dynamic.preferencePrompt || '（无）',
    '',
    '【参考随机事件】',
    formatReferenceEvents(p.referenceEvents),
    '',
    '【当前上下文 / 调度要求】',
    p.mustTrigger
      ? '本轮处于必定触发区间。除非上下文完全无法成立，否则必须输出 trigger=true 并生成事件弧。'
      : '本轮通过概率检查，但仍需你判断剧情是否适合触发；若不适合可 trigger=false。',
    `调度原因：${p.scheduleReason}`,
    `当前已完成回合：${p.currentRound}`,
    `事件将注入的下一回合：第 ${p.nextRound} 回合`,
    `总回合：${isInfinite ? '无尽模式' : p.totalRounds}`,
    '',
    '请按系统协议输出 JSON。targetEndRound 应结合总回合与事件规模，通常持续 3~8 回合；stages 必须覆盖 startRound=下一回合到 targetEndRound 的主要节奏。',
  ].filter(Boolean).join('\n');
}
