/**
 * Firebase Setup API
 * Restaurant ID로 매장 연결
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// Firebase Admin SDK
const admin = require('firebase-admin');

// Firebase 설정 파일 경로 (읽기 전용 파일은 빌드된 위치, 쓰기 파일은 환경 변수 경로)
// FIREBASE_CONFIG_PATH: 빌드에 포함된 서비스 계정 파일 (읽기 전용)
// CONFIG_DIR: 쓰기 가능한 설정 폴더 (setup-status.json 등)
const RESOURCES_CONFIG_DIR = path.join(__dirname, '..', 'config');
const CONFIG_DIR = process.env.CONFIG_PATH || RESOURCES_CONFIG_DIR;
const FIREBASE_CONFIG_PATH = path.join(RESOURCES_CONFIG_DIR, 'firebase-service-account.json');
const SETUP_STATUS_PATH = path.join(CONFIG_DIR, 'setup-status.json');
console.log('[Firebase Setup] Resources config:', RESOURCES_CONFIG_DIR);
console.log('[Firebase Setup] Writable config:', CONFIG_DIR);

// 쓰기 가능한 config 폴더 확인 및 생성
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// Firebase 초기화 (앱에 내장된 키 사용)
let firebaseApp = null;
let firestore = null;

function initFirebase() {
  if (firebaseApp) return firestore;
  
  try {
    if (!fs.existsSync(FIREBASE_CONFIG_PATH)) {
      console.log('[Firebase] No config file found');
      return null;
    }
    
    const config = JSON.parse(fs.readFileSync(FIREBASE_CONFIG_PATH, 'utf8'));
    
    // 템플릿 파일인지 확인
    if (config.project_id === 'YOUR_PROJECT_ID' || !config.private_key || config.private_key.includes('YOUR_')) {
      console.log('[Firebase] Config is template, not initialized');
      return null;
    }
    
    // 이미 초기화된 앱이 있는지 확인
    if (admin.apps.length > 0) {
      firebaseApp = admin.apps[0];
    } else {
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(config)
      });
    }
    
    firestore = firebaseApp.firestore();
    console.log('[Firebase] Initialized successfully');
    return firestore;
  } catch (error) {
    console.error('[Firebase] Init error:', error.message);
    return null;
  }
}

// 시작 시 Firebase 초기화 시도
initFirebase();

/**
 * GET /api/firebase-setup/status
 * 설정 상태 확인 (첫 실행인지 확인)
 * ✅ serviceMode도 함께 반환
 */
router.get('/status', (req, res) => {
  try {
    // 설정 상태 파일 확인
    let setupStatus = {
      isFirstRun: true,
      setupCompleted: false,
      storeName: '',
      restaurantId: null,
      serviceMode: null,
      setupDate: null
    };
    
    if (fs.existsSync(SETUP_STATUS_PATH)) {
      const savedStatus = JSON.parse(fs.readFileSync(SETUP_STATUS_PATH, 'utf8'));
      setupStatus = { ...setupStatus, ...savedStatus };
    }
    
    // Firebase 설정 파일 확인
    let hasValidConfig = false;
    if (fs.existsSync(FIREBASE_CONFIG_PATH)) {
      try {
        const config = JSON.parse(fs.readFileSync(FIREBASE_CONFIG_PATH, 'utf8'));
        hasValidConfig = config.project_id && 
                        config.project_id !== 'YOUR_PROJECT_ID' && 
                        config.private_key && 
                        !config.private_key.includes('YOUR_');
      } catch (e) {
        hasValidConfig = false;
      }
    }
    
    res.json({
      success: true,
      data: {
        ...setupStatus,
        hasValidConfig,
        needsSetup: !setupStatus.setupCompleted || !setupStatus.restaurantId
      }
    });
  } catch (error) {
    console.error('Setup status error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/firebase-setup/verify-restaurant
 * Restaurant ID로 레스토랑 정보 조회
 */
router.post('/verify-restaurant', async (req, res) => {
  try {
    const { restaurantId } = req.body;
    
    if (!restaurantId) {
      return res.status(400).json({
        success: false,
        error: 'Please enter the Restaurant ID.'
      });
    }
    
    // Firebase 초기화 확인
    const db = initFirebase();
    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Firebase is not initialized. Please contact your administrator.'
      });
    }
    
    // Firestore에서 레스토랑 조회
    const restaurantDoc = await db.collection('restaurants').doc(restaurantId).get();
    
    if (!restaurantDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Restaurant ID not found. Please check the ID.'
      });
    }
    
    const restaurantData = restaurantDoc.data();
    
    // 비활성화된 레스토랑 체크
    if (restaurantData.isActive === false) {
      return res.status(400).json({
        success: false,
        error: 'This restaurant is inactive. Please contact your administrator.'
      });
    }
    
    res.json({
      success: true,
      message: 'Restaurant found',
      data: {
        id: restaurantId,
        name: restaurantData.name || 'Unknown Restaurant',
        address: restaurantData.address || '',
        city: restaurantData.city || '',
        state: restaurantData.state || '',
        phone: restaurantData.phone || '',
        email: restaurantData.email || ''
      }
    });
    
  } catch (error) {
    console.error('Verify restaurant error:', error);
    res.status(500).json({
      success: false,
      error: 'A server error occurred: ' + error.message
    });
  }
});

