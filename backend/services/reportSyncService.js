// backend/services/reportSyncService.js
// 레포트 데이터 Firebase 동기화 서비스

const admin = require('firebase-admin');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const networkConnectivity = require('./networkConnectivityService');

// 데이터베이스 연결
const getDatabase = () => {
  const dbPath = path.join(__dirname, '..', '..', 'db', 'web2pos.db');
  return new sqlite3.Database(dbPath);
};

// Firebase 초기화 확인
const getFirestore = () => {
  try {
    if (!networkConnectivity.isInternetConnected()) {
      return null;
    }
    if (admin.apps.length === 0) {
      // Firebase 초기화가 안 되어 있으면 null 반환
      console.log('Firebase not initialized, skipping sync');
      return null;
    }
    return admin.firestore();
  } catch (error) {
    console.error('Firebase Firestore error:', error);
    return null;
  }
};

// ==================== 레포트 동기화 함수 ====================

/**
 * 일일 레포트를 Firebase에 동기화
 * @param {string} storeId - 매장 ID
 * @param {string} date - 날짜 (YYYY-MM-DD)
 */
async function syncDailyReportToFirebase(storeId, date) {
  const db = getFirestore();
  if (!db) return null;
  
  try {
    const reportData = await generateDailyReportData(date);
    
    const docRef = db.collection('stores')
      .doc(storeId)
      .collection('reports')
      .doc('daily')
      .collection(date.substring(0, 7)) // YYYY-MM
      .doc(date);
    
    await docRef.set({
      ...reportData,
      syncedAt: admin.firestore.FieldValue.serverTimestamp(),
      storeId,
      date
    }, { merge: true });
    
    console.log(`✅ Daily report synced to Firebase: ${date}`);
    return reportData;
  } catch (error) {
    console.error('Failed to sync daily report:', error);
    throw error;
  }
}

/**
 * 월간 레포트 요약을 Firebase에 동기화
 * @param {string} storeId - 매장 ID  
 * @param {string} yearMonth - 월 (YYYY-MM)
 */
async function syncMonthlyReportToFirebase(storeId, yearMonth) {
  const db = getFirestore();
  if (!db) return null;
  
  try {
    const reportData = await generateMonthlyReportData(yearMonth);
    
    const docRef = db.collection('stores')
      .doc(storeId)
      .collection('reports')
      .doc('monthly')
      .collection(yearMonth.substring(0, 4)) // YYYY
      .doc(yearMonth);
    
    await docRef.set({
      ...reportData,
      syncedAt: admin.firestore.FieldValue.serverTimestamp(),
      storeId,
      yearMonth
    }, { merge: true });
    
    console.log(`✅ Monthly report synced to Firebase: ${yearMonth}`);
    return reportData;
  } catch (error) {
    console.error('Failed to sync monthly report:', error);
    throw error;
  }
}

/**
 * 시프트 클로즈 레포트를 Firebase에 저장
 */
async function syncShiftCloseToFirebase(storeId, shiftData) {
  const db = getFirestore();
  if (!db) return null;
  
  try {
    const docRef = db.collection('stores')
      .doc(storeId)
      .collection('shifts')
      .doc(shiftData.shiftId || `SHIFT-${Date.now()}`);
    
    await docRef.set({
      ...shiftData,
      syncedAt: admin.firestore.FieldValue.serverTimestamp(),
      storeId
    });
    
    console.log(`✅ Shift close synced to Firebase: ${shiftData.shiftId}`);
    return true;
  } catch (error) {
    console.error('Failed to sync shift close:', error);
    throw error;
  }
}

// ==================== 데이터 생성 함수 ====================

/**
 * 일일 레포트 데이터 생성
 */
