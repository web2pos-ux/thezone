const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const multer = require('multer');

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

// Simple role guard (expects X-Role header: ADMIN or MANAGER)
function requireManager(req, res, next) {
  try {
    const role = String(req.headers['x-role'] || '').toUpperCase();
    if (role === 'ADMIN' || role === 'MANAGER') return next();
  } catch {}
  return res.status(403).json({ error: 'Forbidden: Manager or Admin required' });
}

// Initialize channel settings table for per-channel defaults (e.g., TOGO)
async function initChannelSettings() {
  try {
    await dbRun(`CREATE TABLE IF NOT EXISTS channel_settings (
      channel TEXT PRIMARY KEY,
      discount_enabled INTEGER DEFAULT 0,
      discount_mode TEXT DEFAULT 'percent',
      discount_value REAL DEFAULT 0,
      bag_fee_enabled INTEGER DEFAULT 0,
      bag_fee_mode TEXT DEFAULT 'amount',
      bag_fee_value REAL DEFAULT 0,
      discount_stage TEXT DEFAULT 'pre-tax',
      bag_fee_taxable INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    const cols = await dbAll("PRAGMA table_info(channel_settings)");
    const names = cols.map(c => String(c.name));
    if (!names.includes('discount_scope')) {
      await dbRun("ALTER TABLE channel_settings ADD COLUMN discount_scope TEXT DEFAULT 'all'");
    }
    if (!names.includes('discount_item_ids')) {
      await dbRun("ALTER TABLE channel_settings ADD COLUMN discount_item_ids TEXT");
    }
    if (!names.includes('discount_category_ids')) {
      await dbRun("ALTER TABLE channel_settings ADD COLUMN discount_category_ids TEXT");
    }
  } catch (e) {
    // ignore if duplicate column errors occur
    try { console.warn('initChannelSettings warning:', e && e.message ? e.message : e); } catch {}
  }
}

initChannelSettings();

// Initialize business profile table
async function initBusinessProfile() {
  try {
    await dbRun(`CREATE TABLE IF NOT EXISTS business_profile (
      id INTEGER PRIMARY KEY CHECK(id=1),
      business_name TEXT,
      tax_number TEXT,
      phone TEXT,
      address_line1 TEXT,
      address_line2 TEXT,
      city TEXT,
      state TEXT,
      zip TEXT,
      logo_url TEXT,
      firebase_restaurant_id TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    // Ensure singleton row exists
    const row = await dbGet('SELECT id FROM business_profile WHERE id = 1');
    if (!row) {
      await dbRun('INSERT INTO business_profile (id, business_name) VALUES (1, "")');
    }
    // Add firebase_restaurant_id column if not exists
    const cols = await dbAll("PRAGMA table_info(business_profile)");
    const colNames = cols.map(c => String(c.name));
    if (!colNames.includes('firebase_restaurant_id')) {
      await dbRun("ALTER TABLE business_profile ADD COLUMN firebase_restaurant_id TEXT");
    }
  } catch (e) {
    try { console.warn('initBusinessProfile warning:', e && e.message ? e.message : e); } catch {}
  }
}

initBusinessProfile();

// Multer for logo uploads (store under backend/uploads/logos)
const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      const dir = path.resolve(__dirname, '..', 'uploads', 'logos');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    } catch (e) {
      cb(e, undefined);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '.png';
    const ts = Date.now();
    cb(null, `business_logo_${ts}${ext}`);
  }
});
const logoUpload = multer({ storage: logoStorage });

