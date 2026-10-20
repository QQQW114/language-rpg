/**
 * 程序侧节奏守卫（D8）：篇幅 / 单轮时间跨度 / 升华式收尾的确定性检测，以及下一轮的软纠偏文本。
 *
 * 背景（`docs/multiround-generation-evaluation.md` 的 29 回合实测）：故事模型经常在一轮里
 * 写完一整天甚至一整段弧线，然后顺手给一个"点题升华"式收尾；最长的那一档（6,000 字以上）
 * 升华收尾比例 14%。这个症状不适合靠"把生成切碎"解决，也不适合让 planner_post 再写一份
 * 自审（D8/D9：它已占 57% 输出，协议只加 ID/枚举/布尔）。因此：
 *
 *   1. **程序侧确定性检测**：字数、时间推进词、尾 220 字的收束模式，全部可离线单测；
 *   2. **只观察、不改正文**：审计结果写进 `TurnRecordV2.pacing` 留档，正文一个字都不动；
 *   3. **下一轮软纠偏**：上一轮越界时，下一轮 planner_pre 与 story 的提示词注入
 *      `【PACE_CORRECTION_ALERT】`，要求只推进 1 个节拍、到点停笔、禁止点题升华。
 *
 * 误报控制（宁可漏报，不做剧情警察）：
 * - 收尾模式只看正文**末尾 220 字**，且先剔除成对引号内的角色对白——升华/收束是叙述行为，
 *   角色说"从今天开始我们就是朋友了"不算旁白收尾；
 * - 时间推进词计数上限 5、阈值 3：一句日常里的"晚上"不会触发；
 * - 篇幅只对慢/标准叙事判定；快叙事/时间跨越本来就允许概括多日，不做长度判定。
 *
 * 这里不读写全局状态、不 import engine（与 `actWindow.ts` / `randomEvents.ts` 同样的纯函数边界）。
 */
import type { NarrativePaceV2, PacingAuditV2 } from './types';

export interface AnalyzePaceInputV2 {
  /** 本回合最终提交的正文。 */
  story: string;
  /** 本回合的叙事速度；只影响篇幅预算是否参与判定。 */
  pace: NarrativePaceV2;
}

// ---------------------------------------------------------------------------
// 阈值（导出常量便于测试与后续调参）
// ---------------------------------------------------------------------------

/** 慢/标准叙事的单回合篇幅上限：超过即视为「一轮写太多」。 */
export const PACE_LENGTH_LIMIT = 5000;
/** 收尾/升华检测只看正文末尾多少字（与 29 回合评估口径一致）。 */
export const PACE_CLOSURE_TAIL = 220;
/** 时间推进词计数上限：再长的一轮也只记 5 个。 */
export const PACE_TIME_JUMP_LIMIT = 5;
/** 时间推进词达到该数量即视为单轮时间跨度过大。 */
export const PACE_TIME_JUMP_THRESHOLD = 3;
/** 纠偏文本长度上限（字符）。 */
export const PACE_CORRECTION_LIMIT = 220;
/** 纠偏块标题（engine 注入位置由它标识）。 */
export const PACE_CORRECTION_HEADER = '【PACE_CORRECTION_ALERT】';
/** 需要做篇幅判定的叙事速度：快叙事/时间跨越本来就允许概括多日，不判定长度。 */
export const PACE_LENGTH_JUDGED_PACES: readonly NarrativePaceV2[] = ['slow', 'standard'];

// ---------------------------------------------------------------------------
// 时间推进词（29 回合评估口径的保守词表）
// ---------------------------------------------------------------------------

/**
 * 时间推进词表。
 *
 * 只收录"明确跨日/跨时段"的固定表达（第二天/次日/一周后/转眼/不知不觉/晚上…），
 * 不做「后来」「过了会儿」这类几乎每段都会出现的模糊词——它们会把正常叙事刷成越界。
 * 同一轮内按出现次数计，但总计数封顶 `PACE_TIME_JUMP_LIMIT`。
 */
export const PACE_TIME_JUMP_WORDS: readonly string[] = [
  // 跨日 / 跨多日
  '第二天', '次日', '翌日', '第三天', '隔天',
  '三天后', '一周后', '两周后', '一个月后', '几天后', '数日后', '数周后', '数月后',
  '半年后', '一年后', '多年后',
  '几天过去', '几天之后', '数天过去',
  // 恍惚过渡 / 时间流逝
  '转眼', '不知不觉', '时间飞逝', '时间一晃', '一晃',
  // 时点推进（任务口径显式包含「晚上」；单次出现不会触发阈值）
  '早上', '清晨', '中午', '下午', '傍晚', '晚上', '深夜', '凌晨', '夜里',
];

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 合并成一条"长词优先"的交替正则：按词长降序拼接，避免短词前缀抢先匹配长词；
 * 一次匹配只消费一段文字，同一处不会被重复计数。
 */
