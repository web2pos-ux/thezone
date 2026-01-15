// backend/scripts/final-verification.js
// 최종 검증 스크립트

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '..', 'db', 'web2pos.db');
const db = new sqlite3.Database(dbPath);

const dbAll = (sql) => new Promise((resolve, reject) => {
  db.all(sql, [], (err, rows) => {
    if (err) reject(err);
    else resolve(rows);
  });
});

async function finalCheck() {
  console.log('='.repeat(70));
  console.log('FINAL VERIFICATION - Firebase ↔ POS Sync System');
  console.log('='.repeat(70));
  
  const checks = [];
  let allPassed = true;
  
  // ==================================================
  // 1. Database Schema Check
  // ==================================================
  console.log('\n[1] Database Schema Verification\n');
  
  const requiredTables = [
    'menu_items',
    'menu_categories',
    'id_mappings',
    'sync_logs',
    'sync_log_details',
    'menu_modifier_links',
    'menu_tax_links',
    'menu_item_printer_links',
    'category_modifier_links',
    'category_tax_links',
    'category_printer_links',
    'modifier_groups',
    'modifiers',
    'modifier_group_links',
    'tax_groups',
    'taxes',
    'printer_groups'
  ];
  
  const existingTables = await dbAll("SELECT name FROM sqlite_master WHERE type='table'");
  const tableNames = existingTables.map(t => t.name);
  
  for (const table of requiredTables) {
    const exists = tableNames.includes(table);
    const status = exists ? '✅' : '❌';
    console.log(`  ${status} ${table}`);
    checks.push({ table, exists });
    if (!exists) allPassed = false;
  }
  
  // ==================================================
  // 2. Menu Items Columns Check
  // ==================================================
  console.log('\n[2] Menu Items Columns Check\n');
  
  const itemColumns = await dbAll('PRAGMA table_info(menu_items)');
  const itemColNames = itemColumns.map(c => c.name);
  
  const requiredItemCols = [
    'item_id', 'name', 'short_name', 'price', 'price2', 'description',
    'category_id', 'menu_id', 'is_open_price', 'image_url', 'sort_order',
    'firebase_id', 'is_active'
  ];
  
  for (const col of requiredItemCols) {
    const exists = itemColNames.includes(col);
    const status = exists ? '✅' : '❌';
    console.log(`  ${status} ${col}`);
    checks.push({ type: 'menu_items', column: col, exists });
    if (!exists) allPassed = false;
  }
  
  // ==================================================
  // 3. Categories Columns Check
  // ==================================================
  console.log('\n[3] Categories Columns Check\n');
  
  const catColumns = await dbAll('PRAGMA table_info(menu_categories)');
  const catColNames = catColumns.map(c => c.name);
  
  const requiredCatCols = [
    'category_id', 'name', 'menu_id', 'sort_order', 'description',
    'image_url', 'firebase_id'
  ];
  
  for (const col of requiredCatCols) {
    const exists = catColNames.includes(col);
    const status = exists ? '✅' : '❌';
    console.log(`  ${status} ${col}`);
    checks.push({ type: 'menu_categories', column: col, exists });
    if (!exists) allPassed = false;
  }
  
  // ==================================================
  // 4. ID Mappings Check
  // ==================================================
  console.log('\n[4] ID Mappings Check\n');
  
  try {
    const mappings = await dbAll('SELECT entity_type, COUNT(*) as cnt FROM id_mappings GROUP BY entity_type');
    console.log('  UUID Mappings:');
    mappings.forEach(m => {
      console.log(`    ✅ ${m.entity_type}: ${m.cnt} mappings`);
    });
    
    const totalMappings = await dbAll('SELECT COUNT(*) as cnt FROM id_mappings');
    console.log(`  Total: ${totalMappings[0].cnt} mappings`);
    
    if (totalMappings[0].cnt === 0) {
      console.log('  ⚠️  No UUID mappings found (will be created on first sync)');
    }
  } catch (e) {
    console.log('  ❌ Error:', e.message);
    allPassed = false;
  }
  
  // ==================================================
  // 5. Link Tables Structure Check
  // ==================================================
  console.log('\n[5] Link Tables Structure Check\n');
  
  const linkTables = [
    { name: 'menu_modifier_links', required: ['item_id', 'modifier_group_id'] },
    { name: 'menu_tax_links', required: ['item_id', 'tax_group_id'] },
    { name: 'menu_item_printer_links', required: ['item_id', 'printer_group_id'] },
    { name: 'category_modifier_links', required: ['category_id', 'modifier_group_id'] },
    { name: 'category_tax_links', required: ['category_id', 'tax_group_id'] },
    { name: 'category_printer_links', required: ['category_id', 'printer_group_id'] }
  ];
  
  for (const table of linkTables) {
    try {
      const cols = await dbAll(`PRAGMA table_info(${table.name})`);
      const colNames = cols.map(c => c.name);
      const missing = table.required.filter(r => !colNames.includes(r));
      
      if (cols.length === 0) {
        console.log(`  ❌ ${table.name}: Table does not exist`);
        allPassed = false;
      } else if (missing.length > 0) {
        console.log(`  ❌ ${table.name}: Missing columns: ${missing.join(', ')}`);
        allPassed = false;
      } else {
        console.log(`  ✅ ${table.name}: OK`);
      }
    } catch (e) {
      console.log(`  ❌ ${table.name}: ${e.message}`);
      allPassed = false;
    }
  }
  
  // ==================================================
  // 6. Service Files Check
  // ==================================================
  console.log('\n[6] Service Files Check\n');
  
  const fs = require('fs');
  const serviceFiles = [
    'services/idMapperService.js',
    'services/syncLogService.js',
    'services/firebaseService.js'
  ];
  
  for (const file of serviceFiles) {
    const filePath = path.resolve(__dirname, '..', file);
    const exists = fs.existsSync(filePath);
    const status = exists ? '✅' : '❌';
    console.log(`  ${status} ${file}`);
    if (!exists) allPassed = false;
  }
  
  // ==================================================
  // 7. Route Files Check
  // ==================================================
  console.log('\n[7] Route Files Check\n');
  
  const routeFiles = [
    'routes/menu-sync.js'
  ];
  
  for (const file of routeFiles) {
    const filePath = path.resolve(__dirname, '..', file);
    const exists = fs.existsSync(filePath);
    const status = exists ? '✅' : '❌';
    console.log(`  ${status} ${file}`);
    if (!exists) allPassed = false;
  }
  
  // ==================================================
  // 8. Download Logic Check (Code Analysis)
  // ==================================================
  console.log('\n[8] Download Logic Verification\n');
  
  const menuSyncPath = path.resolve(__dirname, '..', 'routes', 'menu-sync.js');
  const menuSyncCode = fs.readFileSync(menuSyncPath, 'utf8');
  
  const downloadChecks = [
    { field: 'short_name', pattern: /shortName|short_name/ },
    { field: 'is_active', pattern: /is_active|isAvailable/ },
    { field: 'is_open_price', pattern: /is_open_price|isOpenPrice/ },
    { field: 'category.description', pattern: /fbCat\.description/ },
    { field: 'category.image_url', pattern: /fbCat\.imageUrl|fbCat\.image_url/ },
    { field: 'idMapperService', pattern: /idMapperService\.ensureMapping/ }
  ];
  
  console.log('  Download field mappings:');
  for (const check of downloadChecks) {
    const found = check.pattern.test(menuSyncCode);
    const status = found ? '✅' : '❌';
    console.log(`    ${status} ${check.field}`);
    if (!found) allPassed = false;
  }
  
  // ==================================================
  // Summary
  // ==================================================
  console.log('\n' + '='.repeat(70));
  console.log('VERIFICATION SUMMARY');
  console.log('='.repeat(70));
  
  if (allPassed) {
    console.log('✅ ALL CHECKS PASSED!');
    console.log('\nSystem is ready for Firebase ↔ POS synchronization.');
  } else {
    console.log('⚠️  SOME CHECKS FAILED');
    console.log('\nPlease review the issues above.');
  }
  
  const failedChecks = checks.filter(c => !c.exists);
  if (failedChecks.length > 0) {
    console.log(`\nFailed checks: ${failedChecks.length}`);
    failedChecks.forEach(c => {
      if (c.table) console.log(`  - Table missing: ${c.table}`);
      if (c.column) console.log(`  - Column missing: ${c.type}.${c.column}`);
    });
  }
  
  db.close();
  return allPassed;
}

finalCheck().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});

