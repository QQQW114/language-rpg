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
import { requestAuthorLogicCheck } from '@/services/authorLogicCheckAgent';
import { matchWorldBook } from '@/services/worldBookMatcher';
import { pickRandomEvent } from '@/services/randomEventScheduler';
import { maybeCompress } from '@/services/contextCompressor';
import type { AuthorRandomEventConfig, Choice, GameSave, Item, Message, SceneRef, StoryArc } from '@/types/game';
import type { GameContent } from '@/types/game';
import type { StrictCustomConfig } from '@/types/custom';
import { buildJourneyPackage } from '@/lib/journeyPackage';
import { AuthorArcPanel } from '@/components/AuthorArcPanel';

const RECENT_TEXT_WINDOW = 2400;

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
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | undefined>();
  const [exportMsg, setExportMsg] = useState<string | undefined>();
  const [backpackOpen, setBackpackOpen] = useState(false);
  const [npcOpen, setNpcOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);

  const outline = useMemo(() => outlines.find((o) => o.id === save?.content.outlineId), [outlines, save?.content.outlineId]);
  const background = useMemo(() => backgrounds.find((b) => b.id === save?.content.backgroundId), [backgrounds, save?.content.backgroundId]);
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
    const { choices, grants, destroys, itemPatches, npcs, currentScene, availableScenes } = await requestChoices({
      settings,
      latestStory,
      backpack: current.state.backpack ?? [],
      npcs: current.state.npcs ?? [],
      summary: current.state.summary,
      recent: current.state.history.slice(-8),
      currentSceneName: current.state.currentScene?.name,
      currentScene: current.state.currentScene,
      strictCustom: getPromptConfig(current.content),
      includeChoices,
      signal,
    });

    const afterDecision = useGameStore.getState().saves[sourceSave.id] ?? current;
    const grantKey = `round-${afterDecision.state.currentRound}`;
    actions.applyDecisionResult(sourceSave.id, grantKey, grants, destroys, itemPatches, afterDecision.state.currentRound);
    if (npcs?.length) actions.applyNpcUpdates(sourceSave.id, npcs, afterDecision.state.currentRound);
    if (includeChoices || currentScene || availableScenes.length) {
      actions.setScenes(sourceSave.id, currentScene, availableScenes);
    }
    if (includeChoices) actions.setChoices(sourceSave.id, choices);

    const completedRound = afterDecision.state.currentRound;
    const memoryEvery = Math.max(0, Math.floor(settings.memoryEveryRounds ?? 0));
    const latestForMemory = useGameStore.getState().saves[sourceSave.id];
    if (
      latestForMemory &&
      memoryEvery > 0 &&
      completedRound > 0 &&
      completedRound % memoryEvery === 0 &&
      completedRound > (latestForMemory.state.lastMemoryRound ?? 0)
    ) {
      const memory = await requestMemoryUpdate({
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
        maxChars: settings.memoryMaxChars ?? 4000,
        signal,
      });
      if (memory) {
        actions.setLongTermMemory(sourceSave.id, memory, completedRound);
      }
    }
  }, [settings]);

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

    const result = await requestAuthorRandomEvent({
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
      signal,
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
      });
      addEventToLibrary(storyArcToRandomEvent(arc));
    } else {
      actions.setAuthorRandomEventState(saveId, {
        ...eventState,
        currentProbability: missProbability,
        lastCheckedRound: nextRound,
        lastError: result.reason,
      });
    }
  }, [settings, outline, background, allEvents, addEventToLibrary]);

  const maybeUpdateAuthorDirectorPlan = useCallback(async (
    saveId: string,
    latestStory: string,
    signal?: AbortSignal,
    force = false,
  ) => {
    const actions = useGameStore.getState();
    const current = actions.saves[saveId];
    if (!current || current.content.mode !== 'author') return;

    const config = current.content.authorDirector;
    if (!config?.enabled) return;

    const nextRound = current.state.currentRound;
    const completedRound = Math.max(0, nextRound - 1);
    const narrative = current.state.authorNarrative ?? { activeArcs: [], completedArcs: [] };
    const plan = narrative.plan;
    const covered = !!plan?.nextFewRoundsPlan?.some((item) =>
      nextRound >= item.startRound && nextRound <= item.endRound,
    );
    const stageExpired = plan?.stageTargetEndRound !== undefined && nextRound > plan.stageTargetEndRound;
    const lastDirectorRound = narrative.lastDirectorRound ?? -9999;
    const every = Math.max(1, config.everyRounds ?? 2);
    const due = force || !plan || !covered || stageExpired || completedRound - lastDirectorRound >= every;
    if (!due) return;

    const nextPlan = await requestAuthorDirectorPlan({
      settings,
      outline,
      background,
      characterName: current.content.characterName,
      currentRound: completedRound,
      nextRound,
      totalRounds: current.config.totalRounds,
      config,
      strictCustom: getPromptConfig(current.content),
      summary: current.state.summary,
      longTermMemory: current.state.longTermMemory,
      recent: current.state.history.slice(-10),
      latestStory,
      npcs: current.state.npcs ?? [],
      currentScene: current.state.currentScene,
      narrative,
      randomEventState: current.state.authorRandomEventState,
      signal,
    });

    if (!nextPlan) return;
    const latest = useGameStore.getState().saves[saveId] ?? current;
    actions.setAuthorNarrativeState(saveId, {
      ...(latest.state.authorNarrative ?? narrative),
      plan: nextPlan,
      activeArcs: latest.state.authorNarrative?.activeArcs ?? narrative.activeArcs,
      completedArcs: latest.state.authorNarrative?.completedArcs ?? narrative.completedArcs,
      lastDirectorRound: completedRound,
    });
  }, [settings, outline, background]);

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

    const review = await requestAuthorLogicCheck({
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
      signal,
    });

    if (!review) return;
    const latest = useGameStore.getState().saves[saveId] ?? current;
    actions.setAuthorNarrativeState(saveId, {
      ...(latest.state.authorNarrative ?? narrative),
      logicReview: review,
      activeArcs: latest.state.authorNarrative?.activeArcs ?? narrative.activeArcs,
      completedArcs: latest.state.authorNarrative?.completedArcs ?? narrative.completedArcs,
      lastLogicCheckRound: completedRound,
    });
  }, [settings, outline, background]);

  // ----- 异步任务：故事 -----
  const runStory = useCallback(async () => {
    const initial = getSave();
    if (!initial) return;
    const actions = useGameStore.getState();
    if (initial.content.mode === 'author') {
      actions.advanceAuthorArcs(initial.id, initial.state.currentRound);
    }
    const s = useGameStore.getState().saves[initial.id] ?? initial;
    const { state, config, content } = s;
    const pendingAuthorArc = getPendingAuthorArcForCurrentRound(s);

    setBusy(true);
    setErrorMsg(undefined);
    setStreaming('');

    const abort = new AbortController();
    abortRef.current = abort;

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

    try {
      const full = await requestStory({
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
        onDelta: (t) => setStreaming((prev) => prev + t),
        signal: abort.signal,
      });

      if (!full.trim()) throw new Error('模型未返回任何内容');

      const nextRound = state.currentRound;
      actions.appendMessage(s.id, { role: 'assistant', content: full, round: nextRound });
      actions.incrementRound(s.id);
      actions.setLastPlayerInput(s.id, undefined);
      actions.updateStateOf(s.id, { regenerationHint: undefined });
      setStreaming('');

      // 固化本回合获得的道具 → 消耗已勾选的一次性物品 → 清空本轮选择
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
          try {
            await applyDecisionForStory(s, full, false, abort.signal);
            await maybePrepareAuthorRandomEvent(s.id, full, abort.signal);
            await maybeUpdateAuthorDirectorPlan(s.id, full, abort.signal);
            await maybeUpdateAuthorLogicReview(s.id, full, abort.signal);
          } catch (err: any) {
            if (err?.name === 'AbortError') throw err;
            const msg = err?.message ?? String(err);
            console.warn('[decisionAgent/authorRandomEvent] tracking update failed', err);
            setErrorMsg(msg);
          }
          actions.setPhase(s.id, 'manual');
        } else {
          actions.setChoices(s.id, undefined);
          actions.setPhase(s.id, 'choices');
        }
        maybeCompress({
          settings,
          history: [...state.history, { role: 'assistant', content: full, round: nextRound }],
          summary: state.summary,
          summarizedUntilIndex: state.summarizedUntilIndex ?? 0,
          maxMessages: settings.maxHistoryRounds,
          keepTail: 12,
        })
          .then((res) => {
            if (res) actions.updateStateOf(s.id, {
              summary: res.newSummary,
              summarizedUntilIndex: res.newSummarizedUntilIndex,
            });
          })
          .catch(() => {});
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setStreaming('');
        return;
      }
      const msg = err?.message ?? String(err);
      setErrorMsg(msg);
      actions.setError(s.id, msg);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [getSave, settings, outline, background, worldBooks, allEvents, applyDecisionForStory, maybePrepareAuthorRandomEvent, maybeUpdateAuthorDirectorPlan, maybeUpdateAuthorLogicReview]);

  // ----- 异步任务：选项 + 给予/销毁道具 -----
  const runChoices = useCallback(async () => {
    const s = getSave();
    if (!s) return;
    const lastAssistant = [...s.state.history].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistant) return;

    setBusy(true);
    setErrorMsg(undefined);
    try {
      await applyDecisionForStory(s, lastAssistant.content, true);
      await maybePrepareAuthorRandomEvent(s.id, lastAssistant.content);
      await maybeUpdateAuthorDirectorPlan(s.id, lastAssistant.content);
      await maybeUpdateAuthorLogicReview(s.id, lastAssistant.content);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      setErrorMsg(msg);
    } finally {
      setBusy(false);
    }
  }, [getSave, applyDecisionForStory, maybePrepareAuthorRandomEvent, maybeUpdateAuthorDirectorPlan, maybeUpdateAuthorLogicReview]);

  // ----- 异步任务：评分 -----
  const runReview = useCallback(async () => {
    const s = getSave();
    if (!s) return;
    const actions = useGameStore.getState();
    setReviewing(true);
    setErrorMsg(undefined);
    try {
      const review = await requestReview({ settings, save: s, outline, background });
      actions.setReview(s.id, review);
    } catch (err: any) {
      setErrorMsg(err?.message ?? String(err));
    } finally {
      setReviewing(false);
    }
  }, [getSave, settings, outline, background]);

  // ----- 调度器 -----
  const dispatch = useCallback(() => {
    if (busyRef.current) return;
    const s = getSave();
    if (!s) return;
    const { phase, lastChoices, review } = s.state;

    if (phase === 'ended') {
      if (!review && !reviewing) {
        busyRef.current = true;
        runReview().finally(() => {
          busyRef.current = false;
        });
      }
      return;
    }

    if (phase === 'story') {
      busyRef.current = true;
      runStory().finally(() => {
        busyRef.current = false;
        dispatch();
      });
    } else if (phase === 'choices' && !lastChoices) {
      busyRef.current = true;
      runChoices().finally(() => {
        busyRef.current = false;
        dispatch();
      });
    }
  }, [getSave, runStory, runChoices, runReview, reviewing]);

  useEffect(() => {
    dispatch();
  }, [dispatch, save?.state.phase, save?.state.currentRound, save?.state.lastChoices, save?.state.review]);

  // ----- 交互 -----
  function onPick(choice: Choice) {
    if (!save) return;
    const actions = useGameStore.getState();
    actions.appendMessage(save.id, { role: 'user', content: choice.label, round: save.state.currentRound });
    actions.setLastPlayerInput(save.id, choice.label);
    actions.setChoices(save.id, undefined);
    actions.setPhase(save.id, 'story');
  }

  function onManualSubmit(text: string) {
    if (!save) return;
    const actions = useGameStore.getState();
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

  function canModifyMessage(_historyIndex: number, _msg: Message) {
    return (
      !!save &&
      !busy &&
      !streaming &&
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
      save.state.phase !== 'story'
    );
  }

  function onEditMessage(historyIndex: number, msg: Message, content: string) {
    if (!save || !canModifyMessage(historyIndex, msg)) return;
    useGameStore.getState().updateMessage(save.id, historyIndex, content);
  }

  function onDeleteMessage(historyIndex: number, msg: Message) {
    if (!save || !canModifyMessage(historyIndex, msg)) return;
    useGameStore.getState().deleteMessage(save.id, historyIndex);
  }

  function onEditAssistant(historyIndex: number, msg: Message, content: string) {
    if (!save || !canModifyAssistant(historyIndex, msg)) return;
    useGameStore.getState().updateAssistantMessage(save.id, historyIndex, content);
  }

  function onRegenerateAssistant(historyIndex: number, msg: Message) {
    if (!save || !canModifyAssistant(historyIndex, msg)) return;
    setStreaming('');
    setErrorMsg(undefined);
    busyRef.current = false;
    useGameStore.getState().regenerateAssistantMessage(save.id, historyIndex);
  }

  function onRegenerateAssistantWithHint(historyIndex: number, msg: Message, hint: string) {
    if (!save || !canModifyAssistant(historyIndex, msg)) return;
    setStreaming('');
    setErrorMsg(undefined);
    busyRef.current = false;
    useGameStore.getState().regenerateAssistantMessage(save.id, historyIndex, hint);
  }

  async function onExportChatRecord() {
    if (!save) return;
    setExportMsg(undefined);
    setErrorMsg(undefined);
    try {
      const fileName = `${safeFileName(save.name)}-聊天记录.md`;
      const result = await saveTextFile(formatChatRecord(save), fileName);
      if (result === 'cancelled') return;
      setExportMsg(result === 'saved' ? '聊天记录已写入文件。' : '聊天记录已导出；文件名固定，便于覆盖旧文件。');
      window.setTimeout(() => setExportMsg(undefined), 2200);
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
    setExportMsg(undefined);
    setErrorMsg(undefined);
    try {
      const fileName = `${safeFileName(save.name)}-旅程包.json`;
      const pkg = buildJourneyPackage({
        save,
        settings,
        outlines,
        backgrounds,
        worldBooks,
        events: allEvents,
      });
      const result = await saveTextFile(
        JSON.stringify(pkg, null, 2),
        fileName,
        'application/json;charset=utf-8',
        [
          {
            description: '言灵旅程包 JSON',
            accept: { 'application/json': ['.json'], 'text/plain': ['.json'] },
          },
        ],
      );
      if (result === 'cancelled') return;
      setExportMsg(result === 'saved' ? '旅程包已写入文件。' : '旅程包已导出。');
      window.setTimeout(() => setExportMsg(undefined), 2200);
    } catch (err: any) {
      setErrorMsg(err?.message ?? String(err));
    }
  }

  function onTravel(scene: SceneRef) {
    if (!save || busy || (save.state.needsDiscard ?? 0) > 0) return;
    const actions = useGameStore.getState();
    const label = `（我前往${scene.name}）`;
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
      {/* Top Bar */}
      <div className="sticky top-0 z-20 bg-parchment-800/80 backdrop-blur-md border-b border-parchment-600/40 px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" onClick={() => nav('/')}>
          <Home size={16} />
        </Button>
        <div className="flex-1 max-w-2xl">
          <RoundProgress current={save.state.currentRound} total={save.config.totalRounds} />
        </div>
        <div className="text-sm text-parchment-200/80 font-serif hidden md:block truncate max-w-[180px]">
          {save.name}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onExportChatRecord}
          title="导出当前聊天记录（默认使用固定文件名，方便覆盖旧文件）"
        >
          <Download size={16} />
          <span className="hidden sm:inline">聊天</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onExportJourneyPackage}
          title="导出可分享/可导入的完整旅程包（不包含 API Key）"
        >
          <Download size={16} />
          <span className="hidden sm:inline">旅程包</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setBackpackOpen(true)}
          title="查看背包"
        >
          <Package size={16} />
          <span className="hidden sm:inline">背包</span>
          <span className="text-xs text-parchment-200/70">{backpack.length}</span>
        </Button>
        {(!save.config.totalRounds || save.config.totalRounds <= 0) && save.state.phase !== 'ended' && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (save.state.finalizeRequested) {
                if (confirm('取消完结请求？下一回合将继续推进而不收束。')) {
                  useGameStore.getState().clearFinalize(save.id);
                }
              } else {
                if (confirm('确定要完结这段旅程吗？\n\n下一回合故事模型将为整段旅程书写结局，之后进入评分阶段。')) {
                  useGameStore.getState().requestFinalize(save.id);
                }
              }
            }}
            title={save.state.finalizeRequested ? '已请求完结 · 点击取消' : '下一回合收束并出结局'}
          >
            <Flag size={16} className={save.state.finalizeRequested ? 'text-gold-light' : undefined} />
            <span className="hidden sm:inline">{save.state.finalizeRequested ? '待完结' : '完结旅程'}</span>
          </Button>
        )}
        <Button variant="ghost" onClick={() => nav('/settings')}>
          <Settings size={16} />
        </Button>
      </div>

      <div className="flex-1 max-w-7xl w-full mx-auto px-4 py-6 grid gap-6 md:grid-cols-[1fr_280px] lg:grid-cols-[1fr_320px]">
        {/* Main column */}
        <div className="min-w-0">
          <StoryView
            history={save.state.history}
            streaming={streaming}
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
                <Button onClick={() => nav('/')}>返回主页</Button>
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

          {exportMsg && (
            <div className="mt-6 text-sm text-gold-light bg-gold/10 border border-gold/40 rounded px-4 py-3 font-serif animate-fade-in">
              {exportMsg}
            </div>
          )}

          {/* Bottom action area */}
          <div className="mt-8 sticky bottom-0 bg-gradient-to-t from-ink via-ink/95 to-transparent pt-4 pb-4 -mx-4 px-4">
            {busy && save.state.phase === 'story' && (
              <div className="flex items-center justify-between text-sm text-parchment-200/70 font-serif mb-2">
                <span className="animate-pulse-soft">· 故事之笔正在书写 ·</span>
                <Button size="sm" variant="outline" onClick={onStop}>
                  <StopCircle size={14} /> 中止
                </Button>
              </div>
            )}

            {interactive && doomedItems.length > 0 && (
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

            {interactive && backpack.length > 0 && (
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
                  <div className="text-xs tracking-[0.3em] text-gold/70 font-serif uppercase">
                    {busy ? '命运之轮旋转中…' : '抉择'}
                  </div>
                  {!busy && save.state.lastChoices && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={onConsumeRefresh}
                      disabled={refreshesLeft <= 0 || needsDiscard > 0}
                      title={refreshesLeft > 0 ? '重新生成当前选项与道具' : `尚无刷新机会（每 ${save.config.refreshChoiceEvery ?? 3} 回合 +1）`}
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
                {!save.state.lastChoices && busy && (
                  <div className="text-sm text-parchment-200/60 italic">（正在生成选项…）</div>
                )}
                {needsDiscard > 0 && (
                  <div className="mt-3 text-sm text-blood bg-blood/10 border border-blood/50 rounded px-3 py-2 font-serif">
                    背包超载，需丢弃 {needsDiscard} 件后才能继续。
                  </div>
                )}
              </>
            )}

            {save.state.phase === 'manual' && (
              <>
                <div className="text-xs tracking-[0.3em] text-gold/70 font-serif uppercase mb-3">
                  自由行动 · 第 {save.state.currentRound} 回合
                </div>
                <ManualInput onSubmit={onManualSubmit} disabled={busy || needsDiscard > 0} />
              </>
            )}
          </div>
        </div>

        {/* Side panel */}
        <aside className="hidden md:block">
          <div className="sticky top-[76px] max-h-[calc(100vh-92px)] overflow-y-auto pr-1 flex flex-col gap-4">
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
            {save.content.mode === 'author' && (
              <AuthorArcPanel
                narrative={save.state.authorNarrative}
                randomEventState={save.state.authorRandomEventState}
              />
            )}
            <SceneMap
              current={save.state.currentScene}
              available={save.state.availableScenes ?? []}
              history={save.state.sceneHistory ?? []}
              onTravel={onTravel}
              disabled={busy || needsDiscard > 0 || save.state.phase === 'ended'}
            />
            <NpcList npcs={save.state.npcs ?? []} onOpenAll={() => setNpcOpen(true)} />
            <AnchorsList
              anchors={save.state.anchors ?? []}
              onRemove={(anchorId) => useGameStore.getState().removeAnchor(save.id, anchorId)}
              onUpdateNote={(anchorId, note) => useGameStore.getState().updateAnchorNote(save.id, anchorId, note)}
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
