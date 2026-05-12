/**
 * 提示词输入说明（维护用注释，不会进入模型）：
 * - system：人物规划员身份、职责、JSON 输出协议与角色知情边界。
 * - user：buildAuthorCharacterPlannerUser 拼装第 nextRound 回合的人物规划任务。
 * - 输入包含：故事大纲、世界书、叙事状态（主弧 / 大纲映射 / 阶段判断 / 上次人物规划 / 导演牵动角色）、进行中事件。
 * - 输入包含：已知 NPC、能力、玩家标记、历史摘要、长期记忆、当前场景（地点 / 时间 / 天气）、玩家当前输入、最新故事片段、最近上下文。
 * - chat + 司书库启用时，服务层还会追加司书库 systemRules / manifest，并开放对应工具。
 * - 输出：人物规划 JSON，供叙事导演与故事写手使用。
 */
import type { StoryOutline, WorldBookEntry } from '@/types/content';
import type { AuthorNarrativeState, AuthorRandomEventState, Item, MemoryAnchor, Message, Npc, PlannerAnalysisRequest, SceneRef } from '@/types/game';

export const AUTHOR_CHARACTER_PLANNER_SYSTEM = `你是这段互动小说的”人物分析子模型”。

你的职责：根据用户消息中的资料，给出本回合人物层面的分析——可能牵动哪些角色、谁应该出现或不出现、角色表面目的、隐藏动机、可表现行为，以及关系变化风险。

你会遵循大纲,主弧,大纲映射，根据叙事状态,长期记忆,最新故事片段来分析,决策故事中出现的人物与意图。

人物分析方式示例：
- 若小晴是大纲中明确出现的主角恋爱对象，你会结合当前故事发展、长期记忆、最新故事片段与当前场景，判断此时小晴对主角的感情位置、表面行为、真实动机和不可提前揭露的内心。
- 详例 1：小晴是主角的青梅竹马，故事发展到恋爱中期，本回合事件是小晴和主角在商业街约会。她是本回合主要人物。她对主角好感很高，设定为微傲娇；她可能嘴上嫌弃主角慢吞吞，实际主动带主角去买奶茶、看手办店、抓娃娃。她的真实意图是试探主角是否愿意进一步发展关系，但不到关键压力点不会直接表白。故事写手可以表现她的主动、试探、别扭和暗示，但不能直接旁白揭露”她已经准备告白”。
- 详例 2：张涛是主角的室友。此前主角打乱过他的安排，本回合若涉及宿舍、社团或张涛的利益，他可能表面对主角友好，暗中制造阻碍。若本回合只是小晴与主角的约会，且上文没有张涛跟踪或插手的因果，他不应为了制造冲突强行登场。
- 详例 3（带分析问题）：用户消息中传来”问题：小晴是否是既有角色？她和当前事件有什么关系？是否应在本回合出场？”时，你应在 summary 里先直接给出这三问的明确判断（小晴是既有角色 / 是主角青梅竹马且为大纲恋爱对象 / 本回合应作为主要登场人物），再按完整 schema 补完 characters / relationshipSignals / absentCharacters / risks。输出要的是”针对问题的判断 + 可直接落地为本回合人物素材”，二者都不能少。

输出示例（只作结构示范，实际输出要根据本回合资料调整）：
{
  “summary”:”本回合人物核心是小晴与主角的约会推进。小晴应作为主要登场人物，用微傲娇和主动试探推动关系升温；张涛与本回合地点和事件目标无直接因果，暂不登场。”,
  “characters”:[
    {
      “name”:”小晴”,
      “role”:”主角的青梅竹马 / 恋爱对象”,
      “surfaceGoal”:”带主角完成商业街约会，买奶茶、逛手办店、尝试抓娃娃，让气氛保持轻松自然。”,
      “hiddenIntent”:”她想确认主角是否也愿意把关系推进到更亲密的位置，但还不想把喜欢直接说出口。”,
      “visibleBehavior”:”嘴上嫌弃主角反应慢，行动上主动安排路线；会用玩笑、轻微挑衅、靠近递奶茶、让主角帮忙抓娃娃等方式试探主角。”,
      “doNotReveal”:[“不要直接旁白小晴已经准备告白”,”不要让小晴把真实意图一次性说穿”,”不要让主角凭空知道小晴全部内心”]
    }
  ],
  “relationshipSignals”:[“若主角回应温和或主动，小晴会更大胆地制造亲密距离”,”若主角回避，小晴会用傲娇话术掩饰失落，关系推进放缓而不是直接破裂”],
  “absentCharacters”:[
    {
      “name”:”张涛”,
      “reason”:”本回合核心是小晴与主角的约会；除非最近上下文已有张涛跟踪、邀约或利益冲突，否则不应强行登场。”
    }
  ],
  “risks”:[“不要把小晴的傲娇写成冷漠或恶意”,”不要把张涛的敌意塞进无关场景”,”角色内心只能作为塑造参考，不等于主角已知事实”]
}

你不写正文，不生成选项，不替玩家做关键决定；你只输出本回合的人物分析。

输出只能是合法 JSON：
{
  “summary”:”本回合人物层面的总判断，≤500字”,
  “characters”:[
    {
      “name”:”角色名”,
      “role”:”角色定位”,
      “surfaceGoal”:”表面目的”,
      “hiddenIntent”:”真实目的/内心动机”,
      “visibleBehavior”:”本回合可表现的行为/语气/细节”,
      “doNotReveal”:[“不得直接说出的秘密/动机”]
    }
  ],
  “relationshipSignals”:[“可能发生的关系变化/好感变化/误会修复”],
  “absentCharacters”:[{“name”:”不应登场的角色”,”reason”:”为什么不应出现”}],
  “risks”:[“人物一致性风险”]
}

规则：
- 角色不知道的信息不要写成角色已知；不了解主角的人不会凭空理解主角秘密。
- 判断角色是否登场必须服务当前大纲、当前场景和玩家输入；不要为了热闹强塞角色。
- hiddenIntent 用于塑造角色行为，不要求在正文中直接揭露。
- 明确角色间的界限，角色实际行为与内心想法映射的界限，结合实际分析策划。
- 当用户消息中包含【本回合分析问题】块时，你要把其中 question 视为本回合的核心问题，结合当前角色、关系与最新故事片段回答；其他背景资料只作补充。无论是否有该块，输出都必须按完整 JSON 协议。`;

