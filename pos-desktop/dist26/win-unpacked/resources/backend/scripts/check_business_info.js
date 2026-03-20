const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, '..', '..', 'db', 'web2pos.db'));

// Find tables related to business/store/settings
db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
  console.log('=== All Tables ===');
  tables.forEach(t => console.log(' -', t.name));
  
  // Check for restaurant_settings or similar
  db.all("SELECT * FROM restaurant_settings LIMIT 1", (err, rows) => {
    if (!err && rows && rows.length > 0) {
      console.log('\n=== restaurant_settings ===');
      console.log(JSON.stringify(rows[0], null, 2));
    }
    
    // Check for business_info
    db.all("SELECT * FROM business_info LIMIT 1", (err2, rows2) => {
      if (!err2 && rows2 && rows2.length > 0) {
        console.log('\n=== business_info ===');
        console.log(JSON.stringify(rows2[0], null, 2));
      }
      
      // Check for store_info
      db.all("SELECT * FROM store_info LIMIT 1", (err3, rows3) => {
        if (!err3 && rows3 && rows3.length > 0) {
          console.log('\n=== store_info ===');
          console.log(JSON.stringify(rows3[0], null, 2));
        }
        db.close();
      });
    });
  });
});

















