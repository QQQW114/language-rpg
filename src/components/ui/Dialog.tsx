import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { clsx } from '@/lib/utils';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  widthClass?: string;
}

export function Dialog({ open, onClose, title, children, widthClass = 'max-w-2xl' }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-ink/75 backdrop-blur-sm" />
      <div
        className={clsx(
          'relative w-full bg-parchment-800 border border-parchment-600/60 rounded-lg shadow-2xl',
          'animate-fade-in',
          widthClass,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-parchment-600/40">
          <div className="text-lg font-semibold text-gold-light tracking-wide">{title}</div>
          <button
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-parchment-700/60 text-parchment-200"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5 max-h-[75vh] overflow-auto">{children}</div>
      </div>
    </div>
  );
}
