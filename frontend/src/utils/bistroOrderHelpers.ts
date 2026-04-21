/** Bistro: 오픈 탭(주문) 판별 · 표시용 (orders.js 수정 없음) */

const TERMINAL_STATUSES = new Set([
  'CLOSED',
  'COMPLETED',
  'VOIDED',
  'VOID',
  'MERGED',
  'REFUNDED',
  'CANCELLED',
  'PICKED_UP',
  'PAID',
]);

export function isBistroOpenOrder(row: { status?: string | null }): boolean {
  const s = String(row?.status || '').toUpperCase();
  if (!s) return true;
  return !TERMINAL_STATUSES.has(s);
}

export function isPosTableOrder(row: { order_type?: string | null }): boolean {
  const t = String(row?.order_type || 'POS').toUpperCase();
  return t === 'POS' || t === '' || t === 'DINE_IN' || t === 'DINEIN';
}

export function filterOrdersForContainer(
  orders: any[],
  containerElementId: string
): any[] {
  const tid = String(containerElementId || '').trim();
  return orders.filter((o) => {
    if (!isBistroOpenOrder(o)) return false;
    if (!isPosTableOrder(o)) return false;
    return String(o.table_id || '').trim() === tid;
  });
}

export function filterOrdersForBistroPanel(orders: any[], elementIds: Set<string>): any[] {
  return orders.filter((o) => {
    if (!isBistroOpenOrder(o)) return false;
    if (!isPosTableOrder(o)) return false;
    const id = String(o.table_id || '').trim();
    return id && elementIds.has(id);
  });
}

/** 탭 패널: 테이블 맵 상태 기준 — Payment Pending 만 After Bill, 나머지는 Occupied 로만 표시 */
export function getBistroTabPanelPhase(
  tableElementId: string,
  tableStatusById: Record<string, string>
): 'Occupied' | 'After Bill' {
  const st = String(tableStatusById[String(tableElementId).trim()] || '');
  if (st === 'Payment Pending') return 'After Bill';
  return 'Occupied';
}

/**
 * 탭 카드 색상 단계 (테이블 맵 상태·주문 금액과 동기):
 * - Bill 출력 후: 맵 `Payment Pending` → 맵과 동일 회색 톤
 * - 음식 주문 있음: `Occupied` 톤
 * - 탭만 열림(금액 없음): `Available` 톤
 */
export function getBistroTabCardVisualStatus(
  order: any,
  tableStatusById: Record<string, string>
): 'Available' | 'Occupied' | 'Payment Pending' {
  const tid = String(order?.table_id ?? '').trim();
  const tableSt = String((tid && tableStatusById[tid]) || '');
  if (tableSt === 'Payment Pending') return 'Payment Pending';

  const sub = Number(order?.subtotal ?? 0);
  const tot = Number(order?.total ?? 0);
  const hasOrdered =
    (Number.isFinite(sub) && sub > 0) || (Number.isFinite(tot) && tot > 0);
  if (!hasOrdered) return 'Available';
  return 'Occupied';
}

export function getBistroTabLabel(order: any): string {
  const name = String(order?.customer_name || '').trim();
  if (name) return name;
  const num = order?.order_number != null ? String(order.order_number).trim() : '';
  if (num) return `#${num}`;
  return `Order ${order?.id ?? ''}`;
}

export function formatBistroMoney(n: number): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);
}

/** 탭 패널: 서버 표시 (orders 목록 row — server_name) */
export function getBistroTabServerDisplayName(order: any): string {
  const raw = order?.server_name ?? order?.serverName;
  const s = String(raw ?? '').trim();
  return s || '—';
}

/**
 * 탭 카드: 테이블 위치 — T1 / R2 / B3 형식만 (맵 `name`·id에서 정규화).
 * Bar=B, Room=R, 그 외 테이블=T 접두(숫자만 있으면 T).
 */
export function getBistroTabTableDisplayLabel(order: any): string {
  const firstLine = String(order?.table_name ?? '')
    .split('\n')[0]
    .trim();
  const tid = String(order?.table_id ?? '').trim();
  const compact = firstLine.replace(/\s/g, '');

  const trbExact = compact.match(/^([TtRrBb])(\d+)$/);
  if (trbExact) return `${trbExact[1].toUpperCase()}${trbExact[2]}`;

  const trbLoose = firstLine.match(/([TtRrBb])\s*-?\s*(\d+)/);
  if (trbLoose) return `${trbLoose[1].toUpperCase()}${trbLoose[2]}`;

  const tableWord = firstLine.match(/^table\s*([TtRrBb]?)\s*(\d+)$/i);
  if (tableWord) {
    const letter = (tableWord[1] || 'T').toUpperCase();
    return `${letter}${tableWord[2]}`;
  }

  const tableDigitsOnly = firstLine.match(/^table\s*(\d+)$/i);
  if (tableDigitsOnly) return `T${tableDigitsOnly[1]}`;

  if (/^\d+$/.test(compact)) return `T${compact}`;

  if (/^\d+$/.test(tid)) return `T${tid}`;

  const anyInName = firstLine.match(/([TtRrBb])(\d+)/);
  if (anyInName) return `${anyInName[1].toUpperCase()}${anyInName[2]}`;

  const digitsInId = tid.match(/(\d+)/);
  if (digitsInId) return `T${digitsInId[1]}`;

  return '—';
}

/** 탭 패널: 세금 포함 합계(환불 차감). `total`이 일반적으로 grand total. */
export function getBistroTabGrandTotalInclTax(order: any): number {
  const total = Number(order?.total ?? 0);
  const ref = Number(order?.refunded_total ?? order?.refundedTotal ?? 0);
  if (!Number.isFinite(total)) return 0;
  const r = Number.isFinite(ref) ? ref : 0;
  return Math.max(0, total - r);
}
