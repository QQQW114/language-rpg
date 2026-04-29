import type { AppSettings } from '@/types/settings';
import type { Background, StoryOutline } from '@/types/content';
import type {
  AuthorLogicCheckConfig,
  AuthorLogicIssue,
  AuthorLogicReviewState,
  AuthorNarrativeState,
  AuthorRandomEventState,
  Item,
  Message,
  Npc,
  SceneRef,
} from '@/types/game';
import { chatJSON } from '@/services/llmClient';
import { AUTHOR_LOGIC_CHECK_SYSTEM, buildAuthorLogicCheckUser } from '@/prompts/authorLogicCheckSystem';
import { extractJSON, genId } from '@/lib/utils';

export interface AuthorLogicCheckRequest {
  settings: AppSettings;
  outline?: StoryOutline;
  background?: Background;
  characterName?: string;
  currentRound: number;
  totalRounds: number;
  config: AuthorLogicCheckConfig;
  summary?: string;
  longTermMemory?: string;
  recent: Message[];
  latestStory?: string;
  npcs: Npc[];
  backpack: Item[];
  currentScene?: SceneRef;
  availableScenes?: SceneRef[];
  narrative?: AuthorNarrativeState;
  randomEventState?: AuthorRandomEventState;
  signal?: AbortSignal;
}

function cleanText(value: unknown, max: number): string | undefined {
  const text = String(value ?? '').trim().slice(0, max);
  return text || undefined;
}

function stringList(raw: unknown, maxItems: number, maxChars: number): string[] {
  const arr = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(/[;；\n]/)
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

function sanitizeIssue(raw: unknown, index: number): AuthorLogicIssue | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const description = cleanText(obj.description, 180);
  if (!description) return undefined;
  const rawType = String(obj.type ?? '').trim();
  const type: AuthorLogicIssue['type'] =
    rawType === 'character' || rawType === 'scene' || rawType === 'timeline' || rawType === 'item'
    || rawType === 'outline' || rawType === 'memory' || rawType === 'pacing' || rawType === 'other'
      ? rawType
      : 'other';
  const rawSeverity = String(obj.severity ?? '').trim();
  const severity: AuthorLogicIssue['severity'] =
    rawSeverity === 'critical' || rawSeverity === 'warning' || rawSeverity === 'info'
      ? rawSeverity
      : 'info';
  return {
    id: cleanText(obj.id, 80) || genId(`logic_${index}`),
    type,
    severity,
    description,
    evidence: cleanText(obj.evidence, 180),
    repairHint: cleanText(obj.repairHint, 180),
  };
}

function sanitizeReview(raw: unknown, currentRound: number): AuthorLogicReviewState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const issues = Array.isArray(obj.issues)
    ? obj.issues.map(sanitizeIssue).filter((x): x is AuthorLogicIssue => !!x).slice(0, 12)
    : [];
  return {
    updatedAtRound: currentRound,
    overall: cleanText(obj.overall, 280) || (issues.length ? '存在需要后续修复的连续性风险。' : '暂未发现明显连续性风险。'),
    issues,
    repairDirectives: stringList(obj.repairDirectives, 8, 140),
    nextRoundWarnings: stringList(obj.nextRoundWarnings, 6, 120),
  };
}

export async function requestAuthorLogicCheck(p: AuthorLogicCheckRequest): Promise<AuthorLogicReviewState | undefined> {
  const model = p.settings.randomModel?.trim() || p.settings.decisionModel || p.settings.storyModel;
  const user = buildAuthorLogicCheckUser(p);

  const runOnce = async (temperature: number): Promise<AuthorLogicReviewState | undefined> => {
    const text = await chatJSON(
      { baseUrl: p.settings.apiBaseUrl, apiKey: p.settings.apiKey, format: p.settings.apiFormat },
      {
        model,
        temperature,
        messages: [
          { role: 'system', content: AUTHOR_LOGIC_CHECK_SYSTEM },
          { role: 'user', content: user },
        ],
        signal: p.signal,
      },
    );
    return sanitizeReview(extractJSON(text), p.currentRound);
  };

  const first = await runOnce(0.25).catch((err) => {
    console.warn('[authorLogicCheckAgent] first attempt failed', err);
    return undefined;
  });
  if (first) return first;

  return runOnce(0).catch((err) => {
    console.warn('[authorLogicCheckAgent] retry failed', err);
    return undefined;
  });
}
