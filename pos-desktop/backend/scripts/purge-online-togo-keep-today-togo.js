/**
 * 오늘(로컬) 생성한 order_type=TOGO 주문만 남기고,
 * 나머지 ONLINE 및 TOGO/PICKUP/TAKEOUT 주문(및 관련 자식 행)을 삭제합니다.
 *
 * Usage:
 *   node scripts/purge-online-togo-keep-today-togo.js "C:\path\web2pos.db" --dry-run
 *   node scripts/purge-online-togo-keep-today-togo.js "C:\path\web2pos.db" --execute
 */
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = process.argv[2];
const mode = process.argv[3] || '--dry-run';

if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('Usage: node scripts/purge-online-togo-keep-today-togo.js "<web2pos.db>" --dry-run|--execute');
  process.exit(1);
}

if (mode !== '--dry-run' && mode !== '--execute') {
  console.error('Third arg must be --dry-run or --execute');
  process.exit(1);
}

/** 삭제 대상 order id (오늘 생성 TOGO 제외한 ONLINE / TOGO / PICKUP / TAKEOUT) */
const DOOMED_IDS_SQL = `
SELECT id FROM orders
WHERE UPPER(COALESCE(order_type, '')) = 'ONLINE'
   OR (
     UPPER(COALESCE(order_type, '')) IN ('TOGO', 'PICKUP', 'TAKEOUT')
     AND NOT (
       UPPER(COALESCE(order_type, '')) = 'TOGO'
       AND date(COALESCE(created_at, updated_at)) = date('now', 'localtime')
     )
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

  const doomed = await all(db, DOOMED_IDS_SQL, []);
  const ids = doomed.map((r) => r.id);
  console.log('삭제 대상 orders.id 개수:', ids.length);
  if (ids.length === 0) {
    db.close();
    return;
  }

  const sample = await all(
    db,
    `SELECT id, order_number, order_type, status,
            COALESCE(created_at, updated_at) AS ts
     FROM orders
     WHERE UPPER(COALESCE(order_type, '')) = 'ONLINE'
        OR (
          UPPER(COALESCE(order_type, '')) IN ('TOGO', 'PICKUP', 'TAKEOUT')
          AND NOT (
            UPPER(COALESCE(order_type, '')) = 'TOGO'
            AND date(COALESCE(created_at, updated_at)) = date('now', 'localtime')
          )
        )
     ORDER BY id DESC LIMIT 15`,
    []
  );
  console.log('\n(샘플 최대 15건)');
  for (const r of sample) {
    console.log(`  id=${r.id} #${r.order_number} type=${r.order_type} ${r.status} ${r.ts}`);
  }

  if (mode === '--dry-run') {
    const kept = await all(
      db,
      `SELECT id, order_number, order_type, COALESCE(created_at, updated_at) AS ts
       FROM orders
       WHERE UPPER(COALESCE(order_type, '')) = 'TOGO'
         AND date(COALESCE(created_at, updated_at)) = date('now', 'localtime')`,
      []
    );
    console.log('\n[유지] 오늘 TOGO:', kept.length, '건');
    kept.forEach((r) => console.log(`  id=${r.id} #${r.order_number} ${r.ts}`));
    console.log('\n--execute 가 없어 DB는 변경하지 않았습니다.');
    db.close();
    return;
  }

  const backupPath = `${dbPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(dbPath, backupPath);
  console.log('백업:', backupPath);

  const placeholders = ids.map(() => '?').join(',');

  await run(db, 'BEGIN IMMEDIATE');

  const deleteFrom = async (table, clause = `order_id IN (${placeholders})`) => {
    if (!(await tableExists(db, table))) return 0;
    try {
      return await run(db, `DELETE FROM ${table} WHERE ${clause}`, ids);
    } catch (e) {
      if (e.message && e.message.includes('no such column')) return 0;
      throw e;
    }
  };

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
      } catch (_) {
        /* 컬럼 없으면 무시 */
      }
    }

    const orderDel = await run(db, `DELETE FROM orders WHERE id IN (${placeholders})`, ids);

    await new Promise((resolve, reject) => {
      db.run('COMMIT', (e) => (e ? reject(e) : resolve()));
    });

    console.log('\n완료: orders 삭제 행 수', orderDel);
  } catch (err) {
    await new Promise((resolve) => {
      db.run('ROLLBACK', () => resolve());
    });
    console.error('ROLLBACK:', err.message);
    process.exitCode = 1;
  }

  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
