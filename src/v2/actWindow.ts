/**
 * 三幕聚焦窗口与世界书稳定/动态拆分（纯函数，engine 与单测共用同一份实现）。
 *
 * 对应 `docs/act-system-plan.md` 的 D4 / D5 / D8：
 * - `splitWorldFacts`：常驻（alwaysActive）条目进逐字节稳定的 `【STABLE_STORY_CONTEXT】`，
 *   关键词命中条目改走可变区 `【DYNAMIC_WORLD_FACTS】`。修复旧实现把关键词命中结果
 *   塞进稳定块、导致稳定上下文每回合都可能变化的缓存隐患。
 * - `buildStageAndActWindow`：生成 `【STAGE_AND_ACT_WINDOW】`（上一幕只读基线 / 当前幕施工
 *   契约 / 下一幕仅埋伏笔 / 最终命运锚 / 阶段红线）。该块只进可变区。分段有字符预算，
 *   整体超预算时按等级降级（先压远景与锚点，最后才压当前幕契约），总长始终 ≤ 900。
 * - `normalizeBeatsThisTurn`：把规划模型的 `beatsThisTurn` 裁剪成 1~3 条；慢叙事只留第 1 条。
 *
 * 这里不读写全局状态、不 import engine，避免提示词逻辑与回合执行互相牵连。
 */
import type { StoryAct, StoryBeat, StoryOutline, WorldBookEntry } from '@/types/content';
import type { DestinyProgressV2, StoryAutonomyV2, StoryBeatRuntimeV2 } from './types';

/** 常驻世界书注入上限。 */
export const STABLE_WORLD_FACT_LIMIT = 20;
/** 关键词命中的动态世界书注入上限。 */
export const DYNAMIC_WORLD_FACT_LIMIT = 10;
/** 关键词命中判定使用的近期历史条数（与规划模型近期窗口同源）。 */
export const WORLD_FACT_MATCH_HISTORY = 6;
/** 一轮最多推进的原子节拍数；慢叙事只取第 1 条。 */
export const MAX_BEATS_THIS_TURN = 3;
/** 三幕窗口总长上限（含 `【STAGE_AND_ACT_WINDOW】` 标题行）。 */
export const STAGE_ACT_WINDOW_LIMIT = 900;
export const STAGE_ACT_WINDOW_HEADER = '【STAGE_AND_ACT_WINDOW】';

// ---------------------------------------------------------------------------
// 世界书拆分（D5）
// ---------------------------------------------------------------------------

export interface WorldFactSplitInput {
  input: string;
  /** 近期历史（取最后 `WORLD_FACT_MATCH_HISTORY` 条做关键词命中）。 */
  history: ReadonlyArray<{ content: string }>;
  worldFacts?: ReadonlyArray<WorldBookEntry>;
}

export interface WorldFactSplit {
  /** 常驻条目：只进入稳定块，按 priority 降序、同级保持原序，最多 `STABLE_WORLD_FACT_LIMIT` 条。 */
  alwaysActive: WorldBookEntry[];
  /** 关键词命中条目：只进入可变区，最多 `DYNAMIC_WORLD_FACT_LIMIT` 条。 */
  dynamic: WorldBookEntry[];
  truncatedStatic: boolean;
  truncatedDynamic: boolean;
  /** 关键词命中的动态条目数（截断前），用于警告文案。 */
  matchedCount: number;
  /** 世界书条目总数（截断前），用于警告文案。 */
  totalCount: number;
}

/**
 * 运行时数据可能来自手改/旧版存档：非数组一律按空数组处理。
 * 不用裸 `Array.isArray(x) ? x : []`——对 `ReadonlyArray` 它会把元素窄化成 any[]。
 */
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

const priorityOf = (fact: WorldBookEntry): number => (
  typeof fact.priority === 'number' && Number.isFinite(fact.priority) ? fact.priority : 0
);

/** 按 priority 降序排序；同优先级保持原数组顺序（索引兜底，不依赖引擎排序稳定性）。 */
function byPriorityDesc<T>(rows: T[], priority: (row: T) => number): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => priority(b.row) - priority(a.row) || a.index - b.index)
    .map((item) => item.row);
}

