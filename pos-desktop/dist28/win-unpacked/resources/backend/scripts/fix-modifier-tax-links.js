/**
 * 🔧 모디파이어 & 세금 연결 수정
 * 
 * 1. POS 카테고리-모디파이어 연결을 Firebase 아이템에 적용
 * 2. POS 카테고리-세금 연결을 Firebase 아이템에 적용
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

async function fixLinks() {
  console.log('═'.repeat(80));
  console.log('🔧 모디파이어 & 세금 연결 수정');
  console.log('═'.repeat(80));
  
  const restaurantRef = firestore.collection('restaurants').doc(RESTAURANT_ID);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 1. POS 카테고리-모디파이어 연결 조회
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('[1] POS 카테고리-모디파이어 연결 조회');
  console.log('─'.repeat(80));
  
  const catModLinks = await dbAll(`
    SELECT cml.category_id, mc.name as category_name, mc.firebase_id as category_firebase_id,
           mg.group_id, mg.name as modifier_name, mg.firebase_id as modifier_firebase_id
    FROM category_modifier_links cml
    JOIN menu_categories mc ON cml.category_id = mc.category_id
    JOIN modifier_groups mg ON cml.modifier_group_id = mg.group_id
    WHERE mc.menu_id = 200005 AND mg.firebase_id IS NOT NULL
  `);
  
  console.log(`\n   카테고리-모디파이어 연결 (Firebase ID 있음): ${catModLinks.length}개`);
  
  // 카테고리별 모디파이어 맵 생성
  const categoryModifierMap = new Map();
  
  for (const link of catModLinks) {
    const catFbId = link.category_firebase_id;
    if (!categoryModifierMap.has(catFbId)) {
      categoryModifierMap.set(catFbId, {
        categoryName: link.category_name,
        modifiers: []
      });
    }
    categoryModifierMap.get(catFbId).modifiers.push(link.modifier_firebase_id);
    console.log(`   ${link.category_name} → ${link.modifier_name} (${link.modifier_firebase_id})`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 2. POS 카테고리-세금 연결 조회
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('[2] POS 카테고리-세금 연결 조회');
  console.log('─'.repeat(80));
  
  const catTaxLinks = await dbAll(`
    SELECT ctl.category_id, mc.name as category_name, mc.firebase_id as category_firebase_id,
           tg.id as tax_id, tg.name as tax_name, tg.firebase_id as tax_firebase_id
    FROM category_tax_links ctl
    JOIN menu_categories mc ON ctl.category_id = mc.category_id
    JOIN tax_groups tg ON ctl.tax_group_id = tg.id
    WHERE mc.menu_id = 200005 AND tg.firebase_id IS NOT NULL
  `);
  
  console.log(`\n   카테고리-세금 연결 (Firebase ID 있음): ${catTaxLinks.length}개`);
  
  // 카테고리별 세금 맵 생성
  const categoryTaxMap = new Map();
  
  for (const link of catTaxLinks) {
    const catFbId = link.category_firebase_id;
    if (!categoryTaxMap.has(catFbId)) {
      categoryTaxMap.set(catFbId, {
        categoryName: link.category_name,
        taxes: []
      });
    }
    if (!categoryTaxMap.get(catFbId).taxes.includes(link.tax_firebase_id)) {
      categoryTaxMap.get(catFbId).taxes.push(link.tax_firebase_id);
    }
  }
  
  // 출력
  for (const [catId, data] of categoryTaxMap) {
    console.log(`   ${data.categoryName} → ${data.taxes.length}개 세금 그룹`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Firebase 아이템에 모디파이어 적용
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('[3] Firebase 아이템에 모디파이어 & 세금 적용');
  console.log('─'.repeat(80));
  
  const fbItems = await restaurantRef.collection('menuItems').get();
  
  let modifierUpdated = 0;
  let taxUpdated = 0;
  let alreadyHasModifiers = 0;
  
  const batch = firestore.batch();
  let batchCount = 0;
  
  for (const doc of fbItems.docs) {
    const data = doc.data();
    const categoryId = data.categoryId;
    
    let updates = {};
    let needsUpdate = false;
    
    // 모디파이어 적용
    if (categoryModifierMap.has(categoryId)) {
      const catMods = categoryModifierMap.get(categoryId).modifiers;
      const existingMods = data.modifierGroupIds || [];
      
      // 기존 모디파이어 + 카테고리 모디파이어 합치기 (중복 제거)
      const allMods = [...new Set([...existingMods, ...catMods])];
      
      if (allMods.length > existingMods.length) {
        updates.modifierGroupIds = allMods;
        needsUpdate = true;
        modifierUpdated++;
        console.log(`   + ${data.name}: 모디파이어 ${existingMods.length} → ${allMods.length}개`);
      } else {
        alreadyHasModifiers++;
      }
    }
    
    // 세금 적용 - 카테고리별 세금이 있으면 적용, 없으면 기본 세금 유지
    if (categoryTaxMap.has(categoryId)) {
      const catTaxes = categoryTaxMap.get(categoryId).taxes;
      const existingTaxes = data.taxGroupIds || [];
      
      // 카테고리 세금으로 교체 (더 정확함)
      if (JSON.stringify(existingTaxes.sort()) !== JSON.stringify(catTaxes.sort())) {
        updates.taxGroupIds = catTaxes;
        needsUpdate = true;
        taxUpdated++;
      }
    }
    
    if (needsUpdate) {
      updates.updatedAt = new Date();
      batch.update(doc.ref, updates);
      batchCount++;
    }
    
    // Batch 제한
    if (batchCount >= 450) {
      await batch.commit();
      console.log(`   ... batch committed (${batchCount})`);
      batchCount = 0;
    }
  }
  
  if (batchCount > 0) {
    await batch.commit();
  }
  
  console.log(`\n   ✅ 모디파이어 업데이트: ${modifierUpdated}개 아이템`);
  console.log(`   ✅ 세금 업데이트: ${taxUpdated}개 아이템`);
  console.log(`   ⏭️  이미 모디파이어 있음: ${alreadyHasModifiers}개 아이템`);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 4. 검증
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('[4] 수정 후 검증');
  console.log('─'.repeat(80));
  
  const verifyItems = await restaurantRef.collection('menuItems').get();
  
  let withMods = 0;
  let withTaxes = 0;
  
  // 카테고리별 통계
  const catStats = {};
  
  for (const doc of verifyItems.docs) {
    const data = doc.data();
    const catId = data.categoryId;
    
    if (!catStats[catId]) {
      catStats[catId] = { total: 0, withMods: 0, withTaxes: 0, name: '' };
    }
    catStats[catId].total++;
    
    if (data.modifierGroupIds && data.modifierGroupIds.length > 0) {
      withMods++;
      catStats[catId].withMods++;
    }
    
    if (data.taxGroupIds && data.taxGroupIds.length > 0) {
      withTaxes++;
      catStats[catId].withTaxes++;
    }
  }
  
  // 카테고리 이름 조회
  const fbCategories = await restaurantRef.collection('menuCategories').get();
  for (const doc of fbCategories.docs) {
    if (catStats[doc.id]) {
      catStats[doc.id].name = doc.data().name;
    }
  }
  
  console.log(`\n   전체 통계:`);
  console.log(`   - 모디파이어 있음: ${withMods}/${verifyItems.size}개 (${Math.round(withMods/verifyItems.size*100)}%)`);
  console.log(`   - 세금 있음: ${withTaxes}/${verifyItems.size}개 (${Math.round(withTaxes/verifyItems.size*100)}%)`);
  
  console.log(`\n   주요 카테고리별 통계:`);
  const targetCats = ['SASHIMI', 'SPECIAL ROLL', 'LUNCH SPECIAL', 'SALADS'];
  
  for (const [catId, stats] of Object.entries(catStats)) {
    if (targetCats.some(t => stats.name.includes(t))) {
      console.log(`   ${stats.name}:`);
      console.log(`      - 모디파이어: ${stats.withMods}/${stats.total}개`);
      console.log(`      - 세금: ${stats.withTaxes}/${stats.total}개`);
    }
  }
  
  console.log('\n' + '═'.repeat(80));
  console.log('✅ 모디파이어 & 세금 연결 수정 완료!');
  console.log('═'.repeat(80));
  
  db.close();
  process.exit(0);
}

fixLinks().catch(err => {
  console.error('Fix failed:', err);
  db.close();
  process.exit(1);
});
