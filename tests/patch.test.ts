import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { commitTurnPatchV2 } from '@/v2/patch';
import { makePatch, makeState } from './helpers/fixtures';
import type { GameStateV2, TurnPatchV2 } from '@/v2/types';

/** 用统一夹具提交一个 Patch；baseRevision/turn 默认对齐 state。 */
function commit(stateOverrides: Record<string, unknown> = {}, patchOverrides: Record<string, unknown> = {}): GameStateV2 {
  const state = makeState(stateOverrides);
  return commitTurnPatchV2(state, makePatch({ baseRevision: state.revision, turn: state.turn, ...patchOverrides }));
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
    // discovered issue：合并分支用 Set 去重，但 create 新建分支只做 trim/filter/slice，
    // 重复别名会原样保留（期望：['二号','别名0',...]，实际保留了两个“二号”）。
    assert.deepEqual(created?.aliases.slice(0, 3), ['二号', '二号', '别名0']);
    assert.equal(created?.knownFacts.length, 12, '新建时 knownFacts 最多 12 条');
  });

  it('create 缺 name、非对象行会被安全跳过', () => {
    const next = commit({}, {
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

  it('grant 数量为 0 或负数时至少 +1（当前实现）', () => {
    assert.equal(commit({}, { inventory: [{ op: 'grant', id: 'item-1', quantity: 0, reason: 'x' }] }).inventory[0].quantity, 3);
    assert.equal(commit({}, { inventory: [{ op: 'grant', id: 'item-1', quantity: -5, reason: 'x' }] }).inventory[0].quantity, 3);
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
    // discovered issue：update 分支用 Set 去重，create 分支不去重（空串会被过滤）。
    assert.deepEqual(created?.involvedCharacterIds, ['char-a', 'char-a']);
    assert.equal(created?.updatedAtTurn, S);
  });

  it('op=create 但缺 title 时落入 update 分支（当前实现的行为）', () => {
    const next = commit({}, { threads: [{ op: 'create', id: 'thread-1', status: 'completed', reason: 'x' }] });
    assert.equal(next.storyThreads[0].status, 'completed');
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

  it('superseded 缺 replacementBeatId 时丢弃；存在时写入', () => {
    const dropped = commit({}, {
      destiny: { reason: 'x', beatChanges: [{ beatId: 'beat-1-1', status: 'superseded', evidenceQuote: '证据', reason: 'x' }] },
    });
    assert.equal(dropped.destiny.beats[0].status, 'available');

    const applied = commit({}, {
      destiny: {
        reason: 'x',
        beatChanges: [{ beatId: 'beat-1-1', status: 'superseded', replacementBeatId: 'beat-1-2', evidenceQuote: '证据', reason: 'x' }],
      },
    });
    assert.equal(applied.destiny.beats[0].status, 'superseded');
    assert.equal(applied.destiny.beats[0].replacementBeatId, 'beat-1-2');
  });

  it('replacementBeatId 指向不存在的故事节时仍会置为 superseded，但不写入该 id（引用完整性缺口）', () => {
    const next = commit({}, {
      destiny: {
        reason: 'x',
        beatChanges: [{ beatId: 'beat-1-1', status: 'superseded', replacementBeatId: 'beat-does-not-exist', evidenceQuote: '证据', reason: 'x' }],
      },
    });
    assert.equal(next.destiny.beats[0].status, 'superseded');
    assert.equal(next.destiny.beats[0].replacementBeatId, undefined);
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

  it('未到期时提交 handled=true 与 note 会被忽略（note 丢失）', () => {
    const next = commit({}, { randomEvent: { handled: true, note: '不该记录的备注' } });
    assert.equal(next.randomEvent.lastTriggeredTurn, undefined);
    assert.equal(next.randomEvent.lastNote, undefined);
    assert.equal(next.randomEvent.pending, false);
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
