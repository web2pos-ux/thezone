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

const setupReservationData = async () => {
  try {
    console.log('Setting up reservation data...');

    // 1. Setup Business Hours (영업시간 설정)
    const businessHours = [
      { day: 0, open: '11:00', close: '22:00', is_open: 1 }, // Sunday
      { day: 1, open: '11:00', close: '22:00', is_open: 1 }, // Monday
      { day: 2, open: '11:00', close: '22:00', is_open: 1 }, // Tuesday
      { day: 3, open: '11:00', close: '22:00', is_open: 1 }, // Wednesday
      { day: 4, open: '11:00', close: '22:00', is_open: 1 }, // Thursday
      { day: 5, open: '11:00', close: '23:00', is_open: 1 }, // Friday
      { day: 6, open: '11:00', close: '23:00', is_open: 1 }, // Saturday
    ];

    for (const hour of businessHours) {
      await dbRun(`
        INSERT OR REPLACE INTO business_hours 
        (day_of_week, open_time, close_time, is_open) 
        VALUES (?, ?, ?, ?)
      `, [hour.day, hour.open, hour.close, hour.is_open]);
    }

    // 2. Setup Table Settings (테이블 설정)
    const tableSettings = [
      { number: 'T1', name: 'Table 1', min: 2, max: 4, reservable: 1 },
      { number: 'T2', name: 'Table 2', min: 2, max: 4, reservable: 1 },
      { number: 'T3', name: 'Table 3', min: 2, max: 6, reservable: 1 },
      { number: 'T4', name: 'Table 4', min: 2, max: 6, reservable: 1 },
      { number: 'T5', name: 'Table 5', min: 4, max: 8, reservable: 1 },
      { number: 'T6', name: 'Table 6', min: 4, max: 8, reservable: 1 },
      { number: 'VIP1', name: 'VIP Table 1', min: 2, max: 6, reservable: 1 },
      { number: 'VIP2', name: 'VIP Table 2', min: 2, max: 6, reservable: 1 },
    ];

    for (const table of tableSettings) {
      await dbRun(`
        INSERT OR REPLACE INTO table_settings 
        (table_number, table_name, is_reservable, min_capacity, max_capacity) 
        VALUES (?, ?, ?, ?, ?)
      `, [table.number, table.name, table.reservable, table.min, table.max]);
    }

    // 3. Setup Time Slots (예약 가능 시간대)
    const timeSlots = [
      '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30',
      '17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00'
    ];

    for (const time of timeSlots) {
      await dbRun(`
        INSERT OR REPLACE INTO reservation_time_slots 
        (time_slot, is_available, max_reservations) 
        VALUES (?, 1, 10)
      `, [time]);
    }

    // 4. Sample Reservations (샘플 예약 데이터)
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
      }
    ];

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
    }

    console.log('Reservation data setup completed successfully!');
    console.log('Sample data includes:');
    console.log('- Business hours for all days');
    console.log('- 8 table settings');
    console.log('- 17 time slots');
    console.log('- 3 sample reservations');

  } catch (error) {
    console.error('Error setting up reservation data:', error);
  } finally {
    db.close();
  }
};

setupReservationData(); 