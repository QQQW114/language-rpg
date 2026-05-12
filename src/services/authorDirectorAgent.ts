import type { AppSettings } from '@/types/settings';
import type { Background, StoryOutline, WorldBookEntry } from '@/types/content';
import type {
  AuthorDirectorConfig,
  AuthorNarrativeState,
  AuthorRandomEventState,
  GameSave,
  Item,
  MemoryAnchor,
  Message,
  NarrativeBriefCharacter,
  NarrativeBriefEvent,
  NarrativeBriefScene,
  NarrativeBriefState,
  NarrativeEventLifecycle,
  NarrativeEventUpdate,
  OrchestratorDirectorMode,
  OutlineMappingAlignment,
  OutlineMappingState,
  NarrativePlanState,
  Npc,
  SceneRef,
  ToolActivityRecord,
} from '@/types/game';
import type { StrictCustomConfig } from '@/types/custom';
import { chatJSONDetailed, type ChatMessage, type ChatToolInvocation } from '@/services/llmClient';
import { AUTHOR_DIRECTOR_SYSTEM, buildAuthorDirectorUser } from '@/prompts/authorDirectorSystem';
import { AUTHOR_DIRECTOR_REPLY_SYSTEM, buildAuthorDirectorReplyUser } from '@/prompts/authorDirectorReplySystem';
import { clamp, extractJSON, genId } from '@/lib/utils';
import { withPromptTrace } from '@/lib/agentTrace';
import { appendWorkspaceManifest, appendWorkspaceSystem, buildWorkspaceToolRuntime } from '@/services/workspaceTools';
import { useGameStore } from '@/store/useGameStore';
import type { AgentPromptTrace } from '@/types/ledger';
import { resolveAuthorCallModel, resolveAuthorCoreModel } from '@/lib/agentModels';

export interface AuthorDirectorRequest {
  save?: GameSave;
  settings: AppSettings;
  outline?: StoryOutline;
  background?: Background;
  characterName?: string;
  currentRound: number; // 已完成回合
  nextRound: number;    // 要规划的下一回合
  totalRounds: number;
  config: AuthorDirectorConfig;
  directorMode?: OrchestratorDirectorMode;
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
  onDelta?: (text: string) => void;
  onThinkingDelta?: (text: string) => void;
  onToolActivity?: (activity: ToolActivityRecord) => void;
  signal?: AbortSignal;
}

export interface DirectorReplyRequest {
  save: GameSave;
  settings: AppSettings;
  question: string;
  missingInfo?: string;
  firstDirectorTrace?: AgentPromptTrace;
  firstDirectorOutput?: string;
  onDelta?: (text: string) => void;
  onThinkingDelta?: (text: string) => void;
  signal?: AbortSignal;
  onToolActivity?: (activity: ToolActivityRecord) => void;
}

export interface DirectorReplyResult {
  callId: string;
  answer: string;
  thinking?: string;
  rawOutput?: string;
  usage?: NarrativePlanState['usage'];
  trace?: AgentPromptTrace;
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

function sanitizeBriefCharacter(raw: unknown): NarrativeBriefCharacter | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const row = raw as Record<string, unknown>;
  const name = cleanText(row.name, 30);
  if (!name) return undefined;
  return {
    name,
    role: cleanText(row.role, 40),
    surfaceGoal: cleanText(row.surfaceGoal, 160),
    hiddenIntent: cleanText(row.hiddenIntent, 160),
    visibleBehavior: cleanText(row.visibleBehavior, 180),
    doNotReveal: stringList(row.doNotReveal, 5, 80),
  };
}

function sanitizeBriefEvent(raw: unknown): NarrativeBriefEvent | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const row = raw as Record<string, unknown>;
  const lifecycleRaw = cleanText(row.lifecycle ?? row.status, 24) as NarrativeEventLifecycle | undefined;
  return {
    title: cleanText(row.title, 60),
    lifecycle: lifecycleRaw && EVENT_LIFECYCLES.includes(lifecycleRaw) ? lifecycleRaw : undefined,
    objective: cleanText(row.objective, 180),
    hiddenIntent: cleanText(row.hiddenIntent, 180),
    completionCriteria: stringList(row.completionCriteria, 5, 90),
    failureCriteria: stringList(row.failureCriteria, 5, 90),
    progress: cleanText(row.progress, 120),
    stopAt: cleanText(row.stopAt, 140),
  };
}

