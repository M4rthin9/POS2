import { Hono } from 'hono';
import { requireAuth, requireAdmin, requireSuperAdmin } from '../middleware';
import { ok, fail, badRequest, notFound } from '../lib/http';
import { hashPin, randomSalt, isValidPin } from '../lib/password';
import { auditStatement } from '../lib/audit';
import type { Env, Variables } from '../env';

const admin = new Hono<{ Bindings: Env; Variables: Variables }>();
admin.use('*', requireAuth, requireAdmin);

// ── Overview ──
admin.get('/overview', async (c) => {
  const [products, users, events, divisions, todaySales, activeEvents] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM products').first(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE active = 1').first(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM events').first(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM divisions').first(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS revenue, COALESCE(SUM(discount),0) AS discount
       FROM sales WHERE date(created_at) = date('now') AND status = 'COMPLETED'`,
    ).first(),
    c.env.DB.prepare(
      "SELECT id, name, date FROM events WHERE status = 'ACTIVE' ORDER BY id DESC",
    ).all(),
  ]);
  const all = await c.env.DB.prepare(
    "SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS revenue FROM sales WHERE status = 'COMPLETED'",
  ).first();

  return ok(c, {
    total_products: Number((products as { n: number }).n),
    total_users: Number((users as { n: number }).n),
    total_events: Number((events as { n: number }).n),
    total_divisions: Number((divisions as { n: number }).n),
    total_sales: Number((all as { count: number }).count),
    total_revenue: Number((all as { revenue: number }).revenue),
    today_sales: Number((todaySales as { count: number }).count),
    today_revenue: Number((todaySales as { revenue: number }).revenue),
    today_discount: Number((todaySales as { discount: number }).discount),
    active_event: activeEvents.results.length ? (activeEvents.results[0].name as string) : null,
    active_event_id: activeEvents.results.length ? (activeEvents.results[0].id as number) : null,
    active_events: activeEvents.results.map((r) => ({ id: r.id as number, name: r.name as string, date: (r.date as string) ?? null })),
  });
});

// ── Stats / reports ──
admin.get('/stats', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  const eventIds = (c.req.query('event_ids') || '')
    .split(',')
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0);

  let sql = "SELECT * FROM sales WHERE status = 'COMPLETED'";
  const args: unknown[] = [];
  if (from) { sql += ' AND date(created_at) >= ?'; args.push(from); }
  if (to) { sql += ' AND date(created_at) <= ?'; args.push(to); }
  if (eventIds.length) { sql += ` AND event_id IN (${eventIds.map(() => '?').join(',')})`; args.push(...eventIds); }
  const { results: sales } = await c.env.DB.prepare(sql + ' ORDER BY id').bind(...args).all();

  const paymentBreakdown: Record<string, number> = {};
  const divisionBreakdown: Record<string, number> = {};
  const productBreakdown: Record<string, { qty: number; revenue: number }> = {};
  const daily: Record<string, number> = {};
  let totalRevenue = 0;
  let totalDiscount = 0;

  const saleIds = sales.map((s) => Number(s.id));
  const itemRows = saleIds.length
    ? await c.env.DB.prepare(
        `SELECT si.product_id, si.qty, si.price, si.line_total, si.sku, si.name, p.division_id, d.name AS division_name
         FROM sale_items si
         LEFT JOIN products p ON p.id = si.product_id
         LEFT JOIN divisions d ON d.id = p.division_id
         WHERE si.sale_id IN (${saleIds.map(() => '?').join(',')})`,
      ).bind(...saleIds).all()
    : { results: [] };

  const divMap = await c.env.DB.prepare('SELECT id, name FROM divisions').all();
  const divNames = new Map<number, string>(divMap.results.map((r) => [Number(r.id), r.name as string]));

  // Split bills tender through sale_payments; unsplit sales use payment_method.
  const splitRows = saleIds.length
    ? await c.env.DB.prepare(
        `SELECT sale_id, method, amount FROM sale_payments WHERE sale_id IN (${saleIds.map(() => '?').join(',')})`,
      ).bind(...saleIds).all<{ sale_id: number; method: string; amount: number }>()
    : { results: [] as { sale_id: number; method: string; amount: number }[] };
  const splitBySale = new Map<number, { method: string; amount: number }[]>();
  for (const p of splitRows.results) {
    const list = splitBySale.get(Number(p.sale_id)) ?? [];
    list.push({ method: String(p.method), amount: Number(p.amount) });
    splitBySale.set(Number(p.sale_id), list);
  }

  for (const s of sales) {
    const total = Number(s.total);
    totalRevenue += total;
    totalDiscount += Number(s.discount);
    const tenders = splitBySale.get(Number(s.id)) ?? [{ method: s.payment_method as string, amount: total }];
    for (const t of tenders) paymentBreakdown[t.method] = (paymentBreakdown[t.method] || 0) + t.amount;
    const day = String(s.created_at).slice(0, 10);
    daily[day] = (daily[day] || 0) + total;
  }
  for (const it of itemRows.results) {
    const revenue = Number(it.line_total);
    const key = `${it.sku} ${it.name}`.trim();
    const entry = productBreakdown[key] || { qty: 0, revenue: 0 };
    entry.qty += Number(it.qty);
    entry.revenue += revenue;
    productBreakdown[key] = entry;

    const divName = (it.division_name as string) || divNames.get(Number(it.division_id)) || 'อื่นๆ';
    divisionBreakdown[divName] = (divisionBreakdown[divName] || 0) + revenue;
  }

  return ok(c, {
    total_revenue: Math.round(totalRevenue * 100) / 100,
    total_discount: Math.round(totalDiscount * 100) / 100,
    total_sales: sales.length,
    avg_per_sale: sales.length ? Math.round((totalRevenue / sales.length) * 100) / 100 : 0,
    payment_breakdown: paymentBreakdown,
    division_breakdown: divisionBreakdown,
    product_breakdown: productBreakdown,
    daily,
  });
});

// ── Operations dashboard ──
//
// One aggregated payload so the dashboard polls a single endpoint instead of
// fanning out to overview/stats/events/sales on every refresh.
admin.get('/dashboard', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  const eventId = Number(c.req.query('event_id')) || null;
  const today = new Date().toISOString().slice(0, 10);
  const r2 = (n: number) => Math.round(n * 100) / 100;

  const where = ['1=1'];
  const args: unknown[] = [];
  if (from) { where.push('date(s.created_at) >= ?'); args.push(from); }
  if (to) { where.push('date(s.created_at) <= ?'); args.push(to); }
  if (eventId) { where.push('s.event_id = ?'); args.push(eventId); }
  const scope = where.join(' AND ');

  const thresholdRow = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'low_stock_threshold'").first<{ value: string }>();
  const threshold = Math.max(0, Number(thresholdRow?.value ?? 5) || 0);

  const [kpiRow, payments, daily, divisions, recent, events, cashiers, lowStock, audit, reconcileRow, todayRow] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(CASE WHEN s.status='COMPLETED' THEN s.subtotal END),0) AS gross,
              COALESCE(SUM(CASE WHEN s.status='COMPLETED' THEN s.discount END),0) AS discount,
              COALESCE(SUM(CASE WHEN s.status='COMPLETED' THEN s.total END),0) AS net,
              COALESCE(SUM(CASE WHEN s.status='COMPLETED' THEN 1 END),0) AS completed,
              COALESCE(SUM(CASE WHEN s.status='VOID' THEN 1 END),0) AS voided,
              COALESCE(SUM(CASE WHEN s.status='REFUNDED' THEN 1 END),0) AS refunded
       FROM sales s WHERE ${scope}`,
    ).bind(...args).first<Record<string, number>>(),

    // Split bills record their tenders in sale_payments; sales without a split
    // fall back to the single payment_method column.
    c.env.DB.prepare(
      `SELECT COALESCE(sp.method, s.payment_method) AS k, COALESCE(SUM(COALESCE(sp.amount, s.total)),0) AS v
       FROM sales s LEFT JOIN sale_payments sp ON sp.sale_id = s.id
       WHERE ${scope} AND s.status='COMPLETED' GROUP BY k`,
    ).bind(...args).all(),

    c.env.DB.prepare(
      `SELECT date(s.created_at) AS d, COALESCE(SUM(s.total),0) AS v FROM sales s
       WHERE ${scope} AND s.status='COMPLETED' GROUP BY date(s.created_at) ORDER BY d`,
    ).bind(...args).all(),

    c.env.DB.prepare(
      `SELECT COALESCE(d.name, 'อื่นๆ') AS k, COALESCE(SUM(si.line_total),0) AS v
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       LEFT JOIN products p ON p.id = si.product_id
       LEFT JOIN divisions d ON d.id = p.division_id
       WHERE ${scope} AND s.status='COMPLETED' GROUP BY k ORDER BY v DESC`,
    ).bind(...args).all(),

    c.env.DB.prepare(
      `SELECT s.id, s.event_id, e.name AS event_name, s.cashier_user_id, u.display_name AS cashier_name,
              s.subtotal, s.discount, s.total, s.payment_method, s.status, s.created_at, s.tx_hash
       FROM sales s JOIN events e ON e.id = s.event_id JOIN users u ON u.id = s.cashier_user_id
       WHERE ${scope} ORDER BY s.id DESC LIMIT 15`,
    ).bind(...args).all(),

    c.env.DB.prepare(
      `SELECT e.id, e.code, e.name, e.status, e.date,
              COALESCE(SUM(CASE WHEN s.status='COMPLETED' AND date(s.created_at)=date('now') THEN 1 END),0) AS today_sales,
              COALESCE(SUM(CASE WHEN s.status='COMPLETED' AND date(s.created_at)=date('now') THEN s.total END),0) AS today_revenue,
              MAX(s.created_at) AS last_sale_at
       FROM events e LEFT JOIN sales s ON s.event_id = e.id
       GROUP BY e.id
       ORDER BY CASE e.status WHEN 'ACTIVE' THEN 0 WHEN 'UPCOMING' THEN 1 ELSE 2 END, e.id DESC LIMIT 12`,
    ).all(),

    c.env.DB.prepare(
      `SELECT u.id AS user_id, u.display_name,
              COUNT(s.id) AS sale_count,
              COALESCE(SUM(s.total),0) AS revenue,
              COALESCE(SUM(CASE WHEN s.payment_method='Cash' THEN s.total END),0) AS cash,
              COALESCE(SUM(CASE WHEN s.payment_method='PromptPay' THEN s.total END),0) AS promptpay,
              MAX(s.created_at) AS last_sale_at
       FROM sales s JOIN users u ON u.id = s.cashier_user_id
       WHERE ${scope} AND s.status='COMPLETED'
       GROUP BY u.id ORDER BY revenue DESC LIMIT 12`,
    ).bind(...args).all(),

    c.env.DB.prepare(
      `SELECT p.id, p.sku, p.name, p.stock, d.name AS division_name,
              COALESCE((SELECT SUM(si.qty) FROM sale_items si JOIN sales s2 ON s2.id = si.sale_id
                        WHERE si.product_id = p.id AND s2.status='COMPLETED' AND date(s2.created_at)=date('now')),0) AS sold_today
       FROM products p LEFT JOIN divisions d ON d.id = p.division_id
       WHERE p.active = 1 AND p.stock IS NOT NULL AND p.stock <= ?
       ORDER BY p.stock, p.name LIMIT 30`,
    ).bind(threshold).all(),

    c.env.DB.prepare(
      `SELECT a.*, u.display_name AS actor_name FROM audit_log a
       LEFT JOIN users u ON u.id = a.actor_user_id ORDER BY a.id DESC LIMIT 10`,
    ).all(),

    // PromptPay receipts the finance office has to tick off against the bank
    // statement by hand — the system never ingests statement files.
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(COALESCE(sp.amount, s.total)),0) AS amount, COUNT(*) AS n
       FROM sales s LEFT JOIN sale_payments sp ON sp.sale_id = s.id
       WHERE ${scope} AND s.status='COMPLETED' AND COALESCE(sp.method, s.payment_method) = 'PromptPay'`,
    ).bind(...args).first<Record<string, number>>(),

    c.env.DB.prepare(
      `SELECT COALESCE(SUM(total),0) AS net, COUNT(*) AS n FROM sales
       WHERE date(created_at) = date('now') AND status='COMPLETED'`,
    ).first<Record<string, number>>(),
  ]);

  const zRow = await c.env.DB
    .prepare('SELECT * FROM z_reports WHERE business_date = ? AND COALESCE(event_id,0) = ? ORDER BY id DESC LIMIT 1')
    .bind(today, eventId ?? 0)
    .first();

  const completed = Number(kpiRow?.completed ?? 0);
  const net = r2(Number(kpiRow?.net ?? 0));
  const toMap = (rows: { results: Record<string, unknown>[] }, keyCol = 'k', valCol = 'v') => {
    const m: Record<string, number> = {};
    for (const r of rows.results) m[String(r[keyCol])] = r2(Number(r[valCol]));
    return m;
  };
  const paymentMap = toMap(payments);
  const cashTotal = r2(paymentMap.Cash ?? 0);

  return ok(c, {
    period: { from: from ?? null, to: to ?? null, label: '' },
    kpi: {
      gross: r2(Number(kpiRow?.gross ?? 0)),
      discount: r2(Number(kpiRow?.discount ?? 0)),
      net,
      cash_total: cashTotal,
      promptpay_total: r2(paymentMap.PromptPay ?? 0),
      orders_completed: completed,
      orders_void: Number(kpiRow?.voided ?? 0),
      orders_refunded: Number(kpiRow?.refunded ?? 0),
      avg_basket: completed ? r2(net / completed) : 0,
      low_stock_count: lowStock.results.length,
      today_net: r2(Number(todayRow?.net ?? 0)),
      today_orders: Number(todayRow?.n ?? 0),
    },
    payment_breakdown: paymentMap,
    division_breakdown: toMap(divisions),
    daily: toMap(daily, 'd', 'v'),
    recent_sales: recent.results,
    events: events.results.map((e) => ({
      id: Number(e.id), code: e.code, name: e.name, status: e.status, date: e.date,
      today_sales: Number(e.today_sales), today_revenue: r2(Number(e.today_revenue)), last_sale_at: e.last_sale_at,
    })),
    cashiers: cashiers.results.map((u) => ({
      user_id: Number(u.user_id), display_name: u.display_name, sale_count: Number(u.sale_count),
      revenue: r2(Number(u.revenue)), cash: r2(Number(u.cash)), promptpay: r2(Number(u.promptpay)), last_sale_at: u.last_sale_at,
    })),
    low_stock: lowStock.results.map((p) => ({
      id: Number(p.id), sku: p.sku, name: p.name, stock: Number(p.stock),
      division_name: p.division_name ?? null, sold_today: Number(p.sold_today),
    })),
    audit_tail: audit.results,
    promptpay_trace: {
      amount: r2(Number(reconcileRow?.amount ?? 0)),
      count: Number(reconcileRow?.n ?? 0),
    },
    zreport: {
      closed: !!zRow,
      closed_at: zRow ? String(zRow.closed_at) : null,
      cash_expected: zRow ? r2(Number(zRow.cash_expected)) : cashTotal,
      cash_counted: zRow && zRow.cash_counted !== null ? r2(Number(zRow.cash_counted)) : null,
      variance: zRow && zRow.variance !== null ? r2(Number(zRow.variance)) : null,
    },
  });
});

// ── Products ──
const productFields = 'id, sku, name, division_id, price, image_url, stock, active, created_at';

admin.get('/products', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.sku, p.name, p.division_id, d.name AS division_name, p.price, p.image_url, p.stock, p.active, p.created_at
     FROM products p LEFT JOIN divisions d ON d.id = p.division_id ORDER BY p.id DESC`,
  ).all();
  return ok(c, results);
});

