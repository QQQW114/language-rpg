import type { StrictCustomConfig } from './custom';
import type { RandomEvent } from './content';
import type { StoryStyleSettings } from './settings';

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
  hiddenIntent?: string;
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
  pacingAdvice?: string;
  riskNotes?: string[];
  updatedAtRound: number;
}

export interface AuthorNarrativeState {
  plan?: NarrativePlanState;
  logicReview?: AuthorLogicReviewState;
  activeArcs: StoryArc[];
  completedArcs: StoryArc[];
  lastDirectorRound?: number;
  lastLogicCheckRound?: number;
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
}

export type MessageRole = 'system' | 'user' | 'assistant';

export interface Message {
  role: MessageRole;
  content: string;
  round: number;
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
  // 若存在：表示该道具是在本次决策周期给予的"临时"条目，
  // 一旦玩家刷新选项就会被新一轮的 grants 覆盖；玩家一旦确认下一步动作就会固化。
  pendingGrantKey?: string;
  // 若为 true：决策模型判定在本回合的故事中该道具已被损毁/遗失。
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
  itemCapacity: number;       // 背包容量上限
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
