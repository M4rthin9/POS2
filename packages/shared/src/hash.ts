// ── Tamper-evident sale ledger hashing ──
//
// Every completed sale is sealed into an append-only chain:
//   tx_hash = sha256(prev_hash + '|' + canonicalSale(sale))
// The genesis entry uses GENESIS_HASH as prev_hash. Recomputing the chain from
// the stored rows detects any after-the-fact edit to an amount, date or item.

export const GENESIS_HASH = '0'.repeat(64);

export interface HashableSaleItem {
  sku: string;
  qty: number;
  price: number;
  line_total: number;
}

export interface HashableSale {
  id: number;
  event_id: number;
  cashier_user_id: number;
  subtotal: number;
  discount: number;
  total: number;
  payment_method: string;
  created_at: string;
  items: HashableSaleItem[];
}

// Money is normalised to 2dp strings so 100 and 100.00 hash identically
// regardless of how SQLite hands the REAL back.
function money(n: number): string {
  return (Math.round(Number(n) * 100) / 100).toFixed(2);
}

function num(n: number): string {
  return String(Math.round(Number(n) * 1e6) / 1e6);
}

/** Stable serialisation of a sale's immutable fields. Field order is part of the contract — never reorder. */
export function canonicalSale(sale: HashableSale): string {
  const head = [
    sale.id,
    sale.event_id,
    sale.cashier_user_id,
    money(sale.subtotal),
    money(sale.discount),
    money(sale.total),
    sale.payment_method,
    sale.created_at,
  ].join('|');
  // Items are sorted so row insertion order can never change the hash.
  const items = [...sale.items]
    .map((i) => `${i.sku}:${num(i.qty)}:${money(i.price)}:${money(i.line_total)}`)
    .sort()
    .join(',');
  return `${head}|${items}`;
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Link one sale onto the chain tail. */
export function saleTxHash(sale: HashableSale, prevHash: string): Promise<string> {
  return sha256Hex(`${prevHash || GENESIS_HASH}|${canonicalSale(sale)}`);
}

/** Short display form used on printed statements. */
export function shortHash(hash: string | null | undefined, len = 12): string {
  return hash ? hash.slice(0, len) : '—';
}

/** Hash of a closed Z-report snapshot, so a closed day is also tamper-evident. */
export function zReportHash(fields: Record<string, string | number | null>): Promise<string> {
  const canonical = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k] ?? ''}`)
    .join('|');
  return sha256Hex(canonical);
}
