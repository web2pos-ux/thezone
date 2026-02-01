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
        groups = await dbAll(`
          SELECT tax_group_id as id, name 
          FROM tax_groups 
          WHERE is_deleted = 0 
          AND (menu_id = ? OR menu_id IS NULL)
        `, [menu_id]);
      } else {
        groups = await dbAll('SELECT tax_group_id as id, name FROM tax_groups WHERE is_deleted = 0');
      }
      
      const groupIds = groups.map(g => g.id);

      if (groupIds.length === 0) {
        return res.json([]);
      }

      const taxes = await dbAll(`
        SELECT
          TGL.tax_group_id,
          T.tax_id,
          T.name,
          T.rate
        FROM taxes T
        JOIN tax_group_links TGL ON T.tax_id = TGL.tax_id
        WHERE TGL.tax_group_id IN (${groupIds.map(() => '?').join(',')}) AND T.is_deleted = 0
        ORDER BY TGL.tax_group_id, T.name
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
      console.error('❌ Failed to retrieve tax groups:', error);
      res.status(500).json({ error: 'Failed to retrieve tax groups.', details: error.message });
    }
  });

  // POST /api/tax-groups - Create a new tax group
  router.post('/', async (req, res) => {
    const { name, taxes, menu_id } = req.body;
    const targetMenuId = menu_id ? Number(menu_id) : null;

    console.log('🔍 POST /tax-groups - Received data:', { name, taxesCount: taxes?.length, menu_id });

    if (!name || !Array.isArray(taxes) || taxes.length === 0) {
      return res.status(400).json({ error: 'Group name and a non-empty taxes array are required.' });
    }

    try {
      console.log('🔄 Starting transaction for tax group creation...');
      await dbRun('BEGIN TRANSACTION');

      // 1. Find or create individual tax IDs
      const taxIds = [];
      for (const tax of taxes) {
        if (!tax.name || !tax.name.trim()) continue;

        const existingTax = await dbGet(
          'SELECT tax_id FROM taxes WHERE name = ? AND rate = ? AND (menu_id = ? OR menu_id IS NULL) AND is_deleted = 0 LIMIT 1', 
          [tax.name.trim(), tax.rate, targetMenuId]
        );

        if (existingTax) {
          taxIds.push(existingTax.tax_id);
        } else {
          const newTaxId = await generateNextId(db, ID_RANGES.TAX);
          await dbRun(
            'INSERT INTO taxes (tax_id, name, rate, menu_id, is_deleted) VALUES (?, ?, ?, ?, 0)', 
            [newTaxId, tax.name.trim(), tax.rate, targetMenuId]
          );
          taxIds.push(newTaxId);
        }
      }

      if (taxIds.length === 0) {
        await dbRun('ROLLBACK');
        return res.status(400).json({ error: 'At least one valid tax is required.' });
      }

      // 2. Create the new tax group
      const newGroupId = await generateNextId(db, ID_RANGES.TAX_GROUP);
      await dbRun(
        'INSERT INTO tax_groups (tax_group_id, name, menu_id, is_deleted) VALUES (?, ?, ?, 0)', 
        [newGroupId, name.trim(), targetMenuId]
      );

      // 3. Link taxes to the new group
      const uniqueTaxIds = [...new Set(taxIds)];
      for (const taxId of uniqueTaxIds) {
        await dbRun('INSERT OR REPLACE INTO tax_group_links (tax_group_id, tax_id) VALUES (?, ?)', [newGroupId, taxId]);
      }

      await dbRun('COMMIT');
      console.log('✅ Tax group creation completed successfully:', newGroupId);

      res.status(201).json({
        id: newGroupId,
        name: name.trim(),
        taxes: taxes.map((tax, i) => ({ ...tax, tax_id: taxIds[i] }))
      });

    } catch (error) {
      if (db.inTransaction) await dbRun('ROLLBACK').catch(() => {});
      console.error('❌ Failed to create tax group:', error);
      res.status(500).json({ error: 'Failed to create tax group.', details: error.message });
    }
  });

  // Update a tax group
  router.put('/:groupId', async (req, res) => {
    const { groupId } = req.params;
    const { name, taxes, menu_id } = req.body;
    const targetMenuId = menu_id ? Number(menu_id) : null;

    if (!name || !Array.isArray(taxes)) {
      return res.status(400).json({ error: 'Group name and a taxes array are required.' });
    }
    
    try {
      await dbRun('BEGIN TRANSACTION');

      await dbRun('UPDATE tax_groups SET name = ?, menu_id = ?, is_deleted = 0 WHERE tax_group_id = ?', 
        [name.trim(), targetMenuId, groupId]);

      const taxIds = [];
      for (const tax of taxes) {
        if (!tax.name || !tax.name.trim()) continue;

        const existingTax = await dbGet(
          'SELECT tax_id FROM taxes WHERE name = ? AND rate = ? AND (menu_id = ? OR menu_id IS NULL) AND is_deleted = 0 LIMIT 1', 
          [tax.name.trim(), tax.rate, targetMenuId]
        );

        if (existingTax) {
          taxIds.push(existingTax.tax_id);
        } else {
          const newTaxId = await generateNextId(db, ID_RANGES.TAX);
          await dbRun(
            'INSERT INTO taxes (tax_id, name, rate, menu_id, is_deleted) VALUES (?, ?, ?, ?, 0)', 
            [newTaxId, tax.name.trim(), tax.rate, targetMenuId]
          );
          taxIds.push(newTaxId);
        }
      }

      await dbRun('DELETE FROM tax_group_links WHERE tax_group_id = ?', [groupId]);
      for (const taxId of taxIds) {
        await dbRun('INSERT OR REPLACE INTO tax_group_links (tax_group_id, tax_id) VALUES (?, ?)', [groupId, taxId]);
      }

      await dbRun('COMMIT');
      res.json({
        id: parseInt(groupId),
        name: name.trim(),
        taxes: taxes.map((tax, i) => ({ ...tax, tax_id: taxIds[i] }))
      });

    } catch (error) {
      await dbRun('ROLLBACK').catch(() => {});
      console.error(`❌ Failed to update tax group ${groupId}:`, error);
      res.status(500).json({ error: 'Failed to update tax group.', details: error.message });
    }
  });

  // DELETE /api/tax-groups/:groupId - Delete a tax group
  router.delete('/:groupId', async (req, res) => {
    const { groupId } = req.params;
    try {
      await dbRun('BEGIN TRANSACTION');
      await dbRun('UPDATE tax_groups SET is_deleted = 1 WHERE tax_group_id = ?', [groupId]);
      await dbRun('DELETE FROM tax_group_links WHERE tax_group_id = ?', [groupId]);
      await dbRun('DELETE FROM menu_tax_links WHERE tax_group_id = ?', [groupId]);
      await dbRun('DELETE FROM category_tax_links WHERE tax_group_id = ?', [groupId]);

      await dbRun('COMMIT');
      res.status(204).send();
    } catch (error) {
      await dbRun('ROLLBACK').catch(() => {});
      console.error(`❌ Failed to delete tax group ${groupId}:`, error);
      res.status(500).json({ error: 'Failed to delete tax group.', details: error.message });
    }
  });

  return router;
};
