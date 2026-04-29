/**
 * Urban Piper → POS 웹훅 핸들러
 *
 * Urban Piper (또는 Atlas)는 주문 상태가 바뀌면 이 엔드포인트로 POST를 날린다.
 * 예:  Acknowledged → Food Ready → Dispatched → Completed / Cancelled
 *
 * 등록 URL 예시 (Atlas 설정):
 *   https://<your-domain>/api/urbanpiper/webhook
 *
 * 이 핸들러는:
 *   1. 페이로드를 파싱해 Urban Piper 주문 ID ↔ Firebase 문서를 연결
 *   2. Firebase status 및 SQLite 상태를 UP 상태에 맞게 업데이트
 *   3. SSE로 프론트엔드에 실시간 변경 통지
 */

'use strict';

const express = require('express');
const router = express.Router();

// UP 상태 → POS/Firebase 내부 상태 매핑 테이블
// Urban Piper 공식 문서 상태 코드 기준 (모두 소문자로 정규화)
const UP_STATUS_MAP = {
  // 주문 접수 확인 (POS에서 이미 수락 처리되므로 추가 업데이트 불필요하지만 로깅)
  acknowledged: 'confirmed',
  accepted:     'confirmed',
  // 음식 준비 완료
  'food ready': 'ready',
  foodready:    'ready',
  food_ready:   'ready',
  // 픽업/배달 기사 출발
  dispatched:   'picked_up',
  // 배달 완료
  completed:    'completed',
  delivered:    'completed',
  // 취소
  cancelled:    'cancelled',
  canceled:     'cancelled',
  rejected:     'cancelled',
};

/**
 * POST /api/urbanpiper/webhook
 *
 * Urban Piper 가 주문 상태 변경 시 호출하는 웹훅.
 * req.body 예시 (실제 구조는 UP 버전마다 다를 수 있음):
 * {
 *   "order_id": "UP-12345",            // Urban Piper 주문 ID
 *   "status":   "Dispatched",          // 변경된 상태
 *   "channel":  "ubereats",            // 채널 슬러그 (옵션)
 *   "details":  { ... },               // 추가 정보 (옵션)
 *   "ext_platforms": [{ "id": "...", "name": "ubereats" }]  // 채널 플랫폼 정보 (옵션)
 * }
 */
