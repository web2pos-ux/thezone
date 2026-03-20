const express = require('express');
const router = express.Router();
const firebaseService = require('../services/firebaseService');

module.exports = (db) => {
  const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
  const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
  const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

  // Firebase restaurantId 가져오기
  const getRestaurantId = async () => {
    try {
      const row = await dbGet('SELECT firebase_restaurant_id FROM business_profile WHERE id = 1');
      return row?.firebase_restaurant_id || null;
    } catch (e) {
      return null;
    }
  };

  // create table if not exists (extra safety; dbInit is the source of truth)
  dbRun(`CREATE TABLE IF NOT EXISTS tips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    payment_method TEXT NOT NULL,
    employee_id TEXT,
    guest_number INTEGER,
    created_at TEXT,
    FOREIGN KEY(order_id) REFERENCES orders(id)
  )`);

  // create tip
  router.post('/', async (req, res) => {
    try {
      const { orderId, amount, method, employeeId = null, guestNumber = null } = req.body || {};
      const tipAmount = Number(amount);
      const paymentMethod = String(method || '').trim().toUpperCase();

      if (!orderId || !Number.isFinite(tipAmount) || tipAmount <= 0 || !paymentMethod) {
        return res.status(400).json({ success: false, error: 'orderId, amount (>0), method are required' });
      }

      const createdAt = new Date().toISOString();
      const result = await dbRun(
        `INSERT INTO tips(order_id, amount, payment_method, employee_id, guest_number, created_at)
         VALUES(?,?,?,?,?,?)`,
        [orderId, tipAmount, paymentMethod, employeeId, guestNumber, createdAt]
      );

      // Firebase에도 팁 데이터 저장 (별도 컬렉션)
      try {
        const restaurantId = await getRestaurantId();
        if (restaurantId && typeof firebaseService.saveTipToFirebase === 'function') {
          await firebaseService.saveTipToFirebase(restaurantId, {
            tipId: result.lastID,
            orderId,
            amount: tipAmount,
            method: paymentMethod,
            employeeId,
            guestNumber,
            createdAt
          });
        }
      } catch (firebaseErr) {
        console.warn('Firebase tip sync failed (non-fatal):', firebaseErr.message);
      }

      res.json({ success: true, tipId: result.lastID, createdAt });
    } catch (e) {
      console.error('Failed to create tip:', e);
      res.status(500).json({ success: false, error: 'Failed to create tip' });
    }
  });

  // list tips by order
  router.get('/order/:orderId', async (req, res) => {
    try {
      const orderId = Number(req.params.orderId);
      const rows = await dbAll(`SELECT * FROM tips WHERE order_id = ? ORDER BY id ASC`, [orderId]);
      res.json({ success: true, tips: rows });
    } catch (e) {
      console.error('Failed to fetch tips:', e);
      res.status(500).json({ success: false, error: 'Failed to fetch tips' });
    }
  });

  return router;
};

