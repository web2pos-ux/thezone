/**
 * Usage: node scripts/list-online-togo-orders.js "C:\Users\User\Thezone\Menus\Sushiharbour\web2pos.db"
 * Lists ONLINE / TOGO-like orders with 오늘 vs 이전 bucket.
 */
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = process.argv[2] || path.join(__dirname, '..', '..', 'web2pos.db');
if (!fs.existsSync(dbPath)) {
  console.error('DB_NOT_FOUND:', dbPath);
  process.exit(1);
}

const sql = `
SELECT
  CASE WHEN date(COALESCE(created_at, updated_at)) = date('now', 'localtime')
    THEN '오늘' ELSE '이전' END AS bucket,
  id,
  order_number,
  order_type,
  channel,
  status,
  total,
  COALESCE(created_at, updated_at) AS ts
FROM orders
WHERE UPPER(COALESCE(order_type, '')) = 'ONLINE'
   OR UPPER(COALESCE(order_type, '')) IN ('TOGO', 'PICKUP', 'TAKEOUT')
ORDER BY datetime(COALESCE(created_at, updated_at)) DESC
`;

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
db.all(sql, [], (err, rows) => {
  if (err) {
    console.error(err.message);
    process.exit(1);
  }
  if (!rows.length) {
    console.log('(조건에 맞는 행 없음)');
    db.close();
    return;
  }
  console.log('| 구분 | id | order_number | order_type | channel | status | total | 시각 |');
  console.log('|------|-----|--------------|------------|---------|--------|-------|------|');
  for (const r of rows) {
    const ch = r.channel != null ? String(r.channel) : '';
    console.log(
      `| ${r.bucket} | ${r.id} | ${r.order_number || ''} | ${r.order_type || ''} | ${ch} | ${r.status || ''} | ${r.total} | ${r.ts || ''} |`
    );
  }
  console.log('\n총', rows.length, '건');
  db.close();
});
