import { useEffect, useState } from 'react';
import type { Choice } from '@/types/game';
import { Card } from './ui/Card';
import { clsx } from '@/lib/utils';
import { Button } from './ui/Button';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';

interface ChoicePanelProps {
  choices: Choice[];
  disabled?: boolean;
  onPick: (choice: Choice) => void;
  onChangeChoices?: (choices: Choice[]) => void;
}

const HINT_COLORS: Record<string, string> = {
  冒险: 'text-blood',
  风险: 'text-blood',
  血腥: 'text-blood',
  稳妥: 'text-emerald-300/80',
  温和: 'text-emerald-300/80',
  社交: 'text-sky-300/80',
  诚实: 'text-sky-300/80',
  欺诈: 'text-violet-300/80',
  探索: 'text-amber-300/80',
};

export function ChoicePanel({ choices, disabled, onPick, onChangeChoices }: ChoicePanelProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Choice[]>(choices);

  useEffect(() => {
    if (!editing) setDraft(choices);
  }, [choices, editing]);

  // 数字键 1~4 快捷选择
  useEffect(() => {
    if (disabled || editing || !choices.length) return;
    const onKey = (e: KeyboardEvent) => {
      // 忽略组合键与输入控件内的按键
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const idx = '1234'.indexOf(e.key);
      if (idx >= 0 && idx < choices.length) {
        e.preventDefault();
        onPick(choices[idx]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [choices, disabled, editing, onPick]);

  const updateDraft = (index: number, patch: Partial<Choice>) => {
    setDraft((items) => items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  if (editing) {
    return (
      <div className="rounded-md border border-gold/50 bg-parchment-900/40 p-4 shadow-glow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-xs tracking-[0.3em] text-gold/70 font-serif uppercase">编辑当前决策</div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDraft((items) => [
                ...items,
                { id: String.fromCharCode(97 + items.length), label: '新的行动选项', hint: '自定义' },
              ].slice(0, 4))}
              disabled={draft.length >= 4}
            >
              <Plus size={12} /> 添加
            </Button>
          </div>
        </div>
        <div className="space-y-3">
          {draft.map((choice, index) => (
            <div key={`${choice.id}_${index}`} className="rounded border border-parchment-600/40 bg-parchment-800/50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs text-gold-light font-serif">选项 {index + 1}</div>
                <button
                  type="button"
                  onClick={() => setDraft((items) => items.filter((_, i) => i !== index))}
                  className="rounded p-1 text-parchment-200/50 hover:bg-blood/10 hover:text-blood transition-colors"
                  title="删除此选项"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <textarea
                value={choice.label}
                onChange={(e) => updateDraft(index, { label: e.target.value })}
                className="w-full min-h-[64px] resize-y rounded-md border border-parchment-600/50 bg-ink/40 px-3 py-2 font-serif text-sm leading-relaxed text-parchment-50 outline-none focus:border-gold/80"
              />
              <input
                value={choice.hint ?? ''}
                onChange={(e) => updateDraft(index, { hint: e.target.value })}
                placeholder="标签，如：稳妥 / 冒险 / 社交"
                className="mt-2 w-full rounded-md border border-parchment-600/50 bg-ink/40 px-3 py-1.5 font-serif text-xs text-parchment-50 outline-none focus:border-gold/80 placeholder:text-parchment-200/35"
              />
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(choices);
              setEditing(false);
            }}
          >
            <X size={14} /> 取消
          </Button>
          <Button
            size="sm"
            disabled={draft.filter((item) => item.label.trim()).length < 1}
            onClick={() => {
              const next = draft
                .map((item, index) => ({
                  id: String.fromCharCode(97 + index),
                  label: item.label.trim().slice(0, 80),
                  hint: item.hint?.trim() ? item.hint.trim().slice(0, 16) : undefined,
                }))
                .filter((item) => item.label)
                .slice(0, 4);
              onChangeChoices?.(next);
              setEditing(false);
            }}
          >
            <Check size={14} /> 保存
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3 grid-cols-1 md:grid-cols-2 relative">
      {onChangeChoices && !disabled && choices.length > 0 && (
        <div className="col-span-full flex justify-end">
          <Button size="sm" variant="outline" onClick={() => { setDraft(choices); setEditing(true); }}>
            <Pencil size={14} /> 编辑选项
          </Button>
        </div>
      )}
      {choices.map((c, idx) => (
          <Card
            key={c.id}
            interactive
            onClick={() => !disabled && onPick(c)}
            className={clsx(
              'flex items-start gap-3 py-4',
              disabled && 'opacity-50 pointer-events-none',
            )}
          >
            <div className="shrink-0 w-8 h-8 rounded-full border border-gold-dark text-gold-light flex items-center justify-center font-serif relative">
              {idx + 1}
              <span className="absolute -bottom-1 -right-1 text-[8px] bg-parchment-800 border border-gold-dark/60 rounded px-0.5 text-parchment-200/70 tracking-wider">
                {String.fromCharCode(65 + idx)}
              </span>
            </div>
            <div className="flex-1">
              <div className="text-parchment-100 font-serif leading-relaxed">{c.label}</div>
              {c.hint && (
                <div
                  className={clsx(
                    'mt-1 text-xs tracking-wider',
                    HINT_COLORS[c.hint] ?? 'text-parchment-200/60',
                  )}
                >
                  · {c.hint}
                </div>
              )}
            </div>
          </Card>
        ))}
      {choices.length > 0 && (
        <div className="col-span-full text-[10px] text-parchment-200/40 text-center font-serif tracking-[0.3em]">
          · 按数字键 1-{choices.length} 快速选择 ·
        </div>
      )}
    </div>
  );
}
