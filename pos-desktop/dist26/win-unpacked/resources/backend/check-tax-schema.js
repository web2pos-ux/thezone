const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '..', 'db', 'web2pos.db');
const db = new sqlite3.Database(dbPath);

console.log('=== taxes table schema ===');
db.all("PRAGMA table_info(taxes)", [], (err, rows) => {
  console.log(rows?.map(r => `${r.name} (${r.type})`) || []);
  
  console.log('\n=== tax_groups table schema ===');
  db.all("PRAGMA table_info(tax_groups)", [], (err, rows) => {
    console.log(rows?.map(r => `${r.name} (${r.type})`) || []);
    
    console.log('\n=== tax_group_links table schema ===');
    db.all("PRAGMA table_info(tax_group_links)", [], (err, rows) => {
      console.log(rows?.map(r => `${r.name} (${r.type})`) || []);
      
      console.log('\n=== menu_tax_links table schema ===');
      db.all("PRAGMA table_info(menu_tax_links)", [], (err, rows) => {
        console.log(rows?.map(r => `${r.name} (${r.type})`) || []);
        db.close();
      });
    });
  });
});








