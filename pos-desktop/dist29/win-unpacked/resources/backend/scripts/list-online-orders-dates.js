const sqlite3 = require('sqlite3').verbose();
const p = process.argv[2];
const db = new sqlite3.Database(p, sqlite3.OPEN_READONLY);
const q = (sql, params = []) =>
  new Promise((res, rej) => db.all(sql, params, (e, r) => (e ? rej(e) : res(r))));

(async () => {
  const total = await q(
    `SELECT COUNT(*) n FROM orders WHERE UPPER(COALESCE(order_type,''))='ONLINE'`
  );
  const byDay = await q(
    `SELECT date(COALESCE(created_at, updated_at)) AS d, COUNT(*) cnt,
            MIN(COALESCE(created_at, updated_at)) AS first_ts,
            MAX(COALESCE(created_at, updated_at)) AS last_ts
     FROM orders WHERE UPPER(COALESCE(order_type,''))='ONLINE'
     GROUP BY date(COALESCE(created_at, updated_at))
     ORDER BY d DESC
     LIMIT 40`
  );
  const apr9 = await q(
    `SELECT id, order_number, status, total,
            COALESCE(created_at, updated_at) AS ts,
            firebase_order_id
     FROM orders
     WHERE UPPER(COALESCE(order_type,''))='ONLINE'
       AND date(COALESCE(created_at, updated_at)) = '2026-04-09'
     ORDER BY datetime(COALESCE(created_at, updated_at))`
  );
  console.log(JSON.stringify({ onlineTotal: total[0].n, byDay, on2026_04_09: apr9 }, null, 2));
  db.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
