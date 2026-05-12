import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  GameSave,
  GameState,
  GameConfig,
  GameContent,
  Message,
  Choice,
  GamePhase,
  Item,
  AdventureReview,
  Npc,
  NpcUpdateRaw,
  MemoryAnchor,
  SceneRef,
  AuthorNarrativeState,
  AuthorRandomEventState,
  StoryArc,
  AuthorLogicReviewState,
  AuthorLogicIssue,
  SettingGuardAmbientBeat,
  SettingGuardCandidate,
  SettingGuardDeviation,
  SettingGuardPreference,
  SettingGuardState,
  SettingPatch,
  MasterArcState,
  NarrativeStage,
  NarrativeStageBeat,
  StageJudgeState,
  AgentThought,
  OrchestratorCallKey,
  OrchestratorState,
  OrchestratorFocusArea,
  OrchestratorPlanSignal,
  OrchestratorDirectorMode,
  OrchestratorPlanningMode,
  OrchestratorTurnType,
  NarrativeEventLifecycle,
  NarrativeEventUpdate,
  OutlineMappingAlignment,
  OutlineMappingState,
  NarrativeBriefCharacter,
  NarrativeBriefEvent,
  NarrativeBriefScene,
  AuthorCharacterPlanState,
  AuthorScenePlanState,
  AuthorEventPlanState,
  EventBeatState,
  EventBeatVerdict,
  OrchestratorPhase1Result,
} from '@/types/game';
import type { SettingGuardResult } from '@/services/authorSettingGuardAgent';
import type { StageJudgeResult } from '@/services/authorStageJudgeAgent';
import { clamp, genId, nowMs } from '@/lib/utils';
import { createItem, type RawGrant, type RawDestroy, type RawItemPatch } from '@/lib/items';
import { useContentStore } from '@/store/useContentStore';
import {
  normalizeAuthorMasterArcConfig,
  normalizeAuthorEventBeatConfig,
  normalizeAuthorOrchestratorConfig,
  normalizeAuthorSettingGuardConfig,
  normalizeAuthorStageJudgeConfig,
} from '@/lib/authorMode';
import { hasCacheHit, normalizeLlmUsage } from '@/lib/llmUsage';
import {
  addAgentCall,
  captureSnapshot as persistSnapshot,
  deleteSaveData,
  loadAllSaves,
  persistRuntimeSave,
  putSaveMeta,
  findRollbackSnapshot,
  pruneAfter,
  restoreSnapshotState,
  syncRoundsFromSave,
} from '@/storage/ledgerRepository';
import type { SnapshotLabel } from '@/types/ledger';
import type { AgentPromptTrace } from '@/types/ledger';

const SETTING_GUARD_CANDIDATE_LIMIT = 24;

interface GameStoreState {
  saves: Record<string, GameSave>;
  activeSaveId?: string;
  ledgerHydrated: boolean;

  hydrateFromLedger: () => Promise<void>;
  createSave: (p: {
    name?: string;
    config: GameConfig;
    content: GameContent;
    initialScene?: string;      // 开局文本，会作为第 0 轮 assistant 消息
    initialItems?: Item[];      // 出身自带的能力
  }) => string;
  importSave: (save: GameSave) => string;
  setActive: (id: string | undefined) => void;
  deleteSave: (id: string) => void;
  renameSave: (id: string, name: string) => void;
  updateContentOf: (id: string, patch: Partial<GameContent>) => void;
  updateStateOf: (id: string, patch: Partial<GameState>) => void;
  replaceState: (id: string, updater: (prev: GameState) => GameState) => void;
  captureSnapshot: (id: string, label: SnapshotLabel, round?: number) => void;
  setLongTermMemory: (id: string, memory: string, round: number) => void;
  appendMessage: (id: string, msg: Message) => void;
  updateAssistantRuntimeStats: (id: string, round: number, patch: Pick<Message, 'toolEvents' | 'runtimeStats'>) => void;
  addAgentThought: (id: string, thought: Omit<AgentThought, 'id' | 'createdAt'> & { id?: string; createdAt?: number }) => void;
  updateMessage: (id: string, historyIndex: number, content: string) => void;
  deleteMessage: (id: string, historyIndex: number) => void;
  updateAssistantMessage: (id: string, historyIndex: number, content: string) => void;
  regenerateAssistantMessage: (id: string, historyIndex: number, hint?: string) => void;
  rollbackEditMessage: (id: string, historyIndex: number, content: string) => void;
  rollbackDeleteMessage: (id: string, historyIndex: number) => void;
  rollbackRegenerateAssistant: (id: string, historyIndex: number, hint?: string) => void;
  setPhase: (id: string, phase: GamePhase) => void;
  setChoices: (id: string, choices?: Choice[]) => void;
  setLastPlayerInput: (id: string, text?: string) => void;
  incrementRound: (id: string) => void;
  addTriggeredEvent: (id: string, evId: string, round: number) => void;
  endGame: (id: string, ending: string) => void;
  setError: (id: string, error?: string) => void;
  grantRefresh: (id: string, amount?: number) => void;
  consumeRefresh: (id: string) => boolean;     // 返回是否成功消耗

  // ---- 能力 ----
  applyDecisionResult: (id: string, grantKey: string, grants: RawGrant[], destroys: RawDestroy[], itemPatches: RawItemPatch[], round: number) => RawDestroy[];
  commitPendingGrants: (id: string) => void;     // 固化 grants + 移除 pendingDestroy 项
  toggleSelectItem: (id: string, itemId: string) => void;
  clearSelectedItems: (id: string) => void;
  consumeSelectedConsumables: (id: string) => Item[];
  discardItems: (id: string, itemIds: string[]) => void;

  // ---- 评分 ----
  setReview: (id: string, review: AdventureReview) => void;

  // ---- 无尽模式 · 完结旅程 ----
  requestFinalize: (id: string) => void;
  clearFinalize: (id: string) => void;

  // ---- NPC 关系 ----
  applyNpcUpdates: (id: string, updates: NpcUpdateRaw[], round: number) => void;

  // ---- 场景 ----
  setScenes: (id: string, current: SceneRef | undefined, available: SceneRef[]) => void;

  // ---- 执笔模式 · 叙事弧 / 动态事件弧 ----
  setAuthorNarrativeState: (id: string, state: AuthorNarrativeState) => void;
  setAuthorRandomEventState: (id: string, state: AuthorRandomEventState) => void;
  setPendingAuthorEvent: (id: string, arc: StoryArc, pendingForRound: number, resetProbability?: number) => void;
  activatePendingAuthorEvent: (id: string, round: number) => StoryArc | undefined;
  upsertAuthorArc: (id: string, arc: StoryArc) => void;
  completeAuthorArc: (id: string, arcId: string, round?: number) => void;
  advanceAuthorArcs: (id: string, currentRound: number) => void;
  applyAuthorEventUpdates: (id: string, updates: NarrativeEventUpdate[], round?: number) => void;
  applySettingGuardResult: (id: string, result: SettingGuardResult, completedRound: number) => void;
  acceptSettingCandidate: (id: string, candidateId: string) => void;
  rejectSettingCandidate: (id: string, candidateId: string) => void;
  deleteSettingCandidate: (id: string, candidateId: string) => void;
  markAmbientBeatConsumed: (id: string, beatId: string) => void;
  expireOldAmbientBeats: (id: string, currentRound: number, maxAge?: number) => void;
  clearSettingGuardDeviation: (id: string) => void;
  setSettingGuardError: (id: string, error: string | undefined) => void;
  setMasterArc: (id: string, masterArc: MasterArcState | undefined) => void;
  advanceMasterArcStage: (id: string, reason?: string) => void;
  markStageBeatAchieved: (id: string, beatId: string, round?: number) => void;
  applyStageJudgeResult: (id: string, result: StageJudgeResult, completedRound: number) => void;
  setStageJudgeError: (id: string, error: string | undefined) => void;
  setOrchestratorState: (id: string, state: OrchestratorState) => void;
  setOrchestratorError: (id: string, error: string | undefined) => void;
  setAuthorOutlineMapping: (id: string, state: OutlineMappingState | undefined, round?: number) => void;
  setAuthorCharacterPlan: (id: string, state: AuthorCharacterPlanState | undefined, round?: number) => void;
  setAuthorScenePlan: (id: string, state: AuthorScenePlanState | undefined, round?: number) => void;
  setAuthorEventPlan: (id: string, state: AuthorEventPlanState | undefined, round?: number) => void;
  setAuthorEventBeat: (id: string, state: EventBeatState | undefined, round?: number) => void;

  // ---- 记忆锚点 ----
  addAnchor: (id: string, anchor: Omit<MemoryAnchor, 'id' | 'createdAt'>) => void;
  removeAnchor: (id: string, anchorId: string) => void;
  updateAnchorNote: (id: string, anchorId: string, note: string) => void;
}

function touch(save: GameSave, patch: Partial<GameSave>): GameSave {
  return { ...save, ...patch, updatedAt: nowMs() };
}

function reportLedgerError(action: string, err: unknown): void {
  console.warn(`[ledger] ${action} failed`, err);
}

function persistMetaSoon(save: GameSave): void {
  void putSaveMeta(save).catch((err) => reportLedgerError('putSaveMeta', err));
}

function persistRuntimeSoon(save: GameSave): void {
  void persistRuntimeSave(save).catch((err) => reportLedgerError('persistRuntimeSave', err));
}

function canRollbackRound(save: GameSave, round: number): boolean {
  const currentRound = Math.max(0, Math.floor(Number(save.state.currentRound) || 0));
  const targetRound = Math.max(0, Math.floor(Number(round) || 0));
  return targetRound >= Math.max(0, currentRound - 1) && targetRound <= currentRound;
}

function isLegacyAuthorSave(save: GameSave): boolean {
  return save.content?.mode === 'author' && !save.state?.authorNarrative?.masterArc;
}

function markLegacyEnded(save: GameSave): GameSave {
  if (!isLegacyAuthorSave(save)) return save;
  return {
    ...save,
    state: {
      ...save.state,
      phase: 'ended',
      error: '此存档创建于阶段化叙事之前，不再支持继续游玩。请创建新旅程。',
      ending: save.state.ending || '旧版执笔模式存档已标记为不可继续。',
    },
  };
}

function latestAssistantIndex(history: Message[]): number {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'assistant') return i;
  }
  return -1;
}

function latestUserContent(history: Message[]): string | undefined {
  return [...history].reverse().find((m) => m.role === 'user')?.content;
}

function phaseAfterAssistant(config: GameConfig, round: number): GamePhase {
  const afterRound = round + 1;
  if ((config.totalRounds ?? 0) > 0 && afterRound >= config.totalRounds) return 'ended';
  return afterRound % Math.max(config.manualInputEvery, 1) === 0 ? 'manual' : 'choices';
}

function clearPendingDecisionItems(
  state: GameState,
  capacity: number,
): Pick<GameState, 'backpack' | 'selectedItemIds' | 'needsDiscard'> {
  const backpack = (state.backpack ?? [])
    .filter((it) => !it.pendingGrantKey)
    .map((it) => (it.pendingDestroy ? { ...it, pendingDestroy: undefined, destroyReason: undefined } : it));
  const validIds = new Set(backpack.map((it) => it.id));
  const selectedItemIds = (state.selectedItemIds ?? []).filter((id) => validIds.has(id));
  const needsDiscard = Math.max(0, backpack.length - capacity);
  return { backpack, selectedItemIds, needsDiscard };
}

function normalizeScene(sc: SceneRef): SceneRef | undefined {
  const name = sc.name?.trim();
  if (!name) return undefined;
  const description = sc.description?.trim();
  const time = sc.time?.trim();
  const weather = sc.weather?.trim();
  return {
    name,
    description: description || undefined,
    time: time || undefined,
    weather: weather || undefined,
  };
}

function mergeScenes(history: SceneRef[], scenes: Array<SceneRef | undefined>): SceneRef[] {
  const byName = new Map<string, SceneRef>();
  for (const item of history ?? []) {
    const sc = normalizeScene(item);
    if (sc) byName.set(sc.name, sc);
  }
  for (const item of scenes) {
    if (!item) continue;
    const sc = normalizeScene(item);
    if (!sc) continue;
    const prev = byName.get(sc.name);
    byName.set(sc.name, {
      name: sc.name,
      description: sc.description || prev?.description,
      time: sc.time || prev?.time,
      weather: sc.weather || prev?.weather,
    });
  }
  return Array.from(byName.values()).slice(-40);
}

function findItemIndex(items: Item[], ref: { id?: string; name?: string }): number {
  const id = ref.id?.trim();
  if (id) {
    const idx = items.findIndex((it) => it.id === id);
    if (idx >= 0) return idx;
  }
  const name = ref.name?.trim();
  if (name) {
    return items.findIndex((it) => it.name.trim() === name);
  }
  return -1;
}

function markItemPendingDestroy(
  items: Item[],
  ref: { id?: string; name?: string; reason?: string },
  appliedDestroys: RawDestroy[],
): void {
  const idx = findItemIndex(items, ref);
  if (idx < 0 || items[idx].pendingDestroy) return;
  const reason = ref.reason?.trim().slice(0, 80) || undefined;
  items[idx] = { ...items[idx], pendingDestroy: true, destroyReason: reason };
  appliedDestroys.push({ id: items[idx].id, name: items[idx].name, reason });
}

function applyItemPatches(items: Item[], patches: RawItemPatch[], appliedDestroys: RawDestroy[]): Item[] {
  if (!patches?.length) return items;
  const next = [...items];
  for (const patch of patches.slice(0, 6)) {
    const idx = findItemIndex(next, patch);
    if (idx < 0) continue;
    if (patch.action === 'delete') {
      markItemPendingDestroy(next, patch, appliedDestroys);
      continue;
    }

    const name = patch.name?.trim().slice(0, 20);
    const description = patch.description?.trim().slice(0, 160);
    const type = patch.type === 'consumable' || patch.type === 'reusable' ? patch.type : undefined;
    if (!name && !description && !type) continue;
    next[idx] = {
      ...next[idx],
      name: name || next[idx].name,
      description: description || next[idx].description,
      type: type || next[idx].type,
    };
  }
  return next;
}

function firstUniqueNpcIndex(npcs: Npc[], predicate: (npc: Npc) => boolean): number {
  const matches = npcs
    .map((npc, index) => ({ npc, index }))
    .filter(({ npc }) => predicate(npc));
  return matches.length === 1 ? matches[0].index : -1;
}

function findNpcIndex(npcs: Npc[], ref: { id?: string; name?: string; role?: string }): number {
  const id = ref.id?.trim();
  if (id) {
    const idx = npcs.findIndex((n) => n.id === id);
    if (idx >= 0) return idx;
  }
  const name = ref.name?.trim();
  if (name) {
    const idx = npcs.findIndex((n) => n.name.trim() === name);
    if (idx >= 0) return idx;
    const byExistingRole = firstUniqueNpcIndex(npcs, (n) => n.role?.trim() === name);
    if (byExistingRole >= 0) return byExistingRole;
  }
  const role = ref.role?.trim();
  if (role) {
    const byRoleOrName = firstUniqueNpcIndex(npcs, (n) =>
      n.name.trim() === role || n.role?.trim() === role,
    );
    if (byRoleOrName >= 0) return byRoleOrName;
  }
  return -1;
}

function normalizeNpcAffinity(base: number, direct?: number, delta?: number): number {
  const hasDirect = Number.isFinite(direct);
  const directValue = hasDirect ? Math.round(direct as number) : base;
  const deltaValue = Number.isFinite(delta) ? Math.round(delta as number) : 0;
  return clamp(directValue + deltaValue, -100, 100);
}

