/**
 * 随机事件：目的绑定 + 滚动钩子 + 三态闭环 + 智能强度（纯函数，engine / patch / 单测共用）。
 *
 * 对应 `docs/act-system-plan.md` 的 D7。旧实现的随机事件有三个结构性问题：
 *   1. **失忆**：事件发生一次后只留下 `lastNote`，后续回合无法回收伏笔；
 *   2. **无目的**：指令只说"插入一个相关事件"，模型很容易写成与主线无关的路人事件；
 *   3. **强度随机**：到期时在 related/progress/destiny 里随机换档，不理会当前故事状态。
 *
 * 这里给出四组纯函数：
 * - `pushRandomEventHistory`：滚动历史上限 8，优先保留最近的 ongoing_hook（最多 3 条）；
 * - `pickRandomEventIntensity`：按"改道/挂账 → 命运档、刚切幕/故事节停滞 → 推进档、否则相关档"；
 * - `listRandomEventTargets` / `validateRandomEventBinding`：给规划模型一份可绑定的候选目标，
 *   并校验模型提交的 targetKind/targetId 是否真的落在候选里；
 * - `buildRandomEventContextBlock` / `buildRandomEventInstruction`：生成注入 planner_pre 与
 *   story 的紧凑上下文与三档指令。
 *
 * 这里不读写全局状态、不 import engine，保持与 `actWindow.ts` 同样的纯函数边界。
 */
import type {
  CharacterV2,
  DestinyProgressV2,
  GameStateV2,
  RandomEventBindingV2,
  RandomEventHistoryItemV2,
  RandomEventIntensityV2,
  RandomEventStateV2,
  RandomEventTargetKindV2,
  RelationshipV2,
  StoryAutonomyV2,
  StoryBeatRuntimeV2,
  StoryThreadV2,
} from './types';

/** 滚动事件历史上限。 */
export const RANDOM_EVENT_HISTORY_LIMIT = 8;
/** 超限裁剪时优先保留的最近 ongoing_hook 条数上限。 */
export const RANDOM_EVENT_ONGOING_HOOK_LIMIT = 3;
/** `【RANDOM_EVENT_CONTEXT】` 文本长度上限（含标题行）。 */
export const RANDOM_EVENT_CONTEXT_LIMIT = 400;
/** 写前摘要上限（与历史/绑定共用同一口径）。 */
export const RANDOM_EVENT_SUMMARY_LIMIT = 80;
/** 写后结果说明上限。 */
export const RANDOM_EVENT_OUTCOME_LIMIT = 100;
/** 绑定目标类型的白名单（模型写到表外一律视为非法）。 */
export const RANDOM_EVENT_TARGET_KINDS: readonly RandomEventTargetKindV2[] = ['beat', 'thread', 'relationship', 'reconvergence'];
/** 收束/命运锚的固定 targetId：即使故事节与线程都为空，事件也永远可以绑定到最终命运。 */
export const RANDOM_EVENT_RECONVERGENCE_ID = 'destiny_main';
export const RANDOM_EVENT_CONTEXT_HEADER = '【RANDOM_EVENT_CONTEXT】';

/** 灵魂共创（co_author）档的随机事件冷却区间：情境催化剂不应像任务 KPI 一样密集触发。 */
export const CO_AUTHOR_RANDOM_EVENT_COOLDOWN_MIN = 3;
export const CO_AUTHOR_RANDOM_EVENT_COOLDOWN_MAX = 5;

/** 是否灵魂共创档（其它档保持既有随机事件行为）。 */
export function isCoAuthorAutonomy(autonomy: StoryAutonomyV2 | undefined): boolean {
  return autonomy === 'co_author';
}

export interface RandomEventCooldownInputV2 {
  autonomy?: StoryAutonomyV2;
  triggerIntervalMin?: number;
  triggerIntervalMax?: number;
}

export interface RandomEventCooldownRangeV2 {
  min: number;
  max: number;
}

