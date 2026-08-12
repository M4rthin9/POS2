import { Hono } from 'hono';
import { requireAuth, requireAdmin } from '../middleware';
import { ok, fail, badRequest, notFound } from '../lib/http';
import { hashPin, randomSalt, isValidPin } from '../lib/password';
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

  for (const s of sales) {
    const total = Number(s.total);
    totalRevenue += total;
    totalDiscount += Number(s.discount);
    paymentBreakdown[s.payment_method as string] = (paymentBreakdown[s.payment_method as string] || 0) + total;
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

admin.post('/events/:id/activate', async (c) => {
  const id = Number(c.req.param('id'));
  const ev = await c.env.DB.prepare('SELECT id FROM events WHERE id = ?').bind(id).first();
  if (!ev) return notFound(c);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE events SET status = 'UPCOMING' WHERE status = 'ACTIVE' AND id != ?").bind(id),
    c.env.DB.prepare("UPDATE events SET status = 'ACTIVE' WHERE id = ?").bind(id),
  ]);
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
  const role = b?.role === 'admin' ? 'admin' : 'cashier';
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
  const role = b?.role ? (b.role === 'admin' ? 'admin' : 'cashier') : cur.role;
  if (!username || !displayName) return badRequest(c, 'กรอกชื่อผู้ใช้และชื่อแสดง');
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
  const allowed = ['org_name', 'org_subtitle', 'org_address', 'tax_id', 'promptpay_id', 'receipt_footer', 'print_size'];
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
  let sql = `SELECT s.id, s.event_id, e.name AS event_name, s.cashier_user_id, u.display_name AS cashier_name,
                    s.subtotal, s.discount, s.total, s.payment_method, s.status, s.client_sale_id, s.created_at
             FROM sales s JOIN events e ON e.id = s.event_id JOIN users u ON u.id = s.cashier_user_id WHERE 1=1`;
  const args: unknown[] = [];
  if (eventId) { sql += ' AND s.event_id = ?'; args.push(Number(eventId)); }
  if (cashierId) { sql += ' AND s.cashier_user_id = ?'; args.push(Number(cashierId)); }
  if (from) { sql += ' AND date(s.created_at) >= ?'; args.push(from); }
  if (to) { sql += ' AND date(s.created_at) <= ?'; args.push(to); }
  sql += ' ORDER BY s.id DESC LIMIT 500';
  const { results } = await c.env.DB.prepare(sql).bind(...args).all();
  return ok(c, results);
});

export default admin;
