import { Routes, Route, Navigate } from 'react-router-dom';
import HomePage from '@/pages/HomePage';
import SetupPage from '@/pages/SetupPage';
import PresetsPage from '@/pages/PresetsPage';
import GamePage from '@/pages/GamePage';
import SettingsPage from '@/pages/SettingsPage';
import LibraryPage from '@/pages/LibraryPage';
import WorkspacePage from '@/pages/WorkspacePage';
import { useEffect } from 'react';
import { useGameStore } from '@/store/useGameStore';

export default function App() {
  const ledgerHydrated = useGameStore((s) => s.ledgerHydrated);
  const hydrateFromLedger = useGameStore((s) => s.hydrateFromLedger);

  useEffect(() => {
    if (!ledgerHydrated) void hydrateFromLedger();
  }, [ledgerHydrated, hydrateFromLedger]);

  if (!ledgerHydrated) {
    return (
      <div className="min-h-full flex items-center justify-center text-parchment-200/70 font-serif tracking-[0.3em]">
        正在展开旅程卷宗……
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/presets" element={<PresetsPage />} />
      <Route path="/game" element={<GamePage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/library" element={<LibraryPage />} />
      <Route path="/workspace" element={<WorkspacePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
