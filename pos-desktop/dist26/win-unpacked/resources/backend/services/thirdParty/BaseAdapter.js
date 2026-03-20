// backend/services/thirdParty/BaseAdapter.js
// 3rd Party 연동을 위한 기본 어댑터 인터페이스

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { IdMapperService, ENTITY_TYPES } = require('../idMapperService');

const dbPath = path.resolve(__dirname, '..', '..', '..', 'db', 'web2pos.db');

/**
 * 3rd Party 어댑터 기본 클래스
 * 새로운 3rd Party 연동 시 이 클래스를 상속받아 구현
 */
class BaseAdapter {
  constructor(config = {}) {
    this.provider = '';     // 'doordash', 'skip', 'ubereats' 등
    this.storeId = config.storeId || null;
    this.apiKey = config.apiKey || null;
    this.apiSecret = config.apiSecret || null;
    this.baseUrl = '';
    this.isActive = true;
  }
  
  /**
   * 설정 저장
   */
  async saveConfig() {
    const db = new sqlite3.Database(dbPath);
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT OR REPLACE INTO third_party_integrations 
         (provider, store_id, api_key, api_secret, is_active, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`,
        [this.provider, this.storeId, this.apiKey, this.apiSecret, this.isActive ? 1 : 0],
        function(err) {
          db.close();
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }
  
  /**
   * 설정 로드
   */
  async loadConfig() {
    const db = new sqlite3.Database(dbPath);
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM third_party_integrations WHERE provider = ?',
        [this.provider],
        (err, row) => {
          db.close();
          if (err) reject(err);
          else {
            if (row) {
              this.storeId = row.store_id;
              this.apiKey = row.api_key;
              this.apiSecret = row.api_secret;
              this.isActive = row.is_active === 1;
            }
            resolve(row);
          }
        }
      );
    });
  }
  
  // ============================================
  // 메뉴 동기화 관련 메서드 (상속 시 구현 필요)
  // ============================================
  
  /**
   * 메뉴 업로드 (POS → 3rd Party)
   * @param {Array} menuItems - 메뉴 아이템 배열
   * @returns {Promise<object>} - 업로드 결과
   */
  async uploadMenu(menuItems) {
    throw new Error('uploadMenu() must be implemented');
  }
  
  /**
   * 메뉴 아이템 가용성 업데이트
   * @param {string} itemId - 아이템 UUID
   * @param {boolean} available - 가용 여부
   */
  async updateItemAvailability(itemId, available) {
    throw new Error('updateItemAvailability() must be implemented');
  }
  
  /**
   * 메뉴 아이템 가격 업데이트
   * @param {string} itemId - 아이템 UUID
   * @param {number} price - 새 가격
   */
  async updateItemPrice(itemId, price) {
    throw new Error('updateItemPrice() must be implemented');
  }
  
  // ============================================
  // 주문 관련 메서드 (상속 시 구현 필요)
  // ============================================
  
  /**
   * 새 주문 수신 처리
   * @param {object} rawOrder - 3rd Party 원본 주문 데이터
   * @returns {Promise<object>} - 변환된 POS 주문
   */
  async receiveOrder(rawOrder) {
    throw new Error('receiveOrder() must be implemented');
  }
  
  /**
   * 주문 상태 업데이트 (POS → 3rd Party)
   * @param {string} orderId - 주문 ID
   * @param {string} status - 새 상태
   */
  async updateOrderStatus(orderId, status) {
    throw new Error('updateOrderStatus() must be implemented');
  }
  
  /**
   * 주문 확인 (Accept)
   * @param {string} orderId - 주문 ID
   * @param {number} prepTime - 준비 시간 (분)
   */
  async confirmOrder(orderId, prepTime) {
    throw new Error('confirmOrder() must be implemented');
  }
  
  /**
   * 주문 거부 (Reject)
   * @param {string} orderId - 주문 ID
   * @param {string} reason - 거부 사유
   */
  async rejectOrder(orderId, reason) {
    throw new Error('rejectOrder() must be implemented');
  }
  
  /**
   * 주문 완료 (Ready)
   * @param {string} orderId - 주문 ID
   */
  async markOrderReady(orderId) {
    throw new Error('markOrderReady() must be implemented');
  }
  
  // ============================================
  // ID 매핑 헬퍼 메서드
  // ============================================
  
  /**
   * UUID → 외부 ID 변환
   */
  async uuidToExternalId(entityType, uuid) {
    const mapping = await IdMapperService.getByUUID(uuid);
    if (mapping && mapping.externalIds && mapping.externalIds[this.provider]) {
      return mapping.externalIds[this.provider];
    }
    return null;
  }
  
  /**
   * 외부 ID → UUID 변환
   */
  async externalIdToUUID(entityType, externalId) {
    const mapping = await IdMapperService.getByExternalId(entityType, this.provider, externalId);
    return mapping ? mapping.uuid : null;
  }
  
  /**
   * 외부 ID 저장
   */
  async saveExternalId(entityType, localId, externalId) {
    // 먼저 매핑이 존재하는지 확인
    let mapping = await IdMapperService.getByLocalId(entityType, localId);
    
    if (!mapping) {
      // 매핑이 없으면 생성
      mapping = await IdMapperService.createMapping(entityType, localId);
    }
    
    // 외부 ID 저장
    await IdMapperService.setExternalId(entityType, localId, this.provider, externalId);
    return true;
  }
  
  // ============================================
  // 유틸리티 메서드
  // ============================================
  
  /**
   * 메뉴 아이템을 외부 API 포맷으로 변환
   * @param {object} item - POS 메뉴 아이템
   * @returns {object} - 외부 API 포맷
   */
  transformMenuItem(item) {
    // 기본 구현 - 상속 시 오버라이드
    return {
      external_id: item.uuid,
      name: item.name,
      description: item.description || '',
      price: item.price,
      available: true
    };
  }
  
  /**
   * 외부 주문을 POS 주문 포맷으로 변환
   * @param {object} externalOrder - 외부 주문 데이터
   * @returns {object} - POS 주문 포맷
   */
  transformOrder(externalOrder) {
    // 기본 구현 - 상속 시 오버라이드
    return {
      source: this.provider,
      externalOrderId: externalOrder.id,
      items: [],
      customer: {},
      total: 0
    };
  }
  
  /**
   * 주문 저장 (원본 데이터 보관)
   */
  async saveOrderRecord(externalOrderId, status, rawData, posOrderId = null) {
    const db = new sqlite3.Database(dbPath);
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT OR REPLACE INTO third_party_orders 
         (provider, external_order_id, pos_order_id, status, raw_data, processed_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`,
        [this.provider, externalOrderId, posOrderId, status, JSON.stringify(rawData)],
        function(err) {
          db.close();
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }
  
  /**
   * 연결 테스트
   */
  async testConnection() {
    throw new Error('testConnection() must be implemented');
  }
  
  /**
   * 웹훅 검증
   */
  verifyWebhook(signature, payload) {
    throw new Error('verifyWebhook() must be implemented');
  }
}

module.exports = BaseAdapter;

