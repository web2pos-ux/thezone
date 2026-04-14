const sqlite3 = require('sqlite3').verbose();
const p = process.argv[2];
const db = new sqlite3.Database(p, sqlite3.OPEN_READONLY);
const sql = `
SELECT id, order_number, status, ready_time,
       COALESCE(created_at, updated_at) AS ts
FROM orders
WHERE UPPER(COALESCE(order_type, '')) = 'TOGO'
  AND date(COALESCE(created_at, updated_at)) = date('now', 'localtime')
ORDER BY id DESC
`;
db.all(sql, [], (e, rows) => {
  if (e) {
    console.error(e);
    process.exit(1);
  }
  console.log('오늘(로컬) TOGO 건수:', rows.length);
  console.log(JSON.stringify(rows, null, 2));
  db.close();
});
