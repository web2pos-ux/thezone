/**
 * 🔍 최종 모디파이어 & 세금 검증
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

async function finalCheck() {
  console.log('═'.repeat(80));
  console.log('🔍 최종 모디파이어 & 세금 검증');
  console.log('═'.repeat(80));
  
  const restaurantRef = firestore.collection('restaurants').doc(RESTAURANT_ID);
  
  // 1. 모디파이어 그룹 현황
  console.log('\n[1] Firebase 모디파이어 그룹 현황');
  console.log('─'.repeat(80));
  
  const modGroups = await restaurantRef.collection('modifierGroups').get();
  
  let activeCount = 0;
  let inactiveCount = 0;
  
  for (const doc of modGroups.docs) {
    const data = doc.data();
    const isActive = data.isActive !== false;
    const modCount = data.modifiers ? data.modifiers.length : 0;
    
    if (isActive && modCount > 0) {
      activeCount++;
      console.log(`   ✅ ${data.name} (${modCount}개 옵션)`);
    } else {
      inactiveCount++;
    }
  }
  
  console.log(`\n   활성: ${activeCount}개, 비활성: ${inactiveCount}개`);
  
  // 2. 카테고리별 아이템-모디파이어 연결 현황
  console.log('\n[2] 카테고리별 모디파이어 연결 현황');
  console.log('─'.repeat(80));
  
  const menuItems = await restaurantRef.collection('menuItems').get();
  const categories = await restaurantRef.collection('menuCategories').get();
  
  const catMap = new Map();
  for (const doc of categories.docs) {
    catMap.set(doc.id, doc.data().name);
  }
  
  const catStats = {};
  
  for (const doc of menuItems.docs) {
    const data = doc.data();
    const catId = data.categoryId;
    const catName = catMap.get(catId) || 'Unknown';
    
    if (!catStats[catName]) {
      catStats[catName] = { total: 0, withMods: 0, withTax: 0 };
    }
    
    catStats[catName].total++;
    
    if (data.modifierGroupIds && data.modifierGroupIds.length > 0) {
      catStats[catName].withMods++;
    }
    
    if (data.taxGroupIds && data.taxGroupIds.length > 0) {
      catStats[catName].withTax++;
    }
  }
  
  // 주요 카테고리만 표시
  const targetCats = ['SASHIMI', 'SPECIAL ROLL', 'LUNCH SPECIAL SET', 'SALADS', 'SPICY SASHIMI'];
  
  console.log('\n   | 카테고리 | 아이템 수 | 모디파이어 | 세금 |');
  console.log('   |----------|----------|-----------|------|');
  
  for (const catName of Object.keys(catStats).sort()) {
    const stats = catStats[catName];
    if (targetCats.some(t => catName.includes(t))) {
      const modPct = Math.round(stats.withMods / stats.total * 100);
      const taxPct = Math.round(stats.withTax / stats.total * 100);
      console.log(`   | ${catName.padEnd(15)} | ${stats.total.toString().padStart(3)} | ${modPct.toString().padStart(3)}% | ${taxPct.toString().padStart(3)}% |`);
    }
  }
  
  // 3. 전체 통계
  console.log('\n[3] 전체 통계');
  console.log('─'.repeat(80));
  
  let totalItems = 0;
  let itemsWithMods = 0;
  let itemsWithTax = 0;
  
  for (const doc of menuItems.docs) {
    const data = doc.data();
    totalItems++;
    
    if (data.modifierGroupIds && data.modifierGroupIds.length > 0) {
      itemsWithMods++;
    }
    
    if (data.taxGroupIds && data.taxGroupIds.length > 0) {
      itemsWithTax++;
    }
  }
  
  console.log(`
   총 아이템: ${totalItems}개
   
   모디파이어 연결: ${itemsWithMods}개 (${Math.round(itemsWithMods/totalItems*100)}%)
   세금 연결: ${itemsWithTax}개 (${Math.round(itemsWithTax/totalItems*100)}%)
  `);
  
  // 4. 샘플 아이템 확인
  console.log('\n[4] 샘플 아이템 상세 확인');
  console.log('─'.repeat(80));
  
  const sampleItems = ['Tako Sunomono', 'Yummy Yummy Roll', 'Salmon Sashimi'];
  
  for (const itemName of sampleItems) {
    for (const doc of menuItems.docs) {
      const data = doc.data();
      if (data.name === itemName) {
        console.log(`\n   📦 ${data.name}`);
        
        // 모디파이어
        if (data.modifierGroupIds && data.modifierGroupIds.length > 0) {
          console.log(`      모디파이어 IDs: ${data.modifierGroupIds.join(', ')}`);
          
          for (const modId of data.modifierGroupIds) {
            const modDoc = await restaurantRef.collection('modifierGroups').doc(modId).get();
            if (modDoc.exists) {
              const modData = modDoc.data();
              const optCount = modData.modifiers ? modData.modifiers.length : 0;
              console.log(`         → ${modData.name} (${optCount}개 옵션)`);
            }
          }
        } else {
          console.log(`      모디파이어: 없음`);
        }
        
        // 세금
        if (data.taxGroupIds && data.taxGroupIds.length > 0) {
          console.log(`      세금 IDs: ${data.taxGroupIds.join(', ')}`);
        } else {
          console.log(`      세금: 없음`);
        }
        
        break;
      }
    }
  }
  
  console.log('\n' + '═'.repeat(80));
  console.log('✅ 검증 완료!');
  console.log('═'.repeat(80));
  
  process.exit(0);
}

finalCheck().catch(err => {
  console.error('Check failed:', err);
  process.exit(1);
});
