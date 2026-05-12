import type { AgentCallRecord, LedgerExportPackage, RoundRecord, SnapshotLabel, StateSnapshot, StoredGameSave } from '@/types/ledger';
import { LEDGER_SCHEMA_VERSION } from '@/types/ledger';
import type { AgentThought, GameSave, GameState, Message } from '@/types/game';
import { genId, nowMs } from '@/lib/utils';
import { hasCacheHit, normalizeLlmUsage } from '@/lib/llmUsage';
import type {
  WorkspaceCreateInput,
  WorkspaceDocument,
  WorkspaceDocumentKind,
  WorkspaceDocumentManifestItem,
  WorkspacePatchInput,
} from '@/types/workspace';

const DB_NAME = 'language-rpg-ledger';
const DB_VERSION = 2;

const STORE_SAVES = 'saves';
const STORE_ROUNDS = 'rounds';
const STORE_AGENT_CALLS = 'agentCalls';
const STORE_SNAPSHOTS = 'snapshots';
const STORE_WORKSPACE_DOCS = 'workspaceDocs';

let dbPromise: Promise<IDBDatabase> | undefined;

export interface SaveStorageStats {
  totalBytes: number;
  saveBytes: number;
  roundsBytes: number;
  agentCallsBytes: number;
  snapshotsBytes: number;
  workspaceBytes: number;
  roundCount: number;
  agentCallCount: number;
  snapshotCount: number;
  workspaceDocCount: number;
  browserUsageBytes?: number;
  browserQuotaBytes?: number;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function jsonBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return 0;
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_SAVES)) {
        db.createObjectStore(STORE_SAVES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_ROUNDS)) {
        const store = db.createObjectStore(STORE_ROUNDS, { keyPath: 'id' });
        store.createIndex('saveId', 'saveId', { unique: false });
        store.createIndex('saveRound', ['saveId', 'round'], { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_AGENT_CALLS)) {
        const store = db.createObjectStore(STORE_AGENT_CALLS, { keyPath: 'id' });
        store.createIndex('saveId', 'saveId', { unique: false });
        store.createIndex('saveRound', ['saveId', 'round'], { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
        const store = db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'id' });
        store.createIndex('saveId', 'saveId', { unique: false });
        store.createIndex('saveRound', ['saveId', 'round'], { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_WORKSPACE_DOCS)) {
        const store = db.createObjectStore(STORE_WORKSPACE_DOCS, { keyPath: 'id' });
        store.createIndex('saveId', 'saveId', { unique: false });
        store.createIndex('savePath', ['saveId', 'path'], { unique: true });
        store.createIndex('saveKind', ['saveId', 'kind'], { unique: false });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function getAllByIndex<T>(
  storeName: string,
  indexName: string,
  query: IDBValidKey | IDBKeyRange,
): Promise<T[]> {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readonly');
  const index = tx.objectStore(storeName).index(indexName);
  const result = await requestToPromise(index.getAll(query) as IDBRequest<T[]>);
  await txDone(tx);
  return result ?? [];
}

function toStoredSave(save: GameSave): StoredGameSave {
  const { history: _history, agentThoughts: _thoughts, ...state } = save.state;
  return {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    id: save.id,
    name: save.name,
    createdAt: save.createdAt,
    updatedAt: save.updatedAt,
    config: clone(save.config),
    content: clone(save.content),
    state: clone(state),
  };
}

function groupHistory(saveId: string, history: Message[], previous: RoundRecord[] = []): RoundRecord[] {
  const byRound = new Map<number, Message[]>();
  for (const msg of history) {
    const round = Math.max(0, Math.floor(Number(msg.round) || 0));
    const list = byRound.get(round) ?? [];
    list.push(clone(msg));
    byRound.set(round, list);
  }

  const previousByRound = new Map(previous.map((item) => [item.round, item]));
  const now = nowMs();
  return Array.from(byRound.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([round, messages]) => {
      const prev = previousByRound.get(round);
      return {
        id: prev?.id ?? `${saveId}:round:${String(round).padStart(6, '0')}`,
        saveId,
        round,
        messages,
        agentCallIds: prev?.agentCallIds ?? [],
        beforeSnapshotId: prev?.beforeSnapshotId,
        afterSnapshotId: prev?.afterSnapshotId,
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
      } satisfies RoundRecord;
    });
}

function flattenHistory(rounds: RoundRecord[]): Message[] {
  return [...rounds]
    .sort((a, b) => a.round - b.round || a.createdAt - b.createdAt)
    .flatMap((round) => round.messages ?? []);
}

function callToThought(call: AgentCallRecord): AgentThought | undefined {
  const usage = normalizeLlmUsage(call.usage);
  const content = call.thinking?.trim();
  const output = call.output?.trim();
  const cacheHit = hasCacheHit(usage, call.cacheHit);
  if (!content && !output && !call.input && !usage && !cacheHit) return undefined;
  return {
    id: call.id,
    kind: call.kind,
    label: call.label,
    round: call.round,
    content,
    output,
    prompt: call.input,
    usage,
    cacheHit,
    createdAt: call.createdAt,
  };
}

function composeSave(stored: StoredGameSave, rounds: RoundRecord[], calls: AgentCallRecord[]): GameSave {
  const history = flattenHistory(rounds);
  const agentThoughts = calls
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(callToThought)
    .filter(Boolean)
    .slice(-80) as AgentThought[];
  const state: GameState = {
    ...(clone(stored.state) as GameState),
    history,
    agentThoughts,
  };
  return {
    id: stored.id,
    name: stored.name,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    config: clone(stored.config),
    content: clone(stored.content),
    state,
  };
}

export async function putSaveMeta(save: GameSave): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_SAVES, 'readwrite');
  tx.objectStore(STORE_SAVES).put(toStoredSave(save));
  await txDone(tx);
}

export async function syncRoundsFromSave(save: GameSave): Promise<void> {
  const existing = await getRounds(save.id);
  const next = groupHistory(save.id, save.state.history ?? [], existing);
  const keep = new Set(next.map((item) => item.id));
  const db = await openDb();
  const tx = db.transaction(STORE_ROUNDS, 'readwrite');
  const store = tx.objectStore(STORE_ROUNDS);
  for (const item of existing) {
    if (!keep.has(item.id)) store.delete(item.id);
  }
  for (const item of next) {
    store.put(item);
  }
  await txDone(tx);
}

export async function persistRuntimeSave(save: GameSave): Promise<void> {
  await putSaveMeta(save);
  await syncRoundsFromSave(save);
}

export async function getRounds(saveId: string): Promise<RoundRecord[]> {
  const rounds = await getAllByIndex<RoundRecord>(STORE_ROUNDS, 'saveId', saveId);
  return rounds.sort((a, b) => a.round - b.round || a.createdAt - b.createdAt);
}

export async function getAgentCalls(saveId: string): Promise<AgentCallRecord[]> {
  const calls = await getAllByIndex<AgentCallRecord>(STORE_AGENT_CALLS, 'saveId', saveId);
  return calls.sort((a, b) => a.createdAt - b.createdAt);
}

export async function getSnapshots(saveId: string): Promise<StateSnapshot[]> {
  const snapshots = await getAllByIndex<StateSnapshot>(STORE_SNAPSHOTS, 'saveId', saveId);
  return snapshots.sort((a, b) => a.round - b.round || a.createdAt - b.createdAt);
}

function normalizeWorkspaceKind(kind: unknown): WorkspaceDocumentKind {
  const value = String(kind ?? '').trim();
  const allowed: WorkspaceDocumentKind[] = [
    'protagonist',
    'character',
    'relationship',
    'scene',
    'director',
    'world',
    'timeline',
    'foreshadowing',
    'memory',
    'audit',
    'inventory',
    'rule',
    'misc',
  ];
  return allowed.includes(value as WorkspaceDocumentKind) ? value as WorkspaceDocumentKind : 'misc';
}

export function normalizeWorkspacePath(path: string): string {
  const normalized = String(path ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
  return normalized || 'misc/untitled.md';
}

function titleFromPath(path: string): string {
  const leaf = normalizeWorkspacePath(path).split('/').pop() ?? 'untitled';
  return leaf.replace(/\.[^.]+$/, '') || leaf;
}

function normalizeTags(tags: unknown): string[] {
  const arr = Array.isArray(tags)
    ? tags
    : typeof tags === 'string'
      ? tags.split(/[,\n，、]+/)
      : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    const tag = String(item ?? '').trim().slice(0, 24);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= 24) break;
  }
  return out;
}

