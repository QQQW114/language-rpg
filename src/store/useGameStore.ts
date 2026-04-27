import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { GameSave, GameState, GameConfig, GameContent, Message, Choice, GamePhase, Item, AdventureReview, Npc, NpcUpdateRaw, MemoryAnchor, SceneRef } from '@/types/game';
import { clamp, genId, nowMs } from '@/lib/utils';
import { createItem, type RawGrant, type RawDestroy, type RawItemPatch } from '@/lib/items';

interface GameStoreState {
  saves: Record<string, GameSave>;
  activeSaveId?: string;

  createSave: (p: {
    name?: string;
    config: GameConfig;
    content: GameContent;
    initialScene?: string;      // 开局文本，会作为第 0 轮 assistant 消息
    initialItems?: Item[];      // 出身自带的物品
  }) => string;
  importSave: (save: GameSave) => string;
  setActive: (id: string | undefined) => void;
  deleteSave: (id: string) => void;
  renameSave: (id: string, name: string) => void;
  updateStateOf: (id: string, patch: Partial<GameState>) => void;
  replaceState: (id: string, updater: (prev: GameState) => GameState) => void;
  setLongTermMemory: (id: string, memory: string, round: number) => void;
  appendMessage: (id: string, msg: Message) => void;
  updateMessage: (id: string, historyIndex: number, content: string) => void;
  deleteMessage: (id: string, historyIndex: number) => void;
  updateAssistantMessage: (id: string, historyIndex: number, content: string) => void;
  regenerateAssistantMessage: (id: string, historyIndex: number, hint?: string) => void;
  setPhase: (id: string, phase: GamePhase) => void;
  setChoices: (id: string, choices?: Choice[]) => void;
  setLastPlayerInput: (id: string, text?: string) => void;
  incrementRound: (id: string) => void;
  addTriggeredEvent: (id: string, evId: string, round: number) => void;
  endGame: (id: string, ending: string) => void;
  setError: (id: string, error?: string) => void;
  grantRefresh: (id: string, amount?: number) => void;
  consumeRefresh: (id: string) => boolean;     // 返回是否成功消耗

  // ---- 背包 / 道具 ----
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

  // ---- 记忆锚点 ----
  addAnchor: (id: string, anchor: Omit<MemoryAnchor, 'id' | 'createdAt'>) => void;
  removeAnchor: (id: string, anchorId: string) => void;
  updateAnchorNote: (id: string, anchorId: string, note: string) => void;
}

function touch(save: GameSave, patch: Partial<GameSave>): GameSave {
  return { ...save, ...patch, updatedAt: nowMs() };
}

function latestAssistantIndex(history: Message[]): number {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'assistant') return i;
  }
  return -1;
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
    if (out.length >= 10) break;
  }
  return out;
}

function mergeNpcDetails(prev: string[] | undefined, incoming: string[] | undefined, replace?: boolean): string[] | undefined {
  const next = normalizeNpcDetails(incoming);
  if (replace) return next.length ? next : undefined;
  const merged = normalizeNpcDetails([...(prev ?? []), ...next]);
  return merged.length ? merged.slice(-10) : undefined;
}

