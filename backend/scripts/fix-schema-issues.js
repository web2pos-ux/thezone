// backend/scripts/fix-schema-issues.js
// 스키마 문제 수정 스크립트

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

async function fixSchema() {
  console.log('='.repeat(60));
  console.log('Schema Fix Script');
  console.log('='.repeat(60));
  
  const fixes = [];
  
  // 1. Create id_mappings table if not exists
  console.log('\n[1] Checking id_mappings table...');
  try {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS id_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT UNIQUE NOT NULL,
        entity_type TEXT NOT NULL,
        local_id INTEGER NOT NULL,
        firebase_id TEXT,
        external_ids TEXT DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await dbRun('CREATE INDEX IF NOT EXISTS idx_id_mappings_uuid ON id_mappings(uuid)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_id_mappings_entity ON id_mappings(entity_type, local_id)');
    await dbRun('CREATE UNIQUE INDEX IF NOT EXISTS idx_id_mappings_entity_local ON id_mappings(entity_type, local_id)');
    console.log('   OK: id_mappings table ready');
    fixes.push('id_mappings table created/verified');
  } catch (e) {
    console.log('   Error:', e.message);
  }
  
  // 2. Create sync_logs table if not exists
  console.log('\n[2] Checking sync_logs table...');
  try {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS sync_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sync_id TEXT UNIQUE NOT NULL,
        sync_type TEXT NOT NULL,
        direction TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        started_at DATETIME NOT NULL,
        completed_at DATETIME,
        status TEXT DEFAULT 'running',
        total_items INTEGER DEFAULT 0,
        created_count INTEGER DEFAULT 0,
        updated_count INTEGER DEFAULT 0,
        deleted_count INTEGER DEFAULT 0,
        error_count INTEGER DEFAULT 0,
        errors TEXT,
        initiated_by TEXT DEFAULT 'user',
        employee_id INTEGER,
        device_id TEXT
      )
    `);
    await dbRun('CREATE INDEX IF NOT EXISTS idx_sync_logs_sync_id ON sync_logs(sync_id)');
    console.log('   OK: sync_logs table ready');
    fixes.push('sync_logs table created/verified');
  } catch (e) {
    console.log('   Error:', e.message);
  }
  
  // 3. Create sync_log_details table if not exists
  console.log('\n[3] Checking sync_log_details table...');
  try {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS sync_log_details (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sync_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT DEFAULT 'success',
        local_id INTEGER,
        firebase_id TEXT,
        old_data TEXT,
        new_data TEXT,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('   OK: sync_log_details table ready');
    fixes.push('sync_log_details table created/verified');
  } catch (e) {
    console.log('   Error:', e.message);
  }
  
  // 4. Create third_party_integrations table if not exists
  console.log('\n[4] Checking third_party_integrations table...');
  try {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS third_party_integrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform_name TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        api_key TEXT,
        api_secret TEXT,
        webhook_url TEXT,
        settings TEXT DEFAULT '{}',
        is_active INTEGER DEFAULT 0,
        sync_enabled INTEGER DEFAULT 0,
        last_sync_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('   OK: third_party_integrations table ready');
    fixes.push('third_party_integrations table created/verified');
  } catch (e) {
    console.log('   Error:', e.message);
  }
  
  // 5. Add missing columns to taxes table
  console.log('\n[5] Checking taxes table columns...');
  try {
    const taxColumns = await dbAll('PRAGMA table_info(taxes)');
    const hasIsDeleted = taxColumns.some(c => c.name === 'is_deleted');
    
    if (!hasIsDeleted) {
      await dbRun('ALTER TABLE taxes ADD COLUMN is_deleted INTEGER DEFAULT 0');
      console.log('   Added is_deleted column to taxes');
      fixes.push('taxes.is_deleted column added');
    } else {
      console.log('   OK: taxes.is_deleted exists');
    }
  } catch (e) {
    console.log('   Error:', e.message);
  }
  
  // 6. Check modifier tables
  console.log('\n[6] Checking modifier tables...');
  try {
    const tables = await dbAll("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%modifier%'");
    console.log('   Modifier-related tables:', tables.map(t => t.name).join(', ') || 'None');
    
    // Check if we need to create modifier tables
    if (tables.length === 0) {
      console.log('   Creating modifier tables...');
      
      await dbRun(`
        CREATE TABLE IF NOT EXISTS modifier_groups (
          group_id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          selection_type TEXT DEFAULT 'MULTIPLE',
          min_selection INTEGER DEFAULT 0,
          max_selection INTEGER DEFAULT 0,
          menu_id INTEGER,
          is_deleted INTEGER DEFAULT 0,
          firebase_id TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      await dbRun(`
        CREATE TABLE IF NOT EXISTS modifiers (
          modifier_id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          price_delta REAL DEFAULT 0,
          price_delta2 REAL DEFAULT 0,
          type TEXT DEFAULT 'OPTION',
          sort_order INTEGER DEFAULT 0,
          is_deleted INTEGER DEFAULT 0,
          firebase_id TEXT
        )
      `);
      
      await dbRun(`
        CREATE TABLE IF NOT EXISTS modifier_group_links (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          modifier_group_id INTEGER NOT NULL,
          modifier_id INTEGER NOT NULL,
          UNIQUE(modifier_group_id, modifier_id)
        )
      `);
      
      console.log('   Created modifier tables');
      fixes.push('modifier tables created');
    }
  } catch (e) {
    console.log('   Error:', e.message);
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Applied ${fixes.length} fix(es):`);
  fixes.forEach((fix, i) => console.log(`   ${i + 1}. ${fix}`));
  
  db.close();
}

fixSchema().catch(e => {
  console.error('Error:', e);
  db.close();
  process.exit(1);
});

