// backend/routes/reports.js
// 레스토랑 레포트 API - 40개 레포트 시스템

const express = require('express');
const reportSyncService = require('../services/reportSyncService');

const router = express.Router();

// 공유 데이터베이스 모듈 사용 (환경 변수 DB_PATH 지원 - Electron 앱 호환)
const { db } = require('../db');

// 데이터베이스 연결 (레거시 호환)
const getDatabase = () => db;

// ==================== 유틸리티 함수 ====================

// 날짜 범위 파싱
const parseDateRange = (startDate, endDate) => {
  const start = startDate || new Date().toISOString().split('T')[0];
  const end = endDate || start;
  return { start, end };
};

// 시간대별 그룹핑 쿼리 헬퍼
const getHourlyGroupQuery = () => `
  CAST(strftime('%H', created_at) AS INTEGER) as hour
`;

// ==================== 레포트 목록 정의 ====================

const REPORT_DEFINITIONS = {
  // ===== 프린터용 텍스트 레포트 (3개) =====
  'daily-cash-report': {
    id: 'daily-cash-report',
    name: 'Daily Cash Report',
    category: 'sales',
    type: 'text',
    description: 'Opening/Closing cash, tips, and cash summary for printer',
    printable: true
  },
  'daily-summary-report': {
    id: 'daily-summary-report', 
    name: 'Daily Summary Report',
    category: 'sales',
    type: 'text',
    description: 'Complete daily sales summary for end-of-day closing',
    printable: true
  },
  'shift-close-report': {
    id: 'shift-close-report',
    name: 'Shift Close Report',
    category: 'sales',
    type: 'text',
    description: 'Shift closing report with cash drawer reconciliation',
    printable: true
  },

  // ===== 매출 그래프 레포트 (32개) =====
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
  'hourly-sales-distribution': {
    id: 'hourly-sales-distribution',
    name: 'Hourly Sales Distribution',
    category: 'sales',
    type: 'graph',
    chartType: 'bar',
    description: 'Sales distribution by hour of day'
  },
  'day-of-week-performance': {
    id: 'day-of-week-performance',
    name: 'Day of Week Performance',
    category: 'sales',
    type: 'graph',
    chartType: 'bar',
    description: 'Sales performance by day of week'
  },
  'category-sales-breakdown': {
    id: 'category-sales-breakdown',
    name: 'Category Sales Breakdown',
    category: 'sales',
    type: 'graph',
    chartType: 'pie',
    description: 'Sales breakdown by menu category'
  },
  'menu-item-performance': {
    id: 'menu-item-performance',
    name: 'Menu Item Performance',
    category: 'sales',
    type: 'graph',
    chartType: 'bar',
    description: 'Individual menu item sales performance'
  },
  'top-selling-items': {
    id: 'top-selling-items',
    name: 'Top Selling Items',
    category: 'sales',
    type: 'graph',
    chartType: 'horizontal-bar',
    description: 'Best selling menu items ranked'
  },
  'slow-moving-items': {
    id: 'slow-moving-items',
    name: 'Slow Moving Items',
    category: 'sales',
    type: 'graph',
    chartType: 'horizontal-bar',
    description: 'Least selling items that may need attention'
  },
  'average-check-size': {
    id: 'average-check-size',
    name: 'Average Check Size',
    category: 'sales',
    type: 'graph',
    chartType: 'line',
    description: 'Average order value trends'
  },
  'guest-count-trend': {
    id: 'guest-count-trend',
    name: 'Guest Count Trend',
    category: 'sales',
    type: 'graph',
    chartType: 'line',
    description: 'Number of guests over time'
  },
  'table-turnover-rate': {
    id: 'table-turnover-rate',
    name: 'Table Turnover Rate',
    category: 'sales',
    type: 'graph',
    chartType: 'bar',
    description: 'How quickly tables are turned over'
  },
  'revenue-per-seat': {
    id: 'revenue-per-seat',
    name: 'Revenue Per Seat',
    category: 'sales',
    type: 'graph',
    chartType: 'bar',
    description: 'Average revenue generated per seat'
  },
  'peak-hours-analysis': {
    id: 'peak-hours-analysis',
    name: 'Peak Hours Analysis',
    category: 'sales',
    type: 'graph',
    chartType: 'heatmap',
    description: 'Identify busiest hours and days'
  },
  'payment-method-breakdown': {
    id: 'payment-method-breakdown',
    name: 'Payment Method Breakdown',
    category: 'sales',
    type: 'graph',
    chartType: 'pie',
    description: 'Sales by payment method (Cash, Card, etc.)'
  },
  'cash-vs-card-ratio': {
    id: 'cash-vs-card-ratio',
    name: 'Cash vs Card Ratio',
    category: 'sales',
    type: 'graph',
    chartType: 'donut',
    description: 'Ratio of cash to card payments over time'
  },
  'discount-promotion-analysis': {
    id: 'discount-promotion-analysis',
    name: 'Discount & Promotion Analysis',
    category: 'sales',
    type: 'graph',
    chartType: 'bar',
    description: 'Impact of discounts and promotions on sales'
  },
  'void-refund-report': {
    id: 'void-refund-report',
    name: 'Void & Refund Report',
    category: 'sales',
    type: 'graph',
    chartType: 'bar',
    description: 'Track voids and refunds with reasons'
  },
  'tax-summary-report': {
    id: 'tax-summary-report',
    name: 'Tax Summary Report',
    category: 'sales',
    type: 'graph',
    chartType: 'stacked-bar',
    description: 'Tax collected by category and period'
  },
  'modifier-sales-analysis': {
    id: 'modifier-sales-analysis',
    name: 'Modifier Sales Analysis',
    category: 'sales',
    type: 'graph',
    chartType: 'bar',
    description: 'Revenue from modifiers and add-ons'
  },
  'order-source-analysis': {
    id: 'order-source-analysis',
    name: 'Order Source Analysis',
    category: 'sales',
    type: 'graph',
    chartType: 'pie',
    description: 'Orders by source (Dine-in, Takeout, Delivery)'
  },
  'online-order-performance': {
    id: 'online-order-performance',
    name: 'Online Order Performance',
    category: 'sales',
    type: 'graph',
    chartType: 'line',
    description: 'Online ordering trends and performance'
  },
  'channel-performance': {
    id: 'channel-performance',
    name: 'Channel Performance',
    category: 'sales',
    type: 'graph',
    chartType: 'bar',
    description: 'Revenue by sales channel comparison'
  },
  'tip-analysis': {
    id: 'tip-analysis',
    name: 'Tip Analysis',
    category: 'sales',
    type: 'graph',
    chartType: 'line',
    description: 'Tip trends and averages'
  },
  'service-charge-report': {
    id: 'service-charge-report',
    name: 'Service Charge Report',
    category: 'sales',
    type: 'graph',
    chartType: 'bar',
    description: 'Service charges collected'
  },
  'gross-vs-net-revenue': {
    id: 'gross-vs-net-revenue',
    name: 'Gross vs Net Revenue',
    category: 'sales',
    type: 'graph',
    chartType: 'stacked-bar',
    description: 'Gross revenue compared to net after discounts'
  },
  'profit-margin-analysis': {
    id: 'profit-margin-analysis',
    name: 'Profit Margin Analysis',
    category: 'sales',
    type: 'graph',
    chartType: 'line',
    description: 'Profit margins over time'
  },
  'revenue-per-labor-hour': {
    id: 'revenue-per-labor-hour',
    name: 'Revenue Per Labor Hour',
    category: 'sales',
    type: 'graph',
    chartType: 'bar',
    description: 'Sales efficiency per labor hour'
  },
  'comp-discount-tracking': {
    id: 'comp-discount-tracking',
    name: 'Comp & Discount Tracking',
    category: 'sales',
    type: 'graph',
    chartType: 'bar',
    description: 'Track comps and discounts given'
  },
  'gift-card-report': {
    id: 'gift-card-report',
    name: 'Gift Card Sales & Redemption',
    category: 'sales',
    type: 'graph',
    chartType: 'stacked-bar',
    description: 'Gift card sales and redemption tracking'
  },
  'sales-by-table': {
    id: 'sales-by-table',
    name: 'Sales By Table',
    category: 'sales',
    type: 'graph',
    chartType: 'bar',
    description: 'Revenue generated by each table'
  },
  'dwell-time-analysis': {
    id: 'dwell-time-analysis',
    name: 'Dwell Time Analysis',
    category: 'sales',
    type: 'graph',
    chartType: 'bar',
    description: 'Average time customers spend at tables'
  },

  // ===== 기프트카드 레포트 (2개 추가) =====
  'gift-card-sales-detail': {
    id: 'gift-card-sales-detail',
    name: 'Gift Card Sales Detail',
    category: 'sales',
    type: 'graph',
    chartType: 'stacked-bar',
    description: 'Detailed gift card sales by denomination and date'
  },
  'gift-card-redemption': {
    id: 'gift-card-redemption',
    name: 'Gift Card Redemption',
    category: 'sales',
    type: 'graph',
    chartType: 'line',
    description: 'Gift card usage and remaining balance tracking'
  },

  // ===== 판매채널별 매출 레포트 (2개 추가) =====
  'channel-revenue-comparison': {
    id: 'channel-revenue-comparison',
    name: 'Channel Revenue Comparison',
    category: 'sales',
    type: 'graph',
    chartType: 'grouped-bar',
    description: 'Side-by-side revenue comparison across all sales channels'
  },
  'channel-growth-analysis': {
    id: 'channel-growth-analysis',
    name: 'Channel Growth Analysis',
    category: 'sales',
    type: 'graph',
    chartType: 'line',
    description: 'Sales growth trends by channel over time'
  },
  'delivery-platform-revenue': {
    id: 'delivery-platform-revenue',
    name: 'Delivery Platform Revenue',
    category: 'sales',
    type: 'graph',
    chartType: 'stacked-bar',
    description: 'Revenue breakdown by delivery platform (UberEats, DoorDash, SkipTheDishes, etc.)'
  },

  // ===== 직원 레포트 (5개) =====
  'employee-sales-performance': {
    id: 'employee-sales-performance',
    name: 'Employee Sales Performance',
    category: 'employee',
    type: 'graph',
    chartType: 'bar',
    description: 'Sales performance by employee'
  },
  'server-performance-comparison': {
    id: 'server-performance-comparison',
    name: 'Server Performance Comparison',
    category: 'employee',
    type: 'graph',
    chartType: 'radar',
    description: 'Compare server metrics side by side'
  },
  'tips-by-employee': {
    id: 'tips-by-employee',
    name: 'Tips By Employee',
    category: 'employee',
    type: 'graph',
    chartType: 'bar',
    description: 'Tip earnings by employee'
  },
  'labor-cost-analysis': {
    id: 'labor-cost-analysis',
    name: 'Labor Cost Analysis',
    category: 'employee',
    type: 'graph',
    chartType: 'stacked-area',
    description: 'Labor costs as percentage of revenue'
  },
  'clock-in-out-summary': {
    id: 'clock-in-out-summary',
    name: 'Clock In/Out Summary',
    category: 'employee',
    type: 'graph',
    chartType: 'timeline',
    description: 'Employee attendance and hours worked'
  }
};

