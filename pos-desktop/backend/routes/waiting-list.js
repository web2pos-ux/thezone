const express = require('express');
const router = express.Router();

// 공유 데이터베이스 모듈 사용 (환경 변수 DB_PATH 지원 - Electron 앱 호환)
const { db, dbRun, dbAll, dbGet } = require('../db');

// Ensure waiting_list table
const ensureTable = async () => {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS waiting_list (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      phone_number TEXT,
      party_size INTEGER NOT NULL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','notified','seated','cancelled')),
      table_number TEXT,
      reservation_id INTEGER,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      notified_at DATETIME,
      seated_at DATETIME,
      cancelled_at DATETIME,
      expires_at DATETIME,
      sms_count INTEGER NOT NULL DEFAULT 0
    )
  `);
  // Backfill expires_at for existing rows
  await dbRun(`UPDATE waiting_list SET expires_at = DATETIME(joined_at, '+2 hours') WHERE expires_at IS NULL`);
  // Add sms_count column if missing (best-effort)
  try {
    await dbRun(`ALTER TABLE waiting_list ADD COLUMN sms_count INTEGER NOT NULL DEFAULT 0`);
  } catch (e) {
    // ignore if already exists
  }
};

ensureTable().catch(()=>{});

// Clean expired entries (older than 2 hours)
const cleanupExpired = async () => {
  await ensureTable();
  await dbRun(`DELETE FROM waiting_list WHERE status = 'waiting' AND expires_at IS NOT NULL AND DATETIME('now') >= expires_at`);
};

// List waiting entries (ordered by join time)
router.get('/', async (req, res) => {
  try {
    await cleanupExpired();
    const rows = await dbAll(`
      SELECT *, (strftime('%s','now') - strftime('%s', joined_at)) AS waiting_seconds
      FROM waiting_list
      WHERE status IN ('waiting','notified')
      ORDER BY joined_at ASC, id ASC
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// List processed entries: cancelled, seated, or notified with sms_count >= 2
router.get('/processed', async (req, res) => {
  try {
    await ensureTable();
    const rows = await dbAll(`
      SELECT *,
        CASE
          WHEN status = 'cancelled' THEN 0
          WHEN status = 'seated' THEN 1
          WHEN status = 'notified' AND COALESCE(sms_count,0) >= 2 THEN 2
          ELSE 3
        END AS grp,
        COALESCE(seated_at, cancelled_at, notified_at, joined_at) AS ts
      FROM waiting_list
      WHERE status IN ('cancelled','seated') OR (status = 'notified' AND COALESCE(sms_count,0) >= 2)
      ORDER BY grp ASC, datetime(ts) DESC, id DESC
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create new waiting entry
router.post('/', async (req, res) => {
  try {
    const { customer_name, phone_number, party_size, notes } = req.body || {};
    if (!customer_name || !(Number(party_size) > 0)) {
      return res.status(400).json({ error: 'customer_name and party_size are required' });
    }
    await ensureTable();
    const result = await dbRun(`
      INSERT INTO waiting_list (customer_name, phone_number, party_size, notes, status, expires_at)
      VALUES (?, ?, ?, ?, 'waiting', DATETIME(CURRENT_TIMESTAMP, '+2 hours'))
    `, [customer_name.trim(), (phone_number||'').trim(), Number(party_size), notes||'']);
    const row = await dbGet('SELECT * FROM waiting_list WHERE id = ?', [result.lastID]);
    res.status(201).json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update waiting entry (name/phone/party/notes)
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { customer_name, phone_number, party_size, notes, status } = req.body || {};
    await ensureTable();
    await dbRun(`
      UPDATE waiting_list
      SET customer_name = COALESCE(?, customer_name),
          phone_number = COALESCE(?, phone_number),
          party_size = COALESCE(?, party_size),
          notes = COALESCE(?, notes),
          status = COALESCE(?, status),
          expires_at = CASE WHEN ? IS NOT NULL THEN DATETIME(CURRENT_TIMESTAMP, '+2 hours') ELSE expires_at END,
          notified_at = CASE WHEN ? = 'notified' THEN CURRENT_TIMESTAMP ELSE notified_at END,
          seated_at = CASE WHEN ? = 'seated' THEN CURRENT_TIMESTAMP ELSE seated_at END,
          cancelled_at = CASE WHEN ? = 'cancelled' THEN CURRENT_TIMESTAMP ELSE cancelled_at END
      WHERE id = ?
    `, [customer_name, phone_number, party_size, notes, status, status, status, status, status, id]);
    const row = await dbGet('SELECT * FROM waiting_list WHERE id = ?', [id]);
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Cancel waiting entry
router.post('/:id/cancel', async (req, res) => {
  try {
    const { id } = req.params;
    await dbRun(`UPDATE waiting_list SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete waiting entry
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await dbRun('DELETE FROM waiting_list WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Assign to table (seat)
router.post('/:id/assign', async (req, res) => {
  try {
    const { id } = req.params;
    const { table_number } = req.body || {};
    await dbRun(`
      UPDATE waiting_list
      SET table_number = ?, status = 'seated', seated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [table_number || null, id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Notify (SMS stub)
router.post('/:id/notify', async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body || {};
    // TODO: integrate an SMS provider; for now, log only
    const row = await dbGet('SELECT * FROM waiting_list WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    console.log('[WAITING_SMS]', { to: row.phone_number, message: message || 'Your table is ready.' });
    await dbRun(`
      UPDATE waiting_list
      SET status = 'notified',
          notified_at = CURRENT_TIMESTAMP,
          sms_count = COALESCE(sms_count, 0) + 1
      WHERE id = ?
    `, [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Convert reservation to waiting entry
router.post('/from-reservation/:reservationId', async (req, res) => {
  try {
    const { reservationId } = req.params;
    const r = await dbGet('SELECT id, customer_name, phone_number, party_size FROM reservations WHERE id = ?', [reservationId]);
    if (!r) return res.status(404).json({ error: 'Reservation not found' });
    const result = await dbRun(`
      INSERT INTO waiting_list (customer_name, phone_number, party_size, notes, status, reservation_id, expires_at)
      VALUES (?, ?, ?, ?, 'waiting', ?, DATETIME(CURRENT_TIMESTAMP, '+2 hours'))
    `, [r.customer_name, r.phone_number, r.party_size, 'Converted from reservation', r.id]);
    const row = await dbGet('SELECT * FROM waiting_list WHERE id = ?', [result.lastID]);
    res.status(201).json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Export CSV
router.get('/export.csv', async (req, res) => {
  try {
    await cleanupExpired();
    const rows = await dbAll(`
      SELECT id, customer_name, phone_number, party_size, notes, status, table_number, reservation_id, joined_at, notified_at, seated_at, cancelled_at, COALESCE(sms_count,0) AS sms_count
      FROM waiting_list
      ORDER BY joined_at ASC
    `);
    const header = ['id','customer_name','phone_number','party_size','notes','status','table_number','reservation_id','joined_at','notified_at','seated_at','cancelled_at','sms_count'];
    const csv = [header.join(',')].concat(rows.map(r => header.map(k => {
      const s = r[k] == null ? '' : String(r[k]);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g,'""') + '"';
      return s;
    }).join(','))).join('\n');
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename="waiting_list.csv"');
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;