admin.post('/products', async (c) => {
  const b = await c.req.json().catch(() => null);
  const sku = String(b?.sku || '').trim();
  const name = String(b?.name || '').trim();
  const price = Number(b?.price);
  const stock = b?.stock === null || b?.stock === undefined || b?.stock === '' ? null : Number(b?.stock);
  if (!sku || !name) return badRequest(c, 'กรอก SKU และชื่อสินค้า');
  if (!Number.isFinite(price) || price < 0) return badRequest(c, 'ราคาไม่ถูกต้อง');
  if (stock !== null && (!Number.isInteger(stock) || stock < 0)) return badRequest(c, 'สต็อกไม่ถูกต้อง');
  try {
    const r = await c.env.DB.prepare(
      `INSERT INTO products (sku, name, division_id, price, image_url, stock, active) VALUES (?,?,?,?,?,?,?) RETURNING ${productFields}`,
    )
      .bind(sku, name, b?.division_id ? Number(b.division_id) : null, price, b?.image_url || null, stock, b?.active === false ? 0 : 1)
      .first<Record<string, unknown>>();
    return ok(c, r, 201);
  } catch (e) {
    if (e instanceof Error && e.message.includes('UNIQUE')) return fail(c, 'SKU ซ้ำ', 409, 'DUPLICATE_SKU');
    throw e;
  }
});

