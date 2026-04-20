/**
 * 오프라인 시 Firebase 동기화 큐 적재, 온라인 시 실행 + 재시도/DLQ (5회).
 * 큐 재시도: 초기 5초, 2배 증가, 최대 150초.
 * 동시성: 주문(order_id) 버킷 단위 FIFO — 글로벌로 가장 먼저 대기 중인 헤드 주문을 고른 뒤,
 * 그 주문의 작업을 순서대로 처리(드레인)하고, 끝나면 다음 주문 헤드로 넘어간다.
 * DLQ: 15분 후 자동 재시도 시작, 실패 시 분 단위 2배(최대 150분), 자동 5회 실패 시 마감 시 수동만.
 */

const firebaseService = require('./firebaseService');
const salesSyncService = require('./salesSyncService');
const firebaseSyncQueue = require('./firebaseSyncQueueService');
const networkConnectivity = require('./networkConnectivityService');
const {
  DEFERRAL_REASON_OFFLINE,
  DEFERRAL_REASON_LIVE_SYNC_FAILED,
  mergeQueuedSyncProvenanceFields,
} = require('./firebaseConflictPolicy');

const MAX_RETRY = 5;
const QUEUE_BACKOFF_INITIAL_SEC = 5;
const QUEUE_BACKOFF_MAX_SEC = 150;
const DLQ_AUTO_FIRST_DELAY_MIN = 15;
const DLQ_AUTO_MAX_DELAY_MIN = 150;
const MAX_DLQ_AUTO_ATTEMPTS = 5;

let processLock = false;

/** UI용: `processPendingJobs`가 지금 돌고 있는지(짧은 구간일 수 있음). */
function isQueueWorkerActive() {
  return processLock === true;
}

function parsePayload(row) {
  try {
    return JSON.parse(row.payload || '{}');
  } catch {
    return {};
  }
}

/** Firebase/HTTP가 아닌 일시적 네트워크 문제로 보일 때 — 재시도 카운트(5번 정책)에 포함하지 않음 */
function isLikelyNetworkOrOfflineError(e) {
  if (!e) return false;
  const code = String(e.code || e.errno || '');
  const msg = `${e.message || ''} ${e.name || ''}`.toLowerCase();
  if (/^(econnrefused|etimedout|econnreset|enetunreach|enotfound|eai_again|aborted)$/i.test(code)) return true;
  if (/networkerror/i.test(String(e.name || ''))) return true;
  if (
    msg.includes('network') ||
    msg.includes('fetch') ||
    msg.includes('timeout') ||
    msg.includes('offline') ||
    msg.includes('getaddrinfo') ||
    msg.includes('socket') ||
    msg.includes('econnrefused')
  ) {
    return true;
  }
  return false;
}

/** 오프라인/네트워크 스킵: retry_count·백오프 단계 유지, 짧은 뒤 재시도만 예약 */
async function revertQueueRowPendingNetworkSkip(rowId, lastError) {
  const err = lastError && String(lastError).length ? String(lastError) : 'offline_or_network';
  await firebaseSyncQueue.dbRun(
    `UPDATE firebase_sync_queue SET status = 'pending', last_error = ?, updated_at = datetime('now'),
     next_retry_at = datetime('now', '+5 seconds') WHERE id = ?`,
    [err.slice(0, 2000), rowId],
  );
}

/** 전역적으로 “준비된 헤드” 중 id가 가장 작은 행(어느 주문을 먼저 처리할지). */
async function pickGlobalSmallestReadyHeadRow() {
  return firebaseSyncQueue.dbGet(
    `SELECT q.* FROM firebase_sync_queue q
     WHERE q.status = 'pending'
     AND (q.next_retry_at IS NULL OR q.next_retry_at <= datetime('now'))
     AND q.id = (
       SELECT MIN(q3.id) FROM firebase_sync_queue q3
       WHERE q3.status = 'pending'
       AND (q3.order_id = q.order_id OR (q3.order_id IS NULL AND q.order_id IS NULL))
     )
     ORDER BY q.id ASC LIMIT 1`,
  );
}

