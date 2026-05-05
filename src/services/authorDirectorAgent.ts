import type { AppSettings } from '@/types/settings';
import type { Background, StoryOutline, WorldBookEntry } from '@/types/content';
import type {
  AuthorDirectorConfig,
  AuthorNarrativeState,
  AuthorRandomEventState,
  Item,
  MemoryAnchor,
  Message,
  NarrativePlanState,
  Npc,
  SceneRef,
} from '@/types/game';
import type { StrictCustomConfig } from '@/types/custom';
import { chatJSON } from '@/services/llmClient';
import { AUTHOR_DIRECTOR_SYSTEM, buildAuthorDirectorUser } from '@/prompts/authorDirectorSystem';
import { clamp, extractJSON, genId } from '@/lib/utils';
import { appendDeepSeekV4PureAnalysisMarker } from '@/lib/deepseekV4Prompt';

export interface AuthorDirectorRequest {
  settings: AppSettings;
  outline?: StoryOutline;
  background?: Background;
  characterName?: string;
  currentRound: number; // 已完成回合
  nextRound: number;    // 要规划的下一回合
  totalRounds: number;
  config: AuthorDirectorConfig;
  strictCustom?: StrictCustomConfig;
  summary?: string;
  longTermMemory?: string;
  recent: Message[];
  latestStory?: string;
  npcs: Npc[];
  currentScene?: SceneRef;
  narrative?: AuthorNarrativeState;
  randomEventState?: AuthorRandomEventState;
  worldBookEntries?: WorldBookEntry[];
  backpack?: Item[];
  anchors?: MemoryAnchor[];
  signal?: AbortSignal;
}

function cleanText(value: unknown, max: number): string | undefined {
  const text = String(value ?? '').trim().slice(0, max);
  return text || undefined;
}

function numberInRange(value: unknown, fallback: number, min: number, max: number): number {
  const num = Math.floor(Number(value));
  if (!Number.isFinite(num)) return fallback;
  return clamp(num, min, max);
}

function stringList(raw: unknown, maxItems: number, maxChars: number): string[] {
  const arr = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(/[;；、\n]/)
      : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    const text = cleanText(item, maxChars);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

function sanitizePlan(raw: unknown, p: AuthorDirectorRequest): NarrativePlanState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const isInfinite = !p.totalRounds || p.totalRounds <= 0;
  const maxRound = isInfinite ? p.nextRound + Math.max(2, p.config.horizonRounds + 6) : Math.max(p.nextRound, p.totalRounds);
  const stageStartRound = numberInRange(obj.stageStartRound, p.nextRound, 1, maxRound);
  const stageTargetEndRound = numberInRange(
    obj.stageTargetEndRound,
    Math.min(maxRound, p.nextRound + Math.max(1, p.config.horizonRounds - 1)),
    stageStartRound,
    maxRound,
  );

  const rawPlans = Array.isArray(obj.nextFewBeats)
    ? obj.nextFewBeats
    : Array.isArray(obj.nextFewRoundsPlan)
      ? obj.nextFewRoundsPlan
      : [];
  const nextFewRoundsPlan: NarrativePlanState['nextFewRoundsPlan'] = [];
  rawPlans.forEach((item, index) => {
    if (!item || typeof item !== 'object' || nextFewRoundsPlan.length >= 6) return;
    const row = item as Record<string, unknown>;
    const start = numberInRange(row.startRound, index === 0 ? p.nextRound : p.nextRound + index, p.nextRound, maxRound);
    const end = numberInRange(row.endRound, start, start, maxRound);
    const goal = cleanText(row.goal, 180);
    if (!goal) return;
    nextFewRoundsPlan.push({
      id: cleanText(row.id, 80) || genId('plan'),
      startRound: start,
      endRound: end,
      goal,
      requiredBeats: stringList(row.requiredBeats, 8, 80),
      avoidBeats: stringList(row.avoidBeats, 6, 80),
      revealPolicy: cleanText(row.revealPolicy, 140),
    });
  });

  if (!nextFewRoundsPlan.length) {
    nextFewRoundsPlan.push({
      id: genId('plan'),
      startRound: p.nextRound,
      endRound: stageTargetEndRound,
      goal: cleanText(obj.stageGoal, 180) || cleanText(obj.nextRoundFocus, 140) || '承接上文，稳步推进当前阶段目标。',
      requiredBeats: [],
    });
  }

  return {
    currentAct: cleanText(obj.currentAct, 60),
    currentStage: cleanText(obj.currentStage, 60),
    stageGoal: cleanText(obj.stageGoal, 180),
    stageStartRound,
    stageTargetEndRound,
    nextRoundFocus: cleanText(obj.nextRoundFocus, 140),
    nextFewRoundsPlan,
    outlineAlignment: cleanText(obj.outlineAlignment, 220),
    pacingAdvice: cleanText(obj.pacingAdvice, 220),
    riskNotes: stringList(obj.riskNotes, 5, 120),
    updatedAtRound: p.currentRound,
  };
}

export async function requestAuthorDirectorPlan(p: AuthorDirectorRequest): Promise<NarrativePlanState | undefined> {
  const model = p.settings.randomModel?.trim() || p.settings.decisionModel || p.settings.storyModel;
  const user = appendDeepSeekV4PureAnalysisMarker(buildAuthorDirectorUser(p));

  const runOnce = async (temperature: number): Promise<NarrativePlanState | undefined> => {
    const text = await chatJSON(
      { baseUrl: p.settings.apiBaseUrl, apiKey: p.settings.apiKey, format: p.settings.apiFormat },
      {
        model,
        temperature,
        messages: [
          { role: 'system', content: AUTHOR_DIRECTOR_SYSTEM },
          { role: 'user', content: user },
        ],
        signal: p.signal,
      },
    );
    const obj = extractJSON(text);
    return sanitizePlan(obj, p);
  };

  const first = await runOnce(0.45).catch((err) => {
    console.warn('[authorDirectorAgent] first attempt failed', err);
    return undefined;
  });
  if (first) return first;

  return runOnce(0.2).catch((err) => {
    console.warn('[authorDirectorAgent] retry failed', err);
    return undefined;
  });
}
