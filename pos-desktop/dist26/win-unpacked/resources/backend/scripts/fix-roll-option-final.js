/**
 * 🔧 Roll Option 최종 수정
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
  console.log('🔧 Roll Option 최종 수정');
  console.log('═'.repeat(80));
  
  const restaurantRef = db.collection('restaurants').doc(RESTAURANT_ID);
  const modGroups = await restaurantRef.collection('modifierGroups').get();
  
  console.log('\n모든 Roll Option 문서 수정...\n');
  
  for (const doc of modGroups.docs) {
    const data = doc.data();
    
    // Roll Option, Choose Sashimi, Extra 등 Optional이어야 하는 것들
    const optionalNames = ['Roll Option', 'Choose Sashimi', 'Extra Tofu(2pcs)', 'Sauce On Side', 'Extra Option', 'Donburi Option'];
    
    if (optionalNames.includes(data.name)) {
      await restaurantRef.collection('modifierGroups').doc(doc.id).set({
        ...data,
        isRequired: false,
        minSelections: 0,
        maxSelections: data.maxSelections || 99, // 여러 개 선택 가능
        updatedAt: new Date()
      }, { merge: true });
      
      console.log(`   🟢 ${data.name} (${doc.id}) → isRequired: false, min: 0`);
    }
  }
  
  // 검증
  console.log('\n검증 중...\n');
  
  const verifySnap = await restaurantRef.collection('modifierGroups').get();
  
  for (const doc of verifySnap.docs) {
    const data = doc.data();
    if (data.name === 'Roll Option') {
      console.log(`Roll Option (${doc.id}):`);
      console.log(`  isRequired: ${data.isRequired} (type: ${typeof data.isRequired})`);
      console.log(`  minSelections: ${data.minSelections}`);
      console.log(`  maxSelections: ${data.maxSelections}`);
    }
  }
  
  console.log('\n' + '═'.repeat(80));
  console.log('✅ Roll Option 수정 완료!');
  console.log('═'.repeat(80));
  
  process.exit(0);
}

fix().catch(err => {
  console.error('Fix failed:', err);
  process.exit(1);
});
