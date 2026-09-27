// 必须先安装 localStorage 内存桩：persist 在 store 模块求值时就会读取它。
import { clearPersisted, memoryStorage, readPersisted, seedPersisted } from './helpers/localStorageStub';

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useGameStoreV2, SAVE_STORAGE_VERSION, type CommitSuccessfulTurnV2, type SaveV2 } from '@/v2/store';
import { makeBackground, makeOutline, makeState } from './helpers/fixtures';

const store = () => useGameStoreV2.getState();
const saveOf = (id: string): SaveV2 | undefined => store().saves[id];

beforeEach(() => {
  useGameStoreV2.setState({ saves: {}, activeId: undefined });
  clearPersisted();
});

describe('useGameStoreV2 — 环境与持久化通道', () => {
  it('localStorage 桩在 store 建立时已可用（persist storage 不为空）', () => {
    const storage = (useGameStoreV2 as unknown as { persist: { getOptions: () => { storage?: unknown } } })
      .persist.getOptions().storage;
    assert.ok(storage, 'persist 未拿到 storage：localStorage 桩安装顺序有问题');
    assert.equal(typeof memoryStorage.getItem, 'function');
  });

  it('create 会把存档写入 lrpg.v2，且不持久化 lastTurnCheckpoint', () => {
    const id = store().create({ name: '持久化测试', mode: 'author' });
    const persisted = readPersisted('lrpg.v2') as { state?: { saves?: Record<string, SaveV2> }; version?: number };
    assert.ok(persisted?.state?.saves?.[id], '存档应写入 localStorage');
    assert.equal(persisted.state.saves[id].name, '持久化测试');
    assert.equal('lastTurnCheckpoint' in persisted.state.saves[id], false, '回退点不应持久化');
  });
});

