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

// --- Multer Setup for Image Uploads ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../uploads/'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

module.exports = (db) => {
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
      JOIN modifier_groups mg ON mml.modifier_group_id = mg.group_id
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
    if (!name || price === undefined || !category_id || !menu_id) {
      return res.status(400).json({ error: 'name, price, category_id, and menu_id are required.' });
    }

    try {
      const newId = await generateMenuItemId(db);
      const sql = 'INSERT INTO menu_items (item_id, name, short_name, price, price2, description, category_id, menu_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
      db.run(sql, [newId, name, short_name || null, price, price2 || 0, description || '', category_id, menu_id], function(err) {
        if (err) {
          console.error("SQL Error in POST /api/menu/items:", err.message);
          return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ item_id: newId, name, short_name, price, price2: price2 || 0, description, category_id, menu_id });
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // PATCH /api/menu/items/:id
router.patch('/items/:id', (req, res) => {
    const { name, short_name, price, price2, description } = req.body;
    const { id } = req.params;

    if (!name || price === undefined) {
        return res.status(400).json({ error: 'Item name and price are required.' });
    }

    db.run('UPDATE menu_items SET name = ?, short_name = ?, price = ?, price2 = ?, description = ? WHERE item_id = ?', 
      [name, short_name || null, price, price2 || 0, description || '', id], 
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
    const { id } = req.params;
    
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
          LEFT JOIN modifier_groups mg ON mg.group_id = mml.modifier_group_id
          WHERE mml.item_id = ?
          ORDER BY mg.name
        `, [id], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      // 2. 카테고리에서 상속된 모디파이어 그룹들 (직접 연결이 없는 것만)
      const inheritedModifiers = await new Promise((resolve, reject) => {
        db.all(`
          SELECT 
            mg.group_id as modifier_group_id,
            mg.name,
            mg.selection_type,
            mg.min_selection,
            mg.max_selection,
            COALESCE(cml.is_ambiguous, 0) as is_ambiguous
          FROM modifier_groups mg
          JOIN category_modifier_links cml ON mg.group_id = cml.modifier_group_id
          JOIN menu_items mi ON cml.category_id = mi.category_id
          WHERE mi.item_id = ? 
            AND COALESCE(mg.is_deleted, 0) = 0
            AND mg.group_id NOT IN (
              SELECT modifier_group_id FROM menu_modifier_links WHERE item_id = ?
            )
          ORDER BY mg.name
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
                COALESCE(m.price_delta, 0) as price_adjustment
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

      // Get tax groups
      const taxGroups = await new Promise((resolve, reject) => {
        db.all(`
          SELECT 
            tg.id as tax_group_id,
            tg.name,
            COALESCE(mtl.is_ambiguous, 0) as is_ambiguous
          FROM tax_groups tg
          JOIN menu_tax_links mtl ON tg.id = mtl.tax_group_id
          WHERE mtl.item_id = ?
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
            pg.id as printer_group_id,
            pg.name,
            COALESCE(mpl.is_ambiguous, 0) as is_ambiguous
          FROM printer_groups pg
          JOIN menu_printer_links mpl ON pg.id = mpl.printer_group_id
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
        db.get('SELECT group_id FROM modifier_groups WHERE group_id = ?', [modifier_group_id], (err, row) => {
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

      // Create link
      const linkId = await generateModifierMenuLinkId(db);
      await new Promise((resolve, reject) => {
        db.run('INSERT INTO menu_modifier_links (link_id, item_id, modifier_group_id) VALUES (?, ?, ?)', 
          [linkId, id, modifier_group_id], function(err) {
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
        db.get('SELECT id FROM tax_groups WHERE id = ? AND is_active = 1', [tax_group_id], (err, row) => {
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

      // Create link
      const linkId = await generateTaxMenuLinkId(db);
      await new Promise((resolve, reject) => {
        db.run('INSERT INTO menu_tax_links (link_id, item_id, tax_group_id) VALUES (?, ?, ?)', 
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
        db.get('SELECT id FROM printer_groups WHERE id = ? AND is_active = 1', [printer_group_id], (err, row) => {
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

      // Create link
      const linkId = await generatePrinterMenuLinkId(db);
      await new Promise((resolve, reject) => {
        db.run('INSERT INTO menu_printer_links (link_id, item_id, printer_group_id) VALUES (?, ?, ?)', 
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
        db.all('SELECT group_id, name, selection_type, min_selection, max_selection FROM modifier_groups ORDER BY name', [], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      // Get all tax groups
      const taxGroups = await new Promise((resolve, reject) => {
        db.all('SELECT id as tax_group_id, name FROM TaxGroups WHERE is_deleted = 0 ORDER BY name', [], (err, rows) => {
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
  // 카테고리 레벨 연결 API
  // =========================================================================

  // GET /api/menu/categories/:categoryId/modifiers - Get modifiers linked to a category
  router.get('/categories/:categoryId/modifiers', async (req, res) => {
    const { categoryId } = req.params;
    
    try {
      const links = await new Promise((resolve, reject) => {
        db.all(`
          SELECT 
            cml.link_id,
            cml.category_id,
            cml.modifier_group_id,
            mg.name as group_name,
            mg.selection_type,
            mg.min_selection,
            mg.max_selection
          FROM category_modifier_links cml
          JOIN modifier_groups mg ON cml.modifier_group_id = mg.group_id
          WHERE cml.category_id = ?
          ORDER BY mg.name
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
        db.get('SELECT group_id FROM modifier_groups WHERE group_id = ?', [modifier_group_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!modifierGroup) {
        return res.status(404).json({ error: 'Modifier group not found.' });
      }

      // Check if link already exists
      const existingLink = await new Promise((resolve, reject) => {
        db.get('SELECT link_id FROM category_modifier_links WHERE category_id = ? AND modifier_group_id = ?', 
          [categoryId, modifier_group_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (existingLink) {
        return res.status(409).json({ error: 'Modifier group is already linked to this category.' });
      }

      // Create link
      const linkId = await generateCategoryModifierLinkId(db);
      await new Promise((resolve, reject) => {
        db.run('INSERT INTO category_modifier_links (link_id, category_id, modifier_group_id) VALUES (?, ?, ?)', 
          [linkId, categoryId, modifier_group_id], function(err) {
          if (err) reject(err);
          else resolve(this);
        });
      });

      // 2. 해당 카테고리의 모든 메뉴 아이템에 자동 상속
      const items = await new Promise((resolve, reject) => {
        db.all('SELECT item_id FROM base_menu_items WHERE category_id = ?', [categoryId], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      let inheritedCount = 0;
      
      for (const item of items) {
        // 이미 직접 연결된 옵션이 있는지 확인
        const existingDirectLink = await new Promise((resolve, reject) => {
          db.get('SELECT link_id FROM menu_modifier_links WHERE item_id = ? AND modifier_group_id = ?', 
            [item.item_id, modifier_group_id], (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });
        
        // 직접 연결이 없으면 상속으로 추가
        if (!existingDirectLink) {
          const itemLinkId = await generateModifierMenuLinkId(db);
          await new Promise((resolve, reject) => {
            db.run('INSERT INTO menu_modifier_links (link_id, item_id, modifier_group_id) VALUES (?, ?, ?)', 
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

      res.json({ message: 'Modifier group unlinked from category successfully' });

    } catch (error) {
      console.error('Failed to unlink modifier group from category:', error);
      res.status(500).json({ error: 'Failed to unlink modifier group from category', details: error.message });
    }
  });

  // GET /api/menu/categories/:categoryId/taxes - Get tax groups linked to a category
  router.get('/categories/:categoryId/taxes', async (req, res) => {
    const { categoryId } = req.params;
    
    try {
      const links = await new Promise((resolve, reject) => {
        db.all(`
          SELECT 
            ctl.link_id,
            ctl.category_id,
            ctl.tax_group_id,
            tg.name as group_name
          FROM category_tax_links ctl
          LEFT JOIN tax_groups tg ON ctl.tax_group_id = tg.id
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

      // Check if tax group exists
      const taxGroup = await new Promise((resolve, reject) => {
        db.get('SELECT id FROM tax_groups WHERE id = ? AND is_active = 1', [tax_group_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!taxGroup) {
        return res.status(404).json({ error: 'Tax group not found.' });
      }

      // Check if link already exists
      const existingLink = await new Promise((resolve, reject) => {
        db.get('SELECT link_id FROM category_tax_links WHERE category_id = ? AND tax_group_id = ?', 
          [categoryId, tax_group_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (existingLink) {
        return res.status(409).json({ error: 'Tax group is already linked to this category.' });
      }

            // Create link
      const linkId = await generateCategoryTaxLinkId(db);
      await new Promise((resolve, reject) => {
        db.run('INSERT INTO category_tax_links (link_id, category_id, tax_group_id) VALUES (?, ?, ?)',
          [linkId, categoryId, tax_group_id], function(err) {
          if (err) reject(err);
          else resolve(this);
        });
      });

      res.status(201).json({ 
        message: 'Tax group linked to category successfully',
        link_id: linkId,
        category_id: categoryId,
        tax_group_id: tax_group_id
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

      res.json({ message: 'Tax group unlinked from category successfully' });

    } catch (error) {
      console.error('Failed to unlink tax group from category:', error);
      res.status(500).json({ error: 'Failed to unlink tax group from category', details: error.message });
    }
  });

  // GET /api/menu/categories/:categoryId/printers - Get printers linked to a category
  router.get('/categories/:categoryId/printers', async (req, res) => {
    const { categoryId } = req.params;
    
    try {
      const links = await new Promise((resolve, reject) => {
        db.all(`
          SELECT 
            cpl.link_id,
            cpl.category_id,
            cpl.printer_group_id,
            pg.name as printer_group_name
          FROM category_printer_links cpl
          JOIN printer_groups pg ON cpl.printer_group_id = pg.id
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
        db.get('SELECT id FROM printer_groups WHERE id = ? AND is_active = 1', [printer_group_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!printerGroup) {
        return res.status(404).json({ error: 'Printer group not found.' });
      }

      // Check if link already exists
      const existingLink = await new Promise((resolve, reject) => {
        db.get('SELECT link_id FROM category_printer_links WHERE category_id = ? AND printer_group_id = ?', 
          [categoryId, printer_group_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (existingLink) {
        return res.status(409).json({ error: 'Printer group is already linked to this category.' });
      }

      // Create link
      const linkId = await generateCategoryPrinterLinkId(db);
      await new Promise((resolve, reject) => {
        db.run('INSERT INTO category_printer_links (link_id, category_id, printer_group_id) VALUES (?, ?, ?)', 
          [linkId, categoryId, printer_group_id], function(err) {
          if (err) reject(err);
          else resolve(this);
        });
      });

      res.status(201).json({ 
        message: 'Printer group linked to category successfully',
        link_id: linkId,
        category_id: categoryId,
        printer_group_id: printer_group_id
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

      const modifiers = await new Promise((resolve, reject) => {
        db.all(`
          SELECT m.*, mgl.modifier_group_id 
          FROM modifiers m 
          JOIN modifier_group_links mgl ON m.modifier_id = mgl.modifier_id 
          WHERE mgl.modifier_group_id IN (${modifierGroups.map(g => g.group_id).join(',')}) AND m.is_deleted = 0
        `, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      // Get modifier labels
      const modifierLabels = await new Promise((resolve, reject) => {
        db.all(`
          SELECT ml.* 
          FROM modifier_labels ml 
          WHERE ml.group_id IN (${modifierGroups.map(g => g.group_id).join(',')})
        `, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      // Get all tax groups and their taxes
      const taxGroups = await new Promise((resolve, reject) => {
        db.all('SELECT * FROM tax_groups WHERE menu_id = ? AND is_deleted = 0', [menuId], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      const taxes = await new Promise((resolve, reject) => {
        db.all(`
          SELECT t.*, tgl.tax_group_id 
          FROM taxes t 
          JOIN tax_group_links tgl ON t.tax_id = tgl.tax_id 
          WHERE tgl.tax_group_id IN (${taxGroups.map(g => g.group_id).join(',')}) AND t.is_deleted = 0
        `, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      // Get all printer groups and their printers
      const printerGroups = await new Promise((resolve, reject) => {
        db.all('SELECT * FROM printer_groups WHERE menu_id = ? AND is_deleted = 0', [menuId], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      const printers = await new Promise((resolve, reject) => {
        db.all(`
          SELECT p.*, pgl.printer_group_id 
          FROM printers p 
          JOIN printer_group_links pgl ON p.printer_id = pgl.printer_id 
          WHERE pgl.printer_group_id IN (${printerGroups.map(g => g.group_id).join(',')}) AND p.is_deleted = 0
        `, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

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
          .map(conn => modifierGroups.find(group => group.group_id === conn.modifier_group_id))
          .filter(Boolean);

        // Get category's connected tax groups
        const categoryConnectedTaxGroups = categoryTaxConnections
          .filter(conn => conn.category_id === category.category_id)
          .map(conn => taxGroups.find(group => group.group_id === conn.tax_group_id))
          .filter(Boolean);

        // Get category's connected printer groups
        const categoryConnectedPrinterGroups = categoryPrinterConnections
          .filter(conn => conn.category_id === category.category_id)
          .map(conn => printerGroups.find(group => group.group_id === conn.printer_group_id))
          .filter(Boolean);

        const categoryHeaderRow = {
          'No': categoryName,
          'Category Name': categoryName,
          'Item Name': '',
          'Short Name': '',
          'Price': '',
          'Description': '',
          'Linked Modifier Group 1': categoryConnectedModifierGroups.length > 0 ? categoryConnectedModifierGroups[0].name : '',
          'Linked Modifier Group 2': categoryConnectedModifierGroups.length > 1 ? categoryConnectedModifierGroups[1].name : '',
          'Linked Modifier Group 3': categoryConnectedModifierGroups.length > 2 ? categoryConnectedModifierGroups[2].name : '',
          'Linked Modifier Group 4': categoryConnectedModifierGroups.length > 3 ? categoryConnectedModifierGroups[3].name : '',
          'Linked Modifier Group 5': categoryConnectedModifierGroups.length > 4 ? categoryConnectedModifierGroups[4].name : '',
          'Linked Tax Group 1': categoryConnectedTaxGroups.length > 0 ? categoryConnectedTaxGroups[0].name : '',
          'Linked Tax Group 2': categoryConnectedTaxGroups.length > 1 ? categoryConnectedTaxGroups[1].name : '',
          'Linked Tax Group 3': categoryConnectedTaxGroups.length > 2 ? categoryConnectedTaxGroups[2].name : '',
          'Linked Printer Group 1': categoryConnectedPrinterGroups.length > 0 ? categoryConnectedPrinterGroups[0].name : '',
          'Linked Printer Group 2': categoryConnectedPrinterGroups.length > 1 ? categoryConnectedPrinterGroups[1].name : '',
          'Linked Printer Group 3': categoryConnectedPrinterGroups.length > 2 ? categoryConnectedPrinterGroups[2].name : ''
        };
        menuDataRows.push(categoryHeaderRow);
        categoryHeaderRowIndices.push(menuDataRows.length - 1); // Track the index of this header row

        for (const item of itemsByCategory[categoryName]) {
          const category = categories.find(c => c.category_id === item.category_id);

          // Get connected modifier groups for this item (direct connections first, then category connections)
          const itemConnectedModifierGroups = itemModifierConnections
            .filter(conn => conn.item_id === item.item_id)
            .map(conn => modifierGroups.find(group => group.group_id === conn.modifier_group_id))
            .filter(Boolean);

          const categoryConnectedModifierGroups = categoryModifierConnections
            .filter(conn => conn.category_id === item.category_id)
            .map(conn => modifierGroups.find(group => group.group_id === conn.modifier_group_id))
            .filter(Boolean);

          // Use item connections first, then fall back to category connections
          const finalConnectedModifierGroups = itemConnectedModifierGroups.length > 0 
            ? itemConnectedModifierGroups 
            : categoryConnectedModifierGroups;

          // Get connected tax groups for this item (direct connections first, then category connections)
          const itemConnectedTaxGroups = itemTaxConnections
            .filter(conn => conn.item_id === item.item_id)
            .map(conn => taxGroups.find(group => group.group_id === conn.tax_group_id))
            .filter(Boolean);

          const categoryConnectedTaxGroups = categoryTaxConnections
            .filter(conn => conn.category_id === item.category_id)
            .map(conn => taxGroups.find(group => group.group_id === conn.tax_group_id))
            .filter(Boolean);

          // Use item connections first, then fall back to category connections
          const finalConnectedTaxGroups = itemConnectedTaxGroups.length > 0 
            ? itemConnectedTaxGroups 
            : categoryConnectedTaxGroups;

          // Get connected printer groups for this item (direct connections first, then category connections)
          const itemConnectedPrinterGroups = itemPrinterConnections
            .filter(conn => conn.item_id === item.item_id)
            .map(conn => printerGroups.find(group => group.group_id === conn.printer_group_id))
            .filter(Boolean);

          const categoryConnectedPrinterGroups = categoryPrinterConnections
            .filter(conn => conn.category_id === item.category_id)
            .map(conn => printerGroups.find(group => group.group_id === conn.printer_group_id))
            .filter(Boolean);

          // Use item connections first, then fall back to category connections
          const finalConnectedPrinterGroups = itemConnectedPrinterGroups.length > 0 
            ? itemConnectedPrinterGroups 
            : categoryConnectedPrinterGroups;

          // Create row data for Menu Date sheet
          const row = {
            'No': rowNo++,
            'Category Name': category ? category.name : '',
            'Item Name': item.name,
            'Short Name': item.short_name || '',
            'Price': item.price,
            'Description': item.description || '',
            'Linked Modifier Group 1': finalConnectedModifierGroups.length > 0 ? finalConnectedModifierGroups[0].name : '',
            'Linked Modifier Group 2': finalConnectedModifierGroups.length > 1 ? finalConnectedModifierGroups[1].name : '',
            'Linked Modifier Group 3': finalConnectedModifierGroups.length > 2 ? finalConnectedModifierGroups[2].name : '',
            'Linked Modifier Group 4': finalConnectedModifierGroups.length > 3 ? finalConnectedModifierGroups[3].name : '',
            'Linked Modifier Group 5': finalConnectedModifierGroups.length > 4 ? finalConnectedModifierGroups[4].name : '',
            'Linked Tax Group 1': finalConnectedTaxGroups.length > 0 ? finalConnectedTaxGroups[0].name : '',
            'Linked Tax Group 2': finalConnectedTaxGroups.length > 1 ? finalConnectedTaxGroups[1].name : '',
            'Linked Tax Group 3': finalConnectedTaxGroups.length > 2 ? finalConnectedTaxGroups[2].name : '',
            'Linked Printer Group 1': finalConnectedPrinterGroups.length > 0 ? finalConnectedPrinterGroups[0].name : '',
            'Linked Printer Group 2': finalConnectedPrinterGroups.length > 1 ? finalConnectedPrinterGroups[1].name : '',
            'Linked Printer Group 3': finalConnectedPrinterGroups.length > 2 ? finalConnectedPrinterGroups[2].name : ''
          };

          menuDataRows.push(row);
        }
      }

      // Categories and Image Menu sheets are no longer needed
      // Images are managed only through the POS interface

      // Process modifier groups for Modifiers sheet
      let modifierNo = 1;
      for (const group of modifierGroups) {
        const groupModifiers = modifiersByGroup[group.group_id] || [];
        
        // Find label for this group
        const groupLabel = modifierLabels.find(label => label.group_id === group.group_id);
        
        const row = {
          'No': modifierNo++,
          'Modifier Group Name': group.name,
          'Label': groupLabel ? groupLabel.label_name : '',
          'Min': group.min_selection || 0,
          'Max': group.max_selection || 0,
          'Modifier 1': groupModifiers.length > 0 ? groupModifiers[0].name : '',
          'Price 1': groupModifiers.length > 0 ? groupModifiers[0].price_delta : '',
          'Modifier 2': groupModifiers.length > 1 ? groupModifiers[1].name : '',
          'Price 2': groupModifiers.length > 1 ? groupModifiers[1].price_delta : '',
          'Modifier 3': groupModifiers.length > 2 ? groupModifiers[2].name : '',
          'Price 3': groupModifiers.length > 2 ? groupModifiers[2].price_delta : '',
          'Modifier 4': groupModifiers.length > 3 ? groupModifiers[3].name : '',
          'Price 4': groupModifiers.length > 3 ? groupModifiers[3].price_delta : '',
          'Modifier 5': groupModifiers.length > 4 ? groupModifiers[4].name : '',
          'Price 5': groupModifiers.length > 4 ? groupModifiers[4].price_delta : '',
          'Modifier 6': groupModifiers.length > 5 ? groupModifiers[5].name : '',
          'Price 6': groupModifiers.length > 5 ? groupModifiers[5].price_delta : '',
          'Modifier 7': groupModifiers.length > 6 ? groupModifiers[6].name : '',
          'Price 7': groupModifiers.length > 6 ? groupModifiers[6].price_delta : '',
          'Modifier 8': groupModifiers.length > 7 ? groupModifiers[7].name : '',
          'Price 8': groupModifiers.length > 7 ? groupModifiers[7].price_delta : '',
          'Modifier 9': groupModifiers.length > 8 ? groupModifiers[8].name : '',
          'Price 9': groupModifiers.length > 8 ? groupModifiers[8].price_delta : '',
          'Modifier 10': groupModifiers.length > 9 ? groupModifiers[9].name : '',
          'Price 10': groupModifiers.length > 9 ? groupModifiers[9].price_delta : '',
          'Modifier 11': groupModifiers.length > 10 ? groupModifiers[10].name : '',
          'Price 11': groupModifiers.length > 10 ? groupModifiers[10].price_delta : '',
          'Modifier 12': groupModifiers.length > 11 ? groupModifiers[11].name : '',
          'Price 12': groupModifiers.length > 11 ? groupModifiers[11].price_delta : '',
          'Modifier 13': groupModifiers.length > 12 ? groupModifiers[12].name : '',
          'Price 13': groupModifiers.length > 12 ? groupModifiers[12].price_delta : '',
          'Modifier 14': groupModifiers.length > 13 ? groupModifiers[13].name : '',
          'Price 14': groupModifiers.length > 13 ? groupModifiers[13].price_delta : '',
          'Modifier 15': groupModifiers.length > 14 ? groupModifiers[14].name : '',
          'Price 15': groupModifiers.length > 14 ? groupModifiers[14].price_delta : '',
          'Modifier 16': groupModifiers.length > 15 ? groupModifiers[15].name : '',
          'Price 16': groupModifiers.length > 15 ? groupModifiers[15].price_delta : '',
          'Modifier 17': groupModifiers.length > 16 ? groupModifiers[16].name : '',
          'Price 17': groupModifiers.length > 16 ? groupModifiers[16].price_delta : '',
          'Modifier 18': groupModifiers.length > 17 ? groupModifiers[17].name : '',
          'Price 18': groupModifiers.length > 17 ? groupModifiers[17].price_delta : '',
          'Modifier 19': groupModifiers.length > 18 ? groupModifiers[18].name : '',
          'Price 19': groupModifiers.length > 18 ? groupModifiers[18].price_delta : '',
          'Modifier 20': groupModifiers.length > 19 ? groupModifiers[19].name : '',
          'Price 20': groupModifiers.length > 19 ? groupModifiers[19].price_delta : ''
        };

        modifierRows.push(row);
      }

      // Process tax groups for Taxes sheet
      let taxNo = 1;
      for (const group of taxGroups) {
        const groupTaxes = taxesByGroup[group.group_id] || [];
        
        const row = {
          'No': taxNo++,
          'Tax Group Name': group.name,
          'Tax 1': groupTaxes.length > 0 ? groupTaxes[0].name : '',
          'Rate 1': groupTaxes.length > 0 ? groupTaxes[0].rate : '',
          'Tax 2': groupTaxes.length > 1 ? groupTaxes[1].name : '',
          'Rate 2': groupTaxes.length > 1 ? groupTaxes[1].rate : '',
          'Tax 3': groupTaxes.length > 2 ? groupTaxes[2].name : '',
          'Rate 3': groupTaxes.length > 2 ? groupTaxes[2].rate : '',
          'Tax 4': groupTaxes.length > 3 ? groupTaxes[3].name : '',
          'Rate 4': groupTaxes.length > 3 ? groupTaxes[3].rate : '',
          'Tax 5': groupTaxes.length > 4 ? groupTaxes[4].name : '',
          'Rate 5': groupTaxes.length > 4 ? groupTaxes[4].rate : '',
          'Tax 6': groupTaxes.length > 5 ? groupTaxes[5].name : '',
          'Rate 6': groupTaxes.length > 5 ? groupTaxes[5].rate : '',
          'Tax 7': groupTaxes.length > 6 ? groupTaxes[6].name : '',
          'Rate 7': groupTaxes.length > 6 ? groupTaxes[6].rate : '',
          'Tax 8': groupTaxes.length > 7 ? groupTaxes[7].name : '',
          'Rate 8': groupTaxes.length > 7 ? groupTaxes[7].rate : '',
          'Tax 9': groupTaxes.length > 8 ? groupTaxes[8].name : '',
          'Rate 9': groupTaxes.length > 8 ? groupTaxes[8].rate : '',
          'Tax 10': groupTaxes.length > 9 ? groupTaxes[9].name : '',
          'Rate 10': groupTaxes.length > 9 ? groupTaxes[9].rate : ''
        };

        taxRows.push(row);
      }

      // Process printer groups for Printers sheet
      let printerNo = 1;
      for (const group of printerGroups) {
        const groupPrinters = printersByGroup[group.group_id] || [];
        
        const row = {
          'No': printerNo++,
          'Printer Group Name': group.name,
          'Kitchen Type': group.printer_type || '',
          'Printer 1': groupPrinters.length > 0 ? groupPrinters[0].name : '',
          'Printer 2': groupPrinters.length > 1 ? groupPrinters[1].name : '',
          'Printer 3': groupPrinters.length > 2 ? groupPrinters[2].name : '',
          'Printer 4': groupPrinters.length > 3 ? groupPrinters[3].name : '',
          'Printer 5': groupPrinters.length > 4 ? groupPrinters[4].name : '',
          'Printer 6': groupPrinters.length > 5 ? groupPrinters[5].name : '',
          'Printer 7': groupPrinters.length > 6 ? groupPrinters[6].name : '',
          'Printer 8': groupPrinters.length > 7 ? groupPrinters[7].name : '',
          'Printer 9': groupPrinters.length > 8 ? groupPrinters[8].name : '',
          'Printer 10': groupPrinters.length > 9 ? groupPrinters[9].name : '',
          'Printer 11': groupPrinters.length > 10 ? groupPrinters[10].name : '',
          'Printer 12': groupPrinters.length > 11 ? groupPrinters[11].name : '',
          'Printer 13': groupPrinters.length > 12 ? groupPrinters[12].name : '',
          'Printer 14': groupPrinters.length > 13 ? groupPrinters[13].name : '',
          'Printer 15': groupPrinters.length > 14 ? groupPrinters[14].name : '',
          'Printer 16': groupPrinters.length > 15 ? groupPrinters[15].name : '',
          'Printer 17': groupPrinters.length > 16 ? groupPrinters[16].name : '',
          'Printer 18': groupPrinters.length > 17 ? groupPrinters[17].name : '',
          'Printer 19': groupPrinters.length > 18 ? groupPrinters[18].name : '',
          'Printer 20': groupPrinters.length > 19 ? groupPrinters[19].name : '',
          'Printer 21': groupPrinters.length > 20 ? groupPrinters[20].name : '',
          'Printer 22': groupPrinters.length > 21 ? groupPrinters[21].name : '',
          'Printer 23': groupPrinters.length > 22 ? groupPrinters[22].name : '',
          'Printer 24': groupPrinters.length > 23 ? groupPrinters[23].name : '',
          'Printer 25': groupPrinters.length > 24 ? groupPrinters[24].name : '',
          'Printer 26': groupPrinters.length > 25 ? groupPrinters[25].name : '',
          'Printer 27': groupPrinters.length > 26 ? groupPrinters[26].name : '',
          'Printer 28': groupPrinters.length > 27 ? groupPrinters[27].name : '',
          'Printer 29': groupPrinters.length > 28 ? groupPrinters[28].name : '',
          'Printer 30': groupPrinters.length > 29 ? groupPrinters[29].name : ''
        };

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
      res.setHeader('Content-Disposition', `attachment; filename=${menu.name || 'Menu'}.xlsx`);

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
      
      const modifierGroups = XLSX.utils.sheet_to_json(workbook.Sheets['Modifiers'] || {});
      const taxGroups = XLSX.utils.sheet_to_json(workbook.Sheets['Taxes'] || {});
      const printerGroups = XLSX.utils.sheet_to_json(workbook.Sheets['Printers'] || {});
      
      console.log('Modifiers sheet rows:', modifierGroups.length);
      console.log('Taxes sheet rows:', taxGroups.length);
      console.log('Printers sheet rows:', printerGroups.length);

      // Validate data
      if (!menuData.length) {
        throw new Error('Invalid Excel file format. Menu Date sheet is required.');
      }

              // Filter out category header rows (rows where Item Name is empty and No is not numeric)
        const filteredMenuData = menuData.filter(item => 
          item['Item Name'] && item['Item Name'].trim() !== '' && 
          !isNaN(parseInt(item['No']))
        );
      
      if (!filteredMenuData.length) {
        throw new Error('No valid menu items found in Menu Date sheet');
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

        // Generate backup filename
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFilename = `backup_menu_${menuId}_${timestamp}.json`;
        const backupPath = `./backups/${backupFilename}`;

        // Ensure backups directory exists
        const fs = require('fs');
        const path = require('path');
        const backupDir = path.dirname(backupPath);
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

        // Clear existing data (optional - you might want to merge instead)
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
          const categoryName = item['Category Name'];
          if (categoryName && !categorySet.has(categoryName)) {
            categorySet.add(categoryName);
            uniqueCategories.push({
              name: categoryName,
              firstNumber: item['No']
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
          const categoryA = uniqueCategories.find(c => c.name === a['Category Name']);
          const categoryB = uniqueCategories.find(c => c.name === b['Category Name']);
          
          if (categoryA && categoryB) {
            if (categoryA.firstNumber !== categoryB.firstNumber) {
              return categoryA.firstNumber - categoryB.firstNumber;
            }
          }
          
          return parseInt(a['No']) - parseInt(b['No']);
        });

        // Process category-group connections after all categories are created
        for (const item of sortedMenuDataForImport) {
          const categoryName = item['Category Name'];
          const itemId = item['No'];

          // Find the category ID
          const category = uniqueCategories.find(c => c.name === categoryName);
          if (!category) continue;

          // Link modifier groups to category (if not already linked to item)
          for (let i = 1; i <= 5; i++) {
            const linkedModifierGroup = item[`Linked Modifier Group ${i}`];
            if (linkedModifierGroup && linkedModifierGroup.trim() !== '') {
              // Check for duplicate group names
              const matchingGroups = modifierGroups.filter(g => 
                g['Group Name'] && g['Group Name'].trim().toLowerCase() === linkedModifierGroup.trim().toLowerCase()
              );
              
              if (matchingGroups.length > 1) {
                // Multiple groups with same name - mark as ambiguous
                console.warn(`Warning: Multiple modifier groups found with name "${linkedModifierGroup}". Using first one.`);
                const modifierGroup = matchingGroups[0];
                
                // Store with special flag for ambiguous connection
                await new Promise((resolve, reject) => {
                  db.run(
                    'INSERT INTO category_modifier_links (category_id, modifier_group_id, is_ambiguous) VALUES (?, ?, ?)',
                    [category.name, modifierGroup['Group ID'], 1],
                    (err) => {
                      if (err) reject(err);
                      else resolve();
                    }
                  );
                });
              } else if (matchingGroups.length === 1) {
                const modifierGroup = matchingGroups[0];
                // Check if this group is already linked to the item
                const isLinkedToItem = sortedMenuDataForImport.some(menuItem => 
                  menuItem['No'] === itemId && 
                  menuItem[`Linked Modifier Group ${i}`] === linkedModifierGroup
                );

                if (!isLinkedToItem) {
                  // Link to category instead
                  await new Promise((resolve, reject) => {
                    db.run(
                      'INSERT INTO category_modifier_links (category_id, modifier_group_id, is_ambiguous) VALUES (?, ?, ?)',
                      [category.name, modifierGroup['Group ID'], 0],
                      (err) => {
                        if (err) reject(err);
                        else resolve();
                      }
                    );
                  });
                }
              } else {
                console.warn(`Warning: Modifier group "${linkedModifierGroup}" not found in Modifiers sheet for category linking`);
              }
            }
          }

          // Link tax groups to category (if not already linked to item)
          for (let i = 1; i <= 3; i++) {
            const linkedTaxGroup = item[`Linked Tax Group ${i}`];
            if (linkedTaxGroup && linkedTaxGroup.trim() !== '') {
              const taxGroup = taxGroups.find(g => 
                g['Group Name'] && g['Group Name'].trim().toLowerCase() === linkedTaxGroup.trim().toLowerCase()
              );
              if (taxGroup) {
                // Check if this group is already linked to the item
                const isLinkedToItem = sortedMenuDataForImport.some(menuItem => 
                  menuItem['No'] === itemId && 
                  menuItem[`Linked Tax Group ${i}`] === linkedTaxGroup
                );

                if (!isLinkedToItem) {
                  // Link to category instead
                  await new Promise((resolve, reject) => {
                    db.run(
                      'INSERT INTO category_tax_links (category_id, tax_group_id) VALUES (?, ?)',
                      [category.name, taxGroup['Group ID']],
                      (err) => {
                        if (err) reject(err);
                        else resolve();
                      }
                    );
                  });
                }
              } else {
                console.warn(`Warning: Tax group "${linkedTaxGroup}" not found in Taxes sheet for category linking`);
              }
            }
          }

          // Link printer groups to category (if not already linked to item)
          for (let i = 1; i <= 3; i++) {
            const linkedPrinterGroup = item[`Linked Printer Group ${i}`];
            if (linkedPrinterGroup && linkedPrinterGroup.trim() !== '') {
              const printerGroup = printerGroups.find(g => 
                g['Group Name'] && g['Group Name'].trim().toLowerCase() === linkedPrinterGroup.trim().toLowerCase()
              );
              if (printerGroup) {
                // Check if this group is already linked to the item
                const isLinkedToItem = sortedMenuDataForImport.some(menuItem => 
                  menuItem['No'] === itemId && 
                  menuItem[`Linked Printer Group ${i}`] === linkedPrinterGroup
                );

                if (!isLinkedToItem) {
                  // Link to category instead
                  await new Promise((resolve, reject) => {
                    db.run(
                      'INSERT INTO category_printer_links (category_id, printer_group_id) VALUES (?, ?)',
                      [category.name, printerGroup['Group ID']],
                      (err) => {
                        if (err) reject(err);
                        else resolve();
                      }
                    );
                  });
                }
              } else {
                console.warn(`Warning: Printer group "${linkedPrinterGroup}" not found in Printers sheet for category linking`);
              }
            }
          }
        }

        // Validate and fix No field issues
        const noValidationErrors = [];
        const duplicateNos = new Set();
        const usedNos = new Set();
        let maxNo = 0;

        // 1. Check for missing or invalid No values
        for (let i = 0; i < filteredMenuData.length; i++) {
          const item = filteredMenuData[i];
          const no = item['No'];
          
          // Check if No is missing, null, undefined, or empty string
          if (!no || no === '' || no === null || no === undefined) {
            noValidationErrors.push(`Row ${i + 2}: Missing No value for item "${item['Item Name']}"`);
            // Assign a temporary negative number for now
            item['No'] = -(i + 1);
          }
          
          // Check if No is a valid number
          const noNum = parseInt(no);
          if (isNaN(noNum)) {
            noValidationErrors.push(`Row ${i + 2}: Invalid No value "${no}" for item "${item['Item Name']}" - must be a number`);
            // Assign a temporary negative number
            item['No'] = -(i + 1);
          } else {
            item['No'] = noNum;
            maxNo = Math.max(maxNo, noNum);
          }
        }

        // 2. Check for duplicate No values
        for (let i = 0; i < filteredMenuData.length; i++) {
          const item = filteredMenuData[i];
          const no = item['No'];
          
          if (usedNos.has(no)) {
            duplicateNos.add(no);
            noValidationErrors.push(`Row ${i + 2}: Duplicate No value ${no} for item "${item['Item Name']}"`);
          } else {
            usedNos.add(no);
          }
        }

        // 3. Fix duplicate No values by reassigning
        if (duplicateNos.size > 0) {
          console.log('Fixing duplicate No values...');
          for (let i = 0; i < filteredMenuData.length; i++) {
            const item = filteredMenuData[i];
            if (duplicateNos.has(item['No'])) {
              // Find next available number
              let newNo = maxNo + 1;
              while (usedNos.has(newNo)) {
                newNo++;
              }
              console.log(`Reassigning No for "${item['Item Name']}" from ${item['No']} to ${newNo}`);
              item['No'] = newNo;
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
          const categoryName = item['Category Name'];
          if (!categoryFirstNumbers[categoryName]) {
            categoryFirstNumbers[categoryName] = item['No'];
          }
        }

        // Sort categories by their first number
        const sortedCategoryNames = Object.entries(categoryFirstNumbers)
          .sort(([,a], [,b]) => a - b)
          .map(([name]) => name);

        // Group items by category and sort within each category
        const itemsByCategoryForImport = {};
        for (const item of filteredMenuData) {
          const categoryName = item['Category Name'];
          if (!itemsByCategoryForImport[categoryName]) {
            itemsByCategoryForImport[categoryName] = [];
          }
          itemsByCategoryForImport[categoryName].push(item);
        }

        // Sort items within each category by No
        for (const categoryName in itemsByCategoryForImport) {
          itemsByCategoryForImport[categoryName].sort((a, b) => a['No'] - b['No']);
        }

        // Create sorted menu data: categories in order, then items within each category
        const sortedMenuData = [];
        for (const categoryName of sortedCategoryNames) {
          const categoryItems = itemsByCategoryForImport[categoryName] || [];
          sortedMenuData.push(...categoryItems);
        }

        // Import items
        for (const item of sortedMenuDataForImport) {
          const newItemId = await generateMenuItemId(db);
          const categoryId = uniqueCategories.find(c => c.name === item['Category Name'])?.categoryId;
          
          await new Promise((resolve, reject) => {
            db.run(
              'INSERT INTO menu_items (item_id, name, category_id, menu_id, price, description, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
              [
                newItemId,
                item['Item Name'],
                categoryId,
                parseInt(menuId),
                parseFloat(item['Price']) || 0,
                item['Description'] || '',
                parseInt(item['No']) || 0
              ],
              (err) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });

          // Process linked groups for this item
          const itemId = item['No'];
          const categoryName = item['Category Name'];

          // Link modifier groups (explicit + inherited from category)
          const linkedModifierGroups = [];
          
          // 1. Check explicit links from Excel
          for (let i = 1; i <= 5; i++) {
            const linkedModifierGroup = item[`Linked Modifier Group ${i}`];
            if (linkedModifierGroup && linkedModifierGroup.trim() !== '') {
              linkedModifierGroups.push(linkedModifierGroup.trim());
            }
          }

          // 2. If no explicit links, inherit from category
          if (linkedModifierGroups.length === 0) {
            // Get category's linked modifier groups
            const categoryModifierGroups = await new Promise((resolve, reject) => {
              db.all(
                'SELECT mg.name FROM modifier_groups mg JOIN category_modifier_links cml ON mg.group_id = cml.modifier_group_id WHERE cml.category_id = ?',
                [categoryName],
                (err, rows) => {
                  if (err) reject(err);
                  else resolve(rows.map(row => row.name));
                }
              );
            });
            linkedModifierGroups.push(...categoryModifierGroups);
          }

          // 3. Apply all linked groups
          for (const groupName of linkedModifierGroups) {
            const modifierGroup = modifierGroups.find(g => 
              g['Group Name'] && g['Group Name'].trim().toLowerCase() === groupName.toLowerCase()
            );
            if (modifierGroup) {
              // Check if link already exists
              const existingLink = await new Promise((resolve, reject) => {
                db.get(
                  'SELECT 1 FROM menu_modifier_links WHERE item_id = ? AND modifier_group_id = ?',
                  [itemId, modifierGroup['Group ID']],
                  (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                  }
                );
              });
              
              if (!existingLink) {
                await new Promise((resolve, reject) => {
                  db.run(
                    'INSERT INTO menu_modifier_links (item_id, modifier_group_id) VALUES (?, ?)',
                    [itemId, modifierGroup['Group ID']],
                    (err) => {
                      if (err) reject(err);
                      else resolve();
                    }
                  );
                });
              }
            } else {
              console.warn(`Warning: Modifier group "${groupName}" not found in Modifiers sheet`);
              // Store invalid link in a separate table or use existing structure
              const existingInvalidLink = await new Promise((resolve, reject) => {
                db.get(
                  'SELECT 1 FROM menu_modifier_links WHERE item_id = ? AND modifier_group_id = ?',
                  [itemId, -1],
                  (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                  }
                );
              });
              
              if (!existingInvalidLink) {
                await new Promise((resolve, reject) => {
                  db.run(
                    'INSERT INTO menu_modifier_links (item_id, modifier_group_id) VALUES (?, ?)',
                    [itemId, -1], // -1 indicates invalid group
                    (err) => {
                      if (err) reject(err);
                      else resolve();
                    }
                  );
                });
              }
            }
          }

          // Link tax groups (explicit + inherited from category)
          const linkedTaxGroups = [];
          
          // 1. Check explicit links from Excel
          for (let i = 1; i <= 3; i++) {
            const linkedTaxGroup = item[`Linked Tax Group ${i}`];
            if (linkedTaxGroup && linkedTaxGroup.trim() !== '') {
              linkedTaxGroups.push(linkedTaxGroup.trim());
            }
          }

          // 2. If no explicit links, inherit from category
          if (linkedTaxGroups.length === 0) {
            // Get category's linked tax groups
            const categoryTaxGroups = await new Promise((resolve, reject) => {
              db.all(
                'SELECT tg.name FROM tax_groups tg JOIN category_tax_links ctl ON tg.id = ctl.tax_group_id WHERE ctl.category_id = ?',
                [categoryName],
                (err, rows) => {
                  if (err) reject(err);
                  else resolve(rows.map(row => row.name));
                }
              );
            });
            linkedTaxGroups.push(...categoryTaxGroups);
          }

          // 3. Apply all linked groups
          for (const groupName of linkedTaxGroups) {
            const taxGroup = taxGroups.find(g => 
              g['Group Name'] && g['Group Name'].trim().toLowerCase() === groupName.toLowerCase()
            );
            if (taxGroup) {
              // Check if link already exists
              const existingLink = await new Promise((resolve, reject) => {
                db.get(
                  'SELECT 1 FROM menu_tax_links WHERE item_id = ? AND tax_group_id = ?',
                  [itemId, taxGroup['Group ID']],
                  (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                  }
                );
              });
              
              if (!existingLink) {
                await new Promise((resolve, reject) => {
                  db.run(
                    'INSERT INTO menu_tax_links (item_id, tax_group_id) VALUES (?, ?)',
                    [itemId, taxGroup['Group ID']],
                    (err) => {
                      if (err) reject(err);
                      else resolve();
                    }
                  );
                });
              }
            } else {
              console.warn(`Warning: Tax group "${groupName}" not found in Taxes sheet`);
            }
          }

          // Link printer groups (explicit + inherited from category)
          const linkedPrinterGroups = [];
          
          // 1. Check explicit links from Excel
          for (let i = 1; i <= 3; i++) {
            const linkedPrinterGroup = item[`Linked Printer Group ${i}`];
            if (linkedPrinterGroup && linkedPrinterGroup.trim() !== '') {
              linkedPrinterGroups.push(linkedPrinterGroup.trim());
            }
          }

          // 2. If no explicit links, inherit from category
          if (linkedPrinterGroups.length === 0) {
            // Get category's linked printer groups
            const categoryPrinterGroups = await new Promise((resolve, reject) => {
              db.all(
                'SELECT pg.name FROM printer_groups pg JOIN category_printer_links cpl ON pg.id = cpl.printer_group_id WHERE cpl.category_id = ?',
                [categoryName],
                (err, rows) => {
                  if (err) reject(err);
                  else resolve(rows.map(row => row.name));
                }
              );
            });
            linkedPrinterGroups.push(...categoryPrinterGroups);
          }

          // 3. Apply all linked groups
          for (const groupName of linkedPrinterGroups) {
            const printerGroup = printerGroups.find(g => 
              g['Group Name'] && g['Group Name'].trim().toLowerCase() === groupName.toLowerCase()
            );
            if (printerGroup) {
              // Check if link already exists
              const existingLink = await new Promise((resolve, reject) => {
                db.get(
                  'SELECT 1 FROM menu_printer_links WHERE item_id = ? AND printer_group_id = ?',
                  [itemId, printerGroup['Group ID']],
                  (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                  }
                );
              });
              
              if (!existingLink) {
                await new Promise((resolve, reject) => {
                  db.run(
                    'INSERT INTO menu_printer_links (item_id, printer_group_id) VALUES (?, ?)',
                    [itemId, printerGroup['Group ID']],
                    (err) => {
                      if (err) reject(err);
                      else resolve();
                    }
                  );
                });
              }
            } else {
              console.warn(`Warning: Printer group "${groupName}" not found in Printers sheet`);
            }
          }
        }

        // Import modifier groups
        for (const group of modifierGroups) {
          console.log('Processing modifier group:', group);
          
          // Check if required fields exist
          if (!group['Modifier Group Name']) {
            console.warn('Skipping modifier group - missing name:', group);
            continue;
          }
          
          await new Promise((resolve, reject) => {
            db.run(
              'INSERT INTO modifier_groups (group_id, name, selection_type, min_selection, max_selection, menu_id) VALUES (?, ?, ?, ?, ?, ?)',
              [
                group['No'] || 0,
                group['Modifier Group Name'],
                group['Selection Type'] || 'single',
                group['Min'] || 0,
                group['Max'] || 1,
                menuId
              ],
              (err) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });
        }

        // Import modifiers from modifier groups
        for (const group of modifierGroups) {
          console.log('Processing modifiers for group:', group['Modifier Group Name']);
          
          // Process each modifier in the group
          for (let i = 1; i <= 20; i++) {
            const modifierName = group[`Modifier ${i}`];
            const modifierPrice = group[`Price ${i}`];
            
            if (modifierName && modifierName.trim() !== '') {
              console.log(`Processing modifier: ${modifierName} (Price: ${modifierPrice})`);
              
              const newModifierId = await generateNextId(db, ID_RANGES.MODIFIER);
              
              await new Promise((resolve, reject) => {
                db.run(
                  'INSERT INTO modifiers (modifier_id, name, price_delta) VALUES (?, ?, ?)',
                  [newModifierId, modifierName, modifierPrice || 0],
                  (err) => {
                    if (err) reject(err);
                    else resolve();
                  }
                );
              });

              // Link modifier to group
              await new Promise((resolve, reject) => {
                db.run(
                  'INSERT INTO modifier_group_links (modifier_group_id, modifier_id) VALUES (?, ?)',
                  [group['No'], newModifierId],
                  (err) => {
                    if (err) reject(err);
                    else resolve();
                  }
                );
              });
            }
          }
        }

        // Import tax groups
        for (const group of taxGroups) {
          console.log('Processing tax group:', group);
          
          // Check if required fields exist
          if (!group['Tax Group Name']) {
            console.warn('Skipping tax group - missing name:', group);
            continue;
          }
          
          await new Promise((resolve, reject) => {
            db.run(
              'INSERT INTO tax_groups (group_id, name, menu_id) VALUES (?, ?, ?)',
              [group['No'] || 0, group['Tax Group Name'], menuId],
              (err) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });
        }

        // Import taxes from tax groups
        for (const group of taxGroups) {
          console.log('Processing taxes for group:', group['Tax Group Name']);
          
          // Process each tax in the group
          for (let i = 1; i <= 10; i++) {
            const taxName = group[`Tax ${i}`];
            const taxRate = group[`Rate ${i}`];
            
            if (taxName && taxName.trim() !== '') {
              console.log(`Processing tax: ${taxName} (Rate: ${taxRate})`);
              
              const newTaxId = await generateNextId(db, ID_RANGES.TAX);
              
              await new Promise((resolve, reject) => {
                db.run(
                  'INSERT INTO taxes (tax_id, name, rate) VALUES (?, ?, ?)',
                  [newTaxId, taxName, taxRate || 0],
                  (err) => {
                    if (err) reject(err);
                    else resolve();
                  }
                );
              });

              // Link tax to group
              await new Promise((resolve, reject) => {
                db.run(
                  'INSERT INTO tax_group_links (tax_group_id, tax_id) VALUES (?, ?)',
                  [group['No'], newTaxId],
                  (err) => {
                    if (err) reject(err);
                    else resolve();
                  }
                );
              });
            }
          }
        }

        // Import printer groups
        for (const group of printerGroups) {
          console.log('Processing printer group:', group);
          
          // Check if required fields exist
          if (!group['Printer Group Name']) {
            console.warn('Skipping printer group - missing name:', group);
            continue;
          }
          
          await new Promise((resolve, reject) => {
            db.run(
              'INSERT INTO printer_groups (group_id, name, printer_type, menu_id) VALUES (?, ?, ?, ?)',
              [group['No'] || 0, group['Printer Group Name'], group['Kitchen Type'] || 'ORDER', menuId],
              (err) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });
        }

        // Import printers from printer groups
        for (const group of printerGroups) {
          console.log('Processing printers for group:', group['Printer Group Name']);
          
          // Process each printer in the group
          for (let i = 1; i <= 30; i++) {
            const printerName = group[`Printer ${i}`];
            
            if (printerName && printerName.trim() !== '') {
              console.log(`Processing printer: ${printerName}`);
              
              const newPrinterId = await generateNextId(db, ID_RANGES.PRINTER);
              
              await new Promise((resolve, reject) => {
                db.run(
                  'INSERT INTO printers (printer_id, name, printer_type) VALUES (?, ?, ?)',
                  [newPrinterId, printerName, group['Kitchen Type'] || 'ORDER'],
                  (err) => {
                    if (err) reject(err);
                    else resolve();
                  }
                );
              });

              // Link printer to group
              await new Promise((resolve, reject) => {
                db.run(
                  'INSERT INTO printer_group_links (printer_group_id, printer_id) VALUES (?, ?)',
                  [group['No'], newPrinterId],
                  (err) => {
                    if (err) reject(err);
                    else resolve();
                  }
                );
              });
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
        
        // Count modifiers from groups
        for (const group of modifierGroups) {
          for (let i = 1; i <= 20; i++) {
            if (group[`Modifier ${i}`] && group[`Modifier ${i}`].trim() !== '') {
              totalModifiers++;
            }
          }
        }
        
        // Count taxes from groups
        for (const group of taxGroups) {
          for (let i = 1; i <= 10; i++) {
            if (group[`Tax ${i}`] && group[`Tax ${i}`].trim() !== '') {
              totalTaxes++;
            }
          }
        }
        
        // Count printers from groups
        for (const group of printerGroups) {
          for (let i = 1; i <= 30; i++) {
            if (group[`Printer ${i}`] && group[`Printer ${i}`].trim() !== '') {
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

  // GET /api/menu/:menuId/backups - Get list of backup files
  router.get('/:menuId/backups', async (req, res) => {
    const { menuId } = req.params;
    
    try {
      const fs = require('fs');
      const path = require('path');
      const backupDir = './backups';
      
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

  // GET /api/menu/:menuId/backups/:filename - Download backup file
  router.get('/:menuId/backups/:filename', async (req, res) => {
    const { menuId, filename } = req.params;
    
    try {
      const fs = require('fs');
      const path = require('path');
      const backupDir = './backups';
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

      // Optionally save to a config file for persistence
      const fs = require("fs");
      const path = require("path");
      const configPath = path.join(__dirname, "..", "config", "open-price-config.json");
      
      // Ensure config directory exists
      const configDir = path.dirname(configPath);
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


