import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Sale } from '@cida/shared';
import { fmt, fmtDate, TH, PAYMENT_LABELS } from '@cida/shared';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';

export default function HistoryPage() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const clearAuth = useAuth((s) => s.clear);
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.mySales().then(setSales).catch(() => setSales([]));
  }, []);

  const filtered = (sales ?? []).filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return String(s.id).includes(q) || (s.cashier_name ?? '').toLowerCase().includes(q) || s.event_name?.toLowerCase().includes(q);
  });

  const total = (sales ?? []).reduce((a, s) => a + s.total, 0);

  function logout() {
    api.logout().finally(() => {
      clearAuth();
      navigate('/');
    });
  }

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      <header className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
        <div>
          <div className="font-bold leading-tight">{TH.history}</div>
          <div className="text-xs text-slate-300">
            {user?.display_name} · {user?.role === 'admin' ? TH.admin : TH.cashier}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => navigate('/')} className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm">
            ← {TH.back}
          </button>
          <button onClick={logout} className="px-3 py-1.5 rounded-lg bg-red-600/80 hover:bg-red-600 text-sm">
            {TH.logout}
          </button>
        </div>
      </header>

      <div className="p-4 max-w-3xl mx-auto w-full flex-1">
        <div className="flex items-center justify-between mb-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={TH.search}
            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-800 mr-3"
          />
          <div className="text-sm text-slate-600 whitespace-nowrap">
            {TH.total} <span className="font-bold text-emerald-600">{fmt(total)}</span>
          </div>
        </div>

        {sales === null ? (
          <div className="text-center text-slate-400 mt-20">…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-slate-400 mt-20">
            <div className="text-4xl mb-2">🧾</div>
            {TH.noSales}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((s) => (
              <div key={s.id} className="bg-white rounded-xl shadow-sm p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">
                    #{String(s.id).padStart(6, '0')}
                    <span className="text-slate-400 font-normal"> · {s.event_name ?? '-'}</span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {fmtDate(s.created_at)} · {s.cashier_name ?? '-'} · {PAYMENT_LABELS[s.payment_method] ?? s.payment_method}
                    {s.discount > 0 && <> · {TH.discount} {fmt(s.discount)}</>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-emerald-600">{fmt(s.total)}</div>
                  <div className="text-xs text-slate-400">
                    {s.items?.length ?? 0} รายการ
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
