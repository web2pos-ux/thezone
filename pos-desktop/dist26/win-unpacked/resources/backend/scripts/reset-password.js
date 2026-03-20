const admin = require('firebase-admin');
const path = require('path');

const serviceAccountPath = path.join(__dirname, '..', 'config', 'firebase-service-account.json');

async function resetPassword() {
  if (!admin.apps.length) {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id
    });
  }

  const uid = '2Gf1PKx9hWU5IIFEl2zJaNKq8a02';
  const newPassword = '123456';

  try {
    await admin.auth().updateUser(uid, { password: newPassword });
    console.log('Password updated successfully to: ' + newPassword);
  } catch (error) {
    console.error('Error:', error.message);
  }
  
  process.exit(0);
}

resetPassword();











