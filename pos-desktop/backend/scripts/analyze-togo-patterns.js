const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const dbPath = process.argv[2];
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('Usage: node scripts/analyze-togo-patterns.js <web2pos.db>');
  process.exit(1);
}
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
const q = (sql, p = []) =>
  new Promise((res, rej) => db.all(sql, p, (e, r) => (e ? rej(e) : res(r))));

(async () => {
  const byStatus = await q(
    `SELECT COALESCE(status,'(null)') s, COUNT(*) c FROM orders WHERE UPPER(COALESCE(order_type,''))='TOGO' GROUP BY 1 ORDER BY c DESC`
  );
  const byPat = await q(`
    SELECT
      CASE
        WHEN order_number LIKE 'ORD-%' THEN 'ORD_*'
        WHEN order_number GLOB '[0-9]*' AND LENGTH(order_number) <= 6 THEN 'numeric_short'
        WHEN order_number GLOB '[0-9]*' THEN 'numeric_long'
        ELSE 'other'
      END AS pat,
      COUNT(*) c
    FROM orders WHERE UPPER(COALESCE(order_type,''))='TOGO'
    GROUP BY pat ORDER BY c DESC
  `);
  const firebase = await q(`
    SELECT
      CASE WHEN TRIM(COALESCE(firebase_order_id,'')) = '' THEN 'empty' ELSE 'set' END AS fb,
      COUNT(*) c
    FROM orders WHERE UPPER(COALESCE(order_type,''))='TOGO'
    GROUP BY fb
  `);
  const samples = await q(`
    SELECT id, order_number, status,
           substr(COALESCE(created_at,''),1,19) t,
           order_source,
           CASE WHEN TRIM(COALESCE(firebase_order_id,''))='' THEN '' ELSE 'yes' END has_fb
    FROM orders WHERE UPPER(COALESCE(order_type,''))='TOGO'
    ORDER BY id DESC LIMIT 40
  `);
  console.log(JSON.stringify({ byStatus, byPat, firebase, samples }, null, 2));
  db.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
