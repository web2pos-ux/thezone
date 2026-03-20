/**
 * 디바이스 관리 API
 * 테이블 오더 태블릿 등록, 배정, 상태 모니터링
 * + 페어링코드 기반 인증 / 토큰 시스템
 */

const express = require('express');
const { getLocalDatetimeString } = require('../utils/datetimeUtils');
const router = express.Router();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

module.exports = (db) => {
  // Helper functions
  const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

  const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

  // ==================== 페어링코드/토큰 헬퍼 ====================
  function generateToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  async function getPairingCode() {
    const row = await dbGet("SELECT setting_value FROM app_settings WHERE setting_key = 'pairing_code'");
    return row?.setting_value || null;
  }

  function verifyToken(req) {
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) return auth.slice(7);
    return req.query?.token || req.headers['x-device-token'] || null;
  }

  async function isValidToken(token) {
    if (!token) return false;
    const row = await dbGet(
      "SELECT * FROM device_tokens WHERE token = ? AND revoked = 0",
      [token]
    );
    return !!row;
  }

  async function getDeviceByToken(token) {
    if (!token) return null;
    const row = await dbGet(
      "SELECT dt.device_id, rd.* FROM device_tokens dt LEFT JOIN registered_devices rd ON dt.device_id = rd.device_id WHERE dt.token = ? AND dt.revoked = 0",
      [token]
    );
    return row || null;
  }

  // ==================== 테이블 초기화 ====================
  const initTables = async () => {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS registered_devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT UNIQUE NOT NULL,
        device_name TEXT,
        device_type TEXT DEFAULT 'table_order',
        assigned_table_id TEXT,
        assigned_table_label TEXT,
        store_id TEXT DEFAULT 'default',
        status TEXT DEFAULT 'pending',
        app_version TEXT,
        os_version TEXT,
        ip_address TEXT,
        mac_address TEXT,
        battery_level INTEGER,
        is_charging INTEGER DEFAULT 0,
        last_seen_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS device_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        revoked INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        revoked_at DATETIME
      )
    `);

    await dbRun(`CREATE INDEX IF NOT EXISTS idx_device_tokens_token ON device_tokens(token)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_device_tokens_device ON device_tokens(device_id)`);

    await dbRun(`CREATE INDEX IF NOT EXISTS idx_devices_status ON registered_devices(status)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_devices_table ON registered_devices(assigned_table_id)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON registered_devices(last_seen_at)`);

    console.log('[devices] registered_devices + device_tokens 테이블 초기화 완료');
  };

  initTables().catch(err => console.error('Failed to init device tables:', err));

  // ==================== Firebase 페어링코드 실시간 리스너 ====================
  (async () => {
    try {
      const profile = await dbGet('SELECT firebase_restaurant_id FROM business_profile WHERE id = 1');
      const restaurantId = profile?.firebase_restaurant_id;
      if (!restaurantId) return;

      let admin;
      try { admin = require('firebase-admin'); } catch { return; }
      if (!admin.apps.length) return;

      const firestore = admin.app().firestore();
      const docRef = firestore.collection('restaurants').doc(restaurantId);

      docRef.onSnapshot(async (snap) => {
        if (!snap.exists) return;
        const data = snap.data();
        const fbCode = data?.settings?.pairingCode || data?.pairingCode || null;
        if (!fbCode) return;

        const current = await getPairingCode();
        if (current === fbCode) return;

        console.log(`[Pairing] Firebase push → code changed: "${current}" → "${fbCode}"`);
        await dbRun(
          "INSERT INTO app_settings (setting_key, setting_value, description) VALUES ('pairing_code', ?, 'Device pairing code') ON CONFLICT(setting_key) DO UPDATE SET setting_value = ?",
          [fbCode, fbCode]
        );

        await dbRun("UPDATE device_tokens SET revoked = 1, revoked_at = ? WHERE revoked = 0", [getLocalDatetimeString()]);
        console.log('[Pairing] All existing tokens revoked due to code change');

        try {
          const io = require('express').application?.get?.('io');
        } catch {}
      }, (err) => {
        console.warn('[Pairing] Firebase listener error:', err.message);
      });

      console.log(`[Pairing] Firebase listener active for restaurant ${restaurantId}`);
    } catch (e) {
      console.log('[Pairing] Firebase listener setup skipped:', e.message);
    }
  })();

  // ==================== 페어링코드 관리 API ====================

  /**
   * GET /api/devices/pairing-code
   * 현재 페어링코드 조회 (POS 관리자용)
   */
  router.get('/pairing-code', async (req, res) => {
    try {
      const code = await getPairingCode();
      res.json({ success: true, pairing_code: code || '' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * PUT /api/devices/pairing-code
   * 페어링코드 설정/변경 (POS 관리자용)
   * 코드 변경 시 기존 토큰 모두 무효화
   */
  router.put('/pairing-code', async (req, res) => {
    const { pairing_code } = req.body;
    if (!pairing_code || typeof pairing_code !== 'string') {
      return res.status(400).json({ success: false, error: 'pairing_code is required (string, max 10 chars)' });
    }
    const code = pairing_code.trim();
    if (code.length < 1 || code.length > 10) {
      return res.status(400).json({ success: false, error: 'pairing_code must be 1-10 characters' });
    }

    try {
      await dbRun(
        "INSERT INTO app_settings (setting_key, setting_value, description) VALUES ('pairing_code', ?, 'Device pairing code') ON CONFLICT(setting_key) DO UPDATE SET setting_value = ?",
        [code, code]
      );

      const revokeCount = await dbRun("UPDATE device_tokens SET revoked = 1, revoked_at = ? WHERE revoked = 0", [getLocalDatetimeString()]);
      console.log(`[Pairing] Code updated → "${code}", ${revokeCount?.changes || 0} tokens revoked`);

      // Firebase에도 동기화
      try {
        const profile = await dbGet('SELECT firebase_restaurant_id FROM business_profile WHERE id = 1');
        const restaurantId = profile?.firebase_restaurant_id;
        if (restaurantId) {
          const admin = require('firebase-admin');
          if (admin.apps.length) {
            const firestore = admin.app().firestore();
            await firestore.collection('restaurants').doc(restaurantId).set(
              { settings: { pairingCode: code } },
              { merge: true }
            );
            console.log('[Pairing] Synced to Firebase');
          }
        }
      } catch (e) {
        console.warn('[Pairing] Firebase sync failed:', e.message);
      }

      res.json({ success: true, message: 'Pairing code updated', tokens_revoked: revokeCount?.changes || 0 });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/devices/pair
   * 디바이스 페어링 (페어링코드 검증 → 토큰 발급)
   */
  router.post('/pair', async (req, res) => {
    const { device_id, pairing_code, device_name, device_type = 'table_order', app_version, os_version } = req.body;

    if (!device_id || !pairing_code) {
      return res.status(400).json({ success: false, error: 'device_id and pairing_code are required' });
    }

    try {
      const storedCode = await getPairingCode();
      if (!storedCode) {
        return res.status(503).json({ success: false, error: 'Pairing code not configured on POS' });
      }

      if (pairing_code.trim() !== storedCode) {
        return res.status(401).json({ success: false, error: 'Invalid pairing code' });
      }

      const ipAddress = req.ip || req.connection?.remoteAddress;
      const now = getLocalDatetimeString();

      const existing = await dbGet('SELECT * FROM registered_devices WHERE device_id = ?', [device_id]);
      if (existing) {
        await dbRun(`UPDATE registered_devices SET device_name = COALESCE(?, device_name), device_type = COALESCE(?, device_type), app_version = COALESCE(?, app_version), os_version = COALESCE(?, os_version), ip_address = ?, last_seen_at = ?, updated_at = ? WHERE device_id = ?`,
          [device_name, device_type, app_version, os_version, ipAddress, now, now, device_id]);
      } else {
        await dbRun(`INSERT INTO registered_devices (device_id, device_name, device_type, app_version, os_version, ip_address, status, last_seen_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
          [device_id, device_name || `Device-${device_id.slice(-6)}`, device_type, app_version, os_version, ipAddress, now, now, now]);
      }

      await dbRun("UPDATE device_tokens SET revoked = 1, revoked_at = ? WHERE device_id = ? AND revoked = 0", [now, device_id]);

      const token = generateToken();
      await dbRun("INSERT INTO device_tokens (device_id, token, created_at) VALUES (?, ?, ?)", [device_id, token, now]);

      const device = await dbGet('SELECT * FROM registered_devices WHERE device_id = ?', [device_id]);
      console.log(`[Pairing] Device paired: ${device_id}`);

      try {
        const io = req.app.get('io');
        if (io) io.emit('device_registered', { device_id, device_name: device?.device_name, status: 'pending' });
      } catch {}

      res.json({
        success: true,
        message: 'Device paired successfully',
        token,
        device
      });

    } catch (err) {
      console.error('[Pairing] Error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/devices/verify-token
   * 토큰 유효성 확인 (앱 시작 시 호출)
   */
  router.post('/verify-token', async (req, res) => {
    const token = verifyToken(req);
    if (!token) return res.status(401).json({ success: false, error: 'No token provided' });

    try {
      const device = await getDeviceByToken(token);
      if (!device) return res.status(401).json({ success: false, error: 'Invalid or revoked token', revoked: true });

      res.json({ success: true, device_id: device.device_id, device });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/devices/download/apk
   * APK 다운로드 (페어링코드 쿼리 파라미터로 검증)
   */
  router.get('/download/apk', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).json({ success: false, error: 'Pairing code required (?code=...)' });

    try {
      const storedCode = await getPairingCode();
      if (!storedCode || code.trim() !== storedCode) {
        return res.status(401).json({ success: false, error: 'Invalid pairing code' });
      }

      const cwd = process.cwd();
      const cwdParent = path.join(cwd, '..');
      const resourcesPath = process.resourcesPath || path.join(__dirname, '..', '..');
      const apkName = 'table-order-app-release.apk';
      const searchRoots = [...new Set([cwd, cwdParent, path.join(__dirname, '..', '..'), resourcesPath])];
      const apkPaths = [];
      for (const root of searchRoots) {
        apkPaths.push(
          path.join(root, 'Download', 'Table Order', 'Android', apkName),
          path.join(root, 'update-server', 'public', 'download', 'tableorder', apkName),
          path.join(root, 'backend', 'apk', apkName),
          path.join(root, 'apk', apkName),
        );
      }

      let apkPath = null;
      for (const p of apkPaths) {
        if (fs.existsSync(p)) { apkPath = p; break; }
      }

      if (!apkPath) {
        console.error('[APK Download] APK not found. Searched paths:', apkPaths);
        return res.status(404).json({ success: false, error: 'APK file not found on server' });
      }

      res.download(apkPath, 'table-order-app-release.apk');
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==================== 디바이스 등록 API ====================

  /**
   * POST /api/devices/register
   * 새 디바이스 등록 또는 기존 디바이스 재등록
   * 토큰 인증 필요 (Bearer token)
   */
  router.post('/register', async (req, res) => {
    const { 
      device_id, 
      device_name, 
      device_type = 'table_order',
      app_version,
      os_version,
      mac_address
    } = req.body;

    if (!device_id) {
      return res.status(400).json({ 
        success: false, 
        error: 'device_id is required' 
      });
    }

    // 토큰 검증 (페어링 완료된 디바이스만 허용)
    const token = verifyToken(req);
    if (token) {
      const valid = await isValidToken(token);
      if (!valid) {
        return res.status(401).json({ success: false, error: 'Invalid or revoked token', revoked: true });
      }
    }

    try {
      const ipAddress = req.ip || req.connection.remoteAddress;
      const now = getLocalDatetimeString();

      const existing = await dbGet(
        'SELECT * FROM registered_devices WHERE device_id = ?', 
        [device_id]
      );

      if (existing) {
        await dbRun(`
          UPDATE registered_devices 
          SET device_name = COALESCE(?, device_name),
              device_type = COALESCE(?, device_type),
              app_version = COALESCE(?, app_version),
              os_version = COALESCE(?, os_version),
              mac_address = COALESCE(?, mac_address),
              ip_address = ?,
              last_seen_at = ?,
              updated_at = ?
          WHERE device_id = ?
        `, [
          device_name, device_type, app_version, os_version, mac_address,
          ipAddress, now, now, device_id
        ]);

        const updated = await dbGet(
          'SELECT * FROM registered_devices WHERE device_id = ?', 
          [device_id]
        );

        console.log(`[devices] 디바이스 재연결: ${device_id}`);
        
        return res.json({
          success: true,
          message: 'Device reconnected',
          is_new: false,
          device: updated
        });
      }

      await dbRun(`
        INSERT INTO registered_devices (
          device_id, device_name, device_type, 
          app_version, os_version, mac_address, 
          ip_address, status, last_seen_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
      `, [
        device_id, 
        device_name || `Device-${device_id.slice(-6)}`,
        device_type,
        app_version,
        os_version,
        mac_address,
        ipAddress,
        now, now, now
      ]);

      const newDevice = await dbGet(
        'SELECT * FROM registered_devices WHERE device_id = ?', 
        [device_id]
      );

      console.log(`[devices] 새 디바이스 등록: ${device_id}`);

      try {
        const io = req.app.get('io');
        if (io) {
          io.emit('device_registered', {
            device_id,
            device_name: newDevice.device_name,
            status: 'pending'
          });
        }
      } catch (e) {
        console.log('[devices] Socket.io notification failed');
      }

      res.status(201).json({
        success: true,
        message: 'Device registered successfully',
        is_new: true,
        device: newDevice
      });

    } catch (err) {
      console.error('[devices] Registration error:', err);
      res.status(500).json({ 
        success: false, 
        error: err.message 
      });
    }
  });

  // ==================== 디바이스 목록 조회 ====================

  /**
   * GET /api/devices
   * 전체 디바이스 목록 조회
   * Query: ?status=active|pending|inactive
   */
  router.get('/', async (req, res) => {
    const { status, device_type } = req.query;

    try {
      let sql = 'SELECT * FROM registered_devices WHERE 1=1';
      const params = [];

      if (status) {
        sql += ' AND status = ?';
        params.push(status);
      }

      if (device_type) {
        sql += ' AND device_type = ?';
        params.push(device_type);
      }

      sql += ' ORDER BY CASE WHEN assigned_table_id IS NULL THEN 1 ELSE 0 END, assigned_table_id, created_at DESC';

      const devices = await dbAll(sql, params);

      // 온라인/오프라인 상태 계산 (60초 기준)
      const now = Date.now();
      const OFFLINE_THRESHOLD = 60 * 1000; // 60초

      const devicesWithStatus = devices.map(device => {
        const lastSeen = device.last_seen_at ? new Date(device.last_seen_at).getTime() : 0;
        const isOnline = (now - lastSeen) < OFFLINE_THRESHOLD;
        
        return {
          ...device,
          is_online: isOnline,
          seconds_since_seen: Math.floor((now - lastSeen) / 1000)
        };
      });

      res.json({
        success: true,
        count: devicesWithStatus.length,
        devices: devicesWithStatus
      });

    } catch (err) {
      console.error('[devices] List error:', err);
      res.status(500).json({ 
        success: false, 
        error: err.message 
      });
    }
  });

  // ==================== 단일 디바이스 조회 ====================

  /**
   * GET /api/devices/:deviceId
   * 특정 디바이스 상세 조회
   */
  router.get('/:deviceId', async (req, res) => {
    const { deviceId } = req.params;

    try {
      const device = await dbGet(
        'SELECT * FROM registered_devices WHERE device_id = ?', 
        [deviceId]
      );

      if (!device) {
        return res.status(404).json({ 
          success: false, 
          error: 'Device not found' 
        });
      }

      // 온라인 상태 계산
      const now = Date.now();
      const lastSeen = device.last_seen_at ? new Date(device.last_seen_at).getTime() : 0;
      const isOnline = (now - lastSeen) < 60000;

      res.json({
        success: true,
        device: {
          ...device,
          is_online: isOnline,
          seconds_since_seen: Math.floor((now - lastSeen) / 1000)
        }
      });

    } catch (err) {
      console.error('[devices] Get error:', err);
      res.status(500).json({ 
        success: false, 
        error: err.message 
      });
    }
  });

  // ==================== 테이블 배정 API ====================

  /**
   * PUT /api/devices/:deviceId/assign
   * 디바이스에 테이블 배정
   */
  router.put('/:deviceId/assign', async (req, res) => {
    const { deviceId } = req.params;
    const { table_id, table_label, force_replace } = req.body;

    if (!table_id) {
      return res.status(400).json({ 
        success: false, 
        error: 'table_id is required' 
      });
    }

    try {
      const device = await dbGet(
        'SELECT * FROM registered_devices WHERE device_id = ?', 
        [deviceId]
      );

      if (!device) {
        return res.status(404).json({ 
          success: false, 
          error: 'Device not found' 
        });
      }

      // table_map_elements에서 실제 테이블 찾기
      // table_id가 element_id(정확한 ID)일 수도, text(표시 이름 "T1")일 수도 있음
      let resolvedTableId = table_id;
      let resolvedTableLabel = table_label || table_id;

      try {
        // 1) element_id로 직접 검색
        let tableRow = await dbGet(
          "SELECT id, text, type FROM table_map_elements WHERE id = ? AND type IN ('rounded-rectangle', 'circle')",
          [table_id]
        );

        if (!tableRow) {
          // 2) text(표시 이름)로 검색 — 태블릿에서 "T1" 입력한 경우
          tableRow = await dbGet(
            "SELECT id, text, type FROM table_map_elements WHERE UPPER(text) = UPPER(?) AND type IN ('rounded-rectangle', 'circle')",
            [table_id]
          );
        }

        if (tableRow) {
          resolvedTableId = tableRow.id;
          resolvedTableLabel = tableRow.text || table_label || table_id;
        }
      } catch (e) {
        // table_map_elements 테이블이 없으면 입력값 그대로 사용
      }

      // 해당 테이블에 이미 다른 디바이스가 배정되어 있는지 확인
      const existingAssignment = await dbGet(
        'SELECT * FROM registered_devices WHERE assigned_table_id = ? AND device_id != ?',
        [resolvedTableId, deviceId]
      );

      if (existingAssignment) {
        if (!force_replace) {
          return res.status(409).json({
            success: false,
            error: `Table ${resolvedTableLabel} is already assigned to device ${existingAssignment.device_name || existingAssignment.device_id}`,
            conflict: true,
            existing_device: {
              device_id: existingAssignment.device_id,
              device_name: existingAssignment.device_name
            }
          });
        }

        // force_replace: unassign the old device first
        const now2 = getLocalDatetimeString();
        await dbRun(`
          UPDATE registered_devices
          SET assigned_table_id = NULL,
              assigned_table_label = NULL,
              updated_at = ?
          WHERE device_id = ?
        `, [now2, existingAssignment.device_id]);

        console.log(`[devices] Force replaced: ${existingAssignment.device_id} unassigned from ${resolvedTableLabel}`);

        try {
          const io = req.app.get('io');
          if (io) {
            io.emit('device_unassigned', {
              device_id: existingAssignment.device_id,
              previous_table_id: resolvedTableId,
              reason: 'replaced'
            });
          }
        } catch (e) {}
      }

      // 테이블 배정
      const now = getLocalDatetimeString();
      await dbRun(`
        UPDATE registered_devices 
        SET assigned_table_id = ?,
            assigned_table_label = ?,
            status = 'active',
            updated_at = ?
        WHERE device_id = ?
      `, [resolvedTableId, resolvedTableLabel, now, deviceId]);

      const updated = await dbGet(
        'SELECT * FROM registered_devices WHERE device_id = ?', 
        [deviceId]
      );

      console.log(`[devices] 테이블 배정: ${deviceId} → ${table_id}`);

      // Socket.io로 디바이스에 알림
      try {
        const io = req.app.get('io');
        if (io) {
          io.emit('device_assigned', {
            device_id: deviceId,
            table_id,
            table_label: table_label || table_id
          });
        }
      } catch (e) {
        console.log('[devices] Socket.io notification failed');
      }

      res.json({
        success: true,
        message: `Device assigned to table ${table_id}`,
        device: updated
      });

    } catch (err) {
      console.error('[devices] Assign error:', err);
      res.status(500).json({ 
        success: false, 
        error: err.message 
      });
    }
  });

  // ==================== 테이블 배정 해제 ====================

  /**
   * DELETE /api/devices/:deviceId/assign
   * 디바이스의 테이블 배정 해제
   */
  router.delete('/:deviceId/assign', async (req, res) => {
    const { deviceId } = req.params;

    try {
      const device = await dbGet(
        'SELECT * FROM registered_devices WHERE device_id = ?', 
        [deviceId]
      );

      if (!device) {
        return res.status(404).json({ 
          success: false, 
          error: 'Device not found' 
        });
      }

      const previousTable = device.assigned_table_id;

      const now = getLocalDatetimeString();
      await dbRun(`
        UPDATE registered_devices 
        SET assigned_table_id = NULL,
            assigned_table_label = NULL,
            status = 'pending',
            updated_at = ?
        WHERE device_id = ?
      `, [now, deviceId]);

      console.log(`[devices] 테이블 배정 해제: ${deviceId} (was ${previousTable})`);

      // Socket.io로 디바이스에 알림
      try {
        const io = req.app.get('io');
        if (io) {
          io.emit('device_unassigned', {
            device_id: deviceId,
            previous_table_id: previousTable
          });
        }
      } catch (e) {
        console.log('[devices] Socket.io notification failed');
      }

      res.json({
        success: true,
        message: 'Table assignment removed',
        previous_table_id: previousTable
      });

    } catch (err) {
      console.error('[devices] Unassign error:', err);
      res.status(500).json({ 
        success: false, 
        error: err.message 
      });
    }
  });

  // ==================== Heartbeat API ====================

  /**
   * POST /api/devices/heartbeat
   * 디바이스 상태 업데이트 (주기적 호출)
   */
  router.post('/heartbeat', async (req, res) => {
    const { device_id, device_name, device_type, battery_level, is_charging, app_version, os_version, mac_address } = req.body;

    if (!device_id) {
      return res.status(400).json({ 
        success: false, 
        error: 'device_id is required' 
      });
    }

    // 토큰 검증
    const token = verifyToken(req);
    if (token) {
      const valid = await isValidToken(token);
      if (!valid) {
        return res.status(401).json({ success: false, error: 'Invalid or revoked token', revoked: true });
      }
    }

    try {
      const ipAddress = req.ip || req.connection.remoteAddress;
      const now = getLocalDatetimeString();

      // 디바이스 확인
      const device = await dbGet(
        'SELECT * FROM registered_devices WHERE device_id = ?', 
        [device_id]
      );

      if (!device) {
        // 미등록 디바이스면 자동 등록
        await dbRun(`
          INSERT INTO registered_devices (
            device_id, device_name, device_type, 
            battery_level, is_charging, app_version, os_version, mac_address,
            ip_address, status, last_seen_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
        `, [
          device_id,
          device_name || `Device-${device_id.slice(-6)}`,
          device_type || 'table_order',
          battery_level,
          is_charging ? 1 : 0,
          app_version,
          os_version,
          mac_address,
          ipAddress,
          now, now, now
        ]);

        console.log(`[devices] Heartbeat으로 자동 등록: ${device_id}`);

        return res.json({
          success: true,
          message: 'Device auto-registered via heartbeat',
          server_time: now,
          assigned_table_id: null,
          status: 'pending'
        });
      }

      // 기존 디바이스 업데이트
      await dbRun(`
        UPDATE registered_devices 
        SET device_name = COALESCE(?, device_name),
            device_type = COALESCE(?, device_type),
            battery_level = COALESCE(?, battery_level),
            is_charging = COALESCE(?, is_charging),
            app_version = COALESCE(?, app_version),
            os_version = COALESCE(?, os_version),
            mac_address = COALESCE(?, mac_address),
            ip_address = ?,
            last_seen_at = ?,
            updated_at = ?
        WHERE device_id = ?
      `, [
        device_name,
        device_type,
        battery_level,
        is_charging !== undefined ? (is_charging ? 1 : 0) : null,
        app_version,
        os_version,
        mac_address,
        ipAddress,
        now,
        now,
        device_id
      ]);

      res.json({
        success: true,
        server_time: now,
        assigned_table_id: device.assigned_table_id,
        assigned_table_label: device.assigned_table_label,
        status: device.status
      });

    } catch (err) {
      console.error('[devices] Heartbeat error:', err);
      res.status(500).json({ 
        success: false, 
        error: err.message 
      });
    }
  });

  // ==================== 디바이스 설정 조회 ====================

  /**
   * GET /api/devices/:deviceId/config
   * 디바이스가 필요한 설정 정보 조회
   */
  router.get('/:deviceId/config', async (req, res) => {
    const { deviceId } = req.params;

    // 토큰 검증
    const token = verifyToken(req);
    if (token) {
      const valid = await isValidToken(token);
      if (!valid) {
        return res.status(401).json({ success: false, error: 'Invalid or revoked token', revoked: true });
      }
    }

    try {
      const device = await dbGet(
        'SELECT * FROM registered_devices WHERE device_id = ?', 
        [deviceId]
      );

      if (!device) {
        return res.status(404).json({ 
          success: false, 
          error: 'Device not found' 
        });
      }

      // table-qr 채널에 설정된 메뉴 ID 조회
      let menuId = null;
      let menuName = null;
      try {
        const menuConfig = await dbGet(`
          SELECT menu_id, menu_name 
          FROM order_page_setups 
          WHERE order_type = 'table-qr'
          ORDER BY updated_at DESC, created_at DESC 
          LIMIT 1
        `);
        if (menuConfig) {
          menuId = menuConfig.menu_id;
          menuName = menuConfig.menu_name;
        }
      } catch (e) {
        console.log('[devices] order_page_setups query failed:', e.message);
      }

      // fallback: 첫 번째 메뉴
      if (!menuId) {
        const firstMenu = await dbGet('SELECT menu_id, name FROM menus ORDER BY menu_id LIMIT 1');
        if (firstMenu) {
          menuId = firstMenu.menu_id;
          menuName = firstMenu.name;
        }
      }

      // 비즈니스 프로필
      let businessName = '';
      try {
        const profile = await dbGet('SELECT business_name FROM business_profile LIMIT 1');
        businessName = profile?.business_name || '';
      } catch (e) {}

      // 테이블 오더 설정
      let tableOrderSettings = {};
      try {
        const settings = await dbGet(
          'SELECT * FROM table_order_settings WHERE store_id = ?', 
          [device.store_id || 'default']
        );
        tableOrderSettings = settings || {};
      } catch (e) {}

      res.json({
        success: true,
        config: {
          device_id: device.device_id,
          device_name: device.device_name,
          assigned_table_id: device.assigned_table_id,
          assigned_table_label: device.assigned_table_label,
          store_id: device.store_id || 'default',
          status: device.status,
          menu_id: menuId,
          menu_name: menuName,
          business_name: businessName,
          settings: {
            theme: tableOrderSettings.theme || 'light',
            language: tableOrderSettings.language || 'en',
            auto_kitchen_print: tableOrderSettings.auto_kitchen_print || 1,
            auto_accept_order: tableOrderSettings.auto_accept_order || 0
          }
        }
      });

    } catch (err) {
      console.error('[devices] Config error:', err);
      res.status(500).json({ 
        success: false, 
        error: err.message 
      });
    }
  });

  // ==================== 디바이스 정보 수정 ====================

  /**
   * PUT /api/devices/:deviceId
   * 디바이스 정보 수정 (이름 변경 등)
   */
  router.put('/:deviceId', async (req, res) => {
    const { deviceId } = req.params;
    const { device_name, store_id, status } = req.body;

    try {
      const device = await dbGet(
        'SELECT * FROM registered_devices WHERE device_id = ?', 
        [deviceId]
      );

      if (!device) {
        return res.status(404).json({ 
          success: false, 
          error: 'Device not found' 
        });
      }

      const now = getLocalDatetimeString();
      await dbRun(`
        UPDATE registered_devices 
        SET device_name = COALESCE(?, device_name),
            store_id = COALESCE(?, store_id),
            status = COALESCE(?, status),
            updated_at = ?
        WHERE device_id = ?
      `, [device_name, store_id, status, now, deviceId]);

      const updated = await dbGet(
        'SELECT * FROM registered_devices WHERE device_id = ?', 
        [deviceId]
      );

      res.json({
        success: true,
        message: 'Device updated',
        device: updated
      });

    } catch (err) {
      console.error('[devices] Update error:', err);
      res.status(500).json({ 
        success: false, 
        error: err.message 
      });
    }
  });

  // ==================== 디바이스 삭제 ====================

  /**
   * DELETE /api/devices/:deviceId
   * 디바이스 등록 해제 (삭제)
   */
  router.delete('/:deviceId', async (req, res) => {
    const { deviceId } = req.params;

    try {
      const device = await dbGet(
        'SELECT * FROM registered_devices WHERE device_id = ?', 
        [deviceId]
      );

      if (!device) {
        return res.status(404).json({ 
          success: false, 
          error: 'Device not found' 
        });
      }

      await dbRun('DELETE FROM registered_devices WHERE device_id = ?', [deviceId]);

      console.log(`[devices] 디바이스 삭제: ${deviceId}`);

      res.json({
        success: true,
        message: 'Device removed',
        deleted_device_id: deviceId
      });

    } catch (err) {
      console.error('[devices] Delete error:', err);
      res.status(500).json({ 
        success: false, 
        error: err.message 
      });
    }
  });

  // ==================== 미배정 테이블 목록 ====================

  /**
   * GET /api/devices/tables/unassigned
   * 아직 디바이스가 배정되지 않은 테이블 목록
   */
  router.get('/tables/unassigned', async (req, res) => {
    try {
      // table_map_elements에서 테이블 타입 요소 조회
      const allTables = await dbAll(`
        SELECT element_id, name, type 
        FROM table_map_elements 
        WHERE type IN ('rounded-rectangle', 'circle')
        ORDER BY name
      `);

      // 이미 배정된 테이블 ID 목록
      const assignedTables = await dbAll(`
        SELECT assigned_table_id 
        FROM registered_devices 
        WHERE assigned_table_id IS NOT NULL
      `);
      const assignedIds = new Set(assignedTables.map(t => t.assigned_table_id));

      // 미배정 테이블 필터링
      const unassignedTables = allTables.filter(t => 
        !assignedIds.has(t.element_id) && !assignedIds.has(t.name)
      );

      res.json({
        success: true,
        tables: unassignedTables
      });

    } catch (err) {
      console.error('[devices] Unassigned tables error:', err);
      res.status(500).json({ 
        success: false, 
        error: err.message 
      });
    }
  });

  // ==================== 통계 API ====================

  /**
   * GET /api/devices/stats
   * 디바이스 상태 통계
   */
  router.get('/stats/summary', async (req, res) => {
    try {
      const total = await dbGet('SELECT COUNT(*) as count FROM registered_devices');
      const assigned = await dbGet('SELECT COUNT(*) as count FROM registered_devices WHERE assigned_table_id IS NOT NULL');
      const pending = await dbGet('SELECT COUNT(*) as count FROM registered_devices WHERE status = ?', ['pending']);
      
      // 온라인 디바이스 수 (60초 이내)
      const onlineThreshold = getLocalDatetimeString(new Date(Date.now() - 60000));
      const online = await dbGet(
        'SELECT COUNT(*) as count FROM registered_devices WHERE last_seen_at > ?', 
        [onlineThreshold]
      );

      // 배터리 부족 디바이스 (20% 미만)
      const lowBattery = await dbGet(
        'SELECT COUNT(*) as count FROM registered_devices WHERE battery_level IS NOT NULL AND battery_level < 20'
      );

      res.json({
        success: true,
        stats: {
          total: total.count,
          assigned: assigned.count,
          unassigned: total.count - assigned.count,
          pending: pending.count,
          online: online.count,
          offline: total.count - online.count,
          low_battery: lowBattery.count
        }
      });

    } catch (err) {
      console.error('[devices] Stats error:', err);
      res.status(500).json({ 
        success: false, 
        error: err.message 
      });
    }
  });

  return router;
};
