/**
 * 随机事件冷却区间。
 *
 * - `co_author`（灵魂共创）：复用存档里的 `triggerIntervalMin/Max`，但夹到 3~5 回合——
 *   随机事件是"情境催化剂"，不能用来催线程进度；存档默认的 3~6 会被收成 3~5。
 * - 其它档（standard/free/strict）：与旧行为完全一致（缺省 3~6，min≤max），不做任何收紧。
 */
export function randomEventCooldownRange(input: RandomEventCooldownInputV2): RandomEventCooldownRangeV2 {
  const rawMin = Number(input.triggerIntervalMin);
  const rawMax = Number(input.triggerIntervalMax);
  if (isCoAuthorAutonomy(input.autonomy)) {
    const min = Math.max(
      CO_AUTHOR_RANDOM_EVENT_COOLDOWN_MIN,
      Math.min(Number.isFinite(rawMin) ? Math.round(rawMin) : CO_AUTHOR_RANDOM_EVENT_COOLDOWN_MIN, CO_AUTHOR_RANDOM_EVENT_COOLDOWN_MAX),
    );
    const max = Math.max(
      min,
      Math.min(Number.isFinite(rawMax) ? Math.round(rawMax) : CO_AUTHOR_RANDOM_EVENT_COOLDOWN_MAX, CO_AUTHOR_RANDOM_EVENT_COOLDOWN_MAX),
    );
    return { min, max };
  }
  const min = Math.max(1, Math.round(Number.isFinite(rawMin) ? rawMin : 3));
  const max = Math.max(min, Math.round(Number.isFinite(rawMax) ? rawMax : 6));
  return { min, max };
}

/** 在冷却区间内取一个回合偏移（min=max 时确定；`rng` 可注入以便测试）。 */
export function randomEventCooldownTurns(range: RandomEventCooldownRangeV2, rng: () => number = Math.random): number {
  const min = Math.max(1, Math.round(Number.isFinite(range?.min) ? range.min : 3));
  const max = Math.max(min, Math.round(Number.isFinite(range?.max) ? range.max : min));
  const roll = Number(rng());
  const normalized = Number.isFinite(roll) ? Math.max(0, Math.min(0.999999, roll)) : 0;
  return min + Math.floor(normalized * (max - min + 1));
}

/** 本回合随机事件是否到期（与 patch.ts 的调度判定保持同一口径）。 */
export function isRandomEventDue(randomEvent: RandomEventStateV2 | undefined, turn: number): boolean {
  if (!randomEvent || randomEvent.enabled === false) return false;
  return randomEvent.pending || Number(turn) >= randomEvent.nextTriggerTurn;
}

const clip = (value: unknown, max: number): string => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** 运行时数据可能来自手改/旧版存档：非数组一律按空数组处理。 */
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

const isTerminalBeatStatus = (status: unknown): boolean => status === 'satisfied' || status === 'superseded';

const isTargetKind = (value: unknown): value is RandomEventTargetKindV2 => RANDOM_EVENT_TARGET_KINDS.includes(value as RandomEventTargetKindV2);

// ---------------------------------------------------------------------------
// 滚动历史（D7）
// ---------------------------------------------------------------------------

/**
 * 追加一条事件历史并维持滚动上限。
 *
 * 裁剪顺序（D7）：先保证最近的 ongoing_hook（最多 3 条）不被挤掉——它们正是后续回收
 * 的伏笔；剩余名额再按"新→旧"填满。返回数组仍保持事件发生的时间顺序（旧→新）。
 */
