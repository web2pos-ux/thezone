const firebaseService = require('./services/firebaseService');

const RESTAURANT_ID = 'tQcGkoSoKcwKdvL7WLiQ'; // Sushi Harbour Port Hardy

async function cleanupFirebaseMenu() {
  const db = firebaseService.getFirestore();
  const restaurantRef = db.collection('restaurants').doc(RESTAURANT_ID);
  
  console.log('🧹 Firebase 메뉴 데이터 정리 시작...\n');
  
  // 1. 모든 메뉴 삭제
  console.log('📁 menus 삭제 중...');
  const menus = await restaurantRef.collection('menus').get();
  for (const doc of menus.docs) {
    await doc.ref.delete();
  }
  console.log(`   ✅ ${menus.size}개 메뉴 삭제됨`);
  
  // 2. 모든 카테고리 삭제
  console.log('📁 menuCategories 삭제 중...');
  const categories = await restaurantRef.collection('menuCategories').get();
  for (const doc of categories.docs) {
    await doc.ref.delete();
  }
  console.log(`   ✅ ${categories.size}개 카테고리 삭제됨`);
  
  // 3. 모든 아이템 삭제
  console.log('📁 menuItems 삭제 중...');
  const items = await restaurantRef.collection('menuItems').get();
  for (const doc of items.docs) {
    await doc.ref.delete();
  }
  console.log(`   ✅ ${items.size}개 아이템 삭제됨`);
  
  // 4. 모든 모디파이어 그룹 삭제
  console.log('📁 modifierGroups 삭제 중...');
  const modGroups = await restaurantRef.collection('modifierGroups').get();
  for (const doc of modGroups.docs) {
    await doc.ref.delete();
  }
  console.log(`   ✅ ${modGroups.size}개 모디파이어 그룹 삭제됨`);
  
  // 5. 모든 세금 그룹 삭제
  console.log('📁 taxGroups 삭제 중...');
  const taxGroups = await restaurantRef.collection('taxGroups').get();
  for (const doc of taxGroups.docs) {
    await doc.ref.delete();
  }
  console.log(`   ✅ ${taxGroups.size}개 세금 그룹 삭제됨`);
  
  // 6. 모든 프린터 그룹 삭제
  console.log('📁 printerGroups 삭제 중...');
  const printerGroups = await restaurantRef.collection('printerGroups').get();
  for (const doc of printerGroups.docs) {
    await doc.ref.delete();
  }
  console.log(`   ✅ ${printerGroups.size}개 프린터 그룹 삭제됨`);
  
  // 7. 모든 연결 삭제
  const linkCollections = [
    'categoryModifierLinks',
    'itemModifierLinks', 
    'categoryTaxLinks',
    'itemTaxLinks',
    'categoryPrinterLinks',
    'itemPrinterLinks'
  ];
  
  for (const collName of linkCollections) {
    console.log(`📁 ${collName} 삭제 중...`);
    const links = await restaurantRef.collection(collName).get();
    for (const doc of links.docs) {
      await doc.ref.delete();
    }
    console.log(`   ✅ ${links.size}개 삭제됨`);
  }
  
  console.log('\n✅ Firebase 메뉴 데이터 정리 완료!');
  console.log('\n🚀 이제 POS에서 "Full Sync to TZO Cloud" 버튼을 눌러주세요.');
  
  process.exit(0);
}

cleanupFirebaseMenu().catch(err => {
  console.error('❌ 오류:', err);
  process.exit(1);
});








