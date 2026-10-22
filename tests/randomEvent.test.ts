import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CO_AUTHOR_RANDOM_EVENT_COOLDOWN_MAX,
  CO_AUTHOR_RANDOM_EVENT_COOLDOWN_MIN,
  RANDOM_EVENT_CONTEXT_LIMIT,
  RANDOM_EVENT_HISTORY_LIMIT,
  RANDOM_EVENT_RECONVERGENCE_ID,
  buildRandomEventContextBlock,
  buildRandomEventInstruction,
  isCoAuthorAutonomy,
  isRandomEventDue,
  listRandomEventTargets,
  pickRandomEventIntensity,
  pushRandomEventHistory,
  randomEventCooldownRange,
  randomEventCooldownTurns,
  readRandomEventBinding,
  validateRandomEventBinding,
} from '@/v2/randomEvents';
import type {
  DestinyProgressV2,
  GameStateV2,
  RandomEventHistoryItemV2,
  RandomEventStateV2,
  StoryBeatRuntimeV2,
} from '@/v2/types';
import { makeState } from './helpers/fixtures';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function makeHistoryItem(overrides: Partial<RandomEventHistoryItemV2> = {}): RandomEventHistoryItemV2 {
  return {
    id: 'rev-1',
    turn: 3,
    intensity: 'related',
    targetKind: 'beat',
    targetId: 'beat-1-1',
    summary: '一次雨夜偶遇',
    status: 'resolved',
    ...overrides,
  };
}

function makeDestiny(overrides: Partial<DestinyProgressV2> = {}): DestinyProgressV2 {
  const base = makeState().destiny;
  return { ...base, beats: base.beats.map((beat) => ({ ...beat })), ...overrides };
}

function makeBeat(overrides: Partial<StoryBeatRuntimeV2> = {}): StoryBeatRuntimeV2 {
  return {
    beatId: 'beat-1-1',
    actId: 'act-1',
    status: 'available',
    evidenceTurns: [],
    updatedAtTurn: 0,
    ...overrides,
  };
}

