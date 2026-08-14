import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DashboardPayload, Sale } from '@cida/shared';
import { AUDIT_ACTION_LABELS, EVENT_STATUS_LABELS, PAYMENT_LABELS, SALE_STATUS_LABELS, TH, fmt } from '@cida/shared';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import { periodLabel, periodRange } from '../lib/period';
import PeriodPicker, { type PeriodState } from '../components/PeriodPicker';
import { Badge, Button, Card, EmptyRow, ErrorBar, MiniBarChart, Modal, ShareBar, StatTile, Table } from '../components/ui';
import SaleDetail from '../components/SaleDetail';

const REFRESH_MS = 30_000;

const STATUS_TONE: Record<string, string> = { COMPLETED: 'emerald', VOID: 'slate', REFUNDED: 'amber' };
const EVENT_TONE: Record<string, string> = { ACTIVE: 'emerald', UPCOMING: 'sky', CLOSED: 'slate' };

function relative(iso: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso.endsWith('Z') ? iso : iso.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(t)) return '—';
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'เมื่อครู่';
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} ชม.ที่แล้ว`;
  return `${Math.round(hrs / 24)} วันที่แล้ว`;
}

export default function DashboardPage() {
  const user = useAuth((s) => s.user);
  const isSuper = user?.role === 'superadmin';

  const [range, setRange] = useState<PeriodState>({ period: 'today', from: '', to: '' });
  const [eventFilter, setEventFilter] = useState('');
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [detail, setDetail] = useState<Sale | null>(null);
  const [error, setError] = useState('');
  const [live, setLive] = useState(true);
  const [tick, setTick] = useState(0);
  const firstLoad = useRef(true);

  const load = useCallback(async () => {
    const { from, to } = periodRange(range.period, range.from, range.to);
    try {
      const payload = await api.dashboard({ from, to, event_id: eventFilter ? Number(eventFilter) : undefined });
      setData(payload);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.error);
    } finally {
      firstLoad.current = false;
    }
  }, [range, eventFilter]);

  useEffect(() => {
    load();
  }, [load, tick]);

  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => setTick((t) => t + 1), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [live]);

  const kpi = data?.kpi;
  const label = periodLabel(range.period, range.from, range.to);
  const activeEvent = useMemo(() => data?.events.find((e) => e.status === 'ACTIVE') ?? null, [data]);

  const tiles = [
    { label: TH.grossSales, value: kpi ? fmt(kpi.gross) : '…', tone: 'slate' as const, icon: '💰' },
    { label: TH.netRevenue, value: kpi ? fmt(kpi.net) : '…', sub: kpi ? `${TH.totalDiscount} ${fmt(kpi.discount)}` : undefined, tone: 'emerald' as const, icon: '📈' },
    { label: TH.cashOnHand, value: kpi ? fmt(kpi.cash_total) : '…', sub: data?.zreport.closed ? TH.dayClosed : TH.dayOpen, tone: 'amber' as const, icon: '💵' },
    {
      label: TH.ordersCompleted,
      value: kpi ? String(kpi.orders_completed) : '…',
      sub: kpi ? `${TH.ordersVoid} ${kpi.orders_void} · ${TH.ordersRefunded} ${kpi.orders_refunded}` : undefined,
      tone: 'sky' as const,
      icon: '🧾',
    },
    { label: TH.avgBasket, value: kpi ? fmt(kpi.avg_basket) : '…', tone: 'violet' as const, icon: '🛒' },
    {
      label: TH.lowStockAlerts,
      value: kpi ? String(kpi.low_stock_count) : '…',
      tone: (kpi && kpi.low_stock_count > 0 ? 'rose' : 'slate') as 'rose' | 'slate',
      icon: '📦',
    },
  ];

  return (
    <div>
      {/* Toolbar */}
      <div className="no-print mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">{TH.operationsDashboard}</h1>
          <p className="text-sm text-slate-500">
            {activeEvent ? `🎪 ${TH.activeEvent}: ${activeEvent.name}` : TH.noActiveEvent} · {label}
          </p>
        </div>
        <PeriodPicker value={range} onChange={setRange}>
          <select
            value={eventFilter}
            onChange={(e) => setEventFilter(e.target.value)}
            className="border border-slate-200 rounded-xl px-2 py-1.5 text-sm bg-white"
          >
            <option value="">— {TH.event} —</option>
            {(data?.events ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-slate-500 px-2">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} className="w-3.5 h-3.5 accent-emerald-600" />
            {TH.autoRefresh}
          </label>
          <Button onClick={() => setTick((t) => t + 1)}>↻ {TH.refresh}</Button>
        </PeriodPicker>
      </div>

      <ErrorBar message={error} onDismiss={() => setError('')} />

      {/* Hero KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5 mb-3">
        {tiles.map((t) => (
          <StatTile key={t.label} {...t} />
        ))}
      </div>

      {/* Quick actions */}
      <div className="no-print mb-3 flex flex-wrap gap-2">
        <a
          href={import.meta.env.VITE_POS_URL || 'http://localhost:5173'}
          target="_blank"
          rel="noreferrer"
          className="px-3 py-1.5 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-500 shadow-sm transition"
        >
          🛒 {TH.openPos}
        </a>
        <Link to="/zreport" className="px-3 py-1.5 rounded-xl text-sm font-semibold bg-slate-900 text-white hover:bg-slate-800 shadow-sm transition">
          📋 {TH.xReport} / {TH.zReport}
        </Link>
        <Link to="/report" className="px-3 py-1.5 rounded-xl text-sm font-semibold bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition">
          🧾 {TH.salesReport}
        </Link>
        <Link to="/sales" className="px-3 py-1.5 rounded-xl text-sm font-semibold bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition">
          🔎 {TH.voidSale}
        </Link>
        <Link to="/audit" className="px-3 py-1.5 rounded-xl text-sm font-semibold bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition">
          🗒 {TH.auditLog}
        </Link>
      </div>

      {/* 4-column operations grid: sales+ops span 2, then finance, then inventory */}
      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-4 gap-3 items-start">
        {/* ── Columns 1-2: sales & operations ── */}
        <div className="2xl:col-span-2 space-y-3">
          <Card title={`🧾 ${TH.liveSales}`} dense>
            <Table
              head={
                <tr>
                  <th className="px-3 py-2 text-left font-medium">#</th>
                  <th className="px-3 py-2 text-left font-medium">{TH.date}</th>
                  <th className="px-3 py-2 text-left font-medium">{TH.cashier}</th>
                  <th className="px-3 py-2 text-left font-medium">{TH.paymentMethod}</th>
                  <th className="px-3 py-2 text-left font-medium">{TH.status}</th>
                  <th className="px-3 py-2 text-right font-medium">{TH.total}</th>
                </tr>
              }
            >
              {!data ? (
                <EmptyRow colSpan={6} label="…" />
              ) : data.recent_sales.length === 0 ? (
                <EmptyRow colSpan={6} />
              ) : (
                data.recent_sales.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setDetail(s)}>
                    <td className="px-3 py-1.5 font-mono text-xs">#{String(s.id).padStart(6, '0')}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-xs">{relative(s.created_at)}</td>
                    <td className="px-3 py-1.5 truncate max-w-32">{s.cashier_name}</td>
                    <td className="px-3 py-1.5">
                      <Badge tone={s.payment_method === 'PromptPay' ? 'emerald' : 'slate'}>
                        {PAYMENT_LABELS[s.payment_method] ?? s.payment_method}
                      </Badge>
                    </td>
                    <td className="px-3 py-1.5">
                      <Badge tone={STATUS_TONE[s.status]}>{SALE_STATUS_LABELS[s.status] ?? s.status}</Badge>
                    </td>
                    <td className={`px-3 py-1.5 text-right font-semibold tabular-nums ${s.status === 'COMPLETED' ? '' : 'line-through text-slate-400'}`}>
                      {fmt(s.total)}
                    </td>
                  </tr>
                ))
              )}
            </Table>
          </Card>

          <div className="grid md:grid-cols-2 gap-3">
            <Card title={`🎪 ${TH.eventStatus}`} dense bodyClassName="p-3 space-y-2 max-h-72 overflow-y-auto">
              {(data?.events ?? []).length === 0 ? (
                <p className="text-sm text-slate-400">{TH.noData}</p>
              ) : (
                (data?.events ?? []).map((e) => (
                  <div key={e.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-800 truncate">{e.name}</div>
                      <div className="text-[11px] text-slate-400">
                        {e.code} · {TH.lastSale} {relative(e.last_sale_at)}
                      </div>
                    </div>
                    <div className="text-right flex-none">
                      <Badge tone={EVENT_TONE[e.status]}>{EVENT_STATUS_LABELS[e.status] ?? e.status}</Badge>
                      <div className="text-xs font-semibold text-slate-700 mt-1 tabular-nums">{fmt(e.today_revenue)}</div>
                      <div className="text-[10px] text-slate-400">{e.today_sales} {TH.records}</div>
                    </div>
                  </div>
                ))
              )}
            </Card>

            <Card title={`👥 ${TH.cashierActivity}`} dense bodyClassName="p-3 space-y-2 max-h-72 overflow-y-auto">
              {(data?.cashiers ?? []).length === 0 ? (
                <p className="text-sm text-slate-400">{TH.noData}</p>
              ) : (
                (data?.cashiers ?? []).map((u) => (
                  <div key={u.user_id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-800 truncate">{u.display_name}</div>
                      <div className="text-[11px] text-slate-400">
                        {u.sale_count} {TH.records} · {relative(u.last_sale_at)}
                      </div>
                    </div>
                    <div className="text-right flex-none">
                      <div className="text-sm font-semibold text-emerald-600 tabular-nums">{fmt(u.revenue)}</div>
                      <div className="text-[10px] text-slate-400 tabular-nums">
                        {TH.cash} {fmt(u.cash)} · {TH.promptpay} {fmt(u.promptpay)}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </Card>
          </div>

          <Card title={`📊 ${TH.dailyChart}`} dense>
            <MiniBarChart data={data?.daily ?? {}} format={fmt} />
          </Card>
        </div>

        {/* ── Column 3: daily financial summary ── */}
        <div className="space-y-3">
          <Card title={`💳 ${TH.financialSummary}`} dense bodyClassName="p-4 space-y-3">
            <ShareBar
              parts={[
                { label: TH.cash, value: kpi?.cash_total ?? 0, color: 'bg-slate-400' },
                { label: TH.promptpay, value: kpi?.promptpay_total ?? 0, color: 'bg-emerald-500' },
              ]}
            />
            <ul className="space-y-1.5">
              {Object.entries(data?.payment_breakdown ?? {}).map(([k, v]) => (
                <li key={k} className="flex justify-between text-sm">
                  <span className="text-slate-600">{PAYMENT_LABELS[k] || k}</span>
                  <span className="font-semibold tabular-nums">{fmt(v)}</span>
                </li>
              ))}
              {Object.keys(data?.payment_breakdown ?? {}).length === 0 && <li className="text-sm text-slate-400">{TH.noData}</li>}
            </ul>

            <div className="border-t border-dashed border-slate-200 pt-3 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">{TH.cashExpected}</span>
                <span className="font-semibold tabular-nums">{fmt(data?.zreport.cash_expected ?? 0)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">{TH.cashCounted}</span>
                <span className="font-semibold tabular-nums">
                  {data?.zreport.cash_counted === null || data?.zreport.cash_counted === undefined ? '—' : fmt(data.zreport.cash_counted)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">{TH.cashVariance}</span>
                <span className={`font-bold tabular-nums ${!data?.zreport.variance ? 'text-slate-500' : 'text-rose-600'}`}>
                  {data?.zreport.variance === null || data?.zreport.variance === undefined ? '—' : fmt(data.zreport.variance)}
                </span>
              </div>
              <div className="flex justify-between items-center pt-1">
                <Badge tone={data?.zreport.closed ? 'emerald' : 'amber'}>{data?.zreport.closed ? TH.dayClosed : TH.dayOpen}</Badge>
                <Link to="/zreport" className="text-xs font-semibold text-emerald-600 hover:text-emerald-700">
                  {TH.closeDay} →
                </Link>
              </div>
            </div>
          </Card>

          <Card title={`🏦 ${TH.promptpay}`} dense bodyClassName="p-4 space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">{TH.amount}</span>
              <span className="font-semibold tabular-nums text-emerald-600">{fmt(data?.promptpay_trace.amount ?? 0)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">{TH.billCount}</span>
              <span className="font-semibold tabular-nums">{data?.promptpay_trace.count ?? 0}</span>
            </div>
            <p className="text-[10px] text-slate-400 pt-1">{TH.promptPayTraceNote}</p>
            <Link to="/report" className="no-print block text-xs font-semibold text-emerald-600 hover:text-emerald-700">
              {TH.reportPromptPayTrace} →
            </Link>
          </Card>

          <Card title={`🗂️ ${TH.divisionBreakdown}`} dense bodyClassName="p-4 max-h-56 overflow-y-auto">
            <ul className="space-y-1.5">
              {Object.entries(data?.division_breakdown ?? {}).map(([k, v]) => (
                <li key={k} className="flex justify-between text-sm">
                  <span className="text-slate-600 truncate pr-2">{k}</span>
                  <span className="font-semibold tabular-nums whitespace-nowrap">{fmt(v)}</span>
                </li>
              ))}
              {Object.keys(data?.division_breakdown ?? {}).length === 0 && <li className="text-sm text-slate-400">{TH.noData}</li>}
            </ul>
          </Card>
        </div>

        {/* ── Column 4: inventory & operational alerts ── */}
        <div className="space-y-3">
          <Card title={`📦 ${TH.inventoryAlerts}`} dense bodyClassName="p-3 space-y-2 max-h-96 overflow-y-auto">
            {(data?.low_stock ?? []).length === 0 ? (
              <p className="text-sm text-slate-400">{TH.noData}</p>
            ) : (
              (data?.low_stock ?? []).map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-800 truncate">{p.name}</div>
                    <div className="text-[11px] text-slate-400">
                      {p.sku} · {p.division_name ?? '—'}
                    </div>
                  </div>
                  <div className="text-right flex-none">
                    <Badge tone={p.stock === 0 ? 'rose' : 'amber'}>
                      {p.stock === 0 ? TH.outOfStock : `${TH.remaining} ${p.stock}`}
                    </Badge>
                    <div className="text-[10px] text-slate-400 mt-1">
                      {TH.soldToday} {p.sold_today}
                    </div>
                  </div>
                </div>
              ))
            )}
          </Card>

          <Card
            title={`🗒 ${TH.auditLog}`}
            dense
            bodyClassName="p-3 space-y-2 max-h-80 overflow-y-auto"
            action={
              <Link to="/audit" className="no-print text-xs font-semibold text-emerald-600 hover:text-emerald-700">
                →
              </Link>
            }
          >
            {(data?.audit_tail ?? []).length === 0 ? (
              <p className="text-sm text-slate-400">{TH.noData}</p>
            ) : (
              (data?.audit_tail ?? []).map((a) => (
                <div key={a.id} className="text-xs border-l-2 border-slate-200 pl-2 py-0.5">
                  <div className="font-medium text-slate-700">{AUDIT_ACTION_LABELS[a.action] ?? a.action}</div>
                  <div className="text-slate-400">
                    {a.actor_name ?? '—'} · {a.entity}
                    {a.entity_id ? ` #${a.entity_id}` : ''} · {relative(a.created_at)}
                  </div>
                </div>
              ))
            )}
          </Card>
        </div>
      </div>

      {detail && (
        <Modal title={`${TH.receiptNo} #${String(detail.id).padStart(6, '0')}`} onClose={() => setDetail(null)}>
          <SaleDetail sale={detail} isSuper={isSuper} onChanged={() => { setDetail(null); setTick((t) => t + 1); }} />
        </Modal>
      )}
    </div>
  );
}