function normalizeWorkspaceDocument(raw: WorkspaceDocument): WorkspaceDocument {
  const path = normalizeWorkspacePath(raw.path);
  const now = nowMs();
  return {
    id: raw.id || genId('doc'),
    saveId: raw.saveId,
    path,
    title: raw.title?.trim() || titleFromPath(path),
    kind: normalizeWorkspaceKind(raw.kind),
    content: String(raw.content ?? ''),
    summary: raw.summary?.trim() || undefined,
    tags: normalizeTags(raw.tags),
    version: Math.max(1, Math.floor(Number(raw.version) || 1)),
    updatedAtRound: Math.max(0, Math.floor(Number(raw.updatedAtRound) || 0)),
    createdAt: Number(raw.createdAt) || now,
    updatedAt: Number(raw.updatedAt) || now,
    updatedBy: raw.updatedBy?.trim() || 'human',
    archived: !!raw.archived || undefined,
    stale: !!raw.stale || undefined,
    provenance: raw.provenance,
  };
}

function toWorkspaceManifestItem(doc: WorkspaceDocument): WorkspaceDocumentManifestItem {
  return {
    id: doc.id,
    path: doc.path,
    title: doc.title,
    kind: doc.kind,
    summary: doc.summary,
    tags: doc.tags ?? [],
    version: doc.version,
    updatedAtRound: doc.updatedAtRound,
    updatedAt: doc.updatedAt,
    updatedBy: doc.updatedBy,
    archived: doc.archived,
    stale: doc.stale,
    contentBytes: jsonBytes(doc.content),
  };
}

