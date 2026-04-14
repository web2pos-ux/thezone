const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(process.argv[2], sqlite3.OPEN_READONLY);
const limit = parseInt(process.argv[3] || '15', 10);
const q = (sql, p = []) =>
  new Promise((res, rej) => db.all(sql, p, (e, r) => (e ? rej(e) : res(r))));

(async () => {
  const recent = await q(
    `SELECT id, order_number, order_type, status, total,
            COALESCE(created_at, updated_at) AS ts,
            ready_time
     FROM orders
     ORDER BY datetime(COALESCE(created_at, updated_at)) DESC
     LIMIT ?`,
    [limit]
  );
  const statusByType = await q(
    `SELECT order_type, status, COUNT(*) n
     FROM orders
     GROUP BY UPPER(COALESCE(order_type,'')), UPPER(COALESCE(status,''))
     ORDER BY order_type, n DESC`
  );
  console.log('=== 최근 주문', limit, '건 (전체 유형) ===');
  console.log(JSON.stringify(recent, null, 2));
  console.log('\n=== 유형·상태별 건수 ===');
  console.table(statusByType);
  db.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