export const useGameStore = create<GameStoreState>()(
  persist(
    (set, get) => ({
      saves: {},
      activeSaveId: undefined,

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
          },
        };
        set((s) => ({
          saves: { ...s.saves, [id]: save },
          activeSaveId: id,
        }));
        return id;
      },

      importSave: (incoming) => {
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
        return id;
      },

      setActive: (id) => set({ activeSaveId: id }),

      deleteSave: (id) =>
        set((s) => {
          const { [id]: _removed, ...rest } = s.saves;
          return {
            saves: rest,
            activeSaveId: s.activeSaveId === id ? undefined : s.activeSaveId,
          };
        }),

      renameSave: (id, name) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          return { saves: { ...s.saves, [id]: touch(save, { name }) } };
        }),

      updateStateOf: (id, patch) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          return {
            saves: { ...s.saves, [id]: touch(save, { state: { ...save.state, ...patch } }) },
          };
        }),

      replaceState: (id, updater) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          return {
            saves: { ...s.saves, [id]: touch(save, { state: updater(save.state) }) },
          };
        }),

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
          return { saves: { ...s.saves, [id]: touch(save, { state }) } };
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

          const state: GameState = {
            ...save.state,
            ...pendingClean,
            history,
            error: undefined,
            regenerationHint: undefined,
            ...(summaryInvalid ? { summary: '', summarizedUntilIndex: 0 } : {}),
            ...(memoryInvalid ? { longTermMemory: '', lastMemoryRound: 0 } : {}),
            ...(isLatestAssistant && save.state.phase === 'choices' ? { lastChoices: undefined } : {}),
            ...(isLatestAssistant && save.state.phase === 'ended' ? { ending: nextContent, review: undefined } : {}),
            ...(msg.role === 'user' && save.state.lastPlayerInput === msg.content ? { lastPlayerInput: nextContent } : {}),
          };
          return { saves: { ...s.saves, [id]: touch(save, { state }) } };
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

          const state: GameState = {
            ...save.state,
            ...pendingClean,
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
          return { saves: { ...s.saves, [id]: touch(save, { state }) } };
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

          const state: GameState = {
            ...save.state,
            ...pendingClean,
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
          return { saves: { ...s.saves, [id]: touch(save, { state }) } };
        }),

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

          // 2. 应用模型对既有道具的补丁（update 直接生效；delete 与 destroys 一样先做 pending）
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

          // 5. 清理已不存在 / 待销毁道具的选中态
          const validForSelect = new Set(
            items.filter((it) => !it.pendingDestroy).map((it) => it.id),
          );
          const selectedItemIds = (save.state.selectedItemIds ?? []).filter((x) => validForSelect.has(x));

          // 6. 容量检查：待销毁道具不计入占用
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
            .filter((it) => !it.pendingDestroy)              // 实际销毁
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

      addAnchor: (id, anchor) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const anchors = [...(save.state.anchors ?? [])];
          anchors.push({
            ...anchor,
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
      name: 'lrpg.games',
      merge: (persistedState, currentState) => {
        const p = (persistedState as any) ?? {};
        const saves = { ...(p.saves ?? {}) } as Record<string, GameSave>;
        // 对老存档补齐新增字段（refreshesLeft / refreshChoiceEvery）
        for (const id of Object.keys(saves)) {
          const sv = saves[id];
          saves[id] = {
            ...sv,
            config: {
              totalRounds: sv.config?.totalRounds ?? 30,
              manualInputEvery: sv.config?.manualInputEvery ?? 5,
              refreshChoiceEvery: (sv.config as any)?.refreshChoiceEvery ?? 3,
              itemCapacity: (sv.config as any)?.itemCapacity ?? 8,
            },
            state: {
              ...sv.state,
              summarizedUntilIndex: (sv.state as any)?.summarizedUntilIndex ?? 0,
              longTermMemory: typeof (sv.state as any)?.longTermMemory === 'string' ? (sv.state as any).longTermMemory : '',
              lastMemoryRound: (sv.state as any)?.lastMemoryRound ?? 0,
              refreshesLeft: (sv.state as any)?.refreshesLeft ?? 0,
              backpack: Array.isArray((sv.state as any)?.backpack) ? (sv.state as any).backpack : [],
              selectedItemIds: Array.isArray((sv.state as any)?.selectedItemIds) ? (sv.state as any).selectedItemIds : [],
              needsDiscard: (sv.state as any)?.needsDiscard ?? 0,
              regenerationHint: typeof (sv.state as any)?.regenerationHint === 'string' ? (sv.state as any).regenerationHint : undefined,
              npcs: Array.isArray((sv.state as any)?.npcs)
                ? (sv.state as any).npcs.map((n: any) => ({ ...n, details: normalizeNpcDetails(n.details) }))
                : [],
              anchors: Array.isArray((sv.state as any)?.anchors) ? (sv.state as any).anchors : [],
              sceneHistory: Array.isArray((sv.state as any)?.sceneHistory) ? (sv.state as any).sceneHistory : [],
              availableScenes: Array.isArray((sv.state as any)?.availableScenes) ? (sv.state as any).availableScenes : [],
              currentScene: (sv.state as any)?.currentScene,
            },
          };
        }
        return {
          ...currentState,
          saves,
          activeSaveId: p.activeSaveId,
        };
      },
    },
  ),
);

export function useActiveSave(): GameSave | undefined {
  return useGameStore((s) => (s.activeSaveId ? s.saves[s.activeSaveId] : undefined));
}
