/**
 * POS → Firebase 데이터 동기화 분석 스크립트
 * 
 * 분석 항목:
 * 1. 데이터 매칭 확인
 * 2. 데이터 손실 확인
 * 3. 중복 데이터 확인
 * 4. 저장소 경로 확인
 */

const admin = require('firebase-admin');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Firebase 초기화
const serviceAccountPath = path.join(__dirname, '../config/firebase-service-account.json');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require(serviceAccountPath))
  });
}

const firestore = admin.firestore();
const RESTAURANT_ID = 'tQcGkoSoKcwKdvL7WLiQ';

// SQLite 연결
const dbPath = path.join(__dirname, '../../db/web2pos.db');
const db = new sqlite3.Database(dbPath);

const dbAll = (sql) => new Promise((resolve, reject) => {
  db.all(sql, [], (err, rows) => err ? reject(err) : resolve(rows));
});

async function analyzeSync() {
  console.log('='.repeat(80));
  console.log('🔍 POS → Firebase 데이터 동기화 분석');
  console.log('='.repeat(80));
  console.log('Restaurant ID:', RESTAURANT_ID);
  
  const issues = [];
  const warnings = [];
  
  // ============================================
  // 1. 저장소 경로 분석
  // ============================================
  console.log('\n' + '═'.repeat(80));
  console.log('📁 1. 저장소 경로 분석');
  console.log('═'.repeat(80));
  
  const restaurantRef = firestore.collection('restaurants').doc(RESTAURANT_ID);
  
  // 메뉴 데이터 경로
  const menuCategories = await restaurantRef.collection('menuCategories').get();
  const menuItems = await restaurantRef.collection('menuItems').get();
  const modifierGroups = await restaurantRef.collection('modifierGroups').get();
  const taxGroups = await restaurantRef.collection('taxGroups').get();
  const printerGroups = await restaurantRef.collection('printerGroups').get();
  
  // 주문 데이터 경로 (글로벌)
  const globalOrders = await firestore.collection('orders')
    .where('restaurantId', '==', RESTAURANT_ID)
    .limit(100)
    .get();
  
  console.log('\n📊 현재 Firebase 저장소 구조:');
  console.log('┌─────────────────────────────────────────────────────────────────────┐');
  console.log('│ 데이터 유형           │ 저장 경로                      │ 문서 수   │');
  console.log('├─────────────────────────────────────────────────────────────────────┤');
  console.log(`│ 메뉴 카테고리         │ restaurants/{id}/menuCategories │ ${String(menuCategories.size).padStart(7)} │`);
  console.log(`│ 메뉴 아이템           │ restaurants/{id}/menuItems      │ ${String(menuItems.size).padStart(7)} │`);
  console.log(`│ 모디파이어 그룹       │ restaurants/{id}/modifierGroups │ ${String(modifierGroups.size).padStart(7)} │`);
  console.log(`│ 세금 그룹             │ restaurants/{id}/taxGroups      │ ${String(taxGroups.size).padStart(7)} │`);
  console.log(`│ 프린터 그룹           │ restaurants/{id}/printerGroups  │ ${String(printerGroups.size).padStart(7)} │`);
  console.log('├─────────────────────────────────────────────────────────────────────┤');
  console.log(`│ 주문 (글로벌)         │ orders (where restaurantId)     │ ${String(globalOrders.size).padStart(7)} │`);
  console.log('└─────────────────────────────────────────────────────────────────────┘');
  
  // 경로 불일치 확인
  if (globalOrders.size > 0) {
    warnings.push({
      type: 'PATH_INCONSISTENCY',
      message: '주문 데이터가 글로벌 컬렉션에 저장됨 (메뉴는 서브컬렉션 사용)',
      detail: '메뉴: restaurants/{id}/menuItems vs 주문: orders (글로벌)',
      recommendation: '주문도 restaurants/{id}/orders 서브컬렉션으로 이동 고려'
    });
  }
  
  // ============================================
  // 2. 데이터 매칭 분석 (POS ↔ Firebase)
  // ============================================
  console.log('\n' + '═'.repeat(80));
  console.log('🔗 2. 데이터 매칭 분석');
  console.log('═'.repeat(80));
  
  // 2.1 카테고리 매칭
  const posCategories = await dbAll(`SELECT * FROM menu_categories WHERE menu_id = 200005`);
  let categoryMatchCount = 0;
  let categoryMismatchCount = 0;
  const unmatchedCategories = [];
  
  for (const posCat of posCategories) {
    if (posCat.firebase_id) {
      const fbDoc = await restaurantRef.collection('menuCategories').doc(posCat.firebase_id).get();
      if (fbDoc.exists) {
        categoryMatchCount++;
      } else {
        categoryMismatchCount++;
        unmatchedCategories.push({ pos: posCat, reason: 'Firebase doc not found' });
      }
    } else {
      categoryMismatchCount++;
      unmatchedCategories.push({ pos: posCat, reason: 'No firebase_id' });
    }
  }
  
  console.log(`\n📋 카테고리: ${categoryMatchCount}/${posCategories.length} 매칭됨`);
  if (unmatchedCategories.length > 0) {
    issues.push({
      type: 'CATEGORY_MISMATCH',
      count: unmatchedCategories.length,
      items: unmatchedCategories.slice(0, 5).map(c => `${c.pos.name} (${c.reason})`)
    });
  }
  
  // 2.2 메뉴 아이템 매칭
  const posItems = await dbAll(`SELECT * FROM menu_items WHERE menu_id = 200005`);
  let itemMatchCount = 0;
  let itemMismatchCount = 0;
  const unmatchedItems = [];
  
  for (const posItem of posItems) {
    if (posItem.firebase_id) {
      const fbDoc = await restaurantRef.collection('menuItems').doc(posItem.firebase_id).get();
      if (fbDoc.exists) {
        itemMatchCount++;
      } else {
        itemMismatchCount++;
        unmatchedItems.push({ pos: posItem, reason: 'Firebase doc not found' });
      }
    } else {
      itemMismatchCount++;
      unmatchedItems.push({ pos: posItem, reason: 'No firebase_id' });
    }
  }
  
  console.log(`📋 메뉴 아이템: ${itemMatchCount}/${posItems.length} 매칭됨`);
  if (unmatchedItems.length > 0) {
    issues.push({
      type: 'ITEM_MISMATCH',
      count: unmatchedItems.length,
      items: unmatchedItems.slice(0, 5).map(i => `${i.pos.name} (${i.reason})`)
    });
  }
  
  // ============================================
  // 3. 데이터 손실 분석
  // ============================================
  console.log('\n' + '═'.repeat(80));
  console.log('📉 3. 데이터 손실 분석');
  console.log('═'.repeat(80));
  
  // 3.1 Firebase에만 있고 POS에 없는 아이템 (orphan)
  const orphanItems = [];
  menuItems.forEach(doc => {
    const data = doc.data();
    if (!data.posId) {
      orphanItems.push({ id: doc.id, name: data.name });
    }
  });
  
  console.log(`\n📋 Firebase에만 있는 아이템 (orphan): ${orphanItems.length}개`);
  if (orphanItems.length > 0) {
    console.log('   샘플:', orphanItems.slice(0, 3).map(i => i.name).join(', '));
    warnings.push({
      type: 'ORPHAN_ITEMS',
      count: orphanItems.length,
      items: orphanItems.slice(0, 5).map(i => i.name)
    });
  }
  
  // 3.2 필드 누락 확인
  const fieldMissing = {
    price: 0,
    categoryId: 0,
    modifierGroupIds: 0
  };
  
  menuItems.forEach(doc => {
    const data = doc.data();
    if (data.price === undefined && data.price1 === undefined) fieldMissing.price++;
    if (!data.categoryId) fieldMissing.categoryId++;
    if (!data.modifierGroupIds || data.modifierGroupIds.length === 0) fieldMissing.modifierGroupIds++;
  });
  
  console.log(`\n📋 필드 누락 현황:`);
  console.log(`   - price 누락: ${fieldMissing.price}개`);
  console.log(`   - categoryId 누락: ${fieldMissing.categoryId}개`);
  console.log(`   - modifierGroupIds 누락: ${fieldMissing.modifierGroupIds}개`);
  
  if (fieldMissing.price > 0) {
    issues.push({
      type: 'MISSING_PRICE',
      count: fieldMissing.price,
      message: 'price 필드가 누락된 아이템이 있음'
    });
  }
  
  // ============================================
  // 4. 중복 데이터 분석
  // ============================================
  console.log('\n' + '═'.repeat(80));
  console.log('🔄 4. 중복 데이터 분석');
  console.log('═'.repeat(80));
  
  // 4.1 동일 posId를 가진 중복 문서 확인
  const posIdMap = new Map();
  menuItems.forEach(doc => {
    const data = doc.data();
    if (data.posId) {
      if (!posIdMap.has(data.posId)) {
        posIdMap.set(data.posId, []);
      }
      posIdMap.get(data.posId).push({ id: doc.id, name: data.name });
    }
  });
  
  const duplicates = [];
  posIdMap.forEach((docs, posId) => {
    if (docs.length > 1) {
      duplicates.push({ posId, docs });
    }
  });
  
  console.log(`\n📋 중복 posId: ${duplicates.length}개`);
  if (duplicates.length > 0) {
    console.log('   샘플:', duplicates.slice(0, 3).map(d => `posId=${d.posId} (${d.docs.length}개)`).join(', '));
    issues.push({
      type: 'DUPLICATE_POS_ID',
      count: duplicates.length,
      items: duplicates.slice(0, 5)
    });
  }
  
  // 4.2 동일 이름 중복 확인
  const nameMap = new Map();
  menuItems.forEach(doc => {
    const data = doc.data();
    const name = data.name?.toLowerCase();
    if (name) {
      if (!nameMap.has(name)) {
        nameMap.set(name, []);
      }
      nameMap.get(name).push({ id: doc.id, name: data.name, posId: data.posId });
    }
  });
  
  const nameDuplicates = [];
  nameMap.forEach((docs, name) => {
    if (docs.length > 1) {
      nameDuplicates.push({ name, docs });
    }
  });
  
  console.log(`📋 동일 이름 중복: ${nameDuplicates.length}개`);
  if (nameDuplicates.length > 0) {
    warnings.push({
      type: 'DUPLICATE_NAMES',
      count: nameDuplicates.length,
      items: nameDuplicates.slice(0, 5).map(d => `"${d.name}" (${d.docs.length}개)`)
    });
  }
  
  // ============================================
  // 5. 주문 데이터 분석
  // ============================================
  console.log('\n' + '═'.repeat(80));
  console.log('📦 5. 주문 데이터 분석');
  console.log('═'.repeat(80));
  
  // 5.1 주문 필드 확인
  const orderFieldIssues = {
    missingItems: 0,
    missingTotal: 0,
    missingOrderType: 0
  };
  
  globalOrders.forEach(doc => {
    const data = doc.data();
    if (!data.items || data.items.length === 0) orderFieldIssues.missingItems++;
    if (data.total === undefined || data.total === null) orderFieldIssues.missingTotal++;
    if (!data.orderType) orderFieldIssues.missingOrderType++;
  });
  
  console.log(`\n📋 주문 필드 누락 현황 (${globalOrders.size}개 주문 분석):`);
  console.log(`   - items 누락: ${orderFieldIssues.missingItems}개`);
  console.log(`   - total 누락: ${orderFieldIssues.missingTotal}개`);
  console.log(`   - orderType 누락: ${orderFieldIssues.missingOrderType}개`);
  
  // ============================================
  // 종합 보고서
  // ============================================
  console.log('\n' + '═'.repeat(80));
  console.log('📊 종합 분석 결과');
  console.log('═'.repeat(80));
  
  console.log('\n🔴 ISSUES (수정 필요):');
  if (issues.length === 0) {
    console.log('   없음 ✅');
  } else {
    issues.forEach((issue, i) => {
      console.log(`   ${i + 1}. [${issue.type}] ${issue.message || ''}`);
      if (issue.count) console.log(`      - 영향받는 항목: ${issue.count}개`);
      if (issue.items) console.log(`      - 샘플: ${issue.items.slice(0, 3).join(', ')}`);
    });
  }
  
  console.log('\n🟡 WARNINGS (주의 필요):');
  if (warnings.length === 0) {
    console.log('   없음 ✅');
  } else {
    warnings.forEach((warning, i) => {
      console.log(`   ${i + 1}. [${warning.type}] ${warning.message || ''}`);
      if (warning.detail) console.log(`      - ${warning.detail}`);
      if (warning.recommendation) console.log(`      - 권장: ${warning.recommendation}`);
      if (warning.count) console.log(`      - 영향받는 항목: ${warning.count}개`);
    });
  }
  
  console.log('\n🟢 정상 항목:');
  console.log(`   - 카테고리 매칭: ${categoryMatchCount}/${posCategories.length}`);
  console.log(`   - 아이템 매칭: ${itemMatchCount}/${posItems.length}`);
  console.log(`   - Firebase 메뉴 데이터: 서브컬렉션 사용 ✅`);
  
  console.log('\n' + '═'.repeat(80));
  
  db.close();
  process.exit(0);
}

analyzeSync().catch(err => {
  console.error('Analysis failed:', err);
  db.close();
  process.exit(1);
});
