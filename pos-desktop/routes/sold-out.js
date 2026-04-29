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

  const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });

  // ----- Firebase sync helpers (non-blocking) -----
  // Lazy require so this route file remains usable in environments where
  // Firebase isn't initialised yet.
  let _firebaseService = null;
  let _idMapperService = null;
  function getFirebaseService() {
    if (_firebaseService === null) {
      try { _firebaseService = require('../services/firebaseService'); }
      catch (_) { _firebaseService = false; }
    }
    return _firebaseService || null;
  }
  function getIdMapper() {
    if (_idMapperService === null) {
      try { _idMapperService = require('../services/idMapperService'); }
      catch (_) { _idMapperService = false; }
    }
    return _idMapperService || null;
  }

  async function getFirebaseRestaurantId() {
    try {
      const row = await dbGet('SELECT firebase_restaurant_id FROM business_profile WHERE id = 1');
      return row?.firebase_restaurant_id || null;
    } catch (_) {
      return null;
    }
  }

  // Build extra meta describing the sold-out target so the customer site can
  // resolve it without knowing POS-internal ids.
  async function buildSyncMeta(scope, keyId) {
    const meta = {};
    const idMapper = getIdMapper();
    try {
      if (scope === 'item') {
        const row = await dbGet('SELECT name, category_id FROM menu_items WHERE item_id = ?', [keyId]);
        if (row) {
          meta.itemName = row.name;
          if (idMapper && row.category_id) {
            try { meta.firebaseCategoryId = await idMapper.localToFirebase('category', row.category_id); } catch (_) {}
          }
        }
        if (idMapper) {
          try { meta.firebaseItemId = await idMapper.localToFirebase('menu_item', keyId); } catch (_) {}
        }
      } else if (scope === 'category') {
        const row = await dbGet('SELECT name FROM menu_categories WHERE category_id = ?', [keyId]);
        if (row) meta.categoryName = row.name;
        if (idMapper) {
          try { meta.firebaseCategoryId = await idMapper.localToFirebase('category', keyId); } catch (_) {}
        }
      } else if (scope === 'modifier') {
        const row = await dbGet(
          `SELECT m.name AS modifier_name, mgl.modifier_group_id, mg.name AS group_name
             FROM modifiers m
             LEFT JOIN modifier_group_links mgl ON mgl.modifier_id = m.modifier_id
             LEFT JOIN modifier_groups mg ON mg.modifier_group_id = mgl.modifier_group_id
            WHERE m.modifier_id = ?
            LIMIT 1`,
          [keyId]
        );
        if (row) {
          meta.modifierName = row.modifier_name;
          if (row.modifier_group_id) {
            meta.modifierGroupId = row.modifier_group_id;
            meta.modifierGroupName = row.group_name || null;
            if (idMapper) {
              try { meta.modifierGroupFirebaseId = await idMapper.localToFirebase('modifier_group', row.modifier_group_id); } catch (_) {}
            }
          }
        }
      }
    } catch (e) {
      console.warn('[SOLD-OUT] buildSyncMeta failed:', e.message);
    }
    return meta;
  }

  async function fireSync(scope, keyId, body) {
    try {
      const fb = getFirebaseService();
      if (!fb || typeof fb.syncSoldOutRecord !== 'function') return;
      const restaurantId = await getFirebaseRestaurantId();
      if (!restaurantId) return;
      const meta = await buildSyncMeta(scope, keyId);
      await fb.syncSoldOutRecord(restaurantId, {
        scope,
        posKeyId: String(keyId),
        soldoutType: body?.type || 'today',
        endTime: Number(body?.endTime || 0),
        selector: body?.selector || null,
        meta,
      });
    } catch (e) {
      console.warn('[SOLD-OUT] Firebase sync failed (non-blocking):', e.message);
    }
  }

  async function fireRemove(scope, keyId) {
    try {
      const fb = getFirebaseService();
      if (!fb || typeof fb.removeSoldOutRecord !== 'function') return;
      const restaurantId = await getFirebaseRestaurantId();
      if (!restaurantId) return;
      const meta = await buildSyncMeta(scope, keyId);
      await fb.removeSoldOutRecord(restaurantId, scope, String(keyId), meta);
    } catch (e) {
      console.warn('[SOLD-OUT] Firebase remove failed (non-blocking):', e.message);
    }
  }

  async function fireClearExpired() {
    try {
      const fb = getFirebaseService();
      if (!fb || typeof fb.clearExpiredSoldOutInFirebase !== 'function') return;
      const restaurantId = await getFirebaseRestaurantId();
      if (!restaurantId) return;
      await fb.clearExpiredSoldOutInFirebase(restaurantId, Date.now());
    } catch (e) {
      console.warn('[SOLD-OUT] Firebase clear-expired failed (non-blocking):', e.message);
    }
  }

  // GET /api/sold-out/:menuId - list current (non-expired) sold-out records
  router.get('/:menuId', async (req, res) => {
    const { menuId } = req.params;
    const now = Date.now();
    try {
      // Clean up expired records (optional)
      await dbRun('DELETE FROM sold_out_records WHERE end_time <> 0 AND end_time <= ?', [now]);
      // Mirror cleanup on Firebase (fire-and-forget)
      fireClearExpired();
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
      fireSync('item', itemId, { type, endTime, selector });
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
      fireRemove('item', itemId);
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
      fireSync('category', categoryId, { type, endTime, selector });
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
      fireRemove('category', categoryId);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: 'Failed to clear sold-out for category' });
    }
  });

  // PUT /api/sold-out/:menuId/modifier/:modifierId
  // Sold-out a single modifier (option) globally for the given menu.
  router.put('/:menuId/modifier/:modifierId', async (req, res) => {
    const { menuId, modifierId } = req.params;
    const { type, endTime, selector } = req.body || {};
    if (!type) return res.status(400).json({ error: 'type is required' });
    try {
      await upsertSoldOut(menuId, 'modifier', modifierId, type, endTime ?? 0, selector || null);
      fireSync('modifier', modifierId, { type, endTime, selector });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: 'Failed to set sold-out for modifier' });
    }
  });

  // DELETE /api/sold-out/:menuId/modifier/:modifierId
  router.delete('/:menuId/modifier/:modifierId', async (req, res) => {
    const { menuId, modifierId } = req.params;
    try {
      await dbRun('DELETE FROM sold_out_records WHERE menu_id = ? AND scope = ? AND key_id = ?', [menuId, 'modifier', String(modifierId)]);
      fireRemove('modifier', modifierId);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: 'Failed to clear sold-out for modifier' });
    }
  });

  // POST /api/sold-out/:menuId/clear-expired
  router.post('/:menuId/clear-expired', async (req, res) => {
    const now = Date.now();
    try {
      const result = await dbRun('DELETE FROM sold_out_records WHERE end_time <> 0 AND end_time <= ?', [now]);
      fireClearExpired();
      res.json({ ok: true, cleared: result.changes || 0 });
    } catch (e) {
      res.status(500).json({ error: 'Failed to clear expired records' });
    }
  });

  return router;
};