export async function getWorkspaceDocuments(saveId: string): Promise<WorkspaceDocument[]> {
  const docs = await getAllByIndex<WorkspaceDocument>(STORE_WORKSPACE_DOCS, 'saveId', saveId);
  return docs
    .map(normalizeWorkspaceDocument)
    .sort((a, b) => a.path.localeCompare(b.path, 'zh-Hans-CN'));
}

export async function getWorkspaceManifest(saveId: string): Promise<WorkspaceDocumentManifestItem[]> {
  return (await getWorkspaceDocuments(saveId)).map(toWorkspaceManifestItem);
}

export async function getWorkspaceDocumentByPath(saveId: string, path: string): Promise<WorkspaceDocument | undefined> {
  const db = await openDb();
  const tx = db.transaction(STORE_WORKSPACE_DOCS, 'readonly');
  const index = tx.objectStore(STORE_WORKSPACE_DOCS).index('savePath');
  const result = await requestToPromise(index.get([saveId, normalizeWorkspacePath(path)]) as IDBRequest<WorkspaceDocument | undefined>);
  await txDone(tx);
  return result ? normalizeWorkspaceDocument(result) : undefined;
}

export async function getWorkspaceDocumentById(id: string): Promise<WorkspaceDocument | undefined> {
  const db = await openDb();
  const tx = db.transaction(STORE_WORKSPACE_DOCS, 'readonly');
  const result = await requestToPromise(tx.objectStore(STORE_WORKSPACE_DOCS).get(id) as IDBRequest<WorkspaceDocument | undefined>);
  await txDone(tx);
  return result ? normalizeWorkspaceDocument(result) : undefined;
}

export async function putWorkspaceDocument(doc: WorkspaceDocument): Promise<WorkspaceDocument> {
  const normalized = normalizeWorkspaceDocument(doc);
  const db = await openDb();
  const tx = db.transaction(STORE_WORKSPACE_DOCS, 'readwrite');
  tx.objectStore(STORE_WORKSPACE_DOCS).put(normalized);
  await txDone(tx);
  return normalized;
}

