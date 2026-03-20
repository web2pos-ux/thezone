// Create table_move_history table in the correct database
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'db', 'web2pos.db');
console.log('Database path:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
  console.log('Connected to database');
});

db.run(`
  CREATE TABLE IF NOT EXISTS table_move_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_table_id TEXT NOT NULL,
    to_table_id TEXT NOT NULL,
    action_type TEXT NOT NULL CHECK(action_type IN ('MOVE', 'MERGE')),
    order_id INTEGER,
    from_order_id INTEGER,
    floor TEXT DEFAULT '1F',
    performed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    performed_by TEXT
  )
`, (err) => {
  if (err) {
    console.error('❌ Error creating table:', err);
    process.exit(1);
  }
  console.log('✅ table_move_history table created successfully');
  
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_table_move_history_tables 
    ON table_move_history(from_table_id, to_table_id)
  `, (err) => {
    if (err) {
      console.error('❌ Error creating index:', err);
    } else {
      console.log('✅ Index created successfully');
    }
    
    db.close((err) => {
      if (err) {
        console.error('Error closing database:', err);
      }
      console.log('Done!');
    });
  });
});

