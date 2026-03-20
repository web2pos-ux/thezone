/**
 * 🔍 세금 계산 문제 분석
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

async function analyze() {
  console.log('═'.repeat(80));
  console.log('🔍 세금 계산 문제 분석');
  console.log('═'.repeat(80));
  
  const restaurantRef = firestore.collection('restaurants').doc(RESTAURANT_ID);
  
  // 1. Firebase taxGroups 확인
  console.log('\n[1] Firebase 세금 그룹 현황');
  console.log('─'.repeat(80));
  
  const taxGroups = await restaurantRef.collection('taxGroups').get();
  
  const taxMap = new Map();
  
  for (const doc of taxGroups.docs) {
    const data = doc.data();
    taxMap.set(doc.id, data);
    
    console.log(`\n   📦 ${data.name} (ID: ${doc.id})`);
    console.log(`      taxes:`, JSON.stringify(data.taxes, null, 2));
    
    // 세율 계산
    if (data.taxes && Array.isArray(data.taxes)) {
      const totalRate = data.taxes.reduce((sum, t) => sum + (t.rate || 0), 0);
      console.log(`      총 세율: ${totalRate}%`);
    }
  }
  
  // 2. POS 세금 그룹 확인
  console.log('\n\n[2] POS 세금 그룹 현황');
  console.log('─'.repeat(80));
  
  const posTaxGroups = await dbAll(`SELECT * FROM tax_groups`);
  
  for (const tg of posTaxGroups) {
    console.log(`\n   📦 ${tg.name} (ID: ${tg.id}, Firebase: ${tg.firebase_id || 'N/A'})`);
    
    const taxes = await dbAll(`
      SELECT t.* FROM taxes t
      JOIN tax_group_items tgi ON t.id = tgi.tax_id
      WHERE tgi.tax_group_id = ?
    `, [tg.id]);
    
    console.log(`      세금 항목:`);
    let totalRate = 0;
    for (const tax of taxes) {
      console.log(`        - ${tax.name}: ${tax.rate}%`);
      totalRate += tax.rate || 0;
    }
    console.log(`      총 세율: ${totalRate}%`);
  }
  
  // 3. 문제의 아이템들 확인
  console.log('\n\n[3] 문제 아이템 확인 (Beef Teriyaki Bento, Spicy Salmon Sashimi)');
  console.log('─'.repeat(80));
  
  const menuItems = await restaurantRef.collection('menuItems').get();
  
  for (const doc of menuItems.docs) {
    const data = doc.data();
    if (data.name === 'Beef Teriyaki Bento' || data.name === 'Spicy Salmon Sashimi') {
      console.log(`\n   📦 ${data.name}`);
      console.log(`      가격: $${data.price}`);
      console.log(`      taxGroupIds: ${JSON.stringify(data.taxGroupIds)}`);
      
      if (data.taxGroupIds && data.taxGroupIds.length > 0) {
        for (const taxId of data.taxGroupIds) {
          const taxData = taxMap.get(taxId);
          if (taxData) {
            console.log(`      → ${taxData.name}`);
            if (taxData.taxes) {
              const rate = taxData.taxes.reduce((sum, t) => sum + (t.rate || 0), 0);
              console.log(`         세율: ${rate}%`);
            }
          }
        }
      }
    }
  }
  
  // 4. TZO OrderPage 세금 계산 방식 확인
  console.log('\n\n[4] TZO 세금 계산 방식');
  console.log('─'.repeat(80));
  
  // Restaurant 설정 확인
  const restDoc = await firestore.collection('restaurants').doc(RESTAURANT_ID).get();
  const restData = restDoc.data();
  
  console.log(`\n   레스토랑 기본 세율: ${restData?.taxSettings?.defaultTaxRate || '설정 없음 (기본 8.875%)'}`);
  
  console.log(`
   
   현재 TZO OrderPage 세금 계산:
   ─────────────────────────────────────
   const taxRate = restaurant?.taxSettings?.defaultTaxRate || 8.875;
   const tax = subtotal * (taxRate / 100);
   
   문제점:
   - 아이템별 taxGroupIds를 사용하지 않음
   - 레스토랑 기본 세율(8.875%)만 적용
   
   스크린샷 계산:
   - Subtotal: $35.38
   - Tax (8.875%): $35.38 × 0.08875 = $3.14 ✓
   - Total: $38.52 ✓
   
   이것이 의도된 동작인가요?
   - 만약 아이템별 세금이 달라야 한다면 TZO OrderPage 수정 필요
   - 만약 레스토랑 기본 세율로 충분하다면 현재 방식 유지
  `);
  
  console.log('\n' + '═'.repeat(80));
  console.log('분석 완료');
  console.log('═'.repeat(80));
  
  db.close();
  process.exit(0);
}

analyze().catch(err => {
  console.error('Analysis failed:', err);
  db.close();
  process.exit(1);
});
