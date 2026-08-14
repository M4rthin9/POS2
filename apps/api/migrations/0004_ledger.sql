-- 0004_ledger.sql
-- Tamper-evident sale ledger, audit trail, bank statement import and
-- reconciliation, plus Z-report day close.
--
-- sales.status already permits 'COMPLETED' | 'REFUNDED' | 'VOID' (0001_init),
-- so no table rebuild is needed here — only additive columns.

-- ── Ledger chain + void/refund provenance on sales ──
ALTER TABLE sales ADD COLUMN tx_hash TEXT;
ALTER TABLE sales ADD COLUMN prev_hash TEXT;
ALTER TABLE sales ADD COLUMN seq INTEGER;
ALTER TABLE sales ADD COLUMN voided_at TEXT;
ALTER TABLE sales ADD COLUMN voided_by INTEGER REFERENCES users(id);
ALTER TABLE sales ADD COLUMN void_reason TEXT;

-- SQLite cannot add a UNIQUE column via ALTER, so the constraints are indexes.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_tx_hash ON sales(tx_hash) WHERE tx_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_seq ON sales(seq) WHERE seq IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);

-- ── Audit trail (append-only by convention: never UPDATEd, never DELETEd) ──
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_user_id);

-- ── Bank statement import ──
CREATE TABLE IF NOT EXISTS bank_import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  bank_code TEXT NOT NULL DEFAULT 'KTB',
  imported_by INTEGER REFERENCES users(id),
  row_count INTEGER NOT NULL DEFAULT 0,
  period_from TEXT,
  period_to TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bank_statement_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES bank_import_batches(id) ON DELETE CASCADE,
  posted_at TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  ref TEXT,
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  balance REAL,
  raw_json TEXT,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bank_lines_posted ON bank_statement_lines(posted_at);
CREATE INDEX IF NOT EXISTS idx_bank_lines_batch ON bank_statement_lines(batch_id);
-- Re-importing an overlapping statement period must not duplicate rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_lines_fingerprint ON bank_statement_lines(fingerprint);

-- ── Reconciliation ──
CREATE TABLE IF NOT EXISTS reconciliation_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  bank_line_id INTEGER REFERENCES bank_statement_lines(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'MATCHED' CHECK (status IN ('MATCHED','PARTIAL','FLAGGED','UNMATCHED')),
  matched_amount REAL NOT NULL DEFAULT 0,
  fee_amount REAL NOT NULL DEFAULT 0,
  variance REAL NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'AUTO' CHECK (method IN ('AUTO','MANUAL')),
  note TEXT,
  matched_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- A sale is settled at most once; a bank line may cover several sales (batch settlement).
CREATE UNIQUE INDEX IF NOT EXISTS idx_recon_sale ON reconciliation_records(sale_id);
CREATE INDEX IF NOT EXISTS idx_recon_bank_line ON reconciliation_records(bank_line_id);

-- ── Z-report (day close) ──
CREATE TABLE IF NOT EXISTS z_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_date TEXT NOT NULL,
  event_id INTEGER REFERENCES events(id),
  cashier_user_id INTEGER REFERENCES users(id),
  gross REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  net REAL NOT NULL DEFAULT 0,
  cash_expected REAL NOT NULL DEFAULT 0,
  cash_counted REAL,
  variance REAL,
  promptpay_total REAL NOT NULL DEFAULT 0,
  sale_count INTEGER NOT NULL DEFAULT 0,
  void_count INTEGER NOT NULL DEFAULT 0,
  refund_count INTEGER NOT NULL DEFAULT 0,
  closed_by INTEGER REFERENCES users(id),
  closed_at TEXT NOT NULL DEFAULT (datetime('now')),
  report_hash TEXT
);
-- One close per (day, event, cashier). COALESCE keeps the "all events / all
-- cashiers" close distinct from per-cashier closes.
CREATE UNIQUE INDEX IF NOT EXISTS idx_zreport_scope
  ON z_reports(business_date, COALESCE(event_id, 0), COALESCE(cashier_user_id, 0));

-- ── New settings keys ──
INSERT INTO settings (key, value) VALUES ('low_stock_threshold', '5') ON CONFLICT(key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('reconcile_fee_tolerance', '0') ON CONFLICT(key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('terminal_id', 'POS-01') ON CONFLICT(key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('bank_account_no', '') ON CONFLICT(key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('bank_name', 'ธนาคารกรุงไทย (KTB)') ON CONFLICT(key) DO NOTHING;
