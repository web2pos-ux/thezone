// Firebase Admin 사용자 생성 스크립트
const admin = require('firebase-admin');
const path = require('path');

// 서비스 계정 키 경로
const serviceAccountPath = path.join(__dirname, '..', 'config', 'firebase-service-account.json');

async function createAdminUser() {
  try {
    // Firebase Admin 초기화
    if (!admin.apps.length) {
      const serviceAccount = require(serviceAccountPath);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id
      });
      console.log('🔥 Firebase Admin SDK 초기화 완료');
    }

    const email = 'luckyhan.ca@gmail.com';
    const password = '123456';

    // 기존 사용자 확인
    let user;
    try {
      user = await admin.auth().getUserByEmail(email);
      console.log(`📧 기존 사용자 발견: ${user.uid}`);
      
      // 비밀번호 업데이트
      await admin.auth().updateUser(user.uid, {
        password: password,
        emailVerified: true
      });
      console.log(`🔑 비밀번호 업데이트 완료: ${password}`);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        // 새 사용자 생성
        user = await admin.auth().createUser({
          email: email,
          password: password,
          emailVerified: true,
          displayName: 'Admin'
        });
        console.log(`✅ 새 사용자 생성됨: ${user.uid}`);
      } else {
        throw error;
      }
    }

    // Admin 권한 부여 (custom claims)
    await admin.auth().setCustomUserClaims(user.uid, {
      admin: true,
      role: 'admin'
    });
    console.log(`👑 Admin 권한 부여 완료: ${email}`);

    // Firestore에도 사용자 정보 저장
    const db = admin.firestore();
    await db.collection('users').doc(user.uid).set({
      email: email,
      displayName: 'Admin',
      role: 'admin',
      isAdmin: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    console.log(`📝 Firestore에 사용자 정보 저장 완료`);

    console.log('\n========================================');
    console.log('🎉 관리자 계정 생성 완료!');
    console.log(`📧 이메일: ${email}`);
    console.log(`🔑 비밀번호: ${password}`);
    console.log(`👤 UID: ${user.uid}`);
    console.log('========================================\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ 오류 발생:', error.message);
    process.exit(1);
  }
}

createAdminUser();

