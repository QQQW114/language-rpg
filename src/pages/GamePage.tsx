import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Home, Package, RotateCw, Settings, Sparkles, StopCircle, Flag } from 'lucide-react';
import { useGameStore, useActiveSave } from '@/store/useGameStore';
import { useContentStore, selectAllBackgrounds, selectAllEvents, selectAllOutlines, selectAllWorldBooks, flattenWorldBookEntries } from '@/store/useContentStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { StoryView } from '@/components/StoryView';
import { ChoicePanel } from '@/components/ChoicePanel';
import { ManualInput } from '@/components/ManualInput';
import { RoundProgress } from '@/components/RoundProgress';
import { CharacterPanel } from '@/components/CharacterPanel';
import { BackpackDialog } from '@/components/BackpackDialog';
import { DiscardDialog } from '@/components/DiscardDialog';
import { ItemSelector } from '@/components/ItemSelector';
import { Button } from '@/components/ui/Button';
import { OrnateDivider } from '@/components/ui/Ornaments';
import { ReviewPanel } from '@/components/ReviewPanel';
import { NpcList } from '@/components/NpcList';
import { NpcDialog } from '@/components/NpcDialog';
import { AnchorsList } from '@/components/AnchorsList';
import { SceneMap } from '@/components/SceneMap';
import { requestStory } from '@/services/storyAgent';
import { requestChoices } from '@/services/decisionAgent';
import { requestMemoryUpdate } from '@/services/memoryAgent';
import { requestReview } from '@/services/reviewAgent';
import { requestAuthorRandomEvent, storyArcToRandomEvent } from '@/services/authorRandomEventAgent';
import { requestAuthorDirectorPlan } from '@/services/authorDirectorAgent';
import { requestAuthorEventBeat } from '@/services/authorEventBeatAgent';
import { requestAuthorLogicCheck } from '@/services/authorLogicCheckAgent';
import { requestSettingGuard } from '@/services/authorSettingGuardAgent';
import { requestStageJudge } from '@/services/authorStageJudgeAgent';
import { fallbackOrchestratorDecision, requestAuthorOrchestrator } from '@/services/authorOrchestratorAgent';
import { requestAuthorOutlineMapping } from '@/services/authorOutlineMapperAgent';
import { requestAuthorCharacterPlan } from '@/services/authorCharacterPlannerAgent';
import { requestAuthorScenePlan } from '@/services/authorScenePlannerAgent';
import { requestAuthorEventPlan } from '@/services/authorEventPlannerAgent';
import { fallbackMasterArcFromOutline, requestMasterArc } from '@/services/authorMasterArcAgent';
import { matchWorldBook } from '@/services/worldBookMatcher';
import { pickRandomEvent } from '@/services/randomEventScheduler';
import { maybeCompress } from '@/services/contextCompressor';
import type { AuthorRandomEventConfig, Choice, GameSave, Item, Message, OrchestratorCallKey, OrchestratorState, SceneRef, StoryArc, ToolActivityRecord } from '@/types/game';
import type { GameContent } from '@/types/game';
import type { StrictCustomConfig } from '@/types/custom';
import type { WorldBook, WorldBookEntry } from '@/types/content';
import type { LlmUsage } from '@/types/llm';
import type { AgentPromptTrace } from '@/types/ledger';
import { buildLedgerJourneyZip } from '@/lib/ledgerJourneyPackage';
import { getSaveStorageStats, type SaveStorageStats } from '@/storage/ledgerRepository';
import { AuthorArcPanel } from '@/components/AuthorArcPanel';
import { SettingGuardPanel } from '@/components/SettingGuardPanel';
import { MasterArcPanel } from '@/components/MasterArcPanel';
import { AgentThoughtsPanel } from '@/components/AgentThoughtsPanel';
import { normalizeAuthorEventBeatConfig, normalizeAuthorMasterArcConfig, normalizeAuthorOrchestratorConfig, normalizeAuthorSettingGuardConfig, normalizeAuthorStageJudgeConfig } from '@/lib/authorMode';
import { TopBar } from '@/components/TopBar';
import { SidebarTabs } from '@/components/SidebarTabs';
import { AutoGoldLine, GoldLine } from '@/components/ui/GoldLine';
import { ToastViewport } from '@/components/ui/Toast';
import { confirmDialog } from '@/components/ui/ConfirmDialog';
import { toast } from '@/lib/toast';
import { Brain, Compass, ScrollText, ShieldCheck, UserRound } from 'lucide-react';

const RECENT_TEXT_WINDOW = 2400;
type GameTaskKind = 'story' | 'choices' | 'review' | 'startup';
const runningGameTaskKeys = new Set<string>();
const GAME_TASK_EVENT = 'lrpg:game-task-change';
const GAME_PROGRESS_EVENT = 'lrpg:game-progress-change';

type AgentBusyKind =
  | 'outlineMapper'
  | 'stageJudge'
  | 'settingGuard'
  | 'eventBeat'
  | 'characterPlanner'
  | 'scenePlanner'
  | 'eventPlanner'
  | 'memoryNow'
  | 'story'
  | 'decisionWithChoices'
  | 'decisionTracking'
  | 'memory'
  | 'randomEvent'
  | 'director'
  | 'logicCheck'
  | 'masterArc'
  | 'review'
  | 'orchestrator';
type AgentThoughtKind = AgentBusyKind | 'summary';

interface RuntimeProgress {
  busy: boolean;
  agentBusy: AgentBusyKind | null;
  streaming: string;
  streamingThinking: string;
  streamingAgentOutput: string;
  streamingToolEvents: ToolActivityRecord[];
  roundStartedAt?: number;
  agentStartedAt?: number;
  runtimeTotalUsage?: LlmUsage;
  runtimeEstimatedOutputTokens?: number;
  updatedAt: number;
}

const runtimeProgressBySaveId = new Map<string, RuntimeProgress>();

function emitGameProgressChange(saveId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(GAME_PROGRESS_EVENT, { detail: { saveId } }));
}

function getRuntimeProgress(saveId?: string): RuntimeProgress | undefined {
  return saveId ? runtimeProgressBySaveId.get(saveId) : undefined;
}

function patchRuntimeProgress(saveId: string | undefined, patch: Partial<Omit<RuntimeProgress, 'updatedAt'>>): void {
  if (!saveId) return;
  const prev = runtimeProgressBySaveId.get(saveId);
  const next: RuntimeProgress = {
    busy: patch.busy ?? prev?.busy ?? true,
    agentBusy: patch.agentBusy !== undefined ? patch.agentBusy : prev?.agentBusy ?? null,
    streaming: patch.streaming ?? prev?.streaming ?? '',
    streamingThinking: patch.streamingThinking ?? prev?.streamingThinking ?? '',
    streamingAgentOutput: patch.streamingAgentOutput ?? prev?.streamingAgentOutput ?? '',
    streamingToolEvents: patch.streamingToolEvents ?? prev?.streamingToolEvents ?? [],
    roundStartedAt: patch.roundStartedAt ?? prev?.roundStartedAt,
    agentStartedAt: patch.agentStartedAt ?? prev?.agentStartedAt,
    runtimeTotalUsage: patch.runtimeTotalUsage ?? prev?.runtimeTotalUsage,
    runtimeEstimatedOutputTokens: patch.runtimeEstimatedOutputTokens ?? prev?.runtimeEstimatedOutputTokens ?? 0,
    updatedAt: Date.now(),
  };
  runtimeProgressBySaveId.set(saveId, next);
  emitGameProgressChange(saveId);
}

function addRuntimeUsage(a: LlmUsage | undefined, b: LlmUsage | undefined): LlmUsage | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    promptTokens: (a.promptTokens ?? 0) + (b.promptTokens ?? 0) || undefined,
    completionTokens: (a.completionTokens ?? 0) + (b.completionTokens ?? 0) || undefined,
    totalTokens: (a.totalTokens ?? 0) + (b.totalTokens ?? 0) || undefined,
    cache: {
      hitTokens: (a.cache?.hitTokens ?? 0) + (b.cache?.hitTokens ?? 0) || undefined,
      missTokens: (a.cache?.missTokens ?? 0) + (b.cache?.missTokens ?? 0) || undefined,
      cachedTokens: (a.cache?.cachedTokens ?? 0) + (b.cache?.cachedTokens ?? 0) || undefined,
    },
  };
}

function estimateOutputTokens(text: string): number {
  const value = String(text ?? '');
  if (!value) return 0;
  let cjk = 0;
  let ascii = 0;
  let other = 0;
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (
      (code >= 0x4e00 && code <= 0x9fff)
      || (code >= 0x3400 && code <= 0x4dbf)
      || (code >= 0x3000 && code <= 0x303f)
      || (code >= 0xff00 && code <= 0xffef)
    ) cjk += 1;
    else if (code <= 0x007f) ascii += 1;
    else other += 1;
  }
  // 仅作流式预估：中文通常接近 1~2 字 / token，英文约 3~4 字 / token。
  return Math.max(0, Math.round(cjk * 0.65 + ascii * 0.28 + other * 0.6));
}

function appendRuntimeStream(saveId: string | undefined, delta: string, key: 'streaming' | 'streamingThinking' | 'streamingAgentOutput'): void {
  if (!saveId || !delta) return;
  const prev = runtimeProgressBySaveId.get(saveId);
  patchRuntimeProgress(saveId, {
    [key]: `${prev?.[key] ?? ''}${delta}`,
  } as Pick<RuntimeProgress, typeof key>);
}

function appendRuntimeToolEvent(saveId: string | undefined, event: ToolActivityRecord): void {
  if (!saveId) return;
  const prev = runtimeProgressBySaveId.get(saveId);
  patchRuntimeProgress(saveId, {
    streamingToolEvents: [...(prev?.streamingToolEvents ?? []), event].slice(-32),
  });
}

function clearRuntimeProgress(saveId: string | undefined): void {
  if (!saveId) return;
  runtimeProgressBySaveId.delete(saveId);
  emitGameProgressChange(saveId);
}

interface AgentRecordPayload {
  thinking?: string;
  output?: unknown;
  prompt?: AgentPromptTrace;
  usage?: LlmUsage;
  cacheHit?: boolean;
}

const AGENT_LABELS: Record<AgentThoughtKind, string> = {
  outlineMapper: '大纲映星 · 校准主线',
  stageJudge: '心镜映念 · 揣度此意',
  settingGuard: '世书守护 · 查阅设定',
  eventBeat: '司事衡节 · 判定事件',
  characterPlanner: '人物织线 · 牵动关系',
  scenePlanner: '场景绘卷 · 安置时空',
  eventPlanner: '事件铸模 · 定其进退',
  memoryNow: '长卷整理 · 此事当记',
  story: '故事之笔正在书写',
  decisionWithChoices: '命运之轮旋转中',
  decisionTracking: '记事铜镜 · 拓印当下',
  memory: '长卷整理 · 归纳前事',
  randomEvent: '机缘转动 · 窥见可能',
  director: '叙事导演 · 铺垫前路',
  logicCheck: '连贯校尺 · 查漏补缺',
  masterArc: '主弧铺设 · 勾勒全篇',
  review: '评卷点墨 · 定旅程之榜',
  summary: '长卷压缩 · 摘要前文',
  orchestrator: '回合司辰 · 调度群星',
};

const AGENT_ACTOR_LABELS: Record<AgentThoughtKind, string> = {
  outlineMapper: '大纲映射员',
  stageJudge: '阶段判断员',
  settingGuard: '设定守护者',
  eventBeat: '司事',
  characterPlanner: '人物规划员',
  scenePlanner: '场景规划员',
  eventPlanner: '事件规划员',
  memoryNow: '记忆书吏',
  story: '故事写手',
  decisionWithChoices: '决策记录员',
  decisionTracking: '决策记录员',
  memory: '记忆书吏',
  randomEvent: '机缘导演',
  director: '叙事导演',
  logicCheck: '逻辑审校员',
  masterArc: '主弧规划员',
  review: '旅程评卷人',
  summary: '摘要书吏',
  orchestrator: '回合司辰',
};

const DEFAULT_PRE_STORY_CALL_ORDER: OrchestratorCallKey[] = [
  'outlineMapper',
  'stageJudge',
  'settingGuard',
  'eventBeat',
  'director',
];
const PRE_STORY_CALL_KEYS = new Set<OrchestratorCallKey>(DEFAULT_PRE_STORY_CALL_ORDER);

function getPreStoryCallOrder(orchestrator: OrchestratorState | undefined): OrchestratorCallKey[] {
  if (!orchestrator) return ['outlineMapper', 'stageJudge', 'settingGuard', 'director'];
  const ordered: OrchestratorCallKey[] = [];
  for (const key of orchestrator?.callOrder ?? []) {
    if (PRE_STORY_CALL_KEYS.has(key) && orchestrator.calls[key]?.run && !ordered.includes(key)) {
      ordered.push(key);
    }
  }
  for (const key of DEFAULT_PRE_STORY_CALL_ORDER) {
    if (orchestrator.calls[key]?.run && !ordered.includes(key)) {
      ordered.push(key);
    }
  }
  return ordered;
}

function formatAgentOutput(output: unknown): string | undefined {
  if (typeof output === 'string') {
    const text = output.trim();
    return text || undefined;
  }
  if (output == null) return undefined;
  try {
    return JSON.stringify(output, (key, value) => (
      key === 'thinking' || key === 'rawOutput' || key === 'usage' ? undefined : value
    ), 2);
  } catch {
    const text = String(output).trim();
    return text || undefined;
  }
}

function gameTaskKey(save: GameSave, kind: GameTaskKind): string {
  // 同一存档同一类模型任务任一时刻只允许一个。
  // 不能把 currentRound 放进 story key：故事正文生成后会先 incrementRound，
  // 再跑决策/记忆/导演等后处理；若此时玩家离开再返回，新页面会看到
  // phase 仍是 story 但 currentRound 已增长，从而绕过旧 round key 再写一回合。
  return `${save.id}:${kind}`;
}

function beginGameTask(key: string): boolean {
  if (runningGameTaskKeys.has(key)) return false;
  runningGameTaskKeys.add(key);
  emitGameTaskChange();
  return true;
}

function endGameTask(key: string): void {
  runningGameTaskKeys.delete(key);
  emitGameTaskChange();
}

function isGameTaskRunning(key: string): boolean {
  return runningGameTaskKeys.has(key);
}

function emitGameTaskChange(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(GAME_TASK_EVENT));
}

