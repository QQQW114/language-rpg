import { useMemo, useState } from 'react';
import { Dialog } from './ui/Dialog';
import { Button } from './ui/Button';
import { AlertTriangle, Trash2 } from 'lucide-react';
import type { Item } from '@/types/game';
import { itemTypeLabel } from '@/lib/items';
import { clsx } from '@/lib/utils';

interface DiscardDialogProps {
  open: boolean;
  backpack: Item[];
  capacity: number;
  onConfirm: (itemIdsToDiscard: string[]) => void;
}

/**
 * 能力超载时的强制舍弃对话框。
 * 无法关闭，直到选够需要舍弃的数量。
 */
export function DiscardDialog({ open, backpack, capacity, onConfirm }: DiscardDialogProps) {
  const [picked, setPicked] = useState<string[]>([]);
  const overflow = Math.max(0, backpack.length - capacity);
  const pickedSet = useMemo(() => new Set(picked), [picked]);

  const toggle = (id: string) => {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const remaining = Math.max(0, overflow - picked.length);
  const canConfirm = picked.length >= overflow && overflow > 0;

  return (
    <Dialog
      open={open}
      onClose={() => { /* 强制流程：不可通过 ESC / 背景关闭 */ }}
      title={
        <span className="flex items-center gap-2">
          <AlertTriangle size={18} className="text-blood" /> 能力超载
        </span>
      }
      widthClass="max-w-2xl"
    >
      <div className="text-sm text-parchment-200/80 mb-4 leading-relaxed font-serif">
        当前能力 <span className="text-gold-light">{backpack.length}</span> 项，容量上限 <span className="text-gold-light">{capacity}</span>。
        请至少舍弃 <span className="text-blood font-semibold">{overflow}</span> 项后继续旅程。
      </div>

      <div className="space-y-2 max-h-[50vh] overflow-auto pr-1">
        {backpack.map((it) => {
          const isPicked = pickedSet.has(it.id);
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => toggle(it.id)}
              className={clsx(
                'w-full text-left rounded-md border p-3 transition-all',
                isPicked
                  ? 'border-blood/80 bg-blood/10 shadow-[0_0_12px_rgba(138,47,47,0.35)]'
                  : 'border-parchment-600/40 bg-parchment-800/60 hover:border-gold/60',
                it.pendingGrantKey && !isPicked && 'border-gold/60',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="font-serif text-parchment-50 flex items-center gap-2">
                  {isPicked && <Trash2 size={14} className="text-blood" />}
                  {it.name}
                  <span className="text-xs text-parchment-200/60">（{itemTypeLabel(it.type)}）</span>
                  {it.pendingGrantKey && (
                    <span className="text-[10px] text-gold-light tracking-wider uppercase">· 本回合获得 ·</span>
                  )}
                </div>
                <div className="text-xs text-parchment-200/50">第 {it.acquiredAtRound} 回合</div>
              </div>
              <div className="text-xs text-parchment-200/70 mt-1 leading-relaxed">{it.description}</div>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="text-sm font-serif">
          已选 <span className="text-blood">{picked.length}</span> 项
          {remaining > 0 && <> · 还需再舍弃 <span className="text-blood">{remaining}</span> 项</>}
        </div>
        <Button
          variant="danger"
          disabled={!canConfirm}
          onClick={() => {
            onConfirm(picked);
            setPicked([]);
          }}
        >
          <Trash2 size={14} /> 确认舍弃
        </Button>
      </div>
    </Dialog>
  );
}
