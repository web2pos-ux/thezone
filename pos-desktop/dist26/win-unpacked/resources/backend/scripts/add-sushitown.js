// Firebase에 Sushitown 레스토랑 추가
const admin = require('firebase-admin');
const path = require('path');

const serviceAccountPath = path.join(__dirname, '..', 'config', 'firebase-service-account.json');

async function addSushitown() {
  if (!admin.apps.length) {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id
    });
  }

  const db = admin.firestore();
  
  // 레스토랑 ID
  const restaurantId = 'tQcGkoSoKcwKdvL7WLiQ';
  
  // 레스토랑 문서 확인
  const docRef = db.collection('restaurants').doc(restaurantId);
  const docSnap = await docRef.get();
  
  if (docSnap.exists) {
    console.log('Restaurant already exists:');
    console.log(docSnap.data());
  } else {
    // 레스토랑 추가
    await docRef.set({
      name: 'Sushitown',
      slug: 'sushitown',
      description: 'Japanese Restaurant',
      phone: '7785551234',
      email: 'info@sushitown.com',
      address: '123 Main St',
      city: 'Vancouver',
      state: 'BC',
      zipCode: 'V6B 1A1',
      isActive: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log('Sushitown restaurant added with ID:', restaurantId);
  }
  
  // 모든 레스토랑 목록 출력
  console.log('\n--- All Restaurants ---');
  const allRestaurants = await db.collection('restaurants').get();
  allRestaurants.forEach(doc => {
    console.log(`${doc.id}: ${doc.data().name}`);
  });
  
  process.exit(0);
}

addSushitown();











