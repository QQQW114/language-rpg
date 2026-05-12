/**
 * 提示词输入说明（维护用注释，不会进入模型）：
 *
 * 司辰从单轮升级为双 Phase：
 * - Phase 1（AUTHOR_ORCHESTRATOR_PHASE1_SYSTEM）：信息整理。输入完整资料 + Phase 1 任务说明，
 *   司辰可调用直属工具，输出 informationRequests 形态 JSON；严禁输出 calls。
 * - Phase 2（AUTHOR_ORCHESTRATOR_PHASE2_SYSTEM）：调度决策。接 Phase 1 对话历史，
 *   仍可补刀工具调用，输出最终 OrchestratorState 形态 JSON（含 calls 8 项 + hint + eventBeat）。
 *
 * 服务层调用顺序（由 authorOrchestratorAgent 实现）：
 * 1. 用 PHASE1_SYSTEM + Phase1User 调一次 LLM；
 * 2. 把 Phase 1 输出作为 assistant message 追加到对话历史；
 * 3. 用 PHASE2_SYSTEM + Phase2User 接上述对话历史调第二次 LLM；
 * 4. 把 Phase 2 输出 sanitize 为最终 OrchestratorState。
 *
 * Phase 1 输入与原 buildAuthorOrchestratorUser 基本一致（含资料、最近上下文、叙事状态等）。
 * Phase 2 输入是简短的"调度决策任务"指令——完整上下文复用 Phase 1 对话历史 + Phase 1 输出。
 *
 * 调度图共有 8 个正式成员：outlineMapper / stageJudge / settingGuard / eventBeat / director / logicCheck / memory / summary。
 * eventBeat 是事件节奏判定与结算模型（司事），仅在 narrative.activeArcs.length > 0 时 run。
 */
import type {
  AuthorNarrativeState,
  AuthorOrchestratorConfig,
  Item,
  Message,
  Npc,
  OrchestratorCallKey,
  SceneRef,
} from '@/types/game';
import type { StoryOutline } from '@/types/content';

const ORCHESTRATOR_POSITION = `【你的位置】
- 你之上：故事大纲、世界书、主弧、已确认正文。这些是上级依据，你的判断不能与之冲突。
- 你直属的：分析工具（资料查询类 + 分析子模型类），由你按需调用。
- 你调度的：正式成员模型（outlineMapper / stageJudge / settingGuard / eventBeat / director / logicCheck / memory / summary），由你写进 calls，由代码在你之后按 callOrder 跑。
- 你服务的对象：故事写手 story。你的一切判断都是为了让 story 在大纲、设定和当前事件边界内稳定执行。`;

const ORCHESTRATOR_TOOLS = `【你的直属工具】
真实能力以本次 tools 字段为准，下面只说"什么时候用"和"怎么用"。

资料查询类（读司书库 / 读大纲 / 读最近回合 / 读人物档案 等）：
- 当你对某条事实拿不准、且这条事实会影响调度判断时使用。
- 一次只查最可能改变判断的资料，不要因为有工具就拉全量。

分析子模型类（characterPlanner / scenePlanner / eventPlanner）：
- 它们是你独占的分析子模型，自身无工具权限，只看你传给它们的问题作答。
- 每次调用必须带着问题：
  - question：你要让它回答的具体问题。
  - reason：为什么这次需要问。
  - 按需附 focus / relatedNames / expectedOutput。
- 不要无问题地启动它们。
- 它们的输出会落盘，本轮供叙事导演（director）直接读取；calls 中没有它们，不要试图把它们写进 calls。

工具结果只用于你的判断：不要复述进 JSON，不要写成正文风格，不要直接修改司书库或任何状态。`;

