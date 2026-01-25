/**
 * 새 레스토랑용 빈 데이터베이스 생성 스크립트
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'db-empty', 'web2pos.db');

// 기존 파일 삭제
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
}

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // 스키마 파일 읽기
  const schemaPath = path.join(__dirname, '..', '..', 'db', 'schema.sql');
  
  // 기본 테이블 생성
  const createTables = `
    -- 기본 테이블 생성
    PRAGMA foreign_keys = ON;
    
    -- Base Menus
    CREATE TABLE IF NOT EXISTS base_menus (
        menu_id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        is_active INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    -- Menu Categories
    CREATE TABLE IF NOT EXISTS menu_categories (
        category_id INTEGER PRIMARY KEY,
        menu_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0
    );
    
    -- Menu Items
    CREATE TABLE IF NOT EXISTS menu_items (
        item_id INTEGER PRIMARY KEY,
        menu_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        price REAL NOT NULL,
        category_id INTEGER NOT NULL,
        sort_order INTEGER DEFAULT 0
    );
    
    -- Modifier Groups
    CREATE TABLE IF NOT EXISTS modifier_groups (
        group_id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        selection_type TEXT NOT NULL,
        min_selection INTEGER DEFAULT 0,
        max_selection INTEGER DEFAULT 1,
        menu_id INTEGER,
        is_deleted INTEGER DEFAULT 0
    );
    
    -- Modifiers
    CREATE TABLE IF NOT EXISTS modifiers (
        modifier_id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        price_delta REAL DEFAULT 0,
        type TEXT NOT NULL,
        is_deleted INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0
    );
    
    -- Modifier Group Links
    CREATE TABLE IF NOT EXISTS modifier_group_links (
        modifier_group_id INTEGER NOT NULL,
        modifier_id INTEGER NOT NULL,
        PRIMARY KEY (modifier_group_id, modifier_id)
    );
    
    -- Menu Modifier Links
    CREATE TABLE IF NOT EXISTS menu_modifier_links (
        link_id INTEGER PRIMARY KEY,
        item_id INTEGER NOT NULL,
        modifier_group_id INTEGER NOT NULL,
        is_ambiguous INTEGER DEFAULT 0,
        UNIQUE (item_id, modifier_group_id)
    );
    
    -- Tax Groups
    CREATE TABLE IF NOT EXISTS tax_groups (
        group_id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        menu_id INTEGER,
        is_deleted INTEGER DEFAULT 0
    );
    
    -- Taxes
    CREATE TABLE IF NOT EXISTS taxes (
        tax_id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        rate REAL NOT NULL,
        type TEXT NOT NULL,
        is_deleted INTEGER DEFAULT 0
    );
    
    -- Tax Group Links
    CREATE TABLE IF NOT EXISTS tax_group_links (
        tax_group_id INTEGER NOT NULL,
        tax_id INTEGER NOT NULL,
        PRIMARY KEY (tax_group_id, tax_id)
    );
    
    -- Menu Tax Links
    CREATE TABLE IF NOT EXISTS menu_tax_links (
        link_id INTEGER PRIMARY KEY,
        item_id INTEGER NOT NULL,
        tax_group_id INTEGER NOT NULL,
        is_ambiguous INTEGER DEFAULT 0,
        UNIQUE (item_id, tax_group_id)
    );
    
    -- Printers
    CREATE TABLE IF NOT EXISTS printers (
        printer_id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        ip_address TEXT UNIQUE,
        is_deleted INTEGER DEFAULT 0
    );
    
    -- Printer Groups
    CREATE TABLE IF NOT EXISTS printer_groups (
        group_id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        menu_id INTEGER,
        is_deleted INTEGER DEFAULT 0
    );
    
    -- Printer Group Links
    CREATE TABLE IF NOT EXISTS printer_group_links (
        printer_group_id INTEGER NOT NULL,
        printer_id INTEGER NOT NULL,
        PRIMARY KEY (printer_group_id, printer_id)
    );
    
    -- Menu Printer Links
    CREATE TABLE IF NOT EXISTS menu_printer_links (
        link_id INTEGER PRIMARY KEY,
        item_id INTEGER NOT NULL,
        printer_group_id INTEGER NOT NULL,
        is_ambiguous INTEGER DEFAULT 0,
        UNIQUE (item_id, printer_group_id)
    );
    
    -- Channels
    CREATE TABLE IF NOT EXISTS channels (
        channel_id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE
    );
    
    -- Employees
    CREATE TABLE IF NOT EXISTS employees (
        employee_id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        pin_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        channel_id INTEGER
    );
    
    -- Table Map Elements
    CREATE TABLE IF NOT EXISTS table_map_elements (
        element_id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        x_pos INTEGER,
        y_pos INTEGER,
        width INTEGER,
        height INTEGER
    );
    
    -- Orders
    CREATE TABLE IF NOT EXISTS orders (
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
    );
    
    -- Order Items
    CREATE TABLE IF NOT EXISTS order_items (
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
    );
    
    -- Payments
    CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        payment_method TEXT NOT NULL,
        amount REAL NOT NULL,
        tip REAL DEFAULT 0,
        reference_number TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        guest_number INTEGER,
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
    
    -- Settings
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    -- Restaurant Info
    CREATE TABLE IF NOT EXISTS restaurant_info (
        id INTEGER PRIMARY KEY DEFAULT 1,
        name TEXT,
        address TEXT,
        phone TEXT,
        email TEXT,
        website TEXT,
        logo_url TEXT,
        tax_id TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    -- Business Hours
    CREATE TABLE IF NOT EXISTS business_hours (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        day_of_week INTEGER NOT NULL,
        open_time TEXT,
        close_time TEXT,
        is_closed INTEGER DEFAULT 0
    );
    
    -- Promotions
    CREATE TABLE IF NOT EXISTS promotions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        value REAL NOT NULL,
        start_date TEXT,
        end_date TEXT,
        is_active INTEGER DEFAULT 1,
        conditions TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    -- Screen Settings (for table map)
    CREATE TABLE IF NOT EXISTS screen_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        screen_id TEXT NOT NULL,
        floor_id TEXT,
        settings TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    -- Printer Layouts
    CREATE TABLE IF NOT EXISTS printer_layouts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        layout_type TEXT NOT NULL,
        settings TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    -- Clock In/Out Records
    CREATE TABLE IF NOT EXISTS clock_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        clock_in TIMESTAMP,
        clock_out TIMESTAMP,
        total_hours REAL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  
  // 테이블 생성
  db.exec(createTables, (err) => {
    if (err) {
      console.error('Error creating tables:', err);
    } else {
      console.log('✅ Empty database created successfully!');
      
      // 기본 채널 삽입
      db.run("INSERT INTO channels (channel_id, name) VALUES (1, 'POS')");
      db.run("INSERT INTO channels (channel_id, name) VALUES (2, 'TOGO')");
      db.run("INSERT INTO channels (channel_id, name) VALUES (3, 'ONLINE')");
      db.run("INSERT INTO channels (channel_id, name) VALUES (4, 'DELIVERY')");
      
      // 기본 관리자 계정 (PIN: 0000)
      db.run("INSERT INTO employees (employee_id, name, pin_hash, role) VALUES (5200, 'Admin', '0000', 'Admin')");
      
      // 빈 레스토랑 정보
      db.run("INSERT INTO restaurant_info (id, name) VALUES (1, 'New Restaurant')");
      
      // 기본 영업시간 (월-일)
      for (let i = 0; i < 7; i++) {
        db.run(`INSERT INTO business_hours (day_of_week, open_time, close_time, is_closed) VALUES (${i}, '09:00', '21:00', 0)`);
      }
      
      console.log('✅ Default data inserted!');
    }
  });
});

db.close((err) => {
  if (err) {
    console.error('Error closing database:', err);
  } else {
    console.log('✅ Database file saved to:', dbPath);
  }
});
