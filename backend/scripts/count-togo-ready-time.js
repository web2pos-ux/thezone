const sqlite3 = require('sqlite3').verbose();
const p = process.argv[2];
const db = new sqlite3.Database(p, sqlite3.OPEN_READONLY);
const q = (sql, params = []) =>
  new Promise((res, rej) => db.all(sql, params, (e, r) => (e ? rej(e) : res(r))));

(async () => {
  const total = await q(
    `SELECT COUNT(*) AS n FROM orders WHERE UPPER(COALESCE(order_type, '')) = 'TOGO'`
  );
  const noReady = await q(
    `SELECT COUNT(*) AS n FROM orders
     WHERE UPPER(COALESCE(order_type, '')) = 'TOGO'
       AND (ready_time IS NULL OR TRIM(COALESCE(ready_time, '')) = '')`
  );
  const withReady = await q(
    `SELECT COUNT(*) AS n FROM orders
     WHERE UPPER(COALESCE(order_type, '')) = 'TOGO'
       AND ready_time IS NOT NULL AND TRIM(COALESCE(ready_time, '')) != ''`
  );
  console.log(JSON.stringify({ togoTotal: total[0].n, noReadyTime: noReady[0].n, withReadyTime: withReady[0].n }, null, 2));
  const sample = await q(
    `SELECT id, order_number, status, ready_time, pickup_minutes,
            substr(COALESCE(created_at,''),1,19) AS created
     FROM orders
     WHERE UPPER(COALESCE(order_type, '')) = 'TOGO'
       AND (ready_time IS NULL OR TRIM(COALESCE(ready_time, '')) = '')
     ORDER BY id DESC LIMIT 15`
  );
  console.log('샘플(ready_time 없음, 최대 15건):');
  console.log(JSON.stringify(sample, null, 2));
  db.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
