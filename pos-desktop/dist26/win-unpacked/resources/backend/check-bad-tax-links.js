const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '..', 'db', 'web2pos.db');
const db = new sqlite3.Database(dbPath);

// 잘못된 tax_group_id를 가진 아이템들 확인
db.all(`
  SELECT mtl.*, mi.name as item_name, mc.name as category_name
  FROM menu_tax_links mtl
  LEFT JOIN menu_items mi ON mtl.item_id = mi.item_id
  LEFT JOIN menu_categories mc ON mi.category_id = mc.category_id
  WHERE mtl.tax_group_id NOT IN (1, 2, 3)
`, [], (err, rows) => {
  console.log('=== Items with invalid tax_group_id ===');
  console.log(`Found ${rows?.length || 0} items with invalid tax_group_id`);
  if (rows && rows.length > 0) {
    console.log('\nSample items:');
    rows.slice(0, 10).forEach(r => {
      console.log(`  - ${r.item_name} (category: ${r.category_name}) → tax_group_id: ${r.tax_group_id}`);
    });
  }
  
  // 카테고리별 아이템 수
  db.all(`
    SELECT mc.name, COUNT(DISTINCT mi.item_id) as item_count
    FROM menu_categories mc
    LEFT JOIN menu_items mi ON mc.category_id = mi.category_id
    GROUP BY mc.category_id
    ORDER BY mc.name
  `, [], (err, rows) => {
    console.log('\n=== Items per Category (POS) ===');
    rows?.forEach(r => {
      console.log(`  ${r.name}: ${r.item_count} items`);
    });
    
    // 세금 그룹별 의도된 적용 범위
    console.log('\n=== Tax Groups Purpose ===');
    console.log('  1 (Food): 일반 음식 - 5%');
    console.log('  2 (Drink): 음료 - 12%');
    console.log('  3 (Alcohol): 주류 - 15%');
    
    // 카테고리별 세금 그룹 추천
    console.log('\n=== Suggested Tax Group by Category ===');
    console.log('  ALCOHOL → tax_group_id: 3 (Alcohol 15%)');
    console.log('  BEAVERAGE/DRINKS → tax_group_id: 2 (Drink 12%)');
    console.log('  나머지 → tax_group_id: 1 (Food 5%)');
    
    db.close();
  });
});








