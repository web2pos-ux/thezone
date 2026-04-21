/**
 * Dealer Access API
 * 
 * Access system for dealers/distributors/system administrators only
 * - Store owners/employees cannot access
 * - Can change Restaurant ID, Service Mode
 * 
 * Role hierarchy:
 * - SYSTEM_ADMIN: Super admin (all permissions)
 * - DISTRIBUTOR: Distributor (manages multiple dealers)
 * - DEALER: Dealer (store installation/setup)
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { dbRun, dbAll, dbGet } = require('../db');

// Config paths (process.env.CONFIG_PATH 사용 - 패키징된 앱에서 쓰기 가능한 경로)
const RESOURCES_CONFIG_DIR = path.join(__dirname, '..', 'config');
const CONFIG_DIR = process.env.CONFIG_PATH || RESOURCES_CONFIG_DIR;
const DEALER_CONFIG_PATH = path.join(CONFIG_DIR, 'dealer-access.json');
const SETUP_STATUS_PATH = path.join(CONFIG_DIR, 'setup-status.json');
console.log('[Dealer Access] Config directory:', CONFIG_DIR);

// Ensure config directory exists
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// 첫 실행 시 리소스에서 config 파일 복사 (패키징된 앱 지원)
if (CONFIG_DIR !== RESOURCES_CONFIG_DIR) {
  if (!fs.existsSync(DEALER_CONFIG_PATH) && fs.existsSync(path.join(RESOURCES_CONFIG_DIR, 'dealer-access.json'))) {
    fs.copyFileSync(path.join(RESOURCES_CONFIG_DIR, 'dealer-access.json'), DEALER_CONFIG_PATH);
    console.log('[Dealer Access] Copied dealer-access.json from resources to writable config');
  }
  if (!fs.existsSync(SETUP_STATUS_PATH) && fs.existsSync(path.join(RESOURCES_CONFIG_DIR, 'setup-status.json'))) {
    fs.copyFileSync(path.join(RESOURCES_CONFIG_DIR, 'setup-status.json'), SETUP_STATUS_PATH);
    console.log('[Dealer Access] Copied setup-status.json from resources to writable config');
  }
}

// Default dealer access config
const DEFAULT_DEALER_CONFIG = {
  // Master PIN for system admin
  masterPin: '9998887117',
  // Dealer PINs (can be added dynamically)
  dealers: [
    // Example: { id: 'dealer001', name: 'John Dealer', pin: '123456', role: 'DEALER', active: true }
  ],
  // Access log
  accessLog: []
};

// Load dealer config
function loadDealerConfig() {
  try {
    if (fs.existsSync(DEALER_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(DEALER_CONFIG_PATH, 'utf8'));
    }
  } catch (err) {
    console.error('[Dealer Access] Failed to load config:', err.message);
  }
  return { ...DEFAULT_DEALER_CONFIG };
}

// Save dealer config
function saveDealerConfig(config) {
  try {
    fs.writeFileSync(DEALER_CONFIG_PATH, JSON.stringify(config, null, 2));
    return true;
  } catch (err) {
    console.error('[Dealer Access] Failed to save config:', err.message);
    return false;
  }
}

// Hash PIN for comparison (simple hash for demo, use bcrypt in production)
function hashPin(pin) {
  return crypto.createHash('sha256').update(pin).digest('hex');
}

// Log access attempt
function logAccess(config, dealerId, dealerName, role, action, success) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    dealerId,
    dealerName,
    role,
    action,
    success
  };
  
  // Keep only last 100 logs
  config.accessLog = [logEntry, ...(config.accessLog || [])].slice(0, 100);
  saveDealerConfig(config);
  
  console.log(`[Dealer Access] ${success ? '✅' : '❌'} ${action} by ${dealerName || dealerId} (${role})`);
}

/**
 * POST /api/dealer-access/verify
 * Verify Dealer PIN
 */
