// Print presets. Sticker sizes follow common A4 die-cut label stock so the
// printed grid lands on the pre-cut labels; stand sizes follow the acrylic
// holders used at the booths. Adding a size is one entry here — the grid, the
// preview, the page counter and the renderer choice all read from this.
// Printable area with the 5mm @page margin (see index.css @page tag-sheet):
// 200mm × 287mm.
export interface TagLayout {
  id: string;
  label: string;
  /** `sticker` prints a barcode hang tag, `lstand` a stand-up sign, `qr` a QR payment tag. */
  kind: 'sticker' | 'lstand' | 'qr';
  /** Tag width in mm. */
  w: number;
  /** Tag height in mm. */
  h: number;
  cols: number;
  rows: number;
  /** Width in mm available to the barcode, used for the scannability check. 0 for signs. */
  codeW: number;
}

export const TAG_LAYOUTS: TagLayout[] = [
  // codeW = tag width − side padding − the mascot column (full inner height ×
  // the figure's 660:1077 aspect) − its gutter. Recompute it if the tag
  // padding or the mascot sizing in index.css changes.
  { id: 'a4-3x8', label: '63.5 × 33.9 มม. — 24 ดวง/แผ่น', kind: 'sticker', w: 63.5, h: 33.9, cols: 3, rows: 8, codeW: 36 },
  { id: 'a4-2x7', label: '99.1 × 38.1 มม. — 14 ดวง/แผ่น', kind: 'sticker', w: 99.1, h: 38.1, cols: 2, rows: 7, codeW: 68 },
  // 3 × 60 = 180mm and 7 × 40 = 280mm both fit the printable area.
  { id: 'acrylic-60x40', label: 'ฐานอะคริลิก 60 × 40 มม. — 21 ใบ/แผ่น', kind: 'lstand', w: 60, h: 40, cols: 3, rows: 7, codeW: 0 },
  { id: 'a5-lstand', label: 'L-stand A5 148 × 210 มม. — 1 ใบ/แผ่น',  kind: 'lstand', w: 148, h: 210, cols: 1, rows: 1, codeW: 0 },
  // QR payment tags: 80mm wide × 60mm tall — 2 × 4 = 8 tags per A4 sheet.
  { id: 'qr-80x60', label: 'QR ชำระเงิน 80 × 60 มม. — 8 ดวง/แผ่น', kind: 'qr', w: 80, h: 60, cols: 2, rows: 4, codeW: 0 },
];

export const perSheet = (l: TagLayout): number => l.cols * l.rows;