const NPC_DETAILS_LIMIT = 5;

function normalizeNpcDetails(raw: unknown): string[] {
  const arr = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(/[;；、\n]/)
      : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    const text = String(item ?? '').trim().slice(0, 48);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= NPC_DETAILS_LIMIT) break;
  }
  return out;
}

// details 合并语义：模型输出是 PATCH（仅本回合新增/修订/替换的细节）。
// - replace=true：用新 details 完全替换旧 details（截到上限）。
// - replace=false（默认）：新 details 占据前列，旧 details 补足剩余空位；保证不超过 NPC_DETAILS_LIMIT 条。
// - 模型本回合未输出 details：完整保留旧 details（截到上限）。
function mergeNpcDetails(prev: string[] | undefined, incoming: string[] | undefined, replace?: boolean): string[] | undefined {
  const next = normalizeNpcDetails(incoming);
  if (replace) return next.length ? next : undefined;
  if (!next.length) {
    const kept = normalizeNpcDetails(prev);
    return kept.length ? kept : undefined;
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const d of next) {
    if (seen.has(d)) continue;
    seen.add(d);
    result.push(d);
    if (result.length >= NPC_DETAILS_LIMIT) return result;
  }
  for (const raw of prev ?? []) {
    const text = String(raw ?? '').trim().slice(0, 48);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
    if (result.length >= NPC_DETAILS_LIMIT) break;
  }
  return result.length ? result : undefined;
}

function normalizeAnchors(rawAnchors: unknown, history: Message[] | undefined): MemoryAnchor[] {
  if (!Array.isArray(rawAnchors)) return [];
  const historyByRound = new Map<number, Message>();
  for (const msg of history ?? []) {
    if (msg.role === 'assistant') historyByRound.set(msg.round, msg);
  }

  const out: MemoryAnchor[] = [];
  for (const raw of rawAnchors) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Partial<MemoryAnchor>;
    const round = Math.floor(Number(item.round));
    if (!Number.isFinite(round)) continue;
    const restored = historyByRound.get(round)?.content?.trim() || '';
    const content = item.content?.trim() || restored || item.excerpt?.trim() || '';
    const excerpt = item.excerpt?.trim() || content.slice(0, 160);
    if (!content && !excerpt) continue;
    out.push({
      id: item.id || genId('anc'),
      round,
      excerpt: excerpt.slice(0, 160),
      content,
      note: item.note?.trim() || undefined,
      createdAt: Number(item.createdAt) || nowMs(),
    });
  }
  return out;
}

function emptyAuthorNarrativeState(): AuthorNarrativeState {
  return {
    activeArcs: [],
    completedArcs: [],
  };
}

function emptyAuthorRandomEventState(): AuthorRandomEventState {
  return {
    activeEvents: [],
    completedEvents: [],
    currentProbability: 0,
  };
}

function normalizeAgentThoughts(raw: unknown): AgentThought[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(-80).map((item, index) => {
    const obj = item && typeof item === 'object' ? item as Partial<AgentThought> : {};
    const content = String(obj.content ?? '').trim().slice(0, 12000);
    const output = String(obj.output ?? '').trim().slice(0, 16000);
    const usage = normalizeLlmUsage(obj.usage);
    const cacheHit = hasCacheHit(usage, obj.cacheHit);
    if (!content && !output && !usage && !cacheHit) return undefined;
    return {
      id: obj.id || genId(`thought_${index}`),
      kind: String(obj.kind ?? 'model').trim().slice(0, 40) || 'model',
      label: String(obj.label ?? '模型').trim().slice(0, 40) || '模型',
      round: Math.max(0, Math.floor(Number(obj.round) || 0)),
      content: content || undefined,
      output: output || undefined,
      prompt: normalizePromptTrace(obj.prompt),
      usage,
      cacheHit,
      createdAt: Number(obj.createdAt) || nowMs(),
    } satisfies AgentThought;
  }).filter(Boolean) as AgentThought[];
}

function normalizePromptTrace(raw: unknown): AgentPromptTrace | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as AgentPromptTrace;
  const clip = (text: unknown, max: number) => {
    const value = typeof text === 'string' ? text.trim() : '';
    return value ? value.slice(0, max) : undefined;
  };
  const messages = Array.isArray(obj.messages)
    ? obj.messages.slice(-60).map((m) => ({
      role: String((m as any).role ?? '').slice(0, 20) || 'user',
      content: clip((m as any).content, 32000) ?? '',
    })).filter((m) => m.content)
    : undefined;
  const system = clip(obj.system, 24000);
  const user = clip(obj.user, 32000);
  const inputSummary = clip(obj.inputSummary, 500);
  if (!system && !user && !messages?.length && !inputSummary) return undefined;
  return { system, user, messages, inputSummary };
}

const NARRATIVE_EVENT_LIFECYCLES: NarrativeEventLifecycle[] = [
  'candidate',
  'active',
  'progressing',
  'turning',
  'completed',
  'soft_failed',
  'missed',
  'delayed',
  'reframed',
  'archived',
];

function normalizeStringList(raw: unknown, maxItems: number, maxChars: number): string[] | undefined {
  const arr = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(/[;；、\n]/)
      : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    const text = String(item ?? '').trim().slice(0, maxChars);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out.length ? out : undefined;
}

function normalizeStoryArc(raw: unknown): StoryArc | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Partial<StoryArc>;
  const title = obj.title?.trim();
  const summary = obj.summary?.trim();
  const directive = obj.directive?.trim();
  if (!title || !directive) return undefined;
  const startRound = Math.max(1, Math.floor(Number(obj.startRound) || 1));
  const targetEndRound = Number.isFinite(obj.targetEndRound)
    ? Math.max(startRound, Math.floor(Number(obj.targetEndRound)))
    : undefined;
  const lifecycle = NARRATIVE_EVENT_LIFECYCLES.includes(obj.lifecycle as NarrativeEventLifecycle)
    ? obj.lifecycle as NarrativeEventLifecycle
    : undefined;
  const relationshipDeltas = Array.isArray(obj.relationshipDeltas)
    ? obj.relationshipDeltas.slice(0, 10).map((item) => {
      const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const npcId = String(row.npcId ?? '').trim().slice(0, 40);
      const npcName = String(row.npcName ?? '').trim().slice(0, 30);
      if (!npcId && !npcName) return undefined;
      const affinityDelta = Number(row.affinityDelta);
      const trustDelta = Number(row.trustDelta);
      return {
        npcId: npcId || undefined,
        npcName: npcName || undefined,
        affinityDelta: Number.isFinite(affinityDelta) ? clamp(Math.round(affinityDelta), -100, 100) : undefined,
        trustDelta: Number.isFinite(trustDelta) ? clamp(Math.round(trustDelta), -100, 100) : undefined,
        note: String(row.note ?? '').trim().slice(0, 120) || undefined,
      };
    }).filter(Boolean) as StoryArc['relationshipDeltas']
    : undefined;
  const progressPercent = Number.isFinite(obj.progressPercent)
    ? clamp(Math.round(Number(obj.progressPercent)), 0, 100)
    : undefined;
  const worldProgressDelta = Number.isFinite(obj.worldProgressDelta)
    ? clamp(Math.round(Number(obj.worldProgressDelta)), -100, 100)
    : undefined;
  const stages: StoryArc['stages'] = [];
  if (Array.isArray(obj.stages)) {
    obj.stages.forEach((st, index) => {
      if (!st || typeof st !== 'object') return;
      const item = st as StoryArc['stages'][number];
      const stStart = Math.max(startRound, Math.floor(Number(item.startRound) || startRound));
      const stEnd = Math.max(stStart, Math.floor(Number(item.endRound) || targetEndRound || stStart));
      const goal = item.goal?.trim().slice(0, 300) || directive.slice(0, 300);
      if (!goal) return;
      stages.push({
        id: item.id || genId('stage'),
        startRound: stStart,
        endRound: stEnd,
        title: item.title?.trim().slice(0, 60) || `阶段 ${index + 1}`,
        goal,
        requiredBeats: Array.isArray(item.requiredBeats)
          ? item.requiredBeats.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 8)
          : [],
        avoid: item.avoid?.trim().slice(0, 300) || undefined,
      });
    });
  }
  return {
    id: obj.id || genId('arc'),
    type: obj.type === 'main' || obj.type === 'relationship' || obj.type === 'randomEvent' || obj.type === 'foreshadowing' || obj.type === 'custom'
      ? obj.type
      : 'custom',
    title: title.slice(0, 80),
    summary: (summary || title).slice(0, 500),
    directive: directive.slice(0, 1200),
    lifecycle,
    surfaceGoal: obj.surfaceGoal?.trim().slice(0, 500) || undefined,
    hiddenIntent: obj.hiddenIntent?.trim().slice(0, 800) || undefined,
    completionCriteria: normalizeStringList(obj.completionCriteria, 8, 100),
    failureCriteria: normalizeStringList(obj.failureCriteria, 8, 100),
    abandonCriteria: normalizeStringList(obj.abandonCriteria, 8, 100),
    worldProgressDelta,
    relationshipDeltas,
    progressPercent,
    writingBoundary: obj.writingBoundary?.trim().slice(0, 220) || undefined,
    isMilestone: obj.isMilestone === true,
    milestoneOf: obj.milestoneOf?.trim().slice(0, 160) || undefined,
    alternateOutcomePath: obj.alternateOutcomePath?.trim().slice(0, 260) || undefined,
    involvedNpcIds: Array.isArray(obj.involvedNpcIds)
      ? obj.involvedNpcIds.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 10)
      : [],
    involvedNpcNames: Array.isArray(obj.involvedNpcNames)
      ? obj.involvedNpcNames.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 10)
      : undefined,
    tags: Array.isArray(obj.tags)
      ? obj.tags.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 12)
      : [],
    startRound,
    targetEndRound,
    currentStageIndex: Math.max(0, Math.floor(Number(obj.currentStageIndex) || 0)),
    stages,
    status: obj.status === 'pending' || obj.status === 'active' || obj.status === 'completed' || obj.status === 'cancelled'
      ? obj.status
      : 'active',
    progressNote: obj.progressNote?.trim().slice(0, 500) || undefined,
    createdAt: Number(obj.createdAt) || nowMs(),
    updatedAtRound: Math.max(0, Math.floor(Number(obj.updatedAtRound) || startRound)),
  };
}

function normalizeStoryArcList(raw: unknown): StoryArc[] {
  if (!Array.isArray(raw)) return [];
  const out: StoryArc[] = [];
  for (const item of raw) {
    const arc = normalizeStoryArc(item);
    if (arc) out.push(arc);
    if (out.length >= 30) break;
  }
  return out;
}

function computeArcProgressPercent(arc: StoryArc, round: number, stageIndex = arc.currentStageIndex): number | undefined {
  if (!arc.stages.length) return arc.progressPercent;
  const byStage = Math.round(((Math.max(0, stageIndex) + 1) / arc.stages.length) * 100);
  if (arc.targetEndRound && arc.targetEndRound > arc.startRound) {
    const byRound = Math.round(((round - arc.startRound) / (arc.targetEndRound - arc.startRound)) * 100);
    return clamp(Math.max(arc.progressPercent ?? 0, byStage, byRound), 0, 99);
  }
  return clamp(Math.max(arc.progressPercent ?? 0, byStage), 0, 99);
}

function activeArcLifecycle(arc: StoryArc, fallback: NarrativeEventLifecycle = 'progressing'): NarrativeEventLifecycle {
  if (arc.lifecycle === 'turning' || arc.lifecycle === 'soft_failed' || arc.lifecycle === 'delayed' || arc.lifecycle === 'reframed') {
    return arc.lifecycle;
  }
  return fallback;
}

function isTerminalArcLifecycle(lifecycle: NarrativeEventLifecycle | undefined): boolean {
  return lifecycle === 'completed' || lifecycle === 'soft_failed' || lifecycle === 'missed' || lifecycle === 'archived';
}

function matchArcUpdate(arc: StoryArc, update: NarrativeEventUpdate): boolean {
  const id = update.arcId?.trim();
  const title = update.title?.trim();
  return !!(
    (id && arc.id === id)
    || (title && arc.title === title)
  );
}

function applyArcUpdate(arc: StoryArc, update: NarrativeEventUpdate, round: number): StoryArc {
  const lifecycle = NARRATIVE_EVENT_LIFECYCLES.includes(update.lifecycle as NarrativeEventLifecycle)
    ? update.lifecycle
    : arc.lifecycle;
  const progressPercent = Number.isFinite(update.progressPercent)
    ? clamp(Math.round(Number(update.progressPercent)), 0, 100)
    : arc.progressPercent;
  const currentStageIndex = Number.isFinite(update.currentStageIndex)
    ? clamp(Math.floor(Number(update.currentStageIndex)), 0, Math.max(0, arc.stages.length - 1))
    : arc.currentStageIndex;
  const progressNote = update.progressNote?.trim()
    || (update.reason?.trim() ? `导演更新：${update.reason.trim()}` : arc.progressNote);
  return {
    ...arc,
    lifecycle,
    progressPercent,
    currentStageIndex,
    progressNote: progressNote?.slice(0, 500) || undefined,
    status: isTerminalArcLifecycle(lifecycle) ? 'completed' : arc.status === 'pending' ? 'pending' : 'active',
    updatedAtRound: round,
  };
}

const OUTLINE_MAPPING_ALIGNMENTS: OutlineMappingAlignment[] = [
  'aligned',
  'drifting',
  'bridging',
  'ready_to_advance',
  'uncertain',
];

function normalizeBriefCharacter(raw: unknown): NarrativeBriefCharacter | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Partial<NarrativeBriefCharacter>;
  const name = String(obj.name ?? '').trim().slice(0, 30);
  if (!name) return undefined;
  return {
    name,
    role: obj.role?.trim().slice(0, 40) || undefined,
    surfaceGoal: obj.surfaceGoal?.trim().slice(0, 180) || undefined,
    hiddenIntent: obj.hiddenIntent?.trim().slice(0, 180) || undefined,
    visibleBehavior: obj.visibleBehavior?.trim().slice(0, 220) || undefined,
    doNotReveal: normalizeStringList(obj.doNotReveal, 6, 90),
  };
}

function normalizeBriefEvent(raw: unknown): NarrativeBriefEvent | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Partial<NarrativeBriefEvent>;
  const lifecycle = NARRATIVE_EVENT_LIFECYCLES.includes(obj.lifecycle as NarrativeEventLifecycle)
    ? obj.lifecycle as NarrativeEventLifecycle
    : undefined;
  const event: NarrativeBriefEvent = {
    title: obj.title?.trim().slice(0, 80) || undefined,
    lifecycle,
    objective: obj.objective?.trim().slice(0, 200) || undefined,
    hiddenIntent: obj.hiddenIntent?.trim().slice(0, 200) || undefined,
    completionCriteria: normalizeStringList(obj.completionCriteria, 6, 100),
    failureCriteria: normalizeStringList(obj.failureCriteria, 6, 100),
    progress: obj.progress?.trim().slice(0, 160) || undefined,
    stopAt: obj.stopAt?.trim().slice(0, 160) || undefined,
  };
  return Object.values(event).some((x) => Array.isArray(x) ? x.length : !!x) ? event : undefined;
}

