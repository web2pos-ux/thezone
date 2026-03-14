// backend/services/salesSyncService.js
// 실시간 매출 Firebase 동기화 서비스

const admin = require('firebase-admin');
const path = require('path');

// Firebase 초기화 확인 (읽기 전용 리소스 경로에서 서비스 계정 키 로드)
const RESOURCES_CONFIG_DIR = path.join(__dirname, '..', 'config');

function getFirestore() {
  try {
    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert(require(path.join(RESOURCES_CONFIG_DIR, 'firebase-service-account.json')))
      });
    }
    return admin.firestore();
  } catch (error) {
    console.error('Firebase init error:', error.message);
    return null;
  }
}

// 날짜 포맷 (YYYY-MM-DD)
function getDateString(date = new Date()) {
  return date.toISOString().split('T')[0];
}

// 시간 포맷 (HH)
function getHourString(date = new Date()) {
  return String(date.getHours()).padStart(2, '0');
}

/**
 * 결제 완료 시 Firebase에 매출 데이터 동기화
 * @param {Object} orderData - 주문 정보
 * @param {Object} paymentData - 결제 정보
 * @param {string} restaurantId - Firebase 레스토랑 ID
 * @param {Object} options - { skipDailySales: true } orders 업로드 시 dailySales 중복 방지
 */
