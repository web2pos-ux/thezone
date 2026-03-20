// backend/routes/sales-dashboard.js
// 실시간 매출 대시보드 API (TZO용)

const express = require('express');
const router = express.Router();
const salesSyncService = require('../services/salesSyncService');

// GET /api/sales-dashboard/daily/:restaurantId
// 일별 매출 조회
router.get('/daily/:restaurantId', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const { date } = req.query;
    
    const result = await salesSyncService.getDailySales(restaurantId, date);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/sales-dashboard/monthly/:restaurantId
// 월별 매출 조회
router.get('/monthly/:restaurantId', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const { month } = req.query;
    
    const result = await salesSyncService.getMonthlySales(restaurantId, month);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/sales-dashboard/realtime/:restaurantId
// 실시간 상태 조회
router.get('/realtime/:restaurantId', async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const admin = require('firebase-admin');
    
    if (admin.apps.length === 0) {
      return res.status(500).json({ success: false, error: 'Firebase not initialized' });
    }
    
    const db = admin.firestore();
    const realtimeRef = db.collection('restaurants').doc(restaurantId).collection('realtime').doc('today');
    const doc = await realtimeRef.get();
    
    if (doc.exists) {
      res.json({ success: true, data: doc.data() });
    } else {
      res.json({ success: true, data: null, message: 'No realtime data' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
