const admin = require('firebase-admin');
const path = require('path');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require(path.join(__dirname, '../config/firebase-service-account.json')))
  });
}

const db = admin.firestore();

db.collection('restaurants').doc('tQcGkoSoKcwKdvL7WLiQ').collection('modifierGroups').get().then(snap => {
  console.log('=== Roll Option 설정 확인 ===\n');
  snap.forEach(doc => {
    const d = doc.data();
    if (d.name === 'Roll Option') {
      console.log(`Roll Option (${doc.id}):`);
      console.log(`  isRequired: ${d.isRequired}`);
      console.log(`  minSelections: ${d.minSelections}`);
      console.log(`  maxSelections: ${d.maxSelections}`);
      console.log(`  isActive: ${d.isActive}`);
      console.log('');
    }
  });
  process.exit(0);
});
