import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  Dices,
  Pencil,
  Plus,
  Save,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { useContentStore, selectAllOutlines, selectAllBackgrounds, selectAllWorldBooks, selectAllEvents, flattenWorldBookEntries } from '@/store/useContentStore';
import { useGameStore } from '@/store/useGameStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { Card, CardMeta, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { OrnateDivider } from '@/components/ui/Ornaments';
import { itemsFromStartStrings } from '@/lib/items';
import { requestRandomOutline, requestRandomBackground, requestRandomScene, requestRandomEvents, requestRandomWorldBook } from '@/services/randomizers';
import { StrictCustomEditor } from '@/components/StrictCustomEditor';
import { useStrictCustomStore } from '@/store/useStrictCustomStore';
import { useAuthorModeStore } from '@/store/useAuthorModeStore';
import { normalizeStrictCustomConfig } from '@/lib/strictCustom';
import { DEFAULT_AUTHOR_DIRECTOR_CONFIG, DEFAULT_AUTHOR_LOGIC_CHECK_CONFIG, DEFAULT_AUTHOR_RANDOM_EVENT_CONFIG, normalizeAuthorDirectorConfig, normalizeAuthorLogicCheckConfig, normalizeAuthorRandomEventConfig } from '@/lib/authorMode';
import type { RandomEvent } from '@/types/content';
import type { AuthorDirectorConfig, AuthorLogicCheckConfig, AuthorRandomEventConfig, JourneyMode } from '@/types/game';
import { PRESET_EVENTS } from '@/presets/events';

type Step = 'outline' | 'background' | 'config' | 'strict';

