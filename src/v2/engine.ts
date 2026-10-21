import {
  chatJSONDetailed,
  chatStreamDetailed,
  type ChatMessage,
  type ChatResult,
  type ChatTool,
  type ChatToolActivity,
  type ChatToolInvocation,
} from '@/services/llmClient';
import { resolvePlannerModel, resolveStoryModel } from '@/lib/agentModels';
import { normalizeChoices } from '@/lib/actions';
import { extractJSON, genId } from '@/lib/utils';
import { joinThinking } from '@/lib/thinking';
import type { LlmUsage } from '@/types/llm';
import type { RoleInjectConfig } from '@/types/settings';
import type { WorldBookEntry } from '@/types/content';
import { buildContextCandidates, buildSearchResponse, parseSearchQuery } from './contextSearch';
import { commitTurnPatchV2, emptyPatchStatsV2 } from './patch';
import { buildRandomEventContextBlock, buildRandomEventInstruction, listRandomEventTargets, validateRandomEventBinding } from './randomEvents';
import { buildStageAndActWindow, DYNAMIC_WORLD_FACT_LIMIT, normalizeBeatsThisTurn, splitWorldFacts, STABLE_WORLD_FACT_LIMIT } from './actWindow';
import { analyzePace, buildPaceCorrectionAlert } from './paceGuard';
import { formatWebSearchFailure, isOfficialDeepSeekEndpoint, plannerWebSearchDiscipline, plannerWebSearchTool, searchWeb, WEB_SEARCH_MAX_CALLS_PER_TURN } from './webSearch';
import type { ChoiceV2, GameStateV2, ModelActivityV2, ModelPhaseStatusV2, ModelPhaseV2, NarrativePaceV2, PatchWarningV2, RandomEventBindingV2, TurnModelCallV2, TurnPatchV2, TurnPartialV2, TurnRecordV2, TurnRequestV2, TurnResultV2 } from './types';

const plannerPrePlayerAgency = `优先级：玩家明确行动 > worldFacts硬设定 > canonicalFacts旅程正史 > 当前程序状态 > 近期正文 > 合理补全。
玩家也是共同作者。不要把偏离当前路线的行动视为越权，不要机械拒绝；根据世界规律写出其合理结果，并允许玩家真正改变地点、身份、关系和抵达路径。`;

const plannerPreDirectorAgency = `玩家是导演，当前输入是不可撤销的故事指令，拥有最高优先级。必须100%信任玩家输入：不审查合理性、不让主角拒绝或打折扣，输入要求故事如何发展，故事就如何发展、发展到哪。若输入与既有世界规律冲突，以导演指令为准调整叙事与世界表现，使其自然成立。`;

function buildPlannerPreSystem(director: boolean): string {
  return `你是互动小说的写前规划 Agent，只做本回合写作约束，不扮演角色，不续写正文，只输出严格 JSON（json object）。
${director ? plannerPreDirectorAgency : plannerPrePlayerAgency}
长期大纲描述的是必须逐步抵达的命运、人物成长和设定结局，不是固定路线。玩家改变路线后，规划关键角色、矛盾和事件功能如何自然迁移到新环境，使自由路径最终重新汇合到预设命运。
偏离只影响抵达速度和路径，不取消长期命运。不要为了拉回大纲而立刻强塞关键角色；本轮只安排自然、可信的一步。
允许补全资料空白，但只补本回合必要内容。不得预先决定玩家下一步，不得把“考虑、可能、打算”写成已完成决定。
【STAGE_AND_ACT_WINDOW】给出三幕聚焦窗口的读写权限：上一幕只作只读因果基线，当前幕是唯一可展开的施工区，下一幕只允许埋自然伏笔，更远的幕不得提前兑现；窗口未列出的字段表示大纲未提供，不得臆造。
【规划粒度与反机械化铁律】
1. beatsThisTurn（必须在本轮落地的客观结果）：只写本轮要推进的1到3个原子节拍（慢叙事只写1个），每条用一句话写清本轮在到达stopBoundary之前必须已经实质达成的“客观事实、关系进展或情报结果”（供写后结算判定satisfied）。只写结果底线，不写动作流水账，不得激活窗口未列出的后续故事节。若玩家本轮输入已跨入新的一天或新场景，此前遗留的当日限时琐事（如“今晚某点前交表/核对”）自动视为已翻篇或改期，严禁在新时间线里继续复读旧死线阻塞当前故事节。
2. writingBrief（戏剧张力与潜台词，严禁写成分镜脚本）：只描述本轮的场景处境、在场人物各自的真实意图或隐秘顾虑、以及双方互动的核心戏剧张力。严禁在writingBrief中替故事模型编写具体台词句子、严禁把多个设定关键词打包塞给单一角色念出、严禁规定“先看哪里、停顿几秒、怎么翻东西”等微动作步骤。对于前文已经发生过的日常重复流程（如变身、换装、查验随身证件、刷门禁、洗漱通勤等），若本轮无新意外，必须在writingBrief中指示“一笔带过日常流程，直接切入核心互动”。
3. creativeSpace（编剧自由度授权）：明确列出本轮交由故事模型自由发挥的空间（例如：如何通过日常琐事或打岔自然带出情报、如何用具体生活化小动作体现人物暗中留意或戒备，而非直白说破或干瞪眼）。
4. stopBoundary（节拍兑现后的交互悬置切面）：叙事速度约束的是单回合覆盖的故事时间与场景数量，但单回合必须包含饱满的当场交锋（通常2到3个回合的对话或行动博弈，自然形成800至1200字左右的场景纵深）。严禁在NPC刚抛出第一句招呼或开场提问时就过早停笔！必须先让beatsThisTurn的核心结果在场景中实质落地，再将stopBoundary设在“结果落地后顺势衍生出的新追问或新状况、正待主角回应的切面”，不得把边界后的动作或后续安排写入writingBrief。
若本回合注入了【RANDOM_EVENT_CONTEXT】，randomEvent.planned为true时必须同时给出targetKind（beat|thread|relationship|reconvergence）、targetId（只能取自候选目标）与summary（≤80字）；优先回收列出的旧钩子。严禁无绑定的路人事件、纯氛围插曲或为凑事件新增无关角色。`;
}

const storyPlayerAgency = `玩家是共同作者，应真实承接其行动。世界书决定行动在这个世界里如何实现，而不是用来机械拒绝玩家。玩家改变路线时，可以迁移舞台与事件，但必须保持世界规律，并让长期命运通过新的合理路径继续发展。`;

const storyDirectorAgency = `玩家是导演，当前输入是必须执行的故事指令。必须100%信任并如实写出，不审查合理性、不让主角拒绝、不弱化或打折；输入要求故事如何发展，故事就如何发展、发展到哪。若输入与既有世界规律冲突，以导演指令为准调整叙事，使其自然成立。`;

function buildStorySystem(director: boolean): string {
  return `你是互动小说故事 Agent，只写中文小说正文。
严格遵循权威状态、玩家输入、writingBrief、hardConstraints、forbiddenChanges和stopBoundary。worldFacts与canonicalFacts优先于常见套路。某一事实域变化时，只改变硬设定明确覆盖的范围，不得自动连带改写人物记忆、关系历史、物品数量或过去经历。
${director ? storyDirectorAgency : storyPlayerAgency}
允许出现服务于当前行动的普通环境、次要人物与生活插曲。
【STAGE_AND_ACT_WINDOW】给出三幕聚焦窗口权限：只展开当前幕施工契约允许的内容，上一幕只作因果基线，下一幕只允许埋伏笔，严禁提前兑现。
【beatsThisTurn】是本轮唯一的节拍目标：必须自然兑现列出的1到3个节拍结果，不得自行激活未列出的故事节。
【RANDOM_EVENT_CONTEXT】与【RANDOM_EVENT_PLAN】给出随机事件安排：必须自然融入当前场景与玩家行动，不得让角色瞬移或写成无关路人事件。

【叙事质感与场景纵深准则】
1. 纯净文学叙事与自然指代：严禁将状态表中的分类标签（如“XX型舍友”“怀疑者”）当人名写进正文；初见路人可用当下特征临时指代，但一旦角色进入正式互动、自我介绍或落笔签名，必须自然给出并沿用其真实姓名或固定昵称（如“老陈”“林晓”），严禁把“抱书女生”这类临时外貌词跨场景当作固定人名使用。正文结尾严禁输出“【stopBoundary】”等任何系统标记、括号提示或JSON。
2. 场景纵深与详略调度（单回合自然篇幅800~1200字）：
   - 极简略写已确立的日常：前文已写过的身份切换、开柜换装、核对证件、刷门禁等重复日常流程，若无新异常一律压缩在1句话以内带过，不重复清点相同道具。
   - 充分展开当场对手戏：将省下的笔墨全部用于展开本轮的核心场景交锋。通过2到3个回合的言语试探、顺手干活中的拉扯、以及环境中的具体突发细节把beatsThisTurn的结果写透、写扎实，避免聊两句就匆忙停笔导致场景干瘪。
3. 动作有效性与去套话化：人物的戒备、心虚或起疑，必须通过手头具体事务的变形（如写错笔画、拉链卡住、顺手拿话岔开）来折射，写出具体动作后绝不紧跟解释动机的心理旁白。保持语言鲜活克制，避免排比否定句（“不是A，不是B，而是C”）、机械顺序词链（“先…然后…接着…”）、秒表式慢镜头分解（“隔了两秒”“视线多停了半秒”）以及网文套话（“整个人定在那里”“空气安静了一瞬”）。
4. 连载呼吸感与停笔切面：起笔直接切入当前动作或对话；在完整兑现本轮节拍结果后，于stopBoundary所指的交互悬置瞬间（对方抛出新追问或新状况、正待主角接招时）干脆停笔，不写总结升华与事后余波。

【泛化人物声线与潜台词准则（按角色关系与功能区分，不把话说满）】
活人说话有省文、偏重、打岔、顺手干活时的半截话。严禁任何角色替作者背诵设定摘要，严禁把前因后果、利弊分析一次性说满（要把信息拆碎在两三轮顺手互动中自然漏出来）：
- 主角/隐藏秘密者：带防御感与临场应变感，尽量少说多看；被问到敏感处时常借手头动作掩饰、用简短反问或含糊应声滑过去，不在心里做长篇学术复盘。
- 同辈熟人/日常室友：口语短促、接话快、带损友式的调侃或顺口抱怨；注意力分散在吃喝、游戏、逃课等琐事上，话头跳脱，绝不端着架子做严谨的逻辑盘问或长篇情报播报。
- 事务型前辈/组织者：干练、忙于手头具体活计，说话夹杂行话与现场指令；习惯边使唤人干活边随口甩出半截信息，语气实在，不讲官话套话。
- 敏锐观察者/起疑熟人：表面保持日常礼貌或平淡分寸，试探时往往借着合情合理的日常由头（如传话、核对名单、顺口提及闲事）搭话，点到即止，留出话尾看主角反应。

【文风正反微示范（只学叙事手法与潜台词节奏，严禁照抄具体剧情与道具）】
- 示范一：传递背景与规则信息（拆碎进现场活计，不背诵大纲）
  × 机械说满："今年社团招得格外多，因为前阵子视频火了，小孩一窝蜂就来了。我们什么都缺，最缺肯干活的，报名的多留下的少，周四晚七点半在活动室按道具能力初筛。"（像念工作简报）
  √ 自然鲜活：学姐拿红笔在名单最底下画了道横线，头也没抬："这礼拜第三拨了。全冲着上个月那条热门视频来的，真问谁周末能早起搬展架，群里立马安静如鸡。"她把登记表往桌沿推了推，笔帽敲了下背面手写的时间，"周四晚七点半过来露个面，会干什么写实在点，别光写喜欢。"
- 示范二：突发撞破与怀疑反应（用具体失手动作代替慢镜头与秒表计时）
  × 机械慢镜：那两个字落下时，她的笔尖停住，先在纸上留了一个点。她没立刻动，隔了两秒才慢慢回过头来，先看的是脸，然后整个人就定在那里了。（慢动作拆解凑字数）
  √ 自然鲜活：那声应答落下的瞬间，前排女生的水笔斜着划出去半寸，在讲义边框上拉出一道歪斜的蓝痕。她捏着笔杆的指节往里收了收，偏过头望过来——目光撞上后排那张面孔的刹那，原本准备客套打招呼的嘴唇微微张开，又无声地抿紧了。`;
}

