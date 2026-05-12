import type { StrictCustomConfig } from './custom';
import type { RandomEvent } from './content';
import type { StoryStyleSettings } from './settings';
import type { LlmUsage } from './llm';
import type { AgentPromptTrace } from './ledger';

export type { Background } from './content';

export type JourneyMode = 'adventure' | 'author';
export type AuthorRandomEventMode = 'off' | 'pool' | 'dynamic';

export interface GuaranteedRoundRange {
  id: string;
  startRound: number;
  endRound: number;
  consumed?: boolean;
}

export interface AuthorRandomEventConfig {
  mode: AuthorRandomEventMode;
  poolEventIds: string[];
  poolOverrides: Record<string, Partial<RandomEvent>>;
  dynamic: {
    enabled: boolean;
    startRound: number;
    guaranteedRanges: GuaranteedRoundRange[];
    cooldownRounds: number;
    baseProbability: number;
    missProbabilityBonus: number;
    maxProbability: number;
    generatorPrompt: string;
    preferencePrompt: string;
    referenceEventIds: string[];
  };
}

export interface AuthorDirectorConfig {
  enabled: boolean;
  everyRounds: number;        // 每完成多少回合刷新一次叙事计划
  horizonRounds: number;      // 每次规划未来多少回合
  prompt: string;             // 玩家对叙事导演/大纲映射的额外要求
}

export interface AuthorLogicCheckConfig {
  enabled: boolean;
  everyRounds: number;        // 每完成多少回合做一次一致性审校
  prompt: string;             // 玩家对审校模型的额外要求
}

export interface AuthorSettingGuardConfig {
  enabled: boolean;
  prompt: string;             // 玩家对设定守护者的额外要求
  candidatesAutoAccept: boolean;
  ambientBeatsEnabled: boolean;
}

export interface AuthorOrchestratorConfig {
  enabled: boolean;
  prompt: string;                  // 玩家给回合司辰的额外调度偏好
  minIntervalRounds: number;       // 每隔多少回合至少检查一次；1 表示每回合检查
}

export interface AuthorEventBeatConfig {
  enabled: boolean;
  prompt: string;                  // 玩家给司事 / 事件节奏模型的额外要求
}

export interface StoryArcStage {
  id: string;
  startRound: number;
  endRound: number;
  title: string;
  goal: string;
  requiredBeats: string[];
  avoid?: string;
}

export interface StoryArc {
  id: string;
  type: 'main' | 'relationship' | 'randomEvent' | 'foreshadowing' | 'custom';
  title: string;
  summary: string;
  directive: string;
  lifecycle?: NarrativeEventLifecycle;
  surfaceGoal?: string;
  hiddenIntent?: string;
  completionCriteria?: string[];
  failureCriteria?: string[];
  abandonCriteria?: string[];
  worldProgressDelta?: number;
  relationshipDeltas?: Array<{
    npcId?: string;
    npcName?: string;
    affinityDelta?: number;
    trustDelta?: number;
    note?: string;
  }>;
  progressPercent?: number;
  writingBoundary?: string;
  isMilestone?: boolean;
  milestoneOf?: string;
  alternateOutcomePath?: string;
  involvedNpcIds: string[];
  involvedNpcNames?: string[];
  tags: string[];
  startRound: number;
  targetEndRound?: number;
  currentStageIndex: number;
  stages: StoryArcStage[];
  status: 'pending' | 'active' | 'completed' | 'cancelled';
  progressNote?: string;
  createdAt: number;
  updatedAtRound: number;
}

export interface AuthorRandomEventState {
  pendingEvent?: StoryArc;
  pendingForRound?: number;
  activeEvents: StoryArc[];
  completedEvents: StoryArc[];
  cooldownUntilRound?: number;
  currentProbability?: number;
  lastCheckedRound?: number;
  lastError?: string;
  lastThinking?: string;
}

export type NarrativeEventLifecycle =
  | 'candidate'
  | 'active'
  | 'progressing'
  | 'turning'
  | 'completed'
  | 'soft_failed'
  | 'missed'
  | 'delayed'
  | 'reframed'
  | 'archived';

