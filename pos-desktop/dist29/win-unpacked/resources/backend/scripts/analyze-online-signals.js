const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(process.argv[2], sqlite3.OPEN_READONLY);
const q = (sql) =>
  new Promise((res, rej) => db.all(sql, [], (e, r) => (e ? rej(e) : res(r))));

(async () => {
  const wh = "WHERE UPPER(COALESCE(order_type,''))='ONLINE'";
  for (const c of ['order_mode', 'fulfillment_mode', 'channel']) {
    const rows = await q(
      `SELECT COALESCE(CAST(${c} AS TEXT), '(null)') v, COUNT(*) n FROM orders ${wh} GROUP BY v ORDER BY n DESC LIMIT 12`
    );
    console.log('\n== ONLINE', c, '==');
    console.table(rows);
  }
  db.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
