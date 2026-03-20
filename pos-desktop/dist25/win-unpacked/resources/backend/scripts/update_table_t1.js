const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, '..', '..', 'db', 'web2pos.db'));

db.run('UPDATE table_map_elements SET status = ?, current_order_id = ? WHERE name = ?', 
  ['Occupied', 708, 'T1'], 
  function(err) {
    if (err) {
      console.log('Error:', err.message);
    } else {
      console.log('Updated', this.changes, 'row(s)');
    }
    db.close();
  }
);