function sanitizeBriefScene(raw: unknown): NarrativeBriefScene | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const row = raw as Record<string, unknown>;
  const scene: NarrativeBriefScene = {
    location: cleanText(row.location ?? row.name, 80),
    time: cleanText(row.time, 60),
    weather: cleanText(row.weather, 60),
    atmosphere: cleanText(row.atmosphere ?? row.mood, 140),
    resources: stringList(row.resources ?? row.sceneResources, 8, 90),
    constraints: stringList(row.constraints, 6, 90),
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

function sanitizeWritingBrief(raw: unknown, p: AuthorDirectorRequest): NarrativeBriefState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const objective = cleanText(obj.objective ?? obj.thisRoundObjective, 180);
  const writingBoundary = cleanText(obj.writingBoundary ?? obj.stopAt, 180);
  if (!objective || !writingBoundary) return undefined;

  const characters = Array.isArray(obj.characters)
    ? obj.characters.map(sanitizeBriefCharacter).filter(Boolean).slice(0, 8) as NarrativeBriefCharacter[]
    : undefined;
  return {
    objective,
    mustFollow: stringList(obj.mustFollow, 10, 120),
    currentEvent: sanitizeBriefEvent(obj.currentEvent),
    characters: characters?.length ? characters : undefined,
    scene: sanitizeBriefScene(obj.scene ?? obj.scenePlan),
    sceneResources: stringList(obj.sceneResources, 10, 100),
    writingBoundary,
    successCriteria: stringList(obj.successCriteria, 8, 100),
    avoid: stringList(obj.avoid, 8, 100),
    hiddenKnowledge: stringList(obj.hiddenKnowledge, 8, 120),
    updatedAtRound: p.currentRound,
  };
}

function sanitizeOutlineMapping(raw: unknown, p: AuthorDirectorRequest): OutlineMappingState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const alignmentRaw = cleanText(obj.alignment ?? obj.status, 32) as OutlineMappingAlignment | undefined;
  const alignment = alignmentRaw && OUTLINE_ALIGNMENTS.includes(alignmentRaw)
    ? alignmentRaw
    : 'uncertain';
  const currentActIndexRaw = Number(obj.currentActIndex);
  const stageProgressRaw = Number(obj.stageProgress ?? obj.progress);
  return {
    alignment,
    currentAct: cleanText(obj.currentAct, 80),
    currentActIndex: Number.isFinite(currentActIndexRaw)
      ? clamp(Math.floor(currentActIndexRaw), 0, 99)
      : undefined,
    currentStageGoal: cleanText(obj.currentStageGoal ?? obj.stageGoal, 180),
    stageProgress: Number.isFinite(stageProgressRaw)
      ? clamp(Math.round(stageProgressRaw), 0, 100)
      : undefined,
    missingBridgeEvents: stringList(obj.missingBridgeEvents ?? obj.missingBridges, 6, 100),
    candidateEvents: stringList(obj.candidateEvents ?? obj.eventNeeds, 6, 100),
    driftRisks: stringList(obj.driftRisks ?? obj.risks, 6, 100),
    nextMilestone: cleanText(obj.nextMilestone, 140),
    updatedAtRound: p.currentRound,
  };
}

