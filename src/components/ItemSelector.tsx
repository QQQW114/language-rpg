import type { Item } from '@/types/game';
import { itemTypeLabel } from '@/lib/items';
import { clsx } from '@/lib/utils';
import { Sparkle, Check, Ban } from 'lucide-react';

interface ItemSelectorProps {
  items: Item[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  disabled?: boolean;
}

export function ItemSelector({ items, selectedIds, onToggle, disabled }: ItemSelectorProps) {
  if (items.length === 0) return null;
  const selected = new Set(selectedIds);

  return (
    <div className="mb-3">
      <div className="mb-2 text-[10px] tracking-[0.3em] text-parchment-200/55 font-serif uppercase">
        器物 · 勾选以在本回合使用
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((it) => {
          const isSel = selected.has(it.id);
          const isConsumable = it.type === 'consumable';
          const isPending = !!it.pendingGrantKey;
          const isDoomed = !!it.pendingDestroy;
          return (
            <button
              key={it.id}
              type="button"
              disabled={disabled || isDoomed}
              onClick={() => onToggle(it.id)}
              title={
                isDoomed
                  ? `${it.name}（本回合将失去${it.destroyReason ? '：' + it.destroyReason : ''}）`
                  : `${it.name}（${itemTypeLabel(it.type)}）: ${it.description}`
              }
              className={clsx(
                'inline-flex items-center gap-2 px-3 py-1.5 rounded-md border font-serif text-sm',
                'transition-colors duration-200',
                'disabled:cursor-not-allowed',
                isDoomed
                  ? 'bg-blood/10 border-blood/45 text-parchment-200/55 line-through opacity-75'
                  : isSel
                  ? 'bg-gold/12 border-gold/65 text-gold-light'
                  : isPending
                  ? 'bg-parchment-900/55 border-gold-dark/55 text-parchment-100 hover:border-gold/55'
                  : 'bg-parchment-900/55 border-parchment-700/55 text-parchment-100 hover:border-gold-dark/70',
                disabled && !isDoomed && 'opacity-55',
              )}
            >
              {isDoomed && <Ban size={12} className="text-blood" />}
              {!isDoomed && isPending && <Sparkle size={12} className="text-gold-light" />}
              <span>{it.name}</span>
              <span
                className={clsx(
                  'inline-flex items-center justify-center text-[10px] px-1.5 py-0.5 rounded border tracking-wider',
                  isConsumable
                    ? 'bg-blood/15 text-blood/95 border-blood/40'
                    : 'bg-moss/15 text-moss-light border-moss/40',
                )}
              >
                {isConsumable ? '一次性' : '多次性'}
              </span>
              {isSel && !isDoomed && <Check size={12} className="text-gold-light" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
