// Fix online_day_off table schema
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '../../db/web2pos.db');
console.log('Database path:', dbPath);

const db = new sqlite3.Database(dbPath);

db.serialize(function() {
  // 1. Check existing data
  db.all('SELECT * FROM online_day_off', function(err, rows) {
    if (err) {
      console.log('No existing table or error:', err.message);
      rows = [];
    }
    console.log('Existing data:', rows ? rows.length : 0, 'rows');
    if (rows && rows.length > 0) {
      console.log('Sample row:', rows[0]);
    }
    
    // 2. Drop existing table
    db.run('DROP TABLE IF EXISTS online_day_off', function(err) {
      if (err) {
        console.log('Drop error:', err.message);
      } else {
        console.log('Old table dropped');
      }
      
      // 3. Create new table with correct schema
      const createSQL = `
        CREATE TABLE online_day_off (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT NOT NULL UNIQUE,
          channels TEXT DEFAULT 'all',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `;
      
      db.run(createSQL, function(err) {
        if (err) {
          console.log('Create error:', err.message);
        } else {
          console.log('New table created successfully!');
        }
        
        // 4. Verify new schema
        db.all('PRAGMA table_info(online_day_off)', function(err, cols) {
          console.log('\nNew schema:');
          if (cols) {
            cols.forEach(c => {
              console.log('  -', c.name, c.type, c.notnull ? 'NOT NULL' : 'NULLABLE', c.dflt_value ? `DEFAULT ${c.dflt_value}` : '');
            });
          }
          
          // 5. Test insert
          db.run("INSERT INTO online_day_off (date, channels) VALUES ('2026-01-20', 'all')", function(err) {
            if (err) {
              console.log('\nTest insert FAILED:', err.message);
            } else {
              console.log('\nTest insert SUCCESS! ID:', this.lastID);
              
              // Clean up test data
              db.run("DELETE FROM online_day_off WHERE date = '2026-01-20'", function() {
                console.log('Test data cleaned up');
                console.log('\n✅ Table fix complete! Please restart the backend server.');
                db.close();
              });
            }
          });
        });
      });
    });
  });
});
