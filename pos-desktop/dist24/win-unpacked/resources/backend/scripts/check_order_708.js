const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, '..', '..', 'db', 'web2pos.db'));

db.all('SELECT id, order_number, table_id, total, status, order_source FROM orders WHERE id = 708 OR table_id = "T1" ORDER BY id DESC LIMIT 5', (err, rows) => {
  console.log('=== Orders for T1 ===');
  console.table(rows);
  
  db.all('SELECT id, name, quantity, price, item_source FROM order_items WHERE order_id = 708', (err2, items) => {
    console.log('\n=== Items in order #708 ===');
    if (items && items.length > 0) {
      items.forEach(i => console.log(' -', i.name, 'x', i.quantity, '$' + i.price, '| source:', i.item_source));
    } else {
      console.log('No items found');
    }
    
    db.all('SELECT element_id, name, status, current_order_id FROM table_map_elements WHERE element_id = "T1" OR name = "T1"', (err3, tables) => {
      console.log('\n=== Table T1 in table_map_elements ===');
      console.table(tables);
      db.close();
    });
  });
});

