function normalizeBriefScene(raw: unknown): NarrativeBriefScene | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Partial<NarrativeBriefScene>;
  const scene: NarrativeBriefScene = {
    location: obj.location?.trim().slice(0, 80) || undefined,
    time: obj.time?.trim().slice(0, 60) || undefined,
    weather: obj.weather?.trim().slice(0, 60) || undefined,
    atmosphere: obj.atmosphere?.trim().slice(0, 160) || undefined,
    resources: normalizeStringList(obj.resources, 8, 100),
    constraints: normalizeStringList(obj.constraints, 8, 100),
  };
  return Object.values(scene).some((x) => Array.isArray(x) ? x.length : !!x) ? scene : undefined;
}

function normalizeOutlineMapping(raw: unknown): OutlineMappingState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Partial<OutlineMappingState>;
  const alignment = OUTLINE_MAPPING_ALIGNMENTS.includes(obj.alignment as OutlineMappingAlignment)
    ? obj.alignment as OutlineMappingAlignment
    : 'uncertain';
  const currentActIndex = Number.isFinite(obj.currentActIndex)
    ? clamp(Math.floor(Number(obj.currentActIndex)), 0, 99)
    : undefined;
  const stageProgress = Number.isFinite(obj.stageProgress)
    ? clamp(Math.round(Number(obj.stageProgress)), 0, 100)
    : undefined;
  return {
    alignment,
    currentAct: obj.currentAct?.trim().slice(0, 100) || undefined,
    currentActIndex,
    currentStageGoal: obj.currentStageGoal?.trim().slice(0, 220) || undefined,
    stageProgress,
    missingBridgeEvents: normalizeStringList(obj.missingBridgeEvents, 8, 120),
    candidateEvents: normalizeStringList(obj.candidateEvents, 8, 120),
    driftRisks: normalizeStringList(obj.driftRisks, 8, 120),
    nextMilestone: obj.nextMilestone?.trim().slice(0, 180) || undefined,
    updatedAtRound: Math.max(0, Math.floor(Number(obj.updatedAtRound) || 0)),
    thinking: obj.thinking?.trim().slice(0, 12000) || undefined,
    rawOutput: obj.rawOutput?.trim().slice(0, 16000) || undefined,
    usage: normalizeLlmUsage(obj.usage),
  };
}

function normalizeEventUpdates(raw: unknown): NarrativeEventUpdate[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: NarrativeEventUpdate[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Partial<NarrativeEventUpdate>;
    const arcId = obj.arcId?.trim().slice(0, 80);
    const title = obj.title?.trim().slice(0, 80);
    if (!arcId && !title) continue;
    out.push({
      arcId: arcId || undefined,
      title: title || undefined,
      lifecycle: NARRATIVE_EVENT_LIFECYCLES.includes(obj.lifecycle as NarrativeEventLifecycle)
        ? obj.lifecycle as NarrativeEventLifecycle
        : undefined,
      progressPercent: Number.isFinite(obj.progressPercent)
        ? clamp(Math.round(Number(obj.progressPercent)), 0, 100)
        : undefined,
      progressNote: obj.progressNote?.trim().slice(0, 240) || undefined,
      currentStageIndex: Number.isFinite(obj.currentStageIndex)
        ? Math.max(0, Math.floor(Number(obj.currentStageIndex)))
        : undefined,
      reason: obj.reason?.trim().slice(0, 180) || undefined,
    });
    if (out.length >= 10) break;
  }
  return out.length ? out : undefined;
}

function normalizeAuthorCharacterPlan(raw: unknown): AuthorCharacterPlanState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Partial<AuthorCharacterPlanState>;
  const characters = Array.isArray(obj.characters)
    ? obj.characters.map(normalizeBriefCharacter).filter(Boolean).slice(0, 10) as NarrativeBriefCharacter[]
    : [];
  const summary = obj.summary?.trim().slice(0, 500) || (characters.length ? '人物规划已更新。' : '');
  if (!summary && !characters.length) return undefined;
  const absentCharacters = Array.isArray(obj.absentCharacters)
    ? obj.absentCharacters.map((item) => {
      const row = item as { name?: unknown; reason?: unknown };
      const name = String(row?.name ?? '').trim().slice(0, 30);
      const reason = String(row?.reason ?? '').trim().slice(0, 160);
      return name && reason ? { name, reason } : undefined;
    }).filter(Boolean).slice(0, 8) as AuthorCharacterPlanState['absentCharacters']
    : undefined;
  return {
    updatedAtRound: Math.max(0, Math.floor(Number(obj.updatedAtRound) || 0)),
    summary: summary || '人物规划已更新。',
    characters,
    relationshipSignals: normalizeStringList(obj.relationshipSignals, 8, 120),
    absentCharacters,
    risks: normalizeStringList(obj.risks, 8, 120),
    thinking: obj.thinking?.trim().slice(0, 12000) || undefined,
    rawOutput: obj.rawOutput?.trim().slice(0, 16000) || undefined,
    usage: normalizeLlmUsage(obj.usage),
  };
}

function normalizeAuthorScenePlan(raw: unknown): AuthorScenePlanState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Partial<AuthorScenePlanState>;
  const scene = normalizeBriefScene(obj.scene);
  const resources = normalizeStringList(obj.sceneResources, 10, 120) ?? [];
  if (!scene && !resources.length) return undefined;
  return {
    updatedAtRound: Math.max(0, Math.floor(Number(obj.updatedAtRound) || 0)),
    scene: scene ?? {},
    sceneResources: resources,
    sceneLogic: obj.sceneLogic?.trim().slice(0, 300) || undefined,
    constraints: normalizeStringList(obj.constraints, 8, 120),
    opportunities: normalizeStringList(obj.opportunities, 8, 120),
    risks: normalizeStringList(obj.risks, 8, 120),
    thinking: obj.thinking?.trim().slice(0, 12000) || undefined,
    rawOutput: obj.rawOutput?.trim().slice(0, 16000) || undefined,
    usage: normalizeLlmUsage(obj.usage),
  };
}

function normalizeAuthorEventPlan(raw: unknown): AuthorEventPlanState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Partial<AuthorEventPlanState>;
  const currentEvent = normalizeBriefEvent(obj.currentEvent);
  const eventUpdates = normalizeEventUpdates(obj.eventUpdates);
  const candidateEvents = normalizeStringList(obj.candidateEvents, 8, 120);
  const summary = obj.summary?.trim().slice(0, 500)
    || currentEvent?.objective
    || (eventUpdates?.length ? '事件规划已更新。' : '');
  if (!summary && !currentEvent && !eventUpdates?.length && !candidateEvents?.length) return undefined;
  return {
    updatedAtRound: Math.max(0, Math.floor(Number(obj.updatedAtRound) || 0)),
    summary: summary || '事件规划已更新。',
    currentEvent,
    eventUpdates,
    candidateEvents,
    writingBoundary: obj.writingBoundary?.trim().slice(0, 220) || undefined,
    successCriteria: normalizeStringList(obj.successCriteria, 8, 120),
    avoid: normalizeStringList(obj.avoid, 8, 120),
    thinking: obj.thinking?.trim().slice(0, 12000) || undefined,
    rawOutput: obj.rawOutput?.trim().slice(0, 16000) || undefined,
    usage: normalizeLlmUsage(obj.usage),
  };
}

function normalizeEventBeatVerdict(raw: unknown): EventBeatVerdict | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Partial<EventBeatVerdict>;
  const arcId = String(obj.arcId ?? '').trim().slice(0, 80);
  if (!arcId) return undefined;
  const lifecycle = NARRATIVE_EVENT_LIFECYCLES.includes(obj.lifecycle as NarrativeEventLifecycle)
    ? obj.lifecycle as NarrativeEventLifecycle
    : undefined;
  if (!lifecycle) return undefined;
  const progressPercent = Number.isFinite(obj.progressPercent)
    ? clamp(Math.round(Number(obj.progressPercent)), 0, 100)
    : undefined;
  const appliedRelationshipDeltas = Array.isArray(obj.appliedRelationshipDeltas)
    ? obj.appliedRelationshipDeltas.slice(0, 8).map((item) => {
      const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const npcId = String(row.npcId ?? '').trim().slice(0, 40);
      const npcName = String(row.npcName ?? '').trim().slice(0, 30);
      if (!npcId && !npcName) return undefined;
      const affinityDelta = Number(row.affinityDelta);
      return {
        npcId: npcId || undefined,
        npcName: npcName || undefined,
        affinityDelta: Number.isFinite(affinityDelta) ? clamp(Math.round(affinityDelta), -30, 30) : undefined,
        note: String(row.note ?? '').trim().slice(0, 120) || undefined,
      };
    }).filter(Boolean) as EventBeatVerdict['appliedRelationshipDeltas']
    : undefined;
  const appliedItemDeltas = Array.isArray(obj.appliedItemDeltas)
    ? obj.appliedItemDeltas.slice(0, 8).map((item) => {
      const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const name = String(row.name ?? '').trim().slice(0, 60);
      const actionRaw = String(row.action ?? '').trim();
      const action = actionRaw === 'grant' || actionRaw === 'note' ? actionRaw : undefined;
      if (!name || !action) return undefined;
      return {
        name,
        action,
        description: String(row.description ?? '').trim().slice(0, 220) || undefined,
      };
    }).filter(Boolean) as EventBeatVerdict['appliedItemDeltas']
    : undefined;
  return {
    arcId,
    title: obj.title?.trim().slice(0, 80) || undefined,
    lifecycle,
    progressPercent,
    progressNote: obj.progressNote?.trim().slice(0, 180) || undefined,
    triggeredCompletion: obj.triggeredCompletion === true,
    triggeredFailure: obj.triggeredFailure === true,
    outcomeNote: obj.outcomeNote?.trim().slice(0, 220) || undefined,
    appliedRelationshipDeltas,
    appliedItemDeltas,
  };
}

function normalizeEventBeatState(raw: unknown): EventBeatState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Partial<EventBeatState>;
  const verdicts = Array.isArray(obj.verdicts)
    ? obj.verdicts.map(normalizeEventBeatVerdict).filter(Boolean).slice(0, 20) as EventBeatVerdict[]
    : [];
  if (!verdicts.length && !obj.planConcern?.trim() && !obj.rawOutput?.trim()) return undefined;
  return {
    updatedAtRound: Math.max(0, Math.floor(Number(obj.updatedAtRound) || 0)),
    verdicts,
    planConcern: obj.planConcern?.trim().slice(0, 120) || undefined,
    thinking: obj.thinking?.trim().slice(0, 12000) || undefined,
    rawOutput: obj.rawOutput?.trim().slice(0, 16000) || undefined,
    usage: normalizeLlmUsage(obj.usage),
  };
}

function normalizeAuthorLogicReview(raw: unknown): AuthorLogicReviewState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Partial<AuthorLogicReviewState>;
  const issues: AuthorLogicIssue[] = Array.isArray(obj.issues)
    ? obj.issues.slice(0, 12).map((item, index) => {
      const issue = item as Partial<AuthorLogicIssue>;
      const type = issue.type === 'character' || issue.type === 'scene' || issue.type === 'timeline' || issue.type === 'item' || issue.type === 'outline' || issue.type === 'memory' || issue.type === 'pacing' || issue.type === 'other'
        ? issue.type
        : 'other';
      const severity = issue.severity === 'critical' || issue.severity === 'warning' || issue.severity === 'info'
        ? issue.severity
        : 'info';
      return {
        id: issue.id || genId(`logic_${index}`),
        type,
        severity,
        description: String(issue.description ?? '').trim().slice(0, 220),
        evidence: issue.evidence?.trim().slice(0, 220) || undefined,
        repairHint: issue.repairHint?.trim().slice(0, 220) || undefined,
      };
    }).filter((item) => item.description)
    : [];
  const repairDirectives = Array.isArray(obj.repairDirectives)
    ? obj.repairDirectives.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 8)
    : [];
  const nextRoundWarnings = Array.isArray(obj.nextRoundWarnings)
    ? obj.nextRoundWarnings.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 8)
    : undefined;
  const overall = obj.overall?.trim().slice(0, 500) || (issues.length ? '存在若干连续性风险。' : '暂未发现明显连续性风险。');
  return {
    updatedAtRound: Math.max(0, Math.floor(Number(obj.updatedAtRound) || 0)),
    overall,
    issues,
    repairDirectives,
    nextRoundWarnings,
    thinking: obj.thinking?.trim().slice(0, 12000) || undefined,
  };
}

function normalizeSettingGuard(raw: unknown): SettingGuardState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Partial<SettingGuardState>;
  const patches: SettingPatch[] = Array.isArray(obj.patches)
    ? obj.patches.slice(0, 12).map((item, index) => {
      const patch = item as Partial<SettingPatch>;
      const severity = patch.severity === 'must' || patch.severity === 'should' ? patch.severity : 'should';
      return {
        id: patch.id || genId(`patch_${index}`),
        topic: String(patch.topic ?? '').trim().slice(0, 24),
        advice: String(patch.advice ?? '').trim().slice(0, 220),
        severity,
        suggestedAtRound: Math.max(0, Math.floor(Number(patch.suggestedAtRound) || 0)),
      };
    }).filter((item) => item.topic && item.advice)
    : [];

  const candidates: SettingGuardCandidate[] = Array.isArray(obj.candidates)
    ? obj.candidates.slice(0, SETTING_GUARD_CANDIDATE_LIMIT).map((item, index) => {
      const cand = item as Partial<SettingGuardCandidate>;
      const status = cand.status === 'accepted' || cand.status === 'rejected' || cand.status === 'pending'
        ? cand.status
        : 'pending';
      return {
        id: cand.id || genId(`cand_${index}`),
        name: String(cand.name ?? '').trim().slice(0, 30),
        keywords: Array.isArray(cand.keywords)
          ? cand.keywords.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 8)
          : [],
        content: String(cand.content ?? '').trim().slice(0, 240),
        rationale: String(cand.rationale ?? '').trim().slice(0, 180),
        status,
        suggestedAtRound: Math.max(0, Math.floor(Number(cand.suggestedAtRound) || 0)),
      };
    }).filter((item) => item.name && item.content)
    : [];

  const prefRaw = obj.preference as Partial<SettingGuardPreference> | undefined;
  const prefConfidence = prefRaw?.confidence === 'high' || prefRaw?.confidence === 'medium' || prefRaw?.confidence === 'low'
    ? prefRaw.confidence
    : undefined;
  const preference: SettingGuardPreference | undefined = prefRaw && prefConfidence
    ? {
      tendency: prefRaw.tendency?.trim().slice(0, 160) || undefined,
      recentSignals: Array.isArray(prefRaw.recentSignals)
        ? prefRaw.recentSignals.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 8)
        : undefined,
      confidence: prefConfidence,
      updatedAtRound: Math.max(0, Math.floor(Number(prefRaw.updatedAtRound) || 0)),
    }
    : undefined;

  const pendingAmbientBeats: SettingGuardAmbientBeat[] = Array.isArray(obj.pendingAmbientBeats)
    ? obj.pendingAmbientBeats.slice(0, 20).map((item, index) => {
      const beat = item as Partial<SettingGuardAmbientBeat>;
      return {
        id: beat.id || genId(`beat_${index}`),
        source: String(beat.source ?? '').trim().slice(0, 30),
        trigger: String(beat.trigger ?? '').trim().slice(0, 100),
        beat: String(beat.beat ?? '').trim().slice(0, 160),
        optional: beat.optional !== false,
        suggestedAtRound: Math.max(0, Math.floor(Number(beat.suggestedAtRound) || 0)),
        consumed: !!beat.consumed,
      };
    }).filter((item) => item.source && item.trigger && item.beat)
    : [];

  const devRaw = obj.deviation as Partial<SettingGuardDeviation> | undefined;
  const deviation: SettingGuardDeviation | undefined = devRaw?.description?.trim()
    ? {
      description: devRaw.description.trim().slice(0, 240),
      affectedEntryNames: Array.isArray(devRaw.affectedEntryNames)
        ? devRaw.affectedEntryNames.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 8)
        : undefined,
      flaggedAtRound: Math.max(0, Math.floor(Number(devRaw.flaggedAtRound) || 0)),
    }
    : undefined;

  return {
    updatedAtRound: Math.max(0, Math.floor(Number(obj.updatedAtRound) || 0)),
    patches,
    candidates,
    preference,
    pendingAmbientBeats,
    deviation,
    lastError: obj.lastError?.trim().slice(0, 240) || undefined,
    thinking: obj.thinking?.trim().slice(0, 12000) || undefined,
  };
}

