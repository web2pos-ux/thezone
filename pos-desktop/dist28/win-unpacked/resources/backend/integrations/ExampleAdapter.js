// backend/integrations/ExampleAdapter.js
// 예시 어댑터 - 새 3rd Party 연동 시 참고용

const ThirdPartyAdapter = require('./ThirdPartyAdapter');
const crypto = require('crypto');

/**
 * ExampleAdapter - 3rd Party 연동 예시
 * 
 * 새로운 배달 플랫폼 연동 시 이 파일을 복사하여 수정합니다.
 * 
 * @example
 * const adapter = new ExampleAdapter({
 *   apiKey: 'your-api-key',
 *   storeId: 'your-store-id',
 *   webhookSecret: 'your-webhook-secret'
 * });
 * 
 * // 메뉴 동기화
 * await adapter.syncMenu(menuItems);
 * 
 * // 주문 상태 업데이트
 * await adapter.acceptOrder('order-123', 15);
 */
class ExampleAdapter extends ThirdPartyAdapter {
  constructor(config) {
    super(config);
    
    this.name = 'example';
    this.displayName = 'Example Platform';
    this.baseUrl = 'https://api.example.com/v1';
  }
  
  // ==========================================
  // 메뉴 동기화 구현
  // ==========================================
  
  async syncMenu(menuItems) {
    console.log(`📤 Syncing ${menuItems.length} items to ${this.displayName}`);
    
    const results = {
      success: true,
      syncedCount: 0,
      errors: []
    };
    
    for (const item of menuItems) {
      try {
        // 1. UUID 조회
        const mapping = await this.idMapper.getByLocalId('menu_item', item.item_id);
        if (!mapping) {
          results.errors.push({ itemId: item.item_id, error: 'No UUID mapping found' });
          continue;
        }
        
        // 2. 아이템 변환
        const externalItem = this.transformMenuItem(item, mapping.uuid);
        
        // 3. API 호출 (실제 구현에서는 외부 API 호출)
        // const response = await this.apiCall('POST', '/menu/items', externalItem);
        
        // 4. External ID 저장 (API 응답에서 받은 ID)
        // await this.saveExternalId('menu_item', mapping.uuid, response.id);
        
        results.syncedCount++;
        console.log(`   ✅ Synced: ${item.name}`);
        
      } catch (error) {
        results.errors.push({ itemId: item.item_id, error: error.message });
        console.error(`   ❌ Failed: ${item.name} - ${error.message}`);
      }
    }
    
    results.success = results.errors.length === 0;
    return results;
  }
  
  async updateAvailability(uuid, available) {
    try {
      const externalId = await this.uuidToExternalId(uuid);
      if (!externalId) {
        throw new Error('External ID not found');
      }
      
      // await this.apiCall('PATCH', `/menu/items/${externalId}`, { available });
      console.log(`📦 Updated availability: ${uuid} = ${available}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to update availability:`, error.message);
      return false;
    }
  }
  
  async updatePrice(uuid, price) {
    try {
      const externalId = await this.uuidToExternalId(uuid);
      if (!externalId) {
        throw new Error('External ID not found');
      }
      
      // await this.apiCall('PATCH', `/menu/items/${externalId}`, { price: Math.round(price * 100) });
      console.log(`💰 Updated price: ${uuid} = ${price}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to update price:`, error.message);
      return false;
    }
  }
  
  // ==========================================
  // 주문 관리 구현
  // ==========================================
  
  async getOrder(orderId) {
    // const response = await this.apiCall('GET', `/orders/${orderId}`);
    // return this.transformOrder(response);
    
    // 예시 반환
    return {
      id: orderId,
      orderNumber: `EX-${orderId}`,
      status: 'pending',
      items: [],
      total: 0,
      createdAt: new Date().toISOString()
    };
  }
  
