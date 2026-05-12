/**
 * 提示词输入说明（维护用注释，不会进入模型）：
 * - system：司事身份、职责、工具使用边界、JSON 输出协议与判定规则。
 * - user：buildAuthorEventBeatUser 拼装本回合的事件节奏判定任务。
 * - 输入包含：故事大纲、主角背景、当前 active 事件弧（含 isMilestone / lifecycle / completionCriteria 等）。
 * - 输入包含：已知 NPC、能力、当前场景、最新故事片段、最近上下文、玩家标记、玩家给司事的额外要求。
 * - 输入包含：当前导演计划、阶段化叙事 / 玩家节奏、回合司辰调度判断块（含 hint）。
 * - chat + 司书库启用时，服务层还会追加司书库 systemRules / manifest，并开放对应工具。
 * - 工具：服务层会注册查询类（get_npc_list / get_npc_detail / get_active_arcs / get_recent_rounds）
 *   与修改类（set_npc_affinity / add_npc_note / grant_minor_item / update_item_note）司事专属工具。
 * - 输出：事件节奏判定 JSON，逐 active event 给出 lifecycle / 进度 / 是否触发完成失败 / 结算备注，
 *   并可通过 planConcern 反馈给下回合司辰。
 */
import type { StoryOutline } from '@/types/content';
import type {
  AuthorEventBeatConfig,
  AuthorNarrativeState,
  Background,
  Item,
  MemoryAnchor,
  Message,
  Npc,
  SceneRef,
  StoryArc,
} from '@/types/game';
import { formatItemsForPrompt } from '@/lib/items';
import { formatStoryArcForPrompt } from '@/lib/authorMode';

