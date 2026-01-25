const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./web2pos.db');

db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, rows) => {
  if (err) {
    console.error('Error:', err);
    db.close();
    return;
  }
  
  console.log('=== 모든 테이블 ===');
  const tables = rows.map(r => r.name);
  tables.forEach(t => console.log(t));
  
  console.log('\n=== modifier 관련 테이블 ===');
  tables.filter(t => t.toLowerCase().includes('mod')).forEach(t => console.log(t));
  
  console.log('\n=== tax 관련 테이블 ===');
  tables.filter(t => t.toLowerCase().includes('tax')).forEach(t => console.log(t));
  
  console.log('\n=== printer 관련 테이블 ===');
  tables.filter(t => t.toLowerCase().includes('printer')).forEach(t => console.log(t));
  
  // 세금 그룹 데이터 확인
  db.all("SELECT * FROM tax_groups LIMIT 3", [], (err, rows) => {
    console.log('\n=== tax_groups 데이터 ===');
    console.log(rows);
    
    // 프린터 그룹 데이터 확인
    db.all("SELECT * FROM printer_groups LIMIT 3", [], (err, rows) => {
      console.log('\n=== printer_groups 데이터 ===');
      console.log(rows);
      db.close();
    });
  });
});
