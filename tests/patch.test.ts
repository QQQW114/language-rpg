import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { commitTurnPatchV2, emptyPatchStatsV2 } from '@/v2/patch';
import { makePatch, makeState } from './helpers/fixtures';
import type { GameStateV2, PatchStatsV2, PatchWarningV2, TurnPatchV2 } from '@/v2/types';

/** 用统一夹具提交一个 Patch；baseRevision/turn 默认对齐 state。 */
function commit(stateOverrides: Record<string, unknown> = {}, patchOverrides: Record<string, unknown> = {}): GameStateV2 {
  return commitResult(stateOverrides, patchOverrides).state;
}

/** 同 commit，但额外收集提交阶段产生的警告（out 参数形式）。 */
function commitResult(stateOverrides: Record<string, unknown> = {}, patchOverrides: Record<string, unknown> = {}) {
  const state = makeState(stateOverrides);
  const warnings: PatchWarningV2[] = [];
  const next = commitTurnPatchV2(state, makePatch({ baseRevision: state.revision, turn: state.turn, ...patchOverrides }), warnings);
  return { state: next, warnings };
}

const S = 7; // makeState 默认 turn

describe('patch.commitTurnPatchV2 — 事务守卫', () => {
  it('schemaVersion 不为 2 时抛错', () => {
    assert.throws(() => commit({}, { schemaVersion: 1 }), /不支持的状态 Patch 版本/);
  });

  it('baseRevision 不匹配时抛错', () => {
    assert.throws(() => commit({}, { baseRevision: 99 }), /状态已变化，请重新结算/);
  });

  it('turn 不匹配时抛错', () => {
    assert.throws(() => commit({}, { turn: 6 }), /Patch 回合不匹配/);
  });

  it('commitId 与 lastCommitId 相同时原样返回（幂等，不递增 revision）', () => {
    const state = makeState({ lastCommitId: 'commit-same' });
    const result = commitTurnPatchV2(state, makePatch({ baseRevision: state.revision, turn: state.turn, commitId: 'commit-same', roundSummary: '不应生效' }));
    assert.equal(result, state, '应返回同一个对象引用');
    assert.equal(result.summary, '旧摘要');
    assert.equal(result.revision, 3);
  });
});

describe('patch — 人物', () => {
  it('create 撞名时走合并分支：别名与 knownFacts 去重合并、更新 lastSeenTurn', () => {
    const state = makeState();
    const next = commitTurnPatchV2(state, makePatch({
      baseRevision: state.revision,
      turn: state.turn,
      characters: [{
        op: 'create',
        id: 'char-new',
        name: '阿黎',
        aliases: ['阿黎别名', '小黎'],
        addFacts: ['怕黑', '住在城南'],
        reason: '正文再次出现',
      }],
    }));
    assert.equal(next.characters.length, 1, '撞名不应新增人物');
    assert.deepEqual(next.characters[0].aliases, ['小黎', '阿黎别名']);
    assert.deepEqual(next.characters[0].knownFacts, ['住在城南', '怕黑']);
    assert.equal(next.characters[0].lastSeenTurn, S);
    assert.equal(next.characters[0].id, 'char-a');
  });

  it('create 撞 id（名字不同）同样走合并分支', () => {
    const next = commit({}, {
      characters: [{ op: 'create', id: 'char-a', name: '另一个人', addFacts: ['新事实'] }],
    });
    assert.equal(next.characters.length, 1);
    assert.equal(next.characters[0].name, '阿黎', '撞 id 时不应改名');
    assert.deepEqual(next.characters[0].knownFacts, ['住在城南', '新事实']);
  });

  it('create 撞已有别名同样走合并分支', () => {
    const next = commit({}, { characters: [{ op: 'create', name: '小黎', addFacts: ['第2条'] }] });
    assert.equal(next.characters.length, 1);
    assert.equal(next.characters[0].name, '阿黎');
  });

  it('create 全新人物时补齐默认字段与首次出场回合', () => {
    const next = commit({}, {
      characters: [{
        op: 'create',
        id: 'char-b',
        name: '  阿黎二号  ',
        aliases: [' 二号 ', '', '二号', ...Array.from({ length: 9 }, (_, i) => `别名${i}`)],
        addFacts: Array.from({ length: 14 }, (_, i) => `事实${i}`),
      }],
    });
    const created = next.characters.find((x) => x.id === 'char-b');
    assert.ok(created, '应新增人物');
    assert.equal(created?.name, '阿黎二号', 'name 应 trim');
    assert.equal(created?.status, 'active');
    assert.equal(created?.role, undefined);
    assert.equal(created?.description, undefined);
    assert.equal(created?.firstSeenTurn, S);
    assert.equal(created?.lastSeenTurn, S);
    assert.equal(created?.aliases.length, 8, 'aliases 最多保留 8 个');
    // 回归：create 分支曾只做 trim/filter/slice 而不去重，会原样保留重复别名。
    assert.deepEqual(created?.aliases.slice(0, 3), ['二号', '别名0', '别名1']);
    assert.equal(new Set(created?.aliases).size, created?.aliases.length, 'aliases 不应有重复项');
    assert.equal(created?.knownFacts.length, 12, '新建时 knownFacts 最多 12 条');
  });

  it('白名单外的枚举取值会被改写并留下警告（回归：曾完全静默）', () => {
    const created = commitResult({}, {
      characters: [{ op: 'create', id: 'char-cn', name: '中文枚举人物', status: '死亡', reason: 'x' }],
    });
    assert.equal(created.state.characters.find((c) => c.id === 'char-cn')?.status, 'active', '非法枚举回退到默认值');
    assert.equal(created.warnings.filter((w) => w.code === 'enum_value_coerced').length, 1);

    const updated = commitResult({}, {
      characters: [{ op: 'update', id: 'char-a', status: '失踪', reason: 'x' }],
    });
    assert.equal(updated.state.characters.find((c) => c.id === 'char-a')?.status, 'active');
    assert.equal(updated.warnings[0]?.code, 'enum_value_coerced');

    const inventory = commitResult({}, {
      inventory: [{ op: 'grant', id: 'item-x', name: '玉符', kind: '能力', quantity: 1, reason: 'x' }],
    });
    assert.equal(inventory.state.inventory.find((i) => i.id === 'item-x')?.kind, 'item');
    assert.equal(inventory.warnings[0]?.code, 'enum_value_coerced');

    // 合法取值不应产生警告
    const ok = commitResult({}, {
      characters: [{ op: 'create', id: 'char-ok', name: '合法人物', status: 'dead', reason: 'x' }],
    });
    assert.equal(ok.state.characters.find((c) => c.id === 'char-ok')?.status, 'dead');
    assert.deepEqual(ok.warnings, []);
  });

  it('create 缺 name、非对象行会被安全跳过', () => {    const next = commit({}, {
      characters: [
        { op: 'create', id: 'char-x' },
        'not-an-object',
        null,
        42,
        { op: 'create', name: '有效人物', reason: 'ok' },
      ] as unknown as TurnPatchV2['characters'],
    });
    assert.equal(next.characters.length, 2);
    assert.equal(next.characters[1].name, '有效人物');
  });

  it('update 只改给定字段，其余字段保持', () => {
    const next = commit({}, {
      characters: [{ op: 'update', id: 'char-a', description: '新的介绍', addFacts: ['新增认识'] }],
    });
    const target = next.characters[0];
    assert.equal(target.name, '阿黎');
    assert.deepEqual(target.aliases, ['小黎']);
    assert.equal(target.role, '同学');
    assert.equal(target.status, 'active');
    assert.equal(target.description, '新的介绍');
    assert.deepEqual(target.knownFacts, ['住在城南', '新增认识']);
    assert.equal(target.lastSeenTurn, S);
  });

  it('update 传空字符串会清空可选字段；非法 status 回退到原值', () => {
    const next = commit({}, {
      characters: [{ op: 'update', id: 'char-a', description: '', role: '', status: 'bogus' }],
    });
    assert.equal(next.characters[0].description, undefined);
    assert.equal(next.characters[0].role, undefined);
    assert.equal(next.characters[0].status, 'active');
  });

  it('update 目标不存在时静默忽略', () => {
    const next = commit({}, { characters: [{ op: 'update', id: 'char-none', description: 'x' }] });
    assert.deepEqual(next.characters, makeState().characters);
  });
});

describe('patch — 关系', () => {
  it('fromId === toId 被丢弃', () => {
    const next = commit({}, {
      relationships: [{ fromId: 'char-a', toId: 'char-a', affinityDelta: 5, reason: '自语' }],
    });
    assert.equal(next.relationships.length, 1);
    assert.equal(next.relationships[0].affinity, 10);
  });

  it('toId 不存在于人物表时被丢弃', () => {
    const next = commit({}, {
      relationships: [{ fromId: 'player', toId: 'char-missing', affinityDelta: 5, reason: 'x' }],
    });
    assert.equal(next.relationships.length, 1);
    assert.equal(next.relationships[0].affinity, 10);
  });

  it('toId 为 player 时被丢弃（toId 必须是人物表里的角色）', () => {
    const next = commit({}, {
      relationships: [{ fromId: 'char-a', toId: 'player', affinityDelta: 5, reason: 'x' }],
    });
    assert.equal(next.relationships.length, 1);
    assert.equal(next.relationships[0].affinity, 10);
  });

  it('缺 reason / fromId / toId 时被丢弃', () => {
    const next = commit({}, {
      relationships: [
        { fromId: 'player', toId: 'char-a', affinityDelta: 5 },
        { toId: 'char-a', affinityDelta: 5, reason: 'x' },
        { fromId: 'player', affinityDelta: 5, reason: 'x' },
      ] as unknown as TurnPatchV2['relationships'],
    });
    assert.equal(next.relationships[0].affinity, 10);
  });

  it('affinityDelta 单回合夹在 ±20', () => {
    assert.equal(commit({}, { relationships: [{ fromId: 'player', toId: 'char-a', affinityDelta: 100, reason: 'x' }] }).relationships[0].affinity, 30);
    assert.equal(commit({}, { relationships: [{ fromId: 'player', toId: 'char-a', affinityDelta: -100, reason: 'x' }] }).relationships[0].affinity, -10);
    assert.equal(commit({}, { relationships: [{ fromId: 'player', toId: 'char-a', affinityDelta: 20, reason: 'x' }] }).relationships[0].affinity, 30);
  });

  it('累计好感夹在 ±100', () => {
    const high = commit({ relationships: [{ id: 'rel-1', fromId: 'player', toId: 'char-a', affinity: 95, updatedAtTurn: 5 }] }, {
      relationships: [{ fromId: 'player', toId: 'char-a', affinityDelta: 20, reason: 'x' }],
    });
    assert.equal(high.relationships[0].affinity, 100);

    const low = commit({ relationships: [{ id: 'rel-1', fromId: 'player', toId: 'char-a', affinity: -95, updatedAtTurn: 5 }] }, {
      relationships: [{ fromId: 'player', toId: 'char-a', affinityDelta: -20, reason: 'x' }],
    });
    assert.equal(low.relationships[0].affinity, -100);
  });

  it('新关系会被创建（含 affinityDelta 为 0 的情况），并记录 label/note', () => {
    const state = makeState({
      characters: [
        ...makeState().characters,
        { id: 'char-b', name: '阿二', aliases: [], status: 'active', knownFacts: [], firstSeenTurn: 1, lastSeenTurn: 5 },
      ],
    });
    const next = commitTurnPatchV2(state, makePatch({
      baseRevision: state.revision,
      turn: state.turn,
      relationships: [{ fromId: 'player', toId: 'char-b', affinityDelta: 0, label: ' 同伴 ', note: ' 初识 ', reason: '第一次见面' }],
    }));
    const created = next.relationships.find((x) => x.toId === 'char-b');
    assert.ok(created);
    assert.equal(created?.affinity, 0);
    assert.equal(created?.label, '同伴');
    assert.equal(created?.note, '初识');
    assert.equal(created?.updatedAtTurn, S);
    assert.ok(created?.id);
  });

  it('label/note 传空字符串会被清空，未提供时保持原值', () => {
    const state = makeState({
      relationships: [{ id: 'rel-1', fromId: 'player', toId: 'char-a', affinity: 10, label: '旧标签', note: '旧备注', updatedAtTurn: 5 }],
    });
    const kept = commitTurnPatchV2(state, makePatch({
      baseRevision: state.revision,
      turn: state.turn,
      relationships: [{ fromId: 'player', toId: 'char-a', affinityDelta: 1, reason: 'x' }],
    }));
    assert.equal(kept.relationships[0].label, '旧标签');
    assert.equal(kept.relationships[0].note, '旧备注');

    const cleared = commitTurnPatchV2(state, makePatch({
      baseRevision: state.revision,
      turn: state.turn,
      relationships: [{ fromId: 'player', toId: 'char-a', affinityDelta: 1, label: '', note: '', reason: 'x' }],
    }));
    assert.equal(cleared.relationships[0].label, undefined);
    assert.equal(cleared.relationships[0].note, undefined);
  });
});