/**
 * 拆分世界书：
 *   1. `alwaysActive === true` 的条目全部归稳定块（每轮必进，缓存安全）；
 *   2. 其余条目只有关键词命中当前输入或最近 6 条历史时才进动态块（否则未命中的设定
 *      会被每回合无条件注入，既浪费预算，也会把仍未发生的伏笔提前摊给模型）；
 *   3. 两块都按 priority 降序、同级保持原序，再分别按上限截断。
 *
 * 被截断的内容仍可由规划模型的 search_story_context 工具按需检索，不会真正丢失。
 */
export function splitWorldFacts(p: WorldFactSplitInput): WorldFactSplit {
  const facts = asArray<WorldBookEntry>(p.worldFacts);
  const alwaysActiveAll = byPriorityDesc(facts.filter((fact) => fact.alwaysActive === true), priorityOf);
  const haystack = `${p.input ?? ''}\n${asArray<{ content: string }>(p.history)
    .slice(-WORLD_FACT_MATCH_HISTORY)
    .map((message) => String(message?.content ?? ''))
    .join('\n')}`.toLowerCase();
  const dynamicMatched = facts.filter((fact) => {
    if (fact.alwaysActive === true) return false;
    const keywords = asArray<string>(fact.keywords);
    return keywords.some((keyword) => {
      const needle = String(keyword ?? '').trim().toLowerCase();
      return !!needle && haystack.includes(needle);
    });
  });
  const dynamicOrdered = byPriorityDesc(dynamicMatched, priorityOf);
  return {
    alwaysActive: alwaysActiveAll.slice(0, STABLE_WORLD_FACT_LIMIT),
    dynamic: dynamicOrdered.slice(0, DYNAMIC_WORLD_FACT_LIMIT),
    truncatedStatic: alwaysActiveAll.length > STABLE_WORLD_FACT_LIMIT,
    truncatedDynamic: dynamicOrdered.length > DYNAMIC_WORLD_FACT_LIMIT,
    matchedCount: dynamicMatched.length,
    totalCount: facts.length,
  };
}

// ---------------------------------------------------------------------------
// 本轮节拍清单（D8）
// ---------------------------------------------------------------------------

/**
 * 把规划模型给出的 `beatsThisTurn` 裁剪成本轮可执行的节拍清单。
 *
 * 模型经常把整段剧情写成字符串数组（或混入非字符串脏值），因此只接受非空字符串、
 * 去首尾空白；数量上限由「故事推进权限」决定（v2.2 / gemini-4-argon 复审结论）：
 * - strict 严格遵循：最多 1 条（允许 0 条）；
 * - standard 标准推进：最多 2 条；
 * - free 自由发散：最多 3 条。
 * 叙事速度不再参与节拍数量裁剪（它只负责镜头焦距与节奏）。
 */
export function normalizeBeatsThisTurn(raw: unknown, autonomy: StoryAutonomyV2 = 'standard'): string[] {
  if (!Array.isArray(raw)) return [];
  const cap = autonomy === 'strict' ? 1 : autonomy === 'free' ? MAX_BEATS_THIS_TURN : 2;
  const beats: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const text = item.trim();
    if (!text) continue;
    beats.push(text);
    if (beats.length >= cap) break;
  }
  return beats;
}

// ---------------------------------------------------------------------------
// 三幕聚焦窗口（D4）
// ---------------------------------------------------------------------------

export interface StageAndActWindowInput {
  outline?: Pick<StoryOutline, 'acts' | 'synopsis'>;
  destiny: Pick<
    DestinyProgressV2,
    'currentActId' | 'currentActIndex' | 'beats' | 'actHistory' | 'lastActTransitionTurn' | 'nextMilestone' | 'convergencePlan'
  >;
  /** 回合开始前的权威回合号（0 起），用于「进入本幕第 N 回合」。 */
  turn: number;
}

const TERMINAL_BEAT_STATUSES = new Set(['satisfied', 'superseded']);
const ACT_TITLE_CAP = 24;
const BEAT_ID_CAP = 24;
const BEAT_TITLE_CAP = 16;
const CARRIED_TITLE_CAP = 16;
const BEAT_STATUS_CAP = 12;

/** 把任意文本压成单行并截断到 max 个字符（超长时以省略号结尾，结果长度恰为 max）。 */
export function clipWindowText(value: unknown, max: number): string {
  if (!(max > 0)) return '';
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  if (max === 1) return '…';
  return `${text.slice(0, max - 1)}…`;
}

interface WindowBeat {
  status: string;
  beatId: string;
  title: string;
  purpose: string;
  currentPlan: string;
}

interface WindowCarriedBeat extends WindowBeat {
  fromActTitle: string;
}

