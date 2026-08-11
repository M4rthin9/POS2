import { useEffect, useState } from 'react';
import type { AdminEvent, AdminUser } from '../lib/api';
import { api } from '../lib/api';
import type { Sale } from '@cida/shared';
import { fmt, fmtDate, TH, PAYMENT_LABELS } from '@cida/shared';

export default function SalesPage() {
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [eventId, setEventId] = useState('');
  const [cashierId, setCashierId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  async function load() {
    setSales(null);
    try {
      const res = await api.adminSales({
        event_id: eventId ? Number(eventId) : undefined,
        cashier_id: cashierId ? Number(cashierId) : undefined,
        from: from || undefined,
        to: to || undefined,
      });
      setSales(res);
    } catch {
      setSales([]);
    }
  }

  useEffect(() => {
    api.adminEvents().then(setEvents).catch(() => {});
    api.adminUsers().then(setUsers).catch(() => {});
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, cashierId, from, to]);

  const total = (sales ?? []).reduce((a, s) => a + s.total, 0);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-800">{TH.sales}</h1>

      <div className="bg-white rounded-xl shadow-sm p-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
        <input value={from} onChange={(e) => setFrom(e.target.value)} type="date" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        <input value={to} onChange={(e) => setTo(e.target.value)} type="date" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>

      <div className="text-sm text-slate-600">
        {TH.total}: <span className="font-bold text-emerald-600">{fmt(total)}</span> ({sales?.length ?? 0} {TH.records})
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left font-medium">#</th>
                <th className="px-4 py-2 text-left font-medium">{TH.date}</th>
                <th className="px-4 py-2 text-left font-medium">{TH.event}</th>
                <th className="px-4 py-2 text-left font-medium">{TH.cashier}</th>
                <th className="px-4 py-2 text-left font-medium">{TH.paymentMethod}</th>
                <th className="px-4 py-2 text-right font-medium">{TH.subtotal}</th>
                <th className="px-4 py-2 text-right font-medium">{TH.discount}</th>
                <th className="px-4 py-2 text-right font-medium">{TH.total}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sales === null ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">…</td>
                </tr>
              ) : sales.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">{TH.noData}</td>
                </tr>
              ) : (
                sales.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono text-xs">#{String(s.id).padStart(6, '0')}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{fmtDate(s.created_at)}</td>
                    <td className="px-4 py-2">{s.event_name}</td>
                    <td className="px-4 py-2">{s.cashier_name}</td>
                    <td className="px-4 py-2">{PAYMENT_LABELS[s.payment_method] ?? s.payment_method}</td>
                    <td className="px-4 py-2 text-right">{fmt(s.subtotal)}</td>
                    <td className="px-4 py-2 text-right">{s.discount > 0 ? fmt(s.discount) : '—'}</td>
                    <td className="px-4 py-2 text-right font-semibold">{fmt(s.total)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