export interface NarrativeBriefCharacter {
  name: string;
  role?: string;
  surfaceGoal?: string;
  hiddenIntent?: string;
  visibleBehavior?: string;
  doNotReveal?: string[];
}

export interface NarrativeBriefEvent {
  title?: string;
  lifecycle?: NarrativeEventLifecycle;
  objective?: string;
  hiddenIntent?: string;
  completionCriteria?: string[];
  failureCriteria?: string[];
  progress?: string;
  stopAt?: string;
}

export interface NarrativeBriefScene {
  location?: string;
  time?: string;
  weather?: string;
  atmosphere?: string;
  resources?: string[];
  constraints?: string[];
}

export interface NarrativeBriefState {
  objective: string;              // 本回合最小叙事任务
  mustFollow: string[];           // 必须遵守的硬事实 / 大纲 / 设定
  currentEvent?: NarrativeBriefEvent;
  characters?: NarrativeBriefCharacter[];
  scene?: NarrativeBriefScene;
  sceneResources?: string[];
  writingBoundary: string;        // 本回合写到哪里停
  successCriteria: string[];
  avoid: string[];
  hiddenKnowledge?: string[];     // 可用于塑造行为，但不得直接泄露
  updatedAtRound: number;
}

export type OutlineMappingAlignment =
  | 'aligned'
  | 'drifting'
  | 'bridging'
  | 'ready_to_advance'
  | 'uncertain';

export interface OutlineMappingState {
  alignment: OutlineMappingAlignment; // 当前剧情与大纲/主弧的关系
  currentAct?: string;                // 对应的原始大纲幕 / 章节
  currentActIndex?: number;           // 0-based；未知则省略
  currentStageGoal?: string;          // 当前阶段最重要目标
  stageProgress?: number;             // 0-100 软进度
  missingBridgeEvents?: string[];     // 缺少的桥接事件类型 / 小事件
  candidateEvents?: string[];         // 可自然生成的小事件方向
  driftRisks?: string[];              // 偏离风险
  nextMilestone?: string;             // 下一可达里程碑
  updatedAtRound: number;
  thinking?: string;
  rawOutput?: string;
  usage?: LlmUsage;
}

export interface NarrativeEventUpdate {
  arcId?: string;
  title?: string;
  lifecycle?: NarrativeEventLifecycle;
  progressPercent?: number;
  progressNote?: string;
  currentStageIndex?: number;
  reason?: string;
}

export interface AuthorCharacterPlanState {
  updatedAtRound: number;
  summary: string;
  characters: NarrativeBriefCharacter[];
  relationshipSignals?: string[];
  absentCharacters?: Array<{
    name: string;
    reason: string;
  }>;
  risks?: string[];
  thinking?: string;
  rawOutput?: string;
  usage?: LlmUsage;
}

export interface AuthorScenePlanState {
  updatedAtRound: number;
  scene: NarrativeBriefScene;
  sceneResources: string[];
  sceneLogic?: string;
  constraints?: string[];
  opportunities?: string[];
  risks?: string[];
  thinking?: string;
  rawOutput?: string;
  usage?: LlmUsage;
}

export interface AuthorEventPlanState {
  updatedAtRound: number;
  summary: string;
  currentEvent?: NarrativeBriefEvent;
  eventUpdates?: NarrativeEventUpdate[];
  candidateEvents?: string[];
  writingBoundary?: string;
  successCriteria?: string[];
  avoid?: string[];
  thinking?: string;
  rawOutput?: string;
  usage?: LlmUsage;
}

export interface NarrativePlanState {
  currentAct?: string;
  currentStage?: string;
  stageGoal?: string;
  stageStartRound?: number;
  stageTargetEndRound?: number;
  nextRoundFocus?: string;
  nextFewRoundsPlan: Array<{
    id: string;
    startRound: number;
    endRound: number;
    goal: string;
    requiredBeats: string[];
    avoidBeats?: string[];
    revealPolicy?: string;
  }>;
  outlineAlignment?: string;
  outlineMapping?: OutlineMappingState;
  eventUpdates?: NarrativeEventUpdate[];
  pacingAdvice?: string;
  riskNotes?: string[];
  writingBrief?: NarrativeBriefState;
  updatedAtRound: number;
  thinking?: string;
  rawOutput?: string;
  usage?: LlmUsage;
}

