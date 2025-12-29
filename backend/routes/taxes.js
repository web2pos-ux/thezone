const express = require('express');
const router = express.Router();

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
      const rows = await dbAll('SELECT id, name, rate FROM taxes WHERE is_active = 1 ORDER BY name');
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/taxes - Create new tax
  router.post('/', async (req, res) => {
    const { name, rate } = req.body;
    console.log('POST /api/taxes Request:', { name, rate }); // 로그 추가

    if (!name || rate === undefined) {
      return res.status(400).json({ error: 'Name and rate are required' });
    }
    try {
      // 명시적인 컬럼 지정
      const result = await dbRun(
        'INSERT INTO taxes (name, rate, is_active) VALUES (?, ?, 1)',
        [name, rate]
      );
      console.log('Tax created:', result.lastID); // 로그 추가
      res.json({ id: result.lastID, name, rate });
    } catch (err) {
      console.error('Error creating tax:', err); // 로그 추가
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/taxes/:id - Update tax
  router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { name, rate } = req.body;
    if (!name || rate === undefined) {
      return res.status(400).json({ error: 'Name and rate are required' });
    }
    try {
      await dbRun('UPDATE taxes SET name = ?, rate = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [name, rate, id]);
      res.json({ id: parseInt(id), name, rate });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/taxes/:id - Delete tax (soft delete)
  router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
      await dbRun('UPDATE taxes SET is_active = 0 WHERE id = ?', [id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/taxes/groups - Get all tax groups with full tax details
  router.get('/groups', async (req, res) => {
    try {
      const groups = await dbAll('SELECT id, name FROM tax_groups WHERE is_active = 1 ORDER BY name');
      
      // Get tax details for each group (including name and rate)
      for (const group of groups) {
        const taxDetails = await dbAll(
          `SELECT t.id, t.name, t.rate 
           FROM tax_group_links tgl 
           JOIN taxes t ON tgl.tax_id = t.id 
           WHERE tgl.group_id = ? AND t.is_active = 1`,
          [group.id]
        );
        group.taxIds = taxDetails.map(t => t.id);
        group.taxes = taxDetails.map(t => ({ name: t.name, rate: t.rate }));
      }
      
      res.json(groups);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/taxes/groups - Create new tax group
  router.post('/groups', async (req, res) => {
    const { name, taxIds } = req.body;
    if (!name || !taxIds || !Array.isArray(taxIds) || taxIds.length === 0) {
      return res.status(400).json({ error: 'Name and taxIds are required' });
    }
    try {
      const result = await dbRun(
        'INSERT INTO tax_groups (name, is_active) VALUES (?, 1)',
        [name]
      );
      const groupId = result.lastID;
      
      // Link taxes to group
      for (const taxId of taxIds) {
        await dbRun(
          'INSERT INTO tax_group_links (group_id, tax_id) VALUES (?, ?)',
          [groupId, taxId]
        );
      }
      
      res.json({ id: groupId, name, taxIds });
    } catch (err) {
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
      // Update group name
      await dbRun('UPDATE tax_groups SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [name, id]);
      
      // Delete existing links and recreate
      await dbRun('DELETE FROM tax_group_links WHERE group_id = ?', [id]);
      for (const taxId of taxIds) {
        await dbRun('INSERT INTO tax_group_links (group_id, tax_id) VALUES (?, ?)', [id, taxId]);
      }
      
      res.json({ id: parseInt(id), name, taxIds });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/taxes/groups/:id - Delete tax group (soft delete)
  router.delete('/groups/:id', async (req, res) => {
    const { id } = req.params;
    try {
      await dbRun('UPDATE tax_groups SET is_active = 0 WHERE id = ?', [id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}; 