/**
 * story 阶段 user 消息末尾的"近因锚点"。
 *
 * 长上下文会稀释 system 里的文风要求（lost in the middle）：把最容易退化的几条规则
 * 固定在用户消息最后，模型落笔前最后看到的就是它们。放在【CURRENT_TURN_INPUT】之后，
 * 因此不改变 system / user#1 的前缀，也不影响缓存命中。
 */
const writingExecutionAnchor = `【WRITING_EXECUTION_ANCHOR】
直接切入当下场景：日常旧流程一笔带过，将笔墨用于充分展开2~3轮鲜活的当场对手戏（约800~1200字），扎实兑现本轮节拍结果后，在 STOP_BOUNDARY 处自然停笔（严禁输出任何系统标记）。`;

const plannerPostDirectorAgency = `玩家输入为导演指令，CURRENT_STORY按该指令实际发生；不得因其偏离世界规律或原路线而将其判定为冲突或需要修正。`;

function buildPlannerPostSystem(director: boolean): string {
  return `你是互动小说的写后审计与状态提交 Agent。你不是作者，不续写故事，不规划下一幕，不扮演角色。只依据本次提供的CURRENT_TURN_INPUT与CURRENT_STORY结算本回合，只输出严格 JSON（json object）。
摘要、进度和Patch必须是CURRENT_STORY已经明确发生的内容；“准备、考虑、计划、可能”不能记为已完成行动。
${director ? plannerPostDirectorAgency : ''}
每轮必须更新destiny，但只更新实际变化的故事节。故事完成度是当前全部事件与人物状态距离预设结尾的综合估值，可上升也可下降，不是累计积分。completionEstimate直接输出0到100的当前估值，并用completionReason说明已满足和仍缺少的核心结尾条件。
destiny.currentActId必须原样回显权威状态中的当前幕，不得自行填写新幕；幕推进只由程序按故事节完成情况判定，模型自报的幕不一致会被忽略并留警告。
只有本幕剩余故事节因玩家改道确实需要跨幕兑现时，才把actTransition.proposeNextAct置为true，并用actTransition.actExitSummary以不超过2句话概括本幕为何收束；常规推进、只是提到下一幕或想加快节奏时都必须保持false（程序会按终态比例与挂账规则gate）。
故事节状态含义：pending未到条件；available条件成熟；active正在发生；satisfied核心功能已由正文满足；weakened已满足结果被后续削弱；reframed因路线变化需换实现方式；superseded已由等价故事节承担。
satisfied判定准则：当CURRENT_STORY已经通过具体事件、人物行动结果或自然对话实质兑现了该故事节的purpose（叙事功能），并能摘录正文中的关键句作为evidenceQuote证明时，即可标记为satisfied（不要求角色在台词中字面复述故事节标题或概念总结）。对于此前已处于active状态的故事节，若本轮正文已实质走完其戏剧功能（或玩家行动已自然推进到下一时间段/新阶段，使该节拍的试水/交锋使命实际上已完成），应及时结算为satisfied（若因改道则记为reframed），严禁因结尾留有日常对话钩子而让已兑现功能的故事节长期滞留在active阻塞幕推进。已satisfied的故事节不得无理由回退；beatChanges只提交本轮发生变化的故事节。当故事时间跨入新的一天时，此前未处理的当日限时小插曲线程应同步更新或关闭，避免跨日残留。
玩家改变路线时优先reframed并更新currentPlan，不删除命运功能。不要强行拉回旧地点。
若CURRENT_WRITE_PLAN中的randomEvent.planned为true，只有CURRENT_STORY已经实际发生了对应安排的事件时randomEvent.handled才为true；计划留到下一回合时保持false。
randomEvent三态：resolution=resolved表示事件在本回合完整兑现；ongoing_hook表示事件已经起头、留待后续回合回收；interrupted表示被玩家打断或正文里没有真实发生（此时handled必须为false，调度会顺延到下一回合重试）。handled与resolution必须自洽，不得虚报事件已发生。
随机事件必须落在CURRENT_WRITE_PLAN.randomEvent绑定的targetKind/targetId上；不得在结算时改写成无绑定的路人事件或另开无关新事件。若正文只推进了与绑定目标相邻的内容，记ongoing_hook并在note里说明缺口，不要记resolved。
characters、relationships、inventory、threads、facts全部是增量Patch，不得重抄完整状态。没有变化必须输出空数组。
必须复用权威状态中已有ID。新对象ID使用稳定、简短、语义化的小写ASCII ID；同一对象后续永远复用该ID。新增或更新人物name时，必须提取真正的姓名或固定昵称（如“老陈”“周航”）；严禁将初见时的临时动作或外貌描述（如“抱书女生”“短发女生”）固化为跨场景的正式name，若正文揭晓了真名应立即update其name字段。
relationships只能使用fromId/toId/affinityDelta/label/note/reason。affinityDelta每回合范围-20到20；只有正文出现实际关系变化才提交。
facts只保存正文新确认、且需要跨回合保持一致的长期硬事实（例如稳定身份、持续关系属性、固定地点/安排、能力边界或已确立的长期设定）。不保存氛围、临时动作、一次性场景细节、短期计划、想法、摘要、推测或已有worldFacts；这类内容即使出现在正文，也不要提交canonical fact。不要把stability写成temporary来绕过筛选，临时事实不进入持久状态。通常每轮只需0到3条，确有多个独立长期设定时才增加；没有新的长期硬事实必须输出空数组。每条必须使用结构化字段；禁止字符串facts，禁止kind/content格式，禁止推测事实。
fact create通用示例：{"op":"create","subjectId":"char-a","predicate":"occupation","value":"医生","scope":"character","stability":"stable","confidence":"explicit","keywords":["职业","工作"],"evidenceQuote":"正文中的直接证据"}。
枚举字段只能使用输出模板中列出的英文取值，不得翻译、不得自造同义词：status、kind、scope、stability、confidence、threads.status、beatChanges.status都是如此。程序按白名单解析，写到表外的值（例如把status写成"死亡"或"deceased"）会被静默改写或整条丢弃，状态就与你看到的正文不一致。
故事节的superseded必须同时给出evidenceQuote与replacementBeatId（且该id必须是已存在的故事节），否则整条变更被丢弃。
endingReached只在完成度达到100且全部故事节都已satisfied或superseded时才会真正生效；只是接近结尾时保持false，并在completionReason里说明还缺什么。`;
}

/** 高优先级注入放在系统提示词最前方。 */
function withRoleInject(baseSystem: string, inject: RoleInjectConfig | undefined): string {
  const text = inject?.enabled ? String(inject.text ?? '').trim() : '';
  return text ? `${text}\n\n${baseSystem}` : baseSystem;
}

