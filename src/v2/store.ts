import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { genId } from '@/lib/utils';
import type { Background, StoryOutline, WorldBookEntry } from '@/types/content';
import type { GameStateV2, JourneyModeV2, LastTurnCheckpointV2, NarrativePaceV2, TurnRecordV2 } from './types';

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

/** 存档持久化格式版本。新增/变更 GameStateV2 字段时递增，并在 migrate 里补一档迁移。 */
export const SAVE_STORAGE_VERSION = 1;
/** 最近一次 hydrate 时读到的存档格式版本（用于"高版本存档只读"判定）。 */
let persistedVersionSeen: number | undefined;

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * 存档字段兜底。
 *
 * 存档是唯一的权威状态来源，但它是从 localStorage 读回来的任意 JSON：手改过、
 * 被截断过，或未来新增字段时漏了兼容，都会让 `snapshot()` 之类的读取点直接抛
 * `TypeError`——而那时本轮已经花掉两三次模型调用了。这里把所有数组字段补成数组、
 * 缺省标量补成默认值，让坏档退化成"内容少一点"而不是"直接崩"。
 */
export function sanitizeGameStateV2(raw: unknown): GameStateV2 | undefined {
  if (!isRecord(raw)) return undefined;
  const arrayOf = <T,>(value: unknown): T[] => (Array.isArray(value) ? value as T[] : []);
  // 数组元素本身也可能是坏数据；读取点会对每个元素取属性，这里只保留对象元素。
  const objectsOf = <T,>(value: unknown): T[] => arrayOf<unknown>(value).filter(isRecord) as T[];
  const destinyRaw = isRecord(raw.destiny) ? raw.destiny : {};
  const destinyBeats = objectsOf<GameStateV2['destiny']['beats'][number]>(destinyRaw.beats)
    .filter((beat) => typeof beat.beatId === 'string' && beat.beatId)
    .map((beat) => ({ ...beat, evidenceTurns: arrayOf<number>(beat.evidenceTurns).filter((turn) => typeof turn === 'number') }));
  const randomEventRaw = isRecord(raw.randomEvent) ? raw.randomEvent : {};
  const currentScene = isRecord(raw.currentScene) && typeof raw.currentScene.id === 'string'
    ? raw.currentScene as unknown as GameStateV2['currentScene']
    : undefined;
  const history = objectsOf<GameStateV2['history'][number]>(raw.history)
    .filter((message) => typeof message.content === 'string')
    .map((message) => ({ ...message, turn: typeof message.turn === 'number' ? message.turn : 0, createdAt: typeof message.createdAt === 'number' ? message.createdAt : 0 }));

  return {
    ...(raw as unknown as GameStateV2),
    schemaVersion: 2,
    revision: typeof raw.revision === 'number' ? raw.revision : 0,
    turn: typeof raw.turn === 'number' ? raw.turn : 0,
    phase: raw.phase === 'input' || raw.phase === 'generating' || raw.phase === 'ended' ? raw.phase : 'input',
    mode: raw.mode === 'adventure' ? 'adventure' : 'author',
    narrativePace: raw.narrativePace === 'slow' || raw.narrativePace === 'standard' || raw.narrativePace === 'fast' || raw.narrativePace === 'timeskip' ? raw.narrativePace : 'standard',
    history,
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    latestProgress: typeof raw.latestProgress === 'string' ? raw.latestProgress : undefined,
    currentScene,
    characters: objectsOf<GameStateV2['characters'][number]>(raw.characters)
      .filter((character) => typeof character.id === 'string' && character.id)
      .map((character) => ({ ...character, aliases: arrayOf<string>(character.aliases), knownFacts: arrayOf<string>(character.knownFacts) })),
    relationships: objectsOf<GameStateV2['relationships'][number]>(raw.relationships).filter((relationship) => typeof relationship.id === 'string'),
    inventory: objectsOf<GameStateV2['inventory'][number]>(raw.inventory).filter((item) => typeof item.id === 'string'),
    storyThreads: objectsOf<GameStateV2['storyThreads'][number]>(raw.storyThreads)
      .filter((thread) => typeof thread.id === 'string')
      .map((thread) => ({ ...thread, involvedCharacterIds: arrayOf<string>(thread.involvedCharacterIds) })),
    // facts 的 keywords 是已知的崩溃点（`f.keywords.some(...)` 会直接抛）
    facts: objectsOf<GameStateV2['facts'][number]>(raw.facts)
      .filter((fact) => typeof fact.id === 'string')
      .map((fact) => ({ ...fact, keywords: arrayOf<string>(fact.keywords) })),
    availableActions: objectsOf<GameStateV2['availableActions'][number]>(raw.availableActions),
    destiny: {
      ...(destinyRaw as unknown as GameStateV2['destiny']),
      completionEstimate: typeof destinyRaw.completionEstimate === 'number' ? destinyRaw.completionEstimate : 0,
      completionReason: typeof destinyRaw.completionReason === 'string' ? destinyRaw.completionReason : '',
      currentActId: typeof destinyRaw.currentActId === 'string' ? destinyRaw.currentActId : '',
      currentStage: typeof destinyRaw.currentStage === 'string' ? destinyRaw.currentStage : '',
      currentPath: typeof destinyRaw.currentPath === 'string' ? destinyRaw.currentPath : '',
      beats: destinyBeats,
      endingReached: destinyRaw.endingReached === true,
      updatedAtTurn: typeof destinyRaw.updatedAtTurn === 'number' ? destinyRaw.updatedAtTurn : 0,
    },
    randomEvent: {
      enabled: randomEventRaw.enabled !== false,
      nextTriggerTurn: typeof randomEventRaw.nextTriggerTurn === 'number' ? randomEventRaw.nextTriggerTurn : 1,
      pending: randomEventRaw.pending === true,
      intensity: randomEventRaw.intensity === 'progress' || randomEventRaw.intensity === 'destiny' ? randomEventRaw.intensity : 'related',
      triggerIntervalMin: typeof randomEventRaw.triggerIntervalMin === 'number' ? randomEventRaw.triggerIntervalMin : 3,
      triggerIntervalMax: typeof randomEventRaw.triggerIntervalMax === 'number' ? randomEventRaw.triggerIntervalMax : 6,
    },
    turnRecords: objectsOf<TurnRecordV2>(raw.turnRecords),
  };
}

