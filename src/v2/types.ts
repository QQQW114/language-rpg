import type { StoryOutline, Background, WorldBookEntry } from '@/types/content';
import type { AppSettings } from '@/types/settings';
import type { LlmUsage } from '@/types/llm';
import type { AgentPromptTrace } from '@/types/ledger';

export type JourneyModeV2 = 'author' | 'adventure';
export type NarrativePaceV2 = 'slow' | 'standard' | 'fast' | 'timeskip';

/**
 * 故事推进权限（与叙事速度解耦）：
 * - `strict` 严格遵循：只写玩家输入明确要求/直接必然产生的内容，不自行推进；
 * - `co_author` 灵魂共创（v0.7.0 新增）：先读懂玩家为主角注入的灵魂、语调与本轮意图，
 *   80% 笔墨顺延玩家当前戏份，大纲节拍只在能顺着玩家动作余波自然长出来时才嫁接；
 *   允许本轮 0 节拍（玩家离场/独处/收尾），详见 `【STORY_AUTONOMY】` 文案；
 * - `standard` 主线推进（导演/主线主导）：承接玩家输入后，沿主线自然推进一小步；
 * - `free` 自由发散：在守世界书/大纲命运方向的前提下，自行安排场景与转折。
 *
 * 缺省/非法值按 `standard` 处理（旧存档迁移；新旅程默认值由 store 决定，T8 负责）。
 * 叙事速度继续只负责写作节奏与篇幅感。
 */
export type StoryAutonomyV2 = 'strict' | 'co_author' | 'standard' | 'free';
export type RandomEventIntensityV2 = 'related' | 'progress' | 'destiny';

/** 随机事件必须绑定的目标类型：故事节 / 线程 / 关系 / 最终命运锚。 */
export type RandomEventTargetKindV2 = 'beat' | 'thread' | 'relationship' | 'reconvergence';
/**
 * 随机事件三态结算：
 * - resolved：本回合完整兑现；
 * - ongoing_hook：已经起头、留待后续回合回收（滚动钩子）；
 * - interrupted：被玩家打断 / 正文里没有真实发生，调度顺延到下一回合重试。
 */
export type RandomEventResolutionV2 = 'resolved' | 'ongoing_hook' | 'interrupted';

/** 一轮生成中三个可展示的模型阶段。 */
export type ModelPhaseV2 = 'planner_pre' | 'story' | 'planner_post';
export type ModelPhaseStatusV2 = 'started' | 'completed' | 'failed';

/**
 * 面向聊天界面的模型活动流。当前 V2 链路尚未向模型提供工具，
 * 因而 phase 事件会明确携带 toolsEnabled:false；tool 事件预留给后续查询工具。
 */
export type ModelActivityV2 =
  | {
    type: 'phase';
    phase: ModelPhaseV2;
    status: ModelPhaseStatusV2;
    model: string;
    label: string;
    toolsEnabled: boolean;
    error?: string;
  }
  | {
    /**
     * story 阶段内部自动重试信号（阶段级重试，T3）。
     *
     * 发出时上一次 story 尝试已经通过 `onStoryDelta` 实时透出过部分正文/思考，
     * 消费方（游戏页）必须丢弃本轮流式预览（stream / streamBuffer）并清空 story 思考，
     * 否则重试得到的正文会拼在半截文本后面。重试本身不改变阶段状态（仍为 started），
     * 因此不是 `phase` 事件，单独用这个类型区分，避免面板把阶段误判为失败。
     */
    type: 'phase_restart';
    phase: 'story';
    model: string;
    /** 即将开始的尝试序号（1 为首次尝试；2 表示第一次重试）。 */
    attempt: number;
    /** 本阶段允许的最大尝试次数。 */
    maxAttempts: number;
    /** 触发重试的失败原因（截断/供应商错误/网络瞬时错误等），已截断为可读长度。 */
    reason: string;
  }
  | {
    type: 'thinking_delta';
    phase: ModelPhaseV2;
    model: string;
    text: string;
  }
  | {
    type: 'output_delta';
    phase: ModelPhaseV2;
    model: string;
    text: string;
  }
  | {
    /** API 在该阶段结束时返回的 token 用量（含供应商缓存统计）。 */
    type: 'usage';
    phase: ModelPhaseV2;
    model: string;
    usage: LlmUsage;
  }
  | {
    type: 'tool';
    phase: ModelPhaseV2;
    model: string;
    status: 'call' | 'result';
    callId: string;
    toolName: string;
    argumentsText?: string;
    resultText?: string;
  }
  | {
    type: 'warning';
    phase: ModelPhaseV2;
    model: string;
    code: string;
    path: string;
    message: string;
  };