function normalizeNarrativeStageBeat(raw: unknown, index: number): NarrativeStageBeat | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Partial<NarrativeStageBeat>;
  const description = obj.description?.trim().slice(0, 100);
  if (!description) return undefined;
  const status = obj.status === 'achieved' || obj.status === 'skipped' || obj.status === 'pending'
    ? obj.status
    : 'pending';
  const achievedAtRound = Number.isFinite(obj.achievedAtRound)
    ? Math.max(0, Math.floor(Number(obj.achievedAtRound)))
    : undefined;
  return {
    id: obj.id || genId(`beat_${index}`),
    description,
    status,
    achievedAtRound,
  };
}

function normalizeNarrativeStage(raw: unknown, index: number): NarrativeStage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Partial<NarrativeStage>;
  const name = obj.name?.trim().slice(0, 24);
  const description = obj.description?.trim().slice(0, 260);
  if (!name || !description) return undefined;
  const status = obj.status === 'active' || obj.status === 'completed' || obj.status === 'skipped' || obj.status === 'pending'
    ? obj.status
    : index === 0 ? 'active' : 'pending';
  return {
    id: obj.id || genId(`stage_${index}`),
    name,
    description,
    enterConditions: Array.isArray(obj.enterConditions)
      ? obj.enterConditions.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 6)
      : [],
    completionConditions: Array.isArray(obj.completionConditions)
      ? obj.completionConditions.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 8)
      : [],
    expectedBeats: Array.isArray(obj.expectedBeats)
      ? obj.expectedBeats.map((x, i) => normalizeNarrativeStageBeat(x, i)).filter(Boolean) as NarrativeStageBeat[]
      : [],
    status,
    enteredAtRound: Number.isFinite(obj.enteredAtRound) ? Math.max(0, Math.floor(Number(obj.enteredAtRound))) : undefined,
    exitedAtRound: Number.isFinite(obj.exitedAtRound) ? Math.max(0, Math.floor(Number(obj.exitedAtRound))) : undefined,
  };
}

function normalizeMasterArc(raw: unknown): MasterArcState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Partial<MasterArcState>;
  const stages = Array.isArray(obj.stages)
    ? obj.stages.map((x, i) => normalizeNarrativeStage(x, i)).filter(Boolean) as NarrativeStage[]
    : [];
  if (!stages.length) return undefined;
  const currentStageIndex = clamp(
    Math.floor(Number(obj.currentStageIndex) || 0),
    0,
    Math.max(0, stages.length - 1),
  );
  if (!stages.some((s) => s.status === 'active')) {
    stages[currentStageIndex] = { ...stages[currentStageIndex], status: 'active' };
  }
  return {
    title: obj.title?.trim().slice(0, 30) || '主弧',
    summary: obj.summary?.trim().slice(0, 260) || '',
    stages,
    currentStageIndex,
    generatedAtRound: Math.max(0, Math.floor(Number(obj.generatedAtRound) || 0)),
    updatedAtRound: Math.max(0, Math.floor(Number(obj.updatedAtRound) || 0)),
    generationConfig: obj.generationConfig
      ? normalizeAuthorMasterArcConfig(obj.generationConfig)
      : undefined,
    thinking: obj.thinking?.trim().slice(0, 12000) || undefined,
  };
}

function normalizeStageJudge(raw: unknown): StageJudgeState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Partial<StageJudgeState>;
  const playerPace = obj.playerPace === 'immersive' || obj.playerPace === 'exploratory' || obj.playerPace === 'progressing' || obj.playerPace === 'hurrying'
    ? obj.playerPace
    : 'progressing';
  const primary = obj.playerIntent?.primary?.trim().slice(0, 100);
  const thisRound = obj.storyFocus?.thisRound?.trim().slice(0, 180);
  if (!primary || !thisRound) return undefined;
  return {
    updatedAtRound: Math.max(0, Math.floor(Number(obj.updatedAtRound) || 0)),
    playerIntent: {
      primary,
      secondary: Array.isArray(obj.playerIntent?.secondary)
        ? obj.playerIntent.secondary.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 4)
        : undefined,
      implicit: obj.playerIntent?.implicit?.trim().slice(0, 100) || undefined,
    },
    playerPace,
    paceReasoning: obj.paceReasoning?.trim().slice(0, 180) || undefined,
    stageStatus: {
      currentStageId: obj.stageStatus?.currentStageId?.trim() || undefined,
      completion: clamp(Math.round(Number(obj.stageStatus?.completion) || 0), 0, 100),
      newlyAchievedBeats: Array.isArray(obj.stageStatus?.newlyAchievedBeats)
        ? obj.stageStatus.newlyAchievedBeats.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 12)
        : [],
      shouldAdvance: !!obj.stageStatus?.shouldAdvance,
      advanceReasoning: obj.stageStatus?.advanceReasoning?.trim().slice(0, 160) || undefined,
    },
    storyFocus: {
      thisRound,
      avoid: Array.isArray(obj.storyFocus?.avoid)
        ? obj.storyFocus.avoid.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 6)
        : undefined,
    },
    lastError: obj.lastError?.trim().slice(0, 240) || undefined,
    thinking: obj.thinking?.trim().slice(0, 12000) || undefined,
  };
}

const ORCHESTRATOR_TURN_TYPES: OrchestratorTurnType[] = [
  'continue_current_event',
  'event_turning_point',
  'event_completion_check',
  'new_event_candidate',
  'stage_transition_candidate',
  'free_exploration',
];

const ORCHESTRATOR_PLANNING_MODES: OrchestratorPlanningMode[] = ['light', 'focused', 'full'];
const ORCHESTRATOR_DIRECTOR_MODES: OrchestratorDirectorMode[] = ['skip', 'light', 'full'];

const ORCHESTRATOR_FOCUS_AREAS: OrchestratorFocusArea[] = [
  'outline',
  'stage',
  'character',
  'scene',
  'event',
  'foreshadowing',
  'setting',
  'memory',
  'logic',
  'summary',
];

const ORCHESTRATOR_CALL_KEYS: OrchestratorCallKey[] = [
  'outlineMapper',
  'stageJudge',
  'settingGuard',
  'eventBeat',
  'director',
  'logicCheck',
  'memory',
  'summary',
];

function defaultOrchestratorCalls(reason = '未运行。'): OrchestratorState['calls'] {
  return Object.fromEntries(
    ORCHESTRATOR_CALL_KEYS.map((key) => [key, { run: false, reason }]),
  ) as OrchestratorState['calls'];
}

function normalizeOrchestratorFocusAreas(raw: unknown): OrchestratorFocusArea[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: OrchestratorFocusArea[] = [];
  for (const item of raw) {
    const area = String(item ?? '').trim() as OrchestratorFocusArea;
    if (!ORCHESTRATOR_FOCUS_AREAS.includes(area) || out.includes(area)) continue;
    out.push(area);
    if (out.length >= 10) break;
  }
  return out.length ? out : undefined;
}

function normalizeOrchestratorPlanSignals(raw: unknown): OrchestratorPlanSignal[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: OrchestratorPlanSignal[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Partial<OrchestratorPlanSignal>;
    const area = String(row.area ?? '').trim() as OrchestratorFocusArea;
    if (!ORCHESTRATOR_FOCUS_AREAS.includes(area)) continue;
    const priority = row.priority === 'high' || row.priority === 'medium' || row.priority === 'low'
      ? row.priority
      : 'medium';
    const reason = String(row.reason ?? '').trim().slice(0, 180);
    if (!reason) continue;
    out.push({
      area,
      priority,
      reason,
      suggestedModel: String(row.suggestedModel ?? '').trim().slice(0, 40) || undefined,
    });
    if (out.length >= 12) break;
  }
  return out.length ? out : undefined;
}

function normalizeOrchestratorCallOrder(raw: unknown, calls: OrchestratorState['calls']): OrchestratorCallKey[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const keys = Object.keys(calls) as OrchestratorCallKey[];
  const out: OrchestratorCallKey[] = [];
  for (const item of raw) {
    const key = String(item ?? '').trim() as OrchestratorCallKey;
    if (!keys.includes(key) || out.includes(key) || calls[key]?.run !== true) continue;
    out.push(key);
  }
  return out.length ? out : undefined;
}

function normalizeOrchestratorPhase1(raw: unknown): OrchestratorPhase1Result | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Partial<OrchestratorPhase1Result>;
  const notes = obj.notes?.trim().slice(0, 1200) || '';
  const signalRaw = obj.signalSnapshot && typeof obj.signalSnapshot === 'object'
    ? obj.signalSnapshot
    : undefined;
  const signalSnapshot = signalRaw
    ? {
      outline: signalRaw.outline?.trim().slice(0, 220) || undefined,
      stage: signalRaw.stage?.trim().slice(0, 220) || undefined,
      activeEvents: signalRaw.activeEvents?.trim().slice(0, 220) || undefined,
    }
    : undefined;
  if (!notes && !obj.rawOutput?.trim() && !obj.thinking?.trim()) return undefined;
  return {
    updatedAtRound: Math.max(0, Math.floor(Number(obj.updatedAtRound) || 0)),
    notes: notes || '司辰 Phase 1 信息整理未提供摘要。',
    outstandingQuestions: normalizeStringList(obj.outstandingQuestions, 8, 120),
    signalSnapshot,
    earlyExit: obj.earlyExit === true,
    thinking: obj.thinking?.trim().slice(0, 12000) || undefined,
    rawOutput: obj.rawOutput?.trim().slice(0, 16000) || undefined,
    usage: normalizeLlmUsage(obj.usage),
  };
}

function normalizeOrchestratorState(raw: unknown): OrchestratorState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Partial<OrchestratorState>;
  const keys: Array<keyof OrchestratorState['calls']> = ORCHESTRATOR_CALL_KEYS;
  const calls = Object.fromEntries(keys.map((key) => {
    const row = obj.calls?.[key];
    return [key, {
      run: row?.run === true,
      reason: String(row?.reason ?? '').trim().slice(0, 160) || '未提供理由。',
      hint: String(row?.hint ?? '').trim().slice(0, 80) || undefined,
    }];
  })) as OrchestratorState['calls'];
  return {
    updatedAtRound: Math.max(0, Math.floor(Number(obj.updatedAtRound) || 0)),
    overall: obj.overall?.trim().slice(0, 220) || undefined,
    turnType: ORCHESTRATOR_TURN_TYPES.includes(obj.turnType as OrchestratorTurnType)
      ? obj.turnType as OrchestratorTurnType
      : undefined,
    planningMode: ORCHESTRATOR_PLANNING_MODES.includes(obj.planningMode as OrchestratorPlanningMode)
      ? obj.planningMode as OrchestratorPlanningMode
      : undefined,
    directorMode: ORCHESTRATOR_DIRECTOR_MODES.includes(obj.directorMode as OrchestratorDirectorMode)
      ? obj.directorMode as OrchestratorDirectorMode
      : undefined,
    focusAreas: normalizeOrchestratorFocusAreas(obj.focusAreas),
    planSignals: normalizeOrchestratorPlanSignals(obj.planSignals),
    callOrder: normalizeOrchestratorCallOrder(obj.callOrder, calls),
    calls,
    phase1: normalizeOrchestratorPhase1(obj.phase1),
    thinking: obj.thinking?.trim().slice(0, 12000) || undefined,
    rawOutput: obj.rawOutput?.trim().slice(0, 16000) || undefined,
    usage: normalizeLlmUsage(obj.usage),
    lastError: obj.lastError?.trim().slice(0, 240) || undefined,
  };
}

function normalizeAuthorNarrativeState(raw: unknown): AuthorNarrativeState {
  const obj = (raw ?? {}) as Partial<AuthorNarrativeState>;
  return {
    orchestrator: normalizeOrchestratorState(obj.orchestrator),
    outlineMapping: normalizeOutlineMapping(obj.outlineMapping),
    characterPlan: normalizeAuthorCharacterPlan(obj.characterPlan),
    scenePlan: normalizeAuthorScenePlan(obj.scenePlan),
    eventPlan: normalizeAuthorEventPlan(obj.eventPlan),
    plan: obj.plan,
    logicReview: normalizeAuthorLogicReview(obj.logicReview),
    settingGuard: normalizeSettingGuard(obj.settingGuard),
    eventBeat: normalizeEventBeatState(obj.eventBeat),
    directorReply: normalizeDirectorReply(obj.directorReply),
    masterArc: normalizeMasterArc(obj.masterArc),
    stageJudge: normalizeStageJudge(obj.stageJudge),
    activeArcs: normalizeStoryArcList(obj.activeArcs),
    completedArcs: normalizeStoryArcList(obj.completedArcs),
    lastDirectorRound: obj.lastDirectorRound,
    lastLogicCheckRound: obj.lastLogicCheckRound,
    lastSettingGuardRound: obj.lastSettingGuardRound,
    lastStageJudgeRound: obj.lastStageJudgeRound,
    lastOrchestratorRound: obj.lastOrchestratorRound,
    lastOutlineMapperRound: obj.lastOutlineMapperRound,
    lastCharacterPlannerRound: obj.lastCharacterPlannerRound,
    lastScenePlannerRound: obj.lastScenePlannerRound,
    lastEventPlannerRound: obj.lastEventPlannerRound,
    lastEventBeatRound: obj.lastEventBeatRound,
  };
}

function normalizeDirectorReply(raw: unknown): AuthorNarrativeState['directorReply'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as AuthorNarrativeState['directorReply'];
  const callId = String(obj?.callId ?? '').trim().slice(0, 80);
  const question = String(obj?.question ?? '').trim().slice(0, 1000);
  const answer = String(obj?.answer ?? '').trim().slice(0, 12000);
  if (!callId || !question || !answer) return undefined;
  const missingInfo = String(obj?.missingInfo ?? '').trim().slice(0, 1000);
  return {
    callId,
    question,
    missingInfo: missingInfo || undefined,
    answer,
    round: Math.max(0, Math.floor(Number(obj?.round) || 0)),
    createdAt: Number(obj?.createdAt) || nowMs(),
  };
}

