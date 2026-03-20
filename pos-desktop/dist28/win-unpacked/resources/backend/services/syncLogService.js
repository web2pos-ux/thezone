// backend/services/syncLogService.js
// 동기화 로그 서비스 - 모든 동기화 작업 이력 관리

const { v4: uuidv4 } = require('uuid');

// 공유 데이터베이스 모듈 사용 (환경 변수 DB_PATH 지원)
const sharedDb = require('../db');

// 래퍼 함수들 - 공유 DB 사용 (절대 close하면 안 됨)
const dbRun = (db, sql, params = []) => sharedDb.dbRun(sql, params);
const dbGet = (db, sql, params = []) => sharedDb.dbGet(sql, params);
const dbAll = (db, sql, params = []) => sharedDb.dbAll(sql, params);

// 테이블 자동 생성 (없으면 생성)
let tablesEnsured = false;
async function ensureTables() {
  if (tablesEnsured) return;
  try {
    await sharedDb.dbRun(`CREATE TABLE IF NOT EXISTS sync_logs (
      sync_id TEXT PRIMARY KEY,
      sync_type TEXT NOT NULL,
      direction TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      status TEXT DEFAULT 'running',
      total_items INTEGER DEFAULT 0,
      created_count INTEGER DEFAULT 0,
      updated_count INTEGER DEFAULT 0,
      deleted_count INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      errors TEXT,
      initiated_by TEXT,
      employee_id TEXT,
      device_id TEXT
    )`);
    await sharedDb.dbRun(`CREATE TABLE IF NOT EXISTS sync_log_details (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_id TEXT NOT NULL,
      entity_type TEXT,
      local_id TEXT,
      firebase_id TEXT,
      action TEXT,
      status TEXT,
      old_data TEXT,
      new_data TEXT,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (sync_id) REFERENCES sync_logs(sync_id)
    )`);
    tablesEnsured = true;
  } catch (e) {
    console.error('[SyncLogService] Failed to ensure tables:', e.message);
  }
}

/**
 * 동기화 상태 상수
 */
const SYNC_STATUS = {
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  PARTIAL: 'partial'
};

/**
 * 동기화 방향 상수
 */
const SYNC_DIRECTION = {
  UPLOAD: 'upload',      // POS → Firebase
  DOWNLOAD: 'download',  // Firebase → POS
  BIDIRECTIONAL: 'bidirectional'
};

/**
 * 동기화 타입 상수
 */
const SYNC_TYPE = {
  FULL: 'full',
  INCREMENTAL: 'incremental',
  SINGLE: 'single'
};

/**
 * 동기화 로그 서비스 클래스
 */
class SyncLogService {
  
  /**
   * 새 동기화 세션 시작
   * @param {object} options - 동기화 옵션
   * @returns {Promise<string>} - sync_id
   */
  static async startSync(options) {
    const {
      syncType = SYNC_TYPE.FULL,
      direction = SYNC_DIRECTION.UPLOAD,
      entityType = 'all',
      initiatedBy = 'user',
      employeeId = null,
      deviceId = null
    } = options;
    
    await ensureTables();
    const syncId = uuidv4();
    
    await dbRun(null,
      `INSERT INTO sync_logs 
       (sync_id, sync_type, direction, entity_type, started_at, status, initiated_by, employee_id, device_id)
       VALUES (?, ?, ?, ?, datetime('now'), ?, ?, ?, ?)`,
      [syncId, syncType, direction, entityType, SYNC_STATUS.RUNNING, initiatedBy, employeeId, deviceId]
    );
    
    console.log(`🔄 동기화 시작: ${syncId.substring(0, 8)}... (${direction} ${entityType})`);
    return syncId;
  }
  
  /**
   * 동기화 완료 처리
   * @param {string} syncId - 동기화 ID
   * @param {object} results - 결과 통계
   */
  static async completeSync(syncId, results = {}) {
    const {
      status = SYNC_STATUS.COMPLETED,
      totalItems = 0,
      createdCount = 0,
      updatedCount = 0,
      deletedCount = 0,
      errorCount = 0,
      errors = null
    } = results;
    
    await ensureTables();
    await dbRun(null,
      `UPDATE sync_logs SET
       completed_at = datetime('now'),
       status = ?,
       total_items = ?,
       created_count = ?,
       updated_count = ?,
       deleted_count = ?,
       error_count = ?,
       errors = ?
       WHERE sync_id = ?`,
      [status, totalItems, createdCount, updatedCount, deletedCount, errorCount, 
       errors ? JSON.stringify(errors) : null, syncId]
    );
    
    console.log(`✅ 동기화 완료: ${syncId.substring(0, 8)}... (${status})`);
  }
  
