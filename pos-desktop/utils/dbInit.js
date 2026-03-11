// backend/utils/dbInit.js
const sqlite3 = require('sqlite3').verbose();

/**
 * Initializes and standardizes the database schema.
 * This is the SINGLE SOURCE OF TRUTH for the database structure.
 */
async function initDatabase(db) {
  const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

  const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

  console.log('[dbInit] Starting database standardization...');

  try {
    // 1. MODIFIER TABLES
    await dbRun(`CREATE TABLE IF NOT EXISTS modifier_groups (
      modifier_group_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      selection_type TEXT NOT NULL DEFAULT 'SINGLE',
      min_selection INTEGER DEFAULT 0,
      max_selection INTEGER DEFAULT 1,
      menu_id INTEGER,
      is_deleted INTEGER DEFAULT 0
    )`);

    // Migration for modifier_groups: group_id -> modifier_group_id
    const mgCols = await dbAll("PRAGMA table_info(modifier_groups)");
    const mgColNames = mgCols.map(c => String(c.name));
    if (mgColNames.includes('group_id') && !mgColNames.includes('modifier_group_id')) {
      try {
        await dbRun("ALTER TABLE modifier_groups RENAME COLUMN group_id TO modifier_group_id");
        console.log('[dbInit] Migrated modifier_groups: group_id -> modifier_group_id');
      } catch (e) { console.error(e.message); }
    }
    // Migration: Add missing columns to modifier_groups
    if (!mgColNames.includes('menu_id')) {
      try {
        await dbRun("ALTER TABLE modifier_groups ADD COLUMN menu_id INTEGER");
        console.log('[dbInit] Added menu_id column to modifier_groups');
      } catch (e) { console.error('[dbInit] modifier_groups menu_id:', e.message); }
    }
    if (!mgColNames.includes('is_deleted')) {
      try {
        await dbRun("ALTER TABLE modifier_groups ADD COLUMN is_deleted INTEGER DEFAULT 0");
        console.log('[dbInit] Added is_deleted column to modifier_groups');
      } catch (e) { console.error('[dbInit] modifier_groups is_deleted:', e.message); }
    }
    if (!mgColNames.includes('min_selection')) {
      try {
        await dbRun("ALTER TABLE modifier_groups ADD COLUMN min_selection INTEGER DEFAULT 0");
        console.log('[dbInit] Added min_selection column to modifier_groups');
      } catch (e) { console.error('[dbInit] modifier_groups min_selection:', e.message); }
    }
    if (!mgColNames.includes('max_selection')) {
      try {
        await dbRun("ALTER TABLE modifier_groups ADD COLUMN max_selection INTEGER DEFAULT 1");
        console.log('[dbInit] Added max_selection column to modifier_groups');
      } catch (e) { console.error('[dbInit] modifier_groups max_selection:', e.message); }
    }
    if (!mgColNames.includes('selection_type')) {
      try {
        await dbRun("ALTER TABLE modifier_groups ADD COLUMN selection_type TEXT NOT NULL DEFAULT 'SINGLE'");
        console.log('[dbInit] Added selection_type column to modifier_groups');
      } catch (e) { console.error('[dbInit] modifier_groups selection_type:', e.message); }
    }

    await dbRun(`CREATE TABLE IF NOT EXISTS modifiers (
      modifier_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      price_delta REAL DEFAULT 0,
      price_delta2 REAL DEFAULT 0,
      type TEXT NOT NULL DEFAULT 'OPTION',
      is_deleted INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0
    )`);

    // Migration: Add price_delta2 column to modifiers if missing
    const modCols = await dbAll("PRAGMA table_info(modifiers)");
    const modColNames = modCols.map(c => String(c.name));
    if (!modColNames.includes('price_delta2')) {
      try {
        await dbRun("ALTER TABLE modifiers ADD COLUMN price_delta2 REAL DEFAULT 0");
        console.log('[dbInit] Added price_delta2 column to modifiers');
      } catch (e) { console.error('[dbInit] price_delta2 migration:', e.message); }
    }
    if (!modColNames.includes('sort_order')) {
      try {
        await dbRun("ALTER TABLE modifiers ADD COLUMN sort_order INTEGER DEFAULT 0");
        console.log('[dbInit] Added sort_order column to modifiers');
      } catch (e) { console.error('[dbInit] sort_order migration:', e.message); }
    }
    if (!modColNames.includes('is_deleted')) {
      try {
        await dbRun("ALTER TABLE modifiers ADD COLUMN is_deleted INTEGER DEFAULT 0");
        console.log('[dbInit] Added is_deleted column to modifiers');
      } catch (e) { console.error('[dbInit] is_deleted migration:', e.message); }
    }
    if (!modColNames.includes('button_color')) {
      try {
        await dbRun("ALTER TABLE modifiers ADD COLUMN button_color TEXT DEFAULT NULL");
        console.log('[dbInit] Added button_color column to modifiers');
      } catch (e) { console.error('[dbInit] button_color migration:', e.message); }
    }

    await dbRun(`CREATE TABLE IF NOT EXISTS modifier_group_links (
      modifier_group_id INTEGER NOT NULL,
      modifier_id INTEGER NOT NULL,
      PRIMARY KEY (modifier_group_id, modifier_id)
    )`);

    // 2. TAX TABLES
    await dbRun(`CREATE TABLE IF NOT EXISTS tax_groups (
      tax_group_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      menu_id INTEGER,
      is_deleted INTEGER DEFAULT 0
    )`);

    // Migration for tax_groups: group_id -> tax_group_id
    const tgCols = await dbAll("PRAGMA table_info(tax_groups)");
    const tgColNames = tgCols.map(c => String(c.name));
    if (tgColNames.includes('group_id') && !tgColNames.includes('tax_group_id')) {
      try {
        await dbRun("ALTER TABLE tax_groups RENAME COLUMN group_id TO tax_group_id");
        console.log('[dbInit] Migrated tax_groups: group_id -> tax_group_id');
      } catch (e) { console.error(e.message); }
    }

    await dbRun(`CREATE TABLE IF NOT EXISTS taxes (
      tax_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      rate REAL NOT NULL DEFAULT 0,
      menu_id INTEGER,
      is_deleted INTEGER DEFAULT 0
    )`);

    // Migration: Add missing columns to taxes table
    const taxCols = await dbAll("PRAGMA table_info(taxes)");
    const taxColNames = taxCols.map(c => String(c.name));
    if (!taxColNames.includes('menu_id')) {
      try {
        await dbRun("ALTER TABLE taxes ADD COLUMN menu_id INTEGER");
        console.log('[dbInit] Added menu_id column to taxes');
      } catch (e) { console.error('[dbInit] taxes menu_id:', e.message); }
    }
    if (!taxColNames.includes('is_deleted')) {
      try {
        await dbRun("ALTER TABLE taxes ADD COLUMN is_deleted INTEGER DEFAULT 0");
        console.log('[dbInit] Added is_deleted column to taxes');
      } catch (e) { console.error('[dbInit] taxes is_deleted:', e.message); }
    }

    // Migration: Add missing columns to tax_groups table
    if (!tgColNames.includes('menu_id')) {
      try {
        await dbRun("ALTER TABLE tax_groups ADD COLUMN menu_id INTEGER");
        console.log('[dbInit] Added menu_id column to tax_groups');
      } catch (e) { console.error('[dbInit] tax_groups menu_id:', e.message); }
    }
    if (!tgColNames.includes('is_deleted')) {
      try {
        await dbRun("ALTER TABLE tax_groups ADD COLUMN is_deleted INTEGER DEFAULT 0");
        console.log('[dbInit] Added is_deleted column to tax_groups');
      } catch (e) { console.error('[dbInit] tax_groups is_deleted:', e.message); }
    }

    await dbRun(`CREATE TABLE IF NOT EXISTS tax_group_links (
      tax_group_id INTEGER NOT NULL,
      tax_id INTEGER NOT NULL,
      PRIMARY KEY (tax_group_id, tax_id)
    )`);

    // Migration for tax_group_links: group_id -> tax_group_id
    const tglCols = await dbAll("PRAGMA table_info(tax_group_links)");
    const tglColNames = tglCols.map(c => String(c.name));
    if (tglColNames.includes('group_id') && !tglColNames.includes('tax_group_id')) {
      try {
        await dbRun("ALTER TABLE tax_group_links RENAME COLUMN group_id TO tax_group_id");
        console.log('[dbInit] Migrated tax_group_links: group_id -> tax_group_id');
      } catch (e) { console.error(e.message); }
    }

    // 3. PRINTER TABLES
    // Note: Removed AUTOINCREMENT to enforce idGenerator usage
    await dbRun(`CREATE TABLE IF NOT EXISTS printers (
      printer_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      type TEXT DEFAULT '',
      selected_printer TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Migration for printers: id -> printer_id
    const pCols = await dbAll("PRAGMA table_info(printers)");
    const pColNames = pCols.map(c => String(c.name));
    if (pColNames.includes('id') && !pColNames.includes('printer_id')) {
      try {
        await dbRun("ALTER TABLE printers RENAME COLUMN id TO printer_id");
        console.log('[dbInit] Migrated printers: id -> printer_id');
      } catch (e) { console.error(e.message); }
    }

    await dbRun(`CREATE TABLE IF NOT EXISTS printer_groups (
      printer_group_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      menu_id INTEGER,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Migration for printer_groups: id -> printer_group_id, add menu_id, show_label
    const pgCols = await dbAll("PRAGMA table_info(printer_groups)");
    const pgColNames = pgCols.map(c => String(c.name));
    if (pgColNames.includes('id') && !pgColNames.includes('printer_group_id')) {
      try {
        await dbRun("ALTER TABLE printer_groups RENAME COLUMN id TO printer_group_id");
        console.log('[dbInit] Migrated printer_groups: id -> printer_group_id');
      } catch (e) { console.error(e.message); }
    }
    if (!pgColNames.includes('menu_id')) {
      try {
        await dbRun("ALTER TABLE printer_groups ADD COLUMN menu_id INTEGER");
        console.log('[dbInit] Added menu_id to printer_groups');
      } catch (e) { console.error(e.message); }
    }
    if (!pgColNames.includes('show_label')) {
      try {
        await dbRun("ALTER TABLE printer_groups ADD COLUMN show_label INTEGER DEFAULT 1");
        console.log('[dbInit] Added show_label to printer_groups');
      } catch (e) { console.error(e.message); }
    }

    await dbRun(`CREATE TABLE IF NOT EXISTS printer_group_links (
      printer_group_id INTEGER NOT NULL,
      printer_id INTEGER NOT NULL,
      PRIMARY KEY (printer_group_id, printer_id)
    )`);

    // Migration for printer_group_links: group_id -> printer_group_id, add copies
    const pglCols = await dbAll("PRAGMA table_info(printer_group_links)");
    const pglColNames = pglCols.map(c => String(c.name));
    if (pglColNames.includes('group_id') && !pglColNames.includes('printer_group_id')) {
      try {
        await dbRun("ALTER TABLE printer_group_links RENAME COLUMN group_id TO printer_group_id");
        console.log('[dbInit] Migrated printer_group_links: group_id -> printer_group_id');
      } catch (e) { console.error(e.message); }
    }
    // Add copies column for print quantity per printer in group
    if (!pglColNames.includes('copies')) {
      try {
        await dbRun("ALTER TABLE printer_group_links ADD COLUMN copies INTEGER DEFAULT 1");
        console.log('[dbInit] Added copies column to printer_group_links');
      } catch (e) { console.error(e.message); }
    }

    // 4. CATEGORY & ITEM LINK TABLES
    await dbRun(`CREATE TABLE IF NOT EXISTS category_modifier_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      modifier_group_id INTEGER NOT NULL,
      is_ambiguous INTEGER DEFAULT 0,
      UNIQUE(category_id, modifier_group_id)
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS category_tax_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      tax_group_id INTEGER NOT NULL,
      is_ambiguous INTEGER DEFAULT 0,
      UNIQUE(category_id, tax_group_id)
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS category_printer_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      printer_group_id INTEGER NOT NULL,
      is_ambiguous INTEGER DEFAULT 0,
      UNIQUE(category_id, printer_group_id)
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS menu_modifier_links (
      link_id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      modifier_group_id INTEGER NOT NULL,
      is_ambiguous INTEGER DEFAULT 0,
      UNIQUE(item_id, modifier_group_id)
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS menu_tax_links (
      link_id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      tax_group_id INTEGER NOT NULL,
      is_ambiguous INTEGER DEFAULT 0,
      UNIQUE(item_id, tax_group_id)
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS menu_printer_links (
      link_id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      printer_group_id INTEGER NOT NULL,
      is_ambiguous INTEGER DEFAULT 0,
      UNIQUE(item_id, printer_group_id)
    )`);

    // Migration: Add is_ambiguous column to link tables if missing
    const addAmbiguousColumn = async (tableName) => {
      const cols = await dbAll(`PRAGMA table_info(${tableName})`);
      const colNames = cols.map(c => String(c.name));
      if (!colNames.includes('is_ambiguous')) {
        try {
          await dbRun(`ALTER TABLE ${tableName} ADD COLUMN is_ambiguous INTEGER DEFAULT 0`);
          console.log(`[dbInit] Added is_ambiguous column to ${tableName}`);
        } catch (e) { console.error(e.message); }
      }
    };
    await addAmbiguousColumn('menu_modifier_links');
    await addAmbiguousColumn('menu_tax_links');
    await addAmbiguousColumn('menu_printer_links');

    // Migration: Add sort_order column to modifier link tables for user-defined ordering
    const addSortOrderColumn = async (tableName) => {
      const cols = await dbAll(`PRAGMA table_info(${tableName})`);
      const colNames = cols.map(c => String(c.name));
      if (!colNames.includes('sort_order')) {
        try {
          await dbRun(`ALTER TABLE ${tableName} ADD COLUMN sort_order INTEGER DEFAULT 0`);
          console.log(`[dbInit] Added sort_order column to ${tableName}`);
        } catch (e) { console.error(e.message); }
      }
    };
    await addSortOrderColumn('menu_modifier_links');
    await addSortOrderColumn('category_modifier_links');

    // 5. APP SETTINGS (시스템 설정)
    await dbRun(`CREATE TABLE IF NOT EXISTS app_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL,
      description TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 초기 설정값 설정 (없을 경우만)
    const defaultSettings = [
      { key: 'api_url', value: 'http://localhost:3177/api', desc: 'API 서버 URL' },
      { key: 'api_base', value: 'http://localhost:3177', desc: 'API Base URL (이미지 등에 사용)' },
      { key: 'backend_port', value: '3177', desc: '백엔드 서버 포트' }
    ];

    for (const setting of defaultSettings) {
      const existing = await dbGet('SELECT setting_key FROM app_settings WHERE setting_key = ?', [setting.key]);
      if (!existing) {
        await dbRun(
          'INSERT INTO app_settings (setting_key, setting_value, description) VALUES (?, ?, ?)',
          [setting.key, setting.value, setting.desc]
        );
        console.log(`[dbInit] Initialized app setting: ${setting.key} = ${setting.value}`);
      }
    }

    // 6. MODIFIER LABELS
    await dbRun(`CREATE TABLE IF NOT EXISTS modifier_labels (
      label_id INTEGER PRIMARY KEY,
      modifier_group_id INTEGER NOT NULL,
      label_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (modifier_group_id) REFERENCES modifier_groups(modifier_group_id) ON DELETE CASCADE
    )`);

    // Migration for modifier_labels: group_id -> modifier_group_id
    const mlCols = await dbAll("PRAGMA table_info(modifier_labels)");
    const mlColNames = mlCols.map(c => String(c.name));
    if (mlColNames.includes('group_id') && !mlColNames.includes('modifier_group_id')) {
      try {
        await dbRun("ALTER TABLE modifier_labels RENAME COLUMN group_id TO modifier_group_id");
        console.log('[dbInit] Migrated modifier_labels: group_id -> modifier_group_id');
      } catch (e) { console.error(e.message); }
    }

    // 7. TABLE MAP ELEMENTS
    await dbRun(`CREATE TABLE IF NOT EXISTS table_map_elements (
      element_id TEXT PRIMARY KEY,
      floor TEXT DEFAULT '1F',
      type TEXT NOT NULL,
      x_pos REAL NOT NULL,
      y_pos REAL NOT NULL,
      width REAL NOT NULL,
      height REAL NOT NULL,
      rotation REAL DEFAULT 0,
      name TEXT DEFAULT '',
      fontSize REAL DEFAULT 20,
      color TEXT DEFAULT '#3B82F6',
      status TEXT DEFAULT 'Available',
      current_order_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    console.log('[dbInit] table_map_elements table ensured');

    // 7-1. table_map_elements 마이그레이션 (기존 빌드 스키마에서 누락된 컬럼 추가)
    const tmeCols = await dbAll("PRAGMA table_info(table_map_elements)");
    const tmeColNames = tmeCols.map(c => c.name);
    if (!tmeColNames.includes('floor')) {
      try { await dbRun("ALTER TABLE table_map_elements ADD COLUMN floor TEXT DEFAULT '1F'"); console.log('[dbInit] Added floor to table_map_elements'); } catch (e) { console.error(e.message); }
    }
    if (!tmeColNames.includes('rotation')) {
      try { await dbRun("ALTER TABLE table_map_elements ADD COLUMN rotation REAL DEFAULT 0"); console.log('[dbInit] Added rotation to table_map_elements'); } catch (e) { console.error(e.message); }
    }
    if (!tmeColNames.includes('fontSize')) {
      try { await dbRun("ALTER TABLE table_map_elements ADD COLUMN fontSize REAL DEFAULT 20"); console.log('[dbInit] Added fontSize to table_map_elements'); } catch (e) { console.error(e.message); }
    }
    if (!tmeColNames.includes('color')) {
      try { await dbRun("ALTER TABLE table_map_elements ADD COLUMN color TEXT DEFAULT '#3B82F6'"); console.log('[dbInit] Added color to table_map_elements'); } catch (e) { console.error(e.message); }
    }
    if (!tmeColNames.includes('status')) {
      try { await dbRun("ALTER TABLE table_map_elements ADD COLUMN status TEXT DEFAULT 'Available'"); console.log('[dbInit] Added status to table_map_elements'); } catch (e) { console.error(e.message); }
    }
    if (!tmeColNames.includes('current_order_id')) {
      try { await dbRun("ALTER TABLE table_map_elements ADD COLUMN current_order_id INTEGER"); console.log('[dbInit] Added current_order_id to table_map_elements'); } catch (e) { console.error(e.message); }
    }
    if (!tmeColNames.includes('created_at')) {
      try { await dbRun("ALTER TABLE table_map_elements ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP"); console.log('[dbInit] Added created_at to table_map_elements'); } catch (e) { console.error(e.message); }
    }

    // 8. TABLE MOVE HISTORY (Move/Merge 기능에 필요)
    await dbRun(`CREATE TABLE IF NOT EXISTS table_move_history (
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
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_table_move_history_tables 
      ON table_move_history(from_table_id, to_table_id)`);
    console.log('[dbInit] table_move_history table ensured');

    // 9. ORDERS & PAYMENTS (기본 테이블)
    await dbRun(`CREATE TABLE IF NOT EXISTS orders (
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
      service_charge REAL DEFAULT 0
    )`);

    // orders 테이블 컬럼 마이그레이션 (기존 DB 호환)
    const ordersColInfo = await dbAll("PRAGMA table_info(orders)");
    const ordersColNames = ordersColInfo.map(c => c.name);
    const ordersMigrations = [
      { col: 'server_id', sql: "ALTER TABLE orders ADD COLUMN server_id TEXT" },
      { col: 'server_name', sql: "ALTER TABLE orders ADD COLUMN server_name TEXT" },
      { col: 'adjustments_json', sql: "ALTER TABLE orders ADD COLUMN adjustments_json TEXT" },
      { col: 'order_source', sql: "ALTER TABLE orders ADD COLUMN order_source TEXT" },
      { col: 'guest_count', sql: "ALTER TABLE orders ADD COLUMN guest_count INTEGER" },
      { col: 'fulfillment_mode', sql: "ALTER TABLE orders ADD COLUMN fulfillment_mode TEXT" },
      { col: 'pickup_minutes', sql: "ALTER TABLE orders ADD COLUMN pickup_minutes INTEGER" },
      { col: 'firebase_order_id', sql: "ALTER TABLE orders ADD COLUMN firebase_order_id TEXT" },
      { col: 'kitchen_note', sql: "ALTER TABLE orders ADD COLUMN kitchen_note TEXT" },
      { col: 'tax_rate', sql: "ALTER TABLE orders ADD COLUMN tax_rate REAL DEFAULT 0" },
      { col: 'tax_breakdown', sql: "ALTER TABLE orders ADD COLUMN tax_breakdown TEXT" },
      { col: 'order_mode', sql: "ALTER TABLE orders ADD COLUMN order_mode TEXT" },
      { col: 'service_charge', sql: "ALTER TABLE orders ADD COLUMN service_charge REAL DEFAULT 0" },
    ];
    for (const m of ordersMigrations) {
      if (!ordersColNames.includes(m.col)) {
        try { await dbRun(m.sql); console.log(`[dbInit] Added ${m.col} to orders`); } catch (e) { console.error(`[dbInit] orders.${m.col}:`, e.message); }
      }
    }
    console.log('[dbInit] orders table ensured with all columns');

    await dbRun(`CREATE TABLE IF NOT EXISTS order_items (
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
      order_line_id TEXT,
      tax REAL DEFAULT 0,
      tax_rate REAL DEFAULT 0,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    )`);

    // order_items 컬럼 마이그레이션
    const oiColInfo = await dbAll("PRAGMA table_info(order_items)");
    const oiColNames = oiColInfo.map(c => c.name);
    const oiMigrations = [
      { col: 'item_source', sql: "ALTER TABLE order_items ADD COLUMN item_source TEXT" },
      { col: 'modifiers_json', sql: "ALTER TABLE order_items ADD COLUMN modifiers_json TEXT" },
      { col: 'memo_json', sql: "ALTER TABLE order_items ADD COLUMN memo_json TEXT" },
      { col: 'discount_json', sql: "ALTER TABLE order_items ADD COLUMN discount_json TEXT" },
      { col: 'split_denominator', sql: "ALTER TABLE order_items ADD COLUMN split_denominator INTEGER" },
      { col: 'order_line_id', sql: "ALTER TABLE order_items ADD COLUMN order_line_id TEXT" },
      { col: 'tax', sql: "ALTER TABLE order_items ADD COLUMN tax REAL DEFAULT 0" },
      { col: 'tax_rate', sql: "ALTER TABLE order_items ADD COLUMN tax_rate REAL DEFAULT 0" },
    ];
    for (const m of oiMigrations) {
      if (!oiColNames.includes(m.col)) {
        try { await dbRun(m.sql); console.log(`[dbInit] Added ${m.col} to order_items`); } catch (e) { console.error(`[dbInit] order_items.${m.col}:`, e.message); }
      }
    }
    console.log('[dbInit] order_items table ensured with all columns');

    await dbRun(`CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      payment_method TEXT NOT NULL,
      amount REAL NOT NULL,
      tip REAL DEFAULT 0,
      ref TEXT,
      status TEXT DEFAULT 'APPROVED',
      reference_number TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      guest_number INTEGER,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    )`);

    // payments 테이블 컬럼 마이그레이션 (기존 DB 호환)
    const paymentsColInfo = await dbAll("PRAGMA table_info(payments)");
    const paymentsColNames = paymentsColInfo.map(c => c.name);
    if (!paymentsColNames.includes('ref')) {
      try { await dbRun("ALTER TABLE payments ADD COLUMN ref TEXT"); console.log('[dbInit] Added ref to payments'); } catch (e) { console.error('[dbInit] payments.ref:', e.message); }
    }
    if (!paymentsColNames.includes('status')) {
      try { await dbRun("ALTER TABLE payments ADD COLUMN status TEXT DEFAULT 'APPROVED'"); console.log('[dbInit] Added status to payments'); } catch (e) { console.error('[dbInit] payments.status:', e.message); }
    }
    if (!paymentsColNames.includes('guest_number')) {
      try { await dbRun("ALTER TABLE payments ADD COLUMN guest_number INTEGER"); console.log('[dbInit] Added guest_number to payments'); } catch (e) { console.error('[dbInit] payments.guest_number:', e.message); }
    }

    // Tips are NOT part of sales revenue; store them separately
    await dbRun(`CREATE TABLE IF NOT EXISTS tips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      employee_id TEXT,
      guest_number INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS order_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      kind TEXT,
      mode TEXT DEFAULT 'percent',
      value REAL DEFAULT 0,
      amount_applied REAL DEFAULT 0,
      label TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    )`);

    // order_adjustments 컬럼 마이그레이션 (기존 DB 호환)
    const oaCols = await dbAll("PRAGMA table_info(order_adjustments)");
    const oaColNames = oaCols.map(c => c.name);
    if (!oaColNames.includes('kind')) {
      try { await dbRun("ALTER TABLE order_adjustments ADD COLUMN kind TEXT"); console.log('[dbInit] Added kind to order_adjustments'); } catch (e) { console.error(e.message); }
    }
    if (!oaColNames.includes('amount_applied')) {
      try { await dbRun("ALTER TABLE order_adjustments ADD COLUMN amount_applied REAL DEFAULT 0"); console.log('[dbInit] Added amount_applied to order_adjustments'); } catch (e) { console.error(e.message); }
    }
    if (!oaColNames.includes('label')) {
      try { await dbRun("ALTER TABLE order_adjustments ADD COLUMN label TEXT"); console.log('[dbInit] Added label to order_adjustments'); } catch (e) { console.error(e.message); }
    }

    await dbRun(`CREATE TABLE IF NOT EXISTS order_guest_status (
      order_id INTEGER NOT NULL,
      guest_number INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'UNPAID',
      locked INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY(order_id, guest_number)
    )`);

    // order_guest_status 컬럼 마이그레이션 (기존 DB 호환)
    const ogsCols = await dbAll("PRAGMA table_info(order_guest_status)");
    const ogsColNames = ogsCols.map(c => c.name);
    if (!ogsColNames.includes('locked')) {
      try { await dbRun("ALTER TABLE order_guest_status ADD COLUMN locked INTEGER NOT NULL DEFAULT 0"); console.log('[dbInit] Added locked to order_guest_status'); } catch (e) { console.error(e.message); }
    }

    await dbRun(`CREATE TABLE IF NOT EXISTS delivery_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      company TEXT,
      delivery_order_number TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    )`);

    // 10. DAILY CLOSINGS & ADMIN
    await dbRun(`CREATE TABLE IF NOT EXISTS daily_closings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      closing_date TEXT NOT NULL,
      closing_type TEXT DEFAULT 'day',
      data TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS daily_closings_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      closing_date TEXT NOT NULL,
      closing_type TEXT DEFAULT 'day',
      shift_label TEXT,
      data TEXT,
      opened_at DATETIME,
      closed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS shift_closings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_date TEXT NOT NULL,
      shift_label TEXT NOT NULL,
      opened_at DATETIME,
      closed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      data TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS admin_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )`);

    // 11. RESERVATIONS
    await dbRun(`CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      party_size INTEGER DEFAULT 1,
      guest_name TEXT,
      phone TEXT,
      table_id TEXT,
      table_name TEXT,
      status TEXT DEFAULT 'confirmed',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS table_settings (
      table_id TEXT PRIMARY KEY,
      max_capacity INTEGER DEFAULT 4,
      min_capacity INTEGER DEFAULT 1,
      is_reservable INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS reservation_time_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot_time TEXT NOT NULL UNIQUE,
      is_active INTEGER DEFAULT 1
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS reservation_policy (
      id INTEGER PRIMARY KEY CHECK(id=1),
      slot_duration INTEGER DEFAULT 60,
      buffer_time INTEGER DEFAULT 15,
      max_party_size INTEGER DEFAULT 20,
      advance_days INTEGER DEFAULT 30,
      auto_cancel_minutes INTEGER DEFAULT 15,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 12. SYNC & ID MAPPING
    await dbRun(`CREATE TABLE IF NOT EXISTS sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'started',
      message TEXT,
      details TEXT,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      error_message TEXT
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS sync_log_details (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_log_id INTEGER NOT NULL,
      entity_type TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_id TEXT,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sync_log_id) REFERENCES sync_logs(id) ON DELETE CASCADE
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS id_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      firebase_id TEXT NOT NULL,
      local_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(entity_type, firebase_id)
    )`);

    // 13. MISCELLANEOUS
    await dbRun(`CREATE TABLE IF NOT EXISTS sold_out_records (
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

    // Migration: fix old sold_out_records schema (target_id → key_id, add missing columns)
    try {
      const cols = await new Promise((resolve, reject) => {
        db.all(`PRAGMA table_info(sold_out_records)`, (err, rows) => err ? reject(err) : resolve(rows || []));
      });
      const colNames = (cols || []).map(c => c.name);
      if (colNames.includes('target_id') && !colNames.includes('key_id')) {
        console.log('[dbInit] Migrating sold_out_records: target_id → key_id');
        await dbRun(`ALTER TABLE sold_out_records RENAME TO sold_out_records_old`);
        await dbRun(`CREATE TABLE sold_out_records (
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
        await dbRun(`INSERT OR IGNORE INTO sold_out_records (menu_id, scope, key_id, updated_at)
          SELECT menu_id, scope, CAST(target_id AS TEXT), updated_at FROM sold_out_records_old`);
        await dbRun(`DROP TABLE sold_out_records_old`);
        console.log('[dbInit] sold_out_records migration complete');
      } else if (colNames.includes('key_id') && !colNames.includes('soldout_type')) {
        console.log('[dbInit] Adding missing columns to sold_out_records');
        try { await dbRun(`ALTER TABLE sold_out_records ADD COLUMN soldout_type TEXT NOT NULL DEFAULT 'today'`); } catch(e) {}
        try { await dbRun(`ALTER TABLE sold_out_records ADD COLUMN end_time INTEGER NOT NULL DEFAULT 0`); } catch(e) {}
        try { await dbRun(`ALTER TABLE sold_out_records ADD COLUMN selector TEXT`); } catch(e) {}
      }
    } catch (migErr) {
      console.warn('[dbInit] sold_out_records migration check failed:', migErr.message);
    }

    await dbRun(`CREATE TABLE IF NOT EXISTS menu_item_colors (
      item_id TEXT PRIMARY KEY,
      color TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS OpenPrice_Lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      menu_id INTEGER,
      item_name TEXT,
      price REAL DEFAULT 0,
      quantity INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS printer_layout_settings (
      id INTEGER PRIMARY KEY CHECK(id=1),
      settings TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS layout_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      settings_data TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 14. MENU TABLES (menus, menu_categories, menu_items)
    await dbRun(`CREATE TABLE IF NOT EXISTS menus (
      menu_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      is_active INTEGER DEFAULT 0,
      sales_channels TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      firebase_id TEXT
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS menu_categories (
      category_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      menu_id INTEGER NOT NULL,
      sort_order INTEGER DEFAULT 0,
      image_url TEXT,
      firebase_id TEXT,
      description TEXT,
      FOREIGN KEY (menu_id) REFERENCES menus(menu_id) ON DELETE CASCADE
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS menu_items (
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
    console.log('[dbInit] Menu tables (menus, menu_categories, menu_items) ensured');

    // 15. BUSINESS PROFILE
    await dbRun(`CREATE TABLE IF NOT EXISTS business_profile (
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
      country TEXT,
      logo_url TEXT,
      banner_url TEXT,
      firebase_restaurant_id TEXT,
      service_type TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    // Ensure singleton row exists
    const bpRow = await dbGet('SELECT id FROM business_profile WHERE id = 1');
    if (!bpRow) {
      await dbRun("INSERT INTO business_profile (id) VALUES (1)");
      console.log('[dbInit] business_profile singleton row created');
    }

    // 16. SYSTEM PINS
    await dbRun(`CREATE TABLE IF NOT EXISTS system_pins (
      id INTEGER PRIMARY KEY CHECK(id=1),
      backoffice_pin TEXT DEFAULT '0888',
      manager_pin TEXT DEFAULT '1234',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    const pinRow = await dbGet('SELECT id FROM system_pins WHERE id = 1');
    if (!pinRow) {
      await dbRun("INSERT INTO system_pins (id) VALUES (1)");
      console.log('[dbInit] system_pins singleton row created');
    }

    // 17. VOIDS & REFUNDS
    await dbRun(`CREATE TABLE IF NOT EXISTS voids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      subtotal REAL NOT NULL DEFAULT 0,
      tax_total REAL NOT NULL DEFAULT 0,
      grand_total REAL NOT NULL DEFAULT 0,
      reason TEXT,
      note TEXT,
      source TEXT NOT NULL DEFAULT 'partial',
      needs_approval INTEGER NOT NULL DEFAULT 0,
      approved_by TEXT,
      approved_at DATETIME,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS void_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      void_id INTEGER NOT NULL,
      order_line_id INTEGER,
      menu_id INTEGER,
      name TEXT,
      qty REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0,
      tax REAL NOT NULL DEFAULT 0,
      printer_group_id INTEGER
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS void_policy (
      id INTEGER PRIMARY KEY,
      approval_threshold REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS refunds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      original_order_number TEXT,
      refund_type TEXT DEFAULT 'FULL',
      subtotal REAL DEFAULT 0,
      tax REAL DEFAULT 0,
      total REAL DEFAULT 0,
      payment_method TEXT,
      refunded_by TEXT,
      refunded_by_pin TEXT,
      reason TEXT,
      notes TEXT,
      status TEXT DEFAULT 'COMPLETED',
      created_at TEXT
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS refund_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      refund_id INTEGER NOT NULL,
      order_item_id INTEGER,
      item_name TEXT,
      quantity INTEGER DEFAULT 1,
      unit_price REAL DEFAULT 0,
      total_price REAL DEFAULT 0,
      tax REAL DEFAULT 0
    )`);

    // 18. CHANNEL SETTINGS
    await dbRun(`CREATE TABLE IF NOT EXISTS channel_settings (
      id INTEGER PRIMARY KEY CHECK(id=1),
      settings TEXT DEFAULT '{}',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 19. EMPLOYEES TABLE (Work Schedule 관련)
    // 기존 스키마 확인 및 마이그레이션
    const empTableExists = await dbGet("SELECT name FROM sqlite_master WHERE type='table' AND name='employees'");
    if (empTableExists) {
      const empCols = await dbAll("PRAGMA table_info(employees)");
      const empColNames = empCols.map(c => c.name);
      
      // 오래된 스키마 (employee_id) -> 새 스키마 (id) 마이그레이션
      if (empColNames.includes('employee_id') && !empColNames.includes('id')) {
        console.log('[dbInit] Migrating employees table from old schema (employee_id -> id)...');
        try {
          await dbRun(`ALTER TABLE employees RENAME TO employees_backup`);
          await dbRun(`CREATE TABLE employees (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            role TEXT NOT NULL,
            department TEXT NOT NULL DEFAULT 'Hall',
            email TEXT,
            phone TEXT,
            hire_date TEXT,
            pin TEXT,
            permit_level INTEGER DEFAULT 2,
            status TEXT DEFAULT 'active',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
          )`);
          await dbRun(`INSERT INTO employees (id, name, role, department, pin, status)
            SELECT CAST(employee_id AS TEXT), name, role, COALESCE(channel_id, 'Hall'), pin_hash, 'active'
            FROM employees_backup`);
          await dbRun(`DROP TABLE employees_backup`);
          console.log('[dbInit] employees table migrated successfully');
        } catch (migErr) {
          console.error('[dbInit] employees migration failed:', migErr.message);
        }
      } else if (empColNames.includes('id')) {
        // 새 스키마 있음 - 누락된 컬럼 추가
        const columnsToAdd = [
          { name: 'department', def: "TEXT NOT NULL DEFAULT 'Hall'" },
          { name: 'email', def: 'TEXT' },
          { name: 'phone', def: 'TEXT' },
          { name: 'hire_date', def: 'TEXT' },
          { name: 'pin', def: 'TEXT' },
          { name: 'permit_level', def: 'INTEGER DEFAULT 2' },
          { name: 'status', def: "TEXT DEFAULT 'active'" },
          { name: 'created_at', def: "TEXT DEFAULT (datetime('now'))" },
          { name: 'updated_at', def: "TEXT DEFAULT (datetime('now'))" }
        ];
        for (const col of columnsToAdd) {
          if (!empColNames.includes(col.name)) {
            try {
              await dbRun(`ALTER TABLE employees ADD COLUMN ${col.name} ${col.def}`);
              console.log(`[dbInit] Added ${col.name} to employees`);
            } catch (e) { /* ignore duplicate column */ }
          }
        }
      }
    } else {
      // 테이블 없음 - 새로 생성
      await dbRun(`CREATE TABLE employees (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        department TEXT NOT NULL DEFAULT 'Hall',
        email TEXT,
        phone TEXT,
        hire_date TEXT,
        pin TEXT,
        permit_level INTEGER DEFAULT 2,
        status TEXT DEFAULT 'active',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`);
      console.log('[dbInit] employees table created');
    }

    // Work Schedules Table
    await dbRun(`CREATE TABLE IF NOT EXISTS work_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id TEXT NOT NULL,
      date TEXT NOT NULL,
      scheduled_start TEXT,
      scheduled_end TEXT,
      worked_start TEXT,
      worked_end TEXT,
      swapped_with TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(employee_id, date)
    )`);

    // Shift Swap Requests Table
    await dbRun(`CREATE TABLE IF NOT EXISTS shift_swap_requests (
      id TEXT PRIMARY KEY,
      employee1_id TEXT NOT NULL,
      employee1_name TEXT NOT NULL,
      employee1_date TEXT NOT NULL,
      employee1_time TEXT,
      employee2_id TEXT NOT NULL,
      employee2_name TEXT NOT NULL,
      employee2_date TEXT NOT NULL,
      employee2_time TEXT,
      status TEXT DEFAULT 'pending',
      mode TEXT DEFAULT 'swap',
      requested_date TEXT NOT NULL,
      approved_date TEXT,
      approver TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`);

    // Time Off Requests Table
    await dbRun(`CREATE TABLE IF NOT EXISTS time_off_requests (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      employee_name TEXT NOT NULL,
      type TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      reason TEXT,
      status TEXT DEFAULT 'pending',
      requested_date TEXT NOT NULL,
      approved_date TEXT,
      approver TEXT,
      is_partial INTEGER DEFAULT 0,
      partial_start_time TEXT,
      partial_end_time TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`);

    // Clock Records Table
    await dbRun(`CREATE TABLE IF NOT EXISTS clock_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id TEXT NOT NULL,
      employee_name TEXT,
      clock_in_time TEXT NOT NULL,
      clock_out_time TEXT,
      total_hours REAL,
      scheduled_shift_id INTEGER,
      status TEXT DEFAULT 'clocked_in',
      early_out_approved_by TEXT,
      early_out_reason TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`);

    // Activity Logs Table
    await dbRun(`CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      action TEXT NOT NULL,
      employee_id TEXT,
      employee_name TEXT,
      details TEXT,
      timestamp TEXT NOT NULL,
      user TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`);

    console.log('[dbInit] Employee and Work Schedule tables ensured');

    console.log('[dbInit] All additional tables ensured');

    // ===== DEFAULT TAX DATA (없을 경우만 삽입) =====
    const existingTaxGroups = await dbAll('SELECT tax_group_id FROM tax_groups WHERE is_deleted = 0 LIMIT 1');
    if (existingTaxGroups.length === 0) {
      console.log('[dbInit] No tax groups found. Inserting default tax data...');
      
      // Default Taxes (ID range: 380000~)
      await dbRun(`INSERT OR IGNORE INTO taxes (tax_id, name, rate, menu_id, is_deleted) VALUES (380000, 'Sales Tax', 8.875, NULL, 0)`);
      await dbRun(`INSERT OR IGNORE INTO taxes (tax_id, name, rate, menu_id, is_deleted) VALUES (380001, 'GST', 5.0, NULL, 0)`);
      await dbRun(`INSERT OR IGNORE INTO taxes (tax_id, name, rate, menu_id, is_deleted) VALUES (380002, 'PST', 7.0, NULL, 0)`);
      await dbRun(`INSERT OR IGNORE INTO taxes (tax_id, name, rate, menu_id, is_deleted) VALUES (380003, 'HST', 13.0, NULL, 0)`);
      
      // Default Tax Groups (ID range: 385000~)
      await dbRun(`INSERT OR IGNORE INTO tax_groups (tax_group_id, name, menu_id, is_deleted) VALUES (385000, 'US Sales Tax', NULL, 0)`);
      await dbRun(`INSERT OR IGNORE INTO tax_groups (tax_group_id, name, menu_id, is_deleted) VALUES (385001, 'Canadian GST+PST', NULL, 0)`);
      await dbRun(`INSERT OR IGNORE INTO tax_groups (tax_group_id, name, menu_id, is_deleted) VALUES (385002, 'Canadian HST', NULL, 0)`);
      
      // Tax Group Links
      await dbRun(`INSERT OR IGNORE INTO tax_group_links (tax_group_id, tax_id) VALUES (385000, 380000)`);  // US Sales Tax → Sales Tax 8.875%
      await dbRun(`INSERT OR IGNORE INTO tax_group_links (tax_group_id, tax_id) VALUES (385001, 380001)`);  // Canadian GST+PST → GST 5%
      await dbRun(`INSERT OR IGNORE INTO tax_group_links (tax_group_id, tax_id) VALUES (385001, 380002)`);  // Canadian GST+PST → PST 7%
      await dbRun(`INSERT OR IGNORE INTO tax_group_links (tax_group_id, tax_id) VALUES (385002, 380003)`);  // Canadian HST → HST 13%
      
      console.log('[dbInit] Default tax data inserted:');
      console.log('  - US Sales Tax (8.875%)');
      console.log('  - Canadian GST+PST (5% + 7%)');
      console.log('  - Canadian HST (13%)');
    }

    console.log('[dbInit] Database standardization complete.');
  } catch (err) {
    console.error('[dbInit] Database initialization failed:', err.message);
    throw err;
  }
}

module.exports = { initDatabase };
