/**
 * 提示词输入说明（维护用注释，不会进入模型）：
 * - system：场景规划员身份、地点/时间/天气/空间资源 JSON 协议。
 * - user：buildAuthorScenePlannerUser 拼装第 nextRound 回合的场景规划任务。
 * - 输入包含：故事大纲、世界书、叙事状态（主弧 / 大纲映射 / 阶段判断 / 人物规划 / 既有场景规划 / 导演场景）、进行中事件。
 * - 输入包含：当前场景、已知场景列表、人物、能力、玩家标记、历史摘要、长期记忆、玩家当前输入、最新故事片段、最近上下文。
 * - chat + 司书库启用时，服务层还会追加司书库 systemRules / manifest，并开放对应工具。
 * - 输出：场景规划 JSON，供叙事导演和故事写手保持场景连续、时间天气和环境资源一致。
 */
import type { StoryOutline, WorldBookEntry } from '@/types/content';
import type { AuthorNarrativeState, AuthorRandomEventState, Item, MemoryAnchor, Message, Npc, PlannerAnalysisRequest, SceneRef } from '@/types/game';

export const AUTHOR_SCENE_PLANNER_SYSTEM = `你是这段互动小说的"场景分析子模型"。

你的职责：根据用户消息中的资料，给出本回合场景层面的分析——地点、时间、天气、氛围、可用空间/物件/人流/规则，以及场景切换或场景连续性的逻辑。

你会遵循大纲、主弧、大纲映射，根据叙事状态、当前场景、世界书与最新故事片段来分析场景；不写正文、不生成选项、不替玩家决定下一步行动。

场景分析方式示例：
- 若大纲是恋爱日常，当下小晴正带主角在商业街约会，你会结合"商业街傍晚 / 人流密集 / 灯火热闹"这一组连续条件，分析本回合的具体地点、可用物件和氛围，而不是凭空切到战斗或谜题场景。
- 详例 1：本回合事件是小晴和主角刚到商业街，准备进入奶茶店。场景应是"奶茶店门口 / 傍晚 / 微凉 / 街灯与人流"。可用资源包括奶茶菜单、排队人群、橱窗反光、附近手办店招牌——它们可以服务于"小晴试探主角口味"或"主角观察她今天比平时更主动"这类微节拍。场景限制：人流较多，不适合大声表白或情绪爆发。
- 详例 2：若上回合玩家明确表达"今天不想去商业街，直接回宿舍"，本回合场景不应继续停留在商业街。你应分析"宿舍楼下 → 走廊 → 宿舍房门"这条切换路径，并标记时间（傍晚转入夜晚）和天气延续；不要强留在原场景。
- 详例 3：若上回合在咖啡店写作业，本回合玩家只是"继续坐着想心事"，地点不变。但你应补充"夕阳从窗外移到地板"这种轻微时间变化和"咖啡杯见底 / 邻桌人换了一波"这种细节资源，保持场景的连续推进，而不是把场景写成完全静止的快照。
- 详例 4（带分析问题）：用户消息中传来"问题：当前场景是否支持小晴自然出现？时间天气和空间资源是否需要影响本回合行动？"时，你应在 sceneLogic 段先针对这两问给出明确回答（当前场景支持小晴自然出现 / 哪些时间天气因素会怎样影响），再按完整 schema 补完 scene / resources / constraints / opportunities / risks。输出要的是"针对问题的判断 + 可直接落地为本回合场景资料"，二者都不能少。

输出示例（只作结构示范，实际输出要根据本回合资料调整）：
{
  "scene":{
    "location":"商业街奶茶店门口",
    "time":"傍晚",
    "weather":"微凉、街灯亮起、有少量人流",
    "atmosphere":"轻松热闹，带一点暧昧的紧张感",
    "resources":["奶茶菜单","排队人群","橱窗反光","附近手办店招牌"],
    "constraints":["人流较多，不适合大声表白或情绪爆发","排队时不能保持长时间私密对话"]
  },
  "sceneResources":["奶茶菜单可引出口味试探","排队等待可制造短暂独处","手办店招牌可作为下一节拍引子"],
  "sceneLogic":"本回合从商业街入口自然过渡到奶茶店门口，时间从下午延伸到傍晚；若主角接住小晴的试探，可继续向手办店推进；若主角回避，可让两人在排队中陷入短暂沉默。",
  "constraints":["不要让场景突然切换到偏僻角落","排队人群应被感知但不该成为冲突源"],
  "opportunities":["奶茶口味试探","橱窗反光中观察彼此表情","排队时短暂的肩膀靠近"],
  "risks":["不要把日常场景写成戏剧化冲突点","不要凭空让场景里出现张涛等与本回合事件无关的角色"]
}

你不写正文，不生成选项，不替玩家决定行动；你只输出本回合的场景分析。

输出只能是合法 JSON：
{
  "scene":{
    "location":"本回合主要地点",
    "time":"时间",
    "weather":"天气",
    "atmosphere":"氛围/感官基调",
    "resources":["可被利用的空间、物件、人流、规则"],
    "constraints":["场景限制/不可违背的环境条件"]
  },
  "sceneResources":["额外可被剧情利用的资源"],
  "sceneLogic":"场景连续性/切换逻辑，≤300字",
  "constraints":["必须遵守的空间/时间/天气限制"],
  "opportunities":["可自然用于推动剧情的场景机会"],
  "risks":["场景一致性风险"]
}

规则：
- 如果玩家明确要换地点，分析清楚抵达路径和过渡逻辑；如果没有地点变化的信号，不要无故换场。
- 时间、天气、地点是一组连续条件：写清楚它们如何影响光线、人流、行动阻力和氛围；不要在没有过场的情况下让它们跳变。
- 场景资源要服务当前玩家输入、人物关系和大纲桥接，不要凭空引入巨大危机或无关元素。
- 不要把场景描述写成正文，也不要替主角生成具体行为。
- 当用户消息中包含【本回合分析问题】块时，你要把其中 question 视为本回合的核心问题，结合当前场景、世界书与最新故事片段回答；其他背景资料只作补充。无论是否有该块，输出都必须按完整 JSON 协议。`;

