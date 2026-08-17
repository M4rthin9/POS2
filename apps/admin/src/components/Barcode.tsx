import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

// Code 128 encodes every character as 11 modules, plus start, checksum, stop
// (stop carries 2 extra modules) and a quiet zone on each side. Used to decide
// whether a given SKU still scans at the chosen tag width.
const QUIET_MODULES = 10;

export function code128Modules(value: string): number {
  return 11 * (value.length + 3) + 2 + QUIET_MODULES * 2;
}

/** Narrowest printable bar, in mm, for the given SKU at the given barcode width. */
export function moduleWidthMm(value: string, widthMm: number): number {
  return widthMm / code128Modules(value);
}

/** Below this a laser print starts bleeding bars together and scanners drop out. */
export const MIN_MODULE_MM = 0.25;

/**
 * Code 128 barcode rendered as scalable SVG.
 *
 * JsBarcode writes fixed pixel width/height onto the <svg>; those are replaced
 * with a viewBox so the bars scale to the tag's mm box and stay vector — a
 * canvas barcode would rasterise at screen DPI and blur on paper.
 */
export function Barcode({ value, heightMm = 10, className = '' }: { value: string; heightMm?: number; className?: string }) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = ref.current;
    if (!svg || !value) return;
    try {
      JsBarcode(svg, value, {
        format: 'CODE128',
        displayValue: false,
        margin: 0,
        marginLeft: QUIET_MODULES,
        marginRight: QUIET_MODULES,
        width: 1,
        height: 40,
        background: 'transparent',
        lineColor: '#000000',
      });
    } catch {
      // Unencodable SKU (non-Latin-1) — leave the box blank rather than crash
      // the whole sheet; the page shows the SKU text underneath either way.
      svg.innerHTML = '';
      return;
    }
    const w = svg.getAttribute('width');
    const h = svg.getAttribute('height');
    if (w && h) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    // JsBarcode writes its own width/height/style onto the element; drop them and
    // re-apply ours, or the barcode renders at its intrinsic pixel size and
    // overflows the tag.
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.style.cssText = `width:100%;height:${heightMm}mm;display:block`;
  }, [value, heightMm]);

  return <svg ref={ref} className={className} style={{ width: '100%', height: `${heightMm}mm`, display: 'block' }} />;
}