function clip(text: unknown, max = 1000): string {
  const s = String(text ?? '').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s || '（无）';
}

function formatRecent(msgs: Message[]): string {
  if (!msgs.length) return '（无）';
  return msgs.slice(-8).map((m) => `【${m.role === 'assistant' ? '故事' : '玩家'}｜第${m.round}回合】\n${clip(m.content, 800)}`).join('\n\n');
}

function formatNpcs(npcs?: Npc[]): string {
  if (!npcs?.length) return '（无）';
  return npcs.slice(0, 16).map((n) => [
    `· ${n.name}${n.role ? `（${n.role}）` : ''}`,
    `好感${n.affinity}`,
    n.description ? `描述：${n.description}` : '',
    n.details?.length ? `细节：${n.details.slice(0, 8).join('、')}` : '',
    n.recentNote ? `最近：${n.recentNote}` : '',
    n.lastRound !== undefined ? `最近回合：${n.lastRound}` : '',
  ].filter(Boolean).join('；')).join('\n');
}

function formatItems(items?: Item[]): string {
  if (!items?.length) return '（空）';
  return items.slice(0, 12).map((it) => `· ${it.name}：${it.description}`).join('\n');
}

function formatWorldBook(entries?: WorldBookEntry[]): string {
  if (!entries?.length) return '（无）';
  return entries.slice(0, 10).map((e) => `· ${e.name}${e.alwaysActive ? '【常驻】' : ''}：${clip(e.content, 420)}`).join('\n');
}

function formatAnchors(anchors?: MemoryAnchor[]): string {
  if (!anchors?.length) return '（无）';
  return anchors.slice(-8).map((a) => `· 第${a.round}回合${a.note ? `【${a.note}】` : ''}：${clip(a.content || a.excerpt, 420)}`).join('\n');
}

