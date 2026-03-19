/**
 * 🔧 Firebase Critical 문제 수정
 * 
 * 1. menuItems에 restaurantId 추가
 * 2. menuCategories에 restaurantId 추가
 * 3. createdAt 타임스탬프 추가
 */

const admin = require('firebase-admin');
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

async function fixCriticalIssues() {
  console.log('═'.repeat(60));
  console.log('🔧 Firebase Critical 문제 수정');
  console.log('═'.repeat(60));
  console.log(`Restaurant ID: ${RESTAURANT_ID}\n`);
  
  const restaurantRef = firestore.collection('restaurants').doc(RESTAURANT_ID);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 1. menuItems에 restaurantId 추가
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('─'.repeat(60));
  console.log('[1] menuItems restaurantId 추가');
  console.log('─'.repeat(60));
  
  const menuItems = await restaurantRef.collection('menuItems').get();
  let itemsFixed = 0;
  
  const itemBatch = firestore.batch();
  let batchCount = 0;
  
  for (const doc of menuItems.docs) {
    const data = doc.data();
    const updates = {};
    
    if (!data.restaurantId) {
      updates.restaurantId = RESTAURANT_ID;
    }
    
    if (!data.createdAt) {
      updates.createdAt = data.updatedAt || new Date();
    }
    
    if (Object.keys(updates).length > 0) {
      itemBatch.update(doc.ref, updates);
      itemsFixed++;
      batchCount++;
    }
    
    // Batch 제한 (500개)
    if (batchCount >= 450) {
      await itemBatch.commit();
      console.log(`   ... batch committed (${batchCount})`);
      batchCount = 0;
    }
  }
  
  if (batchCount > 0) {
    await itemBatch.commit();
  }
  
  console.log(`   ✅ menuItems 수정: ${itemsFixed}개`);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 2. menuCategories에 restaurantId 추가
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(60));
  console.log('[2] menuCategories restaurantId 추가');
  console.log('─'.repeat(60));
  
  const menuCategories = await restaurantRef.collection('menuCategories').get();
  let catsFixed = 0;
  
  const catBatch = firestore.batch();
  
  for (const doc of menuCategories.docs) {
    const data = doc.data();
    const updates = {};
    
    if (!data.restaurantId) {
      updates.restaurantId = RESTAURANT_ID;
    }
    
    if (!data.createdAt) {
      updates.createdAt = data.updatedAt || new Date();
    }
    
    if (Object.keys(updates).length > 0) {
      catBatch.update(doc.ref, updates);
      catsFixed++;
    }
  }
  
  if (catsFixed > 0) {
    await catBatch.commit();
  }
  
  console.log(`   ✅ menuCategories 수정: ${catsFixed}개`);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 3. modifierGroups에 restaurantId 추가
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(60));
  console.log('[3] modifierGroups restaurantId 추가');
  console.log('─'.repeat(60));
  
  const modifierGroups = await restaurantRef.collection('modifierGroups').get();
  let modsFixed = 0;
  
  const modBatch = firestore.batch();
  
  for (const doc of modifierGroups.docs) {
    const data = doc.data();
    const updates = {};
    
    if (!data.restaurantId) {
      updates.restaurantId = RESTAURANT_ID;
    }
    
    if (!data.createdAt) {
      updates.createdAt = data.updatedAt || new Date();
    }
    
    if (Object.keys(updates).length > 0) {
      modBatch.update(doc.ref, updates);
      modsFixed++;
    }
  }
  
  if (modsFixed > 0) {
    await modBatch.commit();
  }
  
  console.log(`   ✅ modifierGroups 수정: ${modsFixed}개`);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 4. taxGroups, printerGroups에 restaurantId 추가
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(60));
  console.log('[4] taxGroups, printerGroups restaurantId 추가');
  console.log('─'.repeat(60));
  
  const collections = ['taxGroups', 'printerGroups'];
  
  for (const colName of collections) {
    const col = await restaurantRef.collection(colName).get();
    let fixed = 0;
    
    const batch = firestore.batch();
    
    for (const doc of col.docs) {
      const data = doc.data();
      if (!data.restaurantId) {
        batch.update(doc.ref, { 
          restaurantId: RESTAURANT_ID,
          createdAt: data.updatedAt || new Date()
        });
        fixed++;
      }
    }
    
    if (fixed > 0) {
      await batch.commit();
    }
    
    console.log(`   ✅ ${colName} 수정: ${fixed}개`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 검증
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(60));
  console.log('📊 수정 후 검증');
  console.log('═'.repeat(60));
  
  // 재조회
  const verifyItems = await restaurantRef.collection('menuItems').get();
  let itemsWithRestId = 0;
  for (const doc of verifyItems.docs) {
    if (doc.data().restaurantId) itemsWithRestId++;
  }
  
  const verifyCats = await restaurantRef.collection('menuCategories').get();
  let catsWithRestId = 0;
  for (const doc of verifyCats.docs) {
    if (doc.data().restaurantId) catsWithRestId++;
  }
  
  console.log(`\n   menuItems: ${itemsWithRestId}/${verifyItems.size} restaurantId 있음`);
  console.log(`   menuCategories: ${catsWithRestId}/${verifyCats.size} restaurantId 있음`);
  
  const allFixed = itemsWithRestId === verifyItems.size && catsWithRestId === verifyCats.size;
  
  console.log('\n' + '═'.repeat(60));
  if (allFixed) {
    console.log('✅ 모든 Critical 문제 수정 완료!');
  } else {
    console.log('⚠️  일부 문제 남음 - 다시 실행 필요');
  }
  console.log('═'.repeat(60));
  
  process.exit(allFixed ? 0 : 1);
}

fixCriticalIssues().catch(err => {
  console.error('Fix failed:', err);
  process.exit(1);
});
