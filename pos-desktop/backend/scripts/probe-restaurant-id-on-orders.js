/**
 * orders 및 관련 테이블에 레스토랑/tenant 식별 컬럼이 있는지 조회
 */
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const dbPath = process.argv[2];
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('Usage: node scripts/probe-restaurant-id-on-orders.js <web2pos.db>');
  process.exit(1);
}

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
const q = (sql, p = []) =>
  new Promise((res, rej) => db.all(sql, p, (e, r) => (e ? rej(e) : res(r))));

(async () => {
  console.log('DB:', dbPath);
  const cols = await q('PRAGMA table_info(orders)');
  const names = cols.map((c) => c.name);
  const hit = names.filter((n) =>
    /restaurant|tenant|store|firebase|venue|branch|location/i.test(n)
  );
  console.log('\n[orders 컬럼] 레스토랑/지점 추정 이름:', hit.length ? hit.join(', ') : '(없음)');
  console.log('orders 전체 컬럼 수:', names.length);

  const admin = await q(
    "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%admin%' OR name LIKE '%setting%' OR name LIKE '%restaurant%')"
  ).catch(() => []);
  const tableList = await q(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  );
  const interesting = tableList
    .map((r) => r.name)
    .filter((n) =>
      /restaurant|tenant|store|firebase|setting|admin|sync|device/i.test(n)
    );
  console.log('\n[테이블명에 restaurant/setting 등 포함]', interesting.join(', ') || '(없음)');

  for (const t of ['admin_settings', 'orders']) {
    const exists = tableList.some((r) => r.name === t);
    if (!exists) continue;
    const ti = await q(`PRAGMA table_info(${t})`);
    const rcols = ti.map((c) => c.name).filter((n) => /restaurant|firebase|tenant|store/i.test(n));
    if (rcols.length) console.log(`\n[${t}] 관련 컬럼:`, rcols.join(', '));
  }

  const val = await q(
    "SELECT key, substr(value,1,80) v FROM admin_settings WHERE key LIKE '%restaurant%' OR key LIKE '%firebase%' LIMIT 20"
  ).catch(() => []);

  if (val.length) {
    console.log('\n[admin_settings 샘플]');
    console.table(val);
  }

  if (names.includes('firebase_restaurant_id')) {
    const dist = await q(
      `SELECT COALESCE(firebase_restaurant_id, '(null)') AS rid, COUNT(*) n
       FROM orders GROUP BY rid ORDER BY n DESC`
    );
    console.log('\n[orders.firebase_restaurant_id 값 분포]');
    console.table(dist);
  }

  db.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
