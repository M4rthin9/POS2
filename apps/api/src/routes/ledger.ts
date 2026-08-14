import { Hono } from 'hono';
import { requireAuth, requireAdmin, requireSuperAdmin } from '../middleware';
import { ok, badRequest, fail } from '../lib/http';
import { rehashLedger, verifyChain } from '../lib/ledger';
import { auditStatement } from '../lib/audit';
import { zReportHash } from '@cida/shared';
import type { LedgerDirection, POSJournalEntry, ReconcileStatus } from '@cida/shared';
import type { Env, Variables } from '../env';

const ledger = new Hono<{ Bindings: Env; Variables: Variables }>();
ledger.use('*', requireAuth, requireAdmin);

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Traceable journal (printable statement source) ──
//
// Completed sales are CREDIT rows. Voided/refunded sales appear as reversing
// DEBIT rows so the printed ledger shows the correction instead of hiding it.
ledger.get('/journal', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  const eventId = Number(c.req.query('event_id')) || null;
  const cashierId = Number(c.req.query('cashier_id')) || null;

  const where: string[] = ['1=1'];
  const args: unknown[] = [];
  if (from) { where.push('date(s.created_at) >= ?'); args.push(from); }
  if (to) { where.push('date(s.created_at) <= ?'); args.push(to); }
  if (eventId) { where.push('s.event_id = ?'); args.push(eventId); }
  if (cashierId) { where.push('s.cashier_user_id = ?'); args.push(cashierId); }

  const sql = `SELECT s.id, s.seq, s.created_at, s.event_id, e.name AS event_name,
                      s.cashier_user_id, u.display_name AS cashier_name,
                      s.subtotal, s.discount, s.total, s.payment_method, s.status,
                      s.tx_hash, s.prev_hash, s.voided_at
               FROM sales s
               JOIN events e ON e.id = s.event_id
               JOIN users u ON u.id = s.cashier_user_id
               WHERE ${where.join(' AND ')}
               ORDER BY s.created_at, s.id
               LIMIT 5000`;
  const { results } = await c.env.DB.prepare(sql).bind(...args).all();

  // Opening balance = everything settled before the window.
  let openingSql = "SELECT COALESCE(SUM(total),0) AS n FROM sales WHERE status = 'COMPLETED'";
  const openingArgs: unknown[] = [];
  if (from) { openingSql += ' AND date(created_at) < ?'; openingArgs.push(from); }
  else openingSql += ' AND 1=0';
  if (eventId) { openingSql += ' AND event_id = ?'; openingArgs.push(eventId); }
  if (cashierId) { openingSql += ' AND cashier_user_id = ?'; openingArgs.push(cashierId); }
  const openingRow = await c.env.DB.prepare(openingSql).bind(...openingArgs).first<{ n: number }>();

  let balance = round(Number(openingRow?.n ?? 0));
  const opening = balance;
  const entries: POSJournalEntry[] = [];
  let credit = 0;
  let debit = 0;
  let discount = 0;

  for (const r of results) {
    const status = String(r.status);
    const amount = round(Number(r.total));
    const direction: LedgerDirection = status === 'COMPLETED' ? 'CREDIT' : 'DEBIT';
    if (direction === 'CREDIT') {
      balance = round(balance + amount);
      credit = round(credit + amount);
      discount = round(discount + Number(r.discount));
    } else {
      // Credit and its reversal fall on the same row, so the running balance is
      // unchanged — the DEBIT line exists to show the correction, not to move money.
      debit = round(debit + amount);
    }
    entries.push({
      sale_id: Number(r.id),
      seq: r.seq === null ? null : Number(r.seq),
      posted_at: String(r.created_at),
      event_id: Number(r.event_id),
      event_name: (r.event_name as string) ?? null,
      cashier_user_id: Number(r.cashier_user_id),
      cashier_name: (r.cashier_name as string) ?? null,
      payment_method: r.payment_method as 'Cash' | 'PromptPay',
      direction,
      amount,
      subtotal: round(Number(r.subtotal)),
      discount: round(Number(r.discount)),
      running_balance: balance,
      status: status as 'COMPLETED' | 'VOID' | 'REFUNDED',
      tx_hash: (r.tx_hash as string) ?? null,
      prev_hash: (r.prev_hash as string) ?? null,
      bank_ref: null,
      reconcile_status: 'UNMATCHED' as ReconcileStatus,
    });
  }

  const chain = await verifyChain(c.env.DB);

  return ok(c, {
    opening_balance: opening,
    closing_balance: balance,
    entries,
    totals: { credit, debit, discount, count: entries.length },
    chain,
  });
});

