import type { AppSettings } from '@/types/settings';
import type { Background, RandomEvent, StoryOutline, WorldBookEntry } from '@/types/content';
import type {
  AuthorNarrativeState,
  AuthorRandomEventConfig,
  Item,
  MemoryAnchor,
  Message,
  Npc,
  SceneRef,
  StoryArc,
  StoryArcStage,
} from '@/types/game';
import { chatJSONDetailed } from '@/services/llmClient';
import { AUTHOR_RANDOM_EVENT_SYSTEM, buildAuthorRandomEventUser } from '@/prompts/authorRandomEventSystem';
import { clamp, extractJSON, genId, nowMs } from '@/lib/utils';
import type { LlmUsage } from '@/types/llm';

export interface AuthorRandomEventRequest {
  settings: AppSettings;
  outline?: StoryOutline;
  background?: Background;
  characterName?: string;
  currentRound: number;
  nextRound: number;
  totalRounds: number;
  mustTrigger: boolean;
  scheduleReason: string;
  config: AuthorRandomEventConfig;
  summary?: string;
  longTermMemory?: string;
  latestStory: string;
  recent: Message[];
  npcs: Npc[];
  currentScene?: SceneRef;
  referenceEvents: RandomEvent[];
  worldBookEntries?: WorldBookEntry[];
  backpack?: Item[];
  anchors?: MemoryAnchor[];
  narrative?: AuthorNarrativeState;
  signal?: AbortSignal;
}

export interface AuthorRandomEventResult {
  trigger: boolean;
  reason?: string;
  arc?: StoryArc;
  thinking?: string;
  rawOutput?: string;
  usage?: LlmUsage;
}

function cleanText(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

function sanitizeStringList(raw: unknown, maxItems: number, maxChars: number): string[] {
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

function sanitizeStage(raw: unknown, nextRound: number, fallbackEnd: number, index: number): StoryArcStage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const start = Math.max(nextRound, Math.floor(Number(obj.startRound) || nextRound));
  const end = Math.max(start, Math.floor(Number(obj.endRound) || fallbackEnd || start));
  const goal = cleanText(obj.goal, 300);
  if (!goal) return undefined;
  return {
    id: genId('stage'),
    startRound: start,
    endRound: end,
    title: cleanText(obj.title, 60) || `阶段 ${index + 1}`,
    goal,
    requiredBeats: sanitizeStringList(obj.requiredBeats, 8, 80),
    avoid: cleanText(obj.avoid, 240) || undefined,
  };
}

function sanitizeArc(raw: unknown, p: AuthorRandomEventRequest): StoryArc | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const title = cleanText(obj.title, 80);
  const directive = cleanText(obj.directive, 1200);
  if (!title || !directive) return undefined;

  const isInfinite = !p.totalRounds || p.totalRounds <= 0;
  const maxEnd = isInfinite ? p.nextRound + 12 : Math.max(p.nextRound, p.totalRounds);
  const rawTarget = Math.floor(Number(obj.targetEndRound) || p.nextRound + 4);
  const targetEndRound = clamp(rawTarget, p.nextRound, maxEnd);
  const rawStages = Array.isArray(obj.stages) ? obj.stages : [];
  const stages = rawStages
    .map((stage, index) => sanitizeStage(stage, p.nextRound, targetEndRound, index))
    .filter((stage): stage is StoryArcStage => !!stage)
    .slice(0, 8);

  if (!stages.length) {
    stages.push({
      id: genId('stage'),
      startRound: p.nextRound,
      endRound: targetEndRound,
      title: '事件推进',
      goal: directive.slice(0, 300),
      requiredBeats: [],
    });
  }

  const now = nowMs();
  return {
    id: genId('arc_ev'),
    type: 'randomEvent',
    title,
    summary: cleanText(obj.summary, 500) || title,
    directive,
    hiddenIntent: cleanText(obj.hiddenIntent, 800) || undefined,
    involvedNpcIds: [],
    involvedNpcNames: sanitizeStringList(obj.involvedNpcNames, 10, 30),
    tags: sanitizeStringList(obj.tags, 12, 20),
    startRound: p.nextRound,
    targetEndRound,
    currentStageIndex: 0,
    stages,
    status: 'pending',
    progressNote: cleanText(obj.progressNote, 500) || undefined,
    createdAt: now,
    updatedAtRound: p.currentRound,
  };
}

function parseResult(text: string, p: AuthorRandomEventRequest): AuthorRandomEventResult | undefined {
  const obj = extractJSON<Record<string, unknown>>(text);
  if (!obj) return undefined;
  const trigger = obj.trigger === true;
  const reason = cleanText(obj.reason, 200) || undefined;
  if (!trigger) return { trigger: false, reason };
  const arc = sanitizeArc(obj.arc, p);
  if (!arc) return undefined;
  return { trigger: true, reason, arc };
}

export async function requestAuthorRandomEvent(p: AuthorRandomEventRequest): Promise<AuthorRandomEventResult> {
  const model = p.settings.randomModel?.trim() || p.settings.decisionModel || p.settings.storyModel;
  const user = buildAuthorRandomEventUser(p);
  const runOnce = async (temperature: number) => {
    const result = await chatJSONDetailed(
      { baseUrl: p.settings.apiBaseUrl, apiKey: p.settings.apiKey, format: p.settings.apiFormat },
      {
        model,
        temperature,
        messages: [
          { role: 'system', content: AUTHOR_RANDOM_EVENT_SYSTEM },
          { role: 'user', content: user },
        ],
        signal: p.signal,
      },
    );
    const parsed = parseResult(result.text, p);
    return parsed ? { ...parsed, thinking: result.thinking, rawOutput: result.text, usage: result.usage } : undefined;
  };

  const first = await runOnce(p.mustTrigger ? 0.45 : 0.65).catch((err) => {
    console.warn('[authorRandomEventAgent] first attempt failed', err);
    return undefined;
  });
  if (first && (!p.mustTrigger || first.trigger)) return first;

  const retry = await runOnce(p.mustTrigger ? 0.25 : 0.45).catch((err) => {
    console.warn('[authorRandomEventAgent] retry failed', err);
    return undefined;
  });
  if (retry && (!p.mustTrigger || retry.trigger)) return retry;

  return {
    trigger: false,
    reason: p.mustTrigger ? '必定触发区间内生成失败，已跳过本次尝试。' : '模型判断暂不适合触发或生成失败。',
  };
}

export function storyArcToRandomEvent(arc: StoryArc): RandomEvent {
  return {
    id: arc.id,
    name: arc.title,
    directive: [
      arc.directive,
      arc.targetEndRound ? `请将此长线事件在第 ${arc.targetEndRound} 回合前后自然收束。` : '',
      arc.hiddenIntent ? `幕后真实意图：${arc.hiddenIntent}（仅供导演规划，未揭示前不得直白写出）` : '',
    ].filter(Boolean).join('\n'),
    probability: 1,
    minRound: arc.startRound,
    cooldown: 0,
    once: true,
    tags: Array.from(new Set(['执笔模式', '动态长线事件', ...arc.tags])),
    arc,
  };
}
