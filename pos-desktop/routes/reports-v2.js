// backend/routes/reports-v2.js
// 통합 레포트 시스템 V2 - 그룹화된 레포트 + Firebase 동기화 + 엑셀 다운로드

const express = require('express');
const admin = require('firebase-admin');

const router = express.Router();

// 공유 데이터베이스 모듈 사용 (환경 변수 DB_PATH 지원 - Electron 앱 호환)
const { db } = require('../db');

// 데이터베이스 연결 (레거시 호환)
const getDatabase = () => db;

// "Paid-like" statuses used across the app.
// Historically some reports used only COMPLETED; in POS runtime we also use PAID/CLOSED/PICKED_UP.
const PAID_STATUSES_SQL = "UPPER(status) IN ('PAID','COMPLETED','CLOSED','PICKED_UP')";
const PAID_STATUSES_SQL_O = "UPPER(o.status) IN ('PAID','COMPLETED','CLOSED','PICKED_UP')";

// Firebase Firestore
const getFirestore = () => {
  try {
    if (admin.apps.length === 0) return null;
    return admin.firestore();
  } catch (error) {
    return null;
  }
};

// ==================== 통합 레포트 정의 ====================

const REPORT_DEFINITIONS = {
  // ===== 프린터용 텍스트 레포트 (3개) =====
  'daily-cash-report': {
    id: 'daily-cash-report',
    name: 'Daily Cash Report',
    category: 'printable',
    type: 'text',
    description: 'Opening/Closing cash, tips, and cash summary',
    printable: true
  },
  'daily-summary-report': {
    id: 'daily-summary-report', 
    name: 'Daily Summary Report',
    category: 'printable',
    type: 'text',
    description: 'Complete daily sales summary for end-of-day closing',
    printable: true
  },
  'shift-close-report': {
    id: 'shift-close-report',
    name: 'Shift Close Report',
    category: 'printable',
    type: 'text',
    description: 'Shift closing report with cash drawer reconciliation',
    printable: true
  },

  // ===== 통합 그래프 레포트 =====
  
  // 1. Time Analysis (시간 분석)
  'time-analysis': {
    id: 'time-analysis',
    name: 'Time Analysis',
    category: 'sales',
    type: 'combined',
    sections: ['hourly-sales', 'hourly-distribution', 'peak-hours'],
    description: 'Hourly sales, distribution patterns, and peak hours analysis'
  },

  // 2. Category & Menu Analysis (카테고리 & 메뉴 분석) - 비활성화됨
  'category-menu-analysis': {
    id: 'category-menu-analysis',
    name: 'Category & Menu Analysis',
    category: 'sales',
    type: 'combined',
    sections: ['category-breakdown', 'menu-performance', 'modifier-sales', 'order-source'],
    description: 'Category breakdown, menu item performance, modifiers, and order sources',
    disabled: true
  },

  // 3. Table Performance (테이블 성과)
  'table-performance': {
    id: 'table-performance',
    name: 'Table Performance',
    category: 'sales',
    type: 'combined',
    sections: ['guest-count', 'average-check', 'revenue-per-seat', 'table-turnover', 'sales-by-table', 'dwell-time'],
    description: 'Guest trends, average check, seat revenue, turnover rate, table sales, and dwell time'
  },

  // 4. Menu Ranking (메뉴 랭킹)
  'menu-ranking': {
    id: 'menu-ranking',
    name: 'Menu Ranking',
    category: 'sales',
    type: 'combined',
    sections: ['top-sellers', 'slow-movers'],
    description: 'Best selling items and slow moving items that need attention'
  },

  // 5. Payment Analysis (결제 분석) - 비활성화됨
  'payment-analysis': {
    id: 'payment-analysis',
    name: 'Payment Analysis',
    category: 'sales',
    type: 'combined',
    sections: ['payment-breakdown', 'cash-card-ratio'],
    description: 'Payment method breakdown and cash vs card ratio',
    disabled: true
  },

  // 6. Tips & Service (팁 & 서비스)
  'tips-service': {
    id: 'tips-service',
    name: 'Tips & Service Charges',
    category: 'sales',
    type: 'combined',
    sections: ['tip-analysis', 'service-charges'],
    description: 'Tip trends and service charge reports'
  },

  // 7. Revenue Analysis (매출 분석)
  'revenue-analysis': {
    id: 'revenue-analysis',
    name: 'Revenue Analysis',
    category: 'sales',
    type: 'combined',
    sections: ['gross-net-revenue', 'profit-margin'],
    description: 'Gross vs Net revenue comparison and profit margin analysis'
  },

  // ===== 기존 개별 레포트 (유지) =====
  'daily-sales-overview': {
    id: 'daily-sales-overview',
    name: 'Daily Sales Overview',
    category: 'sales',
    type: 'graph',
    chartType: 'bar',
    description: 'Real-time sales overview for today'
  },
  'weekly-sales-trend': {
    id: 'weekly-sales-trend',
    name: 'Weekly Sales Trend',
    category: 'sales',
    type: 'graph',
    chartType: 'line',
    description: 'Sales trend over the past 7 days'
  },
  'monthly-sales-comparison': {
    id: 'monthly-sales-comparison',
    name: 'Monthly Sales Comparison',
    category: 'sales',
    type: 'graph',
    chartType: 'bar',
    description: 'Compare sales across months'
  },
  'yearly-sales-analysis': {
    id: 'yearly-sales-analysis',
    name: 'Yearly Sales Analysis',
    category: 'sales',
    type: 'graph',
    chartType: 'area',
    description: 'Annual sales performance and trends'
  },
  'day-of-week-performance': {
    id: 'day-of-week-performance',
    name: 'Day of Week Performance',
    category: 'sales',
    type: 'graph',
    chartType: 'bar',
    description: 'Sales performance by day of week'
  },
  'void-refund-report': {
    id: 'void-refund-report',
    name: 'Void & Refund Report',
    category: 'sales',
    type: 'graph',
    chartType: 'bar',
    description: 'Track voids and refunds with reasons'
  },
  'discount-promotion-analysis': {
    id: 'discount-promotion-analysis',
    name: 'Discount & Promotion Analysis',
    category: 'sales',
    type: 'graph',
    chartType: 'bar',
    description: 'Impact of discounts and promotions'
  },
  'online-order-performance': {
    id: 'online-order-performance',
    name: 'Online Order Performance',
    category: 'sales',
    type: 'graph',
    chartType: 'line',
    description: 'Online ordering trends'
  },
  'channel-performance': {
    id: 'channel-performance',
    name: 'Channel Performance',
    category: 'sales',
    type: 'graph',
    chartType: 'bar',
    description: 'Revenue by sales channel'
  },
  'channel-revenue-comparison': {
    id: 'channel-revenue-comparison',
    name: 'Channel Revenue Comparison',
    category: 'sales',
    type: 'graph',
    chartType: 'grouped-bar',
    description: 'Side-by-side channel revenue comparison'
  },
  'channel-growth-analysis': {
    id: 'channel-growth-analysis',
    name: 'Channel Growth Analysis',
    category: 'sales',
    type: 'graph',
    chartType: 'line',
    description: 'Sales growth by channel over time'
  },
  'delivery-platform-revenue': {
    id: 'delivery-platform-revenue',
    name: 'Delivery Platform Revenue',
    category: 'sales',
    type: 'graph',
    chartType: 'stacked-bar',
    description: 'UberEats, DoorDash, SkipTheDishes breakdown'
  },
  'gift-card-sales-detail': {
    id: 'gift-card-sales-detail',
    name: 'Gift Card Sales Detail',
    category: 'sales',
    type: 'graph',
    chartType: 'stacked-bar',
    description: 'Gift card sales by denomination'
  },
  'gift-card-redemption': {
    id: 'gift-card-redemption',
    name: 'Gift Card Redemption',
    category: 'sales',
    type: 'graph',
    chartType: 'line',
    description: 'Gift card usage and balance tracking'
  },
  'tax-summary-report': {
    id: 'tax-summary-report',
    name: 'Tax Summary Report',
    category: 'sales',
    type: 'graph',
    chartType: 'stacked-bar',
    description: 'Tax collected by category and period'
  },
  'comp-discount-tracking': {
    id: 'comp-discount-tracking',
    name: 'Comp & Discount Tracking',
    category: 'sales',
    type: 'graph',
    chartType: 'bar',
    description: 'Track comps and discounts given'
  },
  'revenue-per-labor-hour': {
    id: 'revenue-per-labor-hour',
    name: 'Revenue Per Labor Hour',
    category: 'sales',
    type: 'graph',
    chartType: 'bar',
    description: 'Sales efficiency per labor hour'
  },

  // ===== 직원 레포트 (5개) - 비활성화됨 =====
  'employee-sales-performance': {
    id: 'employee-sales-performance',
    name: 'Employee Sales Performance',
    category: 'employee',
    type: 'graph',
    chartType: 'bar',
    description: 'Sales performance by employee',
    disabled: true
  },
  'server-performance-comparison': {
    id: 'server-performance-comparison',
    name: 'Server Performance Comparison',
    category: 'employee',
    type: 'graph',
    chartType: 'radar',
    description: 'Compare server metrics',
    disabled: true
  },
  'tips-by-employee': {
    id: 'tips-by-employee',
    name: 'Tips By Employee',
    category: 'employee',
    type: 'graph',
    chartType: 'bar',
    description: 'Tip earnings by employee',
    disabled: true
  },
  'labor-cost-analysis': {
    id: 'labor-cost-analysis',
    name: 'Labor Cost Analysis',
    category: 'employee',
    type: 'graph',
    chartType: 'stacked-area',
    description: 'Labor costs as percentage of revenue',
    disabled: true
  },
  'clock-in-out-summary': {
    id: 'clock-in-out-summary',
    name: 'Clock In/Out Summary',
    category: 'employee',
    type: 'graph',
    chartType: 'timeline',
    description: 'Employee attendance and hours',
    disabled: true
  }
};

