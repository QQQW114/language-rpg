import { useEffect, useRef, useState } from 'react';
import { clsx } from '@/lib/utils';

export type GoldLineState = 'extending' | 'steady' | 'retracting' | 'hidden';

interface GoldLineProps {
  /** 居中文字。空字符串则只显示一条线。 */
  text?: string;
  /** 受控状态。父组件改变它即触发对应动画。 */
  state?: GoldLineState;
  /** 中央装饰：none（默认） / wax（金蜡封） / waxRed（朱砂蜡封） */
  variant?: 'none' | 'wax' | 'waxRed';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** 字符 reveal 的逐字间隔（ms） */
  staggerMs?: number;
}

const SIZE_MAP = {
  sm: { text: 'text-[11px]', height: 'h-[1px]', gap: 'gap-2', wax: 16, padX: 'px-2' },
  md: { text: 'text-xs', height: 'h-[1.5px]', gap: 'gap-3', wax: 22, padX: 'px-3' },
  lg: { text: 'text-sm', height: 'h-[2px]', gap: 'gap-4', wax: 28, padX: 'px-4' },
};

/**
 * 金线 + 内嵌字 —— 整个游戏的核心 UI 语言。
 *
 * 状态：
 * - hidden     : 完全不可见
 * - extending  : 左线 origin-left scaleX(0→1) → 右线 → 字符逐个 reveal
 * - steady     : 完全显示，文字稳定
 * - retracting : 字符逐个 vanish（从右到左）→ 右线 origin-right scaleX(1→0) → 左线
 *
 * 时序由父组件控制（通过切换 state prop）。
 */
export function GoldLine({
  text = '',
  state = 'steady',
  variant = 'none',
  size = 'md',
  className,
  staggerMs = 35,
}: GoldLineProps) {
  const sz = SIZE_MAP[size];
  const chars = Array.from(text);
  const [phase, setPhase] = useState<GoldLineState>(state);
  const lastStateRef = useRef(state);

  useEffect(() => {
    if (state === lastStateRef.current) return;
    lastStateRef.current = state;
    setPhase(state);
  }, [state]);

  if (phase === 'hidden') return null;

  const isExtending = phase === 'extending';
  const isRetracting = phase === 'retracting';
  // steady = 直接呈现稳定态，不重播动画
  const lineLeftAnim = isExtending ? 'animate-line-in' : isRetracting ? 'animate-line-out' : '';
  const lineRightAnim = isExtending ? 'animate-line-in' : isRetracting ? 'animate-line-out' : '';

  return (
    <div
      className={clsx(
        'relative flex w-full items-center font-serif tracking-[0.2em] text-gold-light',
        sz.gap,
        sz.text,
        className,
      )}
      role="status"
      aria-live="polite"
    >
      {/* 左金线 */}
      <span
        aria-hidden
        className={clsx(
          'flex-1 origin-left bg-gold-line shadow-[0_0_8px_rgba(201,165,102,0.35)]',
          sz.height,
          lineLeftAnim,
        )}
        style={{ animationDelay: isExtending ? '0ms' : '180ms' }}
      />

      {/* 中央：可选蜡封 + 文字 */}
      {(text || variant !== 'none') && (
        <div className={clsx('relative inline-flex items-center justify-center', sz.padX)}>
          {variant !== 'none' && (
            <WaxBadge size={sz.wax} red={variant === 'waxRed'} />
          )}
          {text && (
            <span className={clsx('relative whitespace-nowrap', variant !== 'none' && 'ml-2')}>
              {chars.map((ch, i) => {
                const reverseIndex = chars.length - 1 - i;
                const charDelay = isExtending
                  ? 200 + i * staggerMs
                  : isRetracting
                  ? reverseIndex * staggerMs
                  : 0;
                return (
                  <span
                    key={`${ch}-${i}`}
                    className={clsx(
                      'inline-block',
                      isExtending && 'animate-char-reveal',
                      isRetracting && 'animate-char-vanish',
                    )}
                    style={{ animationDelay: `${charDelay}ms` }}
                  >
                    {ch === ' ' ? ' ' : ch}
                  </span>
                );
              })}
            </span>
          )}
        </div>
      )}

      {/* 右金线 */}
      <span
        aria-hidden
        className={clsx(
          'flex-1 origin-right bg-gold-line shadow-[0_0_8px_rgba(201,165,102,0.35)]',
          sz.height,
          lineRightAnim,
        )}
        style={{ animationDelay: isExtending ? '180ms' : '0ms' }}
      />
    </div>
  );
}

/** 中央嵌入的小蜡封圆斑（GoldLine 内部用） */
function WaxBadge({ size, red }: { size: number; red?: boolean }) {
  return (
    <span
      aria-hidden
      className={clsx(
        'pointer-events-none inline-block rounded-full',
        red ? 'bg-wax-seal' : 'bg-wax-seal-gold',
      )}
      style={{
        width: size,
        height: size,
        boxShadow:
          '0 0 0 1px rgba(0,0,0,0.45), inset 0 -1px 2px rgba(0,0,0,0.5), inset 0 1px 1px rgba(255,255,255,0.12), 0 0 18px rgba(201,165,102,0.35)',
      }}
    />
  );
}

/**
 * 简化用法：自动根据 visible 切换 extending / steady / retracting。
 * 父组件只需传入 visible 与 text，组件内部用 timer 编排时序。
 *
 * 时序：
 * - visible: false → true   = extending → steady（约 200ms + chars*stagger 后稳定）
 * - visible: true  → false  = retracting → hidden（动画结束后 unmount）
 */
interface AutoGoldLineProps extends Omit<GoldLineProps, 'state'> {
  visible: boolean;
}

export function AutoGoldLine({ visible, text = '', staggerMs = 35, ...rest }: AutoGoldLineProps) {
  const [state, setState] = useState<GoldLineState>(visible ? 'extending' : 'hidden');
  const prevVisible = useRef(visible);

  useEffect(() => {
    if (visible === prevVisible.current) return;
    prevVisible.current = visible;
    if (visible) {
      setState('extending');
      const totalIn = 200 + text.length * staggerMs + 600;
      const t = setTimeout(() => setState('steady'), totalIn);
      return () => clearTimeout(t);
    } else {
      setState('retracting');
      const totalOut = text.length * staggerMs + 700;
      const t = setTimeout(() => setState('hidden'), totalOut);
      return () => clearTimeout(t);
    }
  }, [visible, text.length, staggerMs]);

  return <GoldLine {...rest} text={text} state={state} staggerMs={staggerMs} />;
}