describe('patch — 库存', () => {
  it('grant 已存在物品按数量累加并刷新 updatedAtTurn', () => {
    const next = commit({}, { inventory: [{ op: 'grant', id: 'item-1', quantity: 3, reason: '捡到' }] });
    assert.equal(next.inventory[0].quantity, 5);
    assert.equal(next.inventory[0].updatedAtTurn, S);
    assert.equal(next.inventory[0].acquiredAtTurn, 1);
  });

  it('grant 严格照抄模型给的数量：0 不变、负数照减并在归零后移除（回归）', () => {
    // 夹具里 item-1 的初始数量是 2。之前用 Math.max(1,…)，模型写 0 或负数也会 +1，
    // 等于程序篡改了模型的数量意图。
    assert.equal(commit({}, { inventory: [{ op: 'grant', id: 'item-1', quantity: 0, reason: 'x' }] }).inventory[0].quantity, 2, '0 表示这次不增加');
    assert.equal(commit({}, { inventory: [{ op: 'grant', id: 'item-1', quantity: -1, reason: 'x' }] }).inventory[0].quantity, 1, '负数表示减少');
    // 减到 0 或以下时按"数量 > 0"过滤，不留数量为 0 的幽灵条目
    assert.equal(commit({}, { inventory: [{ op: 'grant', id: 'item-1', quantity: -5, reason: 'x' }] }).inventory.length, 0);
  });

  it('grant 新物品时数量 <= 0 不创建条目', () => {
    const zero = commit({}, { inventory: [{ op: 'grant', id: 'item-z', name: '空物', quantity: 0, reason: 'x' }] });
    assert.equal(zero.inventory.find((x) => x.id === 'item-z'), undefined, '数量 0 的新物品不应创建');
    const negative = commit({}, { inventory: [{ op: 'grant', id: 'item-n', name: '负物', quantity: -3, reason: 'x' }] });
    assert.equal(negative.inventory.find((x) => x.id === 'item-n'), undefined);
  });

  it('grant 新物品按 id 或 name 创建，缺 name 时忽略', () => {
    const byId = commit({}, { inventory: [{ op: 'grant', id: 'item-9', name: '新剑', quantity: 2, reason: 'x' }] });
    assert.equal(byId.inventory.length, 2);
    const created = byId.inventory.find((x) => x.id === 'item-9');
    assert.equal(created?.name, '新剑');
    assert.equal(created?.quantity, 2);
    assert.equal(created?.kind, 'item');
    assert.equal(created?.consumable, false);
    assert.equal(created?.acquiredAtTurn, S);

    const byName = commit({}, { inventory: [{ op: 'grant', name: '绳索', quantity: 1, kind: 'quest_item', consumable: true, reason: 'x' }] });
    const rope = byName.inventory.find((x) => x.name === '绳索');
    assert.equal(rope?.kind, 'quest_item');
    assert.equal(rope?.consumable, true);
    assert.ok(rope?.id);

    const noName = commit({}, { inventory: [{ op: 'grant', quantity: 1, reason: 'x' }] });
    assert.equal(noName.inventory.length, 1);
  });

  it('consume 扣减数量，归零或变负时从库存移除', () => {
    assert.equal(commit({}, { inventory: [{ op: 'consume', id: 'item-1', quantity: 1, reason: '用掉' }] }).inventory[0].quantity, 1);
    assert.equal(commit({}, { inventory: [{ op: 'consume', id: 'item-1', quantity: 2, reason: '用光' }] }).inventory.length, 0);
    assert.equal(commit({}, { inventory: [{ op: 'consume', id: 'item-1', quantity: 9, reason: '超额' }] }).inventory.length, 0);
  });

  it('remove 直接清零并移除；update 只改描述/类型/消耗标记', () => {
    assert.equal(commit({}, { inventory: [{ op: 'remove', id: 'item-1', reason: '丢掉' }] }).inventory.length, 0);

    const updated = commit({}, {
      inventory: [{ op: 'update', id: 'item-1', description: '新描述', kind: 'ability', consumable: true, quantity: 99, reason: 'x' }],
    });
    assert.equal(updated.inventory[0].description, '新描述');
    assert.equal(updated.inventory[0].kind, 'ability');
    assert.equal(updated.inventory[0].consumable, true);
    assert.equal(updated.inventory[0].quantity, 2, 'update 不应改变数量');
  });

  it('缺 reason 的行被忽略；未知 op 只刷新 updatedAtTurn', () => {
    const noReason = commit({}, { inventory: [{ op: 'consume', id: 'item-1', quantity: 1 }] as unknown as TurnPatchV2['inventory'] });
    assert.equal(noReason.inventory[0].quantity, 2);
    assert.equal(noReason.inventory[0].updatedAtTurn, 2, '未命中时应完全不改');

    const unknownOp = commit({}, { inventory: [{ op: 'weird', id: 'item-1', reason: 'x' }] as unknown as TurnPatchV2['inventory'] });
    assert.equal(unknownOp.inventory[0].quantity, 2);
    assert.equal(unknownOp.inventory[0].updatedAtTurn, S, '当前实现会无条件刷新 updatedAtTurn');
  });
});

describe('patch — 故事线程', () => {
  it('create 撞标题时只刷新 updatedAtTurn，不新增也不改字段', () => {
    const next = commit({}, {
      threads: [{ op: 'create', id: 'thread-new', title: '寻找兄长', status: 'completed', reason: 'x' }],
    });
    assert.equal(next.storyThreads.length, 1);
    assert.equal(next.storyThreads[0].id, 'thread-1');
    assert.equal(next.storyThreads[0].status, 'active', '撞标题时不应改状态');
    assert.equal(next.storyThreads[0].updatedAtTurn, S);
  });

  it('create 撞 id 时同样只刷新 updatedAtTurn', () => {
    const next = commit({}, { threads: [{ op: 'create', id: 'thread-1', title: '另一个标题', reason: 'x' }] });
    assert.equal(next.storyThreads.length, 1);
    assert.equal(next.storyThreads[0].title, '寻找兄长');
  });

  it('create 新线程补齐默认字段', () => {
    const next = commit({}, {
      threads: [{
        op: 'create',
        id: 'thread-2',
        title: '  新的线索  ',
        involvedCharacterIds: ['char-a', 'char-a', ''],
        reason: 'x',
      }],
    });
    const created = next.storyThreads.find((x) => x.id === 'thread-2');
    assert.equal(created?.title, '新的线索');
    assert.equal(created?.kind, 'hook');
    assert.equal(created?.status, 'candidate');
    assert.equal(created?.progress, undefined);
    // 回归：update 分支去重、create 分支曾不去重，同一份数据两条路径结果不同。
    assert.deepEqual(created?.involvedCharacterIds, ['char-a']);
    assert.equal(created?.updatedAtTurn, S);
  });

  it('op=create 但缺 title 时整条忽略（回归：曾退化为按 id 覆盖已有线程）', () => {
    const result = commitResult({}, { threads: [{ op: 'create', id: 'thread-1', status: 'completed', reason: 'x' }] });
    // create 缺 title 不能退化成 update：那会让一次失误的 create 悄悄改写已有线程，
    // 且完全不校验 reason。现在整条忽略并给出可观察警告。
    assert.equal(result.state.storyThreads[0].status, 'active', '既有线程不应被 create 改写');
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].code, 'thread_create_without_title');
  });

  it('update 覆盖给定字段、重算进度并替换涉及人物；目标不存在时忽略', () => {
    const next = commit({}, {
      threads: [{
        op: 'update',
        id: 'thread-1',
        kind: 'quest',
        status: 'completed',
        progress: 150,
        currentStep: ' 已了结 ',
        note: '',
        involvedCharacterIds: ['char-a', 'char-b', 'char-a'],
        reason: 'x',
      }],
    });
    const target = next.storyThreads[0];
    assert.equal(target.kind, 'quest');
    assert.equal(target.status, 'completed');
    assert.equal(target.progress, 100, 'progress 夹在 0-100');
    assert.equal(target.currentStep, '已了结');
    assert.equal(target.note, undefined);
    assert.deepEqual(target.involvedCharacterIds, ['char-a', 'char-b']);
    assert.equal(target.updatedAtTurn, S);

    const negative = commit({}, { threads: [{ op: 'update', id: 'thread-1', progress: -20, reason: 'x' }] });
    assert.equal(negative.storyThreads[0].progress, 0);

    const missing = commit({}, { threads: [{ op: 'update', id: 'thread-none', status: 'failed', reason: 'x' }] });
    assert.equal(missing.storyThreads[0].status, 'active');
  });
});

