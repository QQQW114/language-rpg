import type { AppSettings } from '@/types/settings';
import type { Background, RandomEvent, StoryOutline, WorldBookEntry } from '@/types/content';
import type {
  AuthorNarrativeState,
  AuthorRandomEventConfig,
  GameSave,
  Item,
  MemoryAnchor,
  Message,
  NarrativeEventLifecycle,
  Npc,
  SceneRef,
  StoryArc,
  StoryArcStage,
} from '@/types/game';
import { chatJSONDetailed } from '@/services/llmClient';
import { AUTHOR_RANDOM_EVENT_SYSTEM, buildAuthorRandomEventUser } from '@/prompts/authorRandomEventSystem';
import { clamp, extractJSON, genId, nowMs } from '@/lib/utils';
import type { LlmUsage } from '@/types/llm';
import { withPromptTrace } from '@/lib/agentTrace';
import { appendWorkspaceManifest, appendWorkspaceSystem, buildWorkspaceToolRuntime } from '@/services/workspaceTools';

export interface AuthorRandomEventRequest {
  save?: GameSave;
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
  onDelta?: (text: string) => void;
  onThinkingDelta?: (text: string) => void;
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

function sanitizeLifecycle(raw: unknown, fallback: NarrativeEventLifecycle): NarrativeEventLifecycle {
  const value = cleanText(raw, 32) as NarrativeEventLifecycle;
  return EVENT_LIFECYCLES.includes(value) ? value : fallback;
}

function sanitizeNumber(raw: unknown, min: number, max: number): number | undefined {
  const value = Number(raw);
  if (!Number.isFinite(value)) return undefined;
  return clamp(Math.round(value), min, max);
}

function sanitizeRelationshipDeltas(raw: unknown): StoryArc['relationshipDeltas'] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: NonNullable<StoryArc['relationshipDeltas']> = [];
  for (const item of raw.slice(0, 10)) {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const npcId = cleanText(row.npcId, 40);
    const npcName = cleanText(row.npcName, 30);
    if (!npcId && !npcName) continue;
    out.push({
      npcId: npcId || undefined,
      npcName: npcName || undefined,
      affinityDelta: sanitizeNumber(row.affinityDelta, -100, 100),
      trustDelta: sanitizeNumber(row.trustDelta, -100, 100),
      note: cleanText(row.note, 120) || undefined,
    });
  }
  return out.length ? out : undefined;
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
    lifecycle: sanitizeLifecycle(obj.lifecycle ?? obj.status, 'candidate'),
    surfaceGoal: cleanText(obj.surfaceGoal, 500) || undefined,
    hiddenIntent: cleanText(obj.hiddenIntent, 800) || undefined,
    completionCriteria: sanitizeStringList(obj.completionCriteria, 8, 100),
    failureCriteria: sanitizeStringList(obj.failureCriteria, 8, 100),
    abandonCriteria: sanitizeStringList(obj.abandonCriteria, 8, 100),
    worldProgressDelta: sanitizeNumber(obj.worldProgressDelta, -100, 100),
    relationshipDeltas: sanitizeRelationshipDeltas(obj.relationshipDeltas),
    progressPercent: sanitizeNumber(obj.progressPercent, 0, 100) ?? 0,
    writingBoundary: cleanText(obj.writingBoundary, 220) || undefined,
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
  const workspace = p.settings.apiFormat === 'chat' ? await buildWorkspaceToolRuntime(p.save, { agentKind: 'randomEvent' }) : {};
  const user = appendWorkspaceManifest(buildAuthorRandomEventUser(p), workspace.userManifest);
  const system = appendWorkspaceSystem(AUTHOR_RANDOM_EVENT_SYSTEM, workspace.systemRules);
  const runOnce = async (temperature: number) => {
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
        maxToolRounds: 3,
        onDelta: p.onDelta,
        onThinkingDelta: p.onThinkingDelta,
        signal: p.signal,
      },
    );
    const parsed = parseResult(result.text, p);
    return parsed ? withPromptTrace({ ...parsed, thinking: result.thinking, rawOutput: result.text, usage: result.usage }, result.trace) : undefined;
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
      arc.surfaceGoal ? `明面目标：${arc.surfaceGoal}` : '',
      arc.targetEndRound ? `请将此长线事件在第 ${arc.targetEndRound} 回合前后自然收束。` : '',
      arc.hiddenIntent ? `幕后真实意图：${arc.hiddenIntent}（仅供导演规划，未揭示前不得直白写出）` : '',
      arc.completionCriteria?.length ? `完成标准：${arc.completionCriteria.join('；')}` : '',
      arc.failureCriteria?.length ? `失败/延后标准：${arc.failureCriteria.join('；')}` : '',
      arc.writingBoundary ? `写作边界：${arc.writingBoundary}` : '',
    ].filter(Boolean).join('\n'),
    probability: 1,
    minRound: arc.startRound,
    cooldown: 0,
    once: true,
    tags: Array.from(new Set(['执笔模式', '动态长线事件', ...arc.tags])),
    arc,
  };
}
