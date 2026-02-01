const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'db', 'web2pos.db');
console.log('Database path:', dbPath);

const db = new sqlite3.Database(dbPath);

db.all('PRAGMA table_info(table_map_elements)', (err, rows) => {
  if (err) {
    console.error('Error:', err);
  } else {
    console.log('Table schema:');
    rows.forEach(row => {
      console.log(`  ${row.name}: ${row.type} (notnull: ${row.notnull}, pk: ${row.pk})`);
    });
  }
  db.close();
}); 
