import { Dialog } from './ui/Dialog';
import type { Npc } from '@/types/game';
import { Users } from 'lucide-react';
import { clsx } from '@/lib/utils';

function barColor(aff: number): string {
  if (aff >= 40) return 'bg-gradient-to-r from-pink-400 to-rose-400';
  if (aff >= 10) return 'bg-gradient-to-r from-amber-400 to-amber-300';
  if (aff > -10) return 'bg-parchment-500/60';
  if (aff > -40) return 'bg-gradient-to-r from-sky-400 to-sky-500';
  return 'bg-gradient-to-r from-orange-500 to-red-500';
}

interface NpcDialogProps {
  open: boolean;
  onClose: () => void;
  npcs: Npc[];
}

export function NpcDialog({ open, onClose, npcs }: NpcDialogProps) {
  const sorted = [...npcs].sort((a, b) => b.lastRound - a.lastRound);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={<span className="flex items-center gap-2"><Users size={18} /> 人物志 · 共 {npcs.length} 人</span>}
      widthClass="max-w-3xl"
    >
      {npcs.length === 0 ? (
        <div className="text-center text-parchment-200/60 py-10 font-serif">尚未结识任何角色。</div>
      ) : (
        <div className="space-y-3">
          {sorted.map((n) => {
            const pct = (n.affinity + 100) / 2;   // -100..100 → 0..100
            return (
              <div key={n.id} className="rounded-md border border-parchment-600/40 bg-parchment-800/60 p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <div>
                    <span className="font-serif text-lg text-parchment-50">{n.name}</span>
                    {n.role && <span className="ml-2 text-xs text-gold/70">· {n.role}</span>}
                  </div>
                  <div className="text-xs text-parchment-200/60">
                    第 {n.firstRound} → {n.lastRound} 回合 · 出场 {n.appearances} 次
                  </div>
                </div>
                {n.description && (
                  <div className="text-sm text-parchment-200/80 mt-1 leading-relaxed">{n.description}</div>
                )}
                {n.details?.length ? (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {n.details.map((detail) => (
                      <span
                        key={detail}
                        className="text-[11px] px-2 py-0.5 rounded-full border border-gold/30 bg-parchment-900/50 text-parchment-100"
                      >
                        {detail}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs font-serif mb-1">
                    <span className="text-parchment-200/60">好感度</span>
                    <span className="text-gold-light">{n.affinity > 0 ? '+' : ''}{n.affinity}</span>
                  </div>
                  <div className="relative h-1.5 rounded-full bg-parchment-900/70 overflow-hidden">
                    <div
                      className={clsx('absolute inset-y-0 transition-all', barColor(n.affinity))}
                      style={{
                        left: n.affinity >= 0 ? '50%' : `${pct}%`,
                        width: `${Math.abs(n.affinity) / 2}%`,
                      }}
                    />
                    <div className="absolute inset-y-0 left-1/2 w-px bg-parchment-500/40" />
                  </div>
                </div>
                {n.recentNote && (
                  <div className="mt-2 text-xs italic text-parchment-200/70 border-l-2 border-gold/40 pl-2">
                    最近：{n.recentNote}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}
