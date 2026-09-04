// ESC/POS thermal output for the built-in Bluetooth printer.
//
// The receipt is drawn onto an offscreen canvas (system fonts render Thai
// correctly regardless of the printer's codepage support), converted to a
// 1-bit bitmap and sent as an ESC/POS raster image (GS v 0). This mirrors the
// content of components/Receipt.tsx — keep both in sync when the receipt
// layout changes.

import type { PublicSettings, Sale, ShiftReport, ZReport } from '@cida/shared';
import { fmt, fmtDate, PAYMENT_LABELS, TH } from '@cida/shared';
import * as printer from './bluetooth-printer';
import { iminAvailable, iminOpenCashBox, iminPrintBitmap } from './imin-printer';

type Line =
  | { k: 'text'; t: string; size: number; bold?: boolean; align?: 'left' | 'center' }
  | { k: 'row'; l: string; r: string; size?: number; bold?: boolean }
  | { k: 'item'; name: string; qty: number; price: number; total: number }
  | { k: 'sub'; l: string; r: string }
  | { k: 'rule' };

const FONT_STACK = "'Sarabun','Noto Sans Thai',sans-serif";
const PAD = 8;
const GAP = 6;

function widthPx(settings: PublicSettings): number {
  // Default to the narrow roll: printing 80mm-wide output on 58mm paper loses
  // the right-hand column (the amounts), while the reverse only wastes margin.
  return settings.print_size?.includes('80') ? 576 : 384;
}

function receiptLines(sale: Sale, settings: PublicSettings): Line[] {
  const base = widthPx(settings) >= 576 ? 26 : 22;
  const lines: Line[] = [];
  const t = (t: string, size = base, bold = false, align: 'left' | 'center' = 'left') =>
    lines.push({ k: 'text', t, size, bold, align });
  const row = (l: string, r: string, bold = false) => lines.push({ k: 'row', l, r, bold });

  if (settings.org_name) t(settings.org_name, base + 3, true, 'center');
  if (settings.org_subtitle) t(settings.org_subtitle, base - 2, false, 'center');
  if (settings.org_address) t(settings.org_address, base - 3, false, 'center');
  lines.push({ k: 'rule' });

  row('เลขที่ใบเสร็จ', `#${String(sale.id).padStart(6, '0')}`);
  row('กิจกรรม', sale.event_name || '-');
  row('วันที่', fmtDate(sale.created_at));
  row('แคชเชียร์', sale.cashier_name || '-');
  row('ชำระโดย', PAYMENT_LABELS[sale.payment_method] || sale.payment_method);
  if ((sale.payments?.length ?? 0) > 1) {
    for (const p of sale.payments!) {
      lines.push({ k: 'sub', l: `· ${PAYMENT_LABELS[p.method] || p.method}`, r: fmt(p.amount) });
    }
  }
  lines.push({ k: 'rule' });

  for (const it of sale.items || []) {
    lines.push({ k: 'item', name: it.name, qty: it.qty, price: it.price, total: it.line_total });
  }
  lines.push({ k: 'rule' });

  row('รวมเป็นเงิน', fmt(sale.subtotal));
  if (sale.discount > 0) row('ส่วนลด', `-${fmt(sale.discount)}`);
  row('ยอดรวมทั้งสิ้น', fmt(sale.total), true);
  lines.push({ k: 'rule' });

  t(settings.receipt_footer || 'ขอบคุณที่ใช้บริการ', base - 1, false, 'center');
  if (settings.tax_id) t(`เลขที่ผู้เสียภาษี: ${settings.tax_id}`, base - 5, false, 'center');
  return lines;
}

