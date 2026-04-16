/**
 * Pickup List 상세: Kitchen·온라인 API는 Firestore `items`를 쓰고, SQLite는 병합/오류로
 * 한 줄·수량만 있을 수 있어 `GET /online-orders/order/:firebaseId`로 라인 목록을 맞춘다.
 */

function unitPriceFromFirebaseLine(it: Record<string, unknown>, qty: number): number {
  const q = Math.max(1, qty);
  const u =
    it.unitPrice ?? it.unit_price ?? (it as any).unitPrice;
  if (u != null && Number.isFinite(Number(u))) return Number(u);
  const sub = (it.subtotal ?? it.lineTotal ?? it.line_total ?? it.totalLinePrice) as number | undefined;
  if (sub != null && Number.isFinite(Number(sub)) && q > 0) return Number(sub) / q;
  return Number((it.price as number) ?? 0);
}

function mapFirebaseLineToSqliteShape(it: Record<string, unknown>, idx: number): Record<string, unknown> {
  const qty = Math.max(1, Number((it.quantity as number) ?? 1));
  const price = unitPriceFromFirebaseLine(it, qty);
  const lineSub = (it.subtotal ?? it.lineTotal ?? it.line_total) as number | undefined;
  const totalPrice =
    lineSub != null && Number.isFinite(Number(lineSub))
      ? Number(lineSub)
      : Number((price * qty).toFixed(2));

  let modifiersJson: string | null = null;
  const rawMod = it.modifiers ?? it.options;
  if (rawMod != null) {
    modifiersJson = typeof rawMod === 'string' ? rawMod : JSON.stringify(rawMod);
  }

  let memoJson: string | null = null;
  const memo = it.memo ?? it.note ?? it.specialInstructions;
  if (memo != null) {
    if (typeof memo === 'string') memoJson = JSON.stringify({ text: memo });
    else if (typeof memo === 'object') memoJson = JSON.stringify(memo);
    else memoJson = JSON.stringify({ text: String(memo) });
  }

  return {
    id: (it.id as string | number) ?? `fb-line-${idx}`,
    item_id: (it.posItemId ?? it.itemId ?? it.item_id) as string | number | null,
    name: String(it.name || ''),
    quantity: qty,
    price,
    total_price: totalPrice,
    modifiers_json: modifiersJson,
    modifiers: Array.isArray(rawMod) ? rawMod : [],
    memo_json: memoJson,
    togo_label: (it.togoLabel ?? it.togo_label) ? 1 : 0,
    discountAmount: Number((it as any).discountAmount || 0),
    discountPercent: Number((it as any).discountPercent || 0),
    promotionName: (it as any).promotionName || null,
  };
}

export async function fetchPickupDetailItemsPreferFirebase(
  apiUrl: string,
  orderRow: Record<string, unknown> | null | undefined,
  sqliteItems: any[]
): Promise<any[]> {
  const base = sqliteItems && Array.isArray(sqliteItems) ? sqliteItems : [];
  const fid = String(
    orderRow?.firebase_order_id ?? (orderRow as any)?.firebaseOrderId ?? ''
  ).trim();
  if (!fid) return base;

  const ot = String(orderRow?.order_type ?? (orderRow as any)?.orderType ?? '').toUpperCase();
  const fm = String(orderRow?.fulfillment_mode ?? (orderRow as any)?.fulfillmentMode ?? '').toLowerCase();
  const tid = String(
    (orderRow as any)?.table_id ?? (orderRow as any)?.tableId ?? ''
  )
    .trim()
    .toUpperCase();
  const hasOnlineNum =
    String((orderRow as any)?.online_order_number ?? (orderRow as any)?.onlineOrderNumber ?? '')
      .trim() !== '';
  const isOnlineChannel =
    ot === 'ONLINE' ||
    ot === 'WEB' ||
    ot === 'QR' ||
    fm === 'online' ||
    fm === 'web' ||
    fm === 'qr' ||
    hasOnlineNum ||
    tid.startsWith('OL');
  if (!isOnlineChannel) return base;

  try {
    const res = await fetch(`${apiUrl}/online-orders/order/${encodeURIComponent(fid)}`);
    if (!res.ok) return base;
    const data = await res.json();
    const fbOrder = data?.order;
    const rawItems = fbOrder?.items;
    if (!data?.success || !Array.isArray(rawItems) || rawItems.length === 0) return base;

    return rawItems.map((it: Record<string, unknown>, idx: number) => mapFirebaseLineToSqliteShape(it, idx));
  } catch {
    return base;
  }
}
