export type WorkspaceDocumentKind =
  | 'protagonist'
  | 'character'
  | 'relationship'
  | 'scene'
  | 'director'
  | 'world'
  | 'timeline'
  | 'foreshadowing'
  | 'memory'
  | 'audit'
  | 'inventory'
  | 'rule'
  | 'misc';

export interface WorkspaceDocumentProvenance {
  round?: number;
  agentCallId?: string;
  sourceDocIds?: string[];
  note?: string;
}

export interface WorkspaceDocument {
  id: string;
  saveId: string;
  path: string;
  title: string;
  kind: WorkspaceDocumentKind;
  content: string;
  summary?: string;
  tags: string[];
  version: number;
  updatedAtRound: number;
  createdAt: number;
  updatedAt: number;
  updatedBy: string; // human / seed / orchestrator / director / memory / settingGuard / decision / logicCheck / librarian
  archived?: boolean;
  stale?: boolean;
  provenance?: WorkspaceDocumentProvenance;
}

export interface WorkspaceDocumentManifestItem {
  id: string;
  path: string;
  title: string;
  kind: WorkspaceDocumentKind;
  summary?: string;
  tags: string[];
  version: number;
  updatedAtRound: number;
  updatedAt: number;
  updatedBy: string;
  archived?: boolean;
  stale?: boolean;
  contentBytes: number;
}

export interface WorkspaceCreateInput {
  saveId: string;
  path: string;
  title?: string;
  kind?: WorkspaceDocumentKind;
  content?: string;
  summary?: string;
  tags?: string[];
  updatedAtRound?: number;
  updatedBy?: string;
  archived?: boolean;
  stale?: boolean;
  provenance?: WorkspaceDocumentProvenance;
}

export interface WorkspacePatchInput {
  title?: string;
  kind?: WorkspaceDocumentKind;
  content?: string;
  summary?: string;
  tags?: string[];
  updatedAtRound?: number;
  updatedBy?: string;
  archived?: boolean;
  stale?: boolean;
  provenance?: WorkspaceDocumentProvenance;
}
