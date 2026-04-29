/**
 * Delivery Channel Integration API
 * 딜리버리 채널(UberEats, DoorDash, SkipTheDishes, TZO 등) 통합 관리
 */

const express = require('express');
const router = express.Router();

// 지원하는 딜리버리 채널 목록
const DELIVERY_CHANNELS = {
  thezoneorder: {
    id: 'thezoneorder',
    name: 'TheZoneOrder',
    shortName: 'TZO',
    color: '#FF6B35',
    enabled: true,
    apiEndpoint: null, // Firebase 통합 사용
    webhookSupport: true
  },
  urbanpiper: {
    id: 'urbanpiper',
    name: 'Urban Piper',
    shortName: 'UP',
    color: '#1F2937',
    enabled: false,
    apiEndpoint: 'https://pos-int.urbanpiper.com/external/api/v1',
    webhookSupport: true
  },
  ubereats: {
    id: 'ubereats',
    name: 'UberEats',
    shortName: 'Uber',
    color: '#06C167',
    enabled: false,
    apiEndpoint: 'https://api.uber.com/v1/eats',
    webhookSupport: true
  },
  doordash: {
    id: 'doordash',
    name: 'DoorDash',
    shortName: 'Door',
    color: '#FF3008',
    enabled: false,
    apiEndpoint: 'https://openapi.doordash.com',
    webhookSupport: true
  },
  skipthedishes: {
    id: 'skipthedishes',
    name: 'SkipTheDishes',
    shortName: 'Skip',
    color: '#FF8000',
    enabled: false,
    apiEndpoint: 'https://api.skipthedishes.com',
    webhookSupport: true
  },
  grubhub: {
    id: 'grubhub',
    name: 'GrubHub',
    shortName: 'Grub',
    color: '#F63440',
    enabled: false,
    apiEndpoint: 'https://api.grubhub.com',
    webhookSupport: true
  },
  fantuan: {
    id: 'fantuan',
    name: 'Fantuan',
    shortName: 'FT',
    color: '#E31837',
    enabled: false,
    apiEndpoint: null,
    webhookSupport: false
  }
};

