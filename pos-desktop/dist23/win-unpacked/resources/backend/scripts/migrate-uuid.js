// 기존 데이터에 UUID 부여 마이그레이션 스크립트
// 사용법: node scripts/migrate-uuid.js

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

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

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => {
    if (err) reject(err);
    else resolve(row);
  });
});

async function migrateUUIDs() {
  console.log('='.repeat(60));
  console.log('🔄 UUID 마이그레이션 스크립트');
  console.log('='.repeat(60));
  
  const stats = {
    menus: 0,
    categories: 0,
    items: 0,
    modifierGroups: 0,
    taxGroups: 0,
    printerGroups: 0
  };
  
  // 1. 메뉴 마이그레이션
  console.log('\n📁 1. 메뉴 UUID 생성...');
  const menus = await dbAll('SELECT menu_id, name, firebase_id FROM menus');
  for (const menu of menus) {
    const existing = await dbGet(
      'SELECT uuid FROM id_mappings WHERE entity_type = ? AND local_id = ?',
      ['menu', String(menu.menu_id)]
    );
    
    if (!existing) {
      const uuid = uuidv4();
      await dbRun(
        `INSERT INTO id_mappings (entity_type, local_id, firebase_id, uuid)
         VALUES (?, ?, ?, ?)`,
        ['menu', String(menu.menu_id), menu.firebase_id, uuid]
      );
      stats.menus++;
      console.log(`   ✅ ${menu.name} → ${uuid.substring(0, 8)}...`);
    } else {
      console.log(`   ⏭️ ${menu.name} (이미 존재)`);
    }
  }
  
  // 2. 카테고리 마이그레이션
  console.log('\n📁 2. 카테고리 UUID 생성...');
  const categories = await dbAll('SELECT category_id, name, firebase_id FROM menu_categories');
  for (const cat of categories) {
    const existing = await dbGet(
      'SELECT uuid FROM id_mappings WHERE entity_type = ? AND local_id = ?',
      ['menu_category', String(cat.category_id)]
    );
    
    if (!existing) {
      const uuid = uuidv4();
      await dbRun(
        `INSERT INTO id_mappings (entity_type, local_id, firebase_id, uuid)
         VALUES (?, ?, ?, ?)`,
        ['menu_category', String(cat.category_id), cat.firebase_id, uuid]
      );
      stats.categories++;
    }
  }
  console.log(`   ✅ ${stats.categories}개 카테고리 처리`);
  
  // 3. 메뉴 아이템 마이그레이션
  console.log('\n📁 3. 메뉴 아이템 UUID 생성...');
  const items = await dbAll('SELECT item_id, name, firebase_id FROM menu_items');
  for (const item of items) {
    const existing = await dbGet(
      'SELECT uuid FROM id_mappings WHERE entity_type = ? AND local_id = ?',
      ['menu_item', String(item.item_id)]
    );
    
    if (!existing) {
      const uuid = uuidv4();
      await dbRun(
        `INSERT INTO id_mappings (entity_type, local_id, firebase_id, uuid)
         VALUES (?, ?, ?, ?)`,
        ['menu_item', String(item.item_id), item.firebase_id, uuid]
      );
      stats.items++;
    }
  }
  console.log(`   ✅ ${stats.items}개 메뉴 아이템 처리`);
  
  // 4. 모디파이어 그룹 마이그레이션
  console.log('\n📁 4. 모디파이어 그룹 UUID 생성...');
  const modGroups = await dbAll('SELECT group_id, name, firebase_id FROM modifier_groups WHERE is_deleted = 0');
  for (const group of modGroups) {
    const existing = await dbGet(
      'SELECT uuid FROM id_mappings WHERE entity_type = ? AND local_id = ?',
      ['modifier_group', String(group.group_id)]
    );
    
    if (!existing) {
      const uuid = uuidv4();
      await dbRun(
        `INSERT INTO id_mappings (entity_type, local_id, firebase_id, uuid)
         VALUES (?, ?, ?, ?)`,
        ['modifier_group', String(group.group_id), group.firebase_id, uuid]
      );
      stats.modifierGroups++;
    }
  }
  console.log(`   ✅ ${stats.modifierGroups}개 모디파이어 그룹 처리`);
  
  // 5. 세금 그룹 마이그레이션
  console.log('\n📁 5. 세금 그룹 UUID 생성...');
  const taxGroups = await dbAll('SELECT id, name, firebase_id FROM tax_groups WHERE is_active = 1');
  for (const group of taxGroups) {
    const existing = await dbGet(
      'SELECT uuid FROM id_mappings WHERE entity_type = ? AND local_id = ?',
      ['tax_group', String(group.id)]
    );
    
    if (!existing) {
      const uuid = uuidv4();
      await dbRun(
        `INSERT INTO id_mappings (entity_type, local_id, firebase_id, uuid)
         VALUES (?, ?, ?, ?)`,
        ['tax_group', String(group.id), group.firebase_id, uuid]
      );
      stats.taxGroups++;
    }
  }
  console.log(`   ✅ ${stats.taxGroups}개 세금 그룹 처리`);
  
  // 6. 프린터 그룹 마이그레이션
  console.log('\n📁 6. 프린터 그룹 UUID 생성...');
  const printerGroups = await dbAll('SELECT id, name, firebase_id FROM printer_groups WHERE is_active = 1');
  for (const group of printerGroups) {
    const existing = await dbGet(
      'SELECT uuid FROM id_mappings WHERE entity_type = ? AND local_id = ?',
      ['printer_group', String(group.id)]
    );
    
    if (!existing) {
      const uuid = uuidv4();
      await dbRun(
        `INSERT INTO id_mappings (entity_type, local_id, firebase_id, uuid)
         VALUES (?, ?, ?, ?)`,
        ['printer_group', String(group.id), group.firebase_id, uuid]
      );
      stats.printerGroups++;
    }
  }
  console.log(`   ✅ ${stats.printerGroups}개 프린터 그룹 처리`);
  
  // 결과 요약
  console.log('\n' + '='.repeat(60));
  console.log('📊 마이그레이션 완료');
  console.log('='.repeat(60));
  
  const totalMappings = await dbGet('SELECT COUNT(*) as count FROM id_mappings');
  const mappingStats = await dbAll(`
    SELECT entity_type, COUNT(*) as count, COUNT(firebase_id) as with_firebase
    FROM id_mappings
    GROUP BY entity_type
    ORDER BY entity_type
  `);
  
  console.log(`\n총 매핑: ${totalMappings.count}개\n`);
  console.log('| 엔티티 타입 | 총 개수 | Firebase ID 있음 |');
  console.log('|-------------|---------|------------------|');
  mappingStats.forEach(s => {
    console.log(`| ${s.entity_type.padEnd(13)} | ${String(s.count).padStart(7)} | ${String(s.with_firebase).padStart(16)} |`);
  });
  
  console.log('\n✅ 마이그레이션 완료!');
  
  db.close();
  process.exit(0);
}

migrateUUIDs().catch(error => {
  console.error('❌ Error:', error);
  db.close();
  process.exit(1);
});

