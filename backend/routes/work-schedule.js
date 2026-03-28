const express = require('express');
const router = express.Router();

// 공유 데이터베이스 모듈 사용 (환경 변수 DB_PATH 지원 - Electron 앱 호환)
const { db } = require('../db');

// Helper function to get database connection (레거시 호환)
const getDb = () => db;

// ======================
// EMPLOYEES ENDPOINTS
// ======================

// GET all employees
router.get('/employees', (req, res) => {
  const db = getDb();
  
  db.all(
    'SELECT * FROM employees WHERE status = "active" ORDER BY name',
    [],
    (err, rows) => {
      // db.close(); // Shared DB 연결은 닫으면 안 됨
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(rows);
    }
  );
});

// GET single employee
router.get('/employees/:id', (req, res) => {
  const db = getDb();
  
  db.get(
    'SELECT * FROM employees WHERE id = ?',
    [req.params.id],
    (err, row) => {
      // db.close(); // Shared DB 연결은 닫으면 안 됨
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!row) {
        return res.status(404).json({ error: 'Employee not found' });
      }
      res.json(row);
    }
  );
});

// POST create employee
router.post('/employees', (req, res) => {
  const { id, name, role, department, email, phone, hire_date, pin, permit_level } = req.body;
  
  if (!id || !name || !role || !department || !pin) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  const db = getDb();
  
  db.run(
    `INSERT INTO employees (id, name, role, department, email, phone, hire_date, pin, permit_level, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    [id, name, role, department, email, phone, hire_date, pin, permit_level || 2],
    function(err) {
      if (err) {
        // db.close(); // Shared DB 연결은 닫으면 안 됨
        return res.status(500).json({ error: err.message });
      }
      
      db.get(
        'SELECT * FROM employees WHERE id = ?',
        [id],
        (err, row) => {
          // db.close(); // Shared DB 연결은 닫으면 안 됨
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          res.status(201).json(row);
        }
      );
    }
  );
});

// PUT update employee
router.put('/employees/:id', (req, res) => {
  const { name, role, department, email, phone, status, pin, permit_level } = req.body;
  const db = getDb();
  
  db.run(
    `UPDATE employees 
     SET name = COALESCE(?, name),
         role = COALESCE(?, role),
         department = COALESCE(?, department),
         email = COALESCE(?, email),
         phone = COALESCE(?, phone),
         status = COALESCE(?, status),
         pin = COALESCE(?, pin),
         permit_level = COALESCE(?, permit_level),
         updated_at = datetime('now')
     WHERE id = ?`,
    [name, role, department, email, phone, status, pin, permit_level, req.params.id],
    function(err) {
      if (err) {
        // db.close(); // Shared DB 연결은 닫으면 안 됨
        return res.status(500).json({ error: err.message });
      }
      
      if (this.changes === 0) {
        // db.close(); // Shared DB 연결은 닫으면 안 됨
        return res.status(404).json({ error: 'Employee not found' });
      }
      
      db.get(
        'SELECT * FROM employees WHERE id = ?',
        [req.params.id],
        (err, row) => {
          // db.close(); // Shared DB 연결은 닫으면 안 됨
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          res.json(row);
        }
      );
    }
  );
});

// Update employee PIN only
router.put('/employees/:id/pin', (req, res) => {
  const { pin } = req.body;
  if (!pin) {
    return res.status(400).json({ error: 'PIN is required' });
  }
  const db = getDb();
  db.run(
    `UPDATE employees 
     SET pin = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [pin, req.params.id],
    function(err) {
      if (err) {
        // db.close(); // Shared DB 연결은 닫으면 안 됨
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        // db.close(); // Shared DB 연결은 닫으면 안 됨
        return res.status(404).json({ error: 'Employee not found' });
      }
      db.get(
        'SELECT id, pin FROM employees WHERE id = ?',
        [req.params.id],
        (err, row) => {
          // db.close(); // Shared DB 연결은 닫으면 안 됨
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          res.json(row);
        }
      );
    }
  );
});

// DELETE employee (soft delete)
router.delete('/employees/:id', (req, res) => {
  const db = getDb();
  
  db.run(
    `UPDATE employees SET status = 'inactive', updated_at = datetime('now') WHERE id = ?`,
    [req.params.id],
    function(err) {
      // db.close(); // Shared DB 연결은 닫으면 안 됨
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Employee not found' });
      }
      res.json({ message: 'Employee deactivated successfully' });
    }
  );
});

