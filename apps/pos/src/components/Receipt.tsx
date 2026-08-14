import { forwardRef } from 'react';
import type { PublicSettings, Sale } from '@cida/shared';
import { fmt, fmtDate, PAYMENT_LABELS } from '@cida/shared';

interface Props {
  sale: Sale;
  settings: PublicSettings;
}

const Divider = () => (
  <div className="my-1.5 border-t border-dashed border-slate-400" />
);

export const Receipt = forwardRef<HTMLDivElement, Props>(function Receipt({ sale, settings }, ref) {
  const items = sale.items || [];
  const width = settings.print_size?.includes('58') ? '58mm' : '80mm';
  const logo = settings.logo_url || '/icon-192.svg';

  return (
    <div
      ref={ref}
      id="receipt-print"
      data-print-size={width}
      className="bg-white text-slate-900 text-[12px] leading-snug px-3 py-4 font-mono"
      style={{ maxWidth: width }}
    >
      {/* Header / logo */}
      <div className="flex flex-col items-center text-center">
        <img src={logo} alt="" className="h-14 w-14 object-contain mb-1.5 rounded-lg" />
        {settings.org_name && <div className="font-bold text-[13px] leading-tight">{settings.org_name}</div>}
        {settings.org_subtitle && <div className="text-slate-500 mt-0.5">{settings.org_subtitle}</div>}
        {settings.org_address && <div className="text-slate-500">{settings.org_address}</div>}
      </div>

      <Divider />

      {/* Meta */}
      <div className="space-y-0.5">
        <div className="flex justify-between">
          <span className="text-slate-500">เลขที่ใบเสร็จ</span>
          <span className="font-semibold">#{String(sale.id).padStart(6, '0')}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">วันที่</span>
          <span>{fmtDate(sale.created_at)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">แคชเชียร์</span>
          <span>{sale.cashier_name || '-'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">ชำระโดย</span>
          <span className="font-semibold">{PAYMENT_LABELS[sale.payment_method] || sale.payment_method}</span>
        </div>
      </div>

      <Divider />

      {/* Items */}
      <div className="space-y-1">
        {items.map((it) => (
          <div key={it.id}>
            <div className="flex justify-between gap-2">
              <span className="truncate flex-1">{it.name}</span>
              <span className="whitespace-nowrap">{fmt(it.line_total)}</span>
            </div>
            <div className="text-[10px] text-slate-500">
              x{Number.isInteger(it.qty) ? it.qty : it.qty.toFixed(2)} @ {fmt(it.price)}
            </div>
          </div>
        ))}
      </div>

      <Divider />

      {/* Totals */}
      <div className="space-y-0.5">
        <div className="flex justify-between">
          <span className="text-slate-500">รวมเป็นเงิน</span>
          <span>{fmt(sale.subtotal)}</span>
        </div>
        {sale.discount > 0 && (
          <div className="flex justify-between">
            <span className="text-slate-500">ส่วนลด</span>
            <span>-{fmt(sale.discount)}</span>
          </div>
        )}
        <div className="flex justify-between items-center pt-1">
          <span className="font-bold text-[13px]">ยอดรวมทั้งสิ้น</span>
          <span className="font-bold text-[15px]">{fmt(sale.total)}</span>
        </div>
      </div>

      <Divider />

      {/* Footer */}
      <div className="text-center">
        <div className="text-slate-700">{settings.receipt_footer || 'ขอบคุณที่ใช้บริการ'}</div>
        {settings.tax_id && <div className="text-[10px] text-slate-500 mt-0.5">เลขที่ผู้เสียภาษี: {settings.tax_id}</div>}
      </div>
    </div>
  );
});