export async function createWorkspaceDocument(input: WorkspaceCreateInput): Promise<WorkspaceDocument> {
  const path = normalizeWorkspacePath(input.path);
  const existing = await getWorkspaceDocumentByPath(input.saveId, path);
  const now = nowMs();
  if (existing) {
    return putWorkspaceDocument({
      ...existing,
      title: input.title?.trim() || existing.title,
      kind: normalizeWorkspaceKind(input.kind ?? existing.kind),
      content: input.content ?? existing.content,
      summary: input.summary?.trim() || existing.summary,
      tags: input.tags ? normalizeTags(input.tags) : existing.tags,
      updatedAtRound: Math.max(existing.updatedAtRound, Math.floor(Number(input.updatedAtRound) || 0)),
      updatedAt: now,
      updatedBy: input.updatedBy?.trim() || existing.updatedBy,
      archived: input.archived ?? existing.archived,
      stale: input.stale ?? existing.stale,
      provenance: input.provenance ?? existing.provenance,
      version: existing.version + 1,
    });
  }
  return putWorkspaceDocument({
    id: genId('doc'),
    saveId: input.saveId,
    path,
    title: input.title?.trim() || titleFromPath(path),
    kind: normalizeWorkspaceKind(input.kind),
    content: input.content ?? '',
    summary: input.summary?.trim() || undefined,
    tags: normalizeTags(input.tags),
    version: 1,
    updatedAtRound: Math.max(0, Math.floor(Number(input.updatedAtRound) || 0)),
    createdAt: now,
    updatedAt: now,
    updatedBy: input.updatedBy?.trim() || 'human',
    archived: input.archived,
    stale: input.stale,
    provenance: input.provenance,
  });
}

export async function patchWorkspaceDocument(id: string, patch: WorkspacePatchInput): Promise<WorkspaceDocument | undefined> {
  const existing = await getWorkspaceDocumentById(id);
  if (!existing) return undefined;
  const now = nowMs();
  return putWorkspaceDocument({
    ...existing,
    title: patch.title?.trim() || existing.title,
    kind: patch.kind ? normalizeWorkspaceKind(patch.kind) : existing.kind,
    content: patch.content ?? existing.content,
    summary: patch.summary !== undefined ? patch.summary.trim() || undefined : existing.summary,
    tags: patch.tags ? normalizeTags(patch.tags) : existing.tags,
    updatedAtRound: patch.updatedAtRound !== undefined
      ? Math.max(0, Math.floor(Number(patch.updatedAtRound) || 0))
      : existing.updatedAtRound,
    updatedAt: now,
    updatedBy: patch.updatedBy?.trim() || existing.updatedBy,
    archived: patch.archived ?? existing.archived,
    stale: patch.stale ?? existing.stale,
    provenance: patch.provenance ?? existing.provenance,
    version: existing.version + 1,
  });
}

export async function deleteWorkspaceDocument(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_WORKSPACE_DOCS, 'readwrite');
  tx.objectStore(STORE_WORKSPACE_DOCS).delete(id);
  await txDone(tx);
}

export async function deleteWorkspaceDocuments(saveId: string): Promise<void> {
  const docs = await getWorkspaceDocuments(saveId);
  const db = await openDb();
  const tx = db.transaction(STORE_WORKSPACE_DOCS, 'readwrite');
  const store = tx.objectStore(STORE_WORKSPACE_DOCS);
  for (const doc of docs) store.delete(doc.id);
  await txDone(tx);
}

export async function searchWorkspaceDocuments(saveId: string, query: string, limit = 20): Promise<WorkspaceDocument[]> {
  const q = query.trim().toLowerCase();
  const docs = await getWorkspaceDocuments(saveId);
  if (!q) return docs.filter((doc) => !doc.archived).slice(0, limit);
  const terms = q.split(/\s+/).filter(Boolean);
  return docs
    .filter((doc) => {
      if (doc.archived) return false;
      const hay = [
        doc.path,
        doc.title,
        doc.kind,
        doc.summary ?? '',
        ...(doc.tags ?? []),
        doc.content,
      ].join('\n').toLowerCase();
      return terms.every((term) => hay.includes(term));
    })
    .slice(0, Math.max(1, limit));
}