function invalidateAuthorNarrativeAfterHistoryChange(state: GameState, affectedRound: number): Partial<GameState> {
  if (!state.authorNarrative) return {};
  const threshold = Math.max(0, Math.floor(Number(affectedRound) || 0));
  const narrative = normalizeAuthorNarrativeState(state.authorNarrative);
  const shouldDrop = (updatedAtRound?: number) =>
    Number.isFinite(updatedAtRound) && Number(updatedAtRound) >= threshold;
  const keepLastRound = (round?: number) =>
    round !== undefined && round >= threshold ? undefined : round;

  const settingGuard = narrative.settingGuard
    ? shouldDrop(narrative.settingGuard.updatedAtRound)
      ? {
        updatedAtRound: Math.max(0, threshold - 1),
        patches: [],
        candidates: narrative.settingGuard.candidates,
        preference: shouldDrop(narrative.settingGuard.preference?.updatedAtRound)
          ? undefined
          : narrative.settingGuard.preference,
        pendingAmbientBeats: [],
        lastError: narrative.settingGuard.lastError,
      }
      : narrative.settingGuard
    : undefined;

  return {
    authorNarrative: {
      ...narrative,
      outlineMapping: shouldDrop(narrative.outlineMapping?.updatedAtRound) ? undefined : narrative.outlineMapping,
      characterPlan: shouldDrop(narrative.characterPlan?.updatedAtRound) ? undefined : narrative.characterPlan,
      scenePlan: shouldDrop(narrative.scenePlan?.updatedAtRound) ? undefined : narrative.scenePlan,
      eventPlan: shouldDrop(narrative.eventPlan?.updatedAtRound) ? undefined : narrative.eventPlan,
      eventBeat: shouldDrop(narrative.eventBeat?.updatedAtRound) ? undefined : narrative.eventBeat,
      directorReply: narrative.directorReply && narrative.directorReply.round >= threshold ? undefined : narrative.directorReply,
      plan: shouldDrop(narrative.plan?.updatedAtRound) ? undefined : narrative.plan,
      logicReview: shouldDrop(narrative.logicReview?.updatedAtRound) ? undefined : narrative.logicReview,
      settingGuard,
      stageJudge: shouldDrop(narrative.stageJudge?.updatedAtRound) ? undefined : narrative.stageJudge,
      lastDirectorRound: keepLastRound(narrative.lastDirectorRound),
      lastLogicCheckRound: keepLastRound(narrative.lastLogicCheckRound),
      lastSettingGuardRound: keepLastRound(narrative.lastSettingGuardRound),
      lastStageJudgeRound: keepLastRound(narrative.lastStageJudgeRound),
      lastOrchestratorRound: keepLastRound(narrative.lastOrchestratorRound),
      lastOutlineMapperRound: keepLastRound(narrative.lastOutlineMapperRound),
      lastCharacterPlannerRound: keepLastRound(narrative.lastCharacterPlannerRound),
      lastScenePlannerRound: keepLastRound(narrative.lastScenePlannerRound),
      lastEventPlannerRound: keepLastRound(narrative.lastEventPlannerRound),
      lastEventBeatRound: keepLastRound(narrative.lastEventBeatRound),
    },
  };
}

function normalizeAuthorRandomEventState(raw: unknown): AuthorRandomEventState {
  const obj = (raw ?? {}) as Partial<AuthorRandomEventState>;
  return {
    pendingEvent: normalizeStoryArc(obj.pendingEvent),
    pendingForRound: obj.pendingForRound,
    activeEvents: normalizeStoryArcList(obj.activeEvents),
    completedEvents: normalizeStoryArcList(obj.completedEvents),
    cooldownUntilRound: obj.cooldownUntilRound,
    currentProbability: Number.isFinite(obj.currentProbability) ? obj.currentProbability : 0,
    lastCheckedRound: obj.lastCheckedRound,
    lastError: obj.lastError,
    lastThinking: obj.lastThinking?.trim().slice(0, 12000) || undefined,
  };
}

