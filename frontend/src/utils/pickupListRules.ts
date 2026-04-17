/**
 * Pickup List (QSR/FSR) — visibility and Amount column labels (Unpaid / Ready).
 */

export type PickupListAmountLabel = 'Unpaid' | 'Ready';

export type PickupChannelClass = 'DELIVERY' | 'ONLINE' | 'PICKUP' | 'TOGO';

function normStatus(order: any): string {
  return String(order?.fullOrder?.status ?? order?.status ?? '').toUpperCase();
}

function normalizeChannelToken(value: unknown): string {
  return String(value || '')
    .toUpperCase()
    .replace(/[\s_-]+/g, '');
}

/**
 * 채널 분류 — Sales `orderListGetPickupChannel` / QSR 배지와 동일 우선순위:
 * 딜리버리 → 투고(fulfillment TOGO·타입·TG) → 온라인(WEB·QR·OL·fulfillment ONLINE) → 픽업 슬롯 → 기타 PICKUP
 */
export function classifyPickupChannel(order: any): PickupChannelClass {
  const base = order?.fullOrder || order || {};
  const typeToken = normalizeChannelToken(
    base?.order_type || base?.orderType || order?.order_type || order?.orderType
  );
  const fulfillmentToken = normalizeChannelToken(
    base?.fulfillment_mode || base?.fulfillment || order?.fulfillment_mode || order?.fulfillment
  );
  const sourceToken = normalizeChannelToken(
    base?.order_source || base?.orderSource || order?.order_source || order?.orderSource
  );
  const tableId = String(
    base?.table_id || base?.tableId || order?.table_id || order?.tableId || ''
  ).toUpperCase();

  const deliveryTokens = ['DELIVERY', 'UBEREATS', 'UBER', 'DOORDASH', 'SKIP', 'SKIPTHEDISHES', 'FANTUAN', 'GRUBHUB'];
  const onlineTokens = ['ONLINE', 'WEB', 'QR'];
  const togoTokens = ['TOGO', 'TAKEOUT'];

  const hasDeliveryCompany = !!(order?.delivery_company || order?.deliveryCompany || base?.delivery_company);

  if (
    fulfillmentToken === 'DELIVERY' ||
    tableId.startsWith('DL') ||
    deliveryTokens.includes(typeToken) ||
    deliveryTokens.includes(sourceToken) ||
    hasDeliveryCompany
  ) {
    return 'DELIVERY';
  }

  if (
    fulfillmentToken === 'TOGO' ||
    togoTokens.includes(typeToken) ||
    tableId.startsWith('TG')
  ) {
    return 'TOGO';
  }

  if (
    fulfillmentToken === 'ONLINE' ||
    tableId.startsWith('OL') ||
    onlineTokens.includes(typeToken) ||
    onlineTokens.includes(sourceToken)
  ) {
    return 'ONLINE';
  }

  if (typeToken === 'PICKUP' || fulfillmentToken === 'PICKUP') {
    return 'PICKUP';
  }

  return 'PICKUP';
}

/** Payment completed (PAID/CLOSED/COMPLETED). PICKED_UP rows are excluded from list before labeling. */
export function orderPaymentComplete(order: any): boolean {
  const s = normStatus(order);
  return s === 'PAID' || s === 'COMPLETED' || s === 'CLOSED';
}

export function orderPickupComplete(order: any): boolean {
  return normStatus(order) === 'PICKED_UP';
}

function takeoutServicePatternRaw(order: any): string {
  const base = order?.fullOrder || order || {};
  return String(base?.service_pattern ?? order?.service_pattern ?? '').trim().toUpperCase();
}

/** SQLite orders.service_pattern — Pickup List / 투고 패널은 TAKEOUT만 표시. */
export function isTakeoutServicePattern(order: any): boolean {
  return takeoutServicePatternRaw(order) === 'TAKEOUT';
}

/** Show row in Pickup List (TAKEOUT only; excludes DINEIN, picked up, cancelled, merged). */
export function shouldShowInPickupList(order: any): boolean {
  if (!isTakeoutServicePattern(order)) return false;
  const s = String(order?.status ?? '').toUpperCase();
  const fs = normStatus(order);
  if (fs === 'PICKED_UP' || s === 'PICKED_UP') return false;
  if (s === 'CANCELLED' || s === 'MERGED') return false;
  if (fs === 'CANCELLED' || fs === 'MERGED') return false;
  return true;
}

/**
 * Amount column label:
 * - Delivery + visible → Ready
 * - Online / Togo / Pickup: unpaid → Unpaid, paid → Ready
 */
export function getPickupListAmountLabel(order: any): PickupListAmountLabel | null {
  if (!shouldShowInPickupList(order)) return null;
  const ch = classifyPickupChannel(order);
  if (ch === 'DELIVERY') return 'Ready';
  if (!orderPaymentComplete(order)) return 'Unpaid';
  return 'Ready';
}

/** OrderDetailModal fetch/payment routing (embedded mixed list). */
export function resolveOrderChannelTypeForModal(order: any): 'delivery' | 'online' | 'togo' | 'pickup' {
  const ch = classifyPickupChannel(order);
  if (ch === 'DELIVERY') return 'delivery';
  if (ch === 'ONLINE') return 'online';
  if (ch === 'PICKUP') return 'pickup';
  return 'togo';
}

export function channelDisplayLabel(ch: PickupChannelClass): string {
  switch (ch) {
    case 'DELIVERY':
      return 'Delivery';
    case 'ONLINE':
      return 'Online';
    case 'TOGO':
      return 'Togo';
    case 'PICKUP':
      return 'Pickup';
    default:
      return 'Pickup';
  }
}