function getActiveWorldBookEntriesForAgent(
  worldBooks: WorldBook[],
  save: GameSave,
  latestStory?: string,
): WorldBookEntry[] {
  const candidates = flattenWorldBookEntries(worldBooks, save.content.worldBookIds);
  const recentParts = save.state.history.slice(-6).map((m) => m.content);
  if (latestStory) recentParts.push(latestStory);
  const recentText = recentParts.join('\n').slice(-RECENT_TEXT_WINDOW);
  return matchWorldBook({
    entries: candidates,
    recentText,
    currentInput: save.state.lastPlayerInput,
  });
}

function needsAuthorStartupPrep(save: GameSave): boolean {
  if (save.content.mode !== 'author') return false;
  if (save.state.phase !== 'manual') return false;
  if (save.state.currentRound > 1) return false;
  if (save.state.authorNarrative?.plan) return false;
  // 叙事导演默认开启；若玩家显式关闭，则不强行跑开局准备。
  return save.content.authorDirector?.enabled !== false;
}

function getPromptConfig(content: GameContent): StrictCustomConfig | undefined {
  return content.mode === 'author'
    ? content.authorCustom
    : content.strictCustom;
}

function getScheduledEventIds(content: GameContent): string[] {
  if (content.mode !== 'author') return content.eventIds ?? [];
  const cfg = content.authorRandomEvent;
  return cfg?.mode === 'pool' ? cfg.poolEventIds : [];
}

function getPendingAuthorArcForCurrentRound(save: GameSave): StoryArc | undefined {
  const eventState = save.state.authorRandomEventState;
  if (save.content.mode !== 'author') return undefined;
  if (!eventState?.pendingEvent) return undefined;
  return eventState.pendingForRound === save.state.currentRound ? eventState.pendingEvent : undefined;
}

function consumeGuaranteedRangeIfNeeded(
  config: AuthorRandomEventConfig,
  rangeId: string | undefined,
): AuthorRandomEventConfig {
  if (!rangeId) return config;
  return {
    ...config,
    dynamic: {
      ...config.dynamic,
      guaranteedRanges: config.dynamic.guaranteedRanges.map((range) =>
        range.id === rangeId ? { ...range, consumed: true } : range,
      ),
    },
  };
}

function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned ? cleaned.slice(0, 80) : 'language-rpg';
}

function formatChatRecord(save: GameSave): string {
  const lines: string[] = [];
  lines.push(`# ${save.name}`);
  lines.push('');
  lines.push(`- 导出时间：${new Date().toLocaleString()}`);
  if (save.content.characterName) lines.push(`- 角色：${save.content.characterName}`);
  lines.push(`- 当前回合：${save.state.currentRound}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const msg of save.state.history) {
    if (msg.role === 'assistant') {
      lines.push(`## 第 ${msg.round} 回合 · 故事`);
    } else if (msg.role === 'user') {
      lines.push(`## 第 ${msg.round} 回合 · 玩家行动`);
    } else {
      lines.push(`## 第 ${msg.round} 回合 · 系统`);
    }
    lines.push('');
    lines.push(msg.content.trim());
    lines.push('');
  }

  if (save.state.summary?.trim()) {
    lines.push('---');
    lines.push('');
    lines.push('## 自动摘要');
    lines.push('');
    lines.push(save.state.summary.trim());
    lines.push('');
  }

  return lines.join('\n');
}

