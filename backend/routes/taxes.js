const express = require('express');
const router = express.Router();
const { generateNextId, ID_RANGES } = require('../utils/idGenerator');

module.exports = (db) => {
  // Helper functions
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

  // GET /api/taxes (individual taxes)
  router.get('/', async (req, res) => {
    try {
      const rows = await dbAll('SELECT tax_id as id, name, rate, menu_id FROM taxes WHERE is_deleted = 0 ORDER BY name');
      res.json(rows);
    } catch (err) {
      console.error('❌ Failed to fetch taxes:', err);
      res.status(500).json({ error: 'Failed to fetch taxes.' });
    }
  });

  // POST /api/taxes - Create new tax
  router.post('/', async (req, res) => {
    const { name, rate, menu_id } = req.body;
    const targetMenuId = menu_id ? Number(menu_id) : null;

    if (!name || rate === undefined) {
      return res.status(400).json({ error: 'Name and rate are required' });
    }
    try {
      const newTaxId = await generateNextId(db, ID_RANGES.TAX);
      await dbRun(
        'INSERT INTO taxes (tax_id, name, rate, menu_id, is_deleted) VALUES (?, ?, ?, ?, 0)',
        [newTaxId, name.trim(), rate, targetMenuId]
      );
      console.log('✅ Tax created:', newTaxId);
      res.json({ id: newTaxId, name: name.trim(), rate, menu_id: targetMenuId });
    } catch (err) {
      console.error('❌ Error creating tax:', err);
      res.status(500).json({ error: 'Failed to create tax.', details: err.message });
    }
  });

  // PUT /api/taxes/:id - Update tax
  router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { name, rate, menu_id } = req.body;
    const targetMenuId = menu_id ? Number(menu_id) : null;
    if (!name || rate === undefined) {
      return res.status(400).json({ error: 'Name and rate are required' });
    }
    try {
      await dbRun('UPDATE taxes SET name = ?, rate = ?, menu_id = ?, is_deleted = 0 WHERE tax_id = ?', 
        [name.trim(), rate, targetMenuId, id]);
      res.json({ id: Number(id), name: name.trim(), rate, menu_id: targetMenuId });
    } catch (err) {
      console.error('❌ Error updating tax:', err);
      res.status(500).json({ error: 'Failed to update tax.' });
    }
  });

  // DELETE /api/taxes/:id - Delete tax (soft delete)
  router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
      await dbRun('BEGIN TRANSACTION');
      await dbRun('UPDATE taxes SET is_deleted = 1 WHERE tax_id = ?', [id]);
      // Also remove links
      await dbRun('DELETE FROM tax_group_links WHERE tax_id = ?', [id]);
      await dbRun('COMMIT');
      res.json({ success: true });
    } catch (err) {
      if (db.inTransaction) await dbRun('ROLLBACK').catch(() => {});
      console.error('❌ Error deleting tax:', err);
      res.status(500).json({ error: 'Failed to delete tax.' });
    }
  });

  // GET /api/taxes/groups - Get all tax groups with full tax details
  router.get('/groups', async (req, res) => {
    try {
      const groups = await dbAll('SELECT tax_group_id as id, name FROM tax_groups WHERE is_deleted = 0 ORDER BY name');
      
      // Get tax details for each group (including name and rate)
      for (const group of groups) {
        const taxDetails = await dbAll(
          `SELECT t.tax_id, t.name, t.rate 
           FROM tax_group_links tgl 
           JOIN taxes t ON tgl.tax_id = t.tax_id 
           WHERE tgl.tax_group_id = ? AND t.is_deleted = 0`,
          [group.id]
        );
        group.taxIds = taxDetails.map(t => t.tax_id);
        group.taxes = taxDetails.map(t => ({ tax_id: t.tax_id, name: t.name, rate: t.rate }));
      }
      
      res.json(groups);
    } catch (err) {
      console.error('Failed to get tax groups:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/taxes/groups - Create new tax group
  router.post('/groups', async (req, res) => {
    const { name, taxIds, menu_id } = req.body;
    const targetMenuId = menu_id ? Number(menu_id) : null;

    if (!name || !taxIds || !Array.isArray(taxIds) || taxIds.length === 0) {
      return res.status(400).json({ error: 'Name and taxIds are required' });
    }

    try {
      await dbRun('BEGIN TRANSACTION');

      const newGroupId = await generateNextId(db, ID_RANGES.TAX_GROUP);
      await dbRun(
        'INSERT INTO tax_groups (tax_group_id, name, menu_id, is_deleted) VALUES (?, ?, ?, 0)',
        [newGroupId, name.trim(), targetMenuId]
      );
      
      // Link taxes to group
      const uniqueTaxIds = [...new Set(taxIds)];
      for (const taxId of uniqueTaxIds) {
        await dbRun('INSERT OR REPLACE INTO tax_group_links (tax_group_id, tax_id) VALUES (?, ?)', [newGroupId, taxId]);
      }

      await dbRun('COMMIT');
      res.status(201).json({ id: newGroupId, name: name.trim(), taxIds: uniqueTaxIds });
    } catch (err) {
      await dbRun('ROLLBACK').catch(() => {});
      console.error('Error creating tax group:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/taxes/groups/:id - Update tax group
  router.put('/groups/:id', async (req, res) => {
    const { id } = req.params;
    const { name, taxIds } = req.body;
    if (!name || !taxIds || !Array.isArray(taxIds)) {
      return res.status(400).json({ error: 'Name and taxIds are required' });
    }
    try {
      await dbRun('BEGIN TRANSACTION');
      // Update group name
      await dbRun('UPDATE tax_groups SET name = ? WHERE tax_group_id = ?', [name.trim(), id]);
      
      // Delete existing links and recreate
      await dbRun('DELETE FROM tax_group_links WHERE tax_group_id = ?', [id]);
      for (const taxId of taxIds) {
        await dbRun('INSERT INTO tax_group_links (tax_group_id, tax_id) VALUES (?, ?)', [id, taxId]);
      }
      await dbRun('COMMIT');
      res.json({ id: parseInt(id), name: name.trim(), taxIds });
    } catch (err) {
      await dbRun('ROLLBACK').catch(() => {});
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/taxes/groups/:id - Delete tax group (soft delete)
  router.delete('/groups/:id', async (req, res) => {
    const { id } = req.params;
    try {
      await dbRun('BEGIN TRANSACTION');
      await dbRun('UPDATE tax_groups SET is_deleted = 1 WHERE tax_group_id = ?', [id]);
      // Also remove links from menu items and categories
      await dbRun('DELETE FROM menu_tax_links WHERE tax_group_id = ?', [id]);
      await dbRun('DELETE FROM category_tax_links WHERE tax_group_id = ?', [id]);
      await dbRun('COMMIT');
      res.json({ success: true });
    } catch (err) {
      await dbRun('ROLLBACK').catch(() => {});
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