const TIME_JUMP_PATTERN = new RegExp(
  [...PACE_TIME_JUMP_WORDS].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|'),
  'g',
);

/**
 * 统计一轮正文里的时间推进词次数（上限 `PACE_TIME_JUMP_LIMIT`）。
 *
 * 非字符串输入（旧存档/手改档）按空串处理；空正文返回 0。
 */
export function countPaceTimeJumps(story: string): number {
  const text = typeof story === 'string' ? story : '';
  if (!text) return 0;
  const matched = text.match(TIME_JUMP_PATTERN);
  return Math.min(PACE_TIME_JUMP_LIMIT, matched?.length ?? 0);
}

// ---------------------------------------------------------------------------
// 升华/收束模式（五类，只看尾 220 字的叙述部分）
// ---------------------------------------------------------------------------

export interface PaceClosureRule {
  kind: 'theme_elevation' | 'summary_assertion' | 'time_jump_closure' | 'suspense_preview' | 'chapter_close';
  /** 中文标签（审计说明/测试可读性）。 */
  label: string;
  /** 无 `g` 标志：仅做一次 `test`，不保留 lastIndex 状态。 */
  pattern: RegExp;
}

/**
 * 五类"升华/收束"模式（与 29 回合评估口径同名）：
 *
 * 1. `theme_elevation` 主题升华：从今天开始 / 真正的意义 / 这一刻终于…；
 * 2. `summary_assertion` 总结性断言：告一段落 / 尘埃落定 / 再也回不去；
 * 3. `time_jump_closure` 时间跳跃收束：多年以后 / 时间流逝 / 后来的日子；
 * 4. `suspense_preview` 悬置式预告：而这一切仅仅是开始 / 未来会怎样 / 谁也说不清；
 * 5. `chapter_close` 章节式收束：这一夜结束 / 画上句号 / 本章完。
 *
 * 模式刻意保守：全部要求"收束义"的固定搭配，不匹配普通的"这就是…""原来…"句式。
 */
export const PACE_CLOSURE_RULES: readonly PaceClosureRule[] = [
  {
    kind: 'theme_elevation',
    label: '主题升华',
    pattern: /(?:从今(?:天|往后|以后)|从此(?:以后|之后)|真正的[^。！？]{0,6}(?:意义|答案|归宿|开始)|(?:这|那)一(?:刻|瞬间)[^。！？]{0,12}(?:终于|注定|不再|永远)|(?:才是|便是)[^。！？]{0,8}(?:真正的|唯一|全部|一切))/,
  },
  {
    kind: 'summary_assertion',
    label: '总结性断言',
    pattern: /(?:告一段落|尘埃落定|就这样[，,][^。！？]{0,10}(?:结束|过去|定下|收场)|再也(?:回不去|不会|没有)|一切(?:都|终于)?(?:结束|归零|回到原点)|这(?:就是|便是|才是)[^。！？]{0,8}(?:全部|一切|结局|答案))/,
  },
  {
    kind: 'time_jump_closure',
    label: '时间跳跃收束',
    pattern: /(?:多年(?:以后|后)|许多年(?:以后|后)|不知不(?:觉|觉中)[^。！？]{0,8}(?:过去|已)|时间[^。！？]{0,4}(?:过去|流逝)|后来的(?:日子|事)|再后来)/,
  },
  {
    kind: 'suspense_preview',
    label: '悬置式预告',
    pattern: /(?:而?这一切[^。！？]{0,6}(?:才|刚刚?|仅仅|只是)[^。！？]{0,4}开始|(?:故事|旅程|一切)[^。！？]{0,2}(?:才|刚|刚刚)(?:开始|起)|未来会怎样|谁也(?:说不清|不知道|无法预料)|等待(?:他们|他|她|我们)的[^。！？]{0,8}(?:明天|未来|命运)|新的(?:一天|故事|生活)[^。！？]{0,6}(?:开始|到来|展开))/,
  },
  {
    kind: 'chapter_close',
    label: '章节式收束',
    pattern: /(?:这(?:一夜|一天|一年|个夏天|个春天|段日子|段时光)[^。！？]{0,10}(?:结束|过去|落幕|告一段落|画上)|(?:画上|落下)[^。！？]{0,3}(?:句号|帷幕|句点)|本(?:章|节|回)[^。！？]{0,6}(?:结束|完|到此)|故事(?:到此|就此)?(?:结束|落幕))/,
  },
];