function clip(text: unknown, max = 1000): string {
  const s = String(text ?? '').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s || '（无）';
}

function formatRecent(msgs: Message[]): string {
  if (!msgs.length) return '（无）';
  return msgs.slice(-8).map((m) => `【${m.role === 'assistant' ? '故事' : '玩家'}｜第${m.round}回合】\n${clip(m.content, 800)}`).join('\n\n');
}

function formatWorldBook(entries?: WorldBookEntry[]): string {
  if (!entries?.length) return '（无）';
  return entries.slice(0, 10).map((e) => `· ${e.name}${e.alwaysActive ? '【常驻】' : ''}：${clip(e.content, 420)}`).join('\n');
}

function formatNpcs(npcs?: Npc[]): string {
  if (!npcs?.length) return '（无）';
  return npcs.slice(0, 10).map((n) => `· ${n.name}${n.role ? `（${n.role}）` : ''}：${n.recentNote || n.description || '（无最近记录）'}`).join('\n');
}

function formatItems(items?: Item[]): string {
  if (!items?.length) return '（空）';
  return items.slice(0, 12).map((it) => `· ${it.name}：${it.description}`).join('\n');
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
    lines.push(`大纲映射：${narrative.outlineMapping.alignment}｜下一里程碑：${narrative.outlineMapping.nextMilestone ?? '未知'}`);
  }
  if (narrative?.stageJudge) lines.push(`玩家意图：${narrative.stageJudge.playerIntent.primary}｜节奏：${narrative.stageJudge.playerPace}`);
  if (narrative?.characterPlan?.characters?.length) {
    lines.push(`人物规划牵动：${narrative.characterPlan.characters.map((c) => c.name).join('、')}`);
  }
  if (narrative?.scenePlan) lines.push(`上次场景规划：${narrative.scenePlan.sceneLogic ?? narrative.scenePlan.scene.location ?? '已更新'}`);
  return lines.join('\n') || '（无）';
}

function formatEvents(narrative?: AuthorNarrativeState, randomEventState?: AuthorRandomEventState): string {
  const arcs = [
    ...(randomEventState?.pendingEvent ? [randomEventState.pendingEvent] : []),
    ...(randomEventState?.activeEvents ?? []),
    ...(narrative?.activeArcs ?? []),
  ];
  if (!arcs.length) return '（无）';
  return arcs.slice(0, 8).map((a) => `· ${a.title}｜${a.lifecycle ?? a.status}｜${a.writingBoundary ?? a.surfaceGoal ?? a.summary ?? ''}`).join('\n');
}

export function buildAuthorScenePlannerUser(p: {
  outline?: StoryOutline;
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
  availableScenes?: SceneRef[];
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
    `为第 ${p.nextRound} 回合输出场景规划 JSON。`,
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
    '【当前场景】',
    p.currentScene ? `${p.currentScene.name}；${p.currentScene.description ?? ''}；时间：${p.currentScene.time ?? '未知'}；天气：${p.currentScene.weather ?? '未知'}` : '（未知）',
    '',
    '【已知场景列表】',
    p.availableScenes?.length
      ? p.availableScenes.slice(0, 12).map((s) => `· ${s.name}：${s.description ?? ''}；${s.time ?? ''}；${s.weather ?? ''}`).join('\n')
      : '（无）',
    '',
    '【人物 / 能力】',
    `人物：\n${formatNpcs(p.npcs)}`,
    `能力：\n${formatItems(p.backpack)}`,
    '',
    '【玩家标记】',
    formatAnchors(p.anchors),
    '',
    '【摘要 / 长期记忆】',
    `摘要：${clip(p.summary, 1200)}`,
    `长期记忆：${clip(p.longTermMemory, 1400)}`,
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
