/**
 * Firestore restaurants/{restaurantId}/orders 에서 다음 문서를 삭제합니다.
 *  - 온라인: orderType 이 픽업/배달 계열이 아니고, source 가 POS 가 아닌 주문(TheZone 등 외부 채널)
 *  - 딜리버리: 배달 계열 orderType 또는 deliveryCompany / deliveryOrderNumber 가 있는 주문(결제 여부 무관)
 *  - Unpaid 투고: 픽업/투고 계열이면서 미결제이고, source 가 POS 가 아닌 주문
 *
 * 주문 하위 컬렉션 guestPayments 가 있으면 먼저 삭제 후 주문 문서를 삭제합니다.
 *
 * 사용법:
 *   node scripts/delete-firestore-online-delivery-unpaid-pickup.js --dry-run
 *   node scripts/delete-firestore-online-delivery-unpaid-pickup.js --execute
 *   node scripts/delete-firestore-online-delivery-unpaid-pickup.js --restaurant-id YOUR_ID --db-path "C:\\path\\web2pos.db" --dry-run
 *
 * 또한 최상위 컬렉션 orders 에서 restaurantId 필드가 일치하는 문서도 동일 규칙으로 삭제합니다(쿼리 실패 시 스킵).
 *
 * 정확히 하나: --dry-run 또는 --execute
 * 레스토랑 ID: --restaurant-id 없으면 web2pos.db 의 business_profile.firebase_restaurant_id 사용
 */
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const admin = require('firebase-admin');

const PICKUP_TYPES = new Set([
  'pickup',
  'takeout',
  'togo',
  'pick-up',
  'pick_up',
  'curbside',
  'take-out',
]);

const DELIVERY_TYPES = new Set([
  'delivery',
  'ubereats',
  'uber',
  'doordash',
  'skip',
  'skipthedishes',
  'skip_the_dishes',
  'fantuan',
]);

function parseArgs(argv) {
  const out = {
    dryRun: false,
    execute: false,
    restaurantId: null,
    dbPath: path.resolve(__dirname, '..', '..', 'db', 'web2pos.db'),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--execute') out.execute = true;
    else if (a === '--restaurant-id' && argv[i + 1]) {
      out.restaurantId = argv[++i];
    } else if (a === '--db-path' && argv[i + 1]) {
      out.dbPath = argv[++i];
    }
  }
  return out;
}

function normOrderType(d) {
  return String(d.orderType || d.order_type || '')
    .toLowerCase()
    .trim();
}

function isPickupLike(ot) {
  if (!ot) return false;
  if (PICKUP_TYPES.has(ot)) return true;
  const c = ot.replace(/[^a-z]/g, '');
  return c === 'takeout' || c === 'pickup' || c === 'togo';
}

function isDeliveryOrder(ot, d) {
  if (d && (d.deliveryCompany || d.deliveryOrderNumber)) return true;
  if (!ot) return false;
  if (DELIVERY_TYPES.has(ot)) return true;
  const compact = ot.replace(/[^a-z]/g, '');
  return ['ubereats', 'doordash', 'skipthedishes', 'fantuan', 'delivery'].includes(compact);
}

function isPosSource(d) {
  return String(d.source || '').trim().toUpperCase() === 'POS';
}

/** TheZone / 웹앱 등 POS 이외의 온라인 주문 표식 */
function isThezoneOrWebChannel(d) {
  const os = String(d.orderSource || d.order_source || '').toUpperCase();
  if (os.includes('THEZONE')) return true;
  const ch = String(d.channel || d.orderChannel || '').toLowerCase();
  if (
    ch === 'online' ||
    ch === 'thezoneorder' ||
    ch === 'thezone' ||
    ch.includes('thezone')
  ) {
    return true;
  }
  return false;
}

function isPaidDoc(d) {
  const ps = String(d.paymentStatus || '').toLowerCase();
  const st = String(d.status || '').toLowerCase();
  if (ps === 'paid' || ps === 'completed') return true;
  if (st === 'paid' || st === 'completed') return true;
  if (d.paid === true) return true;
  return false;
}

