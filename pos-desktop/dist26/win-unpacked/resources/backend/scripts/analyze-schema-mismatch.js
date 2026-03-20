/**
 * POS SQLite vs Firebase 스키마 비교 분석 스크립트
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../../db/web2pos.db');
const db = new sqlite3.Database(dbPath);

// Promise wrapper
const dbAll = (sql) => new Promise((resolve, reject) => {
  db.all(sql, [], (err, rows) => err ? reject(err) : resolve(rows));
});

async function analyzeSchemas() {
  console.log('=' .repeat(80));
  console.log('📊 POS SQLite vs Firebase 스키마 비교 분석');
  console.log('=' .repeat(80));
  
  // 1. menu_items 스키마
  console.log('\n📋 1. menu_items 테이블');
  console.log('-'.repeat(40));
  const menuItemsCols = await dbAll('PRAGMA table_info(menu_items)');
  console.log('SQLite 컬럼:');
  menuItemsCols.forEach(c => console.log(`  - ${c.name} (${c.type})`));
  
  // 2. menu_categories 스키마
  console.log('\n📋 2. menu_categories 테이블');
  console.log('-'.repeat(40));
  const categoriesCols = await dbAll('PRAGMA table_info(menu_categories)');
  console.log('SQLite 컬럼:');
  categoriesCols.forEach(c => console.log(`  - ${c.name} (${c.type})`));
  
  // 3. modifier_groups 스키마
  console.log('\n📋 3. modifier_groups 테이블');
  console.log('-'.repeat(40));
  const modGroupsCols = await dbAll('PRAGMA table_info(modifier_groups)');
  console.log('SQLite 컬럼:');
  modGroupsCols.forEach(c => console.log(`  - ${c.name} (${c.type})`));
  
  // 4. modifiers 스키마
  console.log('\n📋 4. modifiers 테이블');
  console.log('-'.repeat(40));
  const modifiersCols = await dbAll('PRAGMA table_info(modifiers)');
  console.log('SQLite 컬럼:');
  modifiersCols.forEach(c => console.log(`  - ${c.name} (${c.type})`));
  
  // 5. tax_groups 스키마
  console.log('\n📋 5. tax_groups 테이블');
  console.log('-'.repeat(40));
  const taxGroupsCols = await dbAll('PRAGMA table_info(tax_groups)');
  console.log('SQLite 컬럼:');
  taxGroupsCols.forEach(c => console.log(`  - ${c.name} (${c.type})`));
  
  // 6. printer_groups 스키마
  console.log('\n📋 6. printer_groups 테이블');
  console.log('-'.repeat(40));
  const printerGroupsCols = await dbAll('PRAGMA table_info(printer_groups)');
  console.log('SQLite 컬럼:');
  printerGroupsCols.forEach(c => console.log(`  - ${c.name} (${c.type})`));
  
  // 7. 샘플 데이터 확인
  console.log('\n📋 7. 샘플 데이터');
  console.log('-'.repeat(40));
  
  const sampleItem = await dbAll('SELECT * FROM menu_items LIMIT 1');
  if (sampleItem.length > 0) {
    console.log('menu_items 샘플:');
    console.log(JSON.stringify(sampleItem[0], null, 2));
  }
  
  const sampleModGroup = await dbAll('SELECT * FROM modifier_groups LIMIT 1');
  if (sampleModGroup.length > 0) {
    console.log('\nmodifier_groups 샘플:');
    console.log(JSON.stringify(sampleModGroup[0], null, 2));
  }
  
  const sampleModifier = await dbAll('SELECT * FROM modifiers LIMIT 1');
  if (sampleModifier.length > 0) {
    console.log('\nmodifiers 샘플:');
    console.log(JSON.stringify(sampleModifier[0], null, 2));
  }
  
  db.close();
}

analyzeSchemas().catch(console.error);
