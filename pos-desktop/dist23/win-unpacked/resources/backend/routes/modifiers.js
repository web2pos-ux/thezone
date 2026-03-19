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

  // GET /api/modifiers - Get all modifiers
  router.get('/', async (req, res) => {
    try {
      const { type } = req.query;
      let sql = 'SELECT modifier_id as id, name, price_delta, price_delta2, type, sort_order, button_color FROM modifiers WHERE is_deleted = 0';
      const params = [];

      if (type) {
        sql += ' AND type = ?';
        params.push(type);
      }

      sql += ' ORDER BY type, sort_order, name';

      const modifiers = await dbAll(sql, params);
      const result = modifiers.map(m => ({
        ...m,
        price_delta2: m.price_delta2 || 0
      }));
      res.json(result);
    } catch (error) {
      console.error('Failed to retrieve modifiers:', error);
      res.status(500).json({ error: 'Failed to retrieve modifiers', details: error.message });
    }
  });

  // POST /api/modifiers - Create a new modifier
  router.post('/', async (req, res) => {
    const { name, price_delta, price_delta2, type, sort_order } = req.body;
    // Allow blank modifier name ("") per requirements.
    const safeName = (typeof name === 'string') ? name.trim() : '';

    if (typeof price_delta !== 'number') {
      return res.status(400).json({ error: 'Price delta must be a number.' });
    }

    try {
      const newModifierId = await generateNextId(db, ID_RANGES.MODIFIER);
      const modifierType = type || 'OPTION';
      const sortOrder = sort_order || 0;
      const priceDelta2 = price_delta2 || 0;

      await dbRun('INSERT INTO modifiers (modifier_id, name, price_delta, price_delta2, type, sort_order, is_deleted) VALUES (?, ?, ?, ?, ?, ?, 0)', 
        [newModifierId, safeName, price_delta, priceDelta2, modifierType, sortOrder]);

      res.status(201).json({
        id: newModifierId,
        name: safeName,
        price_delta: price_delta,
        price_delta2: priceDelta2,
        type: modifierType,
        sort_order: sortOrder
      });
    } catch (error) {
      console.error('Error creating modifier:', error);
      res.status(500).json({ error: 'Failed to create modifier' });
    }
  });

  // PUT /api/modifiers/:id - Update a modifier
  router.put('/:id', async (req, res) => {
    const { id: modifierId } = req.params;
    const { name, price_delta, price_delta2, type, sort_order } = req.body;
    // Allow blank modifier name ("") per requirements.
    const safeName = (typeof name === 'string') ? name.trim() : '';

    if (typeof price_delta !== 'number') {
      return res.status(400).json({ error: 'Price delta must be a number.' });
    }

    try {
      const modifierType = type || 'OPTION';
      const sortOrder = sort_order || 0;
      const priceDelta2 = price_delta2 || 0;

      await dbRun('UPDATE modifiers SET name = ?, price_delta = ?, price_delta2 = ?, type = ?, sort_order = ? WHERE modifier_id = ? AND is_deleted = 0', 
        [safeName, price_delta, priceDelta2, modifierType, sortOrder, modifierId]);

      res.json({
        id: parseInt(modifierId),
        name: safeName,
        price_delta: price_delta,
        price_delta2: priceDelta2,
        type: modifierType,
        sort_order: sortOrder
      });
    } catch (error) {
      console.error('Error updating modifier:', error);
      res.status(500).json({ error: 'Failed to update modifier' });
    }
  });

  // DELETE /api/modifiers/:id - Soft delete a modifier
  router.delete('/:id', async (req, res) => {
    const { id: modifierId } = req.params;

    try {
      await dbRun('UPDATE modifiers SET is_deleted = 1 WHERE modifier_id = ?', [modifierId]);
      await dbRun('DELETE FROM modifier_group_links WHERE modifier_id = ?', [modifierId]);
      res.status(204).send();
    } catch (error) {
      console.error(`Failed to delete modifier ${modifierId}:`, error);
      res.status(500).json({ error: 'Failed to delete modifier', details: error.message });
    }
  });

  return router;
};
