// backend/services/idMapperService.js
// 통합 ID 매핑 서비스 - SQLite, Firebase, 3rd Party ID 간 변환

const { v4: uuidv4 } = require('uuid');

// 공유 데이터베이스 모듈 사용 (환경 변수 DB_PATH 지원)
const { db, dbRun, dbAll, dbGet } = require('../db');

// 테이블 자동 생성 (없으면 생성) + UNIQUE 인덱스 마이그레이션
let tableEnsured = false;
async function ensureTable() {
  if (tableEnsured) return;
  try {
    await dbRun(`CREATE TABLE IF NOT EXISTS id_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      local_id TEXT NOT NULL,
      firebase_id TEXT,
      uuid TEXT NOT NULL,
      external_ids TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(entity_type, local_id)
    )`);

    // 기존 테이블에 UNIQUE 인덱스가 없는 경우 추가 (마이그레이션)
    try {
      await dbRun(`CREATE UNIQUE INDEX IF NOT EXISTS idx_id_mappings_entity_local
        ON id_mappings(entity_type, local_id)`);
    } catch (idxErr) {
      // 중복 데이터가 있으면 정리 후 재시도
      if (idxErr.message && idxErr.message.includes('UNIQUE')) {
        console.log('[IdMapperService] Cleaning duplicate mappings before creating index...');
        await dbRun(`DELETE FROM id_mappings WHERE id NOT IN (
          SELECT MIN(id) FROM id_mappings GROUP BY entity_type, local_id
        )`);
        await dbRun(`CREATE UNIQUE INDEX IF NOT EXISTS idx_id_mappings_entity_local
          ON id_mappings(entity_type, local_id)`).catch(() => {});
      }
    }

    tableEnsured = true;
  } catch (e) {
    console.error('[IdMapperService] Failed to ensure table:', e.message);
  }
}

/**
 * ID Mapper Service
 * - UUID를 기반으로 다양한 시스템의 ID를 관리
 * - SQLite local_id, Firebase doc_id, 3rd Party external_id 변환
 */
class IdMapperService {
  
  /**
   * 새 매핑 생성 (엔티티 생성 시 호출)
   * @param {string} entityType - 'menu_item', 'category', 'modifier_group' 등
   * @param {string|number} localId - SQLite의 로컬 ID
   * @param {string} firebaseId - Firebase Document ID (optional)
   * @returns {Promise<{uuid: string, mapping: object}>}
   */
  async createMapping(entityType, localId, firebaseId = null) {
    await ensureTable();
    const uuid = uuidv4();
    
    await dbRun(
      `INSERT INTO id_mappings (entity_type, local_id, firebase_id, uuid, external_ids)
       VALUES (?, ?, ?, ?, '{}')
       ON CONFLICT(entity_type, local_id) DO UPDATE SET
         firebase_id = COALESCE(excluded.firebase_id, id_mappings.firebase_id),
         updated_at = CURRENT_TIMESTAMP`,
      [entityType, String(localId), firebaseId, uuid]
    );
    
    return { uuid, entityType, localId: String(localId), firebaseId };
  }
  
  /**
   * Firebase ID 업데이트 (Firebase 동기화 후 호출)
   * @param {string} entityType
   * @param {string|number} localId
   * @param {string} firebaseId
   */
  async updateFirebaseId(entityType, localId, firebaseId) {
    await ensureTable();
    await dbRun(
      `UPDATE id_mappings 
       SET firebase_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE entity_type = ? AND local_id = ?`,
      [firebaseId, entityType, String(localId)]
    );
  }
  
  /**
   * External ID 추가/업데이트 (3rd Party 연동 시)
   * @param {string} entityType
   * @param {string} uuid
   * @param {string} provider - 'doordash', 'skip', 'ubereats' 등
   * @param {string} externalId
   */
  async setExternalId(entityType, uuid, provider, externalId) {
    const mapping = await this.getByUUID(uuid);
    if (!mapping) {
      throw new Error(`Mapping not found for UUID: ${uuid}`);
    }
    
    const externalIds = JSON.parse(mapping.external_ids || '{}');
    externalIds[provider] = externalId;
    
    await dbRun(
      `UPDATE id_mappings 
       SET external_ids = ?, updated_at = CURRENT_TIMESTAMP
       WHERE uuid = ?`,
      [JSON.stringify(externalIds), uuid]
    );
  }
  
  /**
   * UUID로 매핑 조회
   * @param {string} uuid
   * @returns {Promise<object|null>}
   */
  async getByUUID(uuid) {
    await ensureTable();
    const mapping = await dbGet(
      'SELECT * FROM id_mappings WHERE uuid = ?',
      [uuid]
    );
    
    if (mapping && mapping.external_ids) {
      mapping.external_ids = JSON.parse(mapping.external_ids);
    }
    
    return mapping;
  }
  
