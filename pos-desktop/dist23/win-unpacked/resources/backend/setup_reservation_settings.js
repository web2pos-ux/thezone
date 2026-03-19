const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '..', 'db', 'web2pos.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS reservation_policy (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      peak_start TEXT NOT NULL DEFAULT '18:00',
      peak_end TEXT NOT NULL DEFAULT '20:00',
      peak_max_per_slot INTEGER NOT NULL DEFAULT 3,
      normal_max_per_slot INTEGER NOT NULL DEFAULT 5,
      dwell_minutes INTEGER NOT NULL DEFAULT 90,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    INSERT INTO reservation_policy (peak_start, peak_end, peak_max_per_slot, normal_max_per_slot, dwell_minutes)
    SELECT '18:00','20:00',3,5,90
    WHERE NOT EXISTS (SELECT 1 FROM reservation_policy)
  `);
});

db.close();

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '..', 'db', 'web2pos.db');
const db = new sqlite3.Database(dbPath);

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function(err) {
    if (err) reject(err);
    else resolve(this);
  });
});

const setupReservationSettings = async () => {
  try {
    console.log('Setting up reservation settings...');

    // 1. Setup Business Hours (영업시간 설정)
    const businessHours = [
      { day: 0, open: '11:00', close: '22:00', is_open: 1, name: 'Sunday' },
      { day: 1, open: '11:00', close: '22:00', is_open: 1, name: 'Monday' },
      { day: 2, open: '11:00', close: '22:00', is_open: 1, name: 'Tuesday' },
      { day: 3, open: '11:00', close: '22:00', is_open: 1, name: 'Wednesday' },
      { day: 4, open: '11:00', close: '22:00', is_open: 1, name: 'Thursday' },
      { day: 5, open: '11:00', close: '23:00', is_open: 1, name: 'Friday' },
      { day: 6, open: '11:00', close: '23:00', is_open: 1, name: 'Saturday' },
    ];

    console.log('Setting up business hours...');
    for (const hour of businessHours) {
      await dbRun(`
        INSERT OR REPLACE INTO business_hours 
        (day_of_week, open_time, close_time, is_open) 
        VALUES (?, ?, ?, ?)
      `, [hour.day, hour.open, hour.close, hour.is_open]);
      console.log(`  - ${hour.name}: ${hour.open} - ${hour.close}`);
    }

    // 2. Setup Table Settings (테이블 설정)
    const tableSettings = [
      { number: 'T1', name: 'Table 1', min: 2, max: 4, reservable: 1, type: 'Regular' },
      { number: 'T2', name: 'Table 2', min: 2, max: 4, reservable: 1, type: 'Regular' },
      { number: 'T3', name: 'Table 3', min: 2, max: 6, reservable: 1, type: 'Regular' },
      { number: 'T4', name: 'Table 4', min: 2, max: 6, reservable: 1, type: 'Regular' },
      { number: 'T5', name: 'Table 5', min: 4, max: 8, reservable: 1, type: 'Large' },
      { number: 'T6', name: 'Table 6', min: 4, max: 8, reservable: 1, type: 'Large' },
      { number: 'VIP1', name: 'VIP Table 1', min: 2, max: 6, reservable: 1, type: 'VIP' },
      { number: 'VIP2', name: 'VIP Table 2', min: 2, max: 6, reservable: 1, type: 'VIP' },
      { number: 'BAR1', name: 'Bar Counter 1', min: 1, max: 3, reservable: 0, type: 'Bar' },
      { number: 'BAR2', name: 'Bar Counter 2', min: 1, max: 3, reservable: 0, type: 'Bar' },
    ];

    console.log('Setting up table settings...');
    for (const table of tableSettings) {
      await dbRun(`
        INSERT OR REPLACE INTO table_settings 
        (table_number, table_name, is_reservable, min_capacity, max_capacity) 
        VALUES (?, ?, ?, ?, ?)
      `, [table.number, table.name, table.reservable, table.min, table.max]);
      console.log(`  - ${table.name} (${table.number}): ${table.min}-${table.max} people, ${table.reservable ? 'Reservable' : 'Not Reservable'}`);
    }

    // 3. Setup Time Slots (예약 가능 시간대)
    const timeSlots = [
      { time: '11:00', available: 1, max: 5, type: 'Lunch' },
      { time: '11:30', available: 1, max: 5, type: 'Lunch' },
      { time: '12:00', available: 1, max: 8, type: 'Lunch' },
      { time: '12:30', available: 1, max: 8, type: 'Lunch' },
      { time: '13:00', available: 1, max: 6, type: 'Lunch' },
      { time: '13:30', available: 1, max: 6, type: 'Lunch' },
      { time: '14:00', available: 1, max: 4, type: 'Lunch' },
      { time: '14:30', available: 1, max: 4, type: 'Lunch' },
      { time: '17:00', available: 1, max: 4, type: 'Dinner' },
      { time: '17:30', available: 1, max: 4, type: 'Dinner' },
      { time: '18:00', available: 1, max: 8, type: 'Dinner' },
      { time: '18:30', available: 1, max: 8, type: 'Dinner' },
      { time: '19:00', available: 1, max: 10, type: 'Dinner' },
      { time: '19:30', available: 1, max: 10, type: 'Dinner' },
      { time: '20:00', available: 1, max: 8, type: 'Dinner' },
      { time: '20:30', available: 1, max: 8, type: 'Dinner' },
      { time: '21:00', available: 1, max: 6, type: 'Dinner' },
    ];

    console.log('Setting up time slots...');
    for (const slot of timeSlots) {
      await dbRun(`
        INSERT OR REPLACE INTO reservation_time_slots 
        (time_slot, is_available, max_reservations) 
        VALUES (?, ?, ?)
      `, [slot.time, slot.available, slot.max]);
      console.log(`  - ${slot.time} (${slot.type}): Max ${slot.max} reservations`);
    }

    // 4. Setup Sample Reservations (샘플 예약 데이터)
    const sampleReservations = [
      {
        customer_name: 'John Doe',
        phone_number: '010-1234-5678',
        reservation_date: '2024-01-15',
        reservation_time: '18:00',
        party_size: 4,
        table_number: 'T1',
        status: 'confirmed',
        special_requests: 'Window seat preferred'
      },
      {
        customer_name: 'Jane Smith',
        phone_number: '010-9876-5432',
        reservation_date: '2024-01-15',
        reservation_time: '19:30',
        party_size: 2,
        table_number: 'T2',
        status: 'pending',
        special_requests: ''
      },
      {
        customer_name: 'Mike Johnson',
        phone_number: '010-5555-1234',
        reservation_date: '2024-01-16',
        reservation_time: '12:00',
        party_size: 6,
        table_number: 'T5',
        status: 'confirmed',
        special_requests: 'Birthday celebration'
      },
      {
        customer_name: 'Sarah Wilson',
        phone_number: '010-7777-8888',
        reservation_date: '2024-01-16',
        reservation_time: '20:00',
        party_size: 4,
        table_number: 'VIP1',
        status: 'confirmed',
        special_requests: 'Anniversary dinner'
      },
      {
        customer_name: 'David Brown',
        phone_number: '010-9999-1111',
        reservation_date: '2024-01-17',
        reservation_time: '19:00',
        party_size: 8,
        table_number: 'T6',
        status: 'pending',
        special_requests: 'Business meeting'
      }
    ];

    console.log('Setting up sample reservations...');
    for (const reservation of sampleReservations) {
      const reservationNumber = `RES${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
      
      await dbRun(`
        INSERT INTO reservations 
        (reservation_number, customer_name, phone_number, reservation_date, 
         reservation_time, party_size, table_number, status, special_requests) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        reservationNumber,
        reservation.customer_name,
        reservation.phone_number,
        reservation.reservation_date,
        reservation.reservation_time,
        reservation.party_size,
        reservation.table_number,
        reservation.status,
        reservation.special_requests
      ]);
      console.log(`  - ${reservation.customer_name}: ${reservation.reservation_date} ${reservation.reservation_time} (${reservation.status})`);
    }

    console.log('\n✅ Reservation settings setup completed successfully!');
    console.log('\n📊 Summary:');
    console.log(`  - Business hours: ${businessHours.length} days configured`);
    console.log(`  - Table settings: ${tableSettings.length} tables configured`);
    console.log(`  - Time slots: ${timeSlots.length} time slots configured`);
    console.log(`  - Sample reservations: ${sampleReservations.length} reservations created`);
    
    console.log('\n🔧 Available API endpoints:');
    console.log('  - GET /api/reservation-settings/business-hours');
    console.log('  - PUT /api/reservation-settings/business-hours');
    console.log('  - GET /api/reservation-settings/table-settings');
    console.log('  - POST /api/reservation-settings/table-settings');
    console.log('  - GET /api/reservation-settings/time-slots');
    console.log('  - POST /api/reservation-settings/time-slots');
    console.log('  - GET /api/reservation-settings/system-settings');
    console.log('  - POST /api/reservation-settings/validate');

  } catch (error) {
    console.error('❌ Error setting up reservation settings:', error);
  } finally {
    db.close();
  }
};

setupReservationSettings(); 