function makeRandomEvent(overrides: Partial<RandomEventStateV2> = {}): RandomEventStateV2 {
  const base = makeState().randomEvent;
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// A. 滚动历史
// ---------------------------------------------------------------------------

describe('randomEvents.pushRandomEventHistory — 滚动上限 8 与 ongoing_hook 优先', () => {
  it('追加条目并保持事件时间顺序（旧→新）', () => {
    const first = makeHistoryItem({ id: 'rev-1' });
    const result = pushRandomEventHistory([first], makeHistoryItem({ id: 'rev-2', turn: 4 }));
    assert.deepEqual(result.map((item) => item.id), ['rev-1', 'rev-2']);
  });

  it('旧存档没有 history 字段时按空数组处理', () => {
    const result = pushRandomEventHistory(undefined, makeHistoryItem({ id: 'rev-only' }));
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'rev-only');
  });

  it(`没有 ongoing_hook 时只保留最新 ${RANDOM_EVENT_HISTORY_LIMIT} 条`, () => {
    const history = Array.from({ length: 10 }, (_, index) => makeHistoryItem({ id: `rev-${index}`, turn: index }));
    const result = pushRandomEventHistory(history, makeHistoryItem({ id: 'rev-new', turn: 10 }));
    assert.equal(result.length, RANDOM_EVENT_HISTORY_LIMIT);
    assert.deepEqual(result.map((item) => item.id), ['rev-3', 'rev-4', 'rev-5', 'rev-6', 'rev-7', 'rev-8', 'rev-9', 'rev-new']);
  });

  it('超限时优先保留最近的 3 条 ongoing_hook（即使它们比较旧）', () => {
    const history: RandomEventHistoryItemV2[] = [
      makeHistoryItem({ id: 'hook-1', turn: 1, status: 'ongoing_hook' }),
      makeHistoryItem({ id: 'hook-2', turn: 2, status: 'ongoing_hook' }),
      makeHistoryItem({ id: 'hook-3', turn: 3, status: 'ongoing_hook' }),
      makeHistoryItem({ id: 'hook-4', turn: 4, status: 'ongoing_hook' }),
      ...Array.from({ length: 7 }, (_, index) => makeHistoryItem({ id: `resolved-${index}`, turn: 10 + index })),
    ];
    const result = pushRandomEventHistory(history, makeHistoryItem({ id: 'resolved-new', turn: 30 }));
    assert.equal(result.length, RANDOM_EVENT_HISTORY_LIMIT);
    const ids = result.map((item) => item.id);
    // 只保留最近的 3 条钩子（hook-4 / hook-3 / hook-2），最新的事件也不能丢。
    assert.deepEqual(ids.filter((id) => id.startsWith('hook')), ['hook-2', 'hook-3', 'hook-4']);
    assert.ok(ids.includes('resolved-new'));
    assert.ok(ids.includes('resolved-6'), `最新的 resolved 应保留，实际：${ids.join(',')}`);
    assert.ok(!ids.includes('resolved-0'));
    // 返回顺序仍是事件发生顺序。
    assert.deepEqual([...ids].sort(), ids, '历史应保持时间顺序');
  });

  it('ongoing_hook 超过上限 3 条时只保留最近 3 条', () => {
    const history: RandomEventHistoryItemV2[] = [
      ...Array.from({ length: 5 }, (_, index) => makeHistoryItem({
        id: `hook-${index}`, turn: index, status: 'ongoing_hook',
      })),
      ...Array.from({ length: 5 }, (_, index) => makeHistoryItem({
        id: `resolved-${index}`, turn: 10 + index,
      })),
    ];
    const result = pushRandomEventHistory(history, makeHistoryItem({ id: 'rev-new', turn: 20 }));
    assert.equal(result.length, RANDOM_EVENT_HISTORY_LIMIT);
    assert.deepEqual(result.map((item) => item.id), [
      'hook-2', 'hook-3', 'hook-4',
      'resolved-1', 'resolved-2', 'resolved-3', 'resolved-4', 'rev-new',
    ]);
  });
});

// ---------------------------------------------------------------------------
// B. 智能强度
// ---------------------------------------------------------------------------