export async function loadAllSaves(): Promise<GameSave[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_SAVES, 'readonly');
  const stored = await requestToPromise(tx.objectStore(STORE_SAVES).getAll() as IDBRequest<StoredGameSave[]>);
  await txDone(tx);

  const saves: GameSave[] = [];
  for (const item of stored ?? []) {
    if (item.schemaVersion !== LEDGER_SCHEMA_VERSION) continue;
    const [rounds, calls] = await Promise.all([
      getRounds(item.id),
      getAgentCalls(item.id),
    ]);
    saves.push(composeSave(item, rounds, calls));
  }
  return saves.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteSaveData(saveId: string): Promise<void> {
  const [rounds, calls, snapshots, workspaceDocs] = await Promise.all([
    getRounds(saveId),
    getAgentCalls(saveId),
    getSnapshots(saveId),
    getWorkspaceDocuments(saveId),
  ]);
  const db = await openDb();
  const tx = db.transaction([STORE_SAVES, STORE_ROUNDS, STORE_AGENT_CALLS, STORE_SNAPSHOTS, STORE_WORKSPACE_DOCS], 'readwrite');
  tx.objectStore(STORE_SAVES).delete(saveId);
  for (const round of rounds) tx.objectStore(STORE_ROUNDS).delete(round.id);
  for (const call of calls) tx.objectStore(STORE_AGENT_CALLS).delete(call.id);
  for (const snapshot of snapshots) tx.objectStore(STORE_SNAPSHOTS).delete(snapshot.id);
  for (const doc of workspaceDocs) tx.objectStore(STORE_WORKSPACE_DOCS).delete(doc.id);
  await txDone(tx);
}

export async function addAgentCall(saveId: string, thought: AgentThought): Promise<AgentCallRecord> {
  const usage = normalizeLlmUsage(thought.usage);
  const record: AgentCallRecord = {
    id: thought.id,
    saveId,
    round: thought.round,
    kind: thought.kind,
    label: thought.label,
    thinking: thought.content,
    output: thought.output,
    input: thought.prompt,
    usage,
    cacheHit: hasCacheHit(usage, thought.cacheHit),
    createdAt: thought.createdAt,
  };

  const rounds = await getRounds(saveId);
  const round = rounds.find((item) => item.round === record.round);
  const db = await openDb();
  const tx = db.transaction([STORE_AGENT_CALLS, STORE_ROUNDS], 'readwrite');
  tx.objectStore(STORE_AGENT_CALLS).put(record);
  if (round) {
    tx.objectStore(STORE_ROUNDS).put({
      ...round,
      agentCallIds: Array.from(new Set([...(round.agentCallIds ?? []), record.id])),
      updatedAt: nowMs(),
    } satisfies RoundRecord);
  }
  await txDone(tx);
  return record;
}

export async function captureSnapshot(save: GameSave, label: SnapshotLabel, round = save.state.currentRound): Promise<StateSnapshot> {
  const { history: _history, agentThoughts: _thoughts, ...state } = save.state;
  const rounds = await getRounds(save.id);
  const snapshot: StateSnapshot = {
    id: genId('snap'),
    saveId: save.id,
    round: Math.max(0, Math.floor(Number(round) || 0)),
    historyLength: save.state.history.length,
    label,
    state: clone(state),
    createdAt: nowMs(),
  };
  const db = await openDb();
  const tx = db.transaction([STORE_SNAPSHOTS, STORE_ROUNDS], 'readwrite');
  tx.objectStore(STORE_SNAPSHOTS).put(snapshot);
  const rr = rounds.find((item) => item.round === snapshot.round);
  if (rr) {
    tx.objectStore(STORE_ROUNDS).put({
      ...rr,
      beforeSnapshotId: label === 'before_story' || label === 'before_player_input'
        ? snapshot.id
        : rr.beforeSnapshotId,
      afterSnapshotId: label === 'after_story' || label === 'after_decision'
        ? snapshot.id
        : rr.afterSnapshotId,
      updatedAt: nowMs(),
    } satisfies RoundRecord);
  }
  await txDone(tx);
  await pruneSnapshotsBefore(save.id, Math.max(0, snapshot.round - 1));
  return snapshot;
}

