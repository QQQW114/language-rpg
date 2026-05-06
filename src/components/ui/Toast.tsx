import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XOctagon } from 'lucide-react';
import { clsx } from '@/lib/utils';
import { subscribeToasts, toast, type ToastItem, type ToastKind } from '@/lib/toast';

const KIND_STYLES: Record<
  ToastKind,
  { border: string; icon: typeof Info; iconColor: string; ring: string }
> = {
  info: {
    border: 'border-parchment-500/50',
    icon: Info,
    iconColor: 'text-gold-light',
    ring: 'shadow-glow-sm',
  },
  success: {
    border: 'border-moss-light/50',
    icon: CheckCircle2,
    iconColor: 'text-moss-light',
    ring: 'shadow-[0_0_18px_rgba(138,154,115,0.35)]',
  },
  warn: {
    border: 'border-ember/55',
    icon: AlertTriangle,
    iconColor: 'text-ember-light',
    ring: 'shadow-[0_0_16px_rgba(194,98,42,0.35)]',
  },
  danger: {
    border: 'border-blood/65',
    icon: XOctagon,
    iconColor: 'text-blood',
    ring: 'shadow-blood-glow',
  },
};

/**
 * 全局 toast 容器。在根组件挂一次。
 * 右上角栈，最多 4 条；进入用 slide-in-right；离场前 fade。
 */
export function ToastViewport() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => subscribeToasts(setItems), []);

  if (items.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="通知"
      className="pointer-events-none fixed top-4 right-4 z-[60] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2"
    >
      {items.map((it) => (
        <ToastRow key={it.id} item={it} />
      ))}
    </div>
  );
}

function ToastRow({ item }: { item: ToastItem }) {
  const styles = KIND_STYLES[item.kind];
  const Icon = styles.icon;
  // 接近过期时切换到 fade-out
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const remaining = Math.max(200, item.createdAt + item.durationMs - Date.now() - 300);
    const t = window.setTimeout(() => setLeaving(true), remaining);
    return () => window.clearTimeout(t);
  }, [item.createdAt, item.durationMs]);

  return (
    <div
      className={clsx(
        'pointer-events-auto relative overflow-hidden rounded-md border bg-ink/90 backdrop-blur-md',
        'paper-card',
        styles.border,
        styles.ring,
        leaving ? 'animate-slide-out-right' : 'animate-slide-in-right',
      )}
      role="status"
    >
      {/* 顶部金线 */}
      <div className="absolute inset-x-3 top-0 h-px bg-gold-line opacity-70" />
      {/* 底部金线 */}
      <div className="absolute inset-x-3 bottom-0 h-px bg-gold-line-dim" />
      <div className="flex items-start gap-3 px-4 py-3">
        <Icon size={16} className={clsx('mt-0.5 shrink-0', styles.iconColor)} />
        <div className="flex-1 min-w-0 font-serif text-sm leading-relaxed text-parchment-100 break-words">
          {item.message}
        </div>
        <button
          type="button"
          onClick={() => toast.dismiss(item.id)}
          aria-label="关闭通知"
          className="shrink-0 -mt-1 -mr-1 rounded p-1 text-parchment-200/50 transition-colors hover:bg-parchment-700/40 hover:text-gold-light"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
