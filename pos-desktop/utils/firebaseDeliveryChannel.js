'use strict';

/**
 * Firebase restaurants/{id}/orders 문서 → POS 투고패널(Delivery) 분류용 필드 보강.
 * Urban Piper( rawUrbanPiper / source ) 또는 sourceIds.channel( Uber/Door/Skip 등 ).
 */

function normalizeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function getSourceIdsChannel(order) {
  if (!order || typeof order !== 'object') return '';
  const sid = order.sourceIds;
  if (sid && typeof sid === 'object' && sid.channel != null && String(sid.channel).trim() !== '') {
    return String(sid.channel).trim();
  }
  const snake = order.source_ids;
  if (snake && typeof snake === 'object' && snake.channel != null && String(snake.channel).trim() !== '') {
    return String(snake.channel).trim();
  }
  return '';
}

function mapChannelSlugToDeliveryCompany(slug) {
  const s = normalizeSlug(slug);
  if (!s) return null;
  if (s === 'ubereats' || s === 'uber') return 'UBEREATS';
  if (s === 'doordash' || s === 'ddash' || s === 'dashdoor') return 'DOORDASH';
  if (s === 'skipthedishes' || s === 'skip' || s === 'skipdishes') return 'SKIPTHEDISHES';
  if (s === 'fantuan') return 'FANTUAN';
  if (s === 'grubhub') return 'GRUBHUB';
  return String(slug).trim().toUpperCase().replace(/\s+/g, '');
}

function hasUrbanPiperMarker(order) {
  if (!order || typeof order !== 'object') return false;
  if (order.rawUrbanPiper != null && order.rawUrbanPiper !== '') return true;
  const src = String(order.source || '').toLowerCase();
  if (src.includes('urbanpiper')) return true;
  if (src.includes('urban') && src.includes('piper')) return true;
  return false;
}

/**
 * Urban Piper / 배달 앱 채널이면 SQLite·GET 목록에 맞게 DELIVERY + delivery_company 반영.
 * @returns {{ deliveryCompany: string|null, orderType: string, fulfillmentMode: string } | null}
 */
function resolveFirestoreDeliveryEnrichment(order) {
  if (!order || typeof order !== 'object') return null;

  const channelRaw = getSourceIdsChannel(order);
  const companyFromChannel = channelRaw ? mapChannelSlugToDeliveryCompany(channelRaw) : null;
  const urban = hasUrbanPiperMarker(order);

  if (!companyFromChannel && !urban) return null;

  if (companyFromChannel) {
    const existing = order.deliveryCompany || order.delivery_company;
    return {
      deliveryCompany: existing ? String(existing) : companyFromChannel,
      orderType: 'DELIVERY',
      fulfillmentMode: 'delivery',
    };
  }

  return {
    deliveryCompany: null,
    orderType: 'DELIVERY',
    fulfillmentMode: 'delivery',
  };
}

/**
 * Firestore 주문 스냅샷에 채널·타입 필드를 덧붙여 반환 (원본 변형 없이 얕은 복사).
 */
function enrichFirebaseOrderForPos(order) {
  if (!order || typeof order !== 'object') return order;
  const extra = resolveFirestoreDeliveryEnrichment(order);
  if (!extra) return { ...order };

  const out = { ...order };
  out.orderType = extra.orderType;
  out.order_type = extra.orderType;
  out.fulfillmentMode = extra.fulfillmentMode;
  out.fulfillment_mode = extra.fulfillmentMode;
  if (extra.deliveryCompany) {
    out.deliveryCompany = order.deliveryCompany || order.delivery_company || extra.deliveryCompany;
    out.delivery_company = order.delivery_company || order.deliveryCompany || extra.deliveryCompany;
  }
  return out;
}

module.exports = {
  getSourceIdsChannel,
  mapChannelSlugToDeliveryCompany,
  hasUrbanPiperMarker,
  resolveFirestoreDeliveryEnrichment,
  enrichFirebaseOrderForPos,
};