function zReportLines(z: ZReport, settings: PublicSettings): Line[] {
  const base = widthPx(settings) >= 576 ? 26 : 22;
  const lines: Line[] = [];
  const row = (l: string, r: string, bold = false) => lines.push({ k: 'row', l, r, bold });

  if (settings.org_name) lines.push({ k: 'text', t: settings.org_name, size: base + 2, bold: true, align: 'center' });
  lines.push({ k: 'text', t: TH.zReport, size: base + 1, bold: true, align: 'center' });
  lines.push({ k: 'rule' });

  row(TH.businessDate, z.business_date);
  if (z.event_name) row(TH.event, z.event_name);
  if (z.cashier_name) row(TH.cashier, z.cashier_name);
  lines.push({ k: 'rule' });

  row(TH.grossSales, fmt(z.gross));
  row(TH.totalDiscount, `-${fmt(z.discount)}`);
  row(TH.netRevenue, fmt(z.net), true);
  lines.push({ k: 'rule' });

  row(PAYMENT_LABELS.Cash, fmt(z.cash_expected));
  row(PAYMENT_LABELS.PromptPay, fmt(z.promptpay_total));
  if (z.cash_counted !== null) {
    row(TH.cashCounted, fmt(z.cash_counted));
    row(TH.cashVariance, fmt(z.variance ?? 0), true);
  }
  lines.push({ k: 'rule' });

  row(TH.ordersCompleted, String(z.sale_count));
  row(TH.ordersVoid, String(z.void_count));
  row(TH.ordersRefunded, String(z.refund_count));
  lines.push({ k: 'rule' });

  if (z.closed_at) {
    row(TH.closedAt, fmtDate(z.closed_at));
    if (z.closer_name) row(TH.closedBy, z.closer_name);
  }
  if (z.report_hash) {
    lines.push({ k: 'text', t: TH.reportHash, size: base - 5, align: 'center' });
    lines.push({ k: 'text', t: z.report_hash, size: base - 6, align: 'center' });
  }
  return lines;
}

function shiftReportLines(r: ShiftReport, settings: PublicSettings, title: string): Line[] {
  const base = widthPx(settings) >= 576 ? 26 : 22;
  const lines: Line[] = [];
  const row = (l: string, v: string, bold = false) => lines.push({ k: 'row', l, r: v, bold });
  // The bounds are already shop-local, so they are sliced rather than parsed —
  // fmtDate() would treat them as UTC and shift every round by seven hours.
  const hhmm = (local: string) => local.slice(11, 16);

  if (settings.org_name) lines.push({ k: 'text', t: settings.org_name, size: base + 2, bold: true, align: 'center' });
  lines.push({ k: 'text', t: title, size: base + 1, bold: true, align: 'center' });
  lines.push({ k: 'rule' });

  row(TH.businessDate, r.business_date);
  row(TH.roundPeriod, `${hhmm(r.from)} - ${hhmm(r.to)}`);
  if (r.event_name) row(TH.event, r.event_name);
  if (r.cashier_name) row(TH.cashier, r.cashier_name);
  lines.push({ k: 'rule' });

  row(TH.grossSales, fmt(r.gross));
  row(TH.totalDiscount, `-${fmt(r.discount)}`);
  row(TH.netRevenue, fmt(r.net), true);
  lines.push({ k: 'rule' });

  row(PAYMENT_LABELS.Cash, fmt(r.cash_expected));
  row(PAYMENT_LABELS.PromptPay, fmt(r.promptpay_total));
  lines.push({ k: 'rule' });

  row(TH.ordersCompleted, String(r.sale_count));
  row(TH.ordersVoid, String(r.void_count));
  row(TH.ordersRefunded, String(r.refund_count));
  lines.push({ k: 'rule' });

  row(TH.printedAt, fmtDate(new Date().toISOString()));
  lines.push({ k: 'text', t: '____________________', size: base, align: 'center' });
  lines.push({ k: 'text', t: TH.cashier, size: base - 4, align: 'center' });
  return lines;
}

function testLines(settings: PublicSettings): Line[] {
  const base = widthPx(settings) >= 576 ? 26 : 22;
  return [
    { k: 'text', t: 'ทดสอบเครื่องพิมพ์', size: base + 4, bold: true, align: 'center' },
    { k: 'text', t: 'Printer self-test', size: base, align: 'center' },
    { k: 'rule' },
    { k: 'row', l: 'เวลา', r: new Date().toLocaleString('th-TH') },
    { k: 'rule' },
    { k: 'text', t: 'เรียบร้อย ✓', size: base, align: 'center' },
  ];
}

/** Draw the lines onto a canvas. Bluetooth packs it to 1-bit; iMin prints it as-is. */
interface Span { x: number; y: number; text: string; size: number; bold: boolean }
type RulePos = { y: number };