export function pushRandomEventHistory(
  history: RandomEventHistoryItemV2[] | undefined,
  item: RandomEventHistoryItemV2,
): RandomEventHistoryItemV2[] {
  const all = [...asArray<RandomEventHistoryItemV2>(history), item];
  if (all.length <= RANDOM_EVENT_HISTORY_LIMIT) return all;
  const keep = new Array<boolean>(all.length).fill(false);
  let kept = 0;
  // 1) 优先保留最近的 ongoing_hook。
  for (let index = all.length - 1; index >= 0 && kept < RANDOM_EVENT_ONGOING_HOOK_LIMIT; index -= 1) {
    if (all[index]?.status === 'ongoing_hook') {
      keep[index] = true;
      kept += 1;
    }
  }
  // 2) 其余名额从最新事件往回填。
  for (let index = all.length - 1; index >= 0 && kept < RANDOM_EVENT_HISTORY_LIMIT; index -= 1) {
    if (!keep[index]) {
      keep[index] = true;
      kept += 1;
    }
  }
  return all.filter((_, index) => keep[index]);
}

/** 从任意来源（旧存档/模型输出）读取一个形状合法的 activeBinding；非法时返回 undefined。 */
export function readRandomEventBinding(raw: unknown): RandomEventBindingV2 | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const binding = raw as Record<string, unknown>;
  const targetKind = binding.targetKind;
  const targetId = clip(binding.targetId, 80);
  if (!isTargetKind(targetKind) || !targetId) return undefined;
  return {
    targetKind,
    targetId,
    summary: clip(binding.summary, RANDOM_EVENT_SUMMARY_LIMIT) || targetId,
    plannedAtTurn: typeof binding.plannedAtTurn === 'number' && Number.isFinite(binding.plannedAtTurn)
      ? Math.round(binding.plannedAtTurn)
      : 0,
  };
}

// ---------------------------------------------------------------------------
// 智能强度（D7）
// ---------------------------------------------------------------------------

export interface RandomEventIntensityInputV2 {
  destiny: DestinyProgressV2;
  randomEvent?: RandomEventStateV2;
  turn: number;
}

/**
 * 选择下一次随机事件的强度档位（替代旧的"随机换档"）：
 *
 * 1. `destiny`：存在 reframed 故事节，或存在跨幕挂账（`carriedFromActId` 非空且非终态）——
 *    此时路线已改写，最需要的是把剧情重新拧回预设命运；
 * 2. `progress`：刚切幕后 ≤2 回合（新幕需要助推），或某个 active 故事节超过 5 回合没更新
 *    （幕内停滞，需要外部事件推一把）；
 * 3. `related`：常态——严格相关但不必强行推进。
 */
export function pickRandomEventIntensity(input: RandomEventIntensityInputV2): RandomEventIntensityV2 {
  // 事件关闭时强度无意义，保持最低档，避免关闭期间被别的分支写成未定义行为。
  if (input.randomEvent?.enabled === false) return 'related';
  const turn = Number.isFinite(input.turn) ? Math.round(input.turn) : 0;
  const destiny = input.destiny;
  const beats = asArray<StoryBeatRuntimeV2>(destiny?.beats);

  const hasReframed = beats.some((beat) => beat?.status === 'reframed');
  const hasCarried = beats.some((beat) => !!clip(beat?.carriedFromActId, 80) && !isTerminalBeatStatus(beat?.status));
  if (hasReframed || hasCarried) return 'destiny';

  const lastTransition = destiny?.lastActTransitionTurn;
  const justTransitioned = typeof lastTransition === 'number' && Number.isFinite(lastTransition) && turn - lastTransition <= 2;
  const staleActiveBeat = beats.some((beat) => (
    beat?.status === 'active'
    && typeof beat.updatedAtTurn === 'number'
    && Number.isFinite(beat.updatedAtTurn)
    && turn - beat.updatedAtTurn > 5
  ));
  if (justTransitioned || staleActiveBeat) return 'progress';

  return 'related';
}

// ---------------------------------------------------------------------------
// 候选绑定目标（D7）
// ---------------------------------------------------------------------------

export interface RandomEventBindingCandidateV2 {
  targetKind: RandomEventTargetKindV2;
  targetId: string;
  /** 给模型/日志看的人类可读说明。 */
  label: string;
  source: 'beat' | 'thread' | 'relationship' | 'ongoing_hook' | 'reconvergence';
  /** `source === 'ongoing_hook'` 时对应的事件 id，用于回收旧钩子。 */
  hookEventId?: string;
}