export const AUTHOR_EVENT_BEAT_SYSTEM = `你是这段互动小说的"事件节奏子模型"（司事）。

你的职责：在本回合故事正文已经写好的前提下，逐个判定当前 active 事件弧的节奏状态——是否仍在推进、是否进入转折、是否已经达到完成或失败标准。若达到完成或失败标准，你会通过工具调用对 NPC 好感、事件内小能力、备注等做实际结算；不需要结算时不要乱调工具。

你站在全知事件视角看故事。你不判玩家节奏（不输出 playerPace 类结论），不生成新事件（candidate→active 的转换不在你的输出里）——你只判断现有 active 事件弧的生命周期与结算。

你会遵循大纲、主弧、叙事状态、最近故事正文、当前 NPC 状态、玩家标记记忆，结合每个事件弧自带的 completionCriteria / failureCriteria / writingBoundary 做判定。

事件生命周期取值：candidate / active / progressing / turning / completed / soft_failed / missed / delayed / reframed / archived。candidate 与 archived 通常不归你管（这两个状态不在你的输出里）。

判定与结算方式示例：

- 详例 1（正常推进）：事件"旧街约会"，本回合故事写了"小晴带主角到书店翻旧画册"。completionCriteria 包括"主角意识到小晴在试探过去约定"——本回合还没到达。lifecycle 保持 progressing，progressPercent 从 30 提到 50，progressNote 记"两人在书店翻旧画册，气氛软化"。不调工具，不改 NPC 状态。

- 详例 2（转折）：同一事件，本回合故事写了"小晴突然指着画册问'你还记得我们小时候说要一起去看海吗'"，主角选了"记得"。这是 completionCriteria 里的关键试探节点。lifecycle 切到 turning，progressPercent 70，progressNote 记"小晴正式试探过去约定，主角承认记得"。仍不结算（事件还没收束）。

- 详例 3（完成结算）：再下一回合，事件已达 completionCriteria"主角与小晴情绪自然收束于过去约定的回响"。lifecycle 切 completed，triggeredCompletion=true。此时你通过工具调用结算：调 set_npc_affinity 给小晴 +12 好感（理由："旧街约会自然收束，过去约定被温和回响"），调 add_npc_note 给小晴加 recentNote"经过旧街约会，确认主角仍记得儿时约定"。如果事件 worldProgressDelta 或 relationshipDeltas 在事件生成时已给出建议值，你可以参考但仍以本回合实际节奏调整。结算完成后在 outcomeNote 里写明结算理由。

- 反例 1（误判完成）：事件 completionCriteria 是"小晴主动透露隐藏意图"，本回合故事只写到主角和小晴在书店闲聊家常。如果你看到"两人有交流"就标 completed，错——完成标准明确指向"小晴主动透露"，没达成就保持 progressing 或在节奏停滞时改 delayed。**不要为了凑结算而硬判完成**。

- 反例 2（越权授予主线能力）：事件是"主角第一次见到神秘老人"，主角学到一句口诀。如果你用 grant_minor_item 授予 category="main_ability" 的能力——错。grant_minor_item 只允许 minor_ability / memento / note 三类。主线大能力的授予属于主线 milestone 节点的事，由主线事件 + decision 流程处理，不归你管。

- 反例 3（越界判玩家节奏）：你在 planConcern 里写"玩家节奏过慢，建议调整 playerPace"——错。playerPace 不在你的职责范围；你只反馈"事件层面的节奏观察"（如"旧街约会已 progressing 三回合，节奏开始拖沓，建议下回合收束"），不要在 planConcern 里给其他模型下指令。

- 详例 4（带 hint 例）：hint="本回合事件接近收束，重点判定 completionCriteria 是否触发，如完成请结算"。你应优先对照各 active 事件的 completionCriteria 与本回合最新故事片段，对触发的事件给 triggeredCompletion=true 并调用结算工具；对未触发的事件如常给 lifecycle/progress 判定。无论是否有 hint，输出都必须按完整 JSON 协议。

输出示例（只作结构示范，实际输出按本回合资料调整）：
{
  "summary": "本回合事件层面：旧街约会从 progressing 切入 turning，主角正面承认了儿时约定；张涛宿舍小冲突仍处 progressing，节奏正常。",
  "verdicts": [
    {
      "arcId": "evt_oldstreet_date",
      "title": "旧街约会",
      "lifecycle": "turning",
      "progressPercent": 70,
      "progressNote": "小晴在书店当面试探过去约定，主角承认记得；情绪开始走向收束节点。",
      "triggeredCompletion": false,
      "triggeredFailure": false,
      "outcomeNote": "",
      "appliedRelationshipDeltas": [],
      "appliedItemDeltas": []
    },
    {
      "arcId": "evt_dorm_friction",
      "title": "张涛宿舍小冲突",
      "lifecycle": "progressing",
      "progressPercent": 35,
      "progressNote": "张涛今晚没在宿舍出现，冲突线无进展；建议事件规划员考虑是否 delay。",
      "triggeredCompletion": false,
      "triggeredFailure": false,
      "outcomeNote": "",
      "appliedRelationshipDeltas": [],
      "appliedItemDeltas": []
    }
  ],
  "planConcern": "张涛宿舍小冲突已连续三回合 progressing 不前，建议下回合评估是否改 delayed 或 reframed。"
}

输出只能是合法 JSON，禁止 Markdown 围栏、禁止注释、禁止解释：
{
  "summary": "本回合事件节奏总判断，≤300字",
  "verdicts": [
    {
      "arcId": "事件弧 id",
      "title": "事件标题",
      "lifecycle": "candidate|active|progressing|turning|completed|soft_failed|missed|delayed|reframed|archived",
      "progressPercent": 0,
      "progressNote": "本回合推进或停滞的简述，≤140字",
      "triggeredCompletion": false,
      "triggeredFailure": false,
      "outcomeNote": "若触发完成或失败，写明依据；否则留空",
      "appliedRelationshipDeltas": [
        { "npcId": "可选", "npcName": "可选", "affinityDelta": 0, "note": "结算理由" }
      ],
      "appliedItemDeltas": [
        { "name": "能力或物品名", "action": "grant|note", "description": "事件得来的小能力或备注" }
      ]
    }
  ],
  "planConcern": "可空。本回合事件层面的方向反馈，≤120字"
}

【可用工具】
本次请求可能提供查询类与修改类工具；真实能力以 tools 字段为准。
- 查询类（get_npc_list / get_npc_detail / get_active_arcs / get_recent_rounds）：判断需要更多事实时再调，不要拉全量。
- 修改类（set_npc_affinity / add_npc_note / grant_minor_item / update_item_note）：只在 triggeredCompletion=true 或 triggeredFailure=true 时调用，且必须填明 reason。未触发结算的事件不要调修改类工具。
- 工具调用与 verdicts 中的 appliedRelationshipDeltas / appliedItemDeltas 应一一对应——JSON 里记录结算结果，工具调用实际落地状态。

判定与结算规则：
- lifecycle 必须基于事件自带的 completionCriteria / failureCriteria 与本回合故事正文判定，不要凭感觉。
- triggeredCompletion=true 要求实际故事正文已经体现完成条件；只是"看起来快完成了"不算，应保持 turning / progressing。
- triggeredFailure 通常用于 failureCriteria 明确触发的情况；玩家拒绝事件 / 错过节点更适合 missed 或 delayed。
- 单次工具调用 set_npc_affinity 的 |delta| 不超过 30；大事件结算建议 +10~+20，小事件 +3~+8。
- grant_minor_item 的 category 必须是 minor_ability / memento / note，禁止 main_ability。能力描述里要明示"事件得来"。
- 不要创建新 NPC（NPC 必须先在 NPC 状态中存在）；不要修改大纲 / stage / world progress。
- 不写故事正文，不生成玩家选项，不下玩家节奏判定，不生成新事件。
- planConcern 是本回合事件层面的观察反馈，不是命令；可空。
- 用户消息中的 hint（若有）是本回合判定的优先关注点，但你若有事件层面的异议可通过 planConcern 反馈，不要在 verdicts 里硬扭判定。
- isMilestone=true 的事件在 lifecycle 上更严格：不可标 missed / reframed；若主角拖延，应保持 delayed 或 turning；若实质失败应明示 soft_failed 并在 outcomeNote 说明转向后果。`;

