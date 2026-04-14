const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const p = process.argv[2];
const db = new sqlite3.Database(p, sqlite3.OPEN_READONLY);
const q = (sql) =>
  new Promise((res, rej) => db.all(sql, [], (e, r) => (e ? rej(e) : res(r))));

(async () => {
  const wh = "WHERE UPPER(COALESCE(order_type,''))='TOGO'";
  const cols = [
    'channel',
    'firebase_id',
    'server_id',
    'employee_id',
    'order_mode',
    'payment_status',
    'fulfillment_mode',
  ];
  for (const c of cols) {
    const rows = await q(
      `SELECT COALESCE(CAST(${c} AS TEXT), '(null)') v, COUNT(*) n FROM orders ${wh} GROUP BY v ORDER BY n DESC LIMIT 8`
    );
    console.log('\n==', c, '==');
    console.table(rows);
  }
  db.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
