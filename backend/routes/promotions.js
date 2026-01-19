const express = require('express');

// Firebase Admin SDK (optional - for sync)
let firebaseAdmin = null;
let firebaseDb = null;
try {
  firebaseAdmin = require('firebase-admin');
  if (firebaseAdmin.apps.length > 0) {
    firebaseDb = firebaseAdmin.firestore();
  }
} catch (e) {
  console.log('Firebase Admin not available for promotions sync');
}

module.exports = function(db) {
  const router = express.Router();

  const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) { if (err) reject(err); else resolve(this); });
  });
  const all = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows); });
  });
  const exec = (sql) => new Promise((resolve, reject) => {
    db.exec(sql, (err) => { if (err) reject(err); else resolve(); });
  });

  // Ensure table exists
  const ensureTable = async () => {
    await exec(`
      CREATE TABLE IF NOT EXISTS discount_promotions (
        id TEXT PRIMARY KEY,
        name TEXT,
        code TEXT,
        start_date TEXT,
        end_date TEXT,
        start_time TEXT,
        end_time TEXT,
        mode TEXT,
        value REAL,
        min_subtotal REAL,
        eligible_item_ids TEXT,
        days_of_week TEXT,
        date_always INTEGER,
        time_always INTEGER,
        enabled INTEGER,
        created_at INTEGER
      );
    `);
  };

  const ensureFreeItemTable = async () => {
    await exec(`
      CREATE TABLE IF NOT EXISTS free_item_promotions (
        id TEXT PRIMARY KEY,
        name TEXT,
        code TEXT,
        start_date TEXT,
        end_date TEXT,
        start_time TEXT,
        end_time TEXT,
        days_of_week TEXT,
        date_always INTEGER,
        time_always INTEGER,
        enabled INTEGER,
        created_at INTEGER,
        kind TEXT,
        free_item_id TEXT,
        free_qty INTEGER,
        min_subtotal REAL,
        eligible_item_ids TEXT
      );
    `);
    // Add kind column if not exists
    await exec(`ALTER TABLE free_item_promotions ADD COLUMN kind TEXT`).catch(()=>{});
  };

  router.get('/discount', async (req, res) => {
    try {
      await ensureTable();
      // Ensure channels_json column exists
      try {
        await exec('ALTER TABLE discount_promotions ADD COLUMN channels_json TEXT');
      } catch (e) { /* column already exists */ }
      
      const rows = await all('SELECT * FROM discount_promotions ORDER BY created_at DESC');
      const mapped = rows.map(r => ({
        id: r.id,
        name: r.name || '',
        code: r.code || '',
        startDate: r.start_date || '',
        endDate: r.end_date || '',
        startTime: r.start_time || '',
        endTime: r.end_time || '',
        mode: (r.mode === 'amount' ? 'amount' : 'percent'),
        value: Number(r.value || 0),
        minSubtotal: Number(r.min_subtotal || 0),
        eligibleItemIds: (()=>{ try { return JSON.parse(r.eligible_item_ids||'[]'); } catch { return []; } })(),
        daysOfWeek: (()=>{ try { return JSON.parse(r.days_of_week||'[]'); } catch { return []; } })(),
        dateAlways: !!r.date_always,
        timeAlways: !!r.time_always,
        enabled: (r.enabled == null ? true : !!r.enabled),
        createdAt: Number(r.created_at || 0),
        channels: (()=>{ try { return JSON.parse(r.channels_json||'{}'); } catch { return {}; } })()
      }));
      res.json(mapped);
    } catch (e) {
      console.error('GET /promotions/discount failed:', e);
      res.status(500).json({ error: 'failed_to_load_promotions' });
    }
  });

  // Overwrite all promotions
  router.put('/discount', async (req, res) => {
    try {
      await ensureTable();
      // Ensure channels_json column exists
      try {
        await exec('ALTER TABLE discount_promotions ADD COLUMN channels_json TEXT');
      } catch (e) { /* column already exists */ }
      
      const body = Array.isArray(req.body) ? req.body : [];
      await exec('BEGIN TRANSACTION');
      await run('DELETE FROM discount_promotions');
      const stmt = db.prepare(`INSERT INTO discount_promotions (
        id, name, code, start_date, end_date, start_time, end_time, mode, value, min_subtotal,
        eligible_item_ids, days_of_week, date_always, time_always, enabled, created_at, channels_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const r of body) {
        const row = [
          String(r.id),
          String(r.name||''),
          String(r.code||''),
          String(r.startDate||''),
          String(r.endDate||''),
          String(r.startTime||''),
          String(r.endTime||''),
          (r.mode==='amount'?'amount':'percent'),
          Number(r.value||0),
          Number(r.minSubtotal||0),
          JSON.stringify(Array.isArray(r.eligibleItemIds)?r.eligibleItemIds:[]),
          JSON.stringify(Array.isArray(r.daysOfWeek)?r.daysOfWeek:[]),
          r.dateAlways?1:0,
          r.timeAlways?1:0,
          (r.enabled===false?0:1),
          Number(r.createdAt||Date.now()),
          JSON.stringify(r.channels || {})
        ];
        await new Promise((resolve, reject) => stmt.run(row, (err)=> err?reject(err):resolve()));
      }
      await new Promise((resolve) => stmt.finalize(()=>resolve()));
      await exec('COMMIT');
      res.json({ ok: true });
    } catch (e) {
      try { await exec('ROLLBACK'); } catch {}
      console.error('PUT /promotions/discount failed:', e);
      res.status(500).json({ error: 'failed_to_save_promotions' });
    }
  });

  // --- Free Item Promotions ---
  router.get('/free', async (req, res) => {
    try {
      await ensureFreeItemTable();
      const rows = await all('SELECT * FROM free_item_promotions ORDER BY created_at DESC');
      const mapped = rows.map(r => ({
        id: r.id,
        name: r.name || '',
        code: r.code || '',
        startDate: r.start_date || '',
        endDate: r.end_date || '',
        startTime: r.start_time || '',
        endTime: r.end_time || '',
        daysOfWeek: (()=>{ try { return JSON.parse(r.days_of_week||'[]'); } catch { return []; } })(),
        dateAlways: !!r.date_always,
        timeAlways: !!r.time_always,
        enabled: (r.enabled == null ? true : !!r.enabled),
        createdAt: Number(r.created_at || 0),
        kind: r.kind || 'FREE',
        freeItemId: r.free_item_id || '',
        freeQty: Number(r.free_qty || 1),
        minSubtotal: Number(r.min_subtotal || 0),
        eligibleItemIds: (()=>{ try { return JSON.parse(r.eligible_item_ids||'[]'); } catch { return []; } })(),
      }));
      res.json(mapped);
    } catch (e) {
      console.error('GET /promotions/free failed:', e);
      res.status(500).json({ error: 'failed_to_load_free_promotions' });
    }
  });

  router.put('/free', async (req, res) => {
    try {
      await ensureFreeItemTable();
      const body = Array.isArray(req.body) ? req.body : [];
      await exec('BEGIN TRANSACTION');
      await run('DELETE FROM free_item_promotions');
      const stmt = db.prepare(`INSERT INTO free_item_promotions (
        id, name, code, start_date, end_date, start_time, end_time, days_of_week, date_always, time_always,
        enabled, created_at, kind, free_item_id, free_qty, min_subtotal, eligible_item_ids
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const r of body) {
        const row = [
          String(r.id),
          String(r.name||''),
          String(r.code||''),
          String(r.startDate||''),
          String(r.endDate||''),
          String(r.startTime||''),
          String(r.endTime||''),
          JSON.stringify(Array.isArray(r.daysOfWeek)?r.daysOfWeek:[]),
          r.dateAlways?1:0,
          r.timeAlways?1:0,
          (r.enabled===false?0:1),
          Number(r.createdAt||Date.now()),
          String(r.kind||'FREE'),
          String(r.freeItemId||''),
          Number(r.freeQty||1),
          Number(r.minSubtotal||0),
          JSON.stringify(Array.isArray(r.eligibleItemIds)?r.eligibleItemIds:[])
        ];
        await new Promise((resolve, reject) => stmt.run(row, (err)=> err?reject(err):resolve()));
      }
      await new Promise((resolve) => stmt.finalize(()=>resolve()));
      await exec('COMMIT');
      res.json({ ok: true });
    } catch (e) {
      try { await exec('ROLLBACK'); } catch {}
      console.error('PUT /promotions/free failed:', e);
      res.status(500).json({ error: 'failed_to_save_free_promotions' });
    }
  });

  // --- Firebase Sync ---
  // Get Firebase promotions (for display in POS)
  router.get('/firebase', async (req, res) => {
    try {
      // Get restaurantId from business_profile
      const profile = await new Promise((resolve, reject) => {
        db.get('SELECT firebase_restaurant_id FROM business_profile LIMIT 1', [], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      
      const restaurantId = profile?.firebase_restaurant_id;
      if (!restaurantId) {
        return res.json({ promotions: [], message: 'No Firebase restaurant ID configured' });
      }
      
      if (!firebaseDb) {
        return res.json({ promotions: [], message: 'Firebase not initialized' });
      }
      
      // Fetch promotions from Firebase
      const snapshot = await firebaseDb
        .collection('restaurants')
        .doc(restaurantId)
        .collection('promotions')
        .get();
      
      const promotions = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        promotions.push({
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toMillis() || null,
          updatedAt: data.updatedAt?.toMillis() || null
        });
      });
      
      res.json({ promotions, restaurantId });
    } catch (e) {
      console.error('GET /promotions/firebase failed:', e);
      res.status(500).json({ error: 'failed_to_load_firebase_promotions', message: e.message });
    }
  });

  // Sync POS promotion to Firebase
  router.post('/sync-to-firebase', async (req, res) => {
    try {
      const { promotion, type } = req.body; // type: 'discount' or 'free'
      
      // Get restaurantId from business_profile
      const profile = await new Promise((resolve, reject) => {
        db.get('SELECT firebase_restaurant_id FROM business_profile LIMIT 1', [], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      
      const restaurantId = profile?.firebase_restaurant_id;
      if (!restaurantId) {
        return res.status(400).json({ error: 'No Firebase restaurant ID configured' });
      }
      
      if (!firebaseDb) {
        return res.status(400).json({ error: 'Firebase not initialized' });
      }
      
      // Convert POS promotion format to Firebase format
      const firebasePromo = {
        type: type === 'free' ? 
          (promotion.kind === 'BOGO' ? 'bogo' : 'free_item') : 
          (promotion.mode === 'percent' ? 'percent_cart' : 'fixed_discount'),
        name: promotion.name || 'Unnamed Promotion',
        description: promotion.code ? `Code: ${promotion.code}` : '',
        active: promotion.enabled !== false,
        minOrderAmount: promotion.minSubtotal || 0,
        discountPercent: promotion.mode === 'percent' ? promotion.value : null,
        discountAmount: promotion.mode === 'amount' ? promotion.value : null,
        selectedItems: promotion.eligibleItemIds || [],
        channels: ['online', 'dine-in', 'togo', 'delivery', 'table-order', 'kiosk'],
        validFrom: promotion.startDate || null,
        validUntil: promotion.endDate || null,
        updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp()
      };
      
      // Remove null values
      Object.keys(firebasePromo).forEach(key => {
        if (firebasePromo[key] === null || firebasePromo[key] === undefined) {
          delete firebasePromo[key];
        }
      });
      
      // Save to Firebase
      const promoRef = firebaseDb
        .collection('restaurants')
        .doc(restaurantId)
        .collection('promotions')
        .doc(promotion.id);
      
      await promoRef.set(firebasePromo, { merge: true });
      
      res.json({ ok: true, promotionId: promotion.id });
    } catch (e) {
      console.error('POST /promotions/sync-to-firebase failed:', e);
      res.status(500).json({ error: 'failed_to_sync_promotion', message: e.message });
    }
  });

  // Sync Firebase promotions to POS (download from Firebase and save to SQLite)
  router.post('/sync-from-firebase', async (req, res) => {
    try {
      // Get restaurantId from business_profile
      const profile = await new Promise((resolve, reject) => {
        db.get('SELECT firebase_restaurant_id FROM business_profile LIMIT 1', [], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      
      const restaurantId = profile?.firebase_restaurant_id;
      if (!restaurantId) {
        return res.status(400).json({ error: 'No Firebase restaurant ID configured' });
      }
      
      if (!firebaseDb) {
        return res.status(400).json({ error: 'Firebase not initialized' });
      }
      
      // Fetch promotions from Firebase
      const snapshot = await firebaseDb
        .collection('restaurants')
        .doc(restaurantId)
        .collection('promotions')
        .get();
      
      const firebasePromos = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        firebasePromos.push({
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toMillis() || Date.now(),
          updatedAt: data.updatedAt?.toMillis() || Date.now()
        });
      });
      
      // Convert Firebase format to POS format and merge with existing rules
      const convertedRules = firebasePromos
        .filter(p => p.active && (p.type === 'percent_cart' || p.type === 'fixed_discount' || p.type === 'percent_items'))
        .map(p => {
          // Convert Firebase channels array to POS channels object
          const channels = {};
          const channelMap = {
            'dine-in': 'table',
            'togo': 'togo',
            'online': 'online',
            'delivery': 'delivery',
            'table-order': 'tableOrder',
            'kiosk': 'kiosk'
          };
          (p.channels || []).forEach(ch => {
            const posChannel = channelMap[ch] || ch;
            channels[posChannel] = true;
          });
          
          return {
            id: `firebase_${p.id}`,
            name: p.name || 'Firebase Promotion',
            code: '',
            startDate: p.validFrom || '',
            endDate: p.validUntil || '',
            startTime: '',
            endTime: '',
            mode: (p.type === 'percent_cart' || p.type === 'percent_items') ? 'percent' : 'amount',
            value: p.discountPercent || p.discountAmount || 0,
            minSubtotal: p.minOrderAmount || 0,
            eligibleItemIds: p.selectedItems || [],
            daysOfWeek: [],
            dateAlways: !p.validFrom && !p.validUntil,
            timeAlways: true,
            enabled: true,
            createdAt: p.createdAt || Date.now(),
            channels: channels,
            firebaseId: p.id // Keep reference to original Firebase ID
          };
        });
      
      if (convertedRules.length === 0) {
        return res.json({ ok: true, synced: 0, message: 'No active promotions found in Firebase' });
      }
      
      // Get existing rules
      await ensureTable();
      const existingRows = await all('SELECT * FROM discount_promotions ORDER BY created_at DESC');
      const existingRules = existingRows.map(r => ({
        id: r.id,
        name: r.name || '',
        code: r.code || '',
        startDate: r.start_date || '',
        endDate: r.end_date || '',
        startTime: r.start_time || '',
        endTime: r.end_time || '',
        mode: (r.mode === 'amount' ? 'amount' : 'percent'),
        value: Number(r.value || 0),
        minSubtotal: Number(r.min_subtotal || 0),
        eligibleItemIds: (()=>{ try { return JSON.parse(r.eligible_item_ids||'[]'); } catch { return []; } })(),
        daysOfWeek: (()=>{ try { return JSON.parse(r.days_of_week||'[]'); } catch { return []; } })(),
        dateAlways: !!r.date_always,
        timeAlways: !!r.time_always,
        enabled: (r.enabled == null ? true : !!r.enabled),
        createdAt: Number(r.created_at || 0),
        channels: (()=>{ try { return JSON.parse(r.channels_json||'{}'); } catch { return {}; } })()
      }));
      
      // Merge: remove old firebase_ rules, add new ones
      const nonFirebaseRules = existingRules.filter(r => !r.id.startsWith('firebase_'));
      const mergedRules = [...convertedRules, ...nonFirebaseRules];
      
      // Save merged rules (need to add channels_json column support)
      await exec('BEGIN TRANSACTION');
      await run('DELETE FROM discount_promotions');
      
      // Check if channels_json column exists, add if not
      try {
        await exec('ALTER TABLE discount_promotions ADD COLUMN channels_json TEXT');
      } catch (e) { /* column already exists */ }
      
      const stmt = db.prepare(`INSERT INTO discount_promotions (
        id, name, code, start_date, end_date, start_time, end_time, mode, value, min_subtotal,
        eligible_item_ids, days_of_week, date_always, time_always, enabled, created_at, channels_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      
      for (const r of mergedRules) {
        const row = [
          String(r.id),
          String(r.name||''),
          String(r.code||''),
          String(r.startDate||''),
          String(r.endDate||''),
          String(r.startTime||''),
          String(r.endTime||''),
          (r.mode==='amount'?'amount':'percent'),
          Number(r.value||0),
          Number(r.minSubtotal||0),
          JSON.stringify(Array.isArray(r.eligibleItemIds)?r.eligibleItemIds:[]),
          JSON.stringify(Array.isArray(r.daysOfWeek)?r.daysOfWeek:[]),
          r.dateAlways?1:0,
          r.timeAlways?1:0,
          (r.enabled===false?0:1),
          Number(r.createdAt||Date.now()),
          JSON.stringify(r.channels || {})
        ];
        await new Promise((resolve, reject) => stmt.run(row, (err)=> err?reject(err):resolve()));
      }
      await new Promise((resolve) => stmt.finalize(()=>resolve()));
      await exec('COMMIT');
      
      res.json({ 
        ok: true, 
        synced: convertedRules.length, 
        total: mergedRules.length,
        message: `Synced ${convertedRules.length} promotions from Firebase` 
      });
    } catch (e) {
      try { await exec('ROLLBACK'); } catch {}
      console.error('POST /promotions/sync-from-firebase failed:', e);
      res.status(500).json({ error: 'failed_to_sync_from_firebase', message: e.message });
    }
  });

  // Get promotion rules for a specific channel (for online/table orders)
  router.get('/rules/:channel', async (req, res) => {
    try {
      const { channel } = req.params;
      await ensureTable();
      
      // Check if channels_json column exists
      try {
        await exec('ALTER TABLE discount_promotions ADD COLUMN channels_json TEXT');
      } catch (e) { /* column already exists */ }
      
      const rows = await all('SELECT * FROM discount_promotions WHERE enabled = 1 ORDER BY created_at DESC');
      const allRules = rows.map(r => ({
        id: r.id,
        name: r.name || '',
        code: r.code || '',
        startDate: r.start_date || '',
        endDate: r.end_date || '',
        startTime: r.start_time || '',
        endTime: r.end_time || '',
        mode: (r.mode === 'amount' ? 'amount' : 'percent'),
        value: Number(r.value || 0),
        minSubtotal: Number(r.min_subtotal || 0),
        eligibleItemIds: (()=>{ try { return JSON.parse(r.eligible_item_ids||'[]'); } catch { return []; } })(),
        daysOfWeek: (()=>{ try { return JSON.parse(r.days_of_week||'[]'); } catch { return []; } })(),
        dateAlways: !!r.date_always,
        timeAlways: !!r.time_always,
        enabled: true,
        createdAt: Number(r.created_at || 0),
        channels: (()=>{ try { return JSON.parse(r.channels_json||'{}'); } catch { return {}; } })()
      }));
      
      // Filter by channel - include rules that have no channels defined (applies to all) or have the specific channel enabled
      const channelMap = {
        'online': 'online',
        'table-order': 'tableOrder',
        'togo': 'togo',
        'dine-in': 'table',
        'delivery': 'delivery',
        'kiosk': 'kiosk'
      };
      const posChannel = channelMap[channel] || channel;
      
      const filteredRules = allRules.filter(r => {
        if (!r.channels || Object.keys(r.channels).length === 0) return true;
        return !!r.channels[posChannel];
      });
      
      res.json(filteredRules);
    } catch (e) {
      console.error('GET /promotions/rules/:channel failed:', e);
      res.status(500).json({ error: 'failed_to_load_rules', message: e.message });
    }
  });

  return router;
}; 