interface WindowModel {
  acts: StoryAct[];
  index: number;
  current: StoryAct;
  previous?: { title: string; summary: string };
  next?: StoryAct;
  laterActs: StoryAct[];
  pendingBeats: WindowBeat[];
  carriedBeats: WindowCarriedBeat[];
  nativeCount: number;
  terminalCount: number;
  carriedCount: number;
  stageStatus: string;
  /** 是否处于新幕开局（切幕后 1~2 回合）：只有这时才注入作者写的开幕引子。 */
  isActOpening: boolean;
  anchor: string;
}

/**
 * 窗口降级等级：整体超预算时逐级压低各段上限。
 *
 * 预算只有 900 字符，而「当前幕施工契约」本身就可能占满 200，因此不能指望固定
 * 上限一定装得下：必须按信息价值排序降级。降级顺序是「远景与锚点 → 上幕摘要 →
 * 跨幕挂账 → 节拍细节 → 当前幕契约」，当前幕契约与红线最后才被压缩。
 * 0 表示该段整段省略（字段缺失与预算耗尽共用同一种「不输出空标签」的表示）。
 */
interface WindowCaps {
  prevSummary: number;
  purpose: number;
  stageContract: number;
  entryBrief: number;
  exitCriteria: number;
  nextPurpose: number;
  laterActs: number;
  anchor: number;
  beatPurpose: number;
  beatPlan: number;
  carriedPurpose: number;
  maxBeats: number;
  maxCarried: number;
}

const WINDOW_CAPS_LEVELS: WindowCaps[] = [
  {
    prevSummary: 120, purpose: 80, stageContract: 200, entryBrief: 120, exitCriteria: 120,
    nextPurpose: 120, laterActs: 150, anchor: 150,
    beatPurpose: 70, beatPlan: 50, carriedPurpose: 50,
    maxBeats: 5, maxCarried: 3,
  },
  {
    prevSummary: 90, purpose: 60, stageContract: 150, entryBrief: 90, exitCriteria: 90,
    nextPurpose: 80, laterActs: 90, anchor: 100,
    beatPurpose: 48, beatPlan: 32, carriedPurpose: 34,
    maxBeats: 4, maxCarried: 2,
  },
  {
    prevSummary: 60, purpose: 44, stageContract: 110, entryBrief: 70, exitCriteria: 60,
    nextPurpose: 56, laterActs: 50, anchor: 60,
    beatPurpose: 32, beatPlan: 22, carriedPurpose: 24,
    maxBeats: 3, maxCarried: 2,
  },
  {
    prevSummary: 40, purpose: 30, stageContract: 72, entryBrief: 44, exitCriteria: 40,
    nextPurpose: 40, laterActs: 0, anchor: 40,
    beatPurpose: 22, beatPlan: 14, carriedPurpose: 16,
    maxBeats: 3, maxCarried: 1,
  },
  // 预算只剩最后一点时优先保住「上一幕只读基线 + 当前幕契约 + 两个节拍 + 下一幕引子」，
  // 尽早丢掉远端幕标题、跨幕挂账明细与节拍实施计划（命运进度行已给出挂账数量）。
  {
    prevSummary: 32, purpose: 20, stageContract: 48, entryBrief: 32, exitCriteria: 32,
    nextPurpose: 28, laterActs: 0, anchor: 28,
    beatPurpose: 16, beatPlan: 0, carriedPurpose: 10,
    maxBeats: 3, maxCarried: 0,
  },
  {
    prevSummary: 0, purpose: 24, stageContract: 40, entryBrief: 0, exitCriteria: 0,
    nextPurpose: 32, laterActs: 0, anchor: 30,
    beatPurpose: 16, beatPlan: 0, carriedPurpose: 0,
    maxBeats: 2, maxCarried: 0,
  },
];

/** 从大纲里反查故事节的标题与 purpose（运行时 beat 只有状态，没有文案）。 */
function outlineBeatIndex(acts: StoryAct[]): Map<string, StoryBeat> {
  const index = new Map<string, StoryBeat>();
  for (const act of acts) {
    for (const beat of asArray<StoryBeat>(act?.beats)) {
      if (beat && typeof beat.id === 'string' && beat.id) index.set(beat.id, beat);
    }
  }
  return index;
}

function nonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