// ==================== API 엔드포인트 ====================

// GET /api/reports-v2 - 레포트 목록
router.get('/', (req, res) => {
  try {
    // 비활성화된 레포트 제외
    const reports = Object.values(REPORT_DEFINITIONS).filter(r => !r.disabled);
    
    const grouped = {
      printable: reports.filter(r => r.printable),
      combined: reports.filter(r => r.type === 'combined'),
      sales: reports.filter(r => r.category === 'sales' && r.type !== 'combined'),
      employee: reports.filter(r => r.category === 'employee')
    };
    
    res.json({
      total: reports.length,
      groups: {
        printable: grouped.printable.length,
        combined: grouped.combined.length,
        sales: grouped.sales.length,
        employee: grouped.employee.length
      },
      reports: grouped
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get reports list' });
  }
});

// GET /api/reports-v2/:reportId - 레포트 데이터
router.get('/:reportId', async (req, res) => {
  try {
    const { reportId } = req.params;
    const { startDate, endDate, storeId } = req.query;
    
    const reportDef = REPORT_DEFINITIONS[reportId];
    if (!reportDef) {
      return res.status(404).json({ error: 'Report not found' });
    }
    
    const start = startDate || new Date().toISOString().split('T')[0];
    const end = endDate || start;
    const store = storeId || 'default';
    
    const db = getDatabase();
    let data;
    
    if (reportDef.type === 'combined') {
      data = await generateCombinedReport(db, reportId, start, end);
    } else {
      data = await generateSingleReport(db, reportId, start, end);
    }
    
    // db.close(); // Shared DB 연결은 닫으면 안 됨
    
    // Firebase에 저장
    await saveReportToFirebase(store, reportId, start, end, data);
    
    res.json({
      report: reportDef,
      dateRange: { start, end },
      generatedAt: new Date().toISOString(),
      data
    });
  } catch (error) {
    console.error(`Error generating report:`, error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// GET /api/reports-v2/:reportId/excel - 엑셀 다운로드
router.get('/:reportId/excel', async (req, res) => {
  try {
    const { reportId } = req.params;
    const { startDate, endDate } = req.query;
    
    const reportDef = REPORT_DEFINITIONS[reportId];
    if (!reportDef) {
      return res.status(404).json({ error: 'Report not found' });
    }
    
    const start = startDate || new Date().toISOString().split('T')[0];
    const end = endDate || start;
    
    const db = getDatabase();
    let data;
    
    if (reportDef.type === 'combined') {
      data = await generateCombinedReport(db, reportId, start, end);
    } else {
      data = await generateSingleReport(db, reportId, start, end);
    }
    
    // db.close(); // Shared DB 연결은 닫으면 안 됨
    
    // CSV 생성 (엑셀 호환)
    const csv = generateCSV(reportDef, data);
    
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${reportId}_${start}_${end}.csv"`);
    res.send('\uFEFF' + csv); // BOM for Excel UTF-8
  } catch (error) {
    console.error(`Error generating Excel:`, error);
    res.status(500).json({ error: 'Failed to generate Excel' });
  }
});

// GET /api/reports-v2/:reportId/print - 프린터용 텍스트
router.get('/:reportId/print', async (req, res) => {
  try {
    const { reportId } = req.params;
    const { startDate, shiftId, width = 42 } = req.query;
    
    const reportDef = REPORT_DEFINITIONS[reportId];
    if (!reportDef || !reportDef.printable) {
      return res.status(400).json({ error: 'Report is not printable' });
    }
    
    const start = startDate || new Date().toISOString().split('T')[0];
    const db = getDatabase();
    
    const printText = await generatePrintText(db, reportId, start, shiftId, parseInt(width));
    
    // db.close(); // Shared DB 연결은 닫으면 안 됨
    
    res.type('text/plain').send(printText);
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate print format' });
  }
});

// POST /api/reports-v2/sync-all - 모든 레포트 Firebase 동기화
router.post('/sync-all', async (req, res) => {
  try {
    const { storeId, date } = req.body;
    const targetDate = date || new Date().toISOString().split('T')[0];
    const store = storeId || 'default';
    
    const db = getDatabase();
    const results = [];
    
    for (const [reportId, reportDef] of Object.entries(REPORT_DEFINITIONS)) {
      if (reportDef.printable) continue; // 프린터용 제외
      
      try {
        let data;
        if (reportDef.type === 'combined') {
          data = await generateCombinedReport(db, reportId, targetDate, targetDate);
        } else {
          data = await generateSingleReport(db, reportId, targetDate, targetDate);
        }
        
        await saveReportToFirebase(store, reportId, targetDate, targetDate, data);
        results.push({ reportId, status: 'success' });
      } catch (err) {
        results.push({ reportId, status: 'error', error: err.message });
      }
    }
    
    // db.close(); // Shared DB 연결은 닫으면 안 됨
    
    res.json({
      success: true,
      date: targetDate,
      synced: results.filter(r => r.status === 'success').length,
      failed: results.filter(r => r.status === 'error').length,
      results
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to sync all reports' });
  }
});

// ==================== Firebase 저장 함수 ====================

async function saveReportToFirebase(storeId, reportId, startDate, endDate, data) {
  const firestore = getFirestore();
  if (!firestore) return null;
  
  try {
    const docRef = firestore
      .collection('stores')
      .doc(storeId)
      .collection('reports')
      .doc(reportId)
      .collection(startDate.substring(0, 7)) // YYYY-MM
      .doc(startDate);
    
    await docRef.set({
      reportId,
      startDate,
      endDate,
      data,
      syncedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    
    console.log(`✅ Report synced to Firebase: ${reportId} (${startDate})`);
    return true;
  } catch (error) {
    console.error(`Firebase sync error for ${reportId}:`, error);
    return false;
  }
}

// ==================== 통합 레포트 생성 함수 ====================

async function generateCombinedReport(db, reportId, startDate, endDate) {
  const sections = {};
  
  switch (reportId) {
    case 'time-analysis':
      sections.hourlySales = await getHourlySales(db, startDate, endDate);
      sections.hourlyDistribution = await getHourlyDistribution(db, startDate, endDate);
      sections.peakHours = await getPeakHoursAnalysis(db, startDate, endDate);
      break;
      
    case 'category-menu-analysis':
      sections.categoryBreakdown = await getCategoryBreakdown(db, startDate, endDate);
      sections.menuPerformance = await getMenuPerformance(db, startDate, endDate);
      sections.modifierSales = await getModifierSales(db, startDate, endDate);
      sections.orderSource = await getOrderSourceAnalysis(db, startDate, endDate);
      break;
      
    case 'table-performance':
      sections.guestCount = await getGuestCountTrend(db, startDate, endDate);
      sections.averageCheck = await getAverageCheckSize(db, startDate, endDate);
      sections.revenuePerSeat = await getRevenuePerSeat(db, startDate, endDate);
      sections.tableTurnover = await getTableTurnover(db, startDate, endDate);
      sections.salesByTable = await getSalesByTable(db, startDate, endDate);
      sections.dwellTime = await getDwellTimeAnalysis(db, startDate, endDate);
      break;
      
    case 'menu-ranking':
      sections.topSellers = await getTopSellingItems(db, startDate, endDate, 20);
      sections.slowMovers = await getSlowMovingItems(db, startDate, endDate, 20);
      break;
      
    case 'payment-analysis':
      sections.paymentBreakdown = await getPaymentMethodBreakdown(db, startDate, endDate);
      sections.cashCardRatio = await getCashCardRatio(db, startDate, endDate);
      break;
      
    case 'tips-service':
      sections.tipAnalysis = await getTipAnalysis(db, startDate, endDate);
      sections.serviceCharges = await getServiceCharges(db, startDate, endDate);
      break;
      
    case 'revenue-analysis':
      sections.grossNetRevenue = await getGrossNetRevenue(db, startDate, endDate);
      sections.profitMargin = await getProfitMarginAnalysis(db, startDate, endDate);
      break;
  }
  
  return { sections };
}

// ==================== 개별 섹션 데이터 함수 ====================

// Time Analysis
function getHourlySales(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        CAST(strftime('%H', o.created_at) AS INTEGER) as hour,
        COUNT(DISTINCT o.id) as orders,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) / MAX(COUNT(DISTINCT o.id), 1) as avgCheck
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE DATE(o.created_at) BETWEEN ? AND ? AND ${PAID_STATUSES_SQL_O}
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
      GROUP BY hour ORDER BY hour
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      
      const hourlyData = Array.from({ length: 24 }, (_, h) => {
        const found = rows.find(r => r.hour === h);
        return {
          hour: h,
          label: `${h.toString().padStart(2, '0')}:00`,
          orders: found?.orders || 0,
          revenue: found?.revenue || 0,
          avgCheck: found?.avgCheck || 0
        };
      });
      
      resolve({
        title: 'Hourly Sales',
        chartType: 'bar',
        data: hourlyData,
        summary: {
          totalRevenue: rows.reduce((s, r) => s + r.revenue, 0),
          totalOrders: rows.reduce((s, r) => s + r.orders, 0)
        }
      });
    });
  });
}

function getHourlyDistribution(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        CAST(strftime('%H', created_at) AS INTEGER) as hour,
        COUNT(*) as count
      FROM orders
      WHERE DATE(created_at) BETWEEN ? AND ? AND ${PAID_STATUSES_SQL}
      GROUP BY hour ORDER BY hour
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      
      const total = rows.reduce((s, r) => s + r.count, 0);
      const distribution = rows.map(r => ({
        hour: r.hour,
        label: `${r.hour.toString().padStart(2, '0')}:00`,
        count: r.count,
        percentage: total > 0 ? (r.count / total * 100).toFixed(1) : 0
      }));
      
      resolve({
        title: 'Hourly Distribution',
        chartType: 'area',
        data: distribution,
        summary: { totalOrders: total }
      });
    });
  });
}

function getPeakHoursAnalysis(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        CAST(strftime('%w', o.created_at) AS INTEGER) as dayOfWeek,
        CAST(strftime('%H', o.created_at) AS INTEGER) as hour,
        COUNT(DISTINCT o.id) as count,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE DATE(o.created_at) BETWEEN ? AND ? AND ${PAID_STATUSES_SQL_O}
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
      GROUP BY dayOfWeek, hour
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const heatmapData = [];
      
      for (let d = 0; d < 7; d++) {
        for (let h = 0; h < 24; h++) {
          const found = rows.find(r => r.dayOfWeek === d && r.hour === h);
          heatmapData.push({
            day: d,
            dayName: dayNames[d],
            hour: h,
            count: found?.count || 0,
            revenue: found?.revenue || 0
          });
        }
      }
      
      // Peak hours 찾기
      const sorted = [...rows].sort((a, b) => b.revenue - a.revenue);
      const peakTimes = sorted.slice(0, 5).map(r => ({
        day: dayNames[r.dayOfWeek],
        hour: `${r.hour.toString().padStart(2, '0')}:00`,
        revenue: r.revenue,
        orders: r.count
      }));
      
      resolve({
        title: 'Peak Hours Analysis',
        chartType: 'heatmap',
        data: heatmapData,
        peakTimes,
        dayNames
      });
    });
  });
}

