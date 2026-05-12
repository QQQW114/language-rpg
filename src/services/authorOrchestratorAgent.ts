import type { AppSettings } from '@/types/settings';
import type { StoryOutline, WorldBookEntry } from '@/types/content';
import type {
  AuthorNarrativeState,
  AuthorOrchestratorConfig,
  Item,
  MemoryAnchor,
  Message,
  Npc,
  OrchestratorCallDecision,
  OrchestratorCallKey,
  OrchestratorDirectorMode,
  OrchestratorFocusArea,
  OrchestratorPhase1Result,
  OrchestratorPlanSignal,
  OrchestratorPlanningMode,
  OrchestratorState,
  OrchestratorTurnType,
  PlannerAnalysisRequest,
  SceneRef,
  GameSave,
} from '@/types/game';
import { chatJSONDetailed, type ChatMessage, type ChatToolActivity } from '@/services/llmClient';
import {
  AUTHOR_ORCHESTRATOR_PHASE1_SYSTEM,
  AUTHOR_ORCHESTRATOR_PHASE2_SYSTEM,
  buildAuthorOrchestratorPhase1User,
  buildAuthorOrchestratorPhase2User,
} from '@/prompts/authorOrchestratorSystem';
import { extractJSON } from '@/lib/utils';
import { withPromptTrace } from '@/lib/agentTrace';
import { appendWorkspaceManifest, appendWorkspaceSystem, buildWorkspaceToolRuntime, type WorkspaceToolName } from '@/services/workspaceTools';
import { requestAuthorCharacterPlan } from '@/services/authorCharacterPlannerAgent';
import { requestAuthorScenePlan } from '@/services/authorScenePlannerAgent';
import { requestAuthorEventPlan } from '@/services/authorEventPlannerAgent';
import { useGameStore } from '@/store/useGameStore';
import { createWorkspaceDocument } from '@/storage/ledgerRepository';
import { resolveAuthorCoreModel } from '@/lib/agentModels';
import type { AgentPromptTrace } from '@/types/ledger';

export interface AuthorOrchestratorRequest {
  save?: GameSave;
  settings: AppSettings;
  outline?: StoryOutline;
  characterName?: string;
  worldBookEntries?: WorldBookEntry[];
  anchors?: MemoryAnchor[];
  availableScenes?: SceneRef[];
  currentRound: number;
  nextRound: number;
  totalRounds: number;
  playerInput?: string;
  latestStory?: string;
  recent: Message[];
  summary?: string;
  longTermMemory?: string;
  npcs?: Npc[];
  backpack?: Item[];
  currentScene?: SceneRef;
  narrative?: AuthorNarrativeState;
  config: AuthorOrchestratorConfig;
  unsummarizedCount?: number;
  maxHistoryRounds?: number;
  memoryEveryRounds?: number;
  onDelta?: (text: string) => void;
  onThinkingDelta?: (text: string) => void;
  signal?: AbortSignal;
  onToolActivity?: (activity: ChatToolActivity, phaseLabel?: string) => void;
}

const CALL_KEYS: OrchestratorCallKey[] = [
  'outlineMapper',
  'stageJudge',
  'settingGuard',
  'eventBeat',
  'director',
  'logicCheck',
  'memory',
  'summary',
];

const TURN_TYPES: OrchestratorTurnType[] = [
  'continue_current_event',
  'event_turning_point',
  'event_completion_check',
  'new_event_candidate',
  'stage_transition_candidate',
  'free_exploration',
];

const PLANNING_MODES: OrchestratorPlanningMode[] = ['light', 'focused', 'full'];
const DIRECTOR_MODES: OrchestratorDirectorMode[] = ['skip', 'light', 'full'];

const FOCUS_AREAS: OrchestratorFocusArea[] = [
  'outline',
  'stage',
  'character',
  'scene',
  'event',
  'foreshadowing',
  'setting',
  'memory',
  'logic',
  'summary',
];

function cleanText(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

function sanitizeDecision(raw: unknown): OrchestratorCallDecision {
  const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    run: obj.run === true,
    reason: cleanText(obj.reason, 160) || '司辰未提供理由。',
    hint: cleanText(obj.hint, 80) || undefined,
  };
}

