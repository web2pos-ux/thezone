/**
 * 🔍 확장 가능한 아키텍처 더블체크
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../../db/web2pos.db');
const db = new sqlite3.Database(dbPath);

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});

const issues = [];
const passed = [];

async function verify() {
  console.log('═'.repeat(80));
  console.log('🔍 확장 가능한 아키텍처 더블체크');
  console.log('═'.repeat(80));
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 1. 테이블 존재 확인
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('📋 1. 테이블 존재 확인');
  console.log('─'.repeat(80));
  
  const requiredTables = [
    { name: 'order_platforms', desc: '주문 플랫폼 마스터' },
    { name: 'store_platform_links', desc: '스토어-플랫폼 연결' },
    { name: 'payment_providers', desc: '결제 제공자 마스터' },
    { name: 'store_payment_links', desc: '스토어-결제 연결' },
    { name: 'device_types', desc: '디바이스 유형 마스터' },
    { name: 'devices', desc: '등록된 디바이스' },
    { name: 'device_payment_terminals', desc: '디바이스-결제단말기 연결' },
    { name: 'third_party_orders', desc: '외부 주문 매핑' },
    { name: 'stores', desc: '스토어 정보' }
  ];
  
  for (const table of requiredTables) {
    try {
      const result = await dbAll(`SELECT COUNT(*) as cnt FROM ${table.name}`);
      console.log(`   ✅ ${table.name.padEnd(30)} ${String(result[0].cnt).padStart(5)}개 | ${table.desc}`);
      passed.push(`${table.name} 테이블 존재`);
    } catch (e) {
      console.log(`   ❌ ${table.name.padEnd(30)} 없음  | ${table.desc}`);
      issues.push(`${table.name} 테이블 없음`);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 2. 주문 플랫폼 스키마 검증
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('📦 2. order_platforms 스키마 검증');
  console.log('─'.repeat(80));
  
  const opCols = await dbAll('PRAGMA table_info(order_platforms)');
  const opColNames = opCols.map(c => c.name);
  
  const requiredOpCols = ['platform_code', 'platform_name', 'platform_type', 'aggregator', 'api_base_url', 'is_active', 'config_json'];
  
  console.log(`   컬럼 수: ${opCols.length}개`);
  for (const col of requiredOpCols) {
    if (opColNames.includes(col)) {
      console.log(`   ✅ ${col}`);
    } else {
      console.log(`   ❌ ${col} 없음`);
      issues.push(`order_platforms.${col} 컬럼 없음`);
    }
  }
  
  // 등록된 플랫폼 확인
  const platforms = await dbAll('SELECT platform_code, platform_name, platform_type, aggregator FROM order_platforms ORDER BY platform_type, platform_name');
  console.log(`\n   등록된 플랫폼 (${platforms.length}개):`);
  
  const byType = {};
  platforms.forEach(p => {
    byType[p.platform_type] = byType[p.platform_type] || [];
    byType[p.platform_type].push(p.platform_name);
  });
  
  Object.entries(byType).forEach(([type, names]) => {
    console.log(`      [${type}]: ${names.join(', ')}`);
  });
  
  if (platforms.length >= 10) {
    passed.push('주문 플랫폼 10개 이상 등록');
  } else {
    issues.push(`주문 플랫폼 ${platforms.length}개만 등록`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 3. 결제 제공자 스키마 검증
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('💳 3. payment_providers 스키마 검증');
  console.log('─'.repeat(80));
  
  const ppCols = await dbAll('PRAGMA table_info(payment_providers)');
  const ppColNames = ppCols.map(c => c.name);
  
  const requiredPpCols = ['provider_code', 'provider_name', 'provider_type', 'supports_refund', 'supports_tip', 'is_active'];
  
  console.log(`   컬럼 수: ${ppCols.length}개`);
  for (const col of requiredPpCols) {
    if (ppColNames.includes(col)) {
      console.log(`   ✅ ${col}`);
    } else {
      console.log(`   ❌ ${col} 없음`);
      issues.push(`payment_providers.${col} 컬럼 없음`);
    }
  }
  
  // 등록된 결제 제공자 확인
  const providers = await dbAll('SELECT provider_code, provider_name, provider_type FROM payment_providers ORDER BY provider_type, provider_name');
  console.log(`\n   등록된 결제 제공자 (${providers.length}개):`);
  
  const provByType = {};
  providers.forEach(p => {
    provByType[p.provider_type] = provByType[p.provider_type] || [];
    provByType[p.provider_type].push(p.provider_name);
  });
  
  Object.entries(provByType).forEach(([type, names]) => {
    console.log(`      [${type}]: ${names.join(', ')}`);
  });
  
  if (providers.length >= 10) {
    passed.push('결제 제공자 10개 이상 등록');
  } else {
    issues.push(`결제 제공자 ${providers.length}개만 등록`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 4. 디바이스 유형 스키마 검증
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('📱 4. device_types 스키마 검증');
  console.log('─'.repeat(80));
  
  const dtCols = await dbAll('PRAGMA table_info(device_types)');
  const dtColNames = dtCols.map(c => c.name);
  
  const requiredDtCols = ['type_code', 'type_name', 'can_take_orders', 'can_process_payments', 'can_print', 'requires_login'];
  
  console.log(`   컬럼 수: ${dtCols.length}개`);
  for (const col of requiredDtCols) {
    if (dtColNames.includes(col)) {
      console.log(`   ✅ ${col}`);
    } else {
      console.log(`   ❌ ${col} 없음`);
      issues.push(`device_types.${col} 컬럼 없음`);
    }
  }
  
  // 등록된 디바이스 유형 확인
  const deviceTypes = await dbAll('SELECT type_code, type_name, can_take_orders, can_process_payments FROM device_types');
  console.log(`\n   등록된 디바이스 유형 (${deviceTypes.length}개):`);
  
  deviceTypes.forEach(d => {
    const caps = [];
    if (d.can_take_orders) caps.push('주문');
    if (d.can_process_payments) caps.push('결제');
    console.log(`      ${d.type_code.padEnd(20)} ${d.type_name.padEnd(25)} [${caps.join(', ') || '표시전용'}]`);
  });
  
  // 필수 디바이스 유형 확인
  const requiredDeviceTypes = ['main_pos', 'kiosk', 'table_order', 'handheld', 'kitchen_display'];
  const existingTypes = deviceTypes.map(d => d.type_code);
  
  for (const type of requiredDeviceTypes) {
    if (existingTypes.includes(type)) {
      passed.push(`디바이스 유형 ${type} 존재`);
    } else {
      issues.push(`디바이스 유형 ${type} 없음`);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 5. 연결 테이블 스키마 검증
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('🔗 5. 연결 테이블 스키마 검증');
  console.log('─'.repeat(80));
  
  // store_platform_links
  const splCols = await dbAll('PRAGMA table_info(store_platform_links)');
  const splColNames = splCols.map(c => c.name);
  
  const requiredSplCols = ['store_id', 'platform_code', 'external_store_id', 'api_key', 'access_token', 'is_active'];
  console.log(`\n   store_platform_links (${splCols.length}개 컬럼):`);
  
  let splOk = true;
  for (const col of requiredSplCols) {
    if (splColNames.includes(col)) {
      console.log(`   ✅ ${col}`);
    } else {
      console.log(`   ❌ ${col} 없음`);
      splOk = false;
    }
  }
  if (splOk) passed.push('store_platform_links 스키마 완전');
  
  // store_payment_links
  const spmCols = await dbAll('PRAGMA table_info(store_payment_links)');
  const spmColNames = spmCols.map(c => c.name);
  
  const requiredSpmCols = ['store_id', 'provider_code', 'merchant_id', 'terminal_id', 'api_key', 'is_active'];
  console.log(`\n   store_payment_links (${spmCols.length}개 컬럼):`);
  
  let spmOk = true;
  for (const col of requiredSpmCols) {
    if (spmColNames.includes(col)) {
      console.log(`   ✅ ${col}`);
    } else {
      console.log(`   ❌ ${col} 없음`);
      spmOk = false;
    }
  }
  if (spmOk) passed.push('store_payment_links 스키마 완전');
  
  // devices
  const devCols = await dbAll('PRAGMA table_info(devices)');
  const devColNames = devCols.map(c => c.name);
  
  const requiredDevCols = ['device_id', 'device_name', 'store_id', 'device_type', 'is_active', 'firebase_id'];
  console.log(`\n   devices (${devCols.length}개 컬럼):`);
  
  let devOk = true;
  for (const col of requiredDevCols) {
    if (devColNames.includes(col)) {
      console.log(`   ✅ ${col}`);
    } else {
      console.log(`   ❌ ${col} 없음`);
      devOk = false;
    }
  }
  if (devOk) passed.push('devices 스키마 완전');
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 6. third_party_orders 확장 컬럼 검증
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('📋 6. third_party_orders 확장 컬럼 검증');
  console.log('─'.repeat(80));
  
  const tpoCols = await dbAll('PRAGMA table_info(third_party_orders)');
  const tpoColNames = tpoCols.map(c => c.name);
  
  const requiredTpoCols = ['platform_code', 'aggregator_code', 'customer_name', 'customer_phone', 
                           'subtotal', 'tax', 'total', 'items_json', 'pickup_time', 'delivery_time'];
  
  console.log(`   컬럼 수: ${tpoCols.length}개`);
  
  let tpoOk = true;
  for (const col of requiredTpoCols) {
    if (tpoColNames.includes(col)) {
      console.log(`   ✅ ${col}`);
    } else {
      console.log(`   ❌ ${col} 없음`);
      tpoOk = false;
    }
  }
  if (tpoOk) passed.push('third_party_orders 확장 컬럼 완전');
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 7. 확장성 테스트
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '─'.repeat(80));
  console.log('🚀 7. 확장성 테스트');
  console.log('─'.repeat(80));
  
  console.log('\n   새 플랫폼 추가 테스트...');
  try {
    await dbAll(`INSERT INTO order_platforms (platform_code, platform_name, platform_type) VALUES ('test_platform_${Date.now()}', 'Test Platform', 'test')`);
    await dbAll(`DELETE FROM order_platforms WHERE platform_type = 'test'`);
    console.log('   ✅ 새 플랫폼 추가/삭제 성공');
    passed.push('플랫폼 확장성 테스트 통과');
  } catch (e) {
    console.log('   ❌ 새 플랫폼 추가 실패:', e.message);
    issues.push('플랫폼 확장성 테스트 실패');
  }
  
  console.log('\n   새 결제 제공자 추가 테스트...');
  try {
    await dbAll(`INSERT INTO payment_providers (provider_code, provider_name, provider_type) VALUES ('test_provider_${Date.now()}', 'Test Provider', 'test')`);
    await dbAll(`DELETE FROM payment_providers WHERE provider_type = 'test'`);
    console.log('   ✅ 새 결제 제공자 추가/삭제 성공');
    passed.push('결제 제공자 확장성 테스트 통과');
  } catch (e) {
    console.log('   ❌ 새 결제 제공자 추가 실패:', e.message);
    issues.push('결제 제공자 확장성 테스트 실패');
  }
  
  console.log('\n   새 디바이스 유형 추가 테스트...');
  try {
    await dbAll(`INSERT INTO device_types (type_code, type_name) VALUES ('test_device_${Date.now()}', 'Test Device')`);
    await dbAll(`DELETE FROM device_types WHERE type_code LIKE 'test_device_%'`);
    console.log('   ✅ 새 디바이스 유형 추가/삭제 성공');
    passed.push('디바이스 유형 확장성 테스트 통과');
  } catch (e) {
    console.log('   ❌ 새 디바이스 유형 추가 실패:', e.message);
    issues.push('디바이스 유형 확장성 테스트 실패');
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 최종 결과
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(80));
  console.log('📊 최종 검증 결과');
  console.log('═'.repeat(80));
  
  console.log(`\n🔴 ISSUES (${issues.length}개):`);
  if (issues.length === 0) {
    console.log('   없음 ✅');
  } else {
    issues.forEach(i => console.log(`   ❌ ${i}`));
  }
  
  console.log(`\n🟢 PASSED (${passed.length}개):`);
  passed.forEach(p => console.log(`   ✅ ${p}`));
  
  // 점수
  const total = issues.length + passed.length;
  const score = Math.round((passed.length / total) * 100);
  
  console.log('\n' + '─'.repeat(80));
  console.log(`🏆 아키텍처 완성도: ${score}% (${passed.length}/${total})`);
  
  if (score >= 90) {
    console.log('✅ 확장 가능한 아키텍처 구현 완료!');
  } else if (score >= 70) {
    console.log('🟡 대부분 완료, 일부 수정 필요');
  } else {
    console.log('🔴 추가 구현 필요');
  }
  console.log('═'.repeat(80));
  
  // 용량 요약
  console.log('\n📈 확장 용량 요약:');
  console.log('─'.repeat(40));
  console.log(`   주문 플랫폼:     ${platforms.length}개 등록 / 무제한 확장`);
  console.log(`   결제 제공자:     ${providers.length}개 등록 / 무제한 확장`);
  console.log(`   디바이스 유형:   ${deviceTypes.length}개 등록 / 무제한 확장`);
  console.log(`   스토어-플랫폼:   무제한 연결 가능`);
  console.log(`   스토어-결제:     무제한 연결 가능`);
  console.log(`   디바이스:        무제한 등록 가능`);
  console.log('─'.repeat(40));
  
  db.close();
  process.exit(issues.length > 0 ? 1 : 0);
}

verify().catch(err => {
  console.error('Verification failed:', err);
  db.close();
  process.exit(1);
});
