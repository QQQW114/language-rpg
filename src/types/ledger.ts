import type { Message, GameSave, GameState } from '@/types/game';
import type { LlmUsage } from '@/types/llm';
import type { WorkspaceDocument } from '@/types/workspace';

export const LEDGER_SCHEMA_VERSION = 1;

export type AgentPromptTraceMessage = {
  role: string;
  content: string;
};

export interface AgentPromptTrace {
  system?: string;
  user?: string;
  messages?: AgentPromptTraceMessage[];
  inputSummary?: string;
}

export interface AgentCallRecord {
  id: string;
  saveId: string;
  round: number;
  kind: string;
  label: string;
  input?: AgentPromptTrace;
  thinking?: string;
  output?: string;
  usage?: LlmUsage;
  cacheHit?: boolean;
  createdAt: number;
}

export interface RoundRecord {
  id: string;
  saveId: string;
  round: number;
  messages: Message[];
  agentCallIds: string[];
  beforeSnapshotId?: string;
  afterSnapshotId?: string;
  createdAt: number;
  updatedAt: number;
}

export type SnapshotLabel =
  | 'before_player_input'
  | 'before_story'
  | 'after_story'
  | 'after_decision'
  | 'manual_edit'
  | 'rollback';

export type SnapshotState = Omit<GameState, 'history' | 'agentThoughts'>;

export interface StateSnapshot {
  id: string;
  saveId: string;
  round: number;
  historyLength: number;
  label: SnapshotLabel;
  state: SnapshotState;
  createdAt: number;
}

export interface StoredGameSave {
  schemaVersion: typeof LEDGER_SCHEMA_VERSION;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  config: GameSave['config'];
  content: GameSave['content'];
  state: SnapshotState;
}

export interface LedgerExportPackage {
  kind: 'language-rpg.ledger-package';
  schemaVersion: typeof LEDGER_SCHEMA_VERSION;
  exportedAt: number;
  save: StoredGameSave;
  rounds: RoundRecord[];
  agentCalls: AgentCallRecord[];
  snapshots: StateSnapshot[];
  workspaceDocs?: WorkspaceDocument[];
  resources?: unknown;
}
