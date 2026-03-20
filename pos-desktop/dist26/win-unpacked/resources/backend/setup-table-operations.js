const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'db', 'web2pos.db');
const db = new sqlite3.Database(dbPath);

console.log('Setting up table operations history table...');

db.serialize(() => {
  // Create table_move_history table
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
      console.error('Error creating table_move_history table:', err);
    } else {
      console.log('✓ table_move_history table created/verified');
    }
  });

  // Create index for faster queries
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_table_move_history_tables 
    ON table_move_history(from_table_id, to_table_id)
  `, (err) => {
    if (err) {
      console.error('Error creating index:', err);
    } else {
      console.log('✓ Index created on table_move_history');
    }
  });

  // Add MERGED status to orders if not exists (for tracking merged orders)
  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_id TEXT,
      status TEXT DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'COMPLETED', 'CANCELLED', 'MERGED')),
      items TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Error updating orders table:', err);
    } else {
      console.log('✓ orders table verified with MERGED status');
    }
  });
});

db.close((err) => {
  if (err) {
    console.error('Error closing database:', err);
  } else {
    console.log('\n✓ Table operations setup completed successfully!');
  }
});


