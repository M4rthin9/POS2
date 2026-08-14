import { useCallback, useEffect, useState } from 'react';
import type { ZReport } from '@cida/shared';
import { TH, fmt, fmtDate, fmtDateOnly, shortHash, toISODate } from '@cida/shared';
import { api, type AdminEvent, type AdminUser } from '../lib/api';
import { Badge, Button, Card, EmptyRow, ErrorBar, Table } from '../components/ui';
import { PrintDoc, GovDocHeader, GovSection, SignatureBlock } from '../components/PrintDoc';
import { printNode } from '../lib/print';

/**
 * X-report (mid-day, read-only) and Z-report (day close, locks the figures).
 * Scoped to a business day, optionally narrowed to one event or cashier — there
 * is no shift table, so cash expected is derived from cash-tender sales alone.
 */
export default function ZReportPage() {
  const [date, setDate] = useState(toISODate(new Date()));
  const [eventId, setEventId] = useState('');
  const [cashierId, setCashierId] = useState('');
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [report, setReport] = useState<ZReport | null>(null);
  const [history, setHistory] = useState<ZReport[]>([]);
  const [counted, setCounted] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.adminSettings().then(setSettings).catch(() => {});
    api.adminEvents().then(setEvents).catch(() => {});
    api.adminUsers().then(setUsers).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setReport(null);
    try {
      const [r, h] = await Promise.all([
        api.zreport({ date, event_id: eventId ? Number(eventId) : undefined, cashier_id: cashierId ? Number(cashierId) : undefined }),
        api.zreportHistory().catch(() => []),
      ]);
      setReport(r);
      setHistory(h);
      setCounted(r.cash_counted === null ? '' : String(r.cash_counted));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.error);
    }
  }, [date, eventId, cashierId]);

  useEffect(() => {
    load();
  }, [load]);

  async function close() {
    setBusy(true);
    setError('');
    try {
      await api.closeZReport({
        business_date: date,
        event_id: eventId ? Number(eventId) : null,
        cashier_user_id: cashierId ? Number(cashierId) : null,
        cash_counted: counted === '' ? null : Number(counted),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.error);
    } finally {
      setBusy(false);
    }
  }

  const closed = !!report?.closed_at;
  const liveVariance = counted === '' ? null : Math.round((Number(counted) - (report?.cash_expected ?? 0)) * 100) / 100;
  const variance = closed ? report?.variance ?? null : liveVariance;

  const lines: { label: string; value: string; strong?: boolean; tone?: string }[] = [
    { label: TH.grossSales, value: fmt(report?.gross ?? 0) },
    { label: TH.totalDiscount, value: `(${fmt(report?.discount ?? 0)})` },
    { label: TH.netRevenue, value: fmt(report?.net ?? 0), strong: true },
    { label: TH.cash, value: fmt(report?.cash_expected ?? 0) },
    { label: TH.promptpay, value: fmt(report?.promptpay_total ?? 0) },
    { label: `${TH.ordersCompleted} / ${TH.ordersVoid} / ${TH.ordersRefunded}`, value: `${report?.sale_count ?? 0} / ${report?.void_count ?? 0} / ${report?.refund_count ?? 0}` },
  ];

  return (
    <div>
      <div className="no-print mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">📋 {closed ? TH.zReport : TH.xReport}</h1>
          <p className="text-sm text-slate-500">
            {TH.businessDate} {fmtDateOnly(date)} · {closed ? `${TH.dayClosed} ${fmtDate(report!.closed_at)}` : TH.dayOpen}
          </p>
        </div>
        <div className="no-print flex flex-wrap items-center gap-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border border-slate-200 rounded-xl px-2 py-1.5 text-sm" />
          <select value={eventId} onChange={(e) => setEventId(e.target.value)} className="border border-slate-200 rounded-xl px-2 py-1.5 text-sm bg-white">
            <option value="">— {TH.event} —</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
          <select value={cashierId} onChange={(e) => setCashierId(e.target.value)} className="border border-slate-200 rounded-xl px-2 py-1.5 text-sm bg-white">
            <option value="">— {TH.cashier} —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.display_name}</option>
            ))}
          </select>
          <Button variant="primary" onClick={() => printNode(document.getElementById('report-print'))}>🖨 {TH.print}</Button>
        </div>
      </div>

      <ErrorBar message={error} onDismiss={() => setError('')} />

      <div className="grid lg:grid-cols-3 gap-3 items-start">
        <div className="lg:col-span-2">
          <PrintDoc>
            <GovDocHeader
              settings={settings}
              title={closed ? TH.zReport : TH.xReport}
              subtitle={`${TH.event}: ${events.find((e) => String(e.id) === eventId)?.name ?? TH.periodAllLabel} · ${TH.cashier}: ${
                users.find((u) => String(u.id) === cashierId)?.display_name ?? TH.periodAllLabel
              }`}
              periodText={`${TH.businessDate} ${fmtDateOnly(date)}${closed ? ` (${TH.dayClosed} · ${shortHash(report?.report_hash)})` : ''}`}
            />

            <GovSection no={1} title={TH.financialSummary}>
              <table className="gov-table">
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.label} className={l.strong ? 'border-t border-slate-300' : ''}>
                      <td className={`py-1.5 ${l.strong ? 'font-semibold' : 'text-slate-600'}`}>{l.label}</td>
                      <td className={`py-1.5 text-right tabular-nums ${l.strong ? 'font-semibold' : ''}`}>{l.value}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-300">
                    <td className="py-1.5 text-slate-600">{TH.cashExpected}</td>
                    <td className="py-1.5 text-right tabular-nums font-semibold">{fmt(report?.cash_expected ?? 0)}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 text-slate-600">{TH.cashCounted}</td>
                    <td className="py-1.5 text-right tabular-nums font-semibold">{counted === '' ? '—' : fmt(Number(counted))}</td>
                  </tr>
                  <tr className="border-t-2 border-slate-800">
                    <td className="py-2 font-bold">{TH.cashVariance}</td>
                    <td className={`py-2 text-right tabular-nums font-bold ${!variance ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {variance === null ? '—' : `${fmt(variance)} ${variance === 0 ? '✓' : '⚠'}`}
                    </td>
                  </tr>
                </tbody>
              </table>
            </GovSection>

            <SignatureBlock />
          </PrintDoc>
        </div>

        <div className="space-y-3">
          <Card title={`💵 ${TH.closeDay}`} dense bodyClassName="p-4 space-y-3">
            {closed ? (
              <div className="space-y-2 text-sm">
                <Badge tone="emerald">{TH.dayClosed}</Badge>
                <p className="text-slate-600">
                  {TH.closedAt} {fmtDate(report!.closed_at)}
                </p>
                <p className="text-xs text-slate-400 font-mono break-all">{report?.report_hash}</p>
                <p className="text-xs text-slate-500">ปิดวันแล้วไม่สามารถปิดซ้ำได้ ตัวเลขที่แสดงคือค่าที่บันทึกไว้ ณ เวลาปิดวัน</p>
                {report?.drifted && (
                  <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5">
                    ⚠ มีรายการขายเพิ่มเติมหลังปิดวันแล้ว (ยอดปัจจุบัน {fmt(report.live?.net ?? 0)} จาก {report.live?.sale_count ?? 0} ใบเสร็จ)
                    ตัวเลขในรายงานยังคงเป็นค่าที่รับรองไว้
                  </p>
                )}
              </div>
            ) : (
              <>
                <label className="block text-xs text-slate-500">
                  {TH.cashCounted}
                  <input
                    type="number"
                    step="0.01"
                    value={counted}
                    onChange={(e) => setCounted(e.target.value)}
                    className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </label>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">{TH.cashVariance}</span>
                  <span className={`font-bold tabular-nums ${!liveVariance ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {liveVariance === null ? '—' : fmt(liveVariance)}
                  </span>
                </div>
                <Button variant="dark" className="w-full" onClick={close} disabled={busy}>
                  {busy ? '…' : `🔒 ${TH.closeDay}`}
                </Button>
              </>
            )}
          </Card>

          <Card title="📚 ประวัติการปิดวัน" dense>
            <Table
              head={
                <tr>
                  <th className="px-3 py-2 text-left font-medium">{TH.date}</th>
                  <th className="px-3 py-2 text-right font-medium">{TH.netRevenue}</th>
                  <th className="px-3 py-2 text-right font-medium">{TH.variance}</th>
                </tr>
              }
            >
              {history.length === 0 ? (
                <EmptyRow colSpan={3} />
              ) : (
                history.map((z) => (
                  <tr
                    key={z.id}
                    className="hover:bg-slate-50 cursor-pointer"
                    onClick={() => {
                      setDate(z.business_date);
                      setEventId(z.event_id ? String(z.event_id) : '');
                      setCashierId(z.cashier_user_id ? String(z.cashier_user_id) : '');
                    }}
                  >
                    <td className="px-3 py-1.5 text-xs">{fmtDateOnly(z.business_date)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(z.net)}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${z.variance ? 'text-rose-600' : 'text-slate-400'}`}>
                      {z.variance === null ? '—' : fmt(z.variance)}
                    </td>
                  </tr>
                ))
              )}
            </Table>
          </Card>
        </div>
      </div>
    </div>
  );
}
