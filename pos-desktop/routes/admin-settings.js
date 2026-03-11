const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// 공유 데이터베이스 모듈 사용 (환경 변수 DB_PATH 지원 - Electron 앱 호환)
const { db, dbRun, dbAll, dbGet } = require('../db');

// Simple role guard (expects X-Role header: ADMIN or MANAGER)
function requireManager(req, res, next) {
  try {
    const role = String(req.headers['x-role'] || '').toUpperCase();
    if (role === 'ADMIN' || role === 'MANAGER') return next();
  } catch {}
  return res.status(403).json({ error: 'Forbidden: Manager or Admin required' });
}

// Initialize channel settings table for per-channel defaults (e.g., TOGO)
async function initChannelSettings() {
  try {
    await dbRun(`CREATE TABLE IF NOT EXISTS channel_settings (
      channel TEXT PRIMARY KEY,
      discount_enabled INTEGER DEFAULT 0,
      discount_mode TEXT DEFAULT 'percent',
      discount_value REAL DEFAULT 0,
      bag_fee_enabled INTEGER DEFAULT 0,
      bag_fee_mode TEXT DEFAULT 'amount',
      bag_fee_value REAL DEFAULT 0,
      discount_stage TEXT DEFAULT 'pre-tax',
      bag_fee_taxable INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    const cols = await dbAll("PRAGMA table_info(channel_settings)");
    const names = cols.map(c => String(c.name));
    if (!names.includes('discount_scope')) {
      await dbRun("ALTER TABLE channel_settings ADD COLUMN discount_scope TEXT DEFAULT 'all'");
    }
    if (!names.includes('discount_item_ids')) {
      await dbRun("ALTER TABLE channel_settings ADD COLUMN discount_item_ids TEXT");
    }
    if (!names.includes('discount_category_ids')) {
      await dbRun("ALTER TABLE channel_settings ADD COLUMN discount_category_ids TEXT");
    }
  } catch (e) {
    // ignore if duplicate column errors occur
    try { console.warn('initChannelSettings warning:', e && e.message ? e.message : e); } catch {}
  }
}

initChannelSettings();

// Initialize business profile table
async function initBusinessProfile() {
  try {
    await dbRun(`CREATE TABLE IF NOT EXISTS business_profile (
      id INTEGER PRIMARY KEY CHECK(id=1),
      business_name TEXT,
      tax_number TEXT,
      phone TEXT,
      email TEXT,
      address_line1 TEXT,
      address_line2 TEXT,
      city TEXT,
      state TEXT,
      zip TEXT,
      country TEXT,
      logo_url TEXT,
      banner_url TEXT,
      firebase_restaurant_id TEXT,
      service_type TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    // Ensure singleton row exists
    const row = await dbGet('SELECT id FROM business_profile WHERE id = 1');
    if (!row) {
      await dbRun('INSERT INTO business_profile (id, business_name) VALUES (1, "")');
    }
    // Add missing columns if not exists
    const cols = await dbAll("PRAGMA table_info(business_profile)");
    const colNames = cols.map(c => String(c.name));
    if (!colNames.includes('firebase_restaurant_id')) {
      await dbRun("ALTER TABLE business_profile ADD COLUMN firebase_restaurant_id TEXT");
    }
    // Add service_type column if not exists (QSR or FSR)
    if (!colNames.includes('service_type')) {
      await dbRun("ALTER TABLE business_profile ADD COLUMN service_type TEXT");
    }
    // Add email column if not exists
    if (!colNames.includes('email')) {
      await dbRun("ALTER TABLE business_profile ADD COLUMN email TEXT");
    }
    // Add banner_url column if not exists
    if (!colNames.includes('banner_url')) {
      await dbRun("ALTER TABLE business_profile ADD COLUMN banner_url TEXT");
    }
    // Add country column if not exists
    if (!colNames.includes('country')) {
      await dbRun("ALTER TABLE business_profile ADD COLUMN country TEXT");
    }
  } catch (e) {
    try { console.warn('initBusinessProfile warning:', e && e.message ? e.message : e); } catch {}
  }
}

initBusinessProfile();

// Initialize business_hours table
async function initBusinessHours() {
  try {
    await dbRun(`CREATE TABLE IF NOT EXISTS business_hours (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_of_week INTEGER NOT NULL,
      open_time TEXT NOT NULL,
      close_time TEXT NOT NULL,
      is_open INTEGER DEFAULT 1,
      break_start TEXT,
      break_end TEXT,
      happy_hour_start TEXT,
      happy_hour_end TEXT,
      busy_hour_start TEXT,
      busy_hour_end TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  } catch (e) {
    try { console.warn('initBusinessHours warning:', e && e.message ? e.message : e); } catch {}
  }
}

initBusinessHours();

// Initialize system_pins table for BackOffice access
async function initSystemPins() {
  try {
    await dbRun(`CREATE TABLE IF NOT EXISTS system_pins (
      id INTEGER PRIMARY KEY CHECK(id=1),
      backoffice_pin TEXT DEFAULT '0000',
      sales_pin TEXT DEFAULT '0000',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    // Ensure singleton row exists with default pins = 0000
    const row = await dbGet('SELECT id FROM system_pins WHERE id = 1');
    if (!row) {
      await dbRun("INSERT INTO system_pins (id, backoffice_pin, sales_pin) VALUES (1, '0000', '0000')");
    }
  } catch (e) {
    try { console.warn('initSystemPins warning:', e && e.message ? e.message : e); } catch {}
  }
}

initSystemPins();

// ===== BACKOFFICE PIN MANAGEMENT =====

// Verify BackOffice PIN
router.post('/verify-backoffice-pin', async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin) {
      return res.status(400).json({ success: false, error: 'PIN is required' });
    }
    
    const row = await dbGet('SELECT backoffice_pin FROM system_pins WHERE id = 1');
    const correctPin = row?.backoffice_pin || '0000';
    
    if (String(pin) === String(correctPin)) {
      res.json({ success: true, message: 'BackOffice PIN verified' });
    } else {
      res.status(401).json({ success: false, error: 'Invalid PIN' });
    }
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Verify Sales PIN (0000 allowed for sales, but NOT for backoffice)
router.post('/verify-sales-pin', async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin) {
      return res.status(400).json({ success: false, error: 'PIN is required' });
    }
    
    const row = await dbGet('SELECT sales_pin FROM system_pins WHERE id = 1');
    const correctPin = row?.sales_pin || '0000';
    
    if (String(pin) === String(correctPin)) {
      res.json({ success: true, message: 'Sales PIN verified' });
    } else {
      res.status(401).json({ success: false, error: 'Invalid PIN' });
    }
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Get system PINs (Manager only)
router.get('/system-pins', requireManager, async (req, res) => {
  try {
    const row = await dbGet('SELECT backoffice_pin, sales_pin, updated_at FROM system_pins WHERE id = 1');
    res.json(row || { backoffice_pin: '0000', sales_pin: '0000' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update system PINs (Manager only)
router.put('/system-pins', requireManager, async (req, res) => {
  try {
    const { backoffice_pin, sales_pin } = req.body;
    
    // Validate PIN format (4 digits)
    if (backoffice_pin && !/^\d{4}$/.test(backoffice_pin)) {
      return res.status(400).json({ error: 'BackOffice PIN must be 4 digits' });
    }
    if (sales_pin && !/^\d{4}$/.test(sales_pin)) {
      return res.status(400).json({ error: 'Sales PIN must be 4 digits' });
    }
    
    await dbRun(`INSERT INTO system_pins (id, backoffice_pin, sales_pin, updated_at)
      VALUES (1, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        backoffice_pin = COALESCE(excluded.backoffice_pin, backoffice_pin),
        sales_pin = COALESCE(excluded.sales_pin, sales_pin),
        updated_at = CURRENT_TIMESTAMP
    `, [backoffice_pin || null, sales_pin || null]);
    
    const saved = await dbGet('SELECT * FROM system_pins WHERE id = 1');
    res.json({ success: true, pins: saved });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== DATABASE RESET (Complete Factory Reset) =====
// WARNING: This will delete ALL data and reset to factory state
router.post('/factory-reset', requireManager, async (req, res) => {
  console.log('⚠️ [FACTORY RESET] Initiating complete database reset...');
  
  try {
    // Tables to clear (order matters for foreign key constraints)
    const tablesToClear = [
      // Order related
      'order_items',
      'order_adjustments',
      'payments',
      'voids',
      'refunds',
      'orders',
      
      // Menu related links
      'menu_modifier_links',
      'menu_tax_links',
      'menu_printer_links',
      'category_modifier_links',
      'category_tax_links',
      'category_printer_links',
      'modifier_group_links',
      'tax_group_links',
      'printer_group_links',
      
      // Menu items
      'menu_items',
      'menu_categories',
      'base_menus',
      'derived_menus',
      'derived_menu_categories',
      'derived_menu_items',
      'derived_menu_modifier_overrides',
      
      // Modifiers, Taxes, Printers
      'modifiers',
      'modifier_groups',
      'taxes',
      'tax_groups',
      'printers',
      'printer_groups',
      
      // Table map
      'table_map_elements',
      'table_devices',
      'table_settings',
      
      // Reservations
      'reservations',
      'reservation_time_slots',
      'reservation_settings',
      
      // Employees
      'employees',
      'employee_shifts',
      'time_off_requests',
      'shift_swaps',
      'work_schedule',
      
      // Settings
      'channel_settings',
      'business_hours',
      'layout_settings',
      'screen_settings',
      
      // Daily operations
      'daily_closings',
      'gift_cards',
      'gift_card_transactions',
      
      // Firebase sync
      'firebase_sync_log',
      'menu_visibility',
      'sold_out_items',
      
      // Other
      'waiting_list',
      'call_server_requests',
      'table_move_history',
      'promotions',
      'labels',
      'open_price_settings',
    ];
    
    // Clear all tables
    for (const table of tablesToClear) {
      try {
        await dbRun(`DELETE FROM ${table}`);
        console.log(`✓ Cleared table: ${table}`);
      } catch (e) {
        // Table might not exist, skip silently
        console.log(`- Skipped table (may not exist): ${table}`);
      }
    }
    
    // Reset business_profile to empty state (keep structure)
    await dbRun(`UPDATE business_profile SET
      business_name = NULL,
      tax_number = NULL,
      phone = NULL,
      address_line1 = NULL,
      address_line2 = NULL,
      city = NULL,
      state = NULL,
      zip = NULL,
      logo_url = NULL,
      firebase_restaurant_id = NULL,
      service_type = NULL,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = 1`);
    
    console.log('✅ [FACTORY RESET] Complete! Database reset to factory state.');
    
    res.json({ 
      success: true, 
      message: 'Factory reset complete. All data has been cleared.',
      tablesCleared: tablesToClear.length
    });
  } catch (e) {
    console.error('❌ [FACTORY RESET] Failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// Multer for logo uploads (환경 변수 UPLOADS_PATH 사용, 빌드된 앱 호환)
const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      const uploadsBase = process.env.UPLOADS_PATH || path.resolve(__dirname, '..', 'uploads');
      const dir = path.join(uploadsBase, 'logos');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    } catch (e) {
      cb(e, undefined);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '.png';
    const ts = Date.now();
    cb(null, `business_logo_${ts}${ext}`);
  }
});
const logoUpload = multer({ storage: logoStorage });

// ===== BUSINESS PROFILE =====
// Get business profile
router.get('/business-profile', async (req, res) => {
  try {
    const row = await dbGet('SELECT * FROM business_profile WHERE id = 1');
    res.json(row || null);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update business profile
router.put('/business-profile', requireManager, async (req, res) => {
  try {
    const p = req.body || {};
    await dbRun(`INSERT INTO business_profile (
      id, business_name, tax_number, phone, email, address_line1, address_line2, city, state, zip, country, logo_url, banner_url, firebase_restaurant_id, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      business_name = COALESCE(excluded.business_name, business_name),
      tax_number = COALESCE(excluded.tax_number, tax_number),
      phone = COALESCE(excluded.phone, phone),
      email = COALESCE(excluded.email, email),
      address_line1 = COALESCE(excluded.address_line1, address_line1),
      address_line2 = COALESCE(excluded.address_line2, address_line2),
      city = COALESCE(excluded.city, city),
      state = COALESCE(excluded.state, state),
      zip = COALESCE(excluded.zip, zip),
      country = COALESCE(excluded.country, country),
      logo_url = COALESCE(excluded.logo_url, logo_url),
      banner_url = COALESCE(excluded.banner_url, banner_url),
      firebase_restaurant_id = COALESCE(excluded.firebase_restaurant_id, firebase_restaurant_id),
      updated_at = CURRENT_TIMESTAMP
    `, [
      p.business_name !== undefined ? String(p.business_name) : null,
      p.tax_number !== undefined ? String(p.tax_number) : null,
      p.phone !== undefined ? String(p.phone) : null,
      p.email !== undefined ? String(p.email) : null,
      p.address_line1 !== undefined ? String(p.address_line1) : null,
      p.address_line2 !== undefined ? String(p.address_line2) : null,
      p.city !== undefined ? String(p.city) : null,
      p.state !== undefined ? String(p.state) : null,
      p.zip !== undefined ? String(p.zip) : null,
      p.country !== undefined ? String(p.country) : null,
      p.logo_url !== undefined ? String(p.logo_url) : null,
      p.banner_url !== undefined ? String(p.banner_url) : null,
      p.firebase_restaurant_id ? String(p.firebase_restaurant_id) : null,
    ]);
    const saved = await dbGet('SELECT * FROM business_profile WHERE id = 1');
    res.json({ success: true, profile: saved });
  } catch (e) {
    console.error('Error updating business profile:', e);
    res.status(500).json({ error: e.message });
  }
});

// Upload logo
router.post('/business-profile/logo', requireManager, logoUpload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const imageUrl = `/uploads/logos/${req.file.filename}`;
    await dbRun(`INSERT INTO business_profile (id, logo_url)
      VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET logo_url = excluded.logo_url, updated_at = CURRENT_TIMESTAMP
    `, [imageUrl]);
    const saved = await dbGet('SELECT * FROM business_profile WHERE id = 1');
    res.json({ success: true, imageUrl, profile: saved });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== SYNC BUSINESS INFO FROM FIREBASE =====
router.post('/business-profile/sync-from-firebase', async (req, res) => {
  console.log('📥 [SYNC] Business Info sync request received from TZO Admin');
  console.log('📥 [SYNC] Request body:', JSON.stringify(req.body, null, 2));
  
  try {
    // Check if businessInfo is directly provided from TZO Admin
    const { businessInfo, restaurantId: reqRestaurantId } = req.body;
    
    let updateData;
    let restaurantId = reqRestaurantId;
    
    if (businessInfo) {
      // Use directly provided data from TZO Admin
      console.log('📥 Business Info received from TZO Admin:', JSON.stringify(businessInfo, null, 2));
      
      updateData = {
        business_name: businessInfo.name || '',
        phone: businessInfo.phone || '',
        email: businessInfo.email || '',
        address_line1: businessInfo.address || '',
        city: businessInfo.city || '',
        state: businessInfo.state || '',
        zip: businessInfo.zipCode || '',
        logo_url: businessInfo.logoUrl || '',
        banner_url: businessInfo.bannerImageUrl || '',
        firebase_restaurant_id: restaurantId || ''
      };
    } else {
      // Fallback: Fetch from Firebase directly
      if (!restaurantId) {
        const profile = await dbGet('SELECT firebase_restaurant_id FROM business_profile WHERE id = 1');
        restaurantId = profile?.firebase_restaurant_id;
      }
      
      if (!restaurantId) {
        return res.status(400).json({ error: 'Restaurant ID is required. Set it in the Sync tab first.' });
      }
      
      // Get Firestore instance
      const firebaseService = require('../services/firebaseService');
      const firestore = firebaseService.getFirestore();
      
      if (!firestore) {
        return res.status(500).json({ error: 'Firebase not initialized' });
      }
      
      // Fetch restaurant data from Firebase
      const restaurantDoc = await firestore.collection('restaurants').doc(restaurantId).get();
      
      if (!restaurantDoc.exists) {
        return res.status(404).json({ error: 'Restaurant not found in Firebase' });
      }
      
      const fbData = restaurantDoc.data();
      console.log('📥 Firebase Business Info:', JSON.stringify(fbData, null, 2));
      
      updateData = {
        business_name: fbData.name || fbData.businessName || '',
        phone: fbData.phone || '',
        email: fbData.email || '',
        address_line1: fbData.address || '',
        city: fbData.city || '',
        state: fbData.state || '',
        zip: fbData.zipCode || fbData.zip || '',
        logo_url: fbData.logoUrl || fbData.logo_url || '',
        banner_url: fbData.bannerImageUrl || fbData.banner_url || '',
        firebase_restaurant_id: restaurantId
      };
    }
    
    // Update POS database
    await dbRun(`UPDATE business_profile SET
      business_name = ?,
      phone = ?,
      email = ?,
      address_line1 = ?,
      city = ?,
      state = ?,
      zip = ?,
      logo_url = ?,
      banner_url = ?,
      firebase_restaurant_id = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = 1`, [
      updateData.business_name,
      updateData.phone,
      updateData.email,
      updateData.address_line1,
      updateData.city,
      updateData.state,
      updateData.zip,
      updateData.logo_url,
      updateData.banner_url,
      updateData.firebase_restaurant_id
    ]);
    
    const saved = await dbGet('SELECT * FROM business_profile WHERE id = 1');
    
    // Handle Business Hours if provided
    const { businessHours } = req.body;
    let hoursUpdated = 0;
    
    if (businessHours && Array.isArray(businessHours)) {
      console.log('📅 Syncing Business Hours:', businessHours.length, 'days');
      
      // Ensure business_hours table has all required columns
      try {
        const cols = await dbAll("PRAGMA table_info(business_hours)");
        const colNames = cols.map(c => String(c.name));
        
        if (!colNames.includes('break_start')) {
          await dbRun("ALTER TABLE business_hours ADD COLUMN break_start TEXT");
        }
        if (!colNames.includes('break_end')) {
          await dbRun("ALTER TABLE business_hours ADD COLUMN break_end TEXT");
        }
        if (!colNames.includes('happy_hour_start')) {
          await dbRun("ALTER TABLE business_hours ADD COLUMN happy_hour_start TEXT");
        }
        if (!colNames.includes('happy_hour_end')) {
          await dbRun("ALTER TABLE business_hours ADD COLUMN happy_hour_end TEXT");
        }
        if (!colNames.includes('busy_hour_start')) {
          await dbRun("ALTER TABLE business_hours ADD COLUMN busy_hour_start TEXT");
        }
        if (!colNames.includes('busy_hour_end')) {
          await dbRun("ALTER TABLE business_hours ADD COLUMN busy_hour_end TEXT");
        }
      } catch (colErr) {
        console.warn('Column add warning:', colErr.message);
      }
      
      // Delete existing hours first to prevent duplicates
      await dbRun('DELETE FROM business_hours');
      
      for (const hour of businessHours) {
        await dbRun(`
          INSERT INTO business_hours 
          (day_of_week, open_time, close_time, is_open, break_start, break_end, 
           happy_hour_start, happy_hour_end, busy_hour_start, busy_hour_end, updated_at) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [
          hour.day_of_week,
          hour.open_time,
          hour.close_time,
          hour.is_open,
          hour.break_start || null,
          hour.break_end || null,
          hour.happy_hour_start || null,
          hour.happy_hour_end || null,
          hour.busy_hour_start || null,
          hour.busy_hour_end || null
        ]);
        hoursUpdated++;
      }
      console.log('✅ Business Hours synced:', hoursUpdated, 'days');
    }
    
    console.log('✅ Business Info synced from Firebase');
    res.json({ 
      success: true, 
      message: `Business Info synced. ${hoursUpdated > 0 ? `Business Hours: ${hoursUpdated} days updated.` : ''}`,
      profile: saved,
      hoursUpdated
    });
  } catch (e) {
    console.error('❌ Sync Business Info failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// ===== SERVICE TYPE (QSR/FSR) =====
// Check if initial setup is needed (service_type not set)
router.get('/initial-setup-status', async (req, res) => {
  try {
    const row = await dbGet('SELECT service_type, business_name, firebase_restaurant_id FROM business_profile WHERE id = 1');
    const needsSetup = !row || !row.service_type || !row.firebase_restaurant_id;
    res.json({ 
      needsSetup, 
      serviceType: row?.service_type || null,
      businessName: row?.business_name || null,
      restaurantId: row?.firebase_restaurant_id || null
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get service type
router.get('/service-type', async (req, res) => {
  try {
    const row = await dbGet('SELECT service_type FROM business_profile WHERE id = 1');
    res.json({ serviceType: row?.service_type || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Set service type (QSR or FSR) - Initial setup
router.post('/service-type', async (req, res) => {
  try {
    const { serviceType, businessName, restaurantId } = req.body;
    
    // Validate service type
    if (!serviceType || !['QSR', 'FSR'].includes(serviceType.toUpperCase())) {
      return res.status(400).json({ error: 'Invalid service type. Must be QSR or FSR.' });
    }
    
    // Validate restaurant ID
    if (!restaurantId || String(restaurantId).trim() === '') {
      return res.status(400).json({ error: 'Restaurant ID is required.' });
    }
    
    const type = serviceType.toUpperCase();
    const name = businessName ? String(businessName).trim() : '';
    const restId = String(restaurantId).trim();
    
    await dbRun(`INSERT INTO business_profile (id, service_type, business_name, firebase_restaurant_id, updated_at)
      VALUES (1, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET 
        service_type = excluded.service_type,
        business_name = CASE WHEN excluded.business_name != '' THEN excluded.business_name ELSE business_name END,
        firebase_restaurant_id = excluded.firebase_restaurant_id,
        updated_at = CURRENT_TIMESTAMP
    `, [type, name, restId]);
    
    const saved = await dbGet('SELECT * FROM business_profile WHERE id = 1');
    res.json({ success: true, serviceType: type, restaurantId: restId, profile: saved });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Load channel settings
router.get('/channel-settings/:channel', async (req, res) => {
  try {
    const ch = String(req.params.channel || '').toUpperCase();
    const row = await dbGet('SELECT * FROM channel_settings WHERE channel = ?', [ch]);
    res.json({ channel: ch, settings: row || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Save channel settings (Manager+)
router.post('/channel-settings/:channel', requireManager, async (req, res) => {
  try {
    const ch = String(req.params.channel || '').toUpperCase();
    const s = req.body && req.body.settings ? req.body.settings : {};
    await dbRun(`INSERT INTO channel_settings(
      channel, discount_enabled, discount_mode, discount_value,
      bag_fee_enabled, bag_fee_mode, bag_fee_value, discount_stage, bag_fee_taxable,
      discount_scope, discount_item_ids, discount_category_ids, updated_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(channel) DO UPDATE SET
      discount_enabled=excluded.discount_enabled,
      discount_mode=excluded.discount_mode,
      discount_value=excluded.discount_value,
      bag_fee_enabled=excluded.bag_fee_enabled,
      bag_fee_mode=excluded.bag_fee_mode,
      bag_fee_value=excluded.bag_fee_value,
      discount_stage=excluded.discount_stage,
      bag_fee_taxable=excluded.bag_fee_taxable,
      discount_scope=excluded.discount_scope,
      discount_item_ids=excluded.discount_item_ids,
      discount_category_ids=excluded.discount_category_ids,
      updated_at=CURRENT_TIMESTAMP`, [
      ch,
      s.discount_enabled ? 1 : 0,
      String(s.discount_mode || 'percent'),
      Number(s.discount_value || 0),
      s.bag_fee_enabled ? 1 : 0,
      String(s.bag_fee_mode || 'amount'),
      Number(s.bag_fee_value || 0),
      String(s.discount_stage || 'pre-tax'),
      s.bag_fee_taxable ? 1 : 0,
      String(s.discount_scope || 'all'),
      Array.isArray(s.discount_item_ids) ? String(s.discount_item_ids.join(',')) : String(s.discount_item_ids || ''),
      Array.isArray(s.discount_category_ids) ? String(s.discount_category_ids.join(',')) : String(s.discount_category_ids || '')
    ]);
    const saved = await dbGet('SELECT * FROM channel_settings WHERE channel = ?', [ch]);
    res.json({ success: true, settings: saved });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Initialize reservation settings table
const initializeReservationSettingsTable = async () => {
  try {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS reservation_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        minimum_guests INTEGER DEFAULT 1,
        maximum_guests INTEGER DEFAULT 10,
        minimum_time_in_advance INTEGER DEFAULT 1,
        maximum_time_in_advance INTEGER DEFAULT 30,
        hold_table_for_late_guests INTEGER DEFAULT 15,
        max_reservation_table INTEGER DEFAULT 10,
        reservation_interval INTEGER DEFAULT 30,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Reservation settings table initialized');
  } catch (error) {
    console.error('Error initializing reservation settings table:', error);
  }
};

// Initialize table when module loads
initializeReservationSettingsTable();

// Add new columns to existing table if they don't exist
const addNewColumnsToReservationSettings = async () => {
  try {
    // Check if max_reservation_table column exists
    const columns = await dbAll("PRAGMA table_info(reservation_settings)");
    const columnNames = columns.map(col => col.name);
    
    if (!columnNames.includes('max_reservation_table')) {
      await dbRun('ALTER TABLE reservation_settings ADD COLUMN max_reservation_table INTEGER DEFAULT 10');
      console.log('Added max_reservation_table column');
    }
    
    if (!columnNames.includes('reservation_interval')) {
      await dbRun('ALTER TABLE reservation_settings ADD COLUMN reservation_interval INTEGER DEFAULT 30');
      console.log('Added reservation_interval column');
    }
  } catch (error) {
    console.error('Error adding new columns to reservation_settings:', error);
  }
};

// Run migration
addNewColumnsToReservationSettings();

// ===== ADMIN DASHBOARD =====

// Get admin dashboard data
router.get('/dashboard', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const dashboardData = {
      today: {
        total: await dbGet('SELECT COUNT(*) as count FROM reservations WHERE reservation_date = ?', [today]),
        confirmed: await dbGet('SELECT COUNT(*) as count FROM reservations WHERE reservation_date = ? AND status = "confirmed"', [today]),
        pending: await dbGet('SELECT COUNT(*) as count FROM reservations WHERE reservation_date = ? AND status = "pending"', [today]),
        completed: await dbGet('SELECT COUNT(*) as count FROM reservations WHERE reservation_date = ? AND status = "completed"', [today])
      },
      tomorrow: {
        total: await dbGet('SELECT COUNT(*) as count FROM reservations WHERE reservation_date = ?', [tomorrow]),
        confirmed: await dbGet('SELECT COUNT(*) as count FROM reservations WHERE reservation_date = ? AND status = "confirmed"', [tomorrow]),
        pending: await dbGet('SELECT COUNT(*) as count FROM reservations WHERE reservation_date = ? AND status = "pending"', [tomorrow])
      },
      system: {
        totalTables: await dbGet('SELECT COUNT(*) as count FROM table_settings'),
        reservableTables: await dbGet('SELECT COUNT(*) as count FROM table_settings WHERE is_reservable = 1'),
        totalTimeSlots: await dbGet('SELECT COUNT(*) as count FROM reservation_time_slots'),
        availableTimeSlots: await dbGet('SELECT COUNT(*) as count FROM reservation_time_slots WHERE is_available = 1')
      },
      recentReservations: await dbAll(`
        SELECT * FROM reservations 
        ORDER BY created_at DESC 
        LIMIT 10
      `)
    };
    
    res.json(dashboardData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== BUSINESS HOURS MANAGEMENT =====

// Get business hours with day names
router.get('/business-hours', async (req, res) => {
  try {
    const hours = await dbAll('SELECT * FROM business_hours ORDER BY day_of_week');
    
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const formattedHours = hours.map(hour => ({
      ...hour,
      day_name: dayNames[hour.day_of_week]
    }));
    
    res.json(formattedHours);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update business hours
router.put('/business-hours', async (req, res) => {
  try {
    const { businessHours } = req.body;
    
    for (const hour of businessHours) {
      await dbRun(`
        INSERT OR REPLACE INTO business_hours 
        (day_of_week, open_time, close_time, is_open, updated_at) 
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [hour.day_of_week, hour.open_time, hour.close_time, hour.is_open]);
    }
    
    res.json({ message: 'Business hours updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== TABLE MANAGEMENT =====

// Get all tables with statistics
router.get('/tables', async (req, res) => {
  try {
    const tables = await dbAll(`
      SELECT ts.*, 
             COUNT(r.id) as total_reservations,
             COUNT(CASE WHEN r.status = 'confirmed' THEN 1 END) as confirmed_reservations,
             COUNT(CASE WHEN r.status = 'pending' THEN 1 END) as pending_reservations
      FROM table_settings ts
      LEFT JOIN reservations r ON ts.table_number = r.table_number
      GROUP BY ts.id
      ORDER BY ts.table_number
    `);
    
    res.json(tables);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new table
router.post('/tables', async (req, res) => {
  try {
    const { table_number, table_name, is_reservable, min_capacity, max_capacity } = req.body;
    
    // Check if table number already exists
    const existingTable = await dbGet('SELECT * FROM table_settings WHERE table_number = ?', [table_number]);
    if (existingTable) {
      return res.status(400).json({ error: 'Table number already exists' });
    }
    
    const result = await dbRun(`
      INSERT INTO table_settings 
      (table_number, table_name, is_reservable, min_capacity, max_capacity) 
      VALUES (?, ?, ?, ?, ?)
    `, [table_number, table_name, is_reservable, min_capacity, max_capacity]);
    
    const newTable = await dbGet('SELECT * FROM table_settings WHERE id = ?', [result.lastID]);
    
    res.status(201).json({
      message: 'Table created successfully',
      table: newTable
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update table
router.put('/tables/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { table_number, table_name, is_reservable, min_capacity, max_capacity } = req.body;
    
    // Check if table number already exists (excluding current table)
    const existingTable = await dbGet('SELECT * FROM table_settings WHERE table_number = ? AND id != ?', [table_number, id]);
    if (existingTable) {
      return res.status(400).json({ error: 'Table number already exists' });
    }
    
    await dbRun(`
      UPDATE table_settings 
      SET table_number = ?, table_name = ?, is_reservable = ?, 
          min_capacity = ?, max_capacity = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [table_number, table_name, is_reservable, min_capacity, max_capacity, id]);
    
    res.json({ message: 'Table updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete table
router.delete('/tables/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if table has active reservations
    const table = await dbGet('SELECT table_number FROM table_settings WHERE id = ?', [id]);
    if (table) {
      const activeReservations = await dbGet(`
        SELECT COUNT(*) as count FROM reservations 
        WHERE table_number = ? AND status IN ('pending', 'confirmed')
      `, [table.table_number]);
      
      if (activeReservations.count > 0) {
        return res.status(400).json({ 
          error: 'Cannot delete table with active reservations' 
        });
      }
    }
    
    await dbRun('DELETE FROM table_settings WHERE id = ?', [id]);
    res.json({ message: 'Table deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== TIME SLOTS MANAGEMENT =====

// Get all time slots with statistics
router.get('/time-slots', async (req, res) => {
  try {
    const timeSlots = await dbAll(`
      SELECT ts.*, 
             COUNT(r.id) as total_reservations,
             COUNT(CASE WHEN r.status = 'confirmed' THEN 1 END) as confirmed_reservations,
             COUNT(CASE WHEN r.status = 'pending' THEN 1 END) as pending_reservations
      FROM reservation_time_slots ts
      LEFT JOIN reservations r ON ts.time_slot = r.reservation_time
      GROUP BY ts.id
      ORDER BY ts.time_slot
    `);
    
    res.json(timeSlots);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new time slot
router.post('/time-slots', async (req, res) => {
  try {
    const { time_slot, is_available, max_reservations } = req.body;
    
    // Check if time slot already exists
    const existingSlot = await dbGet('SELECT * FROM reservation_time_slots WHERE time_slot = ?', [time_slot]);
    if (existingSlot) {
      return res.status(400).json({ error: 'Time slot already exists' });
    }
    
    const result = await dbRun(`
      INSERT INTO reservation_time_slots 
      (time_slot, is_available, max_reservations) 
      VALUES (?, ?, ?)
    `, [time_slot, is_available, max_reservations]);
    
    const newTimeSlot = await dbGet('SELECT * FROM reservation_time_slots WHERE id = ?', [result.lastID]);
    
    res.status(201).json({
      message: 'Time slot created successfully',
      timeSlot: newTimeSlot
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update time slot
router.put('/time-slots/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { time_slot, is_available, max_reservations } = req.body;
    
    // Check if time slot already exists (excluding current slot)
    const existingSlot = await dbGet('SELECT * FROM reservation_time_slots WHERE time_slot = ? AND id != ?', [time_slot, id]);
    if (existingSlot) {
      return res.status(400).json({ error: 'Time slot already exists' });
    }
    
    await dbRun(`
      UPDATE reservation_time_slots 
      SET time_slot = ?, is_available = ?, max_reservations = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [time_slot, is_available, max_reservations, id]);
    
    res.json({ message: 'Time slot updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete time slot
router.delete('/time-slots/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if time slot has active reservations
    const timeSlot = await dbGet('SELECT time_slot FROM reservation_time_slots WHERE id = ?', [id]);
    if (timeSlot) {
      const activeReservations = await dbGet(`
        SELECT COUNT(*) as count FROM reservations 
        WHERE reservation_time = ? AND status IN ('pending', 'confirmed')
      `, [timeSlot.time_slot]);
      
      if (activeReservations.count > 0) {
        return res.status(400).json({ 
          error: 'Cannot delete time slot with active reservations' 
        });
      }
    }
    
    await dbRun('DELETE FROM reservation_time_slots WHERE id = ?', [id]);
    res.json({ message: 'Time slot deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== RESERVATION SETTINGS =====

// Get reservation settings
router.get('/reservation-settings', async (req, res) => {
  try {
    const settings = await dbGet('SELECT * FROM reservation_settings ORDER BY id DESC LIMIT 1');
    res.json({ reservation_settings: settings || null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save reservation settings
router.post('/reservation-settings', async (req, res) => {
  try {
    const { reservation_settings } = req.body;
    
    await dbRun(`
      INSERT OR REPLACE INTO reservation_settings 
      (minimum_guests, maximum_guests, minimum_time_in_advance, maximum_time_in_advance, hold_table_for_late_guests, max_reservation_table, reservation_interval, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      reservation_settings.minimum_guests,
      reservation_settings.maximum_guests,
      reservation_settings.minimum_time_in_advance,
      reservation_settings.maximum_time_in_advance,
      reservation_settings.hold_table_for_late_guests,
      reservation_settings.max_reservation_table,
      reservation_settings.reservation_interval
    ]);
    
    res.json({ message: 'Reservation settings saved successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== SYSTEM SETTINGS =====

// Get system settings
router.get('/system-settings', async (req, res) => {
  try {
    const settings = {
      businessHours: await dbAll('SELECT * FROM business_hours ORDER BY day_of_week'),
      tableSettings: await dbAll('SELECT * FROM table_settings ORDER BY table_number'),
      timeSlots: await dbAll('SELECT * FROM reservation_time_slots ORDER BY time_slot'),
      statistics: await dbGet(`
        SELECT 
          COUNT(*) as total_reservations,
          COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
          COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed
        FROM reservations
      `)
    };
    
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== BULK OPERATIONS =====

// Bulk update business hours
router.post('/business-hours/bulk', async (req, res) => {
  try {
    const { businessHours } = req.body;
    
    if (!Array.isArray(businessHours)) {
      return res.status(400).json({ error: 'businessHours must be an array' });
    }

    // Ensure all columns exist
    try {
      const cols = await dbAll("PRAGMA table_info(business_hours)");
      const colNames = cols.map(c => String(c.name));
      if (!colNames.includes('break_start')) await dbRun("ALTER TABLE business_hours ADD COLUMN break_start TEXT");
      if (!colNames.includes('break_end')) await dbRun("ALTER TABLE business_hours ADD COLUMN break_end TEXT");
      if (!colNames.includes('happy_hour_start')) await dbRun("ALTER TABLE business_hours ADD COLUMN happy_hour_start TEXT");
      if (!colNames.includes('happy_hour_end')) await dbRun("ALTER TABLE business_hours ADD COLUMN happy_hour_end TEXT");
      if (!colNames.includes('busy_hour_start')) await dbRun("ALTER TABLE business_hours ADD COLUMN busy_hour_start TEXT");
      if (!colNames.includes('busy_hour_end')) await dbRun("ALTER TABLE business_hours ADD COLUMN busy_hour_end TEXT");
    } catch (colErr) { /* ignore duplicate column errors */ }
    
    await dbRun('BEGIN TRANSACTION');
    try {
      // Delete existing hours first to prevent duplicates
      await dbRun('DELETE FROM business_hours');
      
      for (const hour of businessHours) {
        await dbRun(`
          INSERT INTO business_hours 
          (day_of_week, open_time, close_time, is_open, break_start, break_end, 
           happy_hour_start, happy_hour_end, busy_hour_start, busy_hour_end, updated_at) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [
          hour.day_of_week, 
          hour.open_time, 
          hour.close_time, 
          hour.is_open,
          hour.break_start || null,
          hour.break_end || null,
          hour.happy_hour_start || null,
          hour.happy_hour_end || null,
          hour.busy_hour_start || null,
          hour.busy_hour_end || null
        ]);
      }
      await dbRun('COMMIT');
      res.json({ message: 'Business hours updated successfully' });
    } catch (innerErr) {
      await dbRun('ROLLBACK');
      throw innerErr;
    }
  } catch (error) {
    console.error('Error updating business hours:', error);
    res.status(500).json({ error: error.message });
  }
});

// Bulk update time slots
router.post('/time-slots/bulk', async (req, res) => {
  try {
    const { timeSlots } = req.body;
    
    for (const slot of timeSlots) {
      await dbRun(`
        INSERT OR REPLACE INTO reservation_time_slots 
        (time_slot, is_available, max_reservations, updated_at) 
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `, [slot.time_slot, slot.is_available, slot.max_reservations]);
    }
    
    res.json({ message: 'Time slots updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== REPORTS =====

// Get reservation report
router.get('/reports/reservations', async (req, res) => {
  try {
    const { start_date, end_date, status } = req.query;
    
    let sql = `
      SELECT r.*, ts.table_name 
      FROM reservations r 
      LEFT JOIN table_settings ts ON r.table_number = ts.table_number
      WHERE 1=1
    `;
    const params = [];
    
    if (start_date && end_date) {
      sql += ' AND r.reservation_date BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }
    
    if (status && status !== 'all') {
      sql += ' AND r.status = ?';
      params.push(status);
    }
    
    sql += ' ORDER BY r.reservation_date DESC, r.reservation_time ASC';
    
    const reservations = await dbAll(sql, params);
    
    // Calculate statistics
    const stats = {
      total: reservations.length,
      confirmed: reservations.filter(r => r.status === 'confirmed').length,
      pending: reservations.filter(r => r.status === 'pending').length,
      cancelled: reservations.filter(r => r.status === 'cancelled').length,
      completed: reservations.filter(r => r.status === 'completed').length
    };
    
    res.json({
      reservations,
      statistics: stats
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get table utilization report
router.get('/reports/table-utilization', async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    let dateFilter = '';
    const params = [];
    
    if (start_date && end_date) {
      dateFilter = 'WHERE reservation_date BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }
    
    const utilization = await dbAll(`
      SELECT 
        ts.table_number,
        ts.table_name,
        ts.min_capacity,
        ts.max_capacity,
        COUNT(r.id) as total_reservations,
        COUNT(CASE WHEN r.status = 'confirmed' THEN 1 END) as confirmed_reservations,
        COUNT(CASE WHEN r.status = 'pending' THEN 1 END) as pending_reservations,
        COUNT(CASE WHEN r.status = 'completed' THEN 1 END) as completed_reservations,
        AVG(r.party_size) as avg_party_size
      FROM table_settings ts
      LEFT JOIN reservations r ON ts.table_number = r.table_number ${dateFilter ? 'AND ' + dateFilter.replace('WHERE', '') : ''}
      GROUP BY ts.id
      ORDER BY ts.table_number
    `, params);
    
    res.json(utilization);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Sales summary report including adjustments - payments 기반
router.get('/reports/sales-summary', async (req, res) => {
  try {
    const q = req.query || {};
    const start = q.start_date ? String(q.start_date) : null;
    const end = q.end_date ? String(q.end_date) : null;
    const channel = q.channel ? String(q.channel).toUpperCase() : null;
    const paidStatuses = "UPPER(status) IN ('PAID','PICKED_UP','CLOSED','COMPLETED')";

    const orderParams = [];
    let orderWhere = ` WHERE ${paidStatuses}`;
    if (start && end) { orderWhere += ' AND date(created_at) BETWEEN ? AND ?'; orderParams.push(start, end); }
    if (channel) { orderWhere += ' AND UPPER(order_type) = ?'; orderParams.push(channel); }
    const rows = await dbAll(`SELECT id, total, order_type, status, created_at FROM orders ${orderWhere}`, orderParams);
    const ids = rows.map(r => r.id);

    // payments 기반 총매출
    let paymentTotal = 0;
    if (ids.length > 0) {
      const ph = ids.map(()=>'?').join(',');
      const ptRow = await dbGet(
        `SELECT COALESCE(SUM(amount - COALESCE(tip, 0)), 0) as paid_total
         FROM payments WHERE order_id IN (${ph})
           AND UPPER(status) IN ('APPROVED','COMPLETED','SETTLED','PAID')
           AND UPPER(COALESCE(payment_method, '')) != 'NO_SHOW_FORFEITED'`, ids);
      paymentTotal = Number(ptRow?.paid_total || 0);
    }

    let adjustments = [];
    if (ids.length > 0) {
      const placeholders = ids.map(()=>'?').join(',');
      adjustments = await dbAll(`SELECT order_id, kind, SUM(amount_applied) as amount FROM order_adjustments WHERE order_id IN (${placeholders}) GROUP BY order_id, kind`, ids);
    }
    const sum = {
      orders: rows.length,
      total: paymentTotal,
      discounts: adjustments.filter(a=>String(a.kind).toUpperCase()==='DISCOUNT').reduce((s,a)=>s+Number(a.amount||0),0),
      bag_fees: adjustments.filter(a=>String(a.kind).toUpperCase()==='BAG_FEE').reduce((s,a)=>s+Number(a.amount||0),0),
    };
    res.json({ summary: sum, orders: rows, adjustments });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router; 