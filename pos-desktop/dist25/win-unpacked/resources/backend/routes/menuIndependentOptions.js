const express = require('express');
const router = express.Router();
const { generateNextId, ID_RANGES } = require('../utils/idGenerator');

module.exports = (db) => {
  // Promise-based wrappers for db methods
  const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

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

  // =========================================================================
  // 메뉴별 모디파이어 그룹 관리
  // =========================================================================

  // GET /api/menu/:menuId/modifier-groups - Get all modifier groups for a specific menu
  router.get('/:menuId/modifier-groups', async (req, res) => {
    const { menuId } = req.params;
    
    try {
      // 먼저 메뉴가 존재하는지 확인
      const menu = await dbGet('SELECT menu_id FROM menus WHERE menu_id = ?', [menuId]);
      if (!menu) {
        return res.status(404).json({ error: 'Menu not found.' });
      }

      const groups = await dbAll(`
        SELECT 
          group_id,
          name,
          selection_type,
          min_selection,
          max_selection
        FROM menu_modifier_groups 
        WHERE menu_id = ? 
        ORDER BY name
      `, [menuId]);

      // Get modifiers for each group
      const groupsWithModifiers = await Promise.all(groups.map(async (group) => {
        const modifiers = await dbAll(`
          SELECT 
            modifier_id,
            name,
            price_delta,
            sort_order
          FROM menu_modifiers 
          WHERE menu_id = ? AND group_id = ? 
          ORDER BY sort_order, name
        `, [menuId, group.group_id]);

        return {
          ...group,
          modifiers: modifiers.map(m => ({
            modifier_id: m.modifier_id,
            name: m.name,
            price_delta: m.price_delta,
            sort_order: m.sort_order
          }))
        };
      }));

      res.json(groupsWithModifiers);

    } catch (error) {
      console.error('Failed to get menu modifier groups:', error);
      res.status(500).json({ error: 'Failed to get menu modifier groups', details: error.message });
    }
  });

  // POST /api/menu/:menuId/modifier-groups - Create a new modifier group for a specific menu
  router.post('/:menuId/modifier-groups', async (req, res) => {
    const { menuId } = req.params;
    const { name, selection_type, min_selection, max_selection, modifiers } = req.body;

    if (!name || !Array.isArray(modifiers) || modifiers.length === 0) {
      return res.status(400).json({ error: 'Group name and a non-empty modifiers array are required.' });
    }

    await dbRun('BEGIN TRANSACTION');

    try {
      // Check if menu exists
      const menu = await dbGet('SELECT menu_id FROM menus WHERE menu_id = ?', [menuId]);
      if (!menu) {
        await dbRun('ROLLBACK');
        return res.status(404).json({ error: 'Menu not found.' });
      }

      // Generate new group ID
      const newGroupId = await generateNextId(db, ID_RANGES.MODIFIER_GROUP);
      
      // Create the modifier group
      await dbRun(`
        INSERT INTO menu_modifier_groups (menu_id, group_id, name, selection_type, min_selection, max_selection) 
        VALUES (?, ?, ?, ?, ?, ?)
      `, [menuId, newGroupId, name, selection_type || 'MULTIPLE', min_selection || 0, max_selection || 0]);

      // Create modifiers
      const modifierIds = [];
      for (let i = 0; i < modifiers.length; i++) {
        const modifier = modifiers[i];
        const newModifierId = await generateNextId(db, ID_RANGES.MODIFIER);
        
        await dbRun(`
          INSERT INTO menu_modifiers (menu_id, modifier_id, group_id, name, price_delta, sort_order) 
          VALUES (?, ?, ?, ?, ?, ?)
        `, [menuId, newModifierId, newGroupId, modifier.name, modifier.price_delta || 0, i + 1]);
        
        modifierIds.push(newModifierId);
      }

      await dbRun('COMMIT');

      // Return the created group
      const newGroup = {
        group_id: newGroupId,
        name,
        selection_type: selection_type || 'MULTIPLE',
        min_selection: min_selection || 0,
        max_selection: max_selection || 0,
        modifiers: modifiers.map((modifier, index) => ({
          modifier_id: modifierIds[index],
          name: modifier.name,
          price_delta: modifier.price_delta || 0,
          sort_order: index + 1
        }))
      };

      res.status(201).json(newGroup);

    } catch (error) {
      await dbRun('ROLLBACK');
      console.error('Failed to create menu modifier group:', error);
      res.status(500).json({ error: 'Failed to create menu modifier group', details: error.message });
    }
  });

  // PUT /api/menu/:menuId/modifier-groups/:groupId - Update a modifier group
  router.put('/:menuId/modifier-groups/:groupId', async (req, res) => {
    const { menuId, groupId } = req.params;
    const { name, selection_type, min_selection, max_selection, modifiers } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Group name is required.' });
    }

    await dbRun('BEGIN TRANSACTION');

    try {
      // Check if group exists
      const group = await dbGet(`
        SELECT group_id FROM menu_modifier_groups 
        WHERE menu_id = ? AND group_id = ?
      `, [menuId, groupId]);

      if (!group) {
        await dbRun('ROLLBACK');
        return res.status(404).json({ error: 'Modifier group not found.' });
      }

      // Update the group
      await dbRun(`
        UPDATE menu_modifier_groups 
        SET name = ?, selection_type = ?, min_selection = ?, max_selection = ?
        WHERE menu_id = ? AND group_id = ?
      `, [name, selection_type || 'MULTIPLE', min_selection || 0, max_selection || 0, menuId, groupId]);

      // Update modifiers if provided
      if (Array.isArray(modifiers)) {
        // Delete existing modifiers
        await dbRun('DELETE FROM menu_modifiers WHERE menu_id = ? AND group_id = ?', [menuId, groupId]);

        // Create new modifiers
        for (let i = 0; i < modifiers.length; i++) {
          const modifier = modifiers[i];
          const newModifierId = await generateNextId(db, ID_RANGES.MODIFIER);
          
          await dbRun(`
            INSERT INTO menu_modifiers (menu_id, modifier_id, group_id, name, price_delta, sort_order) 
            VALUES (?, ?, ?, ?, ?, ?)
          `, [menuId, newModifierId, groupId, modifier.name, modifier.price_delta || 0, i + 1]);
        }
      }

      await dbRun('COMMIT');

      res.json({ message: 'Modifier group updated successfully' });

    } catch (error) {
      await dbRun('ROLLBACK');
      console.error('Failed to update menu modifier group:', error);
      res.status(500).json({ error: 'Failed to update menu modifier group', details: error.message });
    }
  });

  // DELETE /api/menu/:menuId/modifier-groups/:groupId - Delete a modifier group
  router.delete('/:menuId/modifier-groups/:groupId', async (req, res) => {
    const { menuId, groupId } = req.params;

    await dbRun('BEGIN TRANSACTION');

    try {
      // Check if group exists
      const group = await dbGet(`
        SELECT group_id FROM menu_modifier_groups 
        WHERE menu_id = ? AND group_id = ?
      `, [menuId, groupId]);

      if (!group) {
        await dbRun('ROLLBACK');
        return res.status(404).json({ error: 'Modifier group not found.' });
      }

      // Delete modifiers first (due to foreign key constraint)
      await dbRun('DELETE FROM menu_modifiers WHERE menu_id = ? AND group_id = ?', [menuId, groupId]);
      
      // Delete the group
      await dbRun('DELETE FROM menu_modifier_groups WHERE menu_id = ? AND group_id = ?', [menuId, groupId]);

      await dbRun('COMMIT');

      res.json({ message: 'Modifier group deleted successfully' });

    } catch (error) {
      await dbRun('ROLLBACK');
      console.error('Failed to delete menu modifier group:', error);
      res.status(500).json({ error: 'Failed to delete menu modifier group', details: error.message });
    }
  });

  // =========================================================================
  // 메뉴별 세금 그룹 관리
  // =========================================================================

  // GET /api/menu/:menuId/tax-groups - Get all tax groups for a specific menu
  router.get('/:menuId/tax-groups', async (req, res) => {
    const { menuId } = req.params;
    
    try {
      // 먼저 메뉴가 존재하는지 확인
      const menu = await dbGet('SELECT menu_id FROM menus WHERE menu_id = ?', [menuId]);
      if (!menu) {
        return res.status(404).json({ error: 'Menu not found.' });
      }

      const groups = await dbAll(`
        SELECT 
          tax_group_id,
          name
        FROM menu_tax_groups 
        WHERE menu_id = ? 
        ORDER BY name
      `, [menuId]);

      // Get taxes for each group
      const groupsWithTaxes = await Promise.all(groups.map(async (group) => {
        const taxes = await dbAll(`
          SELECT 
            tax_id,
            name,
            rate
          FROM menu_taxes 
          WHERE menu_id = ? AND tax_group_id = ? 
          ORDER BY name
        `, [menuId, group.tax_group_id]);

        return {
          ...group,
          taxes: taxes.map(t => ({
            tax_id: t.tax_id,
            name: t.name,
            rate: t.rate
          }))
        };
      }));

      res.json(groupsWithTaxes);

    } catch (error) {
      console.error('Failed to get menu tax groups:', error);
      res.status(500).json({ error: 'Failed to get menu tax groups', details: error.message });
    }
  });

  // POST /api/menu/:menuId/tax-groups - Create a new tax group for a specific menu
  router.post('/:menuId/tax-groups', async (req, res) => {
    const { menuId } = req.params;
    const { name, taxes } = req.body;

    if (!name || !Array.isArray(taxes) || taxes.length === 0) {
      return res.status(400).json({ error: 'Group name and a non-empty taxes array are required.' });
    }

    await dbRun('BEGIN TRANSACTION');

    try {
      // Check if menu exists
      const menu = await dbGet('SELECT menu_id FROM menus WHERE menu_id = ?', [menuId]);
      if (!menu) {
        await dbRun('ROLLBACK');
        return res.status(404).json({ error: 'Menu not found.' });
      }

      // Generate new group ID
      const newGroupId = await generateNextId(db, ID_RANGES.TAX_GROUP);
      
      // Create the tax group
      await dbRun(`
        INSERT INTO menu_tax_groups (menu_id, tax_group_id, name) 
        VALUES (?, ?, ?)
      `, [menuId, newGroupId, name]);

      // Create taxes
      const taxIds = [];
      for (let i = 0; i < taxes.length; i++) {
        const tax = taxes[i];
        const newTaxId = await generateNextId(db, ID_RANGES.TAX);
        
        await dbRun(`
          INSERT INTO menu_taxes (menu_id, tax_id, tax_group_id, name, rate) 
          VALUES (?, ?, ?, ?, ?)
        `, [menuId, newTaxId, newGroupId, tax.name, tax.rate]);
        
        taxIds.push(newTaxId);
      }

      await dbRun('COMMIT');

      // Return the created group
      const newGroup = {
        tax_group_id: newGroupId,
        name,
        taxes: taxes.map((tax, index) => ({
          tax_id: taxIds[index],
          name: tax.name,
          rate: tax.rate
        }))
      };

      res.status(201).json(newGroup);

    } catch (error) {
      await dbRun('ROLLBACK');
      console.error('Failed to create menu tax group:', error);
      res.status(500).json({ error: 'Failed to create menu tax group', details: error.message });
    }
  });

  // PUT /api/menu/:menuId/tax-groups/:groupId - Update a tax group
  router.put('/:menuId/tax-groups/:groupId', async (req, res) => {
    const { menuId, groupId } = req.params;
    const { name, taxes } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Group name is required.' });
    }

    await dbRun('BEGIN TRANSACTION');

    try {
      // Check if group exists
      const group = await dbGet(`
        SELECT tax_group_id FROM menu_tax_groups 
        WHERE menu_id = ? AND tax_group_id = ?
      `, [menuId, groupId]);

      if (!group) {
        await dbRun('ROLLBACK');
        return res.status(404).json({ error: 'Tax group not found.' });
      }

      // Update the group
      await dbRun(`
        UPDATE menu_tax_groups 
        SET name = ?
        WHERE menu_id = ? AND tax_group_id = ?
      `, [name, menuId, groupId]);

      // Update taxes if provided
      if (Array.isArray(taxes)) {
        // Delete existing taxes
        await dbRun('DELETE FROM menu_taxes WHERE menu_id = ? AND tax_group_id = ?', [menuId, groupId]);

        // Create new taxes
        for (let i = 0; i < taxes.length; i++) {
          const tax = taxes[i];
          const newTaxId = await generateNextId(db, ID_RANGES.TAX);
          
          await dbRun(`
            INSERT INTO menu_taxes (menu_id, tax_id, tax_group_id, name, rate) 
            VALUES (?, ?, ?, ?, ?)
          `, [menuId, newTaxId, groupId, tax.name, tax.rate]);
        }
      }

      await dbRun('COMMIT');

      res.json({ message: 'Tax group updated successfully' });

    } catch (error) {
      await dbRun('ROLLBACK');
      console.error('Failed to update menu tax group:', error);
      res.status(500).json({ error: 'Failed to update menu tax group', details: error.message });
    }
  });

  // DELETE /api/menu/:menuId/tax-groups/:groupId - Delete a tax group
  router.delete('/:menuId/tax-groups/:groupId', async (req, res) => {
    const { menuId, groupId } = req.params;

    await dbRun('BEGIN TRANSACTION');

    try {
      // Check if group exists
      const group = await dbGet(`
        SELECT tax_group_id FROM menu_tax_groups 
        WHERE menu_id = ? AND tax_group_id = ?
      `, [menuId, groupId]);

      if (!group) {
        await dbRun('ROLLBACK');
        return res.status(404).json({ error: 'Tax group not found.' });
      }

      // Delete taxes first (due to foreign key constraint)
      await dbRun('DELETE FROM menu_taxes WHERE menu_id = ? AND tax_group_id = ?', [menuId, groupId]);
      
      // Delete the group
      await dbRun('DELETE FROM menu_tax_groups WHERE menu_id = ? AND tax_group_id = ?', [menuId, groupId]);

      await dbRun('COMMIT');

      res.json({ message: 'Tax group deleted successfully' });

    } catch (error) {
      await dbRun('ROLLBACK');
      console.error('Failed to delete menu tax group:', error);
      res.status(500).json({ error: 'Failed to delete menu tax group', details: error.message });
    }
  });

  // =========================================================================
  // 메뉴별 프린터 그룹 관리
  // =========================================================================

  // GET /api/menu/:menuId/printer-groups - Get all printer groups for a specific menu
  router.get('/:menuId/printer-groups', async (req, res) => {
    const { menuId } = req.params;
    
    try {
      // 먼저 메뉴가 존재하는지 확인
      const menu = await dbGet('SELECT menu_id FROM menus WHERE menu_id = ?', [menuId]);
      if (!menu) {
        return res.status(404).json({ error: 'Menu not found.' });
      }

      const groups = await dbAll(`
        SELECT 
          printer_group_id,
          name
        FROM menu_printer_groups 
        WHERE menu_id = ? 
        ORDER BY name
      `, [menuId]);

      // Get printers for each group
      const groupsWithPrinters = await Promise.all(groups.map(async (group) => {
        const printers = await dbAll(`
          SELECT 
            printer_id,
            name,
            type,
            ip_address
          FROM menu_printers 
          WHERE menu_id = ? AND printer_group_id = ? 
          ORDER BY name
        `, [menuId, group.printer_group_id]);

        return {
          ...group,
          printers: printers.map(p => ({
            printer_id: p.printer_id,
            name: p.name,
            type: p.type,
            ip_address: p.ip_address
          }))
        };
      }));

      res.json(groupsWithPrinters);

    } catch (error) {
      console.error('Failed to get menu printer groups:', error);
      res.status(500).json({ error: 'Failed to get menu printer groups', details: error.message });
    }
  });

  // POST /api/menu/:menuId/printer-groups - Create a new printer group for a specific menu
  router.post('/:menuId/printer-groups', async (req, res) => {
    const { menuId } = req.params;
    const { name, printers } = req.body;

    if (!name || !Array.isArray(printers) || printers.length === 0) {
      return res.status(400).json({ error: 'Group name and a non-empty printers array are required.' });
    }

    await dbRun('BEGIN TRANSACTION');

    try {
      // Check if menu exists
      const menu = await dbGet('SELECT menu_id FROM menus WHERE menu_id = ?', [menuId]);
      if (!menu) {
        await dbRun('ROLLBACK');
        return res.status(404).json({ error: 'Menu not found.' });
      }

      // Generate new group ID
      const newGroupId = await generateNextId(db, ID_RANGES.PRINTER_GROUP);
      
      // Create the printer group
      await dbRun(`
        INSERT INTO menu_printer_groups (menu_id, printer_group_id, name) 
        VALUES (?, ?, ?)
      `, [menuId, newGroupId, name]);

      // Create printers
      const printerIds = [];
      for (let i = 0; i < printers.length; i++) {
        const printer = printers[i];
        const newPrinterId = await generateNextId(db, ID_RANGES.PRINTER);
        
        await dbRun(`
          INSERT INTO menu_printers (menu_id, printer_id, printer_group_id, name, type, ip_address) 
          VALUES (?, ?, ?, ?, ?, ?)
        `, [menuId, newPrinterId, newGroupId, printer.name, printer.type, printer.ip_address || null]);
        
        printerIds.push(newPrinterId);
      }

      await dbRun('COMMIT');

      // Return the created group
      const newGroup = {
        printer_group_id: newGroupId,
        name,
        printers: printers.map((printer, index) => ({
          printer_id: printerIds[index],
          name: printer.name,
          type: printer.type,
          ip_address: printer.ip_address
        }))
      };

      res.status(201).json(newGroup);

    } catch (error) {
      await dbRun('ROLLBACK');
      console.error('Failed to create menu printer group:', error);
      res.status(500).json({ error: 'Failed to create menu printer group', details: error.message });
    }
  });

  // PUT /api/menu/:menuId/printer-groups/:groupId - Update a printer group
  router.put('/:menuId/printer-groups/:groupId', async (req, res) => {
    const { menuId, groupId } = req.params;
    const { name, printers } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Group name is required.' });
    }

    await dbRun('BEGIN TRANSACTION');

    try {
      // Check if group exists
      const group = await dbGet(`
        SELECT printer_group_id FROM menu_printer_groups 
        WHERE menu_id = ? AND printer_group_id = ?
      `, [menuId, groupId]);

      if (!group) {
        await dbRun('ROLLBACK');
        return res.status(404).json({ error: 'Printer group not found.' });
      }

      // Update the group
      await dbRun(`
        UPDATE menu_printer_groups 
        SET name = ?
        WHERE menu_id = ? AND printer_group_id = ?
      `, [name, menuId, groupId]);

      // Update printers if provided
      if (Array.isArray(printers)) {
        // Delete existing printers
        await dbRun('DELETE FROM menu_printers WHERE menu_id = ? AND printer_group_id = ?', [menuId, groupId]);

        // Create new printers
        for (let i = 0; i < printers.length; i++) {
          const printer = printers[i];
          const newPrinterId = await generateNextId(db, ID_RANGES.PRINTER);
          
          await dbRun(`
            INSERT INTO menu_printers (menu_id, printer_id, printer_group_id, name, type, ip_address) 
            VALUES (?, ?, ?, ?, ?, ?)
          `, [menuId, newPrinterId, groupId, printer.name, printer.type, printer.ip_address || null]);
        }
      }

      await dbRun('COMMIT');

      res.json({ message: 'Printer group updated successfully' });

    } catch (error) {
      await dbRun('ROLLBACK');
      console.error('Failed to update menu printer group:', error);
      res.status(500).json({ error: 'Failed to update menu printer group', details: error.message });
    }
  });

  // DELETE /api/menu/:menuId/printer-groups/:groupId - Delete a printer group
  router.delete('/:menuId/printer-groups/:groupId', async (req, res) => {
    const { menuId, groupId } = req.params;

    await dbRun('BEGIN TRANSACTION');

    try {
      // Check if group exists
      const group = await dbGet(`
        SELECT printer_group_id FROM menu_printer_groups 
        WHERE menu_id = ? AND printer_group_id = ?
      `, [menuId, groupId]);

      if (!group) {
        await dbRun('ROLLBACK');
        return res.status(404).json({ error: 'Printer group not found.' });
      }

      // Delete printers first (due to foreign key constraint)
      await dbRun('DELETE FROM menu_printers WHERE menu_id = ? AND printer_group_id = ?', [menuId, groupId]);
      
      // Delete the group
      await dbRun('DELETE FROM menu_printer_groups WHERE menu_id = ? AND printer_group_id = ?', [menuId, groupId]);

      await dbRun('COMMIT');

      res.json({ message: 'Printer group deleted successfully' });

    } catch (error) {
      await dbRun('ROLLBACK');
      console.error('Failed to delete menu printer group:', error);
      res.status(500).json({ error: 'Failed to delete menu printer group', details: error.message });
    }
  });

  // =========================================================================
  // 메뉴 아이템 옵션 연결 관리
  // =========================================================================

  // GET /api/menu/:menuId/items/:itemId/options - Get all options for a specific menu item
  router.get('/:menuId/items/:itemId/options', async (req, res) => {
    const { menuId, itemId } = req.params;
    
    try {
      // Get modifier groups
      const modifierGroups = await dbAll(`
        SELECT 
          mmg.group_id,
          mmg.name,
          mmg.selection_type,
          mmg.min_selection,
          mmg.max_selection
        FROM menu_modifier_groups mmg
        JOIN menu_item_modifier_links miml ON mmg.group_id = miml.menu_modifier_group_id
        WHERE mmg.menu_id = ? AND miml.item_id = ?
        ORDER BY mmg.name
      `, [menuId, itemId]);

      // Get tax groups
      const taxGroups = await dbAll(`
        SELECT 
          mtg.tax_group_id,
          mtg.name
        FROM menu_tax_groups mtg
        JOIN menu_item_tax_links mitl ON mtg.tax_group_id = mitl.menu_tax_group_id
        WHERE mtg.menu_id = ? AND mitl.item_id = ?
        ORDER BY mtg.name
      `, [menuId, itemId]);

      // Get printer groups
      const printerGroups = await dbAll(`
        SELECT 
          mpg.printer_group_id,
          mpg.name
        FROM menu_printer_groups mpg
        JOIN menu_item_printer_links mipl ON mpg.printer_group_id = mipl.menu_printer_group_id
        WHERE mpg.menu_id = ? AND mipl.item_id = ?
        ORDER BY mpg.name
      `, [menuId, itemId]);

      res.json({
        modifier_groups: modifierGroups,
        tax_groups: taxGroups,
        printer_groups: printerGroups
      });

    } catch (error) {
      console.error('Failed to get item options:', error);
      res.status(500).json({ error: 'Failed to get item options', details: error.message });
    }
  });

  // POST /api/menu/:menuId/items/:itemId/options/modifier - Link modifier group to item
  router.post('/:menuId/items/:itemId/options/modifier', async (req, res) => {
    const { menuId, itemId } = req.params;
    const { group_id } = req.body;

    if (!group_id) {
      return res.status(400).json({ error: 'group_id is required.' });
    }

    try {
      // Check if item exists and belongs to the menu
      const item = await dbGet(`
        SELECT item_id FROM menu_items 
        WHERE item_id = ? AND menu_id = ?
      `, [itemId, menuId]);

      if (!item) {
        return res.status(404).json({ error: 'Menu item not found.' });
      }

      // Check if modifier group exists and belongs to the menu
      const modifierGroup = await dbGet(`
        SELECT group_id FROM menu_modifier_groups 
        WHERE menu_id = ? AND group_id = ?
      `, [menuId, group_id]);

      if (!modifierGroup) {
        return res.status(404).json({ error: 'Modifier group not found.' });
      }

      // Check if link already exists
      const existingLink = await dbGet(`
        SELECT id FROM menu_item_modifier_links 
        WHERE item_id = ? AND menu_modifier_group_id = ?
      `, [itemId, group_id]);

      if (existingLink) {
        return res.status(409).json({ error: 'Modifier group is already linked to this item.' });
      }

      // Create link
      await dbRun(`
        INSERT INTO menu_item_modifier_links (item_id, menu_modifier_group_id) 
        VALUES (?, ?)
      `, [itemId, group_id]);

      res.status(201).json({ 
        message: 'Modifier group linked successfully',
        item_id: itemId,
        group_id: group_id
      });

    } catch (error) {
      console.error('Failed to link modifier group:', error);
      res.status(500).json({ error: 'Failed to link modifier group', details: error.message });
    }
  });

  // DELETE /api/menu/:menuId/items/:itemId/options/modifier/:groupId - Unlink modifier group from item
  router.delete('/:menuId/items/:itemId/options/modifier/:groupId', async (req, res) => {
    const { menuId, itemId, groupId } = req.params;

    try {
      const result = await dbRun(`
        DELETE FROM menu_item_modifier_links 
        WHERE item_id = ? AND menu_modifier_group_id = ?
      `, [itemId, groupId]);

      if (result.changes === 0) {
        return res.status(404).json({ error: 'Modifier group link not found.' });
      }

      res.json({ message: 'Modifier group unlinked successfully' });

    } catch (error) {
      console.error('Failed to unlink modifier group:', error);
      res.status(500).json({ error: 'Failed to unlink modifier group', details: error.message });
    }
  });

  return router;
}; 