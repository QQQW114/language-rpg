import { Routes, Route, Navigate } from 'react-router-dom';
import HomePage from '@/v2/HomePage';
import SetupPage from '@/v2/SetupPage';
import GamePage from '@/v2/GamePage';
import WorkshopPage from '@/v2/WorkshopPage';
import SettingsPage from '@/pages/SettingsPage';

export default function App() {
  return <Routes>
    <Route path="/" element={<HomePage />} />
    <Route path="/setup" element={<SetupPage />} />
    <Route path="/game" element={<GamePage />} />
    <Route path="/workshop" element={<WorkshopPage />} />
    <Route path="/library" element={<Navigate to="/workshop" replace />} />
    <Route path="/settings" element={<SettingsPage />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
