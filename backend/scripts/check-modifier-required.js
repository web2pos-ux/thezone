const admin = require('firebase-admin');
const path = require('path');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require(path.join(__dirname, '../config/firebase-service-account.json')))
  });
}

const db = admin.firestore();

db.collection('restaurants').doc('tQcGkoSoKcwKdvL7WLiQ').collection('modifierGroups').get().then(snap => {
  console.log('=== 모디파이어 Required/Optional 상태 ===\n');
  snap.forEach(doc => {
    const d = doc.data();
    if (d.isActive !== false && d.modifiers && d.modifiers.length > 0) {
      console.log(`${d.name}:`);
      console.log(`  isRequired: ${d.isRequired}`);
      console.log(`  minSelections: ${d.minSelections}`);
      console.log(`  maxSelections: ${d.maxSelections}`);
      console.log('');
    }
  });
  process.exit(0);
});
