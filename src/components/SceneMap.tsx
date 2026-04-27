import type { SceneRef } from '@/types/game';
import { Compass, CornerDownRight, MapPin } from 'lucide-react';
import { clsx } from '@/lib/utils';

interface SceneMapProps {
  current?: SceneRef;
  available: SceneRef[];
  onTravel: (scene: SceneRef) => void;
  disabled?: boolean;
}

/**
 * 当前场景 + 可前往场景的紧凑可视化。
 * 仅绘制与当前场景直接相邻的节点（由决策模型每轮返回）。
 */
export function SceneMap({ current, available, onTravel, disabled }: SceneMapProps) {
  if (!current && available.length === 0) return null;

  return (
    <section>
      <h3 className="flex items-center gap-2 text-gold-light tracking-wider mb-2 text-xs uppercase">
        <Compass size={14} /> 场景
      </h3>

      {current && (
        <div className="relative rounded-md border border-gold/60 bg-parchment-900/50 shadow-glow-sm px-3 py-2.5 mb-2">
          <div className="flex items-center gap-2 text-gold-light font-serif text-sm">
            <MapPin size={14} />
            <span className="flex-1 truncate">{current.name}</span>
            <span className="text-[9px] text-gold/70 tracking-[0.3em] uppercase">当前</span>
          </div>
          {current.description && (
            <div className="text-[11px] text-parchment-200/70 italic mt-0.5 leading-relaxed line-clamp-2">
              {current.description}
            </div>
          )}
        </div>
      )}

      {available.length > 0 && (
        <>
          <div className="flex items-center gap-1 mb-1 pl-2 text-[10px] text-parchment-200/50 tracking-wider">
            <CornerDownRight size={10} />
            <span>可前往 · {available.length}</span>
          </div>
          <div className="space-y-1.5">
            {available.map((sc) => (
              <button
                key={sc.name}
                type="button"
                disabled={disabled}
                onClick={() => onTravel(sc)}
                className={clsx(
                  'w-full text-left rounded-md border px-3 py-2 transition-all group',
                  'bg-parchment-800/60 border-parchment-600/50 text-parchment-100',
                  'hover:border-gold/70 hover:bg-parchment-800 hover:shadow-glow-sm',
                  'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-parchment-600/50 disabled:hover:shadow-none',
                )}
                title={`前往 ${sc.name}${sc.description ? '：' + sc.description : ''}`}
              >
                <div className="flex items-center gap-2 font-serif text-sm">
                  <span className="text-gold/60 group-hover:text-gold-light transition-colors">→</span>
                  <span className="flex-1 truncate">{sc.name}</span>
                </div>
                {sc.description && (
                  <div className="text-[11px] text-parchment-200/60 italic mt-0.5 leading-snug line-clamp-2 pl-5">
                    {sc.description}
                  </div>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
