import { useEffect } from 'react';
import type { Choice } from '@/types/game';
import { Card } from './ui/Card';
import { clsx } from '@/lib/utils';

interface ChoicePanelProps {
  choices: Choice[];
  disabled?: boolean;
  onPick: (choice: Choice) => void;
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

export function ChoicePanel({ choices, disabled, onPick }: ChoicePanelProps) {
  // 数字键 1~4 快捷选择
  useEffect(() => {
    if (disabled || !choices.length) return;
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
  }, [choices, disabled, onPick]);

  return (
    <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
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