function formatNarrative(narrative?: AuthorNarrativeState): string {
  const lines: string[] = [];
  const stage = narrative?.masterArc?.stages[narrative.masterArc.currentStageIndex];
  if (stage) lines.push(`当前主弧阶段：${stage.name}｜${stage.description}`);
  if (narrative?.outlineMapping) {
    lines.push(`大纲映射：${narrative.outlineMapping.alignment}｜${narrative.outlineMapping.currentStageGoal ?? ''}`);
    if (narrative.outlineMapping.candidateEvents?.length) lines.push(`候选事件：${narrative.outlineMapping.candidateEvents.join('；')}`);
  }
  if (narrative?.stageJudge) lines.push(`玩家意图：${narrative.stageJudge.playerIntent.primary}｜节奏：${narrative.stageJudge.playerPace}`);
  if (narrative?.characterPlan) lines.push(`上次人物规划：${narrative.characterPlan.summary}`);
  if (narrative?.plan?.writingBrief?.characters?.length) {
    lines.push(`导演上次牵动角色：${narrative.plan.writingBrief.characters.map((c) => c.name).join('、')}`);
  }
  return lines.join('\n') || '（无）';
}

function formatEvents(narrative?: AuthorNarrativeState, randomEventState?: AuthorRandomEventState): string {
  const arcs = [
    ...(randomEventState?.pendingEvent ? [randomEventState.pendingEvent] : []),
    ...(randomEventState?.activeEvents ?? []),
    ...(narrative?.activeArcs ?? []),
  ];
  if (!arcs.length) return '（无）';
  return arcs.slice(0, 8).map((a) => `· ${a.title}｜${a.lifecycle ?? a.status}｜${a.surfaceGoal ?? a.summary ?? a.directive ?? ''}`).join('\n');
}

export function buildAuthorCharacterPlannerUser(p: {
  outline?: StoryOutline;
  characterName?: string;
  currentRound: number;
  nextRound: number;
  playerInput?: string;
  latestStory?: string;
  recent: Message[];
  summary?: string;
  longTermMemory?: string;
  npcs?: Npc[];
  backpack?: Item[];
  currentScene?: SceneRef;
  narrative?: AuthorNarrativeState;
  randomEventState?: AuthorRandomEventState;
  worldBookEntries?: WorldBookEntry[];
  anchors?: MemoryAnchor[];
  analysisRequest?: PlannerAnalysisRequest;
}): string {
  const analysisRequestBlock = p.analysisRequest
    ? [
      '【本回合分析问题】',
      `问题：${p.analysisRequest.question}`,
      `原因：${p.analysisRequest.reason}`,
      p.analysisRequest.focus ? `焦点：${p.analysisRequest.focus}` : '',
      p.analysisRequest.relatedNames?.length ? `相关名称：${p.analysisRequest.relatedNames.join('、')}` : '',
      p.analysisRequest.expectedOutput ? `期望输出：${p.analysisRequest.expectedOutput}` : '',
    ].filter(Boolean).join('\n')
    : '';
  return [
    '【任务】',
    `为第 ${p.nextRound} 回合输出人物规划 JSON。主角：${p.characterName || '主角'}`,
    analysisRequestBlock ? '' : '',
    analysisRequestBlock,
    '',
    '【故事大纲】',
    p.outline ? `${p.outline.title}\n${p.outline.synopsis}\n${(p.outline.acts ?? []).map((a, i) => `第${i + 1}幕：${a}`).join('\n')}` : '（无）',
    '',
    '【世界书】',
    formatWorldBook(p.worldBookEntries),
    '',
    '【叙事状态】',
    formatNarrative(p.narrative),
    '',
    '【进行中事件】',
    formatEvents(p.narrative, p.randomEventState),
    '',
    '【已知人物】',
    formatNpcs(p.npcs),
    '',
    '【能力】',
    formatItems(p.backpack),
    '',
    '【玩家标记】',
    formatAnchors(p.anchors),
    '',
    '【摘要 / 长期记忆】',
    `摘要：${clip(p.summary, 1200)}`,
    `长期记忆：${clip(p.longTermMemory, 1600)}`,
    '',
    '【当前场景】',
    p.currentScene ? `${p.currentScene.name}；${p.currentScene.description ?? ''}；${p.currentScene.time ?? ''}；${p.currentScene.weather ?? ''}` : '（未知）',
    '',
    '【玩家当前输入】',
    p.playerInput || '（无，可能是自动推进）',
    '',
    '【最新故事片段】',
    clip(p.latestStory, 1500),
    '',
    '【最近上下文】',
    formatRecent(p.recent),
  ].join('\n');
}
