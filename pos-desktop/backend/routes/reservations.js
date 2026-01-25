const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const XLSX = require('xlsx');

// Test route to verify the router is working
router.get('/test', (req, res) => {
  res.json({ message: 'Reservations router is working!' });
});

// Database connection
const dbPath = path.resolve(__dirname, '..', '..', 'db', 'web2pos.db');
const db = new sqlite3.Database(dbPath);

// Helper functions for database operations
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

// Initialize reservation tables
const initializeReservationTables = async () => {
  try {
    // 1. Business Hours Table (영업시간 설정)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS business_hours (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        day_of_week INTEGER NOT NULL, -- 0=Sunday, 1=Monday, ..., 6=Saturday
        open_time TEXT NOT NULL, -- HH:MM format
        close_time TEXT NOT NULL, -- HH:MM format
        is_open BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Table Settings Table (테이블별 예약 설정)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS table_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_number TEXT NOT NULL UNIQUE,
        table_name TEXT,
        is_reservable BOOLEAN DEFAULT 1,
        min_capacity INTEGER DEFAULT 1,
        max_capacity INTEGER DEFAULT 10,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. Reservations Table (예약 정보)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reservation_number TEXT UNIQUE NOT NULL,
        customer_name TEXT NOT NULL,
        phone_number TEXT NOT NULL,
        reservation_date DATE NOT NULL,
        reservation_time TIME NOT NULL,
        party_size INTEGER NOT NULL,
        table_number TEXT,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'cancelled', 'completed', 'no_show')),
        special_requests TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 4. Reservation Time Slots Table (예약 가능 시간대)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS reservation_time_slots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        time_slot TEXT NOT NULL UNIQUE, -- HH:MM format
        is_available BOOLEAN DEFAULT 1,
        max_reservations INTEGER DEFAULT 10,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('Reservation tables initialized successfully');
  } catch (error) {
    console.error('Error initializing reservation tables:', error);
    // Don't throw error, just log it
  }
};

// Initialize tables when module loads
initializeReservationTables().catch(error => {
  console.error('Failed to initialize reservation tables:', error);
});

// Force table initialization on first request
let tablesInitialized = false;
const ensureTablesExist = async () => {
  if (!tablesInitialized) {
    try {
      await initializeReservationTables();
      tablesInitialized = true;
      console.log('Tables initialized on first request');
    } catch (error) {
      console.error('Failed to initialize tables on first request:', error);
    }
  }
};

// Generate unique reservation number
const generateReservationNumber = () => {
  const timestamp = Date.now().toString();
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `RES${timestamp.slice(-6)}${random}`;
};

// ===== BUSINESS HOURS API =====

