/**
 * 마이그레이션: orders 테이블의 created_at, closed_at을
 * ISO(UTC) 형식에서 로컬 형식(YYYY-MM-DD HH:mm:ss)으로 변환
 *
 * 실행: node backend/scripts/migrate-orders-datetime-to-local.js
 * 또는: DB_PATH=/path/to/db node backend/scripts/migrate-orders-datetime-to-local.js
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'db', 'web2pos.db');

if (!fs.existsSync(dbPath)) {
  console.error('❌ Database not found:', dbPath);
  process.exit(1);
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Error opening database:', err);
    process.exit(1);
  }
  console.log('📂 Connected to:', dbPath);
});

const dbAll = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

/** ISO 또는 기타 형식 → 로컬 YYYY-MM-DD HH:mm:ss */
function toLocalDatetimeString(val) {
  if (!val || typeof val !== 'string') return null;
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 이미 로컬 형식(YYYY-MM-DD HH:mm:ss)인지 확인 */
function isAlreadyLocalFormat(val) {
  if (!val || typeof val !== 'string') return false;
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(val.trim());
}

async function migrate() {
  try {
    console.log('\n🔄 Migrating orders created_at, closed_at to local datetime format...\n');

    const orders = await dbAll('SELECT id, created_at, closed_at FROM orders');
    let updatedCreated = 0;
    let updatedClosed = 0;
    let skipped = 0;

    for (const row of orders) {
      let needUpdate = false;
      let newCreated = row.created_at;
      let newClosed = row.closed_at;

      if (row.created_at && !isAlreadyLocalFormat(row.created_at)) {
        const converted = toLocalDatetimeString(row.created_at);
        if (converted) {
          newCreated = converted;
          needUpdate = true;
          updatedCreated++;
        }
      }

      if (row.closed_at && !isAlreadyLocalFormat(row.closed_at)) {
        const converted = toLocalDatetimeString(row.closed_at);
        if (converted) {
          newClosed = converted;
          needUpdate = true;
          updatedClosed++;
        }
      }

      if (needUpdate) {
        await dbRun('UPDATE orders SET created_at = ?, closed_at = ? WHERE id = ?', [
          newCreated,
          newClosed,
          row.id,
        ]);
      } else if (row.created_at || row.closed_at) {
        skipped++;
      }
    }

    console.log(`✅ Migration complete.`);
    console.log(`   - created_at converted: ${updatedCreated}`);
    console.log(`   - closed_at converted:  ${updatedClosed}`);
    console.log(`   - already local/skipped: ${skipped}`);
    console.log(`   - total orders: ${orders.length}\n`);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    db.close((err) => {
      if (err) console.error('Error closing DB:', err);
      else console.log('Database connection closed.');
    });
  }
}

migrate();
