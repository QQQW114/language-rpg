import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { clsx } from '@/lib/utils';
import { OrnateDivider } from './Ornaments';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  widthClass?: string;
  /** 是否在标题下方添加金线分隔（默认开） */
  divided?: boolean;
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  widthClass = 'max-w-2xl',
  divided = true,
}: DialogProps) {
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
      {/* 遮罩：黑底 + grain，不丢失底层氛围 */}
      <div
        className="absolute inset-0 bg-ink/80 backdrop-blur-md animate-fade-in"
        style={{
          backgroundImage:
            "radial-gradient(ellipse at center, rgba(74,56,32,0.15), transparent 70%)",
        }}
      />
      <div
        className={clsx(
          'relative w-full engraved-frame rounded-lg overflow-hidden',
          'animate-dialog-in',
          widthClass,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部金线装饰（较弱） */}
        <div className="pointer-events-none absolute inset-x-6 top-0 h-[1px] bg-gold-line opacity-55" />
        {/* 底部金线装饰 */}
        <div className="pointer-events-none absolute inset-x-6 bottom-0 h-[1px] bg-gold-line-dim opacity-50" />

        {(title !== undefined) && (
          <div className="flex items-center justify-between px-6 pt-4 pb-3">
            <div className="font-serif text-base font-semibold text-gold-light tracking-[0.08em]">{title}</div>
            <button
              className={clsx(
                'w-8 h-8 flex items-center justify-center rounded-full',
                'text-parchment-200/70 hover:text-gold-light',
                'hover:bg-parchment-700/40 transition-all duration-250',
              )}
              onClick={onClose}
              aria-label="关闭"
            >
              <X size={16} />
            </button>
          </div>
        )}
        {divided && title !== undefined && (
          <div className="px-6">
            <OrnateDivider className="!my-0 !mb-2" decoration="diamond" />
          </div>
        )}
        <div className={clsx('px-6 max-h-[75vh] overflow-auto', title !== undefined ? 'pb-5' : 'py-5')}>
          {children}
        </div>
      </div>
    </div>
  );
}
