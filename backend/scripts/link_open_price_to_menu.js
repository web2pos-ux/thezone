const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { generateMenuId, generateCategoryId, generateMenuItemId } = require('../utils/idGenerator');

const TARGET_MENU_NAME = process.env.TARGET_MENU_NAME || 'Sushitown';
const TARGET_MENU_ID = process.env.TARGET_MENU_ID ? parseInt(process.env.TARGET_MENU_ID, 10) : (process.argv[2] ? parseInt(process.argv[2], 10) : null);
const ITEM1_NAME = (process.env.ITEM1_NAME || process.argv[3] || '기타요금').trim();

(async () => {
  const dbPath = path.resolve(__dirname, '..', 'db', 'web2pos.db');
  const db = new sqlite3.Database(dbPath);

  const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
  const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
  const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  try {
    console.log('Using DB:', dbPath);

    // Ensure required tables/columns
    const hasMenus = await dbGet("SELECT name FROM sqlite_master WHERE type='table' AND name='menus'");
    if (!hasMenus) throw new Error("menus table not found. Run init_menu_tables.js first.");

    const menuItemCols = await dbAll("PRAGMA table_info(menu_items)");
    const hasOpenPrice = menuItemCols.some(c => c.name === 'is_open_price');
    if (!hasOpenPrice) {
      await dbRun("ALTER TABLE menu_items ADD COLUMN is_open_price INTEGER DEFAULT 0");
      console.log("Added 'is_open_price' column to 'menu_items'.");
    }

    // Resolve target menu
    let menu = null;
    if (TARGET_MENU_ID) {
      menu = await dbGet('SELECT menu_id, name FROM menus WHERE menu_id = ? LIMIT 1', [TARGET_MENU_ID]);
    } else {
      // pick the most recent by created_at if multiple match the name
      menu = await dbGet('SELECT menu_id, name FROM menus WHERE name = ? ORDER BY created_at DESC LIMIT 1', [TARGET_MENU_NAME]);
    }

    if (!menu) {
      if (!TARGET_MENU_ID) {
        const newMenuId = await generateMenuId(db);
        await dbRun('INSERT INTO menus (menu_id, name, description, is_active) VALUES (?, ?, ?, ?)', [newMenuId, TARGET_MENU_NAME, '', 0]);
        menu = { menu_id: newMenuId, name: TARGET_MENU_NAME };
        console.log('Created menu:', menu);
      } else {
        throw new Error(`Menu not found for id=${TARGET_MENU_ID}`);
      }
    } else {
      console.log('Target menu:', menu);
    }

    await dbRun('BEGIN TRANSACTION');

    // Find or create Open Price category
    let category = await dbGet('SELECT category_id FROM menu_categories WHERE menu_id = ? AND name = ?', [menu.menu_id, 'Open Price']);
    let categoryId;
    if (!category) {
      categoryId = await generateCategoryId(db);
      const sortOrderRow = await dbGet('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM menu_categories WHERE menu_id = ?', [menu.menu_id]);
      const sortOrder = sortOrderRow?.next_order || 0;
      await dbRun('INSERT INTO menu_categories (category_id, name, menu_id, sort_order) VALUES (?, ?, ?, ?)', [categoryId, 'Open Price', menu.menu_id, sortOrder]);
      console.log(`Created category 'Open Price' (${categoryId}) in menu ${menu.menu_id}`);
    } else {
      categoryId = category.category_id;
      console.log(`Category 'Open Price' already exists (${categoryId}) in menu ${menu.menu_id}`);
    }

    // Ensure items
    const ensureItem = async (name, shortName) => {
      const existing = await dbGet('SELECT item_id FROM menu_items WHERE category_id = ? AND name = ?', [categoryId, name]);
      if (!existing) {
        const itemId = await generateMenuItemId(db);
        await dbRun(
          'INSERT INTO menu_items (item_id, name, short_name, price, description, category_id, menu_id, is_open_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [itemId, name, shortName, 0, '', categoryId, menu.menu_id, 1]
        );
        console.log(`Created item '${name}' (${itemId}) under category ${categoryId}`);
        return itemId;
      } else {
        console.log(`Item '${name}' already exists (${existing.item_id}) under category ${categoryId}`);
        return existing.item_id;
      }
    };

    const item1 = await ensureItem(ITEM1_NAME, null);
    const item2 = await ensureItem('Service Fee', 'Service');

    await dbRun('COMMIT');
    console.log('Linked Open Price to menu', menu.menu_id, '(', menu.name, ')', { categoryId, items: [item1, item2] });
  } catch (err) {
    try { await dbRun('ROLLBACK'); } catch {}
    console.error('Operation failed:', err.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
})(); 