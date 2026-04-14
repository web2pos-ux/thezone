/**
 * TOGO 중 다음에 해당하는 주문만 삭제 (자식 행 포함):
 * - order_source 가 POS (매장 POS에서 만든 투고로 저장된 경우)
 * - customer_name 이 POS Order (대소문자 무시)
 * - 주문/라인 텍스트 어디에든 7117 포함 (라벨·메모·전화 등)
 *
 * Usage:
 *   node scripts/purge-togo-pos-order-and-7117.js "<web2pos.db>" --dry-run
 *   node scripts/purge-togo-pos-order-and-7117.js "<web2pos.db>" --execute
 */
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const dbPath = process.argv[2];
const mode = process.argv[3] || '--dry-run';

if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('Usage: node scripts/purge-togo-pos-order-and-7117.js "<web2pos.db>" --dry-run|--execute');
  process.exit(1);
}
if (mode !== '--dry-run' && mode !== '--execute') {
  console.error('Third arg: --dry-run or --execute');
  process.exit(1);
}

const DOOMED_SQL = `
SELECT id FROM orders o
WHERE UPPER(COALESCE(o.order_type, '')) = 'TOGO'
  AND (
    UPPER(TRIM(COALESCE(o.order_source, ''))) = 'POS'
    OR UPPER(TRIM(COALESCE(o.customer_name, ''))) = 'POS ORDER'
    OR COALESCE(o.order_number, '') LIKE '%7117%'
    OR COALESCE(o.customer_phone, '') LIKE '%7117%'
    OR COALESCE(o.notes, '') LIKE '%7117%'
    OR COALESCE(o.kitchen_note, '') LIKE '%7117%'
    OR COALESCE(o.order_source, '') LIKE '%7117%'
    OR COALESCE(o.external_order_number, '') LIKE '%7117%'
    OR COALESCE(o.online_order_number, '') LIKE '%7117%'
    OR COALESCE(o.adjustments_json, '') LIKE '%7117%'
    OR EXISTS (
      SELECT 1 FROM order_items oi
      WHERE oi.order_id = o.id
        AND (
          COALESCE(oi.name, '') LIKE '%7117%'
          OR COALESCE(oi.memo, '') LIKE '%7117%'
          OR COALESCE(oi.memo_json, '') LIKE '%7117%'
          OR COALESCE(oi.modifiers_json, '') LIKE '%7117%'
        )
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

  const idsRows = await all(db, DOOMED_SQL, []);
  const ids = idsRows.map((r) => r.id);

  let detail = [];
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    detail = await all(
      db,
      `SELECT o.id, o.order_number, o.order_source, o.customer_name, o.status,
              COALESCE(o.created_at, o.updated_at) AS ts
       FROM orders o
       WHERE o.id IN (${ph})`,
      ids
    );
  }

  console.log('삭제 대상 TOGO 건수:', ids.length);
  detail.forEach((r) => {
    console.log(
      `  id=${r.id} #${r.order_number} source=${r.order_source || ''} name=${r.customer_name || ''} ${r.status} ${r.ts}`
    );
  });

  if (mode === '--dry-run') {
    console.log('\n--dry-run: DB 변경 없음');
    db.close();
    return;
  }

  if (ids.length === 0) {
    console.log('삭제할 행 없음');
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
