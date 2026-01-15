// backend/services/syncLogService.js
// 동기화 로그 서비스 - 모든 동기화 작업 이력 관리

const { v4: uuidv4 } = require('uuid');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.resolve(__dirname, '..', '..', 'db', 'web2pos.db');

const getDb = () => new sqlite3.Database(dbPath);

const dbRun = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function(err) {
    if (err) reject(err);
    else resolve(this);
  });
});

const dbGet = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => {
    if (err) reject(err);
    else resolve(row);
  });
});

const dbAll = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) reject(err);
    else resolve(rows);
  });
});

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
    
    const db = getDb();
    const syncId = uuidv4();
    
    try {
      await dbRun(db,
        `INSERT INTO sync_logs 
         (sync_id, sync_type, direction, entity_type, started_at, status, initiated_by, employee_id, device_id)
         VALUES (?, ?, ?, ?, datetime('now'), ?, ?, ?, ?)`,
        [syncId, syncType, direction, entityType, SYNC_STATUS.RUNNING, initiatedBy, employeeId, deviceId]
      );
      
      console.log(`🔄 동기화 시작: ${syncId.substring(0, 8)}... (${direction} ${entityType})`);
      return syncId;
    } finally {
      db.close();
    }
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
    
    const db = getDb();
    try {
      await dbRun(db,
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
    } finally {
      db.close();
    }
  }
  
  /**
   * 동기화 실패 처리
   * @param {string} syncId - 동기화 ID
   * @param {Error|string} error - 에러 정보
   */
  static async failSync(syncId, error) {
    const db = getDb();
    try {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      await dbRun(db,
        `UPDATE sync_logs SET
         completed_at = datetime('now'),
         status = ?,
         errors = ?
         WHERE sync_id = ?`,
        [SYNC_STATUS.FAILED, JSON.stringify([{ message: errorMessage }]), syncId]
      );
      
      console.log(`❌ 동기화 실패: ${syncId.substring(0, 8)}... - ${errorMessage}`);
    } finally {
      db.close();
    }
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
    
    const db = getDb();
    try {
      await dbRun(db,
        `INSERT INTO sync_log_details
         (sync_id, entity_type, local_id, firebase_id, action, status, old_data, new_data, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [syncId, entityType, localId, firebaseId, action, status,
         oldData ? JSON.stringify(oldData) : null,
         newData ? JSON.stringify(newData) : null,
         errorMessage]
      );
    } finally {
      db.close();
    }
  }
  
  /**
   * 최근 동기화 이력 조회
   * @param {number} limit - 조회 개수
   */
  static async getRecentLogs(limit = 10) {
    const db = getDb();
    try {
      const logs = await dbAll(db,
        `SELECT * FROM sync_logs ORDER BY started_at DESC LIMIT ?`,
        [limit]
      );
      
      return logs.map(log => ({
        ...log,
        errors: log.errors ? JSON.parse(log.errors) : null
      }));
    } finally {
      db.close();
    }
  }
  
  /**
   * 특정 동기화 세션 상세 조회
   * @param {string} syncId - 동기화 ID
   */
  static async getSyncDetails(syncId) {
    const db = getDb();
    try {
      const log = await dbGet(db,
        'SELECT * FROM sync_logs WHERE sync_id = ?',
        [syncId]
      );
      
      if (!log) return null;
      
      const details = await dbAll(db,
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
    } finally {
      db.close();
    }
  }
  
  /**
   * 동기화 통계 조회
   */
  static async getStats() {
    const db = getDb();
    try {
      const stats = await dbGet(db, `
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
      
      const recentByType = await dbAll(db, `
        SELECT entity_type, direction, COUNT(*) as count,
               MAX(started_at) as last_sync
        FROM sync_logs
        GROUP BY entity_type, direction
        ORDER BY last_sync DESC
      `);
      
      return { stats, recentByType };
    } finally {
      db.close();
    }
  }
  
  /**
   * 오래된 로그 정리 (기본 30일)
   * @param {number} daysToKeep - 보관 일수
   */
  static async cleanup(daysToKeep = 30) {
    const db = getDb();
    try {
      // 먼저 상세 로그 삭제
      await dbRun(db,
        `DELETE FROM sync_log_details 
         WHERE sync_id IN (
           SELECT sync_id FROM sync_logs 
           WHERE started_at < datetime('now', '-' || ? || ' days')
         )`,
        [daysToKeep]
      );
      
      // 그 다음 메인 로그 삭제
      const result = await dbRun(db,
        `DELETE FROM sync_logs WHERE started_at < datetime('now', '-' || ? || ' days')`,
        [daysToKeep]
      );
      
      console.log(`🧹 ${result.changes || 0}개의 오래된 로그 정리됨`);
      return result.changes || 0;
    } finally {
      db.close();
    }
  }
}

module.exports = {
  SyncLogService,
  SYNC_STATUS,
  SYNC_DIRECTION,
  SYNC_TYPE
};

