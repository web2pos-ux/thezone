const express = require('express');
const router = express.Router();
const { computePromotionAdjustment } = require('../utils/promotionCalculator');

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

  // Ensure required columns exist in orders and order_items tables
  (async () => {
    try {
      await dbRun(`ALTER TABLE orders ADD COLUMN order_source TEXT`);
    } catch (e) { /* ignore if exists */ }
    try {
      await dbRun(`ALTER TABLE orders ADD COLUMN server_name TEXT`);
    } catch (e) { /* ignore if exists */ }
    try {
      await dbRun(`ALTER TABLE orders ADD COLUMN guest_count INTEGER DEFAULT 1`);
    } catch (e) { /* ignore if exists */ }
    try {
      await dbRun(`ALTER TABLE order_items ADD COLUMN item_source TEXT`);
    } catch (e) { /* ignore if exists */ }
    try {
      await dbRun(`ALTER TABLE table_map_elements ADD COLUMN guests INTEGER DEFAULT 0`);
    } catch (e) { /* ignore if exists */ }
  })();

  // POST /api/table-orders/submit - 테이블에서 주문 제출 (테이블오더 + 핸드헬드 POS 공용)
  router.post('/submit', async (req, res) => {
    const { 
      store_id, 
      table_id, 
      table_label, 
      items, 
      customer_note,
      // 핸드헬드 POS 전용 필드
      server_name,
      guest_count,
      source = 'TABLE_QR' // 'TABLE_QR' | 'HANDHELD' | 'SUB_POS'
    } = req.body;

    if (!store_id || !table_id || !items || items.length === 0) {
      return res.status(400).json({ error: 'store_id, table_id, and items are required' });
    }

    try {
      const createdAt = new Date().toISOString();
      const orderSource = source === 'HANDHELD' ? 'HANDHELD' : 'TABLE_QR';

      // 금액 계산
      const itemsSubtotal = items.reduce((sum, item) => {
        const itemTotal = (item.price || 0) * (item.quantity || 1);
        const modifiersTotal = (item.modifiers || []).reduce((mSum, mod) => 
          mSum + (mod.price_adjustment || 0) * (item.quantity || 1), 0);
        return sum + itemTotal + modifiersTotal;
      }, 0);
      
      // 프로모션 계산
      let promotionDiscount = 0;
      let promotionAdjustment = null;
      try {
        // 프로모션 규칙 로드
        const promoRows = await dbAll('SELECT * FROM discount_promotions WHERE enabled = 1 ORDER BY created_at DESC');
        const promotionRules = promoRows.map(r => ({
          id: r.id,
          name: r.name || '',
          code: r.code || '',
          startDate: r.start_date || '',
          endDate: r.end_date || '',
          startTime: r.start_time || '',
          endTime: r.end_time || '',
          mode: (r.mode === 'amount' ? 'amount' : 'percent'),
          value: Number(r.value || 0),
          minSubtotal: Number(r.min_subtotal || 0),
          eligibleItemIds: (()=>{ try { return JSON.parse(r.eligible_item_ids||'[]'); } catch { return []; } })(),
          daysOfWeek: (()=>{ try { return JSON.parse(r.days_of_week||'[]'); } catch { return []; } })(),
          dateAlways: !!r.date_always,
          timeAlways: !!r.time_always,
          enabled: true,
          createdAt: Number(r.created_at || 0),
          channels: (()=>{ try { return JSON.parse(r.channels_json||'{}'); } catch { return {}; } })()
        }));
        
        // 프로모션 계산 (tableOrder 채널)
        const promoItems = items.map(it => ({
          id: it.item_id || it.id,
          totalPrice: it.price || 0,
          quantity: it.quantity || 1
        }));
        
        promotionAdjustment = computePromotionAdjustment(promoItems, {
          enabled: promotionRules.length > 0,
          type: 'percent',
          value: 0,
          eligibleItemIds: [],
          codeInput: '',
          rules: promotionRules,
          channel: 'tableOrder'
        });
        
        if (promotionAdjustment) {
          promotionDiscount = promotionAdjustment.amountApplied;
          console.log(`[TABLE_ORDER] Promotion applied: ${promotionAdjustment.label} - $${promotionDiscount}`);
        }
      } catch (e) {
        console.log('[TABLE_ORDER] Could not apply promotion:', e.message);
      }

      // 1. 해당 테이블에 이미 열린 주문이 있는지 확인
      const existingOrder = await dbGet(`
        SELECT id, order_number, total, guest_count FROM orders 
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
        
        // 기존 주문 총액 업데이트 (프로모션 할인 적용)
        const newTotal = (existingOrder.total || 0) + (itemsSubtotal - promotionDiscount) * 1.05; // 세금 포함
        await dbRun(`UPDATE orders SET total = ?, order_source = COALESCE(order_source, '') || ',${orderSource}' WHERE id = ?`, [newTotal, posOrderId]);
        
        console.log(`[${orderSource}] Adding items to existing order #${posOrderId} for table ${table_id}${server_name ? ` by ${server_name}` : ''}`);
      } else {
        // 새 주문 생성 — POS 일일 순번은 Day Open 이후 orders.js POST 와 동일(admin_settings.daily_order_counter)
        isNewOrder = true;
        const sessionKey =
          source === 'HANDHELD'
            ? `HH-${table_id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
            : `TO-${table_id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        orderId = sessionKey;
        const subtotalAfterDiscount = itemsSubtotal - promotionDiscount;
        const total = subtotalAfterDiscount * 1.05; // 세금 포함

        const posOrderResult = await dbRun(
          `
          INSERT INTO orders (order_number, order_type, total, status, created_at, table_id, order_source, guest_count, server_name)
          VALUES (?, 'DINE_IN', ?, 'PENDING', ?, ?, ?, ?, ?)
        `,
          [null, total, createdAt, table_id, orderSource, guest_count || 1, server_name || null]
        );

        posOrderId = posOrderResult.lastID;
        let displayNumber = String(posOrderId).padStart(3, '0');
        try {
          const counterRow = await dbGet(`SELECT value FROM admin_settings WHERE key = 'daily_order_counter'`);
          const nextNum = parseInt(counterRow?.value || '0', 10) + 1;
          await dbRun(`INSERT OR REPLACE INTO admin_settings(key, value) VALUES('daily_order_counter', ?)`, [String(nextNum)]);
          displayNumber = String(nextNum).padStart(3, '0');
          await dbRun(`UPDATE orders SET order_number = ? WHERE id = ?`, [displayNumber, posOrderId]);
        } catch (counterErr) {
          console.error(`[${orderSource}] Daily counter failed (fallback id):`, counterErr.message);
          await dbRun(`UPDATE orders SET order_number = ? WHERE id = ?`, [displayNumber, posOrderId]);
        }
        console.log(
          `[${orderSource}] New dine-in order #${displayNumber} for table ${table_id}, session ${orderId}, POS id: ${posOrderId}${server_name ? ` by ${server_name}` : ''}`
        );
      }

      // 2. order_items 테이블에 아이템 저장
      for (const item of items) {
        const modifiersJson = JSON.stringify(item.modifiers || []);
        const orderLineId = `${source === 'HANDHELD' ? 'HH' : 'TO'}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const guestNumber = item.guest_number || 1;
        
        await dbRun(`
          INSERT INTO order_items (order_id, item_id, name, quantity, price, guest_number, modifiers_json, order_line_id, item_source)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [posOrderId, item.item_id, item.name, item.quantity, item.price, guestNumber, modifiersJson, orderLineId, orderSource]);
      }

      // 3. table_orders 테이블에도 저장 (로그/히스토리용)
      const subtotalAfterPromo = itemsSubtotal - promotionDiscount;
      const taxTotal = subtotalAfterPromo * 0.05;
      const orderTotal = subtotalAfterPromo + taxTotal;
      
      if (isNewOrder) {
        await dbRun(`
          INSERT INTO table_orders (order_id, store_id, table_id, table_label, items_json, subtotal, tax_total, total, customer_note, status, promotion_discount)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?)
        `, [orderId, store_id, table_id, table_label || table_id, JSON.stringify(items), itemsSubtotal, taxTotal, orderTotal, customer_note, promotionDiscount]);
      } else {
        const logOrderId = `${orderId}-${Date.now()}`;
        await dbRun(`
          INSERT INTO table_orders (order_id, store_id, table_id, table_label, items_json, subtotal, tax_total, total, customer_note, status, promotion_discount)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?)
        `, [logOrderId, store_id, table_id, table_label || table_id, JSON.stringify(items), itemsSubtotal, taxTotal, orderTotal, customer_note, promotionDiscount]);
      }

      // 4. table_map_elements 업데이트 (테이블 상태를 Occupied로)
      try {
        await dbRun(`
          UPDATE table_map_elements 
          SET status = 'Occupied', current_order_id = ?, guests = COALESCE(?, guests, 0)
          WHERE element_id = ? OR name = ?
        `, [posOrderId, guest_count, table_id, table_id]);
        console.log(`[${orderSource}] Updated table ${table_id} status to Occupied with order ${posOrderId}`);
      } catch (e) {
        console.log(`[${orderSource}] Could not update table status:`, e.message);
      }

      // 5. Socket.io로 POS에 실시간 알림 전송
      try {
        const io = req.app.get('io');
        if (io) {
          const eventName = source === 'HANDHELD' ? 'handheld_order_received' : 'table_order_received';
          io.emit(eventName, {
            table_id,
            order_id: orderId,
            pos_order_id: posOrderId,
            is_new_order: isNewOrder,
            items_count: items.length,
            total: itemsSubtotal * 1.05,
            server_name: server_name || null,
            source: orderSource
          });
          console.log(`[${orderSource}] 📡 Pushed to POS: ${eventName} for ${table_id}`);
        }
      } catch (socketErr) {
        console.log(`[${orderSource}] Socket.io not available`);
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
      console.error('Failed to submit order:', err);
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

