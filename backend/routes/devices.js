/**
 * 디바이스 관리 API
 * 테이블 오더 태블릿 등록, 배정, 상태 모니터링
 */

const express = require('express');
const router = express.Router();

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

    // 인덱스 생성
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_devices_status ON registered_devices(status)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_devices_table ON registered_devices(assigned_table_id)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON registered_devices(last_seen_at)`);

    console.log('[devices] registered_devices 테이블 초기화 완료');
  };

  initTables().catch(err => console.error('Failed to init registered_devices table:', err));

  /**
   * GET /api/devices/health
   * 테이블 디바이스가 "주문 가능"인지 판단하기 위한 헬스체크
   * - POS 서버 응답 OK
   * - 주방 프린터(설정)가 준비되었는지(최소 구성 체크)
   */
  router.get('/health', async (req, res) => {
    try {
      // 1) 주방 프린터가 최소 1개 이상 설정되어 있는지 확인
      let kitchenPrintersCount = 0;
      try {
        const row = await dbGet(
          `SELECT COUNT(1) AS cnt
           FROM printers
           WHERE is_active = 1 AND UPPER(type) = 'KITCHEN'`
        );
        kitchenPrintersCount = Number(row?.cnt || 0);
      } catch {}

      // 2) 주방 프린터가 어떤 그룹에라도 연결되어 있는지 확인 (실제 라우팅 가능성)
      let kitchenPrinterLinked = false;
      try {
        const row = await dbGet(
          `SELECT 1 AS ok
           FROM printer_group_links pgl
           JOIN printer_groups pg ON pg.id = pgl.group_id AND pg.is_active = 1
           JOIN printers p ON p.id = pgl.printer_id AND p.is_active = 1 AND UPPER(p.type) = 'KITCHEN'
           LIMIT 1`
        );
        kitchenPrinterLinked = !!row?.ok;
      } catch {}

      const kitchenPrinterReady = kitchenPrintersCount > 0 && kitchenPrinterLinked;

      const message = kitchenPrinterReady
        ? 'OK'
        : kitchenPrintersCount === 0
          ? '주방 프린터가 설정되지 않았습니다. (Kitchen printer not configured)'
          : '주방 프린터가 프린터 그룹에 연결되지 않았습니다. (Kitchen printer not linked to a group)';

      res.json({
        success: true,
        server_time: new Date().toISOString(),
        posReady: true,
        kitchenPrinter: {
          ready: kitchenPrinterReady,
          printersCount: kitchenPrintersCount,
          linked: kitchenPrinterLinked
        },
        tableOrderEnabled: kitchenPrinterReady,
        message
      });
    } catch (err) {
      console.error('[devices] health error:', err);
      res.status(500).json({
        success: false,
        posReady: true,
        kitchenPrinter: { ready: false },
        tableOrderEnabled: false,
        error: 'Health check failed'
      });
    }
  });

  // ==================== 디바이스 등록 API ====================

  /**
   * POST /api/devices/register
   * 새 디바이스 등록 또는 기존 디바이스 재등록
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

    try {
      const ipAddress = req.ip || req.connection.remoteAddress;
      const now = new Date().toISOString();

      // 기존 디바이스 확인
      const existing = await dbGet(
        'SELECT * FROM registered_devices WHERE device_id = ?', 
        [device_id]
      );

      if (existing) {
        // 기존 디바이스 업데이트 (재연결)
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

      // 새 디바이스 등록
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

      // Socket.io로 POS에 알림
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
    const { table_id, table_label } = req.body;

    if (!table_id) {
      return res.status(400).json({ 
        success: false, 
        error: 'table_id is required' 
      });
    }

    try {
      // 디바이스 존재 확인
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

      // 해당 테이블에 이미 다른 디바이스가 배정되어 있는지 확인
      const existingAssignment = await dbGet(
        'SELECT * FROM registered_devices WHERE assigned_table_id = ? AND device_id != ?',
        [table_id, deviceId]
      );

      if (existingAssignment) {
        return res.status(409).json({
          success: false,
          error: `Table ${table_id} is already assigned to device ${existingAssignment.device_name || existingAssignment.device_id}`,
          existing_device: {
            device_id: existingAssignment.device_id,
            device_name: existingAssignment.device_name
          }
        });
      }

      // 테이블 배정
      const now = new Date().toISOString();
      await dbRun(`
        UPDATE registered_devices 
        SET assigned_table_id = ?,
            assigned_table_label = ?,
            status = 'active',
            updated_at = ?
        WHERE device_id = ?
      `, [table_id, table_label || table_id, now, deviceId]);

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

      const now = new Date().toISOString();
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
    const { device_id, battery_level, is_charging, app_version } = req.body;

    if (!device_id) {
      return res.status(400).json({ 
        success: false, 
        error: 'device_id is required' 
      });
    }

    try {
      const ipAddress = req.ip || req.connection.remoteAddress;
      const now = new Date().toISOString();

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
            battery_level, is_charging, app_version,
            ip_address, status, last_seen_at, created_at, updated_at
          ) VALUES (?, ?, 'table_order', ?, ?, ?, ?, 'pending', ?, ?, ?)
        `, [
          device_id,
          `Device-${device_id.slice(-6)}`,
          battery_level,
          is_charging ? 1 : 0,
          app_version,
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
        SET battery_level = COALESCE(?, battery_level),
            is_charging = COALESCE(?, is_charging),
            app_version = COALESCE(?, app_version),
            ip_address = ?,
            last_seen_at = ?,
            updated_at = ?
        WHERE device_id = ?
      `, [
        battery_level,
        is_charging !== undefined ? (is_charging ? 1 : 0) : null,
        app_version,
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

      const now = new Date().toISOString();
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
      const onlineThreshold = new Date(Date.now() - 60000).toISOString();
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
