function sanitizeFocusAreas(raw: unknown): OrchestratorFocusArea[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: OrchestratorFocusArea[] = [];
  for (const item of raw) {
    const area = String(item ?? '').trim() as OrchestratorFocusArea;
    if (!FOCUS_AREAS.includes(area) || out.includes(area)) continue;
    out.push(area);
    if (out.length >= 10) break;
  }
  return out.length ? out : undefined;
}

function sanitizePlanSignals(raw: unknown): OrchestratorPlanSignal[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: OrchestratorPlanSignal[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const area = cleanText(row.area, 24) as OrchestratorFocusArea;
    if (!FOCUS_AREAS.includes(area)) continue;
    const priorityRaw = cleanText(row.priority, 12);
    const priority = priorityRaw === 'high' || priorityRaw === 'medium' || priorityRaw === 'low'
      ? priorityRaw
      : 'medium';
    const reason = cleanText(row.reason, 180);
    if (!reason) continue;
    out.push({
      area,
      priority,
      reason,
      suggestedModel: cleanText(row.suggestedModel, 40) || undefined,
    });
    if (out.length >= 12) break;
  }
  return out.length ? out : undefined;
}

function sanitizeCallOrder(
  raw: unknown,
  calls: Record<OrchestratorCallKey, OrchestratorCallDecision>,
): OrchestratorCallKey[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: OrchestratorCallKey[] = [];
  for (const item of raw) {
    const key = String(item ?? '').trim() as OrchestratorCallKey;
    if (!CALL_KEYS.includes(key) || out.includes(key) || calls[key]?.run !== true) continue;
    out.push(key);
  }
  return out.length ? out : undefined;
}

function sanitizeOrchestrator(raw: unknown, p: AuthorOrchestratorRequest): OrchestratorState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const callsRaw = obj.calls && typeof obj.calls === 'object' ? obj.calls as Record<string, unknown> : obj;
  const calls = Object.fromEntries(
    CALL_KEYS.map((key) => [key, sanitizeDecision(callsRaw[key])]),
  ) as Record<OrchestratorCallKey, OrchestratorCallDecision>;
  const directorModeRaw = cleanText(obj.directorMode, 20) as OrchestratorDirectorMode;
  const directorMode = DIRECTOR_MODES.includes(directorModeRaw)
    ? directorModeRaw
    : calls.director?.run ? 'light' : 'skip';
  const hasActiveArcs = (p.narrative?.activeArcs ?? []).length > 0;
  if (!hasActiveArcs) {
    calls.eventBeat = {
      run: false,
      reason: calls.eventBeat?.reason || '当前没有 active 事件弧，司事跳过。',
      hint: calls.eventBeat?.hint,
    };
  }
  if (directorMode === 'skip') {
    calls.director = {
      run: false,
      reason: calls.director?.reason || 'directorMode=skip，本回合不运行叙事导演。',
      hint: calls.director?.hint,
    };
  }
  const phase1 = sanitizePhase1(obj.phase1, p.currentRound);
  return {
    updatedAtRound: p.currentRound,
    overall: cleanText(obj.overall, 220) || undefined,
    turnType: TURN_TYPES.includes(cleanText(obj.turnType, 40) as OrchestratorTurnType)
      ? cleanText(obj.turnType, 40) as OrchestratorTurnType
      : undefined,
    planningMode: PLANNING_MODES.includes(cleanText(obj.planningMode, 20) as OrchestratorPlanningMode)
      ? cleanText(obj.planningMode, 20) as OrchestratorPlanningMode
      : undefined,
    directorMode,
    focusAreas: sanitizeFocusAreas(obj.focusAreas),
    planSignals: sanitizePlanSignals(obj.planSignals),
    callOrder: sanitizeCallOrder(obj.callOrder, calls),
    calls,
    phase1,
  };
}

