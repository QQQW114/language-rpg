import type { StoryOutline, Background, WorldBookEntry } from '@/types/content';
import type { AppSettings } from '@/types/settings';
import type { LlmUsage } from '@/types/llm';

export type JourneyModeV2 = 'author' | 'adventure';
export type NarrativePaceV2 = 'slow' | 'standard' | 'fast' | 'timeskip';
export type RandomEventIntensityV2 = 'related' | 'progress' | 'destiny';

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

export type StoryBeatStatusV2 = 'pending' | 'available' | 'active' | 'satisfied' | 'weakened' | 'reframed' | 'superseded';
export interface StoryBeatRuntimeV2 {
  beatId: string;
  status: StoryBeatStatusV2;
  currentPlan?: string;
  evidenceSummary?: string;
  evidenceTurns: number[];
  replacementBeatId?: string;
  updatedAtTurn: number;
}
export interface DestinyProgressV2 {
  completionEstimate: number;
  completionReason: string;
  currentActId: string;
  currentStage: string;
  currentPath: string;
  nextMilestone?: string;
  convergencePlan?: string;
  beats: StoryBeatRuntimeV2[];
  endingReached: boolean;
  endingReachedAtTurn?: number;
  updatedAtTurn: number;
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
export interface MessageV2 { id: string; role: 'user' | 'assistant'; content: string; turn: number; createdAt: number; }

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
  history: MessageV2[];
  summary: string;
  latestProgress?: string;
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
}

export interface TurnPatchV2 {
  schemaVersion: 2;
  commitId: string;
  baseRevision: number;
  turn: number;
  roundSummary: string;
  latestProgress: string;
  characters?: Array<{ op: 'create' | 'update'; id: string; name?: string; aliases?: string[]; role?: string; description?: string; status?: CharacterV2['status']; addFacts?: string[]; reason?: string }>;
  relationships?: Array<{ fromId: string; toId: string; affinityDelta?: number; label?: string; note?: string; reason: string }>;
  inventory?: Array<{ op: 'grant' | 'consume' | 'update' | 'remove'; id?: string; name?: string; kind?: InventoryEntryV2['kind']; quantity?: number; description?: string; consumable?: boolean; reason: string }>;
  threads?: Array<{ op: 'create' | 'update'; id: string; title?: string; kind?: StoryThreadV2['kind']; status?: StoryThreadV2['status']; progress?: number; currentStep?: string; involvedCharacterIds?: string[]; note?: string; reason?: string }>;
  facts?: Array<{ op: 'create' | 'replace'; id?: string; subjectId: string; predicate: string; value: string; scope?: CanonicalFactV2['scope']; stability?: CanonicalFactV2['stability']; confidence?: CanonicalFactV2['confidence']; keywords?: string[]; evidenceQuote?: string; reason?: string }>;
  scene?: Partial<SceneV2>;
  actions?: ChoiceV2[];
  uncertainties?: string[];
  /** 模型输出被程序安全规范化时产生的可观察警告，不进入故事权威状态。 */
  warnings?: PatchWarningV2[];
  destiny?: {
    completionEstimate?: number;
    completionReason?: string;
    currentActId?: string;
    currentStage?: string;
    currentPath?: string;
    nextMilestone?: string;
    convergencePlan?: string;
    endingReached?: boolean;
    reason: string;
    beatChanges?: Array<{ beatId: string; status: StoryBeatStatusV2; currentPlan?: string; evidenceSummary?: string; evidenceQuote?: string; replacementBeatId?: string; reason: string }>;
  };
  randomEvent?: { handled: boolean; note?: string };
  canonCheck?: {
    respectedFacts: string[];
    newInferences: string[];
    conflicts: string[];
    stopBoundaryViolated?: boolean;
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
