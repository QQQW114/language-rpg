import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStageAndActWindow,
  clipWindowText,
  DYNAMIC_WORLD_FACT_LIMIT,
  MAX_BEATS_THIS_TURN,
  normalizeBeatsThisTurn,
  splitWorldFacts,
  STABLE_WORLD_FACT_LIMIT,
  STAGE_ACT_WINDOW_LIMIT,
} from '@/v2/actWindow';
import type { StoryOutline, WorldBookEntry } from '@/types/content';
import type { DestinyProgressV2, StoryBeatRuntimeV2 } from '@/v2/types';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function worldFact(overrides: Partial<WorldBookEntry> & { id: string }): WorldBookEntry {
  return { name: overrides.id, keywords: [], content: `${overrides.id} 的正文`, ...overrides } as WorldBookEntry;
}

function runtimeBeat(
  beatId: string,
  actId: string,
  status: StoryBeatRuntimeV2['status'],
  extra: Partial<StoryBeatRuntimeV2> = {},
): StoryBeatRuntimeV2 {
  return { beatId, actId, status, evidenceTurns: [], updatedAtTurn: 0, ...extra };
}

/** 五幕大纲：用于验证「上一幕只读 / 当前幕施工 / 下一幕只埋伏笔 / 更远幕只列标题」。 */
const FIVE_ACT_OUTLINE: StoryOutline = {
  id: 'outline-five',
  title: '五幕测试',
  synopsis: '最终在旧车站道别。',
  tone: '冷静',
  acts: [
    {
      id: 'act-1',
      title: '第一幕·雨夜',
      purpose: '建立日常',
      beats: [
        { id: 'beat-1-1', title: '开场', purpose: '建立主角的日常状态' },
        { id: 'beat-1-2', title: '异变', purpose: '打破日常' },
      ],
    },
    {
      id: 'act-2',
      title: '第二幕·逃离',
      purpose: '推进冲突',
      entryBrief: '离开熟悉的街区',
      stageContract: '只写逃离的第一夜',
      exitCriteriaNote: '抵达外省',
      beats: [{ id: 'beat-2-1', title: '决断', purpose: '主角决定离开' }],
    },
    {
      id: 'act-3',
      title: '第三幕·扎根',
      purpose: '在新城市立足',
      entryBrief: '外省旧城在雨季显得陌生',
      stageContract: '允许展开新生活，禁止提前写穿身世真相',
      exitCriteriaNote: '第一次主动争取',
      beats: [
        { id: 'beat-3-1', title: '落脚', purpose: '找到能待下去的地方' },
        { id: 'beat-3-2', title: '试探', purpose: '试探新环境的态度' },
        { id: 'beat-3-3', title: '裂缝', purpose: '发现旧生活仍在追来' },
      ],
    },
    {
      id: 'act-4',
      title: '第四幕·回望',
      purpose: '必须回头面对旧关系',
      beats: [{ id: 'beat-4-1', title: '回望', purpose: '旧人重新出现' }],
    },
    {
      id: 'act-5',
      title: '第五幕·道别',
      purpose: '在旧车站完成最终告别',
      beats: [{ id: 'beat-5-1', title: '道别', purpose: '完成最终告别' }],
    },
  ],
};

/** 处于第三幕第 1 回合的权威命运状态：前两幕已有 exitSummary，一个节从第二幕挂账进来。 */
function thirdActDestiny(overrides: Partial<DestinyProgressV2> = {}): DestinyProgressV2 {
  return {
    completionEstimate: 46,
    completionReason: '仍在第三幕',
    currentActId: 'act-3',
    currentActIndex: 2,
    currentStage: '第三幕',
    currentPath: '改道离城',
    nextMilestone: '在旧车站与阿黎道别',
    convergencePlan: '让旧关系在车站自然汇合',
    beats: [
      runtimeBeat('beat-1-1', 'act-1', 'satisfied', { evidenceTurns: [2], updatedAtTurn: 2 }),
      runtimeBeat('beat-1-2', 'act-1', 'satisfied', { evidenceTurns: [5], updatedAtTurn: 5 }),
      // 挂账节：actId 保持原属幕（不可变），只额外写 carriedFromActId。
      runtimeBeat('beat-2-1', 'act-2', 'reframed', {
        currentPlan: '改道离开城市', carriedFromActId: 'act-2', evidenceTurns: [8], updatedAtTurn: 8,
      }),
      runtimeBeat('beat-3-1', 'act-3', 'available'),
      runtimeBeat('beat-3-2', 'act-3', 'active', { currentPlan: '先从房东试探' }),
      runtimeBeat('beat-3-3', 'act-3', 'pending'),
      runtimeBeat('beat-4-1', 'act-4', 'pending'),
    ],
    actHistory: [
      { actId: 'act-1', enteredTurn: 0, exitedTurn: 5, exitSummary: '第一幕在雨夜争执里收束' },
      { actId: 'act-2', enteredTurn: 5, exitedTurn: 8, exitSummary: '第二幕改道离城' },
    ],
    lastActTransitionTurn: 8,
    endingReached: false,
    updatedAtTurn: 9,
    ...overrides,
  };
}

