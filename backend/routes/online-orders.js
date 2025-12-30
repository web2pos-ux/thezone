// backend/routes/online-orders.js
// 온라인 주문 API 라우트

const express = require('express');
const router = express.Router();
const firebaseService = require('../services/firebaseService');
const { dbRun, dbGet, dbAll } = require('../db');

// ============================================
// Day Off 테이블 초기화
// ============================================
async function initDayOffTable() {
  try {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS online_day_off (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        date TEXT NOT NULL,
        schedule_type TEXT NOT NULL CHECK(schedule_type IN ('closed', 'early_close', 'late_open', 'extended')),
        time TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(channel, date)
      )
    `);
    console.log('✅ online_day_off 테이블 준비 완료');
  } catch (error) {
    console.error('❌ online_day_off 테이블 생성 실패:', error.message);
  }
}

// ============================================
// Prep Time 테이블 초기화
// ============================================
async function initPrepTimeTable() {
  try {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS online_prep_time (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        restaurant_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        mode TEXT NOT NULL CHECK(mode IN ('auto', 'manual')),
        time TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(restaurant_id, channel)
      )
    `);
    console.log('✅ online_prep_time 테이블 준비 완료');
  } catch (error) {
    console.error('❌ online_prep_time 테이블 생성 실패:', error.message);
  }
}

// ============================================
// Pause 테이블 초기화
// ============================================
async function initPauseTable() {
  try {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS online_pause (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        restaurant_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        paused INTEGER NOT NULL DEFAULT 0,
        pause_until TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(restaurant_id, channel)
      )
    `);
    console.log('✅ online_pause 테이블 준비 완료');
  } catch (error) {
    console.error('❌ online_pause 테이블 생성 실패:', error.message);
  }
}

// 서버 시작 시 테이블 초기화
initDayOffTable();
initPrepTimeTable();
initPauseTable();

// 활성 리스너 저장 (레스토랑별)
const activeListeners = new Map();

// 연결된 SSE 클라이언트들
const sseClients = new Map();

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

  // 연결 종료 시 정리
  req.on('close', () => {
    console.log(`📡 SSE 클라이언트 연결 해제: ${clientId}`);
    if (sseClients.has(restaurantId)) {
      sseClients.get(restaurantId).delete(clientId);
      
      // 해당 레스토랑에 연결된 클라이언트가 없으면 리스너 중지
      if (sseClients.get(restaurantId).size === 0) {
        stopOrderListener(restaurantId);
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

  console.log(`👂 주문 리스너 시작: ${restaurantId}`);

  const unsubscribe = firebaseService.listenToOnlineOrders(restaurantId, {
    onNewOrder: async (order) => {
      // SQLite에 저장하고 localOrderId 생성
      const firebaseOrderId = order.id;
      let localOrder = null;
      
      try {
        // 이미 저장된 주문인지 확인
        localOrder = await dbGet(
          'SELECT id FROM orders WHERE firebase_order_id = ?',
          [firebaseOrderId]
        );
        
        // 없으면 새로 생성
        if (!localOrder) {
          const createdAt = order.createdAt?.toDate?.() || order.createdAt || new Date().toISOString();
          const orderNumber = order.orderNumber || `ONLINE-${Date.now()}`;
          
          const result = await dbRun(
            `INSERT INTO orders (order_number, order_type, total, status, created_at, customer_phone, customer_name, firebase_order_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              orderNumber,
              'ONLINE',
              order.total || 0,
              'PENDING',
              typeof createdAt === 'string' ? createdAt : createdAt.toISOString(),
              order.customerPhone || null,
              order.customerName || null,
              firebaseOrderId
            ]
          );
          localOrder = { id: result.lastID };
          
          // 주문 아이템도 저장
          if (Array.isArray(order.items)) {
            for (const item of order.items) {
              // 테이블 오더의 options를 modifiers_json 형식으로 변환
              let modifiersJson = null;
              if (Array.isArray(item.options) && item.options.length > 0) {
                // item.options: [{ optionName, choiceName, price }] → modifiers 형식으로 변환
                const modifiers = item.options.map(opt => ({
                  name: opt.choiceName || opt.name,
                  groupName: opt.optionName,
                  price: opt.price || 0
                }));
                modifiersJson = JSON.stringify(modifiers);
              }
              
              await dbRun(
                `INSERT INTO order_items (order_id, item_id, name, quantity, price, modifiers_json)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [localOrder.id, item.id || null, item.name || '', item.quantity || 1, item.price || 0, modifiersJson]
              );
            }
          }
          console.log(`📦 새 온라인 주문 SQLite 저장: #${localOrder.id}`);
          
          // POS 수신 확인을 Firebase에 업데이트 (테이블 디바이스에 알림)
          try {
            await firebaseService.confirmPosReceived(firebaseOrderId);
          } catch (confirmError) {
            console.error('POS 수신 확인 Firebase 업데이트 실패:', confirmError.message);
          }
        }
      } catch (saveError) {
        console.error('SSE 온라인 주문 SQLite 저장 실패:', saveError.message);
      }
      
      // localOrderId 포함하여 브로드캐스트
      const formatted = formatOrderForFrontend(order);
      formatted.localOrderId = localOrder?.id || null;
      
      broadcastToClients(restaurantId, {
        type: 'new_order',
        order: formatted
      });
    },
    onOrderUpdate: (order) => {
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
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    orderType: order.orderType, // pickup, delivery, dine_in
    status: order.status,
    items: order.items || [],
    subtotal: order.subtotal,
    tax: order.tax,
    total: order.total,
    notes: order.notes,
    createdAt: order.createdAt?.toDate?.() || order.createdAt,
    updatedAt: order.updatedAt?.toDate?.() || order.updatedAt
  };
}

