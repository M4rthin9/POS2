import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './store/auth';
import LoginPage from './pages/LoginPage';
import SalesPage from './pages/SalesPage';
import HistoryPage from './pages/HistoryPage';
import SettingsPage from './pages/SettingsPage';
import ZReportPage from './pages/ZReportPage';
import DailyReportPage from './pages/DailyReportPage';

export default function App() {
  const user = useAuth((s) => s.user);
  const accessToken = useAuth((s) => s.accessToken);
  const authed = !!user && !!accessToken;

  if (!authed) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<SalesPage />} />
      <Route path="/history" element={<HistoryPage />} />
      <Route path="/daily-report" element={<DailyReportPage />} />
      <Route path="/zreport" element={<ZReportPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