// ── Formal sales report ──
//
// One document covering every event in the period: itemised receipts per event,
// then organisation-wide category and product summaries, then the PromptPay
// listing the finance office ticks off against the bank statement by hand.
ledger.get('/report', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  const eventId = Number(c.req.query('event_id')) || null;

  const where = ["s.status = 'COMPLETED'"];
  const args: unknown[] = [];
  if (from) { where.push('date(s.created_at) >= ?'); args.push(from); }
  if (to) { where.push('date(s.created_at) <= ?'); args.push(to); }
  if (eventId) { where.push('s.event_id = ?'); args.push(eventId); }
  const scope = where.join(' AND ');

  // Reversed sales are listed separately so the report can account for them
  // without letting them distort the revenue figures.
  const voidWhere = where.map((w) => w.replace("s.status = 'COMPLETED'", "s.status IN ('VOID','REFUNDED')")).join(' AND ');

  const [saleRows, voidRows, tenders, stockRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT s.id, s.created_at, s.event_id, e.code AS event_code, e.name AS event_name, e.date AS event_date,
              e.location AS event_location, e.status AS event_status,
              s.cashier_user_id, u.display_name AS cashier_name,
              s.subtotal, s.discount, s.total, s.payment_method, s.status, s.tx_hash
       FROM sales s
       JOIN events e ON e.id = s.event_id
       JOIN users u ON u.id = s.cashier_user_id
       WHERE ${scope}
       ORDER BY e.id, s.created_at, s.id
       LIMIT 3000`,
    ).bind(...args).all(),

    c.env.DB.prepare(
      `SELECT s.id, s.created_at, s.event_id, e.name AS event_name, u.display_name AS cashier_name,
              s.total, s.status, s.void_reason, vu.display_name AS voided_by_name
       FROM sales s
       JOIN events e ON e.id = s.event_id
       JOIN users u ON u.id = s.cashier_user_id
       LEFT JOIN users vu ON vu.id = s.voided_by
       WHERE ${voidWhere}
       ORDER BY s.created_at, s.id LIMIT 1000`,
    ).bind(...args).all(),

    c.env.DB.prepare(
      `SELECT s.id AS sale_id, COALESCE(sp.method, s.payment_method) AS method, COALESCE(sp.amount, s.total) AS amount, sp.ref
       FROM sales s LEFT JOIN sale_payments sp ON sp.sale_id = s.id
       WHERE ${scope}`,
    ).bind(...args).all<{ sale_id: number; method: string; amount: number; ref: string | null }>(),

    c.env.DB.prepare('SELECT id, sku, name, stock, active FROM products').all<{ id: number; sku: string; name: string; stock: number | null; active: number }>(),
  ]);

  const saleIds = saleRows.results.map((s) => Number(s.id));
  const itemRows = saleIds.length
    ? await c.env.DB.prepare(
        `SELECT si.sale_id, si.product_id, si.sku, si.name, si.qty, si.price, si.line_total,
                COALESCE(d.name, 'ไม่ระบุแผนก') AS division_name
         FROM sale_items si
         LEFT JOIN products p ON p.id = si.product_id
         LEFT JOIN divisions d ON d.id = p.division_id
         WHERE si.sale_id IN (${saleIds.map(() => '?').join(',')})
         ORDER BY si.id`,
      ).bind(...saleIds).all()
    : { results: [] as Record<string, unknown>[] };

  const itemsBySale = new Map<number, Record<string, unknown>[]>();
  for (const it of itemRows.results) {
    const list = itemsBySale.get(Number(it.sale_id)) ?? [];
    list.push(it);
    itemsBySale.set(Number(it.sale_id), list);
  }

  const tendersBySale = new Map<number, { method: string; amount: number; ref: string | null }[]>();
  for (const t of tenders.results) {
    const list = tendersBySale.get(Number(t.sale_id)) ?? [];
    list.push({ method: String(t.method), amount: Number(t.amount), ref: t.ref ?? null });
    tendersBySale.set(Number(t.sale_id), list);
  }

  const stockBySku = new Map<string, { stock: number | null; active: number }>();
  for (const p of stockRows.results) stockBySku.set(String(p.sku), { stock: p.stock === null ? null : Number(p.stock), active: Number(p.active) });

  type Bucket = { gross: number; discount: number; net: number; cash: number; promptpay: number; count: number; item_qty: number };
  const zero = (): Bucket => ({ gross: 0, discount: 0, net: 0, cash: 0, promptpay: 0, count: 0, item_qty: 0 });
  const seal = (b: Bucket): Bucket => ({
    gross: round(b.gross), discount: round(b.discount), net: round(b.net),
    cash: round(b.cash), promptpay: round(b.promptpay), count: b.count, item_qty: round(b.item_qty),
  });

  const totals = zero();
  const categoryAll = new Map<string, { qty: number; revenue: number }>();
  const productAll = new Map<string, { sku: string; name: string; division_name: string; qty: number; revenue: number }>();
  const promptpayTrace: Record<string, unknown>[] = [];

  const eventMap = new Map<number, Record<string, unknown>>();

  for (const s of saleRows.results) {
    const id = Number(s.id);
    const evId = Number(s.event_id);
    if (!eventMap.has(evId)) {
      eventMap.set(evId, {
        id: evId,
        code: s.event_code,
        name: s.event_name,
        date: s.event_date ?? null,
        location: s.event_location ?? null,
        status: s.event_status,
        sales: [] as Record<string, unknown>[],
        totals: zero(),
        category_summary: new Map<string, { qty: number; revenue: number }>(),
        cashiers: new Map<number, { name: string; count: number; net: number }>(),
      });
    }
    const ev = eventMap.get(evId)!;
    const evTotals = ev.totals as Bucket;
    const evCats = ev.category_summary as Map<string, { qty: number; revenue: number }>;
    const evCashiers = ev.cashiers as Map<number, { name: string; count: number; net: number }>;

    const items = (itemsBySale.get(id) ?? []).map((it) => ({
      sku: String(it.sku),
      name: String(it.name),
      division_name: String(it.division_name),
      qty: Number(it.qty),
      price: round(Number(it.price)),
      line_total: round(Number(it.line_total)),
    }));

    const saleTenders = tendersBySale.get(id) ?? [{ method: String(s.payment_method), amount: Number(s.total), ref: null }];
    let cash = 0;
    let promptpay = 0;
    for (const t of saleTenders) {
      if (t.method === 'PromptPay') promptpay += t.amount;
      else cash += t.amount;
    }

    const qty = items.reduce((a, i) => a + i.qty, 0);
    for (const b of [totals, evTotals]) {
      b.gross += Number(s.subtotal);
      b.discount += Number(s.discount);
      b.net += Number(s.total);
      b.cash += cash;
      b.promptpay += promptpay;
      b.count += 1;
      b.item_qty += qty;
    }

    for (const it of items) {
      for (const map of [categoryAll, evCats]) {
        const cur = map.get(it.division_name) ?? { qty: 0, revenue: 0 };
        cur.qty += it.qty;
        cur.revenue += it.line_total;
        map.set(it.division_name, cur);
      }
      const key = it.sku;
      const cur = productAll.get(key) ?? { sku: it.sku, name: it.name, division_name: it.division_name, qty: 0, revenue: 0 };
      cur.qty += it.qty;
      cur.revenue += it.line_total;
      productAll.set(key, cur);
    }

    const cashier = evCashiers.get(Number(s.cashier_user_id)) ?? { name: String(s.cashier_name ?? '—'), count: 0, net: 0 };
    cashier.count += 1;
    cashier.net += Number(s.total);
    evCashiers.set(Number(s.cashier_user_id), cashier);

    (ev.sales as Record<string, unknown>[]).push({
      id,
      created_at: s.created_at,
      cashier_user_id: Number(s.cashier_user_id),
      cashier_name: s.cashier_name,
      payment_method: s.payment_method,
      tenders: saleTenders,
      subtotal: round(Number(s.subtotal)),
      discount: round(Number(s.discount)),
      total: round(Number(s.total)),
      item_qty: round(qty),
      tx_hash: s.tx_hash ?? null,
      items,
    });

    if (promptpay > 0) {
      promptpayTrace.push({
        sale_id: id,
        created_at: s.created_at,
        event_code: s.event_code,
        event_name: s.event_name,
        cashier_name: s.cashier_name,
        amount: round(promptpay),
        tx_hash: s.tx_hash ?? null,
        ref: saleTenders.find((t) => t.method === 'PromptPay')?.ref ?? null,
      });
    }
  }

  const events = [...eventMap.values()].map((ev) => {
    const cats = ev.category_summary as Map<string, { qty: number; revenue: number }>;
    const cashiers = ev.cashiers as Map<number, { name: string; count: number; net: number }>;
    return {
      ...ev,
      totals: seal(ev.totals as Bucket),
      category_summary: [...cats.entries()]
        .map(([division_name, v]) => ({ division_name, qty: round(v.qty), revenue: round(v.revenue) }))
        .sort((a, b) => b.revenue - a.revenue),
      cashiers: [...cashiers.entries()]
        .map(([user_id, v]) => ({ user_id, display_name: v.name, count: v.count, net: round(v.net) }))
        .sort((a, b) => b.net - a.net),
    };
  });

  const netTotal = round(totals.net);
  const categorySummary = [...categoryAll.entries()]
    .map(([division_name, v]) => ({
      division_name,
      qty: round(v.qty),
      revenue: round(v.revenue),
      share: netTotal > 0 ? Math.round((v.revenue / netTotal) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const productSummary = [...productAll.values()]
    .map((p) => {
      const stock = stockBySku.get(p.sku);
      return {
        sku: p.sku,
        name: p.name,
        division_name: p.division_name,
        qty: round(p.qty),
        revenue: round(p.revenue),
        stock_left: stock?.stock ?? null,
        sold_out: stock?.stock === 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  // Products that ran out but were not sold in this period still matter to the
  // Commander's stock picture, so they are reported separately.
  const soldSkus = new Set(productSummary.map((p) => p.sku));
  const soldOutUnsold = stockRows.results
    .filter((p) => Number(p.active) === 1 && p.stock !== null && Number(p.stock) === 0 && !soldSkus.has(String(p.sku)))
    .map((p) => ({ sku: String(p.sku), name: String(p.name), qty: 0, revenue: 0, stock_left: 0, sold_out: true, division_name: '—' }));

  const settingsRows = await c.env.DB.prepare('SELECT key, value FROM settings').all();
  const settings: Record<string, string> = {};
  for (const r of settingsRows.results) settings[String(r.key)] = String(r.value ?? '');

  return ok(c, {
    period: { from: from ?? null, to: to ?? null },
    settings,
    totals: seal(totals),
    events,
    category_summary: categorySummary,
    product_summary: productSummary,
    sold_out_products: soldOutUnsold,
    promptpay_trace: promptpayTrace,
    promptpay_total: round(promptpayTrace.reduce((a, p) => a + Number(p.amount), 0)),
    reversed: voidRows.results.map((v) => ({
      id: Number(v.id),
      created_at: v.created_at,
      event_name: v.event_name,
      cashier_name: v.cashier_name,
      total: round(Number(v.total)),
      status: v.status,
      void_reason: v.void_reason ?? null,
      voided_by_name: v.voided_by_name ?? null,
    })),
    chain: await verifyChain(c.env.DB),
    truncated: saleRows.results.length >= 3000,
  });
});

// ── Chain integrity ──
ledger.get('/ledger/verify', async (c) => ok(c, await verifyChain(c.env.DB)));

ledger.post('/ledger/rehash', requireSuperAdmin, async (c) => {
  const result = await rehashLedger(c.env.DB, Number(c.req.query('batch')) || 500);
  await auditStatement(c, { action: 'LEDGER_REHASH', entity: 'sales', after: result }).run();
  return ok(c, result);
});

// ── X / Z reports ──
//
// Scoped to (business day × event × cashier). There is no shift table and no
// opening float, so cash_expected is derived purely from cash-tender sales.
interface ZFigures {
  gross: number;
  discount: number;
  net: number;
  cash_expected: number;
  promptpay_total: number;
  sale_count: number;
  void_count: number;
  refund_count: number;
}

async function computeZ(db: D1Database, date: string, eventId: number | null, cashierId: number | null): Promise<ZFigures> {
  // Same predicate rendered twice: unaliased for the sales-only aggregate, and
  // `s.`-qualified for the query that joins sale_payments.
  const build = (p: string) => {
    const where = [`date(${p}created_at) = ?`];
    if (eventId) where.push(`${p}event_id = ?`);
    if (cashierId) where.push(`${p}cashier_user_id = ?`);
    return where.join(' AND ');
  };
  const args: unknown[] = [date];
  if (eventId) args.push(eventId);
  if (cashierId) args.push(cashierId);
  const clause = build('');

  const [row, tenders] = await Promise.all([
    db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN status='COMPLETED' THEN subtotal END),0) AS gross,
           COALESCE(SUM(CASE WHEN status='COMPLETED' THEN discount END),0) AS discount,
           COALESCE(SUM(CASE WHEN status='COMPLETED' THEN total END),0) AS net,
           COALESCE(SUM(CASE WHEN status='COMPLETED' THEN 1 END),0) AS n,
           COALESCE(SUM(CASE WHEN status='VOID' THEN 1 END),0) AS voids,
           COALESCE(SUM(CASE WHEN status='REFUNDED' THEN 1 END),0) AS refunds
         FROM sales WHERE ${clause}`,
      )
      .bind(...args)
      .first<Record<string, number>>(),
    // Split bills tender through sale_payments; unsplit sales fall back to the
    // sale's own payment_method.
    db
      .prepare(
        `SELECT COALESCE(sp.method, s.payment_method) AS k, COALESCE(SUM(COALESCE(sp.amount, s.total)),0) AS v
         FROM sales s LEFT JOIN sale_payments sp ON sp.sale_id = s.id
         WHERE ${build('s.')} AND s.status='COMPLETED'
         GROUP BY k`,
      )
      .bind(...args)
      .all<{ k: string; v: number }>(),
  ]);

  const byMethod: Record<string, number> = {};
  for (const t of tenders.results) byMethod[String(t.k)] = Number(t.v);

  return {
    gross: round(Number(row?.gross ?? 0)),
    discount: round(Number(row?.discount ?? 0)),
    net: round(Number(row?.net ?? 0)),
    cash_expected: round(byMethod.Cash ?? 0),
    promptpay_total: round(byMethod.PromptPay ?? 0),
    sale_count: Number(row?.n ?? 0),
    void_count: Number(row?.voids ?? 0),
    refund_count: Number(row?.refunds ?? 0),
  };
}