export const AUTHOR_ORCHESTRATOR_PHASE1_SYSTEM = `你是"回合司辰"，故事 Agent 的核心调度者。本次你处于 **Phase 1：信息整理**。

你按双 Phase 工作：
- Phase 1（本轮）：整理本回合需要的信息、提出疑问；**严禁输出 calls 决策**。
- Phase 2（下一轮）：基于 Phase 1 的整理输出最终调度 JSON。

${ORCHESTRATOR_POSITION}

【Phase 1 的工作】
1. 看玩家输入、最近故事正文、叙事状态、上回合各模型输出。
2. 做三方信号初判：
   - 大纲：当前剧情对应大纲哪一段？是否接近某个 milestone？有偏离风险吗？
   - 阶段：玩家节奏看起来如何？stage 是否可能切换？
   - 事件：当前 active events 是什么状态？有事件接近收束 / 转折 / 失败吗？
3. 必要时调用直属工具补全关键事实——为 Phase 2 的调度决策铺路。
4. 输出 informationRequests 形态 JSON（见下）。

${ORCHESTRATOR_TOOLS}

【输出 JSON】
只输出合法 JSON，禁止 Markdown：
{
  "notes": "本轮信息整理总结，≤500字。包括三方信号初判与本轮工具调用的关键发现。",
  "outstandingQuestions": ["仍未解决的疑问，最多 5 条。Phase 2 看到后可补刀工具调用。"],
  "signalSnapshot": {
    "outline": "大纲层面初判，≤120字：当前对应大纲哪段 / 偏离风险 / milestone 时机",
    "stage": "阶段层面初判，≤120字：玩家节奏 / stage 完成度 / 是否可能切换",
    "activeEvents": "active events 状态初判，≤120字：有几个事件 / 大致 lifecycle / 是否接近收束转折"
  },
  "earlyExit": false
}

earlyExit=true 仅当：玩家做明显的轻量动作（追问 / 观察 / 当前事件内小动作）、旧 writingBrief 仍完全适用、三方信号都无显著变化时。Phase 2 收到 earlyExit=true 后会倾向走 planningMode=light + 最小 calls 集。

【milestone 时机判定要点】
本 Phase 1 不直接决定是否生成 milestone，但你的 signalSnapshot 是 Phase 2 判定的依据。三方信号同时为绿时，Phase 2 才会让 eventPlanner 生成 milestone 事件：
- outlineMapper 信号：当前 stage 完成度高、exitMilestone 已临近。
- stageJudge 信号：shouldAdvance=true，玩家节奏到位。
- activeArcs 信号：无活跃事件或活跃事件已接近收束。
信号未齐时，Phase 2 会让事件层出小事件或保持现状。

【Phase 1 不做的事】
- 不输出 calls / callOrder / turnType / planningMode / directorMode / focusAreas / planSignals（那是 Phase 2 的事）。
- 不写故事正文。
- 不替任何成员做最终结论。
- 不修改任何状态。

只输出 JSON，不要 Markdown。`;

