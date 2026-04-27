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

/**
 * 简洁可勾选的道具行，用于选项或手动输入阶段。
 * - "本回合获得"的道具（pendingGrantKey）高亮金光 + ✨
 * - "即将失去"的道具（pendingDestroy）划掉 + 红色 + 🚫，不可勾选
 * - 一次性 / 多次性 有不同色调区分
 */
export function ItemSelector({ items, selectedIds, onToggle, disabled }: ItemSelectorProps) {
  if (items.length === 0) return null;
  const selected = new Set(selectedIds);

  return (
    <div className="mb-3">
      <div className="text-xs tracking-[0.3em] text-gold/70 font-serif uppercase mb-2">
        可用道具 · 勾选以在本回合使用
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
                'group inline-flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all font-serif text-sm',
                'disabled:cursor-not-allowed',
                isDoomed
                  ? 'bg-blood/10 border-blood/60 text-parchment-200/50 line-through opacity-70'
                  : isSel
                  ? 'bg-gold/20 border-gold text-gold-light shadow-glow-sm'
                  : isPending
                  ? 'bg-parchment-900/60 border-gold/60 text-parchment-50 hover:border-gold hover:bg-parchment-900/80'
                  : 'bg-parchment-800/60 border-parchment-600/50 text-parchment-100 hover:border-gold/70',
                disabled && !isDoomed && 'opacity-50',
              )}
            >
              {isDoomed && <Ban size={12} className="text-blood" />}
              {!isDoomed && isPending && <Sparkle size={12} className="text-gold-light" />}
              <span>{it.name}</span>
              <span
                className={clsx(
                  'text-[10px] px-1.5 py-0.5 rounded',
                  isConsumable
                    ? 'bg-blood/20 text-blood border border-blood/40'
                    : 'bg-sky-500/10 text-sky-300/80 border border-sky-500/30',
                )}
              >
                {isConsumable ? '一次性' : '多次性'}
              </span>
              {isSel && !isDoomed && <Check size={12} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