router.post('/webhook', async (req, res) => {
  try {
    const payload = req.body || {};

    // Urban Piper 주문 ID 추출 — 여러 필드명 시도
    const upOrderId = String(
      payload.order_id ||
      payload.orderId ||
      payload.id ||
      payload.order?.id ||
      payload.order?.details?.id ||
      ''
    ).trim();

    const rawStatus = String(
      payload.status ||
      payload.order_status ||
      payload.orderStatus ||
      payload.state ||
      ''
    ).trim();

    if (!upOrderId) {
      console.warn('[UP-WEBHOOK] order_id 없음 — 페이로드:', JSON.stringify(payload).slice(0, 300));
      return res.status(400).json({ ok: false, error: 'order_id required' });
    }

    const normalizedStatus = rawStatus.toLowerCase().replace(/\s+/g, '');
    const posStatus = UP_STATUS_MAP[rawStatus.toLowerCase()] || UP_STATUS_MAP[normalizedStatus];

    console.log(`[UP-WEBHOOK] order=${upOrderId} status=${rawStatus} → posStatus=${posStatus || '(no mapping)'}`);

    if (!posStatus) {
      // 알 수 없는 상태는 무시하되 200 반환 (UP 는 200 이 아닐 경우 재시도)
      return res.json({ ok: true, ignored: true, reason: `no mapping for status: ${rawStatus}` });
    }

    // Firestore 에서 해당 UP 주문 ID를 가진 문서 조회
    const firebaseService = require('../services/firebaseService');
    const { db, dbRun, dbGet } = require('../db');
    const firebaseDeliveryChannel = require('../utils/firebaseDeliveryChannel');
    const { broadcastToRestaurant } = require('./online-orders');

    // 전체 레스토랑 검색 — restaurantId를 페이로드에서 받으면 우선 사용
    const restaurantId =
      String(payload.restaurant_id || payload.restaurantId || payload.store_id || payload.storeId || '').trim() ||
      null;

    const order = await findFirestoreOrderByUpId(firebaseService, upOrderId, restaurantId);

    if (!order) {
      console.warn(`[UP-WEBHOOK] Firestore 에서 UP order ${upOrderId} 를 찾지 못함`);
      return res.json({ ok: true, ignored: true, reason: 'order not found in Firestore' });
    }

    const orderId  = order.id;
    const restId   = order._restaurantId || restaurantId;
    const currentStatus = String(order.status || '').toLowerCase();

    // 이미 같은 상태거나 completed/cancelled 이후 변경은 무시
    if (currentStatus === posStatus) {
      return res.json({ ok: true, ignored: true, reason: 'already same status' });
    }
    if (currentStatus === 'completed' || currentStatus === 'cancelled') {
      return res.json({ ok: true, ignored: true, reason: 'terminal status — no update' });
    }

    // Firebase 상태 업데이트
    await firebaseService.updateOrderStatus(orderId, posStatus, restId);
    console.log(`[UP-WEBHOOK] Firebase 업데이트 완료: ${orderId} → ${posStatus}`);

    // SQLite 미러 업데이트
    try {
      const statusRow = {
        confirmed: 2,
        ready:     3,
        picked_up: 4,
        completed: 5,
        cancelled: 6,
      };
      const sqlStatus = statusRow[posStatus] ?? null;
      if (sqlStatus !== null) {
        await dbRun(
          `UPDATE online_orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE firebase_id = ?`,
          [posStatus, orderId]
        );
      }
    } catch (sqlErr) {
      console.warn('[UP-WEBHOOK] SQLite 업데이트 실패 (non-fatal):', sqlErr?.message);
    }

    // SSE 브로드캐스트 — 프론트엔드 실시간 갱신
    if (restId && broadcastToRestaurant) {
      broadcastToRestaurant(restId, {
        type: 'order_status_changed',
        orderId,
        status: posStatus,
        upStatus: rawStatus,
        source: 'urbanpiper_webhook',
      });
    }

    return res.json({ ok: true, orderId, newStatus: posStatus });
  } catch (err) {
    console.error('[UP-WEBHOOK] 처리 오류:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * Urban Piper 주문 ID로 Firestore 문서를 찾는다.
 * 1. 지정 restaurantId 레스토랑에서 먼저 검색
 * 2. 없으면 Firebase 관리자 SDK로 collectionGroup 쿼리 시도
 *
 * @param {object} firebaseService
 * @param {string} upOrderId
 * @param {string|null} restaurantId
 * @returns {Promise<object|null>}
 */
async function findFirestoreOrderByUpId(firebaseService, upOrderId, restaurantId) {
  const { getFirestore } = require('../services/firebaseService');
  const db = getFirestore ? getFirestore() : null;
  if (!db) return null;

  // 도우미: 쿼리 결과 첫 번째 문서 반환
  async function firstResult(query) {
    const snap = await query.get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() };
  }

  const fieldCandidates = [
    ['sourceIds.urbanpiperOrderId',   upOrderId],
    ['sourceIds.urbanpiper_order_id', upOrderId],
    ['rawUrbanPiper.order.details.id', upOrderId],
    ['rawUrbanPiper.order.id',         upOrderId],
    ['rawUrbanPiper.id',               upOrderId],
  ];

  // 1) 특정 레스토랑
  if (restaurantId) {
    const coll = db.collection('restaurants').doc(restaurantId).collection('orders');
    for (const [field, value] of fieldCandidates) {
      const result = await firstResult(coll.where(field, '==', value).limit(1));
      if (result) return Object.assign(result, { _restaurantId: restaurantId });
    }
  }

  // 2) collectionGroup 검색 (여러 레스토랑)
  for (const [field, value] of fieldCandidates) {
    try {
      const result = await firstResult(
        db.collectionGroup('orders').where(field, '==', value).limit(1)
      );
      if (result) {
        // 상위 restaurantId 추출
        const snap2 = await db.collectionGroup('orders').where(field, '==', value).limit(1).get();
        const docRef = snap2.docs[0]?.ref;
        const restId = docRef?.parent?.parent?.id || null;
        return Object.assign(result, { _restaurantId: restId });
      }
    } catch {
      // collectionGroup 쿼리는 인덱스 없으면 실패 — 무시하고 다음 시도
    }
  }

  return null;
}

module.exports = router;