export interface RandomEventTargetsInputV2 {
  destiny: DestinyProgressV2;
  state: GameStateV2;
}

/** 故事节状态优先级：可推进的排在前面，pending 最后。 */
const BEAT_STATUS_RANK: Record<string, number> = { active: 0, available: 1, weakened: 2, reframed: 3, pending: 4 };
const MAX_BEAT_TARGETS = 6;
const MAX_THREAD_TARGETS = 4;
const MAX_RELATIONSHIP_TARGETS = 3;
const MAX_HOOK_TARGETS = 3;

/**
 * 返回本回合可绑定的候选目标：
 * - 非终态故事节（active/available 优先）id；
 * - active 故事线程 id；
 * - 主要关系 id（|好感| 降序）；
 * - 历史里的 ongoing_hook 事件（附其原绑定目标，供回收）；
 * - 固定收束锚 `reconvergence:destiny_main`（永远存在，保证任何存档都有可绑目标）。
 */
export function listRandomEventTargets(input: RandomEventTargetsInputV2): RandomEventBindingCandidateV2[] {
  const destiny = input.destiny;
  const state = input.state;
  const candidates: RandomEventBindingCandidateV2[] = [];

  const beats = asArray<StoryBeatRuntimeV2>(destiny?.beats)
    .filter((beat) => !!beat && typeof beat.beatId === 'string' && !isTerminalBeatStatus(beat.status))
    .map((beat, index) => ({ beat, index }))
    .sort((a, b) => (BEAT_STATUS_RANK[a.beat.status] ?? 9) - (BEAT_STATUS_RANK[b.beat.status] ?? 9) || a.index - b.index)
    .slice(0, MAX_BEAT_TARGETS)
    .map((entry) => entry.beat);
  for (const beat of beats) {
    const targetId = clip(beat.beatId, 80);
    candidates.push({
      targetKind: 'beat',
      targetId,
      label: `故事节 ${targetId}（${beat.status}）${beat.carriedFromActId ? `·挂账自${clip(beat.carriedFromActId, 80)}` : ''}`,
      source: 'beat',
    });
  }

  const threads = asArray<StoryThreadV2>(state?.storyThreads)
    .filter((thread) => !!thread && typeof thread.id === 'string' && thread.status === 'active')
    .slice(0, MAX_THREAD_TARGETS);
  for (const thread of threads) {
    const targetId = clip(thread.id, 80);
    candidates.push({ targetKind: 'thread', targetId, label: `线程「${clip(thread.title, 30)}」`, source: 'thread' });
  }

  const nameOf = (characterId: string) => asArray<CharacterV2>(state?.characters).find((character) => character?.id === characterId)?.name || characterId;
  const relationships = asArray<RelationshipV2>(state?.relationships)
    .filter((relationship) => !!relationship && typeof relationship.id === 'string')
    .map((relationship, index) => ({ relationship, index }))
    .sort((a, b) => (
      Math.abs(Number(b.relationship.affinity) || 0) - Math.abs(Number(a.relationship.affinity) || 0)
      || (Number(b.relationship.updatedAtTurn) || 0) - (Number(a.relationship.updatedAtTurn) || 0)
      || a.index - b.index
    ))
    .slice(0, MAX_RELATIONSHIP_TARGETS)
    .map((entry) => entry.relationship);
  for (const relationship of relationships) {
    const targetId = clip(relationship.id, 80);
    candidates.push({
      targetKind: 'relationship',
      targetId,
      label: `关系 ${nameOf(relationship.fromId)}→${nameOf(relationship.toId)}（好感 ${relationship.affinity}）`,
      source: 'relationship',
    });
  }

  // ongoing_hook：只取其原绑定目标仍合法的条目（旧档/手改档可能带脏 kind）。
  const hooks = asArray<RandomEventHistoryItemV2>(state?.randomEvent?.history)
    .filter((item) => item?.status === 'ongoing_hook' && isTargetKind(item.targetKind) && !!clip(item.targetId, 80))
    .slice(-MAX_HOOK_TARGETS);
  for (const hook of hooks) {
    const targetId = clip(hook.targetId, 80);
    candidates.push({
      targetKind: hook.targetKind,
      targetId,
      label: `旧钩子 ${clip(hook.id, 40)}：${clip(hook.summary, RANDOM_EVENT_SUMMARY_LIMIT)}`,
      source: 'ongoing_hook',
      hookEventId: clip(hook.id, 40),
    });
  }

  candidates.push({
    targetKind: 'reconvergence',
    targetId: RANDOM_EVENT_RECONVERGENCE_ID,
    label: '最终命运锚（nextMilestone / convergencePlan）',
    source: 'reconvergence',
  });

  return candidates;
}