function generateDailyReportData(date) {
  return new Promise((resolve, reject) => {
    const db = getDatabase();
    
    const result = {
      date,
      generatedAt: new Date().toISOString(),
      sales: {},
      payments: {},
      categories: [],
      topItems: [],
      hourlyBreakdown: [],
      employees: [],
      tips: {},
      voidsRefunds: {}
    };
    
    // 매출 요약
    db.get(`
      SELECT 
        COUNT(*) as order_count,
        COALESCE(SUM(subtotal), 0) as subtotal,
        COALESCE(SUM(tax), 0) as tax,
        COALESCE(SUM(total), 0) as total,
        COALESCE(SUM(discount_amount), 0) as discounts,
        COALESCE(AVG(total), 0) as avg_check,
        COALESCE(SUM(guests), 0) as guest_count
      FROM orders
      WHERE DATE(created_at) = ? AND status = 'COMPLETED'
    `, [date], (err, sales) => {
      if (err) { db.close(); return reject(err); }
      result.sales = sales || {};
      
      // 결제 방법별
      db.all(`
        SELECT payment_method, COUNT(*) as count, COALESCE(SUM(amount), 0) as amount
        FROM payments
        WHERE DATE(created_at) = ? AND type = 'payment'
        GROUP BY payment_method
      `, [date], (err, payments) => {
        if (err) { db.close(); return reject(err); }
        result.payments = {
          breakdown: payments || [],
          cash: (payments || []).find(p => p.payment_method === 'CASH')?.amount || 0,
          card: (payments || []).find(p => p.payment_method === 'CARD')?.amount || 0
        };
        
        // 팁
        db.get(`
          SELECT COALESCE(SUM(amount), 0) as total_tips,
                 COALESCE(SUM(CASE WHEN payment_method = 'CASH' THEN amount ELSE 0 END), 0) as cash_tips,
                 COALESCE(SUM(CASE WHEN payment_method = 'CARD' THEN amount ELSE 0 END), 0) as card_tips
          FROM payments
          WHERE DATE(created_at) = ? AND type = 'tip'
        `, [date], (err, tips) => {
          if (err) { db.close(); return reject(err); }
          result.tips = tips || {};
          
          // 카테고리별
          db.all(`
            SELECT c.name as category, 
                   COALESCE(SUM(oi.quantity), 0) as quantity,
                   COALESCE(SUM(oi.price * oi.quantity), 0) as revenue
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.order_id
            LEFT JOIN items i ON oi.item_id = i.item_id
            LEFT JOIN categories c ON i.category_id = c.category_id
            WHERE DATE(o.created_at) = ? AND o.status = 'COMPLETED'
            GROUP BY c.category_id
            ORDER BY revenue DESC
          `, [date], (err, categories) => {
            if (err) { db.close(); return reject(err); }
            result.categories = categories || [];
            
            // 베스트셀러
            db.all(`
              SELECT oi.name, COALESCE(SUM(oi.quantity), 0) as quantity,
                     COALESCE(SUM(oi.price * oi.quantity), 0) as revenue
              FROM order_items oi
              JOIN orders o ON oi.order_id = o.order_id
              WHERE DATE(o.created_at) = ? AND o.status = 'COMPLETED'
              GROUP BY oi.item_id, oi.name
              ORDER BY quantity DESC
              LIMIT 10
            `, [date], (err, topItems) => {
              if (err) { db.close(); return reject(err); }
              result.topItems = topItems || [];
              
              // 시간대별
              db.all(`
                SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour,
                       COUNT(*) as orders,
                       COALESCE(SUM(total), 0) as revenue
                FROM orders
                WHERE DATE(created_at) = ? AND status = 'COMPLETED'
                GROUP BY hour
                ORDER BY hour
              `, [date], (err, hourly) => {
                if (err) { db.close(); return reject(err); }
                result.hourlyBreakdown = hourly || [];
                
                // 직원별
                db.all(`
                  SELECT o.employee_id, COALESCE(e.name, 'Unknown') as name,
                         COUNT(*) as orders, COALESCE(SUM(o.total), 0) as revenue
                  FROM orders o
                  LEFT JOIN employees e ON o.employee_id = e.employee_id
                  WHERE DATE(o.created_at) = ? AND o.status = 'COMPLETED'
                  GROUP BY o.employee_id
                  ORDER BY revenue DESC
                `, [date], (err, employees) => {
                  if (err) { db.close(); return reject(err); }
                  result.employees = employees || [];
                  
                  // Void/Refund
                  db.get(`
                    SELECT 
                      (SELECT COUNT(*) FROM order_adjustments WHERE DATE(created_at) = ? AND type = 'VOID') as void_count,
                      (SELECT COALESCE(SUM(amount), 0) FROM order_adjustments WHERE DATE(created_at) = ? AND type = 'VOID') as void_amount,
                      (SELECT COUNT(*) FROM payments WHERE DATE(created_at) = ? AND type = 'refund') as refund_count,
                      (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE DATE(created_at) = ? AND type = 'refund') as refund_amount
                  `, [date, date, date, date], (err, voids) => {
                    db.close();
                    if (err) return reject(err);
                    result.voidsRefunds = voids || {};
                    
                    resolve(result);
                  });
                });
              });
            });
          });
        });
      });
    });
  });
}

/**
 * 월간 레포트 데이터 생성
 */
