const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, '..', 'db', 'web2pos.db'));

async function run(sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, function(err) {
      if (err) {
        if (err.message.includes('duplicate column') || err.message.includes('already exists')) {
          console.log('  (이미 존재함)');
          resolve();
        } else {
          reject(err);
        }
      } else {
        console.log('  ✅ 완료');
        resolve();
      }
    });
  });
}

async function fix() {
  console.log('=== 테이블 구조 수정 ===\n');

  // 1. Printers 테이블 재생성
  console.log('1. printers 테이블 삭제 후 재생성...');
  try {
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
    console.log('  ✅ printers 테이블 생성 완료');
  } catch (err) {
    console.log('  Error:', err.message);
  }

  // 2. Printer Groups 테이블 재생성
  console.log('\n2. printer_groups 테이블 삭제 후 재생성...');
  try {
    await run('DROP TABLE IF EXISTS printer_group_links');
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
    console.log('  ✅ printer_groups, printer_group_links 테이블 생성 완료');
  } catch (err) {
    console.log('  Error:', err.message);
  }

  // 3. Taxes 테이블 재생성
  console.log('\n3. taxes 테이블 삭제 후 재생성...');
  try {
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
    console.log('  ✅ taxes 테이블 생성 완료');
  } catch (err) {
    console.log('  Error:', err.message);
  }

  // 4. Tax Groups 테이블 재생성
  console.log('\n4. tax_groups 테이블 삭제 후 재생성...');
  try {
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
    console.log('  ✅ tax_groups, tax_group_links 테이블 생성 완료');
  } catch (err) {
    console.log('  Error:', err.message);
  }

  console.log('\n=== 완료 ===');
  db.close();
}

fix();


















