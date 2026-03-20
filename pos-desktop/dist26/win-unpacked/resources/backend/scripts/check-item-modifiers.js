/**
 * 아이템에 연결된 모디파이어 확인
 */

const admin = require('firebase-admin');
const path = require('path');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require(path.join(__dirname, '../config/firebase-service-account.json')))
  });
}

const db = admin.firestore();
const RESTAURANT_ID = 'tQcGkoSoKcwKdvL7WLiQ';

async function check() {
  console.log('═'.repeat(80));
  console.log('🔍 아이템에 연결된 모디파이어 확인');
  console.log('═'.repeat(80));
  
  const restaurantRef = db.collection('restaurants').doc(RESTAURANT_ID);
  
  // 모디파이어 그룹 맵 생성
  const modMap = new Map();
  const modGroups = await restaurantRef.collection('modifierGroups').get();
  
  for (const doc of modGroups.docs) {
    modMap.set(doc.id, doc.data());
  }
  
  // SPECIAL ROLL 아이템 확인
  const items = await restaurantRef.collection('menuItems').get();
  
  console.log('\nSPECIAL ROLL 아이템의 모디파이어:\n');
  
  for (const doc of items.docs) {
    const data = doc.data();
    
    // Yummy Yummy Roll, Crazy Boy Roll 등 확인
    if (data.name && (data.name.includes('Roll') || data.name.includes('Sashimi'))) {
      const modIds = data.modifierGroupIds || [];
      
      if (modIds.length > 0) {
        console.log(`${data.name}:`);
        console.log(`  modifierGroupIds: ${JSON.stringify(modIds)}`);
        
        for (const modId of modIds) {
          const modData = modMap.get(modId);
          if (modData) {
            const status = modData.isRequired ? '🔴 Required' : '🟢 Optional';
            console.log(`    → ${modData.name}: ${status} (isRequired=${modData.isRequired}, min=${modData.minSelections})`);
          } else {
            console.log(`    → ❌ NOT FOUND: ${modId}`);
          }
        }
        console.log('');
      }
    }
  }
  
  console.log('═'.repeat(80));
  process.exit(0);
}

check().catch(err => {
  console.error('Check failed:', err);
  process.exit(1);
});
