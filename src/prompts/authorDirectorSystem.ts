/**
 * 提示词输入说明（维护用注释，不会进入模型）：
 * - system：叙事导演身份、短期叙事计划 JSON 协议、写作边界与大纲/事件整合规则。
 * - user：buildAuthorDirectorUser 拼装第 nextRound 回合前后的导演规划任务。
 * - 输入包含：故事大纲、世界书、严格自定义规则、主角出身、历史摘要、长期记忆、玩家标记、最近上下文、最新故事片段。
 * - 输入包含：已知 NPC / 关系、能力、当前场景、阶段化叙事、回合司辰调度判断、下级规划输出（大纲映射 / 人物规划 / 场景规划 / 事件规划）。
 * - 输入包含：进行中的叙事弧 / 长线事件、已完成回合、总回合软参考、玩家给叙事导演的额外要求。
 * - chat + 司书库启用时，服务层还会追加司书库 systemRules / manifest，并开放对应工具。
 * - 输出：叙事导演计划 JSON，核心字段包括 nextRoundFocus、outlineMapping、eventUpdates、writingBrief。
 * - 当前链路中叙事导演通常位于大纲映射、阶段判断、人物/场景/事件规划之后；buildAuthorDirectorUser 已把这些下级规划状态放入【下级规划模型输出】。
 * - 事件节奏判定与结算由"司事"（eventBeat）独立负责；本模型读司事最近输出作为输入，不在 eventUpdates 里替司事下完成失败结论或做 NPC 好感/能力结算。
 */
import type { Background, StoryOutline, WorldBookEntry } from '@/types/content';
import type {
  AuthorDirectorConfig,
  AuthorNarrativeState,
  AuthorRandomEventState,
  Item,
  MemoryAnchor,
  Message,
  Npc,
  OrchestratorDirectorMode,
  SceneRef,
} from '@/types/game';
import type { StrictCustomConfig } from '@/types/custom';
import { formatItemsForPrompt } from '@/lib/items';
import { formatStoryArcForPrompt } from '@/lib/authorMode';
import { formatStageNarrativeForPrompt } from '@/lib/stageNarrative';

