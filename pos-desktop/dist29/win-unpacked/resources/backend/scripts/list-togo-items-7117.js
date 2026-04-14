const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(process.argv[2], sqlite3.OPEN_READONLY);
db.all(
  `SELECT o.id AS order_id, o.order_number, oi.id AS item_id, oi.name,
          oi.memo, substr(COALESCE(oi.memo_json,''),1,120) mj,
          substr(COALESCE(oi.modifiers_json,''),1,120) modj
   FROM orders o
   JOIN order_items oi ON oi.order_id = o.id
   WHERE UPPER(COALESCE(o.order_type,''))='TOGO'
     AND (
       COALESCE(oi.name,'') LIKE '%7117%'
       OR COALESCE(oi.memo,'') LIKE '%7117%'
       OR COALESCE(oi.memo_json,'') LIKE '%7117%'
       OR COALESCE(oi.modifiers_json,'') LIKE '%7117%'
     )`,
  [],
  (e, r) => {
    console.log(JSON.stringify(r, null, 2));
    db.close();
  }
);
