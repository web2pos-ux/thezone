const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'db', 'web2pos.db');
const db = new sqlite3.Database(dbPath);

async function run(sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, function(err) {
      if (err) {
        console.log(`  Error running SQL: ${sql.substring(0, 50)}... -> ${err.message}`);
        resolve(); // 에러나도 계속 진행
      } else {
        console.log('  ✅ Success');
        resolve();
      }
    });
  });
}

async function fix() {
  console.log('=== 테이블 강제 재설정 ===\n');

  // 1. Taxes
  console.log('1. Taxes 테이블...');
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

  // 2. Tax Groups
  console.log('\n2. Tax Groups 테이블...');
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

  // 3. Printers
  console.log('\n3. Printers 테이블...');
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

  // 4. Printer Groups
  console.log('\n4. Printer Groups 테이블...');
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

  console.log('\n=== 완료 ===');
  
  // 테이블 구조 확인
  db.all("PRAGMA table_info(taxes)", [], (err, rows) => {
    console.log('\nCheck taxes table:');
    rows.forEach(r => console.log(` - ${r.name} (${r.type})`));
  });
  
  db.all("PRAGMA table_info(printers)", [], (err, rows) => {
    console.log('\nCheck printers table:');
    rows.forEach(r => console.log(` - ${r.name} (${r.type})`));
    db.close();
  });
}

fix();

