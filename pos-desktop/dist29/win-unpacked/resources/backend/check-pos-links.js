const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '..', 'db', 'web2pos.db');
console.log('Database path:', dbPath);

const db = new sqlite3.Database(dbPath);

// 메뉴 ID 확인
db.all("SELECT menu_id, name FROM menus WHERE is_active = 1", [], (err, rows) => {
  console.log('\n=== Active Menus ===');
  console.log(rows || []);
  
  // 카테고리 수 확인
  db.all("SELECT COUNT(*) as count FROM menu_categories", [], (err, rows) => {
    console.log('\n=== Categories Count ===');
    console.log(rows?.[0]?.count || 0);
    
    // 아이템 수 확인
    db.all("SELECT COUNT(*) as count FROM menu_items", [], (err, rows) => {
      console.log('\n=== Items Count ===');
      console.log(rows?.[0]?.count || 0);
      
      // menu_tax_links 확인
      db.all("SELECT * FROM menu_tax_links LIMIT 20", [], (err, rows) => {
        console.log('\n=== menu_tax_links (first 20) ===');
        console.log(rows || []);
        
        // 유효한 tax_group_id 확인 (1, 2, 3만 유효)
        db.all(`SELECT tax_group_id, COUNT(*) as count 
                FROM menu_tax_links 
                GROUP BY tax_group_id`, [], (err, rows) => {
          console.log('\n=== tax_group_id distribution ===');
          console.log(rows || []);
          
          // menu_modifier_links 확인
          db.all("SELECT COUNT(*) as count FROM menu_modifier_links", [], (err, rows) => {
            console.log('\n=== menu_modifier_links count ===');
            console.log(rows?.[0]?.count || 0);
            
            // category_modifier_links 확인
            db.all("SELECT COUNT(*) as count FROM category_modifier_links", [], (err, rows) => {
              console.log('\n=== category_modifier_links count ===');
              console.log(rows?.[0]?.count || 0);
              
              db.close();
            });
          });
        });
      });
    });
  });
});