  /**
   * 동기화 실패 처리
   * @param {string} syncId - 동기화 ID
   * @param {Error|string} error - 에러 정보
   */
  static async failSync(syncId, error) {
    await ensureTables();
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    await dbRun(null,
      `UPDATE sync_logs SET
       completed_at = datetime('now'),
       status = ?,
       errors = ?
       WHERE sync_id = ?`,
      [SYNC_STATUS.FAILED, JSON.stringify([{ message: errorMessage }]), syncId]
    );
    
    console.log(`❌ 동기화 실패: ${syncId.substring(0, 8)}... - ${errorMessage}`);
  }
  
  /**
   * 개별 항목 로그 추가
   * @param {string} syncId - 동기화 ID
   * @param {object} detail - 상세 정보
   */
  static async logDetail(syncId, detail) {
    const {
      entityType,
      localId = null,
      firebaseId = null,
      action,       // 'create', 'update', 'delete', 'skip'
      status,       // 'success', 'failed', 'conflict'
      oldData = null,
      newData = null,
      errorMessage = null
    } = detail;
    
    await ensureTables();
    await dbRun(null,
      `INSERT INTO sync_log_details
       (sync_id, entity_type, local_id, firebase_id, action, status, old_data, new_data, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [syncId, entityType, localId, firebaseId, action, status,
       oldData ? JSON.stringify(oldData) : null,
       newData ? JSON.stringify(newData) : null,
       errorMessage]
    );
  }
  
  /**
   * 최근 동기화 이력 조회
   * @param {number} limit - 조회 개수
   */
  static async getRecentLogs(limit = 10) {
    await ensureTables();
    const logs = await dbAll(null,
      `SELECT * FROM sync_logs ORDER BY started_at DESC LIMIT ?`,
      [limit]
    );
    
    return logs.map(log => ({
      ...log,
      errors: log.errors ? JSON.parse(log.errors) : null
    }));
  }
  
  /**
   * 특정 동기화 세션 상세 조회
   * @param {string} syncId - 동기화 ID
   */
  static async getSyncDetails(syncId) {
    await ensureTables();
    const log = await dbGet(null,
      'SELECT * FROM sync_logs WHERE sync_id = ?',
      [syncId]
    );
    
    if (!log) return null;
    
    const details = await dbAll(null,
      'SELECT * FROM sync_log_details WHERE sync_id = ? ORDER BY created_at',
      [syncId]
    );
    
    return {
      ...log,
      errors: log.errors ? JSON.parse(log.errors) : null,
      details: details.map(d => ({
        ...d,
        oldData: d.old_data ? JSON.parse(d.old_data) : null,
        newData: d.new_data ? JSON.parse(d.new_data) : null
      }))
    };
  }
  
  /**
   * 동기화 통계 조회
   */
  static async getStats() {
    await ensureTables();
    const stats = await dbGet(null, `
      SELECT
        COUNT(*) as total_syncs,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as successful,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END) as partial,
        SUM(created_count) as total_created,
        SUM(updated_count) as total_updated,
        SUM(deleted_count) as total_deleted,
        SUM(error_count) as total_errors
      FROM sync_logs
    `);
    
    const recentByType = await dbAll(null, `
      SELECT entity_type, direction, COUNT(*) as count,
             MAX(started_at) as last_sync
      FROM sync_logs
      GROUP BY entity_type, direction
      ORDER BY last_sync DESC
    `);
    
    return { stats, recentByType };
  }
  
  /**
   * 오래된 로그 정리 (기본 30일)
   * @param {number} daysToKeep - 보관 일수
   */
  static async cleanup(daysToKeep = 30) {
    await ensureTables();
    // 먼저 상세 로그 삭제
    await dbRun(null,
      `DELETE FROM sync_log_details 
       WHERE sync_id IN (
         SELECT sync_id FROM sync_logs 
         WHERE started_at < datetime('now', '-' || ? || ' days')
       )`,
      [daysToKeep]
    );
    
    // 그 다음 메인 로그 삭제
    const result = await dbRun(null,
      `DELETE FROM sync_logs WHERE started_at < datetime('now', '-' || ? || ' days')`,
      [daysToKeep]
    );
    
    console.log(`🧹 ${result.changes || 0}개의 오래된 로그 정리됨`);
    return result.changes || 0;
  }
}

module.exports = {
  SyncLogService,
  SYNC_STATUS,
  SYNC_DIRECTION,
  SYNC_TYPE
};

