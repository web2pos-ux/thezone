/**
 * Firebase 동기화 큐는 SQLite 테이블로 관리한다.
 * 각 행은 작업 유형(type), 상태(status), JSON 형태의 payload, 생성 시각, 재시도 정보 등을 포함한다.
 * payload에는 Firebase에 보낼 구체 데이터를 JSON으로 넣는다.
 *
 * 상세 — 테이블 `firebase_sync_queue` / `firebase_sync_dlq`
 * - id: 고유 번호 (AUTOINCREMENT) — 전역 삽입 순서(FIFO 보조)
 * - order_id: (선택) 관련 주문 ID — 동시성 버킷(한 주문 단위 FIFO)
 * - order_seq: 주문(order_id) 안에서 1부터 증가하는 시퀀스(같은 주문 내 처리 순서 표시)
 * - sequence_key: order_id+type 기준 보조 키(검색·호환)
 * - created_at: 넣은 시각
 * - deferral_reason: 즉시 Firebase 반영 실패 사유 — 'offline' | 'live_sync_failed' | NULL(구버전 행)
 */

let dbRef = null;

function init(db) {
  dbRef = db;
}

function buildSequenceKey(orderId, type) {
  const t = String(type || '').trim();
  if (orderId != null && orderId !== '' && Number.isFinite(Number(orderId))) {
    return `${Number(orderId)}:${t}`;
  }
  return `null:${t}`;
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    dbRef.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    dbRef.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    dbRef.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

/**
 * 주문 버킷 내 다음 order_seq (pending/processing 포함 행 기준으로 MAX+1).
 * @param {number|null|undefined} orderId
 */
async function getNextOrderSeqForOrderId(orderId) {
  if (!dbRef) throw new Error('firebaseSyncQueue not initialized');
  if (orderId != null && orderId !== '' && Number.isFinite(Number(orderId))) {
    const oid = Number(orderId);
    const r = await dbGet(
      `SELECT COALESCE(MAX(order_seq), 0) + 1 AS n FROM firebase_sync_queue WHERE order_id = ?`,
      [oid],
    );
    return r && r.n != null ? Number(r.n) : 1;
  }
  const r = await dbGet(
    `SELECT COALESCE(MAX(order_seq), 0) + 1 AS n FROM firebase_sync_queue WHERE order_id IS NULL`,
  );
  return r && r.n != null ? Number(r.n) : 1;
}

/**
 * @param {{ type: string, payload: object, order_id?: number|null, deferral_reason?: string|null }} job
 */
async function enqueue(job) {
  if (!dbRef) throw new Error('firebaseSyncQueue not initialized');
  const type = String(job.type || '').trim();
  const payload = JSON.stringify(job.payload != null ? job.payload : {});
  const orderId = job.order_id != null && job.order_id !== '' ? Number(job.order_id) : null;
  const sequenceKey = buildSequenceKey(orderId, type);
  const orderSeq = await getNextOrderSeqForOrderId(orderId);
  const deferralReason =
    job.deferral_reason != null && String(job.deferral_reason).trim() !== ''
      ? String(job.deferral_reason).trim()
      : null;
  const r = await dbRun(
    `INSERT INTO firebase_sync_queue (type, payload, order_id, status, retry_count, sequence_key, created_at, order_seq, deferral_reason)
     VALUES (?, ?, ?, 'pending', 0, ?, datetime('now'), ?, ?)`,
    [type, payload, orderId, sequenceKey, orderSeq, deferralReason],
  );
  return { id: r.lastID, order_seq: orderSeq };
}

async function getCounts() {
  if (!dbRef) return { pending: 0, processing: 0, dlq: 0, totalActive: 0 };
  try {
    const pend = await dbGet(`SELECT COUNT(*) AS c FROM firebase_sync_queue WHERE status = 'pending'`);
    const proc = await dbGet(`SELECT COUNT(*) AS c FROM firebase_sync_queue WHERE status = 'processing'`);
    const d = await dbGet(`SELECT COUNT(*) AS c FROM firebase_sync_dlq`);
    const p = pend?.c || 0;
    const pr = proc?.c || 0;
    return {
      pending: p,
      processing: pr,
      dlq: d?.c || 0,
      totalActive: p + pr,
    };
  } catch {
    return { pending: 0, processing: 0, dlq: 0, totalActive: 0 };
  }
}

module.exports = {
  init,
  enqueue,
  getCounts,
  getNextOrderSeqForOrderId,
  buildSequenceKey,
  dbRun,
  dbGet,
  dbAll,
};
