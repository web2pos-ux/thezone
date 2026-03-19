/**
 * POS → Firebase 동기화 문제 수정 스크립트
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

async function fixSyncIssues() {
  console.log('='.repeat(80));
  console.log('🔧 POS → Firebase 동기화 문제 수정');
  console.log('='.repeat(80));
  
  const restaurantRef = firestore.collection('restaurants').doc(RESTAURANT_ID);
  
  // ============================================
  // 1. 불일치 아이템 수정 (firebase_id는 있지만 Firebase 문서 없음)
  // ============================================
  console.log('\n[1] 불일치 아이템 수정...');
  
  const posItems = await dbAll(`SELECT * FROM menu_items WHERE menu_id = 200005 AND firebase_id IS NOT NULL`);
  let fixedCount = 0;
  let clearedCount = 0;
  
  for (const item of posItems) {
    const fbDoc = await restaurantRef.collection('menuItems').doc(item.firebase_id).get();
    
    if (!fbDoc.exists) {
      // Firebase 문서가 없으면 firebase_id 초기화
      await dbRun(`UPDATE menu_items SET firebase_id = NULL WHERE item_id = ?`, [item.item_id]);
      clearedCount++;
      console.log(`   - Cleared firebase_id: ${item.name}`);
    }
  }
  
  console.log(`   Cleared ${clearedCount} invalid firebase_ids`);
  
  // 이제 firebase_id가 없는 아이템들을 Firebase에 업로드
  const itemsToUpload = await dbAll(`SELECT * FROM menu_items WHERE menu_id = 200005 AND firebase_id IS NULL`);
  
  console.log(`\n[2] ${itemsToUpload.length}개 아이템 Firebase 업로드...`);
  
  for (const item of itemsToUpload) {
    // 카테고리의 Firebase ID 찾기
    const category = await dbAll(`SELECT firebase_id FROM menu_categories WHERE category_id = ?`, [item.category_id]);
    const categoryFirebaseId = category[0]?.firebase_id;
    
    if (!categoryFirebaseId) {
      console.log(`   - Skip (no category): ${item.name}`);
      continue;
    }
    
    // Firebase에 추가
    const docRef = await restaurantRef.collection('menuItems').add({
      restaurantId: RESTAURANT_ID,
      categoryId: categoryFirebaseId,
      name: item.name,
      shortName: item.short_name || '',
      description: item.description || '',
      price: item.price || 0,
      price2: item.price2 || 0,
      imageUrl: item.image_url || '',
      isAvailable: true,
      sortOrder: item.sort_order || 0,
      posId: item.item_id,
      modifierGroupIds: [],
      taxGroupIds: [],
      printerGroupIds: [],
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    // POS에 firebase_id 저장
    await dbRun(`UPDATE menu_items SET firebase_id = ? WHERE item_id = ?`, [docRef.id, item.item_id]);
    fixedCount++;
    console.log(`   + Uploaded: ${item.name} (${docRef.id})`);
  }
  
  console.log(`   Fixed ${fixedCount} items`);
  
  // ============================================
  // 3. Orphan 아이템 처리 (Firebase에만 있고 POS에 없는 아이템)
  // ============================================
  console.log('\n[3] Orphan 아이템 처리...');
  
  const fbItems = await restaurantRef.collection('menuItems').get();
  let orphanCount = 0;
  
  for (const doc of fbItems.docs) {
    const data = doc.data();
    if (!data.posId) {
      // posId가 없는 아이템 - POS와 연동되지 않음
      console.log(`   - Orphan found: ${data.name} (${doc.id})`);
      orphanCount++;
      
      // 선택: 삭제하거나 그대로 둠
      // await doc.ref.delete();
      // console.log(`   - Deleted: ${data.name}`);
    }
  }
  
  console.log(`   Found ${orphanCount} orphan items (not deleted, manual review needed)`);
  
  // ============================================
  // 4. 모디파이어 연결 동기화
  // ============================================
  console.log('\n[4] 모디파이어 연결 동기화...');
  
  // POS에서 아이템-모디파이어 연결 정보 가져오기
  // 테이블 구조: menu_item_modifier_links(id, item_id, menu_modifier_group_id, created_at)
  const itemModifierLinks = await dbAll(`
    SELECT mil.item_id, mil.menu_modifier_group_id as group_id, mg.firebase_id as modifier_firebase_id
    FROM menu_item_modifier_links mil
    JOIN modifier_groups mg ON mil.menu_modifier_group_id = mg.group_id
    WHERE mg.firebase_id IS NOT NULL
  `);
  
  // 아이템별로 그룹화
  const itemModifierMap = new Map();
  for (const link of itemModifierLinks) {
    if (!itemModifierMap.has(link.item_id)) {
      itemModifierMap.set(link.item_id, []);
    }
    itemModifierMap.get(link.item_id).push(link.modifier_firebase_id);
  }
  
  let modifierFixedCount = 0;
  
  for (const [itemId, modifierIds] of itemModifierMap) {
    // 해당 아이템의 firebase_id 찾기
    const item = await dbAll(`SELECT firebase_id FROM menu_items WHERE item_id = ?`, [itemId]);
    const itemFirebaseId = item[0]?.firebase_id;
    
    if (itemFirebaseId && modifierIds.length > 0) {
      // Firebase 문서 업데이트
      await restaurantRef.collection('menuItems').doc(itemFirebaseId).update({
        modifierGroupIds: modifierIds,
        updatedAt: new Date()
      });
      modifierFixedCount++;
    }
  }
  
  console.log(`   Updated ${modifierFixedCount} items with modifier connections`);
  
  // ============================================
  // 결과 요약
  // ============================================
  console.log('\n' + '='.repeat(80));
  console.log('📊 수정 완료 요약');
  console.log('='.repeat(80));
  console.log(`   - 무효한 firebase_id 초기화: ${clearedCount}개`);
  console.log(`   - 신규 Firebase 업로드: ${fixedCount}개`);
  console.log(`   - Orphan 아이템 발견: ${orphanCount}개 (수동 검토 필요)`);
  console.log(`   - 모디파이어 연결 업데이트: ${modifierFixedCount}개`);
  
  db.close();
  process.exit(0);
}

fixSyncIssues().catch(err => {
  console.error('Fix failed:', err);
  db.close();
  process.exit(1);
});