// Get business hours
router.get('/business-hours', async (req, res) => {
  try {
    const hours = await dbAll('SELECT * FROM business_hours ORDER BY day_of_week');
    res.json(hours);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update business hours
router.put('/business-hours', async (req, res) => {
  try {
    const { businessHours } = req.body;
    
    for (const hour of businessHours) {
      await dbRun(`
        INSERT OR REPLACE INTO business_hours 
        (day_of_week, open_time, close_time, is_open, updated_at) 
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [hour.day_of_week, hour.open_time, hour.close_time, hour.is_open]);
    }
    
    res.json({ message: 'Business hours updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== TABLE SETTINGS API =====

// Get all table settings
router.get('/table-settings', async (req, res) => {
  try {
    const tables = await dbAll('SELECT * FROM table_settings ORDER BY table_number');
    res.json(tables);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create table setting
router.post('/table-settings', async (req, res) => {
  try {
    const { table_number, table_name, is_reservable, min_capacity, max_capacity } = req.body;
    
    const result = await dbRun(`
      INSERT INTO table_settings 
      (table_number, table_name, is_reservable, min_capacity, max_capacity) 
      VALUES (?, ?, ?, ?, ?)
    `, [table_number, table_name, is_reservable, min_capacity, max_capacity]);
    
    res.json({ 
      id: result.lastID, 
      message: 'Table setting created successfully' 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update table setting
router.put('/table-settings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { table_number, table_name, is_reservable, min_capacity, max_capacity } = req.body;
    
    await dbRun(`
      UPDATE table_settings 
      SET table_number = ?, table_name = ?, is_reservable = ?, 
          min_capacity = ?, max_capacity = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [table_number, table_name, is_reservable, min_capacity, max_capacity, id]);
    
    res.json({ message: 'Table setting updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete table setting
router.delete('/table-settings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await dbRun('DELETE FROM table_settings WHERE id = ?', [id]);
    res.json({ message: 'Table setting deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== RESERVATIONS API =====

// Get all reservations with filters
router.get('/reservations', async (req, res) => {
  try {
    console.log('GET /reservations called');
    
    // Ensure tables exist
    await ensureTablesExist();
    
    const { 
      date, 
      status, 
      search, 
      start_date, 
      end_date,
      time_slot 
    } = req.query;
    
    let sql = `
      SELECT r.*, ts.table_name 
      FROM reservations r 
      LEFT JOIN table_settings ts ON r.table_number = ts.table_number
      WHERE 1=1
    `;
    const params = [];
    
    if (date) {
      sql += ' AND r.reservation_date = ?';
      params.push(date);
    }
    
    if (status && status !== 'all') {
      sql += ' AND r.status = ?';
      params.push(status);
    }
    
    if (search) {
      sql += ' AND (r.customer_name LIKE ? OR r.phone_number LIKE ? OR r.reservation_number LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }
    
    if (start_date && end_date) {
      sql += ' AND r.reservation_date BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }
    
    if (time_slot) {
      sql += ' AND r.reservation_time = ?';
      params.push(time_slot);
    }
    
    sql += ' ORDER BY r.reservation_date DESC, r.reservation_time ASC';
    
    console.log('Executing SQL:', sql, 'with params:', params);
    const reservations = await dbAll(sql, params);
    console.log('Found reservations:', reservations.length);
    res.json(reservations);
  } catch (error) {
    console.error('Error in GET /reservations:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get reservation by ID
router.get('/reservations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const reservation = await dbGet(`
      SELECT r.*, ts.table_name 
      FROM reservations r 
      LEFT JOIN table_settings ts ON r.table_number = ts.table_number
      WHERE r.id = ?
    `, [id]);
    
    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }
    
    res.json(reservation);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new reservation
router.post('/reservations', async (req, res) => {
  try {
    const {
      customer_name,
      phone_number,
      reservation_date,
      reservation_time,
      party_size,
      table_number,
      special_requests
    } = req.body;
    
    // Validate table capacity
    if (table_number) {
      const tableSetting = await dbGet(
        'SELECT * FROM table_settings WHERE table_number = ?',
        [table_number]
      );
      
      if (tableSetting) {
        if (party_size < tableSetting.min_capacity || party_size > tableSetting.max_capacity) {
          return res.status(400).json({
            error: `Party size must be between ${tableSetting.min_capacity} and ${tableSetting.max_capacity} for this table`
          });
        }
      }
    }
    
    // Check time slot capacity (max reservations)
    const slot = await dbGet(
      'SELECT * FROM reservation_time_slots WHERE time_slot = ? AND is_available = 1',
      [reservation_time]
    );
    // fallback to policy if slot not found
    let maxPerSlot = slot?.max_reservations;
    if (!slot) {
      const policy = await dbGet(`SELECT peak_start, peak_end, peak_max_per_slot, normal_max_per_slot FROM reservation_policy LIMIT 1`).catch(()=>null);
      if (policy) {
        const withinPeak = reservation_time >= policy.peak_start && reservation_time < policy.peak_end;
        maxPerSlot = withinPeak ? (policy.peak_max_per_slot||0) : (policy.normal_max_per_slot||0);
      }
    }
    if (maxPerSlot != null) {
      const { count } = await dbGet(`
        SELECT COUNT(*) as count FROM reservations
        WHERE reservation_date = ? AND reservation_time = ? AND status != 'cancelled'
      `, [reservation_date, reservation_time]);

      // Channel quotas (if policy exists)
      let withinQuota = true;
      const policy = await dbGet(`SELECT online_quota_pct, phone_quota_pct, walkin_quota_pct FROM reservation_policy LIMIT 1`).catch(()=>null);
      const channel = (req.body?.channel || '').toUpperCase();
      if (policy && maxPerSlot > 0 && channel) {
        const quotaPct = channel === 'ONLINE' ? policy.online_quota_pct : channel === 'PHONE' ? policy.phone_quota_pct : policy.walkin_quota_pct;
        const channelMax = Math.floor((quotaPct * maxPerSlot) / 100);
        const { count: channelCount } = await dbGet(`
          SELECT COUNT(*) as count FROM reservations
          WHERE reservation_date = ? AND reservation_time = ? AND status != 'cancelled' AND UPPER(COALESCE(json_extract(special_requests,'$.channel'),'')) = ?
        `, [reservation_date, reservation_time, channel]);
        if (channelCount >= channelMax) withinQuota = false;
      }

      if (count >= maxPerSlot || !withinQuota) {
        return res.status(400).json({ error: 'This time slot is fully booked' });
      }
    }
    
    const reservation_number = generateReservationNumber();
    
    const result = await dbRun(`
      INSERT INTO reservations 
      (reservation_number, customer_name, phone_number, reservation_date, 
       reservation_time, party_size, table_number, special_requests) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [reservation_number, customer_name, phone_number, reservation_date, 
         reservation_time, party_size, table_number, special_requests]);
    
    const newReservation = await dbGet('SELECT * FROM reservations WHERE id = ?', [result.lastID]);
    
    res.status(201).json({
      message: 'Reservation created successfully',
      reservation: newReservation
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update reservation
router.put('/reservations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      customer_name,
      phone_number,
      reservation_date,
      reservation_time,
      party_size,
      table_number,
      status,
      special_requests
    } = req.body;
    
    await dbRun(`
      UPDATE reservations 
      SET customer_name = ?, phone_number = ?, reservation_date = ?, 
          reservation_time = ?, party_size = ?, table_number = ?, 
          status = ?, special_requests = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [customer_name, phone_number, reservation_date, reservation_time, 
         party_size, table_number, status, special_requests, id]);
    
    res.json({ message: 'Reservation updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete reservation
router.delete('/reservations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await dbRun('DELETE FROM reservations WHERE id = ?', [id]);
    res.json({ message: 'Reservation deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update reservation status
router.patch('/reservations/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    await dbRun(`
      UPDATE reservations 
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [status, id]);
    
    res.json({ message: 'Reservation status updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark reservation as no_show
router.patch('/reservations/:id/no-show', async (req, res) => {
  try {
    const { id } = req.params;
    await dbRun(`
      UPDATE reservations
      SET status = 'no_show', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [id]);
    res.json({ message: 'Reservation marked as no_show' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rebook cancelled or no_show reservation (복구 기능)
router.patch('/reservations/:id/rebook', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if reservation exists and is cancelled
    const reservation = await dbGet('SELECT * FROM reservations WHERE id = ?', [id]);
    
    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }
    
    if (reservation.status !== 'cancelled' && reservation.status !== 'no_show') {
      return res.status(400).json({ error: 'Only cancelled or no_show reservations can be rebooked' });
    }
    
    // Update status to pending
    await dbRun(`
      UPDATE reservations 
      SET status = 'pending', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [id]);
    
    res.json({ message: 'Reservation rebooked successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reschedule reservation (date/time 변경)
router.patch('/reservations/:id/reschedule', async (req, res) => {
  try {
    const { id } = req.params;
    const { reservation_date, reservation_time } = req.body || {};
    if (!reservation_date || !reservation_time) {
      return res.status(400).json({ error: 'reservation_date and reservation_time are required' });
    }

    // 용량 체크: cancelled, no_show 제외
    const slot = await dbGet(
      'SELECT * FROM reservation_time_slots WHERE time_slot = ? AND is_available = 1',
      [reservation_time]
    );
    let maxPerSlot = slot?.max_reservations;
    if (!slot) {
      const policy = await dbGet(`SELECT peak_start, peak_end, peak_max_per_slot, normal_max_per_slot FROM reservation_policy LIMIT 1`).catch(()=>null);
      if (policy) {
        const withinPeak = reservation_time >= policy.peak_start && reservation_time < policy.peak_end;
        maxPerSlot = withinPeak ? (policy.peak_max_per_slot||0) : (policy.normal_max_per_slot||0);
      }
    }
    if (maxPerSlot != null) {
      const { count } = await dbGet(`
        SELECT COUNT(*) as count FROM reservations
        WHERE reservation_date = ? AND reservation_time = ? AND status NOT IN ('cancelled','no_show')
      `, [reservation_date, reservation_time]);
      if (count >= maxPerSlot) {
        return res.status(400).json({ error: 'This time slot is fully booked' });
      }
    }

    await dbRun(`
      UPDATE reservations
      SET reservation_date = ?, reservation_time = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [reservation_date, reservation_time, id]);

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== TIME SLOTS API =====

// Get available time slots
router.get('/time-slots', async (req, res) => {
  try {
    const { date } = req.query;
    
    if (!date) {
      return res.status(400).json({ error: 'Date parameter is required' });
    }
    
    // Get business hours for the day
    const dayOfWeek = new Date(date).getDay();
    const businessHours = await dbGet(
      'SELECT * FROM business_hours WHERE day_of_week = ? AND is_open = 1',
      [dayOfWeek]
    );
    
    if (!businessHours) {
      return res.json([]); // Closed on this day
    }
    
    // Get all time slots
    const timeSlots = await dbAll('SELECT * FROM reservation_time_slots WHERE is_available = 1');
    
    // Get existing reservations for the date
    const existingReservations = await dbAll(`
      SELECT reservation_time, COUNT(*) as count 
      FROM reservations 
      WHERE reservation_date = ? AND status != 'cancelled'
      GROUP BY reservation_time
    `, [date]);
    
    const reservationCounts = {};
    existingReservations.forEach(res => {
      reservationCounts[res.reservation_time] = res.count;
    });
    
    // Filter available time slots
    const availableSlots = timeSlots.filter(slot => {
      const slotTime = slot.time_slot;
      const openTime = businessHours.open_time;
      const closeTime = businessHours.close_time;
      
      // Check if slot is within business hours
      if (slotTime < openTime || slotTime >= closeTime) {
        return false;
      }
      
      // Check if slot has reached max reservations
      const currentCount = reservationCounts[slotTime] || 0;
      return currentCount < slot.max_reservations;
    });
    
    res.json(availableSlots);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all time slots (admin)
router.get('/time-slots/all', async (req, res) => {
  try {
    const timeSlots = await dbAll('SELECT * FROM reservation_time_slots ORDER BY time_slot');
    res.json(timeSlots);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update time slot
router.put('/time-slots/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { time_slot, is_available, max_reservations } = req.body;
    
    await dbRun(`
      UPDATE reservation_time_slots 
      SET time_slot = ?, is_available = ?, max_reservations = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [time_slot, is_available, max_reservations, id]);
    
    res.json({ message: 'Time slot updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== STATISTICS API =====

// Get reservation statistics
router.get('/statistics', async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    let dateFilter = '';
    const params = [];
    
    if (start_date && end_date) {
      dateFilter = 'WHERE reservation_date BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }
    
    const stats = await dbGet(`
      SELECT 
        COUNT(*) as total_reservations,
        COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed
      FROM reservations ${dateFilter}
    `, params);
    
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== EXPORT API =====

// Build base query for exporting reservations within date range and optional status
const buildExportQuery = (q) => {
  const { start_date, end_date, status = 'all' } = q || {};
  let sql = `
    SELECT r.id, r.reservation_number, r.customer_name, r.phone_number,
           r.reservation_date, r.reservation_time, r.party_size,
           r.table_number, r.status, r.special_requests, r.created_at, r.updated_at,
           COALESCE(ts.table_name, '') AS table_name
    FROM reservations r
    LEFT JOIN table_settings ts ON r.table_number = ts.table_number
    WHERE 1=1
  `;
  const params = [];
  if (start_date && end_date) {
    sql += ' AND r.reservation_date BETWEEN ? AND ?';
    params.push(start_date, end_date);
  }
  if (status && status !== 'all') {
    sql += ' AND r.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY r.reservation_date ASC, r.reservation_time ASC, r.id ASC';
  return { sql, params };
};

// CSV export
router.get('/export.csv', async (req, res) => {
  try {
    const { sql, params } = buildExportQuery(req.query);
    const rows = await dbAll(sql, params);

    const header = [
      'id','reservation_number','customer_name','phone_number','reservation_date','reservation_time',
      'party_size','table_number','table_name','status','special_requests','created_at','updated_at'
    ];
    const csvLines = [header.join(',')];
    for (const r of rows) {
      const values = [
        r.id,
        r.reservation_number,
        r.customer_name,
        r.phone_number,
        r.reservation_date,
        r.reservation_time,
        r.party_size,
        r.table_number || '',
        r.table_name || '',
        r.status,
        r.special_requests ? String(r.special_requests).replace(/\n/g,' ').replace(/"/g,'""') : '',
        r.created_at,
        r.updated_at
      ].map(v => {
        const s = v == null ? '' : String(v);
        // wrap with quotes if contains comma or quotes
        if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g,'""') + '"';
        return s;
      });
      csvLines.push(values.join(','));
    }

    const filename = `reservations_${Date.now()}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvLines.join('\n'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// XLSX export
router.get('/export.xlsx', async (req, res) => {
  try {
    const { sql, params } = buildExportQuery(req.query);
    const rows = await dbAll(sql, params);

    const data = rows.map(r => ({
      ID: r.id,
      ReservationNumber: r.reservation_number,
      CustomerName: r.customer_name,
      PhoneNumber: r.phone_number,
      Date: r.reservation_date,
      Time: r.reservation_time,
      PartySize: r.party_size,
      TableNumber: r.table_number || '',
      TableName: r.table_name || '',
      Status: r.status,
      SpecialRequests: r.special_requests || '',
      CreatedAt: r.created_at,
      UpdatedAt: r.updated_at
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Reservations');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });

    const filename = `reservations_${Date.now()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router; 