// ==================== API 엔드포인트 ====================

// GET /api/reports - 모든 레포트 목록
router.get('/', (req, res) => {
  try {
    const reports = Object.values(REPORT_DEFINITIONS);
    
    const salesReports = reports.filter(r => r.category === 'sales');
    const employeeReports = reports.filter(r => r.category === 'employee');
    const printableReports = reports.filter(r => r.printable);
    
    res.json({
      total: reports.length,
      categories: {
        sales: salesReports.length,
        employee: employeeReports.length
      },
      printable: printableReports.length,
      reports: reports
    });
  } catch (error) {
    console.error('Error getting reports list:', error);
    res.status(500).json({ error: 'Failed to get reports list' });
  }
});

// GET /api/reports/:reportId - 특정 레포트 데이터
router.get('/:reportId', async (req, res) => {
  try {
    const { reportId } = req.params;
    const { startDate, endDate, employeeId, shiftId } = req.query;
    
    const reportDef = REPORT_DEFINITIONS[reportId];
    if (!reportDef) {
      return res.status(404).json({ error: 'Report not found' });
    }
    
    const { start, end } = parseDateRange(startDate, endDate);
    
    const db = getDatabase();
    
    // 레포트별 데이터 생성
    let data;
    switch (reportId) {
      case 'daily-cash-report':
        data = await getDailyCashReport(db, start, shiftId);
        break;
      case 'daily-summary-report':
        data = await getDailySummaryReport(db, start);
        break;
      case 'shift-close-report':
        data = await getShiftCloseReport(db, start, shiftId);
        break;
      case 'daily-sales-overview':
        data = await getDailySalesOverview(db, start);
        break;
      case 'weekly-sales-trend':
        data = await getWeeklySalesTrend(db, start);
        break;
      case 'monthly-sales-comparison':
        data = await getMonthlySalesComparison(db, start);
        break;
      case 'hourly-sales-distribution':
        data = await getHourlySalesDistribution(db, start, end);
        break;
      case 'day-of-week-performance':
        data = await getDayOfWeekPerformance(db, start, end);
        break;
      case 'category-sales-breakdown':
        data = await getCategorySalesBreakdown(db, start, end);
        break;
      case 'top-selling-items':
        data = await getTopSellingItems(db, start, end, 20);
        break;
      case 'slow-moving-items':
        data = await getSlowMovingItems(db, start, end, 20);
        break;
      case 'average-check-size':
        data = await getAverageCheckSize(db, start, end);
        break;
      case 'payment-method-breakdown':
        data = await getPaymentMethodBreakdown(db, start, end);
        break;
      case 'order-source-analysis':
        data = await getOrderSourceAnalysis(db, start, end);
        break;
      case 'tip-analysis':
        data = await getTipAnalysis(db, start, end);
        break;
      case 'void-refund-report':
        data = await getVoidRefundReport(db, start, end);
        break;
      case 'employee-sales-performance':
        data = await getEmployeeSalesPerformance(db, start, end);
        break;
      case 'tips-by-employee':
        data = await getTipsByEmployee(db, start, end);
        break;
      case 'clock-in-out-summary':
        data = await getClockInOutSummary(db, start, end);
        break;
      case 'gift-card-sales-detail':
        data = await getGiftCardSalesDetail(db, start, end);
        break;
      case 'gift-card-redemption':
        data = await getGiftCardRedemption(db, start, end);
        break;
      case 'channel-revenue-comparison':
        data = await getChannelRevenueComparison(db, start, end);
        break;
      case 'channel-growth-analysis':
        data = await getChannelGrowthAnalysis(db, start, end);
        break;
      case 'delivery-platform-revenue':
        data = await getDeliveryPlatformRevenue(db, start, end);
        break;
      default:
        // 기본 데이터 반환 (추후 구현)
        data = await getGenericReportData(db, reportId, start, end);
    }
    
    // db.close(); // Shared DB 연결은 닫으면 안 됨
    
    res.json({
      report: reportDef,
      dateRange: { start, end },
      generatedAt: new Date().toISOString(),
      data
    });
  } catch (error) {
    console.error(`Error generating report ${req.params.reportId}:`, error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// GET /api/reports/:reportId/print - 프린터용 텍스트 포맷
router.get('/:reportId/print', async (req, res) => {
  try {
    const { reportId } = req.params;
    const { startDate, shiftId, width = 42 } = req.query;
    
    const reportDef = REPORT_DEFINITIONS[reportId];
    if (!reportDef || !reportDef.printable) {
      return res.status(400).json({ error: 'Report is not printable' });
    }
    
    const { start } = parseDateRange(startDate);
    const db = getDatabase();
    
    let printText;
    switch (reportId) {
      case 'daily-cash-report':
        printText = await generateDailyCashPrintText(db, start, shiftId, parseInt(width));
        break;
      case 'daily-summary-report':
        printText = await generateDailySummaryPrintText(db, start, parseInt(width));
        break;
      case 'shift-close-report':
        printText = await generateShiftClosePrintText(db, start, shiftId, parseInt(width));
        break;
      default:
        printText = 'Report format not available';
    }
    
    // db.close(); // Shared DB 연결은 닫으면 안 됨
    
    res.type('text/plain').send(printText);
  } catch (error) {
    console.error(`Error generating print format:`, error);
    res.status(500).json({ error: 'Failed to generate print format' });
  }
});

// ==================== 프린터용 텍스트 레포트 함수 ====================

// Daily Cash Report 데이터
function getDailyCashReport(db, date, shiftId) {
  return new Promise((resolve, reject) => {
    // 팁을 매출에서 분리하여 계산 (amount = 팁 포함 총액, tip = 팁 금액)
    // 순매출 = amount - tip, 팁 = tip
    const query = `
      SELECT 
        COALESCE(SUM(CASE WHEN payment_method = 'CASH' THEN (amount - COALESCE(tip, 0)) ELSE 0 END), 0) as cash_sales,
        COALESCE(SUM(CASE WHEN payment_method != 'CASH' THEN (amount - COALESCE(tip, 0)) ELSE 0 END), 0) as card_sales,
        COALESCE(SUM(amount - COALESCE(tip, 0)), 0) as total_sales,
        COALESCE(SUM(COALESCE(tip, 0)), 0) as total_tips,
        COALESCE(SUM(CASE WHEN payment_method = 'CASH' THEN COALESCE(tip, 0) ELSE 0 END), 0) as cash_tips,
        COALESCE(SUM(CASE WHEN payment_method != 'CASH' THEN COALESCE(tip, 0) ELSE 0 END), 0) as card_tips,
        COUNT(DISTINCT order_id) as transaction_count
      FROM payments
      WHERE DATE(created_at) = ? AND status = 'APPROVED'
    `;
    
    db.get(query, [date], (err, row) => {
      if (err) return reject(err);
      
      // Get cash drawer info
      db.get(`
        SELECT opening_cash, closing_cash, expected_cash, variance
        FROM cash_drawer_sessions
        WHERE DATE(opened_at) = ?
        ORDER BY opened_at DESC LIMIT 1
      `, [date], (err2, drawer) => {
        if (err2) drawer = {};
        
        resolve({
          date,
          cashSales: row?.cash_sales || 0,
          cardSales: row?.card_sales || 0,
          totalSales: row?.total_sales || 0,
          totalTips: row?.total_tips || 0,
          cashTips: row?.cash_tips || 0,
          cardTips: row?.card_tips || 0,
          transactionCount: row?.transaction_count || 0,
          openingCash: drawer?.opening_cash || 0,
          closingCash: drawer?.closing_cash || 0,
          expectedCash: drawer?.expected_cash || 0,
          variance: drawer?.variance || 0
        });
      });
    });
  });
}

// Daily Cash Report 프린트 텍스트 생성
async function generateDailyCashPrintText(db, date, shiftId, width = 42) {
  const data = await getDailyCashReport(db, date, shiftId);
  
  const line = '='.repeat(width);
  const dottedLine = '-'.repeat(width);
  
  const center = (text) => {
    const padding = Math.floor((width - text.length) / 2);
    return ' '.repeat(Math.max(0, padding)) + text;
  };
  
  const leftRight = (left, right) => {
    const spaces = width - left.length - right.length;
    return left + ' '.repeat(Math.max(1, spaces)) + right;
  };
  
  const formatMoney = (amount) => `$${(amount || 0).toFixed(2)}`;
  
  let text = '';
  text += line + '\n';
  text += center('DAILY CASH REPORT') + '\n';
  text += center(new Date(date).toLocaleDateString('en-US', { 
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
  })) + '\n';
  text += line + '\n';
  text += '\n';
  
  text += center('[ CASH DRAWER ]') + '\n';
  text += dottedLine + '\n';
  text += leftRight('Opening Cash:', formatMoney(data.openingCash)) + '\n';
  text += leftRight('Cash Sales:', formatMoney(data.cashSales)) + '\n';
  text += leftRight('Cash Tips:', formatMoney(data.cashTips)) + '\n';
  text += dottedLine + '\n';
  text += leftRight('Expected Cash:', formatMoney(data.expectedCash)) + '\n';
  text += leftRight('Actual Closing:', formatMoney(data.closingCash)) + '\n';
  text += leftRight('Variance:', formatMoney(data.variance)) + '\n';
  text += '\n';
  
  text += center('[ SALES SUMMARY ]') + '\n';
  text += dottedLine + '\n';
  text += leftRight('Cash Sales:', formatMoney(data.cashSales)) + '\n';
  text += leftRight('Card Sales:', formatMoney(data.cardSales)) + '\n';
  text += dottedLine + '\n';
  text += leftRight('TOTAL SALES:', formatMoney(data.totalSales)) + '\n';
  text += '\n';
  
  text += center('[ TIPS ]') + '\n';
  text += dottedLine + '\n';
  text += leftRight('Cash Tips:', formatMoney(data.cashTips)) + '\n';
  text += leftRight('Card Tips:', formatMoney(data.cardTips)) + '\n';
  text += dottedLine + '\n';
  text += leftRight('TOTAL TIPS:', formatMoney(data.totalTips)) + '\n';
  text += '\n';
  
  text += leftRight('Transactions:', data.transactionCount.toString()) + '\n';
  text += '\n';
  text += line + '\n';
  text += center(`Printed: ${new Date().toLocaleString()}`) + '\n';
  text += line + '\n';
  
  return text;
}

// Daily Summary Report 데이터
function getDailySummaryReport(db, date) {
  return new Promise((resolve, reject) => {
    const queries = {
      sales: `
        SELECT 
          COUNT(*) as order_count,
          COALESCE(SUM(subtotal), 0) as subtotal,
          COALESCE(SUM(tax), 0) as tax,
          COALESCE(SUM(total), 0) as total,
          COALESCE(SUM(discount_amount), 0) as discounts,
          COALESCE(AVG(total), 0) as avg_check
        FROM orders
        WHERE DATE(created_at) = ? AND status = 'COMPLETED'
      `,
      payments: `
        SELECT 
          payment_method,
          COUNT(*) as count,
          COALESCE(SUM(amount - COALESCE(tip, 0)), 0) as amount,
          COALESCE(SUM(COALESCE(tip, 0)), 0) as tips
        FROM payments
        WHERE DATE(created_at) = ? AND status = 'APPROVED'
        GROUP BY payment_method
      `,
      tips: `
        SELECT COALESCE(SUM(COALESCE(tip, 0)), 0) as total_tips
        FROM payments
        WHERE DATE(created_at) = ? AND status = 'APPROVED'
      `,
      voids: `
        SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as amount
        FROM order_adjustments
        WHERE DATE(created_at) = ? AND type = 'VOID'
      `,
      refunds: `
        SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as amount
        FROM payments
        WHERE DATE(created_at) = ? AND type = 'refund'
      `,
      guests: `
        SELECT COALESCE(SUM(guests), 0) as total_guests
        FROM orders
        WHERE DATE(created_at) = ? AND status = 'COMPLETED'
      `,
      categories: `
        SELECT c.name as category, 
               COALESCE(SUM(oi.quantity), 0) as quantity,
               COALESCE(SUM(oi.price * oi.quantity), 0) as amount
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.order_id
        LEFT JOIN items i ON oi.item_id = i.item_id
        LEFT JOIN categories c ON i.category_id = c.category_id
        WHERE DATE(o.created_at) = ? AND o.status = 'COMPLETED'
        GROUP BY c.category_id
        ORDER BY amount DESC
      `
    };
    
    const result = {};
    
    db.get(queries.sales, [date], (err, sales) => {
      if (err) return reject(err);
      result.sales = sales || {};
      
      db.all(queries.payments, [date], (err, payments) => {
        if (err) return reject(err);
        result.payments = payments || [];
        
        db.get(queries.tips, [date], (err, tips) => {
          if (err) return reject(err);
          result.tips = tips?.total_tips || 0;
          
          db.get(queries.voids, [date], (err, voids) => {
            if (err) return reject(err);
            result.voids = voids || { count: 0, amount: 0 };
            
            db.get(queries.refunds, [date], (err, refunds) => {
              if (err) return reject(err);
              result.refunds = refunds || { count: 0, amount: 0 };
              
              db.get(queries.guests, [date], (err, guests) => {
                if (err) return reject(err);
                result.guests = guests?.total_guests || 0;
                
                db.all(queries.categories, [date], (err, categories) => {
                  if (err) return reject(err);
                  result.categories = categories || [];
                  
                  resolve({ date, ...result });
                });
              });
            });
          });
        });
      });
    });
  });
}

// Daily Summary Report 프린트 텍스트 생성
async function generateDailySummaryPrintText(db, date, width = 42) {
  const data = await getDailySummaryReport(db, date);
  
  const line = '='.repeat(width);
  const dottedLine = '-'.repeat(width);
  const doubleLine = '═'.repeat(width);
  
  const center = (text) => {
    const padding = Math.floor((width - text.length) / 2);
    return ' '.repeat(Math.max(0, padding)) + text;
  };
  
  const leftRight = (left, right) => {
    const spaces = width - left.length - right.length;
    return left + ' '.repeat(Math.max(1, spaces)) + right;
  };
  
  const formatMoney = (amount) => `$${(amount || 0).toFixed(2)}`;
  
  let text = '';
  text += doubleLine + '\n';
  text += center('DAILY SUMMARY REPORT') + '\n';
  text += center(new Date(date).toLocaleDateString('en-US', { 
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
  })) + '\n';
  text += doubleLine + '\n';
  text += '\n';
  
  // Sales Summary
  text += center('[ SALES SUMMARY ]') + '\n';
  text += dottedLine + '\n';
  text += leftRight('Total Orders:', (data.sales.order_count || 0).toString()) + '\n';
  text += leftRight('Total Guests:', (data.guests || 0).toString()) + '\n';
  text += leftRight('Avg Check:', formatMoney(data.sales.avg_check)) + '\n';
  text += '\n';
  text += leftRight('Subtotal:', formatMoney(data.sales.subtotal)) + '\n';
  text += leftRight('Discounts:', '-' + formatMoney(data.sales.discounts)) + '\n';
  text += leftRight('Tax:', formatMoney(data.sales.tax)) + '\n';
  text += dottedLine + '\n';
  text += leftRight('NET SALES:', formatMoney(data.sales.total)) + '\n';
  text += leftRight('Tips:', formatMoney(data.tips)) + '\n';
  text += line + '\n';
  text += leftRight('GRAND TOTAL:', formatMoney((data.sales.total || 0) + (data.tips || 0))) + '\n';
  text += '\n';
  
  // Payment Breakdown
  text += center('[ PAYMENT BREAKDOWN ]') + '\n';
  text += dottedLine + '\n';
  for (const p of data.payments) {
    text += leftRight(`${p.payment_method} (${p.count}):`, formatMoney(p.amount)) + '\n';
  }
  text += '\n';
  
  // Voids & Refunds
  text += center('[ VOIDS & REFUNDS ]') + '\n';
  text += dottedLine + '\n';
  text += leftRight(`Voids (${data.voids.count}):`, formatMoney(data.voids.amount)) + '\n';
  text += leftRight(`Refunds (${data.refunds.count}):`, formatMoney(data.refunds.amount)) + '\n';
  text += '\n';
  
  // Category Breakdown
  if (data.categories.length > 0) {
    text += center('[ CATEGORY BREAKDOWN ]') + '\n';
    text += dottedLine + '\n';
    for (const cat of data.categories.slice(0, 10)) {
      text += leftRight(`${(cat.category || 'Uncategorized').substring(0, 20)} (${cat.quantity}):`, formatMoney(cat.amount)) + '\n';
    }
    text += '\n';
  }
  
  text += doubleLine + '\n';
  text += center(`Printed: ${new Date().toLocaleString()}`) + '\n';
  text += doubleLine + '\n';
  
  return text;
}

// Shift Close Report 데이터
function getShiftCloseReport(db, date, shiftId) {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT 
        s.shift_id,
        s.employee_id,
        e.name as employee_name,
        s.started_at,
        s.ended_at,
        s.opening_cash,
        s.closing_cash,
        COALESCE((
          SELECT SUM(CASE WHEN p.payment_method = 'CASH' THEN (p.amount - COALESCE(p.tip, 0)) ELSE 0 END)
          FROM payments p
          JOIN orders o ON p.order_id = o.order_id
          WHERE o.employee_id = s.employee_id
            AND p.status = 'APPROVED'
            AND p.created_at BETWEEN s.started_at AND COALESCE(s.ended_at, datetime('now'))
        ), 0) as cash_collected,
        COALESCE((
          SELECT SUM(CASE WHEN p.payment_method != 'CASH' THEN (p.amount - COALESCE(p.tip, 0)) ELSE 0 END)
          FROM payments p
          JOIN orders o ON p.order_id = o.order_id
          WHERE o.employee_id = s.employee_id
            AND p.status = 'APPROVED'
            AND p.created_at BETWEEN s.started_at AND COALESCE(s.ended_at, datetime('now'))
        ), 0) as card_collected,
        COALESCE((
          SELECT SUM(COALESCE(p.tip, 0))
          FROM payments p
          JOIN orders o ON p.order_id = o.order_id
          WHERE o.employee_id = s.employee_id
            AND p.status = 'APPROVED'
            AND p.created_at BETWEEN s.started_at AND COALESCE(s.ended_at, datetime('now'))
        ), 0) as tips_collected,
        COALESCE((
          SELECT COUNT(DISTINCT o.order_id)
          FROM orders o
          WHERE o.employee_id = s.employee_id
            AND o.status = 'COMPLETED'
            AND o.created_at BETWEEN s.started_at AND COALESCE(s.ended_at, datetime('now'))
        ), 0) as order_count
      FROM shifts s
      LEFT JOIN employees e ON s.employee_id = e.employee_id
      WHERE DATE(s.started_at) = ?
      ${shiftId ? 'AND s.shift_id = ?' : ''}
      ORDER BY s.started_at DESC
      LIMIT 1
    `;
    
    const params = shiftId ? [date, shiftId] : [date];
    
    db.get(query, params, (err, row) => {
      if (err) return reject(err);
      
      if (!row) {
        // 시프트 데이터 없으면 당일 전체 데이터 반환
        return getDailyCashReport(db, date, null).then(resolve).catch(reject);
      }
      
      const expectedCash = (row.opening_cash || 0) + (row.cash_collected || 0);
      const variance = (row.closing_cash || 0) - expectedCash;
      
      resolve({
        date,
        shiftId: row.shift_id,
        employeeId: row.employee_id,
        employeeName: row.employee_name || 'Unknown',
        startedAt: row.started_at,
        endedAt: row.ended_at,
        openingCash: row.opening_cash || 0,
        closingCash: row.closing_cash || 0,
        cashCollected: row.cash_collected || 0,
        cardCollected: row.card_collected || 0,
        tipsCollected: row.tips_collected || 0,
        totalSales: (row.cash_collected || 0) + (row.card_collected || 0),
        orderCount: row.order_count || 0,
        expectedCash,
        variance
      });
    });
  });
}

// Shift Close Report 프린트 텍스트 생성
async function generateShiftClosePrintText(db, date, shiftId, width = 42) {
  const data = await getShiftCloseReport(db, date, shiftId);
  
  const line = '='.repeat(width);
  const dottedLine = '-'.repeat(width);
  
  const center = (text) => {
    const padding = Math.floor((width - text.length) / 2);
    return ' '.repeat(Math.max(0, padding)) + text;
  };
  
  const leftRight = (left, right) => {
    const spaces = width - left.length - right.length;
    return left + ' '.repeat(Math.max(1, spaces)) + right;
  };
  
  const formatMoney = (amount) => `$${(amount || 0).toFixed(2)}`;
  const formatTime = (dt) => dt ? new Date(dt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : 'N/A';
  
  let text = '';
  text += line + '\n';
  text += center('SHIFT CLOSE REPORT') + '\n';
  text += line + '\n';
  text += '\n';
  
  text += leftRight('Employee:', data.employeeName || 'All Staff') + '\n';
  text += leftRight('Date:', new Date(date).toLocaleDateString()) + '\n';
  text += leftRight('Shift Start:', formatTime(data.startedAt)) + '\n';
  text += leftRight('Shift End:', formatTime(data.endedAt)) + '\n';
  text += '\n';
  
  text += center('[ CASH DRAWER ]') + '\n';
  text += dottedLine + '\n';
  text += leftRight('Opening Cash:', formatMoney(data.openingCash)) + '\n';
  text += leftRight('(+) Cash Collected:', formatMoney(data.cashCollected)) + '\n';
  text += dottedLine + '\n';
  text += leftRight('Expected Cash:', formatMoney(data.expectedCash)) + '\n';
  text += leftRight('Actual Closing:', formatMoney(data.closingCash)) + '\n';
  
  const varianceSign = data.variance >= 0 ? '+' : '';
  const varianceLabel = data.variance === 0 ? 'BALANCED' : (data.variance > 0 ? 'OVER' : 'SHORT');
  text += leftRight(`Variance (${varianceLabel}):`, varianceSign + formatMoney(data.variance)) + '\n';
  text += '\n';
  
  text += center('[ SALES SUMMARY ]') + '\n';
  text += dottedLine + '\n';
  text += leftRight('Orders:', data.orderCount.toString()) + '\n';
  text += leftRight('Cash Sales:', formatMoney(data.cashCollected)) + '\n';
  text += leftRight('Card Sales:', formatMoney(data.cardCollected)) + '\n';
  text += dottedLine + '\n';
  text += leftRight('TOTAL SALES:', formatMoney(data.totalSales)) + '\n';
  text += leftRight('Tips Collected:', formatMoney(data.tipsCollected)) + '\n';
  text += '\n';
  
  text += line + '\n';
  text += '\n';
  text += leftRight('Employee Signature:', '________________') + '\n';
  text += '\n';
  text += leftRight('Manager Signature:', '________________') + '\n';
  text += '\n';
  text += line + '\n';
  text += center(`Printed: ${new Date().toLocaleString()}`) + '\n';
  text += line + '\n';
  
  return text;
}

// ==================== 그래프 레포트 함수 ====================

// Daily Sales Overview
function getDailySalesOverview(db, date) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        ${getHourlyGroupQuery()},
        COUNT(*) as orders,
        COALESCE(SUM(total), 0) as revenue,
        COALESCE(SUM(guests), 0) as guests
      FROM orders
      WHERE DATE(created_at) = ? AND status = 'COMPLETED'
      GROUP BY hour
      ORDER BY hour
    `, [date], (err, rows) => {
      if (err) return reject(err);
      
      // 모든 시간대 데이터 포함
      const hourlyData = [];
      for (let h = 0; h < 24; h++) {
        const found = rows.find(r => r.hour === h);
        hourlyData.push({
          hour: h,
          label: `${h.toString().padStart(2, '0')}:00`,
          orders: found?.orders || 0,
          revenue: found?.revenue || 0,
          guests: found?.guests || 0
        });
      }
      
      const totals = {
        totalOrders: rows.reduce((s, r) => s + r.orders, 0),
        totalRevenue: rows.reduce((s, r) => s + r.revenue, 0),
        totalGuests: rows.reduce((s, r) => s + r.guests, 0)
      };
      
      resolve({
        chartData: hourlyData,
        summary: totals,
        peakHour: hourlyData.reduce((max, h) => h.revenue > max.revenue ? h : max, hourlyData[0])
      });
    });
  });
}

// Weekly Sales Trend
function getWeeklySalesTrend(db, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        DATE(created_at) as date,
        strftime('%w', created_at) as day_of_week,
        COUNT(*) as orders,
        COALESCE(SUM(total), 0) as revenue,
        COALESCE(AVG(total), 0) as avg_check
      FROM orders
      WHERE DATE(created_at) BETWEEN DATE(?, '-6 days') AND DATE(?)
        AND status = 'COMPLETED'
      GROUP BY DATE(created_at)
      ORDER BY date
    `, [endDate, endDate], (err, rows) => {
      if (err) return reject(err);
      
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const chartData = rows.map(r => ({
        date: r.date,
        dayName: dayNames[parseInt(r.day_of_week)],
        orders: r.orders,
        revenue: r.revenue,
        avgCheck: r.avg_check
      }));
      
      resolve({
        chartData,
        summary: {
          totalRevenue: rows.reduce((s, r) => s + r.revenue, 0),
          avgDailyRevenue: rows.length > 0 ? rows.reduce((s, r) => s + r.revenue, 0) / rows.length : 0,
          bestDay: chartData.reduce((max, d) => d.revenue > max.revenue ? d : max, chartData[0] || { revenue: 0 })
        }
      });
    });
  });
}

// Monthly Sales Comparison
function getMonthlySalesComparison(db, date) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        strftime('%Y-%m', created_at) as month,
        COUNT(*) as orders,
        COALESCE(SUM(total), 0) as revenue,
        COALESCE(AVG(total), 0) as avg_check
      FROM orders
      WHERE created_at >= DATE(?, '-12 months')
        AND status = 'COMPLETED'
      GROUP BY strftime('%Y-%m', created_at)
      ORDER BY month
    `, [date], (err, rows) => {
      if (err) return reject(err);
      
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const chartData = rows.map(r => {
        const [year, month] = r.month.split('-');
        return {
          month: r.month,
          label: `${monthNames[parseInt(month) - 1]} ${year}`,
          orders: r.orders,
          revenue: r.revenue,
          avgCheck: r.avg_check
        };
      });
      
      resolve({ chartData });
    });
  });
}