  async updateOrderStatus(orderId, status, options = {}) {
    try {
      const payload = { status };
      
      if (status === 'accepted' && options.prepTime) {
        payload.estimated_ready_time = options.prepTime;
      }
      
      if (status === 'cancelled' && options.reason) {
        payload.cancellation_reason = options.reason;
      }
      
      // await this.apiCall('PATCH', `/orders/${orderId}/status`, payload);
      console.log(`📋 Order ${orderId} status updated to: ${status}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to update order status:`, error.message);
      return false;
    }
  }
  
  // ==========================================
  // 웹훅 처리 구현
  // ==========================================
  
  verifyWebhook(signature, payload) {
    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(payload)
      .digest('hex');
    
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }
  
  async handleWebhook(eventType, data) {
    console.log(`📥 Webhook received: ${eventType}`);
    
    switch (eventType) {
      case 'order.created':
        return this.handleNewOrder(data);
      
      case 'order.cancelled':
        return this.handleOrderCancellation(data);
      
      case 'menu.validation':
        return this.handleMenuValidation(data);
      
      default:
        console.warn(`Unknown webhook event: ${eventType}`);
        return { acknowledged: true };
    }
  }
  
  async handleNewOrder(data) {
    console.log(`🆕 New order received: ${data.order_id}`);
    
    // 1. 주문 데이터 변환
    const order = this.transformOrder(data);
    
    // 2. POS에 주문 생성
    // await posService.createOrder(order);
    
    return { acknowledged: true, orderId: data.order_id };
  }
  
  async handleOrderCancellation(data) {
    console.log(`❌ Order cancelled: ${data.order_id}`);
    
    // POS에서 주문 취소 처리
    // await posService.cancelOrder(data.order_id, data.reason);
    
    return { acknowledged: true };
  }
  
  async handleMenuValidation(data) {
    console.log(`✅ Menu validation: ${data.status}`);
    return { acknowledged: true };
  }
  
  // ==========================================
  // 데이터 변환 구현
  // ==========================================
  
  transformMenuItem(posItem, uuid) {
    return {
      external_id: uuid,  // UUID를 외부 ID로 사용
      name: posItem.name,
      description: posItem.description || '',
      price: Math.round(posItem.price * 100),  // 센트 단위
      available: true,
      category_id: posItem.category_id,
      image_url: posItem.image_url || null,
      modifiers: []  // 모디파이어 변환 로직
    };
  }
  
  transformOrder(externalOrder) {
    return {
      externalId: externalOrder.id,
      externalOrderNumber: externalOrder.order_number,
      platform: this.name,
      status: this.mapStatus(externalOrder.status),
      customerName: externalOrder.customer?.name || 'Guest',
      customerPhone: externalOrder.customer?.phone || '',
      items: (externalOrder.items || []).map(item => ({
        name: item.name,
        quantity: item.quantity,
        price: item.price / 100,  // 달러 단위로 변환
        modifiers: item.modifiers || []
      })),
      subtotal: externalOrder.subtotal / 100,
      tax: externalOrder.tax / 100,
      tip: externalOrder.tip / 100,
      total: externalOrder.total / 100,
      notes: externalOrder.special_instructions || '',
      createdAt: externalOrder.created_at,
      pickupTime: externalOrder.pickup_time
    };
  }
  
  mapStatus(externalStatus) {
    const statusMap = {
      'pending': 'pending',
      'confirmed': 'confirmed',
      'in_progress': 'preparing',
      'ready': 'ready',
      'picked_up': 'completed',
      'delivered': 'completed',
      'cancelled': 'cancelled'
    };
    
    return statusMap[externalStatus] || 'pending';
  }
  
  // ==========================================
  // 유틸리티 구현
  // ==========================================
  
  getHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      'X-Store-Id': this.storeId
    };
  }
  
  async testConnection() {
    try {
      // await this.apiCall('GET', '/ping');
      console.log(`✅ ${this.displayName} connection successful`);
      return true;
    } catch (error) {
      console.error(`❌ ${this.displayName} connection failed:`, error.message);
      return false;
    }
  }
}

module.exports = ExampleAdapter;





