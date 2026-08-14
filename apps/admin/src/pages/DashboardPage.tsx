import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Overview, Sale, Stats } from '@cida/shared';
import { fmt, fmtDate, fmtDateOnly, PAYMENT_LABELS, TH, toISODate } from '@cida/shared';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';

type Period = 'today' | '7d' | '30d' | 'all' | 'custom';

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

const PRESETS: { id: Period; label: string }[] = [
  { id: 'today', label: 'วันนี้' },
  { id: '7d', label: '7 วัน' },
  { id: '30d', label: '30 วัน' },
  { id: 'all', label: 'ทั้งหมด' },
];

function periodRange(period: Period, customFrom: string, customTo: string): { from?: string; to?: string } {
  if (period === 'custom') return { from: customFrom || undefined, to: customTo || undefined };
  const today = new Date();
  if (period === 'today') return { from: toISODate(today), to: toISODate(today) };
  if (period === '7d') return { from: toISODate(addDays(today, -6)), to: toISODate(today) };
  if (period === '30d') return { from: toISODate(addDays(today, -29)), to: toISODate(today) };
  return {};
}

function periodLabel(period: Period, customFrom: string, customTo: string): string {
  if (period === 'all') return 'ทุกช่วงเวลา';
  if (period === 'custom') {
    if (customFrom && customTo) return `${fmtDateOnly(customFrom)} – ${fmtDateOnly(customTo)}`;
    return customFrom || customTo || 'ช่วงเวลา';
  }
  const r = periodRange(period, '', '');
  if (period === 'today') return fmtDateOnly(r.from!);
  return `${fmtDateOnly(r.from!)} – ${fmtDateOnly(r.to!)}`;
}

