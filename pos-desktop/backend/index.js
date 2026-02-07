// backend/index.js

// Load .env from backend folder first, then fallback to root (optional in packaged app)
let dotenv = null;
try {
  dotenv = require('dotenv');
} catch (err) {
  console.warn('[Backend] dotenv not available, skipping .env load');
}
if (dotenv) {
  dotenv.config({ path: './.env' });
  dotenv.config({ path: '../.env' });
}
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const { generateMenuId } = require('./utils/idGenerator');
const { initDatabase } = require('./utils/dbInit');

// --- App & DB Initialization ---
const app = express();
const PORT = process.env.PORT || 3177;

// DB 경로: 환경 변수 우선, 없으면 기본 경로 사용
const dbPath = process.env.DB_PATH || path.resolve(__dirname, '..', 'db', 'web2pos.db');
console.log(`[Backend] Using Database: ${dbPath}`);
console.log(`[Backend] NODE_ENV: ${process.env.NODE_ENV || 'development'}`);

// uploads 경로: 환경 변수 우선, 없으면 기본 경로 (빌드된 앱 호환)
const uploadsDir = process.env.UPLOADS_PATH || path.join(__dirname, 'uploads');
console.log(`[Backend] Uploads directory: ${uploadsDir}`);
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// === 카테고리 이미지 업로드 폴더 및 multer 설정 ===
const multer = require('multer');
const categoryUploadDir = path.join(uploadsDir, 'categories');
if (!fs.existsSync(categoryUploadDir)) {
  fs.mkdirSync(categoryUploadDir, { recursive: true });
}
const categoryStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, categoryUploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${req.params.categoryId}_${Date.now()}${ext}`);
  }
});
const categoryUpload = multer({ storage: categoryStorage });

// === 메뉴아이템 이미지 업로드 폴더 및 multer 설정 ===
const itemUploadDir = path.join(uploadsDir, 'items');
if (!fs.existsSync(itemUploadDir)) {
  fs.mkdirSync(itemUploadDir, { recursive: true });
}
const itemStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, itemUploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${req.params.itemId}_${Date.now()}${ext}`);
  }
});
const itemUpload = multer({ storage: itemStorage });

const { db, dbRun, dbAll, dbGet } = require('./db');

const dbExec = (sql) => new Promise((resolve, reject) => {
  db.exec(sql, (err) => {
    if (err) reject(err);
    else resolve();
  });
});

