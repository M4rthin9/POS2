-- ── CIDA POS 2.0 — initial schema + seed ──

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  pin_hash TEXT NOT NULL,
  pin_salt TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'cashier' CHECK (role IN ('admin','cashier')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  date TEXT,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'UPCOMING' CHECK (status IN ('ACTIVE','UPCOMING','CLOSED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS divisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  icon TEXT DEFAULT '📦',
  sort_order INTEGER DEFAULT 0
);

-- stock NULL = unlimited; CHECK (stock IS NULL OR stock >= 0) makes a batch
-- stock decrement atomic: going negative raises an error that rolls back the
-- entire D1 batch (sale + items).
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  division_id INTEGER REFERENCES divisions(id) ON DELETE SET NULL,
  price REAL NOT NULL DEFAULT 0 CHECK (price >= 0),
  image_url TEXT,
  stock INTEGER CHECK (stock IS NULL OR stock >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS event_products (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, product_id)
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id),
  cashier_user_id INTEGER NOT NULL REFERENCES users(id),
  subtotal REAL NOT NULL,
  discount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'Cash' CHECK (payment_method IN ('Cash','PromptPay')),
  status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED','REFUNDED','VOID')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  qty REAL NOT NULL,
  price REAL NOT NULL,
  line_total REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_sales_event ON sales(event_id);
CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_cashier ON sales(cashier_user_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_event_products_event ON event_products(event_id);
CREATE INDEX IF NOT EXISTS idx_products_division ON products(division_id);

-- ── Seed data ──
INSERT INTO users (username, pin_hash, pin_salt, display_name, role) VALUES
  ('admin', '4eb6908b5a7c22a83d7d1329d3e91147e83a0d4d894d616576d60a34b3a8ef48', '736565642d73616c742d61646d696e2d30303031', 'ผู้ดูแลระบบ', 'admin'),
  ('cashier', '8aca6809684bcd5b9d0d2a23de11f645614e771e76a58bfdcf743eae58235ded', '736565642d73616c742d636173686965722d30303031', 'แคชเชียร์', 'cashier');

INSERT INTO divisions (name, icon, sort_order) VALUES
  ('อาหาร', '🍜', 1),
  ('เครื่องดื่ม', '🥤', 2),
  ('ของที่ระลึก', '🎁', 3);

INSERT INTO settings (key, value) VALUES
  ('org_name', 'ทัณฑสถานบำบัดพิเศษกลาง ฝ่ายฝึกวิชาชีพผู้ต้องขัง'),
  ('org_subtitle', 'ส่วนพัฒนาผู้ต้องขัง CIDA'),
  ('org_address', ''),
  ('tax_id', ''),
  ('promptpay_id', '010753700088205'),
  ('receipt_footer', 'ขอบคุณที่ใช้บริการ'),
  ('print_size', '58mm');

-- sample event + sample products
INSERT INTO events (code, name, date, location, status) VALUES
  ('EVT001', 'งานกิจกรรมทดสอบ ครั้งที่ 1', datetime('now', '+7 days'), 'CIDA', 'UPCOMING');

INSERT INTO products (sku, name, division_id, price, stock) VALUES
  ('SKU001', 'ข้าวผัดหมู', 1, 40, 100),
  ('SKU002', 'น้ำผลไม้ปั่น', 2, 30, 50),
  ('SKU003', 'เสื้อยืด CIDA', 3, 150, 20);

INSERT INTO event_products (event_id, product_id) VALUES (1, 1), (1, 2), (1, 3);
