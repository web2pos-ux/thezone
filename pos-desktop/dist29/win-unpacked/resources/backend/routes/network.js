// GET /api/network/status — Ping 기반 연결 상태 + 큐 건수
const express = require('express');
const router = express.Router();

module.exports = () => {
  const networkConnectivity = require('../services/networkConnectivityService');
  const firebaseSyncQueue = require('../services/firebaseSyncQueueService');
  const firebaseSyncOrchestrator = require('../services/firebaseSyncOrchestrator');

  router.get('/status', async (req, res) => {
    try {
      const counts = await firebaseSyncQueue.getCounts();
      res.json({
        online: networkConnectivity.isInternetConnected(),
        consecutiveFailures: networkConnectivity.getConsecutiveFailures(),
        lastCheckIso: networkConnectivity.getLastCheckIso(),
        syncState: networkConnectivity.getSyncState(),
        pingUrl: networkConnectivity.getPingUrl(),
        queuePending: counts.pending,
        queueProcessing: counts.processing,
        queueTotalActive: counts.totalActive,
        dlqCount: counts.dlq,
        queueSyncActive: firebaseSyncOrchestrator.isQueueWorkerActive(),
      });
    } catch (e) {
      res.status(500).json({ error: e.message || 'status failed' });
    }
  });

  return router;
};