const QUOTE_CLOSERS: Record<string, string> = {
  '“': '”',
  '「': '」',
  '『': '』',
  '"': '"',
};

/**
 * 剔除成对中英文引号内的内容，只保留叙述文字。
 *
 * 收尾/升华是叙述行为：角色对白里的"从今天开始我们就是朋友了"是正常台词，不是旁白收尾。
 * 引号不配对（例如正文在对话中途被截断）时按"后面全是引文"处理——宁可漏报。
 */
export function stripQuotedSegments(text: string): string {
  const source = typeof text === 'string' ? text : '';
  let narration = '';
  let closing: string | null = null;
  for (const char of source) {
    if (closing) {
      if (char === closing) closing = null;
      continue;
    }
    const pair = QUOTE_CLOSERS[char];
    if (pair) {
      closing = pair;
      continue;
    }
    narration += char;
  }
  return narration;
}

/**
 * 检测正文末尾 220 字里命中的收束模式（返回命中的类别，空数组表示没有）。
 *
 * 先截尾再剔除对白：口径固定为"这一轮最后 220 字"，只排除对白而不扩大检查范围。
 */
export function detectPaceClosure(story: string): Array<PaceClosureRule['kind']> {
  const text = typeof story === 'string' ? story : '';
  if (!text) return [];
  const tail = text.slice(-PACE_CLOSURE_TAIL);
  const narration = stripQuotedSegments(tail);
  return PACE_CLOSURE_RULES
    .filter((rule) => rule.pattern.test(narration))
    .map((rule) => rule.kind);
}

// ---------------------------------------------------------------------------
// 审计与软纠偏
// ---------------------------------------------------------------------------

/**
 * 对一轮正文做节奏审计（纯观察，不修改正文）。
 *
 * `needsCorrection = closureDetected || timeJumpCount >= 3 || overBudget`：
 * 任一越界都会让下一轮注入软纠偏；三者都正常时为 false（干净回合不注入）。
 */
export function analyzePace(input: AnalyzePaceInputV2): PacingAuditV2 {
  const story = typeof input?.story === 'string' ? input.story : '';
  const pace = input?.pace;
  const length = story.length;
  const timeJumpCount = countPaceTimeJumps(story);
  const closureDetected = detectPaceClosure(story).length > 0;
  // 快叙事/时间跨越本来就允许一轮概括多日，篇幅不设上限（否则会误伤合理的压缩叙事）。
  const overBudget = PACE_LENGTH_JUDGED_PACES.includes(pace) && length > PACE_LENGTH_LIMIT;
  return {
    length,
    timeJumpCount,
    closureDetected,
    overBudget,
    needsCorrection: closureDetected || timeJumpCount >= PACE_TIME_JUMP_THRESHOLD || overBudget,
  };
}

/**
 * 生成注入下一轮 planner_pre 与 story 的 `【PACE_CORRECTION_ALERT】`（≤220 字）。
 *
 * 只做"收紧下一个回合"的软纠偏：说明上轮篇幅与越界类型，要求本轮只推进 1 个节拍、
 * 到点立即停笔，并再次禁止点题升华/总结全篇——不要求模型重写或回滚已提交的正文。
 */
export function buildPaceCorrectionAlert(audit: PacingAuditV2): string {
  const reasons: string[] = [];
  if (audit.overBudget) reasons.push('篇幅超预算');
  if (audit.closureDetected) reasons.push('末尾升华/收束');
  if (audit.timeJumpCount >= PACE_TIME_JUMP_THRESHOLD) reasons.push(`时间推进词 ${audit.timeJumpCount} 个`);
  const reasonText = reasons.length ? reasons.join('、') : '节奏越界';
  const alert = [
    PACE_CORRECTION_HEADER,
    `上轮越界纠偏：正文 ${Math.max(0, Math.round(Number(audit.length) || 0))} 字，越界类型：${reasonText}。`,
    '本轮只推进 1 个节拍，写到该节拍结束立即停笔；不得点题升华、不得总结全篇、不得跳到下一场景或下一幕。',
  ].join('\n');
  return alert.length <= PACE_CORRECTION_LIMIT ? alert : `${alert.slice(0, PACE_CORRECTION_LIMIT - 1)}…`;
}
