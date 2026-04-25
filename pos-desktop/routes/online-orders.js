// backend/routes/online-orders.js
// 온라인 주문 API 라우트

const express = require('express');
const router = express.Router();
const firebaseService = require('../services/firebaseService');
const salesSyncService = require('../services/salesSyncService');
const { dbRun, dbGet, dbAll } = require('../db');
const { computePromotionAdjustment } = require('../utils/promotionCalculator');
const { getLocalDatetimeString } = require('../utils/datetimeUtils');
const preorderReprintService = require('../services/preorderReprintService');
const { resolveServicePattern } = require('../utils/orderServicePattern');
const networkConnectivityService = require('../services/networkConnectivityService');

// 활성 리스너 저장 (레스토랑별)
const activeListeners = new Map();
const activeSettingsListeners = new Map();

// 연결된 SSE 클라이언트들
const sseClients = new Map();

/**
 * POS 일일 주문번호(admin_settings.daily_order_counter) — `orders.js` POST / 와 동일 규칙.
 * 온라인(Firebase→SQLite) 경로에서도 데이클로징 후 001~ 이 한 줄로 이어지도록 사용.
 */
async function assignPosDailyOrderNumberToSqliteOrder(orderId) {
  if (orderId == null || !Number.isFinite(Number(orderId))) return null;
  let displayNumber = null;
  try {
    const counterRow = await dbGet(`SELECT value FROM admin_settings WHERE key = 'daily_order_counter'`);
    const nextNum = parseInt(counterRow?.value || '0', 10) + 1;
    await dbRun(`INSERT OR REPLACE INTO admin_settings(key, value) VALUES('daily_order_counter', ?)`, [String(nextNum)]);
    displayNumber = String(nextNum).padStart(3, '0');
    await dbRun(`UPDATE orders SET order_number = ? WHERE id = ?`, [displayNumber, orderId]);
  } catch (e) {
    console.error('[Online] Daily order_number assign failed:', e.message);
  }
  return displayNumber;
}

/** 레거시(ONLINE-타임스탬프·비어 있음)면 일일 번호로 한 번 교체 */
async function ensurePosDailyOrderNumberForOnlineSqliteRow(orderId, currentOrderNumber) {
  if (orderId == null || !Number.isFinite(Number(orderId))) return null;
  const cur = currentOrderNumber != null ? String(currentOrderNumber).trim() : '';
  if (cur && !/^ONLINE-/i.test(cur)) return cur;
  return await assignPosDailyOrderNumberToSqliteOrder(orderId);
}