describe('useGameStoreV2 — 存档格式版本与迁移', () => {
  const persistApi = () => (useGameStoreV2 as unknown as {
    persist: { rehydrate: () => Promise<void> | void; getOptions: () => { version?: number } };
  }).persist;

  /** 造一份"旧版/坏档"存档：缺 facts[].keywords、缺 storyThreads、缺 destiny 等。 */
  const brokenSave = (overrides: Record<string, unknown> = {}) => ({
    id: 'save-legacy',
    name: '旧档',
    createdAt: 1,
    updatedAt: 2,
    state: {
      schemaVersion: 2,
      revision: 3,
      turn: 5,
      phase: 'input',
      mode: 'author',
      history: [{ id: 'm1', role: 'assistant', content: '开场', turn: 0, createdAt: 1 }],
      summary: '旧摘要',
      // 关键：keywords 缺失（`f.keywords.some(...)` 会直接抛 TypeError）
      facts: [{ id: 'fact-1', subjectId: 'char-a', predicate: 'occupation', value: '医生' }],
      // 关键：storyThreads / destiny / randomEvent / inventory 全部缺失
      ...overrides,
    },
  });

  it('persist 已声明格式版本（此前 store 是唯一没有 version 的持久化）', () => {
    const version = persistApi().getOptions().version;
    assert.equal(typeof version, 'number');
  });

  it('缺字段的旧档 hydrate 后不再崩：数组补空、枚举补默认值', async () => {
    seedPersisted('lrpg.v2', { saves: { 'save-legacy': brokenSave() }, activeId: null }, 0);
    await persistApi().rehydrate();
    const save = useGameStoreV2.getState().saves['save-legacy'];
    assert.ok(save, '坏档应被修复后保留，而不是整页打不开');
    assert.deepEqual(save.state.storyThreads, []);
    assert.deepEqual(save.state.inventory, []);
    assert.deepEqual(save.state.relationships, []);
    assert.deepEqual(save.state.turnRecords, []);
    assert.deepEqual(save.state.destiny.beats, []);
    assert.equal(save.state.destiny.completionEstimate, 0);
    assert.equal(save.state.randomEvent.enabled, true);
    assert.equal(save.state.randomEvent.triggerIntervalMin, 3);
    assert.deepEqual(save.state.facts[0].keywords, [], 'facts[].keywords 是已知崩溃点，必须补成数组');
    assert.equal(save.state.turn, 5, '已有字段应原样保留');
  });

  it('数组里混入坏元素时逐个过滤，不影响其余数据', async () => {
    seedPersisted('lrpg.v2', {
      saves: {
        'save-legacy': brokenSave({
          characters: [{ id: 'char-a', name: '阿黎' }, 'not-an-object', null, { name: '没有 id' }],
          history: [{ id: 'm1', role: 'assistant', content: '开场', turn: 0, createdAt: 1 }, 'broken'],
        }),
      },
      activeId: 'save-legacy',
    }, 0);
    await persistApi().rehydrate();
    const save = useGameStoreV2.getState().saves['save-legacy'];
    assert.equal(save.state.characters.length, 1);
    assert.equal(save.state.characters[0].name, '阿黎');
    assert.deepEqual(save.state.characters[0].aliases, []);
    assert.equal(save.state.history.length, 1);
  });

  it('结构坏到没有 state 的条目会被丢弃，而不是让整个存档集失效', async () => {
    seedPersisted('lrpg.v2', {
      saves: { 'save-broken': { id: 'save-broken', name: '没有 state' }, 'save-legacy': brokenSave() },
      activeId: 'save-broken',
    }, 0);
    await persistApi().rehydrate();
    const { saves, activeId } = useGameStoreV2.getState();
    assert.ok(saves['save-legacy'], '正常存档应保留');
    assert.equal(saves['save-broken'], undefined, '无法修复的条目应被丢弃');
    assert.equal(activeId, undefined, 'activeId 指向被丢弃的存档时应清空');
  });

  it('存档由更新版本写入时进入只读提示，且不改写原始数据', async () => {
    const futureSave = brokenSave();
    seedPersisted('lrpg.v2', { saves: { 'save-legacy': futureSave }, activeId: 'save-legacy' }, SAVE_STORAGE_VERSION + 3);
    await persistApi().rehydrate();
    const issue = useGameStoreV2.getState().stateVersionIssue;
    assert.ok(issue, '应产生版本提示');
    assert.equal(issue.persistedVersion, SAVE_STORAGE_VERSION + 3);
    assert.equal(issue.currentVersion, SAVE_STORAGE_VERSION);
    // 关键：不按本程序的字段结构解读，避免静默抹掉它不认识的新字段
    const kept = useGameStoreV2.getState().saves['save-legacy'];
    assert.equal(kept.state.storyThreads, undefined, '高版本存档不应被本程序补字段后写回');
  });

  it('清空版本提示后不再阻塞', async () => {
    useGameStoreV2.setState({ stateVersionIssue: undefined });
    assert.equal(useGameStoreV2.getState().stateVersionIssue, undefined);
  });
});