router.post('/verify', async (req, res) => {
  try {
    const { pin } = req.body;
    
    if (!pin || pin.length < 4) {
      return res.status(400).json({ 
        success: false, 
        error: 'PIN must be at least 4 digits' 
      });
    }
    
    const config = loadDealerConfig();
    
    // Check master PIN first
    if (pin === config.masterPin) {
      logAccess(config, 'SYSTEM', 'System Admin', 'SYSTEM_ADMIN', 'LOGIN', true);
      return res.json({
        success: true,
        role: 'SYSTEM_ADMIN',
        name: 'System Admin',
        permissions: ['ALL']
      });
    }
    
    // Check dealer PINs
    const dealer = config.dealers.find(d => d.pin === pin && d.active);
    if (dealer) {
      logAccess(config, dealer.id, dealer.name, dealer.role, 'LOGIN', true);
      return res.json({
        success: true,
        role: dealer.role,
        name: dealer.name,
        dealerId: dealer.id,
        permissions: getPermissionsByRole(dealer.role)
      });
    }
    
    // Invalid PIN
    logAccess(config, 'UNKNOWN', 'Unknown', 'NONE', 'LOGIN_FAILED', false);
    return res.status(401).json({ 
      success: false, 
      error: 'Invalid Dealer PIN' 
    });
    
  } catch (error) {
    console.error('[Dealer Access] Verify error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get permissions by role
function getPermissionsByRole(role) {
  const permissions = {
    SYSTEM_ADMIN: ['ALL', 'MANAGE_DEALERS', 'CHANGE_RESTAURANT', 'CHANGE_SERVICE_MODE', 'RESET_DATA', 'VIEW_LOGS'],
    DISTRIBUTOR: ['CHANGE_RESTAURANT', 'CHANGE_SERVICE_MODE', 'RESET_DATA', 'VIEW_LOGS'],
    DEALER: ['CHANGE_RESTAURANT', 'CHANGE_SERVICE_MODE']
  };
  return permissions[role] || [];
}

/**
 * Middleware: Require dealer access
 */
function requireDealerAccess(req, res, next) {
  const dealerRole = req.headers['x-dealer-role'];
  const dealerPin = req.headers['x-dealer-pin'];
  
  if (!dealerRole || !dealerPin) {
    return res.status(403).json({ 
      success: false, 
      error: 'Dealer access required. This operation is restricted to authorized dealers only.' 
    });
  }
  
  const config = loadDealerConfig();
  
  // Verify PIN matches role
  if (dealerRole === 'SYSTEM_ADMIN' && dealerPin === config.masterPin) {
    req.dealerInfo = { role: 'SYSTEM_ADMIN', name: 'System Admin' };
    return next();
  }
  
  const dealer = config.dealers.find(d => d.pin === dealerPin && d.active);
  if (dealer && dealer.role === dealerRole) {
    req.dealerInfo = { role: dealer.role, name: dealer.name, id: dealer.id };
    return next();
  }
  
  return res.status(403).json({ 
    success: false, 
    error: 'Invalid dealer credentials' 
  });
}

/**
 * GET /api/dealer-access/store-settings
 * Get current store settings (Dealer only)
 */
router.get('/store-settings', requireDealerAccess, async (req, res) => {
  try {
    // Get from setup-status.json
    let setupStatus = {};
    if (fs.existsSync(SETUP_STATUS_PATH)) {
      setupStatus = JSON.parse(fs.readFileSync(SETUP_STATUS_PATH, 'utf8'));
    }
    
    // Get from database
    const businessProfile = await dbGet('SELECT * FROM business_profile WHERE id = 1');
    
    res.json({
      success: true,
      data: {
        restaurantId: setupStatus.restaurantId || businessProfile?.firebase_restaurant_id || null,
        storeName: setupStatus.storeName || businessProfile?.business_name || null,
        serviceMode: setupStatus.serviceMode || businessProfile?.service_type || 'FSR',
        setupCompleted: setupStatus.setupCompleted || false,
        setupDate: setupStatus.setupDate || null
      }
    });
  } catch (error) {
    console.error('[Dealer Access] Get store settings error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/dealer-access/store-settings
 * Update store settings (Dealer only)
 */
router.post('/store-settings', requireDealerAccess, async (req, res) => {
  try {
    const { restaurantId, storeName, serviceMode } = req.body;
    const { role, name } = req.dealerInfo;
    
    // Validate service mode
    if (serviceMode && !['QSR', 'FSR', 'BISTRO'].includes(serviceMode.toUpperCase())) {
      return res.status(400).json({ 
        success: false, 
        error: 'Service mode must be QSR, FSR, or BISTRO' 
      });
    }
    
    // Validate restaurant ID if provided
    if (restaurantId !== undefined && restaurantId !== null) {
      // Verify with Firebase if possible
      try {
        const firebaseService = require('../services/firebase');
        const db = firebaseService.getFirestore();
        if (db) {
          const restaurantDoc = await db.collection('restaurants').doc(restaurantId).get();
          if (!restaurantDoc.exists) {
            return res.status(400).json({ 
              success: false, 
              error: 'Restaurant ID not found in Firebase' 
            });
          }
        }
      } catch (fbErr) {
        console.warn('[Dealer Access] Firebase verification skipped:', fbErr.message);
      }
    }
    
    // Update setup-status.json
    let setupStatus = {};
    if (fs.existsSync(SETUP_STATUS_PATH)) {
      setupStatus = JSON.parse(fs.readFileSync(SETUP_STATUS_PATH, 'utf8'));
    }
    
    const updatedSetup = {
      ...setupStatus,
      isFirstRun: false,
      setupCompleted: true,
      restaurantId: restaurantId !== undefined ? restaurantId : setupStatus.restaurantId,
      storeName: storeName !== undefined ? storeName : setupStatus.storeName,
      serviceMode: serviceMode ? serviceMode.toUpperCase() : setupStatus.serviceMode,
      setupDate: new Date().toISOString(),
      lastModifiedBy: {
        role,
        name,
        timestamp: new Date().toISOString()
      }
    };
    
    fs.writeFileSync(SETUP_STATUS_PATH, JSON.stringify(updatedSetup, null, 2));
    
    // Update database
    await dbRun(`
      INSERT INTO business_profile (id, firebase_restaurant_id, business_name, service_type, updated_at)
      VALUES (1, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET 
        firebase_restaurant_id = COALESCE(excluded.firebase_restaurant_id, firebase_restaurant_id),
        business_name = COALESCE(excluded.business_name, business_name),
        service_type = COALESCE(excluded.service_type, service_type),
        updated_at = CURRENT_TIMESTAMP
    `, [
      restaurantId !== undefined ? restaurantId : null,
      storeName !== undefined ? storeName : null,
      serviceMode ? serviceMode.toUpperCase() : null
    ]);
    
    // Log action
    const config = loadDealerConfig();
    logAccess(config, req.dealerInfo.id || 'SYSTEM', name, role, 'CHANGE_STORE_SETTINGS', true);
    
    console.log(`[Dealer Access] Store settings updated by ${name} (${role}):`, {
      restaurantId: updatedSetup.restaurantId,
      serviceMode: updatedSetup.serviceMode
    });
    
    res.json({
      success: true,
      message: 'Store settings updated successfully',
      data: updatedSetup,
      note: 'Please restart the backend server for Firebase listeners to reconnect with new settings.'
    });
    
  } catch (error) {
    console.error('[Dealer Access] Update store settings error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/dealer-access/dealers (SYSTEM_ADMIN only)
 * Add dealer
 */
router.post('/dealers', requireDealerAccess, async (req, res) => {
  try {
    if (req.dealerInfo.role !== 'SYSTEM_ADMIN') {
      return res.status(403).json({ 
        success: false, 
        error: 'Only System Admin can manage dealers' 
      });
    }
    
    const { id, name, pin, role } = req.body;
    
    if (!id || !name || !pin || !role) {
      return res.status(400).json({ 
        success: false, 
        error: 'id, name, pin, and role are required' 
      });
    }
    
    if (!['DEALER', 'DISTRIBUTOR'].includes(role)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Role must be DEALER or DISTRIBUTOR' 
      });
    }
    
    const config = loadDealerConfig();
    
    // Check for duplicate ID or PIN
    if (config.dealers.some(d => d.id === id)) {
      return res.status(400).json({ success: false, error: 'Dealer ID already exists' });
    }
    if (config.dealers.some(d => d.pin === pin)) {
      return res.status(400).json({ success: false, error: 'PIN already in use' });
    }
    
    config.dealers.push({
      id,
      name,
      pin,
      role,
      active: true,
      createdAt: new Date().toISOString()
    });
    
    saveDealerConfig(config);
    logAccess(config, req.dealerInfo.id || 'SYSTEM', req.dealerInfo.name, 'SYSTEM_ADMIN', `ADD_DEALER: ${name}`, true);
    
    res.json({ success: true, message: 'Dealer added successfully' });
    
  } catch (error) {
    console.error('[Dealer Access] Add dealer error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/dealer-access/dealers (SYSTEM_ADMIN only)
 * Get dealer list
 */
router.get('/dealers', requireDealerAccess, async (req, res) => {
  try {
    if (req.dealerInfo.role !== 'SYSTEM_ADMIN') {
      return res.status(403).json({ 
        success: false, 
        error: 'Only System Admin can view dealers' 
      });
    }
    
    const config = loadDealerConfig();
    
    // Return dealers without PINs for security
    const dealers = config.dealers.map(d => ({
      id: d.id,
      name: d.name,
      role: d.role,
      active: d.active,
      createdAt: d.createdAt
    }));
    
    res.json({ success: true, dealers });
    
  } catch (error) {
    console.error('[Dealer Access] Get dealers error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/dealer-access/dealers/:id (SYSTEM_ADMIN only)
 * Deactivate dealer
 */
router.delete('/dealers/:id', requireDealerAccess, async (req, res) => {
  try {
    if (req.dealerInfo.role !== 'SYSTEM_ADMIN') {
      return res.status(403).json({ 
        success: false, 
        error: 'Only System Admin can manage dealers' 
      });
    }
    
    const config = loadDealerConfig();
    const dealerIndex = config.dealers.findIndex(d => d.id === req.params.id);
    
    if (dealerIndex === -1) {
      return res.status(404).json({ success: false, error: 'Dealer not found' });
    }
    
    config.dealers[dealerIndex].active = false;
    saveDealerConfig(config);
    
    logAccess(config, req.dealerInfo.id || 'SYSTEM', req.dealerInfo.name, 'SYSTEM_ADMIN', `DEACTIVATE_DEALER: ${req.params.id}`, true);
    
    res.json({ success: true, message: 'Dealer deactivated' });
    
  } catch (error) {
    console.error('[Dealer Access] Delete dealer error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/dealer-access/logs (SYSTEM_ADMIN, DISTRIBUTOR)
 * Get access logs
 */
router.get('/logs', requireDealerAccess, async (req, res) => {
  try {
    if (!['SYSTEM_ADMIN', 'DISTRIBUTOR'].includes(req.dealerInfo.role)) {
      return res.status(403).json({ 
        success: false, 
        error: 'Insufficient permissions' 
      });
    }
    
    const config = loadDealerConfig();
    res.json({ success: true, logs: config.accessLog || [] });
    
  } catch (error) {
    console.error('[Dealer Access] Get logs error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/dealer-access/change-master-pin (SYSTEM_ADMIN only)
 * Change master PIN
 */
router.post('/change-master-pin', requireDealerAccess, async (req, res) => {
  try {
    if (req.dealerInfo.role !== 'SYSTEM_ADMIN') {
      return res.status(403).json({ 
        success: false, 
        error: 'Only System Admin can change master PIN' 
      });
    }
    
    const { currentPin, newPin } = req.body;
    
    if (!currentPin || !newPin) {
      return res.status(400).json({ success: false, error: 'Both current and new PIN required' });
    }
    
    if (newPin.length < 6) {
      return res.status(400).json({ success: false, error: 'New PIN must be at least 6 digits' });
    }
    
    const config = loadDealerConfig();
    
    if (currentPin !== config.masterPin) {
      return res.status(401).json({ success: false, error: 'Current PIN is incorrect' });
    }
    
    config.masterPin = newPin;
    saveDealerConfig(config);
    
    logAccess(config, 'SYSTEM', 'System Admin', 'SYSTEM_ADMIN', 'CHANGE_MASTER_PIN', true);
    
    res.json({ success: true, message: 'Master PIN changed successfully' });
    
  } catch (error) {
    console.error('[Dealer Access] Change master PIN error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
module.exports.requireDealerAccess = requireDealerAccess;
