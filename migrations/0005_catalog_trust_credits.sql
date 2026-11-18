-- Store list (from 5RD), shipped-package lookup (from OMS TransferOutboundDetails),
-- rep requests, and the confirmed Nov 17 2026 policy changes.
CREATE TABLE IF NOT EXISTS stores(
 key TEXT PRIMARY KEY,
 license TEXT,
 name TEXT NOT NULL,
 rep TEXT,
 route TEXT,
 segment TEXT,
 parent TEXT,
 return_window TEXT NOT NULL DEFAULT '90',
 updated TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS stores_license ON stores(license);
CREATE TABLE IF NOT EXISTS shipments(
 id TEXT PRIMARY KEY,
 license TEXT NOT NULL,
 client TEXT,
 tsid TEXT NOT NULL,
 order_number TEXT,
 product TEXT,
 units REAL,
 unit_cents INTEGER,
 status TEXT,
 delivered TEXT NOT NULL,
 imported TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS shipments_tsid ON shipments(tsid);
CREATE INDEX IF NOT EXISTS shipments_delivered ON shipments(delivered);
CREATE TABLE IF NOT EXISTS rep_requests(
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT UNIQUE NOT NULL,
 idempotency TEXT UNIQUE NOT NULL,
 data TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO configuration VALUES('rep_emails','{}');
INSERT OR IGNORE INTO configuration VALUES('catalog','{}');
-- Decided Nov 17 2026: 90-day standard window, $250 trust tier counted per store over a rolling 30 days.
UPDATE configuration SET data=json_set(data,'$.submitDays',90,'$.completeDays',100,'$.quickLimit',25000,'$.trustWindowDays',30) WHERE key='policy';