async function pruneSnapshotsBefore(saveId: string, minRound: number): Promise<void> {
  const snapshots = await getSnapshots(saveId);
  const old = snapshots.filter((item) => item.round < minRound);
  if (!old.length) return;
  const db = await openDb();
  const tx = db.transaction(STORE_SNAPSHOTS, 'readwrite');
  const store = tx.objectStore(STORE_SNAPSHOTS);
  for (const item of old) store.delete(item.id);
  await txDone(tx);
}

export async function findRollbackSnapshot(saveId: string, round: number, preferred?: SnapshotLabel[]): Promise<StateSnapshot | undefined> {
  const targetRound = Math.max(0, Math.floor(Number(round) || 0));
  const snapshots = await getSnapshots(saveId);
  const candidates = snapshots
    .filter((item) => item.round === targetRound)
    .sort((a, b) => b.round - a.round || b.createdAt - a.createdAt);
  if (preferred?.length) {
    const pref = candidates.find((item) => preferred.includes(item.label));
    if (pref) return pref;
  }
  return candidates[0];
}

export async function restoreSnapshotState(save: GameSave, snapshot: StateSnapshot): Promise<GameSave> {
  const rounds = await getRounds(save.id);
  const history = flattenHistory(rounds).slice(0, snapshot.historyLength);
  const calls = (await getAgentCalls(save.id)).filter((call) => call.round <= snapshot.round);
  return {
    ...save,
    updatedAt: nowMs(),
    state: {
      ...(clone(snapshot.state) as GameState),
      history,
      agentThoughts: calls.map(callToThought).filter(Boolean).slice(-80) as AgentThought[],
    },
  };
}

export async function pruneAfter(saveId: string, round: number, inclusive = false): Promise<void> {
  const [rounds, calls, snapshots, workspaceDocs] = await Promise.all([
    getRounds(saveId),
    getAgentCalls(saveId),
    getSnapshots(saveId),
    getWorkspaceDocuments(saveId),
  ]);
  const db = await openDb();
  const tx = db.transaction([STORE_ROUNDS, STORE_AGENT_CALLS, STORE_SNAPSHOTS, STORE_WORKSPACE_DOCS], 'readwrite');
  const shouldDelete = (itemRound: number) => inclusive ? itemRound >= round : itemRound > round;
  for (const item of rounds) {
    if (shouldDelete(item.round)) tx.objectStore(STORE_ROUNDS).delete(item.id);
  }
  for (const item of calls) {
    if (shouldDelete(item.round)) tx.objectStore(STORE_AGENT_CALLS).delete(item.id);
  }
  for (const item of snapshots) {
    if (shouldDelete(item.round)) tx.objectStore(STORE_SNAPSHOTS).delete(item.id);
  }
  for (const doc of workspaceDocs) {
    if (doc.updatedBy === 'human') continue;
    if (shouldDelete(doc.updatedAtRound)) tx.objectStore(STORE_WORKSPACE_DOCS).delete(doc.id);
  }
  await txDone(tx);
}

export async function buildLedgerExportPackage(save: GameSave): Promise<LedgerExportPackage> {
  const [rounds, agentCalls, snapshots, workspaceDocs] = await Promise.all([
    getRounds(save.id),
    getAgentCalls(save.id),
    getSnapshots(save.id),
    getWorkspaceDocuments(save.id),
  ]);
  return {
    kind: 'language-rpg.ledger-package',
    schemaVersion: LEDGER_SCHEMA_VERSION,
    exportedAt: nowMs(),
    save: toStoredSave(save),
    rounds,
    agentCalls,
    snapshots,
    workspaceDocs,
  };
}

