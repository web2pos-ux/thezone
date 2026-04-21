import { API_URL } from '../config/constants';

/** 현재 영업일 세션 범위의 주문 목록 (세션 없으면 기존 limit 조회로 폴백) */
export async function fetchOrdersForBistroSession(): Promise<any[]> {
  try {
    const todayRes = await fetch(`${API_URL}/daily-closings/today`, { cache: 'no-store' as RequestCache });
    const todayJson = (await todayRes.json().catch(() => ({}))) as {
      data?: { date?: string };
    };
    const bizDate = todayJson?.data?.date ? String(todayJson.data.date).trim().slice(0, 10) : '';
    if (bizDate) {
      const oRes = await fetch(
        `${API_URL}/orders?limit=500&session_scope=1&date=${encodeURIComponent(bizDate)}`,
        { cache: 'no-store' as RequestCache }
      );
      const oJson = (await oRes.json().catch(() => ({}))) as { orders?: any[] };
      if (Array.isArray(oJson.orders)) return oJson.orders;
    }
  } catch {
    /* fallback below */
  }
  const fallback = await fetch(`${API_URL}/orders?limit=500`, { cache: 'no-store' as RequestCache });
  const data = (await fallback.json().catch(() => ({}))) as { orders?: any[] };
  return Array.isArray(data.orders) ? data.orders : [];
}
