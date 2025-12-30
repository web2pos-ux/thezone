// backend/services/posLockService.js
// Firebase-based table lock for multi-POS conflict prevention (lease with TTL)

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const firebaseService = require('./firebaseService');

const INSTANCE_ID_FILE = path.join(__dirname, '..', '.pos-instance-id');

function getOrCreatePosInstanceId() {
  try {
    if (fs.existsSync(INSTANCE_ID_FILE)) {
      const existing = fs.readFileSync(INSTANCE_ID_FILE, 'utf8').trim();
      if (existing) return existing;
    }
  } catch {}

  const id = `pos-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    fs.writeFileSync(INSTANCE_ID_FILE, id, 'utf8');
  } catch {}
  return id;
}

const POS_INSTANCE_ID = getOrCreatePosInstanceId();

function lockDocId(restaurantId, tableId) {
  return `${restaurantId}__${String(tableId)}`;
}

async function acquireTableLock(restaurantId, tableId, ttlMs = 120000) {
  if (!restaurantId || !tableId) return { ok: true, reason: 'no_table' };

  const firestore = firebaseService.getFirestore();
  const ref = firestore.collection('posLocks').doc(lockDocId(restaurantId, tableId));
  const now = Date.now();

  try {
    const res = await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : null;
      const expiresAtMs = data?.expiresAtMs || 0;
      const ownerId = data?.ownerId || null;

      // Free if expired or owned by self
      const isFree = !snap.exists || expiresAtMs < now || ownerId === POS_INSTANCE_ID;
      if (!isFree) {
        return { ok: false, ownerId, expiresAtMs };
      }

      tx.set(
        ref,
        {
          restaurantId,
          tableId: String(tableId),
          ownerId: POS_INSTANCE_ID,
          acquiredAtMs: now,
          expiresAtMs: now + ttlMs,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      return { ok: true, ownerId: POS_INSTANCE_ID, expiresAtMs: now + ttlMs };
    });

    return res;
  } catch (e) {
    // Fail open to avoid blocking the POS if Firebase has issues
    console.error('[posLock] acquire failed (fail-open):', e.message);
    return { ok: true, reason: 'firebase_error' };
  }
}

async function releaseTableLock(restaurantId, tableId) {
  if (!restaurantId || !tableId) return { ok: true, reason: 'no_table' };

  const firestore = firebaseService.getFirestore();
  const ref = firestore.collection('posLocks').doc(lockDocId(restaurantId, tableId));

  try {
    await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const data = snap.data() || {};
      if (data.ownerId && data.ownerId !== POS_INSTANCE_ID) return;
      tx.delete(ref);
    });
    return { ok: true };
  } catch (e) {
    console.error('[posLock] release failed:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = {
  POS_INSTANCE_ID,
  getOrCreatePosInstanceId,
  acquireTableLock,
  releaseTableLock
};