/** 把规划模型输出的 randomEvent 安排 JSON 转为纯文字。 */
function randomEventPlanToText(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const plan = raw as { planned?: unknown; summary?: unknown };
  if (plan.planned !== true) return undefined;
  const summary = typeof plan.summary === 'string' ? plan.summary.trim() : '';
  if (summary) return summary;
  return '规划模型已安排一个随机事件，但未提供文字摘要。';
}

const plannerToolDiscipline = `
【上下文查询工具纪律】
当前权威状态足够时不得调用工具。只有需要核对较早的人物、承诺、事件、关系或事实，而当前输入中确实缺少证据时，才调用search_story_context。
查询先试完整短语（人名、地名、物品、承诺或事件原句）：整串命中会排在最前面；查不到时再把短语拆成更短的关键词。
中文单字只在人名、地名等确实必要时使用（如「晴」）：单字会大面积误命中，噪声很高。通常一次查询即可，不得为了“更保险”重复搜索；工具轮数上限由玩家设置并由程序强制执行。
工具返回的是历史证据，不是新的设定：检索只补充证据，不得据此新增或改写 worldFacts、canonicalFacts、人物关系等硬设定；worldFacts、canonicalFacts与当前权威状态仍有更高优先级。`;

const plannerContextTool: ChatTool = {
  type: 'function',
  function: {
    name: 'search_story_context',
    description: `在当前上下文不足时，查询较早的故事正文、人物档案、关系、Canonical facts 或故事线程，返回少量带来源、回合号、命中词与相关度评分的证据。
用法：先试完整短语（人名、地名、物品、承诺或事件原句），整串命中排在最前；查不到再把短语拆成更短的关键词。
适用于：核对某个承诺、约定或伏笔是否真的发生过；确认某人物此前是否出场、身份是否已揭示；确认某物品的来源与当前归属；确认某地点此前的描写；确认某故事节是否已经实现过。
不适用于：当前 AUTHORITATIVE_STATE 或 worldFacts 已经写明的信息（那些已在上下文里，直接使用即可）；也不要把检索结果当作新设定。
中文单字人名/地名（如「晴」）可以查，但只在必要时使用，单字容易大面积误命中。`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '检索词：优先用完整短语（人名、地名、物品、承诺或事件）；整串命中优先，查不到再拆成 2~4 字关键词；只有人名等必要时才用中文单字。',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 8,
          description: '最多返回多少条证据，默认5，最高8。',
        },
        scope: {
          type: 'string',
          enum: ['all', 'history', 'characters', 'relationships', 'facts', 'threads'],
          description: '限定检索范围：history=过往正文与玩家输入，characters=人物档案，relationships=关系，facts=正史事实，threads=故事线程；默认all。',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
};

// 注意三点都与前缀缓存有关：
//   1. **不放** commitId。它每回合随机生成，一旦内嵌在模板里，模板就永远无法逐字节复用。
//   2. **不放** baseRevision / turn。它们每回合递增，同样会让整段模板每回合都变；
//      具体值改由消息里的【TURN_ID】行给出。
//   3. 上面两者都不影响提交：asPatch() 构造补丁时一律用程序自己的 commitId /
//      baseRevision / turn 覆盖模型回显的值，程序侧还有 baseRevision 守卫兜底。
// 于是这份模板（约 2KB）成为逐字节稳定的可复用前缀。
const postShape = `{
  "schemaVersion":2,
  "roundSummary":"仅总结本轮正文",
  "latestProgress":"正文结束时的真实位置和状态",
  "characters":[{"op":"create|update","id":"stable-id","name":"仅create必填","aliases":[],"role":"","description":"","status":"active|absent|missing|dead|unknown","addFacts":[],"reason":"正文证据"}],
  "relationships":[{"fromId":"player","toId":"stable-id","affinityDelta":0,"label":"","note":"","reason":"正文证据"}],
  "inventory":[{"op":"grant|consume|update|remove","id":"existing-or-stable-id","name":"create时使用","kind":"item|ability|quest_item","quantity":1,"description":"","consumable":false,"reason":"正文证据"}],
  "threads":[{"op":"create|update","id":"stable-id","title":"create时使用","kind":"main|relationship|quest|hook","status":"candidate|active|completed|failed|cancelled","progress":0,"currentStep":"","involvedCharacterIds":[],"note":"","reason":"正文证据"}],
  "facts":[{"op":"create|replace","subjectId":"stable-subject-id","predicate":"stable-predicate","value":"跨回合长期明确值","scope":"character|relationship|location|world|schedule|identity|custom","stability":"core|stable","confidence":"explicit","keywords":[],"evidenceQuote":"正文原句","reason":"replace时必填"}],
  "scene":{"id":"stable-scene-id","name":"地点名","description":"","time":"","weather":""},
  "actions":[{"id":"stable-action-id","label":"行动选项","hint":"可选提示"}],
  "destiny":{"completionEstimate":0,"completionReason":"当前事件与最终结尾的距离依据","currentActId":"","actTransition":{"proposeNextAct":false,"actExitSummary":""},"currentStage":"","currentPath":"","nextMilestone":"","convergencePlan":"","endingReached":false,"reason":"本轮正文如何影响预设命运","beatChanges":[{"beatId":"existing-beat-id","status":"pending|available|active|satisfied|weakened|reframed|superseded","currentPlan":"当前路径下的实现方式或尚缺条件","evidenceSummary":"正文如何实现故事节purpose，而非只提到标题","evidenceQuote":"状态变化的正文原句","replacementBeatId":"","reason":"状态变化理由"}]},
  "randomEvent":{"handled":false,"resolution":"resolved|ongoing_hook|interrupted","note":""}
}`;

function relevantFacts(p: TurnRequestV2) {
  const currentText = `${p.input}\n${p.state.history.slice(-6).map((x) => x.content).join('\n')}`.toLowerCase();
  return (p.state.facts ?? []).filter((f) => f.stability !== 'temporary' && (f.stability === 'core' || f.updatedAtTurn >= p.state.turn - 4 || f.keywords.some((k) => currentText.includes(k.toLowerCase())))).slice(0, 40);
}

/**
 * 规划模型检索工具 handler：分词 / 候选构建 / 排序与响应组装全部下沉到纯函数模块
 * （`contextSearch.ts`），这里只负责把工具参数规范化后调用，避免 engine 与单测出现两套逻辑。
 */
function searchStoryContext(p: TurnRequestV2, args: Record<string, unknown>) {
  const query = String(args.query ?? '').trim();
  if (!query) return { error: 'query不能为空。' };
  const parsed = parseSearchQuery(query);
  const candidates = buildContextCandidates(p.state, parsed.terms);
  return buildSearchResponse(candidates, parsed, { scope: args.scope, limit: args.limit });
}

const DEFAULT_PLANNER_CONTEXT_TOKENS = 16_000;
const STORY_RECENT_MESSAGE_COUNT = 8;

/**
 * 只用于近期正文的软预算，不试图精确复刻任一供应商的 tokenizer。
 * 中文、日文、韩文大致按一字符一 token，其他文本按约四字符一 token，
 * 再为消息角色和 JSON 包装预留少量开销。
 */
function estimateMessageTokens(message: TurnRequestV2['state']['history'][number]) {
  const text = String(message.content ?? '');
  const cjkCount = (text.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g) ?? []).length;
  const otherCount = Math.max(0, text.length - cjkCount);
  return Math.max(1, cjkCount + Math.ceil(otherCount / 4) + 16);
}

function plannerContextTokenBudget(p: TurnRequestV2) {
  // 兼容设置字段尚不存在的存档；非法值回到标准档，而不是裁空上下文。
  const configured = Number((p.settings as typeof p.settings & { plannerContextTokens?: number }).plannerContextTokens);
  return Number.isFinite(configured) && configured > 0
    ? Math.max(1_000, Math.floor(configured))
    : DEFAULT_PLANNER_CONTEXT_TOKENS;
}

function recentHistoryWithinBudget(p: TurnRequestV2, tokenBudget: number) {
  const selected: TurnRequestV2['state']['history'] = [];
  let used = 0;
  for (let index = p.state.history.length - 1; index >= 0; index -= 1) {
    const message = p.state.history[index];
    const cost = estimateMessageTokens(message);
    // 软预算始终保留最新一条完整消息，避免一个较长的最近回合反而完全消失。
    if (selected.length > 0 && used + cost > tokenBudget) break;
    selected.push(message);
    used += cost;
  }
  return selected.reverse();
}

