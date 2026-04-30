import type { AppSettings } from '@/types/settings';
import type { StoryOutline, WorldBookEntry } from '@/types/content';
import type {
  AuthorStageJudgeConfig,
  MasterArcState,
  MemoryAnchor,
  Message,
  NarrativePlanState,
  Npc,
  PlayerPace,
  SceneRef,
  StageJudgeState,
  StoryArc,
} from '@/types/game';
import { chatJSON } from '@/services/llmClient';
import { AUTHOR_STAGE_JUDGE_SYSTEM, buildStageJudgeUser } from '@/prompts/authorStageJudgeSystem';
import { clamp, extractJSON } from '@/lib/utils';

export interface StageJudgeRequest {
  settings: AppSettings;
  outline?: StoryOutline;
  characterName?: string;
  currentRound: number;
  nextRound: number;
  config: AuthorStageJudgeConfig;
  summary?: string;
  longTermMemory?: string;
  recent: Message[];
  playerInput?: string;
  npcs: Npc[];
  currentScene?: SceneRef;
  masterArc?: MasterArcState;
  narrativePlan?: NarrativePlanState;
  previous?: StageJudgeState;
  worldBookEntries?: WorldBookEntry[];
  anchors?: MemoryAnchor[];
  activeArcs?: StoryArc[];
  signal?: AbortSignal;
}

export type StageJudgeResult = Omit<StageJudgeState, 'updatedAtRound' | 'lastError'>;

function cleanText(value: unknown, max: number): string | undefined {
  const text = String(value ?? '').trim().slice(0, max);
  return text || undefined;
}

function textList(raw: unknown, maxItems: number, maxChars: number): string[] {
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

function normalizePace(raw: unknown): PlayerPace {
  return raw === 'immersive' || raw === 'exploratory' || raw === 'progressing' || raw === 'hurrying'
    ? raw
    : 'progressing';
}

function sanitizeStageJudge(raw: unknown, p: StageJudgeRequest): StageJudgeResult | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const intentRaw = (obj.playerIntent && typeof obj.playerIntent === 'object'
    ? obj.playerIntent
    : {}) as Record<string, unknown>;
  const statusRaw = (obj.stageStatus && typeof obj.stageStatus === 'object'
    ? obj.stageStatus
    : {}) as Record<string, unknown>;
  const focusRaw = (obj.storyFocus && typeof obj.storyFocus === 'object'
    ? obj.storyFocus
    : {}) as Record<string, unknown>;

  const primary = cleanText(intentRaw.primary, 80)
    || cleanText(p.playerInput, 80)
    || '继续承接上文推进当前情境。';
  const thisRound = cleanText(focusRaw.thisRound, 140)
    || `围绕“${primary}”只推进一个微节拍。`;
  const currentStage = p.masterArc?.stages[p.masterArc.currentStageIndex];
  const beatIds = new Set((currentStage?.expectedBeats ?? []).map((b) => b.id));
  const newlyAchievedBeats = textList(statusRaw.newlyAchievedBeats, 8, 80)
    .filter((id) => beatIds.has(id));
  const currentStageId = cleanText(statusRaw.currentStageId, 80) || currentStage?.id;
  return {
    playerIntent: {
      primary,
      secondary: textList(intentRaw.secondary, 3, 60),
      implicit: cleanText(intentRaw.implicit, 80),
    },
    playerPace: normalizePace(obj.playerPace),
    paceReasoning: cleanText(obj.paceReasoning, 140),
    stageStatus: {
      currentStageId,
      completion: clamp(Math.round(Number(statusRaw.completion) || 0), 0, 100),
      newlyAchievedBeats,
      shouldAdvance: statusRaw.shouldAdvance === true,
      advanceReasoning: cleanText(statusRaw.advanceReasoning, 120),
    },
    storyFocus: {
      thisRound,
      avoid: textList(focusRaw.avoid, 4, 80),
    },
  };
}

export async function requestStageJudge(p: StageJudgeRequest): Promise<StageJudgeResult | undefined> {
  const model = p.settings.randomModel?.trim() || p.settings.decisionModel || p.settings.storyModel;
  const user = buildStageJudgeUser({
    outline: p.outline,
    characterName: p.characterName,
    currentRound: p.currentRound,
    nextRound: p.nextRound,
    config: p.config,
    summary: p.summary,
    longTermMemory: p.longTermMemory,
    recent: p.recent,
    playerInput: p.playerInput,
    npcs: p.npcs,
    currentScene: p.currentScene,
    masterArc: p.masterArc,
    narrativePlan: p.narrativePlan,
    previous: p.previous,
    worldBookEntries: p.worldBookEntries,
    anchors: p.anchors,
    activeArcs: p.activeArcs,
  });

  const runOnce = async (temperature: number): Promise<StageJudgeResult | undefined> => {
    const text = await chatJSON(
      { baseUrl: p.settings.apiBaseUrl, apiKey: p.settings.apiKey, format: p.settings.apiFormat },
      {
        model,
        temperature,
        messages: [
          { role: 'system', content: AUTHOR_STAGE_JUDGE_SYSTEM },
          { role: 'user', content: user },
        ],
        signal: p.signal,
      },
    );
    return sanitizeStageJudge(extractJSON(text), p);
  };

  const first = await runOnce(0.35).catch((err) => {
    console.warn('[authorStageJudgeAgent] first attempt failed', err);
    return undefined;
  });
  if (first) return first;

  return runOnce(0.1).catch((err) => {
    console.warn('[authorStageJudgeAgent] retry failed', err);
    return undefined;
  });
}
