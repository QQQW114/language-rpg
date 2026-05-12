import type {
  AuthorCharacterPlanState,
  AuthorEventPlanState,
  AuthorScenePlanState,
  NarrativeBriefCharacter,
  NarrativeBriefEvent,
  NarrativeBriefScene,
  NarrativeEventLifecycle,
  NarrativeEventUpdate,
  OutlineMappingAlignment,
  OutlineMappingState,
} from '@/types/game';
import { clamp } from '@/lib/utils';

export function cleanPlanningText(value: unknown, max: number): string | undefined {
  const text = String(value ?? '').trim().slice(0, max);
  return text || undefined;
}

export function planningStringList(raw: unknown, maxItems: number, maxChars: number): string[] {
  const arr = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(/[;；、\n]/)
      : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    const text = cleanPlanningText(item, maxChars);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

const EVENT_LIFECYCLES: NarrativeEventLifecycle[] = [
  'candidate',
  'active',
  'progressing',
  'turning',
  'completed',
  'soft_failed',
  'missed',
  'delayed',
  'reframed',
  'archived',
];

const OUTLINE_ALIGNMENTS: OutlineMappingAlignment[] = [
  'aligned',
  'drifting',
  'bridging',
  'ready_to_advance',
  'uncertain',
];

export function sanitizePlanningBriefCharacter(raw: unknown): NarrativeBriefCharacter | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const row = raw as Record<string, unknown>;
  const name = cleanPlanningText(row.name, 30);
  if (!name) return undefined;
  return {
    name,
    role: cleanPlanningText(row.role, 40),
    surfaceGoal: cleanPlanningText(row.surfaceGoal, 160),
    hiddenIntent: cleanPlanningText(row.hiddenIntent, 160),
    visibleBehavior: cleanPlanningText(row.visibleBehavior, 180),
    doNotReveal: planningStringList(row.doNotReveal, 5, 80),
  };
}

export function sanitizePlanningBriefScene(raw: unknown): NarrativeBriefScene | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const row = raw as Record<string, unknown>;
  const scene: NarrativeBriefScene = {
    location: cleanPlanningText(row.location ?? row.name, 80),
    time: cleanPlanningText(row.time, 60),
    weather: cleanPlanningText(row.weather, 60),
    atmosphere: cleanPlanningText(row.atmosphere ?? row.mood, 140),
    resources: planningStringList(row.resources ?? row.sceneResources, 8, 90),
    constraints: planningStringList(row.constraints, 6, 90),
  };
  return scene.location
    || scene.time
    || scene.weather
    || scene.atmosphere
    || scene.resources?.length
    || scene.constraints?.length
    ? scene
    : undefined;
}

export function sanitizePlanningBriefEvent(raw: unknown): NarrativeBriefEvent | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const row = raw as Record<string, unknown>;
  const lifecycleRaw = cleanPlanningText(row.lifecycle ?? row.status, 32) as NarrativeEventLifecycle | undefined;
  const event: NarrativeBriefEvent = {
    title: cleanPlanningText(row.title, 60),
    lifecycle: lifecycleRaw && EVENT_LIFECYCLES.includes(lifecycleRaw) ? lifecycleRaw : undefined,
    objective: cleanPlanningText(row.objective, 180),
    hiddenIntent: cleanPlanningText(row.hiddenIntent, 180),
    completionCriteria: planningStringList(row.completionCriteria, 5, 90),
    failureCriteria: planningStringList(row.failureCriteria, 5, 90),
    progress: cleanPlanningText(row.progress, 120),
    stopAt: cleanPlanningText(row.stopAt, 140),
  };
  return event.title
    || event.lifecycle
    || event.objective
    || event.hiddenIntent
    || event.completionCriteria?.length
    || event.failureCriteria?.length
    || event.progress
    || event.stopAt
    ? event
    : undefined;
}

export function sanitizePlanningOutlineMapping(raw: unknown, updatedAtRound: number): OutlineMappingState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const alignmentRaw = cleanPlanningText(obj.alignment ?? obj.status, 32) as OutlineMappingAlignment | undefined;
  const alignment = alignmentRaw && OUTLINE_ALIGNMENTS.includes(alignmentRaw)
    ? alignmentRaw
    : 'uncertain';
  const currentActIndexRaw = Number(obj.currentActIndex);
  const stageProgressRaw = Number(obj.stageProgress ?? obj.progress);
  return {
    alignment,
    currentAct: cleanPlanningText(obj.currentAct, 100),
    currentActIndex: Number.isFinite(currentActIndexRaw)
      ? clamp(Math.floor(currentActIndexRaw), 0, 99)
      : undefined,
    currentStageGoal: cleanPlanningText(obj.currentStageGoal ?? obj.stageGoal, 220),
    stageProgress: Number.isFinite(stageProgressRaw)
      ? clamp(Math.round(stageProgressRaw), 0, 100)
      : undefined,
    missingBridgeEvents: planningStringList(obj.missingBridgeEvents ?? obj.missingBridges, 8, 120),
    candidateEvents: planningStringList(obj.candidateEvents ?? obj.eventNeeds, 8, 120),
    driftRisks: planningStringList(obj.driftRisks ?? obj.risks, 8, 120),
    nextMilestone: cleanPlanningText(obj.nextMilestone, 180),
    updatedAtRound,
  };
}

