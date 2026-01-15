/**
 * Firebase price1 -> price 마이그레이션 스크립트
 * 기존 menuItems의 price1 필드를 price로 복사
 */

const admin = require('firebase-admin');
const path = require('path');

// Firebase Admin 초기화
const serviceAccountPath = path.join(__dirname, '../config/firebase-service-account.json');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require(serviceAccountPath))
  });
}

const firestore = admin.firestore();
const RESTAURANT_ID = 'tQcGkoSoKcwKdvL7WLiQ';

async function migratePriceField() {
  console.log('='.repeat(60));
  console.log('Firebase price1 -> price Migration');
  console.log('='.repeat(60));
  console.log('Restaurant ID:', RESTAURANT_ID);
  
  const restaurantRef = firestore.collection('restaurants').doc(RESTAURANT_ID);
  
  // 1. menuItems 마이그레이션
  console.log('\n[1] Migrating menuItems...');
  const itemsSnapshot = await restaurantRef.collection('menuItems').get();
  
  let updatedCount = 0;
  let skippedCount = 0;
  
  const batch = firestore.batch();
  
  itemsSnapshot.forEach(doc => {
    const data = doc.data();
    
    // price1이 있고 price가 없거나 다른 경우 업데이트
    if (data.price1 !== undefined) {
      const updates = {
        price: data.price1,  // price1 값을 price로 복사
        updatedAt: new Date()
      };
      
      // price1 필드 삭제 (선택사항 - 남겨두면 호환성 유지)
      // updates.price1 = admin.firestore.FieldValue.delete();
      
      batch.update(doc.ref, updates);
      updatedCount++;
      console.log(`  - ${data.name}: price1=${data.price1} -> price=${data.price1}`);
    } else if (data.price !== undefined) {
      skippedCount++;
    }
  });
  
  if (updatedCount > 0) {
    await batch.commit();
    console.log(`\nUpdated: ${updatedCount} items`);
  }
  console.log(`Skipped: ${skippedCount} items (already have price)`);
  
  console.log('\n' + '='.repeat(60));
  console.log('Migration completed!');
  console.log('='.repeat(60));
  
  // 결과 확인
  console.log('\n[Verification] Sample items after migration:');
  const sampleItems = await restaurantRef.collection('menuItems').limit(5).get();
  sampleItems.forEach(doc => {
    const data = doc.data();
    console.log(`  - ${data.name}: price=${data.price}, price1=${data.price1}, price2=${data.price2}`);
  });
  
  process.exit(0);
}

migratePriceField().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
