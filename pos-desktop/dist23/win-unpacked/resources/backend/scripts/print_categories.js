const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const menuId = parseInt(process.argv[2] || '200001', 10);
const dbPath = path.resolve(__dirname, '..', 'db', 'web2pos.db');
const db = new sqlite3.Database(dbPath);

db.all('SELECT category_id, name, menu_id, sort_order FROM menu_categories WHERE menu_id = ? ORDER BY sort_order', [menuId], (err, rows) => {
  if (err) {
    console.error('Error:', err.message);
  } else {
    console.log(JSON.stringify(rows, null, 2));
  }
  db.close();
}); 