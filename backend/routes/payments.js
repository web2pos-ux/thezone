const express = require('express');
const router = express.Router();
const firebaseService = require('../services/firebaseService');

module.exports = (db) => {
	const dbRun = (sql, params=[]) => new Promise((resolve, reject) => {
		db.run(sql, params, function(err){ if (err) reject(err); else resolve(this); });
	});
	const dbAll = (sql, params=[]) => new Promise((resolve, reject) => {
		db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows); });
	});
	const dbGet = (sql, params=[]) => new Promise((resolve, reject) => {
		db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); });
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

	// create table if not exists
	dbRun(`CREATE TABLE IF NOT EXISTS payments (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		order_id INTEGER,
		payment_method TEXT,
		amount REAL,
		tip REAL,
		ref TEXT,
		status TEXT DEFAULT 'APPROVED',
		guest_number INTEGER,
		created_at TEXT,
		FOREIGN KEY(order_id) REFERENCES orders(id)
	)`);

	// attempt to add missing columns for existing DBs
	(async () => {
		try { await dbRun(`ALTER TABLE payments ADD COLUMN guest_number INTEGER`); } catch (e) { /* already exists */ }
		try { await dbRun(`ALTER TABLE payments ADD COLUMN change_amount REAL DEFAULT 0`); } catch (e) { /* already exists */ }
	})();

	// create payment
	router.post('/', async (req, res) => {
		try {
			const { orderId, method, amount, tip = 0, ref=null, status='APPROVED', guestNumber=null, changeAmount = 0 } = req.body || {};
			const tipAmount = Number(tip);
			const changeVal = Number(changeAmount) || 0;
			if (!orderId || !method || typeof amount !== 'number') {
				return res.status(400).json({ success:false, error:'orderId, method, amount are required' });
			}
			if (!Number.isFinite(tipAmount) || tipAmount < 0) {
				return res.status(400).json({ success:false, error:'tip must be a valid number (>= 0)' });
			}
			const createdAt = new Date().toISOString();
			const result = await dbRun(
				`INSERT INTO payments(order_id, payment_method, amount, tip, ref, status, guest_number, created_at, change_amount)
				 VALUES(?,?,?,?,?,?,?,?,?)`,
				[orderId, method, amount, tipAmount, ref, status, guestNumber, createdAt, changeVal]
			);
			
			// Firebase에도 결제 데이터 저장
			try {
				const restaurantId = await getRestaurantId();
				if (restaurantId) {
					await firebaseService.savePaymentToFirebase(restaurantId, {
						paymentId: result.lastID,
						orderId,
						method,
						amount,
						tip: tipAmount,
						ref,
						status,
						guestNumber,
						createdAt
					});
					
					// 게스트 번호가 있으면 게스트 결제 상태도 저장
					if (guestNumber !== null) {
						await firebaseService.saveGuestPaymentStatus(restaurantId, orderId, guestNumber, 'PAID');
					}
				}
			} catch (firebaseErr) {
				console.warn('Firebase payment sync failed (non-fatal):', firebaseErr.message);
			}
			
			res.json({ success:true, paymentId: result.lastID, createdAt });
		} catch (e) {
			console.error('Failed to create payment:', e);
			res.status(500).json({ success:false, error:'Failed to create payment' });
		}
	});

	// list all payments (with optional date filter)
	router.get('/', async (req, res) => {
		try {
			const { startDate, endDate, method, status } = req.query;
			let sql = `SELECT * FROM payments WHERE 1=1`;
			const params = [];
			
			if (startDate) {
				sql += ` AND DATE(created_at) >= ?`;
				params.push(startDate);
			}
			if (endDate) {
				sql += ` AND DATE(created_at) <= ?`;
				params.push(endDate);
			}
			if (method) {
				sql += ` AND UPPER(payment_method) = ?`;
				params.push(String(method).toUpperCase());
			}
			if (status) {
				sql += ` AND UPPER(status) = ?`;
				params.push(String(status).toUpperCase());
			}
			
			sql += ` ORDER BY created_at DESC`;
			
			const rows = await dbAll(sql, params);
			res.json({ success: true, payments: rows });
		} catch (e) {
			console.error('Failed to fetch payments:', e);
			res.status(500).json({ success: false, error: 'Failed to fetch payments' });
		}
	});

	// list payments by order
	router.get('/order/:orderId', async (req, res) => {
		try {
			const orderId = Number(req.params.orderId);
			const rows = await dbAll(`SELECT * FROM payments WHERE order_id = ? ORDER BY id ASC`, [orderId]);
			res.json({ success:true, payments: rows });
		} catch (e) {
			console.error('Failed to fetch payments:', e);
			res.status(500).json({ success:false, error:'Failed to fetch payments' });
		}
	});

	// void a payment (mark status as VOIDED)
	router.post('/:id/void', async (req, res) => {
		try {
			const id = Number(req.params.id);
			await dbRun(`UPDATE payments SET status = 'VOIDED' WHERE id = ?`, [id]);
			res.json({ success:true });
		} catch (e) {
			console.error('Failed to void payment:', e);
			res.status(500).json({ success:false, error:'Failed to void payment' });
		}
	});

	return router;
}; 