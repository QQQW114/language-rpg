import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PACE_CLOSURE_RULES,
  PACE_CLOSURE_TAIL,
  PACE_CORRECTION_HEADER,
  PACE_CORRECTION_LIMIT,
  PACE_LENGTH_LIMIT,
  PACE_TIME_JUMP_LIMIT,
  PACE_TIME_JUMP_THRESHOLD,
  PACE_TIME_JUMP_WORDS,
  analyzePace,
  buildPaceCorrectionAlert,
  countPaceTimeJumps,
  detectPaceClosure,
} from '@/v2/paceGuard';
import type { PacingAuditV2 } from '@/v2/types';
import type { PaceClosureRule } from '@/v2/paceGuard';

// 常用填充：不含时间推进词、也不含收束模式，用来精确控制篇幅。
const PAD = '雨';

function padStory(length: number): string {
  return PAD.repeat(length);
}

// ---------------------------------------------------------------------------
// A. 基础审计
// ---------------------------------------------------------------------------

describe('paceGuard.analyzePace — 基础口径', () => {
  it('干净正文：length 正确、各项均为 false、needsCorrection=false', () => {
    const story = '雨夜的街口很安静。阿黎压低声音，说出了一个地名。';
    const audit = analyzePace({ story, pace: 'standard' });
    assert.deepEqual(audit, {
      length: story.length,
      timeJumpCount: 0,
      closureDetected: false,
      overBudget: false,
      needsCorrection: false,
    });
  });

  it('空正文/异常输入安全退化，不抛错', () => {
    for (const story of ['', undefined as unknown as string, null as unknown as string]) {
      const audit = analyzePace({ story, pace: 'slow' });
      assert.equal(audit.length, 0);
      assert.equal(audit.timeJumpCount, 0);
      assert.equal(audit.closureDetected, false);
      assert.equal(audit.overBudget, false);
      assert.equal(audit.needsCorrection, false);
    }
  });

  it('只做观察：不修改传入正文（长度与内容都保持原样）', () => {
    const story = padStory(PACE_LENGTH_LIMIT + 10);
    const before = story.slice();
    const audit = analyzePace({ story, pace: 'standard' });
    assert.equal(story, before);
    assert.equal(audit.length, before.length);
  });
});

// ---------------------------------------------------------------------------
// B. 时间推进词
// ---------------------------------------------------------------------------

describe('paceGuard — 时间推进词计数', () => {
  it('词表覆盖 29 回合评估口径的关键词', () => {
    for (const word of ['第二天', '次日', '翌日', '三天后', '一周后', '几天过去', '转眼', '不知不觉', '晚上']) {
      assert.ok(PACE_TIME_JUMP_WORDS.includes(word), `词表应包含「${word}」`);
    }
  });

  it('按出现次数计数，并封顶 PACE_TIME_JUMP_LIMIT（5）', () => {
    const story = '第二天，次日，翌日，第三天，隔天，三天后，一周后，转眼，不知不觉，晚上，深夜。';
    assert.equal(countPaceTimeJumps(story), PACE_TIME_JUMP_LIMIT, '超过 5 个也只记 5 个');
  });

  it('单次出现的时点词（晚上）不会触发纠偏', () => {
    const story = '她把热汤推过来，说外面风大。晚上，雨还是没有停。';
    assert.equal(countPaceTimeJumps(story), 1);
    assert.equal(analyzePace({ story, pace: 'standard' }).needsCorrection, false);
  });

  it('阈值：2 个时间推进词不触发，3 个触发', () => {
    const two = '第二天，我们去上学。三天后，放假了。';
    assert.equal(countPaceTimeJumps(two), 2);
    const twoAudit = analyzePace({ story: two, pace: 'standard' });
    assert.equal(twoAudit.needsCorrection, false, '2 个推进词仍在容忍范围内');
    assert.equal(twoAudit.closureDetected, false);

    const three = `${two}转眼就到了冬天。`;
    assert.equal(countPaceTimeJumps(three), 3);
    const threeAudit = analyzePace({ story: three, pace: 'standard' });
    assert.equal(threeAudit.timeJumpCount, PACE_TIME_JUMP_THRESHOLD);
    assert.equal(threeAudit.needsCorrection, true, '3 个推进词即视为单轮时间跨度过大');
    assert.equal(threeAudit.closureDetected, false, '该用例只由时间跨度触发，不是收尾误判');
  });

  it('普通叙述里的模糊词（后来/过了会儿）不计入，避免误报', () => {
    assert.equal(countPaceTimeJumps('后来，他过了会儿才回来。'), 0);
  });

  it('引号内台词里的时间词不计数（角色说“明天中午见”不是叙事跳跃）', () => {
    const story = '沈童把表推过来：“明天中午来，下午撤得早。”他应了一声：「晚上给你答复。」';
    assert.equal(countPaceTimeJumps(story), 0);
  });

  it('带日期指向的时段词（明天中午/后天晚上/上周）按计划或回忆处理，不计数', () => {
    const story = '明天中午要交表，后天晚上还得去核对；上周借的裤子也该还了。';
    assert.equal(countPaceTimeJumps(story), 0);
  });

  it('真正的叙事跨日仍然计数（第二天早上→下午→晚上）', () => {
    const story = '第二天早上，他出了门。到了下午，雨还没停。晚上，他才回来。';
    assert.equal(countPaceTimeJumps(story), 3);
    assert.equal(analyzePace({ story, pace: 'standard' }).needsCorrection, true);
  });

  it('真实长局的误报样本：T4/T12 这类“对话密集提到时间”不应触发纠偏', () => {
    const t4 = '“我下午不回楼里，直接去上课。”  “晚上总有回的时候吧？”  “实验课，拖堂说不准。”曦雨说，“衣服我下午自己去洗衣房收。”';
    assert.equal(countPaceTimeJumps(t4), 0);
    const t13 = '早上她抱着书站在桌边，目光顺着裤脚滑下去。明天中午还要去阶梯教室。后天晚上再说吧。';
    assert.ok(countPaceTimeJumps(t13) < PACE_TIME_JUMP_THRESHOLD, '计划/回忆里的时段词不应凑满阈值');
  });
});