/** 한 주문 버킷에서 다음으로 처리할 준비된 헤드(해당 주문 내 MIN(id), strict FIFO). */
async function pickReadyHeadForOrderBucket(orderId) {
  if (orderId == null) {
    return firebaseSyncQueue.dbGet(
      `SELECT q.* FROM firebase_sync_queue q
       WHERE q.status = 'pending'
       AND (q.next_retry_at IS NULL OR q.next_retry_at <= datetime('now'))
       AND q.order_id IS NULL
       AND q.id = (
         SELECT MIN(q3.id) FROM firebase_sync_queue q3
         WHERE q3.status = 'pending' AND q3.order_id IS NULL
       )
       LIMIT 1`,
    );
  }
  return firebaseSyncQueue.dbGet(
    `SELECT q.* FROM firebase_sync_queue q
     WHERE q.status = 'pending'
     AND (q.next_retry_at IS NULL OR q.next_retry_at <= datetime('now'))
     AND q.order_id = ?
     AND q.id = (
       SELECT MIN(q3.id) FROM firebase_sync_queue q3
       WHERE q3.status = 'pending' AND q3.order_id = ?
     )
     LIMIT 1`,
    [orderId, orderId],
  );
}

/** @param {number} nextRetryCount 재시도 누적(다음 시도 직전 값, 1~4) */
function queueBackoffSecondsForNextAttempt(nextRetryCount) {
  if (nextRetryCount <= 0) return 0;
  return Math.min(
    QUEUE_BACKOFF_MAX_SEC,
    QUEUE_BACKOFF_INITIAL_SEC * 2 ** (nextRetryCount - 1),
  );
}

/**
 * @param {string} type
 * @param {object} p
 * @param {object|null} [queueRow] — SQLite 큐/DLQ 행(없으면 즉시 동기 경로)
 * @param {boolean} [fromDlq]
 */
async function executeJobType(type, p, queueRow = null, fromDlq = false) {
  const prov = queueRow ? mergeQueuedSyncProvenanceFields(queueRow, { fromDlq }) : {};
  switch (type) {
    case 'payment_bundle': {
      await firebaseService.savePaymentToFirebase(p.restaurantId, { ...p.paymentData, ...prov });
      if (p.guestNumber != null && p.guestNumber !== '') {
        await firebaseService.saveGuestPaymentStatus(
          p.restaurantId,
          p.orderId,
          p.guestNumber,
          'PAID',
          prov,
        );
      }
      return;
    }
    case 'saveTipToFirebase':
      return firebaseService.saveTipToFirebase(p.restaurantId, { ...p.tipData, ...prov });
    case 'void_cancel_and_void_doc': {
      if (p.firebaseOrderId) {
        await firebaseService.updateOrderStatus(
          String(p.firebaseOrderId),
          'cancelled',
          p.restaurantId || null,
          prov,
        );
      }
      return firebaseService.saveVoidToFirebase(p.restaurantId, { ...p.voidData, ...prov });
    }
    case 'saveDailyClosing':
      return firebaseService.saveDailyClosing(p.restaurantId, { ...p.closingData, ...prov });
    case 'firebase_upload_order':
      return firebaseService.uploadOrder(p.restaurantId, { ...p.uploadBody, ...prov });
    case 'order_close_status_and_paid': {
      await firebaseService.updateOrderStatus(
        String(p.firebaseOrderId),
        'completed',
        p.restaurantId,
        prov,
      );
      return firebaseService.updateOrderAsPaid(
        p.restaurantId,
        String(p.firebaseOrderId),
        {
          paymentMethod: p.paymentMethod,
          tip: p.totalTips,
        },
        prov,
      );
    }
    case 'sales_sync_payment':
      return salesSyncService.syncPaymentToFirebase(
        p.orderData,
        p.paymentData,
        p.restaurantId,
        { ...(p.options || {}), syncProvenance: prov },
      );
    case 'sales_sync_order_items':
      return salesSyncService.syncOrderItemsToFirebase(p.orderData, p.restaurantId, {
        syncProvenance: prov,
      });
    default:
      throw new Error(`Unknown firebase queue type: ${type}`);
  }
}