// ============================================
// REST API 엔드포인트
// ============================================

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

    // 각 온라인 주문에 대해 SQLite ID를 조회하거나 생성
    const ordersWithLocalId = await Promise.all(orders.map(async (order) => {
      const firebaseOrderId = order.id;
      
      // 이미 SQLite에 저장된 주문인지 확인
      let localOrder = await dbGet(
        'SELECT id FROM orders WHERE firebase_order_id = ?',
        [firebaseOrderId]
      );
      
      // 없으면 새로 생성
      if (!localOrder) {
        const createdAt = order.createdAt?.toDate?.() || order.createdAt || new Date().toISOString();
        const orderNumber = order.orderNumber || `ONLINE-${Date.now()}`;
        
        try {
          const result = await dbRun(
            `INSERT INTO orders (order_number, order_type, total, status, created_at, customer_phone, customer_name, firebase_order_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              orderNumber,
              'ONLINE',
              order.total || 0,
              'PENDING',
              typeof createdAt === 'string' ? createdAt : createdAt.toISOString(),
              order.customerPhone || null,
              order.customerName || null,
              firebaseOrderId
            ]
          );
          localOrder = { id: result.lastID };
          
          // 주문 아이템도 저장
          if (Array.isArray(order.items)) {
            for (const item of order.items) {
              await dbRun(
                `INSERT INTO order_items (order_id, item_id, name, quantity, price)
                 VALUES (?, ?, ?, ?, ?)`,
                [localOrder.id, item.id || null, item.name || '', item.quantity || 1, item.price || 0]
              );
            }
          }
        } catch (insertError) {
          console.error('온라인 주문 SQLite 저장 실패:', insertError.message);
          // 저장 실패해도 계속 진행 (Firebase ID 사용)
        }
      }
      
      const formatted = formatOrderForFrontend(order);
      formatted.localOrderId = localOrder?.id || null;
      return formatted;
    }));

    res.json({
      success: true,
      orders: ordersWithLocalId
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
    const order = await firebaseService.getOrderById(orderId);

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
    const result = await firebaseService.updateOrderStatus(orderId, 'cancelled');

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
    const result = await firebaseService.updateOrderStatus(orderId, 'picked_up');

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
    const { prepTime, pickupTime } = req.body;
    
    console.log(`[ACCEPT] orderId: ${orderId}, prepTime: ${prepTime}, pickupTime: ${pickupTime}`);

    // Firebase 상태 업데이트 (confirmed + pickupTime)
    const result = await firebaseService.acceptOrder(orderId, prepTime, pickupTime);

    res.json({
      success: true,
      message: '주문이 수락되었습니다',
      prepTime,
      pickupTime,
      ...result
    });
  } catch (error) {
    console.error('주문 수락 실패:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 주문 거절 (pending → cancelled)
router.post('/order/:orderId/reject', async (req, res) => {
  try {
    if (!ensureFirebaseInit()) {
      return res.status(500).json({ success: false, error: 'Firebase not initialized' });
    }

    const { orderId } = req.params;
    const result = await firebaseService.updateOrderStatus(orderId, 'cancelled');

    res.json({
      success: true,
      message: '주문이 거절되었습니다',
      ...result
    });
  } catch (error) {
    console.error('주문 거절 실패:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// 프린터 출력 (온라인 주문용)
// ============================================

// 온라인 주문 영수증 출력
router.post('/order/:orderId/print', async (req, res) => {
  try {
    if (!ensureFirebaseInit()) {
      return res.status(500).json({ success: false, error: 'Firebase not initialized' });
    }

    const { orderId } = req.params;
    const { printerType = 'both' } = req.body; // 'kitchen', 'front', 'both'

    const order = await firebaseService.getOrderById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    const restaurant = await firebaseService.getRestaurantById(order.restaurantId);
    const restaurantName = restaurant?.name || '레스토랑';

    // 영수증 포맷 생성
    const receipt = generateReceipt(order, restaurantName);

    console.log('🖨️ 온라인 주문 출력:', order.orderNumber);
    console.log(receipt);

    // TODO: 실제 프린터 출력 로직 연동
    // 여기서는 콘솔 출력만 수행

    res.json({
      success: true,
      message: '출력 요청이 전송되었습니다',
      orderNumber: order.orderNumber,
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
    // SQLite에 저장 (UPSERT)
    for (const channel of channels) {
      await dbRun(`
        INSERT INTO online_pause (restaurant_id, channel, paused, pause_until, updated_at)
        VALUES (?, ?, 1, ?, datetime('now'))
        ON CONFLICT(restaurant_id, channel) 
        DO UPDATE SET paused = 1, pause_until = excluded.pause_until, updated_at = datetime('now')
      `, [restaurantId, channel, pauseUntil]);
    }
    console.log('[PAUSE] SQLite 저장 완료');

    // Firebase restaurantSettings에 Pause 상태 저장 (TZO 호환)
    await firebaseService.updateRestaurantPause(restaurantId, pauseUntil, channels);
    console.log('[PAUSE] Firebase 저장 완료');
    
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
    // SQLite에서 Pause 해제
    for (const channel of channels) {
      await dbRun(`
        INSERT INTO online_pause (restaurant_id, channel, paused, pause_until, updated_at)
        VALUES (?, ?, 0, NULL, datetime('now'))
        ON CONFLICT(restaurant_id, channel) 
        DO UPDATE SET paused = 0, pause_until = NULL, updated_at = datetime('now')
      `, [restaurantId, channel]);
    }
    console.log('[RESUME] SQLite 업데이트 완료');

    // Firebase restaurantSettings에서 Pause 상태 해제 (TZO 호환)
    await firebaseService.updateRestaurantPause(restaurantId, null, channels);
    console.log('[RESUME] Firebase 업데이트 완료');
    
    res.json({ success: true, message: 'Resumed successfully', channels });
  } catch (error) {
    console.error('[RESUME] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Pause 상태 조회
router.get('/pause/:restaurantId', async (req, res) => {
  const { restaurantId } = req.params;

  try {
    // SQLite에서 조회
    const rows = await dbAll('SELECT channel, paused, pause_until FROM online_pause WHERE restaurant_id = ?', [restaurantId]);
    
    const pauseSettings = {
      thezoneorder: { paused: false, pauseUntil: null },
      ubereats: { paused: false, pauseUntil: null },
      doordash: { paused: false, pauseUntil: null },
      skipthedishes: { paused: false, pauseUntil: null }
    };

    if (rows && rows.length > 0) {
      for (const row of rows) {
        pauseSettings[row.channel] = { 
          paused: row.paused === 1, 
          pauseUntil: row.pause_until 
        };
      }
      return res.json({ success: true, pauseSettings, source: 'sqlite' });
    }

    res.json({ success: true, pauseSettings, source: 'default' });
  } catch (error) {
    console.error('[PAUSE] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// Prep Time 관리 API
// ============================================

// Prep Time 저장
router.post('/preptime/:restaurantId', async (req, res) => {
  const { restaurantId } = req.params;
  const { prepTimeSettings } = req.body;

  console.log(`[PREPTIME] 레스토랑 ${restaurantId} Prep Time 저장:`, prepTimeSettings);

  if (!ensureFirebaseInit()) {
    return res.status(500).json({ success: false, error: 'Firebase not initialized' });
  }

  try {
    // SQLite에 저장 (UPSERT)
    const channels = ['thezoneorder', 'ubereats', 'doordash', 'skipthedishes'];
    for (const channel of channels) {
      if (prepTimeSettings[channel]) {
        await dbRun(`
          INSERT INTO online_prep_time (restaurant_id, channel, mode, time, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'))
          ON CONFLICT(restaurant_id, channel) 
          DO UPDATE SET mode = excluded.mode, time = excluded.time, updated_at = datetime('now')
        `, [restaurantId, channel, prepTimeSettings[channel].mode, prepTimeSettings[channel].time]);
      }
    }
    console.log('[PREPTIME] SQLite 저장 완료');

    // Firebase restaurantSettings에 Prep Time 저장
    await firebaseService.updatePrepTimeSettings(restaurantId, prepTimeSettings);
    console.log('[PREPTIME] Firebase 저장 완료');
    
    res.json({ success: true, message: 'Prep Time saved successfully' });
  } catch (error) {
    console.error('[PREPTIME] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Prep Time 조회
router.get('/preptime/:restaurantId', async (req, res) => {
  const { restaurantId } = req.params;

  try {
    // SQLite에서 먼저 조회
    const rows = await dbAll('SELECT channel, mode, time FROM online_prep_time WHERE restaurant_id = ?', [restaurantId]);
    
    if (rows && rows.length > 0) {
      const prepTimeSettings = {
        thezoneorder: { mode: 'auto', time: '15m' },
        ubereats: { mode: 'auto', time: '15m' },
        doordash: { mode: 'auto', time: '15m' },
        skipthedishes: { mode: 'auto', time: '15m' }
      };
      for (const row of rows) {
        prepTimeSettings[row.channel] = { mode: row.mode, time: row.time };
      }
      return res.json({ success: true, prepTimeSettings, source: 'sqlite' });
    }

    // SQLite에 없으면 Firebase에서 조회
    if (ensureFirebaseInit()) {
      const prepTimeSettings = await firebaseService.getPrepTimeSettings(restaurantId);
      return res.json({ success: true, prepTimeSettings, source: 'firebase' });
    }

    // 기본값 반환
    res.json({ 
      success: true, 
      prepTimeSettings: {
        thezoneorder: { mode: 'auto', time: '15m' },
        ubereats: { mode: 'auto', time: '15m' },
        doordash: { mode: 'auto', time: '15m' },
        skipthedishes: { mode: 'auto', time: '15m' }
      },
      source: 'default'
    });
  } catch (error) {
    console.error('[PREPTIME] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// Day Off 관리 API
// ============================================

// Day Off 목록 조회 (지난 스케줄 자동 삭제 후 반환)
router.get('/dayoff/:restaurantId', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // 지난 스케줄 삭제 (SQLite)
    const deleteResult = await dbRun('DELETE FROM online_day_off WHERE date < ?', [today]);
    if (deleteResult.changes > 0) {
      console.log(`[DAYOFF] 지난 스케줄 ${deleteResult.changes}개 자동 삭제됨`);
      
      // Firebase에서도 삭제
      const { restaurantId } = req.params;
      if (ensureFirebaseInit()) {
        try {
          await firebaseService.cleanupPastDayOffs(restaurantId, today);
        } catch (fbError) {
          console.error('[DAYOFF] Firebase 지난 스케줄 삭제 실패:', fbError.message);
        }
      }
    }
    
    // 남은 스케줄 반환
    const rows = await dbAll('SELECT * FROM online_day_off ORDER BY date ASC');
    res.json({ success: true, dayoffs: rows });
  } catch (error) {
    console.error('[DAYOFF GET] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Day Off 저장 (단일 또는 다중)
router.post('/dayoff/:restaurantId', async (req, res) => {
  const { restaurantId } = req.params;
  const { dayoffs } = req.body;

  console.log(`[DAYOFF SAVE] 레스토랑 ${restaurantId} Day Off 저장 요청:`, dayoffs);

  if (!Array.isArray(dayoffs) || dayoffs.length === 0) {
    return res.status(400).json({ success: false, error: 'dayoffs array is required' });
  }

  try {
    // SQLite에 저장 (UPSERT)
    for (const dayoff of dayoffs) {
      const { channel, date, scheduleType, time } = dayoff;
      
      if (!channel || !date || !scheduleType) {
        continue; // 필수 필드 누락 시 건너뛰기
      }

      await dbRun(
        `INSERT INTO online_day_off (channel, date, schedule_type, time, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(channel, date) DO UPDATE SET
           schedule_type = excluded.schedule_type,
           time = excluded.time,
           updated_at = CURRENT_TIMESTAMP`,
        [channel, date, scheduleType, time || null]
      );
    }

    // Firebase에도 동기화
    if (ensureFirebaseInit()) {
      try {
        await firebaseService.updateDayOffSettings(restaurantId, dayoffs);
      } catch (fbError) {
        console.error('[DAYOFF] Firebase 동기화 실패:', fbError.message);
        // Firebase 실패해도 로컬 저장은 성공으로 처리
      }
    }

    res.json({ success: true, message: `${dayoffs.length} day off settings saved` });
  } catch (error) {
    console.error('[DAYOFF SAVE] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Day Off 삭제
router.delete('/dayoff/:restaurantId', async (req, res) => {
  const { restaurantId } = req.params;
  const { channel, date } = req.body;

  console.log(`[DAYOFF DELETE] 레스토랑 ${restaurantId} Day Off 삭제 요청:`, { channel, date });

  if (!channel || !date) {
    return res.status(400).json({ success: false, error: 'channel and date are required' });
  }

  try {
    await dbRun(
      'DELETE FROM online_day_off WHERE channel = ? AND date = ?',
      [channel, date]
    );

    // Firebase에서도 삭제
    if (ensureFirebaseInit()) {
      try {
        await firebaseService.deleteDayOffSetting(restaurantId, channel, date);
      } catch (fbError) {
        console.error('[DAYOFF] Firebase 삭제 실패:', fbError.message);
      }
    }

    res.json({ success: true, message: 'Day off setting deleted' });
  } catch (error) {
    console.error('[DAYOFF DELETE] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Day Off 전체 삭제 (특정 채널)
router.delete('/dayoff/:restaurantId/channel/:channel', async (req, res) => {
  const { restaurantId, channel } = req.params;

  console.log(`[DAYOFF DELETE ALL] 레스토랑 ${restaurantId} 채널 ${channel} 전체 삭제`);

  try {
    await dbRun('DELETE FROM online_day_off WHERE channel = ?', [channel]);

    if (ensureFirebaseInit()) {
      try {
        await firebaseService.clearDayOffSettings(restaurantId, channel);
      } catch (fbError) {
        console.error('[DAYOFF] Firebase 전체 삭제 실패:', fbError.message);
      }
    }

    res.json({ success: true, message: `All day off settings for ${channel} deleted` });
  } catch (error) {
    console.error('[DAYOFF DELETE ALL] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = {
  router,
  startOrderListener
};

