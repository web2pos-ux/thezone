// Firebase Auth 사용자 목록 확인
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

async function checkAuthUsers() {
  console.log('========================================');
  console.log('Firebase AUTH Users vs Firestore Users');
  console.log('========================================\n');
  
  try {
    // 1. Firebase Auth 사용자 목록
    console.log('--- Firebase AUTH Users ---');
    const listUsersResult = await admin.auth().listUsers(100);
    const authUsers = listUsersResult.users;
    
    authUsers.forEach(user => {
      console.log('Auth UID:', user.uid);
      console.log('  Email:', user.email);
      console.log('  Display Name:', user.displayName || 'N/A');
      console.log('---');
    });
    console.log('Total Auth Users:', authUsers.length);
    
    // 2. Firestore users 컬렉션
    console.log('\n--- Firestore Users Collection ---');
    const usersSnapshot = await db.collection('users').get();
    
    usersSnapshot.forEach(doc => {
      const data = doc.data();
      console.log('Firestore Doc ID:', doc.id);
      console.log('  Email:', data.email);
      console.log('  Name:', data.name);
      console.log('  Role:', data.role);
      console.log('---');
    });
    console.log('Total Firestore Users:', usersSnapshot.size);
    
    // 3. 비교 분석
    console.log('\n========================================');
    console.log('COMPARISON ANALYSIS');
    console.log('========================================');
    
    for (const authUser of authUsers) {
      // Auth UID로 Firestore에서 찾기
      const matchingDoc = usersSnapshot.docs.find(doc => doc.id === authUser.uid);
      
      if (matchingDoc) {
        console.log(`✅ MATCH: ${authUser.email}`);
        console.log(`   Auth UID = Firestore Doc ID: ${authUser.uid}`);
      } else {
        // 이메일로 Firestore에서 찾기
        const emailMatchDoc = usersSnapshot.docs.find(doc => doc.data().email === authUser.email);
        
        if (emailMatchDoc) {
          console.log(`❌ MISMATCH: ${authUser.email}`);
          console.log(`   Auth UID: ${authUser.uid}`);
          console.log(`   Firestore Doc ID: ${emailMatchDoc.id}`);
          console.log(`   → 문서 ID 불일치! Auth UID로 문서를 생성해야 함`);
        } else {
          console.log(`⚠️  NOT IN FIRESTORE: ${authUser.email}`);
          console.log(`   Auth UID: ${authUser.uid}`);
          console.log(`   → Firestore에 사용자 문서가 없음`);
        }
      }
      console.log('');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
  
  process.exit(0);
}

checkAuthUsers();










