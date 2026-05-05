import type { AppSettings } from '@/types/settings';
import type { Background, StoryOutline, WorldBookEntry } from '@/types/content';
import type {
  AuthorNarrativeState,
  AuthorRandomEventState,
  AuthorSettingGuardConfig,
  Item,
  MemoryAnchor,
  Message,
  Npc,
  SceneRef,
  SettingGuardAmbientBeat,
  SettingGuardCandidate,
  SettingGuardDeviation,
  SettingGuardPreference,
  SettingPatch,
} from '@/types/game';
import { chatJSON } from '@/services/llmClient';
import { AUTHOR_SETTING_GUARD_SYSTEM, buildSettingGuardUser } from '@/prompts/authorSettingGuardSystem';
import { extractJSON } from '@/lib/utils';
import { appendDeepSeekV4PureAnalysisMarker } from '@/lib/deepseekV4Prompt';

export interface SettingGuardRequest {
  settings: AppSettings;
  outline?: StoryOutline;
  background?: Background;
  characterName?: string;
  currentRound: number;
  nextRound: number;
  totalRounds: number;
  config: AuthorSettingGuardConfig;
  summary?: string;
  longTermMemory?: string;
  recent: Message[];
  playerInput?: string;
  npcs: Npc[];
  backpack: Item[];
  currentScene?: SceneRef;
  worldBookEntries: WorldBookEntry[];
  anchors: MemoryAnchor[];
  narrative?: AuthorNarrativeState;
  randomEventState?: AuthorRandomEventState;
  signal?: AbortSignal;
}

export interface SettingGuardResult {
  patches: Array<Omit<SettingPatch, 'id' | 'suggestedAtRound'>>;
  candidates: Array<Omit<SettingGuardCandidate, 'id' | 'status' | 'suggestedAtRound'>>;
  preference?: Omit<SettingGuardPreference, 'updatedAtRound'>;
  ambientBeats: Array<Omit<SettingGuardAmbientBeat, 'id' | 'suggestedAtRound' | 'consumed'>>;
  memoryUrgency: 'high' | 'normal' | 'none';
  deviation?: Omit<SettingGuardDeviation, 'flaggedAtRound'>;
}

function cleanText(value: unknown, max: number): string | undefined {
  const text = String(value ?? '').trim().slice(0, max);
  return text || undefined;
}

function textList(raw: unknown, maxItems: number, maxChars: number): string[] {
  const arr = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(/[;；、,\n]/)
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

function sanitizePatches(raw: unknown): SettingGuardResult['patches'] {
  if (!Array.isArray(raw)) return [];
  const out: SettingGuardResult['patches'] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const topic = cleanText(obj.topic, 16);
    const advice = cleanText(obj.advice, 160);
    if (!topic || !advice) continue;
    out.push({
      topic,
      advice,
      severity: obj.severity === 'must' ? 'must' : 'should',
    });
    if (out.length >= 6) break;
  }
  return out;
}

function sanitizeCandidates(raw: unknown): SettingGuardResult['candidates'] {
  if (!Array.isArray(raw)) return [];
  const out: SettingGuardResult['candidates'] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const name = cleanText(obj.name, 20);
    const content = cleanText(obj.content, 180);
    const rationale = cleanText(obj.rationale, 120);
    if (!name || !content || seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      keywords: textList(obj.keywords, 4, 12),
      content,
      rationale: rationale || '守护者建议沉淀为世界书条目。',
    });
    if (out.length >= 2) break;
  }
  return out;
}

function sanitizePreference(raw: unknown): SettingGuardResult['preference'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const confidence =
    obj.confidence === 'high' || obj.confidence === 'medium' || obj.confidence === 'low'
      ? obj.confidence
      : 'low';
  const tendency = cleanText(obj.tendency, 120);
  const recentSignals = textList(obj.recentSignals, 5, 80);
  if (!tendency && !recentSignals.length) return { confidence };
  return { tendency, recentSignals, confidence };
}

function sanitizeAmbientBeats(raw: unknown): SettingGuardResult['ambientBeats'] {
  if (!Array.isArray(raw)) return [];
  const out: SettingGuardResult['ambientBeats'] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const source = cleanText(obj.source, 20);
    const trigger = cleanText(obj.trigger, 80);
    const beat = cleanText(obj.beat, 120);
    if (!source || !trigger || !beat) continue;
    out.push({
      source,
      trigger,
      beat,
      optional: obj.optional !== false,
    });
    if (out.length >= 3) break;
  }
  return out;
}

function sanitizeDeviation(raw: unknown): SettingGuardResult['deviation'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const description = cleanText(obj.description, 200);
  if (!description) return undefined;
  return {
    description,
    affectedEntryNames: textList(obj.affectedEntryNames, 5, 30),
  };
}

function sanitizeSettingGuardResult(raw: unknown, p: SettingGuardRequest): SettingGuardResult | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const memoryUrgency =
    obj.memoryUrgency === 'high' || obj.memoryUrgency === 'normal' || obj.memoryUrgency === 'none'
      ? obj.memoryUrgency
      : 'normal';
  return {
    patches: sanitizePatches(obj.settingPatches),
    candidates: sanitizeCandidates(obj.newWorldBookCandidates),
    preference: sanitizePreference(obj.playerPreference),
    ambientBeats: p.config.ambientBeatsEnabled ? sanitizeAmbientBeats(obj.ambientBeats) : [],
    memoryUrgency,
    deviation: sanitizeDeviation(obj.outlineDeviation),
  };
}

export async function requestSettingGuard(p: SettingGuardRequest): Promise<SettingGuardResult | undefined> {
  const model = p.settings.randomModel?.trim() || p.settings.decisionModel || p.settings.storyModel;
  const user = appendDeepSeekV4PureAnalysisMarker(buildSettingGuardUser(p));

  const runOnce = async (temperature: number): Promise<SettingGuardResult | undefined> => {
    const text = await chatJSON(
      { baseUrl: p.settings.apiBaseUrl, apiKey: p.settings.apiKey, format: p.settings.apiFormat },
      {
        model,
        temperature,
        messages: [
          { role: 'system', content: AUTHOR_SETTING_GUARD_SYSTEM },
          { role: 'user', content: user },
        ],
        signal: p.signal,
      },
    );
    return sanitizeSettingGuardResult(extractJSON(text), p);
  };

  const first = await runOnce(0.35).catch((err) => {
    console.warn('[settingGuardAgent] first attempt failed', err);
    return undefined;
  });
  if (first) return first;

  return runOnce(0.1).catch((err) => {
    console.warn('[settingGuardAgent] retry failed', err);
    return undefined;
  });
}
