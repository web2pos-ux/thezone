/**
 * 로컬 날짜 기준 하루 매출 요약 (orders + payments)
 * Usage: node scripts/sales-by-date.js <web2pos.db> YYYY-MM-DD
 */
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const dbPath = process.argv[2];
const day = process.argv[3] || '2026-04-09';
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('Usage: node scripts/sales-by-date.js <web2pos.db> YYYY-MM-DD');
  process.exit(1);
}

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
const q = (sql, p = []) =>
  new Promise((res, rej) => db.all(sql, p, (e, r) => (e ? rej(e) : res(r))));

(async () => {
  const d = day;

  const byCreated = await q(
    `SELECT COALESCE(order_type,'(null)') AS t, COUNT(*) cnt,
            ROUND(SUM(COALESCE(total,0)),2) sum_total,
            ROUND(SUM(COALESCE(subtotal,0)),2) sum_sub,
            ROUND(SUM(COALESCE(tax,0)),2) sum_tax
     FROM orders
     WHERE date(COALESCE(created_at, updated_at)) = date(?)
     GROUP BY UPPER(COALESCE(order_type,''))
     ORDER BY cnt DESC`,
    [d]
  );

  const createdTotal = await q(
    `SELECT COUNT(*) cnt, ROUND(SUM(COALESCE(total,0)),2) sum_total
     FROM orders WHERE date(COALESCE(created_at, updated_at)) = date(?)`,
    [d]
  );

  const paidLike = await q(
    `SELECT status, COUNT(*) cnt, ROUND(SUM(COALESCE(total,0)),2) sum_total
     FROM orders
     WHERE date(COALESCE(created_at, updated_at)) = date(?)
     GROUP BY COALESCE(status,'')
     ORDER BY cnt DESC`,
    [d]
  );

  let payments = [];
  try {
    payments = await q(
      `SELECT COUNT(*) cnt,
              ROUND(SUM(CASE WHEN UPPER(COALESCE(status,''))='APPROVED' OR status IS NULL THEN amount+COALESCE(tip,0) ELSE 0 END),2) approved_amt
       FROM payments
       WHERE date(created_at) = date(?)`,
      [d]
    );
  } catch (_) {
    payments = [{ note: 'payments.created_at 없거나 테이블 없음' }];
  }

  const closedSameDay = await q(
    `SELECT COUNT(*) cnt, ROUND(SUM(COALESCE(total,0)),2) sum_total
     FROM orders
     WHERE closed_at IS NOT NULL AND TRIM(COALESCE(closed_at,'')) != ''
       AND date(closed_at) = date(?)`,
    [d]
  );

  console.log(JSON.stringify({ date: d, ordersCreatedThatDay: createdTotal[0], byOrderType: byCreated, byStatusThatDay: paidLike, paymentsThatDay: payments[0] || payments, ordersClosedThatDay: closedSameDay[0] }, null, 2));
  db.close();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
