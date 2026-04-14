const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(process.argv[2], sqlite3.OPEN_READONLY);
const num = process.argv[3] || '044';
db.all(
  `SELECT id, order_number, order_type, status, ready_time,
          COALESCE(created_at, updated_at) AS ts
   FROM orders
   WHERE UPPER(COALESCE(order_type, '')) = 'TOGO'
     AND TRIM(COALESCE(order_number, '')) = ?`,
  [num],
  (e, r) => {
    console.log(JSON.stringify(r, null, 2));
    db.close();
  }
);