export function sanitizePlanningEventUpdates(raw: unknown): NarrativeEventUpdate[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: NarrativeEventUpdate[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const arcId = cleanPlanningText(row.arcId ?? row.id, 80);
    const title = cleanPlanningText(row.title, 80);
    if (!arcId && !title) continue;
    const lifecycleRaw = cleanPlanningText(row.lifecycle ?? row.status, 32) as NarrativeEventLifecycle | undefined;
    const progressRaw = Number(row.progressPercent ?? row.progress);
    const stageRaw = Number(row.currentStageIndex);
    out.push({
      arcId,
      title,
      lifecycle: lifecycleRaw && EVENT_LIFECYCLES.includes(lifecycleRaw) ? lifecycleRaw : undefined,
      progressPercent: Number.isFinite(progressRaw) ? clamp(Math.round(progressRaw), 0, 100) : undefined,
      progressNote: cleanPlanningText(row.progressNote ?? row.note, 240),
      currentStageIndex: Number.isFinite(stageRaw) ? Math.max(0, Math.floor(stageRaw)) : undefined,
      reason: cleanPlanningText(row.reason, 180),
    });
    if (out.length >= 10) break;
  }
  return out.length ? out : undefined;
}

export function sanitizeCharacterPlanState(raw: unknown, updatedAtRound: number): AuthorCharacterPlanState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const characters = Array.isArray(obj.characters)
    ? obj.characters.map(sanitizePlanningBriefCharacter).filter(Boolean).slice(0, 10) as NarrativeBriefCharacter[]
    : [];
  const summary = cleanPlanningText(obj.summary, 500) || (characters.length ? '人物规划已更新。' : undefined);
  if (!summary && !characters.length) return undefined;
  const absentCharacters = Array.isArray(obj.absentCharacters)
    ? obj.absentCharacters.map((item) => {
      const row = item as Record<string, unknown>;
      const name = cleanPlanningText(row.name, 30);
      const reason = cleanPlanningText(row.reason, 160);
      return name && reason ? { name, reason } : undefined;
    }).filter(Boolean).slice(0, 8) as AuthorCharacterPlanState['absentCharacters']
    : undefined;
  return {
    updatedAtRound,
    summary: summary || '人物规划已更新。',
    characters,
    relationshipSignals: planningStringList(obj.relationshipSignals, 8, 120),
    absentCharacters,
    risks: planningStringList(obj.risks, 8, 120),
  };
}

export function sanitizeScenePlanState(raw: unknown, updatedAtRound: number): AuthorScenePlanState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const scene = sanitizePlanningBriefScene(obj.scene ?? obj.scenePlan);
  const sceneResources = planningStringList(obj.sceneResources, 10, 120);
  if (!scene && !sceneResources.length) return undefined;
  return {
    updatedAtRound,
    scene: scene ?? {},
    sceneResources,
    sceneLogic: cleanPlanningText(obj.sceneLogic, 300),
    constraints: planningStringList(obj.constraints, 8, 120),
    opportunities: planningStringList(obj.opportunities, 8, 120),
    risks: planningStringList(obj.risks, 8, 120),
  };
}

export function sanitizeEventPlanState(raw: unknown, updatedAtRound: number): AuthorEventPlanState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const currentEvent = sanitizePlanningBriefEvent(obj.currentEvent ?? obj.event);
  const eventUpdates = sanitizePlanningEventUpdates(obj.eventUpdates ?? obj.arcUpdates);
  const candidateEvents = planningStringList(obj.candidateEvents, 8, 120);
  const summary = cleanPlanningText(obj.summary, 500)
    || currentEvent?.objective
    || (eventUpdates?.length ? '事件规划已更新。' : undefined);
  if (!summary && !currentEvent && !eventUpdates?.length && !candidateEvents.length) return undefined;
  return {
    updatedAtRound,
    summary: summary || '事件规划已更新。',
    currentEvent,
    eventUpdates,
    candidateEvents,
    writingBoundary: cleanPlanningText(obj.writingBoundary ?? obj.stopAt, 220),
    successCriteria: planningStringList(obj.successCriteria, 8, 120),
    avoid: planningStringList(obj.avoid, 8, 120),
  };
}
