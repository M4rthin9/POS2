import { GENESIS_HASH, saleTxHash } from '@cida/shared';
import type { HashableSale } from '@cida/shared';

// ── Append-only sale ledger ──
//
// Each sale is sealed onto the chain tail after its items are committed:
//   tx_hash = sha256(prev_hash | canonicalSale(sale))
// `seq` carries a UNIQUE index, so two concurrent seals collide instead of
// silently forking the chain; the loser re-reads the tail and retries. Booth
// write volume makes contention rare, and a lost race costs one extra round
// trip rather than correctness.

interface SaleRow {
  id: number;
  event_id: number;
  cashier_user_id: number;
  subtotal: number;
  discount: number;
  total: number;
  payment_method: string;
  created_at: string;
}

async function loadHashable(db: D1Database, saleId: number): Promise<HashableSale | null> {
  const sale = await db
    .prepare(
      'SELECT id, event_id, cashier_user_id, subtotal, discount, total, payment_method, created_at FROM sales WHERE id = ?',
    )
    .bind(saleId)
    .first<SaleRow>();
  if (!sale) return null;
  const items = await db
    .prepare('SELECT sku, qty, price, line_total FROM sale_items WHERE sale_id = ?')
    .bind(saleId)
    .all<{ sku: string; qty: number; price: number; line_total: number }>();
  return {
    id: Number(sale.id),
    event_id: Number(sale.event_id),
    cashier_user_id: Number(sale.cashier_user_id),
    subtotal: Number(sale.subtotal),
    discount: Number(sale.discount),
    total: Number(sale.total),
    payment_method: String(sale.payment_method),
    created_at: String(sale.created_at),
    items: items.results.map((i) => ({
      sku: String(i.sku),
      qty: Number(i.qty),
      price: Number(i.price),
      line_total: Number(i.line_total),
    })),
  };
}

async function chainTail(db: D1Database): Promise<{ seq: number; hash: string }> {
  const tail = await db
    .prepare('SELECT seq, tx_hash FROM sales WHERE seq IS NOT NULL ORDER BY seq DESC LIMIT 1')
    .first<{ seq: number; tx_hash: string }>();
  return tail ? { seq: Number(tail.seq), hash: String(tail.tx_hash) } : { seq: 0, hash: GENESIS_HASH };
}

/**
 * Seal one sale onto the chain. Idempotent: a sale that already carries a
 * tx_hash is left untouched, which keeps offline-queue replays safe.
 */
export async function sealSale(db: D1Database, saleId: number, attempts = 3): Promise<string | null> {
  const existing = await db.prepare('SELECT tx_hash FROM sales WHERE id = ?').bind(saleId).first<{ tx_hash: string | null }>();
  if (!existing) return null;
  if (existing.tx_hash) return existing.tx_hash;

  const sale = await loadHashable(db, saleId);
  if (!sale) return null;

  for (let i = 0; i < attempts; i++) {
    const tail = await chainTail(db);
    const txHash = await saleTxHash(sale, tail.hash);
    try {
      const res = await db
        .prepare('UPDATE sales SET seq = ?, prev_hash = ?, tx_hash = ? WHERE id = ? AND tx_hash IS NULL')
        .bind(tail.seq + 1, tail.hash, txHash, saleId)
        .run();
      // Another request sealed this same sale first — read back what it wrote.
      if (!res.meta.changes) {
        const now = await db.prepare('SELECT tx_hash FROM sales WHERE id = ?').bind(saleId).first<{ tx_hash: string | null }>();
        return now?.tx_hash ?? null;
      }
      return txHash;
    } catch (e) {
      // UNIQUE(seq) collision: a concurrent sale took this slot. Re-read and retry.
      if (!(e instanceof Error && e.message.includes('UNIQUE'))) throw e;
    }
  }
  return null;
}

export interface ChainVerification {
  verified: boolean;
  checked: number;
  broken_at: number | null;
  unsealed: number;
}

/**
 * Recompute the chain from stored rows. Any edited amount, date or item breaks it.
 *
 * Sales and items are loaded in two queries rather than per-row, so verification
 * stays a fixed number of round trips no matter how long the ledger gets.
 */
export async function verifyChain(db: D1Database, limit = 5000): Promise<ChainVerification> {
  const cap = Math.max(1, Math.min(limit, 20000));
  const [sales, items, unsealed] = await Promise.all([
    db
      .prepare(
        `SELECT id, seq, prev_hash, tx_hash, event_id, cashier_user_id, subtotal, discount, total, payment_method, created_at
         FROM sales WHERE seq IS NOT NULL ORDER BY seq LIMIT ${cap}`,
      )
      .all<SaleRow & { seq: number; prev_hash: string; tx_hash: string }>(),
    db
      .prepare(
        `SELECT sale_id, sku, qty, price, line_total FROM sale_items
         WHERE sale_id IN (SELECT id FROM sales WHERE seq IS NOT NULL ORDER BY seq LIMIT ${cap})`,
      )
      .all<{ sale_id: number; sku: string; qty: number; price: number; line_total: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM sales WHERE tx_hash IS NULL').first<{ n: number }>(),
  ]);

  const itemsBySale = new Map<number, HashableSale['items']>();
  for (const i of items.results) {
    const list = itemsBySale.get(Number(i.sale_id)) ?? [];
    list.push({ sku: String(i.sku), qty: Number(i.qty), price: Number(i.price), line_total: Number(i.line_total) });
    itemsBySale.set(Number(i.sale_id), list);
  }

  const pending = Number(unsealed?.n ?? 0);
  let prev = GENESIS_HASH;
  let checked = 0;

  for (const row of sales.results) {
    const sale: HashableSale = {
      id: Number(row.id),
      event_id: Number(row.event_id),
      cashier_user_id: Number(row.cashier_user_id),
      subtotal: Number(row.subtotal),
      discount: Number(row.discount),
      total: Number(row.total),
      payment_method: String(row.payment_method),
      created_at: String(row.created_at),
      items: itemsBySale.get(Number(row.id)) ?? [],
    };
    const expected = await saleTxHash(sale, prev);
    if (String(row.prev_hash) !== prev || expected !== String(row.tx_hash)) {
      return { verified: false, checked, broken_at: Number(row.id), unsealed: pending };
    }
    prev = String(row.tx_hash);
    checked++;
  }
  return { verified: true, checked, broken_at: null, unsealed: pending };
}

/** Backfill sales created before the chain existed. Idempotent and re-runnable. */
export async function rehashLedger(db: D1Database, batch = 500): Promise<{ sealed: number; remaining: number }> {
  const { results } = await db
    .prepare(`SELECT id FROM sales WHERE tx_hash IS NULL ORDER BY id LIMIT ${Math.max(1, Math.min(batch, 2000))}`)
    .all<{ id: number }>();
  let sealed = 0;
  for (const row of results) {
    if (await sealSale(db, Number(row.id))) sealed++;
  }
  const rest = await db.prepare('SELECT COUNT(*) AS n FROM sales WHERE tx_hash IS NULL').first<{ n: number }>();
  return { sealed, remaining: Number(rest?.n ?? 0) };
}