/**
 * 把权威状态翻译成窗口需要的模型：当前幕、上一幕（exitSummary）、下一幕、更远幕、
 * 本幕待推进节拍与跨幕挂账节拍。所有「幕」信息以大纲为准，状态以 destiny 为准。
 */
function resolveWindowModel(input: StageAndActWindowInput): WindowModel | undefined {
  const acts = asArray<StoryAct>(input.outline?.acts);
  if (!acts.length) return undefined;
  const destiny = input.destiny;
  const runtimeBeats = asArray<StoryBeatRuntimeV2>(destiny?.beats);
  const history = asArray<DestinyProgressV2['actHistory'][number]>(destiny?.actHistory);
  const beatMeta = outlineBeatIndex(acts);

  // 当前幕：程序权威 id 优先；id 查不到时退回 currentActIndex；都不可用时从第一幕开始。
  let index = acts.findIndex((act) => act.id === destiny?.currentActId);
  if (index < 0) {
    const stored = Number(destiny?.currentActIndex);
    if (Number.isInteger(stored) && stored >= 0 && stored < acts.length) index = stored;
  }
  if (index < 0) index = 0;
  const current = acts[index];
  const actTitleOf = (actId: string | undefined): string => {
    const found = acts.find((act) => act.id === actId);
    return found?.title || String(actId ?? '').trim() || '未知幕';
  };

  // 上一幕：优先取程序写入的幕历史（含模型给的 actExitSummary 或程序兜底的 roundSummary）。
  const lastExit = history.length ? history[history.length - 1] : undefined;
  let previous: WindowModel['previous'];
  if (lastExit && lastExit.actId !== current.id) {
    const prevAct = acts.find((act) => act.id === lastExit.actId);
    previous = {
      title: actTitleOf(lastExit.actId),
      summary: nonEmpty(lastExit.exitSummary, prevAct?.purpose),
    };
  } else if (index > 0) {
    previous = { title: acts[index - 1].title, summary: String(acts[index - 1].purpose ?? '') };
  }

  // 阶段状态：幕切换发生在某一回合的提交里，下一回合就是新幕第 1 回合。
  const turn = Number.isFinite(input.turn) ? Math.max(0, Math.floor(input.turn)) : 0;
  const lastTransition = typeof destiny?.lastActTransitionTurn === 'number' && Number.isFinite(destiny.lastActTransitionTurn)
    ? destiny.lastActTransitionTurn
    : typeof lastExit?.exitedTurn === 'number'
      ? lastExit.exitedTurn
      : undefined;
  // 第一幕没有切幕记录：开局回合 0 即第 1 回合。切幕后：enteredTurn+1 才是第 1 回合。
  const roundsInAct = lastTransition === undefined
    ? turn + 1
    : Math.max(1, turn - Math.floor(lastTransition));
  const stageStatus = roundsInAct <= 1
    ? '新幕开启（进入本幕第 1 回合）'
    : `运行中（进入本幕第 ${roundsInAct} 回合）`;

  // 故事节：本幕原生非终态 = 待推进；带 carriedFromActId 且属更早幕 = 跨幕挂账。
  const actIdOf = (beat: StoryBeatRuntimeV2) => String(beat?.actId ?? '').trim() || current.id;
  const isTerminal = (beat: StoryBeatRuntimeV2) => TERMINAL_BEAT_STATUSES.has(String(beat?.status ?? ''));
  const toWindowBeat = (beat: StoryBeatRuntimeV2): WindowBeat => {
    const meta = beatMeta.get(String(beat?.beatId ?? ''));
    return {
      status: String(beat?.status ?? 'pending'),
      beatId: String(beat?.beatId ?? ''),
      title: String(meta?.title ?? ''),
      purpose: String(meta?.purpose ?? ''),
      currentPlan: String(beat?.currentPlan ?? ''),
    };
  };
  const runtimeNative = runtimeBeats.filter((beat) => actIdOf(beat) === current.id);
  const pendingBeats = runtimeNative.length
    ? runtimeNative.filter((beat) => !isTerminal(beat)).map(toWindowBeat)
    // 旧存档可能还没有运行时故事节（beats 为空）：退回大纲把本幕故事节按 pending 展示，
    // 让窗口仍然能给出可推进的目标，而不是输出一个空的故事节清单。
    : asArray<StoryBeat>(current.beats).map((beat) => ({
      status: 'pending', beatId: beat.id, title: beat.title, purpose: beat.purpose, currentPlan: '',
    }));
  const carriedBeats: WindowCarriedBeat[] = runtimeBeats
    .filter((beat) => !isTerminal(beat) && String(beat?.carriedFromActId ?? '').trim() && actIdOf(beat) !== current.id)
    .map((beat) => ({ ...toWindowBeat(beat), fromActTitle: actTitleOf(beat.carriedFromActId || beat.actId) }));
  const nativeCount = runtimeNative.length || asArray<StoryBeat>(current.beats).length;
  const terminalCount = runtimeNative.length
    ? runtimeNative.filter(isTerminal).length
    : 0;

  return {
    acts,
    index,
    current,
    previous,
    next: acts[index + 1],
    laterActs: acts.slice(index + 2),
    pendingBeats,
    carriedBeats,
    nativeCount,
    terminalCount,
    carriedCount: carriedBeats.length,
    stageStatus,
    // D6：entryBrief 只在切幕后 1~2 回合原样注入，开幕后融进前几回合的正文即可。
    isActOpening: roundsInAct <= 2,
    anchor: nonEmpty(destiny?.nextMilestone, destiny?.convergencePlan, input.outline?.synopsis),
  };
}

