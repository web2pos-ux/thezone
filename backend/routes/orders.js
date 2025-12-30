const express = require('express');
const router = express.Router();
const firebaseService = require('../services/firebaseService');
const remoteSyncService = require('../services/remoteSyncService');
const posLockService = require('../services/posLockService');

/**
 * Orders API Routes
 * 
 * 최근 수정 (2025-10-23):
 * - table_id 컬럼 추가 (테이블 Move/Merge 기능 지원)
 * - POST /orders에서 tableId 파라미터 수신
 */

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

	// one-time init: ensure tables and indexes exist (sequential)
	(async () => {
		try {
			await dbRun(`CREATE TABLE IF NOT EXISTS orders (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				order_number TEXT,
				order_type TEXT,
				total REAL,
				status TEXT DEFAULT 'PENDING',
				created_at TEXT,
				closed_at TEXT,
				table_id TEXT,
				server_id TEXT,
				server_name TEXT,
				customer_phone TEXT,
				customer_name TEXT,
				fulfillment_mode TEXT,
				ready_time TEXT,
				pickup_minutes INTEGER
			)`);
			await dbRun(`CREATE TABLE IF NOT EXISTS order_items (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				order_id INTEGER,
				item_id TEXT,
				name TEXT,
				quantity INTEGER,
				price REAL,
				guest_number INTEGER,
				modifiers_json TEXT,
				memo_json TEXT,
				discount_json TEXT,
				split_denominator INTEGER,
				order_line_id TEXT,
				FOREIGN KEY(order_id) REFERENCES orders(id)
			)`);
			// Runtime migration: ensure columns exist
			try { await dbRun(`ALTER TABLE orders ADD COLUMN table_id TEXT`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE orders ADD COLUMN server_id TEXT`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE orders ADD COLUMN server_name TEXT`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE orders ADD COLUMN customer_phone TEXT`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE orders ADD COLUMN customer_name TEXT`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE orders ADD COLUMN fulfillment_mode TEXT`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE orders ADD COLUMN ready_time TEXT`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE orders ADD COLUMN pickup_minutes INTEGER`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE orders ADD COLUMN firebase_order_id TEXT`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`CREATE INDEX IF NOT EXISTS idx_orders_firebase_order_id ON orders(firebase_order_id)`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE order_items ADD COLUMN guest_number INTEGER`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE order_items ADD COLUMN modifiers_json TEXT`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE order_items ADD COLUMN memo_json TEXT`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE order_items ADD COLUMN discount_json TEXT`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE order_items ADD COLUMN split_denominator INTEGER`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE order_items ADD COLUMN order_line_id TEXT`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE order_items ADD COLUMN tax REAL DEFAULT 0`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE order_items ADD COLUMN tax_rate REAL DEFAULT 0`); } catch (e) { /* ignore if exists */ }
			await dbRun(`CREATE TABLE IF NOT EXISTS order_adjustments (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				order_id INTEGER,
				kind TEXT,
				mode TEXT,
				value REAL,
				amount_applied REAL,
				label TEXT,
				created_at TEXT DEFAULT (datetime('now')),
				FOREIGN KEY(order_id) REFERENCES orders(id)
			)`);
			try { await dbRun(`ALTER TABLE order_adjustments ADD COLUMN label TEXT`); } catch (e) { /* ignore if exists */ }
            await dbRun(`CREATE INDEX IF NOT EXISTS idx_orders_type_status_created ON orders(UPPER(order_type), status, created_at)`);
            await dbRun(`CREATE INDEX IF NOT EXISTS idx_adjustments_order_kind ON order_adjustments(order_id, kind)`);
            // Guest status persistence (paid/partial/unpaid + lock)
            await dbRun(`CREATE TABLE IF NOT EXISTS order_guest_status (
                order_id INTEGER NOT NULL,
                guest_number INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'UNPAID',
                locked INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT DEFAULT (datetime('now')),
                PRIMARY KEY(order_id, guest_number)
            )`);
            await dbRun(`CREATE INDEX IF NOT EXISTS idx_guest_status_order ON order_guest_status(order_id)`);
		} catch (e) {
			try { console.warn('orders init warning:', e && e.message ? e.message : e); } catch {}
		}
	})();

	// Close order (mark as PAID) and release linked table
	router.post('/:id/close', async (req, res) => {
		try {
			const orderId = Number(req.params.id);
			const closedAt = new Date().toISOString();

			// Multi-POS conflict prevention: table lock (if the order is linked to a table)
			try {
				const row = await dbGet(`SELECT table_id FROM orders WHERE id = ?`, [orderId]);
				const tableId = row && row.table_id ? String(row.table_id) : null;
				if (tableId) {
					const restaurantId = remoteSyncService.getRestaurantId();
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
			} catch {}

			await dbRun(`UPDATE orders SET order_type = UPPER(order_type), status = 'PAID', closed_at = ? WHERE id = ?`, [closedAt, orderId]);
			// Atomically release any table linked to this order
			await dbRun(`UPDATE table_map_elements SET current_order_id = NULL, status = 'Preparing' WHERE current_order_id = ?`, [orderId]);
			
			// Firebase 주문 상태 업데이트
			try {
				const order = await dbGet(`SELECT firebase_order_id FROM orders WHERE id = ?`, [orderId]);
				if (order && order.firebase_order_id) {
					await firebaseService.updatePosOrder(order.firebase_order_id, {
						status: 'pos_paid',
						closedAt: closedAt
					});
				}
			} catch (firebaseErr) {
				console.error('[Orders] Failed to update Firebase status:', firebaseErr.message);
			}

			// Release table lock (best-effort)
			try {
				const restaurantId = remoteSyncService.getRestaurantId();
				const row = await dbGet(`SELECT table_id FROM orders WHERE id = ?`, [orderId]);
				const tableId = row && row.table_id ? String(row.table_id) : null;
				if (restaurantId && tableId) await posLockService.releaseTableLock(restaurantId, tableId);
			} catch {}
			
			res.json({ success: true, closedAt });
		} catch (e) {
			console.error('Failed to close order:', e);
			res.status(500).json({ success:false, error: 'Failed to close order' });
		}
	});

	// Update order status (e.g., PENDING, READY, PICKED_UP)
	router.patch('/:id/status', async (req, res) => {
		try {
			const orderId = Number(req.params.id);
			const next = (req.body && req.body.status) ? String(req.body.status).toUpperCase() : '';
			if (!next) return res.status(400).json({ success:false, error:'status is required' });
			await dbRun(`UPDATE orders SET status = ? WHERE id = ?`, [next, orderId]);
			res.json({ success:true });
		} catch (e) {
			console.error('Failed to update order status:', e);
			res.status(500).json({ success:false, error:'Failed to update order status' });
		}
	});

// Get guest status map for an order
router.get('/:id/guest-status', async (req, res) => {
    try {
        const orderId = Number(req.params.id);
        const rows = await dbAll(`SELECT guest_number AS guestNumber, status, locked, updated_at AS updatedAt FROM order_guest_status WHERE order_id = ? ORDER BY guest_number ASC`, [orderId]);
        res.json({ success: true, statuses: rows });
    } catch (e) {
        console.error('Failed to fetch guest status:', e);
        res.status(500).json({ success:false, error: 'Failed to fetch guest status' });
    }
});

// Bulk upsert guest status for an order
router.post('/:id/guest-status/bulk', async (req, res) => {
    try {
        const orderId = Number(req.params.id);
        const list = Array.isArray(req.body?.statuses) ? req.body.statuses : [];
        await dbRun('BEGIN');
        for (const row of list) {
            const g = Number(row.guestNumber);
            const status = String(row.status || 'UNPAID').toUpperCase();
            const locked = row.locked ? 1 : 0;
            await dbRun(`INSERT INTO order_guest_status(order_id, guest_number, status, locked, updated_at)
                        VALUES(?, ?, ?, ?, datetime('now'))
                        ON CONFLICT(order_id, guest_number) DO UPDATE SET status=excluded.status, locked=excluded.locked, updated_at=datetime('now')`, [orderId, g, status, locked]);
        }
        await dbRun('COMMIT');
        res.json({ success:true, updated:list.length });
    } catch (e) {
        try { await dbRun('ROLLBACK'); } catch {}
        console.error('Failed to upsert guest status:', e);
        res.status(500).json({ success:false, error: 'Failed to save guest status' });
    }
});

	// List orders by optional filters
	router.get('/', async (req, res) => {
		try {
			const q = req.query || {};
			const type = q.type;
			const status = q.status;
			const date = q.date; // YYYY-MM-DD format
			const limit = q.limit || 500;
			const customerPhone = q.customerPhone ? String(q.customerPhone).trim() : '';
			const customerName = q.customerName ? String(q.customerName).trim() : '';
			const clauses = [];
			const params = [];
			
			console.log('[GET /orders] Query params:', { type, status, date, limit, customerPhone, customerName });
			
			if (type) { clauses.push('order_type = ?'); params.push(String(type).toUpperCase()); }
			if (status) { clauses.push('status = ?'); params.push(String(status).toUpperCase()); }
			// 날짜 필터 추가 (created_at이 해당 날짜에 해당하는 주문만 조회)
			// ISO 형식 (2025-12-10T14:30:00.000Z) 지원을 위해 LIKE 사용
			if (date) {
				clauses.push(`created_at LIKE ?`);
				params.push(`${date}%`);
				console.log('[GET /orders] Date filter applied:', date);
			}
			if (customerPhone) {
				const digitsOnly = customerPhone.replace(/\D/g, '');
				if (digitsOnly) {
					clauses.push(`REPLACE(REPLACE(REPLACE(customer_phone, '-', ''), '(', ''), ')', '') LIKE ?`);
					params.push(`${digitsOnly}%`);
				} else {
					clauses.push('customer_phone LIKE ?');
					params.push(`${customerPhone}%`);
				}
			}
			if (customerName) {
				clauses.push('LOWER(customer_name) LIKE ?');
				params.push(`%${customerName.toLowerCase()}%`);
			}
			const whereClause = clauses.length ? ('WHERE ' + clauses.map(c => c.replace('order_type = ?', 'UPPER(order_type) = ?')).join(' AND ')) : '';
			const sql = `SELECT id, order_number, order_type, total, status, created_at, closed_at, table_id, server_id, server_name, customer_phone, customer_name, fulfillment_mode, ready_time, pickup_minutes, order_source FROM orders ${whereClause} ORDER BY id DESC LIMIT ?`;
			console.log('[GET /orders] SQL:', sql);
			console.log('[GET /orders] Params:', [...params, Number(limit)]);
			const rows = await dbAll(sql, [...params, Number(limit)]);
			console.log('[GET /orders] Results count:', rows.length);
			if (rows.length > 0) {
				console.log('[GET /orders] First order created_at:', rows[0].created_at);
			}
			res.json({ success:true, orders: rows });
		} catch (e) {
			console.error('Failed to list orders:', e);
			res.status(500).json({ success:false, error:'Failed to list orders' });
		}
	});

	// Get order with items by id
	router.get('/:id', async (req, res) => {
		try {
			const orderId = Number(req.params.id);
			const order = await dbGet(`SELECT id, order_number, order_type, total, status, created_at, closed_at, table_id, server_id, server_name, customer_phone, customer_name, fulfillment_mode, ready_time, pickup_minutes, order_source FROM orders WHERE id = ?`, [orderId]);
			if (!order) return res.status(404).json({ success:false, error:'Order not found' });
			const items = await dbAll(`SELECT id, item_id, name, quantity, price, guest_number, modifiers_json, memo_json, discount_json, split_denominator, order_line_id, item_source FROM order_items WHERE order_id = ? ORDER BY id ASC`, [orderId]);
			const adjustments = await dbAll(`SELECT id, kind, mode, value, amount_applied, label, created_at FROM order_adjustments WHERE order_id = ? ORDER BY id ASC`, [orderId]);
			res.json({ success:true, order, items, adjustments });
		} catch (e) {
			console.error('Failed to fetch order:', e);
			res.status(500).json({ success:false, error:'Failed to fetch order' });
		}
	});

	// Delete order entirely (void entire order) and unlink any linked table
	router.delete('/:id', async (req, res) => {
		try {
			const orderId = Number(req.params.id);
			await dbRun('BEGIN');
			try {
				await dbRun(`DELETE FROM order_adjustments WHERE order_id = ?`, [orderId]);
			} catch (e) { /* ignore if table not exists */ }
			await dbRun(`DELETE FROM order_items WHERE order_id = ?`, [orderId]);
			await dbRun(`DELETE FROM orders WHERE id = ?`, [orderId]);
			// Unlink any table referencing this order and set to Available
			try {
				await dbRun(`UPDATE table_map_elements SET current_order_id = NULL, status = 'Available' WHERE current_order_id = ?`, [orderId]);
			} catch (e) { /* ignore if table not exists */ }
			await dbRun('COMMIT');
			res.json({ success: true });
		} catch (e) {
			try { await dbRun('ROLLBACK'); } catch {}
			console.error('Failed to delete order:', e);
			res.status(500).json({ success:false, error: 'Failed to delete order' });
		}
	});

	// Replace order items and total for an existing order
	router.put('/:id', async (req, res) => {
		try {
			const orderId = Number(req.params.id);
			const { items = [], adjustments = [], total = 0, customerPhone, customerName, readyTime, pickupMinutes, fulfillmentMode } = req.body || {};
			await dbRun('BEGIN');
			// Replace items
			await dbRun(`DELETE FROM order_items WHERE order_id = ?`, [orderId]);
			for (const it of (Array.isArray(items) ? items : [])) {
				await dbRun(`INSERT INTO order_items(order_id, item_id, name, quantity, price, guest_number, modifiers_json, memo_json, discount_json, split_denominator, order_line_id, tax, tax_rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
					orderId,
					String(it.id||''),
					it.name||'',
					it.quantity||1,
					Number(it.price||it.totalPrice||0),
					Number(it.guestNumber||it.guest_number||1),
					JSON.stringify(it.modifiers||[]),
					it.memo ? JSON.stringify(it.memo) : null,
					it.discount ? JSON.stringify(it.discount) : null,
					(it.splitDenominator || it.split_denominator || null),
					String(it.orderLineId||it.order_line_id||'')||null,
					Number(it.tax || 0),
					Number(it.taxRate || it.tax_rate || 0)
				]);
			}
			// Replace adjustments
			await dbRun(`DELETE FROM order_adjustments WHERE order_id = ?`, [orderId]);
			for (const adj of (Array.isArray(adjustments) ? adjustments : [])) {
				await dbRun(`INSERT INTO order_adjustments(order_id, kind, mode, value, amount_applied, label) VALUES (?, ?, ?, ?, ?, ?)`, [
					orderId,
					String(adj.kind||''),
					String(adj.mode||''),
					Number(adj.value||0),
					Number(adj.amountApplied||adj.amount_applied||0),
					adj.label != null ? String(adj.label) : null
				]);
			}
			// Update order total
			const updateFields = ['total = ?'];
			const updateParams = [Number(total||0)];
			if (Object.prototype.hasOwnProperty.call(req.body || {}, 'serverId')) {
				updateFields.push('server_id = ?');
				updateParams.push(req.body.serverId || null);
			}
			if (Object.prototype.hasOwnProperty.call(req.body || {}, 'serverName')) {
				updateFields.push('server_name = ?');
				updateParams.push(req.body.serverName || null);
			}
			if (Object.prototype.hasOwnProperty.call(req.body || {}, 'customerPhone')) {
				updateFields.push('customer_phone = ?');
				updateParams.push(customerPhone || null);
			}
			if (Object.prototype.hasOwnProperty.call(req.body || {}, 'customerName')) {
				updateFields.push('customer_name = ?');
				updateParams.push(customerName || null);
			}
			if (Object.prototype.hasOwnProperty.call(req.body || {}, 'fulfillmentMode')) {
				updateFields.push('fulfillment_mode = ?');
				updateParams.push(fulfillmentMode ? String(fulfillmentMode).toUpperCase() : null);
			}
			if (Object.prototype.hasOwnProperty.call(req.body || {}, 'readyTime')) {
				updateFields.push('ready_time = ?');
				updateParams.push(readyTime || null);
			}
			if (Object.prototype.hasOwnProperty.call(req.body || {}, 'pickupMinutes')) {
				updateFields.push('pickup_minutes = ?');
				updateParams.push(Number.isFinite(pickupMinutes) ? Number(pickupMinutes) : null);
			}
			updateParams.push(orderId);
			await dbRun(`UPDATE orders SET ${updateFields.join(', ')} WHERE id = ?`, updateParams);
			await dbRun('COMMIT');
			res.json({ success: true });
		} catch (e) {
			try { await dbRun('ROLLBACK'); } catch {}
			console.error('Failed to update order:', e);
			res.status(500).json({ success:false, error: 'Failed to update order' });
		}
	});

	// Create order & items (+optional adjustments)
	router.post('/', async (req, res) => {
		try {
			const { orderNumber, orderType, total, items = [], adjustments = [], tableId, serverId, serverName, customerPhone, customerName, readyTime, pickupMinutes, fulfillmentMode } = req.body || {};
			const createdAt = new Date().toISOString();

			// Multi-POS conflict prevention: lock the table before creating a new order
			try {
				if (tableId) {
					const restaurantId = remoteSyncService.getRestaurantId();
					const lock = await posLockService.acquireTableLock(restaurantId, String(tableId));
					if (!lock.ok) {
						return res.status(409).json({
							success: false,
							error: '이 테이블은 다른 POS에서 사용 중입니다. 잠시 후 다시 시도해주세요.',
							ownerId: lock.ownerId,
							expiresAtMs: lock.expiresAtMs
						});
					}
				}
			} catch {}

			const result = await dbRun(
				`INSERT INTO orders(order_number, order_type, total, created_at, table_id, server_id, server_name, customer_phone, customer_name, fulfillment_mode, ready_time, pickup_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[orderNumber || null, orderType || null, total || 0, createdAt, tableId || null, serverId || null, serverName || null, customerPhone || null, customerName || null, fulfillmentMode ? String(fulfillmentMode).toUpperCase() : null, readyTime || null, Number.isFinite(pickupMinutes) ? Number(pickupMinutes) : null]
			);
			const orderId = result.lastID;
			for (const it of items) {
				await dbRun(`INSERT INTO order_items(order_id, item_id, name, quantity, price, guest_number, modifiers_json, memo_json, discount_json, split_denominator, order_line_id, tax, tax_rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
					orderId,
					String(it.id||''),
					it.name||'',
					it.quantity||1,
					Number(it.price||it.totalPrice||0),
					Number(it.guestNumber||it.guest_number||1),
					JSON.stringify(it.modifiers||[]),
					it.memo ? JSON.stringify(it.memo) : null,
					it.discount ? JSON.stringify(it.discount) : null,
					(it.splitDenominator || it.split_denominator || null),
					String(it.orderLineId||it.order_line_id||'')||null,
					Number(it.tax || 0),
					Number(it.taxRate || it.tax_rate || 0)
				]);
			}
			if (Array.isArray(adjustments)) {
				for (const adj of adjustments) {
					await dbRun(`INSERT INTO order_adjustments(order_id, kind, mode, value, amount_applied, label) VALUES (?, ?, ?, ?, ?, ?)`,
						[orderId, String(adj.kind||''), String(adj.mode||''), Number(adj.value||0), Number(adj.amountApplied||adj.amount_applied||0), adj.label != null ? String(adj.label) : null]);
				}
			}

			// 파이어베이스로 주문 업로드 (Dashboard 연동)
			let firebaseOrderId = null;
			try {
				const restaurantId = remoteSyncService.getRestaurantId();
				if (restaurantId) {
					firebaseOrderId = await firebaseService.uploadOrder(restaurantId, {
						orderNumber: orderNumber || orderId,
						orderType: orderType || 'POS',
						status: 'pos_pending',
						items: items.map(it => ({
							name: it.name || '',
							price: Number(it.price || it.totalPrice || 0),
							quantity: Number(it.quantity || 1),
							subtotal: Number(it.price || it.totalPrice || 0) * Number(it.quantity || 1),
							options: it.modifiers || []
						})),
						total: total || 0,
						tableId: tableId || '',
						customerName: customerName || 'POS Order',
						customerPhone: customerPhone || '',
						source: 'POS',
						localOrderId: orderId
					});
					
					// Firebase ID를 SQLite에 저장
					if (firebaseOrderId) {
						await dbRun(`UPDATE orders SET firebase_order_id = ? WHERE id = ?`, [firebaseOrderId, orderId]);
					}
				}
			} catch (firebaseErr) {
				console.error('[Orders] Failed to upload to Firebase:', firebaseErr.message);
			}

			res.json({ success: true, orderId, createdAt, firebaseOrderId });
		} catch (e) {
			console.error('Failed to save order:', e);
			res.status(500).json({ success:false, error: 'Failed to save order' });
		}
	});

	return router;
}; 