const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./web2pos.db');

// 모든 테이블 확인
db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, rows) => {
  console.log('=== All tables ===');
  const tables = rows?.map(r => r.name) || [];
  console.log(tables);
  
  // 각 테이블의 행 수 확인
  let count = 0;
  tables.forEach(table => {
    db.get(`SELECT COUNT(*) as cnt FROM ${table}`, [], (err, row) => {
      console.log(`${table}: ${row?.cnt || 0} rows`);
      count++;
      if (count === tables.length) {
        db.close();
      }
    });
  });
});








