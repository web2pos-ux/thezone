const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(process.argv[2], sqlite3.OPEN_READONLY);
const cols = [
  'order_number',
  'customer_name',
  'customer_phone',
  'notes',
  'kitchen_note',
  'order_source',
  'external_order_number',
  'online_order_number',
  'server_name',
  'table_id',
];
const parts = cols.map(
  (c) => `COALESCE(CAST(${c} AS TEXT), '')`
);
const concat = parts.join(" || '|' || ");
db.all(
  `SELECT id, order_number, order_type, ${cols.join(', ')} FROM orders
   WHERE UPPER(COALESCE(order_type,''))='TOGO'
   AND (${concat}) LIKE '%7117%'`,
  [],
  (e, r) => {
    if (e) console.error(e);
    else console.log(JSON.stringify(r, null, 2));
    db.close();
  }
);