function scopeArgs(c: { req: { query: (k: string) => string | undefined } }) {
  return {
    date: c.req.query('date') || new Date().toISOString().slice(0, 10),
    eventId: Number(c.req.query('event_id')) || null,
    cashierId: Number(c.req.query('cashier_id')) || null,
  };
}

/** X-report: read-only snapshot, never persisted, safe to run any number of times. */
ledger.get('/zreport', async (c) => {
  const { date, eventId, cashierId } = scopeArgs(c);
  const figures = await computeZ(c.env.DB, date, eventId, cashierId);

  const closed = await c.env.DB
    .prepare(
      `SELECT z.*, u.display_name AS closer_name, e.name AS event_name, cu.display_name AS cashier_name
       FROM z_reports z
       LEFT JOIN users u ON u.id = z.closed_by
       LEFT JOIN users cu ON cu.id = z.cashier_user_id
       LEFT JOIN events e ON e.id = z.event_id
       WHERE z.business_date = ? AND COALESCE(z.event_id,0) = ? AND COALESCE(z.cashier_user_id,0) = ?`,
    )
    .bind(date, eventId ?? 0, cashierId ?? 0)
    .first();

  // A closed day reports the figures sealed at close time. Recomputing would
  // let sales entered afterwards silently change a report already signed off.
  const sealed: ZFigures | null = closed
    ? {
        gross: Number(closed.gross),
        discount: Number(closed.discount),
        net: Number(closed.net),
        cash_expected: Number(closed.cash_expected),
        promptpay_total: Number(closed.promptpay_total),
        sale_count: Number(closed.sale_count),
        void_count: Number(closed.void_count),
        refund_count: Number(closed.refund_count),
      }
    : null;

  return ok(c, {
    business_date: date,
    event_id: eventId,
    cashier_user_id: cashierId,
    ...(sealed ?? figures),
    // Surfaced so the UI can warn when activity landed after the day was closed.
    live: figures,
    drifted: !!sealed && (sealed.net !== figures.net || sealed.sale_count !== figures.sale_count),
    id: closed ? Number(closed.id) : null,
    cash_counted: closed ? (closed.cash_counted === null ? null : Number(closed.cash_counted)) : null,
    variance: closed ? (closed.variance === null ? null : Number(closed.variance)) : null,
    closed_by: closed ? Number(closed.closed_by) : null,
    closed_at: closed ? String(closed.closed_at) : null,
    report_hash: closed ? (closed.report_hash as string) : null,
    cashier_name: closed ? ((closed.cashier_name as string) ?? null) : null,
    event_name: closed ? ((closed.event_name as string) ?? null) : null,
  });
});

