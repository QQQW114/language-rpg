import type { Background, RandomEvent, StoryOutline } from '@/types/content';
import type { AuthorRandomEventConfig, Message, Npc, SceneRef } from '@/types/game';

export const AUTHOR_RANDOM_EVENT_SYSTEM = `你是互动小说的"动态长线事件导演"。你的任务不是续写正文，而是判断下一回合是否应该引入一个贴合上下文的长线事件，并在需要时生成事件弧 JSON。

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
       "hiddenIntent":"幕后真实意图/误会/关系试探/反转，仅供规划，不要直接写给玩家",
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
- 事件要像小说支线/章节弧：有明面目标、隐藏意图、阶段推进和目标结束回合。
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
}): string {
  const isInfinite = !p.totalRounds || p.totalRounds <= 0;
  const dynamic = p.config.dynamic;
  return [
    p.mustTrigger
      ? '【调度要求】本轮处于必定触发区间。除非上下文完全无法成立，否则必须输出 trigger=true 并生成事件弧。'
      : '【调度要求】本轮通过概率检查，但仍需你判断剧情是否适合触发；若不适合可 trigger=false。',
    `调度原因：${p.scheduleReason}`,
    `当前已完成回合：${p.currentRound}`,
    `事件将注入的下一回合：第 ${p.nextRound} 回合`,
    `总回合：${isInfinite ? '无尽模式' : p.totalRounds}`,
    '',
    '【故事大纲】',
    p.outline ? `标题：${p.outline.title}\n梗概：${p.outline.synopsis}\n阶段：${p.outline.acts.join(' / ')}${p.outline.tone ? `\n文风：${p.outline.tone}` : ''}` : '（无）',
    '',
    '【主角/出身】',
    p.background ? `姓名：${p.characterName || '（未命名）'}\n${p.background.name}：${p.background.description}\n特质：${p.background.traits.join('、')}` : '（无）',
    '',
    p.summary?.trim() ? `【历史摘要】\n${p.summary.trim()}\n` : '',
    p.longTermMemory?.trim() ? `【长期一致性记忆】\n${p.longTermMemory.trim()}\n` : '',
    '【最近上下文】',
    formatRecent(p.recent),
    '',
    '【最新故事片段】',
    p.latestStory,
    '',
    '【当前已知 NPC】',
    formatNpcs(p.npcs),
    '',
    '【当前场景】',
    formatScene(p.currentScene),
    '',
    '【玩家填写的随机事件生成提示词】',
    dynamic.generatorPrompt || '（无）',
    '',
    '【事件偏好提示词】',
    dynamic.preferencePrompt || '（无）',
    '',
    '【参考随机事件】',
    formatReferenceEvents(p.referenceEvents),
    '',
    '请按系统协议输出 JSON。targetEndRound 应结合总回合与事件规模，通常持续 3~8 回合；stages 必须覆盖 startRound=下一回合到 targetEndRound 的主要节奏。',
  ].filter(Boolean).join('\n');
}