describe('patch — 正史事实（canonical facts）', () => {
  const baseFact = {
    op: 'create' as const,
    id: 'fact-1',
    subjectId: 'char-a',
    predicate: 'occupation',
    value: '医生',
    scope: 'character' as const,
    stability: 'stable' as const,
    confidence: 'explicit' as const,
    keywords: ['职业'],
    evidenceQuote: '正文原句',
  };

  it('temporary / inferred / 无 evidenceQuote 的事实被丢弃', () => {
    const next = commit({}, {
      facts: [
        { ...baseFact, id: 'f-temp', stability: 'temporary' },
        { ...baseFact, id: 'f-inferred', confidence: 'inferred' },
        { ...baseFact, id: 'f-noquote', evidenceQuote: '   ' },
        { ...baseFact, id: 'f-ok' },
      ] as unknown as TurnPatchV2['facts'],
    });
    assert.equal(next.facts.length, 1);
    assert.equal(next.facts[0].id, 'f-ok');
  });

  it('合法 create 补齐默认字段并去重 keywords', () => {
    const next = commit({}, {
      facts: [{
        ...baseFact,
        scope: 'bogus' as any,
        stability: 'weird' as any,
        keywords: ['职业', '医生', '职业', ...Array.from({ length: 15 }, (_, i) => `kw${i}`)],
      }] as unknown as TurnPatchV2['facts'],
    });
    const fact = next.facts[0];
    assert.equal(fact.scope, 'custom', '非法 scope 回退 custom');
    assert.equal(fact.stability, 'stable', '非法 stability 回退 stable');
    assert.equal(fact.confidence, 'explicit', 'confidence 恒为 explicit');
    assert.equal(fact.evidenceTurn, S);
    assert.equal(fact.createdAtTurn, S);
    assert.equal(fact.updatedAtTurn, S);
    assert.equal(fact.evidenceQuote, '正文原句');
    assert.equal(fact.keywords.length, 12, 'keywords 最多 12 个');
    assert.deepEqual(fact.keywords.slice(0, 3), ['char-a', 'occupation', '职业']);
  });

  it('同 subject+predicate 改值：op 不是 replace 时丢弃', () => {
    const state = makeState({
      facts: [{ ...baseFact, evidenceTurn: 3, createdAtTurn: 1, updatedAtTurn: 3 }],
    });
    const next = commitTurnPatchV2(state, makePatch({
      baseRevision: state.revision,
      turn: state.turn,
      facts: [{ ...baseFact, value: '律师', op: 'create' }],
    }));
    assert.equal(next.facts[0].value, '医生');
    assert.equal(next.facts[0].updatedAtTurn, 3);
  });

  it('op=replace 但缺 reason 或 evidenceQuote 时丢弃', () => {
    const state = makeState({ facts: [{ ...baseFact, evidenceTurn: 3, createdAtTurn: 1, updatedAtTurn: 3 }] });
    const noReason = commitTurnPatchV2(state, makePatch({
      baseRevision: state.revision,
      turn: state.turn,
      facts: [{ ...baseFact, value: '律师', op: 'replace' }],
    }));
    assert.equal(noReason.facts[0].value, '医生');
  });

  it('op=replace 且证据充分时更新值、证据与回合戳，保留 id/createdAtTurn/keywords', () => {
    const state = makeState({
      facts: [{ ...baseFact, evidenceTurn: 3, createdAtTurn: 1, updatedAtTurn: 3, keywords: ['char-a', 'occupation', '旧词'] }],
    });
    const next = commitTurnPatchV2(state, makePatch({
      baseRevision: state.revision,
      turn: state.turn,
      facts: [{
        ...baseFact,
        value: '律师',
        op: 'replace',
        reason: '正文明确改口',
        evidenceQuote: '我早就不当医生了',
        keywords: ['新词'],
      }],
    }));
    const fact = next.facts[0];
    assert.equal(fact.value, '律师');
    assert.equal(fact.evidenceQuote, '我早就不当医生了');
    assert.equal(fact.evidenceTurn, S);
    assert.equal(fact.updatedAtTurn, S);
    assert.equal(fact.createdAtTurn, 1);
    assert.equal(fact.id, 'fact-1');
    assert.deepEqual(fact.keywords, ['char-a', 'occupation', '旧词'], 'replace 不更新 keywords（当前实现）');
  });

  it('core 事实不可被覆盖，即使 op=replace 且证据充分', () => {
    const state = makeState({ facts: [{ ...baseFact, stability: 'core', evidenceTurn: 3, createdAtTurn: 1, updatedAtTurn: 3 }] });
    const next = commitTurnPatchV2(state, makePatch({
      baseRevision: state.revision,
      turn: state.turn,
      facts: [{ ...baseFact, value: '律师', op: 'replace', reason: '试图覆盖', evidenceQuote: '证据' }],
    }));
    assert.equal(next.facts[0].value, '医生');
  });

  it('同 subject+predicate 且值相同：不新增、不重复', () => {
    const state = makeState({ facts: [{ ...baseFact, evidenceTurn: 3, createdAtTurn: 1, updatedAtTurn: 3 }] });
    const next = commitTurnPatchV2(state, makePatch({
      baseRevision: state.revision,
      turn: state.turn,
      facts: [{ ...baseFact, value: '医生', op: 'create' }],
    }));
    assert.equal(next.facts.length, 1);
    assert.equal(next.facts[0].id, 'fact-1');
  });

  it('每回合最多写入 10 条', () => {
    const facts = Array.from({ length: 12 }, (_, i) => ({
      ...baseFact,
      id: `f-${i}`,
      predicate: `pred-${i}`,
      value: `值${i}`,
    }));
    const next = commit({}, { facts: facts as unknown as TurnPatchV2['facts'] });
    assert.equal(next.facts.length, 10);
    assert.equal(next.facts[9].predicate, 'pred-9');
  });

  it('持久化时丢弃历史 temporary 事实', () => {
    const state = makeState({
      facts: [
        { ...baseFact, id: 'f-old-temp', stability: 'temporary', evidenceTurn: 1, createdAtTurn: 1, updatedAtTurn: 1 },
        { ...baseFact, id: 'f-old-keep', predicate: 'city', value: '城南', evidenceTurn: 1, createdAtTurn: 1, updatedAtTurn: 1 },
      ],
    });
    const next = commitTurnPatchV2(state, makePatch({ baseRevision: state.revision, turn: state.turn }));
    assert.deepEqual(next.facts.map((x) => x.id), ['f-old-keep']);
  });

  it('总量上限 160：保留全部 core 与最近的 stable', () => {
    const core = Array.from({ length: 3 }, (_, i) => ({
      ...baseFact, id: `f-core-${i}`, predicate: `core-${i}`, stability: 'core' as const, evidenceTurn: 1, createdAtTurn: 1, updatedAtTurn: 1,
    }));
    const stable = Array.from({ length: 165 }, (_, i) => ({
      ...baseFact, id: `f-stable-${i}`, predicate: `stable-${i}`, evidenceTurn: 1, createdAtTurn: 1, updatedAtTurn: 1,
    }));
    const next = commit({ facts: [...core, ...stable] }, {});
    assert.equal(next.facts.length, 160);
    assert.deepEqual(next.facts.slice(0, 3).map((x) => x.id), ['f-core-0', 'f-core-1', 'f-core-2']);
    assert.equal(next.facts[3].id, 'f-stable-8');
    assert.equal(next.facts[159].id, 'f-stable-164');
  });

  it('非对象事实行被安全过滤', () => {
    const next = commit({}, { facts: ['字符串事实', null, 7, { ...baseFact, id: 'f-ok' }] as unknown as TurnPatchV2['facts'] });
    assert.deepEqual(next.facts.map((x) => x.id), ['f-ok']);
  });
});

describe('patch — 故事节（destiny.beats）', () => {
  it('satisfied 缺 evidenceQuote 时丢弃', () => {
    const next = commit({}, {
      destiny: {
        reason: 'x',
        beatChanges: [{ beatId: 'beat-1-1', status: 'satisfied', reason: '实现了目的' }],
      },
    });
    const beat = next.destiny.beats.find((x) => x.beatId === 'beat-1-1');
    assert.equal(beat?.status, 'available');
    assert.equal(beat?.updatedAtTurn, 0, '被丢弃的变更不应刷新回合戳');
    assert.deepEqual(beat?.evidenceTurns, []);
  });

  it('satisfied 有证据时写入状态与 evidenceTurns', () => {
    const next = commit({}, {
      destiny: {
        reason: 'x',
        beatChanges: [{
          beatId: 'beat-1-1',
          status: 'satisfied',
          evidenceQuote: '她终于说出了真相',
          evidenceSummary: '开场功能实现',
          currentPlan: '已完成',
          reason: '正文实现',
        }],
      },
    });
    const beat = next.destiny.beats.find((x) => x.beatId === 'beat-1-1');
    assert.equal(beat?.status, 'satisfied');
    assert.deepEqual(beat?.evidenceTurns, [S]);
    assert.equal(beat?.evidenceSummary, '开场功能实现');
    assert.equal(beat?.currentPlan, '已完成');
    assert.equal(beat?.updatedAtTurn, S);
    assert.equal(next.destiny.updatedAtTurn, S);
  });

  it('已 satisfied 的故事节不能回退为 pending/available/active', () => {
    for (const status of ['pending', 'available', 'active'] as const) {
      const next = commit(
        { destiny: { ...makeState().destiny, beats: [{ beatId: 'beat-1-1', status: 'satisfied', evidenceTurns: [3], updatedAtTurn: 3 }] } },
        { destiny: { reason: 'x', beatChanges: [{ beatId: 'beat-1-1', status, evidenceQuote: '证据', reason: '试图回退' }] } },
      );
      assert.equal(next.destiny.beats[0].status, 'satisfied', `${status} 不应覆盖 satisfied`);
    }
  });

  it('已 satisfied 的故事节改为 weakened/reframed 必须带证据', () => {
    const satisfiedState = { destiny: { ...makeState().destiny, beats: [{ beatId: 'beat-1-1', status: 'satisfied', evidenceTurns: [3], updatedAtTurn: 3 }] } };
    const noEvidence = commit(satisfiedState, {
      destiny: { reason: 'x', beatChanges: [{ beatId: 'beat-1-1', status: 'weakened', reason: '无证据' }] },
    });
    assert.equal(noEvidence.destiny.beats[0].status, 'satisfied');

    const withEvidence = commit(satisfiedState, {
      destiny: { reason: 'x', beatChanges: [{ beatId: 'beat-1-1', status: 'weakened', evidenceQuote: '后续正文推翻', reason: '有证据' }] },
    });
    assert.equal(withEvidence.destiny.beats[0].status, 'weakened');
    assert.deepEqual(withEvidence.destiny.beats[0].evidenceTurns, [3, S]);
  });

  it('superseded 缺 replacementBeatId 时降级为 reframed；有真实替代者时正常写入', () => {
    const noReplacement = commitResult({}, {
      destiny: { reason: 'x', beatChanges: [{ beatId: 'beat-1-1', status: 'superseded', evidenceQuote: '证据', reason: 'x' }] },
    });
    assert.equal(noReplacement.state.destiny.beats[0].status, 'reframed');
    assert.equal(noReplacement.warnings[0]?.code, 'superseded_replacement_missing');

    const applied = commitResult({}, {
      destiny: {
        reason: 'x',
        beatChanges: [{ beatId: 'beat-1-1', status: 'superseded', replacementBeatId: 'beat-1-2', evidenceQuote: '证据', reason: 'x' }],
      },
    });
    assert.equal(applied.state.destiny.beats[0].status, 'superseded');
    assert.equal(applied.state.destiny.beats[0].replacementBeatId, 'beat-1-2');
    assert.deepEqual(applied.warnings, [], '有真实替代者时不应产生警告');
  });

  it('replacementBeatId 指向不存在的故事节时降级为 reframed，而不是无替代者的 superseded（回归）', () => {
    const result = commitResult({}, {
      destiny: {
        reason: 'x',
        beatChanges: [{ beatId: 'beat-1-1', status: 'superseded', replacementBeatId: 'beat-does-not-exist', evidenceQuote: '证据', reason: 'x' }],
      },
    });
    // 不能保留 superseded：结局判定把它算作已完成，会虚增完成度并可能提前触发结尾，
    // 而那个替代者永远不会存在。降级为 reframed 既不丢剧情推进，也不放宽结局门槛。
    assert.equal(result.state.destiny.beats[0].status, 'reframed');
    assert.equal(result.state.destiny.beats[0].replacementBeatId, undefined);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].code, 'superseded_replacement_missing');
    assert.ok(result.warnings[0].message.includes('beat-does-not-exist'), '警告应指明无效的替代者 id');
  });

  it('历史坏数据：已落库的无替代者 superseded 会被降回 reframed', () => {
    const state = makeState({
      destiny: {
        completionEstimate: 90,
        completionReason: '接近结尾',
        currentActId: 'act-1',
        currentStage: '第一幕',
        currentPath: 'p',
        beats: [
          { beatId: 'beat-1-1', status: 'satisfied', evidenceTurns: [1], updatedAtTurn: 1 },
          { beatId: 'beat-1-2', status: 'superseded', evidenceTurns: [1], updatedAtTurn: 1 },
        ],
        endingReached: false,
        updatedAtTurn: 0,
      },
    });
    const warnings: PatchWarningV2[] = [];
    const next = commitTurnPatchV2(state, makePatch({
      baseRevision: state.revision,
      turn: state.turn,
      destiny: { reason: '收尾', completionEstimate: 100, endingReached: true },
    }), warnings);
    assert.equal(next.destiny.beats[1].status, 'reframed', '无替代者的 superseded 必须重新计入待完成');
    assert.ok(warnings.some((w) => w.code === 'superseded_replacement_dangling'));
    // 仍有未完成的故事节 → 结局不得触发
    assert.equal(next.destiny.endingReached, false);
  });

  it('全部故事节 satisfied/superseded 且完成度 100 时结局正常触发（不受上面的降级影响）', () => {
    const state = makeState({
      destiny: {
        completionEstimate: 99,
        completionReason: '只差一步',
        currentActId: 'act-1',
        currentStage: '第一幕',
        currentPath: 'p',
        beats: [{ beatId: 'beat-1-1', status: 'satisfied', evidenceTurns: [1], updatedAtTurn: 1 }],
        endingReached: false,
        updatedAtTurn: 0,
      },
    });
    const warnings: PatchWarningV2[] = [];
    const next = commitTurnPatchV2(state, makePatch({
      baseRevision: state.revision,
      turn: state.turn,
      destiny: { reason: '收尾', completionEstimate: 100, endingReached: true },
    }), warnings);
    assert.equal(next.destiny.endingReached, true);
    assert.equal(next.destiny.endingReachedAtTurn, state.turn);
    assert.deepEqual(warnings, []);
  });

  it('beatId 不存在、beatChanges 混入非法元素时安全忽略', () => {
    const next = commit({}, {
      destiny: {
        reason: 'x',
        beatChanges: [
          { beatId: 'beat-none', status: 'satisfied', evidenceQuote: '证据', reason: 'x' },
          'not-an-object',
          null,
          { beatId: 'beat-1-1', status: 'active', evidenceQuote: '证据', reason: 'x' },
        ] as unknown as NonNullable<TurnPatchV2['destiny']>['beatChanges'],
      },
    });
    assert.equal(next.destiny.beats.find((x) => x.beatId === 'beat-1-1')?.status, 'active');
    assert.equal(next.destiny.beats.find((x) => x.beatId === 'beat-1-2')?.status, 'pending');
  });

  it('同一回合内 evidenceTurns 不重复累积', () => {
    const state = makeState({
      destiny: { ...makeState().destiny, beats: [{ beatId: 'beat-1-1', status: 'active', evidenceTurns: [S], updatedAtTurn: S }] },
    });
    const next = commitTurnPatchV2(state, makePatch({
      baseRevision: state.revision,
      turn: state.turn,
      destiny: { reason: 'x', beatChanges: [{ beatId: 'beat-1-1', status: 'satisfied', evidenceQuote: '证据', reason: 'x' }] },
    }));
    assert.deepEqual(next.destiny.beats[0].evidenceTurns, [S]);
  });

  it('completionEstimate 夹在 0-100，completionReason 空串保持旧值，nextMilestone 空串会被清空（不对称）', () => {
    const high = commit({}, { destiny: { reason: 'x', completionEstimate: 500, completionReason: '   ', nextMilestone: '', convergencePlan: '' } });
    assert.equal(high.destiny.completionEstimate, 100);
    assert.equal(high.destiny.completionReason, '旧完成度说明');
    assert.equal(high.destiny.nextMilestone, undefined);
    assert.equal(high.destiny.convergencePlan, undefined);

    const low = commit({}, { destiny: { reason: 'x', completionEstimate: -40 } });
    assert.equal(low.destiny.completionEstimate, 0);
  });

  it('patch.destiny 不是对象时整个命运块保持不变', () => {
    const state = makeState();
    const next = commitTurnPatchV2(state, makePatch({ baseRevision: state.revision, turn: state.turn, destiny: 'invalid' as any }));
    assert.deepEqual(next.destiny, state.destiny);
  });

  it('缺 reason 时仍逐项提交合法命运字段（reason 不是事务开关）', () => {
    const next = commit({}, {
      destiny: { completionEstimate: 55, currentPath: '新路径', beatChanges: [{ beatId: 'beat-1-1', status: 'satisfied', evidenceQuote: '证据' }] } as any,
    });
    assert.equal(next.destiny.completionEstimate, 55);
    assert.equal(next.destiny.currentPath, '新路径');
    assert.equal(next.destiny.beats[0].status, 'satisfied');
  });
});

