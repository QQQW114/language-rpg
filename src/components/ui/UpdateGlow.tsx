import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { SidePanelChangeKind } from '@/v2/sidePanelUpdates';

/**
 * 侧边栏块的信息更新特效（强化版 · 五层同源金线编排）。
 *
 * 在保留原有「暗金古书 + 金线扫掠 + 星芒闪烁」视觉语言与契约的基础上，
 * 将特效从单一渐变条升级为五层精密编排：
 *   ① 0ms      SVG 双轨流光金线沿卡片边框顺时针疾速描摹闭合 + 四角星铆点亮
 *              （`new` 块额外叠加内圈虚线描边与暗金内晕，强调「新卷入册」）
 *   ② 180ms    主光刃（1.5px 高亮金锋）+ 柔光宽带 + 残影副刃呈 -18° 斜向划过
 *   ③ 260ms    右上角浮现微缩古籍批注印记（`✦ 新录` / `✧ 演化`），随光刃点亮后隐去
 *   ④ 780ms 起 七曜星芒与微金尘粒依次浮现，原地旋转闪烁并向上微飘消散
 *   ⑤ 2400ms   覆盖层完整卸载，DOM 零残留
 *
 * ## 架构约束（严格保持）
 * 1. 包装层使用 `display: contents`，绝不破坏父级 `space-y-*` 或 flex 布局。
 * 2. 覆盖层通过 `createPortal` 挂载到 `document.body`，使用 `position: fixed` +
 *    `getBoundingClientRect()` + `ResizeObserver` 实时追踪位置与尺寸。
 * 3. 全程 `pointer-events-none`，绝不拦截卡片点击、折叠或编辑操作。
 * 4. 严格尊重 `prefers-reduced-motion: reduce`（开启减弱动效时不渲染覆盖层）。
 */

const SPARKLE_GLYPHS = ['✦', '✧', '⋆', '✵', '✦', '✧', '⋆'] as const;

/**
 * 七曜星芒位置序列（固定确定性坐标 + 微漂移向量，保证同一块每次播放如设计手稿般稳定，不抖动）。
 */
const SPARKLE_POSITIONS: Array<{
  left: string;
  top: string;
  driftX: string;
  driftY: string;
  size: number;
}> = [
  { left: '12%', top: '26%', driftX: '3px', driftY: '-8px', size: 12 },
  { left: '28%', top: '72%', driftX: '-2px', driftY: '-10px', size: 10 },
  { left: '44%', top: '22%', driftX: '4px', driftY: '-7px', size: 13 },
  { left: '58%', top: '66%', driftX: '-3px', driftY: '-9px', size: 11 },
  { left: '73%', top: '30%', driftX: '2px', driftY: '-11px', size: 12 },
  { left: '84%', top: '68%', driftX: '-4px', driftY: '-8px', size: 10 },
  { left: '91%', top: '24%', driftX: '2px', driftY: '-6px', size: 11 },
];

/** 微金尘粒：伴随主光刃升起的极细金粉点。 */
const DUST_MOTES: Array<{ left: string; top: string; delayOffset: number }> = [
  { left: '22%', top: '54%', delayOffset: 60 },
  { left: '49%', top: '48%', delayOffset: 190 },
  { left: '67%', top: '58%', delayOffset: 310 },
  { left: '82%', top: '44%', delayOffset: 430 },
];

/** 四拍核心时间轴（ms）——保留原有字段名与总时长契约，供外部组件与测试引用。 */
export const UPDATE_TIMELINE = {
  outlineStart: 0,
  sweepStart: 180,
  secondarySweepStart: 275,
  badgeStart: 260,
  sparkleStart: 780,
  sparkleStagger: 115,
  sparkleDuration: 920,
  total: 2400,
} as const;