function renderCanvas(lines: Line[], w: number): HTMLCanvasElement {
  // Pass 1 lays everything out against an oversized scratch canvas so wrapping
  // can measure text freely; pass 2 paints onto the right-sized canvas.
  const scratch = document.createElement('canvas');
  scratch.width = w;
  scratch.height = 1; // measurement only — nothing is painted on this one
  const ctx = scratch.getContext('2d')!;

  const spans: Span[] = [];
  const rules: RulePos[] = [];
  let y = PAD;

  const font = (size: number, bold: boolean) => `${bold ? '700 ' : ''}${size}px ${FONT_STACK}`;
  ctx.textBaseline = 'top';

  const wrap = (text: string, size: number, bold: boolean, maxWidth: number): string[] => {
    ctx.font = font(size, bold);
    if (!text || ctx.measureText(text).width <= maxWidth) return [text];
    const out: string[] = [];
    let cur = '';
    for (const ch of text) {
      // Greedy wrap on spaces; fall back to per-character wrap for Thai runs,
      // which carry no spaces but must never overflow the paper.
      const next = cur + ch;
      if (ctx.measureText(next).width > maxWidth) {
        out.push(cur.trimEnd());
        cur = ch === ' ' ? '' : ch;
      } else {
        cur = next;
      }
    }
    if (cur.trim()) out.push(cur);
    return out.length ? out : [''];
  };

  const rowSize = w >= 576 ? 24 : 21;
  const lh = (size: number) => size + GAP / 2;

  for (const ln of lines) {
    switch (ln.k) {
      case 'text': {
        for (const seg of wrap(ln.t, ln.size, !!ln.bold, w - PAD * 2)) {
          ctx.font = font(ln.size, !!ln.bold);
          const x = ln.align === 'center' ? Math.max(PAD, (w - ctx.measureText(seg).width) / 2) : PAD;
          spans.push({ x, y, text: seg, size: ln.size, bold: !!ln.bold });
          y += lh(ln.size);
        }
        break;
      }
      case 'row': {
        const size = ln.size ?? rowSize;
        ctx.font = font(size, !!ln.bold);
        spans.push({ x: PAD, y, text: ln.l, size, bold: !!ln.bold });
        const rightMax = w - PAD * 2 - ctx.measureText(ln.l).width - 8;
        for (const seg of wrap(ln.r, size, !!ln.bold, rightMax)) {
          spans.push({ x: w - PAD - ctx.measureText(seg).width, y, text: seg, size, bold: !!ln.bold });
          y += lh(size);
        }
        break;
      }
      case 'sub': {
        const size = rowSize - 4;
        ctx.font = font(size, false);
        spans.push({ x: PAD + 10, y, text: ln.l, size, bold: false });
        spans.push({ x: w - PAD - ctx.measureText(ln.r).width, y, text: ln.r, size, bold: false });
        y += lh(size);
        break;
      }
      case 'item': {
        const size = rowSize;
        ctx.font = font(size, false);
        const nameMax = w - PAD * 2 - 70;
        const price = fmt(ln.total);
        const priceX = w - PAD - ctx.measureText(price).width;
        wrap(ln.name, size, false, nameMax).forEach((seg, i) => {
          spans.push({ x: PAD, y, text: seg, size, bold: false });
          if (i === 0) spans.push({ x: priceX, y, text: price, size, bold: false });
          y += lh(size);
        });
        const meta = `x${Number.isInteger(ln.qty) ? ln.qty : ln.qty.toFixed(2)} @ ${fmt(ln.price)}`;
        const msize = size - 4;
        spans.push({ x: PAD + 10, y, text: meta, size: msize, bold: false });
        y += lh(msize);
        break;
      }
      case 'rule':
        y += 6;
        rules.push({ y });
        y += 6;
        break;
    }
  }
  const h = Math.ceil(y + PAD);

  // Pass 2 — paint.
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  g.textBaseline = 'top';
  g.fillStyle = '#000';
  for (const s of spans) {
    g.font = font(s.size, s.bold);
    g.fillText(s.text, s.x, s.y);
  }
  g.strokeStyle = '#000';
  g.lineWidth = 2;
  g.setLineDash([4, 3]);
  for (const r of rules) {
    g.beginPath();
    g.moveTo(PAD, r.y);
    g.lineTo(w - PAD, r.y);
    g.stroke();
  }

  return canvas;
}