describe('patch — 结局判定', () => {
  it('仅当 endingReached && 完成度 100 && 全部故事节 satisfied/superseded 时置为结局', () => {
    const next = commit({}, {
      destiny: {
        reason: 'x',
        completionEstimate: 100,
        endingReached: true,
        beatChanges: [
          { beatId: 'beat-1-1', status: 'satisfied', evidenceQuote: '证据一', reason: 'x' },
          { beatId: 'beat-1-2', status: 'satisfied', evidenceQuote: '证据二', reason: 'x' },
        ],
      },
    });
    assert.equal(next.destiny.endingReached, true);
    assert.equal(next.destiny.endingReachedAtTurn, S);
  });

  it('superseded 也算满足', () => {
    const next = commit({}, {
      destiny: {
        reason: 'x',
        completionEstimate: 100,
        endingReached: true,
        beatChanges: [
          { beatId: 'beat-1-1', status: 'satisfied', evidenceQuote: '证据一', reason: 'x' },
          { beatId: 'beat-1-2', status: 'superseded', replacementBeatId: 'beat-1-1', evidenceQuote: '证据二', reason: 'x' },
        ],
      },
    });
    assert.equal(next.destiny.endingReached, true);
  });

  it('还有故事节未满足时不置结局', () => {
    const next = commit({}, {
      destiny: {
        reason: 'x',
        completionEstimate: 100,
        endingReached: true,
        beatChanges: [{ beatId: 'beat-1-1', status: 'satisfied', evidenceQuote: '证据', reason: 'x' }],
      },
    });
    assert.equal(next.destiny.endingReached, false);
  });

  it('完成度不足 100 时不置结局', () => {
    const next = commit({}, {
      destiny: {
        reason: 'x',
        completionEstimate: 99,
        endingReached: true,
        beatChanges: [
          { beatId: 'beat-1-1', status: 'satisfied', evidenceQuote: '证据一', reason: 'x' },
          { beatId: 'beat-1-2', status: 'satisfied', evidenceQuote: '证据二', reason: 'x' },
        ],
      },
    });
    assert.equal(next.destiny.endingReached, false);
  });

  it('没有故事节（空 beats）时不置结局', () => {
    const next = commit(
      { destiny: { ...makeState().destiny, beats: [] } },
      { destiny: { reason: 'x', completionEstimate: 100, endingReached: true } },
    );
    assert.equal(next.destiny.endingReached, false);
  });

  it('已到达结局后不重复写入 endingReachedAtTurn', () => {
    const state = makeState({
      destiny: {
        ...makeState().destiny,
        endingReached: true,
        endingReachedAtTurn: 5,
        beats: [
          { beatId: 'beat-1-1', status: 'satisfied', evidenceTurns: [5], updatedAtTurn: 5 },
          { beatId: 'beat-1-2', status: 'satisfied', evidenceTurns: [5], updatedAtTurn: 5 },
        ],
      },
    });
    const next = commitTurnPatchV2(state, makePatch({
      baseRevision: state.revision,
      turn: state.turn,
      destiny: { reason: 'x', completionEstimate: 100, endingReached: true },
    }));
    assert.equal(next.destiny.endingReached, true);
    assert.equal(next.destiny.endingReachedAtTurn, 5);
  });
});

describe('patch — 随机事件', () => {
  it('到期且 handled=true：重排 nextTriggerTurn 到 [turn+min, turn+max]，刷新 lastTriggeredTurn', () => {
    const next = commit(
      { randomEvent: { enabled: true, nextTriggerTurn: 3, pending: false, intensity: 'related', triggerIntervalMin: 3, triggerIntervalMax: 5 } },
      { randomEvent: { handled: true, note: '一场暴雨' } },
    );
    assert.equal(next.randomEvent.pending, false);
    assert.equal(next.randomEvent.lastTriggeredTurn, S);
    assert.equal(next.randomEvent.lastNote, '一场暴雨');
    assert.ok(next.randomEvent.nextTriggerTurn >= S + 3, `下界错误：${next.randomEvent.nextTriggerTurn}`);
    assert.ok(next.randomEvent.nextTriggerTurn <= S + 5, `上界错误：${next.randomEvent.nextTriggerTurn}`);
    assert.ok(['related', 'progress', 'destiny'].includes(next.randomEvent.intensity));
  });

  it('区间 min=max 时 nextTriggerTurn 完全确定', () => {
    for (let i = 0; i < 20; i += 1) {
      const next = commit(
        { randomEvent: { enabled: true, nextTriggerTurn: 3, pending: false, intensity: 'related', triggerIntervalMin: 4, triggerIntervalMax: 4 } },
        { randomEvent: { handled: true } },
      );
      assert.equal(next.randomEvent.nextTriggerTurn, S + 4);
    }
  });

  it('到期但未 handled：pending=true 且 nextTriggerTurn 顺延到下一回合', () => {
    const next = commit(
      { randomEvent: { enabled: true, nextTriggerTurn: 3, pending: false, intensity: 'related', triggerIntervalMin: 3, triggerIntervalMax: 5 } },
      { randomEvent: { handled: false, note: '计划留到下一回合' } },
    );
    assert.equal(next.randomEvent.pending, true);
    assert.equal(next.randomEvent.nextTriggerTurn, S + 1);
    assert.equal(next.randomEvent.lastNote, '计划留到下一回合');
    assert.equal(next.randomEvent.lastTriggeredTurn, undefined);
  });

  it('pending=true 时即使未到 nextTriggerTurn 也算到期', () => {
    const next = commit(
      { randomEvent: { enabled: true, nextTriggerTurn: 99, pending: true, intensity: 'progress', triggerIntervalMin: 2, triggerIntervalMax: 2 } },
      { randomEvent: { handled: true } },
    );
    assert.equal(next.randomEvent.pending, false);
    assert.equal(next.randomEvent.lastTriggeredTurn, S);
    assert.equal(next.randomEvent.nextTriggerTurn, S + 2);
  });

  it('enabled=false 时清空 pending、保留 nextTriggerTurn，并记录 note', () => {
    const next = commit(
      { randomEvent: { enabled: false, nextTriggerTurn: 3, pending: true, intensity: 'related', triggerIntervalMin: 3, triggerIntervalMax: 5 } },
      { randomEvent: { handled: true, note: '本应触发但已关闭' } },
    );
    assert.equal(next.randomEvent.pending, false);
    assert.equal(next.randomEvent.nextTriggerTurn, 3);
    assert.equal(next.randomEvent.lastTriggeredTurn, undefined);
    assert.equal(next.randomEvent.lastNote, '本应触发但已关闭');
  });

  it('未到期且未提交 randomEvent 时状态保持', () => {
    const state = makeState();
    const next = commitTurnPatchV2(state, makePatch({ baseRevision: state.revision, turn: state.turn }));
    assert.deepEqual(next.randomEvent, state.randomEvent);
  });

  it('未到期时不改动调度字段，但 note 作为审计文本仍会记录（回归：曾无声丢弃）', () => {
    const next = commit({}, { randomEvent: { handled: true, note: '不该记录的备注' } });
    // handled=true 不生效：事件没到期就不该被标记为已触发
    assert.equal(next.randomEvent.lastTriggeredTurn, undefined);
    assert.equal(next.randomEvent.pending, false, '未到期不应把事件改成 pending');
    // 但 lastNote 只是给玩家看的说明文本，不参与调度，没有理由丢掉
    assert.equal(next.randomEvent.lastNote, '不该记录的备注');
  });

  it('note 不会影响到期回合的调度（handled 仍是唯一开关）', () => {
    const pendingState = makeState({
      randomEvent: { enabled: true, nextTriggerTurn: 1, pending: true, intensity: 'related', triggerIntervalMin: 3, triggerIntervalMax: 3 },
    });
    const next = commitTurnPatchV2(pendingState, makePatch({
      baseRevision: pendingState.revision,
      turn: pendingState.turn,
      randomEvent: { handled: false, note: '计划留到下一回合' },
    }));
    assert.equal(next.randomEvent.pending, true, '未 handled 时事件继续 pending');
    assert.equal(next.randomEvent.lastNote, '计划留到下一回合');
    assert.equal(next.randomEvent.nextTriggerTurn, pendingState.turn + 1);
  });
});

