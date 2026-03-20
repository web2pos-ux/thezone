/**
 * 🔥 Firebase 관점에서 POS 데이터 분석
 * 
 * Firebase/TZO가 기대하는 것 vs POS가 제공하는 것
 * 
 * 분석 항목:
 * 1. 스키마 불일치 (Schema Mismatch)
 * 2. 필수 필드 누락 (Missing Required Fields)
 * 3. 데이터 타입 불일치 (Type Mismatch)
 * 4. ID 형식 일관성 (ID Format Inconsistency)
 * 5. 관계 참조 무결성 (Referential Integrity)
 * 6. 비즈니스 로직 검증 (Business Logic Validation)
 * 7. TZO 앱 호환성 (TZO App Compatibility)
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

// ═══════════════════════════════════════════════════════════════════════════
// Firebase/TZO가 기대하는 스키마 정의
// ═══════════════════════════════════════════════════════════════════════════

const EXPECTED_SCHEMAS = {
  menuItems: {
    required: ['name', 'price', 'categoryId', 'restaurantId'],
    optional: ['shortName', 'description', 'price2', 'imageUrl', 'isAvailable', 
               'sortOrder', 'posId', 'modifierGroupIds', 'taxGroupIds', 
               'printerGroupIds', 'kitchenTicketElements', 'options', 'createdAt', 'updatedAt'],
    types: {
      name: 'string',
      price: 'number',
      price2: 'number',
      categoryId: 'string',
      restaurantId: 'string',
      shortName: 'string',
      description: 'string',
      imageUrl: 'string',
      isAvailable: 'boolean',
      sortOrder: 'number',
      posId: 'number',
      modifierGroupIds: 'array',
      taxGroupIds: 'array',
      printerGroupIds: 'array',
      kitchenTicketElements: 'array',  // [{ name: string, qty: number }, ...]
      options: 'array'
    }
  },
  menuCategories: {
    required: ['name', 'restaurantId'],
    optional: ['shortName', 'description', 'sortOrder', 'posId', 'imageUrl', 
               'isAvailable', 'createdAt', 'updatedAt'],
    types: {
      name: 'string',
      restaurantId: 'string',
      shortName: 'string',
      description: 'string',
      sortOrder: 'number',
      posId: 'number',
      isAvailable: 'boolean'
    }
  },
  modifierGroups: {
    required: ['name', 'restaurantId'],
    optional: ['description', 'minSelections', 'maxSelections', 'isRequired',
               'modifiers', 'posId', 'createdAt', 'updatedAt'],
    types: {
      name: 'string',
      restaurantId: 'string',
      description: 'string',
      minSelections: 'number',
      maxSelections: 'number',
      isRequired: 'boolean',
      modifiers: 'array',
      posId: 'number'
    }
  },
  orders: {
    required: ['restaurantId', 'status', 'items', 'total', 'orderType'],
    optional: ['orderNumber', 'customerName', 'customerPhone', 'customerEmail',
               'pickupTime', 'prepTime', 'notes', 'paymentMethod', 'paymentStatus',
               'subtotal', 'tax', 'tip', 'discount', 'createdAt', 'updatedAt'],
    types: {
      restaurantId: 'string',
      status: 'string',
      items: 'array',
      total: 'number',
      orderType: 'string',
      orderNumber: 'string',
      customerName: 'string',
      subtotal: 'number',
      tax: 'number',
      tip: 'number'
    }
  }
};

// 결과 저장
const issues = {
  critical: [],
  warning: [],
  info: []
};

function addIssue(level, category, message, details = null) {
  issues[level].push({ category, message, details });
}

async function analyzeFromFirebasePerspective() {
  console.log('═'.repeat(80));
  console.log('🔥 Firebase 관점에서 POS 데이터 분석');
  console.log('═'.repeat(80));
  console.log(`\n분석 시간: ${new Date().toISOString()}`);
  console.log(`Restaurant ID: ${RESTAURANT_ID}\n`);
  
  const restaurantRef = firestore.collection('restaurants').doc(RESTAURANT_ID);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 1. 메뉴 아이템 분석
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('─'.repeat(80));
  console.log('📦 1. 메뉴 아이템 (menuItems) 분석');
  console.log('─'.repeat(80));
  
  const fbItems = await restaurantRef.collection('menuItems').get();
  const schema = EXPECTED_SCHEMAS.menuItems;
  
  let itemIssues = {
    missingRequired: [],
    wrongTypes: [],
    emptyArrays: [],
    invalidReferences: [],
    duplicatePosIds: []
  };
  
  const posIdSet = new Set();
  const posIdDuplicates = [];
  
  for (const doc of fbItems.docs) {
    const data = doc.data();
    const docId = doc.id;
    
    // 1.1 필수 필드 검사
    for (const field of schema.required) {
      if (data[field] === undefined || data[field] === null || data[field] === '') {
        itemIssues.missingRequired.push({ docId, name: data.name, field });
      }
    }
    
    // 1.2 타입 검사
    for (const [field, expectedType] of Object.entries(schema.types)) {
      if (data[field] !== undefined && data[field] !== null) {
        const actualType = Array.isArray(data[field]) ? 'array' : typeof data[field];
        if (actualType !== expectedType) {
          itemIssues.wrongTypes.push({ 
            docId, 
            name: data.name, 
            field, 
            expected: expectedType, 
            actual: actualType,
            value: data[field]
          });
        }
      }
    }
    
    // 1.3 빈 배열 검사 (잠재적 문제)
    const arrayFields = ['modifierGroupIds', 'taxGroupIds', 'printerGroupIds'];
    for (const field of arrayFields) {
      if (!data[field] || (Array.isArray(data[field]) && data[field].length === 0)) {
        itemIssues.emptyArrays.push({ docId, name: data.name, field });
      }
    }
    
    // 1.4 posId 중복 검사
    if (data.posId) {
      if (posIdSet.has(data.posId)) {
        posIdDuplicates.push({ docId, name: data.name, posId: data.posId });
      }
      posIdSet.add(data.posId);
    }
  }
  
  // 결과 출력
  console.log(`\n   총 아이템: ${fbItems.size}개`);
  
  if (itemIssues.missingRequired.length > 0) {
    console.log(`\n   🔴 필수 필드 누락: ${itemIssues.missingRequired.length}개`);
    const grouped = {};
    itemIssues.missingRequired.forEach(i => {
      grouped[i.field] = (grouped[i.field] || 0) + 1;
    });
    Object.entries(grouped).forEach(([field, count]) => {
      console.log(`      - ${field}: ${count}개 아이템`);
      addIssue('critical', 'MISSING_REQUIRED', `menuItems.${field} 누락`, `${count}개`);
    });
  }
  
  if (itemIssues.wrongTypes.length > 0) {
    console.log(`\n   🔴 타입 불일치: ${itemIssues.wrongTypes.length}개`);
    itemIssues.wrongTypes.slice(0, 5).forEach(i => {
      console.log(`      - ${i.name}.${i.field}: ${i.expected} 예상, ${i.actual} 실제`);
    });
    addIssue('critical', 'TYPE_MISMATCH', 'menuItems 타입 불일치', `${itemIssues.wrongTypes.length}개`);
  }
  
  if (posIdDuplicates.length > 0) {
    console.log(`\n   🔴 중복 posId: ${posIdDuplicates.length}개`);
    posIdDuplicates.forEach(i => {
      console.log(`      - ${i.name}: posId=${i.posId}`);
    });
    addIssue('critical', 'DUPLICATE_ID', 'menuItems posId 중복', posIdDuplicates.map(d => d.posId).join(', '));
  }
  
  // 빈 배열은 경고로 처리
  const emptyModifiers = itemIssues.emptyArrays.filter(i => i.field === 'modifierGroupIds').length;
  const emptyTaxGroups = itemIssues.emptyArrays.filter(i => i.field === 'taxGroupIds').length;
  const emptyPrinterGroups = itemIssues.emptyArrays.filter(i => i.field === 'printerGroupIds').length;
  
  console.log(`\n   🟡 연결 누락 (선택적):`);
  console.log(`      - modifierGroupIds 없음: ${emptyModifiers}개 아이템`);
  console.log(`      - taxGroupIds 없음: ${emptyTaxGroups}개 아이템`);
  console.log(`      - printerGroupIds 없음: ${emptyPrinterGroups}개 아이템`);
  
  if (emptyTaxGroups > fbItems.size * 0.5) {
    addIssue('warning', 'MISSING_TAX', '50% 이상 아이템에 taxGroupIds 없음', `${emptyTaxGroups}/${fbItems.size}`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 2. 카테고리 분석
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('📁 2. 메뉴 카테고리 (menuCategories) 분석');
  console.log('─'.repeat(80));
  
  const fbCategories = await restaurantRef.collection('menuCategories').get();
  const catSchema = EXPECTED_SCHEMAS.menuCategories;
  
  let catMissingRequired = [];
  let catWithoutItems = [];
  const catIds = new Set(fbCategories.docs.map(d => d.id));
  
  // 아이템별 카테고리 사용 횟수
  const catUsage = {};
  for (const doc of fbItems.docs) {
    const catId = doc.data().categoryId;
    catUsage[catId] = (catUsage[catId] || 0) + 1;
  }
  
  for (const doc of fbCategories.docs) {
    const data = doc.data();
    
    // 필수 필드 검사
    for (const field of catSchema.required) {
      if (!data[field]) {
        catMissingRequired.push({ docId: doc.id, name: data.name, field });
      }
    }
    
    // 아이템 없는 카테고리
    if (!catUsage[doc.id]) {
      catWithoutItems.push({ docId: doc.id, name: data.name });
    }
  }
  
  console.log(`\n   총 카테고리: ${fbCategories.size}개`);
  
  if (catMissingRequired.length > 0) {
    console.log(`\n   🔴 필수 필드 누락: ${catMissingRequired.length}개`);
    addIssue('critical', 'MISSING_REQUIRED', 'menuCategories 필수 필드 누락', `${catMissingRequired.length}개`);
  }
  
  if (catWithoutItems.length > 0) {
    console.log(`\n   🟡 아이템 없는 카테고리: ${catWithoutItems.length}개`);
    catWithoutItems.forEach(c => {
      console.log(`      - ${c.name}`);
    });
    addIssue('info', 'EMPTY_CATEGORY', '아이템 없는 카테고리', catWithoutItems.map(c => c.name).join(', '));
  }
  
  // 아이템이 참조하는 존재하지 않는 카테고리
  const invalidCatRefs = [];
  for (const doc of fbItems.docs) {
    const catId = doc.data().categoryId;
    if (catId && !catIds.has(catId)) {
      invalidCatRefs.push({ name: doc.data().name, categoryId: catId });
    }
  }
  
  if (invalidCatRefs.length > 0) {
    console.log(`\n   🔴 존재하지 않는 카테고리 참조: ${invalidCatRefs.length}개`);
    invalidCatRefs.forEach(r => {
      console.log(`      - ${r.name} → ${r.categoryId}`);
    });
    addIssue('critical', 'INVALID_REFERENCE', '존재하지 않는 categoryId 참조', `${invalidCatRefs.length}개`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 3. 모디파이어 그룹 분석
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('🔧 3. 모디파이어 그룹 (modifierGroups) 분석');
  console.log('─'.repeat(80));
  
  const fbModifiers = await restaurantRef.collection('modifierGroups').get();
  const modIds = new Set(fbModifiers.docs.map(d => d.id));
  
  let modIssues = {
    noModifiers: [],
    invalidModifiers: [],
    invalidMinMax: []
  };
  
  for (const doc of fbModifiers.docs) {
    const data = doc.data();
    
    // modifiers 배열 검사
    if (!data.modifiers || data.modifiers.length === 0) {
      modIssues.noModifiers.push({ docId: doc.id, name: data.name });
    } else {
      // 각 modifier 검사
      for (const mod of data.modifiers) {
        if (!mod.name || mod.price === undefined) {
          modIssues.invalidModifiers.push({ 
            docId: doc.id, 
            groupName: data.name, 
            modifier: mod 
          });
        }
      }
    }
    
    // min/max 검사
    if (data.minSelections !== undefined && data.maxSelections !== undefined) {
      if (data.minSelections > data.maxSelections) {
        modIssues.invalidMinMax.push({ 
          docId: doc.id, 
          name: data.name, 
          min: data.minSelections, 
          max: data.maxSelections 
        });
      }
    }
  }
  
  console.log(`\n   총 모디파이어 그룹: ${fbModifiers.size}개`);
  
  if (modIssues.noModifiers.length > 0) {
    console.log(`\n   🟡 옵션 없는 그룹: ${modIssues.noModifiers.length}개`);
    modIssues.noModifiers.forEach(m => console.log(`      - ${m.name}`));
    addIssue('warning', 'EMPTY_MODIFIERS', '옵션 없는 모디파이어 그룹', `${modIssues.noModifiers.length}개`);
  }
  
  if (modIssues.invalidMinMax.length > 0) {
    console.log(`\n   🔴 잘못된 min/max: ${modIssues.invalidMinMax.length}개`);
    addIssue('critical', 'INVALID_MINMAX', 'min > max 설정', `${modIssues.invalidMinMax.length}개`);
  }
  
  // 아이템에서 참조하는 존재하지 않는 모디파이어 그룹
  const invalidModRefs = [];
  for (const doc of fbItems.docs) {
    const data = doc.data();
    if (data.modifierGroupIds && data.modifierGroupIds.length > 0) {
      for (const modId of data.modifierGroupIds) {
        if (!modIds.has(modId)) {
          invalidModRefs.push({ itemName: data.name, modifierId: modId });
        }
      }
    }
  }
  
  if (invalidModRefs.length > 0) {
    console.log(`\n   🔴 존재하지 않는 모디파이어 참조: ${invalidModRefs.length}개`);
    addIssue('critical', 'INVALID_REFERENCE', '존재하지 않는 modifierGroupId 참조', `${invalidModRefs.length}개`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 4. 주문 데이터 분석
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('📋 4. 주문 (orders) 분석');
  console.log('─'.repeat(80));
  
  const fbOrders = await restaurantRef.collection('orders').get();
  const orderSchema = EXPECTED_SCHEMAS.orders;
  
  let orderIssues = {
    missingRequired: [],
    invalidStatus: [],
    emptyItems: [],
    invalidTotal: [],
    missingOrderNumber: []
  };
  
  const validStatuses = ['pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled', 'picked_up'];
  const orderNumbers = new Set();
  const duplicateOrderNumbers = [];
  
  for (const doc of fbOrders.docs) {
    const data = doc.data();
    
    // 필수 필드 검사
    for (const field of orderSchema.required) {
      if (data[field] === undefined || data[field] === null) {
        orderIssues.missingRequired.push({ docId: doc.id, orderNumber: data.orderNumber, field });
      }
    }
    
    // 상태 유효성
    if (data.status && !validStatuses.includes(data.status)) {
      orderIssues.invalidStatus.push({ docId: doc.id, status: data.status });
    }
    
    // items 배열 검사
    if (!data.items || data.items.length === 0) {
      orderIssues.emptyItems.push({ docId: doc.id, orderNumber: data.orderNumber });
    }
    
    // total 검사
    if (data.total !== undefined && (typeof data.total !== 'number' || data.total < 0)) {
      orderIssues.invalidTotal.push({ docId: doc.id, total: data.total });
    }
    
    // orderNumber 중복 검사
    if (data.orderNumber) {
      if (orderNumbers.has(data.orderNumber)) {
        duplicateOrderNumbers.push(data.orderNumber);
      }
      orderNumbers.add(data.orderNumber);
    } else {
      orderIssues.missingOrderNumber.push({ docId: doc.id });
    }
  }
  
  console.log(`\n   총 주문: ${fbOrders.size}개`);
  
  if (orderIssues.missingRequired.length > 0) {
    const grouped = {};
    orderIssues.missingRequired.forEach(o => {
      grouped[o.field] = (grouped[o.field] || 0) + 1;
    });
    console.log(`\n   🔴 필수 필드 누락:`);
    Object.entries(grouped).forEach(([field, count]) => {
      console.log(`      - ${field}: ${count}개 주문`);
    });
    addIssue('critical', 'MISSING_REQUIRED', 'orders 필수 필드 누락', JSON.stringify(grouped));
  }
  
  if (orderIssues.invalidStatus.length > 0) {
    console.log(`\n   🔴 잘못된 상태값: ${orderIssues.invalidStatus.length}개`);
    addIssue('critical', 'INVALID_STATUS', '잘못된 주문 상태', `${orderIssues.invalidStatus.length}개`);
  }
  
  if (duplicateOrderNumbers.length > 0) {
    console.log(`\n   🔴 중복 주문번호: ${duplicateOrderNumbers.length}개`);
    addIssue('critical', 'DUPLICATE_ORDER', '중복 orderNumber', duplicateOrderNumbers.join(', '));
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 5. POS → Firebase 필드 매핑 검증
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('🔄 5. POS → Firebase 필드 매핑 검증');
  console.log('─'.repeat(80));
  
  // POS 테이블 스키마 조회
  const posItemSchema = await dbAll('PRAGMA table_info(menu_items)');
  const posCatSchema = await dbAll('PRAGMA table_info(menu_categories)');
  const posModSchema = await dbAll('PRAGMA table_info(modifier_groups)');
  
  console.log('\n   [POS 컬럼] → [Firebase 필드] 매핑 검증:');
  
  // 매핑 테이블
  const fieldMappings = {
    menu_items: {
      item_id: 'posId',
      name: 'name',
      short_name: 'shortName',
      price: 'price',
      price2: 'price2',
      description: 'description',
      image_url: 'imageUrl',
      category_id: 'categoryId (변환 필요)',
      sort_order: 'sortOrder',
      is_open_price: 'isOpenPrice',
      firebase_id: '(역참조용)'
    },
    menu_categories: {
      category_id: 'posId',
      name: 'name',
      short_name: 'shortName',
      description: 'description',
      sort_order: 'sortOrder',
      firebase_id: '(역참조용)'
    }
  };
  
  console.log('\n   menu_items:');
  posItemSchema.forEach(col => {
    const mapping = fieldMappings.menu_items[col.name];
    const status = mapping ? '✅' : '⚠️';
    console.log(`      ${status} ${col.name} → ${mapping || '(매핑 없음)'}`);
    if (!mapping && !['menu_id', 'created_at', 'updated_at'].includes(col.name)) {
      addIssue('info', 'UNMAPPED_FIELD', `POS ${col.name} 필드 매핑 없음`, '');
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 6. TZO 앱 호환성 검증
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('📱 6. TZO 앱 호환성 검증');
  console.log('─'.repeat(80));
  
  // TZO가 필요로 하는 필드들
  const tzoRequirements = {
    menuItems: ['name', 'price', 'categoryId', 'isAvailable', 'imageUrl'],
    menuCategories: ['name', 'sortOrder'],
    modifierGroups: ['name', 'modifiers', 'minSelections', 'maxSelections', 'isRequired']
  };
  
  console.log('\n   TZO 필수 필드 검증:');
  
  // menuItems
  let tzoItemIssues = [];
  for (const doc of fbItems.docs) {
    const data = doc.data();
    const missing = tzoRequirements.menuItems.filter(f => data[f] === undefined || data[f] === null);
    if (missing.length > 0) {
      tzoItemIssues.push({ name: data.name, missing });
    }
  }
  
  if (tzoItemIssues.length > 0) {
    console.log(`\n   🟡 menuItems TZO 필드 누락: ${tzoItemIssues.length}개`);
    const missingCounts = {};
    tzoItemIssues.forEach(i => {
      i.missing.forEach(f => {
        missingCounts[f] = (missingCounts[f] || 0) + 1;
      });
    });
    Object.entries(missingCounts).forEach(([field, count]) => {
      console.log(`      - ${field}: ${count}개 아이템`);
    });
    addIssue('warning', 'TZO_COMPATIBILITY', 'TZO 필드 누락', JSON.stringify(missingCounts));
  } else {
    console.log(`   ✅ menuItems: 모든 TZO 필수 필드 존재`);
  }
  
  // isAvailable = false인 아이템 (TZO에서 숨김)
  let unavailableItems = 0;
  for (const doc of fbItems.docs) {
    if (doc.data().isAvailable === false) {
      unavailableItems++;
    }
  }
  console.log(`\n   📊 isAvailable=false (TZO 숨김): ${unavailableItems}개 아이템`);
  
  // 이미지 없는 아이템 (TZO UX 영향)
  let noImageItems = 0;
  for (const doc of fbItems.docs) {
    if (!doc.data().imageUrl || doc.data().imageUrl === '') {
      noImageItems++;
    }
  }
  console.log(`   📊 이미지 없음 (TZO UX 영향): ${noImageItems}개 아이템`);
  
  if (noImageItems > fbItems.size * 0.8) {
    addIssue('warning', 'TZO_UX', '80% 이상 아이템에 이미지 없음', `${noImageItems}/${fbItems.size}`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 7. 데이터 일관성 검증
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('🔍 7. 데이터 일관성 검증');
  console.log('─'.repeat(80));
  
  // 7.1 가격 범위 검사
  let priceIssues = { zero: 0, negative: 0, veryHigh: 0 };
  for (const doc of fbItems.docs) {
    const price = doc.data().price || 0;
    if (price === 0) priceIssues.zero++;
    if (price < 0) priceIssues.negative++;
    if (price > 500) priceIssues.veryHigh++;
  }
  
  console.log(`\n   가격 분포:`);
  console.log(`      - $0 (무료): ${priceIssues.zero}개`);
  console.log(`      - 음수 (오류): ${priceIssues.negative}개`);
  console.log(`      - $500+ (이상치): ${priceIssues.veryHigh}개`);
  
  if (priceIssues.negative > 0) {
    addIssue('critical', 'INVALID_PRICE', '음수 가격', `${priceIssues.negative}개`);
  }
  
  // 7.2 sortOrder 검사
  const sortOrders = fbItems.docs.map(d => d.data().sortOrder).filter(s => s !== undefined);
  const duplicateSorts = sortOrders.filter((s, i) => sortOrders.indexOf(s) !== i);
  
  console.log(`\n   sortOrder 검사:`);
  console.log(`      - 설정됨: ${sortOrders.length}개`);
  console.log(`      - 중복: ${new Set(duplicateSorts).size}개`);
  
  // 7.3 timestamp 검사
  let noCreatedAt = 0;
  let noUpdatedAt = 0;
  for (const doc of fbItems.docs) {
    const data = doc.data();
    if (!data.createdAt) noCreatedAt++;
    if (!data.updatedAt) noUpdatedAt++;
  }
  
  console.log(`\n   타임스탬프 검사:`);
  console.log(`      - createdAt 없음: ${noCreatedAt}개`);
  console.log(`      - updatedAt 없음: ${noUpdatedAt}개`);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 최종 결과
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(80));
  console.log('📊 Firebase 관점 분석 결과');
  console.log('═'.repeat(80));
  
  console.log(`\n🔴 CRITICAL (즉시 수정 필요): ${issues.critical.length}개`);
  if (issues.critical.length === 0) {
    console.log('   없음 ✅');
  } else {
    issues.critical.forEach(i => {
      console.log(`   ❌ [${i.category}] ${i.message}: ${i.details || ''}`);
    });
  }
  
  console.log(`\n🟡 WARNING (개선 권장): ${issues.warning.length}개`);
  if (issues.warning.length === 0) {
    console.log('   없음 ✅');
  } else {
    issues.warning.forEach(i => {
      console.log(`   ⚠️  [${i.category}] ${i.message}: ${i.details || ''}`);
    });
  }
  
  console.log(`\n🔵 INFO (참고): ${issues.info.length}개`);
  issues.info.forEach(i => {
    console.log(`   ℹ️  [${i.category}] ${i.message}`);
  });
  
  // 권장 사항
  console.log('\n' + '─'.repeat(80));
  console.log('💡 권장 사항');
  console.log('─'.repeat(80));
  
  const recommendations = [];
  
  if (noImageItems > fbItems.size * 0.5) {
    recommendations.push('메뉴 아이템에 이미지 추가 (TZO 앱 UX 개선)');
  }
  
  if (emptyTaxGroups > fbItems.size * 0.5) {
    recommendations.push('아이템에 taxGroupIds 연결 (세금 계산 정확도)');
  }
  
  if (emptyModifiers > fbItems.size * 0.8) {
    recommendations.push('필요한 아이템에 모디파이어 연결 (옵션 선택 기능)');
  }
  
  if (issues.critical.length === 0) {
    recommendations.push('✅ 시스템 운영 준비 완료');
  }
  
  recommendations.forEach((r, i) => {
    console.log(`   ${i + 1}. ${r}`);
  });
  
  console.log('\n' + '═'.repeat(80));
  
  db.close();
  process.exit(issues.critical.length > 0 ? 1 : 0);
}

analyzeFromFirebasePerspective().catch(err => {
  console.error('Analysis failed:', err);
  db.close();
  process.exit(1);
});
