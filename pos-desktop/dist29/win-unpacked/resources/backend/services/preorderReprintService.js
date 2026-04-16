/**
 * Pre Order / 장기 픽업 주문 — 픽업 30분 전 키친 자동 재출력 스케줄
 * (Utility 설정 preOrderReprint.enabled 가 true 일 때만)
 */

const http = require('http');
const { getLocalDatetimeString } = require('../utils/datetimeUtils');
const firebaseService = require('./firebaseService');

let tableReady = false;

function orderCreatedMs(order) {
  const c = order.createdAt;
  if (c && typeof c.toDate === 'function') return c.toDate().getTime();
  if (c && typeof c._seconds === 'number') return c._seconds * 1000;
  if (typeof c === 'string' || c instanceof Date) {
    const t = new Date(c).getTime();
    return Number.isFinite(t) ? t : Date.now();
  }
  return Date.now();
}

/** YYYY-MM-DD HH:mm:ss 로컬 문자열 → epoch ms */
function parseLocalPickupMs(str) {
  if (!str || typeof str !== 'string') return null;
  const m = str.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2] - 1;
  const d = +m[3];
  const h = +m[4];
  const mi = +m[5];
  const s = m[6] != null ? +m[6] : 0;
  const t = new Date(y, mo, d, h, mi, s).getTime();
  return Number.isFinite(t) ? t : null;
}

function isOnlineOrDeliveryOrder(order) {
  const ot = String(order.orderType || order.type || '').toLowerCase();
  if (ot === 'delivery') return true;
  if (ot === 'pickup' || ot === 'online' || ot === 'takeout' || ot === 'togo') return true;
  const ch = String(order.channel || '').toLowerCase();
  if (ch === 'delivery' || ch === 'online') return true;
  return false;
}

function isPreOrderFlags(order) {
  if (order.isPreOrder === true || order.preOrder === true) return true;
  if (order.is_scheduled === true || order.scheduled === true) return true;
  const mode = String(order.orderMode || order.timing || order.orderTiming || '').toLowerCase();
  if (mode.includes('pre') || mode.includes('schedule') || mode === 'later') return true;
  return false;
}

function resolvePickupMs(order, afterAcceptMs) {
  const fromPickup = parseLocalPickupMs(order.pickupTime) || parseLocalPickupMs(order.readyTime);
  if (fromPickup != null) return fromPickup;
  const prep = Number(order.prepTime || order.prep_time || 20) || 20;
  return afterAcceptMs + prep * 60000;
}

function qualifiesForSchedule(order, pickupMs, createdMs) {
  if (!isOnlineOrDeliveryOrder(order)) return false;
  const longLead = pickupMs - createdMs >= 2 * 60 * 60 * 1000;
  return longLead || isPreOrderFlags(order);
}

/** online-orders print 경로와 동일: SQLite 일일 order_number 우선 */
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

