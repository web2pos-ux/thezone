const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '..', 'db', 'web2pos.db');
const db = new sqlite3.Database(dbPath);

// 모든 메뉴 확인
db.all("SELECT menu_id, name, is_active FROM menus ORDER BY menu_id", [], (err, menus) => {
  console.log('=== All Menus ===');
  menus?.forEach(m => console.log(`  ${m.menu_id}: ${m.name} (is_active: ${m.is_active})`));
  
  // Sushi Harbour 메뉴 (menu_id: 200005)의 카테고리만 확인
  const targetMenuId = 200005;
  
  db.all(`
    SELECT category_id, name, sort_order 
    FROM menu_categories 
    WHERE menu_id = ?
    ORDER BY sort_order, name
  `, [targetMenuId], (err, categories) => {
    console.log(`\n=== Categories for Menu ${targetMenuId} (Sushi Harbour) ===`);
    console.log(`Total: ${categories?.length || 0} categories`);
    categories?.forEach(c => console.log(`  ${c.category_id}: ${c.name}`));
    
    // 해당 메뉴의 아이템 수
    db.all(`
      SELECT COUNT(*) as count 
      FROM menu_items mi
      JOIN menu_categories mc ON mi.category_id = mc.category_id
      WHERE mc.menu_id = ?
    `, [targetMenuId], (err, rows) => {
      console.log(`\n=== Items for Menu ${targetMenuId} ===`);
      console.log(`Total: ${rows?.[0]?.count || 0} items`);
      
      // 카테고리별 아이템 수
      db.all(`
        SELECT mc.name, COUNT(mi.item_id) as item_count
        FROM menu_categories mc
        LEFT JOIN menu_items mi ON mc.category_id = mi.category_id
        WHERE mc.menu_id = ?
        GROUP BY mc.category_id
        ORDER BY mc.sort_order, mc.name
      `, [targetMenuId], (err, rows) => {
        console.log(`\n=== Items per Category (Menu ${targetMenuId}) ===`);
        rows?.forEach(r => console.log(`  ${r.name}: ${r.item_count} items`));
        
        // 세금 연결 확인
        db.all(`
          SELECT mtl.*, mi.name as item_name, mc.name as category_name
          FROM menu_tax_links mtl
          JOIN menu_items mi ON mtl.item_id = mi.item_id
          JOIN menu_categories mc ON mi.category_id = mc.category_id
          WHERE mc.menu_id = ?
        `, [targetMenuId], (err, rows) => {
          console.log(`\n=== Tax Links for Menu ${targetMenuId} ===`);
          console.log(`Total: ${rows?.length || 0} tax links`);
          rows?.forEach(r => console.log(`  ${r.item_name} (${r.category_name}) → tax_group_id: ${r.tax_group_id}`));
          
          // 모디파이어 연결 확인
          db.all(`
            SELECT cml.*, mc.name as category_name
            FROM category_modifier_links cml
            JOIN menu_categories mc ON cml.category_id = mc.category_id
            WHERE mc.menu_id = ?
          `, [targetMenuId], (err, rows) => {
            console.log(`\n=== Category-Modifier Links for Menu ${targetMenuId} ===`);
            console.log(`Total: ${rows?.length || 0} category-modifier links`);
            
            db.all(`
              SELECT mml.*, mi.name as item_name
              FROM menu_modifier_links mml
              JOIN menu_items mi ON mml.item_id = mi.item_id
              JOIN menu_categories mc ON mi.category_id = mc.category_id
              WHERE mc.menu_id = ?
            `, [targetMenuId], (err, rows) => {
              console.log(`\n=== Item-Modifier Links for Menu ${targetMenuId} ===`);
              console.log(`Total: ${rows?.length || 0} item-modifier links`);
              
              db.close();
            });
          });
        });
      });
    });
  });
});








