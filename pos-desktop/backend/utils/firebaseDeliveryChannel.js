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

/**
 * Urban Piper 주문 ID 추출 — 가능한 모든 경로를 우선순위대로 시도.
 * @param {object} order  Firestore 주문 문서
 * @returns {string|null}
 */
function extractUrbanPiperOrderId(order) {
  if (!order || typeof order !== 'object') return null;
  const raw = order.rawUrbanPiper;
  if (raw && typeof raw === 'object') {
    const detailId = raw?.order?.details?.id;
    if (detailId != null && String(detailId).trim()) return String(detailId).trim();
    const orderId = raw?.order?.id;
    if (orderId != null && String(orderId).trim()) return String(orderId).trim();
    const rootId = raw?.id;
    if (rootId != null && String(rootId).trim()) return String(rootId).trim();
  }
  const sid = order.sourceIds || order.source_ids;
  if (sid && typeof sid === 'object') {
    const candidates = [
      sid.urbanpiperOrderId,
      sid.urbanpiper_order_id,
      sid.upOrderId,
      sid.up_order_id,
      sid.external_id,
      sid.externalId,
    ];
    for (const c of candidates) {
      if (c != null && String(c).trim()) return String(c).trim();
    }
    const ch = String(sid.channel || '').toLowerCase();
    if ((ch.includes('urbanpiper') || ch.includes('urban')) && sid.orderId) {
      return String(sid.orderId).trim();
    }
  }
  const ep = order.rawUrbanPiper?.order?.details?.ext_platforms;
  if (Array.isArray(ep) && ep.length) {
    const epId = ep[0]?.id ?? ep[0]?.order_id ?? ep[0]?.external_order_id;
    if (epId != null && String(epId).trim()) return String(epId).trim();
  }
  return null;
}

module.exports = {
  getSourceIdsChannel,
  mapChannelSlugToDeliveryCompany,
  hasUrbanPiperMarker,
  resolveFirestoreDeliveryEnrichment,
  enrichFirebaseOrderForPos,
  extractUrbanPiperOrderId,
};
