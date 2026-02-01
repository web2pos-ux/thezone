const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, '..', 'db', 'web2pos.db');
const db = new sqlite3.Database(dbPath);

// 세금 관련 테이블 확인
db.all("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%tax%'", [], (err, rows) => {
  console.log('=== Tax related tables ===');
  console.log(rows?.map(r => r.name) || []);
  
  // taxes 테이블
  db.all("SELECT * FROM taxes", [], (err, rows) => {
    console.log('\n=== taxes ===');
    console.log(rows || []);
    
    // tax_groups 테이블
    db.all("SELECT * FROM tax_groups", [], (err, rows) => {
      console.log('\n=== tax_groups ===');
      console.log(rows || []);
      
      // tax_group_links 테이블
      db.all("SELECT * FROM tax_group_links", [], (err, rows) => {
        console.log('\n=== tax_group_links ===');
        console.log(rows || []);
        
        // menu_tax_links 테이블
        db.all("SELECT * FROM menu_tax_links LIMIT 10", [], (err, rows) => {
          console.log('\n=== menu_tax_links (first 10) ===');
          console.log(rows || []);
          db.close();
        });
      });
    });
  });
});








