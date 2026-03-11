/*
 * =====================================================
 * MENU MANAGER - LOCKED FOR MODIFICATION
 * =====================================================
 * 
 * ⚠️  WARNING: DO NOT MODIFY THIS FILE
 * 
 * This file is part of the Menu Manager module which is
 * currently locked for modifications. Any changes to this
 * file or related Menu Manager components should be avoided
 * until the lock is explicitly removed.
 * 
 * Last modified: [Current Date]
 * Lock status: ACTIVE
 * 
 * =====================================================
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { generateMenuCategoryId, generateMenuItemId, generateModifierMenuLinkId, generateTaxMenuLinkId, generatePrinterMenuLinkId, generateCategoryModifierLinkId, generateCategoryTaxLinkId, generateCategoryPrinterLinkId, ID_RANGES, generateNextId, generateCategoryId } = require('../utils/idGenerator');

// =====================================================
// EXCEL EXPORT/IMPORT COLUMN CONFIGURATION
// =====================================================
// Customize column titles here. These are used for both Export and Import.
// Import supports both these titles and legacy titles for backward compatibility.
const EXCEL_COLUMNS = {
  // Menu Data Sheet
  MENU: {
    NO: 'No',
    CATEGORY: 'Category',
    ITEM_NAME: 'Item Name',
    SHORT_NAME: 'Short Name',
    PRICE: 'Price',
    PRICE2: 'Price2',
    DESCRIPTION: 'Description',
    MODIFIER_GROUP: 'Modifier Group',  // Will have numbers: "Modifier Group 1", "Modifier Group 2", etc.
    TAX_GROUP: 'Tax Group',
    PRINTER_GROUP: 'Printer Group'
  },
  // Modifiers Sheet
  MODIFIER: {
    NO: 'No',
    GROUP_NAME: 'Group Name',
    LABEL: 'Label',
    MIN: 'Min',
    MAX: 'Max',
    MODIFIER: 'Modifier',  // Will have numbers
    PRICE: 'Price'         // Will have numbers
  },
  // Taxes Sheet
  TAX: {
    NO: 'No',
    GROUP_NAME: 'Group Name',
    TAX: 'Tax',
    RATE: 'Rate'
  },
  // Printers Sheet
  PRINTER: {
    NO: 'No',
    GROUP_NAME: 'Group Name',
    KITCHEN_TYPE: 'Kitchen Type',
    PRINTER: 'Printer'
  }
};

// Legacy column names for backward compatibility during Import
const LEGACY_COLUMNS = {
  'Modifier Group Name': 'Group Name',
  'Tax Group Name': 'Group Name',
  'Printer Group Name': 'Group Name',
  'Category Name': 'Category',
  'Linked Modifier Group 1': 'Modifier Group 1',
  'Linked Modifier Group 2': 'Modifier Group 2',
  'Linked Modifier Group 3': 'Modifier Group 3',
  'Linked Modifier Group 4': 'Modifier Group 4',
  'Linked Modifier Group 5': 'Modifier Group 5',
  'Linked Tax Group 1': 'Tax Group 1',
  'Linked Tax Group 2': 'Tax Group 2',
  'Linked Tax Group 3': 'Tax Group 3',
  'Linked Printer Group 1': 'Printer Group 1',
  'Linked Printer Group 2': 'Printer Group 2',
  'Linked Printer Group 3': 'Printer Group 3'
};

// Helper: Get value from row with fallback to legacy column names
const getExcelValue = (row, newName, legacyName = null) => {
  if (row[newName] !== undefined && row[newName] !== null && row[newName] !== '') {
    return row[newName];
  }
  if (legacyName && row[legacyName] !== undefined && row[legacyName] !== null && row[legacyName] !== '') {
    return row[legacyName];
  }
  return '';
};

// --- Multer Setup for Image Uploads (환경 변수 UPLOADS_PATH 사용, 빌드된 앱 호환) ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = process.env.UPLOADS_PATH || path.join(__dirname, '../uploads/');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

module.exports = (db) => {
  // Helper for async db operations
  const dbRunAsync = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

  const dbAllAsync = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  // Initialize all required tables for category links (HANDLED BY dbInit.js)


  // GET /api/menu/categories?menu_id=:menu_id
  router.get('/categories', (req, res) => {
    const { menu_id } = req.query;
    if (!menu_id) {
      return res.status(400).json({ error: 'menu_id is required.' });
    }
    db.all('SELECT * FROM menu_categories WHERE menu_id = ? ORDER BY sort_order', [menu_id], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  // POST /api/menu/categories
  router.post('/categories', async (req, res) => {
    const { name, menu_id } = req.body;
    if (!name || !menu_id) {
      return res.status(400).json({ error: 'Category name and menu_id are required.' });
    }

    try {
      const row = await new Promise((resolve, reject) => {
        db.get("SELECT COUNT(*) as count FROM menu_categories WHERE menu_id = ?", [menu_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
        
      const sortOrder = row.count;
      const newId = await generateMenuCategoryId(db);

      db.run('INSERT INTO menu_categories (category_id, name, menu_id, sort_order) VALUES (?, ?, ?, ?)', [newId, name, menu_id, sortOrder], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ category_id: newId, name, menu_id, sort_order: sortOrder });
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // GET /api/menu/modifier-links - Get modifier menu links for a specific menu
  router.get('/modifier-links', (req, res) => {
    const { menu_id } = req.query;
    if (!menu_id) {
      return res.status(400).json({ error: 'menu_id is required.' });
    }
    
    const query = `
      SELECT 
        mml.link_id,
        mml.item_id,
        mml.modifier_group_id,
        mg.name as group_name,
        mg.selection_type,
        mg.min_selection,
        mg.max_selection
              FROM menu_modifier_links mml
      JOIN modifier_groups mg ON mml.modifier_group_id = mg.modifier_group_id
      JOIN menu_items bmi ON mml.item_id = bmi.item_id
      WHERE bmi.menu_id = ?
      ORDER BY mml.item_id, mml.modifier_group_id
    `;
    
    db.all(query, [menu_id], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  // GET /api/menu/items
router.get('/items', (req, res) => {
    const { categoryId } = req.query;
    if (!categoryId) {
        return res.status(400).json({error: 'categoryId is required'});
    }

    const query = `
        SELECT
            items.*,
            GROUP_CONCAT(DISTINCT mml.modifier_group_id) AS modifier_groups,
            GROUP_CONCAT(DISTINCT mit.tax_group_id) AS tax_groups,
            GROUP_CONCAT(DISTINCT mip.printer_group_id) AS printer_groups
        FROM menu_items AS items
        LEFT JOIN menu_modifier_links AS mml ON items.item_id = mml.item_id
        LEFT JOIN menu_tax_links AS mit ON items.item_id = mit.item_id
        LEFT JOIN menu_printer_links AS mip ON items.item_id = mip.item_id
        WHERE items.category_id = ?
        GROUP BY items.item_id
        ORDER BY items.sort_order;
    `;

    db.all(query, [categoryId], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const processedRows = rows.map(row => ({
          ...row,
          modifier_groups: row.modifier_groups ? row.modifier_groups.split(',').map(Number) : [],
          tax_groups: row.tax_groups ? row.tax_groups.split(',').map(Number) : [],
          printer_groups: row.printer_groups ? row.printer_groups.split(',').map(Number) : [],
      }));
      res.json(processedRows);
    });
  });

  // POST /api/menu/items
router.post('/items', async (req, res) => {
    const { name, short_name, price, price2, description, category_id, menu_id } = req.body;
    // Allow blank item name ("") but require key fields.
    if (name === undefined || name === null || price === undefined || !category_id || !menu_id) {
      return res.status(400).json({ error: 'price, category_id, and menu_id are required.' });
    }
    
    // 가격 유효성 검증
    const priceNum = parseFloat(price);
    const price2Num = parseFloat(price2 || 0);
    
    if (isNaN(priceNum) || priceNum < 0) {
      return res.status(400).json({ error: 'Price must be a non-negative number.' });
    }
    if (isNaN(price2Num) || price2Num < 0) {
      return res.status(400).json({ error: 'Price2 must be a non-negative number.' });
    }
    if (priceNum > 99999.99 || price2Num > 99999.99) {
      return res.status(400).json({ error: 'Price cannot exceed 99999.99.' });
    }

    try {
      const newId = await generateMenuItemId(db);
      const sql = 'INSERT INTO menu_items (item_id, name, short_name, price, price2, description, category_id, menu_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
      const safeName = (typeof name === 'string') ? name : '';
      db.run(sql, [newId, safeName, short_name || null, price, price2 || 0, description || '', category_id, menu_id], function(err) {
        if (err) {
          console.error("SQL Error in POST /api/menu/items:", err.message);
          return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ item_id: newId, name: safeName, short_name, price, price2: price2 || 0, description, category_id, menu_id });
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // PATCH /api/menu/items/:id
router.patch('/items/:id', (req, res) => {
    const { name, short_name, price, price2, description } = req.body;
    const { id } = req.params;

    // Allow blank item name ("") but require price.
    if (name === undefined || name === null || price === undefined) {
        return res.status(400).json({ error: 'Item name (can be blank) and price are required.' });
    }
    
    // 가격 유효성 검증
    const priceNum = parseFloat(price);
    const price2Num = parseFloat(price2 || 0);
    
    if (isNaN(priceNum) || priceNum < 0) {
      return res.status(400).json({ error: 'Price must be a non-negative number.' });
    }
    if (isNaN(price2Num) || price2Num < 0) {
      return res.status(400).json({ error: 'Price2 must be a non-negative number.' });
    }
    if (priceNum > 99999.99 || price2Num > 99999.99) {
      return res.status(400).json({ error: 'Price cannot exceed 99999.99.' });
    }

    const safeName = (typeof name === 'string') ? name : '';
    db.run('UPDATE menu_items SET name = ?, short_name = ?, price = ?, price2 = ?, description = ? WHERE item_id = ?', 
      [safeName, short_name || null, price, price2 || 0, description || '', id], 
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Item not found.' });
        res.status(200).json({ message: 'Item updated successfully.' });
    });
  });
  
  // POST /api/menu/items/:id/image
router.post('/items/:id/image', upload.single('image'), (req, res) => {
    const { id } = req.params;
    if (!req.file) {
      return res.status(400).send('No file uploaded.');
    }
    
    const imageUrl = `/uploads/${req.file.filename}`;
    
    db.run('UPDATE menu_items SET image_url = ? WHERE item_id = ?', [imageUrl, id], function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Item not found.' });
      }
      res.status(200).json({ message: 'Image uploaded successfully', imageUrl });
    });
  });

  // DELETE /api/menu/items/:id
router.delete('/items/:id', (req, res) => {
      const { id } = req.params;
      db.run('DELETE FROM menu_items WHERE item_id = ?', [id], function(err) {
          if (err) return res.status(500).json({ error: err.message });
          if (this.changes === 0) return res.status(404).json({ error: 'Item not found.' });
          res.status(200).json({ message: 'Item deleted successfully.' });
      });
  });

  // PATCH /api/menu/sort
  router.patch('/sort', (req, res) => {
    const { type, items } = req.body; // type: 'categories' or 'items', items: [{id, sort_order}, ...]
    if (!type || !Array.isArray(items)) {
      return res.status(400).json({ error: 'type and items array are required.' });
    }

    const tableName = type === 'categories' ? 'menu_categories' : 'menu_items';
    const idColumn = type === 'categories' ? 'category_id' : 'item_id';

    db.serialize(() => {
      const stmt = db.prepare(`UPDATE ${tableName} SET sort_order = ? WHERE ${idColumn} = ?`);
      items.forEach(item => stmt.run(item.sort_order, item.id));
      stmt.finalize((err) => {
        if (err) return res.status(500).json({ error: 'Failed to update sort order.' });
        res.status(200).json({ message: 'Sort order updated successfully.' });
      });
    });
  });

  // POST /api/menu/links (Create a link)
  router.post('/links', async (req, res) => {
      const { type, item_id, resource_id } = req.body;
      if (!type || !item_id || !resource_id) {
          return res.status(400).json({ error: 'type, item_id, and resource_id are required.' });
      }

      let table, idColumn, resourceColumn, idRange;
      switch (type) {
          case 'modifier':
              table = 'menu_modifier_links';
              resourceColumn = 'modifier_group_id';
              idRange = ID_RANGES.MODIFIER_MENU_LINK;
              break;
          case 'tax':
              table = 'menu_tax_links';
              resourceColumn = 'tax_group_id'; // Assuming we link groups
              idRange = ID_RANGES.TAX_MENU_LINK;
              break;
          case 'printer':
              table = 'menu_printer_links';
              resourceColumn = 'printer_group_id'; // Assuming we link groups
              idRange = ID_RANGES.PRINTER_MENU_LINK;
              break;
          default:
              return res.status(400).json({ error: 'Invalid link type.' });
      }

      try {
          // Use appropriate helper functions for each link type
          let newId;
          switch (type) {
              case 'modifier':
                  newId = await generateModifierMenuLinkId(db);
                  break;
              case 'tax':
                  newId = await generateTaxMenuLinkId(db);
                  break;
              case 'printer':
                  newId = await generatePrinterMenuLinkId(db);
                  break;
          }
          const sql = `INSERT INTO ${table} (link_id, item_id, ${resourceColumn}) VALUES (?, ?, ?)`;
          db.run(sql, [newId, item_id, resource_id], function(err) {
              if (err) {
                  if (err.message.includes('UNIQUE constraint failed')) {
                      return res.status(409).json({ error: 'This link already exists.' });
                  }
                  return res.status(500).json({ error: err.message });
              }
              res.status(201).json({ link_id: newId, type, item_id, resource_id });
          });
      } catch (error) {
          res.status(500).json({ error: error.message });
      }
  });

  // DELETE /api/menu/links (Delete a link)
  router.delete('/links', (req, res) => {
      const { type, item_id, resource_id } = req.body;
      if (!type || !item_id || !resource_id) {
          return res.status(400).json({ error: 'type, item_id, and resource_id are required.' });
      }

      let table, resourceColumn;
      switch (type) {
          case 'modifier':
              table = 'menu_modifier_links';
              resourceColumn = 'modifier_group_id';
              break;
          case 'tax':
              table = 'menu_tax_links';
              resourceColumn = 'tax_group_id';
              break;
          case 'printer':
              table = 'menu_printer_links';
              resourceColumn = 'printer_group_id';
              break;
          default:
              return res.status(400).json({ error: 'Invalid link type.' });
      }

      const sql = `DELETE FROM ${table} WHERE item_id = ? AND ${resourceColumn} = ?`;
      db.run(sql, [item_id, resource_id], function(err) {
          if (err) return res.status(500).json({ error: err.message });
          if (this.changes === 0) return res.status(404).json({ error: 'Link not found.' });
          res.status(200).json({ message: 'Link deleted successfully.' });
      });
  });



  // PATCH /api/menu/categories/:id
  router.patch('/categories/:id', (req, res) => {
    const { name } = req.body;
    const { id } = req.params;
    
    console.log(`PATCH /api/menu/categories/${id} - Request body:`, req.body);
    console.log(`Category ID: ${id}, New name: ${name}`);
    
    if (!name) {
      console.log('Error: Category name is required');
      return res.status(400).json({ error: 'Category name is required.' });
    }
    
    // First get the current category to check its menu_id
    db.get('SELECT menu_id FROM menu_categories WHERE category_id = ?', [id], (err, currentCategory) => {
      if (err) {
        console.error('Error getting current category:', err);
        return res.status(500).json({ error: err.message });
      }
      
      if (!currentCategory) {
        console.log(`Category with ID ${id} not found`);
        return res.status(404).json({ error: 'Category not found.' });
      }
      
      // Check if the new name already exists in the same menu (excluding the current category)
      db.get('SELECT category_id FROM menu_categories WHERE name = ? AND menu_id = ? AND category_id != ?', 
        [name, currentCategory.menu_id, id], (err, row) => {
        if (err) {
          console.error('Error checking for duplicate name:', err);
          return res.status(500).json({ error: err.message });
        }
        
        if (row) {
          console.log(`Error: Category name "${name}" already exists in menu ${currentCategory.menu_id} (ID: ${row.category_id})`);
          return res.status(409).json({ error: `Category name "${name}" already exists in this menu.` });
        }
        
        // If no duplicate found, proceed with update
        db.run('UPDATE menu_categories SET name = ? WHERE category_id = ?', [name, id], function (err) {
          if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: err.message });
          }
          
          console.log(`Database changes: ${this.changes}`);
          
          if (this.changes === 0) {
            console.log(`Category with ID ${id} not found`);
            return res.status(404).json({ error: 'Category not found.' });
          }
          
          console.log(`Category ${id} updated successfully to "${name}"`);
          res.status(200).json({ message: 'Category updated successfully.' });
        });
      });
    });
  });

  // DELETE /api/menu/categories/:id
  router.delete('/categories/:id', (req, res) => {
    const { id } = req.params;

    // First, check if the category has any items
    db.get('SELECT COUNT(*) AS count FROM menu_items WHERE category_id = ?', [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        
        if (row.count > 0) {
            return res.status(400).json({ error: 'Cannot delete category with items. Please move or delete items first.' });
        }

        // If no items, proceed with deletion
        db.run('DELETE FROM menu_categories WHERE category_id = ?', [id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Category not found.' });
            res.status(200).json({ message: 'Category deleted successfully.' });
        });
    });
  });

  // GET /api/menu/items/:id/options - Get all options for a specific menu item
  router.get('/items/:id/options', async (req, res) => {
    const id = Number(req.params.id);
    
    try {
      // 1. 직접 연결된 모디파이어 그룹들 (최우선) - including invalid ones
      const directModifiers = await new Promise((resolve, reject) => {
        db.all(`
          SELECT 
            mml.modifier_group_id,
            CASE 
              WHEN mml.modifier_group_id = -1 THEN 'INVALID_GROUP'
              ELSE mg.name
            END as name,
            mg.selection_type,
            mg.min_selection,
            mg.max_selection,
            CASE 
              WHEN mml.modifier_group_id = -1 THEN 1
              ELSE 0
            END as is_invalid
          FROM menu_modifier_links mml
          LEFT JOIN modifier_groups mg ON mg.modifier_group_id = mml.modifier_group_id
          WHERE mml.item_id = ?
          ORDER BY COALESCE(mml.sort_order, 0), mg.name
        `, [id], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      // 2. 카테고리에서 상속된 모디파이어 그룹들 (직접 연결이 없는 것만)
      const inheritedModifiers = await new Promise((resolve, reject) => {
        db.all(`
          SELECT 
            mg.modifier_group_id as modifier_group_id,
            mg.name,
            mg.selection_type,
            mg.min_selection,
            mg.max_selection,
            COALESCE(cml.is_ambiguous, 0) as is_ambiguous
          FROM modifier_groups mg
          JOIN category_modifier_links cml ON mg.modifier_group_id = cml.modifier_group_id
          JOIN menu_items mi ON cml.category_id = mi.category_id
          WHERE mi.item_id = ? 
            AND COALESCE(mg.is_deleted, 0) = 0
            AND mg.modifier_group_id NOT IN (
              SELECT modifier_group_id FROM menu_modifier_links WHERE item_id = ?
            )
          ORDER BY COALESCE(cml.sort_order, 0), mg.name
        `, [id, id], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      // 3. 우선권 적용: 직접 연결 > 상속
      const modifierGroupsRaw = [
        ...directModifiers.map(m => ({ ...m, source: 'direct' })),
        ...inheritedModifiers.map(m => ({ ...m, source: 'inherited' }))
      ];

      // 4. 각 그룹에 모디파이어 옵션들 추가
      const modifierGroups = await Promise.all(
        modifierGroupsRaw.map(async (group) => {
          if (!group.modifier_group_id || group.is_invalid) {
            return { ...group, modifiers: [] };
          }
          
          const modifiers = await new Promise((resolve, reject) => {
            db.all(`
              SELECT 
                m.modifier_id,
                m.name,
                COALESCE(m.price_delta, 0) as price_adjustment,
                m.button_color
              FROM modifiers m
              JOIN modifier_group_links mgl ON m.modifier_id = mgl.modifier_id
              WHERE mgl.modifier_group_id = ? AND COALESCE(m.is_deleted, 0) = 0
              ORDER BY m.sort_order, m.name
            `, [group.modifier_group_id], (err, rows) => {
              if (err) reject(err);
              else resolve(rows || []);
            });
          });
          
          return { ...group, modifiers };
        })
      );

      // Get tax groups (support both old 'id' and new 'group_id' schema)
      const taxGroups = await new Promise((resolve, reject) => {
        db.all(`
          SELECT 
            tg.tax_group_id as tax_group_id,
            tg.name,
            COALESCE(mtl.is_ambiguous, 0) as is_ambiguous
          FROM tax_groups tg
          JOIN menu_tax_links mtl ON tg.tax_group_id = mtl.tax_group_id
          WHERE mtl.item_id = ? AND (tg.is_deleted = 0 OR tg.is_deleted IS NULL)
          ORDER BY tg.name
        `, [id], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      // Get printer groups
      const printerGroups = await new Promise((resolve, reject) => {
        db.all(`
          SELECT 
            pg.printer_group_id as printer_group_id,
            pg.name,
            COALESCE(mpl.is_ambiguous, 0) as is_ambiguous
          FROM printer_groups pg
          JOIN menu_printer_links mpl ON pg.printer_group_id = mpl.printer_group_id
          WHERE mpl.item_id = ?
          ORDER BY pg.name
        `, [id], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      res.json({
        modifier_groups: modifierGroups,
        tax_groups: taxGroups,
        printer_groups: printerGroups,
        direct_count: directModifiers.length,
        inherited_count: inheritedModifiers.length,
        total_count: modifierGroups.length
      });

    } catch (error) {
      console.error('Failed to get item options:', error);
      res.status(500).json({ error: 'Failed to get item options', details: error.message });
    }
  });

  // POST /api/menu/items/:id/options/modifier - Link modifier group to item
  router.post('/items/:id/options/modifier', async (req, res) => {
    const { id } = req.params;
    const { modifier_group_id } = req.body;

    if (!modifier_group_id) {
      return res.status(400).json({ error: 'modifier_group_id is required.' });
    }

    try {
      // Check if item exists
      const item = await new Promise((resolve, reject) => {
        db.get('SELECT item_id FROM menu_items WHERE item_id = ?', [id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!item) {
        return res.status(404).json({ error: 'Menu item not found.' });
      }

      // Check if modifier group exists
      const modifierGroup = await new Promise((resolve, reject) => {
        db.get('SELECT modifier_group_id FROM modifier_groups WHERE modifier_group_id = ?', [modifier_group_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!modifierGroup) {
        return res.status(404).json({ error: 'Modifier group not found.' });
      }

      // Check if link already exists
      const existingLink = await new Promise((resolve, reject) => {
        db.get('SELECT link_id FROM menu_modifier_links WHERE item_id = ? AND modifier_group_id = ?', 
          [id, modifier_group_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (existingLink) {
        return res.status(409).json({ error: 'Modifier group is already linked to this item.' });
      }

      // Determine next sort_order for this item
      const maxOrder = await new Promise((resolve, reject) => {
        db.get('SELECT COALESCE(MAX(sort_order), 0) as max_order FROM menu_modifier_links WHERE item_id = ?', [id], (err, row) => {
          if (err) reject(err);
          else resolve(row ? row.max_order : 0);
        });
      });

      const linkId = await generateModifierMenuLinkId(db);
      await new Promise((resolve, reject) => {
        db.run('INSERT OR REPLACE INTO menu_modifier_links (link_id, item_id, modifier_group_id, sort_order) VALUES (?, ?, ?, ?)', 
          [linkId, id, modifier_group_id, maxOrder + 1], function(err) {
          if (err) reject(err);
          else resolve(this);
        });
      });

      res.status(201).json({ 
        message: 'Modifier group linked successfully',
        link_id: linkId,
        item_id: id,
        modifier_group_id: modifier_group_id
      });

    } catch (error) {
      console.error('Failed to link modifier group:', error);
      res.status(500).json({ error: 'Failed to link modifier group', details: error.message });
    }
  });

  // DELETE /api/menu/items/:id/options/modifier/:groupId - Unlink modifier group from item
  router.delete('/items/:id/options/modifier/:groupId', async (req, res) => {
    const { id, groupId } = req.params;

    try {
      const result = await new Promise((resolve, reject) => {
        db.run('DELETE FROM menu_modifier_links WHERE item_id = ? AND modifier_group_id = ?', 
          [id, groupId], function(err) {
          if (err) reject(err);
          else resolve(this);
        });
      });

      if (result.changes === 0) {
        return res.status(404).json({ error: 'Modifier group link not found.' });
      }

      res.json({ message: 'Modifier group unlinked successfully' });

    } catch (error) {
      console.error('Failed to unlink modifier group:', error);
      res.status(500).json({ error: 'Failed to unlink modifier group', details: error.message });
    }
  });

  // POST /api/menu/items/:id/options/tax - Link tax group to item
  router.post('/items/:id/options/tax', async (req, res) => {
    const { id } = req.params;
    const { tax_group_id } = req.body;

    if (!tax_group_id) {
      return res.status(400).json({ error: 'tax_group_id is required.' });
    }

    try {
      // Check if item exists
      const item = await new Promise((resolve, reject) => {
        db.get('SELECT item_id FROM menu_items WHERE item_id = ?', [id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!item) {
        return res.status(404).json({ error: 'Menu item not found.' });
      }

      // Check if tax group exists
      const taxGroup = await new Promise((resolve, reject) => {
        db.get('SELECT tax_group_id FROM tax_groups WHERE tax_group_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)', [tax_group_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!taxGroup) {
        return res.status(404).json({ error: 'Tax group not found.' });
      }

      // Check if link already exists
      const existingLink = await new Promise((resolve, reject) => {
        db.get('SELECT link_id FROM menu_tax_links WHERE item_id = ? AND tax_group_id = ?', 
          [id, tax_group_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (existingLink) {
        return res.status(409).json({ error: 'Tax group is already linked to this item.' });
      }

      // Create link (Use INSERT OR REPLACE to prevent unique constraint errors)
      const linkId = await generateTaxMenuLinkId(db);
      await new Promise((resolve, reject) => {
        db.run('INSERT OR REPLACE INTO menu_tax_links (link_id, item_id, tax_group_id) VALUES (?, ?, ?)', 
          [linkId, id, tax_group_id], function(err) {
          if (err) reject(err);
          else resolve(this);
        });
      });

      res.status(201).json({ 
        message: 'Tax group linked successfully',
        link_id: linkId,
        item_id: id,
        tax_group_id: tax_group_id
      });

    } catch (error) {
      console.error('Failed to link tax group:', error);
      res.status(500).json({ error: 'Failed to link tax group', details: error.message });
    }
  });

  // DELETE /api/menu/items/:id/options/tax/:groupId - Unlink tax group from item
  router.delete('/items/:id/options/tax/:groupId', async (req, res) => {
    const { id, groupId } = req.params;

    try {
      const result = await new Promise((resolve, reject) => {
        db.run('DELETE FROM menu_tax_links WHERE item_id = ? AND tax_group_id = ?', 
          [id, groupId], function(err) {
          if (err) reject(err);
          else resolve(this);
        });
      });

      if (result.changes === 0) {
        return res.status(404).json({ error: 'Tax group link not found.' });
      }

      res.json({ message: 'Tax group unlinked successfully' });

    } catch (error) {
      console.error('Failed to unlink tax group:', error);
      res.status(500).json({ error: 'Failed to unlink tax group', details: error.message });
    }
  });

  // POST /api/menu/items/:id/options/printer - Link printer group to item
  router.post('/items/:id/options/printer', async (req, res) => {
    const { id } = req.params;
    const { printer_group_id } = req.body;

    if (!printer_group_id) {
      return res.status(400).json({ error: 'printer_group_id is required.' });
    }

    try {
      // Check if item exists
      const item = await new Promise((resolve, reject) => {
        db.get('SELECT item_id FROM menu_items WHERE item_id = ?', [id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!item) {
        return res.status(404).json({ error: 'Menu item not found.' });
      }

      // Check if printer group exists
      const printerGroup = await new Promise((resolve, reject) => {
        db.get('SELECT printer_group_id FROM printer_groups WHERE printer_group_id = ? AND is_active = 1', [printer_group_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!printerGroup) {
        return res.status(404).json({ error: 'Printer group not found.' });
      }

      // Check if link already exists
      const existingLink = await new Promise((resolve, reject) => {
        db.get('SELECT link_id FROM menu_printer_links WHERE item_id = ? AND printer_group_id = ?', 
          [id, printer_group_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (existingLink) {
        return res.status(409).json({ error: 'Printer group is already linked to this item.' });
      }

      // Create link (Use INSERT OR REPLACE to prevent unique constraint errors)
      const linkId = await generatePrinterMenuLinkId(db);
      await new Promise((resolve, reject) => {
        db.run('INSERT OR REPLACE INTO menu_printer_links (link_id, item_id, printer_group_id) VALUES (?, ?, ?)', 
          [linkId, id, printer_group_id], function(err) {
          if (err) reject(err);
          else resolve(this);
        });
      });

      res.status(201).json({ 
        message: 'Printer group linked successfully',
        link_id: linkId,
        item_id: id,
        printer_group_id: printer_group_id
      });

    } catch (error) {
      console.error('Failed to link printer group:', error);
      res.status(500).json({ error: 'Failed to link printer group', details: error.message });
    }
  });

  // DELETE /api/menu/items/:id/options/printer/:groupId - Unlink printer group from item
  router.delete('/items/:id/options/printer/:groupId', async (req, res) => {
    const { id, groupId } = req.params;

    try {
      const result = await new Promise((resolve, reject) => {
        db.run('DELETE FROM menu_printer_links WHERE item_id = ? AND printer_group_id = ?', 
          [id, groupId], function(err) {
          if (err) reject(err);
          else resolve(this);
        });
      });

      if (result.changes === 0) {
        return res.status(404).json({ error: 'Printer group link not found.' });
      }

      res.json({ message: 'Printer group unlinked successfully' });

    } catch (error) {
      console.error('Failed to unlink printer group:', error);
      res.status(500).json({ error: 'Failed to unlink printer group', details: error.message });
    }
  });

  // GET /api/menu/options/library - Get all available options for linking
  router.get('/options/library', async (req, res) => {
    try {
      // Get all modifier groups
      const modifierGroups = await new Promise((resolve, reject) => {
        db.all('SELECT modifier_group_id, name, selection_type, min_selection, max_selection FROM modifier_groups ORDER BY name', [], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      // Get all tax groups
      const taxGroups = await new Promise((resolve, reject) => {
        db.all('SELECT tax_group_id, name FROM tax_groups WHERE is_deleted = 0 ORDER BY name', [], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      // Get all printer groups
      const printerGroups = await new Promise((resolve, reject) => {
        db.all('SELECT printer_group_id, name FROM printer_groups ORDER BY name', [], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      res.json({
        modifier_groups: modifierGroups,
        tax_groups: taxGroups,
        printer_groups: printerGroups
      });

    } catch (error) {
      console.error('Failed to get options library:', error);
      res.status(500).json({ error: 'Failed to get options library', details: error.message });
    }
  });

  // =========================================================================
  // Category-level Connection APIs
  // =========================================================================

  // GET /api/menu/categories/:categoryId/modifiers - Get modifiers linked to a category
  router.get('/categories/:categoryId/modifiers', async (req, res) => {
    const categoryId = Number(req.params.categoryId);
    
    try {
      const links = await new Promise((resolve, reject) => {
        db.all(`
          SELECT 
            cml.id as link_id,
            cml.category_id,
            cml.modifier_group_id,
            mg.name as group_name,
            mg.selection_type,
            mg.min_selection,
            mg.max_selection
          FROM category_modifier_links cml
          JOIN modifier_groups mg ON cml.modifier_group_id = mg.modifier_group_id
          WHERE cml.category_id = ?
          ORDER BY COALESCE(cml.sort_order, 0), mg.name
        `, [categoryId], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      res.json(links);

    } catch (error) {
      console.error('Failed to get category modifiers:', error);
      res.status(500).json({ error: 'Failed to get category modifiers', details: error.message });
    }
  });

  // POST /api/menu/categories/:categoryId/modifiers - Link modifier group to category
  router.post('/categories/:categoryId/modifiers', async (req, res) => {
    const { categoryId } = req.params;
    const { modifier_group_id } = req.body;

    if (!modifier_group_id) {
      return res.status(400).json({ error: 'modifier_group_id is required.' });
    }

    try {
      // Check if category exists
      const category = await new Promise((resolve, reject) => {
        db.get('SELECT category_id FROM menu_categories WHERE category_id = ?', [categoryId], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!category) {
        return res.status(404).json({ error: 'Category not found.' });
      }

      // Check if modifier group exists
      const modifierGroup = await new Promise((resolve, reject) => {
        db.get('SELECT modifier_group_id FROM modifier_groups WHERE modifier_group_id = ?', [modifier_group_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!modifierGroup) {
        return res.status(404).json({ error: 'Modifier group not found.' });
      }

      // Check if link already exists
      const existingLink = await new Promise((resolve, reject) => {
        db.get('SELECT id FROM category_modifier_links WHERE category_id = ? AND modifier_group_id = ?', 
          [categoryId, modifier_group_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (existingLink) {
        return res.status(409).json({ error: 'Modifier group is already linked to this category.' });
      }

      // Determine next sort_order for this category
      const maxCatOrder = await new Promise((resolve, reject) => {
        db.get('SELECT COALESCE(MAX(sort_order), 0) as max_order FROM category_modifier_links WHERE category_id = ?', [categoryId], (err, row) => {
          if (err) reject(err);
          else resolve(row ? row.max_order : 0);
        });
      });

      const insertResult = await new Promise((resolve, reject) => {
        db.run('INSERT OR REPLACE INTO category_modifier_links (category_id, modifier_group_id, sort_order) VALUES (?, ?, ?)', 
          [categoryId, modifier_group_id, maxCatOrder + 1], function(err) {
          if (err) reject(err);
          else resolve({ lastID: this.lastID });
        });
      });
      const linkId = insertResult.lastID;

      // 2. Automatic inheritance to all menu items in the category
      const items = await new Promise((resolve, reject) => {
        db.all('SELECT item_id FROM menu_items WHERE category_id = ?', [categoryId], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      let inheritedCount = 0;
      
      for (const item of items) {
        // Check if directly linked option already exists
        const existingDirectLink = await new Promise((resolve, reject) => {
          db.get('SELECT link_id FROM menu_modifier_links WHERE item_id = ? AND modifier_group_id = ?', 
            [item.item_id, modifier_group_id], (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });
        
        // Add as inheritance if no direct link exists
        if (!existingDirectLink) {
          const itemLinkId = await generateModifierMenuLinkId(db);
          await new Promise((resolve, reject) => {
            db.run('INSERT OR REPLACE INTO menu_modifier_links (link_id, item_id, modifier_group_id) VALUES (?, ?, ?)', 
              [itemLinkId, item.item_id, modifier_group_id], function(err) {
              if (err) reject(err);
              else resolve(this);
            });
          });
          inheritedCount++;
        }
      }

      res.status(201).json({ 
        message: 'Modifier group linked to category and inherited to items',
        link_id: linkId,
        category_id: categoryId,
        modifier_group_id: modifier_group_id,
        inherited_items: inheritedCount,
        total_items: items.length
      });

    } catch (error) {
      console.error('Failed to link modifier group to category:', error);
      res.status(500).json({ error: 'Failed to link modifier group to category', details: error.message });
    }
  });

  // DELETE /api/menu/categories/:categoryId/modifiers/:groupId - Unlink modifier group from category
  router.delete('/categories/:categoryId/modifiers/:groupId', async (req, res) => {
    const { categoryId, groupId } = req.params;

    try {
      // 1. Delete category link
      const result = await new Promise((resolve, reject) => {
        db.run('DELETE FROM category_modifier_links WHERE category_id = ? AND modifier_group_id = ?', 
          [categoryId, groupId], function(err) {
          if (err) reject(err);
          else resolve(this);
        });
      });

      if (result.changes === 0) {
        return res.status(404).json({ error: 'Modifier group link not found.' });
      }

      // 2. Automatically delete from all menu items in that category (Remove inheritance)
      await new Promise((resolve, reject) => {
        db.run(`
          DELETE FROM menu_modifier_links 
          WHERE modifier_group_id = ? 
          AND item_id IN (SELECT item_id FROM menu_items WHERE category_id = ?)
        `, [groupId, categoryId], function(err) {
          if (err) reject(err);
          else resolve(this);
        });
      });

      res.json({ message: 'Modifier group unlinked from category successfully' });

    } catch (error) {
      console.error('Failed to unlink modifier group from category:', error);
      res.status(500).json({ error: 'Failed to unlink modifier group from category', details: error.message });
    }
  });

  // GET /api/menu/categories/:categoryId/taxes - Get tax groups linked to a category
  router.get('/categories/:categoryId/taxes', async (req, res) => {
    const categoryId = Number(req.params.categoryId);
    
    try {
      const links = await new Promise((resolve, reject) => {
        db.all(`
          SELECT 
            ctl.id as link_id,
            ctl.category_id,
            ctl.tax_group_id,
            tg.name as group_name
          FROM category_tax_links ctl
          LEFT JOIN tax_groups tg ON ctl.tax_group_id = tg.tax_group_id
          WHERE ctl.category_id = ?
          ORDER BY tg.name
        `, [categoryId], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      res.json(links);

    } catch (error) {
      console.error('Failed to get category taxes:', error);
      res.status(500).json({ error: 'Failed to get category taxes', details: error.message });
    }
  });

  // POST /api/menu/categories/:categoryId/taxes - Link tax group to category
  router.post('/categories/:categoryId/taxes', async (req, res) => {
    const { categoryId } = req.params;
    const { tax_group_id } = req.body;

    if (!tax_group_id) {
      return res.status(400).json({ error: 'tax_group_id is required.' });
    }

    try {
      // Check if category exists
      const category = await new Promise((resolve, reject) => {
        db.get('SELECT category_id FROM menu_categories WHERE category_id = ?', [categoryId], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!category) {
        return res.status(404).json({ error: 'Category not found.' });
      }

      // Check if tax group exists (support both old 'id' and new 'group_id' schema)
      const taxGroup = await new Promise((resolve, reject) => {
        db.get('SELECT tax_group_id FROM tax_groups WHERE tax_group_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)', [tax_group_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!taxGroup) {
        return res.status(404).json({ error: 'Tax group not found.' });
      }

      // Check if link already exists
      const existingLink = await new Promise((resolve, reject) => {
        db.get('SELECT id FROM category_tax_links WHERE category_id = ? AND tax_group_id = ?', 
          [categoryId, tax_group_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (existingLink) {
        return res.status(409).json({ error: 'Tax group is already linked to this category.' });
      }

      // Create link (Use INSERT OR REPLACE to prevent unique constraint errors)
      const insertResult = await new Promise((resolve, reject) => {
        db.run('INSERT OR REPLACE INTO category_tax_links (category_id, tax_group_id) VALUES (?, ?)',
          [categoryId, tax_group_id], function(err) {
          if (err) reject(err);
          else resolve({ lastID: this.lastID });
        });
      });
      const linkId = insertResult.lastID;

      // 2. Automatic inheritance to all menu items in the category
      const items = await new Promise((resolve, reject) => {
        db.all('SELECT item_id FROM menu_items WHERE category_id = ?', [categoryId], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      let inheritedCount = 0;
      for (const item of items) {
        // Check if directly linked tax already exists
        const existingDirectLink = await new Promise((resolve, reject) => {
          db.get('SELECT link_id FROM menu_tax_links WHERE item_id = ? AND tax_group_id = ?', 
            [item.item_id, tax_group_id], (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });
        
        // Add as inheritance if no direct link exists
        if (!existingDirectLink) {
          const itemLinkId = await generateTaxMenuLinkId(db);
          await new Promise((resolve, reject) => {
            db.run('INSERT OR REPLACE INTO menu_tax_links (link_id, item_id, tax_group_id) VALUES (?, ?, ?)', 
              [itemLinkId, item.item_id, tax_group_id], function(err) {
              if (err) reject(err);
              else resolve(this);
            });
          });
          inheritedCount++;
        }
      }

      res.status(201).json({ 
        message: 'Tax group linked to category and inherited to items',
        link_id: linkId,
        category_id: categoryId,
        tax_group_id: tax_group_id,
        inherited_items: inheritedCount,
        total_items: items.length
      });

    } catch (error) {
      console.error('Failed to link tax group to category:', error);
      res.status(500).json({ error: 'Failed to link tax group to category', details: error.message });
    }
  });

  // DELETE /api/menu/categories/:categoryId/taxes/:groupId - Unlink tax group from category
  router.delete('/categories/:categoryId/taxes/:groupId', async (req, res) => {
    const { categoryId, groupId } = req.params;

    try {
      // 1. Delete category link
      const result = await new Promise((resolve, reject) => {
        db.run('DELETE FROM category_tax_links WHERE category_id = ? AND tax_group_id = ?', 
          [categoryId, groupId], function(err) {
          if (err) reject(err);
          else resolve(this);
        });
      });

      if (result.changes === 0) {
        return res.status(404).json({ error: 'Tax group link not found.' });
      }

      // 2. Automatically delete from all menu items in that category (Remove inheritance)
      await new Promise((resolve, reject) => {
        db.run(`
          DELETE FROM menu_tax_links 
          WHERE tax_group_id = ? 
          AND item_id IN (SELECT item_id FROM menu_items WHERE category_id = ?)
        `, [groupId, categoryId], function(err) {
          if (err) reject(err);
          else resolve(this);
        });
      });

      res.json({ message: 'Tax group unlinked from category successfully' });

    } catch (error) {
      console.error('Failed to unlink tax group from category:', error);
      res.status(500).json({ error: 'Failed to unlink tax group from category', details: error.message });
    }
  });

  // GET /api/menu/categories/:categoryId/printers - Get printers linked to a category
  router.get('/categories/:categoryId/printers', async (req, res) => {
    const categoryId = Number(req.params.categoryId);
    
    try {
      const links = await new Promise((resolve, reject) => {
        db.all(`
          SELECT 
            cpl.id as link_id,
            cpl.category_id,
            cpl.printer_group_id,
            pg.name as printer_group_name
          FROM category_printer_links cpl
          JOIN printer_groups pg ON cpl.printer_group_id = pg.printer_group_id
          WHERE cpl.category_id = ?
          ORDER BY pg.name
        `, [categoryId], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      res.json(links);

    } catch (error) {
      console.error('Failed to get category printers:', error);
      res.status(500).json({ error: 'Failed to get category printers', details: error.message });
    }
  });

  // POST /api/menu/categories/:categoryId/printers - Link printer group to category
  router.post('/categories/:categoryId/printers', async (req, res) => {
    const { categoryId } = req.params;
    const { printer_group_id } = req.body;

    if (!printer_group_id) {
      return res.status(400).json({ error: 'printer_group_id is required.' });
    }

    try {
      // Check if category exists
      const category = await new Promise((resolve, reject) => {
        db.get('SELECT category_id FROM menu_categories WHERE category_id = ?', [categoryId], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!category) {
        return res.status(404).json({ error: 'Category not found.' });
      }

      // Check if printer group exists
      const printerGroup = await new Promise((resolve, reject) => {
        db.get('SELECT printer_group_id FROM printer_groups WHERE printer_group_id = ? AND is_active = 1', [printer_group_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!printerGroup) {
        return res.status(404).json({ error: 'Printer group not found.' });
      }

      // Check if link already exists
      const existingLink = await new Promise((resolve, reject) => {
        db.get('SELECT id FROM category_printer_links WHERE category_id = ? AND printer_group_id = ?', 
          [categoryId, printer_group_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (existingLink) {
        return res.status(409).json({ error: 'Printer group is already linked to this category.' });
      }

      // Create link (Use INSERT OR REPLACE to prevent unique constraint errors)
      const insertResult = await new Promise((resolve, reject) => {
        db.run('INSERT OR REPLACE INTO category_printer_links (category_id, printer_group_id) VALUES (?, ?)', 
          [categoryId, printer_group_id], function(err) {
          if (err) reject(err);
          else resolve({ lastID: this.lastID });
        });
      });
      const linkId = insertResult.lastID;

      // 2. Automatic inheritance to all menu items in the category
      const items = await new Promise((resolve, reject) => {
        db.all('SELECT item_id FROM menu_items WHERE category_id = ?', [categoryId], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      let inheritedCount = 0;
      for (const item of items) {
        // Check if directly linked printer already exists
        const existingDirectLink = await new Promise((resolve, reject) => {
          db.get('SELECT link_id FROM menu_printer_links WHERE item_id = ? AND printer_group_id = ?', 
            [item.item_id, printer_group_id], (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });
        
        // Add as inheritance if no direct link exists
        if (!existingDirectLink) {
          const itemLinkId = await generatePrinterMenuLinkId(db);
          await new Promise((resolve, reject) => {
            db.run('INSERT OR REPLACE INTO menu_printer_links (link_id, item_id, printer_group_id) VALUES (?, ?, ?)', 
              [itemLinkId, item.item_id, printer_group_id], function(err) {
              if (err) reject(err);
              else resolve(this);
            });
          });
          inheritedCount++;
        }
      }

      res.status(201).json({ 
        message: 'Printer group linked to category and inherited to items',
        link_id: linkId,
        category_id: categoryId,
        printer_group_id: printer_group_id,
        inherited_items: inheritedCount,
        total_items: items.length
      });

    } catch (error) {
      console.error('Failed to link printer group to category:', error);
      res.status(500).json({ error: 'Failed to link printer group to category', details: error.message });
    }
  });

  // DELETE /api/menu/categories/:categoryId/printers/:groupId - Unlink printer group from category
  router.delete('/categories/:categoryId/printers/:groupId', async (req, res) => {
    const { categoryId, groupId } = req.params;

    try {
      // 1. Delete category link
      const result = await new Promise((resolve, reject) => {
        db.run('DELETE FROM category_printer_links WHERE category_id = ? AND printer_group_id = ?', 
          [categoryId, groupId], function(err) {
          if (err) reject(err);
          else resolve(this);
        });
      });

      if (result.changes === 0) {
        return res.status(404).json({ error: 'Printer group link not found.' });
      }

      // 2. Automatically delete from all menu items in that category (Remove inheritance)
      await new Promise((resolve, reject) => {
        db.run(`
          DELETE FROM menu_printer_links 
          WHERE printer_group_id = ? 
          AND item_id IN (SELECT item_id FROM menu_items WHERE category_id = ?)
        `, [groupId, categoryId], function(err) {
          if (err) reject(err);
          else resolve(this);
        });
      });

      res.json({ message: 'Printer group unlinked from category successfully' });

    } catch (error) {
      console.error('Failed to unlink printer group from category:', error);
      res.status(500).json({ error: 'Failed to unlink printer group from category', details: error.message });
    }
  });



  // GET /api/menu/:menuId/export-excel - Export menu data as Excel file with 4 sheets
  router.get('/:menuId/export-excel', async (req, res) => {
    const { menuId } = req.params;

    try {
      // Get menu information
      const menu = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM menus WHERE menu_id = ?', [menuId], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!menu) {
        return res.status(404).json({ error: 'Menu not found' });
      }

      // Get all categories for this menu
      const categories = await new Promise((resolve, reject) => {
        db.all('SELECT * FROM menu_categories WHERE menu_id = ? ORDER BY sort_order', [menuId], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      // Get all items for this menu
      const items = await new Promise((resolve, reject) => {
        db.all(`
          SELECT mi.*, mc.name as category_name 
          FROM menu_items mi 
          LEFT JOIN menu_categories mc ON mi.category_id = mc.category_id 
          WHERE mi.menu_id = ? 
          ORDER BY mc.sort_order, mi.sort_order
        `, [menuId], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      // Get all modifier groups and their modifiers
      const modifierGroups = await new Promise((resolve, reject) => {
        db.all('SELECT * FROM modifier_groups WHERE menu_id = ? AND is_deleted = 0', [menuId], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      // Handle empty modifierGroups array to avoid SQL error
      const modifiers = modifierGroups.length > 0 ? await new Promise((resolve, reject) => {
        db.all(`
          SELECT m.*, mgl.modifier_group_id 
          FROM modifiers m 
          JOIN modifier_group_links mgl ON m.modifier_id = mgl.modifier_id 
          WHERE mgl.modifier_group_id IN (${modifierGroups.map(g => g.modifier_group_id).join(',')}) AND m.is_deleted = 0
        `, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      }) : [];

      // Get modifier labels - handle empty array
      const modifierLabels = modifierGroups.length > 0 ? await new Promise((resolve, reject) => {
        db.all(`
          SELECT ml.* 
          FROM modifier_labels ml 
          WHERE ml.modifier_group_id IN (${modifierGroups.map(g => g.modifier_group_id).join(',')})
        `, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      }) : [];

      // Get all tax groups and their taxes
      const taxGroups = await new Promise((resolve, reject) => {
        db.all('SELECT * FROM tax_groups WHERE menu_id = ? AND is_deleted = 0', [menuId], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      // Handle empty taxGroups array to avoid SQL error
      const taxes = taxGroups.length > 0 ? await new Promise((resolve, reject) => {
        db.all(`
          SELECT t.*, tgl.tax_group_id 
          FROM taxes t 
          JOIN tax_group_links tgl ON t.tax_id = tgl.tax_id 
          WHERE tgl.tax_group_id IN (${taxGroups.map(g => g.tax_group_id).join(',')}) AND t.is_deleted = 0
        `, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      }) : [];

      // Get all printer groups and their printers
      const printerGroups = await new Promise((resolve, reject) => {
        db.all('SELECT * FROM printer_groups WHERE is_active = 1', [], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      // Handle empty printerGroups array to avoid SQL error
      const printers = printerGroups.length > 0 ? await new Promise((resolve, reject) => {
        db.all(`
          SELECT p.*, pgl.printer_group_id 
          FROM printers p 
          JOIN printer_group_links pgl ON p.printer_id = pgl.printer_id 
          WHERE pgl.printer_group_id IN (${printerGroups.map(g => g.printer_group_id).join(',')}) AND p.is_active = 1
        `, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      }) : [];

      // Get connections
      const categoryModifierConnections = await new Promise((resolve, reject) => {
        db.all('SELECT * FROM category_modifier_links WHERE category_id IN (SELECT category_id FROM menu_categories WHERE menu_id = ?)', [menuId], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      const itemModifierConnections = await new Promise((resolve, reject) => {
        db.all('SELECT * FROM menu_modifier_links WHERE item_id IN (SELECT item_id FROM menu_items WHERE menu_id = ?)', [menuId], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      const categoryTaxConnections = await new Promise((resolve, reject) => {
        db.all('SELECT * FROM category_tax_links WHERE category_id IN (SELECT category_id FROM menu_categories WHERE menu_id = ?)', [menuId], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      const itemTaxConnections = await new Promise((resolve, reject) => {
        db.all('SELECT * FROM menu_tax_links WHERE item_id IN (SELECT item_id FROM menu_items WHERE menu_id = ?)', [menuId], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      const categoryPrinterConnections = await new Promise((resolve, reject) => {
        db.all('SELECT * FROM category_printer_links WHERE category_id IN (SELECT category_id FROM menu_categories WHERE menu_id = ?)', [menuId], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      const itemPrinterConnections = await new Promise((resolve, reject) => {
        db.all('SELECT * FROM menu_printer_links WHERE item_id IN (SELECT item_id FROM menu_items WHERE menu_id = ?)', [menuId], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      // Create workbook
      const workbook = XLSX.utils.book_new();

      // Prepare data for each sheet (only 4 sheets now)
      const menuDataRows = [];
      const modifierRows = [];
      const taxRows = [];
      const printerRows = [];

      // Group modifiers by group
      const modifiersByGroup = {};
      modifiers.forEach(modifier => {
        if (!modifiersByGroup[modifier.modifier_group_id]) {
          modifiersByGroup[modifier.modifier_group_id] = [];
        }
        modifiersByGroup[modifier.modifier_group_id].push(modifier);
      });

      // Group taxes by group
      const taxesByGroup = {};
      taxes.forEach(tax => {
        if (!taxesByGroup[tax.tax_group_id]) {
          taxesByGroup[tax.tax_group_id] = [];
        }
        taxesByGroup[tax.tax_group_id].push(tax);
      });

      // Group printers by group
      const printersByGroup = {};
      printers.forEach(printer => {
        if (!printersByGroup[printer.printer_group_id]) {
          printersByGroup[printer.printer_group_id] = [];
        }
        printersByGroup[printer.printer_group_id].push(printer);
      });

      // Group items by category and sort by sort_order within each category
      const itemsByCategory = {};
      for (const item of items) {
        const category = categories.find(c => c.category_id === item.category_id);
        const categoryName = category ? category.name : 'Uncategorized';
        
        if (!itemsByCategory[categoryName]) {
          itemsByCategory[categoryName] = [];
        }
        itemsByCategory[categoryName].push(item);
      }

      // Sort items within each category by sort_order
      for (const categoryName in itemsByCategory) {
        itemsByCategory[categoryName].sort((a, b) => {
          const aOrder = a.sort_order || 0;
          const bOrder = b.sort_order || 0;
          return aOrder - bOrder;
        });
      }

      // Get all category names and sort them by their first item's sort_order
      const categoryNames = Object.keys(itemsByCategory);
      categoryNames.sort((a, b) => {
        const aFirstItem = itemsByCategory[a][0];
        const bFirstItem = itemsByCategory[b][0];
        const aOrder = aFirstItem ? (aFirstItem.sort_order || 0) : 0;
        const bOrder = bFirstItem ? (bFirstItem.sort_order || 0) : 0;
        return aOrder - bOrder;
      });

      // Process each item for Menu Data sheet (sorted by category and then by sort_order)
      let rowNo = 1;
      const categoryHeaderRowIndices = []; // Track category header row indices
      
      for (const categoryName of categoryNames) {
        // Add category header row with connected options
        const category = categories.find(c => c.name === categoryName);
        
        // Get category's connected modifier groups
        const categoryConnectedModifierGroups = categoryModifierConnections
          .filter(conn => conn.category_id === category.category_id)
          .map(conn => modifierGroups.find(group => group.modifier_group_id === conn.modifier_group_id))
          .filter(Boolean);

        // Get category's connected tax groups
        const categoryConnectedTaxGroups = categoryTaxConnections
          .filter(conn => conn.category_id === category.category_id)
          .map(conn => taxGroups.find(group => group.tax_group_id === conn.tax_group_id))
          .filter(Boolean);

        // Get category's connected printer groups
        const categoryConnectedPrinterGroups = categoryPrinterConnections
          .filter(conn => conn.category_id === category.category_id)
          .map(conn => printerGroups.find(group => group.printer_group_id === conn.printer_group_id))
          .filter(Boolean);

        const categoryHeaderRow = {
          [EXCEL_COLUMNS.MENU.NO]: categoryName,
          [EXCEL_COLUMNS.MENU.CATEGORY]: categoryName,
          [EXCEL_COLUMNS.MENU.ITEM_NAME]: '',
          [EXCEL_COLUMNS.MENU.SHORT_NAME]: '',
          [EXCEL_COLUMNS.MENU.PRICE]: '',
          [EXCEL_COLUMNS.MENU.PRICE2]: '',
          [EXCEL_COLUMNS.MENU.DESCRIPTION]: '',
          [`${EXCEL_COLUMNS.MENU.MODIFIER_GROUP} 1`]: categoryConnectedModifierGroups.length > 0 ? categoryConnectedModifierGroups[0].name : '',
          [`${EXCEL_COLUMNS.MENU.MODIFIER_GROUP} 2`]: categoryConnectedModifierGroups.length > 1 ? categoryConnectedModifierGroups[1].name : '',
          [`${EXCEL_COLUMNS.MENU.MODIFIER_GROUP} 3`]: categoryConnectedModifierGroups.length > 2 ? categoryConnectedModifierGroups[2].name : '',
          [`${EXCEL_COLUMNS.MENU.MODIFIER_GROUP} 4`]: categoryConnectedModifierGroups.length > 3 ? categoryConnectedModifierGroups[3].name : '',
          [`${EXCEL_COLUMNS.MENU.MODIFIER_GROUP} 5`]: categoryConnectedModifierGroups.length > 4 ? categoryConnectedModifierGroups[4].name : '',
          [`${EXCEL_COLUMNS.MENU.TAX_GROUP} 1`]: categoryConnectedTaxGroups.length > 0 ? categoryConnectedTaxGroups[0].name : '',
          [`${EXCEL_COLUMNS.MENU.TAX_GROUP} 2`]: categoryConnectedTaxGroups.length > 1 ? categoryConnectedTaxGroups[1].name : '',
          [`${EXCEL_COLUMNS.MENU.TAX_GROUP} 3`]: categoryConnectedTaxGroups.length > 2 ? categoryConnectedTaxGroups[2].name : '',
          [`${EXCEL_COLUMNS.MENU.PRINTER_GROUP} 1`]: categoryConnectedPrinterGroups.length > 0 ? categoryConnectedPrinterGroups[0].name : '',
          [`${EXCEL_COLUMNS.MENU.PRINTER_GROUP} 2`]: categoryConnectedPrinterGroups.length > 1 ? categoryConnectedPrinterGroups[1].name : '',
          [`${EXCEL_COLUMNS.MENU.PRINTER_GROUP} 3`]: categoryConnectedPrinterGroups.length > 2 ? categoryConnectedPrinterGroups[2].name : ''
        };
        menuDataRows.push(categoryHeaderRow);
        categoryHeaderRowIndices.push(menuDataRows.length - 1); // Track the index of this header row

        for (const item of itemsByCategory[categoryName]) {
          const category = categories.find(c => c.category_id === item.category_id);

          // Get connected modifier groups for this item (direct connections first, then category connections)
          const itemConnectedModifierGroups = itemModifierConnections
            .filter(conn => conn.item_id === item.item_id)
            .map(conn => modifierGroups.find(group => group.modifier_group_id === conn.modifier_group_id))
            .filter(Boolean);

          const categoryConnectedModifierGroups = categoryModifierConnections
            .filter(conn => conn.category_id === item.category_id)
            .map(conn => modifierGroups.find(group => group.modifier_group_id === conn.modifier_group_id))
            .filter(Boolean);

          // Use item connections first, then fall back to category connections
          const finalConnectedModifierGroups = itemConnectedModifierGroups.length > 0 
            ? itemConnectedModifierGroups 
            : categoryConnectedModifierGroups;

          // Get connected tax groups for this item (direct connections first, then category connections)
          const itemConnectedTaxGroups = itemTaxConnections
            .filter(conn => conn.item_id === item.item_id)
            .map(conn => taxGroups.find(group => group.tax_group_id === conn.tax_group_id))
            .filter(Boolean);

          const categoryConnectedTaxGroups = categoryTaxConnections
            .filter(conn => conn.category_id === item.category_id)
            .map(conn => taxGroups.find(group => group.tax_group_id === conn.tax_group_id))
            .filter(Boolean);

          // Use item connections first, then fall back to category connections
          const finalConnectedTaxGroups = itemConnectedTaxGroups.length > 0 
            ? itemConnectedTaxGroups 
            : categoryConnectedTaxGroups;

          // Get connected printer groups for this item (direct connections first, then category connections)
          const itemConnectedPrinterGroups = itemPrinterConnections
            .filter(conn => conn.item_id === item.item_id)
            .map(conn => printerGroups.find(group => group.printer_group_id === conn.printer_group_id))
            .filter(Boolean);

          const categoryConnectedPrinterGroups = categoryPrinterConnections
            .filter(conn => conn.category_id === item.category_id)
            .map(conn => printerGroups.find(group => group.printer_group_id === conn.printer_group_id))
            .filter(Boolean);

          // Use item connections first, then fall back to category connections
          const finalConnectedPrinterGroups = itemConnectedPrinterGroups.length > 0 
            ? itemConnectedPrinterGroups 
            : categoryConnectedPrinterGroups;

          // Create row data for Menu Data sheet
          const row = {
            [EXCEL_COLUMNS.MENU.NO]: rowNo++,
            [EXCEL_COLUMNS.MENU.CATEGORY]: category ? category.name : '',
            [EXCEL_COLUMNS.MENU.ITEM_NAME]: item.name,
            [EXCEL_COLUMNS.MENU.SHORT_NAME]: item.short_name || '',
            [EXCEL_COLUMNS.MENU.PRICE]: item.price,
            [EXCEL_COLUMNS.MENU.PRICE2]: item.price2 || '',
            [EXCEL_COLUMNS.MENU.DESCRIPTION]: item.description || '',
            [`${EXCEL_COLUMNS.MENU.MODIFIER_GROUP} 1`]: finalConnectedModifierGroups.length > 0 ? finalConnectedModifierGroups[0].name : '',
            [`${EXCEL_COLUMNS.MENU.MODIFIER_GROUP} 2`]: finalConnectedModifierGroups.length > 1 ? finalConnectedModifierGroups[1].name : '',
            [`${EXCEL_COLUMNS.MENU.MODIFIER_GROUP} 3`]: finalConnectedModifierGroups.length > 2 ? finalConnectedModifierGroups[2].name : '',
            [`${EXCEL_COLUMNS.MENU.MODIFIER_GROUP} 4`]: finalConnectedModifierGroups.length > 3 ? finalConnectedModifierGroups[3].name : '',
            [`${EXCEL_COLUMNS.MENU.MODIFIER_GROUP} 5`]: finalConnectedModifierGroups.length > 4 ? finalConnectedModifierGroups[4].name : '',
            [`${EXCEL_COLUMNS.MENU.TAX_GROUP} 1`]: finalConnectedTaxGroups.length > 0 ? finalConnectedTaxGroups[0].name : '',
            [`${EXCEL_COLUMNS.MENU.TAX_GROUP} 2`]: finalConnectedTaxGroups.length > 1 ? finalConnectedTaxGroups[1].name : '',
            [`${EXCEL_COLUMNS.MENU.TAX_GROUP} 3`]: finalConnectedTaxGroups.length > 2 ? finalConnectedTaxGroups[2].name : '',
            [`${EXCEL_COLUMNS.MENU.PRINTER_GROUP} 1`]: finalConnectedPrinterGroups.length > 0 ? finalConnectedPrinterGroups[0].name : '',
            [`${EXCEL_COLUMNS.MENU.PRINTER_GROUP} 2`]: finalConnectedPrinterGroups.length > 1 ? finalConnectedPrinterGroups[1].name : '',
            [`${EXCEL_COLUMNS.MENU.PRINTER_GROUP} 3`]: finalConnectedPrinterGroups.length > 2 ? finalConnectedPrinterGroups[2].name : ''
          };

          menuDataRows.push(row);
        }
      }

      // Categories and Image Menu sheets are no longer needed
      // Images are managed only through the POS interface

      // Process modifier groups for Modifiers sheet
      for (const group of modifierGroups) {
        const groupModifiers = modifiersByGroup[group.modifier_group_id] || [];
        
        // Find label for this group
        const groupLabel = modifierLabels.find(label => label.modifier_group_id === group.modifier_group_id);
        
        const row = {
          [EXCEL_COLUMNS.MODIFIER.NO]: group.modifier_group_id,
          [EXCEL_COLUMNS.MODIFIER.GROUP_NAME]: group.name,
          [EXCEL_COLUMNS.MODIFIER.LABEL]: groupLabel ? groupLabel.label_name : '',
          [EXCEL_COLUMNS.MODIFIER.MIN]: group.min_selection || 0,
          [EXCEL_COLUMNS.MODIFIER.MAX]: group.max_selection || 0
        };
        
        // Add modifiers dynamically (up to 50)
        for (let i = 0; i < 50; i++) {
          row[`${EXCEL_COLUMNS.MODIFIER.MODIFIER} ${i + 1}`] = groupModifiers.length > i ? groupModifiers[i].name : '';
          row[`${EXCEL_COLUMNS.MODIFIER.PRICE} ${i + 1}`] = groupModifiers.length > i ? groupModifiers[i].price_delta : '';
        }

        modifierRows.push(row);
      }

      // Process tax groups for Taxes sheet
      for (const group of taxGroups) {
        const groupTaxes = taxesByGroup[group.tax_group_id] || [];
        
        const row = {
          [EXCEL_COLUMNS.TAX.NO]: group.tax_group_id,
          [EXCEL_COLUMNS.TAX.GROUP_NAME]: group.name
        };
        
        // Add taxes dynamically (up to 10)
        for (let i = 0; i < 10; i++) {
          row[`${EXCEL_COLUMNS.TAX.TAX} ${i + 1}`] = groupTaxes.length > i ? groupTaxes[i].name : '';
          row[`${EXCEL_COLUMNS.TAX.RATE} ${i + 1}`] = groupTaxes.length > i ? groupTaxes[i].rate : '';
        }

        taxRows.push(row);
      }

      // Process printer groups for Printers sheet
      for (const group of printerGroups) {
        const groupPrinters = printersByGroup[group.printer_group_id] || [];
        
        const row = {
          [EXCEL_COLUMNS.PRINTER.NO]: group.printer_group_id,
          [EXCEL_COLUMNS.PRINTER.GROUP_NAME]: group.name,
          [EXCEL_COLUMNS.PRINTER.KITCHEN_TYPE]: group.printer_type || ''
        };
        
        // Add printers dynamically (up to 30)
        for (let i = 0; i < 30; i++) {
          row[`${EXCEL_COLUMNS.PRINTER.PRINTER} ${i + 1}`] = groupPrinters.length > i ? groupPrinters[i].name : '';
        }

        printerRows.push(row);
      }

      // Create worksheets (only 4 sheets now)
      const menuDataWorksheet = XLSX.utils.json_to_sheet(menuDataRows);
      const modifierWorksheet = XLSX.utils.json_to_sheet(modifierRows);
      const taxWorksheet = XLSX.utils.json_to_sheet(taxRows);
      const printerWorksheet = XLSX.utils.json_to_sheet(printerRows);

      // Apply styling to category header rows in Menu Date sheet
      if (!menuDataWorksheet['!rows']) {
        menuDataWorksheet['!rows'] = [];
      }
      
      // Apply background color to category header rows
      categoryHeaderRowIndices.forEach((rowIndex, index) => {
        const excelRowIndex = rowIndex + 2; // +2 because Excel is 1-based and we have a header row
        
        // Set row height for category headers
        if (!menuDataWorksheet['!rows'][excelRowIndex - 1]) {
          menuDataWorksheet['!rows'][excelRowIndex - 1] = {};
        }
        menuDataWorksheet['!rows'][excelRowIndex - 1].ht = 25; // Set row height
        
        // Apply background color to all cells in the category header row
        const columns = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q'];
        columns.forEach(col => {
          const cellRef = `${col}${excelRowIndex}`;
          
          // Ensure the cell exists and has proper structure
          if (!menuDataWorksheet[cellRef]) {
            menuDataWorksheet[cellRef] = { v: '' };
          }
          
                // Apply styling with explicit cell structure
      const cellValue = menuDataWorksheet[cellRef].v || '';
      menuDataWorksheet[cellRef] = {
        v: cellValue,
        t: 's', // string type
        s: {
          fill: {
            patternType: 'solid',
            fgColor: { rgb: 'E3F2FD' }
          },
          font: {
            bold: true,
            color: { rgb: '1976D2' },
            sz: 11
          },
          alignment: {
            horizontal: 'left',
            vertical: 'center'
          }
        }
      };
      
      // Try setting cell properties directly
      if (!menuDataWorksheet['!cols']) {
        menuDataWorksheet['!cols'] = [];
      }
          
          // Debug: Log the cell styling
          console.log(`Applied styling to cell ${cellRef}:`, menuDataWorksheet[cellRef].s);
        });
      });
      
      // Try alternative styling approach using cell comments or other methods
      console.log('Category header row indices:', categoryHeaderRowIndices);
      console.log('Menu data worksheet structure:', Object.keys(menuDataWorksheet));
      
      // Alternative: Try using cell comments to mark category headers
      categoryHeaderRowIndices.forEach((rowIndex, index) => {
        const excelRowIndex = rowIndex + 2;
        const cellRef = `B${excelRowIndex}`; // Category Name column
        
        if (menuDataWorksheet[cellRef]) {
          // Add comment to mark as category header
          if (!menuDataWorksheet['!comments']) {
            menuDataWorksheet['!comments'] = {};
          }
          menuDataWorksheet['!comments'][cellRef] = {
            author: 'System',
            text: 'Category Header'
          };
        }
      });

      // Add worksheets to workbook
      XLSX.utils.book_append_sheet(workbook, menuDataWorksheet, 'Menu Date');
      XLSX.utils.book_append_sheet(workbook, modifierWorksheet, 'Modifiers');
      XLSX.utils.book_append_sheet(workbook, taxWorksheet, 'Taxes');
      XLSX.utils.book_append_sheet(workbook, printerWorksheet, 'Printers');

      // Set response headers for Excel download
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      const safeName = encodeURIComponent(menu.name || 'Menu').replace(/%20/g, '_');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.xlsx"`);

      // Write Excel file to response with styling options
      const buffer = XLSX.write(workbook, { 
        type: 'buffer', 
        bookType: 'xlsx',
        compression: true,
        cellStyles: true,
        cellDates: true,
        cellNF: true,
        cellHTML: true
      });
      res.send(buffer);

    } catch (error) {
      console.error('Excel export failed:', error);
      res.status(500).json({ error: 'Failed to export menu as Excel', details: error.message });
    }
  });

  // POST /api/menu/:menuId/import-excel - Import menu data from Excel file
  router.post('/:menuId/import-excel', upload.single('file'), async (req, res) => {
    const { menuId } = req.params;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No Excel file uploaded.' });
    }

    try {
      console.log('=== IMPORT START ===');
      console.log('File path:', req.file.path);
      console.log('File size:', req.file.size);
      
      // Read Excel file
      const workbook = XLSX.readFile(req.file.path);
      console.log('Excel file read successfully');
      console.log('Available sheets:', Object.keys(workbook.Sheets));
      
      // Read data from different sheets (only 4 sheets now)
      if (!workbook.Sheets['Menu Date']) {
        throw new Error('Menu Date sheet not found in Excel file');
      }
      
      const menuData = XLSX.utils.sheet_to_json(workbook.Sheets['Menu Date']);
      console.log('Menu Date sheet rows:', menuData.length);
      
      const modifierGroupsRaw = XLSX.utils.sheet_to_json(workbook.Sheets['Modifiers'] || {});
      const taxGroupsRaw = XLSX.utils.sheet_to_json(workbook.Sheets['Taxes'] || {});
      const printerGroupsRaw = XLSX.utils.sheet_to_json(workbook.Sheets['Printers'] || {});
      
      console.log('Modifiers sheet rows:', modifierGroupsRaw.length);
      console.log('Taxes sheet rows:', taxGroupsRaw.length);
      console.log('Printers sheet rows:', printerGroupsRaw.length);

      // Validate data
      if (!menuData.length) {
        throw new Error('Invalid Excel file format. Menu Date sheet is required.');
      }

      // Normalize modifier groups (support both new and legacy column names)
      const modifierGroups = modifierGroupsRaw.map(g => ({
        ...g,
        groupName: getExcelValue(g, EXCEL_COLUMNS.MODIFIER.GROUP_NAME, 'Modifier Group Name'),
        label: getExcelValue(g, EXCEL_COLUMNS.MODIFIER.LABEL, 'Label'),
        no: getExcelValue(g, EXCEL_COLUMNS.MODIFIER.NO, 'No'),
        min: getExcelValue(g, EXCEL_COLUMNS.MODIFIER.MIN, 'Min'),
        max: getExcelValue(g, EXCEL_COLUMNS.MODIFIER.MAX, 'Max')
      }));

      // Normalize tax groups
      const taxGroups = taxGroupsRaw.map(g => ({
        ...g,
        groupName: getExcelValue(g, EXCEL_COLUMNS.TAX.GROUP_NAME, 'Tax Group Name'),
        no: getExcelValue(g, EXCEL_COLUMNS.TAX.NO, 'No')
      }));

      // Normalize printer groups
      const printerGroups = printerGroupsRaw.map(g => ({
        ...g,
        groupName: getExcelValue(g, EXCEL_COLUMNS.PRINTER.GROUP_NAME, 'Printer Group Name'),
        kitchenType: getExcelValue(g, EXCEL_COLUMNS.PRINTER.KITCHEN_TYPE, 'Kitchen Type'),
        no: getExcelValue(g, EXCEL_COLUMNS.PRINTER.NO, 'No')
      }));

      // Helper function to find modifier group by name + label
      const findModifierGroup = (groupName, label = '') => {
        const normalizedName = groupName.trim().toLowerCase();
        const normalizedLabel = label ? label.trim().toLowerCase() : '';
        
        // First try to find exact match with name + label
        if (normalizedLabel) {
          const exactMatch = modifierGroups.find(g => 
            g.groupName && g.groupName.trim().toLowerCase() === normalizedName &&
            g.label && g.label.trim().toLowerCase() === normalizedLabel
          );
          if (exactMatch) return exactMatch;
        }
        
        // Find all groups with matching name
        const matchingGroups = modifierGroups.filter(g => 
          g.groupName && g.groupName.trim().toLowerCase() === normalizedName
        );
        
        if (matchingGroups.length === 1) {
          return matchingGroups[0];
        } else if (matchingGroups.length > 1) {
          console.warn(`Warning: Multiple modifier groups found with name "${groupName}". Consider using Label to distinguish.`);
          return matchingGroups[0]; // Return first match
        }
        
        return null;
      };

      // Helper function to find tax group by name
      const findTaxGroup = (groupName) => {
        return taxGroups.find(g => 
          g.groupName && g.groupName.trim().toLowerCase() === groupName.trim().toLowerCase()
        );
      };

      // Helper function to find printer group by name
      const findPrinterGroup = (groupName) => {
        return printerGroups.find(g => 
          g.groupName && g.groupName.trim().toLowerCase() === groupName.trim().toLowerCase()
        );
      };

      // Extract category header rows (rows where Item Name is empty and No equals Category)
      const categoryHeaderRows = menuData.filter(item => {
        const itemName = getExcelValue(item, EXCEL_COLUMNS.MENU.ITEM_NAME, 'Item Name');
        const no = getExcelValue(item, EXCEL_COLUMNS.MENU.NO, 'No');
        const category = getExcelValue(item, EXCEL_COLUMNS.MENU.CATEGORY, 'Category Name');
        return (!itemName || itemName.trim() === '') && category && category.trim() !== '';
      }).map(item => ({
        ...item,
        _category: getExcelValue(item, EXCEL_COLUMNS.MENU.CATEGORY, 'Category Name')
      }));

      // Filter out category header rows (support both new and legacy column names)
      const filteredMenuData = menuData.filter(item => {
        const itemName = getExcelValue(item, EXCEL_COLUMNS.MENU.ITEM_NAME, 'Item Name');
        const no = getExcelValue(item, EXCEL_COLUMNS.MENU.NO, 'No');
        return itemName && itemName.trim() !== '' && !isNaN(parseInt(no));
      }).map(item => ({
        ...item,
        // Normalize to standard property names
        _no: getExcelValue(item, EXCEL_COLUMNS.MENU.NO, 'No'),
        _category: getExcelValue(item, EXCEL_COLUMNS.MENU.CATEGORY, 'Category Name'),
        _itemName: getExcelValue(item, EXCEL_COLUMNS.MENU.ITEM_NAME, 'Item Name'),
        _shortName: getExcelValue(item, EXCEL_COLUMNS.MENU.SHORT_NAME, 'Short Name'),
        _price: getExcelValue(item, EXCEL_COLUMNS.MENU.PRICE, 'Price'),
        _price2: getExcelValue(item, EXCEL_COLUMNS.MENU.PRICE2, 'Price2'),
        _description: getExcelValue(item, EXCEL_COLUMNS.MENU.DESCRIPTION, 'Description')
      }));
      
      if (!filteredMenuData.length) {
        throw new Error('No valid menu items found in Menu Data sheet');
      }

      // Start transaction
      await new Promise((resolve, reject) => {
        db.run('BEGIN TRANSACTION', (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      try {
        // Store existing data for comparison and backup
        const existingItems = await new Promise((resolve, reject) => {
          db.all('SELECT * FROM menu_items WHERE menu_id = ?', [menuId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          });
        });

        const existingCategories = await new Promise((resolve, reject) => {
          db.all('SELECT * FROM menu_categories WHERE menu_id = ?', [menuId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          });
        });

        // Create backup data
        const backupData = {
          timestamp: new Date().toISOString(),
          menuId: menuId,
          categories: existingCategories,
          items: existingItems,
          backupType: 'pre_import'
        };

        // Generate backup filename (환경 변수 BACKUPS_PATH 사용, 빌드된 앱 호환)
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFilename = `backup_menu_${menuId}_${timestamp}.json`;
        const fs = require('fs');
        const path = require('path');
        const backupDir = process.env.BACKUPS_PATH || path.resolve('./backups');
        const backupPath = path.join(backupDir, backupFilename);

        // Ensure backups directory exists
        if (!fs.existsSync(backupDir)) {
          fs.mkdirSync(backupDir, { recursive: true });
        }

        // Save backup file
        fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));

        // Track lost images for popup notification
        const lostImages = {
          categories: [],
          items: []
        };

        // Clear existing data - items, categories, and all related links/groups
        const existingItemIds = (existingItems || []).map(i => i.item_id);
        const existingCategoryIds = (existingCategories || []).map(c => c.category_id);

        // Delete item-level links
        if (existingItemIds.length > 0) {
          const itemPlaceholders = existingItemIds.map(() => '?').join(',');
          await new Promise((resolve, reject) => {
            db.run(`DELETE FROM menu_modifier_links WHERE item_id IN (${itemPlaceholders})`, existingItemIds, (err) => { if (err) reject(err); else resolve(); });
          });
          await new Promise((resolve, reject) => {
            db.run(`DELETE FROM menu_tax_links WHERE item_id IN (${itemPlaceholders})`, existingItemIds, (err) => { if (err) reject(err); else resolve(); });
          });
          await new Promise((resolve, reject) => {
            db.run(`DELETE FROM menu_printer_links WHERE item_id IN (${itemPlaceholders})`, existingItemIds, (err) => { if (err) reject(err); else resolve(); });
          });
        }

        // Delete category-level links
        if (existingCategoryIds.length > 0) {
          const catPlaceholders = existingCategoryIds.map(() => '?').join(',');
          await new Promise((resolve, reject) => {
            db.run(`DELETE FROM category_modifier_links WHERE category_id IN (${catPlaceholders})`, existingCategoryIds, (err) => { if (err) reject(err); else resolve(); });
          });
          await new Promise((resolve, reject) => {
            db.run(`DELETE FROM category_tax_links WHERE category_id IN (${catPlaceholders})`, existingCategoryIds, (err) => { if (err) reject(err); else resolve(); });
          });
          await new Promise((resolve, reject) => {
            db.run(`DELETE FROM category_printer_links WHERE category_id IN (${catPlaceholders})`, existingCategoryIds, (err) => { if (err) reject(err); else resolve(); });
          });
        }

        // Delete existing modifier groups, modifiers, and their links for this menu
        const existingModGroups = await new Promise((resolve, reject) => {
          db.all('SELECT modifier_group_id FROM modifier_groups WHERE menu_id = ?', [menuId], (err, rows) => { if (err) reject(err); else resolve(rows || []); });
        });
        if (existingModGroups.length > 0) {
          const mgIds = existingModGroups.map(g => g.modifier_group_id);
          const mgPlaceholders = mgIds.map(() => '?').join(',');
          // Delete modifier_group_links first (references both modifiers and groups)
          await new Promise((resolve, reject) => {
            db.run(`DELETE FROM modifier_group_links WHERE modifier_group_id IN (${mgPlaceholders})`, mgIds, (err) => { if (err) reject(err); else resolve(); });
          });
          // Delete modifier_labels
          await new Promise((resolve, reject) => {
            db.run(`DELETE FROM modifier_labels WHERE modifier_group_id IN (${mgPlaceholders})`, mgIds, (err) => { if (err) reject(err); else resolve(); });
          });
          // Delete the groups themselves
          await new Promise((resolve, reject) => {
            db.run('DELETE FROM modifier_groups WHERE menu_id = ?', [menuId], (err) => { if (err) reject(err); else resolve(); });
          });
        }

        // Delete existing tax groups, taxes, and their links for this menu
        const existingTaxGroups = await new Promise((resolve, reject) => {
          db.all('SELECT tax_group_id FROM tax_groups WHERE menu_id = ?', [menuId], (err, rows) => { if (err) reject(err); else resolve(rows || []); });
        });
        if (existingTaxGroups.length > 0) {
          const tgIds = existingTaxGroups.map(g => g.tax_group_id);
          const tgPlaceholders = tgIds.map(() => '?').join(',');
          await new Promise((resolve, reject) => {
            db.run(`DELETE FROM tax_group_links WHERE tax_group_id IN (${tgPlaceholders})`, tgIds, (err) => { if (err) reject(err); else resolve(); });
          });
          await new Promise((resolve, reject) => {
            db.run('DELETE FROM tax_groups WHERE menu_id = ?', [menuId], (err) => { if (err) reject(err); else resolve(); });
          });
        }

        // Delete items and categories
        await new Promise((resolve, reject) => {
          db.run('DELETE FROM menu_items WHERE menu_id = ?', [menuId], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        await new Promise((resolve, reject) => {
          db.run('DELETE FROM menu_categories WHERE menu_id = ?', [menuId], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        // Extract unique categories from menu data
        const uniqueCategories = [];
        const categorySet = new Set();
        
        for (const item of filteredMenuData) {
          const categoryName = item._category;
          if (categoryName && !categorySet.has(categoryName)) {
            categorySet.add(categoryName);
            uniqueCategories.push({
              name: categoryName,
              firstNumber: parseInt(item._no) || 0
            });
          }
        }

        // Sort categories by their first number
        uniqueCategories.sort((a, b) => a.firstNumber - b.firstNumber);

        // Import categories
        for (const category of uniqueCategories) {
          const newCategoryId = await generateCategoryId(db);
          category.categoryId = newCategoryId; // Store category ID for later use
          
          await new Promise((resolve, reject) => {
            db.run(
              'INSERT INTO menu_categories (category_id, name, menu_id, sort_order) VALUES (?, ?, ?, ?)',
              [newCategoryId, category.name, parseInt(menuId), parseInt(category.firstNumber)],
              (err) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });
        }

        // Sort menu items by category and then by No
        const sortedMenuDataForImport = filteredMenuData.sort((a, b) => {
          const categoryA = uniqueCategories.find(c => c.name === a._category);
          const categoryB = uniqueCategories.find(c => c.name === b._category);
          
          if (categoryA && categoryB) {
            if (categoryA.firstNumber !== categoryB.firstNumber) {
              return categoryA.firstNumber - categoryB.firstNumber;
            }
          }
          
          return parseInt(a._no) - parseInt(b._no);
        });

        // NOTE: Category/item group connections are deferred until after
        // modifier groups, tax groups, and printer groups are imported below.

        // Validate and fix No field issues
        const noValidationErrors = [];
        const duplicateNos = new Set();
        const usedNos = new Set();
        let maxNo = 0;

        // 1. Check for missing or invalid No values
        for (let i = 0; i < filteredMenuData.length; i++) {
          const item = filteredMenuData[i];
          const no = item._no;
          
          // Check if No is missing, null, undefined, or empty string
          if (!no || no === '' || no === null || no === undefined) {
            noValidationErrors.push(`Row ${i + 2}: Missing No value for item "${item._itemName}"`);
            // Assign a temporary negative number for now
            item._no = -(i + 1);
          }
          
          // Check if No is a valid number
          const noNum = parseInt(no);
          if (isNaN(noNum)) {
            noValidationErrors.push(`Row ${i + 2}: Invalid No value "${no}" for item "${item._itemName}" - must be a number`);
            // Assign a temporary negative number
            item._no = -(i + 1);
          } else {
            item._no = noNum;
            maxNo = Math.max(maxNo, noNum);
          }
        }

        // 2. Check for duplicate No values
        for (let i = 0; i < filteredMenuData.length; i++) {
          const item = filteredMenuData[i];
          const no = item._no;
          
          if (usedNos.has(no)) {
            duplicateNos.add(no);
            noValidationErrors.push(`Row ${i + 2}: Duplicate No value ${no} for item "${item._itemName}"`);
          } else {
            usedNos.add(no);
          }
        }

        // 3. Fix duplicate No values by reassigning
        if (duplicateNos.size > 0) {
          console.log('Fixing duplicate No values...');
          for (let i = 0; i < filteredMenuData.length; i++) {
            const item = filteredMenuData[i];
            if (duplicateNos.has(item._no)) {
              // Find next available number
              let newNo = maxNo + 1;
              while (usedNos.has(newNo)) {
                newNo++;
              }
              console.log(`Reassigning No for "${item._itemName}" from ${item._no} to ${newNo}`);
              item._no = newNo;
              usedNos.add(newNo);
              maxNo = Math.max(maxNo, newNo);
            }
          }
        }

        // 4. If there were validation errors, log them and prepare for response
        if (noValidationErrors.length > 0) {
          console.warn('No field validation issues found and fixed:');
          noValidationErrors.forEach(error => console.warn(error));
        }

        // Sort items by category order (based on first number of each category)
        const categoryFirstNumbers = {};
        for (const item of filteredMenuData) {
          const categoryName = item._category;
          if (!categoryFirstNumbers[categoryName]) {
            categoryFirstNumbers[categoryName] = item._no;
          }
        }

        // Sort categories by their first number
        const sortedCategoryNames = Object.entries(categoryFirstNumbers)
          .sort(([,a], [,b]) => a - b)
          .map(([name]) => name);

        // Group items by category and sort within each category
        const itemsByCategoryForImport = {};
        for (const item of filteredMenuData) {
          const categoryName = item._category;
          if (!itemsByCategoryForImport[categoryName]) {
            itemsByCategoryForImport[categoryName] = [];
          }
          itemsByCategoryForImport[categoryName].push(item);
        }

        // Sort items within each category by No
        for (const categoryName in itemsByCategoryForImport) {
          itemsByCategoryForImport[categoryName].sort((a, b) => a._no - b._no);
        }

        // Create sorted menu data: categories in order, then items within each category
        const sortedMenuData = [];
        for (const categoryName of sortedCategoryNames) {
          const categoryItems = itemsByCategoryForImport[categoryName] || [];
          sortedMenuData.push(...categoryItems);
        }

        // Import items (connections deferred until after groups are created)
        const importedItems = [];
        for (const item of sortedMenuDataForImport) {
          const newItemId = await generateMenuItemId(db);
          const categoryId = uniqueCategories.find(c => c.name === item._category)?.categoryId;
          
          await new Promise((resolve, reject) => {
            db.run(
              'INSERT INTO menu_items (item_id, name, short_name, category_id, menu_id, price, price2, description, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [
                newItemId,
                item._itemName,
                item._shortName || null,
                categoryId,
                parseInt(menuId),
                parseFloat(item._price) || 0,
                parseFloat(item._price2) || 0,
                item._description || '',
                parseInt(item._no) || 0
              ],
              (err) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });

          importedItems.push({ newItemId, excelRow: item });
        }

        // Import modifier groups with new IDs; build name→newId map
        const modGroupNameToId = {};
        for (const group of modifierGroups) {
          if (!group.groupName) {
            console.warn('Skipping modifier group - missing name:', group);
            continue;
          }
          
          const newGroupId = await generateNextId(db, ID_RANGES.MODIFIER_GROUP);
          modGroupNameToId[group.groupName.trim()] = newGroupId;
          group._newId = newGroupId;
          
          await new Promise((resolve, reject) => {
            db.run(
              'INSERT INTO modifier_groups (modifier_group_id, name, selection_type, min_selection, max_selection, menu_id) VALUES (?, ?, ?, ?, ?, ?)',
              [newGroupId, group.groupName, 'single', group.min || 0, group.max || 1, menuId],
              (err) => { if (err) reject(err); else resolve(); }
            );
          });

          // Import label if present
          if (group.label && group.label.trim() !== '') {
            await new Promise((resolve, reject) => {
              db.run(
                'INSERT INTO modifier_labels (modifier_group_id, label_name) VALUES (?, ?)',
                [newGroupId, group.label.trim()],
                (err) => { if (err) reject(err); else resolve(); }
              );
            });
          }
        }

        // Import modifiers from modifier groups
        for (const group of modifierGroups) {
          if (!group._newId) continue;
          
          for (let i = 1; i <= 50; i++) {
            const modifierName = getExcelValue(group, `${EXCEL_COLUMNS.MODIFIER.MODIFIER} ${i}`, `Modifier ${i}`);
            const modifierPrice = getExcelValue(group, `${EXCEL_COLUMNS.MODIFIER.PRICE} ${i}`, `Price ${i}`);
            
            if (modifierName && modifierName.trim() !== '') {
              const newModifierId = await generateNextId(db, ID_RANGES.MODIFIER);
              
              await new Promise((resolve, reject) => {
                db.run('INSERT INTO modifiers (modifier_id, name, price_delta) VALUES (?, ?, ?)',
                  [newModifierId, modifierName, parseFloat(modifierPrice) || 0],
                  (err) => { if (err) reject(err); else resolve(); });
              });

              await new Promise((resolve, reject) => {
                db.run('INSERT INTO modifier_group_links (modifier_group_id, modifier_id) VALUES (?, ?)',
                  [group._newId, newModifierId],
                  (err) => { if (err) reject(err); else resolve(); });
              });
            }
          }
        }

        // Import tax groups with new IDs; build name→newId map
        const taxGroupNameToId = {};
        for (const group of taxGroups) {
          if (!group.groupName) {
            console.warn('Skipping tax group - missing name:', group);
            continue;
          }
          
          const newGroupId = await generateNextId(db, ID_RANGES.TAX_GROUP);
          taxGroupNameToId[group.groupName.trim()] = newGroupId;
          group._newId = newGroupId;
          
          await new Promise((resolve, reject) => {
            db.run('INSERT INTO tax_groups (tax_group_id, name, menu_id) VALUES (?, ?, ?)',
              [newGroupId, group.groupName, menuId],
              (err) => { if (err) reject(err); else resolve(); });
          });
        }

        // Import taxes from tax groups
        for (const group of taxGroups) {
          if (!group._newId) continue;
          
          for (let i = 1; i <= 10; i++) {
            const taxName = getExcelValue(group, `${EXCEL_COLUMNS.TAX.TAX} ${i}`, `Tax ${i}`);
            const taxRate = getExcelValue(group, `${EXCEL_COLUMNS.TAX.RATE} ${i}`, `Rate ${i}`);
            
            if (taxName && taxName.trim() !== '') {
              const newTaxId = await generateNextId(db, ID_RANGES.TAX);
              
              await new Promise((resolve, reject) => {
                db.run('INSERT INTO taxes (tax_id, name, rate) VALUES (?, ?, ?)',
                  [newTaxId, taxName, parseFloat(taxRate) || 0],
                  (err) => { if (err) reject(err); else resolve(); });
              });

              await new Promise((resolve, reject) => {
                db.run('INSERT INTO tax_group_links (tax_group_id, tax_id) VALUES (?, ?)',
                  [group._newId, newTaxId],
                  (err) => { if (err) reject(err); else resolve(); });
              });
            }
          }
        }

        // Printer groups: keep existing ones (they are global, not per-menu)
        // Build name→id map from existing DB printer groups
        const printerGroupNameToId = {};
        const existingPrinterGroups = await new Promise((resolve, reject) => {
          db.all('SELECT * FROM printer_groups WHERE is_active = 1', [], (err, rows) => { if (err) reject(err); else resolve(rows || []); });
        });
        for (const pg of existingPrinterGroups) {
          printerGroupNameToId[pg.name.trim()] = pg.printer_group_id;
        }

        // Now that all groups are created, link categories to groups using category header rows
        for (const headerRow of categoryHeaderRows) {
          const categoryName = headerRow._category;
          const category = uniqueCategories.find(c => c.name === categoryName);
          if (!category) continue;

          for (let i = 1; i <= 5; i++) {
            const linkedModifierGroupName = getExcelValue(headerRow, `${EXCEL_COLUMNS.MENU.MODIFIER_GROUP} ${i}`, `Linked Modifier Group ${i}`);
            if (linkedModifierGroupName && linkedModifierGroupName.trim() !== '') {
              const newModGroupId = modGroupNameToId[linkedModifierGroupName.trim()];
              if (newModGroupId) {
                await new Promise((resolve, reject) => {
                  db.run('INSERT OR IGNORE INTO category_modifier_links (category_id, modifier_group_id, is_ambiguous) VALUES (?, ?, ?)',
                    [category.categoryId, newModGroupId, 0],
                    (err) => { if (err) reject(err); else resolve(); });
                });
              } else {
                console.warn(`Warning: Modifier group "${linkedModifierGroupName}" not found in Modifiers sheet`);
              }
            }
          }

          for (let i = 1; i <= 3; i++) {
            const linkedTaxGroupName = getExcelValue(headerRow, `${EXCEL_COLUMNS.MENU.TAX_GROUP} ${i}`, `Linked Tax Group ${i}`);
            if (linkedTaxGroupName && linkedTaxGroupName.trim() !== '') {
              const newTaxGroupId = taxGroupNameToId[linkedTaxGroupName.trim()];
              if (newTaxGroupId) {
                await new Promise((resolve, reject) => {
                  db.run('INSERT OR IGNORE INTO category_tax_links (category_id, tax_group_id) VALUES (?, ?)',
                    [category.categoryId, newTaxGroupId],
                    (err) => { if (err) reject(err); else resolve(); });
                });
              } else {
                console.warn(`Warning: Tax group "${linkedTaxGroupName}" not found in Taxes sheet`);
              }
            }
          }

          for (let i = 1; i <= 3; i++) {
            const linkedPrinterGroupName = getExcelValue(headerRow, `${EXCEL_COLUMNS.MENU.PRINTER_GROUP} ${i}`, `Linked Printer Group ${i}`);
            if (linkedPrinterGroupName && linkedPrinterGroupName.trim() !== '') {
              const printerGroupId = printerGroupNameToId[linkedPrinterGroupName.trim()];
              if (printerGroupId) {
                await new Promise((resolve, reject) => {
                  db.run('INSERT OR IGNORE INTO category_printer_links (category_id, printer_group_id) VALUES (?, ?)',
                    [category.categoryId, printerGroupId],
                    (err) => { if (err) reject(err); else resolve(); });
                });
              } else {
                console.warn(`Warning: Printer group "${linkedPrinterGroupName}" not found in DB`);
              }
            }
          }
        }

        // Now link items to groups
        for (const { newItemId, excelRow } of importedItems) {
          for (let i = 1; i <= 5; i++) {
            const linkedModifierGroupName = getExcelValue(excelRow, `${EXCEL_COLUMNS.MENU.MODIFIER_GROUP} ${i}`, `Linked Modifier Group ${i}`);
            if (linkedModifierGroupName && linkedModifierGroupName.trim() !== '') {
              const newModGroupId = modGroupNameToId[linkedModifierGroupName.trim()];
              if (newModGroupId) {
                await new Promise((resolve, reject) => {
                  db.run('INSERT OR IGNORE INTO menu_modifier_links (item_id, modifier_group_id) VALUES (?, ?)',
                    [newItemId, newModGroupId],
                    (err) => { if (err) reject(err); else resolve(); });
                });
              }
            }
          }

          for (let i = 1; i <= 3; i++) {
            const linkedTaxGroupName = getExcelValue(excelRow, `${EXCEL_COLUMNS.MENU.TAX_GROUP} ${i}`, `Linked Tax Group ${i}`);
            if (linkedTaxGroupName && linkedTaxGroupName.trim() !== '') {
              const newTaxGroupId = taxGroupNameToId[linkedTaxGroupName.trim()];
              if (newTaxGroupId) {
                await new Promise((resolve, reject) => {
                  db.run('INSERT OR IGNORE INTO menu_tax_links (item_id, tax_group_id) VALUES (?, ?)',
                    [newItemId, newTaxGroupId],
                    (err) => { if (err) reject(err); else resolve(); });
                });
              }
            }
          }

          for (let i = 1; i <= 3; i++) {
            const linkedPrinterGroupName = getExcelValue(excelRow, `${EXCEL_COLUMNS.MENU.PRINTER_GROUP} ${i}`, `Linked Printer Group ${i}`);
            if (linkedPrinterGroupName && linkedPrinterGroupName.trim() !== '') {
              const printerGroupId = printerGroupNameToId[linkedPrinterGroupName.trim()];
              if (printerGroupId) {
                await new Promise((resolve, reject) => {
                  db.run('INSERT OR IGNORE INTO menu_printer_links (item_id, printer_group_id) VALUES (?, ?)',
                    [newItemId, printerGroupId],
                    (err) => { if (err) reject(err); else resolve(); });
                });
              }
            }
          }
        }

        // Commit transaction
        await new Promise((resolve, reject) => {
          db.run('COMMIT', (err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        // Clean up uploaded file
        fs.unlinkSync(req.file.path);

        // Count individual modifiers and taxes
        let totalModifiers = 0;
        let totalTaxes = 0;
        let totalPrinters = 0;
        
        // Count modifiers from groups (support both new and legacy column names)
        for (const group of modifierGroups) {
          for (let i = 1; i <= 50; i++) {
            const modName = getExcelValue(group, `${EXCEL_COLUMNS.MODIFIER.MODIFIER} ${i}`, `Modifier ${i}`);
            if (modName && modName.trim() !== '') {
              totalModifiers++;
            }
          }
        }
        
        // Count taxes from groups
        for (const group of taxGroups) {
          for (let i = 1; i <= 10; i++) {
            const taxName = getExcelValue(group, `${EXCEL_COLUMNS.TAX.TAX} ${i}`, `Tax ${i}`);
            if (taxName && taxName.trim() !== '') {
              totalTaxes++;
            }
          }
        }
        
        // Count printers from groups
        for (const group of printerGroups) {
          for (let i = 1; i <= 30; i++) {
            const printerName = getExcelValue(group, `${EXCEL_COLUMNS.PRINTER.PRINTER} ${i}`, `Printer ${i}`);
            if (printerName && printerName.trim() !== '') {
              totalPrinters++;
            }
          }
        }
        
        // Prepare response with lost images notification
        const response = {
          success: true,
          message: 'Menu data imported from Excel successfully',
          statistics: {
            categories: uniqueCategories.length,
            items: sortedMenuData.length,
            modifierGroups: modifierGroups.length,
            modifiers: totalModifiers,
            taxGroups: taxGroups.length,
            taxes: totalTaxes,
            printerGroups: printerGroups.length,
            printers: totalPrinters
          }
        };

        // Add lost images notification if any
        if (lostImages.categories.length > 0 || lostImages.items.length > 0) {
          response.lostImages = lostImages;
          response.hasLostImages = true;
        }

        res.json(response);

      } catch (error) {
        // Rollback transaction
        await new Promise((resolve, reject) => {
          db.run('ROLLBACK', (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        throw error;
      }

    } catch (error) {
      console.error('=== IMPORT ERROR ===');
      console.error('Error type:', error.constructor.name);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      console.error('=== END IMPORT ERROR ===');
      res.status(500).json({ error: 'Failed to import menu from Excel', details: error.message });
    }
  });

  // GET /api/menu/:menuId/backups - Get list of backup files (환경 변수 BACKUPS_PATH 사용)
  router.get('/:menuId/backups', async (req, res) => {
    const { menuId } = req.params;
    
    try {
      const fs = require('fs');
      const path = require('path');
      const backupDir = process.env.BACKUPS_PATH || path.resolve('./backups');
      
      if (!fs.existsSync(backupDir)) {
        return res.json({ backups: [] });
      }
      
      const files = fs.readdirSync(backupDir);
      const backupFiles = files
        .filter(file => file.startsWith(`backup_menu_${menuId}_`) && file.endsWith('.json'))
        .map(file => {
          const filePath = path.join(backupDir, file);
          const stats = fs.statSync(filePath);
          return {
            filename: file,
            timestamp: stats.mtime,
            size: stats.size
          };
        })
        .sort((a, b) => b.timestamp - a.timestamp); // Most recent first
      
      res.json({ backups: backupFiles });
      
    } catch (error) {
      console.error('Failed to get backup list:', error);
      res.status(500).json({ error: 'Failed to get backup list', details: error.message });
    }
  });

  // GET /api/menu/:menuId/backups/:filename - Download backup file (환경 변수 BACKUPS_PATH 사용)
  router.get('/:menuId/backups/:filename', async (req, res) => {
    const { menuId, filename } = req.params;
    
    try {
      const fs = require('fs');
      const path = require('path');
      const backupDir = process.env.BACKUPS_PATH || path.resolve('./backups');
      const filePath = path.join(backupDir, filename);
      
      // Validate filename to prevent directory traversal
      if (!filename.match(/^backup_menu_\d+_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/)) {
        return res.status(400).json({ error: 'Invalid backup filename' });
      }
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Backup file not found' });
      }
      
      res.download(filePath, filename);
      
    } catch (error) {
      console.error('Failed to download backup:', error);
      res.status(500).json({ error: 'Failed to download backup', details: error.message });
    }
  });

  // POST /api/menu/:menuId/restore-backup - Restore from backup file
  router.post('/:menuId/restore-backup', upload.single('backup'), async (req, res) => {
    const { menuId } = req.params;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No backup file uploaded.' });
    }

    try {
      // Read backup file
      const backupData = JSON.parse(fs.readFileSync(req.file.path, 'utf8'));
      
      if (backupData.menuId !== parseInt(menuId)) {
        throw new Error('Backup file does not match the current menu.');
      }

      // Start transaction
      await new Promise((resolve, reject) => {
        db.run('BEGIN TRANSACTION', (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      try {
        // Clear existing data
        await new Promise((resolve, reject) => {
          db.run('DELETE FROM menu_items WHERE menu_id = ?', [menuId], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        await new Promise((resolve, reject) => {
          db.run('DELETE FROM menu_categories WHERE menu_id = ?', [menuId], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        // Restore categories
        for (const category of backupData.categories) {
          await new Promise((resolve, reject) => {
            db.run(
              'INSERT INTO menu_categories (category_id, name, menu_id, sort_order, image_url) VALUES (?, ?, ?, ?, ?)',
              [category.category_id, category.name, category.menu_id, category.sort_order, category.image_url],
              (err) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });
        }

        // Restore items
        for (const item of backupData.items) {
          await new Promise((resolve, reject) => {
            db.run(
              'INSERT INTO menu_items (item_id, name, category_id, menu_id, price, description, image_url, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
              [item.item_id, item.name, item.category_id, item.menu_id, item.price, item.description, item.image_url, item.sort_order],
              (err) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });
        }

        // Commit transaction
        await new Promise((resolve, reject) => {
          db.run('COMMIT', (err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        // Clean up uploaded file
        fs.unlinkSync(req.file.path);

        res.json({
          success: true,
          message: 'Backup restored successfully',
          statistics: {
            categories: backupData.categories.length,
            items: backupData.items.length
          }
        });

      } catch (error) {
        // Rollback transaction
        await new Promise((resolve, reject) => {
          db.run('ROLLBACK', (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        throw error;
      }

    } catch (error) {
      console.error('Backup restore failed:', error);
      res.status(500).json({ error: 'Failed to restore backup', details: error.message });
    }
  });

  // =========================================================================
  // Manager PIN Management for Open Price
  // =========================================================================

  // GET /api/menu/manager-pins - Get current manager PINs
  router.get("/manager-pins", async (req, res) => {
    try {
      const pins = (process.env.OPEN_PRICE_MANAGER_PINS || "1234,0000").split(",").map(s => s.trim());
      const approvalLimit = parseFloat(process.env.OPEN_PRICE_APPROVAL_LIMIT || "50000");
      const noteLimit = parseFloat(process.env.OPEN_PRICE_NOTE_LIMIT || "10000");
      
      res.json({
        pins: pins,
        approval_limit: approvalLimit,
        note_limit: noteLimit
      });
    } catch (error) {
      console.error("Failed to get manager pins:", error);
      res.status(500).json({ error: "Failed to get manager pins", details: error.message });
    }
  });

  // POST /api/menu/manager-pins - Update manager PINs and limits
  router.post("/manager-pins", async (req, res) => {
    try {
      const { pins, approval_limit, note_limit } = req.body;
      
      if (!Array.isArray(pins) || pins.length === 0) {
        return res.status(400).json({ error: "Valid pins array is required" });
      }

      // Enforce exactly 4-digit numeric PINs
      const normalizedPins = pins.map((p) => String(p).trim());
      const invalidPins = normalizedPins.filter((p) => !/^\d{4}$/.test(p));
      if (invalidPins.length > 0) {
        return res.status(400).json({ error: "All pins must be 4-digit numbers", invalid_pins: invalidPins });
      }
      
      if (typeof approval_limit !== "number" || approval_limit < 0) {
        return res.status(400).json({ error: "Valid approval_limit is required" });
      }
      
      if (typeof note_limit !== "number" || note_limit < 0) {
        return res.status(400).json({ error: "Valid note_limit is required" });
      }

      // Update environment variables (this will only affect the current process)
      process.env.OPEN_PRICE_MANAGER_PINS = normalizedPins.join(",");
      process.env.OPEN_PRICE_APPROVAL_LIMIT = approval_limit.toString();
      process.env.OPEN_PRICE_NOTE_LIMIT = note_limit.toString();

      // Optionally save to a config file for persistence (환경 변수 CONFIG_PATH 사용, 빌드된 앱 호환)
      const fs = require("fs");
      const path = require("path");
      const configDir = process.env.CONFIG_PATH || path.join(__dirname, "..", "config");
      const configPath = path.join(configDir, "open-price-config.json");
      
      // Ensure config directory exists
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      
      const config = {
        OPEN_PRICE_MANAGER_PINS: normalizedPins.join(","),
        OPEN_PRICE_APPROVAL_LIMIT: approval_limit.toString(),
        OPEN_PRICE_NOTE_LIMIT: note_limit.toString(),
        updated_at: new Date().toISOString()
      };
      
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      
      res.json({ 
        message: "Manager PINs updated successfully",
        pins: normalizedPins,
        approval_limit: approval_limit,
        note_limit: note_limit
      });
    } catch (error) {
      console.error("Failed to update manager pins:", error);
      res.status(500).json({ error: "Failed to update manager pins", details: error.message });
    }
  });

  // PUT /api/menus/:menuId/categories/order - 카테고리 순서 저장
  router.put('/:menuId/categories/order', async (req, res) => {
    const { menuId } = req.params;
    const { categories } = req.body;

    if (!categories || !Array.isArray(categories)) {
      return res.status(400).json({ error: 'categories array is required.' });
    }

    try {
      for (const cat of categories) {
        await new Promise((resolve, reject) => {
          db.run(
            'UPDATE menu_categories SET sort_order = ? WHERE category_id = ? AND menu_id = ?',
            [cat.sort_order, cat.category_id, menuId],
            function(err) {
              if (err) reject(err);
              else resolve(this);
            }
          );
        });
      }
      res.json({ message: 'Category order updated successfully' });
    } catch (error) {
      console.error('Failed to update category order:', error);
      res.status(500).json({ error: 'Failed to update category order', details: error.message });
    }
  });

  // PUT /api/menu/categories/:categoryId/items/order - 아이템 순서 저장
  router.put('/categories/:categoryId/items/order', async (req, res) => {
    const { categoryId } = req.params;
    const { items } = req.body;

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'items array is required.' });
    }

    try {
      for (const item of items) {
        await new Promise((resolve, reject) => {
          db.run(
            'UPDATE menu_items SET sort_order = ? WHERE item_id = ? AND category_id = ?',
            [item.sort_order, item.item_id, categoryId],
            function(err) {
              if (err) reject(err);
              else resolve(this);
            }
          );
        });
      }
      res.json({ message: 'Item order updated successfully' });
    } catch (error) {
      console.error('Failed to update item order:', error);
      res.status(500).json({ error: 'Failed to update item order', details: error.message });
    }
  });

  return router;
};






