function sanitizePhase1(raw: unknown, currentRound: number): OrchestratorPhase1Result | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const notes = cleanText(obj.notes, 1200);
  const signalRaw = obj.signalSnapshot && typeof obj.signalSnapshot === 'object'
    ? obj.signalSnapshot as Record<string, unknown>
    : undefined;
  if (!notes && !cleanText(obj.rawOutput, 2000)) return undefined;
  return {
    updatedAtRound: currentRound,
    notes: notes || 'Phase 1 未提供摘要。',
    outstandingQuestions: Array.isArray(obj.outstandingQuestions)
      ? obj.outstandingQuestions.map((x) => cleanText(x, 120)).filter(Boolean).slice(0, 8)
      : undefined,
    signalSnapshot: signalRaw
      ? {
        outline: cleanText(signalRaw.outline, 220),
        stage: cleanText(signalRaw.stage, 220),
        activeEvents: cleanText(signalRaw.activeEvents, 220),
      }
      : undefined,
    earlyExit: obj.earlyExit === true,
  };
}

function isRetrospectiveCriticalRequest(p: AuthorOrchestratorRequest): boolean {
  const input = (p.playerInput ?? '').trim();
  if (!input) return false;
  const text = input.toLowerCase();
  const hasRetrospectiveSignal = /回忆|回想|想起|复盘|刚刚|刚才|当时|开局|一开始|从.*开始|怎么.*发生|怎么.*变|发生了什么|补写|补全/.test(text);
  if (!hasRetrospectiveSignal) return false;
  return /开局|一开始|刚刚|刚才|当时|能力|觉醒|异能|身份|秘密|厕所|女厕|男厕|关键|大纲|第一幕|第一章|起因/.test(text);
}

export function fallbackOrchestratorDecision(p: AuthorOrchestratorRequest): OrchestratorState {
  const plan = p.narrative?.plan;
  const outlineMapping = p.narrative?.outlineMapping ?? plan?.outlineMapping;
  const planCovered = !!plan?.nextFewRoundsPlan?.some((item) =>
    p.nextRound >= item.startRound && p.nextRound <= item.endRound,
  );
  const unsummarized = p.unsummarizedCount ?? 0;
  const maxHistory = Math.max(4, p.maxHistoryRounds ?? 22);
  const memoryEvery = Math.max(0, p.memoryEveryRounds ?? 0);
  const memoryDue = memoryEvery > 0 && p.currentRound > 0 && p.currentRound % memoryEvery === 0;
  const logicLast = p.narrative?.lastLogicCheckRound ?? 0;
  const retrospectiveCritical = isRetrospectiveCriticalRequest(p);
  const pureContinuation = !p.playerInput?.trim() && !!plan && planCovered && !retrospectiveCritical;
  const hasActiveArcs = (p.narrative?.activeArcs ?? []).length > 0;
  const directorMode: OrchestratorDirectorMode = retrospectiveCritical || !plan || !planCovered
    ? 'full'
    : pureContinuation ? 'skip' : 'light';
  const calls: Record<OrchestratorCallKey, OrchestratorCallDecision> = {
    outlineMapper: {
      run: retrospectiveCritical || !outlineMapping || !planCovered,
      reason: retrospectiveCritical
        ? '保底：玩家触及回溯/补写关键大纲事件，需要先重做大纲映射。'
        : !outlineMapping ? '保底：当前没有独立大纲映射。' : !planCovered ? '保底：导演计划未覆盖下一回合，需要刷新大纲映射。' : '保底：大纲映射仍可参考。',
    },
    stageJudge: {
      run: true,
      reason: retrospectiveCritical
        ? '保底：玩家在回忆/补写关键过去事件，需要阶段判断识别本回合意图。'
        : '保底：故事生成前需要检查当前阶段与玩家节奏是否过期。',
    },
    settingGuard: {
      run: retrospectiveCritical,
      reason: retrospectiveCritical
        ? '保底：玩家触及开局/能力/身份等关键因果，需要设定守护锁定大纲边界。'
        : '保底：未发现必须立即守护的信号。',
    },
    eventBeat: {
      run: hasActiveArcs,
      reason: hasActiveArcs
        ? '保底：存在 active 事件弧，需要司事判定事件节奏与是否结算。'
        : '保底：当前没有 active 事件弧，跳过司事。',
      hint: hasActiveArcs ? '对照完成/失败标准判定事件进度，必要时结算。' : undefined,
    },
    director: {
      run: directorMode !== 'skip',
      reason: retrospectiveCritical
        ? '保底：回溯补写关键事件可能改变当前叙事焦点，需要导演重新对齐。'
        : !plan ? '保底：当前没有导演计划。' : !planCovered ? '保底：导演计划未覆盖下一回合。' : directorMode === 'skip' ? '保底：纯续写且旧计划仍覆盖，跳过叙事导演。' : '保底：轻量刷新本回合 writingBrief。',
    },
    memory: {
      run: memoryDue,
      reason: memoryDue ? '保底：达到记忆更新频率。' : '保底：未达到记忆更新频率。',
    },
    summary: {
      run: unsummarized > maxHistory,
      reason: unsummarized > maxHistory ? '保底：未摘要上下文超过阈值。' : '保底：上下文仍在阈值内。',
    },
    logicCheck: {
      run: retrospectiveCritical || (p.currentRound > 0 && p.currentRound - logicLast >= 4),
      reason: retrospectiveCritical
        ? '保底：回忆/补写过去关键事件后需要审校时间线与大纲一致性。'
        : p.currentRound > 0 && p.currentRound - logicLast >= 4 ? '保底：逻辑审校较久未运行。' : '保底：逻辑审校近期运行过。',
    },
  };
  return {
    updatedAtRound: p.currentRound,
    overall: '使用保底调度。',
    turnType: retrospectiveCritical ? 'event_turning_point' : !plan ? 'new_event_candidate' : 'continue_current_event',
    planningMode: retrospectiveCritical || !plan || !planCovered ? 'focused' : 'light',
    directorMode,
    focusAreas: retrospectiveCritical
      ? ['outline', 'stage', 'setting', 'logic']
      : !plan || !planCovered
        ? ['outline', 'stage', 'event']
        : ['event'],
    planSignals: retrospectiveCritical
      ? [
        { area: 'outline', priority: 'high', reason: '玩家触及回溯/补写关键大纲事件，需要核对大纲与开局。', suggestedModel: 'stageJudge' },
        { area: 'setting', priority: 'high', reason: '回溯内容可能改写能力/身份机制，需要设定守护。', suggestedModel: 'settingGuard' },
      ]
      : undefined,
    callOrder: [
      calls.outlineMapper.run ? 'outlineMapper' : undefined,
      calls.stageJudge.run ? 'stageJudge' : undefined,
      calls.settingGuard.run ? 'settingGuard' : undefined,
      calls.eventBeat.run ? 'eventBeat' : undefined,
      calls.director.run ? 'director' : undefined,
      calls.logicCheck.run ? 'logicCheck' : undefined,
      calls.memory.run ? 'memory' : undefined,
      calls.summary.run ? 'summary' : undefined,
    ].filter(Boolean) as OrchestratorCallKey[],
    calls,
  };
}