describe('patch — 随机事件三态闭环与智能调度（D7）', () => {
  const binding = { targetKind: 'beat' as const, targetId: 'beat-1-1', summary: '雨夜交出旧信', plannedAtTurn: 6 };

  /** 到期状态：nextTriggerTurn=1 < turn=7，且区间 min=max 让重排结果确定。 */
  function dueState(randomEventOverrides: Record<string, unknown> = {}): GameStateV2 {
    return makeState({
      randomEvent: {
        enabled: true,
        nextTriggerTurn: 1,
        pending: false,
        intensity: 'related',
        triggerIntervalMin: 2,
        triggerIntervalMax: 2,
        ...randomEventOverrides,
      },
    });
  }

  /** 基于给定状态提交 Patch 并收集警告。 */
  function commitWith(state: GameStateV2, patchOverrides: Record<string, unknown> = {}) {
    const warnings: PatchWarningV2[] = [];
    const next = commitTurnPatchV2(
      state,
      makePatch({ baseRevision: state.revision, turn: state.turn, ...patchOverrides }),
      warnings,
    );
    return { state: next, warnings };
  }

  it('handled + resolved：写一条 resolved 历史、清空绑定并重排下一次触发', () => {
    const state = dueState({ activeBinding: binding });
    const { state: next, warnings } = commitWith(state, {
      randomEvent: { handled: true, resolution: 'resolved', note: '旧信被找到' },
    });

    assert.equal(next.randomEvent.history?.length, 1);
    const item = next.randomEvent.history![0];
    assert.equal(item.status, 'resolved');
    assert.equal(item.targetKind, 'beat');
    assert.equal(item.targetId, 'beat-1-1');
    assert.equal(item.summary, '雨夜交出旧信');
    assert.equal(item.outcomeNote, '旧信被找到');
    assert.equal(item.turn, S);
    assert.equal(item.intensity, 'related', '历史记录的是事件发生时的强度');
    assert.ok(item.id.length > 0);

    assert.equal('activeBinding' in next.randomEvent, false, '兑现后必须清空绑定');
    assert.equal(next.randomEvent.pending, false);
    assert.equal(next.randomEvent.lastTriggeredTurn, S);
    assert.equal(next.randomEvent.nextTriggerTurn, S + 2, 'min=max 时区间确定');
    assert.equal(next.randomEvent.intensity, 'related', '常态下智能强度回落到相关档');
    assert.equal(next.randomEvent.lastNote, '旧信被找到');
    assert.deepEqual(warnings, [], '正常结算不应产生提交警告');
  });

  it('handled + ongoing_hook：记为滚动钩子（不视为完整兑现），同样清空绑定', () => {
    const state = dueState({ activeBinding: binding });
    const { state: next } = commitWith(state, {
      randomEvent: { handled: true, resolution: 'ongoing_hook', note: '只让阿黎提到旧信' },
    });
    assert.equal(next.randomEvent.history?.[0].status, 'ongoing_hook');
    assert.equal('activeBinding' in next.randomEvent, false);
    assert.equal(next.randomEvent.lastTriggeredTurn, S, '已起头也算事件发生过');
  });

  it('handled=true 且缺 resolution 时按 resolved 处理（旧协议向后兼容）', () => {
    const state = dueState({ activeBinding: binding });
    const { state: next } = commitWith(state, { randomEvent: { handled: true } });
    assert.equal(next.randomEvent.history?.[0].status, 'resolved');
    assert.equal('activeBinding' in next.randomEvent, false);
  });

  it('handled=false + interrupted：写 interrupted 历史、pending 顺延到下一回合、保留绑定', () => {
    const state = dueState({ activeBinding: binding });
    const { state: next } = commitWith(state, {
      randomEvent: { handled: false, resolution: 'interrupted', note: '玩家转身离开' },
    });

    assert.equal(next.randomEvent.history?.length, 1);
    assert.equal(next.randomEvent.history![0].status, 'interrupted');
    assert.equal(next.randomEvent.history![0].outcomeNote, '玩家转身离开');
    assert.equal(next.randomEvent.pending, true);
    assert.equal(next.randomEvent.nextTriggerTurn, S + 1);
    assert.equal(next.randomEvent.lastTriggeredTurn, undefined, '未发生不算触发');
    assert.deepEqual(next.randomEvent.activeBinding, binding, '被打断时保留绑定供下回合重试');
  });

  it('handled=true 与 resolution=interrupted 冲突时以 interrupted 为准（自洽规则）', () => {
    const state = dueState({ activeBinding: binding });
    const { state: next } = commitWith(state, {
      randomEvent: { handled: true, resolution: 'interrupted' },
    });
    assert.equal(next.randomEvent.history?.[0].status, 'interrupted');
    assert.equal(next.randomEvent.pending, true);
    assert.deepEqual(next.randomEvent.activeBinding, binding);
  });

  it('handled=false 但 resolution=ongoing_hook 时信任三态：事件已起头，写历史并清空绑定', () => {
    const state = dueState({ activeBinding: binding });
    const { state: next } = commitWith(state, {
      randomEvent: { handled: false, resolution: 'ongoing_hook', note: '刚起了个头' },
    });
    assert.equal(next.randomEvent.history?.[0].status, 'ongoing_hook');
    assert.equal('activeBinding' in next.randomEvent, false);
    assert.equal(next.randomEvent.pending, false);
  });

  it('到期但既未 handled 也无 interrupted：维持 pending 顺延（旧行为不变）', () => {
    const state = dueState({ activeBinding: binding });
    const { state: next } = commitWith(state, { randomEvent: { handled: false } });
    assert.equal(next.randomEvent.pending, true);
    assert.equal(next.randomEvent.nextTriggerTurn, S + 1);
    assert.equal(next.randomEvent.history, undefined, '没有结算结果就不该伪造历史');
    assert.deepEqual(next.randomEvent.activeBinding, binding);
  });

  it('到期 handled 但没有 activeBinding（旧档/模型未规划绑定）：照常重排，不伪造 history', () => {
    const state = dueState();
    const { state: next } = commitWith(state, { randomEvent: { handled: true, resolution: 'resolved', note: '一次偶遇' } });
    assert.equal(next.randomEvent.history, undefined);
    assert.equal(next.randomEvent.lastTriggeredTurn, S);
    assert.equal(next.randomEvent.nextTriggerTurn, S + 2);
    assert.equal(next.randomEvent.lastNote, '一次偶遇');
  });

  it('未到期时调度、绑定与历史原样保留（只有 note 作为审计文本记录）', () => {
    const history = [
      { id: 'rev-1', turn: 2, intensity: 'related' as const, targetKind: 'beat' as const, targetId: 'beat-1-1', summary: '旧事件', status: 'resolved' as const },
    ];
    const state = makeState({
      randomEvent: {
        enabled: true,
        nextTriggerTurn: 99,
        pending: false,
        intensity: 'progress',
        triggerIntervalMin: 3,
        triggerIntervalMax: 5,
        activeBinding: binding,
        history,
      },
    });
    const untouched = commitWith(state, {}).state;
    assert.deepEqual(untouched.randomEvent, state.randomEvent, '未到期且无备注时随机事件状态逐字段不变');

    const withNote = commitWith(state, { randomEvent: { handled: true, note: '计划留到后面' } }).state;
    assert.deepEqual(withNote.randomEvent.activeBinding, binding);
    assert.deepEqual(withNote.randomEvent.history, history);
    assert.equal(withNote.randomEvent.pending, false);
    assert.equal(withNote.randomEvent.nextTriggerTurn, 99);
    assert.equal(withNote.randomEvent.lastNote, '计划留到后面');
  });

  it('历史滚动上限 8，且最近 3 条 ongoing_hook 优先保留', () => {
    const history = [
      { id: 'hook-1', turn: 1, intensity: 'related' as const, targetKind: 'beat' as const, targetId: 'beat-1-1', summary: '钩子1', status: 'ongoing_hook' as const },
      { id: 'hook-2', turn: 2, intensity: 'related' as const, targetKind: 'beat' as const, targetId: 'beat-1-1', summary: '钩子2', status: 'ongoing_hook' as const },
      { id: 'hook-3', turn: 3, intensity: 'related' as const, targetKind: 'beat' as const, targetId: 'beat-1-1', summary: '钩子3', status: 'ongoing_hook' as const },
      { id: 'rev-a', turn: 4, intensity: 'progress' as const, targetKind: 'beat' as const, targetId: 'beat-1-1', summary: '旧事件A', status: 'resolved' as const },
      { id: 'rev-b', turn: 5, intensity: 'progress' as const, targetKind: 'beat' as const, targetId: 'beat-1-1', summary: '旧事件B', status: 'resolved' as const },
      { id: 'rev-c', turn: 6, intensity: 'related' as const, targetKind: 'beat' as const, targetId: 'beat-1-1', summary: '旧事件C', status: 'resolved' as const },
      { id: 'rev-d', turn: 6, intensity: 'related' as const, targetKind: 'beat' as const, targetId: 'beat-1-1', summary: '旧事件D', status: 'resolved' as const },
      { id: 'rev-e', turn: 6, intensity: 'related' as const, targetKind: 'beat' as const, targetId: 'beat-1-1', summary: '旧事件E', status: 'resolved' as const },
    ];
    const state = dueState({ activeBinding: binding, history });
    const { state: next } = commitWith(state, { randomEvent: { handled: true, resolution: 'resolved' } });
    const nextHistory = next.randomEvent.history!;
    assert.equal(nextHistory.length, 8, '滚动上限 8');
    assert.deepEqual(nextHistory.filter((item) => item.status === 'ongoing_hook').map((item) => item.id), ['hook-1', 'hook-2', 'hook-3'], '三条钩子全部保留');
    assert.equal(nextHistory[nextHistory.length - 1].targetId, 'beat-1-1', '新事件追加在最后');
    assert.ok(!nextHistory.some((item) => item.id === 'rev-a'), '最旧的非钩子事件被裁掉');
  });

  it('旧存档没有 history / activeBinding 字段时不崩，到期不写伪造历史', () => {
    const state = makeState({
      randomEvent: { enabled: true, nextTriggerTurn: 1, pending: false, intensity: 'related', triggerIntervalMin: 2, triggerIntervalMax: 2 },
    });
    assert.equal('history' in state.randomEvent, false);
    assert.equal('activeBinding' in state.randomEvent, false);
    const { state: next } = commitWith(state, { randomEvent: { handled: true } });
    assert.equal(next.randomEvent.history, undefined);
    assert.equal(next.revision, state.revision + 1);
  });

  it('幕切换平滑：nextTriggerTurn 很远时拉近到 turn+1~2 并升级为推进档', () => {
    const state = makeState({
      randomEvent: { enabled: true, nextTriggerTurn: 99, pending: false, intensity: 'related', triggerIntervalMin: 3, triggerIntervalMax: 5 },
      destiny: {
        ...makeState().destiny,
        currentActId: 'act-1',
        currentActIndex: 0,
        actHistory: [],
        beats: [
          { beatId: 'beat-1-1', actId: 'act-1', status: 'available', evidenceTurns: [], updatedAtTurn: 0 },
          { beatId: 'beat-1-2', actId: 'act-1', status: 'pending', evidenceTurns: [], updatedAtTurn: 0 },
          { beatId: 'beat-2-1', actId: 'act-2', status: 'pending', evidenceTurns: [], updatedAtTurn: 0 },
        ],
      },
    });
    const { state: next } = commitWith(state, {
      destiny: {
        reason: '本幕收束',
        beatChanges: [
          { beatId: 'beat-1-1', status: 'satisfied', evidenceQuote: '证据一' },
          { beatId: 'beat-1-2', status: 'satisfied', evidenceQuote: '证据二' },
        ],
      },
    });
    assert.equal(next.destiny.lastActTransitionTurn, S, '先确认本回合确实发生了切幕');
    assert.equal(next.randomEvent.intensity, 'progress', '刚切幕 → 智能强度给推进档');
    assert.equal(next.randomEvent.nextTriggerTurn, S + 2);
    assert.equal(next.randomEvent.lastTriggeredTurn, undefined, '平滑只调调度，不伪造事件已发生');
    assert.equal(next.randomEvent.history, undefined);
  });

  it('幕切换平滑：存在 reframed 节时升级为命运档并拉近到 turn+1', () => {
    const state = makeState({
      randomEvent: { enabled: true, nextTriggerTurn: 99, pending: false, intensity: 'related', triggerIntervalMin: 3, triggerIntervalMax: 5 },
      destiny: {
        ...makeState().destiny,
        currentActId: 'act-1',
        currentActIndex: 1,
        actHistory: [],
        beats: [
          { beatId: 'beat-0-1', actId: 'act-0', status: 'reframed', currentPlan: '换实现', evidenceTurns: [], updatedAtTurn: 5 },
          { beatId: 'beat-1-1', actId: 'act-1', status: 'available', evidenceTurns: [], updatedAtTurn: 0 },
          { beatId: 'beat-1-2', actId: 'act-1', status: 'pending', evidenceTurns: [], updatedAtTurn: 0 },
          { beatId: 'beat-2-1', actId: 'act-2', status: 'pending', evidenceTurns: [], updatedAtTurn: 0 },
        ],
      },
    });
    const { state: next } = commitWith(state, {
      destiny: {
        reason: '本幕收束',
        beatChanges: [
          { beatId: 'beat-1-1', status: 'satisfied', evidenceQuote: '证据一' },
          { beatId: 'beat-1-2', status: 'satisfied', evidenceQuote: '证据二' },
        ],
      },
    });
    assert.equal(next.destiny.lastActTransitionTurn, S);
    assert.equal(next.randomEvent.intensity, 'destiny');
    assert.equal(next.randomEvent.nextTriggerTurn, S + 1);
  });

  it('未切幕或 nextTriggerTurn 已在 turn+2 内时，平滑不生效', () => {
    const noTransition = makeState({
      randomEvent: { enabled: true, nextTriggerTurn: 99, pending: false, intensity: 'related', triggerIntervalMin: 3, triggerIntervalMax: 5 },
    });
    const { state: next } = commitWith(noTransition, {});
    assert.equal(next.randomEvent.nextTriggerTurn, 99, '没有切幕不该改调度');
    assert.equal(next.randomEvent.intensity, 'related');

    const state = makeState({
      randomEvent: { enabled: true, nextTriggerTurn: S + 2, pending: false, intensity: 'progress', triggerIntervalMin: 3, triggerIntervalMax: 5 },
      destiny: {
        ...makeState().destiny,
        currentActId: 'act-1',
        currentActIndex: 0,
        beats: [
          { beatId: 'beat-1-1', actId: 'act-1', status: 'available', evidenceTurns: [], updatedAtTurn: 0 },
          { beatId: 'beat-2-1', actId: 'act-2', status: 'pending', evidenceTurns: [], updatedAtTurn: 0 },
        ],
      },
    });
    const { state: pulled } = commitWith(state, {
      destiny: { reason: '收束', beatChanges: [{ beatId: 'beat-1-1', status: 'satisfied', evidenceQuote: '证据' }] },
    });
    assert.equal(pulled.destiny.lastActTransitionTurn, S);
    assert.equal(pulled.randomEvent.nextTriggerTurn, S + 2, '已在 turn+2 内时不重复拉近');
    assert.equal(pulled.randomEvent.intensity, 'progress', '已有强度也不被覆盖');
  });
});

