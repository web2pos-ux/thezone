/**
 * Firestore에서 **지정한 주문 문서 ID**만 삭제합니다 (온라인/투고 패널에 남는 문서 정리용).
 *
 * 삭제 경로:
 *   1) restaurants/{restaurantId}/orders/{docId}
 *   2) (선택) 최상위 orders/{docId} — 문서에 restaurantId 필드가 일치할 때만
 *
 * 각 주문의 `guestPayments` 서브컬렉션이 있으면 먼저 삭제한 뒤 주문 문서를 삭제합니다.
 *
 * 사용법 (backend 폴더에서):
 *   node scripts/delete-firestore-orders-by-doc-ids.js --ids DOC1,DOC2,DOC3 --dry-run
 *   node scripts/delete-firestore-orders-by-doc-ids.js --ids DOC1,DOC2,DOC3 --execute
 *   node scripts/delete-firestore-orders-by-doc-ids.js --restaurant-id YOUR_RID --ids DOC1 --execute
 *
 * 레스토랑 ID: --restaurant-id 없으면 db/web2pos.db 의 business_profile.firebase_restaurant_id 사용
 *
 * 정확히 하나: --dry-run 또는 --execute
 *
 * 주의: 삭제는 되돌릴 수 없습니다. 먼저 --dry-run 으로 경로와 존재 여부를 확인하세요.
 */
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const admin = require('firebase-admin');

function parseArgs(argv) {
  const out = {
    dryRun: false,
    execute: false,
    restaurantId: null,
    dbPath: path.resolve(__dirname, '..', '..', 'db', 'web2pos.db'),
    ids: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--execute') out.execute = true;
    else if (a === '--restaurant-id' && argv[i + 1]) out.restaurantId = String(argv[++i]).trim();
    else if (a === '--db-path' && argv[i + 1]) out.dbPath = argv[++i];
    else if (a === '--ids' && argv[i + 1]) {
      out.ids = String(argv[++i])
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return out;
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function initFirebase() {
  const serviceAccountPath = path.join(__dirname, '..', 'config', 'firebase-service-account.json');
  if (!fs.existsSync(serviceAccountPath)) {
    console.error('Missing:', serviceAccountPath);
    process.exit(1);
  }
  if (!admin.apps.length) {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });
  }
  return admin.firestore();
}

async function deleteGuestPaymentsBatch(firestore, orderRef) {
  const snap = await orderRef.collection('guestPayments').get();
  if (snap.empty) return 0;
  let deleted = 0;
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 450) {
    const batch = firestore.batch();
    const chunk = docs.slice(i, i + 450);
    chunk.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += chunk.length;
  }
  return deleted;
}

async function deleteOrderDoc(firestore, ref, dryRun) {
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, reason: 'missing' };
  const guestCount = dryRun ? (await ref.collection('guestPayments').get()).size : await deleteGuestPaymentsBatch(firestore, ref);
  if (!dryRun) {
    await ref.delete();
  }
  return { ok: true, reason: 'deleted', guestCount };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.dryRun === opts.execute) {
    console.error('정확히 하나만: --dry-run 또는 --execute');
    process.exit(1);
  }
  if (!opts.ids.length) {
    console.error('--ids DOC1,DOC2,... 가 필요합니다.');
    process.exit(1);
  }

  let restaurantId = opts.restaurantId;
  if (!restaurantId) {
    if (!fs.existsSync(opts.dbPath)) {
      console.error('DB not found:', opts.dbPath);
      process.exit(1);
    }
    const sqliteDb = new sqlite3.Database(opts.dbPath, sqlite3.OPEN_READONLY);
    try {
      const row = await dbGet(
        sqliteDb,
        'SELECT firebase_restaurant_id AS rid FROM business_profile WHERE id = 1'
      );
      restaurantId = row && row.rid ? String(row.rid).trim() : '';
    } finally {
      sqliteDb.close();
    }
  }
  if (!restaurantId) {
    console.error('firebase_restaurant_id 가 비어 있습니다. --restaurant-id 로 지정하세요.');
    process.exit(1);
  }

  const firestore = initFirebase();
  const dryRun = opts.dryRun;

  console.log(`Restaurant: ${restaurantId}`);
  console.log(`Mode: ${dryRun ? 'DRY-RUN (삭제 안 함)' : 'EXECUTE'}`);
  console.log('Doc IDs:', opts.ids.join(', '));

  let guestRemoved = 0;
  let nestedDeleted = 0;
  let rootDeleted = 0;

  for (const docId of opts.ids) {
    const nestedRef = firestore.collection('restaurants').doc(restaurantId).collection('orders').doc(docId);
    const r1 = await deleteOrderDoc(firestore, nestedRef, dryRun);
    if (r1.ok) {
      nestedDeleted += 1;
      guestRemoved += r1.guestCount || 0;
      console.log(`  [nested] ${docId} -> ${dryRun ? 'would delete' : 'deleted'} (guestPayments: ${r1.guestCount})`);
      continue;
    }

    const rootRef = firestore.collection('orders').doc(docId);
    const rootSnap = await rootRef.get();
    if (!rootSnap.exists) {
      console.log(`  [skip] ${docId} -> not found under restaurant orders or root orders`);
      continue;
    }
    const data = rootSnap.data() || {};
    const rid = String(data.restaurantId || data.restaurant_id || '').trim();
    if (rid && rid !== restaurantId) {
      console.log(`  [skip] root orders/${docId} restaurantId mismatch (${rid} vs ${restaurantId})`);
      continue;
    }
    const r2 = await deleteOrderDoc(firestore, rootRef, dryRun);
    if (r2.ok) {
      rootDeleted += 1;
      guestRemoved += r2.guestCount || 0;
      console.log(`  [root] ${docId} -> ${dryRun ? 'would delete' : 'deleted'} (guestPayments: ${r2.guestCount})`);
    }
  }

  console.log(
    `\nSummary: nested=${nestedDeleted}, root=${rootDeleted}, guestPayments removed=${guestRemoved}${dryRun ? ' (dry-run)' : ''}`
  );
  if (dryRun) {
    console.log('\n실제 삭제하려면 동일 명령에 --execute 를 사용하세요.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