// ======================
// WORK SCHEDULES ENDPOINTS
// ======================

// GET schedules (with optional date range and employee filter)
router.get('/schedules', (req, res) => {
  const { startDate, endDate, employeeId } = req.query;
  const db = getDb();
  
  let query = 'SELECT * FROM work_schedules WHERE 1=1';
  const params = [];
  
  if (startDate) {
    query += ' AND date >= ?';
    params.push(startDate);
  }
  
  if (endDate) {
    query += ' AND date <= ?';
    params.push(endDate);
  }
  
  if (employeeId) {
    query += ' AND employee_id = ?';
    params.push(employeeId);
  }
  
  query += ' ORDER BY date, employee_id';
  
  db.all(query, params, (err, rows) => {
    // db.close(); // Shared DB 연결은 닫으면 안 됨
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// GET single schedule
router.get('/schedules/:id', (req, res) => {
  const db = getDb();
  
  db.get(
    'SELECT * FROM work_schedules WHERE id = ?',
    [req.params.id],
    (err, row) => {
      // db.close(); // Shared DB 연결은 닫으면 안 됨
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!row) {
        return res.status(404).json({ error: 'Schedule not found' });
      }
      res.json(row);
    }
  );
});

// POST create or update schedule
router.post('/schedules', (req, res) => {
  const { employeeId, date, scheduledStart, scheduledEnd, workedStart, workedEnd, swappedWith, notes } = req.body;
  
  if (!employeeId || !date) {
    return res.status(400).json({ error: 'Missing required fields: employeeId, date' });
  }
  
  const db = getDb();
  
  db.run(
    `INSERT INTO work_schedules (employee_id, date, scheduled_start, scheduled_end, worked_start, worked_end, swapped_with, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(employee_id, date) DO UPDATE SET
       scheduled_start = COALESCE(excluded.scheduled_start, scheduled_start),
       scheduled_end = COALESCE(excluded.scheduled_end, scheduled_end),
       worked_start = COALESCE(excluded.worked_start, worked_start),
       worked_end = COALESCE(excluded.worked_end, worked_end),
       swapped_with = COALESCE(excluded.swapped_with, swapped_with),
       notes = COALESCE(excluded.notes, notes),
       updated_at = datetime('now')`,
    [employeeId, date, scheduledStart, scheduledEnd, workedStart, workedEnd, swappedWith, notes],
    function(err) {
      if (err) {
        // db.close(); // Shared DB 연결은 닫으면 안 됨
        return res.status(500).json({ error: err.message });
      }
      
      db.get(
        'SELECT * FROM work_schedules WHERE employee_id = ? AND date = ?',
        [employeeId, date],
        (err, row) => {
          // db.close(); // Shared DB 연결은 닫으면 안 됨
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          res.status(201).json(row);
        }
      );
    }
  );
});

// PUT update schedule
router.put('/schedules/:id', (req, res) => {
  const { scheduledStart, scheduledEnd, workedStart, workedEnd, swappedWith, notes } = req.body;
  const db = getDb();
  
  db.run(
    `UPDATE work_schedules
     SET scheduled_start = COALESCE(?, scheduled_start),
         scheduled_end = COALESCE(?, scheduled_end),
         worked_start = COALESCE(?, worked_start),
         worked_end = COALESCE(?, worked_end),
         swapped_with = COALESCE(?, swapped_with),
         notes = COALESCE(?, notes),
         updated_at = datetime('now')
     WHERE id = ?`,
    [scheduledStart, scheduledEnd, workedStart, workedEnd, swappedWith, notes, req.params.id],
    function(err) {
      if (err) {
        // db.close(); // Shared DB 연결은 닫으면 안 됨
        return res.status(500).json({ error: err.message });
      }
      
      if (this.changes === 0) {
        // db.close(); // Shared DB 연결은 닫으면 안 됨
        return res.status(404).json({ error: 'Schedule not found' });
      }
      
      db.get(
        'SELECT * FROM work_schedules WHERE id = ?',
        [req.params.id],
        (err, row) => {
          // db.close(); // Shared DB 연결은 닫으면 안 됨
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          res.json(row);
        }
      );
    }
  );
});

// DELETE schedule
router.delete('/schedules/:id', (req, res) => {
  const db = getDb();
  
  db.run(
    'DELETE FROM work_schedules WHERE id = ?',
    [req.params.id],
    function(err) {
      // db.close(); // Shared DB 연결은 닫으면 안 됨
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Schedule not found' });
      }
      res.json({ message: 'Schedule deleted successfully' });
    }
  );
});

// POST bulk create/update schedules
router.post('/schedules/bulk', (req, res) => {
  const { schedules } = req.body;
  
  if (!Array.isArray(schedules) || schedules.length === 0) {
    return res.status(400).json({ error: 'schedules must be a non-empty array' });
  }
  
  const db = getDb();
  
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    
    const stmt = db.prepare(`
      INSERT INTO work_schedules (employee_id, date, scheduled_start, scheduled_end, worked_start, worked_end, swapped_with, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(employee_id, date) DO UPDATE SET
        scheduled_start = COALESCE(excluded.scheduled_start, scheduled_start),
        scheduled_end = COALESCE(excluded.scheduled_end, scheduled_end),
        worked_start = COALESCE(excluded.worked_start, worked_start),
        worked_end = COALESCE(excluded.worked_end, worked_end),
        swapped_with = COALESCE(excluded.swapped_with, swapped_with),
        notes = COALESCE(excluded.notes, notes),
        updated_at = datetime('now')
    `);
    
    let errors = [];
    schedules.forEach((schedule, index) => {
      const { employeeId, date, scheduledStart, scheduledEnd, workedStart, workedEnd, swappedWith, notes } = schedule;
      
      if (!employeeId || !date) {
        errors.push({ index, error: 'Missing employeeId or date' });
        return;
      }
      
      stmt.run(employeeId, date, scheduledStart, scheduledEnd, workedStart, workedEnd, swappedWith, notes, (err) => {
        if (err) {
          errors.push({ index, error: err.message });
        }
      });
    });
    
    stmt.finalize((err) => {
      if (err || errors.length > 0) {
        db.run('ROLLBACK', () => {
          // db.close(); // Shared DB 연결은 닫으면 안 됨
          return res.status(500).json({ 
            error: 'Failed to insert schedules', 
            details: errors 
          });
        });
      } else {
        db.run('COMMIT', (err) => {
          // db.close(); // Shared DB 연결은 닫으면 안 됨
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          res.status(201).json({ 
            message: `Successfully saved ${schedules.length} schedules` 
          });
        });
      }
    });
  });
});

