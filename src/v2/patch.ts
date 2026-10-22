import { normalizeChoices } from '@/lib/actions';
import { clamp, genId, textOrPrevious } from '@/lib/utils';
import { isCoAuthorAutonomy, pickRandomEventIntensity, pushRandomEventHistory, randomEventCooldownRange, randomEventCooldownTurns, readRandomEventBinding } from './randomEvents';
import type { CanonicalFactV2, CharacterV2, GameStateV2, InventoryEntryV2, PatchCategoryStatsV2, PatchStatsV2, PatchWarningV2, RandomEventHistoryItemV2, RandomEventResolutionV2, RandomEventStateV2, RelationshipV2, StoryBeatRuntimeV2, StoryBeatStatusV2, StoryThreadV2, TurnPatchV2 } from './types';

const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const oneOf = <T extends string>(v: unknown, values: readonly T[], fallback: T): T => values.includes(v as T) ? v as T : fallback;

/** 主角灵魂画像上限（字符）；与 store / engine 的截断保持一致。 */
const SOUL_PROFILE_LIMIT = 120;
/**
 * 灵魂画像清洗：压成单行、去首尾空白、截断 120 字。
 *
 * 非字符串一律视为"未提交"（空串）；空串表示本轮没有变化，不覆盖旧画像。
 * 压成单行是为了让 `【SOUL_PROFILE】` 只占提示词一行，不会被模型写出的换行截断。
 */
const cleanSoulProfile = (v: unknown): string => (
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, SOUL_PROFILE_LIMIT) : ''
);

/** 清洗并去重字符串数组（去空、去重、限量）。新增与合并两条分支共用，避免规则漂移。 */
const cleanList = (raw: unknown, max: number, limit: number): string[] => Array.from(new Set(
  (Array.isArray(raw) ? raw : []).map((x) => text(x, max)).filter(Boolean),
)).slice(0, limit);

/**
 * 枚举字段的白名单取值；表外取值会被静默改写，因此这里同时记录一条警告，
 * 让"模型写了中文枚举/自造同义词"这类问题在活动流里可见，而不是悄悄变成默认值。
 * `onCoerce` 用于把改写次数计入对账统计。
 */
function oneOfChecked<T extends string>(
  raw: unknown,
  values: readonly T[],
  fallback: T,
  ctx: { warnings: PatchWarningV2[]; path: string; label: string; onCoerce?: () => void },
): T {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (values.includes(raw as T)) return raw as T;
  ctx.onCoerce?.();
  ctx.warnings.push({
    code: 'enum_value_coerced',
    path: ctx.path,
    message: `${ctx.label} 收到白名单外的取值「${String(raw).slice(0, 30)}」，已按 ${fallback} 处理；枚举必须使用模板中列出的英文取值。`,
  });
  return fallback;
}

// Canonical facts form a compact cross-turn consistency index, not a transcript.
const MAX_CANONICAL_FACTS = 160;
const MAX_CANONICAL_FACTS_PER_TURN = 10;

/**
 * 提交一回合的状态增量。
 *
 * @param warnings 可选输出数组：提交阶段对模型输出做的修正（例如 superseded 缺少
 *   有效替代者时降级为 reframed）会被追加到这里，供活动流与排障使用。
 *   不传时行为与之前完全一致（只返回新状态）。
 */
/** 把补丁里的数组字段安全地转成对象数组（非对象元素直接排除）。 */
function rowsOf(value: unknown): Array<Record<string, unknown>> {
  return (Array.isArray(value) ? value : []).filter(record);
}

/**
 * 按逐条判定函数对账一个类别。
 *
 * `landed` 回答的是"这一条提交有没有真的落到权威状态上"，判定必须对应各类别的
 * 实际落地条件：更新到已有条目算落地，关系/库存按既有条目合并也算落地，
 * 只有"整条被丢弃"（缺必填字段、引用不存在、重复新建被并掉等）才计入 blocked。
 *
 * 这里刻意不做"算差值"这种取巧统计：差分会把"更新已有条目"误判成丢弃。
 */
function countCategory(
  rows: Array<Record<string, unknown>>,
  isValid: (row: Record<string, unknown>) => boolean,
  landed: (row: Record<string, unknown>) => boolean,
): PatchCategoryStatsV2 {
  const valid = rows.filter(isValid);
  const applied = valid.filter(landed).length;
  const malformed = rows.length - valid.length;
  return { input: rows.length, applied, blocked: rows.length - applied, malformed };
}

/** 空的对账统计；调用方传入它来开启统计收集（默认不收集，避免给现有调用方增加噪音）。 */
export function emptyPatchStatsV2(): PatchStatsV2 {
  const empty = (): PatchCategoryStatsV2 => ({ input: 0, applied: 0, blocked: 0, malformed: 0 });
  return { characters: empty(), relationships: empty(), inventory: empty(), threads: empty(), facts: empty(), coercedEnums: 0 };
}

/**
 * 提交阶段从引擎传入的随机事件局部信号（T9 / co_author）。
 *
 * 不进入 Patch 协议：`planned=false` 是 planner_pre 的写前意图，而 patch.ts 只拿得到
 * planner_post 的 Patch，因此由 engine 在调用提交时把它作为独立信号传入。
 * 只有 co_author 档会消费 `randomEventSkipped`；其它档忽略（行为完全不变）。
 */
export interface RandomEventCommitSignalV2 {
  /** planner_pre 明确输出 `randomEvent.planned=false`，主动跳过本轮到期的随机事件。 */
  randomEventSkipped?: boolean;
}