  /**
   * Local ID로 매핑 조회
   * @param {string} entityType
   * @param {string|number} localId
   * @returns {Promise<object|null>}
   */
  async getByLocalId(entityType, localId) {
    await ensureTable();
    const mapping = await dbGet(
      'SELECT * FROM id_mappings WHERE entity_type = ? AND local_id = ?',
      [entityType, String(localId)]
    );
    
    if (mapping && mapping.external_ids) {
      mapping.external_ids = JSON.parse(mapping.external_ids);
    }
    
    return mapping;
  }
  
  /**
   * Firebase ID로 매핑 조회
   * @param {string} entityType
   * @param {string} firebaseId
   * @returns {Promise<object|null>}
   */
  async getByFirebaseId(entityType, firebaseId) {
    await ensureTable();
    const mapping = await dbGet(
      'SELECT * FROM id_mappings WHERE entity_type = ? AND firebase_id = ?',
      [entityType, firebaseId]
    );
    
    if (mapping && mapping.external_ids) {
      mapping.external_ids = JSON.parse(mapping.external_ids);
    }
    
    return mapping;
  }
  
  /**
   * External ID로 매핑 조회
   * @param {string} entityType
   * @param {string} provider
   * @param {string} externalId
   * @returns {Promise<object|null>}
   */
  async getByExternalId(entityType, provider, externalId) {
    await ensureTable();
    const mappings = await dbAll(
      'SELECT * FROM id_mappings WHERE entity_type = ?',
      [entityType]
    );
    
    for (const mapping of mappings) {
      const externalIds = JSON.parse(mapping.external_ids || '{}');
      if (externalIds[provider] === externalId) {
        mapping.external_ids = externalIds;
        return mapping;
      }
    }
    
    return null;
  }
  
  // ==========================================
  // 편의 변환 메서드
  // ==========================================
  
  /**
   * Local ID → UUID
   */
  async localToUUID(entityType, localId) {
    const mapping = await this.getByLocalId(entityType, localId);
    return mapping?.uuid || null;
  }
  
  /**
   * UUID → Local ID
   */
  async uuidToLocal(uuid) {
    const mapping = await this.getByUUID(uuid);
    return mapping?.local_id || null;
  }
  
  /**
   * Local ID → Firebase ID
   */
  async localToFirebase(entityType, localId) {
    const mapping = await this.getByLocalId(entityType, localId);
    return mapping?.firebase_id || null;
  }
  
  /**
   * Firebase ID → Local ID
   */
  async firebaseToLocal(entityType, firebaseId) {
    const mapping = await this.getByFirebaseId(entityType, firebaseId);
    return mapping?.local_id || null;
  }
  
  /**
   * UUID → External ID
   */
  async uuidToExternal(uuid, provider) {
    const mapping = await this.getByUUID(uuid);
    return mapping?.external_ids?.[provider] || null;
  }
  
  /**
   * External ID → UUID
   */
  async externalToUUID(entityType, provider, externalId) {
    const mapping = await this.getByExternalId(entityType, provider, externalId);
    return mapping?.uuid || null;
  }
  
  // ==========================================
  // 벌크 작업
  // ==========================================
  
  /**
   * 여러 Local ID를 UUID로 일괄 변환
   * @param {string} entityType
   * @param {Array<string|number>} localIds
   * @returns {Promise<Object>} - { localId: uuid, ... }
   */
  async bulkLocalToUUID(entityType, localIds) {
    const result = {};
    const placeholders = localIds.map(() => '?').join(',');
    
    const mappings = await dbAll(
      `SELECT local_id, uuid FROM id_mappings 
       WHERE entity_type = ? AND local_id IN (${placeholders})`,
      [entityType, ...localIds.map(String)]
    );
    
    for (const mapping of mappings) {
      result[mapping.local_id] = mapping.uuid;
    }
    
    return result;
  }
  
  /**
   * 타입별 전체 매핑 조회
   * @param {string} entityType
   * @returns {Promise<Array>}
   */
  async getAllByType(entityType) {
    const mappings = await dbAll(
      'SELECT * FROM id_mappings WHERE entity_type = ?',
      [entityType]
    );
    
    return mappings.map(m => ({
      ...m,
      external_ids: JSON.parse(m.external_ids || '{}')
    }));
  }
  
  /**
   * 매핑 삭제
   * @param {string} uuid
   */
  async deleteMapping(uuid) {
    await dbRun('DELETE FROM id_mappings WHERE uuid = ?', [uuid]);
  }
  
  /**
   * 통계 조회
   */
  async getStats() {
    const stats = await dbAll(
      `SELECT 
         entity_type,
         COUNT(*) as total,
         SUM(CASE WHEN firebase_id IS NOT NULL THEN 1 ELSE 0 END) as with_firebase,
         SUM(CASE WHEN external_ids != '{}' THEN 1 ELSE 0 END) as with_external
       FROM id_mappings
       GROUP BY entity_type`
    );
    
    return stats;
  }
  
