import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  BookPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Compass,
  Dices,
  Feather,
  Footprints,
  Layers3,
  ScrollText,
  Sparkles,
} from 'lucide-react';
import {
  flattenWorldBookEntries,
  selectAllBackgrounds,
  selectAllOutlines,
  selectAllWorldBooks,
  useContentStore,
} from '@/store/useContentStore';
import { Button } from '@/components/ui/Button';
import { Card, CardMeta, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { OrnateDivider } from '@/components/ui/Ornaments';
import type { JourneyModeV2 } from './types';
import { useGameStoreV2 } from './store';

type SetupStep = 'outline' | 'background' | 'launch';

const STEPS: Array<{ id: SetupStep; label: string; short: string }> = [
  { id: 'outline', label: '选择故事', short: '一' },
  { id: 'background', label: '选择出身', short: '二' },
  { id: 'launch', label: '启程设定', short: '三' },
];

export default function SetupPageV2() {
  const nav = useNavigate();
  const outlines = useContentStore(selectAllOutlines);
  const backgrounds = useContentStore(selectAllBackgrounds);
  const worldBooks = useContentStore(selectAllWorldBooks);

  const firstOutline = outlines[0];
  const firstBackground = backgrounds[0];
  const [step, setStep] = useState<SetupStep>('outline');
  const [mode, setMode] = useState<JourneyModeV2>('author');
  const [outlineId, setOutlineId] = useState(firstOutline?.id ?? '');
  const [backgroundId, setBackgroundId] = useState(firstBackground?.id ?? '');
  const [worldBookIds, setWorldBookIds] = useState<string[]>(firstOutline?.worldBookIds ?? []);
  const [journeyName, setJourneyName] = useState(firstOutline?.title ?? '');
  const [randomEventEnabled, setRandomEventEnabled] = useState(true);
  const [randomEventMin, setRandomEventMin] = useState(3);
  const [randomEventMax, setRandomEventMax] = useState(6);

  const outline = useMemo(
    () => outlines.find((item) => item.id === outlineId),
    [outlineId, outlines],
  );
  const background = useMemo(
    () => backgrounds.find((item) => item.id === backgroundId),
    [backgroundId, backgrounds],
  );
  const selectedBooks = useMemo(
    () => worldBooks.filter((book) => worldBookIds.includes(book.id)),
    [worldBookIds, worldBooks],
  );

  const currentIndex = STEPS.findIndex((item) => item.id === step);
  const canContinue = step === 'outline' ? !!outline : step === 'background' ? !!background : !!outline && !!background;
  const randomEventMinSafe = Math.min(100, Math.max(1, Math.round(randomEventMin) || 3));
  const randomEventMaxSafe = Math.min(100, Math.max(randomEventMinSafe, Math.round(randomEventMax) || randomEventMinSafe));

  const selectOutline = (id: string) => {
    const next = outlines.find((item) => item.id === id);
    setOutlineId(id);
    if (next) {
      setJourneyName(next.title);
      setWorldBookIds(next.worldBookIds ?? []);
    }
  };

  const goBack = () => {
    if (currentIndex <= 0) nav('/');
    else setStep(STEPS[currentIndex - 1].id);
  };

  const goNext = () => {
    if (!canContinue || currentIndex >= STEPS.length - 1) return;
    setStep(STEPS[currentIndex + 1].id);
  };

  const launch = () => {
    if (!outline || !background) return;
    useGameStoreV2.getState().create({
      name: journeyName.trim() || outline.title,
      mode,
      outline,
      background,
      worldFacts: flattenWorldBookEntries(worldBooks, worldBookIds),
      randomEvent: {
        enabled: randomEventEnabled,
        triggerIntervalMin: randomEventMinSafe,
        triggerIntervalMax: randomEventMaxSafe,
      },
    });
    nav('/game');
  };

  return (
    <div className="mx-auto min-h-full max-w-6xl px-5 py-8 pb-24 sm:px-6">
      <header className="mb-7 grid grid-cols-[auto_1fr_auto] items-center gap-3">
        <Button variant="ghost" onClick={goBack}>
          <ArrowLeft size={16} /> {currentIndex === 0 ? '返回主页' : '上一步'}
        </Button>

        <nav className="hidden items-center justify-center gap-3 font-serif sm:flex" aria-label="启程步骤">
          {STEPS.map((item, index) => {
            const active = item.id === step;
            const done = index < currentIndex;
            const enabled = index <= currentIndex || (index === 1 && !!outline) || (index === 2 && !!outline && !!background);
            return (
              <div key={item.id} className="flex items-center gap-3">
                {index > 0 && <div className={`h-px w-8 ${done || active ? 'bg-gold/55' : 'bg-parchment-600/35'}`} />}
                <button
                  type="button"
                  disabled={!enabled}
                  onClick={() => enabled && setStep(item.id)}
                  className={`flex items-center gap-2 rounded px-2 py-1 text-sm transition-colors disabled:cursor-not-allowed ${
                    active
                      ? 'text-gold-light'
                      : done
                        ? 'text-parchment-100/85 hover:text-gold-light'
                        : 'text-parchment-200/45'
                  }`}
                >
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs ${
                    active
                      ? 'border-gold bg-gold/10 shadow-glow-sm'
                      : done
                        ? 'border-gold/50 bg-parchment-800/80'
                        : 'border-parchment-600/45'
                  }`}>
                    {done ? <Check size={12} /> : item.short}
                  </span>
                  {item.label}
                </button>
              </div>
            );
          })}
        </nav>

        <div className="text-right text-xs font-serif tracking-[0.25em] text-parchment-200/55">
          DESTINY · JOURNEY
        </div>
      </header>

      <div className="mb-6 text-center sm:hidden">
        <span className="text-sm font-serif text-gold-light">
          {STEPS[currentIndex].short} · {STEPS[currentIndex].label}
        </span>
      </div>

      {step === 'outline' && (
        <section className="animate-fade-in">
          <PageHeading
            icon={<ScrollText size={22} />}
            title="选择一段命运"
            description="大纲规定故事必须经历的幕与故事节；你可以自由改变道路，规划模型会沿新的路径重新安排它们。"
          />

          <div className="mx-auto mt-5 flex max-w-3xl flex-col items-center justify-between gap-3 rounded-md border border-gold-dark/35 bg-parchment-900/35 px-4 py-3 text-center sm:flex-row sm:text-left">
            <div>
              <div className="font-serif text-sm text-parchment-50">没有想走的故事？</div>
              <div className="mt-0.5 text-xs leading-relaxed text-parchment-200/60">在命运工坊编写自己的幕、故事节与世界书，保存后会自动出现在这里。</div>
            </div>
            <Button size="sm" variant="outline" onClick={() => nav('/workshop')}>
              <BookPlus size={14} /> 打开命运工坊
            </Button>
          </div>

          <div className="mt-7 grid gap-5 md:grid-cols-2">
            {outlines.map((item) => {
              const selected = item.id === outlineId;
              const beatCount = item.acts.reduce((sum, act) => sum + act.beats.length, 0);
              return (
                <Card
                  key={item.id}
                  interactive
                  selected={selected}
                  onClick={() => selectOutline(item.id)}
                  className="flex min-h-[290px] flex-col"
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="mb-1 text-xl">
                        {item.coverEmoji && <span className="mr-2">{item.coverEmoji}</span>}
                        {item.title}
                      </CardTitle>
                      <CardMeta className="mb-0">
                        {item.acts.length} 幕 · {beatCount} 个故事节
                      </CardMeta>
                    </div>
                    {selected && (
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gold text-parchment-900 shadow-foil">
                        <Check size={15} />
                      </span>
                    )}
                  </div>

                  <p className="mb-4 text-sm leading-relaxed text-parchment-100/90">
                    {item.synopsis}
                  </p>

                  {item.tone && (
                    <div className="mb-4 rounded border border-parchment-600/35 bg-parchment-900/35 px-3 py-2 text-xs leading-relaxed text-parchment-200/70">
                      <span className="mr-2 text-gold/80">叙事基调</span>
                      {item.tone}
                    </div>
                  )}

                  <div className="mt-auto space-y-2">
                    {item.acts.map((act) => (
                      <div key={act.id} className="border-l border-gold-dark/60 pl-3">
                        <div className="text-xs font-serif text-gold-light/90">{act.title}</div>
                        <div className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-parchment-200/60">
                          {act.purpose}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              );
            })}

            {!outlines.length && (
              <EmptyState>当前没有可用的大纲，请先检查预设内容。</EmptyState>
            )}
          </div>
        </section>
      )}

      {step === 'background' && (
        <section className="animate-fade-in">
          <PageHeading
            icon={<Footprints size={22} />}
            title="选择主角的出身"
            description="出身提供开局身份、初始物品与第一幕场景。之后发生什么，仍由你的行动和故事共同决定。"
          />

          {outline && (
            <div className="mx-auto mt-5 max-w-3xl rounded-md border border-gold-dark/35 bg-parchment-900/35 px-4 py-3 text-sm text-parchment-200/75">
              <span className="mr-2 text-gold-light">已选故事</span>
              {outline.coverEmoji} {outline.title}
            </div>
          )}

          <div className="mt-7 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {backgrounds.map((item) => {
              const selected = item.id === backgroundId;
              return (
                <Card
                  key={item.id}
                  interactive
                  selected={selected}
                  onClick={() => setBackgroundId(item.id)}
                  className="flex flex-col"
                >
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-lg">
                      {item.coverEmoji && <span className="mr-2">{item.coverEmoji}</span>}
                      {item.name}
                    </CardTitle>
                    {selected && <Check size={18} className="shrink-0 text-gold-light" />}
                  </div>
                  <p className="mb-4 text-sm leading-relaxed text-parchment-100/90">
                    {item.description}
                  </p>
                  <div className="mb-4 flex flex-wrap gap-1.5">
                    {item.traits.map((trait) => (
                      <span
                        key={trait}
                        className="rounded border border-gold/35 bg-parchment-900/40 px-2 py-0.5 text-[11px] text-parchment-100"
                      >
                        {trait}
                      </span>
                    ))}
                  </div>
                  <div className="mt-auto border-t border-parchment-600/30 pt-3">
                    <div className="mb-1.5 text-xs text-gold/80">初始随身物品</div>
                    <div className="text-xs leading-relaxed text-parchment-200/65">
                      {item.startItems.length ? item.startItems.join(' · ') : '无'}
                    </div>
                  </div>
                </Card>
              );
            })}

            {!backgrounds.length && (
              <EmptyState>当前没有可用的角色出身。</EmptyState>
            )}
          </div>
        </section>
      )}

      {step === 'launch' && outline && background && (
        <section className="animate-fade-in">
          <PageHeading
            icon={<Compass size={22} />}
            title="启程设定"
            description="这里只决定玩家如何参与故事，以及本段命运需要携带的世界资料；叙事速度可在旅途中随时调整。"
          />

          <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(280px,2fr)]">
            <div className="space-y-6">
              <Card>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Feather size={17} /> 参与方式
                </CardTitle>
                <CardMeta>两种模式使用同一套规划与故事链路，也都允许玩家自由输入。</CardMeta>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <ModeCard
                    selected={mode === 'author'}
                    icon={<Feather size={20} />}
                    title="执笔模式"
                    description="每轮由你自由写下主角行动，像共同作者一样改变故事道路。"
                    onClick={() => setMode('author')}
                  />
                  <ModeCard
                    selected={mode === 'adventure'}
                    icon={<Compass size={20} />}
                    title="游历模式"
                    description="规划模型会给出可选方向，同时保留自由输入，适合边读边选择。"
                    onClick={() => setMode('adventure')}
                  />
                </div>
              </Card>

              <Card>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Dices size={17} /> 随机事件
                    </CardTitle>
                    <CardMeta>
                      事件到点后由模型在本回合或下回合自然插入，并服从当前叙事速度。
                    </CardMeta>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={randomEventEnabled}
                    aria-label="开启随机事件"
                    onClick={() => setRandomEventEnabled((value) => !value)}
                    className={`relative mt-1 h-6 w-11 shrink-0 rounded-full border transition-colors ${randomEventEnabled
                      ? 'border-gold/70 bg-gold/55'
                      : 'border-parchment-500/55 bg-parchment-800/80'}`}
                  >
                    <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-parchment-50 shadow transition-transform ${randomEventEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>
                {randomEventEnabled && (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <Input
                      label="最短触发间隔（回合）"
                      type="number"
                      min={1}
                      max={100}
                      step={1}
                      value={randomEventMin}
                      onChange={(event) => setRandomEventMin(Number(event.target.value))}
                      hint="距离上次事件至少间隔多少回合。"
                    />
                    <Input
                      label="最长触发间隔（回合）"
                      type="number"
                      min={1}
                      max={100}
                      step={1}
                      value={randomEventMax}
                      onChange={(event) => setRandomEventMax(Number(event.target.value))}
                      hint="距离上次事件至多间隔多少回合；不能小于最短间隔。"
                    />
                  </div>
                )}
              </Card>

              <Card>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BookOpen size={17} /> 世界资料
                </CardTitle>
                <CardMeta>
                  大纲推荐的世界书会自动选中。它们负责长期世界规则与关键人物设定，不替模型编写具体场景。
                </CardMeta>
                <div className="mt-4 space-y-2">
                  {worldBooks.map((book) => {
                    const checked = worldBookIds.includes(book.id);
                    const recommended = outline.worldBookIds?.includes(book.id);
                    return (
                      <label
                        key={book.id}
                        className={`flex cursor-pointer items-start gap-3 rounded-md border px-4 py-3 transition-all ${
                          checked
                            ? 'border-gold/60 bg-gold/8 shadow-glow-sm'
                            : 'border-parchment-600/35 bg-parchment-900/25 hover:border-gold/40'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setWorldBookIds((ids) => (
                            ids.includes(book.id)
                              ? ids.filter((id) => id !== book.id)
                              : [...ids, book.id]
                          ))}
                          className="mt-1 accent-gold"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-sm text-parchment-50">
                            {book.name}
                            {recommended && (
                              <span className="rounded border border-gold/35 px-1.5 py-0.5 text-[10px] tracking-wider text-gold-light">
                                大纲推荐
                              </span>
                            )}
                          </div>
                          <div className="mt-1 text-xs text-parchment-200/60">
                            {book.entries.length} 条长期设定
                          </div>
                        </div>
                      </label>
                    );
                  })}

                  {!worldBooks.length && (
                    <div className="py-4 text-center text-sm text-parchment-200/55">暂无世界资料。</div>
                  )}
                </div>
              </Card>
            </div>

            <div>
              <Card variant="luminous" className="sticky top-6">
                <CardTitle className="flex items-center gap-2">
                  <Sparkles size={18} /> 旅程预览
                </CardTitle>
                <Input
                  label="旅程名称"
                  value={journeyName}
                  maxLength={40}
                  onChange={(event) => setJourneyName(event.target.value)}
                  placeholder={outline.title}
                />

                <OrnateDivider className="!my-4" />

                <dl className="space-y-4 text-sm">
                  <PreviewRow label="故事" value={`${outline.coverEmoji ?? ''} ${outline.title}`.trim()} />
                  <PreviewRow label="出身" value={`${background.coverEmoji ?? ''} ${background.name}`.trim()} />
                  <PreviewRow label="模式" value={mode === 'author' ? '执笔模式 · 自由输入' : '游历模式 · 选项与自由输入'} />
                  <PreviewRow label="随机事件" value={randomEventEnabled ? `开启 · ${randomEventMinSafe}～${randomEventMaxSafe} 回合` : '关闭'} />
                  <PreviewRow label="世界资料" value={selectedBooks.length ? selectedBooks.map((book) => book.name).join('、') : '未选择'} />
                </dl>

                <div className="mt-5 rounded border border-parchment-600/35 bg-parchment-900/35 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs text-gold-light">
                    <Layers3 size={14} /> 命运骨架
                  </div>
                  <div className="space-y-2">
                    {outline.acts.map((act) => (
                      <div key={act.id} className="text-xs text-parchment-200/70">
                        <span className="text-parchment-100">{act.title}</span>
                        <span className="ml-2 text-parchment-200/45">{act.beats.length} 节</span>
                      </div>
                    ))}
                  </div>
                </div>

                <Button className="mt-6 w-full" size="lg" onClick={launch}>
                  <Compass size={18} /> 启程
                </Button>
              </Card>
            </div>
          </div>
        </section>
      )}

      <footer className="mt-9 flex items-center justify-between border-t border-parchment-600/25 pt-5">
        <Button variant="ghost" onClick={goBack}>
          <ChevronLeft size={16} /> {currentIndex === 0 ? '返回主页' : '上一步'}
        </Button>
        {step !== 'launch' && (
          <Button onClick={goNext} disabled={!canContinue}>
            下一步 <ChevronRight size={16} />
          </Button>
        )}
      </footer>
    </div>
  );
}