// --- Server Startup ---
const startServer = async () => {
  try {
    console.log('=== 데이터베이스 연결 정보 (v3) ===');
    console.log('Database connected successfully to', dbPath);
    console.log('현재 작업 디렉토리:', __dirname);
    
    // 테이블 생성 및 표준화 (Single Source of Truth)
    await initDatabase(db);
    
    await new Promise((resolve, reject) => {
        db.serialize(() => {
            // Printer Layout Settings (Standardized)
            db.run(`CREATE TABLE IF NOT EXISTS printer_layout_settings (
                id INTEGER PRIMARY KEY CHECK(id=1),
                settings TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);
            
            db.get('SELECT id FROM printer_layout_settings WHERE id = 1', (err, row) => {
                if (!row) {
                    // 기본 프린터 레이아웃 설정 (백오피스에서 설정한 레이아웃)
                    const { defaultPrinterLayoutSettings } = require('./config/defaultPrinterLayouts');
                    db.run('INSERT INTO printer_layout_settings (id, settings) VALUES (1, ?)', [JSON.stringify(defaultPrinterLayoutSettings)]);
                    console.log('[Backend] Initialized default printer layout settings (full layout)');
                }
            });

            // Main Layout Settings
            db.run(`CREATE TABLE IF NOT EXISTS layout_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                settings_data TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);
            
            // Modifier Labels (Standardized)
            db.run(`CREATE TABLE IF NOT EXISTS modifier_labels (
                label_id INTEGER PRIMARY KEY,
                modifier_group_id INTEGER NOT NULL,
                label_name TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (modifier_group_id) REFERENCES modifier_groups(modifier_group_id) ON DELETE CASCADE
            )`);

            console.log('[Backend] 추가 테이블 초기화 완료');
            resolve();
        });
    });

    // One-time data migration for legacy data
    const migrateLegacyData = async () => {
      const needsMigration = (await dbAll("PRAGMA table_info(menu_categories)")).some(col => col.name === 'menu_id') &&
                             (await dbAll("SELECT 1 FROM menu_categories WHERE menu_id IS NULL LIMIT 1")).length > 0;

      if (needsMigration) {
        console.log("Legacy data found. Starting migration...");
        const newMenuId = await generateMenuId(db);
        await dbRun("INSERT INTO menus (menu_id, name, description) VALUES (?, ?, ?)", [newMenuId, '20260630-1', '']);
        await dbRun("UPDATE menu_categories SET menu_id = ? WHERE menu_id IS NULL", [newMenuId]);
        await dbRun("UPDATE menu_items SET menu_id = ? WHERE menu_id IS NULL", [newMenuId]);
        console.log(`Migration complete. Legacy data moved to new Menu '20260630-1' (ID: ${newMenuId}).`);
      }
    };

    // Function to add the short_name column if it doesn't exist
    const addShortNameColumn = async () => {
      const columns = await dbAll("PRAGMA table_info(menu_items)");
      const columnExists = columns.some(col => col.name === 'short_name');
      if (!columnExists) {
        await dbRun("ALTER TABLE menu_items ADD COLUMN short_name TEXT");
        console.log("Successfully added 'short_name' column to 'menu_items' table.");
      }
    };

    // Function to add menu_id columns if they don't exist
    const addMenuIdColumns = async () => {
      const tables = ['menu_categories', 'menu_items'];
      for (const tableName of tables) {
        const columns = await dbAll(`PRAGMA table_info(${tableName})`);
        const columnExists = columns.some(col => col.name === 'menu_id');
        if (!columnExists) {
          await dbRun(`ALTER TABLE ${tableName} ADD COLUMN menu_id INTEGER`);
          console.log(`Successfully added 'menu_id' column to '${tableName}' table.`);
        }
      }
    };
    
    // Function to add the image_url column if it doesn't exist
    const addImageUrlColumn = async () => {
      const columns = await dbAll("PRAGMA table_info(menu_categories)");
      const columnExists = columns.some(col => col.name === 'image_url');
      if (!columnExists) {
        await dbRun("ALTER TABLE menu_categories ADD COLUMN image_url TEXT");
        console.log("Successfully added 'image_url' column to 'menu_categories' table.");
      }
    };
    
    // Function to add the image_url column to menu_items if it doesn't exist
    const addItemImageUrlColumn = async () => {
      const columns = await dbAll("PRAGMA table_info(menu_items)");
      const columnExists = columns.some(col => col.name === 'image_url');
      if (!columnExists) {
        await dbRun("ALTER TABLE menu_items ADD COLUMN image_url TEXT");
        console.log("Successfully added 'image_url' column to 'menu_items' table.");
      }
    };

    // Ensure is_open_price column exists for menu_items
    const addIsOpenPriceColumn = async () => {
      const columns = await dbAll("PRAGMA table_info(menu_items)");
      const exists = columns.some(col => col.name === 'is_open_price');
      if (!exists) {
        await dbRun("ALTER TABLE menu_items ADD COLUMN is_open_price INTEGER DEFAULT 0");
        console.log("Successfully added 'is_open_price' column to 'menu_items' table.");
      }
    };

    // Add sales_channels column to menus table
    const addSalesChannelsColumn = async () => {
      const columns = await dbAll("PRAGMA table_info(menus)");
      const exists = columns.some(col => col.name === 'sales_channels');
      if (!exists) {
        await dbRun("ALTER TABLE menus ADD COLUMN sales_channels TEXT DEFAULT '[]'");
        console.log("Successfully added 'sales_channels' column to 'menus' table.");
      }
    };

    // Add price_delta2 column to modifiers table for Price 2 support
    const addPriceDelta2Column = async () => {
      const columns = await dbAll("PRAGMA table_info(modifiers)");
      const exists = columns.some(col => col.name === 'price_delta2');
      if (!exists) {
        await dbRun("ALTER TABLE modifiers ADD COLUMN price_delta2 REAL DEFAULT 0");
        console.log("Successfully added 'price_delta2' column to 'modifiers' table.");
      }
    };

    // Add visibility columns to menu_items for online/delivery hide feature
    const addVisibilityColumns = async () => {
      const columns = await dbAll("PRAGMA table_info(menu_items)");
      const hasOnlineVisible = columns.some(col => col.name === 'online_visible');
      const hasDeliveryVisible = columns.some(col => col.name === 'delivery_visible');
      const hasOnlineHideType = columns.some(col => col.name === 'online_hide_type');
      const hasOnlineAvailableUntil = columns.some(col => col.name === 'online_available_until');
      const hasDeliveryHideType = columns.some(col => col.name === 'delivery_hide_type');
      const hasDeliveryAvailableUntil = columns.some(col => col.name === 'delivery_available_until');
      
      if (!hasOnlineVisible) {
        await dbRun("ALTER TABLE menu_items ADD COLUMN online_visible INTEGER DEFAULT 1");
        console.log("Successfully added 'online_visible' column to 'menu_items' table.");
      }
      if (!hasDeliveryVisible) {
        await dbRun("ALTER TABLE menu_items ADD COLUMN delivery_visible INTEGER DEFAULT 1");
        console.log("Successfully added 'delivery_visible' column to 'menu_items' table.");
      }
      // 새 컬럼: hide_type (visible, permanent, time_limited), available_until (HH:MM 형식)
      if (!hasOnlineHideType) {
        await dbRun("ALTER TABLE menu_items ADD COLUMN online_hide_type TEXT DEFAULT 'visible'");
        console.log("Successfully added 'online_hide_type' column to 'menu_items' table.");
      }
      if (!hasOnlineAvailableUntil) {
        await dbRun("ALTER TABLE menu_items ADD COLUMN online_available_until TEXT");
        console.log("Successfully added 'online_available_until' column to 'menu_items' table.");
      }
      if (!hasDeliveryHideType) {
        await dbRun("ALTER TABLE menu_items ADD COLUMN delivery_hide_type TEXT DEFAULT 'visible'");
        console.log("Successfully added 'delivery_hide_type' column to 'menu_items' table.");
      }
      if (!hasDeliveryAvailableUntil) {
        await dbRun("ALTER TABLE menu_items ADD COLUMN delivery_available_until TEXT");
        console.log("Successfully added 'delivery_available_until' column to 'menu_items' table.");
      }
    };
    
    try {
      await addShortNameColumn();
      await addMenuIdColumns();
      await addImageUrlColumn();
      await addItemImageUrlColumn();
      await addIsOpenPriceColumn();
      await addSalesChannelsColumn();
      await addPriceDelta2Column();
      await addVisibilityColumns();
      // Ensure Sold Out records table exists
      await dbExec(`
        CREATE TABLE IF NOT EXISTS sold_out_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          menu_id INTEGER NOT NULL,
          scope TEXT NOT NULL, -- 'item' | 'category'
          key_id TEXT NOT NULL,
          soldout_type TEXT NOT NULL, -- '30min' | '1hour' | 'today' | 'indefinite'
          end_time INTEGER NOT NULL, -- 0 for indefinite, otherwise epoch ms
          selector TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(menu_id, scope, key_id)
        );
        CREATE INDEX IF NOT EXISTS idx_soldout_menu_scope ON sold_out_records(menu_id, scope);
        CREATE INDEX IF NOT EXISTS idx_soldout_endtime ON sold_out_records(end_time);
      `);
      // Ensure per-item color table exists
      await dbExec(`
        CREATE TABLE IF NOT EXISTS menu_item_colors (
          item_id TEXT PRIMARY KEY,
          color TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
      await migrateLegacyData();

      // Ensure OpenPrice_Lines table exists
      await dbExec(`
        CREATE TABLE IF NOT EXISTS OpenPrice_Lines (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_id INTEGER,
          menu_id INTEGER,
          name_label TEXT NOT NULL,
          unit_price_entered REAL NOT NULL,
          price_source TEXT NOT NULL DEFAULT 'open',
          open_price_note TEXT,
          tax_group_id_at_sale INTEGER,
          printer_group_id_at_sale INTEGER,
          entered_by_user_id INTEGER,
          approved_by_user_id INTEGER,
          approved_flag INTEGER DEFAULT 0,
          approved_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_openprice_created ON OpenPrice_Lines(created_at);
      `);

      // Ensure columns exist for approval in case of legacy table
      const cols = await dbAll("PRAGMA table_info(OpenPrice_Lines)");
      const colNames = cols.map(c => c.name);
      if (!colNames.includes('approved_flag')) {
        await dbRun('ALTER TABLE OpenPrice_Lines ADD COLUMN approved_flag INTEGER DEFAULT 0');
      }
      if (!colNames.includes('approved_at')) {
        await dbRun('ALTER TABLE OpenPrice_Lines ADD COLUMN approved_at DATETIME');
      }
      
      console.log("Database setup and migration checks complete.");

      // Initialize no-show precise scheduler (reservation_time + grace)
      try {
        const { init } = require('./utils/noShowScheduler');
        const scheduler = await init(db);
        // Expose minimal hooks if needed elsewhere
        app.set('noShowScheduler', scheduler);
        console.log('No-Show precise scheduler initialized.');
      } catch (e) {
        console.error('Failed to init no-show scheduler:', e?.message);
      }

    } catch (error) {
      console.error("Database initialization failed:", error.message);
    }
  } catch (err) {
    console.error("[Backend] Global startServer error:", err);
  }
};

// --- Middleware ---
// CORS: Allow POS frontend, Firebase/Thezoneorder admin, and local development
const allowedOrigins = [
  'http://localhost:3088',  // POS frontend
  'http://localhost:3000',  // React dev server
  'http://localhost:5173',  // Vite dev server
  'http://localhost:3177',  // Electron app (production)
  /\.thezoneorder\.com$/,   // Thezoneorder production
  /\.firebaseapp\.com$/,    // Firebase hosting
  /\.web\.app$/             // Firebase hosting (alt domain)
];

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    // Check if origin is in allowed list
    const isAllowed = allowedOrigins.some(allowed => {
      if (allowed instanceof RegExp) {
        return allowed.test(origin);
      }
      return allowed === origin;
    });
    
    if (isAllowed) {
      callback(null, true);
    } else {
      // In development, allow all origins
      if (process.env.NODE_ENV !== 'production') {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    }
  },
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadsDir));
// --- [카테고리 이미지 업로드 엔드포인트 추가] ---
app.post('/api/menu/categories/:categoryId/image', categoryUpload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const imageUrl = `/uploads/categories/${req.file.filename}`;
  // DB에 image_url 저장
  db.run(
    'UPDATE menu_categories SET image_url = ? WHERE category_id = ?',
    [imageUrl, req.params.categoryId],
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'DB update failed' });
      }
      res.json({ imageUrl });
    }
  );
});

// --- 메뉴아이템 이미지 업로드 엔드포인트 추가 ---
app.post('/api/menu/items/:itemId/image', itemUpload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const imageUrl = `/uploads/items/${req.file.filename}`;
  // DB에 image_url 저장
  db.run(
    'UPDATE menu_items SET image_url = ? WHERE item_id = ?',
    [imageUrl, req.params.itemId],
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'DB update failed' });
      }
      res.json({ imageUrl });
    }
  );
});

// --- 카테고리 이미지 삭제 엔드포인트 추가 ---
app.delete('/api/menu/categories/:categoryId/image', (req, res) => {
  db.run(
    'UPDATE menu_categories SET image_url = NULL WHERE category_id = ?',
    [req.params.categoryId],
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'DB update failed' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Category not found' });
      }
      res.json({ success: true, message: 'Category image deleted' });
    }
  );
});

// --- 메뉴아이템 이미지 삭제 엔드포인트 추가 ---
app.delete('/api/menu/items/:itemId/image', (req, res) => {
  db.run(
    'UPDATE menu_items SET image_url = NULL WHERE item_id = ?',
    [req.params.itemId],
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'DB update failed' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Item not found' });
      }
      res.json({ success: true, message: 'Item image deleted' });
    }
  );
});

// --- API Routers ---
const menuRoutes = require('./routes/menus')(db);
const menuItemRoutes = require('./routes/menu')(db);
const modifierRoutes = require('./routes/modifiers')(db);
const taxRoutes = require('./routes/taxes')(db);
const printerRoutes = require('./routes/printers')(db);
const channelRoutes = require('./routes/channels')(db);
const taxGroupRoutes = require('./routes/taxGroups')(db);
const modifierGroupRoutes = require('./routes/modifierGroups')(db);
const menuIndependentOptionsRoutes = require('./routes/menuIndependentOptions')(db);
const openPriceRoutes = require('./routes/openPrice')(db);
const reservationRoutes = require('./routes/reservations');
const reservationSettingsRoutes = require('./routes/reservation-settings');
const waitingListRoutes = require('./routes/waiting-list');
const adminSettingsRoutes = require('./routes/admin-settings');
const tableMapRoutes = require('./routes/table-map');
const layoutSettingsRoutes = require('./routes/layout-settings');
const orderPageSetupsRoutes = require('./routes/order-page-setups')(db);
const ordersRoutes = require('./routes/orders')(db);
const paymentsRoutes = require('./routes/payments')(db);
const refundsRoutes = require('./routes/refunds')(db);
const promotionsRoutes = require('./routes/promotions')(db);
const voidsRoutes = require('./routes/voids');
const soldOutRoutes = require('./routes/sold-out')(db);
const tableOperationsRoutes = require('./routes/table-operations')(db);
const tableMoveHistoryRoutes = require('./routes/table-move-history')(db);
const workScheduleRoutes = require('./routes/work-schedule');
const giftCardsRoutes = require('./routes/gift-cards')(db);
const { router: onlineOrdersRoutes, startOrderListener } = require('./routes/online-orders');
const tableOrdersRoutes = require('./routes/table-orders')(db);
const devicesRoutes = require('./routes/devices')(db);
const menuSyncRoutes = require('./routes/menu-sync');
const callServerRoutes = require('./routes/call-server');
const reportsRoutes = require('./routes/reports');
const reportsV2Routes = require('./routes/reports-v2');
const salesDashboardRoutes = require('./routes/sales-dashboard');
const deliveryChannelsRoutes = require('./routes/delivery-channels')(db);
const menuVisibilityRoutes = require('./routes/menu-visibility')(db);
const dailyClosingsRoutes = require('./routes/daily-closings')(db);
const appSettingsRoutes = require('./routes/app-settings');

app.use('/api/menus', menuRoutes);
app.use('/api/menu', menuItemRoutes);
app.use('/api/modifiers', modifierRoutes);
app.use('/api/taxes', taxRoutes);
app.use('/api/printers', printerRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/tax-groups', taxGroupRoutes);
app.use('/api/modifier-groups', modifierGroupRoutes);
app.use('/api/menu-independent-options', menuIndependentOptionsRoutes);
app.use('/api/open-price', openPriceRoutes);
app.use('/api/reservations', reservationRoutes);
app.use('/api/reservation-settings', reservationSettingsRoutes);
app.use('/api/waiting-list', waitingListRoutes);
app.use('/api/admin-settings', adminSettingsRoutes);
app.use('/api/table-map', tableMapRoutes);
app.use('/api/layout-settings', layoutSettingsRoutes);
app.use('/api/order-page-setups', orderPageSetupsRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/refunds', refundsRoutes);
app.use('/api/promotions', promotionsRoutes);
app.use('/api', voidsRoutes);
app.use('/api/sold-out', soldOutRoutes);
app.use('/api/table-operations/history', tableMoveHistoryRoutes);
app.use('/api/table-operations', tableOperationsRoutes);
app.use('/api/table-orders', tableOrdersRoutes);
app.use('/api/work-schedule', workScheduleRoutes);
app.use('/api/gift-cards', giftCardsRoutes);
app.use('/api/online-orders', onlineOrdersRoutes);
app.use('/api/devices', devicesRoutes);
app.use('/api/menu-sync', menuSyncRoutes);
app.use('/api/call-server', callServerRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/reports-v2', reportsV2Routes);
app.use('/api/sales-dashboard', salesDashboardRoutes);
app.use('/api/delivery-channels', deliveryChannelsRoutes);
app.use('/api/menu-visibility', menuVisibilityRoutes);
app.use('/api/daily-closings', dailyClosingsRoutes);
app.use('/api/app-settings', appSettingsRoutes);

// App Update Routes (앱 자동 업데이트)
const appUpdateRoutes = require('./routes/app-update');
app.use('/api/app-update', appUpdateRoutes);

// Firebase Setup Routes (매장별 Firebase 설정)
const firebaseSetupRoutes = require('./routes/firebase-setup');
app.use('/api/firebase-setup', firebaseSetupRoutes);

// Remote Sync Routes (실시간 원격 동기화)
const remoteSyncRoutes = require('./routes/remote-sync');
app.use('/api/remote-sync', remoteSyncRoutes);

// Dealer Access Routes (딜러/총판/시스템 관리자 전용)
const dealerAccessRoutes = require('./routes/dealer-access');
app.use('/api/dealer-access', dealerAccessRoutes);

// --- Basic Endpoints ---
// 주의: '/' 핸들러는 프론트엔드 서빙과 충돌하므로 /api/status로 변경
app.get('/api/status', (req, res) => {
  res.send('TheZonePOS Backend Server is running!');
});

app.get('/ping', (req, res) => {
  res.send('pong');
});

// --- Menu Item Colors API ---
app.get('/api/menu-item-colors', (req, res) => {
  db.all('SELECT item_id, color FROM menu_item_colors', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    const map = {};
    rows.forEach(r => { map[r.item_id] = r.color; });
    res.json(map);
  });
});

app.put('/api/menu-item-colors', (req, res) => {
  const body = req.body || {};
  const entries = Object.entries(body);
  const stmt = db.prepare('INSERT INTO menu_item_colors (item_id, color, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(item_id) DO UPDATE SET color=excluded.color, updated_at=CURRENT_TIMESTAMP');
  db.serialize(() => {
    try {
      entries.forEach(([itemId, color]) => {
        stmt.run(itemId, color);
      });
      stmt.finalize((err) => {
        if (err) return res.status(500).json({ error: 'DB update failed' });
        res.json({ ok: true, updated: entries.length });
      });
    } catch (e) {
      res.status(500).json({ error: 'DB update failed' });
    }
  });
});

// --- Socket.io Server Setup ---
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3088", "http://localhost:3000", "http://127.0.0.1:3088"],
    methods: ["GET", "POST"]
  }
});

// Socket.io 연결 핸들러
io.on('connection', (socket) => {
  console.log('🔌 POS client connected:', socket.id);
  
  // 디바이스 타입 등록 (main_pos, sub_pos, handheld)
  socket.on('register_device', (data) => {
    socket.deviceType = data.type || 'unknown';
    socket.deviceName = data.name || 'Unknown Device';
    socket.join(`device_${data.type}`);
    console.log(`📱 Device registered: ${data.name} (${data.type}) - ${socket.id}`);
    
    // 다른 클라이언트들에게 새 디바이스 알림
    socket.broadcast.emit('device_connected', {
      id: socket.id,
      type: data.type,
      name: data.name
    });
  });
  
  // 테이블 상태 변경 알림 (모든 디바이스에 브로드캐스트)
  socket.on('table_status_changed', (data) => {
    socket.broadcast.emit('table_status_changed', data);
    console.log(`🪑 Table status changed: ${data.table_id} → ${data.status}`);
  });
  
  // 핸드헬드에서 주문 전송 시 메인 POS에 알림
  socket.on('handheld_order_sent', (data) => {
    io.to('device_main_pos').emit('handheld_order_received', data);
    console.log(`📱 Handheld order sent from ${data.server_name}: Table ${data.table_id}`);
  });
  
  // 메인 POS에서 핸드헬드로 테이블 업데이트 전송
  socket.on('broadcast_table_update', (data) => {
    io.to('device_handheld').emit('table_updated', data);
    io.to('device_sub_pos').emit('table_updated', data);
  });
  
  // 결제 시작/완료 알림 (테이블 잠금용)
  socket.on('payment_started', (data) => {
    socket.broadcast.emit('payment_started', data);
    console.log(`💳 Payment started: Table ${data.table_id} by ${data.device_name}`);
  });
  
  socket.on('payment_completed', (data) => {
    socket.broadcast.emit('payment_completed', data);
    console.log(`✅ Payment completed: Table ${data.table_id}`);
  });
  
  socket.on('disconnect', () => {
    console.log(`🔌 POS client disconnected: ${socket.deviceName || socket.id} (${socket.deviceType || 'unknown'})`);
    
    // 다른 클라이언트들에게 디바이스 연결 해제 알림
    socket.broadcast.emit('device_disconnected', {
      id: socket.id,
      type: socket.deviceType,
      name: socket.deviceName
    });
  });
});

// io 객체를 전역으로 사용 가능하게 export
app.set('io', io);

// --- Health Check Endpoint (for Electron app) ---
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// --- Serve Frontend Build (Production) ---
// 여러 가능한 경로 시도 (개발 모드 / 패키징된 앱)
const possibleFrontendPaths = [
  path.resolve(__dirname, '..', 'frontend', 'build'),      // 개발 모드
  path.resolve(__dirname, '..', 'frontend-build'),         // 패키징된 앱 (extraResources)
  process.env.FRONTEND_PATH                                // 환경 변수로 지정
].filter(Boolean);

let frontendBuildPath = null;
for (const p of possibleFrontendPaths) {
  if (fs.existsSync(p)) {
    frontendBuildPath = p;
    break;
  }
}

if (frontendBuildPath) {
  console.log(`[Backend] Serving frontend from: ${frontendBuildPath}`);
  app.use(express.static(frontendBuildPath));
  
  // React Router의 모든 경로를 index.html로 리다이렉트 (API 제외)
  // Express 5.x 호환: '*' 대신 정규식 사용
  app.get(/^(?!\/api\/)(?!\/socket\.io\/).*/, (req, res, next) => {
    // 파일 확장자가 있는 요청은 static에서 처리되었으므로 스킵
    if (req.path.includes('.')) {
      return next();
    }
    res.sendFile(path.join(frontendBuildPath, 'index.html'));
  });
} else {
  console.warn('[Backend] Frontend build not found! Tried:', possibleFrontendPaths);
}

// --- Server Startup ---
server.listen(PORT, async () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  console.log(`🔌 Socket.io ready for real-time updates`);

  // Auto-initialize Remote Sync Service and Online Order Listener if restaurantId exists in DB
  try {
    const remoteSyncService = require('./services/remoteSyncService');
    const { listenToMenuVisibilityChanges, listenToDayOffChanges, listenToPauseChanges, listenToPrepTimeChanges } = require('./services/firebaseService');
    
    db.get('SELECT firebase_restaurant_id FROM business_profile WHERE id = 1', [], async (err, row) => {
      if (!err && row && row.firebase_restaurant_id) {
        const restaurantId = row.firebase_restaurant_id;
        console.log(`🔄 Auto-initializing services for restaurant: ${restaurantId}`);
        
        // 1. Remote Sync Service (Firebase Admin Control)
        await remoteSyncService.initialize(restaurantId);
        
        // 2. Online Order Listener (Real-time orders)
        if (typeof startOrderListener === 'function') {
          startOrderListener(restaurantId);
        }
        
        // 3. Menu Visibility Listener (Firebase → POS 실시간 동기화)
        const IdMapperService = require('./services/idMapperService');
        listenToMenuVisibilityChanges(restaurantId, async (change) => {
          try {
            // 1차: IdMapperService로 Firebase ID → POS ID 매핑 시도
            let posItemId = await IdMapperService.firebaseToLocal('menu_item', change.firebaseItemId);
            
            // 2차: ID 매핑 실패 시 아이템 이름으로 폴백
            if (!posItemId && change.itemName) {
              const posItem = await new Promise((resolve, reject) => {
                db.get(
                  'SELECT item_id FROM menu_items WHERE name = ?',
                  [change.itemName],
                  (err, row) => err ? reject(err) : resolve(row)
                );
              });
              posItemId = posItem?.item_id;
            }
            
            if (posItemId) {
              await new Promise((resolve, reject) => {
                db.run(
                  `UPDATE menu_items SET 
                    online_visible = ?, delivery_visible = ?,
                    online_hide_type = ?, online_available_until = ?,
                    delivery_hide_type = ?, delivery_available_until = ?
                  WHERE item_id = ?`,
                  [
                    change.onlineVisible ? 1 : 0, 
                    change.deliveryVisible ? 1 : 0, 
                    change.onlineHideType || 'visible',
                    change.onlineAvailableUntil || null,
                    change.deliveryHideType || 'visible',
                    change.deliveryAvailableUntil || null,
                    posItemId
                  ],
                  (err) => err ? reject(err) : resolve()
                );
              });
              console.log(`✅ POS visibility 동기화: ${change.itemName} [${change.firebaseItemId} → ${posItemId}] (type: ${change.onlineHideType}, until: ${change.onlineAvailableUntil})`);
            } else {
              console.warn(`⚠️ POS visibility 동기화 건너뜀: ${change.itemName} - 매핑된 POS 아이템 없음`);
            }
          } catch (syncErr) {
            console.warn(`⚠️ POS visibility 동기화 실패: ${change.itemName}`, syncErr.message);
          }
        });
        console.log(`👂 Menu Visibility 리스너 활성화 - Firebase → POS 실시간 동기화 (IdMapper 사용)`);
        
        // 4. Day Off Listener (Firebase → POS 실시간 동기화)
        listenToDayOffChanges(restaurantId, async (change) => {
          try {
            if (!change.dates || !Array.isArray(change.dates)) return;
            
            // POS의 online_day_off 테이블과 동기화
            // 먼저 기존 데이터 삭제 후 Firebase 데이터로 교체
            await new Promise((resolve, reject) => {
              db.run('DELETE FROM online_day_off', [], (err) => err ? reject(err) : resolve());
            });
            
            // Firebase 데이터 삽입
            for (const dayOff of change.dates) {
              await new Promise((resolve, reject) => {
                db.run(
                  'INSERT INTO online_day_off (date, channels, type) VALUES (?, ?, ?)',
                  [dayOff.date, dayOff.channels || 'all', dayOff.scheduleType || dayOff.type || 'closed'],
                  (err) => err ? reject(err) : resolve()
                );
              });
            }
            
            console.log(`✅ POS Day Off 동기화: ${change.dates.length}개 날짜 (${change.type})`);
          } catch (syncErr) {
            console.warn(`⚠️ POS Day Off 동기화 실패:`, syncErr.message);
          }
        });
        console.log(`👂 Day Off 리스너 활성화 - Firebase → POS 실시간 동기화`);
        
        // 5. Pause Listener (Firebase → POS 실시간 동기화)
        listenToPauseChanges(restaurantId, async (change) => {
          try {
            if (!change.settings) return;
            
            for (const [channel, data] of Object.entries(change.settings)) {
              await new Promise((resolve, reject) => {
                db.run(
                  `INSERT INTO online_pause_settings (channel, paused, paused_until, updated_at) 
                   VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                   ON CONFLICT(channel) DO UPDATE SET 
                     paused = excluded.paused, 
                     paused_until = excluded.paused_until,
                     updated_at = CURRENT_TIMESTAMP`,
                  [channel, data.paused ? 1 : 0, data.pausedUntil || null],
                  (err) => err ? reject(err) : resolve()
                );
              });
            }
            
            console.log(`✅ POS Pause 동기화: ${Object.keys(change.settings).length}개 채널 (${change.type})`);
          } catch (syncErr) {
            console.warn(`⚠️ POS Pause 동기화 실패:`, syncErr.message);
          }
        });
        console.log(`👂 Pause 리스너 활성화 - Firebase → POS 실시간 동기화`);
        
        // 6. Prep Time Listener (Firebase → POS 실시간 동기화)
        listenToPrepTimeChanges(restaurantId, async (change) => {
          try {
            if (!change.settings) return;
            
            for (const [channel, data] of Object.entries(change.settings)) {
              await new Promise((resolve, reject) => {
                db.run(
                  `INSERT INTO online_prep_time_settings (channel, mode, time, updated_at) 
                   VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                   ON CONFLICT(channel) DO UPDATE SET 
                     mode = excluded.mode, 
                     time = excluded.time,
                     updated_at = CURRENT_TIMESTAMP`,
                  [channel, data.mode || 'auto', data.time || '15'],
                  (err) => err ? reject(err) : resolve()
                );
              });
            }
            
            console.log(`✅ POS Prep Time 동기화: ${Object.keys(change.settings).length}개 채널 (${change.type})`);
          } catch (syncErr) {
            console.warn(`⚠️ POS Prep Time 동기화 실패:`, syncErr.message);
          }
        });
        console.log(`👂 Prep Time 리스너 활성화 - Firebase → POS 실시간 동기화`);
      }
    });
  } catch (syncErr) {
    console.warn('⚠️ Failed to auto-initialize services:', syncErr.message);
  }

  // Background printer dispatcher (simple interval)
  try {
    setInterval(async () => {
      try {
        const res = await fetch(`http://localhost:${PORT}/api/printers/jobs/dispatch`, { method: 'POST' });
        if (!res.ok) throw new Error('dispatch failed');
      } catch {}
    }, 5000);
  } catch {}
});
startServer();