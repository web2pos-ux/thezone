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

  // GET /api/tax-groups - Get all tax groups with their individual taxes
  router.get('/', async (req, res) => {
    try {
      const { menu_id } = req.query;
      let groups;
      
      if (menu_id) {
        // Filter by menu_id if provided
        groups = await dbAll('SELECT group_id as id, name FROM tax_groups WHERE is_deleted = 0 AND menu_id = ?', [menu_id]);
      } else {
        // Get all groups if no menu_id specified
        groups = await dbAll('SELECT group_id as id, name FROM tax_groups WHERE is_deleted = 0');
      }
      
      const groupIds = groups.map(g => g.id);

      if (groupIds.length === 0) {
        return res.json([]);
      }

      const taxes = await dbAll(`
        SELECT
          TGI.tax_group_id,
          T.tax_id as tax_id,
          T.name,
          T.rate
        FROM taxes T
        JOIN tax_group_links TGI ON T.tax_id = TGI.tax_id
        WHERE TGI.tax_group_id IN (${groupIds.map(() => '?').join(',')}) AND T.is_deleted = 0
        ORDER BY TGI.tax_group_id, T.name
      `, groupIds);

      const taxesByGroupId = taxes.reduce((acc, tax) => {
        if (!acc[tax.tax_group_id]) {
          acc[tax.tax_group_id] = [];
        }
        acc[tax.tax_group_id].push({ tax_id: tax.tax_id, name: tax.name, rate: tax.rate });
        return acc;
      }, {});

      const result = groups.map(group => ({
        id: group.id,
        name: group.name,
        taxes: taxesByGroupId[group.id] || []
      }));

      res.json(result);

    } catch (error) {
      console.error('Failed to retrieve tax groups:', error);
      res.status(500).json({ error: 'Failed to retrieve tax groups', details: error.message });
    }
  });

  // GET /api/tax-groups/by-ids?ids=1,2,3&menu_id=200001
  // Returns taxes for given tax_group_ids. Resolves from standard tax tables first; if not found, falls back to menu-independent tables.
  router.get('/by-ids', async (req, res) => {
    try {
      const idsParam = (req.query.ids || '').toString().trim();
      const menuId = req.query.menu_id ? Number(req.query.menu_id) : null;
      if (!idsParam) {
        return res.json([]);
      }
      const rawIds = idsParam.split(',').map(s => s.trim()).filter(Boolean);
      const groupIds = rawIds.map(id => Number(id)).filter(n => !Number.isNaN(n));
      if (groupIds.length === 0) {
        return res.json([]);
      }

      // Standard tax groups lookup
      const standardTaxes = await dbAll(`
        SELECT TGI.tax_group_id, T.tax_id, T.name, T.rate
        FROM taxes T
        JOIN tax_group_links TGI ON T.tax_id = TGI.tax_id
        WHERE TGI.tax_group_id IN (${groupIds.map(() => '?').join(',')}) AND T.is_deleted = 0
        ORDER BY TGI.tax_group_id, T.name
      `, groupIds);

      const standardByGroup = standardTaxes.reduce((acc, row) => {
        if (!acc[row.tax_group_id]) acc[row.tax_group_id] = [];
        acc[row.tax_group_id].push({ tax_id: row.tax_id, name: row.name, rate: row.rate });
        return acc;
      }, {});

      // Determine which ids still need resolution
      const unresolvedIds = groupIds.filter(id => !standardByGroup[id]);

      let independentByGroup = {};
      if (unresolvedIds.length > 0) {
        // Menu-independent tax groups lookup (menu_tax_groups/menu_taxes)
        const params = [...unresolvedIds];
        const whereMenu = menuId ? 'AND mtg.menu_id = ?' : '';
        if (menuId) params.push(menuId);
        const independentTaxes = await dbAll(`
          SELECT mtg.tax_group_id, mt.tax_id, mt.name, mt.rate
          FROM menu_tax_groups mtg
          JOIN menu_taxes mt ON mtg.tax_group_id = mt.tax_group_id
          WHERE mtg.tax_group_id IN (${unresolvedIds.map(() => '?').join(',')}) ${whereMenu}
          ORDER BY mtg.tax_group_id, mt.name
        `, params);

        independentByGroup = independentTaxes.reduce((acc, row) => {
          if (!acc[row.tax_group_id]) acc[row.tax_group_id] = [];
          acc[row.tax_group_id].push({ tax_id: row.tax_id, name: row.name, rate: row.rate });
          return acc;
        }, {});
      }

      // Build response aligned with requested ids
      const response = groupIds.map(id => ({
        id,
        taxes: standardByGroup[id] || independentByGroup[id] || []
      }));

      res.json(response);
    } catch (error) {
      console.error('Failed to retrieve taxes by ids:', error);
      res.status(500).json({ error: 'Failed to retrieve taxes by ids', details: error.message });
    }
  });

  // POST /api/tax-groups - Create a new tax group
  router.post('/', async (req, res) => {
    const { name, taxes, menu_id } = req.body;

    if (!name || !Array.isArray(taxes) || taxes.length === 0) {
      return res.status(400).json({ error: 'Group name and a non-empty taxes array are required.' });
    }

    // Validate each tax item
    for (const tax of taxes) {
      if (typeof tax.name !== 'string' || typeof tax.rate !== 'number' || tax.rate < 0) {
        return res.status(400).json({ error: 'Each tax in the array must have a valid name and a non-negative rate.' });
      }
    }

    await dbRun('BEGIN TRANSACTION');

    try {
      // Find or create individual tax IDs sequentially to avoid race conditions
      const taxIds = [];
      for (const tax of taxes) {
        const existingTax = await dbGet('SELECT tax_id FROM taxes WHERE name = ? AND rate = ? AND menu_id = ? AND is_deleted = 0', [tax.name, tax.rate, menu_id]);
        if (existingTax) {
          taxIds.push(existingTax.tax_id);
        } else {
          const newTaxId = await generateNextId(db, ID_RANGES.TAX);
          await dbRun('INSERT INTO taxes (tax_id, name, rate, menu_id) VALUES (?, ?, ?, ?)', [newTaxId, tax.name, tax.rate, menu_id]);
          taxIds.push(newTaxId);
        }
      }

      // Create the new tax group
      const newGroupId = await generateNextId(db, ID_RANGES.TAX_GROUP);
      await dbRun('INSERT INTO tax_groups (group_id, name, menu_id) VALUES (?, ?, ?)', [newGroupId, name, menu_id || null]);

      // Link taxes to the new group
      for (const taxId of taxIds) {
        await dbRun('INSERT INTO tax_group_links (tax_group_id, tax_id) VALUES (?, ?)', [newGroupId, taxId]);
      }

      await dbRun('COMMIT');

      // Return the newly created group, structured like the GET response
      const newGroup = {
        id: newGroupId,
        name: name,
        taxes: taxes.map((tax, i) => ({ ...tax, tax_id: taxIds[i] })) // Approximate, real IDs are now set
      };

      res.status(201).json(newGroup);

    } catch (error) {
      await dbRun('ROLLBACK');
      console.error('Failed to create tax group:', error);
      res.status(500).json({ error: 'Failed to create tax group', details: error.message });
    }
  });

  // PUT /api/tax-groups/:groupId - Update a tax group
  router.put('/:groupId', async (req, res) => {
    const { groupId } = req.params;
    const { name, taxes, menu_id } = req.body;

    if (!name || !Array.isArray(taxes)) {
      return res.status(400).json({ error: 'Group name and a taxes array are required.' });
    }
    
    await dbRun('BEGIN TRANSACTION');

    try {
      // Update group name
      await dbRun('UPDATE tax_groups SET name = ? WHERE group_id = ?', [name, groupId]);

      // Find or create individual tax IDs sequentially
      const taxIds = [];
      for (const tax of taxes) {
        const existingTax = await dbGet('SELECT tax_id FROM taxes WHERE name = ? AND rate = ? AND menu_id = ? AND is_deleted = 0', [tax.name, tax.rate, menu_id]);
        if (existingTax) {
          taxIds.push(existingTax.tax_id);
        } else {
          const newTaxId = await generateNextId(db, ID_RANGES.TAX);
          await dbRun('INSERT INTO taxes (tax_id, name, rate, menu_id) VALUES (?, ?, ?, ?)', [newTaxId, tax.name, tax.rate, menu_id]);
          taxIds.push(newTaxId);
        }
      }

      // Replace the old list of taxes with the new one
      await dbRun('DELETE FROM tax_group_links WHERE tax_group_id = ?', [groupId]);
      for (const taxId of taxIds) {
        await dbRun('INSERT INTO tax_group_links (tax_group_id, tax_id) VALUES (?, ?)', [groupId, taxId]);
      }

      await dbRun('COMMIT');

      const updatedGroup = {
        id: parseInt(groupId),
        name: name,
        taxes: taxes.map((tax, i) => ({ ...tax, tax_id: taxIds[i] }))
      };
      res.json(updatedGroup);

    } catch (error) {
      await dbRun('ROLLBACK');
      console.error(`Failed to update tax group ${groupId}:`, error);
      res.status(500).json({ error: 'Failed to update tax group', details: error.message });
    }
  });

  // DELETE /api/tax-groups/:groupId - Delete a tax group
  router.delete('/:groupId', async (req, res) => {
    const { groupId } = req.params;

    await dbRun('BEGIN TRANSACTION');
    try {
      // The ON DELETE CASCADE constraint on TaxGroup_Items will handle orphaned rows.
      // We just need to delete the group itself.
      // Set is_deleted flag for soft delete
      await dbRun('UPDATE tax_groups SET is_deleted = 1 WHERE group_id = ?', [groupId]);
      
      // Remove any links from menu items
      await dbRun('DELETE FROM menu_tax_links WHERE tax_group_id = ?', [groupId]);
      
      // Remove any links from categories
      await dbRun('DELETE FROM category_tax_links WHERE tax_group_id = ?', [groupId]);

      await dbRun('COMMIT');
      res.status(204).send();
    } catch (error) {
      await dbRun('ROLLBACK');
      console.error(`Failed to delete tax group ${groupId}:`, error);
      res.status(500).json({ error: 'Failed to delete tax group', details: error.message });
    }
  });

  return router;
}; 
