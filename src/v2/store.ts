import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
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
  /**
   * 最近一次写入 localStorage 的失败原因（成功时清空）。
   *
   * 必须让失败可见：zustand persist 对同步 storage 的异常不会抛回调用方，
   * 一旦 localStorage 写满（长线存档可达 5MB 上限），内存里的故事会继续推进，
   * 磁盘上却停在旧状态——玩家以为在玩，刷新后全部丢失。
   */
  persistError?: { message: string; quotaExceeded: boolean; at: number };
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

function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = String((error as { name?: string }).name ?? '');
  const message = String((error as { message?: string }).message ?? '');
  return name === 'QuotaExceededError'
    || name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || /quota/i.test(name)
    || /quota|exceeded the quota|storage is full/i.test(message);
}

/**
 * 记录写入失败。store 在自己的构造过程中就会读一次 storage，
 * 而 useGameStoreV2 尚未赋值，因此这里必须容忍"还没实例化"的情况。
 */
function reportPersistFailure(error: unknown) {
  if (!useGameStoreV2) return;
  const quotaExceeded = isQuotaError(error);
  useGameStoreV2.setState({
    persistError: {
      message: quotaExceeded
        ? '浏览器本地存储已满，最新进度无法写入磁盘。请先导出备份，再删除部分旧存档或清理回合留档。'
        : `本地存储写入失败：${error instanceof Error ? error.message : String(error)}`,
      quotaExceeded,
      at: Date.now(),
    },
  });
}

function clearPersistFailure() {
  if (useGameStoreV2?.getState().persistError) useGameStoreV2.setState({ persistError: undefined });
}

/**
 * 包一层 StateStorage，把写入失败同时变成两种可见信号：
 *   1. store 上的 persistError（供 UI 渲染横幅，附带可操作的建议）；
 *   2. 原样抛出的异常。
 *
 * 必须继续抛出：zustand 走的是 newImpl + createJSONStorage 路径，同步 storage 的
 * setItem 异常会传播回调用方，`GamePage` 的 catch 已经会把它显示成错误并暂停队列。
 * 若在这里吞掉异常，就等于把"用户能看到的失败"变成"只有一个没人渲染的标志位"，
 * 反而更糟。注意内存状态在写盘之前就已经前进（zustand 先改 state 再写 storage），
 * 所以无论如何都存在"内存已推进、磁盘未写入"的窗口，UI 提示是唯一的补救信号。
 */
const reportingStorage = createJSONStorage(() => ({
  getItem: (name: string) => {
    try {
      return globalThis.localStorage?.getItem(name) ?? null;
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string) => {
    try {
      globalThis.localStorage?.setItem(name, value);
      clearPersistFailure();
    } catch (error) {
      reportPersistFailure(error);
      throw error;
    }
  },
  removeItem: (name: string) => {
    try {
      globalThis.localStorage?.removeItem(name);
    } catch {
      /* 删除失败无需打断游玩。 */
    }
  },
}));

export const useGameStoreV2 = create<StoreV2>()(persist((set) => ({  saves: {},
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
  storage: reportingStorage,
  // 持久化时剔除两类"可重建或可丢弃"的数据：
  //   1. lastTurnCheckpoint：只服务当前页面会话的重试，避免把完整历史复制一份写入。
  //   2. turnRecords[].calls[].input：三阶段完整提示词留档，实测每回合约 208 KB，
  //      占整包 97%（30 回合 6.2 MB），会让存档在第 26 回合撞上 localStorage 5MB 上限。
  //      出参与思维链仍然保留，够复盘；刷新后历史回合的提示词明细不再可导出。
  partialize: (state) => ({
    ...state,
    saves: Object.fromEntries(Object.entries(state.saves).map(([id, save]) => {
      const { lastTurnCheckpoint: _checkpoint, ...persistedSave } = save;
      const { turnRecords, ...persistedState } = persistedSave.state;
      return [id, {
        ...persistedSave,
        state: {
          ...persistedState,
          ...(turnRecords?.length
            ? { turnRecords: turnRecords.map(({ calls, ...record }) => ({ ...record, calls: calls.map(({ input: _input, ...call }) => call) })) }
            : {}),
        },
      }];
    })),
  }),
}));

export const useActiveSaveV2 = () => useGameStoreV2((s) => s.activeId ? s.saves[s.activeId] : undefined);
