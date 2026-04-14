const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(process.argv[2], sqlite3.OPEN_READONLY);
db.all(
  `SELECT id, order_number, order_source, customer_name, customer_phone
   FROM orders WHERE UPPER(COALESCE(order_type,''))='TOGO'
   AND (COALESCE(customer_phone,'') LIKE '%7117%' OR COALESCE(customer_name,'') LIKE '%POS%')`,
  [],
  (e, r) => {
    console.log(JSON.stringify(r, null, 2));
    db.close();
  }
);
