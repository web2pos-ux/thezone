const express = require('express');

module.exports = (db) => {
  const router = express.Router();

  const dbAll = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

  const normalizeActionType = (value) => {
    if (!value) return null;
    const upper = String(value).trim().toUpperCase();
    if (upper === 'MOVE' || upper === 'MERGE') return upper;
    return null;
  };

  const sanitizeDate = (value) => {
    if (!value || typeof value !== 'string') return null;
    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) return null;
    return new Date(timestamp).toISOString();
  };

  router.get('/', async (req, res) => {
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50));
    const filters = [];
    const params = [];

    const actionType = normalizeActionType(req.query.actionType);
    if (actionType) {
      filters.push('action_type = ?');
      params.push(actionType);
    }

    if (typeof req.query.floor === 'string' && req.query.floor.trim()) {
      filters.push('floor = ?');
      params.push(req.query.floor.trim());
    }

    const fromDate = sanitizeDate(req.query.fromDate);
    if (fromDate) {
      filters.push('datetime(performed_at) >= datetime(?)');
      params.push(fromDate);
    }

    const toDate = sanitizeDate(req.query.toDate);
    if (toDate) {
      filters.push('datetime(performed_at) <= datetime(?)');
      params.push(toDate);
    }

    let sql = `
      SELECT id, from_table_id, to_table_id, action_type, order_id, from_order_id, floor, performed_at, performed_by
      FROM table_move_history
    `;

    if (filters.length) {
      sql += ` WHERE ${filters.join(' AND ')}`;
    }

    sql += ' ORDER BY datetime(performed_at) DESC LIMIT ?';
    params.push(limit);

    try {
      const rows = await dbAll(sql, params);
      res.json({ success: true, data: rows });
    } catch (error) {
      console.error('[TABLE MOVE HISTORY] Failed to fetch history:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to load move/merge history',
      });
    }
  });

  return router;
};




