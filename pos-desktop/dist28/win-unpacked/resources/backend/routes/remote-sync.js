// backend/routes/remote-sync.js
// 원격 동기화 API 엔드포인트

const express = require('express');
const router = express.Router();
const remoteSyncService = require('../services/remoteSyncService');

// 권한 확인 미들웨어
function requireManager(req, res, next) {
  try {
    const role = String(req.headers['x-role'] || '').toUpperCase();
    if (role === 'ADMIN' || role === 'MANAGER') return next();
  } catch {}
  return res.status(403).json({ error: 'Forbidden: Manager or Admin required' });
}

// GET /api/remote-sync/status - 연결 상태 확인
router.get('/status', (req, res) => {
  const status = remoteSyncService.getStatus();
  res.json({ success: true, ...status });
});

// POST /api/remote-sync/initialize - 서비스 초기화
router.post('/initialize', requireManager, async (req, res) => {
  try {
    const { restaurantId } = req.body;
    
    if (!restaurantId) {
      return res.status(400).json({ error: 'Restaurant ID is required' });
    }
    
    const success = await remoteSyncService.initialize(restaurantId);
    
    if (success) {
      res.json({ 
        success: true, 
        message: 'Remote sync service initialized',
        status: remoteSyncService.getStatus()
      });
    } else {
      res.status(500).json({ error: 'Failed to initialize remote sync service' });
    }
  } catch (e) {
    console.error('Error initializing remote sync:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/remote-sync/stop - 서비스 중지
router.post('/stop', requireManager, (req, res) => {
  try {
    remoteSyncService.stop();
    res.json({ success: true, message: 'Remote sync service stopped' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/remote-sync/history - 동기화 히스토리 조회 (로컬)
router.get('/history', async (req, res) => {
  try {
    const firebaseService = require('../services/firebaseService');
    const firestore = firebaseService.getFirestore();
    
    const restaurantId = remoteSyncService.getRestaurantId();
    if (!restaurantId) {
      return res.status(400).json({ error: 'Service not initialized' });
    }
    
    const historySnapshot = await firestore
      .collection('syncHistory')
      .doc(restaurantId)
      .collection('history')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    
    const history = [];
    historySnapshot.forEach(doc => {
      const data = doc.data();
      history.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt
      });
    });
    
    res.json({ success: true, history });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;


















