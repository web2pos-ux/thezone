// Firebase Admin 사용자 생성 스크립트
const admin = require('firebase-admin');
const path = require('path');

const serviceAccountPath = path.join(__dirname, '..', 'config', 'firebase-service-account.json');

async function createAdminUser() {
  try {
    if (!admin.apps.length) {
      const serviceAccount = require(serviceAccountPath);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id
      });
      console.log('Firebase Admin SDK initialized');
    }

    const email = 'luckyhan7+admin@gmail.com';
    const password = '123456';

    let user;
    try {
      user = await admin.auth().getUserByEmail(email);
      console.log('Existing user found:', user.uid);
      
      // Update password
      await admin.auth().updateUser(user.uid, {
        password: password,
        emailVerified: true
      });
      console.log('Password updated');
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        // Create new user
        user = await admin.auth().createUser({
          email: email,
          password: password,
          emailVerified: true,
          displayName: 'Admin'
        });
        console.log('New user created:', user.uid);
      } else {
        throw error;
      }
    }

    // Set admin custom claims
    await admin.auth().setCustomUserClaims(user.uid, {
      admin: true,
      role: 'admin'
    });
    console.log('Admin claims set');

    // Save to Firestore
    const db = admin.firestore();
    await db.collection('users').doc(user.uid).set({
      email: email,
      displayName: 'Admin',
      role: 'admin',
      isAdmin: true,
      isActive: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    console.log('Firestore document saved');

    console.log('\n========================================');
    console.log('Admin account created successfully!');
    console.log('Email:', email);
    console.log('Password:', password);
    console.log('UID:', user.uid);
    console.log('Role: Admin');
    console.log('========================================\n');

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

createAdminUser();











