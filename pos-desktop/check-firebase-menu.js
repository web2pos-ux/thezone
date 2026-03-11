// Firebase 메뉴 상태 확인 스크립트
const firebaseService = require('./services/firebaseService');

async function checkFirebaseMenu() {
  try {
    console.log('\n=== Firebase 레스토랑 목록 확인 ===');
    
    const firestore = firebaseService.getFirestore();
    
    // 모든 레스토랑 목록
    const restSnap = await firestore.collection('restaurants').get();
    console.log('총 레스토랑 수:', restSnap.size);
    
    for (const doc of restSnap.docs) {
      const data = doc.data();
      console.log(`\n--- Restaurant: ${doc.id} ---`);
      console.log('이름:', data.name || '(없음)');
      
      // 메뉴 카테고리 수
      const catSnap = await firestore
        .collection('restaurants')
        .doc(doc.id)
        .collection('menuCategories')
        .get();
      console.log('카테고리 수:', catSnap.size);
      
      // 메뉴 아이템 수
      const itemSnap = await firestore
        .collection('restaurants')
        .doc(doc.id)
        .collection('menuItems')
        .get();
      console.log('메뉴 아이템 수:', itemSnap.size);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('오류:', error);
    process.exit(1);
  }
}

checkFirebaseMenu();