function sanitizeEventUpdates(raw: unknown): NarrativeEventUpdate[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: NarrativeEventUpdate[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const arcId = cleanText(row.arcId ?? row.id, 80);
    const title = cleanText(row.title, 80);
    if (!arcId && !title) continue;
    const lifecycleRaw = cleanText(row.lifecycle ?? row.status, 32) as NarrativeEventLifecycle | undefined;
    const progressRaw = Number(row.progressPercent ?? row.progress);
    const stageRaw = Number(row.currentStageIndex);
    out.push({
      arcId,
      title,
      lifecycle: lifecycleRaw && EVENT_LIFECYCLES.includes(lifecycleRaw) ? lifecycleRaw : undefined,
      progressPercent: Number.isFinite(progressRaw) ? clamp(Math.round(progressRaw), 0, 100) : undefined,
      progressNote: cleanText(row.progressNote ?? row.note, 220),
      currentStageIndex: Number.isFinite(stageRaw) ? Math.max(0, Math.floor(stageRaw)) : undefined,
      reason: cleanText(row.reason, 160),
    });
    if (out.length >= 8) break;
  }
  return out.length ? out : undefined;
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
    outlineMapping: sanitizeOutlineMapping(obj.outlineMapping ?? obj.outlineMap ?? obj.mapping, p),
    eventUpdates: sanitizeEventUpdates(obj.eventUpdates ?? obj.arcUpdates),
    pacingAdvice: cleanText(obj.pacingAdvice, 220),
    riskNotes: stringList(obj.riskNotes, 5, 120),
    writingBrief: sanitizeWritingBrief(obj.writingBrief ?? obj.narrativeBrief ?? obj.brief, p),
    updatedAtRound: p.currentRound,
  };
}

function traceMessagesToDirectorReplyHistory(
  trace: AgentPromptTrace | undefined,
  firstDirectorOutput: string | undefined,
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const item of trace?.messages ?? []) {
    const role = String(item.role ?? '').trim();
    const content = String(item.content ?? '').trim();
    if (!content || role === 'system') continue;
    if (role === 'assistant') {
      messages.push({ role: 'assistant', content });
    } else if (role === 'user') {
      messages.push({ role: 'user', content });
    } else {
      // ledger 里的 tool 消息没有 tool_call_id，不能按原 role 重放；转为上下文文本保留信息。
      messages.push({ role: 'user', content: `【上一次导演调用中的工具/上下文记录】\n${content}` });
    }
  }

  const output = firstDirectorOutput?.trim();
  if (output) {
    messages.push({ role: 'assistant', content: output });
  }
  return messages.slice(-24);
}

function describeDirectorToolActivity(
  call: ChatToolInvocation,
  phase: 'call' | 'result',
  resultText?: string,
  agentKind: 'director' | 'directorReply' = 'director',
): ToolActivityRecord {
  const path = typeof call.arguments?.path === 'string' ? call.arguments.path.trim() : '';
  const query = typeof call.arguments?.query === 'string' ? call.arguments.query.trim() : '';
  const label = (() => {
    if (phase === 'result') return `完成工具：${call.name}`;
    switch (call.name) {
      case 'read_doc': return `阅读了 ${path || '司书库文件'}`;
      case 'search_docs': return `检索了「${query || '司书库'}」`;
      case 'list_docs': return `查看了 ${path || '司书库'} 目录`;
      case 'get_entity_doc': return `查阅了实体档案「${String(call.arguments?.name ?? '').trim() || path || '未命名'}」`;
      case 'get_recent_rounds': return '查阅了最近回合卷宗';
      case 'get_round_record': return `查阅了第 ${Math.floor(Number(call.arguments?.round) || 0)} 回合卷宗`;
      case 'get_current_round_agent_calls': return '查看了本回合模型记录';
      case 'get_recent_agent_calls': return '查看了近期模型记录';
      case 'get_agent_output': return '查阅了某次模型输出';
      case 'get_current_state': return '查看了当前旅程状态';
      case 'get_story_outline': return '查阅了故事大纲';
      case 'get_initial_scene': return '查阅了开局文本';
      case 'get_background': return '查阅了主角出身';
      case 'get_world_books': return '查阅了世界书';
      case 'get_journey_content': return '查阅了旅程配置';
      case 'get_active_arcs': return '查阅了进行中的事件弧';
      case 'get_active_events': return '查阅了随机事件状态';
      case 'get_latest_planning_bundle': return '查阅了最新规划包';
      case 'get_latest_director_plan': return '查阅了最新导演计划';
      case 'get_master_arc': return '查阅了主弧';
      case 'get_director_plan': return '查阅了导演计划';
      default: return `调用工具 ${call.name}`;
    }
  })();
  return {
    id: `${call.id}:${agentKind}:${phase}`,
    name: call.name,
    label,
    detail: phase === 'result' ? resultText?.slice(0, 240) : call.argumentsText,
    actor: '叙事导演',
    agentKind,
    phase,
    createdAt: Date.now(),
  };
}