export interface PatchWarningV2 {
  code: string;
  path: string;
  message: string;
}

/**
 * 单个类别（人物 / 关系 / 库存 / 线程 / 事实）在提交时的对账结果。
 *
 * 存在的意义：程序会静默丢弃或改写模型提交的条目（缺证据、白名单外枚举、id 不存在…）。
 * 在此之前这些丢弃只以 warning 文本的形式存在，既没有数字也无法长期统计，于是
 * "模型以为记下了、程序其实丢了"这个结构性盲区一直无法度量。有了这份计数就能回答
 * "每轮到底被丢了多少条"，再决定是否值得把被拒情况回显给模型。
 */
export interface PatchCategoryStatsV2 {
  /** 模型提交的原始条数（过滤掉非对象元素之后）。 */
  input: number;
  /** 真正落地到权威状态的条数（合并进已有条目也算落地）。 */
  applied: number;
  /** 被整条丢弃的条数（缺必填字段、id 不存在、非白名单枚举、缺证据等）。 */
  blocked: number;
  /**
   * 其中"结构不全"的条数：模型漏填了必填字段（例：update 没有 id、create 没有 name）。
   *
   * 与 `blocked - malformed`（字段齐全但被拒，例如引用了不存在的 id）分开统计，
   * 因为两者的修法完全不同：前者要改输出模板与指令，后者要加 id 回显校验。
   */
  malformed: number;
}

export interface PatchStatsV2 {
  characters: PatchCategoryStatsV2;
  relationships: PatchCategoryStatsV2;
  inventory: PatchCategoryStatsV2;
  threads: PatchCategoryStatsV2;
  facts: PatchCategoryStatsV2;
  /** 因为枚举不在白名单而被改写的字段个数。 */
  coercedEnums: number;
}

export type StoryBeatStatusV2 = 'pending' | 'available' | 'active' | 'satisfied' | 'weakened' | 'reframed' | 'superseded';
export interface StoryBeatRuntimeV2 {
  beatId: string;
  /**
   * 故事节所属幕（大纲 `act.id`）。
   *
   * 创建时按大纲写入；旧存档在 hydrate 时按 outline 反查补齐。**本字段不可变**：
   * 玩家改道导致某个故事节无法在本幕完成时，它仍然属于原幕，只额外写
   * `carriedFromActId` 表示"从那一幕挂账带到后续幕继续追踪"。把 `actId` 搬到下一幕
   * 会让"本幕是否完成"失去依据，也会掩盖挂账节尚未完成的事实。
   */
  actId: string;
  status: StoryBeatStatusV2;
  currentPlan?: string;
  evidenceSummary?: string;
  evidenceTurns: number[];
  replacementBeatId?: string;
  /** 因改道跨幕挂账时记录原属幕；`actId` 保持不变。 */
  carriedFromActId?: string;
  updatedAtTurn: number;
}

/** 已退出幕的历史记录（由程序在切幕时追加，旧存档不伪造历史）。 */
export interface DestinyActHistoryEntryV2 {
  /** 已退出的幕 id。 */
  actId: string;
  /** 进入该幕的回合（第一幕为 0）。 */
  enteredTurn: number;
  /** 退出该幕的回合；当前幕没有这个字段。 */
  exitedTurn?: number;
  /** 退出时的幕摘要，供模型/玩家回顾"上一幕发生了什么"。 */
  exitSummary?: string;
  /** 因改道挂账被带走的故事节 id（这些节仍是非终态，不参与结局门槛放宽）。 */
  carriedBeatIds?: string[];
}

export interface DestinyProgressV2 {
  completionEstimate: number;
  completionReason: string;
  /** 权威当前幕 id：只由程序维护，模型自报值仅作为提议。 */
  currentActId: string;
  /** 当前幕在大纲幕序中的 0-based 序号（UI 可渲染「幕 2/3」）。 */
  currentActIndex: number;
  currentStage: string;
  currentPath: string;
  nextMilestone?: string;
  convergencePlan?: string;
  beats: StoryBeatRuntimeV2[];
  /** 已退出幕的历史；旧存档默认为空数组，不伪造 entered/exited turn。 */
  actHistory: DestinyActHistoryEntryV2[];
  endingReached: boolean;
  endingReachedAtTurn?: number;
  /** 最近一次幕切换发生的回合。 */
  lastActTransitionTurn?: number;
  updatedAtTurn: number;
}

