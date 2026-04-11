/**
 * 온라인/가상 주문 데이터 정확도 보정 (기존 SQLite)
 *
 * 1) order_type=ONLINE 인데 fulfillment_mode 가 비어 있으면 'online' 으로 채움
 *    → Sales 우측 패널에서 투고로 잘못 보이던 문제 완화
 * 2) (선택) 동일 firebase_order_id 로 중복 INSERT 된 orders 행: id가 작은 1건만 남기고 삭제
 *
 * ⚠️ 반드시 DB 파일 백업 후 실행. --execute 시 스크립트가 .bak 타임스탬프 복사본을 만듭니다.
 *
 * Usage:
 *   node scripts/fix-virtual-order-accuracy.js "C:\path\web2pos.db" --dry-run
 *   node scripts/fix-virtual-order-accuracy.js "C:\path\web2pos.db" --execute
 *   node scripts/fix-virtual-order-accuracy.js "C:\path\web2pos.db" --execute --dedupe-firebase
 */
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

function parseArgs(argv) {
  const out = {
    dbPath: null,
    dryRun: false,
    execute: false,
    dedupeFirebase: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--execute') out.execute = true;
    else if (a === '--dedupe-firebase') out.dedupeFirebase = true;
    else if (!a.startsWith('--')) out.dbPath = a;
  }
  return out;
}

const opts = parseArgs(process.argv.slice(2));

if (!opts.dbPath || !fs.existsSync(opts.dbPath)) {
  console.error(
    'Usage: node scripts/fix-virtual-order-accuracy.js "<web2pos.db>" --dry-run|--execute [--dedupe-firebase]'
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

async function deleteOrderCascade(db, ids) {
  if (!ids.length) return 0;
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
  return n;
}

async function main() {
  const db = new sqlite3.Database(opts.dbPath);

  const rowsToFix = await all(
    db,
    `SELECT id, order_number, order_type, fulfillment_mode, status, firebase_order_id, created_at
     FROM orders
     WHERE UPPER(TRIM(COALESCE(order_type, ''))) = 'ONLINE'
       AND (
         fulfillment_mode IS NULL
         OR TRIM(fulfillment_mode) = ''
       )
     ORDER BY id ASC`
  );

  const dupGroups = await all(
    db,
    `SELECT firebase_order_id, MIN(id) AS keep_id, COUNT(*) AS c
     FROM orders
     WHERE firebase_order_id IS NOT NULL AND TRIM(firebase_order_id) != ''
     GROUP BY firebase_order_id
     HAVING c > 1`
  );

  const dupIdsToRemove = [];
  for (const g of dupGroups) {
    const rows = await all(db, `SELECT id FROM orders WHERE firebase_order_id = ? ORDER BY id ASC`, [
      g.firebase_order_id,
    ]);
    const keep = Math.min(...rows.map((r) => r.id));
    for (const r of rows) {
      if (r.id !== keep) dupIdsToRemove.push(r.id);
    }
  }

  console.log('=== fix-virtual-order-accuracy ===');
  console.log('DB:', opts.dbPath);
  console.log('[1] ONLINE + 빈 fulfillment_mode 행 수:', rowsToFix.length);
  if (rowsToFix.length && rowsToFix.length <= 30) {
    rowsToFix.forEach((r) =>
      console.log(`    id=${r.id} #${r.order_number || ''} status=${r.status || ''} fb=${r.firebase_order_id || ''}`)
    );
  } else if (rowsToFix.length > 30) {
    console.log('    (샘플 10건만)');
    rowsToFix.slice(0, 10).forEach((r) =>
      console.log(`    id=${r.id} #${r.order_number || ''} status=${r.status || ''}`)
    );
  }

  console.log('[2] firebase_order_id 중복 그룹 수:', dupGroups.length);
  console.log('[2] 중복으로 삭제 대상 orders.id 수 (--dedupe-firebase 시):', dupIdsToRemove.length);
  if (dupIdsToRemove.length && dupIdsToRemove.length <= 40) {
    console.log('    ids:', dupIdsToRemove.join(', '));
  }

  if (opts.dryRun) {
    console.log('\n--dry-run: DB 변경 없음');
    if (!opts.dedupeFirebase && dupIdsToRemove.length) {
      console.log('(중복 삭제는 --execute --dedupe-firebase 가 있을 때만 수행)');
    }
    db.close();
    return;
  }

  const backupPath = `${opts.dbPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(opts.dbPath, backupPath);
  console.log('\n백업:', backupPath);

  await run(db, 'BEGIN IMMEDIATE');
  try {
    const nFix = await run(
      db,
      `UPDATE orders
       SET fulfillment_mode = 'online'
       WHERE UPPER(TRIM(COALESCE(order_type, ''))) = 'ONLINE'
         AND (fulfillment_mode IS NULL OR TRIM(fulfillment_mode) = '')`
    );
    console.log('적용: fulfillment_mode 보정 행 수:', nFix);

    if (opts.dedupeFirebase && dupIdsToRemove.length) {
      await deleteOrderCascade(db, dupIdsToRemove);
      console.log('적용: firebase 중복 orders 삭제(자식 포함) id 개수:', dupIdsToRemove.length);
    } else if (!opts.dedupeFirebase && dupIdsToRemove.length) {
      console.log('건너뜀: 중복 삭제 (--dedupe-firebase 없음)');
    }

    await run(db, 'COMMIT');
    console.log('\n완료. POS/백엔드 재시작 후 목록을 확인하세요.');
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
