import { Hono } from 'hono';
import type { Context } from 'hono';
import { verifyPin, hashPin, randomSalt, isValidPin } from '../lib/password';
import { signAccessToken, signRefreshToken, verifyToken, sha256hex } from '../lib/jwt';
import { ok, fail, badRequest, unauthorized } from '../lib/http';
import { ACCESS_TTL, REFRESH_TTL, LOGIN_LOCK_MINUTES } from '../env';
import { getLoginState, isLocked, lockMinutesLeft, registerFailure, resetLoginState } from '../lib/lockout';
import { requireAuth } from '../middleware';
import type { Env, Variables } from '../env';

const auth = new Hono<{ Bindings: Env; Variables: Variables }>();

auth.post('/login', async (c) => {
  const body = await c.req.json().catch(() => null);
  const username = String(body?.username || '').trim();
  const pin = String(body?.pin || '');
  if (!username || !isValidPin(pin)) return badRequest(c, 'กรุณากรอกชื่อผู้ใช้และ PIN');

  const state = await getLoginState(c, username);
  if (isLocked(state)) {
    return fail(c, `ล็อกชั่วคราว โปรดรอ ${lockMinutesLeft(state!)} นาที`, 429, 'LOCKED');
  }

  const row = await c.env.DB.prepare(
    'SELECT id, username, display_name, role, active, pin_hash, pin_salt FROM users WHERE username = ?',
  )
    .bind(username)
    .first();

  const valid = row && row.active === 1 && (await verifyPin(pin, row.pin_salt as string, row.pin_hash as string));
  if (!valid) {
    // The message never reveals whether the username exists or how many tries
    // are left — both are free intelligence for someone guessing PINs.
    const { locked } = await registerFailure(c, username, state);
    if (locked) return fail(c, `กรอกผิดหลายครั้ง ล็อก ${LOGIN_LOCK_MINUTES} นาที`, 429, 'LOCKED');
    return fail(c, 'ชื่อผู้ใช้หรือ PIN ไม่ถูกต้อง', 401, 'BAD_CREDENTIALS');
  }

  await resetLoginState(c, username);
  const user = { id: row.id as number, username: username, display_name: row.display_name as string, role: row.role as 'superadmin' | 'admin' | 'cashier' };
  const secret = c.env.JWT_SECRET as string;
  const access_token = await signAccessToken(user, secret, ACCESS_TTL);
  const jti = crypto.randomUUID();
  const refresh_token = await signRefreshToken(user, secret, REFRESH_TTL, jti);
  await c.env.CACHE.put(`rt:${await sha256hex(refresh_token)}`, String(user.id), { expirationTtl: REFRESH_TTL });

  return ok(c, { access_token, refresh_token, user });
});

auth.post('/refresh', async (c) => {
  const body = await c.req.json().catch(() => null);
  const refresh_token = String(body?.refresh_token || '');
  if (!refresh_token) return unauthorized(c);
  try {
    const secret = c.env.JWT_SECRET as string;
    const payload = await verifyToken(refresh_token, secret);
    const hash = await sha256hex(refresh_token);
    const storedUserId = await c.env.CACHE.get(`rt:${hash}`);
    if (storedUserId !== String(payload.userId)) return unauthorized(c);

    const row = await c.env.DB.prepare('SELECT id, username, display_name, role FROM users WHERE id = ? AND active = 1')
      .bind(payload.userId)
      .first();
    if (!row) return unauthorized(c);

    await c.env.CACHE.delete(`rt:${hash}`);
    const user = { id: row.id as number, username: row.username as string, display_name: row.display_name as string, role: row.role as 'superadmin' | 'admin' | 'cashier' };
    const access_token = await signAccessToken(user, secret, ACCESS_TTL);
    const jti = crypto.randomUUID();
    const newRefresh = await signRefreshToken(user, secret, REFRESH_TTL, jti);
    await c.env.CACHE.put(`rt:${await sha256hex(newRefresh)}`, String(user.id), { expirationTtl: REFRESH_TTL });
    return ok(c, { access_token, refresh_token: newRefresh, user });
  } catch {
    return unauthorized(c, 'Invalid refresh token');
  }
});

auth.post('/logout', async (c) => {
  const body = await c.req.json().catch(() => null);
  const refresh_token = String(body?.refresh_token || '');
  if (refresh_token) {
    await c.env.CACHE.delete(`rt:${await sha256hex(refresh_token)}`);
  }
  return ok(c, null);
});

auth.get('/me', requireAuth, async (c) => {
  return ok(c, c.get('user'));
});

export default auth;

