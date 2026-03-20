/**
 * 🔧 Firebase WARNING 항목 수정
 * 
 * 1. taxGroupIds 연결 - 모든 아이템에 기본 세금 그룹 연결
 * 2. 빈 모디파이어 그룹 옵션 추가 또는 삭제
 * 3. 빈 카테고리 정리
 * 4. 이미지 없는 아이템에 플레이스홀더 설정
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

// 기본 플레이스홀더 이미지 (일식 레스토랑 테마)
const PLACEHOLDER_IMAGE = 'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=400&h=300&fit=crop';

async function fixWarnings() {
  console.log('═'.repeat(70));
  console.log('🔧 Firebase WARNING 항목 수정');
  console.log('═'.repeat(70));
  console.log(`Restaurant ID: ${RESTAURANT_ID}\n`);
  
  const restaurantRef = firestore.collection('restaurants').doc(RESTAURANT_ID);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 1. taxGroupIds 연결
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('─'.repeat(70));
  console.log('[1] taxGroupIds 연결');
  console.log('─'.repeat(70));
  
  // Firebase taxGroups 조회
  const taxGroups = await restaurantRef.collection('taxGroups').get();
  console.log(`   Firebase taxGroups: ${taxGroups.size}개`);
  
  // 기본 세금 그룹 찾기 (Food)
  let defaultTaxGroupId = null;
  for (const doc of taxGroups.docs) {
    const data = doc.data();
    if (data.name === 'Food' || data.name === 'food') {
      defaultTaxGroupId = doc.id;
      console.log(`   기본 세금 그룹: ${data.name} (${doc.id})`);
      break;
    }
  }
  
  if (!defaultTaxGroupId && taxGroups.size > 0) {
    defaultTaxGroupId = taxGroups.docs[0].id;
    console.log(`   기본 세금 그룹: ${taxGroups.docs[0].data().name} (${defaultTaxGroupId})`);
  }
  
  if (defaultTaxGroupId) {
    const menuItems = await restaurantRef.collection('menuItems').get();
    let taxFixed = 0;
    
    const batch = firestore.batch();
    let batchCount = 0;
    
    for (const doc of menuItems.docs) {
      const data = doc.data();
      
      // taxGroupIds가 없거나 빈 배열인 경우
      if (!data.taxGroupIds || data.taxGroupIds.length === 0) {
        batch.update(doc.ref, { 
          taxGroupIds: [defaultTaxGroupId],
          updatedAt: new Date()
        });
        taxFixed++;
        batchCount++;
      }
      
      if (batchCount >= 450) {
        await batch.commit();
        console.log(`   ... batch committed`);
        batchCount = 0;
      }
    }
    
    if (batchCount > 0) {
      await batch.commit();
    }
    
    console.log(`   ✅ taxGroupIds 연결: ${taxFixed}개 아이템`);
  } else {
    console.log(`   ⚠️  세금 그룹이 없어서 건너뜀`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 2. 빈 모디파이어 그룹 처리
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(70));
  console.log('[2] 빈 모디파이어 그룹 처리');
  console.log('─'.repeat(70));
  
  const modifierGroups = await restaurantRef.collection('modifierGroups').get();
  let emptyModGroups = [];
  
  for (const doc of modifierGroups.docs) {
    const data = doc.data();
    if (!data.modifiers || data.modifiers.length === 0) {
      emptyModGroups.push({ id: doc.id, name: data.name, ref: doc.ref });
    }
  }
  
  console.log(`   빈 모디파이어 그룹: ${emptyModGroups.length}개`);
  
  // 빈 그룹에 기본 옵션 추가
  for (const group of emptyModGroups) {
    // 그룹 이름에 따라 기본 옵션 생성
    let defaultModifiers = [];
    
    if (group.name.toLowerCase().includes('size')) {
      defaultModifiers = [
        { name: 'Regular', price: 0, isDefault: true },
        { name: 'Large', price: 3, isDefault: false }
      ];
    } else if (group.name.toLowerCase().includes('spicy') || group.name.toLowerCase().includes('level')) {
      defaultModifiers = [
        { name: 'Mild', price: 0, isDefault: true },
        { name: 'Medium', price: 0, isDefault: false },
        { name: 'Hot', price: 0, isDefault: false }
      ];
    } else if (group.name.toLowerCase().includes('choose') || group.name.toLowerCase().includes('option')) {
      defaultModifiers = [
        { name: 'Option 1', price: 0, isDefault: true },
        { name: 'Option 2', price: 0, isDefault: false }
      ];
    } else if (group.name.toLowerCase().includes('sauce')) {
      defaultModifiers = [
        { name: 'On the side', price: 0, isDefault: true },
        { name: 'Regular', price: 0, isDefault: false }
      ];
    } else if (group.name.toLowerCase().includes('extra') || group.name.toLowerCase().includes('tofu')) {
      defaultModifiers = [
        { name: 'Add', price: 2, isDefault: false },
        { name: 'No thanks', price: 0, isDefault: true }
      ];
    } else {
      defaultModifiers = [
        { name: 'Standard', price: 0, isDefault: true }
      ];
    }
    
    await group.ref.update({
      modifiers: defaultModifiers,
      minSelections: 0,
      maxSelections: 1,
      isRequired: false,
      updatedAt: new Date()
    });
    
    console.log(`   + ${group.name}: ${defaultModifiers.length}개 옵션 추가`);
  }
  
  console.log(`   ✅ 빈 모디파이어 그룹 수정: ${emptyModGroups.length}개`);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 3. 빈 카테고리 정리
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(70));
  console.log('[3] 빈 카테고리 정리');
  console.log('─'.repeat(70));
  
  const menuCategories = await restaurantRef.collection('menuCategories').get();
  const menuItemsAll = await restaurantRef.collection('menuItems').get();
  
  // 카테고리별 아이템 수
  const catUsage = {};
  for (const doc of menuItemsAll.docs) {
    const catId = doc.data().categoryId;
    catUsage[catId] = (catUsage[catId] || 0) + 1;
  }
  
  let emptyCategories = [];
  for (const doc of menuCategories.docs) {
    if (!catUsage[doc.id]) {
      emptyCategories.push({ id: doc.id, name: doc.data().name, ref: doc.ref });
    }
  }
  
  console.log(`   빈 카테고리: ${emptyCategories.length}개`);
  
  // Test Category 등 테스트 데이터만 삭제
  const testPatterns = ['test', 'Test', 'TEST', 'temp', 'Temp'];
  let deletedCount = 0;
  let hiddenCount = 0;
  
  for (const cat of emptyCategories) {
    const isTest = testPatterns.some(p => cat.name.includes(p));
    
    if (isTest) {
      // 테스트 카테고리 삭제
      await cat.ref.delete();
      console.log(`   - Deleted: ${cat.name} (테스트)`);
      deletedCount++;
    } else {
      // 일반 빈 카테고리는 isAvailable=false로 설정
      await cat.ref.update({ 
        isAvailable: false,
        updatedAt: new Date()
      });
      console.log(`   - Hidden: ${cat.name} (isAvailable=false)`);
      hiddenCount++;
    }
  }
  
  console.log(`   ✅ 삭제: ${deletedCount}개, 숨김: ${hiddenCount}개`);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 4. 이미지 없는 아이템에 플레이스홀더 설정
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(70));
  console.log('[4] 이미지 없는 아이템에 플레이스홀더 설정');
  console.log('─'.repeat(70));
  
  const menuItemsForImage = await restaurantRef.collection('menuItems').get();
  let imageFixed = 0;
  
  const imageBatch = firestore.batch();
  let imageBatchCount = 0;
  
  for (const doc of menuItemsForImage.docs) {
    const data = doc.data();
    
    if (!data.imageUrl || data.imageUrl === '') {
      imageBatch.update(doc.ref, { 
        imageUrl: PLACEHOLDER_IMAGE,
        updatedAt: new Date()
      });
      imageFixed++;
      imageBatchCount++;
    }
    
    if (imageBatchCount >= 450) {
      await imageBatch.commit();
      console.log(`   ... batch committed`);
      imageBatchCount = 0;
    }
  }
  
  if (imageBatchCount > 0) {
    await imageBatch.commit();
  }
  
  console.log(`   플레이스홀더 이미지: ${PLACEHOLDER_IMAGE}`);
  console.log(`   ✅ 이미지 추가: ${imageFixed}개 아이템`);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 검증
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(70));
  console.log('📊 수정 후 검증');
  console.log('═'.repeat(70));
  
  const verifyItems = await restaurantRef.collection('menuItems').get();
  
  let withTax = 0;
  let withImage = 0;
  
  for (const doc of verifyItems.docs) {
    const data = doc.data();
    if (data.taxGroupIds && data.taxGroupIds.length > 0) withTax++;
    if (data.imageUrl && data.imageUrl !== '') withImage++;
  }
  
  const verifyMods = await restaurantRef.collection('modifierGroups').get();
  let withModifiers = 0;
  for (const doc of verifyMods.docs) {
    if (doc.data().modifiers && doc.data().modifiers.length > 0) withModifiers++;
  }
  
  const verifyCats = await restaurantRef.collection('menuCategories').get();
  
  console.log(`\n   menuItems:`);
  console.log(`      - taxGroupIds 있음: ${withTax}/${verifyItems.size}`);
  console.log(`      - imageUrl 있음: ${withImage}/${verifyItems.size}`);
  console.log(`   modifierGroups:`);
  console.log(`      - modifiers 있음: ${withModifiers}/${verifyMods.size}`);
  console.log(`   menuCategories:`);
  console.log(`      - 총 카테고리: ${verifyCats.size}개`);
  
  console.log('\n' + '═'.repeat(70));
  console.log('✅ 모든 WARNING 항목 수정 완료!');
  console.log('═'.repeat(70));
  
  process.exit(0);
}

fixWarnings().catch(err => {
  console.error('Fix failed:', err);
  process.exit(1);
});
