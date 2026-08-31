import { zReportHash } from '@cida/shared';

// ── X / Z report computation ──
//
// Scoped to (business day × event × cashier). There is no shift table and no
// opening float, so cash_expected is derived purely from cash-tender sales.
// Shared by the admin routes (`routes/ledger.ts`, any scope) and the POS routes
// (`routes/pos.ts`, forced to the caller's own cashier id).

export interface ZFigures {
  gross: number;
  discount: number;
  net: number;
  cash_expected: number;
  promptpay_total: number;
  sale_count: number;
  void_count: number;
  refund_count: number;
}

export interface ZScope {
  date: string;
  eventId: number | null;
  cashierId: number | null;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function computeZ(db: D1Database, date: string, eventId: number | null, cashierId: number | null): Promise<ZFigures> {
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

const closedSelect = `SELECT z.*, u.display_name AS closer_name, e.name AS event_name, cu.display_name AS cashier_name
   FROM z_reports z
   LEFT JOIN users u ON u.id = z.closed_by
   LEFT JOIN users cu ON cu.id = z.cashier_user_id
   LEFT JOIN events e ON e.id = z.event_id`;

/** X-report: read-only snapshot, never persisted, safe to run any number of times. */
export async function readZReport(db: D1Database, { date, eventId, cashierId }: ZScope) {
  const figures = await computeZ(db, date, eventId, cashierId);

  const closed = await db
    .prepare(`${closedSelect} WHERE z.business_date = ? AND COALESCE(z.event_id,0) = ? AND COALESCE(z.cashier_user_id,0) = ?`)
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

  return {
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
    closer_name: closed ? ((closed.closer_name as string) ?? null) : null,
    cashier_name: closed ? ((closed.cashier_name as string) ?? null) : null,
    event_name: closed ? ((closed.event_name as string) ?? null) : null,
  };
}

export type CloseResult =
  | { ok: false; code: 'ALREADY_CLOSED' }
  | { ok: true; row: Record<string, unknown> | null; figures: ZFigures; variance: number | null };

/** Z-report: closes the day and locks the figures. Caller writes the audit row. */
export async function closeZReport(
  db: D1Database,
  scope: ZScope,
  counted: number | null,
  actorUserId: number,
): Promise<CloseResult> {
  const { date, eventId, cashierId } = scope;

  const existing = await db
    .prepare('SELECT id FROM z_reports WHERE business_date = ? AND COALESCE(event_id,0) = ? AND COALESCE(cashier_user_id,0) = ?')
    .bind(date, eventId ?? 0, cashierId ?? 0)
    .first();
  if (existing) return { ok: false, code: 'ALREADY_CLOSED' };

  const f = await computeZ(db, date, eventId, cashierId);
  const variance = counted === null ? null : round(counted - f.cash_expected);
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
    closed_by: actorUserId,
  });

  const row = await db
    .prepare(
      `INSERT INTO z_reports (business_date, event_id, cashier_user_id, gross, discount, net, cash_expected,
                              cash_counted, variance, promptpay_total, sale_count, void_count, refund_count,
                              closed_by, closed_at, report_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'), ?) RETURNING *`,
    )
    .bind(date, eventId, cashierId, f.gross, f.discount, f.net, f.cash_expected, counted, variance,
      f.promptpay_total, f.sale_count, f.void_count, f.refund_count, actorUserId, hash)
    .first<Record<string, unknown>>();

  return { ok: true, row, figures: f, variance };
}

/** Recent closes. `cashierId` restricts the list to one cashier's own closes. */
export async function zReportHistory(db: D1Database, cashierId?: number | null) {
  const where = cashierId ? ' WHERE z.cashier_user_id = ?' : '';
  const stmt = db.prepare(`${closedSelect}${where} ORDER BY z.business_date DESC, z.id DESC LIMIT 100`);
  const { results } = await (cashierId ? stmt.bind(cashierId) : stmt).all();
  return results;
}

/** Parses `cash_counted` from a request body. `undefined` means "not a number". */
export function parseCounted(v: unknown): number | null | undefined {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