/** @returns {{ reason: string } | null} */
function classifyDelete(d, ot) {
  const pos = isPosSource(d);
  const pickup = isPickupLike(ot);
  const delivery = isDeliveryOrder(ot, d);
  const paid = isPaidDoc(d);
  const tz = isThezoneOrWebChannel(d);

  if (delivery) return { reason: 'delivery' };

  // 온라인: TheZone/웹 채널 표식이 있고 배달·픽업 타입이 아닌 주문(매장 외 온라인 등)
  if (tz && !pickup && !delivery) return { reason: 'online_channel' };

  // 온라인: TheZone 등이면서 픽업 타입이지만 이미 결제 완료된 건(미결제 투고와 구분)
  if (tz && pickup && paid) return { reason: 'online_pickup_paid' };

  // Unpaid 투고: 픽업/투고 + 미결제 (POS가 Firebase에 올린 투고/픽업 미결제 포함)
  if (pickup && !paid) return { reason: 'unpaid_pickup_togo' };

  // 레거시: 채널 필드 없이 source 만 없는 비-POS 비-픽업 비-배달
  if (!pickup && !delivery && !pos) return { reason: 'online_non_pos' };

  return null;
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

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
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

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.dryRun === opts.execute) {
    console.error('정확히 하나만: --dry-run 또는 --execute');
    process.exit(1);
  }

  let restaurantId = opts.restaurantId;
  if (!restaurantId) {
    if (!fs.existsSync(opts.dbPath)) {
      console.error('DB not found:', opts.dbPath);
      console.error('Use --restaurant-id 또는 --db-path 로 지정하세요.');
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
  const ordersRef = firestore.collection('restaurants').doc(restaurantId).collection('orders');
  const snapshot = await ordersRef.get();

  /** @type {Record<string, number>} */
  const counts = {};
  const toDelete = [];
  const seenPath = new Set();

  function considerDoc(doc) {
    if (seenPath.has(doc.ref.path)) return;
    const d = doc.data() || {};
    const ot = normOrderType(d);
    const c = classifyDelete(d, ot);
    if (c) {
      seenPath.add(doc.ref.path);
      counts[c.reason] = (counts[c.reason] || 0) + 1;
      toDelete.push({
        ref: doc.ref,
        id: doc.id,
        reason: c.reason,
        orderNumber: d.orderNumber || d.order_number || '',
      });
    }
  }

  snapshot.forEach((doc) => considerDoc(doc));

  let rootSize = 0;
  try {
    const rootSnap = await firestore
      .collection('orders')
      .where('restaurantId', '==', restaurantId)
      .get();
    rootSize = rootSnap.size;
    rootSnap.forEach((doc) => considerDoc(doc));
  } catch (e) {
    console.warn('[root orders] 쿼리 생략 또는 실패:', e.message);
  }

  const total = toDelete.length;
  console.log(`Restaurant: ${restaurantId}`);
  console.log(`Scanned restaurants/.../orders: ${snapshot.size}, root orders (matched): ${rootSize}`);
  console.log('To delete by reason:', counts);
  console.log(`Total to delete: ${total}`);

  if (total && opts.dryRun) {
    console.log('\n[샘플 최대 40]');
    toDelete.slice(0, 40).forEach((r) => {
      console.log(`  ${r.reason} id=${r.id} #${r.orderNumber}`);
    });
    console.log('\n--dry-run: Firestore 삭제 없음');
    return;
  }

  if (total === 0) {
    console.log('삭제할 문서 없음');
    return;
  }

  let guestDeleted = 0;
  for (const row of toDelete) {
    guestDeleted += await deleteGuestPaymentsBatch(firestore, row.ref);
  }

  for (let i = 0; i < toDelete.length; i += 450) {
    const batch = firestore.batch();
    const chunk = toDelete.slice(i, i + 450);
    chunk.forEach((row) => batch.delete(row.ref));
    await batch.commit();
    console.log(`Deleted ${Math.min(i + chunk.length, toDelete.length)} / ${toDelete.length} orders…`);
  }

  console.log(`Done. Order docs deleted: ${total}, guestPayments subdocs removed: ${guestDeleted}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
