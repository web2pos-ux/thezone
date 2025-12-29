const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');

const dbPath = path.join(__dirname, 'db', 'web2pos.db');
const db = new sqlite3.Database(dbPath);

console.log('Setting up Clock In/Out system...\n');

db.serialize(() => {
  // 1. Add PIN column to employees table
  console.log('1. Adding PIN column to employees table...');
  db.run(`
    ALTER TABLE employees ADD COLUMN pin TEXT DEFAULT NULL
  `, (err) => {
    if (err) {
      if (err.message.includes('duplicate column')) {
        console.log('   ✓ PIN column already exists');
      } else {
        console.error('   ✗ Error adding PIN column:', err.message);
      }
    } else {
      console.log('   ✓ PIN column added successfully');
    }
  });

  // 2. Create clock_records table for tracking clock in/out history
  console.log('2. Creating clock_records table...');
  db.run(`
    CREATE TABLE IF NOT EXISTS clock_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id TEXT NOT NULL,
      employee_name TEXT,
      clock_in_time TEXT NOT NULL,
      clock_out_time TEXT,
      scheduled_shift_id INTEGER,
      early_out_approved_by TEXT,
      early_out_reason TEXT,
      total_hours REAL,
      status TEXT DEFAULT 'clocked_in',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) {
      console.error('   ✗ Error creating clock_records table:', err.message);
    } else {
      console.log('   ✓ clock_records table created successfully');
    }
  });

  // 3. Create index for faster queries
  console.log('3. Creating indexes...');
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_clock_records_employee 
    ON clock_records(employee_id)
  `, (err) => {
    if (err) {
      console.error('   ✗ Error creating index:', err.message);
    } else {
      console.log('   ✓ Index created successfully');
    }
  });

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_clock_records_date 
    ON clock_records(clock_in_time)
  `, (err) => {
    if (err) {
      console.error('   ✗ Error creating index:', err.message);
    } else {
      console.log('   ✓ Index created successfully');
    }
  });

  // 4. Insert sample PIN for testing (PIN: 1234 for all existing employees)
  console.log('4. Setting default PINs for existing employees...');
  const defaultPin = '1234'; // In production, this should be hashed
  
  db.run(`
    UPDATE employees 
    SET pin = ? 
    WHERE pin IS NULL
  `, [defaultPin], function(err) {
    if (err) {
      console.error('   ✗ Error setting default PINs:', err.message);
    } else {
      console.log(`   ✓ Default PIN (${defaultPin}) set for ${this.changes} employees`);
    }
  });

  // 5. Verify setup
  db.all(`
    SELECT name, COUNT(*) as count 
    FROM sqlite_master 
    WHERE type='table' AND name IN ('employees', 'clock_records', 'work_schedules')
  `, (err, rows) => {
    if (err) {
      console.error('Error verifying tables:', err);
    } else {
      console.log('\n5. Verification:');
      console.log('   Tables found:', rows.length);
      rows.forEach(row => {
        console.log(`   - ${row.name}`);
      });
    }
    
    db.close();
    console.log('\n✅ Clock In/Out setup complete!');
    console.log('\nNote: Default PIN for all employees is: 1234');
    console.log('You can change individual PINs through the Employee Info page.');
  });
});

