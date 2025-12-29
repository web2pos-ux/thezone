const path = require('path');
const sqlite3 = require('sqlite3').verbose();

(async () => {
  const dbPath = path.resolve(__dirname, '..', 'db', 'web2pos.db');
  const db = new sqlite3.Database(dbPath);

  const exec = (sql) => new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  const schema = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS menus (
    menu_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    is_active INTEGER DEFAULT 0,
    sales_channels TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS menu_categories (
    category_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    menu_id INTEGER NOT NULL,
    sort_order INTEGER DEFAULT 0,
    image_url TEXT,
    FOREIGN KEY (menu_id) REFERENCES menus(menu_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_menu_categories_menu ON menu_categories(menu_id);
  CREATE INDEX IF NOT EXISTS idx_menu_categories_sort ON menu_categories(menu_id, sort_order);

  CREATE TABLE IF NOT EXISTS menu_items (
    item_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    short_name TEXT,
    price REAL NOT NULL DEFAULT 0,
    description TEXT,
    category_id INTEGER NOT NULL,
    menu_id INTEGER NOT NULL,
    is_open_price INTEGER DEFAULT 0,
    image_url TEXT,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (category_id) REFERENCES menu_categories(category_id) ON DELETE CASCADE,
    FOREIGN KEY (menu_id) REFERENCES menus(menu_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_menu_items_menu ON menu_items(menu_id);
  CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category_id);
  CREATE INDEX IF NOT EXISTS idx_menu_items_sort ON menu_items(menu_id, category_id, sort_order);
  `;

  try {
    console.log('Initializing core menu tables at:', dbPath);
    await exec(schema);
    console.log('Core menu tables initialized.');
  } catch (e) {
    console.error('Failed to initialize tables:', e.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
})(); 