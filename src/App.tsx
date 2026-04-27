import { Routes, Route, Navigate } from 'react-router-dom';
import HomePage from '@/pages/HomePage';
import SetupPage from '@/pages/SetupPage';
import GamePage from '@/pages/GamePage';
import SettingsPage from '@/pages/SettingsPage';
import LibraryPage from '@/pages/LibraryPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/game" element={<GamePage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/library" element={<LibraryPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