/**
 * 写前规划提交、并已通过候选目标校验的随机事件绑定。
 *
 * 随机事件不允许是"无绑定的路人事件"：每一档强度都必须落到一个具体目标上
 * （推进某个故事节 / 线程 / 关系，或回收最终命运锚），这样事件才会真正改变故事，
 * 而不是一次性的氛围插曲。
 */
export interface RandomEventBindingV2 {
  targetKind: RandomEventTargetKindV2;
  targetId: string;
  /** 写前摘要，≤80 字；结算时写入 `history[].summary`。 */
  summary: string;
  /** 规划该绑定的回合。 */
  plannedAtTurn: number;
}

/** 随机事件历史条目：让"事件发生过就不再记得"变成可回收的滚动钩子。 */
export interface RandomEventHistoryItemV2 {
  id: string;
  turn: number;
  intensity: RandomEventIntensityV2;
  targetKind: RandomEventTargetKindV2;
  targetId: string;
  /** 写前摘要，≤80 字。 */
  summary: string;
  /** 写后结果说明，≤100 字。 */
  outcomeNote?: string;
  status: RandomEventResolutionV2;
}

export interface RandomEventStateV2 {
  enabled: boolean;
  nextTriggerTurn: number;
  pending: boolean;
  intensity: RandomEventIntensityV2;
  lastTriggeredTurn?: number;
  /** 下一次随机事件距离上次触发的最短回合数。 */
  triggerIntervalMin: number;
  /** 下一次随机事件距离上次触发的最长回合数。 */
  triggerIntervalMax: number;
  /** 规划模型最近一次为本回合/下回合安排的随机事件（已转为纯文字）。 */
  lastPlan?: string;
  /** 结算模型最近一次提交的随机事件备注/结果说明。 */
  lastNote?: string;
  /**
   * 写前规划已校验、等待结算兑现的绑定。
   * - handled / interrupted 结算后清空（interrupted 会保留供下一回合重试）；
   * - 旧存档没有该字段，读取方按 undefined 退化。
   */
  activeBinding?: RandomEventBindingV2;
  /**
   * 滚动事件历史：上限 8，超限时优先保留最近的 ongoing_hook（最多 3 条）。
   * 旧存档没有该字段，读取方按空数组退化（本字段暂由随机事件发送方写入，而非 hydrate）。
   */
  history?: RandomEventHistoryItemV2[];
}

export interface CharacterV2 {
  id: string;
  name: string;
  aliases: string[];
  role?: string;
  description?: string;
  status: 'active' | 'absent' | 'missing' | 'dead' | 'unknown';
  knownFacts: string[];
  firstSeenTurn: number;
  lastSeenTurn: number;
}

export interface RelationshipV2 {
  id: string;
  fromId: string;
  toId: string;
  affinity: number;
  label?: string;
  note?: string;
  updatedAtTurn: number;
}

export interface InventoryEntryV2 {
  id: string;
  name: string;
  kind: 'item' | 'ability' | 'quest_item';
  description: string;
  quantity: number;
  consumable: boolean;
  acquiredAtTurn: number;
  updatedAtTurn: number;
}

export interface StoryThreadV2 {
  id: string;
  title: string;
  kind: 'main' | 'relationship' | 'quest' | 'hook';
  status: 'candidate' | 'active' | 'completed' | 'failed' | 'cancelled';
  progress?: number;
  currentStep?: string;
  involvedCharacterIds: string[];
  note?: string;
  updatedAtTurn: number;
}

export interface SceneV2 { id: string; name: string; description?: string; time?: string; weather?: string; }
export interface ChoiceV2 { id: string; label: string; hint?: string; }
export interface CanonicalFactV2 {
  id: string;
  subjectId: string;
  predicate: string;
  value: string;
  scope: 'character' | 'relationship' | 'location' | 'world' | 'schedule' | 'identity' | 'custom';
  stability: 'core' | 'stable' | 'temporary';
  confidence: 'explicit' | 'inferred';
  keywords: string[];
  evidenceTurn: number;
  evidenceQuote?: string;
  createdAtTurn: number;
  updatedAtTurn: number;
}
export interface TurnModelCallV2 {
  phase: ModelPhaseV2;
  model: string;
  input?: AgentPromptTrace;
  output?: string;
  thinking?: string;
  usage?: LlmUsage;
}

/**
 * 程序侧节奏审计（D8）：提交回合时由 `paceGuard.analyzePace` 写入 `TurnRecordV2.pacing`。
 *
 * 只做观察，不修改正文：本轮越界（升华式收尾 / 单轮时间跨度过大 / 慢、标准叙事篇幅超预算）
 * 时，下一回合的 planner_pre 与 story 提示词会注入 `【PACE_CORRECTION_ALERT】` 做软纠偏。
 * 旧存档的 turnRecord 没有该字段，读取方按 undefined 退化（不伪造历史）。
 */
