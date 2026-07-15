import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpenCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Plus,
  ScrollText,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardMeta, CardTitle } from '@/components/ui/Card';
import { Input, Textarea } from '@/components/ui/Input';
import type { StoryAct, StoryOutline } from '@/types/content';
import { createBlankAct, createBlankBeat } from './model';

interface OutlineEditorProps {
  value: StoryOutline;
  onChange: (value: StoryOutline) => void;
  reference?: StoryOutline;
}

export function OutlineEditor({ value, onChange, reference }: OutlineEditorProps) {
  const [expandedActs, setExpandedActs] = useState<Set<string>>(
    () => new Set(value.acts.map((act) => act.id)),
  );

  const updateAct = (actIndex: number, nextAct: StoryAct) => {
    onChange({
      ...value,
      acts: value.acts.map((act, index) => index === actIndex ? nextAct : act),
    });
  };

  const addAct = () => {
    const act = createBlankAct(value.acts.length + 1);
    setExpandedActs((current) => new Set(current).add(act.id));
    onChange({ ...value, acts: [...value.acts, act] });
  };

  const removeAct = (index: number) => {
    if (value.acts.length <= 1) return;
    onChange({ ...value, acts: value.acts.filter((_, itemIndex) => itemIndex !== index) });
  };

  const moveAct = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= value.acts.length) return;
    const next = [...value.acts];
    [next[index], next[target]] = [next[target], next[index]];
    onChange({ ...value, acts: next });
  };

  return (
    <div className="space-y-5">
      <Card variant="luminous">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="mb-1 flex items-center gap-2 text-base">
              <ScrollText size={17} /> 故事总览
            </CardTitle>
            <CardMeta className="mb-0">
              写清楚起点、长期方向和最终想抵达的结果。具体道路仍交给玩家与模型共同决定。
            </CardMeta>
          </div>
          <span className="rounded-full border border-gold/30 bg-parchment-900/40 px-3 py-1 text-[11px] text-gold-light/80">
            {value.acts.length} 幕 · {value.acts.reduce((sum, act) => sum + act.beats.length, 0)} 个故事节
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-[96px_minmax(0,1fr)]">
          <Input
            label="封面符号"
            value={value.coverEmoji ?? ''}
            maxLength={8}
            onChange={(event) => onChange({ ...value, coverEmoji: event.target.value })}
            placeholder="✦"
            className="text-center text-xl"
          />
          <Input
            label="故事标题"
            value={value.title}
            maxLength={60}
            onChange={(event) => onChange({ ...value, title: event.target.value })}
            placeholder="例如：错位青春"
          />
        </div>
        <Textarea
          label="故事简介"
          value={value.synopsis}
          rows={5}
          onChange={(event) => onChange({ ...value, synopsis: event.target.value })}
          placeholder="主角是谁？故事从什么变化开始？要经历怎样的成长，最终抵达什么状态？"
          hint="简介会长期提供给规划模型。尽量描述命运方向，不要把每一次场景写死。"
        />
        <Textarea
          label="叙事基调"
          value={value.tone ?? ''}
          rows={3}
          onChange={(event) => onChange({ ...value, tone: event.target.value })}
          placeholder="题材、氛围、内容比例，以及明确需要避免的发展方向。"
          hint="例如：校园日常 / 轻松治愈；现实世界；不要转向惊悚、战斗或开放世界漫游。"
        />
      </Card>

      {reference && (
        <details className="group rounded-md border border-gold-dark/35 bg-parchment-900/30">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm text-parchment-100 transition-colors hover:text-gold-light">
            <CircleHelp size={16} className="text-gold/80" />
            <span className="font-serif">参考《{reference.title}》如何组织命运骨架</span>
            <ChevronRight size={15} className="ml-auto transition-transform group-open:rotate-90" />
          </summary>
          <div className="border-t border-parchment-600/30 px-4 py-4">
            <p className="mb-4 text-xs leading-relaxed text-parchment-200/65">
              《错位青春》把结局拆成三幕，再把每幕拆成必须完成的“叙事作用”。故事节只规定结果，不锁死地点与发生方式，因此玩家改变路线后仍能迁移并继续推进。
            </p>
            <div className="grid gap-3 md:grid-cols-3">
              {reference.acts.map((act) => (
                <div key={act.id} className="rounded border border-parchment-600/30 bg-parchment-900/45 p-3">
                  <div className="mb-1 font-serif text-sm text-gold-light">{act.title}</div>
                  <div className="mb-2 text-[11px] leading-relaxed text-parchment-200/60">{act.purpose}</div>
                  <div className="space-y-1 border-l border-gold-dark/45 pl-2 text-[11px] text-parchment-100/75">
                    {act.beats.map((beat) => <div key={beat.id}>{beat.title}</div>)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </details>
      )}

      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-serif text-xl text-gold-light">
            <BookOpenCheck size={19} /> 命运幕与故事节
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-parchment-200/60">
            幕负责阶段方向；故事节负责必须完成的故事功能。不要把玩家只能怎样行动写进这里。
          </p>
        </div>
        <Button size="sm" onClick={addAct}>
          <Plus size={14} /> 新增一幕
        </Button>
      </div>

      <div className="space-y-4">
        {value.acts.map((act, actIndex) => {
          const expanded = expandedActs.has(act.id);
          return (
            <Card key={act.id} className="!p-0 overflow-hidden">
              <div className="flex items-center gap-2 border-b border-parchment-600/30 px-4 py-3">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={() => setExpandedActs((current) => {
                    const next = new Set(current);
                    if (next.has(act.id)) next.delete(act.id);
                    else next.add(act.id);
                    return next;
                  })}
                >
                  {expanded ? <ChevronDown size={16} className="shrink-0 text-gold" /> : <ChevronRight size={16} className="shrink-0 text-gold" />}
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gold/35 bg-parchment-900/50 text-xs text-gold-light">
                    {actIndex + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-serif text-sm text-parchment-50">{act.title || '未命名幕'}</span>
                    <span className="block text-[11px] text-parchment-200/50">{act.beats.length} 个故事节</span>
                  </span>
                </button>
                <Button size="xs" variant="ghost" title="上移" disabled={actIndex === 0} onClick={() => moveAct(actIndex, -1)}>
                  <ArrowUp size={13} />
                </Button>
                <Button size="xs" variant="ghost" title="下移" disabled={actIndex === value.acts.length - 1} onClick={() => moveAct(actIndex, 1)}>
                  <ArrowDown size={13} />
                </Button>
                <Button size="xs" variant="ghost" title="删除这一幕" disabled={value.acts.length <= 1} onClick={() => removeAct(actIndex)}>
                  <Trash2 size={13} />
                </Button>
              </div>

              {expanded && (
                <div className="animate-fade-in px-4 py-4 sm:px-5">
                  <div className="grid gap-4 md:grid-cols-2">
                    <Input
                      label="幕标题"
                      value={act.title}
                      onChange={(event) => updateAct(actIndex, { ...act, title: event.target.value })}
                      placeholder={`第 ${actIndex + 1} 幕 · 阶段名称`}
                    />
                    <Textarea
                      label="这一幕的叙事作用"
                      value={act.purpose}
                      rows={3}
                      onChange={(event) => updateAct(actIndex, { ...act, purpose: event.target.value })}
                      placeholder="这一阶段要让主角、关系或世界状态发生什么整体变化？"
                    />
                  </div>

                  <div className="mt-1 space-y-3">
                    {act.beats.map((beat, beatIndex) => (
                      <div key={beat.id} className="rounded-md border border-parchment-600/35 bg-parchment-900/35 p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="text-xs font-serif tracking-wider text-gold/80">故事节 {beatIndex + 1}</div>
                          <div className="flex gap-1">
                            <Button
                              size="xs"
                              variant="ghost"
                              title="上移故事节"
                              disabled={beatIndex === 0}
                              onClick={() => {
                                const beats = [...act.beats];
                                [beats[beatIndex - 1], beats[beatIndex]] = [beats[beatIndex], beats[beatIndex - 1]];
                                updateAct(actIndex, { ...act, beats });
                              }}
                            >
                              <ArrowUp size={12} />
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              title="下移故事节"
                              disabled={beatIndex === act.beats.length - 1}
                              onClick={() => {
                                const beats = [...act.beats];
                                [beats[beatIndex + 1], beats[beatIndex]] = [beats[beatIndex], beats[beatIndex + 1]];
                                updateAct(actIndex, { ...act, beats });
                              }}
                            >
                              <ArrowDown size={12} />
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              title="删除故事节"
                              disabled={act.beats.length <= 1}
                              onClick={() => updateAct(actIndex, { ...act, beats: act.beats.filter((_, index) => index !== beatIndex) })}
                            >
                              <Trash2 size={12} />
                            </Button>
                          </div>
                        </div>
                        <div className="grid gap-4 md:grid-cols-[minmax(180px,1fr)_minmax(0,2fr)]">
                          <Input
                            label="故事节名称"
                            value={beat.title}
                            onChange={(event) => updateAct(actIndex, {
                              ...act,
                              beats: act.beats.map((item, index) => index === beatIndex ? { ...item, title: event.target.value } : item),
                            })}
                            placeholder="例如：身份揭穿"
                          />
                          <Textarea
                            label="必须实现的结果"
                            value={beat.purpose}
                            rows={3}
                            onChange={(event) => updateAct(actIndex, {
                              ...act,
                              beats: act.beats.map((item, index) => index === beatIndex ? { ...item, purpose: event.target.value } : item),
                            })}
                            placeholder="描述这个故事节为何存在、完成后什么发生了改变。允许模型按玩家当前路线选择人物、地点与事件形式。"
                          />
                        </div>
                      </div>
                    ))}

                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full border-dashed"
                      onClick={() => updateAct(actIndex, { ...act, beats: [...act.beats, createBlankBeat()] })}
                    >
                      <Plus size={14} /> 为这一幕添加故事节
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
