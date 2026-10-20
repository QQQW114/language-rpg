import { lazy, Suspense, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import HomePage from '@/v2/HomePage';

// 路由级动态分包：首屏只加载主页所需代码。
// - GamePage 是最大的页面（含 react-markdown、回合引擎、侧边栏）；
// - WorkshopPage 是重编辑器（大纲 / 世界书）；
// - SetupPage 与 SettingsPage 只在对应流程里用一次。
// 这些页面在首次访问时按需加载，之后走浏览器缓存；主页保持即时可用。
const SetupPage = lazy(() => import('@/v2/SetupPage'));
const GamePage = lazy(() => import('@/v2/GamePage'));
const WorkshopPage = lazy(() => import('@/v2/WorkshopPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));

/**
 * 路由切换时的「延伸金线」：
 * 每次路径变化时，在视口顶部中央向两侧延伸一条 1.5px 鎏金细线，随后自然隐没，
 * 赋予页面跳转“翻开新卷”的仪式感，且全程 pointer-events-none 不拦截任何交互。
 */
function RouteGoldLineTransition() {
  const location = useLocation();
  const [pulseKey, setPulseKey] = useState(0);

  useEffect(() => {
    setPulseKey((k) => k + 1);
  }, [location.pathname]);

  return (
    <div
      key={pulseKey}
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center overflow-hidden"
    >
      <div className="route-gold-bar h-[1.5px] w-full bg-gold-line gold-line--glow" />
    </div>
  );
}

/** 路由分包加载时的占位：保持与全局纸张底色的视觉连续，并带延伸金线动画。 */
function RouteFallback() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-parchment-900/0 font-serif text-sm tracking-[.24em] text-parchment-200/65">
      <div className="flex items-center gap-3">
        <span className="h-px w-12 bg-gold-line animate-line-in" />
        <span className="text-gold-light/85">正在展开书页…</span>
        <span className="h-px w-12 bg-gold-line animate-line-in" />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <>
      <RouteGoldLineTransition />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/game" element={<GamePage />} />
          <Route path="/workshop" element={<WorkshopPage />} />
          <Route path="/library" element={<Navigate to="/workshop" replace />} />
          {/* 旧版「书库」已并入命运工坊；保留重定向以兼容旧书签与旧文档链接。 */}
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
