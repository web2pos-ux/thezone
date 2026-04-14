const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(process.argv[2], sqlite3.OPEN_READONLY);
const day = process.argv[3] || '2026-04-09';
const where = `UPPER(COALESCE(order_type, '')) = 'TOGO'
     AND date(COALESCE(created_at, updated_at)) = date(?)`;
db.get(`SELECT COUNT(*) AS row_count FROM orders WHERE ${where}`, [day], (e, r1) => {
  if (e) throw e;
  db.get(
    `SELECT COUNT(*) AS order_count FROM (SELECT id FROM orders WHERE ${where} GROUP BY id)`,
    [day],
    (e2, r2) => {
      if (e2) throw e2;
      console.log('날짜:', day);
      console.log('orders 행 수(TOGO, 해당일):', r1.row_count);
      console.log('고유 주문 수(GROUP BY id):', r2.order_count);
      db.all(
        `SELECT id, order_number, status, ready_time,
                MIN(COALESCE(created_at, updated_at)) AS ts
         FROM orders
         WHERE ${where}
         GROUP BY id
         ORDER BY id`,
        [day],
        (e3, rows) => {
          if (e3) throw e3;
          console.log(JSON.stringify(rows, null, 2));
          db.close();
        }
      );
    }
  );
});
