const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(process.argv[2], sqlite3.OPEN_READONLY);
const q = (sql, p = []) =>
  new Promise((res, rej) => db.all(sql, p, (e, r) => (e ? rej(e) : res(r))));

(async () => {
  const hasFr = await q('PRAGMA table_info(orders)');
  const names = hasFr.map((c) => c.name);
  console.log('firebase_restaurant_id on orders?', names.includes('firebase_restaurant_id'));

  const fi = await q(
    `SELECT COALESCE(NULLIF(TRIM(firebase_id), ''), '(empty)') AS v, COUNT(*) n
     FROM orders GROUP BY v ORDER BY n DESC LIMIT 25`
  );
  console.log('\n[orders.firebase_id 분포]');
  console.table(fi);

  const fo = await q(
    `SELECT CASE WHEN firebase_order_id IS NULL OR TRIM(firebase_order_id)='' THEN '(empty)' ELSE 'has_id' END AS v,
            COUNT(*) n FROM orders GROUP BY v`
  );
  console.log('\n[orders.firebase_order_id 유무]');
  console.table(fo);

  const adm = await q(
    `SELECT key, substr(value,1,120) AS v FROM admin_settings
     WHERE key LIKE '%restaurant%' OR key LIKE '%firebase%' OR key LIKE '%store%'
     ORDER BY key`
  ).catch(() => []);
  console.log('\n[admin_settings 관련 키]');
  console.table(adm);

  db.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
