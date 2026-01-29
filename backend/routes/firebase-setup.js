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

// Firebase 설정 파일 경로
const CONFIG_DIR = path.join(__dirname, '..', 'config');
const FIREBASE_CONFIG_PATH = path.join(CONFIG_DIR, 'firebase-service-account.json');
const SETUP_STATUS_PATH = path.join(CONFIG_DIR, 'setup-status.json');

// config 폴더 확인
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
 */
router.get('/status', (req, res) => {
  try {
    // 설정 상태 파일 확인
    let setupStatus = {
      isFirstRun: true,
      setupCompleted: false,
      storeName: '',
      restaurantId: null,
      setupDate: null
    };
    
    if (fs.existsSync(SETUP_STATUS_PATH)) {
      setupStatus = JSON.parse(fs.readFileSync(SETUP_STATUS_PATH, 'utf8'));
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
        error: 'Restaurant ID를 입력하세요.' 
      });
    }
    
    // Firebase 초기화 확인
    const db = initFirebase();
    if (!db) {
      return res.status(500).json({ 
        success: false, 
        error: 'Firebase가 초기화되지 않았습니다. 관리자에게 문의하세요.' 
      });
    }
    
    // Firestore에서 레스토랑 조회
    const restaurantDoc = await db.collection('restaurants').doc(restaurantId).get();
    
    if (!restaurantDoc.exists) {
      return res.status(404).json({ 
        success: false, 
        error: 'Restaurant ID를 찾을 수 없습니다. ID를 확인해주세요.' 
      });
    }
    
    const restaurantData = restaurantDoc.data();
    
    // 비활성화된 레스토랑 체크
    if (restaurantData.isActive === false) {
      return res.status(400).json({ 
        success: false, 
        error: '비활성화된 레스토랑입니다. 관리자에게 문의하세요.' 
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
      error: '서버 오류가 발생했습니다: ' + error.message 
    });
  }
});

/**
 * POST /api/firebase-setup/save-restaurant
 * Restaurant ID 저장
 */
router.post('/save-restaurant', async (req, res) => {
  try {
    const { restaurantId, storeName } = req.body;
    
    if (!restaurantId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Restaurant ID is required' 
      });
    }
    
    // 설정 상태 저장
    const setupStatus = {
      isFirstRun: false,
      setupCompleted: true,
      storeName: storeName || '',
      restaurantId: restaurantId,
      setupDate: new Date().toISOString()
    };
    
    fs.writeFileSync(SETUP_STATUS_PATH, JSON.stringify(setupStatus, null, 2));
    
    // localStorage에 저장할 수 있도록 storeId도 설정
    // (POS에서 사용하는 storeId와 연동)
    
    res.json({ 
      success: true, 
      message: 'Restaurant connected successfully',
      data: {
        restaurantId,
        storeName
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
 * DELETE /api/firebase-setup/reset
 * 설정 초기화 (재설정용)
 */
router.delete('/reset', (req, res) => {
  try {
    // 설정 상태 초기화
    const setupStatus = {
      isFirstRun: true,
      setupCompleted: false,
      storeName: '',
      restaurantId: null,
      setupDate: null
    };
    fs.writeFileSync(SETUP_STATUS_PATH, JSON.stringify(setupStatus, null, 2));
    
    res.json({ 
      success: true, 
      message: 'Setup reset successfully' 
    });
  } catch (error) {
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
