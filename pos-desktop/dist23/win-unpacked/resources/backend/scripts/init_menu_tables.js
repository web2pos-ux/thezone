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
    price2 REAL DEFAULT 0,
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

  -- ============================================
  -- ID Mappings (Universal ID Mapper)
  -- ============================================
  CREATE TABLE IF NOT EXISTS id_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    entity_type TEXT NOT NULL,
    local_id INTEGER NOT NULL,
    firebase_id TEXT,
    external_ids TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_id_mappings_uuid ON id_mappings(uuid);
  CREATE INDEX IF NOT EXISTS idx_id_mappings_entity ON id_mappings(entity_type, local_id);
  CREATE INDEX IF NOT EXISTS idx_id_mappings_firebase ON id_mappings(firebase_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_id_mappings_entity_local ON id_mappings(entity_type, local_id);

  -- ============================================
  -- Sync Logs (동기화 이력 추적)
  -- ============================================
  CREATE TABLE IF NOT EXISTS sync_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_id TEXT UNIQUE NOT NULL,
    sync_type TEXT NOT NULL,
    direction TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    started_at DATETIME NOT NULL,
    completed_at DATETIME,
    status TEXT DEFAULT 'running',
    total_items INTEGER DEFAULT 0,
    created_count INTEGER DEFAULT 0,
    updated_count INTEGER DEFAULT 0,
    deleted_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    errors TEXT,
    initiated_by TEXT DEFAULT 'user',
    employee_id INTEGER,
    device_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sync_logs_sync_id ON sync_logs(sync_id);
  CREATE INDEX IF NOT EXISTS idx_sync_logs_started ON sync_logs(started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_sync_logs_entity ON sync_logs(entity_type);
  CREATE INDEX IF NOT EXISTS idx_sync_logs_status ON sync_logs(status);

  -- ============================================
  -- Sync Log Details (동기화 항목별 상세)
  -- ============================================
  CREATE TABLE IF NOT EXISTS sync_log_details (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT DEFAULT 'success',
    local_id INTEGER,
    firebase_id TEXT,
    old_data TEXT,
    new_data TEXT,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sync_id) REFERENCES sync_logs(sync_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_sync_log_details_sync ON sync_log_details(sync_id);
  CREATE INDEX IF NOT EXISTS idx_sync_log_details_entity ON sync_log_details(entity_type);
  CREATE INDEX IF NOT EXISTS idx_sync_log_details_status ON sync_log_details(status);

  -- ============================================
  -- Third Party Integrations (3rd Party 연동 설정)
  -- ============================================
  CREATE TABLE IF NOT EXISTS third_party_integrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform_name TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    api_key TEXT,
    api_secret TEXT,
    webhook_url TEXT,
    settings TEXT DEFAULT '{}',
    is_active INTEGER DEFAULT 0,
    sync_enabled INTEGER DEFAULT 0,
    last_sync_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_integrations_platform ON third_party_integrations(platform_name);
  CREATE INDEX IF NOT EXISTS idx_integrations_active ON third_party_integrations(is_active);
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