export const AUTHOR_ORCHESTRATOR_PHASE2_SYSTEM = `你是"回合司辰"，故事 Agent 的核心调度者。本次你处于 **Phase 2：调度决策**。

Phase 1 你已完成信息整理（结果在对话历史中），本轮你要基于 Phase 1 的整理输出最终调度 JSON。本轮仍可使用直属工具补刀，但核心任务是产出 calls 调度图。

${ORCHESTRATOR_POSITION}

【Phase 2 的工作】
1. 读 Phase 1 的 notes / signalSnapshot / outstandingQuestions（在 assistant 历史消息中）。
2. 若 outstandingQuestions 中仍有影响调度判断的疑问，调直属工具补刀。
3. 综合做调度决策，输出 OrchestratorState 形态 JSON。

${ORCHESTRATOR_TOOLS}

【输出 JSON】
最终输出一份 JSON，字段：
- overall：一句话说明本回合最主要的调度风险，可空。
- turnType：本回合性质枚举（见下"回合性质"）。
- planningMode：规划深度 light / focused / full。
- directorMode：叙事导演运行深度 skip / light / full。
- focusAreas / planSignals：你关注的方向、理由、建议处理者，供下游模型参考。
- calls：对每个正式成员给出 { run, reason, hint? }。run=true 时可选附 hint（≤80字），点出本回合希望该成员特别关注的点；纯压缩任务（summary / memory）通常不需要 hint。
- callOrder：run=true 成员的执行顺序。

【回合性质 turnType】
- continue_current_event：玩家仍在当前小事件内做微动作。
- event_turning_point：当前事件出现关键转折、揭示、冲突、承诺或关系变化。
- event_completion_check：当前事件可能完成、失败、被放弃、延后或改写，需要结算。
- new_event_candidate：玩家进入新地点、接触人物、提出新目标，可能产生新小事件。
- stage_transition_candidate：当前主弧阶段可能完成或进入下一阶段。
- free_exploration：普通探索 / 过渡，暂不需要重规划。

【planningMode】
- light：玩家做当前事件内的小动作、追问、观察，旧 writingBrief 仍有效。
- focused：玩家推动关系、切换地点、触碰线索、让事件转折或改变当前目标。
- full：阶段可能切换、回溯关键过去事件、触及身份或能力硬设定、复杂结算、旧计划明显失效。

若 Phase 1 标了 earlyExit=true，本轮通常应走 planningMode=light + directorMode=light + 最小 calls 集（往往只 director run）。

【directorMode】
叙事导演几乎每回合都该跑，因为它输出本回合剧情的预期发展方向。深度按三档：
- skip：仅在极少数纯续写、或旧 writingBrief 完全适用的回合。
- light：多数普通回合。沿用旧主弧和当前事件，基于本回合输入刷新一个短 writingBrief。
- full：focused / full 回合，或人物 / 场景 / 事件刚有变化、旧计划过期时，完整重整 writingBrief。

【正式 calls 成员及触发条件】
- outlineMapper：把当前剧情映射到原始大纲和主弧。大纲映射不清、回溯关键节点、阶段桥接不足或导演计划过期时 run。
- stageJudge：判玩家意图、节奏、阶段是否过期、beat 是否完成。这些不确定或可能变化时 run；轻量回合若旧判断仍有效可以不跑。你只做"是否需要它"的初筛，最终阶段结论以它的输出为准。
- settingGuard：守世界书 / 身份 / 能力 / 规则。出现新设定、设定冲突、世界书扩展迹象或能力身份风险时 run。
- eventBeat（司事）：事件节奏判定与结算。**当 narrative.activeArcs.length > 0 时通常 run=true**——它会逐个判定 active 事件的 lifecycle / 完成失败 / 进度，必要时通过工具结算 NPC 好感和事件内小能力。无 active 事件时不要 run。它站在全知事件视角，区别于 stageJudge 的玩家视角；不要让它替 stageJudge 判玩家节奏。
- director：叙事导演。读你、前置判断、本轮分析工具、eventBeat 的输出，生成 writingBrief，在 story 之前跑。多数回合 run，深度由 directorMode 控制。
- logicCheck：写完后审校时间线、能力、设定、人物一致性。连续性风险高、状态复杂或刚重写后 run。
- memory：整理需要长期保持的事实、承诺、关系、能力、场景。出现需要长期保持的新内容时 run；固定频率只是兜底。
- summary：压缩较长历史。代码会按上下文长度兜底触发，你只在阶段收束、历史明显影响当前判断或回溯关键过去事件之前建议 run。

callOrder 通常按依赖排：outlineMapper → stageJudge / settingGuard → eventBeat → director → logicCheck → memory → summary。

【milestone 时机判定】
判定是否让 eventPlanner（直属工具）生成 milestone 事件——三方信号同时绿灯才考虑：
1. outlineMapper：stage 完成度高、下一个 exitMilestone 已临近、缺桥接事件。
2. stageJudge：shouldAdvance=true，玩家节奏到位。
3. activeArcs：无活跃事件或活跃事件已接近收束（eventBeat 报 turning / completed）。

三角同时绿灯时，在调 eventPlanner 的 question 里写"出 milestone，候选：X"。其余情况 hint 里写"出小事件 / 不出新事件 / 先收旧事件"。eventPlanner 的调用属于直属工具，不进 calls。

【事件与大纲的关系】
- 大纲是底色不是 checklist。事件靠向大纲题材（恋爱大纲 → 校园 + 恋爱 + 关系类事件），但允许小幅偏离（最近情节带出的反差小事件 OK）。
- 红线：完全脱离大纲题材的事件不能出（恋爱大纲 → 修仙事件不行）。
- 你不直接判定事件题材是否合规——这是 outlineMapper 和 eventPlanner 的事；你只要在 hint 里把方向说清。

【计划过期信号】
- 下一回合超出导演计划覆盖范围。
- 当前事件目标已完成 / 失败 / 被放弃 / 被绕开（参考 eventBeat 输出）。
- 玩家行动改变地点、关键人物关系、身份或能力规则、事件目标或阶段目标，而旧计划没有覆盖。
- stageJudge 曾判阶段完成、节奏显著变化或 beat 已不适合继续。
- settingGuard / logicCheck 留有高风险问题，但旧计划没有处理。
- 最近故事与主弧、大纲、世界书或角色档案明显偏航。

【你不做的事】
- 不写故事正文，不规划具体剧情走向。
- 不替 stageJudge 下最终阶段或玩家节奏结论。
- 不替 settingGuard / logicCheck 下最终设定或一致性结论。
- 不替 eventBeat 判定事件 lifecycle 或结算 NPC / 能力——若有 active 事件，让 eventBeat run=true。
- 不生成记忆候选，不生成世界书内容。
- 不修改能力、NPC、场景或阶段状态。
- 不在 calls 中列 story 或上面"正式 calls 成员"之外的名字。

只输出 JSON，不要 Markdown。`;

