import type { Context } from 'hono';
import type { Env, Variables } from '../env';

type Ctx = Context<{ Bindings: Env; Variables: Variables }>;

export interface AuditEntry {
  action: string;
  entity: string;
  entity_id?: number | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

function json(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
}

/** Prepared statement form, so an audit row can join a batch with the change it records. */
export function auditStatement(c: Ctx, e: AuditEntry, actorId?: number): D1PreparedStatement {
  const actor = actorId ?? c.get('user')?.id ?? null;
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || null;
  return c.env.DB.prepare(
    `INSERT INTO audit_log (actor_user_id, action, entity, entity_id, before_json, after_json, reason, ip, created_at)
     VALUES (?,?,?,?,?,?,?,?, datetime('now'))`,
  ).bind(actor, e.action, e.entity, e.entity_id ?? null, json(e.before), json(e.after), e.reason ?? null, ip);
}

/** Fire-and-forget form for paths that have nothing to batch with. */
export async function writeAudit(c: Ctx, e: AuditEntry): Promise<void> {
  await auditStatement(c, e).run();
}
