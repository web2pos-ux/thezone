const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('../db/web2pos.db');

db.all("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%mod%'", [], (e, r) => {
  console.log('Modifier tables:', r);
  
  // modifiers 테이블 스키마 확인
  db.all("PRAGMA table_info(modifiers)", [], (e2, cols) => {
    console.log('\nmodifiers table columns:', cols);
    
    // modifiers 데이터 샘플
    db.all("SELECT * FROM modifiers LIMIT 5", [], (e3, rows) => {
      console.log('\nmodifiers sample data:', rows);
      db.close();
    });
  });
});
