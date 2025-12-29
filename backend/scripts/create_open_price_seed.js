const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { 
  generateNextId,
  ID_RANGES,
  generateMenuId,
  generateCategoryId,
  generateMenuItemId
} = require('../utils/idGenerator');

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

    // Ensure required columns exist
    const menuItemCols = await dbAll("PRAGMA table_info(menu_items)");
    const hasOpenPrice = menuItemCols.some(c => c.name === 'is_open_price');
    if (!hasOpenPrice) {
      await dbRun("ALTER TABLE menu_items ADD COLUMN is_open_price INTEGER DEFAULT 0");
      console.log("Added column 'is_open_price' to 'menu_items'.");
    }

    // Resolve target menu
    let menuRow = await dbGet('SELECT menu_id, name FROM menus ORDER BY created_at DESC LIMIT 1');
    if (!menuRow) {
      const newMenuId = await generateMenuId(db);
      await dbRun('INSERT INTO menus (menu_id, name, description, is_active) VALUES (?, ?, ?, ?)', [newMenuId, 'Default Menu', '', 0]);
      menuRow = { menu_id: newMenuId, name: 'Default Menu' };
      console.log('Created default menu:', menuRow);
    }
    const menuId = menuRow.menu_id;

    await dbRun('BEGIN TRANSACTION');

    // Find or create Open Price category
    let category = await dbGet('SELECT category_id FROM menu_categories WHERE menu_id = ? AND name = ?', [menuId, 'Open Price']);
    let categoryId;
    if (!category) {
      categoryId = await generateCategoryId(db);
      const sortOrderRow = await dbGet('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM menu_categories WHERE menu_id = ?', [menuId]);
      const sortOrder = sortOrderRow?.next_order || 0;
      await dbRun('INSERT INTO menu_categories (category_id, name, menu_id, sort_order) VALUES (?, ?, ?, ?)', [categoryId, 'Open Price', menuId, sortOrder]);
      console.log(`Created category 'Open Price' (${categoryId}) in menu ${menuId}`);
    } else {
      categoryId = category.category_id;
      console.log(`Category 'Open Price' already exists (${categoryId}) in menu ${menuId}`);
    }

    // Find or create item '기타요금'
    let item = await dbGet('SELECT item_id FROM menu_items WHERE category_id = ? AND name = ?', [categoryId, '기타요금']);
    if (!item) {
      const itemId = await generateMenuItemId(db);
      await dbRun(
        'INSERT INTO menu_items (item_id, name, short_name, price, description, category_id, menu_id, is_open_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [itemId, '기타요금', null, 0, '', categoryId, menuId, 1]
      );
      console.log(`Created open price item '기타요금' (${itemId}) under category ${categoryId}`);
    } else {
      console.log(`Item '기타요금' already exists (${item.item_id}) under category ${categoryId}`);
    }

    // Find or create item 'Service Fee'
    let serviceItem = await dbGet('SELECT item_id FROM menu_items WHERE category_id = ? AND name = ?', [categoryId, 'Service Fee']);
    if (!serviceItem) {
      const itemId = await generateMenuItemId(db);
      await dbRun(
        'INSERT INTO menu_items (item_id, name, short_name, price, description, category_id, menu_id, is_open_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [itemId, 'Service Fee', 'Service', 0, '', categoryId, menuId, 1]
      );
      console.log(`Created open price item 'Service Fee' (${itemId}) under category ${categoryId}`);
    } else {
      console.log(`Item 'Service Fee' already exists (${serviceItem.item_id}) under category ${categoryId}`);
    }

    await dbRun('COMMIT');
    console.log('Open Price seed completed successfully.');
  } catch (err) {
    try { await dbRun('ROLLBACK'); } catch {}
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
})(); 