// ---------------------------------------------------------------------------
// C. 五类升华/收束模式
// ---------------------------------------------------------------------------

describe('paceGuard — 升华/收束模式', () => {
  it('五类规则齐全且带中文标签', () => {
    assert.deepEqual(
      PACE_CLOSURE_RULES.map((rule) => rule.kind),
      ['theme_elevation', 'summary_assertion', 'time_jump_closure', 'suspense_preview', 'chapter_close'],
    );
    for (const rule of PACE_CLOSURE_RULES) {
      assert.ok(rule.label.length > 0);
      assert.equal(rule.pattern.global, false, '收尾检测正则不应带 g 标志（避免 lastIndex 状态）');
    }
  });

  const positives: Array<[PaceClosureRule['kind'], string]> = [
    ['theme_elevation', '这个影子的形状不属于曦宇。它属于曦雨，而且从今天开始，它有了同伴。'],
    ['theme_elevation', '这才是真正的答案。'],
    ['summary_assertion', '于是，这一场闹剧总算是告一段落。'],
    ['summary_assertion', '所有的事情都尘埃落定，再也回不去了。'],
    ['time_jump_closure', '多年以后，他还会想起这个雨夜。'],
    ['time_jump_closure', '不知不觉中，一天就过去了。'],
    ['suspense_preview', '而这一切，仅仅是开始。'],
    ['suspense_preview', '未来会怎样，谁也说不清。'],
    ['chapter_close', '这一夜就此结束。'],
    ['chapter_close', '这个夏天，画上了句号。'],
  ];
  for (const [kind, story] of positives) {
    it(`正例命中 ${kind}：${story.slice(0, 16)}…`, () => {
      const kinds = detectPaceClosure(story);
      assert.ok(kinds.includes(kind), `应命中 ${kind}，实际：${kinds.join('、')}`);
      assert.equal(analyzePace({ story, pace: 'standard' }).closureDetected, true);
    });
  }

  it('日常叙述与对白不误报（对白内的"升华"台词不算旁白收尾）', () => {
    const everyday = [
      '她把热汤推过来，说：“趁热喝，晚上风大。”他应了一声，低头吃面。',
      '“从今天开始，我们就是朋友了。”她笑着说。',
      '“这就是你说的那个地方？”他问。',
      '他说明天再来，让她先回去。',
      '雨还在下，街上的灯一盏接一盏亮起来。',
      '“未来会怎样，谁也说不清。”她耸耸肩。',
    ];
    for (const story of everyday) {
      assert.deepEqual(detectPaceClosure(story), [], `不应误报：${story}`);
      assert.equal(analyzePace({ story, pace: 'standard' }).closureDetected, false);
    }
  });

  it('只看末尾 220 字：收尾句出现在正文前部时不判定', () => {
    const story = `从今天开始，它有了同伴。${padStory(PACE_CLOSURE_TAIL + 20)}`;
    assert.deepEqual(detectPaceClosure(story), [], '尾部 220 字才是检测窗口');
  });

  it('收尾检测与叙事速度无关：快叙事里的升华收尾同样记录', () => {
    const story = '多年以后，他还会想起这个雨夜。';
    assert.equal(analyzePace({ story, pace: 'fast' }).closureDetected, true);
    assert.equal(analyzePace({ story, pace: 'timeskip' }).closureDetected, true);
  });
});

