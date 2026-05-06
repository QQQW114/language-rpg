/**
 * 全局动画常量。所有时长 / ease 都从这里取，避免散落的 magic 值。
 *
 * 用法：
 *   <div className={`transition-all duration-${DUR.fast}`} />  // 不行 —— Tailwind 不支持运行时类
 *   <div style={{ transitionDuration: `${DUR.fast}ms` }} />     // 用 inline style
 *
 *   <GoldLine staggerMs={STAGGER.gold} />
 */

export const DUR = {
  micro: 150,
  fast: 250,
  base: 350,
  smooth: 600,
  slow: 900,
} as const;

export const EASE = {
  outExpo: 'cubic-bezier(0.16, 1, 0.3, 1)',
  inExpo: 'cubic-bezier(0.7, 0, 0.84, 0)',
  outQuart: 'cubic-bezier(0.25, 1, 0.5, 1)',
  wax: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const;

export const STAGGER = {
  /** GoldLine 中央文字逐字 reveal 间隔 */
  gold: 35,
  /** RoundProgress 进度刻度点逐个亮起间隔 */
  pip: 60,
  /** 列表入场逐项延迟 */
  list: 50,
} as const;

/**
 * 计算 GoldLine 进入动画的总时长，用于 setTimeout 切换到 steady 态。
 *
 * 时序：左线 0→650ms 一直在画；右线 180ms 开始；字符从 200ms 起 stagger × N 后出现。
 * 我们取最大值 + 缓冲 100ms 作为「彻底稳定」的时间。
 */
export function goldLineEnterDuration(textLength: number, stagger = STAGGER.gold): number {
  const lineDone = 180 + 650; // 右线起始 + 时长
  const charsDone = 200 + textLength * stagger + 600; // char-reveal 持续 600ms
  return Math.max(lineDone, charsDone) + 100;
}

export function goldLineExitDuration(textLength: number, stagger = STAGGER.gold): number {
  const charsDone = textLength * stagger + 700;
  const lineDone = 700; // 右线 origin-right 0.5s + 左线 0.5s
  return Math.max(charsDone, lineDone) + 100;
}
