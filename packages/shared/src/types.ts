export type Role = 'admin' | 'cashier';
export type EventStatus = 'ACTIVE' | 'UPCOMING' | 'CLOSED';
export type PaymentMethod = 'Cash' | 'PromptPay';
export type SaleStatus = 'COMPLETED' | 'REFUNDED' | 'VOID';

export interface User {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  active: boolean;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  user: User;
}

export interface CidaEvent {
  id: number;
  code: string;
  name: string;
  date: string | null;
  location: string | null;
  status: EventStatus;
}

export interface Division {
  id: number;
  name: string;
  icon: string;
  sort_order: number;
}

export interface Product {
  id: number;
  sku: string;
  name: string;
  division_id: number | null;
  division_name: string | null;
  price: number;
  image_url: string | null;
  stock: number | null;
  active: boolean;
}

export interface CartItem {
  product_id: number;
  sku: string;
  name: string;
  price: number;
  qty: number;
}

export interface SaleItem {
  id: number;
  sale_id: number;
  product_id: number | null;
  sku: string;
  name: string;
  qty: number;
  price: number;
  line_total: number;
}

export interface Sale {
  id: number;
  event_id: number;
  event_name: string | null;
  cashier_user_id: number;
  cashier_name: string | null;
  subtotal: number;
  discount: number;
  total: number;
  payment_method: PaymentMethod;
  status: SaleStatus;
  created_at: string;
  items: SaleItem[];
}

export interface PublicSettings {
  org_name: string;
  org_subtitle: string;
  org_address: string;
  tax_id: string;
  promptpay_id: string;
  receipt_footer: string;
}

export interface Overview {
  total_products: number;
  total_users: number;
  total_events: number;
  total_divisions: number;
  total_sales: number;
  total_revenue: number;
  today_sales: number;
  today_revenue: number;
  today_discount: number;
  active_event: string | null;
  active_event_id: number | null;
  active_events: { id: number; name: string; date: string | null }[];
}

export interface Stats {
  total_revenue: number;
  total_discount: number;
  total_sales: number;
  avg_per_sale: number;
  payment_breakdown: Record<string, number>;
  division_breakdown: Record<string, number>;
  product_breakdown: Record<string, { qty: number; revenue: number }>;
  daily: Record<string, number>;
}

export interface Settings {
  org_name: string;
  org_subtitle: string;
  org_address: string;
  tax_id: string;
  promptpay_id: string;
  receipt_footer: string;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export const DEFAULT_PROMPTPAY_ID = '010753700088205';
