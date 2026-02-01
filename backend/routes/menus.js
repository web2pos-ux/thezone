const express = require('express');
const router = express.Router();
const { generateMenuId, generateCategoryId, generateMenuItemId, generateModifierMenuLinkId, generateNextId, ID_RANGES } = require('../utils/idGenerator');

module.exports = (db) => {

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

  // GET /api/menus - Get all menus
  router.get('/', (req, res) => {
    db.all('SELECT * FROM menus ORDER BY created_at DESC', [], (err, rows) => {
      if (err) {
        console.error(err.message);
        return res.status(500).json({ error: 'Failed to retrieve menus.' });
      }
      // Parse sales_channels JSON for each menu
      const menusWithChannels = rows.map(menu => ({
        ...menu,
        sales_channels: menu.sales_channels ? JSON.parse(menu.sales_channels) : []
      }));
      res.json(menusWithChannels);
    });
  });

  // GET /api/menus/:id - Get a single menu
  router.get('/:id', (req, res) => {
    const { id } = req.params;
    db.get('SELECT * FROM menus WHERE menu_id = ?', [id], (err, row) => {
      if (err) {
        console.error(err.message);
        return res.status(500).json({ error: 'Failed to retrieve menu.' });
      }
      if (!row) {
        return res.status(404).json({ error: 'Menu not found.' });
      }
      // Parse sales_channels JSON
      const menuWithChannels = {
        ...row,
        sales_channels: row.sales_channels ? JSON.parse(row.sales_channels) : []
      };
      res.json(menuWithChannels);
    });
  });

  // GET /api/menus/:id/structure - Get full menu structure with categories and items
  router.get('/:id/structure', async (req, res) => {
    const { id } = req.params;
    const channelRaw = (req.query && (req.query.channel || req.query.ch)) || '';
    const channel = String(channelRaw || '').toLowerCase();
    const includeOpenPrice = String((req.query && (req.query.include_open_price||'')) || '').trim() === '1';
    try {
      const categoriesPromise = new Promise((resolve, reject) => {
        db.all('SELECT * FROM menu_categories WHERE menu_id = ? AND LOWER(name) <> LOWER(?) ORDER BY sort_order', [id, 'Open Price'], (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        });
      });
      
      // Detect if is_open_price column exists
      const hasIsOpenPrice = await new Promise((resolve) => {
        db.all("PRAGMA table_info(menu_items)", [], (err, rows) => {
          if (err || !rows) return resolve(false);
          const exists = rows.some(r => String(r.name).toLowerCase() === 'is_open_price');
          resolve(exists);
        });
      });

      // Detect optional channel availability/time policy columns
      const tableInfo = await new Promise((resolve) => {
        db.all("PRAGMA table_info(menu_items)", [], (err, rows) => resolve(Array.isArray(rows) ? rows : []));
      });
      const hasTogoAvail = Array.isArray(tableInfo) && tableInfo.some(r => String(r.name).toLowerCase()==='available_togo');
      const hasTableAvail = Array.isArray(tableInfo) && tableInfo.some(r => String(r.name).toLowerCase()==='available_table');
      const hasStartTime = Array.isArray(tableInfo) && tableInfo.some(r => String(r.name).toLowerCase()==='available_start');
      const hasEndTime = Array.isArray(tableInfo) && tableInfo.some(r => String(r.name).toLowerCase()==='available_end');

      const itemsPromise = new Promise((resolve, reject) => {
        const sql = hasIsOpenPrice && !includeOpenPrice
          ? 'SELECT * FROM menu_items WHERE menu_id = ? AND COALESCE(is_open_price, 0) = 0 ORDER BY sort_order'
          : 'SELECT * FROM menu_items WHERE menu_id = ? ORDER BY sort_order';
        db.all(sql, [id], async (err, rows) => {
          if (err) return reject(err);
          let filtered = rows || [];

          // Apply channel-based availability rules
          if (channel === 'togo') {
            if (hasTogoAvail) {
              filtered = filtered.filter(r => (r.available_togo === undefined || r.available_togo === null) ? true : Number(r.available_togo) !== 0);
            }
          } else if (channel === 'table') {
            if (hasTableAvail) {
              filtered = filtered.filter(r => (r.available_table === undefined || r.available_table === null) ? true : Number(r.available_table) !== 0);
            }
            if (hasStartTime && hasEndTime) {
              try {
                const now = new Date();
                const pad = (n) => String(n).padStart(2,'0');
                const nowStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
                filtered = filtered.filter(r => {
                  const s = r.available_start || null;
                  const e = r.available_end || null;
                  if (!s || !e) return true;
                  return nowStr >= s && nowStr <= e;
                });
              } catch {}
            }
          }

          // Do not filter out Sold Out items; frontend disables and labels them
          resolve(filtered);
        });
      });

      const [categories, items] = await Promise.all([categoriesPromise, itemsPromise]);

      const itemsByCategoryId = items.reduce((acc, item) => {
        if (!acc[item.category_id]) {
          acc[item.category_id] = [];
        }
        acc[item.category_id].push(item);
        return acc;
      }, {});

      const structure = categories.map(category => ({
        ...category,
        items: itemsByCategoryId[category.category_id] || []
      }));

      res.json(structure);

    } catch (error) {
      res.status(500).json({ error: 'Failed to retrieve menu structure', details: error.message });
    }
  });

  // GET /api/menus/:id/tax-group - Get the tax group for a menu
  router.get('/:id/tax-group', async (req, res) => {
    const { id } = req.params;
    try {
      // Find the tax group linked to the menu - look in tax_groups table with menu_id
      const taxGroup = await dbGet('SELECT tax_group_id, name as group_name FROM tax_groups WHERE menu_id = ? AND is_deleted = 0 LIMIT 1', [id]);

      if (!taxGroup) {
        return res.status(200).json({ taxes: [] });
      }

      const taxGroupId = taxGroup.tax_group_id;

      // Get all taxes associated with the tax group
      const taxes = await dbAll(`
        SELECT T.tax_id, T.name, T.rate
        FROM taxes T
        JOIN tax_group_links TGL ON T.tax_id = TGL.tax_id
        WHERE TGL.tax_group_id = ? AND T.is_deleted = 0
      `, [taxGroupId]);

      res.json({
        ...taxGroup,
        taxes: taxes || []
      });

    } catch (error) {
      console.error('Failed to retrieve tax group for menu:', error);
      res.status(500).json({ error: 'Failed to retrieve tax group information.', details: error.message });
    }
  });

  // PUT /api/menus/:id/tax-group - Create or update the tax group for a menu
  router.put('/:id/tax-group', async (req, res) => {
    const menuId = req.params.id;
    const { taxes } = req.body;

    if (!Array.isArray(taxes)) {
      return res.status(400).json({ error: 'Request body must be an object with a "taxes" array.' });
    }

    // Get the current tax group linked to the menu
    const oldTaxGroup = await dbGet('SELECT tax_group_id FROM tax_groups WHERE menu_id = ? AND is_deleted = 0', [menuId]);
    const oldTaxGroupId = oldTaxGroup ? oldTaxGroup.tax_group_id : null;
    
    let newTaxGroupId = null;

    await dbRun('BEGIN TRANSACTION');

    try {
      // Step 1: Handle the case where taxes are cleared.
      if (taxes.length > 0) {
        // Step 2: Find or create each individual tax and get their IDs.
        const finalTaxIds = await Promise.all(taxes.map(async (tax) => {
          const existingTax = await dbGet(
            'SELECT tax_id FROM taxes WHERE name = ? AND rate = ? AND is_deleted = 0',
            [tax.name, tax.rate]
          );
          if (existingTax) {
            return existingTax.tax_id;
          } else {
            const newTaxId = await generateNextId(db, ID_RANGES.TAX);
            await dbRun(
              'INSERT INTO taxes (tax_id, name, rate) VALUES (?, ?, ?)',
              [newTaxId, tax.name, tax.rate]
            );
            return newTaxId;
          }
        }));
        finalTaxIds.sort((a, b) => a - b); // Sort for canonical representation.

        // Step 3: Find an existing tax group for this menu
        if (oldTaxGroupId) {
          newTaxGroupId = oldTaxGroupId;
          const groupName = taxes.map(t => t.name).join(' + ');
          await dbRun('UPDATE tax_groups SET name = ? WHERE tax_group_id = ?', [groupName, newTaxGroupId]);
          
          // Refresh links
          await dbRun('DELETE FROM tax_group_links WHERE tax_group_id = ?', [newTaxGroupId]);
          for (const taxId of finalTaxIds) {
            await dbRun('INSERT INTO tax_group_links (tax_group_id, tax_id) VALUES (?, ?)', [newTaxGroupId, taxId]);
          }
        } else {
          // Create new group
          newTaxGroupId = await generateNextId(db, ID_RANGES.TAX_GROUP);
          const groupName = taxes.map(t => t.name).join(' + ');
          await dbRun('INSERT INTO tax_groups (tax_group_id, name, menu_id) VALUES (?, ?, ?)', [newTaxGroupId, groupName, menuId]);
          
          for (const taxId of finalTaxIds) {
            await dbRun('INSERT INTO tax_group_links (tax_group_id, tax_id) VALUES (?, ?)', [newTaxGroupId, taxId]);
          }
        }
      } else if (oldTaxGroupId) {
        // If taxes are cleared, soft delete the group
        await dbRun('UPDATE tax_groups SET is_deleted = 1 WHERE tax_group_id = ?', [oldTaxGroupId]);
      }

      await dbRun('COMMIT');

      // Step 7: Respond with the final state.
      if (!newTaxGroupId || taxes.length === 0) {
        return res.status(200).json({ taxes: [] });
      }

      const finalGroup = await dbGet('SELECT tax_group_id, name as group_name FROM tax_groups WHERE tax_group_id = ?', [newTaxGroupId]);
      const finalTaxes = await dbAll(`
        SELECT T.tax_id, T.name, T.rate
        FROM taxes T JOIN tax_group_links TGL ON T.tax_id = TGL.tax_id
        WHERE TGL.tax_group_id = ? AND T.is_deleted = 0
      `, [newTaxGroupId]);
      
      res.status(200).json({ ...finalGroup, taxes: finalTaxes });

    } catch (error) {
      await dbRun('ROLLBACK');
      console.error('Failed to update tax group for menu:', error);
      res.status(500).json({ error: 'Failed to update tax group.', details: error.message });
    }
  });

  // POST /api/menus - Create a new menu
  router.post('/', async (req, res) => {
    const { name, description, sales_channels } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Menu name is required.' });
    }
    if (!sales_channels || !Array.isArray(sales_channels) || sales_channels.length === 0) {
      return res.status(400).json({ error: 'At least one sales channel is required.' });
    }

    try {
      const newId = await generateMenuId(db);
      const sql = 'INSERT INTO menus (menu_id, name, description, sales_channels) VALUES (?, ?, ?, ?)';
      const salesChannelsJson = JSON.stringify(sales_channels);
      
      db.run(sql, [newId, name, description || '', salesChannelsJson], async function (err) {
        if (err) {
          console.error(err.message);
          return res.status(500).json({ error: 'Failed to create a new menu.' });
        }

        // Seed default Open Price category and items (idempotent)
        try {
          const existing = await dbGet('SELECT category_id FROM menu_categories WHERE menu_id = ? AND name = ? LIMIT 1', [newId, 'Open Price']);
          let categoryId;
          if (!existing) {
            categoryId = await generateCategoryId(db);
            const sortRow = await dbGet('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM menu_categories WHERE menu_id = ?', [newId]);
            const sortOrder = sortRow?.next_order || 0;
            await dbRun('INSERT INTO menu_categories (category_id, name, menu_id, sort_order) VALUES (?, ?, ?, ?)', [categoryId, 'Open Price', newId, sortOrder]);
          } else {
            categoryId = existing.category_id;
          }
          // Ensure items
          const ensureItem = async (itemName, shortName) => {
            const row = await dbGet('SELECT item_id FROM menu_items WHERE category_id = ? AND name = ? LIMIT 1', [categoryId, itemName]);
            if (!row) {
              const itemId = await generateNextId(db, ID_RANGES.MENU_ITEM);
              await dbRun('INSERT INTO menu_items (item_id, name, short_name, price, description, category_id, menu_id, is_open_price, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [itemId, itemName, shortName, 0, '', categoryId, newId, 1, 0]);
            }
          };
          await ensureItem('Open Price', null);
          await ensureItem('Service Fee', 'Service');
        } catch (seedErr) {
          console.warn('Open Price seed failed (non-fatal):', seedErr.message);
        }

        res.status(201).json({
          menu_id: newId,
          name,
          description: description || '',
          is_active: 0,
          created_at: new Date().toISOString()
        });
      });
    } catch (error) {
      console.error(error.message);
      res.status(500).json({ error: error.message });
    }
  });

    // POST /api/menus/:id/copy - Copy a menu with all its content
  router.post('/:id/copy', async (req, res) => {
    const { id } = req.params;
    const { name: requestedName, sales_channels } = req.body;
    console.log('=== COPY MENU START ===');
    console.log('Copy request received for menu ID:', id);

    // Validate sales_channels
    if (!sales_channels || !Array.isArray(sales_channels) || sales_channels.length === 0) {
      return res.status(400).json({ error: 'At least one sales channel is required.' });
    }

    try {
      // Helper function to promisify db operations
      const dbRun = (sql, params) => new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
          if (err) reject(err);
          else resolve(this);
        });
      });

      const dbGet = (sql, params) => new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      const dbAll = (sql, params) => new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      // First, get the original menu
      const menu = await dbGet('SELECT * FROM menus WHERE menu_id = ?', [id]);

      if (!menu) {
        console.log('ERROR: Menu not found');
        return res.status(404).json({ error: 'Menu not found.' });
      }

      console.log('Original menu found:', menu.name);

      // Generate new menu ID
      const newMenuId = await generateMenuId(db);
      
      // Use requested name or generate copy name
      let copyName = requestedName || `${menu.name.replace(/ \(Copy( \d+)?\)$/, '')} (Copy)`;
      let menuCopyCounter = 1;

      // Ensure the new menu name is unique
      while (true) {
        const existingMenu = await dbGet(
          'SELECT 1 FROM menus WHERE name = ?',
          [copyName]
        );
        if (!existingMenu) break;
        
        menuCopyCounter++;
        copyName = requestedName 
          ? `${requestedName} (${menuCopyCounter})`
          : `${menu.name.replace(/ \(Copy( \d+)?\)$/, '')} (Copy ${menuCopyCounter})`;
      }

      console.log('Generated new menu ID:', newMenuId);

      // Begin transaction
      await dbRun('BEGIN TRANSACTION');
      console.log('Transaction started for full menu copy.');

      const salesChannelsJson = JSON.stringify(sales_channels);

      try {
        // 1. Insert the copied menu
        await dbRun(
          'INSERT INTO menus (menu_id, name, description, is_active, sales_channels) VALUES (?, ?, ?, ?, ?)',
          [newMenuId, copyName, menu.description, 0, salesChannelsJson]
        );
        console.log('✓ Menu copied: ', menu.name, '->', copyName);

        // 2. Copy categories
        console.log('=== COPYING CATEGORIES ===');
        const categories = await dbAll(
          'SELECT * FROM menu_categories WHERE menu_id = ? AND LOWER(name) <> LOWER(?) ORDER BY sort_order',
          [id, 'Open Price']
        );
        console.log(`Found ${categories.length} categories to copy`);
        const categoryIdMap = new Map(); // old category_id -> new category_id
        for (const category of categories) {
          const newCategoryId = await generateCategoryId(db);
          await dbRun(
            'INSERT INTO menu_categories (category_id, menu_id, name, sort_order, image_url) VALUES (?, ?, ?, ?, ?)',
            [newCategoryId, newMenuId, category.name, category.sort_order || 0, category.image_url || null]
          );
          categoryIdMap.set(category.category_id, newCategoryId);
          console.log(`✓ Category copied: ${category.name} (${category.category_id} -> ${newCategoryId})`);
        }

        // 3. Copy items
        console.log('=== COPYING MENU ITEMS ===');
        const items = await dbAll(
          'SELECT * FROM menu_items WHERE menu_id = ? AND COALESCE(is_open_price, 0) = 0 ORDER BY sort_order',
          [id]
        );
        console.log(`Found ${items.length} items to copy`);
        const itemIdMap = new Map(); // old item_id -> new item_id
        for (const item of items) {
          const newItemId = await generateNextId(db, ID_RANGES.MENU_ITEM);
          const newCategoryId = categoryIdMap.get(item.category_id);
          if (!newCategoryId) {
            console.log(`⚠️ Warning: Category ${item.category_id} not found in map, skipping item ${item.name}`);
            continue;
          }
          await dbRun(
            'INSERT INTO menu_items (item_id, menu_id, name, short_name, description, price, category_id, sort_order, image_url, is_open_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
              newItemId,
              newMenuId,
              item.name,
              item.short_name || null,
              item.description || '',
              item.price || 0,
              newCategoryId,
              item.sort_order || 0,
              item.image_url || null,
              0
            ]
          );
          itemIdMap.set(item.item_id, newItemId);
          console.log(`✓ Item copied: ${item.name} (${item.item_id} -> ${newItemId})`);
        }

        // 4. Copy category and item links
        console.log('=== COPYING LINKS (category/item modifier/tax/printer) ===');
        // Category -> modifier groups
        const catModLinks = await dbAll(
          `SELECT cml.category_id, cml.modifier_group_id
           FROM category_modifier_links cml
           JOIN menu_categories mc ON mc.category_id = cml.category_id
           WHERE mc.menu_id = ?`,
          [id]
        );
        for (const link of catModLinks) {
          const newCatId = categoryIdMap.get(link.category_id);
          if (newCatId) {
            await dbRun(
              'INSERT INTO category_modifier_links (category_id, modifier_group_id) VALUES (?, ?)',
              [newCatId, link.modifier_group_id]
            );
          }
        }
        // Category -> tax groups
        const catTaxLinks = await dbAll(
          `SELECT ctl.category_id, ctl.tax_group_id
           FROM category_tax_links ctl
           JOIN menu_categories mc ON mc.category_id = ctl.category_id
           WHERE mc.menu_id = ?`,
          [id]
        );
        for (const link of catTaxLinks) {
          const newCatId = categoryIdMap.get(link.category_id);
          if (newCatId) {
            await dbRun(
              'INSERT INTO category_tax_links (category_id, tax_group_id) VALUES (?, ?)',
              [newCatId, link.tax_group_id]
            );
          }
        }
        // Category -> printer groups
        const catPrinterLinks = await dbAll(
          `SELECT cpl.category_id, cpl.printer_group_id
           FROM category_printer_links cpl
           JOIN menu_categories mc ON mc.category_id = cpl.category_id
           WHERE mc.menu_id = ?`,
          [id]
        );
        for (const link of catPrinterLinks) {
          const newCatId = categoryIdMap.get(link.category_id);
          if (newCatId) {
            await dbRun(
              'INSERT OR IGNORE INTO category_printer_links (category_id, printer_group_id) VALUES (?, ?)',
              [newCatId, link.printer_group_id]
            );
          }
        }
        // Item -> modifier groups
        const itemModLinks = await dbAll(
          `SELECT mml.item_id, mml.modifier_group_id
           FROM menu_modifier_links mml
           JOIN menu_items mi ON mi.item_id = mml.item_id
           WHERE mi.menu_id = ?`,
          [id]
        );
        for (const link of itemModLinks) {
          const newItemId = itemIdMap.get(link.item_id);
          if (newItemId) {
            await dbRun(
              'INSERT INTO menu_modifier_links (item_id, modifier_group_id) VALUES (?, ?)',
              [newItemId, link.modifier_group_id]
            );
          }
        }
        // Item -> tax groups
        const itemTaxLinks = await dbAll(
          `SELECT mtl.item_id, mtl.tax_group_id
           FROM menu_tax_links mtl
           JOIN menu_items mi ON mi.item_id = mtl.item_id
           WHERE mi.menu_id = ?`,
          [id]
        );
        for (const link of itemTaxLinks) {
          const newItemId = itemIdMap.get(link.item_id);
          if (newItemId) {
            await dbRun(
              'INSERT INTO menu_tax_links (item_id, tax_group_id) VALUES (?, ?)',
              [newItemId, link.tax_group_id]
            );
          }
        }
        // Item -> printer groups
        const itemPrinterLinks = await dbAll(
          `SELECT mpl.item_id, mpl.printer_group_id
           FROM menu_printer_links mpl
           JOIN menu_items mi ON mi.item_id = mpl.item_id
           WHERE mi.menu_id = ?`,
          [id]
        );
        for (const link of itemPrinterLinks) {
          const newItemId = itemIdMap.get(link.item_id);
          if (newItemId) {
            await dbRun(
              'INSERT INTO menu_printer_links (item_id, printer_group_id) VALUES (?, ?)',
              [newItemId, link.printer_group_id]
            );
          }
        }

        // 5. Copy menu-level options only (categories and items copying disabled)
        console.log('=== COPYING MENU-LEVEL OPTIONS ONLY ===');

        // 6. Copy menu-level independent options (modifier groups, tax groups, printer groups)
        console.log('=== COPYING MENU-LEVEL OPTIONS ===');
        
        // Copy menu-level modifier groups
        const menuModifierGroups = await dbAll('SELECT * FROM modifier_groups WHERE menu_id = ?', [id]);
        console.log(`Found ${menuModifierGroups.length} menu-level modifier groups to copy`);
        
        for (const originalGroup of menuModifierGroups) {
          const newGroupId = await generateNextId(db, ID_RANGES.MODIFIER_GROUP);
          
          await dbRun(
            'INSERT INTO modifier_groups (modifier_group_id, name, selection_type, min_selection, max_selection, menu_id) VALUES (?, ?, ?, ?, ?, ?)',
            [newGroupId, originalGroup.name, originalGroup.selection_type, originalGroup.min_selection, originalGroup.max_selection, newMenuId]
          );
          console.log(`✓ Menu-level modifier group copied: ${originalGroup.name} (${originalGroup.modifier_group_id} -> ${newGroupId})`);

          // Copy options from the original group using modifier_group_links
          const originalOptions = await dbAll(`
            SELECT m.modifier_id, m.name, m.price_delta, m.sort_order, m.type
            FROM modifiers m 
            JOIN modifier_group_links mgl ON m.modifier_id = mgl.modifier_id 
            WHERE mgl.modifier_group_id = ? AND m.is_deleted = 0
            ORDER BY m.sort_order
          `, [originalGroup.modifier_group_id]);
          
          for (const option of originalOptions) {
            const newOptionId = await generateNextId(db, ID_RANGES.MODIFIER);
            await dbRun(
              'INSERT INTO modifiers (modifier_id, name, price_delta, sort_order, type) VALUES (?, ?, ?, ?, ?)',
              [newOptionId, option.name, option.price_delta, option.sort_order, option.type]
            );
            
            // Link the new option to the new group
            await dbRun(
              'INSERT INTO modifier_group_links (modifier_group_id, modifier_id) VALUES (?, ?)',
              [newGroupId, newOptionId]
            );
            console.log(`✓ Menu-level modifier option copied: ${option.name} (${option.modifier_id} -> ${newOptionId})`);
          }

          // Copy labels from the original group
          const originalLabels = await dbAll('SELECT * FROM modifier_labels WHERE modifier_group_id = ?', [originalGroup.modifier_group_id]);
          for (const label of originalLabels) {
            const newLabelId = await generateNextId(db, ID_RANGES.MODIFIER_LABEL);
            await dbRun(
              'INSERT INTO modifier_labels (label_id, modifier_group_id, label_name) VALUES (?, ?, ?)',
              [newLabelId, newGroupId, label.label_name]
            );
            console.log(`✓ Menu-level modifier label copied: ${label.label_name} (${label.label_id} -> ${newLabelId})`);
          }
        }

        // Copy menu-level tax groups (all groups since item-level copying is disabled)
        const menuTaxGroups = await dbAll('SELECT * FROM tax_groups WHERE menu_id = ?', [id]);
        console.log(`Found ${menuTaxGroups.length} menu-level tax groups to copy`);
        
        for (const originalGroup of menuTaxGroups) {
          const newGroupId = await generateNextId(db, ID_RANGES.TAX_GROUP);
          
          await dbRun(
            'INSERT INTO tax_groups (tax_group_id, name, menu_id) VALUES (?, ?, ?)',
            [newGroupId, originalGroup.name, newMenuId]
          );
          console.log(`✓ Menu-level tax group copied: ${originalGroup.name} (${originalGroup.tax_group_id} -> ${newGroupId})`);

          // Copy taxes from the original group using tax_group_links
          const originalTaxes = await dbAll(`
            SELECT T.tax_id, T.name, T.rate 
            FROM taxes T 
            JOIN tax_group_links TGL ON T.tax_id = TGL.tax_id 
            WHERE TGL.tax_group_id = ? AND T.is_deleted = 0
          `, [originalGroup.tax_group_id]);
          
          for (const tax of originalTaxes) {
            // Check if tax already exists, if not create it
            let existingTax = await dbGet('SELECT tax_id FROM taxes WHERE name = ? AND rate = ? AND is_deleted = 0', [tax.name, tax.rate]);
            let taxId;
            
            if (existingTax) {
              taxId = existingTax.tax_id;
            } else {
              taxId = await generateNextId(db, ID_RANGES.TAX);
              await dbRun(
                'INSERT INTO taxes (tax_id, name, rate) VALUES (?, ?, ?)',
                [taxId, tax.name, tax.rate]
              );
            }
            
            // Link tax to the new group
            await dbRun(
              'INSERT INTO tax_group_links (tax_group_id, tax_id) VALUES (?, ?)',
              [newGroupId, taxId]
            );
            console.log(`✓ Menu-level tax linked: ${tax.name} -> ${newGroupId}`);
          }
        }

        // Copy menu-level printer groups (all groups since item-level copying is disabled)
        const menuPrinterGroups = await dbAll('SELECT * FROM printer_groups WHERE menu_id = ?', [id]);
        console.log(`Found ${menuPrinterGroups.length} menu-level printer groups to copy`);
        
        for (const originalGroup of menuPrinterGroups) {
          const newGroupId = await generateNextId(db, ID_RANGES.PRINTER_GROUP);
          
          await dbRun(
            'INSERT INTO printer_groups (printer_group_id, name, menu_id) VALUES (?, ?, ?)',
            [newGroupId, originalGroup.name, newMenuId]
          );
          console.log(`✓ Menu-level printer group copied: ${originalGroup.name} (${originalGroup.printer_group_id} -> ${newGroupId})`);

          // Copy printers from the original group using printer_group_links
          const originalPrinters = await dbAll(`
            SELECT P.printer_id, P.name, P.type, P.selected_printer
            FROM printers P 
            JOIN printer_group_links PGL ON P.printer_id = PGL.printer_id 
            WHERE PGL.printer_group_id = ? AND P.is_active = 1
          `, [originalGroup.printer_group_id]);
          
          for (const printer of originalPrinters) {
            // Check if printer already exists, if not create it
            let existingPrinter = await dbGet('SELECT printer_id FROM printers WHERE name = ? AND type = ? AND is_active = 1', [printer.name, printer.type]);
            let printerId;
            
            if (existingPrinter) {
              printerId = existingPrinter.printer_id;
            } else {
              printerId = await generateNextId(db, ID_RANGES.PRINTER);
              await dbRun(
                'INSERT INTO printers (printer_id, name, type, selected_printer) VALUES (?, ?, ?, ?)',
                [printerId, printer.name, printer.type, printer.selected_printer]
              );
            }
            
            // Link printer to the new group
            await dbRun(
              'INSERT INTO printer_group_links (printer_group_id, printer_id) VALUES (?, ?)',
              [newGroupId, printerId]
            );
            console.log(`✓ Menu-level printer linked: ${printer.name} -> ${newGroupId}`);
          }
        }

        // Commit transaction
        await dbRun('COMMIT');
        console.log('Transaction committed successfully.');
        console.log('=== COPY MENU COMPLETE ===');

        // Ensure default Open Price in the new menu (idempotent)
        try {
          const existing = await dbGet('SELECT category_id FROM menu_categories WHERE menu_id = ? AND name = ? LIMIT 1', [newMenuId, 'Open Price']);
          let categoryId;
          if (!existing) {
            categoryId = await generateCategoryId(db);
            const sortRow = await dbGet('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM menu_categories WHERE menu_id = ?', [newMenuId]);
            const sortOrder = sortRow?.next_order || 0;
            await dbRun('INSERT INTO menu_categories (category_id, name, menu_id, sort_order) VALUES (?, ?, ?, ?)', [categoryId, 'Open Price', newMenuId, sortOrder]);
          } else {
            categoryId = existing.category_id;
          }
          const ensureItem = async (itemName, shortName) => {
            const row = await dbGet('SELECT item_id FROM menu_items WHERE category_id = ? AND name = ? LIMIT 1', [categoryId, itemName]);
            if (!row) {
              const itemId = await generateNextId(db, ID_RANGES.MENU_ITEM);
              await dbRun('INSERT INTO menu_items (item_id, name, short_name, price, description, category_id, menu_id, is_open_price, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [itemId, itemName, shortName, 0, '', categoryId, newMenuId, 1, 0]);
            }
          };
          await ensureItem('Open Price', null);
          await ensureItem('Service Fee', 'Service');
        } catch (seedErr) {
          console.warn('Open Price seed on copy failed (non-fatal):', seedErr.message);
        }

        return res.status(201).json({
          menu_id: newMenuId,
          name: copyName,
          description: menu.description,
          is_active: 0,
          created_at: new Date().toISOString()
        });

      } catch (error) {
        await dbRun('ROLLBACK');
        console.log('✗ Transaction rolled back due to error:', error.message);
        throw error;
      }

    } catch (error) {
      console.error('Copy error:', error.message);
      console.error('Stack trace:', error.stack);
      res.status(500).json({ error: error.message });
    }
  });

  // PATCH /api/menus/:id - Update a menu
  router.patch('/:id', (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Menu name is required.' });
    }

    db.run(
      'UPDATE menus SET name = ?, description = ? WHERE menu_id = ?',
      [name, description || '', id],
      function(err) {
        if (err) {
          console.error(err.message);
          return res.status(500).json({ error: 'Failed to update menu.' });
        }
        
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Menu not found.' });
        }
        
        res.status(200).json({ 
          menu_id: parseInt(id),
          name,
          description: description || '',
          message: 'Menu updated successfully.' 
        });
      }
    );
  });

  // PATCH /api/menus/items/:itemId/tax-group - Update tax group for a menu item
  router.patch('/items/:itemId/tax-group', async (req, res) => {
    const { itemId } = req.params;
    const { tax_group_id } = req.body;

    try {
      // First, remove any existing tax group links for this item
      await dbRun('DELETE FROM menu_tax_links WHERE item_id = ?', [itemId]);

      // If a new tax group is provided, create the link
      if (tax_group_id) {
        await dbRun('INSERT INTO menu_tax_links (item_id, tax_group_id) VALUES (?, ?)', [itemId, tax_group_id]);
      }

      res.status(200).json({ 
        message: 'Tax group updated successfully',
        item_id: parseInt(itemId),
        tax_group_id: tax_group_id || null
      });

    } catch (error) {
      console.error('Failed to update tax group for item:', error);
      res.status(500).json({ error: 'Failed to update tax group for item', details: error.message });
    }
  });

  // PATCH /api/menus/items/:itemId/printer-group - Update printer group for a menu item
  router.patch('/items/:itemId/printer-group', async (req, res) => {
    const { itemId } = req.params;
    const { printer_group_id } = req.body;

    try {
      // First, remove any existing printer group links for this item
      await dbRun('DELETE FROM menu_printer_links WHERE item_id = ?', [itemId]);

      // If a new printer group is provided, create the link
      if (printer_group_id) {
        await dbRun('INSERT INTO menu_printer_links (item_id, printer_group_id) VALUES (?, ?)', [itemId, printer_group_id]);
      }

      res.status(200).json({ 
        message: 'Printer group updated successfully',
        item_id: parseInt(itemId),
        printer_group_id: printer_group_id || null
      });

    } catch (error) {
      console.error('Failed to update printer group for item:', error);
      res.status(500).json({ error: 'Failed to update printer group for item', details: error.message });
    }
  });


  


  // Helper function to get all connections
  const getAllConnections = async (menuId) => {
    // Category-modifier connections
    const categoryModifiers = await dbAll(`
      SELECT cml.category_id, cml.modifier_group_id
      FROM category_modifier_links cml
      JOIN menu_categories mc ON cml.category_id = mc.category_id
      WHERE mc.menu_id = ?
    `, [menuId]);
    
    // Category-tax connections
    const categoryTaxes = await dbAll(`
      SELECT ctl.category_id, ctl.tax_group_id
      FROM category_tax_links ctl
      JOIN menu_categories mc ON ctl.category_id = mc.category_id
      WHERE mc.menu_id = ?
    `, [menuId]);
    
    // Category-printer connections
    const categoryPrinters = await dbAll(`
      SELECT cpl.category_id, cpl.printer_group_id
      FROM category_printer_links cpl
      JOIN menu_categories mc ON cpl.category_id = mc.category_id
      WHERE mc.menu_id = ?
    `, [menuId]);
    
    // Item-modifier connections
    const itemModifiers = await dbAll(`
      SELECT mml.item_id, mml.modifier_group_id
      FROM menu_modifier_links mml
      JOIN menu_items mi ON mml.item_id = mi.item_id
      WHERE mi.menu_id = ?
    `, [menuId]);
    
    // Item-tax connections
    const itemTaxes = await dbAll(`
      SELECT mtl.item_id, mtl.tax_group_id
      FROM menu_tax_links mtl
      JOIN menu_items mi ON mtl.item_id = mi.item_id
      WHERE mi.menu_id = ?
    `, [menuId]);
    
    // Item-printer connections
    const itemPrinters = await dbAll(`
      SELECT mpl.item_id, mpl.printer_group_id
      FROM menu_printer_links mpl
      JOIN menu_items mi ON mpl.item_id = mi.item_id
      WHERE mi.menu_id = ?
    `, [menuId]);
    
    return {
      category_modifiers: categoryModifiers,
      category_taxes: categoryTaxes,
      category_printers: categoryPrinters,
      item_modifiers: itemModifiers,
      item_taxes: itemTaxes,
      item_printers: itemPrinters
    };
  };

  // DELETE /api/menus/:id - Delete a menu and all its contents
  router.delete('/:id', async (req, res) => {
    const { id } = req.params;

    const dbRun = (sql, params) => new Promise((resolve, reject) => {
      db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve(this);
      });
    });

    const dbGet = (sql, params) => new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    const dbAll = (sql, params) => new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    try {
      await dbRun('BEGIN TRANSACTION');



      // 1. Get all item IDs to delete associated links
      const items = await dbAll('SELECT item_id FROM menu_items WHERE menu_id = ?', [id]);
      const itemIds = items.map(i => i.item_id);

      if (itemIds.length > 0) {
        // 2. Delete modifier menu links associated with the items
        const placeholders = itemIds.map(() => '?').join(',');
        await dbRun(`DELETE FROM menu_modifier_links WHERE item_id IN (${placeholders})`, itemIds);
      }

      // 3. Delete all items in the menu
      await dbRun('DELETE FROM menu_items WHERE menu_id = ?', [id]);

      // 4. Delete all categories in the menu
      await dbRun('DELETE FROM menu_categories WHERE menu_id = ?', [id]);

      // 5. Delete the menu itself
      const result = await dbRun('DELETE FROM menus WHERE menu_id = ?', [id]);

      await dbRun('COMMIT');

      if (result.changes === 0) {
        return res.status(404).json({ error: 'Menu not found.' });
      }
      
      res.json({ message: 'Menu and all its contents deleted successfully' });

    } catch (err) {
      await dbRun('ROLLBACK');
      console.error('Transaction failed:', err.message);
      res.status(500).json({ error: 'Failed to delete the menu due to a transaction error.', details: err.message });
    }
  });

  // POST /api/menu/categories/reorder - Reorder categories
  router.post('/categories/reorder', async (req, res) => {
    const { categoryOrder } = req.body;
    
    if (!categoryOrder || !Array.isArray(categoryOrder)) {
      return res.status(400).json({ error: 'Invalid category order data' });
    }

    try {
      await dbRun('BEGIN TRANSACTION');

      // Update sort_order for each category
      for (const { category_id, sort_order } of categoryOrder) {
        await dbRun(
          'UPDATE menu_categories SET sort_order = ? WHERE category_id = ?',
          [sort_order, category_id]
        );
      }

      await dbRun('COMMIT');
      
      console.log('Category order updated successfully:', categoryOrder);
      res.json({ message: 'Category order updated successfully', categoryOrder });
      
    } catch (error) {
      await dbRun('ROLLBACK');
      console.error('Failed to update category order:', error);
      res.status(500).json({ error: 'Failed to update category order', details: error.message });
    }
  });

  return router;
}; 