/**
 * POST /api/firebase-setup/save-restaurant
 * Restaurant ID 저장
 * ✅ setup-status.json + business_profile DB 양쪽에 저장
 */
router.post('/save-restaurant', async (req, res) => {
  try {
    const { restaurantId, storeName, serviceMode } = req.body;
    
    if (!restaurantId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Restaurant ID is required' 
      });
    }
    
    const finalServiceMode = serviceMode || 'FSR';
    
    // 1. 설정 상태 파일 저장 (setup-status.json)
    const setupStatus = {
      isFirstRun: false,
      setupCompleted: true,
      storeName: storeName || '',
      restaurantId: restaurantId,
      serviceMode: finalServiceMode,
      setupDate: new Date().toISOString()
    };
    
    fs.writeFileSync(SETUP_STATUS_PATH, JSON.stringify(setupStatus, null, 2));
    console.log('[Setup] setup-status.json saved with serviceMode:', finalServiceMode);
    
    // 2. Update business_profile table in SQLite (영구 저장)
    const { dbRun } = require('../db');
    try {
      await dbRun(`UPDATE business_profile SET 
        firebase_restaurant_id = ?,
        business_name = ?,
        service_type = ?
        WHERE id = 1`, [restaurantId, storeName || 'New Restaurant', finalServiceMode]);
      console.log('[Setup] business_profile updated - restaurantId:', restaurantId, 'serviceMode:', finalServiceMode);
    } catch (err) {
      console.log('[Setup] business_profile update error:', err.message);
      // Try insert if update fails
      try {
        await dbRun(`INSERT OR REPLACE INTO business_profile (id, firebase_restaurant_id, business_name, service_type) VALUES (1, ?, ?, ?)`,
          [restaurantId, storeName || 'New Restaurant', finalServiceMode]);
        console.log('[Setup] business_profile inserted successfully');
      } catch (err2) {
        console.log('[Setup] business_profile insert error:', err2.message);
      }
    }
    
    res.json({ 
      success: true, 
      message: 'Restaurant connected successfully',
      data: {
        restaurantId,
        storeName,
        serviceMode: finalServiceMode
      }
    });
  } catch (error) {
    console.error('Save restaurant error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/firebase-setup/current
 * 현재 연결된 레스토랑 정보
 */
router.get('/current', async (req, res) => {
  try {
    if (!fs.existsSync(SETUP_STATUS_PATH)) {
      return res.json({ 
        success: true, 
        data: null,
        message: 'No restaurant connected'
      });
    }
    
    const setupStatus = JSON.parse(fs.readFileSync(SETUP_STATUS_PATH, 'utf8'));
    
    if (!setupStatus.restaurantId) {
      return res.json({ 
        success: true, 
        data: null,
        message: 'No restaurant connected'
      });
    }
    
    // Firebase에서 최신 정보 조회
    const db = initFirebase();
    if (db) {
      try {
        const restaurantDoc = await db.collection('restaurants').doc(setupStatus.restaurantId).get();
        if (restaurantDoc.exists) {
          const data = restaurantDoc.data();
          return res.json({
            success: true,
            data: {
              restaurantId: setupStatus.restaurantId,
              name: data.name,
              address: data.address,
              city: data.city,
              state: data.state,
              phone: data.phone
            }
          });
        }
      } catch (e) {
        console.error('Fetch restaurant error:', e);
      }
    }
    
    // Firebase 조회 실패 시 저장된 정보 반환
    res.json({
      success: true,
      data: {
        restaurantId: setupStatus.restaurantId,
        name: setupStatus.storeName
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/firebase-setup/clear-data
 * Clear local database (menu, categories, modifiers, etc.)
 */
router.post('/clear-data', async (req, res) => {
  try {
    // Get database connection
    const { dbRun } = require('../db');
    
    console.log('[Setup] Clearing local database...');
    
    // Tables to clear (in order to avoid foreign key issues)
    const tablesToClear = [
      'order_items',
      'orders',
      'menu_modifier_link',
      'menu_tax_link',
      'menu_printer_link',
      'category_modifier_link',
      'category_tax_link',
      'category_printer_link',
      'menu_items',
      'menu_categories',
      'modifiers',
      'modifier_groups',
      'tax_groups',
      'printer_groups'
    ];
    
    // Clear each table
    for (const table of tablesToClear) {
      try {
        await dbRun(`DELETE FROM ${table}`);
        console.log(`[Setup] Cleared table: ${table}`);
      } catch (e) {
        console.log(`[Setup] Table ${table} not found or error:`, e.message);
        // Continue even if table doesn't exist
      }
    }
    
    // Reset business profile (keep the table but clear Firebase connection)
    try {
      await dbRun(`UPDATE business_profile SET 
        firebase_restaurant_id = NULL,
        business_name = 'New Restaurant'
        WHERE id = 1`);
    } catch (err) {
      console.log('[Setup] business_profile update error:', err.message);
    }
    
    console.log('[Setup] Database cleared successfully');
    
    res.json({ 
      success: true, 
      message: 'Local database cleared successfully' 
    });
  } catch (error) {
    console.error('[Setup] Clear data error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/firebase-setup/reset
 * 설정 완전 초기화 (setup-status.json + database 모두 초기화)
 */
router.delete('/reset', async (req, res) => {
  try {
    // 1. setup-status.json 초기화
    const setupStatus = {
      isFirstRun: true,
      setupCompleted: false,
      storeName: '',
      restaurantId: null,
      serviceMode: '',
      setupDate: null
    };
    fs.writeFileSync(SETUP_STATUS_PATH, JSON.stringify(setupStatus, null, 2));
    console.log('[Setup Reset] setup-status.json cleared');
    
    // 2. Database business_profile 초기화
    const { dbRun } = require('../db');
    try {
      await dbRun(`UPDATE business_profile SET 
        service_type = NULL, 
        firebase_restaurant_id = NULL,
        business_name = NULL
        WHERE id = 1`);
      console.log('[Setup Reset] Database business_profile cleared');
    } catch (dbErr) {
      console.log('[Setup Reset] Database clear skipped:', dbErr.message);
    }
    
    res.json({ 
      success: true, 
      message: 'Setup completely reset. Please restart the app.' 
    });
  } catch (error) {
    console.error('[Setup Reset] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 기존 API 유지 (하위 호환)
router.post('/save', (req, res) => {
  res.status(400).json({ 
    success: false, 
    error: 'This endpoint is deprecated. Use /save-restaurant instead.' 
  });
});

router.post('/test', (req, res) => {
  res.status(400).json({ 
    success: false, 
    error: 'This endpoint is deprecated. Use /verify-restaurant instead.' 
  });
});

module.exports = router;
