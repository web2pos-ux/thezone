const express = require('express');
const router = express.Router();
const firebaseService = require('../services/firebaseService');
const remoteSyncService = require('../services/remoteSyncService');

module.exports = (db) => {
  // Helper functions
  const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
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

  // 테이블 생성 (없으면) - 기존 table_devices는 건드리지 않음
  const initTables = async () => {
    // table_devices는 기존에 다른 용도로 존재하므로 생성하지 않음
    // 테이블 오더는 URL 파라미터 기반으로 동작

    await dbRun(`
      CREATE TABLE IF NOT EXISTS table_order_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id TEXT NOT NULL UNIQUE,
        auto_kitchen_print INTEGER DEFAULT 1,
        auto_accept_order INTEGER DEFAULT 0,
        allow_payment INTEGER DEFAULT 0,
        default_menu_id INTEGER,
        theme TEXT DEFAULT 'light',
        language TEXT DEFAULT 'en',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS table_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT UNIQUE NOT NULL,
        store_id TEXT NOT NULL,
        table_id TEXT NOT NULL,
        table_label TEXT,
        status TEXT DEFAULT 'pending',
        items_json TEXT,
        subtotal REAL DEFAULT 0,
        tax_total REAL DEFAULT 0,
        total REAL DEFAULT 0,
        customer_note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  };

  initTables().catch(err => console.error('Failed to init table_orders tables:', err));

  // ==================== 테이블 디바이스 API ====================

  // GET /api/table-orders/devices - 모든 테이블 디바이스 조회
  router.get('/devices', async (req, res) => {
    try {
      const devices = await dbAll('SELECT * FROM table_devices WHERE is_active = 1 ORDER BY table_id');
      res.json(devices);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/table-orders/devices - 테이블 디바이스 등록
  router.post('/devices', async (req, res) => {
    const { store_id, table_id, table_label, menu_id, device_type } = req.body;
    
    if (!store_id || !table_id) {
      return res.status(400).json({ error: 'store_id and table_id are required' });
    }

    try {
      const deviceId = `${store_id}_${table_id}_${Date.now()}`;
      await dbRun(`
        INSERT INTO table_devices (device_id, store_id, table_id, table_label, menu_id, device_type)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [deviceId, store_id, table_id, table_label || table_id, menu_id, device_type || 'qr']);

      res.json({ 
        success: true, 
        device_id: deviceId,
        qr_url: `/table-order/${store_id}/${table_id}`
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/table-orders/info - 테이블 정보 조회 (QR 스캔 시)
  router.get('/info', async (req, res) => {
    const { storeId, tableId } = req.query;

    if (!storeId || !tableId) {
      return res.status(400).json({ error: 'storeId and tableId are required' });
    }

    try {
      // 1. Order Page Setup에서 table-qr 채널에 연결된 메뉴 찾기
      let configuredMenu = null;
      try {
        configuredMenu = await dbGet(`
          SELECT menu_id, menu_name as name 
          FROM order_page_setups 
          WHERE order_type = 'table-qr' 
          ORDER BY updated_at DESC, created_at DESC 
          LIMIT 1
        `);
        console.log('Configured menu from order_page_setups:', configuredMenu);
      } catch (e) {
        console.log('order_page_setups query failed:', e.message);
      }

      // 2. 설정된 메뉴가 없으면 첫 번째 메뉴를 fallback으로 사용
      let menuToUse = configuredMenu;
      if (!menuToUse || !menuToUse.menu_id) {
        menuToUse = await dbGet('SELECT menu_id, name FROM menus ORDER BY menu_id LIMIT 1');
        console.log('Fallback to first menu:', menuToUse);
      }
      
      console.log('Final menu to use:', menuToUse);

      // 3. Business Profile에서 상호명 가져오기
      let businessName = '';
      try {
        const businessProfile = await dbGet('SELECT business_name FROM business_profile LIMIT 1');
        businessName = businessProfile?.business_name || '';
      } catch (e) {
        console.log('business_profile query failed:', e.message);
      }

      const tableInfo = {
        store_id: storeId,
        table_id: tableId,
        table_label: tableId,
        menu_id: menuToUse?.menu_id,
        menu_name: menuToUse?.name || 'Menu',
        business_name: businessName,
        device_type: 'qr'
      };

      res.json(tableInfo);
    } catch (err) {
      console.error('Failed to get table info:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== 메뉴 조회 API ====================

  // GET /api/table-orders/menu/:menuId - 테이블 오더용 메뉴 조회
  router.get('/menu/:menuId', async (req, res) => {
    const { menuId } = req.params;

    try {
      console.log('Fetching menu for menuId:', menuId);

      // 메뉴 정보
      const menu = await dbGet('SELECT * FROM menus WHERE menu_id = ?', [menuId]);
      console.log('Menu found:', menu ? menu.name : 'NOT FOUND');
      
      if (!menu) {
        return res.status(404).json({ error: 'Menu not found' });
      }

      // 카테고리 - is_active 조건 제거 (컬럼이 없을 수 있음)
      const categories = await dbAll(`
        SELECT * FROM menu_categories 
        WHERE menu_id = ?
        ORDER BY sort_order, name
      `, [menuId]);
      console.log('Categories found:', categories.length);

      // 아이템 - is_active 조건 제거 (컬럼이 없을 수 있음)
      const items = await dbAll(`
        SELECT * FROM menu_items 
        WHERE category_id IN (SELECT category_id FROM menu_categories WHERE menu_id = ?)
        ORDER BY sort_order, name
      `, [menuId]);
      console.log('Items found:', items.length);

      // 카테고리별 아이템 그룹화
      const categoriesWithItems = categories.map(cat => ({
        ...cat,
        items: items.filter(item => item.category_id === cat.category_id)
      }));

      res.json({
        menu,
        categories: categoriesWithItems
      });
    } catch (err) {
      console.error('Menu fetch error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== 주문 API ====================

  // Ensure order_source column exists in orders table and order_items table
  (async () => {
    try {
      await dbRun(`ALTER TABLE orders ADD COLUMN order_source TEXT`);
    } catch (e) { /* ignore if exists */ }
    try {
      await dbRun(`ALTER TABLE order_items ADD COLUMN item_source TEXT`);
    } catch (e) { /* ignore if exists */ }
  })();

  // POST /api/table-orders/submit - 테이블에서 주문 제출
  router.post('/submit', async (req, res) => {
    const { store_id, table_id, table_label, items, customer_note } = req.body;

    if (!store_id || !table_id || !items || items.length === 0) {
      return res.status(400).json({ error: 'store_id, table_id, and items are required' });
    }

    try {
      const createdAt = new Date().toISOString();

      // 금액 계산
      const itemsSubtotal = items.reduce((sum, item) => {
        const itemTotal = (item.price || 0) * (item.quantity || 1);
        const modifiersTotal = (item.modifiers || []).reduce((mSum, mod) => 
          mSum + (mod.price_adjustment || 0) * (item.quantity || 1), 0);
        return sum + itemTotal + modifiersTotal;
      }, 0);

      // 1. 해당 테이블에 이미 열린 주문이 있는지 확인
      const existingOrder = await dbGet(`
        SELECT id, order_number, total FROM orders 
        WHERE table_id = ? AND status = 'PENDING' 
        ORDER BY created_at DESC LIMIT 1
      `, [table_id]);

      let posOrderId;
      let orderId;
      let isNewOrder = false;

      if (existingOrder) {
        // 기존 주문에 아이템 추가
        posOrderId = existingOrder.id;
        orderId = existingOrder.order_number || `TO-${table_id}-${existingOrder.id}`;
        
        // 기존 주문 총액 업데이트
        const newTotal = (existingOrder.total || 0) + itemsSubtotal * 1.05; // 세금 포함
        await dbRun(`UPDATE orders SET total = ?, order_source = COALESCE(order_source, '') || ',TABLE_QR' WHERE id = ?`, [newTotal, posOrderId]);
        
        console.log(`[Table Order] Adding items to existing order #${posOrderId} for table ${table_id}`);
      } else {
        // 새 주문 생성
        isNewOrder = true;
        const orderNumber = Math.floor(Math.random() * 900) + 100;
        orderId = `TO-${table_id}-${orderNumber}`;
        const total = itemsSubtotal * 1.05; // 세금 포함
        
        const posOrderResult = await dbRun(`
          INSERT INTO orders (order_number, order_type, total, status, created_at, table_id, order_source)
          VALUES (?, 'DINE_IN', ?, 'PENDING', ?, ?, 'TABLE_QR')
        `, [orderId, total, createdAt, table_id]);
        
        posOrderId = posOrderResult.lastID;
        console.log(`[Table Order] New order ${orderId} created for table ${table_id}, POS order ID: ${posOrderId}`);
      }

      // 2. order_items 테이블에 아이템 저장 (TABLE_ORDER 라벨 포함)
      for (const item of items) {
        const modifiersJson = JSON.stringify(item.modifiers || []);
        const orderLineId = `TO-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        await dbRun(`
          INSERT INTO order_items (order_id, item_id, name, quantity, price, guest_number, modifiers_json, order_line_id, item_source)
          VALUES (?, ?, ?, ?, ?, 1, ?, ?, 'TABLE_ORDER')
        `, [posOrderId, item.item_id, item.name, item.quantity, item.price, modifiersJson, orderLineId]);
      }

      // 3. table_orders 테이블에도 저장 (로그/히스토리용)
      if (isNewOrder) {
        // 새 주문인 경우만 table_orders에 삽입
        await dbRun(`
          INSERT INTO table_orders (order_id, store_id, table_id, table_label, items_json, subtotal, tax_total, total, customer_note, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted')
        `, [orderId, store_id, table_id, table_label || table_id, JSON.stringify(items), itemsSubtotal, itemsSubtotal * 0.05, itemsSubtotal * 1.05, customer_note]);
      } else {
        // 기존 주문에 아이템 추가하는 경우, 별도 로그 레코드 생성 (고유 ID 사용)
        const logOrderId = `${orderId}-${Date.now()}`;
        await dbRun(`
          INSERT INTO table_orders (order_id, store_id, table_id, table_label, items_json, subtotal, tax_total, total, customer_note, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted')
        `, [logOrderId, store_id, table_id, table_label || table_id, JSON.stringify(items), itemsSubtotal, itemsSubtotal * 0.05, itemsSubtotal * 1.05, customer_note]);
      }

      // 4. table_map_elements 업데이트 (테이블 상태를 Occupied로)
      try {
        await dbRun(`
          UPDATE table_map_elements 
          SET status = 'Occupied', current_order_id = ? 
          WHERE element_id = ? OR name = ?
        `, [posOrderId, table_id, table_id]);
        console.log(`[Table Order] Updated table ${table_id} status to Occupied with order ${posOrderId}`);
      } catch (e) {
        console.log('[Table Order] Could not update table status:', e.message);
      }

      // 5. Socket.io로 POS에 실시간 알림 전송
      try {
        const io = req.app.get('io');
        if (io) {
          io.emit('table_order_received', {
            table_id,
            order_id: orderId,
            pos_order_id: posOrderId,
            is_new_order: isNewOrder,
            items_count: items.length,
            total: itemsSubtotal * 1.05
          });
          console.log(`[Table Order] 📡 Pushed to POS: table_order_received for ${table_id}`);
        }
      } catch (socketErr) {
        console.log('[Table Order] Socket.io not available');
      }

      // 6. 파이어베이스로 주문 업로드 (Dashboard 연동)
      try {
        const restaurantId = remoteSyncService.getRestaurantId();
        if (restaurantId) {
          const firebaseOrderId = await firebaseService.uploadOrder(restaurantId, {
            orderNumber: orderId,
            orderType: 'dine_in',
            status: 'pending',
            items: items.map(it => ({
              name: it.name,
              price: it.price,
              quantity: it.quantity,
              subtotal: it.price * it.quantity,
              options: it.modifiers || []
            })),
            subtotal: itemsSubtotal,
            tax: itemsSubtotal * 0.05,
            total: itemsSubtotal * 1.05,
            tableId: table_id,
            customerName: 'Table Order',
            source: 'TableOrder',
            localOrderId: posOrderId
          });

          // Firebase ID를 SQLite 주문에 저장하여 리스너 중복 저장 방지
          if (firebaseOrderId) {
            try {
              await dbRun(`UPDATE orders SET firebase_order_id = ? WHERE id = ?`, [firebaseOrderId, posOrderId]);
            } catch (e) {
              console.error('[Table Order] Failed to save firebase_order_id to SQLite:', e.message);
            }
          }
        }
      } catch (firebaseErr) {
        console.error('[Table Order] Failed to upload to Firebase:', firebaseErr.message);
      }

      res.json({ 
        success: true, 
        order_id: orderId,
        pos_order_id: posOrderId,
        is_new_order: isNewOrder,
        subtotal: itemsSubtotal,
        tax_total: itemsSubtotal * 0.05,
        total: itemsSubtotal * 1.05
      });
    } catch (err) {
      console.error('Failed to submit table order:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/table-orders/orders - 테이블 주문 목록 조회 (POS용)
  router.get('/orders', async (req, res) => {
    const { store_id, status, table_id } = req.query;

    try {
      let sql = 'SELECT * FROM table_orders WHERE 1=1';
      const params = [];

      if (store_id) {
        sql += ' AND store_id = ?';
        params.push(store_id);
      }
      if (status) {
        sql += ' AND status = ?';
        params.push(status);
      }
      if (table_id) {
        sql += ' AND table_id = ?';
        params.push(table_id);
      }

      sql += ' ORDER BY created_at DESC LIMIT 100';

      const orders = await dbAll(sql, params);
      
      // items_json 파싱
      const parsedOrders = orders.map(order => ({
        ...order,
        items: order.items_json ? JSON.parse(order.items_json) : []
      }));

      res.json(parsedOrders);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/table-orders/orders/:orderId/status - 주문 상태 업데이트
  router.put('/orders/:orderId/status', async (req, res) => {
    const { orderId } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'status is required' });
    }

    try {
      await dbRun(`
        UPDATE table_orders SET status = ?, updated_at = datetime('now') WHERE order_id = ?
      `, [status, orderId]);

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== 설정 API ====================

  // GET /api/table-orders/settings - 설정 조회
  router.get('/settings', async (req, res) => {
    const { store_id } = req.query;

    try {
      let settings = await dbGet('SELECT * FROM table_order_settings WHERE store_id = ?', [store_id || 'default']);
      
      if (!settings) {
        settings = {
          store_id: store_id || 'default',
          auto_kitchen_print: 1,
          auto_accept_order: 0,
          allow_payment: 0,
          theme: 'light',
          language: 'en'
        };
      }

      res.json(settings);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/table-orders/settings - 설정 저장
  router.put('/settings', async (req, res) => {
    const { store_id, auto_kitchen_print, auto_accept_order, allow_payment, default_menu_id, theme, language } = req.body;

    try {
      await dbRun(`
        INSERT OR REPLACE INTO table_order_settings 
        (store_id, auto_kitchen_print, auto_accept_order, allow_payment, default_menu_id, theme, language, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `, [store_id || 'default', auto_kitchen_print, auto_accept_order, allow_payment, default_menu_id, theme, language]);

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};

