export interface OrderSequenceCandidate {
  id?: number | string;
  type?: string;
  createdAt?: string | number | Date | null;
  created_at?: string | number | Date | null;
}

export type SequencedOrder<T extends OrderSequenceCandidate> = T & { sequenceNumber: number | null };

const formatDateKey = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const resolveDateKey = (order?: OrderSequenceCandidate) => {
  const candidates = [order?.createdAt, order?.created_at];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = candidate instanceof Date ? candidate : new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) {
      return formatDateKey(parsed);
    }
  }
  return formatDateKey(new Date());
};

const resolveTimestamp = (order?: OrderSequenceCandidate) => {
  const candidates = [order?.createdAt, order?.created_at];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = candidate instanceof Date ? candidate : new Date(candidate);
    const stamp = parsed.getTime();
    if (!Number.isNaN(stamp)) {
      return stamp;
    }
  }
  if (typeof order?.id === 'number') return order.id;
  const numericId = order?.id != null ? Number(order.id) : NaN;
  if (Number.isFinite(numericId)) return numericId as number;
  return Date.now();
};

export const assignDailySequenceNumbers = <T extends OrderSequenceCandidate>(
  orders: T[],
  fallbackType: string = 'TOGO'
): SequencedOrder<T>[] => {
  if (!Array.isArray(orders) || orders.length === 0) {
    return Array.isArray(orders) ? orders.map((order) => ({ ...order, sequenceNumber: null })) : [];
  }

  const decorated = orders.map((order, index) => ({ order, index }));
  decorated.sort((a, b) => resolveTimestamp(a.order) - resolveTimestamp(b.order));

  const bucketCounters = new Map<string, number>();
  const sequenceByIndex: Record<number, number> = {};

  decorated.forEach(({ order, index }) => {
    const typeKey = String(order?.type || fallbackType).trim().toUpperCase();
    const dateKey = resolveDateKey(order);
    const bucketKey = `${typeKey}-${dateKey}`;
    const nextSeq = (bucketCounters.get(bucketKey) || 0) + 1;
    bucketCounters.set(bucketKey, nextSeq);
    sequenceByIndex[index] = nextSeq;
  });

  return orders.map((order, index) => ({
    ...order,
    sequenceNumber: sequenceByIndex[index] ?? null,
  }));
};