export interface SettingPatch {
  id: string;
  topic: string;
  advice: string;
  severity: 'must' | 'should';
  suggestedAtRound: number;
}

export interface SettingGuardCandidate {
  id: string;
  name: string;
  keywords: string[];
  content: string;
  rationale: string;
  status: 'pending' | 'accepted' | 'rejected';
  suggestedAtRound: number;
}

export interface SettingGuardPreference {
  tendency?: string;
  recentSignals?: string[];
  confidence: 'low' | 'medium' | 'high';
  updatedAtRound: number;
}

export interface SettingGuardAmbientBeat {
  id: string;
  source: string;
  trigger: string;
  beat: string;
  optional: boolean;
  suggestedAtRound: number;
  consumed?: boolean;
}

export interface SettingGuardDeviation {
  description: string;
  affectedEntryNames?: string[];
  flaggedAtRound: number;
}

export interface SettingGuardState {
  updatedAtRound: number;
  patches: SettingPatch[];
  candidates: SettingGuardCandidate[];
  preference?: SettingGuardPreference;
  pendingAmbientBeats: SettingGuardAmbientBeat[];
  deviation?: SettingGuardDeviation;
  lastError?: string;
  thinking?: string;
  usage?: LlmUsage;
}

// ====== 阶段化叙事 ======
// 详见 docs/stage-narrative.md。stages 不绑回合数；推进由剧情条件 + stageJudge 决定。

export interface NarrativeStageBeat {
  id: string;
  description: string;
  status: 'pending' | 'achieved' | 'skipped';
  achievedAtRound?: number;        // 仅记录，不约束
}

export interface NarrativeStage {
  id: string;
  name: string;                    // ≤16 字
  description: string;             // ≤220 字
  enterConditions: string[];       // ≤4 条 ≤60 字
  completionConditions: string[];  // ≤5 条 ≤80 字
  expectedBeats: NarrativeStageBeat[];
  status: 'pending' | 'active' | 'completed' | 'skipped';
  enteredAtRound?: number;
  exitedAtRound?: number;
}

export interface AuthorMasterArcConfig {
  enabled: boolean;
  stageHint: string;               // 玩家给主弧生成模型的偏好
  expectedStageCount?: number;     // 期望阶段数（默认从 outline.acts.length 推导）
}

export interface MasterArcState {
  title: string;                   // ≤24 字
  summary: string;                 // ≤220 字
  stages: NarrativeStage[];        // 通常 3-6 个
  currentStageIndex: number;
  generatedAtRound: number;
  updatedAtRound: number;
  generationConfig?: AuthorMasterArcConfig;
  thinking?: string;
  rawOutput?: string;
  usage?: LlmUsage;
}

export type PlayerPace = 'immersive' | 'exploratory' | 'progressing' | 'hurrying';

export interface PlayerIntent {
  primary: string;                 // ≤80 字
  secondary?: string[];            // ≤3 条 ≤60 字
  implicit?: string;               // ≤80 字
}

export interface StageJudgeStatus {
  currentStageId?: string;
  completion: number;              // 0-100
  newlyAchievedBeats: string[];    // 当前 stage 下 expectedBeats[].id 子集
  shouldAdvance: boolean;
  advanceReasoning?: string;       // ≤120 字
}

export interface StageJudgeFocus {
  thisRound: string;               // ≤140 字 故事模型本回合应聚焦的一件事
  avoid?: string[];                // ≤4 条 ≤80 字
}

export interface StageJudgeState {
  updatedAtRound: number;
  playerIntent: PlayerIntent;
  playerPace: PlayerPace;
  paceReasoning?: string;          // ≤140 字
  stageStatus: StageJudgeStatus;
  storyFocus: StageJudgeFocus;
  lastError?: string;
  thinking?: string;
  rawOutput?: string;
  usage?: LlmUsage;
}

export type OrchestratorCallKey =
  | 'outlineMapper'
  | 'stageJudge'
  | 'settingGuard'
  | 'director'
  | 'logicCheck'
  | 'memory'
  | 'summary'
  | 'eventBeat';

