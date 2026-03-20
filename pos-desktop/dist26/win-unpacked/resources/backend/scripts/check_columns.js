const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, '..', 'db', 'web2pos.db'));

console.log('=== DB 컬럼 확인 ===');

const tables = ['taxes', 'tax_groups', 'printers', 'printer_groups'];

tables.forEach(table => {
  db.all(`PRAGMA table_info(${table})`, [], (err, rows) => {
    if (err) {
      console.log(`${table}: 테이블 없음 또는 오류 (${err.message})`);
    } else {
      const cols = rows.map(r => r.name).join(', ');
      console.log(`${table}: ${cols}`);
    }
  });
});

setTimeout(() => db.close(), 1000);


