describe('randomEvents.pickRandomEventIntensity — 三分支与优先级', () => {
  it('存在 reframed 故事节 → destiny', () => {
    const intensity = pickRandomEventIntensity({
      destiny: makeDestiny({ beats: [makeBeat({ status: 'reframed', currentPlan: '换一种实现' })] }),
      randomEvent: makeRandomEvent(),
      turn: 10,
    });
    assert.equal(intensity, 'destiny');
  });

  it('存在跨幕挂账（carriedFromActId 非空且非终态）→ destiny', () => {
    const intensity = pickRandomEventIntensity({
      destiny: makeDestiny({
        beats: [makeBeat({ status: 'weakened', carriedFromActId: 'act-0', updatedAtTurn: 9 })],
      }),
      randomEvent: makeRandomEvent(),
      turn: 10,
    });
    assert.equal(intensity, 'destiny');
  });

  it('已终态的挂账节不算"未兑现"，不触发 destiny', () => {
    const intensity = pickRandomEventIntensity({
      destiny: makeDestiny({
        beats: [makeBeat({ status: 'satisfied', carriedFromActId: 'act-0', updatedAtTurn: 10 })],
      }),
      randomEvent: makeRandomEvent(),
      turn: 10,
    });
    assert.equal(intensity, 'related');
  });

  it('reframed 优先于"刚切幕"（两条分支同时满足时取 destiny）', () => {
    const intensity = pickRandomEventIntensity({
      destiny: makeDestiny({
        lastActTransitionTurn: 9,
        beats: [makeBeat({ status: 'reframed', currentPlan: '新路径', updatedAtTurn: 9 })],
      }),
      randomEvent: makeRandomEvent(),
      turn: 10,
    });
    assert.equal(intensity, 'destiny');
  });

  it('刚切幕后 ≤2 回合 → progress', () => {
    const justTransitioned = pickRandomEventIntensity({
      destiny: makeDestiny({ lastActTransitionTurn: 8, beats: [makeBeat({ status: 'available', updatedAtTurn: 8 })] }),
      randomEvent: makeRandomEvent(),
      turn: 10,
    });
    assert.equal(justTransitioned, 'progress', 'turn - lastActTransitionTurn = 2');

    const nextTurn = pickRandomEventIntensity({
      destiny: makeDestiny({ lastActTransitionTurn: 9, beats: [] }),
      randomEvent: makeRandomEvent(),
      turn: 10,
    });
    assert.equal(nextTurn, 'progress');

    const longAfter = pickRandomEventIntensity({
      destiny: makeDestiny({ lastActTransitionTurn: 7, beats: [] }),
      randomEvent: makeRandomEvent(),
      turn: 10,
    });
    assert.equal(longAfter, 'related', '切幕后第 3 回合起不再算"刚切幕"');
  });

  it('某个 active 故事节超过 5 回合未更新 → progress', () => {
    const stale = pickRandomEventIntensity({
      destiny: makeDestiny({
        beats: [makeBeat({ status: 'active', updatedAtTurn: 4 })],
      }),
      randomEvent: makeRandomEvent(),
      turn: 10,
    });
    assert.equal(stale, 'progress', 'turn - updatedAtTurn = 6 > 5');

    const exactlyFive = pickRandomEventIntensity({
      destiny: makeDestiny({ beats: [makeBeat({ status: 'active', updatedAtTurn: 5 })] }),
      randomEvent: makeRandomEvent(),
      turn: 10,
    });
    assert.equal(exactlyFive, 'related', '恰好 5 回合未更新不升级');

    const nonActiveStale = pickRandomEventIntensity({
      destiny: makeDestiny({ beats: [makeBeat({ status: 'available', updatedAtTurn: 0 })] }),
      randomEvent: makeRandomEvent(),
      turn: 10,
    });
    assert.equal(nonActiveStale, 'related', '只有 active 故事节会触发停滞升级');
  });

  it('常态 → related；事件关闭时也回落到 related', () => {
    assert.equal(
      pickRandomEventIntensity({ destiny: makeDestiny(), randomEvent: makeRandomEvent(), turn: 10 }),
      'related',
    );
    assert.equal(
      pickRandomEventIntensity({ destiny: makeDestiny(), randomEvent: makeRandomEvent({ enabled: false }), turn: 10 }),
      'related',
    );
  });
});

// ---------------------------------------------------------------------------
// C. 候选绑定目标
// ---------------------------------------------------------------------------

