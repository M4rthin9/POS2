import type { DashboardPayload } from '@cida/shared';
import { PAYMENT_LABELS, SALE_STATUS_LABELS, TH, fmtAmt, fmtDate, fmtThaiLong } from '@cida/shared';
import { GovDocHeader, GovSection, PrintDoc } from './PrintDoc';
import { printNode } from '../lib/print';

/**
 * On-screen viewer for the operations report. The dashboard no longer prints a
 * hidden copy — this overlay shows the report as a document, and printing from
 * it prints exactly this document (the overlay chrome is dropped by print CSS).
 */
export default function OperationReport({
  data,
  settings,
  periodText,
  onClose,
}: {
  data: DashboardPayload;
  settings: Record<string, string>;
  periodText: string;
  onClose: () => void;
}) {
  const kpi = data.kpi;
  const paid = (kpi?.cash_total ?? 0) + (kpi?.promptpay_total ?? 0);
  const cashShare = paid > 0 ? ((kpi?.cash_total ?? 0) / paid) * 100 : 0;
  const ppShare = paid > 0 ? ((kpi?.promptpay_total ?? 0) / paid) * 100 : 0;

  const dailyEntries = Object.entries(data.daily ?? {}).sort(([a], [b]) => a.localeCompare(b));
  let run = 0;
  const dailyCum = dailyEntries.map(([, v]) => (run += v));
  const divTotal = Object.values(data.division_breakdown ?? {}).reduce((a, b) => a + b, 0);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 flex items-center justify-center p-2 sm:p-4 report-overlay">
      <div className="report-overlay-panel bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[92vh]">
        <div className="no-print flex items-center justify-between gap-2 px-5 py-3 border-b border-slate-200">
          <h3 className="font-bold text-slate-800 text-sm sm:text-base">{TH.salesReportTitle}</h3>
          <div className="flex gap-2">
            <button
              onClick={() => printNode(document.getElementById('report-print'))}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500 transition"
            >
              🖨 {TH.print}
            </button>
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-sm font-semibold hover:bg-slate-200 transition">
              ✕ {TH.close}
            </button>
          </div>
        </div>

        <div className="report-overlay-scroll flex-1 overflow-y-auto p-3 sm:p-5 bg-slate-100">
          <PrintDoc>
            <GovDocHeader settings={settings} title={TH.salesReportTitle} subtitle={TH.operationsDashboard} periodText={periodText} />

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
                        <div className="h-full bg-sky-500" style={{ width: `${ppShare}%` }} />
                      </div>
                      <div className="flex justify-between gap-6 mt-2 text-[9pt]">
                        <span className="flex items-center gap-1.5 text-slate-600">
                          <span className="h-2 w-2 rounded-full bg-emerald-600" />
                          {TH.cash} <strong className="text-slate-800">{fmtAmt(kpi?.cash_total ?? 0)}</strong>
                        </span>
                        <span className="flex items-center gap-1.5 text-slate-600">
                          <span className="h-2 w-2 rounded-full bg-sky-500" />
                          {TH.promptpay} <strong className="text-slate-800">{fmtAmt(kpi?.promptpay_total ?? 0)}</strong>
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
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
                        <th className="w-28">วัน/เวลา</th>
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
                      <th className="w-24">SKU</th>                      <th>{TH.name}</th>
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

            <div className="report-note avoid-break mt-5 text-[10pt]">
              <strong>สถานะการปิดวัน:</strong>{' '}
              {data.zreport.closed
                ? `${TH.dayClosed} — ยอดเงินสดที่คาดไว้ ${fmtAmt(data.zreport.cash_expected)} บาท · นับได้ ${
                    data.zreport.cash_counted === null ? '—' : fmtAmt(data.zreport.cash_counted)
                  } บาท · ส่วนต่าง ${data.zreport.variance === null ? '—' : fmtAmt(data.zreport.variance)} บาท`
                : `${TH.dayOpen} — ยังไม่มีการปิดยอดสำหรับรอบนี้`}
            </div>
          </PrintDoc>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 border-t-2 border-t-emerald-500 bg-white px-3 py-3 text-center">
      <div className="text-[8.5pt] text-slate-500 leading-tight">{label}</div>
      <div className="text-[12pt] font-bold text-slate-900 leading-tight mt-1 tabular-nums">{value}</div>
    </div>
  );
}