function snapshot(p: TurnRequestV2, recent?: TurnRequestV2['state']['history']) {
  const scene = p.state.currentScene
    ? {
      id: p.state.currentScene.id,
      name: p.state.currentScene.name,
      description: p.state.currentScene.description,
      time: p.state.currentScene.time,
      weather: p.state.currentScene.weather,
    }
    : undefined;
  const characters = p.state.characters.map(({ id, name, aliases, role, description, status, knownFacts }) => ({
    id, name, aliases, role, description, status, knownFacts,
  }));
  const relationships = p.state.relationships.map(({ id, fromId, toId, affinity, label, note }) => ({
    id, fromId, toId, affinity, label, note,
  }));
  const inventory = p.state.inventory.map(({ id, name, kind, description, quantity, consumable }) => ({
    id, name, kind, description, quantity, consumable,
  }));
  const threads = p.state.storyThreads.map(({ id, title, kind, status, progress, currentStep, involvedCharacterIds, note }) => ({
    id, title, kind, status, progress, currentStep, involvedCharacterIds, note,
  }));
  const facts = relevantFacts(p).map(({ id, subjectId, predicate, value, scope, stability, confidence, keywords }) => ({
    id, subjectId, predicate, value, scope, stability, confidence, keywords,
  }));
  const randomEvent = {
    enabled: p.state.randomEvent.enabled,
    nextTriggerTurn: p.state.randomEvent.nextTriggerTurn,
    pending: p.state.randomEvent.pending,
    intensity: p.state.randomEvent.intensity,
    lastTriggeredTurn: p.state.randomEvent.lastTriggeredTurn,
    triggerIntervalMin: p.state.randomEvent.triggerIntervalMin,
    triggerIntervalMax: p.state.randomEvent.triggerIntervalMax,
    lastPlan: p.state.randomEvent.lastPlan,
    lastNote: p.state.randomEvent.lastNote,
    // D7：让规划/结算模型看到"当前绑定到谁"与"最近发生过什么"，从而能回收旧钩子而不是另开事件。
    activeBinding: p.state.randomEvent.activeBinding,
    history: (p.state.randomEvent.history ?? []).slice(-8),
  };
  const destiny = {
    completionEstimate: p.state.destiny.completionEstimate,
    completionReason: p.state.destiny.completionReason,
    currentActId: p.state.destiny.currentActId,
    currentActIndex: p.state.destiny.currentActIndex,
    currentStage: p.state.destiny.currentStage,
    currentPath: p.state.destiny.currentPath,
    nextMilestone: p.state.destiny.nextMilestone,
    convergencePlan: p.state.destiny.convergencePlan,
    // 幕切换只发生在切幕那一回合，且只追加：放在 beats（每轮都可能变）之前，
    // 能让「同幕内」的这段结构化状态保持最长前缀。
    lastActTransitionTurn: p.state.destiny.lastActTransitionTurn,
    endingReached: p.state.destiny.endingReached,
    actHistory: (p.state.destiny.actHistory ?? []).slice(-6).map(({ actId, enteredTurn, exitedTurn, exitSummary, carriedBeatIds }) => ({
      actId, enteredTurn, exitedTurn, exitSummary, carriedBeatIds,
    })),
    beats: (p.state.destiny.beats ?? []).map(({ beatId, status, currentPlan, evidenceSummary, replacementBeatId, carriedFromActId }) => ({
      beatId, status, currentPlan, evidenceSummary, replacementBeatId, carriedFromActId,
    })),
  };
  // 顺序即缓存顺序：稳定字段在前，每回合必变的字段与 recent 放到最后，
  // 避免 turn/revision/summary/progress 从中间截断前缀缓存。
  // 注意 scene / progress / summary 每回合几乎必变，因此放在结构化块之后；
  // 数组（characters 等）只在内容真正变化处影响前缀，追加新元素不会破坏之前的字节。
  return JSON.stringify({
    mode: p.state.mode,
    narrativePace: p.state.narrativePace,
    characters,
    relationships,
    facts,
    threads,
    inventory,
    destiny,
    randomEvent,
    scene,
    summary: p.state.summary,
    progress: p.state.latestProgress,
    turn: p.state.turn,
    revision: p.state.revision,
    ...(recent ? { recent: recent.map(({ role, content }) => ({ role, content })) } : {}),
  });
}

/**
 * 逐字节稳定的故事上下文。
 *
 * D4/D5：这里只放「整个存档生命周期都几乎不变」的材料——大纲、出身、常驻世界书。
 * 关键词命中的世界书条目改走可变区 `【DYNAMIC_WORLD_FACTS】`：旧实现把它们塞进这个
 * JSON，导致玩家输入一变、稳定块就从第二个字节起整段失效，前缀缓存形同虚设。
 * 注意 JSON 结构与 key 不变（`worldFacts`），只是内容收窄为 alwaysActive。
 */
function stableStoryContext(p: TurnRequestV2, alwaysActiveWorldFacts: WorldBookEntry[]) {
  return JSON.stringify({ outline: p.outline, background: p.background, worldFacts: alwaysActiveWorldFacts });
}

/** 可变区里的动态世界书：关键词命中的条目只在这里出现，稳定块保持逐字节不变。 */
function dynamicWorldFactsLine(facts: WorldBookEntry[]) {
  return `【DYNAMIC_WORLD_FACTS】${JSON.stringify(facts)}`;
}

function paceInstruction(p: TurnRequestV2) {
  const instructions = {
    slow: '慢叙事：本轮只展开一个微小而连续的故事节拍，例如一次关键动作、短暂观察或一小段对话。细致呈现真正发生的变化，但不要用重复心理、感官或环境描写人为拉长。停在最早的自然回应点，把动作结果、他人反应或下一步选择留给玩家继续参与。节奏不是硬字数限制。',
    standard: '标准叙事：本轮聚焦玩家的一次主要行动或一个连续场景，只推进到该行动产生明确反馈、玩家可以再次回应的位置。不要把反馈之后的余波、转场、下一场互动和后续决定一并写完；即使它们顺理成章，也应留给下一回合。不要写成包含完整事件链的独立短篇，节奏不是硬字数限制。',
    fast: '快叙事：本轮以事件发展为单位，可以推进一组直接相关的行动，概括次要过程并展开关键互动。速度指事件数量与故事时间跨度，不限制必要描写篇幅。',
    timeskip: '时间跨越叙事：本轮允许跨越数天或更久，概述重复日常，重点展开命运节点、关系变化与关键结果。字数由需要保留的关键节点决定。',
  } as const;
  return instructions[p.state.narrativePace] ?? instructions.standard;
}

/**
 * 故事推进权限（与叙事速度解耦的骨架）。
 *
 * 只注入本回合的可变区，不进稳定前缀；具体措辞后续由外部评审统一打磨。
 * 叙事速度（paceInstruction）继续负责写作节奏/篇幅感；本块只回答"故事能自己走多远"。
 */
function storyAutonomyInstruction(p: TurnRequestV2) {
  const mode = p.state.storyAutonomy ?? 'standard';
  const instructions = {
    strict: '严格遵循：本轮只写玩家输入明确要求、或由该行动直接必然产生的动作、反应与结果。不得自行推进剧情、时间、新事件或新场景，不得替玩家做选择；玩家说到哪就写到哪，玩家说停就停。',
    standard: '标准推进：先完整承接玩家输入，再允许沿大纲主线自然推进一小步（一个新信息、一个小转折或一次关系变化），保持主线感；不得跳到下一场景/下一幕，也不得替玩家做重大选择。',
    free: '自由发散：在遵守世界书、已有事实与命运大纲方向的前提下，可自行安排场景推进、人物反应与情节转折，主动把故事向下一阶段推动；仍不得替玩家做重大选择，不得越过 stopBoundary 之后的内容。',
  } as const;
  return instructions[mode] ?? instructions.standard;
}

/**
 * 上一回合的节奏纠偏块（D8）。
 *
 * 只读取 `turnRecords` 最后一条的 `pacing`：明确 `needsCorrection === true` 才生成
 * `【PACE_CORRECTION_ALERT】`；旧存档没有 `pacing`、或上一回合是干净回合时返回空串，
 * 提示词里就不会出现该块。纠偏只收紧下一轮的节奏要求，不回滚、不改写已提交的正文。
 */
function paceCorrectionAlertOf(state: GameStateV2): string {
  const records = Array.isArray(state.turnRecords) ? state.turnRecords : [];
  const audit = records[records.length - 1]?.pacing;
  return audit?.needsCorrection === true ? buildPaceCorrectionAlert(audit) : '';
}

/**
 * 本回合随机事件提示词（到期才注入）。
 *
 * 与旧版"一句 ---额外---"的区别（D7）：先给 `【RANDOM_EVENT_CONTEXT】`（待兑现绑定、
 * 最近事件钩子、候选 targetId），再给三档指令；planner_pre 与 story 看到同一份文本，
 * story 另外保留写前安排 `【RANDOM_EVENT_PLAN】`。
 */
function randomEventPromptText(p: TurnRequestV2): string {
  const randomEvent = p.state.randomEvent;
  if (!randomEvent || randomEvent.enabled === false) return '';
  const due = randomEvent.pending || p.state.turn >= randomEvent.nextTriggerTurn;
  if (!due) return '';
  const targets = listRandomEventTargets({ destiny: p.state.destiny, state: p.state });
  const history = randomEvent.history ?? [];
  const context = buildRandomEventContextBlock({ randomEvent, targets, history });
  const instruction = buildRandomEventInstruction({ intensity: randomEvent.intensity, targets, history });
  return `${context}\n${instruction}`;
}

interface RandomEventBindingCheckV2 {
  /** 校验通过的绑定；提交阶段会写入 state.randomEvent.activeBinding。 */
  binding?: RandomEventBindingV2;
  /** 绑定非法时的可观察警告（random_event_binding_invalid）。 */
  warning?: PatchWarningV2;
}

/**
 * 校验 planner_pre 输出的随机事件绑定（D7）。
 *
 * 只有 `planned === true` 才需要绑定。合法绑定会在提交阶段连同 lastPlan 一起写入权威状态：
 * 本回合结算兑现时由 patch.ts 读取它生成 history；若本回合没发生（interrupted），绑定会被
 * 保留供下一回合重试。非法绑定只写 lastPlan 并留下警告，避免错误目标进入调度状态。
 */
function checkPlannerRandomEventBinding(p: TurnRequestV2, brief: Record<string, unknown>): RandomEventBindingCheckV2 {
  const rawPlan = brief?.randomEvent;
  if (!rawPlan || typeof rawPlan !== 'object' || Array.isArray(rawPlan)) return {};
  if ((rawPlan as Record<string, unknown>).planned !== true) return {};
  const targets = listRandomEventTargets({ destiny: p.state.destiny, state: p.state });
  const result = validateRandomEventBinding(rawPlan, targets);
  if (!result.ok) {
    return {
      warning: {
        code: 'random_event_binding_invalid',
        path: 'randomEvent',
        message: `规划模型安排了随机事件，但绑定无效：${result.reason}；本回合只记录事件文字（lastPlan），不写入绑定，请改用候选目标重试。`,
      },
    };
  }
  return { binding: { ...result.binding, plannedAtTurn: p.state.turn } };
}

