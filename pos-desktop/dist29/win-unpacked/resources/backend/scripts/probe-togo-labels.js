const sqlite3 = require('sqlite3').verbose();
const p = process.argv[2];
const db = new sqlite3.Database(p, sqlite3.OPEN_READONLY);
const q = (sql, params = []) =>
  new Promise((res, rej) => db.all(sql, params, (e, r) => (e ? rej(e) : res(r))));

(async () => {
  const togoWhere = "UPPER(COALESCE(order_type,''))='TOGO'";
  const cols = [
    "notes",
    "kitchen_note",
    "order_source",
    "order_number",
    "customer_name",
    "channel",
    "fulfillment_mode",
    "online_order_number",
  ];
  for (const c of cols) {
    const rows = await q(
      `SELECT COALESCE(CAST(${c} AS TEXT), '') AS v, COUNT(*) n FROM orders WHERE ${togoWhere} GROUP BY v ORDER BY n DESC LIMIT 15`
    );
    console.log('\n== TOGO', c, 'top ==');
    console.table(rows);
  }
  const pos7117 = await q(
    `SELECT id, order_number, notes, kitchen_note, order_source, customer_name, online_order_number
     FROM orders
     WHERE ${togoWhere}
     AND (
       UPPER(TRIM(COALESCE(customer_name,''))) = 'POS ORDER'
       OR UPPER(COALESCE(notes,'')) LIKE '%POS%ORDER%'
       OR UPPER(COALESCE(kitchen_note,'')) LIKE '%POS%ORDER%'
       OR UPPER(COALESCE(notes,'')) LIKE '%7117%'
       OR UPPER(COALESCE(kitchen_note,'')) LIKE '%7117%'
       OR UPPER(COALESCE(order_source,'')) LIKE '%7117%'
       OR UPPER(COALESCE(order_number,'')) LIKE '%7117%'
       OR UPPER(COALESCE(online_order_number,'')) LIKE '%7117%'
       OR UPPER(COALESCE(customer_name,'')) LIKE '%7117%'
     )`
  );
  console.log('\n== Heuristic POS Order / 7117 matches ==', pos7117.length);
  console.log(JSON.stringify(pos7117.slice(0, 30), null, 2));
  db.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