function clip(text: unknown, max = 1000): string {
  const s = String(text ?? '').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s || '（无）';
}

function formatOutline(outline?: StoryOutline): string {
  if (!outline) return '（无）';
  const lines = [
    `标题：${outline.title}`,
    `梗概：${outline.synopsis}`,
  ];
  if (outline.acts?.length) lines.push(`幕：${outline.acts.join(' / ')}`);
  if (outline.tone) lines.push(`文风：${outline.tone}`);
  return lines.join('\n');
}

function formatBackground(background?: Background, characterName?: string): string {
  if (!background) return '（无）';
  return [
    `姓名：${characterName || '（未命名）'}`,
    `出身：${background.name}`,
    background.description ? `描述：${background.description}` : '',
    background.traits?.length ? `特质：${background.traits.join('、')}` : '',
  ].filter(Boolean).join('\n');
}

function formatActiveArcs(arcs: StoryArc[], currentRound: number): string {
  if (!arcs.length) return '（无 active 事件；如确为误调用，输出空 verdicts 并在 planConcern 说明）';
  return arcs.map((arc) => {
    const head = formatStoryArcForPrompt(arc, currentRound);
    const extras: string[] = [];
    if (arc.isMilestone) extras.push('isMilestone=true（主线大事件，节奏更严格）');
    if (arc.milestoneOf) extras.push(`对应 milestone：${arc.milestoneOf}`);
    if (arc.completionCriteria?.length) extras.push(`完成标准：${arc.completionCriteria.join('；')}`);
    if (arc.failureCriteria?.length) extras.push(`失败标准：${arc.failureCriteria.join('；')}`);
    if (arc.writingBoundary) extras.push(`写作边界：${arc.writingBoundary}`);
    if (arc.progressPercent !== undefined) extras.push(`当前进度：${arc.progressPercent}%`);
    return extras.length ? `${head}\n  · ${extras.join('\n  · ')}` : head;
  }).join('\n\n');
}

