// Firebase 사용자 상태 확인 스크립트
const admin = require('firebase-admin');
const path = require('path');

const serviceAccountPath = path.join(__dirname, '..', 'config', 'firebase-service-account.json');

async function checkUser() {
  try {
    if (!admin.apps.length) {
      const serviceAccount = require(serviceAccountPath);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id
      });
    }

    const email = 'luckyhan.ca@gmail.com';
    
    const user = await admin.auth().getUserByEmail(email);
    
    console.log('\n========================================');
    console.log('👤 사용자 정보:');
    console.log('========================================');
    console.log('UID:', user.uid);
    console.log('Email:', user.email);
    console.log('Email Verified:', user.emailVerified);
    console.log('Display Name:', user.displayName);
    console.log('Disabled:', user.disabled);
    console.log('Provider:', user.providerData.map(p => p.providerId).join(', '));
    console.log('Custom Claims:', JSON.stringify(user.customClaims, null, 2));
    console.log('Created:', user.metadata.creationTime);
    console.log('Last Sign In:', user.metadata.lastSignInTime);
    console.log('========================================\n');

    // Firestore에서 사용자 데이터 확인
    const db = admin.firestore();
    const userDoc = await db.collection('users').doc(user.uid).get();
    if (userDoc.exists) {
      console.log('📝 Firestore 데이터:');
      console.log(JSON.stringify(userDoc.data(), null, 2));
    } else {
      console.log('❌ Firestore에 사용자 문서 없음');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ 오류:', error.message);
    process.exit(1);
  }
}

checkUser();