async function syncPaymentToFirebase(orderData, paymentData, restaurantId, options = {}) {
  const db = getFirestore();
  if (!db) {
    console.warn('[SalesSync] Firebase not available');
    return null;
  }

  try {
    const now = new Date();
    const dateStr = getDateString(now);
    const hourStr = getHourString(now);
    const monthStr = dateStr.substring(0, 7); // YYYY-MM

    // 레스토랑 참조
    const restaurantRef = db.collection('restaurants').doc(restaurantId);
    const skipDailySales = options.skipDailySales === true;

    // 1. 일별 매출 요약 업데이트 (skipDailySales 시 orders→aggregateDailySalesOnOrderWrite가 처리)
    if (!skipDailySales) {
    const dailySalesRef = restaurantRef.collection('dailySales').doc(dateStr);
    await db.runTransaction(async (transaction) => {
      const dailyDoc = await transaction.get(dailySalesRef);
      
      const paymentAmount = paymentData.amount || 0;
      const tipAmount = paymentData.tip || 0;
      const paymentMethod = (paymentData.method || 'CASH').toUpperCase();
      const orderType = (orderData.orderType || 'DINE-IN').toUpperCase();
      
      // 할인 정보 계산
      const discountAmount = Number(orderData.discountAmount || paymentData.discountAmount || 0);
      const discountType = orderData.discountType || paymentData.discountType || null;
      
      if (dailyDoc.exists) {
        const data = dailyDoc.data();
        
        // 기존 데이터 업데이트 (할인 정보 포함)
        const updateData = {
          totalSales: admin.firestore.FieldValue.increment(paymentAmount),
          totalTips: admin.firestore.FieldValue.increment(tipAmount),
          orderCount: admin.firestore.FieldValue.increment(1),
          [`paymentMethods.${paymentMethod}`]: admin.firestore.FieldValue.increment(paymentAmount),
          [`orderTypes.${orderType}`]: admin.firestore.FieldValue.increment(paymentAmount),
          [`hourlySales.${hourStr}`]: admin.firestore.FieldValue.increment(paymentAmount),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        };
        
        // 할인이 있는 경우 할인 필드 추가
        if (discountAmount > 0) {
          updateData.totalDiscount = admin.firestore.FieldValue.increment(discountAmount);
          updateData.discountCount = admin.firestore.FieldValue.increment(1);
        }
        
        transaction.update(dailySalesRef, updateData);
      } else {
        // 새 문서 생성 (할인 정보 포함)
        const setData = {
          date: dateStr,
          totalSales: paymentAmount,
          totalTips: tipAmount,
          orderCount: 1,
          paymentMethods: { [paymentMethod]: paymentAmount },
          orderTypes: { [orderType]: paymentAmount },
          hourlySales: { [hourStr]: paymentAmount },
          totalDiscount: discountAmount,
          discountCount: discountAmount > 0 ? 1 : 0,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        };
        
        transaction.set(dailySalesRef, setData);
      }
    });
    }

    // 2. 월별 요약 업데이트
    const monthlySalesRef = restaurantRef.collection('monthlySales').doc(monthStr);
    
    await db.runTransaction(async (transaction) => {
      const monthlyDoc = await transaction.get(monthlySalesRef);
      const paymentAmount = paymentData.amount || 0;
      const tipAmount = paymentData.tip || 0;
      
      if (monthlyDoc.exists) {
        transaction.update(monthlySalesRef, {
          totalSales: admin.firestore.FieldValue.increment(paymentAmount),
          totalTips: admin.firestore.FieldValue.increment(tipAmount),
          orderCount: admin.firestore.FieldValue.increment(1),
          [`dailySales.${dateStr}`]: admin.firestore.FieldValue.increment(paymentAmount),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
      } else {
        transaction.set(monthlySalesRef, {
          month: monthStr,
          totalSales: paymentAmount,
          totalTips: tipAmount,
          orderCount: 1,
          dailySales: { [dateStr]: paymentAmount },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    });

    // 3. 실시간 대시보드용 현재 상태 업데이트
    const realtimeRef = restaurantRef.collection('realtime').doc('today');
    
    await realtimeRef.set({
      date: dateStr,
      lastOrderTime: admin.firestore.FieldValue.serverTimestamp(),
      lastOrderAmount: paymentData.amount || 0,
      lastOrderType: orderData.orderType || 'DINE-IN',
      lastPaymentMethod: paymentData.method || 'CASH'
    }, { merge: true });

    console.log(`[SalesSync] ✅ Synced: $${paymentData.amount} (${paymentData.method}) - ${dateStr}`);
    return { success: true, date: dateStr };
    
  } catch (error) {
    console.error('[SalesSync] ❌ Sync failed:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 주문 아이템별 매출 동기화 (메뉴 분석용)
 * @param {Object} orderData - 주문 정보 (아이템 포함)
 * @param {string} restaurantId - Firebase 레스토랑 ID
 */
async function syncOrderItemsToFirebase(orderData, restaurantId) {
  const db = getFirestore();
  if (!db || !orderData.items || !Array.isArray(orderData.items)) {
    return null;
  }

  try {
    const dateStr = getDateString();
    const restaurantRef = db.collection('restaurants').doc(restaurantId);
    const itemSalesRef = restaurantRef.collection('dailyItemSales').doc(dateStr);

    const batch = db.batch();
    
    // 아이템별 판매량 집계
    const itemUpdates = {};
    for (const item of orderData.items) {
      const itemId = String(item.id || item.itemId || item.menu_item_id);
      const itemName = item.name || item.itemName || 'Unknown';
      const quantity = item.quantity || 1;
      const price = item.price || 0;
      const total = quantity * price;

      if (!itemUpdates[itemId]) {
        itemUpdates[itemId] = { name: itemName, quantity: 0, sales: 0 };
      }
      itemUpdates[itemId].quantity += quantity;
      itemUpdates[itemId].sales += total;
    }

    // Firestore 업데이트
    await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(itemSalesRef);
      
      if (doc.exists) {
        const data = doc.data();
        const items = data.items || {};
        
        for (const [itemId, update] of Object.entries(itemUpdates)) {
          if (items[itemId]) {
            items[itemId].quantity += update.quantity;
            items[itemId].sales += update.sales;
          } else {
            items[itemId] = update;
          }
        }
        
        transaction.update(itemSalesRef, {
          items,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
      } else {
        transaction.set(itemSalesRef, {
          date: dateStr,
          items: itemUpdates,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    });

    console.log(`[SalesSync] ✅ Item sales synced: ${Object.keys(itemUpdates).length} items`);
    return { success: true };
    
  } catch (error) {
    console.error('[SalesSync] ❌ Item sync failed:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 일별 매출 데이터 조회 (TZO용)
 * @param {string} restaurantId - Firebase 레스토랑 ID
 * @param {string} date - 날짜 (YYYY-MM-DD)
 */
async function getDailySales(restaurantId, date = null) {
  const db = getFirestore();
  if (!db) return null;

  try {
    const dateStr = date || getDateString();
    const restaurantRef = db.collection('restaurants').doc(restaurantId);
    const dailySalesRef = restaurantRef.collection('dailySales').doc(dateStr);
    
    const doc = await dailySalesRef.get();
    
    if (doc.exists) {
      return { success: true, data: doc.data() };
    } else {
      return { success: true, data: null, message: 'No data for this date' };
    }
  } catch (error) {
    console.error('[SalesSync] ❌ Get daily sales failed:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 월별 매출 데이터 조회 (TZO용)
 * @param {string} restaurantId - Firebase 레스토랑 ID
 * @param {string} month - 월 (YYYY-MM)
 */
async function getMonthlySales(restaurantId, month = null) {
  const db = getFirestore();
  if (!db) return null;

  try {
    const monthStr = month || getDateString().substring(0, 7);
    const restaurantRef = db.collection('restaurants').doc(restaurantId);
    const monthlySalesRef = restaurantRef.collection('monthlySales').doc(monthStr);
    
    const doc = await monthlySalesRef.get();
    
    if (doc.exists) {
      return { success: true, data: doc.data() };
    } else {
      return { success: true, data: null, message: 'No data for this month' };
    }
  } catch (error) {
    console.error('[SalesSync] ❌ Get monthly sales failed:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 테이블 머지/이동 히스토리를 Firebase에 동기화
 * @param {Object} mergeData - 머지/이동 정보
 * @param {string} restaurantId - Firebase 레스토랑 ID
 */
async function syncTableMergeToFirebase(mergeData, restaurantId) {
  const db = getFirestore();
  if (!db) {
    console.warn('[SalesSync] Firebase not available for table merge sync');
    return null;
  }

  try {
    const now = new Date();
    const dateStr = getDateString(now);
    const restaurantRef = db.collection('restaurants').doc(restaurantId);
    
    // 테이블 머지/이동 히스토리 컬렉션에 기록
    const mergeHistoryRef = restaurantRef.collection('tableMergeHistory').doc();
    
    await mergeHistoryRef.set({
      date: dateStr,
      actionType: mergeData.actionType || 'MERGE', // 'MERGE' or 'MOVE'
      fromTableId: mergeData.fromTableId,
      toTableId: mergeData.toTableId,
      floor: mergeData.floor || '1F',
      fromOrderId: mergeData.fromOrderId || null,
      toOrderId: mergeData.toOrderId || null,
      movedItemCount: mergeData.movedItemCount || 0,
      partial: mergeData.partial || false,
      performedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 일별 머지/이동 카운트 업데이트
    const dailyStatsRef = restaurantRef.collection('dailyTableStats').doc(dateStr);
    
    await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(dailyStatsRef);
      const actionField = mergeData.actionType === 'MOVE' ? 'moveCount' : 'mergeCount';
      
      if (doc.exists) {
        transaction.update(dailyStatsRef, {
          [actionField]: admin.firestore.FieldValue.increment(1),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
      } else {
        transaction.set(dailyStatsRef, {
          date: dateStr,
          mergeCount: mergeData.actionType === 'MERGE' ? 1 : 0,
          moveCount: mergeData.actionType === 'MOVE' ? 1 : 0,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    });

    console.log(`[SalesSync] ✅ Table ${mergeData.actionType} synced: ${mergeData.fromTableId} → ${mergeData.toTableId}`);
    return { success: true };
    
  } catch (error) {
    console.error('[SalesSync] ❌ Table merge sync failed:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  syncPaymentToFirebase,
  syncOrderItemsToFirebase,
  syncTableMergeToFirebase,
  getDailySales,
  getMonthlySales
};