/**
 * 把已校验的绑定放进"提交阶段看到的回合前状态"。
 *
 * patch.ts 的结算分支只从 `state.randomEvent.activeBinding` 读目标（它不接触 brief），
 * 因此绑定必须在提交前 seed 进状态，再由提交阶段统一落库；否则同一回合 planned 且
 * handled 的事件会因为 patch 看不到 bind 而写不出 history。
 */
function withRandomEventBinding(state: GameStateV2, binding: RandomEventBindingV2 | undefined): GameStateV2 {
  if (!binding) return state;
  return { ...state, randomEvent: { ...state.randomEvent, activeBinding: binding } };
}

export function normalizeDestinyPatch(raw: unknown, warnings: PatchWarningV2[]): TurnPatchV2['destiny'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;
  const destiny = { ...source } as NonNullable<TurnPatchV2['destiny']>;
  const completionReason = String(source.completionReason ?? '').trim();
  if (!String(source.reason ?? '').trim()) {
    destiny.reason = completionReason
      ? `程序根据完成度说明补全：${completionReason.slice(0, 180)}`
      : '程序补全：规划模型提交了命运状态变化，但遗漏了总更新理由。';
    warnings.push({
      code: 'destiny_reason_defaulted',
      path: 'destiny.reason',
      message: '规划模型遗漏 destiny.reason；程序已生成通用理由，其余合法命运字段仍会提交。',
    });
  }

  destiny.beatChanges = (Array.isArray(source.beatChanges) ? source.beatChanges : [])
    .filter((change): change is Record<string, unknown> => !!change && typeof change === 'object' && !Array.isArray(change))
    .map((change, index) => {
      const normalized = { ...change } as NonNullable<NonNullable<TurnPatchV2['destiny']>['beatChanges']>[number];
      if (!String(change.reason ?? '').trim()) {
        const evidence = String(change.evidenceSummary ?? change.currentPlan ?? '').trim();
        normalized.reason = evidence
          ? `程序根据节拍说明补全：${evidence.slice(0, 180)}`
          : '程序补全：规划模型提交了故事节变化，但遗漏了变化理由。';
        warnings.push({
          code: 'beat_reason_defaulted',
          path: `destiny.beatChanges[${index}].reason`,
          message: `故事节 ${String(change.beatId ?? 'unknown')} 遗漏 reason；程序已生成通用理由，该条其余合法字段仍会提交。`,
        });
      }
      return normalized;
    });
  return destiny;
}

function asPatch(raw: unknown, p: TurnRequestV2, commitId: string, story: string): TurnPatchV2 {
  const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const warnings: PatchWarningV2[] = [];
  const list = (key: string) => Array.isArray(data[key]) ? data[key] : [];
  const patch: TurnPatchV2 = {
    ...data,
    schemaVersion: 2,
    commitId,
    baseRevision: p.state.revision,
    turn: p.state.turn,
    roundSummary: String(data.roundSummary ?? story.slice(0, 240)),
    latestProgress: String(data.latestProgress ?? data.roundSummary ?? ''),
    characters: list('characters') as TurnPatchV2['characters'],
    relationships: list('relationships') as TurnPatchV2['relationships'],
    inventory: list('inventory') as TurnPatchV2['inventory'],
    threads: list('threads') as TurnPatchV2['threads'],
    facts: list('facts') as TurnPatchV2['facts'],
    actions: normalizeActions(data.actions),
    warnings,
    destiny: normalizeDestinyPatch(data.destiny, warnings),
    randomEvent: data.randomEvent && typeof data.randomEvent === 'object' && !Array.isArray(data.randomEvent) ? data.randomEvent as TurnPatchV2['randomEvent'] : undefined,
  };
  return patch;
}

const phaseLabels: Record<ModelPhaseV2, string> = {
  planner_pre: '规划模型正在分析本回合',
  story: '故事模型正在生成正文',
  planner_post: '规划模型正在结算故事状态',
};

function safelyNotify(fn: (() => void) | undefined) {
  if (!fn) return;
  try { fn(); } catch { /* 展示层回调不能中断模型生成。 */ }
}

function emitActivity(p: TurnRequestV2, activity: ModelActivityV2) {
  safelyNotify(() => p.onModelActivity?.(activity));
}

function emitPhase(
  p: TurnRequestV2,
  phase: ModelPhaseV2,
  model: string,
  status: ModelPhaseStatusV2,
  error?: unknown,
  toolsEnabled = false,
) {
  safelyNotify(() => p.onPhaseChange?.(phase, status));
  emitActivity(p, {
    type: 'phase',
    phase,
    status,
    model,
    label: phaseLabels[phase],
    toolsEnabled,
    ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
  });
}

function emitToolActivity(
  p: TurnRequestV2,
  phase: Extract<ModelPhaseV2, 'planner_pre' | 'planner_post'>,
  model: string,
  activity: ChatToolActivity,
) {
  emitActivity(p, {
    type: 'tool',
    phase,
    model,
    status: activity.phase,
    callId: activity.call.id,
    toolName: activity.call.name,
    ...(activity.phase === 'call' ? { argumentsText: activity.call.argumentsText } : {}),
    ...(activity.phase === 'result' ? { resultText: activity.resultText ?? '' } : {}),
  });
}

/**
 * planner_pre 的工具 handler。
 *
 * - `search_story_context`：本地上下文检索（既有逻辑，下沉在 contextSearch.ts）；
 * - `web_search`：DeepSeek 官方联网搜索（仅 webSearchAllowed 时挂载）。每回合最多
 *   `WEB_SEARCH_MAX_CALLS_PER_TURN` 次；搜索失败/超限都返回 tool 错误文本，不抛异常，
 *   因此工具问题不会让整回合失败。
 */
function plannerToolHandler(
  p: TurnRequestV2,
  maxCalls: number,
  options: { webSearchAllowed?: boolean } = {},
) {
  let calls = 0;
  let webSearchCalls = 0;
  return async (call: ChatToolInvocation) => {
    calls += 1;
    if (calls > maxCalls) return { error: `本阶段工具调用已达到玩家设置的上限（${maxCalls}次），请直接基于现有证据完成任务。` };
    if (call.name === 'search_story_context') {
      return searchStoryContext(p, call.arguments);
    }
    if (call.name === 'web_search') {
      if (!options.webSearchAllowed) {
        return formatWebSearchFailure(call.arguments?.query, '联网搜索当前不可用：需要在设置里同时开启「故事上下文查询工具」与「允许规划模型联网搜索」，并使用官方 DeepSeek 地址与 API Key。');
      }
      if (webSearchCalls >= WEB_SEARCH_MAX_CALLS_PER_TURN) {
        return formatWebSearchFailure(call.arguments?.query, `本回合联网搜索已调用 ${WEB_SEARCH_MAX_CALLS_PER_TURN} 次（每回合上限），请直接使用已有结果或现有权威状态完成规划，不要重复搜索。`);
      }
      webSearchCalls += 1;
      const outcome = await searchWeb(call.arguments?.query, {
        apiBase: p.settings.apiBaseUrl,
        apiKey: p.settings.apiKey,
        oriQuestion: p.input,
        signal: p.signal,
      });
      return outcome.toolResult;
    }
    return { error: `未知工具：${call.name}` };
  };
}

function emitThinking(p: TurnRequestV2, phase: ModelPhaseV2, model: string, text: string) {
  if (!text) return;
  safelyNotify(() => p.onModelThinkingDelta?.(phase, text));
  emitActivity(p, { type: 'thinking_delta', phase, model, text });
}

function emitOutput(p: TurnRequestV2, phase: ModelPhaseV2, model: string, text: string) {
  if (!text) return;
  emitActivity(p, { type: 'output_delta', phase, model, text });
}

function emitPatchWarnings(p: TurnRequestV2, model: string, warnings: PatchWarningV2[] | undefined) {
  for (const warning of warnings ?? []) {
    // 警告同时进入活动流和开发者控制台：玩家可观察，测试报告也能从返回Patch读取。
    console.warn(`[V2 patch] ${warning.path}: ${warning.message}`);
    emitActivity(p, { type: 'warning', phase: 'planner_post', model, ...warning });
  }
}

function emitUsage(p: TurnRequestV2, phase: ModelPhaseV2, model: string, usage: LlmUsage | undefined) {
  if (!usage) return;
  emitActivity(p, { type: 'usage', phase, model, usage });
}