describe('useGameStoreV2 — create', () => {  it('初始状态：turn/revision/phase/history/summary/mode', () => {
    const id = store().create({ name: '测试存档', mode: 'author' });
    const save = saveOf(id);
    assert.ok(save);
    assert.equal(store().activeId, id);
    assert.equal(save.name, '测试存档');
    assert.equal(save.state.schemaVersion, 2);
    assert.equal(save.state.turn, 0);
    assert.equal(save.state.revision, 0);
    assert.equal(save.state.phase, 'input');
    assert.equal(save.state.mode, 'author');
    assert.equal(save.state.narrativePace, 'standard');
    assert.deepEqual(save.state.history, []);
    assert.equal(save.state.summary, '');
    assert.deepEqual(save.state.characters, []);
    assert.deepEqual(save.state.relationships, []);
    assert.deepEqual(save.state.inventory, []);
    assert.deepEqual(save.state.facts, []);
    assert.deepEqual(save.state.availableActions, []);
    assert.equal(save.state.destiny.completionEstimate, 0);
    assert.equal(save.state.destiny.endingReached, false);
    assert.deepEqual(save.state.destiny.beats, []);
    assert.equal(save.state.destiny.currentActId, 'act-opening');
    assert.equal(save.state.destiny.currentStage, '起点');
    assert.equal(save.state.destiny.currentPath, '开局');
    assert.ok(save.createdAt > 0);
    assert.equal(save.createdAt, save.updatedAt);
  });

  it('name 为空时回退到大纲标题，再回退到默认名', () => {
    const withOutline = store().create({ name: '', mode: 'author', outline: makeOutline() });
    assert.equal(saveOf(withOutline)?.name, '测试故事');

    const bare = store().create({ name: '', mode: 'adventure' });
    assert.equal(saveOf(bare)?.name, '新的旅程');
  });

  it('startScene 进入 history 并生成 currentScene', () => {
    const background = makeBackground();
    const id = store().create({ name: '开局', mode: 'author', background });
    const save = saveOf(id)!;
    assert.equal(save.state.history.length, 1);
    assert.equal(save.state.history[0].role, 'assistant');
    assert.equal(save.state.history[0].content, background.startScene);
    assert.equal(save.state.history[0].turn, 0);
    assert.equal(save.state.summary, background.startScene);
    assert.equal(save.state.currentScene?.name, '开局场景');
    assert.equal(save.state.currentScene?.description, background.startScene.slice(0, 180));
    assert.ok(save.state.currentScene?.id);
  });

  it('startItems 全部进入 inventory', () => {
    const id = store().create({ name: '开局', mode: 'author', background: makeBackground() });
    const inventory = saveOf(id)!.state.inventory;
    assert.deepEqual(inventory.map((item) => item.name), ['旧钥匙', '干粮']);
    for (const item of inventory) {
      assert.equal(item.kind, 'item');
      assert.equal(item.quantity, 1);
      assert.equal(item.consumable, false);
      assert.equal(item.acquiredAtTurn, 0);
      assert.ok(item.id);
    }
  });

  it('outline 的 acts/beats 映射为 destiny.beats，首个为 available 其余 pending', () => {
    const id = store().create({ name: '开局', mode: 'author', outline: makeOutline() });
    const destiny = saveOf(id)!.state.destiny;
    assert.deepEqual(destiny.beats.map((beat) => [beat.beatId, beat.status]), [
      ['beat-1-1', 'available'],
      ['beat-1-2', 'pending'],
      ['beat-2-1', 'pending'],
    ]);
    assert.equal(destiny.beats[0].updatedAtTurn, 0);
    assert.deepEqual(destiny.beats[0].evidenceTurns, []);
    assert.equal(destiny.currentActId, 'act-1');
    assert.equal(destiny.currentStage, '第一幕');
    assert.equal(destiny.nextMilestone, '开场');
    assert.equal(destiny.updatedAtTurn, 0);
  });

  it('随机事件间隔被夹到合法区间，并预排下一次触发回合', () => {
    const id = store().create({
      name: '随机事件',
      mode: 'author',
      randomEvent: { enabled: true, triggerIntervalMin: 0, triggerIntervalMax: 1000 },
    });
    const randomEvent = saveOf(id)!.state.randomEvent;
    // 回归：`Number(x) || 3` 会把显式的 0 当成"没填"变成 3。现在只有 undefined/NaN
    // 才回退默认值，0 会照实进入区间夹取（夹到最小值 1）。
    assert.equal(randomEvent.triggerIntervalMin, 1, '显式 0 应夹到最小 1，而不是回退默认值 3');
    assert.equal(randomEvent.triggerIntervalMax, 100, '上限被夹到 100');
    assert.ok(randomEvent.nextTriggerTurn >= randomEvent.triggerIntervalMin);
    assert.ok(randomEvent.nextTriggerTurn <= randomEvent.triggerIntervalMax);
    assert.equal(randomEvent.pending, false);
    assert.equal(randomEvent.enabled, true);
    assert.equal(randomEvent.intensity, 'related');
    assert.equal(randomEvent.lastTriggeredTurn, undefined);
  });

  it('负数间隔被夹到最小 1，min > max 时以 min 为准', () => {
    const id = store().create({
      name: '随机事件',
      mode: 'author',
      randomEvent: { triggerIntervalMin: -50, triggerIntervalMax: -50 },
    });
    const randomEvent = saveOf(id)!.state.randomEvent;
    assert.equal(randomEvent.triggerIntervalMin, 1);
    assert.equal(randomEvent.triggerIntervalMax, 1);
    assert.equal(randomEvent.nextTriggerTurn, 1, 'min=max=1 时下一次触发回合确定');
  });

  it('enabled=false 会写入存档', () => {
    const id = store().create({ name: '随机事件', mode: 'author', randomEvent: { enabled: false } });
    assert.equal(saveOf(id)!.state.randomEvent.enabled, false);
  });
});