export interface OrchestratorCallDecision {
  run: boolean;
  reason: string;
  hint?: string;
}

export type OrchestratorTurnType =
  | 'continue_current_event'
  | 'event_turning_point'
  | 'event_completion_check'
  | 'new_event_candidate'
  | 'stage_transition_candidate'
  | 'free_exploration';

export type OrchestratorPlanningMode = 'light' | 'focused' | 'full';
export type OrchestratorDirectorMode = 'skip' | 'light' | 'full';

export type OrchestratorFocusArea =
  | 'outline'
  | 'stage'
  | 'character'
  | 'scene'
  | 'event'
  | 'foreshadowing'
  | 'setting'
  | 'memory'
  | 'logic'
  | 'summary';

export interface OrchestratorPlanSignal {
  area: OrchestratorFocusArea;
  priority: 'low' | 'medium' | 'high';
  reason: string;
  suggestedModel?: string;
}

export interface OrchestratorPhase1Result {
  updatedAtRound: number;
  notes: string;
  outstandingQuestions?: string[];
  signalSnapshot?: {
    outline?: string;
    stage?: string;
    activeEvents?: string;
  };
  earlyExit?: boolean;
  thinking?: string;
  rawOutput?: string;
  usage?: LlmUsage;
}

export interface OrchestratorState {
  updatedAtRound: number;
  overall?: string;
  turnType?: OrchestratorTurnType;
  planningMode?: OrchestratorPlanningMode;
  directorMode?: OrchestratorDirectorMode;
  focusAreas?: OrchestratorFocusArea[];
  planSignals?: OrchestratorPlanSignal[];
  callOrder?: OrchestratorCallKey[]; // 建议调用顺序；程序会按可执行阶段过滤
  calls: Record<OrchestratorCallKey, OrchestratorCallDecision>;
  phase1?: OrchestratorPhase1Result;
  thinking?: string;
  rawOutput?: string;
  usage?: LlmUsage;
  lastError?: string;
}

export interface PlannerAnalysisRequest {
  question: string;
  reason: string;
  focus?: string;
  relatedNames?: string[];
  expectedOutput?: string;
}

export interface AuthorStageJudgeConfig {
  enabled: boolean;
  prompt: string;                  // 玩家给阶段判断模型的偏好
  autoAdvance: boolean;            // 是否自动推进阶段（默认 true）
}

export interface EventBeatVerdict {
  arcId: string;
  title?: string;
  lifecycle: NarrativeEventLifecycle;
  progressPercent?: number;
  progressNote?: string;
  triggeredCompletion?: boolean;
  triggeredFailure?: boolean;
  outcomeNote?: string;
  appliedRelationshipDeltas?: Array<{
    npcId?: string;
    npcName?: string;
    affinityDelta?: number;
    note?: string;
  }>;
  appliedItemDeltas?: Array<{
    name: string;
    action: 'grant' | 'note';
    description?: string;
  }>;
}

export interface EventBeatState {
  updatedAtRound: number;
  verdicts: EventBeatVerdict[];
  planConcern?: string;
  thinking?: string;
  rawOutput?: string;
  usage?: LlmUsage;
}

export interface DirectorReplyState {
  callId: string;
  question: string;
  missingInfo?: string;
  answer: string;
  round: number;
  createdAt: number;
}

export interface AuthorNarrativeState {
  orchestrator?: OrchestratorState;
  outlineMapping?: OutlineMappingState;
  characterPlan?: AuthorCharacterPlanState;
  scenePlan?: AuthorScenePlanState;
  eventPlan?: AuthorEventPlanState;
  plan?: NarrativePlanState;
  logicReview?: AuthorLogicReviewState;
  settingGuard?: SettingGuardState;
  eventBeat?: EventBeatState;
  directorReply?: DirectorReplyState;
  masterArc?: MasterArcState;
  stageJudge?: StageJudgeState;
  activeArcs: StoryArc[];
  completedArcs: StoryArc[];
  lastDirectorRound?: number;
  lastLogicCheckRound?: number;
  lastSettingGuardRound?: number;
  lastStageJudgeRound?: number;
  lastOrchestratorRound?: number;
  lastOutlineMapperRound?: number;
  lastCharacterPlannerRound?: number;
  lastScenePlannerRound?: number;
  lastEventPlannerRound?: number;
  lastEventBeatRound?: number;
}