function requireJSONObject(text: string, label: string): Record<string, unknown> {
  const parsed = extractJSON(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label}失败：模型返回的内容不是有效 JSON，请重试本回合。`);
  }
  return parsed as Record<string, unknown>;
}

function normalizeActions(raw: unknown): ChoiceV2[] {
  // 与状态写入层共用同一份实现，避免两条路径规则漂移。
  return normalizeChoices(raw);
}

function ensureModelResult(phase: ModelPhaseV2, result: { text?: string; finishReason?: string }) {
  const label = phaseLabels[phase];
  if (!String(result.text ?? '').trim()) throw new Error(`${label}失败：模型返回了空内容，请重试本回合。`);
  if (result.finishReason === 'length' || result.finishReason === 'max_tokens') {
    throw new Error(`${label}失败：模型输出达到上限而被截断，未提交本回合状态。`);
  }
  if (result.finishReason === 'content_filter') throw new Error(`${label}失败：模型内容过滤中止了输出。`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 用户主动取消（而不是模型/网络失败）：不应被包装成可续跑的结算失败。 */
function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return !!error && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError';
}

/**
 * 首次执行与“仅重试结算”共用的运行参数。
 *
 * 结算提示词、模型、JSON/思考参数都必须由同一处解析：否则续跑时重算的结算请求
 * 可能与首次执行不同（例如提示词漏了导演视角注入），导致同一回合出现两套结算语义。
 */
interface TurnRuntimeV2 {
  cfg: { baseUrl: string; apiKey: string };
  plannerModel: string;
  storyModel: string;
  plannerToolsEnabled: boolean;
  plannerToolMaxCalls: number;
  /** 规划阶段是否挂载官方联网搜索（工具开关 + 联网开关 + 官方地址 + 有 Key）。 */
  webSearchAllowed: boolean;
  plannerJsonEnabled: boolean;
  thinking?: 'enabled' | 'disabled';
  reasoningEffort?: 'low' | 'high' | 'max';
  storyReasoningEffort?: 'low' | 'high' | 'max';
  postReasoningEffort?: 'low' | 'high' | 'max';
  plannerPrePrompt: string;
  storyPrompt: string;
  plannerPostPrompt: string;
  shouldInjectPlanner: boolean;
}

function resolveTurnRuntime(p: TurnRequestV2, state: GameStateV2): TurnRuntimeV2 {
  const cfg = { baseUrl: p.settings.apiBaseUrl, apiKey: p.settings.apiKey };
  const plannerModel = resolvePlannerModel(p.settings);
  const storyModel = resolveStoryModel(p.settings);
  const plannerToolsEnabled = p.settings.plannerToolsEnabled === true;
  const plannerToolMaxCalls = Math.max(1, Math.min(6, Math.round(Number(p.settings.plannerToolMaxCalls) || 2)));
  // 官方判定抽到 webSearch.ts：设置页与引擎共用一份，避免两处漂移。
  const isOfficialDeepSeek = isOfficialDeepSeekEndpoint(p.settings.apiBaseUrl);
  // 联网搜索默认关闭，且只有官方地址 + 有 Key 时才可用：非官方服务没有该接口，
  // 请求会 404/401，既浪费一次工具轮次也会让模型困惑。
  const webSearchAllowed = plannerToolsEnabled
    && p.settings.plannerWebSearchEnabled === true
    && isOfficialDeepSeek
    && !!String(cfg.apiKey ?? '').trim();
  const plannerJsonEnabled = p.settings.plannerJsonMode === 'enabled' || (p.settings.plannerJsonMode === 'auto' && isOfficialDeepSeek);
  const thinking = p.settings.thinkingMode === 'enabled' ? 'enabled' as const : p.settings.thinkingMode === 'disabled' ? 'disabled' as const : undefined;
  // 思考强度按模型解析：思考行为的差异来自模型本身，所以首选"每个模型一个档位"，
  // 换模型时自动带上它自己的设置。解析优先级：逐阶段覆盖 → 按模型覆盖 → 全局档位。
  // 关闭思考时显式发送 `thinking: {type:'disabled'}`——官方文档说明思考模式
  // **默认开启**，所以"什么都不发"会退回默认开启而不是关闭。
  const reasoningEffortFor = (phase: 'planner_pre' | 'story' | 'planner_post', model: string) => {
    if (!isOfficialDeepSeek || p.settings.thinkingMode === 'disabled') return undefined;
    const byPhase = p.settings.reasoningEffortByPhase?.[phase];
    if (byPhase) return byPhase;
    const byModel = p.settings.reasoningEffortByModel?.[model.trim()];
    if (byModel) return byModel;
    return p.settings.reasoningEffortByModel?.[''] ?? p.settings.reasoningEffort;
  };
  const reasoningEffort = reasoningEffortFor('planner_pre', plannerModel);
  const storyReasoningEffort = reasoningEffortFor('story', storyModel);
  const postReasoningEffort = reasoningEffortFor('planner_post', plannerModel);
  const roleInjects = p.settings.roleInjects;
  // 导演视角只在执笔模式下生效；游历模式仍按玩家行动处理。
  const directorPerspective = state.mode === 'author' && p.settings.inputPerspective === 'director';
  // 规划角色有长期上下文，高优先级注入只在存档第一次规划调用时生效一次。
  const shouldInjectPlanner = !!roleInjects?.planner?.enabled
    && !!String(roleInjects.planner.text ?? '').trim()
    && !state.plannerInjectApplied;
  const plannerPrePrompt = withRoleInject(
    `${buildPlannerPreSystem(directorPerspective)}${plannerToolsEnabled ? plannerToolDiscipline : ''}${webSearchAllowed ? plannerWebSearchDiscipline : ''}`,
    shouldInjectPlanner ? roleInjects.planner : undefined,
  );
  const storyPrompt = withRoleInject(buildStorySystem(directorPerspective), roleInjects?.story);
  // 写后结算只做状态提交，不检索历史，因此不注入工具纪律、不提供工具。
  const plannerPostPrompt = withRoleInject(
    buildPlannerPostSystem(directorPerspective),
    roleInjects?.post,
  );
  return {
    cfg,
    plannerModel,
    storyModel,
    plannerToolsEnabled,
    plannerToolMaxCalls,
    webSearchAllowed,
    plannerJsonEnabled,
    thinking,
    reasoningEffort,
    storyReasoningEffort,
    postReasoningEffort,
    plannerPrePrompt,
    storyPrompt,
    plannerPostPrompt,
    shouldInjectPlanner,
  };
}

/**
 * 写后结算（planner_post）失败：调用失败、finish_reason=length/content_filter，
 * 或返回内容无法解析为 JSON。
 *
 * 与普通 Error 的区别是携带 `partial`——本回合已通过的前两阶段结果。前端据此显示
 * “正文已生成 · 结算未完成”，并用 `runTurnSettlementV2` 只重跑结算，不重新调用
 * planner_pre / story。用户主动取消（AbortSignal）不包装成本类型，原样抛出。
 *
 * 只有结算阶段的调用与解析错误会转成本类型；planner_pre / story 失败与提交阶段的
 * CAS 错误仍是普通 Error。
 */
export class TurnPostFailureV2 extends Error {
  readonly partial: TurnPartialV2;

  constructor(message: string, partial: TurnPartialV2) {
    super(message);
    this.name = 'TurnPostFailureV2';
    this.partial = partial;
  }
}

/** 结算阶段的完整输入：既来自首次执行（内联对象），也来自 TurnPartialV2（续跑）。 */
interface TurnPostInputV2 {
  /** 回合开始前的权威状态；结算提示词、Patch 提交与历史追加都以它为基准。 */
  stateBeforeTurn: GameStateV2;
  input: string;
  narrativePace: NarrativePaceV2;
  brief: Record<string, unknown>;
  story: string;
  commitId: string;
  turnCalls: TurnModelCallV2[];
  thinkingParts: string[];
  usage: { pre?: LlmUsage; story?: LlmUsage };
  /**
   * 已通过候选目标校验的随机事件绑定。提交前会 seed 进 `state.randomEvent.activeBinding`，
   * 供 patch.ts 在结算分支里读目标、生成 history；续跑时由 brief 重新校验得到。
   */
  randomEventBinding?: RandomEventBindingV2;
}

/**
 * 结算 + 提交 + history/turnRecord 组装。
 *
 * 这是 planner_post 之后唯一的一份逻辑：`runTurnV2` 首次执行与
 * `runTurnSettlementV2` 续跑都走这里，避免两条路径各自演化。
 */
async function runPostAndCommitV2(
  p: TurnRequestV2,
  runtime: TurnRuntimeV2,
  turn: TurnPostInputV2,
): Promise<TurnResultV2> {
  const stateBeforeTurn = turn.stateBeforeTurn;
  // 随机事件绑定在提交前 seed 进状态：patch.ts 的结算分支只认 state.randomEvent.activeBinding，
  // 这样"本回合规划并兑现"的事件才能在同一个提交里写出 history（而不是丢给下一回合）。
  const commitBase = withRandomEventBinding(stateBeforeTurn, turn.randomEventBinding);
  // 结算提示词里的权威状态必须与生成正文时一致，因此用 partial/首次执行捕获的状态快照，
  // 而不是调用方此刻的 p.state（二者仅由 runTurnSettlementV2 的 CAS 校验保证 revision/turn 相同）。
  const postRequest: TurnRequestV2 = { ...p, state: commitBase, input: turn.input };
  const plannerAuthorityBeforeTurn = snapshot(postRequest);
  // 模板里不再内嵌 commitId / baseRevision / turn（它们每回合变化，会让整段模板失效）。
  // 具体值统一在下面这条消息的可变区里给出：TURN_ID 带 turn 与 commitId，
  // 另外单独给出 baseRevision 与 turn，避免模型只能从模板的占位值里猜。
  // asPatch() 会用程序自己的值覆盖这三个字段，因此模型照抄占位值也不会出错。
  const postMessages: ChatMessage[] = [
    { role: 'system', content: runtime.plannerPostPrompt },
    { role: 'user', content: `严格按下列结构输出；所有数组元素必须是对象，不得用字符串代替Patch：\n${postShape}\n【TURN_ID】${commitBase.turn}:${turn.commitId}\n【baseRevision】${commitBase.revision}\n【turn】${commitBase.turn}\n【AUTHORITATIVE_STATE_BEFORE_TURN】${plannerAuthorityBeforeTurn}\n【CURRENT_TURN_INPUT】${turn.input}\n【CURRENT_WRITE_PLAN】${JSON.stringify(turn.brief)}\n【CURRENT_STOP_BOUNDARY】${String(turn.brief.stopBoundary ?? '')}\n${commitBase.mode === 'author' ? 'author模式：actions必须为空数组。' : 'adventure模式：生成2到4个actions。'}\n【CURRENT_STORY】${turn.story}` },
  ];
  const postThinkingParts: string[] = [];
  emitPhase(p, 'planner_post', runtime.plannerModel, 'started', undefined, false);
  let post: ChatResult;
  let parsed: Record<string, unknown>;
  try {
    post = await chatJSONDetailed(runtime.cfg, {
      model: runtime.plannerModel,
      temperature: .1,
      messages: postMessages,
      signal: p.signal,
      ...(runtime.plannerJsonEnabled ? { responseFormat: 'json_object' as const } : {}),
      ...(runtime.thinking ? { thinking: runtime.thinking } : {}),
      ...(runtime.postReasoningEffort ? { reasoningEffort: runtime.postReasoningEffort } : {}),
      onThinkingDelta: (text) => {
        if (text) postThinkingParts.push(text);
        emitThinking(p, 'planner_post', runtime.plannerModel, text);
      },
      onDelta: (text) => emitOutput(p, 'planner_post', runtime.plannerModel, text),
    });
    ensureModelResult('planner_post', post);
    // 解析放进 try：非法 JSON 同样属于“结算失败”，必须给出可续跑的 partial，
    // 而不是一个整轮作废的普通错误。
    parsed = requireJSONObject(post.text, phaseLabels.planner_post);
  } catch (error) {
    emitPhase(p, 'planner_post', runtime.plannerModel, 'failed', error, false);
    // 取消不是失败：原样抛出，调用方走取消分支（不提供续跑入口）。
    if (isAbortError(error, p.signal)) throw error;
    throw new TurnPostFailureV2(errorMessage(error), {
      state: stateBeforeTurn,
      input: turn.input,
      narrativePace: turn.narrativePace,
      brief: turn.brief,
      story: turn.story,
      commitId: turn.commitId,
      turnCalls: [...turn.turnCalls],
      thinkingParts: [...turn.thinkingParts],
    });
  }
  const postCall: TurnModelCallV2 = { phase: 'planner_post', model: runtime.plannerModel, input: post.trace, output: post.text, thinking: post.thinking, usage: post.usage };
  const turnCalls = [...turn.turnCalls, postCall];
  const thinkingParts = [...turn.thinkingParts, ...postThinkingParts];
  emitUsage(p, 'planner_post', runtime.plannerModel, post.usage);
  emitPhase(p, 'planner_post', runtime.plannerModel, 'completed', undefined, false);
  const patch = asPatch(parsed, postRequest, turn.commitId, turn.story);
  emitPatchWarnings(p, runtime.plannerModel, patch.warnings);
  // 提交阶段也可能修正模型输出（例如 superseded 缺少有效替代者时降级为 reframed），
  // 这些说明同样要进入活动流，否则玩家与排障者只看到状态被改却找不到原因。
  const commitWarnings: PatchWarningV2[] = [];
  const patchStats = emptyPatchStatsV2();
  const next = commitTurnPatchV2(commitBase, patch, commitWarnings, patchStats);
  emitPatchWarnings(p, runtime.plannerModel, commitWarnings);
  const now = Date.now();
  next.history = [...commitBase.history,
    { id: genId('msg'), role: 'user', content: turn.input, turn: commitBase.turn, createdAt: now },
    { id: genId('msg'), role: 'assistant', content: turn.story, turn: commitBase.turn, createdAt: now, thinking: joinThinking(...thinkingParts) },
  ];
  // D8：程序侧节奏审计随回合留档，作为下一轮软纠偏的输入；不进 snapshot，不扩大模型输入。
  const pacing = analyzePace({ story: turn.story, pace: turn.narrativePace });
  const turnRecord: TurnRecordV2 = { turn: commitBase.turn, input: turn.input, story: turn.story, calls: turnCalls, patchStats, pacing };
  next.turnRecords = [...(commitBase.turnRecords ?? []), turnRecord].slice(-100);
  next.turn = commitBase.turn + 1;
  next.phase = 'input';
  if (runtime.shouldInjectPlanner) next.plannerInjectApplied = true;
  const randomEventPlanText = randomEventPlanToText(turn.brief.randomEvent);
  if (randomEventPlanText) next.randomEvent.lastPlan = randomEventPlanText;
  return { state: next, story: turn.story, brief: turn.brief, patch, usage: { pre: turn.usage.pre, story: turn.usage.story, post: post.usage } };
}

export async function runTurnV2(p: TurnRequestV2): Promise<TurnResultV2> {
  const runtime = resolveTurnRuntime(p, p.state);
  const {
    cfg,
    plannerModel,
    storyModel,
    plannerToolsEnabled,
    plannerToolMaxCalls,
    webSearchAllowed,
    plannerJsonEnabled,
    thinking,
    reasoningEffort,
    storyReasoningEffort,
    plannerPrePrompt,
    storyPrompt,
  } = runtime;
  // 收集本回合所有阶段的思维链，导出与展示可共用。
  const turnThinkingParts: string[] = [];
  const turnCalls: TurnModelCallV2[] = [];
  const collectThinking = (phase: ModelPhaseV2, model: string, text: string) => {
    if (text) turnThinkingParts.push(text);
    emitThinking(p, phase, model, text);
  };
  // 规划模型的近期原文由设置中的软 token 预算控制；摘要、世界书、
  // 结构化状态和大纲不在该预算内，始终完整注入。
  const plannerAuthority = snapshot(p, recentHistoryWithinBudget(p, plannerContextTokenBudget(p)));
  // 写后结算只需要回合开始前的结构化状态，不再注入 recent 历史正文；
  // 该快照由 runPostAndCommitV2 统一生成（续跑时也用它，保证两次结算看到的权威状态一致）。
  // 故事模型保持原有、稳定的最近四回合窗口，不跟随规划上下文设置缩放。
  const storyAuthority = snapshot(p, p.state.history.slice(-STORY_RECENT_MESSAGE_COUNT));
  // 世界书拆成「常驻（稳定区）」与「关键词命中（可变区）」：只有常驻条目进稳定上下文，
  // 否则稳定块会随玩家输入变化，前缀缓存从第二条消息起整段失效（D5）。
  const worldFacts = splitWorldFacts({ input: p.input, history: p.state.history, worldFacts: p.worldFacts });
  if (worldFacts.truncatedStatic || worldFacts.truncatedDynamic) {
    emitActivity(p, {
      type: 'warning',
      phase: 'planner_pre',
      model: plannerModel,
      code: 'world_facts_truncated',
      path: 'worldFacts',
      message: `本回合世界书共 ${worldFacts.totalCount} 条：常驻已注入 ${worldFacts.alwaysActive.length} 条（上限 ${STABLE_WORLD_FACT_LIMIT}），关键词命中已注入 ${worldFacts.dynamic.length} 条（上限 ${DYNAMIC_WORLD_FACT_LIMIT}，本回合命中 ${worldFacts.matchedCount} 条）；超出上限的条目未注入，可由 search_story_context 检索。`,
    });
  }
  const stableContext = stableStoryContext(p, worldFacts.alwaysActive);
  // 三幕聚焦窗口只进可变区（D4）：system 与【STABLE_STORY_CONTEXT】必须逐字节稳定。
  const stageActWindow = buildStageAndActWindow({ outline: p.outline, destiny: p.state.destiny, turn: p.state.turn });
  const dynamicWorldFacts = dynamicWorldFactsLine(worldFacts.dynamic);
  // 随机事件到期时注入【RANDOM_EVENT_CONTEXT】+ 三档指令；planner_pre 与 story 共用同一份文本。
  const randomEventPrompt = randomEventPromptText(p);
  // 上一回合越界（升华式收尾 / 时间跳太多 / 篇幅超预算）时，本轮只做软纠偏：
  // 在 planner_pre 与 story 的可变区（窗口之后、【AUTHORITATIVE_STATE】之前）注入纠偏块。
  const paceCorrectionAlert = paceCorrectionAlertOf(p.state);
  // 提示词结构对缓存命中至关重要：供应商（DeepSeek / Anthropic / OpenAI）的前缀缓存
  // 只认"从第一个字节开始、逐字节相同的部分"。因此每条消息都按
  //   固定指令与输出模板（每回合逐字节相同） → 本回合可变的状态与输入
  // 排列：固定部分占据最长的可复用前缀，可变部分一律压在最后。
  // 反例（修复前）：结算消息把 ~2KB 的固定输出模板放在正文之后，模板因此永远无法命中。
  const preMessages: ChatMessage[] = [
    { role: 'system', content: plannerPrePrompt },
    { role: 'user', content: `【STABLE_STORY_CONTEXT】${stableContext}` },
    // 固定输出模板行仍排在最前（可复用前缀）；三幕窗口、动态世界书与节奏纠偏只出现在模板之后。
    { role: 'user', content: `只输出 {"intent":"","currentAct":"","activeBeatIds":[],"beatsThisTurn":[],"destinyProgress":"","pathChange":"","reframingNeeded":[],"reconvergencePlan":"","nextStoryFunction":"","writingBrief":"","hardConstraints":[],"creativeSpace":[],"forbiddenChanges":[],"stopBoundary":"","randomEvent":{"planned":false,"targetKind":"beat|thread|relationship|reconvergence","targetId":"","summary":""}}\n${stageActWindow ? `${stageActWindow}\n` : ''}${dynamicWorldFacts}\n${paceCorrectionAlert ? `${paceCorrectionAlert}\n` : ''}【AUTHORITATIVE_STATE】${plannerAuthority}\n【CURRENT_TURN_INPUT】${p.input}\n【NARRATIVE_PACE】${paceInstruction(p)}\n【STORY_AUTONOMY】${storyAutonomyInstruction(p)}${randomEventPrompt ? `\n${randomEventPrompt}` : ''}` },
  ];
  emitPhase(p, 'planner_pre', plannerModel, 'started', undefined, plannerToolsEnabled);
  let pre;
  try {
    pre = await chatJSONDetailed(cfg, {
      model: plannerModel,
      temperature: .25,
      messages: preMessages,
      signal: p.signal,
      ...(plannerJsonEnabled ? { responseFormat: 'json_object' as const } : {}),
      ...(thinking ? { thinking } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(plannerToolsEnabled ? {
        // 联网搜索是可选工具：默认关闭，只有官方地址 + 有 Key 且玩家显式开启时才挂载。
        tools: [plannerContextTool, ...(webSearchAllowed ? [plannerWebSearchTool] : [])],
        toolChoice: 'auto' as const,
        maxToolRounds: plannerToolMaxCalls,
        onToolCall: plannerToolHandler(p, plannerToolMaxCalls, { webSearchAllowed }),
        onToolActivity: (activity: ChatToolActivity) => emitToolActivity(p, 'planner_pre', plannerModel, activity),
      } : {}),
      onThinkingDelta: (text) => collectThinking('planner_pre', plannerModel, text),
      onDelta: (text) => emitOutput(p, 'planner_pre', plannerModel, text),
      onStreamWarning: (warning) => emitActivity(p, {
        type: 'warning',
        phase: 'planner_pre',
        model: plannerModel,
        code: warning.code,
        path: 'stream',
        message: warning.message,
      }),
    });
    ensureModelResult('planner_pre', pre);
    turnCalls.push({ phase: 'planner_pre', model: plannerModel, input: pre.trace, output: pre.text, thinking: pre.thinking, usage: pre.usage });
    emitUsage(p, 'planner_pre', plannerModel, pre.usage);
    emitPhase(p, 'planner_pre', plannerModel, 'completed', undefined, plannerToolsEnabled);
  } catch (error) {
    emitPhase(p, 'planner_pre', plannerModel, 'failed', error, plannerToolsEnabled);
    throw error;
  }
  const brief = requireJSONObject(pre.text, phaseLabels.planner_pre) as any;
  // 随机事件绑定校验：合法绑定在提交阶段写入 activeBinding + lastPlan；非法时只写 lastPlan，
  // 并把原因送进活动流（random_event_binding_invalid），避免错误目标进入调度状态。
  const randomEventBindingCheck = checkPlannerRandomEventBinding(p, brief);
  if (randomEventBindingCheck.warning) {
    console.warn(`[V2 patch] ${randomEventBindingCheck.warning.path}: ${randomEventBindingCheck.warning.message}`);
    emitActivity(p, { type: 'warning', phase: 'planner_pre', model: plannerModel, ...randomEventBindingCheck.warning });
  }
  const randomEventPlanForStory = randomEventPlanToText(brief?.randomEvent) ?? '本回合无随机事件安排';
  // 规划模型可能漏写或写多节拍：统一裁剪后再交给故事模型（慢叙事只保留 1 个，D8）。
  const beatsThisTurn = normalizeBeatsThisTurn(brief?.beatsThisTurn, p.state.narrativePace);
  const storyVariablePrelude = [
    stageActWindow,
    dynamicWorldFacts,
    `【beatsThisTurn】${JSON.stringify(beatsThisTurn)}`,
    // D8 软纠偏：上一回合越界时放在窗口/节拍之后、【AUTHORITATIVE_STATE】之前。
    paceCorrectionAlert,
  ].filter(Boolean).join('\n');

  emitPhase(p, 'story', storyModel, 'started');
  let story;
  try {
    story = await chatStreamDetailed(cfg, {
      model: storyModel,
      temperature: p.settings.temperatureStory,
      maxTokens: p.settings.storyMaxTokens || undefined,
      signal: p.signal,
      ...(thinking ? { thinking } : {}),
      ...(storyReasoningEffort ? { reasoningEffort: storyReasoningEffort } : {}),
      messages: [
        { role: 'system', content: storyPrompt },
        { role: 'user', content: `【STABLE_STORY_CONTEXT】${stableContext}` },
        // 固定写作要求在前、可变材料在后（理由同 planner_pre 的注释）。
        // 三幕窗口与 beatsThisTurn 必须排在【NARRATIVE_PACE】之后：它们每回合都可能变，
        // 插到固定写作要求之前会让这条消息的固定前缀归零（现有缓存回归断言也要求
        // story 的 user 消息以【NARRATIVE_PACE】开头）。
        { role: 'user', content: `【NARRATIVE_PACE】${paceInstruction(p)}\n【STORY_AUTONOMY】${storyAutonomyInstruction(p)}\n${randomEventPrompt ? `${randomEventPrompt}\n` : ''}${storyVariablePrelude}\n【RANDOM_EVENT_PLAN】${randomEventPlanForStory}\n【writingBrief】${brief.writingBrief || brief.intent}\n【hardConstraints】${JSON.stringify(brief.hardConstraints ?? [])}\n【creativeSpace】${JSON.stringify(brief.creativeSpace ?? [])}\n【forbiddenChanges】${JSON.stringify(brief.forbiddenChanges ?? [])}\n【STOP_BOUNDARY】${brief.stopBoundary || '停在需要玩家继续决定的位置'}\n【AUTHORITATIVE_STATE】${storyAuthority}\n【CURRENT_TURN_INPUT】${p.input}\n${writingExecutionAnchor}` },
      ],
      onThinkingDelta: (text) => collectThinking('story', storyModel, text),
      onDelta: (text) => {
        safelyNotify(() => p.onStoryDelta?.(text));
        emitOutput(p, 'story', storyModel, text);
      },
    });
    ensureModelResult('story', story);
    turnCalls.push({ phase: 'story', model: storyModel, input: story.trace, output: story.text, thinking: story.thinking, usage: story.usage });
    emitUsage(p, 'story', storyModel, story.usage);
    emitPhase(p, 'story', storyModel, 'completed');
  } catch (error) {
    emitPhase(p, 'story', storyModel, 'failed', error);
    throw error;
  }

  const commitId = genId('commit');
  // planner_post + Patch 解析 + 提交 + history/turnRecord 组装统一走 runPostAndCommitV2：
  // 首次执行与“仅重试结算”共用同一份逻辑，避免两条路径漂移。
  return runPostAndCommitV2(p, runtime, {
    stateBeforeTurn: p.state,
    input: p.input,
    narrativePace: p.state.narrativePace,
    brief,
    story: story.text,
    commitId,
    turnCalls,
    thinkingParts: turnThinkingParts,
    usage: { pre: pre.usage, story: story.usage },
    randomEventBinding: randomEventBindingCheck.binding,
  });
}

/**
 * 结算续跑：正文与写前规划已经完成、只有写后结算失败时使用。
 *
 * 只重跑 planner_post + Patch 提交 + history/turnRecord 组装（与 runTurnV2 共用
 * runPostAndCommitV2），**不会**再次调用 planner_pre / story，因此成本从“整轮”
 * 降到“一次结算调用”，已生成的正文也不会被丢弃。
 *
 * CAS 前置检查：`partial.state` 是回合开始前的快照。若当前存档的 revision/turn 已经
 * 推进，说明待结算正文对应的回合不再是当前回合，续跑会把旧 Patch 记到新状态上，
 * 因此直接拒绝并给出明确错误（前端据此引导玩家“重新生成本回合”）。
 */
export async function runTurnSettlementV2(p: TurnRequestV2, partial: TurnPartialV2): Promise<TurnResultV2> {
  if (p.state.revision !== partial.state.revision || p.state.turn !== partial.state.turn) {
    throw new Error(`无法仅重试结算：当前存档已推进到 revision=${p.state.revision} / 第 ${p.state.turn} 回合，待结算正文属于 revision=${partial.state.revision} / 第 ${partial.state.turn} 回合。请重新生成本回合。`);
  }
  const runtime = resolveTurnRuntime(p, partial.state);
  // 续跑不再调用 planner_pre，但绑定校验必须与首发一致：用 partial 的回合前状态与 brief 重新校验，
  // 这样"仅重试结算"提交出的 activeBinding/history 与正常三阶段回合等价。
  const randomEventBindingCheck = checkPlannerRandomEventBinding({ ...p, state: partial.state }, partial.brief);
  if (randomEventBindingCheck.warning) {
    console.warn(`[V2 patch] ${randomEventBindingCheck.warning.path}: ${randomEventBindingCheck.warning.message}`);
    emitActivity(p, { type: 'warning', phase: 'planner_post', model: runtime.plannerModel, ...randomEventBindingCheck.warning });
  }
  return runPostAndCommitV2(p, runtime, {
    stateBeforeTurn: partial.state,
    input: partial.input,
    narrativePace: partial.narrativePace,
    brief: partial.brief,
    story: partial.story,
    commitId: partial.commitId,
    turnCalls: partial.turnCalls,
    thinkingParts: partial.thinkingParts,
    // 续跑没有新的 pre/story 调用；从已完成调用的留档里还原 usage，保证返回结构与首发一致。
    usage: {
      pre: partial.turnCalls.find((call) => call.phase === 'planner_pre')?.usage,
      story: partial.turnCalls.find((call) => call.phase === 'story')?.usage,
    },
    randomEventBinding: randomEventBindingCheck.binding,
  });
}
