const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '..', 'db', 'web2pos.db');
const db = new sqlite3.Database(dbPath);

// 세금 관련 모든 테이블 확인
db.all("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%tax%'", [], (err, rows) => {
  console.log('=== Tax-related tables ===');
  console.log(rows?.map(x => x.name) || []);
  
  // category_tax_links 확인
  db.all('SELECT * FROM category_tax_links LIMIT 10', [], (err, rows) => {
    if (err) {
      console.log('\ncategory_tax_links: Table does not exist or error:', err.message);
    } else {
      console.log('\n=== category_tax_links ===');
      console.log(rows || []);
    }
    
    // menu_categories 테이블 스키마 확인 (혹시 세금이 직접 저장되어 있는지)
    db.all("PRAGMA table_info(menu_categories)", [], (err, rows) => {
      console.log('\n=== menu_categories schema ===');
      console.log(rows?.map(r => r.name) || []);
      
      // 세금 그룹 ID가 카테고리에 직접 저장되어 있는지 확인
      db.all("SELECT category_id, name, tax_group_id FROM menu_categories WHERE menu_id = 200005 LIMIT 10", [], (err, rows) => {
        if (err) {
          console.log('\nNo tax_group_id column in menu_categories');
        } else {
          console.log('\n=== Categories with tax_group_id ===');
          console.log(rows || []);
        }
        
        db.close();
      });
    });
  });
});








