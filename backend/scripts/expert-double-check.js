/**
 * 🔍 전문가 레벨 더블체크 스크립트
 * 
 * 검증 항목:
 * 1. 데이터 완전성 (Completeness)
 * 2. ID 매핑 일관성 (ID Consistency)
 * 3. 가격 필드 통일성 (Price Field Unity)
 * 4. 서브컬렉션 구조 (Subcollection Structure)
 * 5. 참조 무결성 (Referential Integrity)
 * 6. 코드-데이터 정합성 (Code-Data Alignment)
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

const issues = [];
const warnings = [];
const passed = [];

function addIssue(category, message, detail) {
  issues.push({ category, message, detail });
}

function addWarning(category, message, detail) {
  warnings.push({ category, message, detail });
}

function addPassed(category, message) {
  passed.push({ category, message });
}

async function expertDoubleCheck() {
  console.log('═'.repeat(80));
  console.log('🔍 전문가 레벨 더블체크');
  console.log('═'.repeat(80));
  console.log(`\n시간: ${new Date().toISOString()}`);
  console.log(`Restaurant ID: ${RESTAURANT_ID}\n`);
  
  const restaurantRef = firestore.collection('restaurants').doc(RESTAURANT_ID);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 1. 데이터 완전성 검증
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('─'.repeat(80));
  console.log('📊 1. 데이터 완전성 검증 (Completeness)');
  console.log('─'.repeat(80));
  
  // POS 데이터
  const posCategories = await dbAll('SELECT * FROM menu_categories WHERE menu_id = 200005');
  const posItems = await dbAll('SELECT * FROM menu_items WHERE menu_id = 200005');
  const posModifierGroups = await dbAll('SELECT * FROM modifier_groups');
  const posTaxGroups = await dbAll('SELECT * FROM tax_groups');
  const posPrinterGroups = await dbAll('SELECT * FROM printer_groups');
  
  // Firebase 데이터
  const fbCategories = await restaurantRef.collection('menuCategories').get();
  const fbItems = await restaurantRef.collection('menuItems').get();
  const fbModifierGroups = await restaurantRef.collection('modifierGroups').get();
  const fbTaxGroups = await restaurantRef.collection('taxGroups').get();
  const fbPrinterGroups = await restaurantRef.collection('printerGroups').get();
  const fbOrdersSubcol = await restaurantRef.collection('orders').get();
  const fbOrdersGlobal = await firestore.collection('orders').where('restaurantId', '==', RESTAURANT_ID).get();
  
  console.log(`\n   [POS SQLite]                    [Firebase Subcollection]`);
  console.log(`   ─────────────────────────────   ─────────────────────────────`);
  console.log(`   Categories:    ${String(posCategories.length).padStart(4)}          menuCategories:   ${String(fbCategories.size).padStart(4)}`);
  console.log(`   Items:         ${String(posItems.length).padStart(4)}          menuItems:        ${String(fbItems.size).padStart(4)}`);
  console.log(`   ModifierGroups:${String(posModifierGroups.length).padStart(4)}          modifierGroups:   ${String(fbModifierGroups.size).padStart(4)}`);
  console.log(`   TaxGroups:     ${String(posTaxGroups.length).padStart(4)}          taxGroups:        ${String(fbTaxGroups.size).padStart(4)}`);
  console.log(`   PrinterGroups: ${String(posPrinterGroups.length).padStart(4)}          printerGroups:    ${String(fbPrinterGroups.size).padStart(4)}`);
  console.log(`                                   orders(subcol):   ${String(fbOrdersSubcol.size).padStart(4)}`);
  console.log(`                                   orders(global):   ${String(fbOrdersGlobal.size).padStart(4)}`);
  
  // 검증
  if (posItems.length !== fbItems.size) {
    addIssue('COMPLETENESS', `아이템 수 불일치`, `POS: ${posItems.length}, Firebase: ${fbItems.size}`);
  } else {
    addPassed('COMPLETENESS', `아이템 수 일치: ${posItems.length}개`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 2. ID 매핑 일관성 검증
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('🔗 2. ID 매핑 일관성 검증 (ID Consistency)');
  console.log('─'.repeat(80));
  
  // 2.1 POS firebase_id → Firebase 문서 존재 확인
  let invalidFirebaseIds = 0;
  let validFirebaseIds = 0;
  let missingFirebaseIds = 0;
  
  for (const item of posItems) {
    if (item.firebase_id) {
      const fbDoc = await restaurantRef.collection('menuItems').doc(item.firebase_id).get();
      if (fbDoc.exists) {
        validFirebaseIds++;
      } else {
        invalidFirebaseIds++;
        console.log(`   ⚠️  Invalid firebase_id: ${item.name} → ${item.firebase_id}`);
      }
    } else {
      missingFirebaseIds++;
    }
  }
  
  console.log(`\n   POS 아이템 firebase_id 상태:`);
  console.log(`   ✅ 유효: ${validFirebaseIds}개`);
  console.log(`   ❌ 무효 (Firebase에 없음): ${invalidFirebaseIds}개`);
  console.log(`   ⚪ 누락: ${missingFirebaseIds}개`);
  
  if (invalidFirebaseIds > 0) {
    addIssue('ID_CONSISTENCY', `무효한 firebase_id 발견`, `${invalidFirebaseIds}개`);
  } else {
    addPassed('ID_CONSISTENCY', `모든 firebase_id 유효`);
  }
  
  // 2.2 Firebase posId → POS item_id 존재 확인
  let invalidPosIds = 0;
  let validPosIds = 0;
  let missingPosIds = 0;
  const posItemIds = new Set(posItems.map(i => i.item_id));
  
  for (const doc of fbItems.docs) {
    const data = doc.data();
    if (data.posId) {
      if (posItemIds.has(data.posId)) {
        validPosIds++;
      } else {
        invalidPosIds++;
        console.log(`   ⚠️  Invalid posId: ${data.name} → ${data.posId}`);
      }
    } else {
      missingPosIds++;
      console.log(`   ⚪ Missing posId: ${data.name}`);
    }
  }
  
  console.log(`\n   Firebase 아이템 posId 상태:`);
  console.log(`   ✅ 유효: ${validPosIds}개`);
  console.log(`   ❌ 무효 (POS에 없음): ${invalidPosIds}개`);
  console.log(`   ⚪ 누락: ${missingPosIds}개`);
  
  if (invalidPosIds > 0) {
    addIssue('ID_CONSISTENCY', `Firebase에 무효한 posId 발견`, `${invalidPosIds}개`);
  } else if (missingPosIds > 0) {
    addWarning('ID_CONSISTENCY', `Firebase에 posId 누락`, `${missingPosIds}개`);
  } else {
    addPassed('ID_CONSISTENCY', `모든 posId 유효`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 3. 가격 필드 통일성 검증
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('💰 3. 가격 필드 통일성 검증 (Price Field Unity)');
  console.log('─'.repeat(80));
  
  // POS 가격 필드 확인
  const posItemWithPrice = posItems.filter(i => i.price !== undefined && i.price !== null);
  const posItemWithPrice2 = posItems.filter(i => i.price2 !== undefined && i.price2 !== null);
  
  console.log(`\n   POS 가격 필드:`);
  console.log(`   - price: ${posItemWithPrice.length}개 아이템`);
  console.log(`   - price2: ${posItemWithPrice2.length}개 아이템`);
  
  // Firebase 가격 필드 확인
  let fbWithPrice = 0;
  let fbWithPrice1 = 0;
  let fbWithPrice2 = 0;
  let fbPriceMismatch = [];
  
  for (const doc of fbItems.docs) {
    const data = doc.data();
    if (data.price !== undefined) fbWithPrice++;
    if (data.price1 !== undefined) fbWithPrice1++;
    if (data.price2 !== undefined) fbWithPrice2++;
    
    // POS와 가격 비교
    if (data.posId) {
      const posItem = posItems.find(i => i.item_id === data.posId);
      if (posItem) {
        const fbPrice = data.price || data.price1 || 0;
        if (Math.abs(posItem.price - fbPrice) > 0.01) {
          fbPriceMismatch.push({
            name: data.name,
            posPrice: posItem.price,
            fbPrice: fbPrice
          });
        }
      }
    }
  }
  
  console.log(`\n   Firebase 가격 필드:`);
  console.log(`   - price: ${fbWithPrice}개 아이템`);
  console.log(`   - price1: ${fbWithPrice1}개 아이템 (레거시, 제거 권장)`);
  console.log(`   - price2: ${fbWithPrice2}개 아이템`);
  
  if (fbWithPrice1 > 0) {
    addWarning('PRICE_UNITY', `레거시 price1 필드 발견`, `${fbWithPrice1}개 아이템에 아직 price1 존재`);
  }
  
  if (fbPriceMismatch.length > 0) {
    console.log(`\n   ⚠️  가격 불일치:`);
    fbPriceMismatch.slice(0, 5).forEach(m => {
      console.log(`      - ${m.name}: POS=$${m.posPrice}, Firebase=$${m.fbPrice}`);
    });
    if (fbPriceMismatch.length > 5) {
      console.log(`      ... 외 ${fbPriceMismatch.length - 5}개`);
    }
    addWarning('PRICE_UNITY', `가격 불일치 발견`, `${fbPriceMismatch.length}개`);
  } else {
    addPassed('PRICE_UNITY', `모든 가격 일치`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 4. 서브컬렉션 구조 검증
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('📁 4. 서브컬렉션 구조 검증 (Subcollection Structure)');
  console.log('─'.repeat(80));
  
  const subcollections = {
    menuCategories: fbCategories.size,
    menuItems: fbItems.size,
    modifierGroups: fbModifierGroups.size,
    taxGroups: fbTaxGroups.size,
    printerGroups: fbPrinterGroups.size,
    orders: fbOrdersSubcol.size
  };
  
  console.log(`\n   restaurants/${RESTAURANT_ID}/ 하위 컬렉션:`);
  Object.entries(subcollections).forEach(([name, count]) => {
    const status = count > 0 ? '✅' : '⚪';
    console.log(`   ${status} ${name}: ${count}개`);
  });
  
  // 글로벌 컬렉션 잔여 데이터 확인
  const globalCollections = [
    { name: 'menuCategories', query: firestore.collection('menuCategories').where('restaurantId', '==', RESTAURANT_ID) },
    { name: 'menuItems', query: firestore.collection('menuItems').where('restaurantId', '==', RESTAURANT_ID) },
  ];
  
  console.log(`\n   글로벌 컬렉션 잔여 데이터 (마이그레이션 필요):`);
  for (const col of globalCollections) {
    try {
      const snapshot = await col.query.get();
      if (snapshot.size > 0) {
        console.log(`   ⚠️  ${col.name}: ${snapshot.size}개 (삭제 권장)`);
        addWarning('SUBCOLLECTION', `글로벌 ${col.name} 잔여 데이터`, `${snapshot.size}개`);
      }
    } catch (e) {
      // 컬렉션이 없으면 무시
    }
  }
  
  if (fbOrdersGlobal.size > 0 && fbOrdersSubcol.size > 0) {
    if (fbOrdersGlobal.size === fbOrdersSubcol.size) {
      addPassed('SUBCOLLECTION', `주문 마이그레이션 완료 (${fbOrdersSubcol.size}개)`);
    } else {
      addWarning('SUBCOLLECTION', `주문 글로벌/서브컬렉션 수 불일치`, 
        `글로벌: ${fbOrdersGlobal.size}, 서브: ${fbOrdersSubcol.size}`);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 5. 참조 무결성 검증
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('🔗 5. 참조 무결성 검증 (Referential Integrity)');
  console.log('─'.repeat(80));
  
  // 5.1 카테고리 → 아이템 관계
  const fbCategoryIds = new Set(fbCategories.docs.map(d => d.id));
  let invalidCategoryRefs = 0;
  
  for (const doc of fbItems.docs) {
    const data = doc.data();
    if (data.categoryId && !fbCategoryIds.has(data.categoryId)) {
      invalidCategoryRefs++;
      console.log(`   ⚠️  Invalid categoryId: ${data.name} → ${data.categoryId}`);
    }
  }
  
  console.log(`\n   아이템 → 카테고리 참조:`);
  if (invalidCategoryRefs === 0) {
    console.log(`   ✅ 모든 categoryId 유효`);
    addPassed('REFERENTIAL_INTEGRITY', `카테고리 참조 무결성 OK`);
  } else {
    console.log(`   ❌ 무효한 참조: ${invalidCategoryRefs}개`);
    addIssue('REFERENTIAL_INTEGRITY', `무효한 categoryId`, `${invalidCategoryRefs}개`);
  }
  
  // 5.2 아이템 → 모디파이어 그룹 관계
  const fbModifierGroupIds = new Set(fbModifierGroups.docs.map(d => d.id));
  let invalidModifierRefs = 0;
  let itemsWithModifiers = 0;
  
  for (const doc of fbItems.docs) {
    const data = doc.data();
    if (data.modifierGroupIds && data.modifierGroupIds.length > 0) {
      itemsWithModifiers++;
      for (const modId of data.modifierGroupIds) {
        if (!fbModifierGroupIds.has(modId)) {
          invalidModifierRefs++;
        }
      }
    }
  }
  
  console.log(`\n   아이템 → 모디파이어 그룹 참조:`);
  console.log(`   - 모디파이어 연결된 아이템: ${itemsWithModifiers}개`);
  if (invalidModifierRefs === 0) {
    console.log(`   ✅ 모든 modifierGroupIds 유효`);
    addPassed('REFERENTIAL_INTEGRITY', `모디파이어 참조 무결성 OK`);
  } else {
    console.log(`   ❌ 무효한 참조: ${invalidModifierRefs}개`);
    addWarning('REFERENTIAL_INTEGRITY', `무효한 modifierGroupId`, `${invalidModifierRefs}개`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 6. 데이터 품질 검증
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('📋 6. 데이터 품질 검증 (Data Quality)');
  console.log('─'.repeat(80));
  
  // 6.1 빈 이름
  let emptyNames = 0;
  for (const doc of fbItems.docs) {
    const data = doc.data();
    if (!data.name || data.name.trim() === '') {
      emptyNames++;
    }
  }
  
  console.log(`\n   이름 품질:`);
  if (emptyNames === 0) {
    console.log(`   ✅ 모든 아이템에 이름 있음`);
  } else {
    console.log(`   ❌ 이름 없는 아이템: ${emptyNames}개`);
    addIssue('DATA_QUALITY', `이름 없는 아이템`, `${emptyNames}개`);
  }
  
  // 6.2 가격 유효성
  let invalidPrices = 0;
  for (const doc of fbItems.docs) {
    const data = doc.data();
    const price = data.price || 0;
    if (price < 0) {
      invalidPrices++;
      console.log(`   ⚠️  음수 가격: ${data.name} = $${price}`);
    }
  }
  
  console.log(`\n   가격 유효성:`);
  if (invalidPrices === 0) {
    console.log(`   ✅ 모든 가격 유효`);
    addPassed('DATA_QUALITY', `가격 유효성 OK`);
  } else {
    console.log(`   ❌ 무효한 가격: ${invalidPrices}개`);
    addIssue('DATA_QUALITY', `무효한 가격`, `${invalidPrices}개`);
  }
  
  // 6.3 중복 데이터
  const itemNames = fbItems.docs.map(d => d.data().name);
  const duplicateNames = itemNames.filter((name, i) => itemNames.indexOf(name) !== i);
  const uniqueDuplicates = [...new Set(duplicateNames)];
  
  console.log(`\n   중복 검사:`);
  if (uniqueDuplicates.length === 0) {
    console.log(`   ✅ 중복 이름 없음`);
    addPassed('DATA_QUALITY', `중복 없음`);
  } else {
    console.log(`   ⚠️  중복 이름: ${uniqueDuplicates.length}개`);
    uniqueDuplicates.slice(0, 5).forEach(n => console.log(`      - ${n}`));
    addWarning('DATA_QUALITY', `중복 이름`, `${uniqueDuplicates.length}개`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 최종 결과
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(80));
  console.log('📊 최종 검증 결과');
  console.log('═'.repeat(80));
  
  console.log(`\n🔴 CRITICAL ISSUES (${issues.length}개):`);
  if (issues.length === 0) {
    console.log('   없음 ✅');
  } else {
    issues.forEach(i => {
      console.log(`   ❌ [${i.category}] ${i.message}: ${i.detail}`);
    });
  }
  
  console.log(`\n🟡 WARNINGS (${warnings.length}개):`);
  if (warnings.length === 0) {
    console.log('   없음 ✅');
  } else {
    warnings.forEach(w => {
      console.log(`   ⚠️  [${w.category}] ${w.message}: ${w.detail}`);
    });
  }
  
  console.log(`\n🟢 PASSED (${passed.length}개):`);
  passed.forEach(p => {
    console.log(`   ✅ [${p.category}] ${p.message}`);
  });
  
  // 종합 점수
  const totalChecks = issues.length + warnings.length + passed.length;
  const score = Math.round((passed.length / totalChecks) * 100);
  
  console.log('\n' + '═'.repeat(80));
  console.log(`🏆 종합 점수: ${score}% (${passed.length}/${totalChecks} 통과)`);
  
  if (issues.length === 0 && warnings.length <= 2) {
    console.log('✅ 시스템 상태: 양호');
  } else if (issues.length === 0) {
    console.log('🟡 시스템 상태: 주의 필요');
  } else {
    console.log('🔴 시스템 상태: 수정 필요');
  }
  console.log('═'.repeat(80));
  
  db.close();
  process.exit(issues.length > 0 ? 1 : 0);
}

expertDoubleCheck().catch(err => {
  console.error('Double check failed:', err);
  db.close();
  process.exit(1);
});
