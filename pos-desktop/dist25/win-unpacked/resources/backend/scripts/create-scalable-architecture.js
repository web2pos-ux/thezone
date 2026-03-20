/**
 * 🏗️ 확장 가능한 3rd Party 연동 아키텍처 구축
 * 
 * 설계 목표:
 * - 30개 이상 주문 플랫폼 지원 (Ubereats, Doordash, SkipTheDishes 등)
 * - 10개 이상 결제 제공자 지원 (Elavon, Clover, Square 등)
 * - 다양한 디바이스 지원 (키오스크, 테이블오더, 서브POS, 핸드헬드 등)
 * 
 * 핵심 원칙:
 * 1. 정규화된 테이블 구조 (하드코딩 컬럼 X)
 * 2. 유연한 설정 JSON 필드
 * 3. 새로운 연동 추가 시 코드 변경 최소화
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

async function createScalableArchitecture() {
  console.log('═'.repeat(80));
  console.log('🏗️  확장 가능한 3rd Party 연동 아키텍처 구축');
  console.log('═'.repeat(80));
  console.log('\n목표: 30+ 주문 플랫폼, 10+ 결제 제공자, 다양한 디바이스 지원\n');
  
  // ═══════════════════════════════════════════════════════════════════════════════════
  // 1. 주문 플랫폼 테이블 (order_platforms)
  // ═══════════════════════════════════════════════════════════════════════════════════
  console.log('─'.repeat(80));
  console.log('[1] order_platforms - 주문 플랫폼 마스터 테이블');
  console.log('─'.repeat(80));
  
  try {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS order_platforms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform_code TEXT UNIQUE NOT NULL,
        platform_name TEXT NOT NULL,
        platform_type TEXT NOT NULL DEFAULT 'aggregator',
        aggregator TEXT,
        logo_url TEXT,
        api_base_url TEXT,
        webhook_url TEXT,
        is_active INTEGER DEFAULT 1,
        commission_rate REAL DEFAULT 0,
        notes TEXT,
        config_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('   ✅ order_platforms 테이블 생성/확인됨');
    
    // 기본 플랫폼 데이터 삽입
    const platforms = [
      // TryOtter 연동
      { code: 'tryotter', name: 'TryOtter', type: 'aggregator', aggregator: null },
      { code: 'ubereats', name: 'Uber Eats', type: 'delivery', aggregator: 'tryotter' },
      { code: 'doordash', name: 'DoorDash', type: 'delivery', aggregator: 'tryotter' },
      { code: 'skipthedishes', name: 'SkipTheDishes', type: 'delivery', aggregator: 'tryotter' },
      { code: 'grubhub', name: 'GrubHub', type: 'delivery', aggregator: 'tryotter' },
      { code: 'postmates', name: 'Postmates', type: 'delivery', aggregator: 'tryotter' },
      
      // Urban Piper 연동
      { code: 'urbanpiper', name: 'Urban Piper', type: 'aggregator', aggregator: null },
      { code: 'zomato', name: 'Zomato', type: 'delivery', aggregator: 'urbanpiper' },
      { code: 'swiggy', name: 'Swiggy', type: 'delivery', aggregator: 'urbanpiper' },
      { code: 'fantuan', name: 'Fantuan', type: 'delivery', aggregator: 'urbanpiper' },
      
      // 직접 연동 가능
      { code: 'ritual', name: 'Ritual', type: 'pickup', aggregator: null },
      { code: 'chownow', name: 'ChowNow', type: 'pickup', aggregator: null },
      { code: 'toast', name: 'Toast', type: 'delivery', aggregator: null },
      { code: 'square_online', name: 'Square Online', type: 'delivery', aggregator: null },
      
      // 자체 채널
      { code: 'tzo', name: 'TZO (자체 온라인)', type: 'online', aggregator: null },
      { code: 'website', name: 'Website Order', type: 'online', aggregator: null },
      { code: 'phone', name: 'Phone Order', type: 'phone', aggregator: null },
      { code: 'walkin', name: 'Walk-in', type: 'walkin', aggregator: null }
    ];
    
    for (const p of platforms) {
      try {
        await dbRun(`
          INSERT OR IGNORE INTO order_platforms (platform_code, platform_name, platform_type, aggregator)
          VALUES ('${p.code}', '${p.name}', '${p.type}', ${p.aggregator ? `'${p.aggregator}'` : 'NULL'})
        `);
      } catch (e) { /* 이미 존재 */ }
    }
    console.log(`   ✅ ${platforms.length}개 기본 플랫폼 등록됨`);
    
  } catch (e) {
    console.log('   ❌ 오류:', e.message);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════════
  // 2. 스토어-플랫폼 연결 테이블 (store_platform_links)
  // ═══════════════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('[2] store_platform_links - 스토어별 플랫폼 연결');
  console.log('─'.repeat(80));
  
  try {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS store_platform_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id TEXT NOT NULL,
        platform_code TEXT NOT NULL,
        external_store_id TEXT,
        external_menu_id TEXT,
        api_key TEXT,
        api_secret TEXT,
        access_token TEXT,
        refresh_token TEXT,
        webhook_secret TEXT,
        is_active INTEGER DEFAULT 1,
        is_menu_synced INTEGER DEFAULT 0,
        last_sync_at DATETIME,
        config_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        UNIQUE(store_id, platform_code)
      )
    `);
    console.log('   ✅ store_platform_links 테이블 생성/확인됨');
    
  } catch (e) {
    console.log('   ❌ 오류:', e.message);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════════
  // 3. 결제 제공자 테이블 (payment_providers)
  // ═══════════════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('[3] payment_providers - 결제 제공자 마스터 테이블');
  console.log('─'.repeat(80));
  
  try {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS payment_providers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_code TEXT UNIQUE NOT NULL,
        provider_name TEXT NOT NULL,
        provider_type TEXT NOT NULL DEFAULT 'card',
        country TEXT DEFAULT 'CA',
        logo_url TEXT,
        api_base_url TEXT,
        sandbox_url TEXT,
        supports_chip INTEGER DEFAULT 1,
        supports_tap INTEGER DEFAULT 1,
        supports_swipe INTEGER DEFAULT 1,
        supports_manual INTEGER DEFAULT 1,
        supports_refund INTEGER DEFAULT 1,
        supports_void INTEGER DEFAULT 1,
        supports_tip INTEGER DEFAULT 1,
        is_active INTEGER DEFAULT 1,
        notes TEXT,
        config_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('   ✅ payment_providers 테이블 생성/확인됨');
    
    // 기본 결제 제공자 등록
    const providers = [
      // 카드 결제
      { code: 'elavon', name: 'Elavon', type: 'card' },
      { code: 'clover', name: 'Clover', type: 'card' },
      { code: 'square', name: 'Square', type: 'card' },
      { code: 'stripe', name: 'Stripe', type: 'card' },
      { code: 'moneris', name: 'Moneris', type: 'card' },
      { code: 'global_payments', name: 'Global Payments', type: 'card' },
      { code: 'worldpay', name: 'Worldpay', type: 'card' },
      { code: 'heartland', name: 'Heartland', type: 'card' },
      { code: 'first_data', name: 'First Data', type: 'card' },
      { code: 'tsys', name: 'TSYS', type: 'card' },
      { code: 'paysafe', name: 'Paysafe', type: 'card' },
      { code: 'chase_paymentech', name: 'Chase Paymentech', type: 'card' },
      
      // 대체 결제
      { code: 'paypal', name: 'PayPal', type: 'digital_wallet' },
      { code: 'apple_pay', name: 'Apple Pay', type: 'digital_wallet' },
      { code: 'google_pay', name: 'Google Pay', type: 'digital_wallet' },
      { code: 'samsung_pay', name: 'Samsung Pay', type: 'digital_wallet' },
      
      // 기타
      { code: 'cash', name: 'Cash', type: 'cash' },
      { code: 'gift_card', name: 'Gift Card', type: 'gift_card' },
      { code: 'house_account', name: 'House Account', type: 'account' }
    ];
    
    for (const p of providers) {
      try {
        await dbRun(`
          INSERT OR IGNORE INTO payment_providers (provider_code, provider_name, provider_type)
          VALUES ('${p.code}', '${p.name}', '${p.type}')
        `);
      } catch (e) { /* 이미 존재 */ }
    }
    console.log(`   ✅ ${providers.length}개 기본 결제 제공자 등록됨`);
    
  } catch (e) {
    console.log('   ❌ 오류:', e.message);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════════
  // 4. 스토어-결제제공자 연결 테이블 (store_payment_links)
  // ═══════════════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('[4] store_payment_links - 스토어별 결제 제공자 연결');
  console.log('─'.repeat(80));
  
  try {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS store_payment_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id TEXT NOT NULL,
        provider_code TEXT NOT NULL,
        merchant_id TEXT,
        terminal_id TEXT,
        account_id TEXT,
        api_key TEXT,
        api_secret TEXT,
        access_token TEXT,
        encryption_key TEXT,
        is_sandbox INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        is_default INTEGER DEFAULT 0,
        priority INTEGER DEFAULT 0,
        config_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        UNIQUE(store_id, provider_code)
      )
    `);
    console.log('   ✅ store_payment_links 테이블 생성/확인됨');
    
  } catch (e) {
    console.log('   ❌ 오류:', e.message);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════════
  // 5. 디바이스 유형 테이블 (device_types)
  // ═══════════════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('[5] device_types - 디바이스 유형 마스터 테이블');
  console.log('─'.repeat(80));
  
  try {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS device_types (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type_code TEXT UNIQUE NOT NULL,
        type_name TEXT NOT NULL,
        description TEXT,
        icon TEXT,
        can_take_orders INTEGER DEFAULT 1,
        can_process_payments INTEGER DEFAULT 0,
        can_print INTEGER DEFAULT 0,
        can_display_kds INTEGER DEFAULT 0,
        requires_login INTEGER DEFAULT 1,
        max_concurrent_orders INTEGER DEFAULT 10,
        config_template TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('   ✅ device_types 테이블 생성/확인됨');
    
    // 기본 디바이스 유형 등록
    const deviceTypes = [
      { code: 'main_pos', name: 'Main POS', orders: 1, payments: 1, print: 1, kds: 0, login: 1, desc: '메인 POS 터미널' },
      { code: 'sub_pos', name: 'Sub POS', orders: 1, payments: 1, print: 1, kds: 0, login: 1, desc: '보조 POS 터미널' },
      { code: 'kiosk', name: 'Self-Order Kiosk', orders: 1, payments: 1, print: 1, kds: 0, login: 0, desc: '셀프 주문 키오스크' },
      { code: 'table_order', name: 'Table Order Device', orders: 1, payments: 0, print: 0, kds: 0, login: 0, desc: '테이블 오더 태블릿' },
      { code: 'handheld', name: 'Handheld POS', orders: 1, payments: 1, print: 0, kds: 0, login: 1, desc: '핸드헬드 POS (서버용)' },
      { code: 'kitchen_display', name: 'Kitchen Display', orders: 0, payments: 0, print: 0, kds: 1, login: 0, desc: '주방 디스플레이 (KDS)' },
      { code: 'customer_display', name: 'Customer Display', orders: 0, payments: 0, print: 0, kds: 0, login: 0, desc: '고객용 디스플레이' },
      { code: 'order_ready_display', name: 'Order Ready Display', orders: 0, payments: 0, print: 0, kds: 0, login: 0, desc: '주문 준비 완료 디스플레이' },
      { code: 'mobile_app', name: 'Mobile App', orders: 1, payments: 1, print: 0, kds: 0, login: 1, desc: '모바일 앱' },
      { code: 'web_admin', name: 'Web Admin', orders: 0, payments: 0, print: 0, kds: 0, login: 1, desc: '웹 관리자 패널' }
    ];
    
    for (const d of deviceTypes) {
      try {
        await dbRun(`
          INSERT OR IGNORE INTO device_types 
          (type_code, type_name, description, can_take_orders, can_process_payments, can_print, can_display_kds, requires_login)
          VALUES ('${d.code}', '${d.name}', '${d.desc}', ${d.orders}, ${d.payments}, ${d.print}, ${d.kds}, ${d.login})
        `);
      } catch (e) { /* 이미 존재 */ }
    }
    console.log(`   ✅ ${deviceTypes.length}개 기본 디바이스 유형 등록됨`);
    
  } catch (e) {
    console.log('   ❌ 오류:', e.message);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════════
  // 6. 디바이스 등록 테이블 (devices)
  // ═══════════════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('[6] devices - 등록된 디바이스 테이블');
  console.log('─'.repeat(80));
  
  try {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT UNIQUE NOT NULL,
        device_name TEXT NOT NULL,
        store_id TEXT NOT NULL,
        device_type TEXT NOT NULL,
        hardware_id TEXT,
        ip_address TEXT,
        mac_address TEXT,
        os_type TEXT,
        os_version TEXT,
        app_version TEXT,
        screen_size TEXT,
        
        -- 위치 정보
        floor_id TEXT,
        zone TEXT,
        table_range TEXT,
        
        -- 연결된 주변기기
        printer_id TEXT,
        card_reader_id TEXT,
        cash_drawer_id TEXT,
        
        -- 상태
        is_active INTEGER DEFAULT 1,
        is_online INTEGER DEFAULT 0,
        last_heartbeat DATETIME,
        last_login_at DATETIME,
        last_login_by TEXT,
        
        -- 설정
        config_json TEXT,
        permissions_json TEXT,
        
        -- Firebase 연동
        firebase_id TEXT,
        fcm_token TEXT,
        
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('   ✅ devices 테이블 생성/확인됨');
    
  } catch (e) {
    console.log('   ❌ 오류:', e.message);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════════
  // 7. 디바이스-결제단말기 연결 테이블 (device_payment_terminals)
  // ═══════════════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('[7] device_payment_terminals - 디바이스-결제단말기 연결');
  console.log('─'.repeat(80));
  
  try {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS device_payment_terminals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        provider_code TEXT NOT NULL,
        terminal_id TEXT NOT NULL,
        terminal_name TEXT,
        serial_number TEXT,
        connection_type TEXT DEFAULT 'usb',
        is_primary INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        last_transaction_at DATETIME,
        config_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        UNIQUE(device_id, terminal_id)
      )
    `);
    console.log('   ✅ device_payment_terminals 테이블 생성/확인됨');
    
  } catch (e) {
    console.log('   ❌ 오류:', e.message);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════════
  // 8. 플랫폼 주문 매핑 개선 (third_party_orders)
  // ═══════════════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('[8] third_party_orders 개선 - 컬럼 추가');
  console.log('─'.repeat(80));
  
  try {
    const tpoCols = await dbAll('PRAGMA table_info(third_party_orders)');
    const existingCols = tpoCols.map(c => c.name);
    
    const newCols = [
      { name: 'platform_code', type: 'TEXT' },
      { name: 'aggregator_code', type: 'TEXT' },
      { name: 'customer_name', type: 'TEXT' },
      { name: 'customer_phone', type: 'TEXT' },
      { name: 'delivery_address', type: 'TEXT' },
      { name: 'delivery_instructions', type: 'TEXT' },
      { name: 'pickup_time', type: 'DATETIME' },
      { name: 'delivery_time', type: 'DATETIME' },
      { name: 'platform_fee', type: 'REAL' },
      { name: 'delivery_fee', type: 'REAL' },
      { name: 'tip', type: 'REAL' },
      { name: 'subtotal', type: 'REAL' },
      { name: 'tax', type: 'REAL' },
      { name: 'total', type: 'REAL' },
      { name: 'items_json', type: 'TEXT' },
      { name: 'error_message', type: 'TEXT' },
      { name: 'retry_count', type: 'INTEGER DEFAULT 0' }
    ];
    
    let addedCount = 0;
    for (const col of newCols) {
      if (!existingCols.includes(col.name)) {
        await dbRun(`ALTER TABLE third_party_orders ADD COLUMN ${col.name} ${col.type}`);
        addedCount++;
      }
    }
    
    console.log(`   ✅ ${addedCount}개 컬럼 추가됨`);
    
  } catch (e) {
    console.log('   ❌ 오류:', e.message);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════════════
  // 최종 상태 확인
  // ═══════════════════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(80));
  console.log('📊 확장 가능한 아키텍처 구축 완료');
  console.log('═'.repeat(80));
  
  // 테이블 목록
  const tables = [
    'order_platforms',
    'store_platform_links', 
    'payment_providers',
    'store_payment_links',
    'device_types',
    'devices',
    'device_payment_terminals',
    'third_party_orders'
  ];
  
  console.log('\n   📋 생성된 테이블:');
  for (const table of tables) {
    try {
      const count = await dbAll(`SELECT COUNT(*) as cnt FROM ${table}`);
      console.log(`      ✅ ${table}: ${count[0].cnt}개 레코드`);
    } catch (e) {
      console.log(`      ❌ ${table}: 오류`);
    }
  }
  
  // 용량 계산
  console.log('\n   📈 확장 가능 용량:');
  console.log('      - 주문 플랫폼: 무제한 (현재 18개 등록)');
  console.log('      - 결제 제공자: 무제한 (현재 19개 등록)');
  console.log('      - 디바이스 유형: 무제한 (현재 10개 등록)');
  console.log('      - 디바이스: 무제한');
  console.log('      - 스토어별 플랫폼 연결: 무제한');
  console.log('      - 스토어별 결제 연결: 무제한');
  
  console.log('\n' + '═'.repeat(80));
  console.log('✅ 확장 가능한 3rd Party 연동 아키텍처 구축 완료!');
  console.log('═'.repeat(80));
  
  db.close();
  process.exit(0);
}

createScalableArchitecture().catch(err => {
  console.error('Creation failed:', err);
  db.close();
  process.exit(1);
});
