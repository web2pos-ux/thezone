import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';

let initialized = false;

function getServiceAccount() {
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (saJson) {
    return JSON.parse(saJson);
  }
  // Local dev: try web2pos backend config
  const localPath = path.join(process.cwd(), '..', 'backend', 'config', 'firebase-service-account.json');
  if (fs.existsSync(localPath)) {
    return JSON.parse(fs.readFileSync(localPath, 'utf-8'));
  }
  throw new Error('Set FIREBASE_SERVICE_ACCOUNT env or place firebase-service-account.json in ../backend/config/');
}

function getAdmin() {
  if (initialized && admin.apps.length > 0) {
    return admin;
  }

  const serviceAccount = getServiceAccount();
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'ezorder-platform.firebasestorage.app',
    });
  }
  initialized = true;
  return admin;
}

export function getStorageBucket() {
  return getAdmin().storage().bucket();
}
