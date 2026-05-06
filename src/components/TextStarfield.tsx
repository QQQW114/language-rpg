import { useEffect, useRef } from 'react';

interface Particle {
  x: number; // 当前实际位置
  y: number;
  vx: number; // 总速度（本底漂移 + 鼠标冲量累积）
  vy: number;
  depth: number; // 0.25..1.2，影响字号 / 亮度 / 耦合强度
  coupling: number; // 鼠标冲量耦合（0.5..1.3）
  damp: number; // 速度阻尼（0.955..0.985）
  char: string;
  size: number;
  font: string;
  baseAlpha: number;
  lifeT: number;
  lifeDur: number;
  twinkleSeed: number;
  driftSeed: number;
}

const CHARS_RARE = ['言', '灵', '梦', '夜', '故', '篝', '册', '咒', '墨', '卷', '典', '契', '幻', '昔', '醒', '听', '见', '书', '画', '玉'];
const CHARS_COMMON = ['丶', '丿', '一', '丨', '乙', '·', '○', '◌', '了', '之', '于'];

interface TextStarfieldProps {
  density?: number;
  /** 鼠标移动 1px 给粒子的瞬时加速度。默认 0.45 */
  impulseStrength?: number;
  /** 自动流向方向池：4 = 上下左右；8 = 加四个对角线；'off' = 关闭。每次挂载只抽一个方向。默认 'off' */
  autoImpulse?: 4 | 8 | 'off';
  /** 旧版自动冲量间隔参数。为兼容旧调用保留；当前连续流向模式不再使用。 */
  autoImpulseInterval?: [number, number];
  /** 连续流向力度。默认 9，会被换算成很小的每帧加速度。 */
  autoImpulseStrength?: number;
  className?: string;
}

/**
 * 文字像气泡一样飘在空中：
 * - 每个字独立速度，缓慢自由漂移（无"原位"束缚）
 * - 鼠标移动产生瞬时冲量，加到每个粒子的速度上
 * - 粒子带阻尼，鼠标停下后还会沿原方向继续飘一段、慢慢减速
 * - 自动流向只在进入页面时确定一次方向，之后持续施加轻柔的力，让文字慢慢流过去
 * - 每个粒子的耦合强度 / 阻尼略不同，群体不齐刷刷
 * - 生灭闪烁：每个字有 lifecycle，淡入 → 稳定 → 淡出 → 在新位置重生
 */
