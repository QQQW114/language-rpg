import { useEffect, useState } from 'react';
import type { Choice } from '@/types/game';
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
  冒险: 'text-blood border-blood/50',
  风险: 'text-blood border-blood/50',
  血腥: 'text-blood border-blood/50',
  稳妥: 'text-moss-light border-moss/50',
  温和: 'text-moss-light border-moss/50',
  社交: 'text-sky-300/85 border-sky-400/40',
  诚实: 'text-sky-300/85 border-sky-400/40',
  欺诈: 'text-violet-300/85 border-violet-400/40',
  探索: 'text-amber-300/85 border-amber-400/40',
};

export function ChoicePanel({ choices, disabled, onPick, onChangeChoices }: ChoicePanelProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Choice[]>(choices);
  const [pressedIdx, setPressedIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!editing) setDraft(choices);
  }, [choices, editing]);

  // 数字键 1~4 快捷选择
  useEffect(() => {
    if (disabled || editing || !choices.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const idx = '1234'.indexOf(e.key);
      if (idx >= 0 && idx < choices.length) {
        e.preventDefault();
        setPressedIdx(idx);
        window.setTimeout(() => onPick(choices[idx]), 220);
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
      <div className="rounded-md border border-gold/55 bg-parchment-900/45 p-4 shadow-glow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-xs tracking-[0.3em] text-gold/75 font-serif uppercase">编辑当前抉择</div>
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
        <div className="space-y-3">
          {draft.map((choice, index) => (
            <div key={`${choice.id}_${index}`} className="rounded border border-parchment-600/45 bg-parchment-800/55 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs text-gold-light font-serif tracking-wider">选项 {index + 1}</div>
                <button
                  type="button"
                  onClick={() => setDraft((items) => items.filter((_, i) => i !== index))}
                  className="rounded p-1 text-parchment-200/55 transition-colors hover:bg-blood/10 hover:text-blood"
                  title="删除此选项"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <textarea
                value={choice.label}
                onChange={(e) => updateDraft(index, { label: e.target.value })}
                className="w-full min-h-[64px] resize-y rounded-md border border-parchment-600/55 bg-ink/40 px-3 py-2 font-serif text-sm leading-relaxed text-parchment-50 outline-none focus:border-gold/80"
              />
              <input
                value={choice.hint ?? ''}
                onChange={(e) => updateDraft(index, { hint: e.target.value })}
                placeholder="标签，如：稳妥 / 冒险 / 社交"
                className="mt-2 w-full rounded-md border border-parchment-600/55 bg-ink/40 px-3 py-1.5 font-serif text-xs text-parchment-50 outline-none focus:border-gold/80 placeholder:text-parchment-200/35"
              />
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => { setDraft(choices); setEditing(false); }}>
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
      {choices.map((c, idx) => {
        const pressed = pressedIdx === idx;
        const hintColor = c.hint ? HINT_COLORS[c.hint] ?? 'text-parchment-200/65 border-parchment-500/40' : '';
        return (
          <button
            key={c.id}
            type="button"
            disabled={disabled}
            onClick={() => {
              if (disabled) return;
              setPressedIdx(idx);
              window.setTimeout(() => onPick(c), 200);
            }}
            className={clsx(
              'group relative flex items-start gap-3 rounded-md px-4 py-3.5 text-left',
              'border border-parchment-700/55 bg-parchment-900/55',
              'transition-colors duration-200 ease-out',
              'hover:border-gold-dark/80 hover:bg-parchment-900/75',
              'focus-visible:outline-none focus-visible:border-gold/65',
              disabled && 'opacity-50 pointer-events-none',
              pressed && 'border-gold/60 bg-parchment-800/85',
            )}
          >
            {/* 左侧细金线竖条（hover 时变亮） */}
            <span
              aria-hidden
              className="pointer-events-none absolute left-0 top-2 bottom-2 w-[1.5px] rounded-full bg-gold-dark/45 group-hover:bg-gold/70 transition-colors duration-200"
            />

            <div className="shrink-0 mt-0.5 flex h-7 w-7 items-center justify-center rounded-full border border-parchment-600/55 text-parchment-200/75 font-serif text-sm tabular-nums group-hover:text-gold-light group-hover:border-gold-dark/75 transition-colors duration-200">
              {idx + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-serif text-[15px] leading-relaxed text-parchment-100/95">{c.label}</div>
              {c.hint && (
                <span
                  className={clsx(
                    'mt-1.5 inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-serif tracking-[0.18em]',
                    'bg-ink/35',
                    hintColor,
                  )}
                >
                  {c.hint}
                </span>
              )}
            </div>
          </button>
        );
      })}
      {choices.length > 0 && (
        <div className="col-span-full text-center text-[10px] tracking-[0.3em] text-parchment-200/35 font-serif">
          按数字键 1-{choices.length} 选择
        </div>
      )}
    </div>
  );
}