describe('randomEvents.listRandomEventTargets — 候选目标', () => {
  it('故事节：只列非终态，active/available 排前，终态节不出现', () => {
    const state = makeState({
      destiny: {
        ...makeState().destiny,
        beats: [
          makeBeat({ beatId: 'beat-pending', status: 'pending', updatedAtTurn: 1 }),
          makeBeat({ beatId: 'beat-satisfied', status: 'satisfied', updatedAtTurn: 2 }),
          makeBeat({ beatId: 'beat-active', status: 'active', updatedAtTurn: 3 }),
          makeBeat({ beatId: 'beat-available', status: 'available', updatedAtTurn: 4 }),
        ],
      },
    });
    const targets = listRandomEventTargets({ destiny: state.destiny, state });
    const beatIds = targets.filter((target) => target.targetKind === 'beat').map((target) => target.targetId);
    assert.deepEqual(beatIds, ['beat-active', 'beat-available', 'beat-pending']);
    assert.ok(!beatIds.includes('beat-satisfied'));
  });

  it('线程：只列 active 线程；关系：按 |好感| 降序且最多 3 条', () => {
    const state = makeState({
      storyThreads: [
        { id: 'thread-active', title: '寻找兄长', kind: 'main', status: 'active', involvedCharacterIds: [], updatedAtTurn: 3 },
        { id: 'thread-done', title: '旧任务', kind: 'quest', status: 'completed', involvedCharacterIds: [], updatedAtTurn: 2 },
      ] as GameStateV2['storyThreads'],
      relationships: [
        { id: 'rel-a', fromId: 'player', toId: 'char-a', affinity: 10, updatedAtTurn: 4 },
        { id: 'rel-b', fromId: 'player', toId: 'char-b', affinity: -40, updatedAtTurn: 2 },
        { id: 'rel-c', fromId: 'player', toId: 'char-c', affinity: 5, updatedAtTurn: 5 },
        { id: 'rel-d', fromId: 'player', toId: 'char-d', affinity: 90, updatedAtTurn: 1 },
      ] as GameStateV2['relationships'],
    });
    const targets = listRandomEventTargets({ destiny: state.destiny, state });
    assert.deepEqual(targets.filter((target) => target.targetKind === 'thread').map((target) => target.targetId), ['thread-active']);
    assert.deepEqual(
      targets.filter((target) => target.targetKind === 'relationship').map((target) => target.targetId),
      ['rel-d', 'rel-b', 'rel-a'],
      '按 |好感| 降序：90、40、10；好感 5 被截断',
    );
  });

  it('ongoing_hook 作为可回收候选出现，并带原绑定目标', () => {
    const state = makeState({
      randomEvent: makeRandomEvent({
        history: [
          makeHistoryItem({ id: 'rev-hook', status: 'ongoing_hook', targetKind: 'thread', targetId: 'thread-1', summary: '线人的下落' }),
          makeHistoryItem({ id: 'rev-old', status: 'resolved' }),
        ],
      }),
    });
    const targets = listRandomEventTargets({ destiny: state.destiny, state });
    const hook = targets.find((target) => target.source === 'ongoing_hook');
    assert.ok(hook, '应包含 ongoing_hook 候选');
    assert.equal(hook?.targetKind, 'thread');
    assert.equal(hook?.targetId, 'thread-1');
    assert.equal(hook?.hookEventId, 'rev-hook');
    assert.ok(hook?.label.includes('线人的下落'));
    assert.ok(!targets.some((target) => target.source === 'ongoing_hook' && target.hookEventId === 'rev-old'), 'resolved 历史不是钩子');
  });

  it('收束锚固定为 reconvergence:destiny_main，且永远存在', () => {
    const empty = makeState({ destiny: { ...makeState().destiny, beats: [] }, storyThreads: [], relationships: [], characters: [] });
    const targets = listRandomEventTargets({ destiny: empty.destiny, state: empty });
    const anchor = targets[targets.length - 1];
    assert.equal(anchor.targetKind, 'reconvergence');
    assert.equal(anchor.targetId, RANDOM_EVENT_RECONVERGENCE_ID);
  });
});

// ---------------------------------------------------------------------------
// D. 绑定校验
// ---------------------------------------------------------------------------

