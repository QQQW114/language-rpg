import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
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

/** 路由分包加载时的占位：保持与全局纸张底色的视觉连续，避免白屏闪烁。 */
function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-parchment-900/0 font-serif text-sm tracking-[.2em] text-parchment-200/55">
      正在展开书页…
    </div>
  );
}

export default function App() {
  return <Suspense fallback={<RouteFallback />}>
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
  </Suspense>;
}
