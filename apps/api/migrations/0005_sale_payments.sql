-- 0005_sale_payments.sql
-- Split bill: one sale may be settled with several tenders.
--
-- sales.payment_method is kept and set to the largest split. Its CHECK
-- constraint only permits 'Cash' | 'PromptPay', so there is no 'MIXED' value
-- and no table rebuild; sale_payments carries the detail. Reporting reads
-- sale_payments when rows exist and falls back to sales.payment_method for
-- historical sales.

CREATE TABLE IF NOT EXISTS sale_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('Cash','PromptPay')),
  amount REAL NOT NULL CHECK (amount > 0),
  ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sale_payments_sale ON sale_payments(sale_id);