describe('randomEvents.validateRandomEventBinding — 合法性校验', () => {
  const state = makeState();
  const targets = listRandomEventTargets({ destiny: state.destiny, state });

  it('合法绑定返回规范化结果（trim + 摘要截断）', () => {
    const result = validateRandomEventBinding({
      targetKind: 'beat',
      targetId: '  beat-1-1  ',
      summary: `  ${'长'.repeat(100)}  `,
    }, targets);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.binding.targetKind, 'beat');
    assert.equal(result.binding.targetId, 'beat-1-1');
    assert.equal(result.binding.summary.length, 80);
  });

  it('未知 targetKind → 不合法并说明白名单', () => {
    const result = validateRandomEventBinding({ targetKind: 'character', targetId: 'char-a', summary: 'x' }, targets);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.reason.includes('targetKind'));
    assert.ok(result.reason.includes('beat|thread|relationship|reconvergence'));
  });

  it('targetId 不在候选内 → 不合法并指出目标类型', () => {
    const missing = validateRandomEventBinding({ targetKind: 'beat', targetId: 'beat-404', summary: 'x' }, targets);
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.ok(missing.reason.includes('beat-404'));

    // 类型对但 id 属于别的类型（用 beat id 绑 thread）也必须被拒。
    const wrongKind = validateRandomEventBinding({ targetKind: 'thread', targetId: 'beat-1-1', summary: 'x' }, targets);
    assert.equal(wrongKind.ok, false);
  });

  it('缺少 summary / targetId 或输入不是对象 → 不合法', () => {
    const noSummary = validateRandomEventBinding({ targetKind: 'beat', targetId: 'beat-1-1', summary: '   ' }, targets);
    assert.equal(noSummary.ok, false);
    if (!noSummary.ok) assert.ok(noSummary.reason.includes('summary'));

    const noId = validateRandomEventBinding({ targetKind: 'beat', summary: 'x' }, targets);
    assert.equal(noId.ok, false);

    for (const raw of [undefined, null, 'text', 42, []]) {
      assert.equal(validateRandomEventBinding(raw, targets).ok, false, `输入 ${String(raw)} 应被拒绝`);
    }
  });
});

// ---------------------------------------------------------------------------
// E. 上下文块与三档指令
// ---------------------------------------------------------------------------

describe('randomEvents.buildRandomEventContextBlock — 紧凑上下文', () => {
  it('包含档位、待兑现绑定、最近历史与候选目标，且总长 ≤400', () => {
    const state = makeState({
      randomEvent: makeRandomEvent({
        pending: true,
        intensity: 'progress',
        activeBinding: {
          targetKind: 'beat',
          targetId: 'beat-1-1',
          summary: '让阿黎在雨夜交出旧信',
          plannedAtTurn: 7,
        },
        history: [
          makeHistoryItem({ id: 'rev-old', turn: 2, status: 'resolved' }),
          makeHistoryItem({ id: 'rev-hook', turn: 4, status: 'ongoing_hook', summary: '线人的下落还没兑现' }),
        ],
      }),
    });
    const targets = listRandomEventTargets({ destiny: state.destiny, state });
    const block = buildRandomEventContextBlock({ randomEvent: state.randomEvent, targets, history: state.randomEvent.history });
    assert.ok(block.startsWith('【RANDOM_EVENT_CONTEXT】'));
    assert.ok(block.length <= RANDOM_EVENT_CONTEXT_LIMIT, `实际长度 ${block.length}`);
    assert.ok(block.includes('progress'));
    assert.ok(block.includes('待兑现绑定：beat:beat-1-1'));
    assert.ok(block.includes('rev-old'));
    assert.ok(block.includes('rev-hook'));
    assert.ok(block.includes('resolved'));
    assert.ok(block.includes('ongoing_hook'));
    assert.ok(block.includes(`reconvergence：${RANDOM_EVENT_RECONVERGENCE_ID}`) || block.includes(RANDOM_EVENT_RECONVERGENCE_ID));
    assert.ok(block.includes('beat：'));
    assert.ok(block.includes('可回收旧钩子'));
  });

  it('海量候选与超长历史被截断到 400 字以内', () => {
    const state = makeState({
      destiny: {
        ...makeState().destiny,
        beats: Array.from({ length: 10 }, (_, index) => makeBeat({
          beatId: `beat-${index}`, status: 'active', updatedAtTurn: index,
        })),
      },
      storyThreads: Array.from({ length: 6 }, (_, index) => ({
        id: `thread-${index}`, title: '寻找兄长', kind: 'main', status: 'active', involvedCharacterIds: [], updatedAtTurn: 1,
      })) as GameStateV2['storyThreads'],
      relationships: Array.from({ length: 6 }, (_, index) => ({
        id: `rel-${index}`, fromId: 'player', toId: `char-${index}`, affinity: 10 + index, updatedAtTurn: 1,
      })) as GameStateV2['relationships'],
      characters: Array.from({ length: 6 }, (_, index) => ({
        id: `char-${index}`, name: `角色${index}号`, aliases: [], status: 'active', knownFacts: [], firstSeenTurn: 0, lastSeenTurn: 1,
      })) as GameStateV2['characters'],
    });
    const randomEvent = makeRandomEvent({
      history: Array.from({ length: 12 }, (_, index) => makeHistoryItem({
        id: `rev-${index}`, turn: index, summary: '很长的摘要'.repeat(6), outcomeNote: '很长的结果说明'.repeat(4),
      })),
    });
    const targets = listRandomEventTargets({ destiny: state.destiny, state });
    const block = buildRandomEventContextBlock({ randomEvent, targets, history: randomEvent.history });
    assert.ok(block.length <= RANDOM_EVENT_CONTEXT_LIMIT, `实际长度 ${block.length}`);
    assert.ok(block.endsWith('…'), '截断时应补省略号');
  });
});

