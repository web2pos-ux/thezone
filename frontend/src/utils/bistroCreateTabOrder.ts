import { API_URL } from '../config/constants';

export type CreateBistroTabResult = {
  success?: boolean;
  orderId?: number;
  order_number?: string;
  error?: string;
};

/** 새 비스트로 탭 = 빈 POS 주문 1건 (customerName = 탭 이름표) */
export async function createBistroTabOrder(
  tableId: string,
  tabLabel: string
): Promise<CreateBistroTabResult> {
  const label = String(tabLabel || '').trim();
  const res = await fetch(`${API_URL}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderType: 'POS',
      total: 0,
      subtotal: 0,
      tax: 0,
      items: [],
      tableId: String(tableId || '').trim(),
      customerName: label || null,
      orderMode: 'FSR',
    }),
  });
  const data = (await res.json().catch(() => ({}))) as CreateBistroTabResult;
  if (!res.ok) {
    return { success: false, error: (data as any)?.error || res.statusText || 'Failed to create order' };
  }
  return data;
}