async function saveTextFile(
  text: string,
  fileName: string,
  mime = 'text/markdown;charset=utf-8',
  types: any[] = [
    {
      description: 'Markdown 文本',
      accept: { 'text/markdown': ['.md'], 'text/plain': ['.txt'] },
    },
  ],
): Promise<'saved' | 'downloaded' | 'cancelled'> {
  const blob = new Blob([text], { type: mime });
  const picker = (window as any).showSaveFilePicker;

  if (typeof picker === 'function') {
    try {
      const handle = await picker({
        suggestedName: fileName,
        types,
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'saved';
    } catch (err: any) {
      if (err?.name === 'AbortError') return 'cancelled';
      // 浏览器/权限不支持时降级为下载。
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}

async function saveBlobFile(
  blob: Blob,
  fileName: string,
  types: any[] = [
    {
      description: '言灵旅程卷宗 ZIP',
      accept: { 'application/zip': ['.zip'], 'application/octet-stream': ['.zip'] },
    },
  ],
): Promise<'saved' | 'downloaded' | 'cancelled'> {
  const picker = (window as any).showSaveFilePicker;

  if (typeof picker === 'function') {
    try {
      const handle = await picker({
        suggestedName: fileName,
        types,
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'saved';
    } catch (err: any) {
      if (err?.name === 'AbortError') return 'cancelled';
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}

export default function GamePage() {
  const nav = useNavigate();
  const save = useActiveSave();
  const settings = useSettingsStore((s) => s.settings);

  const outlines = useContentStore(selectAllOutlines);
  const backgrounds = useContentStore(selectAllBackgrounds);
  const worldBooks = useContentStore(selectAllWorldBooks);
  const allEvents = useContentStore(selectAllEvents);
  const addEventToLibrary = useContentStore((s) => s.addEvent);

  const [streaming, setStreaming] = useState('');
  const [streamingThinking, setStreamingThinking] = useState('');
  const [streamingAgentOutput, setStreamingAgentOutput] = useState('');
  const [runtimeRoundStartedAt, setRuntimeRoundStartedAt] = useState<number | undefined>();
  const [runtimeAgentStartedAt, setRuntimeAgentStartedAt] = useState<number | undefined>();
  const [runtimeTotalUsage, setRuntimeTotalUsage] = useState<LlmUsage | undefined>();
  const [runtimeEstimatedOutputTokens, setRuntimeEstimatedOutputTokens] = useState(0);
  const [streamingToolEvents, setStreamingToolEvents] = useState<ToolActivityRecord[]>([]);
  const streamingToolEventsRef = useRef<ToolActivityRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [agentBusy, setAgentBusy] = useState<AgentBusyKind | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [regeneratingMasterArc, setRegeneratingMasterArc] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | undefined>();
  const [storageStats, setStorageStats] = useState<SaveStorageStats | undefined>();
  const [backpackOpen, setBackpackOpen] = useState(false);
  const [npcOpen, setNpcOpen] = useState(false);
  const [stageAdvanceMsg, setStageAdvanceMsg] = useState<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(false);
  const leavingPageRef = useRef(false);
  const prevStageIndexRef = useRef<number | null>(null);
  const authorStartupPrepRef = useRef<Set<string>>(new Set());
  const flowSaveIdRef = useRef<string | undefined>(save?.id);

  const recordAgentRecord = useCallback((
    saveId: string,
    kind: AgentThoughtKind,
    round: number,
    payload: AgentRecordPayload,
  ) => {
    const content = payload.thinking?.trim();
    const output = formatAgentOutput(payload.output);
    if (!content && !output && !payload.prompt && !payload.usage && !payload.cacheHit) return;
    const prev = getRuntimeProgress(saveId);
    if (payload.usage && prev?.busy) {
      const nextUsage = addRuntimeUsage(prev?.runtimeTotalUsage, payload.usage);
      const nextOutputEstimate = (prev?.runtimeEstimatedOutputTokens ?? 0) + Math.max(0, Math.floor(payload.usage.completionTokens ?? 0));
      patchRuntimeProgress(saveId, {
        runtimeTotalUsage: nextUsage,
        runtimeEstimatedOutputTokens: nextOutputEstimate,
      });
      if (mountedRef.current && !leavingPageRef.current) {
        setRuntimeTotalUsage(nextUsage);
        setRuntimeEstimatedOutputTokens(nextOutputEstimate);
      }
    }
    useGameStore.getState().addAgentThought(saveId, {
      kind,
      label: AGENT_LABELS[kind],
      round,
      content,
      output,
      prompt: payload.prompt,
      usage: payload.usage,
      cacheHit: payload.cacheHit,
    });
  }, []);

  const pushFlowEvent = useCallback((event: Omit<ToolActivityRecord, 'id' | 'createdAt'> & { id?: string; createdAt?: number }) => {
    const flowSaveId = flowSaveIdRef.current ?? useGameStore.getState().activeSaveId;
    const next: ToolActivityRecord = {
      id: event.id || `flow_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      name: event.name,
      label: event.label,
      detail: event.detail,
      actor: event.actor,
      agentKind: event.agentKind,
      phase: event.phase,
      createdAt: event.createdAt || Date.now(),
    };
    appendRuntimeToolEvent(flowSaveId, next);
    streamingToolEventsRef.current = [...streamingToolEventsRef.current, next].slice(-32);
    if (mountedRef.current && !leavingPageRef.current) {
      setStreamingToolEvents(streamingToolEventsRef.current);
    }
  }, []);

  const appendActiveAgentThinking = useCallback((saveId: string | undefined, delta: string) => {
    appendRuntimeStream(saveId, delta, 'streamingThinking');
    if (mountedRef.current && !leavingPageRef.current) {
      setStreamingThinking((prev) => prev + delta);
    }
  }, []);

  const appendActiveAgentOutput = useCallback((saveId: string | undefined, delta: string) => {
    appendRuntimeStream(saveId, delta, 'streamingAgentOutput');
    if (mountedRef.current && !leavingPageRef.current) {
      setStreamingAgentOutput((prev) => prev + delta);
    }
  }, []);

  const createJsonStreamHandlers = useCallback((saveId: string) => ({
    onDelta: (text: string) => appendActiveAgentOutput(saveId, text),
    onThinkingDelta: (text: string) => appendActiveAgentThinking(saveId, text),
  }), [appendActiveAgentOutput, appendActiveAgentThinking]);

  const setAgentBusyFlow = useCallback((kind: AgentBusyKind, action = '正在处理') => {
    const flowSaveId = flowSaveIdRef.current ?? useGameStore.getState().activeSaveId;
    const startedAt = Date.now();
    patchRuntimeProgress(flowSaveId, {
      busy: true,
      agentBusy: kind,
      streamingThinking: '',
      streamingAgentOutput: '',
      agentStartedAt: startedAt,
    });
    if (mountedRef.current && !leavingPageRef.current) {
      setStreamingThinking('');
      setStreamingAgentOutput('');
      setRuntimeAgentStartedAt(startedAt);
    }
    setAgentBusy(kind);
    pushFlowEvent({
      name: `agent:${kind}`,
      actor: AGENT_ACTOR_LABELS[kind],
      agentKind: kind,
      label: action,
      phase: 'status',
    });
  }, [pushFlowEvent]);

  const outline = useMemo(() => outlines.find((o) => o.id === save?.content.outlineId), [outlines, save?.content.outlineId]);
  const background = useMemo(() => backgrounds.find((b) => b.id === save?.content.backgroundId), [backgrounds, save?.content.backgroundId]);
  const showAgentNotice = useCallback((msg: string) => {
    if (msg) toast.warn(msg);
  }, []);
  const activeEntriesCount = useMemo(
    () => save ? flattenWorldBookEntries(worldBooks, save.content.worldBookIds).length : 0,
    [save?.content.worldBookIds, worldBooks],
  );
  const latestAssistantIndex = useMemo(() => {
    if (!save) return -1;
    for (let i = save.state.history.length - 1; i >= 0; i--) {
      if (save.state.history[i].role === 'assistant') return i;
    }
    return -1;
  }, [save?.state.history]);

  useEffect(() => {
    if (!save) nav('/');
  }, [save, nav]);

  useEffect(() => {
    if (save?.id) flowSaveIdRef.current = save.id;
  }, [save?.id]);

  useEffect(() => {
    if (!save) {
      setStorageStats(undefined);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      getSaveStorageStats(save)
        .then((stats) => {
          if (!cancelled) setStorageStats(stats);
        })
        .catch((err) => {
          console.warn('[ledger] storage stats failed', err);
          if (!cancelled) setStorageStats(undefined);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    save?.id,
    save?.updatedAt,
    save?.state.history.length,
    save?.state.agentThoughts?.length,
    save?.state.currentRound,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    leavingPageRef.current = false;
    return () => {
      mountedRef.current = false;
      leavingPageRef.current = true;
      abortRef.current = null;
      busyRef.current = false;
    };
  }, []);

  const leaveGamePage = useCallback((to: string) => {
    leavingPageRef.current = true;
    nav(to);
  }, [nav]);

  const getSave = useCallback((): GameSave | undefined => {
    const s = useGameStore.getState();
    return s.activeSaveId ? s.saves[s.activeSaveId] : undefined;
  }, []);

  const applyDecisionForStory = useCallback(async (
    sourceSave: GameSave,
    latestStory: string,
    includeChoices: boolean,
    signal?: AbortSignal,
  ) => {
    const actions = useGameStore.getState();
    const current = actions.saves[sourceSave.id] ?? sourceSave;
    setAgentBusyFlow(includeChoices ? 'decisionWithChoices' : 'decisionTracking', includeChoices ? '生成选项' : '记录状态');
    const { choices, grants, destroys, itemPatches, npcs, currentScene, availableScenes, thinking, rawOutput, usage, trace } = await requestChoices({
      save: current,
      settings,
      outline,
      background,
      characterName: current.content.characterName,
      worldBookEntries: getActiveWorldBookEntriesForAgent(worldBooks, current, latestStory),
      latestStory,
      backpack: current.state.backpack ?? [],
      npcs: current.state.npcs ?? [],
      summary: current.state.summary,
      recent: current.state.history.slice(-8),
      currentSceneName: current.state.currentScene?.name,
      currentScene: current.state.currentScene,
      strictCustom: getPromptConfig(current.content),
      includeChoices,
      longTermMemory: current.state.longTermMemory,
      anchors: current.state.anchors,
      narrative: current.content.mode === 'author' ? current.state.authorNarrative : undefined,
      randomEventState: current.content.mode === 'author' ? current.state.authorRandomEventState : undefined,
      currentRound: current.state.currentRound,
      ...createJsonStreamHandlers(sourceSave.id),
      signal,
    });

    const afterDecision = useGameStore.getState().saves[sourceSave.id] ?? current;
    const grantKey = `round-${afterDecision.state.currentRound}`;
    recordAgentRecord(
      sourceSave.id,
      includeChoices ? 'decisionWithChoices' : 'decisionTracking',
      afterDecision.state.currentRound,
      {
        thinking,
        output: rawOutput ?? { choices, grants, destroys, itemPatches, npcs, currentScene, availableScenes },
        prompt: trace,
        usage,
      },
    );
    actions.applyDecisionResult(sourceSave.id, grantKey, grants, destroys, itemPatches, afterDecision.state.currentRound);
    if (npcs?.length) actions.applyNpcUpdates(sourceSave.id, npcs, afterDecision.state.currentRound);
    if (includeChoices || currentScene || availableScenes.length) {
      actions.setScenes(sourceSave.id, currentScene, availableScenes);
    }
    if (includeChoices) actions.setChoices(sourceSave.id, choices);
    actions.captureSnapshot(sourceSave.id, 'after_decision', afterDecision.state.currentRound);

    const completedRound = afterDecision.state.currentRound;
    const memoryEvery = Math.max(0, Math.floor(settings.memoryEveryRounds ?? 0));
    const latestForMemory = useGameStore.getState().saves[sourceSave.id];
    const orchestratorMemory = latestForMemory?.state.authorNarrative?.orchestrator;
    const memoryRequested = !!(
      orchestratorMemory?.calls.memory.run &&
      orchestratorMemory.updatedAtRound >= Math.max(0, completedRound - 1)
    );
    if (
      latestForMemory &&
      completedRound > 0 &&
      (memoryRequested || (memoryEvery > 0 && completedRound % memoryEvery === 0)) &&
      completedRound > (latestForMemory.state.lastMemoryRound ?? 0)
    ) {
      setAgentBusyFlow('memory', '整理记忆');
      const memory = await requestMemoryUpdate({
        save: latestForMemory,
        settings,
        previousMemory: latestForMemory.state.longTermMemory,
        recent: latestForMemory.state.history.slice(-10),
        decision: {
          choices,
          grants,
          destroys,
          itemPatches,
          npcs,
          currentScene,
          availableScenes,
        },
        npcs: latestForMemory.state.npcs ?? [],
        backpack: latestForMemory.state.backpack ?? [],
        currentScene: latestForMemory.state.currentScene,
        anchors: latestForMemory.state.anchors,
        outline,
        background,
        worldBookEntries: flattenWorldBookEntries(worldBooks, latestForMemory.content.worldBookIds),
        maxChars: settings.memoryMaxChars ?? 4000,
        ...createJsonStreamHandlers(sourceSave.id),
        signal,
      });
      if (memory) {
        recordAgentRecord(sourceSave.id, 'memory', completedRound, {
          thinking: memory.thinking,
          output: memory.rawOutput ?? memory.memory,
          prompt: memory.trace,
          usage: memory.usage,
        });
        actions.setLongTermMemory(sourceSave.id, memory.memory, completedRound);
      }
    }
  }, [settings, outline, background, worldBooks, recordAgentRecord, createJsonStreamHandlers, setAgentBusyFlow]);

  const runMemoryNow = useCallback(async (saveId: string, signal?: AbortSignal) => {
    const actions = useGameStore.getState();
    const current = actions.saves[saveId];
    if (!current) return;
    const completedRound = current.state.currentRound;
    if (completedRound <= (current.state.lastMemoryRound ?? 0)) return;

    setAgentBusyFlow('memoryNow', '立即整理记忆');
    const memory = await requestMemoryUpdate({
      save: current,
      settings,
      previousMemory: current.state.longTermMemory,
      recent: current.state.history.slice(-10),
      decision: {
        choices: current.state.lastChoices ?? [],
        grants: [],
        destroys: [],
        itemPatches: [],
        npcs: [],
        currentScene: current.state.currentScene,
        availableScenes: current.state.availableScenes ?? [],
      },
      npcs: current.state.npcs ?? [],
      backpack: current.state.backpack ?? [],
      currentScene: current.state.currentScene,
      anchors: current.state.anchors,
      outline,
      background,
      worldBookEntries: flattenWorldBookEntries(worldBooks, current.content.worldBookIds),
      maxChars: settings.memoryMaxChars ?? 4000,
      ...createJsonStreamHandlers(saveId),
      signal,
    });
    if (memory) {
      recordAgentRecord(saveId, 'memoryNow', completedRound, {
        thinking: memory.thinking,
        output: memory.rawOutput ?? memory.memory,
        prompt: memory.trace,
        usage: memory.usage,
      });
      actions.setLongTermMemory(saveId, memory.memory, completedRound);
    }
  }, [settings, outline, background, worldBooks, recordAgentRecord, createJsonStreamHandlers, setAgentBusyFlow]);

  const maybeRunAuthorOrchestrator = useCallback(async (
    saveId: string,
    signal?: AbortSignal,
  ): Promise<OrchestratorState | undefined> => {
    const actions = useGameStore.getState();
    const current = actions.saves[saveId];
    if (!current || current.content.mode !== 'author') return undefined;

    const config = normalizeAuthorOrchestratorConfig(current.content.authorOrchestrator);
    if (!config.enabled) return undefined;

    const completedRound = current.state.currentRound;
    const lastRound = current.state.authorNarrative?.lastOrchestratorRound ?? -9999;
    if (completedRound - lastRound < Math.max(1, config.minIntervalRounds)) {
      const prev = current.state.authorNarrative?.orchestrator;
      if (!prev) return undefined;
      const idle: OrchestratorState['calls'] = {
        outlineMapper: { run: false, reason: '回合司辰未到检查间隔。' },
        stageJudge: { run: false, reason: '回合司辰未到检查间隔。' },
        settingGuard: { run: false, reason: '回合司辰未到检查间隔。' },
        eventBeat: { run: false, reason: '回合司辰未到检查间隔。' },
        director: { run: false, reason: '回合司辰未到检查间隔。' },
        logicCheck: { run: false, reason: '回合司辰未到检查间隔。' },
        memory: { run: false, reason: '回合司辰未到检查间隔。' },
        summary: { run: false, reason: '回合司辰未到检查间隔。' },
      };
      return { ...prev, directorMode: 'skip', callOrder: [], calls: idle };
    }

    const lastStory = [...current.state.history].reverse().find((m) => m.role === 'assistant')?.content;
    const unsummarizedCount = Math.max(0, current.state.history.length - (current.state.summarizedUntilIndex ?? 0));
    const request = {
      save: current,
      settings,
      outline,
      characterName: current.content.characterName,
      worldBookEntries: getActiveWorldBookEntriesForAgent(worldBooks, current, lastStory ?? ''),
      anchors: current.state.anchors,
      availableScenes: current.state.availableScenes ?? [],
      currentRound: completedRound,
      nextRound: completedRound + 1,
      totalRounds: current.config.totalRounds,
      playerInput: current.state.lastPlayerInput,
      latestStory: lastStory,
      recent: current.state.history.slice(-8),
      summary: current.state.summary,
      longTermMemory: current.state.longTermMemory,
      npcs: current.state.npcs ?? [],
      backpack: current.state.backpack ?? [],
      currentScene: current.state.currentScene,
      narrative: current.state.authorNarrative,
      config,
      unsummarizedCount,
      maxHistoryRounds: settings.maxHistoryRounds,
      memoryEveryRounds: settings.memoryEveryRounds,
      ...createJsonStreamHandlers(saveId),
      onToolActivity: (activity: any, phaseLabel?: string) => {
        const call = activity.call ?? {};
        const name = String(call.name ?? 'tool');
        const args = call.arguments ?? {};
        const label = (() => {
          if (activity.phase === 'result') return `完成 ${name}`;
          if (name === 'run_character_analysis') return `询问人物规划员：${args.question || args.focus || '人物关系'}`;
          if (name === 'run_scene_analysis') return `询问场景规划员：${args.question || args.focus || '场景时空'}`;
          if (name === 'run_event_analysis') return `询问事件规划员：${args.question || args.focus || '事件进退'}`;
          if (name === 'get_latest_planning_bundle') return '查阅了最新规划包';
          if (name === 'get_recent_rounds') return `查阅了最近 ${args.n ?? ''} 回合`;
          if (name === 'get_story_briefing') return '查阅了旅程设定简报';
          return `调用了 ${name}`;
        })();
        pushFlowEvent({
          name,
          actor: phaseLabel ?? '回合司辰',
          agentKind: 'orchestrator',
          label,
          detail: activity.phase === 'result'
            ? String(activity.resultText ?? '').slice(0, 160)
            : JSON.stringify(args).slice(0, 160),
          phase: activity.phase === 'result' ? 'result' : 'call',
        });
      },
      signal,
    };

    setAgentBusyFlow('orchestrator', '判断本回合需要哪些模型');
    try {
      const result = await requestAuthorOrchestrator(request) ?? fallbackOrchestratorDecision(request);
      actions.setOrchestratorState(saveId, result);
      recordAgentRecord(saveId, 'orchestrator', completedRound, {
        thinking: result.thinking,
        output: result.rawOutput ?? result,
        prompt: (result as any).trace,
        usage: result.usage,
      });
      return result;
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err;
      console.warn('[authorOrchestrator] failed', err);
      const fallback = fallbackOrchestratorDecision(request);
      actions.setOrchestratorState(saveId, fallback);
      actions.setOrchestratorError(saveId, err?.message ?? String(err));
      showAgentNotice('回合司辰失利，使用保底调度');
      return fallback;
    }
  }, [settings, outline, worldBooks, showAgentNotice, recordAgentRecord, pushFlowEvent, setAgentBusyFlow, createJsonStreamHandlers]);

  const maybePrepareAuthorRandomEvent = useCallback(async (
    saveId: string,
    latestStory: string,
    signal?: AbortSignal,
  ) => {
    const actions = useGameStore.getState();
    let current = actions.saves[saveId];
    if (!current || current.content.mode !== 'author') return;

    const config = current.content.authorRandomEvent;
    if (!config || config.mode !== 'dynamic' || !config.dynamic.enabled) return;
    // 旧版动态随机事件链路已被执笔模式的新事件弧 / 司事链路接管。
    // 保留 legacy 函数供旧存档或手动关闭司事时兜底，避免默认链路绕过 eventBeat。
    const eventBeatConfig = normalizeAuthorEventBeatConfig(current.content.authorEventBeat);
    if (eventBeatConfig.enabled) return;

    actions.advanceAuthorArcs(saveId, current.state.currentRound);
    current = useGameStore.getState().saves[saveId] ?? current;

    const eventState = current.state.authorRandomEventState ?? {
      activeEvents: [],
      completedEvents: [],
      currentProbability: config.dynamic.baseProbability,
    };
    const nextRound = current.state.currentRound;
    if (eventState.pendingEvent) return;
    if (eventState.lastCheckedRound === nextRound) return;
    if (nextRound < config.dynamic.startRound) return;
    if (eventState.cooldownUntilRound !== undefined && nextRound < eventState.cooldownUntilRound) return;
    if ((eventState.activeEvents ?? []).some((arc) => !arc.targetEndRound || nextRound <= arc.targetEndRound)) return;

    const guaranteed =
      config.dynamic.guaranteedRanges.find((range) =>
        !range.consumed && nextRound >= range.startRound && nextRound <= range.endRound,
      )
      ?? config.dynamic.guaranteedRanges.find((range) =>
        !range.consumed && nextRound > range.endRound,
      );
    const mustTrigger = !!guaranteed;
    const baseProbability = config.dynamic.baseProbability;
    const currentProbability = Math.max(baseProbability, eventState.currentProbability ?? baseProbability);
    const missProbability = Math.min(
      config.dynamic.maxProbability,
      currentProbability + config.dynamic.missProbabilityBonus,
    );

    if (!mustTrigger && Math.random() >= currentProbability) {
      actions.setAuthorRandomEventState(saveId, {
        ...eventState,
        currentProbability: missProbability,
        lastCheckedRound: nextRound,
        lastError: undefined,
      });
      return;
    }

    const referenceEvents = allEvents.filter((event) => config.dynamic.referenceEventIds.includes(event.id));
    const scheduleReason = guaranteed
      ? `第 ${nextRound} 回合处于必定触发区间 ${guaranteed.startRound}-${guaranteed.endRound}`
      : `概率检查命中，当前概率 ${Math.round(currentProbability * 100)}%`;

    setAgentBusyFlow('randomEvent', '检查长线事件');
    const result = await requestAuthorRandomEvent({
      save: current,
      settings,
      outline,
      background,
      characterName: current.content.characterName,
      currentRound: Math.max(0, nextRound - 1),
      nextRound,
      totalRounds: current.config.totalRounds,
      mustTrigger,
      scheduleReason,
      config,
      summary: current.state.summary,
      longTermMemory: current.state.longTermMemory,
      latestStory,
      recent: current.state.history.slice(-8),
      npcs: current.state.npcs ?? [],
      currentScene: current.state.currentScene,
      referenceEvents,
      worldBookEntries: getActiveWorldBookEntriesForAgent(worldBooks, current, latestStory),
      backpack: current.state.backpack ?? [],
      anchors: current.state.anchors,
      narrative: current.state.authorNarrative,
      ...createJsonStreamHandlers(saveId),
      signal,
    });
    recordAgentRecord(saveId, 'randomEvent', nextRound, {
      thinking: result.thinking,
      output: result.rawOutput ?? result,
      prompt: (result as any).trace,
      usage: result.usage,
    });

    if (result.trigger && result.arc) {
      const arc = result.arc;
      actions.setPendingAuthorEvent(saveId, arc, nextRound, baseProbability);
      const latest = useGameStore.getState().saves[saveId] ?? current;
      const nextConfig = consumeGuaranteedRangeIfNeeded(config, guaranteed?.id);
      actions.updateContentOf(saveId, {
        authorRandomEvent: nextConfig,
        eventIds: Array.from(new Set([...(latest.content.eventIds ?? []), arc.id])),
      });
      const latestEventState = useGameStore.getState().saves[saveId]?.state.authorRandomEventState ?? eventState;
      actions.setAuthorRandomEventState(saveId, {
        ...latestEventState,
        currentProbability: baseProbability,
        cooldownUntilRound: nextRound + Math.max(0, config.dynamic.cooldownRounds),
        lastCheckedRound: nextRound,
        lastError: undefined,
        lastThinking: result.thinking,
      });
      addEventToLibrary(storyArcToRandomEvent(arc));
    } else {
      actions.setAuthorRandomEventState(saveId, {
        ...eventState,
        currentProbability: missProbability,
        lastCheckedRound: nextRound,
        lastError: result.reason,
        lastThinking: result.thinking,
      });
    }
  }, [settings, outline, background, allEvents, addEventToLibrary, worldBooks, recordAgentRecord, createJsonStreamHandlers, setAgentBusyFlow]);

  const maybeRunOutlineMapper = useCallback(async (
    saveId: string,
    latestStory: string,
    signal?: AbortSignal,
    force = false,
  ) => {
    const actions = useGameStore.getState();
    const current = actions.saves[saveId];
    if (!current || current.content.mode !== 'author') return;

    const nextRound = current.state.currentRound;
    const completedRound = Math.max(0, nextRound - 1);
    const narrative = current.state.authorNarrative ?? { activeArcs: [], completedArcs: [] };
    const lastRound = narrative.lastOutlineMapperRound ?? -9999;
    const due = force || !narrative.outlineMapping || completedRound - lastRound >= 2;
    if (!due) return;

    setAgentBusyFlow('outlineMapper', '校准大纲映射');
    try {
      const mapping = await requestAuthorOutlineMapping({
        save: current,
        settings,
        outline,
        currentRound: completedRound,
        nextRound,
        totalRounds: current.config.totalRounds,
        playerInput: current.state.lastPlayerInput,
        latestStory,
        recent: current.state.history.slice(-10),
        summary: current.state.summary,
        longTermMemory: current.state.longTermMemory,
        npcs: current.state.npcs ?? [],
        currentScene: current.state.currentScene,
        narrative,
        randomEventState: current.state.authorRandomEventState,
        worldBookEntries: getActiveWorldBookEntriesForAgent(worldBooks, current, latestStory),
        anchors: current.state.anchors,
        ...createJsonStreamHandlers(saveId),
        signal,
      });
      if (!mapping) return;
      actions.setAuthorOutlineMapping(saveId, mapping, completedRound);
      recordAgentRecord(saveId, 'outlineMapper', completedRound, {
        thinking: mapping.thinking,
        output: mapping.rawOutput ?? mapping,
        prompt: (mapping as any).trace,
        usage: mapping.usage,
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err;
      console.warn('[outlineMapper] failed', err);
      recordAgentRecord(saveId, 'outlineMapper', completedRound, {
        output: { error: err?.message ?? String(err) },
      });
      showAgentNotice('大纲映射失利，沿用旧映射');
    }
  }, [settings, outline, worldBooks, showAgentNotice, recordAgentRecord, createJsonStreamHandlers, setAgentBusyFlow]);

  const maybeRunCharacterPlanner = useCallback(async (
    saveId: string,
    latestStory: string,
    signal?: AbortSignal,
    force = false,
  ) => {
    const actions = useGameStore.getState();
    const current = actions.saves[saveId];
    if (!current || current.content.mode !== 'author') return;

    const nextRound = current.state.currentRound;
    const completedRound = Math.max(0, nextRound - 1);
    const narrative = current.state.authorNarrative ?? { activeArcs: [], completedArcs: [] };
    const lastRound = narrative.lastCharacterPlannerRound ?? -9999;
    const due = force || !narrative.characterPlan || completedRound - lastRound >= 2;
    if (!due) return;

    setAgentBusyFlow('characterPlanner', '规划人物关系');
    try {
      const plan = await requestAuthorCharacterPlan({
        save: current,
        settings,
        outline,
        characterName: current.content.characterName,
        currentRound: completedRound,
        nextRound,
        playerInput: current.state.lastPlayerInput,
        latestStory,
        recent: current.state.history.slice(-10),
        summary: current.state.summary,
        longTermMemory: current.state.longTermMemory,
        npcs: current.state.npcs ?? [],
        backpack: current.state.backpack ?? [],
        currentScene: current.state.currentScene,
        narrative,
        randomEventState: current.state.authorRandomEventState,
        worldBookEntries: getActiveWorldBookEntriesForAgent(worldBooks, current, latestStory),
        anchors: current.state.anchors,
        ...createJsonStreamHandlers(saveId),
        signal,
      });
      if (!plan) return;
      actions.setAuthorCharacterPlan(saveId, plan, completedRound);
      recordAgentRecord(saveId, 'characterPlanner', completedRound, {
        thinking: plan.thinking,
        output: plan.rawOutput ?? plan,
        prompt: (plan as any).trace,
        usage: plan.usage,
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err;
      console.warn('[characterPlanner] failed', err);
      recordAgentRecord(saveId, 'characterPlanner', completedRound, {
        output: { error: err?.message ?? String(err) },
      });
      showAgentNotice('人物规划失利，沿用旧规划');
    }
  }, [settings, outline, worldBooks, showAgentNotice, recordAgentRecord, createJsonStreamHandlers, setAgentBusyFlow]);

  const maybeRunScenePlanner = useCallback(async (
    saveId: string,
    latestStory: string,
    signal?: AbortSignal,
    force = false,
  ) => {
    const actions = useGameStore.getState();
    const current = actions.saves[saveId];
    if (!current || current.content.mode !== 'author') return;

    const nextRound = current.state.currentRound;
    const completedRound = Math.max(0, nextRound - 1);
    const narrative = current.state.authorNarrative ?? { activeArcs: [], completedArcs: [] };
    const lastRound = narrative.lastScenePlannerRound ?? -9999;
    const due = force || !narrative.scenePlan || completedRound - lastRound >= 2;
    if (!due) return;

    setAgentBusyFlow('scenePlanner', '规划场景时空');
    try {
      const plan = await requestAuthorScenePlan({
        save: current,
        settings,
        outline,
        currentRound: completedRound,
        nextRound,
        playerInput: current.state.lastPlayerInput,
        latestStory,
        recent: current.state.history.slice(-10),
        summary: current.state.summary,
        longTermMemory: current.state.longTermMemory,
        npcs: current.state.npcs ?? [],
        backpack: current.state.backpack ?? [],
        currentScene: current.state.currentScene,
        availableScenes: current.state.availableScenes ?? [],
        narrative,
        randomEventState: current.state.authorRandomEventState,
        worldBookEntries: getActiveWorldBookEntriesForAgent(worldBooks, current, latestStory),
        anchors: current.state.anchors,
        ...createJsonStreamHandlers(saveId),
        signal,
      });
      if (!plan) return;
      actions.setAuthorScenePlan(saveId, plan, completedRound);
      recordAgentRecord(saveId, 'scenePlanner', completedRound, {
        thinking: plan.thinking,
        output: plan.rawOutput ?? plan,
        prompt: (plan as any).trace,
        usage: plan.usage,
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err;
      console.warn('[scenePlanner] failed', err);
      recordAgentRecord(saveId, 'scenePlanner', completedRound, {
        output: { error: err?.message ?? String(err) },
      });
      showAgentNotice('场景规划失利，沿用旧规划');
    }
  }, [settings, outline, worldBooks, showAgentNotice, recordAgentRecord, createJsonStreamHandlers, setAgentBusyFlow]);

  const maybeRunEventPlanner = useCallback(async (
    saveId: string,
    latestStory: string,
    signal?: AbortSignal,
    force = false,
  ) => {
    const actions = useGameStore.getState();
    const current = actions.saves[saveId];
    if (!current || current.content.mode !== 'author') return;

    const nextRound = current.state.currentRound;
    const completedRound = Math.max(0, nextRound - 1);
    const narrative = current.state.authorNarrative ?? { activeArcs: [], completedArcs: [] };
    const lastRound = narrative.lastEventPlannerRound ?? -9999;
    const due = force || !narrative.eventPlan || completedRound - lastRound >= 2;
    if (!due) return;

    setAgentBusyFlow('eventPlanner', '规划事件进退');
    try {
      const plan = await requestAuthorEventPlan({
        save: current,
        settings,
        outline,
        currentRound: completedRound,
        nextRound,
        playerInput: current.state.lastPlayerInput,
        latestStory,
        recent: current.state.history.slice(-10),
        summary: current.state.summary,
        longTermMemory: current.state.longTermMemory,
        npcs: current.state.npcs ?? [],
        backpack: current.state.backpack ?? [],
        currentScene: current.state.currentScene,
        narrative,
        randomEventState: current.state.authorRandomEventState,
        worldBookEntries: getActiveWorldBookEntriesForAgent(worldBooks, current, latestStory),
        anchors: current.state.anchors,
        ...createJsonStreamHandlers(saveId),
        signal,
      });
      if (!plan) return;
      actions.setAuthorEventPlan(saveId, plan, completedRound);
      recordAgentRecord(saveId, 'eventPlanner', completedRound, {
        thinking: plan.thinking,
        output: plan.rawOutput ?? plan,
        prompt: (plan as any).trace,
        usage: plan.usage,
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err;
      console.warn('[eventPlanner] failed', err);
      recordAgentRecord(saveId, 'eventPlanner', completedRound, {
        output: { error: err?.message ?? String(err) },
      });
      showAgentNotice('事件规划失利，沿用旧规划');
    }
  }, [settings, outline, worldBooks, showAgentNotice, recordAgentRecord, createJsonStreamHandlers, setAgentBusyFlow]);

  const maybeRunAuthorEventBeat = useCallback(async (
    saveId: string,
    latestStory: string,
    signal?: AbortSignal,
    force = false,
  ) => {
    const actions = useGameStore.getState();
    const current = actions.saves[saveId];
    if (!current || current.content.mode !== 'author') return;

    const config = normalizeAuthorEventBeatConfig(current.content.authorEventBeat);
    if (!config.enabled) return;

    const nextRound = current.state.currentRound;
    const completedRound = Math.max(0, nextRound - 1);
    const narrative = current.state.authorNarrative ?? { activeArcs: [], completedArcs: [] };
    if (!narrative.activeArcs?.length) return;
    const lastRound = narrative.lastEventBeatRound ?? -9999;
    const due = force || !narrative.eventBeat || completedRound > lastRound;
    if (!due) return;

    setAgentBusyFlow('eventBeat', '判定事件节奏');
    try {
      const result = await requestAuthorEventBeat({
        save: current,
        settings,
        outline,
        background,
        characterName: current.content.characterName,
        currentRound: completedRound,
        config,
        summary: current.state.summary,
        longTermMemory: current.state.longTermMemory,
        recent: current.state.history.slice(-10),
        latestStory,
        npcs: current.state.npcs ?? [],
        backpack: current.state.backpack ?? [],
        currentScene: current.state.currentScene,
        narrative,
        anchors: current.state.anchors ?? [],
        ...createJsonStreamHandlers(saveId),
        onToolActivity: (activity: any) => {
          const call = activity.call ?? {};
          const name = String(call.name ?? 'tool');
          const args = call.arguments ?? {};
          const trim = (text: unknown, max = 26): string => {
            const s = typeof text === 'string' ? text.trim() : String(text ?? '').trim();
            if (!s) return '';
            return s.length > max ? `${s.slice(0, max)}…` : s;
          };
          const formatAffinity = (delta: unknown): string => {
            const n = Number(delta);
            if (!Number.isFinite(n)) return '';
            return n >= 0 ? `+${n}` : `${n}`;
          };
          const label = (() => {
            if (activity.phase === 'result') return `完成 ${name}`;
            if (name === 'get_npc_list') return '查阅了 NPC 列表';
            if (name === 'get_npc_detail') return `查阅了 ${args.name || args.npcId || 'NPC'} 档案`;
            if (name === 'get_active_arcs') return '查阅了进行中的事件弧';
            if (name === 'get_recent_rounds') return `查阅了最近 ${args.n ?? ''} 回合`;
            if (name === 'set_npc_affinity') {
              const target = args.npcName || args.name || args.npcId || 'NPC';
              const delta = formatAffinity(args.delta);
              const reason = trim(args.reason);
              const base = delta ? `调整 ${target} 好感 ${delta}` : `调整 ${target} 好感`;
              return reason ? `${base}（${reason}）` : base;
            }
            if (name === 'add_npc_note') {
              const target = args.npcName || args.name || args.npcId || 'NPC';
              const note = trim(args.note);
              return note ? `给 ${target} 加了备注：${note}` : `给 ${target} 加了备注`;
            }
            if (name === 'grant_minor_item') {
              const target = args.name || args.itemId || '事件能力';
              const brief = trim(args.description || args.brief || args.note);
              return brief ? `授予能力：${target} · ${brief}` : `授予能力：${target}`;
            }
            if (name === 'update_item_note') {
              const target = args.name || args.itemId || '能力';
              const note = trim(args.note);
              return note ? `更新 ${target} 备注：${note}` : `更新 ${target} 备注`;
            }
            return `调用了 ${name}`;
          })();
          pushFlowEvent({
            name,
            actor: '司事',
            agentKind: 'eventBeat',
            label,
            detail: activity.phase === 'result'
              ? String(activity.resultText ?? '').slice(0, 160)
              : JSON.stringify(args).slice(0, 160),
            phase: activity.phase === 'result' ? 'result' : 'call',
          });
        },
        signal,
      });
      if (!result) return;
      recordAgentRecord(saveId, 'eventBeat', completedRound, {
        thinking: result.thinking,
        output: result.rawOutput ?? result,
        prompt: (result as any).trace,
        usage: result.usage,
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err;
      console.warn('[eventBeat] failed', err);
      recordAgentRecord(saveId, 'eventBeat', completedRound, {
        output: { error: err?.message ?? String(err) },
      });
      showAgentNotice('司事判定失利，沿用旧事件状态');
    }
  }, [settings, outline, background, showAgentNotice, recordAgentRecord, pushFlowEvent, setAgentBusyFlow, createJsonStreamHandlers]);

  const maybeUpdateAuthorDirectorPlan = useCallback(async (
    saveId: string,
    latestStory: string,
    signal?: AbortSignal,
    force = false,
  ): Promise<boolean> => {
    const actions = useGameStore.getState();
    const current = actions.saves[saveId];
    if (!current || current.content.mode !== 'author') return false;

    const config = current.content.authorDirector;
    if (!config?.enabled) return false;

    const nextRound = current.state.currentRound;
    const completedRound = Math.max(0, nextRound - 1);
    const narrative = current.state.authorNarrative ?? { activeArcs: [], completedArcs: [] };
    const directorMode = narrative.orchestrator?.directorMode;
    if (directorMode === 'skip') return false;
    const plan = narrative.plan;
    const covered = !!plan?.nextFewRoundsPlan?.some((item) =>
      nextRound >= item.startRound && nextRound <= item.endRound,
    );
    const stageExpired = plan?.stageTargetEndRound !== undefined && nextRound > plan.stageTargetEndRound;
    const lastDirectorRound = narrative.lastDirectorRound ?? -9999;
    const every = Math.max(1, config.everyRounds ?? 2);
    const due = force || !plan || !covered || stageExpired || completedRound - lastDirectorRound >= every;
    if (!due) return false;

    setAgentBusyFlow('director', '规划近期走向');
    const nextPlan = await requestAuthorDirectorPlan({
      save: current,
      settings,
      outline,
      background,
      characterName: current.content.characterName,
      currentRound: completedRound,
      nextRound,
      totalRounds: current.config.totalRounds,
      config,
      directorMode,
      strictCustom: getPromptConfig(current.content),
      summary: current.state.summary,
      longTermMemory: current.state.longTermMemory,
      recent: current.state.history.slice(-10),
      latestStory,
      npcs: current.state.npcs ?? [],
      currentScene: current.state.currentScene,
      narrative,
      randomEventState: current.state.authorRandomEventState,
      worldBookEntries: getActiveWorldBookEntriesForAgent(worldBooks, current, latestStory),
      backpack: current.state.backpack ?? [],
      anchors: current.state.anchors,
      ...createJsonStreamHandlers(saveId),
      onToolActivity: (activity) => {
        pushFlowEvent({
          ...activity,
          actor: activity.actor || '叙事导演',
          agentKind: activity.agentKind || 'director',
          phase: activity.phase || 'call',
        });
      },
      signal,
    });

    if (!nextPlan) return false;
    recordAgentRecord(saveId, 'director', completedRound, {
      thinking: nextPlan.thinking,
      output: nextPlan.rawOutput ?? nextPlan,
      prompt: (nextPlan as any).trace,
      usage: nextPlan.usage,
    });
    const latest = useGameStore.getState().saves[saveId] ?? current;
    actions.setAuthorNarrativeState(saveId, {
      ...(latest.state.authorNarrative ?? narrative),
      plan: nextPlan,
      activeArcs: latest.state.authorNarrative?.activeArcs ?? narrative.activeArcs,
      completedArcs: latest.state.authorNarrative?.completedArcs ?? narrative.completedArcs,
      lastDirectorRound: completedRound,
    });
    if (nextPlan.eventUpdates?.length) {
      actions.applyAuthorEventUpdates(saveId, nextPlan.eventUpdates, completedRound);
    }
    return true;
  }, [settings, outline, background, worldBooks, recordAgentRecord, createJsonStreamHandlers, setAgentBusyFlow, pushFlowEvent]);

  const maybeUpdateAuthorLogicReview = useCallback(async (
    saveId: string,
    latestStory: string,
    signal?: AbortSignal,
    force = false,
  ) => {
    const actions = useGameStore.getState();
    const current = actions.saves[saveId];
    if (!current || current.content.mode !== 'author') return;

    const config = current.content.authorLogicCheck;
    if (!config?.enabled) return;

    const completedRound = Math.max(0, current.state.currentRound - 1);
    if (completedRound <= 0) return;
    const narrative = current.state.authorNarrative ?? { activeArcs: [], completedArcs: [] };
    const lastLogicCheckRound = narrative.lastLogicCheckRound ?? 0;
    const every = Math.max(1, config.everyRounds ?? 3);
    const due = force || !narrative.logicReview || completedRound - lastLogicCheckRound >= every;
    if (!due) return;

    setAgentBusyFlow('logicCheck', '审校连续性');
    const review = await requestAuthorLogicCheck({
      save: current,
      settings,
      outline,
      background,
      characterName: current.content.characterName,
      currentRound: completedRound,
      totalRounds: current.config.totalRounds,
      config,
      summary: current.state.summary,
      longTermMemory: current.state.longTermMemory,
      recent: current.state.history.slice(-12),
      latestStory,
      npcs: current.state.npcs ?? [],
      backpack: current.state.backpack ?? [],
      currentScene: current.state.currentScene,
      availableScenes: current.state.availableScenes ?? [],
      narrative,
      randomEventState: current.state.authorRandomEventState,
      worldBookEntries: getActiveWorldBookEntriesForAgent(worldBooks, current, latestStory),
      anchors: current.state.anchors,
      ...createJsonStreamHandlers(saveId),
      signal,
    });

    if (!review) return;
    recordAgentRecord(saveId, 'logicCheck', completedRound, {
      thinking: review.thinking,
      output: review.rawOutput ?? review,
      prompt: (review as any).trace,
      usage: review.usage,
    });
    const latest = useGameStore.getState().saves[saveId] ?? current;
    actions.setAuthorNarrativeState(saveId, {
      ...(latest.state.authorNarrative ?? narrative),
      logicReview: review,
      activeArcs: latest.state.authorNarrative?.activeArcs ?? narrative.activeArcs,
      completedArcs: latest.state.authorNarrative?.completedArcs ?? narrative.completedArcs,
      lastLogicCheckRound: completedRound,
    });
  }, [settings, outline, background, worldBooks, recordAgentRecord, createJsonStreamHandlers, setAgentBusyFlow]);

  const maybeRunSettingGuard = useCallback(async (
    saveId: string,
    signal?: AbortSignal,
  ): Promise<{ memoryUrgent: boolean }> => {
    const actions = useGameStore.getState();
    const current = actions.saves[saveId];
    if (!current || current.content.mode !== 'author') return { memoryUrgent: false };

    const config = normalizeAuthorSettingGuardConfig(current.content.authorSettingGuard);
    if (!config.enabled) return { memoryUrgent: false };

    const completedRound = current.state.currentRound;
    const nextRound = completedRound + 1;
    const allEntries = flattenWorldBookEntries(worldBooks, current.content.worldBookIds);

    setAgentBusyFlow('settingGuard', '守护设定边界');
    try {
      const result = await requestSettingGuard({
        save: current,
        settings,
        outline,
        background,
        characterName: current.content.characterName,
        currentRound: completedRound,
        nextRound,
        totalRounds: current.config.totalRounds,
        config,
        summary: current.state.summary,
        longTermMemory: current.state.longTermMemory,
        recent: current.state.history.slice(-8),
        playerInput: current.state.lastPlayerInput,
        npcs: current.state.npcs ?? [],
        backpack: current.state.backpack ?? [],
        currentScene: current.state.currentScene,
        worldBookEntries: allEntries,
        anchors: current.state.anchors ?? [],
        narrative: current.state.authorNarrative,
        randomEventState: current.state.authorRandomEventState,
        ...createJsonStreamHandlers(saveId),
        signal,
      });

      if (!result) {
        actions.setSettingGuardError(saveId, '守护者未返回可用 JSON');
        recordAgentRecord(saveId, 'settingGuard', completedRound, {
          output: { error: '守护者未返回可用 JSON，已跳过本次设定守护。' },
        });
        return { memoryUrgent: false };
      }

      actions.applySettingGuardResult(saveId, result, completedRound);
      recordAgentRecord(saveId, 'settingGuard', completedRound, {
          thinking: result.thinking,
          output: result.rawOutput ?? result,
          prompt: (result as any).trace,
          usage: result.usage,
      });

      if (config.candidatesAutoAccept) {
        const fresh = useGameStore.getState().saves[saveId];
        const pending = fresh?.state.authorNarrative?.settingGuard?.candidates
          .filter((c) => c.status === 'pending') ?? [];
        pending.forEach((c) => actions.acceptSettingCandidate(saveId, c.id));
      }

      return { memoryUrgent: result.memoryUrgency === 'high' };
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err;
      console.warn('[settingGuard] failed', err);
      actions.setSettingGuardError(saveId, err?.message ?? String(err));
      recordAgentRecord(saveId, 'settingGuard', completedRound, {
        output: { error: err?.message ?? String(err) },
      });
      showAgentNotice('设定守护失利，沿用上次设定');
      return { memoryUrgent: false };
    }
  }, [settings, outline, background, worldBooks, showAgentNotice, recordAgentRecord, createJsonStreamHandlers, setAgentBusyFlow]);

  const maybeRunStageJudge = useCallback(async (
    saveId: string,
    signal?: AbortSignal,
  ) => {
    const actions = useGameStore.getState();
    const current = actions.saves[saveId];
    if (!current || current.content.mode !== 'author') return;

    const config = normalizeAuthorStageJudgeConfig(current.content.authorStageJudge);
    if (!config.enabled) return;

    const completedRound = current.state.currentRound;
    const nextRound = completedRound + 1;
    setAgentBusyFlow('stageJudge', '判断玩家意图与阶段');
    try {
      const arcsForJudge = [
        ...(current.state.authorRandomEventState?.activeEvents ?? []),
        ...(current.state.authorNarrative?.activeArcs ?? []),
      ];
      const result = await requestStageJudge({
        save: current,
        settings,
        outline,
        characterName: current.content.characterName,
        currentRound: completedRound,
        nextRound,
        config,
        summary: current.state.summary,
        longTermMemory: current.state.longTermMemory,
        recent: current.state.history.slice(-6),
        playerInput: current.state.lastPlayerInput,
        npcs: current.state.npcs ?? [],
        currentScene: current.state.currentScene,
        masterArc: current.state.authorNarrative?.masterArc,
        narrativePlan: current.state.authorNarrative?.plan,
        previous: current.state.authorNarrative?.stageJudge,
        narrative: current.state.authorNarrative,
        worldBookEntries: flattenWorldBookEntries(worldBooks, current.content.worldBookIds),
        anchors: current.state.anchors ?? [],
        activeArcs: arcsForJudge,
        ...createJsonStreamHandlers(saveId),
        signal,
      });

      if (!result) {
        actions.setStageJudgeError(saveId, '阶段判断未返回可用 JSON，沿用上次判断。');
        recordAgentRecord(saveId, 'stageJudge', completedRound, {
          output: { error: '阶段判断未返回可用 JSON，沿用上次判断。' },
        });
        return;
      }

      actions.applyStageJudgeResult(saveId, result, completedRound);
      recordAgentRecord(saveId, 'stageJudge', completedRound, {
        thinking: result.thinking,
        output: result.rawOutput ?? result,
        prompt: (result as any).trace,
        usage: result.usage,
      });
      if (config.autoAdvance && result.stageStatus.shouldAdvance) {
        actions.advanceMasterArcStage(saveId, result.stageStatus.advanceReasoning);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err;
      console.warn('[stageJudge] failed', err);
      actions.setStageJudgeError(saveId, err?.message ?? String(err));
      recordAgentRecord(saveId, 'stageJudge', completedRound, {
        output: { error: err?.message ?? String(err) },
      });
      showAgentNotice('阶段判断失利，沿用上次结果');
    }
  }, [settings, outline, showAgentNotice, worldBooks, recordAgentRecord, createJsonStreamHandlers, setAgentBusyFlow]);

  // ----- 异步任务：故事 -----
  const runStory = useCallback(async () => {
    const initial = getSave();
    if (!initial) return;
    const actions = useGameStore.getState();
    if (initial.content.mode === 'author') {
      actions.advanceAuthorArcs(initial.id, initial.state.currentRound);
    }
    const s = useGameStore.getState().saves[initial.id] ?? initial;
    let currentForStory = s;

    flowSaveIdRef.current = s.id;
    const roundStartedAt = Date.now();
    patchRuntimeProgress(s.id, {
      busy: true,
      agentBusy: null,
      streaming: '',
      streamingThinking: '',
      streamingAgentOutput: '',
      streamingToolEvents: [],
      roundStartedAt,
      agentStartedAt: undefined,
      runtimeTotalUsage: undefined,
      runtimeEstimatedOutputTokens: 0,
    });
    setBusy(true);
    setErrorMsg(undefined);
    setStreaming('');
    setStreamingThinking('');
    setStreamingAgentOutput('');
    setRuntimeRoundStartedAt(roundStartedAt);
    setRuntimeAgentStartedAt(undefined);
    setRuntimeTotalUsage(undefined);
    setRuntimeEstimatedOutputTokens(0);
    setStreamingToolEvents([]);
    streamingToolEventsRef.current = [];

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      let orchestrator: OrchestratorState | undefined;
      let preStoryDirectorRan = false;
      if (currentForStory.content.mode === 'author') {
        orchestrator = await maybeRunAuthorOrchestrator(currentForStory.id, abort.signal);
        const executedPreCalls = new Set<OrchestratorCallKey>();
        for (const key of getPreStoryCallOrder(orchestrator)) {
          currentForStory = useGameStore.getState().saves[currentForStory.id] ?? currentForStory;
          if (executedPreCalls.has(key)) continue;
          executedPreCalls.add(key);
          const latestAssistant = [...currentForStory.state.history].reverse().find((m) => m.role === 'assistant')?.content ?? '';
          if (key === 'outlineMapper') {
            await maybeRunOutlineMapper(currentForStory.id, latestAssistant, abort.signal, true);
          } else if (key === 'stageJudge') {
            await maybeRunStageJudge(currentForStory.id, abort.signal);
          } else if (key === 'settingGuard') {
            const guard = await maybeRunSettingGuard(currentForStory.id, abort.signal);
            if (guard.memoryUrgent && !executedPreCalls.has('memory')) {
              executedPreCalls.add('memory');
              currentForStory = useGameStore.getState().saves[currentForStory.id] ?? currentForStory;
              await runMemoryNow(currentForStory.id, abort.signal);
            }
          } else if (key === 'eventBeat') {
            await maybeRunAuthorEventBeat(currentForStory.id, latestAssistant, abort.signal, true);
          } else if (key === 'director') {
            preStoryDirectorRan = await maybeUpdateAuthorDirectorPlan(currentForStory.id, latestAssistant, abort.signal, true) || preStoryDirectorRan;
          }
        }
        currentForStory = useGameStore.getState().saves[currentForStory.id] ?? currentForStory;
      }

      const { state, config, content } = currentForStory;
      const pendingAuthorArc = getPendingAuthorArcForCurrentRound(currentForStory);
      const recentText = state.history.slice(-6).map((m) => m.content).join('\n').slice(-RECENT_TEXT_WINDOW);
      const candidateEntries = flattenWorldBookEntries(worldBooks, content.worldBookIds);
      const activeEntries = matchWorldBook({
        entries: candidateEntries,
        recentText,
        currentInput: state.lastPlayerInput,
      });

      const scheduledEventIds = getScheduledEventIds(content);
      const eventCandidates = allEvents.filter((e) => scheduledEventIds.includes(e.id));
      const triggeredEvent = pickRandomEvent({
        candidates: eventCandidates,
        currentRound: state.currentRound,
        triggered: state.triggeredEvents,
      });

      const selectedSet = new Set(state.selectedItemIds ?? []);
      const usedItems: Item[] = (state.backpack ?? []).filter((it) => selectedSet.has(it.id));
      const storySettings = content.storyStyle
        ? {
          ...settings,
          storyLength: content.storyStyle.storyLength,
          storyStyleAddendum: content.storyStyle.storyStyleAddendum,
        }
        : settings;

      actions.captureSnapshot(currentForStory.id, 'before_story', state.currentRound);
      setAgentBusyFlow('story', '准备书写正文');
      const storyResult = await requestStory({
        save: currentForStory,
        settings: storySettings,
        outline,
        background,
        characterName: content.characterName,
        activeWorldBookEntries: activeEntries,
        summary: state.summary,
        longTermMemory: state.longTermMemory,
        history: state.history,
        currentRound: state.currentRound,
        totalRounds: config.totalRounds,
        triggeredEvent,
        playerInput: state.lastPlayerInput,
        regenerationHint: state.regenerationHint,
        backpack: state.backpack,
        usedItems,
        npcs: state.npcs,
        anchors: state.anchors,
        currentScene: state.currentScene,
        authorNarrative: content.mode === 'author' ? state.authorNarrative : undefined,
        authorRandomEventState: content.mode === 'author' ? state.authorRandomEventState : undefined,
        strictCustom: getPromptConfig(content),
        summarizedUntilIndex: state.summarizedUntilIndex,
        finalizeRequested: !!state.finalizeRequested,
        onDelta: (t) => {
          appendRuntimeStream(s.id, t, 'streaming');
          if (mountedRef.current && !leavingPageRef.current) {
            setStreaming((prev) => prev + t);
          }
        },
        onThinkingDelta: (t) => {
          appendRuntimeStream(s.id, t, 'streamingThinking');
          if (mountedRef.current && !leavingPageRef.current) {
            setStreamingThinking((prev) => prev + t);
          }
        },
        onToolActivity: (activity) => {
          pushFlowEvent({
            ...activity,
            actor: activity.actor || '故事写手',
            agentKind: activity.agentKind || 'story',
            phase: activity.phase || 'read',
          });
        },
        signal: abort.signal,
      });
      const full = storyResult.text;

      if (!full.trim()) throw new Error('模型未返回任何内容');

      const nextRound = state.currentRound;
      actions.appendMessage(s.id, {
        role: 'assistant',
        content: full,
        round: nextRound,
        thinking: storyResult.thinking,
        toolEvents: streamingToolEventsRef.current,
      });
      recordAgentRecord(s.id, 'story', nextRound, {
        thinking: storyResult.thinking,
        output: full,
        prompt: storyResult.trace,
        usage: storyResult.usage,
      });
      actions.incrementRound(s.id);
      actions.setLastPlayerInput(s.id, undefined);
      actions.updateStateOf(s.id, { regenerationHint: undefined });
      actions.captureSnapshot(s.id, 'after_story', state.currentRound);
      patchRuntimeProgress(s.id, {
        streaming: '',
        streamingThinking: '',
        streamingAgentOutput: '',
      });
      if (mountedRef.current && !leavingPageRef.current) {
        setStreaming('');
        setStreamingThinking('');
        setStreamingAgentOutput('');
      }

      // 固化本回合获得的能力 → 结算已勾选的一次性能力 → 清空本轮选择
      actions.commitPendingGrants(s.id);
      actions.consumeSelectedConsumables(s.id);
      actions.clearSelectedItems(s.id);

      if (triggeredEvent) actions.addTriggeredEvent(s.id, triggeredEvent.id, state.currentRound);
      if (pendingAuthorArc) {
        const activated = actions.activatePendingAuthorEvent(s.id, state.currentRound);
        if (activated) actions.addTriggeredEvent(s.id, activated.id, state.currentRound);
      }

      const afterRound = state.currentRound + 1;
      const isInfinite = !config.totalRounds || config.totalRounds <= 0;
      const isFinal = isInfinite ? !!state.finalizeRequested : afterRound >= config.totalRounds;

      const refreshEvery = Math.max(1, config.refreshChoiceEvery ?? 3);
      if (!isFinal && afterRound > 0 && afterRound % refreshEvery === 0) {
        actions.grantRefresh(s.id, 1);
      }

      if (isFinal) {
        actions.clearFinalize(s.id);
        actions.endGame(s.id, full);
      } else {
        const shouldEnterManual = afterRound % Math.max(config.manualInputEvery, 1) === 0;
        if (shouldEnterManual) {
          // 先退出 story phase，再跑后处理模型。
          // 否则在这段后处理期间离开/返回 GamePage，新实例会看到 phase=story
          // 且 lastPlayerInput 已清空，误以为需要用“（请推进剧情。）”再生成一回合。
          actions.setPhase(s.id, 'manual');
          try {
            await applyDecisionForStory(s, full, false, abort.signal);
            const latestOrchestrator = useGameStore.getState().saves[s.id]?.state.authorNarrative?.orchestrator ?? orchestrator;
            await maybePrepareAuthorRandomEvent(s.id, full, abort.signal);
            if ((!latestOrchestrator || latestOrchestrator.calls.director.run) && !preStoryDirectorRan) {
              await maybeUpdateAuthorDirectorPlan(s.id, full, abort.signal, false);
            }
            if (!latestOrchestrator || latestOrchestrator.calls.logicCheck.run) {
              await maybeUpdateAuthorLogicReview(s.id, full, abort.signal, true);
            }
          } catch (err: any) {
            if (err?.name === 'AbortError') throw err;
            const msg = err?.message ?? String(err);
            console.warn('[decisionAgent/authorRandomEvent] tracking update failed', err);
            if (mountedRef.current && !leavingPageRef.current) setErrorMsg(msg);
          }
        } else {
          actions.setChoices(s.id, undefined);
          actions.setPhase(s.id, 'choices');
        }
          const latestOrchestrator = useGameStore.getState().saves[s.id]?.state.authorNarrative?.orchestrator ?? orchestrator;
          maybeCompress({
            save: useGameStore.getState().saves[s.id] ?? s,
            settings,
            history: [...state.history, { role: 'assistant', content: full, round: nextRound }],
            summary: state.summary,
            summarizedUntilIndex: state.summarizedUntilIndex ?? 0,
            maxMessages: latestOrchestrator?.calls.summary.run ? Math.min(settings.maxHistoryRounds, 8) : settings.maxHistoryRounds,
          keepTail: 12,
          outline,
        })
          .then((res) => {
            if (res) actions.updateStateOf(s.id, {
              summary: res.newSummary,
              summarizedUntilIndex: res.newSummarizedUntilIndex,
            });
            if (res) recordAgentRecord(s.id, 'summary', afterRound, {
              thinking: res.thinking,
              output: res.rawOutput ?? res.newSummary,
              prompt: res.trace,
              usage: res.usage,
            });
          })
          .catch(() => {});
      }
      const finalProgress = getRuntimeProgress(s.id);
      actions.updateAssistantRuntimeStats(s.id, nextRound, {
        toolEvents: streamingToolEventsRef.current,
        runtimeStats: {
          elapsedMs: Date.now() - roundStartedAt,
          usage: finalProgress?.runtimeTotalUsage,
          estimatedOutputTokens: finalProgress?.runtimeEstimatedOutputTokens,
        },
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        if (mountedRef.current && !leavingPageRef.current) {
          setStreaming('');
          setStreamingThinking('');
          setStreamingAgentOutput('');
          // 保留 streamingToolEvents，仅追加 _aborted 标记让 UI 显示"已取消"。
          // 残留会在下一回合 runStory 开头被清空。
          pushFlowEvent({
            name: '_aborted',
            actor: '_aborted',
            label: '已取消',
            phase: 'status',
          });
        }
        return;
      }
      const msg = err?.message ?? String(err);
      if (mountedRef.current && !leavingPageRef.current) setErrorMsg(msg);
      actions.setError(s.id, msg);
    } finally {
      clearRuntimeProgress(s.id);
      if (mountedRef.current && !leavingPageRef.current) setBusy(false);
      if (mountedRef.current && !leavingPageRef.current) setAgentBusy(null);
      if (mountedRef.current && !leavingPageRef.current) {
        setStreaming('');
        setStreamingThinking('');
        setStreamingAgentOutput('');
        setRuntimeRoundStartedAt(undefined);
        setRuntimeAgentStartedAt(undefined);
        setRuntimeTotalUsage(undefined);
        setRuntimeEstimatedOutputTokens(0);
        streamingToolEventsRef.current = [];
        setStreamingToolEvents([]);
      }
      if (abortRef.current === abort) abortRef.current = null;
    }
  }, [
    getSave,
    settings,
    outline,
    background,
    worldBooks,
    allEvents,
    applyDecisionForStory,
    maybePrepareAuthorRandomEvent,
    maybeRunOutlineMapper,
    maybeRunAuthorEventBeat,
    maybeUpdateAuthorDirectorPlan,
    maybeUpdateAuthorLogicReview,
    maybeRunAuthorOrchestrator,
    maybeRunSettingGuard,
    maybeRunStageJudge,
    runMemoryNow,
    recordAgentRecord,
  ]);

  // ----- 异步任务：选项 + 给予/失效能力 -----
  const runChoices = useCallback(async () => {
    const s = getSave();
    if (!s) return;
    const lastAssistant = [...s.state.history].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistant) return;

    flowSaveIdRef.current = s.id;
    const roundStartedAt = Date.now();
    setBusy(true);
    patchRuntimeProgress(s.id, {
      busy: true,
      agentBusy: 'decisionWithChoices',
      streaming: '',
      streamingThinking: '',
      streamingAgentOutput: '',
      streamingToolEvents: [],
      roundStartedAt,
      agentStartedAt: undefined,
      runtimeTotalUsage: undefined,
      runtimeEstimatedOutputTokens: 0,
    });
    setRuntimeRoundStartedAt(roundStartedAt);
    setRuntimeAgentStartedAt(undefined);
    setRuntimeTotalUsage(undefined);
    setRuntimeEstimatedOutputTokens(0);
    setErrorMsg(undefined);
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      await applyDecisionForStory(s, lastAssistant.content, true, abort.signal);
      const latestOrchestrator = useGameStore.getState().saves[s.id]?.state.authorNarrative?.orchestrator;
      await maybePrepareAuthorRandomEvent(s.id, lastAssistant.content, abort.signal);
      if (!latestOrchestrator || latestOrchestrator.calls.director.run) {
        await maybeUpdateAuthorDirectorPlan(s.id, lastAssistant.content, abort.signal, false);
      }
      if (!latestOrchestrator || latestOrchestrator.calls.logicCheck.run) {
        await maybeUpdateAuthorLogicReview(s.id, lastAssistant.content, abort.signal, true);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      const msg = err?.message ?? String(err);
      setErrorMsg(msg);
    } finally {
      clearRuntimeProgress(s.id);
      if (abortRef.current === abort) abortRef.current = null;
      if (mountedRef.current && !leavingPageRef.current) setBusy(false);
      if (mountedRef.current && !leavingPageRef.current) {
        setRuntimeRoundStartedAt(undefined);
        setRuntimeAgentStartedAt(undefined);
        setRuntimeTotalUsage(undefined);
        setRuntimeEstimatedOutputTokens(0);
        setStreamingAgentOutput('');
        setStreamingThinking('');
      }
    }
  }, [getSave, applyDecisionForStory, maybePrepareAuthorRandomEvent, maybeUpdateAuthorDirectorPlan, maybeUpdateAuthorLogicReview]);

  // ----- 异步任务：评分 -----
  const runReview = useCallback(async () => {
    const s = getSave();
    if (!s) return;
    const actions = useGameStore.getState();
    flowSaveIdRef.current = s.id;
    const roundStartedAt = Date.now();
    setReviewing(true);
    patchRuntimeProgress(s.id, { busy: true, agentBusy: 'review', streaming: '', streamingThinking: '', streamingAgentOutput: '', streamingToolEvents: [], roundStartedAt, agentStartedAt: undefined, runtimeTotalUsage: undefined, runtimeEstimatedOutputTokens: 0 });
    setRuntimeRoundStartedAt(roundStartedAt);
    setRuntimeAgentStartedAt(undefined);
    setRuntimeTotalUsage(undefined);
    setRuntimeEstimatedOutputTokens(0);
    setAgentBusyFlow('review', '评阅旅程');
    setErrorMsg(undefined);
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const review = await requestReview({
        settings,
        save: s,
        outline,
        background,
        ...createJsonStreamHandlers(s.id),
        signal: abort.signal,
      });
      actions.setReview(s.id, review);
      recordAgentRecord(s.id, 'review', s.state.currentRound, {
        thinking: review.thinking,
        output: review.rawOutput ?? review,
        prompt: (review as any).trace,
        usage: review.usage,
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setErrorMsg(err?.message ?? String(err));
    } finally {
      clearRuntimeProgress(s.id);
      if (abortRef.current === abort) abortRef.current = null;
      if (mountedRef.current && !leavingPageRef.current) setReviewing(false);
      if (mountedRef.current && !leavingPageRef.current) setAgentBusy(null);
      if (mountedRef.current && !leavingPageRef.current) {
        setRuntimeRoundStartedAt(undefined);
        setRuntimeAgentStartedAt(undefined);
        setRuntimeTotalUsage(undefined);
        setRuntimeEstimatedOutputTokens(0);
        setStreamingAgentOutput('');
        setStreamingThinking('');
      }
    }
  }, [getSave, settings, outline, background, recordAgentRecord, createJsonStreamHandlers, setAgentBusyFlow]);

  const regenerateMasterArc = useCallback(async () => {
    const current = getSave();
    if (!current || current.content.mode !== 'author' || !outline) return;
    const ok = await confirmDialog({
      title: '重新生成主弧',
      message: '重新生成主弧会丢失现有阶段节拍的完成记录，确定继续吗？',
      confirmText: '重新生成',
      variant: 'danger',
    });
    if (!ok) return;
    const actions = useGameStore.getState();
    const config = normalizeAuthorMasterArcConfig(current.content.authorMasterArc);
    const abort = new AbortController();
    abortRef.current = abort;
    flowSaveIdRef.current = current.id;
    const roundStartedAt = Date.now();
    patchRuntimeProgress(current.id, { busy: true, agentBusy: 'masterArc', streaming: '', streamingThinking: '', streamingAgentOutput: '', streamingToolEvents: [], roundStartedAt, agentStartedAt: undefined, runtimeTotalUsage: undefined, runtimeEstimatedOutputTokens: 0 });
    setRuntimeRoundStartedAt(roundStartedAt);
    setRuntimeAgentStartedAt(undefined);
    setRuntimeTotalUsage(undefined);
    setRuntimeEstimatedOutputTokens(0);
    setRegeneratingMasterArc(true);
    setAgentBusyFlow('masterArc', '生成主弧');
    setErrorMsg(undefined);
    try {
      const nextArc = await requestMasterArc({
        settings,
        outline,
        background,
        initialScene: current.state.history.find((m) => m.role === 'assistant' && m.round === 0)?.content,
        characterName: current.content.characterName,
        config,
        worldBookEntries: flattenWorldBookEntries(worldBooks, current.content.worldBookIds),
        ...createJsonStreamHandlers(current.id),
        signal: abort.signal,
      }) ?? fallbackMasterArcFromOutline(outline, config);
      actions.setMasterArc(current.id, nextArc);
      recordAgentRecord(current.id, 'masterArc', current.state.currentRound, {
        thinking: nextArc.thinking,
        output: nextArc.rawOutput ?? nextArc,
        prompt: (nextArc as any).trace,
        usage: nextArc.usage,
      });
      toast.success('主弧已重新生成。');
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      const msg = err?.message ?? String(err);
      console.warn('[masterArc] regenerate failed', err);
      if (mountedRef.current && !leavingPageRef.current) setErrorMsg(msg);
    } finally {
      clearRuntimeProgress(current.id);
      if (abortRef.current === abort) abortRef.current = null;
      if (mountedRef.current && !leavingPageRef.current) setRegeneratingMasterArc(false);
      if (mountedRef.current && !leavingPageRef.current) setAgentBusy(null);
      if (mountedRef.current && !leavingPageRef.current) {
        setRuntimeRoundStartedAt(undefined);
        setRuntimeAgentStartedAt(undefined);
        setRuntimeTotalUsage(undefined);
        setRuntimeEstimatedOutputTokens(0);
        setStreamingAgentOutput('');
        setStreamingThinking('');
      }
    }
  }, [getSave, settings, outline, background, worldBooks, recordAgentRecord, createJsonStreamHandlers, setAgentBusyFlow]);

  const runAuthorStartupPrep = useCallback(async (saveId: string) => {
    const current = useGameStore.getState().saves[saveId];
    if (!current || current.content.mode !== 'author' || !outline) return;
    if (authorStartupPrepRef.current.has(saveId)) return;
    authorStartupPrepRef.current.add(saveId);
    flowSaveIdRef.current = saveId;

    const actions = useGameStore.getState();
    const abort = new AbortController();
    abortRef.current = abort;
    const roundStartedAt = Date.now();
    setBusy(true);
    patchRuntimeProgress(saveId, { busy: true, agentBusy: 'masterArc', streaming: '', streamingThinking: '', streamingAgentOutput: '', streamingToolEvents: [], roundStartedAt, agentStartedAt: undefined, runtimeTotalUsage: undefined, runtimeEstimatedOutputTokens: 0 });
    setErrorMsg(undefined);
    setStreaming('');
    setStreamingThinking('');
    setStreamingAgentOutput('');
    setRuntimeRoundStartedAt(roundStartedAt);
    setRuntimeAgentStartedAt(undefined);
    setRuntimeTotalUsage(undefined);
    setRuntimeEstimatedOutputTokens(0);
    setStreamingToolEvents([]);
    streamingToolEventsRef.current = [];

    try {
      const config = normalizeAuthorMasterArcConfig(current.content.authorMasterArc);
      const initialScene = current.state.history.find((m) => m.role === 'assistant' && m.round === 0)?.content;

      if (config.enabled) {
        setAgentBusyFlow('masterArc', '生成开局主弧');
        const nextArc = await requestMasterArc({
          settings,
          outline,
          background,
          initialScene,
          characterName: current.content.characterName,
          config,
          worldBookEntries: flattenWorldBookEntries(worldBooks, current.content.worldBookIds),
          ...createJsonStreamHandlers(saveId),
          signal: abort.signal,
        }) ?? fallbackMasterArcFromOutline(outline, config);

        actions.setMasterArc(saveId, nextArc);
        recordAgentRecord(saveId, 'masterArc', current.state.currentRound, {
          thinking: nextArc.thinking,
          output: nextArc.rawOutput ?? nextArc,
          prompt: (nextArc as any).trace,
          usage: nextArc.usage,
        });
      }

      const latest = useGameStore.getState().saves[saveId] ?? current;
      const latestOpening = latest.state.history.find((m) => m.role === 'assistant' && m.round === 0)?.content ?? initialScene ?? '';
      await maybeUpdateAuthorDirectorPlan(saveId, latestOpening, abort.signal, true);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      const msg = err?.message ?? String(err);
      console.warn('[authorStartupPrep] failed', err);
      if (mountedRef.current && !leavingPageRef.current) setErrorMsg(msg);
    } finally {
      clearRuntimeProgress(saveId);
      if (abortRef.current === abort) abortRef.current = null;
      if (mountedRef.current && !leavingPageRef.current) {
        setBusy(false);
        setAgentBusy(null);
        setRuntimeRoundStartedAt(undefined);
        setRuntimeAgentStartedAt(undefined);
        setRuntimeTotalUsage(undefined);
        setRuntimeEstimatedOutputTokens(0);
        setStreamingAgentOutput('');
        setStreamingThinking('');
      }
    }
  }, [settings, outline, background, worldBooks, maybeUpdateAuthorDirectorPlan, recordAgentRecord, setAgentBusyFlow, createJsonStreamHandlers]);

  // ----- 调度器 -----
  const dispatch = useCallback(() => {
    if (!mountedRef.current || leavingPageRef.current) return;
    if (busyRef.current) return;
    const s = getSave();
    if (!s) return;
    const { phase, lastChoices, review } = s.state;

    if (outline && needsAuthorStartupPrep(s) && !authorStartupPrepRef.current.has(s.id)) {
      const key = gameTaskKey(s, 'startup');
      if (!beginGameTask(key)) {
        setBusy(true);
        setAgentBusy((prev) => prev ?? 'masterArc');
        return;
      }
      busyRef.current = true;
      runAuthorStartupPrep(s.id).finally(() => {
        endGameTask(key);
        busyRef.current = false;
        if (mountedRef.current && !leavingPageRef.current) dispatch();
      });
      return;
    }

    if (phase === 'ended') {
      if (!review && !reviewing) {
        const key = gameTaskKey(s, 'review');
        if (!beginGameTask(key)) {
          setReviewing(true);
          setAgentBusy('review');
          return;
        }
        busyRef.current = true;
        runReview().finally(() => {
          endGameTask(key);
          busyRef.current = false;
        });
      }
      return;
    }

    if (phase === 'story') {
      const key = gameTaskKey(s, 'story');
      if (!beginGameTask(key)) {
        setBusy(true);
        setAgentBusy((prev) => prev ?? 'story');
        return;
      }
      busyRef.current = true;
      runStory().finally(() => {
        endGameTask(key);
        busyRef.current = false;
        if (mountedRef.current && !leavingPageRef.current) dispatch();
      });
    } else if (phase === 'choices' && !lastChoices) {
      const key = gameTaskKey(s, 'choices');
      if (!beginGameTask(key)) {
        setBusy(true);
        setAgentBusy((prev) => prev ?? 'decisionWithChoices');
        return;
      }
      busyRef.current = true;
      runChoices().finally(() => {
        endGameTask(key);
        busyRef.current = false;
        if (mountedRef.current && !leavingPageRef.current) dispatch();
      });
    }
  }, [getSave, outline, runStory, runChoices, runReview, runAuthorStartupPrep, reviewing]);

  useEffect(() => {
    if (!leavingPageRef.current) dispatch();
    // 不把 dispatch/settings 放进依赖：设置页保存“故事长度/风格偏好”等会重建模型调用闭包，
    // 但不应在当前 phase 没变化时重新调度一次故事/决策模型。
  }, [save?.state.phase, save?.state.currentRound, save?.state.lastChoices, save?.state.review]);

  useEffect(() => {
    const syncRunningTask = () => {
      if (!mountedRef.current || leavingPageRef.current) return;
      const current = getSave();
      if (!current) return;
      const progress = getRuntimeProgress(current.id);
      if (progress?.busy) {
        setBusy(true);
        setReviewing(progress.agentBusy === 'review');
        setAgentBusy(progress.agentBusy);
        setStreaming(progress.streaming);
        setStreamingThinking(progress.streamingThinking);
        setStreamingAgentOutput(progress.streamingAgentOutput);
        setRuntimeRoundStartedAt(progress.roundStartedAt);
        setRuntimeAgentStartedAt(progress.agentStartedAt);
        setRuntimeTotalUsage(progress.runtimeTotalUsage);
        setRuntimeEstimatedOutputTokens(progress.runtimeEstimatedOutputTokens ?? 0);
        streamingToolEventsRef.current = progress.streamingToolEvents;
        setStreamingToolEvents(progress.streamingToolEvents);
        return;
      }
      const storyRunning = isGameTaskRunning(gameTaskKey(current, 'story'));
      const choicesRunning = isGameTaskRunning(gameTaskKey(current, 'choices'));
      const reviewRunning = isGameTaskRunning(gameTaskKey(current, 'review'));
      const startupRunning = isGameTaskRunning(gameTaskKey(current, 'startup'));
      if (startupRunning) {
        setBusy(true);
        setAgentBusy((prev) => prev ?? 'masterArc');
        return;
      }
      if (storyRunning) {
        setBusy(true);
        setAgentBusy((prev) => prev ?? 'story');
        return;
      }
      if (choicesRunning) {
        setBusy(true);
        setAgentBusy((prev) => prev ?? 'decisionWithChoices');
        return;
      }
      if (reviewRunning) {
        setReviewing(true);
        setAgentBusy((prev) => prev ?? 'review');
        return;
      }
      setBusy(false);
      setReviewing(false);
      setAgentBusy(null);
      setStreaming('');
      setStreamingThinking('');
      setStreamingAgentOutput('');
      setRuntimeRoundStartedAt(undefined);
      setRuntimeAgentStartedAt(undefined);
      setRuntimeTotalUsage(undefined);
      setRuntimeEstimatedOutputTokens(0);
      streamingToolEventsRef.current = [];
      setStreamingToolEvents([]);
      dispatch();
    };
    window.addEventListener(GAME_TASK_EVENT, syncRunningTask);
    window.addEventListener(GAME_PROGRESS_EVENT, syncRunningTask);
    syncRunningTask();
    return () => {
      window.removeEventListener(GAME_TASK_EVENT, syncRunningTask);
      window.removeEventListener(GAME_PROGRESS_EVENT, syncRunningTask);
    };
  }, [dispatch, getSave, save?.id]);

  // 监听主弧阶段切换，触发顶部金色丝带提示 2.5 秒
  useEffect(() => {
    const idx = save?.state.authorNarrative?.masterArc?.currentStageIndex;
    if (idx == null) {
      prevStageIndexRef.current = null;
      return;
    }
    if (prevStageIndexRef.current == null) {
      prevStageIndexRef.current = idx;
      return;
    }
    if (idx > prevStageIndexRef.current) {
      const stageName = save?.state.authorNarrative?.masterArc?.stages[idx]?.name ?? '新阶段';
      setStageAdvanceMsg(`已步入【${stageName}】阶段`);
      const timer = window.setTimeout(() => {
        if (mountedRef.current && !leavingPageRef.current) setStageAdvanceMsg(undefined);
      }, 2500);
      prevStageIndexRef.current = idx;
      return () => window.clearTimeout(timer);
    }
    prevStageIndexRef.current = idx;
  }, [save?.state.authorNarrative?.masterArc?.currentStageIndex, save?.state.authorNarrative?.masterArc?.stages]);

  // ----- 交互 -----
  function onPick(choice: Choice) {
    if (!save) return;
    const actions = useGameStore.getState();
    actions.captureSnapshot(save.id, 'before_player_input', save.state.currentRound);
    actions.appendMessage(save.id, { role: 'user', content: choice.label, round: save.state.currentRound });
    actions.setLastPlayerInput(save.id, choice.label);
    actions.setChoices(save.id, undefined);
    actions.setPhase(save.id, 'story');
  }

  function onManualSubmit(text: string) {
    if (!save) return;
    const actions = useGameStore.getState();
    actions.captureSnapshot(save.id, 'before_player_input', save.state.currentRound);
    actions.appendMessage(save.id, { role: 'user', content: text, round: save.state.currentRound });
    actions.setLastPlayerInput(save.id, text);
    actions.setPhase(save.id, 'story');
  }

  function onStop() {
    abortRef.current?.abort();
  }

  function onToggleItem(itemId: string) {
    if (!save || busy) return;
    useGameStore.getState().toggleSelectItem(save.id, itemId);
  }

  function onConsumeRefresh() {
    if (!save || busy) return;
    const ok = useGameStore.getState().consumeRefresh(save.id);
    if (!ok) return;
  }

  function onPinAnchor(msg: Message) {
    if (!save) return;
    const content = msg.content.trim();
    const excerpt = content.slice(0, 160);
    useGameStore.getState().addAnchor(save.id, { round: msg.round, excerpt, content });
  }

  function onUnpinAnchor(anchorId: string) {
    if (!save) return;
    useGameStore.getState().removeAnchor(save.id, anchorId);
  }

  function canModifyMessage(_historyIndex: number, msg: Message) {
    const currentRollbackRound = save ? Math.max(0, Math.floor(Number(save.state.currentRound) || 0)) : 0;
    const minRollbackRound = Math.max(0, currentRollbackRound - 1);
    const msgRound = Math.max(0, Math.floor(Number(msg.round) || 0));
    return (
      !!save &&
      msgRound >= minRollbackRound &&
      msgRound <= currentRollbackRound &&
      !busy &&
      !streaming &&
      !streamingThinking &&
      !streamingAgentOutput &&
      save.state.phase !== 'story'
    );
  }

  function canModifyAssistant(historyIndex: number, msg: Message) {
    return (
      !!save &&
      msg.role === 'assistant' &&
      historyIndex === latestAssistantIndex &&
      !busy &&
      !streaming &&
      !streamingThinking &&
      !streamingAgentOutput &&
      save.state.phase !== 'story'
    );
  }

  function onEditMessage(historyIndex: number, msg: Message, content: string) {
    if (!save || !canModifyMessage(historyIndex, msg)) return;
    useGameStore.getState().rollbackEditMessage(save.id, historyIndex, content);
  }

  function onDeleteMessage(historyIndex: number, msg: Message) {
    if (!save || !canModifyMessage(historyIndex, msg)) return;
    useGameStore.getState().rollbackDeleteMessage(save.id, historyIndex);
  }

  function onEditAssistant(historyIndex: number, msg: Message, content: string) {
    if (!save || !canModifyAssistant(historyIndex, msg)) return;
    useGameStore.getState().rollbackEditMessage(save.id, historyIndex, content);
  }

  function onRegenerateAssistant(historyIndex: number, msg: Message) {
    if (!save || !canModifyAssistant(historyIndex, msg)) return;
    setStreaming('');
    setStreamingThinking('');
    setStreamingAgentOutput('');
    setErrorMsg(undefined);
    busyRef.current = false;
    useGameStore.getState().rollbackRegenerateAssistant(save.id, historyIndex);
  }

  function onRegenerateAssistantWithHint(historyIndex: number, msg: Message, hint: string) {
    if (!save || !canModifyAssistant(historyIndex, msg)) return;
    setStreaming('');
    setStreamingThinking('');
    setStreamingAgentOutput('');
    setErrorMsg(undefined);
    busyRef.current = false;
    useGameStore.getState().rollbackRegenerateAssistant(save.id, historyIndex, hint);
  }

  async function onExportChatRecord() {
    if (!save) return;
    setErrorMsg(undefined);
    try {
      const fileName = `${safeFileName(save.name)}-聊天记录.md`;
      const result = await saveTextFile(formatChatRecord(save), fileName);
      if (result === 'cancelled') return;
      toast.success(result === 'saved' ? '聊天记录已写入文件。' : '聊天记录已导出。');
    } catch (err: any) {
      setErrorMsg(err?.message ?? String(err));
    }
  }

  function onChangeCurrentChoices(choices: Choice[]) {
    if (!save || busy || save.state.phase !== 'choices') return;
    useGameStore.getState().setChoices(save.id, choices);
  }

  async function onExportJourneyPackage() {
    if (!save) return;
    setErrorMsg(undefined);
    try {
      const fileName = `${safeFileName(save.name)}-旅程卷宗.zip`;
      const zip = await buildLedgerJourneyZip({
        save,
        outlines,
        backgrounds,
        worldBooks,
        events: allEvents,
      });
      const bytes = new Uint8Array(zip);
      const result = await saveBlobFile(
        new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)], { type: 'application/zip' }),
        fileName,
      );
      if (result === 'cancelled') return;
      toast.success(result === 'saved' ? '旅程卷宗已写入文件。' : '旅程卷宗已导出。');
    } catch (err: any) {
      setErrorMsg(err?.message ?? String(err));
    }
  }

  function onTravel(scene: SceneRef) {
    if (!save || busy || (save.state.needsDiscard ?? 0) > 0) return;
    const actions = useGameStore.getState();
    const label = `（我前往${scene.name}）`;
    actions.captureSnapshot(save.id, 'before_player_input', save.state.currentRound);
    actions.appendMessage(save.id, { role: 'user', content: label, round: save.state.currentRound });
    actions.setLastPlayerInput(save.id, `我决定前往${scene.name}。`);
    actions.setChoices(save.id, undefined);
    actions.setPhase(save.id, 'story');
  }

  if (!save) return null;

  const refreshesLeft = save.state.refreshesLeft ?? 0;
  const backpack = save.state.backpack ?? [];
  const selectedItemIds = save.state.selectedItemIds ?? [];
  const needsDiscard = save.state.needsDiscard ?? 0;
  const itemCapacity = save.config.itemCapacity ?? 8;
  const doomedItems = backpack.filter((it) => it.pendingDestroy);
  const interactive =
    save.state.phase === 'choices' || save.state.phase === 'manual';

  return (
    <div className="min-h-full flex flex-col">
      <ToastViewport />

      {/* 阶段切换提示：金线 + 蜡封从顶部悬浮（替代旧版金色丝带） */}
      {stageAdvanceMsg && (
        <div className="fixed top-20 left-0 right-0 z-30 px-6 pointer-events-none">
          <div className="max-w-3xl mx-auto">
            <GoldLine
              text={stageAdvanceMsg}
              variant="none"
              size="md"
              state="extending"
            />
          </div>
        </div>
      )}

      {/* agent notice：暂保留（下个 step 会替换为 toast 队列） */}

      <TopBar
        saveName={save.name}
        currentRound={save.state.currentRound}
        totalRounds={save.config.totalRounds}
        backpackCount={backpack.length}
        isInfiniteMode={!save.config.totalRounds || save.config.totalRounds <= 0}
        finalizeRequested={!!save.state.finalizeRequested}
        isEnded={save.state.phase === 'ended'}
        onHome={() => leaveGamePage('/')}
        onSettings={() => leaveGamePage('/settings')}
        onOpenBackpack={() => setBackpackOpen(true)}
        onOpenWorkspace={() => leaveGamePage(`/workspace?saveId=${encodeURIComponent(save.id)}`)}
        onExportChat={onExportChatRecord}
        onExportJourney={onExportJourneyPackage}
        onToggleFinalize={async () => {
          if (save.state.finalizeRequested) {
            const ok = await confirmDialog({
              title: '取消完结？',
              message: '取消完结请求？下一回合将继续推进而不收束。',
              confirmText: '取消完结',
            });
            if (ok) useGameStore.getState().clearFinalize(save.id);
          } else {
            const ok = await confirmDialog({
              title: '完结此旅程',
              message: '确定要完结这段旅程吗？\n\n下一回合故事模型将为整段旅程书写结局，之后进入评分阶段。',
              confirmText: '收束并出结局',
              variant: 'danger',
            });
            if (ok) useGameStore.getState().requestFinalize(save.id);
          }
        }}
      />

      <div className="flex-1 max-w-7xl w-full mx-auto px-4 py-6 grid gap-6 md:grid-cols-[1fr_300px] lg:grid-cols-[1fr_340px]">
        {/* 主列 */}
        <div className="min-w-0">
          <StoryView
            history={save.state.history}
            streaming={streaming}
            streamingThinking={streamingThinking}
            streamingAgentOutput={streamingAgentOutput}
            streamingToolEvents={streamingToolEvents}
            agentBusy={agentBusy}
            agentBusyLabel={agentBusy ? AGENT_ACTOR_LABELS[agentBusy] : undefined}
            runtimeRoundStartedAt={runtimeRoundStartedAt}
            runtimeAgentStartedAt={runtimeAgentStartedAt}
            runtimeTotalUsage={runtimeTotalUsage}
            runtimeEstimatedOutputTokens={runtimeEstimatedOutputTokens}
            agentThoughts={save.state.agentThoughts}
            phase={save.state.phase}
            anchors={save.state.anchors}
            onPinAnchor={onPinAnchor}
            onUnpinAnchor={onUnpinAnchor}
            onEditMessage={onEditMessage}
            onDeleteMessage={onDeleteMessage}
            onEditAssistant={onEditAssistant}
            onRegenerateAssistant={onRegenerateAssistant}
            onRegenerateAssistantWithHint={onRegenerateAssistantWithHint}
            canModifyMessage={canModifyMessage}
            canEditAssistant={canModifyAssistant}
            canRegenerateAssistant={canModifyAssistant}
          />

          {save.state.phase === 'ended' && (
            <>
              <ReviewPanel
                review={save.state.review}
                loading={reviewing}
                onRegenerate={save.state.review ? runReview : undefined}
              />
              <div className="flex justify-center gap-2 mt-8">
                <Button onClick={() => leaveGamePage('/')}>返回主页</Button>
              </div>
            </>
          )}

          {errorMsg && (
            <div className="mt-6 text-sm text-blood bg-blood/10 border border-blood/50 rounded px-4 py-3 font-serif">
              出错：{errorMsg}
              <div className="mt-2">
                <Button size="sm" variant="outline" onClick={() => {
                  setErrorMsg(undefined);
                  busyRef.current = false;
                  dispatch();
                }}>
                  <RotateCw size={14} /> 重试
                </Button>
              </div>
            </div>
          )}


          {/* 底部交互区 */}
          <div className="mt-8 sticky bottom-0 -mx-4 px-4 pt-4 pb-4 bg-gradient-to-t from-ink via-ink/95 to-transparent">
            {/* 加载态：金线 + 嵌入文字（核心 UI 语言） */}
            <div className="mb-3">
              <AutoGoldLine
                visible={busy}
                text={busy ? (agentBusy ? AGENT_LABELS[agentBusy] : '故事之笔正在书写') : ''}
                variant="none"
                size="md"
              />
            </div>

            {busy && agentBusy === 'story' && (
              <div className="mb-3 flex justify-end">
                <Button size="sm" variant="outline" onClick={onStop}>
                  <StopCircle size={14} /> 中止
                </Button>
              </div>
            )}

            {!busy && interactive && (
              <div key={save.state.phase} className="animate-slide-up-in">
                {doomedItems.length > 0 && (
                  <div className="mb-3 text-sm bg-blood/10 border border-blood/50 rounded px-3 py-2 font-serif">
                    <div className="text-blood/90 text-xs tracking-[0.3em] uppercase mb-1">本回合将失去</div>
                    <ul className="space-y-0.5">
                      {doomedItems.map((it) => (
                        <li key={it.id} className="text-parchment-200/90">
                          <span className="text-blood line-through mr-2">{it.name}</span>
                          {it.destroyReason && <span className="text-parchment-200/70 italic">— {it.destroyReason}</span>}
                        </li>
                      ))}
                    </ul>
                    <div className="text-[11px] text-parchment-200/50 mt-1">刷新选项可能给出不同的判定。</div>
                  </div>
                )}

                {backpack.length > 0 && (
                  <ItemSelector
                    items={backpack}
                    selectedIds={selectedItemIds}
                    onToggle={onToggleItem}
                    disabled={busy || needsDiscard > 0}
                  />
                )}

                {save.state.phase === 'choices' && (
                  <>
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-xs tracking-[0.3em] text-gold/70 font-serif uppercase">抉择</div>
                      {save.state.lastChoices && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={onConsumeRefresh}
                          disabled={refreshesLeft <= 0 || needsDiscard > 0}
                          title={refreshesLeft > 0 ? '重新生成当前选项与能力' : `尚无刷新机会（每 ${save.config.refreshChoiceEvery ?? 3} 回合 +1）`}
                        >
                          <Sparkles size={14} /> 刷新（{refreshesLeft}）
                        </Button>
                      )}
                    </div>
                    {save.state.lastChoices && (
                      <ChoicePanel
                        choices={save.state.lastChoices}
                        onPick={onPick}
                        onChangeChoices={onChangeCurrentChoices}
                        disabled={busy || needsDiscard > 0}
                      />
                    )}
                    {needsDiscard > 0 && (
                      <div className="mt-3 text-sm text-blood bg-blood/10 border border-blood/50 rounded px-3 py-2 font-serif">
                        能力超载，需舍弃 {needsDiscard} 项后才能继续。
                      </div>
                    )}
                  </>
                )}

                {save.state.phase === 'manual' && (
                  <>
                    <div className="text-xs tracking-[0.3em] text-gold/70 font-serif uppercase mb-3">
                      自由行动 · 第 {save.state.currentRound} 回合
                    </div>
                    <ManualInput
                      onSubmit={onManualSubmit}
                      disabled={busy || needsDiscard > 0}
                      placeholder={
                        save.state.authorNarrative?.stageJudge?.storyFocus.thisRound
                          ? `叙事导演本回合预期：${save.state.authorNarrative.stageJudge.storyFocus.thisRound.slice(0, 40)}…\n（你可以无视此预期，自由描述想做的事）`
                          : undefined
                      }
                    />
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 侧栏 5 tab */}
        <aside className="hidden md:block">
          <div className="sticky top-20 h-[calc(100vh-92px)]">
            <SidebarTabs
              tabs={[
                {
                  id: 'character',
                  label: '角色',
                  icon: <UserRound size={14} />,
                  available: true,
                  badge: (save.state.npcs?.length ?? 0) || undefined,
                  content: (
                    <>
                      <CharacterPanel
                        characterName={save.content.characterName}
                        outline={outline}
                        background={background}
                        summary={save.state.summary}
                        longTermMemory={save.state.longTermMemory}
                        activeWorldBookCount={activeEntriesCount}
                        triggeredEventsCount={save.state.triggeredEvents.length}
                        refreshesLeft={refreshesLeft}
                        itemCount={backpack.length}
                      />
                      <NpcList npcs={save.state.npcs ?? []} onOpenAll={() => setNpcOpen(true)} />
                    </>
                  ),
                },
                {
                  id: 'narrative',
                  label: '叙事',
                  icon: <ScrollText size={14} />,
                  available: save.content.mode === 'author',
                  content: (
                    <>
                      <MasterArcPanel
                        saveId={save.id}
                        narrative={save.state.authorNarrative}
                        onRegenerate={busy ? undefined : regenerateMasterArc}
                        regenerating={regeneratingMasterArc}
                      />
                      <AuthorArcPanel
                        narrative={save.state.authorNarrative}
                        randomEventState={save.state.authorRandomEventState}
                      />
                    </>
                  ),
                },
                {
                  id: 'guard',
                  label: '守护',
                  icon: <ShieldCheck size={14} />,
                  available: save.content.mode === 'author',
                  content: (
                    <SettingGuardPanel saveId={save.id} narrative={save.state.authorNarrative} />
                  ),
                },
                {
                  id: 'world',
                  label: '世界',
                  icon: <Compass size={14} />,
                  available: true,
                  content: (
                    <>
                      <SceneMap
                        current={save.state.currentScene}
                        available={save.state.availableScenes ?? []}
                        history={save.state.sceneHistory ?? []}
                        onTravel={onTravel}
                        disabled={busy || needsDiscard > 0 || save.state.phase === 'ended'}
                      />
                      <AnchorsList
                        anchors={save.state.anchors ?? []}
                        onRemove={(anchorId) => useGameStore.getState().removeAnchor(save.id, anchorId)}
                        onUpdateNote={(anchorId, note) => useGameStore.getState().updateAnchorNote(save.id, anchorId, note)}
                      />
                    </>
                  ),
                },
                {
                  id: 'thoughts',
                  label: '记录',
                  icon: <Brain size={14} />,
                  available: true,
                  badge: save.state.agentThoughts?.length || undefined,
                  content: <AgentThoughtsPanel thoughts={save.state.agentThoughts} storageStats={storageStats} />,
                },
              ]}
            />
          </div>
        </aside>
      </div>

      <BackpackDialog
        open={backpackOpen}
        onClose={() => setBackpackOpen(false)}
        backpack={backpack}
        capacity={itemCapacity}
      />

      <NpcDialog
        open={npcOpen}
        onClose={() => setNpcOpen(false)}
        npcs={save.state.npcs ?? []}
      />

      <DiscardDialog
        open={needsDiscard > 0}
        backpack={backpack}
        capacity={itemCapacity}
        onConfirm={(ids) => useGameStore.getState().discardItems(save.id, ids)}
      />
    </div>
  );
}