function parseAnalysisRequest(args: Record<string, unknown>, toolName: WorkspaceToolName): PlannerAnalysisRequest | { error: string } {
  const question = cleanText(args.question, 300);
  const reason = cleanText(args.reason, 240);
  if (!question || !reason) {
    return { error: `${toolName} 需要 question 和 reason。` };
  }
  const relatedNames = Array.isArray(args.relatedNames)
    ? args.relatedNames.map((x) => cleanText(x, 40)).filter(Boolean).slice(0, 8)
    : typeof args.relatedNames === 'string'
      ? args.relatedNames.split(/[,\n，、]+/).map((x) => cleanText(x, 40)).filter(Boolean).slice(0, 8)
      : undefined;
  return {
    question,
    reason,
    focus: cleanText(args.focus, 160) || undefined,
    relatedNames: relatedNames?.length ? relatedNames : undefined,
    expectedOutput: cleanText(args.expectedOutput, 240) || undefined,
  };
}

function summarizeAnalysisResult(toolName: WorkspaceToolName, plan: unknown): unknown {
  if (!plan || typeof plan !== 'object') return { toolName, result: plan ?? null };
  const p = plan as any;
  if (toolName === 'run_character_analysis') {
    return {
      toolName,
      saved: true,
      updatedAtRound: p.updatedAtRound,
      summary: p.summary,
      characters: Array.isArray(p.characters) ? p.characters.slice(0, 6) : undefined,
      relationshipSignals: p.relationshipSignals,
      absentCharacters: p.absentCharacters,
      risks: p.risks,
    };
  }
  if (toolName === 'run_scene_analysis') {
    return {
      toolName,
      saved: true,
      updatedAtRound: p.updatedAtRound,
      scene: p.scene,
      sceneLogic: p.sceneLogic,
      sceneResources: p.sceneResources,
      constraints: p.constraints,
      opportunities: p.opportunities,
      risks: p.risks,
    };
  }
  return {
    toolName,
    saved: true,
    updatedAtRound: p.updatedAtRound,
    summary: p.summary,
    currentEvent: p.currentEvent,
    eventUpdates: p.eventUpdates,
    candidateEvents: p.candidateEvents,
    writingBoundary: p.writingBoundary,
    successCriteria: p.successCriteria,
    avoid: p.avoid,
  };
}

