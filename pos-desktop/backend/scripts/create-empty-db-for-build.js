/**
 * 빌드용 빈 데이터베이스 생성 스크립트
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(__dirname, '..', '..', 'pos-desktop', 'db-empty', 'web2pos.db');

console.log('Creating empty DB at:', dbPath);

// 기존 파일 삭제
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
}

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // ====== Core Menu Tables ======
  
  // Menus (Main Menu Table)
  db.run(`CREATE TABLE IF NOT EXISTS menus (
    menu_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    is_active INTEGER DEFAULT 0,
    sales_channels TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  // Menu Categories
  db.run(`CREATE TABLE IF NOT EXISTS menu_categories (
    category_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    menu_id INTEGER NOT NULL,
    sort_order INTEGER DEFAULT 0,
    image_url TEXT,
    FOREIGN KEY (menu_id) REFERENCES menus(menu_id) ON DELETE CASCADE
  )`);
  
  // Menu Items
  db.run(`CREATE TABLE IF NOT EXISTS menu_items (
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
  )`);
  
  // ====== Modifier Tables ======
  
  db.run(`CREATE TABLE IF NOT EXISTS modifier_groups (
    group_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    selection_type TEXT NOT NULL DEFAULT 'SINGLE',
    min_selection INTEGER DEFAULT 0,
    max_selection INTEGER DEFAULT 1,
    menu_id INTEGER,
    is_deleted INTEGER DEFAULT 0
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS modifiers (
    modifier_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    price_delta REAL DEFAULT 0,
    type TEXT NOT NULL DEFAULT 'OPTION',
    is_deleted INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS modifier_group_links (
    modifier_group_id INTEGER NOT NULL,
    modifier_id INTEGER NOT NULL,
    PRIMARY KEY (modifier_group_id, modifier_id)
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS menu_modifier_links (
    link_id INTEGER PRIMARY KEY,
    item_id INTEGER NOT NULL,
    modifier_group_id INTEGER NOT NULL,
    is_ambiguous INTEGER DEFAULT 0,
    UNIQUE (item_id, modifier_group_id)
  )`);
  
  // ====== Tax Tables ======
  
  db.run(`CREATE TABLE IF NOT EXISTS tax_groups (
    group_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    menu_id INTEGER,
    is_deleted INTEGER DEFAULT 0
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS taxes (
    tax_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    rate REAL NOT NULL DEFAULT 0,
    type TEXT NOT NULL DEFAULT 'PERCENTAGE',
    is_deleted INTEGER DEFAULT 0
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS tax_group_links (
    tax_group_id INTEGER NOT NULL,
    tax_id INTEGER NOT NULL,
    PRIMARY KEY (tax_group_id, tax_id)
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS menu_tax_links (
    link_id INTEGER PRIMARY KEY,
    item_id INTEGER NOT NULL,
    tax_group_id INTEGER NOT NULL,
    is_ambiguous INTEGER DEFAULT 0,
    UNIQUE (item_id, tax_group_id)
  )`);
  
  // ====== Printer Tables ======
  
  db.run(`CREATE TABLE IF NOT EXISTS printers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT '',
    type TEXT DEFAULT '',
    selected_printer TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS printer_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS printer_group_links (
    group_id INTEGER NOT NULL,
    printer_id INTEGER NOT NULL,
    PRIMARY KEY (group_id, printer_id)
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS menu_printer_links (
    link_id INTEGER PRIMARY KEY,
    item_id INTEGER NOT NULL,
    printer_group_id INTEGER NOT NULL,
    is_ambiguous INTEGER DEFAULT 0,
    UNIQUE (item_id, printer_group_id)
  )`);
  
  // ====== Business Profile ======
  
  db.run(`CREATE TABLE IF NOT EXISTS business_profile (
    id INTEGER PRIMARY KEY CHECK(id=1),
    business_name TEXT,
    tax_number TEXT,
    phone TEXT,
    email TEXT,
    address_line1 TEXT,
    address_line2 TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    logo_url TEXT,
    banner_url TEXT,
    firebase_restaurant_id TEXT,
    service_type TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  // ====== Channel Settings ======
  
  db.run(`CREATE TABLE IF NOT EXISTS channel_settings (
    channel TEXT PRIMARY KEY,
    discount_enabled INTEGER DEFAULT 0,
    discount_mode TEXT DEFAULT 'percent',
    discount_value REAL DEFAULT 0,
    bag_fee_enabled INTEGER DEFAULT 0,
    bag_fee_mode TEXT DEFAULT 'amount',
    bag_fee_value REAL DEFAULT 0,
    discount_stage TEXT DEFAULT 'pre-tax',
    bag_fee_taxable INTEGER DEFAULT 0,
    discount_scope TEXT DEFAULT 'all',
    discount_item_ids TEXT,
    discount_category_ids TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  // ====== Orders ======
  
  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT,
    table_id TEXT,
    table_name TEXT,
    order_type TEXT,
    status TEXT DEFAULT 'OPEN',
    subtotal REAL DEFAULT 0,
    tax REAL DEFAULT 0,
    total REAL DEFAULT 0,
    paid_amount REAL DEFAULT 0,
    customer_name TEXT,
    customer_phone TEXT,
    customer_address TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP,
    employee_id INTEGER,
    channel TEXT,
    firebase_id TEXT,
    ready_time TEXT,
    external_order_number TEXT
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    item_id INTEGER,
    name TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    price REAL NOT NULL,
    modifiers TEXT,
    memo TEXT,
    guest_number INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_voided INTEGER DEFAULT 0,
    void_reason TEXT,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  )`);
  
  // ====== Payments ======
  
  db.run(`CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    payment_method TEXT NOT NULL,
    amount REAL NOT NULL,
    tip REAL DEFAULT 0,
    reference_number TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    guest_number INTEGER,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  )`);
  
  // ====== Channels ======
  
  db.run(`CREATE TABLE IF NOT EXISTS channels (
    channel_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
  )`);
  
  // ====== Employees ======
  
  db.run(`CREATE TABLE IF NOT EXISTS employees (
    employee_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    channel_id INTEGER
  )`);
  
  // ====== Table Map ======
  
  db.run(`CREATE TABLE IF NOT EXISTS table_map_elements (
    element_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    x_pos INTEGER,
    y_pos INTEGER,
    width INTEGER,
    height INTEGER
  )`);
  
  // ====== Business Hours ======
  
  db.run(`CREATE TABLE IF NOT EXISTS business_hours (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day_of_week INTEGER NOT NULL,
    open_time TEXT,
    close_time TEXT,
    is_open INTEGER DEFAULT 1,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  // ====== Insert Default Data ======
  
  console.log('Creating tables...');
  
  // Insert empty business profile (triggers initial setup)
  db.run("INSERT INTO business_profile (id) VALUES (1)", (err) => {
    if (err) console.log('business_profile insert skipped:', err.message);
  });
  
  // Default channels
  db.run("INSERT INTO channels (channel_id, name) VALUES (1, 'POS')");
  db.run("INSERT INTO channels (channel_id, name) VALUES (2, 'TOGO')");
  db.run("INSERT INTO channels (channel_id, name) VALUES (3, 'ONLINE')");
  db.run("INSERT INTO channels (channel_id, name) VALUES (4, 'DELIVERY')");
  
  // Default admin (PIN: 0000)
  db.run("INSERT INTO employees (employee_id, name, pin_hash, role) VALUES (5200, 'Admin', '0000', 'Admin')");
  
  // Default business hours (Mon-Sun, 9AM-9PM)
  for (let i = 0; i < 7; i++) {
    db.run(`INSERT INTO business_hours (day_of_week, open_time, close_time, is_open) VALUES (${i}, '09:00', '21:00', 1)`);
  }
  
  console.log('✅ Empty database created successfully!');
  console.log('✅ Default data inserted (Admin PIN: 0000)');
});

db.close((err) => {
  if (err) {
    console.error('Error closing database:', err);
  } else {
    console.log('✅ Database file saved to:', dbPath);
  }
});