export const useGameStore = create<GameStoreState>()(
  persist(
    (set, get) => ({
      saves: {},
      activeSaveId: undefined,
      ledgerHydrated: false,

      hydrateFromLedger: async () => {
        try {
          const saves = await loadAllSaves();
          set((s) => {
            const byId = Object.fromEntries(saves.map((save) => [save.id, save]));
            const activeSaveId = s.activeSaveId && byId[s.activeSaveId]
              ? s.activeSaveId
              : saves[0]?.id;
            return {
              saves: byId,
              activeSaveId,
              ledgerHydrated: true,
            };
          });
        } catch (err) {
          reportLedgerError('hydrateFromLedger', err);
          set({ ledgerHydrated: true });
        }
      },

      createSave: ({ name, config, content, initialScene, initialItems }) => {
        const id = genId('save');
        const now = nowMs();
        const history: Message[] = [];
        if (initialScene && initialScene.trim()) {
          history.push({ role: 'assistant', content: initialScene.trim(), round: 0 });
        }
        const save: GameSave = {
          id,
          name: name || '无题的旅程',
          createdAt: now,
          updatedAt: now,
          config,
          content,
          state: {
            currentRound: initialScene ? 1 : 0,
            history,
            summary: '',
            summarizedUntilIndex: 0,
            longTermMemory: '',
            lastMemoryRound: 0,
            characterSheet: {},
            triggeredEvents: [],
            phase: 'choices',
            refreshesLeft: 0,
            backpack: initialItems ?? [],
            selectedItemIds: [],
            needsDiscard: 0,
            npcs: [],
            anchors: [],
            sceneHistory: [],
            availableScenes: [],
            authorNarrative: emptyAuthorNarrativeState(),
            authorRandomEventState: emptyAuthorRandomEventState(),
            agentThoughts: [],
          },
        };
        set((s) => ({
          saves: { ...s.saves, [id]: save },
          activeSaveId: id,
        }));
        persistRuntimeSoon(save);
        return id;
      },

      importSave: (incoming) => {
        if (isLegacyAuthorSave(incoming)) {
          throw new Error('此旅程包来自不兼容的旧版本（无主弧数据）。请使用新版重新创建旅程。');
        }
        const now = nowMs();
        const id = genId('save');
        const save: GameSave = {
          ...incoming,
          id,
          name: incoming.name || '导入的旅程',
          createdAt: incoming.createdAt || now,
          updatedAt: now,
        };
        set((s) => ({
          saves: { ...s.saves, [id]: save },
          activeSaveId: id,
        }));
        persistRuntimeSoon(save);
        return id;
      },

      setActive: (id) => set({ activeSaveId: id }),

      deleteSave: (id) =>
        set((s) => {
          const { [id]: _removed, ...rest } = s.saves;
          void deleteSaveData(id).catch((err) => reportLedgerError('deleteSaveData', err));
          return {
            saves: rest,
            activeSaveId: s.activeSaveId === id ? undefined : s.activeSaveId,
          };
        }),

      renameSave: (id, name) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const next = touch(save, { name });
          persistMetaSoon(next);
          return { saves: { ...s.saves, [id]: next } };
        }),

      updateContentOf: (id, patch) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const next = touch(save, { content: { ...save.content, ...patch } });
          persistMetaSoon(next);
          return {
            saves: { ...s.saves, [id]: next },
          };
        }),

      updateStateOf: (id, patch) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const next = touch(save, { state: { ...save.state, ...patch } });
          persistMetaSoon(next);
          return {
            saves: { ...s.saves, [id]: next },
          };
        }),

      replaceState: (id, updater) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const next = touch(save, { state: updater(save.state) });
          persistMetaSoon(next);
          return {
            saves: { ...s.saves, [id]: next },
          };
        }),

      captureSnapshot: (id, label, round) => {
        const save = get().saves[id];
        if (!save) return;
        void persistSnapshot(save, label, round).catch((err) => reportLedgerError('captureSnapshot', err));
      },

      setLongTermMemory: (id, memory, round) =>
        get().updateStateOf(id, {
          longTermMemory: memory.trim(),
          lastMemoryRound: Math.max(0, Math.floor(round)),
        }),

      appendMessage: (id, msg) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const state = { ...save.state, history: [...save.state.history, msg] };
          const next = touch(save, { state });
          persistRuntimeSoon(next);
          return { saves: { ...s.saves, [id]: next } };
        }),

      updateAssistantRuntimeStats: (id, round, patch) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          let target = -1;
          for (let i = save.state.history.length - 1; i >= 0; i -= 1) {
            const msg = save.state.history[i];
            if (msg.role === 'assistant' && msg.round === round) {
              target = i;
              break;
            }
          }
          if (target < 0) return s;
          const history = save.state.history.map((msg, index) => {
            if (index !== target) return msg;
            return {
              ...msg,
              toolEvents: patch.toolEvents ?? msg.toolEvents,
              runtimeStats: {
                ...(msg.runtimeStats ?? {}),
                ...(patch.runtimeStats ?? {}),
              },
            };
          });
          const next = touch(save, { state: { ...save.state, history } });
          persistRuntimeSoon(next);
          return { saves: { ...s.saves, [id]: next } };
        }),

      addAgentThought: (id, thought) =>
        set((s) => {
          const save = s.saves[id];
          const content = thought.content?.trim().slice(0, 12000);
          const output = thought.output?.trim().slice(0, 16000);
          const prompt = normalizePromptTrace(thought.prompt);
          const usage = normalizeLlmUsage(thought.usage);
          const cacheHit = hasCacheHit(usage, thought.cacheHit);
          if (!save || (!content && !output && !prompt && !usage && !cacheHit)) return s;
          const next: AgentThought = {
            id: thought.id || genId('thought'),
            kind: thought.kind.trim().slice(0, 40) || 'model',
            label: thought.label.trim().slice(0, 40) || '模型',
            round: Math.max(0, Math.floor(Number(thought.round) || save.state.currentRound)),
            content: content || undefined,
            output: output || undefined,
            prompt,
            usage,
            cacheHit,
            createdAt: thought.createdAt || nowMs(),
          };
          const state = {
            ...save.state,
            agentThoughts: [...(save.state.agentThoughts ?? []), next].slice(-80),
          };
          const nextSave = touch(save, { state });
          persistMetaSoon(nextSave);
          void addAgentCall(id, next).catch((err) => reportLedgerError('addAgentCall', err));
          return { saves: { ...s.saves, [id]: nextSave } };
        }),

      updateMessage: (id, historyIndex, content) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const msg = save.state.history[historyIndex];
          const nextContent = content.trim();
          if (!msg || !nextContent) return s;

          const history = save.state.history.map((m, i) =>
            i === historyIndex ? { ...m, content: nextContent } : m,
          );
          const latest = latestAssistantIndex(save.state.history);
          const isLatestAssistant = msg.role === 'assistant' && historyIndex === latest;
          const pendingClean = isLatestAssistant && save.state.phase === 'choices'
            ? clearPendingDecisionItems(save.state, save.config.itemCapacity ?? 8)
            : {};
          const summaryInvalid = historyIndex < (save.state.summarizedUntilIndex ?? 0);
          const memoryInvalid = msg.round <= (save.state.lastMemoryRound ?? 0);
          const derivedClean = invalidateAuthorNarrativeAfterHistoryChange(save.state, msg.round);

          const state: GameState = {
            ...save.state,
            ...pendingClean,
            ...derivedClean,
            history,
            anchors: msg.role === 'assistant'
              ? (save.state.anchors ?? []).map((a) =>
                a.round === msg.round
                  ? { ...a, excerpt: nextContent.slice(0, 160), content: nextContent }
                  : a,
              )
              : save.state.anchors,
            error: undefined,
            regenerationHint: undefined,
            ...(summaryInvalid ? { summary: '', summarizedUntilIndex: 0 } : {}),
            ...(memoryInvalid ? { longTermMemory: '', lastMemoryRound: 0 } : {}),
            ...(isLatestAssistant && save.state.phase === 'choices' ? { lastChoices: undefined } : {}),
            ...(isLatestAssistant && save.state.phase === 'ended' ? { ending: nextContent, review: undefined } : {}),
            ...(msg.role === 'user' && save.state.lastPlayerInput === msg.content ? { lastPlayerInput: nextContent } : {}),
          };
          const next = touch(save, { state });
          persistRuntimeSoon(next);
          return { saves: { ...s.saves, [id]: next } };
        }),

      deleteMessage: (id, historyIndex) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const msg = save.state.history[historyIndex];
          if (!msg) return s;

          const history = save.state.history.filter((_, i) => i !== historyIndex);
          const latest = latestAssistantIndex(save.state.history);
          const isLatestAssistant = msg.role === 'assistant' && historyIndex === latest;
          const pendingClean = isLatestAssistant
            ? clearPendingDecisionItems(save.state, save.config.itemCapacity ?? 8)
            : {};
          const summaryInvalid = historyIndex <= (save.state.summarizedUntilIndex ?? 0);
          const memoryInvalid = msg.round <= (save.state.lastMemoryRound ?? 0);
          const lastUser = [...history].reverse().find((m) => m.role === 'user');
          const derivedClean = invalidateAuthorNarrativeAfterHistoryChange(save.state, msg.round);

          const state: GameState = {
            ...save.state,
            ...pendingClean,
            ...derivedClean,
            history,
            error: undefined,
            regenerationHint: undefined,
            ...(summaryInvalid ? { summary: '', summarizedUntilIndex: 0 } : {}),
            ...(memoryInvalid ? { longTermMemory: '', lastMemoryRound: 0 } : {}),
            ...(isLatestAssistant ? {
              phase: save.state.phase === 'ended' || save.state.phase === 'choices' ? 'manual' : save.state.phase,
              lastChoices: undefined,
              ending: undefined,
              review: undefined,
            } : {}),
            ...(msg.role === 'assistant'
              ? { anchors: (save.state.anchors ?? []).filter((a) => a.round !== msg.round) }
              : {}),
            ...(msg.role === 'user' && save.state.lastPlayerInput === msg.content
              ? { lastPlayerInput: lastUser?.content }
              : {}),
          };
          const next = touch(save, { state });
          persistRuntimeSoon(next);
          return { saves: { ...s.saves, [id]: next } };
        }),

      updateAssistantMessage: (id, historyIndex, content) =>
        get().updateMessage(id, historyIndex, content),

      regenerateAssistantMessage: (id, historyIndex, hint) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const msg = save.state.history[historyIndex];
          if (!msg || msg.role !== 'assistant') return s;

          const history = save.state.history.slice(0, historyIndex);
          const lastUser = [...history].reverse().find((m) => m.role === 'user');
          const pendingClean = clearPendingDecisionItems(save.state, save.config.itemCapacity ?? 8);
          const summaryInvalid =
            historyIndex <= (save.state.summarizedUntilIndex ?? 0) ||
            history.length < (save.state.summarizedUntilIndex ?? 0);
          const memoryInvalid = msg.round <= (save.state.lastMemoryRound ?? 0);
          const regenerationHint = hint?.trim().slice(0, 1200) || undefined;
          const derivedClean = invalidateAuthorNarrativeAfterHistoryChange(save.state, msg.round);

          const state: GameState = {
            ...save.state,
            ...pendingClean,
            ...derivedClean,
            history,
            currentRound: msg.round,
            lastPlayerInput: lastUser?.content,
            regenerationHint,
            phase: 'story',
            lastChoices: undefined,
            ending: undefined,
            review: undefined,
            error: undefined,
            triggeredEvents: (save.state.triggeredEvents ?? []).filter((ev) => ev.round < msg.round),
            anchors: (save.state.anchors ?? []).filter((a) => a.round < msg.round),
            availableScenes: [],
            ...(summaryInvalid ? { summary: '', summarizedUntilIndex: 0 } : {}),
            ...(memoryInvalid ? { longTermMemory: '', lastMemoryRound: 0 } : {}),
          };
          const next = touch(save, { state });
          persistRuntimeSoon(next);
          void syncRoundsFromSave(next).catch((err) => reportLedgerError('syncRoundsFromSave', err));
          return { saves: { ...s.saves, [id]: next } };
        }),

      rollbackEditMessage: (id, historyIndex, content) => {
        const nextContent = content.trim();
        if (!nextContent) return;
        void (async () => {
          const save = get().saves[id];
          const msg = save?.state.history[historyIndex];
          if (!save || !msg) return;
          if (!canRollbackRound(save, msg.round)) return;
          const preferred: SnapshotLabel[] = msg.role === 'user'
            ? ['before_player_input']
            : ['before_story'];
          const snapshot = await findRollbackSnapshot(id, msg.round, preferred);
          if (!snapshot) {
            reportLedgerError('rollbackEditMessage', new Error(`未找到第 ${msg.round} 回合的回滚快照`));
            return;
          }
          const restored = await restoreSnapshotState(save, snapshot);
          await pruneAfter(id, msg.round, true);
          const edited: Message = { ...msg, content: nextContent };
          let state: GameState;
          if (msg.role === 'user') {
            state = {
              ...restored.state,
              history: [...restored.state.history, edited],
              agentThoughts: (restored.state.agentThoughts ?? []).filter((t) => t.round < msg.round),
              currentRound: msg.round,
              lastPlayerInput: nextContent,
              phase: 'story',
              lastChoices: undefined,
              ending: undefined,
              review: undefined,
              error: undefined,
              regenerationHint: undefined,
            };
          } else if (msg.role === 'assistant') {
            const nextPhase = save.state.phase === 'ended' ? 'ended' : phaseAfterAssistant(save.config, msg.round);
            state = {
              ...restored.state,
              history: [...restored.state.history, edited],
              agentThoughts: (restored.state.agentThoughts ?? []).filter((t) => t.round < msg.round),
              currentRound: msg.round + 1,
              lastPlayerInput: undefined,
              phase: nextPhase,
              lastChoices: undefined,
              ending: nextPhase === 'ended' ? nextContent : undefined,
              review: undefined,
              error: undefined,
              regenerationHint: undefined,
              anchors: (restored.state.anchors ?? []).map((a) =>
                a.round === msg.round
                  ? { ...a, excerpt: nextContent.slice(0, 160), content: nextContent }
                  : a,
              ),
            };
          } else {
            state = { ...restored.state, history: [...restored.state.history, edited] };
          }
          const next = touch(restored, { state });
          set((s) => ({ saves: { ...s.saves, [id]: next } }));
          persistRuntimeSoon(next);
        })().catch((err) => {
          reportLedgerError('rollbackEditMessage', err);
        });
      },

      rollbackDeleteMessage: (id, historyIndex) => {
        void (async () => {
          const save = get().saves[id];
          const msg = save?.state.history[historyIndex];
          if (!save || !msg) return;
          if (!canRollbackRound(save, msg.round)) return;
          const preferred: SnapshotLabel[] = msg.role === 'user'
            ? ['before_player_input']
            : ['before_story'];
          const snapshot = await findRollbackSnapshot(id, msg.round, preferred);
          if (!snapshot) {
            reportLedgerError('rollbackDeleteMessage', new Error(`未找到第 ${msg.round} 回合的回滚快照`));
            return;
          }
          const restored = await restoreSnapshotState(save, snapshot);
          await pruneAfter(id, msg.round, true);
          const state: GameState = {
            ...restored.state,
            agentThoughts: (restored.state.agentThoughts ?? []).filter((t) => t.round < msg.round),
            phase: msg.role === 'assistant' ? 'manual' : restored.state.phase,
            lastChoices: undefined,
            ending: undefined,
            review: undefined,
            error: undefined,
            regenerationHint: undefined,
            lastPlayerInput: msg.role === 'user' ? latestUserContent(restored.state.history) : restored.state.lastPlayerInput,
            anchors: msg.role === 'assistant'
              ? (restored.state.anchors ?? []).filter((a) => a.round !== msg.round)
              : restored.state.anchors,
          };
          const next = touch(restored, { state });
          set((s) => ({ saves: { ...s.saves, [id]: next } }));
          persistRuntimeSoon(next);
        })().catch((err) => {
          reportLedgerError('rollbackDeleteMessage', err);
        });
      },

      rollbackRegenerateAssistant: (id, historyIndex, hint) => {
        void (async () => {
          const save = get().saves[id];
          const msg = save?.state.history[historyIndex];
          if (!save || !msg || msg.role !== 'assistant') return;
          if (!canRollbackRound(save, msg.round)) return;
          const snapshot = await findRollbackSnapshot(id, msg.round, ['before_story']);
          if (!snapshot) {
            reportLedgerError('rollbackRegenerateAssistant', new Error(`未找到第 ${msg.round} 回合的回滚快照`));
            return;
          }
          const restored = await restoreSnapshotState(save, snapshot);
          await pruneAfter(id, msg.round, true);
          const regenerationHint = hint?.trim().slice(0, 1200) || undefined;
          const state: GameState = {
            ...restored.state,
            agentThoughts: (restored.state.agentThoughts ?? []).filter((t) => t.round < msg.round),
            currentRound: msg.round,
            lastPlayerInput: latestUserContent(restored.state.history),
            regenerationHint,
            phase: 'story',
            lastChoices: undefined,
            ending: undefined,
            review: undefined,
            error: undefined,
          };
          const next = touch(restored, { state });
          set((s) => ({ saves: { ...s.saves, [id]: next } }));
          persistRuntimeSoon(next);
        })().catch((err) => {
          reportLedgerError('rollbackRegenerateAssistant', err);
        });
      },

      setPhase: (id, phase) => get().updateStateOf(id, { phase }),
      setChoices: (id, choices) => get().updateStateOf(id, { lastChoices: choices }),
      setLastPlayerInput: (id, text) => get().updateStateOf(id, { lastPlayerInput: text }),
      incrementRound: (id) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const state = { ...save.state, currentRound: save.state.currentRound + 1 };
          return { saves: { ...s.saves, [id]: touch(save, { state }) } };
        }),

      addTriggeredEvent: (id, evId, round) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const state = {
            ...save.state,
            triggeredEvents: [...save.state.triggeredEvents, { id: evId, round }],
          };
          return { saves: { ...s.saves, [id]: touch(save, { state }) } };
        }),

      endGame: (id, ending) => get().updateStateOf(id, { phase: 'ended', ending }),
      setError: (id, error) => get().updateStateOf(id, { error }),

      grantRefresh: (id, amount = 1) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const state = {
            ...save.state,
            refreshesLeft: (save.state.refreshesLeft ?? 0) + amount,
          };
          return { saves: { ...s.saves, [id]: touch(save, { state }) } };
        }),

      consumeRefresh: (id) => {
        const s = get();
        const save = s.saves[id];
        if (!save || (save.state.refreshesLeft ?? 0) <= 0) return false;
        set((curr) => {
          const cur = curr.saves[id];
          if (!cur) return curr;
          const state = {
            ...cur.state,
            refreshesLeft: Math.max(0, (cur.state.refreshesLeft ?? 0) - 1),
            lastChoices: undefined,
          };
          return { saves: { ...curr.saves, [id]: touch(cur, { state }) } };
        });
        return true;
      },

      applyDecisionResult: (id, grantKey, grants, destroys, itemPatches, round) => {
        const appliedDestroys: RawDestroy[] = [];
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          // 1. 清理上一轮决策留下的 pending：已 pendingGrantKey 的条目删除；已 pendingDestroy 的标记清掉
          let items = (save.state.backpack ?? [])
            .filter((it) => !it.pendingGrantKey)
            .map((it) => (it.pendingDestroy ? { ...it, pendingDestroy: undefined, destroyReason: undefined } : it));

          // 2. 应用模型对既有能力的补丁（update 直接生效；delete 与 destroys 一样先做 pending）
          items = applyItemPatches(items, itemPatches ?? [], appliedDestroys);

          // 3. 加入新的 grants（去重 by name）
          const existingNames = new Set(items.map((it) => it.name.trim()));
          const fresh: Item[] = (grants ?? [])
            .filter((g) => g && typeof g.name === 'string' && g.name.trim())
            .slice(0, 6)
            .map((g) => createItem(g, round, grantKey));
          for (const f of fresh) {
            if (existingNames.has(f.name.trim())) continue;
            items.push(f);
            existingNames.add(f.name.trim());
          }

          // 4. 标记 destroys（优先按 id，兼容旧协议按 name 完全匹配）
          for (const d of (destroys ?? []).slice(0, 4)) {
            const targetName = (d?.name ?? '').trim();
            const targetId = d?.id?.trim();
            if (!targetName && !targetId) continue;
            markItemPendingDestroy(items, { id: targetId, name: targetName, reason: d.reason }, appliedDestroys);
          }

          // 5. 清理已不存在 / 待失效能力的选中态
          const validForSelect = new Set(
            items.filter((it) => !it.pendingDestroy).map((it) => it.id),
          );
          const selectedItemIds = (save.state.selectedItemIds ?? []).filter((x) => validForSelect.has(x));

          // 6. 容量检查：待失效能力不计入占用
          const capacity = save.config.itemCapacity ?? 8;
          const effectiveCount = items.filter((it) => !it.pendingDestroy).length;
          const needsDiscard = Math.max(0, effectiveCount - capacity);

          return {
            saves: { ...s.saves, [id]: touch(save, { state: { ...save.state, backpack: items, selectedItemIds, needsDiscard } }) },
          };
        });
        return appliedDestroys;
      },

      commitPendingGrants: (id) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const backpack = (save.state.backpack ?? [])
            .filter((it) => !it.pendingDestroy)              // 实际移除失效能力
            .map((it) => (it.pendingGrantKey                  // 固化 grants
              ? { ...it, pendingGrantKey: undefined }
              : it));
          const validIds = new Set(backpack.map((it) => it.id));
          const selectedItemIds = (save.state.selectedItemIds ?? []).filter((x) => validIds.has(x));
          return {
            saves: { ...s.saves, [id]: touch(save, { state: { ...save.state, backpack, selectedItemIds } }) },
          };
        }),

      toggleSelectItem: (id, itemId) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const cur = save.state.selectedItemIds ?? [];
          const exists = cur.includes(itemId);
          const selectedItemIds = exists ? cur.filter((x) => x !== itemId) : [...cur, itemId];
          return {
            saves: { ...s.saves, [id]: touch(save, { state: { ...save.state, selectedItemIds } }) },
          };
        }),

      clearSelectedItems: (id) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          return {
            saves: { ...s.saves, [id]: touch(save, { state: { ...save.state, selectedItemIds: [] } }) },
          };
        }),

      consumeSelectedConsumables: (id) => {
        const save = get().saves[id];
        if (!save) return [];
        const selected = new Set(save.state.selectedItemIds ?? []);
        const backpack = save.state.backpack ?? [];
        const consumed: Item[] = [];
        const remaining: Item[] = [];
        for (const it of backpack) {
          if (selected.has(it.id) && it.type === 'consumable') {
            consumed.push(it);
          } else {
            remaining.push(it);
          }
        }
        if (consumed.length) {
          set((s) => {
            const cur = s.saves[id];
            if (!cur) return s;
            return {
              saves: { ...s.saves, [id]: touch(cur, { state: { ...cur.state, backpack: remaining } }) },
            };
          });
        }
        return consumed;
      },

      discardItems: (id, itemIds) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const dropSet = new Set(itemIds);
          const backpack = (save.state.backpack ?? []).filter((it) => !dropSet.has(it.id));
          const selectedItemIds = (save.state.selectedItemIds ?? []).filter((x) => !dropSet.has(x));
          const capacity = save.config.itemCapacity ?? 8;
          const needsDiscard = Math.max(0, backpack.length - capacity);
          return {
            saves: { ...s.saves, [id]: touch(save, { state: { ...save.state, backpack, selectedItemIds, needsDiscard } }) },
          };
        }),

      setReview: (id, review) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          return {
            saves: { ...s.saves, [id]: touch(save, { state: { ...save.state, review } }) },
          };
        }),

      requestFinalize: (id) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          return {
            saves: { ...s.saves, [id]: touch(save, { state: { ...save.state, finalizeRequested: true } }) },
          };
        }),

      clearFinalize: (id) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          return {
            saves: { ...s.saves, [id]: touch(save, { state: { ...save.state, finalizeRequested: false } }) },
          };
        }),

      applyNpcUpdates: (id, updates, round) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          if (!updates?.length) return s;
          const npcs = [...(save.state.npcs ?? [])];
          for (const u of updates) {
            const name = (u.name ?? '').trim();
            const action = u.action ?? 'upsert';
            const idx = findNpcIndex(npcs, { id: u.id, name, role: u.role });

            if (action === 'delete') {
              if (idx >= 0) npcs.splice(idx, 1);
              continue;
            }

            if (idx >= 0) {
              const current = npcs[idx];
              const next: Npc = {
                ...current,
                name: name.slice(0, 20) || current.name,
                role: u.role?.trim() ? u.role.trim().slice(0, 30) : current.role,
                description: u.description?.trim() ? u.description.trim().slice(0, 160) : current.description,
                affinity: normalizeNpcAffinity(current.affinity, u.affinity, u.affinityDelta),
                lastRound: round,
                appearances: current.appearances + 1,
                details: mergeNpcDetails(current.details, u.details, u.replaceDetails),
                recentNote: u.note?.trim() ? u.note.trim().slice(0, 80) : current.recentNote,
              };
              npcs[idx] = next;
            } else {
              if (!name) continue;
              const next: Npc = {
                id: u.id?.trim() || genId('npc'),
                name: name.slice(0, 20),
                role: u.role?.trim() ? u.role.trim().slice(0, 30) : undefined,
                description: u.description?.trim() ? u.description.trim().slice(0, 160) : undefined,
                affinity: normalizeNpcAffinity(0, u.affinity, u.affinityDelta),
                firstRound: round,
                lastRound: round,
                appearances: 1,
                details: mergeNpcDetails(undefined, u.details, true),
                recentNote: u.note?.trim() ? u.note.trim().slice(0, 80) : undefined,
              };
              npcs.push(next);
            }
          }
          return {
            saves: { ...s.saves, [id]: touch(save, { state: { ...save.state, npcs } }) },
          };
        }),

      setScenes: (id, current, available) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          // 若模型没返回 currentScene 就保留上一回合的 current，避免抖动
          const normalizedCurrent = current ? normalizeScene(current) : undefined;
          const prevCurrent = save.state.currentScene ? normalizeScene(save.state.currentScene) : undefined;
          const nextCurrent = normalizedCurrent
            ? {
              ...normalizedCurrent,
              time: normalizedCurrent.time || (normalizedCurrent.name === prevCurrent?.name ? prevCurrent.time : undefined),
              weather: normalizedCurrent.weather || (normalizedCurrent.name === prevCurrent?.name ? prevCurrent.weather : undefined),
            }
            : prevCurrent;
          const sceneHistory = mergeScenes(save.state.sceneHistory ?? [], [
            nextCurrent,
            ...(available ?? []),
          ]);
          return {
            saves: {
              ...s.saves,
              [id]: touch(save, {
                state: {
                  ...save.state,
                  currentScene: nextCurrent,
                  availableScenes: available ?? [],
                  sceneHistory,
                },
              }),
            },
          };
        }),

      setAuthorNarrativeState: (id, state) =>
        get().updateStateOf(id, { authorNarrative: normalizeAuthorNarrativeState(state) }),

      setAuthorRandomEventState: (id, state) =>
        get().updateStateOf(id, { authorRandomEventState: normalizeAuthorRandomEventState(state) }),

      setPendingAuthorEvent: (id, arc, pendingForRound, resetProbability) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const prev = normalizeAuthorRandomEventState(save.state.authorRandomEventState);
          const pending = normalizeStoryArc({
            ...arc,
            status: 'pending',
            lifecycle: arc.lifecycle ?? 'candidate',
            progressPercent: arc.progressPercent ?? 0,
            startRound: pendingForRound,
            updatedAtRound: pendingForRound,
          });
          if (!pending) return s;
          const state: GameState = {
            ...save.state,
            authorRandomEventState: {
              ...prev,
              pendingEvent: pending,
              pendingForRound,
              currentProbability: Number.isFinite(resetProbability) ? resetProbability : prev.currentProbability,
              lastCheckedRound: pendingForRound,
              lastError: undefined,
            },
          };
          return { saves: { ...s.saves, [id]: touch(save, { state }) } };
        }),

      activatePendingAuthorEvent: (id, round) => {
        let activated: StoryArc | undefined;
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const prev = normalizeAuthorRandomEventState(save.state.authorRandomEventState);
          if (!prev.pendingEvent || prev.pendingForRound !== round) return s;
          activated = {
            ...prev.pendingEvent,
            status: 'active',
            lifecycle: prev.pendingEvent.lifecycle === 'candidate' || !prev.pendingEvent.lifecycle
              ? 'active'
              : prev.pendingEvent.lifecycle,
            progressPercent: prev.pendingEvent.progressPercent ?? 0,
            startRound: prev.pendingEvent.startRound || round,
            updatedAtRound: round,
          };
          const state: GameState = {
            ...save.state,
            authorRandomEventState: {
              ...prev,
              pendingEvent: undefined,
              pendingForRound: undefined,
              activeEvents: [...prev.activeEvents.filter((ev) => ev.id !== activated!.id), activated],
              lastError: undefined,
            },
          };
          return { saves: { ...s.saves, [id]: touch(save, { state }) } };
        });
        return activated;
      },

      upsertAuthorArc: (id, arc) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const prev = normalizeAuthorNarrativeState(save.state.authorNarrative);
          const normalized = normalizeStoryArc(arc);
          if (!normalized) return s;
          const activeArc: StoryArc = {
            ...normalized,
            status: normalized.status === 'completed' ? 'completed' : 'active',
            lifecycle: normalized.status === 'completed'
              ? 'completed'
              : normalized.lifecycle === 'candidate' || !normalized.lifecycle
                ? 'active'
                : normalized.lifecycle,
          };
          const activeArcs: StoryArc[] = [
            ...prev.activeArcs.filter((item) => item.id !== normalized.id),
            activeArc,
          ];
          const state: GameState = {
            ...save.state,
            authorNarrative: {
              ...prev,
              activeArcs,
            },
          };
          return { saves: { ...s.saves, [id]: touch(save, { state }) } };
        }),

      completeAuthorArc: (id, arcId, round) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const narrative = normalizeAuthorNarrativeState(save.state.authorNarrative);
          const events = normalizeAuthorRandomEventState(save.state.authorRandomEventState);
          const completedAt = Math.max(0, Math.floor(Number(round) || save.state.currentRound));
          const complete = (arc: StoryArc): StoryArc => ({
            ...arc,
            status: 'completed',
            lifecycle: 'completed',
            progressPercent: 100,
            updatedAtRound: completedAt,
            progressNote: arc.progressNote || `已在第 ${completedAt} 回合后结束。`,
          });
          const targetNarrative = narrative.activeArcs.find((arc) => arc.id === arcId);
          const targetEvent = events.activeEvents.find((arc) => arc.id === arcId);
          if (!targetNarrative && !targetEvent) return s;
          const state: GameState = {
            ...save.state,
            authorNarrative: targetNarrative
              ? {
                ...narrative,
                activeArcs: narrative.activeArcs.filter((arc) => arc.id !== arcId),
                completedArcs: [...narrative.completedArcs.filter((arc) => arc.id !== arcId), complete(targetNarrative)],
              }
              : save.state.authorNarrative,
            authorRandomEventState: targetEvent
              ? {
                ...events,
                activeEvents: events.activeEvents.filter((arc) => arc.id !== arcId),
                completedEvents: [...events.completedEvents.filter((arc) => arc.id !== arcId), complete(targetEvent)],
              }
              : save.state.authorRandomEventState,
          };
          return { saves: { ...s.saves, [id]: touch(save, { state }) } };
        }),

      advanceAuthorArcs: (id, currentRound) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const narrative = normalizeAuthorNarrativeState(save.state.authorNarrative);
          const events = normalizeAuthorRandomEventState(save.state.authorRandomEventState);
          const round = Math.max(0, Math.floor(Number(currentRound) || save.state.currentRound));
          const advance = (arc: StoryArc): StoryArc => {
            const idx = arc.stages.findIndex((stage) => round >= stage.startRound && round <= stage.endRound);
            if (idx < 0) return arc;
            const nextProgress = computeArcProgressPercent(arc, round, idx);
            const nextLifecycle = activeArcLifecycle(arc, idx !== arc.currentStageIndex ? 'progressing' : arc.lifecycle ?? 'active');
            if (
              idx !== arc.currentStageIndex
              || nextProgress !== arc.progressPercent
              || nextLifecycle !== arc.lifecycle
            ) {
              return {
                ...arc,
                currentStageIndex: idx,
                lifecycle: nextLifecycle,
                progressPercent: nextProgress,
                updatedAtRound: round,
              };
            }
            return arc;
          };
          const closeExpired = (arc: StoryArc) =>
            arc.targetEndRound !== undefined && round > arc.targetEndRound;
          const completed = (arc: StoryArc): StoryArc => ({
            ...arc,
            status: 'completed',
            lifecycle: 'completed',
            progressPercent: 100,
            updatedAtRound: round,
            progressNote: arc.progressNote || `已在第 ${round} 回合后自然结束。`,
          });
          let changed = false;
          const activeArcs = narrative.activeArcs.map((arc) => {
            const next = advance(arc);
            if (next !== arc) changed = true;
            return next;
          });
          const activeEvents = events.activeEvents.map((arc) => {
            const next = advance(arc);
            if (next !== arc) changed = true;
            return next;
          });
          const expiredArcs = activeArcs.filter(closeExpired).map(completed);
          const expiredEvents = activeEvents.filter(closeExpired).map(completed);
          if (!changed && !expiredArcs.length && !expiredEvents.length) return s;
          const state: GameState = {
            ...save.state,
            authorNarrative: {
              ...narrative,
              activeArcs: activeArcs.filter((arc) => !closeExpired(arc)),
              completedArcs: [...narrative.completedArcs, ...expiredArcs],
            },
            authorRandomEventState: {
              ...events,
              activeEvents: activeEvents.filter((arc) => !closeExpired(arc)),
              completedEvents: [...events.completedEvents, ...expiredEvents],
            },
          };
          return { saves: { ...s.saves, [id]: touch(save, { state }) } };
        }),

      applyAuthorEventUpdates: (id, updates, round) =>
        set((s) => {
          const save = s.saves[id];
          if (!save || !updates?.length) return s;
          const narrative = normalizeAuthorNarrativeState(save.state.authorNarrative);
          const events = normalizeAuthorRandomEventState(save.state.authorRandomEventState);
          const updatedAt = Math.max(0, Math.floor(Number(round) || save.state.currentRound));
          let changed = false;

          const applyList = (arcs: StoryArc[]) => arcs.map((arc) => {
            const update = updates.find((item) => matchArcUpdate(arc, item));
            if (!update) return arc;
            changed = true;
            return applyArcUpdate(arc, update, updatedAt);
          });

          const narrativeUpdated = applyList(narrative.activeArcs);
          const eventUpdated = applyList(events.activeEvents);
          const pendingEvent = events.pendingEvent
            ? updates.some((item) => matchArcUpdate(events.pendingEvent!, item))
              ? applyArcUpdate(
                events.pendingEvent,
                updates.find((item) => matchArcUpdate(events.pendingEvent!, item))!,
                updatedAt,
              )
              : events.pendingEvent
            : undefined;
          if (pendingEvent !== events.pendingEvent) changed = true;
          if (!changed) return s;

          const split = (arcs: StoryArc[]) => ({
            active: arcs.filter((arc) => !isTerminalArcLifecycle(arc.lifecycle)),
            completed: arcs.filter((arc) => isTerminalArcLifecycle(arc.lifecycle)),
          });
          const narrativeSplit = split(narrativeUpdated);
          const eventSplit = split(eventUpdated);
          const pendingIsTerminal = pendingEvent && isTerminalArcLifecycle(pendingEvent.lifecycle);
          const state: GameState = {
            ...save.state,
            authorNarrative: {
              ...narrative,
              activeArcs: narrativeSplit.active,
              completedArcs: [
                ...narrative.completedArcs.filter((arc) => !narrativeSplit.completed.some((item) => item.id === arc.id)),
                ...narrativeSplit.completed,
              ],
            },
            authorRandomEventState: {
              ...events,
              pendingEvent: pendingIsTerminal ? undefined : pendingEvent,
              pendingForRound: pendingIsTerminal ? undefined : events.pendingForRound,
              activeEvents: eventSplit.active,
              completedEvents: [
                ...events.completedEvents.filter((arc) => !eventSplit.completed.some((item) => item.id === arc.id)),
                ...eventSplit.completed,
                ...(pendingIsTerminal ? [pendingEvent] : []),
              ],
            },
          };
          return { saves: { ...s.saves, [id]: touch(save, { state }) } };
        }),

      setMasterArc: (id, masterArc) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const narrative = normalizeAuthorNarrativeState(save.state.authorNarrative);
          return {
            saves: {
              ...s.saves,
              [id]: touch(save, {
                state: {
                  ...save.state,
                  authorNarrative: {
                    ...narrative,
                    masterArc: normalizeMasterArc(masterArc),
                  },
                },
              }),
            },
          };
        }),

      advanceMasterArcStage: (id) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const narrative = normalizeAuthorNarrativeState(save.state.authorNarrative);
          const masterArc = normalizeMasterArc(narrative.masterArc);
          if (!masterArc) return s;
          const currentIndex = masterArc.currentStageIndex;
          const current = masterArc.stages[currentIndex];
          if (!current) return s;
          const nextIndex = currentIndex + 1;
          const round = save.state.currentRound;
          const stages = masterArc.stages.map((stage, index) => {
            if (index === currentIndex) {
              return {
                ...stage,
                status: stage.status === 'skipped' ? 'skipped' as const : 'completed' as const,
                exitedAtRound: round,
              };
            }
            if (index === nextIndex) {
              return {
                ...stage,
                status: 'active' as const,
                enteredAtRound: stage.enteredAtRound ?? round,
              };
            }
            return stage;
          });
          const nextMasterArc: MasterArcState = {
            ...masterArc,
            stages,
            currentStageIndex: Math.min(nextIndex, stages.length - 1),
            updatedAtRound: round,
          };
          return {
            saves: {
              ...s.saves,
              [id]: touch(save, {
                state: {
                  ...save.state,
                  authorNarrative: {
                    ...narrative,
                    masterArc: nextMasterArc,
                  },
                },
              }),
            },
          };
        }),

      markStageBeatAchieved: (id, beatId, round) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const narrative = normalizeAuthorNarrativeState(save.state.authorNarrative);
          const masterArc = normalizeMasterArc(narrative.masterArc);
          if (!masterArc) return s;
          const current = masterArc.stages[masterArc.currentStageIndex];
          if (!current) return s;
          const atRound = Math.max(0, Math.floor(Number(round) || save.state.currentRound));
          let changed = false;
          const stages = masterArc.stages.map((stage, stageIndex) => {
            if (stageIndex !== masterArc.currentStageIndex) return stage;
            return {
              ...stage,
              expectedBeats: stage.expectedBeats.map((beat) => {
                if (beat.id !== beatId || beat.status === 'achieved') return beat;
                changed = true;
                return { ...beat, status: 'achieved' as const, achievedAtRound: atRound };
              }),
            };
          });
          if (!changed) return s;
          return {
            saves: {
              ...s.saves,
              [id]: touch(save, {
                state: {
                  ...save.state,
                  authorNarrative: {
                    ...narrative,
                    masterArc: {
                      ...masterArc,
                      stages,
                      updatedAtRound: atRound,
                    },
                  },
                },
              }),
            },
          };
        }),

      applyStageJudgeResult: (id, result, completedRound) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const narrative = normalizeAuthorNarrativeState(save.state.authorNarrative);
          const masterArc = normalizeMasterArc(narrative.masterArc);
          const beatIds = new Set(
            masterArc?.stages[masterArc.currentStageIndex]?.expectedBeats.map((b) => b.id) ?? [],
          );
          const newlyAchievedBeats = (result.stageStatus.newlyAchievedBeats ?? [])
            .filter((beatId) => beatIds.has(beatId));
          const nextMasterArc = masterArc
            ? {
              ...masterArc,
              stages: masterArc.stages.map((stage, index) => {
                if (index !== masterArc.currentStageIndex) return stage;
                return {
                  ...stage,
                  expectedBeats: stage.expectedBeats.map((beat) =>
                    newlyAchievedBeats.includes(beat.id) && beat.status !== 'achieved'
                      ? { ...beat, status: 'achieved' as const, achievedAtRound: completedRound }
                      : beat,
                  ),
                };
              }),
              updatedAtRound: completedRound,
            }
            : undefined;
          const stageJudge: StageJudgeState = {
            ...result,
            stageStatus: {
              ...result.stageStatus,
              newlyAchievedBeats,
            },
            updatedAtRound: completedRound,
            lastError: undefined,
            thinking: result.thinking,
          };
          return {
            saves: {
              ...s.saves,
              [id]: touch(save, {
                state: {
                  ...save.state,
                  authorNarrative: {
                    ...narrative,
                    masterArc: nextMasterArc ?? narrative.masterArc,
                    stageJudge,
                    lastStageJudgeRound: completedRound,
                  },
                },
              }),
            },
          };
        }),

      setStageJudgeError: (id, error) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const narrative = normalizeAuthorNarrativeState(save.state.authorNarrative);
          const prev = narrative.stageJudge;
          const fallback: StageJudgeState = prev ?? {
            updatedAtRound: save.state.currentRound,
            playerIntent: { primary: save.state.lastPlayerInput?.slice(0, 80) || '继续承接上文。' },
            playerPace: 'progressing',
            stageStatus: {
              currentStageId: narrative.masterArc?.stages[narrative.masterArc.currentStageIndex]?.id,
              completion: 0,
              newlyAchievedBeats: [],
              shouldAdvance: false,
            },
            storyFocus: {
              thisRound: '承接玩家输入，只推进当前情境中的一个微节拍。',
            },
          };
          return {
            saves: {
              ...s.saves,
              [id]: touch(save, {
                state: {
                  ...save.state,
                  authorNarrative: {
                    ...narrative,
                    stageJudge: {
                      ...fallback,
                      lastError: error?.trim().slice(0, 240) || undefined,
                    },
                  },
                },
              }),
            },
          };
        }),

      setOrchestratorState: (id, state) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const narrative = normalizeAuthorNarrativeState(save.state.authorNarrative);
          const orchestrator = normalizeOrchestratorState(state);
          if (!orchestrator) return s;
          return {
            saves: {
              ...s.saves,
              [id]: touch(save, {
                state: {
                  ...save.state,
                  authorNarrative: {
                    ...narrative,
                    orchestrator: { ...orchestrator, lastError: undefined },
                    lastOrchestratorRound: orchestrator.updatedAtRound,
                  },
                },
              }),
            },
          };
        }),

      setOrchestratorError: (id, error) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const narrative = normalizeAuthorNarrativeState(save.state.authorNarrative);
          return {
            saves: {
              ...s.saves,
              [id]: touch(save, {
                state: {
                  ...save.state,
                  authorNarrative: {
                    ...narrative,
                    orchestrator: {
                      ...(narrative.orchestrator ?? {
                        updatedAtRound: save.state.currentRound,
                        calls: defaultOrchestratorCalls(),
                      }),
                      lastError: error?.trim().slice(0, 240) || undefined,
                    },
                  },
                },
              }),
            },
          };
        }),

      setAuthorOutlineMapping: (id, state, round) => {
        const save = get().saves[id];
        const atRound = Math.max(0, Math.floor(Number(round ?? state?.updatedAtRound ?? save?.state.currentRound ?? 0) || 0));
        const nextMapping = state
          ? normalizeOutlineMapping({ ...state, updatedAtRound: atRound })
          : undefined;
        set((s) => {
          const current = s.saves[id];
          if (!current) return s;
          const narrative = normalizeAuthorNarrativeState(current.state.authorNarrative);
          return {
            saves: {
              ...s.saves,
              [id]: touch(current, {
                state: {
                  ...current.state,
                  authorNarrative: {
                    ...narrative,
                    outlineMapping: nextMapping,
                    lastOutlineMapperRound: nextMapping ? atRound : undefined,
                  },
                },
              }),
            },
          };
        });
      },

      setAuthorCharacterPlan: (id, state, round) => {
        const save = get().saves[id];
        const atRound = Math.max(0, Math.floor(Number(round ?? state?.updatedAtRound ?? save?.state.currentRound ?? 0) || 0));
        const nextPlan = state
          ? normalizeAuthorCharacterPlan({ ...state, updatedAtRound: atRound })
          : undefined;
        set((s) => {
          const current = s.saves[id];
          if (!current) return s;
          const narrative = normalizeAuthorNarrativeState(current.state.authorNarrative);
          return {
            saves: {
              ...s.saves,
              [id]: touch(current, {
                state: {
                  ...current.state,
                  authorNarrative: {
                    ...narrative,
                    characterPlan: nextPlan,
                    lastCharacterPlannerRound: nextPlan ? atRound : undefined,
                  },
                },
              }),
            },
          };
        });
      },

      setAuthorScenePlan: (id, state, round) => {
        const save = get().saves[id];
        const atRound = Math.max(0, Math.floor(Number(round ?? state?.updatedAtRound ?? save?.state.currentRound ?? 0) || 0));
        const nextPlan = state
          ? normalizeAuthorScenePlan({ ...state, updatedAtRound: atRound })
          : undefined;
        set((s) => {
          const current = s.saves[id];
          if (!current) return s;
          const narrative = normalizeAuthorNarrativeState(current.state.authorNarrative);
          return {
            saves: {
              ...s.saves,
              [id]: touch(current, {
                state: {
                  ...current.state,
                  authorNarrative: {
                    ...narrative,
                    scenePlan: nextPlan,
                    lastScenePlannerRound: nextPlan ? atRound : undefined,
                  },
                },
              }),
            },
          };
        });
      },

      setAuthorEventPlan: (id, state, round) => {
        const save = get().saves[id];
        const atRound = Math.max(0, Math.floor(Number(round ?? state?.updatedAtRound ?? save?.state.currentRound ?? 0) || 0));
        const nextPlan = state
          ? normalizeAuthorEventPlan({ ...state, updatedAtRound: atRound })
          : undefined;
        set((s) => {
          const current = s.saves[id];
          if (!current) return s;
          const narrative = normalizeAuthorNarrativeState(current.state.authorNarrative);
          return {
            saves: {
              ...s.saves,
              [id]: touch(current, {
                state: {
                  ...current.state,
                  authorNarrative: {
                    ...narrative,
                    eventPlan: nextPlan,
                    lastEventPlannerRound: nextPlan ? atRound : undefined,
                  },
                },
              }),
            },
          };
        });
        if (nextPlan?.eventUpdates?.length) {
          get().applyAuthorEventUpdates(id, nextPlan.eventUpdates, atRound);
        }
      },

      setAuthorEventBeat: (id, state, round) => {
        const save = get().saves[id];
        const atRound = Math.max(0, Math.floor(Number(round ?? state?.updatedAtRound ?? save?.state.currentRound ?? 0) || 0));
        const nextBeat = state
          ? normalizeEventBeatState({ ...state, updatedAtRound: atRound })
          : undefined;
        set((s) => {
          const current = s.saves[id];
          if (!current) return s;
          const narrative = normalizeAuthorNarrativeState(current.state.authorNarrative);
          return {
            saves: {
              ...s.saves,
              [id]: touch(current, {
                state: {
                  ...current.state,
                  authorNarrative: {
                    ...narrative,
                    eventBeat: nextBeat,
                    lastEventBeatRound: nextBeat ? atRound : undefined,
                  },
                },
              }),
            },
          };
        });
      },

      applySettingGuardResult: (id, result, completedRound) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const narrative = normalizeAuthorNarrativeState(save.state.authorNarrative);
          const oldGuard = narrative.settingGuard;

          const patches: SettingPatch[] = (result.patches ?? []).slice(0, 6).map((p) => ({
            ...p,
            id: genId('patch'),
            suggestedAtRound: completedRound,
          }));

          const candidatesByName = new Map<string, SettingGuardCandidate>();
          (oldGuard?.candidates ?? []).forEach((c) => candidatesByName.set(c.name, c));
          for (const raw of (result.candidates ?? []).slice(0, 2)) {
            const name = raw.name.trim();
            if (!name) continue;
            const existing = candidatesByName.get(name);
            if (existing && existing.status !== 'pending') continue;
            candidatesByName.set(name, {
              ...raw,
              name,
              id: existing?.id ?? genId('cand'),
              status: 'pending',
              suggestedAtRound: completedRound,
            });
          }

          const confidenceRank = { low: 0, medium: 1, high: 2 } as const;
          const oldPreference = oldGuard?.preference;
          let preference = oldPreference;
          if (result.preference) {
            if (
              !oldPreference
              || confidenceRank[result.preference.confidence] >= confidenceRank[oldPreference.confidence]
            ) {
              preference = {
                ...result.preference,
                updatedAtRound: completedRound,
              };
            }
          }

          const expireBefore = Math.max(0, completedRound - 3);
          const survivedBeats = (oldGuard?.pendingAmbientBeats ?? [])
            .filter((b) => !b.consumed && b.suggestedAtRound >= expireBefore);
          const newBeats: SettingGuardAmbientBeat[] = (result.ambientBeats ?? []).slice(0, 3).map((b) => ({
            ...b,
            id: genId('beat'),
            suggestedAtRound: completedRound,
          }));

          const settingGuard: SettingGuardState = {
            updatedAtRound: completedRound,
            patches,
            candidates: Array.from(candidatesByName.values()).slice(-SETTING_GUARD_CANDIDATE_LIMIT),
            preference,
            pendingAmbientBeats: [...survivedBeats, ...newBeats].slice(-12),
            deviation: result.deviation
              ? { ...result.deviation, flaggedAtRound: completedRound }
              : undefined,
            lastError: undefined,
            thinking: result.thinking,
          };

          return {
            saves: {
              ...s.saves,
              [id]: touch(save, {
                state: {
                  ...save.state,
                  authorNarrative: {
                    ...narrative,
                    settingGuard,
                    lastSettingGuardRound: completedRound,
                  },
                },
              }),
            },
          };
        }),

      acceptSettingCandidate: (id, candidateId) => {
        const save = get().saves[id];
        const guard = save?.state.authorNarrative?.settingGuard;
        const candidate = guard?.candidates.find((c) => c.id === candidateId);
        if (!save || !candidate) return;

        let sinkBookId: string | undefined;
        try {
          const contentStore = useContentStore.getState();
          const sinkName = `守护沉淀 · ${save.name}`;
          const existing = contentStore.customWorldBooks.find((book) => book.name === sinkName);
          const entry = {
            id: genId('wbe_guard'),
            name: candidate.name,
            keywords: candidate.keywords ?? [],
            content: candidate.content,
            priority: 90,
            alwaysActive: true,
          };
          if (existing) {
            sinkBookId = existing.id;
            contentStore.updateWorldBook({
              ...existing,
              entries: [
                ...existing.entries.filter((item) => item.name !== candidate.name),
                entry,
              ],
            });
          } else {
            sinkBookId = genId('wb_guard');
            contentStore.addWorldBook({
              id: sinkBookId,
              name: sinkName,
              description: '由设定守护者建议、玩家确认后沉淀的旅程专属世界书。',
              entries: [entry],
            });
          }
        } catch (err) {
          console.warn('[settingGuard] accept candidate failed', err);
          get().setSettingGuardError(id, err instanceof Error ? err.message : String(err));
          return;
        }

        set((s) => {
          const current = s.saves[id];
          if (!current) return s;
          const narrative = normalizeAuthorNarrativeState(current.state.authorNarrative);
          const settingGuard = normalizeSettingGuard(narrative.settingGuard);
          if (!settingGuard) return s;
          const worldBookIds = sinkBookId
            ? Array.from(new Set([...(current.content.worldBookIds ?? []), sinkBookId]))
            : current.content.worldBookIds;
          return {
            saves: {
              ...s.saves,
              [id]: touch(current, {
                content: {
                  ...current.content,
                  worldBookIds,
                },
                state: {
                  ...current.state,
                  authorNarrative: {
                    ...narrative,
                    settingGuard: {
                      ...settingGuard,
                      candidates: settingGuard.candidates.map((c) =>
                        c.id === candidateId ? { ...c, status: 'accepted' } : c,
                      ),
                      lastError: undefined,
                    },
                  },
                },
              }),
            },
          };
        });
      },

      rejectSettingCandidate: (id, candidateId) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const narrative = normalizeAuthorNarrativeState(save.state.authorNarrative);
          const settingGuard = normalizeSettingGuard(narrative.settingGuard);
          if (!settingGuard) return s;
          return {
            saves: {
              ...s.saves,
              [id]: touch(save, {
                state: {
                  ...save.state,
                  authorNarrative: {
                    ...narrative,
                    settingGuard: {
                      ...settingGuard,
                      candidates: settingGuard.candidates.map((c) =>
                        c.id === candidateId ? { ...c, status: 'rejected' } : c,
                      ),
                    },
                  },
                },
              }),
            },
          };
        }),

      deleteSettingCandidate: (id, candidateId) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const narrative = normalizeAuthorNarrativeState(save.state.authorNarrative);
          const settingGuard = normalizeSettingGuard(narrative.settingGuard);
          if (!settingGuard) return s;
          return {
            saves: {
              ...s.saves,
              [id]: touch(save, {
                state: {
                  ...save.state,
                  authorNarrative: {
                    ...narrative,
                    settingGuard: {
                      ...settingGuard,
                      candidates: settingGuard.candidates.filter((c) => c.id !== candidateId),
                    },
                  },
                },
              }),
            },
          };
        }),

      markAmbientBeatConsumed: (id, beatId) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const narrative = normalizeAuthorNarrativeState(save.state.authorNarrative);
          const settingGuard = normalizeSettingGuard(narrative.settingGuard);
          if (!settingGuard) return s;
          return {
            saves: {
              ...s.saves,
              [id]: touch(save, {
                state: {
                  ...save.state,
                  authorNarrative: {
                    ...narrative,
                    settingGuard: {
                      ...settingGuard,
                      pendingAmbientBeats: settingGuard.pendingAmbientBeats.map((b) =>
                        b.id === beatId ? { ...b, consumed: true } : b,
                      ),
                    },
                  },
                },
              }),
            },
          };
        }),

      expireOldAmbientBeats: (id, currentRound, maxAge = 3) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const narrative = normalizeAuthorNarrativeState(save.state.authorNarrative);
          const settingGuard = normalizeSettingGuard(narrative.settingGuard);
          if (!settingGuard) return s;
          const expireBefore = Math.max(0, currentRound - Math.max(1, maxAge));
          return {
            saves: {
              ...s.saves,
              [id]: touch(save, {
                state: {
                  ...save.state,
                  authorNarrative: {
                    ...narrative,
                    settingGuard: {
                      ...settingGuard,
                      pendingAmbientBeats: settingGuard.pendingAmbientBeats.map((b) =>
                        !b.consumed && b.suggestedAtRound < expireBefore ? { ...b, consumed: true } : b,
                      ),
                    },
                  },
                },
              }),
            },
          };
        }),

      clearSettingGuardDeviation: (id) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const narrative = normalizeAuthorNarrativeState(save.state.authorNarrative);
          const settingGuard = normalizeSettingGuard(narrative.settingGuard);
          if (!settingGuard) return s;
          return {
            saves: {
              ...s.saves,
              [id]: touch(save, {
                state: {
                  ...save.state,
                  authorNarrative: {
                    ...narrative,
                    settingGuard: {
                      ...settingGuard,
                      deviation: undefined,
                    },
                  },
                },
              }),
            },
          };
        }),

      setSettingGuardError: (id, error) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const narrative = normalizeAuthorNarrativeState(save.state.authorNarrative);
          const settingGuard = normalizeSettingGuard(narrative.settingGuard) ?? {
            updatedAtRound: save.state.currentRound,
            patches: [],
            candidates: [],
            pendingAmbientBeats: [],
          };
          return {
            saves: {
              ...s.saves,
              [id]: touch(save, {
                state: {
                  ...save.state,
                  authorNarrative: {
                    ...narrative,
                    settingGuard: {
                      ...settingGuard,
                      lastError: error?.trim().slice(0, 240) || undefined,
                    },
                  },
                },
              }),
            },
          };
        }),

      addAnchor: (id, anchor) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const anchors = [...(save.state.anchors ?? [])];
          const content = anchor.content?.trim() || anchor.excerpt?.trim() || '';
          const excerpt = (anchor.excerpt?.trim() || content.slice(0, 160)).slice(0, 160);
          if (!content && !excerpt) return s;
          anchors.push({
            ...anchor,
            excerpt,
            content,
            id: genId('anc'),
            createdAt: nowMs(),
          });
          return {
            saves: { ...s.saves, [id]: touch(save, { state: { ...save.state, anchors } }) },
          };
        }),

      removeAnchor: (id, anchorId) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const anchors = (save.state.anchors ?? []).filter((a) => a.id !== anchorId);
          return {
            saves: { ...s.saves, [id]: touch(save, { state: { ...save.state, anchors } }) },
          };
        }),

      updateAnchorNote: (id, anchorId, note) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const anchors = (save.state.anchors ?? []).map((a) =>
            a.id === anchorId ? { ...a, note } : a,
          );
          return {
            saves: { ...s.saves, [id]: touch(save, { state: { ...save.state, anchors } }) },
          };
        }),
    }),
    {
      name: 'lrpg.games.v2',
      partialize: (s) => ({
        activeSaveId: s.activeSaveId,
      }),
      merge: (persistedState, currentState) => {
        const p = (persistedState as any) ?? {};
        return {
          ...currentState,
          activeSaveId: p.activeSaveId,
        };
      },
    },
  ),
);

export function useActiveSave(): GameSave | undefined {
  return useGameStore((s) => (s.activeSaveId ? s.saves[s.activeSaveId] : undefined));
}

const ledgerPersistTimers = new Map<string, number>();

useGameStore.subscribe((state, prev) => {
  if (typeof window === 'undefined') return;
  if (!state.ledgerHydrated && Object.keys(state.saves).length === 0) return;
  for (const [id, save] of Object.entries(state.saves)) {
    if (prev.saves[id] === save) continue;
    const oldTimer = ledgerPersistTimers.get(id);
    if (oldTimer !== undefined) window.clearTimeout(oldTimer);
    const timer = window.setTimeout(() => {
      ledgerPersistTimers.delete(id);
      persistRuntimeSoon(save);
    }, 80);
    ledgerPersistTimers.set(id, timer);
  }
});
