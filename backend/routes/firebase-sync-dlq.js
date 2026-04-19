/**

 * Firebase 동기화 DLQ 조회 / 건별 재전송 (SQLite에 이미 반영된 건을 Firebase에만 맞춤)

 * GET /api/firebase-sync/dlq

 * POST /api/firebase-sync/dlq/:id/retry

 */



const express = require('express');

const router = express.Router();



module.exports = () => {

  const firebaseSyncOrchestrator = require('../services/firebaseSyncOrchestrator');

  const firebaseSyncQueue = require('../services/firebaseSyncQueueService');



  router.get('/dlq', async (req, res) => {

    try {

      const rows = await firebaseSyncQueue.dbAll(

        `SELECT id, queue_id, type, order_id, error_message, created_at, payload

         FROM firebase_sync_dlq ORDER BY id DESC LIMIT 200`,

      );

      res.json({ ok: true, rows: rows || [] });

    } catch (e) {

      res.status(500).json({ ok: false, error: e.message || 'dlq list failed' });

    }

  });



  router.post('/dlq/:id/retry', async (req, res) => {

    try {

      const id = Number(req.params.id);

      if (!Number.isFinite(id) || id <= 0) {

        return res.status(400).json({ ok: false, error: 'invalid id' });

      }

      await firebaseSyncOrchestrator.retryDlqEntry(id);

      res.json({ ok: true });

    } catch (e) {

      if (e && e.code === 'OFFLINE') {

        return res.status(503).json({ ok: false, error: 'network_offline', message: e.message });

      }

      if (e && e.code === 'NOT_FOUND') {

        return res.status(404).json({ ok: false, error: 'not_found' });

      }

      res.status(500).json({ ok: false, error: e.message || String(e) });

    }

  });



  return router;

};