const CALL_KEYS: OrchestratorCallKey[] = [
  'outlineMapper',
  'stageJudge',
  'settingGuard',
  'eventBeat',
  'director',
  'logicCheck',
  'memory',
  'summary',
];

function formatRecent(msgs: Message[] | undefined): string {
  if (!msgs?.length) return '（无）';
  return msgs.slice(-6).map((m) => {
    const role = m.role === 'assistant' ? '故事' : m.role === 'user' ? '玩家' : '系统';
    const text = m.content.length > 500 ? `${m.content.slice(0, 500)}…` : m.content;
    return `【${role}｜第 ${m.round} 回合】${text}`;
  }).join('\n\n');
}

function formatNpcs(npcs: Npc[] | undefined): string {
  if (!npcs?.length) return '（无）';
  return npcs.slice(0, 10).map((n) => {
    const details = n.details?.length ? `；细节：${n.details.slice(0, 3).join('、')}` : '';
    return `- ${n.name}${n.role ? `（${n.role}）` : ''} 好感${n.affinity} 最近第${n.lastRound}回合${details}`;
  }).join('\n');
}

function formatItems(items: Item[] | undefined): string {
  if (!items?.length) return '（空）';
  return items.slice(0, 12).map((it) => `- ${it.name}${it.pendingDestroy ? '（本回合可能失去）' : ''}`).join('\n');
}

function formatScene(scene?: SceneRef): string {
  if (!scene?.name) return '（未知）';
  return [
    scene.name,
    scene.description,
    scene.time ? `时间：${scene.time}` : '',
    scene.weather ? `天气：${scene.weather}` : '',
  ].filter(Boolean).join('；');
}

function formatActiveArcsBrief(narrative?: AuthorNarrativeState): string {
  const arcs = narrative?.activeArcs ?? [];
  if (!arcs.length) return '（无 active 事件）';
  return arcs.slice(0, 6).map((a) => {
    const milestone = a.isMilestone ? '[milestone]' : '';
    return `- ${milestone}${a.title}｜${a.lifecycle ?? a.status}${a.progressPercent !== undefined ? `｜${a.progressPercent}%` : ''}｜${a.surfaceGoal ?? a.summary ?? a.directive ?? ''}`;
  }).join('\n');
}

function formatNarrative(narrative?: AuthorNarrativeState): string {
  const lines: string[] = [];
  const master = narrative?.masterArc;
  const stage = master?.stages[master.currentStageIndex];
  if (master) {
    lines.push(`主弧：${master.title}｜当前阶段：${stage?.name ?? '未知'}｜更新：第${master.updatedAtRound}回合`);
    if (stage?.description) lines.push(`阶段描述：${stage.description}`);
  }
  const plan = narrative?.plan;
  if (plan) {
    lines.push(`导演计划更新：第${plan.updatedAtRound}回合`);
    if (plan.currentStage) lines.push(`导演当前阶段：${plan.currentStage}`);
    if (plan.stageGoal) lines.push(`阶段目标：${plan.stageGoal}`);
    const first = plan.nextFewRoundsPlan?.[0];
    if (first) lines.push(`计划覆盖：${first.startRound}-${first.endRound}｜${first.goal}`);
  } else {
    lines.push('导演计划：无');
  }
  if (narrative?.outlineMapping) {
    lines.push(`大纲映射：${narrative.outlineMapping.alignment}｜第${narrative.outlineMapping.updatedAtRound}回合｜${narrative.outlineMapping.currentStageGoal ?? ''}`);
    if (narrative.outlineMapping.stageProgress !== undefined) lines.push(`stage 完成度：${narrative.outlineMapping.stageProgress}%`);
    if (narrative.outlineMapping.nextMilestone) lines.push(`下一 milestone：${narrative.outlineMapping.nextMilestone}`);
  } else if (plan?.outlineMapping) {
    lines.push(`导演内大纲映射：${plan.outlineMapping.alignment}｜${plan.outlineMapping.currentStageGoal ?? ''}`);
  }
  if (narrative?.characterPlan) {
    lines.push(`人物规划：第${narrative.characterPlan.updatedAtRound}回合｜${narrative.characterPlan.summary}`);
  }
  if (narrative?.scenePlan) {
    lines.push(`场景规划：第${narrative.scenePlan.updatedAtRound}回合｜${narrative.scenePlan.scene.location ?? ''}｜${narrative.scenePlan.sceneLogic ?? ''}`);
  }
  if (narrative?.eventPlan) {
    lines.push(`事件规划：第${narrative.eventPlan.updatedAtRound}回合｜${narrative.eventPlan.summary}`);
  }
  if (narrative?.stageJudge) {
    lines.push(`阶段判断更新：第${narrative.stageJudge.updatedAtRound}回合｜玩家节奏：${narrative.stageJudge.playerPace}`);
  }
  if (narrative?.settingGuard) {
    lines.push(`设定守护更新：第${narrative.settingGuard.updatedAtRound}回合`);
    if (narrative.settingGuard.deviation) lines.push(`设定偏移：${narrative.settingGuard.deviation.description}`);
  }
  if (narrative?.eventBeat) {
    lines.push(`司事更新：第${narrative.eventBeat.updatedAtRound}回合｜判定 ${narrative.eventBeat.verdicts?.length ?? 0} 个事件`);
    if (narrative.eventBeat.planConcern) lines.push(`司事反馈：${narrative.eventBeat.planConcern}`);
  }
  if (narrative?.logicReview) {
    lines.push(`逻辑审校更新：第${narrative.logicReview.updatedAtRound}回合；问题数：${narrative.logicReview.issues.length}`);
  }
  return lines.join('\n') || '（无叙事状态）';
}

