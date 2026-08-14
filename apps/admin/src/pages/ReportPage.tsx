import { Fragment, useCallback, useEffect, useState } from 'react';
import type { SalesReport } from '@cida/shared';
import { PAYMENT_LABELS, SALE_STATUS_LABELS, TH, fmtAmt, fmtDate, fmtQty, fmtThaiLong, shortHash } from '@cida/shared';
import { api, type AdminEvent } from '../lib/api';
import { periodRange } from '../lib/period';
import PeriodPicker, { type PeriodState } from '../components/PeriodPicker';
import { Button, ErrorBar } from '../components/ui';
import { GovDocHeader, GovSection, PrintDoc, SignatureBlock } from '../components/PrintDoc';

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
              <table className="gov-table">
                <tbody>
                  <Row label={TH.eventCount} value={`${report.events.length} กิจกรรม`} />
                  <Row label={TH.billCount} value={`${t?.count ?? 0} ใบ`} />
                  <Row label={TH.itemCount} value={`${fmtQty(t?.item_qty ?? 0)} ชิ้น`} />
                  <Row label={TH.grossSales} value={`${fmtAmt(t?.gross ?? 0)} บาท`} />
                  <Row label={TH.totalDiscount} value={`${fmtAmt(t?.discount ?? 0)} บาท`} />
                  <Row label={TH.netRevenue} value={`${fmtAmt(t?.net ?? 0)} บาท`} strong />
                  <Row label={`${TH.netRevenue} — ${TH.cash}`} value={`${fmtAmt(t?.cash ?? 0)} บาท`} />
                  <Row label={`${TH.netRevenue} — ${TH.promptpay}`} value={`${fmtAmt(t?.promptpay ?? 0)} บาท`} />
                </tbody>
              </table>
              <p className="text-[10pt] text-slate-600 mt-2">{TH.attachmentNote}</p>
            </GovSection>

            {/* ── 2. Per-event detail ── */}
            <GovSection no={2} title={TH.reportByEvent}>
              {report.events.length === 0 ? (
                <p className="text-slate-500">{TH.noSalesInPeriod}</p>
              ) : (
                report.events.map((ev, evIdx) => (
                  <div key={ev.id} className={`avoid-break ${evIdx > 0 ? 'mt-6' : ''}`}>
                    <h4 className="font-bold text-slate-900 border-b border-slate-800 pb-1 mb-2">
                      {`2.${evIdx + 1}`} กิจกรรม: {ev.name}{' '}
                      <span className="font-normal text-slate-600">
                        ({ev.code}
                        {ev.date ? ` · ${fmtThaiLong(ev.date)}` : ''}
                        {ev.location ? ` · ${ev.location}` : ''})
                      </span>
                    </h4>

                    <table className="gov-table">
                      <thead>
                        <tr>
                          <th className="w-8">ที่</th>
                          <th className="w-16">เลขที่</th>
                          <th className="w-20">วัน/เวลา</th>
                          <th>{TH.name}</th>
                          <th className="w-10 text-right">{TH.qty}</th>
                          <th className="w-14 text-right">ราคา/<wbr />หน่วย</th>
                          <th className="w-16 text-right">{TH.lineTotal}</th>
                          <th className="w-16">{TH.cashier}</th>
                          <th className="w-14">ชำระ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ev.sales.map((sale, i) => (
                          <Fragment key={sale.id}>
                            <tr className="bg-slate-50/60">
                              <td className="text-center">{i + 1}</td>
                              <td className="font-mono">#{String(sale.id).padStart(6, '0')}</td>
                              <td>{fmtDate(sale.created_at)}</td>
                              <td className="text-slate-600">
                                {showItems ? `รวม ${sale.items.length} รายการ` : sale.items.map((it) => it.name).join(', ')}
                                {sale.discount > 0 && (
                                  <span className="text-slate-500"> · {TH.discount} {fmtAmt(sale.discount)}</span>
                                )}
                              </td>
                              <td className="text-right">{fmtQty(sale.item_qty)}</td>
                              <td />
                              <td className="text-right font-semibold">{fmtAmt(sale.total)}</td>
                              <td>{sale.cashier_name}</td>
                              <td>
                                {sale.tenders.length > 1
                                  ? sale.tenders.map((x) => `${PAYMENT_LABELS[x.method] ?? x.method} ${fmtAmt(x.amount)}`).join(' + ')
                                  : PAYMENT_LABELS[sale.payment_method] ?? sale.payment_method}
                              </td>
                            </tr>
                            {showItems &&
                              sale.items.map((it, j) => (
                                <tr key={`${sale.id}-${j}`} className="text-slate-700">
                                  <td />
                                  <td />
                                  <td />
                                  <td className="pl-6">
                                    <span className="text-slate-400 font-mono text-[9pt]">{it.sku}</span> {it.name}
                                    <span className="text-slate-400"> · {it.division_name}</span>
                                  </td>
                                  <td className="text-right">{fmtQty(it.qty)}</td>
                                  <td className="text-right">{fmtAmt(it.price)}</td>
                                  <td className="text-right">{fmtAmt(it.line_total)}</td>
                                  <td />
                                  <td />
                                </tr>
                              ))}
                          </Fragment>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={4} className="text-right font-bold">
                            รวมกิจกรรม {ev.name} ({ev.totals.count} ใบเสร็จ · {TH.discount} {fmtAmt(ev.totals.discount)})
                          </td>
                          <td className="text-right font-bold">{fmtQty(ev.totals.item_qty)}</td>
                          <td />
                          <td className="text-right font-bold">{fmtAmt(ev.totals.net)}</td>
                          <td colSpan={2} className="text-slate-600">
                            {TH.cash} {fmtAmt(ev.totals.cash)} · {TH.promptpay} {fmtAmt(ev.totals.promptpay)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>

                    {/* Per-event category split and who worked the booth */}
                    <div className="grid grid-cols-2 gap-4 mt-2">
                      <table className="gov-table">
                        <thead>
                          <tr>
                            <th colSpan={3}>สรุปตามแผนก — {ev.name}</th>
                          </tr>
                          <tr>
                            <th>{TH.division}</th>
                            <th className="w-16 text-right">{TH.itemCount}</th>
                            <th className="w-24 text-right">{TH.netAmount}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ev.category_summary.map((c) => (
                            <tr key={c.division_name}>
                              <td>{c.division_name}</td>
                              <td className="text-right">{fmtQty(c.qty)}</td>
                              <td className="text-right">{fmtAmt(c.revenue)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <table className="gov-table">
                        <thead>
                          <tr>
                            <th colSpan={3}>ผู้ปฏิบัติหน้าที่จำหน่าย</th>
                          </tr>
                          <tr>
                            <th>{TH.cashier}</th>
                            <th className="w-16 text-right">{TH.billCount}</th>
                            <th className="w-24 text-right">{TH.netAmount}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ev.cashiers.map((u) => (
                            <tr key={u.user_id}>
                              <td>{u.display_name}</td>
                              <td className="text-right">{u.count}</td>
                              <td className="text-right">{fmtAmt(u.net)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))
              )}
            </GovSection>

            {/* ── 3. Category summary (final pages) ── */}
            <GovSection no={3} title={TH.reportCategorySummary} breakBefore>
              <table className="gov-table">
                <thead>
                  <tr>
                    <th className="w-12">{TH.sequence}</th>
                    <th>{TH.division}</th>
                    <th className="w-24 text-right">{TH.itemCount}</th>
                    <th className="w-32 text-right">{TH.netAmount} (บาท)</th>
                    <th className="w-20 text-right">{TH.share}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.category_summary.map((c, i) => (
                    <tr key={c.division_name}>
                      <td className="text-center">{i + 1}</td>
                      <td>{c.division_name}</td>
                      <td className="text-right">{fmtQty(c.qty)}</td>
                      <td className="text-right">{fmtAmt(c.revenue)}</td>
                      <td className="text-right">{c.share.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2} className="text-right font-bold">
                      {TH.totalAllEvents}
                    </td>
                    <td className="text-right font-bold">{fmtQty(t?.item_qty ?? 0)}</td>
                    <td className="text-right font-bold">{fmtAmt(t?.net ?? 0)}</td>
                    <td className="text-right font-bold">100.0%</td>
                  </tr>
                </tfoot>
              </table>
            </GovSection>

            {/* ── 4. Product summary ── */}
            <GovSection no={4} title={TH.reportProductSummary}>
              <table className="gov-table">
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
                <>
                  <h4 className="font-bold text-slate-900 mt-4 mb-1">{TH.reportSoldOut} (ไม่มีการจำหน่ายในช่วงนี้)</h4>
                  <table className="gov-table">
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
                </>
              )}
            </GovSection>

            {/* ── 5. PromptPay trace for the finance office ── */}
            <GovSection no={5} title={TH.reportPromptPayTrace} breakBefore>
              <p className="text-[10pt] text-slate-700 mb-2">{TH.promptPayTraceNote}</p>
              <table className="gov-table">
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
              <GovSection no={6} title={TH.reportReversed}>
                <table className="gov-table">
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
                <p className="text-[10pt] text-slate-600 mt-1">
                  รายการข้างต้นถูกยกเลิกหรือคืนเงินแล้ว จึงไม่นับรวมในยอดจำหน่ายสุทธิ
                </p>
              </GovSection>
            )}

            {/* Integrity statement */}
            <div className="avoid-break mt-4 border border-slate-800 p-2 text-[10pt]">
              <strong>การรับรองความถูกต้องของข้อมูล:</strong>{' '}
              {report.chain.verified
                ? `ระบบได้ตรวจสอบความต่อเนื่องของรหัสตรวจสอบ (hash chain) ของรายการจำหน่ายทั้งสิ้น ${report.chain.checked} รายการ ผลการตรวจสอบถูกต้องครบถ้วน ไม่พบการแก้ไขย้อนหลัง`
                : `พบความผิดปกติของรหัสตรวจสอบที่ใบเสร็จเลขที่ #${report.chain.broken_at} กรุณาตรวจสอบก่อนนำเสนอ`}
            </div>

            <SignatureBlock />
          </>
        )}
      </PrintDoc>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr>
      <td className={`w-72 ${strong ? 'font-bold' : ''}`}>{label}</td>
      <td className={`text-right ${strong ? 'font-bold' : ''}`}>{value}</td>
    </tr>
  );
}