export interface PacingAuditV2 {
  /** 正文字符数。 */
  length: number;
  /** 时间推进词计数（上限 5）。 */
  timeJumpCount: number;
  /** 尾 220 字的叙述部分是否命中升华/收束模式。 */
  closureDetected: boolean;
  /** 慢/标准叙事下正文是否超过篇幅上限。 */
  overBudget: boolean;
  /** 是否需要下一轮软纠偏：closureDetected || timeJumpCount >= 3 || overBudget。 */
  needsCorrection: boolean;
}

export interface TurnRecordV2 {
  turn: number;
  input: string;
  story: string;
  calls: TurnModelCallV2[];
  /**
   * 本轮状态提交的对账结果：模型提交了多少条、程序接受了多少条、丢弃了多少条、
   * 改写了多少处枚举。用于长期观察"模型的输出有多少被程序拒绝"，是决定是否
   * 把被拒情况回显给模型的数据来源。
   */
  patchStats?: PatchStatsV2;
  /**
   * 本轮节奏审计（程序侧确定性检测）。下一轮读取最后一条记录决定是否注入
   * `【PACE_CORRECTION_ALERT】`；本字段不进入模型上下文（snapshot 不暴露）。
   */
  pacing?: PacingAuditV2;
}

/**
 * 一回合中已经生成、但结算（planner_post）尚未完成时的中间结果。
 *
 * 正文已经写出来、写前规划也已经完成，只差写后结算。带上它就能用
 * `runTurnSettlementV2` 只重跑结算，而不必重新消耗 planner_pre / story 两次调用。
 *
 * `state` 是**回合开始前**的权威状态快照（与 LastTurnCheckpoint.stateBeforeTurn 同源）：
 * 续跑时结算与提交都以它为基准，从而与“首次执行就成功”的结果保持等价；
 * 调用方必须先用它的 revision/turn 与当前存档做 CAS 校验，不一致说明回合已经推进，
 * 此时不允许续跑。
 */
export interface TurnPartialV2 {
  state: GameStateV2;
  input: string;
  narrativePace: NarrativePaceV2;
  brief: Record<string, unknown>;
  story: string;
  commitId: string;
  /** 已完成的阶段调用；首次结算失败时恰好是 planner_pre + story 两条。 */
  turnCalls: TurnModelCallV2[];
  /** 已收集的思维链增量（按阶段顺序），用于组装历史消息的 thinking。 */
  thinkingParts: string[];
}

/** 一次完整回合（首次执行或仅重试结算）的返回结构。 */
export interface TurnResultV2 {
  state: GameStateV2;
  story: string;
  brief: Record<string, unknown>;
  patch: TurnPatchV2;
  usage: { pre?: LlmUsage; story?: LlmUsage; post?: LlmUsage };
}

export interface MessageV2 {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  turn: number;
  createdAt: number;
  /** 该回合模型思维链（若存在，仅 assistant 消息使用）。 */
  thinking?: string;
}

/**
 * 最近一次成功回合的轻量回退点。
 *
 * 它属于存档容器而不是 GameStateV2：模型上下文不需要知道重试机制，
 * 前端只需恢复回合开始前的权威状态，再使用原输入（或编辑后的输入）重新请求。
 */
export interface LastTurnCheckpointV2 {
  stateBeforeTurn: GameStateV2;
  input: string;
  narrativePace: NarrativePaceV2;
  completedAt: number;
  afterRevision: number;
  afterTurn: number;
}

export interface GameStateV2 {
  schemaVersion: 2;
  revision: number;
  turn: number;
  phase: 'input' | 'generating' | 'ended';
  mode: JourneyModeV2;
  narrativePace: NarrativePaceV2;
  /** 故事推进权限；缺省按 standard（旧存档/旧夹具无需迁移）。 */
  storyAutonomy?: StoryAutonomyV2;
  history: MessageV2[];
  summary: string;
  latestProgress?: string;
  /**
   * 主角灵魂画像（v0.7.0 灵魂共创）：从正文中主角的实际言行提炼出的性格弧光、
   * 行事风格与喜好边界，≤120 字。由 planner_post 可选更新、patch 截断写入、
   * hydrate 保留；它不是当前回合的意图，而是跨回合延续的角色底色。
   * 缺省/空串表示尚未形成画像（旧存档无需迁移），不注入提示词。
   */
  soulProfile?: string;
  currentScene?: SceneV2;
  characters: CharacterV2[];
  relationships: RelationshipV2[];
  inventory: InventoryEntryV2[];
  storyThreads: StoryThreadV2[];
  facts: CanonicalFactV2[];
  availableActions: ChoiceV2[];
  destiny: DestinyProgressV2;
  randomEvent: RandomEventStateV2;
  lastCommitId?: string;
  /** 高优先级注入：规划角色在该存档是否已注入过一次。 */
  plannerInjectApplied?: boolean;
  /** 每回合模型输入/输出留档，用于“导出全部信息”。 */
  turnRecords?: TurnRecordV2[];
}

