// backend/services/thirdParty/SampleAdapter.js
// 샘플 3rd Party 어댑터 구현 예시
// 새로운 3rd Party 연동 시 이 파일을 복사하여 수정

const BaseAdapter = require('./BaseAdapter');
const { ENTITY_TYPES } = require('../idMapperService');

/**
 * 샘플 3rd Party 어댑터
 * DoorDash, SkipTheDishes, UberEats 등 연동 시 참고
 */
class SampleAdapter extends BaseAdapter {
  constructor(config = {}) {
    super(config);
    this.provider = 'sample';  // 'doordash', 'skip', 'ubereats' 등으로 변경
    this.baseUrl = 'https://api.sample.com/v1';  // 실제 API URL로 변경
  }
  
  // ============================================
  // 메뉴 동기화
  // ============================================
  
  /**
   * 메뉴 업로드 구현
   */
  async uploadMenu(menuItems) {
    console.log(`📤 [${this.provider}] 메뉴 업로드 시작: ${menuItems.length}개 아이템`);
    
    // 메뉴 아이템을 외부 API 포맷으로 변환
    const externalItems = menuItems.map(item => this.transformMenuItem(item));
    
    try {
      // 실제 API 호출 (예시)
      // const response = await fetch(`${this.baseUrl}/menu`, {
      //   method: 'POST',
      //   headers: {
      //     'Authorization': `Bearer ${this.apiKey}`,
      //     'Content-Type': 'application/json'
      //   },
      //   body: JSON.stringify({
      //     store_id: this.storeId,
      //     items: externalItems
      //   })
      // });
      
      // 성공 시 외부 ID 저장
      for (const item of menuItems) {
        if (item.item_id) {
          // 실제 응답에서 외부 ID를 받아와야 함
          const externalId = `${this.provider}-${item.item_id}`;
          await this.saveExternalId(ENTITY_TYPES.ITEM, item.item_id, externalId);
        }
      }
      
      console.log(`✅ [${this.provider}] 메뉴 업로드 완료`);
      return { success: true, itemCount: menuItems.length };
    } catch (error) {
      console.error(`❌ [${this.provider}] 메뉴 업로드 실패:`, error.message);
      throw error;
    }
  }
  
  /**
   * 아이템 가용성 업데이트
   */
  async updateItemAvailability(itemId, available) {
    const externalId = await this.uuidToExternalId(ENTITY_TYPES.ITEM, itemId);
    if (!externalId) {
      throw new Error(`외부 ID 없음: ${itemId}`);
    }
    
    console.log(`🔄 [${this.provider}] 아이템 가용성 업데이트: ${externalId} → ${available}`);
    
    // 실제 API 호출
    // await fetch(`${this.baseUrl}/items/${externalId}/availability`, {
    //   method: 'PATCH',
    //   headers: { 'Authorization': `Bearer ${this.apiKey}` },
    //   body: JSON.stringify({ available })
    // });
    
    return { success: true };
  }
  
  /**
   * 아이템 가격 업데이트
   */
  async updateItemPrice(itemId, price) {
    const externalId = await this.uuidToExternalId(ENTITY_TYPES.ITEM, itemId);
    if (!externalId) {
      throw new Error(`외부 ID 없음: ${itemId}`);
    }
    
    console.log(`💰 [${this.provider}] 아이템 가격 업데이트: ${externalId} → $${price}`);
    
    // 실제 API 호출
    // await fetch(`${this.baseUrl}/items/${externalId}/price`, {
    //   method: 'PATCH',
    //   headers: { 'Authorization': `Bearer ${this.apiKey}` },
    //   body: JSON.stringify({ price: Math.round(price * 100) }) // cents
    // });
    
    return { success: true };
  }
  
  // ============================================
  // 주문 처리
  // ============================================
  
  /**
   * 새 주문 수신
   */
  async receiveOrder(rawOrder) {
    console.log(`📥 [${this.provider}] 주문 수신: ${rawOrder.id}`);
    
    // 외부 주문을 POS 포맷으로 변환
    const posOrder = this.transformOrder(rawOrder);
    
    // 원본 데이터 저장
    await this.saveOrderRecord(rawOrder.id, 'pending', rawOrder);
    
    return posOrder;
  }
  
  /**
   * 주문 상태 업데이트
   */
  async updateOrderStatus(orderId, status) {
    console.log(`🔄 [${this.provider}] 주문 상태 업데이트: ${orderId} → ${status}`);
    
    // 상태 매핑 (POS → 외부 시스템)
    const statusMap = {
      'confirmed': 'ACCEPTED',
      'preparing': 'IN_PROGRESS',
      'ready': 'READY_FOR_PICKUP',
      'completed': 'PICKED_UP',
      'cancelled': 'CANCELLED'
    };
    
    const externalStatus = statusMap[status] || status;
    
    // 실제 API 호출
    // await fetch(`${this.baseUrl}/orders/${orderId}/status`, {
    //   method: 'POST',
    //   headers: { 'Authorization': `Bearer ${this.apiKey}` },
    //   body: JSON.stringify({ status: externalStatus })
    // });
    
    return { success: true, status: externalStatus };
  }
  
