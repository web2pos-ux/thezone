// backend/integrations/ThirdPartyAdapter.js
// 3rd Party 연동 기본 어댑터 인터페이스

const idMapperService = require('../services/idMapperService');

/**
 * ThirdPartyAdapter - 3rd Party 배달 플랫폼 연동 기본 클래스
 * 
 * DoorDash, SkipTheDishes, UberEats 등 배달 플랫폼 연동 시
 * 이 클래스를 상속하여 구현합니다.
 * 
 * @abstract
 */
class ThirdPartyAdapter {
  /**
   * @param {object} config
   * @param {string} config.apiKey - API 키
   * @param {string} config.apiSecret - API 시크릿 (optional)
   * @param {string} config.storeId - 플랫폼 내 매장 ID
   * @param {string} config.webhookSecret - 웹훅 검증용 시크릿
   */
  constructor(config) {
    if (this.constructor === ThirdPartyAdapter) {
      throw new Error('ThirdPartyAdapter is abstract and cannot be instantiated directly');
    }
    
    this.name = '';           // 'doordash', 'skip', 'ubereats'
    this.displayName = '';    // 'DoorDash', 'SkipTheDishes', 'Uber Eats'
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.storeId = config.storeId;
    this.webhookSecret = config.webhookSecret;
    this.baseUrl = '';
    
    this.idMapper = idMapperService;
  }
  
  // ==========================================
  // 메뉴 동기화
  // ==========================================
  
  /**
   * POS 메뉴를 외부 플랫폼에 동기화
   * @param {Array} menuItems - POS 메뉴 아이템 배열
   * @returns {Promise<{success: boolean, syncedCount: number, errors: Array}>}
   * @abstract
   */
  async syncMenu(menuItems) {
    throw new Error('syncMenu() must be implemented by subclass');
  }
  
  /**
   * 특정 아이템 재고/가용성 업데이트
   * @param {string} uuid - 아이템 UUID
   * @param {boolean} available - 가용 여부
   * @returns {Promise<boolean>}
   * @abstract
   */
  async updateAvailability(uuid, available) {
    throw new Error('updateAvailability() must be implemented by subclass');
  }
  
  /**
   * 특정 아이템 가격 업데이트
   * @param {string} uuid - 아이템 UUID
   * @param {number} price - 새 가격
   * @returns {Promise<boolean>}
   * @abstract
   */
  async updatePrice(uuid, price) {
    throw new Error('updatePrice() must be implemented by subclass');
  }
  
  // ==========================================
  // 주문 관리
  // ==========================================
  
  /**
   * 외부 플랫폼에서 주문 가져오기
   * @param {string} orderId - 외부 플랫폼 주문 ID
   * @returns {Promise<object>} - 정규화된 주문 객체
   * @abstract
   */
  async getOrder(orderId) {
    throw new Error('getOrder() must be implemented by subclass');
  }
  
  /**
   * 주문 상태 업데이트
   * @param {string} orderId - 외부 플랫폼 주문 ID
   * @param {string} status - 'accepted', 'preparing', 'ready', 'completed', 'cancelled'
   * @param {object} options - 추가 옵션 (예: 예상 시간, 취소 사유)
   * @returns {Promise<boolean>}
   * @abstract
   */
  async updateOrderStatus(orderId, status, options = {}) {
    throw new Error('updateOrderStatus() must be implemented by subclass');
  }
  
  /**
   * 주문 수락
   * @param {string} orderId
   * @param {number} prepTime - 준비 시간 (분)
   * @returns {Promise<boolean>}
   */
  async acceptOrder(orderId, prepTime = 15) {
    return this.updateOrderStatus(orderId, 'accepted', { prepTime });
  }
  
  /**
   * 주문 거절/취소
   * @param {string} orderId
   * @param {string} reason - 거절 사유
   * @returns {Promise<boolean>}
   */
  async rejectOrder(orderId, reason = '') {
    return this.updateOrderStatus(orderId, 'cancelled', { reason });
  }
  