export type RandomEventBindingValidationV2 =
  | { ok: true; binding: Omit<RandomEventBindingV2, 'plannedAtTurn'> }
  | { ok: false; reason: string };

/**
 * 校验规划模型提交的随机事件绑定。
 *
 * 合法条件：`targetKind` 在白名单内、`targetId` 非空且确实出现在候选目标里、`summary` 非空。
 * 不合法时返回可读原因，由引擎转成活动流警告 `random_event_binding_invalid`（只写 lastPlan，
 * 不写 activeBinding），避免把错误绑定带进调度状态。
 */
export function validateRandomEventBinding(
  raw: unknown,
  candidates: RandomEventBindingCandidateV2[],
): RandomEventBindingValidationV2 {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'randomEvent 不是对象，无法读取绑定字段' };
  }
  const record = raw as Record<string, unknown>;
  const rawKind = record.targetKind;
  if (!isTargetKind(rawKind)) {
    return { ok: false, reason: `targetKind「${clip(rawKind, 30) || '空'}」不在 beat|thread|relationship|reconvergence 内` };
  }
  const targetId = clip(record.targetId, 80);
  if (!targetId) return { ok: false, reason: '缺少 targetId' };
  const summary = clip(record.summary, RANDOM_EVENT_SUMMARY_LIMIT);
  if (!summary) return { ok: false, reason: '缺少 summary（随机事件必须写清要改变什么）' };
  const hit = asArray<RandomEventBindingCandidateV2>(candidates)
    .some((candidate) => candidate && candidate.targetKind === rawKind && candidate.targetId === targetId);
  if (!hit) {
    return { ok: false, reason: `targetId「${targetId}」不在 ${rawKind} 候选目标列表内` };
  }
  return { ok: true, binding: { targetKind: rawKind, targetId, summary } };
}

// ---------------------------------------------------------------------------
// 提示词文本（D7）
// ---------------------------------------------------------------------------

/** 三档强度的核心目的描述；三档都必须落到绑定目标上。 */
const INTENSITY_GOALS: Record<RandomEventIntensityV2, string> = {
  related: '插入一个与当前故事严格相关的小事件：必须让绑定目标出现可观察的变化（人物态度、关系张力、环境线索或故事节条件），不能是无关装饰。',
  progress: '事件必须推进绑定目标：推进某个 active/available 故事节、active 线程或主要关系，为原本卡住的条件创造自然契机，不能只是一次性插曲。',
  destiny: '事件必须服务于最终命运：推进核心故事节、为 reframed/跨幕挂账故事节找到新的实现形式，或把事件落到 reconvergence:destiny_main 上，为结尾条件创造自然契机。',
};

export interface RandomEventContextInputV2 {
  randomEvent: RandomEventStateV2;
  targets: RandomEventBindingCandidateV2[];
  /** 不传时退回 `randomEvent.history`。 */
  history?: RandomEventHistoryItemV2[];
  /** 推进权限：co_author 时额外标注"情境催化剂/可跳过"与冷却区间。 */
  autonomy?: StoryAutonomyV2;
}

