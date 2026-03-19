/**
 * 모디파이어와 세금 연결 상태 분석
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

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});

async function analyze() {
  console.log('═'.repeat(80));
  console.log('🔍 모디파이어 & 세금 연결 상태 분석');
  console.log('═'.repeat(80));
  
  const restaurantRef = firestore.collection('restaurants').doc(RESTAURANT_ID);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 1. POS 카테고리별 모디파이어 연결 확인
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('[1] POS 카테고리-모디파이어 연결 확인');
  console.log('─'.repeat(80));
  
  // category_modifier_links 테이블 확인
  const catModLinks = await dbAll(`
    SELECT cml.*, mc.name as category_name, mg.name as modifier_name, mg.firebase_id as modifier_firebase_id
    FROM category_modifier_links cml
    JOIN menu_categories mc ON cml.category_id = mc.category_id
    JOIN modifier_groups mg ON cml.modifier_group_id = mg.group_id
    WHERE mc.menu_id = 200005
  `);
  
  console.log(`\n   카테고리-모디파이어 연결: ${catModLinks.length}개`);
  
  if (catModLinks.length > 0) {
    const byCat = {};
    catModLinks.forEach(l => {
      byCat[l.category_name] = byCat[l.category_name] || [];
      byCat[l.category_name].push(l.modifier_name);
    });
    
    Object.entries(byCat).forEach(([cat, mods]) => {
      console.log(`   ${cat}: ${mods.join(', ')}`);
    });
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 2. POS 아이템별 모디파이어 연결 확인
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('[2] POS 아이템-모디파이어 연결 확인');
  console.log('─'.repeat(80));
  
  const itemModLinks = await dbAll(`
    SELECT iml.*, mi.name as item_name, mg.name as modifier_name, mg.firebase_id as modifier_firebase_id
    FROM menu_item_modifier_links iml
    JOIN menu_items mi ON iml.item_id = mi.item_id
    JOIN modifier_groups mg ON iml.menu_modifier_group_id = mg.group_id
    WHERE mi.menu_id = 200005
  `);
  
  console.log(`\n   아이템-모디파이어 연결: ${itemModLinks.length}개`);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Firebase 아이템 모디파이어 상태 확인
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('[3] Firebase 아이템 모디파이어 상태');
  console.log('─'.repeat(80));
  
  const fbItems = await restaurantRef.collection('menuItems').get();
  
  let withModifiers = 0;
  let withoutModifiers = 0;
  const itemsWithMods = [];
  const itemsWithoutMods = [];
  
  for (const doc of fbItems.docs) {
    const data = doc.data();
    if (data.modifierGroupIds && data.modifierGroupIds.length > 0) {
      withModifiers++;
      itemsWithMods.push({ name: data.name, mods: data.modifierGroupIds.length });
    } else {
      withoutModifiers++;
      itemsWithoutMods.push(data.name);
    }
  }
  
  console.log(`\n   모디파이어 있음: ${withModifiers}개`);
  console.log(`   모디파이어 없음: ${withoutModifiers}개`);
  
  if (itemsWithMods.length > 0) {
    console.log(`\n   모디파이어 있는 아이템:`);
    itemsWithMods.slice(0, 10).forEach(i => console.log(`      - ${i.name} (${i.mods}개)`));
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 4. SASHIMI, SPECIAL ROLL 카테고리 아이템 상세 확인
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('[4] SASHIMI, SPECIAL ROLL 카테고리 상세 확인');
  console.log('─'.repeat(80));
  
  // POS에서 해당 카테고리 아이템 조회
  const targetItems = await dbAll(`
    SELECT mi.*, mc.name as category_name, mc.firebase_id as category_firebase_id
    FROM menu_items mi
    JOIN menu_categories mc ON mi.category_id = mc.category_id
    WHERE mc.name LIKE '%SASHIMI%' OR mc.name LIKE '%ROLL%'
    ORDER BY mc.name, mi.name
  `);
  
  console.log(`\n   POS SASHIMI/ROLL 아이템: ${targetItems.length}개`);
  
  // 이 아이템들의 Firebase 상태
  for (const item of targetItems.slice(0, 10)) {
    if (item.firebase_id) {
      const fbDoc = await restaurantRef.collection('menuItems').doc(item.firebase_id).get();
      if (fbDoc.exists) {
        const fbData = fbDoc.data();
        const mods = fbData.modifierGroupIds || [];
        const taxes = fbData.taxGroupIds || [];
        console.log(`   ${item.category_name} | ${item.name}`);
        console.log(`      POS firebase_id: ${item.firebase_id}`);
        console.log(`      Firebase modifiers: ${mods.length > 0 ? mods.join(', ') : '없음'}`);
        console.log(`      Firebase taxes: ${taxes.length > 0 ? taxes.join(', ') : '없음'}`);
      }
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 5. 세금 연결 상태 확인
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('[5] 세금 연결 상태 확인');
  console.log('─'.repeat(80));
  
  // POS category_tax_links
  const catTaxLinks = await dbAll(`
    SELECT ctl.*, mc.name as category_name, tg.name as tax_name, tg.firebase_id as tax_firebase_id
    FROM category_tax_links ctl
    JOIN menu_categories mc ON ctl.category_id = mc.category_id
    JOIN tax_groups tg ON ctl.tax_group_id = tg.id
    WHERE mc.menu_id = 200005
  `);
  
  console.log(`\n   POS 카테고리-세금 연결: ${catTaxLinks.length}개`);
  
  // POS item_tax_links
  const itemTaxLinks = await dbAll(`
    SELECT itl.*, mi.name as item_name, tg.name as tax_name, tg.firebase_id as tax_firebase_id
    FROM menu_item_tax_links itl
    JOIN menu_items mi ON itl.item_id = mi.item_id
    JOIN tax_groups tg ON itl.tax_group_id = tg.id
    WHERE mi.menu_id = 200005
  `);
  
  console.log(`   POS 아이템-세금 연결: ${itemTaxLinks.length}개`);
  
  // Firebase 아이템 세금 상태
  let fbWithTax = 0;
  let fbWithoutTax = 0;
  
  for (const doc of fbItems.docs) {
    const data = doc.data();
    if (data.taxGroupIds && data.taxGroupIds.length > 0) {
      fbWithTax++;
    } else {
      fbWithoutTax++;
    }
  }
  
  console.log(`\n   Firebase 세금 있음: ${fbWithTax}개`);
  console.log(`   Firebase 세금 없음: ${fbWithoutTax}개`);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 6. Firebase 모디파이어 그룹 확인
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('[6] Firebase 모디파이어 그룹 확인');
  console.log('─'.repeat(80));
  
  const fbModifiers = await restaurantRef.collection('modifierGroups').get();
  
  console.log(`\n   Firebase 모디파이어 그룹: ${fbModifiers.size}개`);
  
  for (const doc of fbModifiers.docs) {
    const data = doc.data();
    const modCount = data.modifiers ? data.modifiers.length : 0;
    console.log(`   - ${data.name} (${modCount}개 옵션) | ID: ${doc.id}`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 결론
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(80));
  console.log('📊 분석 결론');
  console.log('═'.repeat(80));
  
  console.log(`
   문제점:
   1. POS category_modifier_links: ${catModLinks.length}개
      → Firebase menuItems.modifierGroupIds: ${withModifiers}개만 연결됨
   
   2. POS 세금 연결이 Firebase로 전달되지 않음
      → 모든 아이템에 기본 세금만 적용됨
   
   해결책:
   1. POS 카테고리-모디파이어 연결을 Firebase 아이템에 적용
   2. POS 세금 연결을 Firebase 아이템에 적용
  `);
  
  db.close();
  process.exit(0);
}

analyze().catch(err => {
  console.error('Analysis failed:', err);
  db.close();
  process.exit(1);
});