  // ==========================================
  // 자동 매핑 생성
  // ==========================================
  
  /**
   * 매핑이 없으면 자동 생성 (getOrCreate 패턴)
   * @param {string} entityType
   * @param {string|number} localId
   * @param {string} firebaseId - optional
   * @returns {Promise<object>}
   */
  async ensureMapping(entityType, localId, firebaseId = null) {
    let mapping = await this.getByLocalId(entityType, localId);
    
    if (!mapping) {
      // 새 매핑 생성
      const result = await this.createMapping(entityType, localId, firebaseId);
      mapping = {
        uuid: result.uuid,
        entity_type: entityType,
        local_id: String(localId),
        firebase_id: firebaseId,
        external_ids: {}
      };
      console.log(`  📌 UUID 생성: ${entityType}/${localId} → ${result.uuid.substring(0, 8)}...`);
    } else if (firebaseId && !mapping.firebase_id) {
      // Firebase ID만 업데이트
      await this.updateFirebaseId(entityType, localId, firebaseId);
      mapping.firebase_id = firebaseId;
    }
    
    return mapping;
  }
  
  /**
   * 기존 항목들에 대한 매핑 일괄 생성
   * (동기화 전 호출하여 모든 항목이 UUID를 갖도록 보장)
   * @returns {Promise<object>}
   */
  async syncExistingItems() {
    await ensureTable();
    const results = {
      menu_item: 0,
      category: 0,
      modifier_group: 0,
      tax_group: 0,
      printer_group: 0,
      errors: []
    };
    
    console.log('🔄 기존 항목 UUID 매핑 생성 중...');
    
    // 1. Menu Items
    try {
      const items = await dbAll('SELECT item_id, firebase_id FROM menu_items');
      for (const item of items) {
        const existing = await this.getByLocalId('menu_item', item.item_id);
        if (!existing) {
          await this.createMapping('menu_item', item.item_id, item.firebase_id);
          results.menu_item++;
        }
      }
    } catch (e) {
      results.errors.push({ type: 'menu_item', error: e.message });
    }
    
    // 2. Categories
    try {
      const cats = await dbAll('SELECT category_id, firebase_id FROM menu_categories');
      for (const cat of cats) {
        const existing = await this.getByLocalId('category', cat.category_id);
        if (!existing) {
          await this.createMapping('category', cat.category_id, cat.firebase_id);
          results.category++;
        }
      }
    } catch (e) {
      results.errors.push({ type: 'category', error: e.message });
    }
    
    // 3. Modifier Groups
    try {
      const groups = await dbAll('SELECT modifier_group_id FROM modifier_groups WHERE is_deleted = 0');
      for (const group of groups) {
        const existing = await this.getByLocalId('modifier_group', group.modifier_group_id);
        if (!existing) {
          await this.createMapping('modifier_group', group.modifier_group_id, null);
          results.modifier_group++;
        }
      }
    } catch (e) {
      results.errors.push({ type: 'modifier_group', error: e.message });
    }
    
    // 4. Tax Groups
    try {
      const taxes = await dbAll('SELECT tax_group_id FROM tax_groups WHERE is_deleted = 0');
      for (const tax of taxes) {
        const existing = await this.getByLocalId('tax_group', tax.tax_group_id);
        if (!existing) {
          await this.createMapping('tax_group', tax.tax_group_id, null);
          results.tax_group++;
        }
      }
    } catch (e) {
      results.errors.push({ type: 'tax_group', error: e.message });
    }
    
    // 5. Printer Groups
    try {
      const printers = await dbAll('SELECT printer_group_id FROM printer_groups WHERE is_active = 1');
      for (const printer of printers) {
        const existing = await this.getByLocalId('printer_group', printer.printer_group_id);
        if (!existing) {
          await this.createMapping('printer_group', printer.printer_group_id, null);
          results.printer_group++;
        }
      }
    } catch (e) {
      results.errors.push({ type: 'printer_group', error: e.message });
    }
    
    const total = results.menu_item + results.category + results.modifier_group + 
                  results.tax_group + results.printer_group;
    
    console.log(`✅ UUID 매핑 생성 완료: ${total}개`);
    console.log(`   - Menu Items: ${results.menu_item}`);
    console.log(`   - Categories: ${results.category}`);
    console.log(`   - Modifier Groups: ${results.modifier_group}`);
    console.log(`   - Tax Groups: ${results.tax_group}`);
    console.log(`   - Printer Groups: ${results.printer_group}`);
    
    return results;
  }
}

// 싱글톤 인스턴스
const idMapperService = new IdMapperService();

module.exports = idMapperService;
