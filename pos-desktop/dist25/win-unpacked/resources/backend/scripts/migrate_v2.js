const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbDir = path.join(__dirname, '..', 'db');
const srcDb = path.join(dbDir, 'web2pos.db');
const destDb = path.join(dbDir, 'web2pos_v2.db');

async function migrate() {
  console.log('=== DB 마이그레이션 (v2) ===');
  
  // 1. DB 파일 복사
  if (fs.existsSync(srcDb)) {
    console.log(`1. web2pos.db 복사 -> web2pos_v2.db`);
    fs.copyFileSync(srcDb, destDb);
  } else {
    console.log('⚠️ 원본 DB가 없습니다. 새 DB가 생성됩니다.');
  }
  
  // 2. 테이블 구조 수정 (force_fix_tables.js 로직)
  console.log('2. 테이블 구조 수정...');
  const db = new sqlite3.Database(destDb);
  
  const run = (sql) => new Promise((resolve) => {
    db.run(sql, (err) => {
      if (err) console.log(`   Error: ${err.message}`);
      resolve();
    });
  });

  // Printers
  await run('DROP TABLE IF EXISTS printer_group_links');
  await run('DROP TABLE IF EXISTS printers');
  await run(`CREATE TABLE printers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      type TEXT DEFAULT '',
      selected_printer TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Printer Groups
  await run('DROP TABLE IF EXISTS printer_groups');
  await run(`CREATE TABLE printer_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE printer_group_links (
      group_id INTEGER NOT NULL,
      printer_id INTEGER NOT NULL,
      PRIMARY KEY (group_id, printer_id),
      FOREIGN KEY (group_id) REFERENCES printer_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (printer_id) REFERENCES printers(id) ON DELETE CASCADE
  )`);

  // Taxes
  await run('DROP TABLE IF EXISTS tax_group_links');
  await run('DROP TABLE IF EXISTS taxes');
  await run(`CREATE TABLE taxes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      rate REAL NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Tax Groups
  await run('DROP TABLE IF EXISTS tax_groups');
  await run(`CREATE TABLE tax_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE tax_group_links (
      group_id INTEGER NOT NULL,
      tax_id INTEGER NOT NULL,
      PRIMARY KEY (group_id, tax_id),
      FOREIGN KEY (group_id) REFERENCES tax_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (tax_id) REFERENCES taxes(id) ON DELETE CASCADE
  )`);

  console.log('✅ 마이그레이션 완료! 이제 서버를 재시작하세요.');
  db.close();
}

migrate();


















