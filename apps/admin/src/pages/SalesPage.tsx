import { useCallback, useEffect, useState } from 'react';
import type { AdminEvent, AdminUser } from '../lib/api';
import { api } from '../lib/api';
import type { Sale } from '@cida/shared';
import { fmt, fmtDate, TH, PAYMENT_LABELS, SALE_STATUS_LABELS, shortHash } from '@cida/shared';
import { useAuth } from '../store/auth';
import { Badge, Card, EmptyRow, ErrorBar, Modal, Table } from '../components/ui';
import SaleDetail from '../components/SaleDetail';

const STATUS_TONE: Record<string, string> = { COMPLETED: 'emerald', VOID: 'slate', REFUNDED: 'amber' };

export default function SalesPage() {
  const user = useAuth((s) => s.user);
  const isSuper = user?.role === 'superadmin';

  const [sales, setSales] = useState<Sale[] | null>(null);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
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
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Voided and refunded rows are listed but excluded from the revenue total.
  const total = (sales ?? []).filter((s) => s.status === 'COMPLETED').reduce((a, s) => a + s.total, 0);

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

      <div className="text-sm text-slate-600">
        {TH.netRevenue}: <span className="font-bold text-emerald-600">{fmt(total)}</span> ({sales?.length ?? 0} {TH.records})
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

      {detail && (
        <Modal title={`${TH.receiptNo} #${String(detail.id).padStart(6, '0')}`} onClose={() => setDetail(null)}>
          <SaleDetail sale={detail} isSuper={isSuper} onChanged={() => { setDetail(null); load(); }} />
        </Modal>
      )}
    </div>
  );
}
