const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbDir = path.join(__dirname, '..', 'db');
const dbPath = path.join(dbDir, 'web2pos_v2.db');
const backupPath = path.join(dbDir, `web2pos_v2_backup_${Date.now()}.db`);

async function resetDatabase() {
  console.log('=== 데이터베이스 초기화 ===');

  // 1. 기존 DB 백업
  if (fs.existsSync(dbPath)) {
    console.log(`1. 기존 데이터베이스 백업: ${backupPath}`);
    fs.copyFileSync(dbPath, backupPath);
    // 파일 삭제 대신 덮어쓰기 위해 삭제
    try {
        fs.unlinkSync(dbPath);
        console.log('   기존 파일 삭제 완료');
    } catch (e) {
        console.log('   파일 삭제 실패 (사용 중일 수 있음):', e.message);
    }
  }

  // 2. 새 DB 생성
  console.log('2. 새 데이터베이스 생성...');
  const db = new sqlite3.Database(dbPath);

  const schema = `
  -- Printers
  CREATE TABLE printers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      type TEXT DEFAULT '',
      selected_printer TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Printer Groups
  CREATE TABLE printer_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Printer Group Links
  CREATE TABLE printer_group_links (
      group_id INTEGER NOT NULL,
      printer_id INTEGER NOT NULL,
      PRIMARY KEY (group_id, printer_id),
      FOREIGN KEY (group_id) REFERENCES printer_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (printer_id) REFERENCES printers(id) ON DELETE CASCADE
  );

  -- Taxes
  CREATE TABLE taxes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      rate REAL NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Tax Groups
  CREATE TABLE tax_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Tax Group Links
  CREATE TABLE tax_group_links (
      group_id INTEGER NOT NULL,
      tax_id INTEGER NOT NULL,
      PRIMARY KEY (group_id, tax_id),
      FOREIGN KEY (group_id) REFERENCES tax_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (tax_id) REFERENCES taxes(id) ON DELETE CASCADE
  );
  
  -- 기존 필수 테이블 (Menus 등) 복구를 위한 스키마 (간략화)
  CREATE TABLE IF NOT EXISTS menus (
    menu_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    sales_channels TEXT DEFAULT '[]'
  );
  `;

  db.exec(schema, (err) => {
    if (err) {
      console.error('❌ 오류 발생:', err.message);
    } else {
      console.log('✅ 데이터베이스 및 테이블 생성 완료!');
    }
    db.close();
  });
}

resetDatabase();