async function syncOrQueue(type, orderId, payload) {
  if (networkConnectivity.isInternetConnected()) {
    try {
      await executeJobType(type, payload, null, false);
      return { synced: true };
    } catch (e) {
      console.warn(`[FirebaseSync] live sync failed, queueing: ${type}`, e.message);
      await firebaseSyncQueue.enqueue({
        type,
        payload,
        order_id: orderId,
        deferral_reason: DEFERRAL_REASON_LIVE_SYNC_FAILED,
      });
      return { queued: true };
    }
  }

  await firebaseSyncQueue.enqueue({
    type,
    payload,
    order_id: orderId,
    deferral_reason: DEFERRAL_REASON_OFFLINE,
  });
  return { queued: true };
}

async function processOneRow(row) {
  const p = parsePayload(row);
  return executeJobType(String(row.type || ''), p, row, false);
}

/**
 * DLQ 1건 자동 재전송(쿼터 절약: 호출당 최대 1건, next_auto_retry_at 준수).
 */
async function processOneDlqAutoRetry() {
  if (!networkConnectivity.isInternetConnected()) return { dlq: 0 };
  const row = await firebaseSyncQueue.dbGet(
    `SELECT * FROM firebase_sync_dlq WHERE IFNULL(auto_exhausted,0) = 0
     AND (next_auto_retry_at IS NULL OR next_auto_retry_at <= datetime('now'))
     ORDER BY id ASC LIMIT 1`,
  );
  if (!row) return { dlq: 0 };
  try {
    const p = parsePayload(row);
    await executeJobType(String(row.type || ''), p, row, true);
    await firebaseSyncQueue.dbRun(`DELETE FROM firebase_sync_dlq WHERE id = ?`, [row.id]);
    return { dlq: 1 };
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    const offlineOrNet =
      !networkConnectivity.isInternetConnected() || isLikelyNetworkOrOfflineError(e);
    if (offlineOrNet) {
      await firebaseSyncQueue.dbRun(
        `UPDATE firebase_sync_dlq SET error_message = ?, next_auto_retry_at = datetime('now', '+15 minutes') WHERE id = ?`,
        [`net:${msg}`.slice(0, 2000), row.id],
      );
      return { dlq: 0 };
    }
    const cnt = (row.auto_retry_count || 0) + 1;
    if (cnt >= MAX_DLQ_AUTO_ATTEMPTS) {
      await firebaseSyncQueue.dbRun(
        `UPDATE firebase_sync_dlq SET error_message = ?, auto_retry_count = ?, auto_exhausted = 1 WHERE id = ?`,
        [msg, cnt, row.id],
      );
    } else {
      const delayMin = Math.min(DLQ_AUTO_MAX_DELAY_MIN, DLQ_AUTO_FIRST_DELAY_MIN * 2 ** cnt);
      await firebaseSyncQueue.dbRun(
        `UPDATE firebase_sync_dlq SET error_message = ?, auto_retry_count = ?, next_auto_retry_at = datetime('now', '+` +
          delayMin +
          ` minutes') WHERE id = ?`,
        [msg, cnt, row.id],
      );
    }
    return { dlq: 0 };
  }
}

