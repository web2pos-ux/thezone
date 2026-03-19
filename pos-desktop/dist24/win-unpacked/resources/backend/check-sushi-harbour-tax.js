const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '..', 'db', 'web2pos.db');
const db = new sqlite3.Database(dbPath);

const menuId = 200005; // Sushi Harbour

// Sushi Harbour 카테고리와 세금 연결 확인
db.all(`
  SELECT mc.category_id, mc.name, ctl.tax_group_id, tg.name as tax_group_name
  FROM menu_categories mc
  LEFT JOIN category_tax_links ctl ON mc.category_id = ctl.category_id
  LEFT JOIN tax_groups tg ON ctl.tax_group_id = tg.id
  WHERE mc.menu_id = ?
  ORDER BY mc.sort_order
`, [menuId], (err, rows) => {
  console.log('=== Sushi Harbour Categories with Tax Links ===');
  console.log(`\nPOS 유효 세금 그룹: 1 (Food 5%), 2 (Drink 12%), 3 (Alcohol 15%)\n`);
  
  rows?.forEach(r => {
    const taxInfo = r.tax_group_id 
      ? `tax_group_id: ${r.tax_group_id} ${r.tax_group_name ? `(${r.tax_group_name})` : '(NOT FOUND in tax_groups!)'}`
      : 'No tax link';
    console.log(`  ${r.name}: ${taxInfo}`);
  });
  
  // 잘못된 tax_group_id 수 확인
  db.all(`
    SELECT COUNT(*) as count 
    FROM category_tax_links ctl
    JOIN menu_categories mc ON ctl.category_id = mc.category_id
    WHERE mc.menu_id = ? AND ctl.tax_group_id NOT IN (1, 2, 3)
  `, [menuId], (err, rows) => {
    console.log(`\n⚠️ 잘못된 tax_group_id를 가진 연결: ${rows?.[0]?.count || 0}개`);
    
    db.close();
  });
});








