-- ── CIDA POS 2.0 — add superadmin role ──
-- SQLite cannot alter a CHECK constraint, so rebuild the users table.
-- D1 enforces foreign keys, so defer FK checks until the rebuild completes
-- (sales.cashier_user_id references users; ids are preserved).

PRAGMA defer_foreign_keys = true;

CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  pin_hash TEXT NOT NULL,
  pin_salt TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'cashier' CHECK (role IN ('superadmin','admin','cashier')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO users_new (id, username, pin_hash, pin_salt, display_name, role, active, created_at)
SELECT id, username, pin_hash, pin_salt, display_name, role, active, created_at FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

PRAGMA defer_foreign_keys = false;

-- Existing admin account becomes superadmin (delete/bulk-delete sales rights).
UPDATE users SET role = 'superadmin' WHERE username = 'admin';

-- Receipt/report logo (fallback to app icon when empty).
INSERT INTO settings (key, value) VALUES ('logo_url', '') ON CONFLICT(key) DO NOTHING;
