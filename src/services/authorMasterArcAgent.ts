import type { AppSettings } from '@/types/settings';
import type { Background, StoryOutline, WorldBookEntry } from '@/types/content';
import type {
  AuthorMasterArcConfig,
  MasterArcState,
  NarrativeStage,
  NarrativeStageBeat,
} from '@/types/game';
import { chatJSON } from '@/services/llmClient';
import { AUTHOR_MASTER_ARC_SYSTEM, buildMasterArcUser } from '@/prompts/authorMasterArcSystem';
import { clamp, extractJSON, genId } from '@/lib/utils';

export interface AuthorMasterArcRequest {
  settings: AppSettings;
  outline: StoryOutline;
  background?: Background;
  characterName?: string;
  config: AuthorMasterArcConfig;
  worldBookEntries?: WorldBookEntry[];
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

function sanitizeBeats(raw: unknown, stageIndex: number): NarrativeStageBeat[] {
  if (!Array.isArray(raw)) return [];
  const out: NarrativeStageBeat[] = [];
  for (const item of raw) {
    const row: Record<string, unknown> =
      item && typeof item === 'object' ? (item as Record<string, unknown>) : { description: item };
    const description = cleanText(row.description, 80);
    if (!description) continue;
    out.push({
      id: cleanText(row.id, 40) || genId(`beat_${stageIndex}`),
      description,
      status: 'pending',
    });
    if (out.length >= 8) break;
  }
  return out;
}

function sanitizeMasterArc(raw: unknown, p: AuthorMasterArcRequest): MasterArcState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const rawStages = Array.isArray(obj.stages) ? obj.stages : [];
  const stages: NarrativeStage[] = [];
  rawStages.slice(0, 8).forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const row = item as Record<string, unknown>;
    const name = cleanText(row.name, 16);
    const description = cleanText(row.description, 220);
    if (!name || !description) return;
    const beats = sanitizeBeats(row.expectedBeats, index);
    stages.push({
      id: cleanText(row.id, 40) || genId(`stage_${index}`),
      name,
      description,
      enterConditions: stringList(row.enterConditions, 4, 60),
      completionConditions: stringList(row.completionConditions, 5, 80),
      expectedBeats: beats,
      status: index === 0 ? 'active' : 'pending',
      enteredAtRound: index === 0 ? 0 : undefined,
    });
  });

  if (stages.length < 2) return undefined;
  return {
    title: cleanText(obj.title, 24) || p.outline.title.slice(0, 24),
    summary: cleanText(obj.summary, 220) || p.outline.synopsis.slice(0, 220),
    stages,
    currentStageIndex: 0,
    generatedAtRound: 0,
    updatedAtRound: 0,
    generationConfig: p.config,
  };
}

export function fallbackMasterArcFromOutline(
  outline: StoryOutline,
  config?: AuthorMasterArcConfig,
): MasterArcState {
  const acts = outline.acts?.length ? outline.acts : [outline.synopsis || outline.title];
  const stages: NarrativeStage[] = acts.slice(0, 8).map((act, i) => {
    const name = act.split(/[：:【】]/)[0]?.trim().slice(0, 16) || `第 ${i + 1} 阶段`;
    return {
      id: genId(`stage_${i}`),
      name,
      description: act.slice(0, 220),
      enterConditions: i === 0 ? ['游戏开始即活跃'] : ['上一阶段完成'],
      completionConditions: ['本阶段主要剧情节拍均已展开'],
      expectedBeats: [],
      status: i === 0 ? 'active' : 'pending',
      enteredAtRound: i === 0 ? 0 : undefined,
    };
  });
  if (!stages.length) {
    stages.push({
      id: genId('stage_0'),
      name: '开端',
      description: outline.synopsis.slice(0, 220) || outline.title,
      enterConditions: ['游戏开始即活跃'],
      completionConditions: ['当前开端矛盾已展开'],
      expectedBeats: [],
      status: 'active',
      enteredAtRound: 0,
    });
  }
  return {
    title: outline.title.slice(0, 24),
    summary: outline.synopsis.slice(0, 220),
    stages,
    currentStageIndex: clamp(0, 0, Math.max(0, stages.length - 1)),
    generatedAtRound: 0,
    updatedAtRound: 0,
    generationConfig: config,
  };
}

export async function requestMasterArc(p: AuthorMasterArcRequest): Promise<MasterArcState | undefined> {
  const model = p.settings.randomModel?.trim() || p.settings.storyModel;
  const user = buildMasterArcUser({
    outline: p.outline,
    background: p.background,
    characterName: p.characterName,
    config: p.config,
    worldBookEntries: p.worldBookEntries,
  });

  const runOnce = async (temperature: number): Promise<MasterArcState | undefined> => {
    const text = await chatJSON(
      { baseUrl: p.settings.apiBaseUrl, apiKey: p.settings.apiKey, format: p.settings.apiFormat },
      {
        model,
        temperature,
        messages: [
          { role: 'system', content: AUTHOR_MASTER_ARC_SYSTEM },
          { role: 'user', content: user },
        ],
        signal: p.signal,
      },
    );
    return sanitizeMasterArc(extractJSON(text), p);
  };

  const first = await runOnce(0.45).catch((err) => {
    console.warn('[authorMasterArcAgent] first attempt failed', err);
    return undefined;
  });
  if (first) return first;

  return runOnce(0.2).catch((err) => {
    console.warn('[authorMasterArcAgent] retry failed', err);
    return undefined;
  });
}