describe('randomEvents.buildRandomEventInstruction — 三档绑定要求', () => {
  const state = makeState();
  const targets = listRandomEventTargets({ destiny: state.destiny, state });

  for (const intensity of ['related', 'progress', 'destiny'] as const) {
    it(`${intensity} 档要求 targetKind/targetId/summary 绑定并禁止无绑定事件`, () => {
      const instruction = buildRandomEventInstruction({ intensity, targets, history: [] });
      assert.ok(instruction.includes(`随机事件 · ${intensity}档`), instruction);
      assert.ok(instruction.includes('targetKind'));
      assert.ok(instruction.includes('targetId'));
      assert.ok(instruction.includes('summary'));
      assert.ok(instruction.includes('【绑定要求】'));
      assert.ok(instruction.includes('严禁无绑定的路人事件'));
      assert.ok(instruction.includes('【三态结算】'));
      assert.ok(instruction.includes('ongoing_hook'));
    });
  }

  it('三档的目标描述不同（命运档要求推进最终命运锚）', () => {
    const related = buildRandomEventInstruction({ intensity: 'related', targets, history: [] });
    const progress = buildRandomEventInstruction({ intensity: 'progress', targets, history: [] });
    const destiny = buildRandomEventInstruction({ intensity: 'destiny', targets, history: [] });
    assert.notEqual(related, progress);
    assert.notEqual(progress, destiny);
    assert.ok(progress.includes('推进绑定目标'));
    assert.ok(destiny.includes(RANDOM_EVENT_RECONVERGENCE_ID));
  });

  it('历史里有 ongoing_hook 时给出可回收钩子提示', () => {
    const instruction = buildRandomEventInstruction({
      intensity: 'related',
      targets,
      history: [
        makeHistoryItem({ id: 'rev-hook', status: 'ongoing_hook', targetKind: 'thread', targetId: 'thread-1' }),
        makeHistoryItem({ id: 'rev-done', status: 'resolved' }),
      ],
    });
    assert.ok(instruction.includes('可优先回收的旧钩子'));
    assert.ok(instruction.includes('rev-hook'));
    assert.ok(!instruction.includes('rev-done（'));
  });

  it('未知强度按 related 处理（防御脏输入）', () => {
    const fallback = buildRandomEventInstruction({ intensity: 'nonsense' as never, targets, history: [] });
    assert.ok(fallback.includes('related档'));
  });
});

// ---------------------------------------------------------------------------
// F. 绑定读取（旧档/手改档容错）
// ---------------------------------------------------------------------------

describe('randomEvents.readRandomEventBinding — 规范化读取', () => {
  it('合法绑定保留字段并补齐 plannedAtTurn', () => {
    assert.deepEqual(
      readRandomEventBinding({ targetKind: 'thread', targetId: 'thread-1', summary: '跟进线索', plannedAtTurn: 4 }),
      { targetKind: 'thread', targetId: 'thread-1', summary: '跟进线索', plannedAtTurn: 4 },
    );
  });

  it('非法/缺字段返回 undefined', () => {
    for (const raw of [undefined, null, 'x', [], {}, { targetKind: 'beat' }, { targetKind: 'nope', targetId: 'x' }]) {
      assert.equal(readRandomEventBinding(raw), undefined, `输入 ${JSON.stringify(raw)} 应返回 undefined`);
    }
  });
});

