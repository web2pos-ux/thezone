// SQLite vs Firebase 데이터 비교 스크립트
// 사용법: node scripts/compare-sqlite-firebase.js

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const admin = require('firebase-admin');

// Firebase 초기화
const serviceAccountPath = path.join(__dirname, '..', 'config', 'firebase-service-account.json');

if (!admin.apps.length) {
  try {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('✅ Firebase 초기화 완료\n');
  } catch (error) {
    console.error('❌ Firebase 초기화 실패:', error.message);
    process.exit(1);
  }
}

const db = admin.firestore();
const restaurantId = 'tQcGkoSoKcwKdvL7WLiQ';

// SQLite 연결
const dbPath = path.resolve(__dirname, '..', '..', 'db', 'web2pos.db');
const sqliteDb = new sqlite3.Database(dbPath);

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  sqliteDb.all(sql, params, (err, rows) => {
    if (err) reject(err);
    else resolve(rows);
  });
});

async function compareData() {
  console.log('='.repeat(80));
  console.log('📊 SQLite vs Firebase 데이터 비교');
  console.log('='.repeat(80));
  console.log(`Restaurant ID: ${restaurantId}\n`);

  const restaurantRef = db.collection('restaurants').doc(restaurantId);
  
  // ===============================
  // 1. MENUS 비교
  // ===============================
  console.log('\n' + '─'.repeat(80));
  console.log('📁 1. MENUS 비교');
  console.log('─'.repeat(80));
  
  const sqliteMenus = await dbAll('SELECT menu_id, name, firebase_id FROM menus');
  const fbMenusSnapshot = await restaurantRef.collection('menus').get();
  
  console.log('\n[SQLite]');
  console.log('| menu_id | name | firebase_id |');
  console.log('|---------|------|-------------|');
  sqliteMenus.forEach(m => console.log(`| ${m.menu_id} | ${m.name} | ${m.firebase_id || '-'} |`));
  
  console.log('\n[Firebase]');
  console.log('| Document ID | name | posId |');
  console.log('|-------------|------|-------|');
  fbMenusSnapshot.forEach(doc => {
    const d = doc.data();
    console.log(`| ${doc.id} | ${d.name} | ${d.posId || d.id || '-'} |`);
  });
  
  // ===============================
  // 2. CATEGORIES 비교
  // ===============================
  console.log('\n' + '─'.repeat(80));
  console.log('📁 2. MENU CATEGORIES 비교');
  console.log('─'.repeat(80));
  
  const sqliteCategories = await dbAll('SELECT category_id, name, menu_id, firebase_id FROM menu_categories ORDER BY sort_order');
  const fbCatsSnapshot = await restaurantRef.collection('menuCategories').get();
  
  console.log(`\n[SQLite] ${sqliteCategories.length}개`);
  console.log('| category_id | name | menu_id | firebase_id |');
  console.log('|-------------|------|---------|-------------|');
  sqliteCategories.slice(0, 10).forEach(c => console.log(`| ${c.category_id} | ${c.name} | ${c.menu_id} | ${c.firebase_id || '-'} |`));
  if (sqliteCategories.length > 10) console.log(`... and ${sqliteCategories.length - 10} more`);
  
  console.log(`\n[Firebase] ${fbCatsSnapshot.size}개`);
  console.log('| Document ID | name | posId | sortOrder |');
  console.log('|-------------|------|-------|-----------|');
  fbCatsSnapshot.docs.slice(0, 10).forEach(doc => {
    const d = doc.data();
    console.log(`| ${doc.id.substring(0, 12)}... | ${d.name} | ${d.posId || '-'} | ${d.sortOrder || 0} |`);
  });
  if (fbCatsSnapshot.size > 10) console.log(`... and ${fbCatsSnapshot.size - 10} more`);
  
  // ===============================
  // 3. MENU ITEMS 비교
  // ===============================
  console.log('\n' + '─'.repeat(80));
  console.log('📁 3. MENU ITEMS 비교');
  console.log('─'.repeat(80));
  
  const sqliteItems = await dbAll('SELECT item_id, name, category_id, price, price2, firebase_id FROM menu_items ORDER BY category_id, sort_order');
  const fbItemsSnapshot = await restaurantRef.collection('menuItems').get();
  
  console.log(`\n[SQLite] ${sqliteItems.length}개`);
  console.log('| item_id | name | category_id | price | price2 | firebase_id |');
  console.log('|---------|------|-------------|-------|--------|-------------|');
  sqliteItems.slice(0, 10).forEach(i => console.log(`| ${i.item_id} | ${i.name.substring(0, 20)} | ${i.category_id} | ${i.price} | ${i.price2} | ${i.firebase_id ? i.firebase_id.substring(0, 8) + '...' : '-'} |`));
  if (sqliteItems.length > 10) console.log(`... and ${sqliteItems.length - 10} more`);
  
  console.log(`\n[Firebase] ${fbItemsSnapshot.size}개`);
  console.log('| Document ID | name | categoryId | price1 | price2 | posId |');
  console.log('|-------------|------|------------|--------|--------|-------|');
  fbItemsSnapshot.docs.slice(0, 10).forEach(doc => {
    const d = doc.data();
    console.log(`| ${doc.id.substring(0, 8)}... | ${(d.name || '').substring(0, 20)} | ${d.categoryId ? d.categoryId.substring(0, 8) + '...' : '-'} | ${d.price1 || d.price || 0} | ${d.price2 || 0} | ${d.posId || '-'} |`);
  });
  if (fbItemsSnapshot.size > 10) console.log(`... and ${fbItemsSnapshot.size - 10} more`);
  
  // ===============================
  // 4. MODIFIER GROUPS 비교
  // ===============================
  console.log('\n' + '─'.repeat(80));
  console.log('📁 4. MODIFIER GROUPS 비교');
  console.log('─'.repeat(80));
  
  const sqliteModGroups = await dbAll('SELECT group_id, name, menu_id FROM modifier_groups WHERE is_deleted = 0 ORDER BY name');
  const fbModGroupsSnapshot = await restaurantRef.collection('modifierGroups').get();
  
  console.log(`\n[SQLite] ${sqliteModGroups.length}개`);
  console.log('| group_id | name | menu_id |');
  console.log('|----------|------|---------|');
  sqliteModGroups.slice(0, 10).forEach(g => console.log(`| ${g.group_id} | ${g.name} | ${g.menu_id} |`));
  if (sqliteModGroups.length > 10) console.log(`... and ${sqliteModGroups.length - 10} more`);
  
  console.log(`\n[Firebase] ${fbModGroupsSnapshot.size}개`);
  console.log('| Document ID | name | posGroupId | modifiers count |');
  console.log('|-------------|------|------------|-----------------|');
  fbModGroupsSnapshot.docs.slice(0, 10).forEach(doc => {
    const d = doc.data();
    console.log(`| ${doc.id.substring(0, 12)}... | ${d.name} | ${d.posGroupId || '-'} | ${(d.modifiers || []).length} |`);
  });
  if (fbModGroupsSnapshot.size > 10) console.log(`... and ${fbModGroupsSnapshot.size - 10} more`);
  
  // ===============================
  // 5. TAX GROUPS 비교
  // ===============================
  console.log('\n' + '─'.repeat(80));
  console.log('📁 5. TAX GROUPS 비교');
  console.log('─'.repeat(80));
  
  const sqliteTaxGroups = await dbAll('SELECT id, name FROM tax_groups WHERE is_active = 1 ORDER BY name');
  const fbTaxGroupsSnapshot = await restaurantRef.collection('taxGroups').get();
  
  console.log(`\n[SQLite] ${sqliteTaxGroups.length}개`);
  console.log('| id | name |');
  console.log('|----|------|');
  sqliteTaxGroups.forEach(g => console.log(`| ${g.id} | ${g.name} |`));
  
  console.log(`\n[Firebase] ${fbTaxGroupsSnapshot.size}개`);
  console.log('| Document ID | name | posGroupId | taxes |');
  console.log('|-------------|------|------------|-------|');
  fbTaxGroupsSnapshot.docs.forEach(doc => {
    const d = doc.data();
    console.log(`| ${doc.id.substring(0, 12)}... | ${d.name} | ${d.posGroupId || '-'} | ${JSON.stringify(d.taxes || [])} |`);
  });
  
  // ===============================
  // 6. PRINTER GROUPS 비교
  // ===============================
  console.log('\n' + '─'.repeat(80));
  console.log('📁 6. PRINTER GROUPS 비교');
  console.log('─'.repeat(80));
  
  const sqlitePrinterGroups = await dbAll('SELECT id, name FROM printer_groups WHERE is_active = 1 ORDER BY name');
  const fbPrinterGroupsSnapshot = await restaurantRef.collection('printerGroups').get();
  
  console.log(`\n[SQLite] ${sqlitePrinterGroups.length}개`);
  console.log('| id | name |');
  console.log('|----|------|');
  sqlitePrinterGroups.forEach(g => console.log(`| ${g.id} | ${g.name} |`));
  
  console.log(`\n[Firebase] ${fbPrinterGroupsSnapshot.size}개`);
  console.log('| Document ID | name | posGroupId |');
  console.log('|-------------|------|------------|');
  fbPrinterGroupsSnapshot.docs.forEach(doc => {
    const d = doc.data();
    console.log(`| ${doc.id.substring(0, 12)}... | ${d.name} | ${d.posGroupId || '-'} |`);
  });
  
  // ===============================
  // 7. 문제점 분석
  // ===============================
  console.log('\n' + '='.repeat(80));
  console.log('⚠️ 잠재적 문제점 분석');
  console.log('='.repeat(80));
  
  const issues = [];
  
  // 7.1 카테고리 개수 차이
  if (sqliteCategories.length !== fbCatsSnapshot.size) {
    issues.push({
      type: 'COUNT_MISMATCH',
      table: 'menuCategories',
      sqlite: sqliteCategories.length,
      firebase: fbCatsSnapshot.size,
      message: `카테고리 개수 불일치: SQLite(${sqliteCategories.length}) vs Firebase(${fbCatsSnapshot.size})`
    });
  }
  
  // 7.2 아이템 개수 차이
  if (sqliteItems.length !== fbItemsSnapshot.size) {
    issues.push({
      type: 'COUNT_MISMATCH',
      table: 'menuItems',
      sqlite: sqliteItems.length,
      firebase: fbItemsSnapshot.size,
      message: `메뉴 아이템 개수 불일치: SQLite(${sqliteItems.length}) vs Firebase(${fbItemsSnapshot.size})`
    });
  }
  
  // 7.3 firebase_id 없는 항목
  const catsWithoutFbId = sqliteCategories.filter(c => !c.firebase_id);
  if (catsWithoutFbId.length > 0) {
    issues.push({
      type: 'MISSING_FIREBASE_ID',
      table: 'menu_categories',
      count: catsWithoutFbId.length,
      message: `firebase_id 없는 카테고리: ${catsWithoutFbId.length}개`
    });
  }
  
  const itemsWithoutFbId = sqliteItems.filter(i => !i.firebase_id);
  if (itemsWithoutFbId.length > 0) {
    issues.push({
      type: 'MISSING_FIREBASE_ID',
      table: 'menu_items',
      count: itemsWithoutFbId.length,
      message: `firebase_id 없는 메뉴 아이템: ${itemsWithoutFbId.length}개`
    });
  }
  
  // 7.4 posId 없는 Firebase 항목
  const fbCatsWithoutPosId = fbCatsSnapshot.docs.filter(doc => !doc.data().posId);
  if (fbCatsWithoutPosId.length > 0) {
    issues.push({
      type: 'MISSING_POS_ID',
      collection: 'menuCategories',
      count: fbCatsWithoutPosId.length,
      message: `posId 없는 Firebase 카테고리: ${fbCatsWithoutPosId.length}개`
    });
  }
  
  const fbItemsWithoutPosId = fbItemsSnapshot.docs.filter(doc => !doc.data().posId);
  if (fbItemsWithoutPosId.length > 0) {
    issues.push({
      type: 'MISSING_POS_ID',
      collection: 'menuItems',
      count: fbItemsWithoutPosId.length,
      message: `posId 없는 Firebase 아이템: ${fbItemsWithoutPosId.length}개`
    });
  }
  
  // 7.5 Modifier Groups 매칭
  if (sqliteModGroups.length !== fbModGroupsSnapshot.size) {
    issues.push({
      type: 'COUNT_MISMATCH',
      table: 'modifierGroups',
      sqlite: sqliteModGroups.length,
      firebase: fbModGroupsSnapshot.size,
      message: `Modifier Groups 개수 불일치: SQLite(${sqliteModGroups.length}) vs Firebase(${fbModGroupsSnapshot.size})`
    });
  }
  
  // 7.6 Tax Groups 매칭
  if (sqliteTaxGroups.length !== fbTaxGroupsSnapshot.size) {
    issues.push({
      type: 'COUNT_MISMATCH',
      table: 'taxGroups',
      sqlite: sqliteTaxGroups.length,
      firebase: fbTaxGroupsSnapshot.size,
      message: `Tax Groups 개수 불일치: SQLite(${sqliteTaxGroups.length}) vs Firebase(${fbTaxGroupsSnapshot.size})`
    });
  }
  
  // 7.7 Printer Groups 매칭
  if (sqlitePrinterGroups.length !== fbPrinterGroupsSnapshot.size) {
    issues.push({
      type: 'COUNT_MISMATCH',
      table: 'printerGroups',
      sqlite: sqlitePrinterGroups.length,
      firebase: fbPrinterGroupsSnapshot.size,
      message: `Printer Groups 개수 불일치: SQLite(${sqlitePrinterGroups.length}) vs Firebase(${fbPrinterGroupsSnapshot.size})`
    });
  }
  
  // 결과 출력
  if (issues.length === 0) {
    console.log('\n✅ 문제점 없음! 모든 데이터가 일치합니다.');
  } else {
    console.log(`\n⚠️ ${issues.length}개의 문제점 발견:\n`);
    issues.forEach((issue, i) => {
      console.log(`${i + 1}. [${issue.type}] ${issue.message}`);
    });
  }
  
  // ===============================
  // 8. ID 체계 요약
  // ===============================
  console.log('\n' + '='.repeat(80));
  console.log('📋 ID 체계 요약');
  console.log('='.repeat(80));
  
  console.log(`
┌─────────────────────────────────────────────────────────────────────────────┐
│ 테이블/컬렉션      │ SQLite PK        │ Firebase Doc ID    │ 매핑 필드      │
├─────────────────────────────────────────────────────────────────────────────┤
│ menus              │ menu_id (숫자)   │ 자동생성 (문자열)  │ firebase_id    │
│ menu_categories    │ category_id (숫자)│ 자동생성 (문자열)  │ firebase_id ↔ posId │
│ menu_items         │ item_id (숫자)   │ 자동생성 (문자열)  │ firebase_id ↔ posId │
│ modifier_groups    │ group_id (숫자)  │ 자동생성 (문자열)  │ (없음) ↔ posGroupId │
│ tax_groups         │ id (숫자)        │ 자동생성 (문자열)  │ (없음) ↔ posGroupId │
│ printer_groups     │ id (숫자)        │ 자동생성 (문자열)  │ (없음) ↔ posGroupId │
└─────────────────────────────────────────────────────────────────────────────┘

📌 ID 범위 (idGenerator 규칙):
   - menu_id: 100000 ~ 499999
   - category_id: 205000 ~ (동적)
   - item_id: 15000 ~ 29999 또는 225000 ~ (동적)
   - modifier group_id: 2000 ~ 2999 또는 340000 ~ (동적)
   - tax_groups id: 1 ~ (AUTOINCREMENT)
   - printer_groups id: 30 ~ (AUTOINCREMENT)
`);
  
  sqliteDb.close();
  process.exit(0);
}

compareData().catch(error => {
  console.error('❌ Error:', error);
  sqliteDb.close();
  process.exit(1);
});





