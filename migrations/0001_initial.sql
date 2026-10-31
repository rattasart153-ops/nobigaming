-- Nobi Topup D1 schema
-- Creates tables only. Existing data must be migrated separately.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS admins (
id INTEGER PRIMARY KEY,
username TEXT UNIQUE NOT NULL,
password_hash TEXT NOT NULL,
created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS games (
id INTEGER PRIMARY KEY AUTOINCREMENT,
name TEXT UNIQUE NOT NULL,
category TEXT DEFAULT 'other',
description TEXT DEFAULT '',
active INTEGER NOT NULL DEFAULT 1,
created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS packages (
id INTEGER PRIMARY KEY AUTOINCREMENT,
game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
name TEXT NOT NULL,
amount INTEGER NOT NULL,
unit TEXT NOT NULL,
price REAL NOT NULL CHECK(price >= 0),
image_url TEXT DEFAULT '',
popular INTEGER NOT NULL DEFAULT 0,
active INTEGER NOT NULL DEFAULT 1,
created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS coupons (
id INTEGER PRIMARY KEY AUTOINCREMENT,
code TEXT UNIQUE NOT NULL,
discount_type TEXT NOT NULL CHECK(discount_type IN ('fixed','percent')),
discount_value REAL NOT NULL CHECK(discount_value > 0),
min_spend REAL NOT NULL DEFAULT 0,
game_id INTEGER REFERENCES games(id) ON DELETE SET NULL,
expires_at TEXT,
usage_limit INTEGER,
used_count INTEGER NOT NULL DEFAULT 0,
active INTEGER NOT NULL DEFAULT 1,
created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS promotions (
id INTEGER PRIMARY KEY AUTOINCREMENT,
title TEXT NOT NULL,
subtitle TEXT DEFAULT '',
image_url TEXT DEFAULT '',
link_url TEXT DEFAULT '#games',
active INTEGER NOT NULL DEFAULT 1,
sort_order INTEGER NOT NULL DEFAULT 0,
starts_at TEXT,
ends_at TEXT,
created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
id TEXT PRIMARY KEY,
game_id INTEGER NOT NULL REFERENCES games(id),
package_id INTEGER NOT NULL REFERENCES packages(id),
player_id TEXT NOT NULL,
server_id TEXT DEFAULT '',
coupon_id INTEGER REFERENCES coupons(id),
subtotal REAL NOT NULL,
discount REAL NOT NULL DEFAULT 0,
total REAL NOT NULL,
slip_path TEXT,
status TEXT NOT NULL DEFAULT 'Pending'
CHECK(status IN ('Pending','Completed','Rejected')),
created_at TEXT DEFAULT CURRENT_TIMESTAMP,
updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_packages_game_active
ON packages(game_id, active);

CREATE INDEX IF NOT EXISTS idx_coupons_active
ON coupons(active);

CREATE INDEX IF NOT EXISTS idx_orders_status_created
ON orders(status, created_at);
