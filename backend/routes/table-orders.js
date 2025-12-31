const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// 비디오 업로드 폴더 생성
const videoUploadDir = path.join(__dirname, '../uploads/videos');
if (!fs.existsSync(videoUploadDir)) {
  fs.mkdirSync(videoUploadDir, { recursive: true });
}

// Multer 설정 (비디오 업로드용)
const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, videoUploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'video-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const videoUpload = multer({
  storage: videoStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB 제한
  fileFilter: (req, file, cb) => {
    const allowedTypes = /mp4|webm|mov|avi|mkv/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = file.mimetype.startsWith('video/');
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only video files are allowed'));
  }
});

// Firebase 서비스
let firebaseService = null;
try {
  firebaseService = require('../services/firebaseService');
} catch (e) {
  console.log('Firebase service not available for table-orders');
}

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

    await dbRun(`
      CREATE TABLE IF NOT EXISTS table_call_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        call_id TEXT UNIQUE NOT NULL,
        store_id TEXT NOT NULL,
        table_id TEXT NOT NULL,
        table_label TEXT,
        request_type TEXT DEFAULT 'CALL_SERVER',
        message TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

  // POST /api/table-orders/call-server - 테이블에서 직원 호출/요청 전송
  router.post('/call-server', async (req, res) => {
    const { store_id, table_id, table_label, request_type, message } = req.body || {};

    if (!store_id || !table_id) {
      return res.status(400).json({ error: 'store_id and table_id are required' });
    }

    try {
      const callId = `TC-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const label = table_label || table_id;
      const type = (request_type || 'CALL_SERVER').toString().trim().toUpperCase();
      const msg = message != null ? String(message) : null;

      await dbRun(
        `
          INSERT INTO table_call_requests (call_id, store_id, table_id, table_label, request_type, message, status)
          VALUES (?, ?, ?, ?, ?, ?, 'pending')
        `,
        [callId, String(store_id), String(table_id), String(label), type, msg]
      );

      // Socket.io로 POS에 실시간 호출 알림 전송
      try {
        const io = req.app.get('io');
        if (io) {
          io.emit('table_call_server', {
            call_id: callId,
            store_id,
            table_id,
            table_label: label,
            request_type: type,
            message: msg,
            created_at: new Date().toISOString(),
          });
          console.log(`[Table Call] 📡 Pushed to POS: table_call_server for ${table_id} (${type})`);
        }
      } catch (socketErr) {
        console.log('[Table Call] Socket.io not available');
      }

      res.json({ success: true, call_id: callId });
    } catch (err) {
      console.error('Failed to submit table call request:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/table-orders/my-orders - 고객용: 해당 테이블의 현재 주문 내역 조회
  router.get('/my-orders', async (req, res) => {
    const { table_id } = req.query;

    if (!table_id) {
      return res.status(400).json({ error: 'table_id is required' });
    }

    try {
      // 해당 테이블의 PENDING 상태 주문 조회
      const order = await dbGet(`
        SELECT id, order_number, total, status, created_at, table_id 
        FROM orders 
        WHERE table_id = ? AND status = 'PENDING' 
        ORDER BY created_at DESC 
        LIMIT 1
      `, [table_id]);

      if (!order) {
        return res.json({ success: true, order: null, items: [] });
      }

      // 해당 주문의 아이템 조회
      const items = await dbAll(`
        SELECT id, item_id, name, quantity, price, modifiers_json, item_source, order_line_id
        FROM order_items 
        WHERE order_id = ? 
        ORDER BY id ASC
      `, [order.id]);

      // modifiers_json 파싱
      const parsedItems = items.map(item => ({
        ...item,
        modifiers: item.modifiers_json ? (() => { try { return JSON.parse(item.modifiers_json); } catch { return []; } })() : []
      }));

      res.json({ 
        success: true, 
        order: {
          id: order.id,
          order_number: order.order_number,
          total: order.total,
          status: order.status,
          created_at: order.created_at
        }, 
        items: parsedItems 
      });
    } catch (err) {
      console.error('Failed to get my orders:', err);
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

  // ==================== 비디오 업로드 API ====================

  // POST /api/table-orders/upload-video - 비디오 파일 업로드 (로컬)
  router.post('/upload-video', videoUpload.single('video'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No video file uploaded' });
      }

      const videoUrl = `/uploads/videos/${req.file.filename}`;
      
      console.log(`📹 비디오 업로드 완료: ${req.file.filename}`);
      
      res.json({
        success: true,
        video_url: videoUrl,
        filename: req.file.filename,
        size: req.file.size
      });
    } catch (err) {
      console.error('Video upload error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/table-orders/delete-video - 로컬 비디오 삭제
  router.delete('/delete-video', async (req, res) => {
    const { filename } = req.body;
    
    if (!filename) {
      return res.status(400).json({ error: 'filename is required' });
    }

    try {
      const filePath = path.join(videoUploadDir, filename);
      
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`📹 비디오 삭제: ${filename}`);
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'File not found' });
      }
    } catch (err) {
      console.error('Video delete error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/table-orders/videos - 업로드된 비디오 목록
  router.get('/videos', async (req, res) => {
    try {
      const files = fs.readdirSync(videoUploadDir);
      const videos = files
        .filter(f => /\.(mp4|webm|mov|avi|mkv)$/i.test(f))
        .map(f => {
          const stats = fs.statSync(path.join(videoUploadDir, f));
          return {
            filename: f,
            url: `/uploads/videos/${f}`,
            size: stats.size,
            created_at: stats.birthtime
          };
        });
      
      res.json({ success: true, videos });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== 시즌 영상 API ====================

  // 테이블 생성: seasonal_videos
  (async () => {
    try {
      await dbRun(`
        CREATE TABLE IF NOT EXISTS seasonal_videos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          video_url TEXT,
          start_month INTEGER NOT NULL,
          start_day INTEGER NOT NULL,
          end_month INTEGER NOT NULL,
          end_day INTEGER NOT NULL,
          is_active INTEGER DEFAULT 1,
          firebase_url TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } catch (e) { /* ignore */ }
  })();

  // GET /api/table-orders/seasonal-video - 현재 시즌 영상 조회
  router.get('/seasonal-video', async (req, res) => {
    try {
      const now = new Date();
      const currentMonth = now.getMonth() + 1; // 1-12
      const currentDay = now.getDate();

      // 현재 날짜에 해당하는 활성화된 시즌 영상 찾기
      const videos = await dbAll(`
        SELECT * FROM seasonal_videos 
        WHERE is_active = 1 
        ORDER BY id ASC
      `);

      let matchedVideo = null;
      for (const v of videos) {
        // 연도를 넘어가는 경우 처리 (예: 12/01 ~ 02/28)
        const startDate = v.start_month * 100 + v.start_day;
        const endDate = v.end_month * 100 + v.end_day;
        const currentDate = currentMonth * 100 + currentDay;

        if (startDate <= endDate) {
          // 같은 연도 내 (예: 06/01 ~ 08/31)
          if (currentDate >= startDate && currentDate <= endDate) {
            matchedVideo = v;
            break;
          }
        } else {
          // 연도를 넘어가는 경우 (예: 12/01 ~ 02/28)
          if (currentDate >= startDate || currentDate <= endDate) {
            matchedVideo = v;
            break;
          }
        }
      }

      if (matchedVideo) {
        res.json({
          success: true,
          video_url: matchedVideo.video_url || matchedVideo.firebase_url,
          name: matchedVideo.name
        });
      } else {
        res.json({ success: true, video_url: null });
      }
    } catch (err) {
      console.error('Failed to get seasonal video:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/table-orders/seasonal-videos - 모든 시즌 영상 목록 (관리용)
  router.get('/seasonal-videos', async (req, res) => {
    try {
      const videos = await dbAll('SELECT * FROM seasonal_videos ORDER BY start_month, start_day');
      res.json({ success: true, videos });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/table-orders/seasonal-videos - 시즌 영상 추가
  router.post('/seasonal-videos', async (req, res) => {
    const { name, video_url, start_month, start_day, end_month, end_day, firebase_url } = req.body;

    if (!name || !start_month || !start_day || !end_month || !end_day) {
      return res.status(400).json({ error: 'name, start_month, start_day, end_month, end_day are required' });
    }

    try {
      const result = await dbRun(`
        INSERT INTO seasonal_videos (name, video_url, start_month, start_day, end_month, end_day, firebase_url)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [name, video_url || null, start_month, start_day, end_month, end_day, firebase_url || null]);

      res.json({ success: true, id: result.lastID });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/table-orders/seasonal-videos/:id - 시즌 영상 수정
  router.put('/seasonal-videos/:id', async (req, res) => {
    const { id } = req.params;
    const { name, video_url, start_month, start_day, end_month, end_day, is_active, firebase_url } = req.body;

    try {
      await dbRun(`
        UPDATE seasonal_videos 
        SET name = COALESCE(?, name),
            video_url = COALESCE(?, video_url),
            start_month = COALESCE(?, start_month),
            start_day = COALESCE(?, start_day),
            end_month = COALESCE(?, end_month),
            end_day = COALESCE(?, end_day),
            is_active = COALESCE(?, is_active),
            firebase_url = COALESCE(?, firebase_url),
            updated_at = datetime('now')
        WHERE id = ?
      `, [name, video_url, start_month, start_day, end_month, end_day, is_active, firebase_url, id]);

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/table-orders/seasonal-videos/:id - 시즌 영상 삭제
  router.delete('/seasonal-videos/:id', async (req, res) => {
    const { id } = req.params;

    try {
      await dbRun('DELETE FROM seasonal_videos WHERE id = ?', [id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/table-orders/seasonal-videos/sync-from-firebase - Firebase에서 시즌 영상 가져오기
  router.post('/seasonal-videos/sync-from-firebase', async (req, res) => {
    const { restaurant_id } = req.body;
    
    if (!firebaseService) {
      return res.status(500).json({ error: 'Firebase service not available' });
    }
    
    if (!restaurant_id) {
      return res.status(400).json({ error: 'restaurant_id is required' });
    }
    
    try {
      const firebaseVideos = await firebaseService.getSeasonalVideosFromFirebase(restaurant_id);
      
      // 로컬 DB 전체 삭제 후 Firebase 데이터로 교체
      await dbRun('DELETE FROM seasonal_videos');
      
      for (const video of firebaseVideos) {
        await dbRun(`
          INSERT INTO seasonal_videos (name, video_url, start_month, start_day, end_month, end_day, is_active, firebase_url)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          video.name,
          video.video_url || null,
          video.start_month,
          video.start_day,
          video.end_month,
          video.end_day,
          video.is_active ? 1 : 0,
          video.firebase_url || null
        ]);
      }
      
      res.json({ success: true, synced_count: firebaseVideos.length });
    } catch (err) {
      console.error('Firebase sync error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/table-orders/seasonal-videos/sync-to-firebase - Firebase로 시즌 영상 업로드
  router.post('/seasonal-videos/sync-to-firebase', async (req, res) => {
    const { restaurant_id } = req.body;
    
    if (!firebaseService) {
      return res.status(500).json({ error: 'Firebase service not available' });
    }
    
    if (!restaurant_id) {
      return res.status(400).json({ error: 'restaurant_id is required' });
    }
    
    try {
      const localVideos = await dbAll('SELECT * FROM seasonal_videos');
      
      for (const video of localVideos) {
        await firebaseService.saveSeasonalVideoToFirebase(restaurant_id, {
          name: video.name,
          video_url: video.video_url,
          start_month: video.start_month,
          start_day: video.start_day,
          end_month: video.end_month,
          end_day: video.end_day,
          is_active: video.is_active === 1,
          firebase_url: video.firebase_url
        });
      }
      
      res.json({ success: true, uploaded_count: localVideos.length });
    } catch (err) {
      console.error('Firebase upload error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== Firebase Storage API ====================

  // POST /api/table-orders/firebase-storage/upload - 로컬 비디오를 Firebase Storage에 업로드
  router.post('/firebase-storage/upload', async (req, res) => {
    const { filename } = req.body;
    
    if (!firebaseService) {
      return res.status(500).json({ error: 'Firebase service not available' });
    }
    
    if (!filename) {
      return res.status(400).json({ error: 'filename is required' });
    }
    
    try {
      const localFilePath = path.join(videoUploadDir, filename);
      const destinationPath = `videos/${filename}`;
      
      const firebaseUrl = await firebaseService.uploadVideoToFirebase(localFilePath, destinationPath);
      
      res.json({ success: true, firebase_url: firebaseUrl });
    } catch (err) {
      console.error('Firebase Storage upload error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/table-orders/firebase-storage/download - Firebase Storage에서 로컬로 다운로드
  router.post('/firebase-storage/download', async (req, res) => {
    const { firebase_path, filename } = req.body;
    
    if (!firebaseService) {
      return res.status(500).json({ error: 'Firebase service not available' });
    }
    
    if (!firebase_path) {
      return res.status(400).json({ error: 'firebase_path is required' });
    }
    
    try {
      const localFilename = filename || path.basename(firebase_path);
      const localFilePath = path.join(videoUploadDir, localFilename);
      
      await firebaseService.downloadVideoFromFirebase(firebase_path, localFilePath);
      
      res.json({ 
        success: true, 
        local_url: `/uploads/videos/${localFilename}`,
        filename: localFilename
      });
    } catch (err) {
      console.error('Firebase Storage download error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/table-orders/firebase-storage/list - Firebase Storage 비디오 목록
  router.get('/firebase-storage/list', async (req, res) => {
    if (!firebaseService) {
      return res.status(500).json({ error: 'Firebase service not available' });
    }
    
    try {
      const videos = await firebaseService.listVideosFromFirebase('videos/');
      res.json({ success: true, videos });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/table-orders/firebase-storage/delete - Firebase Storage 비디오 삭제
  router.delete('/firebase-storage/delete', async (req, res) => {
    const { firebase_path } = req.body;
    
    if (!firebaseService) {
      return res.status(500).json({ error: 'Firebase service not available' });
    }
    
    if (!firebase_path) {
      return res.status(400).json({ error: 'firebase_path is required' });
    }
    
    try {
      await firebaseService.deleteVideoFromFirebase(firebase_path);
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

