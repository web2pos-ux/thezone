import { useCallback, useMemo, useState } from 'react';
import { OrderItem, MenuItem } from '../pages/order/orderTypes';

export interface UseOrderManagementResult {
  orderItems: OrderItem[];
  setOrderItems: React.Dispatch<React.SetStateAction<OrderItem[]>>;
  subtotal: number;
  taxesTotal: number;
  total: number;
  guestCount: number;
  activeGuestNumber: number;
  setActiveGuestNumber: React.Dispatch<React.SetStateAction<number>>;
  handleSplitOrderClick: () => void;
  addToOrder: (item: MenuItem) => void;
  updateQuantity: (itemId: string, change: number) => void;
  removeItem: (itemId: string) => void;
  moveItemToGuest: (rowIndex: number, targetGuestNumber: number) => void;
  updateQuantityByLineId: (orderLineId: string, change: number) => void;
  removeItemByLineId: (orderLineId: string) => void;
  initializeSplitGuests: (guestNumbers: number[]) => void;
  mergeIdenticalItems: (items: OrderItem[]) => OrderItem[];
  getMergedOrderItems: () => OrderItem[];
}

/**
 * 동일 아이템 병합 유틸리티 함수 (독립적으로 사용 가능)
 * 같은 메뉴 + 같은 옵션(모디파이어) + 같은 메모 + 같은 게스트 → 수량 합산
 * 다른 옵션이면 별도 줄 유지
 */
export function mergeOrderItems(items: OrderItem[]): OrderItem[] {
  const result: OrderItem[] = [];
  const mergeMap = new Map<string, number>(); // signature → index in result

  for (const item of items) {
    if (item.type === 'separator' || item.type === 'discount' || item.type === 'void') {
      result.push(item);
      // separator에서 merge map 초기화하여 게스트 블록 독립 유지
      if (item.type === 'separator') {
        mergeMap.clear();
      }
      continue;
    }

    // 병합 키 생성: item_id + guestNumber + modifiers + memo + discount + togoLabel
    const modKey = JSON.stringify(
      ((item.modifiers || []) as any[]).map((m: any) => ({
        groupId: m.groupId,
        modifierIds: [...(m.modifierIds || [])].sort(),
      })).sort((a, b) => (a.groupId || '').localeCompare(b.groupId || ''))
    );
    const memoKey = JSON.stringify((item as any).memo || null);
    const discountKey = JSON.stringify((item as any).discount || null);
    const togoKey = (item as any).togoLabel ? 1 : 0;
    const preSplitKey = (item as any)._preSplit ? 1 : 0;
    const key = `${item.id}|${item.guestNumber || 1}|${modKey}|${memoKey}|${discountKey}|${togoKey}|${preSplitKey}`;

    if (mergeMap.has(key)) {
      const existingIdx = mergeMap.get(key)!;
      const existingItem = result[existingIdx];
      // 수량 합산
      result[existingIdx] = {
        ...existingItem,
        quantity: (existingItem.quantity || 1) + (item.quantity || 1),
      } as OrderItem;
    } else {
      mergeMap.set(key, result.length);
      result.push({ ...item });
    }
  }

  return result;
}