/** 内联关键帧兜底：即使独立复制本文件到未更新 tailwind.config.js 的工程，动效也能完整运行。 */
const INLINE_KEYFRAMES = `
@keyframes lrpg-border-trace {
  0% { stroke-dashoffset: var(--lrpg-perim, 600); opacity: 0.25; }
  15% { opacity: 1; }
  55% { stroke-dashoffset: 0; opacity: 0.95; }
  82% { stroke-dashoffset: 0; opacity: 0.55; }
  100% { stroke-dashoffset: 0; opacity: 0; }
}
@keyframes lrpg-afterglow {
  0% { opacity: 0; }
  22% { opacity: 1; }
  68% { opacity: 0.65; }
  100% { opacity: 0; }
}
@keyframes lrpg-blade-sweep {
  0% { transform: translateX(-125%) skewX(-18deg); opacity: 0; }
  10% { opacity: 1; }
  88% { opacity: 0.92; }
  100% { transform: translateX(135%) skewX(-18deg); opacity: 0; }
}
@keyframes lrpg-corner-flash {
  0% { opacity: 0; transform: scale(0.35) rotate(0deg); }
  28% { opacity: 1; transform: scale(1.12) rotate(45deg); }
  70% { opacity: 0.7; transform: scale(0.95) rotate(45deg); }
  100% { opacity: 0; transform: scale(0.5) rotate(90deg); }
}
@keyframes lrpg-badge-float {
  0% { opacity: 0; transform: translateY(3px) scale(0.92); }
  20% { opacity: 0.96; transform: translateY(0) scale(1); }
  78% { opacity: 0.88; transform: translateY(0) scale(1); }
  100% { opacity: 0; transform: translateY(-3px) scale(0.96); }
}
@keyframes lrpg-star-drift {
  0% { opacity: 0; transform: translate3d(0, 2px, 0) scale(0.35) rotate(0deg); }
  20% { opacity: 1; transform: translate3d(calc(var(--tx, 0px) * 0.35), calc(var(--ty, -8px) * 0.35), 0) scale(1.12) rotate(90deg); }
  42% { opacity: 0.42; transform: translate3d(calc(var(--tx, 0px) * 0.6), calc(var(--ty, -8px) * 0.6), 0) scale(0.86) rotate(175deg); }
  65% { opacity: 0.98; transform: translate3d(calc(var(--tx, 0px) * 0.85), calc(var(--ty, -8px) * 0.85), 0) scale(1.04) rotate(265deg); }
  100% { opacity: 0; transform: translate3d(var(--tx, 0px), var(--ty, -8px), 0) scale(0.45) rotate(360deg); }
}
@keyframes lrpg-dust-rise {
  0% { opacity: 0; transform: translateY(4px) scale(0.5); }
  30% { opacity: 0.85; transform: translateY(-3px) scale(1); }
  100% { opacity: 0; transform: translateY(-14px) scale(0.3); }
}
`;

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
  radiusPx: number;
}

/**
 * 覆盖层：portal 到 body，按目标元素的实测矩形定位。
 * 同时监听窗口滚动、resize 与目标元素自身的 ResizeObserver，确保卡片展开或高度变化时严丝合缝。
 */
