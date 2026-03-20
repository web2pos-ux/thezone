/**
 * Firebase에만 존재하고 POS에 없는 Orphan 아이템 처리
 * - 확인 후 삭제
 */

const admin = require('firebase-admin');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Firebase 초기화
const serviceAccountPath = path.join(__dirname, '../config/firebase-service-account.json');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require(serviceAccountPath))
  });
}

const firestore = admin.firestore();
const RESTAURANT_ID = 'tQcGkoSoKcwKdvL7WLiQ';

// SQLite 연결
const dbPath = path.join(__dirname, '../../db/web2pos.db');
const db = new sqlite3.Database(dbPath);

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});

async function handleOrphanItems() {
  console.log('='.repeat(60));
  console.log('🗑️ Orphan 아이템 처리');
  console.log('='.repeat(60));
  
  const restaurantRef = firestore.collection('restaurants').doc(RESTAURANT_ID);
  
  // Firebase menuItems 조회
  const fbItems = await restaurantRef.collection('menuItems').get();
  console.log(`\nFirebase menuItems: ${fbItems.size}개`);
  
  // POS item_ids 조회
  const posItems = await dbAll('SELECT item_id FROM menu_items WHERE menu_id = 200005');
  const posItemIds = new Set(posItems.map(i => i.item_id));
  console.log(`POS menu_items: ${posItemIds.size}개`);
  
  // Orphan 찾기 (Firebase에 있지만 POS에 없음)
  const orphans = [];
  
  for (const doc of fbItems.docs) {
    const data = doc.data();
    
    // posId가 없거나 POS에 해당 아이템이 없음
    if (!data.posId || !posItemIds.has(data.posId)) {
      orphans.push({
        id: doc.id,
        name: data.name,
        posId: data.posId || 'N/A',
        price: data.price || 0
      });
    }
  }
  
  console.log(`\nOrphan 아이템: ${orphans.length}개`);
  
  if (orphans.length > 0) {
    console.log('\n[Orphan 목록]');
    orphans.forEach(o => {
      console.log(`  - ${o.name} (posId: ${o.posId}, price: $${o.price})`);
    });
    
    // 삭제 진행
    console.log('\n[삭제 진행]');
    for (const orphan of orphans) {
      await restaurantRef.collection('menuItems').doc(orphan.id).delete();
      console.log(`  - Deleted: ${orphan.name}`);
    }
  }
  
  // 결과 확인
  const finalFbItems = await restaurantRef.collection('menuItems').get();
  console.log(`\n[최종 상태]`);
  console.log(`  - Firebase menuItems: ${finalFbItems.size}개`);
  console.log(`  - POS menu_items: ${posItemIds.size}개`);
  
  db.close();
  process.exit(0);
}

handleOrphanItems().catch(err => {
  console.error('Failed:', err);
  db.close();
  process.exit(1);
});
