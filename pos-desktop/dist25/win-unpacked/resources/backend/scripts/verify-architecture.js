// 아키텍처 최적화 검증 스크립트
// 사용법: node scripts/verify-architecture.js

const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// SQLite 연결
const dbPath = path.resolve(__dirname, '..', '..', 'db', 'web2pos.db');
const db = new sqlite3.Database(dbPath);

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

async function verify() {
  console.log('='.repeat(70));
  console.log('🔍 WEB2POS 아키텍처 최적화 검증');
  console.log('='.repeat(70));
  
  const results = {
    passed: 0,
    failed: 0,
    tests: []
  };
  
  // ==========================================
  // 1. 테이블 존재 확인
  // ==========================================
  console.log('\n📋 1. 필수 테이블 확인');
  console.log('-'.repeat(50));
  
  const requiredTables = [
    'id_mappings',
    'sync_logs',
    'sync_log_details',
    'third_party_integrations'
  ];
  
  for (const table of requiredTables) {
    try {
      const tableInfo = await dbAll(`PRAGMA table_info(${table})`);
      if (tableInfo.length > 0) {
        console.log(`   ✅ ${table}: ${tableInfo.length} columns`);
        results.passed++;
        results.tests.push({ name: `Table: ${table}`, status: 'passed' });
      } else {
        console.log(`   ❌ ${table}: NOT FOUND`);
        results.failed++;
        results.tests.push({ name: `Table: ${table}`, status: 'failed' });
      }
    } catch (error) {
      console.log(`   ❌ ${table}: ERROR - ${error.message}`);
      results.failed++;
      results.tests.push({ name: `Table: ${table}`, status: 'failed', error: error.message });
    }
  }
  
  // ==========================================
  // 2. firebase_id 컬럼 확인
  // ==========================================
  console.log('\n📋 2. firebase_id 컬럼 확인');
  console.log('-'.repeat(50));
  
  const tablesWithFirebaseId = [
    'menus',
    'menu_categories',
    'menu_items',
    'modifier_groups',
    'tax_groups',
    'printer_groups'
  ];
  
  for (const table of tablesWithFirebaseId) {
    try {
      const columns = await dbAll(`PRAGMA table_info(${table})`);
      const hasFirebaseId = columns.some(c => c.name === 'firebase_id');
      
      if (hasFirebaseId) {
        console.log(`   ✅ ${table}: firebase_id 컬럼 존재`);
        results.passed++;
        results.tests.push({ name: `firebase_id in ${table}`, status: 'passed' });
      } else {
        console.log(`   ❌ ${table}: firebase_id 컬럼 없음`);
        results.failed++;
        results.tests.push({ name: `firebase_id in ${table}`, status: 'failed' });
      }
    } catch (error) {
      console.log(`   ❌ ${table}: ERROR - ${error.message}`);
      results.failed++;
    }
  }
  
  // ==========================================
  // 3. ID Mappings 확인
  // ==========================================
  console.log('\n📋 3. ID Mappings 데이터 확인');
  console.log('-'.repeat(50));
  
  const mappingStats = await dbAll(
    'SELECT entity_type, COUNT(*) as count FROM id_mappings GROUP BY entity_type'
  );
  
  if (mappingStats.length > 0) {
    console.log(`   ✅ id_mappings에 ${mappingStats.length}개 엔티티 타입 존재`);
    for (const stat of mappingStats) {
      console.log(`      - ${stat.entity_type}: ${stat.count}개`);
    }
    results.passed++;
    results.tests.push({ name: 'ID Mappings data', status: 'passed' });
  } else {
    console.log('   ⚠️ id_mappings 테이블이 비어있음');
    results.tests.push({ name: 'ID Mappings data', status: 'warning' });
  }
  
  // UUID 형식 확인
  const sampleMapping = await dbGet('SELECT uuid FROM id_mappings LIMIT 1');
  if (sampleMapping?.uuid) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(sampleMapping.uuid)) {
      console.log(`   ✅ UUID 형식 올바름: ${sampleMapping.uuid}`);
      results.passed++;
      results.tests.push({ name: 'UUID format', status: 'passed' });
    } else {
      console.log(`   ❌ UUID 형식 오류: ${sampleMapping.uuid}`);
      results.failed++;
      results.tests.push({ name: 'UUID format', status: 'failed' });
    }
  }
  
  // ==========================================
  // 4. 서비스 파일 확인
  // ==========================================
  console.log('\n📋 4. 서비스 파일 확인');
  console.log('-'.repeat(50));
  
  const fs = require('fs');
  const serviceFiles = [
    { path: '../services/idMapperService.js', name: 'ID Mapper Service' },
    { path: '../services/syncLoggerService.js', name: 'Sync Logger Service' },
    { path: '../integrations/ThirdPartyAdapter.js', name: 'ThirdParty Adapter' },
    { path: '../integrations/ExampleAdapter.js', name: 'Example Adapter' }
  ];
  
  for (const file of serviceFiles) {
    const fullPath = path.join(__dirname, file.path);
    if (fs.existsSync(fullPath)) {
      const stats = fs.statSync(fullPath);
      console.log(`   ✅ ${file.name}: ${Math.round(stats.size / 1024)}KB`);
      results.passed++;
      results.tests.push({ name: file.name, status: 'passed' });
    } else {
      console.log(`   ❌ ${file.name}: 파일 없음`);
      results.failed++;
      results.tests.push({ name: file.name, status: 'failed' });
    }
  }
  
  // ==========================================
  // 5. 데이터 정합성 확인
  // ==========================================
  console.log('\n📋 5. 데이터 정합성 확인');
  console.log('-'.repeat(50));
  
  // 활성 메뉴 확인
  const activeMenu = await dbGet("SELECT COUNT(*) as count FROM menus WHERE is_active = 1");
  console.log(`   📦 활성 메뉴: ${activeMenu.count}개`);
  
  // 카테고리 확인
  const categories = await dbGet("SELECT COUNT(*) as count FROM menu_categories WHERE menu_id = 200005");
  console.log(`   📦 카테고리 (menu_id=200005): ${categories.count}개`);
  
  // 메뉴 아이템 확인
  const items = await dbGet("SELECT COUNT(*) as count FROM menu_items WHERE menu_id = 200005");
  console.log(`   📦 메뉴 아이템 (menu_id=200005): ${items.count}개`);
  
  // 활성 모디파이어 그룹 확인
  const modGroups = await dbGet("SELECT COUNT(*) as count FROM modifier_groups WHERE is_deleted = 0");
  console.log(`   📦 활성 모디파이어 그룹: ${modGroups.count}개`);
  
  // 고아 데이터 확인
  const orphanModGroups = await dbGet(
    "SELECT COUNT(*) as count FROM modifier_groups WHERE is_deleted = 0 AND menu_id NOT IN (SELECT menu_id FROM menus)"
  );
  if (orphanModGroups.count === 0) {
    console.log(`   ✅ 고아 모디파이어 그룹 없음`);
    results.passed++;
    results.tests.push({ name: 'No orphan modifier_groups', status: 'passed' });
  } else {
    console.log(`   ⚠️ 고아 모디파이어 그룹: ${orphanModGroups.count}개`);
    results.tests.push({ name: 'Orphan modifier_groups', status: 'warning', count: orphanModGroups.count });
  }
  
  // ==========================================
  // 결과 요약
  // ==========================================
  console.log('\n' + '='.repeat(70));
  console.log('📊 검증 결과 요약');
  console.log('='.repeat(70));
  
  console.log(`\n   ✅ 통과: ${results.passed}`);
  console.log(`   ❌ 실패: ${results.failed}`);
  console.log(`   📈 성공률: ${Math.round((results.passed / (results.passed + results.failed)) * 100)}%`);
  
  if (results.failed === 0) {
    console.log('\n🎉 모든 검증 통과! 아키텍처 최적화 완료!');
  } else {
    console.log('\n⚠️ 일부 검증 실패. 위 로그를 확인하세요.');
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('📁 생성된 파일 목록');
  console.log('='.repeat(70));
  console.log(`
  📂 backend/
  ├── 📂 services/
  │   ├── idMapperService.js      # 통합 ID 매핑 서비스
  │   └── syncLoggerService.js    # 동기화 로깅 서비스
  ├── 📂 integrations/
  │   ├── ThirdPartyAdapter.js    # 3rd Party 연동 기본 클래스
  │   └── ExampleAdapter.js       # 연동 예시 어댑터
  └── 📂 scripts/
      ├── migrate-uuids.js        # UUID 마이그레이션 스크립트
      ├── compare-sqlite-firebase.js
      ├── delete-global-collections.js
      └── verify-architecture.js  # 이 파일

  📂 db/
  └── web2pos.db (새 테이블 추가)
      ├── id_mappings             # UUID 매핑 테이블
      ├── sync_logs               # 동기화 로그
      ├── sync_log_details        # 동기화 상세 로그
      └── third_party_integrations# 3rd Party 연동 설정
  `);
  
  db.close();
  process.exit(results.failed > 0 ? 1 : 0);
}

verify().catch(error => {
  console.error('❌ Verification failed:', error);
  db.close();
  process.exit(1);
});





