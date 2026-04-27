interface RoundProgressProps {
  current: number;
  total: number;   // 0 表示无尽模式
}

export function RoundProgress({ current, total }: RoundProgressProps) {
  const infinite = !total || total <= 0;
  const pct = infinite ? 0 : Math.min(100, Math.round((current / Math.max(total, 1)) * 100));
  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between text-xs text-parchment-200/70 mb-1 font-serif tracking-wider">
        <span>
          第 <span className="text-gold-light text-base font-semibold">{current}</span>
          {infinite ? (
            <span className="ml-1">回合 · <span className="text-gold-light text-base">∞</span></span>
          ) : (
            <>
              <span className="mx-1 opacity-60">/</span>
              <span>{total}</span> 回合
            </>
          )}
        </span>
        <span>{infinite ? '无尽' : `${pct}%`}</span>
      </div>
      <div className="relative h-1.5 bg-parchment-900/70 rounded-full overflow-hidden border border-parchment-600/40">
        {infinite ? (
          <div
            className="absolute inset-0 bg-gradient-to-r from-parchment-700 via-gold/50 to-parchment-700 bg-[length:200%_100%] animate-shimmer opacity-60"
            style={{
              backgroundImage: 'linear-gradient(90deg, transparent, rgba(201,165,102,0.6), transparent)',
            }}
          />
        ) : (
          <>
            <div
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-gold-dark via-gold to-gold-light transition-all duration-700"
              style={{ width: `${pct}%` }}
            />
            <div className="absolute inset-0 bg-[length:200%_100%] animate-shimmer opacity-30"
              style={{
                backgroundImage: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)',
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