export async function runDirectorReplyAgent(p: DirectorReplyRequest): Promise<DirectorReplyResult> {
  const question = cleanText(p.question, 1200);
  if (!question) {
    throw new Error('ask_director 缺少 question。');
  }
  const missingInfo = cleanText(p.missingInfo, 1200);
  const model = resolveAuthorCoreModel(p.settings, 'directorReply');
  const workspace = p.settings.apiFormat === 'chat'
    ? await buildWorkspaceToolRuntime(p.save, { agentKind: 'directorReply' })
    : {};
  const system = appendWorkspaceSystem(AUTHOR_DIRECTOR_REPLY_SYSTEM, workspace.systemRules);
  const user = appendWorkspaceManifest(
    buildAuthorDirectorReplyUser({ question, missingInfo }),
    workspace.userManifest,
    !!workspace.tools?.length,
  );
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    ...traceMessagesToDirectorReplyHistory(p.firstDirectorTrace, p.firstDirectorOutput),
    { role: 'user', content: user },
  ];

  const result = await chatJSONDetailed(
    { baseUrl: p.settings.apiBaseUrl, apiKey: p.settings.apiKey, format: p.settings.apiFormat },
    {
      model,
      temperature: 0.35,
      messages,
      tools: workspace.tools,
      onToolCall: workspace.onToolCall,
      onToolActivity: (activity) => {
        const event = describeDirectorToolActivity(
          activity.call,
          activity.phase,
          activity.resultText,
          'directorReply',
        );
        p.onToolActivity?.(event);
      },
      maxToolRounds: 1,
      onDelta: p.onDelta,
      onThinkingDelta: p.onThinkingDelta,
      signal: p.signal,
    },
  );

  const answer = result.text.trim();
  const callId = genId('director_reply');
  const createdAt = Date.now();
  const store = useGameStore.getState();
  store.addAgentThought(p.save.id, {
    id: callId,
    kind: 'directorReply',
    label: '叙事导演 · 回应询问',
    round: p.save.state.currentRound,
    content: result.thinking,
    output: answer,
    prompt: result.trace,
    usage: result.usage,
  });

  const latest = useGameStore.getState().saves[p.save.id] ?? p.save;
  useGameStore.getState().setAuthorNarrativeState(p.save.id, {
    ...(latest.state.authorNarrative ?? { activeArcs: [], completedArcs: [] }),
    directorReply: {
      callId,
      question,
      missingInfo,
      answer,
      round: p.save.state.currentRound,
      createdAt,
    },
  });

  return {
    callId,
    answer,
    thinking: result.thinking,
    rawOutput: result.text,
    usage: result.usage,
    trace: result.trace,
  };
}

export async function requestAuthorDirectorPlan(p: AuthorDirectorRequest): Promise<NarrativePlanState | undefined> {
  if ((p.directorMode ?? p.narrative?.orchestrator?.directorMode) === 'skip') return undefined;
  const model = resolveAuthorCallModel(p.settings, 'director');
  const workspace = p.settings.apiFormat === 'chat' ? await buildWorkspaceToolRuntime(p.save, { agentKind: 'director' }) : {};
  const user = appendWorkspaceManifest(buildAuthorDirectorUser(p), workspace.userManifest);
  const system = appendWorkspaceSystem(AUTHOR_DIRECTOR_SYSTEM, workspace.systemRules);

  const runOnce = async (temperature: number): Promise<NarrativePlanState | undefined> => {
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
        onToolActivity: (activity) => {
          const event = describeDirectorToolActivity(
            activity.call,
            activity.phase,
            activity.resultText,
            'director',
          );
          p.onToolActivity?.(event);
        },
        maxToolRounds: 3,
        onDelta: p.onDelta,
        onThinkingDelta: p.onThinkingDelta,
        signal: p.signal,
      },
    );
    const obj = extractJSON(result.text);
    const plan = sanitizePlan(obj, p);
    return plan ? withPromptTrace({ ...plan, thinking: result.thinking, rawOutput: result.text, usage: result.usage }, result.trace) : undefined;
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
