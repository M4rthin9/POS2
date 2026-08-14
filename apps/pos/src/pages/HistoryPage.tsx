import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Sale } from '@cida/shared';
import { fmt, fmtDate, TH, PAYMENT_LABELS, SALE_STATUS_LABELS } from '@cida/shared';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import VoidBillModal from '../components/VoidBillModal';
import type { VoidApproval } from '../components/VoidBillModal';

export default function HistoryPage() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const clearAuth = useAuth((s) => s.clear);
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [search, setSearch] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  const [voidTarget, setVoidTarget] = useState<Sale | null>(null);
  const [voidBusy, setVoidBusy] = useState(false);
  const [voidError, setVoidError] = useState('');
  const [voidNotice, setVoidNotice] = useState('');

  useEffect(() => {
    api.mySales().then(setSales).catch(() => setSales([]));
  }, [reloadTick]);

  const filtered = (sales ?? []).filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return String(s.id).includes(q) || (s.cashier_name ?? '').toLowerCase().includes(q) || s.event_name?.toLowerCase().includes(q);
  });

  const total = (sales ?? []).reduce((a, s) => a + s.total, 0);

  async function confirmVoid(input: VoidApproval) {
    if (!voidTarget) return;
    setVoidBusy(true);
    setVoidError('');
    try {
      await api.voidSale(voidTarget.id, input);
      setVoidTarget(null);
      setVoidNotice(`${TH.voidSuccess} #${String(voidTarget.id).padStart(6, '0')}`);
      setReloadTick((t) => t + 1);
      setTimeout(() => setVoidNotice(''), 4000);
    } catch (e) {
      setVoidError(e instanceof Error ? e.message : TH.error);
    } finally {
      setVoidBusy(false);
    }
  }

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
          <div className="font-bold leading-tight">{TH.history}</div>
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

      <div className="p-4 max-w-3xl mx-auto w-full flex-1 space-y-3">
        <div className="bg-white rounded-2xl shadow-sm p-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500">{TH.totalRevenue}</div>
            <div className="text-2xl font-bold text-emerald-600">{fmt(total)}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500">{TH.totalSales}</div>
            <div className="text-2xl font-bold text-slate-800">{sales?.length ?? 0}</div>
          </div>
        </div>

        {voidNotice && (
          <div className="bg-emerald-50 text-emerald-700 text-sm font-semibold rounded-xl px-4 py-2.5">{voidNotice}</div>
        )}

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`${TH.search} (#, ${TH.cashier}, ${TH.event})`}
          className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 bg-white"
        />

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
              <div key={s.id} className="bg-white rounded-2xl shadow-sm p-3.5 flex items-center gap-3 hover:shadow-md transition">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm flex items-center gap-2">
                    #{String(s.id).padStart(6, '0')}
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        s.status === 'COMPLETED'
                          ? s.payment_method === 'PromptPay'
                            ? 'bg-emerald-50 text-emerald-600'
                            : 'bg-slate-100 text-slate-600'
                          : 'bg-red-50 text-red-600'
                      }`}
                    >
                      {s.status !== 'COMPLETED' ? (SALE_STATUS_LABELS[s.status] ?? s.status) : (PAYMENT_LABELS[s.payment_method] ?? s.payment_method)}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {fmtDate(s.created_at)} · {s.event_name ?? '-'}
                    {s.discount > 0 && <> · {TH.discount} {fmt(s.discount)}</>}
                  </div>
                </div>
                <div className="text-right flex items-center gap-2">
                  <div>
                    <div className="font-bold text-emerald-600">{fmt(s.total)}</div>
                    <div className="text-xs text-slate-400">{s.items?.length ?? 0} รายการ</div>
                  </div>
                  {s.status === 'COMPLETED' && (
                    <button
                      onClick={() => {
                        setVoidError('');
                        setVoidTarget(s);
                      }}
                      className="flex-none px-3 py-2 rounded-xl bg-red-50 text-red-600 text-xs font-bold hover:bg-red-100 transition"
                    >
                      {TH.voidBill}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {voidTarget && (
        <VoidBillModal
          sale={voidTarget}
          busy={voidBusy}
          error={voidError}
          onClose={() => {
            if (!voidBusy) setVoidTarget(null);
          }}
          onConfirm={confirmVoid}
        />
      )}
    </div>
  );
}
