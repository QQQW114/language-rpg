import type { Npc } from '@/types/game';
import { clsx } from '@/lib/utils';
import { Users } from 'lucide-react';

function affinityColor(aff: number): string {
  if (aff >= 70) return 'text-rose-300 border-rose-400/60 bg-rose-500/10';
  if (aff >= 40) return 'text-pink-300 border-pink-400/60 bg-pink-500/10';
  if (aff >= 10) return 'text-amber-300 border-amber-400/60 bg-amber-500/10';
  if (aff > -10) return 'text-parchment-200 border-parchment-500/40 bg-parchment-800/60';
  if (aff > -40) return 'text-sky-300 border-sky-400/50 bg-sky-500/10';
  if (aff > -70) return 'text-orange-300 border-orange-400/60 bg-orange-500/10';
  return 'text-red-400 border-red-500/70 bg-red-900/20';
}

function affinityLabel(aff: number): string {
  if (aff >= 80) return '挚爱';
  if (aff >= 60) return '深厚';
  if (aff >= 30) return '好感';
  if (aff >= 10) return '熟识';
  if (aff > -10) return '相识';
  if (aff > -30) return '疏离';
  if (aff > -60) return '敌意';
  return '仇恨';
}

interface NpcListProps {
  npcs: Npc[];
  onOpenAll?: () => void;
}

export function NpcList({ npcs, onOpenAll }: NpcListProps) {
  if (!npcs?.length) return null;
  const sorted = [...npcs].sort((a, b) => {
    // 活跃优先 + 绝对值好感大的优先
    const activityA = a.lastRound;
    const activityB = b.lastRound;
    if (activityA !== activityB) return activityB - activityA;
    return Math.abs(b.affinity) - Math.abs(a.affinity);
  }).slice(0, 6);

  return (
    <section>
      <h3 className="flex items-center justify-between text-gold-light tracking-wider mb-2 text-xs uppercase">
        <span className="flex items-center gap-2"><Users size={14} /> 人物关系 · {npcs.length}</span>
        {onOpenAll && npcs.length > 6 && (
          <button onClick={onOpenAll} className="text-[10px] text-parchment-200/60 hover:text-gold-light underline">
            全部
          </button>
        )}
      </h3>
      <div className="space-y-1.5">
        {sorted.map((n) => (
          <div
            key={n.id}
            className="flex items-center justify-between gap-2 bg-parchment-800/60 border border-parchment-600/40 rounded px-2 py-1.5"
            title={`${n.description ?? ''}${n.details?.length ? '\n细节：' + n.details.join('、') : ''}${n.recentNote ? '\n最近：' + n.recentNote : ''}`}
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm text-parchment-50 font-serif truncate">
                {n.name}
                {n.role && <span className="text-xs text-parchment-200/60 ml-1">· {n.role}</span>}
              </div>
              {n.recentNote && (
                <div className="text-[11px] text-parchment-200/60 italic truncate">{n.recentNote}</div>
              )}
              {n.details?.length ? (
                <div className="text-[10px] text-gold/60 truncate">{n.details.slice(0, 2).join(' · ')}</div>
              ) : null}
            </div>
            <span
              className={clsx(
                'text-[10px] px-2 py-0.5 rounded-full border whitespace-nowrap',
                affinityColor(n.affinity),
              )}
            >
              {affinityLabel(n.affinity)} {n.affinity > 0 ? '+' : ''}{n.affinity}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
