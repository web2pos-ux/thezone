const express = require('express');
const router = express.Router();

// 공유 데이터베이스 모듈 사용 (환경 변수 DB_PATH 지원 - Electron 앱 호환)
const { db, dbRun, dbAll, dbGet } = require('../db');

// Firebase 동기화 서비스
let firebaseService = null;
let remoteSyncService = null;
try {
  firebaseService = require('../services/firebaseService');
  remoteSyncService = require('../services/remoteSyncService');
} catch (e) {
  console.warn('[ReservationSettings] Firebase service not available:', e.message);
}

function getRestaurantId() {
  if (!remoteSyncService) return null;
  if (typeof remoteSyncService.getRestaurantId === 'function') return remoteSyncService.getRestaurantId();
  return null;
}

// Firebase에 예약 설정 동기화
async function syncPolicyToFirebase(policyData) {
  try {
    const restaurantId = getRestaurantId();
    if (!restaurantId || !firebaseService) return;
    const firestore = firebaseService.getFirestore ? firebaseService.getFirestore() : null;
    if (!firestore) return;

    await firestore.collection('restaurants').doc(restaurantId)
      .collection('reservationSettings').doc('policy').set({
        maxTablesPerSlot: Math.max(policyData.peak_max_per_slot || 8, policyData.normal_max_per_slot || 8),
        dwellMinutes: policyData.dwell_minutes || 120,
        depositPerPerson: 10,
        peakStart: policyData.peak_start || '17:00',
        peakEnd: policyData.peak_end || '21:00',
        peakMaxPerSlot: policyData.peak_max_per_slot || 8,
        normalMaxPerSlot: policyData.normal_max_per_slot || 8,
        onlineQuotaPct: policyData.online_quota_pct || 100,
        enabled: true,
        updated_at: new Date().toISOString(),
      }, { merge: true });
    console.log('[Firebase] Reservation policy synced successfully');
  } catch (err) {
    console.warn('[Firebase] Reservation policy sync failed (non-critical):', err.message);
  }
}

// Ensure reservation_policy table exists
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS reservation_policy (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      peak_start TEXT NOT NULL DEFAULT '18:00',
      peak_end TEXT NOT NULL DEFAULT '20:00',
      peak_max_per_slot INTEGER NOT NULL DEFAULT 3,
      normal_max_per_slot INTEGER NOT NULL DEFAULT 5,
      no_show_grace_minutes INTEGER NOT NULL DEFAULT 10,
      online_quota_pct INTEGER NOT NULL DEFAULT 30,
      phone_quota_pct INTEGER NOT NULL DEFAULT 40,
      walkin_quota_pct INTEGER NOT NULL DEFAULT 30,
      dwell_minutes INTEGER NOT NULL DEFAULT 90,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Add missing columns (ignore errors if they already exist)
  db.run(`ALTER TABLE reservation_policy ADD COLUMN online_quota_pct INTEGER NOT NULL DEFAULT 30`, () => {});
  db.run(`ALTER TABLE reservation_policy ADD COLUMN phone_quota_pct INTEGER NOT NULL DEFAULT 40`, () => {});
  db.run(`ALTER TABLE reservation_policy ADD COLUMN walkin_quota_pct INTEGER NOT NULL DEFAULT 30`, () => {});
  db.run(`ALTER TABLE reservation_policy ADD COLUMN no_show_grace_minutes INTEGER NOT NULL DEFAULT 10`, () => {});
});

// ===== BUSINESS HOURS MANAGEMENT =====

// Get all business hours
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

