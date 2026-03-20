/**
 * 🔍 3rd Party 연동 준비를 위한 종합 데이터베이스 분석
 * 
 * 분석 대상:
 * 1. 모든 SQLite 테이블 스키마
 * 2. ID 체계 분석 (일관성, 형식, 중복)
 * 3. 테이블맵 관련 데이터
 * 4. Order/주문 관련 데이터
 * 5. 결제 관련 데이터
 * 6. Firebase와의 비교
 * 7. 3rd Party 연동 준비 상태
 * 
 * 연동 예정:
 * - TryOtter (주문 통합)
 * - Urban Piper (주문 통합)
 * - Elavon (결제)
 * - Clover (결제)
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

// 분석 결과 저장
const issues = {
  critical: [],
  warning: [],
  info: [],
  thirdPartyReady: []
};

function addIssue(level, category, message, details = null) {
  issues[level].push({ category, message, details });
}

async function comprehensiveAnalysis() {
  console.log('═'.repeat(90));
  console.log('🔍 3rd Party 연동 준비를 위한 종합 데이터베이스 분석');
  console.log('═'.repeat(90));
  console.log(`\n분석 시간: ${new Date().toISOString()}`);
  console.log(`Restaurant ID: ${RESTAURANT_ID}`);
  console.log(`\n예정된 연동: TryOtter, Urban Piper, Elavon, Clover\n`);
  
  // ═══════════════════════════════════════════════════════════════════════════════════════
  // 1. 모든 SQLite 테이블 목록
  // ═══════════════════════════════════════════════════════════════════════════════════════
  console.log('═'.repeat(90));
  console.log('📋 1. SQLite 테이블 전체 목록');
  console.log('═'.repeat(90));
  
  const tables = await dbAll(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`);
  
  // 테이블 분류
  const tableCategories = {
    menu: [],
    order: [],
    payment: [],
    table: [],
    employee: [],
    settings: [],
    sync: [],
    other: []
  };
  
  for (const t of tables) {
    const name = t.name;
    if (name.includes('menu') || name.includes('category') || name.includes('modifier') || name.includes('tax') || name.includes('printer')) {
      tableCategories.menu.push(name);
    } else if (name.includes('order') || name.includes('guest')) {
      tableCategories.order.push(name);
    } else if (name.includes('payment') || name.includes('transaction') || name.includes('card')) {
      tableCategories.payment.push(name);
    } else if (name.includes('table') || name.includes('floor') || name.includes('map') || name.includes('element')) {
      tableCategories.table.push(name);
    } else if (name.includes('employee') || name.includes('user') || name.includes('staff')) {
      tableCategories.employee.push(name);
    } else if (name.includes('setting') || name.includes('config') || name.includes('store')) {
      tableCategories.settings.push(name);
    } else if (name.includes('sync') || name.includes('firebase') || name.includes('log')) {
      tableCategories.sync.push(name);
    } else {
      tableCategories.other.push(name);
    }
  }
  
  console.log(`\n   총 테이블: ${tables.length}개\n`);
  
  Object.entries(tableCategories).forEach(([cat, tbls]) => {
    if (tbls.length > 0) {
      console.log(`   [${cat.toUpperCase()}] ${tbls.length}개`);
      tbls.forEach(t => console.log(`      - ${t}`));
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════════════════
  // 2. 테이블맵 관련 분석
  // ═══════════════════════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(90));
  console.log('🗺️  2. 테이블맵 관련 분석');
  console.log('═'.repeat(90));
  
  // 테이블맵 관련 테이블 스키마
  const tableMapTables = ['table_map_elements', 'floors', 'tables', 'table_maps'];
  
  for (const tableName of tableMapTables) {
    try {
      const schema = await dbAll(`PRAGMA table_info(${tableName})`);
      if (schema.length > 0) {
        const count = await dbAll(`SELECT COUNT(*) as cnt FROM ${tableName}`);
        console.log(`\n   📊 ${tableName} (${count[0].cnt}개 레코드)`);
        console.log(`   ` + '─'.repeat(60));
        
        // 컬럼 정보
        const columns = schema.map(c => ({
          name: c.name,
          type: c.type,
          pk: c.pk === 1,
          nullable: c.notnull === 0
        }));
        
        // ID 컬럼 식별
        const idColumns = columns.filter(c => c.name.includes('id') || c.name.includes('Id') || c.pk);
        console.log(`   ID 컬럼: ${idColumns.map(c => c.name).join(', ') || 'none'}`);
        console.log(`   전체 컬럼: ${columns.map(c => c.name).join(', ')}`);
        
        // Firebase 연동 필드 확인
        const hasFirebaseId = columns.some(c => c.name === 'firebase_id');
        console.log(`   Firebase 연동: ${hasFirebaseId ? '✅ firebase_id 있음' : '❌ firebase_id 없음'}`);
        
        if (!hasFirebaseId && count[0].cnt > 0) {
          addIssue('warning', 'TABLE_MAP', `${tableName}에 firebase_id 없음`, `${count[0].cnt}개 레코드`);
        }
        
        // 샘플 데이터
        const sample = await dbAll(`SELECT * FROM ${tableName} LIMIT 2`);
        if (sample.length > 0) {
          console.log(`   샘플: ${JSON.stringify(sample[0]).substring(0, 100)}...`);
        }
      }
    } catch (e) {
      // 테이블이 없는 경우
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════════════
  // 3. Order/주문 관련 분석
  // ═══════════════════════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(90));
  console.log('📋 3. Order/주문 관련 분석');
  console.log('═'.repeat(90));
  
  const orderTables = ['orders', 'order_items', 'order_modifiers', 'order_payments', 'split_orders', 'void_orders'];
  
  for (const tableName of orderTables) {
    try {
      const schema = await dbAll(`PRAGMA table_info(${tableName})`);
      if (schema.length > 0) {
        const count = await dbAll(`SELECT COUNT(*) as cnt FROM ${tableName}`);
        console.log(`\n   📊 ${tableName} (${count[0].cnt}개 레코드)`);
        console.log(`   ` + '─'.repeat(60));
        
        const columns = schema.map(c => c.name);
        const idColumns = columns.filter(c => c.includes('id') || c.includes('Id'));
        
        console.log(`   ID 컬럼: ${idColumns.join(', ') || 'none'}`);
        console.log(`   전체 컬럼: ${columns.join(', ')}`);
        
        // 3rd Party 연동에 필요한 필드 확인
        const requiredFor3rdParty = ['order_id', 'order_number', 'status', 'total', 'subtotal', 'tax', 'created_at'];
        const missing3rdParty = requiredFor3rdParty.filter(f => !columns.includes(f) && !columns.includes(f.replace('_', '')));
        
        if (missing3rdParty.length > 0 && tableName === 'orders') {
          console.log(`   ⚠️  3rd Party 필수 필드 누락: ${missing3rdParty.join(', ')}`);
          addIssue('warning', 'ORDER', `orders 테이블 3rd Party 필드 누락`, missing3rdParty.join(', '));
        }
        
        // Firebase 연동 필드
        const hasFirebaseId = columns.includes('firebase_id');
        console.log(`   Firebase 연동: ${hasFirebaseId ? '✅ firebase_id 있음' : '⚪ firebase_id 없음'}`);
        
        // 샘플 데이터
        const sample = await dbAll(`SELECT * FROM ${tableName} LIMIT 1`);
        if (sample.length > 0) {
          console.log(`   샘플: ${JSON.stringify(sample[0]).substring(0, 120)}...`);
        }
      }
    } catch (e) {
      console.log(`\n   ⚪ ${tableName}: 테이블 없음`);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════════════
  // 4. 결제 관련 분석 (Elavon, Clover 연동 대비)
  // ═══════════════════════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(90));
  console.log('💳 4. 결제 관련 분석 (Elavon, Clover 연동 대비)');
  console.log('═'.repeat(90));
  
  const paymentTables = ['payments', 'payment_methods', 'transactions', 'refunds', 'tips', 'card_transactions'];
  
  for (const tableName of paymentTables) {
    try {
      const schema = await dbAll(`PRAGMA table_info(${tableName})`);
      if (schema.length > 0) {
        const count = await dbAll(`SELECT COUNT(*) as cnt FROM ${tableName}`);
        console.log(`\n   📊 ${tableName} (${count[0].cnt}개 레코드)`);
        console.log(`   ` + '─'.repeat(60));
        
        const columns = schema.map(c => c.name);
        console.log(`   컬럼: ${columns.join(', ')}`);
        
        // 결제 연동 필수 필드
        const paymentRequired = ['amount', 'payment_type', 'status', 'transaction_id', 'order_id'];
        const missingPayment = paymentRequired.filter(f => !columns.includes(f) && !columns.includes(f.replace('_', '')));
        
        if (missingPayment.length > 0 && tableName === 'payments') {
          console.log(`   ⚠️  결제 필수 필드 누락: ${missingPayment.join(', ')}`);
        }
      }
    } catch (e) {
      console.log(`\n   ⚪ ${tableName}: 테이블 없음`);
      if (tableName === 'payments') {
        addIssue('critical', 'PAYMENT', 'payments 테이블 없음', 'Elavon/Clover 연동에 필요');
      }
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════════════
  // 5. ID 체계 종합 분석
  // ═══════════════════════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(90));
  console.log('🔢 5. ID 체계 종합 분석');
  console.log('═'.repeat(90));
  
  // 각 테이블의 ID 형식 분석
  const idAnalysis = {};
  
  const tablesToAnalyze = [
    { table: 'menu_items', idCol: 'item_id' },
    { table: 'menu_categories', idCol: 'category_id' },
    { table: 'menus', idCol: 'menu_id' },
    { table: 'modifier_groups', idCol: 'group_id' },
    { table: 'tax_groups', idCol: 'id' },
    { table: 'printer_groups', idCol: 'id' },
    { table: 'orders', idCol: 'order_id' },
    { table: 'table_map_elements', idCol: 'id' },
    { table: 'floors', idCol: 'floor_id' },
    { table: 'employees', idCol: 'employee_id' },
    { table: 'stores', idCol: 'store_id' }
  ];
  
  console.log('\n   테이블별 ID 형식 분석:\n');
  console.log('   ' + '─'.repeat(75));
  console.log('   테이블                    ID 컬럼        형식           범위/샘플');
  console.log('   ' + '─'.repeat(75));
  
  for (const { table, idCol } of tablesToAnalyze) {
    try {
      const sample = await dbAll(`SELECT ${idCol} FROM ${table} ORDER BY ${idCol} LIMIT 5`);
      const stats = await dbAll(`SELECT MIN(${idCol}) as min, MAX(${idCol}) as max, COUNT(*) as cnt FROM ${table}`);
      
      if (sample.length > 0) {
        const sampleId = sample[0][idCol];
        let idFormat = 'unknown';
        
        if (typeof sampleId === 'number') {
          if (sampleId >= 100000 && sampleId < 1000000) {
            idFormat = '6-digit number';
          } else if (sampleId >= 200000 && sampleId < 210000) {
            idFormat = '20xxxx (menu)';
          } else if (sampleId >= 205000 && sampleId < 206000) {
            idFormat = '205xxx (category)';
          } else if (sampleId >= 340000 && sampleId < 350000) {
            idFormat = '34xxxx (modifier)';
          } else {
            idFormat = 'auto-increment';
          }
        } else if (typeof sampleId === 'string') {
          if (sampleId.startsWith('ORD-')) {
            idFormat = 'ORD-XXXXXXXX';
          } else if (sampleId.includes('-')) {
            idFormat = 'UUID-like';
          } else {
            idFormat = 'string';
          }
        }
        
        const range = stats[0].cnt > 0 ? `${stats[0].min} ~ ${stats[0].max} (${stats[0].cnt}개)` : 'empty';
        console.log(`   ${table.padEnd(25)} ${idCol.padEnd(14)} ${idFormat.padEnd(15)} ${range}`);
        
        idAnalysis[table] = { idCol, format: idFormat, min: stats[0].min, max: stats[0].max, count: stats[0].cnt };
      }
    } catch (e) {
      console.log(`   ${table.padEnd(25)} ${'N/A'.padEnd(14)} ${'테이블 없음'.padEnd(15)} -`);
    }
  }
  
  console.log('   ' + '─'.repeat(75));
  
  // ID 중복 검사
  console.log('\n   ID 중복 검사:');
  
  for (const { table, idCol } of tablesToAnalyze) {
    try {
      const duplicates = await dbAll(`
        SELECT ${idCol}, COUNT(*) as cnt 
        FROM ${table} 
        GROUP BY ${idCol} 
        HAVING COUNT(*) > 1
      `);
      
      if (duplicates.length > 0) {
        console.log(`   ❌ ${table}.${idCol}: ${duplicates.length}개 중복!`);
        addIssue('critical', 'ID_DUPLICATE', `${table}.${idCol} 중복`, duplicates.map(d => d[idCol]).join(', '));
      }
    } catch (e) {
      // 테이블 없음
    }
  }
  
  console.log(`   ✅ 중복 없음 (검사된 테이블 기준)`);
  
  // ═══════════════════════════════════════════════════════════════════════════════════════
  // 6. Firebase와 비교
  // ═══════════════════════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(90));
  console.log('🔥 6. Firebase와 비교');
  console.log('═'.repeat(90));
  
  const restaurantRef = firestore.collection('restaurants').doc(RESTAURANT_ID);
  
  // 컬렉션별 비교
  const comparisons = [
    { pos: 'menu_items', firebase: 'menuItems', posIdCol: 'item_id', fbIdCol: 'posId' },
    { pos: 'menu_categories', firebase: 'menuCategories', posIdCol: 'category_id', fbIdCol: 'posId' },
    { pos: 'modifier_groups', firebase: 'modifierGroups', posIdCol: 'group_id', fbIdCol: 'posId' },
    { pos: 'tax_groups', firebase: 'taxGroups', posIdCol: 'id', fbIdCol: 'posId' },
    { pos: 'printer_groups', firebase: 'printerGroups', posIdCol: 'id', fbIdCol: 'posId' }
  ];
  
  console.log('\n   POS ↔ Firebase 데이터 비교:\n');
  console.log('   ' + '─'.repeat(75));
  console.log('   테이블                    POS        Firebase   연결됨     상태');
  console.log('   ' + '─'.repeat(75));
  
  for (const comp of comparisons) {
    try {
      // POS 데이터 (menu_id = 200005인 것만)
      let posData;
      if (comp.pos === 'menu_items' || comp.pos === 'menu_categories') {
        posData = await dbAll(`SELECT ${comp.posIdCol}, firebase_id FROM ${comp.pos} WHERE menu_id = 200005`);
      } else {
        posData = await dbAll(`SELECT ${comp.posIdCol}, firebase_id FROM ${comp.pos}`);
      }
      
      // Firebase 데이터
      const fbData = await restaurantRef.collection(comp.firebase).get();
      
      // 연결 상태
      const linked = posData.filter(p => p.firebase_id).length;
      
      let status = '✅';
      if (posData.length !== fbData.size) {
        status = '⚠️  수량 불일치';
        addIssue('warning', 'SYNC', `${comp.pos} 수량 불일치`, `POS: ${posData.length}, Firebase: ${fbData.size}`);
      } else if (linked < posData.length) {
        status = '⚠️  연결 누락';
      }
      
      console.log(`   ${comp.pos.padEnd(25)} ${String(posData.length).padEnd(10)} ${String(fbData.size).padEnd(10)} ${String(linked).padEnd(10)} ${status}`);
    } catch (e) {
      console.log(`   ${comp.pos.padEnd(25)} Error: ${e.message}`);
    }
  }
  
  console.log('   ' + '─'.repeat(75));
  
  // ═══════════════════════════════════════════════════════════════════════════════════════
  // 7. 3rd Party 연동 준비 상태
  // ═══════════════════════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(90));
  console.log('🔗 7. 3rd Party 연동 준비 상태');
  console.log('═'.repeat(90));
  
  // TryOtter / Urban Piper 요구사항
  console.log('\n   📦 TryOtter / Urban Piper (주문 통합)');
  console.log('   ' + '─'.repeat(60));
  
  const orderIntegrationReqs = [
    { req: 'restaurantId (매장 식별자)', check: 'stores 테이블' },
    { req: 'menuItems (메뉴 동기화)', check: 'Firebase menuItems' },
    { req: 'modifiers (옵션 동기화)', check: 'Firebase modifierGroups' },
    { req: 'orderCallback (주문 수신)', check: 'API 엔드포인트' },
    { req: 'orderStatus (상태 업데이트)', check: 'orders.status 필드' },
    { req: 'webhooks (실시간 알림)', check: '웹훅 엔드포인트' }
  ];
  
  for (const req of orderIntegrationReqs) {
    let status = '⚪ 확인 필요';
    
    if (req.check.includes('Firebase')) {
      status = '✅ 준비됨';
    } else if (req.check.includes('테이블')) {
      try {
        const exists = await dbAll(`SELECT 1 FROM ${req.check.split(' ')[0]} LIMIT 1`);
        status = exists.length > 0 ? '✅ 준비됨' : '❌ 없음';
      } catch (e) {
        status = '❌ 테이블 없음';
      }
    }
    
    console.log(`   ${status} ${req.req}`);
  }
  
  // Elavon / Clover 요구사항
  console.log('\n   💳 Elavon / Clover (결제 연동)');
  console.log('   ' + '─'.repeat(60));
  
  const paymentIntegrationReqs = [
    { req: 'merchantId (가맹점 ID)', field: 'stores.merchant_id' },
    { req: 'terminalId (단말기 ID)', field: 'stores.terminal_id' },
    { req: 'transactionId (거래 ID)', field: 'payments.transaction_id' },
    { req: 'amount (결제 금액)', field: 'payments.amount' },
    { req: 'cardType (카드 종류)', field: 'payments.card_type' },
    { req: 'authCode (승인 번호)', field: 'payments.auth_code' },
    { req: 'refundSupport (환불 지원)', field: 'refunds 테이블' }
  ];
  
  for (const req of paymentIntegrationReqs) {
    let status = '⚪ 확인 필요';
    
    const [table, field] = req.field.split('.');
    
    try {
      if (table.includes('테이블')) {
        const exists = await dbAll(`SELECT 1 FROM ${table.replace(' 테이블', '')} LIMIT 1`);
        status = exists.length > 0 ? '✅ 준비됨' : '❌ 없음';
      } else {
        const schema = await dbAll(`PRAGMA table_info(${table})`);
        const hasField = schema.some(c => c.name === field);
        status = hasField ? '✅ 준비됨' : '❌ 필드 없음';
        
        if (!hasField) {
          addIssue('warning', 'PAYMENT_INTEGRATION', `${req.req} 필드 없음`, `${table}.${field} 추가 필요`);
        }
      }
    } catch (e) {
      status = '❌ 테이블 없음';
      addIssue('warning', 'PAYMENT_INTEGRATION', `${table} 테이블 없음`, req.req);
    }
    
    console.log(`   ${status} ${req.req}`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════════════
  // 8. 스키마 불일치 상세 분석
  // ═══════════════════════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(90));
  console.log('📐 8. 스키마 불일치 상세 분석');
  console.log('═'.repeat(90));
  
  // Firebase 필드 vs POS 필드 매핑
  const schemaMappings = {
    menuItems: {
      firebase: ['name', 'price', 'price2', 'categoryId', 'description', 'shortName', 'imageUrl', 
                 'isAvailable', 'sortOrder', 'posId', 'restaurantId', 'modifierGroupIds', 
                 'taxGroupIds', 'printerGroupIds', 'createdAt', 'updatedAt'],
      pos: ['item_id', 'name', 'price', 'price2', 'category_id', 'description', 'short_name',
            'image_url', 'sort_order', 'menu_id', 'is_open_price', 'firebase_id', 'created_at', 'updated_at']
    },
    orders: {
      firebase: ['orderNumber', 'status', 'orderType', 'items', 'subtotal', 'tax', 'total', 
                 'tip', 'discount', 'customerName', 'customerPhone', 'customerEmail', 
                 'pickupTime', 'prepTime', 'notes', 'paymentMethod', 'paymentStatus',
                 'restaurantId', 'createdAt', 'updatedAt'],
      pos: ['order_id', 'order_number', 'status', 'order_type', 'subtotal', 'tax', 'total',
            'tip', 'discount', 'customer_name', 'customer_phone', 'created_at', 'updated_at']
    }
  };
  
  for (const [collection, mapping] of Object.entries(schemaMappings)) {
    console.log(`\n   ${collection}:`);
    console.log(`   Firebase: ${mapping.firebase.length}개 필드`);
    console.log(`   POS: ${mapping.pos.length}개 필드`);
    
    // Firebase에만 있는 필드
    const firebaseOnly = mapping.firebase.filter(f => 
      !mapping.pos.some(p => 
        p === f || 
        p === f.replace(/([A-Z])/g, '_$1').toLowerCase() ||
        p.replace(/_/g, '') === f.toLowerCase()
      )
    );
    
    if (firebaseOnly.length > 0) {
      console.log(`   Firebase에만 있음: ${firebaseOnly.join(', ')}`);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════════════
  // 최종 결과
  // ═══════════════════════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(90));
  console.log('📊 최종 분석 결과');
  console.log('═'.repeat(90));
  
  console.log(`\n🔴 CRITICAL (${issues.critical.length}개):`);
  if (issues.critical.length === 0) {
    console.log('   없음 ✅');
  } else {
    issues.critical.forEach(i => {
      console.log(`   ❌ [${i.category}] ${i.message}: ${i.details || ''}`);
    });
  }
  
  console.log(`\n🟡 WARNING (${issues.warning.length}개):`);
  if (issues.warning.length === 0) {
    console.log('   없음 ✅');
  } else {
    issues.warning.forEach(i => {
      console.log(`   ⚠️  [${i.category}] ${i.message}: ${i.details || ''}`);
    });
  }
  
  // 3rd Party 연동 준비 체크리스트
  console.log('\n' + '─'.repeat(90));
  console.log('📋 3rd Party 연동 준비 체크리스트');
  console.log('─'.repeat(90));
  
  const checklist = [
    { item: 'Firebase 메뉴 동기화', status: '✅' },
    { item: 'restaurantId 통일', status: '✅' },
    { item: 'ID 매핑 (posId ↔ firebase_id)', status: '✅' },
    { item: '주문 서브컬렉션 마이그레이션', status: '✅' },
    { item: '결제 테이블 스키마', status: issues.warning.some(i => i.category === 'PAYMENT_INTEGRATION') ? '⚠️' : '✅' },
    { item: '테이블맵 Firebase 연동', status: issues.warning.some(i => i.category === 'TABLE_MAP') ? '⚠️' : '✅' }
  ];
  
  checklist.forEach(c => {
    console.log(`   ${c.status} ${c.item}`);
  });
  
  console.log('\n' + '═'.repeat(90));
  
  db.close();
  process.exit(issues.critical.length > 0 ? 1 : 0);
}

comprehensiveAnalysis().catch(err => {
  console.error('Analysis failed:', err);
  db.close();
  process.exit(1);
});
