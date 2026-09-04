import { Hono } from 'hono';
import type { Context } from 'hono';
import { requireAuth } from '../middleware';
import { ok, fail, badRequest, notFound } from '../lib/http';
import { sealSale } from '../lib/ledger';
import {
  closeZReport,
  computeRange,
  localTime,
  parseCounted,
  readZReport,
  resolveRound,
  todayISO,
  zReportHistory,
} from '../lib/zreport';
import { auditStatement } from '../lib/audit';
import { isValidPin, verifyPin } from '../lib/password';
import { LOGIN_LOCK_MINUTES } from '../env';
import { getLoginState, isLocked, lockMinutesLeft, registerFailure, resetLoginState } from '../lib/lockout';
import { reverseSale } from './admin';
import type { PaymentMethod } from '@cida/shared';
import type { Env, Variables } from '../env';

type Ctx = Context<{ Bindings: Env; Variables: Variables }>;

const pos = new Hono<{ Bindings: Env; Variables: Variables }>();
pos.use('*', requireAuth);

// ── Public settings (receipt header, PromptPay ID) ──
pos.get('/settings/public', async (c) => {
  const rows = await c.env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('org_name','org_subtitle','org_address','tax_id','promptpay_id','receipt_footer','logo_url','print_size')").all();
  const map: Record<string, string> = {};
  for (const r of rows.results) map[r.key as string] = (r.value as string) ?? '';
  return ok(c, {
    org_name: map.org_name || '',
    org_subtitle: map.org_subtitle || '',
    org_address: map.org_address || '',
    tax_id: map.tax_id || '',
    promptpay_id: map.promptpay_id || '',
    receipt_footer: map.receipt_footer || '',
    logo_url: map.logo_url || '',
    print_size: map.print_size || '80mm',
  });
});

// ── Events ──
pos.get('/events', async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, code, name, date, location, status FROM events ORDER BY CASE status WHEN 'ACTIVE' THEN 0 WHEN 'UPCOMING' THEN 1 ELSE 2 END, id DESC",
  ).all();
  return ok(c, results);
});

pos.get('/events/active', async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, code, name, date, location, status FROM events WHERE status = 'ACTIVE' ORDER BY id DESC",
  ).all();
  return ok(c, results);
});

