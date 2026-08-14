import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DashboardPayload, Sale } from '@cida/shared';
import { AUDIT_ACTION_LABELS, EVENT_STATUS_LABELS, PAYMENT_LABELS, SALE_STATUS_LABELS, TH, fmt, fmtAmt, fmtDate, fmtThaiLong } from '@cida/shared';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import { periodLabel, periodRange } from '../lib/period';
import PeriodPicker, { type PeriodState } from '../components/PeriodPicker';
import { Badge, Button, Card, EmptyRow, ErrorBar, MiniBarChart, Modal, ShareBar, StatTile, Table } from '../components/ui';
import SaleDetail from '../components/SaleDetail';
import { GovDocHeader, GovSection, PrintDoc } from '../components/PrintDoc';

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
  const [settings, setSettings] = useState<Record<string, string>>({});
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
    api.adminSettings().then(setSettings).catch(() => {});
  }, []);

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

  const paid = (kpi?.cash_total ?? 0) + (kpi?.promptpay_total ?? 0);
  const cashShare = paid > 0 ? ((kpi?.cash_total ?? 0) / paid) * 100 : 0;
  const ppShare = paid > 0 ? ((kpi?.promptpay_total ?? 0) / paid) * 100 : 0;

  const dailyEntries = Object.entries(data?.daily ?? {}).sort(([a], [b]) => a.localeCompare(b));
  let run = 0;
  const dailyCum = dailyEntries.map(([, v]) => (run += v));
  const divTotal = Object.values(data?.division_breakdown ?? {}).reduce((a, b) => a + b, 0);

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
          <Button variant="primary" onClick={() => window.print()}>🖨 {TH.print}</Button>
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

      {/* ── Printable sales report (print only) ── */}
      <div className="print-only">
        <PrintDoc>
          <GovDocHeader settings={settings} title={TH.salesReportTitle} subtitle={TH.operationsDashboard} periodText={label} />

          {data && (
            <>
              <GovSection no={1} title={TH.reportOverview}>
                <div className="summary-panel">
                  <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
                    <div className="min-w-0">
                      <div className="text-[9pt] text-slate-500">{TH.netRevenue}</div>
                      <div className="text-[24pt] font-bold leading-none text-emerald-800 mt-1">
                        {fmtAmt(kpi?.net ?? 0)}
                        <span className="text-[12pt] font-semibold text-slate-600"> บาท</span>
                      </div>
                      <div className="text-[9pt] text-slate-500 mt-1.5">
                        {TH.grossSales} {fmtAmt(kpi?.gross ?? 0)} บาท · {TH.totalDiscount} {fmtAmt(kpi?.discount ?? 0)} บาท
                      </div>
                    </div>

                    {paid > 0 && (
                      <div className="flex-1 max-w-xs min-w-56">
                        <div className="flex h-2.5 rounded-full overflow-hidden bg-slate-100 border border-slate-200">
                          <div className="h-full bg-emerald-600" style={{ width: `${cashShare}%` }} />
                          <div className="h-full bg-slate-300" style={{ width: `${ppShare}%` }} />
                        </div>
                        <div className="flex justify-between gap-6 mt-2 text-[9pt]">
                          <span className="flex items-center gap-1.5 text-slate-600">
                            <span className="h-2 w-2 rounded-full bg-emerald-600" />
                            {TH.cash} <strong className="text-slate-800">{fmtAmt(kpi?.cash_total ?? 0)}</strong>
                          </span>
                          <span className="flex items-center gap-1.5 text-slate-600">
                            <span className="h-2 w-2 rounded-full bg-slate-300" />
                            {TH.promptpay} <strong className="text-slate-800">{fmtAmt(kpi?.promptpay_total ?? 0)}</strong>
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 grid grid-cols-4 gap-px bg-slate-200 border border-slate-200 rounded-lg overflow-hidden">
                    <Stat label={TH.eventCount} value={`${data.events.length} กิจกรรม`} />
                    <Stat label={TH.billCount} value={`${kpi?.orders_completed ?? 0} ใบ`} />
                    <Stat label={TH.avgBasket} value={`${fmtAmt(kpi?.avg_basket ?? 0)} บาท`} />
                    <Stat label={TH.lowStockAlerts} value={`${kpi?.low_stock_count ?? 0} รายการ`} />
                  </div>
                  <p className="text-[9pt] text-slate-500 mt-2.5">{TH.attachmentNote}</p>
                </div>
              </GovSection>

              <GovSection no={2} title={TH.dailyChart}>
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>วันที่</th>
                      <th className="w-32 text-right">ยอดจำหน่าย (บาท)</th>
                      <th className="w-32 text-right">ยอดสะสม (บาท)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyEntries.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="text-center text-slate-500 py-3">
                          {TH.noData}
                        </td>
                      </tr>
                    ) : (
                      dailyEntries.map(([day, v], i) => (
                        <tr key={day}>
                          <td>{fmtThaiLong(day)}</td>
                          <td className="text-right">{fmtAmt(v)}</td>
                          <td className="text-right text-slate-500">{fmtAmt(dailyCum[i] ?? 0)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="text-right font-bold">{TH.totalAllEvents}</td>
                      <td className="text-right font-bold">{fmtAmt(dailyCum.length ? dailyCum[dailyCum.length - 1] : 0)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </GovSection>

              <GovSection no={3} title={TH.liveSales}>
                {data.recent_sales.length === 0 ? (
                  <p className="text-slate-500">{TH.noData}</p>
                ) : (
                  <>
                    <table className="report-table">
                      <thead>
                        <tr>
                          <th className="w-8">ที่</th>
                          <th className="w-16">เลขที่</th>
                          <th className="w-24">วัน/เวลา</th>
                          <th>{TH.cashier}</th>
                          <th className="w-20">{TH.paymentMethod}</th>
                          <th className="w-16">{TH.status}</th>
                          <th className="w-20 text-right">{TH.total}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.recent_sales.map((s, i) => (
                          <tr key={s.id}>
                            <td className="text-center">{i + 1}</td>
                            <td className="font-mono">#{String(s.id).padStart(6, '0')}</td>
                            <td>{fmtDate(s.created_at)}</td>
                            <td>{s.cashier_name ?? '—'}</td>
                            <td className="text-center">{PAYMENT_LABELS[s.payment_method] ?? s.payment_method}</td>
                            <td className="text-center">{SALE_STATUS_LABELS[s.status] ?? s.status}</td>
                            <td className="text-right font-semibold">{fmtAmt(s.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="text-[9pt] text-slate-500 mt-1.5">แสดงเฉพาะรายการล่าสุด {data.recent_sales.length} รายการ</p>
                  </>
                )}
              </GovSection>

              <GovSection no={4} title={TH.cashierActivity}>
                <table className="report-table">
                  <thead>
                    <tr>
                      <th className="w-12">{TH.sequence}</th>
                      <th>{TH.cashier}</th>
                      <th className="w-20 text-right">{TH.billCount}</th>
                      <th className="w-28 text-right">{TH.cash}</th>
                      <th className="w-28 text-right">{TH.promptpay}</th>
                      <th className="w-28 text-right">{TH.netAmount}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.cashiers.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center text-slate-500 py-3">
                          {TH.noData}
                        </td>
                      </tr>
                    ) : (
                      data.cashiers.map((u, i) => (
                        <tr key={u.user_id}>
                          <td className="text-center">{i + 1}</td>
                          <td>{u.display_name}</td>
                          <td className="text-right">{u.sale_count}</td>
                          <td className="text-right">{fmtAmt(u.cash)}</td>
                          <td className="text-right">{fmtAmt(u.promptpay)}</td>
                          <td className="text-right font-semibold">{fmtAmt(u.revenue)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </GovSection>

              <GovSection no={5} title={TH.divisionBreakdown}>
                <table className="report-table">
                  <thead>
                    <tr>
                      <th className="w-12">{TH.sequence}</th>
                      <th>{TH.division}</th>
                      <th className="w-36 text-right">ยอดจำหน่าย (บาท)</th>
                      <th className="w-20 text-right">{TH.share}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(data.division_breakdown).length === 0 ? (
                      <tr>
                        <td colSpan={4} className="text-center text-slate-500 py-3">
                          {TH.noData}
                        </td>
                      </tr>
                    ) : (
                      Object.entries(data.division_breakdown).map(([k, v], i) => (
                        <tr key={k}>
                          <td className="text-center">{i + 1}</td>
                          <td>{k}</td>
                          <td className="text-right">{fmtAmt(v)}</td>
                          <td className="text-right">{divTotal > 0 ? ((v / divTotal) * 100).toFixed(1) : '0.0'}%</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={2} className="text-right font-bold">
                        {TH.totalAllEvents}
                      </td>
                      <td className="text-right font-bold">{fmtAmt(divTotal)}</td>
                      <td className="text-right font-bold">100.0%</td>
                    </tr>
                  </tfoot>
                </table>
              </GovSection>

              {data.low_stock.length > 0 && (
                <GovSection no={6} title={TH.inventoryAlerts}>
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th className="w-12">{TH.sequence}</th>
                        <th className="w-24">SKU</th>
                        <th>{TH.name}</th>
                        <th className="w-28">{TH.division}</th>
                        <th className="w-20 text-right">{TH.remaining}</th>
                        <th className="w-24 text-right">{TH.soldToday}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.low_stock.map((p, i) => (
                        <tr key={p.id}>
                          <td className="text-center">{i + 1}</td>
                          <td className="font-mono">{p.sku}</td>
                          <td>{p.name}</td>
                          <td>{p.division_name ?? '—'}</td>
                          <td className="text-right">{p.stock === 0 ? <strong>หมด</strong> : p.stock}</td>
                          <td className="text-right">{p.sold_today}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </GovSection>
              )}

              <div className="avoid-break mt-5 pt-2 border-t-2 border-slate-800 text-[10pt]">
                <strong>สถานะการปิดวัน:</strong>{' '}
                {data.zreport.closed
                  ? `${TH.dayClosed} — ยอดเงินสดที่คาดไว้ ${fmtAmt(data.zreport.cash_expected)} บาท · นับได้ ${data.zreport.cash_counted === null ? '—' : fmtAmt(data.zreport.cash_counted)} บาท · ส่วนต่าง ${data.zreport.variance === null ? '—' : fmtAmt(data.zreport.variance)} บาท`
                  : `${TH.dayOpen} — ยังไม่มีการปิดยอดสำหรับรอบนี้`}
              </div>
            </>
          )}
        </PrintDoc>
      </div>

      {detail && (
        <Modal title={`${TH.receiptNo} #${String(detail.id).padStart(6, '0')}`} onClose={() => setDetail(null)}>
          <SaleDetail sale={detail} isSuper={isSuper} onChanged={() => { setDetail(null); setTick((t) => t + 1); }} />
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
