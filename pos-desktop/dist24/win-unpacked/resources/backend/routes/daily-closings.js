const express = require('express');
const router = express.Router();
const firebaseService = require('../services/firebaseService');
const { getLocalDatetimeString } = require('../utils/datetimeUtils');

// Restaurant ID 조회 헬퍼
let cachedRestaurantId = null;

module.exports = (db) => {
  // Get restaurant ID from admin_settings
  const getRestaurantId = async () => {
    if (cachedRestaurantId) return cachedRestaurantId;
    try {
      const dbGetLocal = (sql, params = []) => new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); });
      });
      const setting = await dbGetLocal("SELECT value FROM admin_settings WHERE key = 'firebase_restaurant_id'");
      if (setting && setting.value) { cachedRestaurantId = setting.value; return cachedRestaurantId; }
    } catch (e) { console.error('Failed to get restaurant ID:', e.message); }
    return null;
  };

  // Helper functions
  const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) { if (err) reject(err); else resolve({ lastID: this.lastID, changes: this.changes }); });
  });
  const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); });
  });
  const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows || []); });
  });

  // ===== Printer helper (Front receipt printer) =====
  const printEscPosTextToFront = async (text, { openDrawer = false } = {}) => {
    if (!text) throw new Error('No text provided');
    // Prefer Front printer; for openDrawer this is required.
    const frontPrinter = await dbGet("SELECT selected_printer FROM printers WHERE name LIKE '%Front%' AND selected_printer IS NOT NULL LIMIT 1");
    let targetPrinter = frontPrinter?.selected_printer;
    if (!targetPrinter && !openDrawer) {
      const anyPrinter = await dbGet(
        "SELECT selected_printer FROM printers WHERE is_active = 1 AND selected_printer IS NOT NULL ORDER BY printer_id ASC LIMIT 1"
      );
      targetPrinter = anyPrinter?.selected_printer;
    }
    if (!targetPrinter) {
      throw new Error(openDrawer
        ? 'No Front printer configured. Please set up the Front printer in Back Office → Printers.'
        : 'No printer configured. Please set up a printer in Back Office → Printers.'
      );
    }
    const ESC = '\x1B';
    const GS = '\x1D';
    const INIT = ESC + '@';
    const CUT = GS + 'V' + '\x00';
    let printData = INIT + String(text) + '\n\n\n' + CUT;
    if (openDrawer) {
      const DRAWER_KICK = ESC + 'p' + '\x00' + '\x19' + '\x19';
      printData = DRAWER_KICK + printData;
    }
    const buf = Buffer.from(printData, 'binary');
    const { sendRawToPrinter } = require('../utils/printerUtils');
    await sendRawToPrinter(targetPrinter, buf);
    return targetPrinter;
  };

  // Helper: Get local date string (YYYY-MM-DD)
  const getLocalDate = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  };

  // Helper: Generate session ID
  const generateSessionId = () => {
    const now = new Date();
    const dateStr = getLocalDate().replace(/-/g, '');
    return `SES-${dateStr}-${now.getTime()}`;
  };

  // ============ TABLE INIT & MIGRATION ============
  const initTable = async () => {
    // Check if daily_closings exists and needs migration
    let needsMigration = false;
    let tableExists = false;
    try {
      const info = await dbAll("PRAGMA table_info(daily_closings)");
      if (info.length > 0) {
        tableExists = true;
        needsMigration = !info.some(col => col.name === 'session_id');
      }
    } catch (e) { /* table doesn't exist */ }

    if (tableExists && needsMigration) {
      console.log('[daily-closings] Migrating daily_closings table to session-based schema...');
      try {
        await dbRun(`CREATE TABLE IF NOT EXISTS daily_closings_v2 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          date TEXT NOT NULL,
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
          opening_cash_details TEXT,
          closing_cash_details TEXT,
          status TEXT DEFAULT 'open',
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`);

        // Copy existing data
        await dbRun(`INSERT INTO daily_closings_v2 (
          id, date, opening_cash, closing_cash, expected_cash, cash_difference,
          total_sales, cash_sales, card_sales, other_sales, tax_total, order_count,
          refund_total, refund_count, discount_total, void_total, void_count, tip_total,
          opened_at, closed_at, opened_by, closed_by, notes, status, created_at, updated_at,
          session_id
        ) SELECT 
          id, date, opening_cash, closing_cash, expected_cash, cash_difference,
          total_sales, cash_sales, card_sales, other_sales, tax_total, order_count,
          refund_total, refund_count, discount_total, void_total, void_count, tip_total,
          opened_at, closed_at, opened_by, closed_by, notes, status, created_at, updated_at,
          'SES-' || REPLACE(date, '-', '') || '-' || CAST(COALESCE(id, 0) AS TEXT)
        FROM daily_closings`);

        await dbRun('DROP TABLE daily_closings');
        await dbRun('ALTER TABLE daily_closings_v2 RENAME TO daily_closings');
        console.log('✅ daily_closings table migrated to session-based schema');
      } catch (migErr) {
        console.error('Migration error:', migErr);
      }
    } else if (!tableExists) {
      await dbRun(`CREATE TABLE IF NOT EXISTS daily_closings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        date TEXT NOT NULL,
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
        opening_cash_details TEXT,
        closing_cash_details TEXT,
        status TEXT DEFAULT 'open',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`);
    }
    console.log('✅ daily_closings table initialized');

    // Shift closings table
    await dbRun(`CREATE TABLE IF NOT EXISTS shift_closings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      shift_number INTEGER NOT NULL DEFAULT 1,
      shift_start TEXT,
      shift_end TEXT,
      closed_by TEXT,
      total_sales REAL DEFAULT 0,
      order_count INTEGER DEFAULT 0,
      cash_sales REAL DEFAULT 0,
      card_sales REAL DEFAULT 0,
      other_sales REAL DEFAULT 0,
      tip_total REAL DEFAULT 0,
      opening_cash REAL DEFAULT 0,
      expected_cash REAL DEFAULT 0,
      counted_cash REAL DEFAULT 0,
      cash_difference REAL DEFAULT 0,
      cash_details TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    console.log('✅ shift_closings table initialized');

    // admin_settings
    await dbRun(`CREATE TABLE IF NOT EXISTS admin_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )`);
    console.log('✅ admin_settings table initialized');
  };

  initTable().catch(err => console.error('Failed to init tables:', err));

  // ============ HELPER: Get active session ============
  const getActiveSession = async () => {
    return await dbGet("SELECT * FROM daily_closings WHERE status = 'open' ORDER BY id DESC LIMIT 1");
  };

  // ============ HELPER: Build time-range WHERE clause ============
  // Returns { where: 'created_at >= ? AND created_at <= ?', params: [start, end] }
  const sessionTimeFilter = (session, columnName = 'created_at') => {
    const startTime = session.opened_at;
    const endTime = session.closed_at || getLocalDatetimeString();
    return {
      where: `${columnName} >= ? AND ${columnName} <= ?`,
      params: [startTime, endTime]
    };
  };

  // ============ GET TODAY'S STATUS ============
  router.get('/today', async (req, res) => {
    try {
      const activeSession = await getActiveSession();
      res.json({
        success: true,
        data: activeSession || null,
        isOpen: !!activeSession,
        isClosed: !activeSession,
        sessionId: activeSession?.session_id || null
      });
    } catch (error) {
      console.error('Get today status error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============ OPENING ============
  router.post('/opening', async (req, res) => {
    try {
      const { openingCash = 0, openedBy = '', cashBreakdown = {} } = req.body;
      const today = getLocalDate();
      const now = getLocalDatetimeString();
      const sessionId = generateSessionId();

      // Check if there's already an active session
      const activeSession = await getActiveSession();
      if (activeSession) {
        // If an "open" session exists for a previous date, auto-close it so today's Opening
        // can proceed and the POS daily order counter can reliably reset to 001.
        if (String(activeSession.date || '').trim() && String(activeSession.date || '').trim() !== String(today)) {
          try {
            await dbRun(
              `UPDATE daily_closings
               SET status = 'closed',
                   closed_at = COALESCE(closed_at, ?),
                   closed_by = COALESCE(closed_by, ?),
                   notes = CASE
                     WHEN notes IS NULL OR TRIM(notes) = '' THEN 'Auto-closed by Day Opening (previous day session)'
                     ELSE notes || '\n' || 'Auto-closed by Day Opening (previous day session)'
                   END,
                   updated_at = CURRENT_TIMESTAMP
               WHERE session_id = ?`,
              [now, (openedBy || 'SYSTEM'), activeSession.session_id]
            );
            console.log(`✅ [daily-closings] Auto-closed previous open session: ${activeSession.session_id} (${activeSession.date} → opening ${today})`);
          } catch (autoCloseErr) {
            console.error('[daily-closings] Failed to auto-close previous open session:', autoCloseErr?.message || autoCloseErr);
          }
        } else {
          // Session is already open for today.
          // Still reset the POS daily order counter so the next order starts from 001 as requested.
          try {
            await dbRun(`INSERT OR REPLACE INTO admin_settings(key, value) VALUES('daily_order_counter', '0')`);
            console.log('✅ Daily order counter reset to 0 (session already open)');
          } catch (counterErr) {
            console.error('Failed to reset daily order counter (session already open):', counterErr.message);
          }
          return res.json({
            success: true,
            message: 'Session is already open. Daily order counter reset to 001 for next order.',
            data: activeSession
          });
        }
      }

      // Create new session
      await dbRun(
        `INSERT INTO daily_closings (session_id, date, opening_cash, opening_cash_details, opened_at, opened_by, status)
         VALUES (?, ?, ?, ?, ?, ?, 'open')`,
        [sessionId, today, openingCash, JSON.stringify(cashBreakdown), now, openedBy]
      );

      const record = await dbGet('SELECT * FROM daily_closings WHERE session_id = ?', [sessionId]);

      // 주문번호 카운터 리셋
      try {
        await dbRun(`INSERT OR REPLACE INTO admin_settings(key, value) VALUES('daily_order_counter', '0')`);
        console.log('✅ Daily order counter reset to 0');
      } catch (counterErr) {
        console.error('Failed to reset daily order counter:', counterErr.message);
      }

      // Firebase 동기화
      try {
        const restaurantId = await getRestaurantId();
        if (restaurantId) {
          await firebaseService.saveDailyClosing(restaurantId, {
            date: today, sessionId, openingCash, openedAt: now, openedBy, status: 'open'
          });
        }
      } catch (firebaseError) {
        console.error('Firebase sync error (non-blocking):', firebaseError.message);
      }

      res.json({ success: true, message: 'Session opened successfully', data: record });
    } catch (error) {
      console.error('Opening error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============ HELPER: Query sales data for a time range ============
  const querySalesData = async (startTime, endTime) => {
    const tf = { where: `created_at >= ? AND created_at <= ?`, params: [startTime, endTime] };
    // For JOIN queries: prefix all created_at with table alias
    const tfPrefixed = (alias) => ({
      where: `${alias}.created_at >= ? AND ${alias}.created_at <= ?`,
      params: [startTime, endTime]
    });

    // Sales Data - order counts and time range from orders table
    const salesData = await dbGet(`
      SELECT 
        COUNT(*) as order_count,
        COALESCE(SUM(subtotal), 0) as subtotal,
        COALESCE(SUM(tax), 0) as tax_total,
        COALESCE(SUM(CASE WHEN UPPER(order_type) IN ('POS', 'DINE_IN', 'DINE-IN', 'TABLE_ORDER') THEN 1 ELSE 0 END), 0) as dine_in_order_count,
        COALESCE(SUM(CASE WHEN UPPER(order_type) = 'TOGO' THEN 1 ELSE 0 END), 0) as togo_order_count,
        COALESCE(SUM(CASE WHEN UPPER(order_type) = 'ONLINE' THEN 1 ELSE 0 END), 0) as online_order_count,
        COALESCE(SUM(CASE WHEN UPPER(order_type) = 'DELIVERY' THEN 1 ELSE 0 END), 0) as delivery_order_count,
        MIN(created_at) as first_order_time,
        MAX(created_at) as last_order_time
      FROM orders 
      WHERE ${tf.where} AND UPPER(status) IN ('PAID', 'PICKED_UP', 'CLOSED', 'COMPLETED')
    `, tf.params);

    // Payments-based totals (actual revenue collected) - source of truth
    const ptTotal = await dbGet(`
      SELECT COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as payments_total
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE o.created_at >= ? AND o.created_at <= ? AND UPPER(o.status) IN ('PAID','PICKED_UP','CLOSED','COMPLETED')
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
    `, tf.params);
    salesData.total_sales = Number(ptTotal?.payments_total || 0);

    // Channel sales from payments
    const channelSalesRows = await dbAll(`
      SELECT
        CASE
          WHEN UPPER(o.order_type) IN ('POS','DINE_IN','DINE-IN','TABLE_ORDER') THEN 'DINE_IN'
          WHEN UPPER(o.order_type) = 'TOGO' THEN 'TOGO'
          WHEN UPPER(o.order_type) = 'ONLINE' THEN 'ONLINE'
          WHEN UPPER(o.order_type) = 'DELIVERY' THEN 'DELIVERY'
          ELSE 'OTHER'
        END as ch,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as sales
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE o.created_at >= ? AND o.created_at <= ? AND UPPER(o.status) IN ('PAID','PICKED_UP','CLOSED','COMPLETED')
        AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
      GROUP BY ch
    `, tf.params);
    const chMap = {};
    (channelSalesRows || []).forEach(r => { chMap[r.ch] = Number(r.sales); });
    salesData.dine_in_sales = chMap['DINE_IN'] || 0;
    salesData.togo_sales = chMap['TOGO'] || 0;
    salesData.online_sales = chMap['ONLINE'] || 0;
    salesData.delivery_sales = chMap['DELIVERY'] || 0;

    // GST / PST separation from order_items + tax_groups (Canadian tax compliance)
    let gstTotal = 0, pstTotal = 0;
    try {
      const oTf = tfPrefixed('o');
      const taxSplit = await dbGet(`
        SELECT
          COALESCE(SUM(
            (oi.price * oi.quantity) * (
              SELECT COALESCE(SUM(CASE WHEN UPPER(t.name) LIKE '%GST%' THEN t.rate ELSE 0 END),
                CASE WHEN oi.tax_group_id IS NULL OR NOT EXISTS (SELECT 1 FROM tax_group_links tgl2 WHERE tgl2.tax_group_id = oi.tax_group_id) THEN 5 ELSE 0 END
              ) / 100
              FROM tax_group_links tgl
              JOIN taxes t ON t.tax_id = tgl.tax_id
              WHERE tgl.tax_group_id = oi.tax_group_id
            )
          ), 0) as gst_total,
          COALESCE(SUM(
            (oi.price * oi.quantity) * (
              SELECT COALESCE(SUM(CASE WHEN UPPER(t.name) LIKE '%PST%' THEN t.rate ELSE 0 END), 0) / 100
              FROM tax_group_links tgl
              JOIN taxes t ON t.tax_id = tgl.tax_id
              WHERE tgl.tax_group_id = oi.tax_group_id
            )
          ), 0) as pst_total
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE ${oTf.where} AND UPPER(o.status) IN ('PAID', 'PICKED_UP', 'CLOSED', 'COMPLETED')
          AND COALESCE(oi.is_voided, 0) = 0
      `, oTf.params);
      gstTotal = Number(taxSplit?.gst_total || 0);
      pstTotal = Number(taxSplit?.pst_total || 0);
    } catch (e) { /* tax_groups/taxes may not exist */ }

    // ---- CASH DRAWER CORRECT CALCULATION ----
    // Actual cash = Order totals - Non-cash payments (change is automatically excluded)
    // Non-cash payments (card, etc.) - amount minus tip
    const nonCashData = await dbGet(`
      SELECT COALESCE(SUM(amount - COALESCE(tip, 0)), 0) as non_cash_net
      FROM payments
      WHERE ${tf.where} AND status = 'APPROVED'
      AND UPPER(payment_method) NOT IN ('CASH', 'NO_SHOW_FORFEITED')
    `, tf.params);
    // Cash tips that went into the drawer (tips table + legacy payments.tip)
    const cashTipLegacyData = await dbGet(`
      SELECT COALESCE(SUM(COALESCE(tip, 0)), 0) as cash_tips
      FROM payments
      WHERE ${tf.where} AND status = 'APPROVED' AND UPPER(payment_method) = 'CASH'
    `, tf.params);
    const cashTipData = await dbGet(`
      SELECT COALESCE(SUM(amount), 0) as cash_tips
      FROM tips
      WHERE ${tf.where} AND UPPER(payment_method) = 'CASH'
    `, tf.params);
    const totalOrderSales = salesData?.total_sales || 0;
    const nonCashNet = nonCashData?.non_cash_net || 0;
    const actualCashSales = Math.max(0, totalOrderSales - nonCashNet); // Cash portion of orders (change excluded)
    const actualCashTips = (cashTipData?.cash_tips || 0) + (cashTipLegacyData?.cash_tips || 0);

    // Guest Count
    let guestCount = 0;
    try {
      const oTf = tfPrefixed('o');
      const guestData = await dbGet(`
        SELECT COALESCE(SUM(max_g), 0) as total_guests
        FROM (
          SELECT MAX(oi.guest_number) as max_g
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          WHERE ${oTf.where} AND UPPER(o.status) IN ('PAID', 'PICKED_UP', 'CLOSED', 'COMPLETED')
          GROUP BY oi.order_id
        )
      `, oTf.params);
      guestCount = guestData?.total_guests || 0;
    } catch (e) { /* guest_number column may not exist */ }

    // Gratuity
    let gratuityTotal = 0;
    try {
      const gratuityData = await dbGet(`
        SELECT COALESCE(SUM(service_charge), 0) as gratuity_total
        FROM orders
        WHERE ${tf.where} AND UPPER(status) IN ('PAID', 'PICKED_UP', 'CLOSED', 'COMPLETED')
      `, tf.params);
      gratuityTotal = gratuityData?.gratuity_total || 0;
    } catch (e) { /* service_charge column may not exist */ }

    // Payment breakdown (legacy fixed columns: payments.tip)
    const paymentDataLegacy = await dbGet(`
      SELECT 
        COALESCE(SUM(CASE WHEN UPPER(payment_method) = 'CASH' THEN (amount - COALESCE(tip, 0)) ELSE 0 END), 0) as cash_sales,
        COALESCE(SUM(CASE WHEN UPPER(payment_method) = 'CASH' THEN COALESCE(tip, 0) ELSE 0 END), 0) as cash_tips,
        COALESCE(SUM(CASE WHEN UPPER(payment_method) = 'VISA' THEN (amount - COALESCE(tip, 0)) ELSE 0 END), 0) as visa_sales,
        COALESCE(SUM(CASE WHEN UPPER(payment_method) = 'VISA' THEN COALESCE(tip, 0) ELSE 0 END), 0) as visa_tips,
        COALESCE(SUM(CASE WHEN UPPER(payment_method) IN ('MC', 'MASTERCARD') THEN (amount - COALESCE(tip, 0)) ELSE 0 END), 0) as mastercard_sales,
        COALESCE(SUM(CASE WHEN UPPER(payment_method) IN ('MC', 'MASTERCARD') THEN COALESCE(tip, 0) ELSE 0 END), 0) as mastercard_tips,
        COALESCE(SUM(CASE WHEN UPPER(payment_method) = 'DEBIT' THEN (amount - COALESCE(tip, 0)) ELSE 0 END), 0) as debit_sales,
        COALESCE(SUM(CASE WHEN UPPER(payment_method) = 'DEBIT' THEN COALESCE(tip, 0) ELSE 0 END), 0) as debit_tips,
        COALESCE(SUM(CASE WHEN UPPER(payment_method) IN ('OTHER_CARD', 'OTHER CARD', 'AMEX', 'DISCOVER', 'CARD', 'CREDIT') THEN (amount - COALESCE(tip, 0)) ELSE 0 END), 0) as other_card_sales,
        COALESCE(SUM(CASE WHEN UPPER(payment_method) IN ('OTHER_CARD', 'OTHER CARD', 'AMEX', 'DISCOVER', 'CARD', 'CREDIT') THEN COALESCE(tip, 0) ELSE 0 END), 0) as other_card_tips,
        COALESCE(SUM(CASE WHEN UPPER(payment_method) NOT IN ('CASH', 'VISA', 'MC', 'MASTERCARD', 'DEBIT', 'OTHER_CARD', 'OTHER CARD', 'AMEX', 'DISCOVER', 'CARD', 'CREDIT', 'NO_SHOW_FORFEITED') THEN (amount - COALESCE(tip, 0)) ELSE 0 END), 0) as other_sales,
        COALESCE(SUM(CASE WHEN UPPER(payment_method) != 'NO_SHOW_FORFEITED' THEN COALESCE(tip, 0) ELSE 0 END), 0) as tip_total,
        COALESCE(SUM(CASE WHEN UPPER(payment_method) != 'CASH' AND UPPER(payment_method) NOT IN ('GIFT', 'COUPON', 'OTHER', 'NO_SHOW_FORFEITED') THEN (amount - COALESCE(tip, 0)) ELSE 0 END), 0) as card_sales,
        COALESCE(SUM(CASE WHEN UPPER(payment_method) != 'CASH' AND UPPER(payment_method) NOT IN ('GIFT', 'COUPON', 'OTHER', 'NO_SHOW_FORFEITED') THEN COALESCE(tip, 0) ELSE 0 END), 0) as card_tips
      FROM payments 
      WHERE ${tf.where} AND status = 'APPROVED'
    `, tf.params);

    const tipsData = await dbGet(`
      SELECT 
        COALESCE(SUM(amount), 0) as tip_total,
        COALESCE(SUM(CASE WHEN UPPER(payment_method) = 'CASH' THEN amount ELSE 0 END), 0) as cash_tips,
        COALESCE(SUM(CASE WHEN UPPER(payment_method) = 'VISA' THEN amount ELSE 0 END), 0) as visa_tips,
        COALESCE(SUM(CASE WHEN UPPER(payment_method) IN ('MC', 'MASTERCARD') THEN amount ELSE 0 END), 0) as mastercard_tips,
        COALESCE(SUM(CASE WHEN UPPER(payment_method) = 'DEBIT' THEN amount ELSE 0 END), 0) as debit_tips,
        COALESCE(SUM(CASE WHEN UPPER(payment_method) IN ('OTHER_CARD', 'OTHER CARD', 'AMEX', 'DISCOVER', 'CARD', 'CREDIT') THEN amount ELSE 0 END), 0) as other_card_tips,
        COALESCE(SUM(CASE WHEN UPPER(payment_method) != 'CASH' AND UPPER(payment_method) NOT IN ('GIFT', 'COUPON', 'OTHER', 'NO_SHOW_FORFEITED') THEN amount ELSE 0 END), 0) as card_tips
      FROM tips
      WHERE ${tf.where}
    `, tf.params);

    const paymentData = {
      ...(paymentDataLegacy || {}),
      tip_total: (paymentDataLegacy?.tip_total || 0) + (tipsData?.tip_total || 0),
      cash_tips: (paymentDataLegacy?.cash_tips || 0) + (tipsData?.cash_tips || 0),
      visa_tips: (paymentDataLegacy?.visa_tips || 0) + (tipsData?.visa_tips || 0),
      mastercard_tips: (paymentDataLegacy?.mastercard_tips || 0) + (tipsData?.mastercard_tips || 0),
      debit_tips: (paymentDataLegacy?.debit_tips || 0) + (tipsData?.debit_tips || 0),
      other_card_tips: (paymentDataLegacy?.other_card_tips || 0) + (tipsData?.other_card_tips || 0),
      card_tips: (paymentDataLegacy?.card_tips || 0) + (tipsData?.card_tips || 0),
    };

    // Dynamic payment methods
    const paymentMethodsLegacy = await dbAll(`
      SELECT 
        payment_method,
        COUNT(DISTINCT order_id) as count,
        COALESCE(SUM(amount - COALESCE(tip, 0)), 0) as net_amount,
        COALESCE(SUM(amount), 0) as gross_amount,
        COALESCE(SUM(COALESCE(tip, 0)), 0) as tip_amount,
        COUNT(DISTINCT CASE WHEN COALESCE(tip, 0) > 0 THEN order_id END) as tip_order_count
      FROM payments 
      WHERE ${tf.where} AND status = 'APPROVED' AND UPPER(payment_method) != 'NO_SHOW_FORFEITED'
      GROUP BY payment_method
      ORDER BY gross_amount DESC
    `, tf.params);

    const tipMethods = await dbAll(`
      SELECT 
        payment_method,
        COUNT(DISTINCT order_id) as count,
        COALESCE(SUM(amount), 0) as tip_amount,
        COUNT(DISTINCT CASE WHEN COALESCE(amount, 0) > 0 THEN order_id END) as tip_order_count
      FROM tips
      WHERE ${tf.where}
      GROUP BY payment_method
      ORDER BY tip_amount DESC
    `, tf.params);

    const pmByMethod = new Map();
    (paymentMethodsLegacy || []).forEach((pm) => {
      const key = String(pm.payment_method || '').toUpperCase();
      pmByMethod.set(key, { ...pm });
    });
    (tipMethods || []).forEach((tm) => {
      const key = String(tm.payment_method || '').toUpperCase();
      const existing = pmByMethod.get(key);
      if (existing) {
        existing.tip_amount = Number((existing.tip_amount || 0) + (tm.tip_amount || 0));
        existing.tip_order_count = Number((existing.tip_order_count || 0) + (tm.tip_order_count || 0));
      } else {
        pmByMethod.set(key, {
          payment_method: tm.payment_method,
          count: 0,
          net_amount: 0,
          gross_amount: 0,
          tip_amount: tm.tip_amount || 0,
          tip_order_count: tm.tip_order_count || 0,
        });
      }
    });
    const paymentMethods = Array.from(pmByMethod.values());

    // Refund data
    const refundData = await dbGet(`
      SELECT COUNT(*) as refund_count, COALESCE(SUM(total), 0) as refund_total
      FROM refunds WHERE ${tf.where}
    `, tf.params);

    // Cash refunds
    let cashRefundTotal = 0;
    try {
      const cashRefundData = await dbGet(`
        SELECT COALESCE(SUM(total), 0) as cash_refund_total
        FROM refunds WHERE ${tf.where} AND UPPER(payment_method) = 'CASH'
      `, tf.params);
      cashRefundTotal = cashRefundData?.cash_refund_total || 0;
    } catch (e) { /* */ }

    // Void data
    const voidData = await dbGet(`
      SELECT COUNT(*) as void_count, COALESCE(SUM(grand_total), 0) as void_total
      FROM voids WHERE ${tf.where}
    `, tf.params);

    // Refund details
    const rTf = tfPrefixed('r');
    const refundDetails = await dbAll(`
      SELECT r.id, r.order_id, r.original_order_number, r.refund_type, r.total, r.payment_method, r.reason, r.created_at,
             o.order_number
      FROM refunds r LEFT JOIN orders o ON r.order_id = o.id
      WHERE ${rTf.where}
      ORDER BY r.created_at ASC
    `, rTf.params);

    // Void details
    const vTf = tfPrefixed('v');
    const voidDetails = await dbAll(`
      SELECT v.id, v.order_id, v.grand_total, v.reason, v.source, v.created_by, v.created_at,
             o.order_number
      FROM voids v LEFT JOIN orders o ON v.order_id = o.id
      WHERE ${vTf.where}
      ORDER BY v.created_at ASC
    `, vTf.params);

    // Discount data (reference standard)
    // - Prefer structured `order_adjustments.amount_applied` (POS-created adjustments)
    // - Fallback to `orders.adjustments_json` ONLY when no order_adjustments exist (online legacy)
    const adjSumRow = await dbGet(`
      SELECT COALESCE(SUM(oa.amount_applied), 0) as discount_total
      FROM order_adjustments oa
      JOIN orders o ON oa.order_id = o.id
      WHERE ${tfPrefixed('o').where}
        AND UPPER(o.status) IN ('PAID', 'PICKED_UP', 'CLOSED', 'COMPLETED')
        AND COALESCE(oa.amount_applied, 0) > 0
        AND UPPER(COALESCE(oa.kind, '')) IN ('DISCOUNT', 'PROMOTION', 'CHANNEL_DISCOUNT', 'COUPON')
    `, tfPrefixed('o').params);

    const jsonAdjSumRow = await dbGet(`
      SELECT COALESCE(SUM(
        CASE
          WHEN o.adjustments_json IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM order_adjustments oa WHERE oa.order_id = o.id)
          THEN (SELECT COALESCE(SUM(json_extract(value, '$.amountApplied')), 0) FROM json_each(o.adjustments_json))
          ELSE 0
        END
      ), 0) as discount_total
      FROM orders o
      WHERE ${tfPrefixed('o').where} AND UPPER(o.status) IN ('PAID', 'PICKED_UP', 'CLOSED', 'COMPLETED')
    `, tfPrefixed('o').params);

    const discountData = { discount_total: Number((Number(adjSumRow?.discount_total || 0) + Number(jsonAdjSumRow?.discount_total || 0)).toFixed(2)) };

    // Discount order count (for aligned ADJUSTMENTS display)
    let discountOrderCount = 0;
    try {
      const adjCnt = await dbGet(`
        SELECT COUNT(DISTINCT oa.order_id) as cnt
        FROM order_adjustments oa
        JOIN orders o ON oa.order_id = o.id
        WHERE ${tfPrefixed('o').where}
          AND UPPER(o.status) IN ('PAID', 'PICKED_UP', 'CLOSED', 'COMPLETED')
          AND COALESCE(oa.amount_applied, 0) > 0
          AND UPPER(COALESCE(oa.kind, '')) IN ('DISCOUNT', 'PROMOTION', 'CHANNEL_DISCOUNT', 'COUPON')
      `, tfPrefixed('o').params);
      const jsonCnt = await dbGet(`
        SELECT COUNT(*) as cnt
        FROM orders o
        WHERE ${tfPrefixed('o').where}
          AND UPPER(o.status) IN ('PAID', 'PICKED_UP', 'CLOSED', 'COMPLETED')
          AND o.adjustments_json IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM order_adjustments oa WHERE oa.order_id = o.id)
          AND EXISTS (
            SELECT 1 FROM json_each(o.adjustments_json)
            WHERE COALESCE(json_extract(value, '$.amountApplied'), 0) > 0
          )
      `, tfPrefixed('o').params);
      discountOrderCount = Number(adjCnt?.cnt || 0) + Number(jsonCnt?.cnt || 0);
    } catch (e) {
      discountOrderCount = 0;
    }

    // Payment order counts (Cash/Card/Other) for PAYMENT BREAKDOWN aligned counts
    let cashOrderCount = 0;
    let cardOrderCount = 0;
    let otherOrderCount = 0;
    try {
      const pmCnt = await dbGet(
        `
        SELECT
          COUNT(DISTINCT CASE WHEN UPPER(payment_method) = 'CASH' THEN order_id END) as cash_order_count,
          COUNT(DISTINCT CASE WHEN UPPER(payment_method) IN ('VISA','MC','MASTERCARD','DEBIT','OTHER_CARD','OTHER CARD','AMEX','DISCOVER','CARD','CREDIT') THEN order_id END) as card_order_count,
          COUNT(DISTINCT CASE
            WHEN UPPER(payment_method) NOT IN ('CASH','VISA','MC','MASTERCARD','DEBIT','OTHER_CARD','OTHER CARD','AMEX','DISCOVER','CARD','CREDIT','NO_SHOW_FORFEITED')
            THEN order_id
          END) as other_order_count
        FROM payments
        WHERE ${tf.where} AND status = 'APPROVED'
        `,
        tf.params
      );
      cashOrderCount = Number(pmCnt?.cash_order_count || 0);
      cardOrderCount = Number(pmCnt?.card_order_count || 0);
      otherOrderCount = Number(pmCnt?.other_order_count || 0);
    } catch (e) {
      cashOrderCount = 0;
      cardOrderCount = 0;
      otherOrderCount = 0;
    }

    // Tip order counts (Cash vs Card/Non-cash)
    let cashTipOrderCount = 0;
    let cardTipOrderCount = 0;
    let totalTipOrderCount = 0;
    try {
      const cashTipsCnt = await dbGet(
        `
        SELECT COUNT(DISTINCT order_id) as cnt
        FROM (
          SELECT order_id FROM payments WHERE ${tf.where} AND status = 'APPROVED' AND UPPER(payment_method) = 'CASH' AND COALESCE(tip, 0) > 0
          UNION
          SELECT order_id FROM tips WHERE ${tf.where} AND UPPER(payment_method) = 'CASH' AND COALESCE(amount, 0) > 0
        )
        `,
        tf.params
      );
      const cardTipsCnt = await dbGet(
        `
        SELECT COUNT(DISTINCT order_id) as cnt
        FROM (
          SELECT order_id FROM payments WHERE ${tf.where} AND status = 'APPROVED' AND UPPER(payment_method) != 'CASH' AND UPPER(payment_method) != 'NO_SHOW_FORFEITED' AND COALESCE(tip, 0) > 0
          UNION
          SELECT order_id FROM tips WHERE ${tf.where} AND UPPER(payment_method) != 'CASH' AND COALESCE(amount, 0) > 0
        )
        `,
        tf.params
      );
      const totalTipsCnt = await dbGet(
        `
        SELECT COUNT(DISTINCT order_id) as cnt
        FROM (
          SELECT order_id FROM payments WHERE ${tf.where} AND status = 'APPROVED' AND UPPER(payment_method) != 'NO_SHOW_FORFEITED' AND COALESCE(tip, 0) > 0
          UNION
          SELECT order_id FROM tips WHERE ${tf.where} AND COALESCE(amount, 0) > 0
        )
        `,
        tf.params
      );
      cashTipOrderCount = Number(cashTipsCnt?.cnt || 0);
      cardTipOrderCount = Number(cardTipsCnt?.cnt || 0);
      totalTipOrderCount = Number(totalTipsCnt?.cnt || 0);
    } catch (e) {
      cashTipOrderCount = 0;
      cardTipOrderCount = 0;
      totalTipOrderCount = 0;
    }

    // Gift Card data
    let giftCardSold = 0, giftCardSoldCount = 0, giftCardPayment = 0, giftCardPaymentCount = 0;
    try {
      const gcSold = await dbGet(`
        SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as total
        FROM gift_card_transactions WHERE ${tf.where} AND transaction_type IN ('sale', 'reload')
      `, tf.params);
      giftCardSold = gcSold?.total || 0;
      giftCardSoldCount = gcSold?.cnt || 0;
      const gcPayment = await dbGet(`
        SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as total
        FROM gift_card_transactions WHERE ${tf.where} AND transaction_type = 'redeem'
      `, tf.params);
      giftCardPayment = gcPayment?.total || 0;
      giftCardPaymentCount = gcPayment?.cnt || 0;
    } catch (e) { /* gift_card_transactions table may not exist */ }

    // Reservation Fee data
    let reservationFeeReceived = 0, reservationFeeReceivedCount = 0;
    let reservationFeeApplied = 0, reservationFeeAppliedCount = 0;
    try {
      const resFeeReceived = await dbGet(`
        SELECT COUNT(*) as cnt, COALESCE(SUM(deposit_amount), 0) as total
        FROM reservations WHERE ${tf.where} AND deposit_amount > 0 AND deposit_status IN ('paid', 'applied', 'forfeited')
      `, tf.params);
      reservationFeeReceived = resFeeReceived?.total || 0;
      reservationFeeReceivedCount = resFeeReceived?.cnt || 0;
      const resFeeApplied = await dbGet(`
        SELECT COUNT(*) as cnt, COALESCE(SUM(deposit_amount), 0) as total
        FROM reservations WHERE deposit_status = 'applied' AND updated_at >= ? AND updated_at <= ?
      `, tf.params);
      reservationFeeApplied = resFeeApplied?.total || 0;
      reservationFeeAppliedCount = resFeeApplied?.cnt || 0;
    } catch (e) { /* */ }

    // No Show Forfeited
    let noShowForfeited = 0, noShowForfeitedCount = 0;
    try {
      const nsData = await dbGet(`
        SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as total
        FROM payments WHERE ${tf.where} AND payment_method = 'NO_SHOW_FORFEITED' AND status = 'APPROVED'
      `, tf.params);
      noShowForfeited = nsData?.total || 0;
      noShowForfeitedCount = nsData?.cnt || 0;
    } catch (e) { /* */ }

    return {
      salesData, guestCount, gratuityTotal, paymentData, paymentMethods,
      refundData, cashRefundTotal, voidData, refundDetails, voidDetails,
      discountData, giftCardSold, giftCardSoldCount, giftCardPayment, giftCardPaymentCount,
      reservationFeeReceived, reservationFeeReceivedCount, reservationFeeApplied, reservationFeeAppliedCount,
      noShowForfeited, noShowForfeitedCount,
      gstTotal, pstTotal,
      // Counts for aligned receipt columns
      discountOrderCount,
      cashOrderCount,
      cardOrderCount,
      otherOrderCount,
      cashTipOrderCount,
      cardTipOrderCount,
      totalTipOrderCount,
      // Correct cash drawer values (change excluded)
      actualCashSales,   // = order totals - non-cash payments
      actualCashTips,    // = cash tips in drawer
      nonCashNet         // = total non-cash payment net
    };
  };

  // ============ GET Z-REPORT DATA ============
  router.get('/z-report', async (req, res) => {
    try {
      const { session_id } = req.query;

      // Find the session
      let session;
      if (session_id) {
        session = await dbGet('SELECT * FROM daily_closings WHERE session_id = ?', [session_id]);
      } else {
        session = await getActiveSession();
        if (!session) {
          // Fallback: most recent session
          session = await dbGet('SELECT * FROM daily_closings ORDER BY id DESC LIMIT 1');
        }
      }

      if (!session) {
        return res.json({ success: true, data: null, message: 'No session found' });
      }

      // Store Info & Service Mode
      let storeName = 'Restaurant';
      let serviceMode = 'FSR';
      try {
        const bp = await dbGet(`SELECT business_name, service_type FROM business_profile WHERE id = 1`);
        if (bp) { storeName = bp.business_name || 'Restaurant'; serviceMode = bp.service_type || 'FSR'; }
      } catch (e) { /* */ }

      const startTime = session.opened_at;
      const endTime = session.closed_at || getLocalDatetimeString();
      const q = await querySalesData(startTime, endTime);

      const openingCash = session.opening_cash || 0;
      // CORRECT: actual cash = order totals - non-cash payments (change excluded)
      const actualCash = q.actualCashSales || 0;
      const actualCashTips = q.actualCashTips || 0;
      const expectedCash = openingCash + actualCash + actualCashTips - q.cashRefundTotal;

      res.json({
        success: true,
        data: {
          session_id: session.session_id,
          date: session.date,
          store_name: storeName,
          service_mode: serviceMode,
          opening_cash: openingCash,
          expected_cash: expectedCash,
          // Sales
          total_sales: q.salesData?.total_sales || 0,
          subtotal: q.salesData?.subtotal || 0,
          order_count: q.salesData?.order_count || 0,
          tax_total: q.salesData?.tax_total || 0,
          gst_total: q.gstTotal ?? 0,
          pst_total: q.pstTotal ?? 0,
          gratuity_total: q.gratuityTotal,
          guest_count: q.guestCount,
          first_order_time: q.salesData?.first_order_time || null,
          last_order_time: q.salesData?.last_order_time || null,
          // By type
          dine_in_sales: q.salesData?.dine_in_sales || 0,
          togo_sales: q.salesData?.togo_sales || 0,
          online_sales: q.salesData?.online_sales || 0,
          delivery_sales: q.salesData?.delivery_sales || 0,
          dine_in_order_count: q.salesData?.dine_in_order_count || 0,
          togo_order_count: q.salesData?.togo_order_count || 0,
          online_order_count: q.salesData?.online_order_count || 0,
          delivery_order_count: q.salesData?.delivery_order_count || 0,
          // By payment (corrected - actual cash, not tendered)
          cash_sales: q.actualCashSales || 0,
          cash_tendered: q.paymentData?.cash_sales || 0,
          card_sales: q.paymentData?.card_sales || 0,
          other_sales: q.paymentData?.other_sales || 0,
          cash_order_count: q.cashOrderCount || 0,
          card_order_count: q.cardOrderCount || 0,
          other_order_count: q.otherOrderCount || 0,
          // By card type
          visa_sales: q.paymentData?.visa_sales || 0,
          mastercard_sales: q.paymentData?.mastercard_sales || 0,
          debit_sales: q.paymentData?.debit_sales || 0,
          other_card_sales: q.paymentData?.other_card_sales || 0,
          // Tips
          tip_total: q.paymentData?.tip_total || 0,
          cash_tips: q.paymentData?.cash_tips || 0,
          card_tips: q.paymentData?.card_tips || 0,
          cash_tip_order_count: q.cashTipOrderCount || 0,
          card_tip_order_count: q.cardTipOrderCount || 0,
          total_tip_order_count: q.totalTipOrderCount || 0,
          visa_tips: q.paymentData?.visa_tips || 0,
          mastercard_tips: q.paymentData?.mastercard_tips || 0,
          debit_tips: q.paymentData?.debit_tips || 0,
          other_card_tips: q.paymentData?.other_card_tips || 0,
          // Dynamic payment methods
          payment_methods: (q.paymentMethods || []).map(pm => ({
            method: pm.payment_method, count: pm.count,
            net: pm.net_amount, gross: pm.gross_amount, tip: pm.tip_amount,
            tip_order_count: pm.tip_order_count || 0,
          })),
          // Refunds & Voids
          refund_total: q.refundData?.refund_total || 0,
          refund_count: q.refundData?.refund_count || 0,
          cash_refund_total: q.cashRefundTotal,
          void_total: q.voidData?.void_total || 0,
          void_count: q.voidData?.void_count || 0,
          // Discounts
          discount_total: q.discountData?.discount_total || 0,
          discount_order_count: q.discountOrderCount || 0,
          // Gift Card
          gift_card_sold: q.giftCardSold,
          gift_card_sold_count: q.giftCardSoldCount,
          gift_card_payment: q.giftCardPayment,
          gift_card_payment_count: q.giftCardPaymentCount,
          // Reservation Fee
          reservation_fee_received: q.reservationFeeReceived,
          reservation_fee_received_count: q.reservationFeeReceivedCount,
          reservation_fee_applied: q.reservationFeeApplied,
          reservation_fee_applied_count: q.reservationFeeAppliedCount,
          // No Show
          no_show_forfeited: q.noShowForfeited,
          no_show_forfeited_count: q.noShowForfeitedCount,
          // Details
          refund_details: (q.refundDetails || []).map(r => ({
            id: r.id, order_id: r.order_id,
            order_number: r.original_order_number || r.order_number || `#${r.order_id}`,
            type: r.refund_type || 'FULL', total: r.total || 0,
            payment_method: r.payment_method || '', reason: r.reason || '', created_at: r.created_at
          })),
          void_details: (q.voidDetails || []).map(v => ({
            id: v.id, order_id: v.order_id,
            order_number: v.order_number || `#${v.order_id}`,
            total: v.grand_total || 0, source: v.source || 'partial',
            reason: v.reason || '', created_by: v.created_by || '', created_at: v.created_at
          })),
          // Status
          status: session.status,
          opened_at: session.opened_at,
          closed_at: session.closed_at
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
      // Tables with active orders
      const tablesWithOrders = await dbAll(`
        SELECT t.element_id, t.name, t.floor, t.current_order_id, o.status AS order_status
        FROM table_map_elements t
        LEFT JOIN orders o ON t.current_order_id = o.id
        WHERE t.current_order_id IS NOT NULL
      `);

      // Auto-cleanup stale references
      const staleTableIds = [];
      const validTablesWithOrders = [];
      for (const t of tablesWithOrders) {
        const orderStatus = t.order_status ? t.order_status.toUpperCase() : null;
        if (!orderStatus || ['PAID', 'PICKED_UP', 'CLOSED', 'COMPLETED', 'CANCELLED', 'VOIDED', 'MERGED'].includes(orderStatus)) {
          staleTableIds.push(t.element_id);
        } else {
          validTablesWithOrders.push(t);
        }
      }
      if (staleTableIds.length > 0) {
        const placeholders = staleTableIds.map(() => '?').join(',');
        await dbRun(`UPDATE table_map_elements SET current_order_id = NULL WHERE element_id IN (${placeholders})`, staleTableIds);
        console.log(`[check-unpaid-orders] Cleaned ${staleTableIds.length} stale table references`);
      }

      // Unpaid orders in current session time range
      const activeSession = await getActiveSession();
      let unpaidOrders = [];
      if (activeSession) {
        unpaidOrders = await dbAll(`
          SELECT 
            o.id, o.order_number, o.table_id,
            t.name AS table_name,
            o.subtotal, o.tax, o.total, o.status, o.created_at,
            o.order_type, o.fulfillment_mode, o.customer_name
          FROM orders o
          LEFT JOIN table_map_elements t ON o.table_id = t.element_id
          WHERE o.created_at >= ?
          AND UPPER(o.status) NOT IN ('PAID', 'PICKED_UP', 'CLOSED', 'COMPLETED', 'CANCELLED', 'VOIDED', 'MERGED', 'REFUNDED')
          AND NOT (o.firebase_order_id IS NOT NULL AND (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) = 0)
        `, [activeSession.opened_at]);
      }

      // Also include any orders still linked to a table (even if created before session open)
      try {
        const existingIds = new Set((unpaidOrders || []).map(o => Number(o.id)).filter(Boolean));
        const tableOrderIds = (validTablesWithOrders || [])
          .map(t => Number(t.current_order_id))
          .filter(id => id && !existingIds.has(id));
        if (tableOrderIds.length > 0) {
          const placeholders = tableOrderIds.map(() => '?').join(',');
          const extra = await dbAll(
            `
            SELECT 
              o.id, o.order_number, o.table_id,
              t.name AS table_name,
              o.subtotal, o.tax, o.total, o.status, o.created_at,
              o.order_type, o.fulfillment_mode, o.customer_name
            FROM orders o
            LEFT JOIN table_map_elements t ON o.table_id = t.element_id
            WHERE o.id IN (${placeholders})
            AND UPPER(o.status) NOT IN ('PAID', 'PICKED_UP', 'CLOSED', 'COMPLETED', 'CANCELLED', 'VOIDED', 'MERGED', 'REFUNDED')
            AND NOT (o.firebase_order_id IS NOT NULL AND (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) = 0)
          `,
            tableOrderIds
          );
          unpaidOrders = [...(unpaidOrders || []), ...(extra || [])];
        }
      } catch (e) {
        // non-blocking
      }

      const uniqueBlockingOrderIds = new Set();
      (validTablesWithOrders || []).forEach(t => {
        const id = Number(t.current_order_id);
        if (id) uniqueBlockingOrderIds.add(id);
      });
      (unpaidOrders || []).forEach(o => {
        const id = Number(o.id);
        if (id) uniqueBlockingOrderIds.add(id);
      });

      const hasUnpaidOrders = uniqueBlockingOrderIds.size > 0;
      res.json({
        success: true,
        hasUnpaidOrders,
        tablesWithOrders: validTablesWithOrders.map(t => ({
          tableId: t.element_id, tableName: t.name, floor: t.floor, orderId: t.current_order_id
        })),
        unpaidOrders: unpaidOrders.map(o => ({
          orderId: o.id,
          orderNumber: o.order_number,
          tableId: o.table_id,
          tableName: o.table_name,
          total: o.total,
          subtotal: o.subtotal,
          tax: o.tax,
          status: o.status,
          createdAt: o.created_at,
          orderType: o.order_type,
          fulfillmentMode: o.fulfillment_mode,
          customerName: o.customer_name
        })),
        count: uniqueBlockingOrderIds.size,
        cleanedStaleReferences: staleTableIds.length
      });
    } catch (error) {
      console.error('Check unpaid orders error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============ SHIFT CLOSE ============
  router.post('/shift-close', async (req, res) => {
    try {
      const { countedCash = 0, cashDetails = {}, closedBy = '' } = req.body;
      const now = getLocalDatetimeString();

      const activeSession = await getActiveSession();
      if (!activeSession) {
        return res.status(400).json({ success: false, error: 'No active session found' });
      }

      // Determine shift start time (after last shift close, or session open)
      const lastShift = await dbGet(
        'SELECT * FROM shift_closings WHERE session_id = ? ORDER BY shift_number DESC LIMIT 1',
        [activeSession.session_id]
      );
      const shiftStartTime = lastShift ? lastShift.shift_end : activeSession.opened_at;
      const shiftNumber = lastShift ? lastShift.shift_number + 1 : 1;

      // Query sales for this shift period
      const startTime = shiftStartTime;
      const endTime = now;
      const tf = { where: 'created_at >= ? AND created_at <= ?', params: [startTime, endTime] };

      const salesDataOrders = await dbGet(`
        SELECT COUNT(*) as order_count FROM orders WHERE ${tf.where} AND UPPER(status) IN ('PAID', 'PICKED_UP', 'CLOSED', 'COMPLETED')
      `, tf.params);
      const salesDataPt = await dbGet(`
        SELECT COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as total_sales
        FROM payments p JOIN orders o ON p.order_id = o.id
        WHERE o.created_at >= ? AND o.created_at <= ? AND UPPER(o.status) IN ('PAID','PICKED_UP','CLOSED','COMPLETED')
          AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
          AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
      `, tf.params);
      const salesData = { order_count: salesDataOrders?.order_count || 0, total_sales: Number(salesDataPt?.total_sales || 0) };

      const paymentData = await dbGet(`
        SELECT 
          COALESCE(SUM(CASE WHEN UPPER(payment_method) != 'CASH' AND UPPER(payment_method) != 'NO_SHOW_FORFEITED' THEN (amount - COALESCE(tip, 0)) ELSE 0 END), 0) as card_sales,
          COALESCE(SUM(CASE WHEN UPPER(payment_method) NOT IN ('CASH', 'VISA', 'MC', 'MASTERCARD', 'DEBIT', 'OTHER_CARD', 'OTHER CARD', 'AMEX', 'DISCOVER', 'CARD', 'CREDIT', 'NO_SHOW_FORFEITED') THEN (amount - COALESCE(tip, 0)) ELSE 0 END), 0) as other_sales,
          COALESCE(SUM(CASE WHEN UPPER(payment_method) != 'NO_SHOW_FORFEITED' THEN COALESCE(tip, 0) ELSE 0 END), 0) as tip_total,
          COALESCE(SUM(CASE WHEN UPPER(payment_method) = 'CASH' THEN COALESCE(tip, 0) ELSE 0 END), 0) as cash_tips
        FROM payments WHERE ${tf.where} AND status = 'APPROVED'
      `, tf.params);

      // CORRECT: Actual cash = Order totals - Non-cash payments (change excluded automatically)
      const totalOrderSales = salesData?.total_sales || 0;
      const nonCashNet = paymentData?.card_sales || 0;
      const actualCashSales = Math.max(0, totalOrderSales - nonCashNet);
      const cashTips = paymentData?.cash_tips || 0;

      // Opening cash for this shift
      // If previous shift's counted_cash is 0 (user skipped counting), fallback to expected_cash
      const shiftOpeningCash = lastShift
        ? (lastShift.counted_cash > 0 ? lastShift.counted_cash : (lastShift.expected_cash || lastShift.counted_cash))
        : (activeSession.opening_cash || 0);
      let cashRefundTotal = 0;
      try {
        const crd = await dbGet(`SELECT COALESCE(SUM(total), 0) as t FROM refunds WHERE ${tf.where} AND UPPER(payment_method) = 'CASH'`, tf.params);
        cashRefundTotal = crd?.t || 0;
      } catch (e) { /* */ }
      // Expected = Opening + Actual Cash Sales + Cash Tips - Cash Refunds
      const expectedCash = shiftOpeningCash + actualCashSales + cashTips - cashRefundTotal;
      const cashDifference = countedCash - expectedCash;

      // Save shift record
      await dbRun(`
        INSERT INTO shift_closings (session_id, shift_number, shift_start, shift_end, closed_by,
          total_sales, order_count, cash_sales, card_sales, other_sales, tip_total,
          opening_cash, expected_cash, counted_cash, cash_difference, cash_details)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        activeSession.session_id, shiftNumber, startTime, endTime, closedBy,
        salesData?.total_sales || 0, salesData?.order_count || 0,
        actualCashSales, paymentData?.card_sales || 0, paymentData?.other_sales || 0,
        paymentData?.tip_total || 0,
        shiftOpeningCash, expectedCash, countedCash, cashDifference,
        JSON.stringify(cashDetails)
      ]);

      const shiftRecord = await dbGet(
        'SELECT * FROM shift_closings WHERE session_id = ? AND shift_number = ?',
        [activeSession.session_id, shiftNumber]
      );

      res.json({
        success: true,
        message: `Shift #${shiftNumber} closed successfully`,
        data: {
          ...shiftRecord,
          session_opened_at: activeSession.opened_at
        }
      });
    } catch (error) {
      console.error('Shift close error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============ CLOSING ============
  router.post('/closing', async (req, res) => {
    try {
      const { closingCash = 0, closedBy = '', notes = '', cashBreakdown = {} } = req.body;
      const now = getLocalDatetimeString();

      const activeSession = await getActiveSession();
      if (!activeSession) {
        return res.status(400).json({ success: false, error: 'No active session to close' });
      }

      const startTime = activeSession.opened_at;
      const endTime = now;
      const tf = { where: 'created_at >= ? AND created_at <= ?', params: [startTime, endTime] };

      // Fetch closing data - payments 기반 실결제 매출
      const salesDataOrders2 = await dbGet(`
        SELECT COUNT(*) as order_count, COALESCE(SUM(tax), 0) as tax_total
        FROM orders WHERE ${tf.where} AND UPPER(status) IN ('PAID', 'PICKED_UP', 'CLOSED', 'COMPLETED')
      `, tf.params);
      const salesDataPt2 = await dbGet(`
        SELECT COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as total_sales
        FROM payments p JOIN orders o ON p.order_id = o.id
        WHERE o.created_at >= ? AND o.created_at <= ? AND UPPER(o.status) IN ('PAID','PICKED_UP','CLOSED','COMPLETED')
          AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
          AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
      `, tf.params);
      const salesData = {
        order_count: salesDataOrders2?.order_count || 0,
        total_sales: Number(salesDataPt2?.total_sales || 0),
        tax_total: Number(salesDataOrders2?.tax_total || 0)
      };

      const paymentData = await dbGet(`
        SELECT 
          COALESCE(SUM(CASE WHEN UPPER(payment_method) NOT IN ('CASH', 'NO_SHOW_FORFEITED') THEN (amount - COALESCE(tip, 0)) ELSE 0 END), 0) as card_sales,
          COALESCE(SUM(CASE WHEN UPPER(payment_method) NOT IN ('CASH', 'VISA', 'MC', 'DEBIT', 'OTHER_CARD', 'CREDIT', 'CARD', 'NO_SHOW_FORFEITED') THEN (amount - COALESCE(tip, 0)) ELSE 0 END), 0) as other_sales,
          COALESCE(SUM(COALESCE(tip, 0)), 0) as tip_total,
          COALESCE(SUM(CASE WHEN UPPER(payment_method) = 'CASH' THEN COALESCE(tip, 0) ELSE 0 END), 0) as cash_tips
        FROM payments WHERE ${tf.where} AND status = 'APPROVED'
      `, tf.params);

      const refundData = await dbGet(`SELECT COUNT(*) as refund_count, COALESCE(SUM(total), 0) as refund_total FROM refunds WHERE ${tf.where}`, tf.params);
      const voidData = await dbGet(`SELECT COUNT(*) as void_count, COALESCE(SUM(grand_total), 0) as void_total FROM voids WHERE ${tf.where}`, tf.params);
      let cashRefundTotal = 0;
      try {
        const crd = await dbGet(`SELECT COALESCE(SUM(total), 0) as t FROM refunds WHERE ${tf.where} AND UPPER(payment_method) = 'CASH'`, tf.params);
        cashRefundTotal = crd?.t || 0;
      } catch (e) { /* */ }

      // CORRECT: actual cash = order totals - non-cash payments (change excluded)
      const totalOrderSales = salesData?.total_sales || 0;
      const nonCashNet = paymentData?.card_sales || 0;
      const actualCashSales = Math.max(0, totalOrderSales - nonCashNet);
      const cashTips = paymentData?.cash_tips || 0;

      const openingCash = activeSession.opening_cash || 0;
      const expectedCash = openingCash + actualCashSales + cashTips - cashRefundTotal;
      const cashDifference = closingCash - expectedCash;

      await dbRun(`
        UPDATE daily_closings SET 
          status = 'closed', closing_cash = ?, expected_cash = ?, cash_difference = ?,
          total_sales = ?, cash_sales = ?, card_sales = ?, other_sales = ?,
          tax_total = ?, order_count = ?, refund_total = ?, refund_count = ?,
          void_total = ?, void_count = ?, tip_total = ?,
          closed_at = ?, closed_by = ?, notes = ?,
          closing_cash_details = ?, updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ?
      `, [
        closingCash, expectedCash, cashDifference,
        salesData?.total_sales || 0, actualCashSales,
        paymentData?.card_sales || 0, paymentData?.other_sales || 0,
        salesData?.tax_total || 0, salesData?.order_count || 0,
        refundData?.refund_total || 0, refundData?.refund_count || 0,
        voidData?.void_total || 0, voidData?.void_count || 0,
        paymentData?.tip_total || 0, now, closedBy, notes,
        JSON.stringify(cashBreakdown), activeSession.session_id
      ]);

      const record = await dbGet('SELECT * FROM daily_closings WHERE session_id = ?', [activeSession.session_id]);

      // 주문번호 카운터 리셋
      try {
        await dbRun(`INSERT OR REPLACE INTO admin_settings(key, value) VALUES('daily_order_counter', '0')`);
      } catch (e) { /* */ }

      // 테이블-주문 연결 해제: 마감 후 테이블 클릭 시 이전 주문(#695 등) 로드 방지 → 새 주문이 #001부터 시작
      try {
        await dbRun(`UPDATE table_map_elements SET current_order_id = NULL, status = 'Available' WHERE current_order_id IS NOT NULL`);
        console.log('✅ Table current_order_id cleared for fresh start after Day Closing');
      } catch (e) { console.warn('Failed to clear table links on closing:', e?.message || e); }

      // Firebase 동기화
      try {
        const restaurantId = await getRestaurantId();
        if (restaurantId) {
          await firebaseService.saveDailyClosing(restaurantId, {
            ...record, closingCash, expectedCash, cashDifference,
            totalSales: salesData?.total_sales || 0, closedAt: now, closedBy, notes
          });
        }
      } catch (firebaseError) {
        console.error('Firebase sync error (non-blocking):', firebaseError.message);
      }

      res.json({ success: true, message: 'Session closed successfully', data: record });
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
        'SELECT * FROM daily_closings ORDER BY id DESC LIMIT ?',
        [parseInt(limit)]
      );
      res.json({ success: true, data: records });
    } catch (error) {
      console.error('Get history error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============ PRINT OPENING REPORT ============
  router.post('/print-opening', async (req, res) => {
    try {
      const { openingCash = 0, cashBreakdown = {} } = req.body;
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

      const ESC = '\x1B'; const GS = '\x1D';
      const BOLD_ON = ESC + 'E\x01'; const BOLD_OFF = ESC + 'E\x00';
      const DOUBLE_SIZE_ON = GS + '!\x11'; const NORMAL_SIZE = GS + '!\x00';
      const ALIGN_CENTER = ESC + 'a\x01'; const ALIGN_LEFT = ESC + 'a\x00';

      const LINE_WIDTH = 42; const LINE_WIDTH_DOUBLE = 21;
      const center = (text, width = LINE_WIDTH) => { const pad = Math.max(0, Math.floor((width - text.length) / 2)); return ' '.repeat(pad) + text; };
      const leftRight = (l, r) => { const spaces = Math.max(1, LINE_WIDTH - l.length - r.length); return l + ' '.repeat(spaces) + r; };
      const line = '='.repeat(LINE_WIDTH);
      const dottedLine = '-'.repeat(LINE_WIDTH);

      let p = '\n' + line + '\n';
      p += ALIGN_CENTER + DOUBLE_SIZE_ON + BOLD_ON;
      p += center('*** DAY OPENING ***', LINE_WIDTH_DOUBLE) + '\n';
      p += NORMAL_SIZE + BOLD_OFF + ALIGN_LEFT;
      p += line + '\n';
      p += ALIGN_CENTER + BOLD_ON;
      p += center(now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })) + '\n';
      p += center(`Time: ${timeStr}`) + '\n';
      p += BOLD_OFF + ALIGN_LEFT;
      p += dottedLine + '\n\n';
      p += BOLD_ON + center('STARTING CASH COUNT') + BOLD_OFF + '\n';
      p += dottedLine + '\n';

      const denominations = [
        { key: 'cent1', label: '1 Cent', value: 0.01 }, { key: 'cent5', label: '5 Cents', value: 0.05 },
        { key: 'cent10', label: '10 Cents', value: 0.10 }, { key: 'cent25', label: '25 Cents', value: 0.25 },
        { key: 'dollar1', label: '$1 Bills', value: 1 }, { key: 'dollar2', label: '$2 Bills', value: 2 },
        { key: 'dollar5', label: '$5 Bills', value: 5 }, { key: 'dollar10', label: '$10 Bills', value: 10 },
        { key: 'dollar20', label: '$20 Bills', value: 20 }, { key: 'dollar50', label: '$50 Bills', value: 50 },
        { key: 'dollar100', label: '$100 Bills', value: 100 },
      ];

      denominations.forEach(d => {
        const count = cashBreakdown[d.key] || 0;
        if (count > 0) {
          const subtotal = (count * d.value).toFixed(2);
          const lbl = `${d.label} x ${count}`;
          const spaces = Math.max(1, LINE_WIDTH - lbl.length - `$${subtotal}`.length);
          p += lbl + ' '.repeat(spaces) + BOLD_ON + `$${subtotal}` + BOLD_OFF + '\n';
        }
      });

      p += dottedLine + '\n';
      p += BOLD_ON + leftRight('TOTAL STARTING CASH:', `$${openingCash.toFixed(2)}`) + BOLD_OFF + '\n';
      p += line + '\n\n\n';

      // Opening report: do NOT require cash drawer. Allow fallback printer if Front is not configured.
      const printer = await printEscPosTextToFront(p, { openDrawer: false });
      res.json({ success: true, message: 'Opening report printed', printer });
    } catch (error) {
      console.error('Print opening error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============ PRINT SHIFT REPORT ============
  router.post('/print-shift-report', async (req, res) => {
    try {
      const { shiftData = {} } = req.body;
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

      const ESC = '\x1B'; const GS = '\x1D';
      const BOLD_ON = ESC + 'E\x01'; const BOLD_OFF = ESC + 'E\x00';
      const DOUBLE_SIZE_ON = GS + '!\x11'; const NORMAL_SIZE = GS + '!\x00';
      const ALIGN_CENTER = ESC + 'a\x01'; const ALIGN_LEFT = ESC + 'a\x00';

      const LINE_WIDTH = 42; const LINE_WIDTH_DOUBLE = 21;
      const center = (text, width = LINE_WIDTH) => { const pad = Math.max(0, Math.floor((width - text.length) / 2)); return ' '.repeat(pad) + text; };
      const leftRight = (l, r) => { const spaces = Math.max(1, LINE_WIDTH - l.length - r.length); return l + ' '.repeat(spaces) + r; };
      const leftRightBold = (l, r) => { const spaces = Math.max(1, LINE_WIDTH - l.length - r.length); return l + ' '.repeat(spaces) + BOLD_ON + r + BOLD_OFF; };
      const line = '='.repeat(LINE_WIDTH);
      const dottedLine = '-'.repeat(LINE_WIDTH);
      const formatMoney = (amt) => `$${(amt || 0).toFixed(2)}`;

      const fmtTime = (ts) => { try { return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

      let p = '\n' + line + '\n';
      p += ALIGN_CENTER + DOUBLE_SIZE_ON + BOLD_ON;
      p += center('SHIFT REPORT', LINE_WIDTH_DOUBLE) + '\n';
      p += NORMAL_SIZE + BOLD_OFF + ALIGN_LEFT;
      p += line + '\n';
      p += ALIGN_CENTER + BOLD_ON;
      p += center(now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })) + '\n';
      p += center(`Shift #${shiftData.shift_number || 1}  (${fmtTime(shiftData.shift_start)} ~ ${fmtTime(shiftData.shift_end)})`) + '\n';
      if (shiftData.closed_by) p += center(`Closed by: ${shiftData.closed_by}`) + '\n';
      p += BOLD_OFF + ALIGN_LEFT;
      p += dottedLine + '\n';

      // Sales Summary
      p += '\n' + BOLD_ON + center('SALES SUMMARY') + BOLD_OFF + '\n';
      p += dottedLine + '\n';
      p += leftRightBold('Total Sales:', formatMoney(shiftData.total_sales)) + '\n';
      p += leftRightBold('Order Count:', `${shiftData.order_count || 0}`) + '\n';
      p += dottedLine + '\n';

      // Payments
      p += '\n' + BOLD_ON + center('PAYMENTS') + BOLD_OFF + '\n';
      p += dottedLine + '\n';
      p += leftRightBold('Cash:', formatMoney(shiftData.cash_sales)) + '\n';
      p += leftRightBold('Card:', formatMoney(shiftData.card_sales)) + '\n';
      if ((shiftData.other_sales || 0) > 0) {
        p += leftRightBold('Other:', formatMoney(shiftData.other_sales)) + '\n';
      }
      p += dottedLine + '\n';

      // Tips
      p += '\n' + BOLD_ON + center('TIPS') + BOLD_OFF + '\n';
      p += dottedLine + '\n';
      p += leftRightBold('Total Tips:', formatMoney(shiftData.tip_total)) + '\n';
      p += dottedLine + '\n';

      // Cash Drawer
      p += '\n' + BOLD_ON + center('CASH DRAWER') + BOLD_OFF + '\n';
      p += dottedLine + '\n';
      p += leftRightBold('Opening Cash:', formatMoney(shiftData.opening_cash)) + '\n';
      p += leftRightBold('Cash Sales:', formatMoney(shiftData.cash_sales)) + '\n';
      p += leftRightBold('Expected Cash:', formatMoney(shiftData.expected_cash)) + '\n';
      p += dottedLine + '\n';

      // Cash Count Breakdown
      let cashBreakdown = {};
      try {
        if (shiftData.cash_details) {
          cashBreakdown = typeof shiftData.cash_details === 'string' ? JSON.parse(shiftData.cash_details) : shiftData.cash_details;
        }
      } catch (e) { /* ignore parse error */ }

      const denominations = [
        { key: 'cent1', label: '1 Cent', value: 0.01 },
        { key: 'cent5', label: '5 Cents', value: 0.05 },
        { key: 'cent10', label: '10 Cents', value: 0.10 },
        { key: 'cent25', label: '25 Cents', value: 0.25 },
        { key: 'dollar1', label: '$1 Bills', value: 1 },
        { key: 'dollar2', label: '$2 Bills', value: 2 },
        { key: 'dollar5', label: '$5 Bills', value: 5 },
        { key: 'dollar10', label: '$10 Bills', value: 10 },
        { key: 'dollar20', label: '$20 Bills', value: 20 },
        { key: 'dollar50', label: '$50 Bills', value: 50 },
        { key: 'dollar100', label: '$100 Bills', value: 100 },
      ];
      const hasBreakdown = denominations.some(d => (cashBreakdown[d.key] || 0) > 0);
      if (hasBreakdown) {
        p += BOLD_ON + center('CASH COUNT BREAKDOWN') + BOLD_OFF + '\n';
        denominations.forEach(d => {
          const count = cashBreakdown[d.key] || 0;
          if (count > 0) {
            p += leftRightBold(`${d.label} x ${count}`, formatMoney(count * d.value)) + '\n';
          }
        });
        p += dottedLine + '\n';
      }

      p += leftRightBold('Counted Cash:', formatMoney(shiftData.counted_cash)) + '\n';
      const diff = (shiftData.counted_cash || 0) - (shiftData.expected_cash || 0);
      const diffStr = diff >= 0 ? `+${formatMoney(diff)}` : formatMoney(diff);
      p += BOLD_ON + leftRight('OVER/SHORT:', diffStr) + BOLD_OFF + '\n';
      p += line + '\n\n\n';

      const printer = await printEscPosTextToFront(p, { openDrawer: true });
      res.json({ success: true, message: 'Shift report printed', printer });
    } catch (error) {
      console.error('Print shift report error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============ PRINT Z-REPORT (이미지 그래픽 출력) ============
  router.post('/print-z-report', async (req, res) => {
    try {
      const { zReportData, closingCash = 0, cashBreakdown = {}, copies: rawCopies } = req.body;
      const copies = Math.max(1, Math.min(5, parseInt(rawCopies) || 1));

      const { buildGraphicZReport } = require('../utils/graphicPrinterUtils');
      const singleCopyBuffer = buildGraphicZReport(zReportData, closingCash, cashBreakdown);

      const frontPrinter = await dbGet("SELECT selected_printer FROM printers WHERE name LIKE '%Front%' AND selected_printer IS NOT NULL LIMIT 1");
      let targetPrinter = frontPrinter?.selected_printer;
      if (!targetPrinter) {
        const anyPrinter = await dbGet(
          "SELECT selected_printer FROM printers WHERE is_active = 1 AND selected_printer IS NOT NULL ORDER BY printer_id ASC LIMIT 1"
        );
        targetPrinter = anyPrinter?.selected_printer;
      }
      if (!targetPrinter) {
        return res.status(400).json({ success: false, error: 'No printer configured. Please set up the Front printer in Back Office → Printers.' });
      }

      const { sendRawToPrinter } = require('../utils/printerUtils');
      const fullBuffer = copies > 1 ? Buffer.concat(Array(copies).fill(singleCopyBuffer)) : singleCopyBuffer;
      await sendRawToPrinter(targetPrinter, fullBuffer);

      res.json({ success: true, message: `Z-Report printed (${copies} copies)`, printer: targetPrinter, copies });
    } catch (error) {
      console.error('Print Z-Report error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============ OPEN CASH DRAWER ============
  router.post('/open-drawer', async (req, res) => {
    try {
      const http = require('http');
      const drawerData = JSON.stringify({ action: 'open-drawer' });
      const drawerReq = http.request({
        hostname: 'localhost', port: 3177, path: '/api/printers/open-drawer',
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(drawerData) }
      }, () => { console.log('Cash drawer opened'); });
      drawerReq.on('error', (err) => { console.error('Drawer open error:', err.message); });
      drawerReq.write(drawerData);
      drawerReq.end();
      res.json({ success: true, message: 'Cash drawer opened' });
    } catch (error) {
      console.error('Open drawer error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================================
  // Sales Report API - 기간별 매출 요약 (Closing 모달 Sales Report 탭용)
  // ============================================================
  router.get('/sales-report', async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        return res.status(400).json({ success: false, error: 'startDate and endDate are required (YYYY-MM-DD)' });
      }
      const paidStatuses = "UPPER(o.status) IN ('PAID','PICKED_UP','CLOSED','COMPLETED')";
      const paidStatusesNoAlias = "UPPER(status) IN ('PAID','PICKED_UP','CLOSED','COMPLETED')";
      const dateFilterO = "date(o.created_at,'localtime') >= ? AND date(o.created_at,'localtime') <= ?";
      const dateFilter = "date(created_at,'localtime') >= ? AND date(created_at,'localtime') <= ?";

      // 1) Overall summary - orders 테이블 기반 (Subtotal + Tax = Total 일치)
      const overallOrders = await dbGet(`
        SELECT
          COUNT(*) as order_count,
          COALESCE(SUM(subtotal), 0) as subtotal,
          COALESCE(SUM(tax), 0) as tax_total,
          COALESCE(SUM(total), 0) as total,
          COALESCE(SUM(COALESCE(service_charge, 0)), 0) as service_charge_total
        FROM orders
        WHERE ${dateFilter} AND ${paidStatusesNoAlias}
      `, [startDate, endDate]);

      // 1a) Tip 합산 (payments 테이블)
      const tipData = await dbGet(`
        SELECT COALESCE(SUM(COALESCE(p.tip, 0)), 0) as total_tip
        FROM payments p
        JOIN orders o ON p.order_id = o.id
        WHERE date(o.created_at,'localtime') >= ? AND date(o.created_at,'localtime') <= ?
          AND ${paidStatuses}
          AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
      `, [startDate, endDate]);

      // 1b) 개별 세금 항목 (GST, PST 등 동적 조회)
      let taxDetails = [];
      try {
        const taxRows = await dbAll(`
          SELECT t.name as tax_name,
            t.rate as tax_rate,
            COALESCE(SUM(oi.price * oi.quantity * t.rate / 100), 0) as tax_amount
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          JOIN tax_group_links tgl ON tgl.tax_group_id = oi.tax_group_id
          JOIN taxes t ON t.tax_id = tgl.tax_id
          WHERE date(o.created_at,'localtime') >= ? AND date(o.created_at,'localtime') <= ?
            AND ${paidStatuses}
            AND COALESCE(oi.is_voided, 0) = 0
            AND COALESCE(t.is_deleted, 0) = 0
          GROUP BY t.tax_id, t.name, t.rate
          ORDER BY t.name
        `, [startDate, endDate]);
        taxDetails = (taxRows || []).map(r => ({
          name: r.tax_name,
          rate: Number(r.tax_rate || 0),
          amount: Number(r.tax_amount || 0),
        }));
      } catch (e) { /* taxes/tax_group_links may not exist */ }

      const paidOrderCount = overallOrders?.order_count || 0;

      // 2) Channel breakdown - orders 기반 + payments에서 tip 합산
      const channelRows = await dbAll(`
        SELECT
          CASE
            WHEN UPPER(o.order_type) IN ('POS','DINE_IN','DINE-IN','TABLE_ORDER','FOR HERE','FORHERE','EAT IN','EATIN') THEN 'DINE-IN'
            WHEN UPPER(o.order_type) IN ('TOGO','TAKEOUT','TO GO','TO-GO','PICKUP') THEN 'TOGO'
            WHEN UPPER(o.order_type) = 'ONLINE' THEN 'ONLINE'
            WHEN UPPER(o.order_type) = 'DELIVERY' THEN 'DELIVERY'
            ELSE 'OTHER'
          END as ch,
          COUNT(*) as cnt,
          COALESCE(SUM(o.subtotal), 0) as subtotal,
          COALESCE(SUM(o.tax), 0) as tax,
          COALESCE(SUM(o.total), 0) as sales,
          COALESCE(SUM((SELECT COALESCE(SUM(p.tip), 0) FROM payments p WHERE p.order_id = o.id AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID'))), 0) as tips
        FROM orders o
        WHERE ${dateFilterO} AND ${paidStatuses}
        GROUP BY ch ORDER BY sales DESC
      `, [startDate, endDate]);

      const channelMap = {};
      (channelRows || []).forEach(r => {
        channelMap[r.ch] = { count: r.cnt, subtotal: Number(r.subtotal), tax: Number(r.tax), sales: Number(r.sales), tips: Number(r.tips) };
      });

      // Dine-in table stats - payments 기반 avg
      const dineInTableStats = await dbGet(`
        SELECT COUNT(DISTINCT o.id) as table_order_count,
               COALESCE(AVG(sub.order_paid), 0) as avg_per_table
        FROM (
          SELECT o.id, SUM(p.amount - COALESCE(p.tip, 0)) as order_paid
          FROM payments p
          JOIN orders o ON p.order_id = o.id
          WHERE ${dateFilterO} AND ${paidStatuses}
            AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
            AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
            AND UPPER(o.order_type) IN ('POS','DINE_IN','DINE-IN','TABLE_ORDER','FOR HERE','FORHERE','EAT IN','EATIN')
            AND o.table_id IS NOT NULL AND o.table_id != ''
          GROUP BY o.id
        ) sub
        JOIN orders o ON sub.id = o.id
      `, [startDate, endDate]);

      // 3) Delivery platform breakdown - payments 기반
      const deliveryRows = await dbAll(`
        SELECT COALESCE(
          UPPER(NULLIF(TRIM(o.order_source), '')),
          UPPER(NULLIF(TRIM(d.delivery_company), '')),
          'UNKNOWN'
        ) as platform,
               COUNT(DISTINCT o.id) as cnt,
               COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as sales
        FROM payments p
        JOIN orders o ON p.order_id = o.id
        LEFT JOIN delivery_orders d ON d.order_id = o.id
        WHERE ${dateFilterO} AND ${paidStatuses}
          AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
          AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
          AND UPPER(o.order_type) = 'DELIVERY'
        GROUP BY platform ORDER BY sales DESC
      `, [startDate, endDate]);

      const normalizeDeliveryPlatform = (raw) => {
        const u = String(raw || '').toUpperCase().replace(/\s+/g, '');
        if (u.includes('UBER')) return 'UBER';
        if (u.includes('DOORDASH') || u.includes('DDASH')) return 'DOORDASH';
        if (u.includes('SKIP')) return 'SKIP';
        if (u.includes('FANTUAN') || u.includes('FANT')) return 'FANTUAN';
        if (u.includes('GRUBHUB')) return 'GRUBHUB';
        return raw || 'OTHER';
      };

      const deliveryPlatformMap = {};
      (deliveryRows || []).forEach(r => {
        const key = normalizeDeliveryPlatform(r.platform);
        if (!deliveryPlatformMap[key]) deliveryPlatformMap[key] = { count: 0, sales: 0 };
        deliveryPlatformMap[key].count += r.cnt;
        deliveryPlatformMap[key].sales += Number(r.sales);
      });

      // 4) Top selling items (PAID orders only)
      const topItems = await dbAll(`
        SELECT oi.name, SUM(oi.quantity) as total_qty,
               SUM(oi.quantity * oi.price) as total_revenue
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE date(o.created_at,'localtime') >= ? AND date(o.created_at,'localtime') <= ? AND ${paidStatuses}
          AND oi.name IS NOT NULL AND oi.name != ''
          AND COALESCE(oi.price, 0) >= 0
        GROUP BY oi.name ORDER BY total_revenue DESC LIMIT 50
      `, [startDate, endDate]);

      // 4b) Bottom (least sold) items (PAID orders only)
      const bottomItems = await dbAll(`
        SELECT oi.name, SUM(oi.quantity) as total_qty,
               SUM(oi.quantity * oi.price) as total_revenue
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE date(o.created_at,'localtime') >= ? AND date(o.created_at,'localtime') <= ? AND ${paidStatuses}
          AND oi.name IS NOT NULL AND oi.name != ''
          AND COALESCE(oi.price, 0) > 0
        GROUP BY oi.name ORDER BY total_revenue ASC LIMIT 20
      `, [startDate, endDate]);

      // 5) Total item count (PAID orders only)
      const totalItemData = await dbGet(`
        SELECT COALESCE(SUM(oi.quantity),0) as total_items,
               COUNT(DISTINCT oi.name) as unique_items
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE date(o.created_at,'localtime') >= ? AND date(o.created_at,'localtime') <= ? AND ${paidStatuses}
          AND oi.name IS NOT NULL AND oi.name != ''
          AND COALESCE(oi.price, 0) >= 0
      `, [startDate, endDate]);

      // 6) Unpaid (OPEN) orders
      const unpaidStatuses = "UPPER(status) IN ('OPEN','PENDING','IN_PROGRESS','READY')";
      const unpaidOverall = await dbGet(`
        SELECT COUNT(*) as order_count,
               COALESCE(SUM(total),0) as total_amount
        FROM orders WHERE ${dateFilter} AND ${unpaidStatuses}
      `, [startDate, endDate]);

      const unpaidByChannel = await dbAll(`
        SELECT
          CASE
            WHEN UPPER(order_type) IN ('POS','DINE_IN','DINE-IN','TABLE_ORDER','FOR HERE','FORHERE','EAT IN','EATIN') THEN 'DINE-IN'
            WHEN UPPER(order_type) IN ('TOGO','TAKEOUT','TO GO','TO-GO','PICKUP') THEN 'TOGO'
            WHEN UPPER(order_type) = 'ONLINE' THEN 'ONLINE'
            WHEN UPPER(order_type) = 'DELIVERY' THEN 'DELIVERY'
            ELSE 'OTHER'
          END as ch,
          COUNT(*) as cnt,
          COALESCE(SUM(total),0) as amount
        FROM orders WHERE ${dateFilter} AND ${unpaidStatuses}
        GROUP BY ch ORDER BY amount DESC
      `, [startDate, endDate]);

      const unpaidChannelMap = {};
      (unpaidByChannel || []).forEach(r => { unpaidChannelMap[r.ch] = { count: r.cnt, amount: Number(r.amount) }; });

      // 7) Hourly sales
      const hourlySales = await dbAll(`
        SELECT strftime('%H', o.created_at) as hour,
          COUNT(DISTINCT o.id) as order_count,
          COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue
        FROM payments p
        JOIN orders o ON p.order_id = o.id
        WHERE date(o.created_at,'localtime') >= ? AND date(o.created_at,'localtime') <= ?
          AND ${paidStatuses}
          AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
          AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
        GROUP BY strftime('%H', o.created_at)
        ORDER BY hour
      `, [startDate, endDate]);

      // 8) Payment breakdown
      const paymentBreakdown = await dbAll(`
        SELECT p.payment_method,
          COUNT(*) as count,
          COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as net_amount,
          COALESCE(SUM(COALESCE(p.tip, 0)), 0) as tips
        FROM payments p
        JOIN orders o ON p.order_id = o.id
        WHERE date(o.created_at,'localtime') >= ? AND date(o.created_at,'localtime') <= ?
          AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
          AND ${paidStatuses}
        GROUP BY p.payment_method
      `, [startDate, endDate]);

      // 9) Table turnover (JOIN table_map_elements for table_name)
      const tableTurnover = await dbAll(`
        SELECT COALESCE(t.name, o.table_id) as table_name,
          COUNT(*) as order_count,
          COALESCE(AVG(
            CASE WHEN o.closed_at IS NOT NULL AND o.created_at IS NOT NULL
            THEN (julianday(o.closed_at) - julianday(o.created_at)) * 24 * 60
            END
          ), 0) as avg_duration_min
        FROM orders o
        LEFT JOIN table_map_elements t ON o.table_id = t.element_id
        WHERE date(o.created_at,'localtime') >= ? AND date(o.created_at,'localtime') <= ?
          AND ${paidStatuses}
          AND o.table_id IS NOT NULL AND o.table_id != ''
        GROUP BY COALESCE(t.name, o.table_id)
        ORDER BY order_count DESC
      `, [startDate, endDate]);

      // 10) Employee sales
      const employeeSales = await dbAll(`
        SELECT COALESCE(o.server_name, 'Unknown') as employee,
          COUNT(DISTINCT o.id) as order_count,
          COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue,
          COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) / MAX(COUNT(DISTINCT o.id), 1) as avg_check
        FROM payments p
        JOIN orders o ON p.order_id = o.id
        WHERE date(o.created_at,'localtime') >= ? AND date(o.created_at,'localtime') <= ?
          AND ${paidStatuses}
          AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
          AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
        GROUP BY COALESCE(o.server_name, 'Unknown')
        ORDER BY revenue DESC
      `, [startDate, endDate]);

      // 11) Refunds & Voids
      const refundsVoids = await dbAll(`
        SELECT 'refund' as type, COUNT(*) as count, COALESCE(SUM(total), 0) as total
        FROM refunds WHERE date(created_at,'localtime') >= ? AND date(created_at,'localtime') <= ?
        UNION ALL
        SELECT 'void' as type, COUNT(*) as count, COALESCE(SUM(grand_total), 0) as total
        FROM voids WHERE date(created_at,'localtime') >= ? AND date(created_at,'localtime') <= ?
      `, [startDate, endDate, startDate, endDate]);

      res.json({
        success: true,
        period: { startDate, endDate },
        overall: {
          orderCount: paidOrderCount,
          subtotal: Number(overallOrders?.subtotal || 0),
          taxTotal: Number(overallOrders?.tax_total || 0),
          totalSales: Number(overallOrders?.total || 0),
          totalTip: Number(tipData?.total_tip || 0),
          serviceCharge: Number(overallOrders?.service_charge_total || 0),
        },
        taxDetails,
        channels: {
          'DINE-IN': channelMap['DINE-IN'] || { count: 0, subtotal: 0, tax: 0, sales: 0, tips: 0 },
          'TOGO': channelMap['TOGO'] || { count: 0, subtotal: 0, tax: 0, sales: 0, tips: 0 },
          'ONLINE': channelMap['ONLINE'] || { count: 0, subtotal: 0, tax: 0, sales: 0, tips: 0 },
          'DELIVERY': channelMap['DELIVERY'] || { count: 0, subtotal: 0, tax: 0, sales: 0, tips: 0 },
          'OTHER': channelMap['OTHER'] || { count: 0, subtotal: 0, tax: 0, sales: 0, tips: 0 },
        },
        dineInTableStats: {
          tableOrderCount: dineInTableStats?.table_order_count || 0,
          avgPerTable: Number(dineInTableStats?.avg_per_table || 0),
        },
        deliveryPlatforms: deliveryPlatformMap,
        topItems: (topItems || []).map((item, idx) => ({
          rank: idx + 1,
          name: item.name,
          quantity: item.total_qty || 0,
          revenue: Number(item.total_revenue || 0),
        })),
        bottomItems: (bottomItems || []).map((item, idx) => ({
          rank: idx + 1,
          name: item.name,
          quantity: item.total_qty || 0,
          revenue: Number(item.total_revenue || 0),
        })),
        totalItems: {
          totalQuantity: totalItemData?.total_items || 0,
          uniqueItems: totalItemData?.unique_items || 0,
        },
        unpaid: {
          orderCount: unpaidOverall?.order_count || 0,
          totalAmount: Number(unpaidOverall?.total_amount || 0),
          channels: {
            'DINE-IN': unpaidChannelMap['DINE-IN'] || { count: 0, amount: 0 },
            'TOGO': unpaidChannelMap['TOGO'] || { count: 0, amount: 0 },
            'ONLINE': unpaidChannelMap['ONLINE'] || { count: 0, amount: 0 },
            'DELIVERY': unpaidChannelMap['DELIVERY'] || { count: 0, amount: 0 },
          },
        },
        hourlySales: hourlySales || [],
        paymentBreakdown: paymentBreakdown || [],
        tableTurnover: tableTurnover || [],
        employeeSales: employeeSales || [],
        refundsVoids: refundsVoids || [],
      });
    } catch (error) {
      console.error('Sales report error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================================
  // Z Report History - 과거 Z Report 목록 + 상세 조회
  // ============================================================
  router.get('/z-report-history', async (req, res) => {
    try {
      const { date, limit: rawLimit = 60 } = req.query;
      const lim = Math.min(200, Math.max(1, parseInt(rawLimit) || 60));

      if (date) {
        const sessions = await dbAll(
          `SELECT * FROM daily_closings WHERE date = ? ORDER BY id DESC`,
          [date]
        );
        if (!sessions || sessions.length === 0) {
          return res.json({ success: true, data: null, message: 'No session found for this date' });
        }
        const session = sessions[0];
        const startTime = session.opened_at;
        const endTime = session.closed_at || getLocalDatetimeString();

        let storeName = 'Restaurant';
        let serviceMode = 'FSR';
        try {
          const bp = await dbGet(`SELECT business_name, service_type FROM business_profile WHERE id = 1`);
          if (bp) { storeName = bp.business_name || 'Restaurant'; serviceMode = bp.service_type || 'FSR'; }
        } catch (e) { /* */ }

        const q = await querySalesData(startTime, endTime);
        const openingCash = session.opening_cash || 0;
        const actualCash = q.actualCashSales || 0;
        const actualCashTips = q.actualCashTips || 0;
        const expectedCash = openingCash + actualCash + actualCashTips - q.cashRefundTotal;

        let closingCash = 0;
        let cashBreakdown = {};
        try {
          if (session.closing_cash_details) {
            cashBreakdown = typeof session.closing_cash_details === 'string' ? JSON.parse(session.closing_cash_details) : session.closing_cash_details;
          }
          closingCash = session.closing_cash || 0;
        } catch (e) { /* */ }

        return res.json({
          success: true,
          data: {
            session_id: session.session_id,
            date: session.date,
            store_name: storeName,
            service_mode: serviceMode,
            opening_cash: openingCash,
            expected_cash: expectedCash,
            closing_cash: closingCash,
            cash_breakdown: cashBreakdown,
            total_sales: q.salesData?.total_sales || 0,
            subtotal: q.salesData?.subtotal || 0,
            order_count: q.salesData?.order_count || 0,
            tax_total: q.salesData?.tax_total || 0,
            gst_total: q.gstTotal ?? 0,
            pst_total: q.pstTotal ?? 0,
            gratuity_total: q.gratuityTotal,
            guest_count: q.guestCount,
            first_order_time: q.salesData?.first_order_time || null,
            last_order_time: q.salesData?.last_order_time || null,
            dine_in_sales: q.salesData?.dine_in_sales || 0,
            togo_sales: q.salesData?.togo_sales || 0,
            online_sales: q.salesData?.online_sales || 0,
            delivery_sales: q.salesData?.delivery_sales || 0,
            dine_in_order_count: q.salesData?.dine_in_order_count || 0,
            togo_order_count: q.salesData?.togo_order_count || 0,
            online_order_count: q.salesData?.online_order_count || 0,
            delivery_order_count: q.salesData?.delivery_order_count || 0,
            cash_sales: q.actualCashSales || 0,
            card_sales: q.paymentData?.card_sales || 0,
            other_sales: q.paymentData?.other_sales || 0,
            cash_order_count: q.cashOrderCount || 0,
            card_order_count: q.cardOrderCount || 0,
            other_order_count: q.otherOrderCount || 0,
            visa_sales: q.paymentData?.visa_sales || 0,
            mastercard_sales: q.paymentData?.mastercard_sales || 0,
            debit_sales: q.paymentData?.debit_sales || 0,
            other_card_sales: q.paymentData?.other_card_sales || 0,
            tip_total: q.paymentData?.tip_total || 0,
            cash_tips: q.paymentData?.cash_tips || 0,
            card_tips: q.paymentData?.card_tips || 0,
            cash_tip_order_count: q.cashTipOrderCount || 0,
            card_tip_order_count: q.cardTipOrderCount || 0,
            total_tip_order_count: q.totalTipOrderCount || 0,
            payment_methods: (q.paymentMethods || []).map(pm => ({
              method: pm.payment_method, count: pm.count,
              net: pm.net_amount, gross: pm.gross_amount, tip: pm.tip_amount,
              tip_order_count: pm.tip_order_count || 0,
            })),
            refund_total: q.refundData?.refund_total || 0,
            refund_count: q.refundData?.refund_count || 0,
            cash_refund_total: q.cashRefundTotal,
            void_total: q.voidData?.void_total || 0,
            void_count: q.voidData?.void_count || 0,
            discount_total: q.discountData?.discount_total || 0,
            discount_order_count: q.discountOrderCount || 0,
            gift_card_sold: q.giftCardSold,
            gift_card_sold_count: q.giftCardSoldCount,
            gift_card_payment: q.giftCardPayment,
            gift_card_payment_count: q.giftCardPaymentCount,
            refund_details: q.refundDetails || [],
            void_details: q.voidDetails || [],
            status: session.status,
            opened_at: session.opened_at,
            closed_at: session.closed_at,
          }
        });
      }

      const records = await dbAll(
        'SELECT session_id, date, status, opened_at, closed_at, total_sales, order_count, opening_cash, closing_cash FROM daily_closings ORDER BY id DESC LIMIT ?',
        [lim]
      );
      res.json({ success: true, data: records });
    } catch (error) {
      console.error('Z-Report history error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================================
  // Item Report API - 기간별 아이템 판매 분석 + 채널/결제 분석
  // ============================================================
  router.get('/item-report', async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        return res.status(400).json({ success: false, error: 'startDate and endDate are required (YYYY-MM-DD)' });
      }
      const paidStatuses = "UPPER(o.status) IN ('PAID','PICKED_UP','CLOSED','COMPLETED')";
      // Use localtime so the UI's local date range matches DB filtering.
      const dateFilter = "date(o.created_at,'localtime') >= ? AND date(o.created_at,'localtime') <= ?";
      const eventDateFilter = "date(created_at,'localtime') >= ? AND date(created_at,'localtime') <= ?";

      // 1) Channel breakdown - payments 기반 실결제 매출
      const channelRows = await dbAll(`
        SELECT
          CASE
            WHEN UPPER(o.order_type) IN ('POS','DINE_IN','DINE-IN','TABLE_ORDER','FOR HERE','FORHERE','EAT IN','EATIN') THEN 'DINE-IN'
            WHEN UPPER(o.order_type) IN ('TOGO','TAKEOUT','TO GO','TO-GO','PICKUP') THEN 'TOGO'
            WHEN UPPER(o.order_type) = 'ONLINE' THEN 'ONLINE'
            WHEN UPPER(o.order_type) = 'DELIVERY' THEN 'DELIVERY'
            ELSE 'OTHER'
          END as channel,
          COUNT(DISTINCT o.id) as order_count,
          COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as total_sales
        FROM payments p
        JOIN orders o ON p.order_id = o.id
        WHERE ${dateFilter} AND ${paidStatuses}
          AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
          AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
        GROUP BY channel ORDER BY total_sales DESC
      `, [startDate, endDate]);

      // subtotal/tax from orders (needed for display)
      const channelOrderRows = await dbAll(`
        SELECT
          CASE
            WHEN UPPER(order_type) IN ('POS','DINE_IN','DINE-IN','TABLE_ORDER','FOR HERE','FORHERE','EAT IN','EATIN') THEN 'DINE-IN'
            WHEN UPPER(order_type) IN ('TOGO','TAKEOUT','TO GO','TO-GO','PICKUP') THEN 'TOGO'
            WHEN UPPER(order_type) = 'ONLINE' THEN 'ONLINE'
            WHEN UPPER(order_type) = 'DELIVERY' THEN 'DELIVERY'
            ELSE 'OTHER'
          END as channel,
          COALESCE(SUM(subtotal),0) as subtotal,
          COALESCE(SUM(tax),0) as tax_total
        FROM orders o WHERE ${dateFilter.replace(/o\./g, '')} AND ${paidStatuses.replace(/o\./g, '')}
        GROUP BY channel
      `, [startDate, endDate]);
      const chOrderMap = {};
      (channelOrderRows || []).forEach(r => { chOrderMap[r.channel] = r; });

      let grandTotalSales = 0;
      let grandOrderCount = 0;
      const channels = channelRows.map(r => {
        grandTotalSales += Number(r.total_sales);
        grandOrderCount += r.order_count;
        const orderData = chOrderMap[r.channel] || {};
        return {
          channel: r.channel,
          orderCount: r.order_count,
          totalSales: Number(r.total_sales),
          subtotal: Number(orderData.subtotal || 0),
          tax: Number(orderData.tax_total || 0),
          avgPerOrder: r.order_count > 0 ? Number(r.total_sales) / r.order_count : 0,
        };
      });

      const overallAvgPerOrder = grandOrderCount > 0 ? grandTotalSales / grandOrderCount : 0;

      // 2) Payment method breakdown
      const paymentRows = await dbAll(`
        SELECT
          UPPER(COALESCE(p.payment_method, 'OTHER')) as method,
          COUNT(DISTINCT p.order_id) as order_count,
          COALESCE(SUM(p.amount),0) as total_amount,
          COALESCE(SUM(p.tip),0) as total_tip
        FROM payments p
        JOIN orders o ON p.order_id = o.id
        WHERE ${dateFilter} AND ${paidStatuses}
          AND UPPER(p.status) IN ('COMPLETED','APPROVED','SETTLED','PAID')
        GROUP BY method ORDER BY total_amount DESC
      `, [startDate, endDate]);

      const paymentMethods = paymentRows.map(r => ({
        method: r.method,
        orderCount: r.order_count,
        totalAmount: Number(r.total_amount),
        totalTip: Number(r.total_tip),
      }));

      // 3) Sold items (by item name) ranked by quantity (most sold → least sold)
      const soldRows = await dbAll(`
        SELECT
          oi.name,
          SUM(oi.quantity) as total_qty,
          COALESCE(SUM(oi.quantity * oi.price),0) as total_revenue,
          COUNT(DISTINCT o.id) as order_count
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE ${dateFilter} AND ${paidStatuses}
          AND oi.name IS NOT NULL AND oi.name != ''
          AND COALESCE(oi.price, 0) >= 0
        GROUP BY oi.name ORDER BY total_qty DESC
      `, [startDate, endDate]);

      // 3b) Refund items (by item_name) within period (refund event time)
      let refundRows = [];
      try {
        refundRows = await dbAll(`
          SELECT
            ri.item_name as name,
            COALESCE(SUM(ri.quantity),0) as refund_qty,
            COALESCE(SUM(ri.total_price),0) as refund_amount,
            COUNT(DISTINCT r.id) as refund_count
          FROM refund_items ri
          JOIN refunds r ON ri.refund_id = r.id
          WHERE ${eventDateFilter} AND UPPER(COALESCE(r.status,'COMPLETED')) IN ('COMPLETED','APPROVED','SETTLED','PAID')
            AND ri.item_name IS NOT NULL AND ri.item_name != ''
          GROUP BY ri.item_name
          ORDER BY refund_amount DESC
        `, [startDate, endDate]);
      } catch (e) {
        refundRows = [];
      }

      // 3c) Void lines (by name) within period (void event time)
      let voidRows = [];
      try {
        voidRows = await dbAll(`
          SELECT
            vl.name as name,
            COALESCE(SUM(vl.qty),0) as void_qty,
            COALESCE(SUM(vl.amount),0) as void_amount,
            COUNT(DISTINCT v.id) as void_count
          FROM void_lines vl
          JOIN voids v ON vl.void_id = v.id
          WHERE ${eventDateFilter} AND UPPER(COALESCE(v.source,'partial')) IN ('PARTIAL','ENTIRE')
            AND vl.name IS NOT NULL AND vl.name != ''
          GROUP BY vl.name
          ORDER BY void_amount DESC
        `, [startDate, endDate]);
      } catch (e) {
        voidRows = [];
      }

      const soldByName = new Map();
      (soldRows || []).forEach((r) => {
        const name = String(r.name || '').trim();
        if (!name) return;
        soldByName.set(name, {
          soldQty: Number(r.total_qty || 0),
          soldAmount: Number(r.total_revenue || 0),
          soldOrderCount: Number(r.order_count || 0),
        });
      });
      const refundByName = new Map();
      (refundRows || []).forEach((r) => {
        const name = String(r.name || '').trim();
        if (!name) return;
        refundByName.set(name, {
          refundQty: Number(r.refund_qty || 0),
          refundAmount: Number(r.refund_amount || 0),
          refundCount: Number(r.refund_count || 0),
        });
      });
      const voidByName = new Map();
      (voidRows || []).forEach((r) => {
        const name = String(r.name || '').trim();
        if (!name) return;
        voidByName.set(name, {
          voidQty: Number(r.void_qty || 0),
          voidAmount: Number(r.void_amount || 0),
          voidCount: Number(r.void_count || 0),
        });
      });

      const allNames = new Set([
        ...Array.from(soldByName.keys()),
        ...Array.from(refundByName.keys()),
        ...Array.from(voidByName.keys()),
      ]);

      // Sort: Net amount desc (fallback to sold amount desc)
      const sortedNames = Array.from(allNames).sort((a, b) => {
        const sa = soldByName.get(a) || {};
        const ra = refundByName.get(a) || {};
        const va = voidByName.get(a) || {};
        const sb = soldByName.get(b) || {};
        const rb = refundByName.get(b) || {};
        const vb = voidByName.get(b) || {};
        const netA = Number(sa.soldAmount || 0) - Number(ra.refundAmount || 0) - Number(va.voidAmount || 0);
        const netB = Number(sb.soldAmount || 0) - Number(rb.refundAmount || 0) - Number(vb.voidAmount || 0);
        if (netB !== netA) return netB - netA;
        return Number(sb.soldAmount || 0) - Number(sa.soldAmount || 0);
      });

      const items = sortedNames.map((name, idx) => {
        const s = soldByName.get(name) || { soldQty: 0, soldAmount: 0, soldOrderCount: 0 };
        const r = refundByName.get(name) || { refundQty: 0, refundAmount: 0, refundCount: 0 };
        const v = voidByName.get(name) || { voidQty: 0, voidAmount: 0, voidCount: 0 };
        const netQty = Number(s.soldQty || 0) - Number(r.refundQty || 0) - Number(v.voidQty || 0);
        const netAmount = Number(s.soldAmount || 0) - Number(r.refundAmount || 0) - Number(v.voidAmount || 0);
        return {
          rank: idx + 1,
          name,
          // Backward-compatible fields (sold)
          quantity: Number(s.soldQty || 0),
          revenue: Number(s.soldAmount || 0),
          orderCount: Number(s.soldOrderCount || 0),
          // New detailed fields
          soldQty: Number(s.soldQty || 0),
          soldAmount: Number(s.soldAmount || 0),
          refundQty: Number(r.refundQty || 0),
          refundAmount: Number(r.refundAmount || 0),
          voidQty: Number(v.voidQty || 0),
          voidAmount: Number(v.voidAmount || 0),
          netQty,
          netAmount,
          refundCount: Number(r.refundCount || 0),
          voidCount: Number(v.voidCount || 0),
        };
      });

      const totalItemQty = items.reduce((s, i) => s + i.quantity, 0);
      const totalItemRevenue = items.reduce((s, i) => s + i.revenue, 0);
      const totalRefundQty = items.reduce((s, i) => s + (i.refundQty || 0), 0);
      const totalRefundAmount = items.reduce((s, i) => s + (i.refundAmount || 0), 0);
      const totalVoidQty = items.reduce((s, i) => s + (i.voidQty || 0), 0);
      const totalVoidAmount = items.reduce((s, i) => s + (i.voidAmount || 0), 0);
      const totalNetQty = items.reduce((s, i) => s + (i.netQty || 0), 0);
      const totalNetAmount = items.reduce((s, i) => s + (i.netAmount || 0), 0);

      // 4) Daily breakdown - payments 기반
      const dailyRows = await dbAll(`
        SELECT
          date(o.created_at,'localtime') as sale_date,
          COUNT(DISTINCT o.id) as order_count,
          COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as total_sales
        FROM payments p
        JOIN orders o ON p.order_id = o.id
        WHERE ${dateFilter} AND ${paidStatuses}
          AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
          AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
        GROUP BY sale_date ORDER BY sale_date ASC
      `, [startDate, endDate]);

      const dailyBreakdown = dailyRows.map(r => ({
        date: r.sale_date,
        orderCount: r.order_count,
        totalSales: Number(r.total_sales),
      }));

      res.json({
        success: true,
        period: { startDate, endDate },
        summary: {
          totalOrders: grandOrderCount,
          totalSales: grandTotalSales,
          avgPerOrder: overallAvgPerOrder,
        },
        channels,
        paymentMethods,
        items,
        itemTotals: {
          totalQuantity: totalItemQty,
          totalRevenue: totalItemRevenue,
          uniqueItems: items.length,
          refundQuantity: totalRefundQty,
          refundAmount: totalRefundAmount,
          voidQuantity: totalVoidQty,
          voidAmount: totalVoidAmount,
          netQuantity: totalNetQty,
          netAmount: totalNetAmount,
        },
        dailyBreakdown,
      });
    } catch (error) {
      console.error('Item report error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================================
  // Print Item Report - Receipt 프린터 출력
  // ============================================================
  router.post('/print-item-report', async (req, res) => {
    try {
      const { reportData, copies: rawCopies = 1 } = req.body;
      if (!reportData) return res.status(400).json({ success: false, error: 'reportData is required' });
      const copies = Math.max(1, Math.min(5, parseInt(rawCopies) || 1));

      const ESC = '\x1B'; const GS = '\x1D';
      const BOLD_ON = ESC + 'E\x01'; const BOLD_OFF = ESC + 'E\x00';
      const DOUBLE_SIZE_ON = GS + '!\x11'; const NORMAL_SIZE = GS + '!\x00';
      const ALIGN_CENTER = ESC + 'a\x01'; const ALIGN_LEFT = ESC + 'a\x00';
      const LINE_WIDTH = 42; const LINE_WIDTH_DOUBLE = 21;
      const center = (text, width = LINE_WIDTH) => { const pad = Math.max(0, Math.floor((width - text.length) / 2)); return ' '.repeat(pad) + text; };
      const leftRight = (l, r) => { const spaces = Math.max(1, LINE_WIDTH - l.length - r.length); return l + ' '.repeat(spaces) + r; };
      const leftRightBold = (l, r) => { const spaces = Math.max(1, LINE_WIDTH - l.length - r.length); return l + ' '.repeat(spaces) + BOLD_ON + r + BOLD_OFF; };
      const line = '='.repeat(LINE_WIDTH);
      const dottedLine = '-'.repeat(LINE_WIDTH);
      const fmtMoney = (amt) => `$${(amt || 0).toFixed(2)}`;

      let p = '\n' + line + '\n';
      p += ALIGN_CENTER + DOUBLE_SIZE_ON + BOLD_ON;
      p += center('ITEM REPORT', LINE_WIDTH_DOUBLE) + '\n';
      p += NORMAL_SIZE + BOLD_OFF;
      p += center(`${reportData.period?.startDate || ''} ~ ${reportData.period?.endDate || ''}`) + '\n';
      p += ALIGN_LEFT + line + '\n';

      // Summary
      p += '\n' + BOLD_ON + center('-- SUMMARY --') + BOLD_OFF + '\n';
      p += dottedLine + '\n';
      p += leftRightBold('Total Orders:', `${reportData.summary?.totalOrders || 0}`) + '\n';
      p += leftRightBold('Total Sales:', fmtMoney(reportData.summary?.totalSales)) + '\n';
      p += leftRightBold('Avg/Order:', fmtMoney(reportData.summary?.avgPerOrder)) + '\n';

      // Channel Breakdown
      if (reportData.channels && reportData.channels.length > 0) {
        p += '\n' + BOLD_ON + center('-- BY CHANNEL --') + BOLD_OFF + '\n';
        p += dottedLine + '\n';
        for (const ch of reportData.channels) {
          p += leftRightBold(`${ch.channel} (${ch.orderCount}):`, fmtMoney(ch.totalSales)) + '\n';
          p += leftRight('  Avg/Order:', fmtMoney(ch.avgPerOrder)) + '\n';
        }
      }

      // Payment Methods
      if (reportData.paymentMethods && reportData.paymentMethods.length > 0) {
        p += '\n' + BOLD_ON + center('-- BY PAYMENT --') + BOLD_OFF + '\n';
        p += dottedLine + '\n';
        for (const pm of reportData.paymentMethods) {
          p += leftRightBold(`${pm.method} (${pm.orderCount}):`, fmtMoney(pm.totalAmount)) + '\n';
          if (pm.totalTip > 0) p += leftRight('  Tips:', fmtMoney(pm.totalTip)) + '\n';
        }
      }

      // Items
      if (reportData.items && reportData.items.length > 0) {
        p += '\n' + BOLD_ON + center('-- ITEM SALES (S/R/V/NET) --') + BOLD_OFF + '\n';
        p += dottedLine + '\n';
        p += leftRight('Item', 'S  R  V    NET') + '\n';
        p += dottedLine + '\n';
        for (const item of reportData.items) {
          const soldQty = String(item.soldQty ?? item.quantity ?? 0).padStart(2);
          const refQty = String(item.refundQty ?? 0).padStart(2);
          const voidQty = String(item.voidQty ?? 0).padStart(2);
          const net = fmtMoney(item.netAmount ?? ((item.revenue || 0) - (item.refundAmount || 0) - (item.voidAmount || 0)));
          p += leftRight(String(item.name || '').substring(0, 24), `${soldQty} ${refQty} ${voidQty}  ${net}`) + '\n';
        }
        p += dottedLine + '\n';
        const netTotal = fmtMoney(reportData.itemTotals?.netAmount ?? ((reportData.itemTotals?.totalRevenue || 0) - (reportData.itemTotals?.refundAmount || 0) - (reportData.itemTotals?.voidAmount || 0)));
        p += BOLD_ON + leftRight('NET TOTAL:', `${netTotal}`) + BOLD_OFF + '\n';
        p += leftRight('Sold:', fmtMoney(reportData.itemTotals?.totalRevenue || 0)) + '\n';
        if ((reportData.itemTotals?.refundAmount || 0) > 0) p += leftRight('Refunds:', `-${fmtMoney(reportData.itemTotals?.refundAmount || 0)}`) + '\n';
        if ((reportData.itemTotals?.voidAmount || 0) > 0) p += leftRight('Voids:', `-${fmtMoney(reportData.itemTotals?.voidAmount || 0)}`) + '\n';
        p += leftRight('Unique Items:', `${reportData.itemTotals?.uniqueItems || 0}`) + '\n';
      }

      p += '\n' + line + '\n';
      p += ALIGN_CENTER + `Printed: ${new Date().toLocaleString('en-US')}` + '\n';
      p += ALIGN_LEFT + '\n\n\n';

      let printer;
      for (let i = 0; i < copies; i++) {
        printer = await printEscPosTextToFront(p, { openDrawer: false });
      }
      res.json({ success: true, message: `Item Report printed (${copies} copies)`, printer, copies });
    } catch (error) {
      console.error('Print Item Report error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
};
