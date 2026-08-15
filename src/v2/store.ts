import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { genId } from '@/lib/utils';
import type { Background, StoryOutline, WorldBookEntry } from '@/types/content';
import type { GameStateV2, JourneyModeV2, LastTurnCheckpointV2, NarrativePaceV2 } from './types';

export interface SaveV2 {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  outline?: StoryOutline;
  background?: Background;
  worldFacts: WorldBookEntry[];
  state: GameStateV2;
  lastTurnCheckpoint?: LastTurnCheckpointV2;
}

export interface CommitSuccessfulTurnV2 {
  stateBeforeTurn: GameStateV2;
  input: string;
  narrativePace: NarrativePaceV2;
  nextState: GameStateV2;
}

interface StoreV2 {
  saves: Record<string, SaveV2>;
  activeId?: string;
  create: (p: {
    name: string;
    mode: JourneyModeV2;
    outline?: StoryOutline;
    background?: Background;
    worldFacts?: WorldBookEntry[];
    randomEvent?: {
      enabled?: boolean;
      triggerIntervalMin?: number;
      triggerIntervalMax?: number;
    };
  }) => string;
  setActive: (id: string) => void;
  update: (id: string, fn: (s: SaveV2) => SaveV2) => void;
  commitSuccessfulTurn: (id: string, turn: CommitSuccessfulTurnV2) => boolean;
  restoreLastTurn: (id: string) => LastTurnCheckpointV2 | undefined;
  remove: (id: string) => void;
}

const cloneState = (state: GameStateV2): GameStateV2 => structuredClone(state);
const cloneCheckpoint = (checkpoint: LastTurnCheckpointV2): LastTurnCheckpointV2 => ({
  ...checkpoint,
  stateBeforeTurn: cloneState(checkpoint.stateBeforeTurn),
});

export const useGameStoreV2 = create<StoreV2>()(persist((set) => ({
  saves: {},
  create: (p) => {
    const id = genId('save');
    const now = Date.now();
    const startScene = p.background?.startScene;
    const triggerIntervalMin = Math.max(1, Math.min(100, Math.round(Number(p.randomEvent?.triggerIntervalMin) || 3)));
    const triggerIntervalMax = Math.max(triggerIntervalMin, Math.min(100, Math.round(Number(p.randomEvent?.triggerIntervalMax) || 6)));
    const nextTriggerTurn = triggerIntervalMin + Math.floor(Math.random() * (triggerIntervalMax - triggerIntervalMin + 1));
    const save: SaveV2 = {
      id,
      name: p.name || p.outline?.title || '新的旅程',
      createdAt: now,
      updatedAt: now,
      outline: p.outline,
      background: p.background,
      worldFacts: p.worldFacts ?? [],
      state: {
        schemaVersion: 2,
        revision: 0,
        turn: 0,
        phase: 'input',
        mode: p.mode,
        narrativePace: 'standard',
        history: startScene
          ? [{ id: genId('msg'), role: 'assistant', content: startScene, turn: 0, createdAt: now }]
          : [],
        summary: startScene ?? '',
        currentScene: startScene
          ? { id: genId('scene'), name: '开局场景', description: startScene.slice(0, 180) }
          : undefined,
        characters: [],
        relationships: [],
        inventory: (p.background?.startItems ?? []).map((name) => ({
          id: genId('item'),
          name,
          kind: 'item' as const,
          description: '',
          quantity: 1,
          consumable: false,
          acquiredAtTurn: 0,
          updatedAtTurn: 0,
        })),
        storyThreads: [],
        facts: [],
        availableActions: [],
        destiny: {
          completionEstimate: 0,
          completionReason: '故事刚刚开始，预设命运尚未展开。',
          currentActId: p.outline?.acts[0]?.id ?? 'act-opening',
          currentStage: p.outline?.acts[0]?.title ?? '起点',
          currentPath: '开局',
          nextMilestone: p.outline?.acts[0]?.beats[0]?.title ?? p.outline?.acts[0]?.title,
          beats: (p.outline?.acts ?? []).flatMap((act, actIndex) => act.beats.map((beat, beatIndex) => ({
            beatId: beat.id,
            status: actIndex === 0 && beatIndex === 0 ? 'available' as const : 'pending' as const,
            evidenceTurns: [],
            updatedAtTurn: 0,
          }))),
          endingReached: false,
          updatedAtTurn: 0,
        },
        randomEvent: {
          enabled: p.randomEvent?.enabled !== false,
          nextTriggerTurn,
          pending: false,
          intensity: 'related',
          triggerIntervalMin,
          triggerIntervalMax,
        },
      },
    };
    set((x) => ({ saves: { ...x.saves, [id]: save }, activeId: id }));
    return id;
  },
  setActive: (id) => set({ activeId: id }),
  update: (id, fn) => set((x) => {
    const prev = x.saves[id];
    if (!prev) return x;
    const next = fn(prev);
    return { saves: { ...x.saves, [id]: { ...next, updatedAt: Date.now() } } };
  }),
  commitSuccessfulTurn: (id, turn) => {
    let committed = false;
    set((x) => {
    const prev = x.saves[id];
    if (!prev || prev.state.revision !== turn.stateBeforeTurn.revision || prev.state.turn !== turn.stateBeforeTurn.turn) return x;
    const now = Date.now();
    const checkpoint: LastTurnCheckpointV2 = {
      stateBeforeTurn: cloneState(turn.stateBeforeTurn),
      input: turn.input.trim(),
      narrativePace: turn.narrativePace,
      completedAt: now,
      afterRevision: turn.nextState.revision,
      afterTurn: turn.nextState.turn,
    };
    committed = true;
    return {
      saves: {
        ...x.saves,
        [id]: {
          ...prev,
          state: cloneState(turn.nextState),
          lastTurnCheckpoint: checkpoint,
          updatedAt: now,
        },
      },
    };
  });
    return committed;
  },
  restoreLastTurn: (id) => {
    let restored: LastTurnCheckpointV2 | undefined;
    set((x) => {
      const prev = x.saves[id];
      if (!prev?.lastTurnCheckpoint || prev.state.revision !== prev.lastTurnCheckpoint.afterRevision || prev.state.turn !== prev.lastTurnCheckpoint.afterTurn) return x;
      restored = cloneCheckpoint(prev.lastTurnCheckpoint);
      return {
        saves: {
          ...x.saves,
          [id]: {
            ...prev,
            state: {
              ...cloneState(prev.lastTurnCheckpoint.stateBeforeTurn),
              phase: 'input',
              narrativePace: prev.lastTurnCheckpoint.narrativePace,
            },
            lastTurnCheckpoint: undefined,
            updatedAt: Date.now(),
          },
        },
      };
    });
    return restored;
  },
  remove: (id) => set((x) => {
    const saves = { ...x.saves };
    delete saves[id];
    return { saves, activeId: x.activeId === id ? undefined : x.activeId };
  }),
}), {
  name: 'lrpg.v2',
  // 最近一回合快照只服务当前页面会话的重试，避免把完整历史复制一份写入 localStorage。
  partialize: (state) => ({
    ...state,
    saves: Object.fromEntries(Object.entries(state.saves).map(([id, save]) => {
      const { lastTurnCheckpoint: _checkpoint, ...persistedSave } = save;
      return [id, persistedSave];
    })),
  }),
}));

export const useActiveSaveV2 = () => useGameStoreV2((s) => s.activeId ? s.saves[s.activeId] : undefined);