describe('patch — 提交对账统计（patchStats）', () => {
  const emptyStats = emptyPatchStatsV2;
  const run = (patchOverrides: Record<string, unknown>, stateOverrides: Record<string, unknown> = {}) => {
    const state = makeState(stateOverrides);
    const warnings: PatchWarningV2[] = [];
    const stats = emptyStats();
    const next = commitTurnPatchV2(state, makePatch({ baseRevision: state.revision, turn: state.turn, ...patchOverrides }), warnings, stats);
    return { next, warnings, stats };
  };

  it('干净提交：全部落地、零丢弃、不产生汇总警告', () => {
    const { stats, warnings } = run({
      characters: [{ op: 'create', id: 'char-new', name: '新人', reason: 'x' }],
      inventory: [{ op: 'grant', id: 'item-1', quantity: 1, reason: 'x' }],
      threads: [{ op: 'update', id: 'thread-1', status: 'completed', reason: 'x' }],
      facts: [{ op: 'create', subjectId: 'char-a', predicate: 'job', value: '医生', stability: 'stable', confidence: 'explicit', evidenceQuote: '正文原句', reason: 'x' }],
    });
    assert.equal(stats.characters.input, 1);
    assert.equal(stats.characters.applied, 1);
    assert.equal(stats.characters.blocked, 0);
    assert.equal(stats.facts.input, 1);
    assert.equal(stats.facts.applied, 1);
    assert.equal(stats.facts.blocked, 0);
    assert.equal(stats.inventory.blocked, 0);
    assert.equal(stats.coercedEnums, 0);
    assert.deepEqual(warnings, [], '干净提交不应产生任何警告');
  });

  it('被丢弃的条目会被计数：缺证据的事实、不存在的 id、非法关系', () => {
    const { stats, warnings } = run({
      characters: [
        { op: 'create', id: 'char-ok', name: '有效人物', reason: 'x' },
        { op: 'create', id: 'char-bad', reason: '缺 name' },
        { op: 'update', id: 'char-nonexistent', status: 'absent', reason: 'x' },
      ],
      relationships: [
        { fromId: 'player', toId: 'char-a', affinityDelta: 1, reason: 'x' },
        { fromId: 'player', toId: 'char-ghost', affinityDelta: 1, reason: '目标不存在' },
        { fromId: 'player', toId: 'char-a', affinityDelta: 1 },
      ],
      facts: [
        { op: 'create', subjectId: 'char-a', predicate: 'ok', value: '有证据', stability: 'stable', confidence: 'explicit', evidenceQuote: '原句', reason: 'x' },
        { op: 'create', subjectId: 'char-a', predicate: 'noquote', value: '无证据', stability: 'stable', confidence: 'explicit' },
        { op: 'create', subjectId: 'char-a', predicate: 'inferred', value: '推测', stability: 'stable', confidence: 'inferred', evidenceQuote: '原句' },
      ],
    });
    assert.equal(stats.characters.input, 3);
    assert.equal(stats.characters.applied, 1, '只有一条新建落地');
    // 缺 name 属「结构不全」，id 不存在属「字段齐全但被拒」——分开计数，因为修法不同：
    // 前者要改输出模板与指令，后者要加 id 回显校验。
    assert.equal(stats.characters.blocked, 2, '缺 name 与 id 不存在都算丢弃');
    assert.equal(stats.characters.malformed, 1, '只有缺 name 那条算结构不全');
    assert.equal(stats.relationships.input, 3);
    assert.equal(stats.relationships.blocked, 2, '目标不存在与缺 reason 各算一条');
    assert.equal(stats.relationships.malformed, 1, '只有缺 reason 那条算结构不全');
    assert.equal(stats.facts.input, 3);
    assert.equal(stats.facts.applied, 1);
    assert.equal(stats.facts.blocked, 2, '缺证据与 inferred 各算一条');
    // 有丢弃时必须出现汇总警告，否则这个数字只存在于代码里
    const summary = warnings.find((w) => w.code === 'patch_items_blocked');
    assert.ok(summary, '应产生 patch_items_blocked 汇总警告');
    assert.ok(summary.message.includes('6 条'), `汇总消息应给出总数，实际：${summary.message}`);
  });

  it('枚举改写会被计数（三类：人物状态、物品类型、线程状态）', () => {
    const { stats } = run({
      characters: [{ op: 'update', id: 'char-a', status: '死亡', reason: 'x' }],
      inventory: [{ op: 'grant', id: 'item-new', name: '玉符', kind: '能力', quantity: 1, reason: 'x' }],
      threads: [{ op: 'update', id: 'thread-1', status: '已完成', reason: 'x' }],
    });
    assert.equal(stats.coercedEnums, 3, '三处非白名单枚举都应被计数');
  });

  it('不传 stats 时行为完全不变（向后兼容）', () => {
    const state = makeState();
    const warnings: PatchWarningV2[] = [];
    const next = commitTurnPatchV2(state, makePatch({ baseRevision: state.revision, turn: state.turn, characters: [{ op: 'create', id: 'x', reason: '缺 name' }] }), warnings);
    assert.equal(next.characters.length, state.characters.length);
    // 没有 stats 时不产生汇总警告（避免给现有调用方增加噪音）
    assert.equal(warnings.some((w) => w.code === 'patch_items_blocked'), false);
  });
});

