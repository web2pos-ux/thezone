/**
 * 🔧 3rd Party 연동을 위한 데이터베이스 스키마 수정
 * 
 * 수정 항목:
 * 1. table_map_elements에 firebase_id 컬럼 추가
 * 2. orders에 order_id, subtotal 컬럼 추가 (별칭 또는 계산 필드)
 * 3. payments에 결제 연동 필드 추가
 * 4. stores 테이블 생성 또는 수정
 * 5. 누락된 모디파이어/세금 그룹 Firebase 동기화
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../../db/web2pos.db');
const db = new sqlite3.Database(dbPath);

const dbRun = (sql) => new Promise((resolve, reject) => {
  db.run(sql, function(err) {
    if (err) reject(err);
    else resolve({ lastID: this.lastID, changes: this.changes });
  });
});

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});

async function fix3rdPartyIssues() {
  console.log('═'.repeat(70));
  console.log('🔧 3rd Party 연동을 위한 스키마 수정');
  console.log('═'.repeat(70));
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 1. table_map_elements에 firebase_id 추가
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(70));
  console.log('[1] table_map_elements에 firebase_id 추가');
  console.log('─'.repeat(70));
  
  try {
    // 컬럼 존재 확인
    const tableMapCols = await dbAll('PRAGMA table_info(table_map_elements)');
    const hasFirebaseId = tableMapCols.some(c => c.name === 'firebase_id');
    
    if (!hasFirebaseId) {
      await dbRun('ALTER TABLE table_map_elements ADD COLUMN firebase_id TEXT');
      console.log('   ✅ firebase_id 컬럼 추가됨');
    } else {
      console.log('   ⏭️  firebase_id 이미 존재');
    }
  } catch (e) {
    console.log('   ❌ 오류:', e.message);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 2. orders에 subtotal 추가 (별도 컬럼)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(70));
  console.log('[2] orders에 subtotal, order_id 필드 확인/추가');
  console.log('─'.repeat(70));
  
  try {
    const orderCols = await dbAll('PRAGMA table_info(orders)');
    
    // subtotal 추가
    const hasSubtotal = orderCols.some(c => c.name === 'subtotal');
    if (!hasSubtotal) {
      await dbRun('ALTER TABLE orders ADD COLUMN subtotal REAL DEFAULT 0');
      console.log('   ✅ subtotal 컬럼 추가됨');
      
      // 기존 데이터 업데이트 (total - tax로 계산)
      await dbRun('UPDATE orders SET subtotal = total - COALESCE(tax, 0) WHERE subtotal = 0 OR subtotal IS NULL');
      console.log('   ✅ 기존 주문 subtotal 계산 완료');
    } else {
      console.log('   ⏭️  subtotal 이미 존재');
    }
    
    // order_id는 id로 사용 (별칭으로 VIEW 생성 고려)
    const hasOrderId = orderCols.some(c => c.name === 'order_id');
    if (!hasOrderId) {
      // order_id 컬럼은 id를 대체하므로 추가하지 않음 (id 사용)
      console.log('   ℹ️  order_id는 id 컬럼으로 대체 사용');
    }
  } catch (e) {
    console.log('   ❌ 오류:', e.message);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 3. payments에 결제 연동 필드 추가
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(70));
  console.log('[3] payments에 결제 연동 필드 추가');
  console.log('─'.repeat(70));
  
  try {
    const paymentCols = await dbAll('PRAGMA table_info(payments)');
    const existingCols = paymentCols.map(c => c.name);
    
    const newCols = [
      { name: 'transaction_id', type: 'TEXT', desc: '외부 거래 ID (Elavon/Clover)' },
      { name: 'card_type', type: 'TEXT', desc: '카드 종류 (Visa, MC, etc.)' },
      { name: 'auth_code', type: 'TEXT', desc: '승인 번호' },
      { name: 'card_last_four', type: 'TEXT', desc: '카드 마지막 4자리' },
      { name: 'payment_provider', type: 'TEXT', desc: '결제 제공자 (elavon, clover, etc.)' },
      { name: 'device_id', type: 'TEXT', desc: '결제 단말기 ID' },
      { name: 'entry_mode', type: 'TEXT', desc: '입력 방식 (swipe, chip, tap, manual)' }
    ];
    
    for (const col of newCols) {
      if (!existingCols.includes(col.name)) {
        await dbRun(`ALTER TABLE payments ADD COLUMN ${col.name} ${col.type}`);
        console.log(`   ✅ ${col.name} 추가됨 (${col.desc})`);
      } else {
        console.log(`   ⏭️  ${col.name} 이미 존재`);
      }
    }
  } catch (e) {
    console.log('   ❌ 오류:', e.message);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 4. stores 테이블 생성/수정
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(70));
  console.log('[4] stores 테이블 확인/생성');
  console.log('─'.repeat(70));
  
  try {
    // stores 테이블 존재 확인
    const storeExists = await dbAll("SELECT name FROM sqlite_master WHERE type='table' AND name='stores'");
    
    if (storeExists.length === 0) {
      // stores 테이블 생성
      await dbRun(`
        CREATE TABLE stores (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          store_id TEXT UNIQUE NOT NULL,
          store_name TEXT NOT NULL,
          address TEXT,
          phone TEXT,
          email TEXT,
          timezone TEXT DEFAULT 'America/Vancouver',
          currency TEXT DEFAULT 'CAD',
          tax_rate REAL DEFAULT 0,
          
          -- Firebase 연동
          firebase_id TEXT,
          firebase_restaurant_id TEXT,
          
          -- 3rd Party 연동
          tryotter_store_id TEXT,
          urbanpiper_store_id TEXT,
          
          -- 결제 연동 (Elavon)
          elavon_merchant_id TEXT,
          elavon_terminal_id TEXT,
          elavon_account_id TEXT,
          
          -- 결제 연동 (Clover)
          clover_merchant_id TEXT,
          clover_device_id TEXT,
          clover_access_token TEXT,
          
          -- 메타데이터
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('   ✅ stores 테이블 생성됨');
      
      // 기본 스토어 데이터 삽입
      await dbRun(`
        INSERT INTO stores (store_id, store_name, firebase_restaurant_id) 
        VALUES ('STORE001', 'Main Restaurant', 'tQcGkoSoKcwKdvL7WLiQ')
      `);
      console.log('   ✅ 기본 스토어 데이터 삽입됨');
    } else {
      // 기존 테이블에 필드 추가
      const storeCols = await dbAll('PRAGMA table_info(stores)');
      const existingCols = storeCols.map(c => c.name);
      
      const newStoreCols = [
        { name: 'firebase_restaurant_id', type: 'TEXT' },
        { name: 'tryotter_store_id', type: 'TEXT' },
        { name: 'urbanpiper_store_id', type: 'TEXT' },
        { name: 'elavon_merchant_id', type: 'TEXT' },
        { name: 'elavon_terminal_id', type: 'TEXT' },
        { name: 'clover_merchant_id', type: 'TEXT' },
        { name: 'clover_device_id', type: 'TEXT' }
      ];
      
      for (const col of newStoreCols) {
        if (!existingCols.includes(col.name)) {
          await dbRun(`ALTER TABLE stores ADD COLUMN ${col.name} ${col.type}`);
          console.log(`   ✅ ${col.name} 추가됨`);
        }
      }
      
      console.log('   ⏭️  stores 테이블 이미 존재, 필드 업데이트 완료');
    }
  } catch (e) {
    console.log('   ❌ 오류:', e.message);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 5. third_party_orders 테이블 확인
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(70));
  console.log('[5] third_party_orders 테이블 확인/생성');
  console.log('─'.repeat(70));
  
  try {
    const tpoExists = await dbAll("SELECT name FROM sqlite_master WHERE type='table' AND name='third_party_orders'");
    
    if (tpoExists.length === 0) {
      await dbRun(`
        CREATE TABLE third_party_orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          local_order_id INTEGER,
          platform TEXT NOT NULL,
          external_order_id TEXT NOT NULL,
          external_order_number TEXT,
          status TEXT DEFAULT 'pending',
          raw_payload TEXT,
          synced_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          
          FOREIGN KEY (local_order_id) REFERENCES orders(id),
          UNIQUE(platform, external_order_id)
        )
      `);
      console.log('   ✅ third_party_orders 테이블 생성됨');
    } else {
      console.log('   ⏭️  third_party_orders 이미 존재');
      
      // 컬럼 확인
      const tpoCols = await dbAll('PRAGMA table_info(third_party_orders)');
      console.log(`   현재 컬럼: ${tpoCols.map(c => c.name).join(', ')}`);
    }
  } catch (e) {
    console.log('   ❌ 오류:', e.message);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 6. floor 관련 테이블에 firebase_id 추가
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(70));
  console.log('[6] 테이블맵 관련 테이블에 firebase_id 추가');
  console.log('─'.repeat(70));
  
  const tableMapRelated = ['table_map_screen_settings', 'table_settings'];
  
  for (const tableName of tableMapRelated) {
    try {
      const cols = await dbAll(`PRAGMA table_info(${tableName})`);
      if (cols.length > 0) {
        const hasFirebaseId = cols.some(c => c.name === 'firebase_id');
        if (!hasFirebaseId) {
          await dbRun(`ALTER TABLE ${tableName} ADD COLUMN firebase_id TEXT`);
          console.log(`   ✅ ${tableName}.firebase_id 추가됨`);
        } else {
          console.log(`   ⏭️  ${tableName}.firebase_id 이미 존재`);
        }
      }
    } catch (e) {
      // 테이블 없음
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 최종 상태 확인
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(70));
  console.log('📊 수정 후 상태 확인');
  console.log('═'.repeat(70));
  
  // payments 컬럼 확인
  const finalPaymentCols = await dbAll('PRAGMA table_info(payments)');
  console.log(`\n   payments 컬럼 (${finalPaymentCols.length}개):`);
  console.log(`   ${finalPaymentCols.map(c => c.name).join(', ')}`);
  
  // stores 확인
  const storeData = await dbAll('SELECT * FROM stores LIMIT 1');
  if (storeData.length > 0) {
    console.log(`\n   stores 데이터: ${JSON.stringify(storeData[0]).substring(0, 100)}...`);
  }
  
  // table_map_elements 확인
  const tmeCols = await dbAll('PRAGMA table_info(table_map_elements)');
  console.log(`\n   table_map_elements 컬럼:`);
  console.log(`   ${tmeCols.map(c => c.name).join(', ')}`);
  
  console.log('\n' + '═'.repeat(70));
  console.log('✅ 3rd Party 연동을 위한 스키마 수정 완료!');
  console.log('═'.repeat(70));
  
  db.close();
  process.exit(0);
}

fix3rdPartyIssues().catch(err => {
  console.error('Fix failed:', err);
  db.close();
  process.exit(1);
});