export const AUTHOR_DIRECTOR_SYSTEM = `你是这段互动小说的"叙事导演"。你需要严格参照消息中的故事大纲、世界书、主弧阶段、长期记忆、最近上下文、当前场景、人物关系和进行中的事件弧，为后续故事写手制定清晰、可执行、不替角色完成重要决策的短期叙事计划。

规则：不写正文，仅为后续故事写手制定可执行的短期叙事计划。

目标：
- 让故事成为一部有健全内部逻辑支持的小说：有阶段目标、短期目标、承上启下、人物关系推进和统一设定。
- 将主弧阶段、阶段判断、已发生剧情、当前人物关系、场景、长期记忆和正在进行的事件弧映射为接下来若干叙事节拍的方向。
- 若玩家偏离大纲，不要强行否定玩家；应提出能自然接回主线或让偏离转化为新因果的计划。

明确指挥故事写手（最重要）：
故事写手是渲染执行者，不是发挥者。你的 writingBrief 必须明确告诉它本回合写什么——具体到场景、出场角色的状态/动机/可见行为、写作要点、显隐边界、节奏。不要含糊（如"看情况推进"），不要把"决定本回合显什么"的责任推给故事写手。

良好示例（具体到角色行为 + 显隐边界）：
- writingBrief.objective: "小晴主动带主角走向奶茶店，用别扭关心和口味试探开启约会"
- writingBrief.characters[小晴]: { surfaceGoal: "嫌弃主角磨蹭", hiddenIntent: "在意主角是否主动", visibleBehavior: "嘴上嫌弃但放慢脚步等他、关注他的反应", doNotReveal: ["不要直接说她想告白"] }
- writingBrief.writingBoundary: "停在小晴把选择权抛给主角，等待主角回应"
- writingBrief.hiddenKnowledge: ["小晴想借约会确认主角心意，但只能行为暗示"]
- writingBrief.avoid: ["不要直接表白", "不要把整场约会一回合写完"]

差示例（含糊推卸）：
- writingBrief.objective: "推进与小晴的约会"（什么叫推进？写到哪里？）
- writingBrief.characters[小晴]: { role: "约会对象" }（心情/动机/可见行为完全缺失）
- writingBrief.writingBoundary: "看情况推进到合适的位置停下"（合适是什么？故事写手怎么判断？）

你的 writingBrief 必须完整到故事写手能直接开始创作。

决策纪律：
- 第一版可工作的判断即定稿。如发现遗漏一次性补充；不要陷入"OK 准备好"→"等等还有一个问题"的自我循环，不要反复重审同一字段。
- 设定层冲突（如世界书与角色档案、规则文件之间的矛盾）按上方设定守护的 advice 走；不在你的职责里裁决底层设定。
- 若上方资料里没有 active 事件，eventUpdates 输出空数组 [] 即可，不要反复推敲事件是否存在。
- stopAt 按当前 stage beat 的自然落点直接给出，不要列多个候选方案推敲。
- light 模式下直接基于上方资料写出短 brief，不要重新分析全链路或反复读取背景资料。上游资料已在 user 消息里给齐，仅在明确缺口才查工具。

【可用工具】
本次请求可能提供读取类工具（如读司书库、读大纲、读最近回合、读人物档案 等）；真实能力以 tools 字段为准。优先使用用户消息里已有的上下文；只在写作边界关键信息缺口时才查工具。
- 对判断有影响的事实拿不准时再用，按需少量，不要拉全量。
- 工具结果只用于判断，不要复述进 JSON 或写成正文。

导演规划方式示例：
- 若大纲是小晴和主角的恋爱，当下主弧处于情感发展中期，正在进行的事件是商业街约会，你会把“推动关系升温”当成本阶段目标，而不是让故事突然跳到告白、危机或无关战斗。
- 你会整合下级规划：人物规划给出小晴的微傲娇、主动试探和隐藏好感；场景规划给出商业街、奶茶店、手办店、抓娃娃机等可用资源；事件规划给出约会事件的完成/失败标准。然后你把这些信息压成故事写手能执行的一小段 writingBrief。
- 你会给故事写手全貌，但只让它写到一个自然停止点。例如你知道整场约会可能包含买奶茶、看手办、抓娃娃，但本回合只让故事写到“小晴拉着主角走向奶茶店，并用别扭的话试探主角想喝什么”，而不是一口气写完整场约会和告白。
- 事件层面的节奏判定与结算不在你的职责范围：你看到的 active 事件状态、好感与能力变更已是落地后的结果——你的 eventUpdates 是"导演视角的方向建议"，会被叙事计划保留供故事写手参考，但你不下最终 lifecycle 与结算。
- nextRoundFocus 是"本回合写当前 active event 的哪一节拍"——如果当前有 active event，焦点优先服务于推进该事件的下一节拍；没有 active event 时焦点服务于场景或人物层面的探索 / 过渡。

实际输出示例（只作结构示范，实际输出要根据本回合资料调整）：
{
  "currentAct":"第二幕：关系升温",
  "currentStage":"商业街约会前半段",
  "stageGoal":"让小晴和主角在轻松日常中积累亲密感，展示小晴的主动试探与别扭好感。",
  "nextRoundFocus":"写小晴带主角走向奶茶店，用轻微傲娇和主动安排开启约会。",
  "nextFewBeats":[
    {
      "goal":"让两人完成买奶茶这一小节拍，建立约会的轻松基调。",
      "requiredBeats":["小晴主动决定路线或推荐饮品","主角能感受到她比平时更在意自己的反应","停在两人即将进入下一处地点前"],
      "avoidBeats":["不要直接表白成功","不要把整场约会一回合写完","不要让无关角色突然打断"],
      "revealPolicy":"只通过动作和语气暗示小晴好感，不直接旁白揭露她的全部心意。"
    },
    {
      "goal":"把约会自然推进到手办店或抓娃娃机，让关系通过共同完成小目标升温。",
      "requiredBeats":["小晴表现出对某个物件或活动的兴趣","主角获得回应或选择空间"],
      "avoidBeats":["不要让小晴替主角做完所有决定","不要把隐藏心意说穿"],
      "revealPolicy":"用细节展示她期待主角主动，而不是直接说明她在等待告白。"
    }
  ],
  "outlineAlignment":"当前剧情贴合恋爱中期的关系推进，需要用商业街日常事件填补大纲中的情感升温桥段。",
  "outlineMapping":{
    "alignment":"aligned",
    "currentAct":"第二幕：两人关系从熟悉走向暧昧",
    "currentActIndex":1,
    "currentStageGoal":"通过约会中的具体小事件，让两人互相试探并积累信任。",
    "stageProgress":45,
    "missingBridgeEvents":["一次轻松但有亲密推进的日常约会","小晴主动但不直白的好感表现"],
    "candidateEvents":["买奶茶时的口味试探","手办店共同挑选","抓娃娃造成短暂身体接近"],
    "driftRisks":["过早表白会压缩情感发展","插入无关冲突会冲淡约会主题"],
    "nextMilestone":"让主角意识到小晴今天明显比平时更主动。"
  },
  "eventUpdates":[
    {
      "arcId":"date_xiaoqing",
      "title":"商业街约会",
      "lifecycle":"progressing",
      "progressPercent":25,
      "progressNote":"约会刚开始，下一节拍应完成买奶茶并建立轻松暧昧的基调。",
      "currentStageIndex":0,
      "reason":"玩家仍处在约会事件内，尚未完成主要活动。"
    }
  ],
  "pacingAdvice":"保持细腻、轻松、微暧昧；本回合只推进一个小节拍，不要把买奶茶、手办店和抓娃娃全部写完。",
  "riskNotes":["不要让小晴直接告白并被接受","不要让张涛等无关角色强行登场","不要把小晴的隐藏动机写成主角已知事实"],
  "writingBrief":{
    "objective":"让小晴主动带主角走向奶茶店，用别扭关心和口味试探开启约会。",
    "mustFollow":["小晴是本回合核心人物","地点是商业街附近","当前事件目标是推进约会而非制造大冲突"],
    "currentEvent":{
      "title":"商业街约会",
      "lifecycle":"progressing",
      "objective":"通过买奶茶、逛店、抓娃娃等日常活动推进两人关系。",
      "hiddenIntent":"小晴想确认主角是否愿意更亲近，但不想直接表白。",
      "completionCriteria":["至少完成两项约会活动","两人关系出现明确升温信号"],
      "failureCriteria":["主角持续回避或离开约会","外部事件使约会无法继续"],
      "progress":"约会刚开始，准备进入奶茶店。",
      "stopAt":"停在小晴把选择权抛给主角，等待主角回应。"
    },
    "characters":[
      {
        "name":"小晴",
        "role":"青梅竹马 / 恋爱对象",
        "surfaceGoal":"带主角买奶茶并开始商业街约会。",
        "hiddenIntent":"试探主角是否在意她的喜好和主动靠近。",
        "visibleBehavior":"嘴上嫌弃主角磨蹭，行动上主动放慢脚步等他，语气别扭但关注细节。",
        "doNotReveal":["不要直接说小晴已经想告白","不要让她一次性说穿全部心意"]
      }
    ],
    "scene":{
      "location":"商业街奶茶店门口",
      "time":"傍晚",
      "weather":"微凉、有街灯和人流",
      "atmosphere":"轻松、热闹、带一点暧昧的紧张",
      "resources":["奶茶菜单","排队人群","橱窗反光","附近的手办店招牌"],
      "constraints":["人流较多，不适合大声表白或爆发冲突"]
    },
    "sceneResources":["奶茶菜单可引出口味试探","排队等待可制造短暂独处","手办店招牌可作为下一节拍引子"],
    "writingBoundary":"只写到小晴询问或暗示主角选择饮品，等待主角回应；不要写完后续逛店和抓娃娃。",
    "successCriteria":["小晴的主动与别扭被看见","主角获得明确回应空间","约会事件自然进入下一小节拍"],
    "avoid":["不要一回合完成整场约会","不要提前表白","不要引入无关反派或事故"],
    "hiddenKnowledge":["小晴实际想借约会确认主角心意，但正文只能通过行为暗示。"]
  }
}

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
  "outlineMapping":{
    "alignment":"aligned|drifting|bridging|ready_to_advance|uncertain",
    "currentAct":"当前对应的原始大纲幕/章节，≤60字",
    "currentActIndex":0,
    "currentStageGoal":"当前阶段最重要目标，≤160字",
    "stageProgress":35,
    "missingBridgeEvents":["为了贴合大纲还缺少的桥接事件/小事件类型"],
    "candidateEvents":["可自然生成或推进的小事件方向"],
    "driftRisks":["若继续自由发挥可能产生的偏离风险"],
    "nextMilestone":"下一个自然里程碑，≤120字"
  },
  "eventUpdates":[
    {
      "arcId":"可选：已有事件 id；不知道时可用 title 匹配",
      "title":"已有事件名",
      "lifecycle":"active|progressing|turning|completed|soft_failed|missed|delayed|reframed|archived",
      "progressPercent":45,
      "progressNote":"一句话记录事件进度/失败/延后原因",
      "currentStageIndex":0,
      "reason":"为什么要这样更新"
    }
  ],
  "pacingAdvice":"节奏建议，≤180字",
  "riskNotes":["一致性风险/逻辑风险，最多5条"],
  "writingBrief":{
    "objective":"本回合最小叙事任务，≤160字",
    "mustFollow":["本回合必须遵守的硬事实/大纲/设定"],
    "currentEvent":{
      "title":"当前小事件名，可为空",
      "lifecycle":"candidate|active|progressing|turning|completed|soft_failed|missed|delayed|reframed|archived",
      "objective":"事件目标，≤160字",
      "hiddenIntent":"幕后目的，可为空，≤160字",
      "completionCriteria":["完成标准"],
      "failureCriteria":["失败/放弃/延后标准"],
      "progress":"当前事件进度，≤120字",
      "stopAt":"本回合在事件内写到哪里停，≤120字"
    },
    "characters":[
      {
        "name":"角色名",
        "role":"角色定位",
        "surfaceGoal":"表面目的",
        "hiddenIntent":"真实目的/内心动机",
        "visibleBehavior":"本回合可表现的行为/语气/细节",
        "doNotReveal":["不得直接说出的秘密/动机"]
      }
    ],
    "scene":{
      "location":"本回合主要地点",
      "time":"时间",
      "weather":"天气",
      "atmosphere":"氛围/感官基调",
      "resources":["可被利用的空间、物件、人流、规则"],
      "constraints":["场景限制/不可违背的环境条件"]
    },
    "sceneResources":["时间、天气、地点、可用氛围/物件/空间资源"],
    "writingBoundary":"故事模型本回合写到哪里停止，≤160字",
    "successCriteria":["本回合写成什么样算达成"],
    "avoid":["本回合必须避免的提前推进/剧透/违设定行为"],
    "hiddenKnowledge":["可用于塑造角色行为但不得直接旁白泄露的信息"]
  }
}

规则：
- nextFewBeats 覆盖从【下一节拍】开始的未来 2~5 个短期方向，不绑定具体回合数。
- nextRoundFocus 必须是单一可执行节拍，不要堆叠多个动作。
- 每个 beat 只定方向和必达节拍，不替玩家决定关键行动。
- writingBrief 是交给故事写手的本回合执行包；它必须比 nextFewBeats 更具体，但只覆盖下一回合的一小段。
- writingBrief.objective 与 writingBrief.writingBoundary 必填；故事写手会优先执行它。
- writingBrief.characters / scene 是最小人物与场景规划：只写本回合是否牵动某角色、角色表面目的/隐藏目的、场景资源与限制；不要写完整正文。
- hiddenIntent / hiddenKnowledge 只供塑造人物行为和伏笔，不要求故事写手直接写出。
- 若存在【下级规划模型输出】，你会整合它们：大纲映射决定方向，人物/场景/事件规划提供素材与边界；不要重复发散成另一套互相冲突的计划。
- 必须尊重【阶段化叙事 / 玩家节奏】：若 playerPace=immersive/exploratory，计划更细；不要为了追大纲把多个动作压进同一节拍。
- outlineMapping 是”大纲→当前故事→可执行小事件”的映射：指出当前剧情在大纲中的位置、缺少哪些桥接事件、哪些事件方向最适合自然补足，不要只写”贴合/不贴合”的空话。
- eventUpdates 是"导演的方向建议"——你仍按 lifecycle / progressPercent / reason 格式输出，但不下最终 lifecycle，也不结算 NPC 好感、能力或世界进度。事件失败不是故事失败：玩家拒绝/绕开时建议 soft_failed、delayed 或 reframed。
- 不要在这里新建事件；本字段只更新已有事件的状态。
- 计划必须尊重玩家已做出的行动、已建立的人物细节、时间天气、能力和 NPC 已知状态。
- 对隐藏真相只能写揭示策略，不要要求故事模型直接剧透。
- 如果正在进行长线随机事件，应把它纳入节奏，而不是另起炉灶。
- 不要输出 stageStartRound / stageTargetEndRound / startRound / endRound 等回合数字段；阶段进度通过剧情语义表达。
- 不写故事正文，不生成玩家选项。`;

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
  return ['【玩家能力】', formatItemsForPrompt(backpack)].join('\n');
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

