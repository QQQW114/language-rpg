import { useState } from 'react';
import { clsx } from '@/lib/utils';

export function ThinkToggle({
  content,
  label = 'think',
  title,
  className,
  compact = false,
}: {
  content?: string;
  label?: string;
  title?: string;
  className?: string;
  compact?: boolean;
}) {
  const text = content?.trim();
  const [open, setOpen] = useState(false);
  if (!text) return null;

  return (
    <div className={clsx('not-prose mt-2', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'inline-flex items-center rounded border border-parchment-600/35 bg-parchment-900/30 px-1.5 py-0.5 font-mono text-[10px] lowercase leading-none text-parchment-200/45 transition-colors hover:border-gold/45 hover:text-gold-light',
          open && 'border-gold/45 text-gold-light',
        )}
        title={title ?? (open ? `隐藏 ${label}` : `显示 ${label}`)}
      >
        {label}
      </button>
      {open && (
        <pre
          className={clsx(
            'mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded border border-parchment-600/35 bg-ink/55 p-3 font-mono leading-relaxed text-parchment-100/70 shadow-inner',
            compact ? 'text-[11px]' : 'text-xs',
          )}
        >
          {text}
        </pre>
      )}
    </div>
  );
}