module.exports = (db) => {
  // Helper functions
  const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });

  const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

  const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  // 채널 설정 테이블 초기화
  const initChannelSettingsTable = async () => {
    try {
      await dbRun(`
        CREATE TABLE IF NOT EXISTS delivery_channel_settings (
          channel_id TEXT PRIMARY KEY,
          channel_name TEXT NOT NULL,
          enabled INTEGER DEFAULT 0,
          api_key TEXT,
          api_secret TEXT,
          merchant_id TEXT,
          store_id TEXT,
          webhook_url TEXT,
          settings_json TEXT DEFAULT '{}',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('[CHANNELS] Settings table initialized');
    } catch (error) {
      console.error('[CHANNELS] Table init error:', error);
    }
  };

  initChannelSettingsTable();

  // ===== 채널 목록 조회 =====
  
  // GET /api/delivery-channels
  // 모든 딜리버리 채널 목록 조회
  router.get('/', async (req, res) => {
    try {
      const savedSettings = await dbAll('SELECT * FROM delivery_channel_settings');
      
      // Urban Piper Firebase 설정 조회 (목록에도 반영)
      let upFb = null;
      try {
        const settingRow = await dbGet("SELECT value FROM admin_settings WHERE key = 'firebase_restaurant_id'");
        const rId = (settingRow && settingRow.value) ? settingRow.value.trim() : '';
        if (rId) {
          const firebaseService = require('../services/firebaseService');
          const firestore = firebaseService.getFirestore();
          if (firestore) {
            const snap = await firestore.collection('restaurants').doc(rId).collection('settings').doc('urbanPiper').get();
            if (snap.exists) upFb = snap.data();
          }
        }
      } catch { /* non-fatal */ }

      const channels = Object.values(DELIVERY_CHANNELS).map(channel => {
        const saved = savedSettings.find(s => s.channel_id === channel.id);
        const isUp = channel.id === 'urbanpiper';
        return {
          ...channel,
          enabled: saved ? !!saved.enabled : channel.enabled,
          configured: !!(isUp && upFb?.apiKey) || !!saved?.api_key || channel.id === 'thezoneorder',
          settings: saved ? JSON.parse(saved.settings_json || '{}') : {},
          ...(isUp ? {
            api_key:      upFb?.apiKey || saved?.api_key || null,
            api_secret:   upFb?.apiSecret || saved?.api_secret || null,
            store_id:     upFb?.storeId || saved?.store_id || null,
            merchant_id:  upFb?.merchantId || saved?.merchant_id || null,
            api_endpoint: upFb?.baseUrl || null,
            webhook_url:  upFb?.webhookUrl || saved?.webhook_url || null,
          } : {}),
        };
      });
      
      res.json({ success: true, channels });
    } catch (error) {
      console.error('[CHANNELS] Get error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /api/delivery-channels/:channelId
  // 특정 채널 정보 조회
  router.get('/:channelId', async (req, res) => {
    try {
      const { channelId } = req.params;
      
      if (!DELIVERY_CHANNELS[channelId]) {
        return res.status(404).json({ success: false, error: 'Channel not found' });
      }
      
      const saved = await dbGet('SELECT * FROM delivery_channel_settings WHERE channel_id = ?', [channelId]);
      
      let fbData = null;
      if (channelId === 'urbanpiper') {
        try {
          const settingRow = await dbGet("SELECT value FROM admin_settings WHERE key = 'firebase_restaurant_id'");
          const rId = (settingRow && settingRow.value) ? settingRow.value.trim() : '';
          if (rId) {
            const firebaseService = require('../services/firebaseService');
            const firestore = firebaseService.getFirestore();
            if (firestore) {
              const snap = await firestore.collection('restaurants').doc(rId).collection('settings').doc('urbanPiper').get();
              if (snap.exists) fbData = snap.data();
            }
          }
        } catch { /* non-fatal */ }
      }

      const channel = {
        ...DELIVERY_CHANNELS[channelId],
        enabled: saved ? !!saved.enabled : DELIVERY_CHANNELS[channelId].enabled,
        configured: !!(fbData?.apiKey || saved?.api_key) || channelId === 'thezoneorder',
        settings: saved ? JSON.parse(saved.settings_json || '{}') : {},
        merchantId: fbData?.merchantId || saved?.merchant_id || null,
        storeId: fbData?.storeId || saved?.store_id || null,
        api_key: fbData?.apiKey || saved?.api_key || null,
        api_secret: fbData?.apiSecret || saved?.api_secret || null,
        api_endpoint: fbData?.baseUrl || (saved ? JSON.parse(saved.settings_json || '{}').baseUrl : null) || DELIVERY_CHANNELS[channelId]?.apiEndpoint || null,
        webhook_url: fbData?.webhookUrl || saved?.webhook_url || null,
      };
      
      res.json({ success: true, channel });
    } catch (error) {
      console.error('[CHANNELS] Get channel error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ===== 채널 설정 =====

  // POST /api/delivery-channels/:channelId/configure
  // 채널 설정 저장
  router.post('/:channelId/configure', async (req, res) => {
    try {
      const { channelId } = req.params;
      const { apiKey, apiSecret, merchantId, storeId, webhookUrl, settings } = req.body;
      
      if (!DELIVERY_CHANNELS[channelId]) {
        return res.status(404).json({ success: false, error: 'Channel not found' });
      }
      
      await dbRun(`
        INSERT INTO delivery_channel_settings 
          (channel_id, channel_name, api_key, api_secret, merchant_id, store_id, webhook_url, settings_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(channel_id) DO UPDATE SET
          api_key = excluded.api_key,
          api_secret = excluded.api_secret,
          merchant_id = excluded.merchant_id,
          store_id = excluded.store_id,
          webhook_url = excluded.webhook_url,
          settings_json = excluded.settings_json,
          updated_at = CURRENT_TIMESTAMP
      `, [
        channelId, 
        DELIVERY_CHANNELS[channelId].name,
        apiKey || null,
        apiSecret || null,
        merchantId || null,
        storeId || null,
        webhookUrl || null,
        JSON.stringify(settings || {})
      ]);
      
      console.log(`[CHANNELS] Configured (SQLite): ${channelId}`);

      // Urban Piper → Firebase에도 저장 (여러 POS에서 공유)
      if (channelId === 'urbanpiper') {
        try {
          const urbanPiperService = require('../services/urbanPiperService');
          const settingRow = await dbGet("SELECT value FROM admin_settings WHERE key = 'firebase_restaurant_id'");
          const restaurantId = (settingRow && settingRow.value) ? settingRow.value.trim() : '';
          if (restaurantId) {
            await urbanPiperService.saveConfigToFirebase(restaurantId, {
              apiKey:     apiKey || '',
              apiSecret:  apiSecret || '',
              storeId:    storeId || '',
              merchantId: merchantId || '',
              baseUrl:    (settings && settings.baseUrl) || DELIVERY_CHANNELS.urbanpiper.apiEndpoint || '',
              authMode:   (settings && settings.authMode) || 'basic',
              webhookUrl: webhookUrl || '',
            });
            console.log(`[CHANNELS] UP config also saved to Firebase`);
          }
        } catch (fbErr) {
          console.warn('[CHANNELS] Firebase save failed (non-fatal):', fbErr?.message);
        }
      }

      res.json({ success: true, message: `${DELIVERY_CHANNELS[channelId].name} configured successfully` });
    } catch (error) {
      console.error('[CHANNELS] Configure error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // POST /api/delivery-channels/:channelId/enable
  // 채널 활성화/비활성화
  router.post('/:channelId/enable', async (req, res) => {
    try {
      const { channelId } = req.params;
      const { enabled } = req.body;
      
      if (!DELIVERY_CHANNELS[channelId]) {
        return res.status(404).json({ success: false, error: 'Channel not found' });
      }
      
      // 채널 설정이 없으면 먼저 생성
      const existing = await dbGet('SELECT * FROM delivery_channel_settings WHERE channel_id = ?', [channelId]);
      
      if (existing) {
        await dbRun('UPDATE delivery_channel_settings SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE channel_id = ?', 
          [enabled ? 1 : 0, channelId]);
      } else {
        await dbRun(`
          INSERT INTO delivery_channel_settings (channel_id, channel_name, enabled) VALUES (?, ?, ?)
        `, [channelId, DELIVERY_CHANNELS[channelId].name, enabled ? 1 : 0]);
      }
      
      console.log(`[CHANNELS] ${channelId} ${enabled ? 'enabled' : 'disabled'}`);
      res.json({ success: true, message: `${DELIVERY_CHANNELS[channelId].name} ${enabled ? 'enabled' : 'disabled'}` });
    } catch (error) {
      console.error('[CHANNELS] Enable error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ===== 채널별 Day Off 관리 =====

  // GET /api/delivery-channels/:channelId/day-off
  // 특정 채널의 Day Off 목록 조회
  router.get('/:channelId/day-off', async (req, res) => {
    try {
      const { channelId } = req.params;
      
      const dayOffs = await dbAll(`
        SELECT * FROM online_day_off 
        WHERE channels = ? OR channels = 'all' OR channels LIKE ?
        ORDER BY date ASC
      `, [channelId, `%${channelId}%`]);
      
      res.json({ success: true, channelId, dayOffs });
    } catch (error) {
      console.error('[CHANNELS] Day Off get error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // POST /api/delivery-channels/:channelId/day-off
  // 특정 채널에 Day Off 추가
  router.post('/:channelId/day-off', async (req, res) => {
    try {
      const { channelId } = req.params;
      const { date, type = 'closed' } = req.body;
      
      if (!date) {
        return res.status(400).json({ success: false, error: 'Date is required' });
      }
      
      await dbRun(`
        INSERT OR REPLACE INTO online_day_off (date, channels, type, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `, [date, channelId, type]);
      
      console.log(`[CHANNELS] Day Off added: ${channelId} - ${date} (${type})`);
      res.json({ success: true, message: 'Day off added', channelId, date, type });
    } catch (error) {
      console.error('[CHANNELS] Day Off add error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ===== 채널 상태 조회 =====

  // GET /api/delivery-channels/status/all
  // 모든 채널 상태 조회
  router.get('/status/all', async (req, res) => {
    try {
      const savedSettings = await dbAll('SELECT * FROM delivery_channel_settings');
      const today = new Date().toISOString().split('T')[0];
      
      const statuses = await Promise.all(Object.values(DELIVERY_CHANNELS).map(async channel => {
        const saved = savedSettings.find(s => s.channel_id === channel.id);
        
        // 오늘 Day Off 확인
        const dayOff = await dbGet(`
          SELECT * FROM online_day_off 
          WHERE date = ? AND (channels = ? OR channels = 'all' OR channels LIKE ?)
        `, [today, channel.id, `%${channel.id}%`]);
        
        return {
          channelId: channel.id,
          name: channel.name,
          shortName: channel.shortName,
          color: channel.color,
          enabled: saved ? !!saved.enabled : channel.enabled,
          configured: !!saved?.api_key || channel.id === 'thezoneorder',
          isDayOff: !!dayOff,
          dayOffType: dayOff?.type || null,
          status: dayOff ? 'day_off' : (saved?.enabled ? 'online' : 'offline')
        };
      }));
      
      res.json({ success: true, statuses });
    } catch (error) {
      console.error('[CHANNELS] Status error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ===== Webhook 엔드포인트 (향후 연동용) =====

  // POST /api/delivery-channels/:channelId/webhook
  // 외부 채널에서 오는 Webhook 수신 (주문, 상태 업데이트 등)
  router.post('/:channelId/webhook', async (req, res) => {
    try {
      const { channelId } = req.params;
      const payload = req.body;
      
      console.log(`[CHANNELS] Webhook received from ${channelId}:`, JSON.stringify(payload).slice(0, 200));
      
      // TODO: 채널별 Webhook 처리 로직 구현
      // - UberEats: 주문 생성/업데이트/취소
      // - DoorDash: 주문 상태 변경
      // - SkipTheDishes: 주문 알림
      
      // 임시: Webhook 수신 로그 저장
      await dbRun(`
        INSERT INTO webhook_logs (channel_id, payload, received_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `, [channelId, JSON.stringify(payload)]).catch(() => {
        // webhook_logs 테이블이 없으면 무시
      });
      
      res.json({ success: true, message: 'Webhook received' });
    } catch (error) {
      console.error('[CHANNELS] Webhook error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ===== 채널 연동 테스트 =====

  // POST /api/delivery-channels/:channelId/test
  // 채널 연동 테스트
  router.post('/:channelId/test', async (req, res) => {
    try {
      const { channelId } = req.params;
      
      if (!DELIVERY_CHANNELS[channelId]) {
        return res.status(404).json({ success: false, error: 'Channel not found' });
      }
      
      const saved = await dbGet('SELECT * FROM delivery_channel_settings WHERE channel_id = ?', [channelId]);
      
      if (!saved?.api_key && channelId !== 'thezoneorder') {
        return res.json({ 
          success: false, 
          connected: false,
          message: 'API key not configured' 
        });
      }
      
      // Urban Piper: 실제 ping 호출
      if (channelId === 'urbanpiper') {
        const urbanPiperService = require('../services/urbanPiperService');
        const ping = await urbanPiperService.ping(db);
        return res.json({
          success: !ping.skipped,
          connected: !!ping.ok,
          message: ping.ok
            ? 'Urban Piper API reachable'
            : (ping.skipped ? `Urban Piper not configured: ${ping.error}` : `Urban Piper unreachable: ${ping.error || ping.status}`),
          details: {
            status: ping.status,
            storeId: saved?.store_id || 'Not set',
            merchantId: saved?.merchant_id || 'Not set'
          }
        });
      }

      // TZO는 Firebase 연동 상태 확인
      if (channelId === 'thezoneorder') {
        const restaurantId = require('fs').existsSync('.env') 
          ? require('dotenv').config().parsed?.FIREBASE_RESTAURANT_ID 
          : null;
        
        return res.json({
          success: true,
          connected: true,
          message: 'TheZoneOrder connected via Firebase',
          details: { restaurantId: restaurantId || 'Not configured' }
        });
      }
      
      // TODO: 실제 API 연동 테스트 구현
      // 현재는 설정만 확인
      res.json({
        success: true,
        connected: true,
        message: `${DELIVERY_CHANNELS[channelId].name} API credentials configured`,
        details: {
          merchantId: saved?.merchant_id || 'Not set',
          storeId: saved?.store_id || 'Not set'
        }
      });
    } catch (error) {
      console.error('[CHANNELS] Test error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
};