function analysisToolMeta(toolName: WorkspaceToolName): {
  kind: 'characterPlanner' | 'scenePlanner' | 'eventPlanner';
  label: string;
  fileName: string;
  title: string;
  summaryField: string;
} {
  if (toolName === 'run_character_analysis') {
    return {
      kind: 'characterPlanner',
      label: '人物规划员',
      fileName: 'character-plan',
      title: '人物规划',
      summaryField: 'summary',
    };
  }
  if (toolName === 'run_scene_analysis') {
    return {
      kind: 'scenePlanner',
      label: '场景规划员',
      fileName: 'scene-plan',
      title: '场景规划',
      summaryField: 'sceneLogic',
    };
  }
  return {
    kind: 'eventPlanner',
    label: '事件规划员',
    fileName: 'event-plan',
    title: '事件规划',
    summaryField: 'summary',
  };
}

function stripVolatilePlanningFields(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value, (key, val) => (
      key === 'thinking' || key === 'rawOutput' || key === 'usage' || key === 'trace'
        ? undefined
        : val
    )));
  } catch {
    return value;
  }
}

function planOutputText(plan: unknown): string | undefined {
  if (!plan || typeof plan !== 'object') return plan == null ? undefined : String(plan);
  const raw = (plan as { rawOutput?: unknown }).rawOutput;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  try {
    return JSON.stringify(stripVolatilePlanningFields(plan), null, 2);
  } catch {
    return String(plan);
  }
}

function planSummary(toolName: WorkspaceToolName, plan: unknown): string {
  const meta = analysisToolMeta(toolName);
  const obj = plan && typeof plan === 'object' ? plan as Record<string, unknown> : {};
  const summary = String(obj[meta.summaryField] ?? obj.summary ?? '').trim();
  if (summary) return summary.slice(0, 220);
  return `${meta.title}已更新。`;
}

function recordAnalysisAgentThought(
  save: GameSave,
  toolName: WorkspaceToolName,
  plan: unknown,
  round: number,
): void {
  if (!plan || typeof plan !== 'object') return;
  const meta = analysisToolMeta(toolName);
  const obj = plan as {
    thinking?: string;
    trace?: AgentPromptTrace;
    usage?: OrchestratorState['usage'];
  };
  useGameStore.getState().addAgentThought(save.id, {
    kind: meta.kind,
    label: meta.label,
    round,
    content: obj.thinking,
    output: planOutputText(plan),
    prompt: obj.trace,
    usage: obj.usage,
  });
}

async function writeAnalysisPlanArtifacts(
  save: GameSave | undefined,
  toolName: WorkspaceToolName,
  plan: unknown,
  round: number,
  analysisRequest: PlannerAnalysisRequest,
): Promise<void> {
  if (!save || !plan) return;
  const meta = analysisToolMeta(toolName);
  const content = JSON.stringify({
    analysisRequest,
    result: stripVolatilePlanningFields(plan),
  }, null, 2);
  const common = {
    saveId: save.id,
    kind: 'director' as const,
    content,
    summary: planSummary(toolName, plan),
    tags: ['planning', meta.kind, 'analysisTool'],
    updatedAtRound: round,
    updatedBy: meta.kind,
    provenance: {
      round,
      note: `orchestrator tool: ${toolName}`,
    },
  };
  await Promise.all([
    createWorkspaceDocument({
      ...common,
      path: `planning/latest/${meta.fileName}.json`,
      title: `最新${meta.title}`,
    }),
    createWorkspaceDocument({
      ...common,
      path: `planning/rounds/${round}/${meta.fileName}.json`,
      title: `第 ${round} 回合${meta.title}`,
    }),
  ]).catch((err) => {
    console.warn('[authorOrchestratorAgent] write analysis planning artifact failed', err);
  });
}

