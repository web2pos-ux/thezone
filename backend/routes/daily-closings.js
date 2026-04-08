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

    const PAID_STATUSES = `UPPER(status) IN ('PAID', 'PICKED_UP', 'CLOSED', 'COMPLETED')`;
    const PAY_STATUSES = `UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')`;
    const PAY_STATUSES_SOLO = `UPPER(status) IN ('APPROVED','COMPLETED','SETTLED','PAID')`;

    // Sales Data - order counts and time range from orders table
    const salesData = await dbGet(`
      SELECT 
        COUNT(*) as order_count,
        COALESCE(SUM(subtotal), 0) as subtotal,
        COALESCE(SUM(tax), 0) as tax_total,
        COALESCE(SUM(CASE WHEN UPPER(order_type) IN ('POS', 'DINE_IN', 'DINE-IN', 'TABLE_ORDER', 'FOR HERE', 'FORHERE') THEN 1 ELSE 0 END), 0) as dine_in_order_count,
        COALESCE(SUM(CASE WHEN UPPER(order_type) IN ('TOGO', 'PICKUP', 'TAKEOUT') THEN 1 ELSE 0 END), 0) as togo_order_count,
        COALESCE(SUM(CASE WHEN UPPER(order_type) IN ('ONLINE', 'WEB', 'QR') THEN 1 ELSE 0 END), 0) as online_order_count,
        COALESCE(SUM(CASE WHEN UPPER(order_type) = 'DELIVERY' THEN 1 ELSE 0 END), 0) as delivery_order_count,
        MIN(created_at) as first_order_time,
        MAX(created_at) as last_order_time
      FROM orders 
      WHERE ${tf.where} AND ${PAID_STATUSES}
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
          WHEN UPPER(o.order_type) IN ('POS','DINE_IN','DINE-IN','TABLE_ORDER','FOR HERE','FORHERE') THEN 'DINE_IN'
          WHEN UPPER(o.order_type) IN ('TOGO','PICKUP','TAKEOUT') THEN 'TOGO'
          WHEN UPPER(o.order_type) IN ('ONLINE','WEB','QR') THEN 'ONLINE'
          WHEN UPPER(o.order_type) = 'DELIVERY' THEN 'DELIVERY'
          ELSE 'OTHER'
        END as ch,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as sales
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE o.created_at >= ? AND o.created_at <= ? AND UPPER(o.status) IN ('PAID','PICKED_UP','CLOSED','COMPLETED')
        AND ${PAY_STATUSES}
        AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
      GROUP BY ch
    `, tf.params);
    const chMap = {};
    (channelSalesRows || []).forEach(r => { chMap[r.ch] = Number(r.sales); });
    salesData.dine_in_sales = chMap['DINE_IN'] || 0;
    salesData.togo_sales = chMap['TOGO'] || 0;
    salesData.online_sales = chMap['ONLINE'] || 0;
    salesData.delivery_sales = chMap['DELIVERY'] || 0;

    // GST / PST separation (Canadian tax compliance)
    // Uses orders.tax + orders.subtotal to calculate effective rate, then splits by tax table rates
    let gstTotal = 0, pstTotal = 0;
    try {
      const oTf = tfPrefixed('o');
      // First try: tax_group_links based
      const taxSplit = await dbGet(`
        SELECT
          COALESCE(SUM(
            (oi.price * oi.quantity) * (
              SELECT COALESCE(SUM(CASE WHEN UPPER(t.name) LIKE '%GST%' THEN t.rate ELSE 0 END), 0) / 100
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

      // Fallback: if tax_group_id is NULL for all items, use orders.tax + taxes table
      if (gstTotal === 0 && pstTotal === 0) {
        const activeTaxes = await dbAll(`
          SELECT DISTINCT t.name, t.rate FROM taxes t
          JOIN tax_group_links tgl ON tgl.tax_id = t.tax_id
          JOIN tax_groups tg ON tg.tax_group_id = tgl.tax_group_id AND COALESCE(tg.is_deleted, 0) = 0
          WHERE COALESCE(t.is_deleted, 0) = 0
          ORDER BY t.rate ASC
        `, []);
        const gstRate = (activeTaxes || []).find(t => /gst/i.test(t.name))?.rate || 0;
        const pstRates = (activeTaxes || []).filter(t => /pst/i.test(t.name)).map(t => Number(t.rate));
        const mainPstRate = pstRates.length > 0 ? Math.min(...pstRates) : 0;

        if (gstRate > 0) {
          const orders = await dbAll(`
            SELECT o.subtotal, o.tax FROM orders o
            WHERE ${oTf.where} AND UPPER(o.status) IN ('PAID', 'PICKED_UP', 'CLOSED', 'COMPLETED')
              AND COALESCE(o.tax, 0) > 0
          `, oTf.params);
          (orders || []).forEach(o => {
            const sub = Number(o.subtotal || 0);
            const totalTax = Number(o.tax || 0);
            if (sub <= 0 || totalTax <= 0) return;
            const effRate = (totalTax / sub) * 100;
            if (effRate <= gstRate + 0.5) {
              gstTotal += totalTax;
            } else if (mainPstRate > 0) {
              const combinedRate = gstRate + mainPstRate;
              gstTotal += (gstRate / combinedRate) * totalTax;
              pstTotal += (mainPstRate / combinedRate) * totalTax;
            } else {
              gstTotal += totalTax;
            }
          });
          gstTotal = Number(gstTotal.toFixed(2));
          pstTotal = Number(pstTotal.toFixed(2));
        }
      }
    } catch (e) { /* tax_groups/taxes may not exist */ }

    // ---- CASH DRAWER CORRECT CALCULATION ----
    const oTfCash = tfPrefixed('o');
    const nonCashData = await dbGet(`
      SELECT COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as non_cash_net
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE ${oTfCash.where} AND UPPER(o.status) IN ('PAID','PICKED_UP','CLOSED','COMPLETED')
      AND ${PAY_STATUSES}
      AND UPPER(p.payment_method) NOT IN ('CASH', 'NO_SHOW_FORFEITED')
    `, oTfCash.params);
    // Cash tips that went into the drawer
    const cashTipLegacyData = await dbGet(`
      SELECT COALESCE(SUM(COALESCE(p.tip, 0)), 0) as cash_tips
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE ${oTfCash.where} AND UPPER(o.status) IN ('PAID','PICKED_UP','CLOSED','COMPLETED')
      AND ${PAY_STATUSES} AND UPPER(p.payment_method) = 'CASH'
    `, oTfCash.params);
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
        COALESCE(SUM(CASE WHEN UPPER(p.payment_method) = 'CASH' THEN (p.amount - COALESCE(p.tip, 0)) ELSE 0 END), 0) as cash_sales,
        COALESCE(SUM(CASE WHEN UPPER(p.payment_method) = 'CASH' THEN COALESCE(p.tip, 0) ELSE 0 END), 0) as cash_tips,
        COALESCE(SUM(CASE WHEN UPPER(p.payment_method) = 'VISA' THEN (p.amount - COALESCE(p.tip, 0)) ELSE 0 END), 0) as visa_sales,
        COALESCE(SUM(CASE WHEN UPPER(p.payment_method) = 'VISA' THEN COALESCE(p.tip, 0) ELSE 0 END), 0) as visa_tips,
        COALESCE(SUM(CASE WHEN UPPER(p.payment_method) IN ('MC', 'MASTERCARD') THEN (p.amount - COALESCE(p.tip, 0)) ELSE 0 END), 0) as mastercard_sales,
        COALESCE(SUM(CASE WHEN UPPER(p.payment_method) IN ('MC', 'MASTERCARD') THEN COALESCE(p.tip, 0) ELSE 0 END), 0) as mastercard_tips,
        COALESCE(SUM(CASE WHEN UPPER(p.payment_method) = 'DEBIT' THEN (p.amount - COALESCE(p.tip, 0)) ELSE 0 END), 0) as debit_sales,
        COALESCE(SUM(CASE WHEN UPPER(p.payment_method) = 'DEBIT' THEN COALESCE(p.tip, 0) ELSE 0 END), 0) as debit_tips,
        COALESCE(SUM(CASE WHEN UPPER(p.payment_method) IN ('OTHER_CARD', 'OTHER CARD', 'AMEX', 'DISCOVER', 'CARD', 'CREDIT') THEN (p.amount - COALESCE(p.tip, 0)) ELSE 0 END), 0) as other_card_sales,
        COALESCE(SUM(CASE WHEN UPPER(p.payment_method) IN ('OTHER_CARD', 'OTHER CARD', 'AMEX', 'DISCOVER', 'CARD', 'CREDIT') THEN COALESCE(p.tip, 0) ELSE 0 END), 0) as other_card_tips,
        COALESCE(SUM(CASE WHEN UPPER(p.payment_method) NOT IN ('CASH', 'VISA', 'MC', 'MASTERCARD', 'DEBIT', 'OTHER_CARD', 'OTHER CARD', 'AMEX', 'DISCOVER', 'CARD', 'CREDIT', 'NO_SHOW_FORFEITED') THEN (p.amount - COALESCE(p.tip, 0)) ELSE 0 END), 0) as other_sales,
        COALESCE(SUM(CASE WHEN UPPER(p.payment_method) != 'NO_SHOW_FORFEITED' THEN COALESCE(p.tip, 0) ELSE 0 END), 0) as tip_total,
        COALESCE(SUM(CASE WHEN UPPER(p.payment_method) != 'CASH' AND UPPER(p.payment_method) NOT IN ('GIFT', 'COUPON', 'OTHER', 'NO_SHOW_FORFEITED') THEN (p.amount - COALESCE(p.tip, 0)) ELSE 0 END), 0) as card_sales,
        COALESCE(SUM(CASE WHEN UPPER(p.payment_method) != 'CASH' AND UPPER(p.payment_method) NOT IN ('GIFT', 'COUPON', 'OTHER', 'NO_SHOW_FORFEITED') THEN COALESCE(p.tip, 0) ELSE 0 END), 0) as card_tips
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE o.created_at >= ? AND o.created_at <= ? AND UPPER(o.status) IN ('PAID','PICKED_UP','CLOSED','COMPLETED')
        AND ${PAY_STATUSES}
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
        p.payment_method,
        COUNT(DISTINCT p.order_id) as count,
        COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as net_amount,
        COALESCE(SUM(p.amount), 0) as gross_amount,
        COALESCE(SUM(COALESCE(p.tip, 0)), 0) as tip_amount,
        COUNT(DISTINCT CASE WHEN COALESCE(p.tip, 0) > 0 THEN p.order_id END) as tip_order_count
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE o.created_at >= ? AND o.created_at <= ? AND UPPER(o.status) IN ('PAID','PICKED_UP','CLOSED','COMPLETED')
        AND ${PAY_STATUSES} AND UPPER(p.payment_method) != 'NO_SHOW_FORFEITED'
      GROUP BY p.payment_method
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
      SELECT r.id, r.order_id, r.original_order_number, r.refund_type, r.total, r.payment_method, r.reason, r.refunded_by, r.created_at,
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

    let discountDetails = [];
    try {
      const oAdjTf = tfPrefixed('o');
      discountDetails = await dbAll(`
        SELECT oa.id, oa.order_id, oa.kind, oa.amount_applied, oa.label, oa.created_at,
               o.order_number,
               COALESCE(oa.applied_by_employee_id, '') AS applied_by_employee_id,
               COALESCE(oa.applied_by_name, '') AS applied_by_name
        FROM order_adjustments oa
        JOIN orders o ON oa.order_id = o.id
        WHERE ${oAdjTf.where}
          AND UPPER(o.status) IN ('PAID', 'PICKED_UP', 'CLOSED', 'COMPLETED')
          AND COALESCE(oa.amount_applied, 0) > 0
          AND UPPER(COALESCE(oa.kind, '')) IN ('DISCOUNT', 'PROMOTION', 'CHANNEL_DISCOUNT', 'COUPON')
        ORDER BY oa.created_at ASC
      `, oAdjTf.params);
    } catch (e) {
      discountDetails = [];
    }

    // Payment order counts (Cash/Card/Other) for PAYMENT BREAKDOWN aligned counts
    let cashOrderCount = 0;
    let cardOrderCount = 0;
    let otherOrderCount = 0;
    try {
      const pmCnt = await dbGet(
        `
        SELECT
          COUNT(DISTINCT CASE WHEN UPPER(p.payment_method) = 'CASH' THEN p.order_id END) as cash_order_count,
          COUNT(DISTINCT CASE WHEN UPPER(p.payment_method) IN ('VISA','MC','MASTERCARD','DEBIT','OTHER_CARD','OTHER CARD','AMEX','DISCOVER','CARD','CREDIT') THEN p.order_id END) as card_order_count,
          COUNT(DISTINCT CASE
            WHEN UPPER(p.payment_method) NOT IN ('CASH','VISA','MC','MASTERCARD','DEBIT','OTHER_CARD','OTHER CARD','AMEX','DISCOVER','CARD','CREDIT','NO_SHOW_FORFEITED')
            THEN p.order_id
          END) as other_order_count
        FROM payments p
        JOIN orders o ON p.order_id = o.id
        WHERE o.created_at >= ? AND o.created_at <= ? AND UPPER(o.status) IN ('PAID','PICKED_UP','CLOSED','COMPLETED')
          AND ${PAY_STATUSES}
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
          SELECT p.order_id FROM payments p JOIN orders o ON p.order_id = o.id WHERE o.created_at >= ? AND o.created_at <= ? AND UPPER(o.status) IN ('PAID','PICKED_UP','CLOSED','COMPLETED') AND ${PAY_STATUSES} AND UPPER(p.payment_method) = 'CASH' AND COALESCE(p.tip, 0) > 0
          UNION
          SELECT order_id FROM tips WHERE ${tf.where} AND UPPER(payment_method) = 'CASH' AND COALESCE(amount, 0) > 0
        )
        `,
        [...tf.params, ...tf.params]
      );
      const cardTipsCnt = await dbGet(
        `
        SELECT COUNT(DISTINCT order_id) as cnt
        FROM (
          SELECT p.order_id FROM payments p JOIN orders o ON p.order_id = o.id WHERE o.created_at >= ? AND o.created_at <= ? AND UPPER(o.status) IN ('PAID','PICKED_UP','CLOSED','COMPLETED') AND ${PAY_STATUSES} AND UPPER(p.payment_method) != 'CASH' AND UPPER(p.payment_method) != 'NO_SHOW_FORFEITED' AND COALESCE(p.tip, 0) > 0
          UNION
          SELECT order_id FROM tips WHERE ${tf.where} AND UPPER(payment_method) != 'CASH' AND COALESCE(amount, 0) > 0
        )
        `,
        [...tf.params, ...tf.params]
      );
      const totalTipsCnt = await dbGet(
        `
        SELECT COUNT(DISTINCT order_id) as cnt
        FROM (
          SELECT p.order_id FROM payments p JOIN orders o ON p.order_id = o.id WHERE o.created_at >= ? AND o.created_at <= ? AND UPPER(o.status) IN ('PAID','PICKED_UP','CLOSED','COMPLETED') AND ${PAY_STATUSES} AND UPPER(p.payment_method) != 'NO_SHOW_FORFEITED' AND COALESCE(p.tip, 0) > 0
          UNION
          SELECT order_id FROM tips WHERE ${tf.where} AND COALESCE(amount, 0) > 0
        )
        `,
        [...tf.params, ...tf.params]
      );
      cashTipOrderCount = Number(cashTipsCnt?.cnt || 0);
      cardTipOrderCount = Number(cardTipsCnt?.cnt || 0);
      totalTipOrderCount = Number(totalTipsCnt?.cnt || 0);
    } catch (e) {
      cashTipOrderCount = 0;
      cardTipOrderCount = 0;
      totalTipOrderCount = 0;
    }

    // Tips by server (Z-Report — shown only when select_server_on_entry is ON)
    let tipsByServer = [];
    try {
      const tbsRows = await dbAll(`
        SELECT server_name, SUM(tips) as tips FROM (
          SELECT COALESCE(o.server_name, 'Unknown') as server_name,
            COALESCE(SUM(COALESCE(p.tip, 0)), 0) as tips
          FROM payments p
          JOIN orders o ON p.order_id = o.id
          WHERE o.created_at >= ? AND o.created_at <= ?
            AND UPPER(o.status) IN ('PAID','PICKED_UP','CLOSED','COMPLETED')
            AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
            AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
          GROUP BY COALESCE(o.server_name, 'Unknown')
          UNION ALL
          SELECT COALESCE(o.server_name, 'Unknown') as server_name,
            COALESCE(SUM(t.amount), 0) as tips
          FROM tips t
          JOIN orders o ON t.order_id = o.id
          WHERE o.created_at >= ? AND o.created_at <= ?
            AND UPPER(o.status) IN ('PAID','PICKED_UP','CLOSED','COMPLETED')
          GROUP BY COALESCE(o.server_name, 'Unknown')
        ) combined
        GROUP BY server_name
        HAVING SUM(tips) > 0.0001
        ORDER BY tips DESC
      `, [...tf.params, ...tf.params]);
      tipsByServer = (tbsRows || []).map(r => ({
        server_name: r.server_name || 'Unknown',
        tips: Number(Number(r.tips || 0).toFixed(2)),
      }));
    } catch (e) {
      tipsByServer = [];
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
        FROM payments WHERE ${tf.where} AND payment_method = 'NO_SHOW_FORFEITED' AND ${PAY_STATUSES_SOLO}
      `, tf.params);
      noShowForfeited = nsData?.total || 0;
      noShowForfeitedCount = nsData?.cnt || 0;
    } catch (e) { /* */ }

    return {
      salesData, guestCount, gratuityTotal, paymentData, paymentMethods,
      refundData, cashRefundTotal, voidData, refundDetails, voidDetails,
      discountData, discountDetails, giftCardSold, giftCardSoldCount, giftCardPayment, giftCardPaymentCount,
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
      tipsByServer,
      // Correct cash drawer values (change excluded)
      actualCashSales,   // = order totals - non-cash payments
      actualCashTips,    // = cash tips in drawer
      nonCashNet         // = total non-cash payment net
    };
  };

  const getSelectServerOnEntry = async () => {
    try {
      const row = await dbGet(`SELECT settings_data FROM layout_settings ORDER BY updated_at DESC LIMIT 1`);
      if (row?.settings_data) {
        const s = JSON.parse(row.settings_data);
        return !!s.selectServerOnEntry;
      }
    } catch (e) { /* */ }
    return false;
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
      const selectServerOnEntry = await getSelectServerOnEntry();

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
          tips_by_server: q.tipsByServer || [],
          select_server_on_entry: selectServerOnEntry,
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
            payment_method: r.payment_method || '', reason: r.reason || '', refunded_by: r.refunded_by || '', created_at: r.created_at
          })),
          void_details: (q.voidDetails || []).map(v => ({
            id: v.id, order_id: v.order_id,
            order_number: v.order_number || `#${v.order_id}`,
            total: v.grand_total || 0, source: v.source || 'partial',
            reason: v.reason || '', created_by: v.created_by || '', created_at: v.created_at
          })),
          discount_details: (q.discountDetails || []).map(d => ({
            id: d.id,
            order_id: d.order_id,
            order_number: d.order_number || `#${d.order_id}`,
            kind: d.kind || '',
            amount_applied: d.amount_applied || 0,
            label: d.label || '',
            applied_by_employee_id: d.applied_by_employee_id || '',
            applied_by_name: d.applied_by_name || '',
            created_at: d.created_at
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

  // ============ CHECK SERVER UNPAID ORDERS ============
  router.post('/check-server-unpaid', async (req, res) => {
    try {
      const { serverId } = req.body;
      if (!serverId) return res.status(400).json({ success: false, error: 'serverId required' });

      const unpaidOrders = await dbAll(`
        SELECT id, order_number, order_type, total, status, table_id, server_id, server_name, created_at
        FROM orders
        WHERE COALESCE(server_id, '') = ?
          AND UPPER(status) NOT IN ('PAID','PICKED_UP','CLOSED','COMPLETED','VOIDED','VOID','CANCELLED','CANCELED')
        ORDER BY created_at DESC
      `, [String(serverId)]);

      res.json({
        success: true,
        hasUnpaid: (unpaidOrders || []).length > 0,
        count: (unpaidOrders || []).length,
        orders: unpaidOrders || []
      });
    } catch (error) {
      console.error('Check server unpaid error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============ TRANSFER ORDERS (server → server) ============
  router.post('/transfer-orders', async (req, res) => {
    try {
      const { fromServerId, fromServerName, toServerId, toServerName } = req.body;
      if (!fromServerId || !toServerId) {
        return res.status(400).json({ success: false, error: 'fromServerId and toServerId required' });
      }

      const unpaid = await dbAll(`
        SELECT id FROM orders
        WHERE COALESCE(server_id, '') = ?
          AND UPPER(status) NOT IN ('PAID','PICKED_UP','CLOSED','COMPLETED','VOIDED','VOID','CANCELLED','CANCELED')
      `, [String(fromServerId)]);

      if (!unpaid || unpaid.length === 0) {
        return res.json({ success: true, transferred: 0, message: 'No unpaid orders to transfer' });
      }

      const orderIds = unpaid.map(o => o.id);
      const placeholders = orderIds.map(() => '?').join(',');

      // 단일 트랜잭션: 주문·결제·팁 소유를 A→B로 한 번에 이전 (부분 적용 방지)
      await dbRun('BEGIN TRANSACTION');
      try {
        await dbRun(`
          UPDATE orders SET server_id = ?, server_name = ? WHERE id IN (${placeholders})
        `, [String(toServerId), toServerName || '', ...orderIds]);

        await dbRun(`
          UPDATE payments SET server_id = ? WHERE order_id IN (${placeholders}) AND UPPER(status) NOT IN ('REFUNDED','VOIDED')
        `, [String(toServerId), ...orderIds]);

        await dbRun(`
          UPDATE tips SET employee_id = ? WHERE order_id IN (${placeholders})
        `, [String(toServerId), ...orderIds]);

        await dbRun('COMMIT');
      } catch (txErr) {
        await dbRun('ROLLBACK').catch(() => {});
        throw txErr;
      }

      console.log(`[Transfer] ${orderIds.length} orders transferred: ${fromServerName}(${fromServerId}) → ${toServerName}(${toServerId})`);

      res.json({
        success: true,
        transferred: orderIds.length,
        orderIds,
        message: `${orderIds.length} order(s) transferred from ${fromServerName || fromServerId} to ${toServerName || toServerId}`
      });
    } catch (error) {
      console.error('Transfer orders error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============ SHIFT CLOSE ============
  router.post('/shift-close', async (req, res) => {
    try {
      const { countedCash = 0, cashDetails = {}, closedBy = '', serverId = '', serverPin = '' } = req.body;
      const now = getLocalDatetimeString();

      const activeSession = await getActiveSession();
      if (!activeSession) {
        return res.status(400).json({ success: false, error: 'No active session found' });
      }

      // Block if server still has unpaid orders
      if (serverId) {
        const unpaidCheck = await dbGet(`
          SELECT COUNT(*) as cnt FROM orders
          WHERE COALESCE(server_id, '') = ?
            AND UPPER(status) NOT IN ('PAID','PICKED_UP','CLOSED','COMPLETED','VOIDED','VOID','CANCELLED','CANCELED')
        `, [String(serverId)]);
        if (unpaidCheck && unpaidCheck.cnt > 0) {
          return res.status(400).json({
            success: false,
            error: `Server still has ${unpaidCheck.cnt} unpaid order(s). Transfer or complete them first.`
          });
        }
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

      console.log(`[Shift-Close] server=${closedBy}(${serverId}), time range: ${startTime} ~ ${endTime}`);

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

      console.log(`[Shift-Close] orders=${salesData.order_count}, total_sales=${salesData.total_sales}`);

      const paymentData = await dbGet(`
        SELECT 
          COALESCE(SUM(CASE WHEN UPPER(p.payment_method) != 'CASH' AND UPPER(p.payment_method) != 'NO_SHOW_FORFEITED' THEN (p.amount - COALESCE(p.tip, 0)) ELSE 0 END), 0) as card_sales,
          COALESCE(SUM(CASE WHEN UPPER(p.payment_method) NOT IN ('CASH', 'VISA', 'MC', 'MASTERCARD', 'DEBIT', 'OTHER_CARD', 'OTHER CARD', 'AMEX', 'DISCOVER', 'CARD', 'CREDIT', 'NO_SHOW_FORFEITED') THEN (p.amount - COALESCE(p.tip, 0)) ELSE 0 END), 0) as other_sales,
          COALESCE(SUM(CASE WHEN UPPER(p.payment_method) != 'NO_SHOW_FORFEITED' THEN COALESCE(p.tip, 0) ELSE 0 END), 0) as tip_total,
          COALESCE(SUM(CASE WHEN UPPER(p.payment_method) = 'CASH' THEN COALESCE(p.tip, 0) ELSE 0 END), 0) as cash_tips
        FROM payments p
        JOIN orders o ON p.order_id = o.id
        WHERE o.created_at >= ? AND o.created_at <= ?
          AND UPPER(o.status) IN ('PAID','PICKED_UP','CLOSED','COMPLETED')
          AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
      `, tf.params);

      // Channel sales (Sales by Type) — with tips
      const channelRows = await dbAll(`
        SELECT
          CASE
            WHEN UPPER(o.order_type) IN ('POS','DINE_IN','DINE-IN','TABLE_ORDER','FOR HERE','FORHERE') THEN 'DINE_IN'
            WHEN UPPER(o.order_type) IN ('TOGO','PICKUP','TAKEOUT') THEN 'TOGO'
            WHEN UPPER(o.order_type) IN ('ONLINE','WEB','QR') THEN 'ONLINE'
            WHEN UPPER(o.order_type) = 'DELIVERY' THEN 'DELIVERY'
            ELSE 'OTHER'
          END as ch,
          COUNT(DISTINCT o.id) as cnt,
          COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as sales,
          COALESCE(SUM(COALESCE(p.tip, 0)), 0) as tips
        FROM payments p
        JOIN orders o ON p.order_id = o.id
        WHERE o.created_at >= ? AND o.created_at <= ?
          AND UPPER(o.status) IN ('PAID','PICKED_UP','CLOSED','COMPLETED')
          AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
          AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
        GROUP BY ch
      `, tf.params);
      const chMap = {};
      (channelRows || []).forEach(r => { chMap[r.ch] = { sales: Number(r.sales), count: Number(r.cnt), tips: Number(r.tips) }; });

      // Payment method breakdown (amount, tips per method)
      const paymentBreakdownRows = await dbAll(`
        SELECT
          UPPER(COALESCE(p.payment_method, 'OTHER')) as method,
          COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as amount,
          COALESCE(SUM(COALESCE(p.tip, 0)), 0) as tips
        FROM payments p
        JOIN orders o ON p.order_id = o.id
        WHERE o.created_at >= ? AND o.created_at <= ?
          AND UPPER(o.status) IN ('PAID','PICKED_UP','CLOSED','COMPLETED')
          AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
          AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
        GROUP BY method
        ORDER BY amount DESC
      `, tf.params);
      const paymentBreakdown = (paymentBreakdownRows || []).map(r => ({
        method: r.method, amount: Number(r.amount), tips: Number(r.tips)
      }));

      // Tip breakdown by payment method
      const tipBreakdownRows = await dbAll(`
        SELECT
          UPPER(COALESCE(p.payment_method, 'OTHER')) as method,
          COALESCE(SUM(COALESCE(p.tip, 0)), 0) as tips
        FROM payments p
        JOIN orders o ON p.order_id = o.id
        WHERE o.created_at >= ? AND o.created_at <= ?
          AND UPPER(o.status) IN ('PAID','PICKED_UP','CLOSED','COMPLETED')
          AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
          AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
          AND COALESCE(p.tip, 0) > 0
        GROUP BY method
        ORDER BY tips DESC
      `, tf.params);
      const tipBreakdown = (tipBreakdownRows || []).map(r => ({
        method: r.method, tips: Number(r.tips)
      }));

      // CORRECT: Actual cash = Order totals - Non-cash payments (change excluded automatically)
      const totalOrderSales = salesData?.total_sales || 0;
      const nonCashNet = paymentData?.card_sales || 0;
      const actualCashSales = Math.max(0, totalOrderSales - nonCashNet);
      const cashTips = paymentData?.cash_tips || 0;

      // Opening cash for this shift
      const shiftOpeningCash = lastShift
        ? (lastShift.counted_cash > 0 ? lastShift.counted_cash : (lastShift.expected_cash || lastShift.counted_cash))
        : (activeSession.opening_cash || 0);
      let cashRefundTotal = 0;
      try {
        const crd = await dbGet(`SELECT COALESCE(SUM(total), 0) as t FROM refunds WHERE ${tf.where} AND UPPER(payment_method) = 'CASH'`, tf.params);
        cashRefundTotal = crd?.t || 0;
      } catch (e) { /* */ }
      const expectedCash = shiftOpeningCash + actualCashSales + cashTips - cashRefundTotal;
      const cashDifference = countedCash - expectedCash;

      // Save shift record with locked flag
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

      let serverTipTotal = null;
      if (closedBy) {
        const serverTipData = await dbGet(`
          SELECT COALESCE(SUM(COALESCE(p.tip, 0)), 0) as server_tips
          FROM payments p
          JOIN orders o ON p.order_id = o.id
          WHERE o.created_at >= ? AND o.created_at <= ?
            AND UPPER(o.status) IN ('PAID','PICKED_UP','CLOSED','COMPLETED')
            AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
            AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
            AND o.server_name = ?
        `, [startTime, endTime, closedBy]);
        serverTipTotal = Number(serverTipData?.server_tips || 0);
      }

      // Auto Clock-Out: reuse the server's PIN
      let clockOutResult = null;
      if (serverId && serverPin) {
        try {
          const today = now.substring(0, 10);
          const emp = await dbGet('SELECT id FROM employees WHERE id = ? AND pin = ? AND status = "active"', [serverId, serverPin]);
          if (emp) {
            const clockRec = await dbGet(
              'SELECT * FROM clock_records WHERE employee_id = ? AND date(clock_in_time) = ? AND clock_out_time IS NULL',
              [serverId, today]
            );
            if (clockRec) {
              const clockInTime = new Date(clockRec.clock_in_time);
              const totalHours = ((new Date(now)) - clockInTime) / (1000 * 60 * 60);
              await dbRun(`
                UPDATE clock_records SET clock_out_time = ?, total_hours = ?, status = 'clocked_out', updated_at = datetime('now')
                WHERE id = ?
              `, [now, totalHours.toFixed(2), clockRec.id]);
              await dbRun(`
                UPDATE server_shifts SET clock_out_time = ?, status = 'closed', updated_at = datetime('now')
                WHERE server_id = ? AND business_date = ? AND clock_record_id = ? AND status = 'open'
              `, [now, serverId, today, clockRec.id]);
              clockOutResult = { success: true, totalHours: totalHours.toFixed(2) };
              console.log(`[Shift-Close] Auto clock-out: ${closedBy}(${serverId}), hours=${totalHours.toFixed(2)}`);
            }
          }
        } catch (coErr) {
          console.error('[Shift-Close] Auto clock-out failed:', coErr.message);
          clockOutResult = { success: false, error: coErr.message };
        }
      }

      res.json({
        success: true,
        message: `Shift #${shiftNumber} closed successfully`,
        data: {
          ...shiftRecord,
          dine_in_sales: chMap['DINE_IN']?.sales || 0,
          dine_in_count: chMap['DINE_IN']?.count || 0,
          dine_in_tips: chMap['DINE_IN']?.tips || 0,
          togo_sales: chMap['TOGO']?.sales || 0,
          togo_count: chMap['TOGO']?.count || 0,
          togo_tips: chMap['TOGO']?.tips || 0,
          online_sales: chMap['ONLINE']?.sales || 0,
          online_count: chMap['ONLINE']?.count || 0,
          online_tips: chMap['ONLINE']?.tips || 0,
          delivery_sales: chMap['DELIVERY']?.sales || 0,
          delivery_count: chMap['DELIVERY']?.count || 0,
          delivery_tips: chMap['DELIVERY']?.tips || 0,
          payment_breakdown: paymentBreakdown,
          tip_breakdown: tipBreakdown,
          session_opened_at: activeSession.opened_at,
          server_tip_total: serverTipTotal,
          clock_out: clockOutResult
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

  // ============ PRINT OPENING REPORT (이미지 그래픽 출력) ============
  router.post('/print-opening', async (req, res) => {
    try {
      const { openingCash = 0, cashBreakdown = {} } = req.body;

      let printerOpts = {};
      try {
        const layoutRow = await dbGet('SELECT settings FROM printer_layout_settings WHERE id = 1');
        if (layoutRow && layoutRow.settings) {
          const ls = JSON.parse(layoutRow.settings);
          const pw = ls.billLayout?.paperWidth || ls.bill?.paperWidth || ls.paperWidth || 80;
          printerOpts.paperWidth = pw;
          const rp = ls.billLayout?.rightPaddingPx ?? ls.billLayout?.rightPadding ?? ls.bill?.rightPaddingPx ?? ls.bill?.rightPadding ?? ls.rightPaddingPx ?? ls.rightPadding ?? null;
          const rpn = Number(rp);
          if (Number.isFinite(rpn) && rpn >= 0) printerOpts.rightPaddingPx = rpn;
        }
      } catch (e) { /* layout settings may not exist */ }

      const frontPrinter = await dbGet("SELECT selected_printer, graphic_scale FROM printers WHERE name LIKE '%Front%' AND selected_printer IS NOT NULL LIMIT 1");
      let targetPrinter = frontPrinter?.selected_printer;
      if (frontPrinter?.graphic_scale) printerOpts.graphicScale = Number(frontPrinter.graphic_scale);
      if (!targetPrinter) {
        const anyPrinter = await dbGet(
          "SELECT selected_printer, graphic_scale FROM printers WHERE is_active = 1 AND selected_printer IS NOT NULL ORDER BY printer_id ASC LIMIT 1"
        );
        targetPrinter = anyPrinter?.selected_printer;
        if (anyPrinter?.graphic_scale) printerOpts.graphicScale = Number(anyPrinter.graphic_scale);
      }
      if (!targetPrinter) {
        return res.status(400).json({ success: false, error: 'No printer configured. Please set up the Front printer in Back Office → Printers.' });
      }

      const { buildGraphicOpeningReport } = require('../utils/graphicPrinterUtils');
      const buf = buildGraphicOpeningReport(openingCash, cashBreakdown, printerOpts);

      const { sendRawToPrinter } = require('../utils/printerUtils');
      await sendRawToPrinter(targetPrinter, buf);

      res.json({ success: true, message: 'Opening report printed', printer: targetPrinter });
    } catch (error) {
      console.error('Print opening error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============ PRINT SHIFT REPORT (이미지 그래픽 출력) ============
  router.post('/print-shift-report', async (req, res) => {
    try {
      const { shiftData = {} } = req.body;

      let printerOpts = {};
      try {
        const layoutRow = await dbGet('SELECT settings FROM printer_layout_settings WHERE id = 1');
        if (layoutRow && layoutRow.settings) {
          const ls = JSON.parse(layoutRow.settings);
          const pw = ls.billLayout?.paperWidth || ls.bill?.paperWidth || ls.paperWidth || 80;
          printerOpts.paperWidth = pw;
          const rp = ls.billLayout?.rightPaddingPx ?? ls.billLayout?.rightPadding ?? ls.bill?.rightPaddingPx ?? ls.bill?.rightPadding ?? ls.rightPaddingPx ?? ls.rightPadding ?? null;
          const rpn = Number(rp);
          if (Number.isFinite(rpn) && rpn >= 0) printerOpts.rightPaddingPx = rpn;
        }
      } catch (e) { /* layout settings may not exist */ }

      const frontPrinter = await dbGet("SELECT selected_printer, graphic_scale FROM printers WHERE name LIKE '%Front%' AND selected_printer IS NOT NULL LIMIT 1");
      let targetPrinter = frontPrinter?.selected_printer;
      if (frontPrinter?.graphic_scale) printerOpts.graphicScale = Number(frontPrinter.graphic_scale);
      if (!targetPrinter) {
        const anyPrinter = await dbGet(
          "SELECT selected_printer, graphic_scale FROM printers WHERE is_active = 1 AND selected_printer IS NOT NULL ORDER BY printer_id ASC LIMIT 1"
        );
        targetPrinter = anyPrinter?.selected_printer;
        if (anyPrinter?.graphic_scale) printerOpts.graphicScale = Number(anyPrinter.graphic_scale);
      }
      if (!targetPrinter) {
        return res.status(400).json({ success: false, error: 'No printer configured. Please set up the Front printer in Back Office → Printers.' });
      }

      console.log(`📃 [Shift-Report] printerOpts: paperWidth=${printerOpts.paperWidth}, rightPaddingPx=${printerOpts.rightPaddingPx}, graphicScale=${printerOpts.graphicScale}`);
      const { buildGraphicShiftReport } = require('../utils/graphicPrinterUtils');
      const buf = buildGraphicShiftReport(shiftData, printerOpts);

      const { sendRawToPrinter } = require('../utils/printerUtils');
      await sendRawToPrinter(targetPrinter, buf);

      res.json({ success: true, message: 'Shift report printed', printer: targetPrinter });
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

      // Read printer layout settings (paperWidth, rightPadding) same as Receipt/Bill
      let printerOpts = {};
      try {
        const layoutRow = await dbGet('SELECT settings FROM printer_layout_settings WHERE id = 1');
        if (layoutRow && layoutRow.settings) {
          const ls = JSON.parse(layoutRow.settings);
          const pw = ls.billLayout?.paperWidth || ls.bill?.paperWidth || ls.paperWidth || 80;
          printerOpts.paperWidth = pw;
          const rp = ls.billLayout?.rightPaddingPx ?? ls.billLayout?.rightPadding ?? ls.bill?.rightPaddingPx ?? ls.bill?.rightPadding ?? ls.rightPaddingPx ?? ls.rightPadding ?? null;
          const rpn = Number(rp);
          if (Number.isFinite(rpn) && rpn >= 0) printerOpts.rightPaddingPx = rpn;
        }
      } catch (e) { /* layout settings may not exist */ }

      // Read per-device graphicScale from printers table
      const frontPrinter = await dbGet("SELECT selected_printer, graphic_scale FROM printers WHERE name LIKE '%Front%' AND selected_printer IS NOT NULL LIMIT 1");
      let targetPrinter = frontPrinter?.selected_printer;
      if (frontPrinter?.graphic_scale) printerOpts.graphicScale = Number(frontPrinter.graphic_scale);
      if (!targetPrinter) {
        const anyPrinter = await dbGet(
          "SELECT selected_printer, graphic_scale FROM printers WHERE is_active = 1 AND selected_printer IS NOT NULL ORDER BY printer_id ASC LIMIT 1"
        );
        targetPrinter = anyPrinter?.selected_printer;
        if (anyPrinter?.graphic_scale) printerOpts.graphicScale = Number(anyPrinter.graphic_scale);
      }
      if (!targetPrinter) {
        return res.status(400).json({ success: false, error: 'No printer configured. Please set up the Front printer in Back Office → Printers.' });
      }

      console.log(`📃 [Z-Report] printerOpts: paperWidth=${printerOpts.paperWidth}, rightPaddingPx=${printerOpts.rightPaddingPx}, graphicScale=${printerOpts.graphicScale}`);
      const { buildGraphicZReport } = require('../utils/graphicPrinterUtils');
      const singleCopyBuffer = buildGraphicZReport(zReportData, closingCash, cashBreakdown, printerOpts);

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
      const dateFilterO = "date(o.created_at) >= ? AND date(o.created_at) <= ?";
      const dateFilter = "date(created_at) >= ? AND date(created_at) <= ?";

      // 1) Overall summary - Paid 주문만 (Subtotal + Tax + Tip = Total 정확히 일치)
      const paidOrders = await dbGet(`
        SELECT
          COUNT(*) as order_count,
          COALESCE(SUM(subtotal), 0) as subtotal,
          COALESCE(SUM(tax), 0) as tax_total,
          COALESCE(SUM(total), 0) as total,
          COALESCE(SUM(COALESCE(service_charge, 0)), 0) as service_charge_total
        FROM orders
        WHERE ${dateFilter} AND ${paidStatusesNoAlias}
      `, [startDate, endDate]);

      // 1a) Tip 합산 (payments.tip + tips 테이블 모두)
      const tipData = await dbGet(`
        SELECT COALESCE(
          (SELECT COALESCE(SUM(COALESCE(p.tip, 0)), 0) FROM payments p JOIN orders o ON p.order_id = o.id
           WHERE date(o.created_at) >= ? AND date(o.created_at) <= ?
             AND ${paidStatuses} AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID'))
          +
          (SELECT COALESCE(SUM(t.amount), 0) FROM tips t JOIN orders o ON t.order_id = o.id
           WHERE date(o.created_at) >= ? AND date(o.created_at) <= ?
             AND ${paidStatuses})
        , 0) as total_tip
      `, [startDate, endDate, startDate, endDate]);

      // 1a-2) Tip breakdown by server (payments.tip + tips table)
      const tipByServer = await dbAll(`
        SELECT server_name, SUM(tips) as tips, SUM(order_count) as order_count FROM (
          SELECT COALESCE(o.server_name, 'Unknown') as server_name,
            COALESCE(SUM(COALESCE(p.tip, 0)), 0) as tips,
            COUNT(DISTINCT o.id) as order_count
          FROM payments p JOIN orders o ON p.order_id = o.id
          WHERE date(o.created_at) >= ? AND date(o.created_at) <= ?
            AND ${paidStatuses} AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
          GROUP BY COALESCE(o.server_name, 'Unknown')
          UNION ALL
          SELECT COALESCE(o.server_name, 'Unknown') as server_name,
            COALESCE(SUM(t.amount), 0) as tips,
            COUNT(DISTINCT o.id) as order_count
          FROM tips t JOIN orders o ON t.order_id = o.id
          WHERE date(o.created_at) >= ? AND date(o.created_at) <= ?
            AND ${paidStatuses}
          GROUP BY COALESCE(o.server_name, 'Unknown')
        ) combined
        GROUP BY server_name
        HAVING tips > 0
        ORDER BY tips DESC
      `, [startDate, endDate, startDate, endDate]);

      // 1a-3) Tip breakdown by payment method (payments.tip + tips table)
      const tipByPaymentMethod = await dbAll(`
        SELECT payment_method, SUM(tips) as tips, SUM(cnt) as count FROM (
          SELECT p.payment_method, COALESCE(SUM(COALESCE(p.tip, 0)), 0) as tips, COUNT(*) as cnt
          FROM payments p JOIN orders o ON p.order_id = o.id
          WHERE date(o.created_at) >= ? AND date(o.created_at) <= ?
            AND ${paidStatuses} AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
            AND COALESCE(p.tip, 0) > 0
          GROUP BY p.payment_method
          UNION ALL
          SELECT t.payment_method, COALESCE(SUM(t.amount), 0) as tips, COUNT(*) as cnt
          FROM tips t JOIN orders o ON t.order_id = o.id
          WHERE date(o.created_at) >= ? AND date(o.created_at) <= ?
            AND ${paidStatuses}
          GROUP BY t.payment_method
        ) combined
        GROUP BY payment_method
        ORDER BY tips DESC
      `, [startDate, endDate, startDate, endDate]);

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
          JOIN taxes t ON t.tax_id = tgl.tax_id AND COALESCE(t.is_deleted, 0) = 0
          WHERE date(o.created_at) >= ? AND date(o.created_at) <= ?
            AND ${paidStatuses}
          GROUP BY t.tax_id, t.name, t.rate
          ORDER BY t.name
        `, [startDate, endDate]);
        taxDetails = (taxRows || []).filter(r => r.tax_name && Number(r.tax_amount) > 0).map(r => ({
          name: r.tax_name,
          rate: Number(r.tax_rate || 0),
          amount: Number(Number(r.tax_amount || 0).toFixed(2)),
        }));
      } catch (e) { /* tax_group_links may not exist */ }

      // Fallback: tax_group_id가 없거나 부분적으로만 있는 경우 orders.tax를 세금 비율로 분배
      const taxDetailSum = taxDetails.reduce((s, t) => s + t.amount, 0);
      const dbTaxTotal = Number(paidOrders?.tax_total || 0);
      const needsFallback = taxDetails.length === 0 || (dbTaxTotal > 0 && taxDetailSum < dbTaxTotal * 0.5);
      if (needsFallback) {
        try {
          const activeTaxes = await dbAll(`
            SELECT DISTINCT t.name, t.rate 
            FROM taxes t 
            JOIN tax_group_links tgl ON tgl.tax_id = t.tax_id
            JOIN tax_groups tg ON tg.tax_group_id = tgl.tax_group_id AND COALESCE(tg.is_deleted, 0) = 0
            WHERE COALESCE(t.is_deleted, 0) = 0
            ORDER BY t.rate ASC
          `, []);
          const uniqueTaxes = [];
          const seenRates = new Set();
          (activeTaxes || []).forEach(t => {
            const key = `${t.name}_${t.rate}`;
            if (!seenRates.has(key)) { seenRates.add(key); uniqueTaxes.push({ name: t.name, rate: Number(t.rate) }); }
          });

          if (uniqueTaxes.length > 0) {
            const orders = await dbAll(`
              SELECT o.subtotal, o.tax
              FROM orders o
              WHERE date(o.created_at) >= ? AND date(o.created_at) <= ?
                AND ${paidStatuses} AND COALESCE(o.tax, 0) > 0
            `, [startDate, endDate]);

            const taxMap = {};
            uniqueTaxes.forEach(t => { taxMap[t.name] = { name: t.name, rate: t.rate, amount: 0 }; });

            (orders || []).forEach(o => {
              const sub = Number(o.subtotal || 0);
              const totalTax = Number(o.tax || 0);
              if (sub <= 0 || totalTax <= 0) return;
              const effRate = (totalTax / sub) * 100;

              const matchedTaxes = uniqueTaxes.filter(t => t.rate <= effRate + 0.5);
              const matchedRateSum = matchedTaxes.reduce((s, t) => s + t.rate, 0);
              if (matchedRateSum <= 0) return;

              matchedTaxes.forEach(t => {
                const portion = (t.rate / matchedRateSum) * totalTax;
                taxMap[t.name].amount += portion;
              });
            });

            taxDetails = Object.values(taxMap)
              .filter(t => t.amount > 0.001)
              .map(t => ({ name: t.name, rate: t.rate, amount: Number(t.amount.toFixed(2)) }));
          }
        } catch (e) { /* taxes table may not exist */ }
      }

      const paidOrderCount = paidOrders?.order_count || 0;

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
          COALESCE(SUM(
            (SELECT COALESCE(SUM(p.tip), 0) FROM payments p WHERE p.order_id = o.id AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID'))
            + (SELECT COALESCE(SUM(t.amount), 0) FROM tips t WHERE t.order_id = o.id)
          ), 0) as tips
        FROM orders o
        WHERE ${dateFilterO} AND ${paidStatuses}
        GROUP BY ch ORDER BY sales DESC
      `, [startDate, endDate]);

      const channelMap = {};
      (channelRows || []).forEach(r => {
        const sub = Number(r.subtotal);
        const tx = Number(r.tax);
        channelMap[r.ch] = { count: r.cnt, subtotal: sub, tax: tx, sales: Number((sub + tx).toFixed(2)), tips: Number(r.tips) };
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
        WHERE date(o.created_at) >= ? AND date(o.created_at) <= ? AND ${paidStatuses}
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
        WHERE date(o.created_at) >= ? AND date(o.created_at) <= ? AND ${paidStatuses}
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
        WHERE date(o.created_at) >= ? AND date(o.created_at) <= ? AND ${paidStatuses}
          AND oi.name IS NOT NULL AND oi.name != ''
          AND COALESCE(oi.price, 0) >= 0
      `, [startDate, endDate]);

      // 6) Unpaid (OPEN) orders
      const unpaidStatuses = "UPPER(status) IN ('OPEN','PENDING','IN_PROGRESS','READY')";
      const unpaidOverall = await dbGet(`
        SELECT COUNT(*) as order_count,
               COALESCE(SUM(total),0) as total_amount,
               COALESCE(SUM(subtotal),0) as subtotal,
               COALESCE(SUM(tax),0) as tax_total
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

      // Unpaid individual tax breakdown
      let unpaidTaxDetails = [];
      try {
        const unpaidTaxRows = await dbAll(`
          SELECT t.name as tax_name,
            t.rate as tax_rate,
            COALESCE(SUM(oi.price * oi.quantity * t.rate / 100), 0) as tax_amount
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          JOIN tax_group_links tgl ON tgl.tax_group_id = oi.tax_group_id
          JOIN taxes t ON t.tax_id = tgl.tax_id AND COALESCE(t.is_deleted, 0) = 0
          WHERE date(o.created_at) >= ? AND date(o.created_at) <= ?
            AND ${unpaidStatuses}
          GROUP BY t.tax_id, t.name, t.rate
          ORDER BY t.name
        `, [startDate, endDate]);
        unpaidTaxDetails = (unpaidTaxRows || []).filter(r => r.tax_name && Number(r.tax_amount) > 0).map(r => ({
          name: r.tax_name,
          rate: Number(r.tax_rate || 0),
          amount: Number(Number(r.tax_amount || 0).toFixed(2)),
        }));
      } catch (e) { /* tax_group_links may not exist */ }

      if (unpaidTaxDetails.length === 0) {
        try {
          const activeTaxes = await dbAll(`
            SELECT DISTINCT t.name, t.rate 
            FROM taxes t 
            JOIN tax_group_links tgl ON tgl.tax_id = t.tax_id
            JOIN tax_groups tg ON tg.tax_group_id = tgl.tax_group_id AND COALESCE(tg.is_deleted, 0) = 0
            WHERE COALESCE(t.is_deleted, 0) = 0
            ORDER BY t.rate ASC
          `, []);
          const uniqueTaxes = [];
          const seenRates = new Set();
          (activeTaxes || []).forEach(t => {
            const key = `${t.name}_${t.rate}`;
            if (!seenRates.has(key)) { seenRates.add(key); uniqueTaxes.push({ name: t.name, rate: Number(t.rate) }); }
          });

          if (uniqueTaxes.length > 0) {
            const orders = await dbAll(`
              SELECT o.subtotal, o.tax
              FROM orders o
              WHERE date(o.created_at) >= ? AND date(o.created_at) <= ?
                AND ${unpaidStatuses} AND COALESCE(o.tax, 0) > 0
            `, [startDate, endDate]);

            const taxMap = {};
            uniqueTaxes.forEach(t => { taxMap[t.name] = { name: t.name, rate: t.rate, amount: 0 }; });

            (orders || []).forEach(o => {
              const sub = Number(o.subtotal || 0);
              const totalTax = Number(o.tax || 0);
              if (sub <= 0 || totalTax <= 0) return;
              const effRate = (totalTax / sub) * 100;
              const matchedTaxes = uniqueTaxes.filter(t => t.rate <= effRate + 0.5);
              const matchedRateSum = matchedTaxes.reduce((s, t) => s + t.rate, 0);
              if (matchedRateSum <= 0) return;
              matchedTaxes.forEach(t => {
                taxMap[t.name].amount += (t.rate / matchedRateSum) * totalTax;
              });
            });

            unpaidTaxDetails = Object.values(taxMap)
              .filter(t => t.amount > 0.001)
              .map(t => ({ name: t.name, rate: t.rate, amount: Number(t.amount.toFixed(2)) }));
          }
        } catch (e) { /* taxes table may not exist */ }
      }

      // 7) Hourly sales
      const hourlySales = await dbAll(`
        SELECT strftime('%H', o.created_at) as hour,
          COUNT(DISTINCT o.id) as order_count,
          COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as revenue
        FROM payments p
        JOIN orders o ON p.order_id = o.id
        WHERE date(o.created_at) >= ? AND date(o.created_at) <= ?
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
        WHERE date(o.created_at) >= ? AND date(o.created_at) <= ?
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
        WHERE date(o.created_at) >= ? AND date(o.created_at) <= ?
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
        WHERE date(o.created_at) >= ? AND date(o.created_at) <= ?
          AND ${paidStatuses}
          AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
          AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
        GROUP BY COALESCE(o.server_name, 'Unknown')
        ORDER BY revenue DESC
      `, [startDate, endDate]);

      // 11) Refunds & Voids
      const refundsVoids = await dbAll(`
        SELECT 'refund' as type, COUNT(*) as count, COALESCE(SUM(total), 0) as total
        FROM refunds WHERE date(created_at) >= ? AND date(created_at) <= ?
        UNION ALL
        SELECT 'void' as type, COUNT(*) as count, COALESCE(SUM(grand_total), 0) as total
        FROM voids WHERE date(created_at) >= ? AND date(created_at) <= ?
      `, [startDate, endDate, startDate, endDate]);

      // 12) Category Sales
      let categorySales = [];
      try {
        categorySales = await dbAll(`
          SELECT COALESCE(c.name, 'Uncategorized') as category,
            COALESCE(SUM(oi.quantity), 0) as quantity,
            COALESCE(SUM(oi.price * oi.quantity), 0) as revenue
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          LEFT JOIN menu_items mi ON oi.item_id = mi.item_id
          LEFT JOIN menu_categories c ON mi.category_id = c.category_id
          WHERE date(o.created_at) >= ? AND date(o.created_at) <= ?
            AND ${paidStatuses}
            AND COALESCE(oi.is_voided, 0) = 0
          GROUP BY c.category_id
          ORDER BY revenue DESC
        `, [startDate, endDate]);
      } catch (e) { /* menu_items/menu_categories may not exist */ }

      // 13) Per-channel tax breakdown
      let channelTaxDetails = {};
      try {
        const ctRows = await dbAll(`
          SELECT
            CASE
              WHEN UPPER(o.order_type) IN ('POS','DINE_IN','DINE-IN','TABLE_ORDER','FOR HERE','FORHERE','EAT IN','EATIN') THEN 'DINE-IN'
              WHEN UPPER(o.order_type) IN ('TOGO','TAKEOUT','TO GO','TO-GO','PICKUP') THEN 'TOGO'
              WHEN UPPER(o.order_type) = 'ONLINE' THEN 'ONLINE'
              WHEN UPPER(o.order_type) = 'DELIVERY' THEN 'DELIVERY'
              ELSE 'OTHER'
            END as ch,
            t.name as tax_name,
            t.rate as tax_rate,
            COALESCE(SUM(oi.price * oi.quantity * t.rate / 100), 0) as tax_amount
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          JOIN tax_group_links tgl ON tgl.tax_group_id = oi.tax_group_id
          JOIN taxes t ON t.tax_id = tgl.tax_id
          WHERE date(o.created_at) >= ? AND date(o.created_at) <= ?
            AND ${paidStatuses}
            AND COALESCE(oi.is_voided, 0) = 0
            AND COALESCE(t.is_deleted, 0) = 0
          GROUP BY ch, t.tax_id, t.name, t.rate
          ORDER BY ch, t.name
        `, [startDate, endDate]);
        (ctRows || []).forEach(r => {
          if (!channelTaxDetails[r.ch]) channelTaxDetails[r.ch] = [];
          channelTaxDetails[r.ch].push({ name: r.tax_name, rate: Number(r.tax_rate || 0), amount: Number(r.tax_amount || 0) });
        });
      } catch (e) { /* taxes/tax_group_links may not exist */ }

      res.json({
        success: true,
        period: { startDate, endDate },
        overall: {
          orderCount: paidOrderCount,
          subtotal: Number(paidOrders?.subtotal || 0),
          taxTotal: Number(paidOrders?.tax_total || 0),
          totalSales: Number((Number(paidOrders?.subtotal || 0) + Number(paidOrders?.tax_total || 0)).toFixed(2)),
          totalTip: Number(tipData?.total_tip || 0),
          serviceCharge: Number(paidOrders?.service_charge_total || 0),
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
          totalAmount: Number((Number(unpaidOverall?.subtotal || 0) + Number(unpaidOverall?.tax_total || 0)).toFixed(2)),
          subtotal: Number(unpaidOverall?.subtotal || 0),
          taxTotal: Number(unpaidOverall?.tax_total || 0),
          taxDetails: unpaidTaxDetails,
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
        tipBreakdown: {
          total: Number(tipData?.total_tip || 0),
          byServer: (tipByServer || []).map(r => ({ server: r.server_name, tips: Number(r.tips), orderCount: r.order_count })),
          byChannel: Object.entries(channelMap).filter(([, v]) => v.tips > 0).map(([k, v]) => ({ channel: k, tips: v.tips, orderCount: v.count })),
          byPaymentMethod: (tipByPaymentMethod || []).map(r => ({ method: r.payment_method, tips: Number(r.tips), count: r.count })),
        },
        categorySales: (categorySales || []).map(r => ({ category: r.category, quantity: r.quantity || 0, revenue: Number(r.revenue || 0) })),
        channelTaxDetails,
      });
    } catch (error) {
      console.error('Sales report error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================================
  // Item Trend Data - top/bottom items across time periods
  // ============================================================
  router.get('/item-trend', async (req, res) => {
    try {
      const { type = 'top' } = req.query;
      const today = new Date();
      const f = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const todayStr = f(today);

      const d7 = new Date(today); d7.setDate(d7.getDate() - 7);
      const d30 = new Date(today); d30.setDate(d30.getDate() - 30);
      const d180 = new Date(today); d180.setDate(d180.getDate() - 180);
      const d365 = new Date(today); d365.setDate(d365.getDate() - 365);

      const periods = [
        { label: 'Today', start: todayStr, end: todayStr },
        { label: 'Last 7d', start: f(d7), end: todayStr },
        { label: 'Last 30d', start: f(d30), end: todayStr },
        { label: 'Last 6mo', start: f(d180), end: todayStr },
        { label: 'Last 1yr', start: f(d365), end: todayStr },
      ];

      const paidStatuses = `UPPER(o.status) IN ('PAID','COMPLETED','CLOSED','SETTLED')`;

      const topItems = await dbAll(`
        SELECT oi.item_id, COALESCE(oi.name, 'Unknown') as name,
          COALESCE(SUM(oi.quantity), 0) as qty,
          COALESCE(SUM(oi.price * oi.quantity), 0) as revenue
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE date(o.created_at) >= ? AND date(o.created_at) <= ?
          AND ${paidStatuses} AND COALESCE(oi.is_voided, 0) = 0
        GROUP BY oi.item_id
        ORDER BY ${type === 'bottom' ? 'revenue ASC' : 'revenue DESC'}
        LIMIT 15
      `, [f(d365), todayStr]);

      const itemIds = topItems.map(i => i.item_id);
      if (itemIds.length === 0) {
        return res.json({ success: true, items: [], periods: periods.map(p => p.label) });
      }

      const placeholders = itemIds.map(() => '?').join(',');
      const trendData = {};

      for (const p of periods) {
        const rows = await dbAll(`
          SELECT oi.item_id,
            COALESCE(SUM(oi.quantity), 0) as qty,
            COALESCE(SUM(oi.price * oi.quantity), 0) as revenue
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          WHERE oi.item_id IN (${placeholders})
            AND date(o.created_at) >= ? AND date(o.created_at) <= ?
            AND ${paidStatuses} AND COALESCE(oi.is_voided, 0) = 0
          GROUP BY oi.item_id
        `, [...itemIds, p.start, p.end]);

        const rowMap = {};
        (rows || []).forEach(r => { rowMap[r.item_id] = r; });
        trendData[p.label] = rowMap;
      }

      const items = topItems.map(item => ({
        item_id: item.item_id,
        name: item.name,
        trend: periods.map(p => ({
          period: p.label,
          qty: Number(trendData[p.label]?.[item.item_id]?.qty || 0),
          revenue: Number(trendData[p.label]?.[item.item_id]?.revenue || 0),
        }))
      }));

      res.json({ success: true, items, periods: periods.map(p => p.label) });
    } catch (error) {
      console.error('Item trend error:', error);
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
        const selectServerOnEntry = await getSelectServerOnEntry();
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
            tips_by_server: q.tipsByServer || [],
            select_server_on_entry: selectServerOnEntry,
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
            refund_details: (q.refundDetails || []).map(r => ({
              id: r.id, order_id: r.order_id,
              order_number: r.original_order_number || r.order_number || `#${r.order_id}`,
              type: r.refund_type || 'FULL', total: r.total || 0,
              payment_method: r.payment_method || '', reason: r.reason || '', refunded_by: r.refunded_by || '', created_at: r.created_at
            })),
            void_details: (q.voidDetails || []).map(v => ({
              id: v.id, order_id: v.order_id,
              order_number: v.order_number || `#${v.order_id}`,
              total: v.grand_total || 0, source: v.source || 'partial',
              reason: v.reason || '', created_by: v.created_by || '', created_at: v.created_at
            })),
            discount_details: (q.discountDetails || []).map(d => ({
              id: d.id,
              order_id: d.order_id,
              order_number: d.order_number || `#${d.order_id}`,
              kind: d.kind || '',
              amount_applied: d.amount_applied || 0,
              label: d.label || '',
              applied_by_employee_id: d.applied_by_employee_id || '',
              applied_by_name: d.applied_by_name || '',
              created_at: d.created_at
            })),
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
      const dateFilter = "date(o.created_at) >= ? AND date(o.created_at) <= ?";
      const eventDateFilter = "date(created_at) >= ? AND date(created_at) <= ?";

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
          date(o.created_at) as sale_date,
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

      // 5) Category Sales
      let categorySales = [];
      try {
        categorySales = await dbAll(`
          SELECT COALESCE(c.name, 'Uncategorized') as category,
            COALESCE(SUM(oi.quantity), 0) as quantity,
            COALESCE(SUM(oi.price * oi.quantity), 0) as revenue
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          LEFT JOIN menu_items mi ON oi.item_id = mi.item_id
          LEFT JOIN menu_categories c ON mi.category_id = c.category_id
          WHERE ${dateFilter} AND ${paidStatuses}
            AND COALESCE(oi.is_voided, 0) = 0
          GROUP BY c.category_id
          ORDER BY revenue DESC
        `, [startDate, endDate]);
      } catch (e) { /* tables may not exist */ }

      // 6) Hourly sales (for print output)
      let hourlySales = [];
      try {
        hourlySales = await dbAll(`
          SELECT strftime('%H', o.created_at) as hour,
            COUNT(*) as order_count,
            COALESCE(SUM(o.subtotal + o.tax), 0) as revenue
          FROM orders o
          WHERE ${dateFilter} AND ${paidStatuses}
          GROUP BY hour ORDER BY hour
        `, [startDate, endDate]);
      } catch (e) { /* ignore */ }

      // 7) Table turnover (for print output)
      let tableTurnover = [];
      try {
        tableTurnover = await dbAll(`
          SELECT COALESCE(t.name, o.table_id) as table_name,
            COUNT(*) as order_count,
            AVG((julianday(COALESCE(o.closed_at, o.updated_at)) - julianday(o.created_at)) * 1440) as avg_duration_min
          FROM orders o
          LEFT JOIN table_map_elements t ON o.table_id = t.element_id
          WHERE ${dateFilter} AND ${paidStatuses}
            AND o.table_id IS NOT NULL AND o.table_id != ''
          GROUP BY o.table_id ORDER BY order_count DESC
        `, [startDate, endDate]);
      } catch (e) { /* ignore */ }

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
        categorySales: (categorySales || []).map(r => ({ category: r.category, quantity: r.quantity || 0, revenue: Number(r.revenue || 0) })),
        hourlySales: (hourlySales || []).map(h => ({ hour: h.hour, order_count: h.order_count, revenue: Number(h.revenue || 0) })),
        tableTurnover: (tableTurnover || []).map(t => ({ table_name: t.table_name, order_count: t.order_count, avg_duration_min: Number(t.avg_duration_min || 0) })),
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

      let printerOpts = {};
      try {
        const layoutRow = await dbGet('SELECT settings FROM printer_layout_settings WHERE id = 1');
        if (layoutRow && layoutRow.settings) {
          const ls = JSON.parse(layoutRow.settings);
          const pw = ls.billLayout?.paperWidth || ls.bill?.paperWidth || ls.paperWidth || 80;
          printerOpts.paperWidth = pw;
          const rp = ls.billLayout?.rightPaddingPx ?? ls.billLayout?.rightPadding ?? ls.bill?.rightPaddingPx ?? ls.bill?.rightPadding ?? ls.rightPaddingPx ?? ls.rightPadding ?? null;
          const rpn = Number(rp);
          if (Number.isFinite(rpn) && rpn >= 0) printerOpts.rightPaddingPx = rpn;
        }
      } catch (e) { /* layout settings may not exist */ }

      const frontPrinter = await dbGet("SELECT selected_printer, graphic_scale FROM printers WHERE name LIKE '%Front%' AND selected_printer IS NOT NULL LIMIT 1");
      let targetPrinter = frontPrinter?.selected_printer;
      if (frontPrinter?.graphic_scale) printerOpts.graphicScale = Number(frontPrinter.graphic_scale);
      if (!targetPrinter) {
        const anyPrinter = await dbGet(
          "SELECT selected_printer, graphic_scale FROM printers WHERE is_active = 1 AND selected_printer IS NOT NULL ORDER BY printer_id ASC LIMIT 1"
        );
        targetPrinter = anyPrinter?.selected_printer;
        if (anyPrinter?.graphic_scale) printerOpts.graphicScale = Number(anyPrinter.graphic_scale);
      }
      if (!targetPrinter) {
        return res.status(400).json({ success: false, error: 'No printer configured. Please set up the Front printer in Back Office → Printers.' });
      }

      const { buildGraphicItemReport } = require('../utils/graphicPrinterUtils');
      const singleCopyBuffer = buildGraphicItemReport(reportData, printerOpts);

      const { sendRawToPrinter } = require('../utils/printerUtils');
      const fullBuffer = copies > 1 ? Buffer.concat(Array(copies).fill(singleCopyBuffer)) : singleCopyBuffer;
      await sendRawToPrinter(targetPrinter, fullBuffer);

      res.json({ success: true, message: `Item Report printed (${copies} copies)`, printer: targetPrinter, copies });
    } catch (error) {
      console.error('Print Item Report error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================================
  // Print Report Dashboard (sales-report payload) — graphic receipt
  // ============================================================
  router.post('/print-sales-report', async (req, res) => {
    try {
      const { reportData, copies: rawCopies = 1 } = req.body;
      if (!reportData) return res.status(400).json({ success: false, error: 'reportData is required' });
      const copies = Math.max(1, Math.min(5, parseInt(rawCopies) || 1));

      let printerOpts = {};
      try {
        const layoutRow = await dbGet('SELECT settings FROM printer_layout_settings WHERE id = 1');
        if (layoutRow && layoutRow.settings) {
          const ls = JSON.parse(layoutRow.settings);
          const pw = ls.billLayout?.paperWidth || ls.bill?.paperWidth || ls.paperWidth || 80;
          printerOpts.paperWidth = pw;
          const rp = ls.billLayout?.rightPaddingPx ?? ls.billLayout?.rightPadding ?? ls.bill?.rightPaddingPx ?? ls.bill?.rightPadding ?? ls.rightPaddingPx ?? ls.rightPadding ?? null;
          const rpn = Number(rp);
          if (Number.isFinite(rpn) && rpn >= 0) printerOpts.rightPaddingPx = rpn;
        }
      } catch (e) { /* layout settings may not exist */ }

      const frontPrinter = await dbGet("SELECT selected_printer, graphic_scale FROM printers WHERE name LIKE '%Front%' AND selected_printer IS NOT NULL LIMIT 1");
      let targetPrinter = frontPrinter?.selected_printer;
      if (frontPrinter?.graphic_scale) printerOpts.graphicScale = Number(frontPrinter.graphic_scale);
      if (!targetPrinter) {
        const anyPrinter = await dbGet(
          "SELECT selected_printer, graphic_scale FROM printers WHERE is_active = 1 AND selected_printer IS NOT NULL ORDER BY printer_id ASC LIMIT 1"
        );
        targetPrinter = anyPrinter?.selected_printer;
        if (anyPrinter?.graphic_scale) printerOpts.graphicScale = Number(anyPrinter.graphic_scale);
      }
      if (!targetPrinter) {
        return res.status(400).json({ success: false, error: 'No printer configured. Please set up the Front printer in Back Office → Printers.' });
      }

      const { buildGraphicSalesReport } = require('../utils/graphicPrinterUtils');
      const singleCopyBuffer = buildGraphicSalesReport(reportData, printerOpts);

      const { sendRawToPrinter } = require('../utils/printerUtils');
      const fullBuffer = copies > 1 ? Buffer.concat(Array(copies).fill(singleCopyBuffer)) : singleCopyBuffer;
      await sendRawToPrinter(targetPrinter, fullBuffer);

      res.json({ success: true, message: `Report Dashboard printed (${copies} copies)`, printer: targetPrinter, copies });
    } catch (error) {
      console.error('Print sales report error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
};