// ---------------------------------------------------------------------------
// G. 灵魂共创（co_author）调度：冷却 3~5 与跳过许可（T9）
// ---------------------------------------------------------------------------

describe('randomEvents — co_author 冷却区间与到期判定', () => {
  it('co_author 默认冷却收敛到 3~5（存档默认 3~6 也不会超 5）', () => {
    assert.deepEqual(
      randomEventCooldownRange({ autonomy: 'co_author', triggerIntervalMin: 3, triggerIntervalMax: 6 }),
      { min: CO_AUTHOR_RANDOM_EVENT_COOLDOWN_MIN, max: CO_AUTHOR_RANDOM_EVENT_COOLDOWN_MAX },
    );
    // 缺省字段时用 co_author 自己的默认区间。
    assert.deepEqual(randomEventCooldownRange({ autonomy: 'co_author' }), { min: 3, max: 5 });
  });

  it('co_author 把过小/过大的存档区间夹进 3~5', () => {
    assert.deepEqual(randomEventCooldownRange({ autonomy: 'co_author', triggerIntervalMin: 1, triggerIntervalMax: 2 }), { min: 3, max: 3 });
    assert.deepEqual(randomEventCooldownRange({ autonomy: 'co_author', triggerIntervalMin: 2, triggerIntervalMax: 4 }), { min: 3, max: 4 });
    assert.deepEqual(randomEventCooldownRange({ autonomy: 'co_author', triggerIntervalMin: 6, triggerIntervalMax: 10 }), { min: 5, max: 5 });
  });

  it('standard/free/strict/旧档（undefined）保持原区间，行为不变', () => {
    for (const autonomy of ['standard', 'free', 'strict', undefined] as const) {
      assert.deepEqual(
        randomEventCooldownRange({ autonomy, triggerIntervalMin: 1, triggerIntervalMax: 2 }),
        { min: 1, max: 2 },
        `${String(autonomy)} 不应被收紧`,
      );
      assert.deepEqual(randomEventCooldownRange({ autonomy, triggerIntervalMin: 3, triggerIntervalMax: 6 }), { min: 3, max: 6 });
    }
    assert.deepEqual(randomEventCooldownRange({ triggerIntervalMin: 4, triggerIntervalMax: 4 }), { min: 4, max: 4 });
    assert.deepEqual(randomEventCooldownRange({}), { min: 3, max: 6 }, '缺省区间仍是旧的 3~6');
  });

  it('冷却回合在区间内取值，min=max 时确定，rng 可注入', () => {
    assert.equal(randomEventCooldownTurns({ min: 3, max: 3 }), 3);
    assert.equal(randomEventCooldownTurns({ min: 3, max: 5 }, () => 0), 3);
    assert.equal(randomEventCooldownTurns({ min: 3, max: 5 }, () => 0.999999), 5);
    for (let i = 0; i < 20; i += 1) {
      const turns = randomEventCooldownTurns({ min: 3, max: 5 });
      assert.ok(turns >= 3 && turns <= 5, `冷却回合应落在 3~5，实际 ${turns}`);
    }
  });

  it('isCoAuthorAutonomy 只认 co_author', () => {
    assert.equal(isCoAuthorAutonomy('co_author'), true);
    for (const autonomy of ['standard', 'free', 'strict', undefined] as const) {
      assert.equal(isCoAuthorAutonomy(autonomy), false);
    }
  });

  it('isRandomEventDue 与 patch 调度同口径：pending 或到达 nextTriggerTurn', () => {
    const base = makeRandomEvent({ enabled: true, nextTriggerTurn: 10, pending: false });
    assert.equal(isRandomEventDue(base, 9), false);
    assert.equal(isRandomEventDue(base, 10), true);
    assert.equal(isRandomEventDue({ ...base, pending: true }, 3), true, 'pending 优先，不受 nextTriggerTurn 限制');
    assert.equal(isRandomEventDue({ ...base, enabled: false }, 99), false);
    assert.equal(isRandomEventDue(undefined, 99), false);
  });
});

