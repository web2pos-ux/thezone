/**
 * 🔧 모디파이어 Required/Optional 및 세금 표시 수정
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

async function fix() {
  console.log('═'.repeat(80));
  console.log('🔧 모디파이어 Required/Optional 수정');
  console.log('═'.repeat(80));
  
  const restaurantRef = firestore.collection('restaurants').doc(RESTAURANT_ID);
  
  // 1. POS 모디파이어 그룹 설정 확인
  console.log('\n[1] POS 모디파이어 그룹 설정 확인');
  console.log('─'.repeat(80));
  
  const posModGroups = await dbAll(`
    SELECT group_id, name, selection_type, min_selection, max_selection, firebase_id
    FROM modifier_groups
    WHERE firebase_id IS NOT NULL
  `);
  
  console.log('\n   POS 설정:');
  for (const mg of posModGroups) {
    console.log(`   ${mg.name}: type=${mg.selection_type}, min=${mg.min_selection}, max=${mg.max_selection}`);
  }
  
  // 2. Firebase 모디파이어 그룹 업데이트
  console.log('\n[2] Firebase 모디파이어 그룹 업데이트');
  console.log('─'.repeat(80));
  
  for (const mg of posModGroups) {
    if (!mg.firebase_id) continue;
    
    // POS selection_type에 따라 isRequired 결정
    // REQUIRED = 필수, OPTIONAL = 선택
    const isRequired = mg.selection_type === 'REQUIRED';
    const minSelections = mg.min_selection || 0;
    const maxSelections = mg.max_selection || 1;
    
    await restaurantRef.collection('modifierGroups').doc(mg.firebase_id).update({
      isRequired: isRequired,
      minSelections: minSelections,
      maxSelections: maxSelections,
      updatedAt: new Date()
    });
    
    console.log(`   ✅ ${mg.name}: isRequired=${isRequired}, min=${minSelections}, max=${maxSelections}`);
  }
  
  // 3. 카테고리에 연결된 모디파이어 중 Firebase ID 없는 것 처리
  console.log('\n[3] 카테고리 연결 모디파이어 확인');
  console.log('─'.repeat(80));
  
  const catModGroups = await dbAll(`
    SELECT DISTINCT mg.group_id, mg.name, mg.selection_type, mg.min_selection, mg.max_selection, mg.firebase_id
    FROM modifier_groups mg
    JOIN category_modifier_links cml ON mg.group_id = cml.modifier_group_id
    JOIN menu_categories mc ON cml.category_id = mc.category_id
    WHERE mc.menu_id = 200005
  `);
  
  for (const mg of catModGroups) {
    if (mg.firebase_id) {
      // 이미 Firebase에 있는 경우 설정 업데이트
      const isRequired = mg.selection_type === 'REQUIRED';
      
      await restaurantRef.collection('modifierGroups').doc(mg.firebase_id).update({
        isRequired: isRequired,
        minSelections: mg.min_selection || 0,
        maxSelections: mg.max_selection || 1,
        updatedAt: new Date()
      });
      
      console.log(`   ✅ ${mg.name}: isRequired=${isRequired}`);
    } else {
      console.log(`   ⚠️ ${mg.name}: Firebase ID 없음`);
    }
  }
  
  // 4. 검증
  console.log('\n[4] 검증');
  console.log('─'.repeat(80));
  
  const fbModGroups = await restaurantRef.collection('modifierGroups').get();
  
  console.log('\n   Firebase 모디파이어 Required/Optional:');
  for (const doc of fbModGroups.docs) {
    const data = doc.data();
    if (data.isActive !== false && data.modifiers && data.modifiers.length > 0) {
      const status = data.isRequired ? '🔴 Required' : '🟢 Optional';
      console.log(`   ${status} ${data.name} (min=${data.minSelections}, max=${data.maxSelections})`);
    }
  }
  
  console.log('\n' + '═'.repeat(80));
  console.log('✅ 모디파이어 설정 수정 완료!');
  console.log('═'.repeat(80));
  
  db.close();
  process.exit(0);
}

fix().catch(err => {
  console.error('Fix failed:', err);
  db.close();
  process.exit(1);
});
