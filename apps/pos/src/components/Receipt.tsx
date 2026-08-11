import { forwardRef } from 'react';
import type { PublicSettings, Sale } from '@cida/shared';
import { fmt, fmtDate, PAYMENT_LABELS } from '@cida/shared';

interface Props {
  sale: Sale;
  settings: PublicSettings;
}

export const Receipt = forwardRef<HTMLDivElement, Props>(function Receipt({ sale, settings }, ref) {
  const items = sale.items || [];
  return (
    <div ref={ref} id="receipt-print" className="bg-white text-black text-[12px] leading-snug p-3 font-mono">
      <div className="text-center font-bold text-[13px]">{settings.org_name || 'CIDA'}</div>
      {settings.org_subtitle && <div className="text-center">{settings.org_subtitle}</div>}
      {settings.org_address && <div className="text-center">{settings.org_address}</div>}
      <div className="text-center my-1">──────────────</div>
      <div>เลขที่: #{String(sale.id).padStart(6, '0')}</div>
      <div>วันที่: {fmtDate(sale.created_at)}</div>
      <div>แคชเชียร์: {sale.cashier_name || '-'}</div>
      <div>ชำระโดย: {PAYMENT_LABELS[sale.payment_method] || sale.payment_method}</div>
      <div className="text-center my-1">──────────────</div>
      {items.map((it) => (
        <div key={it.id} className="flex justify-between gap-2">
          <span className="truncate">{it.name}</span>
          <span className="whitespace-nowrap">x{it.qty}</span>
          <span className="whitespace-nowrap">{fmt(it.line_total)}</span>
        </div>
      ))}
      <div className="text-center my-1">──────────────</div>
      <div className="flex justify-between">
        <span>รวม</span>
        <span>{fmt(sale.subtotal)}</span>
      </div>
      {sale.discount > 0 && (
        <div className="flex justify-between">
          <span>ส่วนลด</span>
          <span>-{fmt(sale.discount)}</span>
        </div>
      )}
      <div className="flex justify-between font-bold text-[14px]">
        <span>ยอดรวม</span>
        <span>{fmt(sale.total)}</span>
      </div>
      <div className="text-center my-1">──────────────</div>
      <div className="text-center">{settings.receipt_footer || 'ขอบคุณที่ใช้บริการ'}</div>
      {settings.tax_id && <div className="text-center text-[10px]">เลขที่ผู้เสียภาษี: {settings.tax_id}</div>}
    </div>
  );
});