function buildAnalysisToolHandler(p: AuthorOrchestratorRequest) {
  return async (name: WorkspaceToolName, args: Record<string, unknown>): Promise<unknown> => {
    if (name !== 'run_character_analysis' && name !== 'run_scene_analysis' && name !== 'run_event_analysis') {
      return { error: `不是司辰分析工具：${name}` };
    }
    const analysisRequest = parseAnalysisRequest(args, name);
    if ('error' in analysisRequest) return analysisRequest;
    const baseSave = p.save;
    if (!baseSave) return { error: `${name} 需要当前旅程存档。` };
    const store = useGameStore.getState();
    const save = store.saves[baseSave.id] ?? baseSave;
    const narrative = save.state.authorNarrative ?? p.narrative ?? { activeArcs: [], completedArcs: [] };
    const common = {
      save,
      settings: p.settings,
      outline: p.outline,
      currentRound: p.currentRound,
      nextRound: p.nextRound,
      playerInput: p.playerInput,
      latestStory: p.latestStory,
      recent: p.recent,
      summary: save.state.summary ?? p.summary,
      longTermMemory: save.state.longTermMemory ?? p.longTermMemory,
      npcs: save.state.npcs ?? p.npcs ?? [],
      backpack: save.state.backpack ?? p.backpack ?? [],
      currentScene: save.state.currentScene ?? p.currentScene,
      narrative,
      randomEventState: save.state.authorRandomEventState,
      worldBookEntries: p.worldBookEntries,
      anchors: save.state.anchors ?? p.anchors,
      analysisRequest,
      signal: p.signal,
    };

    if (name === 'run_character_analysis') {
      const plan = await requestAuthorCharacterPlan({
        ...common,
        characterName: p.characterName ?? save.content.characterName,
      });
      if (!plan) return { error: '人物分析未返回可用结果。' };
      useGameStore.getState().setAuthorCharacterPlan(save.id, plan, p.currentRound);
      recordAnalysisAgentThought(save, name, plan, p.currentRound);
      await writeAnalysisPlanArtifacts(save, name, plan, p.currentRound, analysisRequest);
      return summarizeAnalysisResult(name, plan);
    }
    if (name === 'run_scene_analysis') {
      const plan = await requestAuthorScenePlan({
        ...common,
        availableScenes: p.availableScenes ?? save.state.availableScenes ?? [],
      });
      if (!plan) return { error: '场景分析未返回可用结果。' };
      useGameStore.getState().setAuthorScenePlan(save.id, plan, p.currentRound);
      recordAnalysisAgentThought(save, name, plan, p.currentRound);
      await writeAnalysisPlanArtifacts(save, name, plan, p.currentRound, analysisRequest);
      return summarizeAnalysisResult(name, plan);
    }
    const plan = await requestAuthorEventPlan(common);
    if (!plan) return { error: '事件分析未返回可用结果。' };
    useGameStore.getState().setAuthorEventPlan(save.id, plan, p.currentRound);
    recordAnalysisAgentThought(save, name, plan, p.currentRound);
    await writeAnalysisPlanArtifacts(save, name, plan, p.currentRound, analysisRequest);
    return summarizeAnalysisResult(name, plan);
  };
}

async function writePhase1Artifact(save: GameSave | undefined, phase1: OrchestratorPhase1Result): Promise<void> {
  if (!save) return;
  await createWorkspaceDocument({
    saveId: save.id,
    path: `planning/rounds/${phase1.updatedAtRound}/orchestrator-phase1.json`,
    title: `第 ${phase1.updatedAtRound} 回合司辰信息整理`,
    kind: 'director',
    content: JSON.stringify(phase1, null, 2),
    summary: phase1.notes.slice(0, 220),
    tags: ['planning', 'orchestrator', 'phase1'],
    updatedAtRound: phase1.updatedAtRound,
    updatedBy: 'orchestrator',
    provenance: {
      round: phase1.updatedAtRound,
      note: 'authorOrchestratorAgent Phase 1',
    },
  }).catch((err) => {
    console.warn('[authorOrchestratorAgent] write phase1 artifact failed', err);
  });
}