const thirdActWindow = () => buildStageAndActWindow({
  outline: FIVE_ACT_OUTLINE,
  destiny: thirdActDestiny(),
  turn: 9,
});

// ---------------------------------------------------------------------------
// splitWorldFacts（D5）
// ---------------------------------------------------------------------------

describe('actWindow.splitWorldFacts', () => {
  it('常驻条目进稳定块、关键词命中条目进动态块，两块互不混入', () => {
    const worldFacts = [
      worldFact({ id: 'wf-static', content: '常年阴雨。', alwaysActive: true, priority: 1 }),
      worldFact({ id: 'wf-hit', keywords: ['门廊'], content: '门廊下有个修表铺。', priority: 9 }),
      worldFact({ id: 'wf-miss', keywords: ['终局'], content: '第三幕才揭示的真相。', priority: 99 }),
    ];
    const split = splitWorldFacts({ input: '我走到门廊下面躲雨。', history: [], worldFacts });
    assert.deepEqual(split.alwaysActive.map((fact) => fact.id), ['wf-static'], '稳定块只放常驻条目');
    assert.deepEqual(split.dynamic.map((fact) => fact.id), ['wf-hit'], '动态块只放关键词命中的非驻留条目');
    assert.equal(split.matchedCount, 1);
    assert.equal(split.totalCount, 3);
    assert.equal(split.truncatedStatic, false);
    assert.equal(split.truncatedDynamic, false);
  });

  it('动态条目的关键词命中最近 6 条历史：更早历史命中不算（与规划近期窗口同源）', () => {
    const worldFacts = [worldFact({ id: 'wf-late', keywords: ['门廊'], content: '门廊线索' })];
    const oldOnly = Array.from({ length: 7 }, (_, index) => ({
      content: index === 0 ? '很早就提过门廊' : `第 ${index} 条无关正文`,
    }));
    // 7 条时 slice(-6) 丢掉第 0 条 → 不应命中。
    assert.deepEqual(splitWorldFacts({ input: '继续走。', history: oldOnly, worldFacts }).dynamic, []);
    // 第 1 条落在最近 6 条里 → 命中。
    const recent = oldOnly.map((message, index) => ({ content: index === 1 ? '最近提过门廊' : message.content }));
    assert.deepEqual(splitWorldFacts({ input: '继续走。', history: recent, worldFacts }).dynamic.map((fact) => fact.id), ['wf-late']);
  });

  it('按 priority 降序、同级保持原序', () => {
    const worldFacts = [
      worldFact({ id: 'wf-low', alwaysActive: true, priority: 1 }),
      worldFact({ id: 'wf-high-a', alwaysActive: true, priority: 9 }),
      worldFact({ id: 'wf-high-b', alwaysActive: true, priority: 9 }),
      worldFact({ id: 'wf-zero', alwaysActive: true }),
    ];
    const split = splitWorldFacts({ input: '', history: [], worldFacts });
    assert.deepEqual(split.alwaysActive.map((fact) => fact.id), ['wf-high-a', 'wf-high-b', 'wf-low', 'wf-zero']);
  });

  it(`常驻上限 ${STABLE_WORLD_FACT_LIMIT} 条、动态上限 ${DYNAMIC_WORLD_FACT_LIMIT} 条，并标记截断`, () => {
    const statics = Array.from({ length: 25 }, (_, index) => worldFact({ id: `wf-s${index}`, alwaysActive: true, priority: index }));
    const dynamics = Array.from({ length: 12 }, (_, index) => worldFact({
      id: `wf-d${index}`, keywords: ['门廊'], content: `动态${index}`, priority: index,
    }));
    const split = splitWorldFacts({ input: '门廊', history: [], worldFacts: [...statics, ...dynamics] });
    assert.equal(split.alwaysActive.length, 20);
    assert.equal(split.alwaysActive[0].id, 'wf-s24', '最高优先级先进');
    assert.equal(split.alwaysActive.some((fact) => fact.id === 'wf-s0'), false, '最低优先级被截断');
    assert.equal(split.dynamic.length, 10);
    assert.deepEqual(split.dynamic.map((fact) => fact.id), Array.from({ length: 10 }, (_, index) => `wf-d${11 - index}`));
    assert.equal(split.truncatedStatic, true);
    assert.equal(split.truncatedDynamic, true);
    assert.equal(split.matchedCount, 12);
    assert.equal(split.totalCount, 37);
  });

  it('空/缺字段/坏数据不抛错：非数组世界书、缺 keywords 的条目', () => {
    assert.deepEqual(splitWorldFacts({ input: '', history: [], worldFacts: undefined }), {
      alwaysActive: [], dynamic: [], truncatedStatic: false, truncatedDynamic: false, matchedCount: 0, totalCount: 0,
    });
    const broken = [{ id: 'wf-broken', name: '坏条目', content: '没有 keywords 与 alwaysActive' } as WorldBookEntry];
    const split = splitWorldFacts({ input: '任意输入', history: [], worldFacts: broken });
    assert.deepEqual(split.alwaysActive, []);
    assert.deepEqual(split.dynamic, []);
    assert.equal(split.totalCount, 1);
  });
});