function renderBeatLine(beat: WindowBeat, caps: WindowCaps): string {
  const status = clipWindowText(beat.status, BEAT_STATUS_CAP);
  const beatId = clipWindowText(beat.beatId, BEAT_ID_CAP);
  const title = clipWindowText(beat.title, BEAT_TITLE_CAP);
  const purpose = clipWindowText(beat.purpose, caps.beatPurpose);
  let line = `  * [${status}] ${beatId}${title ? `（${title}）` : ''}${purpose ? `：${purpose}` : ''}`;
  const plan = caps.beatPlan > 0 ? clipWindowText(beat.currentPlan, caps.beatPlan) : '';
  if (plan) line += `；当前计划：${plan}`;
  return line;
}

function renderCarriedLine(beat: WindowCarriedBeat, caps: WindowCaps): string {
  const status = clipWindowText(beat.status, BEAT_STATUS_CAP);
  const beatId = clipWindowText(beat.beatId, BEAT_ID_CAP);
  const title = clipWindowText(beat.title, CARRIED_TITLE_CAP);
  const purpose = clipWindowText(beat.purpose, caps.carriedPurpose);
  return `  * [${status}] ${beatId}${title ? `（${title}）` : ''}${purpose ? `：${purpose}` : ''}；原属《${clipWindowText(beat.fromActTitle, CARRIED_TITLE_CAP)}》`;
}

/** 后续未展开阶段只列标题；预算不足时按顺序装入，装不下就停在最后一个完整标题。 */
function renderLaterActs(laterActs: StoryAct[], startIndex: number, max: number): string {
  if (!(max > 0)) return '';
  const pieces: string[] = [];
  let used = 0;
  for (let offset = 0; offset < laterActs.length; offset += 1) {
    const act = laterActs[offset];
    const piece = `第${startIndex + offset + 1}幕《${clipWindowText(act?.title, ACT_TITLE_CAP)}》`;
    const extra = pieces.length ? piece.length + 1 : piece.length;
    if (used + extra > max) break;
    pieces.push(piece);
    used += extra;
  }
  return pieces.join('、');
}

function buildRedLines(model: WindowModel): string[] {
  const remaining = model.pendingBeats.length;
  return [
    '[阶段红线]',
    remaining > 0
      ? `1. 本幕尚有 ${remaining} 个未完成故事节，正文严禁出现阶段总结、主题升华、"新生活开始"式收束。`
      : '1. 本幕原生故事节已全部达成，正文不得自行宣告进入下一幕；幕推进由程序判定。',
    '2. 只推进【beatsThisTurn】列出的 1~3 个节拍，抵达 stopBoundary 立即停笔。',
    '3. 故事节激活必须以当前场景与玩家行动为前提；不得为凑节拍瞬移 NPC 或强凑冲突。',
    '4. 幕切换只解锁可触发的命运池，不代表场景或时间跳转；新幕开启时先承接上一回合现场。',
    '5. 【下一幕】核心事件不得提前兑现，只能埋下自然伏笔。',
  ];
}

