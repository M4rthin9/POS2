import { fmt } from '@cida/shared';
import type { AdminProduct } from '../lib/api';
import { MASCOT_PNG } from '../assets/mascot';
import { Barcode, MIN_MODULE_MM, moduleWidthMm } from './Barcode';
import type { TagLayout } from './tagLayouts';

const CORNER = 3; // mm — outer rounded corner
const NOTCH = 1.8; // mm — semicircular perforation notch at mid-height
const HOLE_R = 1.5; // mm — hanging punch

/**
 * Die-cut silhouette as a single path: rounded corners with a semicircular
 * notch bitten out of each side at mid-height. Drawn as a stroked vector so the
 * cut line stays crisp on paper even when the browser drops backgrounds — a
 * CSS box-shadow or background-image would not survive that.
 */
function cutPath(w: number, h: number): string {
  // Inset by half the stroke so the cut line is not sliced in half by the tag's
  // own overflow:hidden box.
  const i = 0.15;
  const r = w - i;
  const b = h - i;
  const my = h / 2;
  return [
    `M ${i + CORNER} ${i}`,
    `H ${r - CORNER}`,
    `A ${CORNER} ${CORNER} 0 0 1 ${r} ${i + CORNER}`,
    `V ${my - NOTCH}`,
    `A ${NOTCH} ${NOTCH} 0 0 0 ${r} ${my + NOTCH}`,
    `V ${b - CORNER}`,
    `A ${CORNER} ${CORNER} 0 0 1 ${r - CORNER} ${b}`,
    `H ${i + CORNER}`,
    `A ${CORNER} ${CORNER} 0 0 1 ${i} ${b - CORNER}`,
    `V ${my + NOTCH}`,
    `A ${NOTCH} ${NOTCH} 0 0 0 ${i} ${my - NOTCH}`,
    `V ${i + CORNER}`,
    `A ${CORNER} ${CORNER} 0 0 1 ${i + CORNER} ${i}`,
    'Z',
  ].join(' ');
}

export function PriceTag({ product, layout, logoUrl }: { product: AdminProduct; layout: TagLayout; logoUrl?: string | null }) {
  const { w, h } = layout;
  // Barcode box = tag width minus the side padding and the mascot column; see
  // .price-tag__code in index.css. The price sits above the barcode, not beside
  // it, so the code gets the full main-column width.
  const codeWidthMm = layout.codeW;
  const dense = codeWidthMm > 0 && moduleWidthMm(product.sku, codeWidthMm) < MIN_MODULE_MM;

  return (
    <div className="price-tag" style={{ ['--tag-w' as string]: `${w}mm`, ['--tag-h' as string]: `${h}mm`, ['--tag-scale' as string]: String(h / 35) }}>
      <svg className="price-tag__cut" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={cutPath(w, h)} />
        <circle cx={5.5} cy={5.5} r={HOLE_R} />
      </svg>

      <div className="price-tag__body">
        <div className="price-tag__main">
          <div className="price-tag__head">
            <div className="price-tag__name">{product.name}</div>
            <div className="price-tag__sub">
              {logoUrl && <img className="price-tag__org" src={logoUrl} alt="" />}
              <span className="price-tag__division">{product.division_name ?? '—'}</span>
            </div>
            <div className="price-tag__price">{fmt(product.price)}</div>
          </div>

          <div className="price-tag__code">
            <Barcode value={product.sku} heightMm={7.5 * (h / 35)} />
            <div className="price-tag__sku">{product.sku}</div>
          </div>
        </div>

        {/* Data URI, not a CSS background: print engines drop background images. */}
        <img className="price-tag__mascot" src={MASCOT_PNG} alt="" />
      </div>

      {dense && <span className="tag-warn no-print" title={`${moduleWidthMm(product.sku, codeWidthMm).toFixed(2)} มม./แท่ง`}>!</span>}
    </div>
  );
}
