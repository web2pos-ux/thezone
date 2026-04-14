/**
 * order_type 이 DELIVERY 또는 ONLINE 인 주문을 삭제 (자식 행 포함).
 *
 * Usage:
 *   node scripts/purge-delivery-and-online.js "C:\path\web2pos.db" --dry-run
 *   node scripts/purge-delivery-and-online.js "C:\path\web2pos.db" --execute
 */
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

function parseArgs(argv) {
  const out = { dbPath: null, dryRun: false, execute: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--execute') out.execute = true;
    else if (!a.startsWith('--')) out.dbPath = a;
  }
  return out;
}

const opts = parseArgs(process.argv.slice(2));

if (!opts.dbPath || !fs.existsSync(opts.dbPath)) {
  console.error(
    'Usage: node scripts/purge-delivery-and-online.js "<web2pos.db>" --dry-run|--execute'
  );
  process.exit(1);
}

if (opts.dryRun === opts.execute) {
  console.error('정확히 하나만: --dry-run 또는 --execute');
  process.exit(1);
}

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
  const db = new sqlite3.Database(opts.dbPath);

  const rows = await all(
    db,
    `SELECT id, order_number, order_type, status, created_at FROM orders
     WHERE UPPER(COALESCE(order_type, '')) IN ('DELIVERY', 'ONLINE')
     ORDER BY id`
  );
  const ids = rows.map((r) => r.id);

  console.log('대상 DELIVERY + ONLINE orders 행 수:', rows.length);
  if (rows.length && opts.dryRun) {
    console.log('\n[샘플 최대 30]');
    rows.slice(0, 30).forEach((r) => {
      console.log(
        `  id=${r.id} #${r.order_number} type=${r.order_type} ${r.status} ${r.created_at || ''}`
      );
    });
    console.log('\n--dry-run: DB 변경 없음');
    db.close();
    return;
  }

  if (ids.length === 0) {
    console.log('삭제할 주문 없음');
    db.close();
    return;
  }

  const backupPath = `${opts.dbPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(opts.dbPath, backupPath);
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

  await run(db, 'PRAGMA foreign_keys = ON');
  await run(db, 'BEGIN IMMEDIATE');
  try {
    await deleteFrom('order_items');
    await deleteFrom('payments');
    await deleteFrom('tips');
    await deleteFrom('order_adjustments');
    await deleteFrom('order_guest_status');
    await deleteFrom('delivery_orders');
    if (await tableExists(db, 'OpenPrice_Lines')) {
      try {
        await run(db, `DELETE FROM OpenPrice_Lines WHERE order_id IN (${placeholders})`, ids);
      } catch (_) {}
    }
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