export function commitTurnPatchV2(
  state: GameStateV2,
  patch: TurnPatchV2,
  warnings: PatchWarningV2[] = [],
  stats?: PatchStatsV2,
  randomEventSignal?: RandomEventCommitSignalV2,
): GameStateV2 {
  if (patch.schemaVersion !== 2) throw new Error('不支持的状态 Patch 版本');
  if (patch.baseRevision !== state.revision) throw new Error('状态已变化，请重新结算');
  if (patch.turn !== state.turn) throw new Error('Patch 回合不匹配');
  if (patch.commitId && patch.commitId === state.lastCommitId) return state;

  // 原始条数与落地条数的对账。计数不参与任何校验决策，只用于观察"模型提交了多少、
  // 程序接受了多少"；因此即使统计有偏差也不会影响状态正确性。
  const rawRows = {
    characters: rowsOf(patch.characters),
    relationships: rowsOf(patch.relationships),
    inventory: rowsOf(patch.inventory),
    threads: rowsOf(patch.threads),
    facts: rowsOf(patch.facts),
  };
  let coercedEnums = 0;

  const characterStatuses = ['active', 'absent', 'missing', 'dead', 'unknown'] as const;
  const beforeCharacterIds = new Set(state.characters.map((item) => item.id));
  const characters = state.characters.map((x) => ({ ...x, aliases: [...x.aliases], knownFacts: [...x.knownFacts] }));
  for (const rawRow of Array.isArray(patch.characters) ? patch.characters : []) {
    if (!record(rawRow)) continue;
    const row = rawRow as NonNullable<TurnPatchV2['characters']>[number];
    const rowId = text(row.id, 80);
    if (row.op === 'create') {
      const name = text(row.name, 30);
      if (!name) {
        warnings.push({
          code: 'character_create_without_name',
          path: `characters[${rowId || '?'}]`,
          message: `人物 create 缺少 name，已整条忽略${rowId ? `（id=${rowId}）` : ''}；新建人物必须给出 name。`,
        });
        continue;
      }
      const id = rowId || genId('char');
      const duplicate = characters.find((x) => x.id === id || x.name === name || x.aliases.includes(name));
      if (duplicate) {
        duplicate.aliases = cleanList([...duplicate.aliases, ...(Array.isArray(row.aliases) ? row.aliases : [])], 30, 8);
        duplicate.knownFacts = Array.from(new Set([...duplicate.knownFacts, ...cleanList(row.addFacts, 100, 20)])).slice(-20);
        duplicate.lastSeenTurn = state.turn;
        continue;
      }
      characters.push({
        id,
        name,
        aliases: cleanList(row.aliases, 30, 8),
        role: text(row.role, 40) || undefined,
        description: text(row.description, 240) || undefined,
        status: oneOfChecked(row.status, characterStatuses, 'active', { warnings, path: `characters[${id}].status`, label: `人物 ${name} 的 status`, onCoerce: () => { coercedEnums += 1; } }),
        knownFacts: cleanList(row.addFacts, 100, 12),
        firstSeenTurn: state.turn,
        lastSeenTurn: state.turn,
      });
    } else {
      const target = characters.find((x) => x.id === row.id); if (!target) continue;
      if (Array.isArray(row.aliases)) {
        target.aliases = cleanList([...target.aliases, ...row.aliases], 30, 8);
      }
      if (row.name) target.name = text(row.name, 30);
      if (row.role !== undefined) target.role = text(row.role, 40) || undefined;
      if (row.description !== undefined) target.description = text(row.description, 240) || undefined;
      if (row.status) {
        target.status = oneOfChecked(row.status, characterStatuses, target.status, { warnings, path: `characters[${target.id}].status`, label: `人物 ${target.name} 的 status`, onCoerce: () => { coercedEnums += 1; } });
      }
      target.knownFacts = Array.from(new Set([...target.knownFacts, ...cleanList(row.addFacts, 100, 20)])).slice(-20);
      target.lastSeenTurn = state.turn;
    }
  }

  const beforeRelationshipIds = new Set(state.relationships.map((item) => item.id));
  const relationships: RelationshipV2[] = state.relationships.map((x) => ({ ...x }));
  for (const rawRow of Array.isArray(patch.relationships) ? patch.relationships : []) {
    if (!record(rawRow)) continue;
    const row = rawRow as NonNullable<TurnPatchV2['relationships']>[number];
    if (!text(row.reason, 200) || !text(row.fromId, 80) || !text(row.toId, 80)) continue;
    if (row.fromId === row.toId) continue;
    if (!characters.some((x) => x.id === row.toId)) continue;
    if (row.fromId !== 'player' && !characters.some((x) => x.id === row.fromId)) continue;
    let rel = relationships.find((x) => x.fromId === row.fromId && x.toId === row.toId);
    if (!rel) { rel = { id: genId('rel'), fromId: row.fromId, toId: row.toId, affinity: 0, updatedAtTurn: state.turn }; relationships.push(rel); }
    rel.affinity = clamp(rel.affinity + clamp(Math.round(row.affinityDelta ?? 0), -20, 20), -100, 100);
    if (row.label !== undefined) rel.label = text(row.label, 30) || undefined;
    if (row.note !== undefined) rel.note = text(row.note, 160) || undefined;
    rel.updatedAtTurn = state.turn;
  }

  const inventoryKinds = ['item', 'ability', 'quest_item'] as const;
  const beforeInventoryIds = new Set(state.inventory.map((item) => item.id));
  const inventory: InventoryEntryV2[] = state.inventory.map((x) => ({ ...x }));
  for (const rawRow of Array.isArray(patch.inventory) ? patch.inventory : []) {
    if (!record(rawRow)) continue;
    const row = rawRow as NonNullable<TurnPatchV2['inventory']>[number];
    if (!text(row.reason, 200)) continue;
    let item = row.id ? inventory.find((x) => x.id === row.id) : inventory.find((x) => x.name === row.name);
    // 数量按模型给的值严格执行（缺失时为 1），不再用 Math.max(1,…) 兜底：
    // 模型写 0 就是"这次不增加"，写负数就是"减少这么多"。库存被减到 0 或以下时
    // 会在提交前按"数量 > 0"过滤掉，因此不会留下数量为 0 的幽灵条目。
    const requestedQuantity = row.quantity === undefined ? 1 : Math.round(Number(row.quantity) || 0);
    if (row.op === 'grant') {
      if (item) {
        item.quantity += requestedQuantity;
      } else if (row.name && requestedQuantity > 0) {
        // 新物品：给 0 或负数是模型表达"这次没获得"，不创建条目。
        inventory.push({
          id: text(row.id, 80) || genId('item'),
          name: text(row.name, 40),
          kind: oneOfChecked(row.kind, inventoryKinds, 'item', { warnings, path: `inventory[${text(row.id, 80) || text(row.name, 40)}].kind`, label: `物品「${text(row.name, 40)}」的 kind`, onCoerce: () => { coercedEnums += 1; } }),
          description: text(row.description, 240),
          quantity: requestedQuantity,
          consumable: !!row.consumable,
          acquiredAtTurn: state.turn,
          updatedAtTurn: state.turn,
        });
      }
    } else if (item && row.op === 'consume') {
      item.quantity -= Math.max(0, requestedQuantity);
    }
    else if (item && row.op === 'remove') item.quantity = 0;
    else if (item && row.op === 'update') {
      if (row.description !== undefined) item.description = text(row.description, 240);
      if (row.kind) item.kind = oneOfChecked(row.kind, inventoryKinds, item.kind, { warnings, path: `inventory[${item.id}].kind`, label: `物品「${item.name}」的 kind`, onCoerce: () => { coercedEnums += 1; } });
      if (row.consumable !== undefined) item.consumable = !!row.consumable;
    }
    if (item) item.updatedAtTurn = state.turn;
  }

  const threadKinds = ['main', 'relationship', 'quest', 'hook'] as const;
  const threadStatuses = ['candidate', 'active', 'completed', 'failed', 'cancelled'] as const;
  const beforeThreadIds = new Set(state.storyThreads.map((item) => item.id));
  const threads: StoryThreadV2[] = state.storyThreads.map((x) => ({ ...x, involvedCharacterIds: [...x.involvedCharacterIds] }));
  for (const rawRow of Array.isArray(patch.threads) ? patch.threads : []) {
    if (!record(rawRow)) continue;
    const row = rawRow as NonNullable<TurnPatchV2['threads']>[number];
    if (row.op === 'create' && !text(row.title, 80)) {
      // create 缺 title 时不能退化成"按 id 改已有线程"——那是完全不同的语义，
      // 会让一次失误的 create 悄悄覆盖已有线程，且不校验 reason。
      warnings.push({
        code: 'thread_create_without_title',
        path: `threads[${text(row.id, 80) || '?'}]`,
        message: `故事线程 create 缺少 title，已整条忽略${text(row.id, 80) ? `（id=${text(row.id, 80)}）` : ''}；若想更新已有线程请使用 op:"update"。`,
      });
      continue;
    }
    if (row.op === 'create' && row.title) {
      const id = text(row.id, 80) || genId('thread');
      const duplicate = threads.find((x) => x.id === id || x.title === text(row.title, 80));
      if (duplicate) { duplicate.updatedAtTurn = state.turn; continue; }
      threads.push({ id, title: text(row.title, 80), kind: oneOfChecked(row.kind, threadKinds, 'hook', { warnings, path: `threads[${id}].kind`, label: `线程「${text(row.title, 80)}」的 kind`, onCoerce: () => { coercedEnums += 1; } }), status: oneOfChecked(row.status, threadStatuses, 'candidate', { warnings, path: `threads[${id}].status`, label: `线程「${text(row.title, 80)}」的 status`, onCoerce: () => { coercedEnums += 1; } }), progress: row.progress === undefined ? undefined : clamp(Number(row.progress) || 0, 0, 100), currentStep: text(row.currentStep, 160) || undefined, involvedCharacterIds: cleanList(row.involvedCharacterIds, 80, 50), note: text(row.note, 200) || undefined, updatedAtTurn: state.turn });
    }
    else {
      const target = threads.find((x) => x.id === row.id);
      if (!target) continue;
      if (row.kind) target.kind = oneOfChecked(row.kind, threadKinds, target.kind, { warnings, path: `threads[${target.id}].kind`, label: `线程「${target.title}」的 kind`, onCoerce: () => { coercedEnums += 1; } });
      if (Array.isArray(row.involvedCharacterIds)) {
        target.involvedCharacterIds = cleanList(row.involvedCharacterIds, 80, 50);
      }
      if (row.status) target.status = oneOfChecked(row.status, threadStatuses, target.status, { warnings, path: `threads[${target.id}].status`, label: `线程「${target.title}」的 status`, onCoerce: () => { coercedEnums += 1; } });
      if (row.progress !== undefined) target.progress = clamp(Number(row.progress) || 0, 0, 100);
      if (row.currentStep !== undefined) target.currentStep = text(row.currentStep, 160) || undefined;
      if (row.note !== undefined) target.note = text(row.note, 200) || undefined;
      target.updatedAtTurn = state.turn;
    }
  }

  // Temporary facts belong in prose/history. Discard old temporary rows and
  // cap additions so verbose planners cannot grow the canonical index forever.
  const persistedFacts = (state.facts ?? []).filter((x) => x.stability !== 'temporary');
  const coreFacts = persistedFacts.filter((x) => x.stability === 'core').slice(0, MAX_CANONICAL_FACTS);
  const stableFacts = persistedFacts.filter((x) => x.stability !== 'core');
  const facts: CanonicalFactV2[] = [...coreFacts, ...stableFacts.slice(-Math.max(0, MAX_CANONICAL_FACTS - coreFacts.length))]
    .map((x) => ({ ...x, keywords: [...x.keywords] }));
  const factRows = (Array.isArray(patch.facts) ? patch.facts : [])
    .filter((row) => record(row))
    .slice(0, MAX_CANONICAL_FACTS_PER_TURN);
  for (const rawRow of factRows) {
    if (!record(rawRow)) continue;
    const row = rawRow as NonNullable<TurnPatchV2['facts']>[number];
    const subjectId = text(row.subjectId, 80), predicate = text(row.predicate, 80), value = text(row.value, 300);
    if (!subjectId || !predicate || !value || row.stability === 'temporary' || row.confidence === 'inferred' || !text(row.evidenceQuote, 300)) continue;
    const existing = facts.find((x) => x.subjectId === subjectId && x.predicate === predicate && x.stability !== 'temporary');
    if (existing && existing.value !== value) {
      if (existing.stability === 'core') continue;
      if (row.op !== 'replace' || !text(row.reason, 200) || !text(row.evidenceQuote, 300)) continue;
      existing.value = value; existing.updatedAtTurn = state.turn; existing.evidenceTurn = state.turn; existing.evidenceQuote = text(row.evidenceQuote, 300);
      continue;
    }
    if (!existing && facts.length < MAX_CANONICAL_FACTS) facts.push({ id: text(row.id, 80) || genId('fact'), subjectId, predicate, value, scope: oneOf(row.scope, ['character', 'relationship', 'location', 'world', 'schedule', 'identity', 'custom'] as const, 'custom'), stability: oneOf(row.stability, ['core', 'stable'] as const, 'stable'), confidence: 'explicit', keywords: Array.from(new Set([subjectId, predicate, ...(Array.isArray(row.keywords) ? row.keywords : [])].map((x) => text(x, 40)).filter(Boolean))).slice(0, 12), evidenceTurn: state.turn, evidenceQuote: text(row.evidenceQuote, 300) || undefined, createdAtTurn: state.turn, updatedAtTurn: state.turn });
  }

  const destiny = { ...state.destiny, beats: state.destiny.beats.map((x) => ({ ...x, evidenceTurns: [...x.evidenceTurns] })) };
  // 程序权威的当前幕：模型自报的 currentActId 只是"提议"，不能直接写入权威状态。
  const authoritativeActId = text(state.destiny.currentActId, 80);
  // reason用于解释与审计，不是命运Patch的事务开关。即使供应商漏掉一个
  // 说明字段，也必须逐项提交其余合法状态，不能静默丢弃整个命运更新。
  if (record(patch.destiny)) {
    if (patch.destiny.completionEstimate !== undefined) destiny.completionEstimate = clamp(Number(patch.destiny.completionEstimate) || 0, 0, 100);
    if (patch.destiny.completionReason !== undefined) destiny.completionReason = text(patch.destiny.completionReason, 400) || destiny.completionReason;
    if (patch.destiny.currentStage !== undefined) destiny.currentStage = text(patch.destiny.currentStage, 80) || destiny.currentStage;
    if (patch.destiny.currentPath !== undefined) destiny.currentPath = text(patch.destiny.currentPath, 240) || destiny.currentPath;
    if (patch.destiny.nextMilestone !== undefined) destiny.nextMilestone = text(patch.destiny.nextMilestone, 200) || undefined;
    if (patch.destiny.convergencePlan !== undefined) destiny.convergencePlan = text(patch.destiny.convergencePlan, 300) || undefined;
    for (const rawChange of Array.isArray(patch.destiny.beatChanges) ? patch.destiny.beatChanges : []) {
      if (!record(rawChange)) continue;
      const change = rawChange as NonNullable<NonNullable<TurnPatchV2['destiny']>['beatChanges']>[number];
      const beat = destiny.beats.find((x) => x.beatId === text(change.beatId, 80));
      if (!beat) continue;
      let requestedStatus = oneOf(change.status, ['pending', 'available', 'active', 'satisfied', 'weakened', 'reframed', 'superseded'] as const, beat.status);
      const evidenceQuote = text(change.evidenceQuote, 300);
      // The model may only satisfy a beat when the submitted prose contains
      // direct evidence that its narrative purpose was realised.
      if (requestedStatus === 'satisfied' && !evidenceQuote) continue;
      if (requestedStatus === 'superseded' && !evidenceQuote) continue;
      if (requestedStatus === 'superseded') {
        const replacementId = text(change.replacementBeatId, 80);
        const replacement = replacementId ? destiny.beats.find((x) => x.beatId === replacementId) : undefined;
        if (!replacement) {
          // superseded 的含义是"该故事节由另一个等价的节承担"。没有真实存在的替代者时，
          // 保留 superseded 会产生两种危害：结局判定把它算作已完成（虚增完成度、可能提前
          // 触发结尾），而替代者永远不存在。降级为"路线改写"既不丢剧情推进，也不放宽结局。
          // 不整条丢弃的原因：模型很可能重复提交同一个无效替代者，整条丢弃会让该节永远
          // 无法被标记，反而把故事卡住。
          requestedStatus = 'reframed';
          warnings.push({
            code: 'superseded_replacement_missing',
            path: `destiny.beatChanges[${String(change.beatId ?? 'unknown')}].replacementBeatId`,
            message: replacementId
              ? `故事节 ${String(change.beatId)} 的替代者 ${replacementId} 不在大纲中，已按 reframed（路线改写）记录；请改用 reframed 并说明新的实现方式。`
              : `故事节 ${String(change.beatId)} 声明 superseded 但未给出有效的 replacementBeatId，已按 reframed（路线改写）记录。`,
          });
        }
      }
      // Do not silently reopen an achieved story function. Later prose can
      // weaken or reframe it, but must provide direct evidence for that change.
      if (beat.status === 'satisfied' && ['pending', 'available', 'active'].includes(requestedStatus)) continue;
      if (beat.status === 'satisfied' && ['weakened', 'reframed'].includes(requestedStatus) && !evidenceQuote) continue;
      beat.status = requestedStatus;
      if (change.currentPlan !== undefined) beat.currentPlan = text(change.currentPlan, 300) || undefined;
      if (change.evidenceSummary !== undefined) beat.evidenceSummary = text(change.evidenceSummary, 300) || undefined;
      if (change.replacementBeatId !== undefined && destiny.beats.some((x) => x.beatId === change.replacementBeatId)) beat.replacementBeatId = change.replacementBeatId;
      if (evidenceQuote && !beat.evidenceTurns.includes(state.turn)) beat.evidenceTurns.push(state.turn);
      beat.updatedAtTurn = state.turn;
    }
    // 清理历史坏数据：早期版本允许"没有替代者的 superseded"落库，而这些节不应
    // 被结局判定算作已完成。这里把它们降回 reframed，让模型重新给出实现方式。
    for (const beat of destiny.beats) {
      if (beat.status === 'superseded' && !destiny.beats.some((x) => x.beatId === beat.replacementBeatId)) {
        beat.status = 'reframed';
        warnings.push({
          code: 'superseded_replacement_dangling',
          path: `destiny.beats[${beat.beatId}]`,
          message: `故事节 ${beat.beatId} 曾被标记为 superseded，但其替代者不存在，已按 reframed 重新计入待完成。`,
        });
      }
    }

    // ---- 程序权威幕状态机（在故事节更新之后、结局判定之前） ----
    // 模型提交的 currentActId 只有与程序当前幕完全一致时才接受（此时也无需写入）；
    // 未知 / 跳幕 / 倒退一律忽略并留下可观察警告。幕推进只由故事节完成情况决定。
    const proposedActId = patch.destiny.currentActId === undefined ? '' : text(patch.destiny.currentActId, 80);
    if (proposedActId && proposedActId !== authoritativeActId) {
      warnings.push({
        code: 'act_current_id_rejected',
        path: 'destiny.currentActId',
        message: `模型提交的当前幕「${proposedActId.slice(0, 30)}」与程序权威当前幕「${authoritativeActId || '未知'}」不一致，已忽略；幕推进只由故事节完成情况决定。`,
      });
    }

    const isTerminalBeat = (status: StoryBeatStatusV2) => status === 'satisfied' || status === 'superseded';
    // 幕顺序从故事节的 actId 首现顺序推导：commitTurnPatchV2 的入参只有 state（没有 outline），
    // 而故事节是按大纲幕顺序扁平化创建的，因此"首次出现顺序"就是幕顺序。
    const actOrder = Array.from(new Set(destiny.beats.map((beat) => text(beat.actId, 80)).filter(Boolean)));
    // 旧存档/直接调用方可能没有 actId（真实运行链路里 hydrate 已按 outline 反查补齐）：
    // 视为属于当前幕，而不是把它们排除在"本幕进度"之外。
    const beatActId = (beat: StoryBeatRuntimeV2) => text(beat.actId, 80) || authoritativeActId;
    const nativeBeats = destiny.beats.filter((beat) => beatActId(beat) === authoritativeActId);
    const terminalCount = nativeBeats.filter((beat) => isTerminalBeat(beat.status)).length;
    const nonTerminalBeats = nativeBeats.filter((beat) => !isTerminalBeat(beat.status));
    const storedActIndex = typeof destiny.currentActIndex === 'number' && destiny.currentActIndex >= 0 ? destiny.currentActIndex : -1;
    // 优先用存档里的 currentActIndex（由 hydrate 按大纲同步过），但它必须与 actOrder 对得上，
    // 否则说明故事节里没有该幕的信息，退回按 actId 查找。
    const currentActPosition = storedActIndex >= 0 && actOrder[storedActIndex] === authoritativeActId
      ? storedActIndex
      : actOrder.indexOf(authoritativeActId);
    const nextActId = currentActPosition >= 0 ? actOrder[currentActPosition + 1] : undefined;
    // 同步 currentActIndex（旧档可能还没有这个字段）；推导不出时保留原值，绝不乱造幕序号。
    destiny.currentActIndex = currentActPosition >= 0 ? currentActPosition : Math.max(0, storedActIndex);
    if (!Array.isArray(destiny.actHistory)) destiny.actHistory = [];
    const previousActEntry = destiny.actHistory[destiny.actHistory.length - 1];

    /**
     * 退出当前幕后追加的幕历史。
     *
     * `enteredTurn` 取上一幕记录的 exitedTurn（第一幕从 0 开始）：程序不伪造历史，
     * 但切幕是程序自己做的，因此这里补的回合数字都是真实发生过的。
     */
    const buildActHistoryEntry = (actId: string, exitSummary: string | undefined, carriedBeatIds?: string[]) => ({
      actId,
      enteredTurn: typeof previousActEntry?.exitedTurn === 'number' ? previousActEntry.exitedTurn : 0,
      exitedTurn: state.turn,
      ...(exitSummary ? { exitSummary } : {}),
      ...(carriedBeatIds?.length ? { carriedBeatIds } : {}),
    });
    const advanceAct = (nextId: string, exitSummary: string | undefined, carriedBeatIds?: string[]) => {
      destiny.actHistory = [...destiny.actHistory, buildActHistoryEntry(authoritativeActId, exitSummary, carriedBeatIds)];
      destiny.currentActId = nextId;
      destiny.currentActIndex = currentActPosition + 1;
      // 旧实现直接清空阶段文本，导致切幕后 1~2 回合 UI 与幕窗口没有阶段描述
      // （20 回合真实长局里 T5/T6/T12 复现）。这里给一个诚实的程序侧兜底：
      // 新幕刚开篇，等模型下一轮写出具体阶段后再覆盖。
      destiny.currentStage = '本幕开篇';
      destiny.lastActTransitionTurn = state.turn;
    };
    const currentActAllTerminal = nativeBeats.length > 0 && nonTerminalBeats.length === 0;
    if (nextActId && currentActAllTerminal) {
      // 常规轨：本幕原生故事节全部进入终态，自动进入下一幕。
      // 最后一幕不在这里推进——交给下面的结局判定收尾。
      const exitSummary = text(patch.roundSummary, 150) || text(state.summary, 150) || undefined;
      advanceAct(nextActId, exitSummary);
    } else if (patch.destiny.actTransition?.proposeNextAct === true) {
      // 改道轨：玩家把路线改到本幕无法完成某些故事节时，允许模型提议"携节跨幕"（挂账）。
      // 只处理当前幕的原生故事节；更早幕带进来的挂账节不参与本幕比例，但仍受结局门槛约束。
      const ratio = nativeBeats.length > 0 ? terminalCount / nativeBeats.length : 0;
      const ratioOk = terminalCount >= 1 && ratio >= 0.5;
      const planOk = nonTerminalBeats.every((beat) => (beat.status === 'reframed' || beat.status === 'weakened') && !!text(beat.currentPlan, 300));
      const carryLimitOk = nonTerminalBeats.length <= 2;
      if (!nextActId) {
        warnings.push({
          code: 'act_transition_rejected',
          path: 'destiny.actTransition.proposeNextAct',
          message: '模型提议进入下一幕，但程序无法确定下一幕（当前已是可推导的最后一幕，或存档缺少幕信息），已保持当前幕。',
        });
      } else if (ratioOk && planOk && carryLimitOk) {
        // actId 保持不可变：挂账只写 carriedFromActId（已有则保留最早的原属幕），
        // 故事节仍是非终态，绝不放宽结局门槛。
        for (const beat of nonTerminalBeats) {
          if (!text(beat.carriedFromActId, 80)) beat.carriedFromActId = authoritativeActId;
        }
        const exitSummary = text(patch.destiny.actTransition.actExitSummary, 150) || text(patch.roundSummary, 150) || text(state.summary, 150) || undefined;
        advanceAct(nextActId, exitSummary, nonTerminalBeats.map((beat) => beat.beatId));
      } else {
        warnings.push({
          code: 'act_transition_rejected',
          path: 'destiny.actTransition.proposeNextAct',
          message: `模型提议进入下一幕，但未满足跨幕挂账条件：本幕原生故事节 ${nativeBeats.length} 条，终态 ${terminalCount} 条（需 ≥1 条且占比 ≥50%）；非终态 ${nonTerminalBeats.length} 条（需 ≤2 条，且全部为 reframed/weakened 并写明 currentPlan：${planOk ? '满足' : '不满足'}）。已保持当前幕。`,
        });
      }
    }

    const allCoreBeatsSatisfied = destiny.beats.length > 0 && destiny.beats.every((x) => x.status === 'satisfied' || x.status === 'superseded');
    if (patch.destiny.endingReached === true && destiny.completionEstimate >= 100 && allCoreBeatsSatisfied && !destiny.endingReached) {
      destiny.endingReached = true;
      destiny.endingReachedAtTurn = state.turn;
    }
    destiny.updatedAtTurn = state.turn;
  }

  // ---- 对账统计：模型提交了多少条、真正落地多少条、被整条丢弃多少条 ----
  // 只做观察，不参与任何准入判断。目的是让"程序静默丢弃/改写模型输出"这件事可度量，
  // 从而判断是否值得把被拒情况回显给模型（见 docs/planner-multiround-evaluation.md）。
  if (stats) {
    const nameOf = (row: Record<string, unknown>) => text(row.name, 30);
    const characterById = (id: unknown) => characters.find((item) => item.id === text(id, 80));
    stats.characters = countCategory(
      rawRows.characters,
      // 结构完整性：模型是否把必填字段写全了（create 需要 name、update 需要 id）。
      (row) => row.op === 'create' ? !!nameOf(row) : !!text(row.id, 80),
      // 落地：create 真正新建了人物（撞名被合并算未落地，等于模型这次没生效）；
      //       update 必须找到目标才算落地（id 不存在就是被丢弃）。
      (row) => row.op === 'create'
        ? characters.some((item) => item.id === text(row.id, 80) && !beforeCharacterIds.has(item.id))
        : !!characterById(row.id),
    );
    stats.relationships = countCategory(
      rawRows.relationships,
      // 结构完整性：fromId / toId / reason 三个必填字段。
      (row) => !!text(row.fromId, 80) && !!text(row.toId, 80) && !!text(row.reason, 200),
      // 落地：自环、目标人物不存在、fromId 既不是 player 也不存在 —— 都会被丢弃。
      (row) => text(row.fromId, 80) !== text(row.toId, 80)
        && characters.some((item) => item.id === row.toId)
        && (row.fromId === 'player' || characters.some((item) => item.id === row.fromId)),
    );
    stats.inventory = countCategory(
      rawRows.inventory,
      (row) => !!text(row.reason, 200),
      // 落到某个物品上即算落地；其中"扣减到 0 被过滤掉"也算落地（变更确实生效了）。
      (row) => [inventory, inventory.filter((item) => item.quantity > 0)]
        .some((list) => list.some((item) => (row.id ? item.id === row.id : item.name === text(row.name, 40)))),
    );
    stats.threads = countCategory(
      rawRows.threads,
      (row) => row.op === 'create' ? !!text(row.title, 80) : !!text(row.id, 80),
      (row) => row.op === 'create'
        ? threads.some((item) => item.id === text(row.id, 80) && !beforeThreadIds.has(item.id))
        : !!threads.find((item) => item.id === text(row.id, 80)),
    );
    // 事实：新建使数组增长即落地；同 subject+predicate 的 replace 也算落地。
    const addedFacts = Math.max(0, facts.length - state.facts.length);
    const replacedFacts = rawRows.facts.filter((row) => row.op === 'replace' && !!text(row.reason, 200)).length;
    stats.facts = { input: rawRows.facts.length, applied: addedFacts + replacedFacts, blocked: 0, malformed: 0 };
    stats.facts.blocked = Math.max(0, stats.facts.input - stats.facts.applied);
    stats.coercedEnums = coercedEnums;
    const blockedTotal = stats.characters.blocked + stats.relationships.blocked + stats.inventory.blocked + stats.threads.blocked + stats.facts.blocked;
    if (blockedTotal > 0) {
      warnings.push({
        code: 'patch_items_blocked',
        path: '$',
        message: `本回合有 ${blockedTotal} 条状态变更未通过程序校验被丢弃（人物 ${stats.characters.blocked} · 关系 ${stats.relationships.blocked} · 库存 ${stats.inventory.blocked} · 线程 ${stats.threads.blocked} · 事实 ${stats.facts.blocked}），另有 ${coercedEnums} 处枚举被改写。`,
      });
    }
  }

  const randomEventEnabled = state.randomEvent.enabled !== false;
  const dueRandomEvent = randomEventEnabled && (state.randomEvent.pending || state.turn >= state.randomEvent.nextTriggerTurn);
  const randomEventNote = text(patch.randomEvent?.note, 500) || undefined;
  // 冷却区间（T9）：co_author 收在 3~5 回合；standard/free/strict 保持存档原区间（缺省 3~6），
  // 从而保证非灵魂共创档的调度行为逐字节不变。
  const randomEventCooldown = randomEventCooldownRange({
    autonomy: state.storyAutonomy,
    triggerIntervalMin: state.randomEvent.triggerIntervalMin,
    triggerIntervalMax: state.randomEvent.triggerIntervalMax,
  });
  const coAuthorRandomEvent = isCoAuthorAutonomy(state.storyAutonomy);
  // co_author 明确跳过：只有"到期 + planner_pre 明确 planned=false"才算主动跳过；
  // 非灵魂共创档忽略该信号（旧行为不变）。
  const randomEventSkipped = dueRandomEvent && coAuthorRandomEvent && randomEventSignal?.randomEventSkipped === true;
  let randomEvent: RandomEventStateV2 = { ...state.randomEvent };
  // lastNote 是纯审计文本（前端"故事脉动"卡片显示为「随机事件结果」），它不参与
  // 事件调度。此前只在"事件到期"分支里记录，于是模型在未到期回合给出的说明会被
  // 无声丢弃。这里所有分支都记录，调度字段（pending / nextTriggerTurn / intensity）
  // 仍然只在到期时改动。
  if (randomEventNote) randomEvent.lastNote = randomEventNote;
  if (dueRandomEvent) {
    // 三态闭环（D7）：resolved=完整兑现、ongoing_hook=已起头留钩子、interrupted=被玩家打断未发生。
    // handled 为旧协议字段，缺 resolution 时按"发生了"处理（向后兼容）；两者冲突时以 interrupted 为准，
    // 因为只有它明确表示"正文里没有真实发生"，不应该清空绑定或重排长间隔。
    const rawResolution = patch.randomEvent?.resolution;
    const resolution: RandomEventResolutionV2 | undefined =
      rawResolution === 'resolved' || rawResolution === 'ongoing_hook' || rawResolution === 'interrupted'
        ? rawResolution
        : undefined;
    const interrupted = resolution === 'interrupted';
    const occurred = !interrupted && (patch.randomEvent?.handled === true || resolution === 'resolved' || resolution === 'ongoing_hook');
    const binding = readRandomEventBinding(randomEvent.activeBinding);
    const historyItem = (status: RandomEventHistoryItemV2['status']): RandomEventHistoryItemV2 => ({
      id: genId('rev'),
      turn: state.turn,
      intensity: randomEvent.intensity,
      targetKind: binding!.targetKind,
      targetId: binding!.targetId,
      summary: text(binding!.summary, 80) || binding!.targetId,
      ...(randomEventNote ? { outcomeNote: text(randomEventNote, 100) } : {}),
      status,
    });
    if (randomEventSkipped) {
      // 灵魂共创·主动跳过（T9）：玩家离场/独处/静场且没有自然催化剂时，planner 可 planned=false。
      // 跳过不是 interrupted——不写 history、不伪造 lastTriggeredTurn、不进入 pending 每回合重试，
      // 只把调度顺延一个完整冷却窗口；activeBinding 保留（事件仍可在之后的回合重新兑现）。
      randomEvent = {
        ...randomEvent,
        pending: false,
        nextTriggerTurn: state.turn + randomEventCooldownTurns(randomEventCooldown),
      };
    } else if (interrupted) {
      // 未发生：写 interrupted 历史（有绑定才写，没有绑定就没有可记录的事件），pending 顺延，
      // activeBinding 原样保留供下一回合重试绑定（co_author 下保持旧语义：下回合再试一次）。
      if (binding) randomEvent.history = pushRandomEventHistory(randomEvent.history, historyItem('interrupted'));
      randomEvent = { ...randomEvent, pending: true, nextTriggerTurn: state.turn + 1 };
    } else if (occurred) {
      // 已发生：写 resolved / ongoing_hook 历史并清空绑定，再按智能强度重排下一次触发。
      // co_author 下重排走 3~5 回合冷却（情境催化剂不应密集触发）。
      if (binding) randomEvent.history = pushRandomEventHistory(randomEvent.history, historyItem(resolution === 'ongoing_hook' ? 'ongoing_hook' : 'resolved'));
      const nextIntensity = pickRandomEventIntensity({ destiny, randomEvent, turn: state.turn });
      randomEvent = {
        ...randomEvent,
        nextTriggerTurn: state.turn + randomEventCooldownTurns(randomEventCooldown),
        pending: false,
        intensity: nextIntensity,
        lastTriggeredTurn: state.turn,
      };
      if (binding) delete randomEvent.activeBinding;
    } else {
      randomEvent = { ...randomEvent, pending: true, nextTriggerTurn: state.turn + 1 };
    }
  } else if (!randomEventEnabled) {
    randomEvent = { ...randomEvent, pending: false };
  }

  // 幕切换平滑（D7）：本回合发生切幕、而随机事件还排在 turn+2 之后时，把它拉近，
  // 并换成推进/命运档——新幕开局需要外部事件助推，而不是再等好几个回合。
  // T9：co_author 下冷却不能被切幕平滑打穿，拉近目标改为冷却窗口起点（3 回合）；
  // 且"玩家主动跳过"的回合不再做平滑（跳过就是不要事件，不能立刻又排一个）。
  // 该分支只动调度字段，不会伪造已发生的事件（不写 history / lastTriggeredTurn）。
  if (!randomEventSkipped && randomEventEnabled && destiny.lastActTransitionTurn === state.turn && randomEvent.nextTriggerTurn > state.turn + 2) {
    const intensity = pickRandomEventIntensity({ destiny, randomEvent, turn: state.turn });
    const pullTurns = coAuthorRandomEvent ? randomEventCooldown.min : (intensity === 'destiny' ? 1 : 2);
    // 只拉近不推远：co_author 的冷却下界可能大于 2，若事件本就在冷却窗口内则保持原值。
    const pulledTurn = Math.min(randomEvent.nextTriggerTurn, state.turn + pullTurns);
    if (pulledTurn < randomEvent.nextTriggerTurn) {
      randomEvent = {
        ...randomEvent,
        intensity: intensity === 'destiny' ? 'destiny' : 'progress',
        nextTriggerTurn: pulledTurn,
      };
    }
  }

  // 灵魂画像（v0.7.0）：planner_post 可选更新。空串/缺省表示"本轮没有变化"，保留旧值；
  // 只有非空值才覆盖，避免模型每回合把同一段画像重写一遍造成漂移。
  const requestedSoulProfile = cleanSoulProfile(patch.soulProfile);
  const soulProfileNext = requestedSoulProfile || state.soulProfile;

  return { ...state, revision: state.revision + 1, summary: textOrPrevious(patch.roundSummary, state.summary, 5000), latestProgress: textOrPrevious(patch.latestProgress, state.latestProgress, 500), ...(soulProfileNext !== undefined ? { soulProfile: soulProfileNext } : {}), characters, relationships, inventory: inventory.filter((x) => x.quantity > 0), storyThreads: threads, facts, destiny, randomEvent, currentScene: patch.scene ? { id: text(patch.scene.id, 80) || state.currentScene?.id || genId('scene'), name: text(patch.scene.name, 50) || state.currentScene?.name || '未知地点', description: text(patch.scene.description, 240) || state.currentScene?.description, time: text(patch.scene.time, 40) || state.currentScene?.time, weather: text(patch.scene.weather, 40) || state.currentScene?.weather } : state.currentScene,
    // 选项在这里再规整一次：任何绕过 engine 直接提交 Patch 的调用方都不该能写进空按钮。
    availableActions: state.mode === 'adventure' ? normalizeChoices(patch.actions) : [], lastCommitId: patch.commitId };
}