export interface AuthorLogicIssue {
  id: string;
  type: 'character' | 'scene' | 'timeline' | 'item' | 'outline' | 'memory' | 'pacing' | 'other';
  severity: 'info' | 'warning' | 'critical';
  description: string;
  evidence?: string;
  repairHint?: string;
}

export interface AuthorLogicReviewState {
  updatedAtRound: number;
  overall: string;
  issues: AuthorLogicIssue[];
  repairDirectives: string[];
  nextRoundWarnings?: string[];
  thinking?: string;
  rawOutput?: string;
  usage?: LlmUsage;
}

export interface AgentThought {
  id: string;
  kind: string;
  label: string;
  round: number;
  content?: string;
  output?: string;
  prompt?: AgentPromptTrace;
  usage?: LlmUsage;
  cacheHit?: boolean;
  createdAt: number;
}

export type MessageRole = 'system' | 'user' | 'assistant';

export interface MessageRuntimeStats {
  elapsedMs?: number;
  usage?: LlmUsage;
  estimatedOutputTokens?: number;
}

export interface ToolActivityRecord {
  id: string;
  name: string;
  label: string;
  detail?: string;
  actor?: string;
  agentKind?: string;
  phase?: 'read' | 'write' | 'call' | 'result' | 'status';
  createdAt: number;
}

export interface Message {
  role: MessageRole;
  content: string;
  round: number;
  thinking?: string;
  toolEvents?: ToolActivityRecord[];
  runtimeStats?: MessageRuntimeStats;
}

export interface Choice {
  id: string;
  label: string;
  hint?: string;
}

export type ItemType = 'consumable' | 'reusable';

export interface Item {
  id: string;
  name: string;
  description: string;
  type: ItemType;
  acquiredAtRound: number;
  // 若存在：表示该能力是在本次决策周期给予的"临时"条目，
  // 一旦玩家刷新选项就会被新一轮的 grants 覆盖；玩家一旦确认下一步动作就会固化。
  pendingGrantKey?: string;
  // 若为 true：决策模型判定在本回合的故事中该能力已失效/遗失。
  // 同样"待定"：刷新决策会清除此标记；玩家确认行动后执行实际移除。
  pendingDestroy?: boolean;
  destroyReason?: string;
}

export type GamePhase =
  | 'story'     // 正在生成故事
  | 'choices'   // 等待玩家选择
  | 'manual'    // 等待玩家自由输入
  | 'ended';    // 已结束

export interface GameConfig {
  totalRounds: number;        // 0 表示无尽模式；>0 为有限回合
  manualInputEvery: number;   // 每 X 轮允许一次手动输入
  refreshChoiceEvery: number; // 每 X 轮获得一次"刷新决策"机会（累积）
  itemCapacity: number;       // 能力容量上限
}

export interface GameContent {
  outlineId?: string;
  backgroundId?: string;
  worldBookIds: string[];     // 激活的世界书 id
  eventIds: string[];         // 启用的随机事件 id
  characterName?: string;     // 玩家为角色起的名字
  mode?: JourneyMode;         // 启程模式：默认游历；author 为执笔模式
  strictCustom?: StrictCustomConfig; // 严格自定义模式配置（创建存档时固化）
  authorCustom?: StrictCustomConfig; // 执笔模式独立提示词链路（创建存档时固化）
  authorRandomEvent?: AuthorRandomEventConfig; // 执笔模式随机事件/动态事件弧配置
  authorDirector?: AuthorDirectorConfig; // 执笔模式叙事导演/大纲映射配置
  authorLogicCheck?: AuthorLogicCheckConfig; // 执笔模式逻辑/一致性审校配置
  authorMasterArc?: AuthorMasterArcConfig;   // 执笔模式主弧生成配置（阶段化叙事）
  authorStageJudge?: AuthorStageJudgeConfig; // 执笔模式阶段判断模型配置
  authorSettingGuard?: AuthorSettingGuardConfig; // 执笔模式设定守护者配置
  authorOrchestrator?: AuthorOrchestratorConfig; // 执笔模式回合司辰 / Agent 调度配置
  authorEventBeat?: AuthorEventBeatConfig; // 执笔模式司事 / 事件节奏判定配置
  storyStyle?: StoryStyleSettings; // 创建/导入旅程时固化的故事风格设置
}