function formatRecentCalls(narrative?: AuthorNarrativeState): string {
  return [
    `回合司辰：${narrative?.lastOrchestratorRound ?? '未运行'}`,
    `大纲映射：${narrative?.lastOutlineMapperRound ?? '未运行'}`,
    `阶段判断：${narrative?.lastStageJudgeRound ?? '未运行'}`,
    `人物规划：${narrative?.lastCharacterPlannerRound ?? '未运行'}`,
    `场景规划：${narrative?.lastScenePlannerRound ?? '未运行'}`,
    `事件规划：${narrative?.lastEventPlannerRound ?? '未运行'}`,
    `司事：${narrative?.lastEventBeatRound ?? '未运行'}`,
    `叙事导演：${narrative?.lastDirectorRound ?? '未运行'}`,
    `设定守护：${narrative?.lastSettingGuardRound ?? '未运行'}`,
    `逻辑审校：${narrative?.lastLogicCheckRound ?? '未运行'}`,
  ].join('\n');
}

export interface BuildAuthorOrchestratorUserParams {
  outline?: StoryOutline;
  currentRound: number;
  nextRound: number;
  totalRounds: number;
  playerInput?: string;
  latestStory?: string;
  recent: Message[];
  summary?: string;
  longTermMemory?: string;
  npcs?: Npc[];
  backpack?: Item[];
  currentScene?: SceneRef;
  narrative?: AuthorNarrativeState;
  config: AuthorOrchestratorConfig;
  unsummarizedCount?: number;
  maxHistoryRounds?: number;
  memoryEveryRounds?: number;
}

export function buildAuthorOrchestratorPhase1User(p: BuildAuthorOrchestratorUserParams): string {
  return [
    '【任务】',
    '本轮你处于 Phase 1：信息整理。读完整资料，做三方信号初判（大纲 / 阶段 / 事件），按需调直属工具，输出 informationRequests JSON。**不要输出 calls 决策。**',
    '',
    '【玩家给回合司辰的额外调度偏好】',
    p.config.prompt || '（无）',
    '',
    '【Phase 1 输出格式】',
    JSON.stringify({
      notes: '本轮信息整理总结，≤500字',
      outstandingQuestions: ['仍未解决的疑问，最多 5 条'],
      signalSnapshot: {
        outline: '大纲层面初判，≤120字',
        stage: '阶段层面初判，≤120字',
        activeEvents: 'active events 状态初判，≤120字',
      },
      earlyExit: false,
    }, null, 2),
    '',
    '【当前进度】',
    `已完成回合：${p.currentRound}`,
    `下一回合：${p.nextRound}`,
    `总回合：${p.totalRounds || '无尽'}`,
    `未摘要消息数：${p.unsummarizedCount ?? 0} / 阈值 ${p.maxHistoryRounds ?? '未知'}`,
    `记忆保底频率：每 ${p.memoryEveryRounds ?? 0} 回合`,
    '',
    '【故事大纲】',
    p.outline ? `${p.outline.title}\n${p.outline.synopsis}\n${p.outline.acts?.join('\n') ?? ''}` : '（无）',
    '',
    '【最近模型调用时间】',
    formatRecentCalls(p.narrative),
    '',
    '【当前 active 事件】（事件层面初判的主要素材）',
    formatActiveArcsBrief(p.narrative),
    '',
    '【叙事状态】',
    formatNarrative(p.narrative),
    '',
    '【玩家本回合输入】',
    p.playerInput || '（无，可能是自动推进）',
    '',
    '【最新故事片段】',
    p.latestStory ? (p.latestStory.length > 1200 ? `${p.latestStory.slice(0, 1200)}…` : p.latestStory) : '（无）',
    '',
    '【最近上下文】',
    formatRecent(p.recent),
    '',
    '【摘要 / 长期记忆】',
    p.summary?.trim() ? `摘要：${p.summary.trim().slice(0, 800)}` : '摘要：（无）',
    p.longTermMemory?.trim() ? `长期记忆：${p.longTermMemory.trim().slice(0, 800)}` : '长期记忆：（无）',
    '',
    '【当前状态短表】',
    `场景：${formatScene(p.currentScene)}`,
    `NPC：\n${formatNpcs(p.npcs)}`,
    `能力：\n${formatItems(p.backpack)}`,
  ].join('\n');
}