export function TextStarfield({
  density = 18000,
  impulseStrength = 0.45,
  autoImpulse = 'off',
  autoImpulseInterval = [2800, 5800],
  autoImpulseStrength = 9,
  className,
}: TextStarfieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number | undefined>(undefined);
  const lastTsRef = useRef<number>(performance.now());
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  // 鼠标当前位置（屏幕坐标）+ 上一帧位置（用于算速度）
  const mouseRef = useRef({ x: 0, y: 0, prevX: 0, prevY: 0, valid: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 首页背景只需要氛围感，不需要 2x 以上的精细像素。
    // 降低 DPR 上限可以显著减少 canvas 每帧重绘成本，避免拖慢页面其它文字。
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    const randomChar = () => {
      const isRare = Math.random() < 0.18;
      return {
        char: isRare
          ? CHARS_RARE[Math.floor(Math.random() * CHARS_RARE.length)]
          : CHARS_COMMON[Math.floor(Math.random() * CHARS_COMMON.length)],
        isRare,
      };
    };

    const respawn = (p: Particle, w: number, h: number, fresh = false) => {
      const { char, isRare } = randomChar();
      const depth = isRare ? 0.7 + Math.random() * 0.5 : 0.25 + Math.random() * 0.55;
      p.x = Math.random() * w;
      p.y = Math.random() * h;
      // 本底速度：极轻微的随机方向漂浮
      p.vx = (Math.random() - 0.5) * 0.15;
      p.vy = (Math.random() - 0.5) * 0.15;
      p.depth = depth;
      p.coupling = 0.55 + Math.random() * 0.75; // 0.55..1.3
      p.damp = 0.965 + Math.random() * 0.018; // 0.965..0.983
      p.char = char;
      // 字号量化：避免每个粒子都使用独立浮点字号，降低浏览器反复栅格化字体的概率。
      p.size = Math.round((isRare ? 12 : 9) + depth * 6);
      p.font = `${p.size}px "Noto Serif SC", Georgia, serif`;
      p.baseAlpha = (isRare ? 0.18 : 0.06) + depth * 0.22;
      p.lifeDur = 6000 + Math.random() * 9000;
      p.lifeT = fresh ? Math.random() * 0.85 : 0;
      p.twinkleSeed = Math.random() * Math.PI * 2;
      p.driftSeed = Math.random() * Math.PI * 2;
    };

    const generateParticles = () => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      const count = Math.max(30, Math.floor((w * h) / density));
      const ps: Particle[] = [];
      for (let i = 0; i < count; i++) {
        const p: Particle = {
          x: 0, y: 0, vx: 0, vy: 0,
          depth: 1, coupling: 1, damp: 0.97,
          char: '', size: 12, font: '12px "Noto Serif SC", Georgia, serif', baseAlpha: 0.2,
          lifeT: 0, lifeDur: 8000, twinkleSeed: 0, driftSeed: 0,
        };
        respawn(p, w, h, true);
        ps.push(p);
      }
      particlesRef.current = ps;
    };

    const resize = () => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      sizeRef.current = { w, h, dpr };
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textBaseline = 'alphabetic';
      generateParticles();
    };

    resize();
    window.addEventListener('resize', resize);

    const onMouseMove = (e: MouseEvent) => {
      const m = mouseRef.current;
      if (!m.valid) {
        m.prevX = e.clientX;
        m.prevY = e.clientY;
      }
      m.x = e.clientX;
      m.y = e.clientY;
      m.valid = true;
    };
    const onMouseLeave = () => {
      const m = mouseRef.current;
      m.valid = false;
      m.prevX = m.x;
      m.prevY = m.y;
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseleave', onMouseLeave);

    const MAX_SPEED = 6; // 防止飞太快

    // 自动冲量方向集合
    const SQRT2 = 1 / Math.SQRT2;
    const DIRS_4: Array<[number, number]> = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
    ];
    const DIRS_8: Array<[number, number]> = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [SQRT2, SQRT2], [-SQRT2, SQRT2], [SQRT2, -SQRT2], [-SQRT2, -SQRT2],
    ];
    const dirs = autoImpulse === 8 ? DIRS_8 : autoImpulse === 4 ? DIRS_4 : null;
    // 每次进入页面只确定一个方向。之后不再随机切方向，也不再给“突然动一下”的冲量。
    const flowDir = dirs?.[Math.floor(Math.random() * dirs.length)];
    const flowStrength = flowDir ? Math.max(0, autoImpulseStrength) * 0.01 : 0;

    const draw = (now: number) => {
      // 之前偶发掉帧后会用较大的 dt 一次性补位，视觉上像“全体文字卡一下再跳”。
      // 这里限制单帧步长，让偶发掉帧只表现为略慢，而不是突然跃迁。
      const dt = Math.min(34, now - lastTsRef.current);
      lastTsRef.current = now;
      const dtScale = dt / 16.67; // 60fps 标准化
      const { w, h } = sizeRef.current;

      ctx.clearRect(0, 0, w, h);

      // 计算这一帧的鼠标位移（冲量来源）
      const m = mouseRef.current;
      let mdx = 0;
      let mdy = 0;
      if (m.valid) {
        mdx = m.x - m.prevX;
        mdy = m.y - m.prevY;
        m.prevX = m.x;
        m.prevY = m.y;
      }

      const ps = particlesRef.current;
      for (const p of ps) {
        // 鼠标冲量
        if (mdx !== 0 || mdy !== 0) {
          p.vx += mdx * impulseStrength * p.coupling;
          p.vy += mdy * impulseStrength * p.coupling;
        }

        // 自动流向：每帧沿固定方向施加很小的力，形成缓慢、持续的整体流动。
        if (flowDir && flowStrength > 0) {
          const depthFactor = 0.55 + p.depth * 0.45;
          p.vx += flowDir[0] * flowStrength * p.coupling * depthFactor * dtScale;
          p.vy += flowDir[1] * flowStrength * p.coupling * depthFactor * dtScale;
        }

        // 平滑本底扰动：用连续正弦替代逐帧随机抽动，避免偶发“整屏字一顿”的观感。
        const driftT = now * 0.00022 + p.driftSeed;
        p.vx += Math.sin(driftT) * 0.0012 * p.depth * dtScale;
        p.vy += Math.cos(driftT * 0.93) * 0.0012 * p.depth * dtScale;

        // 阻尼（每帧速度衰减一点，慢慢回到接近静止的微飘）
        p.vx *= p.damp;
        p.vy *= p.damp;

        // 限速
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (speed > MAX_SPEED) {
          const k = MAX_SPEED / speed;
          p.vx *= k;
          p.vy *= k;
        }

        // 推进位置
        p.x += p.vx * dtScale;
        p.y += p.vy * dtScale;

        // 边界缠绕
        if (p.x < -50) p.x = w + 50;
        if (p.x > w + 50) p.x = -50;
        if (p.y < -50) p.y = h + 50;
        if (p.y > h + 50) p.y = -50;

        // 生命周期
        p.lifeT += dt / p.lifeDur;
        if (p.lifeT >= 1) {
          respawn(p, w, h, false);
          continue;
        }

        let lifeAlpha = 1;
        if (p.lifeT < 0.18) lifeAlpha = p.lifeT / 0.18;
        else if (p.lifeT > 0.82) lifeAlpha = (1 - p.lifeT) / 0.18;

        const breathing = (Math.sin(now * 0.0008 + p.twinkleSeed) + 1) * 0.5;
        const alpha = p.baseAlpha * lifeAlpha * (0.75 + breathing * 0.25);
        if (alpha < 0.01) continue;

        ctx.font = p.font;
        ctx.fillStyle = `rgba(201, 165, 102, ${alpha})`;
        ctx.fillText(p.char, p.x, p.y);
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseleave', onMouseLeave);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [density, impulseStrength, autoImpulse, autoImpulseInterval, autoImpulseStrength]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={`pointer-events-none absolute inset-0 w-full h-full [contain:strict] [transform:translateZ(0)] ${className ?? ''}`}
    />
  );
}
