// ── Client-side API helper ──
// Resolves API base URL: VITE_API_URL (build-time) > user override (localStorage) > default.
// Hosts are tried in order; a blocked/unreachable host is skipped and the working
// one is remembered. The custom domain is primary because ad blockers commonly
// block `*.workers.dev` (ERR_BLOCKED_BY_CLIENT).

export const PROD_API_URLS = [
  'https://api.cidapos.dpdns.org',
  'https://cida-pos-api.pongsinbas.workers.dev',
];
export const PROD_API_URL = PROD_API_URLS[0];
const DEV_API_URL = 'http://localhost:8787';

// NOTE: Vite statically replaces `import.meta.env.PROD` and friends at build
// time, which is what dead-code-eliminates the DEV branch below. The dynamic
// lookup in `envVar` only works because Vite also emits the whole
// `import.meta.env` object — so a typo'd key is a silent undefined, not an error.

function envVar(key: string): string | undefined {
  const v = import.meta.env[key];
  return typeof v === 'string' ? v : undefined;
}

export function resolveApiBase(): string {
  const v = envVar('VITE_API_URL');
  if (v) return v.replace(/\/+$/, '');
  try {
    const saved = localStorage.getItem('cida_api_base');
    if (saved) return saved.replace(/\/+$/, '');
  } catch {
    /* ignore */
  }
  return import.meta.env.PROD ? PROD_API_URL : DEV_API_URL;
}

export function setApiBase(url: string) {
  try {
    localStorage.setItem('cida_api_base', url.replace(/\/+$/, ''));
  } catch {
    /* ignore */
  }
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  // Failover exists because ad blockers kill *.workers.dev, so the very first
  // request (a POST /auth/login) still has to be able to find a live host.
  // Once any request has succeeded the reachable base is known, and from then
  // on writes are single-shot: a network error on a write does not mean the
  // server did not process it, and replaying a /void or /refresh on another
  // host would duplicate it (a duplicated refresh signs the cashier out
  // mid-shift). Sales carry client_sale_id, so only they are safe to replay.
  const method = (init?.method || 'GET').toUpperCase();
  const mayFailover = method === 'GET' || !baseConfirmed;
  const bases = mayFailover ? apiBases() : [resolveApiBase()];
  let lastErr: unknown;
  for (let i = 0; i < bases.length; i++) {
    const base = bases[i];
    try {
      const res = await fetch(base + path, init);
      if (res.type === 'error') throw new Error(`blocked: ${base}`);
      if (i > 0) setApiBase(base);
      baseConfirmed = true;
      return res;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('API unreachable');
}

/** Set once a host has answered, which pins writes to that host thereafter. */
let baseConfirmed = false;

function apiBases(): string[] {
  const list = [resolveApiBase()];
  const backups = import.meta.env.PROD ? PROD_API_URLS : [DEV_API_URL];
  for (const u of backups) if (!list.includes(u)) list.push(u);
  return list;
}

export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export async function parseApi<T>(res: Response): Promise<ApiEnvelope<T>> {
  try {
    const body = (await res.json()) as ApiEnvelope<T>;
    if (!res.ok) {
      const err = new Error(body?.error || `HTTP ${res.status}`);
      (err as Error & { code?: string }).code = body?.code;
      throw err;
    }
    return body;
  } catch (e) {
    if (e instanceof SyntaxError) throw new Error(`HTTP ${res.status}`);
    throw e;
  }
}
