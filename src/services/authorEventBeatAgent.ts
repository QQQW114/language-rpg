import type { AppSettings } from '@/types/settings';
import type { Background, StoryOutline } from '@/types/content';
import type {
  AuthorEventBeatConfig,
  AuthorNarrativeState,
  EventBeatState,
  EventBeatVerdict,
  GameSave,
  Item,
  MemoryAnchor,
  Message,
  NarrativeEventLifecycle,
  NarrativeEventUpdate,
  Npc,
  SceneRef,
} from '@/types/game';
import type { ChatParams } from '@/services/llmClient';
import { chatJSONDetailed } from '@/services/llmClient';
import { AUTHOR_EVENT_BEAT_SYSTEM, buildAuthorEventBeatUser } from '@/prompts/authorEventBeatSystem';
import { clamp, extractJSON } from '@/lib/utils';
import { withPromptTrace } from '@/lib/agentTrace';
import { appendWorkspaceManifest, appendWorkspaceSystem, buildWorkspaceToolRuntime } from '@/services/workspaceTools';
import { createWorkspaceDocument } from '@/storage/ledgerRepository';
import { useGameStore } from '@/store/useGameStore';
import { resolveAuthorCallModel } from '@/lib/agentModels';

export interface AuthorEventBeatRequest {
  save?: GameSave;
  settings: AppSettings;
  outline?: StoryOutline;
  background?: Background;
  characterName?: string;
  currentRound: number;
  config: AuthorEventBeatConfig;
  summary?: string;
  longTermMemory?: string;
  recent: Message[];
  latestStory?: string;
  npcs: Npc[];
  backpack: Item[];
  currentScene?: SceneRef;
  narrative?: AuthorNarrativeState;
  anchors?: MemoryAnchor[];
  signal?: AbortSignal;
  onToolActivity?: ChatParams['onToolActivity'];
  onDelta?: (text: string) => void;
  onThinkingDelta?: (text: string) => void;
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

function cleanText(value: unknown, max: number): string | undefined {
  const text = String(value ?? '').trim().slice(0, max);
  return text || undefined;
}

function sanitizeRelationshipDeltas(raw: unknown): EventBeatVerdict['appliedRelationshipDeltas'] {
  if (!Array.isArray(raw)) return undefined;
  const out: NonNullable<EventBeatVerdict['appliedRelationshipDeltas']> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const npcId = cleanText(row.npcId, 40);
    const npcName = cleanText(row.npcName, 30);
    if (!npcId && !npcName) continue;
    const affinityRaw = Number(row.affinityDelta);
    out.push({
      npcId,
      npcName,
      affinityDelta: Number.isFinite(affinityRaw) ? clamp(Math.round(affinityRaw), -30, 30) : undefined,
      note: cleanText(row.note, 120),
    });
    if (out.length >= 8) break;
  }
  return out.length ? out : undefined;
}

function sanitizeItemDeltas(raw: unknown): EventBeatVerdict['appliedItemDeltas'] {
  if (!Array.isArray(raw)) return undefined;
  const out: NonNullable<EventBeatVerdict['appliedItemDeltas']> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const name = cleanText(row.name, 60);
    const actionRaw = String(row.action ?? '').trim();
    const action = actionRaw === 'grant' || actionRaw === 'note' ? actionRaw : undefined;
    if (!name || !action) continue;
    out.push({
      name,
      action,
      description: cleanText(row.description, 220),
    });
    if (out.length >= 8) break;
  }
  return out.length ? out : undefined;
}

function sanitizeVerdict(raw: unknown): EventBeatVerdict | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const arcId = cleanText(obj.arcId ?? obj.id, 80);
  if (!arcId) return undefined;
  const lifecycleRaw = cleanText(obj.lifecycle ?? obj.status, 32) as NarrativeEventLifecycle | undefined;
  const lifecycle = lifecycleRaw && EVENT_LIFECYCLES.includes(lifecycleRaw)
    ? lifecycleRaw
    : undefined;
  if (!lifecycle) return undefined;
  const progressRaw = Number(obj.progressPercent ?? obj.progress);
  return {
    arcId,
    title: cleanText(obj.title, 80),
    lifecycle,
    progressPercent: Number.isFinite(progressRaw) ? clamp(Math.round(progressRaw), 0, 100) : undefined,
    progressNote: cleanText(obj.progressNote ?? obj.note, 180),
    triggeredCompletion: obj.triggeredCompletion === true,
    triggeredFailure: obj.triggeredFailure === true,
    outcomeNote: cleanText(obj.outcomeNote, 220),
    appliedRelationshipDeltas: sanitizeRelationshipDeltas(obj.appliedRelationshipDeltas),
    appliedItemDeltas: sanitizeItemDeltas(obj.appliedItemDeltas),
  };
}

