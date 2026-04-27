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
}

export interface TriggeredEventRecord {
  id: string;
  round: number;
}

export interface NpcUpdateRaw {
  name: string;
  role?: string;
  description?: string;
  affinityDelta?: number;
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
  recentNote?: string;
}

export interface SceneRef {
  name: string;
  description?: string;
}

export interface GameState {
  currentRound: number;
  history: Message[];
  summary: string;
  summarizedUntilIndex: number;             // history 中已被摘要覆盖的前缀 index（投喂故事模型时从此处开始切）
  characterSheet: Record<string, unknown>;
  triggeredEvents: TriggeredEventRecord[];
  lastChoices?: Choice[];
  lastPlayerInput?: string;
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
  finalizeRequested?: boolean;              // 无尽模式下玩家主动触发"下一回合即最终回合"
}

export interface MemoryAnchor {
  id: string;
  round: number;
  excerpt: string;               // 原文节选（截断）
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