export interface TriggeredEventRecord {
  id: string;
  round: number;
}

export type NpcUpdateAction = 'upsert' | 'update' | 'delete';

export interface NpcUpdateRaw {
  // 新协议优先按 id 修改/删除既有 NPC；旧协议可继续只传 name。
  id?: string;
  name?: string;
  action?: NpcUpdateAction;
  role?: string;
  description?: string;
  // affinity 为直接设定值；affinityDelta 为基于当前值的增量。
  affinity?: number;
  affinityDelta?: number;
  details?: string[];                  // 外观、服装、习惯、关系猜测等主角已知细节
  replaceDetails?: boolean;            // true 时用 details 覆盖旧细节；默认追加合并
  note?: string;
}

export interface Npc {
  id: string;
  name: string;
  role?: string;
  description?: string;
  affinity: number;
  firstRound: number;
  lastRound: number;
  appearances: number;
  details?: string[];                  // 外观/服装/承诺/关系猜测等一致性细节
  recentNote?: string;
}

export interface SceneRef {
  name: string;
  description?: string;
  time?: string;                 // 当前场景时间，如"黄昏""深夜""次日清晨"
  weather?: string;              // 当前场景天气/环境状态，如"小雨""阴冷无风"
}

export interface GameState {
  currentRound: number;
  history: Message[];
  summary: string;
  summarizedUntilIndex: number;             // history 中已被摘要覆盖的前缀 index（投喂故事模型时从此处开始切）
  longTermMemory?: string;                  // 周期性整理出的长期一致性记忆块
  lastMemoryRound?: number;                 // 上次成功更新长期记忆时的已完成回合数
  characterSheet: Record<string, unknown>;
  triggeredEvents: TriggeredEventRecord[];
  lastChoices?: Choice[];
  lastPlayerInput?: string;
  regenerationHint?: string;                  // 重新请求本回合时附加给故事模型的重要参考
  phase: GamePhase;
  ending?: string;
  error?: string;
  refreshesLeft: number;
  backpack: Item[];
  selectedItemIds: string[];
  needsDiscard: number;
  review?: AdventureReview;
  npcs: Npc[];
  anchors: MemoryAnchor[];
  currentScene?: SceneRef;                  // 玩家所在的场景
  availableScenes: SceneRef[];              // 可前往的场景（由决策模型每轮更新）
  sceneHistory: SceneRef[];                 // 历史见过/去过的场景，用于快速回访
  authorNarrative?: AuthorNarrativeState;    // 执笔模式叙事导演状态
  authorRandomEventState?: AuthorRandomEventState; // 执笔模式动态随机事件运行态
  agentThoughts?: AgentThought[];             // 各模型调用记录（思维链 / 输出 / 缓存命中，前端默认隐藏）
  finalizeRequested?: boolean;              // 无尽模式下玩家主动触发"下一回合即最终回合"
}

export interface MemoryAnchor {
  id: string;
  round: number;
  excerpt: string;               // UI 预览用短摘录
  content?: string;              // 完整标记内容；提示词注入优先使用它
  note?: string;                 // 玩家可选的备注
  createdAt: number;
}

export interface AdventureReview {
  title: string;
  summary: string;
  scores: {
    narrative: number;      // 故事性
    choices: number;        // 决策精彩度
    immersion: number;      // 沉浸感
    completion: number;     // 目标完成度
  };
  overall: number;          // 综合分 0~100
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  highlights: string[];
  comment: string;
  generatedAt: number;
  thinking?: string;
  rawOutput?: string;
  usage?: LlmUsage;
}

export interface GameSave {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  config: GameConfig;
  content: GameContent;
  state: GameState;
}