  /**
   * 주문 준비 완료
   * @param {string} orderId
   * @returns {Promise<boolean>}
   */
  async markReady(orderId) {
    return this.updateOrderStatus(orderId, 'ready');
  }
  
  // ==========================================
  // 웹훅 처리
  // ==========================================
  
  /**
   * 웹훅 서명 검증
   * @param {string} signature - 요청 헤더의 서명
   * @param {string} payload - 요청 본문
   * @returns {boolean}
   * @abstract
   */
  verifyWebhook(signature, payload) {
    throw new Error('verifyWebhook() must be implemented by subclass');
  }
  
  /**
   * 웹훅 이벤트 처리
   * @param {string} eventType - 이벤트 타입
   * @param {object} data - 이벤트 데이터
   * @returns {Promise<object>} - 처리 결과
   * @abstract
   */
  async handleWebhook(eventType, data) {
    throw new Error('handleWebhook() must be implemented by subclass');
  }
  
  // ==========================================
  // ID 변환 헬퍼
  // ==========================================
  
  /**
   * UUID를 이 플랫폼의 External ID로 변환
   * @param {string} uuid
   * @returns {Promise<string|null>}
   */
  async uuidToExternalId(uuid) {
    return await this.idMapper.uuidToExternal(uuid, this.name);
  }
  
  /**
   * External ID를 UUID로 변환
   * @param {string} entityType
   * @param {string} externalId
   * @returns {Promise<string|null>}
   */
  async externalIdToUUID(entityType, externalId) {
    return await this.idMapper.externalToUUID(entityType, this.name, externalId);
  }
  
  /**
   * External ID 저장
   * @param {string} entityType
   * @param {string} uuid
   * @param {string} externalId
   */
  async saveExternalId(entityType, uuid, externalId) {
    await this.idMapper.setExternalId(entityType, uuid, this.name, externalId);
  }
  
  // ==========================================
  // 데이터 변환
  // ==========================================
  
  /**
   * POS 메뉴 아이템을 플랫폼 포맷으로 변환
   * @param {object} posItem - POS 메뉴 아이템
   * @returns {object} - 플랫폼 형식 아이템
   * @abstract
   */
  transformMenuItem(posItem) {
    throw new Error('transformMenuItem() must be implemented by subclass');
  }
  
  /**
   * 플랫폼 주문을 POS 포맷으로 변환
   * @param {object} externalOrder - 플랫폼 주문
   * @returns {object} - POS 형식 주문
   * @abstract
   */
  transformOrder(externalOrder) {
    throw new Error('transformOrder() must be implemented by subclass');
  }
  
  // ==========================================
  // 유틸리티
  // ==========================================
  
  /**
   * API 호출 래퍼 (에러 핸들링, 재시도 로직 포함)
   * @param {string} method - HTTP 메서드
   * @param {string} endpoint - API 엔드포인트
   * @param {object} data - 요청 데이터
   * @param {object} options - 추가 옵션
   * @returns {Promise<object>}
   */
  async apiCall(method, endpoint, data = null, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = this.getHeaders();
    
    const fetchOptions = {
      method,
      headers,
      ...(data && { body: JSON.stringify(data) })
    };
    
    const maxRetries = options.retries || 3;
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, fetchOptions);
        
        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`API Error ${response.status}: ${errorBody}`);
        }
        
        return await response.json();
      } catch (error) {
        lastError = error;
        console.error(`${this.name} API call failed (attempt ${attempt}/${maxRetries}):`, error.message);
        
        if (attempt < maxRetries) {
          await this.sleep(1000 * attempt); // Exponential backoff
        }
      }
    }
    
    throw lastError;
  }
  
  /**
   * 인증 헤더 생성
   * @returns {object}
   * @abstract
   */
  getHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`
    };
  }
  
  /**
   * 대기
   * @param {number} ms
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * 연결 테스트
   * @returns {Promise<boolean>}
   * @abstract
   */
  async testConnection() {
    throw new Error('testConnection() must be implemented by subclass');
  }
}

module.exports = ThirdPartyAdapter;





