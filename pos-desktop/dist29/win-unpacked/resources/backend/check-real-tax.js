const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// 실제 데이터베이스 경로
const dbPath = path.resolve(__dirname, '..', 'db', 'web2pos.db');
console.log('Database path:', dbPath);

const db = new sqlite3.Database(dbPath);

// 세금 관련 데이터 확인
db.all("SELECT * FROM taxes", [], (err, rows) => {
  console.log('\n=== taxes ===');
  console.log(rows || []);
  
  db.all("SELECT * FROM tax_groups", [], (err, rows) => {
    console.log('\n=== tax_groups ===');
    console.log(rows || []);
    
    db.all("SELECT tgl.*, t.name as tax_name, t.rate FROM tax_group_links tgl LEFT JOIN taxes t ON tgl.tax_id = t.id", [], (err, rows) => {
      console.log('\n=== tax_group_links (with tax info) ===');
      console.log(rows || []);
      
      db.all("SELECT * FROM menu_tax_links LIMIT 20", [], (err, rows) => {
        console.log('\n=== menu_tax_links (first 20) ===');
        console.log(rows || []);
        db.close();
      });
    });
  });
});








