const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(process.argv[2], sqlite3.OPEN_READONLY);
db.all(
  `SELECT id, order_number, order_mode, status, created_at FROM orders
   WHERE UPPER(COALESCE(order_type,''))='TOGO' AND UPPER(TRIM(COALESCE(order_mode,'')))='FSR'`,
  [],
  (e, r) => {
    console.log(JSON.stringify(r, null, 2));
    db.close();
  }
);
