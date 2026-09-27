import { clamp, genId, textOrPrevious } from '@/lib/utils';
import type { CanonicalFactV2, CharacterV2, GameStateV2, InventoryEntryV2, PatchWarningV2, RandomEventIntensityV2, RelationshipV2, StoryThreadV2, TurnPatchV2 } from './types';

const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const oneOf = <T extends string>(v: unknown, values: readonly T[], fallback: T): T => values.includes(v as T) ? v as T : fallback;

/** 清洗并去重字符串数组（去空、去重、限量）。新增与合并两条分支共用，避免规则漂移。 */
const cleanList = (raw: unknown, max: number, limit: number): string[] => Array.from(new Set(
  (Array.isArray(raw) ? raw : []).map((x) => text(x, max)).filter(Boolean),
)).slice(0, limit);

/**
 * 枚举字段的白名单取值；表外取值会被静默改写，因此这里同时记录一条警告，
 * 让"模型写了中文枚举/自造同义词"这类问题在活动流里可见，而不是悄悄变成默认值。
 */
function oneOfChecked<T extends string>(
  raw: unknown,
  values: readonly T[],
  fallback: T,
  ctx: { warnings: PatchWarningV2[]; path: string; label: string },
): T {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (values.includes(raw as T)) return raw as T;
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
export function commitTurnPatchV2(state: GameStateV2, patch: TurnPatchV2, warnings: PatchWarningV2[] = []): GameStateV2 {
  if (patch.schemaVersion !== 2) throw new Error('不支持的状态 Patch 版本');
  if (patch.baseRevision !== state.revision) throw new Error('状态已变化，请重新结算');
  if (patch.turn !== state.turn) throw new Error('Patch 回合不匹配');
  if (patch.commitId && patch.commitId === state.lastCommitId) return state;



  const characterStatuses = ['active', 'absent', 'missing', 'dead', 'unknown'] as const;
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
        status: oneOfChecked(row.status, characterStatuses, 'active', { warnings, path: `characters[${id}].status`, label: `人物 ${name} 的 status` }),
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
        target.status = oneOfChecked(row.status, characterStatuses, target.status, { warnings, path: `characters[${target.id}].status`, label: `人物 ${target.name} 的 status` });
      }
      target.knownFacts = Array.from(new Set([...target.knownFacts, ...cleanList(row.addFacts, 100, 20)])).slice(-20);
      target.lastSeenTurn = state.turn;
    }
  }

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
  const inventory: InventoryEntryV2[] = state.inventory.map((x) => ({ ...x }));
  for (const rawRow of Array.isArray(patch.inventory) ? patch.inventory : []) {
    if (!record(rawRow)) continue;
    const row = rawRow as NonNullable<TurnPatchV2['inventory']>[number];
    if (!text(row.reason, 200)) continue;
    let item = row.id ? inventory.find((x) => x.id === row.id) : inventory.find((x) => x.name === row.name);
    if (row.op === 'grant') {
      if (item) item.quantity += Math.max(1, Math.round(row.quantity ?? 1));
      else if (row.name) inventory.push({
        id: text(row.id, 80) || genId('item'),
        name: text(row.name, 40),
        kind: oneOfChecked(row.kind, inventoryKinds, 'item', { warnings, path: `inventory[${text(row.id, 80) || text(row.name, 40)}].kind`, label: `物品「${text(row.name, 40)}」的 kind` }),
        description: text(row.description, 240),
        quantity: Math.max(1, Math.round(row.quantity ?? 1)),
        consumable: !!row.consumable,
        acquiredAtTurn: state.turn,
        updatedAtTurn: state.turn,
      });
    } else if (item && row.op === 'consume') item.quantity -= Math.max(1, Math.round(row.quantity ?? 1));
    else if (item && row.op === 'remove') item.quantity = 0;
    else if (item && row.op === 'update') {
      if (row.description !== undefined) item.description = text(row.description, 240);
      if (row.kind) item.kind = oneOfChecked(row.kind, inventoryKinds, item.kind, { warnings, path: `inventory[${item.id}].kind`, label: `物品「${item.name}」的 kind` });
      if (row.consumable !== undefined) item.consumable = !!row.consumable;
    }
    if (item) item.updatedAtTurn = state.turn;
  }

  const threadKinds = ['main', 'relationship', 'quest', 'hook'] as const;
  const threadStatuses = ['candidate', 'active', 'completed', 'failed', 'cancelled'] as const;
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
      threads.push({ id, title: text(row.title, 80), kind: oneOfChecked(row.kind, threadKinds, 'hook', { warnings, path: `threads[${id}].kind`, label: `线程「${text(row.title, 80)}」的 kind` }), status: oneOfChecked(row.status, threadStatuses, 'candidate', { warnings, path: `threads[${id}].status`, label: `线程「${text(row.title, 80)}」的 status` }), progress: row.progress === undefined ? undefined : clamp(Number(row.progress) || 0, 0, 100), currentStep: text(row.currentStep, 160) || undefined, involvedCharacterIds: cleanList(row.involvedCharacterIds, 80, 50), note: text(row.note, 200) || undefined, updatedAtTurn: state.turn });
    }
    else {
      const target = threads.find((x) => x.id === row.id);
      if (!target) continue;
      if (row.kind) target.kind = oneOfChecked(row.kind, threadKinds, target.kind, { warnings, path: `threads[${target.id}].kind`, label: `线程「${target.title}」的 kind` });
      if (Array.isArray(row.involvedCharacterIds)) {
        target.involvedCharacterIds = cleanList(row.involvedCharacterIds, 80, 50);
      }
      if (row.status) target.status = oneOfChecked(row.status, threadStatuses, target.status, { warnings, path: `threads[${target.id}].status`, label: `线程「${target.title}」的 status` });
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
  // reason用于解释与审计，不是命运Patch的事务开关。即使供应商漏掉一个
  // 说明字段，也必须逐项提交其余合法状态，不能静默丢弃整个命运更新。
  if (record(patch.destiny)) {
    if (patch.destiny.completionEstimate !== undefined) destiny.completionEstimate = clamp(Number(patch.destiny.completionEstimate) || 0, 0, 100);
    if (patch.destiny.completionReason !== undefined) destiny.completionReason = text(patch.destiny.completionReason, 400) || destiny.completionReason;
    if (patch.destiny.currentActId !== undefined) destiny.currentActId = text(patch.destiny.currentActId, 80) || destiny.currentActId;
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
    const allCoreBeatsSatisfied = destiny.beats.length > 0 && destiny.beats.every((x) => x.status === 'satisfied' || x.status === 'superseded');
    if (patch.destiny.endingReached === true && destiny.completionEstimate >= 100 && allCoreBeatsSatisfied && !destiny.endingReached) {
      destiny.endingReached = true;
      destiny.endingReachedAtTurn = state.turn;
    }
    destiny.updatedAtTurn = state.turn;
  }

  const randomEventEnabled = state.randomEvent.enabled !== false;
  const dueRandomEvent = randomEventEnabled && (state.randomEvent.pending || state.turn >= state.randomEvent.nextTriggerTurn);
  const randomEventNote = text(patch.randomEvent?.note, 500) || undefined;
  let randomEvent = { ...state.randomEvent };
  if (dueRandomEvent) {
    if (patch.randomEvent?.handled) {
      const intensities: RandomEventIntensityV2[] = ['related', 'progress', 'destiny'];
      const intervalMin = Math.max(1, Math.round(randomEvent.triggerIntervalMin ?? 3));
      const intervalMax = Math.max(intervalMin, Math.round(randomEvent.triggerIntervalMax ?? 6));
      randomEvent = {
        ...randomEvent,
        nextTriggerTurn: state.turn + intervalMin + Math.floor(Math.random() * (intervalMax - intervalMin + 1)),
        pending: false,
        intensity: intensities[Math.floor(Math.random() * intensities.length)],
        lastTriggeredTurn: state.turn,
        ...(randomEventNote ? { lastNote: randomEventNote } : {}),
      };
    } else {
      randomEvent = { ...randomEvent, pending: true, nextTriggerTurn: state.turn + 1, ...(randomEventNote ? { lastNote: randomEventNote } : {}) };
    }
  } else if (!randomEventEnabled) {
    randomEvent = { ...randomEvent, pending: false, ...(randomEventNote ? { lastNote: randomEventNote } : {}) };
  }

  return { ...state, revision: state.revision + 1, summary: textOrPrevious(patch.roundSummary, state.summary, 5000), latestProgress: textOrPrevious(patch.latestProgress, state.latestProgress, 500), characters, relationships, inventory: inventory.filter((x) => x.quantity > 0), storyThreads: threads, facts, destiny, randomEvent, currentScene: patch.scene ? { id: text(patch.scene.id, 80) || state.currentScene?.id || genId('scene'), name: text(patch.scene.name, 50) || state.currentScene?.name || '未知地点', description: text(patch.scene.description, 240) || state.currentScene?.description, time: text(patch.scene.time, 40) || state.currentScene?.time, weather: text(patch.scene.weather, 40) || state.currentScene?.weather } : state.currentScene, availableActions: state.mode === 'adventure' ? (patch.actions ?? []).slice(0, 4) : [], lastCommitId: patch.commitId };
}