// Hourly Sales Distribution
function getHourlySalesDistribution(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        ${getHourlyGroupQuery()},
        COUNT(*) as orders,
        COALESCE(SUM(total), 0) as revenue,
        COALESCE(AVG(total), 0) as avg_check
      FROM orders
      WHERE DATE(created_at) BETWEEN ? AND ?
        AND status = 'COMPLETED'
      GROUP BY hour
      ORDER BY hour
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      
      const hourlyData = [];
      for (let h = 0; h < 24; h++) {
        const found = rows.find(r => r.hour === h);
        hourlyData.push({
          hour: h,
          label: `${h.toString().padStart(2, '0')}:00`,
          orders: found?.orders || 0,
          revenue: found?.revenue || 0,
          avgCheck: found?.avg_check || 0
        });
      }
      
      resolve({ chartData: hourlyData });
    });
  });
}

// Day of Week Performance
function getDayOfWeekPerformance(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    db.all(`
      SELECT 
        CAST(strftime('%w', created_at) AS INTEGER) as day_of_week,
        COUNT(*) as orders,
        COALESCE(SUM(total), 0) as revenue,
        COALESCE(AVG(total), 0) as avg_check,
        COUNT(DISTINCT DATE(created_at)) as day_count
      FROM orders
      WHERE DATE(created_at) BETWEEN ? AND ?
        AND status = 'COMPLETED'
      GROUP BY day_of_week
      ORDER BY day_of_week
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      
      const chartData = dayNames.map((name, idx) => {
        const found = rows.find(r => r.day_of_week === idx);
        return {
          dayOfWeek: idx,
          dayName: name,
          shortName: name.substring(0, 3),
          orders: found?.orders || 0,
          revenue: found?.revenue || 0,
          avgCheck: found?.avg_check || 0,
          avgDailyRevenue: found ? found.revenue / found.day_count : 0
        };
      });
      
      resolve({ chartData });
    });
  });
}

// Category Sales Breakdown
function getCategorySalesBreakdown(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        COALESCE(c.name, 'Uncategorized') as category,
        COUNT(*) as item_count,
        COALESCE(SUM(oi.quantity), 0) as quantity,
        COALESCE(SUM(oi.price * oi.quantity), 0) as revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.order_id
      LEFT JOIN items i ON oi.item_id = i.item_id
      LEFT JOIN categories c ON i.category_id = c.category_id
      WHERE DATE(o.created_at) BETWEEN ? AND ?
        AND o.status = 'COMPLETED'
      GROUP BY c.category_id
      ORDER BY revenue DESC
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      
      const total = rows.reduce((s, r) => s + r.revenue, 0);
      const chartData = rows.map(r => ({
        category: r.category,
        quantity: r.quantity,
        revenue: r.revenue,
        percentage: total > 0 ? (r.revenue / total * 100).toFixed(1) : 0
      }));
      
      resolve({ chartData, total });
    });
  });
}

// Top Selling Items
function getTopSellingItems(db, startDate, endDate, limit = 20) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        oi.item_id,
        oi.name as item_name,
        COALESCE(c.name, 'Uncategorized') as category,
        COALESCE(SUM(oi.quantity), 0) as quantity,
        COALESCE(SUM(oi.price * oi.quantity), 0) as revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.order_id
      LEFT JOIN items i ON oi.item_id = i.item_id
      LEFT JOIN categories c ON i.category_id = c.category_id
      WHERE DATE(o.created_at) BETWEEN ? AND ?
        AND o.status = 'COMPLETED'
      GROUP BY oi.item_id, oi.name
      ORDER BY quantity DESC
      LIMIT ?
    `, [startDate, endDate, limit], (err, rows) => {
      if (err) return reject(err);
      resolve({ chartData: rows });
    });
  });
}

