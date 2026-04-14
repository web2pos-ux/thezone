const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');

// 공유 데이터베이스 모듈 사용 (환경 변수 DB_PATH 지원 - Electron 앱 호환)
const { db, dbRun, dbAll, dbGet } = require('../db');

// Firebase 동기화 서비스
let firebaseService = null;
let remoteSyncService = null;
try {
  firebaseService = require('../services/firebaseService');
  remoteSyncService = require('../services/remoteSyncService');
} catch (e) {
  console.warn('[Reservations] Firebase service not available:', e.message);
}

// Helper: get restaurant ID safely
function getRestaurantId() {
  if (!remoteSyncService) return null;
  if (typeof remoteSyncService.getRestaurantId === 'function') return remoteSyncService.getRestaurantId();
  return null;
}

// Test route to verify the router is working
router.get('/test', (req, res) => {
  res.json({ message: 'Reservations router is working!' });
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

    // 온라인 예약 관련 컬럼 추가 (이미 존재하면 무시)
    await dbRun(`ALTER TABLE reservations ADD COLUMN channel TEXT DEFAULT 'POS'`).catch(() => {});
    await dbRun(`ALTER TABLE reservations ADD COLUMN deposit_amount REAL DEFAULT 0`).catch(() => {});
    await dbRun(`ALTER TABLE reservations ADD COLUMN deposit_status TEXT DEFAULT 'none'`).catch(() => {}); // none, pending, paid, refunded, applied
    await dbRun(`ALTER TABLE reservations ADD COLUMN customer_email TEXT`).catch(() => {});
    await dbRun(`ALTER TABLE reservations ADD COLUMN tables_needed INTEGER DEFAULT 1`).catch(() => {});
    await dbRun(`ALTER TABLE reservations ADD COLUMN linked_order_id TEXT`).catch(() => {}); // 연결된 주문 ID (결제시 사용)

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

// Helper: "HH:MM" → minutes from midnight
function timeToMins(t) {
  if (!t) return 0;
  const parts = String(t).split(':');
  return Number(parts[0] || 0) * 60 + Number(parts[1] || 0);
}

// 파티 사이즈 → 점유 테이블 수 계산
// 1-5명: 1테이블, 6-9명: 2테이블, 10-13명: 3테이블, ...
function calcTablesNeeded(partySize) {
  const ps = Number(partySize || 1);
  if (ps <= 0) return 1;
  if (ps <= 5) return 1;
  return 1 + Math.ceil((ps - 5) / 4);
}

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
    
    // Check time slot capacity with dwell time (체류 시간 기반 점유 체크)
    const slot = await dbGet(
      'SELECT * FROM reservation_time_slots WHERE time_slot = ? AND is_available = 1',
      [reservation_time]
    );
    // fallback to policy if slot not found
    const policyRow = await dbGet(`SELECT peak_start, peak_end, peak_max_per_slot, normal_max_per_slot, dwell_minutes, online_quota_pct, phone_quota_pct, walkin_quota_pct FROM reservation_policy LIMIT 1`).catch(()=>null);
    const dwellMinutes = Number(policyRow?.dwell_minutes || 120); // 기본 2시간

    let maxPerSlot = slot?.max_reservations;
    if (!slot) {
      if (policyRow) {
        const withinPeak = reservation_time >= policyRow.peak_start && reservation_time < policyRow.peak_end;
        maxPerSlot = withinPeak ? (policyRow.peak_max_per_slot||8) : (policyRow.normal_max_per_slot||8);
      } else {
        maxPerSlot = 8; // 기본값
      }
    }
    if (maxPerSlot != null) {
      // 체류 시간 + 파티사이즈 기반 테이블 점유 계산:
      // 타임슬롯 reservation_time에 "아직 점유 중인" 테이블 수를 센다
      // 각 예약의 party_size에 따라 점유 테이블 수가 다름 (1-5명:1, 6-9명:2, ...)
      const targetMins = timeToMins(reservation_time);
      const overlappingReservations = await dbAll(`
        SELECT party_size FROM reservations
        WHERE reservation_date = ?
          AND status NOT IN ('cancelled', 'no_show', 'completed')
          AND (CAST(substr(reservation_time,1,2) AS INTEGER) * 60 + CAST(substr(reservation_time,4,2) AS INTEGER)) < ?
          AND ? < (CAST(substr(reservation_time,1,2) AS INTEGER) * 60 + CAST(substr(reservation_time,4,2) AS INTEGER) + ?)
      `, [reservation_date, targetMins + dwellMinutes, targetMins, dwellMinutes]);

      // 현재 점유 중인 테이블 수 합산
      let currentOccupiedTables = 0;
      for (const r of overlappingReservations) {
        currentOccupiedTables += calcTablesNeeded(r.party_size);
      }

      // 신규 예약이 필요로 하는 테이블 수
      const newTablesNeeded = calcTablesNeeded(party_size);

      // Channel quotas (if policy exists)
      let withinQuota = true;
      const channel = (req.body?.channel || '').toUpperCase();
      if (policyRow && maxPerSlot > 0 && channel) {
        const quotaPct = channel === 'ONLINE' ? policyRow.online_quota_pct : channel === 'PHONE' ? policyRow.phone_quota_pct : policyRow.walkin_quota_pct;
        if (quotaPct) {
          const channelMax = Math.floor((quotaPct * maxPerSlot) / 100);
          const channelReservations = await dbAll(`
            SELECT party_size FROM reservations
            WHERE reservation_date = ?
              AND status NOT IN ('cancelled', 'no_show', 'completed')
              AND (CAST(substr(reservation_time,1,2) AS INTEGER) * 60 + CAST(substr(reservation_time,4,2) AS INTEGER)) < ?
              AND ? < (CAST(substr(reservation_time,1,2) AS INTEGER) * 60 + CAST(substr(reservation_time,4,2) AS INTEGER) + ?)
              AND UPPER(COALESCE(json_extract(special_requests,'$.channel'),'')) = ?
          `, [reservation_date, targetMins + dwellMinutes, targetMins, dwellMinutes, channel]);
          let channelOccupied = 0;
          for (const r of channelReservations) {
            channelOccupied += calcTablesNeeded(r.party_size);
          }
          if (channelOccupied + newTablesNeeded > channelMax) withinQuota = false;
        }
      }

      if (currentOccupiedTables + newTablesNeeded > maxPerSlot || !withinQuota) {
        return res.status(400).json({ 
          error: `This time slot is fully booked (${currentOccupiedTables}/${maxPerSlot} tables occupied, need ${newTablesNeeded} more)` 
        });
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
    
    // Firebase 동기화 (비동기 - 실패해도 API 응답은 정상)
    try {
      const restaurantId = getRestaurantId();
      if (restaurantId && firebaseService) {
        const firestore = firebaseService.getFirestore ? firebaseService.getFirestore() : null;
        if (firestore) {
          const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
          await restaurantRef.collection('reservations').doc(String(newReservation.id)).set({
            reservation_number: newReservation.reservation_number,
            customer_name: newReservation.customer_name,
            phone_number: newReservation.phone_number,
            reservation_date: newReservation.reservation_date,
            reservation_time: newReservation.reservation_time,
            party_size: newReservation.party_size,
            table_number: newReservation.table_number || '',
            status: newReservation.status || 'pending',
            special_requests: newReservation.special_requests || '',
            created_at: newReservation.created_at || new Date().toISOString(),
            updated_at: newReservation.updated_at || new Date().toISOString(),
          });
          console.log(`[Firebase] Reservation ${newReservation.reservation_number} synced successfully`);
        }
      }
    } catch (fbErr) {
      console.warn('[Firebase] Reservation sync failed (non-critical):', fbErr.message);
    }
    
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
    
    // Firebase 동기화
    try {
      const restaurantId = getRestaurantId();
      if (restaurantId && firebaseService) {
        const firestore = firebaseService.getFirestore ? firebaseService.getFirestore() : null;
        if (firestore) {
          const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
          await restaurantRef.collection('reservations').doc(String(id)).update({
            customer_name, phone_number, reservation_date, reservation_time,
            party_size, table_number: table_number || '', status: status || 'pending',
            special_requests: special_requests || '', updated_at: new Date().toISOString(),
          });
        }
      }
    } catch (fbErr) {
      console.warn('[Firebase] Reservation update sync failed:', fbErr.message);
    }
    
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
    
    // Firebase 삭제
    try {
      const restaurantId = getRestaurantId();
      if (restaurantId && firebaseService) {
        const firestore = firebaseService.getFirestore ? firebaseService.getFirestore() : null;
        if (firestore) {
          const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
          await restaurantRef.collection('reservations').doc(String(id)).delete();
        }
      }
    } catch (fbErr) {
      console.warn('[Firebase] Reservation delete sync failed:', fbErr.message);
    }
    
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
    
    // Firebase 동기화
    try {
      const restaurantId = getRestaurantId();
      if (restaurantId && firebaseService) {
        const firestore = firebaseService.getFirestore ? firebaseService.getFirestore() : null;
        if (firestore) {
          const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
          await restaurantRef.collection('reservations').doc(String(id)).update({
            status,
            updated_at: new Date().toISOString(),
          });
        }
      }
    } catch (fbErr) {
      console.warn('[Firebase] Reservation status sync failed:', fbErr.message);
    }
    
    res.json({ message: 'Reservation status updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark reservation as no_show
router.patch('/reservations/:id/no-show', async (req, res) => {
  try {
    const { id } = req.params;
    
    // 예약 정보 조회 (deposit 확인)
    const reservation = await dbGet(`SELECT id, deposit_amount, deposit_status FROM reservations WHERE id = ?`, [id]);
    const hasDeposit = reservation && Number(reservation.deposit_amount || 0) > 0 
      && reservation.deposit_status !== 'refunded' && reservation.deposit_status !== 'forfeited';
    
    // No Show 처리 + deposit이 있으면 forfeited로 변경
    await dbRun(`
      UPDATE reservations
      SET status = 'no_show',
          deposit_status = CASE WHEN deposit_amount > 0 AND deposit_status NOT IN ('refunded', 'forfeited') THEN 'forfeited' ELSE deposit_status END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [id]);
    
    // Firebase 동기화
    try {
      const restaurantId = getRestaurantId();
      if (restaurantId && firebaseService) {
        const firestore = firebaseService.getFirestore ? firebaseService.getFirestore() : null;
        if (firestore) {
          const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
          const fbUpdate = {
            status: 'no_show',
            updated_at: new Date().toISOString(),
          };
          if (hasDeposit) {
            fbUpdate.deposit_status = 'forfeited';
          }
          await restaurantRef.collection('reservations').doc(String(id)).update(fbUpdate);
        }
      }
    } catch (fbErr) {
      console.warn('[Firebase] No-show sync failed:', fbErr.message);
    }
    
    // 몰수 금액을 payments 테이블에 매출로 기록 (세금 포함 금액)
    const forfeitedAmount = hasDeposit ? Number(reservation.deposit_amount) : 0;
    if (hasDeposit && forfeitedAmount > 0) {
      const now = new Date();
      const createdAt = now.toISOString().replace('T', ' ').substring(0, 19);
      await dbRun(`
        INSERT INTO payments (order_id, payment_method, amount, tip, ref, status, created_at)
        VALUES (NULL, 'NO_SHOW_FORFEITED', ?, 0, ?, 'APPROVED', ?)
      `, [forfeitedAmount, `reservation_${id}`, createdAt]);
      console.log(`[No-Show] Deposit forfeited: $${forfeitedAmount.toFixed(2)} for reservation #${id}`);
    }
    
    res.json({ 
      message: 'Reservation marked as no_show',
      deposit_forfeited: hasDeposit,
      forfeited_amount: forfeitedAmount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Auto no-show: mark overdue reservations (30 minutes past reservation time) as no_show
router.patch('/reservations/auto-noshow', async (req, res) => {
  try {
    await ensureTablesExist();
    const now = new Date();
    const todayDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const currentMins = now.getHours() * 60 + now.getMinutes();
    const cutoffMins = currentMins - 30; // 30분 전 시간

    // 먼저 대상 예약 ID와 deposit 정보를 조회
    const overdueReservations = await dbAll(`
      SELECT id, deposit_amount, deposit_status FROM reservations
      WHERE reservation_date = ?
        AND status IN ('pending', 'confirmed')
        AND (CAST(substr(reservation_time,1,2) AS INTEGER) * 60 + CAST(substr(reservation_time,4,2) AS INTEGER)) <= ?
    `, [todayDate, cutoffMins]);

    if (overdueReservations.length === 0) {
      return res.json({ message: '0 reservation(s) auto-marked as no_show', changes: 0 });
    }

    // pending 또는 confirmed 상태이고, 예약 시간 + 30분이 지난 예약들을 no_show 처리
    // deposit이 있는 예약은 deposit_status도 forfeited로 변경
    const result = await dbRun(`
      UPDATE reservations
      SET status = 'no_show',
          deposit_status = CASE WHEN deposit_amount > 0 AND deposit_status NOT IN ('refunded', 'forfeited') THEN 'forfeited' ELSE deposit_status END,
          updated_at = CURRENT_TIMESTAMP
      WHERE reservation_date = ?
        AND status IN ('pending', 'confirmed')
        AND (CAST(substr(reservation_time,1,2) AS INTEGER) * 60 + CAST(substr(reservation_time,4,2) AS INTEGER)) <= ?
    `, [todayDate, cutoffMins]);

    const changes = result?.changes || 0;
    const forfeitedCount = overdueReservations.filter(r => Number(r.deposit_amount || 0) > 0 && !['refunded', 'forfeited'].includes(r.deposit_status)).length;
    const forfeitedTotal = overdueReservations
      .filter(r => Number(r.deposit_amount || 0) > 0 && !['refunded', 'forfeited'].includes(r.deposit_status))
      .reduce((sum, r) => sum + Number(r.deposit_amount || 0), 0);
    
    if (changes > 0) {
      console.log(`[Auto No-Show] ${changes} reservation(s) marked as no_show (cutoff: ${Math.floor(cutoffMins/60)}:${String(cutoffMins%60).padStart(2,'0')})`);
      // 몰수 금액을 payments 테이블에 매출로 기록 (세금 포함 금액)
      if (forfeitedCount > 0) {
        console.log(`[Auto No-Show] ${forfeitedCount} deposit(s) forfeited, total: $${forfeitedTotal.toFixed(2)}`);
        const createdAt = new Date().toISOString().replace('T', ' ').substring(0, 19);
        for (const r of overdueReservations) {
          const depositAmt = Number(r.deposit_amount || 0);
          if (depositAmt > 0 && !['refunded', 'forfeited'].includes(r.deposit_status)) {
            await dbRun(`
              INSERT INTO payments (order_id, payment_method, amount, tip, ref, status, created_at)
              VALUES (NULL, 'NO_SHOW_FORFEITED', ?, 0, ?, 'APPROVED', ?)
            `, [depositAmt, `reservation_${r.id}`, createdAt]);
          }
        }
      }
      
      // Firebase 동기화 - 각 예약의 상태를 no_show로 업데이트
      try {
        const restaurantId = getRestaurantId();
        if (restaurantId && firebaseService) {
          const firestore = firebaseService.getFirestore ? firebaseService.getFirestore() : null;
          if (firestore) {
            const restaurantRef = firestore.collection('restaurants').doc(restaurantId);
            const batch = firestore.batch();
            for (const r of overdueReservations) {
              const docRef = restaurantRef.collection('reservations').doc(String(r.id));
              const fbUpdate = { status: 'no_show', updated_at: new Date().toISOString() };
              if (Number(r.deposit_amount || 0) > 0 && !['refunded', 'forfeited'].includes(r.deposit_status)) {
                fbUpdate.deposit_status = 'forfeited';
              }
              batch.update(docRef, fbUpdate);
            }
            await batch.commit();
            console.log(`[Firebase] Auto no-show: ${overdueReservations.length} reservation(s) synced`);
          }
        }
      } catch (fbErr) {
        console.warn('[Firebase] Auto no-show sync failed (non-critical):', fbErr.message);
      }
    }
    res.json({ message: `${changes} reservation(s) auto-marked as no_show`, changes, forfeited_count: forfeitedCount, forfeited_total: forfeitedTotal });
  } catch (error) {
    console.error('Auto no-show error:', error);
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
    
    // No Show에서 Rebook: deposit 몰수 복구
    const wasForfeited = reservation.status === 'no_show' && reservation.deposit_status === 'forfeited' && Number(reservation.deposit_amount || 0) > 0;
    
    // Update status to pending + deposit 복구
    await dbRun(`
      UPDATE reservations 
      SET status = 'pending',
          deposit_status = CASE WHEN deposit_status = 'forfeited' THEN 'paid' ELSE deposit_status END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [id]);
    
    // 몰수 결제 기록 삭제
    if (wasForfeited) {
      await dbRun(`DELETE FROM payments WHERE payment_method = 'NO_SHOW_FORFEITED' AND ref = ? AND status = 'APPROVED'`, [`reservation_${id}`]);
      console.log(`[Rebook] Reversed deposit forfeiture for reservation #${id}, amount: $${Number(reservation.deposit_amount).toFixed(2)}`);
    }
    
    // Firebase 동기화
    try {
      const restaurantId = getRestaurantId();
      if (restaurantId && firebaseService) {
        const firestore = firebaseService.getFirestore ? firebaseService.getFirestore() : null;
        if (firestore) {
          const fbUpdate = { status: 'pending', updated_at: new Date().toISOString() };
          if (wasForfeited) {
            fbUpdate.deposit_status = 'paid';
          }
          await firestore.collection('restaurants').doc(restaurantId)
            .collection('reservations').doc(String(id)).update(fbUpdate);
        }
      }
    } catch (fbErr) {
      console.warn('[Firebase] Rebook sync failed:', fbErr.message);
    }
    
    res.json({ 
      message: 'Reservation rebooked successfully',
      deposit_restored: wasForfeited,
      restored_amount: wasForfeited ? Number(reservation.deposit_amount) : 0
    });
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

    // 용량 체크: dwell time 기반 점유 계산
    const slot = await dbGet(
      'SELECT * FROM reservation_time_slots WHERE time_slot = ? AND is_available = 1',
      [reservation_time]
    );
    const reschedulePolicy = await dbGet(`SELECT peak_start, peak_end, peak_max_per_slot, normal_max_per_slot, dwell_minutes FROM reservation_policy LIMIT 1`).catch(()=>null);
    const rescheduleDwell = Number(reschedulePolicy?.dwell_minutes || 120);
    let maxPerSlot = slot?.max_reservations;
    if (!slot) {
      if (reschedulePolicy) {
        const withinPeak = reservation_time >= reschedulePolicy.peak_start && reservation_time < reschedulePolicy.peak_end;
        maxPerSlot = withinPeak ? (reschedulePolicy.peak_max_per_slot||8) : (reschedulePolicy.normal_max_per_slot||8);
      } else {
        maxPerSlot = 8;
      }
    }
    if (maxPerSlot != null) {
      const targetMins = timeToMins(reservation_time);
      // 자기 자신 예약은 제외하고 테이블 점유 수 계산 (reschedule이므로)
      const overlappingReservations = await dbAll(`
        SELECT party_size FROM reservations
        WHERE reservation_date = ?
          AND id != ?
          AND status NOT IN ('cancelled', 'no_show', 'completed')
          AND (CAST(substr(reservation_time,1,2) AS INTEGER) * 60 + CAST(substr(reservation_time,4,2) AS INTEGER)) < ?
          AND ? < (CAST(substr(reservation_time,1,2) AS INTEGER) * 60 + CAST(substr(reservation_time,4,2) AS INTEGER) + ?)
      `, [reservation_date, id, targetMins + rescheduleDwell, targetMins, rescheduleDwell]);

      let currentOccupiedTables = 0;
      for (const r of overlappingReservations) {
        currentOccupiedTables += calcTablesNeeded(r.party_size);
      }

      // 자기 자신의 party_size로 필요한 테이블 수
      const selfReservation = await dbGet('SELECT party_size FROM reservations WHERE id = ?', [id]);
      const selfTablesNeeded = calcTablesNeeded(selfReservation?.party_size);

      if (currentOccupiedTables + selfTablesNeeded > maxPerSlot) {
        return res.status(400).json({ 
          error: `This time slot is fully booked (${currentOccupiedTables}/${maxPerSlot} tables occupied, need ${selfTablesNeeded} more)` 
        });
      }
    }

    await dbRun(`
      UPDATE reservations
      SET reservation_date = ?, reservation_time = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [reservation_date, reservation_time, id]);

    // Firebase 동기화
    try {
      const restaurantId = getRestaurantId();
      if (restaurantId && firebaseService) {
        const firestore = firebaseService.getFirestore ? firebaseService.getFirestore() : null;
        if (firestore) {
          await firestore.collection('restaurants').doc(restaurantId)
            .collection('reservations').doc(String(id)).update({
              reservation_date,
              reservation_time,
              updated_at: new Date().toISOString(),
            });
        }
      }
    } catch (fbErr) {
      console.warn('[Reservations] Firebase sync failed for reschedule:', fbErr.message);
    }

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

// ========================================
// 온라인 예약 - 예약금(Deposit) 관련 API
// ========================================

// 예약을 주문에 연결 (Check-in 시 사용)
router.patch('/reservations/:id/link-order', async (req, res) => {
  try {
    const { id } = req.params;
    const { order_id, table_number } = req.body;

    await dbRun(`
      UPDATE reservations 
      SET linked_order_id = ?, table_number = ?, status = 'confirmed', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [order_id, table_number, id]);

    // Firebase 동기화
    try {
      const restaurantId = getRestaurantId();
      if (restaurantId && firebaseService) {
        const firestore = firebaseService.getFirestore ? firebaseService.getFirestore() : null;
        if (firestore) {
          await firestore.collection('restaurants').doc(restaurantId)
            .collection('reservations').doc(String(id)).update({
              linked_order_id: order_id,
              table_number: table_number,
              status: 'confirmed',
              deposit_status: 'paid',
              updated_at: new Date().toISOString(),
            });
        }
      }
    } catch (fbErr) {
      console.warn('[Firebase] Link order sync failed:', fbErr.message);
    }

    res.json({ message: 'Reservation linked to order successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 테이블/주문에 연결된 예약의 예약금(deposit) 조회
router.get('/reservations/deposit-for-table/:tableNumber', async (req, res) => {
  try {
    const { tableNumber } = req.params;
    const todayDate = (() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    })();

    const reservation = await dbGet(`
      SELECT id, reservation_number, customer_name, phone_number, party_size,
             deposit_amount, deposit_status, linked_order_id, channel
      FROM reservations
      WHERE table_number = ?
        AND reservation_date = ?
        AND status IN ('confirmed', 'pending')
        AND deposit_amount > 0
        AND deposit_status IN ('pending', 'paid')
      ORDER BY created_at DESC LIMIT 1
    `, [tableNumber, todayDate]);

    if (reservation) {
      res.json({ hasDeposit: true, reservation });
    } else {
      res.json({ hasDeposit: false, reservation: null });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 주문 ID로 연결된 예약의 예약금(deposit) 조회
router.get('/reservations/deposit-for-order/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;

    const reservation = await dbGet(`
      SELECT id, reservation_number, customer_name, phone_number, party_size,
             deposit_amount, deposit_status, linked_order_id, channel
      FROM reservations
      WHERE linked_order_id = ?
        AND deposit_amount > 0
        AND deposit_status IN ('pending', 'paid')
      LIMIT 1
    `, [orderId]);

    if (reservation) {
      res.json({ hasDeposit: true, reservation });
    } else {
      res.json({ hasDeposit: false, reservation: null });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 예약금 상태 업데이트 (결제 시 'applied'로 변경)
router.patch('/reservations/:id/deposit-applied', async (req, res) => {
  try {
    const { id } = req.params;
    
    // 예약 상태 확인 - forfeited/refunded 상태면 applied 불가
    const reservation = await dbGet(`SELECT id, deposit_status, deposit_amount FROM reservations WHERE id = ?`, [id]);
    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }
    if (reservation.deposit_status === 'forfeited') {
      return res.status(400).json({ error: 'Cannot apply forfeited deposit. Deposit was already forfeited due to no-show.' });
    }
    if (reservation.deposit_status === 'refunded') {
      return res.status(400).json({ error: 'Cannot apply refunded deposit. Deposit was already refunded.' });
    }
    if (reservation.deposit_status === 'applied') {
      return res.status(400).json({ error: 'Deposit is already applied.' });
    }
    
    await dbRun(`
      UPDATE reservations
      SET deposit_status = 'applied', status = 'completed', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [id]);

    // Firebase 동기화
    try {
      const restaurantId = getRestaurantId();
      if (restaurantId && firebaseService) {
        const firestore = firebaseService.getFirestore ? firebaseService.getFirestore() : null;
        if (firestore) {
          await firestore.collection('restaurants').doc(restaurantId)
            .collection('reservations').doc(String(id)).update({
              deposit_status: 'applied',
              status: 'completed',
              updated_at: new Date().toISOString(),
            });
        }
      }
    } catch (fbErr) {
      console.warn('[Firebase] Deposit applied sync failed:', fbErr.message);
    }

    res.json({ message: 'Deposit marked as applied' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Firebase에서 온라인 예약 동기화 (WEB2POS로 가져오기)
router.post('/reservations/sync-from-firebase', async (req, res) => {
  try {
    const restaurantId = getRestaurantId();
    if (!restaurantId || !firebaseService) {
      return res.status(400).json({ error: 'Firebase not configured' });
    }

    const firestore = firebaseService.getFirestore ? firebaseService.getFirestore() : null;
    if (!firestore) {
      return res.status(400).json({ error: 'Firestore not available' });
    }

    // 오늘 이후의 온라인 예약만 가져오기
    const todayDate = (() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    })();

    const snapshot = await firestore.collection('restaurants').doc(restaurantId)
      .collection('reservations')
      .where('channel', '==', 'ONLINE')
      .where('reservation_date', '>=', todayDate)
      .get();

    let syncedCount = 0;
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      if (!data.reservation_number) continue;

      // 이미 존재하는지 확인
      const existing = await dbGet(
        `SELECT id FROM reservations WHERE reservation_number = ?`,
        [data.reservation_number]
      );

      if (!existing) {
        await dbRun(`
          INSERT INTO reservations (reservation_number, customer_name, phone_number, reservation_date, reservation_time, party_size, status, channel, deposit_amount, deposit_status, customer_email, tables_needed, special_requests)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          data.reservation_number,
          data.customer_name || '',
          data.phone_number || '',
          data.reservation_date,
          data.reservation_time,
          data.party_size || 2,
          data.status || 'pending',
          'ONLINE',
          data.deposit_amount || 0,
          data.deposit_status || 'pending',
          data.customer_email || '',
          data.tables_needed || 1,
          data.special_requests || '',
        ]);
        syncedCount++;
      } else {
        // 기존 예약 업데이트
        await dbRun(`
          UPDATE reservations
          SET status = ?, deposit_amount = ?, deposit_status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE reservation_number = ? AND channel = 'ONLINE'
        `, [
          data.status || 'pending',
          data.deposit_amount || 0,
          data.deposit_status || 'pending',
          data.reservation_number,
        ]);
        syncedCount++;
      }
    }

    res.json({ message: `Synced ${syncedCount} online reservation(s) from Firebase`, count: syncedCount });
  } catch (error) {
    console.error('[Reservation Sync] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// 온라인 예약 Accept/Reject 시스템
// ============================================

// GET pending online reservations from Firebase
router.get('/reservations/pending-online', async (req, res) => {
  try {
    const restaurantId = getRestaurantId();
    if (!restaurantId || !firebaseService) {
      return res.json({ reservations: [] });
    }

    const firestore = firebaseService.getFirestore ? firebaseService.getFirestore() : null;
    if (!firestore) {
      return res.json({ reservations: [] });
    }

    const snapshot = await firestore.collection('restaurants').doc(restaurantId)
      .collection('reservations')
      .where('status', '==', 'pending')
      .where('channel', '==', 'ONLINE')
      .get();

    const pending = [];
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      pending.push({
        firebase_doc_id: docSnap.id,
        reservation_number: data.reservation_number || '',
        customer_name: data.customer_name || '',
        phone_number: data.phone_number || '',
        customer_email: data.customer_email || '',
        reservation_date: data.reservation_date || '',
        reservation_time: data.reservation_time || '',
        party_size: data.party_size || 2,
        tables_needed: data.tables_needed || 1,
        deposit_amount: data.deposit_amount || 0,
        special_requests: data.special_requests || '',
        created_at: data.created_at || '',
      });
    }

    // Sort by created_at (newest first)
    pending.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

    res.json({ reservations: pending });
  } catch (error) {
    console.error('[Reservation] Error fetching pending online:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST accept online reservation
router.post('/reservations/accept-online', async (req, res) => {
  try {
    const { firebase_doc_id, reservation_number, customer_name, phone_number, customer_email,
            reservation_date, reservation_time, party_size, tables_needed, deposit_amount, special_requests } = req.body;

    if (!firebase_doc_id) {
      return res.status(400).json({ error: 'firebase_doc_id is required' });
    }

    const restaurantId = getRestaurantId();
    if (!restaurantId || !firebaseService) {
      return res.status(400).json({ error: 'Firebase not configured' });
    }

    const firestore = firebaseService.getFirestore ? firebaseService.getFirestore() : null;
    if (!firestore) {
      return res.status(400).json({ error: 'Firestore not available' });
    }

    // 1. Update Firebase status to "confirmed"
    const docRef = firestore.collection('restaurants').doc(restaurantId)
      .collection('reservations').doc(firebase_doc_id);
    
    await docRef.update({
      status: 'confirmed',
      updated_at: new Date().toISOString(),
      accepted_at: new Date().toISOString(),
    });

    // 2. Save to POS database
    const existing = await dbGet(
      'SELECT id FROM reservations WHERE reservation_number = ?',
      [reservation_number]
    );

    let posReservationId;
    if (!existing) {
      const result = await dbRun(`
        INSERT INTO reservations (reservation_number, customer_name, phone_number, reservation_date, reservation_time, party_size, status, channel, deposit_amount, deposit_status, customer_email, tables_needed, special_requests)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        reservation_number,
        customer_name || '',
        phone_number || '',
        reservation_date,
        reservation_time,
        party_size || 2,
        'confirmed',
        'ONLINE',
        deposit_amount || 0,
        'pending',
        customer_email || '',
        tables_needed || 1,
        special_requests || '',
      ]);
      posReservationId = result.lastID;
    } else {
      await dbRun(`
        UPDATE reservations SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP
        WHERE reservation_number = ?
      `, [reservation_number]);
      posReservationId = existing.id;
    }

    // 3. If reservation is for today, auto-assign a table (reserve for 2 hours)
    const today = new Date().toISOString().split('T')[0];
    let assignedTable = null;

    if (reservation_date === today) {
      // Find an available table
      const availableTable = await dbGet(`
        SELECT element_id, name FROM table_map_elements 
        WHERE type IN ('square', 'circle') 
          AND (status IS NULL OR status = '' OR status = 'available' OR status = 'Available')
        ORDER BY name ASC
        LIMIT 1
      `);

      if (availableTable) {
        // Update table status to Reserved
        await dbRun(`
          UPDATE table_map_elements SET status = 'Reserved' WHERE element_id = ?
        `, [availableTable.element_id]);

        assignedTable = {
          tableId: availableTable.element_id,
          tableName: availableTable.name,
        };

        // Update reservation with table number
        await dbRun(`
          UPDATE reservations SET table_number = ? WHERE id = ?
        `, [availableTable.name, posReservationId]);

        console.log(`[Reservation] Table ${availableTable.name} reserved for online reservation ${reservation_number} (2h dwell)`);
      }
    }

    res.json({
      success: true,
      message: 'Reservation accepted',
      posReservationId,
      assignedTable,
    });
  } catch (error) {
    console.error('[Reservation Accept] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST reject online reservation
router.post('/reservations/reject-online', async (req, res) => {
  try {
    const { firebase_doc_id, reservation_number } = req.body;

    if (!firebase_doc_id) {
      return res.status(400).json({ error: 'firebase_doc_id is required' });
    }

    const restaurantId = getRestaurantId();
    if (!restaurantId || !firebaseService) {
      return res.status(400).json({ error: 'Firebase not configured' });
    }

    const firestore = firebaseService.getFirestore ? firebaseService.getFirestore() : null;
    if (!firestore) {
      return res.status(400).json({ error: 'Firestore not available' });
    }

    // 1. Update Firebase status to "rejected"
    const docRef = firestore.collection('restaurants').doc(restaurantId)
      .collection('reservations').doc(firebase_doc_id);

    await docRef.update({
      status: 'rejected',
      updated_at: new Date().toISOString(),
      rejected_at: new Date().toISOString(),
    });

    // 2. Update POS DB if exists
    if (reservation_number) {
      await dbRun(`
        UPDATE reservations SET status = 'rejected', updated_at = CURRENT_TIMESTAMP
        WHERE reservation_number = ? AND channel = 'ONLINE'
      `, [reservation_number]).catch(() => {});
    }

    res.json({ success: true, message: 'Reservation rejected' });
  } catch (error) {
    console.error('[Reservation Reject] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;