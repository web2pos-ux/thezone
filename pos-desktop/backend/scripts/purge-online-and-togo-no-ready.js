/**
 * 삭제 대상 orders.id:
 * - order_type = ONLINE (전부)
 * - order_type = TOGO 이고 ready_time 이 NULL 이거나 빈 문자열인 것
 *
 * Usage:
 *   node scripts/purge-online-and-togo-no-ready.js "<web2pos.db>" --dry-run
 *   node scripts/purge-online-and-togo-no-ready.js "<web2pos.db>" --execute
 */
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const dbPath = process.argv[2];
const mode = process.argv[3] || '--dry-run';

if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('Usage: node scripts/purge-online-and-togo-no-ready.js "<web2pos.db>" --dry-run|--execute');
  process.exit(1);
}
if (mode !== '--dry-run' && mode !== '--execute') {
  console.error('Third arg: --dry-run or --execute');
  process.exit(1);
}

const DOOMED_SQL = `
SELECT id FROM orders
WHERE UPPER(COALESCE(order_type, '')) = 'ONLINE'
   OR (
     UPPER(COALESCE(order_type, '')) = 'TOGO'
     AND (ready_time IS NULL OR TRIM(COALESCE(ready_time, '')) = '')
   )
`;

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this.changes);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

async function tableExists(db, name) {
  const row = await new Promise((resolve, reject) => {
    db.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
      [name],
      (err, r) => (err ? reject(err) : resolve(r))
    );
  });
  return !!row;
}

async function main() {
  const db = new sqlite3.Database(dbPath);

  const onlineN = await all(
    db,
    `SELECT COUNT(*) AS n FROM orders WHERE UPPER(COALESCE(order_type, '')) = 'ONLINE'`,
    []
  );
  const togoNoReadyN = await all(
    db,
    `SELECT COUNT(*) AS n FROM orders
     WHERE UPPER(COALESCE(order_type, '')) = 'TOGO'
       AND (ready_time IS NULL OR TRIM(COALESCE(ready_time, '')) = '')`,
    []
  );

  const idsRows = await all(db, DOOMED_SQL, []);
  const ids = idsRows.map((r) => r.id);

  console.log('ONLINE 건수:', onlineN[0].n);
  console.log('ready_time 없는 TOGO 건수:', togoNoReadyN[0].n);
  console.log('삭제 대상 orders (중복 제거) 합계:', ids.length);

  if (mode === '--dry-run') {
    console.log('\n--dry-run: DB 변경 없음');
    db.close();
    return;
  }

  if (ids.length === 0) {
    console.log('삭제할 주문 없음');
    db.close();
    return;
  }

  const backupPath = `${dbPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(dbPath, backupPath);
  console.log('백업:', backupPath);

  const placeholders = ids.map(() => '?').join(',');

  const deleteFrom = async (table, clause = `order_id IN (${placeholders})`) => {
    if (!(await tableExists(db, table))) return 0;
    try {
      return await run(db, `DELETE FROM ${table} WHERE ${clause}`, ids);
    } catch (e) {
      if (e.message && e.message.includes('no such column')) return 0;
      throw e;
    }
  };

  await run(db, 'BEGIN IMMEDIATE');
  try {
    await deleteFrom('order_items');
    await deleteFrom('payments');
    await deleteFrom('tips');
    await deleteFrom('order_adjustments');
    await deleteFrom('order_guest_status');
    await deleteFrom('delivery_orders');
    if (await tableExists(db, 'refund_items') && (await tableExists(db, 'refunds'))) {
      await run(
        db,
        `DELETE FROM refund_items WHERE refund_id IN (SELECT id FROM refunds WHERE order_id IN (${placeholders}))`,
        ids
      );
    }
    await deleteFrom('refunds');
    if (await tableExists(db, 'voids')) {
      await run(
        db,
        `DELETE FROM void_lines WHERE void_id IN (SELECT id FROM voids WHERE order_id IN (${placeholders}))`,
        ids
      );
      await run(db, `DELETE FROM voids WHERE order_id IN (${placeholders})`, ids);
    }
    if (await tableExists(db, 'table_map_elements')) {
      try {
        await run(
          db,
          `UPDATE table_map_elements SET current_order_id = NULL WHERE current_order_id IN (${placeholders})`,
          ids
        );
      } catch (_) {}
    }
    const n = await run(db, `DELETE FROM orders WHERE id IN (${placeholders})`, ids);
    await run(db, 'COMMIT');
    console.log('완료: orders 삭제', n);
  } catch (err) {
    await new Promise((r) => db.run('ROLLBACK', () => r()));
    console.error('ROLLBACK:', err.message);
    process.exitCode = 1;
  }
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