async function processPendingJobs() {
  if (processLock) return { processed: 0 };
  if (!networkConnectivity.isInternetConnected()) return { processed: 0, skipped: 'offline' };

  processLock = true;
  let processed = 0;
  let stopAll = false;
  try {
    while (!stopAll && networkConnectivity.isInternetConnected()) {
      const headPick = await pickGlobalSmallestReadyHeadRow();
      if (!headPick) break;

      const anchorOid = headPick.order_id;

      while (!stopAll && networkConnectivity.isInternetConnected()) {
        const row = await pickReadyHeadForOrderBucket(anchorOid);
        if (!row) break;

        const upd = await firebaseSyncQueue.dbRun(
          `UPDATE firebase_sync_queue SET status = 'processing', updated_at = datetime('now') WHERE id = ? AND status = 'pending'`,
          [row.id],
        );
        if (!upd || upd.changes === 0) continue;

        const still = await firebaseSyncQueue.dbGet(
          `SELECT * FROM firebase_sync_queue WHERE id = ?`,
          [row.id],
        );
        if (!still) continue;

        if (!networkConnectivity.isInternetConnected()) {
          await revertQueueRowPendingNetworkSkip(still.id, 'offline_before_exec');
          stopAll = true;
          break;
        }

        try {
          await processOneRow(still);
          await firebaseSyncQueue.dbRun(`DELETE FROM firebase_sync_queue WHERE id = ?`, [row.id]);
          processed += 1;
        } catch (e) {
          const msg = e && e.message ? e.message : String(e);
          const offlineOrNet =
            !networkConnectivity.isInternetConnected() || isLikelyNetworkOrOfflineError(e);
          if (offlineOrNet) {
            await revertQueueRowPendingNetworkSkip(still.id, msg);
            stopAll = true;
            break;
          }
          const nextRetry = (still.retry_count || 0) + 1;
          if (nextRetry >= MAX_RETRY) {
            await firebaseSyncQueue.dbRun(
              `INSERT INTO firebase_sync_dlq (queue_id, type, payload, order_id, error_message, next_auto_retry_at, auto_retry_count, auto_exhausted, deferral_reason, queue_created_at)
               VALUES (?,?,?,?,?, datetime('now', '+15 minutes'), 0, 0, ?, ?)`,
              [
                still.id,
                still.type,
                still.payload,
                still.order_id,
                msg,
                still.deferral_reason != null ? String(still.deferral_reason) : null,
                still.created_at != null ? String(still.created_at) : null,
              ],
            );
            await firebaseSyncQueue.dbRun(`DELETE FROM firebase_sync_queue WHERE id = ?`, [still.id]);
            console.error(`[FirebaseSync] DLQ: ${still.type} id=${still.id}`, msg);
          } else {
            const delaySec = queueBackoffSecondsForNextAttempt(nextRetry);
            await firebaseSyncQueue.dbRun(
              `UPDATE firebase_sync_queue SET status = 'pending', retry_count = ?, last_error = ?, updated_at = datetime('now'),
               next_retry_at = datetime('now', '+` +
                delaySec +
                ` seconds') WHERE id = ?`,
              [nextRetry, msg, still.id],
            );
          }
          break;
        }
      }
    }

    try {
      await processOneDlqAutoRetry();
    } catch (e) {
      console.warn('[FirebaseSync] processOneDlqAutoRetry:', e.message);
    }
  } finally {
    processLock = false;
  }
  return { processed };
}

/**
 * DLQ에 보관된 작업을 다시 실행(로컬 SQLite 기준 동일 payload → Firebase만 재전송).
 * 성공 시 DLQ 행 삭제. 오프라인이면 거부.
 */
async function retryDlqEntry(dlqId) {
  const row = await firebaseSyncQueue.dbGet(`SELECT * FROM firebase_sync_dlq WHERE id = ?`, [dlqId]);
  if (!row) {
    const err = new Error('DLQ entry not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (!networkConnectivity.isInternetConnected()) {
    const err = new Error('network_offline');
    err.code = 'OFFLINE';
    throw err;
  }
  const p = parsePayload(row);
  await executeJobType(String(row.type || ''), p, row, true);
  await firebaseSyncQueue.dbRun(`DELETE FROM firebase_sync_dlq WHERE id = ?`, [dlqId]);
  return { ok: true };
}

/**
 * 재연결 직후 1회 호출(7번). next_retry_at 백오프는 일괄 리셋하지 않고,
 * 이미 도래한 pending·짧은 지연만 예약된 건만 처리한다.
 */
function onNetworkRecovered() {
  return processPendingJobs();
}

module.exports = {
  syncOrQueue,
  executeJobType,
  processPendingJobs,
  onNetworkRecovered,
  retryDlqEntry,
  isQueueWorkerActive,
};