// Slow Moving Items
function getSlowMovingItems(db, startDate, endDate, limit = 20) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        i.item_id,
        i.name as item_name,
        COALESCE(c.name, 'Uncategorized') as category,
        COALESCE(SUM(oi.quantity), 0) as quantity,
        COALESCE(SUM(oi.price * oi.quantity), 0) as revenue
      FROM items i
      LEFT JOIN categories c ON i.category_id = c.category_id
      LEFT JOIN order_items oi ON i.item_id = oi.item_id
      LEFT JOIN orders o ON oi.order_id = o.order_id 
        AND DATE(o.created_at) BETWEEN ? AND ?
        AND o.status = 'COMPLETED'
      WHERE i.is_active = 1
      GROUP BY i.item_id
      ORDER BY quantity ASC
      LIMIT ?
    `, [startDate, endDate, limit], (err, rows) => {
      if (err) return reject(err);
      resolve({ chartData: rows });
    });
  });
}

// Average Check Size
function getAverageCheckSize(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as orders,
        COALESCE(AVG(total), 0) as avg_check,
        COALESCE(MIN(total), 0) as min_check,
        COALESCE(MAX(total), 0) as max_check
      FROM orders
      WHERE DATE(created_at) BETWEEN ? AND ?
        AND status = 'COMPLETED'
        AND total > 0
      GROUP BY DATE(created_at)
      ORDER BY date
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      
      const overallAvg = rows.length > 0 
        ? rows.reduce((s, r) => s + r.avg_check, 0) / rows.length 
        : 0;
      
      resolve({ 
        chartData: rows,
        summary: { overallAverage: overallAvg }
      });
    });
  });
}

// Payment Method Breakdown
function getPaymentMethodBreakdown(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        payment_method,
        COUNT(*) as transaction_count,
        COALESCE(SUM(amount - COALESCE(tip, 0)), 0) as amount,
        COALESCE(SUM(COALESCE(tip, 0)), 0) as tips
      FROM payments
      WHERE DATE(created_at) BETWEEN ? AND ?
        AND status = 'APPROVED'
      GROUP BY payment_method
      ORDER BY amount DESC
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      
      const total = rows.reduce((s, r) => s + r.amount, 0);
      const chartData = rows.map(r => ({
        method: r.payment_method,
        count: r.transaction_count,
        amount: r.amount,
        percentage: total > 0 ? (r.amount / total * 100).toFixed(1) : 0
      }));
      
      resolve({ chartData, total });
    });
  });
}

// Order Source Analysis
function getOrderSourceAnalysis(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        COALESCE(order_type, 'DINE_IN') as source,
        COUNT(*) as orders,
        COALESCE(SUM(total), 0) as revenue
      FROM orders
      WHERE DATE(created_at) BETWEEN ? AND ?
        AND status = 'COMPLETED'
      GROUP BY order_type
      ORDER BY revenue DESC
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      
      const sourceLabels = {
        'DINE_IN': 'Dine In',
        'TAKEOUT': 'Takeout',
        'DELIVERY': 'Delivery',
        'ONLINE': 'Online',
        'PHONE': 'Phone Order',
        'TABLE_QR': 'Table QR',
        'KIOSK': 'Kiosk'
      };
      
      const total = rows.reduce((s, r) => s + r.revenue, 0);
      const chartData = rows.map(r => ({
        source: r.source,
        label: sourceLabels[r.source] || r.source,
        orders: r.orders,
        revenue: r.revenue,
        percentage: total > 0 ? (r.revenue / total * 100).toFixed(1) : 0
      }));
      
      resolve({ chartData, total });
    });
  });
}

// Tip Analysis
function getTipAnalysis(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        DATE(created_at) as date,
        COUNT(CASE WHEN COALESCE(tip, 0) > 0 THEN 1 END) as tip_count,
        COALESCE(SUM(COALESCE(tip, 0)), 0) as total_tips,
        COALESCE(AVG(CASE WHEN COALESCE(tip, 0) > 0 THEN tip END), 0) as avg_tip
      FROM payments
      WHERE DATE(created_at) BETWEEN ? AND ?
        AND status = 'APPROVED'
      GROUP BY DATE(created_at)
      ORDER BY date
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      
      const totalTips = rows.reduce((s, r) => s + r.total_tips, 0);
      const avgTip = rows.length > 0 ? totalTips / rows.reduce((s, r) => s + r.tip_count, 0) : 0;
      
      resolve({
        chartData: rows,
        summary: { totalTips, avgTip }
      });
    });
  });
}

// Void & Refund Report
function getVoidRefundReport(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    const voidQuery = `
      SELECT 
        DATE(created_at) as date,
        'VOID' as type,
        COUNT(*) as count,
        COALESCE(SUM(amount), 0) as amount,
        reason
      FROM order_adjustments
      WHERE DATE(created_at) BETWEEN ? AND ?
        AND type = 'VOID'
      GROUP BY DATE(created_at), reason
    `;
    
    const refundQuery = `
      SELECT 
        DATE(created_at) as date,
        'REFUND' as type,
        COUNT(*) as count,
        COALESCE(SUM(amount), 0) as amount,
        '' as reason
      FROM payments
      WHERE DATE(created_at) BETWEEN ? AND ?
        AND type = 'refund'
      GROUP BY DATE(created_at)
    `;
    
    db.all(voidQuery, [startDate, endDate], (err, voids) => {
      if (err) return reject(err);
      
      db.all(refundQuery, [startDate, endDate], (err2, refunds) => {
        if (err2) return reject(err2);
        
        const combined = [...(voids || []), ...(refunds || [])].sort((a, b) => a.date.localeCompare(b.date));
        
        resolve({
          chartData: combined,
          summary: {
            totalVoids: voids.reduce((s, v) => s + v.count, 0),
            voidAmount: voids.reduce((s, v) => s + v.amount, 0),
            totalRefunds: refunds.reduce((s, r) => s + r.count, 0),
            refundAmount: refunds.reduce((s, r) => s + r.amount, 0)
          }
        });
      });
    });
  });
}

// Employee Sales Performance
function getEmployeeSalesPerformance(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        o.employee_id,
        COALESCE(e.name, 'Unknown') as employee_name,
        COUNT(*) as orders,
        COALESCE(SUM(o.total), 0) as revenue,
        COALESCE(AVG(o.total), 0) as avg_check,
        COALESCE(SUM(o.guests), 0) as guests
      FROM orders o
      LEFT JOIN employees e ON o.employee_id = e.employee_id
      WHERE DATE(o.created_at) BETWEEN ? AND ?
        AND o.status = 'COMPLETED'
      GROUP BY o.employee_id
      ORDER BY revenue DESC
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      resolve({ chartData: rows });
    });
  });
}

// Tips by Employee
function getTipsByEmployee(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        o.employee_id,
        COALESCE(e.name, 'Unknown') as employee_name,
        COUNT(CASE WHEN COALESCE(p.tip, 0) > 0 THEN 1 END) as tip_count,
        COALESCE(SUM(COALESCE(p.tip, 0)), 0) as total_tips,
        COALESCE(AVG(CASE WHEN COALESCE(p.tip, 0) > 0 THEN p.tip END), 0) as avg_tip
      FROM payments p
      JOIN orders o ON p.order_id = o.order_id
      LEFT JOIN employees e ON o.employee_id = e.employee_id
      WHERE DATE(p.created_at) BETWEEN ? AND ?
        AND p.status = 'APPROVED'
        AND COALESCE(p.tip, 0) > 0
      GROUP BY o.employee_id
      ORDER BY total_tips DESC
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      resolve({ chartData: rows });
    });
  });
}

// Clock In/Out Summary
function getClockInOutSummary(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        c.employee_id,
        COALESCE(e.name, 'Unknown') as employee_name,
        DATE(c.clock_in) as date,
        c.clock_in,
        c.clock_out,
        CASE 
          WHEN c.clock_out IS NOT NULL 
          THEN (julianday(c.clock_out) - julianday(c.clock_in)) * 24
          ELSE 0
        END as hours_worked
      FROM clock_records c
      LEFT JOIN employees e ON c.employee_id = e.employee_id
      WHERE DATE(c.clock_in) BETWEEN ? AND ?
      ORDER BY c.clock_in DESC
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      
      // 직원별 총 시간 집계
      const byEmployee = {};
      for (const row of rows) {
        if (!byEmployee[row.employee_id]) {
          byEmployee[row.employee_id] = {
            employee_id: row.employee_id,
            employee_name: row.employee_name,
            total_hours: 0,
            shift_count: 0
          };
        }
        byEmployee[row.employee_id].total_hours += row.hours_worked || 0;
        byEmployee[row.employee_id].shift_count++;
      }
      
      resolve({
        chartData: Object.values(byEmployee),
        details: rows
      });
    });
  });
}

// Gift Card Sales Detail
function getGiftCardSalesDetail(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        DATE(gc.sold_at) as date,
        gc.denomination,
        COUNT(*) as quantity_sold,
        COALESCE(SUM(gc.amount), 0) as total_sales,
        COALESCE(AVG(gc.amount), 0) as avg_amount
      FROM gift_cards gc
      WHERE DATE(gc.sold_at) BETWEEN ? AND ?
        AND gc.status IN ('ACTIVE', 'SOLD', 'PARTIALLY_USED', 'REDEEMED')
      GROUP BY DATE(gc.sold_at), gc.denomination
      ORDER BY date DESC, denomination
    `, [startDate, endDate], (err, rows) => {
      if (err) {
        // 테이블이 없으면 빈 결과 반환
        if (err.message.includes('no such table')) {
          return resolve({
            chartData: [],
            summary: { totalSales: 0, totalCards: 0, avgDenomination: 0 },
            byDenomination: []
          });
        }
        return reject(err);
      }
      
      // 금액대별 집계
      const byDenomination = {};
      let totalSales = 0;
      let totalCards = 0;
      
      for (const row of rows) {
        const denom = row.denomination || 'Custom';
        if (!byDenomination[denom]) {
          byDenomination[denom] = { denomination: denom, quantity: 0, sales: 0 };
        }
        byDenomination[denom].quantity += row.quantity_sold;
        byDenomination[denom].sales += row.total_sales;
        totalSales += row.total_sales;
        totalCards += row.quantity_sold;
      }
      
      resolve({
        chartData: rows,
        byDenomination: Object.values(byDenomination),
        summary: {
          totalSales,
          totalCards,
          avgDenomination: totalCards > 0 ? totalSales / totalCards : 0
        }
      });
    });
  });
}

