const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const admin = require('firebase-admin');

// Firebase 초기화 (firebaseService와 동일한 경로)
const serviceAccountPath = path.join(__dirname, 'config', 'firebase-service-account.json');
const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkData() {
  // Restaurant ID 확인 (첫 번째 레스토랑 사용)
  const restaurantsSnapshot = await db.collection('restaurants').limit(5).get();
  console.log('=== Available Restaurants ===');
  restaurantsSnapshot.forEach(doc => {
    console.log(`  ${doc.id}: ${doc.data().name}`);
  });
  
  // 특정 레스토랑 ID 사용 - Sushi Harbour Port Hardy
  const restaurantId = 'tQcGkoSoKcwKdvL7WLiQ';
  if (!restaurantId) {
    console.log('No restaurant found!');
    return;
  }
  
  console.log(`\n=== Checking data for restaurant: ${restaurantId} ===`);
  
  // 루트 컬렉션 확인
  console.log('\n--- Root Collections (OLD - should be empty) ---');
  const rootModGroups = await db.collection('modifierGroups').where('restaurantId', '==', restaurantId).get();
  console.log(`modifierGroups (root): ${rootModGroups.size}`);
  
  const rootTaxGroups = await db.collection('taxGroups').where('restaurantId', '==', restaurantId).get();
  console.log(`taxGroups (root): ${rootTaxGroups.size}`);
  
  const rootPrinterGroups = await db.collection('printerGroups').where('restaurantId', '==', restaurantId).get();
  console.log(`printerGroups (root): ${rootPrinterGroups.size}`);
  
  // 서브컬렉션 확인 (TZO가 사용하는 경로)
  console.log('\n--- Subcollections (NEW - TZO uses these) ---');
  const restaurantRef = db.collection('restaurants').doc(restaurantId);
  
  const subMenus = await restaurantRef.collection('menus').get();
  console.log(`menus: ${subMenus.size}`);
  subMenus.forEach(doc => console.log(`  - ${doc.id}: ${doc.data().name}, is_active: ${doc.data().is_active}`));
  
  const subCategories = await restaurantRef.collection('menuCategories').get();
  console.log(`menuCategories: ${subCategories.size}`);
  
  const subItems = await restaurantRef.collection('menuItems').get();
  console.log(`menuItems: ${subItems.size}`);
  
  const subModGroups = await restaurantRef.collection('modifierGroups').get();
  console.log(`modifierGroups: ${subModGroups.size}`);
  if (subModGroups.size > 0) {
    subModGroups.forEach(doc => console.log(`  - ${doc.data().name} (${doc.data().modifiers?.length || 0} modifiers)`));
  }
  
  const subTaxGroups = await restaurantRef.collection('taxGroups').get();
  console.log(`taxGroups: ${subTaxGroups.size}`);
  if (subTaxGroups.size > 0) {
    subTaxGroups.forEach(doc => console.log(`  - ${doc.data().name}: ${doc.data().rate}%`));
  }
  
  const subPrinterGroups = await restaurantRef.collection('printerGroups').get();
  console.log(`printerGroups: ${subPrinterGroups.size}`);
  
  // 연결 컬렉션 확인
  console.log('\n--- Link Collections ---');
  const catModLinks = await restaurantRef.collection('categoryModifierLinks').get();
  console.log(`categoryModifierLinks: ${catModLinks.size}`);
  
  const itemModLinks = await restaurantRef.collection('itemModifierLinks').get();
  console.log(`itemModifierLinks: ${itemModLinks.size}`);
  
  const itemTaxLinks = await restaurantRef.collection('itemTaxLinks').get();
  console.log(`itemTaxLinks: ${itemTaxLinks.size}`);
  
  const itemPrinterLinks = await restaurantRef.collection('itemPrinterLinks').get();
  console.log(`itemPrinterLinks: ${itemPrinterLinks.size}`);
  
  // 카테고리별 아이템 수
  console.log('\n--- Items per Category ---');
  const categoryItemCount = {};
  subItems.forEach(doc => {
    const catId = doc.data().categoryId || 'unknown';
    categoryItemCount[catId] = (categoryItemCount[catId] || 0) + 1;
  });
  for (const [catId, count] of Object.entries(categoryItemCount)) {
    const catDoc = subCategories.docs.find(d => d.id === catId);
    const catName = catDoc?.data()?.name || 'Unknown';
    console.log(`  ${catName}: ${count} items`);
  }
  
  process.exit(0);
}

checkData().catch(console.error);