// Get business hours for specific day
router.get('/business-hours/:day', async (req, res) => {
  try {
    const { day } = req.params;
    const hours = await dbGet('SELECT * FROM business_hours WHERE day_of_week = ?', [day]);
    res.json(hours);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== TABLE SETTINGS MANAGEMENT =====

// Get all table settings
router.get('/table-settings', async (req, res) => {
  try {
    const tables = await dbAll('SELECT * FROM table_settings ORDER BY table_number');
    res.json(tables);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get table setting by ID
router.get('/table-settings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const table = await dbGet('SELECT * FROM table_settings WHERE id = ?', [id]);
    
    if (!table) {
      return res.status(404).json({ error: 'Table setting not found' });
    }
    
    res.json(table);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new table setting
router.post('/table-settings', async (req, res) => {
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
      message: 'Table setting created successfully',
      table: newTable
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
    
    res.json({ message: 'Table setting updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete table setting
router.delete('/table-settings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if table has active reservations
    const activeReservations = await dbGet(`
      SELECT COUNT(*) as count FROM reservations 
      WHERE table_number = (SELECT table_number FROM table_settings WHERE id = ?) 
      AND status IN ('pending', 'confirmed')
    `, [id]);
    
    if (activeReservations.count > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete table with active reservations' 
      });
    }
    
    await dbRun('DELETE FROM table_settings WHERE id = ?', [id]);
    res.json({ message: 'Table setting deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== TIME SLOTS MANAGEMENT =====

// Get all time slots
router.get('/time-slots', async (req, res) => {
  try {
    const timeSlots = await dbAll('SELECT * FROM reservation_time_slots ORDER BY time_slot');
    res.json(timeSlots);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get time slot by ID
router.get('/time-slots/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const timeSlot = await dbGet('SELECT * FROM reservation_time_slots WHERE id = ?', [id]);
    
    if (!timeSlot) {
      return res.status(404).json({ error: 'Time slot not found' });
    }
    
    res.json(timeSlot);
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

// ===== SYSTEM SETTINGS =====

// Get system settings
router.get('/system-settings', async (req, res) => {
  try {
    const settings = {
      businessHours: await dbAll('SELECT * FROM business_hours ORDER BY day_of_week'),
      tableSettings: await dbAll('SELECT * FROM table_settings ORDER BY table_number'),
      timeSlots: await dbAll('SELECT * FROM reservation_time_slots ORDER BY time_slot'),
      policy: await dbGet(`
        SELECT peak_start, peak_end, peak_max_per_slot, normal_max_per_slot, dwell_minutes, no_show_grace_minutes
        FROM reservation_policy LIMIT 1
      `).catch(() => null),
      statistics: await dbGet(`
        SELECT 
          COUNT(*) as total_reservations,
          COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
          COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
          COUNT(CASE WHEN status = 'no_show' THEN 1 END) as no_show
        FROM reservations
      `)
    };
    
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upsert reservation policy
router.put('/policy', async (req, res) => {
  try {
    const { peak_start, peak_end, peak_max_per_slot, normal_max_per_slot, dwell_minutes, no_show_grace_minutes } = req.body || {};
    await dbRun(`
      INSERT INTO reservation_policy (id, peak_start, peak_end, peak_max_per_slot, normal_max_per_slot, dwell_minutes, no_show_grace_minutes)
      VALUES (1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        peak_start = excluded.peak_start,
        peak_end = excluded.peak_end,
        peak_max_per_slot = excluded.peak_max_per_slot,
        normal_max_per_slot = excluded.normal_max_per_slot,
        dwell_minutes = excluded.dwell_minutes,
        no_show_grace_minutes = excluded.no_show_grace_minutes,
        updated_at = CURRENT_TIMESTAMP
    `, [peak_start, peak_end, peak_max_per_slot, normal_max_per_slot, dwell_minutes, no_show_grace_minutes]);

    // Firebase에 예약 설정 동기화
    await syncPolicyToFirebase({
      peak_start, peak_end, peak_max_per_slot, normal_max_per_slot,
      dwell_minutes, no_show_grace_minutes,
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
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

    // Firebase에 영업시간 동기화 (TZO 온라인 예약에서 사용)
    try {
      const restaurantId = getRestaurantId();
      if (restaurantId && firebaseService) {
        const firestore = firebaseService.getFirestore ? firebaseService.getFirestore() : null;
        if (firestore) {
          const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
          const bhObj = {};
          for (const hour of businessHours) {
            const key = dayKeys[hour.day_of_week] || `day_${hour.day_of_week}`;
            bhObj[key] = {
              isOpen: hour.is_open === 1 || hour.is_open === true,
              openTime: hour.open_time || '11:00',
              closeTime: hour.close_time || '21:00',
            };
          }
          await firestore.collection('restaurants').doc(restaurantId).set({
            businessHours: bhObj,
            updated_at: new Date().toISOString(),
          }, { merge: true });
          console.log('[Firebase] Business hours synced for online reservation');
        }
      }
    } catch (fbErr) {
      console.warn('[Firebase] Business hours sync failed (non-critical):', fbErr.message);
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

// ===== VALIDATION =====

// Validate reservation settings
router.post('/validate', async (req, res) => {
  try {
    const { date, time, party_size, table_number } = req.body;
    
    const errors = [];
    
    // Check business hours
    const dayOfWeek = new Date(date).getDay();
    const businessHours = await dbGet(
      'SELECT * FROM business_hours WHERE day_of_week = ? AND is_open = 1',
      [dayOfWeek]
    );
    
    if (!businessHours) {
      errors.push('Restaurant is closed on this day');
    } else if (time < businessHours.open_time || time >= businessHours.close_time) {
      errors.push('Reservation time is outside business hours');
    }
    
    // Check table capacity
    if (table_number) {
      const tableSetting = await dbGet(
        'SELECT * FROM table_settings WHERE table_number = ? AND is_reservable = 1',
        [table_number]
      );
      
      if (!tableSetting) {
        errors.push('Selected table is not available for reservations');
      } else if (party_size < tableSetting.min_capacity || party_size > tableSetting.max_capacity) {
        errors.push(`Party size must be between ${tableSetting.min_capacity} and ${tableSetting.max_capacity} for this table`);
      }
    }
    
    // Check time slot availability with policy
    let slot = await dbGet(
      'SELECT * FROM reservation_time_slots WHERE time_slot = ? AND is_available = 1',
      [time]
    );
    // fallback: derive max from policy if slot not defined
    const policy = await dbGet(`SELECT peak_start, peak_end, peak_max_per_slot, normal_max_per_slot FROM reservation_policy LIMIT 1`).catch(()=>null);
    if (!slot && policy) {
      const withinPeak = time >= policy.peak_start && time < policy.peak_end;
      slot = { time_slot: time, is_available: 1, max_reservations: withinPeak ? (policy.peak_max_per_slot||0) : (policy.normal_max_per_slot||0) };
    }
    if (!slot) {
      errors.push('Selected time slot is not available');
    } else {
      const existingReservations = await dbGet(`
        SELECT COUNT(*) as count FROM reservations 
        WHERE reservation_date = ? AND reservation_time = ? AND status NOT IN ('cancelled','no_show')
      `, [date, time]);
      if (existingReservations.count >= slot.max_reservations) {
        errors.push('This time slot is fully booked');
      }
    }
    
    res.json({
      isValid: errors.length === 0,
      errors: errors
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router; 