// ---------------------------------------------------------------------------
// normalizeBeatsThisTurn（D8）
// ---------------------------------------------------------------------------

describe('actWindow.normalizeBeatsThisTurn（推进权限决定节拍数量）', () => {
  it('strict 最多保留 1 条', () => {
    const beats = normalizeBeatsThisTurn(['一', '二', '三', '四'], 'strict');
    assert.deepEqual(beats, ['一']);
    assert.equal(beats.length, 1);
  });

  it('standard 最多保留 2 条', () => {
    const beats = normalizeBeatsThisTurn(['一', '二', '三', '四'], 'standard');
    assert.deepEqual(beats, ['一', '二']);
    assert.equal(beats.length, 2);
  });

  it('free 最多保留 3 条（MAX_BEATS_THIS_TURN）', () => {
    assert.deepEqual(normalizeBeatsThisTurn(['一', '二', '三', '四'], 'free'), ['一', '二', '三']);
    assert.equal(normalizeBeatsThisTurn(['一', '二', '三', '四'], 'free').length, MAX_BEATS_THIS_TURN);
  });

  it('叙事速度不再参与裁剪：slow + standard 仍按推进权限保留 2 条', () => {
    assert.deepEqual(normalizeBeatsThisTurn(['敲响门', '门内有人回应', '对方开门'], 'standard'), ['敲响门', '门内有人回应']);
  });

  it('trim + 去空 + 过滤非字符串脏值', () => {
    const beats = normalizeBeatsThisTurn(['  敲响门  ', '', '   ', null, 42, { text: '对象' }, ['数组'], '门内有人回应'], 'standard');
    assert.deepEqual(beats, ['敲响门', '门内有人回应']);
  });

  it('非数组输入返回空数组', () => {
    for (const raw of [undefined, null, '一句话', 42, {}, true]) {
      assert.deepEqual(normalizeBeatsThisTurn(raw, 'standard'), [], `输入 ${String(raw)} 应返回空数组`);
    }
  });
});

// ---------------------------------------------------------------------------
// buildStageAndActWindow（D4）
// ---------------------------------------------------------------------------