// ── Products for an event ──
pos.get('/events/:id/products', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return badRequest(c, 'invalid id');
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.sku, p.name, p.division_id, d.name AS division_name, p.price, p.image_url, p.stock, p.active
     FROM event_products ep
     JOIN products p ON p.id = ep.product_id
     LEFT JOIN divisions d ON d.id = p.division_id
     WHERE ep.event_id = ? AND p.active = 1
     ORDER BY d.sort_order, p.name`,
  )
    .bind(id)
    .all();
  return ok(c, results);
});

// ── Divisions ──
pos.get('/divisions', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, icon, sort_order FROM divisions ORDER BY sort_order, name',
  ).all();
  return ok(c, results);
});

// ── Sales (cashier sees own, admin sees all) ──
pos.get('/sales', async (c) => {
  const user = c.get('user');
  const eventId = c.req.query('event_id');
  const from = c.req.query('from');
  const to = c.req.query('to');
  // Reporting round, resolved exactly like /shift-report so the listed bills
  // and the printed summary can never disagree about where a round ends.
  const roundDate = c.req.query('date');
  const fromTime = c.req.query('from_time');
  const toTime = c.req.query('to_time');

  let sql = `SELECT s.id, s.event_id, e.name AS event_name, s.cashier_user_id, u.display_name AS cashier_name,
                    s.subtotal, s.discount, s.total, s.payment_method, s.status, s.client_sale_id, s.created_at, s.tx_hash, s.seq
             FROM sales s
             JOIN events e ON e.id = s.event_id
             JOIN users u ON u.id = s.cashier_user_id
             WHERE 1=1`;
  const args: unknown[] = [];
  if (user.role !== 'admin' && user.role !== 'superadmin') {
    sql += ' AND s.cashier_user_id = ?';
    args.push(user.id);
  }
  if (eventId) {
    sql += ' AND s.event_id = ?';
    args.push(Number(eventId));
  }
  if (from) {
    sql += ' AND date(s.created_at) >= ?';
    args.push(from);
  }
  if (to) {
    sql += ' AND date(s.created_at) <= ?';
    args.push(to);
  }
  if (roundDate && fromTime && toTime) {
    const round = resolveRound(roundDate, fromTime, toTime);
    if (!round) return badRequest(c, 'ช่วงเวลาไม่ถูกต้อง');
    sql += ` AND ${localTime('s.')} >= ? AND ${localTime('s.')} < ?`;
    args.push(round.from, round.to);
  }
  sql += ' ORDER BY s.id DESC LIMIT 200';
  const { results } = await c.env.DB.prepare(sql).bind(...args).all();
  return ok(c, results);
});

pos.get('/sales/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const user = c.get('user');
  const sale = await c.env.DB.prepare(
    `SELECT s.id, s.event_id, e.name AS event_name, s.cashier_user_id, u.display_name AS cashier_name,
            s.subtotal, s.discount, s.total, s.payment_method, s.status, s.client_sale_id, s.created_at, s.tx_hash, s.seq
     FROM sales s JOIN events e ON e.id = s.event_id JOIN users u ON u.id = s.cashier_user_id
     WHERE s.id = ?`,
  )
    .bind(id)
    .first();
  if (!sale) return notFound(c);
  if (user.role !== 'admin' && user.role !== 'superadmin' && sale.cashier_user_id !== user.id) return notFound(c);
  return ok(c, await saleDetail(c, id));
});

// ── Create sale (atomic: stock deducted in same D1 batch as sale+items) ──
const saleSelect = `SELECT s.id, s.event_id, e.name AS event_name, s.cashier_user_id, u.display_name AS cashier_name,
       s.subtotal, s.discount, s.total, s.payment_method, s.status, s.client_sale_id, s.created_at, s.tx_hash, s.seq
FROM sales s JOIN events e ON e.id = s.event_id JOIN users u ON u.id = s.cashier_user_id`;

async function saleDetail(c: Ctx, id: number) {
  const sale = await c.env.DB.prepare(`${saleSelect} WHERE s.id = ?`).bind(id).first();
  if (!sale) return null;
  const [items, payments] = await Promise.all([
    c.env.DB.prepare(
      'SELECT id, sale_id, product_id, sku, name, qty, price, line_total FROM sale_items WHERE sale_id = ? ORDER BY id',
    ).bind(id).all(),
    c.env.DB.prepare('SELECT id, sale_id, method, amount, ref FROM sale_payments WHERE sale_id = ? ORDER BY id').bind(id).all(),
  ]);
  return { ...sale, items: items.results, payments: payments.results };
}

pos.post('/sales', async (c) => {
  const body = await c.req.json().catch(() => null);
  const user = c.get('user');
  const eventId = Number(body?.event_id);
  const discount = Math.max(0, Number(body?.discount) || 0);
  let paymentMethod: PaymentMethod = body?.payment_method === 'PromptPay' ? 'PromptPay' : 'Cash';
  const rawItems = Array.isArray(body?.items) ? body.items : [];
  const rawPayments: { method: PaymentMethod; amount: number; ref: string | null }[] = Array.isArray(body?.payments)
    ? body.payments
        .map((p: { method?: unknown; amount?: unknown; ref?: unknown }) => ({
          method: (p?.method === 'PromptPay' ? 'PromptPay' : 'Cash') as PaymentMethod,
          amount: Math.round((Number(p?.amount) || 0) * 100) / 100,
          ref: typeof p?.ref === 'string' ? p.ref.slice(0, 100) : null,
        }))
        .filter((p: { amount: number }) => p.amount > 0)
    : [];
  const clientSaleId = typeof body?.client_sale_id === 'string' && body.client_sale_id.length > 0 && body.client_sale_id.length <= 100 ? body.client_sale_id : null;

  if (!Number.isInteger(eventId) || eventId <= 0) return badRequest(c, 'event_id ไม่ถูกต้อง');
  if (rawItems.length === 0) return badRequest(c, 'ไม่มีรายการสินค้า');

  // Idempotent replay: a queued sale retried after a lost response must not duplicate.
  if (clientSaleId) {
    const existing = await c.env.DB.prepare('SELECT id FROM sales WHERE client_sale_id = ?').bind(clientSaleId).first();
    if (existing) return ok(c, await saleDetail(c, Number(existing.id)));
  }

  const event = await c.env.DB.prepare('SELECT id, name FROM events WHERE id = ?').bind(eventId).first();
  if (!event) return badRequest(c, 'ไม่พบกิจกรรมนี้');

  // Load products server-side (authoritative prices/stock)
  const productIds = [...new Set(rawItems.map((i: { product_id: number }) => Number(i.product_id)))];
  const placeholders = productIds.map(() => '?').join(',');
  const products = await c.env.DB.prepare(`SELECT * FROM products WHERE id IN (${placeholders}) AND active = 1`)
    .bind(...productIds)
    .all();

  const productMap = new Map<number, { id: number; sku: string; name: string; price: number; stock: number | null }>();
  for (const p of products.results) productMap.set(Number(p.id), p as never);

  const items: { product_id: number; sku: string; name: string; qty: number; price: number; line_total: number }[] = [];
  let subtotal = 0;

  for (const raw of rawItems) {
    const productId = Number(raw?.product_id);
    const qty = Number(raw?.qty);
    if (!productMap.has(productId)) return fail(c, `สินค้า id=${productId} ไม่ถูกต้องหรือไม่พบ`, 400, 'PRODUCT_NOT_FOUND');
    if (!Number.isFinite(qty) || qty <= 0 || qty % 1 !== 0) return badRequest(c, 'จำนวนสินค้าไม่ถูกต้อง');
    const p = productMap.get(productId)!;
    if (p.stock !== null && qty > p.stock) return fail(c, `สินค้า "${p.name}" มีไม่เพียงพอ (เหลือ ${p.stock})`, 409, 'INSUFFICIENT_STOCK');
    const lineTotal = Math.round(p.price * qty * 100) / 100;
    items.push({ product_id: p.id, sku: p.sku, name: p.name, qty, price: p.price, line_total: lineTotal });
    subtotal += lineTotal;
  }

  if (discount > subtotal) return badRequest(c, 'ส่วนลดมากกว่ายอดรวม');
  const total = Math.round((subtotal - discount) * 100) / 100;

  // Split bill: the tenders must add up to the total, and the sale's single
  // payment_method column records the largest one so existing reports still work.
  if (rawPayments.length) {
    const paid = Math.round(rawPayments.reduce((a, p) => a + p.amount, 0) * 100) / 100;
    if (paid !== total) return badRequest(c, `ยอดชำระ (${paid}) ไม่เท่ากับยอดบิล (${total})`);
    paymentMethod = rawPayments.reduce((a, p) => (p.amount > a.amount ? p : a)).method;
  }

  // Insert sale first so we know its id.
  let saleId: number;
  try {
    const saleRes = await c.env.DB.prepare(
      `INSERT INTO sales (event_id, cashier_user_id, subtotal, discount, total, payment_method, status, client_sale_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'COMPLETED', ?, datetime('now')) RETURNING id`,
    )
      .bind(eventId, user.id, subtotal, discount, total, paymentMethod, clientSaleId)
      .first();
    saleId = Number((saleRes as { id?: unknown })?.id);
    if (!Number.isInteger(saleId)) return fail(c, 'ไม่สามารถสร้างการขายได้', 500, 'DB_ERROR');
  } catch (e) {
    // Concurrent duplicate replay: the unique index on client_sale_id rejected
    // this insert, so another request already created the sale. Return it.
    if (clientSaleId && e instanceof Error && e.message.includes('UNIQUE')) {
      const existing = await c.env.DB.prepare('SELECT id FROM sales WHERE client_sale_id = ?').bind(clientSaleId).first();
      if (existing) return ok(c, await saleDetail(c, Number(existing.id)));
    }
    return fail(c, 'ไม่สามารถสร้างการขายได้', 500, 'DB_ERROR');
  }

  // Atomic batch for stock + items. If any statement fails the whole batch
  // rolls back, and we compensate by deleting the orphaned sale.
  const stmts: D1PreparedStatement[] = [];
  for (const item of items) {
    const p = productMap.get(item.product_id)!;
    if (p.stock !== null) {
      // CHECK (stock >= 0) makes going negative throw, rolling back the batch.
      stmts.push(c.env.DB.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').bind(item.qty, item.product_id));
    }
  }
  for (const item of items) {
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO sale_items (sale_id, product_id, sku, name, qty, price, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(saleId, item.product_id, item.sku, item.name, item.qty, item.price, item.line_total),
    );
  }
  for (const p of rawPayments) {
    stmts.push(
      c.env.DB.prepare("INSERT INTO sale_payments (sale_id, method, amount, ref, created_at) VALUES (?,?,?,?, datetime('now'))")
        .bind(saleId, p.method, p.amount, p.ref),
    );
  }

  try {
    await c.env.DB.batch(stmts);
  } catch (e) {
    await c.env.DB.prepare('DELETE FROM sales WHERE id = ?').bind(saleId).run();
    const msg = e instanceof Error ? e.message : 'unknown';
    if (msg.includes('CHECK')) return fail(c, 'สินค้าในตะกร้ามีไม่เพียงพอ (สต็อกเปลี่ยนแปลง)', 409, 'INSUFFICIENT_STOCK');
    return fail(c, 'ไม่สามารถบันทึกการขายได้: ' + msg, 500, 'DB_ERROR');
  }

  // Seal onto the append-only ledger. A failure here must not fail the sale —
  // the row stays unsealed and the next /ledger/rehash picks it up.
  try {
    await sealSale(c.env.DB, saleId);
  } catch {
    /* ignore — recoverable via rehash */
  }

  const created = await saleDetail(c, saleId);
  return ok(c, created, 201);
});

// ── Void bill (cashier-initiated, superadmin-approved) ──
//
// The cashier requests a void from the POS. The bill is only reversed after the
// requestor proves a superadmin username + PIN (the approving authority is
// recorded as voided_by / audit actor). Failures share the same KV lockout keys
// as /auth/login so a brute-force attempt also locks the real superadmin login.
async function checkSuperadmin(c: Ctx, username: string, pin: string): Promise<{ id: number }> {
  const state = await getLoginState(c, username);
  if (isLocked(state)) throw { locked: true, mins: lockMinutesLeft(state!) };

  const row = await c.env.DB.prepare(
    'SELECT id, role, active, pin_hash, pin_salt FROM users WHERE username = ?',
  )
    .bind(username)
    .first();

  const valid = row && row.active === 1 && row.role === 'superadmin' && (await verifyPin(pin, row.pin_salt as string, row.pin_hash as string));
  if (!valid) {
    const { locked } = await registerFailure(c, username, state);
    throw { locked, mins: LOGIN_LOCK_MINUTES };
  }

  await resetLoginState(c, username);
  return { id: row.id as number };
}

pos.post('/sales/:id/void', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return badRequest(c, 'เลขที่การขายไม่ถูกต้อง');
  const b = await c.req.json().catch(() => null);
  const username = String(b?.superadmin_username || '').trim();
  const pin = String(b?.superadmin_pin || '');
  const reason = String(b?.reason || '').slice(0, 300);
  if (!username || !isValidPin(pin)) return badRequest(c, 'กรุณากรอกชื่อผู้ใช้และ PIN ของผู้ดูแลระบบ');

  try {
    const approver = await checkSuperadmin(c, username, pin);
    return await reverseSale(c, id, 'VOID', reason, 'SALE_VOID', approver.id);
  } catch (e) {
    const x = e as { locked: boolean; mins?: number; remaining?: number };
    if (x.locked) return fail(c, `ผู้ดูแลระบบถูกล็อกชั่วคราว โปรดรอ ${x.mins} นาที`, 429, 'LOCKED');
    return fail(c, 'ชื่อผู้ใช้หรือ PIN ผู้ดูแลระบบไม่ถูกต้อง', 401, 'BAD_SUPERADMIN');
  }
});

// ── X / Z report (cashier-scoped) ──
//
// Same computation the admin app uses, but a cashier may only ever see and
// close their own figures; any cashier_id in the request is ignored for them.
// Admins keep full scope so a supervisor can close a whole day from the POS.
function zScope(c: Ctx, raw: { date: string; eventId: number | null; cashierId: number | null }) {
  const user = c.get('user');
  const isAdmin = user.role === 'admin' || user.role === 'superadmin';
  return { ...raw, cashierId: isAdmin ? raw.cashierId : user.id };
}

pos.get('/zreport', async (c) => {
  const scope = zScope(c, {
    date: c.req.query('date') || todayISO(),
    eventId: Number(c.req.query('event_id')) || null,
    cashierId: Number(c.req.query('cashier_id')) || null,
  });
  return ok(c, await readZReport(c.env.DB, scope));
});

pos.post('/zreport/close', async (c) => {
  const b = await c.req.json().catch(() => null);
  const scope = zScope(c, {
    date: String(b?.business_date || '').trim() || todayISO(),
    eventId: Number(b?.event_id) || null,
    cashierId: Number(b?.cashier_user_id) || null,
  });
  const counted = parseCounted(b?.cash_counted);
  if (counted === undefined) return badRequest(c, 'จำนวนเงินสดที่นับได้ไม่ถูกต้อง');

  const result = await closeZReport(c.env.DB, scope, counted, c.get('user').id);
  if (!result.ok) return fail(c, 'วันนี้ปิดยอดไปแล้ว', 409, 'ALREADY_CLOSED');

  await auditStatement(c, {
    action: 'ZREPORT_CLOSE',
    entity: 'z_reports',
    entity_id: Number(result.row?.id),
    after: {
      date: scope.date,
      event_id: scope.eventId,
      cashier_user_id: scope.cashierId,
      ...result.figures,
      cash_counted: counted,
      variance: result.variance,
    },
  }).run();

  return ok(c, result.row, 201);
});

// ── Reporting round (cashier hand-over) ──
//
// The cashier reports at 10:00 and again at 14:00, then hands in a combined
// sheet for the whole day. All three are the same query over a different
// shop-local window, scoped like the Z-report: a cashier only ever sees their
// own takings.
pos.get('/shift-report', async (c) => {
  const date = String(c.req.query('date') || '').trim() || todayISO();
  const round = resolveRound(date, c.req.query('from_time') || '00:00', c.req.query('to_time') || '00:00');
  if (!round) return badRequest(c, 'ช่วงเวลาไม่ถูกต้อง');

  const scope = zScope(c, {
    date,
    eventId: Number(c.req.query('event_id')) || null,
    cashierId: Number(c.req.query('cashier_id')) || null,
  });
  const figures = await computeRange(c.env.DB, round.from, round.to, scope.eventId, scope.cashierId);

  const [event, cashier] = await Promise.all([
    scope.eventId
      ? c.env.DB.prepare('SELECT name FROM events WHERE id = ?').bind(scope.eventId).first<{ name: string }>()
      : null,
    scope.cashierId
      ? c.env.DB.prepare('SELECT display_name FROM users WHERE id = ?').bind(scope.cashierId).first<{ display_name: string }>()
      : null,
  ]);

  return ok(c, {
    business_date: date,
    from: round.from,
    to: round.to,
    event_id: scope.eventId,
    event_name: event?.name ?? null,
    cashier_user_id: scope.cashierId,
    cashier_name: cashier?.display_name ?? null,
    ...figures,
  });
});

pos.get('/zreport/history', async (c) => {
  const user = c.get('user');
  const isAdmin = user.role === 'admin' || user.role === 'superadmin';
  return ok(c, await zReportHistory(c.env.DB, isAdmin ? null : user.id));
});

export default pos;
