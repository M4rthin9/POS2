import { useNavigate } from 'react-router-dom';
import { TH } from '@cida/shared';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import RoundReport from '../components/RoundReport';

/**
 * Standalone hand-over report, reachable in one tap from the sales screen so a
 * cashier reporting at 10:00 or 14:00 does not have to go through sale history.
 */
export default function DailyReportPage() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const clearAuth = useAuth((s) => s.clear);

  function logout() {
    api.logout().finally(() => {
      clearAuth();
      navigate('/');
    });
  }

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      <header className="bg-gradient-to-r from-slate-900 to-slate-800 text-white px-4 py-3 flex items-center justify-between shadow-lg">
        <div>
          <div className="font-bold leading-tight">{TH.dailyReport}</div>
          <div className="text-xs text-slate-300">
            {user?.display_name} · {user?.role === 'admin' || user?.role === 'superadmin' ? TH.admin : TH.cashier}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => navigate('/')} className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm transition">
            ← {TH.back}
          </button>
          <button onClick={logout} className="px-3 py-1.5 rounded-lg bg-red-600/80 hover:bg-red-600 text-sm transition">
            {TH.logout}
          </button>
        </div>
      </header>

      <div className="p-4 max-w-2xl mx-auto w-full flex-1 space-y-3">
        <RoundReport />
        <button
          onClick={() => navigate('/history')}
          className="w-full py-3 rounded-xl bg-white border border-slate-200 font-bold text-sm hover:bg-slate-50 transition"
        >
          {TH.history} →
        </button>
      </div>
    </div>
  );
}
