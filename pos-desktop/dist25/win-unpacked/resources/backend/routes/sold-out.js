const express = require('express');

module.exports = (db) => {
  const router = express.Router();

  const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

  const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });

  // GET /api/sold-out/:menuId - list current (non-expired) sold-out records
  router.get('/:menuId', async (req, res) => {
    const { menuId } = req.params;
    const now = Date.now();
    try {
      // Clean up expired records (optional)
      await dbRun('DELETE FROM sold_out_records WHERE end_time <> 0 AND end_time <= ?', [now]);
      const rows = await dbAll('SELECT scope, key_id, soldout_type, end_time, selector FROM sold_out_records WHERE menu_id = ? AND (end_time = 0 OR end_time > ?)', [menuId, now]);
      res.json({ records: rows });
    } catch (e) {
      res.status(500).json({ error: 'Failed to load sold-out records' });
    }
  });

  // Upsert helper
  const upsertSoldOut = async (menuId, scope, keyId, soldoutType, endTime, selector) => {
    const sql = `INSERT INTO sold_out_records (menu_id, scope, key_id, soldout_type, end_time, selector, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
                 ON CONFLICT(menu_id, scope, key_id) DO UPDATE SET soldout_type=excluded.soldout_type, end_time=excluded.end_time, selector=excluded.selector, updated_at=datetime('now')`;
    await dbRun(sql, [menuId, scope, String(keyId), soldoutType, Number(endTime || 0), selector || null]);
  };

  // PUT /api/sold-out/:menuId/item/:itemId
  router.put('/:menuId/item/:itemId', async (req, res) => {
    const { menuId, itemId } = req.params;
    const { type, endTime, selector } = req.body || {};
    if (!type) return res.status(400).json({ error: 'type is required' });
    try {
      await upsertSoldOut(menuId, 'item', itemId, type, endTime ?? 0, selector || null);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: 'Failed to set sold-out for item' });
    }
  });

  // DELETE /api/sold-out/:menuId/item/:itemId
  router.delete('/:menuId/item/:itemId', async (req, res) => {
    const { menuId, itemId } = req.params;
    try {
      await dbRun('DELETE FROM sold_out_records WHERE menu_id = ? AND scope = ? AND key_id = ?', [menuId, 'item', String(itemId)]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: 'Failed to clear sold-out for item' });
    }
  });

  // PUT /api/sold-out/:menuId/category/:categoryId
  router.put('/:menuId/category/:categoryId', async (req, res) => {
    const { menuId, categoryId } = req.params;
    const { type, endTime, selector } = req.body || {};
    if (!type) return res.status(400).json({ error: 'type is required' });
    try {
      await upsertSoldOut(menuId, 'category', categoryId, type, endTime ?? 0, selector || null);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: 'Failed to set sold-out for category' });
    }
  });

  // DELETE /api/sold-out/:menuId/category/:categoryId
  router.delete('/:menuId/category/:categoryId', async (req, res) => {
    const { menuId, categoryId } = req.params;
    try {
      await dbRun('DELETE FROM sold_out_records WHERE menu_id = ? AND scope = ? AND key_id = ?', [menuId, 'category', String(categoryId)]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: 'Failed to clear sold-out for category' });
    }
  });

  // POST /api/sold-out/:menuId/clear-expired
  router.post('/:menuId/clear-expired', async (req, res) => {
    const now = Date.now();
    try {
      const result = await dbRun('DELETE FROM sold_out_records WHERE end_time <> 0 AND end_time <= ?', [now]);
      res.json({ ok: true, cleared: result.changes || 0 });
    } catch (e) {
      res.status(500).json({ error: 'Failed to clear expired records' });
    }
  });

  return router;
};


