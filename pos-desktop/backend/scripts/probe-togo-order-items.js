const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(process.argv[2], sqlite3.OPEN_READONLY);
const sql = `
SELECT o.id, o.order_number, o.order_source, o.customer_name,
       oi.id AS line_id, oi.name, oi.memo, oi.memo_json, oi.modifiers_json
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
WHERE UPPER(COALESCE(o.order_type,''))='TOGO'
  AND (
    oi.name LIKE '%7117%'
    OR COALESCE(oi.memo,'') LIKE '%7117%'
    OR COALESCE(oi.memo_json,'') LIKE '%7117%'
    OR COALESCE(oi.modifiers_json,'') LIKE '%7117%'
  )
LIMIT 50
`;
db.all(sql, [], (e, r) => {
  console.log('rows', r ? r.length : 0);
  console.log(JSON.stringify(r, null, 2));
  db.close();
});
