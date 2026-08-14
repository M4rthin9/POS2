// ── Typed API client for the POS app ──

import { apiFetch, parseApi, resolveApiBase, setApiBase, type ApiEnvelope } from '@cida/shared';
import type { CidaEvent, Division, LoginResponse, Product, PublicSettings, Sale, SaleCreateInput, SaleVoidInput, User } from '@cida/shared';
import { useAuth } from '../store/auth';

export { resolveApiBase, setApiBase };

async function request<T>(path: string, init?: RequestInit, retry = true): Promise<T> {
  const auth = useAuth.getState();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth.accessToken) headers.Authorization = `Bearer ${auth.accessToken}`;

  let res = await apiFetch(path, { ...init, headers });

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

  mySales: () => request<Sale[]>('/api/sales'),

  voidSale: (id: number, input: SaleVoidInput) =>
    request<Sale>(`/api/sales/${id}/void`, { method: 'POST', body: JSON.stringify(input) }),

  updateSettings: (settings: PublicSettings) =>
    request<Record<string, string>>('/api/admin/settings', { method: 'PUT', body: JSON.stringify(settings) }),
};

export interface QueuedSale {
  id: string;
  payload: SaleCreateInput;
  created_at: string;
  user_id?: number;
}

const QUEUE_KEY = 'cida_pos_offline_queue';

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
  localStorage.setItem(QUEUE_KEY, JSON.stringify(getQueue().filter((q) => q.id !== id)));
}

export async function syncQueue(): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  for (const entry of getQueue()) {
    try {
      await api.createSale({ ...entry.payload, client_sale_id: entry.id });
      removeFromQueue(entry.id);
      ok++;
    } catch {
      failed++;
    }
  }
  return { ok, failed };
}