// Category & Menu Analysis
function getCategoryBreakdown(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        COALESCE(c.name, 'Uncategorized') as category,
        COUNT(*) as itemCount,
        COALESCE(SUM(oi.quantity), 0) as quantity,
        COALESCE(SUM(oi.price * oi.quantity), 0) as revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.order_id
      LEFT JOIN items i ON oi.item_id = i.item_id
      LEFT JOIN categories c ON i.category_id = c.category_id
      WHERE DATE(o.created_at) BETWEEN ? AND ? AND ${PAID_STATUSES_SQL_O}
      GROUP BY c.category_id ORDER BY revenue DESC
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      
      const total = rows.reduce((s, r) => s + r.revenue, 0);
      const data = rows.map(r => ({
        ...r,
        percentage: total > 0 ? (r.revenue / total * 100).toFixed(1) : 0
      }));
      
      resolve({
        title: 'Category Breakdown',
        chartType: 'pie',
        data,
        summary: { totalRevenue: total, categoryCount: rows.length }
      });
    });
  });
}

function getMenuPerformance(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        oi.item_id,
        oi.name as itemName,
        COALESCE(c.name, 'Uncategorized') as category,
        COALESCE(SUM(oi.quantity), 0) as quantity,
        COALESCE(SUM(oi.price * oi.quantity), 0) as revenue,
        COALESCE(AVG(oi.price), 0) as avgPrice
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.order_id
      LEFT JOIN items i ON oi.item_id = i.item_id
      LEFT JOIN categories c ON i.category_id = c.category_id
      WHERE DATE(o.created_at) BETWEEN ? AND ? AND ${PAID_STATUSES_SQL_O}
      GROUP BY oi.item_id, oi.name
      ORDER BY revenue DESC LIMIT 30
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      
      resolve({
        title: 'Menu Item Performance',
        chartType: 'bar',
        data: rows
      });
    });
  });
}

function getModifierSales(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        m.name as modifierName,
        mg.name as groupName,
        COUNT(*) as usageCount,
        COALESCE(SUM(m.price_adjustment), 0) as totalRevenue
      FROM order_item_modifiers oim
      JOIN order_items oi ON oim.order_item_id = oi.id
      JOIN orders o ON oi.order_id = o.order_id
      LEFT JOIN modifiers m ON oim.modifier_id = m.modifier_id
      LEFT JOIN modifier_groups mg ON m.modifier_group_id = mg.modifier_group_id
      WHERE DATE(o.created_at) BETWEEN ? AND ? AND ${PAID_STATUSES_SQL_O}
      GROUP BY m.modifier_id
      ORDER BY usageCount DESC LIMIT 20
    `, [startDate, endDate], (err, rows) => {
      if (err) {
        // 테이블이 없으면 빈 결과
        return resolve({ title: 'Modifier Sales', chartType: 'bar', data: [] });
      }
      
      resolve({
        title: 'Modifier Sales',
        chartType: 'bar',
        data: rows || []
      });
    });
  });
}

function getOrderSourceAnalysis(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        COALESCE(o.order_type, 'DINE_IN') as source,
        COUNT(DISTINCT o.id) as orders,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE DATE(o.created_at) BETWEEN ? AND ? AND ${PAID_STATUSES_SQL_O}
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
      GROUP BY o.order_type ORDER BY revenue DESC
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      
      const sourceLabels = {
        'DINE_IN': 'Dine In', 'TAKEOUT': 'Takeout', 'TOGO': 'To-Go',
        'DELIVERY': 'Delivery', 'ONLINE': 'Online',
        'TABLE_QR': 'Table Order', 'KIOSK': 'Kiosk'
      };
      
      const total = rows.reduce((s, r) => s + r.revenue, 0);
      const data = rows.map(r => ({
        source: r.source,
        label: sourceLabels[r.source] || r.source,
        orders: r.orders,
        revenue: r.revenue,
        percentage: total > 0 ? (r.revenue / total * 100).toFixed(1) : 0
      }));
      
      resolve({
        title: 'Order Source Analysis',
        chartType: 'pie',
        data,
        summary: { totalRevenue: total }
      });
    });
  });
}

// Table Performance
function getGuestCountTrend(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        DATE(created_at) as date,
        COALESCE(SUM(guests), 0) as guests,
        COUNT(*) as orders
      FROM orders
      WHERE DATE(created_at) BETWEEN ? AND ? AND ${PAID_STATUSES_SQL}
      GROUP BY DATE(created_at) ORDER BY date
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      
      resolve({
        title: 'Guest Count Trend',
        chartType: 'line',
        data: rows,
        summary: { totalGuests: rows.reduce((s, r) => s + r.guests, 0) }
      });
    });
  });
}

function getAverageCheckSize(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as orders,
        COALESCE(AVG(total), 0) as avgCheck,
        COALESCE(MIN(total), 0) as minCheck,
        COALESCE(MAX(total), 0) as maxCheck
      FROM orders
      WHERE DATE(created_at) BETWEEN ? AND ? AND ${PAID_STATUSES_SQL} AND total > 0
      GROUP BY DATE(created_at) ORDER BY date
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      
      const overallAvg = rows.length > 0 
        ? rows.reduce((s, r) => s + r.avgCheck, 0) / rows.length : 0;
      
      resolve({
        title: 'Average Check Size',
        chartType: 'line',
        data: rows,
        summary: { overallAverage: overallAvg }
      });
    });
  });
}

function getRevenuePerSeat(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        DATE(o.created_at) as date,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue,
        COALESCE(SUM(o.guests), 0) as guests,
        CASE WHEN SUM(o.guests) > 0 THEN SUM(p.amount - COALESCE(p.tip, 0)) / SUM(o.guests) ELSE 0 END as revenuePerSeat
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE DATE(o.created_at) BETWEEN ? AND ? AND ${PAID_STATUSES_SQL_O}
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
      GROUP BY DATE(o.created_at) ORDER BY date
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      
      const totalRev = rows.reduce((s, r) => s + r.revenue, 0);
      const totalGuests = rows.reduce((s, r) => s + r.guests, 0);
      
      resolve({
        title: 'Revenue Per Seat',
        chartType: 'bar',
        data: rows,
        summary: { 
          avgRevenuePerSeat: totalGuests > 0 ? totalRev / totalGuests : 0,
          totalRevenue: totalRev,
          totalGuests
        }
      });
    });
  });
}

function getTableTurnover(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        o.table_id,
        COUNT(DISTINCT o.id) as orderCount,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE DATE(o.created_at) BETWEEN ? AND ? 
        AND ${PAID_STATUSES_SQL_O}
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
        AND o.table_id IS NOT NULL
      GROUP BY table_id ORDER BY orderCount DESC
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      
      resolve({
        title: 'Table Turnover Rate',
        chartType: 'bar',
        data: rows,
        summary: { avgTurnover: rows.length > 0 ? rows.reduce((s, r) => s + r.orderCount, 0) / rows.length : 0 }
      });
    });
  });
}

function getSalesByTable(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        o.table_id as tableName,
        COUNT(DISTINCT o.id) as orders,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) / MAX(COUNT(DISTINCT o.id), 1) as avgCheck
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE DATE(o.created_at) BETWEEN ? AND ? 
        AND ${PAID_STATUSES_SQL_O}
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
        AND o.table_id IS NOT NULL
      GROUP BY table_id ORDER BY revenue DESC
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      
      resolve({
        title: 'Sales By Table',
        chartType: 'bar',
        data: rows
      });
    });
  });
}

function getDwellTimeAnalysis(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        table_id,
        AVG(
          CASE 
            WHEN closed_at IS NOT NULL AND created_at IS NOT NULL 
            THEN (julianday(closed_at) - julianday(created_at)) * 24 * 60
            ELSE 0 
          END
        ) as avgDwellMinutes,
        COUNT(*) as orders
      FROM orders
      WHERE DATE(created_at) BETWEEN ? AND ? 
        AND ${PAID_STATUSES_SQL} 
        AND table_id IS NOT NULL
      GROUP BY table_id
      HAVING avgDwellMinutes > 0
      ORDER BY avgDwellMinutes DESC
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      
      resolve({
        title: 'Dwell Time Analysis',
        chartType: 'bar',
        data: rows.map(r => ({
          ...r,
          avgDwellMinutes: Math.round(r.avgDwellMinutes)
        }))
      });
    });
  });
}

// Menu Ranking
function getTopSellingItems(db, startDate, endDate, limit = 20) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        oi.item_id,
        oi.name as itemName,
        COALESCE(c.name, 'Uncategorized') as category,
        COALESCE(SUM(oi.quantity), 0) as quantity,
        COALESCE(SUM(oi.price * oi.quantity), 0) as revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.order_id
      LEFT JOIN items i ON oi.item_id = i.item_id
      LEFT JOIN categories c ON i.category_id = c.category_id
      WHERE DATE(o.created_at) BETWEEN ? AND ? AND ${PAID_STATUSES_SQL_O}
      GROUP BY oi.item_id, oi.name
      ORDER BY quantity DESC LIMIT ?
    `, [startDate, endDate, limit], (err, rows) => {
      if (err) return reject(err);
      
      resolve({
        title: 'Top Selling Items',
        chartType: 'horizontal-bar',
        data: rows
      });
    });
  });
}

