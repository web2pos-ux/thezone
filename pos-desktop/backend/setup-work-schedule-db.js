const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'db', 'web2pos.db');
const db = new sqlite3.Database(dbPath);

console.log('Creating Work Schedule tables...');

db.serialize(() => {
  // 1. Employees Table
  db.run(`
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      department TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      hire_date TEXT,
      permit_level INTEGER DEFAULT 2,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `, (err) => {
    if (err) {
      console.error('Error creating employees table:', err);
    } else {
      console.log('✓ Employees table created');
      // Add permit_level column if it doesn't exist (migration for existing tables)
      db.run(`ALTER TABLE employees ADD COLUMN permit_level INTEGER DEFAULT 2`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
          console.error('Error adding permit_level column:', err);
        }
      });
    }
  });

  // 2. Work Schedules Table
  db.run(`
    CREATE TABLE IF NOT EXISTS work_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id TEXT NOT NULL,
      date TEXT NOT NULL,
      scheduled_start TEXT,
      scheduled_end TEXT,
      worked_start TEXT,
      worked_end TEXT,
      swapped_with TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
      UNIQUE(employee_id, date)
    )
  `, (err) => {
    if (err) {
      console.error('Error creating work_schedules table:', err);
    } else {
      console.log('✓ Work Schedules table created');
    }
  });

  // 3. Shift Swap Requests Table
  db.run(`
    CREATE TABLE IF NOT EXISTS shift_swap_requests (
      id TEXT PRIMARY KEY,
      employee1_id TEXT NOT NULL,
      employee1_name TEXT NOT NULL,
      employee1_date TEXT NOT NULL,
      employee1_time TEXT,
      employee2_id TEXT NOT NULL,
      employee2_name TEXT NOT NULL,
      employee2_date TEXT NOT NULL,
      employee2_time TEXT,
      status TEXT DEFAULT 'pending',
      mode TEXT DEFAULT 'swap',
      requested_date TEXT NOT NULL,
      approved_date TEXT,
      approver TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (employee1_id) REFERENCES employees(id) ON DELETE CASCADE,
      FOREIGN KEY (employee2_id) REFERENCES employees(id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) {
      console.error('Error creating shift_swap_requests table:', err);
    } else {
      console.log('✓ Shift Swap Requests table created');
    }
  });

  // 4. Time Off Requests Table
  db.run(`
    CREATE TABLE IF NOT EXISTS time_off_requests (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      employee_name TEXT NOT NULL,
      type TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      reason TEXT,
      status TEXT DEFAULT 'pending',
      requested_date TEXT NOT NULL,
      approved_date TEXT,
      approver TEXT,
      is_partial BOOLEAN DEFAULT 0,
      partial_start_time TEXT,
      partial_end_time TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) {
      console.error('Error creating time_off_requests table:', err);
    } else {
      console.log('✓ Time Off Requests table created');
    }
  });

  // 5. Activity Logs Table
  db.run(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      action TEXT NOT NULL,
      employee_id TEXT,
      employee_name TEXT,
      details TEXT,
      timestamp TEXT NOT NULL,
      user TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `, (err) => {
    if (err) {
      console.error('Error creating activity_logs table:', err);
    } else {
      console.log('✓ Activity Logs table created');
    }
  });

  // 6. Create indexes for better query performance
  db.run('CREATE INDEX IF NOT EXISTS idx_work_schedules_employee ON work_schedules(employee_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_work_schedules_date ON work_schedules(date)');
  db.run('CREATE INDEX IF NOT EXISTS idx_shift_swap_employee1 ON shift_swap_requests(employee1_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_shift_swap_employee2 ON shift_swap_requests(employee2_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_time_off_employee ON time_off_requests(employee_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_time_off_dates ON time_off_requests(start_date, end_date)');
  db.run('CREATE INDEX IF NOT EXISTS idx_activity_logs_timestamp ON activity_logs(timestamp)');
  
  console.log('✓ Indexes created');

  // Insert mock employees
  const mockEmployees = [
    { id: '1', name: 'John Smith', role: 'Server', department: 'Hall' },
    { id: '2', name: 'Jane Doe', role: 'Server', department: 'Hall' },
    { id: '3', name: 'Mike Johnson', role: 'Chef', department: 'Kitchen' },
    { id: '4', name: 'Sarah Williams', role: 'Manager', department: 'Office Staff' },
    { id: '5', name: 'Tom Brown', role: 'Cook', department: 'Kitchen' },
    { id: '6', name: 'Emily Davis', role: 'Host', department: 'Hall' }
  ];

  const insertEmployee = db.prepare(`
    INSERT OR IGNORE INTO employees (id, name, role, department, status)
    VALUES (?, ?, ?, ?, 'active')
  `);

  mockEmployees.forEach(emp => {
    insertEmployee.run(emp.id, emp.name, emp.role, emp.department);
  });

  insertEmployee.finalize();
  console.log('✓ Mock employees inserted');
});

db.close((err) => {
  if (err) {
    console.error('Error closing database:', err);
  } else {
    console.log('\n✅ Work Schedule database setup completed!');
  }
});