describe('actWindow.buildStageAndActWindow', () => {
  it('完整窗口：命运进度、阶段状态、上一幕 exitSummary、当前幕契约、挂账节、下一幕、远端幕标题、命运锚、红线', () => {
    const text = thirdActWindow();
    assert.ok(text.startsWith('【STAGE_AND_ACT_WINDOW】'), `窗口应以标题行开头，实际：${text.slice(0, 30)}`);
    assert.ok(text.includes('- 命运进度：第 3 / 5 幕《第三幕·扎根》'), text.slice(0, 240));
    assert.ok(text.includes('本幕故事节：0/3 已达成'), '当前幕 3 个原生节都未终态');
    assert.ok(text.includes('1 个跨幕挂账'), '挂账数应体现在命运进度行');
    // 切幕发生在第 8 回合提交时，第 9 回合就是新幕第 1 回合。
    assert.ok(text.includes('新幕开启（进入本幕第 1 回合）'), '切幕后第一回合应标记新幕开启');
    assert.ok(text.includes('[上一幕复盘 · 只读因果基线]'));
    assert.ok(text.includes('《第二幕·逃离》（已收束）：第二幕改道离城'), '上一幕应给出程序写入的 exitSummary');
    assert.ok(text.includes('[当前幕施工契约 · 核心展开区]'));
    assert.ok(text.includes('- 核心作用：在新城市立足'));
    assert.ok(text.includes('- 阶段契约：允许展开新生活，禁止提前写穿身世真相'));
    assert.ok(text.includes('- 开幕引子：外省旧城在雨季显得陌生'));
    assert.ok(text.includes('- 幕完成标志：第一次主动争取'));
    assert.ok(text.includes('- 本幕待推进故事节：'));
    assert.ok(text.includes('  * [available] beat-3-1（落脚）：找到能待下去的地方'));
    assert.ok(text.includes('  * [active] beat-3-2（试探）：试探新环境的态度；当前计划：先从房东试探'));
    assert.ok(text.includes('  * [pending] beat-3-3（裂缝）：发现旧生活仍在追来'));
    assert.ok(!text.includes('beat-1-1'), '已终态/其他幕的故事节不应出现在本幕待推进清单');
    assert.ok(text.includes('- 跨幕挂账节：'));
    assert.ok(text.includes('  * [reframed] beat-2-1（决断）：主角决定离开；原属《第二幕·逃离》'), '挂账节应标出原属幕');
    assert.ok(text.includes('[下一幕远景引子 · 仅允许埋伏笔，严禁提前兑现]'));
    assert.ok(text.includes('- 下一幕《第四幕·回望》：必须回头面对旧关系'));
    assert.ok(text.includes('- 后续未展开阶段：第5幕《第五幕·道别》'), '更远幕只列标题');
    assert.ok(!text.includes('在旧车站完成最终告别'), '更远幕不得展开 purpose');
    assert.ok(text.includes('[最终命运锚]'));
    assert.ok(text.includes('- 在旧车站与阿黎道别'));
    assert.ok(text.includes('[阶段红线]'));
    assert.ok(text.includes('1. 本幕尚有 3 个未完成故事节'), '红线应按本幕未完成节数动态生成');
    assert.ok(text.includes('2. 只推进【beatsThisTurn】列出的 1~3 个节拍'));
    assert.ok(text.includes('5. 【下一幕】核心事件不得提前兑现'));
    assert.ok(text.length <= STAGE_ACT_WINDOW_LIMIT, `窗口总长应 ≤ ${STAGE_ACT_WINDOW_LIMIT}，实际 ${text.length}`);
  });

  it('预算降级：超长字段与大量故事节时总长仍 ≤ 900，且红线与当前幕信息不丢', () => {
    const long = '这是一段用来把窗口撑爆的超长文本。'.repeat(30);
    const acts = Array.from({ length: 8 }, (_, index) => ({
      id: `act-${index + 1}`,
      title: `${index + 1}：${long.slice(0, 120)}`,
      purpose: long,
      entryBrief: long,
      stageContract: long,
      exitCriteriaNote: long,
      beats: Array.from({ length: 8 }, (_, beatIndex) => ({
        id: `beat-${index + 1}-${beatIndex + 1}`, title: long.slice(0, 80), purpose: long,
      })),
    }));
    const hugeOutline: StoryOutline = { ...FIVE_ACT_OUTLINE, acts, synopsis: long };
    const destiny: DestinyProgressV2 = thirdActDestiny({
      currentActId: 'act-3',
      currentActIndex: 2,
      nextMilestone: long,
      convergencePlan: long,
      beats: Array.from({ length: 8 }, (_, index) => runtimeBeat(`beat-3-${index + 1}`, 'act-3', 'pending', { currentPlan: long })),
      actHistory: [
        { actId: 'act-1', enteredTurn: 0, exitedTurn: 5, exitSummary: long },
        { actId: 'act-2', enteredTurn: 5, exitedTurn: 8, exitSummary: long },
      ],
    });
    const text = buildStageAndActWindow({ outline: hugeOutline, destiny, turn: 9 });
    assert.ok(text.length <= STAGE_ACT_WINDOW_LIMIT, `超预算时必须降级到 ≤ ${STAGE_ACT_WINDOW_LIMIT}，实际 ${text.length}`);
    assert.ok(text.startsWith('【STAGE_AND_ACT_WINDOW】'));
    assert.ok(text.includes('- 命运进度：第 3 / 8 幕'));
    assert.ok(text.includes('[当前幕施工契约 · 核心展开区]'), '当前幕契约优先于远景保留');
    assert.ok(text.includes('- 本幕待推进故事节：'));
    assert.ok(text.includes('[阶段红线]'), '红线属于硬约束，降级时必须保留');
    assert.ok(text.includes('5. 【下一幕】核心事件不得提前兑现'));
    assert.ok(text.includes('…'), '超长文本应带省略号');
  });

  it('字段缺失时整段省略：不输出空标签', () => {
    // 没有大纲：整个窗口为空，engine 不会输出标题行。
    assert.equal(buildStageAndActWindow({ outline: undefined, destiny: thirdActDestiny(), turn: 9 }), '');
    assert.equal(buildStageAndActWindow({ outline: { acts: [], synopsis: '' }, destiny: thirdActDestiny(), turn: 9 }), '');

    const minimalOutline: StoryOutline = {
      id: 'outline-min', title: '极简', synopsis: '', acts: FIVE_ACT_OUTLINE.acts.map((act) => ({
        id: act.id, title: act.title, purpose: act.purpose, beats: act.beats,
      })),
    };
    const minimal = buildStageAndActWindow({
      outline: minimalOutline,
      destiny: thirdActDestiny({ nextMilestone: '', convergencePlan: '', actHistory: [], lastActTransitionTurn: undefined }),
      turn: 2,
    });
    assert.ok(minimal.includes('【STAGE_AND_ACT_WINDOW】'));
    // 旧档没有幕历史：上一幕复盘退回大纲 purpose，而不是整段消失（仍有可读的因果基线）。
    assert.ok(minimal.includes('《第二幕·逃离》（已收束）：推进冲突'));
    assert.ok(!minimal.includes('- 阶段契约：'));
    assert.ok(!minimal.includes('- 开幕引子：'));
    assert.ok(!minimal.includes('- 幕完成标志：'));
    assert.ok(!minimal.includes('[最终命运锚]'), '三处锚点都缺失时整段省略');
    assert.ok(minimal.includes('- 后续未展开阶段：第5幕《第五幕·道别》'), '更远的幕只列标题');

    // 第一幕且没有幕历史：没有上一幕可复盘，整段省略。
    const openingAct = buildStageAndActWindow({
      outline: minimalOutline,
      destiny: thirdActDestiny({
        currentActId: 'act-1', currentActIndex: 0, currentStage: '', nextMilestone: '', convergencePlan: '', actHistory: [],
        lastActTransitionTurn: undefined,
        beats: [runtimeBeat('beat-1-1', 'act-1', 'active')],
      }),
      turn: 2,
    });
    assert.ok(openingAct.includes('- 命运进度：第 1 / 5 幕'));
    assert.ok(!openingAct.includes('[上一幕复盘'), '第一幕没有上一幕，整段省略');
    assert.ok(openingAct.includes('运行中（进入本幕第 3 回合）'), '第一幕没有切幕记录，按开局回合推算');

    // 最后一幕：没有下一幕可展望。
    const lastAct = buildStageAndActWindow({
      outline: minimalOutline,
      destiny: thirdActDestiny({ currentActId: 'act-5', currentActIndex: 4, currentStage: '', nextMilestone: '', convergencePlan: '', actHistory: [] }),
      turn: 3,
    });
    assert.ok(lastAct.includes('- 命运进度：第 5 / 5 幕'));
    assert.ok(!lastAct.includes('[下一幕远景引子'));
    assert.ok(!lastAct.includes('[最终命运锚]'));
  });

  it('超长单字段被截断并加省略号', () => {
    const longContract = '阶段契约'.repeat(80);
    const outline: StoryOutline = {
      ...FIVE_ACT_OUTLINE,
      acts: FIVE_ACT_OUTLINE.acts.map((act) => (
        act.id === 'act-3' ? { ...act, stageContract: longContract } : act
      )),
    };
    const text = buildStageAndActWindow({ outline, destiny: thirdActDestiny(), turn: 9 });
    assert.ok(!text.includes(longContract), '原文不应完整出现');
    const line = text.split('\n').find((item) => item.startsWith('- 阶段契约：'));
    assert.ok(line, '应仍输出阶段契约行');
    assert.ok(line!.endsWith('…'), `截断应以省略号结尾，实际：${line}`);
  });

  it('本幕原生终态节不计入待推进；终态数写进命运进度', () => {
    const destiny = thirdActDestiny({
      beats: [
        runtimeBeat('beat-3-1', 'act-3', 'satisfied', { evidenceTurns: [9] }),
        runtimeBeat('beat-3-2', 'act-3', 'superseded', { replacementBeatId: 'beat-3-1', evidenceTurns: [9] }),
        runtimeBeat('beat-3-3', 'act-3', 'active', { currentPlan: '追查旧生活' }),
      ],
      actHistory: [{ actId: 'act-2', enteredTurn: 5, exitedTurn: 8, exitSummary: '第二幕改道离城' }],
    });
    const text = buildStageAndActWindow({ outline: FIVE_ACT_OUTLINE, destiny, turn: 9 });
    assert.ok(text.includes('本幕故事节：2/3 已达成'));
    assert.ok(text.includes('[阶段红线]'));
    assert.ok(text.includes('1. 本幕尚有 1 个未完成故事节'));
    assert.ok(!text.includes('（落脚）'), '已 satisfied 的故事节不再列入待推进');
    assert.ok(text.includes('  * [active] beat-3-3（裂缝）'));
  });

  it('本幕原生节全部终态时红线 1 改成「不得自行宣告进入下一幕」', () => {
    const destiny = thirdActDestiny({
      beats: [runtimeBeat('beat-3-1', 'act-3', 'satisfied', { evidenceTurns: [9] })],
      actHistory: [{ actId: 'act-2', enteredTurn: 5, exitedTurn: 8, exitSummary: '第二幕改道离城' }],
    });
    const text = buildStageAndActWindow({ outline: FIVE_ACT_OUTLINE, destiny, turn: 9 });
    assert.ok(text.includes('本幕故事节：1/1 已达成'));
    assert.ok(text.includes('1. 本幕原生故事节已全部达成，正文不得自行宣告进入下一幕'));
    assert.ok(!text.includes('- 本幕待推进故事节：'));
  });

  it('旧存档没有运行时故事节时退回大纲展示本幕 pending 节拍', () => {
    const text = buildStageAndActWindow({
      outline: FIVE_ACT_OUTLINE,
      destiny: thirdActDestiny({ beats: [], actHistory: [] }),
      turn: 2,
    });
    assert.ok(text.includes('- 本幕待推进故事节：'));
    assert.ok(text.includes('  * [pending] beat-3-1（落脚）'));
    assert.ok(text.includes('本幕故事节：0/3 已达成'));
  });

  it('同幕不同回合：阶段状态从新幕变成运行中；切幕后内容随之变化', () => {
    const firstTurn = buildStageAndActWindow({ outline: FIVE_ACT_OUTLINE, destiny: thirdActDestiny(), turn: 9 });
    const secondTurn = buildStageAndActWindow({ outline: FIVE_ACT_OUTLINE, destiny: thirdActDestiny(), turn: 10 });
    assert.ok(firstTurn.includes('新幕开启（进入本幕第 1 回合）'));
    assert.ok(secondTurn.includes('运行中（进入本幕第 2 回合）'));
    assert.notEqual(firstTurn, secondTurn);

    const act2 = buildStageAndActWindow({
      outline: FIVE_ACT_OUTLINE,
      destiny: thirdActDestiny({
        currentActId: 'act-2',
        currentActIndex: 1,
        lastActTransitionTurn: 5,
        actHistory: [{ actId: 'act-1', enteredTurn: 0, exitedTurn: 5, exitSummary: '第一幕在雨夜争执里收束' }],
      }),
      turn: 6,
    });
    assert.ok(act2.includes('- 命运进度：第 2 / 5 幕《第二幕·逃离》'));
    assert.ok(act2.includes('《第一幕·雨夜》（已收束）：第一幕在雨夜争执里收束'));
    assert.ok(!act2.includes('允许展开新生活'), '下一幕只给标题与 purpose，不得提前给出施工契约');
  });
});

describe('actWindow.clipWindowText', () => {
  it('压成单行并截断到指定长度（结果长度恰为上限）', () => {
    assert.equal(clipWindowText('  a\n b  ', 10), 'a b');
    assert.equal(clipWindowText('abcdef', 4), 'abc…');
    assert.equal(clipWindowText('abcdef', 6), 'abcdef');
    assert.equal(clipWindowText('abcdef', 1), '…');
    assert.equal(clipWindowText('abcdef', 0), '');
    assert.equal(clipWindowText(undefined, 5), '');
  });
});