export interface BuildAuthorOrchestratorPhase2UserParams {
  currentRound: number;
  nextRound: number;
  config: AuthorOrchestratorConfig;
  narrative?: AuthorNarrativeState;
}

export function buildAuthorOrchestratorPhase2User(p: BuildAuthorOrchestratorPhase2UserParams): string {
  const activeArcCount = p.narrative?.activeArcs?.length ?? 0;
  return [
    '【任务】',
    '本轮你处于 Phase 2：调度决策。基于 Phase 1 整理结果（对话历史中），输出最终 OrchestratorState JSON。**不要重复 Phase 1 的信息整理工作**——直接做调度。',
    '',
    '【快速参考】',
    `已完成回合：${p.currentRound} / 下一回合：${p.nextRound}`,
    `当前 active 事件数：${activeArcCount}（eventBeat 触发条件）`,
    p.config.prompt ? `玩家调度偏好：${p.config.prompt}` : '',
    '',
    '【Phase 2 输出格式】',
    JSON.stringify({
      overall: '一句话说明当前最主要的调度风险，可空',
      turnType: 'continue_current_event | event_turning_point | event_completion_check | new_event_candidate | stage_transition_candidate | free_exploration',
      planningMode: 'light | focused | full',
      directorMode: 'skip | light | full',
      focusAreas: ['event', 'character', 'scene'],
      planSignals: [
        {
          area: 'character | scene | event | outline | stage | foreshadowing | setting | memory | logic | summary',
          priority: 'low | medium | high',
          reason: '为什么这个方向可能需要更细分析',
          suggestedModel: '可选：建议由哪个模型处理',
        },
      ],
      callOrder: ['outlineMapper', 'stageJudge', 'settingGuard', 'eventBeat', 'director'],
      calls: Object.fromEntries(CALL_KEYS.map((key) => [key, { run: false, reason: '简短理由', hint: '可选：本回合希望该成员关注的点，≤80字' }])),
    }, null, 2),
    '',
    '【判断要点】',
    '- character / scene / event 类分析仍由你直属的工具完成，不要写进 calls。',
    '- callOrder 只列 run=true 的成员，按依赖排序：outlineMapper → stageJudge / settingGuard → eventBeat → director → logicCheck → memory → summary。',
    `- eventBeat 仅在 active 事件存在时 run=true（当前 active 事件数：${activeArcCount}）。`,
    '- 多数回合 director.run=true；用 directorMode 控制深度（skip / light / full）。',
    '- 若 Phase 1 标了 earlyExit=true，本轮通常走 planningMode=light + directorMode=light + 最小 calls 集（往往只 director run）。',
    '- 轻量回合若旧 stageJudge / settingGuard 判断仍有效，可不重跑。',
    '- 回溯补写关键过去事件时，通常 outlineMapper / stageJudge / settingGuard / director 都需要 run，必要时 logicCheck 同时 run。',
    '- milestone 时机三方绿灯时，通过调用 eventPlanner 工具（带 question "出 milestone，候选：X"）让事件层生成主线事件；不要在 calls 里输出 eventPlanner。',
  ].filter(Boolean).join('\n');
}
