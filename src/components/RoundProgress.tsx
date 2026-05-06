import { clsx } from '@/lib/utils';

interface RoundProgressProps {
  current: number;
  total: number; // 0 表示无尽模式
}

export function RoundProgress({ current, total }: RoundProgressProps) {
  const infinite = !total || total <= 0;
  const pct = infinite ? 0 : Math.min(100, Math.round((current / Math.max(total, 1)) * 100));

  return (
    <div className="w-full">
      <div className="flex items-center gap-3 font-serif text-[11px] tracking-[0.18em] text-parchment-200/65">
        <span aria-hidden className="flex-1 h-px bg-gold-line opacity-50" />
        <span className="whitespace-nowrap">
          第&nbsp;
          <span className="text-gold-light/85 text-[13px] font-semibold tabular-nums">{current}</span>
          {infinite ? (
            <>
              &nbsp;回 · <span className="text-gold-light/85 text-[13px]">∞</span>
            </>
          ) : (
            <>
              <span className="mx-1 opacity-50">/</span>
              <span className="text-parchment-100/85 tabular-nums">{total}</span>
              &nbsp;回&nbsp;·&nbsp;
              <span className="text-gold-light/85 tabular-nums">{pct}%</span>
            </>
          )}
        </span>
        <span aria-hidden className="flex-1 h-px bg-gold-line opacity-50" />
      </div>

      {!infinite && (
        <div className={clsx(
          'mt-1.5 h-[2px] rounded-full overflow-hidden',
          'bg-parchment-900/70 border border-parchment-700/45',
        )}>
          <div
            className="h-full bg-gradient-to-r from-gold-dark/80 to-gold/85 transition-[width] duration-700 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