describe('randomEvents — co_author 指令与上下文（情境催化剂）', () => {
  const state = makeState();
  const targets = listRandomEventTargets({ destiny: state.destiny, state });

  it('co_author planner 指令：禁跨场景补 beat、可主动跳过、不强制绑定 beat', () => {
    const instruction = buildRandomEventInstruction({
      intensity: 'related',
      targets,
      history: [],
      autonomy: 'co_author',
      phase: 'planner_pre',
    });
    assert.ok(instruction.includes('灵魂共创·情境催化剂'));
    assert.ok(instruction.includes('空投跨场景事件'), '必须明确禁止空投跨场景事件');
    assert.ok(instruction.includes('pending 故事节'), '点名"为 pending 故事节补事件"这一失败模式');
    assert.ok(instruction.includes('优先绑定 relationship/thread/旧钩子'), '允许绑定关系/线程/旧钩子');
    assert.ok(instruction.includes('不强制绑定 beat'));
    assert.ok(instruction.includes('可主动跳过'));
    assert.ok(instruction.includes('randomEvent.planned=false'));
    assert.ok(instruction.includes('跳过不扣任何进度'));
    assert.ok(instruction.includes(`${CO_AUTHOR_RANDOM_EVENT_COOLDOWN_MIN}~${CO_AUTHOR_RANDOM_EVENT_COOLDOWN_MAX} 回合`), '跳过后的顺延区间要写在指令里');
  });

  it('co_author story 指令只看到禁跨场景约束，不看到"可跳过"', () => {
    const instruction = buildRandomEventInstruction({
      intensity: 'related',
      targets,
      history: [],
      autonomy: 'co_author',
      phase: 'story',
    });
    assert.ok(instruction.includes('灵魂共创·情境催化剂'));
    assert.ok(instruction.includes('空投跨场景事件'), '故事模型仍需知道不能跨场景硬写事件');
    assert.ok(!instruction.includes('可主动跳过'), 'story 不参与跳过决策（只按 planned 计划写正文）');
    assert.ok(!instruction.includes('planned=false'));
  });

  it('standard/free 指令不带 co_author 约束（旧行为不变）', () => {
    for (const autonomy of ['standard', 'free', 'strict', undefined] as const) {
      const instruction = buildRandomEventInstruction({ intensity: 'related', targets, history: [], autonomy });
      assert.ok(!instruction.includes('情境催化剂'), `${String(autonomy)} 不应带 co_author 文案`);
      assert.ok(!instruction.includes('可主动跳过'));
      assert.ok(instruction.includes('【绑定要求】'), '原有绑定要求仍保留');
    }
  });

  it('co_author 上下文标注冷却与可跳过；standard 不加这行', () => {
    const randomEvent = makeRandomEvent({ intensity: 'progress', nextTriggerTurn: 3 });
    const coAuthorContext = buildRandomEventContextBlock({ randomEvent, targets, history: [], autonomy: 'co_author' });
    assert.ok(coAuthorContext.includes('灵魂共创·情境催化剂'));
    assert.ok(coAuthorContext.includes('冷却 3~5 回合'));
    assert.ok(coAuthorContext.includes('planned=false 跳过'));
    assert.ok(coAuthorContext.length <= RANDOM_EVENT_CONTEXT_LIMIT);

    const standardContext = buildRandomEventContextBlock({ randomEvent, targets, history: [], autonomy: 'standard' });
    assert.ok(!standardContext.includes('情境催化剂'));
    assert.ok(standardContext.length <= RANDOM_EVENT_CONTEXT_LIMIT);
  });
});
