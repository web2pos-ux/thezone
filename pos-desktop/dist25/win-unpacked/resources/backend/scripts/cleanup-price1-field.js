/**
 * Firebase menuItems에서 price1 → price 마이그레이션
 * - price1 값을 price로 복사
 * - 중복 방지를 위해 price가 이미 있으면 건너뜀
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

async function cleanupPrice1Field() {
  console.log('═'.repeat(60));
  console.log('💰 Firebase price1 → price 마이그레이션');
  console.log('═'.repeat(60));
  
  const restaurantRef = firestore.collection('restaurants').doc(RESTAURANT_ID);
  const menuItems = await restaurantRef.collection('menuItems').get();
  
  console.log(`\n총 아이템: ${menuItems.size}개`);
  
  let migratedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  
  const batch = firestore.batch();
  let batchCount = 0;
  
  for (const doc of menuItems.docs) {
    const data = doc.data();
    
    // price1이 있고 price가 없거나 0인 경우
    if (data.price1 !== undefined && (data.price === undefined || data.price === 0)) {
      batch.update(doc.ref, { 
        price: data.price1,
        updatedAt: new Date()
      });
      migratedCount++;
      batchCount++;
      
      if (migratedCount <= 5) {
        console.log(`   + ${data.name}: price1(${data.price1}) → price`);
      }
    } else if (data.price !== undefined && data.price > 0) {
      skippedCount++;
    }
    
    // Batch 제한 (500개)
    if (batchCount >= 450) {
      await batch.commit();
      console.log(`   ... batch committed (${batchCount})`);
      batchCount = 0;
    }
  }
  
  // 남은 배치 커밋
  if (batchCount > 0) {
    await batch.commit();
  }
  
  console.log(`\n결과:`);
  console.log(`   ✅ 마이그레이션: ${migratedCount}개`);
  console.log(`   ⏭️  건너뜀 (이미 price 있음): ${skippedCount}개`);
  console.log(`   ❌ 에러: ${errorCount}개`);
  
  // 검증
  console.log(`\n검증:`);
  const verifyItems = await restaurantRef.collection('menuItems').get();
  let withPrice = 0;
  let withPrice1 = 0;
  
  for (const doc of verifyItems.docs) {
    const data = doc.data();
    if (data.price !== undefined && data.price > 0) withPrice++;
    if (data.price1 !== undefined) withPrice1++;
  }
  
  console.log(`   - price 필드 있음: ${withPrice}개`);
  console.log(`   - price1 필드 있음: ${withPrice1}개 (레거시)`);
  
  console.log('\n═'.repeat(60));
  console.log('✅ 마이그레이션 완료!');
  console.log('═'.repeat(60));
  
  process.exit(0);
}

cleanupPrice1Field().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
