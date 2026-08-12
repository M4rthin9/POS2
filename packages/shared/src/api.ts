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

// NOTE: `import.meta.env` must be accessed literally — Vite statically replaces
// it at build time (dead-code-eliminates the DEV branch in prod). Reading it
// through a variable leaves a runtime check that fails on Cloudflare Pages.

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
  const bases = apiBases();
  let lastErr: unknown;
  for (let i = 0; i < bases.length; i++) {
    const base = bases[i];
    try {
      const res = await fetch(base + path, init);
      if (res.type === 'error') throw new Error(`blocked: ${base}`);
      if (i > 0) setApiBase(base);
      return res;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('API unreachable');
}

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
