import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { SidePanelChangeKind } from '@/v2/sidePanelUpdates';

/**
 * 侧边栏块的信息更新特效。
 *
 * 视觉语言与项目其余部分一致：金色斜线（`gold` 系列色，与卡片边框、分隔线同源）
 * 自左向右扫过；掠过之处浮现本回合的新内容；随后几颗同色小星星原地转圈、闪烁、
 * 慢慢淡去。原本不存在的块先用淡金线描出轮廓，再走同一套斜线 + 星星。
 *
 * ## 两个必须这样做的地方（曾经踩过）
 *
 * 1. **不能给块外面套一层 div。** 侧边栏用的是 `space-y-*` 与 flex 布局，
 *    它们依赖"直接子元素"关系；多包一层会打断间距计算、改变 flex 子项，
 *    于是覆盖层画出的大小与卡片实际大小不一致——表现就是"特效错位"。
 *    这里用 `display: contents` 让包装层不产生盒子，子元素仍是原父容器的直接子元素。
 * 2. **覆盖层改用 portal 挂到 body。** 上面那条的代价是包装层不再是定位祖先，
 *    `absolute inset-0` 会锚到更上层。因此覆盖层由 portal 渲染，并按目标元素的
 *    实测矩形（`getBoundingClientRect`）定位；滚动与窗口尺寸变化时重新测量。
 *
 * ## 动画分步播放
 *
 * 四拍依次进行，总时长约 2.4s：
 *   ① 0ms      新块先用金线描出轮廓
 *   ② 180ms    斜线自左向右扫过（约 850ms）
 *   ③ 780ms 起 五颗小星星依次出现，各 900ms 转圈闪烁后淡出
 *   ④ 2360ms   覆盖层整体退场，DOM 里不留残留
 * 逐步的延迟写在行内 style 上（Tailwind 的任意值语法不好表达"每颗一个延迟"）。
 */

const SPARKLE_GLYPHS = ['✦', '✧', '⋆', '✧', '✦'] as const;

/** 星星位置用固定序列而不是随机：同一块每次播放的位置一致，看起来是设计好的而非抖动。 */
const SPARKLE_POSITIONS: Array<{ left: string; top: string }> = [
  { left: '13%', top: '24%' },
  { left: '34%', top: '70%' },
  { left: '52%', top: '28%' },
  { left: '71%', top: '64%' },
  { left: '87%', top: '30%' },
];

/** 四拍时间轴（ms）。 */
export const UPDATE_TIMELINE = {
  outlineStart: 0,
  sweepStart: 180,
  sparkleStart: 780,
  sparkleStagger: 130,
  sparkleDuration: 900,
  total: 2400,
} as const;

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

interface OverlayBox {
  left: number;
  top: number;
  width: number;
  height: number;
  radius: string;
}

/**
 * 覆盖层：portal 到 body，按目标元素的实测矩形定位。
 *
 * 定位用 `position: fixed` + `getBoundingClientRect()` 的视口坐标，
 * 因此不受侧边栏自身滚动容器的影响；滚动与 resize 时重新测量。
 */
function UpdateOverlay({ target, kind, seed, onDone }: {
  target: HTMLElement;
  kind: SidePanelChangeKind;
  seed: number;
  onDone: () => void;
}) {
  const [box, setBox] = useState<OverlayBox | undefined>(undefined);

  useLayoutEffect(() => {
    const measure = () => {
      if (!target.isConnected) {
        onDone();
        return;
      }
      const rect = target.getBoundingClientRect();
      const radius = window.getComputedStyle(target).borderTopLeftRadius || '12px';
      setBox({ left: rect.left, top: rect.top, width: rect.width, height: rect.height, radius });
    };
    measure();
    window.addEventListener('scroll', measure, { passive: true, capture: true });
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [target, onDone]);

  if (!box) return null;

  const style: CSSProperties = {
    position: 'fixed',
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    borderRadius: box.radius,
  };

  return <div style={style} className="pointer-events-none z-30 overflow-hidden" aria-hidden>
    {/* ① 新块：先用金线描出轮廓，说明"这里多了一块" */}
    {kind === 'new' && <div
      className="absolute inset-0 animate-update-outline border border-dashed border-gold/60"
      style={{ borderRadius: box.radius, animationDelay: `${UPDATE_TIMELINE.outlineStart}ms` }}
    />}
    {/* ② 斜线扫过：中间亮、两端透明，掠过的区域即"新内容所在" */}
    <div
      className="absolute -inset-y-1 left-0 w-2/3 animate-update-sweep"
      style={{
        animationDelay: `${UPDATE_TIMELINE.sweepStart}ms`,
        backgroundImage: 'linear-gradient(90deg, transparent 0%, rgba(201,165,102,0.10) 28%, rgba(227,194,126,0.46) 50%, rgba(201,165,102,0.10) 72%, transparent 100%)',
      }}
    />
    {/* ③ 小星星：依次出现，各自转圈闪烁后淡出 */}
    {SPARKLE_POSITIONS.map((position, index) => (
      <span
        key={`${position.left}-${position.top}`}
        style={{
          left: position.left,
          top: position.top,
          animationDelay: `${UPDATE_TIMELINE.sparkleStart + index * UPDATE_TIMELINE.sparkleStagger}ms`,
        }}
        className="absolute select-none text-[11px] leading-none text-gold-light drop-shadow-[0_0_4px_rgba(201,165,102,0.55)] animate-sparkle"
      >{SPARKLE_GLYPHS[(index + seed) % SPARKLE_GLYPHS.length]}</span>
    ))}
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
 * 把侧边栏块包一层更新特效。
 *
 * 包装层是 `display: contents`（不产生盒子），所以**不会影响任何布局**：
 * 子元素仍然算作原父容器的直接子元素，`space-y-*` 的间距与 flex 子项关系都保持不变。
 * 覆盖层通过 portal 挂到 body，按目标元素实测矩形定位。
 */
export function UpdateGlow({ blockId, change, children, className }: UpdateGlowProps) {
  const reducedMotion = usePrefersReducedMotion();
  const hostRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [target, setTarget] = useState<HTMLElement | undefined>(undefined);

  useEffect(() => {
    if (!change) {
      setPlaying(false);
      setTarget(undefined);
      return;
    }
    setPlaying(true);
    // 包一层里的第一个元素就是卡片本体；display:contents 下它就是我们要测量的目标。
    setTarget((hostRef.current?.firstElementChild as HTMLElement | null) ?? undefined);
    const timer = window.setTimeout(() => setPlaying(false), UPDATE_TIMELINE.total);
    return () => window.clearTimeout(timer);
    // blockId 变化说明换了一块（换存档/换标签），同样重播。
  }, [change, blockId]);

  const seed = blockId.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % SPARKLE_GLYPHS.length;
  const canPortal = typeof document !== 'undefined';

  return <>
    <div ref={hostRef} className={className} style={{ display: 'contents' }}>{children}</div>
    {playing && !reducedMotion && change && target && canPortal
      ? createPortal(<UpdateOverlay target={target} kind={change} seed={seed} onDone={() => setPlaying(false)} />, document.body)
      : null}
  </>;
}
