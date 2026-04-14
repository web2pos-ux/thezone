const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const dbPath = process.argv[2];
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('Usage: node scripts/verify-orders-by-type.js <web2pos.db>');
  process.exit(1);
}
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
const q = (sql, params = []) =>
  new Promise((res, rej) => db.all(sql, params, (e, r) => (e ? rej(e) : res(r))));

(async () => {
  const byType = await q(
    `SELECT COALESCE(order_type, '(null)') AS t, COUNT(*) AS c
     FROM orders GROUP BY UPPER(COALESCE(order_type, '')) ORDER BY c DESC`
  );
  const online = await q(
    `SELECT COUNT(*) AS n FROM orders WHERE UPPER(COALESCE(order_type, '')) = 'ONLINE'`
  );
  const togo = await q(
    `SELECT COUNT(*) AS n FROM orders WHERE UPPER(COALESCE(order_type, '')) = 'TOGO'`
  );
  const pickup = await q(
    `SELECT COUNT(*) AS n FROM orders WHERE UPPER(COALESCE(order_type, '')) IN ('PICKUP','TAKEOUT')`
  );
  const withTable = await q(
    `SELECT COUNT(*) AS n FROM orders WHERE table_id IS NOT NULL AND TRIM(COALESCE(table_id,'')) != ''`
  );

  console.log(JSON.stringify({ byType, online: online[0].n, togo: togo[0].n, pickupTakeout: pickup[0].n, ordersWithTableId: withTable[0].n }, null, 2));
  db.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
