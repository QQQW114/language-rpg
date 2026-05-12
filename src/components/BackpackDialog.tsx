import { Dialog } from './ui/Dialog';
import type { Item } from '@/types/game';
import { itemTypeLabel } from '@/lib/items';
import { Package, Sparkle, Ban } from 'lucide-react';
import { clsx } from '@/lib/utils';

interface BackpackDialogProps {
  open: boolean;
  onClose: () => void;
  backpack: Item[];
  capacity?: number;
}

export function BackpackDialog({ open, onClose, backpack, capacity }: BackpackDialogProps) {
  const consumables = backpack.filter((i) => i.type === 'consumable');
  const reusables = backpack.filter((i) => i.type === 'reusable');

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Package size={18} /> 能力 ·{' '}
          <span className="font-normal">
            {backpack.length}
            {capacity !== undefined && <span className="text-parchment-200/60"> / {capacity}</span>} 项
          </span>
        </span>
      }
      widthClass="max-w-2xl"
    >
      {backpack.length === 0 ? (
        <div className="text-center text-parchment-200/60 py-10 font-serif">
          尚未获得任何能力。
        </div>
      ) : (
        <div className="space-y-5">
          {reusables.length > 0 && (
            <Section title="多次性" items={reusables} />
          )}
          {consumables.length > 0 && (
            <Section title="一次性" items={consumables} />
          )}
        </div>
      )}
    </Dialog>
  );
}

function Section({ title, items }: { title: string; items: Item[] }) {
  return (
    <section>
      <h3 className="text-xs tracking-[0.3em] text-gold-light uppercase mb-2 font-serif">· {title} · {items.length}</h3>
      <div className="space-y-2">
        {items.map((it) => {
          const doomed = !!it.pendingDestroy;
          return (
            <div
              key={it.id}
              className={clsx(
                'rounded-md border p-3',
                doomed
                  ? 'border-blood/60 bg-blood/10'
                  : it.pendingGrantKey
                  ? 'border-gold/70 bg-parchment-900/50 shadow-glow-sm'
                  : 'border-parchment-600/40 bg-parchment-800/60',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className={clsx(
                  'font-serif flex items-center gap-2',
                  doomed ? 'text-parchment-200/60 line-through' : 'text-parchment-50',
                )}>
                  {doomed && <Ban size={14} className="text-blood" />}
                  {!doomed && it.pendingGrantKey && <Sparkle size={14} className="text-gold-light" />}
                  {it.name}
                  <span className="text-xs text-parchment-200/60">（{itemTypeLabel(it.type)}）</span>
                  {doomed && (
                    <span className="text-[10px] text-blood tracking-wider uppercase">· 本回合将失效 ·</span>
                  )}
                  {!doomed && it.pendingGrantKey && (
                    <span className="text-[10px] text-gold-light tracking-wider uppercase">· 本回合获得 ·</span>
                  )}
                </div>
                <div className="text-xs text-parchment-200/50">第 {it.acquiredAtRound} 回合</div>
              </div>
              <div className={clsx(
                'text-sm mt-1 leading-relaxed',
                doomed ? 'text-parchment-200/50 line-through' : 'text-parchment-200/80',
              )}>
                {it.description}
              </div>
              {doomed && it.destroyReason && (
                <div className="mt-2 text-xs text-blood/90 italic border-l-2 border-blood/50 pl-2">
                  {it.destroyReason}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
