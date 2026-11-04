'use strict';

const path = require('node:path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { DATA_DIR } = require('../config/paths');
const ENV = require('../config/env');

// Preserve the existing SQLite schema, migrations, seed data, and Admin bootstrap.
const db = new Database(path.join(DATA_DIR, 'nobitopup.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS games (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, category TEXT DEFAULT 'other', description TEXT DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS packages (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE, name TEXT NOT NULL, amount INTEGER NOT NULL, unit TEXT NOT NULL, price REAL NOT NULL CHECK(price >= 0), image_url TEXT DEFAULT '', popular INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS coupons (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, discount_type TEXT NOT NULL CHECK(discount_type IN ('fixed','percent')), discount_value REAL NOT NULL CHECK(discount_value > 0), min_spend REAL NOT NULL DEFAULT 0, game_id INTEGER REFERENCES games(id) ON DELETE SET NULL, expires_at TEXT, usage_limit INTEGER, used_count INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP, allowed_player_ids TEXT NOT NULL DEFAULT '', min_player_spend REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS promotions (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, subtitle TEXT DEFAULT '', image_url TEXT DEFAULT '', link_url TEXT DEFAULT '#games', active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, starts_at TEXT, ends_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, game_id INTEGER NOT NULL REFERENCES games(id), package_id INTEGER NOT NULL REFERENCES packages(id), player_id TEXT NOT NULL, server_id TEXT DEFAULT '', coupon_id INTEGER REFERENCES coupons(id), subtotal REAL NOT NULL, discount REAL NOT NULL DEFAULT 0, total REAL NOT NULL, slip_path TEXT, status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Completed','Rejected')), created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);

// Backward-compatible coupon-rule migration for existing SQLite databases.
const couponColumns = new Set(db.prepare('PRAGMA table_info(coupons)').all().map(c => c.name));
if (!couponColumns.has('allowed_player_ids')) db.exec("ALTER TABLE coupons ADD COLUMN allowed_player_ids TEXT NOT NULL DEFAULT ''");
if (!couponColumns.has('min_player_spend')) db.exec('ALTER TABLE coupons ADD COLUMN min_player_spend REAL NOT NULL DEFAULT 0');

const seedGames = [
  ['RoV','moba','Arena of Valor'], ['Free Fire','br','เพชร Free Fire'], ['Genshin Impact','rpg','Genesis Crystal'],
  ['PUBG Mobile','br','UC'], ['Mobile Legends','moba','Diamonds'], ['Valorant','fps','VP'],
  ['Honkai: Star Rail','rpg','Oneiric Shard'], ['Call of Duty: Mobile','fps','CP'], ['Roblox','sandbox','Robux']
];
const seedPacks = {
  'RoV': ['คูปอง', [[90,15],[250,39],[500,75],[1100,159],[2200,299],[5500,699]]],
  'Free Fire': ['เพชร', [[110,19],[341,59],[572,99],[1060,139],[2200,279],[5600,699]]],
  'Genshin Impact': ['Genesis Crystal', [[60,35],[330,169],[1090,559],[2240,1190],[3880,1890],[8080,3590]]],
  'PUBG Mobile': ['UC', [[60,25],[325,129],[660,259],[1800,679],[3850,1390],[8100,2790]]],
  'Mobile Legends': ['Diamonds', [[86,20],[172,39],[257,59],[706,159],[2195,479],[4390,949]]],
  'Valorant': ['VP', [[125,45],[420,149],[700,249],[1375,479],[2400,829],[4000,1350]]],
  'Honkai: Star Rail': ['Oneiric Shard', [[60,39],[330,179],[1090,579],[2240,1250],[3880,1990],[8080,3790]]],
  'Call of Duty: Mobile': ['CP', [[80,25],[420,129],[880,259],[2400,679],[5000,1390],[10000,2690]]],
  'Roblox': ['Robux', [[80,29],[400,139],[800,269],[1700,559],[4500,1390],[10000,2990]]]
};
const insertGame = db.prepare('INSERT OR IGNORE INTO games(name,category,description) VALUES(?,?,?)');
const insertPack = db.prepare('INSERT INTO packages(game_id,name,amount,unit,price,popular,active) VALUES(?,?,?,?,?,?,1)');
for (const [name, cat, desc] of seedGames) insertGame.run(name, cat, desc);
if (db.prepare('SELECT COUNT(*) AS n FROM packages').get().n === 0) {
  const tx = db.transaction(() => {
    for (const [game, [unit, packs]] of Object.entries(seedPacks)) {
      const g = db.prepare('SELECT id FROM games WHERE name=?').get(game);
      packs.forEach(([amount, price], i) => insertPack.run(g.id, `${amount.toLocaleString('en-US')} ${unit}`, amount, unit, price, i === packs.length - 2 ? 1 : 0));
    }
  }); tx();
}
const adminUser = ENV.ADMIN_USERNAME;
const adminPass = ENV.ADMIN_PASSWORD;
if (!adminUser || !adminPass) throw new Error('ADMIN_USERNAME and ADMIN_PASSWORD must be configured before startup in every environment.');
if (!db.prepare('SELECT id FROM admins WHERE username=?').get(adminUser)) {
  db.prepare('INSERT INTO admins(username,password_hash) VALUES(?,?)').run(adminUser, bcrypt.hashSync(adminPass, 12));
}

module.exports = db;