export default function SetupPage() {
  const nav = useNavigate();
  const settings = useSettingsStore((s) => s.settings);

  const outlines = useContentStore(selectAllOutlines);
  const backgrounds = useContentStore(selectAllBackgrounds);
  const worldBooks = useContentStore(selectAllWorldBooks);
  const events = useContentStore(selectAllEvents);

  const createSave = useGameStore((s) => s.createSave);
  const strictCustomDraft = useStrictCustomStore((s) => s.config);
  const authorMode = useAuthorModeStore();
  const authorDraft = authorMode.config;

  const [journeyMode, setJourneyMode] = useState<JourneyMode>('adventure');
  const [step, setStep] = useState<Step>('outline');
  const [outlineId, setOutlineId] = useState<string>();
  const [backgroundId, setBackgroundId] = useState<string>();
  const [characterName, setCharacterName] = useState('');
  const [totalRounds, setTotalRounds] = useState(30);
  const [infiniteMode, setInfiniteMode] = useState(false);
  const [manualInputEvery, setManualInputEvery] = useState(5);
  const [refreshChoiceEvery, setRefreshChoiceEvery] = useState(3);
  const [itemCapacity, setItemCapacity] = useState(8);
  const [worldBookIds, setWorldBookIds] = useState<string[]>([]);
  const [eventIds, setEventIds] = useState<string[]>([]);
  const [authorRandomEvent, setAuthorRandomEvent] = useState<AuthorRandomEventConfig>(() =>
    normalizeAuthorRandomEventConfig(DEFAULT_AUTHOR_RANDOM_EVENT_CONFIG),
  );
  const [authorDirector, setAuthorDirector] = useState<AuthorDirectorConfig>(() =>
    normalizeAuthorDirectorConfig(DEFAULT_AUTHOR_DIRECTOR_CONFIG),
  );
  const [authorLogicCheck, setAuthorLogicCheck] = useState<AuthorLogicCheckConfig>(() =>
    normalizeAuthorLogicCheckConfig(DEFAULT_AUTHOR_LOGIC_CHECK_CONFIG),
  );
  const [customStartScene, setCustomStartScene] = useState<string | undefined>();
  const [genBusy, setGenBusy] = useState<'outline' | 'background' | 'scene' | 'events' | 'worldbook' | null>(null);
  const [genError, setGenError] = useState<string | undefined>();
  const [outlineHint, setOutlineHint] = useState('');
  const [backgroundHint, setBackgroundHint] = useState('');
  const [sceneHint, setSceneHint] = useState('');
  const [eventsHint, setEventsHint] = useState('');
  const [worldBookHint, setWorldBookHint] = useState('');
  const [hiddenEventIds, setHiddenEventIds] = useState<string[]>([]);
  const [editingEvent, setEditingEvent] = useState<RandomEvent | null>(null);
  const [showAdventureEventLibrary, setShowAdventureEventLibrary] = useState(false);
  const [showAuthorPoolLibrary, setShowAuthorPoolLibrary] = useState(false);
  const [showAuthorReferenceLibrary, setShowAuthorReferenceLibrary] = useState(false);

  const addOutline = useContentStore((s) => s.addOutline);
  const addBackground = useContentStore((s) => s.addBackground);
  const addEvent = useContentStore((s) => s.addEvent);
  const addWorldBook = useContentStore((s) => s.addWorldBook);
  const updateEvent = useContentStore((s) => s.updateEvent);
  const removeEvent = useContentStore((s) => s.removeEvent);

  const selectedOutline = useMemo(
    () => outlines.find((o) => o.id === outlineId),
    [outlines, outlineId],
  );
  const selectedBackground = useMemo(
    () => backgrounds.find((b) => b.id === backgroundId),
    [backgrounds, backgroundId],
  );
  const visibleEvents = useMemo(
    () => events.filter((e) => !hiddenEventIds.includes(e.id)),
    [events, hiddenEventIds],
  );
  const strictDetailCount = strictCustomDraft.detailedOutline.filter((item) => item.prompt.trim()).length;
  const authorDetailCount = authorDraft.detailedOutline.filter((item) => item.prompt.trim()).length;

  // 选中 outline 时默认挂载其关联的世界书
  useEffect(() => {
    if (selectedOutline?.worldBookIds?.length) {
      setWorldBookIds(selectedOutline.worldBookIds);
    }
  }, [selectedOutline]);

  // 切换 background 时，清空之前的随机开局覆盖
  useEffect(() => {
    setCustomStartScene(undefined);
  }, [backgroundId]);

  // ---- 随机生成 ----
  const ensureApi = (): boolean => {
    if (!settings.apiKey) {
      if (confirm('尚未配置 API Key，随机生成需要调用模型。是否前往设置？')) nav('/settings');
      return false;
    }
    return true;
  };

  async function genRandomOutline() {
    if (!ensureApi()) return;
    setGenError(undefined);
    setGenBusy('outline');
    try {
      const avoid = outlines.map((o) => o.title).slice(0, 20);
      const out = await requestRandomOutline(settings, {
        avoidTitles: avoid,
        theme: outlineHint.trim() || undefined,
      });
      addOutline(out);
      setOutlineId(out.id);
    } catch (err: any) {
      setGenError(err?.message ?? String(err));
    } finally {
      setGenBusy(null);
    }
  }

  async function genRandomBackground() {
    if (!ensureApi() || !selectedOutline) return;
    setGenError(undefined);
    setGenBusy('background');
    try {
      const entries = flattenWorldBookEntries(worldBooks, worldBookIds);
      const bg = await requestRandomBackground(settings, selectedOutline, entries, backgroundHint.trim() || undefined);
      addBackground(bg);
      setBackgroundId(bg.id);
      setCustomStartScene(undefined);
    } catch (err: any) {
      setGenError(err?.message ?? String(err));
    } finally {
      setGenBusy(null);
    }
  }

  async function genRandomScene() {
    if (!ensureApi() || !selectedOutline || !selectedBackground) return;
    setGenError(undefined);
    setGenBusy('scene');
    try {
      const scene = await requestRandomScene(settings, selectedOutline, selectedBackground, sceneHint.trim() || undefined);
      setCustomStartScene(scene);
    } catch (err: any) {
      setGenError(err?.message ?? String(err));
    } finally {
      setGenBusy(null);
    }
  }

  async function genRandomEvents(target: 'adventure' | 'authorPool' | 'authorReference' = 'adventure') {
    if (!ensureApi() || !selectedOutline) return;
    setGenError(undefined);
    setGenBusy('events');
    try {
      const scene = customStartScene?.trim() || selectedBackground?.startScene;
      const evs = await requestRandomEvents(
        settings,
        selectedOutline,
        selectedBackground,
        scene,
        eventsHint.trim() || undefined,
        6,
      );
      for (const ev of evs) addEvent(ev);
      const ids = evs.map((e) => e.id);
      if (target === 'authorPool') {
        setAuthorRandomEvent((prev) =>
          normalizeAuthorRandomEventConfig({
            ...prev,
            mode: prev.mode === 'off' ? 'pool' : prev.mode,
            poolEventIds: Array.from(new Set([...prev.poolEventIds, ...ids])),
          }),
        );
      } else if (target === 'authorReference') {
        setAuthorRandomEvent((prev) =>
          normalizeAuthorRandomEventConfig({
            ...prev,
            dynamic: {
              ...prev.dynamic,
              referenceEventIds: Array.from(new Set([...prev.dynamic.referenceEventIds, ...ids])),
            },
          }),
        );
      } else {
        setEventIds((prev) => Array.from(new Set([...prev, ...ids])));
      }
    } catch (err: any) {
      setGenError(err?.message ?? String(err));
    } finally {
      setGenBusy(null);
    }
  }

  async function genRandomWorldBook() {
    if (!ensureApi()) return;
    setGenError(undefined);
    setGenBusy('worldbook');
    try {
      const wb = await requestRandomWorldBook(
        settings,
        selectedOutline,
        worldBookHint.trim() || undefined,
        7,
      );
      addWorldBook(wb);
      setWorldBookIds((prev) => Array.from(new Set([...prev, wb.id])));
    } catch (err: any) {
      setGenError(err?.message ?? String(err));
    } finally {
      setGenBusy(null);
    }
  }

  const canStart =
    outlineId && backgroundId && (infiniteMode || totalRounds >= 5) && manualInputEvery >= 1;

  const handleBack = () => {
    if (step === 'strict') setStep('config');
    else if (step === 'config') setStep('background');
    else if (step === 'background') setStep('outline');
    else nav('/');
  };

  const handleNext = () => {
    if (step === 'outline') {
      if (outlineId) setStep('background');
    } else if (step === 'background') {
      if (backgroundId) setStep('config');
    } else if (step === 'strict') {
      setStep('config');
    } else {
      start();
    }
  };

  const canGoNext =
    step === 'outline' ? !!outlineId
      : step === 'background' ? !!backgroundId
      : step === 'strict' ? true
      : !!canStart;

  const nextLabel =
    step === 'config' ? '启程'
      : step === 'strict' ? '返回启程设定'
      : '下一步';
  const backLabel = step === 'outline' ? '返回主页' : step === 'strict' ? '返回启程设定' : '上一步';

  const switchJourneyMode = (mode: JourneyMode) => {
    setJourneyMode(mode);
    if (mode === 'author') {
      setManualInputEvery(1);
    }
  };

  const toggle = (list: string[], id: string): string[] =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const updateAuthorRandomEvent = (patch: Partial<AuthorRandomEventConfig>) => {
    setAuthorRandomEvent((prev) => normalizeAuthorRandomEventConfig({ ...prev, ...patch }));
  };

  const updateAuthorDynamic = (patch: Partial<AuthorRandomEventConfig['dynamic']>) => {
    setAuthorRandomEvent((prev) =>
      normalizeAuthorRandomEventConfig({
        ...prev,
        dynamic: { ...prev.dynamic, ...patch },
      }),
    );
  };

  const updateAuthorDirector = (patch: Partial<AuthorDirectorConfig>) => {
    setAuthorDirector((prev) => normalizeAuthorDirectorConfig({ ...prev, ...patch }));
  };

  const updateAuthorLogicCheck = (patch: Partial<AuthorLogicCheckConfig>) => {
    setAuthorLogicCheck((prev) => normalizeAuthorLogicCheckConfig({ ...prev, ...patch }));
  };

  const toggleAuthorPoolEvent = (id: string) => {
    setAuthorRandomEvent((prev) =>
      normalizeAuthorRandomEventConfig({
        ...prev,
        poolEventIds: toggle(prev.poolEventIds, id),
      }),
    );
  };

  const toggleAuthorReferenceEvent = (id: string) => {
    setAuthorRandomEvent((prev) =>
      normalizeAuthorRandomEventConfig({
        ...prev,
        dynamic: {
          ...prev.dynamic,
          referenceEventIds: toggle(prev.dynamic.referenceEventIds, id),
        },
      }),
    );
  };

  const startEventEdit = (event: RandomEvent) => {
    setEditingEvent({ ...event });
  };

  const saveEventEdit = () => {
    if (!editingEvent) return;
    const normalized = normalizeSetupEvent(editingEvent);
    updateEvent(normalized);
    setHiddenEventIds((prev) => prev.filter((id) => id !== normalized.id));
    setEditingEvent(null);
  };

  const deleteEventFromSetup = (event: RandomEvent) => {
    const isGeneratedOrImported = !PRESET_EVENTS.some((item) => item.id === event.id);
    setEventIds((prev) => prev.filter((id) => id !== event.id));
    setAuthorRandomEvent((prev) =>
      normalizeAuthorRandomEventConfig({
        ...prev,
        poolEventIds: prev.poolEventIds.filter((id) => id !== event.id),
        dynamic: {
          ...prev.dynamic,
          referenceEventIds: prev.dynamic.referenceEventIds.filter((id) => id !== event.id),
        },
      }),
    );
    setHiddenEventIds((prev) => Array.from(new Set([...prev, event.id])));
    if (isGeneratedOrImported) removeEvent(event.id);
    if (editingEvent?.id === event.id) setEditingEvent(null);
  };

  const start = () => {
    if (!settings.apiKey) {
      if (!confirm('尚未配置 API Key，无法调用模型。是否先前往设置页面？')) return;
      nav('/settings');
      return;
    }
    if (!selectedOutline || !selectedBackground) return;
    const saveName = `${characterName || '旅人'} · ${selectedOutline.title}`;
    const strictCustom = normalizeStrictCustomConfig(strictCustomDraft);
    const authorCustom = normalizeStrictCustomConfig({ ...authorDraft, enabled: true });
    const isAuthorMode = journeyMode === 'author';
    const normalizedAuthorRandomEvent = normalizeAuthorRandomEventConfig(authorRandomEvent);
    const normalizedAuthorDirector = normalizeAuthorDirectorConfig(authorDirector);
    const normalizedAuthorLogicCheck = normalizeAuthorLogicCheckConfig(authorLogicCheck);
    const authorEventResourceIds = Array.from(new Set([
      ...normalizedAuthorRandomEvent.poolEventIds,
      ...normalizedAuthorRandomEvent.dynamic.referenceEventIds,
    ]));
    const saveId = createSave({
      name: saveName,
      config: {
        totalRounds: infiniteMode ? 0 : totalRounds,
        manualInputEvery: isAuthorMode ? 1 : manualInputEvery,
        refreshChoiceEvery,
        itemCapacity,
      },
      content: {
        outlineId,
        backgroundId,
        worldBookIds,
        eventIds: isAuthorMode ? authorEventResourceIds : eventIds,
        characterName: characterName.trim() || undefined,
        mode: journeyMode,
        strictCustom: strictCustom.enabled ? strictCustom : undefined,
        authorCustom: isAuthorMode ? authorCustom : undefined,
        authorRandomEvent: isAuthorMode ? normalizedAuthorRandomEvent : undefined,
        authorDirector: isAuthorMode ? normalizedAuthorDirector : undefined,
        authorLogicCheck: isAuthorMode ? normalizedAuthorLogicCheck : undefined,
        storyStyle: {
          storyLength: settings.storyLength,
          storyStyleAddendum: settings.storyStyleAddendum,
        },
      },
      initialScene: (customStartScene?.trim() || selectedBackground.startScene),
      initialItems: itemsFromStartStrings(selectedBackground.startItems, 0),
    });
    if (isAuthorMode) {
      useGameStore.getState().updateStateOf(saveId, {
        phase: 'manual',
        lastChoices: undefined,
      });
    }
    nav('/game');
  };

  return (
    <div className="min-h-full max-w-5xl mx-auto px-6 py-8 pb-24">
      <div className="flex items-center justify-between mb-6">
        <Button variant="ghost" onClick={handleBack}>
          <ArrowLeft size={16} /> {backLabel}
        </Button>
        <div className="flex gap-4 text-sm font-serif">
          <StepDot active={step === 'outline'} done={!!outlineId}>一 · 选择故事</StepDot>
          <StepDot active={step === 'background'} done={!!backgroundId}>二 · 选择出身</StepDot>
          <StepDot active={step === 'config' || step === 'strict'} done={!!canStart}>
            三 · {journeyMode === 'author' ? '执笔' : '启程'}
          </StepDot>
        </div>
        <div className="w-16" />
      </div>

      <ModeSwitch mode={journeyMode} onChange={switchJourneyMode} />

      {step === 'outline' && (
        <div>
          <div className="flex items-end justify-between mb-2 gap-4">
            <div>
              <h2 className="font-serif text-2xl text-gold-light">选择你的故事</h2>
              <div className="text-sm text-parchment-200/70">所有故事都会由模型重新演绎；你的每一次选择都可能把它引向新的方向。</div>
            </div>
            <Button
              variant="outline"
              onClick={genRandomOutline}
              loading={genBusy === 'outline'}
              disabled={genBusy !== null}
            >
              <Wand2 size={16} /> 随机生成新故事
            </Button>
          </div>
          <div className="mb-4">
            <textarea
              value={outlineHint}
              onChange={(e) => setOutlineHint(e.target.value)}
              placeholder={'（可选）生成偏好，可写得尽量详细。例如：\n- 题材：校园恋爱 / 末世温情 / 武侠 / 赛博朋克 / 悬疑\n- 核心冲突：一段注定错过的暗恋；或一场为了姐姐的复仇\n- 基调：偏治愈 / 偏苦涩 / 有喜剧元素\n- 主角约束：必须是女性，盲人，以第一次出远门为开场\n- 禁忌元素：不要超自然 / 不要战斗描写'}
              className="w-full bg-parchment-900/60 text-parchment-100 placeholder-parchment-200/40 border border-parchment-600/50 rounded-md px-3 py-2 font-serif text-sm focus:outline-none focus:border-gold/70 focus:shadow-glow-sm transition-all resize-y min-h-[80px] leading-relaxed"
              rows={3}
            />
          </div>
          {genError && genBusy !== 'outline' && step === 'outline' && (
            <div className="text-sm text-blood bg-blood/10 border border-blood/50 rounded px-3 py-2 mb-3">{genError}</div>
          )}
          <div className="grid gap-4 md:grid-cols-2 mt-4">
            {outlines.map((o) => (
              <Card
                key={o.id}
                interactive
                selected={outlineId === o.id}
                onClick={() => setOutlineId(o.id)}
              >
                <CardTitle>
                  {o.coverEmoji && <span className="mr-2">{o.coverEmoji}</span>}
                  {o.title}
                  {o.id.startsWith('gen_') && <span className="ml-2 text-[10px] text-gold/70 tracking-wider uppercase">· 随机 ·</span>}
                </CardTitle>
                {o.tone && <CardMeta>{o.tone}</CardMeta>}
                <div className="text-sm text-parchment-100/90 leading-relaxed">
                  {o.synopsis}
                </div>
                {o.acts?.length > 0 && (
                  <ul className="mt-3 text-xs text-parchment-200/70 space-y-1">
                    {o.acts.map((a, i) => (
                      <li key={i} className="pl-3 border-l border-gold-dark/60">{a}</li>
                    ))}
                  </ul>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}

      {step === 'background' && (
        <div>
          <div className="flex items-end justify-between mb-2 gap-4">
            <div>
              <h2 className="font-serif text-2xl text-gold-light">选择你的出身</h2>
              <div className="text-sm text-parchment-200/70">出身决定开局的场景、初始技能与物品。</div>
            </div>
            <Button
              variant="outline"
              onClick={genRandomBackground}
              loading={genBusy === 'background'}
              disabled={genBusy !== null || !selectedOutline}
              title={!selectedOutline ? '请先选一个故事' : '根据大纲随机生成一个出身'}
            >
              <Wand2 size={16} /> 随机出身
            </Button>
          </div>
          <div className="mb-4">
            <textarea
              value={backgroundHint}
              onChange={(e) => setBackgroundHint(e.target.value)}
              placeholder={'（可选）出身偏好，可写得具体。例如：\n- 类型：失忆少女 / 退役军人 / 隐退高手 / 孤儿 / 大家族私生子\n- 技能倾向：擅长医术，不擅长武力\n- 性格：内向、谨慎，有一点社恐\n- 负担/秘密：身上有一块不能让人发现的胎记；欠下不小的赌债'}
              className="w-full bg-parchment-900/60 text-parchment-100 placeholder-parchment-200/40 border border-parchment-600/50 rounded-md px-3 py-2 font-serif text-sm focus:outline-none focus:border-gold/70 focus:shadow-glow-sm transition-all resize-y min-h-[80px] leading-relaxed"
              rows={3}
            />
          </div>
          {genError && genBusy !== 'background' && step === 'background' && (
            <div className="text-sm text-blood bg-blood/10 border border-blood/50 rounded px-3 py-2 mb-3">{genError}</div>
          )}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mt-4">
            {backgrounds.map((b) => (
              <Card
                key={b.id}
                interactive
                selected={backgroundId === b.id}
                onClick={() => setBackgroundId(b.id)}
              >
                <CardTitle>
                  {b.coverEmoji && <span className="mr-2">{b.coverEmoji}</span>}
                  {b.name}
                  {b.id.startsWith('gen_') && <span className="ml-2 text-[10px] text-gold/70 tracking-wider uppercase">· 随机 ·</span>}
                </CardTitle>
                <div className="text-sm text-parchment-100/90 leading-relaxed mb-2">
                  {b.description}
                </div>
                <div className="flex flex-wrap gap-1">
                  {b.traits.map((t) => (
                    <span
                      key={t}
                      className="text-[11px] px-2 py-0.5 rounded border border-gold/40 text-parchment-100 bg-parchment-900/40"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {step === 'strict' && journeyMode === 'adventure' && (
        <StrictCustomEditor />
      )}

      {step === 'strict' && journeyMode === 'author' && (
        <StrictCustomEditor
          title="严格自定义模式"
          description="面向强自定义旅程的独立提示词链路。执笔模式默认每回合都由玩家自由输入；当前版本先复制原严格自定义链路，后续可在这里继续加入专属模型、伏笔、填坑与逻辑审校。"
          config={authorDraft}
          update={authorMode.update}
          reset={authorMode.reset}
          addDirective={authorMode.addDirective}
          updateDirective={authorMode.updateDirective}
          removeDirective={authorMode.removeDirective}
          showEnableToggle={false}
        />
      )}

      {step === 'config' && selectedOutline && selectedBackground && (
        <div className="grid gap-6 md:grid-cols-5">
          <div className="md:col-span-3">
            <h2 className="font-serif text-2xl text-gold-light mb-4">启程设定</h2>

            <Input
              label="角色姓名（可留空）"
              value={characterName}
              onChange={(e) => setCharacterName(e.target.value)}
              placeholder="为你的角色起一个名字"
              maxLength={20}
            />

            <div className={journeyMode === 'author' ? 'grid grid-cols-2 md:grid-cols-3 gap-4' : 'grid grid-cols-2 md:grid-cols-4 gap-4'}>
              <div>
                <span className="block text-sm text-gold-light mb-1 tracking-wide">总回合数</span>
                <input
                  type="number"
                  min={5}
                  max={200}
                  value={totalRounds}
                  onChange={(e) => setTotalRounds(Number(e.target.value) || 30)}
                  disabled={infiniteMode}
                  className="w-full bg-parchment-900/60 text-parchment-100 placeholder-parchment-200/40 border border-parchment-600/50 rounded-md px-3 py-2 font-serif focus:outline-none focus:border-gold/70 focus:shadow-glow-sm transition-all disabled:opacity-40"
                />
                <label className="mt-1 flex items-center gap-1.5 text-xs text-parchment-200/80 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={infiniteMode}
                    onChange={(e) => setInfiniteMode(e.target.checked)}
                    className="accent-gold"
                  />
                  <span className={infiniteMode ? 'text-gold-light font-semibold' : ''}>无尽模式 ∞</span>
                </label>
              </div>
              {journeyMode === 'adventure' && (
                <Input
                  label="手动输入频率"
                  type="number"
                  min={1}
                  max={50}
                  value={manualInputEvery}
                  onChange={(e) => setManualInputEvery(Number(e.target.value) || 5)}
                  hint="每 N 回合"
                />
              )}
              <Input
                label="刷新决策频率"
                type="number"
                min={1}
                max={50}
                value={refreshChoiceEvery}
                onChange={(e) => setRefreshChoiceEvery(Number(e.target.value) || 3)}
                hint="每 N 回合 +1 次"
              />
              <Input
                label="背包容量"
                type="number"
                min={3}
                max={30}
                value={itemCapacity}
                onChange={(e) => setItemCapacity(Number(e.target.value) || 8)}
                hint="超载需丢弃"
              />
            </div>

            {journeyMode === 'adventure' ? (
            <Card className={strictCustomDraft.enabled ? 'mt-4 border-gold/70 shadow-glow-sm' : 'mt-4'}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2 mb-1">
                    <SlidersHorizontal size={16} /> 严格自定义模式
                    {strictCustomDraft.enabled && (
                      <span className="text-[10px] text-gold/80 tracking-[0.25em] uppercase">已启用</span>
                    )}
                  </CardTitle>
                  <CardMeta>
                    用高优先级提示词控制隐藏设定揭示、回合推进粒度和指定回合详细大纲。
                  </CardMeta>
                  <div className="text-xs text-parchment-200/70">
                    详细大纲 {strictDetailCount} 项
                    {strictCustomDraft.enabled ? ' · 将随新旅程固化' : ' · 当前未启用'}
                  </div>
                </div>
                <Button variant="outline" onClick={() => setStep('strict')}>
                  编辑
                </Button>
              </div>
            </Card>
            ) : (
              <Card className="mt-4 border-gold/70 shadow-glow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="flex items-center gap-2 mb-1">
                      <SlidersHorizontal size={16} /> 严格自定义模式
                      <span className="text-[10px] text-gold/80 tracking-[0.25em] uppercase">每回合自由行动</span>
                    </CardTitle>
                    <CardMeta>
                      使用独立提示词链路与详细大纲草稿；当前版本先复制原严格自定义链路，后续可扩展专属模型。
                    </CardMeta>
                    <div className="text-xs text-parchment-200/70">
                      详细大纲 {authorDetailCount} 项 · 将随新旅程固化
                    </div>
                  </div>
                  <Button variant="outline" onClick={() => setStep('strict')}>
                    编辑
                  </Button>
                </div>
              </Card>
            )}

            <OrnateDivider>世界书</OrnateDivider>
            <div className="text-xs text-parchment-200/70 mb-2">
              激活的世界书条目会在命中关键词时注入给故事模型，补充背景设定。可按下方按钮让模型根据当前大纲生成一本专属世界书。
            </div>
            <div className="flex items-start gap-2 mb-2">
              <textarea
                value={worldBookHint}
                onChange={(e) => setWorldBookHint(e.target.value)}
                placeholder={'（可选）世界书偏好，可写得详细。例如：\n- 题材：低魔奇幻 / 蒸汽朋克 / 近代谍战 / 东方武侠\n- 必须包含：三大主要势力，一种独有货币，一个禁忌组织\n- 禁忌：不出现电子设备；不出现枪械；不出现神明'}
                className="flex-1 bg-parchment-900/60 text-parchment-100 placeholder-parchment-200/40 border border-parchment-600/40 rounded px-3 py-1.5 font-serif text-xs focus:outline-none focus:border-gold/60 resize-y min-h-[60px] leading-relaxed"
                rows={3}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={genRandomWorldBook}
                loading={genBusy === 'worldbook'}
                disabled={genBusy !== null}
              >
                <Wand2 size={14} /> 随机世界书
              </Button>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {worldBooks.map((w) => (
                <label
                  key={w.id}
                  className="flex items-start gap-2 bg-parchment-800/60 border border-parchment-600/40 rounded px-3 py-2 cursor-pointer hover:border-gold/60"
                >
                  <input
                    type="checkbox"
                    checked={worldBookIds.includes(w.id)}
                    onChange={() => setWorldBookIds(toggle(worldBookIds, w.id))}
                    className="mt-1 accent-gold"
                  />
                  <div>
                    <div className="text-parchment-100 text-sm">
                      {w.name}
                      {w.id.startsWith('gen_wb') && <span className="ml-2 text-[10px] text-gold/70 tracking-wider uppercase">· 随机 ·</span>}
                    </div>
                    <div className="text-xs text-parchment-200/60">
                      {w.entries.length} 条 · {w.description ?? '无简介'}
                    </div>
                  </div>
                </label>
              ))}
              {worldBooks.length === 0 && (
                <div className="text-sm text-parchment-200/60">尚无世界书，可前往书库导入或用上方按钮随机生成。</div>
              )}
            </div>

            {journeyMode === 'adventure' && (
              <>
                <OrnateDivider>随机事件</OrnateDivider>
                <div className="text-xs text-parchment-200/70 mb-2">
                  默认不启用书库事件；可先随机生成一批专属事件，或点击“从书库导入”后把旧事件加入本次旅程。
                </div>
                <div className="flex items-start gap-2 mb-2">
                  <textarea
                    value={eventsHint}
                    onChange={(e) => setEventsHint(e.target.value)}
                    placeholder={'（可选）事件偏好，可写得详细。例如：\n- 基调：偏日常温情 / 偏突发转折\n- 要求：必含一次误会、一次失而复得、一次雨夜、一次三人共处\n- 禁忌：不要流血暴力；不要生离死别'}
                    className="flex-1 bg-parchment-900/60 text-parchment-100 placeholder-parchment-200/40 border border-parchment-600/40 rounded px-3 py-1.5 font-serif text-xs focus:outline-none focus:border-gold/60 resize-y min-h-[60px] leading-relaxed"
                    rows={3}
                  />
                  <div className="flex flex-col gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => genRandomEvents('adventure')}
                      loading={genBusy === 'events'}
                      disabled={genBusy !== null}
                    >
                      <Wand2 size={14} /> 随机事件池
                    </Button>
                    <Button
                      size="sm"
                      variant={showAdventureEventLibrary ? 'primary' : 'outline'}
                      onClick={() => setShowAdventureEventLibrary((v) => !v)}
                    >
                      <BookOpen size={14} /> {showAdventureEventLibrary ? '收起书库' : '从书库导入'}
                    </Button>
                  </div>
                </div>
                <SetupEventList
                  events={visibleEvents}
                  selectedIds={eventIds}
                  showLibrary={showAdventureEventLibrary}
                  emptyText="尚未导入随机事件。你可以随机生成，或点“从书库导入”选择旧事件。"
                  onToggle={(id) => setEventIds(toggle(eventIds, id))}
                  editingEvent={editingEvent}
                  setEditingEvent={setEditingEvent}
                  onStartEdit={startEventEdit}
                  onSaveEdit={saveEventEdit}
                  onDelete={deleteEventFromSetup}
                />
              </>
            )}

            {journeyMode === 'author' && (
              <>
              <AuthorDirectorSection
                config={authorDirector}
                onChange={updateAuthorDirector}
              />
              <AuthorLogicCheckSection
                config={authorLogicCheck}
                onChange={updateAuthorLogicCheck}
              />
              <AuthorRandomEventSection
                config={authorRandomEvent}
                events={visibleEvents}
                eventsHint={eventsHint}
                setEventsHint={setEventsHint}
                genBusy={genBusy}
                onGeneratePool={() => genRandomEvents('authorPool')}
                onGenerateReference={() => genRandomEvents('authorReference')}
                onConfigChange={updateAuthorRandomEvent}
                onDynamicChange={updateAuthorDynamic}
                showPoolLibrary={showAuthorPoolLibrary}
                setShowPoolLibrary={setShowAuthorPoolLibrary}
                showReferenceLibrary={showAuthorReferenceLibrary}
                setShowReferenceLibrary={setShowAuthorReferenceLibrary}
                onTogglePool={toggleAuthorPoolEvent}
                onToggleReference={toggleAuthorReferenceEvent}
                editingEvent={editingEvent}
                setEditingEvent={setEditingEvent}
                onStartEdit={startEventEdit}
                onSaveEdit={saveEventEdit}
                onDelete={deleteEventFromSetup}
              />
              </>
            )}
          </div>

          <aside className="md:col-span-2">
            <div className="sticky top-6">
              <h3 className="font-serif text-xs tracking-[0.3em] text-gold-light uppercase mb-3">
                <Sparkles size={14} className="inline mr-1" /> 你的选择
              </h3>
              <Card>
                <div className="text-xs text-parchment-200/70">故事</div>
                <div className="font-serif text-parchment-50 text-lg mb-2">
                  {selectedOutline.coverEmoji} {selectedOutline.title}
                </div>
                <div className="text-xs text-parchment-200/70">出身</div>
                <div className="font-serif text-parchment-50 mb-2">
                  {selectedBackground.coverEmoji} {selectedBackground.name}
                </div>
                <div className="flex items-center justify-between mb-1">
                  <div className="text-xs text-parchment-200/70">
                    开局场景 {customStartScene && <span className="text-gold-light">· 已随机 ·</span>}
                  </div>
                  <button
                    type="button"
                    onClick={genRandomScene}
                    disabled={genBusy !== null}
                    className="text-xs text-gold-light hover:text-gold disabled:opacity-50 flex items-center gap-1"
                  >
                    <Wand2 size={12} /> {genBusy === 'scene' ? '生成中…' : '随机开局'}
                  </button>
                </div>
                <textarea
                  value={sceneHint}
                  onChange={(e) => setSceneHint(e.target.value)}
                  placeholder={'（可选）开局偏好，可写得具体。例如：\n- 地点：雨夜街角 / 客栈楼上的独立房间 / 葬礼刚结束的归途\n- 氛围：疲惫、潮湿、某种奇异的安宁\n- 必须出现：一个陌生的陶碗；一封没写完的信'}
                  className="w-full bg-parchment-900/60 text-parchment-100 placeholder-parchment-200/40 border border-parchment-600/40 rounded px-2 py-1 font-serif text-xs mb-2 focus:outline-none focus:border-gold/60 resize-y min-h-[52px] leading-relaxed"
                  rows={3}
                />
                <div className="text-xs text-parchment-200/90 italic leading-relaxed max-h-48 overflow-auto whitespace-pre-line">
                  {customStartScene ?? selectedBackground.startScene}
                </div>
                {customStartScene && (
                  <button
                    type="button"
                    onClick={() => setCustomStartScene(undefined)}
                    className="mt-2 text-[10px] text-parchment-200/60 hover:text-gold-light underline underline-offset-2"
                  >
                    恢复默认开局
                  </button>
                )}
              </Card>
              {genError && (
                <div className="mt-3 text-xs text-blood bg-blood/10 border border-blood/50 rounded px-3 py-2">{genError}</div>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* 粘底的步骤导航条 */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-parchment-800/85 backdrop-blur-md border-t border-parchment-600/50">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between gap-3">
          <Button variant="outline" onClick={handleBack}>
            <ArrowLeft size={16} /> {backLabel}
          </Button>
          <div className="text-xs text-parchment-200/60 font-serif hidden sm:block">
            {step === 'outline' && '一 · 选择故事'}
            {step === 'background' && '二 · 选择出身'}
            {step === 'config' && (journeyMode === 'author' ? '三 · 执笔启程' : '三 · 启程')}
            {step === 'strict' && '三 · 严格自定义'}
          </div>
          <Button
            size="lg"
            disabled={!canGoNext}
            onClick={handleNext}
          >
            {nextLabel} {step !== 'config' && <ChevronRight size={16} />}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ModeSwitch({ mode, onChange }: { mode: JourneyMode; onChange: (mode: JourneyMode) => void }) {
  const options: Array<{
    value: JourneyMode;
    title: string;
    desc: string;
  }> = [
    {
      value: 'adventure',
      title: '游历模式',
      desc: '保留当前随机性与选项制流程',
    },
    {
      value: 'author',
      title: '执笔模式',
      desc: '独立提示词链路 · 每回合自由行动',
    },
  ];

  return (
    <div className="mb-6 rounded-xl border border-parchment-600/40 bg-parchment-800/50 p-1.5">
      <div className="grid grid-cols-2 gap-1">
        {options.map((item) => {
          const active = mode === item.value;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => onChange(item.value)}
              className={`rounded-lg px-4 py-3 text-left transition-all ${
                active
                  ? 'border border-gold/70 bg-parchment-900/70 shadow-glow-sm'
                  : 'border border-transparent hover:border-gold/40 hover:bg-parchment-900/30'
              }`}
            >
              <div className={`font-serif text-sm ${active ? 'text-gold-light' : 'text-parchment-100'}`}>
                {item.title}
              </div>
              <div className="mt-0.5 text-xs text-parchment-200/60">
                {item.desc}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepDot({ active, done, children }: { active?: boolean; done?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`px-3 py-1 rounded-full border text-xs tracking-wider ${
        active
          ? 'border-gold text-gold-light shadow-glow-sm'
          : done
          ? 'border-gold/40 text-parchment-100/80'
          : 'border-parchment-600/40 text-parchment-200/60'
      }`}
    >
      {children}
    </span>
  );
}

function SetupEventList({
  events,
  selectedIds,
  showLibrary,
  emptyText,
  onToggle,
  editingEvent,
  setEditingEvent,
  onStartEdit,
  onSaveEdit,
  onDelete,
}: {
  events: RandomEvent[];
  selectedIds: string[];
  showLibrary: boolean;
  emptyText: string;
  onToggle: (id: string) => void;
  editingEvent: RandomEvent | null;
  setEditingEvent: (event: RandomEvent | null) => void;
  onStartEdit: (event: RandomEvent) => void;
  onSaveEdit: () => void;
  onDelete: (event: RandomEvent) => void;
}) {
  const list = showLibrary ? events : events.filter((e) => selectedIds.includes(e.id));
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {list.map((e) => {
        const selected = selectedIds.includes(e.id);
        const isEditing = editingEvent?.id === e.id;
        return (
          <div
            key={e.id}
            role={isEditing ? undefined : 'checkbox'}
            aria-checked={isEditing ? undefined : selected}
            tabIndex={isEditing ? undefined : 0}
            onClick={isEditing ? undefined : () => onToggle(e.id)}
            onKeyDown={isEditing ? undefined : (ev) => {
              if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                onToggle(e.id);
              }
            }}
            className={`bg-parchment-800/60 border rounded px-3 py-2 hover:border-gold/60 ${
              selected ? 'border-gold/70 shadow-glow-sm' : 'border-parchment-600/40'
            } ${isEditing ? '' : 'cursor-pointer'}`}
          >
            {isEditing && editingEvent ? (
              <SetupEventEditForm
                value={editingEvent}
                onChange={setEditingEvent}
                onCancel={() => setEditingEvent(null)}
                onSave={onSaveEdit}
              />
            ) : (
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={selected}
                  readOnly
                  className="mt-1 accent-gold pointer-events-none"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-parchment-100 text-sm flex items-center gap-2">
                    <Dices size={12} className="text-gold/70" /> {e.name}
                    {e.id.startsWith('gen_ev') && <span className="text-[10px] text-gold/70 tracking-wider uppercase">· 随机 ·</span>}
                    {e.arc && <span className="text-[10px] text-gold/70 tracking-wider uppercase">· 长线 ·</span>}
                  </div>
                  <div className="text-xs text-parchment-200/60">
                    概率 {Math.round(e.probability * 100)}%
                    {e.minRound ? ` · 第 ${e.minRound} 回合起` : ''}
                    {e.cooldown ? ` · 冷却 ${e.cooldown}` : ''}
                    {e.once ? ' · 仅触发一次' : ''}
                  </div>
                  <div className="text-xs text-parchment-200/50 mt-1 line-clamp-2">
                    {e.directive}
                  </div>
                </div>
                <div
                  className="shrink-0 flex flex-col gap-1"
                  onClick={(ev) => ev.stopPropagation()}
                  onKeyDown={(ev) => ev.stopPropagation()}
                >
                  <Button size="sm" variant="outline" onClick={() => onStartEdit(e)} title="编辑事件">
                    <Pencil size={12} />
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => onDelete(e)} title="删除事件">
                    <Trash2 size={12} />
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {list.length === 0 && (
        <div className="text-sm text-parchment-200/60 md:col-span-2">
          {showLibrary ? '书库中暂无可用随机事件。可以用上方按钮生成一批新事件。' : emptyText}
        </div>
      )}
    </div>
  );
}

function AuthorDirectorSection({
  config,
  onChange,
}: {
  config: AuthorDirectorConfig;
  onChange: (patch: Partial<AuthorDirectorConfig>) => void;
}) {
  return (
    <>
      <OrnateDivider>叙事导演</OrnateDivider>
      <Card className={config.enabled ? 'mb-4 border-gold/60 shadow-glow-sm' : 'mb-4'}>
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <CardTitle className="text-base">阶段目标 / 大纲映射</CardTitle>
            <CardMeta>
              故事和状态追踪完成后，额外调用一次导演模型，为接下来若干回合生成短期目标、节奏建议和大纲贴合方向。
            </CardMeta>
          </div>
          <label className="flex items-center gap-2 text-sm text-parchment-200/80 cursor-pointer">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => onChange({ enabled: e.target.checked })}
              className="accent-gold"
            />
            启用
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="刷新频率"
            type="number"
            min={1}
            max={20}
            value={config.everyRounds}
            disabled={!config.enabled}
            onChange={(e) => onChange({ everyRounds: Number(e.target.value) || 2 })}
            hint="每完成 N 回合重新规划"
          />
          <Input
            label="规划跨度"
            type="number"
            min={2}
            max={30}
            value={config.horizonRounds}
            disabled={!config.enabled}
            onChange={(e) => onChange({ horizonRounds: Number(e.target.value) || 6 })}
            hint="向后规划 N 回合"
          />
        </div>
        <Textarea
          label="导演提示词"
          value={config.prompt}
          disabled={!config.enabled}
          onChange={(e) => onChange({ prompt: e.target.value })}
          rows={4}
          hint="用于强调你想要的小说感、逻辑、节奏和主线贴合方式。"
        />
      </Card>
    </>
  );
}

function AuthorLogicCheckSection({
  config,
  onChange,
}: {
  config: AuthorLogicCheckConfig;
  onChange: (patch: Partial<AuthorLogicCheckConfig>) => void;
}) {
  return (
    <Card className={config.enabled ? 'mb-4 border-gold/50' : 'mb-4'}>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <CardTitle className="text-base">逻辑审校 / 连续性修复</CardTitle>
          <CardMeta>
            定期检查人物、场景、时间、道具、伏笔和大纲贴合问题，并把修复建议注入后续故事。
          </CardMeta>
        </div>
        <label className="flex items-center gap-2 text-sm text-parchment-200/80 cursor-pointer">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
            className="accent-gold"
          />
          启用
        </label>
      </div>
      <Input
        label="审校频率"
        type="number"
        min={1}
        max={20}
        value={config.everyRounds}
        disabled={!config.enabled}
        onChange={(e) => onChange({ everyRounds: Number(e.target.value) || 3 })}
        hint="每完成 N 回合检查一次"
      />
      <Textarea
        label="审校提示词"
        value={config.prompt}
        disabled={!config.enabled}
        onChange={(e) => onChange({ prompt: e.target.value })}
        rows={4}
        hint="用于强调哪些连续性问题最重要；后续可再交给专门提示词模型优化。"
      />
    </Card>
  );
}

function AuthorRandomEventSection({
  config,
  events,
  eventsHint,
  setEventsHint,
  genBusy,
  onGeneratePool,
  onGenerateReference,
  onConfigChange,
  onDynamicChange,
  showPoolLibrary,
  setShowPoolLibrary,
  showReferenceLibrary,
  setShowReferenceLibrary,
  onTogglePool,
  onToggleReference,
  editingEvent,
  setEditingEvent,
  onStartEdit,
  onSaveEdit,
  onDelete,
}: {
  config: AuthorRandomEventConfig;
  events: RandomEvent[];
  eventsHint: string;
  setEventsHint: (value: string) => void;
  genBusy: 'outline' | 'background' | 'scene' | 'events' | 'worldbook' | null;
  onGeneratePool: () => void;
  onGenerateReference: () => void;
  onConfigChange: (patch: Partial<AuthorRandomEventConfig>) => void;
  onDynamicChange: (patch: Partial<AuthorRandomEventConfig['dynamic']>) => void;
  showPoolLibrary: boolean;
  setShowPoolLibrary: (updater: (value: boolean) => boolean) => void;
  showReferenceLibrary: boolean;
  setShowReferenceLibrary: (updater: (value: boolean) => boolean) => void;
  onTogglePool: (id: string) => void;
  onToggleReference: (id: string) => void;
  editingEvent: RandomEvent | null;
  setEditingEvent: (event: RandomEvent | null) => void;
  onStartEdit: (event: RandomEvent) => void;
  onSaveEdit: () => void;
  onDelete: (event: RandomEvent) => void;
}) {
  const modeButton = (mode: AuthorRandomEventConfig['mode'], title: string, desc: string) => {
    const active = config.mode === mode;
    return (
      <button
        type="button"
        onClick={() => onConfigChange({ mode })}
        className={`rounded-lg border px-3 py-2 text-left transition-all ${
          active
            ? 'border-gold/70 bg-parchment-900/70 shadow-glow-sm'
            : 'border-parchment-600/40 bg-parchment-800/50 hover:border-gold/50'
        }`}
      >
        <div className={active ? 'text-gold-light font-serif text-sm' : 'text-parchment-100 font-serif text-sm'}>{title}</div>
        <div className="text-xs text-parchment-200/60 mt-0.5">{desc}</div>
      </button>
    );
  };

  const addGuaranteedRange = () => {
    const last = config.dynamic.guaranteedRanges.at(-1);
    const start = last ? last.endRound + 1 : Math.max(1, config.dynamic.startRound);
    onDynamicChange({
      guaranteedRanges: [
        ...config.dynamic.guaranteedRanges,
        { id: `range_${Date.now().toString(36)}`, startRound: start, endRound: start + 2 },
      ],
    });
  };

  const updateGuaranteedRange = (id: string, patch: Partial<{ startRound: number; endRound: number }>) => {
    onDynamicChange({
      guaranteedRanges: config.dynamic.guaranteedRanges.map((item) =>
        item.id === id ? { ...item, ...patch, consumed: false } : item,
      ),
    });
  };

  const removeGuaranteedRange = (id: string) => {
    onDynamicChange({
      guaranteedRanges: config.dynamic.guaranteedRanges.filter((item) => item.id !== id),
    });
  };

  return (
    <>
      <OrnateDivider>执笔随机事件</OrnateDivider>
      <div className="text-xs text-parchment-200/70 mb-3">
        执笔模式默认不套用书库随机事件。你可以关闭、使用手工事件池，或让模型根据剧情生成多回合长线事件。
      </div>
      <div className="grid gap-2 md:grid-cols-3 mb-4">
        {modeButton('off', '关闭', '完全不注入随机事件')}
        {modeButton('pool', '事件池', '使用你导入/生成的事件')}
        {modeButton('dynamic', '剧情驱动', '模型判断并生成长线事件')}
      </div>

      {config.mode === 'pool' && (
        <Card className="mb-4">
          <CardTitle className="text-base">事件池</CardTitle>
          <CardMeta>点击整张卡即可导入或取消；按钮区只负责编辑/删除。</CardMeta>
          <div className="flex items-start gap-2 mb-2">
            <textarea
              value={eventsHint}
              onChange={(e) => setEventsHint(e.target.value)}
              placeholder="（可选）生成事件池偏好，例如：恋爱日常、关系升温、误会澄清、不要暴力。"
              className="flex-1 bg-parchment-900/60 text-parchment-100 placeholder-parchment-200/40 border border-parchment-600/40 rounded px-3 py-1.5 font-serif text-xs focus:outline-none focus:border-gold/60 resize-y min-h-[58px] leading-relaxed"
            />
            <div className="flex flex-col gap-2">
              <Button size="sm" variant="outline" onClick={onGeneratePool} loading={genBusy === 'events'} disabled={genBusy !== null}>
                <Wand2 size={14} /> 生成
              </Button>
              <Button size="sm" variant={showPoolLibrary ? 'primary' : 'outline'} onClick={() => setShowPoolLibrary((v) => !v)}>
                <BookOpen size={14} /> {showPoolLibrary ? '收起' : '导入'}
              </Button>
            </div>
          </div>
          <SetupEventList
            events={events}
            selectedIds={config.poolEventIds}
            showLibrary={showPoolLibrary}
            emptyText="尚未导入事件池。可生成新事件，或从书库导入。"
            onToggle={onTogglePool}
            editingEvent={editingEvent}
            setEditingEvent={setEditingEvent}
            onStartEdit={onStartEdit}
            onSaveEdit={onSaveEdit}
            onDelete={onDelete}
          />
        </Card>
      )}

      {config.mode === 'dynamic' && (
        <Card className="mb-4 border-gold/60">
          <CardTitle className="text-base">剧情驱动长线事件</CardTitle>
          <CardMeta>
            每回合故事和状态追踪完成后，系统会按概率/必定区间检查下一回合是否生成一个多回合事件弧。
          </CardMeta>
          <div className="grid gap-3 md:grid-cols-3">
            <Input
              label="开始检查回合"
              type="number"
              min={1}
              value={config.dynamic.startRound}
              onChange={(e) => onDynamicChange({ startRound: Number(e.target.value) || 1 })}
            />
            <Input
              label="触发后冷却"
              type="number"
              min={0}
              value={config.dynamic.cooldownRounds}
              onChange={(e) => onDynamicChange({ cooldownRounds: Number(e.target.value) || 0 })}
              hint="回合"
            />
            <Input
              label="默认概率（%）"
              type="number"
              min={0}
              max={100}
              value={Math.round(config.dynamic.baseProbability * 100)}
              onChange={(e) => onDynamicChange({ baseProbability: clampSetup01((Number(e.target.value) || 0) / 100) })}
            />
            <Input
              label="未触发递增（%）"
              type="number"
              min={0}
              max={100}
              value={Math.round(config.dynamic.missProbabilityBonus * 100)}
              onChange={(e) => onDynamicChange({ missProbabilityBonus: clampSetup01((Number(e.target.value) || 0) / 100) })}
            />
            <Input
              label="概率上限（%）"
              type="number"
              min={0}
              max={100}
              value={Math.round(config.dynamic.maxProbability * 100)}
              onChange={(e) => onDynamicChange({ maxProbability: clampSetup01((Number(e.target.value) || 0) / 100) })}
            />
          </div>

          <div className="mt-2">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-gold-light font-serif">必定触发区间</div>
              <Button size="sm" variant="outline" onClick={addGuaranteedRange}>
                <Plus size={14} /> 添加
              </Button>
            </div>
            <div className="space-y-2">
              {config.dynamic.guaranteedRanges.map((range) => (
                <div key={range.id} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                  <Input
                    label="起始"
                    type="number"
                    min={1}
                    value={range.startRound}
                    onChange={(e) => updateGuaranteedRange(range.id, { startRound: Number(e.target.value) || 1 })}
                  />
                  <Input
                    label="结束"
                    type="number"
                    min={1}
                    value={range.endRound}
                    onChange={(e) => updateGuaranteedRange(range.id, { endRound: Number(e.target.value) || range.startRound })}
                  />
                  <Button size="sm" variant="danger" onClick={() => removeGuaranteedRange(range.id)} title="删除区间">
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
              {!config.dynamic.guaranteedRanges.length && (
                <div className="text-xs text-parchment-200/60">未设置必定触发区间；系统只按概率检查。</div>
              )}
            </div>
          </div>

          <Textarea
            label="触发随机事件的提示词"
            value={config.dynamic.generatorPrompt}
            onChange={(e) => onDynamicChange({ generatorPrompt: e.target.value })}
            rows={4}
            hint="例如：优先参照上文出现的人物、关系、承诺、地点。"
          />
          <Textarea
            label="事件偏好提示词"
            value={config.dynamic.preferencePrompt}
            onChange={(e) => onDynamicChange({ preferencePrompt: e.target.value })}
            rows={4}
            hint="例如：恋爱对象主动邀约、误会澄清、阶段性收束，不要突兀危机。"
          />

          <div className="flex items-start gap-2 mb-2">
            <textarea
              value={eventsHint}
              onChange={(e) => setEventsHint(e.target.value)}
              placeholder="（可选）生成参考事件偏好；参考事件会发给动态事件模型，但不直接作为旧式随机事件触发。"
              className="flex-1 bg-parchment-900/60 text-parchment-100 placeholder-parchment-200/40 border border-parchment-600/40 rounded px-3 py-1.5 font-serif text-xs focus:outline-none focus:border-gold/60 resize-y min-h-[58px] leading-relaxed"
            />
            <div className="flex flex-col gap-2">
              <Button size="sm" variant="outline" onClick={onGenerateReference} loading={genBusy === 'events'} disabled={genBusy !== null}>
                <Wand2 size={14} /> 生成参考
              </Button>
              <Button size="sm" variant={showReferenceLibrary ? 'primary' : 'outline'} onClick={() => setShowReferenceLibrary((v) => !v)}>
                <BookOpen size={14} /> {showReferenceLibrary ? '收起' : '导入参考'}
              </Button>
            </div>
          </div>
          <SetupEventList
            events={events}
            selectedIds={config.dynamic.referenceEventIds}
            showLibrary={showReferenceLibrary}
            emptyText="尚未导入参考事件。动态模型仍可只根据上下文生成。"
            onToggle={onToggleReference}
            editingEvent={editingEvent}
            setEditingEvent={setEditingEvent}
            onStartEdit={onStartEdit}
            onSaveEdit={onSaveEdit}
            onDelete={onDelete}
          />
        </Card>
      )}
    </>
  );
}

function SetupEventEditForm({
  value,
  onChange,
  onCancel,
  onSave,
}: {
  value: RandomEvent;
  onChange: (value: RandomEvent) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div>
      <Input
        label="事件名"
        value={value.name}
        onChange={(e) => onChange({ ...value, name: e.target.value })}
      />
      <Textarea
        label="事件指令"
        value={value.directive}
        onChange={(e) => onChange({ ...value, directive: e.target.value })}
        rows={4}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Input
          label="概率（%）"
          type="number"
          min={0}
          max={100}
          value={Math.round((value.probability ?? 0) * 100)}
          onChange={(e) => onChange({ ...value, probability: clampSetup01((Number(e.target.value) || 0) / 100) })}
        />
        <Input
          label="触发回合"
          type="number"
          min={1}
          value={value.minRound ?? ''}
          onChange={(e) => onChange({ ...value, minRound: optionalSetupInt(e.target.value) })}
        />
        <Input
          label="冷却回合"
          type="number"
          min={0}
          value={value.cooldown ?? ''}
          onChange={(e) => onChange({ ...value, cooldown: optionalSetupInt(e.target.value, true) })}
        />
      </div>
      <label className="mb-3 flex items-center gap-2 text-sm text-parchment-200/80 cursor-pointer">
        <input
          type="checkbox"
          checked={!!value.once}
          onChange={(e) => onChange({ ...value, once: e.target.checked })}
          className="accent-gold"
        />
        只触发一次
      </label>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <X size={14} /> 取消
        </Button>
        <Button size="sm" onClick={onSave}>
          <Save size={14} /> 保存
        </Button>
      </div>
    </div>
  );
}

function normalizeSetupEvent(event: RandomEvent): RandomEvent {
  return {
    ...event,
    name: event.name.trim() || '未命名事件',
    directive: event.directive.trim(),
    probability: clampSetup01(Number(event.probability) || 0),
    minRound: setupPositiveOrUndefined(event.minRound),
    cooldown: setupPositiveOrUndefined(event.cooldown, true),
    once: !!event.once,
  };
}

function optionalSetupInt(text: string, allowZero = false): number | undefined {
  if (text.trim() === '') return undefined;
  return setupPositiveOrUndefined(Number(text), allowZero);
}

function setupPositiveOrUndefined(value: unknown, allowZero = false): number | undefined {
  const num = Math.floor(Number(value));
  if (!Number.isFinite(num)) return undefined;
  return Math.max(allowZero ? 0 : 1, num);
}

function clampSetup01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
