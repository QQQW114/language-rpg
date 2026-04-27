import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { GameSave, GameState, GameConfig, GameContent, Message, Choice, GamePhase, Item, AdventureReview, Npc, NpcUpdateRaw, MemoryAnchor, SceneRef } from '@/types/game';
import { clamp, genId, nowMs } from '@/lib/utils';
import { createItem, type RawGrant, type RawDestroy } from '@/lib/items';

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
  setActive: (id: string | undefined) => void;
  deleteSave: (id: string) => void;
  renameSave: (id: string, name: string) => void;
  updateStateOf: (id: string, patch: Partial<GameState>) => void;
  replaceState: (id: string, updater: (prev: GameState) => GameState) => void;
  appendMessage: (id: string, msg: Message) => void;
  updateAssistantMessage: (id: string, historyIndex: number, content: string) => void;
  regenerateAssistantMessage: (id: string, historyIndex: number) => void;
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
  applyDecisionResult: (id: string, grantKey: string, grants: RawGrant[], destroys: RawDestroy[], round: number) => RawDestroy[];
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
  return { name, description: description || undefined };
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
    });
  }
  return Array.from(byName.values()).slice(-40);
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

      appendMessage: (id, msg) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const state = { ...save.state, history: [...save.state.history, msg] };
          return { saves: { ...s.saves, [id]: touch(save, { state }) } };
        }),

      updateAssistantMessage: (id, historyIndex, content) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          const msg = save.state.history[historyIndex];
          const nextContent = content.trim();
          if (!msg || msg.role !== 'assistant' || !nextContent) return s;

          const history = save.state.history.map((m, i) =>
            i === historyIndex ? { ...m, content: nextContent } : m,
          );
          const latest = latestAssistantIndex(save.state.history);
          const isLatest = historyIndex === latest;
          const pendingClean = isLatest && save.state.phase === 'choices'
            ? clearPendingDecisionItems(save.state, save.config.itemCapacity ?? 8)
            : {};
          const summaryInvalid = historyIndex < (save.state.summarizedUntilIndex ?? 0);

          const state: GameState = {
            ...save.state,
            ...pendingClean,
            history,
            error: undefined,
            ...(summaryInvalid ? { summary: '', summarizedUntilIndex: 0 } : {}),
            ...(isLatest && save.state.phase === 'choices' ? { lastChoices: undefined } : {}),
            ...(isLatest && save.state.phase === 'ended' ? { ending: nextContent, review: undefined } : {}),
          };
          return { saves: { ...s.saves, [id]: touch(save, { state }) } };
        }),

      regenerateAssistantMessage: (id, historyIndex) =>
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

          const state: GameState = {
            ...save.state,
            ...pendingClean,
            history,
            currentRound: msg.round,
            lastPlayerInput: lastUser?.content,
            phase: 'story',
            lastChoices: undefined,
            ending: undefined,
            review: undefined,
            error: undefined,
            triggeredEvents: (save.state.triggeredEvents ?? []).filter((ev) => ev.round < msg.round),
            anchors: (save.state.anchors ?? []).filter((a) => a.round < msg.round),
            availableScenes: [],
            ...(summaryInvalid ? { summary: '', summarizedUntilIndex: 0 } : {}),
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

      applyDecisionResult: (id, grantKey, grants, destroys, round) => {
        const appliedDestroys: RawDestroy[] = [];
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          // 1. 清理上一轮决策留下的 pending：已 pendingGrantKey 的条目删除；已 pendingDestroy 的标记清掉
          let items = (save.state.backpack ?? [])
            .filter((it) => !it.pendingGrantKey)
            .map((it) => (it.pendingDestroy ? { ...it, pendingDestroy: undefined, destroyReason: undefined } : it));

          // 2. 加入新的 grants（去重 by name）
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

          // 3. 标记 destroys（按 name 完全匹配，首个命中）
          for (const d of (destroys ?? []).slice(0, 4)) {
            const targetName = (d?.name ?? '').trim();
            if (!targetName) continue;
            const idx = items.findIndex((it) => it.name.trim() === targetName && !it.pendingDestroy);
            if (idx >= 0) {
              items[idx] = { ...items[idx], pendingDestroy: true, destroyReason: d.reason };
              appliedDestroys.push({ name: items[idx].name, reason: d.reason });
            }
          }

          // 4. 清理已不存在 / 待销毁道具的选中态
          const validForSelect = new Set(
            items.filter((it) => !it.pendingDestroy).map((it) => it.id),
          );
          const selectedItemIds = (save.state.selectedItemIds ?? []).filter((x) => validForSelect.has(x));

          // 5. 容量检查：待销毁道具不计入占用
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
          const existing = [...(save.state.npcs ?? [])];
          const byName = new Map(existing.map((n) => [n.name.trim(), n]));
          for (const u of updates) {
            const name = (u.name ?? '').trim();
            if (!name) continue;
            const current = byName.get(name);
            const delta = Number.isFinite(u.affinityDelta) ? (u.affinityDelta as number) : 0;
            if (current) {
              const next: Npc = {
                ...current,
                role: current.role ?? u.role,
                description: current.description ?? u.description,
                affinity: clamp(current.affinity + delta, -100, 100),
                lastRound: round,
                appearances: current.appearances + 1,
                recentNote: u.note || current.recentNote,
              };
              byName.set(name, next);
            } else {
              const next: Npc = {
                id: genId('npc'),
                name,
                role: u.role,
                description: u.description,
                affinity: clamp(delta, -100, 100),
                firstRound: round,
                lastRound: round,
                appearances: 1,
                recentNote: u.note,
              };
              byName.set(name, next);
            }
          }
          const merged = Array.from(byName.values());
          return {
            saves: { ...s.saves, [id]: touch(save, { state: { ...save.state, npcs: merged } }) },
          };
        }),

      setScenes: (id, current, available) =>
        set((s) => {
          const save = s.saves[id];
          if (!save) return s;
          // 若模型没返回 currentScene 就保留上一回合的 current，避免抖动
          const nextCurrent = current ?? save.state.currentScene;
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
              refreshesLeft: (sv.state as any)?.refreshesLeft ?? 0,
              backpack: Array.isArray((sv.state as any)?.backpack) ? (sv.state as any).backpack : [],
              selectedItemIds: Array.isArray((sv.state as any)?.selectedItemIds) ? (sv.state as any).selectedItemIds : [],
              needsDiscard: (sv.state as any)?.needsDiscard ?? 0,
              npcs: Array.isArray((sv.state as any)?.npcs) ? (sv.state as any).npcs : [],
              anchors: Array.isArray((sv.state as any)?.anchors) ? (sv.state as any).anchors : [],
              sceneHistory: Array.isArray((sv.state as any)?.sceneHistory) ? (sv.state as any).sceneHistory : [],
              availableScenes: Array.isArray((sv.state as any)?.availableScenes) ? (sv.state as any).availableScenes : [],
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
