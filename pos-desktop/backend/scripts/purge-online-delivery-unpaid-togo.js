/**
 * 삭제 대상 (orders.id 집합, 합집합):
 * 1) order_type = ONLINE (대소문자 무시)
 * 2) 딜리버리: order_type 이 배달 채널이거나 fulfillment_mode = DELIVERY
 * 3) 미결제 투고: order_type = TOGO 이고, 정산 완료/취소 상태가 아니며 paid_amount < total
 *
 * Usage:
 *   node scripts/purge-online-delivery-unpaid-togo.js "C:\\path\\web2pos_Origin.db" --dry-run
 *   node scripts/purge-online-delivery-unpaid-togo.js "C:\\path\\web2pos_Origin.db" --execute
 *
 * DB 손상 시: PRAGMA integrity_check 에서 idx_orders_type_status_created 관련 오류가 나오면
 *   DROP INDEX IF EXISTS idx_orders_type_status_created;
 * 후 --execute 를 다시 시도하세요. 그래도 남는 행이 있으면 SQLite CLI `.recover` 로 복구한 뒤
 * 이 스크립트를 재실행하는 것을 권장합니다.
 */
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const DELIVERY_TYPES = [
  'DELIVERY',
  'UBEREATS',
  'UBER',
  'DOORDASH',
  'SKIP',
  'SKIPTHEDISHES',
  'SKIP_THE_DISHES',
  'FANTUAN',
];

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
    'Usage: node scripts/purge-online-delivery-unpaid-togo.js "<db path>" --dry-run|--execute'
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

function deliveryTypeInList() {
  return DELIVERY_TYPES.map(() => '?').join(',');
}

async function collectTargetIds(db) {
  const dPlace = deliveryTypeInList();
  const online = await all(
    db,
    `SELECT id FROM orders WHERE UPPER(COALESCE(order_type, '')) = 'ONLINE'`,
    []
  );
  const delivery = await all(
    db,
    `SELECT id FROM orders WHERE
      UPPER(COALESCE(order_type, '')) IN (${dPlace})
      OR UPPER(COALESCE(fulfillment_mode, '')) = 'DELIVERY'`,
    [...DELIVERY_TYPES]
  );
  const unpaidTogo = await all(
    db,
    `SELECT id FROM orders
     WHERE UPPER(COALESCE(order_type, '')) = 'TOGO'
     AND COALESCE(UPPER(status), 'OPEN') NOT IN ('CLOSED', 'VOID', 'CANCELLED', 'CANCELED')
     AND COALESCE(paid_amount, 0) + 0.0001 < COALESCE(total, 0)`,
    []
  );
  const idSet = new Set();
  for (const r of online) idSet.add(r.id);
  for (const r of delivery) idSet.add(r.id);
  for (const r of unpaidTogo) idSet.add(r.id);
  return {
    ids: [...idSet],
    counts: {
      online: online.length,
      delivery: delivery.length,
      unpaidTogo: unpaidTogo.length,
      union: idSet.size,
    },
  };
}

async function main() {
  const db = new sqlite3.Database(opts.dbPath);
  const { ids, counts } = await collectTargetIds(db);

  console.log('대상 건수:', JSON.stringify(counts, null, 2));

  if (opts.dryRun) {
    if (ids.length) {
      const topIds = [...ids].sort((a, b) => b - a).slice(0, 15);
      const sample = await all(
        db,
        `SELECT id, order_number, order_type, status, total, paid_amount, fulfillment_mode
         FROM orders WHERE id IN (${topIds.map(() => '?').join(',')}) ORDER BY id DESC`,
        topIds
      );
      console.log('\n샘플(최대 15):');
      console.table(sample);
    }
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

  /** SQLite SQLITE_MAX_VARIABLE_NUMBER 기본값(999) 이하로 청크 삭제 */
  const CHUNK = 400;
  const chunks = [];
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));

  const purgeChunk = async (chunk) => {
    const placeholders = chunk.map(() => '?').join(',');
    const deleteFrom = async (table, clause = `order_id IN (${placeholders})`) => {
      if (!(await tableExists(db, table))) return 0;
      try {
        return await run(db, `DELETE FROM ${table} WHERE ${clause}`, chunk);
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
      await deleteFrom('OpenPrice_Lines');
      if (await tableExists(db, 'gift_card_transactions')) {
        await deleteFrom('gift_card_transactions');
      }
      if (await tableExists(db, 'refund_items') && (await tableExists(db, 'refunds'))) {
        await run(
          db,
          `DELETE FROM refund_items WHERE refund_id IN (SELECT id FROM refunds WHERE order_id IN (${placeholders}))`,
          chunk
        );
      }
      await deleteFrom('refunds');
      if (await tableExists(db, 'voids')) {
        await run(
          db,
          `DELETE FROM void_lines WHERE void_id IN (SELECT id FROM voids WHERE order_id IN (${placeholders}))`,
          chunk
        );
        await run(db, `DELETE FROM voids WHERE order_id IN (${placeholders})`, chunk);
      }
      if (await tableExists(db, 'table_map_elements')) {
        try {
          await run(
            db,
            `UPDATE table_map_elements SET current_order_id = NULL WHERE current_order_id IN (${placeholders})`,
            chunk
          );
        } catch (_) {}
      }
      const n = await run(db, `DELETE FROM orders WHERE id IN (${placeholders})`, chunk);
      await run(db, 'COMMIT');
      return n;
    } catch (err) {
      await new Promise((r) => db.run('ROLLBACK', () => r()));
      throw err;
    }
  };

  try {
    let total = 0;
    for (let c = 0; c < chunks.length; c++) {
      const n = await purgeChunk(chunks[c]);
      total += n;
      console.log(`청크 ${c + 1}/${chunks.length}: orders 삭제 ${n}`);
    }
    console.log('완료: orders 삭제 합계', total);
  } catch (err) {
    console.error('ROLLBACK:', err.message);
    process.exitCode = 1;
  }
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
