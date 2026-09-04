import { useEffect, useMemo, useRef, useState } from 'react';
import type { PublicSettings, ShiftReport } from '@cida/shared';
import { fmt, todayKey, TH, PAYMENT_LABELS } from '@cida/shared';
import { api } from '../lib/api';
import type { ReportRound } from '../lib/api';
import { printNode } from '../lib/print';
import { printShiftReportThermal } from '../lib/escpos';

// The cashier hands in takings at 10:00 and again at 14:00, then a combined
// sheet for the day. Each round ends where the next begins, so no bill is
// counted twice; "รวมทั้งวัน" wraps to the next midnight and covers both.
export const ROUNDS = [
  { key: 'morning', label: TH.roundMorning, from: '00:00', to: '10:00' },
  { key: 'afternoon', label: TH.roundAfternoon, from: '10:00', to: '14:00' },
  { key: 'day', label: TH.roundFullDay, from: '00:00', to: '00:00' },
] as const;

interface Props {
  /** Lets the host page (sale history) filter its own list to the same round. */
  onRoundChange?: (round: ReportRound) => void;
  /** Re-fetch trigger for hosts that mutate sales, e.g. after a void. */
  reloadTick?: number;
}

/**
 * The cashier's hand-over report: pick a round, read the figures, print it on
 * the thermal printer. The API scopes the figures to the signed-in cashier, so
 * a cashier prints their own takings without needing an admin.
 */
export default function RoundReport({ onRoundChange, reloadTick = 0 }: Props) {
  const [date, setDate] = useState(todayKey());
  const [fromTime, setFromTime] = useState('00:00');
  const [toTime, setToTime] = useState('00:00');
  const [report, setReport] = useState<ShiftReport | null>(null);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const reportPrintRef = useRef<HTMLDivElement>(null);

  const round = useMemo<ReportRound>(
    () => ({ date, from_time: fromTime, to_time: toTime }),
    [date, fromTime, toTime],
  );
  const activeRound = ROUNDS.find((r) => r.from === fromTime && r.to === toTime)?.key ?? 'custom';
  const isFullDay = activeRound === 'day';
  const title = isFullDay ? TH.dailyReport : TH.shiftReport;

  useEffect(() => {
    api.publicSettings().then(setSettings).catch(() => setSettings(null));
  }, []);

  useEffect(() => {
    onRoundChange?.(round);
  }, [round, onRoundChange]);

  useEffect(() => {
    let stale = false;
    setReport(null);
    api.shiftReport(round).then((r) => !stale && setReport(r)).catch(() => !stale && setReport(null));
    return () => {
      stale = true;
    };
  }, [round, reloadTick]);

  async function print() {
    if (!report || !settings) return;
    setBusy(true);
    setError('');
    try {
      await printShiftReportThermal(report, settings, title);
      setNotice(TH.reportPrinted);
      setTimeout(() => setNotice(''), 3000);
    } catch {
      // No iMin bridge and no Bluetooth adapter — fall back to a normal printer
      // so the user can pick whichever printer exists right now.
      setNotice(TH.btFallbackNotice);
      setTimeout(() => setNotice(''), 4000);
      printNode(reportPrintRef.current);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
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
              onClick={() => {
                setFromTime(r.from);
                setToTime(r.to);
              }}
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
            <div className="text-xs text-slate-500">{title}</div>
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
          onClick={print}
          disabled={!report || !settings || busy}
          className="w-full py-3.5 rounded-xl bg-slate-900 text-white font-bold disabled:opacity-40 active:scale-[0.99] transition"
        >
          {busy ? '…' : `🖨️ ${isFullDay ? TH.printDailyReport : TH.printShiftReport}`}
        </button>
        {error && <div className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</div>}
        {notice && <div className="text-sm text-emerald-700 bg-emerald-50 rounded-xl px-3 py-2">{notice}</div>}
      </div>

      {/* Hidden printable report used by the "normal printer" fallback. */}
      {report && settings && (
        <div className="hidden">
          <div
            ref={reportPrintRef}
            id="receipt-print"
            data-print-size={settings.print_size?.includes('58') ? '58mm' : '80mm'}
            className="bg-white text-slate-900 text-[12px] leading-snug px-3 py-4 font-mono"
            style={{ maxWidth: settings.print_size?.includes('58') ? '58mm' : '80mm' }}
          >
            <div className="flex flex-col items-center text-center">
              {settings.org_name && <div className="font-bold text-[13px] leading-tight">{settings.org_name}</div>}
              <div className="font-bold text-[13px] mt-0.5">{title}</div>
            </div>
            <div className="my-1.5 border-t border-dashed border-slate-400" />
            <div className="space-y-0.5">
              <A4Row l={TH.businessDate} r={report.business_date} />
              <A4Row l={TH.roundPeriod} r={`${hhmm(report.from)} - ${hhmm(report.to)}`} />
              {report.event_name && <A4Row l={TH.event} r={report.event_name} />}
              {report.cashier_name && <A4Row l={TH.cashier} r={report.cashier_name} />}
            </div>
            <div className="my-1.5 border-t border-dashed border-slate-400" />
            <div className="space-y-0.5">
              <A4Row l={TH.grossSales} r={fmt(report.gross)} />
              <A4Row l={TH.totalDiscount} r={`-${fmt(report.discount)}`} />
              <A4Row l={TH.netRevenue} r={fmt(report.net)} strong />
            </div>
            <div className="my-1.5 border-t border-dashed border-slate-400" />
            <div className="space-y-0.5">
              <A4Row l={PAYMENT_LABELS.Cash} r={fmt(report.cash_expected)} />
              <A4Row l={PAYMENT_LABELS.PromptPay} r={fmt(report.promptpay_total)} />
            </div>
            <div className="my-1.5 border-t border-dashed border-slate-400" />
            <div className="space-y-0.5">
              <A4Row l={TH.ordersCompleted} r={String(report.sale_count)} />
              <A4Row l={TH.ordersVoid} r={String(report.void_count)} />
              <A4Row l={TH.ordersRefunded} r={String(report.refund_count)} />
            </div>
            <div className="my-1.5 border-t border-dashed border-slate-400" />
            <div className="mt-1 space-y-2 text-center text-[10px]">
              <div>{TH.printedAt}: {new Date().toLocaleString('th-TH')}</div>
              <div>____________________</div>
              <div>{TH.cashier}</div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// The bounds are already shop-local, so reuse their hh:mm slice rather than
// re-parsing (fmtDate would treat them as UTC and shift every round by seven hours).
function hhmm(local: string): string {
  return local.slice(11, 16);
}

function A4Row({ l, r, strong }: { l: string; r: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-500">{l}</span>
      <span className={`font-semibold text-right ${strong ? 'text-[13px]' : ''}`}>{r}</span>
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
