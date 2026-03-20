// UUID 마이그레이션 스크립트
// 기존 데이터에 UUID를 부여하고 id_mappings 테이블에 저장
// 사용법: node scripts/migrate-uuids.js

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

// SQLite 연결
const dbPath = path.resolve(__dirname, '..', '..', 'db', 'web2pos.db');
const db = new sqlite3.Database(dbPath);

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function(err) {
    if (err) reject(err);
    else resolve(this);
  });
});

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) reject(err);
    else resolve(rows);
  });
});

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => {
    if (err) reject(err);
    else resolve(row);
  });
});

// 엔티티별 마이그레이션 설정
const ENTITY_CONFIGS = [
  {
    type: 'menu',
    table: 'menus',
    idColumn: 'menu_id',
    firebaseIdColumn: 'firebase_id'
  },
  {
    type: 'category',
    table: 'menu_categories',
    idColumn: 'category_id',
    firebaseIdColumn: 'firebase_id'
  },
  {
    type: 'menu_item',
    table: 'menu_items',
    idColumn: 'item_id',
    firebaseIdColumn: 'firebase_id'
  },
  {
    type: 'modifier_group',
    table: 'modifier_groups',
    idColumn: 'group_id',
    firebaseIdColumn: 'firebase_id',
    condition: 'is_deleted = 0'
  },
  {
    type: 'tax_group',
    table: 'tax_groups',
    idColumn: 'id',
    firebaseIdColumn: 'firebase_id',
    condition: 'is_active = 1'
  },
  {
    type: 'printer_group',
    table: 'printer_groups',
    idColumn: 'id',
    firebaseIdColumn: 'firebase_id',
    condition: 'is_active = 1'
  }
];

async function migrateEntity(config) {
  console.log(`\n📦 Migrating ${config.type}...`);
  
  const whereClause = config.condition ? `WHERE ${config.condition}` : '';
  const entities = await dbAll(
    `SELECT ${config.idColumn} as local_id, ${config.firebaseIdColumn} as firebase_id 
     FROM ${config.table} ${whereClause}`
  );
  
  let created = 0;
  let skipped = 0;
  
  for (const entity of entities) {
    // 이미 매핑이 있는지 확인
    const existing = await dbGet(
      'SELECT id FROM id_mappings WHERE entity_type = ? AND local_id = ?',
      [config.type, String(entity.local_id)]
    );
    
    if (existing) {
      skipped++;
      continue;
    }
    
    // 새 UUID 생성 및 매핑 저장
    const uuid = uuidv4();
    await dbRun(
      `INSERT INTO id_mappings (entity_type, local_id, firebase_id, uuid, external_ids)
       VALUES (?, ?, ?, ?, '{}')`,
      [config.type, String(entity.local_id), entity.firebase_id || null, uuid]
    );
    created++;
  }
  
  console.log(`   ✅ ${config.type}: ${created} created, ${skipped} skipped (already exists)`);
  return { type: config.type, created, skipped };
}

async function main() {
  console.log('='.repeat(60));
  console.log('🔄 UUID 마이그레이션 시작');
  console.log('='.repeat(60));
  
  const results = [];
  
  for (const config of ENTITY_CONFIGS) {
    try {
      const result = await migrateEntity(config);
      results.push(result);
    } catch (error) {
      console.error(`❌ Error migrating ${config.type}:`, error.message);
      results.push({ type: config.type, created: 0, skipped: 0, error: error.message });
    }
  }
  
  // 결과 요약
  console.log('\n' + '='.repeat(60));
  console.log('📊 마이그레이션 결과 요약');
  console.log('='.repeat(60));
  
  let totalCreated = 0;
  let totalSkipped = 0;
  
  for (const result of results) {
    if (result.error) {
      console.log(`❌ ${result.type}: ERROR - ${result.error}`);
    } else {
      console.log(`✅ ${result.type}: ${result.created} created, ${result.skipped} skipped`);
      totalCreated += result.created;
      totalSkipped += result.skipped;
    }
  }
  
  console.log(`\n📈 Total: ${totalCreated} mappings created, ${totalSkipped} skipped`);
  
  // 검증
  console.log('\n' + '-'.repeat(60));
  console.log('🔍 검증');
  
  const mappingCount = await dbGet('SELECT COUNT(*) as count FROM id_mappings');
  console.log(`   id_mappings 테이블: ${mappingCount.count}개 레코드`);
  
  const byType = await dbAll(
    'SELECT entity_type, COUNT(*) as count FROM id_mappings GROUP BY entity_type'
  );
  for (const row of byType) {
    console.log(`   - ${row.entity_type}: ${row.count}개`);
  }
  
  console.log('\n✅ 마이그레이션 완료!');
  
  db.close();
  process.exit(0);
}

main().catch(error => {
  console.error('❌ Migration failed:', error);
  db.close();
  process.exit(1);
});





