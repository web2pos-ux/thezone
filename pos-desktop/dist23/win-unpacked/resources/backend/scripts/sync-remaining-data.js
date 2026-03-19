/**
 * 🔄 남은 데이터 Firebase 동기화
 * 
 * 1. 미동기화 modifier_groups 처리
 * 2. 미동기화 tax_groups 처리
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

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function(err) {
    if (err) reject(err);
    else resolve({ lastID: this.lastID, changes: this.changes });
  });
});

async function syncRemainingData() {
  console.log('═'.repeat(70));
  console.log('🔄 남은 데이터 Firebase 동기화');
  console.log('═'.repeat(70));
  
  const restaurantRef = firestore.collection('restaurants').doc(RESTAURANT_ID);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 1. modifier_groups 분석 및 정리
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(70));
  console.log('[1] modifier_groups 분석');
  console.log('─'.repeat(70));
  
  const posModifiers = await dbAll('SELECT * FROM modifier_groups');
  const fbModifiers = await restaurantRef.collection('modifierGroups').get();
  
  console.log(`   POS: ${posModifiers.length}개`);
  console.log(`   Firebase: ${fbModifiers.size}개`);
  
  // firebase_id가 있는 것
  const syncedModifiers = posModifiers.filter(m => m.firebase_id);
  const unsyncedModifiers = posModifiers.filter(m => !m.firebase_id);
  
  console.log(`   동기화됨: ${syncedModifiers.length}개`);
  console.log(`   미동기화: ${unsyncedModifiers.length}개`);
  
  if (unsyncedModifiers.length > 0) {
    console.log('\n   미동기화 그룹:');
    unsyncedModifiers.forEach(m => {
      console.log(`      - ${m.group_id}: ${m.name}`);
    });
    
    // 미동기화 그룹 중 실제 사용되는 것만 동기화
    // (menu_item_modifier_links에 연결된 것 또는 유효한 이름을 가진 것)
    console.log('\n   불필요한 중복/테스트 그룹은 삭제 대상:');
    
    // 테스트 데이터 패턴
    const testPatterns = ['1111', 'Asize', 'Age Size', 'Wakame Size', 'Edamame Size', 'Eda Size'];
    const testGroups = unsyncedModifiers.filter(m => 
      testPatterns.some(p => m.name.includes(p)) ||
      m.name.length <= 2
    );
    
    if (testGroups.length > 0) {
      console.log(`   테스트/불필요 그룹: ${testGroups.length}개`);
      
      // 삭제
      for (const group of testGroups) {
        // modifier_groups만 삭제 (modifiers는 별도 테이블 구조)
        await dbRun('DELETE FROM modifier_groups WHERE group_id = ?', [group.group_id]);
        console.log(`      - Deleted: ${group.name}`);
      }
    }
    
    // 유효한 그룹 중 Firebase에 없는 것 동기화
    const validUnsynced = unsyncedModifiers.filter(m => 
      !testPatterns.some(p => m.name.includes(p)) &&
      m.name.length > 2
    );
    
    console.log(`\n   유효한 미동기화 그룹: ${validUnsynced.length}개`);
    
    // 이미 Firebase에 같은 이름의 그룹이 있는지 확인
    const fbModifierNames = new Map();
    fbModifiers.docs.forEach(doc => {
      fbModifierNames.set(doc.data().name, doc.id);
    });
    
    for (const group of validUnsynced) {
      // 같은 이름의 그룹이 Firebase에 있으면 연결만
      if (fbModifierNames.has(group.name)) {
        const fbId = fbModifierNames.get(group.name);
        await dbRun('UPDATE modifier_groups SET firebase_id = ? WHERE group_id = ?', [fbId, group.group_id]);
        console.log(`      Linked: ${group.name} → ${fbId}`);
      }
      // 없으면 무시 (필요시 생성)
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 2. tax_groups 동기화
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(70));
  console.log('[2] tax_groups 분석');
  console.log('─'.repeat(70));
  
  const posTaxGroups = await dbAll('SELECT * FROM tax_groups');
  const fbTaxGroups = await restaurantRef.collection('taxGroups').get();
  
  console.log(`   POS: ${posTaxGroups.length}개`);
  console.log(`   Firebase: ${fbTaxGroups.size}개`);
  
  // 미동기화 세금 그룹
  const unsyncedTax = posTaxGroups.filter(t => !t.firebase_id);
  
  if (unsyncedTax.length > 0) {
    console.log(`\n   미동기화 세금 그룹:`);
    unsyncedTax.forEach(t => {
      console.log(`      - ${t.id}: ${t.name} (active: ${t.is_active})`);
    });
    
    // 비활성 그룹은 동기화 대상에서 제외
    const activeTax = unsyncedTax.filter(t => t.is_active === 1);
    
    if (activeTax.length > 0) {
      console.log(`\n   활성 상태 미동기화 그룹 Firebase에 추가:`);
      
      for (const tax of activeTax) {
        const docRef = await restaurantRef.collection('taxGroups').add({
          name: tax.name,
          restaurantId: RESTAURANT_ID,
          isActive: true,
          posId: tax.id,
          createdAt: new Date(),
          updatedAt: new Date()
        });
        
        await dbRun('UPDATE tax_groups SET firebase_id = ? WHERE id = ?', [docRef.id, tax.id]);
        console.log(`      + Added: ${tax.name} → ${docRef.id}`);
      }
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 최종 상태
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(70));
  console.log('📊 최종 상태');
  console.log('═'.repeat(70));
  
  const finalMods = await dbAll('SELECT COUNT(*) as total, SUM(CASE WHEN firebase_id IS NOT NULL THEN 1 ELSE 0 END) as synced FROM modifier_groups');
  const finalTax = await dbAll('SELECT COUNT(*) as total, SUM(CASE WHEN firebase_id IS NOT NULL THEN 1 ELSE 0 END) as synced FROM tax_groups');
  
  console.log(`\n   modifier_groups: ${finalMods[0].synced}/${finalMods[0].total} 동기화`);
  console.log(`   tax_groups: ${finalTax[0].synced}/${finalTax[0].total} 동기화`);
  
  console.log('\n' + '═'.repeat(70));
  console.log('✅ 동기화 완료!');
  console.log('═'.repeat(70));
  
  db.close();
  process.exit(0);
}

syncRemainingData().catch(err => {
  console.error('Sync failed:', err);
  db.close();
  process.exit(1);
});