/**
 * 生成注入 planner_pre / story 的 `【RANDOM_EVENT_CONTEXT】` 紧凑文本（≤400 字）。
 *
 * 内容：当前档位与到期状态、待兑现绑定、最近 3 条历史（id/回合/强度/目标/状态/摘要）、
 * 按类型分组的候选 targetId、可回收的旧钩子；co_author 档额外说明"情境催化剂"定位与冷却。
 * 超长时硬截断并补省略号。
 */
export function buildRandomEventContextBlock(input: RandomEventContextInputV2): string {
  const randomEvent = input.randomEvent;
  const targets = asArray<RandomEventBindingCandidateV2>(input.targets);
  const history = asArray<RandomEventHistoryItemV2>(input.history ?? randomEvent?.history).slice(-3);
  const lines: string[] = [RANDOM_EVENT_CONTEXT_HEADER];
  const intensity = randomEvent?.intensity ?? 'related';
  const nextText = randomEvent?.pending ? '上回合顺延，本回合待发生' : `第 ${randomEvent?.nextTriggerTurn ?? '?'} 回合到期`;
  lines.push(`- 档位：${intensity}｜${nextText}`);
  if (isCoAuthorAutonomy(input.autonomy)) {
    lines.push(`- 模式：灵魂共创·情境催化剂（冷却 ${CO_AUTHOR_RANDOM_EVENT_COOLDOWN_MIN}~${CO_AUTHOR_RANDOM_EVENT_COOLDOWN_MAX} 回合；没有自然契机时可 planned=false 跳过并自动顺延）`);
  }

  const binding = readRandomEventBinding(randomEvent?.activeBinding);
  if (binding) {
    lines.push(`- 待兑现绑定：${binding.targetKind}:${binding.targetId}「${clip(binding.summary, 40)}」（第 ${binding.plannedAtTurn} 回合规划）`);
  }

  if (history.length > 0) {
    lines.push('- 最近事件（旧→新）：');
    for (const item of history) {
      const outcome = item.outcomeNote ? `／${clip(item.outcomeNote, 20)}` : '';
      lines.push(`  · ${clip(item.id, 24)} T${item.turn} ${item.intensity}→${clip(item.targetKind, 20)}:${clip(item.targetId, 40)} ${clip(item.status, 20)}：${clip(item.summary, 30)}${outcome}`);
    }
  }

  // 候选按类型分组压缩：模型只需要拿到合法 id，不需要每条都带标签。
  const groups: string[] = [];
  for (const kind of RANDOM_EVENT_TARGET_KINDS) {
    const limit = kind === 'beat' ? 4 : kind === 'thread' ? 3 : kind === 'relationship' ? 2 : 1;
    const ids = targets
      .filter((target) => target.targetKind === kind && target.source !== 'ongoing_hook')
      .map((target) => target.targetId)
      .filter((id, index, list) => list.indexOf(id) === index)
      .slice(0, limit);
    if (ids.length > 0) groups.push(`${kind}：${ids.join('/')}`);
  }
  if (groups.length > 0) lines.push(`- 候选目标：${groups.join('；')}`);

  const hooks = targets.filter((target) => target.source === 'ongoing_hook' && target.hookEventId).slice(-2);
  if (hooks.length > 0) {
    lines.push(`- 可回收旧钩子：${hooks.map((hook) => `${hook.hookEventId}→${hook.targetKind}:${hook.targetId}`).join('；')}`);
  }

  const block = lines.join('\n');
  return block.length <= RANDOM_EVENT_CONTEXT_LIMIT ? block : `${block.slice(0, RANDOM_EVENT_CONTEXT_LIMIT - 1)}…`;
}