admin.put('/products/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => null);
  const cur = await c.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
  if (!cur) return notFound(c);
  const sku = String(b?.sku ?? cur.sku ?? '').trim();
  const name = String(b?.name ?? cur.name ?? '').trim();
  const price = b?.price !== undefined ? Number(b.price) : Number(cur.price);
  const stock: number | null = b?.stock === undefined ? (cur.stock as number | null) : b?.stock === null || b?.stock === '' ? null : Number(b.stock);
  const divisionId = b?.division_id !== undefined ? (b.division_id ? Number(b.division_id) : null) : cur.division_id;
  if (!sku || !name) return badRequest(c, 'กรอก SKU และชื่อสินค้า');
  if (!Number.isFinite(price) || price < 0) return badRequest(c, 'ราคาไม่ถูกต้อง');
  if (stock !== null && (!Number.isInteger(stock) || stock < 0)) return badRequest(c, 'สต็อกไม่ถูกต้อง');
  try {
    const r = await c.env.DB.prepare(
      `UPDATE products SET sku=?, name=?, division_id=?, price=?, image_url=?, stock=?, active=? WHERE id=? RETURNING ${productFields}`,
    )
      .bind(sku, name, divisionId, price, b?.image_url !== undefined ? b.image_url : cur.image_url, stock, b?.active !== undefined ? (b.active ? 1 : 0) : cur.active, id)
      .first<Record<string, unknown>>();
    if (!r) return notFound(c);
    return ok(c, r);
  } catch (e) {
    if (e instanceof Error && e.message.includes('UNIQUE')) return fail(c, 'SKU ซ้ำ', 409, 'DUPLICATE_SKU');
    throw e;
  }
});

