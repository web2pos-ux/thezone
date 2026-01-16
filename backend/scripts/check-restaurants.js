// Firebase 레스토랑 데이터 확인
const admin = require('firebase-admin');
const path = require('path');

const serviceAccountPath = path.join(__dirname, '..', 'config', 'firebase-service-account.json');

async function checkRestaurants() {
  if (!admin.apps.length) {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id
    });
  }

  const db = admin.firestore();
  
  console.log('\n========================================');
  console.log('Firebase Restaurants:');
  console.log('========================================\n');

  const restaurantsSnap = await db.collection('restaurants').get();
  
  if (restaurantsSnap.empty) {
    console.log('No restaurants found in Firebase!');
  } else {
    restaurantsSnap.forEach(doc => {
      const data = doc.data();
      console.log(`ID: ${doc.id}`);
      console.log(`Name: ${data.name || 'N/A'}`);
      console.log(`Slug: ${data.slug || 'N/A'}`);
      console.log(`---`);
    });
    console.log(`\nTotal: ${restaurantsSnap.size} restaurants`);
  }

  process.exit(0);
}

checkRestaurants();











