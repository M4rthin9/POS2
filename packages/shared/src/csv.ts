// ── Delimited bank-statement parsing (Krungthai / KTB netbank CSV exports) ──
//
// The file is parsed in the browser; the Worker only ever receives normalised
// rows. That keeps upload handling, encoding quirks and column mapping out of
// the API surface.

export interface ParsedBankLine {
  posted_at: string; // 'YYYY-MM-DD HH:MM:SS' (local wall clock as printed by the bank)
  description: string;
  ref: string;
  debit: number;
  credit: number;
  balance: number | null;
  raw: string[];
}

export interface BankMapping {
  date: number;
  time: number; // -1 when the export has no separate time column
  description: number;
  debit: number;
  credit: number;
  balance: number;
  ref: number;
}

export const EMPTY_MAPPING: BankMapping = {
  date: -1,
  time: -1,
  description: -1,
  debit: -1,
  credit: -1,
  balance: -1,
  ref: -1,
};

// ── Delimited text ──

/** RFC-4180 parser with BOM strip, delimiter sniffing and CRLF handling. */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const delim = delimiter ?? sniffDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.map((r) => r.map((f) => f.trim())).filter((r) => r.some((f) => f !== ''));
}

function sniffDelimiter(text: string): string {
  const sample = text.slice(0, 4000).split('\n').slice(0, 10).join('\n');
  const counts = [',', ';', '\t', '|'].map((d) => [d, sample.split(d).length] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 1 ? counts[0][0] : ',';
}

// ── Value coercion ──

/** '1,234.50' → 1234.5 · '(120.00)' → -120 · '-' / '' → 0 */
export function parseAmount(raw: string): number {
  if (!raw) return 0;
  let s = raw.replace(/[฿,\s]/g, '').replace(/THB/gi, '');
  if (s === '' || s === '-' || s === '--') return 0;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return neg ? -Math.abs(n) : n;
}

const TH_MONTHS: Record<string, number> = {
  'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6,
  'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12,
};

/**
 * Normalises the date formats KTB exports use into 'YYYY-MM-DD'.
 * Buddhist-era years (2500+) and 2-digit BE years (68 → 2025) are converted to CE.
 */
export function parseBankDate(raw: string): string | null {
  const s = (raw || '').trim();
  if (!s) return null;

  // ISO first — already unambiguous.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // dd/MM/yyyy · dd-MM-yy · dd.MM.yyyy
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (dmy) {
    const d = Number(dmy[1]);
    const m = Number(dmy[2]);
    const y = normalizeYear(Number(dmy[3]));
    return ymd(y, m, d);
  }

  // '15 ม.ค. 68' / '15 ม.ค. 2568'
  const thai = s.match(/^(\d{1,2})\s*([ก-ฮ.]+)\s*(\d{2,4})/);
  if (thai && TH_MONTHS[thai[2]]) {
    return ymd(normalizeYear(Number(thai[3])), TH_MONTHS[thai[2]], Number(thai[1]));
  }

  return null;
}

function normalizeYear(y: number): number {
  if (y >= 2400) return y - 543; // full Buddhist era, 2568 → 2025
  if (y >= 1900) return y; // full CE
  if (y >= 50) return 1957 + y; // 2-digit Buddhist era, 68 → 2568 → 2025
  return 2000 + y; // 2-digit CE
}

function ymd(y: number, m: number, d: number): string | null {
  if (!Number.isFinite(y) || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** '09:41' / '09:41:22' / '0941' → 'HH:MM:SS' */
export function parseBankTime(raw: string): string {
  const s = (raw || '').trim();
  const hms = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (hms) return `${hms[1].padStart(2, '0')}:${hms[2]}:${hms[3] ?? '00'}`;
  const compact = s.match(/^(\d{2})(\d{2})(\d{2})?$/);
  if (compact) return `${compact[1]}:${compact[2]}:${compact[3] ?? '00'}`;
  return '00:00:00';
}

// ── Column mapping ──

const KEYWORDS: Record<keyof BankMapping, string[]> = {
  date: ['วันที่', 'วันเดือนปี', 'date', 'transaction date', 'txn date', 'posting date'],
  time: ['เวลา', 'time'],
  description: ['รายการ', 'รายละเอียด', 'คำอธิบาย', 'description', 'detail', 'narrative', 'channel', 'ช่องทาง'],
  debit: ['ถอน', 'เดบิต', 'จ่าย', 'withdrawal', 'debit', 'dr'],
  credit: ['ฝาก', 'เครดิต', 'รับ', 'deposit', 'credit', 'cr'],
  balance: ['คงเหลือ', 'ยอดคงเหลือ', 'balance'],
  ref: ['อ้างอิง', 'เลขที่รายการ', 'หมายเลขอ้างอิง', 'ref', 'reference', 'trace', 'transaction id', 'txn no'],
};

/**
 * Best-effort column guess from a header row, used to pre-fill the mapping UI.
 * The user can override every field before import.
 */
export function guessMapping(headers: string[]): BankMapping {
  const norm = headers.map((h) => h.toLowerCase().replace(/\s+/g, ' ').trim());
  const mapping: BankMapping = { ...EMPTY_MAPPING };
  (Object.keys(KEYWORDS) as (keyof BankMapping)[]).forEach((field) => {
    const idx = norm.findIndex((h) => h !== '' && KEYWORDS[field].some((k) => h.includes(k)));
    if (idx >= 0 && !Object.values(mapping).includes(idx)) mapping[field] = idx;
  });
  return mapping;
}

export function isMappingComplete(m: BankMapping): boolean {
  return m.date >= 0 && (m.credit >= 0 || m.debit >= 0);
}

/** Turn raw rows into bank lines. Rows without a parseable date are skipped (headers, subtotals, footers). */
export function applyMapping(rows: string[][], m: BankMapping): ParsedBankLine[] {
  const out: ParsedBankLine[] = [];
  for (const row of rows) {
    const date = parseBankDate(cell(row, m.date));
    if (!date) continue;
    const time = m.time >= 0 ? parseBankTime(cell(row, m.time)) : '00:00:00';
    const debit = Math.abs(parseAmount(cell(row, m.debit)));
    const creditRaw = parseAmount(cell(row, m.credit));
    // Some exports use one signed amount column mapped to `credit`.
    const credit = creditRaw >= 0 ? creditRaw : 0;
    const extraDebit = creditRaw < 0 ? Math.abs(creditRaw) : 0;
    if (debit === 0 && extraDebit === 0 && credit === 0) continue;
    out.push({
      posted_at: `${date} ${time}`,
      description: cell(row, m.description),
      ref: cell(row, m.ref),
      debit: debit + extraDebit,
      credit,
      balance: m.balance >= 0 && cell(row, m.balance) !== '' ? parseAmount(cell(row, m.balance)) : null,
      raw: row,
    });
  }
  return out;
}

function cell(row: string[], idx: number): string {
  return idx >= 0 && idx < row.length ? row[idx] : '';
}

/**
 * Pull a PromptPay/transfer reference out of a bank description when the export
 * has no dedicated ref column, e.g. 'X2345 โอนเงิน PP 0107537000882'.
 */
export function extractRefTokens(text: string): string[] {
  return (text.match(/[A-Za-z0-9]{6,}/g) ?? []).map((t) => t.toUpperCase());
}