admin.delete('/products/:id', async (c) => {
  const id = Number(c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run();
  return ok(c, { deleted: id });
});

admin.post('/products/import', async (c) => {
  const b = await c.req.json().catch(() => null);
  const rows = Array.isArray(b?.products) ? b.products : [];
  if (!rows.length) return badRequest(c, 'ไม่มีข้อมูลสินค้า');
  const stmts: D1PreparedStatement[] = [];
  for (const row of rows) {
    const sku = String(row?.sku ?? '').trim();
    const name = String(row?.name ?? '').trim();
    const price = Number(row?.price ?? 0);
    const stock = row?.stock === undefined || row?.stock === null || row?.stock === '' ? null : Number(row.stock);
    if (!sku || !name) continue;
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO products (sku, name, division_id, price, image_url, stock, active)
         VALUES (?,?,?,?,?,?,1)
         ON CONFLICT(sku) DO UPDATE SET name=excluded.name, price=excluded.price, image_url=excluded.image_url, stock=excluded.stock, division_id=excluded.division_id, active=1`,
      ).bind(sku, name, row?.division_id ? Number(row.division_id) : null, price, row?.image_url || null, stock),
    );
  }
  if (!stmts.length) return badRequest(c, 'ไม่มีรายการที่ถูกต้อง');
  await c.env.DB.batch(stmts);
  return ok(c, { imported: stmts.length });
});

// ── Events ──
admin.get('/events', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, code, name, date, location, status, created_at FROM events ORDER BY id DESC',
  ).all();
  return ok(c, results);
});

admin.post('/events', async (c) => {
  const b = await c.req.json().catch(() => null);
  const code = String(b?.code || '').trim();
  const name = String(b?.name || '').trim();
  if (!code || !name) return badRequest(c, 'กรอกรหัสและชื่อกิจกรรม');
  try {
    const r = await c.env.DB.prepare(
      `INSERT INTO events (code, name, date, location, status) VALUES (?,?,?,?,?) RETURNING id, code, name, date, location, status, created_at`,
    ).bind(code, name, b?.date || null, b?.location || null, b?.status || 'UPCOMING').first<Record<string, unknown>>();
    return ok(c, r, 201);
  } catch (e) {
    if (e instanceof Error && e.message.includes('UNIQUE')) return fail(c, 'รหัสกิจกรรมซ้ำ', 409, 'DUPLICATE_CODE');
    throw e;
  }
});

admin.put('/events/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => null);
  const cur = await c.env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first();
  if (!cur) return notFound(c);
  const code = String(b?.code ?? cur.code ?? '').trim();
  const name = String(b?.name ?? cur.name ?? '').trim();
  if (!code || !name) return badRequest(c, 'กรอกรหัสและชื่อกิจกรรม');
  try {
    const r = await c.env.DB.prepare(
      `UPDATE events SET code=?, name=?, date=?, location=?, status=? WHERE id=? RETURNING id, code, name, date, location, status, created_at`,
    )
      .bind(code, name, b?.date !== undefined ? b.date : cur.date, b?.location !== undefined ? b.location : cur.location, b?.status ?? cur.status, id)
      .first<Record<string, unknown>>();
    if (!r) return notFound(c);
    return ok(c, r);
  } catch (e) {
    if (e instanceof Error && e.message.includes('UNIQUE')) return fail(c, 'รหัสกิจกรรมซ้ำ', 409, 'DUPLICATE_CODE');
    throw e;
  }
});

admin.delete('/events/:id', async (c) => {
  const id = Number(c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
  return ok(c, { deleted: id });
});

// Several booths run at once, so activating one event no longer closes the
// others — cashiers pick whichever active event they are working.
admin.post('/events/:id/activate', async (c) => {
  const id = Number(c.req.param('id'));
  const ev = await c.env.DB.prepare('SELECT id FROM events WHERE id = ?').bind(id).first();
  if (!ev) return notFound(c);
  await c.env.DB.prepare("UPDATE events SET status = 'ACTIVE' WHERE id = ?").bind(id).run();
  const updated = await c.env.DB.prepare('SELECT id, code, name, date, location, status, created_at FROM events WHERE id = ?').bind(id).first();
  return ok(c, updated);
});

admin.post('/events/:id/close', async (c) => {
  const id = Number(c.req.param('id'));
  const ev = await c.env.DB.prepare('SELECT id FROM events WHERE id = ?').bind(id).first();
  if (!ev) return notFound(c);
  await c.env.DB.prepare("UPDATE events SET status = 'CLOSED' WHERE id = ?").bind(id).run();
  const updated = await c.env.DB.prepare('SELECT id, code, name, date, location, status, created_at FROM events WHERE id = ?').bind(id).first();
  return ok(c, updated);
});

// event ↔ products
admin.get('/events/:id/products', async (c) => {
  const id = Number(c.req.param('id'));
  const { results } = await c.env.DB.prepare('SELECT product_id FROM event_products WHERE event_id = ?').bind(id).all();
  return ok(c, results.map((r) => Number(r.product_id)));
});

admin.put('/events/:id/products', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => null);
  const ids = Array.isArray(b?.product_ids) ? [...new Set(b.product_ids.map((n: unknown) => Number(n)).filter((n: number) => Number.isInteger(n)))] : [];
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM event_products WHERE event_id = ?').bind(id),
    ...ids.map((pid) => c.env.DB.prepare('INSERT OR IGNORE INTO event_products (event_id, product_id) VALUES (?,?)').bind(id, pid)),
  ]);
  return ok(c, { count: ids.length });
});

// ── Users ──
admin.get('/users', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, username, display_name, role, active, created_at FROM users ORDER BY id',
  ).all();
  return ok(c, results);
});

admin.post('/users', async (c) => {
  const b = await c.req.json().catch(() => null);
  const username = String(b?.username || '').trim();
  const displayName = String(b?.display_name || '').trim();
  const role = b?.role === 'superadmin' || b?.role === 'admin' ? b.role : 'cashier';
  const pin = String(b?.pin || '');
  if (!username || !displayName) return badRequest(c, 'กรอกชื่อผู้ใช้และชื่อแสดง');
  if (!isValidPin(pin)) return badRequest(c, 'PIN ต้องเป็นตัวเลข 4–6 หลัก');
  const salt = randomSalt();
  const hash = await hashPin(pin, salt);
  try {
    const r = await c.env.DB.prepare(
      'INSERT INTO users (username, pin_hash, pin_salt, display_name, role, active) VALUES (?,?,?,?,?,1) RETURNING id, username, display_name, role, active, created_at',
    ).bind(username, hash, salt, displayName, role).first<Record<string, unknown>>();
    return ok(c, r, 201);
  } catch (e) {
    if (e instanceof Error && e.message.includes('UNIQUE')) return fail(c, 'ชื่อผู้ใช้ซ้ำ', 409, 'DUPLICATE_USERNAME');
    throw e;
  }
});

admin.put('/users/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => null);
  const cur = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!cur) return notFound(c);
  const username = String(b?.username ?? cur.username ?? '').trim();
  const displayName = String(b?.display_name ?? cur.display_name ?? '').trim();
  const role = b?.role ? (b.role === 'superadmin' || b.role === 'admin' ? b.role : 'cashier') : cur.role;
  if (!username || !displayName) return badRequest(c, 'กรอกชื่อผู้ใช้และชื่อแสดง');
  if ((cur.role as string) === 'superadmin' && role !== 'superadmin') {
    const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'superadmin'").first<{ n: number }>();
    if (Number(count?.n) <= 1) return fail(c, 'ไม่สามารถลดสิทธิ์ superadmin คนสุดท้าย', 400);
  }
  let pinHash = cur.pin_hash as string;
  let pinSalt = cur.pin_salt as string;
  if (b?.pin) {
    if (!isValidPin(String(b.pin))) return badRequest(c, 'PIN ต้องเป็นตัวเลข 4–6 หลัก');
    pinSalt = randomSalt();
    pinHash = await hashPin(String(b.pin), pinSalt);
  }
  try {
    const r = await c.env.DB.prepare(
      'UPDATE users SET username=?, display_name=?, role=?, active=?, pin_hash=?, pin_salt=? WHERE id=? RETURNING id, username, display_name, role, active, created_at',
    ).bind(username, displayName, role, b?.active !== undefined ? (b.active ? 1 : 0) : cur.active, pinHash, pinSalt, id).first<Record<string, unknown>>();
    if (!r) return notFound(c);
    return ok(c, r);
  } catch (e) {
    if (e instanceof Error && e.message.includes('UNIQUE')) return fail(c, 'ชื่อผู้ใช้ซ้ำ', 409, 'DUPLICATE_USERNAME');
    throw e;
  }
});

admin.delete('/users/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (id === c.get('user').id) return fail(c, 'ไม่สามารถลบบัญชีของตัวเอง', 400);
  const target = await c.env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(id).first<{ role: string }>();
  if (target?.role === 'superadmin') {
    const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'superadmin'").first<{ n: number }>();
    if (Number(count?.n) <= 1) return fail(c, 'ไม่สามารถลบ superadmin คนสุดท้าย', 400);
  }
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  return ok(c, { deleted: id });
});

admin.post('/users/:id/reset-pin', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => null);
  const pin = String(b?.pin || '');
  if (!isValidPin(pin)) return badRequest(c, 'PIN ต้องเป็นตัวเลข 4–6 หลัก');
  const salt = randomSalt();
  const hash = await hashPin(pin, salt);
  await c.env.DB.prepare('UPDATE users SET pin_hash=?, pin_salt=? WHERE id=?').bind(hash, salt, id).run();
  return ok(c, { updated: id });
});

// ── Divisions ──
admin.get('/divisions', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, name, icon, sort_order FROM divisions ORDER BY sort_order, id').all();
  return ok(c, results);
});

admin.post('/divisions', async (c) => {
  const b = await c.req.json().catch(() => null);
  const name = String(b?.name || '').trim();
  if (!name) return badRequest(c, 'กรอกชื่อแผนก');
  try {
    const r = await c.env.DB.prepare('INSERT INTO divisions (name, icon, sort_order) VALUES (?,?,?) RETURNING id, name, icon, sort_order')
      .bind(name, b?.icon || '📦', Number(b?.sort_order) || 0).first<Record<string, unknown>>();
    return ok(c, r, 201);
  } catch (e) {
    if (e instanceof Error && e.message.includes('UNIQUE')) return fail(c, 'ชื่อแผนกซ้ำ', 409, 'DUPLICATE_DIVISION');
    throw e;
  }
});

admin.put('/divisions/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => null);
  const cur = await c.env.DB.prepare('SELECT * FROM divisions WHERE id = ?').bind(id).first();
  if (!cur) return notFound(c);
  const name = String(b?.name ?? cur.name ?? '').trim();
  if (!name) return badRequest(c, 'กรอกชื่อแผนก');
  try {
    const r = await c.env.DB.prepare('UPDATE divisions SET name=?, icon=?, sort_order=? WHERE id=? RETURNING id, name, icon, sort_order')
      .bind(name, b?.icon ?? cur.icon ?? '📦', b?.sort_order !== undefined ? Number(b.sort_order) : cur.sort_order, id).first<Record<string, unknown>>();
    if (!r) return notFound(c);
    return ok(c, r);
  } catch (e) {
    if (e instanceof Error && e.message.includes('UNIQUE')) return fail(c, 'ชื่อแผนกซ้ำ', 409, 'DUPLICATE_DIVISION');
    throw e;
  }
});

admin.delete('/divisions/:id', async (c) => {
  const id = Number(c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM divisions WHERE id = ?').bind(id).run();
  return ok(c, { deleted: id });
});

// ── Settings ──
admin.get('/settings', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT key, value FROM settings').all();
  const map: Record<string, string> = {};
  for (const r of results) map[r.key as string] = (r.value as string) ?? '';
  return ok(c, map);
});

admin.put('/settings', async (c) => {
  const b = await c.req.json().catch(() => null);
  const allowed = [
    'org_name', 'org_subtitle', 'org_address', 'tax_id', 'promptpay_id', 'receipt_footer', 'print_size', 'logo_url',
    'low_stock_threshold', 'reconcile_fee_tolerance', 'terminal_id', 'bank_account_no', 'bank_name',
  ];
  const stmts: D1PreparedStatement[] = [];
  for (const key of allowed) {
    if (b && key in b) {
      stmts.push(
        c.env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, String(b[key])),
      );
    }
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  const { results } = await c.env.DB.prepare('SELECT key, value FROM settings').all();
  const map: Record<string, string> = {};
  for (const r of results) map[r.key as string] = (r.value as string) ?? '';
  return ok(c, map);
});

// ── Admin sales list (all cashiers, filterable) ──
admin.get('/sales', async (c) => {
  const eventId = c.req.query('event_id');
  const cashierId = c.req.query('cashier_id');
  const from = c.req.query('from');
  const to = c.req.query('to');
  const status = c.req.query('status');
  let sql = `SELECT s.id, s.event_id, e.name AS event_name, s.cashier_user_id, u.display_name AS cashier_name,
                    s.subtotal, s.discount, s.total, s.payment_method, s.status, s.client_sale_id, s.created_at,
                    s.tx_hash, s.seq, s.voided_at, s.voided_by, s.void_reason
             FROM sales s JOIN events e ON e.id = s.event_id JOIN users u ON u.id = s.cashier_user_id WHERE 1=1`;
  const args: unknown[] = [];
  if (eventId) { sql += ' AND s.event_id = ?'; args.push(Number(eventId)); }
  if (cashierId) { sql += ' AND s.cashier_user_id = ?'; args.push(Number(cashierId)); }
  if (from) { sql += ' AND date(s.created_at) >= ?'; args.push(from); }
  if (to) { sql += ' AND date(s.created_at) <= ?'; args.push(to); }
  if (status && ['COMPLETED', 'VOID', 'REFUNDED'].includes(status)) { sql += ' AND s.status = ?'; args.push(status); }
  sql += ' ORDER BY s.id DESC LIMIT 500';
  const { results } = await c.env.DB.prepare(sql).bind(...args).all();
  return ok(c, results);
});

// ── Void / refund ──
//
// The non-destructive corrections. Both keep the sale row (and its ledger hash)
// intact, restore stock, and leave an audit trail — unlike the hard delete below.
async function reverseSale(
  c: Parameters<typeof auditStatement>[0],
  id: number,
  nextStatus: 'VOID' | 'REFUNDED',
  reason: string,
  action: string,
) {
  const sale = await c.env.DB.prepare('SELECT * FROM sales WHERE id = ?').bind(id).first();
  if (!sale) return notFound(c);
  if (sale.status !== 'COMPLETED') return fail(c, 'บิลนี้ถูกยกเลิกหรือคืนเงินไปแล้ว', 409, 'NOT_COMPLETED');

  const items = await c.env.DB
    .prepare('SELECT product_id, qty FROM sale_items WHERE sale_id = ?')
    .bind(id)
    .all<{ product_id: number | null; qty: number }>();

  const user = c.get('user');
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `UPDATE sales SET status = ?, voided_at = datetime('now'), voided_by = ?, void_reason = ?
       WHERE id = ? AND status = 'COMPLETED'`,
    ).bind(nextStatus, user.id, reason || null, id),
  ];
  for (const item of items.results) {
    if (item.product_id !== null) {
      // Untracked (NULL stock) products are left alone by the IS NOT NULL guard.
      stmts.push(
        c.env.DB.prepare('UPDATE products SET stock = stock + ? WHERE id = ? AND stock IS NOT NULL').bind(Number(item.qty), item.product_id),
      );
    }
  }
  // A reversed PromptPay sale is no longer expected to settle.
  stmts.push(c.env.DB.prepare('DELETE FROM reconciliation_records WHERE sale_id = ?').bind(id));
  stmts.push(
    auditStatement(c, {
      action,
      entity: 'sales',
      entity_id: id,
      before: { status: sale.status, total: sale.total },
      after: { status: nextStatus },
      reason: reason || null,
    }),
  );

  await c.env.DB.batch(stmts);
  const updated = await c.env.DB.prepare('SELECT * FROM sales WHERE id = ?').bind(id).first();
  return ok(c, updated);
}

admin.post('/sales/:id/void', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return badRequest(c, 'เลขที่การขายไม่ถูกต้อง');
  const b = await c.req.json().catch(() => null);
  return reverseSale(c, id, 'VOID', String(b?.reason || '').slice(0, 300), 'SALE_VOID');
});

admin.post('/sales/:id/refund', requireSuperAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return badRequest(c, 'เลขที่การขายไม่ถูกต้อง');
  const b = await c.req.json().catch(() => null);
  return reverseSale(c, id, 'REFUNDED', String(b?.reason || '').slice(0, 300), 'SALE_REFUND');
});

// ── Audit log ──
admin.get('/audit', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  const entity = c.req.query('entity');
  const actor = Number(c.req.query('actor')) || null;
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 200, 1), 1000);

  const where = ['1=1'];
  const args: unknown[] = [];
  if (from) { where.push('date(a.created_at) >= ?'); args.push(from); }
  if (to) { where.push('date(a.created_at) <= ?'); args.push(to); }
  if (entity) { where.push('a.entity = ?'); args.push(entity); }
  if (actor) { where.push('a.actor_user_id = ?'); args.push(actor); }

  const { results } = await c.env.DB
    .prepare(
      `SELECT a.*, u.display_name AS actor_name FROM audit_log a
       LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT ${limit}`,
    )
    .bind(...args)
    .all();
  return ok(c, results);
});

// ── Delete sales (permanent) — superadmin only ──
// Deletes sale + items and restores stock in a single atomic D1 batch.
async function buildDeleteStatements(db: D1Database, ids: number[]) {
  const stmts: D1PreparedStatement[] = [];
  const placeholders = ids.map(() => '?').join(',');
  const items = await db
    .prepare(`SELECT sale_id, product_id, qty FROM sale_items WHERE sale_id IN (${placeholders})`)
    .bind(...ids)
    .all<{ sale_id: number; product_id: number | null; qty: number }>();
  const productIds = [...new Set(items.results.filter((i) => i.product_id !== null).map((i) => i.product_id as number))];
  const tracked = new Set<number>();
  if (productIds.length) {
    const pph = productIds.map(() => '?').join(',');
    const products = await db.prepare(`SELECT id, stock FROM products WHERE id IN (${pph}) AND stock IS NOT NULL`).bind(...productIds).all<{ id: number; stock: number }>();
    for (const p of products.results) tracked.add(Number(p.id));
  }
  for (const item of items.results) {
    if (item.product_id !== null && tracked.has(item.product_id)) {
      stmts.push(db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').bind(Number(item.qty), item.product_id));
    }
  }
  for (const id of ids) {
    stmts.push(db.prepare('DELETE FROM sale_items WHERE sale_id = ?').bind(id));
    stmts.push(db.prepare('DELETE FROM sales WHERE id = ?').bind(id));
  }
  return stmts;
}

admin.delete('/sales/:id', requireSuperAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return badRequest(c, 'เลขที่การขายไม่ถูกต้อง');
  const sale = await c.env.DB.prepare('SELECT * FROM sales WHERE id = ?').bind(id).first();
  if (!sale) return notFound(c);
  const stmts = await buildDeleteStatements(c.env.DB, [id]);
  // Audit first: once the row is gone this is the only remaining record of it.
  stmts.unshift(auditStatement(c, { action: 'SALE_DELETE', entity: 'sales', entity_id: id, before: sale }));
  await c.env.DB.batch(stmts);
  return ok(c, { deleted: 1 });
});

admin.post('/sales/bulk-delete', requireSuperAdmin, async (c) => {
  const b = await c.req.json().catch(() => null);
  const ids = Array.isArray((b as { ids?: unknown })?.ids)
    ? ((b as { ids: unknown[] }).ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) as number[])
    : [];
  if (ids.length === 0) return badRequest(c, 'ไม่พบรายการที่เลือก');
  if (ids.length > 500) return badRequest(c, 'เลือกลบได้ครั้งละไม่เกิน 500 รายการ');
  const unique = [...new Set(ids)];
  const rows = await c.env.DB.prepare(`SELECT * FROM sales WHERE id IN (${unique.map(() => '?').join(',')})`).bind(...unique).all<{ id: number }>();
  const existing = unique.filter((id) => rows.results.some((r) => r.id === id));
  if (existing.length === 0) return notFound(c);
  const stmts = await buildDeleteStatements(c.env.DB, existing);
  stmts.unshift(auditStatement(c, { action: 'SALE_BULK_DELETE', entity: 'sales', before: rows.results, after: { ids: existing } }));
  await c.env.DB.batch(stmts);
  return ok(c, { deleted: existing.length });
});

export default admin;