/** Z-report: closes the day and locks the figures. */
ledger.post('/zreport/close', async (c) => {
  const b = await c.req.json().catch(() => null);
  const date = String(b?.business_date || '').trim() || new Date().toISOString().slice(0, 10);
  const eventId = Number(b?.event_id) || null;
  const cashierId = Number(b?.cashier_user_id) || null;
  const counted = b?.cash_counted === null || b?.cash_counted === undefined || b?.cash_counted === '' ? null : Number(b.cash_counted);
  if (counted !== null && !Number.isFinite(counted)) return badRequest(c, 'จำนวนเงินสดที่นับได้ไม่ถูกต้อง');

  const existing = await c.env.DB
    .prepare('SELECT id FROM z_reports WHERE business_date = ? AND COALESCE(event_id,0) = ? AND COALESCE(cashier_user_id,0) = ?')
    .bind(date, eventId ?? 0, cashierId ?? 0)
    .first();
  if (existing) return fail(c, 'วันนี้ปิดยอดไปแล้ว', 409, 'ALREADY_CLOSED');

  const f = await computeZ(c.env.DB, date, eventId, cashierId);
  const variance = counted === null ? null : round(counted - f.cash_expected);
  const user = c.get('user');
  const hash = await zReportHash({
    business_date: date,
    event_id: eventId,
    cashier_user_id: cashierId,
    gross: f.gross,
    discount: f.discount,
    net: f.net,
    cash_expected: f.cash_expected,
    cash_counted: counted,
    promptpay_total: f.promptpay_total,
    sale_count: f.sale_count,
    closed_by: user.id,
  });

  const row = await c.env.DB
    .prepare(
      `INSERT INTO z_reports (business_date, event_id, cashier_user_id, gross, discount, net, cash_expected,
                              cash_counted, variance, promptpay_total, sale_count, void_count, refund_count,
                              closed_by, closed_at, report_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'), ?) RETURNING *`,
    )
    .bind(date, eventId, cashierId, f.gross, f.discount, f.net, f.cash_expected, counted, variance,
      f.promptpay_total, f.sale_count, f.void_count, f.refund_count, user.id, hash)
    .first<Record<string, unknown>>();

  await auditStatement(c, {
    action: 'ZREPORT_CLOSE',
    entity: 'z_reports',
    entity_id: Number(row?.id),
    after: { date, event_id: eventId, cashier_user_id: cashierId, ...f, cash_counted: counted, variance },
  }).run();

  return ok(c, row, 201);
});

ledger.get('/zreport/history', async (c) => {
  const { results } = await c.env.DB
    .prepare(
      `SELECT z.*, u.display_name AS closer_name, e.name AS event_name, cu.display_name AS cashier_name
       FROM z_reports z
       LEFT JOIN users u ON u.id = z.closed_by
       LEFT JOIN users cu ON cu.id = z.cashier_user_id
       LEFT JOIN events e ON e.id = z.event_id
       ORDER BY z.business_date DESC, z.id DESC LIMIT 100`,
    )
    .all();
  return ok(c, results);
});

export default ledger;
