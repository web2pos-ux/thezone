// backend/scripts/analyze-download-gaps.js
// Firebase -> POS 다운로드 시 누락되는 정보 분석

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '..', 'db', 'web2pos.db');
const db = new sqlite3.Database(dbPath);

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) reject(err);
    else resolve(rows);
  });
});

async function analyzeGaps() {
  console.log('='.repeat(70));
  console.log('Firebase -> POS Download Gap Analysis');
  console.log('='.repeat(70));
  
  const issues = [];
  
  // ==================================================
  // 1. Menu Items 필드 분석
  // ==================================================
  console.log('\n[1] Menu Items Field Mapping Analysis\n');
  
  const firebaseMenuItemFields = [
    'id',           // Firebase doc ID
    'menuId',       // Firebase menu ID
    'categoryId',   // Firebase category ID
    'name',
    'shortName',    // Firebase uses camelCase
    'short_name',   // Some docs use snake_case
    'description',
    'price',        // Legacy field
    'price1',       // New field
    'price2',
    'imageUrl',
    'image_url',
    'isAvailable',
    'is_active',
    'sortOrder',
    'sort_order',
    'posId',            // POS item_id (for back-reference)
    'posCategoryId',    // POS category_id (for back-reference)
    'modifierGroupIds', // Array of Firebase modifier group IDs
    'taxGroupIds',      // Array of Firebase tax group IDs  
    'printerGroupIds',  // Array of Firebase printer group IDs
    'options',          // Inline modifiers (legacy)
    'created_at',
    'updated_at'
  ];
  
  // Check POS table structure
  const posItemColumns = await dbAll('PRAGMA table_info(menu_items)');
  const posItemColNames = posItemColumns.map(c => c.name);
  
  console.log('Firebase Fields (expected):', firebaseMenuItemFields.length);
  console.log('POS Columns (actual):', posItemColNames.join(', '));
  
  // Mapping analysis
  const fieldMapping = {
    'Firebase -> POS': {
      'id': 'firebase_id (stored)',
      'name': 'name',
      'shortName/short_name': posItemColNames.includes('short_name') ? 'short_name' : 'MISSING',
      'description': 'description',
      'price/price1': 'price',
      'price2': posItemColNames.includes('price2') ? 'price2' : 'MISSING',
      'imageUrl/image_url': posItemColNames.includes('image_url') ? 'image_url' : 'MISSING',
      'categoryId': 'category_id (mapped)',
      'sortOrder/sort_order': posItemColNames.includes('sort_order') ? 'sort_order' : 'MISSING',
      'isAvailable/is_active': posItemColNames.includes('is_active') ? 'is_active' : 'MISSING (DEFAULT: 1)',
      'posId': 'item_id (not used on download)',
      'modifierGroupIds': 'menu_modifier_links table',
      'taxGroupIds': 'menu_tax_links table',
      'printerGroupIds': 'menu_item_printer_links table'
    }
  };
  
  console.log('\nField Mapping:');
  for (const [fbField, posField] of Object.entries(fieldMapping['Firebase -> POS'])) {
    const status = posField.includes('MISSING') ? '❌' : '✅';
    console.log(`  ${status} ${fbField} -> ${posField}`);
    if (posField.includes('MISSING')) {
      issues.push(`Menu Items: ${fbField} field not mapped to POS`);
    }
  }
  
  // ==================================================
  // 2. Categories 필드 분석
  // ==================================================
  console.log('\n[2] Categories Field Mapping Analysis\n');
  
  const firebaseCategoryFields = [
    'id',           // Firebase doc ID
    'menuId',       // Firebase menu ID
    'name',
    'description',
    'sortOrder',
    'sort_order',
    'imageUrl',
    'image_url',
    'is_active',
    'isActive',
    'posId',        // POS category_id (for back-reference)
    'created_at',
    'updated_at'
  ];
  
  const posCatColumns = await dbAll('PRAGMA table_info(menu_categories)');
  const posCatColNames = posCatColumns.map(c => c.name);
  
  console.log('POS Columns:', posCatColNames.join(', '));
  
  const catFieldMapping = {
    'id': 'firebase_id',
    'name': 'name',
    'sortOrder': posCatColNames.includes('sort_order') ? 'sort_order' : 'MISSING',
    'description': posCatColNames.includes('description') ? 'description' : 'NOT DOWNLOADED',
    'imageUrl': posCatColNames.includes('image_url') ? 'image_url' : 'NOT DOWNLOADED'
  };
  
  console.log('Field Mapping:');
  for (const [fbField, posField] of Object.entries(catFieldMapping)) {
    const status = posField.includes('MISSING') || posField.includes('NOT DOWNLOADED') ? '⚠️' : '✅';
    console.log(`  ${status} ${fbField} -> ${posField}`);
    if (posField.includes('NOT DOWNLOADED')) {
      issues.push(`Categories: ${fbField} exists in Firebase but NOT downloaded to POS`);
    }
  }
  
  // ==================================================
  // 3. Modifier Groups 필드 분석
  // ==================================================
  console.log('\n[3] Modifier Groups Field Mapping Analysis\n');
  
  const firebaseModifierGroupFields = [
    'id',
    'name',
    'selection_type',       // SINGLE, MULTIPLE, REQUIRED, OPTIONAL
    'min_selections',
    'max_selections',
    'modifiers',            // Array of { name, price_adjustment, price_adjustment_2 }
    'posGroupId',
    'sortOrder'
  ];
  
  const posModGroupColumns = await dbAll('PRAGMA table_info(modifier_groups)');
  const posModGroupColNames = posModGroupColumns.map(c => c.name);
  
  console.log('POS Columns:', posModGroupColNames.join(', '));
  
  // Check if modifiers table exists and has needed columns
  const posModifierColumns = await dbAll('PRAGMA table_info(modifiers)');
  const posModifierColNames = posModifierColumns.map(c => c.name);
  console.log('Modifiers Table Columns:', posModifierColNames.join(', '));
  
  // Check for price_delta2
  if (!posModifierColNames.includes('price_delta2')) {
    issues.push('Modifiers: price_delta2 column MISSING - price2 adjustment will not be saved');
    console.log('  ❌ price_delta2 column MISSING in modifiers table');
  } else {
    console.log('  ✅ price_delta2 column exists');
  }
  
  // ==================================================
  // 4. Link Tables 분석
  // ==================================================
  console.log('\n[4] Link Tables Analysis\n');
  
  const linkTables = [
    { name: 'menu_modifier_links', required: ['item_id', 'modifier_group_id'] },
    { name: 'menu_tax_links', required: ['item_id', 'tax_group_id'] },
    { name: 'menu_item_printer_links', required: ['item_id', 'printer_group_id'] },
    { name: 'modifier_group_links', required: ['modifier_group_id', 'modifier_id'] },
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
        console.log(`  ❌ ${table.name}: TABLE DOES NOT EXIST`);
        issues.push(`Link Table: ${table.name} does not exist`);
      } else if (missing.length > 0) {
        console.log(`  ⚠️ ${table.name}: Missing columns: ${missing.join(', ')}`);
        issues.push(`Link Table: ${table.name} missing columns: ${missing.join(', ')}`);
      } else {
        console.log(`  ✅ ${table.name}: OK (${colNames.join(', ')})`);
      }
    } catch (e) {
      console.log(`  ❌ ${table.name}: ERROR - ${e.message}`);
      issues.push(`Link Table: ${table.name} - ${e.message}`);
    }
  }
  
  // ==================================================
  // 5. Download Logic Gap Analysis
  // ==================================================
  console.log('\n[5] Download Logic Gap Analysis\n');
  
  const downloadGaps = [
    {
      field: 'short_name',
      status: 'NOT DOWNLOADED',
      impact: 'POS에서 짧은 이름(영수증용) 정보 손실',
      fix: 'sync-from-firebase에서 short_name 필드 추가 필요'
    },
    {
      field: 'is_open_price',
      status: 'NOT DOWNLOADED',
      impact: 'Firebase에서 설정한 Open Price 여부가 POS에 반영 안됨',
      fix: 'Firebase에 isOpenPrice 필드 추가 후 다운로드 로직 수정'
    },
    {
      field: 'category.description',
      status: 'NOT DOWNLOADED',
      impact: '카테고리 설명 정보 손실',
      fix: 'sync-from-firebase에서 category description 다운로드 추가'
    },
    {
      field: 'category.image_url',
      status: 'NOT DOWNLOADED',
      impact: '카테고리 이미지 정보 손실',
      fix: 'sync-from-firebase에서 category image_url 다운로드 추가'
    },
    {
      field: 'id_mappings',
      status: 'NOT UPDATED',
      impact: 'UUID 매핑 테이블이 다운로드 시 업데이트 안됨',
      fix: 'sync-from-firebase에서 idMapperService 연동 필요'
    },
    {
      field: 'modifier.price_adjustment_2',
      status: 'CONDITIONAL',
      impact: 'price_delta2 컬럼이 없으면 Price 2 조정값 손실',
      fix: 'modifiers 테이블에 price_delta2 컬럼 확인'
    }
  ];
  
  console.log('Known Download Gaps:');
  for (const gap of downloadGaps) {
    console.log(`  ⚠️ ${gap.field}: ${gap.status}`);
    console.log(`     Impact: ${gap.impact}`);
    console.log(`     Fix: ${gap.fix}`);
    console.log('');
    issues.push(`Download Gap: ${gap.field} - ${gap.status}`);
  }
  
  // ==================================================
  // 6. ID Consistency Check
  // ==================================================
  console.log('\n[6] ID Consistency Check\n');
  
  // Check if downloaded items have consistent IDs
  try {
    const itemsWithFirebaseId = await dbAll('SELECT COUNT(*) as cnt FROM menu_items WHERE firebase_id IS NOT NULL AND firebase_id != ""');
    const itemsWithoutFirebaseId = await dbAll('SELECT COUNT(*) as cnt FROM menu_items WHERE firebase_id IS NULL OR firebase_id = ""');
    const catsWithFirebaseId = await dbAll('SELECT COUNT(*) as cnt FROM menu_categories WHERE firebase_id IS NOT NULL AND firebase_id != ""');
    const catsWithoutFirebaseId = await dbAll('SELECT COUNT(*) as cnt FROM menu_categories WHERE firebase_id IS NULL OR firebase_id = ""');
    
    console.log('Menu Items:');
    console.log(`  - With firebase_id: ${itemsWithFirebaseId[0].cnt}`);
    console.log(`  - Without firebase_id: ${itemsWithoutFirebaseId[0].cnt}`);
    
    console.log('Categories:');
    console.log(`  - With firebase_id: ${catsWithFirebaseId[0].cnt}`);
    console.log(`  - Without firebase_id: ${catsWithoutFirebaseId[0].cnt}`);
    
    if (itemsWithoutFirebaseId[0].cnt > 0) {
      issues.push(`ID Consistency: ${itemsWithoutFirebaseId[0].cnt} items without firebase_id`);
    }
    if (catsWithoutFirebaseId[0].cnt > 0) {
      issues.push(`ID Consistency: ${catsWithoutFirebaseId[0].cnt} categories without firebase_id`);
    }
  } catch (e) {
    console.log('  Error checking IDs:', e.message);
  }
  
  // ==================================================
  // Summary
  // ==================================================
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  
  if (issues.length === 0) {
    console.log('✅ No gaps found!');
  } else {
    console.log(`⚠️  Found ${issues.length} issue(s):\n`);
    
    // Group by category
    const grouped = {};
    for (const issue of issues) {
      const category = issue.split(':')[0];
      if (!grouped[category]) grouped[category] = [];
      grouped[category].push(issue);
    }
    
    for (const [category, categoryIssues] of Object.entries(grouped)) {
      console.log(`\n${category}:`);
      categoryIssues.forEach((issue, i) => {
        console.log(`   ${i + 1}. ${issue.split(':').slice(1).join(':').trim()}`);
      });
    }
  }
  
  db.close();
}

analyzeGaps().catch(e => {
  console.error('Error:', e);
  db.close();
  process.exit(1);
});

