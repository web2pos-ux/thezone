const express = require('express');
const router = express.Router();
const firebaseService = require('../services/firebaseService');
const remoteSyncService = require('../services/remoteSyncService');
const salesSyncService = require('../services/salesSyncService');
const { getLocalDatetimeString } = require('../utils/datetimeUtils');
const { resolveServicePattern } = require('../utils/orderServicePattern');

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

	// Delivery order normalization:
	// - Any order created via Delivery button (QSR/FSR) should be treated as DELIVERY
	// - Any third-party delivery order (e.g., UrbanPiper) should also be treated as DELIVERY
	// - Delivery orders are assumed prepaid -> always PAID and should have an APPROVED payment record
	const DELIVERY_ORDER_TYPES = new Set([
		'DELIVERY',
		'UBEREATS',
		'UBER',
		'DOORDASH',
		'SKIP',
		'SKIPTHEDISHES',
		'SKIP_THE_DISHES',
		'FANTUAN',
	]);
	const PAID_LIKE_STATUSES = new Set(['PAID', 'COMPLETED', 'CLOSED', 'PICKED_UP', 'REFUNDED']);

	const normalizeToUpper = (v) => (v == null ? '' : String(v)).trim().toUpperCase();

	const isDeliveryLikeOrder = ({ orderType, fulfillmentMode, tableId, orderSource }) => {
		const typeU = normalizeToUpper(orderType);
		const fulfillU = normalizeToUpper(fulfillmentMode);
		const tableU = normalizeToUpper(tableId);
		const sourceU = normalizeToUpper(orderSource);
		if (DELIVERY_ORDER_TYPES.has(typeU)) return true;
		if (fulfillU === 'DELIVERY') return true;
		// Common virtual table id convention used in QSR
		if (tableU.startsWith('DL')) return true;
		// Future-proof: UrbanPiper/aggregator sources
		if (sourceU.includes('URBAN') || sourceU.includes('PIPER') || sourceU.includes('UBER') || sourceU.includes('DOORDASH') || sourceU.includes('SKIP') || sourceU.includes('FANTUAN')) {
			return true;
		}
		return false;
	};

	function resolveAdjustmentAppliedBy(adj, reqBody) {
		const body = reqBody && typeof reqBody === 'object' ? reqBody : {};
		const a = adj && typeof adj === 'object' ? adj : {};
		const rawId = a.appliedByEmployeeId ?? a.applied_by_employee_id ?? body.adjustmentAppliedByEmployeeId ?? body.adjustment_applied_by_employee_id;
		const rawName = a.appliedByName ?? a.applied_by_name ?? body.adjustmentAppliedByName ?? body.adjustment_applied_by_name;
		const appliedByEmployeeId = rawId != null && String(rawId).trim() !== '' ? String(rawId).trim() : null;
		const appliedByName = rawName != null && String(rawName).trim() !== '' ? String(rawName).trim() : null;
		return { appliedByEmployeeId, appliedByName };
	}

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
				split_numerator INTEGER,
				order_line_id TEXT,
				FOREIGN KEY(order_id) REFERENCES orders(id)
			)`);
			// payments table is required for closing/reporting. Ensure it exists (idempotent).
			await dbRun(`CREATE TABLE IF NOT EXISTS payments (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				order_id INTEGER,
				payment_method TEXT,
				amount REAL,
				tip REAL DEFAULT 0,
				ref TEXT,
				status TEXT DEFAULT 'APPROVED',
				guest_number INTEGER,
				created_at TEXT,
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
			try { await dbRun(`ALTER TABLE orders ADD COLUMN kitchen_note TEXT`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE orders ADD COLUMN tax REAL DEFAULT 0`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE orders ADD COLUMN tax_rate REAL DEFAULT 0`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE orders ADD COLUMN tax_breakdown TEXT`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE orders ADD COLUMN adjustments_json TEXT`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE orders ADD COLUMN subtotal REAL DEFAULT 0`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE orders ADD COLUMN order_mode TEXT`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE orders ADD COLUMN order_source TEXT`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE orders ADD COLUMN online_order_number TEXT`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE orders ADD COLUMN payment_status TEXT DEFAULT 'pending'`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE orders ADD COLUMN paid_at TEXT`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE order_items ADD COLUMN guest_number INTEGER`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE order_items ADD COLUMN modifiers_json TEXT`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE order_items ADD COLUMN memo_json TEXT`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE order_items ADD COLUMN discount_json TEXT`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE order_items ADD COLUMN split_denominator INTEGER`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE order_items ADD COLUMN split_numerator INTEGER`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE order_items ADD COLUMN order_line_id TEXT`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE order_items ADD COLUMN tax REAL DEFAULT 0`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE order_items ADD COLUMN tax_rate REAL DEFAULT 0`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE order_items ADD COLUMN togo_label INTEGER DEFAULT 0`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE order_items ADD COLUMN tax_group_id INTEGER`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE order_items ADD COLUMN printer_group_id INTEGER`); } catch (e) { /* ignore if exists */ }
			await dbRun(`CREATE TABLE IF NOT EXISTS order_adjustments (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				order_id INTEGER,
				kind TEXT,
				mode TEXT,
				value REAL,
				amount_applied REAL,
				label TEXT,
				applied_by_employee_id TEXT,
				applied_by_name TEXT,
				created_at TEXT DEFAULT (datetime('now')),
				FOREIGN KEY(order_id) REFERENCES orders(id)
			)`);
			try { await dbRun(`ALTER TABLE order_adjustments ADD COLUMN label TEXT`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE order_adjustments ADD COLUMN applied_by_employee_id TEXT`); } catch (e) { /* ignore if exists */ }
			try { await dbRun(`ALTER TABLE order_adjustments ADD COLUMN applied_by_name TEXT`); } catch (e) { /* ignore if exists */ }
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

			// One-time backfill: Delivery-like orders must be PAID and have a payment record.
			// This unblocks closing on already-built apps/databases.
			try {
				const candidates = await dbAll(`
					SELECT o.id, o.order_number, o.order_type, o.status, o.total, o.created_at, o.closed_at, o.table_id, o.fulfillment_mode, o.order_source
					FROM orders o
					WHERE (
						UPPER(COALESCE(o.order_type, '')) IN ('DELIVERY','UBEREATS','UBER','DOORDASH','SKIP','SKIPTHEDISHES','SKIP_THE_DISHES','FANTUAN')
						OR UPPER(COALESCE(o.fulfillment_mode, '')) = 'DELIVERY'
						OR UPPER(COALESCE(o.table_id, '')) LIKE 'DL%'
						OR UPPER(COALESCE(o.order_source, '')) LIKE '%URBAN%'
						OR UPPER(COALESCE(o.order_source, '')) LIKE '%PIPER%'
					)
					AND UPPER(COALESCE(o.status, '')) NOT IN ('CANCELLED','VOIDED','MERGED')
					ORDER BY o.id ASC
				`);

				let updatedOrders = 0;
				let insertedPayments = 0;
				for (const o of candidates) {
					const isDelivery = isDeliveryLikeOrder({
						orderType: o.order_type,
						fulfillmentMode: o.fulfillment_mode,
						tableId: o.table_id,
						orderSource: o.order_source,
					});
					if (!isDelivery) continue;

					const currentStatusU = normalizeToUpper(o.status);
					const needsPaidStatus = !PAID_LIKE_STATUSES.has(currentStatusU);
					const needsTypeNormalize = normalizeToUpper(o.order_type) !== 'DELIVERY';

					if (needsPaidStatus || needsTypeNormalize) {
						const closedAt = o.closed_at || o.created_at || getLocalDatetimeString();
						await dbRun(
							`UPDATE orders SET order_type = 'DELIVERY', status = 'PAID', closed_at = ? WHERE id = ?`,
							[closedAt, o.id],
						);
						updatedOrders += 1;
					}

					const pay = await dbGet(
						`SELECT id FROM payments WHERE order_id = ? AND status = 'APPROVED' LIMIT 1`,
						[o.id],
					);
					if (!pay) {
						const createdAt = o.created_at || getLocalDatetimeString();
						await dbRun(
							`INSERT INTO payments(order_id, payment_method, amount, tip, ref, status, guest_number, created_at)
							 VALUES(?,?,?,?,?,?,?,?)`,
							[o.id, 'DELIVERY', Number(o.total || 0), 0, o.order_number || null, 'APPROVED', null, createdAt],
						);
						insertedPayments += 1;
					}
				}
				if (updatedOrders > 0 || insertedPayments > 0) {
					console.log(`[Orders] Delivery backfill complete: updatedOrders=${updatedOrders}, insertedPayments=${insertedPayments}`);
				}
			} catch (bfErr) {
				console.warn('[Orders] Delivery backfill skipped:', bfErr?.message || bfErr);
			}
		} catch (e) {
			try { console.warn('orders init warning:', e && e.message ? e.message : e); } catch {}
		}
	})();

	// Close order (mark as PAID) and release linked table
	router.post('/:id/close', async (req, res) => {
		try {
			const orderId = Number(req.params.id);
			const closedAt = getLocalDatetimeString();
			const { discount, pickedUp } = req.body || {};
			const pickedUpBool = pickedUp === true || pickedUp === 'true' || pickedUp === 1;
			const closedStatus = pickedUpBool ? 'PICKED_UP' : 'PAID';

			let updateSql = `UPDATE orders SET order_type = UPPER(order_type), status = ?, closed_at = ?, payment_status = 'PAID', paid_at = ?`;
			const updateParams = [closedStatus, closedAt, closedAt];

			if (discount && typeof discount === 'object' && discount.percent > 0) {
				const discountedTotal = Number(((discount.discountedSubtotal || 0) + (discount.taxesTotal || 0)).toFixed(2));
				updateSql += `, subtotal = ?, tax = ?, total = ?, adjustments_json = ?`;
				updateParams.push(
					Number((discount.discountedSubtotal || 0).toFixed(2)),
					Number((discount.taxesTotal || 0).toFixed(2)),
					discountedTotal,
					JSON.stringify([{
						label: `Discount (${discount.percent}%)`,
						amount: -Number((discount.amount || 0).toFixed(2)),
						percent: discount.percent,
						originalSubtotal: discount.originalSubtotal
					}])
				);
			}

			updateSql += ` WHERE id = ?`;
			updateParams.push(orderId);
			await dbRun(updateSql, updateParams);
			// Atomically release any table linked to this order
			await dbRun(`UPDATE table_map_elements SET current_order_id = NULL, status = 'Available' WHERE current_order_id = ?`, [orderId]);
			
			// Firebase 주문/매출 동기화 (POS → Firebase orders → aggregateDailySalesOnOrderWrite)
			try {
				const restaurantId = process.env.FIREBASE_RESTAURANT_ID || null;
				if (restaurantId) {
					const orderData = await dbGet(`SELECT * FROM orders WHERE id = ?`, [orderId]);
					const payments = await dbAll(`SELECT * FROM payments WHERE order_id = ? AND status = 'APPROVED'`, [orderId]);
					const orderItems = await dbAll(`SELECT * FROM order_items WHERE order_id = ?`, [orderId]);
					if (orderData && payments.length > 0) {
						const totalPayment = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
						const totalTips = payments.reduce((sum, p) => sum + (p.tip || 0), 0);
						const paymentMethod = (payments[0]?.method || 'CASH').toLowerCase().replace(/\s+/g, '_');
						const firebaseOrderId = orderData.firebase_order_id;
						if (firebaseOrderId) {
							await firebaseService.updateOrderStatus(firebaseOrderId, 'completed', restaurantId);
							await firebaseService.updateOrderAsPaid(restaurantId, firebaseOrderId, {
								paymentMethod,
								tip: totalTips
							});
						} else if (!pickedUpBool) {
							// Pay & Pickup(픽업 완료) 시: 새 Firebase orders 문서를 만들지 않음 → 투고패널/온라인 큐에 유령 카드 방지
							const items = orderItems.map(oi => ({
								name: oi.name,
								quantity: oi.quantity || 1,
								price: oi.price || 0,
								subtotal: (oi.quantity || 1) * (oi.price || 0),
								menuItemId: oi.item_id
							}));
							const payload = {
								...orderData,
								items,
								status: 'completed',
								paymentStatus: 'paid',
								paymentMethod,
								tip: totalTips,
								paidAt: orderData.closed_at || orderData.created_at,
								source: 'POS'
							};
							firebaseService.uploadOrder(restaurantId, payload).catch(err => console.warn('[Firebase] Order upload error:', err.message));
						}
						salesSyncService.syncPaymentToFirebase(
							{ ...orderData, items: orderItems },
							{ amount: totalPayment, tip: totalTips, method: payments[0]?.method || 'CASH' },
							restaurantId,
							{ skipDailySales: true }
						).catch(err => console.warn('[SalesSync] Background sync error:', err.message));
						if (orderItems.length > 0) {
							salesSyncService.syncOrderItemsToFirebase(
								{ ...orderData, items: orderItems },
								restaurantId
							).catch(err => console.warn('[SalesSync] Item sync error:', err.message));
						}
					}
				}
			} catch (syncErr) {
				console.warn('[Firebase] Sync skipped:', syncErr.message);
			}
			
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

// Update service_charge (gratuity) for an order
router.patch('/:id/service-charge', async (req, res) => {
    try {
        const orderId = Number(req.params.id);
        const serviceCharge = Number(req.body.service_charge || 0);
        await dbRun(`UPDATE orders SET service_charge = ? WHERE id = ?`, [serviceCharge, orderId]);
        res.json({ success: true });
    } catch (e) {
        console.error('Failed to update service_charge:', e);
        res.status(500).json({ success: false, error: 'Failed to update service_charge' });
    }
});

// Update kitchen note for an order
router.patch('/:id/kitchen-note', async (req, res) => {
    try {
        const orderId = Number(req.params.id);
        const kitchenNote = req.body?.kitchenNote || null;
        await dbRun(`UPDATE orders SET kitchen_note = ? WHERE id = ?`, [kitchenNote, orderId]);
        res.json({ success: true, kitchenNote });
    } catch (e) {
        console.error('Failed to update kitchen note:', e);
        res.status(500).json({ success: false, error: 'Failed to update kitchen note' });
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
			const panel = String(q.panel || '').trim() === '1'; // 세일즈 투고패널용: 종료 주문·빈 주문 제외
			const clauses = [];
			const params = [];
			
			// order_mode(QSR/FSR)는 목록·필터·추출에 사용하지 않음 — 현재 화면 모드와 무관하게 동일 DB의 전체 주문 조회
			console.log('[GET /orders] Query params:', { type, status, date, limit, customerPhone, customerName, panel });
			
			if (type) {
				const types = String(type).split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
				if (types.length === 1) {
					clauses.push('UPPER(o.order_type) = ?');
					params.push(types[0]);
				} else if (types.length > 1) {
					clauses.push(`UPPER(o.order_type) IN (${types.map(() => '?').join(',')})`);
					params.push(...types);
				}
				// 패널 배달만: 라인이 없는 orders 행은 상세 Loading 실패·좀비 카드로 남는 경우가 많음
				if (panel && types.length === 1 && types[0] === 'DELIVERY') {
					clauses.push(`EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id)`);
				}
			}
			if (panel && type) {
				clauses.push(
					`UPPER(COALESCE(o.status, '')) NOT IN ('PICKED_UP','CANCELLED','MERGED','CLOSED','VOIDED','VOID','REFUNDED')`
				);
			}
			if (status) {
				const statuses = String(status).split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
				if (statuses.length === 1) {
					clauses.push('o.status = ?');
					params.push(statuses[0]);
				} else if (statuses.length > 1) {
					clauses.push(`o.status IN (${statuses.map(() => '?').join(',')})`);
					params.push(...statuses);
				}
			}
			const pickupPending = q.pickup_pending === '1';
			const servicePatternFilter = q.service_pattern ? String(q.service_pattern).trim().toUpperCase() : '';
			if (pickupPending) {
				clauses.push(`UPPER(o.status) NOT IN ('PICKED_UP','VOIDED','VOID','REFUNDED')`);
				clauses.push(`o.service_pattern = 'TAKEOUT'`);
				// pickup_pending = Pickup List 전용 — session_scope 쿼리 유무와 관계없이 항상 «현재 오픈 영업일 세션»만 (클로징 후 미오픈이면 빈 목록)
				const openRow = await dbGet(
					`SELECT opened_at, date AS business_date, session_id FROM daily_closings WHERE status = 'open' ORDER BY datetime(opened_at) DESC LIMIT 1`
				);
				const openedAt = openRow?.opened_at ? String(openRow.opened_at).trim() : '';
				if (!openedAt) {
					console.log('[GET /orders] pickup_pending: no open business day — empty pickup list');
					return res.json({ success: true, orders: [] });
				}
				clauses.push(`datetime(o.created_at) >= datetime(?)`);
				params.push(openedAt);
				console.log('[GET /orders] pickup_pending: current session only, created_at >=', openedAt, openRow?.session_id || '');
			} else if (date) {
				const sessionScope = String(q.session_scope || '').trim() === '1';
				const sessionIdParam = q.session_id ? String(q.session_id).trim() : '';
				if (sessionScope) {
					let sess = null;
					if (sessionIdParam) {
						sess = await dbGet(
							`SELECT opened_at, closed_at, date AS business_date, session_id, status FROM daily_closings WHERE session_id = ?`,
							[sessionIdParam]
						);
					} else {
						const openRow = await dbGet(
							`SELECT opened_at, closed_at, date AS business_date, session_id, status FROM daily_closings WHERE status = 'open' ORDER BY datetime(opened_at) DESC LIMIT 1`
						);
						const d = String(date).trim();
						if (openRow && String(openRow.business_date || '').trim() === d) {
							sess = openRow;
						} else {
							const dayStart = `${d} 00:00:00`;
							const dayEnd = `${d} 23:59:59`;
							sess = await dbGet(
								`SELECT opened_at, closed_at, date AS business_date, session_id, status FROM daily_closings
								 WHERE opened_at IS NOT NULL AND trim(opened_at) != ''
								   AND datetime(opened_at) <= datetime(?)
								   AND (
								     UPPER(COALESCE(status,'')) = 'OPEN'
								     OR (closed_at IS NOT NULL AND trim(closed_at) != '' AND datetime(closed_at) >= datetime(?))
								   )
								 ORDER BY datetime(opened_at) DESC LIMIT 1`,
								[dayEnd, dayStart]
							);
						}
					}
					const openedAt = sess?.opened_at ? String(sess.opened_at).trim() : '';
					if (openedAt) {
						const isOpen = String(sess.status || '').toLowerCase() === 'open';
						const closedAt = sess.closed_at ? String(sess.closed_at).trim() : '';
						if (isOpen || !closedAt) {
							clauses.push(`datetime(o.created_at) >= datetime(?)`);
							params.push(openedAt);
						} else {
							clauses.push(`datetime(o.created_at) >= datetime(?) AND datetime(o.created_at) <= datetime(?)`);
							params.push(openedAt, closedAt);
						}
						console.log('[GET /orders] session_scope: day session window', sess.session_id, openedAt, isOpen ? 'open' : closedAt);
					} else {
						clauses.push(`o.created_at LIKE ?`);
						params.push(`${date}%`);
						console.log('[GET /orders] session_scope: no session — fallback calendar', date);
					}
				} else {
					clauses.push(`o.created_at LIKE ?`);
					params.push(`${date}%`);
					console.log('[GET /orders] Date filter applied:', date);
				}
			}
			if (customerPhone) {
				const digitsOnly = customerPhone.replace(/\D/g, '');
				if (digitsOnly) {
					// 공백, 괄호, 하이픈 모두 제거하여 숫자만 비교 (시작 일치)
					clauses.push(`REPLACE(REPLACE(REPLACE(REPLACE(o.customer_phone, '-', ''), '(', ''), ')', ''), ' ', '') LIKE ?`);
					params.push(`${digitsOnly}%`);  // 시작 일치
				} else {
					clauses.push('o.customer_phone LIKE ?');
					params.push(`${customerPhone}%`);
				}
			}
			if (customerName) {
				clauses.push('LOWER(o.customer_name) LIKE ?');
				params.push(`%${customerName.toLowerCase()}%`);
			}
			if (!pickupPending && (servicePatternFilter === 'TAKEOUT' || servicePatternFilter === 'DINEIN')) {
				clauses.push('o.service_pattern = ?');
				params.push(servicePatternFilter);
			}
			const whereClause = clauses.length ? ('WHERE ' + clauses.join(' AND ')) : '';
			const sql = `SELECT o.id, o.order_number, o.order_type, o.subtotal, o.tax, o.total, o.status, o.created_at, o.closed_at, o.table_id, o.server_id, o.server_name, o.customer_phone, o.customer_name, o.fulfillment_mode, o.ready_time, o.pickup_minutes, o.order_source, o.kitchen_note, o.adjustments_json, o.order_mode, o.online_order_number, o.firebase_order_id, o.service_pattern, t.name AS table_name, COALESCE((SELECT SUM(r.total) FROM refunds r WHERE r.order_id = o.id), 0) AS refunded_total FROM orders o LEFT JOIN table_map_elements t ON o.table_id = t.element_id ${whereClause} ORDER BY o.id DESC LIMIT ?`;
			console.log('[GET /orders] SQL:', sql);
			console.log('[GET /orders] Params:', [...params, Number(limit)]);
			const rows = await dbAll(sql, [...params, Number(limit)]);
			console.log('[GET /orders] Results count:', rows.length);
			if (rows.length > 0) {
				console.log('[GET /orders] First order created_at:', rows[0].created_at);
			}
			// Pickup List: Firebase→SQLite 경로에서 빠졌던 ready_time 보정(온라인·기존 행)
			if (pickupPending && rows.length > 0) {
				const DEFAULT_ONLINE_PREP = 20;
				for (const r of rows) {
					try {
						if (r.ready_time != null && String(r.ready_time).trim() !== '') continue;
						const typ = String(r.order_type || '').toUpperCase();
						const fm = String(r.fulfillment_mode || '').toLowerCase();
						const hasFb = String(r.firebase_order_id || '').trim() !== '';
						const treatAsOnline = typ === 'ONLINE' || typ === 'WEB' || typ === 'QR' || hasFb;
						const treatAsPickupChannel =
							treatAsOnline ||
							typ === 'TOGO' ||
							typ === 'TAKEOUT' ||
							typ === 'PICKUP' ||
							typ === 'DELIVERY' ||
							fm === 'delivery';
						if (!treatAsPickupChannel) continue;
						let pm = Number(r.pickup_minutes);
						if (treatAsOnline) {
							if (!Number.isFinite(pm) || pm <= 0) pm = DEFAULT_ONLINE_PREP;
						} else {
							if (!Number.isFinite(pm) || pm <= 0) continue;
						}
						const created = new Date(String(r.created_at || '').replace(' ', 'T'));
						if (Number.isNaN(created.getTime())) continue;
						const isoReady = new Date(created.getTime() + pm * 60000).toISOString();
						await dbRun(
							`UPDATE orders SET ready_time = ?, pickup_minutes = CASE WHEN pickup_minutes IS NULL OR pickup_minutes <= 0 THEN ? ELSE pickup_minutes END WHERE id = ?`,
							[isoReady, pm, r.id]
						);
						r.ready_time = isoReady;
						if (!Number.isFinite(Number(r.pickup_minutes)) || Number(r.pickup_minutes) <= 0) {
							r.pickup_minutes = pm;
						}
					} catch (bfErr) {
						console.warn('[GET /orders] pickup ready backfill', r.id, bfErr.message);
					}
				}
			}
			res.json({ success:true, orders: rows });
		} catch (e) {
			console.error('Failed to list orders:', e);
			res.status(500).json({ success:false, error:'Failed to list orders' });
		}
	});

	// ============ Delivery Orders (must be before /:id) ============
	
	// POST /api/orders/delivery-orders - Save delivery order metadata
	router.post('/delivery-orders', async (req, res) => {
		try {
			const {
				id, storeId, type, time, createdAt, name, status,
				deliveryCompany, deliveryOrderNumber, readyTimeLabel, prepTime
			} = req.body;

			if (!id) {
				return res.status(400).json({ success: false, error: 'id is required' });
			}

			// Check if exists
			const existing = await dbGet('SELECT id FROM delivery_orders WHERE id = ?', [id]);
			
			if (existing) {
				// Update
				await dbRun(`UPDATE delivery_orders SET
					store_id = ?, type = ?, time = ?, created_at = ?,
					name = ?, status = ?, delivery_company = ?, delivery_order_number = ?,
					ready_time_label = ?, prep_time = ?
					WHERE id = ?`, [
					storeId || 'STORE001', type || 'Delivery', time, createdAt,
					name || '', status || 'pending', deliveryCompany || '', deliveryOrderNumber || '',
					readyTimeLabel || '', prepTime || 0, id
				]);
			} else {
				// Insert
				await dbRun(`INSERT INTO delivery_orders (
					id, store_id, type, time, created_at, name, status,
					delivery_company, delivery_order_number, ready_time_label, prep_time
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
					id, storeId || 'STORE001', type || 'Delivery', time, createdAt,
					name || '', status || 'pending', deliveryCompany || '', deliveryOrderNumber || '',
					readyTimeLabel || '', prepTime || 0
				]);
			}

			// Firebase sync - Delivery Order (completed: pending이면 온라인 리스너·GET과 동일 컬렉션에서 중복 처리됨)
			try {
				const restaurantId = remoteSyncService.getRestaurantId();
				if (restaurantId) {
					await firebaseService.uploadOrder(restaurantId, {
						orderNumber: `DL${id}`,
						orderType: 'DELIVERY',
						status: 'completed',
						items: [],
						total: 0,
						tableId: `DL${id}`,
						customerName: name || `${deliveryCompany} #${deliveryOrderNumber}`,
						customerPhone: '',
						source: 'POS',
						deliveryCompany: deliveryCompany || '',
						deliveryOrderNumber: deliveryOrderNumber || '',
						prepTime: prepTime || 0,
						readyTimeLabel: readyTimeLabel || ''
					});
					console.log(`[Delivery-Orders] Order uploaded to Firebase: DL${id}`);
				}
			} catch (fbErr) {
				console.error('[Delivery-Orders] Firebase upload failed:', fbErr.message);
			}

			res.json({ success: true, id });
		} catch (e) {
			console.error('Failed to save delivery order:', e);
			res.status(500).json({ success: false, error: 'Failed to save delivery order' });
		}
	});

	// GET /api/orders/delivery-orders - Get active delivery orders (today only)
	router.get('/delivery-orders', async (req, res) => {
		try {
			const now = new Date();
			const cutoff = new Date(now);
			cutoff.setHours(now.getHours() < 5 ? -19 : 5, 0, 0, 0);
			const pad = (n) => String(n).padStart(2, '0');
			const cutoffLocal = `${cutoff.getFullYear()}-${pad(cutoff.getMonth() + 1)}-${pad(cutoff.getDate())} ${pad(cutoff.getHours())}:${pad(cutoff.getMinutes())}:${pad(cutoff.getSeconds())}`;

			// 활성 배달만: delivery_orders 자체 종료 + 연결된 orders가 VOID/취소/픽업 등이면 제외
			// (Void 시 orders만 VOIDED로 두고 delivery_orders는 pending인 경우 패널 좀비 부활 방지)
			const rows = await dbAll(`
				SELECT d.*,
					COALESCE(
						(SELECT o.order_number FROM orders o WHERE o.id = d.order_id LIMIT 1),
						(SELECT o.order_number FROM orders o WHERE UPPER(TRIM(o.table_id)) = UPPER('DL' || CAST(d.id AS TEXT)) LIMIT 1)
					) AS pos_order_number
				FROM delivery_orders d
				WHERE d.created_at >= ?
				AND UPPER(COALESCE(TRIM(d.status), '')) NOT IN ('PICKED_UP','CANCELLED','MERGED','CLOSED','VOIDED','VOID','REFUNDED')
				AND NOT EXISTS (
					SELECT 1 FROM orders o
					WHERE (
						(d.order_id IS NOT NULL AND o.id = d.order_id)
						OR UPPER(TRIM(COALESCE(o.table_id, ''))) = UPPER('DL' || CAST(d.id AS TEXT))
					)
					AND UPPER(COALESCE(TRIM(o.status), '')) IN ('PICKED_UP','CANCELLED','MERGED','CLOSED','VOIDED','VOID','REFUNDED')
				)
				AND NOT (d.order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM orders ox WHERE ox.id = d.order_id))
				ORDER BY d.created_at DESC
			`, [cutoffLocal]);
			res.json({ success: true, orders: rows });
		} catch (e) {
			console.error('Failed to get delivery orders:', e);
			res.status(500).json({ success: false, error: 'Failed to get delivery orders' });
		}
	});

	// PATCH /api/orders/delivery-orders/:id/link - Link delivery_orders to orders table
	router.patch('/delivery-orders/:id/link', async (req, res) => {
		try {
			const deliveryOrderId = req.params.id;
			const { orderId } = req.body;
			
			if (!orderId) {
				return res.status(400).json({ success: false, error: 'orderId is required' });
			}
			
			await dbRun('UPDATE delivery_orders SET order_id = ? WHERE id = ?', [orderId, deliveryOrderId]);
			console.log(`[Delivery] Linked delivery_order ${deliveryOrderId} to order ${orderId}`);
			res.json({ success: true });
		} catch (e) {
			console.error('Failed to link delivery order:', e);
			res.status(500).json({ success: false, error: 'Failed to link delivery order' });
		}
	});

	// PATCH /api/orders/delivery-orders/:id/status - Update delivery_orders status (e.g., PICKED_UP)
	router.patch('/delivery-orders/:id/status', async (req, res) => {
		try {
			const deliveryOrderIdRaw = req.params.id;
			const deliveryOrderId = String(deliveryOrderIdRaw || '').trim();
			const next = (req.body && req.body.status) ? String(req.body.status).toUpperCase() : '';
			if (!deliveryOrderId) return res.status(400).json({ success: false, error: 'id is required' });
			if (!next) return res.status(400).json({ success: false, error: 'status is required' });

			await dbRun(`UPDATE delivery_orders SET status = ? WHERE id = ?`, [next, deliveryOrderId]);

			res.json({ success: true });
		} catch (e) {
			console.error('Failed to update delivery order status:', e);
			res.status(500).json({ success: false, error: 'Failed to update delivery order status' });
		}
	});

	// Get order with items by id
	router.get('/:id', async (req, res) => {
		try {
			const orderId = Number(req.params.id);
			const order = await dbGet(`SELECT id, order_number, order_type, subtotal, total, status, created_at, closed_at, table_id, server_id, server_name, customer_phone, customer_name, fulfillment_mode, ready_time, pickup_minutes, order_source, kitchen_note, tax, tax_rate, tax_breakdown, adjustments_json, service_charge, online_order_number, firebase_order_id FROM orders WHERE id = ?`, [orderId]);
			if (!order) return res.status(404).json({ success:false, error:'Order not found' });
			const items = await dbAll(`SELECT id, item_id, name, quantity, price, guest_number, modifiers_json, memo_json, discount_json, split_denominator, split_numerator, order_line_id, item_source, togo_label, tax_group_id, printer_group_id FROM order_items WHERE order_id = ? ORDER BY id ASC`, [orderId]);
			const adjustments = await dbAll(`SELECT id, kind, mode, value, amount_applied, label, applied_by_employee_id, applied_by_name, created_at FROM order_adjustments WHERE order_id = ? ORDER BY id ASC`, [orderId]);
			
			// Backfill missing order_line_id for legacy rows (makes memo targeting stable)
			for (const row of (Array.isArray(items) ? items : [])) {
				const cur = row?.order_line_id != null ? String(row.order_line_id).trim() : '';
				if (!cur) {
					const legacy = `LEGACY-${orderId}-${row.id}`;
					try {
						await dbRun(`UPDATE order_items SET order_line_id = ? WHERE id = ?`, [legacy, row.id]);
						row.order_line_id = legacy;
					} catch {}
				}
			}
			
			// 각 아이템의 세금 정보 조회
			for (const item of items) {
				try {
					let taxGroupIds = [];

					// 0. order_items에 직접 설정된 tax_group_id 우선 사용 (Extra 버튼 아이템)
					if (item.tax_group_id) {
						taxGroupIds = [item.tax_group_id];
					}

					// 1. menu_tax_links에서 아이템별 세금 그룹 ID 조회
					if (taxGroupIds.length === 0) {
						try {
							const taxLinks = await dbAll(
								'SELECT tax_group_id FROM menu_tax_links WHERE item_id = ?',
								[item.item_id]
							);
							taxGroupIds = taxLinks.map(r => r.tax_group_id);
						} catch (e) {
							try {
								const taxLinks = await dbAll(
									'SELECT menu_tax_group_id as tax_group_id FROM menu_item_tax_links WHERE item_id = ?',
									[item.item_id]
								);
								taxGroupIds = taxLinks.map(r => r.tax_group_id);
							} catch (e2) {}
						}
					}
					
					// 2. 아이템별 세금 없으면 카테고리 세금 조회
					if (taxGroupIds.length === 0) {
						try {
							const menuItem = await dbGet(
								'SELECT category_id FROM menu_items WHERE item_id = ?',
								[item.item_id]
							);
							if (menuItem?.category_id) {
								const categoryTaxLinks = await dbAll(
									'SELECT tax_group_id FROM category_tax_links WHERE category_id = ?',
									[menuItem.category_id]
								);
								taxGroupIds = categoryTaxLinks.map(r => r.tax_group_id);
							}
						} catch (e) {}
					}
					
					// 3. 카테고리 세금도 없으면 기본 세금 그룹 (id=1, Food) 사용
					if (taxGroupIds.length === 0) {
						taxGroupIds = [1];
					}
					
					// 세금 그룹에 연결된 세금 정보 조회
					let totalTaxRate = 0;
					const taxDetails = [];
					for (const groupId of taxGroupIds) {
						const taxes = await dbAll(
							`SELECT t.name, t.rate FROM taxes t
							 JOIN tax_group_links tgl ON t.id = tgl.tax_id
							 WHERE tgl.group_id = ? AND t.is_active = 1`,
							[groupId]
						);
						for (const tax of taxes) {
							// rate가 1보다 크면 백분율(5%), 아니면 소수(0.05)
							const rate = tax.rate > 1 ? tax.rate / 100 : tax.rate;
							totalTaxRate += rate;
							taxDetails.push({ name: tax.name, rate: rate * 100 }); // 백분율로 저장
						}
					}
					
					// 4. 세금 정보가 여전히 없으면 기본 GST 5%
					if (taxDetails.length === 0) {
						totalTaxRate = 0.05;
						taxDetails.push({ name: 'GST', rate: 5 });
					}
					
					item.taxRate = totalTaxRate; // 소수 (예: 0.05)
					item.taxDetails = taxDetails; // [{name: 'GST', rate: 5}, {name: 'PST', rate: 7}]
				} catch (e) {
					// 세금 정보 조회 실패 시 기본값 사용
					item.taxRate = 0.05; // 기본 5%
					item.taxDetails = [{ name: 'GST', rate: 5 }];
				}
			}

			// 각 아이템의 프린터 그룹 정보 조회 (Reprint 라우팅용)
			// - menu_printer_links (item-level) 우선
			// - 없으면 category_printer_links (category-level)
			// - 없으면 빈 배열 (print-order에서 Kitchen fallback 처리)
			try {
				const normalizeItemId = (raw) => {
					const s = raw == null ? '' : String(raw).trim();
					if (!s) return null;
					if (/^(bagfee-|svc-|extra2-|extra3-|openprice-)/i.test(s)) return null;
					const n = Number(s);
					if (!Number.isFinite(n) || isNaN(n) || n <= 0) return null;
					return n;
				};

				const numericItemIds = Array.from(new Set((items || []).map(it => normalizeItemId(it.item_id)).filter(Boolean)));
				if (numericItemIds.length > 0) {
					const placeholders = numericItemIds.map(() => '?').join(',');

					// 1) item -> printer groups
					const itemPrinterRows = await dbAll(
						`SELECT item_id, printer_group_id FROM menu_printer_links WHERE item_id IN (${placeholders})`,
						numericItemIds
					);
					const itemToGroups = new Map();
					(itemPrinterRows || []).forEach(r => {
						const iid = Number(r.item_id);
						const gid = Number(r.printer_group_id);
						if (!iid || !gid) return;
						if (!itemToGroups.has(iid)) itemToGroups.set(iid, []);
						itemToGroups.get(iid).push(gid);
					});

					// 2) item -> category
					const itemCatRows = await dbAll(
						`SELECT item_id, category_id FROM menu_items WHERE item_id IN (${placeholders})`,
						numericItemIds
					);
					const itemToCategory = new Map();
					const categoryIds = new Set();
					(itemCatRows || []).forEach(r => {
						const iid = Number(r.item_id);
						const cid = Number(r.category_id);
						if (!iid || !cid) return;
						itemToCategory.set(iid, cid);
						categoryIds.add(cid);
					});

					// 3) category -> printer groups
					const catToGroups = new Map();
					if (categoryIds.size > 0) {
						const catIdsArr = Array.from(categoryIds);
						const catPlaceholders = catIdsArr.map(() => '?').join(',');
						const catPrinterRows = await dbAll(
							`SELECT category_id, printer_group_id FROM category_printer_links WHERE category_id IN (${catPlaceholders})`,
							catIdsArr
						);
						(catPrinterRows || []).forEach(r => {
							const cid = Number(r.category_id);
							const gid = Number(r.printer_group_id);
							if (!cid || !gid) return;
							if (!catToGroups.has(cid)) catToGroups.set(cid, []);
							catToGroups.get(cid).push(gid);
						});
					}

					// Attach to item rows
					(items || []).forEach(it => {
						// Use directly stored printer_group_id first (Extra button items)
						if (it.printer_group_id) {
							it.printerGroupIds = [Number(it.printer_group_id)];
							return;
						}
						const iid = normalizeItemId(it.item_id);
						if (!iid) {
							it.printerGroupIds = [];
							return;
						}
						const direct = itemToGroups.get(iid) || [];
						if (direct.length > 0) {
							it.printerGroupIds = Array.from(new Set(direct.map(Number)));
							return;
						}
						const cid = itemToCategory.get(iid);
						const fromCat = cid ? (catToGroups.get(cid) || []) : [];
						it.printerGroupIds = Array.from(new Set(fromCat.map(Number)));
					});
				} else {
					(items || []).forEach(it => { it.printerGroupIds = []; });
				}
			} catch (pgErr) {
				try { console.warn('[Orders] Printer group lookup skipped:', pgErr?.message || pgErr); } catch {}
				try { (items || []).forEach(it => { it.printerGroupIds = []; }); } catch {}
			}
			
			// 아이템을 프론트엔드 형식으로 변환
			const formattedItems = items.map(item => ({
				id: item.item_id,
				dbId: item.id, // DB의 원본 id 유지
				name: item.name,
				quantity: item.quantity,
				price: item.price,
				totalPrice: item.price,
				guestNumber: item.guest_number,
				guest_number: item.guest_number,
				modifiers: item.modifiers_json ? JSON.parse(item.modifiers_json) : [],
				modifiers_json: item.modifiers_json, // 원본 JSON 문자열도 유지
				memo: item.memo_json ? JSON.parse(item.memo_json) : null,
				memo_json: item.memo_json,
				discount: item.discount_json ? JSON.parse(item.discount_json) : null,
				discount_json: item.discount_json,
				splitDenominator: item.split_denominator,
				split_denominator: item.split_denominator,
				splitNumerator: item.split_numerator,
				split_numerator: item.split_numerator,
				orderLineId: item.order_line_id,
				order_line_id: item.order_line_id,
				taxRate: item.taxRate,
				taxDetails: item.taxDetails,
				printerGroupIds: Array.isArray(item.printerGroupIds) ? item.printerGroupIds : [],
				itemSource: item.item_source,
				item_source: item.item_source,
				togo_label: item.togo_label,
				togoLabel: !!(item.togo_label),
				taxGroupId: item.tax_group_id || null,
				printerGroupId: item.printer_group_id || null,
				type: 'item'
			}));
			
		// 동일 아이템 병합 (같은 메뉴+옵션+메모+게스트+가격 → 수량 합산)
		// Pickup List 상세: 온라인·Firebase 연동 주문은 라인별 표시가 중요 — 병합하지 않음(잘못된 4×한줄 방지)
		const ot = String(order.order_type || '').toUpperCase();
		const fm = String(order.fulfillment_mode || '').toLowerCase();
		const tid = String(order.table_id || '').trim().toUpperCase();
		const hasFb = String(order.firebase_order_id || '').trim() !== '';
		const hasOnlineNum = String(order.online_order_number || '').trim() !== '';
		const skipIdenticalMerge =
			hasFb ||
			hasOnlineNum ||
			ot === 'ONLINE' ||
			ot === 'WEB' ||
			ot === 'QR' ||
			fm === 'online' ||
			fm === 'web' ||
			fm === 'qr' ||
			tid.startsWith('OL');
		const mergedItems = skipIdenticalMerge ? formattedItems : mergeIdenticalItems(formattedItems);
		
		// VOID 정보 조회 (void_lines 포함)
		let voidLines = [];
		try {
			voidLines = await dbAll(`
				SELECT vl.name, vl.qty, vl.amount, vl.tax, vl.order_line_id, vl.menu_id,
				       v.reason, v.note, v.source, v.created_at as voided_at, v.created_by
				FROM void_lines vl
				JOIN voids v ON vl.void_id = v.id
				WHERE v.order_id = ?
				ORDER BY v.created_at ASC
			`, [orderId]);
		} catch (e) {
			// voids/void_lines 테이블 없을 수 있음
		}
		
		let refundedTotal = 0;
		try {
			const refundRow = await dbGet(`SELECT COALESCE(SUM(total), 0) AS refunded_total FROM refunds WHERE order_id = ?`, [orderId]);
			refundedTotal = Number(refundRow?.refunded_total || 0);
		} catch {}
		
		res.json({ success:true, order: { ...order, refunded_total: refundedTotal }, items: mergedItems, adjustments, voidLines });
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
			const { items = [], adjustments = [], total = 0, customerPhone, customerName, readyTime, pickupMinutes, fulfillmentMode, kitchenNote } = req.body || {};
			const reqBodyForAdj = req.body || {};
			
			// Ensure every line has orderLineId, then merge identical (memo-aware) lines.
			const itemsWithLineId = (Array.isArray(items) ? items : []).map((it, idx) => ({
				...it,
				orderLineId: ensureOrderLineId(it, idx),
			}));
			const mergedItems = mergeIdenticalItems(itemsWithLineId);
			
			await dbRun('BEGIN');
			// Replace items
			await dbRun(`DELETE FROM order_items WHERE order_id = ?`, [orderId]);
			for (const it of mergedItems) {
				await dbRun(`INSERT INTO order_items(order_id, item_id, name, quantity, price, guest_number, modifiers_json, memo_json, discount_json, split_denominator, split_numerator, order_line_id, tax, tax_rate, togo_label, tax_group_id, printer_group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
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
					(it.splitNumerator || it.split_numerator || null),
					ensureOrderLineId(it, it.id || 0),
					Number(it.tax || 0),
					Number(it.taxRate || it.tax_rate || 0),
					it.togoLabel || it.togo_label ? 1 : 0,
					it.taxGroupId || it.tax_group_id || null,
					it.printerGroupId || it.printer_group_id || null
				]);
			}
			// Replace adjustments
			await dbRun(`DELETE FROM order_adjustments WHERE order_id = ?`, [orderId]);
			for (const adj of (Array.isArray(adjustments) ? adjustments : [])) {
				const { appliedByEmployeeId, appliedByName } = resolveAdjustmentAppliedBy(adj, reqBodyForAdj);
				await dbRun(`INSERT INTO order_adjustments(order_id, kind, mode, value, amount_applied, label, applied_by_employee_id, applied_by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
					orderId,
					String(adj.kind||''),
					String(adj.mode||''),
					Number(adj.value||0),
					Number(adj.amountApplied||adj.amount_applied||0),
					adj.label != null ? String(adj.label) : null,
					appliedByEmployeeId,
					appliedByName
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
			if (Object.prototype.hasOwnProperty.call(req.body || {}, 'kitchenNote')) {
				updateFields.push('kitchen_note = ?');
				updateParams.push(kitchenNote || null);
			}
			if (Object.prototype.hasOwnProperty.call(req.body || {}, 'orderSource')) {
				updateFields.push('order_source = ?');
				updateParams.push(req.body.orderSource || null);
			}
			if (Object.prototype.hasOwnProperty.call(req.body || {}, 'onlineOrderNumber')) {
				updateFields.push('online_order_number = ?');
				updateParams.push(req.body.onlineOrderNumber ? String(req.body.onlineOrderNumber).trim() : null);
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

	// ── 동일 아이템 병합 유틸리티 ──
	// 같은 메뉴 + 같은 옵션(모디파이어) + 같은 메모 + 같은 게스트 → 수량 합산
	function mergeIdenticalItems(items) {
		if (!Array.isArray(items) || items.length === 0) return items;
		
		const result = [];
		const mergeMap = new Map(); // signature → index in result
		const normalizeMemoPayload = (it) => {
			try {
				// memo can arrive as memo/note/specialInstructions in various formats.
				const raw = it?.memo ?? it?.note ?? it?.specialInstructions ?? '';
				if (!raw) return { text: '', price: 0 };
				// string: keep as text (do NOT JSON.parse unless it's actually JSON)
				if (typeof raw === 'string') {
					const s = raw.trim();
					if (!s) return { text: '', price: 0 };
					// If it looks like JSON, try parse; otherwise treat as plain memo text.
					if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
						try {
							const parsed = JSON.parse(s);
							const txt = (parsed?.text ?? parsed?.note ?? parsed?.name ?? parsed?.specialInstructions ?? '').toString();
							const text = txt.replace(/\s+/g, ' ').trim();
							const price = Number(parsed?.price || parsed?.amount || 0) || 0;
							return { text, price: Number(price.toFixed(2)) };
						} catch {
							// fall through to plain text
						}
					}
					return { text: s.replace(/\s+/g, ' ').trim(), price: 0 };
				}
				// object
				if (typeof raw === 'object') {
					const txt = (raw.text ?? raw.note ?? raw.name ?? raw.specialInstructions ?? '').toString();
					const text = txt.replace(/\s+/g, ' ').trim();
					const price = Number(raw.price || raw.amount || 0) || 0;
					return { text, price: Number(price.toFixed(2)) };
				}
				return { text: String(raw).replace(/\s+/g, ' ').trim(), price: 0 };
			} catch {
				return { text: '', price: 0 };
			}
		};

		for (const item of items) {
			// null/undefined 아이템 스킵
			if (!item) continue;
			
			// separator, discount, void 타입은 병합하지 않음
			if (item.type === 'separator' || item.type === 'discount' || item.type === 'void') {
				result.push(item);
				if (item.type === 'separator') {
					mergeMap.clear(); // 게스트 구분선에서 병합 맵 초기화
				}
				continue;
			}

			try {
				// 병합 키 생성 - 모디파이어 정규화
				let modifiers = item.modifiers || [];
				// modifiers_json이 문자열인 경우 파싱
				if (typeof modifiers === 'string') {
					try { modifiers = JSON.parse(modifiers); } catch { modifiers = []; }
				}
				if (!Array.isArray(modifiers)) modifiers = [];
				
				// null/undefined 모디파이어 필터링
				modifiers = modifiers.filter(m => m != null);
				
				// 모디파이어 키 생성 (정렬하여 순서 무관하게)
				const modKey = JSON.stringify(
					modifiers.map(m => {
						// 다양한 형식 지원
						const groupId = m.groupId || m.group_id || m.id || '';
						const modifierIds = m.modifierIds || m.modifier_ids || m.ids || [];
						const modifierNames = m.modifierNames || m.modifier_names || m.names || [];
						return {
							groupId: String(groupId),
							modifierIds: [...(Array.isArray(modifierIds) ? modifierIds : [])].sort(),
							modifierNames: [...(Array.isArray(modifierNames) ? modifierNames : [])].sort(),
						};
					}).sort((a, b) => (a.groupId || '').localeCompare(b.groupId || ''))
				);
				
				// 메모 정규화 (memo가 plain string이어도 병합 키에 포함되어야 함)
				const memoKey = JSON.stringify(normalizeMemoPayload(item));
				
				// 할인 정규화
				let discount = item.discount;
				if (typeof discount === 'string') {
					try { discount = JSON.parse(discount); } catch { discount = null; }
				}
				const discountKey = JSON.stringify(discount || null);
				
				const guestNumber = item.guestNumber || item.guest_number || 1;
				const togoFlag = (item.togoLabel || item.togo_label) ? '1' : '0';
				// item.id는 메뉴 item_id라서, 온라인 등에서 잘못 같은 id가 박히면 서로 다른 메뉴가 한 줄로 합쳐짐 — 표시명 포함
				const nameKey = String(item.name || '')
					.trim()
					.toLowerCase()
					.replace(/\s+/g, ' ');
				const key = `${item.id}|${nameKey}|${guestNumber}|${modKey}|${memoKey}|${discountKey}|${togoFlag}`;

				if (mergeMap.has(key)) {
					const existingIdx = mergeMap.get(key);
					const existingItem = result[existingIdx];
					// 수량 합산
					result[existingIdx] = {
						...existingItem,
						quantity: (existingItem.quantity || 1) + (item.quantity || 1),
					};
				} else {
					mergeMap.set(key, result.length);
					result.push({ ...item });
				}
			} catch (mergeErr) {
				// 병합 실패 시 아이템을 그대로 추가 (데이터 유실 방지)
				console.warn('[mergeIdenticalItems] Failed to merge item, adding as-is:', mergeErr?.message);
				result.push({ ...item });
			}
		}

		return result;
	}

	// Ensure each order item line has a stable identifier.
	// This prevents memo/modifier edits from accidentally targeting the wrong line.
	function ensureOrderLineId(item, fallbackIndex = 0) {
		try {
			const existing = item?.orderLineId ?? item?.order_line_id ?? item?.order_lineId ?? null;
			if (existing != null && String(existing).trim() !== '') return String(existing).trim();
		} catch {}
		const base = (item && (item.id || item.item_id)) ? String(item.id || item.item_id) : 'ITEM';
		return `POS-${base}-${Date.now()}-${Number(fallbackIndex) || 0}-${Math.random().toString(36).slice(2, 8)}`;
	}

	// ── Server-side tax calculation helper ──
	// Calculates tax from DB tax configuration when frontend doesn't provide tax values
	async function calculateOrderTaxFromDB(orderId) {
		try {
			// Get all applicable taxes for each order item via:
			// 1) direct tax_group_id on order_items (Extra buttons)
			// 2) item-level tax links (menu_tax_links)
			// 3) category-level tax links (category_tax_links)
			const taxRows = await dbAll(`
				SELECT oi.id as oi_id, oi.item_id, oi.price, oi.quantity,
				       t.tax_id, t.name as tax_name, t.rate as tax_rate, 'direct' as source
				FROM order_items oi
				JOIN tax_group_links tgl ON oi.tax_group_id = tgl.tax_group_id
				JOIN taxes t ON tgl.tax_id = t.tax_id
				WHERE oi.order_id = ? AND oi.tax_group_id IS NOT NULL AND t.is_deleted = 0
				UNION
				SELECT oi.id as oi_id, oi.item_id, oi.price, oi.quantity,
				       t.tax_id, t.name as tax_name, t.rate as tax_rate, 'item' as source
				FROM order_items oi
				JOIN menu_tax_links mtl ON CAST(oi.item_id AS TEXT) = CAST(mtl.item_id AS TEXT)
				JOIN tax_group_links tgl ON mtl.tax_group_id = tgl.tax_group_id
				JOIN taxes t ON tgl.tax_id = t.tax_id
				WHERE oi.order_id = ? AND (oi.tax_group_id IS NULL) AND t.is_deleted = 0
				UNION
				SELECT oi.id as oi_id, oi.item_id, oi.price, oi.quantity,
				       t.tax_id, t.name as tax_name, t.rate as tax_rate, 'category' as source
				FROM order_items oi
				JOIN menu_items mi ON CAST(oi.item_id AS TEXT) = CAST(mi.item_id AS TEXT)
				JOIN category_tax_links ctl ON mi.category_id = ctl.category_id
				JOIN tax_group_links tgl ON ctl.tax_group_id = tgl.tax_group_id
				JOIN taxes t ON tgl.tax_id = t.tax_id
				WHERE oi.order_id = ? AND (oi.tax_group_id IS NULL) AND t.is_deleted = 0
			`, [orderId, orderId, orderId]);

			// Deduplicate: same order_item + same tax_id should only be counted once
			const seen = new Set();
			let totalTax = 0;
			const itemTaxTotals = {}; // oi_id -> total tax for that item

			for (const row of taxRows) {
				const key = `${row.oi_id}_${row.tax_id}`;
				if (seen.has(key)) continue;
				seen.add(key);
				const itemTotal = Number(row.price || 0) * Number(row.quantity || 1);
				const taxAmount = itemTotal * (Number(row.tax_rate) / 100);
				totalTax += taxAmount;
				itemTaxTotals[row.oi_id] = (itemTaxTotals[row.oi_id] || 0) + taxAmount;
			}

			// Update individual order_items with their calculated tax
			for (const [oiId, taxAmt] of Object.entries(itemTaxTotals)) {
				await dbRun(`UPDATE order_items SET tax = ? WHERE id = ?`, [Number(taxAmt.toFixed(2)), Number(oiId)]);
			}

			return Number(totalTax.toFixed(2));
		} catch (e) {
			console.error('[Orders] Server-side tax calculation error:', e.message);
			return 0;
		}
	}

	// Create order & items (+optional adjustments)
	router.post('/', async (req, res) => {
		try {
			const { orderNumber, orderType, total, subtotal, tax, items = [], adjustments = [], tableId, serverId, serverName, customerPhone, customerName, readyTime, pickupMinutes, fulfillmentMode, kitchenNote, orderMode, orderSource, isPrepaid, onlineOrderNumber } = req.body || {};
			const reqBodyForAdj = req.body || {};
			const createdAt = getLocalDatetimeString();
			const isDelivery = isDeliveryLikeOrder({ orderType, fulfillmentMode, tableId, orderSource });
			const isPrepaidOnline = !!isPrepaid;
			const orderTypeToSave = isDelivery ? 'DELIVERY' : (orderType ? String(orderType).toUpperCase() : null);
			const servicePatternToSave = resolveServicePattern({
				orderType: orderTypeToSave,
				fulfillmentMode,
				tableId,
			});
			const statusToSave = (isDelivery || isPrepaidOnline) ? 'PAID' : 'PENDING';
			const closedAtToSave = (isDelivery || isPrepaidOnline) ? createdAt : null;
			
			// Ensure every line has orderLineId, then merge identical (memo-aware) lines.
			const itemsWithLineId = (Array.isArray(items) ? items : []).map((it, idx) => ({
				...it,
				orderLineId: ensureOrderLineId(it, idx),
			}));
			const mergedItems = mergeIdenticalItems(itemsWithLineId);
			
			const result = await dbRun(
				`INSERT INTO orders(order_number, order_type, total, subtotal, tax, status, created_at, closed_at, table_id, server_id, server_name, customer_phone, customer_name, fulfillment_mode, ready_time, pickup_minutes, kitchen_note, order_mode, order_source, online_order_number, service_pattern)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					orderNumber || null,
					orderTypeToSave,
					total || 0,
					subtotal || 0,
					tax || 0,
					statusToSave,
					createdAt,
					closedAtToSave,
					tableId || null,
					serverId || null,
					serverName || null,
					customerPhone || null,
					customerName || null,
					fulfillmentMode ? String(fulfillmentMode).toUpperCase() : null,
					readyTime || null,
					Number.isFinite(pickupMinutes) ? Number(pickupMinutes) : null,
					kitchenNote || null,
					orderMode || null,
					orderSource || null,
					onlineOrderNumber ? String(onlineOrderNumber).trim() : null,
					servicePatternToSave,
				]
			);
			const orderId = result.lastID;
			for (const it of mergedItems) {
				await dbRun(`INSERT INTO order_items(order_id, item_id, name, quantity, price, guest_number, modifiers_json, memo_json, discount_json, split_denominator, split_numerator, order_line_id, tax, tax_rate, togo_label, tax_group_id, printer_group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
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
					(it.splitNumerator || it.split_numerator || null),
					ensureOrderLineId(it, it.id || 0),
					Number(it.tax || 0),
					Number(it.taxRate || it.tax_rate || 0),
					it.togoLabel || it.togo_label ? 1 : 0,
					it.taxGroupId || it.tax_group_id || null,
					it.printerGroupId || it.printer_group_id || null
				]);
			}

			// ── Server-side tax fallback ──
			// If frontend didn't send tax (or sent 0), calculate from DB tax configuration
			const frontendTax = Number(tax || 0);
			const frontendSubtotal = Number(subtotal || 0);
			if (frontendTax === 0 && mergedItems.length > 0) {
				try {
					const calculatedTax = await calculateOrderTaxFromDB(orderId);
					if (calculatedTax > 0) {
						const itemsTotal = mergedItems.reduce((sum, it) => sum + (Number(it.price || it.totalPrice || 0) * Number(it.quantity || 1)), 0);
						const finalSubtotal = frontendSubtotal > 0 ? frontendSubtotal : itemsTotal;
						const finalTotal = Number((finalSubtotal + calculatedTax).toFixed(2));
						await dbRun(`UPDATE orders SET subtotal = ?, tax = ?, total = ? WHERE id = ?`,
							[Number(finalSubtotal.toFixed(2)), calculatedTax, finalTotal, orderId]);
						console.log(`[Orders] Tax auto-calculated for order ${orderId}: subtotal=$${finalSubtotal.toFixed(2)}, tax=$${calculatedTax.toFixed(2)}, total=$${finalTotal.toFixed(2)}`);
					}
				} catch (taxCalcErr) {
					console.error('[Orders] Tax auto-calculation failed:', taxCalcErr.message);
				}
			}
			if (Array.isArray(adjustments)) {
				for (const adj of adjustments) {
					const { appliedByEmployeeId, appliedByName } = resolveAdjustmentAppliedBy(adj, reqBodyForAdj);
					await dbRun(`INSERT INTO order_adjustments(order_id, kind, mode, value, amount_applied, label, applied_by_employee_id, applied_by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
						[orderId, String(adj.kind||''), String(adj.mode||''), Number(adj.value||0), Number(adj.amountApplied||adj.amount_applied||0), adj.label != null ? String(adj.label) : null, appliedByEmployeeId, appliedByName]);
				}
			}

			// Daily order number 할당 (Closing 후 001부터 재시작)
			let dailyNumber = orderId; // fallback: DB id
			try {
				const counterRow = await dbGet(`SELECT value FROM admin_settings WHERE key = 'daily_order_counter'`);
				const nextNum = parseInt(counterRow?.value || '0') + 1;
				await dbRun(`INSERT OR REPLACE INTO admin_settings(key, value) VALUES('daily_order_counter', ?)`, [String(nextNum)]);
				dailyNumber = nextNum;
				// order_number 컬럼에 daily number 저장
				const displayNumber = String(nextNum).padStart(3, '0');
				await dbRun(`UPDATE orders SET order_number = ? WHERE id = ?`, [displayNumber, orderId]);
			} catch (counterErr) {
				console.error('Daily counter update failed (using orderId):', counterErr.message);
			}

			// Delivery orders are assumed prepaid: auto-create an APPROVED payment record if none exists.
			if (isDelivery) {
				try {
					const existingPay = await dbGet(`SELECT id FROM payments WHERE order_id = ? AND status = 'APPROVED' LIMIT 1`, [orderId]);
					if (!existingPay) {
						const oRow = await dbGet(`SELECT order_number, total, created_at FROM orders WHERE id = ?`, [orderId]);
						await dbRun(
							`INSERT INTO payments(order_id, payment_method, amount, tip, ref, status, guest_number, created_at)
							 VALUES(?,?,?,?,?,?,?,?)`,
							[
								orderId,
								'DELIVERY',
								Number(oRow?.total || total || 0),
								0,
								oRow?.order_number || null,
								'APPROVED',
								null,
								oRow?.created_at || createdAt,
							],
						);
					}
				} catch (payErr) {
					console.warn('[Orders] Delivery payment auto-create failed:', payErr?.message || payErr);
				}
			}

			// Online prepaid orders: auto-create an APPROVED OTHER_CARD payment record.
			if (isPrepaidOnline && !isDelivery) {
				try {
					const oRow = await dbGet(`SELECT order_number, total, created_at FROM orders WHERE id = ?`, [orderId]);
					await dbRun(
						`INSERT INTO payments(order_id, payment_method, amount, tip, ref, status, guest_number, created_at)
						 VALUES(?,?,?,?,?,?,?,?)`,
						[
							orderId,
							'OTHER_CARD',
							Number(oRow?.total || total || 0),
							0,
							oRow?.order_number || null,
							'APPROVED',
							null,
							oRow?.created_at || createdAt,
						],
					);
				} catch (payErr) {
					console.warn('[Orders] Online prepaid payment auto-create failed:', payErr?.message || payErr);
				}
			}

			// 파이어베이스로 주문 업로드 (Dashboard 연동)
			try {
				const restaurantId = remoteSyncService.getRestaurantId();
				if (restaurantId) {
					await firebaseService.uploadOrder(restaurantId, {
						orderNumber: String(dailyNumber).padStart(3, '0'),
						orderType: orderTypeToSave || 'POS',
						status: 'completed', // POS에서 저장된 주문은 이미 확정된 상태로 간주
						items: mergedItems.map(it => ({
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
						source: 'POS'
					});
				}
			} catch (firebaseErr) {
				console.error('[Orders] Failed to upload to Firebase:', firebaseErr.message);
			}

			res.json({ success: true, orderId, dailyNumber, order_number: String(dailyNumber).padStart(3, '0'), createdAt });
		} catch (e) {
			console.error('Failed to save order:', e);
			res.status(500).json({ success:false, error: 'Failed to save order' });
		}
	});

	// ============ DELIVERY ORDERS ============
	
	// Create delivery_orders table if not exists
	(async () => {
		try {
			await dbRun(`CREATE TABLE IF NOT EXISTS delivery_orders (
				id INTEGER PRIMARY KEY,
				store_id TEXT,
				type TEXT DEFAULT 'Delivery',
				time TEXT,
				created_at TEXT,
				name TEXT,
				status TEXT DEFAULT 'pending',
				delivery_company TEXT,
				delivery_order_number TEXT,
				ready_time_label TEXT,
				prep_time INTEGER,
				order_id INTEGER
			)`);
			// Add order_id column if not exists (for existing tables)
			try {
				await dbRun(`ALTER TABLE delivery_orders ADD COLUMN order_id INTEGER`);
			} catch (e) { /* Column already exists */ }
			console.log('[Orders] delivery_orders table ready');
		} catch (e) {
			console.error('Failed to create delivery_orders table:', e.message);
		}
	})();

	return router;
}; 