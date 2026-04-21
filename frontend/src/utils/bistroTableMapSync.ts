import { API_URL } from '../config/constants';
import { isBistroOpenOrder, isPosTableOrder } from './bistroOrderHelpers';

export type BistroTableMapEl = {
  id: string;
  status: string;
  current_order_id?: number | null;
};

const SYNCABLE_STATUS = new Set(['Available', 'Occupied', 'Payment Pending']);

function openPosOrdersForTable(orders: any[], tableElementId: string): any[] {
  const tid = String(tableElementId || '').trim();
  return orders.filter((o) => {
    if (!isBistroOpenOrder(o)) return false;
    if (!isPosTableOrder(o)) return false;
    return String(o.table_id || '').trim() === tid;
  });
}

function representativeOrderId(open: any[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (const o of open) {
    const id = Number(o.id);
    if (Number.isFinite(id) && id < min) min = id;
  }
  return min === Number.POSITIVE_INFINITY ? Number(open[0]?.id) : min;
}

async function patchElementStatus(elementId: string, status: string): Promise<void> {
  const res = await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(elementId)}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`status PATCH failed ${res.status} ${t}`);
  }
}

async function patchElementCurrentOrder(elementId: string, orderId: number | null): Promise<void> {
  const res = await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(elementId)}/current-order`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId: orderId == null ? null : orderId }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`current-order PATCH failed ${res.status} ${t}`);
  }
}

/**
 * 오픈 탭(주문)과 table_map_elements 를 맞춤.
 * - 오픈 탭 0: Available + current_order_id 해제
 * - 오픈 탭 ≥1: (Payment Pending 유지) 그 외에는 Occupied, current_order_id 는 대표 오더 id
 * Reserved/Hold 는 건드리지 않음.
 * current_order_id 를 먼저 맞춘 뒤 Occupied 로 바꿔 GET 정규화와 경쟁하지 않음.
 */
export async function syncBistroTableMapFromOrders(
  elements: BistroTableMapEl[],
  orders: any[]
): Promise<boolean> {
  let changed = false;
  for (const el of elements) {
    const st = String(el.status || 'Available');
    if (!SYNCABLE_STATUS.has(st)) continue;

    const open = openPosOrdersForTable(orders, el.id);
    const curOid = el.current_order_id != null && Number.isFinite(Number(el.current_order_id))
      ? Number(el.current_order_id)
      : null;

    if (open.length === 0) {
      if (st === 'Occupied' || st === 'Payment Pending') {
        await patchElementStatus(el.id, 'Available');
        await patchElementCurrentOrder(el.id, null);
        changed = true;
      }
      continue;
    }

    const repId = representativeOrderId(open);

    if (st === 'Payment Pending') {
      const curStillOpen = curOid != null && open.some((o) => Number(o.id) === curOid);
      if (!curStillOpen) {
        await patchElementCurrentOrder(el.id, repId);
        changed = true;
      }
      continue;
    }

    if (curOid !== repId) {
      await patchElementCurrentOrder(el.id, repId);
      changed = true;
    }
    if (st !== 'Occupied') {
      await patchElementStatus(el.id, 'Occupied');
      changed = true;
    }
  }
  return changed;
}
