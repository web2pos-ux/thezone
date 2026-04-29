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
      const hasOnlineAvailableFrom = columns.some(col => col.name === 'online_available_from');
      const hasDeliveryHideType = columns.some(col => col.name === 'delivery_hide_type');
      const hasDeliveryAvailableUntil = columns.some(col => col.name === 'delivery_available_until');
      const hasDeliveryAvailableFrom = columns.some(col => col.name === 'delivery_available_from');
      
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
      // Time-window 'from' columns (HH:MM) — when both from/until set with hide_type='time_limited',
      // visibility is treated as a recurring daily window (e.g., 11:00–15:00).
      if (!hasOnlineAvailableFrom) {
        await dbRun("ALTER TABLE menu_items ADD COLUMN online_available_from TEXT");
        console.log("Successfully added 'online_available_from' column to 'menu_items' table.");
      }
      if (!hasDeliveryAvailableFrom) {
        await dbRun("ALTER TABLE menu_items ADD COLUMN delivery_available_from TEXT");
        console.log("Successfully added 'delivery_available_from' column to 'menu_items' table.");
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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
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
const tipsRoutes = require('./routes/tips')(db);
const refundsRoutes = require('./routes/refunds')(db);
const promotionsRoutes = require('./routes/promotions')(db);
const voidsRoutes = require('./routes/voids');
const soldOutRoutes = require('./routes/sold-out')(db);
const tableOperationsRoutes = require('./routes/table-operations')(db);
const tableMoveHistoryRoutes = require('./routes/table-move-history')(db);
const workScheduleRoutes = require('./routes/work-schedule');
const giftCardsRoutes = require('./routes/gift-cards')(db);
const {
  router: onlineOrdersRoutes,
  restartOnlineOrderListenersForRestaurant,
  broadcastToRestaurant,
  stopAllFirebaseOrderListeners,
} = require('./routes/online-orders');
const tableOrdersRoutes = require('./routes/table-orders')(db);
const devicesModule = require('./routes/devices')(db);
const menuSyncRoutes = require('./routes/menu-sync');
const callServerRoutes = require('./routes/call-server');
const reportsRoutes = require('./routes/reports');
const reportsV2Routes = require('./routes/reports-v2');
const salesDashboardRoutes = require('./routes/sales-dashboard');
const deliveryChannelsRoutes = require('./routes/delivery-channels')(db);
const menuVisibilityRoutes = require('./routes/menu-visibility')(db);
const dailyClosingsRoutes = require('./routes/daily-closings')(db);
const appSettingsRoutes = require('./routes/app-settings');
const diagnosticsRoutes = require('./routes/diagnostics')(db);
const networkRoutes = require('./routes/network')();
const serverSettlementsRoutes = require('./routes/server-settlements');
const settingsTransferRoutes = require('./routes/settings-transfer');
const settingsHardwareRoutes = require('./routes/settings-hardware');
const terminalTetraRoutes = require('./routes/terminal-tetra');

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
app.use('/api', reservationRoutes);
app.use('/api/reservation-settings', reservationSettingsRoutes);
app.use('/api/waiting-list', waitingListRoutes);
app.use('/api/admin-settings', adminSettingsRoutes);
app.use('/api/table-map', tableMapRoutes);
app.use('/api/layout-settings', layoutSettingsRoutes);
app.use('/api/order-page-setups', orderPageSetupsRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/tips', tipsRoutes);
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
app.use('/api/devices', devicesModule.router);
app.use('/api/menu-sync', menuSyncRoutes);
app.use('/api/call-server', callServerRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/reports-v2', reportsV2Routes);
app.use('/api/sales-dashboard', salesDashboardRoutes);
app.use('/api/delivery-channels', deliveryChannelsRoutes);
app.use('/api/menu-visibility', menuVisibilityRoutes);
app.use('/api/daily-closings', dailyClosingsRoutes);
app.use('/api/app-settings', appSettingsRoutes);
app.use('/api/diagnostics', diagnosticsRoutes);
app.use('/api/network', networkRoutes);
const firebaseSyncDlqRoutes = require('./routes/firebase-sync-dlq')();
app.use('/api/firebase-sync', firebaseSyncDlqRoutes);
app.use('/api/server-settlements', serverSettlementsRoutes);
app.use('/api/settings-transfer', settingsTransferRoutes);
app.use('/api/settings/hardware', settingsHardwareRoutes);
app.use('/api/terminal-tetra', terminalTetraRoutes);

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

// Urban Piper 웹훅 — UP/Atlas 에서 주문 상태 변경 시 이 엔드포인트로 POST
const urbanPiperWebhookRoutes = require('./routes/urbanpiper-webhook');
app.use('/api/urbanpiper', urbanPiperWebhookRoutes);

// --- 태블릿 다운로드 페이지 ---
app.get('/table', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Table Order Setup</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center}
.container{max-width:420px;width:100%;padding:32px 24px;text-align:center}
.logo{font-size:28px;font-weight:700;color:#60a5fa;margin-bottom:8px}
.subtitle{color:#94a3b8;font-size:14px;margin-bottom:32px}
.input-group{margin-bottom:16px;text-align:left}
.input-group label{display:block;font-size:13px;color:#94a3b8;margin-bottom:6px;font-weight:500}
.input-group input{width:100%;padding:14px 16px;border:1px solid #334155;border-radius:10px;background:#1e293b;color:#f1f5f9;font-size:16px;outline:none;transition:border .2s}
.input-group input:focus{border-color:#60a5fa}
.input-group input::placeholder{color:#475569}
.btn{width:100%;padding:14px;border:none;border-radius:10px;font-size:16px;font-weight:600;cursor:pointer;transition:all .2s;margin-top:8px}
.btn-primary{background:#3b82f6;color:#fff}
.btn-primary:hover{background:#2563eb}
.btn-primary:disabled{background:#334155;color:#64748b;cursor:not-allowed}
.status{margin-top:20px;padding:14px;border-radius:10px;font-size:14px;display:none}
.status.error{display:block;background:#7f1d1d;color:#fca5a5;border:1px solid #991b1b}
.status.success{display:block;background:#14532d;color:#86efac;border:1px solid #166534}
.status.info{display:block;background:#1e3a5f;color:#93c5fd;border:1px solid #1e40af}
.spinner{display:inline-block;width:18px;height:18px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .6s linear infinite;margin-right:8px;vertical-align:middle}
@keyframes spin{to{transform:rotate(360deg)}}
.step-info{margin-top:24px;text-align:left;padding:16px;background:#1e293b;border-radius:10px;font-size:13px;color:#94a3b8;line-height:1.6}
.step-info b{color:#60a5fa}
</style>
</head>
<body>
<div class="container">
  <div class="logo">Table Order Setup</div>
  <div class="subtitle">Enter pairing code to download the app</div>

  <div class="input-group">
    <label>Pairing Code</label>
    <input id="code" type="text" maxlength="10" placeholder="Enter pairing code" autocomplete="off">
  </div>

  <button class="btn btn-primary" id="downloadBtn" onclick="startDownload()">Download APK</button>

  <div id="status" class="status"></div>

  <div class="step-info">
    <b>After download:</b><br>
    1. Open the downloaded APK file<br>
    2. Allow "Install from unknown sources" if prompted<br>
    3. Install and open the app<br>
    4. Enter the pairing code in the app<br>
    5. The app will auto-configure itself
  </div>
</div>

<script>
function showStatus(msg,type){var s=document.getElementById('status');s.className='status '+type;s.innerHTML=msg;}
function startDownload(){
  var code=document.getElementById('code').value.trim();
  if(!code){showStatus('Please enter a pairing code','error');return;}
  var btn=document.getElementById('downloadBtn');
  btn.disabled=true;btn.innerHTML='<span class="spinner"></span>Verifying...';
  showStatus('Verifying pairing code...','info');
  var x=new XMLHttpRequest();
  x.open('GET','/api/devices/download/apk?code='+encodeURIComponent(code));
  x.responseType='blob';
  x.onload=function(){
    if(x.status===200){
      showStatus('Pairing code verified! Starting download...','success');
      var a=document.createElement('a');var url=URL.createObjectURL(x.response);
      a.href=url;a.download='table-order-app-release.apk';document.body.appendChild(a);a.click();
      setTimeout(function(){document.body.removeChild(a);URL.revokeObjectURL(url);btn.disabled=false;btn.innerHTML='Download APK';},3000);
    } else {
      var reader=new FileReader();reader.onload=function(){
        try{var j=JSON.parse(reader.result);
          if(x.status===401)showStatus('Invalid pairing code. Please check and try again.','error');
          else if(x.status===404)showStatus('APK file not found on server. Please contact support.','error');
          else showStatus(j.error||'Unknown error','error');
        }catch(e){
          if(x.status===401)showStatus('Invalid pairing code. Please check and try again.','error');
          else showStatus('Server error ('+x.status+'). Please try again.','error');
        }
        btn.disabled=false;btn.innerHTML='Download APK';
      };reader.readAsText(x.response);
    }
  };
  x.onerror=function(){showStatus('Connection error.','error');btn.disabled=false;btn.innerHTML='Download APK';};
  x.send();
}
document.getElementById('code').addEventListener('keypress',function(e){if(e.key==='Enter')startDownload();});
</script>
</body>
</html>`);
});

// --- Basic Endpoints ---
// 주의: '/' 핸들러는 프론트엔드 서빙과 충돌하므로 /api/status로 변경
app.get('/api/status', (req, res) => {
  res.send('TheZonePOS Backend Server is running!');
});

app.get('/ping', (req, res) => {
  res.send('pong');
});

// 초경량 헬스 (인증 없음, 짧은 본문)
app.get('/api/health/ok', (req, res) => {
  res.status(200).type('text/plain').send('ok');
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

  // Allow empty payloads (no-op)
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.json({ ok: true, updated: 0, deleted: 0 });
  }

  const upsertStmt = db.prepare(
    'INSERT INTO menu_item_colors (item_id, color, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ' +
    'ON CONFLICT(item_id) DO UPDATE SET color=excluded.color, updated_at=CURRENT_TIMESTAMP'
  );
  const deleteStmt = db.prepare('DELETE FROM menu_item_colors WHERE item_id = ?');

  let updated = 0;
  let deleted = 0;
  let responded = false;
  const fail = (message) => {
    if (responded) return;
    responded = true;
    res.status(500).json({ error: message || 'DB update failed' });
  };
  const ok = () => {
    if (responded) return;
    responded = true;
    res.json({ ok: true, updated, deleted });
  };

  db.serialize(() => {
    try {
      for (const [rawItemId, rawColor] of entries) {
        const itemId = String(rawItemId || '').trim();
        if (!itemId) continue;

        // Treat null/empty string as "reset to default" (delete override)
        if (rawColor == null || String(rawColor).trim() === '') {
          deleteStmt.run(itemId);
          deleted += 1;
          continue;
        }

        const color = String(rawColor);
        upsertStmt.run(itemId, color);
        updated += 1;
      }

      upsertStmt.finalize((err) => {
        if (err) return fail('DB update failed');
        deleteStmt.finalize((err2) => {
          if (err2) return fail('DB update failed');
          ok();
        });
      });
    } catch (e) {
      try { upsertStmt.finalize(() => {}); } catch {}
      try { deleteStmt.finalize(() => {}); } catch {}
      fail('DB update failed');
    }
  });
});

// --- Socket.io Server Setup ---
const server = http.createServer(app);
/** @type {ReturnType<typeof setInterval> | null} */
let printerDispatchInterval = null;
/** Firestore boot listeners (menu visibility, day off, pause, prep time) — 오프라인 ping 시에는 유지(재구독 남발·무거운 메뉴 동기화 방지), 프로세스 종료 시에만 해제 */
const firebaseBootUnsubs = [];
const { registerFirebaseBootRealtimeListeners } = require('./services/firebaseBootRealtime');

function stopAllFirebaseCloudForOffline() {
  try {
    stopAllFirebaseOrderListeners();
  } catch (e) {
    console.warn('[Backend] stopAllFirebaseOrderListeners:', e.message);
  }
  try {
    require('./services/remoteSyncService').shutdown();
  } catch (e) {
    console.warn('[Backend] remoteSyncService.shutdown:', e.message);
  }
  try {
    if (devicesModule && typeof devicesModule.detachPairingFirebaseListener === 'function') {
      devicesModule.detachPairingFirebaseListener();
    }
  } catch (e) {
    console.warn('[Backend] detachPairingFirebaseListener:', e.message);
  }
  try {
    require('./services/firebasePosHeartbeatService').stop();
  } catch (e) {
    console.warn('[Backend] firebasePosHeartbeatService.stop:', e.message);
  }
  console.warn('[Backend] Firebase cloud reads/listeners stopped (offline ping)');
}
const io = new Server(server, {
  cors: {
    origin: function(origin, callback) {
      // Allow requests with no origin (native apps, curl, etc.)
      if (!origin) return callback(null, true);
      try {
        const u = new URL(origin);
        const host = u.hostname || '';
        const port = u.port || '';
        const isLocalhost = host === 'localhost' || host === '127.0.0.1';
        const isPrivateIp =
          /^10\./.test(host) ||
          /^192\.168\./.test(host) ||
          /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
        const isFirebaseOrTzo =
          /\.thezoneorder\.com$/.test(host) ||
          /\.firebaseapp\.com$/.test(host) ||
          /\.web\.app$/.test(host);
        const isSamePortAsBackend = port === String(PORT) || port === '3177';
        const isDevFrontendPort = port === '3000' || port === '3088' || port === '5173';

        if (isLocalhost || isPrivateIp || isFirebaseOrTzo || isSamePortAsBackend || isDevFrontendPort) {
          return callback(null, true);
        }

        if (process.env.NODE_ENV !== 'production') {
          return callback(null, true);
        }

        return callback(new Error('Not allowed by CORS'));
      } catch {
        // If origin cannot be parsed, allow (best-effort for LAN scenarios)
        return callback(null, true);
      }
    },
    methods: ["GET", "POST"],
    credentials: true
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
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`\n[Backend] 포트 ${PORT} 는 이미 사용 중입니다 (다른 node/backend가 떠 있을 수 있습니다).`);
    console.error('  사용 중인 PID 확인:  netstat -ano | findstr :' + PORT);
    console.error('  강제 종료 예시:     taskkill /PID <PID> /F\n');
    process.exit(1);
  }
  console.error('[Backend] 서버 소켓 오류:', err);
});

server.listen(PORT, async () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  console.log(`🔌 Socket.io ready for real-time updates`);

  try {
    const firebaseSyncQueueService = require('./services/firebaseSyncQueueService');
    firebaseSyncQueueService.init(db);
    const networkConnectivity = require('./services/networkConnectivityService');
    await networkConnectivity.runInitialProbe();
    networkConnectivity.startScheduler({
      onBecameOnline: () => {
        try {
          const firebaseSyncOrchestrator = require('./services/firebaseSyncOrchestrator');
          firebaseSyncOrchestrator.onNetworkRecovered().catch((e) =>
            console.warn('[Backend] onNetworkRecovered (Firebase sync queue):', e.message),
          );
          if (typeof devicesModule.attachPairingFirebaseListener === 'function') {
            devicesModule.attachPairingFirebaseListener().catch((e) =>
              console.warn('[Backend] attachPairingFirebaseListener:', e.message),
            );
          }
          const oo = require('./routes/online-orders');
          if (oo.restartFirebaseListenersForSseClients) oo.restartFirebaseListenersForSseClients();
          const remoteSyncService = require('./services/remoteSyncService');
          db.get('SELECT firebase_restaurant_id FROM business_profile WHERE id = 1', [], async (e2, r2) => {
            if (e2 || !r2 || !r2.firebase_restaurant_id) return;
            const rid = r2.firebase_restaurant_id;
            try {
              await remoteSyncService.initialize(rid);
            } catch (e) {
              console.warn('[Backend] remoteSyncService.initialize:', e.message);
            }
            try {
              if (oo.restartOnlineOrderListenersForRestaurant) {
                await oo.restartOnlineOrderListenersForRestaurant(rid);
              }
            } catch (e) {
              console.warn('[Backend] restartOnlineOrderListenersForRestaurant:', e.message);
            }
            if (firebaseBootUnsubs.length === 0) {
              try {
                const unsubs = registerFirebaseBootRealtimeListeners(db, rid, broadcastToRestaurant);
                unsubs.forEach((u) => firebaseBootUnsubs.push(u));
              } catch (bootErr) {
                console.warn('[Backend] registerFirebaseBootRealtimeListeners:', bootErr.message);
              }
            }
            try {
              require('./services/firebasePosHeartbeatService').start(rid);
            } catch (hbErr) {
              console.warn('[Backend] firebasePosHeartbeatService.start:', hbErr.message);
            }
          });
        } catch (e) {
          console.warn('[Backend] onBecameOnline:', e.message);
        }
      },
      onBecameOffline: () => {
        try {
          stopAllFirebaseCloudForOffline();
        } catch (e) {
          console.warn('[Backend] onBecameOffline:', e.message);
        }
      },
    });

    const firebaseSyncOrchestrator = require('./services/firebaseSyncOrchestrator');
    setInterval(() => {
      firebaseSyncOrchestrator.processPendingJobs().catch(() => {});
    }, 15 * 1000);
  } catch (netErr) {
    console.warn('[Backend] Network/queue bootstrap:', netErr.message);
  }

  // Auto-initialize Remote Sync Service and Online Order Listener if restaurantId exists in DB
  try {
    const remoteSyncService = require('./services/remoteSyncService');
    const networkConnectivity = require('./services/networkConnectivityService');

    db.get('SELECT firebase_restaurant_id FROM business_profile WHERE id = 1', [], async (err, row) => {
      if (!networkConnectivity.isInternetConnected()) {
        console.warn('[Boot] Firebase realtime services skipped: no external internet (ping)');
        return;
      }
      if (!err && row && row.firebase_restaurant_id) {
        const restaurantId = row.firebase_restaurant_id;
        console.log(`🔄 Auto-initializing services for restaurant: ${restaurantId}`);

        await remoteSyncService.initialize(restaurantId);

        // Urban Piper 자격증명을 Firebase에서 읽어 SQLite에 캐시
        try {
          const urbanPiperService = require('./services/urbanPiperService');
          await urbanPiperService.loadConfig(db);
          console.log('[Boot] Urban Piper config synced from Firebase → SQLite cache');
        } catch (upErr) {
          console.warn('[Boot] UP config sync skipped:', upErr?.message);
        }

        if (typeof restartOnlineOrderListenersForRestaurant === 'function') {
          await restartOnlineOrderListenersForRestaurant(restaurantId);
        }

        const unsubs = registerFirebaseBootRealtimeListeners(db, restaurantId, broadcastToRestaurant);
        unsubs.forEach((u) => firebaseBootUnsubs.push(u));
        try {
          require('./services/firebasePosHeartbeatService').start(restaurantId);
        } catch (hbErr) {
          console.warn('[Boot] firebasePosHeartbeatService.start:', hbErr.message);
        }
      }
    });
  } catch (syncErr) {
    console.warn('⚠️ Failed to auto-initialize services:', syncErr.message);
  }

  // Background printer dispatcher (simple interval)
  try {
    const DISABLE_PRINTER_DISPATCHER = String(process.env.DISABLE_PRINTER_DISPATCHER || '').trim() === '1';
    const DISPATCH_TIMEOUT_MS = 4000;
    let dispatchInFlight = false;

    const dispatchOnce = async () => {
      if (DISABLE_PRINTER_DISPATCHER) return;
      if (dispatchInFlight) return;
      dispatchInFlight = true;
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS);
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/api/printers/jobs/dispatch`, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) throw new Error('dispatch failed');
      } catch {
        // Intentionally ignore: dispatcher is best-effort and must never block the server.
      } finally {
        clearTimeout(t);
        dispatchInFlight = false;
      }
    };

    // Fire once shortly after boot, then on interval.
    setTimeout(() => { dispatchOnce(); }, 1000);
    printerDispatchInterval = setInterval(() => { dispatchOnce(); }, 5000);
  } catch {}

  // Pre Order Reprint — 픽업 30분 전 키친 자동 출력 스케줄
  try {
    const preorderReprintService = require('./services/preorderReprintService');
    const preorderTick = () => {
      preorderReprintService.tick({ dbRun, dbGet, dbAll, port: PORT }).catch(() => {});
    };
    setTimeout(preorderTick, 12000);
    setInterval(preorderTick, 45000);
  } catch (preErr) {
    console.warn('[Backend] PreOrder reprint scheduler:', preErr && preErr.message);
  }
});

let shuttingDown = false;
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[Backend] ${signal} received, shutting down...`);
  try {
    stopAllFirebaseOrderListeners();
  } catch (e) {
    console.warn('[Backend] stopAllFirebaseOrderListeners:', (e && e.message) || e);
  }
  try {
    firebaseBootUnsubs.splice(0).forEach((fn) => {
      try {
        if (typeof fn === 'function') fn();
      } catch (_) { /* ignore */ }
    });
  } catch (_) { /* ignore */ }
  try {
    if (devicesModule && typeof devicesModule.detachPairingFirebaseListener === 'function') {
      devicesModule.detachPairingFirebaseListener();
    }
  } catch (_) { /* ignore */ }
  try {
    require('./services/remoteSyncService').shutdown();
  } catch (_) { /* ignore */ }
  try {
    require('./services/firebasePosHeartbeatService').stop();
  } catch (_) { /* ignore */ }
  try {
    require('./services/networkConnectivityService').stopScheduler();
  } catch (_) { /* ignore */ }
  if (printerDispatchInterval) {
    try {
      clearInterval(printerDispatchInterval);
    } catch (_) { /* ignore */ }
    printerDispatchInterval = null;
  }
  const forceExit = setTimeout(() => {
    console.warn('[Backend] Forcing process exit (shutdown timeout)');
    process.exit(0);
  }, 4000);

  server.close((err) => {
    if (err) console.warn('[Backend] server.close:', err.message);
    try {
      io.close(() => {
        try {
          db.close((dbErr) => {
            if (dbErr) console.warn('[Backend] db.close:', dbErr.message);
            clearTimeout(forceExit);
            process.exit(0);
          });
        } catch (dbCloseErr) {
          console.warn('[Backend] db.close sync error:', dbCloseErr && dbCloseErr.message);
          clearTimeout(forceExit);
          process.exit(0);
        }
      });
    } catch (ioErr) {
      console.warn('[Backend] io.close:', ioErr && ioErr.message);
      clearTimeout(forceExit);
      process.exit(0);
    }
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

startServer();