import { fmt } from '@cida/shared';
import type { AdminProduct } from '../lib/api';
import { MASCOT_PNG } from '../assets/mascot';
import type { TagLayout } from './tagLayouts';

const CORNER = 3; // mm
const INSET = 0.15; // mm — half the stroke, so the outline is not clipped

function priceFontSize(price: number, land: boolean): number {
  const len = fmt(price).length;
  if (land) {
    if (len <= 10) return 9;
    if (len <= 12) return 7.5;
    return 6;
  }
  if (len <= 10) return 28;
  if (len <= 12) return 22;
  return 18;
}

/**
 * Stand-up sign: the insert for an acrylic holder. No barcode, no punch hole,
 * no notches — it slides into a stand rather than hanging off a product.
 *
 * One component serves both presets. A5 portrait stacks; the 60 × 40 acrylic
 * base card runs two columns, because the stacked layout would leave the name
 * at ~3mm and the mascot unreadable at that size.
 *
 * `dark` prints the card on a black ground with the type and accents in colour —
 * the variant used behind the tinted acrylic bases. It only changes paint, never
 * geometry, so the trim size stays identical to the light card.
 */
export function LStandSign({ product, layout, logoUrl, dark }: { product: AdminProduct; layout: TagLayout; logoUrl?: string | null; dark?: boolean }) {
  const { w, h } = layout;
  const land = w > h;
  // Type scales off the short edge so both presets share one stylesheet.
  const scale = land ? h / 40 : h / 210;
  const pSize = priceFontSize(product.price, land);

  return (
    <div
      className={`sign ${land ? 'sign--land' : 'sign--port'}${dark ? ' sign--dark' : ''}`}
      style={{ ['--sign-w' as string]: `${w}mm`, ['--sign-h' as string]: `${h}mm`, ['--sign-scale' as string]: String(scale) }}
    >
      {/* The outline is the trim line — same contract as the sticker cut path. */}
      <svg className="sign__cut" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
        <rect x={INSET} y={INSET} width={w - INSET * 2} height={h - INSET * 2} rx={CORNER} ry={CORNER} />
      </svg>

      <div className="sign__body">
        <div className="sign__main">
          {!land && logoUrl && <img className="sign__org" src={logoUrl} alt="" />}
          <div className="sign__name">{product.name}</div>
          <div className="sign__rule" />
          <div className="sign__price" style={{ fontSize: `${pSize * scale}mm` }}>{fmt(product.price)}</div>
        </div>
        <img className="sign__mascot" src={MASCOT_PNG} alt="" />
      </div>
    </div>
  );
}