describe('useGameStoreV2 — commitSuccessfulTurn', () => {
  it('revision/turn 不匹配时返回 false 且不改动状态', () => {
    const id = store().create({ name: 'CAS', mode: 'author' });
    const before = structuredClone(saveOf(id)!.state);
    const mismatched: CommitSuccessfulTurnV2 = {
      stateBeforeTurn: { ...before, revision: 99 },
      input: '不应提交',
      narrativePace: 'standard',
      nextState: { ...before, revision: 100, turn: 100 },
    };
    assert.equal(store().commitSuccessfulTurn(id, mismatched), false);
    assert.deepEqual(saveOf(id)!.state, before);
    assert.equal(saveOf(id)!.lastTurnCheckpoint, undefined);
  });

  it('存档不存在时返回 false', () => {
    const before = structuredClone(store().saves);
    const result = store().commitSuccessfulTurn('save-missing', {
      stateBeforeTurn: makeState(),
      input: 'x',
      narrativePace: 'standard',
      nextState: { ...makeState(), revision: 1, turn: 1 },
    } as CommitSuccessfulTurnV2);
    assert.equal(result, false);
    assert.deepEqual(store().saves, before);
  });

  it('匹配时写入新 state 与 lastTurnCheckpoint', () => {
    const id = store().create({ name: '提交', mode: 'author', background: makeBackground() });
    const before = saveOf(id)!.state;
    const nextState = {
      ...before,
      revision: before.revision + 1,
      turn: before.turn + 1,
      history: [...before.history, { id: 'msg-x', role: 'user' as const, content: '我推开窗', turn: 0, createdAt: 1 }],
      summary: '新摘要',
      lastCommitId: 'commit-1',
    };
    const ok = store().commitSuccessfulTurn(id, {
      stateBeforeTurn: before,
      input: '  我推开窗  ',
      narrativePace: 'slow',
      nextState,
    });
    assert.equal(ok, true);
    const save = saveOf(id)!;
    assert.equal(save.state.revision, 1);
    assert.equal(save.state.turn, 1);
    assert.equal(save.state.summary, '新摘要');
    assert.notEqual(save.state, nextState, 'state 应写入副本');
    assert.deepEqual(save.state.history.map((m) => m.content), [makeBackground().startScene, '我推开窗']);
    assert.equal(save.lastTurnCheckpoint?.input, '我推开窗', 'input 应 trim');
    assert.equal(save.lastTurnCheckpoint?.narrativePace, 'slow');
    assert.equal(save.lastTurnCheckpoint?.afterRevision, 1);
    assert.equal(save.lastTurnCheckpoint?.afterTurn, 1);
    assert.ok((save.lastTurnCheckpoint?.completedAt ?? 0) > 0);
    assert.deepEqual(save.lastTurnCheckpoint?.stateBeforeTurn, before);
  });

  it('提交后 lastTurnCheckpoint 仍然不会写入 localStorage', () => {
    const id = store().create({ name: '提交', mode: 'author' });
    const before = saveOf(id)!.state;
    store().commitSuccessfulTurn(id, {
      stateBeforeTurn: before,
      input: 'x',
      narrativePace: 'standard',
      nextState: { ...before, revision: 1, turn: 1 },
    });
    const persisted = readPersisted('lrpg.v2') as { state?: { saves?: Record<string, SaveV2> } };
    assert.equal('lastTurnCheckpoint' in (persisted.state?.saves?.[id] ?? {}), false);
  });
});

