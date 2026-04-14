const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(process.argv[2], sqlite3.OPEN_READONLY);
db.all(
  `SELECT
     CASE
       WHEN CAST(created_at AS TEXT) LIKE '%T%' THEN 'has_T_isoish'
       ELSE 'no_T'
     END AS fmt,
     COUNT(*) n
   FROM orders
   WHERE UPPER(COALESCE(order_type,''))='TOGO'
   GROUP BY fmt`,
  [],
  (e, r) => {
    console.log(r);
    db.close();
  }
);