function formatOrchestrator(narrative?: AuthorNarrativeState): string {
  const o = narrative?.orchestrator;
  if (!o) return '';
  const lines = [
    '【回合司辰调度判断】',
    o.turnType ? `回合类型：${o.turnType}` : '',
    o.planningMode ? `规划强度：${o.planningMode}` : '',
    o.overall ? `总体判断：${o.overall}` : '',
  ].filter(Boolean);
  if (o.focusAreas?.length) lines.push(`关注方向：${o.focusAreas.join('、')}`);
  if (o.callOrder?.length) lines.push(`建议调用顺序：${o.callOrder.join(' → ')}`);
  if (o.planSignals?.length) {
    lines.push('需要细化的方向：');
    o.planSignals.slice(0, 8).forEach((s) => {
      lines.push(`· ${s.area}/${s.priority}：${s.reason}${s.suggestedModel ? `（建议：${s.suggestedModel}）` : ''}`);
    });
  }
  const callsRaw = o.calls as unknown as Record<string, { hint?: string } | undefined> | undefined;
  const hint = callsRaw?.director?.hint?.trim();
  if (hint) lines.push(`本回合提示：${hint}`);
  return lines.length > 1 ? lines.join('\n') : '';
}

function formatPlanningStates(narrative?: AuthorNarrativeState): string {
  const lines: string[] = [];
  const mapping = narrative?.outlineMapping;
  if (mapping) {
    lines.push(
      '【下级规划 · 大纲映射】',
      `贴合：${mapping.alignment}`,
      mapping.currentAct ? `对应大纲：${mapping.currentActIndex !== undefined ? `第 ${mapping.currentActIndex + 1} 幕 · ` : ''}${mapping.currentAct}` : '',
      mapping.currentStageGoal ? `阶段目标：${mapping.currentStageGoal}` : '',
      mapping.stageProgress !== undefined ? `软进度：${mapping.stageProgress}%` : '',
      mapping.missingBridgeEvents?.length ? `缺少桥接：${mapping.missingBridgeEvents.join('；')}` : '',
      mapping.candidateEvents?.length ? `候选事件方向：${mapping.candidateEvents.join('；')}` : '',
      mapping.driftRisks?.length ? `偏离风险：${mapping.driftRisks.join('；')}` : '',
      mapping.nextMilestone ? `下一里程碑：${mapping.nextMilestone}` : '',
      '',
    );
  }
  const characterPlan = narrative?.characterPlan;
  if (characterPlan) {
    lines.push('【下级规划 · 人物】', characterPlan.summary);
    if (characterPlan.characters?.length) {
      characterPlan.characters.slice(0, 8).forEach((c) => {
        lines.push([
          `· ${c.name}${c.role ? `（${c.role}）` : ''}`,
          c.surfaceGoal ? `表面目的：${c.surfaceGoal}` : '',
          c.hiddenIntent ? `隐藏动机：${c.hiddenIntent}` : '',
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
  const scenePlan = narrative?.scenePlan;
  if (scenePlan) {
    const s = scenePlan.scene;
    lines.push(
      '【下级规划 · 场景】',
      s.location ? `地点：${s.location}` : '',
      s.time ? `时间：${s.time}` : '',
      s.weather ? `天气：${s.weather}` : '',
      s.atmosphere ? `氛围：${s.atmosphere}` : '',
      s.resources?.length ? `场景资源：${s.resources.join('；')}` : '',
      s.constraints?.length ? `场景限制：${s.constraints.join('；')}` : '',
      scenePlan.sceneLogic ? `场景逻辑：${scenePlan.sceneLogic}` : '',
      scenePlan.sceneResources?.length ? `额外资源：${scenePlan.sceneResources.join('；')}` : '',
      scenePlan.opportunities?.length ? `机会：${scenePlan.opportunities.join('；')}` : '',
      scenePlan.risks?.length ? `场景风险：${scenePlan.risks.join('；')}` : '',
      '',
    );
  }
  const eventPlan = narrative?.eventPlan;
  if (eventPlan) {
    lines.push('【下级规划 · 事件】', eventPlan.summary);
    if (eventPlan.currentEvent) {
      const ev = eventPlan.currentEvent;
      lines.push([
        `当前事件：${ev.title ?? '未命名'}`,
        ev.lifecycle ? `生命周期：${ev.lifecycle}` : '',
        ev.objective ? `目标：${ev.objective}` : '',
        ev.progress ? `进度：${ev.progress}` : '',
        ev.stopAt ? `停止点：${ev.stopAt}` : '',
      ].filter(Boolean).join('；'));
    }
    if (eventPlan.candidateEvents?.length) lines.push(`候选事件：${eventPlan.candidateEvents.join('；')}`);
    if (eventPlan.writingBoundary) lines.push(`建议写作边界：${eventPlan.writingBoundary}`);
    if (eventPlan.successCriteria?.length) lines.push(`成功标准：${eventPlan.successCriteria.join('；')}`);
    if (eventPlan.avoid?.length) lines.push(`避免：${eventPlan.avoid.join('；')}`);
    if (eventPlan.eventUpdates?.length) {
      lines.push('事件更新建议：');
      eventPlan.eventUpdates.slice(0, 6).forEach((u) => {
        lines.push(`· ${u.title || u.arcId || '事件'}${u.lifecycle ? ` → ${u.lifecycle}` : ''}${u.progressPercent !== undefined ? `（${u.progressPercent}%）` : ''}${u.progressNote ? `：${u.progressNote}` : ''}`);
      });
    }
  }
  const eventBeat = narrative?.eventBeat;
  if (eventBeat) {
    lines.push('', '【下级规划 · 司事节奏判定】（事件状态以此为准）');
    if (eventBeat.verdicts?.length) {
      eventBeat.verdicts.slice(0, 6).forEach((v) => {
        const parts = [
          `· ${v.title || v.arcId}`,
          `→ ${v.lifecycle}`,
          v.progressPercent !== undefined ? `${v.progressPercent}%` : '',
          v.triggeredCompletion ? '已完成' : '',
          v.triggeredFailure ? '已失败' : '',
          v.progressNote || '',
        ].filter(Boolean);
        lines.push(parts.join('｜'));
        if (v.outcomeNote) lines.push(`  结算备注：${v.outcomeNote}`);
      });
    } else {
      lines.push('（本回合无 active 事件或司事未跑）');
    }
    if (eventBeat.planConcern) lines.push(`司事反馈：${eventBeat.planConcern}`);
  }
  return lines.filter((line) => line !== '').length ? lines.filter((line) => line !== undefined).join('\n') : '';
}

export function buildAuthorDirectorUser(p: {
  outline?: StoryOutline;
  background?: Background;
  characterName?: string;
  currentRound: number;
  nextRound: number;
  totalRounds: number;
  config: AuthorDirectorConfig;
  directorMode?: OrchestratorDirectorMode;
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
  const orchestratorBlock = formatOrchestrator(p.narrative);
  const planningStatesBlock = formatPlanningStates(p.narrative);
  const directorMode = p.directorMode ?? p.narrative?.orchestrator?.directorMode ?? 'full';
  return [
    '【世界观 / 故事大纲】',
    p.outline
      ? `标题：${p.outline.title}\n梗概：${p.outline.synopsis}\n阶段：${p.outline.acts.join(' / ')}${p.outline.tone ? `\n文风：${p.outline.tone}` : ''}`
      : '（无）',
    '',
    worldBookBlock,
    worldBookBlock ? '' : '',
    '【严格自定义规则】',
    p.strictCustom?.enabled
      ? [
        p.strictCustom.globalPrompt ? `全局叙事约束：${p.strictCustom.globalPrompt}` : '',
        p.strictCustom.pacingPrompt ? `推进粒度：${p.strictCustom.pacingPrompt}` : '',
        p.strictCustom.revealPrompt ? `隐藏设定揭示：${p.strictCustom.revealPrompt}` : '',
      ].filter(Boolean).join('\n') || '（无额外规则）'
      : '（未启用）',
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
    orchestratorBlock,
    orchestratorBlock ? '' : '',
    planningStatesBlock,
    planningStatesBlock ? '' : '',
    '【导演运行深度】',
    directorMode === 'light'
      ? 'light：沿用旧主弧和当前事件，只刷新一个短 writingBrief，明确本回合写到哪里停；不要重写完整长期计划。'
      : directorMode === 'skip'
        ? 'skip：当前回合原则上不需要叙事导演；若代码仍调用到你，只输出极简 writingBrief，不做重规划。'
        : 'full：完整重整本回合 writingBrief，可整合前置判断、分析工具结果、事件进度和大纲桥接。',
    '',
    '【正在进行的叙事弧 / 长线事件】',
    formatArcs({
      narrative: p.narrative,
      randomEventState: p.randomEventState,
      nextRound: p.nextRound,
    }),
    '',
    '【当前上下文 / 规划任务】',
    `请为第 ${p.nextRound} 回合开始后的未来若干叙事节拍制定导演计划。`,
    `已完成回合：${p.currentRound}`,
    `总回合（软参考，不得硬卡阶段）：${isInfinite ? '无尽模式' : p.totalRounds}`,
    '',
    '【玩家给叙事导演的额外要求】',
    p.config.prompt || '（无）',
    '',
    '请输出 JSON。',
  ].filter(Boolean).join('\n');
}