describe('patch — 顶层汇总、场景与 actions', () => {
  it('author 模式强制 availableActions 为空', () => {
    const next = commit({ mode: 'author' }, {
      actions: [{ id: 'a1', label: '选项一' }, { id: 'a2', label: '选项二' }],
    });
    assert.deepEqual(next.availableActions, []);
  });

  it('adventure 模式最多保留 4 个 action', () => {
    const actions = Array.from({ length: 6 }, (_, i) => ({ id: `a${i}`, label: `选项${i}` }));
    const next = commit({ mode: 'adventure' }, { actions });
    assert.equal(next.availableActions.length, 4);
    assert.deepEqual(next.availableActions.map((x) => x.label), ['选项0', '选项1', '选项2', '选项3']);

    const empty = commit({ mode: 'adventure' }, {});
    assert.deepEqual(empty.availableActions, []);
  });

  it('roundSummary 为空时保留旧摘要，非空时 trim 覆盖', () => {
    assert.equal(commit({}, { roundSummary: '' }).summary, '旧摘要');
    assert.equal(commit({}, { roundSummary: '  新摘要  ' }).summary, '新摘要');
  });

  it('latestProgress 缺省或为空时保留旧进展，非空时 trim 覆盖（回归：曾清空进度）', () => {
    // 与上面 roundSummary 的处理保持一致：空串/空白串都视为“未提供”，保留旧值。
    assert.equal(commit({}, { latestProgress: undefined }).latestProgress, '旧进展');
    assert.equal(commit({}, { latestProgress: '   ' }).latestProgress, '旧进展');
    assert.equal(commit({}, { latestProgress: ' 新进展 ' }).latestProgress, '新进展');
  });

  it('scene 部分更新保留旧字段，未提供时沿用旧场景', () => {
    const partial = commit({}, { scene: { name: '新场景', time: '' } });
    assert.equal(partial.currentScene?.id, 'scene-1');
    assert.equal(partial.currentScene?.name, '新场景');
    assert.equal(partial.currentScene?.description, '旧场景描述');
    assert.equal(partial.currentScene?.time, '傍晚', '空字符串回退到旧值');
    assert.equal(partial.currentScene?.weather, '雨');

    const untouched = commit({}, {});
    assert.equal(untouched.currentScene?.name, '旧场景');
  });

  it('revision 递增、lastCommitId 更新，其它顶层字段不受 Patch 影响', () => {
    const state = makeState();
    const next = commitTurnPatchV2(state, makePatch({ baseRevision: state.revision, turn: state.turn, commitId: 'commit-42' }));
    assert.equal(next.revision, state.revision + 1);
    assert.equal(next.lastCommitId, 'commit-42');
    assert.equal(next.turn, state.turn);
    assert.equal(next.phase, state.phase);
    assert.deepEqual(next.history, state.history);
    assert.equal(next.mode, state.mode);
    assert.equal(next.narrativePace, state.narrativePace);
  });

  it('提交不会修改传入的 state 对象（不可变性）', () => {
    const state = makeState();
    const snapshot = structuredClone(state);
    commitTurnPatchV2(state, makePatch({
      baseRevision: state.revision,
      turn: state.turn,
      characters: [{ op: 'create', id: 'char-a', name: '阿黎', aliases: ['新别名'], addFacts: ['新事实'] }],
      relationships: [{ fromId: 'player', toId: 'char-a', affinityDelta: 20, reason: 'x' }],
      inventory: [{ op: 'grant', id: 'item-1', quantity: 1, reason: 'x' }],
      threads: [{ op: 'update', id: 'thread-1', status: 'completed', involvedCharacterIds: ['char-b'], reason: 'x' }],
      facts: [{ op: 'create', subjectId: 'char-a', predicate: 'city', value: '城南', evidenceQuote: '证据' }],
      destiny: { reason: 'x', beatChanges: [{ beatId: 'beat-1-1', status: 'satisfied', evidenceQuote: '证据' }] },
      scene: { name: '新场景' },
    }));
    assert.deepEqual(state, snapshot, '原状态应保持完全不变');
  });
});

