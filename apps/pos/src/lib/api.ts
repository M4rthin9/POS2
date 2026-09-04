// ── Typed API client for the POS app ──

import { apiFetch, parseApi, resolveApiBase, setApiBase, type ApiEnvelope } from '@cida/shared';
import type { CidaEvent, Division, LoginResponse, Product, PublicSettings, Sale, SaleCreateInput, SaleVoidInput, ShiftReport, ZReport } from '@cida/shared';
import { useAuth } from '../store/auth';

export { resolveApiBase, setApiBase };

/** One hand-over round: a business date plus shop-local `HH:MM` bounds. */
export interface ReportRound {
  date: string;
  from_time: string;
  to_time: string;
  event_id?: number | null;
}

async function request<T>(path: string, init?: RequestInit, retry = true): Promise<T> {
  const auth = useAuth.getState();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init?.headers as Record<string, string>) || {}),
  };
  if (auth.accessToken) headers.Authorization = `Bearer ${auth.accessToken}`;

  const res = await apiFetch(path, { ...init, headers });

  if (res.status === 401 && retry && auth.refreshToken) {
    const refreshed = await refreshTokens();
    if (refreshed) return request<T>(path, init, false);
    useAuth.getState().clear();
    throw new Error('unauthorized');
  }

  const body = (await parseApi<T>(res)) as ApiEnvelope<T>;
  if (!body.ok) throw new Error(body.error || 'API error');
  return body.data as T;
}

let refreshing: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const auth = useAuth.getState();
    if (!auth.refreshToken) return false;
    try {
      const res = await apiFetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: auth.refreshToken }),
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { ok: boolean; data: LoginResponse };
      if (!body.ok) return false;
      useAuth.getState().setTokens(body.data.access_token, body.data.refresh_token, body.data.user);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export const api = {
  login: (username: string, pin: string) =>
    request<LoginResponse>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, pin }) }),
  logout: () =>
    request<void>('/api/auth/logout', { method: 'POST', body: JSON.stringify({ refresh_token: useAuth.getState().refreshToken }) }).catch(() => undefined),

  publicSettings: () => request<PublicSettings>('/api/settings/public'),
  events: () => request<CidaEvent[]>('/api/events'),
  activeEvents: () => request<CidaEvent[]>('/api/events/active'),
  divisions: () => request<Division[]>('/api/divisions'),
  eventProducts: (eventId: number) => request<Product[]>(`/api/events/${eventId}/products`),

  createSale: (input: SaleCreateInput) => request<Sale>('/api/sales', { method: 'POST', body: JSON.stringify(input) }),

  /** Without a round the server returns the cashier's most recent bills. */
  mySales: (round?: ReportRound) => request<Sale[]>(`/api/sales${qs(round)}`),

  shiftReport: (round: ReportRound) => request<ShiftReport>(`/api/shift-report${qs(round)}`),

  voidSale: (id: number, input: SaleVoidInput) =>
    request<Sale>(`/api/sales/${id}/void`, { method: 'POST', body: JSON.stringify(input) }),

  updateSettings: (settings: PublicSettings) =>
    request<Record<string, string>>('/api/admin/settings', { method: 'PUT', body: JSON.stringify(settings) }),

  // ── X / Z report. The API scopes a cashier to their own figures. ──
  zreport: (q?: { date?: string; event_id?: number | null }) => request<ZReport>(`/api/zreport${qs(q)}`),
  closeZReport: (input: { business_date: string; event_id?: number | null; cash_counted: number | null }) =>
    request<ZReport>('/api/zreport/close', { method: 'POST', body: JSON.stringify(input) }),
  zreportHistory: () => request<ZReport[]>('/api/zreport/history'),
};

function qs(params?: object): string {
  if (!params) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export interface QueuedSale {
  id: string;
  payload: SaleCreateInput;
  created_at: string;
  user_id?: number;
  /** Failed sync passes. Entries are parked once this reaches MAX_SYNC_ATTEMPTS. */
  attempts?: number;
  last_error?: string;
  /** Set when the entry has been given up on; kept for the cashier to inspect. */
  parked?: boolean;
}

const QUEUE_KEY = 'cida_pos_offline_queue';

/**
 * A sale the server keeps rejecting (deleted product, closed event, no stock)
 * would otherwise be re-POSTed on every sync pass forever. After this many
 * passes the entry is parked: kept in storage so nothing is silently lost, but
 * no longer retried.
 */
export const MAX_SYNC_ATTEMPTS = 5;

export function getQueue(): QueuedSale[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function addToQueue(payload: QueuedSale['payload']): QueuedSale {
  const q = getQueue();
  const entry: QueuedSale = { id: crypto.randomUUID(), payload, created_at: new Date().toISOString(), user_id: useAuth.getState().user?.id };
  q.push(entry);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  return entry;
}

export function removeFromQueue(id: string) {
  saveQueue(getQueue().filter((q) => q.id !== id));
}

function saveQueue(q: QueuedSale[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

/** Entries still waiting to sync (parked ones are excluded). */
export function pendingQueue(): QueuedSale[] {
  return getQueue().filter((q) => !q.parked);
}

export function parkedQueue(): QueuedSale[] {
  return getQueue().filter((q) => q.parked);
}

export function clearParked() {
  saveQueue(getQueue().filter((q) => !q.parked));
}

export async function syncQueue(): Promise<{ ok: number; failed: number; parked: number }> {
  let ok = 0;
  let failed = 0;
  for (const entry of pendingQueue()) {
    try {
      await api.createSale({ ...entry.payload, client_sale_id: entry.id });
      removeFromQueue(entry.id);
      ok++;
    } catch (e) {
      const attempts = (entry.attempts || 0) + 1;
      const message = e instanceof Error ? e.message : String(e);
      saveQueue(
        getQueue().map((q) =>
          q.id === entry.id ? { ...q, attempts, last_error: message, parked: attempts >= MAX_SYNC_ATTEMPTS } : q,
        ),
      );
      failed++;
    }
  }
  return { ok, failed, parked: parkedQueue().length };
}
