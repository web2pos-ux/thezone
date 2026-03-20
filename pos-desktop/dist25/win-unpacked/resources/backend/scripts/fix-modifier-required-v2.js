/**
 * 🔧 모디파이어 Required/Optional 수정 v2
 * 
 * SINGLE = min_selection >= 1 → Required
 * OPTIONAL = min_selection = 0 → Optional
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
  console.log('🔧 모디파이어 Required/Optional 수정 v2');
  console.log('═'.repeat(80));
  
  const restaurantRef = firestore.collection('restaurants').doc(RESTAURANT_ID);
  
  // 1. POS 모디파이어 그룹 설정 확인
  console.log('\n[1] POS 모디파이어 그룹 설정');
  console.log('─'.repeat(80));
  
  const posModGroups = await dbAll(`
    SELECT group_id, name, selection_type, min_selection, max_selection, firebase_id
    FROM modifier_groups
    WHERE firebase_id IS NOT NULL
  `);
  
  // 2. Firebase 업데이트 - SINGLE 또는 min_selection >= 1이면 Required
  console.log('\n[2] Firebase 업데이트');
  console.log('─'.repeat(80));
  
  for (const mg of posModGroups) {
    if (!mg.firebase_id) continue;
    
    // SINGLE 타입 또는 min_selection >= 1이면 Required
    const isRequired = mg.selection_type === 'SINGLE' || (mg.min_selection && mg.min_selection >= 1);
    const minSelections = mg.min_selection || (mg.selection_type === 'SINGLE' ? 1 : 0);
    const maxSelections = mg.max_selection || 1;
    
    await restaurantRef.collection('modifierGroups').doc(mg.firebase_id).update({
      isRequired: isRequired,
      minSelections: minSelections,
      maxSelections: maxSelections,
      updatedAt: new Date()
    });
    
    const status = isRequired ? '🔴 Required' : '🟢 Optional';
    console.log(`   ${status} ${mg.name} (type=${mg.selection_type}, min=${minSelections})`);
  }
  
  // 3. 카테고리 연결 모디파이어
  console.log('\n[3] 카테고리 연결 모디파이어 업데이트');
  console.log('─'.repeat(80));
  
  const catModGroups = await dbAll(`
    SELECT DISTINCT mg.group_id, mg.name, mg.selection_type, mg.min_selection, mg.max_selection, mg.firebase_id
    FROM modifier_groups mg
    JOIN category_modifier_links cml ON mg.group_id = cml.modifier_group_id
    JOIN menu_categories mc ON cml.category_id = mc.category_id
    WHERE mc.menu_id = 200005
  `);
  
  for (const mg of catModGroups) {
    if (!mg.firebase_id) continue;
    
    const isRequired = mg.selection_type === 'SINGLE' || (mg.min_selection && mg.min_selection >= 1);
    const minSelections = mg.min_selection || (mg.selection_type === 'SINGLE' ? 1 : 0);
    const maxSelections = mg.max_selection || 1;
    
    await restaurantRef.collection('modifierGroups').doc(mg.firebase_id).update({
      isRequired: isRequired,
      minSelections: minSelections,
      maxSelections: maxSelections,
      updatedAt: new Date()
    });
    
    const status = isRequired ? '🔴 Required' : '🟢 Optional';
    console.log(`   ${status} ${mg.name}`);
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
