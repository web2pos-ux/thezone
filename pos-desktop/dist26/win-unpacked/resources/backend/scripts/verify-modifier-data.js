/**
 * 🔍 모디파이어 데이터 상세 검증
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

async function verify() {
  console.log('═'.repeat(80));
  console.log('🔍 모디파이어 데이터 상세 검증');
  console.log('═'.repeat(80));
  
  const restaurantRef = firestore.collection('restaurants').doc(RESTAURANT_ID);
  
  // 1. POS 모디파이어 그룹 조회
  console.log('\n[1] POS 모디파이어 그룹 (카테고리에 연결된 것만)');
  console.log('─'.repeat(80));
  
  const posModGroups = await dbAll(`
    SELECT DISTINCT mg.group_id, mg.name, mg.firebase_id, mg.selection_type, mg.min_selection, mg.max_selection
    FROM modifier_groups mg
    JOIN category_modifier_links cml ON mg.group_id = cml.modifier_group_id
    JOIN menu_categories mc ON cml.category_id = mc.category_id
    WHERE mc.menu_id = 200005
  `);
  
  console.log(`\n총 ${posModGroups.length}개 모디파이어 그룹:`);
  
  for (const mg of posModGroups) {
    console.log(`\n  📦 ${mg.name} (POS ID: ${mg.group_id}, Firebase: ${mg.firebase_id || 'N/A'})`);
    
    // 옵션 조회
    const options = await dbAll(`
      SELECT option_id, name, price_adjustment, price_adjustment_2
      FROM modifier_options
      WHERE group_id = ?
      ORDER BY sort_order
    `, [mg.group_id]);
    
    console.log(`     POS 옵션 (${options.length}개):`);
    options.forEach(opt => {
      console.log(`       - ${opt.name} (+$${opt.price_adjustment || 0})`);
    });
    
    // Firebase에서 조회
    if (mg.firebase_id) {
      const fbDoc = await restaurantRef.collection('modifierGroups').doc(mg.firebase_id).get();
      if (fbDoc.exists) {
        const fbData = fbDoc.data();
        console.log(`     Firebase 옵션 (${fbData.modifiers ? fbData.modifiers.length : 0}개):`);
        if (fbData.modifiers) {
          fbData.modifiers.slice(0, 5).forEach(mod => {
            const price = mod.price || mod.price_adjustment || 0;
            console.log(`       - ${mod.name} (+$${price})`);
          });
          if (fbData.modifiers.length > 5) {
            console.log(`       ... 외 ${fbData.modifiers.length - 5}개`);
          }
        }
      } else {
        console.log(`     ⚠️ Firebase에서 찾을 수 없음!`);
      }
    }
  }
  
  // 2. Firebase 모디파이어 그룹 중 빈 옵션 확인
  console.log('\n\n[2] Firebase 모디파이어 그룹 - 더미 데이터 확인');
  console.log('─'.repeat(80));
  
  const fbModGroups = await restaurantRef.collection('modifierGroups').get();
  
  let dummyCount = 0;
  let validCount = 0;
  
  for (const doc of fbModGroups.docs) {
    const data = doc.data();
    const mods = data.modifiers || [];
    
    // 더미 데이터 확인 (Option 1, Option 2 패턴)
    const hasDummy = mods.some(m => m.name === 'Option 1' || m.name === 'Option 2');
    
    if (hasDummy && mods.length <= 2) {
      dummyCount++;
      console.log(`   ❌ ${data.name} (${doc.id}) - 더미 데이터`);
    } else if (mods.length > 0) {
      validCount++;
    }
  }
  
  console.log(`\n   유효한 모디파이어: ${validCount}개`);
  console.log(`   더미 데이터: ${dummyCount}개`);
  
  console.log('\n' + '═'.repeat(80));
  console.log('검증 완료');
  console.log('═'.repeat(80));
  
  db.close();
  process.exit(0);
}

verify().catch(err => {
  console.error('Verify failed:', err);
  db.close();
  process.exit(1);
});