async function runOrchestratorPhase1(
  p: AuthorOrchestratorRequest,
  workspace: Awaited<ReturnType<typeof buildWorkspaceToolRuntime>>,
): Promise<{ result?: OrchestratorPhase1Result; messages: ChatMessage[] }> {
  const model = resolveAuthorCoreModel(p.settings, 'orchestrator');
  const user = appendWorkspaceManifest(buildAuthorOrchestratorPhase1User(p), workspace.userManifest);
  const system = appendWorkspaceSystem(AUTHOR_ORCHESTRATOR_PHASE1_SYSTEM, workspace.systemRules);
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  const onToolActivity = p.onToolActivity
    ? (activity: ChatToolActivity) => p.onToolActivity!(activity, '司辰·信息整理')
    : undefined;
  const result = await chatJSONDetailed(
    { baseUrl: p.settings.apiBaseUrl, apiKey: p.settings.apiKey, format: p.settings.apiFormat },
    {
      model,
      temperature: 0.15,
      messages,
      tools: workspace.tools,
      onToolCall: workspace.onToolCall,
      onToolActivity,
      maxToolRounds: 2,
      onDelta: p.onDelta,
      onThinkingDelta: p.onThinkingDelta,
      signal: p.signal,
    },
  );
  const parsed = sanitizePhase1(extractJSON(result.text), p.currentRound);
  const phase1 = parsed
    ? withPromptTrace({ ...parsed, thinking: result.thinking, rawOutput: result.text, usage: result.usage }, result.trace)
    : undefined;
  if (phase1) await writePhase1Artifact(p.save, phase1);
  return {
    result: phase1,
    messages: [
      ...messages,
      { role: 'assistant', content: result.text || JSON.stringify(parsed ?? {}) },
    ],
  };
}

async function runOrchestratorPhase2(
  p: AuthorOrchestratorRequest,
  workspace: Awaited<ReturnType<typeof buildWorkspaceToolRuntime>>,
  phase1: OrchestratorPhase1Result | undefined,
  phase1Messages: ChatMessage[],
): Promise<OrchestratorState | undefined> {
  const model = resolveAuthorCoreModel(p.settings, 'orchestrator');
  const user = appendWorkspaceManifest(buildAuthorOrchestratorPhase2User({
    currentRound: p.currentRound,
    nextRound: p.nextRound,
    config: p.config,
    narrative: p.narrative,
  }), workspace.userManifest);
  const system = appendWorkspaceSystem(AUTHOR_ORCHESTRATOR_PHASE2_SYSTEM, workspace.systemRules);
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    ...phase1Messages.filter((msg) => msg.role !== 'system'),
    { role: 'user', content: user },
  ];
  const onToolActivity = p.onToolActivity
    ? (activity: ChatToolActivity) => p.onToolActivity!(activity, '司辰·调度决策')
    : undefined;
  const result = await chatJSONDetailed(
    { baseUrl: p.settings.apiBaseUrl, apiKey: p.settings.apiKey, format: p.settings.apiFormat },
    {
      model,
      temperature: 0.12,
      messages,
      tools: workspace.tools,
      onToolCall: workspace.onToolCall,
      onToolActivity,
      maxToolRounds: 2,
      onDelta: p.onDelta,
      onThinkingDelta: p.onThinkingDelta,
      signal: p.signal,
    },
  );
  const parsed = sanitizeOrchestrator(extractJSON(result.text), p);
  return parsed
    ? withPromptTrace({ ...parsed, phase1, thinking: result.thinking, rawOutput: result.text, usage: result.usage }, result.trace)
    : undefined;
}

export async function requestAuthorOrchestrator(p: AuthorOrchestratorRequest): Promise<OrchestratorState | undefined> {
  const workspace = p.settings.apiFormat === 'chat'
    ? await buildWorkspaceToolRuntime(p.save, {
      agentKind: 'orchestrator',
      analysisToolHandler: buildAnalysisToolHandler(p),
    })
    : {};
  const phase1 = await runOrchestratorPhase1(p, workspace);
  return runOrchestratorPhase2(p, workspace, phase1.result, phase1.messages);
}
