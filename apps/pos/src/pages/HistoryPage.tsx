import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PublicSettings, Sale, ShiftReport } from '@cida/shared';
import { fmt, fmtDate, todayKey, TH, PAYMENT_LABELS, SALE_STATUS_LABELS } from '@cida/shared';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import { printShiftReportThermal } from '../lib/escpos';
import VoidBillModal from '../components/VoidBillModal';
import type { VoidApproval } from '../components/VoidBillModal';

// The cashier hands in takings at 10:00 and again at 14:00, then a combined
// sheet for the day. Each round ends where the next begins, so no bill is
// counted twice; "รวมทั้งวัน" wraps to the next midnight and covers both.
const ROUNDS = [
  { key: 'morning', label: TH.roundMorning, from: '00:00', to: '10:00' },
  { key: 'afternoon', label: TH.roundAfternoon, from: '10:00', to: '14:00' },
  { key: 'day', label: TH.roundFullDay, from: '00:00', to: '00:00' },
] as const;

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

  const [date, setDate] = useState(todayKey());
  const [fromTime, setFromTime] = useState('00:00');
  const [toTime, setToTime] = useState('00:00');
  const [report, setReport] = useState<ShiftReport | null>(null);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [printError, setPrintError] = useState('');
  const [printNotice, setPrintNotice] = useState('');

  const round = useMemo(
    () => ({ date, from_time: fromTime, to_time: toTime }),
    [date, fromTime, toTime],
  );
  const activeRound = ROUNDS.find((r) => r.from === fromTime && r.to === toTime)?.key ?? 'custom';
  const isFullDay = activeRound === 'day';

  useEffect(() => {
    api.publicSettings().then(setSettings).catch(() => setSettings(null));
  }, []);

  useEffect(() => {
    let stale = false;
    setSales(null);
    setReport(null);
    api.mySales(round).then((s) => !stale && setSales(s)).catch(() => !stale && setSales([]));
    api.shiftReport(round).then((r) => !stale && setReport(r)).catch(() => !stale && setReport(null));
    return () => {
      stale = true;
    };
  }, [round, reloadTick]);

  const applyRound = useCallback((from: string, to: string) => {
    setFromTime(from);
    setToTime(to);
  }, []);

  async function printReport() {
    if (!report || !settings) return;
    setPrintError('');
    try {
      await printShiftReportThermal(report, settings, isFullDay ? TH.dailyReport : TH.shiftReport);
      setPrintNotice(TH.reportPrinted);
      setTimeout(() => setPrintNotice(''), 3000);
    } catch (e) {
      setPrintError(e instanceof Error ? e.message : TH.error);
    }
  }

  const filtered = (sales ?? []).filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return String(s.id).includes(q) || (s.cashier_name ?? '').toLowerCase().includes(q) || s.event_name?.toLowerCase().includes(q);
  });

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
        <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
          <div className="text-sm font-bold text-slate-700">🗓 {TH.reportRound}</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="col-span-2 sm:col-span-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
            {ROUNDS.map((r) => (
              <button
                key={r.key}
                onClick={() => applyRound(r.from, r.to)}
                className={`px-3 py-2 rounded-xl text-sm font-semibold transition ${
                  activeRound === r.key ? 'bg-slate-900 text-white shadow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs text-slate-500">{TH.timeFrom}</span>
              <input
                type="time"
                value={fromTime}
                onChange={(e) => setFromTime(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">{TH.timeTo}</span>
              <input
                type="time"
                value={toTime}
                onChange={(e) => setToTime(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </label>
          </div>
          {/* A round that ends at or before it starts runs past midnight. */}
          {toTime <= fromTime && (
            <div className="text-xs text-slate-400">{`${TH.roundPeriod}: ${fromTime} - ${toTime} (+1 วัน)`}</div>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-500">{isFullDay ? TH.dailyReport : TH.shiftReport}</div>
              <div className="text-2xl font-bold text-emerald-600">{fmt(report?.net ?? 0)}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500">{TH.totalSales}</div>
              <div className="text-2xl font-bold text-slate-800">{report?.sale_count ?? 0}</div>
            </div>
          </div>
          <div className="border-t border-dashed border-slate-200 pt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <Figure label={PAYMENT_LABELS.Cash} value={fmt(report?.cash_expected ?? 0)} />
            <Figure label={PAYMENT_LABELS.PromptPay} value={fmt(report?.promptpay_total ?? 0)} />
            <Figure label={TH.totalDiscount} value={`-${fmt(report?.discount ?? 0)}`} />
            <Figure label={TH.ordersVoid} value={String(report?.void_count ?? 0)} />
          </div>
          <button
            onClick={printReport}
            disabled={!report || !settings}
            className="w-full py-3 rounded-xl bg-slate-900 text-white font-bold disabled:opacity-40 active:scale-[0.99] transition"
          >
            🖨️ {isFullDay ? TH.dailyReport : TH.printShiftReport}
          </button>
          {printError && <div className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{printError}</div>}
          {printNotice && <div className="text-sm text-emerald-700 bg-emerald-50 rounded-xl px-3 py-2">{printNotice}</div>}
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
            {search ? TH.noSales : TH.noSalesInRound}
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

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-800">{value}</span>
    </div>
  );
}
