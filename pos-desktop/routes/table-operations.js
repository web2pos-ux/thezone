const express = require('express');
const router = express.Router();
const salesSyncService = require('../services/salesSyncService');

/**
 * ⚠️ PROTECTED FILE - Table Move/Merge Operations ⚠️
 * 
 * 이 파일은 테이블 이동 및 병합 기능이 완성되어 보호되고 있습니다.
 * 수정이 필요한 경우 별도 브랜치에서 작업하거나 명시적 승인을 받으세요.
 * 
 * 완성일: 2025-10-23
 * 
 * 주요 기능:
 * - POST /move: 테이블 주문 이동 (Occupied → Available)
 * - POST /merge: 테이블 주문 병합 (Occupied → Occupied)
 * - 4가지 시나리오 지원 (주문 유무 조합)
 * - current_order_id 및 table_id 기반 주문 조회
 * - order_items 테이블 직접 사용
 * - Guest 번호 자동 재배치
 */

module.exports = (db) => {
  // Promise-based wrappers for db methods
  const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

  const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

  const normalizePartialSelection = (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const mode = String(raw.mode || '').toLowerCase();
    if (mode !== 'partial') return null;
    const guestNumbers = Array.isArray(raw.guestNumbers)
      ? raw.guestNumbers
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n))
      : [];
    const orderItemIds = Array.isArray(raw.orderItemIds)
      ? raw.orderItemIds
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n))
      : [];
    const orderLineIds = Array.isArray(raw.orderLineIds)
      ? raw.orderLineIds
          .map((id) => (id == null ? null : String(id).trim()))
          .filter(Boolean)
      : [];
    if (!guestNumbers.length && !orderItemIds.length && !orderLineIds.length) return null;
    return {
      mode: 'partial',
      guestNumbers,
      orderItemIds,
      orderLineIds,
    };
  };

  const filterItemsBySelection = (items = [], selection) => {
    if (!selection) return items;
    const guestSet = new Set(selection.guestNumbers || []);
    const idSet = new Set(selection.orderItemIds || []);
    const lineSet = new Set(selection.orderLineIds || []);
    return items.filter((item) => {
      const guestNumber = Number(item.guest_number) || 0;
      if (guestSet.has(guestNumber)) return true;
      if (item.id != null && idSet.has(Number(item.id))) return true;
      const orderLineId = item.order_line_id != null ? String(item.order_line_id).trim() : '';
      if (orderLineId && lineSet.has(orderLineId)) return true;
      return false;
    });
  };

  /** TRANSACTION COMMIT 이후만 호출. Sub POS/핸드헬드에 table_updated (SQL·비즈니스 로직 불변). */
  function emitDeviceTableUpdatedFromElement(req, elementId, status, currentOrderId) {
    try {
      const io = req.app && req.app.get('io');
      if (!io || elementId == null || String(elementId).trim() === '') return;
      const tid = String(elementId);
      const payload = {
        table_id: tid,
        element_id: tid,
        status: String(status != null ? status : ''),
      };
      if (currentOrderId != null && currentOrderId !== '') {
        const n = Number(currentOrderId);
        if (Number.isFinite(n)) payload.current_order_id = n;
      }
      io.to('device_handheld').emit('table_updated', payload);
      io.to('device_sub_pos').emit('table_updated', payload);
    } catch (e) {
      console.warn('[table-operations] emitDeviceTableUpdatedFromElement:', e && e.message);
    }
  }

  const calculateItemsSubtotal = (items = []) =>
    items.reduce((sum, item) => sum + Number(item.price || 0) * (Number(item.quantity) || 1), 0);

  const buildGuestRenumberMap = (items = [], startAt = 0) => {
    const map = new Map();
    let next = startAt;
    for (const item of items) {
      const guestNumber = Number(item.guest_number) || 1;
      if (!map.has(guestNumber)) {
        next += 1;
        map.set(guestNumber, next);
      }
    }
    return map;
  };

  const insertOrderItemClone = async (targetOrderId, item, guestNumber) => {
    await dbRun(
      `INSERT INTO order_items(
        order_id, item_id, name, quantity, price, guest_number, modifiers_json, memo_json, discount_json, split_denominator, order_line_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        targetOrderId,
        item.item_id,
        item.name,
        item.quantity,
        item.price,
        guestNumber,
        item.modifiers_json,
        item.memo_json,
        item.discount_json,
        item.split_denominator,
        item.order_line_id,
      ]
    );
  };

  const cloneOrderForPartialMove = async (order, tableId, subtotal) => {
    const now = new Date().toISOString();
    const columns = [
      'order_number',
      'order_type',
      'total',
      'status',
      'created_at',
      'closed_at',
      'table_id',
      'server_id',
      'server_name',
      'customer_phone',
      'customer_name',
      'fulfillment_mode',
      'ready_time',
      'pickup_minutes',
      'service_pattern',
    ];
    const values = columns.map((col) => {
      switch (col) {
        case 'table_id':
          return tableId;
        case 'status':
          return 'PENDING';
        case 'created_at':
          return now;
        case 'closed_at':
          return null;
        case 'total':
          return subtotal != null ? subtotal : order?.total || 0;
        default:
          return order ? order[col] || null : null;
      }
    });
    const placeholders = columns.map(() => '?').join(', ');
    const result = await dbRun(
      `INSERT INTO orders (${columns.join(', ')}) VALUES (${placeholders})`,
      values
    );
    return result.lastID;
  };

  const renumberOrderGuests = async (orderId) => {
    if (!orderId) return;
    const rows = await dbAll(
      'SELECT id, guest_number FROM order_items WHERE order_id = ? ORDER BY id ASC',
      [orderId]
    );
    if (!rows || rows.length === 0) return;
    const uniqueGuests = [];
    rows.forEach((row) => {
      const guestNumber = Number(row.guest_number) || 1;
      if (!uniqueGuests.includes(guestNumber)) {
        uniqueGuests.push(guestNumber);
      }
    });
    if (uniqueGuests.length === 0) return;
    uniqueGuests.sort((a, b) => a - b);
    const mapping = new Map();
    uniqueGuests.forEach((guest, idx) => mapping.set(guest, idx + 1));
    for (const row of rows) {
      const current = Number(row.guest_number) || 1;
      const normalized = mapping.get(current) || 1;
      if (normalized !== current) {
        await dbRun(
          'UPDATE order_items SET guest_number = ? WHERE id = ?',
          [normalized, row.id]
        );
      }
    }
  };

  const clearGuestStatusEntries = async (orderId, guestNumbers = []) => {
    if (!orderId || !Array.isArray(guestNumbers) || guestNumbers.length === 0) return;
    const unique = Array.from(
      new Set(
        guestNumbers
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n))
      )
    );
    if (unique.length === 0) return;
    const placeholders = unique.map(() => '?').join(',');
    await dbRun(
      `DELETE FROM order_guest_status WHERE order_id = ? AND guest_number IN (${placeholders})`,
      [orderId, ...unique]
    );
  };

  // POST /api/table-operations/move - Move table (Occupied → Available)
  router.post('/move', async (req, res) => {
    try {
      const { fromTableId, toTableId, floor } = req.body;

      if (!fromTableId || !toTableId) {
        return res.status(400).json({ 
          success: false, 
          error: 'fromTableId and toTableId are required' 
        });
      }

      console.log('[TABLE MOVE] Starting move operation:', { fromTableId, toTableId, floor });

      // 1. Get source table and verify it's Occupied
      const fromTable = await dbGet(
        'SELECT * FROM table_map_elements WHERE element_id = ? AND floor = ?',
        [fromTableId, floor || '1F']
      );

      if (!fromTable) {
        return res.status(404).json({ 
          success: false, 
          error: 'Source table not found' 
        });
      }

      // Allow Occupied or Payment Pending (Bill printed) as source
      if (fromTable.status !== 'Occupied' && fromTable.status !== 'Payment Pending') {
        return res.status(400).json({ 
          success: false, 
          error: 'Source table must be Occupied or Payment Pending' 
        });
      }

      // 2. Get target table and verify it's Available
      const toTable = await dbGet(
        'SELECT * FROM table_map_elements WHERE element_id = ? AND floor = ?',
        [toTableId, floor || '1F']
      );

      if (!toTable) {
        return res.status(404).json({ 
          success: false, 
          error: 'Target table not found' 
        });
      }

      if (toTable.status !== 'Available') {
        return res.status(400).json({ 
          success: false, 
          error: 'Target table must be Available' 
        });
      }

      // 3. Get order from source table using current_order_id (allow multiple statuses)
      let order = null;
      if (fromTable.current_order_id) {
        order = await dbGet(
          `SELECT * FROM orders WHERE id = ? AND status IN ('PENDING', 'NEW', 'RECEIVED', 'CONFIRMED', 'PREPARING', 'OPEN')`,
          [fromTable.current_order_id]
        );
      }
      
      // Fallback: try to find order by table_id if current_order_id doesn't work
    if (!order) {
        order = await dbGet(
          `SELECT * FROM orders WHERE table_id = ? AND status IN ('PENDING', 'NEW', 'RECEIVED', 'CONFIRMED', 'PREPARING', 'OPEN')`,
          [fromTableId]
        );
      }
      
      console.log('[TABLE MOVE] Order found:', order ? `ID ${order.id}` : 'None');

      const partialSelection = normalizePartialSelection(req.body.partialSelection);

      if (partialSelection) {
        if (!order) {
          return res.status(400).json({
            success: false,
            error: 'No order found on source table for partial move',
          });
        }

        const fromItems = await dbAll(
          'SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC',
          [order.id]
        );
        const itemsToMove = filterItemsBySelection(fromItems, partialSelection);

        if (!itemsToMove.length) {
          return res.status(400).json({
            success: false,
            error: 'No matching items found for the selected guests/items',
          });
        }

        await dbRun('BEGIN TRANSACTION');
        try {
          const subtotal = calculateItemsSubtotal(itemsToMove);
          const newOrderId = await cloneOrderForPartialMove(order, toTableId, subtotal);
          const guestMap = buildGuestRenumberMap(itemsToMove, 0);
          await clearGuestStatusEntries(newOrderId, Array.from(new Set(guestMap.values())));
          const movedGuestNumbers = Array.from(
            new Set(itemsToMove.map((item) => Number(item.guest_number) || 1))
          );

          for (const item of itemsToMove) {
            const guestNumber = guestMap.get(Number(item.guest_number) || 1) || 1;
            await insertOrderItemClone(newOrderId, item, guestNumber);
          }

          const selectedIds = itemsToMove
            .map((item) => item.id)
            .filter((id) => id != null);
          if (selectedIds.length) {
            const placeholders = selectedIds.map(() => '?').join(',');
            await dbRun(
              `DELETE FROM order_items WHERE id IN (${placeholders})`,
              selectedIds
            );
          }

          await dbRun(
            'UPDATE orders SET total = MAX(COALESCE(total,0) - ?, 0) WHERE id = ?',
            [subtotal, order.id]
          );
          await dbRun(
            'UPDATE orders SET total = COALESCE(total,0) + ? WHERE id = ?',
            [subtotal, newOrderId]
          );
          if (movedGuestNumbers.length > 0) {
            await clearGuestStatusEntries(order.id, movedGuestNumbers);
          }

          const remainingRow = await dbGet(
            'SELECT COUNT(*) as count FROM order_items WHERE order_id = ?',
            [order.id]
          );
          const remainingCount = remainingRow?.count || 0;
          if (remainingCount > 0) {
            await renumberOrderGuests(order.id);
          }
          const sourceStatus = remainingCount > 0 ? 'Occupied' : 'Available';
          const sourceOrderIdValue = remainingCount > 0 ? order.id : null;

          if (!remainingCount) {
            await dbRun(
              'UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
              ['MERGED', order.id]
            );
          }

          await dbRun(
            'UPDATE table_map_elements SET status = ?, current_order_id = ? WHERE element_id = ? AND floor = ?',
            [sourceStatus, sourceOrderIdValue, fromTableId, floor || '1F']
          );

          await dbRun(
            'UPDATE table_map_elements SET status = ?, current_order_id = ? WHERE element_id = ? AND floor = ?',
            ['Occupied', newOrderId, toTableId, floor || '1F']
          );

          await dbRun(
            `INSERT INTO table_move_history (from_table_id, to_table_id, action_type, order_id, floor, performed_at)
             VALUES (?, ?, ?, ?, ?, datetime('now'))`,
            [fromTableId, toTableId, 'MOVE', newOrderId, floor || '1F']
          );

          await dbRun('COMMIT');

          emitDeviceTableUpdatedFromElement(req, fromTableId, sourceStatus, sourceOrderIdValue);
          emitDeviceTableUpdatedFromElement(req, toTableId, 'Occupied', newOrderId);

          return res.json({
            success: true,
            message: `Table ${fromTableId} partially moved to ${toTableId}`,
            fromTable: { id: fromTableId, status: sourceStatus },
            toTable: { id: toTableId, status: 'Occupied', orderId: newOrderId },
            partial: true,
            movedItemCount: itemsToMove.length,
          });
        } catch (error) {
          await dbRun('ROLLBACK');
          throw error;
        }
      }

      // 4. Update table statuses and order
      await dbRun('BEGIN TRANSACTION');

      try {
        // Update source table to Available
        await dbRun(
          'UPDATE table_map_elements SET status = ?, current_order_id = NULL WHERE element_id = ? AND floor = ?',
          ['Available', fromTableId, floor || '1F']
        );

        // Update target table to Occupied
        await dbRun(
          'UPDATE table_map_elements SET status = ?, current_order_id = ? WHERE element_id = ? AND floor = ?',
          ['Occupied', order ? order.id : null, toTableId, floor || '1F']
        );

        // Update order's table_id if order exists
      if (order) {
          await dbRun(
            'UPDATE orders SET table_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [toTableId, order.id]
          );
        }

        // Record move history
    await dbRun(
          `INSERT INTO table_move_history (from_table_id, to_table_id, action_type, order_id, floor, performed_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))`,
          [fromTableId, toTableId, 'MOVE', order ? order.id : null, floor || '1F']
        );

        await dbRun('COMMIT');

        emitDeviceTableUpdatedFromElement(req, fromTableId, 'Available', null);
        emitDeviceTableUpdatedFromElement(req, toTableId, 'Occupied', order ? order.id : null);

        console.log('[TABLE MOVE] Successfully moved table');

        res.json({
          success: true,
          message: `Table ${fromTableId} moved to ${toTableId}`,
          fromTable: { id: fromTableId, status: 'Available' },
          toTable: { id: toTableId, status: 'Occupied', orderId: order ? order.id : null }
        });

      } catch (error) {
        await dbRun('ROLLBACK');
        throw error;
      }

    } catch (error) {
      console.error('[TABLE MOVE] Error:', error);
      console.error('[TABLE MOVE] Stack:', error.stack);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to move table', 
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });

  // POST /api/table-operations/merge - Merge tables (Occupied → Occupied)
  router.post('/merge', async (req, res) => {
    try {
      const { fromTableId, toTableId, floor } = req.body;

      if (!fromTableId || !toTableId) {
        return res.status(400).json({ 
          success: false, 
          error: 'fromTableId and toTableId are required' 
        });
      }

      console.log('[TABLE MERGE] Starting merge operation:', { fromTableId, toTableId, floor });

      // 1. Verify both tables are Occupied
      const fromTable = await dbGet(
        'SELECT * FROM table_map_elements WHERE element_id = ? AND floor = ?',
        [fromTableId, floor || '1F']
      );

      const toTable = await dbGet(
        'SELECT * FROM table_map_elements WHERE element_id = ? AND floor = ?',
        [toTableId, floor || '1F']
      );

      if (!fromTable || !toTable) {
        return res.status(404).json({ 
          success: false, 
          error: 'Table not found' 
        });
      }

      // Allow both Occupied and Payment Pending (Bill printed) tables for merge
      const validStatuses = ['Occupied', 'Payment Pending'];
      if (!validStatuses.includes(fromTable.status) || !validStatuses.includes(toTable.status)) {
        return res.status(400).json({ 
          success: false, 
          error: 'Both tables must be Occupied or Payment Pending for merge' 
        });
      }

      // 2. Get orders from both tables using current_order_id (allow multiple statuses)
      let fromOrder = null;
      if (fromTable.current_order_id) {
        fromOrder = await dbGet(
          `SELECT * FROM orders WHERE id = ? AND status IN ('PENDING', 'NEW', 'RECEIVED', 'CONFIRMED', 'PREPARING', 'OPEN')`,
          [fromTable.current_order_id]
        );
      }
      
      // Fallback: try to find by table_id
      if (!fromOrder) {
        fromOrder = await dbGet(
          `SELECT * FROM orders WHERE table_id = ? AND status IN ('PENDING', 'NEW', 'RECEIVED', 'CONFIRMED', 'PREPARING', 'OPEN')`,
          [fromTableId]
        );
      }

      let toOrder = null;
      if (toTable.current_order_id) {
        toOrder = await dbGet(
          `SELECT * FROM orders WHERE id = ? AND status IN ('PENDING', 'NEW', 'RECEIVED', 'CONFIRMED', 'PREPARING', 'OPEN')`,
          [toTable.current_order_id]
        );
      }
      
      // Fallback: try to find by table_id
      if (!toOrder) {
        toOrder = await dbGet(
          `SELECT * FROM orders WHERE table_id = ? AND status IN ('PENDING', 'NEW', 'RECEIVED', 'CONFIRMED', 'PREPARING', 'OPEN')`,
          [toTableId]
        );
      }
      
      console.log('[TABLE MERGE] Orders found:', { 
        fromOrder: fromOrder ? `ID ${fromOrder.id}` : 'None',
        toOrder: toOrder ? `ID ${toOrder.id}` : 'None'
      });

      const partialSelection = normalizePartialSelection(req.body.partialSelection);

      if (partialSelection) {
        if (!fromOrder || !toOrder) {
          return res.status(400).json({
            success: false,
            error: 'Partial merge requires active orders on both tables',
          });
        }

        const fromItems = await dbAll(
          'SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC',
          [fromOrder.id]
        );
        const toItems = await dbAll(
          'SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC',
          [toOrder.id]
        );

        const itemsToMove = filterItemsBySelection(fromItems, partialSelection);
        if (!itemsToMove.length) {
          return res.status(400).json({
            success: false,
            error: 'No matching items found for the selected guests/items',
          });
        }

        await dbRun('BEGIN TRANSACTION');
        try {
          const targetGuests = toItems
            .map((item) => Number(item.guest_number) || 0)
            .filter((n) => n > 0);
          const baseGuest = targetGuests.length ? Math.max(...targetGuests) : 0;
          const guestMap = buildGuestRenumberMap(itemsToMove, baseGuest);
          const subtotal = calculateItemsSubtotal(itemsToMove);
          const insertedGuestNumbers = new Set();
          const movedGuestNumbers = new Set();

          for (const item of itemsToMove) {
            const guestNumber = guestMap.get(Number(item.guest_number) || 1) || baseGuest + 1;
            insertedGuestNumbers.add(guestNumber);
            movedGuestNumbers.add(Number(item.guest_number) || 1);
            await insertOrderItemClone(toOrder.id, item, guestNumber);
          }

          const selectedIds = itemsToMove
            .map((item) => item.id)
            .filter((id) => id != null);
          if (selectedIds.length) {
            const placeholders = selectedIds.map(() => '?').join(',');
            await dbRun(
              `DELETE FROM order_items WHERE id IN (${placeholders})`,
              selectedIds
            );
          }

          await dbRun(
            'UPDATE orders SET total = MAX(COALESCE(total,0) - ?, 0) WHERE id = ?',
            [subtotal, fromOrder.id]
          );
          await dbRun(
            'UPDATE orders SET total = COALESCE(total,0) + ? WHERE id = ?',
            [subtotal, toOrder.id]
          );
          if (movedGuestNumbers.size > 0) {
            await clearGuestStatusEntries(fromOrder.id, Array.from(movedGuestNumbers));
          }

          const remainingRow = await dbGet(
            'SELECT COUNT(*) as count FROM order_items WHERE order_id = ?',
            [fromOrder.id]
          );
          const remainingCount = remainingRow?.count || 0;
          if (remainingCount > 0) {
            await renumberOrderGuests(fromOrder.id);
          }
          const sourceStatus = remainingCount > 0 ? 'Occupied' : 'Available';
          const sourceOrderIdValue = remainingCount > 0 ? fromOrder.id : null;

          if (!remainingCount) {
            await dbRun(
              'UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
              ['MERGED', fromOrder.id]
            );
          }

          await dbRun(
            'UPDATE table_map_elements SET status = ?, current_order_id = ? WHERE element_id = ? AND floor = ?',
            [sourceStatus, sourceOrderIdValue, fromTableId, floor || '1F']
          );

          if (insertedGuestNumbers.size > 0) {
            await clearGuestStatusEntries(toOrder.id, Array.from(insertedGuestNumbers));
          }

          await dbRun(
            `INSERT INTO table_move_history (from_table_id, to_table_id, action_type, order_id, from_order_id, floor, performed_at)
             VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
            [fromTableId, toTableId, 'MERGE', toOrder.id, fromOrder.id, floor || '1F']
          );

          await dbRun('COMMIT');

          emitDeviceTableUpdatedFromElement(req, fromTableId, sourceStatus, sourceOrderIdValue);

          // Firebase에 머지 히스토리 동기화
          const restaurantId = process.env.FIREBASE_RESTAURANT_ID;
          if (restaurantId) {
            salesSyncService.syncTableMergeToFirebase({
              actionType: 'MERGE',
              fromTableId,
              toTableId,
              floor: floor || '1F',
              fromOrderId: fromOrder.id,
              toOrderId: toOrder.id,
              movedItemCount: itemsToMove.length,
              partial: true
            }, restaurantId).catch(err => console.warn('[SalesSync] Table merge sync error:', err.message));
          }

          return res.json({
            success: true,
            message: `Table ${fromTableId} partially merged into ${toTableId}`,
            fromTable: { id: fromTableId, status: sourceStatus },
            toTable: { id: toTableId, status: 'Occupied', orderId: toOrder.id },
            partial: true,
            movedItemCount: itemsToMove.length,
          });
        } catch (error) {
          await dbRun('ROLLBACK');
          throw error;
        }
      }

      // If no orders exist, just move the table status (like a simple move)
      if (!fromOrder && !toOrder) {
        console.log('[TABLE MERGE] No orders found - performing simple status merge');
        
        await dbRun('BEGIN TRANSACTION');
        
        try {
          // Update source table to Available
          await dbRun(
            'UPDATE table_map_elements SET status = ?, current_order_id = NULL WHERE element_id = ? AND floor = ?',
            ['Available', fromTableId, floor || '1F']
          );
          
          // Record merge history
          await dbRun(
            `INSERT INTO table_move_history (from_table_id, to_table_id, action_type, order_id, from_order_id, floor, performed_at)
             VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
            [fromTableId, toTableId, 'MERGE', null, null, floor || '1F']
          );
          
          await dbRun('COMMIT');

          emitDeviceTableUpdatedFromElement(req, fromTableId, 'Available', null);
          
          // Firebase에 머지 히스토리 동기화
          const restaurantId = process.env.FIREBASE_RESTAURANT_ID;
          if (restaurantId) {
            salesSyncService.syncTableMergeToFirebase({
              actionType: 'MERGE',
              fromTableId,
              toTableId,
              floor: floor || '1F',
              fromOrderId: null,
              toOrderId: null,
              movedItemCount: 0,
              partial: false
            }, restaurantId).catch(err => console.warn('[SalesSync] Table merge sync error:', err.message));
          }
          
          return res.json({
            success: true,
            message: `Table ${fromTableId} status merged into ${toTableId} (no orders)`,
            fromTable: { id: fromTableId, status: 'Available' },
            toTable: { id: toTableId, status: 'Occupied' }
          });
        } catch (error) {
          await dbRun('ROLLBACK');
          throw error;
        }
      }

      // If only source has order, move it to target (like Move operation)
      if (fromOrder && !toOrder) {
        console.log('[TABLE MERGE] Only source has order - performing move-like merge');
        
    await dbRun('BEGIN TRANSACTION');

    try {
          // Update source table to Available
          await dbRun(
            'UPDATE table_map_elements SET status = ?, current_order_id = NULL WHERE element_id = ? AND floor = ?',
            ['Available', fromTableId, floor || '1F']
          );

          // Update target table to Occupied
          await dbRun(
            'UPDATE table_map_elements SET status = ?, current_order_id = ? WHERE element_id = ? AND floor = ?',
            ['Occupied', fromOrder.id, toTableId, floor || '1F']
          );

          // Update order's table_id
        await dbRun(
            'UPDATE orders SET table_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [toTableId, fromOrder.id]
        );

          // Record merge history
      await dbRun(
            `INSERT INTO table_move_history (from_table_id, to_table_id, action_type, order_id, floor, performed_at)
             VALUES (?, ?, ?, ?, ?, datetime('now'))`,
            [fromTableId, toTableId, 'MERGE', fromOrder.id, floor || '1F']
      );

      await dbRun('COMMIT');

          emitDeviceTableUpdatedFromElement(req, fromTableId, 'Available', null);
          emitDeviceTableUpdatedFromElement(req, toTableId, 'Occupied', fromOrder.id);

          return res.json({
        success: true,
            message: `Table ${fromTableId} order moved to ${toTableId}`,
            fromTable: { id: fromTableId, status: 'Available' },
            toTable: { id: toTableId, status: 'Occupied', orderId: fromOrder.id }
          });
    } catch (error) {
      await dbRun('ROLLBACK');
      throw error;
    }
      }

      // If only target has order, just update source status
      if (!fromOrder && toOrder) {
        console.log('[TABLE MERGE] Only target has order - updating source status');
        
        await dbRun('BEGIN TRANSACTION');
        
        try {
          // Update source table to Available
          await dbRun(
            'UPDATE table_map_elements SET status = ?, current_order_id = NULL WHERE element_id = ? AND floor = ?',
            ['Available', fromTableId, floor || '1F']
          );

          // Record merge history
            await dbRun(
            `INSERT INTO table_move_history (from_table_id, to_table_id, action_type, order_id, floor, performed_at)
             VALUES (?, ?, ?, ?, ?, datetime('now'))`,
            [fromTableId, toTableId, 'MERGE', toOrder.id, floor || '1F']
            );

            await dbRun('COMMIT');

          emitDeviceTableUpdatedFromElement(req, fromTableId, 'Available', null);

          // Firebase에 머지 히스토리 동기화
          const restaurantId = process.env.FIREBASE_RESTAURANT_ID;
          if (restaurantId) {
            salesSyncService.syncTableMergeToFirebase({
              actionType: 'MERGE',
              fromTableId,
              toTableId,
              floor: floor || '1F',
              fromOrderId: null,
              toOrderId: toOrder.id,
              movedItemCount: 0,
              partial: false
            }, restaurantId).catch(err => console.warn('[SalesSync] Table merge sync error:', err.message));
          }

          return res.json({
                success: true,
            message: `Table ${fromTableId} merged into ${toTableId} (no source order)`,
            fromTable: { id: fromTableId, status: 'Available' },
            toTable: { id: toTableId, status: 'Occupied', orderId: toOrder.id }
          });
        } catch (error) {
             await dbRun('ROLLBACK');
          throw error;
        }
      }

      // Both tables have orders - perform actual merge

      // 3. Get order items from order_items table
      const fromItems = await dbAll(
        'SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC',
        [fromOrder.id]
      );
      
      const toItems = await dbAll(
        'SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC',
        [toOrder.id]
      );
      
      console.log('[TABLE MERGE] Items count:', { fromItems: fromItems.length, toItems: toItems.length });

      // 4. Check if target table has split orders
      const toGuestNumbers = new Set(toItems.filter(item => item.guest_number).map(item => item.guest_number));
      const toIsSplit = toGuestNumbers.size > 1;

      console.log('[TABLE MERGE] Target table split status:', { toIsSplit, toGuestNumbers: Array.from(toGuestNumbers) });

      let maxTargetGuest = 0;

      if (toIsSplit) {
        // Target is split: keep target guest numbers, renumber source guests
        maxTargetGuest = Math.max(...Array.from(toGuestNumbers));
        console.log('[TABLE MERGE] Max target guest:', maxTargetGuest);
      }

      // 5. Update database
    await dbRun('BEGIN TRANSACTION');

      try {
        // Copy all items from source order to target order with renumbered guests
        for (const item of fromItems) {
          let newGuestNumber = item.guest_number || 1;
          
          if (toIsSplit) {
            // Renumber by adding maxTargetGuest
            newGuestNumber = maxTargetGuest + (item.guest_number || 1);
        } else {
            // Target is NOT split: renumber source starting from 2
            newGuestNumber = 1 + (item.guest_number || 1);
          }
          
          await dbRun(
            `INSERT INTO order_items(order_id, item_id, name, quantity, price, guest_number, modifiers_json, memo_json, discount_json, split_denominator, order_line_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              toOrder.id,
              item.item_id,
              item.name,
              item.quantity,
              item.price,
              newGuestNumber,
              item.modifiers_json,
              item.memo_json,
              item.discount_json,
              item.split_denominator,
              item.order_line_id
            ]
          );
        }
        
        // If target was NOT split, renumber all target items to guest 1
        if (!toIsSplit && toItems.length > 0) {
          await dbRun(
            'UPDATE order_items SET guest_number = 1 WHERE order_id = ? AND guest_number IS NULL OR guest_number = 0',
            [toOrder.id]
          );
        }

        // Update source table to Available
      await dbRun(
        'UPDATE table_map_elements SET status = ?, current_order_id = NULL WHERE element_id = ? AND floor = ?',
          ['Available', fromTableId, floor || '1F']
      );

        // Mark source order as merged
        await dbRun(
          'UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['MERGED', fromOrder.id]
      );

        // Record merge history
      await dbRun(
          `INSERT INTO table_move_history (from_table_id, to_table_id, action_type, order_id, from_order_id, floor, performed_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
          [fromTableId, toTableId, 'MERGE', toOrder.id, fromOrder.id, floor || '1F']
        );

        await dbRun('COMMIT');

        emitDeviceTableUpdatedFromElement(req, fromTableId, 'Available', null);
        emitDeviceTableUpdatedFromElement(req, toTableId, 'Occupied', toOrder.id);

        console.log('[TABLE MERGE] Successfully merged tables');
        
        // Get final item count
        const finalItems = await dbAll(
          'SELECT COUNT(*) as count FROM order_items WHERE order_id = ?',
          [toOrder.id]
        );

        // Firebase에 머지 히스토리 동기화
        const restaurantId = process.env.FIREBASE_RESTAURANT_ID;
        if (restaurantId) {
          salesSyncService.syncTableMergeToFirebase({
            actionType: 'MERGE',
            fromTableId,
            toTableId,
            floor: floor || '1F',
            fromOrderId: fromOrder.id,
            toOrderId: toOrder.id,
            movedItemCount: finalItems[0]?.count || 0,
            partial: false
          }, restaurantId).catch(err => console.warn('[SalesSync] Table merge sync error:', err.message));
        }

        res.json({
            success: true,
          message: `Table ${fromTableId} merged into ${toTableId}`,
          fromTable: { id: fromTableId, status: 'Available' },
          toTable: { id: toTableId, status: 'Occupied', orderId: toOrder.id },
        mergedOrder: {
            id: toOrder.id,
            tableId: toTableId,
            totalItems: finalItems[0]?.count || 0
          }
        });

    } catch (error) {
        await dbRun('ROLLBACK');
        throw error;
      }

    } catch (error) {
      console.error('[TABLE MERGE] Error:', error);
      console.error('[TABLE MERGE] Stack:', error.stack);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to merge tables', 
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });

  // POST /api/table-operations/merge-to-togo - Merge table order to Togo/Online order
  router.post('/merge-to-togo', async (req, res) => {
    try {
      const { fromTableId, toOrderId, toChannel, floor } = req.body;

      if (!fromTableId || !toOrderId) {
        return res.status(400).json({ 
          success: false, 
          error: 'fromTableId and toOrderId are required' 
        });
      }

      console.log('[TABLE TO TOGO] Starting merge operation:', { fromTableId, toOrderId, toChannel, floor });

      // 1. Get source table and verify it's Occupied
      const fromTable = await dbGet(
        'SELECT * FROM table_map_elements WHERE element_id = ? AND floor = ?',
        [fromTableId, floor || '1F']
      );

      if (!fromTable) {
        return res.status(404).json({ 
          success: false, 
          error: 'Source table not found' 
        });
      }

      // Allow Occupied or Payment Pending (Bill printed) as source
      if (fromTable.status !== 'Occupied' && fromTable.status !== 'Payment Pending') {
        return res.status(400).json({ 
          success: false, 
          error: 'Source table must be Occupied or Payment Pending' 
        });
      }

      // 2. Get order from source table (allow multiple statuses)
      let fromOrder = null;
      if (fromTable.current_order_id) {
        fromOrder = await dbGet(
          `SELECT * FROM orders WHERE id = ? AND status IN ('PENDING', 'NEW', 'RECEIVED', 'CONFIRMED', 'PREPARING', 'OPEN')`,
          [fromTable.current_order_id]
        );
      }
      
      if (!fromOrder) {
        fromOrder = await dbGet(
          `SELECT * FROM orders WHERE table_id = ? AND status IN ('PENDING', 'NEW', 'RECEIVED', 'CONFIRMED', 'PREPARING', 'OPEN')`,
          [fromTableId]
        );
      }

      if (!fromOrder) {
        return res.status(400).json({ 
          success: false, 
          error: 'No active order found on source table' 
        });
      }

      // 3. Get target Togo/Online order (allow multiple statuses for online orders)
      const toOrder = await dbGet(
        `SELECT * FROM orders WHERE id = ? AND status IN ('PENDING', 'NEW', 'RECEIVED', 'CONFIRMED', 'PREPARING', 'OPEN')`,
        [toOrderId]
      );

      if (!toOrder) {
        return res.status(404).json({ 
          success: false, 
          error: 'Target order not found or already completed' 
        });
      }

      console.log('[TABLE TO TOGO] Orders found:', { 
        fromOrder: `ID ${fromOrder.id}`,
        toOrder: `ID ${toOrder.id}`
      });

      const partialSelection = normalizePartialSelection(req.body.partialSelection);

      // 4. Get items from source order
      const fromItems = await dbAll(
        'SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC',
        [fromOrder.id]
      );

      let itemsToMove = fromItems;
      
      if (partialSelection) {
        itemsToMove = filterItemsBySelection(fromItems, partialSelection);
        if (!itemsToMove.length) {
          return res.status(400).json({
            success: false,
            error: 'No matching items found for the selected guests/items',
          });
        }
      }

      console.log('[TABLE TO TOGO] Items to move:', itemsToMove.length);

      await dbRun('BEGIN TRANSACTION');

      try {
        // 5. Copy items to target order (all as guest_number = 1 for Togo)
        // order_line_id가 없으면 생성 (이미 프린트된 아이템으로 표시 - ADDITIONAL 프린트 방지)
        const subtotal = calculateItemsSubtotal(itemsToMove);
        
        let itemIndex = 0;
        for (const item of itemsToMove) {
          // order_line_id가 없으면 생성 (머지된 아이템이 ADDITIONAL로 재프린트되는 것 방지)
          const orderLineId = item.order_line_id || `MERGED-${fromOrder.id}-${itemIndex++}`;
          
          await dbRun(
            `INSERT INTO order_items(order_id, item_id, name, quantity, price, guest_number, modifiers_json, memo_json, discount_json, split_denominator, order_line_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              toOrder.id,
              item.item_id,
              item.name,
              item.quantity,
              item.price,
              1, // Togo orders use single guest
              item.modifiers_json,
              item.memo_json,
              item.discount_json,
              item.split_denominator,
              orderLineId
            ]
          );
        }

        // 6. Delete moved items from source order
        if (partialSelection) {
          const selectedIds = itemsToMove.map((item) => item.id).filter((id) => id != null);
          if (selectedIds.length) {
            const placeholders = selectedIds.map(() => '?').join(',');
            await dbRun(
              `DELETE FROM order_items WHERE id IN (${placeholders})`,
              selectedIds
            );
          }
          
          // Update source order total
          await dbRun(
            'UPDATE orders SET total = MAX(COALESCE(total,0) - ?, 0) WHERE id = ?',
            [subtotal, fromOrder.id]
          );
        }

        // 7. Update target order total
        await dbRun(
          'UPDATE orders SET total = COALESCE(total,0) + ? WHERE id = ?',
          [subtotal, toOrder.id]
        );

        // 8. Check remaining items on source table
        const remainingRow = await dbGet(
          'SELECT COUNT(*) as count FROM order_items WHERE order_id = ?',
          [fromOrder.id]
        );
        const remainingCount = remainingRow?.count || 0;
        const isPartial = !!partialSelection;
        
        // 9. Update source table status
        let sourceStatus;
        let sourceOrderIdValue;
        
        if (isPartial && remainingCount > 0) {
          sourceStatus = 'Occupied';
          sourceOrderIdValue = fromOrder.id;
          await renumberOrderGuests(fromOrder.id);
        } else {
          sourceStatus = 'Available';
          sourceOrderIdValue = null;
          
          // Mark source order as merged
          await dbRun(
            'UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            ['MERGED', fromOrder.id]
          );
        }

        await dbRun(
          'UPDATE table_map_elements SET status = ?, current_order_id = ? WHERE element_id = ? AND floor = ?',
          [sourceStatus, sourceOrderIdValue, fromTableId, floor || '1F']
        );

        // 10. Record merge history (use 'MERGE' action_type due to CHECK constraint)
        await dbRun(
          `INSERT INTO table_move_history (from_table_id, to_table_id, action_type, order_id, from_order_id, floor, performed_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
          [fromTableId, `TOGO_${toOrderId}`, 'MERGE', toOrder.id, fromOrder.id, floor || '1F']
        );

        await dbRun('COMMIT');

        emitDeviceTableUpdatedFromElement(req, fromTableId, sourceStatus, sourceOrderIdValue);

        console.log('[TABLE TO TOGO] Successfully merged to Togo');

        // Firebase에 머지 히스토리 동기화
        const restaurantId = process.env.FIREBASE_RESTAURANT_ID;
        if (restaurantId) {
          salesSyncService.syncTableMergeToFirebase({
            actionType: 'MERGE',
            fromTableId,
            toTableId: `TOGO_${toOrderId}`,
            floor: floor || '1F',
            fromOrderId: fromOrder.id,
            toOrderId: toOrder.id,
            movedItemCount: itemsToMove.length,
            partial: isPartial
          }, restaurantId).catch(err => console.warn('[SalesSync] Table to Togo merge sync error:', err.message));
        }

        res.json({
          success: true,
          message: `Table ${fromTableId} merged to ${toChannel || 'Togo'} order #${toOrderId}`,
          fromTable: { id: fromTableId, status: sourceStatus },
          toOrder: { id: toOrder.id },
          partial: isPartial,
          movedItemCount: itemsToMove.length
        });

      } catch (error) {
        await dbRun('ROLLBACK');
        throw error;
      }

    } catch (error) {
      console.error('[TABLE TO TOGO] Error:', error);
      console.error('[TABLE TO TOGO] Stack:', error.stack);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to merge to Togo', 
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });

  // POST /api/table-operations/move-togo-to-table - Move Togo/Online order to Available table
  router.post('/move-togo-to-table', async (req, res) => {
    try {
      const { fromOrderId, toTableId, floor } = req.body;

      if (!fromOrderId || !toTableId) {
        return res.status(400).json({ 
          success: false, 
          error: 'fromOrderId and toTableId are required' 
        });
      }

      console.log('[TOGO TO TABLE MOVE] Starting:', { fromOrderId, toTableId, floor });

      // 1. Get source order (allow PENDING, NEW, RECEIVED, CONFIRMED, PREPARING for online orders)
      const fromOrder = await dbGet(
        `SELECT * FROM orders WHERE id = ? AND status IN ('PENDING', 'NEW', 'RECEIVED', 'CONFIRMED', 'PREPARING', 'OPEN')`,
        [fromOrderId]
      );

      if (!fromOrder) {
        return res.status(404).json({ 
          success: false, 
          error: 'Source order not found or already completed/cancelled' 
        });
      }

      // 2. Verify target table is Available
      const toTable = await dbGet(
        'SELECT * FROM table_map_elements WHERE element_id = ? AND floor = ?',
        [toTableId, floor || '1F']
      );

      if (!toTable || toTable.status !== 'Available') {
        return res.status(400).json({ 
          success: false, 
          error: 'Target table must be Available' 
        });
      }

      console.log('[TOGO TO TABLE MOVE] Order found:', `ID ${fromOrder.id}`);

      await dbRun('BEGIN TRANSACTION');

      try {
        // 2.5. Update items without order_line_id (ADDITIONAL 프린트 방지)
        const itemsWithoutLineId = await dbAll(
          'SELECT id FROM order_items WHERE order_id = ? AND (order_line_id IS NULL OR order_line_id = "")',
          [fromOrder.id]
        );
        for (let i = 0; i < itemsWithoutLineId.length; i++) {
          await dbRun(
            'UPDATE order_items SET order_line_id = ? WHERE id = ?',
            [`MOVED-${fromOrder.id}-${i}`, itemsWithoutLineId[i].id]
          );
        }
        
        // 3. Update order to be a table order (order_type = POS로 변경하면 온라인 목록에서 자동 제외)
        await dbRun(
          'UPDATE orders SET table_id = ?, order_type = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [toTableId, 'POS', fromOrder.id]
        );

        // 4. Update table status to Occupied
        await dbRun(
          'UPDATE table_map_elements SET status = ?, current_order_id = ? WHERE element_id = ? AND floor = ?',
          ['Occupied', fromOrder.id, toTableId, floor || '1F']
        );

        // 5. Record history
        await dbRun(
          `INSERT INTO table_move_history (from_table_id, to_table_id, action_type, order_id, floor, performed_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))`,
          [`TOGO_${fromOrderId}`, toTableId, 'MOVE', fromOrder.id, floor || '1F']
        );

        await dbRun('COMMIT');

        emitDeviceTableUpdatedFromElement(req, toTableId, 'Occupied', fromOrder.id);

        console.log('[TOGO TO TABLE MOVE] Successfully moved');

        // Firebase에 이동 히스토리 동기화
        const restaurantId = process.env.FIREBASE_RESTAURANT_ID;
        if (restaurantId) {
          salesSyncService.syncTableMergeToFirebase({
            actionType: 'MOVE',
            fromTableId: `TOGO_${fromOrderId}`,
            toTableId,
            floor: floor || '1F',
            fromOrderId: fromOrder.id,
            toOrderId: fromOrder.id,
            movedItemCount: 0,
            partial: false
          }, restaurantId).catch(err => console.warn('[SalesSync] Togo to Table move sync error:', err.message));
        }

        res.json({
          success: true,
          message: `Order moved to Table ${toTableId}`,
          newOrderId: fromOrder.id,
          toTable: { id: toTableId, status: 'Occupied' }
        });

      } catch (error) {
        await dbRun('ROLLBACK');
        throw error;
      }

    } catch (error) {
      console.error('[TOGO TO TABLE MOVE] Error:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to move to table', 
        details: error.message
      });
    }
  });

  // POST /api/table-operations/merge-togo-to-table - Merge Togo/Online order to Occupied table
  router.post('/merge-togo-to-table', async (req, res) => {
    try {
      const { fromOrderId, toTableId, floor } = req.body;

      if (!fromOrderId || !toTableId) {
        return res.status(400).json({ 
          success: false, 
          error: 'fromOrderId and toTableId are required' 
        });
      }

      console.log('[TOGO TO TABLE MERGE] Starting:', { fromOrderId, toTableId, floor });

      // 1. Get source order (allow PENDING, NEW, RECEIVED, CONFIRMED, PREPARING for online orders)
      const fromOrder = await dbGet(
        `SELECT * FROM orders WHERE id = ? AND status IN ('PENDING', 'NEW', 'RECEIVED', 'CONFIRMED', 'PREPARING', 'OPEN')`,
        [fromOrderId]
      );

      if (!fromOrder) {
        return res.status(404).json({ 
          success: false, 
          error: 'Source order not found or already completed/cancelled' 
        });
      }

      // 2. Get target table
      const toTable = await dbGet(
        'SELECT * FROM table_map_elements WHERE element_id = ? AND floor = ?',
        [toTableId, floor || '1F']
      );

      // Allow Occupied or Payment Pending (Bill printed) as target
      if (!toTable || (toTable.status !== 'Occupied' && toTable.status !== 'Payment Pending')) {
        return res.status(400).json({ 
          success: false, 
          error: 'Target table must be Occupied or Payment Pending' 
        });
      }

      // 3. Get target table's order (allow multiple statuses for flexibility)
      let toOrder = null;
      if (toTable.current_order_id) {
        toOrder = await dbGet(
          `SELECT * FROM orders WHERE id = ? AND status IN ('PENDING', 'NEW', 'RECEIVED', 'CONFIRMED', 'PREPARING', 'OPEN')`,
          [toTable.current_order_id]
        );
      }
      if (!toOrder) {
        toOrder = await dbGet(
          `SELECT * FROM orders WHERE table_id = ? AND status IN ('PENDING', 'NEW', 'RECEIVED', 'CONFIRMED', 'PREPARING', 'OPEN')`,
          [toTableId]
        );
      }

      if (!toOrder) {
        return res.status(400).json({ 
          success: false, 
          error: 'No active order found on target table' 
        });
      }

      console.log('[TOGO TO TABLE MERGE] Orders found:', { from: fromOrder.id, to: toOrder.id });

      // 4. Get items from source order
      const fromItems = await dbAll(
        'SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC',
        [fromOrder.id]
      );

      // Get existing guest numbers on target
      const toItems = await dbAll(
        'SELECT DISTINCT guest_number FROM order_items WHERE order_id = ?',
        [toOrder.id]
      );
      const maxGuestNumber = toItems.length > 0 
        ? Math.max(...toItems.map(i => Number(i.guest_number) || 1))
        : 0;

      await dbRun('BEGIN TRANSACTION');

      try {
        // 5. Copy items to target order with new guest numbers
        // order_line_id가 없으면 생성 (이미 프린트된 아이템으로 표시 - ADDITIONAL 프린트 방지)
        const subtotal = calculateItemsSubtotal(fromItems);
        const newGuestNumber = maxGuestNumber + 1;
        
        let itemIndex = 0;
        for (const item of fromItems) {
          // order_line_id가 없으면 생성 (머지된 아이템이 ADDITIONAL로 재프린트되는 것 방지)
          const orderLineId = item.order_line_id || `MERGED-${fromOrder.id}-${itemIndex++}`;
          
          await dbRun(
            `INSERT INTO order_items(order_id, item_id, name, quantity, price, guest_number, modifiers_json, memo_json, discount_json, split_denominator, order_line_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              toOrder.id,
              item.item_id,
              item.name,
              item.quantity,
              item.price,
              newGuestNumber,
              item.modifiers_json,
              item.memo_json,
              item.discount_json,
              item.split_denominator,
              orderLineId
            ]
          );
        }

        // 6. Update target order total
        await dbRun(
          'UPDATE orders SET total = COALESCE(total,0) + ? WHERE id = ?',
          [subtotal, toOrder.id]
        );

        // 7. Delete source order items and mark as merged
        await dbRun('DELETE FROM order_items WHERE order_id = ?', [fromOrder.id]);
        await dbRun(
          'UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          ['MERGED', fromOrder.id]
        );

        // 8. Record history
        await dbRun(
          `INSERT INTO table_move_history (from_table_id, to_table_id, action_type, order_id, from_order_id, floor, performed_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
          [`TOGO_${fromOrderId}`, toTableId, 'MERGE', toOrder.id, fromOrder.id, floor || '1F']
        );

        await dbRun('COMMIT');

        console.log('[TOGO TO TABLE MERGE] Successfully merged');

        // Firebase에 머지 히스토리 동기화
        const restaurantId = process.env.FIREBASE_RESTAURANT_ID;
        if (restaurantId) {
          salesSyncService.syncTableMergeToFirebase({
            actionType: 'MERGE',
            fromTableId: `TOGO_${fromOrderId}`,
            toTableId,
            floor: floor || '1F',
            fromOrderId: fromOrder.id,
            toOrderId: toOrder.id,
            movedItemCount: fromItems.length,
            partial: false
          }, restaurantId).catch(err => console.warn('[SalesSync] Togo to Table merge sync error:', err.message));
        }

        res.json({
          success: true,
          message: `Order merged to Table ${toTableId}`,
          toOrder: { id: toOrder.id },
          movedItemCount: fromItems.length
        });

      } catch (error) {
        await dbRun('ROLLBACK');
        throw error;
      }

    } catch (error) {
      console.error('[TOGO TO TABLE MERGE] Error:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to merge to table', 
        details: error.message
      });
    }
  });

  // POST /api/table-operations/merge-togo-to-togo - Merge Togo order to another Togo order
  router.post('/merge-togo-to-togo', async (req, res) => {
    try {
      const { fromOrderId, toOrderId } = req.body;

      if (!fromOrderId || !toOrderId) {
        return res.status(400).json({ 
          success: false, 
          error: 'fromOrderId and toOrderId are required' 
        });
      }

      console.log('[TOGO TO TOGO] Starting merge operation:', { fromOrderId, toOrderId });

      // 1. Get source order (Online orders may have different status like RECEIVED, NEW, CONFIRMED)
      const fromOrder = await dbGet(
        'SELECT * FROM orders WHERE id = ?',
        [fromOrderId]
      );

      if (!fromOrder) {
        return res.status(404).json({ 
          success: false, 
          error: 'Source order not found' 
        });
      }

      // Check if source order can be merged (not in terminal status)
      const terminalStatuses = ['COMPLETED', 'CANCELLED', 'MERGED', 'PAID', 'REFUNDED'];
      if (terminalStatuses.includes(fromOrder.status)) {
        return res.status(400).json({ 
          success: false, 
          error: `Source order cannot be merged (status: ${fromOrder.status})` 
        });
      }

      // 2. Get target Togo order
      const toOrder = await dbGet(
        'SELECT * FROM orders WHERE id = ?',
        [toOrderId]
      );

      if (!toOrder) {
        return res.status(404).json({ 
          success: false, 
          error: 'Target order not found' 
        });
      }

      // Check if target order can receive merge (not in terminal status)
      if (terminalStatuses.includes(toOrder.status)) {
        return res.status(400).json({ 
          success: false, 
          error: `Target order cannot be merged into (status: ${toOrder.status})` 
        });
      }

      console.log('[TOGO TO TOGO] Orders found:', { 
        fromOrder: `ID ${fromOrder.id}`,
        toOrder: `ID ${toOrder.id}`
      });

      // 3. Get items from source order
      const fromItems = await dbAll(
        'SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC',
        [fromOrder.id]
      );

      console.log('[TOGO TO TOGO] Items to move:', fromItems.length);

      await dbRun('BEGIN TRANSACTION');

      try {
        // 4. Copy items to target order (all as guest_number = 1 for Togo)
        // order_line_id가 없으면 생성 (이미 프린트된 아이템으로 표시 - ADDITIONAL 프린트 방지)
        const subtotal = calculateItemsSubtotal(fromItems);
        
        let itemIndex = 0;
        for (const item of fromItems) {
          // order_line_id가 없으면 생성 (머지된 아이템이 ADDITIONAL로 재프린트되는 것 방지)
          const orderLineId = item.order_line_id || `MERGED-${fromOrder.id}-${itemIndex++}`;
          
          await dbRun(
            `INSERT INTO order_items(order_id, item_id, name, quantity, price, guest_number, modifiers_json, memo_json, discount_json, split_denominator, order_line_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              toOrder.id,
              item.item_id,
              item.name,
              item.quantity,
              item.price,
              1, // Togo orders use single guest
              item.modifiers_json,
              item.memo_json,
              item.discount_json,
              item.split_denominator,
              orderLineId
            ]
          );
        }

        // 5. Update target order total
        await dbRun(
          'UPDATE orders SET total = COALESCE(total,0) + ? WHERE id = ?',
          [subtotal, toOrder.id]
        );

        // 6. Delete source order items
        await dbRun(
          'DELETE FROM order_items WHERE order_id = ?',
          [fromOrder.id]
        );

        // 7. Mark source order as merged
        await dbRun(
          'UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          ['MERGED', fromOrder.id]
        );

        // 8. Record merge history
        await dbRun(
          `INSERT INTO table_move_history (from_table_id, to_table_id, action_type, order_id, from_order_id, floor, performed_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
          [`TOGO_${fromOrderId}`, `TOGO_${toOrderId}`, 'MERGE', toOrder.id, fromOrder.id, '1F']
        );

        await dbRun('COMMIT');

        console.log('[TOGO TO TOGO] Successfully merged');

        // Firebase에 머지 히스토리 동기화
        const restaurantId = process.env.FIREBASE_RESTAURANT_ID;
        if (restaurantId) {
          salesSyncService.syncTableMergeToFirebase({
            actionType: 'MERGE',
            fromTableId: `TOGO_${fromOrderId}`,
            toTableId: `TOGO_${toOrderId}`,
            floor: '1F',
            fromOrderId: fromOrder.id,
            toOrderId: toOrder.id,
            movedItemCount: fromItems.length,
            partial: false
          }, restaurantId).catch(err => console.warn('[SalesSync] Togo to Togo merge sync error:', err.message));
        }

        res.json({
          success: true,
          message: `Togo #${fromOrderId} merged to Togo #${toOrderId}`,
          fromOrder: { id: fromOrder.id, status: 'MERGED' },
          toOrder: { id: toOrder.id },
          movedItemCount: fromItems.length
        });

      } catch (error) {
        await dbRun('ROLLBACK');
        throw error;
      }

    } catch (error) {
      console.error('[TOGO TO TOGO] Error:', error);
      console.error('[TOGO TO TOGO] Stack:', error.stack);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to merge Togo orders', 
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });

  return router;
};


