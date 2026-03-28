/**
 * Pickup List (QSR/FSR) — visibility and Amount column labels (Unpaid / Ready).
 */

export type PickupListAmountLabel = 'Unpaid' | 'Ready';

export type PickupChannelClass = 'DELIVERY' | 'ONLINE' | 'PICKUP' | 'TOGO';

function normStatus(order: any): string {
  return String(order?.fullOrder?.status ?? order?.status ?? '').toUpperCase();
}

/** Channel for display and label rules (aligned with PickupListPanel / API order_type). */
export function classifyPickupChannel(order: any): PickupChannelClass {
  const ot = String(order.order_type || order.orderType || '').toUpperCase();
  if (ot === 'DELIVERY' || order.delivery_company || order.deliveryCompany) return 'DELIVERY';
  if (ot === 'ONLINE') return 'ONLINE';
  if (ot === 'TOGO' || ot === 'TAKEOUT') return 'TOGO';
  if (ot === 'PICKUP') return 'PICKUP';
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

/** Show row in Pickup List (excludes picked up, cancelled, merged). */
export function shouldShowInPickupList(order: any): boolean {
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
