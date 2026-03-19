const express = require('express');
const router = express.Router();
const { getLocalDatetimeString } = require('../utils/datetimeUtils');

let firebaseService = null;
try { firebaseService = require('../services/firebaseService'); } catch (e) { /* Firebase 없이도 동작 */ }

module.exports = (db) => {
  const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { if (err) reject(err); else resolve(this); });
  });
  const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows); });
  });
  const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); });
  });

  let cachedRestaurantId = null;
  const getRestaurantId = async () => {
    if (cachedRestaurantId) return cachedRestaurantId;
    try {
      const setting = await dbGet("SELECT value FROM admin_settings WHERE key = 'firebase_restaurant_id'");
      if (setting && setting.value) { cachedRestaurantId = setting.value; return cachedRestaurantId; }
    } catch (e) { /* ignore */ }
    return null;
  };

  // Create refunds table if not exists
  dbRun(`CREATE TABLE IF NOT EXISTS refunds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    original_order_number TEXT,
    refund_type TEXT DEFAULT 'FULL',
    subtotal REAL DEFAULT 0,
    tax REAL DEFAULT 0,
    total REAL DEFAULT 0,
    payment_method TEXT,
    refunded_by TEXT,
    refunded_by_pin TEXT,
    reason TEXT,
    notes TEXT,
    status TEXT DEFAULT 'COMPLETED',
    created_at TEXT,
    FOREIGN KEY(order_id) REFERENCES orders(id)
  )`);

  // Create refund_items table if not exists
  dbRun(`CREATE TABLE IF NOT EXISTS refund_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    refund_id INTEGER NOT NULL,
    order_item_id INTEGER,
    item_name TEXT,
    quantity INTEGER DEFAULT 1,
    unit_price REAL DEFAULT 0,
    total_price REAL DEFAULT 0,
    tax REAL DEFAULT 0,
    FOREIGN KEY(refund_id) REFERENCES refunds(id)
  )`);

  // Get paid orders for refund (orders with payments and not fully refunded)
  router.get('/paid-orders', async (req, res) => {
    try {
      const { date, search } = req.query;
      let sql = `
        SELECT DISTINCT o.id, o.order_number, o.table_id, o.order_type, o.status,
               o.total, o.created_at, o.customer_phone, o.customer_name,
               (SELECT SUM(p.amount + COALESCE(p.tip, 0)) FROM payments p WHERE p.order_id = o.id AND p.status = 'APPROVED') as paid_amount,
               (SELECT GROUP_CONCAT(DISTINCT p.method) FROM payments p WHERE p.order_id = o.id AND p.status = 'APPROVED') as payment_methods,
               (SELECT COALESCE(SUM(r.total), 0) FROM refunds r WHERE r.order_id = o.id AND r.status = 'COMPLETED') as refunded_amount
        FROM orders o
        WHERE o.status = 'PAID'
        AND EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.status = 'APPROVED')
      `;
      const params = [];

      if (date) {
        sql += ` AND DATE(o.created_at) = DATE(?)`;
        params.push(date);
      }

      if (search) {
        sql += ` AND (o.order_number LIKE ? OR o.table_id LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`);
      }

      sql += ` ORDER BY o.created_at DESC LIMIT 100`;

      const orders = await dbAll(sql, params);

      // Filter out fully refunded orders
      const refundableOrders = orders.filter(o => {
        const paidAmount = o.paid_amount || 0;
        const refundedAmount = o.refunded_amount || 0;
        return paidAmount > refundedAmount;
      });

      res.json({ success: true, orders: refundableOrders });
    } catch (e) {
      console.error('Failed to fetch paid orders:', e);
      res.status(500).json({ success: false, error: 'Failed to fetch paid orders' });
    }
  });

  // Get order details for refund
  router.get('/order/:orderId', async (req, res) => {
    try {
      const orderId = Number(req.params.orderId);

      // Get order
      const order = await dbGet(`SELECT * FROM orders WHERE id = ?`, [orderId]);
      if (!order) {
        return res.status(404).json({ success: false, error: 'Order not found' });
      }

      // Get order items
      const items = await dbAll(`SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC`, [orderId]);

      // Get order adjustments (discounts)
      const adjustments = await dbAll(`SELECT * FROM order_adjustments WHERE order_id = ? ORDER BY id ASC`, [orderId]);

      // Get payments
      const payments = await dbAll(`SELECT * FROM payments WHERE order_id = ? AND status = 'APPROVED' ORDER BY id ASC`, [orderId]);

      // Get previous refunds
      const refunds = await dbAll(`SELECT * FROM refunds WHERE order_id = ? ORDER BY id ASC`, [orderId]);

      // Get refunded items
      let refundedItems = [];
      if (refunds.length > 0) {
        const refundIds = refunds.map(r => r.id).join(',');
        refundedItems = await dbAll(`SELECT * FROM refund_items WHERE refund_id IN (${refundIds})`);
      }

      // Calculate refundable amounts per item
      const itemRefundMap = {};
      refundedItems.forEach(ri => {
        if (!itemRefundMap[ri.order_item_id]) {
          itemRefundMap[ri.order_item_id] = 0;
        }
        itemRefundMap[ri.order_item_id] += ri.quantity;
      });

      const itemsWithRefundable = items.map(item => ({
        ...item,
        refunded_quantity: itemRefundMap[item.id] || 0,
        refundable_quantity: item.quantity - (itemRefundMap[item.id] || 0)
      }));

      // Calculate total paid and refunded
      const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0) + (p.tip || 0), 0);
      const totalRefunded = refunds.reduce((sum, r) => sum + (r.total || 0), 0);
      
      // Calculate total adjustments (discounts are negative)
      const totalAdjustments = adjustments.reduce((sum, adj) => sum + (adj.amount_applied || 0), 0);

      res.json({
        success: true,
        order,
        items: itemsWithRefundable,
        adjustments,
        payments,
        refunds,
        totalPaid,
        totalRefunded,
        totalAdjustments,
        refundableAmount: totalPaid - totalRefunded
      });
    } catch (e) {
      console.error('Failed to fetch order details:', e);
      res.status(500).json({ success: false, error: 'Failed to fetch order details' });
    }
  });

  // Process refund
  router.post('/', async (req, res) => {
    try {
      const {
        orderId,
        refundType, // 'FULL' or 'PARTIAL'
        items, // array of { orderItemId, quantity, unitPrice, totalPrice, tax, itemName }
        subtotal,
        tax,
        total,
        paymentMethod,
        refundedBy,
        refundedByPin,
        reason,
        notes,
        giftCardNumber // for gift card refunds
      } = req.body;

      if (!orderId || !refundType || typeof total !== 'number') {
        return res.status(400).json({ success: false, error: 'orderId, refundType, and total are required' });
      }

      // Verify order exists and is paid
      const order = await dbGet(`SELECT * FROM orders WHERE id = ?`, [orderId]);
      if (!order) {
        return res.status(404).json({ success: false, error: 'Order not found' });
      }

      // Calculate total paid and already refunded
      const payments = await dbAll(`SELECT * FROM payments WHERE order_id = ? AND status = 'APPROVED'`, [orderId]);
      const existingRefunds = await dbAll(`SELECT * FROM refunds WHERE order_id = ? AND status = 'COMPLETED'`, [orderId]);
      
      const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0) + (p.tip || 0), 0);
      const totalRefunded = existingRefunds.reduce((sum, r) => sum + (r.total || 0), 0);
      const refundableAmount = totalPaid - totalRefunded;

      if (total > refundableAmount) {
        return res.status(400).json({ 
          success: false, 
          error: `Refund amount ($${total.toFixed(2)}) exceeds refundable amount ($${refundableAmount.toFixed(2)})` 
        });
      }

      const createdAt = getLocalDatetimeString();

      // Create refund record
      const refundResult = await dbRun(`
        INSERT INTO refunds (order_id, original_order_number, refund_type, subtotal, tax, total, payment_method, refunded_by, refunded_by_pin, reason, notes, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?)
      `, [orderId, order.order_number, refundType, subtotal || 0, tax || 0, total, paymentMethod, refundedBy, refundedByPin, reason, notes, createdAt]);

      const refundId = refundResult.lastID;

      // Create refund items
      if (items && items.length > 0) {
        for (const item of items) {
          await dbRun(`
            INSERT INTO refund_items (refund_id, order_item_id, item_name, quantity, unit_price, total_price, tax)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `, [refundId, item.orderItemId, item.itemName, item.quantity, item.unitPrice, item.totalPrice, item.tax || 0]);
        }
      }

      // If gift card refund, reload the gift card
      const isGiftCardPayment = paymentMethod && (
        paymentMethod.toUpperCase() === 'GIFT_CARD' || 
        paymentMethod.toUpperCase() === 'GIFT CARD' || 
        paymentMethod.toUpperCase() === 'GIFT' ||
        paymentMethod.toUpperCase().includes('GIFT')
      );
      
      console.log('=== Gift Card Refund Debug ===');
      console.log('paymentMethod:', paymentMethod);
      console.log('isGiftCardPayment:', isGiftCardPayment);
      console.log('giftCardNumber:', giftCardNumber);
      
      if (isGiftCardPayment && giftCardNumber) {
        try {
          // Check if gift card exists
          const giftCard = await dbGet(`SELECT * FROM gift_cards WHERE card_number = ?`, [giftCardNumber]);
          console.log('Gift card found:', giftCard);
          
          if (giftCard) {
            // Reload the gift card with refund amount
            await dbRun(`UPDATE gift_cards SET current_balance = current_balance + ? WHERE card_number = ?`, [total, giftCardNumber]);
            console.log('Gift card balance updated! Amount:', total);
            
            // Record the transaction
            await dbRun(`
              INSERT INTO gift_card_transactions (card_number, transaction_type, amount, balance_after, notes, created_at)
              VALUES (?, 'refund', ?, (SELECT current_balance FROM gift_cards WHERE card_number = ?), ?, ?)
            `, [giftCardNumber, total, giftCardNumber, `Refund from order #${order.order_number}`, createdAt]);
            console.log('Gift card transaction recorded!');
          } else {
            console.log('Gift card NOT found in database!');
          }
        } catch (gcError) {
          console.error('Gift card reload failed:', gcError);
          // Continue with refund even if gift card reload fails
        }
      } else {
        console.log('Gift card refund skipped - isGiftCardPayment:', isGiftCardPayment, 'giftCardNumber:', giftCardNumber);
      }

      // Update order status if fully refunded
      const newTotalRefunded = totalRefunded + total;
      if (newTotalRefunded >= totalPaid) {
        await dbRun(`UPDATE orders SET status = 'REFUNDED' WHERE id = ?`, [orderId]);
      }

      // Get the created refund with items
      const refund = await dbGet(`SELECT * FROM refunds WHERE id = ?`, [refundId]);
      const refundItems = await dbAll(`SELECT * FROM refund_items WHERE refund_id = ?`, [refundId]);

      // Firebase Refund 동기화
      if (firebaseService) {
        const restaurantId = await getRestaurantId() || process.env.FIREBASE_RESTAURANT_ID;
        if (restaurantId) {
          const orderRow = await dbGet('SELECT firebase_order_id FROM orders WHERE id = ?', [orderId]);
          firebaseService.saveRefundToFirebase(restaurantId, {
            refundId,
            orderId,
            orderNumber: order.order_number,
            firebaseOrderId: orderRow?.firebase_order_id,
            refundType,
            subtotal: refund.subtotal,
            tax: refund.tax,
            total: refund.total,
            paymentMethod: refund.payment_method,
            refundedBy: refund.refunded_by,
            reason: refund.reason,
            notes: refund.notes,
            status: refund.status,
            items: refundItems,
            createdAt: refund.created_at
          }).catch(err => console.warn('[Firebase] Refund sync error:', err.message));
        }
      }

      res.json({
        success: true,
        refund: {
          ...refund,
          items: refundItems
        },
        message: 'Refund processed successfully'
      });
    } catch (e) {
      console.error('Failed to process refund:', e);
      res.status(500).json({ success: false, error: 'Failed to process refund' });
    }
  });

  // Get refund history
  router.get('/history', async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      let sql = `
        SELECT r.*, 
               (SELECT COUNT(*) FROM refund_items ri WHERE ri.refund_id = r.id) as item_count
        FROM refunds r
        WHERE 1=1
      `;
      const params = [];

      if (startDate) {
        sql += ` AND DATE(r.created_at) >= DATE(?)`;
        params.push(startDate);
      }
      if (endDate) {
        sql += ` AND DATE(r.created_at) <= DATE(?)`;
        params.push(endDate);
      }

      sql += ` ORDER BY r.created_at DESC`;

      const refunds = await dbAll(sql, params);
      res.json({ success: true, refunds });
    } catch (e) {
      console.error('Failed to fetch refund history:', e);
      res.status(500).json({ success: false, error: 'Failed to fetch refund history' });
    }
  });

  // Get refund summary for reports
  router.get('/report/summary', async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      let dateFilter = '';
      const params = [];

      if (startDate) {
        dateFilter += ` AND DATE(r.created_at) >= DATE(?)`;
        params.push(startDate);
      }
      if (endDate) {
        dateFilter += ` AND DATE(r.created_at) <= DATE(?)`;
        params.push(endDate);
      }

      const summary = await dbGet(`
        SELECT 
          COUNT(*) as total_refunds,
          COALESCE(SUM(subtotal), 0) as total_subtotal,
          COALESCE(SUM(tax), 0) as total_tax,
          COALESCE(SUM(total), 0) as total_amount,
          COUNT(CASE WHEN refund_type = 'FULL' THEN 1 END) as full_refunds,
          COUNT(CASE WHEN refund_type = 'PARTIAL' THEN 1 END) as partial_refunds
        FROM refunds r
        WHERE status = 'COMPLETED' ${dateFilter}
      `, params);

      // Get refunds by payment method
      const byPaymentMethod = await dbAll(`
        SELECT payment_method, COUNT(*) as count, COALESCE(SUM(total), 0) as amount
        FROM refunds r
        WHERE status = 'COMPLETED' ${dateFilter}
        GROUP BY payment_method
      `, params);

      res.json({ success: true, summary, byPaymentMethod });
    } catch (e) {
      console.error('Failed to fetch refund summary:', e);
      res.status(500).json({ success: false, error: 'Failed to fetch refund summary' });
    }
  });

  return router;
};