describe('useGameStoreV2 — restoreLastTurn', () => {
  const commitOneTurn = (id: string, narrativePace: 'slow' | 'standard' = 'slow') => {
    const before = saveOf(id)!.state;
    store().commitSuccessfulTurn(id, {
      stateBeforeTurn: before,
      input: '上一轮输入',
      narrativePace,
      nextState: {
        ...before,
        revision: before.revision + 1,
        turn: before.turn + 1,
        summary: '已被提交的摘要',
        narrativePace: 'fast',
      },
    });
    return before;
  };

  it('revision/turn 与 checkpoint 一致时恢复回合前状态、phase 回 input、清空 checkpoint', () => {
    const id = store().create({ name: '回退', mode: 'author', background: makeBackground() });
    const before = commitOneTurn(id, 'slow');
    assert.equal(saveOf(id)!.state.summary, '已被提交的摘要');

    const restored = store().restoreLastTurn(id);
    assert.ok(restored, '应返回被移除的 checkpoint');
    assert.equal(restored?.input, '上一轮输入');
    assert.equal(saveOf(id)!.lastTurnCheckpoint, undefined);
    const state = saveOf(id)!.state;
    assert.equal(state.revision, before.revision);
    assert.equal(state.turn, before.turn);
    assert.equal(state.summary, before.summary);
    assert.equal(state.phase, 'input');
    assert.equal(state.narrativePace, 'slow', '应恢复 checkpoint 记录的叙事速度');
    assert.deepEqual(state.history, before.history);
    assert.deepEqual(restored?.stateBeforeTurn, before);
  });

  it('revision/turn 与 checkpoint 不一致时返回 undefined 且不改动状态', () => {
    const id = store().create({ name: '回退', mode: 'author' });
    commitOneTurn(id);
    const committed = structuredClone(saveOf(id)!);
    store().update(id, (save) => ({ ...save, state: { ...save.state, revision: save.state.revision + 1 } }));

    assert.equal(store().restoreLastTurn(id), undefined);
    assert.notDeepEqual(saveOf(id)!.state, committed.state);
    assert.ok(saveOf(id)!.lastTurnCheckpoint, '不一致时不应清空 checkpoint');
  });

  it('没有 checkpoint 时返回 undefined', () => {
    const id = store().create({ name: '回退', mode: 'author' });
    assert.equal(store().restoreLastTurn(id), undefined);
    assert.equal(store().restoreLastTurn('save-missing'), undefined);
  });

  it('返回的 checkpoint 是副本，改动它不会影响存档', () => {
    const id = store().create({ name: '回退', mode: 'author' });
    commitOneTurn(id);
    const restored = store().restoreLastTurn(id)!;
    restored.stateBeforeTurn.summary = '被外部改写';
    assert.equal(saveOf(id)!.state.summary, '');
  });
});

describe('useGameStoreV2 — remove / setActive / update', () => {
  it('remove 删除存档；删除 activeId 时 activeId 变为 undefined', () => {
    const first = store().create({ name: '一号', mode: 'author' });
    const second = store().create({ name: '二号', mode: 'author' });
    assert.equal(store().activeId, second);

    store().remove(second);
    assert.equal(saveOf(second), undefined);
    assert.equal(store().activeId, undefined);
    assert.ok(saveOf(first), '其它存档不受影响');

    store().setActive(first);
    assert.equal(store().activeId, first);
    store().remove('save-missing');
    assert.equal(store().activeId, first, '删除不存在的存档不应影响 activeId');
  });

  it('setActive 不校验 id 是否存在（当前实现）', () => {
    store().create({ name: '一号', mode: 'author' });
    store().setActive('save-does-not-exist');
    assert.equal(store().activeId, 'save-does-not-exist');
  });

  it('update 应用变换并刷新 updatedAt；未知 id 静默忽略', () => {
    const id = store().create({ name: '更新', mode: 'author' });
    const beforeUpdatedAt = saveOf(id)!.updatedAt;
    store().update(id, (save) => ({ ...save, name: '改名后' }));
    assert.equal(saveOf(id)!.name, '改名后');
    assert.ok(saveOf(id)!.updatedAt >= beforeUpdatedAt);

    const saves = structuredClone(store().saves);
    store().update('save-missing', (save) => ({ ...save, name: '不会生效' }));
    assert.deepEqual(store().saves, saves);
  });
});
