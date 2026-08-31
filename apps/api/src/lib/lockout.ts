import type { Context } from 'hono';
import { LOGIN_LOCK_MINUTES, LOGIN_MAX_FAILURES } from '../env';
import type { Env, Variables } from '../env';

type Ctx = Context<{ Bindings: Env; Variables: Variables }>;

export interface LoginState {
  count: number;
  locked_until: number;
}

/**
 * Failure counters are keyed on (username, source IP). Keying on the username
 * alone let anyone lock the real `admin` out for 15 minutes with five wrong
 * PINs from anywhere — a free denial of service against the shop.
 */
function loginKey(c: Ctx, username: string): string {
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
  return `login:${username}:${ip}`;
}

export async function getLoginState(c: Ctx, username: string): Promise<LoginState | null> {
  const raw = await c.env.CACHE.get(loginKey(c, username));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LoginState;
  } catch {
    return null;
  }
}

export function isLocked(state: LoginState | null): boolean {
  return !!state && state.locked_until > Date.now();
}

export function lockMinutesLeft(state: LoginState): number {
  return Math.max(1, Math.ceil((state.locked_until - Date.now()) / 60000));
}

/** Records a failed attempt. Returns whether the caller is now locked out. */
export async function registerFailure(c: Ctx, username: string, state: LoginState | null): Promise<{ locked: boolean }> {
  const count = (state?.count || 0) + 1;
  const locked = count >= LOGIN_MAX_FAILURES;
  const locked_until = locked ? Date.now() + LOGIN_LOCK_MINUTES * 60 * 1000 : 0;
  await c.env.CACHE.put(loginKey(c, username), JSON.stringify({ count, locked_until } satisfies LoginState), {
    expirationTtl: LOGIN_LOCK_MINUTES * 60,
  });
  return { locked };
}

export async function resetLoginState(c: Ctx, username: string): Promise<void> {
  await c.env.CACHE.delete(loginKey(c, username));
}
