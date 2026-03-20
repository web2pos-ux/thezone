// 사용하지 않는 메뉴 데이터 정리 스크립트
// 사용법: node scripts/cleanup-unused-menu.js

const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.resolve(__dirname, '..', '..', 'db', 'web2pos.db');
const db = new sqlite3.Database(dbPath);

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) reject(err);
    else resolve(rows);
  });
});

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function(err) {
    if (err) reject(err);
    else resolve(this);
  });
});

async function cleanupUnusedMenu() {
  const unusedMenuId = 200006;
  
  console.log('='.repeat(60));
  console.log('🧹 사용하지 않는 메뉴 데이터 정리');
  console.log('='.repeat(60));
  console.log(`\n대상 메뉴 ID: ${unusedMenuId}`);
  
  // 1. 메뉴 정보 확인
  const menu = await dbAll('SELECT * FROM menus WHERE menu_id = ?', [unusedMenuId]);
  if (menu.length === 0) {
    console.log('❌ 해당 메뉴가 존재하지 않습니다.');
    process.exit(0);
  }
  
  console.log(`\n📋 메뉴 정보: ${menu[0].name}`);
  
  // 2. 관련 데이터 백업
  console.log('\n💾 데이터 백업 중...');
  
  const categories = await dbAll('SELECT * FROM menu_categories WHERE menu_id = ?', [unusedMenuId]);
  const categoryIds = categories.map(c => c.category_id);
  
  let items = [];
  if (categoryIds.length > 0) {
    const placeholders = categoryIds.map(() => '?').join(',');
    items = await dbAll(`SELECT * FROM menu_items WHERE category_id IN (${placeholders})`, categoryIds);
  }
  
  // 모디파이어 그룹 (menu_id로 연결된 것)
  const modifierGroups = await dbAll('SELECT * FROM modifier_groups WHERE menu_id = ?', [unusedMenuId]);
  
  const backup = {
    timestamp: new Date().toISOString(),
    menu: menu[0],
    categories,
    items,
    modifierGroups,
    summary: {
      categories: categories.length,
      items: items.length,
      modifierGroups: modifierGroups.length
    }
  };
  
  // 백업 파일 저장
  const backupDir = path.resolve(__dirname, '..', '..', 'backups', 'menu-cleanup');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  
  const backupFilename = `menu_${unusedMenuId}_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const backupPath = path.join(backupDir, backupFilename);
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  
  console.log(`✅ 백업 완료: ${backupFilename}`);
  console.log(`   - 카테고리: ${categories.length}개`);
  console.log(`   - 아이템: ${items.length}개`);
  console.log(`   - 모디파이어 그룹: ${modifierGroups.length}개`);
  
  // 3. 데이터 삭제 (CASCADE로 인해 관련 데이터도 삭제됨)
  console.log('\n🗑️ 데이터 삭제 중...');
  
  // 메뉴 아이템 삭제
  if (categoryIds.length > 0) {
    const placeholders = categoryIds.map(() => '?').join(',');
    await dbRun(`DELETE FROM menu_items WHERE category_id IN (${placeholders})`, categoryIds);
    console.log(`   ✅ 메뉴 아이템 ${items.length}개 삭제`);
  }
  
  // 카테고리 삭제
  await dbRun('DELETE FROM menu_categories WHERE menu_id = ?', [unusedMenuId]);
  console.log(`   ✅ 카테고리 ${categories.length}개 삭제`);
  
  // 모디파이어 그룹 소프트 삭제 (is_deleted = 1)
  await dbRun('UPDATE modifier_groups SET is_deleted = 1 WHERE menu_id = ?', [unusedMenuId]);
  console.log(`   ✅ 모디파이어 그룹 ${modifierGroups.length}개 소프트 삭제`);
  
  // 메뉴 삭제
  await dbRun('DELETE FROM menus WHERE menu_id = ?', [unusedMenuId]);
  console.log(`   ✅ 메뉴 삭제`);
  
  // 4. 결과 확인
  console.log('\n' + '='.repeat(60));
  console.log('📊 정리 완료');
  console.log('='.repeat(60));
  
  const remainingMenus = await dbAll('SELECT menu_id, name FROM menus');
  console.log('\n남은 메뉴:');
  remainingMenus.forEach(m => console.log(`   - ${m.menu_id}: ${m.name}`));
  
  const remainingCategories = await dbAll('SELECT COUNT(*) as count FROM menu_categories');
  const remainingItems = await dbAll('SELECT COUNT(*) as count FROM menu_items');
  const remainingModGroups = await dbAll('SELECT COUNT(*) as count FROM modifier_groups WHERE is_deleted = 0');
  
  console.log(`\n남은 데이터:`);
  console.log(`   - 카테고리: ${remainingCategories[0].count}개`);
  console.log(`   - 메뉴 아이템: ${remainingItems[0].count}개`);
  console.log(`   - 모디파이어 그룹: ${remainingModGroups[0].count}개`);
  
  console.log(`\n✅ 정리 완료! 백업 파일: ${backupPath}`);
  
  db.close();
  process.exit(0);
}

cleanupUnusedMenu().catch(error => {
  console.error('❌ Error:', error);
  db.close();
  process.exit(1);
});

