import { useState } from 'react';
import {
  BookLock,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  KeyRound,
  Plus,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardMeta, CardTitle } from '@/components/ui/Card';
import { Input, Textarea } from '@/components/ui/Input';
import type { WorldBook } from '@/types/content';
import { createBlankWorldBookEntry } from './model';

interface WorldBookEditorProps {
  value: WorldBook;
  onChange: (value: WorldBook) => void;
  reference?: WorldBook;
  showReference?: boolean;
}

export function WorldBookEditor({ value, onChange, reference, showReference = false }: WorldBookEditorProps) {
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(
    () => new Set(value.entries.map((entry) => entry.id)),
  );

  const addEntry = () => {
    const entry = createBlankWorldBookEntry();
    setExpandedEntries((current) => new Set(current).add(entry.id));
    onChange({ ...value, entries: [...value.entries, entry] });
  };

  return (
    <div className="space-y-5">
      <Card variant="luminous">
        <CardTitle className="mb-1 flex items-center gap-2 text-base">
          <BookLock size={17} /> 世界书总览
        </CardTitle>
        <CardMeta>
          世界书只保存会长期约束故事的硬设定与关键线索。单次动作、临时天气和当回合情绪不应写在这里。
        </CardMeta>
        <Input
          label="世界书名称"
          value={value.name}
          maxLength={80}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
          placeholder="例如：错位青春 · 世界书"
        />
        <Textarea
          label="用途说明"
          value={value.description ?? ''}
          rows={3}
          onChange={(event) => onChange({ ...value, description: event.target.value })}
          placeholder="这本世界书约束哪些内容？哪些细节应继续交给模型补全？"
        />
      </Card>

      {showReference && reference && (
        <details className="group rounded-md border border-gold-dark/35 bg-parchment-900/30">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm text-parchment-100 transition-colors hover:text-gold-light">
            <CircleHelp size={16} className="text-gold/80" />
            <span className="font-serif">查看《{reference.name}》条目示例</span>
            <span className="text-[11px] text-parchment-200/45">{reference.entries.length} 条</span>
            <ChevronRight size={15} className="ml-auto transition-transform group-open:rotate-90" />
          </summary>
          <div className="space-y-3 border-t border-parchment-600/30 px-4 py-4">
            <p className="text-xs leading-relaxed text-parchment-200/65">
              范本把“世界基调、能力规则、主角身份”等高优先级内容设为常驻；宿舍、人物线索等只在关键词命中时补充，从而控制输入成本。
            </p>
            {reference.entries.slice(0, 4).map((entry) => (
              <div key={entry.id} className="rounded border border-parchment-600/30 bg-parchment-900/45 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-gold-light">
                  {entry.name}
                  <span className="rounded border border-gold/25 px-1.5 py-0.5 text-[10px] text-parchment-200/60">
                    {entry.alwaysActive ? '始终生效' : `${entry.keywords.length} 个关键词`}
                  </span>
                  <span className="text-[10px] text-parchment-200/45">优先级 {entry.priority ?? 0}</span>
                </div>
                <div className="mt-1 line-clamp-3 whitespace-pre-line text-[11px] leading-relaxed text-parchment-200/60">
                  {entry.content}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-serif text-xl text-gold-light">
            <KeyRound size={19} /> 长期设定条目
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-parchment-200/60">
            常驻条目每轮都会提供给模型；关键词条目仅在最近上下文相关时加入。
          </p>
        </div>
        <Button size="sm" onClick={addEntry}>
          <Plus size={14} /> 新增条目
        </Button>
      </div>

      <div className="space-y-3">
        {value.entries.map((entry, entryIndex) => {
          const expanded = expandedEntries.has(entry.id);
          return (
            <Card key={entry.id} className="!p-0 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setExpandedEntries((current) => {
                    const next = new Set(current);
                    if (next.has(entry.id)) next.delete(entry.id);
                    else next.add(entry.id);
                    return next;
                  })}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  {expanded ? <ChevronDown size={16} className="shrink-0 text-gold" /> : <ChevronRight size={16} className="shrink-0 text-gold" />}
                  <span className={`h-2 w-2 shrink-0 rounded-full ${entry.alwaysActive ? 'bg-gold shadow-glow-sm' : 'bg-parchment-500'}`} />
                  <span className="min-w-0">
                    <span className="block truncate font-serif text-sm text-parchment-50">{entry.name || `未命名条目 ${entryIndex + 1}`}</span>
                    <span className="block truncate text-[11px] text-parchment-200/50">
                      {entry.alwaysActive ? '始终生效' : entry.keywords.length ? `关键词：${entry.keywords.join('、')}` : '尚未设置激活方式'}
                    </span>
                  </span>
                </button>
                <span className="hidden text-[10px] text-parchment-200/45 sm:inline">P{entry.priority ?? 0}</span>
                <Button
                  size="xs"
                  variant="ghost"
                  title="删除设定条目"
                  disabled={value.entries.length <= 1}
                  onClick={() => onChange({ ...value, entries: value.entries.filter((_, index) => index !== entryIndex) })}
                >
                  <Trash2 size={13} />
                </Button>
              </div>

              {expanded && (
                <div className="animate-fade-in border-t border-parchment-600/30 px-4 py-4 sm:px-5">
                  <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_140px]">
                    <Input
                      label="条目名称"
                      value={entry.name}
                      onChange={(event) => onChange({
                        ...value,
                        entries: value.entries.map((item, index) => index === entryIndex ? { ...item, name: event.target.value } : item),
                      })}
                      placeholder="例如：能力规则"
                    />
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      label="优先级（0–100）"
                      value={entry.priority ?? 0}
                      onChange={(event) => onChange({
                        ...value,
                        entries: value.entries.map((item, index) => index === entryIndex ? { ...item, priority: Number(event.target.value) } : item),
                      })}
                    />
                  </div>

                  <Textarea
                    label="设定正文"
                    value={entry.content}
                    rows={7}
                    onChange={(event) => onChange({
                      ...value,
                      entries: value.entries.map((item, index) => index === entryIndex ? { ...item, content: event.target.value } : item),
                    })}
                    placeholder="写明不可自相矛盾的事实、规则、人物身份或关系起点。模型可以补全空白，但后文必须遵从已建立的设定。"
                    hint="尽量使用明确陈述。需要列举规则时可直接换行编号。"
                  />

                  <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                    <Input
                      label="激活关键词"
                      value={entry.keywords.join('，')}
                      disabled={entry.alwaysActive}
                      onChange={(event) => onChange({
                        ...value,
                        entries: value.entries.map((item, index) => index === entryIndex ? {
                          ...item,
                          keywords: event.target.value.split(/[,，\n]/).map((keyword) => keyword.trim()).filter(Boolean),
                        } : item),
                      })}
                      placeholder="角色名，地点，物品，事件"
                      hint={entry.alwaysActive ? '常驻条目无需关键词。' : '命中任一关键词即可在相关回合补充此设定。'}
                    />

                    <label className={`mb-4 flex cursor-pointer items-center justify-between gap-4 rounded-md border px-4 py-3 transition-all ${
                      entry.alwaysActive
                        ? 'border-gold/55 bg-gold/10 shadow-glow-sm'
                        : 'border-parchment-600/40 bg-parchment-900/35 hover:border-gold/40'
                    }`}>
                      <span>
                        <span className="block text-sm font-serif text-parchment-50">始终生效</span>
                        <span className="mt-1 block text-[11px] leading-relaxed text-parchment-200/55">只给必须每轮存在的核心规则开启。</span>
                      </span>
                      <span className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${entry.alwaysActive ? 'border-gold bg-gold/25' : 'border-parchment-500/60 bg-parchment-900'}`}>
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={!!entry.alwaysActive}
                          onChange={(event) => onChange({
                            ...value,
                            entries: value.entries.map((item, index) => index === entryIndex ? { ...item, alwaysActive: event.target.checked } : item),
                          })}
                        />
                        <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-parchment-100 shadow transition-transform ${entry.alwaysActive ? 'translate-x-5' : 'translate-x-0'}`} />
                      </span>
                    </label>
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
