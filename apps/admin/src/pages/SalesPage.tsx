import { useCallback, useEffect, useState } from 'react';
import type { AdminEvent, AdminUser } from '../lib/api';
import { api } from '../lib/api';
import type { Sale } from '@cida/shared';
import { fmt, fmtAmt, fmtDate, fmtThaiLong, TH, PAYMENT_LABELS, SALE_STATUS_LABELS, shortHash } from '@cida/shared';
import { useAuth } from '../store/auth';
import { Badge, Button, Card, EmptyRow, ErrorBar, Modal, Table } from '../components/ui';
import SaleDetail from '../components/SaleDetail';
import { GovDocHeader, GovSection, PrintDoc } from '../components/PrintDoc';

const STATUS_TONE: Record<string, string> = { COMPLETED: 'emerald', VOID: 'slate', REFUNDED: 'amber' };
const PRINT_CAP = 3000;

export default function SalesPage() {
  const user = useAuth((s) => s.user);
  const isSuper = user?.role === 'superadmin';

  const [sales, setSales] = useState<Sale[] | null>(null);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [eventId, setEventId] = useState('');
  const [cashierId, setCashierId] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [detail, setDetail] = useState<Sale | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setSales(null);
    try {
      const res = await api.adminSales({
        event_id: eventId ? Number(eventId) : undefined,
        cashier_id: cashierId ? Number(cashierId) : undefined,
        status: status || undefined,
        from: from || undefined,
        to: to || undefined,
      });
      setSales(res);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.error);
      setSales([]);
    }
  }, [eventId, cashierId, status, from, to]);

  useEffect(() => {
    api.adminEvents().then(setEvents).catch(() => {});
    api.adminUsers().then(setUsers).catch(() => {});
    api.adminSettings().then(setSettings).catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Voided and refunded rows are listed but excluded from the revenue total.
  const completed = (sales ?? []).filter((s) => s.status === 'COMPLETED');
  const total = completed.reduce((a, s) => a + s.total, 0);
  const gross = completed.reduce((a, s) => a + s.subtotal, 0);
  const discount = completed.reduce((a, s) => a + s.discount, 0);
  const cash = completed.filter((s) => s.payment_method === 'Cash').reduce((a, s) => a + s.total, 0);
  const promptpay = completed.filter((s) => s.payment_method === 'PromptPay').reduce((a, s) => a + s.total, 0);

  const periodText =
    from && to
      ? `${fmtThaiLong(from)} ถึง ${fmtThaiLong(to)}`
      : from
        ? `ตั้งแต่ ${fmtThaiLong(from)}`
        : to
          ? `จนถึง ${fmtThaiLong(to)}`
          : TH.periodAllLabel;

  const scopeText = [
    eventId ? (events.find((e) => e.id === Number(eventId))?.name ?? TH.totalAllEvents) : TH.allEvents,
    cashierId ? (users.find((u) => u.id === Number(cashierId))?.display_name ?? TH.allCashiers) : TH.allCashiers,
    status ? (SALE_STATUS_LABELS[status] ?? status) : TH.allStatuses,
  ].join(' · ');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">{TH.sales}</h1>
        <p className="text-sm text-slate-500">เลือกบิลเพื่อดูรายละเอียด ยกเลิกบิล หรือคืนเงิน</p>
      </div>

      <ErrorBar message={error} onDismiss={() => setError('')} />

      <div className="bg-white rounded-2xl shadow-sm p-4 grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <select value={eventId} onChange={(e) => setEventId(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
          <option value="">— {TH.event} —</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <select value={cashierId} onChange={(e) => setCashierId(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
          <option value="">— {TH.cashier} —</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.display_name}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
          <option value="">— {TH.status} —</option>
          {Object.entries(SALE_STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input value={from} onChange={(e) => setFrom(e.target.value)} type="date" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        <input value={to} onChange={(e) => setTo(e.target.value)} type="date" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>

      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-600">
          {TH.netRevenue}: <span className="font-bold text-emerald-600">{fmt(total)}</span> ({sales?.length ?? 0} {TH.records})
        </div>
        <Button variant="primary" disabled={!sales || sales.length === 0} onClick={() => window.print()}>
          🖨 {TH.print}
        </Button>
      </div>

      <Card>
        <Table
          head={
            <tr>
              <th className="px-4 py-2 text-left font-medium">#</th>
              <th className="px-4 py-2 text-left font-medium">{TH.date}</th>
              <th className="px-4 py-2 text-left font-medium">{TH.event}</th>
              <th className="px-4 py-2 text-left font-medium">{TH.cashier}</th>
              <th className="px-4 py-2 text-left font-medium">{TH.paymentMethod}</th>
              <th className="px-4 py-2 text-left font-medium">{TH.status}</th>
              <th className="px-4 py-2 text-right font-medium">{TH.subtotal}</th>
              <th className="px-4 py-2 text-right font-medium">{TH.discount}</th>
              <th className="px-4 py-2 text-right font-medium">{TH.total}</th>
              <th className="px-4 py-2 text-left font-medium">{TH.txHash}</th>
            </tr>
          }
        >
          {sales === null ? (
            <EmptyRow colSpan={10} label="…" />
          ) : sales.length === 0 ? (
            <EmptyRow colSpan={10} />
          ) : (
            sales.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setDetail(s)}>
                <td className="px-4 py-2 font-mono text-xs">#{String(s.id).padStart(6, '0')}</td>
                <td className="px-4 py-2 whitespace-nowrap">{fmtDate(s.created_at)}</td>
                <td className="px-4 py-2 max-w-40 truncate">{s.event_name}</td>
                <td className="px-4 py-2">{s.cashier_name}</td>
                <td className="px-4 py-2">
                  <Badge tone={s.payment_method === 'PromptPay' ? 'emerald' : 'slate'}>
                    {PAYMENT_LABELS[s.payment_method] ?? s.payment_method}
                  </Badge>
                </td>
                <td className="px-4 py-2">
                  <Badge tone={STATUS_TONE[s.status]}>{SALE_STATUS_LABELS[s.status] ?? s.status}</Badge>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{fmt(s.subtotal)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{s.discount > 0 ? fmt(s.discount) : '—'}</td>
                <td className={`px-4 py-2 text-right font-semibold tabular-nums ${s.status === 'COMPLETED' ? '' : 'line-through text-slate-400'}`}>
                  {fmt(s.total)}
                </td>
                <td className="px-4 py-2 font-mono text-[10px] text-slate-400" title={s.tx_hash ?? ''}>
                  {shortHash(s.tx_hash)}
                </td>
              </tr>
            ))
          )}
        </Table>
      </Card>

      {/* ── Printable sales register ── */}
      <div className="print-only">
        <PrintDoc>
          <GovDocHeader settings={settings} title={TH.salesReportTitle} subtitle={TH.salesReport} periodText={periodText} />

          <GovSection no={1} title={TH.reportOverview}>
            <div className="summary-panel">
              <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
                <div className="min-w-0">
                  <div className="text-[9pt] text-slate-500">{TH.netRevenue}</div>
                  <div className="text-[24pt] font-bold leading-none text-emerald-800 mt-1">
                    {fmtAmt(total)}
                    <span className="text-[12pt] font-semibold text-slate-600"> บาท</span>
                  </div>
                  <div className="text-[9pt] text-slate-500 mt-1.5">
                    {TH.grossSales} {fmtAmt(gross)} บาท · {TH.totalDiscount} {fmtAmt(discount)} บาท
                  </div>
                </div>
                <div className="flex-1 max-w-xs min-w-56">
                  <div className="flex justify-between gap-6 text-[9pt]">
                    <span className="flex items-center gap-1.5 text-slate-600">
                      <span className="h-2 w-2 rounded-full bg-emerald-600" />
                      {TH.cash} <strong className="text-slate-800">{fmtAmt(cash)}</strong>
                    </span>
                    <span className="flex items-center gap-1.5 text-slate-600">
                      <span className="h-2 w-2 rounded-full bg-slate-300" />
                      {TH.promptpay} <strong className="text-slate-800">{fmtAmt(promptpay)}</strong>
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-4 gap-px bg-slate-200 border border-slate-200 rounded-lg overflow-hidden">
                <Stat label={TH.billCount} value={`${completed.length} ใบ`} />
                <Stat label={TH.grossSales} value={`${fmtAmt(gross)} บาท`} />
                <Stat label={TH.totalDiscount} value={`${fmtAmt(discount)} บาท`} />
                <Stat label={TH.netRevenue} value={`${fmtAmt(total)} บาท`} />
              </div>
              <p className="text-[9pt] text-slate-500 mt-2.5">{TH.attachmentNote}</p>
              <p className="text-[9pt] text-slate-500 mt-0.5">ขอบเขตการพิมพ์: {scopeText}</p>
            </div>
          </GovSection>

          <GovSection no={2} title={TH.records}>
            {sales === null ? (
              <p className="text-slate-500">…</p>
            ) : sales.length === 0 ? (
              <p className="text-slate-500">{TH.noSalesInPeriod}</p>
            ) : (
              <>
                <table className="report-table">
                  <thead>
                    <tr>
                      <th className="w-8">ที่</th>
                      <th className="w-16">เลขที่</th>
                      <th className="w-28">วัน/เวลา</th>
                      <th>{TH.event}</th>
                      <th>{TH.cashier}</th>
                      <th className="w-20">{TH.paymentMethod}</th>
                      <th className="w-16">{TH.status}</th>
                      <th className="w-20 text-right">{TH.total}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sales.slice(0, PRINT_CAP).map((s, i) => (
                      <tr key={s.id}>
                        <td className="text-center">{i + 1}</td>
                        <td className="font-mono">#{String(s.id).padStart(6, '0')}</td>
                        <td>{fmtDate(s.created_at)}</td>
                        <td>{s.event_name}</td>
                        <td>{s.cashier_name}</td>
                        <td className="text-center">{PAYMENT_LABELS[s.payment_method] ?? s.payment_method}</td>
                        <td className="text-center">{SALE_STATUS_LABELS[s.status] ?? s.status}</td>
                        <td className={`text-right font-semibold ${s.status === 'COMPLETED' ? '' : 'text-slate-400'}`}>{fmtAmt(s.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={7} className="text-right font-bold">
                        {TH.total} ({TH.netRevenue})
                      </td>
                      <td className="text-right font-bold">{fmtAmt(total)}</td>
                    </tr>
                  </tfoot>
                </table>
                {sales.length > PRINT_CAP && <p className="text-[9pt] text-slate-500 mt-1">{TH.reportTruncated}</p>}
              </>
            )}
          </GovSection>
        </PrintDoc>
      </div>

      {detail && (
        <Modal title={`${TH.receiptNo} #${String(detail.id).padStart(6, '0')}`} onClose={() => setDetail(null)}>
          <SaleDetail sale={detail} isSuper={isSuper} onChanged={() => { setDetail(null); load(); }} />
        </Modal>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white px-2 py-2 text-center">
      <div className="text-[8.5pt] text-slate-500 leading-tight">{label}</div>
      <div className="text-[11pt] font-bold text-slate-800 leading-tight mt-0.5">{value}</div>
    </div>
  );
}
