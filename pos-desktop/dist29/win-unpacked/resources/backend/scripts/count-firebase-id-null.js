const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(process.argv[2], sqlite3.OPEN_READONLY);
db.get('SELECT COUNT(*) t FROM orders', [], (e, t) => {
  db.get(
    `SELECT SUM(CASE WHEN firebase_id IS NULL THEN 1 ELSE 0 END) nnull,
            SUM(CASE WHEN TRIM(COALESCE(firebase_id,''))!='' THEN 1 ELSE 0 END) nset FROM orders`,
    [],
    (e2, r) => {
      console.log({ total: t.t, firebase_id_null_or_empty: t.t - (r.nset || 0), firebase_id_nonempty: r.nset });
      db.close();
    }
  );
});