export interface RandomEventInstructionInputV2 {
  intensity: RandomEventIntensityV2;
  targets: RandomEventBindingCandidateV2[];
  history?: RandomEventHistoryItemV2[];
  /** 推进权限：co_author 时追加"情境催化剂/禁跨场景/可跳过"约束。 */
  autonomy?: StoryAutonomyV2;
  /**
   * 注入阶段：planner_pre 才需要看到"可 planned=false 跳过"的许可；
   * story 只按写前计划写正文，不参与跳过决策（保持"story 只看到 planned 计划"）。
   */
  phase?: 'planner_pre' | 'story';
}

/**
 * 生成三档随机事件指令（planner_pre 与 story 共用）。
 *
 * 与旧版最大的区别：三档都显式要求 `targetKind/targetId/summary` 绑定，严禁无绑定路人事件；
 * 并给出三态结算语义（慢/标准叙事可以只露苗头，记 ongoing_hook 留给后续回收）。
 *
 * `co_author` 档额外追加"情境催化剂"约束（T9）：禁止为补 pending beat 空投跨场景事件、
 * 允许绑定 relationship/thread/旧钩子而不强制绑 beat；planner_pre 还允许在玩家离场/独处/
 * 静场时 planned=false 主动跳过（调度顺延冷却窗口，不 pending 每回合重试）。
 */
export function buildRandomEventInstruction(input: RandomEventInstructionInputV2): string {
  const intensity: RandomEventIntensityV2 = input.intensity === 'progress' || input.intensity === 'destiny'
    ? input.intensity
    : 'related';
  const hooks = asArray<RandomEventHistoryItemV2>(input.history)
    .filter((item) => item?.status === 'ongoing_hook')
    .slice(-3);
  const recyclable = hooks.length > 0
    ? `可优先回收的旧钩子：${hooks.map((hook) => `${clip(hook.id, 24)}（${clip(hook.targetKind, 20)}:${clip(hook.targetId, 40)}）`).join('、')}；继续推进旧钩子优于另开无关新事件。`
    : '';
  const candidateHint = asArray<RandomEventBindingCandidateV2>(input.targets)
    .filter((target) => target.source !== 'ongoing_hook')
    .slice(0, 3)
    .map((target) => `${target.targetKind}:${target.targetId}`)
    .join('、');
  const bindingRule = '【绑定要求】randomEvent.planned 为 true 时必须同时输出 targetKind（beat|thread|relationship|reconvergence）、targetId（只能取自【RANDOM_EVENT_CONTEXT】的候选目标）与 summary（≤80字，写清要改变什么）；严禁无绑定的路人事件、纯氛围插曲和为凑事件而新增的无关角色。';
  const triStateRule = '【三态结算】慢叙事或标准叙事允许事件只露苗头、留待后续回收（结算记 ongoing_hook）；本回合完整兑现记 resolved；被玩家打断或正文没有真实发生则记 interrupted，调度顺延到下一回合。';
  const coAuthorRules = isCoAuthorAutonomy(input.autonomy)
    ? `【灵魂共创·情境催化剂】1. 事件只能从当前场景与在场人物、玩家刚制造的动静里自然长出来；严禁为了让不在当前场景的 pending 故事节推进而空投跨场景事件（换地图、宿舍舍友催饭、陌生路人搭讪等一律禁止）。2. 优先绑定 relationship/thread/旧钩子，不强制绑定 beat；只有当前场景可自然触及的 active/available 故事节才允许绑定。${input.phase === 'story' ? '' : `3. 可主动跳过：玩家离场/独处/静场/情绪余味收尾、或当前场景没有自然催化剂时，必须 randomEvent.planned=false 主动跳过；跳过不扣任何进度，调度会自动顺延 ${CO_AUTHOR_RANDOM_EVENT_COOLDOWN_MIN}~${CO_AUTHOR_RANDOM_EVENT_COOLDOWN_MAX} 回合，严禁硬塞事件。`}`
    : '';
  return `---额外---（随机事件 · ${intensity}档）：${INTENSITY_GOALS[intensity]}${candidateHint ? `本次候选目标示例：${candidateHint}。` : ''}${recyclable}${bindingRule}${triStateRule}${coAuthorRules}`;
}