// ---------------------------------------------------------------------------
// D. 篇幅预算
// ---------------------------------------------------------------------------

describe('paceGuard — 篇幅预算', () => {
  it('慢/标准叙事超过 5000 字即 overBudget；恰好 5000 不算', () => {
    assert.equal(analyzePace({ story: padStory(PACE_LENGTH_LIMIT), pace: 'standard' }).overBudget, false);
    assert.equal(analyzePace({ story: padStory(PACE_LENGTH_LIMIT + 1), pace: 'standard' }).overBudget, true);
    assert.equal(analyzePace({ story: padStory(PACE_LENGTH_LIMIT + 1), pace: 'slow' }).overBudget, true);
  });

  it('快叙事/时间跨越不判定篇幅（本来就允许概括多日）', () => {
    const long = padStory(PACE_LENGTH_LIMIT + 2000);
    for (const pace of ['fast', 'timeskip'] as const) {
      const audit = analyzePace({ story: long, pace });
      assert.equal(audit.overBudget, false, `${pace} 不应判定篇幅越界`);
      assert.equal(audit.needsCorrection, false);
    }
  });

  it('overBudget 单独即可触发 needsCorrection', () => {
    const audit = analyzePace({ story: padStory(PACE_LENGTH_LIMIT + 1), pace: 'standard' });
    assert.equal(audit.closureDetected, false);
    assert.equal(audit.timeJumpCount, 0);
    assert.equal(audit.needsCorrection, true);
  });
});

// ---------------------------------------------------------------------------
// E. 纠偏文本
// ---------------------------------------------------------------------------

describe('paceGuard.buildPaceCorrectionAlert — 软纠偏文本', () => {
  it('越界组合：长度 ≤220、含标题与三项硬要求、说明上轮篇幅', () => {
    const story = `${padStory(PACE_LENGTH_LIMIT + 800)}从今天开始，它有了同伴。`;
    const audit = analyzePace({ story, pace: 'standard' });
    assert.equal(audit.overBudget, true);
    assert.equal(audit.closureDetected, true);
    const alert = buildPaceCorrectionAlert(audit);
    assert.ok(alert.length <= PACE_CORRECTION_LIMIT, `纠偏文本应 ≤${PACE_CORRECTION_LIMIT} 字，实际 ${alert.length}`);
    assert.ok(alert.startsWith(PACE_CORRECTION_HEADER), alert);
    assert.ok(alert.includes('上轮越界纠偏'), '应标注这是一次「上轮越界纠偏」');
    assert.ok(alert.includes(`正文 ${story.length} 字`), '应说明上轮篇幅');
    assert.ok(alert.includes('篇幅超预算'));
    assert.ok(alert.includes('升华/收束'));
    assert.ok(alert.includes('只推进 1 个节拍'), '要求本轮只推 1 个节拍');
    assert.ok(alert.includes('立即停笔'), '要求到点立即停笔');
    assert.ok(alert.includes('不得点题升华'), '禁止点题升华');
  });

  it('时间跨度越界：说明推进词数量', () => {
    const audit = analyzePace({ story: '第二天，三天后，转眼就到了。', pace: 'slow' });
    assert.equal(audit.needsCorrection, true);
    const alert = buildPaceCorrectionAlert(audit);
    assert.ok(alert.includes('时间推进词 3 个'), alert);
  });

  it('极端数值也不会撑破 220 字上限', () => {
    const audit: PacingAuditV2 = {
      length: 987654321,
      timeJumpCount: PACE_TIME_JUMP_LIMIT,
      closureDetected: true,
      overBudget: true,
      needsCorrection: true,
    };
    const alert = buildPaceCorrectionAlert(audit);
    assert.ok(alert.length <= PACE_CORRECTION_LIMIT, `实际 ${alert.length} 字`);
    assert.ok(alert.includes('只推进 1 个节拍'));
  });
});
