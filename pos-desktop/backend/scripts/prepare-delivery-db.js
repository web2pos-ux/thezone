/**
 * prepare-delivery-db.js
 * 납품을 위한 깨끗한 초기화 데이터베이스를 생성합니다.
 * 모든 메뉴(200005 포함), 설정, 주문 내역을 삭제하고 기본값만 설정합니다.
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(__dirname, '..', '..', 'db', 'web2pos.db');
const backupPath = path.resolve(__dirname, '..', '..', 'db', `web2pos_backup_before_delivery_${Date.now()}.db`);

console.log('--- Delivery DB Preparation Start ---');

// 1. 기존 DB 백업
if (fs.existsSync(dbPath)) {
  console.log(`Backing up existing DB to: ${backupPath}`);
  fs.copyFileSync(dbPath, backupPath);
  console.log('Backup complete. Deleting original DB...');
  fs.unlinkSync(dbPath);
}

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  console.log('Initializing fresh tables...');

  // --- 1. Menu & Structure Tables ---
  db.run(`CREATE TABLE IF NOT EXISTS menus (
    menu_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    is_active INTEGER DEFAULT 0,
    sales_channels TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS menu_categories (
    category_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    menu_id INTEGER NOT NULL,
    sort_order INTEGER DEFAULT 0,
    image_url TEXT,
    FOREIGN KEY (menu_id) REFERENCES menus(menu_id) ON DELETE CASCADE
  )`);

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
    online_visible INTEGER DEFAULT 1,
    delivery_visible INTEGER DEFAULT 1,
    online_hide_type TEXT DEFAULT 'visible',
    online_available_until TEXT,
    delivery_hide_type TEXT DEFAULT 'visible',
    delivery_available_until TEXT,
    FOREIGN KEY (category_id) REFERENCES menu_categories(category_id) ON DELETE CASCADE,
    FOREIGN KEY (menu_id) REFERENCES menus(menu_id) ON DELETE CASCADE
  )`);

  // --- 2. Modifier Tables (Standardized) ---
  db.run(`CREATE TABLE IF NOT EXISTS modifier_groups (
    modifier_group_id INTEGER PRIMARY KEY,
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
    price_delta2 REAL DEFAULT 0,
    type TEXT NOT NULL DEFAULT 'OPTION',
    is_deleted INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS modifier_group_links (
    modifier_group_id INTEGER NOT NULL,
    modifier_id INTEGER NOT NULL,
    PRIMARY KEY (modifier_group_id, modifier_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS modifier_labels (
    label_id INTEGER PRIMARY KEY,
    modifier_group_id INTEGER NOT NULL,
    label_name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (modifier_group_id) REFERENCES modifier_groups(modifier_group_id) ON DELETE CASCADE
  )`);

  // --- 3. Tax Tables (Standardized) ---
  db.run(`CREATE TABLE IF NOT EXISTS tax_groups (
    tax_group_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    menu_id INTEGER,
    is_deleted INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS taxes (
    tax_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    rate REAL NOT NULL DEFAULT 0,
    menu_id INTEGER,
    is_deleted INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS tax_group_links (
    tax_group_id INTEGER NOT NULL,
    tax_id INTEGER NOT NULL,
    PRIMARY KEY (tax_group_id, tax_id)
  )`);

  // --- 4. Printer Tables (Standardized) ---
  db.run(`CREATE TABLE IF NOT EXISTS printers (
    printer_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    type TEXT DEFAULT '',
    selected_printer TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS printer_groups (
    printer_group_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    menu_id INTEGER,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS printer_group_links (
    printer_group_id INTEGER NOT NULL,
    printer_id INTEGER NOT NULL,
    PRIMARY KEY (printer_group_id, printer_id)
  )`);

  // --- 5. Link Tables (Many-to-Many) ---
  db.run(`CREATE TABLE IF NOT EXISTS category_modifier_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    modifier_group_id INTEGER NOT NULL,
    is_ambiguous INTEGER DEFAULT 0,
    UNIQUE(category_id, modifier_group_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS category_tax_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    tax_group_id INTEGER NOT NULL,
    is_ambiguous INTEGER DEFAULT 0,
    UNIQUE(category_id, tax_group_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS category_printer_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    printer_group_id INTEGER NOT NULL,
    is_ambiguous INTEGER DEFAULT 0,
    UNIQUE(category_id, printer_group_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS menu_modifier_links (
    link_id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    modifier_group_id INTEGER NOT NULL,
    UNIQUE(item_id, modifier_group_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS menu_tax_links (
    link_id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    tax_group_id INTEGER NOT NULL,
    UNIQUE(item_id, tax_group_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS menu_printer_links (
    link_id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    printer_group_id INTEGER NOT NULL,
    UNIQUE(item_id, printer_group_id)
  )`);

  // --- 6. Business & Settings Tables ---
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

  db.run(`CREATE TABLE IF NOT EXISTS system_pins (
    id INTEGER PRIMARY KEY CHECK(id=1),
    backoffice_pin TEXT DEFAULT '0888',
    sales_pin TEXT DEFAULT '0000',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS printer_layout_settings (
    id INTEGER PRIMARY KEY CHECK(id=1),
    settings TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS layout_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    settings_data TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS business_hours (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day_of_week INTEGER NOT NULL,
    open_time TEXT,
    close_time TEXT,
    is_open INTEGER DEFAULT 1,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS channels (
    channel_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS employees (
    employee_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    channel_id INTEGER
  )`);

  // --- 7. Operational Tables ---
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

  db.run(`CREATE TABLE IF NOT EXISTS table_map_elements (
    element_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    x_pos INTEGER,
    y_pos INTEGER,
    width INTEGER,
    height INTEGER,
    rotation REAL DEFAULT 0,
    floor_id INTEGER DEFAULT 1,
    extra_data TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS sold_out_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    menu_id INTEGER NOT NULL,
    scope TEXT NOT NULL,
    key_id TEXT NOT NULL,
    soldout_type TEXT NOT NULL,
    end_time INTEGER NOT NULL,
    selector TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(menu_id, scope, key_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS OpenPrice_Lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    menu_id INTEGER,
    name_label TEXT NOT NULL,
    unit_price_entered REAL NOT NULL,
    price_source TEXT NOT NULL DEFAULT 'open',
    open_price_note TEXT,
    tax_group_id_at_sale INTEGER,
    printer_group_id_at_sale INTEGER,
    entered_by_user_id INTEGER,
    approved_by_user_id INTEGER,
    approved_flag INTEGER DEFAULT 0,
    approved_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // --- 8. Default Data Insertion ---
  console.log('Inserting bare minimum default data...');

  db.run("INSERT INTO business_profile (id, business_name) VALUES (1, 'New Restaurant')");
  db.run("INSERT INTO system_pins (id, backoffice_pin, sales_pin) VALUES (1, '0888', '0000')");
  
  const defaultPrinterSettings = {
    dineInKitchen: {
      kitchenPrinter: { title: "KITCHEN", showOrderType: true, showTableNumber: true, showOrderNumber: true, showTime: true, showItems: true },
      waitressPrinter: { title: "SERVER", showOrderType: true, showTableNumber: true, showOrderNumber: true, showTime: true, showItems: true }
    },
    externalKitchen: {
      kitchenPrinter: { title: "TAKEOUT", showOrderType: true, showOrderNumber: true, showCustomerInfo: true, showTime: true, showItems: true }
    }
  };
  db.run("INSERT INTO printer_layout_settings (id, settings) VALUES (1, ?)", [JSON.stringify(defaultPrinterSettings)]);

  db.run("INSERT INTO channels (channel_id, name) VALUES (1, 'POS')");
  db.run("INSERT INTO channels (channel_id, name) VALUES (2, 'TOGO')");
  db.run("INSERT INTO channels (channel_id, name) VALUES (3, 'ONLINE')");
  db.run("INSERT INTO channels (channel_id, name) VALUES (4, 'DELIVERY')");

  db.run("INSERT INTO employees (employee_id, name, pin_hash, role) VALUES (255000, 'Admin', '0000', 'Admin')");

  for (let i = 0; i < 7; i++) {
    db.run(`INSERT INTO business_hours (day_of_week, open_time, close_time, is_open) VALUES (${i}, '09:00', '22:00', 1)`);
  }

  console.log('✅ Clean DB initialized successfully!');
});

db.close((err) => {
  if (err) console.error('Error closing DB:', err.message);
  else console.log('--- Delivery DB Preparation Finished ---');
});
