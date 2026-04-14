const sqlite3 = require('./backend/node_modules/sqlite3');
const DB = 'C:/Users/user/Thezone/Menus/Sushiharbour/web2pos.db';
const db = new sqlite3.Database(DB, sqlite3.OPEN_READONLY, (err) => {
  if (err) { console.error('DB open error:', err.message); process.exit(1); }
});

// March 1 ~ March 31 inclusive (2026 — adjust year if needed)
const START = '2026-03-01';
const END = '2026-03-31T23:59:59.999Z';

db.all(
  `SELECT id, subtotal, tax, total, created_at
   FROM orders
   WHERE status = 'PAID'
     AND date(created_at) >= date(?)
     AND date(created_at) <= date(?)`,
  [START, '2026-03-31'],
  (e, orders) => {
    if (e) { console.error(e.message); db.close(); return; }

    let totalSub = 0, totalTax = 0, totalTotal = 0;
    let totalGST = 0, totalPST = 0;

    orders.forEach((o) => {
      totalSub += o.subtotal || 0;
      totalTax += o.tax || 0;
      totalTotal += o.total || 0;
      const gst = (o.subtotal || 0) * 0.05;
      const pst = Math.max(0, (o.tax || 0) - gst);
      totalGST += gst;
      totalPST += pst;
    });

    console.log('DB:', DB);
    console.log('Period: 2026-03-01 .. 2026-03-31 (PAID orders)');
    console.log('Orders:', orders.length);
    console.log('Subtotal (sum):', totalSub.toFixed(2));
    console.log('GST (5% of subtotal):', totalGST.toFixed(2));
    console.log('PST (tax - GST):', totalPST.toFixed(2));
    console.log('Tax (DB column sum):', totalTax.toFixed(2));
    console.log('Total (sum):', totalTotal.toFixed(2));
    console.log('Check GST+PST vs tax:', (totalGST + totalPST).toFixed(2), 'vs', totalTax.toFixed(2));

    db.close();
  }
);