// Gift Card Redemption
function getGiftCardRedemption(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        DATE(gcr.redeemed_at) as date,
        COUNT(*) as redemption_count,
        COALESCE(SUM(gcr.amount_used), 0) as total_redeemed,
        COALESCE(AVG(gcr.amount_used), 0) as avg_redemption
      FROM gift_card_redemptions gcr
      WHERE DATE(gcr.redeemed_at) BETWEEN ? AND ?
      GROUP BY DATE(gcr.redeemed_at)
      ORDER BY date
    `, [startDate, endDate], (err, redemptions) => {
      if (err) {
        if (err.message.includes('no such table')) {
          return resolve({
            chartData: [],
            summary: { totalRedeemed: 0, totalTransactions: 0 },
            balanceInfo: { activeCards: 0, totalBalance: 0 }
          });
        }
        return reject(err);
      }
      
      // 활성 기프트카드 잔액 조회
      db.get(`
        SELECT 
          COUNT(*) as active_cards,
          COALESCE(SUM(remaining_balance), 0) as total_balance
        FROM gift_cards
        WHERE status IN ('ACTIVE', 'PARTIALLY_USED')
      `, [], (err2, balance) => {
        if (err2) balance = { active_cards: 0, total_balance: 0 };
        
        const totalRedeemed = redemptions.reduce((s, r) => s + r.total_redeemed, 0);
        const totalTransactions = redemptions.reduce((s, r) => s + r.redemption_count, 0);
        
        resolve({
          chartData: redemptions,
          summary: { totalRedeemed, totalTransactions },
          balanceInfo: {
            activeCards: balance?.active_cards || 0,
            totalBalance: balance?.total_balance || 0
          }
        });
      });
    });
  });
}

// Channel Revenue Comparison (판매채널별 매출 비교)
function getChannelRevenueComparison(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    // 채널별 매출 집계
    db.all(`
      SELECT 
        COALESCE(order_type, 'DINE_IN') as channel,
        DATE(created_at) as date,
        COUNT(*) as orders,
        COALESCE(SUM(total), 0) as revenue,
        COALESCE(AVG(total), 0) as avg_check,
        COALESCE(SUM(guests), 0) as guests
      FROM orders
      WHERE DATE(created_at) BETWEEN ? AND ?
        AND status = 'COMPLETED'
      GROUP BY order_type, DATE(created_at)
      ORDER BY date, channel
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      
      const channelLabels = {
        'DINE_IN': 'Dine In',
        'TAKEOUT': 'Takeout',
        'DELIVERY': 'Delivery',
        'ONLINE': 'Online',
        'PHONE': 'Phone Order',
        'TABLE_QR': 'Table QR',
        'KIOSK': 'Kiosk',
        'HANDHELD': 'Handheld',
        'SUB_POS': 'Sub POS'
      };
      
      // 채널별 총계
      const byChannel = {};
      for (const row of rows) {
        const ch = row.channel;
        if (!byChannel[ch]) {
          byChannel[ch] = {
            channel: ch,
            label: channelLabels[ch] || ch,
            totalOrders: 0,
            totalRevenue: 0,
            totalGuests: 0,
            avgCheck: 0,
            dailyData: []
          };
        }
        byChannel[ch].totalOrders += row.orders;
        byChannel[ch].totalRevenue += row.revenue;
        byChannel[ch].totalGuests += row.guests;
        byChannel[ch].dailyData.push({
          date: row.date,
          orders: row.orders,
          revenue: row.revenue
        });
      }
      
      // 평균 객단가 계산
      for (const ch of Object.values(byChannel)) {
        ch.avgCheck = ch.totalOrders > 0 ? ch.totalRevenue / ch.totalOrders : 0;
      }
      
      const channelSummary = Object.values(byChannel).sort((a, b) => b.totalRevenue - a.totalRevenue);
      const totalRevenue = channelSummary.reduce((s, c) => s + c.totalRevenue, 0);
      
      // 채널별 비율 추가
      for (const ch of channelSummary) {
        ch.percentage = totalRevenue > 0 ? (ch.totalRevenue / totalRevenue * 100).toFixed(1) : 0;
      }
      
      resolve({
        chartData: channelSummary,
        dailyBreakdown: rows,
        summary: {
          totalRevenue,
          topChannel: channelSummary[0] || null,
          channelCount: channelSummary.length
        }
      });
    });
  });
}

