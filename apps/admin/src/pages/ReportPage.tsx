import { useCallback, useEffect, useState } from 'react';
import type { SalesReport } from '@cida/shared';
import { PAYMENT_LABELS, SALE_STATUS_LABELS, TH, fmtAmt, fmtDate, fmtQty, fmtThaiLong, shortHash } from '@cida/shared';
import { api, type AdminEvent } from '../lib/api';
import { periodRange } from '../lib/period';
import PeriodPicker, { type PeriodState } from '../components/PeriodPicker';
import { Button, ErrorBar } from '../components/ui';
import { GovDocHeader, GovSection, PrintDoc } from '../components/PrintDoc';

/**
 * The single formal document handed to the Commander. Structure follows the
 * agreed layout: overview → per-event itemised receipts → category summary →
 * product summary → PromptPay trace list for the finance office → signatures.
 */
export default function ReportPage() {
  const [range, setRange] = useState<PeriodState>({ period: 'today', from: '', to: '' });
  const [eventFilter, setEventFilter] = useState('');
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [report, setReport] = useState<SalesReport | null>(null);
  const [showItems, setShowItems] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.adminEvents().then(setEvents).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    const { from, to } = periodRange(range.period, range.from, range.to);
    setReport(null);
    try {
      setReport(await api.salesReport({ from, to, event_id: eventFilter ? Number(eventFilter) : undefined }));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : TH.error);
    }
  }, [range, eventFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const { from, to } = periodRange(range.period, range.from, range.to);
  const s = report?.settings ?? {};
  const t = report?.totals;

  const paid = (t?.cash ?? 0) + (t?.promptpay ?? 0);
  const cashShare = paid > 0 ? ((t?.cash ?? 0) / paid) * 100 : 0;
  const ppShare = paid > 0 ? ((t?.promptpay ?? 0) / paid) * 100 : 0;

  const periodText =
    from && to
      ? from === to
        ? fmtThaiLong(from)
        : `${fmtThaiLong(from)} ถึง ${fmtThaiLong(to)}`
      : TH.periodAllLabel;

  return (
    <div>
      <div className="no-print mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">{TH.salesReportTitle}</h1>
          <p className="text-sm text-slate-500">
            {TH.reportPeriod} {periodText}
          </p>
        </div>
        <PeriodPicker value={range} onChange={setRange}>
          <select
            value={eventFilter}
            onChange={(e) => setEventFilter(e.target.value)}
            className="border border-slate-200 rounded-xl px-2 py-1.5 text-sm bg-white"
          >
            <option value="">— {TH.totalAllEvents} —</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-slate-500 px-2">
            <input type="checkbox" checked={showItems} onChange={(e) => setShowItems(e.target.checked)} className="w-3.5 h-3.5 accent-emerald-600" />
            แสดงรายการสินค้าในแต่ละใบเสร็จ
          </label>
          <Button variant="primary" onClick={() => window.print()}>
            🖨 {TH.print}
          </Button>
        </PeriodPicker>
      </div>

      <ErrorBar message={error} onDismiss={() => setError('')} />
      {report?.truncated && (
        <div className="no-print mb-3 text-sm text-amber-700 bg-amber-50 rounded-xl px-4 py-2.5">⚠ {TH.reportTruncated}</div>
      )}

      <PrintDoc>
        <GovDocHeader settings={s} title={TH.salesReportTitle} subtitle={TH.reportSubtitle} periodText={periodText} />

        {report === null ? (
          <p className="text-center text-slate-400 py-10">…</p>
        ) : (
          <>
            {/* ── 1. Overview ── */}
            <GovSection no={1} title={TH.reportOverview}>
              <div className="summary-panel">
                <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
                  <div className="min-w-0">
                    <div className="text-[9pt] text-slate-500">{TH.netRevenue}</div>
                    <div className="text-[24pt] font-bold leading-none text-emerald-800 mt-1">
                      {fmtAmt(t?.net ?? 0)}
                      <span className="text-[12pt] font-semibold text-slate-600"> บาท</span>
                    </div>
                    <div className="text-[9pt] text-slate-500 mt-1.5">
                      {TH.grossSales} {fmtAmt(t?.gross ?? 0)} บาท · {TH.totalDiscount} {fmtAmt(t?.discount ?? 0)} บาท
                    </div>
                  </div>

                  <div className="flex-1 max-w-xs min-w-56">
                    {paid > 0 && (
                      <>
                        <div className="flex h-2.5 rounded-full overflow-hidden bg-slate-100 border border-slate-200">
                          <div className="h-full bg-emerald-600" style={{ width: `${cashShare}%` }} />
                          <div className="h-full bg-slate-300" style={{ width: `${ppShare}%` }} />
                        </div>
                        <div className="flex justify-between gap-6 mt-2 text-[9pt]">
                          <span className="flex items-center gap-1.5 text-slate-600">
                            <span className="h-2 w-2 rounded-full bg-emerald-600" />
                            {TH.cash} <strong className="text-slate-800">{fmtAmt(t?.cash ?? 0)}</strong>
                          </span>
                          <span className="flex items-center gap-1.5 text-slate-600">
                            <span className="h-2 w-2 rounded-full bg-slate-300" />
                            {TH.promptpay} <strong className="text-slate-800">{fmtAmt(t?.promptpay ?? 0)}</strong>
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-4 gap-px bg-slate-200 border border-slate-200 rounded-lg overflow-hidden">
                  <Stat label={TH.eventCount} value={`${report.events.length} กิจกรรม`} />
                  <Stat label={TH.billCount} value={`${t?.count ?? 0} ใบ`} />
                  <Stat label={TH.itemCount} value={`${fmtQty(t?.item_qty ?? 0)} ชิ้น`} />
                  <Stat label={TH.products} value={`${report.product_summary.length} รายการ`} />
                </div>
                <p className="text-[9pt] text-slate-500 mt-2.5">{TH.attachmentNote}</p>
              </div>
            </GovSection>

            {/* ── 2. Per-event detail ── */}
            <GovSection no={2} title={TH.reportByEvent}>
              {report.events.length === 0 ? (
                <p className="text-slate-500">{TH.noSalesInPeriod}</p>
              ) : (
                report.events.map((ev, evIdx) => (
                  <div key={ev.id} className={`avoid-break ${evIdx > 0 ? 'mt-5' : ''}`}>
                    <div className="event-strip">
                      <div className="min-w-0">
                        <div className="font-bold text-[11pt] leading-tight text-slate-900">
                          {`2.${evIdx + 1}`} {ev.name}
                        </div>
                        <div className="text-[9pt] text-slate-500 leading-tight">
                          {[ev.code, ev.date && fmtThaiLong(ev.date), ev.location].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <div className="flex-none pl-4 text-right">
                        <div className="text-[9pt] text-slate-500 leading-tight">
                          {ev.totals.count} ใบเสร็จ · {fmtQty(ev.totals.item_qty)} ชิ้น
                        </div>
                        <div className="text-[10pt] font-bold text-emerald-800 leading-tight mt-0.5">
                          {fmtAmt(ev.totals.net)} <span className="text-[8.5pt] font-medium text-slate-500">บาท</span>
                        </div>
                      </div>
                    </div>

                    <table className="report-table">
                      <thead>
                        <tr>
                          <th className="w-8">ที่</th>
                          <th className="w-16">เลขที่</th>
                          <th className="w-20">วัน/เวลา</th>
                          <th>{TH.name}</th>
                          <th className="w-10 text-right">{TH.qty}</th>
                          <th className="w-16 text-right">{TH.lineTotal}</th>
                          <th className="w-24">ชำระ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ev.sales.map((sale, i) => (
                          <tr key={sale.id}>
                            <td className="text-center">{i + 1}</td>
                            <td className="font-mono">#{String(sale.id).padStart(6, '0')}</td>
                            <td>{fmtDate(sale.created_at)}</td>
                            <td className="text-slate-700">
                              {showItems ? sale.items.map((it) => `${fmtQty(it.qty)}× ${it.name}`).join(' · ') : `รวม ${sale.items.length} รายการ`}
                              {sale.discount > 0 && (
                                <span className="text-slate-500"> · {TH.discount} {fmtAmt(sale.discount)}</span>
                              )}
                            </td>
                            <td className="text-right">{fmtQty(sale.item_qty)}</td>
                            <td className="text-right font-semibold">{fmtAmt(sale.total)}</td>
                            <td className="whitespace-nowrap">
                              {sale.tenders.length > 1 ? (
                                <span className="block leading-snug">
                                  {sale.tenders.map((x) => (
                                    <span key={`${x.method}-${x.amount}`} className="block">
                                      {PAYMENT_LABELS[x.method] ?? x.method} {fmtAmt(x.amount)}
                                    </span>
                                  ))}
                                </span>
                              ) : (
                                PAYMENT_LABELS[sale.payment_method] ?? sale.payment_method
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={4} className="text-right font-bold">
                            รวมกิจกรรม {ev.name} — {ev.totals.count} ใบเสร็จ · {TH.discount} {fmtAmt(ev.totals.discount)}
                          </td>
                          <td className="text-right font-bold">{fmtQty(ev.totals.item_qty)}</td>
                          <td className="text-right font-bold">{fmtAmt(ev.totals.net)}</td>
                          <td className="text-center whitespace-nowrap px-3">
                            <span className="block text-[9pt] text-slate-500 leading-tight">{TH.cash}</span>
                            <span className="block font-semibold leading-tight">{fmtAmt(ev.totals.cash)}</span>
                            <span className="block text-[9pt] text-slate-500 leading-tight mt-0.5">{TH.promptpay}</span>
                            <span className="block font-semibold leading-tight">{fmtAmt(ev.totals.promptpay)}</span>
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ))
              )}
            </GovSection>

            {/* ── 3. Product summary ── */}
            <GovSection no={3} title={TH.reportProductSummary}>
              <table className="report-table">
                <thead>
                  <tr>
                    <th className="w-12">{TH.sequence}</th>
                    <th className="w-24">SKU</th>
                    <th>{TH.name}</th>
                    <th className="w-24">{TH.division}</th>
                    <th className="w-20 text-right">{TH.itemCount}</th>
                    <th className="w-28 text-right">{TH.netAmount} (บาท)</th>
                    <th className="w-24 text-right">{TH.remaining}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.product_summary.map((p, i) => (
                    <tr key={p.sku}>
                      <td className="text-center">{i + 1}</td>
                      <td className="font-mono">{p.sku}</td>
                      <td>{p.name}</td>
                      <td>{p.division_name}</td>
                      <td className="text-right">{fmtQty(p.qty)}</td>
                      <td className="text-right">{fmtAmt(p.revenue)}</td>
                      <td className="text-right">
                        {p.stock_left === null ? 'ไม่จำกัด' : p.sold_out ? <strong>หมด</strong> : p.stock_left}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} className="text-right font-bold">
                      {TH.totalAllEvents}
                    </td>
                    <td className="text-right font-bold">{fmtQty(t?.item_qty ?? 0)}</td>
                    <td className="text-right font-bold">{fmtAmt(t?.net ?? 0)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>

              {report.sold_out_products.length > 0 && (
                <div className="avoid-break mt-4">
                  <div className="text-[10pt] font-semibold text-slate-700 mb-1.5">
                    {TH.reportSoldOut} <span className="text-[9pt] font-normal text-slate-500">(ไม่มีการจำหน่ายในช่วงนี้)</span>
                  </div>
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th className="w-12">{TH.sequence}</th>
                        <th className="w-24">SKU</th>
                        <th>{TH.name}</th>
                        <th className="w-24 text-right">{TH.remaining}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.sold_out_products.map((p, i) => (
                        <tr key={p.sku}>
                          <td className="text-center">{i + 1}</td>
                          <td className="font-mono">{p.sku}</td>
                          <td>{p.name}</td>
                          <td className="text-right">
                            <strong>หมด</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </GovSection>

            {/* ── 4. PromptPay trace for the finance office ── */}
            <GovSection no={4} title={TH.reportPromptPayTrace} breakBefore>
              <p className="text-[9pt] text-slate-600 mb-2">{TH.promptPayTraceNote}</p>
              <table className="report-table">
                <thead>
                  <tr>
                    <th className="w-8">{TH.sequence}</th>
                    <th className="w-28">{TH.dateTime}</th>
                    <th className="w-16">เลขที่</th>
                    <th>{TH.event}</th>
                    <th className="w-20">{TH.cashier}</th>
                    <th className="w-20 text-right">{TH.amount} (บาท)</th>
                    <th className="w-20">{TH.txHash}</th>
                    <th className="w-12 text-center">{TH.checkMark}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.promptpay_trace.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center text-slate-500 py-3">
                        {TH.noData}
                      </td>
                    </tr>
                  ) : (
                    report.promptpay_trace.map((p, i) => (
                      <tr key={`${p.sale_id}-${i}`}>
                        <td className="text-center">{i + 1}</td>
                        <td>{fmtDate(p.created_at)}</td>
                        <td className="font-mono">#{String(p.sale_id).padStart(6, '0')}</td>
                        <td>{p.event_name}</td>
                        <td>{p.cashier_name}</td>
                        <td className="text-right font-semibold">{fmtAmt(p.amount)}</td>
                        <td className="font-mono text-[8pt]">{shortHash(p.tx_hash, 10)}</td>
                        <td />
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5} className="text-right font-bold">
                      รวมรับชำระผ่านพร้อมเพย์ ({report.promptpay_trace.length} รายการ)
                    </td>
                    <td className="text-right font-bold">{fmtAmt(report.promptpay_total)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </GovSection>

            {/* ── 6. Reversed sales ── */}
            {report.reversed.length > 0 && (
              <GovSection no={5} title={TH.reportReversed}>
                <table className="report-table">
                  <thead>
                    <tr>
                      <th className="w-8">{TH.sequence}</th>
                      <th className="w-28">{TH.dateTime}</th>
                      <th className="w-16">เลขที่</th>
                      <th>{TH.event}</th>
                      <th className="w-20 text-right">{TH.amount}</th>
                      <th className="w-16">{TH.status}</th>
                      <th>{TH.reason}</th>
                      <th className="w-20">{TH.actor}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.reversed.map((v, i) => (
                      <tr key={v.id}>
                        <td className="text-center">{i + 1}</td>
                        <td>{fmtDate(v.created_at)}</td>
                        <td className="font-mono">#{String(v.id).padStart(6, '0')}</td>
                        <td>{v.event_name}</td>
                        <td className="text-right">{fmtAmt(v.total)}</td>
                        <td>{SALE_STATUS_LABELS[v.status] ?? v.status}</td>
                        <td>{v.void_reason ?? '—'}</td>
                        <td>{v.voided_by_name ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[9pt] text-slate-500 mt-1">
                  รายการข้างต้นถูกยกเลิกหรือคืนเงินแล้ว จึงไม่นับรวมในยอดจำหน่ายสุทธิ
                </p>
              </GovSection>
            )}

            {/* Integrity statement */}
            <div className="avoid-break mt-5 pt-2 border-t-2 border-slate-800 text-[10pt]">
              <strong>การรับรองความถูกต้องของข้อมูล:</strong>{' '}
              {report.chain.verified
                ? `ระบบได้ตรวจสอบความต่อเนื่องของรหัสตรวจสอบ (hash chain) ของรายการจำหน่ายทั้งสิ้น ${report.chain.checked} รายการ ผลการตรวจสอบถูกต้องครบถ้วน ไม่พบการแก้ไขย้อนหลัง`
                : `พบความผิดปกติของรหัสตรวจสอบที่ใบเสร็จเลขที่ #${report.chain.broken_at} กรุณาตรวจสอบก่อนนำเสนอ`}
            </div>
          </>
        )}
      </PrintDoc>
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
