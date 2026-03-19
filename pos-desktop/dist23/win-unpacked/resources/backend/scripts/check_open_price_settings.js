const path = require('path');
const sqlite3 = require('sqlite3').verbose();

(async () => {
  const dbPath = path.resolve(__dirname, '..', 'web2pos.db');
  const db = new sqlite3.Database(dbPath);

  const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  try {
    console.log('Checking OpenPrice_Settings table structure...');
    
    // Check if table exists
    const tables = await dbAll("SELECT name FROM sqlite_master WHERE type='table' AND name='OpenPrice_Settings'");
    console.log('Tables found:', tables);
    
    if (tables.length > 0) {
      // Get table schema
      const schema = await dbAll("PRAGMA table_info(OpenPrice_Settings)");
      console.log('Table schema:', schema);
      
      // Check existing data
      const data = await dbAll("SELECT * FROM OpenPrice_Settings");
      console.log('Existing data:', data);
    } else {
      console.log('OpenPrice_Settings table does not exist!');
    }
    
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    db.close();
  }
})(); 