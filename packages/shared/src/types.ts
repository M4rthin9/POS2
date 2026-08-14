export type Role = 'superadmin' | 'admin' | 'cashier';
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

export interface SalePayment {
  id: number;
  sale_id: number;
  method: PaymentMethod;
  amount: number;
  ref: string | null;
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
  client_sale_id: string | null;
  created_at: string;
  items: SaleItem[];
  payments?: SalePayment[];
  /** Ledger chain (null for rows created before the chain existed and not yet backfilled). */
  tx_hash?: string | null;
  prev_hash?: string | null;
  seq?: number | null;
  voided_at?: string | null;
  voided_by?: number | null;
  void_reason?: string | null;
}

export interface SaleCreateInput {
  event_id: number;
  items: { product_id: number; qty: number }[];
  discount: number;
  payment_method: PaymentMethod;
  client_sale_id?: string;
  /** Split bill. When present the amounts must sum to the sale total. */
  payments?: { method: PaymentMethod; amount: number; ref?: string }[];
}

/** POS cashier-initiated void. Requires the approving superadmin's credentials. */
export interface SaleVoidInput {
  superadmin_username: string;
  superadmin_pin: string;
  reason?: string;
}

export interface PublicSettings {
  org_name: string;
  org_subtitle: string;
  org_address: string;
  tax_id: string;
  promptpay_id: string;
  receipt_footer: string;
  logo_url: string;
  print_size: string;
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
  logo_url: string;
  print_size: string;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export const DEFAULT_PROMPTPAY_ID = '010753700088205';

// ── Ledger, statement & reconciliation ──

export type LedgerDirection = 'CREDIT' | 'DEBIT';
export type ReconcileStatus = 'MATCHED' | 'PARTIAL' | 'FLAGGED' | 'UNMATCHED';
export type ReconcileMethod = 'AUTO' | 'MANUAL';

/** One row of the printable bank-statement-format ledger. */
export interface POSJournalEntry {
  sale_id: number;
  seq: number | null;
  posted_at: string;
  event_id: number;
  event_name: string | null;
  cashier_user_id: number;
  cashier_name: string | null;
  payment_method: PaymentMethod;
  direction: LedgerDirection;
  amount: number;
  subtotal: number;
  discount: number;
  running_balance: number;
  status: SaleStatus;
  tx_hash: string | null;
  prev_hash: string | null;
  bank_ref: string | null;
  reconcile_status: ReconcileStatus;
}

export interface JournalResponse {
  opening_balance: number;
  closing_balance: number;
  entries: POSJournalEntry[];
  totals: { credit: number; debit: number; discount: number; count: number };
  chain: { verified: boolean; checked: number; broken_at: number | null; unsealed: number };
}

// ── Formal sales report (government reporting format) ──

export interface ReportBucket {
  gross: number;
  discount: number;
  net: number;
  cash: number;
  promptpay: number;
  count: number;
  item_qty: number;
}

export interface ReportSaleItem {
  sku: string;
  name: string;
  division_name: string;
  qty: number;
  price: number;
  line_total: number;
}

export interface ReportSale {
  id: number;
  created_at: string;
  cashier_user_id: number;
  cashier_name: string | null;
  payment_method: PaymentMethod;
  tenders: { method: string; amount: number; ref: string | null }[];
  subtotal: number;
  discount: number;
  total: number;
  item_qty: number;
  tx_hash: string | null;
  items: ReportSaleItem[];
}

export interface ReportEvent {
  id: number;
  code: string;
  name: string;
  date: string | null;
  location: string | null;
  status: EventStatus;
  sales: ReportSale[];
  totals: ReportBucket;
  category_summary: { division_name: string; qty: number; revenue: number }[];
  cashiers: { user_id: number; display_name: string; count: number; net: number }[];
}

export interface ReportProductLine {
  sku: string;
  name: string;
  division_name: string;
  qty: number;
  revenue: number;
  stock_left: number | null;
  sold_out: boolean;
}

export interface PromptPayTraceLine {
  sale_id: number;
  created_at: string;
  event_code: string;
  event_name: string;
  cashier_name: string | null;
  amount: number;
  tx_hash: string | null;
  ref: string | null;
}

export interface SalesReport {
  period: { from: string | null; to: string | null };
  settings: Record<string, string>;
  totals: ReportBucket;
  events: ReportEvent[];
  category_summary: { division_name: string; qty: number; revenue: number; share: number }[];
  product_summary: ReportProductLine[];
  sold_out_products: ReportProductLine[];
  promptpay_trace: PromptPayTraceLine[];
  promptpay_total: number;
  reversed: {
    id: number;
    created_at: string;
    event_name: string | null;
    cashier_name: string | null;
    total: number;
    status: SaleStatus;
    void_reason: string | null;
    voided_by_name: string | null;
  }[];
  chain: { verified: boolean; checked: number; broken_at: number | null; unsealed: number };
  truncated: boolean;
}

export interface BankStatementLine {
  id: number;
  batch_id: number;
  posted_at: string;
  description: string;
  ref: string | null;
  debit: number;
  credit: number;
  balance: number | null;
  created_at: string;
  /** Joined in by the reconciliation endpoints. */
  reconcile_status?: ReconcileStatus;
  matched_sale_ids?: number[];
}

export interface BankImportBatch {
  id: number;
  filename: string;
  bank_code: string;
  imported_by: number;
  importer_name?: string | null;
  row_count: number;
  period_from: string | null;
  period_to: string | null;
  created_at: string;
}

export interface ReconciliationRecord {
  id: number;
  sale_id: number;
  bank_line_id: number | null;
  status: ReconcileStatus;
  matched_amount: number;
  fee_amount: number;
  variance: number;
  method: ReconcileMethod;
  note: string | null;
  matched_by: number | null;
  created_at: string;
}

export interface ReconcileSummary {
  pos_total: number;
  pos_matched: number;
  pos_unmatched: number;
  bank_total: number;
  bank_matched: number;
  bank_unmatched: number;
  fees: number;
  variance: number;
  locked: boolean;
}

export interface AuditLog {
  id: number;
  actor_user_id: number | null;
  actor_name: string | null;
  action: string;
  entity: string;
  entity_id: number | null;
  before_json: string | null;
  after_json: string | null;
  reason: string | null;
  ip: string | null;
  created_at: string;
}

export interface ZReport {
  id: number | null;
  business_date: string;
  event_id: number | null;
  event_name?: string | null;
  cashier_user_id: number | null;
  cashier_name?: string | null;
  gross: number;
  discount: number;
  net: number;
  cash_expected: number;
  cash_counted: number | null;
  variance: number | null;
  promptpay_total: number;
  sale_count: number;
  void_count: number;
  refund_count: number;
  closed_by: number | null;
  closed_at: string | null;
  report_hash: string | null;
  /** Live recomputation, present so the UI can flag activity booked after close. */
  live?: { net: number; sale_count: number; cash_expected: number; promptpay_total: number };
  drifted?: boolean;
}

// ── Operations dashboard ──

export interface DashboardEventStatus {
  id: number;
  code: string;
  name: string;
  status: EventStatus;
  date: string | null;
  today_sales: number;
  today_revenue: number;
  last_sale_at: string | null;
}

export interface CashierActivity {
  user_id: number;
  display_name: string;
  sale_count: number;
  revenue: number;
  cash: number;
  promptpay: number;
  last_sale_at: string | null;
}

export interface LowStockItem {
  id: number;
  sku: string;
  name: string;
  stock: number;
  division_name: string | null;
  sold_today: number;
}

export interface DashboardPayload {
  period: { from: string | null; to: string | null; label: string };
  kpi: {
    gross: number;
    discount: number;
    net: number;
    cash_total: number;
    promptpay_total: number;
    orders_completed: number;
    orders_void: number;
    orders_refunded: number;
    avg_basket: number;
    low_stock_count: number;
    today_net: number;
    today_orders: number;
  };
  payment_breakdown: Record<string, number>;
  division_breakdown: Record<string, number>;
  daily: Record<string, number>;
  recent_sales: Sale[];
  events: DashboardEventStatus[];
  cashiers: CashierActivity[];
  low_stock: LowStockItem[];
  audit_tail: AuditLog[];
  promptpay_trace: { amount: number; count: number };
  zreport: { closed: boolean; closed_at: string | null; cash_expected: number; cash_counted: number | null; variance: number | null };
}