// ===== BUSINESS PROFILE =====
// Get business profile
router.get('/business-profile', async (req, res) => {
  try {
    const row = await dbGet('SELECT * FROM business_profile WHERE id = 1');
    res.json(row || null);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update business profile
router.put('/business-profile', requireManager, async (req, res) => {
  try {
    const p = req.body || {};
    await dbRun(`INSERT INTO business_profile (
      id, business_name, tax_number, phone, address_line1, address_line2, city, state, zip, firebase_restaurant_id, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      business_name = excluded.business_name,
      tax_number = excluded.tax_number,
      phone = excluded.phone,
      address_line1 = excluded.address_line1,
      address_line2 = excluded.address_line2,
      city = excluded.city,
      state = excluded.state,
      zip = excluded.zip,
      firebase_restaurant_id = excluded.firebase_restaurant_id,
      updated_at = CURRENT_TIMESTAMP
    `, [
      String(p.business_name || ''),
      String(p.tax_number || ''),
      String(p.phone || ''),
      String(p.address_line1 || ''),
      String(p.address_line2 || ''),
      String(p.city || ''),
      String(p.state || ''),
      String(p.zip || ''),
      p.firebase_restaurant_id ? String(p.firebase_restaurant_id) : null,
    ]);
    const saved = await dbGet('SELECT * FROM business_profile WHERE id = 1');
    res.json({ success: true, profile: saved });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Upload logo
router.post('/business-profile/logo', requireManager, logoUpload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const imageUrl = `/uploads/logos/${req.file.filename}`;
    await dbRun(`INSERT INTO business_profile (id, logo_url)
      VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET logo_url = excluded.logo_url, updated_at = CURRENT_TIMESTAMP
    `, [imageUrl]);
    const saved = await dbGet('SELECT * FROM business_profile WHERE id = 1');
    res.json({ success: true, imageUrl, profile: saved });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Load channel settings
router.get('/channel-settings/:channel', async (req, res) => {
  try {
    const ch = String(req.params.channel || '').toUpperCase();
    const row = await dbGet('SELECT * FROM channel_settings WHERE channel = ?', [ch]);
    res.json({ channel: ch, settings: row || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Save channel settings (Manager+)
router.post('/channel-settings/:channel', requireManager, async (req, res) => {
  try {
    const ch = String(req.params.channel || '').toUpperCase();
    const s = req.body && req.body.settings ? req.body.settings : {};
    await dbRun(`INSERT INTO channel_settings(
      channel, discount_enabled, discount_mode, discount_value,
      bag_fee_enabled, bag_fee_mode, bag_fee_value, discount_stage, bag_fee_taxable,
      discount_scope, discount_item_ids, discount_category_ids, updated_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(channel) DO UPDATE SET
      discount_enabled=excluded.discount_enabled,
      discount_mode=excluded.discount_mode,
      discount_value=excluded.discount_value,
      bag_fee_enabled=excluded.bag_fee_enabled,
      bag_fee_mode=excluded.bag_fee_mode,
      bag_fee_value=excluded.bag_fee_value,
      discount_stage=excluded.discount_stage,
      bag_fee_taxable=excluded.bag_fee_taxable,
      discount_scope=excluded.discount_scope,
      discount_item_ids=excluded.discount_item_ids,
      discount_category_ids=excluded.discount_category_ids,
      updated_at=CURRENT_TIMESTAMP`, [
      ch,
      s.discount_enabled ? 1 : 0,
      String(s.discount_mode || 'percent'),
      Number(s.discount_value || 0),
      s.bag_fee_enabled ? 1 : 0,
      String(s.bag_fee_mode || 'amount'),
      Number(s.bag_fee_value || 0),
      String(s.discount_stage || 'pre-tax'),
      s.bag_fee_taxable ? 1 : 0,
      String(s.discount_scope || 'all'),
      Array.isArray(s.discount_item_ids) ? String(s.discount_item_ids.join(',')) : String(s.discount_item_ids || ''),
      Array.isArray(s.discount_category_ids) ? String(s.discount_category_ids.join(',')) : String(s.discount_category_ids || '')
    ]);
    const saved = await dbGet('SELECT * FROM channel_settings WHERE channel = ?', [ch]);
    res.json({ success: true, settings: saved });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Initialize reservation settings table
const initializeReservationSettingsTable = async () => {
  try {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS reservation_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        minimum_guests INTEGER DEFAULT 1,
        maximum_guests INTEGER DEFAULT 10,
        minimum_time_in_advance INTEGER DEFAULT 1,
        maximum_time_in_advance INTEGER DEFAULT 30,
        hold_table_for_late_guests INTEGER DEFAULT 15,
        max_reservation_table INTEGER DEFAULT 10,
        reservation_interval INTEGER DEFAULT 30,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Reservation settings table initialized');
  } catch (error) {
    console.error('Error initializing reservation settings table:', error);
  }
};

// Initialize table when module loads
initializeReservationSettingsTable();

// Add new columns to existing table if they don't exist
const addNewColumnsToReservationSettings = async () => {
  try {
    // Check if max_reservation_table column exists
    const columns = await dbAll("PRAGMA table_info(reservation_settings)");
    const columnNames = columns.map(col => col.name);
    
    if (!columnNames.includes('max_reservation_table')) {
      await dbRun('ALTER TABLE reservation_settings ADD COLUMN max_reservation_table INTEGER DEFAULT 10');
      console.log('Added max_reservation_table column');
    }
    
    if (!columnNames.includes('reservation_interval')) {
      await dbRun('ALTER TABLE reservation_settings ADD COLUMN reservation_interval INTEGER DEFAULT 30');
      console.log('Added reservation_interval column');
    }
  } catch (error) {
    console.error('Error adding new columns to reservation_settings:', error);
  }
};

// Run migration
addNewColumnsToReservationSettings();

// ===== ADMIN DASHBOARD =====

// Get admin dashboard data
router.get('/dashboard', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const dashboardData = {
      today: {
        total: await dbGet('SELECT COUNT(*) as count FROM reservations WHERE reservation_date = ?', [today]),
        confirmed: await dbGet('SELECT COUNT(*) as count FROM reservations WHERE reservation_date = ? AND status = "confirmed"', [today]),
        pending: await dbGet('SELECT COUNT(*) as count FROM reservations WHERE reservation_date = ? AND status = "pending"', [today]),
        completed: await dbGet('SELECT COUNT(*) as count FROM reservations WHERE reservation_date = ? AND status = "completed"', [today])
      },
      tomorrow: {
        total: await dbGet('SELECT COUNT(*) as count FROM reservations WHERE reservation_date = ?', [tomorrow]),
        confirmed: await dbGet('SELECT COUNT(*) as count FROM reservations WHERE reservation_date = ? AND status = "confirmed"', [tomorrow]),
        pending: await dbGet('SELECT COUNT(*) as count FROM reservations WHERE reservation_date = ? AND status = "pending"', [tomorrow])
      },
      system: {
        totalTables: await dbGet('SELECT COUNT(*) as count FROM table_settings'),
        reservableTables: await dbGet('SELECT COUNT(*) as count FROM table_settings WHERE is_reservable = 1'),
        totalTimeSlots: await dbGet('SELECT COUNT(*) as count FROM reservation_time_slots'),
        availableTimeSlots: await dbGet('SELECT COUNT(*) as count FROM reservation_time_slots WHERE is_available = 1')
      },
      recentReservations: await dbAll(`
        SELECT * FROM reservations 
        ORDER BY created_at DESC 
        LIMIT 10
      `)
    };
    
    res.json(dashboardData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== BUSINESS HOURS MANAGEMENT =====

// Get business hours with day names
router.get('/business-hours', async (req, res) => {
  try {
    const hours = await dbAll('SELECT * FROM business_hours ORDER BY day_of_week');
    
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const formattedHours = hours.map(hour => ({
      ...hour,
      day_name: dayNames[hour.day_of_week]
    }));
    
    res.json(formattedHours);
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

// ===== TABLE MANAGEMENT =====

// Get all tables with statistics
router.get('/tables', async (req, res) => {
  try {
    const tables = await dbAll(`
      SELECT ts.*, 
             COUNT(r.id) as total_reservations,
             COUNT(CASE WHEN r.status = 'confirmed' THEN 1 END) as confirmed_reservations,
             COUNT(CASE WHEN r.status = 'pending' THEN 1 END) as pending_reservations
      FROM table_settings ts
      LEFT JOIN reservations r ON ts.table_number = r.table_number
      GROUP BY ts.id
      ORDER BY ts.table_number
    `);
    
    res.json(tables);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new table
router.post('/tables', async (req, res) => {
  try {
    const { table_number, table_name, is_reservable, min_capacity, max_capacity } = req.body;
    
    // Check if table number already exists
    const existingTable = await dbGet('SELECT * FROM table_settings WHERE table_number = ?', [table_number]);
    if (existingTable) {
      return res.status(400).json({ error: 'Table number already exists' });
    }
    
    const result = await dbRun(`
      INSERT INTO table_settings 
      (table_number, table_name, is_reservable, min_capacity, max_capacity) 
      VALUES (?, ?, ?, ?, ?)
    `, [table_number, table_name, is_reservable, min_capacity, max_capacity]);
    
    const newTable = await dbGet('SELECT * FROM table_settings WHERE id = ?', [result.lastID]);
    
    res.status(201).json({
      message: 'Table created successfully',
      table: newTable
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update table
router.put('/tables/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { table_number, table_name, is_reservable, min_capacity, max_capacity } = req.body;
    
    // Check if table number already exists (excluding current table)
    const existingTable = await dbGet('SELECT * FROM table_settings WHERE table_number = ? AND id != ?', [table_number, id]);
    if (existingTable) {
      return res.status(400).json({ error: 'Table number already exists' });
    }
    
    await dbRun(`
      UPDATE table_settings 
      SET table_number = ?, table_name = ?, is_reservable = ?, 
          min_capacity = ?, max_capacity = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [table_number, table_name, is_reservable, min_capacity, max_capacity, id]);
    
    res.json({ message: 'Table updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete table
router.delete('/tables/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if table has active reservations
    const table = await dbGet('SELECT table_number FROM table_settings WHERE id = ?', [id]);
    if (table) {
      const activeReservations = await dbGet(`
        SELECT COUNT(*) as count FROM reservations 
        WHERE table_number = ? AND status IN ('pending', 'confirmed')
      `, [table.table_number]);
      
      if (activeReservations.count > 0) {
        return res.status(400).json({ 
          error: 'Cannot delete table with active reservations' 
        });
      }
    }
    
    await dbRun('DELETE FROM table_settings WHERE id = ?', [id]);
    res.json({ message: 'Table deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== TIME SLOTS MANAGEMENT =====

// Get all time slots with statistics
router.get('/time-slots', async (req, res) => {
  try {
    const timeSlots = await dbAll(`
      SELECT ts.*, 
             COUNT(r.id) as total_reservations,
             COUNT(CASE WHEN r.status = 'confirmed' THEN 1 END) as confirmed_reservations,
             COUNT(CASE WHEN r.status = 'pending' THEN 1 END) as pending_reservations
      FROM reservation_time_slots ts
      LEFT JOIN reservations r ON ts.time_slot = r.reservation_time
      GROUP BY ts.id
      ORDER BY ts.time_slot
    `);
    
    res.json(timeSlots);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new time slot
router.post('/time-slots', async (req, res) => {
  try {
    const { time_slot, is_available, max_reservations } = req.body;
    
    // Check if time slot already exists
    const existingSlot = await dbGet('SELECT * FROM reservation_time_slots WHERE time_slot = ?', [time_slot]);
    if (existingSlot) {
      return res.status(400).json({ error: 'Time slot already exists' });
    }
    
    const result = await dbRun(`
      INSERT INTO reservation_time_slots 
      (time_slot, is_available, max_reservations) 
      VALUES (?, ?, ?)
    `, [time_slot, is_available, max_reservations]);
    
    const newTimeSlot = await dbGet('SELECT * FROM reservation_time_slots WHERE id = ?', [result.lastID]);
    
    res.status(201).json({
      message: 'Time slot created successfully',
      timeSlot: newTimeSlot
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update time slot
router.put('/time-slots/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { time_slot, is_available, max_reservations } = req.body;
    
    // Check if time slot already exists (excluding current slot)
    const existingSlot = await dbGet('SELECT * FROM reservation_time_slots WHERE time_slot = ? AND id != ?', [time_slot, id]);
    if (existingSlot) {
      return res.status(400).json({ error: 'Time slot already exists' });
    }
    
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

// Delete time slot
router.delete('/time-slots/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if time slot has active reservations
    const timeSlot = await dbGet('SELECT time_slot FROM reservation_time_slots WHERE id = ?', [id]);
    if (timeSlot) {
      const activeReservations = await dbGet(`
        SELECT COUNT(*) as count FROM reservations 
        WHERE reservation_time = ? AND status IN ('pending', 'confirmed')
      `, [timeSlot.time_slot]);
      
      if (activeReservations.count > 0) {
        return res.status(400).json({ 
          error: 'Cannot delete time slot with active reservations' 
        });
      }
    }
    
    await dbRun('DELETE FROM reservation_time_slots WHERE id = ?', [id]);
    res.json({ message: 'Time slot deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== RESERVATION SETTINGS =====

// Get reservation settings
router.get('/reservation-settings', async (req, res) => {
  try {
    const settings = await dbGet('SELECT * FROM reservation_settings ORDER BY id DESC LIMIT 1');
    res.json({ reservation_settings: settings || null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save reservation settings
router.post('/reservation-settings', async (req, res) => {
  try {
    const { reservation_settings } = req.body;
    
    await dbRun(`
      INSERT OR REPLACE INTO reservation_settings 
      (minimum_guests, maximum_guests, minimum_time_in_advance, maximum_time_in_advance, hold_table_for_late_guests, max_reservation_table, reservation_interval, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      reservation_settings.minimum_guests,
      reservation_settings.maximum_guests,
      reservation_settings.minimum_time_in_advance,
      reservation_settings.maximum_time_in_advance,
      reservation_settings.hold_table_for_late_guests,
      reservation_settings.max_reservation_table,
      reservation_settings.reservation_interval
    ]);
    
    res.json({ message: 'Reservation settings saved successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== SYSTEM SETTINGS =====

// Get system settings
router.get('/system-settings', async (req, res) => {
  try {
    const settings = {
      businessHours: await dbAll('SELECT * FROM business_hours ORDER BY day_of_week'),
      tableSettings: await dbAll('SELECT * FROM table_settings ORDER BY table_number'),
      timeSlots: await dbAll('SELECT * FROM reservation_time_slots ORDER BY time_slot'),
      statistics: await dbGet(`
        SELECT 
          COUNT(*) as total_reservations,
          COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
          COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed
        FROM reservations
      `)
    };
    
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== BULK OPERATIONS =====

// Bulk update business hours
router.post('/business-hours/bulk', async (req, res) => {
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

// Bulk update time slots
router.post('/time-slots/bulk', async (req, res) => {
  try {
    const { timeSlots } = req.body;
    
    for (const slot of timeSlots) {
      await dbRun(`
        INSERT OR REPLACE INTO reservation_time_slots 
        (time_slot, is_available, max_reservations, updated_at) 
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `, [slot.time_slot, slot.is_available, slot.max_reservations]);
    }
    
    res.json({ message: 'Time slots updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== REPORTS =====

// Get reservation report
router.get('/reports/reservations', async (req, res) => {
  try {
    const { start_date, end_date, status } = req.query;
    
    let sql = `
      SELECT r.*, ts.table_name 
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
    
    sql += ' ORDER BY r.reservation_date DESC, r.reservation_time ASC';
    
    const reservations = await dbAll(sql, params);
    
    // Calculate statistics
    const stats = {
      total: reservations.length,
      confirmed: reservations.filter(r => r.status === 'confirmed').length,
      pending: reservations.filter(r => r.status === 'pending').length,
      cancelled: reservations.filter(r => r.status === 'cancelled').length,
      completed: reservations.filter(r => r.status === 'completed').length
    };
    
    res.json({
      reservations,
      statistics: stats
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get table utilization report
router.get('/reports/table-utilization', async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    let dateFilter = '';
    const params = [];
    
    if (start_date && end_date) {
      dateFilter = 'WHERE reservation_date BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }
    
    const utilization = await dbAll(`
      SELECT 
        ts.table_number,
        ts.table_name,
        ts.min_capacity,
        ts.max_capacity,
        COUNT(r.id) as total_reservations,
        COUNT(CASE WHEN r.status = 'confirmed' THEN 1 END) as confirmed_reservations,
        COUNT(CASE WHEN r.status = 'pending' THEN 1 END) as pending_reservations,
        COUNT(CASE WHEN r.status = 'completed' THEN 1 END) as completed_reservations,
        AVG(r.party_size) as avg_party_size
      FROM table_settings ts
      LEFT JOIN reservations r ON ts.table_number = r.table_number ${dateFilter ? 'AND ' + dateFilter.replace('WHERE', '') : ''}
      GROUP BY ts.id
      ORDER BY ts.table_number
    `, params);
    
    res.json(utilization);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Sales summary report including adjustments
router.get('/reports/sales-summary', async (req, res) => {
  try {
    const q = req.query || {};
    const start = q.start_date ? String(q.start_date) : null;
    const end = q.end_date ? String(q.end_date) : null;
    const channel = q.channel ? String(q.channel).toUpperCase() : null;
    const params = [];
    let where = ' WHERE 1=1';
    if (start && end) { where += ' AND date(created_at) BETWEEN ? AND ?'; params.push(start, end); }
    if (channel) { where += ' AND UPPER(order_type) = ?'; params.push(channel); }
    const rows = await dbAll(`SELECT id, total, order_type, status, created_at FROM orders ${where}`, params);
    const ids = rows.map(r => r.id);
    let adjustments = [];
    if (ids.length > 0) {
      const placeholders = ids.map(()=>'?').join(',');
      adjustments = await dbAll(`SELECT order_id, kind, SUM(amount_applied) as amount FROM order_adjustments WHERE order_id IN (${placeholders}) GROUP BY order_id, kind`, ids);
    }
    const sum = {
      orders: rows.length,
      total: rows.reduce((s,r)=>s+Number(r.total||0),0),
      discounts: adjustments.filter(a=>String(a.kind).toUpperCase()==='DISCOUNT').reduce((s,a)=>s+Number(a.amount||0),0),
      bag_fees: adjustments.filter(a=>String(a.kind).toUpperCase()==='BAG_FEE').reduce((s,a)=>s+Number(a.amount||0),0),
    };
    res.json({ summary: sum, orders: rows, adjustments });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router; 