export function useOrderManagement(): UseOrderManagementResult {
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [guestCount, setGuestCount] = useState<number>(1);
  const [activeGuestNumber, setActiveGuestNumber] = useState<number>(1);

  const isSplitV2Enabled = () => {
    try {
      const v = localStorage.getItem('SPLIT_BEHAVIOR_V2');
      if (v === null) return true; // default ON
      return v === '1';
    } catch {
      return true; // fail-open to ON
    }
  };

  const cleanupEmptySeparators = useCallback((items: OrderItem[]): OrderItem[] => {
    const enabled = isSplitV2Enabled();
    if (!enabled) {
      // Legacy behavior: keep separators if present; otherwise compress or reset
      const guestNumbersWithItems = new Set<number>();
      items.forEach(item => {
        if (item.type === 'item' && item.guestNumber) {
          guestNumbersWithItems.add(item.guestNumber);
        }
      });
      const separatorGuests = new Set<number>(items.filter(it => it.type === 'separator' && typeof it.guestNumber === 'number').map(it => it.guestNumber as number));
      if (separatorGuests.size > 0) {
        const maxSepGuest = Math.max(...Array.from(separatorGuests));
        if (Number.isFinite(maxSepGuest)) {
          setGuestCount(maxSepGuest);
          if (!guestNumbersWithItems.has(activeGuestNumber)) {
            setActiveGuestNumber(Math.min(maxSepGuest, Math.max(1, activeGuestNumber || 1)));
          }
        }
        return items;
      }
      if (guestNumbersWithItems.size === 0) {
        setGuestCount(1);
        setActiveGuestNumber(1);
        return [];
      }
      if (guestNumbersWithItems.size === 1) {
        setGuestCount(1);
        setActiveGuestNumber(1);
        return items.filter(item => item.type !== 'separator').map(item => ({ ...item, guestNumber: 1 }));
      }
      const sortedGuestNumbers = Array.from(guestNumbersWithItems).sort((a, b) => a - b);
      const guestNumberMapping = new Map<number, number>();
      sortedGuestNumbers.forEach((originalNumber, index) => {
        guestNumberMapping.set(originalNumber, index + 1);
      });
      const cleaned: OrderItem[] = [];
      items.forEach(item => {
        if (item.type === 'separator') {
          if (guestNumbersWithItems.has(item.guestNumber!)) {
            cleaned.push({ ...item, guestNumber: guestNumberMapping.get(item.guestNumber!) || item.guestNumber! });
          }
        } else if (item.type === 'item' && item.guestNumber) {
          cleaned.push({ ...item, guestNumber: guestNumberMapping.get(item.guestNumber) || item.guestNumber });
        } else {
          cleaned.push(item);
        }
      });
      const maxGuestNumber = Math.max(...Array.from(guestNumbersWithItems).map(num => guestNumberMapping.get(num) || num));
      setGuestCount(maxGuestNumber);
      setActiveGuestNumber(maxGuestNumber);
      return cleaned;
    }

    // V2 behavior
    const guestNumbersWithItems = new Set<number>();
    items.forEach(item => {
      if ((item.type === 'item' || (item as any).type === 'void') && item.guestNumber) {
        guestNumbersWithItems.add(item.guestNumber);
      }
    });

    const hadSeparators = items.some(it => it.type === 'separator');

    // If there are no items at all → reset to single-guest blank (but keep Guest 1 separator if present)
    if (guestNumbersWithItems.size === 0) {
      setGuestCount(1);
      setActiveGuestNumber(1);
      // Keep at most one Guest 1 separator if it exists (from first Split click)
      const sep1 = items.find(it => it.type === 'separator' && it.guestNumber === 1);
      return sep1 ? ([{ ...sep1 }]) as OrderItem[] : [];
    }

    // If all items are in one guest, remove all separators and normalize to guest 1
    if (guestNumbersWithItems.size === 1) {
      setGuestCount(1);
      setActiveGuestNumber(1);
      const singleGuest = Array.from(guestNumbersWithItems)[0];
      return items.filter(it => it.type !== 'separator').map(it => ({ ...it, guestNumber: 1 }));
    }

    // If split separators are NOT present yet, do NOT create them.
    // Normalize everything to single guest without separators so headers don't appear before Split.
    if (!hadSeparators) {
      setGuestCount(1);
      setActiveGuestNumber(1);
      return items.filter(it => it.type !== 'separator').map(it => ({ ...it, guestNumber: 1 }));
    }

    // Separators exist → compact to 1..N and rebuild blocks with separators
    const sortedGuestNumbers = Array.from(guestNumbersWithItems).sort((a, b) => a - b);
    const guestNumberMapping = new Map<number, number>();
    sortedGuestNumbers.forEach((originalNumber, index) => {
      guestNumberMapping.set(originalNumber, index + 1);
    });

    const itemsByOriginalGuest = new Map<number, OrderItem[]>();
    sortedGuestNumbers.forEach(g => itemsByOriginalGuest.set(g, []));
    items.forEach(it => {
      if (it.type !== 'separator' && typeof it.guestNumber === 'number' && itemsByOriginalGuest.has(it.guestNumber)) {
        // Preserve both 'item' and 'void' lines
        itemsByOriginalGuest.get(it.guestNumber)!.push(it);
      }
    });

    const cleaned: OrderItem[] = [];
    sortedGuestNumbers.forEach(origGuest => {
      const mappedGuest = guestNumberMapping.get(origGuest)!;
      cleaned.push({ id: `sep-guest-${mappedGuest}` as any, name: `구분선 Guest ${mappedGuest}`, quantity: 0, price: 0, totalPrice: 0, type: 'separator', guestNumber: mappedGuest } as OrderItem);
      const list = itemsByOriginalGuest.get(origGuest)!;
      list.forEach(it => { cleaned.push({ ...it, guestNumber: mappedGuest }); });
    });

    const maxGuestNumber = sortedGuestNumbers.length;
    setGuestCount(maxGuestNumber);
    if (guestNumbersWithItems.has(activeGuestNumber)) {
      setActiveGuestNumber(guestNumberMapping.get(activeGuestNumber) || 1);
    } else {
      const greater = sortedGuestNumbers.find(g => g > activeGuestNumber);
      if (typeof greater === 'number') {
        setActiveGuestNumber(guestNumberMapping.get(greater) || maxGuestNumber);
      } else {
        setActiveGuestNumber(maxGuestNumber);
      }
    }

    return cleaned;
  }, [activeGuestNumber]);

  const handleSplitOrderClick = useCallback(() => {
    setOrderItems(prev => {
      const hasRealItems = prev.some(it => it.type === 'item');
      const separators = prev.filter(it => it.type === 'separator');
      const separatorCount = separators.length;

      // Case A: No real items yet → create only Guest 1 header once
      if (!hasRealItems) {
        if (separatorCount >= 1) {
          // Already prepared once; ignore subsequent clicks until items exist
          return prev;
        }
        setGuestCount(1);
        setActiveGuestNumber(1);
        return [
          { id: `sep-guest-1`, name: `구분선 Guest 1`, quantity: 0, price: 0, totalPrice: 0, type: 'separator', guestNumber: 1 } as OrderItem,
        ];
      }

      // Case B: There are real items
      // If single-guest state
      if (guestCount === 1) {
        const hasSepGuest1 = separators.some(s => s.guestNumber === 1);
        if (hasSepGuest1) {
          // Already showing Guest 1 header → just add Guest 2 header
          const next: OrderItem[] = [
            ...prev,
            { id: `sep-guest-2`, name: `구분선 Guest 2`, quantity: 0, price: 0, totalPrice: 0, type: 'separator', guestNumber: 2 } as OrderItem,
          ];
          setGuestCount(2);
          setActiveGuestNumber(2);
          return next;
        }
        // Legacy path: no separators yet, add both and normalize items under Guest 1
        const withTop: OrderItem[] = [
          { id: `sep-guest-1`, name: `구분선1/2 Guest 1 구분선`, quantity: 0, price: 0, totalPrice: 0, type: 'separator', guestNumber: 1 } as OrderItem,
          ...prev.filter(p => p.type !== 'separator').map(p => ({ ...p, type: 'item' as const, guestNumber: 1 })),
        ];
        const withBottom: OrderItem[] = [
          ...withTop,
          { id: `sep-guest-2`, name: `구분선1/2 Guest 2 구분선1/2`, quantity: 0, price: 0, totalPrice: 0, type: 'separator', guestNumber: 2 } as OrderItem,
        ];
        setGuestCount(2);
        setActiveGuestNumber(2);
        return withBottom;
      }

      // Case C: 2명 이상인 상태에서 다음 게스트 추가 로직 유지
      const nextGuest = guestCount + 1;
      const lastSeparator = prev.filter(item => item.type === 'separator').pop();
      if (lastSeparator) {
        const lastGuestNumber = lastSeparator.guestNumber;
        const hasItemsForLastGuest = prev.some(orderItem => orderItem.type === 'item' && orderItem.guestNumber === lastGuestNumber);
        if (!hasItemsForLastGuest) {
          return prev;
        }
      }
      const newList: OrderItem[] = [...prev];
      newList.push({ id: `sep-guest-${nextGuest}`, name: `구분선1/2 Guest ${nextGuest} 구분선1/2`, quantity: 0, price: 0, totalPrice: 0, type: 'separator', guestNumber: nextGuest } as OrderItem);
      setGuestCount(nextGuest);
      setActiveGuestNumber(nextGuest);
      return newList;
    });
  }, [guestCount]);

  // ── 동일 아이템 병합 유틸리티 (내부용 - 외부 함수 mergeOrderItems 사용) ──
  const mergeIdenticalItems = useCallback((items: OrderItem[]): OrderItem[] => {
    return mergeOrderItems(items);
  }, []);

  // ── 병합된 주문 아이템 반환 (저장 전 호출용) ──
  const getMergedOrderItems = useCallback((): OrderItem[] => {
    return mergeOrderItems(orderItems);
  }, [orderItems]);

  const addToOrder = useCallback((item: MenuItem) => {
    setOrderItems(prev => {
      // 동일 아이템을 여러 번 누르면 새 줄을 만들지 않고 수량을 증가시킴
      // (메뉴 + 옵션(모디파이어) + 메모 + 게스트가 모두 같을 때만 병합)
      const orderLineId = `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const newOrderItem: OrderItem = {
        id: item.id,
        name: item.name,
        short_name: (item as any).short_name,
        quantity: 1,
        price: item.price,
        modifiers: [],
        totalPrice: item.price,
        type: 'item',
        guestNumber: activeGuestNumber || 1,
        orderLineId,
        togoLabel: !!(item as any).togoLabel,
        ...(Array.isArray((item as any).printer_groups) && (item as any).printer_groups.length > 0
          ? { printer_groups: (item as any).printer_groups }
          : {}),
      };
      const next = cleanupEmptySeparators([...prev, newOrderItem]);
      return mergeOrderItems(next);
    });
  }, [activeGuestNumber, cleanupEmptySeparators]);

  const updateQuantity = useCallback((itemId: string, change: number) => {
    setOrderItems(prev => {
      const updated = prev.map(item => {
        if (item.id === itemId) {
          const newQuantity = item.quantity + change;
          if (newQuantity <= 0) {
            return null as any;
          }
          return { ...item, quantity: newQuantity };
        }
        return item;
      }).filter(Boolean) as OrderItem[];
      const cleaned = cleanupEmptySeparators(updated);
      const remainingGuestNumbers = cleaned.filter(item => item.type === 'item' && item.guestNumber).map(item => item.guestNumber!).sort((a, b) => a - b);
      if (remainingGuestNumbers.length > 0) {
        setActiveGuestNumber(Math.max(...remainingGuestNumbers));
      } else {
        setActiveGuestNumber(1);
      }
      return cleaned;
    });
  }, [cleanupEmptySeparators]);

  const updateQuantityByLineId = useCallback((orderLineId: string, change: number) => {
    setOrderItems(prev => {
      const updated = prev.map(item => {
        if ((item as any).orderLineId === orderLineId) {
          const newQuantity = (item.quantity || 0) + change;
          if (newQuantity <= 0) return null as any;
          // 저장된 아이템(orderLineId가 있음)의 수량 증가 추적
          let quantityDelta = ((item as any).quantityDelta || 0);
          if (change > 0) {
            // +버튼: 증가량 누적
            quantityDelta += change;
          }
          return { ...item, quantity: newQuantity, quantityDelta } as OrderItem;
        }
        return item;
      }).filter(Boolean) as OrderItem[];
      const cleaned = cleanupEmptySeparators(updated);
      const remainingGuestNumbers = cleaned.filter(item => item.type === 'item' && item.guestNumber).map(item => item.guestNumber!).sort((a, b) => a - b);
      if (remainingGuestNumbers.length > 0) {
        setActiveGuestNumber(Math.max(...remainingGuestNumbers));
      } else {
        setActiveGuestNumber(1);
      }
      return cleaned;
    });
  }, [cleanupEmptySeparators]);

  const removeItem = useCallback((itemId: string) => {
    setOrderItems(prev => {
      const filtered = prev.filter(item => item.id !== itemId);
      const cleaned = cleanupEmptySeparators(filtered);
      const remainingGuestNumbers = cleaned.filter(item => item.type === 'item' && item.guestNumber).map(item => item.guestNumber!).sort((a, b) => a - b);
      if (remainingGuestNumbers.length > 0) {
        setActiveGuestNumber(Math.max(...remainingGuestNumbers));
      } else {
        setActiveGuestNumber(1);
      }
      return cleaned;
    });
  }, [cleanupEmptySeparators]);

  const removeItemByLineId = useCallback((orderLineId: string) => {
    setOrderItems(prev => {
      const filtered = prev.filter(item => (item as any).orderLineId !== orderLineId);
      const cleaned = cleanupEmptySeparators(filtered);
      const remainingGuestNumbers = cleaned.filter(item => item.type === 'item' && item.guestNumber).map(item => item.guestNumber!).sort((a, b) => a - b);
      if (remainingGuestNumbers.length > 0) {
        setActiveGuestNumber(Math.max(...remainingGuestNumbers));
      } else {
        setActiveGuestNumber(1);
      }
      return cleaned;
    });
  }, [cleanupEmptySeparators]);

  const moveItemToGuest = useCallback((rowIndex: number, targetGuestNumber: number) => {
    setOrderItems(prev => {
      if (rowIndex < 0 || rowIndex >= prev.length) return prev;
      const item = prev[rowIndex];
      if (!item || item.type === 'separator') return prev;
      if (typeof item.guestNumber === 'number' && item.guestNumber === targetGuestNumber) return prev;

      const sourceItem = item;

      const getBaseIdFromId = (rawId: string) => {
        const parts = String(rawId || '').split(/-(split|share)-/);
        return (parts && parts.length > 1) ? parts[0] : String(rawId || '');
      };
      const sourceBaseId = getBaseIdFromId(sourceItem.id);

      // A) Decrement source by 1 (or remove if quantity hits 0)
      let base: OrderItem[];
      if ((sourceItem.quantity || 1) > 1) {
        base = prev.map((it, idx) => idx === rowIndex ? { ...it, quantity: (it.quantity || 1) - 1 } : it);
      } else {
        base = prev.filter((_, idx) => idx !== rowIndex);
      }

      // B) Ensure target guest separator exists
      let targetSepIndex = base.findIndex(it => it.type === 'separator' && it.guestNumber === targetGuestNumber);
      let withTargetSep = [...base];
      if (targetSepIndex === -1) {
        withTargetSep.push({ id: `sep-guest-${targetGuestNumber}`, name: `구분선 Guest ${targetGuestNumber}`, quantity: 0, price: 0, totalPrice: 0, type: 'separator', guestNumber: targetGuestNumber });
        targetSepIndex = withTargetSep.length - 1;
      }

      // C) Compute insert position within target guest block
      let insertPos = targetSepIndex + 1;
      let nextSepIndex = withTargetSep.length;
      for (let i = targetSepIndex + 1; i < withTargetSep.length; i++) {
        const cur = withTargetSep[i];
        if (cur.type === 'separator') { nextSepIndex = i; break; }
        insertPos = i + 1;
      }

      // D) Merge 1 unit into existing same item (same base id/modifiers/memo). For fractional, require same denom and unit price.
      const findMergeIndex = () => {
        for (let i = targetSepIndex + 1; i < nextSepIndex; i++) {
          const cur = withTargetSep[i];
          if (cur.type !== 'item') continue;
          const curBaseId = getBaseIdFromId(cur.id);
          if (curBaseId !== sourceBaseId) continue;
          const sameTogoLabel = !!(cur as any).togoLabel === !!(sourceItem as any).togoLabel;
          if (!sameTogoLabel) continue;
          const sameModifiers = JSON.stringify(cur.modifiers || []) === JSON.stringify(sourceItem.modifiers || []);
          const sameMemo = JSON.stringify((cur as any).memo || null) === JSON.stringify((sourceItem as any).memo || null);
          if (!sameModifiers || !sameMemo) continue;
          const srcDen = (sourceItem as any).splitDenominator as number | undefined;
          const curDen = (cur as any).splitDenominator as number | undefined;
          if (srcDen || curDen) {
            if (!srcDen || !curDen) continue;
            const sameDen = srcDen === curDen;
            const sameUnitPrice = Number(cur.totalPrice) === Number(sourceItem.totalPrice);
            if (!sameDen || !sameUnitPrice) continue;
          }
          return i;
        }
        return -1;
      };

      let updated: OrderItem[] = withTargetSep;
      const mergeIndex = findMergeIndex();
      if (mergeIndex !== -1) {
        updated = withTargetSep.map((it, idx) => idx === mergeIndex ? { ...it, quantity: (it.quantity || 0) + 1 } : it);
      } else {
        const toInsert: OrderItem = { ...sourceItem, guestNumber: targetGuestNumber, quantity: 1, orderLineId: `${sourceItem.id}-${Date.now()}-${Math.random().toString(36).slice(2,8)}` } as OrderItem;
        updated = [
          ...withTargetSep.slice(0, insertPos),
          toInsert,
          ...withTargetSep.slice(insertPos)
        ];
      }

      // E) Cleanup and focus target guest
      const cleaned = cleanupEmptySeparators(updated);
      setActiveGuestNumber(targetGuestNumber);
      return cleaned;
    });
  }, [cleanupEmptySeparators]);

  const initializeSplitGuests = useCallback((guestNumbers: number[]) => {
    const uniqueSorted = Array.from(new Set((guestNumbers || []).map(n => Number(n)).filter(n => Number.isFinite(n) && n > 0))).sort((a, b) => a - b);
    const maxGuest = uniqueSorted.length > 0 ? uniqueSorted[uniqueSorted.length - 1] : 1;
    setGuestCount(maxGuest);
    setActiveGuestNumber(uniqueSorted.length > 0 ? uniqueSorted[0] : 1);
    setOrderItems(prev => {
      const list: OrderItem[] = [...prev];
      const existingSepGuests = new Set<number>(list.filter(it => it.type === 'separator' && typeof it.guestNumber === 'number').map(it => it.guestNumber as number));
      uniqueSorted.forEach(g => {
        if (!existingSepGuests.has(g)) {
          list.push({ id: `sep-guest-${g}`, name: `구분선 Guest ${g}`, quantity: 0, price: 0, totalPrice: 0, type: 'separator', guestNumber: g });
        }
      });
      return list;
    });
  }, []);

  const subtotal = useMemo(() => {
    return orderItems.reduce((sum, item) => {
      if (item.type === 'separator') return sum;
      const memoPrice = ((item as any).memo && typeof (item as any).memo.price === 'number') ? (item as any).memo.price : 0;
      return sum + ((item.totalPrice + memoPrice) * item.quantity);
    }, 0);
  }, [orderItems]);

  // taxesTotal/total 계산은 외부에서 tax map을 받아계산하도록 필요 시 확장 가능
  const taxesTotal = 0;
  const total = subtotal + taxesTotal;

  return {
    orderItems,
    setOrderItems,
    subtotal,
    taxesTotal,
    total,
    guestCount,
    activeGuestNumber,
    setActiveGuestNumber,
    handleSplitOrderClick,
    addToOrder,
    updateQuantity,
    removeItem,
    moveItemToGuest,
    updateQuantityByLineId,
    removeItemByLineId,
    initializeSplitGuests,
    mergeIdenticalItems,
    getMergedOrderItems,
  };
} 