/** 单个存档的字段兜底；结构坏到没有 state 时整体丢弃（宁可少一个存档也不要整页打不开）。 */
function sanitizeSaveV2(raw: unknown, fallbackId: string): SaveV2 | undefined {
  if (!isRecord(raw)) return undefined;
  const state = sanitizeGameStateV2(raw.state);
  if (!state) return undefined;
  const now = Date.now();
  return {
    ...(raw as unknown as SaveV2),
    id: typeof raw.id === 'string' && raw.id ? raw.id : fallbackId,
    name: typeof raw.name === 'string' && raw.name ? raw.name : '未命名旅程',
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
    worldFacts: arrayOfWorldFacts(raw.worldFacts),
    state,
    lastTurnCheckpoint: undefined,
  };
}

function arrayOfWorldFacts(value: unknown): WorldBookEntry[] {
  return (Array.isArray(value) ? value : []).filter(isRecord) as unknown as WorldBookEntry[];
}

/**
 * 旧版本存档的迁移入口。
 *
 * 迁移链是"逐档递增"的：新增格式版本时在这里补一段 `if (version < N)`，
 * 不要把多个版本合并成一步（跳过中间版本会漏掉中间引入的字段变换）。
 */
export function migrateV2State(persisted: unknown): { saves: Record<string, SaveV2>; activeId?: string } {
  const root = isRecord(persisted) ? persisted : {};
  const rawSaves = isRecord(root.saves) ? root.saves : {};
  const saves: Record<string, SaveV2> = {};
  for (const [id, save] of Object.entries(rawSaves)) {
    const sanitized = sanitizeSaveV2(save, id);
    if (sanitized) saves[id] = sanitized;
  }
  const activeId = typeof root.activeId === 'string' && saves[root.activeId] ? root.activeId : undefined;
  return { saves, activeId };
}

/** 存档版本高于本程序：不做任何解读，只保留原始 JSON 并提示用户。 */
function asReadOnlyState(persisted: unknown): { saves: Record<string, SaveV2>; activeId?: string } {
  const root = isRecord(persisted) ? persisted : {};
  return {
    saves: (isRecord(root.saves) ? root.saves : {}) as Record<string, SaveV2>,
    activeId: typeof root.activeId === 'string' ? root.activeId : undefined,
  };
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
  /**
   * 存档格式版本高于本程序时的提示。
   *
   * 规则来自"高版本写入的数据一律不解读，绝不尝试降级改写"：如果本程序把更新版
   * 存档按自己的字段结构读一遍再写回去，会静默抹掉它不认识的新字段。因此这种情况下
   * 只保留原始 JSON、进入只读提示，由用户自己决定用哪个版本打开。
   */
  stateVersionIssue?: { persistedVersion: number; currentVersion: number };
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
    // 用 `|| 默认值` 会把显式的 0 当成"没填"。这里只把 undefined/NaN 视为未提供，
    // 0 会照实进入下面的区间夹取（夹到最小值 1），语义上不再含糊。
    const numberOrUndefined = (value: unknown): number | undefined => {
      if (value === undefined || value === null || value === '') return undefined;
      const n = Number(value);
      return Number.isFinite(n) ? n : undefined;
    };
    const triggerIntervalMin = Math.max(1, Math.min(100, Math.round(numberOrUndefined(p.randomEvent?.triggerIntervalMin) ?? 3)));
    const triggerIntervalMax = Math.max(triggerIntervalMin, Math.min(100, Math.round(numberOrUndefined(p.randomEvent?.triggerIntervalMax) ?? 6)));
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
  version: SAVE_STORAGE_VERSION,
  /**
   * 旧版本存档的迁移入口。
   *
   * `version` 是 zustand persist 写入存储的格式版本号；读到旧版本时会把它交给这里。
   * 迁移链按版本逐档递增（新增版本时在这里补一段），不做跨版本合并迁移。
   */
  migrate: (persisted, version) => {
    persistedVersionSeen = version;
    if (version > SAVE_STORAGE_VERSION) return asReadOnlyState(persisted);
    return migrateV2State(persisted);
  },
  // hydrate 结束后才能拿到持久化的格式版本，用它决定是否提示"存档由更新版本写入"。
  onRehydrateStorage: () => (state) => {
    const version = persistedVersionSeen;
    if (state && typeof version === 'number' && version > SAVE_STORAGE_VERSION) {
      useGameStoreV2.setState({ stateVersionIssue: { persistedVersion: version, currentVersion: SAVE_STORAGE_VERSION } });
    }
  },
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