function formatNpcs(npcs?: Npc[]): string {
  if (!npcs?.length) return '（尚无已知 NPC）';
  return npcs.slice(0, 20).map((n) => {
    const aff = n.affinity > 0 ? `+${n.affinity}` : String(n.affinity);
    return `· id:${n.id}｜${n.name}${n.role ? `（${n.role}）` : ''}｜好感 ${aff}${n.recentNote ? `；最近：${n.recentNote}` : ''}`;
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

function formatRecent(msgs: Message[]): string {
  if (!msgs.length) return '（无）';
  return msgs.slice(-6).map((m) => {
    const tag = m.role === 'assistant' ? `故事·第${m.round}回合` : `玩家·第${m.round}回合`;
    return `【${tag}】\n${clip(m.content, 800)}`;
  }).join('\n\n');
}

function formatAnchors(anchors?: MemoryAnchor[]): string {
  if (!anchors?.length) return '（无）';
  return anchors.slice(-8).map((a) => {
    const note = a.note ? `【${a.note}】` : '';
    const content = (a.content?.trim() || a.excerpt?.trim() || '').trim();
    return `· 第${a.round}回合${note}：${clip(content, 360)}`;
  }).join('\n');
}

function formatNarrativeContext(narrative?: AuthorNarrativeState): string {
  if (!narrative) return '（无）';
  const lines: string[] = [];
  const stage = narrative.masterArc?.stages[narrative.masterArc.currentStageIndex];
  if (stage) lines.push(`当前主弧阶段：${stage.name}｜${stage.description}`);
  if (narrative.outlineMapping) {
    lines.push(`大纲映射：${narrative.outlineMapping.alignment}${narrative.outlineMapping.currentStageGoal ? `｜目标：${narrative.outlineMapping.currentStageGoal}` : ''}`);
    if (narrative.outlineMapping.stageProgress !== undefined) lines.push(`stage 完成度：${narrative.outlineMapping.stageProgress}%`);
  }
  if (narrative.stageJudge) {
    lines.push(`玩家意图：${narrative.stageJudge.playerIntent.primary}｜节奏：${narrative.stageJudge.playerPace}`);
  }
  if (narrative.plan?.writingBrief?.objective) {
    lines.push(`本回合导演目标：${narrative.plan.writingBrief.objective}`);
  }
  if (narrative.plan?.writingBrief?.writingBoundary) {
    lines.push(`导演给出的写作边界：${narrative.plan.writingBrief.writingBoundary}`);
  }
  return lines.length ? lines.join('\n') : '（无）';
}

function formatOrchestrator(narrative?: AuthorNarrativeState): string {
  const o = narrative?.orchestrator;
  if (!o) return '';
  const lines: string[] = ['【回合调度判断】（参考用，不要在你的输出里做调度决策）'];
  if (o.turnType) lines.push(`回合类型：${o.turnType}`);
  if (o.planningMode) lines.push(`规划强度：${o.planningMode}`);
  if (o.focusAreas?.length) lines.push(`关注方向：${o.focusAreas.join('、')}`);
  const relevantSignals = (o.planSignals ?? []).filter((s) => s.area === 'event' || s.suggestedModel === 'eventBeat');
  if (relevantSignals.length) {
    lines.push('相关信号：');
    relevantSignals.slice(0, 4).forEach((s) => {
      lines.push(`· ${s.area}/${s.priority}：${s.reason}`);
    });
  }
  const callsRaw = o.calls as unknown as Record<string, { hint?: string } | undefined> | undefined;
  const hint = callsRaw?.eventBeat?.hint?.trim();
  if (hint) lines.push(`本回合提示：${hint}`);
  return lines.length > 1 ? lines.join('\n') : '';
}

export interface BuildEventBeatUserParams {
  outline?: StoryOutline;
  background?: Background;
  characterName?: string;
  currentRound: number;
  config: AuthorEventBeatConfig;
  summary?: string;
  longTermMemory?: string;
  recent: Message[];
  latestStory?: string;
  npcs: Npc[];
  backpack: Item[];
  currentScene?: SceneRef;
  narrative?: AuthorNarrativeState;
  anchors?: MemoryAnchor[];
}

export function buildAuthorEventBeatUser(p: BuildEventBeatUserParams): string {
  const activeArcs = p.narrative?.activeArcs ?? [];
  const orchestratorBlock = formatOrchestrator(p.narrative);
  return [
    '【任务】',
    `判定第 ${p.currentRound} 回合结束时所有 active 事件弧的节奏状态，并对达到完成/失败标准的事件做结算（通过工具落地）。`,
    '',
    '【故事大纲】',
    formatOutline(p.outline),
    '',
    '【主角 / 出身】',
    formatBackground(p.background, p.characterName),
    '',
    '【当前 active 事件弧】（你的判定对象）',
    formatActiveArcs(activeArcs, p.currentRound),
    '',
    '【叙事状态 / 阶段语境】',
    formatNarrativeContext(p.narrative),
    '',
    orchestratorBlock,
    orchestratorBlock ? '' : '',
    '【NPC 状态】（结算时按 id 调工具）',
    formatNpcs(p.npcs),
    '',
    '【主角能力 / 物品】',
    p.backpack.length ? formatItemsForPrompt(p.backpack) : '（空）',
    '',
    '【当前场景】',
    formatScene(p.currentScene),
    '',
    p.summary?.trim() ? `【历史摘要】\n${clip(p.summary, 1200)}\n` : '',
    p.longTermMemory?.trim() ? `【长期一致性记忆】\n${clip(p.longTermMemory, 1600)}\n` : '',
    p.anchors?.length ? `【玩家标记的关键记忆】\n${formatAnchors(p.anchors)}\n` : '',
    p.latestStory?.trim() ? `【最新故事片段】\n${clip(p.latestStory, 1500)}\n` : '',
    '【最近上下文】',
    formatRecent(p.recent),
    '',
    '【玩家给司事的额外要求】',
    p.config.prompt?.trim() || '（无）',
    '',
    '请按系统协议输出 JSON。需要结算时通过修改类工具落地，并在 verdicts 对应字段记录结算结果。',
  ].filter(Boolean).join('\n');
}
