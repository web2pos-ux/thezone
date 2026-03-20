const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '..', 'db', 'web2pos.db');
const db = new sqlite3.Database(dbPath);

console.log('=== 잘못된 세금 연결 정리 ===\n');

// 1. 정리 전 상태
db.all(`
  SELECT COUNT(*) as count FROM category_tax_links WHERE tax_group_id NOT IN (1, 2, 3)
`, [], (err, rows) => {
  console.log(`정리 전 - 잘못된 category_tax_links: ${rows?.[0]?.count || 0}개`);
  
  db.all(`
    SELECT COUNT(*) as count FROM menu_tax_links WHERE tax_group_id NOT IN (1, 2, 3)
  `, [], (err, rows) => {
    console.log(`정리 전 - 잘못된 menu_tax_links: ${rows?.[0]?.count || 0}개`);
    
    // 2. 잘못된 연결 삭제
    db.run(`DELETE FROM category_tax_links WHERE tax_group_id NOT IN (1, 2, 3)`, [], function(err) {
      if (err) {
        console.log('\n❌ category_tax_links 삭제 실패:', err.message);
      } else {
        console.log(`\n✅ category_tax_links에서 ${this.changes}개 삭제됨`);
      }
      
      db.run(`DELETE FROM menu_tax_links WHERE tax_group_id NOT IN (1, 2, 3)`, [], function(err) {
        if (err) {
          console.log('❌ menu_tax_links 삭제 실패:', err.message);
        } else {
          console.log(`✅ menu_tax_links에서 ${this.changes}개 삭제됨`);
        }
        
        // 3. 정리 후 상태
        db.all(`
          SELECT COUNT(*) as count FROM category_tax_links
        `, [], (err, rows) => {
          console.log(`\n정리 후 - category_tax_links: ${rows?.[0]?.count || 0}개`);
          
          db.all(`
            SELECT COUNT(*) as count FROM menu_tax_links
          `, [], (err, rows) => {
            console.log(`정리 후 - menu_tax_links: ${rows?.[0]?.count || 0}개`);
            
            // 4. Sushi Harbour 메뉴 세금 연결 확인
            db.all(`
              SELECT mc.name, ctl.tax_group_id, tg.name as tax_group_name
              FROM menu_categories mc
              LEFT JOIN category_tax_links ctl ON mc.category_id = ctl.category_id
              LEFT JOIN tax_groups tg ON ctl.tax_group_id = tg.id
              WHERE mc.menu_id = 200005
              ORDER BY mc.sort_order
            `, [], (err, rows) => {
              console.log('\n=== Sushi Harbour 세금 연결 (정리 후) ===');
              rows?.forEach(r => {
                const taxInfo = r.tax_group_id 
                  ? `${r.tax_group_name} (${r.tax_group_id})`
                  : 'No tax link';
                console.log(`  ${r.name}: ${taxInfo}`);
              });
              
              db.close();
              console.log('\n✅ 정리 완료! 이제 다시 업로드하세요.');
            });
          });
        });
      });
    });
  });
});








