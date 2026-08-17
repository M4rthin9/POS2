import { QRCodeSVG } from 'qrcode.react';
import { fmt, generatePayload } from '@cida/shared';
import type { AdminProduct } from '../lib/api';
import { CHARACTER_PNG } from '../assets/character';
import type { TagLayout } from './tagLayouts';

export function QRPaymentTag({ product, layout, promptpayId, logoUrl }: { product: AdminProduct; layout: TagLayout; promptpayId: string; logoUrl?: string | null }) {
  const { w, h } = layout;
  const { payload } = generatePayload(promptpayId, product.price);
  const qrMm = Math.round(h * 0.48);

  return (
    <div className="qr-tag" style={{ ['--tag-w' as string]: `${w}mm`, ['--tag-h' as string]: `${h}mm`, ['--qr-size' as string]: `${qrMm}mm` }}>
      <svg className="qr-tag__cut" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={cutPath(w, h)} />
      </svg>

      <div className="qr-tag__body">
        {/* Left column: logo, name, QR, price */}
        <div className="qr-tag__left">
          <div className="qr-tag__head">
            {logoUrl && <img className="qr-tag__logo" src={logoUrl} alt="" />}
            <div className="qr-tag__name">{product.name}</div>
          </div>

          <div className="qr-tag__qr">
            <QRCodeSVG value={payload} size={200} level="H" bgColor="#ffffff" fgColor="#0f172a" />
          </div>

          <div className="qr-tag__foot">
            <div className="qr-tag__price">{fmt(product.price)}</div>
            <div className="qr-tag__hint">สแกนเพื่อชำระเงิน</div>
          </div>
        </div>

        {/* Right column: character */}
        <img className="qr-tag__character" src={CHARACTER_PNG} alt="" />
      </div>
    </div>
  );
}

const CORNER = 3;

function cutPath(w: number, h: number): string {
  const i = 0.15;
  const r = w - i;
  const b = h - i;
  return [
    `M ${i + CORNER} ${i}`,
    `H ${r - CORNER}`,
    `A ${CORNER} ${CORNER} 0 0 1 ${r} ${i + CORNER}`,
    `V ${b - CORNER}`,
    `A ${CORNER} ${CORNER} 0 0 1 ${r - CORNER} ${b}`,
    `H ${i + CORNER}`,
    `A ${CORNER} ${CORNER} 0 0 1 ${i} ${b - CORNER}`,
    `V ${i + CORNER}`,
    `A ${CORNER} ${CORNER} 0 0 1 ${i + CORNER} ${i}`,
    'Z',
  ].join(' ');
}
