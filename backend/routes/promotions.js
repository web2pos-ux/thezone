const express = require('express');

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
        createdAt: Number(r.created_at || 0)
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
      const body = Array.isArray(req.body) ? req.body : [];
      await exec('BEGIN TRANSACTION');
      await run('DELETE FROM discount_promotions');
      const stmt = db.prepare(`INSERT INTO discount_promotions (
        id, name, code, start_date, end_date, start_time, end_time, mode, value, min_subtotal,
        eligible_item_ids, days_of_week, date_always, time_always, enabled, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
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
          Number(r.createdAt||Date.now())
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

  return router;
}; 