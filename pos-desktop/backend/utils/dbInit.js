// backend/utils/dbInit.js
const sqlite3 = require('sqlite3').verbose();

/**
 * Initializes and standardizes the database schema.
 * This is the SINGLE SOURCE OF TRUTH for the database structure.
 */
async function initDatabase(db) {
  const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

  const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

  console.log('[dbInit] Starting database standardization...');

  try {
    // 1. MODIFIER TABLES
    await dbRun(`CREATE TABLE IF NOT EXISTS modifier_groups (
      modifier_group_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      selection_type TEXT NOT NULL DEFAULT 'SINGLE',
      min_selection INTEGER DEFAULT 0,
      max_selection INTEGER DEFAULT 1,
      menu_id INTEGER,
      is_deleted INTEGER DEFAULT 0
    )`);

    // Migration for modifier_groups: group_id -> modifier_group_id
    const mgCols = await dbAll("PRAGMA table_info(modifier_groups)");
    const mgColNames = mgCols.map(c => String(c.name));
    if (mgColNames.includes('group_id') && !mgColNames.includes('modifier_group_id')) {
      try {
        await dbRun("ALTER TABLE modifier_groups RENAME COLUMN group_id TO modifier_group_id");
        console.log('[dbInit] Migrated modifier_groups: group_id -> modifier_group_id');
      } catch (e) { console.error(e.message); }
    }

    await dbRun(`CREATE TABLE IF NOT EXISTS modifiers (
      modifier_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      price_delta REAL DEFAULT 0,
      price_delta2 REAL DEFAULT 0,
      type TEXT NOT NULL DEFAULT 'OPTION',
      is_deleted INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS modifier_group_links (
      modifier_group_id INTEGER NOT NULL,
      modifier_id INTEGER NOT NULL,
      PRIMARY KEY (modifier_group_id, modifier_id)
    )`);

    // 2. TAX TABLES
    await dbRun(`CREATE TABLE IF NOT EXISTS tax_groups (
      tax_group_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      menu_id INTEGER,
      is_deleted INTEGER DEFAULT 0
    )`);

    // Migration for tax_groups: group_id -> tax_group_id
    const tgCols = await dbAll("PRAGMA table_info(tax_groups)");
    const tgColNames = tgCols.map(c => String(c.name));
    if (tgColNames.includes('group_id') && !tgColNames.includes('tax_group_id')) {
      try {
        await dbRun("ALTER TABLE tax_groups RENAME COLUMN group_id TO tax_group_id");
        console.log('[dbInit] Migrated tax_groups: group_id -> tax_group_id');
      } catch (e) { console.error(e.message); }
    }

    await dbRun(`CREATE TABLE IF NOT EXISTS taxes (
      tax_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      rate REAL NOT NULL DEFAULT 0,
      menu_id INTEGER,
      is_deleted INTEGER DEFAULT 0
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS tax_group_links (
      tax_group_id INTEGER NOT NULL,
      tax_id INTEGER NOT NULL,
      PRIMARY KEY (tax_group_id, tax_id)
    )`);

    // Migration for tax_group_links: group_id -> tax_group_id
    const tglCols = await dbAll("PRAGMA table_info(tax_group_links)");
    const tglColNames = tglCols.map(c => String(c.name));
    if (tglColNames.includes('group_id') && !tglColNames.includes('tax_group_id')) {
      try {
        await dbRun("ALTER TABLE tax_group_links RENAME COLUMN group_id TO tax_group_id");
        console.log('[dbInit] Migrated tax_group_links: group_id -> tax_group_id');
      } catch (e) { console.error(e.message); }
    }

    // 3. PRINTER TABLES
    // Note: Removed AUTOINCREMENT to enforce idGenerator usage
    await dbRun(`CREATE TABLE IF NOT EXISTS printers (
      printer_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      type TEXT DEFAULT '',
      selected_printer TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Migration for printers: id -> printer_id
    const pCols = await dbAll("PRAGMA table_info(printers)");
    const pColNames = pCols.map(c => String(c.name));
    if (pColNames.includes('id') && !pColNames.includes('printer_id')) {
      try {
        await dbRun("ALTER TABLE printers RENAME COLUMN id TO printer_id");
        console.log('[dbInit] Migrated printers: id -> printer_id');
      } catch (e) { console.error(e.message); }
    }

    await dbRun(`CREATE TABLE IF NOT EXISTS printer_groups (
      printer_group_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      menu_id INTEGER,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Migration for printer_groups: id -> printer_group_id, add menu_id
    const pgCols = await dbAll("PRAGMA table_info(printer_groups)");
    const pgColNames = pgCols.map(c => String(c.name));
    if (pgColNames.includes('id') && !pgColNames.includes('printer_group_id')) {
      try {
        await dbRun("ALTER TABLE printer_groups RENAME COLUMN id TO printer_group_id");
        console.log('[dbInit] Migrated printer_groups: id -> printer_group_id');
      } catch (e) { console.error(e.message); }
    }
    if (!pgColNames.includes('menu_id')) {
      try {
        await dbRun("ALTER TABLE printer_groups ADD COLUMN menu_id INTEGER");
        console.log('[dbInit] Added menu_id to printer_groups');
      } catch (e) { console.error(e.message); }
    }

    await dbRun(`CREATE TABLE IF NOT EXISTS printer_group_links (
      printer_group_id INTEGER NOT NULL,
      printer_id INTEGER NOT NULL,
      PRIMARY KEY (printer_group_id, printer_id)
    )`);

    // Migration for printer_group_links: group_id -> printer_group_id
    const pglCols = await dbAll("PRAGMA table_info(printer_group_links)");
    const pglColNames = pglCols.map(c => String(c.name));
    if (pglColNames.includes('group_id') && !pglColNames.includes('printer_group_id')) {
      try {
        await dbRun("ALTER TABLE printer_group_links RENAME COLUMN group_id TO printer_group_id");
        console.log('[dbInit] Migrated printer_group_links: group_id -> printer_group_id');
      } catch (e) { console.error(e.message); }
    }

    // 4. CATEGORY & ITEM LINK TABLES
    await dbRun(`CREATE TABLE IF NOT EXISTS category_modifier_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      modifier_group_id INTEGER NOT NULL,
      is_ambiguous INTEGER DEFAULT 0,
      UNIQUE(category_id, modifier_group_id)
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS category_tax_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      tax_group_id INTEGER NOT NULL,
      is_ambiguous INTEGER DEFAULT 0,
      UNIQUE(category_id, tax_group_id)
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS category_printer_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      printer_group_id INTEGER NOT NULL,
      is_ambiguous INTEGER DEFAULT 0,
      UNIQUE(category_id, printer_group_id)
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS menu_modifier_links (
      link_id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      modifier_group_id INTEGER NOT NULL,
      is_ambiguous INTEGER DEFAULT 0,
      UNIQUE(item_id, modifier_group_id)
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS menu_tax_links (
      link_id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      tax_group_id INTEGER NOT NULL,
      is_ambiguous INTEGER DEFAULT 0,
      UNIQUE(item_id, tax_group_id)
    )`);

    await dbRun(`CREATE TABLE IF NOT EXISTS menu_printer_links (
      link_id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      printer_group_id INTEGER NOT NULL,
      is_ambiguous INTEGER DEFAULT 0,
      UNIQUE(item_id, printer_group_id)
    )`);

    // Migration: Add is_ambiguous column to link tables if missing
    const addAmbiguousColumn = async (tableName) => {
      const cols = await dbAll(`PRAGMA table_info(${tableName})`);
      const colNames = cols.map(c => String(c.name));
      if (!colNames.includes('is_ambiguous')) {
        try {
          await dbRun(`ALTER TABLE ${tableName} ADD COLUMN is_ambiguous INTEGER DEFAULT 0`);
          console.log(`[dbInit] Added is_ambiguous column to ${tableName}`);
        } catch (e) { console.error(e.message); }
      }
    };
    await addAmbiguousColumn('menu_modifier_links');
    await addAmbiguousColumn('menu_tax_links');
    await addAmbiguousColumn('menu_printer_links');

    // 5. MODIFIER LABELS
    await dbRun(`CREATE TABLE IF NOT EXISTS modifier_labels (
      label_id INTEGER PRIMARY KEY,
      modifier_group_id INTEGER NOT NULL,
      label_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (modifier_group_id) REFERENCES modifier_groups(modifier_group_id) ON DELETE CASCADE
    )`);

    // Migration for modifier_labels: group_id -> modifier_group_id
    const mlCols = await dbAll("PRAGMA table_info(modifier_labels)");
    const mlColNames = mlCols.map(c => String(c.name));
    if (mlColNames.includes('group_id') && !mlColNames.includes('modifier_group_id')) {
      try {
        await dbRun("ALTER TABLE modifier_labels RENAME COLUMN group_id TO modifier_group_id");
        console.log('[dbInit] Migrated modifier_labels: group_id -> modifier_group_id');
      } catch (e) { console.error(e.message); }
    }

    console.log('[dbInit] Database standardization complete.');
  } catch (err) {
    console.error('[dbInit] Database initialization failed:', err.message);
    throw err;
  }
}

module.exports = { initDatabase };
