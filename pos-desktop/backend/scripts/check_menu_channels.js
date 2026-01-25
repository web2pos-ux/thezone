const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', '..', 'db', 'web2pos.db');
const db = new sqlite3.Database(dbPath);

// First, try to add the column if it doesn't exist
db.run('ALTER TABLE menus ADD COLUMN sales_channels TEXT DEFAULT "[]"', function(err) {
  if (err && !err.message.includes('duplicate column')) {
    // Column might already exist, that's fine
    console.log('Note:', err.message);
  } else if (!err) {
    console.log('Added sales_channels column to menus table.');
  }
  
  // Now query all menus
  db.all('SELECT menu_id, name, sales_channels FROM menus ORDER BY created_at DESC', [], (err, rows) => {
    if (err) {
      console.error('Error querying menus:', err);
    } else {
      console.log('\n=== Menu Sales Channels ===\n');
      rows.forEach(row => {
        const channels = row.sales_channels || '[]';
        console.log(`ID: ${row.menu_id}`);
        console.log(`Name: ${row.name}`);
        console.log(`Channels: ${channels}`);
        console.log('---');
      });
    }
    db.close();
  });
});


