function UpdateOverlay({ target, kind, seed, onDone }: {
  target: HTMLElement;
  kind: SidePanelChangeKind;
  seed: number;
  onDone: () => void;
}) {
  const [box, setBox] = useState<OverlayBox | undefined>(undefined);
  const gradId = useId().replace(/:/g, '');

  useLayoutEffect(() => {
    const measure = () => {
      if (!target.isConnected) {
        onDone();
        return;
      }
      const rect = target.getBoundingClientRect();
      const computed = window.getComputedStyle(target);
      const radius = computed.borderTopLeftRadius || '12px';
      const parsedRadius = parseFloat(radius);
      const radiusPx = Number.isFinite(parsedRadius) ? Math.max(2, Math.min(24, parsedRadius)) : 10;
      setBox({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        radius,
        radiusPx,
      });
    };
    measure();
    window.addEventListener('scroll', measure, { passive: true, capture: true });
    window.addEventListener('resize', measure);
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => measure())
      : undefined;
    resizeObserver?.observe(target);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
      resizeObserver?.disconnect();
    };
  }, [target, onDone]);

  if (!box || box.width <= 4 || box.height <= 4) return null;

  const perimeter = Math.round(2 * (box.width + box.height));
  const isNew = kind === 'new';

  const style: CSSProperties = {
    position: 'fixed',
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    borderRadius: box.radius,
  };

  const corners: Array<{ x: number; y: number; delay: number }> = [
    { x: 5, y: 5, delay: 0 },
    { x: Math.max(6, box.width - 5), y: 5, delay: 130 },
    { x: Math.max(6, box.width - 5), y: Math.max(6, box.height - 5), delay: 260 },
    { x: 5, y: Math.max(6, box.height - 5), delay: 390 },
  ];

  return (
    <div style={style} className="pointer-events-none z-30 overflow-hidden select-none" aria-hidden="true">
      <style>{INLINE_KEYFRAMES}</style>

      {/* ① 底衬内晕：new 块带温润鎏金内发光与顶边高光，updated 块带克制的暗金边缘呼吸 */}
      <div
        className="absolute inset-0"
        style={{
          borderRadius: box.radius,
          boxShadow: isNew
            ? 'inset 0 0 26px rgba(227, 194, 126, 0.24), inset 0 1px 0 rgba(246, 236, 214, 0.42)'
            : 'inset 0 0 18px rgba(201, 165, 102, 0.16), inset 0 1px 0 rgba(227, 194, 126, 0.28)',
          animation: `lrpg-afterglow ${isNew ? 1950 : 1650}ms ease-out both`,
        }}
      />

      {/* ② 新块专属内圈虚线金框：先勾勒出“此处新增一卷”的古籍栏线 */}
      {isNew && (
        <div
          className="absolute inset-[2px] animate-update-outline border border-dashed border-gold-light/70"
          style={{
            borderRadius: `${Math.max(2, box.radiusPx - 2)}px`,
            animationDelay: `${UPDATE_TIMELINE.outlineStart}ms`,
          }}
        />
      )}

      {/* ③ SVG 双轨流光金线描边 + 四角星铆：沿卡片真实几何边界顺时针疾速闭合 */}
      <svg
        width={box.width}
        height={box.height}
        viewBox={`0 0 ${box.width} ${box.height}`}
        className="absolute inset-0 h-full w-full overflow-visible"
      >
        <defs>
          <linearGradient id={`gold-stroke-${gradId}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f6ecd6" stopOpacity="0.95" />
            <stop offset="45%" stopColor="#e3c27e" stopOpacity="0.9" />
            <stop offset="80%" stopColor="#c9a566" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#8d7340" stopOpacity="0.35" />
          </linearGradient>
        </defs>

        {/* 外轨流光实线 */}
        <rect
          x={0.75}
          y={0.75}
          width={Math.max(1, box.width - 1.5)}
          height={Math.max(1, box.height - 1.5)}
          rx={box.radiusPx}
          ry={box.radiusPx}
          fill="none"
          stroke={`url(#gold-stroke-${gradId})`}
          strokeWidth={isNew ? 1.65 : 1.25}
          strokeDasharray={perimeter}
          style={{
            ['--lrpg-perim' as string]: `${perimeter}`,
            animation: 'lrpg-border-trace 1550ms cubic-bezier(0.16, 1, 0.3, 1) both',
            filter: 'drop-shadow(0 0 5px rgba(227, 194, 126, 0.55))',
          }}
        />

        {/* 四角星铆：金线掠过四角时依次点亮微缩菱形雕花铆点 */}
        {corners.map((corner, idx) => (
          <g
            key={idx}
            style={{
              transformOrigin: `${corner.x}px ${corner.y}px`,
              animation: `lrpg-corner-flash 1100ms cubic-bezier(0.16, 1, 0.3, 1) ${corner.delay}ms both`,
            }}
          >
            <rect
              x={corner.x - 2.2}
              y={corner.y - 2.2}
              width={4.4}
              height={4.4}
              fill="#f6ecd6"
              stroke="#c9a566"
              strokeWidth={0.6}
            />
          </g>
        ))}
      </svg>

      {/* ④ 主光刃 + 宽幅柔光带（-18° 斜向扫掠）：中间铸金锋刃、两侧古铜晕染 */}
      <div
        className="absolute -inset-y-3 left-0 w-3/4"
        style={{
          animation: `lrpg-blade-sweep 880ms cubic-bezier(0.16, 1, 0.3, 1) ${UPDATE_TIMELINE.sweepStart}ms both`,
          backgroundImage:
            'linear-gradient(90deg, transparent 0%, rgba(201,165,102,0.06) 20%, rgba(201,165,102,0.22) 44%, rgba(246,236,214,0.78) 50%, rgba(227,194,126,0.32) 56%, rgba(201,165,102,0.08) 78%, transparent 100%)',
        }}
      >
        {/* 核心 1.5px 亮金光刃 */}
        <div
          className="absolute inset-y-0 left-1/2 w-[1.5px] -translate-x-1/2"
          style={{
            background: 'linear-gradient(180deg, transparent 0%, #f6ecd6 20%, #e3c27e 50%, #f6ecd6 80%, transparent 100%)',
            boxShadow: '0 0 12px 1px rgba(240, 214, 138, 0.85)',
          }}
        />
      </div>

      {/* ⑤ 副刃残影：滞后 95ms 的细金线回响，增加机械与魔法交织的精密层次 */}
      <div
        className="absolute -inset-y-3 left-0 w-1/3"
        style={{
          animation: `lrpg-blade-sweep 820ms cubic-bezier(0.16, 1, 0.3, 1) ${UPDATE_TIMELINE.secondarySweepStart}ms both`,
          backgroundImage:
            'linear-gradient(90deg, transparent 0%, rgba(227,194,126,0.36) 50%, transparent 100%)',
        }}
      />

      {/* ⑥ 右上角微缩古籍批注印记：区分「新录」与「演化」，一目了然且不挡正文 */}
      <div
        style={{
          animation: `lrpg-badge-float 1650ms cubic-bezier(0.16, 1, 0.3, 1) ${UPDATE_TIMELINE.badgeStart}ms both`,
        }}
        className={`absolute right-2 top-1.5 flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-serif text-[9px] tracking-[0.18em] shadow-glow-sm ${
          isNew
            ? 'border-gold-light/70 bg-parchment-900/90 text-gold-light'
            : 'border-gold/45 bg-parchment-900/85 text-gold/90'
        }`}
      >
        <span>{isNew ? '✦' : '✧'}</span>
        <span>{isNew ? '新录' : '演化'}</span>
      </div>

      {/* ⑦ 七曜星芒：依次点亮、旋转闪烁并沿微向量向上漂浮消散 */}
      {SPARKLE_POSITIONS.map((position, index) => (
        <span
          key={`${position.left}-${position.top}`}
          style={{
            left: position.left,
            top: position.top,
            fontSize: `${position.size}px`,
            ['--tx' as string]: position.driftX,
            ['--ty' as string]: position.driftY,
            animation: `lrpg-star-drift ${UPDATE_TIMELINE.sparkleDuration}ms ease-in-out ${
              UPDATE_TIMELINE.sparkleStart + index * UPDATE_TIMELINE.sparkleStagger
            }ms both`,
          }}
          className="absolute select-none leading-none text-gold-light drop-shadow-[0_0_6px_rgba(240,214,138,0.8)]"
        >
          {SPARKLE_GLYPHS[(index + seed) % SPARKLE_GLYPHS.length]}
        </span>
      ))}

      {/* ⑧ 微金尘粒：随扫掠升起的细小金尘 */}
      {DUST_MOTES.map((mote, idx) => (
        <span
          key={`mote-${idx}`}
          style={{
            left: mote.left,
            top: mote.top,
            animation: `lrpg-dust-rise 960ms ease-out ${UPDATE_TIMELINE.sweepStart + mote.delayOffset}ms both`,
          }}
          className="absolute h-1 w-1 rounded-full bg-gold-light shadow-[0_0_6px_#f6ecd6]"
        />
      ))}
    </div>
  );
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

  return (
    <>
      <div ref={hostRef} className={className} style={{ display: 'contents' }}>
        {children}
      </div>
      {playing && !reducedMotion && change && target && canPortal
        ? createPortal(
            <UpdateOverlay target={target} kind={change} seed={seed} onDone={() => setPlaying(false)} />,
            document.body,
          )
        : null}
    </>
  );
}