/** Pack a rendered canvas into 1-bit rows (MSB first) for ESC/POS raster. */
function packBits(canvas: HTMLCanvasElement): { data: Uint8Array; h: number } {
  const { width: w, height: h } = canvas;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  const img = g.getImageData(0, 0, w, h).data;
  const rowBytes = Math.ceil(w / 8);
  const out = new Uint8Array(rowBytes * h);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = (py * w + px) * 4;
      const lum = 0.299 * img[i] + 0.587 * img[i + 1] + 0.114 * img[i + 2];
      if (lum < 160) out[py * rowBytes + (px >> 3)] |= 0x80 >> (px & 7);
    }
  }
  return { data: out, h };
}

/** Wrap a bitmap into the ESC/POS raster command sequence. */
function escposRaster(bmp: { data: Uint8Array; h: number }, w: number, cut = false): Uint8Array {
  // xL/xH count BYTES per line, not pixels. Sending the pixel width told the
  // printer to expect 8x the data it ever receives, which shredded every row
  // and left the printer waiting on a buffer that never filled.
  const rowBytes = Math.ceil(w / 8);
  const head = new Uint8Array([
    0x1b, 0x40, // ESC @ — reset
    0x1d, 0x76, 0x30, 0x00, // GS v 0 m=0 — normal-density raster
    rowBytes & 0xff, (rowBytes >> 8) & 0xff, // xL xH — bytes per line
    bmp.h & 0xff, (bmp.h >> 8) & 0xff, // yL yH
  ]);
  // Built-in terminal printers have no cutter and some firmwares feed a blank
  // slug on the unknown command, so the cut is opt-in.
  const tail = cut
    ? new Uint8Array([0x1b, 0x64, 0x04, 0x1d, 0x56, 0x42, 0x00]) // feed 4 lines + partial cut
    : new Uint8Array([0x1b, 0x64, 0x04]); // feed 4 lines
  const out = new Uint8Array(head.length + bmp.data.length + tail.length);
  out.set(head, 0);
  out.set(bmp.data, head.length);
  out.set(tail, head.length + bmp.data.length);
  return out;
}

async function ensureFonts(): Promise<void> {
  try {
    await document.fonts.ready;
  } catch {
    /* older engines resolve immediately or lack the API */
  }
}

/**
 * The built-in iMin printer is preferred: it needs no pairing and no user
 * gesture, so a receipt prints on the first tap.
 *
 * On the Bluetooth fallback the order is load-bearing — requestDevice() needs
 * transient user activation, and awaiting ensureFonts()/canvas work first
 * consumes it, so an unpaired terminal would fail with NotAllowedError.
 */
async function printLines(lines: Line[], settings: PublicSettings): Promise<void> {
  const w = widthPx(settings);
  if (iminAvailable()) {
    await ensureFonts();
    await iminPrintBitmap(renderCanvas(lines, w).toDataURL('image/png'));
    return;
  }
  await printer.ensureConnected();
  await ensureFonts();
  await printer.send(escposRaster(packBits(renderCanvas(lines, w)), w));
}

/** True when this device prints without pairing a Bluetooth printer first. */
export function builtInPrinter(): boolean {
  return iminAvailable();
}

/**
 * Pop the cash drawer. Fire-and-forget: the drawer opens alongside the
 * receipt, and making the cashier wait on it is the delay they feel.
 */
export function openCashDrawer(): void {
  if (iminAvailable()) {
    iminOpenCashBox();
    return;
  }
  // ESC p 0 25 250 — pulse drawer pin 2, the standard kick on ESC/POS printers.
  if (printer.isConnected()) void printer.send(new Uint8Array([0x1b, 0x70, 0x00, 0x19, 0xfa])).catch(() => {});
}

/** Print one sale receipt on the built-in printer. */
export async function printSaleThermal(sale: Sale, settings: PublicSettings): Promise<void> {
  await printLines(receiptLines(sale, settings), settings);
}

/** Print the settings-page test ticket. */
export async function printTestPage(settings: PublicSettings): Promise<void> {
  await printLines(testLines(settings), settings);
}

/** Print a day-close (Z) summary. */
export async function printZReportThermal(z: ZReport, settings: PublicSettings): Promise<void> {
  await printLines(zReportLines(z, settings), settings);
}

/** Print a hand-over round summary (10:00, 14:00, or the whole day). */
export async function printShiftReportThermal(
  report: ShiftReport,
  settings: PublicSettings,
  title: string,
): Promise<void> {
  await printLines(shiftReportLines(report, settings, title), settings);
}