async function ensureTable(dbRun) {
  if (tableReady) return;
  await dbRun(`
    CREATE TABLE IF NOT EXISTS preorder_reprint_schedule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firebase_order_id TEXT NOT NULL UNIQUE,
      restaurant_id TEXT,
      trigger_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  tableReady = true;
}

/**
 * 온라인 주문 print 핸들러와 동일하게 printItems 구성 + print-order 페이로드
 */
async function buildPrintPayloadFromFirebaseOrder(order, localOrder, dbGet, dbAll, firebaseDocId) {
  const printItems = [];
  for (const item of order.items || []) {
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
        printerGroupIds = itemPrinterLinks.map((l) => l.printer_group_id);
      } else if (categoryId) {
        const categoryPrinterLinks = await dbAll(
          'SELECT printer_group_id FROM category_printer_links WHERE category_id = ?',
          [categoryId]
        );
        if (categoryPrinterLinks && categoryPrinterLinks.length > 0) {
          printerGroupIds = categoryPrinterLinks.map((l) => l.printer_group_id);
        }
      }
    }
    if (printerGroupIds.length === 0) {
      const defaultGroup = await dbGet(
        "SELECT printer_group_id FROM printer_groups WHERE name = 'Kitchen' AND is_active = 1 LIMIT 1"
      );
      if (defaultGroup && defaultGroup.printer_group_id != null) printerGroupIds.push(defaultGroup.printer_group_id);
    }
    printItems.push({
      id: itemId || 0,
      name: item.name || 'Unknown Item',
      quantity: item.quantity || 1,
      price: item.price || 0,
      printerGroupIds,
      modifiers: (item.options || []).map((opt) => ({
        name: opt.choiceName || opt.name || '',
        price: opt.price || 0,
      })),
      specialInstructions: item.specialInstructions || '',
    });
  }

  const prepTime = order.prepTime || order.prep_time || 20;
  const pickupDate = new Date(parseLocalPickupMs(order.pickupTime) || Date.now());
  const pickupTimeStr = Number.isFinite(pickupDate.getTime())
    ? pickupDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    : new Date(Date.now() + prepTime * 60000).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });

  const pStatusLower = String(order.paymentStatus || '').toLowerCase();
  const orderIsPaid =
    order.status === 'paid' ||
    pStatusLower === 'paid' ||
    pStatusLower === 'completed' ||
    order.paid === true ||
    order.isPaid === true;

  const fidForHeader =
    firebaseDocId != null && String(firebaseDocId).trim() !== ''
      ? String(firebaseDocId).trim()
      : order.id != null
        ? String(order.id)
        : '';
  const localOrderNumber = resolveOnlineKitchenOrderNumberHeader(localOrder, order, fidForHeader);
  const tableVal =
    order.orderType === 'pickup' ? 'PICKUP' : order.orderType === 'delivery' ? 'DELIVERY' : 'ONLINE';

  return {
    orderInfo: {
      orderNumber: localOrderNumber,
      externalOrderNumber: localOrderNumber,
      orderType: 'ONLINE',
      table: tableVal,
      customerName: order.customerName || '',
      customerPhone: order.customerPhone || '',
      notes: order.notes || '',
      specialInstructions: order.notes || order.specialInstructions || '',
      channel: 'THEZONE',
      deliveryChannel: 'THEZONE',
      orderSource: 'THEZONE',
      firebaseOrderNumber: order.orderNumber,
      prepTime,
      pickupMinutes: prepTime,
      pickupTime: pickupTimeStr,
    },
    items: printItems,
    isAdditionalOrder: false,
    isPaid: orderIsPaid,
    isReprint: true,
    reprintBannerText: 'Pre Order Reprint',
  };
}

function postPrintOrder(port, bodyObj) {
  const body = JSON.stringify(bodyObj);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: port || 3177,
        path: '/api/printers/print-order',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
          else reject(new Error(`print-order ${res.statusCode}: ${data}`));
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * 주문 수락 직후: Utility 설정이 켜져 있고 조건 충족 시 스케줄 등록
 */
async function onOnlineOrderAccepted({ dbRun, dbGet, restaurantId, orderId }) {
  try {
    await ensureTable(dbRun);
    if (!restaurantId || !orderId) return;

    const util = await firebaseService.getUtilitySettings(restaurantId);
    if (!util?.preOrderReprint?.enabled) return;

    const order = await firebaseService.getOrderById(orderId, restaurantId);
    if (!order) return;

    const nowMs = Date.now();
    const createdMs = orderCreatedMs(order);
    const pickupMs = resolvePickupMs(order, nowMs);
    if (!qualifiesForSchedule(order, pickupMs, createdMs)) return;

    const triggerMs = pickupMs - 30 * 60 * 1000;
    const triggerAt = getLocalDatetimeString(new Date(Math.max(triggerMs, nowMs)));

    await dbRun(
      `INSERT INTO preorder_reprint_schedule (firebase_order_id, restaurant_id, trigger_at, status)
       VALUES (?, ?, ?, 'pending')
       ON CONFLICT(firebase_order_id) DO UPDATE SET
         trigger_at = excluded.trigger_at,
         restaurant_id = excluded.restaurant_id,
         status = 'pending'`,
      [String(orderId), String(restaurantId), triggerAt]
    );
    console.log(`[PreOrderReprint] Scheduled firebase ${orderId} trigger_at=${triggerAt}`);
  } catch (e) {
    console.warn('[PreOrderReprint] onOnlineOrderAccepted:', e && e.message);
  }
}

const SKIP_PRINT_STATUSES = new Set(['cancelled', 'canceled', 'rejected', 'picked_up', 'completed', 'void', 'voided']);

/**
 * 주기적으로 due 스케줄을 찾아 키친 출력
 */
async function tick({ dbRun, dbGet, dbAll, port }) {
  try {
    await ensureTable(dbRun);
    const nowStr = getLocalDatetimeString(new Date());
    const rows = await dbAll(
      `SELECT id, firebase_order_id, restaurant_id FROM preorder_reprint_schedule
       WHERE status = 'pending' AND trigger_at <= ? ORDER BY trigger_at ASC LIMIT 8`,
      [nowStr]
    );
    if (!rows || rows.length === 0) return;

    for (const row of rows) {
      const fid = row.firebase_order_id;
      const rid = row.restaurant_id;
      try {
        const order = await firebaseService.getOrderById(fid, rid || null);
        if (!order) {
          await dbRun(`UPDATE preorder_reprint_schedule SET status = 'cancelled' WHERE id = ?`, [row.id]);
          continue;
        }
        const st = String(order.status || '').toLowerCase();
        if (SKIP_PRINT_STATUSES.has(st)) {
          await dbRun(`UPDATE preorder_reprint_schedule SET status = 'cancelled' WHERE id = ?`, [row.id]);
          continue;
        }

        const localOrder = await dbGet('SELECT id, order_number FROM orders WHERE firebase_order_id = ?', [fid]);
        const payload = await buildPrintPayloadFromFirebaseOrder(order, localOrder, dbGet, dbAll, fid);
        if (!payload.items || payload.items.length === 0) {
          await dbRun(`UPDATE preorder_reprint_schedule SET status = 'cancelled' WHERE id = ?`, [row.id]);
          continue;
        }
        await postPrintOrder(port, payload);
        await dbRun(`UPDATE preorder_reprint_schedule SET status = 'fired' WHERE id = ?`, [row.id]);
        console.log(`[PreOrderReprint] Printed kitchen reprint for ${fid}`);
      } catch (jobErr) {
        console.warn(`[PreOrderReprint] Job ${row.id} failed:`, jobErr && jobErr.message);
      }
    }
  } catch (e) {
    console.warn('[PreOrderReprint] tick:', e && e.message);
  }
}

module.exports = {
  onOnlineOrderAccepted,
  tick,
  ensureTable,
};
