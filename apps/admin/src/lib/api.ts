import { apiFetch, parseApi, type ApiEnvelope } from '@cida/shared';
import type {
  AuditLog,
  CidaEvent,
  DashboardPayload,
  Division,
  JournalResponse,
  LoginResponse,
  Overview,
  Product,
  Sale,
  SalesReport,
  Stats,
  ZReport,
} from '@cida/shared';
import { useAuth } from '../store/auth';

export interface AdminProduct extends Product {
  created_at: string;
}

export interface AdminEvent extends CidaEvent {
  created_at: string;
}

export interface AdminUser {
  id: number;
  username: string;
  display_name: string;
  role: 'superadmin' | 'admin' | 'cashier';
  active: number;
  created_at: string;
}

export interface ProductInput {
  sku: string;
  name: string;
  division_id?: number | null;
  price: number;
  image_url?: string | null;
  stock?: number | null;
  active?: boolean;
}

export interface DateScope {
  from?: string;
  to?: string;
  event_id?: number;
}

export interface ChainVerification {
  verified: boolean;
  checked: number;
  broken_at: number | null;
  unsealed: number;
}

/** Serialises a query object, skipping empty values. */
function qs(params?: object): string {
  if (!params) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

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

  overview: () => request<Overview>('/api/admin/overview'),
  stats: (q?: { from?: string; to?: string; event_ids?: number[] }) => {
    const p = new URLSearchParams();
    if (q?.from) p.set('from', q.from);
    if (q?.to) p.set('to', q.to);
    if (q?.event_ids?.length) p.set('event_ids', q.event_ids.join(','));
    const qs = p.toString();
    return request<Stats>(`/api/admin/stats${qs ? `?${qs}` : ''}`);
  },

  products: () => request<AdminProduct[]>('/api/admin/products'),
  createProduct: (input: ProductInput) => request<AdminProduct>('/api/admin/products', { method: 'POST', body: JSON.stringify(input) }),
  updateProduct: (id: number, input: ProductInput) => request<AdminProduct>(`/api/admin/products/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteProduct: (id: number) => request<{ deleted: number }>(`/api/admin/products/${id}`, { method: 'DELETE' }),
  importProducts: (products: ProductInput[]) => request<{ imported: number }>('/api/admin/products/import', { method: 'POST', body: JSON.stringify({ products }) }),

  adminEvents: () => request<AdminEvent[]>('/api/admin/events'),
  createEvent: (input: { code: string; name: string; date?: string | null; location?: string | null; status?: string }) =>
    request<AdminEvent>('/api/admin/events', { method: 'POST', body: JSON.stringify(input) }),
  updateEvent: (id: number, input: Partial<{ code: string; name: string; date: string | null; location: string | null; status: string }>) =>
    request<AdminEvent>(`/api/admin/events/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteEvent: (id: number) => request<{ deleted: number }>(`/api/admin/events/${id}`, { method: 'DELETE' }),
  activateEvent: (id: number) => request<AdminEvent>(`/api/admin/events/${id}/activate`, { method: 'POST' }),
  closeEvent: (id: number) => request<AdminEvent>(`/api/admin/events/${id}/close`, { method: 'POST' }),
  eventProductIds: (id: number) => request<number[]>(`/api/admin/events/${id}/products`),
  setEventProducts: (id: number, productIds: number[]) =>
    request<{ count: number }>(`/api/admin/events/${id}/products`, { method: 'PUT', body: JSON.stringify({ product_ids: productIds }) }),

  adminUsers: () => request<AdminUser[]>('/api/admin/users'),
  createUser: (input: { username: string; display_name: string; role: string; pin: string }) =>
    request<AdminUser>('/api/admin/users', { method: 'POST', body: JSON.stringify(input) }),
  updateUser: (id: number, input: Partial<{ username: string; display_name: string; role: string; active: boolean; pin: string }>) =>
    request<AdminUser>(`/api/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteUser: (id: number) => request<{ deleted: number }>(`/api/admin/users/${id}`, { method: 'DELETE' }),
  resetPin: (id: number, pin: string) => request<{ updated: number }>(`/api/admin/users/${id}/reset-pin`, { method: 'POST', body: JSON.stringify({ pin }) }),

  adminDivisions: () => request<Division[]>('/api/admin/divisions'),
  createDivision: (input: { name: string; icon?: string; sort_order?: number }) =>
    request<Division>('/api/admin/divisions', { method: 'POST', body: JSON.stringify(input) }),
  updateDivision: (id: number, input: Partial<{ name: string; icon: string; sort_order: number }>) =>
    request<Division>(`/api/admin/divisions/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteDivision: (id: number) => request<{ deleted: number }>(`/api/admin/divisions/${id}`, { method: 'DELETE' }),

  adminSettings: () => request<Record<string, string>>('/api/admin/settings'),
  updateAdminSettings: (settings: Record<string, string>) =>
    request<Record<string, string>>('/api/admin/settings', { method: 'PUT', body: JSON.stringify(settings) }),

  adminSales: (q?: { event_id?: number; cashier_id?: number; from?: string; to?: string; status?: string }) =>
    request<Sale[]>(`/api/admin/sales${qs(q)}`),

  sale: (id: number) => request<Sale>(`/api/sales/${id}`),
  deleteSale: (id: number) => request<{ deleted: number }>(`/api/admin/sales/${id}`, { method: 'DELETE' }),
  bulkDeleteSales: (ids: number[]) =>
    request<{ deleted: number }>('/api/admin/sales/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) }),

  // ── Operations dashboard ──
  dashboard: (q?: DateScope) => request<DashboardPayload>(`/api/admin/dashboard${qs(q)}`),

  // ── Ledger / statement ──
  journal: (q?: DateScope & { cashier_id?: number }) => request<JournalResponse>(`/api/admin/journal${qs(q)}`),
  verifyLedger: () => request<ChainVerification>('/api/admin/ledger/verify'),
  rehashLedger: () => request<{ sealed: number; remaining: number }>('/api/admin/ledger/rehash', { method: 'POST' }),

  // ── Void / refund / audit ──
  voidSale: (id: number, reason: string) =>
    request<Sale>(`/api/admin/sales/${id}/void`, { method: 'POST', body: JSON.stringify({ reason }) }),
  refundSale: (id: number, reason: string) =>
    request<Sale>(`/api/admin/sales/${id}/refund`, { method: 'POST', body: JSON.stringify({ reason }) }),
  audit: (q?: { from?: string; to?: string; entity?: string; actor?: number; limit?: number }) =>
    request<AuditLog[]>(`/api/admin/audit${qs(q)}`),

  // ── X / Z report ──
  zreport: (q?: { date?: string; event_id?: number; cashier_id?: number }) => request<ZReport>(`/api/admin/zreport${qs(q)}`),
  closeZReport: (input: { business_date: string; event_id?: number | null; cashier_user_id?: number | null; cash_counted: number | null }) =>
    request<ZReport>('/api/admin/zreport/close', { method: 'POST', body: JSON.stringify(input) }),
  zreportHistory: () => request<ZReport[]>('/api/admin/zreport/history'),

  // ── Formal sales report ──
  salesReport: (q?: DateScope) => request<SalesReport>(`/api/admin/report${qs(q)}`),
};
