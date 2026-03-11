const express = require('express');
const router = express.Router();

const { dbRun, dbAll, dbGet } = require('../db');

const fmtLocalBusinessDate = (d = new Date()) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const paidOrderStatusesSql = `UPPER(o.status) IN ('PAID','PICKED_UP','CLOSED','COMPLETED')`;
const isDeliveryOrOnlineSql = `UPPER(COALESCE(o.order_type,'')) IN ('DELIVERY','ONLINE')`;

const writeAudit = async ({
  userId,
  role,
  actionType,
  referenceId,
  beforeValue,
  afterValue,
}) => {
  const ts = new Date().toISOString();
  try {
    await dbRun(
      `INSERT INTO audit_log (user_id, role, action_type, reference_id, before_value, after_value, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId || null,
        role || null,
        String(actionType || ''),
        referenceId || null,
        beforeValue ? JSON.stringify(beforeValue) : null,
        afterValue ? JSON.stringify(afterValue) : null,
        ts,
      ]
    );
  } catch (e) {
    // non-blocking
    console.error('[audit_log] insert failed:', e.message);
  }
};

const getActiveShift = async (serverId, businessDate) => {
  return await dbGet(
    `SELECT * FROM server_shifts
     WHERE server_id = ? AND business_date = ? AND status IN ('open','locked')
     ORDER BY shift_id DESC LIMIT 1`,
    [serverId, businessDate]
  );
};

// ============================================================
// Server Sales Summary (by server_id) for a business date
// - Used for printing "server sales" (tip payout support)
// - Tips: cash + card (delivery/online excluded, same as settlement logic)
// ============================================================
const calcServerDaySummary = async ({ serverId, businessDate }) => {
  const dayFilter = `date(o.created_at,'localtime') = ?`;
  const baseWhere = `${dayFilter} AND ${paidOrderStatusesSql} AND COALESCE(o.server_id,'') = ?`;

  // Payments-based gross sales (actual revenue collected)
  const sales = await dbGet(
    `
    SELECT
      COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as gross_sales,
      COUNT(DISTINCT o.id) as order_count
    FROM payments p
    JOIN orders o ON p.order_id = o.id
    WHERE ${dayFilter} AND ${paidOrderStatusesSql} AND COALESCE(o.server_id,'') = ?
      AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
      AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
    `,
    [businessDate, serverId]
  );

  const paymentRows = await dbAll(
    `
    SELECT
      UPPER(COALESCE(p.payment_method,'OTHER')) as payment_type,
      COALESCE(SUM(CASE WHEN ${isDeliveryOrOnlineSql} THEN 0 ELSE COALESCE(p.tip,0) END),0) as tip_amount
    FROM payments p
    JOIN orders o ON p.order_id = o.id
    WHERE ${dayFilter}
      AND ${paidOrderStatusesSql}
      AND COALESCE(o.server_id,'') = ?
      AND UPPER(COALESCE(p.status,'APPROVED')) IN ('APPROVED','COMPLETED','SETTLED','PAID')
    GROUP BY payment_type
    `,
    [businessDate, serverId]
  );

  const tipRows = await dbAll(
    `
    SELECT
      UPPER(COALESCE(t.payment_method,'OTHER')) as payment_type,
      COALESCE(SUM(CASE WHEN ${isDeliveryOrOnlineSql} THEN 0 ELSE t.amount END),0) as tip_amount
    FROM tips t
    JOIN orders o ON t.order_id = o.id
    WHERE ${dayFilter}
      AND ${paidOrderStatusesSql}
      AND COALESCE(o.server_id,'') = ?
    GROUP BY payment_type
    `,
    [businessDate, serverId]
  );

  const pm = new Map();
  (paymentRows || []).forEach((r) => {
    pm.set(r.payment_type, {
      paymentType: r.payment_type,
      tipAmount: Number(r.tip_amount || 0),
    });
  });
  (tipRows || []).forEach((tr) => {
    const key = tr.payment_type;
    const existing = pm.get(key);
    if (existing) {
      existing.tipAmount = Number((existing.tipAmount || 0) + Number(tr.tip_amount || 0));
    } else {
      pm.set(key, { paymentType: key, tipAmount: Number(tr.tip_amount || 0) });
    }
  });
  const tips = Array.from(pm.values());

  const cashTips = tips
    .filter((x) => String(x.paymentType).toUpperCase() === 'CASH')
    .reduce((s, x) => s + (x.tipAmount || 0), 0);
  const cardTips = tips
    .filter((x) => String(x.paymentType).toUpperCase() !== 'CASH')
    .reduce((s, x) => s + (x.tipAmount || 0), 0);

  return {
    serverId,
    orderCount: Number(sales?.order_count || 0),
    grossSales: Number(sales?.gross_sales || 0),
    cashTips: Number(cashTips || 0),
    cardTips: Number(cardTips || 0),
    totalTip: Number((cashTips + cardTips) || 0),
  };
};

const calcSettlement = async ({ serverId, shiftId, businessDate }) => {
  // Orders scoped to server + business day (localtime)
  const dayFilter = `date(o.created_at,'localtime') = ?`;
  const baseWhere = `${dayFilter} AND ${paidOrderStatusesSql} AND COALESCE(o.server_id,'') = ?`;

  // A) Sales summary - payments 기반
  const salesPayments = await dbGet(
    `
    SELECT
      COALESCE(SUM(p.amount - COALESCE(p.tip, 0)), 0) as gross_sales,
      COUNT(DISTINCT o.id) as order_count
    FROM payments p
    JOIN orders o ON p.order_id = o.id
    WHERE ${baseWhere}
      AND UPPER(p.status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
      AND UPPER(COALESCE(p.payment_method, '')) != 'NO_SHOW_FORFEITED'
    `,
    [businessDate, serverId]
  );
  const salesOrders = await dbGet(
    `
    SELECT
      COALESCE(SUM(o.subtotal),0) as subtotal,
      COALESCE(SUM(o.tax),0) as tax_total
    FROM orders o
    WHERE ${baseWhere}
    `,
    [businessDate, serverId]
  );
  const sales = {
    gross_sales: salesPayments?.gross_sales || 0,
    order_count: salesPayments?.order_count || 0,
    subtotal: salesOrders?.subtotal || 0,
    tax_total: salesOrders?.tax_total || 0,
  };

  // Discounts (reuse daily-closings logic shape; scope to server)
  const adjSumRow = await dbGet(
    `
    SELECT COALESCE(SUM(oa.amount_applied), 0) as discount_total
    FROM order_adjustments oa
    JOIN orders o ON oa.order_id = o.id
    WHERE ${dayFilter}
      AND ${paidOrderStatusesSql}
      AND COALESCE(o.server_id,'') = ?
      AND COALESCE(oa.amount_applied, 0) > 0
      AND UPPER(COALESCE(oa.kind, '')) IN ('DISCOUNT', 'PROMOTION', 'CHANNEL_DISCOUNT', 'COUPON')
    `,
    [businessDate, serverId]
  );
  const jsonAdjSumRow = await dbGet(
    `
    SELECT COALESCE(SUM(
      CASE
        WHEN o.adjustments_json IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM order_adjustments oa WHERE oa.order_id = o.id)
        THEN (SELECT COALESCE(SUM(json_extract(value, '$.amountApplied')), 0) FROM json_each(o.adjustments_json))
        ELSE 0
      END
    ), 0) as discount_total
    FROM orders o
    WHERE ${dayFilter} AND ${paidOrderStatusesSql} AND COALESCE(o.server_id,'') = ?
    `,
    [businessDate, serverId]
  );
  const discountTotal = Number(
    (Number(adjSumRow?.discount_total || 0) + Number(jsonAdjSumRow?.discount_total || 0)).toFixed(2)
  );

  // Voids (join orders to attribute to server)
  let voidTotal = 0;
  try {
    const v = await dbGet(
      `
      SELECT COALESCE(SUM(v.grand_total),0) as void_total
      FROM voids v
      JOIN orders o ON v.order_id = o.id
      WHERE date(v.created_at,'localtime') = ?
        AND COALESCE(o.server_id,'') = ?
      `,
      [businessDate, serverId]
    );
    voidTotal = Number(v?.void_total || 0);
  } catch {
    voidTotal = 0;
  }

  // Refunds (join orders to attribute to server)
  let refundTotal = 0;
  let cashRefundTotal = 0;
  try {
    const r = await dbGet(
      `
      SELECT COALESCE(SUM(r.total),0) as refund_total
      FROM refunds r
      JOIN orders o ON r.order_id = o.id
      WHERE date(r.created_at,'localtime') = ?
        AND COALESCE(o.server_id,'') = ?
        AND UPPER(COALESCE(r.status,'COMPLETED')) IN ('COMPLETED','APPROVED','SETTLED','PAID')
      `,
      [businessDate, serverId]
    );
    refundTotal = Number(r?.refund_total || 0);
    const cr = await dbGet(
      `
      SELECT COALESCE(SUM(r.total),0) as cash_refund_total
      FROM refunds r
      JOIN orders o ON r.order_id = o.id
      WHERE date(r.created_at,'localtime') = ?
        AND COALESCE(o.server_id,'') = ?
        AND UPPER(COALESCE(r.payment_method,'')) = 'CASH'
        AND UPPER(COALESCE(r.status,'COMPLETED')) IN ('COMPLETED','APPROVED','SETTLED','PAID')
      `,
      [businessDate, serverId]
    );
    cashRefundTotal = Number(cr?.cash_refund_total || 0);
  } catch {
    refundTotal = 0;
    cashRefundTotal = 0;
  }

  // B) Payment breakdown (exclude delivery/online tips from server settlement)
  const paymentRows = await dbAll(
    `
    SELECT
      UPPER(COALESCE(p.payment_method,'OTHER')) as payment_type,
      COALESCE(SUM(CASE WHEN ${isDeliveryOrOnlineSql} THEN 0 ELSE (p.amount - COALESCE(p.tip,0)) END),0) as sales_amount,
      COALESCE(SUM(CASE WHEN ${isDeliveryOrOnlineSql} THEN 0 ELSE COALESCE(p.tip,0) END),0) as tip_amount,
      COALESCE(SUM(CASE WHEN ${isDeliveryOrOnlineSql} THEN 0 ELSE 0 END),0) as _noop
    FROM payments p
    JOIN orders o ON p.order_id = o.id
    WHERE ${dayFilter}
      AND ${paidOrderStatusesSql}
      AND COALESCE(o.server_id,'') = ?
      AND UPPER(COALESCE(p.status,'APPROVED')) IN ('APPROVED','COMPLETED','SETTLED','PAID')
    GROUP BY payment_type
    ORDER BY sales_amount DESC
    `,
    [businessDate, serverId]
  );

  // Tips table (more accurate; still exclude delivery/online)
  const tipRows = await dbAll(
    `
    SELECT
      UPPER(COALESCE(t.payment_method,'OTHER')) as payment_type,
      COALESCE(SUM(CASE WHEN ${isDeliveryOrOnlineSql} THEN 0 ELSE t.amount END),0) as tip_amount
    FROM tips t
    JOIN orders o ON t.order_id = o.id
    WHERE ${dayFilter}
      AND ${paidOrderStatusesSql}
      AND COALESCE(o.server_id,'') = ?
    GROUP BY payment_type
    `,
    [businessDate, serverId]
  );

  const pm = new Map();
  (paymentRows || []).forEach((r) => {
    pm.set(r.payment_type, {
      paymentType: r.payment_type,
      salesAmount: Number(r.sales_amount || 0),
      tipAmount: Number(r.tip_amount || 0),
    });
  });
  (tipRows || []).forEach((tr) => {
    const key = tr.payment_type;
    const existing = pm.get(key);
    if (existing) {
      existing.tipAmount = Number((existing.tipAmount || 0) + Number(tr.tip_amount || 0));
    } else {
      pm.set(key, { paymentType: key, salesAmount: 0, tipAmount: Number(tr.tip_amount || 0) });
    }
  });
  const payments = Array.from(pm.values());

  const totalCashSales = payments
    .filter((x) => String(x.paymentType).toUpperCase() === 'CASH')
    .reduce((s, x) => s + (x.salesAmount || 0), 0);
  const totalCardSales = payments
    .filter((x) => !['CASH'].includes(String(x.paymentType).toUpperCase()))
    .reduce((s, x) => s + (x.salesAmount || 0), 0);
  const totalOtherSales = 0; // reserved (we keep card vs other split later if needed)

  const cashTips = payments
    .filter((x) => String(x.paymentType).toUpperCase() === 'CASH')
    .reduce((s, x) => s + (x.tipAmount || 0), 0);
  const cardTips = payments
    .filter((x) => String(x.paymentType).toUpperCase() !== 'CASH')
    .reduce((s, x) => s + (x.tipAmount || 0), 0);
  const totalTip = cashTips + cardTips;

  // Safe drops
  const safeDropRow = await dbGet(
    `SELECT COALESCE(SUM(amount),0) as safe_drop_total
     FROM server_cash_drops
     WHERE shift_id = ? AND COALESCE(server_id,'') = ?`,
    [shiftId, serverId]
  );
  const safeDropTotal = Number(safeDropRow?.safe_drop_total || 0);

  // Paid outs (not implemented yet; keep 0 but trackable in schema)
  const paidOutTotal = 0;

  // Expected cash
  const expectedCash = Number((totalCashSales + cashTips - cashRefundTotal - paidOutTotal - safeDropTotal).toFixed(2));

  const grossSales = Number(sales?.gross_sales || 0);
  const taxTotal = Number(sales?.tax_total || 0);
  const netSales = Number((grossSales - taxTotal - discountTotal).toFixed(2));

  return {
    salesSummary: {
      orderCount: Number(sales?.order_count || 0),
      grossSales,
      netSales,
      taxTotal,
      discountTotal,
      voidTotal,
      refundTotal,
    },
    paymentBreakdown: payments,
    tipSummary: {
      cashTips,
      cardTips,
      totalTip,
    },
    cash: {
      totalCashSales,
      cashRefundTotal,
      safeDropTotal,
      paidOutTotal,
      expectedCash,
    },
  };
};

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

// ============================================================
// Print a server settlement (latest by default)
// ============================================================
router.post('/print', async (req, res) => {
  try {
    const { settlement_id, server_id, business_date, copies: rawCopies } = req.body || {};
    const copies = Math.max(1, Math.min(5, parseInt(rawCopies) || 1));
    const serverId = String(server_id || '').trim();
    const businessDate = String(business_date || fmtLocalBusinessDate()).trim();
    const settlementId = settlement_id ? Number(settlement_id) : null;

    let settlement;
    if (settlementId) {
      settlement = await dbGet(`SELECT * FROM server_settlements WHERE settlement_id = ?`, [settlementId]);
    } else {
      if (!serverId) return res.status(400).json({ success: false, error: 'server_id is required when settlement_id is omitted' });
      settlement = await dbGet(
        `SELECT * FROM server_settlements
         WHERE server_id = ? AND business_date = ? AND status = 'active'
         ORDER BY settlement_id DESC LIMIT 1`,
        [serverId, businessDate]
      );
    }
    if (!settlement) return res.status(404).json({ success: false, error: 'Settlement not found' });

    const payments = await dbAll(
      `SELECT payment_type, sales_amount, tip_amount
       FROM settlement_payments
       WHERE settlement_id = ?
       ORDER BY sales_amount DESC`,
      [settlement.settlement_id]
    );

    // server name (best-effort)
    let serverName = '';
    try {
      const emp = await dbGet(`SELECT name FROM employees WHERE id = ?`, [settlement.server_id]);
      serverName = emp?.name || '';
    } catch {}

    const LINE_WIDTH = 42;
    const line = '='.repeat(LINE_WIDTH);
    const dotted = '-'.repeat(LINE_WIDTH);
    const center = (t) => {
      const s = String(t || '');
      const pad = Math.max(0, Math.floor((LINE_WIDTH - s.length) / 2));
      return ' '.repeat(pad) + s;
    };
    const lr = (l, r) => {
      const L = String(l || '');
      const R = String(r || '');
      const spaces = Math.max(1, LINE_WIDTH - L.length - R.length);
      return L + ' '.repeat(spaces) + R;
    };
    const fmtMoney = (amt) => `$${(Number(amt || 0)).toFixed(2)}`;

    const s = settlement;
    let p = '\n' + line + '\n';
    p += center('SERVER MID-SHIFT SETTLEMENT') + '\n';
    p += line + '\n';
    p += lr('Business Date:', s.business_date) + '\n';
    p += lr('Server:', serverName ? `${serverName} (${s.server_id})` : String(s.server_id)) + '\n';
    p += lr('Shift ID:', String(s.shift_id)) + '\n';
    p += lr('Settlement:', String(s.settlement_time).replace('T', ' ').substring(0, 19)) + '\n';
    p += dotted + '\n';

    p += center('-- SALES SUMMARY --') + '\n';
    p += dotted + '\n';
    p += lr('Gross Sales:', fmtMoney(s.gross_sales)) + '\n';
    p += lr('Net Sales:', fmtMoney(s.net_sales)) + '\n';
    p += lr('Tax:', fmtMoney(s.tax_total)) + '\n';
    if (Number(s.discount_total || 0) > 0) p += lr('Discount:', `-${fmtMoney(s.discount_total)}`) + '\n';
    if (Number(s.void_total || 0) > 0) p += lr('Void:', `-${fmtMoney(s.void_total)}`) + '\n';
    if (Number(s.refund_total || 0) > 0) p += lr('Refund:', `-${fmtMoney(s.refund_total)}`) + '\n';
    p += dotted + '\n';

    p += center('-- PAYMENTS --') + '\n';
    p += dotted + '\n';
    (payments || []).forEach((pm) => {
      p += lr(`${pm.payment_type}:`, fmtMoney(pm.sales_amount)) + '\n';
      if (Number(pm.tip_amount || 0) > 0) p += lr('  Tips:', fmtMoney(pm.tip_amount)) + '\n';
    });
    p += dotted + '\n';

    p += center('-- CASH RESPONSIBILITY --') + '\n';
    p += dotted + '\n';
    p += lr('Cash Sales:', fmtMoney(s.total_cash_sales)) + '\n';
    p += lr('Cash Tips:', fmtMoney(s.cash_tips)) + '\n';
    if (Number(s.cash_refund_total || 0) > 0) p += lr('Cash Refunds:', `-${fmtMoney(s.cash_refund_total)}`) + '\n';
    if (Number(s.safe_drop_total || 0) > 0) p += lr('Safe Drops:', `-${fmtMoney(s.safe_drop_total)}`) + '\n';
    p += dotted + '\n';
    p += lr('Expected Cash:', fmtMoney(s.expected_cash)) + '\n';
    p += lr('Actual Cash:', fmtMoney(s.actual_cash)) + '\n';
    const diff = Number(s.difference || 0);
    p += lr('OVER/SHORT:', `${diff >= 0 ? '+' : ''}${fmtMoney(diff)}`) + '\n';
    p += line + '\n\n';

    let printer;
    for (let i = 0; i < copies; i++) {
      printer = await printEscPosTextToFront(p, { openDrawer: false });
    }

    await writeAudit({
      userId: serverId || null,
      role: 'server',
      actionType: 'mid_settlement_print',
      referenceId: `settlement:${s.settlement_id}`,
      beforeValue: null,
      afterValue: { settlementId: s.settlement_id, copies, printer },
    });

    res.json({ success: true, message: `Printed (${copies} copies)`, printer, copies, settlement_id: s.settlement_id });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ============================================================
// Get active shift for server (today by default)
// ============================================================
router.get('/active-shift', async (req, res) => {
  try {
    const serverId = String(req.query.server_id || '').trim();
    const businessDate = String(req.query.business_date || fmtLocalBusinessDate()).trim();
    if (!serverId) return res.status(400).json({ success: false, error: 'server_id is required' });
    const shift = await getActiveShift(serverId, businessDate);
    res.json({ success: true, data: shift || null });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ============================================================
// Calculate settlement preview (no write)
// ============================================================
router.get('/preview', async (req, res) => {
  try {
    const serverId = String(req.query.server_id || '').trim();
    const businessDate = String(req.query.business_date || fmtLocalBusinessDate()).trim();
    if (!serverId) return res.status(400).json({ success: false, error: 'server_id is required' });
    const shift = await getActiveShift(serverId, businessDate);
    if (!shift) return res.status(400).json({ success: false, error: 'No active shift found' });

    const calc = await calcSettlement({ serverId, shiftId: shift.shift_id, businessDate });
    res.json({ success: true, shift, businessDate, data: calc });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ============================================================
// Safe Drop (cash drop)
// ============================================================
router.post('/safe-drop', async (req, res) => {
  try {
    const {
      shift_id,
      server_id,
      amount,
      note,
      created_by_id,
      created_by_name,
    } = req.body || {};
    const shiftId = Number(shift_id);
    const serverId = String(server_id || '').trim();
    const amt = Number(amount || 0);
    if (!shiftId || !serverId || !Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ success: false, error: 'shift_id, server_id, amount (>0) are required' });
    }
    const ts = new Date().toISOString();
    await dbRun(
      `INSERT INTO server_cash_drops (shift_id, server_id, amount, note, created_by_id, created_by_name, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [shiftId, serverId, amt, note || null, created_by_id || null, created_by_name || null, ts]
    );
    await writeAudit({
      userId: created_by_id || serverId,
      role: created_by_id ? 'manager' : 'server',
      actionType: 'safe_drop_create',
      referenceId: `shift:${shiftId}`,
      beforeValue: null,
      afterValue: { shiftId, serverId, amount: amt, note, timestamp: ts },
    });
    res.json({ success: true, message: 'Safe drop recorded', timestamp: ts });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ============================================================
// Server sales summary (all servers) for a business date
// ============================================================
router.get('/server-sales', async (req, res) => {
  try {
    const businessDate = String(req.query.business_date || fmtLocalBusinessDate()).trim();
    const requestedServerId = String(req.query.server_id || '').trim();

    const serverRows = await dbAll(
      `
      SELECT
        COALESCE(o.server_id,'') as server_id,
        COALESCE(MAX(o.server_name), '') as server_name
      FROM orders o
      WHERE date(o.created_at,'localtime') = ?
        AND ${paidOrderStatusesSql}
        AND COALESCE(o.server_id,'') <> ''
        ${requestedServerId ? "AND COALESCE(o.server_id,'') = ?" : ''}
      GROUP BY o.server_id
      ORDER BY o.server_id ASC
      `,
      requestedServerId ? [businessDate, requestedServerId] : [businessDate]
    );

    const rows = [];
    for (const r of serverRows || []) {
      const serverId = String(r.server_id || '').trim();
      if (!serverId) continue;
      const summary = await calcServerDaySummary({ serverId, businessDate });

      let serverName = String(r.server_name || '').trim();
      if (!serverName) {
        try {
          const emp = await dbGet(`SELECT name FROM employees WHERE id = ?`, [serverId]);
          serverName = String(emp?.name || '').trim();
        } catch {}
      }

      rows.push({
        serverId,
        serverName,
        orderCount: summary.orderCount,
        grossSales: summary.grossSales,
        cashTips: summary.cashTips,
        cardTips: summary.cardTips,
        totalTip: summary.totalTip,
      });
    }

    const totals = rows.reduce(
      (acc, cur) => {
        acc.orderCount += Number(cur.orderCount || 0);
        acc.grossSales += Number(cur.grossSales || 0);
        acc.cashTips += Number(cur.cashTips || 0);
        acc.cardTips += Number(cur.cardTips || 0);
        acc.totalTip += Number(cur.totalTip || 0);
        return acc;
      },
      { orderCount: 0, grossSales: 0, cashTips: 0, cardTips: 0, totalTip: 0 }
    );

    res.json({ success: true, businessDate, serverId: requestedServerId || null, rows, totals });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ============================================================
// Print server sales summary (receipt)
// ============================================================
router.post('/print-server-sales', async (req, res) => {
  try {
    const { business_date, server_id, counted_cash, cash_breakdown, copies: rawCopies } = req.body || {};
    const businessDate = String(business_date || fmtLocalBusinessDate()).trim();
    const requestedServerId = String(server_id || '').trim();
    const copies = Math.max(1, Math.min(5, parseInt(rawCopies) || 1));
    const countedCash = Number(counted_cash);
    const hasCountedCash = Number.isFinite(countedCash) && countedCash >= 0;
    const cashBreakdown = (cash_breakdown && typeof cash_breakdown === 'object') ? cash_breakdown : null;

    // Reuse the GET logic internally (without HTTP)
    const serverRows = await dbAll(
      `
      SELECT
        COALESCE(o.server_id,'') as server_id,
        COALESCE(MAX(o.server_name), '') as server_name
      FROM orders o
      WHERE date(o.created_at,'localtime') = ?
        AND ${paidOrderStatusesSql}
        AND COALESCE(o.server_id,'') <> ''
        ${requestedServerId ? "AND COALESCE(o.server_id,'') = ?" : ''}
      GROUP BY o.server_id
      ORDER BY o.server_id ASC
      `,
      requestedServerId ? [businessDate, requestedServerId] : [businessDate]
    );

    const rows = [];
    for (const r of serverRows || []) {
      const serverId = String(r.server_id || '').trim();
      if (!serverId) continue;
      const summary = await calcServerDaySummary({ serverId, businessDate });
      let serverName = String(r.server_name || '').trim();
      if (!serverName) {
        try {
          const emp = await dbGet(`SELECT name FROM employees WHERE id = ?`, [serverId]);
          serverName = String(emp?.name || '').trim();
        } catch {}
      }
      rows.push({
        serverId,
        serverName,
        orderCount: summary.orderCount,
        grossSales: summary.grossSales,
        cashTips: summary.cashTips,
        cardTips: summary.cardTips,
        totalTip: summary.totalTip,
      });
    }

    const totals = rows.reduce(
      (acc, cur) => {
        acc.orderCount += Number(cur.orderCount || 0);
        acc.grossSales += Number(cur.grossSales || 0);
        acc.totalTip += Number(cur.totalTip || 0);
        return acc;
      },
      { orderCount: 0, grossSales: 0, totalTip: 0 }
    );

    const LINE_WIDTH = 42;
    const line = '='.repeat(LINE_WIDTH);
    const dotted = '-'.repeat(LINE_WIDTH);
    const center = (t) => {
      const s = String(t || '');
      const pad = Math.max(0, Math.floor((LINE_WIDTH - s.length) / 2));
      return ' '.repeat(pad) + s;
    };
    const lr = (l, r) => {
      const L = String(l || '');
      const R = String(r || '');
      const spaces = Math.max(1, LINE_WIDTH - L.length - R.length);
      return L + ' '.repeat(spaces) + R;
    };
    const fmtMoney = (amt) => `$${(Number(amt || 0)).toFixed(2)}`;

    let p = '\n' + line + '\n';
    p += center('SERVER SALES SUMMARY') + '\n';
    p += line + '\n';
    p += lr('Business Date:', businessDate) + '\n';
    if (hasCountedCash) {
      p += lr('Counted Cash:', fmtMoney(countedCash)) + '\n';
    }
    p += dotted + '\n';

    if (cashBreakdown && hasCountedCash) {
      const denoms = [
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
      const lines = [];
      for (const d of denoms) {
        const c = Number(cashBreakdown[d.key] || 0);
        if (!Number.isFinite(c) || c <= 0) continue;
        const subtotal = Number((c * d.value).toFixed(2));
        lines.push(lr(`  ${d.label} x ${c}`, fmtMoney(subtotal)));
      }
      if (lines.length > 0) {
        p += center('CASH COUNT BREAKDOWN') + '\n';
        p += dotted + '\n';
        lines.forEach((ln) => { p += ln + '\n'; });
        p += dotted + '\n';
      }
    }

    if ((rows || []).length === 0) {
      p += center('No server sales found') + '\n';
      p += line + '\n\n';
    } else {
      for (const r of rows) {
        const label = r.serverName ? `${r.serverName} (${r.serverId})` : String(r.serverId);
        p += lr(label + ':', fmtMoney(r.grossSales)) + '\n';
        p += lr('  Orders:', String(r.orderCount || 0)) + '\n';
        p += lr('  Tips:', fmtMoney(r.totalTip || 0)) + '\n';
        p += dotted + '\n';
      }
      p += lr('TOTAL SALES:', fmtMoney(totals.grossSales)) + '\n';
      p += lr('TOTAL ORDERS:', String(totals.orderCount || 0)) + '\n';
      p += lr('TOTAL TIPS:', fmtMoney(totals.totalTip)) + '\n';
      p += line + '\n\n';
    }

    let printer;
    for (let i = 0; i < copies; i++) {
      printer = await printEscPosTextToFront(p, { openDrawer: false });
    }

    await writeAudit({
      userId: null,
      role: 'manager',
      actionType: 'server_sales_print',
      referenceId: `server_sales:${businessDate}${requestedServerId ? `:${requestedServerId}` : ''}`,
      beforeValue: null,
      afterValue: { businessDate, serverId: requestedServerId || null, copies, printer, rows: rows.length, countedCash: hasCountedCash ? countedCash : null },
    });

    res.json({ success: true, message: `Printed (${copies} copies)`, printer, copies, businessDate, serverId: requestedServerId || null, servers: rows.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ============================================================
// Create Mid-Settlement (writes a settlement record)
// ============================================================
router.post('/mid-settlement', async (req, res) => {
  try {
    const {
      server_id,
      business_date,
      actual_cash,
      comment,
      initiated_by = 'server',
      initiated_by_id,
      manager_id,
      manager_name,
    } = req.body || {};

    const serverId = String(server_id || '').trim();
    const businessDate = String(business_date || fmtLocalBusinessDate()).trim();
    const actualCash = Number(actual_cash || 0);
    if (!serverId) return res.status(400).json({ success: false, error: 'server_id is required' });
    if (!Number.isFinite(actualCash) || actualCash < 0) {
      return res.status(400).json({ success: false, error: 'actual_cash must be a number >= 0' });
    }

    const shift = await getActiveShift(serverId, businessDate);
    if (!shift) return res.status(400).json({ success: false, error: 'No active shift found' });

    // Only once per business day (active settlements only)
    const existing = await dbGet(
      `SELECT settlement_id FROM server_settlements
       WHERE server_id = ? AND business_date = ? AND status = 'active'
       ORDER BY settlement_id DESC LIMIT 1`,
      [serverId, businessDate]
    );
    if (existing?.settlement_id) {
      return res.status(400).json({ success: false, error: 'Mid-Settlement already completed for this server today' });
    }

    const now = new Date().toISOString();
    const calc = await calcSettlement({ serverId, shiftId: shift.shift_id, businessDate });
    const diff = Number((actualCash - (calc.cash.expectedCash || 0)).toFixed(2));

    // Over/Short tiers (fixed for MVP)
    const absDiff = Math.abs(diff);
    let approvalStatus = 'auto';
    let auditFlag = 0;
    if (absDiff > 5 && absDiff <= 20) approvalStatus = 'manager_required';
    if (absDiff > 20) {
      approvalStatus = 'manager_required';
      auditFlag = 1;
      if (!String(comment || '').trim()) {
        return res.status(400).json({ success: false, error: 'Comment is required for over/short above $20' });
      }
    }

    const insert = await dbRun(
      `INSERT INTO server_settlements (
        shift_id, server_id, business_date, settlement_time, status, forced,
        initiated_by, initiated_by_id, manager_id, manager_name, comment, audit_flag,
        gross_sales, net_sales, tax_total, discount_total, void_total, refund_total,
        total_cash_sales, total_card_sales, total_other_sales,
        cash_tips, card_tips, total_tip,
        safe_drop_total, cash_refund_total, paid_out_total,
        expected_cash, actual_cash, difference,
        approval_status
      ) VALUES (
        ?, ?, ?, ?, 'active', 0,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?
      )`,
      [
        shift.shift_id, serverId, businessDate, now,
        initiated_by, initiated_by_id || null, manager_id || null, manager_name || null, comment || null, auditFlag,
        calc.salesSummary.grossSales, calc.salesSummary.netSales, calc.salesSummary.taxTotal, calc.salesSummary.discountTotal,
        calc.salesSummary.voidTotal, calc.salesSummary.refundTotal,
        calc.cash.totalCashSales, calc.cash.totalCashSales ? (calc.cash.expectedCash - calc.cash.safeDropTotal) : calc.cash.totalCashSales, calc.cash.totalCashSales ? 0 : 0,
        calc.tipSummary.cashTips, calc.tipSummary.cardTips, calc.tipSummary.totalTip,
        calc.cash.safeDropTotal, calc.cash.cashRefundTotal, calc.cash.paidOutTotal,
        calc.cash.expectedCash, actualCash, diff,
        approvalStatus,
      ]
    );
    const settlementId = insert?.lastID;

    // Insert settlement payments
    for (const p of calc.paymentBreakdown) {
      await dbRun(
        `INSERT INTO settlement_payments (settlement_id, payment_type, sales_amount, tip_amount)
         VALUES (?, ?, ?, ?)`,
        [settlementId, p.paymentType, p.salesAmount || 0, p.tipAmount || 0]
      );
    }

    await writeAudit({
      userId: initiated_by_id || serverId,
      role: initiated_by === 'manager' ? 'manager' : 'server',
      actionType: 'mid_settlement_create',
      referenceId: `settlement:${settlementId}`,
      beforeValue: null,
      afterValue: { settlementId, shiftId: shift.shift_id, serverId, businessDate, expectedCash: calc.cash.expectedCash, actualCash, difference: diff },
    });

    const settlement = await dbGet(`SELECT * FROM server_settlements WHERE settlement_id = ?`, [settlementId]);
    const settlementPayments = await dbAll(`SELECT * FROM settlement_payments WHERE settlement_id = ?`, [settlementId]);

    res.json({ success: true, settlement, payments: settlementPayments, preview: calc });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;

