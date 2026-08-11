import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export function ok<T>(c: Context, data: T, status: ContentfulStatusCode = 200) {
  return c.json({ ok: true, data }, status);
}

export function fail(c: Context, message: string, status: ContentfulStatusCode = 400, code?: string) {
  return c.json({ ok: false, error: message, code }, status);
}

export function badRequest(c: Context, message: string) {
  return fail(c, message, 400);
}

export function unauthorized(c: Context, message = 'Unauthorized') {
  return fail(c, message, 401, 'UNAUTHORIZED');
}

export function notFound(c: Context, message = 'Not found') {
  return fail(c, message, 404);
}