export interface TurnPatchV2 {
  schemaVersion: 2;
  commitId: string;
  baseRevision: number;
  turn: number;
  roundSummary: string;
  latestProgress: string;
  /**
   * 主角灵魂画像（可选，仅灵魂共创档由 planner_post 填写，≤120 字）。
   * 压成单行；无变化/看不出来时必须留空字符串——程序只在非空时覆盖旧值。
   */
  soulProfile?: string;
  characters?: Array<{ op: 'create' | 'update'; id: string; name?: string; aliases?: string[]; role?: string; description?: string; status?: CharacterV2['status']; addFacts?: string[]; reason?: string }>;
  relationships?: Array<{ fromId: string; toId: string; affinityDelta?: number; label?: string; note?: string; reason: string }>;
  inventory?: Array<{ op: 'grant' | 'consume' | 'update' | 'remove'; id?: string; name?: string; kind?: InventoryEntryV2['kind']; quantity?: number; description?: string; consumable?: boolean; reason: string }>;
  threads?: Array<{ op: 'create' | 'update'; id: string; title?: string; kind?: StoryThreadV2['kind']; status?: StoryThreadV2['status']; progress?: number; currentStep?: string; involvedCharacterIds?: string[]; note?: string; reason?: string }>;
  facts?: Array<{ op: 'create' | 'replace'; id?: string; subjectId: string; predicate: string; value: string; scope?: CanonicalFactV2['scope']; stability?: CanonicalFactV2['stability']; confidence?: CanonicalFactV2['confidence']; keywords?: string[]; evidenceQuote?: string; reason?: string }>;
  scene?: Partial<SceneV2>;
  actions?: ChoiceV2[];
  /** 模型输出被程序安全规范化时产生的可观察警告，不进入故事权威状态。 */
  warnings?: PatchWarningV2[];
  destiny?: {
    completionEstimate?: number;
    completionReason?: string;
    /** 模型自报的当前幕。只有与程序权威当前幕一致时才被接受，否则忽略并警告。 */
    currentActId?: string;
    currentStage?: string;
    currentPath?: string;
    nextMilestone?: string;
    convergencePlan?: string;
    endingReached?: boolean;
    reason: string;
    /**
     * 幕切换提议。`proposeNextAct` 只是模型的**提议**：当前幕无法全部完成时，
     * 程序按三条 gate 决定是否携带挂账节进入下一幕。常规轨（本幕原生故事节全部
     * 终态）由程序自动推进，不需要这个字段。
     */
    actTransition?: { proposeNextAct?: boolean; actExitSummary?: string };
    beatChanges?: Array<{ beatId: string; status: StoryBeatStatusV2; currentPlan?: string; evidenceSummary?: string; evidenceQuote?: string; replacementBeatId?: string; reason: string }>;
  };
  randomEvent?: {
    handled: boolean;
    /** 三态结算：完整兑现 / 已起头留钩子 / 被玩家打断未发生。缺省时按 resolved 处理。 */
    resolution?: RandomEventResolutionV2;
    note?: string;
  };
}

export interface TurnRequestV2 {
  state: GameStateV2;
  input: string;
  settings: AppSettings;
  outline?: StoryOutline;
  background?: Background;
  worldFacts?: WorldBookEntry[];
  signal?: AbortSignal;
  onStoryDelta?: (text: string) => void;
  /** 阶段切换的轻量回调，适合更新“正在规划/写作/结算”状态。 */
  onPhaseChange?: (phase: ModelPhaseV2, status: ModelPhaseStatusV2) => void;
  /** 完整活动流，包含阶段、思考增量、输出增量，并预留工具调用事件。 */
  onModelActivity?: (activity: ModelActivityV2) => void;
  /** 思考内容的便捷回调；同一增量也会出现在 onModelActivity 中。 */
  onModelThinkingDelta?: (phase: ModelPhaseV2, text: string) => void;
}