// Channel Growth Analysis (채널별 성장 분석)
function getChannelGrowthAnalysis(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    // 현재 기간과 이전 기간 비교
    const dayDiff = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1;
    const prevStartDate = new Date(new Date(startDate) - dayDiff * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const prevEndDate = new Date(new Date(startDate) - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    // 현재 기간 데이터
    db.all(`
      SELECT 
        COALESCE(order_type, 'DINE_IN') as channel,
        COUNT(*) as orders,
        COALESCE(SUM(total), 0) as revenue
      FROM orders
      WHERE DATE(created_at) BETWEEN ? AND ?
        AND status = 'COMPLETED'
      GROUP BY order_type
    `, [startDate, endDate], (err, currentData) => {
      if (err) return reject(err);
      
      // 이전 기간 데이터
      db.all(`
        SELECT 
          COALESCE(order_type, 'DINE_IN') as channel,
          COUNT(*) as orders,
          COALESCE(SUM(total), 0) as revenue
        FROM orders
        WHERE DATE(created_at) BETWEEN ? AND ?
          AND status = 'COMPLETED'
        GROUP BY order_type
      `, [prevStartDate, prevEndDate], (err2, prevData) => {
        if (err2) prevData = [];
        
        const channelLabels = {
          'DINE_IN': 'Dine In',
          'TAKEOUT': 'Takeout',
          'DELIVERY': 'Delivery',
          'ONLINE': 'Online',
          'PHONE': 'Phone Order',
          'TABLE_QR': 'Table QR',
          'KIOSK': 'Kiosk',
          'HANDHELD': 'Handheld',
          'SUB_POS': 'Sub POS'
        };
        
        const prevByChannel = {};
        for (const row of prevData) {
          prevByChannel[row.channel] = row;
        }
        
        const growth = currentData.map(curr => {
          const prev = prevByChannel[curr.channel] || { orders: 0, revenue: 0 };
          const revenueGrowth = prev.revenue > 0 
            ? ((curr.revenue - prev.revenue) / prev.revenue * 100).toFixed(1)
            : (curr.revenue > 0 ? 100 : 0);
          const orderGrowth = prev.orders > 0
            ? ((curr.orders - prev.orders) / prev.orders * 100).toFixed(1)
            : (curr.orders > 0 ? 100 : 0);
          
          return {
            channel: curr.channel,
            label: channelLabels[curr.channel] || curr.channel,
            currentRevenue: curr.revenue,
            previousRevenue: prev.revenue,
            revenueGrowth: parseFloat(revenueGrowth),
            currentOrders: curr.orders,
            previousOrders: prev.orders,
            orderGrowth: parseFloat(orderGrowth),
            isGrowing: parseFloat(revenueGrowth) > 0
          };
        }).sort((a, b) => b.revenueGrowth - a.revenueGrowth);
        
        // 일별 추세
        db.all(`
          SELECT 
            DATE(created_at) as date,
            COALESCE(order_type, 'DINE_IN') as channel,
            COALESCE(SUM(total), 0) as revenue
          FROM orders
          WHERE DATE(created_at) BETWEEN ? AND ?
            AND status = 'COMPLETED'
          GROUP BY DATE(created_at), order_type
          ORDER BY date
        `, [startDate, endDate], (err3, dailyTrend) => {
          if (err3) dailyTrend = [];
          
          resolve({
            chartData: growth,
            dailyTrend,
            comparisonPeriod: {
              current: { start: startDate, end: endDate },
              previous: { start: prevStartDate, end: prevEndDate }
            },
            summary: {
              fastestGrowing: growth[0] || null,
              declining: growth.filter(g => g.revenueGrowth < 0)
            }
          });
        });
      });
    });
  });
}