function getSlowMovingItems(db, startDate, endDate, limit = 20) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        i.item_id,
        i.name as itemName,
        COALESCE(c.name, 'Uncategorized') as category,
        COALESCE(SUM(oi.quantity), 0) as quantity,
        COALESCE(SUM(oi.price * oi.quantity), 0) as revenue
      FROM items i
      LEFT JOIN categories c ON i.category_id = c.category_id
      LEFT JOIN order_items oi ON i.item_id = oi.item_id
      LEFT JOIN orders o ON oi.order_id = o.order_id 
        AND DATE(o.created_at) BETWEEN ? AND ?
        AND ${PAID_STATUSES_SQL_O}
      WHERE i.is_active = 1
      GROUP BY i.item_id
      ORDER BY quantity ASC LIMIT ?
    `, [startDate, endDate, limit], (err, rows) => {
      if (err) return reject(err);
      
      resolve({
        title: 'Slow Moving Items',
        chartType: 'horizontal-bar',
        data: rows
      });
    });
  });
}

// Payment Analysis
function getPaymentMethodBreakdown(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        payment_method as method,
        COUNT(*) as count,
        COALESCE(SUM(amount), 0) as amount
      FROM payments
      WHERE DATE(created_at) BETWEEN ? AND ? AND type = 'payment'
      GROUP BY payment_method ORDER BY amount DESC
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      
      const total = rows.reduce((s, r) => s + r.amount, 0);
      const data = rows.map(r => ({
        ...r,
        percentage: total > 0 ? (r.amount / total * 100).toFixed(1) : 0
      }));
      
      resolve({
        title: 'Payment Method Breakdown',
        chartType: 'pie',
        data,
        summary: { totalAmount: total }
      });
    });
  });
}

function getCashCardRatio(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        DATE(created_at) as date,
        COALESCE(SUM(CASE WHEN payment_method = 'CASH' THEN amount ELSE 0 END), 0) as cash,
        COALESCE(SUM(CASE WHEN payment_method != 'CASH' THEN amount ELSE 0 END), 0) as card
      FROM payments
      WHERE DATE(created_at) BETWEEN ? AND ? AND type = 'payment'
      GROUP BY DATE(created_at) ORDER BY date
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      
      const totalCash = rows.reduce((s, r) => s + r.cash, 0);
      const totalCard = rows.reduce((s, r) => s + r.card, 0);
      const total = totalCash + totalCard;
      
      resolve({
        title: 'Cash vs Card Ratio',
        chartType: 'donut',
        data: rows,
        summary: {
          cashTotal: totalCash,
          cardTotal: totalCard,
          cashPercentage: total > 0 ? (totalCash / total * 100).toFixed(1) : 0,
          cardPercentage: total > 0 ? (totalCard / total * 100).toFixed(1) : 0
        }
      });
    });
  });
}

// Tips & Service
function getTipAnalysis(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as tipCount,
        COALESCE(SUM(amount), 0) as totalTips,
        COALESCE(AVG(amount), 0) as avgTip
      FROM payments
      WHERE DATE(created_at) BETWEEN ? AND ? AND type = 'tip'
      GROUP BY DATE(created_at) ORDER BY date
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      
      const totalTips = rows.reduce((s, r) => s + r.totalTips, 0);
      const totalCount = rows.reduce((s, r) => s + r.tipCount, 0);
      
      resolve({
        title: 'Tip Analysis',
        chartType: 'line',
        data: rows,
        summary: {
          totalTips,
          avgTip: totalCount > 0 ? totalTips / totalCount : 0
        }
      });
    });
  });
}

function getServiceCharges(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        DATE(created_at) as date,
        COALESCE(SUM(service_charge), 0) as serviceCharges,
        COUNT(*) as orderCount
      FROM orders
      WHERE DATE(created_at) BETWEEN ? AND ? AND ${PAID_STATUSES_SQL}
      GROUP BY DATE(created_at) ORDER BY date
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      
      resolve({
        title: 'Service Charges',
        chartType: 'bar',
        data: rows,
        summary: { totalServiceCharges: rows.reduce((s, r) => s + r.serviceCharges, 0) }
      });
    });
  });
}

// Revenue Analysis
function getGrossNetRevenue(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        DATE(o.created_at) as date,
        COALESCE(SUM(o.subtotal), 0) as grossRevenue,
        COALESCE(SUM(o.discount_amount), 0) as discounts,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as netRevenue,
        COALESCE(SUM(o.tax), 0) as taxes
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE DATE(o.created_at) BETWEEN ? AND ? AND ${PAID_STATUSES_SQL_O}
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
      GROUP BY DATE(o.created_at) ORDER BY date
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      
      const totals = rows.reduce((acc, r) => ({
        gross: acc.gross + r.grossRevenue,
        discounts: acc.discounts + r.discounts,
        net: acc.net + r.netRevenue,
        taxes: acc.taxes + r.taxes
      }), { gross: 0, discounts: 0, net: 0, taxes: 0 });
      
      resolve({
        title: 'Gross vs Net Revenue',
        chartType: 'stacked-bar',
        data: rows,
        summary: totals
      });
    });
  });
}

function getProfitMarginAnalysis(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        DATE(created_at) as date,
        COALESCE(SUM(subtotal), 0) as revenue,
        COALESCE(SUM(discount_amount), 0) as discounts,
        COALESCE(SUM(total - subtotal + discount_amount), 0) as adjustments
      FROM orders
      WHERE DATE(created_at) BETWEEN ? AND ? AND ${PAID_STATUSES_SQL}
      GROUP BY DATE(created_at) ORDER BY date
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      
      const data = rows.map(r => ({
        ...r,
        margin: r.revenue > 0 ? ((r.revenue - r.discounts) / r.revenue * 100).toFixed(1) : 0
      }));
      
      resolve({
        title: 'Profit Margin Analysis',
        chartType: 'line',
        data
      });
    });
  });
}

// ==================== 단일 레포트 생성 ====================

async function generateSingleReport(db, reportId, startDate, endDate) {
  switch (reportId) {
    case 'daily-sales-overview':
      return await getHourlySales(db, startDate, endDate);
    case 'weekly-sales-trend':
      return await getWeeklySalesTrend(db, endDate);
    case 'day-of-week-performance':
      return await getDayOfWeekPerformance(db, startDate, endDate);
    case 'monthly-sales-comparison':
      return await getMonthlySalesComparison(db, startDate, endDate);
    case 'yearly-sales-analysis':
      return await getYearlySalesAnalysis(db, startDate, endDate);
    case 'void-refund-report':
      return await getVoidRefundReport(db, startDate, endDate);
    case 'discount-promotion-analysis':
      return await getDiscountPromotionAnalysis(db, startDate, endDate);
    case 'online-order-performance':
      return await getOnlineOrderPerformance(db, startDate, endDate);
    case 'channel-performance':
      return await getChannelPerformance(db, startDate, endDate);
    case 'channel-revenue-comparison':
      return await getChannelRevenueComparison(db, startDate, endDate);
    case 'channel-growth-analysis':
      return await getChannelGrowthAnalysis(db, startDate, endDate);
    case 'delivery-platform-revenue':
      return await getDeliveryPlatformRevenue(db, startDate, endDate);
    case 'gift-card-sales-detail':
      return await getGiftCardSalesDetail(db, startDate, endDate);
    case 'gift-card-redemption':
      return await getGiftCardRedemption(db, startDate, endDate);
    case 'tax-summary-report':
      return await getTaxSummaryReport(db, startDate, endDate);
    case 'comp-discount-tracking':
      return await getCompDiscountTracking(db, startDate, endDate);
    case 'revenue-per-labor-hour':
      return await getRevenuePerLaborHour(db, startDate, endDate);
    default:
      return { title: 'No Data', chartType: 'bar', data: [], summary: { message: 'Report not implemented' } };
  }
}

// Monthly Sales Comparison
function getMonthlySalesComparison(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        strftime('%Y-%m', o.created_at) as month,
        COUNT(DISTINCT o.id) as orders,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) / MAX(COUNT(DISTINCT o.id), 1) as avgCheck
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE DATE(o.created_at) BETWEEN ? AND ? AND ${PAID_STATUSES_SQL_O}
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
      GROUP BY month ORDER BY month
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      resolve({ title: 'Monthly Sales Comparison', chartType: 'bar', data: rows });
    });
  });
}

// Yearly Sales Analysis
function getYearlySalesAnalysis(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        strftime('%Y', o.created_at) as year,
        strftime('%m', o.created_at) as month,
        COUNT(DISTINCT o.id) as orders,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE DATE(o.created_at) BETWEEN ? AND ? AND ${PAID_STATUSES_SQL_O}
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
      GROUP BY year, month ORDER BY year, month
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      resolve({ title: 'Yearly Sales Analysis', chartType: 'area', data: rows });
    });
  });
}

// Void & Refund Report
function getVoidRefundReport(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        DATE(created_at) as date,
        void_reason as reason,
        COUNT(*) as count,
        COALESCE(SUM(void_amount), 0) as amount
      FROM voids
      WHERE DATE(created_at) BETWEEN ? AND ?
      GROUP BY date, void_reason ORDER BY date DESC
    `, [startDate, endDate], (err, rows) => {
      if (err) return resolve({ title: 'Void & Refund Report', chartType: 'bar', data: [] });
      resolve({ title: 'Void & Refund Report', chartType: 'bar', data: rows || [] });
    });
  });
}