// ======================
// SHIFT SWAP REQUESTS ENDPOINTS
// ======================

// GET all shift swap requests
router.get('/shift-swaps', (req, res) => {
  const { status, employeeId } = req.query;
  const db = getDb();
  
  let query = 'SELECT * FROM shift_swap_requests WHERE 1=1';
  const params = [];
  
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  
  if (employeeId) {
    query += ' AND (employee1_id = ? OR employee2_id = ?)';
    params.push(employeeId, employeeId);
  }
  
  query += ' ORDER BY requested_date DESC';
  
  db.all(query, params, (err, rows) => {
    // db.close(); // Shared DB 연결은 닫으면 안 됨
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// GET single shift swap request
router.get('/shift-swaps/:id', (req, res) => {
  const db = getDb();
  
  db.get(
    'SELECT * FROM shift_swap_requests WHERE id = ?',
    [req.params.id],
    (err, row) => {
      // db.close(); // Shared DB 연결은 닫으면 안 됨
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!row) {
        return res.status(404).json({ error: 'Shift swap request not found' });
      }
      res.json(row);
    }
  );
});

// POST create shift swap request
router.post('/shift-swaps', (req, res) => {
  const {
    id,
    employee1Id,
    employee1Name,
    employee1Date,
    employee1Time,
    employee2Id,
    employee2Name,
    employee2Date,
    employee2Time,
    status,
    mode,
    requestedDate,
    notes
  } = req.body;
  
  if (!id || !employee1Id || !employee2Id || !requestedDate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  const db = getDb();
  
  db.run(
    `INSERT INTO shift_swap_requests (
      id, employee1_id, employee1_name, employee1_date, employee1_time,
      employee2_id, employee2_name, employee2_date, employee2_time,
      status, mode, requested_date, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, employee1Id, employee1Name, employee1Date, employee1Time,
      employee2Id, employee2Name, employee2Date, employee2Time,
      status || 'pending', mode || 'swap', requestedDate, notes
    ],
    function(err) {
      if (err) {
        // db.close(); // Shared DB 연결은 닫으면 안 됨
        return res.status(500).json({ error: err.message });
      }
      
      db.get(
        'SELECT * FROM shift_swap_requests WHERE id = ?',
        [id],
        (err, row) => {
          // db.close(); // Shared DB 연결은 닫으면 안 됨
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          res.status(201).json(row);
        }
      );
    }
  );
});

// PUT update shift swap request
router.put('/shift-swaps/:id', (req, res) => {
  const { status, approver, approvedDate, notes } = req.body;
  const db = getDb();
  
  db.run(
    `UPDATE shift_swap_requests
     SET status = COALESCE(?, status),
         approver = COALESCE(?, approver),
         approved_date = COALESCE(?, approved_date),
         notes = COALESCE(?, notes),
         updated_at = datetime('now')
     WHERE id = ?`,
    [status, approver, approvedDate, notes, req.params.id],
    function(err) {
      if (err) {
        // db.close(); // Shared DB 연결은 닫으면 안 됨
        return res.status(500).json({ error: err.message });
      }
      
      if (this.changes === 0) {
        // db.close(); // Shared DB 연결은 닫으면 안 됨
        return res.status(404).json({ error: 'Shift swap request not found' });
      }
      
      db.get(
        'SELECT * FROM shift_swap_requests WHERE id = ?',
        [req.params.id],
        (err, row) => {
          // db.close(); // Shared DB 연결은 닫으면 안 됨
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          res.json(row);
        }
      );
    }
  );
});

// DELETE shift swap request
router.delete('/shift-swaps/:id', (req, res) => {
  const db = getDb();
  
  db.run(
    'DELETE FROM shift_swap_requests WHERE id = ?',
    [req.params.id],
    function(err) {
      // db.close(); // Shared DB 연결은 닫으면 안 됨
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Shift swap request not found' });
      }
      res.json({ message: 'Shift swap request deleted successfully' });
    }
  );
});

// ======================
// TIME OFF REQUESTS ENDPOINTS
// ======================

// GET all time off requests
router.get('/time-off', (req, res) => {
  const { status, employeeId, startDate, endDate } = req.query;
  const db = getDb();
  
  let query = 'SELECT * FROM time_off_requests WHERE 1=1';
  const params = [];
  
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  
  if (employeeId) {
    query += ' AND employee_id = ?';
    params.push(employeeId);
  }
  
  if (startDate) {
    query += ' AND end_date >= ?';
    params.push(startDate);
  }
  
  if (endDate) {
    query += ' AND start_date <= ?';
    params.push(endDate);
  }
  
  query += ' ORDER BY requested_date DESC';
  
  db.all(query, params, (err, rows) => {
    // db.close(); // Shared DB 연결은 닫으면 안 됨
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// GET single time off request
router.get('/time-off/:id', (req, res) => {
  const db = getDb();
  
  db.get(
    'SELECT * FROM time_off_requests WHERE id = ?',
    [req.params.id],
    (err, row) => {
      // db.close(); // Shared DB 연결은 닫으면 안 됨
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!row) {
        return res.status(404).json({ error: 'Time off request not found' });
      }
      res.json(row);
    }
  );
});

// POST create time off request
router.post('/time-off', (req, res) => {
  const {
    id,
    employeeId,
    employeeName,
    type,
    startDate,
    endDate,
    reason,
    status,
    requestedDate,
    isPartial,
    partialStartTime,
    partialEndTime
  } = req.body;
  
  if (!id || !employeeId || !type || !startDate || !endDate || !requestedDate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  const db = getDb();
  
  db.run(
    `INSERT INTO time_off_requests (
      id, employee_id, employee_name, type, start_date, end_date,
      reason, status, requested_date, is_partial, partial_start_time, partial_end_time
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, employeeId, employeeName, type, startDate, endDate,
      reason, status || 'pending', requestedDate, isPartial ? 1 : 0, partialStartTime, partialEndTime
    ],
    function(err) {
      if (err) {
        // db.close(); // Shared DB 연결은 닫으면 안 됨
        return res.status(500).json({ error: err.message });
      }
      
      db.get(
        'SELECT * FROM time_off_requests WHERE id = ?',
        [id],
        (err, row) => {
          // db.close(); // Shared DB 연결은 닫으면 안 됨
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          res.status(201).json(row);
        }
      );
    }
  );
});

// PUT update time off request
router.put('/time-off/:id', (req, res) => {
  const { status, approver, approvedDate, reason } = req.body;
  const db = getDb();
  
  db.run(
    `UPDATE time_off_requests
     SET status = COALESCE(?, status),
         approver = COALESCE(?, approver),
         approved_date = COALESCE(?, approved_date),
         reason = COALESCE(?, reason),
         updated_at = datetime('now')
     WHERE id = ?`,
    [status, approver, approvedDate, reason, req.params.id],
    function(err) {
      if (err) {
        // db.close(); // Shared DB 연결은 닫으면 안 됨
        return res.status(500).json({ error: err.message });
      }
      
      if (this.changes === 0) {
        // db.close(); // Shared DB 연결은 닫으면 안 됨
        return res.status(404).json({ error: 'Time off request not found' });
      }
      
      db.get(
        'SELECT * FROM time_off_requests WHERE id = ?',
        [req.params.id],
        (err, row) => {
          // db.close(); // Shared DB 연결은 닫으면 안 됨
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          res.json(row);
        }
      );
    }
  );
});

// DELETE time off request
router.delete('/time-off/:id', (req, res) => {
  const db = getDb();
  
  db.run(
    'DELETE FROM time_off_requests WHERE id = ?',
    [req.params.id],
    function(err) {
      // db.close(); // Shared DB 연결은 닫으면 안 됨
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Time off request not found' });
      }
      res.json({ message: 'Time off request deleted successfully' });
    }
  );
});

// ======================
// CLOCK IN/OUT ENDPOINTS
// ======================

const getLocalBusinessDate = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

// POST verify PIN and get employee info
router.post('/verify-pin', (req, res) => {
  const { pin } = req.body;
  
  if (!pin) {
    return res.status(400).json({ error: 'PIN is required' });
  }
  
  const db = getDb();
  
  db.get(
    'SELECT id, name, role, department FROM employees WHERE pin = ? AND status = "active"',
    [pin],
    (err, row) => {
      // db.close(); // Shared DB 연결은 닫으면 안 됨
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!row) {
        return res.status(401).json({ error: 'Invalid PIN or inactive employee' });
      }
      res.json({ employee: row });
    }
  );
});

// POST clock in
router.post('/clock-in', (req, res) => {
  const { employeeId, employeeName, pin } = req.body;
  
  if (!employeeId || !pin) {
    return res.status(400).json({ error: 'Employee ID and PIN are required' });
  }
  
  const db = getDb();
  const now = new Date().toISOString();
  const today = getLocalBusinessDate();
  
  // Verify PIN first
  db.get(
    'SELECT id, name FROM employees WHERE id = ? AND pin = ? AND status = "active"',
    [employeeId, pin],
    (err, employee) => {
      if (err) {
        // db.close(); // Shared DB 연결은 닫으면 안 됨
        return res.status(500).json({ error: err.message });
      }
      if (!employee) {
        // db.close(); // Shared DB 연결은 닫으면 안 됨
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      // Check if already clocked in today
      db.get(
        'SELECT id FROM clock_records WHERE employee_id = ? AND date(clock_in_time) = ? AND clock_out_time IS NULL',
        [employeeId, today],
        (err, existingRecord) => {
          if (err) {
            // db.close(); // Shared DB 연결은 닫으면 안 됨
            return res.status(500).json({ error: err.message });
          }
          if (existingRecord) {
            // db.close(); // Shared DB 연결은 닫으면 안 됨
            return res.status(400).json({ error: 'Already clocked in today' });
          }
          
          // Check if there's a schedule for today
          db.get(
            'SELECT id FROM work_schedules WHERE employee_id = ? AND date = ?',
            [employeeId, today],
            (err, schedule) => {
              const scheduleId = schedule ? schedule.id : null;
              
              // Create clock in record
              db.run(
                `INSERT INTO clock_records (employee_id, employee_name, clock_in_time, scheduled_shift_id, status)
                 VALUES (?, ?, ?, ?, 'clocked_in')`,
                [employeeId, employeeName || employee.name, now, scheduleId],
                function(err) {
                  if (err) {
                    // db.close(); // Shared DB 연결은 닫으면 안 됨
                    return res.status(500).json({ error: err.message });
                  }
                  const clockRecordId = this.lastID;

                  // Create server shift session (accounting shift)
                  db.run(
                    `INSERT INTO server_shifts (server_id, clock_record_id, business_date, clock_in_time, status, updated_at)
                     VALUES (?, ?, ?, ?, 'open', datetime('now'))`,
                    [employeeId, clockRecordId, today, now],
                    function(shiftErr) {
                      if (shiftErr) {
                        console.error('[server_shifts] create failed:', shiftErr.message);
                      }
                      const serverShiftId = this?.lastID || null;
                  
                  // Update work_schedules worked_start if schedule exists
                  if (scheduleId) {
                    db.run(
                      'UPDATE work_schedules SET worked_start = ? WHERE id = ?',
                      [now, scheduleId],
                      (err) => {
                        // db.close(); // Shared DB 연결은 닫으면 안 됨
                        if (err) {
                          console.error('Error updating schedule:', err);
                        }
                        res.status(201).json({
                          message: 'Clocked in successfully',
                          recordId: clockRecordId,
                          shiftId: serverShiftId,
                          clockInTime: now,
                          hasSchedule: true
                        });
                      }
                    );
                  } else {
                    // db.close(); // Shared DB 연결은 닫으면 안 됨
                    res.status(201).json({
                      message: 'Clocked in successfully (no schedule found)',
                      recordId: clockRecordId,
                      shiftId: serverShiftId,
                      clockInTime: now,
                      hasSchedule: false
                    });
                  }
                    }
                  );
                }
              );
            }
          );
        }
      );
    }
  );
});

// POST clock out
router.post('/clock-out', (req, res) => {
  const { employeeId, pin, earlyOut, earlyOutReason, approvedBy } = req.body;
  
  if (!employeeId || !pin) {
    return res.status(400).json({ error: 'Employee ID and PIN are required' });
  }
  
  const db = getDb();
  const now = new Date().toISOString();
  const today = getLocalBusinessDate();
  
  // Verify PIN first
  db.get(
    'SELECT id FROM employees WHERE id = ? AND pin = ? AND status = "active"',
    [employeeId, pin],
    (err, employee) => {
      if (err) {
        // db.close(); // Shared DB 연결은 닫으면 안 됨
        return res.status(500).json({ error: err.message });
      }
      if (!employee) {
        // db.close(); // Shared DB 연결은 닫으면 안 됨
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      // Find today's clock in record
      db.get(
        'SELECT * FROM clock_records WHERE employee_id = ? AND date(clock_in_time) = ? AND clock_out_time IS NULL',
        [employeeId, today],
        (err, record) => {
          if (err) {
            // db.close(); // Shared DB 연결은 닫으면 안 됨
            return res.status(500).json({ error: err.message });
          }
          if (!record) {
            // db.close(); // Shared DB 연결은 닫으면 안 됨
            return res.status(400).json({ error: 'No active clock in record found' });
          }
          
          // Calculate total hours
          const clockInTime = new Date(record.clock_in_time);
          const clockOutTime = new Date(now);
          const totalHours = (clockOutTime - clockInTime) / (1000 * 60 * 60);
          
          // Update clock out record
          db.run(
            `UPDATE clock_records 
             SET clock_out_time = ?,
                 total_hours = ?,
                 status = 'clocked_out',
                 early_out_approved_by = ?,
                 early_out_reason = ?,
                 updated_at = datetime('now')
             WHERE id = ?`,
            [now, totalHours.toFixed(2), approvedBy || null, earlyOutReason || null, record.id],
            function(err) {
              if (err) {
                // db.close(); // Shared DB 연결은 닫으면 안 됨
                return res.status(500).json({ error: err.message });
              }

              // Close server shift session if exists
              db.run(
                `UPDATE server_shifts
                 SET clock_out_time = ?, status = 'closed', updated_at = datetime('now')
                 WHERE server_id = ?
                   AND business_date = ?
                   AND clock_record_id = ?
                   AND status = 'open'`,
                [now, employeeId, today, record.id],
                (shiftErr) => {
                  if (shiftErr) console.error('[server_shifts] close failed:', shiftErr.message);
                }
              );
              
              // Update work_schedules worked_end if schedule exists
              if (record.scheduled_shift_id) {
                let notes = '';
                if (earlyOut) {
                  notes = `Early Out: ${earlyOutReason || 'No reason provided'}. Approved by: ${approvedBy || 'N/A'}`;
                }
                
                db.run(
                  `UPDATE work_schedules 
                   SET worked_end = ?,
                       notes = CASE 
                         WHEN notes IS NULL OR notes = '' THEN ?
                         ELSE notes || '\n' || ?
                       END
                   WHERE id = ?`,
                  [now, notes, notes, record.scheduled_shift_id],
                  (err) => {
                    // db.close(); // Shared DB 연결은 닫으면 안 됨
                    if (err) {
                      console.error('Error updating schedule:', err);
                    }
                    res.json({
                      message: 'Clocked out successfully',
                      clockOutTime: now,
                      totalHours: totalHours.toFixed(2),
                      earlyOut: earlyOut || false
                    });
                  }
                );
              } else {
                // db.close(); // Shared DB 연결은 닫으면 안 됨
                res.json({
                  message: 'Clocked out successfully',
                  clockOutTime: now,
                  totalHours: totalHours.toFixed(2),
                  earlyOut: earlyOut || false
                });
              }
            }
          );
        }
      );
    }
  );
});

// GET currently clocked in employees
router.get('/clocked-in', (req, res) => {
  const db = getDb();
  
  db.all(
    `SELECT 
       cr.id,
       cr.employee_id,
       cr.employee_name,
       cr.clock_in_time,
       e.role,
       e.department
     FROM clock_records cr
     JOIN employees e ON cr.employee_id = e.id
     WHERE cr.clock_out_time IS NULL
     ORDER BY cr.clock_in_time`,
    [],
    (err, rows) => {
      // db.close(); // Shared DB 연결은 닫으면 안 됨
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(rows);
    }
  );
});

// GET employee's clock history
router.get('/clock-history/:employeeId', (req, res) => {
  const { startDate, endDate, limit = 30 } = req.query;
  const db = getDb();
  
  let query = 'SELECT * FROM clock_records WHERE employee_id = ?';
  const params = [req.params.employeeId];
  
  if (startDate) {
    query += ' AND date(clock_in_time) >= ?';
    params.push(startDate);
  }
  
  if (endDate) {
    query += ' AND date(clock_in_time) <= ?';
    params.push(endDate);
  }
  
  query += ' ORDER BY clock_in_time DESC LIMIT ?';
  params.push(parseInt(limit));
  
  db.all(query, params, (err, rows) => {
    // db.close(); // Shared DB 연결은 닫으면 안 됨
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// ======================
// ACTIVITY LOGS ENDPOINTS
// ======================

// GET activity logs
router.get('/activity-logs', (req, res) => {
  const { type, employeeId, startDate, endDate, limit = 100 } = req.query;
  const db = getDb();
  
  let query = 'SELECT * FROM activity_logs WHERE 1=1';
  const params = [];
  
  if (type) {
    query += ' AND type = ?';
    params.push(type);
  }
  
  if (employeeId) {
    query += ' AND employee_id = ?';
    params.push(employeeId);
  }
  
  if (startDate) {
    query += ' AND timestamp >= ?';
    params.push(startDate);
  }
  
  if (endDate) {
    query += ' AND timestamp <= ?';
    params.push(endDate);
  }
  
  query += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(parseInt(limit));
  
  db.all(query, params, (err, rows) => {
    // db.close(); // Shared DB 연결은 닫으면 안 됨
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// POST create activity log
router.post('/activity-logs', (req, res) => {
  const { id, type, action, employeeId, employeeName, details, timestamp, user } = req.body;
  
  if (!id || !type || !action || !timestamp) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  const db = getDb();
  
  db.run(
    `INSERT INTO activity_logs (id, type, action, employee_id, employee_name, details, timestamp, user)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, type, action, employeeId, employeeName, details, timestamp, user],
    function(err) {
      if (err) {
        // db.close(); // Shared DB 연결은 닫으면 안 됨
        return res.status(500).json({ error: err.message });
      }
      
      db.get(
        'SELECT * FROM activity_logs WHERE id = ?',
        [id],
        (err, row) => {
          // db.close(); // Shared DB 연결은 닫으면 안 됨
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          res.status(201).json(row);
        }
      );
    }
  );
});

// DELETE activity log
router.delete('/activity-logs/:id', (req, res) => {
  const db = getDb();
  
  db.run(
    'DELETE FROM activity_logs WHERE id = ?',
    [req.params.id],
    function(err) {
      // db.close(); // Shared DB 연결은 닫으면 안 됨
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Activity log not found' });
      }
      res.json({ message: 'Activity log deleted successfully' });
    }
  );
});

module.exports = router;