// Delivery Platform Revenue (딜리버리 플랫폼별 매출)
function getDeliveryPlatformRevenue(db, startDate, endDate) {
  return new Promise((resolve, reject) => {
    // 딜리버리 플랫폼별 매출 집계
    // delivery_platform 또는 channel 필드 사용
    db.all(`
      SELECT 
        DATE(created_at) as date,
        COALESCE(
          CASE 
            WHEN channel LIKE '%uber%' OR channel LIKE '%UBER%' THEN 'UberEats'
            WHEN channel LIKE '%door%' OR channel LIKE '%DOOR%' THEN 'DoorDash'
            WHEN channel LIKE '%skip%' OR channel LIKE '%SKIP%' THEN 'SkipTheDishes'
            WHEN channel LIKE '%grub%' OR channel LIKE '%GRUB%' THEN 'GrubHub'
            WHEN channel LIKE '%postmate%' OR channel LIKE '%POSTMATE%' THEN 'Postmates'
            WHEN channel LIKE '%tryotter%' OR channel LIKE '%OTTER%' THEN 'TryOtter'
            WHEN channel LIKE '%urban%' OR channel LIKE '%URBAN%' THEN 'UrbanPipe'
            WHEN order_type = 'DELIVERY' THEN 'Direct Delivery'
            ELSE 'Other Delivery'
          END,
          'Direct Delivery'
        ) as platform,
        COUNT(*) as orders,
        COALESCE(SUM(total), 0) as revenue,
        COALESCE(AVG(total), 0) as avg_order
      FROM orders
      WHERE DATE(created_at) BETWEEN ? AND ?
        AND status = 'COMPLETED'
        AND (order_type = 'DELIVERY' OR order_type = 'ONLINE' OR channel IS NOT NULL)
      GROUP BY DATE(created_at), platform
      ORDER BY date, platform
    `, [startDate, endDate], (err, rows) => {
      if (err) return reject(err);
      
      // 플랫폼별 집계
      const platformTotals = {};
      const platformColors = {
        'UberEats': '#06C167',      // 우버이츠 그린
        'DoorDash': '#FF3008',      // 도어대시 레드
        'SkipTheDishes': '#FF6B00', // 스킵 오렌지
        'GrubHub': '#F63440',       // 그럽허브 레드
        'Postmates': '#000000',     // 포스트메이츠 블랙
        'TryOtter': '#6366F1',      // 트라이오터 퍼플
        'UrbanPipe': '#3B82F6',     // 어반파이프 블루
        'Direct Delivery': '#10B981', // 직접 배달 그린
        'Other Delivery': '#6B7280'  // 기타 그레이
      };
      
      for (const row of rows) {
        if (!platformTotals[row.platform]) {
          platformTotals[row.platform] = {
            platform: row.platform,
            color: platformColors[row.platform] || '#6B7280',
            totalOrders: 0,
            totalRevenue: 0,
            avgOrder: 0,
            dailyData: []
          };
        }
        platformTotals[row.platform].totalOrders += row.orders;
        platformTotals[row.platform].totalRevenue += row.revenue;
        platformTotals[row.platform].dailyData.push({
          date: row.date,
          orders: row.orders,
          revenue: row.revenue
        });
      }
      
      // 평균 주문 금액 계산
      for (const plat of Object.values(platformTotals)) {
        plat.avgOrder = plat.totalOrders > 0 ? plat.totalRevenue / plat.totalOrders : 0;
      }
      
      const platformSummary = Object.values(platformTotals).sort((a, b) => b.totalRevenue - a.totalRevenue);
      const totalRevenue = platformSummary.reduce((s, p) => s + p.totalRevenue, 0);
      const totalOrders = platformSummary.reduce((s, p) => s + p.totalOrders, 0);
      
      // 비율 계산
      for (const plat of platformSummary) {
        plat.percentage = totalRevenue > 0 ? (plat.totalRevenue / totalRevenue * 100).toFixed(1) : 0;
        plat.orderPercentage = totalOrders > 0 ? (plat.totalOrders / totalOrders * 100).toFixed(1) : 0;
      }
      
      // 일별 데이터 (차트용)
      const dates = [...new Set(rows.map(r => r.date))].sort();
      const dailyChartData = dates.map(date => {
        const dayData = { date };
        for (const plat of platformSummary) {
          const found = plat.dailyData.find(d => d.date === date);
          dayData[plat.platform] = found?.revenue || 0;
          dayData[`${plat.platform}_orders`] = found?.orders || 0;
        }
        return dayData;
      });
      
      resolve({
        chartData: platformSummary,
        dailyChartData,
        platforms: platformSummary.map(p => p.platform),
        platformColors,
        summary: {
          totalRevenue,
          totalOrders,
          avgOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
          topPlatform: platformSummary[0] || null,
          platformCount: platformSummary.length
        },
        comparison: {
          dineIn: null, // 비교용 (나중에 추가 가능)
          togo: null,
          delivery: { revenue: totalRevenue, orders: totalOrders }
        }
      });
    });
  });
}

