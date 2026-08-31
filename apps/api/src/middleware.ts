import type { Context, Next } from 'hono';
import { verifyToken } from './lib/jwt';
import type { AuthUser, Env, Variables } from './env';
import { fail, unauthorized } from './lib/http';

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

export async function requireAuth(c: AppContext, next: Next) {
  const header = c.req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return unauthorized(c);
  const secret = c.env.JWT_SECRET as string;
  // A missing secret is a deploy fault, not a bad token — fail loudly rather
  // than telling every user their session expired.
  if (!secret || secret.length < 32) {
    return fail(c, 'Server misconfigured: JWT_SECRET is not set', 500, 'NO_JWT_SECRET');
  }
  try {
    const payload = await verifyToken(token, secret);
    const row = await c.env.DB.prepare(
      'SELECT id, username, display_name, role, active FROM users WHERE id = ?',
    )
      .bind(payload.userId)
      .first();
    if (!row || row.active !== 1) return unauthorized(c);
    c.set('user', {
      id: row.id as number,
      username: row.username as string,
      display_name: row.display_name as string,
      role: row.role as 'superadmin' | 'admin' | 'cashier',
    } satisfies AuthUser);
    await next();
  } catch {
    return unauthorized(c, 'Invalid or expired token');
  }
}

export async function requireAdmin(c: AppContext, next: Next) {
  const user = c.get('user');
  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) return unauthorized(c, 'Admin access required');
  await next();
}

export async function requireSuperAdmin(c: AppContext, next: Next) {
  const user = c.get('user');
  if (!user || user.role !== 'superadmin') return unauthorized(c, 'Superadmin access required');
  await next();
}