function generateMonthlyReportData(yearMonth) {
  return new Promise((resolve, reject) => {
    const db = getDatabase();
    const startDate = `${yearMonth}-01`;
    const endDate = `${yearMonth}-31`;
    
    const result = {
      yearMonth,
      generatedAt: new Date().toISOString(),
      summary: {},
      dailyTotals: [],
      categoryBreakdown: [],
      paymentBreakdown: [],
      employeePerformance: [],
      weekdayPerformance: []
    };
    
    // 월간 요약
    db.get(`
      SELECT 
        COUNT(*) as order_count,
        COALESCE(SUM(total), 0) as total_revenue,
        COALESCE(AVG(total), 0) as avg_check,
        COALESCE(SUM(guests), 0) as total_guests,
        COUNT(DISTINCT DATE(created_at)) as operating_days
      FROM orders
      WHERE DATE(created_at) BETWEEN ? AND ? AND status = 'COMPLETED'
    `, [startDate, endDate], (err, summary) => {
      if (err) { db.close(); return reject(err); }
      result.summary = summary || {};
      
      // 일별 매출
      db.all(`
        SELECT DATE(created_at) as date, 
               COUNT(*) as orders,
               COALESCE(SUM(total), 0) as revenue
        FROM orders
        WHERE DATE(created_at) BETWEEN ? AND ? AND status = 'COMPLETED'
        GROUP BY DATE(created_at)
        ORDER BY date
      `, [startDate, endDate], (err, daily) => {
        if (err) { db.close(); return reject(err); }
        result.dailyTotals = daily || [];
        
        // 카테고리별
        db.all(`
          SELECT c.name as category, 
                 COALESCE(SUM(oi.quantity), 0) as quantity,
                 COALESCE(SUM(oi.price * oi.quantity), 0) as revenue
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.order_id
          LEFT JOIN items i ON oi.item_id = i.item_id
          LEFT JOIN categories c ON i.category_id = c.category_id
          WHERE DATE(o.created_at) BETWEEN ? AND ? AND o.status = 'COMPLETED'
          GROUP BY c.category_id
          ORDER BY revenue DESC
        `, [startDate, endDate], (err, categories) => {
          if (err) { db.close(); return reject(err); }
          result.categoryBreakdown = categories || [];
          
          // 결제방법별
          db.all(`
            SELECT payment_method, COUNT(*) as count, COALESCE(SUM(amount), 0) as amount
            FROM payments
            WHERE DATE(created_at) BETWEEN ? AND ? AND type = 'payment'
            GROUP BY payment_method
          `, [startDate, endDate], (err, payments) => {
            if (err) { db.close(); return reject(err); }
            result.paymentBreakdown = payments || [];
            
            // 직원별
            db.all(`
              SELECT o.employee_id, COALESCE(e.name, 'Unknown') as name,
                     COUNT(*) as orders, COALESCE(SUM(o.total), 0) as revenue
              FROM orders o
              LEFT JOIN employees e ON o.employee_id = e.employee_id
              WHERE DATE(o.created_at) BETWEEN ? AND ? AND o.status = 'COMPLETED'
              GROUP BY o.employee_id
              ORDER BY revenue DESC
            `, [startDate, endDate], (err, employees) => {
              if (err) { db.close(); return reject(err); }
              result.employeePerformance = employees || [];
              
              // 요일별
              db.all(`
                SELECT CAST(strftime('%w', created_at) AS INTEGER) as day_of_week,
                       COUNT(*) as orders,
                       COALESCE(SUM(total), 0) as revenue
                FROM orders
                WHERE DATE(created_at) BETWEEN ? AND ? AND status = 'COMPLETED'
                GROUP BY day_of_week
                ORDER BY day_of_week
              `, [startDate, endDate], (err, weekdays) => {
                db.close();
                if (err) return reject(err);
                
                const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                result.weekdayPerformance = (weekdays || []).map(w => ({
                  ...w,
                  dayName: dayNames[w.day_of_week]
                }));
                
                resolve(result);
              });
            });
          });
        });
      });
    });
  });
}

// ==================== 자동 동기화 스케줄러 ====================

let syncInterval = null;

/**
 * 자동 동기화 시작
 * @param {string} storeId - 매장 ID
 * @param {number} intervalMinutes - 동기화 간격 (분)
 */
function startAutoSync(storeId, intervalMinutes = 30) {
  if (syncInterval) {
    clearInterval(syncInterval);
  }
  
  console.log(`📊 Starting auto-sync every ${intervalMinutes} minutes for store: ${storeId}`);
  
  // 즉시 한 번 실행
  syncCurrentDayReport(storeId);
  
  // 주기적 실행
  syncInterval = setInterval(() => {
    syncCurrentDayReport(storeId);
  }, intervalMinutes * 60 * 1000);
}

/**
 * 자동 동기화 중지
 */
function stopAutoSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log('📊 Auto-sync stopped');
  }
}

/**
 * 현재 날짜 레포트 동기화
 */
async function syncCurrentDayReport(storeId) {
  const today = new Date().toISOString().split('T')[0];
  try {
    await syncDailyReportToFirebase(storeId, today);
  } catch (error) {
    console.error('Auto-sync failed:', error);
  }
}

// ==================== 내보내기 ====================

module.exports = {
  syncDailyReportToFirebase,
  syncMonthlyReportToFirebase,
  syncShiftCloseToFirebase,
  generateDailyReportData,
  generateMonthlyReportData,
  startAutoSync,
  stopAutoSync
};

