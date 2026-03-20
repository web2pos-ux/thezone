/**
 * 🔍 모디파이어 표시 문제 디버그
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

const db = admin.firestore();
const RESTAURANT_ID = 'tQcGkoSoKcwKdvL7WLiQ';

async function debug() {
  console.log('═'.repeat(80));
  console.log('🔍 모디파이어 표시 문제 디버그');
  console.log('═'.repeat(80));
  
  const restaurantRef = db.collection('restaurants').doc(RESTAURANT_ID);
  
  // 1. Tako Sunomono, Yummy Yummy Roll 확인
  console.log('\n[1] 문제 아이템 확인');
  console.log('─'.repeat(80));
  
  const allItems = await restaurantRef.collection('menuItems').get();
  
  let takoItem = null;
  let yummyItem = null;
  
  for (const doc of allItems.docs) {
    const data = doc.data();
    if (data.name === 'Tako Sunomono') {
      takoItem = { id: doc.id, ...data };
    }
    if (data.name === 'Yummy Yummy Roll') {
      yummyItem = { id: doc.id, ...data };
    }
  }
  
  console.log('\nTako Sunomono:');
  if (takoItem) {
    console.log('  ID:', takoItem.id);
    console.log('  modifierGroupIds:', JSON.stringify(takoItem.modifierGroupIds));
    console.log('  categoryId:', takoItem.categoryId);
  } else {
    console.log('  NOT FOUND!');
  }
  
  console.log('\nYummy Yummy Roll:');
  if (yummyItem) {
    console.log('  ID:', yummyItem.id);
    console.log('  modifierGroupIds:', JSON.stringify(yummyItem.modifierGroupIds));
    console.log('  categoryId:', yummyItem.categoryId);
  } else {
    console.log('  NOT FOUND!');
  }
  
  // 2. 모디파이어 그룹 확인
  console.log('\n[2] Firebase 모디파이어 그룹 확인');
  console.log('─'.repeat(80));
  
  const modGroups = await restaurantRef.collection('modifierGroups').get();
  
  console.log(`\n총 ${modGroups.size}개 모디파이어 그룹:`);
  
  const modMap = new Map();
  
  for (const doc of modGroups.docs) {
    const data = doc.data();
    modMap.set(doc.id, data);
    
    const modCount = data.modifiers ? data.modifiers.length : 0;
    console.log(`  ${doc.id}: ${data.name} (${modCount} options)`);
    
    if (data.modifiers && data.modifiers.length > 0) {
      console.log(`    Options: ${data.modifiers.slice(0, 3).map(m => m.name || m).join(', ')}...`);
    }
  }
  
  // 3. 연결된 모디파이어 유효성 검증
  console.log('\n[3] 아이템-모디파이어 연결 유효성 검증');
  console.log('─'.repeat(80));
  
  if (takoItem && takoItem.modifierGroupIds) {
    console.log('\nTako Sunomono 모디파이어:');
    for (const modId of takoItem.modifierGroupIds) {
      const mod = modMap.get(modId);
      if (mod) {
        console.log(`  ✅ ${modId} -> ${mod.name}`);
      } else {
        console.log(`  ❌ ${modId} -> NOT FOUND!`);
      }
    }
  }
  
  if (yummyItem && yummyItem.modifierGroupIds) {
    console.log('\nYummy Yummy Roll 모디파이어:');
    for (const modId of yummyItem.modifierGroupIds) {
      const mod = modMap.get(modId);
      if (mod) {
        console.log(`  ✅ ${modId} -> ${mod.name}`);
      } else {
        console.log(`  ❌ ${modId} -> NOT FOUND!`);
      }
    }
  }
  
  // 4. TZO에서 사용하는 데이터 구조 확인
  console.log('\n[4] TZO 앱이 기대하는 데이터 구조 확인');
  console.log('─'.repeat(80));
  
  // 모디파이어 그룹 하나 상세 확인
  if (modGroups.size > 0) {
    const firstMod = modGroups.docs[0];
    const data = firstMod.data();
    console.log('\n샘플 모디파이어 그룹 구조:');
    console.log(JSON.stringify(data, null, 2));
  }
  
  // 5. Choose Meat 모디파이어 상세 확인
  console.log('\n[5] Choose Meat / Roll Option / Choose Sashimi 상세 확인');
  console.log('─'.repeat(80));
  
  for (const doc of modGroups.docs) {
    const data = doc.data();
    if (data.name === 'Choose Meat' || data.name === 'Roll Option' || data.name === 'Choose Sashimi') {
      console.log(`\n${data.name} (${doc.id}):`);
      console.log('  isRequired:', data.isRequired);
      console.log('  minSelections:', data.minSelections);
      console.log('  maxSelections:', data.maxSelections);
      console.log('  modifiers count:', data.modifiers ? data.modifiers.length : 0);
      if (data.modifiers) {
        console.log('  modifiers:', JSON.stringify(data.modifiers.slice(0, 5), null, 2));
      }
    }
  }
  
  console.log('\n' + '═'.repeat(80));
  console.log('디버그 완료');
  console.log('═'.repeat(80));
  
  process.exit(0);
}

debug().catch(err => {
  console.error('Debug failed:', err);
  process.exit(1);
});