export async function getSaveStorageStats(save: GameSave): Promise<SaveStorageStats> {
  const [rounds, agentCalls, snapshots, workspaceDocs, storageEstimate] = await Promise.all([
    getRounds(save.id),
    getAgentCalls(save.id),
    getSnapshots(save.id),
    getWorkspaceDocuments(save.id),
    navigator.storage?.estimate?.().catch(() => undefined),
  ]);
  const saveBytes = jsonBytes(toStoredSave(save));
  const roundsBytes = jsonBytes(rounds);
  const agentCallsBytes = jsonBytes(agentCalls);
  const snapshotsBytes = jsonBytes(snapshots);
  const workspaceBytes = jsonBytes(workspaceDocs);
  return {
    totalBytes: saveBytes + roundsBytes + agentCallsBytes + snapshotsBytes + workspaceBytes,
    saveBytes,
    roundsBytes,
    agentCallsBytes,
    snapshotsBytes,
    workspaceBytes,
    roundCount: rounds.length,
    agentCallCount: agentCalls.length,
    snapshotCount: snapshots.length,
    workspaceDocCount: workspaceDocs.length,
    browserUsageBytes: storageEstimate?.usage,
    browserQuotaBytes: storageEstimate?.quota,
  };
}

export async function importLedgerPackage(pkg: LedgerExportPackage): Promise<GameSave> {
  if (pkg.kind !== 'language-rpg.ledger-package' || pkg.schemaVersion !== LEDGER_SCHEMA_VERSION) {
    throw new Error('不支持的旅程卷宗格式。');
  }
  const oldSaveId = pkg.save.id;
  const saveId = genId('save');
  const now = nowMs();
  const save: StoredGameSave = {
    ...clone(pkg.save),
    id: saveId,
    name: pkg.save.name?.endsWith('（导入）') ? pkg.save.name : `${pkg.save.name || '导入旅程'}（导入）`,
    createdAt: now,
    updatedAt: now,
  };

  const callIdMap = new Map<string, string>();
  const snapshotIdMap = new Map<string, string>();
  for (const call of pkg.agentCalls ?? []) callIdMap.set(call.id, genId('call'));
  for (const snapshot of pkg.snapshots ?? []) snapshotIdMap.set(snapshot.id, genId('snap'));

  const rounds = (pkg.rounds ?? []).map((round) => ({
    ...round,
    id: genId('round'),
    saveId,
    agentCallIds: (round.agentCallIds ?? []).map((id) => callIdMap.get(id) ?? id),
    beforeSnapshotId: round.beforeSnapshotId ? snapshotIdMap.get(round.beforeSnapshotId) ?? round.beforeSnapshotId : undefined,
    afterSnapshotId: round.afterSnapshotId ? snapshotIdMap.get(round.afterSnapshotId) ?? round.afterSnapshotId : undefined,
    createdAt: Number(round.createdAt) || now,
    updatedAt: now,
  } satisfies RoundRecord));
  const agentCalls = (pkg.agentCalls ?? []).map((call) => ({
    ...call,
    id: callIdMap.get(call.id) ?? genId('call'),
    saveId,
    createdAt: Number(call.createdAt) || now,
  } satisfies AgentCallRecord));
  const snapshots = (pkg.snapshots ?? []).map((snapshot) => ({
    ...snapshot,
    id: snapshotIdMap.get(snapshot.id) ?? genId('snap'),
    saveId,
    createdAt: Number(snapshot.createdAt) || now,
  } satisfies StateSnapshot));
  const workspaceDocs = (pkg.workspaceDocs ?? []).map((doc) => normalizeWorkspaceDocument({
    ...doc,
    id: genId('doc'),
    saveId,
    createdAt: Number(doc.createdAt) || now,
    updatedAt: Number(doc.updatedAt) || now,
  }));

  const db = await openDb();
  const tx = db.transaction([STORE_SAVES, STORE_ROUNDS, STORE_AGENT_CALLS, STORE_SNAPSHOTS, STORE_WORKSPACE_DOCS], 'readwrite');
  tx.objectStore(STORE_SAVES).put(save);
  for (const item of rounds) tx.objectStore(STORE_ROUNDS).put(item);
  for (const item of agentCalls) tx.objectStore(STORE_AGENT_CALLS).put(item);
  for (const item of snapshots) tx.objectStore(STORE_SNAPSHOTS).put(item);
  for (const item of workspaceDocs) tx.objectStore(STORE_WORKSPACE_DOCS).put(item);
  await txDone(tx);
  const [loadedRounds, calls] = await Promise.all([getRounds(saveId), getAgentCalls(saveId)]);
  console.info('[ledger] imported package', { oldSaveId, saveId });
  return composeSave(save, loadedRounds, calls);
}