function sanitizeEventBeat(raw: unknown, currentRound: number): EventBeatState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const verdicts = Array.isArray(obj.verdicts)
    ? obj.verdicts.map(sanitizeVerdict).filter((x): x is EventBeatVerdict => !!x).slice(0, 20)
    : [];
  return {
    updatedAtRound: currentRound,
    verdicts,
    planConcern: cleanText(obj.planConcern, 120),
  };
}

function verdictsToUpdates(verdicts: EventBeatVerdict[]): NarrativeEventUpdate[] {
  return verdicts.map((verdict) => ({
    arcId: verdict.arcId,
    title: verdict.title,
    lifecycle: verdict.lifecycle,
    progressPercent: verdict.progressPercent,
    progressNote: verdict.progressNote || verdict.outcomeNote,
    reason: verdict.outcomeNote || verdict.progressNote,
  }));
}

async function writeEventBeatArtifacts(save: GameSave | undefined, state: EventBeatState): Promise<void> {
  if (!save) return;
  const content = JSON.stringify(state, null, 2);
  const common = {
    saveId: save.id,
    kind: 'director' as const,
    content,
    summary: state.planConcern || `第 ${state.updatedAtRound} 回合事件节奏判定。`,
    tags: ['planning', 'eventBeat', '司事'],
    updatedAtRound: state.updatedAtRound,
    updatedBy: 'eventBeat',
    provenance: {
      round: state.updatedAtRound,
      note: 'authorEventBeatAgent',
    },
  };
  await Promise.all([
    createWorkspaceDocument({
      ...common,
      path: 'planning/latest/event-beat.json',
      title: '最新事件节奏判定',
    }),
    createWorkspaceDocument({
      ...common,
      path: `planning/rounds/${state.updatedAtRound}/event-beat.json`,
      title: `第 ${state.updatedAtRound} 回合事件节奏判定`,
    }),
  ]).catch((err) => {
    console.warn('[authorEventBeatAgent] write planning artifact failed', err);
  });
}

export async function requestAuthorEventBeat(p: AuthorEventBeatRequest): Promise<EventBeatState | undefined> {
  const activeArcs = p.narrative?.activeArcs ?? [];
  if (!p.config.enabled || activeArcs.length === 0) return undefined;
  const model = resolveAuthorCallModel(p.settings, 'eventBeat');
  const workspace = p.settings.apiFormat === 'chat'
    ? await buildWorkspaceToolRuntime(p.save, { agentKind: 'eventBeat', allowWrite: true })
    : {};
  const user = appendWorkspaceManifest(buildAuthorEventBeatUser(p), workspace.userManifest);
  const system = appendWorkspaceSystem(AUTHOR_EVENT_BEAT_SYSTEM, workspace.systemRules);

  const runOnce = async (temperature: number): Promise<EventBeatState | undefined> => {
    const result = await chatJSONDetailed(
      { baseUrl: p.settings.apiBaseUrl, apiKey: p.settings.apiKey, format: p.settings.apiFormat },
      {
        model,
        temperature,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        tools: workspace.tools,
        onToolCall: workspace.onToolCall,
        onToolActivity: p.onToolActivity,
        maxToolRounds: 4,
        onDelta: p.onDelta,
        onThinkingDelta: p.onThinkingDelta,
        signal: p.signal,
      },
    );
    const parsed = sanitizeEventBeat(extractJSON(result.text), p.currentRound);
    return parsed
      ? withPromptTrace({ ...parsed, thinking: result.thinking, rawOutput: result.text, usage: result.usage }, result.trace)
      : undefined;
  };

  const first = await runOnce(0.15).catch((err) => {
    console.warn('[authorEventBeatAgent] first attempt failed', err);
    return undefined;
  });
  const state = first ?? await runOnce(0).catch((err) => {
    console.warn('[authorEventBeatAgent] retry failed', err);
    return undefined;
  });
  if (!state) return undefined;

  if (p.save) {
    const actions = useGameStore.getState();
    actions.applyAuthorEventUpdates(p.save.id, verdictsToUpdates(state.verdicts), p.currentRound);
    actions.setAuthorEventBeat(p.save.id, state, p.currentRound);
    const fresh = useGameStore.getState().saves[p.save.id] ?? p.save;
    await writeEventBeatArtifacts(fresh, state);
  }
  return state;
}