/** Firebase 온라인 주문 → SQLite `orders.ready_time` / `orders.pickup_minutes` (GET /orders·Pickup List) */
function parseFirebaseOrderCreatedAt(order, createdAtStrFallback) {
  if (createdAtStrFallback) {
    const d = new Date(createdAtStrFallback);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const ca = order.createdAt?.toDate?.() || order.createdAt;
  if (!ca) return null;
  if (typeof ca === 'string') {
    const d = new Date(ca);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (ca instanceof Date) return Number.isNaN(ca.getTime()) ? null : ca;
  try {
    const d = new Date(ca);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function sqliteReadyFieldsFromFirebaseOrder(order, createdAtStrFallback) {
  const prepRaw =
    order?.prepTime ?? order?.prep_time ?? order?.pickupMinutes ?? order?.pickup_minutes;
  const prepNum = Number(prepRaw);
  const pickupMinutes = Number.isFinite(prepNum) && prepNum > 0 ? Math.round(prepNum) : null;

  const readyRaw =
    order?.readyTime ??
    order?.ready_time ??
    order?.pickupTime ??
    order?.pickup_time ??
    order?.readyTimeLabel ??
    order?.ready_time_label ??
    null;
  let readyTime = readyRaw != null && String(readyRaw).trim() !== '' ? String(readyRaw).trim() : null;

  if (!readyTime && pickupMinutes) {
    const base = parseFirebaseOrderCreatedAt(order, createdAtStrFallback);
    if (base) {
      readyTime = new Date(base.getTime() + pickupMinutes * 60000).toISOString();
    }
  }

  return { readyTime, pickupMinutes };
}

/** 기존 행(ready 비어 있음)에 Firebase 값 백필 */
async function syncSqliteReadyFieldsFromFirebase(localOrderId, order, createdAtStrFallback) {
  const { readyTime, pickupMinutes } = sqliteReadyFieldsFromFirebaseOrder(order, createdAtStrFallback);
  if (!readyTime && !(pickupMinutes != null && pickupMinutes > 0)) return;
  try {
    const row = await dbGet('SELECT ready_time, pickup_minutes FROM orders WHERE id = ?', [localOrderId]);
    const rtEmpty = !row?.ready_time || !String(row.ready_time).trim();
    const pmEmpty = row?.pickup_minutes == null || Number(row.pickup_minutes) <= 0;
    if (rtEmpty && readyTime) {
      await dbRun('UPDATE orders SET ready_time = ? WHERE id = ?', [readyTime, localOrderId]);
    }
    if (pmEmpty && pickupMinutes != null && pickupMinutes > 0) {
      await dbRun('UPDATE orders SET pickup_minutes = ? WHERE id = ?', [pickupMinutes, localOrderId]);
    }
  } catch (e) {
    console.warn('[Online] syncSqliteReadyFieldsFromFirebase:', e.message);
  }
}

/** Firebase 온라인 주문 문서의 팁 → SQLite `orders.online_tip` (카드 결제 시 팁 등) */
function parseFirebaseOrderTip(order) {
  const raw = order?.tip ?? order?.tipAmount ?? order?.tip_amount ?? order?.gratuity ?? 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

async function syncSqliteOnlineTipFromFirebase(localOrderId, order) {
  if (localOrderId == null || !Number.isFinite(Number(localOrderId))) return;
  const tip = parseFirebaseOrderTip(order);
  try {
    await dbRun('UPDATE orders SET online_tip = ? WHERE id = ?', [tip, localOrderId]);
  } catch (e) {
    console.warn('[Online] syncSqliteOnlineTipFromFirebase:', e.message);
  }
}

/** Kitchen/출력 헤더: SQLite `order_number`(일일 순번) 우선 — Sales 카드·POS 영수증과 동일 */
function resolveOnlineKitchenOrderNumberHeader(localOrder, firebaseOrder, firebaseOrderId) {
  if (localOrder?.order_number != null && String(localOrder.order_number).trim() !== '') {
    const t = String(localOrder.order_number).trim().replace(/^#/, '');
    if (t) {
      const display = /^\d+$/.test(t) && t.length < 3 ? t.padStart(3, '0') : t;
      return `#${display}`;
    }
  }
  const fb = firebaseOrder?.orderNumber != null ? String(firebaseOrder.orderNumber).trim() : '';
  if (fb) return fb.startsWith('#') ? fb : `#${fb}`;
  if (localOrder?.id != null) return `#${localOrder.id}`;
  return firebaseOrderId ? `#${firebaseOrderId}` : '#';
}

// orders 테이블 마이그레이션 (컬럼 추가)
(async () => {
  const migrations = [
    { col: 'adjustments_json', sql: 'ALTER TABLE orders ADD COLUMN adjustments_json TEXT' },
    { col: 'payment_status', sql: "ALTER TABLE orders ADD COLUMN payment_status TEXT DEFAULT 'pending'" },
    { col: 'payment_method', sql: "ALTER TABLE orders ADD COLUMN payment_method TEXT DEFAULT 'cash'" },
    { col: 'payment_transaction_id', sql: 'ALTER TABLE orders ADD COLUMN payment_transaction_id TEXT' },
    { col: 'card_last4', sql: 'ALTER TABLE orders ADD COLUMN card_last4 TEXT' },
    { col: 'paid_at', sql: 'ALTER TABLE orders ADD COLUMN paid_at TEXT' },
    { col: 'online_tip', sql: 'ALTER TABLE orders ADD COLUMN online_tip REAL DEFAULT 0' },
  ];
  for (const m of migrations) {
    try {
      await dbRun(m.sql);
      console.log(`✅ orders 테이블에 ${m.col} 컬럼 추가됨`);
    } catch (e) {
      // 이미 존재하면 무시
    }
  }
})();

// Firebase 초기화 상태 확인
let firebaseInitialized = false;

// Firebase 초기화 시도
function ensureFirebaseInit() {
  if (!firebaseInitialized) {
    try {
      firebaseService.initializeFirebase();
      firebaseInitialized = true;
    } catch (error) {
      console.error('Firebase 초기화 실패:', error.message);
      return false;
    }
  }
  return true;
}

// ============================================
// SSE (Server-Sent Events) - 실시간 주문 알림
// ============================================

// SSE 연결 - 프론트엔드에서 실시간 주문 수신
router.get('/stream/:restaurantId', (req, res) => {
  const { restaurantId } = req.params;

  if (!ensureFirebaseInit()) {
    return res.status(500).json({ success: false, error: 'Firebase not initialized' });
  }

  // SSE 헤더 설정
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // 클라이언트 ID 생성
  const clientId = `${restaurantId}-${Date.now()}`;
  
  // SSE 클라이언트 등록
  if (!sseClients.has(restaurantId)) {
    sseClients.set(restaurantId, new Map());
  }
  sseClients.get(restaurantId).set(clientId, res);

  console.log(`📡 SSE 클라이언트 연결: ${clientId}`);

  // 연결 확인 메시지
  res.write(`data: ${JSON.stringify({ type: 'connected', clientId })}\n\n`);

  // 해당 레스토랑에 리스너가 없으면 시작
  if (!activeListeners.has(restaurantId)) {
    startOrderListener(restaurantId);
  }
  if (!activeSettingsListeners.has(restaurantId)) {
    startSettingsListener(restaurantId);
  }

  // 연결 종료 시 정리
  req.on('close', () => {
    console.log(`📡 SSE 클라이언트 연결 해제: ${clientId}`);
    if (sseClients.has(restaurantId)) {
      sseClients.get(restaurantId).delete(clientId);
      
      // 해당 레스토랑에 연결된 클라이언트가 없으면 리스너 중지
      if (sseClients.get(restaurantId).size === 0) {
        stopOrderListener(restaurantId);
        stopSettingsListener(restaurantId);
        sseClients.delete(restaurantId);
      }
    }
  });
});

// Firebase 주문 리스너 시작
function startOrderListener(restaurantId) {
  if (activeListeners.has(restaurantId)) {
    return;
  }
  if (!networkConnectivityService.isInternetConnected()) {
    console.warn(`[Online] Offline: order listener not started (${restaurantId})`);
    return;
  }

  console.log(`👂 주문 리스너 시작: ${restaurantId}`);

  const unsubscribe = firebaseService.listenToOnlineOrders(restaurantId, {
    onNewOrder: async (order) => {
      if (firebaseService.isExcludedFromOnlineOrderChannel(order)) return;

      const firebaseOrderId = order.id;
      let localOrder = null;

      const pStatus = (order.paymentStatus || 'pending').toLowerCase();
      const isPaid = pStatus === 'paid' || pStatus === 'completed' || order.paid === true;
      
      try {
        localOrder = await dbGet(
          'SELECT id FROM orders WHERE firebase_order_id = ?',
          [firebaseOrderId]
        );

        const createdAt = order.createdAt?.toDate?.() || order.createdAt || new Date().toISOString();
        const createdAtStr = typeof createdAt === 'string' ? createdAt : createdAt.toISOString();
        const rf = sqliteReadyFieldsFromFirebaseOrder(order, createdAtStr);
        const onlineTipVal = parseFirebaseOrderTip(order);

        if (!localOrder) {
          const paidAtRaw = order.paidAt?.toDate?.() || order.paidAt || null;

          const result = await dbRun(
            `INSERT INTO orders (order_number, order_type, total, status, created_at, customer_phone, customer_name, firebase_order_id, payment_status, payment_method, payment_transaction_id, card_last4, paid_at, ready_time, pickup_minutes, fulfillment_mode, service_pattern, online_tip)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              null,
              'ONLINE',
              order.total || 0,
              'PENDING',
              createdAtStr,
              order.customerPhone || null,
              order.customerName || null,
              firebaseOrderId,
              isPaid ? 'paid' : pStatus,
              order.paymentMethod || 'cash',
              order.paymentTransactionId || null,
              order.cardLast4 || null,
              paidAtRaw ? (typeof paidAtRaw === 'string' ? paidAtRaw : paidAtRaw.toISOString()) : null,
              rf.readyTime || null,
              rf.pickupMinutes,
              'online',
              resolveServicePattern({ orderType: 'ONLINE', fulfillmentMode: 'online', tableId: null }),
              onlineTipVal,
            ]
          );
          localOrder = { id: result.lastID };

          if (Array.isArray(order.items)) {
            for (const item of order.items) {
              await dbRun(
                `INSERT INTO order_items (order_id, item_id, name, quantity, price)
                 VALUES (?, ?, ?, ?, ?)`,
                [localOrder.id, item.id || null, item.name || '', item.quantity || 1, item.price || 0]
              );
            }
          }
          const posDaily = await assignPosDailyOrderNumberToSqliteOrder(localOrder.id);
          console.log(
            `✅ 온라인 주문 SQLite 저장: id=${localOrder.id} pos#=${posDaily || '—'} | 결제: ${isPaid ? 'PAID' : pStatus} (${order.paymentMethod || 'cash'}) ready_time=${rf.readyTime || '—'} pickup_minutes=${rf.pickupMinutes ?? '—'}`
          );
        }
        if (localOrder?.id) {
          await syncSqliteReadyFieldsFromFirebase(localOrder.id, order, createdAtStr);
          await syncSqliteOnlineTipFromFirebase(localOrder.id, order);
        }
      } catch (saveError) {
        console.error('SSE 온라인 주문 SQLite 저장 실패:', saveError.message);
      }
      
      const formatted = formatOrderForFrontend(order);
      formatted.localOrderId = localOrder?.id || null;
      try {
        if (localOrder?.id) {
          const r = await dbGet('SELECT order_number FROM orders WHERE id = ?', [localOrder.id]);
          if (r?.order_number) {
            formatted.posOrderNumber = r.order_number;
            formatted.orderNumber = r.order_number;
            formatted.order_number = r.order_number;
          }
        }
      } catch {}
      
      broadcastToClients(restaurantId, {
        type: 'new_order',
        order: formatted
      });
    },
    onOrderUpdate: async (order) => {
      if (firebaseService.isExcludedFromOnlineOrderChannel(order)) return;

      try {
        const lo = await dbGet('SELECT id FROM orders WHERE firebase_order_id = ?', [order.id]);
        if (lo?.id) {
          const createdAt = order.createdAt?.toDate?.() || order.createdAt;
          const createdAtStr =
            typeof createdAt === 'string' ? createdAt : createdAt?.toISOString?.() ? createdAt.toISOString() : '';
          await syncSqliteReadyFieldsFromFirebase(lo.id, order, createdAtStr || null);
          await syncSqliteOnlineTipFromFirebase(lo.id, order);
        }
      } catch (e) {
        console.warn('[Online] onOrderUpdate SQLite sync:', e.message);
      }

      broadcastToClients(restaurantId, {
        type: 'order_updated',
        order: formatOrderForFrontend(order)
      });
    },
    onError: (error) => {
      broadcastToClients(restaurantId, {
        type: 'error',
        message: error.message
      });
    }
  });

  activeListeners.set(restaurantId, unsubscribe);
}

// Firebase 주문 리스너 중지
function stopOrderListener(restaurantId) {
  const unsubscribe = activeListeners.get(restaurantId);
  if (unsubscribe) {
    unsubscribe();
    activeListeners.delete(restaurantId);
    console.log(`🛑 주문 리스너 중지: ${restaurantId}`);
  }
}

/** SIGINT 종료 시 모든 온라인 주문/설정 Firebase 리스너 해제 */
function stopAllFirebaseOrderListeners() {
  [...activeListeners.keys()].forEach((id) => stopOrderListener(id));
  [...activeSettingsListeners.keys()].forEach((id) => stopSettingsListener(id));
}

// Firebase Online Settings 리스너 시작 (Prep Time, Pause, Day Off, Utility)
function startSettingsListener(restaurantId) {
  if (activeSettingsListeners.has(restaurantId)) return;
  if (!networkConnectivityService.isInternetConnected()) {
    console.warn(`[Online] Offline: settings listener not started (${restaurantId})`);
    return;
  }
  if (!ensureFirebaseInit()) return;

  const firestore = firebaseService.getFirestore();
  const settingsRef = firestore.collection('restaurantSettings').doc(restaurantId);

  let isInitial = true;
  const unsubscribe = settingsRef.onSnapshot(
    async (docSnap) => {
      if (!docSnap.exists) return;
      const data = docSnap.data();

      const prepTimeRaw = data?.prepTimeSettings;
      const prepTimeSettings = prepTimeRaw?.settings || prepTimeRaw || null;
      const pauseSettings = data?.pauseSettings || null;
      const dayOffDates = (data?.dayOffSettings?.dates || []).map((d) => ({
        date: d.date,
        channels: d.channels || 'all',
        type: d.type || 'closed',
      }));
      const utilitySettings = data?.utilitySettings || null;

      const payload = {
        type: 'online_settings_changed',
        settings: {
          prepTimeSettings,
          pauseSettings,
          dayOffDates,
          utilitySettings,
        },
      };

      if (isInitial) {
        isInitial = false;
        console.log(`📦 Online Settings 초기 로드: ${restaurantId}`);
      } else {
        console.log(`🔄 Online Settings 변경 감지: ${restaurantId}`);
      }

      broadcastToClients(restaurantId, payload);
    },
    (error) => {
      console.error('❌ Online Settings 리스너 오류:', error);
    }
  );

  activeSettingsListeners.set(restaurantId, unsubscribe);
  console.log(`👂 Online Settings 리스너 시작: ${restaurantId}`);
}

function stopSettingsListener(restaurantId) {
  const unsubscribe = activeSettingsListeners.get(restaurantId);
  if (unsubscribe) {
    unsubscribe();
    activeSettingsListeners.delete(restaurantId);
    console.log(`🛑 Online Settings 리스너 중지: ${restaurantId}`);
  }
}

// SSE 클라이언트들에게 메시지 브로드캐스트
function broadcastToClients(restaurantId, data) {
  const clients = sseClients.get(restaurantId);
  if (!clients) return;

  const message = `data: ${JSON.stringify(data)}\n\n`;
  
  clients.forEach((res, clientId) => {
    try {
      res.write(message);
    } catch (error) {
      console.error(`SSE 전송 실패 (${clientId}):`, error.message);
      clients.delete(clientId);
    }
  });
}

// 주문 데이터 포맷팅 (프론트엔드용)
function formatOrderForFrontend(order) {
  // items에 프로모션 관련 필드 포함
  const formattedItems = (order.items || []).map(item => ({
    ...item,
    discountAmount: item.discountAmount || 0,
    discountPercent: item.discountPercent || 0,
    promotionName: item.promotionName || null,
    priceAfterDiscount: item.priceAfterDiscount || item.subtotal || item.price
  }));

  const resolvedOrderNumber =
    order.orderNumber ||
    order.order_number ||
    order.externalOrderNumber ||
    order.displayOrderNumber ||
    order.firebaseOrderNumber ||
    null;

  const paymentStatus = (order.paymentStatus || 'pending').toLowerCase();
  const statusLc = String(order.status || '').toLowerCase();
  const isPaid =
    paymentStatus === 'paid' ||
    paymentStatus === 'completed' ||
    statusLc === 'paid' ||
    statusLc === 'completed' ||
    statusLc === 'closed' ||
    order.paid === true ||
    order.isPaid === true;

  return {
    id: order.id,
    orderNumber: resolvedOrderNumber,
    /** POS SQLite 일일 순번 — 프론트가 camel/snake 모두에서 읽을 수 있게 */
    order_number: order.order_number != null && String(order.order_number).trim() !== '' ? String(order.order_number).trim() : null,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    customerEmail: order.customerEmail || null,
    orderType: order.orderType,
    status: order.status,
    items: formattedItems,
    subtotal: order.subtotal,
    subtotalAfterDiscount: order.subtotalAfterDiscount || order.subtotal,
    tax: order.tax,
    total: order.total,
    notes: order.notes,
    createdAt: order.createdAt?.toDate?.() || order.createdAt,
    updatedAt: order.updatedAt?.toDate?.() || order.updatedAt,
    // 결제 정보
    paymentStatus: isPaid ? 'paid' : paymentStatus,
    paymentMethod: order.paymentMethod || 'cash',
    paymentTransactionId: order.paymentTransactionId || null,
    cardLast4: order.cardLast4 || null,
    paidAt: order.paidAt?.toDate?.() || order.paidAt || null,
    isPaid,
    // 프로모션 관련 필드
    discountAmount: order.discountAmount || 0,
    promotionId: order.promotionId || null,
    promotionName: order.promotionName || null,
    promotionType: order.promotionType || null,
    promotionPercent: order.promotionPercent || order.discountPercent || null,
    taxBreakdown: order.taxBreakdown || null,
    deliveryFee: order.deliveryFee || 0,
    /** 온라인(파이어베이스) 주문 팁 — SQLite `online_tip`과 병합될 수 있음 */
    tip: parseFirebaseOrderTip(order),
  };
}

// ============================================
// REST API 엔드포인트
// ============================================

// ===== DAY OFF 라우트 (/:restaurantId 보다 먼저 정의해야 함) =====

// Day Off 목록 조회
router.get('/day-off', async (req, res) => {
  try {
    const dayOffs = await dbAll(
      'SELECT id, date, channels, type, created_at, updated_at FROM online_day_off ORDER BY date ASC'
    );
    console.log(`[DAY OFF] Get: ${dayOffs.length} records`);
    res.json({ success: true, dayOffs });
  } catch (error) {
    console.error('[DAY OFF] Get error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Day Off 추가 (단일)
router.post('/day-off', async (req, res) => {
  try {
    const { date, channels = 'all', type = 'closed', restaurantId: reqRestaurantId } = req.body;
    
    if (!date) {
      return res.status(400).json({ success: false, error: 'Date is required' });
    }

    await dbRun(
      `INSERT OR REPLACE INTO online_day_off (date, channels, type, updated_at) 
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      [date, channels, type]
    );

    // Firebase 동기화 - 요청에서 restaurantId가 없으면 business_profile에서 가져옴
    const restaurantIdRow = await dbGet('SELECT firebase_restaurant_id FROM business_profile WHERE id = 1');
    const restaurantId = reqRestaurantId || restaurantIdRow?.firebase_restaurant_id;
    
    if (restaurantId) {
      try {
        await firebaseService.addDayOff(restaurantId, date, channels, type);
        console.log(`[DAY OFF] Firebase sync success: ${date}`);
      } catch (fbErr) {
        console.error('[DAY OFF] Firebase sync error:', fbErr.message);
      }
    }

    console.log(`[DAY OFF] Added: ${date}, channels: ${channels}, type: ${type}`);
    res.json({ success: true, message: 'Day off added', date, type, firebaseSynced: !!restaurantId });
  } catch (error) {
    console.error('[DAY OFF] Add error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Day Off 여러 날짜 일괄 설정
router.post('/day-off/bulk', async (req, res) => {
  try {
    const { dates, channels = 'all', type = 'closed', restaurantId: reqRestaurantId } = req.body;
    
    console.log(`[DAY OFF] Bulk request: dates=${JSON.stringify(dates)}, channels=${channels}, type=${type}`);
    
    if (!dates || !Array.isArray(dates) || dates.length === 0) {
      return res.status(400).json({ success: false, error: 'Dates array is required' });
    }

    for (const date of dates) {
      await dbRun(
        `INSERT OR REPLACE INTO online_day_off (date, channels, type, updated_at) 
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        [date, channels, type]
      );
    }

    // Firebase 동기화 - 요청에서 restaurantId가 없으면 business_profile에서 가져옴
    const restaurantIdRow = await dbGet('SELECT firebase_restaurant_id FROM business_profile WHERE id = 1');
    const restaurantId = reqRestaurantId || restaurantIdRow?.firebase_restaurant_id;
    
    if (restaurantId) {
      try {
        const allDayOffs = await dbAll('SELECT date, channels, type FROM online_day_off ORDER BY date ASC');
        await firebaseService.syncDayOff(restaurantId, allDayOffs);
        console.log(`[DAY OFF] Firebase sync success: ${dates.length} dates`);
      } catch (fbErr) {
        console.error('[DAY OFF] Firebase sync error:', fbErr.message);
      }
    } else {
      console.log('[DAY OFF] No restaurantId - Firebase sync skipped');
    }

    console.log(`[DAY OFF] Bulk added: ${dates.length} dates with channels: ${channels}, type: ${type}`);
    res.json({ success: true, message: `${dates.length} day offs added`, dates, type, firebaseSynced: !!restaurantId });
  } catch (error) {
    console.error('[DAY OFF] Bulk add error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 특정 날짜가 Day Off인지 확인
router.get('/day-off/check/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const dayOff = await dbGet('SELECT * FROM online_day_off WHERE date = ?', [date]);
    
    res.json({ 
      success: true, 
      isDayOff: !!dayOff,
      dayOff: dayOff || null
    });
  } catch (error) {
    console.error('[DAY OFF] Check error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Day Off 삭제
router.delete('/day-off/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const { restaurantId: reqRestaurantId } = req.query;
    
    await dbRun('DELETE FROM online_day_off WHERE date = ?', [date]);
    
    // Firebase 동기화 - 요청에서 restaurantId가 없으면 business_profile에서 가져옴
    const restaurantIdRow = await dbGet('SELECT firebase_restaurant_id FROM business_profile WHERE id = 1');
    const restaurantId = reqRestaurantId || restaurantIdRow?.firebase_restaurant_id;
    
    if (restaurantId) {
      try {
        await firebaseService.removeDayOff(restaurantId, date);
        console.log(`[DAY OFF] Firebase delete success: ${date}`);
      } catch (fbErr) {
        console.error('[DAY OFF] Firebase delete error:', fbErr.message);
      }
    }
    
    console.log(`[DAY OFF] Removed: ${date}`);
    res.json({ success: true, message: 'Day off removed', date, firebaseSynced: !!restaurantId });
  } catch (error) {
    console.error('[DAY OFF] Delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== PAUSE 설정 API (라우트 순서 중요 - /:restaurantId 전에 정의) =====

// Pause 설정 조회
router.get('/pause-settings', async (req, res) => {
  try {
    const settings = await dbAll('SELECT * FROM online_pause_settings ORDER BY channel');
    res.json({ success: true, settings });
  } catch (error) {
    console.error('[PAUSE] Get error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== PREP TIME 설정 API (라우트 순서 중요 - /:restaurantId 전에 정의) =====

// Prep Time 설정 조회
router.get('/prep-time-settings', async (req, res) => {
  try {
    const settings = await dbAll('SELECT * FROM online_prep_time_settings ORDER BY channel');
    res.json({ success: true, settings });
  } catch (error) {
    console.error('[PREP TIME] Get error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== 온라인 주문 라우트 =====

// 온라인 주문 목록 조회
router.get('/:restaurantId', async (req, res) => {
  try {
    if (!ensureFirebaseInit()) {
      return res.status(500).json({ success: false, error: 'Firebase not initialized' });
    }

    const { restaurantId } = req.params;
    const { status, limit } = req.query;

    const orders = await firebaseService.getOnlineOrders(restaurantId, {
      status,
      limit: parseInt(limit) || 50
    });

    // 결제 후 SQLite는 PAID 등 — 투고패널 온라인 카드는 픽업 전까지 유지(READY). 숨김은 픽업·VOID·머지 등만.
    const SQLITE_HIDE = new Set([
      'MERGED', 'CANCELLED', 'REFUNDED',
      'VOIDED', 'VOID', 'PICKED_UP',
    ]);

    // 각 온라인 주문에 대해 SQLite ID를 조회하거나 생성
    const ordersWithLocalId = await Promise.all(orders.map(async (order) => {
      const firebaseOrderId = order.id;

      // 동일 firebase_order_id로 행이 여러 개면(구버그) VOIDED 행이 있으면 무조건 숨김
      const locals = await dbAll(
        'SELECT id, status, order_type, order_number FROM orders WHERE firebase_order_id = ?',
        [firebaseOrderId]
      );
      let localOrder = null;
      if (locals && locals.length > 0) {
        if (locals.some((r) => SQLITE_HIDE.has(String(r.status || '').toUpperCase()))) {
          return null;
        }
        localOrder = locals.reduce((best, r) => (Number(r.id) > Number(best.id) ? r : best));
      }

      if (localOrder && SQLITE_HIDE.has(String(localOrder.status || '').toUpperCase())) {
        return null;
      }
      
      // 테이블로 이동된 주문 (order_type = 'POS')도 필터링
      if (localOrder && localOrder.order_type === 'POS') {
        return null; // 테이블로 이동된 주문은 온라인 목록에서 제외
      }
      
      if (!localOrder) {
        const createdAt = order.createdAt?.toDate?.() || order.createdAt || new Date().toISOString();
        const createdAtStr = typeof createdAt === 'string' ? createdAt : createdAt.toISOString();
        const rf = sqliteReadyFieldsFromFirebaseOrder(order, createdAtStr);
        const onlineTipList = parseFirebaseOrderTip(order);

        try {
          const result = await dbRun(
            `INSERT INTO orders (order_number, order_type, total, status, created_at, customer_phone, customer_name, firebase_order_id, ready_time, pickup_minutes, fulfillment_mode, service_pattern, online_tip)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              null,
              'ONLINE',
              order.total || 0,
              'PENDING',
              createdAtStr,
              order.customerPhone || null,
              order.customerName || null,
              firebaseOrderId,
              rf.readyTime || null,
              rf.pickupMinutes,
              'online',
              resolveServicePattern({ orderType: 'ONLINE', fulfillmentMode: 'online', tableId: null }),
              onlineTipList,
            ]
          );
          localOrder = { id: result.lastID, order_number: null };
          
          if (Array.isArray(order.items)) {
            for (const item of order.items) {
              await dbRun(
                `INSERT INTO order_items (order_id, item_id, name, quantity, price)
                 VALUES (?, ?, ?, ?, ?)`,
                [localOrder.id, item.id || null, item.name || '', item.quantity || 1, item.price || 0]
              );
            }
          }
          const posDailyNew = await assignPosDailyOrderNumberToSqliteOrder(localOrder.id);
          if (posDailyNew) localOrder.order_number = posDailyNew;
        } catch (insertError) {
          console.error('온라인 주문 SQLite 저장 실패:', insertError.message);
        }
      }

      if (localOrder?.id) {
        try {
          const r = await dbGet('SELECT order_number FROM orders WHERE id = ?', [localOrder.id]);
          const ensured = await ensurePosDailyOrderNumberForOnlineSqliteRow(localOrder.id, r?.order_number);
          if (ensured) localOrder.order_number = ensured;
          else if (r?.order_number) localOrder.order_number = r.order_number;
        } catch {}
        try {
          const createdAtForSync = order.createdAt?.toDate?.() || order.createdAt;
          const createdAtStrForSync =
            typeof createdAtForSync === 'string'
              ? createdAtForSync
              : createdAtForSync?.toISOString?.()
                ? createdAtForSync.toISOString()
                : '';
          await syncSqliteReadyFieldsFromFirebase(localOrder.id, order, createdAtStrForSync || null);
          await syncSqliteOnlineTipFromFirebase(localOrder.id, order);
        } catch (e) {
          console.warn('[Online] GET list SQLite ready sync:', e.message);
        }
      }

      const formatted = formatOrderForFrontend(order);
      formatted.localOrderId = localOrder?.id || null;
      if (localOrder?.order_number) {
        formatted.posOrderNumber = localOrder.order_number;
        formatted.orderNumber = localOrder.order_number;
        formatted.order_number = localOrder.order_number;
      }
      if (localOrder?.id) {
        try {
          const sqliteRow = await dbGet(
            'SELECT status, payment_status, online_tip FROM orders WHERE id = ?',
            [localOrder.id]
          );
          if (sqliteRow) {
            const ss = String(sqliteRow.status || '').toUpperCase();
            const ps = String(sqliteRow.payment_status || '').toLowerCase();
            if (ss === 'PAID' || ps === 'paid' || ps === 'completed') {
              formatted.paymentStatus = 'paid';
              formatted.isPaid = true;
            }
            const ot = Number(sqliteRow.online_tip);
            if (Number.isFinite(ot) && ot >= 0) {
              formatted.tip = ot;
              formatted.onlineTip = ot;
            }
          }
        } catch (e) {
          console.warn('[Online] GET list SQLite paid merge:', e.message);
        }
      }
      return formatted;
    }));

    // null 값 필터링 (이미 머지/완료된 주문 제외)
    const filteredOrders = ordersWithLocalId.filter(order => order !== null);
    
    res.json({
      success: true,
      orders: filteredOrders
    });
  } catch (error) {
    console.error('주문 목록 조회 실패:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 특정 주문 조회
router.get('/order/:orderId', async (req, res) => {
  try {
    if (!ensureFirebaseInit()) {
      return res.status(500).json({ success: false, error: 'Firebase not initialized' });
    }

    const { orderId } = req.params;
    let restaurantId = null;
    try {
      const profile = await dbGet('SELECT firebase_restaurant_id FROM business_profile WHERE id = 1');
      restaurantId = profile?.firebase_restaurant_id || null;
    } catch (_) {
      /* ignore */
    }
    const order = await firebaseService.getOrderById(orderId, restaurantId);

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    res.json({
      success: true,
      order: formatOrderForFrontend(order)
    });
  } catch (error) {
    console.error('주문 조회 실패:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 주문 상태 변경
router.put('/order/:orderId/status', async (req, res) => {
  try {
    if (!ensureFirebaseInit()) {
      return res.status(500).json({ success: false, error: 'Firebase not initialized' });
    }

    const { orderId } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, error: 'Status is required' });
    }

    const result = await firebaseService.updateOrderStatus(orderId, status);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('주문 상태 변경 실패:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 주문 확인 (pending → confirmed)
router.post('/order/:orderId/confirm', async (req, res) => {
  try {
    if (!ensureFirebaseInit()) {
      return res.status(500).json({ success: false, error: 'Firebase not initialized' });
    }

    const { orderId } = req.params;
    const result = await firebaseService.updateOrderStatus(orderId, 'confirmed');

    res.json({
      success: true,
      message: '주문이 확인되었습니다',
      ...result
    });
  } catch (error) {
    console.error('주문 확인 실패:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 주문 준비 시작 (confirmed → preparing)
router.post('/order/:orderId/prepare', async (req, res) => {
  try {
    if (!ensureFirebaseInit()) {
      return res.status(500).json({ success: false, error: 'Firebase not initialized' });
    }

    const { orderId } = req.params;
    const result = await firebaseService.updateOrderStatus(orderId, 'preparing');

    res.json({
      success: true,
      message: '주문 준비를 시작합니다',
      ...result
    });
  } catch (error) {
    console.error('주문 준비 시작 실패:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 주문 준비 완료 (preparing → ready)
router.post('/order/:orderId/ready', async (req, res) => {
  try {
    if (!ensureFirebaseInit()) {
      return res.status(500).json({ success: false, error: 'Firebase not initialized' });
    }

    const { orderId } = req.params;
    const result = await firebaseService.updateOrderStatus(orderId, 'ready');

    res.json({
      success: true,
      message: '주문이 준비되었습니다',
      ...result
    });
  } catch (error) {
    console.error('주문 준비 완료 실패:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 주문 완료 (ready → completed)
router.post('/order/:orderId/complete', async (req, res) => {
  try {
    if (!ensureFirebaseInit()) {
      return res.status(500).json({ success: false, error: 'Firebase not initialized' });
    }

    const { orderId } = req.params;
    const result = await firebaseService.updateOrderStatus(orderId, 'completed');

    // 로컬 SQLite 데이터베이스도 PAID 상태로 업데이트
    let localOrderId = null;
    try {
      const closedAt = getLocalDatetimeString();
      await dbRun(
        `UPDATE orders SET status = 'PAID', closed_at = ? WHERE firebase_order_id = ?`,
        [closedAt, orderId]
      );
      console.log(`✅ 온라인 주문 로컬 DB 상태 업데이트: ${orderId} → PAID`);
      
      // 로컬 주문 ID 조회
      const localOrder = await dbGet(`SELECT id FROM orders WHERE firebase_order_id = ?`, [orderId]);
      if (localOrder) {
        localOrderId = localOrder.id;
      }
    } catch (dbError) {
      console.error('로컬 DB 업데이트 실패:', dbError.message);
    }

    // Firebase 매출 동기화 (Dine-In, Togo와 동일하게)
    try {
      const restaurantId = process.env.FIREBASE_RESTAURANT_ID;
      
      if (restaurantId && localOrderId) {
        // 주문 정보 조회
        const orderData = await dbGet(`SELECT * FROM orders WHERE id = ?`, [localOrderId]);
        // 결제 정보 조회
        const payments = await dbAll(`SELECT * FROM payments WHERE order_id = ? AND status = 'APPROVED'`, [localOrderId]);
        // 주문 아이템 조회
        const items = await dbAll(`SELECT * FROM order_items WHERE order_id = ?`, [localOrderId]);
        
        if (orderData && payments.length > 0) {
          // 총 결제 금액 계산
          const totalPayment = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
          const totalTips = payments.reduce((sum, p) => sum + (p.tip || 0), 0);
          const paymentMethod = payments[0]?.method || 'CASH';
          
          // Firebase 동기화 (비동기, 실패해도 결제는 성공)
          salesSyncService.syncPaymentToFirebase(
            { ...orderData, items, orderType: 'ONLINE' },
            { amount: totalPayment, tip: totalTips, method: paymentMethod },
            restaurantId
          ).catch(err => console.warn('[SalesSync] Online order sync error:', err.message));
          
          // 아이템별 매출 동기화
          if (items.length > 0) {
            salesSyncService.syncOrderItemsToFirebase(
              { ...orderData, items, orderType: 'ONLINE' },
              restaurantId
            ).catch(err => console.warn('[SalesSync] Online item sync error:', err.message));
          }
          
          console.log(`✅ 온라인 주문 Firebase 매출 동기화 완료: ${orderId}`);
        }
      }
    } catch (syncErr) {
      // Firebase 동기화 실패해도 결제는 성공 처리
      console.warn('[SalesSync] Online order sync skipped:', syncErr.message);
    }

    res.json({
      success: true,
      message: '주문이 완료되었습니다',
      ...result
    });
  } catch (error) {
    console.error('주문 완료 실패:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 주문 취소 (any → cancelled)
router.post('/order/:orderId/cancel', async (req, res) => {
  try {
    if (!ensureFirebaseInit()) {
      return res.status(500).json({ success: false, error: 'Firebase not initialized' });
    }

    const { orderId } = req.params;
    let restaurantId = req.body?.restaurantId;
    if (!restaurantId) {
      const profile = await dbGet('SELECT firebase_restaurant_id FROM business_profile LIMIT 1');
      restaurantId = profile?.firebase_restaurant_id;
    }
    const result = await firebaseService.updateOrderStatus(orderId, 'cancelled', restaurantId || null);

    res.json({
      success: true,
      message: '주문이 취소되었습니다',
      ...result
    });
  } catch (error) {
    console.error('주문 취소 실패:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 픽업 완료 (completed → picked_up)
router.post('/order/:orderId/pickup', async (req, res) => {
  try {
    if (!ensureFirebaseInit()) {
      return res.status(500).json({ success: false, error: 'Firebase not initialized' });
    }

    const { orderId } = req.params;
    
    // restaurantId를 요청 본문에서 받거나 business_profile에서 가져오기
    let restaurantId = req.body.restaurantId;
    if (!restaurantId) {
      const profile = await dbGet('SELECT firebase_restaurant_id FROM business_profile LIMIT 1');
      restaurantId = profile?.firebase_restaurant_id;
    }
    
    console.log(`[PICKUP] orderId: ${orderId}, restaurantId: ${restaurantId}`);
    
    const result = await firebaseService.updateOrderStatus(orderId, 'picked_up', restaurantId);

    res.json({
      success: true,
      message: '픽업이 완료되었습니다',
      ...result
    });
  } catch (error) {
    console.error('픽업 완료 실패:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 주문 수락 (pending → confirmed, prepTime/pickupTime 설정)
router.post('/order/:orderId/accept', async (req, res) => {
  try {
    if (!ensureFirebaseInit()) {
      return res.status(500).json({ success: false, error: 'Firebase not initialized' });
    }

    const { orderId } = req.params;
    const { prepTime, pickupTime, readyTime, restaurantId } = req.body;
    
    console.log(`[ACCEPT] orderId: ${orderId}, prepTime: ${prepTime}, pickupTime: ${pickupTime}, readyTime: ${readyTime}`);

    const result = await firebaseService.acceptOrder(orderId, prepTime, pickupTime, restaurantId || null, readyTime || null);

    try {
      const prepNum = Number(prepTime);
      const rtStr =
        (readyTime != null && String(readyTime).trim() !== '' && String(readyTime).trim()) ||
        (pickupTime != null && String(pickupTime).trim() !== '' && String(pickupTime).trim()) ||
        null;
      await dbRun(
        `UPDATE orders SET ready_time = ?, pickup_minutes = ? WHERE firebase_order_id = ?`,
        [
          rtStr,
          Number.isFinite(prepNum) && prepNum > 0 ? Math.round(prepNum) : null,
          orderId
        ]
      );
    } catch (sqlErr) {
      console.warn('[ACCEPT] SQLite ready_time sync:', sqlErr.message);
    }

    try {
      await preorderReprintService.onOnlineOrderAccepted({
        dbRun,
        dbGet,
        restaurantId: restaurantId || null,
        orderId,
      });
    } catch (preErr) {
      console.warn('[ACCEPT] preorder reprint schedule:', preErr && preErr.message);
    }

    res.json({
      success: true,
      message: 'Order accepted',
      prepTime,
      pickupTime,
      readyTime,
      ...result
    });
  } catch (error) {
    console.error('Order accept failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 주문 거절 (pending → cancelled + reason)
router.post('/order/:orderId/reject', async (req, res) => {
  try {
    if (!ensureFirebaseInit()) {
      return res.status(500).json({ success: false, error: 'Firebase not initialized' });
    }

    const { orderId } = req.params;
    const { reason, restaurantId } = req.body;
    const result = await firebaseService.rejectOrder(orderId, reason || '', restaurantId || null);

    res.json({
      success: true,
      message: 'Order rejected',
      ...result
    });
  } catch (error) {
    console.error('Order reject failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 온라인(Firebase) 주문 → `/api/printers/print-order` 로 보내는 JSON 본문과 동일 구조.
 * 실제 print POST 와 화면 미리보기 GET 이 공유한다.
 */
async function buildOnlineOrderKitchenPrintPayload(orderId, reqRestaurantId) {
  if (!ensureFirebaseInit()) {
    throw new Error('Firebase not initialized');
  }
  const order = await firebaseService.getOrderById(orderId, reqRestaurantId || null);
  if (!order) {
    throw new Error('Order not found');
  }

  const localOrder = await dbGet(
    'SELECT id, order_number FROM orders WHERE firebase_order_id = ?',
    [orderId]
  );
  const localOrderNumber = resolveOnlineKitchenOrderNumberHeader(localOrder, order, orderId);

  console.log(`🖨️ 온라인 주문 출력 시작: ${localOrderNumber} (Firebase 표시번호: ${order.orderNumber}, sqlite id: ${localOrder?.id ?? '—'})`);

  const printItems = [];
  for (const item of (order.items || [])) {
    let printerGroupIds = [];
    let itemId = item.posItemId || null;
    let categoryId = item.posCategoryId || null;

    if (!itemId) {
      const menuItem = await dbGet(
        'SELECT item_id, category_id FROM menu_items WHERE name = ? OR short_name = ?',
        [item.name, item.name]
      );
      if (menuItem) {
        itemId = menuItem.item_id;
        categoryId = menuItem.category_id;
      }
    }

    if (itemId) {
      const itemPrinterLinks = await dbAll(
        'SELECT printer_group_id FROM menu_printer_links WHERE item_id = ?',
        [itemId]
      );

      if (itemPrinterLinks && itemPrinterLinks.length > 0) {
        printerGroupIds = itemPrinterLinks.map(l => l.printer_group_id);
      } else if (categoryId) {
        const categoryPrinterLinks = await dbAll(
          'SELECT printer_group_id FROM category_printer_links WHERE category_id = ?',
          [categoryId]
        );
        if (categoryPrinterLinks && categoryPrinterLinks.length > 0) {
          printerGroupIds = categoryPrinterLinks.map(l => l.printer_group_id);
        }
      }
    }

    if (printerGroupIds.length === 0) {
      const defaultGroup = await dbGet("SELECT id FROM printer_groups WHERE name = 'Kitchen' AND is_active = 1");
      if (defaultGroup) {
        printerGroupIds.push(defaultGroup.id);
        console.log(`⚠️ 수동출력 아이템 "${item.name}" - 프린터 그룹 없음, 기본 Kitchen 사용`);
      }
    }

    console.log(`🖨️ 수동출력 아이템 "${item.name}" - posItemId: ${itemId}, categoryId: ${categoryId}, printerGroups: [${printerGroupIds.join(', ')}]`);

    printItems.push({
      id: itemId || 0,
      name: item.name || 'Unknown Item',
      quantity: item.quantity || 1,
      price: item.price || 0,
      printerGroupIds: printerGroupIds,
      modifiers: (item.options || []).map(opt => ({
        name: opt.choiceName || opt.name || '',
        price: opt.price || 0
      })),
      specialInstructions: item.specialInstructions || ''
    });
  }

  const prepTime = order.prepTime || order.prep_time || 20;
  const pickupDate = new Date(Date.now() + prepTime * 60000);
  const pickupTimeStr = pickupDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  const pStatusLower = (order.paymentStatus || '').toLowerCase();
  const orderIsPaid = order.status === 'paid' ||
    pStatusLower === 'paid' ||
    pStatusLower === 'completed' ||
    order.paid === true ||
    order.isPaid === true;

  return {
    orderInfo: {
      orderNumber: localOrderNumber,
      externalOrderNumber: localOrderNumber,
      orderType: 'ONLINE',
      table: order.orderType === 'pickup' ? 'PICKUP' : (order.orderType === 'delivery' ? 'DELIVERY' : 'ONLINE'),
      customerName: order.customerName || '',
      customerPhone: order.customerPhone || '',
      notes: order.notes || '',
      specialInstructions: order.notes || order.specialInstructions || '',
      channel: 'THEZONE',
      deliveryChannel: 'THEZONE',
      orderSource: 'THEZONE',
      firebaseOrderNumber: order.orderNumber,
      prepTime: prepTime,
      pickupMinutes: prepTime,
      pickupTime: pickupTimeStr
    },
    items: printItems,
    isAdditionalOrder: false,
    isPaid: orderIsPaid,
    isReprint: false
  };
}

// ============================================
// 프린터 출력 (온라인 주문용)
// ============================================

/** 화면 미리보기: print-order 와 동일한 JSON (GET) */
router.get('/order/:orderId/kitchen-print-payload', async (req, res) => {
  try {
    const { orderId } = req.params;
    const restaurantId = req.query.restaurantId != null && String(req.query.restaurantId).trim() !== ''
      ? String(req.query.restaurantId).trim()
      : null;
    const payload = await buildOnlineOrderKitchenPrintPayload(orderId, restaurantId);
    res.json({ success: true, ...payload });
  } catch (error) {
    const msg = error && error.message;
    const status = msg === 'Order not found' ? 404 : 500;
    console.error('[Online] kitchen-print-payload:', msg || error);
    res.status(status).json({ success: false, error: msg || String(error) });
  }
});

// 온라인 주문 영수증 출력
router.post('/order/:orderId/print', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { printerType = 'both', restaurantId: reqRestaurantId } = req.body;

    let printPayload;
    try {
      printPayload = await buildOnlineOrderKitchenPrintPayload(orderId, reqRestaurantId || null);
    } catch (e) {
      const msg = e && e.message;
      if (msg === 'Firebase not initialized') {
        return res.status(500).json({ success: false, error: msg });
      }
      if (msg === 'Order not found') {
        return res.status(404).json({ success: false, error: msg });
      }
      throw e;
    }

    const localOrderNumber = printPayload.orderInfo.orderNumber;

    // 기존 프린터 시스템 사용하여 출력
    const http = require('http');

    const printData = JSON.stringify(printPayload);

    const printReq = http.request({
      hostname: 'localhost',
      port: 3177,
      path: '/api/printers/print-order',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(printData)
      }
    }, (printRes) => {
      let responseData = '';
      printRes.on('data', chunk => { responseData += chunk; });
      printRes.on('end', () => {
        console.log('🖨️ 프린터 응답:', responseData);
      });
    });

    printReq.on('error', (err) => {
      console.error('🖨️ 프린터 요청 오류:', err.message);
    });

    printReq.write(printData);
    printReq.end();

    res.json({
      success: true,
      message: '출력 요청이 전송되었습니다',
      orderNumber: localOrderNumber,
      externalOrderNumber: printPayload.orderInfo.firebaseOrderNumber,
      printerType
    });
  } catch (error) {
    console.error('출력 실패:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 영수증 포맷 생성
function generateReceipt(order, restaurantName) {
  const orderTypeLabels = {
    pickup: '픽업',
    delivery: '배달',
    dine_in: '매장식사'
  };

  const createdAt = order.createdAt?.toDate?.() || new Date(order.createdAt);
  const dateStr = createdAt.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  let receipt = '';
  receipt += '========================================\n';
  receipt += `        ${restaurantName}\n`;
  receipt += '========================================\n';
  receipt += `주문번호: ${order.orderNumber}\n`;
  receipt += `주문시간: ${dateStr}\n`;
  receipt += `주문유형: ${orderTypeLabels[order.orderType] || order.orderType}\n`;
  receipt += '\n';
  receipt += '----------------------------------------\n';
  receipt += `고객: ${order.customerName}\n`;
  receipt += `연락처: ${order.customerPhone}\n`;
  receipt += '----------------------------------------\n';
  receipt += '\n';
  receipt += '[ 주문 내역 ]\n';
  receipt += '\n';

  // 주문 아이템
  for (const item of order.items || []) {
    const itemTotal = `$${item.subtotal?.toFixed(2) || '0.00'}`;
    receipt += `${item.name.padEnd(25)} x${item.quantity}   ${itemTotal}\n`;

    // 옵션
    for (const opt of item.options || []) {
      const optPrice = opt.price > 0 ? `$${opt.price.toFixed(2)}` : '';
      receipt += `  + ${opt.choiceName}${optPrice ? ' '.repeat(20 - opt.choiceName.length) + optPrice : ''}\n`;
    }
    receipt += `                          소계: $${item.subtotal?.toFixed(2) || '0.00'}\n`;
    receipt += '\n';
  }

  receipt += '----------------------------------------\n';
  receipt += `소계:${' '.repeat(27)}$${order.subtotal?.toFixed(2) || '0.00'}\n`;
  receipt += `세금:${' '.repeat(27)}$${order.tax?.toFixed(2) || '0.00'}\n`;
  receipt += '========================================\n';
  receipt += `총액:${' '.repeat(27)}$${order.total?.toFixed(2) || '0.00'}\n`;
  receipt += '========================================\n';

  if (order.notes) {
    receipt += '\n';
    receipt += `요청사항: ${order.notes}\n`;
  }

  receipt += '\n';
  receipt += '========================================\n';

  return receipt;
}

// ============================================
// 레스토랑 Pause 관리
// ============================================

// Pause 설정
router.post('/pause/:restaurantId', async (req, res) => {
  const { restaurantId } = req.params;
  const { pauseUntil, channels = ['thezoneorder'] } = req.body;

  console.log(`[PAUSE] 레스토랑 ${restaurantId} Pause 요청:`, { pauseUntil, channels });

  if (!ensureFirebaseInit()) {
    return res.status(500).json({ success: false, error: 'Firebase not initialized' });
  }

  try {
    // Firebase restaurantSettings에 Pause 상태 저장 (TZO 호환)
    await firebaseService.updateRestaurantPause(restaurantId, pauseUntil, channels);
    
    res.json({ 
      success: true, 
      message: pauseUntil ? `Paused until ${pauseUntil}` : 'Resumed',
      pauseUntil,
      channels
    });
  } catch (error) {
    console.error('[PAUSE] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Resume (Pause 해제)
router.post('/resume/:restaurantId', async (req, res) => {
  const { restaurantId } = req.params;
  const { channels = ['thezoneorder', 'ubereats', 'doordash', 'skipthedishes'] } = req.body;

  console.log(`[RESUME] 레스토랑 ${restaurantId} Resume 요청:`, { channels });

  if (!ensureFirebaseInit()) {
    return res.status(500).json({ success: false, error: 'Firebase not initialized' });
  }

  try {
    // Firebase restaurantSettings에서 Pause 상태 해제 (TZO 호환)
    await firebaseService.updateRestaurantPause(restaurantId, null, channels);
    
    res.json({ success: true, message: 'Resumed successfully', channels });
  } catch (error) {
    console.error('[RESUME] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== PREP TIME 설정 =====

// Prep Time 설정 저장 및 Firebase 동기화
router.post('/prep-time/:restaurantId', async (req, res) => {
  const { restaurantId } = req.params;
  const { settings } = req.body;

  console.log(`[PREP TIME] 레스토랑 ${restaurantId} Prep Time 설정:`, settings);

  if (!ensureFirebaseInit()) {
    return res.status(500).json({ success: false, error: 'Firebase not initialized' });
  }

  try {
    // Firebase에 Prep Time 설정 동기화
    await firebaseService.syncPrepTimeSettings(restaurantId, settings);
    
    res.json({ 
      success: true, 
      message: 'Prep Time settings saved',
      settings
    });
  } catch (error) {
    console.error('[PREP TIME] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== DAY OFF 테이블 초기화 =====

// Day Off 테이블 초기화 - type 컬럼 추가 (closed, extended, early, late)
const initializeDayOffTable = async () => {
  try {
    const tableExists = await dbGet("SELECT name FROM sqlite_master WHERE type='table' AND name='online_day_off'");
    
    if (tableExists) {
      const columns = await dbAll("PRAGMA table_info(online_day_off)");
      const hasTypeColumn = columns.some(col => col.name === 'type');
      
      if (!hasTypeColumn) {
        await dbRun("ALTER TABLE online_day_off ADD COLUMN type TEXT DEFAULT 'closed'");
        console.log('[DAY OFF] Added type column');
      }
      console.log('[DAY OFF] Table ready with type column');
    } else {
      await dbRun(`
        CREATE TABLE online_day_off (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT NOT NULL,
          channels TEXT DEFAULT 'all',
          type TEXT DEFAULT 'closed',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(date, channels)
        )
      `);
      console.log('[DAY OFF] Table created with type column');
    }
  } catch (error) {
    console.error('[DAY OFF] Table init error:', error);
  }
};

// 초기화 실행
initializeDayOffTable();

// ===== PAUSE 테이블 초기화 =====
const initializePauseTable = async () => {
  try {
    const tableExists = await dbGet("SELECT name FROM sqlite_master WHERE type='table' AND name='online_pause_settings'");
    
    if (!tableExists) {
      await dbRun(`
        CREATE TABLE online_pause_settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          channel TEXT NOT NULL UNIQUE,
          paused INTEGER DEFAULT 0,
          paused_until TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // 기본 채널 삽입
      const channels = ['thezoneorder', 'ubereats', 'doordash', 'skipthedishes'];
      for (const channel of channels) {
        await dbRun('INSERT OR IGNORE INTO online_pause_settings (channel, paused) VALUES (?, 0)', [channel]);
      }
      console.log('[PAUSE] Table created');
    } else {
      console.log('[PAUSE] Table ready');
    }
  } catch (error) {
    console.error('[PAUSE] Table init error:', error);
  }
};

// ===== PREP TIME 테이블 초기화 =====
const initializePrepTimeTable = async () => {
  try {
    const tableExists = await dbGet("SELECT name FROM sqlite_master WHERE type='table' AND name='online_prep_time_settings'");
    
    if (!tableExists) {
      await dbRun(`
        CREATE TABLE online_prep_time_settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          channel TEXT NOT NULL UNIQUE,
          mode TEXT DEFAULT 'auto',
          time TEXT DEFAULT '15',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // 기본 채널 삽입
      const channels = ['thezoneorder', 'ubereats', 'doordash', 'skipthedishes'];
      for (const channel of channels) {
        await dbRun('INSERT OR IGNORE INTO online_prep_time_settings (channel, mode, time) VALUES (?, ?, ?)', [channel, 'auto', '15']);
      }
      console.log('[PREP TIME] Table created');
    } else {
      const indexes = await dbAll("PRAGMA index_list('online_prep_time_settings')");
      const hasChannelUnique = indexes.some(idx => idx.unique === 1 && idx.name !== 'sqlite_autoindex_online_prep_time_settings_1');
      const hasAutoIndex = indexes.some(idx => idx.name === 'sqlite_autoindex_online_prep_time_settings_1');
      if (!hasChannelUnique && !hasAutoIndex) {
        try {
          await dbRun('CREATE UNIQUE INDEX IF NOT EXISTS idx_prep_time_channel ON online_prep_time_settings(channel)');
          console.log('[PREP TIME] Added UNIQUE index on channel');
        } catch (idxErr) {
          console.error('[PREP TIME] Failed to add UNIQUE index:', idxErr.message);
        }
      }
      console.log('[PREP TIME] Table ready');
    }
  } catch (error) {
    console.error('[PREP TIME] Table init error:', error);
  }
};

// 테이블 초기화 실행
initializePauseTable();
initializePrepTimeTable();

// ===== PAUSE API (로컬 DB 저장 + Firebase 동기화) =====

// Pause 설정 저장 (로컬 + Firebase)
router.post('/pause-settings', async (req, res) => {
  const { settings, restaurantId: reqRestaurantId } = req.body;
  
  try {
    // 로컬 DB 저장
    for (const [channel, data] of Object.entries(settings)) {
      await dbRun(
        `INSERT INTO online_pause_settings (channel, paused, paused_until, updated_at) 
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(channel) DO UPDATE SET 
           paused = excluded.paused, 
           paused_until = excluded.paused_until,
           updated_at = CURRENT_TIMESTAMP`,
        [channel, data.paused ? 1 : 0, data.pausedUntil || null]
      );
    }
    
    // Firebase 동기화 - 요청에서 restaurantId가 없으면 business_profile에서 가져옴
    const restaurantIdRow = await dbGet('SELECT firebase_restaurant_id FROM business_profile WHERE id = 1');
    const restaurantId = reqRestaurantId || restaurantIdRow?.firebase_restaurant_id;
    
    if (restaurantId && ensureFirebaseInit()) {
      try {
        const pauseSettings = {};
        for (const [channel, data] of Object.entries(settings)) {
          pauseSettings[channel] = {
            paused: data.paused || false,
            pausedUntil: data.pausedUntil || null
          };
        }
        await firebaseService.updateRestaurantPause(restaurantId, null, Object.keys(settings));
        // 개별 채널 업데이트
        for (const [channel, data] of Object.entries(settings)) {
          if (data.paused) {
            await firebaseService.updateRestaurantPause(restaurantId, data.pausedUntil, [channel]);
          }
        }
        console.log('[PAUSE] Synced to Firebase');
      } catch (fbErr) {
        console.warn('[PAUSE] Firebase sync failed:', fbErr.message);
      }
    } else {
      console.log('[PAUSE] No restaurantId - Firebase sync skipped');
    }
    
    res.json({ success: true, message: 'Pause settings saved', firebaseSynced: !!restaurantId });
  } catch (error) {
    console.error('[PAUSE] Save error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== PREP TIME API (로컬 DB 저장 + Firebase 동기화) =====

// Prep Time 설정 저장 (로컬 + Firebase)
router.post('/prep-time-settings', async (req, res) => {
  const { settings, restaurantId: reqRestaurantId } = req.body;
  
  try {
    // 로컬 DB 저장
    for (const [channel, data] of Object.entries(settings)) {
      await dbRun(
        `INSERT INTO online_prep_time_settings (channel, mode, time, updated_at) 
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(channel) DO UPDATE SET 
           mode = excluded.mode, 
           time = excluded.time,
           updated_at = CURRENT_TIMESTAMP`,
        [channel, data.mode || 'auto', data.time || '15']
      );
    }
    
    // Firebase 동기화 - 요청에서 restaurantId가 없으면 business_profile에서 가져옴
    const restaurantIdRow = await dbGet('SELECT firebase_restaurant_id FROM business_profile WHERE id = 1');
    const restaurantId = reqRestaurantId || restaurantIdRow?.firebase_restaurant_id;
    
    if (restaurantId && ensureFirebaseInit()) {
      try {
        await firebaseService.syncPrepTimeSettings(restaurantId, settings);
        console.log('[PREP TIME] Synced to Firebase');
      } catch (fbErr) {
        console.warn('[PREP TIME] Firebase sync failed:', fbErr.message);
      }
    } else {
      console.log('[PREP TIME] No restaurantId - Firebase sync skipped');
    }
    
    res.json({ success: true, message: 'Prep Time settings saved', firebaseSynced: !!restaurantId });
  } catch (error) {
    console.error('[PREP TIME] Save error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// Online Settings 전체 조회 (Firebase → POS) - 모달 열 때 로드
// ============================================

router.get('/online-settings', async (req, res) => {
  try {
    const reqRestaurantId = req.query.restaurantId || req.headers['x-restaurant-id'];
    const restaurantIdRow = await dbGet('SELECT firebase_restaurant_id FROM business_profile WHERE id = 1');
    const restaurantId = reqRestaurantId || restaurantIdRow?.firebase_restaurant_id;

    if (!restaurantId) {
      return res.json({ success: true, settings: null });
    }

    if (!ensureFirebaseInit()) {
      return res.json({ success: true, settings: null });
    }

    const settings = await firebaseService.getOnlineSettings(restaurantId);
    res.json({ success: true, settings: settings || {} });
  } catch (error) {
    console.error('[ONLINE SETTINGS] Get error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// Utility Settings (Bag Fee, Utensils) - Firebase 연동
// ============================================

// GET /online-orders/utility-settings - Firebase에서 조회
router.get('/utility-settings', async (req, res) => {
  try {
    const reqRestaurantId = req.query.restaurantId || req.headers['x-restaurant-id'];
    const restaurantIdRow = await dbGet('SELECT firebase_restaurant_id FROM business_profile WHERE id = 1');
    const restaurantId = reqRestaurantId || restaurantIdRow?.firebase_restaurant_id;

    if (!restaurantId) {
      return res.json({ success: true, utilitySettings: null });
    }

    if (!ensureFirebaseInit()) {
      return res.json({ success: true, utilitySettings: null });
    }

    const utilitySettings = await firebaseService.getUtilitySettings(restaurantId);
    const defaults = { bagFee: { enabled: false, amount: 0.10 }, utensils: { enabled: false }, preOrderReprint: { enabled: false } };
    const merged = { ...defaults, ...(utilitySettings || {}) };
    if (!merged.preOrderReprint) merged.preOrderReprint = { enabled: false };
    res.json({ success: true, utilitySettings: merged });
  } catch (error) {
    console.error('[UTILITY] Get error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /online-orders/utility-settings - Firebase에 저장
router.post('/utility-settings', async (req, res) => {
  try {
    const { utilitySettings, restaurantId: reqRestaurantId } = req.body;
    const restaurantIdRow = await dbGet('SELECT firebase_restaurant_id FROM business_profile WHERE id = 1');
    const restaurantId = reqRestaurantId || restaurantIdRow?.firebase_restaurant_id;

    if (!restaurantId) {
      return res.status(400).json({ success: false, error: 'Restaurant ID not found' });
    }

    if (!ensureFirebaseInit()) {
      return res.status(500).json({ success: false, error: 'Firebase not initialized' });
    }

    const payload = {
      bagFee: {
        enabled: Boolean(utilitySettings?.bagFee?.enabled),
        amount: parseFloat(utilitySettings?.bagFee?.amount) || 0.10,
      },
      utensils: {
        enabled: Boolean(utilitySettings?.utensils?.enabled),
      },
      preOrderReprint: {
        enabled: Boolean(utilitySettings?.preOrderReprint?.enabled),
      },
    };

    await firebaseService.syncUtilitySettings(restaurantId, payload);
    console.log('[UTILITY] Synced to Firebase');
    res.json({ success: true, message: 'Utility settings saved', firebaseSynced: true });
  } catch (error) {
    console.error('[UTILITY] Save error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// Promotion API for Online/Table Orders
// ============================================

// Calculate promotion for online order
router.post('/calculate-promotion', async (req, res) => {
  try {
    const { items, channel = 'online', promoCode = '' } = req.body;
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Items array is required' });
    }
    
    // Load promotion rules
    const promoRows = await dbAll('SELECT * FROM discount_promotions WHERE enabled = 1 ORDER BY created_at DESC');
    const promotionRules = promoRows.map(r => ({
      id: r.id,
      name: r.name || '',
      code: r.code || '',
      startDate: r.start_date || '',
      endDate: r.end_date || '',
      startTime: r.start_time || '',
      endTime: r.end_time || '',
      mode: (r.mode === 'amount' ? 'amount' : 'percent'),
      value: Number(r.value || 0),
      minSubtotal: Number(r.min_subtotal || 0),
      eligibleItemIds: (()=>{ try { return JSON.parse(r.eligible_item_ids||'[]'); } catch { return []; } })(),
      daysOfWeek: (()=>{ try { return JSON.parse(r.days_of_week||'[]'); } catch { return []; } })(),
      dateAlways: !!r.date_always,
      timeAlways: !!r.time_always,
      enabled: true,
      createdAt: Number(r.created_at || 0),
      channels: (()=>{ try { return JSON.parse(r.channels_json||'{}'); } catch { return {}; } })()
    }));
    
    // Prepare items for calculation
    const promoItems = items.map(it => ({
      id: it.menuItemId || it.posItemId || it.id,
      totalPrice: it.price || it.subtotal || 0,
      quantity: it.quantity || 1
    }));
    
    // Calculate subtotal
    const subtotal = promoItems.reduce((sum, it) => sum + (it.totalPrice * it.quantity), 0);
    
    // Calculate promotion
    const promotionAdjustment = computePromotionAdjustment(promoItems, {
      enabled: promotionRules.length > 0,
      type: 'percent',
      value: 0,
      eligibleItemIds: [],
      codeInput: promoCode,
      rules: promotionRules,
      channel: channel
    });
    
    if (promotionAdjustment) {
      res.json({
        success: true,
        hasPromotion: true,
        promotion: {
          id: promotionAdjustment.ruleId,
          name: promotionAdjustment.label,
          mode: promotionAdjustment.mode,
          value: promotionAdjustment.value,
          discountAmount: promotionAdjustment.amountApplied
        },
        subtotal,
        subtotalAfterDiscount: Math.max(0, subtotal - promotionAdjustment.amountApplied)
      });
    } else {
      res.json({
        success: true,
        hasPromotion: false,
        promotion: null,
        subtotal,
        subtotalAfterDiscount: subtotal
      });
    }
  } catch (error) {
    console.error('[ONLINE ORDER] Calculate promotion error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get available promotions for a channel
router.get('/promotions/:channel', async (req, res) => {
  try {
    const { channel } = req.params;
    
    // Load promotion rules
    const promoRows = await dbAll('SELECT * FROM discount_promotions WHERE enabled = 1 ORDER BY created_at DESC');
    const allRules = promoRows.map(r => ({
      id: r.id,
      name: r.name || '',
      code: r.code || '',
      startDate: r.start_date || '',
      endDate: r.end_date || '',
      startTime: r.start_time || '',
      endTime: r.end_time || '',
      mode: (r.mode === 'amount' ? 'amount' : 'percent'),
      value: Number(r.value || 0),
      minSubtotal: Number(r.min_subtotal || 0),
      dateAlways: !!r.date_always,
      timeAlways: !!r.time_always,
      enabled: true,
      channels: (()=>{ try { return JSON.parse(r.channels_json||'{}'); } catch { return {}; } })()
    }));
    
    // Channel mapping
    const channelMap = {
      'online': 'online',
      'table-order': 'tableOrder',
      'togo': 'togo',
      'dine-in': 'table',
      'delivery': 'delivery',
      'kiosk': 'kiosk'
    };
    const posChannel = channelMap[channel] || channel;
    
    // Filter by channel
    const filteredRules = allRules.filter(r => {
      if (!r.channels || Object.keys(r.channels).length === 0) return true;
      return !!r.channels[posChannel];
    });
    
    // Check which promotions are currently active
    const now = new Date();
    const activePromotions = filteredRules.filter(r => {
      // Date check
      if (!r.dateAlways) {
        if (r.startDate) {
          const [y, m, d] = r.startDate.split('-').map(n => parseInt(n, 10));
          const startDate = new Date(y, m - 1, d);
          if (now < startDate) return false;
        }
        if (r.endDate) {
          const [y, m, d] = r.endDate.split('-').map(n => parseInt(n, 10));
          const endDate = new Date(y, m - 1, d);
          endDate.setHours(23, 59, 59, 999);
          if (now > endDate) return false;
        }
      }
      
      // Time check
      if (!r.timeAlways && (r.startTime || r.endTime)) {
        const [sh, sm] = (r.startTime || '00:00').split(':').map(n => parseInt(n || '0', 10));
        const [eh, em] = (r.endTime || '23:59').split(':').map(n => parseInt(n || '0', 10));
        const minutesNow = now.getHours() * 60 + now.getMinutes();
        const startMin = sh * 60 + sm;
        const endMin = eh * 60 + em;
        if (endMin >= startMin) {
          if (!(minutesNow >= startMin && minutesNow <= endMin)) return false;
        } else {
          if (!(minutesNow >= startMin || minutesNow <= endMin)) return false;
        }
      }
      
      return true;
    });
    
    // Return promotions (hide code for non-code promotions)
    const publicPromotions = activePromotions.map(p => ({
      id: p.id,
      name: p.name,
      hasCode: !!p.code,
      mode: p.mode,
      value: p.value,
      minSubtotal: p.minSubtotal,
      description: p.mode === 'percent' 
        ? `${p.value}% off${p.minSubtotal > 0 ? ` (min $${p.minSubtotal})` : ''}`
        : `$${p.value} off${p.minSubtotal > 0 ? ` (min $${p.minSubtotal})` : ''}`
    }));
    
    res.json({
      success: true,
      channel,
      promotions: publicPromotions
    });
  } catch (error) {
    console.error('[ONLINE ORDER] Get promotions error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 외부에서 SSE 브로드캐스트 (Menu Visibility 등)
function broadcastToRestaurant(restaurantId, data) {
  broadcastToClients(restaurantId, data);
}

/**
 * 오프라인/끊김 동안 놓친 pending 온라인 주문을 Firestore에서 한 번 당겨와 SQLite에 맞춤 (증분).
 * 리스너 재구독 직후 호출 — onSnapshot 초기 스냅샷은 new 알림을 생략하므로 DB 공백을 메움.
 */
async function catchUpPendingOnlineOrders(restaurantId) {
  if (!restaurantId) return;
  if (!networkConnectivityService.isInternetConnected()) return;
  if (!ensureFirebaseInit()) return;

  let orders;
  try {
    orders = await firebaseService.getOnlineOrders(restaurantId, { status: 'pending' });
  } catch (e) {
    console.warn('[Online] catchUpPendingOnlineOrders fetch:', e.message);
    return;
  }
  if (!Array.isArray(orders) || orders.length === 0) return;

  let inserted = 0;
  for (const order of orders) {
    if (firebaseService.isExcludedFromOnlineOrderChannel(order)) continue;

    const firebaseOrderId = order.id;
    let localOrder = null;
    let didInsertThis = false;

    const pStatus = (order.paymentStatus || 'pending').toLowerCase();
    const isPaid = pStatus === 'paid' || pStatus === 'completed' || order.paid === true;

    try {
      localOrder = await dbGet('SELECT id FROM orders WHERE firebase_order_id = ?', [firebaseOrderId]);

      const createdAt = order.createdAt?.toDate?.() || order.createdAt || new Date().toISOString();
      const createdAtStr = typeof createdAt === 'string' ? createdAt : createdAt.toISOString();
      const rf = sqliteReadyFieldsFromFirebaseOrder(order, createdAtStr);
      const onlineTipVal = parseFirebaseOrderTip(order);

      if (!localOrder) {
        const paidAtRaw = order.paidAt?.toDate?.() || order.paidAt || null;

        const result = await dbRun(
          `INSERT INTO orders (order_number, order_type, total, status, created_at, customer_phone, customer_name, firebase_order_id, payment_status, payment_method, payment_transaction_id, card_last4, paid_at, ready_time, pickup_minutes, fulfillment_mode, service_pattern, online_tip)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            null,
            'ONLINE',
            order.total || 0,
            'PENDING',
            createdAtStr,
            order.customerPhone || null,
            order.customerName || null,
            firebaseOrderId,
            isPaid ? 'paid' : pStatus,
            order.paymentMethod || 'cash',
            order.paymentTransactionId || null,
            order.cardLast4 || null,
            paidAtRaw ? (typeof paidAtRaw === 'string' ? paidAtRaw : paidAtRaw.toISOString()) : null,
            rf.readyTime || null,
            rf.pickupMinutes,
            'online',
            resolveServicePattern({ orderType: 'ONLINE', fulfillmentMode: 'online', tableId: null }),
            onlineTipVal,
          ]
        );
        localOrder = { id: result.lastID };

        if (Array.isArray(order.items)) {
          for (const item of order.items) {
            await dbRun(
              `INSERT INTO order_items (order_id, item_id, name, quantity, price)
                 VALUES (?, ?, ?, ?, ?)`,
              [localOrder.id, item.id || null, item.name || '', item.quantity || 1, item.price || 0]
            );
          }
        }
        await assignPosDailyOrderNumberToSqliteOrder(localOrder.id);
        inserted += 1;
        didInsertThis = true;
        console.log(
          `📥 catch-up 온라인 주문 SQLite 저장: id=${localOrder.id} firebase=${firebaseOrderId} | 결제: ${isPaid ? 'PAID' : pStatus}`
        );
      }
      if (localOrder?.id) {
        await syncSqliteReadyFieldsFromFirebase(localOrder.id, order, createdAtStr);
        await syncSqliteOnlineTipFromFirebase(localOrder.id, order);
      }

      if (didInsertThis && localOrder?.id) {
        const formatted = formatOrderForFrontend(order);
        formatted.localOrderId = localOrder.id;
        try {
          const r = await dbGet('SELECT order_number FROM orders WHERE id = ?', [localOrder.id]);
          if (r?.order_number) {
            formatted.posOrderNumber = r.order_number;
            formatted.orderNumber = r.order_number;
            formatted.order_number = r.order_number;
          }
        } catch {}

        broadcastToClients(restaurantId, {
          type: 'new_order',
          order: formatted,
        });
      }
    } catch (err) {
      console.warn('[Online] catchUp order:', firebaseOrderId, err.message);
    }
  }

  if (inserted > 0) {
    console.log(`[Online] catchUpPendingOnlineOrders: ${restaurantId} — ${inserted} newly inserted`);
  }
}

/**
 * 주문·온라인 설정 Firestore 리스너를 한 번 끊었다가 다시 걸고, 증분 catch-up 실행.
 */
function restartOnlineOrderListenersForRestaurant(restaurantId) {
  if (!restaurantId) return Promise.resolve();
  if (!networkConnectivityService.isInternetConnected()) {
    console.warn(`[Online] restartOnlineOrderListenersForRestaurant: offline (${restaurantId})`);
    return Promise.resolve();
  }
  ensureFirebaseInit();
  stopOrderListener(restaurantId);
  stopSettingsListener(restaurantId);
  startOrderListener(restaurantId);
  startSettingsListener(restaurantId);
  return catchUpPendingOnlineOrders(restaurantId);
}

/** 인터넷 복구 시 SSE에 연결된 레스토랑만 리스너 재시작 + 증분 catch-up */
function restartFirebaseListenersForSseClients() {
  try {
    if (!networkConnectivityService.isInternetConnected()) return;
    for (const restaurantId of sseClients.keys()) {
      const clients = sseClients.get(restaurantId);
      if (!clients || clients.size === 0) continue;
      stopOrderListener(restaurantId);
      stopSettingsListener(restaurantId);
      startOrderListener(restaurantId);
      startSettingsListener(restaurantId);
      catchUpPendingOnlineOrders(restaurantId).catch((e) =>
        console.warn('[Online] catchUpPendingOnlineOrders:', restaurantId, e.message)
      );
    }
  } catch (e) {
    console.warn('[Online] restartFirebaseListenersForSseClients:', e.message);
  }
}

module.exports = {
  router,
  startOrderListener,
  startSettingsListener,
  restartOnlineOrderListenersForRestaurant,
  catchUpPendingOnlineOrders,
  restartFirebaseListenersForSseClients,
  broadcastToRestaurant,
  stopAllFirebaseOrderListeners,
};

