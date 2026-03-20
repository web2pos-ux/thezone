/**
 * 🔧 모디파이어 boolean 값 수정
 * 
 * isRequired: 0 → false
 * isRequired: 1 → true
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

async function fix() {
  console.log('═'.repeat(80));
  console.log('🔧 모디파이어 boolean 값 수정');
  console.log('═'.repeat(80));
  
  const restaurantRef = db.collection('restaurants').doc(RESTAURANT_ID);
  const modGroups = await restaurantRef.collection('modifierGroups').get();
  
  console.log('\n수정 중...\n');
  
  for (const doc of modGroups.docs) {
    const data = doc.data();
    
    // isRequired를 명확한 boolean으로 변환
    // 0, undefined, null, '' → false
    // 1, true, 또는 다른 truthy 값 → true
    const isRequired = data.isRequired === true || data.isRequired === 1;
    const minSelections = typeof data.minSelections === 'number' ? data.minSelections : 0;
    const maxSelections = typeof data.maxSelections === 'number' ? data.maxSelections : 1;
    
    // SINGLE 타입은 min=1이어야 Required
    const shouldBeRequired = isRequired || minSelections >= 1;
    
    await restaurantRef.collection('modifierGroups').doc(doc.id).update({
      isRequired: shouldBeRequired,
      minSelections: minSelections,
      maxSelections: maxSelections,
      updatedAt: new Date()
    });
    
    const status = shouldBeRequired ? '🔴 Required' : '🟢 Optional';
    console.log(`   ${status} ${data.name} (isRequired: ${data.isRequired} → ${shouldBeRequired})`);
  }
  
  console.log('\n' + '═'.repeat(80));
  console.log('✅ boolean 값 수정 완료!');
  console.log('═'.repeat(80));
  
  process.exit(0);
}

fix().catch(err => {
  console.error('Fix failed:', err);
  process.exit(1);
});