  /**
   * 주문 확인
   */
  async confirmOrder(orderId, prepTime = 15) {
    console.log(`✅ [${this.provider}] 주문 확인: ${orderId} (준비시간: ${prepTime}분)`);
    
    // 실제 API 호출
    // await fetch(`${this.baseUrl}/orders/${orderId}/confirm`, {
    //   method: 'POST',
    //   headers: { 'Authorization': `Bearer ${this.apiKey}` },
    //   body: JSON.stringify({ preparation_time: prepTime })
    // });
    
    await this.saveOrderRecord(orderId, 'confirmed', { prepTime });
    
    return { success: true };
  }
  
  /**
   * 주문 거부
   */
  async rejectOrder(orderId, reason) {
    console.log(`❌ [${this.provider}] 주문 거부: ${orderId} (사유: ${reason})`);
    
    // 실제 API 호출
    // await fetch(`${this.baseUrl}/orders/${orderId}/reject`, {
    //   method: 'POST',
    //   headers: { 'Authorization': `Bearer ${this.apiKey}` },
    //   body: JSON.stringify({ reason })
    // });
    
    await this.saveOrderRecord(orderId, 'rejected', { reason });
    
    return { success: true };
  }
  
  /**
   * 주문 준비 완료
   */
  async markOrderReady(orderId) {
    console.log(`🍽️ [${this.provider}] 주문 준비 완료: ${orderId}`);
    
    // 실제 API 호출
    // await fetch(`${this.baseUrl}/orders/${orderId}/ready`, {
    //   method: 'POST',
    //   headers: { 'Authorization': `Bearer ${this.apiKey}` }
    // });
    
    await this.saveOrderRecord(orderId, 'ready', {});
    
    return { success: true };
  }
  
  // ============================================
  // 포맷 변환
  // ============================================
  
  /**
   * 메뉴 아이템 변환
   */
  transformMenuItem(item) {
    return {
      external_id: item.uuid || `pos-${item.item_id}`,
      merchant_supplied_id: String(item.item_id),
      name: item.name,
      description: item.description || '',
      price: Math.round((item.price || 0) * 100), // cents로 변환
      price_unit: 'CAD',
      is_available: true,
      category_id: item.category_id,
      modifiers: [],
      image_url: item.image_url || null
    };
  }
  
  /**
   * 외부 주문 → POS 주문 변환
   */
  transformOrder(externalOrder) {
    return {
      source: this.provider,
      externalOrderId: externalOrder.id,
      orderNumber: externalOrder.order_number || externalOrder.id,
      orderType: externalOrder.fulfillment_type || 'PICKUP',
      customer: {
        name: externalOrder.customer?.name || 'Guest',
        phone: externalOrder.customer?.phone || '',
        email: externalOrder.customer?.email || ''
      },
      items: (externalOrder.items || []).map(item => ({
        externalId: item.id,
        name: item.name,
        quantity: item.quantity || 1,
        unitPrice: (item.price || 0) / 100, // cents → dollars
        modifiers: item.modifiers || [],
        specialInstructions: item.special_instructions || ''
      })),
      subtotal: (externalOrder.subtotal || 0) / 100,
      tax: (externalOrder.tax || 0) / 100,
      total: (externalOrder.total || 0) / 100,
      tip: (externalOrder.tip || 0) / 100,
      deliveryFee: (externalOrder.delivery_fee || 0) / 100,
      scheduledTime: externalOrder.scheduled_time || null,
      specialInstructions: externalOrder.special_instructions || '',
      createdAt: new Date(externalOrder.created_at || Date.now())
    };
  }
  
  // ============================================
  // 연결 및 인증
  // ============================================
  
  /**
   * 연결 테스트
   */
  async testConnection() {
    console.log(`🔌 [${this.provider}] 연결 테스트 중...`);
    
    try {
      // 실제 API 호출
      // const response = await fetch(`${this.baseUrl}/stores/${this.storeId}`, {
      //   headers: { 'Authorization': `Bearer ${this.apiKey}` }
      // });
      
      // 테스트 목적으로 성공 반환
      console.log(`✅ [${this.provider}] 연결 성공`);
      return { success: true, message: 'Connection successful' };
    } catch (error) {
      console.error(`❌ [${this.provider}] 연결 실패:`, error.message);
      return { success: false, message: error.message };
    }
  }
  
  /**
   * 웹훅 서명 검증
   */
  verifyWebhook(signature, payload) {
    // 실제 검증 로직 구현
    // const crypto = require('crypto');
    // const expectedSignature = crypto
    //   .createHmac('sha256', this.apiSecret)
    //   .update(JSON.stringify(payload))
    //   .digest('hex');
    // return signature === expectedSignature;
    
    return true; // 테스트용
  }
}

module.exports = SampleAdapter;

