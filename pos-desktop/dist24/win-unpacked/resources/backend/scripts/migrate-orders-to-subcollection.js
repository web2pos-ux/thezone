/**
 * 주문 데이터를 글로벌 컬렉션에서 서브컬렉션으로 마이그레이션
 * 
 * 변경: orders (글로벌) → restaurants/{id}/orders (서브컬렉션)
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

async function migrateOrders() {
  console.log('='.repeat(80));
  console.log('🚚 주문 데이터 마이그레이션: 글로벌 → 서브컬렉션');
  console.log('='.repeat(80));
  console.log('Restaurant ID:', RESTAURANT_ID);
  
  // 1. 글로벌 컬렉션에서 주문 조회
  console.log('\n[1] 글로벌 orders 컬렉션에서 주문 조회...');
  const globalOrders = await firestore.collection('orders')
    .where('restaurantId', '==', RESTAURANT_ID)
    .get();
  
  console.log(`   발견된 주문: ${globalOrders.size}개`);
  
  if (globalOrders.size === 0) {
    console.log('   마이그레이션할 주문이 없습니다.');
    process.exit(0);
  }
  
  // 2. 서브컬렉션으로 복사
  console.log('\n[2] 서브컬렉션으로 복사...');
  const restaurantRef = firestore.collection('restaurants').doc(RESTAURANT_ID);
  
  let copiedCount = 0;
  let errorCount = 0;
  
  for (const doc of globalOrders.docs) {
    try {
      const data = doc.data();
      
      // 서브컬렉션에 동일한 ID로 생성
      await restaurantRef.collection('orders').doc(doc.id).set({
        ...data,
        migratedAt: new Date(),
        originalCollection: 'orders (global)'
      });
      
      copiedCount++;
      
      if (copiedCount <= 5) {
        console.log(`   + Copied: Order #${data.orderNumber || doc.id}`);
      } else if (copiedCount === 6) {
        console.log(`   ... (${globalOrders.size - 5} more)`);
      }
    } catch (err) {
      console.log(`   - Error copying ${doc.id}:`, err.message);
      errorCount++;
    }
  }
  
  console.log(`\n   복사 완료: ${copiedCount}개, 에러: ${errorCount}개`);
  
  // 3. 글로벌 컬렉션에서 삭제 (선택사항 - 확인 후 삭제)
  console.log('\n[3] 글로벌 컬렉션에서 삭제...');
  console.log('   ⚠️  글로벌 컬렉션 데이터는 유지됩니다 (안전을 위해)');
  console.log('   ⚠️  수동으로 삭제하려면 아래 코드 주석 해제');
  
  /*
  // 글로벌 컬렉션에서 삭제
  let deletedCount = 0;
  for (const doc of globalOrders.docs) {
    await doc.ref.delete();
    deletedCount++;
  }
  console.log(`   삭제 완료: ${deletedCount}개`);
  */
  
  // 4. 결과 확인
  console.log('\n[4] 결과 확인...');
  const subcollectionOrders = await restaurantRef.collection('orders').get();
  console.log(`   글로벌 컬렉션: ${globalOrders.size}개`);
  console.log(`   서브컬렉션: ${subcollectionOrders.size}개`);
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 마이그레이션 완료');
  console.log('='.repeat(80));
  console.log(`   - 복사된 주문: ${copiedCount}개`);
  console.log(`   - 글로벌 컬렉션: 유지됨 (수동 삭제 필요)`);
  console.log(`   - 서브컬렉션: restaurants/${RESTAURANT_ID}/orders`);
  
  process.exit(0);
}

migrateOrders().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
