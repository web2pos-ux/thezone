/**
 * 🔧 더미 모디파이어 옵션 수정
 * 
 * POS에 옵션이 없는 모디파이어 그룹에 적절한 옵션 추가
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
  console.log('🔧 더미 모디파이어 옵션 수정');
  console.log('═'.repeat(80));
  
  const restaurantRef = firestore.collection('restaurants').doc(RESTAURANT_ID);
  
  // 1. 카테고리에 연결된 모디파이어 그룹 중 POS에 옵션이 없는 것들 확인
  console.log('\n[1] POS 모디파이어 그룹 옵션 확인');
  console.log('─'.repeat(80));
  
  const posModGroups = await dbAll(`
    SELECT DISTINCT mg.group_id, mg.name, mg.firebase_id
    FROM modifier_groups mg
    JOIN category_modifier_links cml ON mg.group_id = cml.modifier_group_id
    JOIN menu_categories mc ON cml.category_id = mc.category_id
    WHERE mc.menu_id = 200005
  `);
  
  const groupsToFix = [];
  
  for (const mg of posModGroups) {
    const options = await dbAll(`
      SELECT m.modifier_id, m.name, m.price_delta
      FROM modifiers m
      JOIN modifier_group_links mgl ON m.modifier_id = mgl.modifier_id
      WHERE mgl.modifier_group_id = ? AND m.is_deleted = 0
    `, [mg.group_id]);
    
    if (options.length === 0) {
      console.log(`   ⚠️ ${mg.name} (ID: ${mg.group_id}) - 옵션 없음`);
      groupsToFix.push(mg);
    } else {
      console.log(`   ✅ ${mg.name} - ${options.length}개 옵션`);
    }
  }
  
  // 2. Choose Sashimi에 적절한 옵션 추가
  console.log('\n[2] Choose Sashimi 옵션 추가');
  console.log('─'.repeat(80));
  
  const chooseSashimi = groupsToFix.find(g => g.name === 'Choose Sashimi');
  
  if (chooseSashimi) {
    console.log(`\n   그룹 ID: ${chooseSashimi.group_id}`);
    
    // 사시미 옵션들 (일반적인 사시미 사이즈/종류)
    const sashimiOptions = [
      { name: 'Regular', price: 0 },
      { name: 'Large (+3pcs)', price: 5 }
    ];
    
    // POS에 모디파이어 옵션 추가
    console.log('\n   POS에 옵션 추가:');
    
    for (const opt of sashimiOptions) {
      // modifiers 테이블에 추가
      const result = await dbRun(`
        INSERT INTO modifiers (name, price_delta, type, is_deleted, sort_order)
        VALUES (?, ?, 'OPTION', 0, ?)
      `, [opt.name, opt.price, sashimiOptions.indexOf(opt)]);
      
      const modifierId = result.lastID;
      
      // modifier_group_links에 연결
      await dbRun(`
        INSERT INTO modifier_group_links (modifier_group_id, modifier_id)
        VALUES (?, ?)
      `, [chooseSashimi.group_id, modifierId]);
      
      console.log(`      + ${opt.name} (+$${opt.price}) - modifier_id: ${modifierId}`);
    }
    
    // Firebase 업데이트
    if (chooseSashimi.firebase_id) {
      console.log('\n   Firebase 업데이트:');
      
      await restaurantRef.collection('modifierGroups').doc(chooseSashimi.firebase_id).update({
        modifiers: sashimiOptions.map((opt, idx) => ({
          id: `mod-sashimi-${idx}`,
          name: opt.name,
          price: opt.price,
          price_adjustment: opt.price,
          isDefault: idx === 0
        })),
        isRequired: false,
        minSelections: 0,
        maxSelections: 1,
        updatedAt: new Date()
      });
      
      console.log(`      ✅ Firebase 문서 업데이트 완료: ${chooseSashimi.firebase_id}`);
    }
  }
  
  // 3. 다른 더미 모디파이어 그룹 처리 (Firebase에만 있는 것들)
  console.log('\n[3] Firebase 전용 더미 모디파이어 삭제 또는 숨김');
  console.log('─'.repeat(80));
  
  const fbModGroups = await restaurantRef.collection('modifierGroups').get();
  
  const dummyFirebaseIds = ['4JbwzP5OcDLKM62uxA4E', 'kjk3XglCg9gMU7E16ihR', 'u0gsuGUN3EQANxmYptoO'];
  
  for (const fbId of dummyFirebaseIds) {
    const doc = await restaurantRef.collection('modifierGroups').doc(fbId).get();
    if (doc.exists) {
      const name = doc.data().name;
      
      // 더미 그룹을 비활성화 (삭제 대신)
      await restaurantRef.collection('modifierGroups').doc(fbId).update({
        isActive: false,
        modifiers: [],
        updatedAt: new Date()
      });
      
      console.log(`   🗑️ ${name} (${fbId}) - 비활성화됨`);
    }
  }
  
  // 4. 검증
  console.log('\n[4] 수정 후 검증');
  console.log('─'.repeat(80));
  
  // Choose Sashimi 확인
  if (chooseSashimi) {
    const newOptions = await dbAll(`
      SELECT m.name, m.price_delta
      FROM modifiers m
      JOIN modifier_group_links mgl ON m.modifier_id = mgl.modifier_id
      WHERE mgl.modifier_group_id = ? AND m.is_deleted = 0
    `, [chooseSashimi.group_id]);
    
    console.log(`\n   Choose Sashimi POS 옵션: ${newOptions.length}개`);
    newOptions.forEach(o => console.log(`      - ${o.name} (+$${o.price_delta})`));
    
    if (chooseSashimi.firebase_id) {
      const fbDoc = await restaurantRef.collection('modifierGroups').doc(chooseSashimi.firebase_id).get();
      if (fbDoc.exists) {
        const mods = fbDoc.data().modifiers || [];
        console.log(`   Choose Sashimi Firebase 옵션: ${mods.length}개`);
        mods.forEach(m => console.log(`      - ${m.name} (+$${m.price || 0})`));
      }
    }
  }
  
  console.log('\n' + '═'.repeat(80));
  console.log('✅ 더미 모디파이어 수정 완료!');
  console.log('═'.repeat(80));
  
  db.close();
  process.exit(0);
}

fix().catch(err => {
  console.error('Fix failed:', err);
  db.close();
  process.exit(1);
});