function PageHeading({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="text-center">
      <h1 className="flex items-center justify-center gap-2 font-serif text-3xl tracking-widest text-gold-light">
        {icon} {title}
      </h1>
      <p className="mx-auto mt-3 max-w-3xl text-sm leading-relaxed text-parchment-200/70">
        {description}
      </p>
      <OrnateDivider className="mx-auto max-w-3xl" />
    </div>
  );
}

function ModeCard({
  selected,
  icon,
  title,
  description,
  onClick,
}: {
  selected: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border p-4 text-left transition-all ${
        selected
          ? 'border-gold bg-gold/10 shadow-glow-sm'
          : 'border-parchment-600/40 bg-parchment-900/30 hover:border-gold/50'
      }`}
    >
      <div className={`mb-2 flex items-center gap-2 font-serif ${selected ? 'text-gold-light' : 'text-parchment-100'}`}>
        {icon} {title}
        {selected && <Check size={14} className="ml-auto" />}
      </div>
      <div className="text-xs leading-relaxed text-parchment-200/65">{description}</div>
    </button>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="mb-1 text-xs tracking-wider text-gold/75">{label}</dt>
      <dd className="leading-relaxed text-parchment-100">{value}</dd>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="col-span-full rounded-md border border-dashed border-parchment-600/40 py-12 text-center font-serif text-parchment-200/60">
      {children}
    </div>
  );
}
