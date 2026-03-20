/**
 * 🔧 세금 그룹 연결 수정
 * 
 * Food, Drink에 GST (5%) 연결
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

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function(err) {
    err ? reject(err) : resolve({ lastID: this.lastID, changes: this.changes });
  });
});

async function fix() {
  console.log('═'.repeat(80));
  console.log('🔧 세금 그룹 연결 수정');
  console.log('═'.repeat(80));
  
  const restaurantRef = firestore.collection('restaurants').doc(RESTAURANT_ID);
  
  // 1. 현재 세금 목록 확인
  console.log('\n[1] 현재 세금 목록');
  console.log('─'.repeat(80));
  
  const taxes = await dbAll("SELECT * FROM taxes WHERE is_active = 1");
  console.log('\n   활성 세금:');
  taxes.forEach(t => console.log(`   - ${t.name}: ${t.rate}% (ID: ${t.id})`));
  
  // GST ID 찾기
  const gst = taxes.find(t => t.name === 'GST');
  const pstBev = taxes.find(t => t.name === 'PST (Beaverage)');
  
  if (!gst) {
    console.log('\n   ❌ GST 세금을 찾을 수 없습니다!');
    db.close();
    process.exit(1);
  }
  
  console.log(`\n   GST ID: ${gst.id}`);
  console.log(`   PST (Beaverage) ID: ${pstBev?.id || 'N/A'}`);
  
  // 2. Food, Drink에 GST 연결
  console.log('\n[2] POS 세금 그룹에 세금 연결');
  console.log('─'.repeat(80));
  
  const taxGroups = await dbAll("SELECT * FROM tax_groups WHERE is_active = 1");
  
  for (const tg of taxGroups) {
    // 이미 연결이 있는지 확인
    const existingLinks = await dbAll(
      "SELECT * FROM tax_group_links WHERE group_id = ?",
      [tg.id]
    );
    
    if (existingLinks.length === 0) {
      console.log(`\n   ${tg.name} (ID: ${tg.id}):`);
      
      if (tg.name === 'Food') {
        // Food에 GST만 연결
        await dbRun("INSERT INTO tax_group_links (group_id, tax_id) VALUES (?, ?)", [tg.id, gst.id]);
        console.log(`      + GST (${gst.rate}%) 연결됨`);
      } else if (tg.name === 'Drink') {
        // Drink에 GST + PST (Beaverage) 연결
        await dbRun("INSERT INTO tax_group_links (group_id, tax_id) VALUES (?, ?)", [tg.id, gst.id]);
        console.log(`      + GST (${gst.rate}%) 연결됨`);
        
        if (pstBev) {
          await dbRun("INSERT INTO tax_group_links (group_id, tax_id) VALUES (?, ?)", [tg.id, pstBev.id]);
          console.log(`      + PST (Beaverage) (${pstBev.rate}%) 연결됨`);
        }
      } else if (tg.name === 'Local Tax') {
        // Local Tax에 GST 연결
        await dbRun("INSERT INTO tax_group_links (group_id, tax_id) VALUES (?, ?)", [tg.id, gst.id]);
        console.log(`      + GST (${gst.rate}%) 연결됨`);
      }
    } else {
      console.log(`\n   ${tg.name}: 이미 ${existingLinks.length}개 세금 연결됨`);
    }
  }
  
  // 3. Firebase 세금 그룹 업데이트
  console.log('\n[3] Firebase 세금 그룹 업데이트');
  console.log('─'.repeat(80));
  
  for (const tg of taxGroups) {
    if (!tg.firebase_id) continue;
    
    // POS에서 연결된 세금 조회
    const linkedTaxes = await dbAll(`
      SELECT t.id, t.name, t.rate
      FROM taxes t
      JOIN tax_group_links tgl ON t.id = tgl.tax_id
      WHERE tgl.group_id = ?
    `, [tg.id]);
    
    // Firebase 형식으로 변환
    const firebaseTaxes = linkedTaxes.map(t => ({
      id: t.id,
      name: t.name,
      displayName: t.name,
      rate: t.rate,
      type: 'percentage'
    }));
    
    // Firebase 업데이트
    await restaurantRef.collection('taxGroups').doc(tg.firebase_id).update({
      taxes: firebaseTaxes,
      updatedAt: new Date()
    });
    
    const totalRate = linkedTaxes.reduce((sum, t) => sum + t.rate, 0);
    console.log(`\n   ${tg.name} (${tg.firebase_id}):`);
    console.log(`      세금: ${linkedTaxes.map(t => `${t.name} ${t.rate}%`).join(', ') || '없음'}`);
    console.log(`      총 세율: ${totalRate}%`);
  }
  
  // 4. 검증
  console.log('\n[4] 검증');
  console.log('─'.repeat(80));
  
  // Food 세금 그룹 확인
  const foodGroup = taxGroups.find(g => g.name === 'Food');
  if (foodGroup && foodGroup.firebase_id) {
    const fbDoc = await restaurantRef.collection('taxGroups').doc(foodGroup.firebase_id).get();
    const fbData = fbDoc.data();
    
    console.log(`\n   Food 세금 그룹 (Firebase):`);
    console.log(`      taxes:`, JSON.stringify(fbData.taxes));
    
    const rate = fbData.taxes ? fbData.taxes.reduce((sum, t) => sum + t.rate, 0) : 0;
    console.log(`      총 세율: ${rate}%`);
  }
  
  console.log('\n' + '═'.repeat(80));
  console.log('✅ 세금 그룹 연결 수정 완료!');
  console.log('═'.repeat(80));
  
  db.close();
  process.exit(0);
}

fix().catch(err => {
  console.error('Fix failed:', err);
  db.close();
  process.exit(1);
});