describe('patch — 程序权威幕状态机', () => {
  /**
   * 构造一份"带幕"的权威状态：act-1（beat-1-1、beat-1-2）→ act-2（beat-2-1）。
   * 与 makeState 的区别是每个故事节都带 actId，程序才能推导幕顺序。
   */
  function actState(destinyOverrides: Record<string, unknown> = {}): GameStateV2 {
    const base = makeState();
    return makeState({
      destiny: {
        ...base.destiny,
        currentActId: 'act-1',
        currentActIndex: 0,
        actHistory: [],
        beats: [
          { beatId: 'beat-1-1', actId: 'act-1', status: 'available', evidenceTurns: [], updatedAtTurn: 0 },
          { beatId: 'beat-1-2', actId: 'act-1', status: 'pending', evidenceTurns: [], updatedAtTurn: 0 },
          { beatId: 'beat-2-1', actId: 'act-2', status: 'pending', evidenceTurns: [], updatedAtTurn: 0 },
        ],
        ...destinyOverrides,
      },
    });
  }

  /** 基于带幕状态提交一个 Patch，并收集提交阶段警告。 */
  function commitAct(state: GameStateV2, patchOverrides: Record<string, unknown> = {}) {
    const warnings: PatchWarningV2[] = [];
    const next = commitTurnPatchV2(
      state,
      makePatch({ baseRevision: state.revision, turn: state.turn, ...patchOverrides }),
      warnings,
    );
    return { state: next, warnings };
  }

  it('常规轨：本幕原生故事节全部终态时自动进入下一幕，并记录幕历史', () => {
    const state = actState();
    const { state: next, warnings } = commitAct(state, {
      destiny: {
        reason: '本幕收束',
        beatChanges: [
          { beatId: 'beat-1-1', status: 'satisfied', evidenceQuote: '证据一' },
          { beatId: 'beat-1-2', status: 'satisfied', evidenceQuote: '证据二' },
        ],
      },
    });
    assert.equal(next.destiny.currentActId, 'act-2');
    assert.equal(next.destiny.currentActIndex, 1);
    assert.equal(next.destiny.lastActTransitionTurn, S);
    assert.equal(next.destiny.currentStage, '本幕开篇', '切幕后给程序侧兜底阶段文本，等模型下轮写出具体阶段');
    assert.deepEqual(next.destiny.actHistory, [{
      actId: 'act-1',
      enteredTurn: 0,
      exitedTurn: S,
      exitSummary: '本轮摘要',
    }]);
    // actId 不可变：故事节仍归属原幕
    assert.deepEqual(next.destiny.beats.map((beat) => [beat.beatId, beat.actId]), [
      ['beat-1-1', 'act-1'],
      ['beat-1-2', 'act-1'],
      ['beat-2-1', 'act-2'],
    ]);
    assert.deepEqual(warnings, []);
  });

  it('常规轨：roundSummary 为空时 exitSummary 用旧摘要，超过 150 字被截断', () => {
    const state = actState();
    const fallback = commitAct(state, {
      roundSummary: '',
      destiny: {
        reason: 'x',
        beatChanges: [
          { beatId: 'beat-1-1', status: 'satisfied', evidenceQuote: '证据一' },
          { beatId: 'beat-1-2', status: 'satisfied', evidenceQuote: '证据二' },
        ],
      },
    });
    assert.equal(fallback.state.destiny.actHistory[0]?.exitSummary, '旧摘要');

    const longSummary = '长'.repeat(200);
    const truncated = commitAct(state, {
      roundSummary: longSummary,
      destiny: {
        reason: 'x',
        beatChanges: [
          { beatId: 'beat-1-1', status: 'satisfied', evidenceQuote: '证据一' },
          { beatId: 'beat-1-2', status: 'satisfied', evidenceQuote: '证据二' },
        ],
      },
    });
    assert.equal(truncated.state.destiny.actHistory[0]?.exitSummary?.length, 150);
  });

  it('最后一幕：原生故事节全部终态也不自动推进，交给结局判定', () => {
    const state = actState({
      currentActId: 'act-2',
      currentActIndex: 1,
      beats: [
        { beatId: 'beat-1-1', actId: 'act-1', status: 'satisfied', evidenceTurns: [3], updatedAtTurn: 3 },
        { beatId: 'beat-1-2', actId: 'act-1', status: 'satisfied', evidenceTurns: [3], updatedAtTurn: 3 },
        { beatId: 'beat-2-1', actId: 'act-2', status: 'available', evidenceTurns: [], updatedAtTurn: 0 },
      ],
    });
    const { state: next, warnings } = commitAct(state, {
      destiny: { reason: 'x', beatChanges: [{ beatId: 'beat-2-1', status: 'satisfied', evidenceQuote: '证据' }] },
    });
    assert.equal(next.destiny.currentActId, 'act-2');
    assert.equal(next.destiny.currentActIndex, 1);
    assert.deepEqual(next.destiny.actHistory, []);
    assert.equal(next.destiny.lastActTransitionTurn, undefined);
    assert.deepEqual(warnings, []);
  });

  it('模型提交的 currentActId 与权威当前幕不一致时忽略并留警告（跳幕/未知/倒退）', () => {
    const forward = commitAct(actState(), { destiny: { reason: 'x', currentActId: 'act-2' } });
    assert.equal(forward.state.destiny.currentActId, 'act-1', '跳幕被拒绝');
    assert.equal(forward.state.destiny.currentActIndex, 0);
    assert.equal(forward.warnings.filter((warning) => warning.code === 'act_current_id_rejected').length, 1);

    const unknown = commitAct(actState(), { destiny: { reason: 'x', currentActId: '第三幕 · 未命名' } });
    assert.equal(unknown.state.destiny.currentActId, 'act-1', '自由文本/未知幕被拒绝');
    assert.ok(unknown.warnings.find((warning) => warning.code === 'act_current_id_rejected')?.message.includes('第三幕'));

    const backwardState = actState({ currentActId: 'act-2', currentActIndex: 1 });
    const backward = commitAct(backwardState, { destiny: { reason: 'x', currentActId: 'act-1' } });
    assert.equal(backward.state.destiny.currentActId, 'act-2', '倒退被拒绝');
    assert.equal(backward.warnings.filter((warning) => warning.code === 'act_current_id_rejected').length, 1);

    const same = commitAct(actState(), { destiny: { reason: 'x', currentActId: 'act-1' } });
    assert.deepEqual(same.warnings, [], '与权威值一致时不产生警告');
  });

  it('改道轨：三条 gate 通过时携节进入下一幕，挂账节保持非终态且 actId 不变', () => {
    const state = actState({
      beats: [
        { beatId: 'beat-1-1', actId: 'act-1', status: 'satisfied', evidenceTurns: [3], updatedAtTurn: 3 },
        { beatId: 'beat-1-2', actId: 'act-1', status: 'pending', evidenceTurns: [], updatedAtTurn: 0 },
        { beatId: 'beat-2-1', actId: 'act-2', status: 'pending', evidenceTurns: [], updatedAtTurn: 0 },
      ],
    });
    const { state: next, warnings } = commitAct(state, {
      destiny: {
        reason: '改道',
        actTransition: { proposeNextAct: true, actExitSummary: '玩家离开校园，下一幕在校外继续' },
        beatChanges: [{ beatId: 'beat-1-2', status: 'reframed', currentPlan: '在校外宾馆用电话完成边界确认', evidenceQuote: '证据', reason: '路线改变' }],
      },
    });
    assert.equal(next.destiny.currentActId, 'act-2');
    assert.equal(next.destiny.currentActIndex, 1);
    assert.equal(next.destiny.lastActTransitionTurn, S);
    assert.deepEqual(next.destiny.actHistory, [{
      actId: 'act-1',
      enteredTurn: 0,
      exitedTurn: S,
      exitSummary: '玩家离开校园，下一幕在校外继续',
      carriedBeatIds: ['beat-1-2'],
    }]);
    const carried = next.destiny.beats.find((beat) => beat.beatId === 'beat-1-2');
    assert.equal(carried?.status, 'reframed', '挂账节不视为完成');
    assert.equal(carried?.actId, 'act-1', 'actId 不可变：不把故事节搬到下一幕');
    assert.equal(carried?.carriedFromActId, 'act-1');
    assert.deepEqual(warnings, []);
  });

  it('改道轨：挂账时保留最早的原属幕（已有 carriedFromActId 不覆盖）', () => {
    const state = actState({
      beats: [
        { beatId: 'beat-1-1', actId: 'act-1', status: 'satisfied', evidenceTurns: [3], updatedAtTurn: 3 },
        { beatId: 'beat-1-2', actId: 'act-1', status: 'reframed', currentPlan: '既有计划', carriedFromActId: 'act-0', evidenceTurns: [], updatedAtTurn: 3 },
        { beatId: 'beat-2-1', actId: 'act-2', status: 'pending', evidenceTurns: [], updatedAtTurn: 0 },
      ],
    });
    const { state: next } = commitAct(state, { destiny: { reason: 'x', actTransition: { proposeNextAct: true } } });
    assert.equal(next.destiny.currentActId, 'act-2');
    assert.equal(next.destiny.beats.find((beat) => beat.beatId === 'beat-1-2')?.carriedFromActId, 'act-0');
  });

  it('挂账节仍是非终态：不因跨幕挂账放宽结局门槛', () => {
    const state = actState({
      currentActId: 'act-2',
      currentActIndex: 1,
      actHistory: [{ actId: 'act-1', enteredTurn: 0, exitedTurn: 3, exitSummary: '上一幕', carriedBeatIds: ['beat-1-2'] }],
      beats: [
        { beatId: 'beat-1-1', actId: 'act-1', status: 'satisfied', evidenceTurns: [1], updatedAtTurn: 1 },
        { beatId: 'beat-1-2', actId: 'act-1', status: 'reframed', currentPlan: '新路径', carriedFromActId: 'act-1', evidenceTurns: [3], updatedAtTurn: 3 },
        { beatId: 'beat-2-1', actId: 'act-2', status: 'satisfied', evidenceTurns: [5], updatedAtTurn: 5 },
      ],
    });
    const { state: next } = commitAct(state, {
      destiny: { reason: '收尾', completionEstimate: 100, endingReached: true },
    });
    assert.equal(next.destiny.endingReached, false, '挂账节 reframed 仍是未完成，结局门槛不放宽');
  });

  it('改道轨 gate 1：本幕无终态节或终态比例不足 50% 时拒绝并保持当前幕', () => {
    const noTerminal = commitAct(actState(), { destiny: { reason: 'x', actTransition: { proposeNextAct: true } } });
    assert.equal(noTerminal.state.destiny.currentActId, 'act-1');
    assert.ok(noTerminal.warnings.find((warning) => warning.code === 'act_transition_rejected'));

    const lowRatioState = actState({
      beats: [
        { beatId: 'beat-1-1', actId: 'act-1', status: 'satisfied', evidenceTurns: [3], updatedAtTurn: 3 },
        { beatId: 'beat-1-2', actId: 'act-1', status: 'reframed', currentPlan: '计划', evidenceTurns: [], updatedAtTurn: 3 },
        { beatId: 'beat-1-3', actId: 'act-1', status: 'reframed', currentPlan: '计划', evidenceTurns: [], updatedAtTurn: 3 },
        { beatId: 'beat-2-1', actId: 'act-2', status: 'pending', evidenceTurns: [], updatedAtTurn: 0 },
      ],
    });
    const lowRatio = commitAct(lowRatioState, { destiny: { reason: 'x', actTransition: { proposeNextAct: true } } });
    assert.equal(lowRatio.state.destiny.currentActId, 'act-1', '1/3 = 33% < 50%');
    assert.equal(lowRatio.state.destiny.currentActIndex, 0);
    assert.deepEqual(lowRatio.state.destiny.actHistory, []);
    const warning = lowRatio.warnings.find((item) => item.code === 'act_transition_rejected');
    assert.ok(warning?.message.includes('原生故事节 3 条'), '警告应包含具体条数');
    assert.ok(warning?.message.includes('终态 1 条'));
  });

  it('改道轨 gate 2：非终态节必须是 reframed/weakened 且写明 currentPlan', () => {
    const activeState = actState({
      beats: [
        { beatId: 'beat-1-1', actId: 'act-1', status: 'satisfied', evidenceTurns: [3], updatedAtTurn: 3 },
        { beatId: 'beat-1-2', actId: 'act-1', status: 'active', currentPlan: '计划', evidenceTurns: [], updatedAtTurn: 3 },
        { beatId: 'beat-2-1', actId: 'act-2', status: 'pending', evidenceTurns: [], updatedAtTurn: 0 },
      ],
    });
    const activeResult = commitAct(activeState, { destiny: { reason: 'x', actTransition: { proposeNextAct: true } } });
    assert.equal(activeResult.state.destiny.currentActId, 'act-1', 'active 节不能被挂账带走');
    assert.ok(activeResult.warnings.find((warning) => warning.code === 'act_transition_rejected')?.message.includes('不满足'));

    const noPlanState = actState({
      beats: [
        { beatId: 'beat-1-1', actId: 'act-1', status: 'satisfied', evidenceTurns: [3], updatedAtTurn: 3 },
        { beatId: 'beat-1-2', actId: 'act-1', status: 'reframed', evidenceTurns: [], updatedAtTurn: 3 },
        { beatId: 'beat-2-1', actId: 'act-2', status: 'pending', evidenceTurns: [], updatedAtTurn: 0 },
      ],
    });
    const noPlan = commitAct(noPlanState, { destiny: { reason: 'x', actTransition: { proposeNextAct: true } } });
    assert.equal(noPlan.state.destiny.currentActId, 'act-1', '没有 currentPlan 的 reframed 节不能被挂账');
    assert.ok(noPlan.warnings.find((warning) => warning.code === 'act_transition_rejected'));
  });

  it('改道轨 gate 3：非终态原生节超过 2 个时拒绝（防止整幕批发挂账）', () => {
    const state = actState({
      beats: [
        ...['beat-1-1', 'beat-1-2', 'beat-1-3'].map((beatId) => ({ beatId, actId: 'act-1', status: 'satisfied', evidenceTurns: [3], updatedAtTurn: 3 })),
        ...['beat-1-4', 'beat-1-5', 'beat-1-6'].map((beatId) => ({ beatId, actId: 'act-1', status: 'reframed', currentPlan: '计划', evidenceTurns: [], updatedAtTurn: 3 })),
        { beatId: 'beat-2-1', actId: 'act-2', status: 'pending', evidenceTurns: [], updatedAtTurn: 0 },
      ],
    });
    const { state: next, warnings } = commitAct(state, { destiny: { reason: 'x', actTransition: { proposeNextAct: true } } });
    assert.equal(next.destiny.currentActId, 'act-1', '3/6 终态比例达标，但非终态 3 条 > 2 条');
    assert.ok(warnings.find((warning) => warning.code === 'act_transition_rejected')?.message.includes('非终态 3 条'));
  });

  it('更早幕的挂账节不参与本幕终态比例，也不阻塞常规轨自动推进', () => {
    const state = actState({
      currentActId: 'act-2',
      currentActIndex: 1,
      beats: [
        { beatId: 'beat-1-1', actId: 'act-1', status: 'satisfied', evidenceTurns: [1], updatedAtTurn: 1 },
        { beatId: 'beat-1-2', actId: 'act-1', status: 'reframed', currentPlan: '旧计划', carriedFromActId: 'act-1', evidenceTurns: [3], updatedAtTurn: 3 },
        { beatId: 'beat-2-1', actId: 'act-2', status: 'satisfied', evidenceTurns: [5], updatedAtTurn: 5 },
        { beatId: 'beat-3-1', actId: 'act-3', status: 'pending', evidenceTurns: [], updatedAtTurn: 0 },
      ],
    });
    const { state: next, warnings } = commitAct(state, {
      destiny: { reason: 'x', actTransition: { proposeNextAct: true } },
    });
    // act-2 原生节只有 beat-2-1 且已终态 → 常规轨自动进 act-3；更早幕的挂账节既不阻塞也不被搬动。
    assert.equal(next.destiny.currentActId, 'act-3');
    assert.equal(next.destiny.currentActIndex, 2);
    assert.deepEqual(warnings, []);
    assert.equal(next.destiny.beats.find((beat) => beat.beatId === 'beat-1-2')?.status, 'reframed');
    assert.equal(next.destiny.beats.find((beat) => beat.beatId === 'beat-1-2')?.actId, 'act-1');
  });

  it('最后一幕提议切幕：没有可推导的下一幕时拒绝并警告', () => {
    const state = actState({ currentActId: 'act-2', currentActIndex: 1 });
    const { state: next, warnings } = commitAct(state, { destiny: { reason: 'x', actTransition: { proposeNextAct: true } } });
    assert.equal(next.destiny.currentActId, 'act-2');
    assert.ok(warnings.find((warning) => warning.code === 'act_transition_rejected')?.message.includes('最后一幕'));
  });

  it('actTransition 未明确提议或不是对象时不切幕', () => {
    const partialState = actState({
      beats: [
        { beatId: 'beat-1-1', actId: 'act-1', status: 'satisfied', evidenceTurns: [3], updatedAtTurn: 3 },
        { beatId: 'beat-1-2', actId: 'act-1', status: 'reframed', currentPlan: '计划', evidenceTurns: [], updatedAtTurn: 3 },
        { beatId: 'beat-2-1', actId: 'act-2', status: 'pending', evidenceTurns: [], updatedAtTurn: 0 },
      ],
    });
    const notProposed = commitAct(partialState, { destiny: { reason: 'x', actTransition: { proposeNextAct: false } } });
    assert.equal(notProposed.state.destiny.currentActId, 'act-1');
    assert.equal(notProposed.warnings.length, 0);

    const invalid = commitAct(partialState, { destiny: { reason: 'x', actTransition: 'yes' as never } });
    assert.equal(invalid.state.destiny.currentActId, 'act-1');
    assert.equal(invalid.warnings.length, 0);
  });

  it('连续两次切幕：enteredTurn 取上一条幕历史的 exitedTurn', () => {
    const state = actState({
      beats: [
        { beatId: 'beat-1-1', actId: 'act-1', status: 'satisfied', evidenceTurns: [2], updatedAtTurn: 2 },
        { beatId: 'beat-1-2', actId: 'act-1', status: 'satisfied', evidenceTurns: [2], updatedAtTurn: 2 },
        { beatId: 'beat-2-1', actId: 'act-2', status: 'available', evidenceTurns: [], updatedAtTurn: 0 },
        { beatId: 'beat-3-1', actId: 'act-3', status: 'pending', evidenceTurns: [], updatedAtTurn: 0 },
      ],
    });
    // 第一次：act-1 已全部终态 → 常规轨自动进 act-2。
    const first = commitAct(state, { destiny: { reason: 'x' } });
    assert.equal(first.state.destiny.currentActId, 'act-2');
    assert.deepEqual(first.state.destiny.actHistory.map((entry) => [entry.actId, entry.enteredTurn, entry.exitedTurn]), [
      ['act-1', 0, S],
    ]);

    // 模拟引擎在提交后推进回合号（patch.ts 本身的 turn 不变）。
    const secondState: GameStateV2 = { ...first.state, turn: 10 };
    const second = commitAct(secondState, {
      // 每回合 commitId 不同；相同 commitId 会命中幂等分支（不重复提交）。
      commitId: 'commit-test-2',
      destiny: { reason: 'x', beatChanges: [{ beatId: 'beat-2-1', status: 'satisfied', evidenceQuote: '证据' }] },
    });
    assert.equal(second.state.destiny.currentActId, 'act-3');
    assert.deepEqual(second.state.destiny.actHistory.map((entry) => [entry.actId, entry.enteredTurn, entry.exitedTurn]), [
      ['act-1', 0, S],
      ['act-2', S, 10],
    ]);
  });
});
