const path = require('path');
const sqlite3 = require('sqlite3').verbose();

function fmtLocalDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function main() {
  const dbPath = path.resolve(__dirname, '..', '..', 'db', 'web2pos.db');
  const db = new sqlite3.Database(dbPath);

  const get = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || {})));
    });
  const all = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });

  const localToday = fmtLocalDate(new Date());
  console.log('DB:', dbPath);
  console.log('localToday:', localToday);

  const paid = `UPPER(status) IN ('PAID','PICKED_UP','CLOSED','COMPLETED')`;

  const ordersUtc = await get(`SELECT COUNT(*) as c FROM orders WHERE ${paid} AND date(created_at)=?`, [localToday]);
  const ordersLocal = await get(`SELECT COUNT(*) as c FROM orders WHERE ${paid} AND date(created_at,'localtime')=?`, [localToday]);

  console.log('orders paid count');
  console.log(' - date(created_at)=', ordersUtc.c);
  console.log(" - date(created_at,'localtime')=", ordersLocal.c);

  try {
    const refundsUtc = await get(
      `SELECT COUNT(*) as c FROM refunds WHERE UPPER(COALESCE(status,'COMPLETED')) IN ('COMPLETED','APPROVED','SETTLED','PAID') AND date(created_at)=?`,
      [localToday]
    );
    const refundsLocal = await get(
      `SELECT COUNT(*) as c FROM refunds WHERE UPPER(COALESCE(status,'COMPLETED')) IN ('COMPLETED','APPROVED','SETTLED','PAID') AND date(created_at,'localtime')=?`,
      [localToday]
    );
    console.log('refunds count');
    console.log(' - date(created_at)=', refundsUtc.c);
    console.log(" - date(created_at,'localtime')=", refundsLocal.c);
  } catch (e) {
    console.log('refunds table query failed:', e.message);
  }

  try {
    const voidsUtc = await get(`SELECT COUNT(*) as c FROM voids WHERE date(created_at)=?`, [localToday]);
    const voidsLocal = await get(`SELECT COUNT(*) as c FROM voids WHERE date(created_at,'localtime')=?`, [localToday]);
    console.log('voids count');
    console.log(' - date(created_at)=', voidsUtc.c);
    console.log(" - date(created_at,'localtime')=", voidsLocal.c);
  } catch (e) {
    console.log('voids table query failed:', e.message);
  }

  const lastOrders = await all(
    `SELECT id, order_number, status, created_at,
            date(created_at) as d_utc,
            date(created_at,'localtime') as d_local,
            datetime(created_at) as dt_utc,
            datetime(created_at,'localtime') as dt_local
     FROM orders
     ORDER BY datetime(created_at) DESC
     LIMIT 10`
  );
  console.log('last10 orders:');
  console.log(JSON.stringify(lastOrders, null, 2));

  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