export default function DashboardPage() {
  const user = useAuth((s) => s.user);
  const isSuper = user?.role === 'superadmin';

  const [overview, setOverview] = useState<Overview | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<{ id: number; name: string }[]>([]);
  const [sales, setSales] = useState<Sale[] | null>(null);

  const [period, setPeriod] = useState<Period>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [eventFilter, setEventFilter] = useState('');
  const [search, setSearch] = useState('');

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirm, setConfirm] = useState<{ mode: 'single'; sale: Sale } | { mode: 'bulk' } | null>(null);
  const [detail, setDetail] = useState<Sale | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    const { from, to } = periodRange(period, customFrom, customTo);
    try {
      const [ov, st, evs] = await Promise.all([
        api.overview(),
        api.stats({ from, to }),
        api.adminEvents().catch(() => []),
      ]);
      setOverview(ov);
      setStats(st);
      setEvents(evs);
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.error);
    }
  }, [period, customFrom, customTo]);

  const loadSales = useCallback(async () => {
    const { from, to } = periodRange(period, customFrom, customTo);
    setSales(null);
    try {
      const res = await api.adminSales({
        from,
        to,
        event_id: eventFilter ? Number(eventFilter) : undefined,
      });
      setSales(res);
    } catch {
      setSales([]);
    }
  }, [period, customFrom, customTo, eventFilter]);

  useEffect(() => {
    api.adminSettings().then(setSettings).catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadSales();
  }, [loadSales]);

  const filtered = useMemo(() => {
    if (!search) return sales ?? [];
    const q = search.toLowerCase();
    return (sales ?? []).filter(
      (s) => String(s.id).includes(q) || (s.cashier_name ?? '').toLowerCase().includes(q) || (s.event_name ?? '').toLowerCase().includes(q),
    );
  }, [sales, search]);

  const selectedSales = useMemo(() => (sales ?? []).filter((s) => selected.has(s.id)), [sales, selected]);
  const selectedTotal = selectedSales.reduce((a, s) => a + s.total, 0);

  const allChecked = sales !== null && sales.length > 0 && filtered.length === selected.size && filtered.every((s) => selected.has(s.id));

  function toggleAll() {
    if (allChecked) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((s) => s.id)));
    }
  }

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirmDelete() {
    if (!confirm) return;
    setBusy(true);
    setError('');
    try {
      if (confirm.mode === 'single') {
        await api.deleteSale(confirm.sale.id);
        setConfirm(null);
      } else {
        const ids = [...selected];
        await api.bulkDeleteSales(ids);
        setSelected(new Set());
        setConfirm(null);
      }
      await Promise.all([load(), loadSales()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.error);
    } finally {
      setBusy(false);
    }
  }

  const cards = [
    { label: 'รายได้ (ช่วง)', value: stats ? fmt(stats.total_revenue) : '…', accent: 'text-emerald-600' },
    { label: 'ยอดขาย (ช่วง)', value: stats ? String(stats.total_sales) : '…', accent: 'text-slate-800' },
    { label: TH.todayRevenue, value: overview ? fmt(overview.today_revenue) : '…', accent: 'text-emerald-600' },
    { label: TH.todaySales, value: overview ? String(overview.today_sales) : '…', accent: 'text-slate-800' },
    { label: TH.products, value: overview ? String(overview.total_products) : '…', accent: 'text-slate-800' },
    { label: TH.users, value: overview ? String(overview.total_users) : '…', accent: 'text-slate-800' },
  ];

  const daily = stats?.daily ?? {};
  const days = Object.keys(daily).sort();
  const maxDay = Math.max(1, ...Object.values(daily));

  const logo = settings.logo_url || '/icon-192.svg';

  return (
    <div>
      {/* Toolbar */}
      <div className="no-print mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">{TH.dashboard}</h1>
          <p className="text-sm text-slate-500">
            {overview?.active_event ? `🎪 ${TH.activeEvent}: ${overview.active_event}` : 'ไม่มีกิจกรรมที่เปิดขาย'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 bg-white rounded-xl border border-slate-200 p-1">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${period === p.id ? 'bg-slate-900 text-white shadow' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setPeriod('custom')}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition ${period === 'custom' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            กำหนดเอง
          </button>
          {period === 'custom' && (
            <>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="border border-slate-200 rounded-xl px-2 py-1.5 text-sm" />
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="border border-slate-200 rounded-xl px-2 py-1.5 text-sm" />
            </>
          )}
          <button onClick={() => window.print()} className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-500 transition shadow-sm">
            🖨 {TH.print}
          </button>
        </div>
      </div>

      {error && (
        <div className="no-print mb-3 text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2.5 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="font-bold px-2">
            ✕
          </button>
        </div>
      )}

      <div id="report-print" className="space-y-4">
        {/* Report header */}
        <div className="bg-white rounded-2xl shadow-sm p-5 text-center">
          {logo && <img src={logo} alt="" className="h-16 w-16 object-contain mx-auto mb-2 rounded-xl" />}
          <h2 className="text-lg font-bold text-slate-800">{settings.org_name || 'CIDA'}</h2>
          {settings.org_subtitle && <p className="text-sm text-slate-500">{settings.org_subtitle}</p>}
          {settings.org_address && <p className="text-sm text-slate-500">{settings.org_address}</p>}
          <div className="mt-2 inline-block bg-emerald-50 text-emerald-700 text-sm font-semibold rounded-full px-4 py-1">
            รายงานการขาย · {periodLabel(period, customFrom, customTo)}
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {cards.map((c) => (
            <div key={c.label} className="bg-white rounded-2xl shadow-sm p-4">
              <div className="text-xs text-slate-500">{c.label}</div>
              <div className={`text-xl font-bold mt-1 ${c.accent}`}>{c.value}</div>
            </div>
          ))}
        </div>

        {/* Sales table */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-slate-800">🧾 การขายในรอบ</h3>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`${TH.search} (#, ${TH.cashier})`}
                className="no-print border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
              <select
                value={eventFilter}
                onChange={(e) => setEventFilter(e.target.value)}
                className="no-print border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
              >
                <option value="">— {TH.event} —</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {isSuper && selected.size > 0 && (
            <div className="no-print flex items-center justify-between bg-rose-50 px-4 py-2.5 border-b border-rose-100">
              <span className="text-sm text-rose-700 font-semibold">เลือกแล้ว {selected.size} รายการ · {fmt(selectedTotal)}</span>
              <button onClick={() => setConfirm({ mode: 'bulk' })} disabled={busy} className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-bold hover:bg-red-500 disabled:opacity-40 transition">
                🗑 ลบที่เลือก
              </button>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  {isSuper && (
                    <th className="no-print px-3 py-2">
                      <input type="checkbox" checked={allChecked} onChange={toggleAll} className="w-4 h-4 accent-emerald-600" />
                    </th>
                  )}
                  <th className="px-4 py-2 text-left font-medium">#</th>
                  <th className="px-4 py-2 text-left font-medium">{TH.date}</th>
                  <th className="px-4 py-2 text-left font-medium">{TH.event}</th>
                  <th className="px-4 py-2 text-left font-medium">{TH.cashier}</th>
                  <th className="px-4 py-2 text-left font-medium">{TH.paymentMethod}</th>
                  <th className="px-4 py-2 text-right font-medium">{TH.subtotal}</th>
                  <th className="px-4 py-2 text-right font-medium">{TH.discount}</th>
                  <th className="px-4 py-2 text-right font-medium">{TH.total}</th>
                  {isSuper && <th className="no-print px-3 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sales === null ? (
                  <tr>
                    <td colSpan={isSuper ? 10 : 9} className="px-4 py-8 text-center text-slate-400">…</td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={isSuper ? 10 : 9} className="px-4 py-8 text-center text-slate-400">{TH.noData}</td>
                  </tr>
                ) : (
                  filtered.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setDetail(s)}>
                      {isSuper && (
                        <td className="no-print px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleOne(s.id)} className="w-4 h-4 accent-emerald-600" />
                        </td>
                      )}
                      <td className="px-4 py-2 font-mono text-xs">#{String(s.id).padStart(6, '0')}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{fmtDate(s.created_at)}</td>
                      <td className="px-4 py-2 max-w-40 truncate">{s.event_name}</td>
                      <td className="px-4 py-2">{s.cashier_name}</td>
                      <td className="px-4 py-2">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${s.payment_method === 'PromptPay' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-600'}`}>
                          {PAYMENT_LABELS[s.payment_method] ?? s.payment_method}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">{fmt(s.subtotal)}</td>
                      <td className="px-4 py-2 text-right">{s.discount > 0 ? fmt(s.discount) : '—'}</td>
                      <td className="px-4 py-2 text-right font-semibold">{fmt(s.total)}</td>
                      {isSuper && (
                        <td className="no-print px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => setConfirm({ mode: 'single', sale: s })}
                            className="text-red-500 hover:text-red-700 text-xs font-semibold"
                            title={TH.delete}
                          >
                            🗑
                          </button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Breakdowns */}
        {stats && (
          <div className="grid lg:grid-cols-3 gap-3">
            <div className="bg-white rounded-2xl shadow-sm p-4">
              <h3 className="font-semibold text-slate-800 mb-3">{TH.paymentBreakdown}</h3>
              {Object.keys(stats.payment_breakdown).length === 0 ? (
                <p className="text-sm text-slate-400">{TH.noData}</p>
              ) : (
                <ul className="space-y-2">
                  {Object.entries(stats.payment_breakdown).map(([k, v]) => (
                    <li key={k} className="flex justify-between text-sm">
                      <span className="text-slate-600">{PAYMENT_LABELS[k] || k}</span>
                      <span className="font-semibold">{fmt(v)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="bg-white rounded-2xl shadow-sm p-4">
              <h3 className="font-semibold text-slate-800 mb-3">{TH.divisionBreakdown}</h3>
              {Object.keys(stats.division_breakdown).length === 0 ? (
                <p className="text-sm text-slate-400">{TH.noData}</p>
              ) : (
                <ul className="space-y-2">
                  {Object.entries(stats.division_breakdown).map(([k, v]) => (
                    <li key={k} className="flex justify-between text-sm">
                      <span className="text-slate-600">{k}</span>
                      <span className="font-semibold">{fmt(v)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="bg-white rounded-2xl shadow-sm p-4">
              <h3 className="font-semibold text-slate-800 mb-3">{TH.productBreakdown}</h3>
              {Object.keys(stats.product_breakdown).length === 0 ? (
                <p className="text-sm text-slate-400">{TH.noData}</p>
              ) : (
                <ul className="space-y-2 max-h-64 overflow-y-auto">
                  {Object.entries(stats.product_breakdown).map(([k, v]) => (
                    <li key={k} className="flex justify-between text-sm">
                      <span className="text-slate-600 truncate pr-2">{k}</span>
                      <span className="font-semibold whitespace-nowrap">
                        {v.qty}× {fmt(v.revenue)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* Daily chart */}
        {days.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm p-4">
            <h3 className="font-semibold text-slate-800 mb-3">{TH.dailyChart}</h3>
            <div className="flex items-end gap-2 h-40 overflow-x-auto">
              {days.map((d) => (
                <div key={d} className="flex flex-col items-center flex-none">
                  <div className="text-[10px] text-slate-500">{fmt(daily[d])}</div>
                  <div className="w-10 bg-emerald-500 rounded-t" style={{ height: `${Math.round((daily[d] / maxDay) * 100)}px`, minHeight: 4 }} />
                  <div className="text-[10px] text-slate-500 mt-1">{d.slice(5)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Delete confirm */}
      {confirm && (
        <div className="no-print fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="text-3xl mb-2">🗑</div>
            <h3 className="text-lg font-bold text-slate-800 mb-1">ยืนยันการลบ</h3>
            {confirm.mode === 'single' ? (
              <p className="text-sm text-slate-600">
                ลบใบเสร็จ <span className="font-semibold">#{String(confirm.sale.id).padStart(6, '0')}</span> ({fmt(confirm.sale.total)}) ถาวร?
                <br />
                <span className="text-red-500">สต็อกสินค้าจะถูกคืนอัตโนมัติ</span>
              </p>
            ) : (
              <p className="text-sm text-slate-600">
                ลบ <span className="font-semibold">{selected.size} รายการ</span> รวม {fmt(selectedTotal)} ถาวร?
                <br />
                <span className="text-red-500">สต็อกสินค้าจะถูกคืนอัตโนมัติ</span>
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 mt-5">
              <button onClick={() => setConfirm(null)} disabled={busy} className="py-3 rounded-xl bg-slate-100 text-slate-600 font-semibold hover:bg-slate-200 transition">
                {TH.cancel}
              </button>
              <button onClick={confirmDelete} disabled={busy} className="py-3 rounded-xl bg-red-600 text-white font-bold hover:bg-red-500 disabled:opacity-40 transition">
                {busy ? '…' : `ลบ ${confirm.mode === 'bulk' ? selected.size : 1} รายการ`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sale detail */}
      {detail && (
        <div className="no-print fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-md shadow-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-slate-800">ใบเสร็จ #{String(detail.id).padStart(6, '0')}</h3>
              <button onClick={() => setDetail(null)} className="text-slate-400 hover:text-slate-600 text-xl px-1">
                ✕
              </button>
            </div>
            <div className="text-xs text-slate-500 space-y-0.5 mb-3">
              <div>{fmtDate(detail.created_at)} · {detail.event_name}</div>
              <div>{TH.cashier}: {detail.cashier_name} · {PAYMENT_LABELS[detail.payment_method] ?? detail.payment_method}</div>
            </div>
            <div className="border-t border-dashed pt-3 space-y-1.5">
              {(detail.items ?? []).map((it) => (
                <div key={it.id} className="flex justify-between text-sm">
                  <span className="text-slate-700">
                    {it.name} <span className="text-slate-400">×{Number.isInteger(it.qty) ? it.qty : it.qty.toFixed(2)}</span>
                  </span>
                  <span className="font-medium">{fmt(it.line_total)}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-dashed mt-3 pt-3 space-y-1">
              <div className="flex justify-between text-sm text-slate-600">
                <span>{TH.subtotal}</span>
                <span>{fmt(detail.subtotal)}</span>
              </div>
              {detail.discount > 0 && (
                <div className="flex justify-between text-sm text-slate-600">
                  <span>{TH.discount}</span>
                  <span>-{fmt(detail.discount)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-lg">
                <span>{TH.total}</span>
                <span className="text-emerald-600">{fmt(detail.total)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