function renderWindow(model: WindowModel, caps: WindowCaps): string {
  const blocks: string[] = [];
  const head = [
    STAGE_ACT_WINDOW_HEADER,
    `- 命运进度：第 ${model.index + 1} / ${model.acts.length} 幕《${clipWindowText(model.current.title, ACT_TITLE_CAP)}》（本幕故事节：${model.terminalCount}/${model.nativeCount} 已达成，${model.carriedCount} 个跨幕挂账）`,
    `- 阶段状态：${model.stageStatus}`,
  ];
  blocks.push(head.join('\n'));

  if (model.previous && caps.prevSummary > 0) {
    const summary = clipWindowText(model.previous.summary, caps.prevSummary);
    const prevTitle = clipWindowText(model.previous.title, ACT_TITLE_CAP);
    blocks.push([
      '[上一幕复盘 · 只读因果基线]',
      summary ? `- 《${prevTitle}》（已收束）：${summary}` : `- 《${prevTitle}》（已收束）`,
    ].join('\n'));
  }

  const currentLines = [
    '[当前幕施工契约 · 核心展开区]',
    `- 幕标题：${clipWindowText(model.current.title, ACT_TITLE_CAP)}`,
  ];
  const purpose = clipWindowText(model.current.purpose, caps.purpose);
  if (purpose) currentLines.push(`- 核心作用：${purpose}`);
  const contract = clipWindowText(model.current.stageContract, caps.stageContract);
  if (contract) currentLines.push(`- 阶段契约：${contract}`);
  // entryBrief 只在开幕 1~2 回合注入；exitCriteriaNote 是阶段完成标志，全程保留。
  const entryBrief = model.isActOpening ? clipWindowText(model.current.entryBrief, caps.entryBrief) : '';
  if (entryBrief) currentLines.push(`- 开幕引子：${entryBrief}`);
  const exitNote = clipWindowText(model.current.exitCriteriaNote, caps.exitCriteria);
  if (exitNote) currentLines.push(`- 幕完成标志：${exitNote}`);
  const beatLines = model.pendingBeats.slice(0, caps.maxBeats).map((beat) => renderBeatLine(beat, caps));
  if (beatLines.length) currentLines.push('- 本幕待推进故事节：', ...beatLines);
  const carriedLines = caps.maxCarried > 0
    ? model.carriedBeats.slice(0, caps.maxCarried).map((beat) => renderCarriedLine(beat, caps))
    : [];
  if (carriedLines.length) currentLines.push('- 跨幕挂账节：', ...carriedLines);
  blocks.push(currentLines.join('\n'));

  if (model.next && caps.nextPurpose > 0) {
    const nextTitle = clipWindowText(model.next.title, ACT_TITLE_CAP);
    const nextPurpose = clipWindowText(model.next.purpose, caps.nextPurpose);
    const lines = [
      '[下一幕远景引子 · 仅允许埋伏笔，严禁提前兑现]',
      nextPurpose ? `- 下一幕《${nextTitle}》：${nextPurpose}` : `- 下一幕《${nextTitle}》`,
    ];
    const later = renderLaterActs(model.laterActs, model.index + 2, caps.laterActs);
    if (later) lines.push(`- 后续未展开阶段：${later}`);
    blocks.push(lines.join('\n'));
  }

  const anchor = clipWindowText(model.anchor, caps.anchor);
  if (anchor) blocks.push(`[最终命运锚]\n- ${anchor}`);

  blocks.push(buildRedLines(model).join('\n'));
  return blocks.join('\n');
}

/**
 * 生成 `【STAGE_AND_ACT_WINDOW】` 三幕窗口（只用于可变区）。
 *
 * 返回空串表示没有可注入的大纲（此时 engine 既不输出标题行也不输出空标签）。
 * 返回值的长度始终 ≤ `STAGE_ACT_WINDOW_LIMIT`：逐级降级各段上限，仍超预算时退化为
 * 「表头 + 当前幕 + 红线」的骨架，最后再兜底截断（正常数据不会走到这一步）。
 */
export function buildStageAndActWindow(input: StageAndActWindowInput): string {
  const model = resolveWindowModel(input);
  if (!model) return '';
  for (const caps of WINDOW_CAPS_LEVELS) {
    const text = renderWindow(model, caps);
    if (text.length <= STAGE_ACT_WINDOW_LIMIT) return text;
  }
  const skeleton = renderWindow(model, WINDOW_CAPS_LEVELS[WINDOW_CAPS_LEVELS.length - 1]);
  return skeleton.length <= STAGE_ACT_WINDOW_LIMIT
    ? skeleton
    : clipWindowText(skeleton, STAGE_ACT_WINDOW_LIMIT);
}
