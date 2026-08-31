import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CidaEvent, PublicSettings, ZReport } from '@cida/shared';
import { fmt, fmtDate, TH, PAYMENT_LABELS } from '@cida/shared';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import { useCart } from '../store/cart';
import { printZReportThermal } from '../lib/escpos';

function today(): string {
  // Local date, not UTC — a booth closing at 23:00 +07 must not roll to tomorrow.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function ZReportPage() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const clearAuth = useAuth((s) => s.clear);
  const cartEventId = useCart((s) => s.eventId);

  const [date, setDate] = useState(today());
  const [eventId, setEventId] = useState<number | null>(cartEventId);
  const [events, setEvents] = useState<CidaEvent[]>([]);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [z, setZ] = useState<ZReport | null>(null);
  const [history, setHistory] = useState<ZReport[]>([]);
  const [counted, setCounted] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    api.activeEvents().then(setEvents).catch(() => setEvents([]));
    api.publicSettings().then(setSettings).catch(() => setSettings(null));
  }, []);

  const loadHistory = useCallback(() => {
    api.zreportHistory().then(setHistory).catch(() => setHistory([]));
  }, []);

  const load = useCallback(async () => {
    setError('');
    setZ(null);
    try {
      setZ(await api.zreport({ date, event_id: eventId }));
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.error);
    }
  }, [date, eventId]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(loadHistory, [loadHistory]);

  const closed = !!z?.closed_at;
  const countedNum = counted === '' ? null : Number(counted);
  const variance = closed ? z?.variance ?? null : countedNum === null || !z ? null : countedNum - z.cash_expected;

  async function close() {
    if (!z) return;
    if (countedNum !== null && !Number.isFinite(countedNum)) {
      setError(TH.error);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.closeZReport({ business_date: date, event_id: eventId, cash_counted: countedNum });
      setConfirming(false);
      setNotice(TH.closeDaySuccess);
      setTimeout(() => setNotice(''), 4000);
      await load();
      loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.error);
    } finally {
      setBusy(false);
    }
  }

  async function printThermal() {
    if (!z || !settings) return;
    setError('');
    try {
      await printZReportThermal(z, settings);
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.error);
    }
  }

  function logout() {
    api.logout().finally(() => {
      clearAuth();
      navigate('/');
    });
  }

  const cardClass = 'bg-white rounded-2xl shadow-sm p-4';
  const Row = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
    <div className={`flex items-center justify-between py-1.5 ${strong ? 'font-bold text-base' : 'text-sm'}`}>
      <span className={strong ? 'text-slate-800' : 'text-slate-500'}>{label}</span>
      <span className={strong ? 'text-emerald-600' : 'text-slate-800'}>{value}</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      <header className="bg-gradient-to-r from-slate-900 to-slate-800 text-white px-4 py-3 flex items-center justify-between shadow-lg">
        <div>
          <div className="font-bold leading-tight">{TH.zReport}</div>
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
        {notice && <div className="bg-emerald-50 text-emerald-700 text-sm font-semibold rounded-xl px-4 py-2.5">{notice}</div>}
        {error && <div className="bg-red-50 text-red-700 text-sm font-semibold rounded-xl px-4 py-2.5">{error}</div>}

        <div className={`${cardClass} space-y-2`}>
          <label className="block">
            <span className="text-xs text-slate-500">{TH.businessDate}</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">{TH.event}</span>
            <select
              value={eventId ?? ''}
              onChange={(e) => setEventId(e.target.value ? Number(e.target.value) : null)}
              className="mt-1 w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 bg-white"
            >
              <option value="">{TH.periodAll}</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {z === null ? (
          <div className="text-center text-slate-400 mt-16">…</div>
        ) : (
          <>
            <div className={cardClass}>
              <div className="flex items-center justify-between mb-2">
                <span
                  className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                    closed ? 'bg-slate-800 text-white' : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  {closed ? TH.dayClosed : TH.dayOpen}
                </span>
                {closed && z.closed_at && <span className="text-xs text-slate-400">{fmtDate(z.closed_at)}</span>}
              </div>

              {z.drifted && (
                <div className="bg-amber-50 text-amber-800 text-xs rounded-xl px-3 py-2 mb-2">
                  {TH.zDrifted}
                  {z.live && <> · {TH.netRevenue} {fmt(z.live.net)} / {z.live.sale_count} {TH.records}</>}
                </div>
              )}

              <Row label={TH.grossSales} value={fmt(z.gross)} />
              <Row label={TH.totalDiscount} value={`-${fmt(z.discount)}`} />
              <Row label={TH.netRevenue} value={fmt(z.net)} strong />
              <div className="border-t border-dashed border-slate-200 my-2" />
              <Row label={PAYMENT_LABELS.Cash} value={fmt(z.cash_expected)} />
              <Row label={PAYMENT_LABELS.PromptPay} value={fmt(z.promptpay_total)} />
              <div className="border-t border-dashed border-slate-200 my-2" />
              <Row label={TH.ordersCompleted} value={String(z.sale_count)} />
              <Row label={TH.ordersVoid} value={String(z.void_count)} />
              <Row label={TH.ordersRefunded} value={String(z.refund_count)} />
            </div>

            <div className={`${cardClass} space-y-2`}>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">{TH.cashExpected}</span>
                <span className="font-bold">{fmt(z.cash_expected)}</span>
              </div>
              {closed ? (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">{TH.cashCounted}</span>
                  <span className="font-bold">{z.cash_counted === null ? '—' : fmt(z.cash_counted)}</span>
                </div>
              ) : (
                <label className="block">
                  <span className="text-xs text-slate-500">{TH.cashCounted}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={counted}
                    onChange={(e) => setCounted(e.target.value)}
                    placeholder="0.00"
                    className="mt-1 w-full border border-slate-200 rounded-xl px-4 py-3 text-lg font-bold text-right focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </label>
              )}
              {variance !== null && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">{TH.cashVariance}</span>
                  <span className={`font-bold ${Math.abs(variance) < 0.005 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {variance > 0 ? '+' : ''}
                    {fmt(variance)}
                  </span>
                </div>
              )}

              {closed ? (
                <div className="space-y-1 pt-1">
                  {z.closer_name && (
                    <div className="text-xs text-slate-500">
                      {TH.closedBy}: {z.closer_name}
                    </div>
                  )}
                  {z.report_hash && (
                    <div className="text-[10px] text-slate-400 break-all">
                      {TH.reportHash}: {z.report_hash}
                    </div>
                  )}
                </div>
              ) : confirming ? (
                <div className="bg-amber-50 rounded-xl p-3 space-y-2">
                  <div className="text-sm text-amber-900">{TH.confirmCloseDay}</div>
                  <div className="flex gap-2">
                    <button
                      onClick={close}
                      disabled={busy}
                      className="flex-1 py-3 rounded-xl bg-slate-900 text-white font-bold disabled:opacity-50"
                    >
                      {busy ? '…' : TH.confirm}
                    </button>
                    <button
                      onClick={() => setConfirming(false)}
                      disabled={busy}
                      className="flex-1 py-3 rounded-xl bg-white border border-slate-200 font-bold disabled:opacity-50"
                    >
                      {TH.cancel}
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setConfirming(true)} className="w-full py-3.5 rounded-xl bg-slate-900 text-white font-bold">
                  🔒 {TH.closeDayButton}
                </button>
              )}

              {settings && (
                <button
                  onClick={printThermal}
                  className="w-full py-3 rounded-xl bg-white border border-slate-200 font-bold text-sm"
                >
                  🖨️ {TH.printDailyClose}
                </button>
              )}
            </div>

            <div className={cardClass}>
              <div className="font-bold text-sm mb-2">📚 {TH.zReportHistory}</div>
              {history.length === 0 ? (
                <div className="text-sm text-slate-400 py-2">{TH.noZReports}</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {history.map((h) => (
                    <div key={h.id} className="py-2 flex items-center justify-between text-sm">
                      <div>
                        <div className="font-semibold">{h.business_date}</div>
                        <div className="text-xs text-slate-400">
                          {h.event_name ?? TH.periodAll}
                          {h.closer_name ? ` · ${h.closer_name}` : ''}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-emerald-600">{fmt(h.net)}</div>
                        {h.variance !== null && (
                          <div className={`text-xs ${Math.abs(h.variance) < 0.005 ? 'text-slate-400' : 'text-red-500'}`}>
                            {TH.cashVariance} {h.variance > 0 ? '+' : ''}
                            {fmt(h.variance)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
