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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    firebase_id TEXT
  )`);
  
  // Menu Categories
  db.run(`CREATE TABLE IF NOT EXISTS menu_categories (
    category_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    menu_id INTEGER NOT NULL,
    sort_order INTEGER DEFAULT 0,
    image_url TEXT,
    firebase_id TEXT,
    description TEXT,
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
    online_visible INTEGER DEFAULT 1,
    delivery_visible INTEGER DEFAULT 1,
    online_hide_type TEXT,
    online_available_until TEXT,
    delivery_hide_type TEXT,
    delivery_available_until TEXT,
    firebase_id TEXT,
    FOREIGN KEY (category_id) REFERENCES menu_categories(category_id) ON DELETE CASCADE,
    FOREIGN KEY (menu_id) REFERENCES menus(menu_id) ON DELETE CASCADE
  )`);
  
  // ====== Modifier Tables (Standardized) ======
  
  db.run(`CREATE TABLE IF NOT EXISTS modifier_groups (
    modifier_group_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    selection_type TEXT NOT NULL DEFAULT 'SINGLE',
    min_selection INTEGER DEFAULT 0,
    max_selection INTEGER DEFAULT 1,
    menu_id INTEGER,
    is_deleted INTEGER DEFAULT 0,
    firebase_id TEXT
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
  
  db.run(`CREATE TABLE IF NOT EXISTS menu_modifier_links (
    link_id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    modifier_group_id INTEGER NOT NULL,
    is_ambiguous INTEGER DEFAULT 0,
    UNIQUE (item_id, modifier_group_id)
  )`);
  
  // ====== Tax Tables (Standardized) ======
  
  db.run(`CREATE TABLE IF NOT EXISTS tax_groups (
    tax_group_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    menu_id INTEGER,
    is_deleted INTEGER DEFAULT 0,
    firebase_id TEXT
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
  
  db.run(`CREATE TABLE IF NOT EXISTS menu_tax_links (
    link_id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    tax_group_id INTEGER NOT NULL,
    is_ambiguous INTEGER DEFAULT 0,
    UNIQUE (item_id, tax_group_id)
  )`);
  
  // ====== Printer Tables (Standardized) ======
  
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
    show_label INTEGER DEFAULT 1,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    firebase_id TEXT
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS printer_group_links (
    printer_group_id INTEGER NOT NULL,
    printer_id INTEGER NOT NULL,
    copies INTEGER DEFAULT 1,
    PRIMARY KEY (printer_group_id, printer_id)
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS menu_printer_links (
    link_id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    printer_group_id INTEGER NOT NULL,
    is_ambiguous INTEGER DEFAULT 0,
    UNIQUE (item_id, printer_group_id)
  )`);
  
  // ====== Category Level Link Tables (Standardized) ======
  
  db.run(`CREATE TABLE IF NOT EXISTS category_modifier_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    modifier_group_id INTEGER NOT NULL,
    is_ambiguous INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(category_id, modifier_group_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS category_tax_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    tax_group_id INTEGER NOT NULL,
    is_ambiguous INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(category_id, tax_group_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS category_printer_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    printer_group_id INTEGER NOT NULL,
    is_ambiguous INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(category_id, printer_group_id)
  )`);
  
  // ====== Modifier Labels ======
  
  db.run(`CREATE TABLE IF NOT EXISTS modifier_labels (
    label_id INTEGER PRIMARY KEY,
    modifier_group_id INTEGER NOT NULL,
    label_name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (modifier_group_id) REFERENCES modifier_groups(modifier_group_id) ON DELETE CASCADE
  )`);

  // ====== App Settings ======
  
  db.run(`CREATE TABLE IF NOT EXISTS app_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL,
    description TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ====== Printer Layout Settings ======
  
  db.run(`CREATE TABLE IF NOT EXISTS printer_layout_settings (
    id INTEGER PRIMARY KEY CHECK(id=1),
    settings TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ====== Layout Settings ======
  
  db.run(`CREATE TABLE IF NOT EXISTS layout_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    settings_data TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ====== Table Move History ======
  
  db.run(`CREATE TABLE IF NOT EXISTS table_move_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_table_id TEXT NOT NULL,
    to_table_id TEXT NOT NULL,
    action_type TEXT NOT NULL CHECK(action_type IN ('MOVE', 'MERGE')),
    order_id INTEGER,
    from_order_id INTEGER,
    floor TEXT DEFAULT '1F',
    performed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    performed_by TEXT
  )`);

  // ====== Sold Out Records ======
  
  db.run(`CREATE TABLE IF NOT EXISTS sold_out_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    menu_id INTEGER NOT NULL,
    scope TEXT NOT NULL,
    key_id TEXT NOT NULL,
    soldout_type TEXT NOT NULL DEFAULT 'today',
    end_time INTEGER NOT NULL DEFAULT 0,
    selector TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(menu_id, scope, key_id)
  )`);

  // ====== Menu Item Colors ======
  
  db.run(`CREATE TABLE IF NOT EXISTS menu_item_colors (
    item_id TEXT PRIMARY KEY,
    color TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ====== Order Adjustments ======
  
  db.run(`CREATE TABLE IF NOT EXISTS order_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    kind TEXT,
    mode TEXT DEFAULT 'percent',
    value REAL DEFAULT 0,
    amount_applied REAL DEFAULT 0,
    label TEXT,
    applied_by_employee_id TEXT,
    applied_by_name TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  )`);

  // ====== Order Guest Status ======
  
  db.run(`CREATE TABLE IF NOT EXISTS order_guest_status (
    order_id INTEGER NOT NULL,
    guest_number INTEGER NOT NULL,
    status TEXT DEFAULT 'unpaid',
    locked INTEGER DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(order_id, guest_number)
  )`);

  // ====== Delivery Orders ======
  
  db.run(`CREATE TABLE IF NOT EXISTS delivery_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id TEXT,
    type TEXT,
    time TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    name TEXT,
    status TEXT,
    delivery_company TEXT,
    delivery_order_number TEXT,
    ready_time_label TEXT,
    prep_time TEXT,
    order_id INTEGER,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  )`);

  // ====== Daily Closings ======
  
  db.run(`CREATE TABLE IF NOT EXISTS daily_closings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    date TEXT,
    opening_cash REAL DEFAULT 0,
    closing_cash REAL DEFAULT 0,
    expected_cash REAL DEFAULT 0,
    cash_difference REAL DEFAULT 0,
    total_sales REAL DEFAULT 0,
    cash_sales REAL DEFAULT 0,
    card_sales REAL DEFAULT 0,
    other_sales REAL DEFAULT 0,
    tax_total REAL DEFAULT 0,
    order_count INTEGER DEFAULT 0,
    refund_total REAL DEFAULT 0,
    refund_count INTEGER DEFAULT 0,
    discount_total REAL DEFAULT 0,
    void_total REAL DEFAULT 0,
    void_count INTEGER DEFAULT 0,
    tip_total REAL DEFAULT 0,
    opened_at TEXT,
    closed_at TEXT,
    opened_by TEXT,
    closed_by TEXT,
    notes TEXT,
    opening_cash_details TEXT,
    closing_cash_details TEXT,
    status TEXT DEFAULT 'open',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS daily_closings_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    closing_date TEXT NOT NULL,
    closing_type TEXT DEFAULT 'day',
    shift_label TEXT,
    data TEXT,
    opened_at DATETIME,
    closed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS shift_closings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    shift_number INTEGER,
    shift_start TEXT,
    shift_end TEXT,
    closed_by TEXT,
    total_sales REAL DEFAULT 0,
    order_count INTEGER DEFAULT 0,
    cash_sales REAL DEFAULT 0,
    card_sales REAL DEFAULT 0,
    other_sales REAL DEFAULT 0,
    tip_total REAL DEFAULT 0,
    opening_cash REAL DEFAULT 0,
    expected_cash REAL DEFAULT 0,
    counted_cash REAL DEFAULT 0,
    cash_difference REAL DEFAULT 0,
    cash_details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ====== Admin Settings ======
  
  db.run(`CREATE TABLE IF NOT EXISTS admin_settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  // ====== Reservations ======
  
  db.run(`CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservation_number TEXT,
    customer_name TEXT,
    phone_number TEXT,
    reservation_date TEXT,
    reservation_time TEXT,
    party_size INTEGER DEFAULT 1,
    table_number TEXT,
    status TEXT DEFAULT 'confirmed',
    special_requests TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    channel TEXT,
    deposit_amount REAL DEFAULT 0,
    deposit_status TEXT,
    customer_email TEXT,
    tables_needed INTEGER DEFAULT 1,
    linked_order_id INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS table_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_number TEXT,
    table_name TEXT,
    is_reservable INTEGER DEFAULT 1,
    min_capacity INTEGER DEFAULT 1,
    max_capacity INTEGER DEFAULT 4,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS reservation_time_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time_slot TEXT NOT NULL UNIQUE,
    is_available INTEGER DEFAULT 1,
    max_reservations INTEGER DEFAULT 5,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS reservation_policy (
    id INTEGER PRIMARY KEY CHECK(id=1),
    peak_start TEXT,
    peak_end TEXT,
    peak_max_per_slot INTEGER DEFAULT 10,
    normal_max_per_slot INTEGER DEFAULT 5,
    no_show_grace_minutes INTEGER DEFAULT 15,
    online_quota_pct INTEGER DEFAULT 50,
    phone_quota_pct INTEGER DEFAULT 30,
    walkin_quota_pct INTEGER DEFAULT 20,
    dwell_minutes INTEGER DEFAULT 90,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ====== Sync & ID Mapping ======
  
  db.run(`CREATE TABLE IF NOT EXISTS sync_logs (
    sync_id TEXT PRIMARY KEY,
    sync_type TEXT NOT NULL,
    direction TEXT,
    entity_type TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    status TEXT NOT NULL DEFAULT 'started',
    total_items INTEGER DEFAULT 0,
    created_count INTEGER DEFAULT 0,
    updated_count INTEGER DEFAULT 0,
    deleted_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    errors TEXT,
    initiated_by TEXT,
    employee_id TEXT,
    device_id TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS sync_log_details (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_id TEXT,
    entity_type TEXT,
    local_id TEXT,
    firebase_id TEXT,
    action TEXT,
    status TEXT,
    old_data TEXT,
    new_data TEXT,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS id_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    firebase_id TEXT NOT NULL,
    local_id INTEGER NOT NULL,
    uuid TEXT,
    external_ids TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(entity_type, firebase_id)
  )`);

  // ====== OpenPrice Lines ======
  
  db.run(`CREATE TABLE IF NOT EXISTS OpenPrice_Lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    menu_id INTEGER,
    name_label TEXT,
    unit_price_entered REAL DEFAULT 0,
    price_source TEXT,
    open_price_note TEXT,
    tax_group_id_at_sale INTEGER,
    printer_group_id_at_sale INTEGER,
    entered_by_user_id TEXT,
    approved_by_user_id TEXT,
    approved_flag INTEGER DEFAULT 0,
    approved_at TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    country TEXT
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
    external_order_number TEXT,
    server_id TEXT,
    server_name TEXT,
    adjustments_json TEXT,
    order_source TEXT,
    guest_count INTEGER,
    fulfillment_mode TEXT,
    pickup_minutes INTEGER,
    firebase_order_id TEXT,
    kitchen_note TEXT,
    tax_rate REAL DEFAULT 0,
    tax_breakdown TEXT,
    order_mode TEXT,
    service_pattern TEXT
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
    item_source TEXT,
    modifiers_json TEXT,
    memo_json TEXT,
    discount_json TEXT,
    split_denominator INTEGER,
    split_numerator INTEGER,
    order_line_id TEXT,
    tax REAL DEFAULT 0,
    tax_rate REAL DEFAULT 0,
    togo_label INTEGER DEFAULT 0,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  )`);
  
  // ====== Payments ======
  
  db.run(`CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    payment_method TEXT NOT NULL,
    amount REAL NOT NULL,
    tip REAL DEFAULT 0,
    change_amount REAL DEFAULT 0,
    reference_number TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    guest_number INTEGER,
    status TEXT,
    ref TEXT,
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
    element_id TEXT PRIMARY KEY,
    floor TEXT DEFAULT '1F',
    type TEXT NOT NULL,
    x_pos REAL NOT NULL DEFAULT 0,
    y_pos REAL NOT NULL DEFAULT 0,
    width REAL,
    height REAL,
    rotation REAL DEFAULT 0,
    name TEXT,
    fontSize INTEGER DEFAULT 20,
    color TEXT DEFAULT '#3B82F6',
    status TEXT DEFAULT 'Available',
    current_order_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    guests INTEGER
  )`);
  
  // ====== Business Hours ======
  
  db.run(`CREATE TABLE IF NOT EXISTS business_hours (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day_of_week INTEGER NOT NULL,
    open_time TEXT,
    close_time TEXT,
    is_open INTEGER DEFAULT 1,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    break_start TEXT,
    break_end TEXT,
    happy_hour_start TEXT,
    happy_hour_end TEXT,
    busy_hour_start TEXT,
    busy_hour_end TEXT
  )`);
  
  // ====== Order Page Setups ======
  
  db.run(`CREATE TABLE IF NOT EXISTS order_page_setups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_type TEXT NOT NULL UNIQUE,
    menu_id INTEGER NOT NULL,
    menu_name TEXT NOT NULL,
    price_type TEXT DEFAULT 'price',
    created_at TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  
  // ====== System PINs ======
  
  db.run(`CREATE TABLE IF NOT EXISTS system_pins (
    id INTEGER PRIMARY KEY CHECK(id=1),
    backoffice_pin TEXT DEFAULT '1126',
    sales_pin TEXT DEFAULT '1126',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  // ====== POS Promotions ======
  db.run(`CREATE TABLE IF NOT EXISTS pos_promotions (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL, message TEXT, description TEXT,
    active INTEGER DEFAULT 1, min_order_amount REAL, discount_percent REAL, discount_amount REAL,
    valid_from TEXT, valid_until TEXT, channels TEXT, selected_items TEXT, selected_categories TEXT,
    free_item_id TEXT, free_item_name TEXT, buy_quantity INTEGER, get_quantity INTEGER,
    created_at TEXT, updated_at TEXT, synced_from_firebase INTEGER DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS discount_promotions (
    id TEXT PRIMARY KEY, name TEXT, code TEXT, start_date TEXT, end_date TEXT, start_time TEXT, end_time TEXT,
    mode TEXT, value REAL, min_subtotal REAL, eligible_item_ids TEXT, days_of_week TEXT,
    date_always INTEGER, time_always INTEGER, enabled INTEGER, created_at INTEGER, channels_json TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS free_item_promotions (
    id TEXT PRIMARY KEY, name TEXT, code TEXT, start_date TEXT, end_date TEXT, start_time TEXT, end_time TEXT,
    days_of_week TEXT, date_always INTEGER, time_always INTEGER, enabled INTEGER, created_at INTEGER,
    kind TEXT, free_item_id TEXT, free_qty INTEGER, min_subtotal REAL, eligible_item_ids TEXT
  )`);

  // ====== Voids & Refunds ======
  db.run(`CREATE TABLE IF NOT EXISTS voids (
    id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, subtotal REAL NOT NULL DEFAULT 0,
    tax_total REAL NOT NULL DEFAULT 0, grand_total REAL NOT NULL DEFAULT 0, reason TEXT, note TEXT,
    source TEXT NOT NULL DEFAULT 'partial', needs_approval INTEGER NOT NULL DEFAULT 0,
    approved_by TEXT, approved_at DATETIME, created_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS void_lines (
    id INTEGER PRIMARY KEY, void_id INTEGER NOT NULL, order_line_id INTEGER, menu_id INTEGER,
    name TEXT, qty REAL NOT NULL DEFAULT 0, amount REAL NOT NULL DEFAULT 0, tax REAL NOT NULL DEFAULT 0,
    printer_group_id INTEGER
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS void_policy (
    id INTEGER PRIMARY KEY, approval_threshold REAL NOT NULL DEFAULT 0, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS refunds (
    id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, original_order_number TEXT,
    refund_type TEXT DEFAULT 'FULL', subtotal REAL DEFAULT 0, tax REAL DEFAULT 0, total REAL DEFAULT 0,
    payment_method TEXT, refunded_by TEXT, refunded_by_pin TEXT, reason TEXT, notes TEXT,
    status TEXT DEFAULT 'COMPLETED', created_at TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS refund_items (
    id INTEGER PRIMARY KEY, refund_id INTEGER NOT NULL, order_item_id INTEGER, item_name TEXT,
    quantity INTEGER DEFAULT 1, unit_price REAL DEFAULT 0, total_price REAL DEFAULT 0, tax REAL DEFAULT 0
  )`);

  // ====== Printer Jobs ======
  db.run(`CREATE TABLE IF NOT EXISTS printer_jobs (
    id INTEGER PRIMARY KEY, type TEXT NOT NULL, station TEXT, payload_json TEXT,
    status TEXT NOT NULL DEFAULT 'queued', error TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, sent_at DATETIME
  )`);

  // ====== Gift Cards ======
  db.run(`CREATE TABLE IF NOT EXISTS gift_cards (
    id INTEGER PRIMARY KEY, card_number TEXT NOT NULL, initial_amount REAL NOT NULL,
    current_balance REAL NOT NULL, payment_method TEXT, customer_name TEXT, customer_phone TEXT,
    sold_by TEXT, status TEXT DEFAULT 'active', created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS gift_card_transactions (
    id INTEGER PRIMARY KEY, card_number TEXT NOT NULL, transaction_type TEXT NOT NULL,
    amount REAL NOT NULL, balance_after REAL NOT NULL, order_id INTEGER, notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // ====== Delivery Channel Settings ======
  db.run(`CREATE TABLE IF NOT EXISTS delivery_channel_settings (
    channel_id TEXT PRIMARY KEY, channel_name TEXT NOT NULL, enabled INTEGER DEFAULT 0,
    api_key TEXT, api_secret TEXT, merchant_id TEXT, store_id TEXT, webhook_url TEXT,
    settings_json TEXT DEFAULT '{}', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // ====== Online Order Settings ======
  db.run(`CREATE TABLE IF NOT EXISTS online_day_off (
    id INTEGER PRIMARY KEY, date TEXT NOT NULL, channels TEXT DEFAULT 'all', type TEXT DEFAULT 'closed',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS online_pause_settings (
    id INTEGER PRIMARY KEY, channel TEXT NOT NULL, paused INTEGER DEFAULT 0, paused_until TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS online_prep_time_settings (
    id INTEGER PRIMARY KEY, channel TEXT NOT NULL, mode TEXT DEFAULT 'auto', time TEXT DEFAULT '15',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // ====== Table Orders (Tablet) ======
  db.run(`CREATE TABLE IF NOT EXISTS table_orders (
    id INTEGER PRIMARY KEY, order_id TEXT NOT NULL, store_id TEXT NOT NULL, table_id TEXT NOT NULL,
    table_label TEXT, status TEXT DEFAULT 'pending', items_json TEXT, subtotal REAL DEFAULT 0,
    tax_total REAL DEFAULT 0, total REAL DEFAULT 0, customer_note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS table_order_settings (
    id INTEGER PRIMARY KEY, store_id TEXT NOT NULL, auto_kitchen_print INTEGER DEFAULT 1,
    auto_accept_order INTEGER DEFAULT 0, allow_payment INTEGER DEFAULT 0, default_menu_id INTEGER,
    theme TEXT DEFAULT 'light', language TEXT DEFAULT 'en',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS registered_devices (
    id INTEGER PRIMARY KEY, device_id TEXT NOT NULL, device_name TEXT,
    device_type TEXT DEFAULT 'table_order', assigned_table_id TEXT, assigned_table_label TEXT,
    store_id TEXT DEFAULT 'default', status TEXT DEFAULT 'pending', app_version TEXT, os_version TEXT,
    ip_address TEXT, mac_address TEXT, battery_level INTEGER, is_charging INTEGER DEFAULT 0,
    last_seen_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ====== Table Map Screen Settings ======
  db.run(`CREATE TABLE IF NOT EXISTS table_map_screen_settings (
    id INTEGER PRIMARY KEY, floor TEXT NOT NULL, width INTEGER NOT NULL DEFAULT 1024,
    height INTEGER NOT NULL DEFAULT 768, scale REAL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ====== Reservation Settings ======
  db.run(`CREATE TABLE IF NOT EXISTS reservation_settings (
    id INTEGER PRIMARY KEY, minimum_guests INTEGER DEFAULT 1, maximum_guests INTEGER DEFAULT 10,
    minimum_time_in_advance INTEGER DEFAULT 1, maximum_time_in_advance INTEGER DEFAULT 30,
    hold_table_for_late_guests INTEGER DEFAULT 15, max_reservation_table INTEGER DEFAULT 10,
    reservation_interval INTEGER DEFAULT 30,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ====== Audit Logs ======
  db.run(`CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL,
    payload_json TEXT, user_id TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // ====== Waiting List ======
  db.run(`CREATE TABLE IF NOT EXISTS waiting_list (
    id INTEGER PRIMARY KEY, customer_name TEXT NOT NULL, phone_number TEXT, party_size INTEGER NOT NULL,
    notes TEXT, status TEXT NOT NULL DEFAULT 'waiting', table_number TEXT, reservation_id INTEGER,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP, notified_at DATETIME, seated_at DATETIME,
    cancelled_at DATETIME, expires_at DATETIME, sms_count INTEGER NOT NULL DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS waiting_list_archive (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_date TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    phone_number TEXT,
    party_size INTEGER NOT NULL,
    notes TEXT,
    outcome TEXT NOT NULL,
    table_number TEXT,
    joined_at TEXT,
    archived_at TEXT NOT NULL,
    source_waiting_id INTEGER
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
  
  // Default admin (PIN: 1126)
  db.run("INSERT INTO employees (employee_id, name, pin_hash, role) VALUES (5200, 'Admin', '1126', 'Admin')");
  
  // Default business hours (Mon-Sun, 9AM-9PM)
  for (let i = 0; i < 7; i++) {
    db.run(`INSERT INTO business_hours (day_of_week, open_time, close_time, is_open) VALUES (${i}, '09:00', '21:00', 1)`);
  }
  
  // Default system PINs (BackOffice + Sales: 1126)
  db.run("INSERT INTO system_pins (id, backoffice_pin, sales_pin) VALUES (1, '1126', '1126')");
  
  // ====== Default Tax Data ======
  
  // Default Taxes
  db.run("INSERT INTO taxes (tax_id, name, rate, menu_id, is_deleted) VALUES (380000, 'Sales Tax', 8.875, NULL, 0)");
  db.run("INSERT INTO taxes (tax_id, name, rate, menu_id, is_deleted) VALUES (380001, 'GST', 5.0, NULL, 0)");
  db.run("INSERT INTO taxes (tax_id, name, rate, menu_id, is_deleted) VALUES (380002, 'PST', 7.0, NULL, 0)");
  db.run("INSERT INTO taxes (tax_id, name, rate, menu_id, is_deleted) VALUES (380003, 'HST', 13.0, NULL, 0)");
  
  // Default Tax Groups
  db.run("INSERT INTO tax_groups (tax_group_id, name, menu_id, is_deleted) VALUES (385000, 'US Sales Tax', NULL, 0)");
  db.run("INSERT INTO tax_groups (tax_group_id, name, menu_id, is_deleted) VALUES (385001, 'Canadian GST+PST', NULL, 0)");
  db.run("INSERT INTO tax_groups (tax_group_id, name, menu_id, is_deleted) VALUES (385002, 'Canadian HST', NULL, 0)");
  
  // Tax Group Links
  db.run("INSERT INTO tax_group_links (tax_group_id, tax_id) VALUES (385000, 380000)");   // US Sales Tax → Sales Tax 8.875%
  db.run("INSERT INTO tax_group_links (tax_group_id, tax_id) VALUES (385001, 380001)");   // Canadian GST+PST → GST 5%
  db.run("INSERT INTO tax_group_links (tax_group_id, tax_id) VALUES (385001, 380002)");   // Canadian GST+PST → PST 7%
  db.run("INSERT INTO tax_group_links (tax_group_id, tax_id) VALUES (385002, 380003)");   // Canadian HST → HST 13%
  
  console.log('✅ Empty database created successfully!');
  console.log('✅ Default data inserted (Admin PIN: 1126)');
  console.log('✅ Default tax groups created: US Sales Tax, Canadian GST+PST, Canadian HST');
});

db.close((err) => {
  if (err) {
    console.error('Error closing database:', err);
  } else {
    console.log('✅ Database file saved to:', dbPath);
  }
});