// Discount & Promotion Analysis
function getDiscountPromotionAnalysis(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as orderCount,
        COALESCE(SUM(discount_amount), 0) as totalDiscount,
        COALESCE(AVG(discount_amount), 0) as avgDiscount
      FROM orders
      WHERE DATE(created_at) BETWEEN ? AND ? AND ${PAID_STATUSES_SQL} AND discount_amount > 0
      GROUP BY date ORDER BY date
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      resolve({ title: 'Discount & Promotion Analysis', chartType: 'bar', data: rows || [] });
    });
  });
}

// Online Order Performance
function getOnlineOrderPerformance(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        DATE(o.created_at) as date,
        COUNT(DISTINCT o.id) as orders,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE DATE(o.created_at) BETWEEN ? AND ? 
        AND ${PAID_STATUSES_SQL_O}
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
        AND o.order_type IN ('ONLINE', 'TABLE_QR', 'KIOSK')
      GROUP BY date ORDER BY date
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      resolve({ title: 'Online Order Performance', chartType: 'line', data: rows || [] });
    });
  });
}

// Channel Performance
function getChannelPerformance(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        COALESCE(o.order_type, 'DINE_IN') as channel,
        COUNT(DISTINCT o.id) as orders,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) / MAX(COUNT(DISTINCT o.id), 1) as avgCheck
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE DATE(o.created_at) BETWEEN ? AND ? AND ${PAID_STATUSES_SQL_O}
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
      GROUP BY o.order_type ORDER BY revenue DESC
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      resolve({ title: 'Channel Performance', chartType: 'bar', data: rows || [] });
    });
  });
}

// Channel Revenue Comparison
function getChannelRevenueComparison(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        DATE(o.created_at) as date,
        COALESCE(o.order_type, 'DINE_IN') as channel,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE DATE(o.created_at) BETWEEN ? AND ? AND ${PAID_STATUSES_SQL_O}
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
      GROUP BY date, o.order_type ORDER BY date, revenue DESC
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      resolve({ title: 'Channel Revenue Comparison', chartType: 'grouped-bar', data: rows || [] });
    });
  });
}

// Channel Growth Analysis
function getChannelGrowthAnalysis(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        strftime('%Y-%m', o.created_at) as month,
        COALESCE(o.order_type, 'DINE_IN') as channel,
        COUNT(DISTINCT o.id) as orders,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE DATE(o.created_at) BETWEEN ? AND ? AND ${PAID_STATUSES_SQL_O}
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
      GROUP BY month, o.order_type ORDER BY month
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      resolve({ title: 'Channel Growth Analysis', chartType: 'line', data: rows || [] });
    });
  });
}

// Delivery Platform Revenue
function getDeliveryPlatformRevenue(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        DATE(o.created_at) as date,
        COALESCE(o.delivery_platform, o.order_type) as platform,
        COUNT(DISTINCT o.id) as orders,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE DATE(o.created_at) BETWEEN ? AND ? 
        AND ${PAID_STATUSES_SQL_O}
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
        AND o.order_type IN ('DELIVERY', 'UBEREATS', 'DOORDASH', 'SKIP')
      GROUP BY date, platform ORDER BY date
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      resolve({ title: 'Delivery Platform Revenue', chartType: 'stacked-bar', data: rows || [] });
    });
  });
}

// Gift Card Sales Detail
function getGiftCardSalesDetail(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count,
        COALESCE(SUM(initial_balance), 0) as totalSold
      FROM gift_cards
      WHERE DATE(created_at) BETWEEN ? AND ?
      GROUP BY date ORDER BY date
    `, [startDate, endDate], (err, rows) => {
      if (err) return resolve({ title: 'Gift Card Sales', chartType: 'stacked-bar', data: [] });
      resolve({ title: 'Gift Card Sales', chartType: 'stacked-bar', data: rows || [] });
    });
  });
}

// Gift Card Redemption
function getGiftCardRedemption(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as transactions,
        COALESCE(SUM(amount), 0) as totalRedeemed
      FROM gift_card_transactions
      WHERE DATE(created_at) BETWEEN ? AND ? AND type = 'redeem'
      GROUP BY date ORDER BY date
    `, [startDate, endDate], (err, rows) => {
      if (err) return resolve({ title: 'Gift Card Redemption', chartType: 'line', data: [] });
      resolve({ title: 'Gift Card Redemption', chartType: 'line', data: rows || [] });
    });
  });
}

// Tax Summary Report
function getTaxSummaryReport(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        DATE(o.created_at) as date,
        COUNT(DISTINCT o.id) as orders,
        COALESCE(SUM(o.tax), 0) as totalTax,
        COALESCE(SUM(o.subtotal), 0) as subtotal,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as total
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE DATE(o.created_at) BETWEEN ? AND ? AND ${PAID_STATUSES_SQL_O}
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
      GROUP BY date ORDER BY date
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      resolve({ title: 'Tax Summary Report', chartType: 'stacked-bar', data: rows || [] });
    });
  });
}

// Comp & Discount Tracking
function getCompDiscountTracking(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        DATE(o.created_at) as date,
        COALESCE(oa.kind, 'OTHER') as type,
        COUNT(*) as count,
        COALESCE(SUM(oa.amount_applied), 0) as amount
      FROM order_adjustments oa
      JOIN orders o ON oa.order_id = o.id
      WHERE DATE(o.created_at) BETWEEN ? AND ?
      GROUP BY date, oa.kind ORDER BY date
    `, [startDate, endDate], (err, rows) => {
      if (err) return resolve({ title: 'Comp & Discount Tracking', chartType: 'bar', data: [] });
      resolve({ title: 'Comp & Discount Tracking', chartType: 'bar', data: rows || [] });
    });
  });
}

// Revenue Per Labor Hour
function getRevenuePerLaborHour(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        DATE(o.created_at) as date,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue,
        COUNT(DISTINCT e.id) as employeeCount
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      LEFT JOIN employees e ON 1=1
      WHERE DATE(o.created_at) BETWEEN ? AND ? AND ${PAID_STATUSES_SQL_O}
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
      GROUP BY date ORDER BY date
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      resolve({ title: 'Revenue Per Labor Hour', chartType: 'bar', data: rows || [] });
    });
  });
}

function getWeeklySalesTrend(db, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        DATE(o.created_at) as date,
        strftime('%w', o.created_at) as dayOfWeek,
        COUNT(DISTINCT o.id) as orders,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE DATE(o.created_at) BETWEEN DATE(?, '-6 days') AND DATE(?)
        AND ${PAID_STATUSES_SQL_O}
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
      GROUP BY DATE(o.created_at) ORDER BY date
    `, [endDate, endDate], (err, rows) => {
      if (err) return reject(err);
      
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      resolve({
        title: 'Weekly Sales Trend',
        chartType: 'line',
        data: rows.map(r => ({
          ...r,
          dayName: dayNames[parseInt(r.dayOfWeek)]
        }))
      });
    });
  });
}

