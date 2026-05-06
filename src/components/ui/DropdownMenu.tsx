import React, { useEffect, useRef, useState } from 'react';
import { clsx } from '@/lib/utils';

export interface DropdownMenuItem {
  id: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  tone?: 'normal' | 'gold' | 'danger';
  disabled?: boolean;
  onClick: () => void;
}

interface DropdownMenuProps {
  trigger: React.ReactNode;
  items: DropdownMenuItem[];
  align?: 'left' | 'right';
  /** 触发器与下拉的间距 */
  gap?: number;
}

/**
 * 黑底金边的下拉菜单。点击 trigger 切换；点外部 / Esc 收起。
 * 不依赖 portal —— 直接 absolute 在 trigger 容器内。
 */
export function DropdownMenu({ trigger, items, align = 'right', gap = 6 }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'inline-flex items-center justify-center rounded-md transition-all',
          'hover:text-gold-light hover:bg-parchment-700/40',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60',
          open && 'text-gold-light bg-parchment-700/40',
        )}
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          style={{ marginTop: gap }}
          className={clsx(
            'absolute z-40 min-w-[200px] rounded-md border border-gold/45 paper-card',
            'shadow-foil overflow-hidden animate-dialog-in',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          <div className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gold-line opacity-80" />
          <div className="pointer-events-none absolute inset-x-3 bottom-0 h-px bg-gold-line-dim" />
          <ul className="py-1">
            {items.map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  role="menuitem"
                  disabled={it.disabled}
                  onClick={() => {
                    if (it.disabled) return;
                    it.onClick();
                    setOpen(false);
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2.5 px-3.5 py-2 text-sm font-serif transition-all duration-200',
                    it.tone === 'gold'
                      ? 'text-gold-light hover:bg-gold/10'
                      : it.tone === 'danger'
                      ? 'text-blood/95 hover:bg-blood/10'
                      : 'text-parchment-100 hover:bg-parchment-700/45 hover:text-gold-light',
                    it.disabled && 'opacity-40 cursor-not-allowed',
                  )}
                >
                  {it.icon && <span className="shrink-0">{it.icon}</span>}
                  <span className="flex-1 text-left whitespace-nowrap">{it.label}</span>
                  {it.badge !== undefined && (
                    <span className="text-[10px] tracking-wider text-parchment-200/65 shrink-0">{it.badge}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
