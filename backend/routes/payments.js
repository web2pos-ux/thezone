const express = require('express');
const router = express.Router();
const firebaseService = require('../services/firebaseService');
const remoteSyncService = require('../services/remoteSyncService');
const posLockService = require('../services/posLockService');

module.exports = (db) => {
	const dbRun = (sql, params=[]) => new Promise((resolve, reject) => {
		db.run(sql, params, function(err){ if (err) reject(err); else resolve(this); });
	});
	const dbAll = (sql, params=[]) => new Promise((resolve, reject) => {
		db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows); });
	});

	// create table if not exists
	dbRun(`CREATE TABLE IF NOT EXISTS payments (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		order_id INTEGER,
		method TEXT,
		amount REAL,
		tip REAL,
		ref TEXT,
		status TEXT DEFAULT 'APPROVED',
		guest_number INTEGER,
		created_at TEXT,
		FOREIGN KEY(order_id) REFERENCES orders(id)
	)`);

	// attempt to add guest_number column if missing (for existing DBs)
	(async () => {
		try {
			await dbRun(`ALTER TABLE payments ADD COLUMN guest_number INTEGER`);
		} catch (e) {
			// ignore if already exists
		}
	})();

	// create payment
	router.post('/', async (req, res) => {
		try {
			const { orderId, method, amount, tip=0, ref=null, status='APPROVED', guestNumber=null } = req.body || {};
			if (!orderId || !method || typeof amount !== 'number') {
				return res.status(400).json({ success:false, error:'orderId, method, amount are required' });
			}

			// Multi-POS conflict prevention: lock table if this order is a dine-in table order
			try {
				const restaurantId = remoteSyncService.getRestaurantId();
				if (restaurantId) {
					const row = await new Promise((resolve, reject) => {
						db.get(`SELECT table_id FROM orders WHERE id = ?`, [orderId], (err, r) => (err ? reject(err) : resolve(r)));
					});
					const tableId = row && row.table_id ? String(row.table_id) : null;
					if (tableId) {
						const lock = await posLockService.acquireTableLock(restaurantId, tableId);
						if (!lock.ok) {
							return res.status(409).json({
								success: false,
								error: '이 테이블은 다른 POS에서 사용 중입니다. 잠시 후 다시 시도해주세요.',
								ownerId: lock.ownerId,
								expiresAtMs: lock.expiresAtMs
							});
						}
					}
				}
			} catch {}

			const createdAt = new Date().toISOString();
			const result = await dbRun(`INSERT INTO payments(order_id, method, amount, tip, ref, status, guest_number, created_at) VALUES(?,?,?,?,?,?,?,?)`, [orderId, method, amount, tip, ref, status, guestNumber, createdAt]);
			
			// Firebase 결제 동기화
			try {
				const restaurantId = remoteSyncService.getRestaurantId();
				if (restaurantId) {
					await firebaseService.syncPayment(restaurantId, {
						orderId: orderId,
						localOrderId: orderId,
						method,
						amount,
						tip,
						status,
						guestNumber,
						ref
					});
				}
			} catch (firebaseErr) {
				console.error('[Payments] Failed to sync to Firebase:', firebaseErr.message);
			}
			
			res.json({ success:true, paymentId: result.lastID, createdAt });
		} catch (e) {
			console.error('Failed to create payment:', e);
			res.status(500).json({ success:false, error:'Failed to create payment' });
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