// Generic Report Data (미구현 레포트용)
function getGenericReportData(db, reportId, startDate, endDate) {
  return new Promise((resolve) => {
    resolve({
      message: `Report "${reportId}" data will be available soon`,
      dateRange: { startDate, endDate },
      chartData: []
    });
  });
}

// ==================== Firebase 동기화 API ====================

// POST /api/reports/sync/daily - 일일 레포트 Firebase 동기화
router.post('/sync/daily', async (req, res) => {
  try {
    const { storeId, date } = req.body;
    const targetDate = date || new Date().toISOString().split('T')[0];
    const targetStoreId = storeId || 'default';
    
    const result = await reportSyncService.syncDailyReportToFirebase(targetStoreId, targetDate);
    
    res.json({
      success: true,
      message: `Daily report synced for ${targetDate}`,
      data: result
    });
  } catch (error) {
    console.error('Daily sync error:', error);
    res.status(500).json({ error: 'Failed to sync daily report' });
  }
});

// POST /api/reports/sync/monthly - 월간 레포트 Firebase 동기화
router.post('/sync/monthly', async (req, res) => {
  try {
    const { storeId, yearMonth } = req.body;
    const targetMonth = yearMonth || new Date().toISOString().substring(0, 7);
    const targetStoreId = storeId || 'default';
    
    const result = await reportSyncService.syncMonthlyReportToFirebase(targetStoreId, targetMonth);
    
    res.json({
      success: true,
      message: `Monthly report synced for ${targetMonth}`,
      data: result
    });
  } catch (error) {
    console.error('Monthly sync error:', error);
    res.status(500).json({ error: 'Failed to sync monthly report' });
  }
});

// POST /api/reports/sync/shift - 시프트 클로즈 레포트 Firebase 동기화
router.post('/sync/shift', async (req, res) => {
  try {
    const { storeId, shiftData } = req.body;
    const targetStoreId = storeId || 'default';
    
    if (!shiftData) {
      return res.status(400).json({ error: 'Shift data is required' });
    }
    
    await reportSyncService.syncShiftCloseToFirebase(targetStoreId, shiftData);
    
    res.json({
      success: true,
      message: 'Shift close report synced'
    });
  } catch (error) {
    console.error('Shift sync error:', error);
    res.status(500).json({ error: 'Failed to sync shift report' });
  }
});

// POST /api/reports/auto-sync/start - 자동 동기화 시작
router.post('/auto-sync/start', (req, res) => {
  try {
    const { storeId, intervalMinutes } = req.body;
    const targetStoreId = storeId || 'default';
    const interval = intervalMinutes || 30;
    
    reportSyncService.startAutoSync(targetStoreId, interval);
    
    res.json({
      success: true,
      message: `Auto-sync started every ${interval} minutes`
    });
  } catch (error) {
    console.error('Auto-sync start error:', error);
    res.status(500).json({ error: 'Failed to start auto-sync' });
  }
});

// POST /api/reports/auto-sync/stop - 자동 동기화 중지
router.post('/auto-sync/stop', (req, res) => {
  try {
    reportSyncService.stopAutoSync();
    
    res.json({
      success: true,
      message: 'Auto-sync stopped'
    });
  } catch (error) {
    console.error('Auto-sync stop error:', error);
    res.status(500).json({ error: 'Failed to stop auto-sync' });
  }
});

// GET /api/reports/generate/:type - 특정 레포트 데이터 생성 (Firebase 저장 X)
router.get('/generate/daily/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const data = await reportSyncService.generateDailyReportData(date);
    res.json(data);
  } catch (error) {
    console.error('Generate daily report error:', error);
    res.status(500).json({ error: 'Failed to generate daily report' });
  }
});

router.get('/generate/monthly/:yearMonth', async (req, res) => {
  try {
    const { yearMonth } = req.params;
    const data = await reportSyncService.generateMonthlyReportData(yearMonth);
    res.json(data);
  } catch (error) {
    console.error('Generate monthly report error:', error);
    res.status(500).json({ error: 'Failed to generate monthly report' });
  }
});

module.exports = router;

