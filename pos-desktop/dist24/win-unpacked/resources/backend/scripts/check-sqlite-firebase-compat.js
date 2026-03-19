// backend/scripts/check-sqlite-firebase-compat.js
// SQLite - Firebase 호환성 점검 스크립트

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

async function checkData() {
  console.log('='.repeat(60));
  console.log('SQLite <-> Firebase Compatibility Check');
  console.log('='.repeat(60));
  
  const issues = [];
  
  // 0. List all tables
  console.log('\n[0] Database Tables...');
  const tables = await dbAll("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  console.log('   Tables:', tables.map(t => t.name).join(', '));
  
  // 1. Menu Items Check
  console.log('\n[1] Menu Items Check...');
  
  // Check column existence first
  const itemColumns = await dbAll('PRAGMA table_info(menu_items)');
  const hasPrice2 = itemColumns.some(c => c.name === 'price2');
  const hasFirebaseId = itemColumns.some(c => c.name === 'firebase_id');
  
  console.log('   Column check:');
  console.log('     - price2:', hasPrice2 ? 'OK' : 'MISSING');
  console.log('     - firebase_id:', hasFirebaseId ? 'OK' : 'MISSING');
  
  if (!hasPrice2) issues.push('menu_items: price2 column missing');
  if (!hasFirebaseId) issues.push('menu_items: firebase_id column missing');
  
  // Dynamic query based on available columns
  let itemQuery = 'SELECT item_id, name, price, category_id';
  if (hasPrice2) itemQuery += ', price2';
  if (hasFirebaseId) itemQuery += ', firebase_id';
  itemQuery += ' FROM menu_items';
  
  const allItems = await dbAll(itemQuery);
  let nullPriceCount = 0;
  let nullNameCount = 0;
  let noCategoryCount = 0;
  let negativePriceCount = 0;
  
  for (const item of allItems) {
    if (item.price === null || item.price === undefined) nullPriceCount++;
    if (item.price < 0 || item.price2 < 0) negativePriceCount++;
    if (!item.name || item.name.trim() === '') nullNameCount++;
    if (!item.category_id) noCategoryCount++;
  }
  
  console.log('   Total items:', allItems.length);
  console.log('   - NULL price:', nullPriceCount);
  console.log('   - Empty name:', nullNameCount);
  console.log('   - No category:', noCategoryCount);
  console.log('   - Negative price:', negativePriceCount);
  
  if (nullPriceCount > 0) issues.push(`Menu Items: ${nullPriceCount} items have NULL price`);
  if (nullNameCount > 0) issues.push(`Menu Items: ${nullNameCount} items have empty name`);
  if (noCategoryCount > 0) issues.push(`Menu Items: ${noCategoryCount} items have no category`);
  if (negativePriceCount > 0) issues.push(`Menu Items: ${negativePriceCount} items have negative price`);
  
  // 2. Categories Check
  console.log('\n[2] Categories Check...');
  
  // Check column existence first
  const catColumns = await dbAll('PRAGMA table_info(menu_categories)');
  const catHasFirebaseId = catColumns.some(c => c.name === 'firebase_id');
  
  let catQuery = 'SELECT category_id, name, menu_id';
  if (catHasFirebaseId) catQuery += ', firebase_id';
  catQuery += ' FROM menu_categories';
  
  const cats = await dbAll(catQuery);
  let catNoName = 0;
  let catNoMenu = 0;
  
  for (const cat of cats) {
    if (!cat.name || cat.name.trim() === '') catNoName++;
    if (!cat.menu_id) catNoMenu++;
  }
  
  console.log('   Total categories:', cats.length);
  console.log('   - Empty name:', catNoName);
  console.log('   - No menu link:', catNoMenu);
  
  if (catNoName > 0) issues.push(`Categories: ${catNoName} have empty name`);
  if (catNoMenu > 0) issues.push(`Categories: ${catNoMenu} have no menu link`);
  
  // 3. Orphan Records Check
  console.log('\n[3] Orphan Records Check...');
  const orphanItems = await dbAll(`
    SELECT mi.item_id, mi.name 
    FROM menu_items mi 
    LEFT JOIN menu_categories mc ON mi.category_id = mc.category_id 
    WHERE mc.category_id IS NULL
  `);
  
  if (orphanItems.length > 0) {
    issues.push(`Orphan Items: ${orphanItems.length} items reference non-existent category`);
    console.log('   WARNING: Orphan items:', orphanItems.length);
    orphanItems.slice(0, 5).forEach(i => console.log('      -', i.item_id, i.name));
  } else {
    console.log('   OK: No orphan items');
  }
  
  // 4. Firebase ID Missing Check
  console.log('\n[4] Firebase ID Check...');
  
  if (hasFirebaseId) {
    const noFirebaseItems = await dbAll('SELECT COUNT(*) as cnt FROM menu_items WHERE firebase_id IS NULL OR firebase_id = ""');
    console.log('   - Items without firebase_id:', noFirebaseItems[0].cnt);
  } else {
    console.log('   - Items: firebase_id column missing');
  }
  
  if (catHasFirebaseId) {
    const noFirebaseCats = await dbAll('SELECT COUNT(*) as cnt FROM menu_categories WHERE firebase_id IS NULL OR firebase_id = ""');
    console.log('   - Categories without firebase_id:', noFirebaseCats[0].cnt);
  } else {
    console.log('   - Categories: firebase_id column missing');
  }
  
  // 5. Duplicate Firebase ID Check
  console.log('\n[5] Duplicate Firebase ID Check...');
  
  if (hasFirebaseId) {
    const dupFirebaseIds = await dbAll(`
      SELECT firebase_id, COUNT(*) as cnt 
      FROM menu_items 
      WHERE firebase_id IS NOT NULL AND firebase_id != '' 
      GROUP BY firebase_id 
      HAVING COUNT(*) > 1
    `);
    
    if (dupFirebaseIds.length > 0) {
      issues.push(`Duplicate firebase_id: ${dupFirebaseIds.length} duplicates found`);
      console.log('   WARNING: Duplicate firebase_id:', dupFirebaseIds.length);
      dupFirebaseIds.slice(0, 3).forEach(d => console.log('      -', d.firebase_id, ':', d.cnt, 'items'));
    } else {
      console.log('   OK: No duplicate firebase_id');
    }
  } else {
    console.log('   Skipped: firebase_id column missing');
  }
  
  // 6. Field Name Mapping Check (camelCase vs snake_case)
  console.log('\n[6] Field Name Convention Check...');
  const sampleItem = allItems[0];
  if (sampleItem) {
    console.log('   SQLite fields:', Object.keys(sampleItem).join(', '));
    console.log('   Firebase expects: name, shortName, price1, price2, categoryId, etc.');
    
    // Check for potential mapping issues
    if (sampleItem.short_name !== undefined) {
      console.log('   Note: short_name -> shortName mapping needed');
    }
    if (sampleItem.category_id !== undefined) {
      console.log('   Note: category_id -> categoryId mapping needed');
    }
  }
  
  // 7. ID Mappings Sync Status
  console.log('\n[7] ID Mappings Sync Status...');
  try {
    const mappingStats = await dbAll(`
      SELECT entity_type, 
             COUNT(*) as total,
             SUM(CASE WHEN firebase_id IS NOT NULL AND firebase_id != '' THEN 1 ELSE 0 END) as synced
      FROM id_mappings 
      GROUP BY entity_type
    `);
    
    mappingStats.forEach(s => {
      const syncRate = ((s.synced / s.total) * 100).toFixed(1);
      const status = s.synced === s.total ? 'OK' : 'INCOMPLETE';
      console.log(`   - ${s.entity_type}: ${s.synced}/${s.total} (${syncRate}%) [${status}]`);
      if (s.synced < s.total) {
        issues.push(`${s.entity_type}: ${s.total - s.synced} not synced to Firebase`);
      }
    });
  } catch (e) {
    console.log('   id_mappings table not found or error:', e.message);
  }
  
  // 8. Modifier Groups Check
  console.log('\n[8] Modifier Groups Check...');
  try {
    const modGroups = await dbAll('SELECT COUNT(*) as cnt FROM modifier_groups WHERE is_deleted = 0');
    const modifiers = await dbAll('SELECT COUNT(*) as cnt FROM modifiers WHERE is_deleted = 0');
    console.log('   - Active modifier groups:', modGroups[0].cnt);
    console.log('   - Active modifiers:', modifiers[0].cnt);
    
    // Check for orphan modifiers
    const orphanMods = await dbAll(`
      SELECT m.modifier_id, m.name
      FROM modifiers m
      LEFT JOIN modifier_group_links mgl ON m.modifier_id = mgl.modifier_id
      WHERE mgl.modifier_id IS NULL AND m.is_deleted = 0
    `);
    if (orphanMods.length > 0) {
      console.log('   WARNING: Orphan modifiers:', orphanMods.length);
      issues.push(`Orphan Modifiers: ${orphanMods.length} not linked to any group`);
    }
  } catch (e) {
    console.log('   Modifier tables check error:', e.message);
  }
  
  // 9. Tax Groups Check
  console.log('\n[9] Tax Groups Check...');
  try {
    const taxGroups = await dbAll('SELECT COUNT(*) as cnt FROM tax_groups WHERE is_active = 1');
    const taxes = await dbAll('SELECT COUNT(*) as cnt FROM taxes WHERE is_deleted = 0');
    console.log('   - Active tax groups:', taxGroups[0].cnt);
    console.log('   - Active taxes:', taxes[0].cnt);
    
    // Check for invalid tax rates
    const invalidTaxes = await dbAll('SELECT id, name, rate FROM taxes WHERE rate < 0 OR rate > 100');
    if (invalidTaxes.length > 0) {
      console.log('   WARNING: Invalid tax rates:', invalidTaxes.length);
      issues.push(`Invalid Tax Rates: ${invalidTaxes.length} taxes with rate < 0 or > 100`);
    }
  } catch (e) {
    console.log('   Tax tables check error:', e.message);
  }
  
  // 10. Data Consistency Summary
  console.log('\n[10] Cross-Reference Check...');
  try {
    // Items per category
    const itemsPerCat = await dbAll(`
      SELECT mc.name, COUNT(mi.item_id) as item_count
      FROM menu_categories mc
      LEFT JOIN menu_items mi ON mc.category_id = mi.category_id
      GROUP BY mc.category_id
      ORDER BY item_count DESC
      LIMIT 5
    `);
    console.log('   Top categories by items:');
    itemsPerCat.forEach(c => console.log(`      - ${c.name}: ${c.item_count} items`));
    
    // Check empty categories
    const emptyCats = await dbAll(`
      SELECT mc.category_id, mc.name
      FROM menu_categories mc
      LEFT JOIN menu_items mi ON mc.category_id = mi.category_id
      WHERE mi.item_id IS NULL
    `);
    if (emptyCats.length > 0) {
      console.log('   Note: Empty categories:', emptyCats.length);
    }
  } catch (e) {
    console.log('   Cross-reference check error:', e.message);
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  
  if (issues.length === 0) {
    console.log('✅ No issues found! Data is ready for Firebase sync.');
  } else {
    console.log(`⚠️  Found ${issues.length} issue(s):\n`);
    issues.forEach((issue, i) => console.log(`   ${i + 1}. ${issue}`));
    console.log('\n   Recommendation: Fix these issues before syncing to Firebase.');
  }
  
  db.close();
}

checkData().catch(e => {
  console.error('Error:', e);
  db.close();
  process.exit(1);
});

