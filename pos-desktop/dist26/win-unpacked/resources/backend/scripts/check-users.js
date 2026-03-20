// Firebase 사용자 목록 확인
const admin = require('firebase-admin');
const path = require('path');

const serviceAccountPath = path.join(__dirname, '..', 'config', 'firebase-service-account.json');
const serviceAccount = require(serviceAccountPath);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id
  });
}

const db = admin.firestore();

async function checkUsers() {
  console.log('========================================');
  console.log('Firebase Users in ezorder-platform:');
  console.log('========================================\n');
  
  try {
    const snapshot = await db.collection('users').get();
    
    if (snapshot.empty) {
      console.log('No users found!');
      return;
    }
    
    snapshot.forEach(doc => {
      const data = doc.data();
      console.log('UID:', doc.id);
      console.log('  Name:', data.name || data.displayName || 'N/A');
      console.log('  Email:', data.email || 'N/A');
      console.log('  Role:', data.role || 'N/A');
      console.log('  restaurantIds:', JSON.stringify(data.restaurantIds || []));
      console.log('  isActive:', data.isActive);
      console.log('---');
    });
    
    console.log('\nTotal:', snapshot.size, 'users');
  } catch (error) {
    console.error('Error:', error.message);
  }
  
  process.exit(0);
}

checkUsers();










