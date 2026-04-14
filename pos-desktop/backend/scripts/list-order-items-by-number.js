const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(process.argv[2], sqlite3.OPEN_READONLY);
const num = process.argv[3] || '044';
const type = (process.argv[4] || 'TOGO').toUpperCase();

const q = (sql, p = []) =>
  new Promise((res, rej) => db.all(sql, p, (e, r) => (e ? rej(e) : res(r))));

(async () => {
  const orders = await q(
    `SELECT id, order_number, order_type, status, total, subtotal, tax,
            COALESCE(created_at, updated_at) AS ts, ready_time
     FROM orders
     WHERE TRIM(COALESCE(order_number, '')) = ?
       AND UPPER(COALESCE(order_type, '')) = ?`,
    [num, type]
  );
  console.log('=== 주문 헤더 ===');
  console.log(JSON.stringify(orders, null, 2));
  if (!orders.length) {
    db.close();
    return;
  }
  const oid = orders[0].id;
  const items = await q(
    `SELECT id, order_id, item_id, name, quantity, price, guest_number,
            memo, memo_json, modifiers_json, tax, is_voided
     FROM order_items
     WHERE order_id = ?
     ORDER BY id ASC`,
    [oid]
  );
  console.log('\n=== 주문 아이템 (order_id=' + oid + ') ===');
  console.log(JSON.stringify(items, null, 2));
  db.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