function getDayOfWeekPerformance(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    db.all(`
      SELECT 
        CAST(strftime('%w', o.created_at) AS INTEGER) as dayOfWeek,
        COUNT(DISTINCT o.id) as orders,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE DATE(o.created_at) BETWEEN ? AND ? AND ${PAID_STATUSES_SQL_O}
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
      GROUP BY dayOfWeek ORDER BY dayOfWeek
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      
      const data = dayNames.map((name, idx) => {
        const found = rows.find(r => r.dayOfWeek === idx);
        return {
          dayOfWeek: idx,
          dayName: name,
          orders: found?.orders || 0,
          revenue: found?.revenue || 0
        };
      });
      
      resolve({ title: 'Day of Week Performance', chartType: 'bar', data });
    });
  });
}

// ==================== 프린트 텍스트 생성 ====================

async function generatePrintText(db, reportId, date, shiftId, width) {
  const line = '='.repeat(width);
  const dashLine = '-'.repeat(width);
  const center = (text) => {
    const pad = Math.max(0, Math.floor((width - text.length) / 2));
    return ' '.repeat(pad) + text;
  };
  const leftRight = (l, r) => {
    const space = Math.max(1, width - l.length - r.length);
    return l + ' '.repeat(space) + r;
  };
  const formatMoney = (amt) => `$${(amt || 0).toFixed(2)}`;
  
  let text = '';
  
  // Get business info
  const businessInfo = await new Promise((resolve) => {
    db.get('SELECT business_name FROM business_profile WHERE id = 1', [], (err, row) => {
      resolve(row || { business_name: 'Restaurant' });
    });
  });
  
  switch (reportId) {
    case 'daily-cash-report': {
      // Get daily cash data
      const payments = await new Promise((resolve) => {
        db.all(`
          SELECT payment_method, 
            COALESCE(SUM(CASE WHEN type = 'payment' THEN amount ELSE 0 END), 0) as payments,
            COALESCE(SUM(CASE WHEN type = 'tip' THEN amount ELSE 0 END), 0) as tips
          FROM payments
          WHERE DATE(created_at) = ?
          GROUP BY payment_method
        `, [date], (err, rows) => resolve(rows || []));
      });
      
      const totals = await new Promise((resolve) => {
        db.get(`
          SELECT 
            COUNT(DISTINCT o.id) as orderCount,
            COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as totalSales,
            COALESCE(SUM(o.tax), 0) as totalTax
          FROM payments p
          JOIN orders o ON p.order_id = o.id
          WHERE DATE(o.created_at) = ? AND ${PAID_STATUSES_SQL_O}
            AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
            AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
        `, [date], (err, row) => resolve(row || { orderCount: 0, totalSales: 0, totalTax: 0 }));
      });
      
      text += line + '\n';
      text += center(businessInfo.business_name || 'Restaurant') + '\n';
      text += center('DAILY CASH REPORT') + '\n';
      text += center(new Date(date).toLocaleDateString()) + '\n';
      text += line + '\n\n';
      
      text += 'PAYMENT BREAKDOWN\n';
      text += dashLine + '\n';
      
      let totalPayments = 0;
      let totalTips = 0;
      for (const p of payments) {
        text += leftRight(p.payment_method || 'OTHER', formatMoney(p.payments)) + '\n';
        totalPayments += p.payments;
        totalTips += p.tips;
      }
      
      text += dashLine + '\n';
      text += leftRight('Total Payments:', formatMoney(totalPayments)) + '\n';
      text += leftRight('Total Tips:', formatMoney(totalTips)) + '\n';
      text += '\n';
      
      text += 'SALES SUMMARY\n';
      text += dashLine + '\n';
      text += leftRight('Total Orders:', String(totals.orderCount)) + '\n';
      text += leftRight('Total Sales:', formatMoney(totals.totalSales)) + '\n';
      text += leftRight('Total Tax:', formatMoney(totals.totalTax)) + '\n';
      text += line + '\n';
      text += center(`Generated: ${new Date().toLocaleString()}`) + '\n';
      break;
    }
    
    case 'daily-summary-report': {
      const summary = await new Promise((resolve) => {
        db.get(`
          SELECT 
            COUNT(DISTINCT o.id) as orderCount,
            COALESCE(SUM(o.subtotal), 0) as subtotal,
            COALESCE(SUM(o.tax), 0) as tax,
            COALESCE(SUM(o.discount_amount), 0) as discounts,
            COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as total,
            COALESCE(SUM(o.guests), 0) as guests,
            COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) / MAX(COUNT(DISTINCT o.id), 1) as avgCheck
          FROM payments p
          JOIN orders o ON p.order_id = o.id
          WHERE DATE(o.created_at) = ? AND ${PAID_STATUSES_SQL_O}
            AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
            AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
        `, [date], (err, row) => resolve(row || {}));
      });
      
      const byChannel = await new Promise((resolve) => {
        db.all(`
          SELECT 
            COALESCE(o.order_type, 'DINE_IN') as channel,
            COUNT(DISTINCT o.id) as orders,
            COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue
          FROM payments p
          JOIN orders o ON p.order_id = o.id
          WHERE DATE(o.created_at) = ? AND ${PAID_STATUSES_SQL_O}
            AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
            AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
          GROUP BY o.order_type ORDER BY revenue DESC
        `, [date], (err, rows) => resolve(rows || []));
      });
      
      const byHour = await new Promise((resolve) => {
        db.all(`
          SELECT 
            CAST(strftime('%H', o.created_at) AS INTEGER) as hour,
            COUNT(DISTINCT o.id) as orders,
            COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue
          FROM payments p
          JOIN orders o ON p.order_id = o.id
          WHERE DATE(o.created_at) = ? AND ${PAID_STATUSES_SQL_O}
            AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
            AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
          GROUP BY hour ORDER BY hour
        `, [date], (err, rows) => resolve(rows || []));
      });
      
      text += line + '\n';
      text += center(businessInfo.business_name || 'Restaurant') + '\n';
      text += center('DAILY SUMMARY REPORT') + '\n';
      text += center(new Date(date).toLocaleDateString()) + '\n';
      text += line + '\n\n';
      
      text += 'SALES OVERVIEW\n';
      text += dashLine + '\n';
      text += leftRight('Total Orders:', String(summary.orderCount || 0)) + '\n';
      text += leftRight('Total Guests:', String(summary.guests || 0)) + '\n';
      text += leftRight('Subtotal:', formatMoney(summary.subtotal)) + '\n';
      text += leftRight('Tax:', formatMoney(summary.tax)) + '\n';
      text += leftRight('Discounts:', formatMoney(summary.discounts)) + '\n';
      text += leftRight('TOTAL:', formatMoney(summary.total)) + '\n';
      text += leftRight('Avg Check:', formatMoney(summary.avgCheck)) + '\n\n';
      
      text += 'BY CHANNEL\n';
      text += dashLine + '\n';
      for (const ch of byChannel) {
        text += leftRight(`${ch.channel} (${ch.orders})`, formatMoney(ch.revenue)) + '\n';
      }
      text += '\n';
      
      text += 'BY HOUR\n';
      text += dashLine + '\n';
      for (const h of byHour) {
        const hourStr = `${String(h.hour).padStart(2, '0')}:00`;
        text += leftRight(`${hourStr} (${h.orders})`, formatMoney(h.revenue)) + '\n';
      }
      
      text += line + '\n';
      text += center(`Generated: ${new Date().toLocaleString()}`) + '\n';
      break;
    }
    
    case 'shift-close-report': {
      const shiftData = await new Promise((resolve) => {
        db.get(`
          SELECT 
            COUNT(DISTINCT o.id) as orderCount,
            COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as total,
            COALESCE(SUM(o.tax), 0) as tax
          FROM payments p
          JOIN orders o ON p.order_id = o.id
          WHERE DATE(o.created_at) = ? AND ${PAID_STATUSES_SQL_O}
            AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
            AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
        `, [date], (err, row) => resolve(row || {}));
      });
      
      const cashPayments = await new Promise((resolve) => {
        db.get(`
          SELECT COALESCE(SUM(amount), 0) as cash
          FROM payments
          WHERE DATE(created_at) = ? AND payment_method = 'CASH' AND type = 'payment'
        `, [date], (err, row) => resolve(row?.cash || 0));
      });
      
      const cardPayments = await new Promise((resolve) => {
        db.get(`
          SELECT COALESCE(SUM(amount), 0) as card
          FROM payments
          WHERE DATE(created_at) = ? AND payment_method != 'CASH' AND type = 'payment'
        `, [date], (err, row) => resolve(row?.card || 0));
      });
      
      text += line + '\n';
      text += center(businessInfo.business_name || 'Restaurant') + '\n';
      text += center('SHIFT CLOSE REPORT') + '\n';
      text += center(new Date(date).toLocaleDateString()) + '\n';
      text += line + '\n\n';
      
      text += 'SHIFT SUMMARY\n';
      text += dashLine + '\n';
      text += leftRight('Total Orders:', String(shiftData.orderCount || 0)) + '\n';
      text += leftRight('Total Sales:', formatMoney(shiftData.total)) + '\n';
      text += leftRight('Tax Collected:', formatMoney(shiftData.tax)) + '\n\n';
      
      text += 'CASH DRAWER\n';
      text += dashLine + '\n';
      text += leftRight('Cash Received:', formatMoney(cashPayments)) + '\n';
      text += leftRight('Card Payments:', formatMoney(cardPayments)) + '\n';
      text += dashLine + '\n';
      text += leftRight('Expected Cash:', formatMoney(cashPayments)) + '\n';
      
      text += '\n';
      text += line + '\n';
      text += center(`Generated: ${new Date().toLocaleString()}`) + '\n';
      break;
    }
    
    default:
      text += line + '\n';
      text += center(reportId.toUpperCase().replace(/-/g, ' ')) + '\n';
      text += center(new Date(date).toLocaleDateString()) + '\n';
      text += line + '\n';
      text += center('No data available for this report') + '\n';
      text += line + '\n';
  }
  
  return text;
}

// ==================== CSV 생성 (엑셀 호환) ====================

function generateCSV(reportDef, data) {
  let csv = '';
  
  // 헤더
  csv += `Report: ${reportDef.name}\n`;
  csv += `Generated: ${new Date().toISOString()}\n\n`;
  
  if (data.sections) {
    // 통합 레포트
    for (const [sectionKey, section] of Object.entries(data.sections)) {
      csv += `\n--- ${section.title || sectionKey} ---\n`;
      
      if (section.data && section.data.length > 0) {
        const headers = Object.keys(section.data[0]);
        csv += headers.join(',') + '\n';
        
        for (const row of section.data) {
          csv += headers.map(h => {
            const val = row[h];
            if (typeof val === 'string' && val.includes(',')) {
              return `"${val}"`;
            }
            return val;
          }).join(',') + '\n';
        }
      }
      
      if (section.summary) {
        csv += '\nSummary:\n';
        for (const [key, val] of Object.entries(section.summary)) {
          csv += `${key},${val}\n`;
        }
      }
    }
  } else if (data.data) {
    // 단일 레포트
    if (Array.isArray(data.data) && data.data.length > 0) {
      const headers = Object.keys(data.data[0]);
      csv += headers.join(',') + '\n';
      
      for (const row of data.data) {
        csv += headers.map(h => {
          const val = row[h];
          if (typeof val === 'string' && val.includes(',')) {
            return `"${val}"`;
          }
          return val;
        }).join(',') + '\n';
      }
    }
  }
  
  return csv;
}

// ==================== OPERATIONAL REPORTS API ====================

function dbAllPromise(sql, params = []) {
  return new Promise((resolve, reject) => {
    const database = getDatabase();
    database.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

// Daily Operations Dashboard
router.get('/operational/daily', async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().slice(0, 10);
    const yesterday = new Date(new Date(targetDate).getTime() - 86400000).toISOString().slice(0, 10);

    const hourlySales = await dbAllPromise(`
      SELECT strftime('%H', o.created_at) as hour,
        COUNT(DISTINCT o.id) as order_count,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE DATE(o.created_at) = ? AND ${PAID_STATUSES_SQL_O}
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
      GROUP BY strftime('%H', o.created_at)
      ORDER BY hour
    `, [targetDate]);

    const yesterdayHourly = await dbAllPromise(`
      SELECT strftime('%H', o.created_at) as hour,
        COUNT(DISTINCT o.id) as order_count,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE DATE(o.created_at) = ? AND ${PAID_STATUSES_SQL_O}
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
      GROUP BY strftime('%H', o.created_at)
      ORDER BY hour
    `, [yesterday]);

    const paymentBreakdown = await dbAllPromise(`
      SELECT p.payment_method,
        COUNT(*) as count,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as net_amount,
        COALESCE(SUM(COALESCE(p.tip, 0)), 0) as tips
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE DATE(o.created_at) = ? AND p.status = 'APPROVED' AND ${PAID_STATUSES_SQL_O}
      GROUP BY p.payment_method
    `, [targetDate]);

    const tableTurnover = await dbAllPromise(`
      SELECT table_name,
        COUNT(*) as order_count,
        MIN(created_at) as first_order,
        MAX(closed_at) as last_close,
        COALESCE(AVG(
          CASE WHEN closed_at IS NOT NULL AND created_at IS NOT NULL
          THEN (julianday(closed_at) - julianday(created_at)) * 24 * 60
          END
        ), 0) as avg_duration_min
      FROM orders
      WHERE DATE(created_at) = ? AND ${PAID_STATUSES_SQL}
        AND table_name IS NOT NULL AND table_name != ''
      GROUP BY table_name
      ORDER BY order_count DESC
    `, [targetDate]);

    const todaySummary = await dbAllPromise(`
      SELECT COUNT(DISTINCT o.id) as order_count,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as total_sales,
        0 as subtotal,
        0 as tax_total,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) / MAX(COUNT(DISTINCT o.id), 1) as avg_check,
        COALESCE(SUM(o.guest_count), 0) as guest_count
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE DATE(o.created_at) = ? AND ${PAID_STATUSES_SQL_O}
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
    `, [targetDate]);

    const yesterdaySummary = await dbAllPromise(`
      SELECT COUNT(DISTINCT o.id) as order_count,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as total_sales,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) / MAX(COUNT(DISTINCT o.id), 1) as avg_check
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE DATE(o.created_at) = ? AND ${PAID_STATUSES_SQL_O}
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
    `, [yesterday]);

    const refundsVoids = await dbAllPromise(`
      SELECT 'refund' as type, COUNT(*) as count, COALESCE(SUM(total), 0) as total
      FROM refunds WHERE DATE(created_at) = ?
      UNION ALL
      SELECT 'void' as type, COUNT(*) as count, COALESCE(SUM(grand_total), 0) as total
      FROM voids WHERE DATE(created_at) = ?
    `, [targetDate, targetDate]);

    res.json({
      success: true,
      data: {
        date: targetDate,
        summary: todaySummary[0] || {},
        yesterdaySummary: yesterdaySummary[0] || {},
        hourlySales,
        yesterdayHourly,
        paymentBreakdown,
        tableTurnover,
        refundsVoids
      }
    });
  } catch (e) {
    console.error('[Operational Reports] Daily error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Weekly Performance Report
router.get('/operational/weekly', async (req, res) => {
  try {
    const { endDate } = req.query;
    const end = endDate || new Date().toISOString().slice(0, 10);
    const start = new Date(new Date(end).getTime() - 6 * 86400000).toISOString().slice(0, 10);
    const prevStart = new Date(new Date(start).getTime() - 7 * 86400000).toISOString().slice(0, 10);
    const prevEnd = new Date(new Date(start).getTime() - 86400000).toISOString().slice(0, 10);

    const dailySales = await dbAllPromise(`
      SELECT DATE(o.created_at) as date,
        strftime('%w', o.created_at) as day_of_week,
        COUNT(DISTINCT o.id) as order_count,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) / MAX(COUNT(DISTINCT o.id), 1) as avg_check,
        0 as guest_count
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE DATE(o.created_at) BETWEEN ? AND ? AND ${PAID_STATUSES_SQL_O}
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
      GROUP BY DATE(o.created_at)
      ORDER BY date
    `, [start, end]);

    const prevWeekSales = await dbAllPromise(`
      SELECT COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue,
        COUNT(DISTINCT o.id) as order_count
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE DATE(o.created_at) BETWEEN ? AND ? AND ${PAID_STATUSES_SQL_O}
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
    `, [prevStart, prevEnd]);

    const topItems = await dbAllPromise(`
      SELECT oi.name, SUM(oi.quantity) as qty, COALESCE(SUM(oi.price * oi.quantity), 0) as revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE DATE(o.created_at) BETWEEN ? AND ? AND ${PAID_STATUSES_SQL_O}
        AND COALESCE(oi.is_voided, 0) = 0
      GROUP BY oi.name
      ORDER BY qty DESC
      LIMIT 10
    `, [start, end]);

    const worstItems = await dbAllPromise(`
      SELECT oi.name, SUM(oi.quantity) as qty, COALESCE(SUM(oi.price * oi.quantity), 0) as revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE DATE(o.created_at) BETWEEN ? AND ? AND ${PAID_STATUSES_SQL_O}
        AND COALESCE(oi.is_voided, 0) = 0
      GROUP BY oi.name
      ORDER BY qty ASC
      LIMIT 10
    `, [start, end]);

    const employeeSales = await dbAllPromise(`
      SELECT COALESCE(o.server_name, o.employee_id, 'Unknown') as employee,
        COUNT(DISTINCT o.id) as order_count,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) / MAX(COUNT(DISTINCT o.id), 1) as avg_check
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE DATE(o.created_at) BETWEEN ? AND ? AND ${PAID_STATUSES_SQL_O}
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
      GROUP BY COALESCE(o.server_name, o.employee_id, 'Unknown')
      ORDER BY revenue DESC
    `, [start, end]);

    const thisWeekTotal = dailySales.reduce((s, d) => s + d.revenue, 0);
    const prevWeekTotal = prevWeekSales[0]?.revenue || 0;
    const growthRate = prevWeekTotal > 0 ? ((thisWeekTotal - prevWeekTotal) / prevWeekTotal * 100) : 0;

    res.json({
      success: true,
      data: {
        period: { start, end },
        dailySales,
        totalRevenue: thisWeekTotal,
        totalOrders: dailySales.reduce((s, d) => s + d.order_count, 0),
        avgCheck: thisWeekTotal / Math.max(dailySales.reduce((s, d) => s + d.order_count, 0), 1),
        prevWeekRevenue: prevWeekTotal,
        growthRate: Math.round(growthRate * 10) / 10,
        topItems,
        worstItems,
        employeeSales
      }
    });
  } catch (e) {
    console.error('[Operational Reports] Weekly error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Monthly Management Report
router.get('/operational/monthly', async (req, res) => {
  try {
    const { month } = req.query;
    const targetMonth = month || new Date().toISOString().slice(0, 7);
    const [year, mon] = targetMonth.split('-').map(Number);
    const prevMonth = mon === 1 ? `${year - 1}-12` : `${year}-${String(mon - 1).padStart(2, '0')}`;
    const prevYearMonth = `${year - 1}-${String(mon).padStart(2, '0')}`;

    const dailySales = await dbAllPromise(`
      SELECT DATE(o.created_at) as date,
        COUNT(DISTINCT o.id) as order_count,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) / MAX(COUNT(DISTINCT o.id), 1) as avg_check
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE strftime('%Y-%m', o.created_at) = ? AND ${PAID_STATUSES_SQL_O}
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
      GROUP BY DATE(o.created_at)
      ORDER BY date
    `, [targetMonth]);

    const prevMonthSummary = await dbAllPromise(`
      SELECT COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue,
        COUNT(DISTINCT o.id) as order_count,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) / MAX(COUNT(DISTINCT o.id), 1) as avg_check
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE strftime('%Y-%m', o.created_at) = ? AND ${PAID_STATUSES_SQL_O}
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
    `, [prevMonth]);

    const prevYearSummary = await dbAllPromise(`
      SELECT COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue,
        COUNT(DISTINCT o.id) as order_count
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE strftime('%Y-%m', o.created_at) = ? AND ${PAID_STATUSES_SQL_O}
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
    `, [prevYearMonth]);

    const categorySales = await dbAllPromise(`
      SELECT COALESCE(c.name, 'Uncategorized') as category,
        SUM(oi.quantity) as qty,
        COALESCE(SUM(oi.price * oi.quantity), 0) as revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN menu_items mi ON oi.item_id = mi.item_id
      LEFT JOIN menu_categories c ON mi.category_id = c.category_id
      WHERE strftime('%Y-%m', o.created_at) = ? AND ${PAID_STATUSES_SQL_O}
        AND COALESCE(oi.is_voided, 0) = 0
      GROUP BY c.category_id
      ORDER BY revenue DESC
    `, [targetMonth]);

    const hourlySales = await dbAllPromise(`
      SELECT strftime('%H', o.created_at) as hour,
        COUNT(DISTINCT o.id) as order_count,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE strftime('%Y-%m', o.created_at) = ? AND ${PAID_STATUSES_SQL_O}
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
      GROUP BY strftime('%H', o.created_at)
      ORDER BY hour
    `, [targetMonth]);

    const discountSummary = await dbAllPromise(`
      SELECT COALESCE(oa.label, oa.kind, 'Discount') as discount_type,
        COUNT(*) as count,
        COALESCE(SUM(oa.amount_applied), 0) as total_amount
      FROM order_adjustments oa
      JOIN orders o ON oa.order_id = o.id
      WHERE strftime('%Y-%m', o.created_at) = ? AND ${PAID_STATUSES_SQL_O}
        AND COALESCE(oa.amount_applied, 0) > 0
        AND UPPER(COALESCE(oa.kind, '')) IN ('DISCOUNT','PROMOTION','CHANNEL_DISCOUNT','COUPON')
      GROUP BY COALESCE(oa.label, oa.kind, 'Discount')
      ORDER BY total_amount DESC
    `, [targetMonth]);

    const channelSales = await dbAllPromise(`
      SELECT COALESCE(o.order_type, 'DINE_IN') as channel,
        COUNT(DISTINCT o.id) as order_count,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE strftime('%Y-%m', o.created_at) = ? AND ${PAID_STATUSES_SQL_O}
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
      GROUP BY o.order_type
      ORDER BY revenue DESC
    `, [targetMonth]);

    const thisMonthTotal = dailySales.reduce((s, d) => s + d.revenue, 0);
    const thisMonthOrders = dailySales.reduce((s, d) => s + d.order_count, 0);
    const prevMTotal = prevMonthSummary[0]?.revenue || 0;
    const prevYTotal = prevYearSummary[0]?.revenue || 0;

    res.json({
      success: true,
      data: {
        month: targetMonth,
        totalRevenue: thisMonthTotal,
        totalOrders: thisMonthOrders,
        avgCheck: thisMonthTotal / Math.max(thisMonthOrders, 1),
        prevMonthRevenue: prevMTotal,
        prevMonthGrowth: prevMTotal > 0 ? Math.round((thisMonthTotal - prevMTotal) / prevMTotal * 1000) / 10 : 0,
        prevYearRevenue: prevYTotal,
        yoyGrowth: prevYTotal > 0 ? Math.round((thisMonthTotal - prevYTotal) / prevYTotal * 1000) / 10 : 0,
        dailySales,
        categorySales,
        hourlySales,
        discountSummary,
        channelSales
      }
    });
  } catch (e) {
    console.error('[Operational Reports] Monthly error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Quarterly/Annual Trend Report
router.get('/operational/trend', async (req, res) => {
  try {
    const { months } = req.query;
    const numMonths = Math.min(parseInt(months) || 12, 24);
    const now = new Date();

    const monthlySales = await dbAllPromise(`
      SELECT strftime('%Y-%m', o.created_at) as month,
        COUNT(DISTINCT o.id) as order_count,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) / MAX(COUNT(DISTINCT o.id), 1) as avg_check,
        0 as guest_count
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE o.created_at >= date('now', '-${numMonths} months') AND ${PAID_STATUSES_SQL_O}
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
      GROUP BY strftime('%Y-%m', o.created_at)
      ORDER BY month
    `);

    const topItemsTrend = await dbAllPromise(`
      SELECT strftime('%Y-%m', o.created_at) as month,
        oi.name,
        SUM(oi.quantity) as qty,
        COALESCE(SUM(oi.price * oi.quantity), 0) as revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE o.created_at >= date('now', '-${numMonths} months') AND ${PAID_STATUSES_SQL_O}
        AND COALESCE(oi.is_voided, 0) = 0
      GROUP BY strftime('%Y-%m', o.created_at), oi.name
      ORDER BY month, revenue DESC
    `);

    const channelTrend = await dbAllPromise(`
      SELECT strftime('%Y-%m', o.created_at) as month,
        COALESCE(o.order_type, 'DINE_IN') as channel,
        COUNT(DISTINCT o.id) as order_count,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE o.created_at >= date('now', '-${numMonths} months') AND ${PAID_STATUSES_SQL_O}
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
      GROUP BY strftime('%Y-%m', o.created_at), o.order_type
      ORDER BY month
    `);

    // YoY growth
    const yoyData = [];
    for (const ms of monthlySales) {
      const [y, m] = ms.month.split('-').map(Number);
      const prevYearMonth = `${y - 1}-${String(m).padStart(2, '0')}`;
      const prev = monthlySales.find(x => x.month === prevYearMonth);
      yoyData.push({
        month: ms.month,
        revenue: ms.revenue,
        prevYearRevenue: prev?.revenue || 0,
        growth: prev?.revenue > 0 ? Math.round((ms.revenue - prev.revenue) / prev.revenue * 1000) / 10 : null
      });
    }

    // Simple trend line (linear regression for forecast)
    const revenueArr = monthlySales.map(m => m.revenue);
    let forecast = [];
    if (revenueArr.length >= 3) {
      const n = revenueArr.length;
      const sumX = n * (n - 1) / 2;
      const sumY = revenueArr.reduce((a, b) => a + b, 0);
      const sumXY = revenueArr.reduce((a, y, i) => a + i * y, 0);
      const sumX2 = Array.from({ length: n }, (_, i) => i * i).reduce((a, b) => a + b, 0);
      const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
      const intercept = (sumY - slope * sumX) / n;

      for (let i = 0; i < 3; i++) {
        const idx = n + i;
        const forecastMonth = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
        forecast.push({
          month: forecastMonth.toISOString().slice(0, 7),
          predicted: Math.max(0, Math.round(intercept + slope * idx))
        });
      }
    }

    res.json({
      success: true,
      data: {
        months: numMonths,
        monthlySales,
        yoyData,
        channelTrend,
        topItemsTrend,
        forecast
      }
    });
  } catch (e) {
    console.error('[Operational Reports] Trend error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;

