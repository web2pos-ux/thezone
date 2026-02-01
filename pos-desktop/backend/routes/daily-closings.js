const express = require('express');
const router = express.Router();
const firebaseService = require('../services/firebaseService');

// Restaurant ID 조회 헬퍼
let cachedRestaurantId = null;

module.exports = (db) => {
  // Get restaurant ID from admin_settings
  const getRestaurantId = async () => {
    if (cachedRestaurantId) return cachedRestaurantId;
    
    try {
      const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      
      const setting = await dbGet("SELECT value FROM admin_settings WHERE key = 'firebase_restaurant_id'");
      if (setting && setting.value) {
        cachedRestaurantId = setting.value;
        return cachedRestaurantId;
      }
    } catch (e) {
      console.error('Failed to get restaurant ID:', e.message);
    }
    return null;
  };
  // Helper functions
  const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });

  const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

  const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });

  // ============ CREATE TABLE ============
  const initTable = async () => {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS daily_closings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,
        opening_cash REAL DEFAULT 0,
        closing_cash REAL DEFAULT 0,
        expected_cash REAL DEFAULT 0,
        cash_difference REAL DEFAULT 0,
        total_sales REAL DEFAULT 0,
        cash_sales REAL DEFAULT 0,
        card_sales REAL DEFAULT 0,
        other_sales REAL DEFAULT 0,
        tax_total REAL DEFAULT 0,
        order_count INTEGER DEFAULT 0,
        refund_total REAL DEFAULT 0,
        refund_count INTEGER DEFAULT 0,
        discount_total REAL DEFAULT 0,
        void_total REAL DEFAULT 0,
        void_count INTEGER DEFAULT 0,
        tip_total REAL DEFAULT 0,
        opened_at TEXT,
        closed_at TEXT,
        opened_by TEXT,
        closed_by TEXT,
        notes TEXT,
        status TEXT DEFAULT 'open',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ daily_closings table initialized');
  };

  initTable().catch(err => console.error('Failed to init daily_closings table:', err));

  // ============ GET TODAY'S STATUS ============
  router.get('/today', async (req, res) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const record = await dbGet('SELECT * FROM daily_closings WHERE date = ?', [today]);
      
      res.json({
        success: true,
        data: record || null,
        isOpen: record?.status === 'open',
        isClosed: record?.status === 'closed'
      });
    } catch (error) {
      console.error('Get today status error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============ OPENING ============
  router.post('/opening', async (req, res) => {
    try {
      const { openingCash = 0, openedBy = '' } = req.body;
      const today = new Date().toISOString().split('T')[0];
      const now = new Date().toISOString();

      // Check if already opened today
      const existing = await dbGet('SELECT * FROM daily_closings WHERE date = ?', [today]);
      
      if (existing) {
        if (existing.status === 'open') {
          return res.status(400).json({ 
            success: false, 
            error: 'Day is already open',
            data: existing
          });
        }
        // If closed, can re-open (for corrections)
        await dbRun(
          `UPDATE daily_closings SET 
            status = 'open', 
            opening_cash = ?, 
            opened_at = ?, 
            opened_by = ?,
            closed_at = NULL,
            closed_by = NULL,
            updated_at = CURRENT_TIMESTAMP
          WHERE date = ?`,
          [openingCash, now, openedBy, today]
        );
      } else {
        await dbRun(
          `INSERT INTO daily_closings (date, opening_cash, opened_at, opened_by, status)
           VALUES (?, ?, ?, ?, 'open')`,
          [today, openingCash, now, openedBy]
        );
      }

      const record = await dbGet('SELECT * FROM daily_closings WHERE date = ?', [today]);
      
      // ============ Firebase 동기화 ============
      try {
        const restaurantId = await getRestaurantId();
        if (restaurantId) {
          const firebaseResult = await firebaseService.saveDailyClosing(restaurantId, {
            date: today,
            openingCash,
            openedAt: now,
            openedBy,
            status: 'open'
          });
          console.log('Firebase opening sync result:', firebaseResult);
        }
      } catch (firebaseError) {
        console.error('Firebase sync error (non-blocking):', firebaseError.message);
      }

      res.json({
        success: true,
        message: 'Day opened successfully',
        data: record
      });
    } catch (error) {
      console.error('Opening error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============ GET Z-REPORT DATA ============
  router.get('/z-report', async (req, res) => {
    try {
      const { date } = req.query;
      const targetDate = date || new Date().toISOString().split('T')[0];
      
      // Get sales data for the day
      // order_type variants: POS, pos, DINE_IN, TABLE_ORDER = Dine-In; TOGO, togo = Togo; ONLINE, online = Online; DELIVERY = Delivery
      // status variants: PAID, PICKED_UP, completed, closed = completed orders
      const salesData = await dbGet(`
        SELECT 
          COUNT(*) as order_count,
          COALESCE(SUM(total), 0) as total_sales,
          COALESCE(SUM(tax), 0) as tax_total,
          COALESCE(SUM(CASE WHEN UPPER(order_type) IN ('POS', 'DINE_IN', 'DINE-IN', 'TABLE_ORDER') THEN total ELSE 0 END), 0) as dine_in_sales,
          COALESCE(SUM(CASE WHEN UPPER(order_type) = 'TOGO' THEN total ELSE 0 END), 0) as togo_sales,
          COALESCE(SUM(CASE WHEN UPPER(order_type) = 'ONLINE' THEN total ELSE 0 END), 0) as online_sales,
          COALESCE(SUM(CASE WHEN UPPER(order_type) = 'DELIVERY' THEN total ELSE 0 END), 0) as delivery_sales
        FROM orders 
        WHERE DATE(created_at) = ? AND UPPER(status) IN ('PAID', 'PICKED_UP', 'CLOSED', 'COMPLETED')
      `, [targetDate]);

      // Get payment breakdown
      // payment_method variants: CASH, VISA, MC, DEBIT, OTHER_CARD, GIFT, COUPON, OTHER
      const paymentData = await dbGet(`
        SELECT 
          COALESCE(SUM(CASE WHEN UPPER(payment_method) = 'CASH' THEN amount ELSE 0 END), 0) as cash_sales,
          COALESCE(SUM(CASE WHEN UPPER(payment_method) IN ('VISA', 'MC', 'DEBIT', 'OTHER_CARD', 'CREDIT', 'CARD') THEN amount ELSE 0 END), 0) as card_sales,
          COALESCE(SUM(CASE WHEN UPPER(payment_method) NOT IN ('CASH', 'VISA', 'MC', 'DEBIT', 'OTHER_CARD', 'CREDIT', 'CARD') THEN amount ELSE 0 END), 0) as other_sales,
          COALESCE(SUM(tip), 0) as tip_total
        FROM payments 
        WHERE DATE(created_at) = ?
      `, [targetDate]);

      // Get refund data (refunds table uses 'total' column)
      const refundData = await dbGet(`
        SELECT 
          COUNT(*) as refund_count,
          COALESCE(SUM(total), 0) as refund_total
        FROM refunds 
        WHERE DATE(created_at) = ?
      `, [targetDate]);

      // Get void data (voids table uses 'grand_total' column)
      const voidData = await dbGet(`
        SELECT 
          COUNT(*) as void_count,
          COALESCE(SUM(grand_total), 0) as void_total
        FROM voids 
        WHERE DATE(created_at) = ?
      `, [targetDate]);

      // Get discount data
      const discountData = await dbGet(`
        SELECT COALESCE(SUM(
          CASE 
            WHEN adjustments_json IS NOT NULL 
            THEN (
              SELECT COALESCE(SUM(json_extract(value, '$.amountApplied')), 0)
              FROM json_each(adjustments_json)
            )
            ELSE 0 
          END
        ), 0) as discount_total
        FROM orders 
        WHERE DATE(created_at) = ? AND UPPER(status) IN ('PAID', 'PICKED_UP', 'CLOSED', 'COMPLETED')
      `, [targetDate]);

      // Get opening cash
      const closingRecord = await dbGet('SELECT * FROM daily_closings WHERE date = ?', [targetDate]);

      // Calculate expected cash
      const openingCash = closingRecord?.opening_cash || 0;
      const cashSales = paymentData?.cash_sales || 0;
      const cashRefunds = 0; // TODO: Get cash refunds specifically
      const expectedCash = openingCash + cashSales - cashRefunds;

      res.json({
        success: true,
        data: {
          date: targetDate,
          opening_cash: openingCash,
          expected_cash: expectedCash,
          // Sales
          total_sales: salesData?.total_sales || 0,
          order_count: salesData?.order_count || 0,
          tax_total: salesData?.tax_total || 0,
          // By type
          dine_in_sales: salesData?.dine_in_sales || 0,
          togo_sales: salesData?.togo_sales || 0,
          online_sales: salesData?.online_sales || 0,
          delivery_sales: salesData?.delivery_sales || 0,
          // By payment
          cash_sales: paymentData?.cash_sales || 0,
          card_sales: paymentData?.card_sales || 0,
          other_sales: paymentData?.other_sales || 0,
          tip_total: paymentData?.tip_total || 0,
          // Refunds & Voids
          refund_total: refundData?.refund_total || 0,
          refund_count: refundData?.refund_count || 0,
          void_total: voidData?.void_total || 0,
          void_count: voidData?.void_count || 0,
          // Discounts
          discount_total: discountData?.discount_total || 0,
          // Status
          status: closingRecord?.status || 'not_opened',
          opened_at: closingRecord?.opened_at || null,
          closed_at: closingRecord?.closed_at || null
        }
      });
    } catch (error) {
      console.error('Z-Report error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============ CHECK UNPAID ORDERS ============
  router.get('/check-unpaid-orders', async (req, res) => {
    try {
      // Check for tables with active orders (current_order_id is not null)
      const tablesWithOrders = await dbAll(`
        SELECT element_id, name, floor, current_order_id 
        FROM table_map_elements 
        WHERE current_order_id IS NOT NULL
      `);
      
      // Check for pending orders that are not paid
      const today = new Date().toISOString().split('T')[0];
      const unpaidOrders = await dbAll(`
        SELECT id, order_number, table_id, total, status, created_at 
        FROM orders 
        WHERE DATE(created_at) = ? 
        AND UPPER(status) NOT IN ('PAID', 'PICKED_UP', 'CLOSED', 'COMPLETED', 'CANCELLED', 'VOIDED')
      `, [today]);
      
      const hasUnpaidOrders = tablesWithOrders.length > 0 || unpaidOrders.length > 0;
      
      res.json({
        success: true,
        hasUnpaidOrders,
        tablesWithOrders: tablesWithOrders.map(t => ({
          tableId: t.element_id,
          tableName: t.name,
          floor: t.floor,
          orderId: t.current_order_id
        })),
        unpaidOrders: unpaidOrders.map(o => ({
          orderId: o.id,
          orderNumber: o.order_number,
          tableId: o.table_id,
          total: o.total,
          status: o.status
        })),
        count: tablesWithOrders.length + unpaidOrders.length
      });
    } catch (error) {
      console.error('Check unpaid orders error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============ CLOSING ============
  router.post('/closing', async (req, res) => {
    try {
      const { closingCash = 0, closedBy = '', notes = '' } = req.body;
      const today = new Date().toISOString().split('T')[0];
      const now = new Date().toISOString();

      // Fetch closing data directly
      const salesData = await dbGet(`
        SELECT 
          COUNT(*) as order_count,
          COALESCE(SUM(total), 0) as total_sales,
          COALESCE(SUM(tax), 0) as tax_total
        FROM orders 
        WHERE DATE(created_at) = ? AND UPPER(status) IN ('PAID', 'PICKED_UP', 'CLOSED', 'COMPLETED')
      `, [today]);

      const paymentData = await dbGet(`
        SELECT 
          COALESCE(SUM(CASE WHEN UPPER(payment_method) = 'CASH' THEN amount ELSE 0 END), 0) as cash_sales,
          COALESCE(SUM(CASE WHEN UPPER(payment_method) IN ('VISA', 'MC', 'DEBIT', 'OTHER_CARD', 'CREDIT', 'CARD') THEN amount ELSE 0 END), 0) as card_sales,
          COALESCE(SUM(CASE WHEN UPPER(payment_method) NOT IN ('CASH', 'VISA', 'MC', 'DEBIT', 'OTHER_CARD', 'CREDIT', 'CARD') THEN amount ELSE 0 END), 0) as other_sales,
          COALESCE(SUM(tip), 0) as tip_total
        FROM payments 
        WHERE DATE(created_at) = ?
      `, [today]);

      const refundData = await dbGet(`
        SELECT 
          COUNT(*) as refund_count,
          COALESCE(SUM(total), 0) as refund_total
        FROM refunds 
        WHERE DATE(created_at) = ?
      `, [today]);

      const voidData = await dbGet(`
        SELECT 
          COUNT(*) as void_count,
          COALESCE(SUM(grand_total), 0) as void_total
        FROM voids 
        WHERE DATE(created_at) = ?
      `, [today]);

      // Check if record exists
      const existing = await dbGet('SELECT * FROM daily_closings WHERE date = ?', [today]);
      
      const openingCash = existing?.opening_cash || 0;
      const expectedCash = openingCash + (paymentData?.cash_sales || 0);
      const cashDifference = closingCash - expectedCash;

      if (existing) {
        await dbRun(`
          UPDATE daily_closings SET 
            status = 'closed',
            closing_cash = ?,
            expected_cash = ?,
            cash_difference = ?,
            total_sales = ?,
            cash_sales = ?,
            card_sales = ?,
            other_sales = ?,
            tax_total = ?,
            order_count = ?,
            refund_total = ?,
            refund_count = ?,
            void_total = ?,
            void_count = ?,
            tip_total = ?,
            closed_at = ?,
            closed_by = ?,
            notes = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE date = ?
        `, [
          closingCash,
          expectedCash,
          cashDifference,
          salesData?.total_sales || 0,
          paymentData?.cash_sales || 0,
          paymentData?.card_sales || 0,
          paymentData?.other_sales || 0,
          salesData?.tax_total || 0,
          salesData?.order_count || 0,
          refundData?.refund_total || 0,
          refundData?.refund_count || 0,
          voidData?.void_total || 0,
          voidData?.void_count || 0,
          paymentData?.tip_total || 0,
          now,
          closedBy,
          notes,
          today
        ]);
      } else {
        await dbRun(`
          INSERT INTO daily_closings (
            date, status, opening_cash, closing_cash, expected_cash, cash_difference,
            total_sales, cash_sales, card_sales, other_sales, tax_total, order_count,
            refund_total, refund_count, void_total, void_count, tip_total,
            closed_at, closed_by, notes
          ) VALUES (?, 'closed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          today, 0, closingCash, expectedCash, cashDifference,
          salesData?.total_sales || 0,
          paymentData?.cash_sales || 0,
          paymentData?.card_sales || 0,
          paymentData?.other_sales || 0,
          salesData?.tax_total || 0,
          salesData?.order_count || 0,
          refundData?.refund_total || 0,
          refundData?.refund_count || 0,
          voidData?.void_total || 0,
          voidData?.void_count || 0,
          paymentData?.tip_total || 0,
          now, closedBy, notes
        ]);
      }

      const record = await dbGet('SELECT * FROM daily_closings WHERE date = ?', [today]);

      // ============ Firebase 동기화 ============
      try {
        const restaurantId = await getRestaurantId();
        if (restaurantId) {
          const firebaseResult = await firebaseService.saveDailyClosing(restaurantId, {
            ...record,
            closingCash,
            expectedCash,
            cashDifference,
            totalSales: salesData?.total_sales || 0,
            cashSales: paymentData?.cash_sales || 0,
            cardSales: paymentData?.card_sales || 0,
            otherSales: paymentData?.other_sales || 0,
            taxTotal: salesData?.tax_total || 0,
            orderCount: salesData?.order_count || 0,
            refundTotal: refundData?.refund_total || 0,
            refundCount: refundData?.refund_count || 0,
            voidTotal: voidData?.void_total || 0,
            voidCount: voidData?.void_count || 0,
            tipTotal: paymentData?.tip_total || 0,
            closedAt: now,
            closedBy,
            notes
          });
          console.log('Firebase sync result:', firebaseResult);
        } else {
          console.log('No restaurant ID configured, skipping Firebase sync');
        }
      } catch (firebaseError) {
        console.error('Firebase sync error (non-blocking):', firebaseError.message);
      }

      res.json({
        success: true,
        message: 'Day closed successfully',
        data: record
      });
    } catch (error) {
      console.error('Closing error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============ GET HISTORY ============
  router.get('/history', async (req, res) => {
    try {
      const { limit = 30 } = req.query;
      const records = await dbAll(
        'SELECT * FROM daily_closings ORDER BY date DESC LIMIT ?',
        [parseInt(limit)]
      );
      
      res.json({
        success: true,
        data: records
      });
    } catch (error) {
      console.error('Get history error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============ PRINT OPENING REPORT ============
  router.post('/print-opening', async (req, res) => {
    try {
      const { openingCash = 0, cashBreakdown = {} } = req.body;
      const today = new Date().toISOString().split('T')[0];
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      
      // ESC/POS Commands
      const ESC = '\x1B';
      const GS = '\x1D';
      const BOLD_ON = ESC + 'E' + '\x01';
      const BOLD_OFF = ESC + 'E' + '\x00';
      const DOUBLE_WIDTH_ON = GS + '!' + '\x10';  // Double width
      const DOUBLE_HEIGHT_ON = GS + '!' + '\x01'; // Double height
      const DOUBLE_SIZE_ON = GS + '!' + '\x11';   // Double width + height
      const NORMAL_SIZE = GS + '!' + '\x00';      // Normal size
      const ALIGN_CENTER = ESC + 'a' + '\x01';
      const ALIGN_LEFT = ESC + 'a' + '\x00';
      
      // Build print content
      const LINE_WIDTH = 42;
      const LINE_WIDTH_DOUBLE = 21; // For double-width text
      const center = (text, width = LINE_WIDTH) => {
        const pad = Math.max(0, Math.floor((width - text.length) / 2));
        return ' '.repeat(pad) + text;
      };
      const leftRight = (l, r) => {
        const spaces = Math.max(1, LINE_WIDTH - l.length - r.length);
        return l + ' '.repeat(spaces) + r;
      };
      const line = '='.repeat(LINE_WIDTH);
      const dottedLine = '-'.repeat(LINE_WIDTH);
      
      let printContent = '\n';
      printContent += line + '\n';
      // DAY OPENING - Double size + Bold
      printContent += ALIGN_CENTER + DOUBLE_SIZE_ON + BOLD_ON;
      printContent += center('*** DAY OPENING ***', LINE_WIDTH_DOUBLE) + '\n';
      printContent += NORMAL_SIZE + BOLD_OFF + ALIGN_LEFT;
      printContent += line + '\n';
      // Date - Bold
      printContent += ALIGN_CENTER + BOLD_ON;
      printContent += center(now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })) + '\n';
      printContent += center(`Time: ${timeStr}`) + '\n';
      printContent += BOLD_OFF + ALIGN_LEFT;
      printContent += dottedLine + '\n';
      printContent += '\n';
      printContent += BOLD_ON + center('STARTING CASH COUNT') + BOLD_OFF + '\n';
      printContent += dottedLine + '\n';
      
      // Cash breakdown
      const denominations = [
        { key: 'cent1', label: '1 Cent', value: 0.01 },
        { key: 'cent5', label: '5 Cents', value: 0.05 },
        { key: 'cent10', label: '10 Cents', value: 0.10 },
        { key: 'cent25', label: '25 Cents', value: 0.25 },
        { key: 'dollar1', label: '$1 Bills', value: 1 },
        { key: 'dollar5', label: '$5 Bills', value: 5 },
        { key: 'dollar10', label: '$10 Bills', value: 10 },
        { key: 'dollar20', label: '$20 Bills', value: 20 },
        { key: 'dollar50', label: '$50 Bills', value: 50 },
        { key: 'dollar100', label: '$100 Bills', value: 100 },
      ];
      
      denominations.forEach(d => {
        const count = cashBreakdown[d.key] || 0;
        if (count > 0) {
          const subtotal = (count * d.value).toFixed(2);
          // Amount in bold
          printContent += `${d.label} x ${count}`;
          const spaces = Math.max(1, LINE_WIDTH - `${d.label} x ${count}`.length - `$${subtotal}`.length);
          printContent += ' '.repeat(spaces) + BOLD_ON + `$${subtotal}` + BOLD_OFF + '\n';
        }
      });
      
      printContent += dottedLine + '\n';
      // Total - Bold
      printContent += BOLD_ON + leftRight('TOTAL STARTING CASH:', `$${openingCash.toFixed(2)}`) + BOLD_OFF + '\n';
      printContent += line + '\n';
      printContent += '\n\n\n';
      
      // Send to printer
      const http = require('http');
      const printData = JSON.stringify({
        text: printContent,
        openDrawer: true
      });
      
      const printReq = http.request({
        hostname: 'localhost',
        port: 3177,
        path: '/api/printers/print-text',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(printData)
        }
      }, (printRes) => {
        let responseData = '';
        printRes.on('data', chunk => { responseData += chunk; });
        printRes.on('end', () => {
          console.log('Opening report printed');
        });
      });
      
      printReq.on('error', (err) => {
        console.error('Print error:', err.message);
      });
      
      printReq.write(printData);
      printReq.end();
      
      res.json({ success: true, message: 'Opening report sent to printer' });
    } catch (error) {
      console.error('Print opening error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============ PRINT Z-REPORT ============
  router.post('/print-z-report', async (req, res) => {
    try {
      const { zReportData, closingCash = 0, cashBreakdown = {} } = req.body;
      const today = new Date().toISOString().split('T')[0];
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      
      // ESC/POS Commands
      const ESC = '\x1B';
      const GS = '\x1D';
      const BOLD_ON = ESC + 'E' + '\x01';
      const BOLD_OFF = ESC + 'E' + '\x00';
      const DOUBLE_SIZE_ON = GS + '!' + '\x11';   // Double width + height
      const NORMAL_SIZE = GS + '!' + '\x00';      // Normal size
      const ALIGN_CENTER = ESC + 'a' + '\x01';
      const ALIGN_LEFT = ESC + 'a' + '\x00';
      
      const LINE_WIDTH = 42;
      const LINE_WIDTH_DOUBLE = 21;
      const center = (text, width = LINE_WIDTH) => {
        const pad = Math.max(0, Math.floor((width - text.length) / 2));
        return ' '.repeat(pad) + text;
      };
      const leftRight = (l, r) => {
        const spaces = Math.max(1, LINE_WIDTH - l.length - r.length);
        return l + ' '.repeat(spaces) + r;
      };
      const leftRightBold = (l, r) => {
        const spaces = Math.max(1, LINE_WIDTH - l.length - r.length);
        return l + ' '.repeat(spaces) + BOLD_ON + r + BOLD_OFF;
      };
      const line = '='.repeat(LINE_WIDTH);
      const dottedLine = '-'.repeat(LINE_WIDTH);
      const formatMoney = (amt) => `$${(amt || 0).toFixed(2)}`;
      
      let printContent = '\n';
      printContent += line + '\n';
      // Z-REPORT header - Double size + Bold
      printContent += ALIGN_CENTER + DOUBLE_SIZE_ON + BOLD_ON;
      printContent += center('*** Z-REPORT ***', LINE_WIDTH_DOUBLE) + '\n';
      printContent += NORMAL_SIZE;
      printContent += center('DAY CLOSING REPORT') + '\n';
      printContent += BOLD_OFF + ALIGN_LEFT;
      printContent += line + '\n';
      // Date - Bold
      printContent += ALIGN_CENTER + BOLD_ON;
      printContent += center(now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })) + '\n';
      printContent += center(`Printed: ${timeStr}`) + '\n';
      printContent += BOLD_OFF + ALIGN_LEFT;
      printContent += line + '\n';
      
      // Sales Summary
      printContent += '\n' + BOLD_ON + center('-- SALES SUMMARY --') + BOLD_OFF + '\n';
      printContent += dottedLine + '\n';
      printContent += leftRightBold('Total Orders:', `${zReportData?.order_count || 0}`) + '\n';
      printContent += leftRightBold('Total Sales:', formatMoney(zReportData?.total_sales)) + '\n';
      printContent += leftRightBold('Tax Collected:', formatMoney(zReportData?.tax_total)) + '\n';
      printContent += leftRightBold('Tips:', formatMoney(zReportData?.tip_total)) + '\n';
      
      // Sales by Type
      printContent += '\n' + BOLD_ON + center('-- SALES BY TYPE --') + BOLD_OFF + '\n';
      printContent += dottedLine + '\n';
      printContent += leftRightBold('Dine-In:', formatMoney(zReportData?.dine_in_sales)) + '\n';
      printContent += leftRightBold('Togo:', formatMoney(zReportData?.togo_sales)) + '\n';
      printContent += leftRightBold('Online:', formatMoney(zReportData?.online_sales)) + '\n';
      printContent += leftRightBold('Delivery:', formatMoney(zReportData?.delivery_sales)) + '\n';
      
      // Payment Breakdown
      printContent += '\n' + BOLD_ON + center('-- PAYMENT BREAKDOWN --') + BOLD_OFF + '\n';
      printContent += dottedLine + '\n';
      printContent += leftRightBold('Cash:', formatMoney(zReportData?.cash_sales)) + '\n';
      printContent += leftRightBold('Card:', formatMoney(zReportData?.card_sales)) + '\n';
      printContent += leftRightBold('Other:', formatMoney(zReportData?.other_sales)) + '\n';
      
      // Adjustments
      printContent += '\n' + BOLD_ON + center('-- ADJUSTMENTS --') + BOLD_OFF + '\n';
      printContent += dottedLine + '\n';
      printContent += leftRightBold(`Refunds (${zReportData?.refund_count || 0}):`, `-${formatMoney(zReportData?.refund_total)}`) + '\n';
      printContent += leftRightBold(`Voids (${zReportData?.void_count || 0}):`, `-${formatMoney(zReportData?.void_total)}`) + '\n';
      printContent += leftRightBold('Discounts:', `-${formatMoney(zReportData?.discount_total)}`) + '\n';
      
      // Cash Drawer
      printContent += '\n' + BOLD_ON + center('-- CASH DRAWER --') + BOLD_OFF + '\n';
      printContent += dottedLine + '\n';
      printContent += leftRightBold('Opening Cash:', formatMoney(zReportData?.opening_cash)) + '\n';
      printContent += leftRightBold('Cash Sales:', formatMoney(zReportData?.cash_sales)) + '\n';
      printContent += leftRightBold('Expected Cash:', formatMoney(zReportData?.expected_cash)) + '\n';
      printContent += dottedLine + '\n';
      
      // Cash Count Breakdown
      printContent += BOLD_ON + center('ACTUAL CASH COUNT') + BOLD_OFF + '\n';
      const denominations = [
        { key: 'cent1', label: '1 Cent', value: 0.01 },
        { key: 'cent5', label: '5 Cents', value: 0.05 },
        { key: 'cent10', label: '10 Cents', value: 0.10 },
        { key: 'cent25', label: '25 Cents', value: 0.25 },
        { key: 'dollar1', label: '$1 Bills', value: 1 },
        { key: 'dollar5', label: '$5 Bills', value: 5 },
        { key: 'dollar10', label: '$10 Bills', value: 10 },
        { key: 'dollar20', label: '$20 Bills', value: 20 },
        { key: 'dollar50', label: '$50 Bills', value: 50 },
        { key: 'dollar100', label: '$100 Bills', value: 100 },
      ];
      
      denominations.forEach(d => {
        const count = cashBreakdown[d.key] || 0;
        if (count > 0) {
          const subtotal = (count * d.value).toFixed(2);
          printContent += leftRightBold(`${d.label} x ${count}`, `$${subtotal}`) + '\n';
        }
      });
      
      printContent += dottedLine + '\n';
      printContent += BOLD_ON + leftRight('ACTUAL CASH:', formatMoney(closingCash)) + BOLD_OFF + '\n';
      
      const difference = closingCash - (zReportData?.expected_cash || 0);
      const diffStr = difference >= 0 ? `+${formatMoney(difference)}` : formatMoney(difference);
      printContent += BOLD_ON + leftRight('DIFFERENCE:', diffStr) + BOLD_OFF + '\n';
      
      printContent += line + '\n';
      printContent += '\n\n\n';
      
      // Send to printer
      const http = require('http');
      const printData = JSON.stringify({
        text: printContent,
        openDrawer: false
      });
      
      const printReq = http.request({
        hostname: 'localhost',
        port: 3177,
        path: '/api/printers/print-text',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(printData)
        }
      }, (printRes) => {
        let responseData = '';
        printRes.on('data', chunk => { responseData += chunk; });
        printRes.on('end', () => {
          console.log('Z-Report printed');
        });
      });
      
      printReq.on('error', (err) => {
        console.error('Print error:', err.message);
      });
      
      printReq.write(printData);
      printReq.end();
      
      res.json({ success: true, message: 'Z-Report sent to printer' });
    } catch (error) {
      console.error('Print Z-Report error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============ OPEN CASH DRAWER ============
  router.post('/open-drawer', async (req, res) => {
    try {
      // Send drawer kick command to receipt printer
      const http = require('http');
      
      const drawerData = JSON.stringify({
        action: 'open-drawer'
      });

      const drawerReq = http.request({
        hostname: 'localhost',
        port: 3177,
        path: '/api/printers/open-drawer',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(drawerData)
        }
      }, (drawerRes) => {
        let responseData = '';
        drawerRes.on('data', chunk => { responseData += chunk; });
        drawerRes.on('end', () => {
          console.log('Cash drawer opened');
        });
      });

      drawerReq.on('error', (err) => {
        console.error('Drawer open error:', err.message);
      });

      drawerReq.write(drawerData);
      drawerReq.end();

      res.json({ success: true, message: 'Cash drawer opened' });
    } catch (error) {
      console.error('Open drawer error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
};
