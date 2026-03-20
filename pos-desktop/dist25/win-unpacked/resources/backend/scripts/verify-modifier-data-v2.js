/**
 * 🔍 모디파이어 데이터 상세 검증 v2
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
  console.log('🔍 모디파이어 데이터 상세 검증 v2');
  console.log('═'.repeat(80));
  
  const restaurantRef = firestore.collection('restaurants').doc(RESTAURANT_ID);
  
  // 1. modifier_group_links 테이블 확인
  console.log('\n[1] modifier_group_links 테이블 스키마');
  console.log('─'.repeat(80));
  
  const linkSchema = await dbAll("PRAGMA table_info(modifier_group_links)");
  console.log('Columns:', linkSchema.map(c => c.name).join(', '));
  
  // 2. POS 모디파이어 그룹 조회 (카테고리에 연결된 것만)
  console.log('\n[2] POS 모디파이어 그룹 (카테고리에 연결된 것만)');
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
    
    // modifier_group_links를 통해 modifiers 조회
    const options = await dbAll(`
      SELECT m.modifier_id, m.name, m.price_delta, m.price_delta2
      FROM modifiers m
      JOIN modifier_group_links mgl ON m.modifier_id = mgl.modifier_id
      WHERE mgl.modifier_group_id = ? AND m.is_deleted = 0
      ORDER BY m.sort_order
    `, [mg.group_id]);
    
    console.log(`     POS 옵션 (${options.length}개):`);
    options.forEach(opt => {
      console.log(`       - ${opt.name} (+$${opt.price_delta || 0})`);
    });
    
    // Firebase에서 조회
    if (mg.firebase_id) {
      const fbDoc = await restaurantRef.collection('modifierGroups').doc(mg.firebase_id).get();
      if (fbDoc.exists) {
        const fbData = fbDoc.data();
        console.log(`     Firebase 옵션 (${fbData.modifiers ? fbData.modifiers.length : 0}개):`);
        if (fbData.modifiers) {
          fbData.modifiers.forEach(mod => {
            const price = mod.price || mod.price_adjustment || 0;
            console.log(`       - ${mod.name} (+$${price})`);
          });
        }
        
        // 불일치 확인
        if (!fbData.modifiers || fbData.modifiers.length !== options.length) {
          console.log(`     ⚠️ 불일치! POS: ${options.length}개, Firebase: ${fbData.modifiers ? fbData.modifiers.length : 0}개`);
        }
      } else {
        console.log(`     ⚠️ Firebase에서 찾을 수 없음!`);
      }
    }
  }
  
  // 3. Firebase 모디파이어 그룹 중 더미 데이터 확인
  console.log('\n\n[3] Firebase 모디파이어 그룹 - 더미 데이터 확인');
  console.log('─'.repeat(80));
  
  const fbModGroups = await restaurantRef.collection('modifierGroups').get();
  
  const dummyGroups = [];
  const validGroups = [];
  
  for (const doc of fbModGroups.docs) {
    const data = doc.data();
    const mods = data.modifiers || [];
    
    // 더미 데이터 확인 (Option 1, Option 2 패턴)
    const hasDummy = mods.some(m => m.name === 'Option 1' || m.name === 'Option 2');
    
    if (hasDummy && mods.length <= 2) {
      dummyGroups.push({ id: doc.id, name: data.name });
    } else if (mods.length > 0) {
      validGroups.push({ id: doc.id, name: data.name, count: mods.length });
    }
  }
  
  console.log(`\n유효한 모디파이어 (${validGroups.length}개):`);
  validGroups.forEach(g => console.log(`   ✅ ${g.name} (${g.count}개 옵션)`));
  
  console.log(`\n더미 데이터 (${dummyGroups.length}개):`);
  dummyGroups.forEach(g => console.log(`   ❌ ${g.name} (${g.id})`));
  
  console.log('\n' + '═'.repeat(80));
  console.log('📊 결론');
  console.log('═'.repeat(80));
  console.log(`
  문제: Firebase 모디파이어 그룹 중 일부가 "Option 1", "Option 2" 더미 데이터임
  
  해결책: POS의 실제 모디파이어 옵션으로 Firebase 업데이트 필요
  `);
  
  db.close();
  process.exit(0);
}

verify().catch(err => {
  console.error('Verify failed:', err);
  db.close();
  process.exit(1);
});
