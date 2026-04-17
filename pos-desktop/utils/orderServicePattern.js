/**
 * orders.service_pattern — SQLite 저장용
 * - DINEIN: 매장/테이블 식사 (POS·DINE_IN 등)
 * - TAKEOUT: 온라인·딜리버리·투고·픽업 등 매장 외 수령
 */

function normalizeOrderTypeToken(orderType) {
  return String(orderType || '')
    .toUpperCase()
    .replace(/[\s_-]+/g, '');
}

/**
 * @param {{ orderType?: string|null, fulfillmentMode?: string|null, tableId?: string|null }} p
 * @returns {'DINEIN'|'TAKEOUT'}
 */
function resolveServicePattern({ orderType, fulfillmentMode, tableId } = {}) {
  const tid = String(tableId || '').trim().toUpperCase();
  if (tid.startsWith('DL') || tid.startsWith('TG') || tid.startsWith('OL')) {
    return 'TAKEOUT';
  }

  const fm = String(fulfillmentMode || '').trim().toUpperCase();
  if (['DELIVERY', 'TOGO', 'ONLINE', 'PICKUP'].includes(fm)) {
    return 'TAKEOUT';
  }

  const ot = normalizeOrderTypeToken(orderType);

  const dineIn = new Set(['POS', 'DINEIN', 'FORHERE', 'EATIN']);
  if (dineIn.has(ot)) return 'DINEIN';

  const takeout = new Set([
    'ONLINE',
    'WEB',
    'QR',
    'DELIVERY',
    'TOGO',
    'TAKEOUT',
    'PICKUP',
    'UBEREATS',
    'UBER',
    'DOORDASH',
    'SKIP',
    'SKIPTHEDISHES',
    'FANTUAN',
    'GRUBHUB',
  ]);
  if (takeout.has(ot)) return 'TAKEOUT';

  if (!ot && tid && !tid.startsWith('DL') && !tid.startsWith('TG') && !tid.startsWith('OL')) {
    return 'DINEIN';
  }

  return 'TAKEOUT';
}

module.exports = {
  resolveServicePattern,
};
