import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { SidePanelChangeKind } from '@/v2/sidePanelUpdates';

/**
 * 侧边栏块的信息更新特效。
 *
 * 视觉语言与项目其余部分一致：金色斜线（`gold` 系列色，与卡片边框、分隔线同源）
 * 自左向右扫过；掠过之处浮现本回合的新内容；同时几颗同色小星星原地转圈闪烁、
 * 随后慢慢淡去。原本不存在的块先用淡金线描出轮廓，再走同一套斜线 + 星星。
 *
 * 实现要点：
 *  - 覆盖层用 `pointer-events-none`，绝不吃掉卡片本身的点击（编辑、展开等）。
 *  - 特效是"只播一次"的：由 `changeKey` 变化触发，播完即卸载，不常驻 DOM。
 *  - 尊重 `prefers-reduced-motion`（全局 CSS 已把动画时长压到 0.001ms，
 *    这里额外在减弱动效时不渲染覆盖层，避免留下静止的金色残影）。
 */

const SPARKLE_GLYPHS = ['✦', '✧', '⋆', '✧', '✦'] as const;

/** 用固定序列而不是随机：同一块每次播放的位置一致，看起来是"设计好的"而非抖动。 */
const SPARKLE_POSITIONS: Array<{ left: string; top: string }> = [
  { left: '14%', top: '22%' },
  { left: '38%', top: '68%' },
  { left: '57%', top: '30%' },
  { left: '74%', top: '62%' },
  { left: '88%', top: '26%' },
  { left: '27%', top: '48%' },
];

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

function Sparkles({ seed }: { seed: number }) {
  return <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
    {SPARKLE_POSITIONS.slice(0, 5).map((position, index) => {
      const glyph = SPARKLE_GLYPHS[(index + seed) % SPARKLE_GLYPHS.length];
      const style: CSSProperties = {
        left: position.left,
        top: position.top,
        animationDelay: `${120 + index * 95}ms`,
      };
      return <span
        key={`${position.left}-${position.top}`}
        style={style}
        className="absolute select-none text-[11px] leading-none text-gold-light drop-shadow-[0_0_4px_rgba(201,165,102,0.55)] animate-sparkle"
      >{glyph}</span>;
    })}
  </div>;
}

function UpdateOverlay({ kind, seed }: { kind: SidePanelChangeKind; seed: number }) {
  return <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-[inherit]" aria-hidden>
    {/* 新块：先描出轮廓，说明"这里多了一块" */}
    {kind === 'new' && <div className="absolute inset-0 rounded-[inherit] border border-dashed border-gold/55 animate-update-outline" />}
    {/* 斜线扫过：中间亮、两端透明，掠过的区域即"新内容所在" */}
    <div
      className="absolute -inset-y-1 left-0 w-2/3 animate-update-sweep"
      style={{ backgroundImage: 'linear-gradient(90deg, transparent 0%, rgba(201,165,102,0.10) 28%, rgba(227,194,126,0.42) 50%, rgba(201,165,102,0.10) 72%, transparent 100%)' }}
    />
    <Sparkles seed={seed} />
  </div>;
}

export interface UpdateGlowProps {
  /** 该块的稳定标识，用于生成星星位置序列。 */
  blockId: string;
  /** 该块本回合的变化类型；`undefined` 表示没有变化（不播特效）。 */
  change?: SidePanelChangeKind;
  children: ReactNode;
  className?: string;
}

/**
 * 把任意侧边栏块包一层更新特效。`change` 由 `diffSidePanelChanges` 的结果给出；
 * 值变化时重新播放一次，播完自动卸载覆盖层。
 */
export function UpdateGlow({ blockId, change, children, className }: UpdateGlowProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [playing, setPlaying] = useState(false);
  const previousChange = useRef<SidePanelChangeKind | undefined>(undefined);

  useEffect(() => {
    if (!change) {
      previousChange.current = undefined;
      setPlaying(false);
      return;
    }
    // 同一块连续两轮都变化时也要重播，因此除了类型还要看"这是新的一次变化"。
    previousChange.current = change;
    setPlaying(true);
    const timer = window.setTimeout(() => setPlaying(false), 1500);
    return () => window.clearTimeout(timer);
    // blockId 变化说明换了一块（换存档/换标签），同样重播。
  }, [change, blockId]);

  const seed = blockId.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % SPARKLE_GLYPHS.length;

  return <div className={`relative ${className ?? ''}`}>
    {children}
    {playing && !reducedMotion && change ? <UpdateOverlay kind={change} seed={seed} /> : null}
  </div>;
}
