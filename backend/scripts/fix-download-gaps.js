// backend/scripts/fix-download-gaps.js
// Firebase -> POS 다운로드 문제 수정

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '..', 'db', 'web2pos.db');
const db = new sqlite3.Database(dbPath);

const dbRun = (sql) => new Promise((resolve, reject) => {
  db.run(sql, [], function(err) {
    if (err) reject(err);
    else resolve(this);
  });
});

const dbAll = (sql) => new Promise((resolve, reject) => {
  db.all(sql, [], (err, rows) => {
    if (err) reject(err);
    else resolve(rows);
  });
});

async function fixGaps() {
  console.log('='.repeat(60));
  console.log('Fixing Firebase -> POS Download Gaps');
  console.log('='.repeat(60));
  
  const fixes = [];
  
  // ==================================================
  // 1. Add is_active column to menu_items
  // ==================================================
  console.log('\n[1] Adding is_active column to menu_items...');
  try {
    const cols = await dbAll('PRAGMA table_info(menu_items)');
    if (!cols.some(c => c.name === 'is_active')) {
      await dbRun('ALTER TABLE menu_items ADD COLUMN is_active INTEGER DEFAULT 1');
      console.log('   Added is_active column');
      fixes.push('menu_items.is_active column added');
    } else {
      console.log('   Already exists');
    }
  } catch (e) {
    console.log('   Error:', e.message);
  }
  
  // ==================================================
  // 2. Create menu_modifier_links table
  // ==================================================
  console.log('\n[2] Creating menu_modifier_links table...');
  try {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS menu_modifier_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL,
        modifier_group_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(item_id, modifier_group_id)
      )
    `);
    await dbRun('CREATE INDEX IF NOT EXISTS idx_menu_mod_links_item ON menu_modifier_links(item_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_menu_mod_links_group ON menu_modifier_links(modifier_group_id)');
    console.log('   Created');
    fixes.push('menu_modifier_links table created');
  } catch (e) {
    console.log('   Error:', e.message);
  }
  
  // ==================================================
  // 3. Create menu_tax_links table
  // ==================================================
  console.log('\n[3] Creating menu_tax_links table...');
  try {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS menu_tax_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL,
        tax_group_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(item_id, tax_group_id)
      )
    `);
    await dbRun('CREATE INDEX IF NOT EXISTS idx_menu_tax_links_item ON menu_tax_links(item_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_menu_tax_links_group ON menu_tax_links(tax_group_id)');
    console.log('   Created');
    fixes.push('menu_tax_links table created');
  } catch (e) {
    console.log('   Error:', e.message);
  }
  
  // ==================================================
  // 4. Create menu_item_printer_links table
  // ==================================================
  console.log('\n[4] Creating menu_item_printer_links table...');
  try {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS menu_item_printer_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL,
        printer_group_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(item_id, printer_group_id)
      )
    `);
    await dbRun('CREATE INDEX IF NOT EXISTS idx_menu_printer_links_item ON menu_item_printer_links(item_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_menu_printer_links_group ON menu_item_printer_links(printer_group_id)');
    console.log('   Created');
    fixes.push('menu_item_printer_links table created');
  } catch (e) {
    console.log('   Error:', e.message);
  }
  
  // ==================================================
  // 5. Create category_modifier_links table
  // ==================================================
  console.log('\n[5] Creating category_modifier_links table...');
  try {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS category_modifier_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER NOT NULL,
        modifier_group_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(category_id, modifier_group_id)
      )
    `);
    await dbRun('CREATE INDEX IF NOT EXISTS idx_cat_mod_links_cat ON category_modifier_links(category_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_cat_mod_links_group ON category_modifier_links(modifier_group_id)');
    console.log('   Created');
    fixes.push('category_modifier_links table created');
  } catch (e) {
    console.log('   Error:', e.message);
  }
  
  // ==================================================
  // 6. Create category_tax_links table
  // ==================================================
  console.log('\n[6] Creating category_tax_links table...');
  try {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS category_tax_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER NOT NULL,
        tax_group_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(category_id, tax_group_id)
      )
    `);
    await dbRun('CREATE INDEX IF NOT EXISTS idx_cat_tax_links_cat ON category_tax_links(category_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_cat_tax_links_group ON category_tax_links(tax_group_id)');
    console.log('   Created');
    fixes.push('category_tax_links table created');
  } catch (e) {
    console.log('   Error:', e.message);
  }
  
  // ==================================================
  // 7. Create category_printer_links table
  // ==================================================
  console.log('\n[7] Creating category_printer_links table...');
  try {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS category_printer_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER NOT NULL,
        printer_group_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(category_id, printer_group_id)
      )
    `);
    await dbRun('CREATE INDEX IF NOT EXISTS idx_cat_printer_links_cat ON category_printer_links(category_id)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_cat_printer_links_group ON category_printer_links(printer_group_id)');
    console.log('   Created');
    fixes.push('category_printer_links table created');
  } catch (e) {
    console.log('   Error:', e.message);
  }
  
  // ==================================================
  // 8. Add description to menu_categories if missing
  // ==================================================
  console.log('\n[8] Adding description column to menu_categories...');
  try {
    const cols = await dbAll('PRAGMA table_info(menu_categories)');
    if (!cols.some(c => c.name === 'description')) {
      await dbRun('ALTER TABLE menu_categories ADD COLUMN description TEXT');
      console.log('   Added description column');
      fixes.push('menu_categories.description column added');
    } else {
      console.log('   Already exists');
    }
  } catch (e) {
    console.log('   Error:', e.message);
  }
  
  // ==================================================
  // Summary
  // ==================================================
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Applied ${fixes.length} fix(es):`);
  fixes.forEach((fix, i) => console.log(`   ${i + 1}. ${fix}`));
  
  db.close();
}

fixGaps().catch(e => {
  console.error('Error:', e);
  db.close();
  process.exit(1);
});

