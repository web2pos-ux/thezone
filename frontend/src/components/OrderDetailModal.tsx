/**
 * OrderDetailModal - 공용 주문 상세 모달 컴포넌트
 * FSR/QSR 모드 모두에서 사용 가능
 * - Delivery / Online / Togo(Pickup) 주문 목록 표시
 * - 주문 상세 정보 표시
 * - Print Bill, Reprint, Pay/Pickup 기능
 */

import React, { useState, useEffect, useCallback } from 'react';
import { API_URL } from '../config/constants';
import { calculateOrderPricing } from '../utils/orderPricing';
import { fetchPickupDetailItemsPreferFirebase } from '../utils/onlineOrderPickupDetailItems';
import {
  NEO_COLOR_BTN_PRESS_NO_SHIFT,
  NEO_PRESS_INSET_AMBER_NO_SHIFT,
  NEO_PRESS_INSET_ONLY_NO_SHIFT,
  PAY_NEO,
  PAY_NEO_CANVAS,
  PAY_NEO_PRIMARY_AMBER,
  PAY_NEO_PRIMARY_BLUE,
} from '../utils/softNeumorphic';

/** 투고/온라인/딜리버리 상세 — 아이템·세금 블록만 인셋 네오 제거(플랫) */
const ORDER_ITEMS_TAX_PANEL_FLAT: React.CSSProperties = {
  background: PAY_NEO_CANVAS,
  borderRadius: 14,
  border: '1px solid #c5cad4',
  boxShadow: 'none',
};

// 주문 타입 정의
export type OrderChannelType = 'delivery' | 'online' | 'togo' | 'pickup';

export interface OrderItem {
  name: string;
  quantity: number;
  price: number;
  options?: any[];
  modifiers?: any[];
  memo?: string;
  taxRate?: number;
  taxDetails?: Array<{ name: string; rate: number }>;
}

export interface OrderData {
  id: string | number;
  number?: string | number;
  name?: string;
  customerName?: string;
  phone?: string;
  customerPhone?: string;
  total?: number;
  subtotal?: number;
  tax?: number;
  status?: string;
  paymentStatus?: string;
  paid?: boolean;
  time?: string;
  createdAt?: string;
  placedTime?: string | Date;
  pickupTime?: any;
  readyTimeLabel?: string;
  readyTime?: string;
  ready_time?: string;
  pickupMinutes?: number;
  prepTime?: number;
  items?: OrderItem[] | string[];
  fullOrder?: any;
  localOrderId?: number;
  deliveryCompany?: string;
  deliveryOrderNumber?: string;
  order_id?: number;
  orderSource?: string;
  order_source?: string;
  isLoading?: boolean;
  [key: string]: any;
}

export interface OrderDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  // 주문 데이터
  onlineOrders: OrderData[];
  togoOrders: OrderData[];
  deliveryOrders: OrderData[];
  // 초기 선택 타입 (선택적)
  initialOrderType?: OrderChannelType;
  initialSelectedOrder?: OrderData | null;
  // 콜백 함수들
  onPayment: (order: OrderData, orderType: OrderChannelType) => void;
  onPickupComplete: (order: OrderData, orderType: OrderChannelType) => void;
  onVoid?: (order: OrderData, orderType: OrderChannelType) => void;
  onBackToOrder?: (order: OrderData, orderType: OrderChannelType) => void;
  onOrdersRefresh: () => void;
  // UI 옵션
  embedded?: boolean;  // true면 모달 배경 없이 탭 안에 내장
  showTabs?: boolean;  // 상단 탭 표시 여부 (default: true)
  defaultTab?: OrderChannelType;  // 기본 선택 탭
  /** QSR Pickup List: Pay / Pay & Pickup 분리 (미결제 시 Pay 오른쪽에 Pay & Pickup) */
  splitPayAndPickupActions?: boolean;
  /** splitPayAndPickupActions와 함께 사용: true면 Online 탭만 Pay / Pay & Pickup, Togo는 기존 단일 Pay/Pickup */
  splitPayAndPickupOnlineOnly?: boolean;
}

const OrderDetailModal: React.FC<OrderDetailModalProps> = ({
  isOpen,
  onClose,
  onlineOrders,
  togoOrders,
  deliveryOrders,
  initialOrderType,
  initialSelectedOrder,
  onPayment,
  onPickupComplete,
  onVoid,
  onBackToOrder,
  onOrdersRefresh,
  embedded = false,
  showTabs = true,
  defaultTab = 'togo',
  splitPayAndPickupActions = false,
  splitPayAndPickupOnlineOnly = false,
}) => {
  // 현재 선택된 탭
  const [selectedOrderType, setSelectedOrderType] = useState<OrderChannelType>(
    initialOrderType || defaultTab
  );
  
  // 현재 선택된 주문
  const [selectedOrderDetail, setSelectedOrderDetail] = useState<OrderData | null>(
    initialSelectedOrder || null
  );

  // initialOrderType이 변경되면 탭도 변경
  useEffect(() => {
    if (initialOrderType) {
      setSelectedOrderType(initialOrderType);
    }
  }, [initialOrderType]);

  // initialSelectedOrder가 변경되면 선택된 주문도 변경 (상세는 fetchOrderDetails 선언 후 로드)
  useEffect(() => {
    if (initialSelectedOrder) {
      setSelectedOrderDetail({ ...initialSelectedOrder, isLoading: true });
    }
  }, [initialSelectedOrder]);

  // 주문 상세 정보 가져오기 (Togo/Delivery)
  const fetchOrderDetails = useCallback(async (order: OrderData, orderType: OrderChannelType) => {
    const toNumericOrderId = (v: any): number | null => {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      const s = String(v ?? '').trim();
      if (!s) return null;
      if (!/^\d+$/.test(s)) return null;
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    };

    const pickActualOrderId = (): number | null => {
      if (!order) return null;
      if (orderType === 'delivery') return toNumericOrderId(order.order_id ?? order.id);
      if (orderType === 'online') {
        return toNumericOrderId(
          order.localOrderId ??
            order.fullOrder?.localOrderId ??
            (typeof order.number === 'number' ? order.number : null) ??
            order.id,
        );
      }
      // togo / pickup
      return toNumericOrderId(order.id);
    };

    const actualOrderId = pickActualOrderId();

    if ((orderType === 'togo' || orderType === 'pickup' || orderType === 'delivery' || orderType === 'online') && actualOrderId != null) {
      try {
        const res = await fetch(`${API_URL}/orders/${actualOrderId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            let rawItems = Array.isArray(data.items) ? data.items : [];
            const orderRowForFirebase = {
              ...data.order,
              firebase_order_id:
                (data.order as any)?.firebase_order_id ??
                (order as any)?.firebase_order_id ??
                (order as any)?.fullOrder?.firebase_order_id,
            };
            rawItems = await fetchPickupDetailItemsPreferFirebase(API_URL, orderRowForFirebase, rawItems);
            const parsedItems = rawItems.map((item: any) => {
              let options: any[] = [];
              let memo: any = null;
              let discount: any = null;
              try {
                if (item.modifiers_json) {
                  const mods = typeof item.modifiers_json === 'string' 
                    ? JSON.parse(item.modifiers_json) 
                    : item.modifiers_json;
                  options = Array.isArray(mods) ? mods : [];
                }
              } catch {}
              try {
                if (item.memo_json) {
                  const memoData = typeof item.memo_json === 'string'
                    ? JSON.parse(item.memo_json)
                    : item.memo_json;
                  memo = typeof memoData === 'string' ? { text: memoData } : memoData;
                }
              } catch {}
              try {
                if (item.discount_json) {
                  discount = typeof item.discount_json === 'string'
                    ? JSON.parse(item.discount_json)
                    : item.discount_json;
                }
              } catch {}
              return { ...item, options, memo, discount };
            });

            const calculatedSubtotal = parsedItems.reduce((sum: number, item: any) => 
              sum + ((item.price || 0) * (item.quantity || 1)), 0);
            
            let taxBreakdown: any = null;
            try {
              const raw = data.order?.tax_breakdown;
              if (raw && typeof raw === 'string') taxBreakdown = JSON.parse(raw);
              else if (raw && typeof raw === 'object') taxBreakdown = raw;
            } catch { taxBreakdown = null; }

            const fullOrder = {
              ...order,
              status: data.order?.status || order.status,
              paymentStatus: data.order?.paymentStatus || order.paymentStatus,
              items: parsedItems,
              localOrderId: (orderType === 'online' ? (order.localOrderId ?? actualOrderId) : order.localOrderId),
              subtotal: data.order?.subtotal ?? calculatedSubtotal,
              tax: data.order?.tax ?? 0,
              taxBreakdown,
              total: data.order?.total ?? order.total ?? 0,
              adjustments: Array.isArray(data.adjustments) ? data.adjustments : [],
              adjustments_json: data.order?.adjustments_json ?? (order as any).adjustments_json ?? null,
              online_tip: (data.order as any)?.online_tip ?? (order as any)?.online_tip ?? 0,
              tip: (data.order as any)?.online_tip ?? (order as any)?.tip ?? 0,
              _fromBackend: true,
            };
            setSelectedOrderDetail({ ...order, fullOrder, isLoading: false });
            return;
          }
        }
      } catch (e) {
        console.warn(`Failed to load ${orderType} order details:`, e);
      }
    }
    setSelectedOrderDetail({ ...order, isLoading: false });
  }, []);

  // initialSelectedOrder가 변경되면 상세 자동 로드
  useEffect(() => {
    if (initialSelectedOrder && isOpen) {
      fetchOrderDetails(initialSelectedOrder, selectedOrderType).catch(() => {});
    }
  }, [initialSelectedOrder, isOpen, selectedOrderType, fetchOrderDetails]);

  // Prevent "zombie" detail/actions when the selected order no longer exists in the list.
  // This happens when a PAID order is marked as PICKED_UP and removed from the left list.
  useEffect(() => {
    if (!isOpen) return;

    const currentOrders: OrderData[] = (() => {
      switch (selectedOrderType) {
        case 'online':
          return Array.isArray(onlineOrders) ? onlineOrders : [];
        case 'delivery':
          return Array.isArray(deliveryOrders) ? deliveryOrders : [];
        case 'togo':
        case 'pickup':
        default:
          return Array.isArray(togoOrders) ? togoOrders : [];
      }
    })();

    const visibleOrders = (currentOrders || []).filter((o) => {
      const s = String(o?.fullOrder?.status ?? o?.status ?? '').toLowerCase();
      return s !== 'picked_up' && s !== 'pickedup';
    });

    if (!visibleOrders || visibleOrders.length === 0) {
      if (selectedOrderDetail != null) setSelectedOrderDetail(null);
      return;
    }

    const selectedId = selectedOrderDetail?.id;
    const exists =
      selectedId != null &&
      visibleOrders.some((o) => String(o?.id) === String(selectedId));

    if (!exists) {
      const next = visibleOrders[0];
      setSelectedOrderDetail({ ...next, isLoading: true });
      Promise.resolve(fetchOrderDetails(next, selectedOrderType)).catch(() => {});
    }
  }, [isOpen, selectedOrderType, onlineOrders, togoOrders, deliveryOrders, selectedOrderDetail, fetchOrderDetails]);

  // 주문 클릭 핸들러
  const handleOrderClick = useCallback(async (order: OrderData, orderType: OrderChannelType) => {
    setSelectedOrderDetail({ ...order, isLoading: true });
    await fetchOrderDetails(order, orderType);
  }, [fetchOrderDetails]);

  // Print Bill 핸들러
  const handlePrintBill = useCallback(async () => {
    if (!selectedOrderDetail) return;
    
    try {
      const orderId = selectedOrderDetail.id;
      const isDelivery = selectedOrderType === 'delivery';
      const deliveryCompany = selectedOrderDetail.deliveryCompany || '';
      const deliveryOrderNumber = selectedOrderDetail.deliveryOrderNumber || '';
      
      const orderNum = isDelivery 
        ? (deliveryOrderNumber || orderId)
        : (selectedOrderType === 'togo' || selectedOrderType === 'pickup')
          ? String(orderId).padStart(3, '0')
          : (selectedOrderDetail.number || orderId);
      
      const items = selectedOrderDetail.fullOrder?.items || [];
      let grossSubtotal = 0;
      let totalItemDiscount = 0;
      const taxAccum: { [key: string]: { rate: number; amount: number } } = {};
      
      const billItems = items.map((item: any) => {
        const basePrice = Number(item.price || 0);
        
        let modifiers: any[] = [];
        const rawMods = item.options || item.modifiers || item.modifiers_json;
        if (rawMods) {
          try {
            const parsed = typeof rawMods === 'string' ? JSON.parse(rawMods) : rawMods;
            if (Array.isArray(parsed)) {
              modifiers = parsed.flatMap((mod: any) => {
                if (mod.selectedEntries && Array.isArray(mod.selectedEntries)) {
                  return mod.selectedEntries.map((entry: any) => ({
                    name: entry.name || entry.label || '',
                    price: Number(entry.price_delta || entry.priceDelta || entry.price || 0)
                  }));
                }
                if (mod.totalModifierPrice !== undefined && mod.totalModifierPrice !== null) {
                  return [{ name: mod.name || mod.label || '', price: Number(mod.totalModifierPrice || 0) }];
                }
                return [{ name: mod.name || mod.label || '', price: Number(mod.price || mod.price_delta || mod.priceDelta || 0) }];
              }).filter((m: any) => m.name);
            }
          } catch { modifiers = []; }
        }
        
        const modTotal = modifiers.reduce((s: number, m: any) => s + Number(m.price || 0), 0);
        
        let memo = item.memo || null;
        if (!memo && item.memo_json) {
          try { memo = typeof item.memo_json === 'string' ? JSON.parse(item.memo_json) : item.memo_json; } catch { memo = null; }
        }
        if (typeof memo === 'string') memo = { text: memo };
        const memoPrice = memo ? Number(memo.price || 0) : 0;
        
        const perUnit = basePrice + modTotal + memoPrice;
        const itemGross = perUnit * (item.quantity || 1);
        grossSubtotal += itemGross;
        
        let discount = item.discount || null;
        if (!discount && item.discount_json) {
          try { discount = typeof item.discount_json === 'string' ? JSON.parse(item.discount_json) : item.discount_json; } catch { discount = null; }
        }
        if (typeof discount === 'string') { try { discount = JSON.parse(discount); } catch { discount = null; } }
        let discountAmount = 0;
        if (discount && discount.value > 0) {
          discountAmount = (itemGross * discount.value) / 100;
          discount = { type: discount.type || 'Discount', value: discount.value, amount: discountAmount };
          totalItemDiscount += discountAmount;
        } else {
          discount = null;
        }
        
        const lineTotal = itemGross - discountAmount;
        
        const itemTaxDetails = item.taxDetails || [{ name: 'GST', rate: 5 }];
        itemTaxDetails.forEach((taxInfo: any) => {
          const taxName = taxInfo.name || 'Tax';
          const rate = Number(taxInfo.rate || 5);
          const taxAmt = lineTotal * (rate / 100);
          if (!taxAccum[taxName]) taxAccum[taxName] = { rate, amount: 0 };
          taxAccum[taxName].amount += taxAmt;
        });
        
        return {
          name: item.name,
          quantity: item.quantity || 1,
          price: basePrice,
          totalPrice: perUnit,
          lineTotal,
          originalTotal: discountAmount > 0 ? itemGross : undefined,
          modifiers,
          memo,
          discount
        };
      });
      
      const netSubtotal = grossSubtotal - totalItemDiscount;
      
      const taxLines = Object.entries(taxAccum).map(([name, info]) => ({
        name,
        rate: info.rate,
        amount: Number(info.amount.toFixed(2))
      }));
      const taxesTotal = taxLines.reduce((s, t) => s + t.amount, 0);
      const total = Number((netSubtotal + taxesTotal).toFixed(2));
      
      const adjustments: any[] = [];
      if (totalItemDiscount > 0.01) {
        adjustments.push({ label: 'Item Discount', amount: -totalItemDiscount });
      }
      
      const channelLabel = isDelivery ? 'DELIVERY' : (selectedOrderType === 'online' ? 'ONLINE' : 'TOGO');
      
      const billData = {
        header: {
          orderNumber: orderNum,
          channel: channelLabel,
          tableName: isDelivery ? (deliveryCompany || 'DELIVERY') : channelLabel,
          serverName: '',
          deliveryCompany: isDelivery ? deliveryCompany : undefined,
          deliveryOrderNumber: isDelivery ? deliveryOrderNumber : undefined,
        },
        orderInfo: {
          channel: channelLabel,
          tableName: isDelivery ? (deliveryCompany || 'DELIVERY') : channelLabel,
          serverName: '',
          deliveryCompany: isDelivery ? deliveryCompany : undefined,
          deliveryOrderNumber: isDelivery ? deliveryOrderNumber : undefined,
        },
        items: billItems,
        guestSections: [],
        subtotal: totalItemDiscount > 0.01 ? Number(grossSubtotal.toFixed(2)) : Number(netSubtotal.toFixed(2)),
        adjustments,
        taxLines,
        taxesTotal: Number(taxesTotal.toFixed(2)),
        total,
        footer: { message: 'Thank you!' }
      };
      
      console.log('🧾 Bill data:', billData);
      
      await fetch(`${API_URL}/printers/print-bill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billData, copies: 1 })
      });
      console.log('🧾 Bill printed');
    } catch (err) {
      console.error('Print bill error:', err);
    }
  }, [selectedOrderDetail, selectedOrderType]);

  // Reprint 핸들러 (Kitchen Ticket)
  const handleReprint = useCallback(async () => {
    if (!selectedOrderDetail) return;
    
    try {
      const orderId = selectedOrderDetail.id;
      const isDelivery = selectedOrderType === 'delivery';
      const deliveryCompany = selectedOrderDetail.deliveryCompany || '';
      const deliveryOrderNumber = selectedOrderDetail.deliveryOrderNumber || '';
      const pickupTime = selectedOrderDetail.readyTimeLabel || selectedOrderDetail.fullOrder?.ready_time || '';
      
      const orderNum = isDelivery 
        ? (deliveryOrderNumber || orderId)
        : (selectedOrderType === 'togo' || selectedOrderType === 'pickup')
          ? String(orderId).padStart(3, '0')
          : (selectedOrderDetail.number || orderId);
      
      const rawItems = (selectedOrderDetail.fullOrder?.items || selectedOrderDetail.items || []) as any[];
      let items = (Array.isArray(rawItems) ? rawItems : [])
        .filter((item: any) => item && typeof item === 'object')
        .map((item: any) => {
          let modifiers: any[] = [];
          let memo = '';
          try {
            const rawMods = item.options || item.modifiers || item.modifiers_json;
            if (rawMods) {
              const parsed = typeof rawMods === 'string' ? JSON.parse(rawMods) : rawMods;
              modifiers = Array.isArray(parsed) ? parsed : [];
            }
          } catch {}
          try {
            const rawMemo = item.memo || item.note || item.memo_json;
            if (rawMemo) {
              const parsedMemo = typeof rawMemo === 'string' ? JSON.parse(rawMemo) : rawMemo;
              memo = (typeof parsedMemo === 'string') ? parsedMemo : (parsedMemo?.text || parsedMemo?.memo || item.memo || '');
            }
          } catch {}
          return {
            id: item.id ?? item.item_id ?? item.menu_id ?? item.itemId ?? null,
            name: item.name,
            quantity: item.quantity || 1,
            price: item.price || 0,
            modifiers,
            options: modifiers,
            memo: memo || '',
          };
        })
        .filter((it: any) => !!it?.name);
      
      // POS-local order id (SQLite)
      const posOrderId =
        (isDelivery ? (selectedOrderDetail.order_id || null) : null) ||
        (selectedOrderType === 'online'
          ? (selectedOrderDetail.localOrderId ||
             selectedOrderDetail.fullOrder?.localOrderId ||
             (typeof selectedOrderDetail.number === 'number' ? selectedOrderDetail.number : null) ||
             null)
          : null) ||
        ((selectedOrderType === 'togo' || selectedOrderType === 'pickup') ? selectedOrderDetail.id : null) ||
        selectedOrderDetail.order_id ||
        selectedOrderDetail.id;

      // Online list often doesn't include item details → fetch full order before reprint
      if (!items.length && posOrderId) {
        try {
          const res = await fetch(`${API_URL}/orders/${posOrderId}`);
          if (res.ok) {
            const data = await res.json();
            if (data?.success && Array.isArray(data?.items)) {
              const fetchedItems = data.items as any[];
              items = fetchedItems
                .filter((item: any) => item && typeof item === 'object')
                .map((item: any) => {
                  let modifiers: any[] = [];
                  let memo = '';
                  try {
                    const rawMods = item.modifiers_json || item.options || item.modifiers;
                    if (rawMods) {
                      const parsed = typeof rawMods === 'string' ? JSON.parse(rawMods) : rawMods;
                      modifiers = Array.isArray(parsed) ? parsed : [];
                    }
                  } catch {}
                  try {
                    const rawMemo = item.memo_json || item.memo || item.note;
                    if (rawMemo) {
                      const parsedMemo = typeof rawMemo === 'string' ? JSON.parse(rawMemo) : rawMemo;
                      memo = (typeof parsedMemo === 'string') ? parsedMemo : (parsedMemo?.text || parsedMemo?.memo || item.memo || '');
                    }
                  } catch {}
                  return {
                    id: item.id ?? item.item_id ?? item.menu_id ?? item.itemId ?? null,
                    name: item.name,
                    quantity: item.quantity || 1,
                    price: item.price || 0,
                    modifiers,
                    options: modifiers,
                    memo: memo || '',
                  };
                })
                .filter((it: any) => !!it?.name);
            }
          }
        } catch (e) {
          console.warn('Reprint: failed to load order items:', e);
        }
      }
      const orderTypeDisplay = isDelivery ? 'DELIVERY' :
        selectedOrderType === 'online' ? 'ONLINE' :
        selectedOrderType === 'pickup' ? 'PICKUP' :
        selectedOrderType === 'togo' ? 'TOGO' : 'DINE-IN';
      
      const status = (selectedOrderDetail?.fullOrder?.status || selectedOrderDetail?.status || '').toLowerCase();
      const isPaid = status === 'paid' || status === 'completed' || status === 'closed';
      
      const customerPhone = selectedOrderDetail.phone || selectedOrderDetail.customerPhone || 
        selectedOrderDetail.fullOrder?.customerPhone || selectedOrderDetail.customer_phone || '';
      const customerName = selectedOrderDetail.name || selectedOrderDetail.customerName || 
        selectedOrderDetail.fullOrder?.customerName || selectedOrderDetail.customer_name || '';
      
      const r = await fetch(`${API_URL}/printers/print-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items,
          orderInfo: {
            channel: orderTypeDisplay,
            orderType: orderTypeDisplay,
            orderSource: isDelivery ? (deliveryCompany || 'DELIVERY') : orderTypeDisplay,
            orderNumber: orderNum,
            deliveryCompany: isDelivery ? deliveryCompany : undefined,
            deliveryOrderNumber: isDelivery ? deliveryOrderNumber : undefined,
            pickupTime: pickupTime,
            posOrderId: posOrderId,
            customerPhone: customerPhone,
            customerName: customerName,
          },
          isReprint: true,
          isPaid: isPaid
        })
      });
      if (!r.ok) {
        const msg = await r.text().catch(() => '');
        console.warn('Reprint failed:', msg);
      }
      console.log('🖨️ Kitchen Ticket reprinted');
    } catch (err) {
      console.error('Reprint error:', err);
    }
  }, [selectedOrderDetail, selectedOrderType]);

  const buildUnpaidPaymentPayload = useCallback((): OrderData | null => {
    if (!selectedOrderDetail) return null;
    const items = selectedOrderDetail.fullOrder?.items || [];
    let totals: any = null;
    try {
      const normalizedItems = (items || []).map((it: any) => {
        let discountObj: any = it.discount ?? null;
        if (!discountObj && it.discount_json) {
          try { discountObj = typeof it.discount_json === 'string' ? JSON.parse(it.discount_json) : it.discount_json; } catch { discountObj = null; }
        }
        return {
          id: it.id ?? it.item_id ?? it.itemId ?? it.order_line_id ?? it.orderLineId ?? `${it.name || 'line'}`,
          orderLineId: it.order_line_id ?? it.orderLineId,
          name: it.name,
          type: it.type,
          quantity: it.quantity,
          price: (typeof it.price === 'number' ? it.price : Number(it.price ?? it.total_price ?? it.totalPrice ?? it.subtotal ?? 0)),
          totalPrice: (it.total_price ?? it.totalPrice),
          modifiers: it.modifiers ?? it.options ?? [],
          memo: it.memo && typeof it.memo === 'object' ? it.memo : null,
          discount: discountObj,
          guestNumber: it.guestNumber ?? it.guest_number,
          taxGroupId: it.taxGroupId ?? it.tax_group_id,
          void_id: it.void_id,
          voidId: it.voidId,
          is_void: it.is_void,
        };
      });
      const pricing = calculateOrderPricing(normalizedItems as any);
      const netSubtotal = Number((pricing.totals.subtotalAfterAllDiscounts || 0).toFixed(2));
      const storedTotalRaw =
        (selectedOrderDetail.fullOrder && (selectedOrderDetail.fullOrder as any).total) ??
        (selectedOrderDetail as any).total ??
        (pricing.totals.total || 0);
      const storedTotalNum = Number(storedTotalRaw);
      const storedTotal = Number.isFinite(storedTotalNum) ? Number(storedTotalNum.toFixed(2)) : Number((pricing.totals.total || 0).toFixed(2));
      const derivedTax = Math.max(0, Number((storedTotal - netSubtotal).toFixed(2)));
      totals = { subtotal: netSubtotal, tax: derivedTax, taxLines: derivedTax > 0.0001 ? [{ name: 'Tax', amount: derivedTax }] : [], total: storedTotal };
    } catch {
      totals = null;
    }
    return { ...(selectedOrderDetail as any), __togoTotals: totals } as OrderData;
  }, [selectedOrderDetail]);

  const handlePayOnly = useCallback(() => {
    if (!selectedOrderDetail) return;
    const status = (selectedOrderDetail?.fullOrder?.status || selectedOrderDetail?.status || '').toLowerCase();
    const isPaid = status === 'paid' || status === 'completed' || status === 'closed' ||
      selectedOrderType === 'delivery';
    if (isPaid) return;
    const payload = buildUnpaidPaymentPayload();
    if (!payload) return;
    onPayment(payload, selectedOrderType);
  }, [selectedOrderDetail, selectedOrderType, buildUnpaidPaymentPayload, onPayment]);

  const handlePayAndPickup = useCallback(() => {
    if (!selectedOrderDetail) return;
    const status = (selectedOrderDetail?.fullOrder?.status || selectedOrderDetail?.status || '').toLowerCase();
    const isPaid = status === 'paid' || status === 'completed' || status === 'closed' ||
      selectedOrderType === 'delivery';
    if (isPaid) return;
    const payload = buildUnpaidPaymentPayload();
    if (!payload) return;
    onPayment({ ...(payload as any), __completePickupAfterPay: true } as OrderData, selectedOrderType);
  }, [selectedOrderDetail, selectedOrderType, buildUnpaidPaymentPayload, onPayment]);

  // Pay/Pickup 버튼 핸들러 (단일 버튼 모드 또는 Delivery / 결제완료 픽업)
  const handlePayPickup = useCallback(async () => {
    if (!selectedOrderDetail) return;

    const status = (selectedOrderDetail?.fullOrder?.status || selectedOrderDetail?.status || '').toLowerCase();
    const isPaid = status === 'paid' || status === 'completed' || status === 'closed' ||
      selectedOrderType === 'delivery'; // Delivery는 항상 PAID

    if (!isPaid) {
      const payload = buildUnpaidPaymentPayload();
      if (!payload) return;
      onPayment(payload, selectedOrderType);
    } else {
      onPickupComplete(selectedOrderDetail, selectedOrderType);
    }
  }, [selectedOrderDetail, selectedOrderType, buildUnpaidPaymentPayload, onPayment, onPickupComplete]);

  const handleVoid = useCallback(() => {
    if (!selectedOrderDetail || !onVoid) return;
    onVoid(selectedOrderDetail, selectedOrderType);
  }, [selectedOrderDetail, selectedOrderType, onVoid]);

  const handleBackToOrder = useCallback(() => {
    if (!selectedOrderDetail || !onBackToOrder) return;
    onBackToOrder(selectedOrderDetail, selectedOrderType);
    try { onClose(); } catch {}
  }, [selectedOrderDetail, selectedOrderType, onBackToOrder, onClose]);

  const isPickedUp = useCallback((order: OrderData | null | undefined) => {
    if (!order) return false;
    const s = String(order.fullOrder?.status ?? order.status ?? '').toLowerCase();
    return s === 'picked_up' || s === 'pickedup';
  }, []);

  // 현재 탭에 맞는 주문 목록 가져오기
  const getCurrentOrders = useCallback((): OrderData[] => {
    switch (selectedOrderType) {
      case 'online':
        return (onlineOrders || []).filter((o) => !isPickedUp(o));
      case 'delivery':
        return (deliveryOrders || []).filter((o) => !isPickedUp(o));
      case 'togo':
      case 'pickup':
      default:
        return (togoOrders || []).filter((o) => !isPickedUp(o));
    }
  }, [selectedOrderType, onlineOrders, togoOrders, deliveryOrders, isPickedUp]);

  // 픽업 시간 파싱 함수
  const parsePickupTime = (pt: any): Date | null => {
    if (!pt) return null;
    if (pt._seconds) return new Date(pt._seconds * 1000);
    if (pt.seconds) return new Date(pt.seconds * 1000);
    const d = new Date(pt);
    return isNaN(d.getTime()) ? null : d;
  };

  // isPaid 상태 확인
  const checkIsPaid = (order: OrderData | null): boolean => {
    if (!order) return false;
    if (selectedOrderType === 'delivery') return true; // Delivery는 항상 PAID
    
    const fullOrder = order.fullOrder;
    if (fullOrder?.status === 'paid' || fullOrder?.status === 'completed' || fullOrder?.status === 'closed' ||
        fullOrder?.status === 'PAID' || fullOrder?.paymentStatus === 'PAID' || fullOrder?.paymentStatus === 'paid' ||
        fullOrder?.paymentStatus === 'completed' || fullOrder?.paymentStatus === 'COMPLETED' || fullOrder?.paid === true) {
      return true;
    }
    if (order.status === 'PAID' || order.status === 'paid' || order.status === 'completed' || order.status === 'closed' ||
        order.paymentStatus === 'PAID' || order.paymentStatus === 'paid' || order.paymentStatus === 'completed' ||
        order.paymentStatus === 'COMPLETED' || order.paid === true) {
      return true;
    }
    return false;
  };

  if (!isOpen) return null;

  // 모달 내용 (embedded와 modal 모두 동일)
  const modalContent = (
    <div className={`flex min-h-0 flex-col overflow-hidden ${embedded ? 'h-full' : 'max-h-full flex-1'}`}>
      {/* Header with Tabs — PAY_NEO 인셋 웰 (PrintBillModal 정렬) */}
      {showTabs && (
        <div className="mb-3 flex shrink-0 flex-col gap-2 rounded-[14px] p-2.5" style={PAY_NEO.inset}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { key: 'delivery' as const, label: 'Delivery', count: (deliveryOrders || []).filter((o) => !isPickedUp(o)).length },
                { key: 'online' as const, label: 'Online', count: (onlineOrders || []).filter((o) => !isPickedUp(o)).length },
                { key: 'togo' as const, label: 'Pickup', count: (togoOrders || []).filter((o) => !isPickedUp(o)).length },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setSelectedOrderType(tab.key)}
                  className={`rounded-[10px] border-0 px-3 py-1.5 text-sm font-semibold touch-manipulation ${NEO_PRESS_INSET_ONLY_NO_SHIFT} ${
                    selectedOrderType === tab.key ? 'text-white' : 'text-gray-800'
                  }`}
                  style={selectedOrderType === tab.key ? PAY_NEO_PRIMARY_BLUE : PAY_NEO.key}
                >
                  {tab.label} ({tab.count})
                </button>
              ))}
            </div>
            {!embedded && (
              <button
                type="button"
                onClick={onClose}
                className={`flex h-9 w-9 shrink-0 items-center justify-center border-0 text-lg font-bold text-gray-700 touch-manipulation ${NEO_PRESS_INSET_ONLY_NO_SHIFT}`}
                style={PAY_NEO.raised}
                title="Close"
              >
                ×
              </button>
            )}
          </div>
        </div>
      )}
      
      {/* Content - 좌우 분할 */}
      <div className={`min-h-0 flex-1 flex gap-3 overflow-hidden ${!showTabs ? '' : ''} p-0`}>
        {/* 왼쪽: 주문 목록 테이블 */}
        <div className="flex min-h-0 w-[55%] min-w-0 flex-col overflow-hidden rounded-[14px] p-2.5" style={PAY_NEO.inset}>
          <div className="min-h-0 flex-1 overflow-auto rounded-[10px] bg-white/90">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-100/95">
                <tr>
                  <th className="px-2 py-2 text-left text-xs font-semibold text-gray-700">Seq#</th>
                  <th className="px-2 py-2 text-left text-xs font-semibold text-gray-700">
                    {selectedOrderType === 'delivery' ? 'Channel' : 'Order#'}
                  </th>
                  <th className="px-2 py-2 text-left text-xs font-semibold text-gray-700">
                    {selectedOrderType === 'delivery' ? 'Order#' : 'Placed'}
                  </th>
                  <th className="px-2 py-2 text-left text-xs font-semibold text-gray-700">
                    {selectedOrderType === 'delivery' ? 'Ready' : 'Pickup'}
                  </th>
                  <th className="px-2 py-2 text-left text-xs font-semibold text-gray-700">Customer</th>
                  {selectedOrderType !== 'delivery' && (
                    <th className="px-2 py-2 text-left text-xs font-semibold text-gray-700">Phone</th>
                  )}
                  <th className="px-2 py-2 text-right text-xs font-semibold text-gray-700">Amount</th>
                </tr>
              </thead>
              <tbody>
                {getCurrentOrders().map((order, idx) => {
                  const isSelected = selectedOrderDetail?.id === order.id;
                  const bgHover = selectedOrderType === 'delivery' ? 'hover:bg-purple-50' :
                    selectedOrderType === 'online' ? 'hover:bg-blue-50' : 'hover:bg-orange-50';
                  const borderColor = selectedOrderType === 'delivery' ? 'border-purple-500' :
                    selectedOrderType === 'online' ? 'border-blue-500' : 'border-orange-500';
                  const bgSelected = selectedOrderType === 'delivery' ? 'bg-purple-100' :
                    selectedOrderType === 'online' ? 'bg-blue-100' : 'bg-orange-100';
                  
                  return (
                    <tr 
                      key={order.id}
                      onClick={() => handleOrderClick(order, selectedOrderType)}
                      className={`cursor-pointer ${bgHover} transition min-h-[44px] ${
                        isSelected 
                          ? `${bgSelected} border-l-4 ${borderColor}` 
                          : 'border-l-4 border-transparent'
                      }`}
                      style={{ height: '44px' }}
                    >
                      <td className="px-2 py-3 text-gray-800">{idx + 1}</td>
                      {selectedOrderType === 'delivery' ? (
                        <>
                          <td className="px-2 py-3 text-gray-800 font-bold">{order.deliveryCompany || 'Delivery'}</td>
                          <td className="px-2 py-3 text-purple-700 font-bold">#{order.deliveryOrderNumber || order.id}</td>
                        </>
                      ) : (
                        <>
                          <td className="px-2 py-3 text-gray-800 font-bold">
                            #{selectedOrderType === 'online' 
                              ? (order.number || order.id) 
                              : String(order.id).padStart(3, '0')}
                          </td>
                          <td className="px-2 py-3 text-gray-600">
                            {order.placedTime || order.createdAt
                              ? new Date(order.placedTime || order.createdAt || '').toLocaleTimeString('en-US', { 
                                  hour: '2-digit', minute: '2-digit', hour12: false 
                                })
                              : order.time || '-'}
                          </td>
                        </>
                      )}
                      <td className="px-2 py-3 text-gray-600">
                        {order.readyTimeLabel || (order.pickupTime 
                          ? new Date(order.pickupTime).toLocaleTimeString('en-US', { 
                              hour: '2-digit', minute: '2-digit', hour12: false 
                            })
                          : '-')}
                      </td>
                      <td className="px-2 py-3 text-gray-800">{order.name || order.customerName || '-'}</td>
                      {selectedOrderType !== 'delivery' && (
                        <td className="px-2 py-3 text-gray-800 font-bold">{order.phone || order.customerPhone || '-'}</td>
                      )}
                      <td className="px-2 py-3 text-right text-gray-800">
                        ${Number(order.total || order.fullOrder?.total || 0).toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
                {getCurrentOrders().length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                      No orders found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        
        {/* 오른쪽: 주문 상세 */}
        <div className="flex min-h-0 w-[45%] min-w-0 flex-col overflow-hidden rounded-[14px] p-2.5" style={PAY_NEO.inset}>
          {/* 상단 버튼 영역 */}
          <div className="flex flex-shrink-0 flex-wrap gap-1 rounded-[10px] border-0 bg-transparent p-0 pb-2">
            {/* Back to Order 버튼 */}
            {onBackToOrder && (
              <button
                type="button"
                onClick={handleBackToOrder}
                disabled={!selectedOrderDetail}
                className={`min-w-[120px] flex-1 rounded-[10px] border-0 px-3 py-3 text-base font-semibold text-gray-900 opacity-100 touch-manipulation disabled:opacity-40 ${NEO_PRESS_INSET_ONLY_NO_SHIFT}`}
                style={PAY_NEO.key}
              >
                Back to Order
              </button>
            )}
            {/* Print Bill 버튼 */}
            <button
              type="button"
              onClick={handlePrintBill}
              disabled={!selectedOrderDetail}
              className={`min-w-[120px] flex-1 rounded-[10px] border-0 px-3 py-3 text-base font-semibold text-white touch-manipulation disabled:opacity-40 ${NEO_PRESS_INSET_AMBER_NO_SHIFT}`}
              style={PAY_NEO_PRIMARY_AMBER}
            >
              Print Bill
            </button>
            {/* Reprint 버튼 */}
            <button
              type="button"
              onClick={handleReprint}
              disabled={!selectedOrderDetail}
              className={`min-w-[120px] flex-1 rounded-[10px] border-0 px-3 py-3 text-base font-semibold text-gray-900 touch-manipulation disabled:opacity-40 ${NEO_PRESS_INSET_ONLY_NO_SHIFT}`}
              style={PAY_NEO.key}
            >
              Reprint
            </button>
            {/* Void 버튼 */}
            {onVoid && (
              <button
                type="button"
                onClick={handleVoid}
                disabled={!selectedOrderDetail}
                className={`min-w-[120px] flex-1 rounded-[10px] border-0 px-3 py-3 text-base font-semibold text-red-700 touch-manipulation disabled:opacity-40 ${NEO_PRESS_INSET_ONLY_NO_SHIFT}`}
                style={PAY_NEO.key}
              >
                Void
              </button>
            )}
            {/* Pay / Pay & Pickup (QSR split) 또는 단일 Pay/Pickup */}
            {(() => {
              const showSplitPayPickup =
                splitPayAndPickupActions &&
                selectedOrderType !== 'delivery' &&
                (!splitPayAndPickupOnlineOnly || selectedOrderType === 'online');
              return !showSplitPayPickup;
            })() ? (
              <button
                type="button"
                onClick={handlePayPickup}
                disabled={!selectedOrderDetail}
                className={`min-w-[120px] flex-1 rounded-[10px] border-0 px-3 py-3 text-base font-semibold text-white touch-manipulation disabled:opacity-40 ${NEO_COLOR_BTN_PRESS_NO_SHIFT}`}
                style={PAY_NEO_PRIMARY_BLUE}
              >
                {selectedOrderType === 'delivery' ? 'Pickup' : 'Pay/Pickup'}
              </button>
            ) : !selectedOrderDetail ? (
              <button
                type="button"
                disabled
                className={`min-w-[120px] flex-1 rounded-[10px] border-0 px-3 py-3 text-base font-semibold text-white opacity-40 ${NEO_COLOR_BTN_PRESS_NO_SHIFT}`}
                style={PAY_NEO_PRIMARY_BLUE}
              >
                Pay
              </button>
            ) : checkIsPaid(selectedOrderDetail) ? (
              <button
                type="button"
                onClick={handlePayPickup}
                className={`min-w-[120px] flex-1 rounded-[10px] border-0 px-3 py-3 text-base font-semibold text-white touch-manipulation ${NEO_COLOR_BTN_PRESS_NO_SHIFT}`}
                style={PAY_NEO_PRIMARY_BLUE}
              >
                Pickup Complete
              </button>
            ) : (
              <div className="flex min-w-0 flex-1 gap-1">
                <button
                  type="button"
                  onClick={handlePayOnly}
                  className={`min-w-0 flex-1 rounded-[10px] border-0 px-2 py-3 text-sm font-semibold text-white touch-manipulation sm:text-base ${NEO_COLOR_BTN_PRESS_NO_SHIFT}`}
                  style={PAY_NEO_PRIMARY_BLUE}
                >
                  Pay
                </button>
                <button
                  type="button"
                  onClick={handlePayAndPickup}
                  className={`min-w-0 flex-1 rounded-[10px] border-0 px-2 py-3 text-sm font-semibold text-white touch-manipulation sm:text-base ${NEO_COLOR_BTN_PRESS_NO_SHIFT}`}
                  style={PAY_NEO_PRIMARY_BLUE}
                >
                  Pay & Pickup
                </button>
              </div>
            )}
          </div>
          
          {/* 주문 상세 정보 */}
          {selectedOrderDetail ? (
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
              {/* 주문번호 & 픽업타임 & 고객정보 */}
              <div className="space-y-2 rounded-[14px] p-2.5" style={PAY_NEO.inset}>
                <div className="mb-1 flex items-center justify-between">
                  <div className="text-2xl font-bold text-gray-800">
                    {selectedOrderType === 'delivery'
                      ? `${selectedOrderDetail.deliveryCompany || 'Delivery'} #${selectedOrderDetail.deliveryOrderNumber || selectedOrderDetail.id}`
                      : `#${(selectedOrderType === 'togo' || selectedOrderType === 'pickup')
                          ? String(selectedOrderDetail.id).padStart(3, '0') 
                          : (selectedOrderDetail.number || selectedOrderDetail.id)}`
                    }
                  </div>
                  <div className="text-3xl font-bold text-red-600">
                    {(() => {
                      let pt = parsePickupTime(selectedOrderDetail.pickupTime) || parsePickupTime(selectedOrderDetail.fullOrder?.pickupTime);
                      if (!pt) {
                        const created = selectedOrderDetail.placedTime || selectedOrderDetail.fullOrder?.createdAt;
                        const createdDate = parsePickupTime(created);
                        if (createdDate) {
                          pt = new Date(createdDate.getTime() + 20 * 60000);
                        }
                      }
                      if (pt) return pt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
                      if (selectedOrderDetail.readyTimeLabel && selectedOrderDetail.readyTimeLabel !== 'ASAP') return selectedOrderDetail.readyTimeLabel;
                      return '--:--';
                    })()}
                  </div>
                </div>
                <div className="flex justify-between text-sm text-gray-700">
                  <span className="font-medium">{selectedOrderDetail.name || selectedOrderDetail.customerName || '-'}</span>
                  <span className="font-bold">{selectedOrderDetail.phone || selectedOrderDetail.customerPhone || '-'}</span>
                </div>
              </div>
              
              {/* 아이템 목록 + 금액 요약 (플랫 패널 — 인셋 네오 비적용) */}
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px]" style={ORDER_ITEMS_TAX_PANEL_FLAT}>
                {/* 아이템 헤더 */}
                <div className="border-b border-gray-200/80 bg-gray-100/90 px-3 py-1.5">
                  <div className="grid grid-cols-12 text-xs font-semibold text-gray-700">
                    <div className="col-span-2">Qty</div>
                    <div className="col-span-7">Item Name</div>
                    <div className="col-span-3 text-right">Price</div>
                  </div>
                </div>
                
                {/* 아이템 목록 */}
                <div className="divide-y flex-1 overflow-auto" style={{ maxHeight: '260px' }}>
                  {(selectedOrderDetail.fullOrder?.items || []).length > 0 ? (
                    (selectedOrderDetail.fullOrder?.items || []).map((item: any, idx: number) => {
                      const modifierNames: { name: string; price: number }[] = [];
                      let modifierTotal = 0;
                      (item.options || []).forEach((opt: any) => {
                        if (opt.selectedEntries && Array.isArray(opt.selectedEntries)) {
                          opt.selectedEntries.forEach((entry: any) => {
                            if (entry.name) {
                              const price = Number(entry.price_delta || entry.priceDelta || entry.price || 0);
                              modifierNames.push({ name: entry.name, price });
                            }
                          });
                          if (opt.totalModifierPrice !== undefined) {
                            modifierTotal += Number(opt.totalModifierPrice || 0);
                          }
                        } else if (opt.choiceName || opt.name) {
                          const price = Number(opt.price_delta || opt.priceDelta || opt.price || 0);
                          modifierNames.push({ name: opt.choiceName || opt.name, price });
                          modifierTotal += price;
                        } else if (opt.modifierNames && Array.isArray(opt.modifierNames)) {
                          opt.modifierNames.forEach((name: string) => {
                            modifierNames.push({ name, price: 0 });
                          });
                        }
                      });
                      
                      if (modifierTotal === 0 && modifierNames.length > 0) {
                        modifierTotal = modifierNames.reduce((sum, m) => sum + Number(m.price || 0), 0);
                      }
                      
                      const modifierText = modifierNames
                        .filter((m: any) => m.name)
                        .map((m: any) => m.price > 0 ? `${m.name} (+$${Number(m.price).toFixed(2)})` : m.name)
                        .join(', ');
                      const itemBasePrice = Number(item.price || item.subtotal || 0);
                      const itemTotalPrice = itemBasePrice + modifierTotal;

                      let memoText = '';
                      let memoPrice = 0;
                      try {
                        const rawMemo = item.memo || item.memo_json;
                        if (rawMemo) {
                          const parsed = typeof rawMemo === 'string' ? JSON.parse(rawMemo) : rawMemo;
                          if (typeof parsed === 'string') {
                            memoText = parsed;
                          } else if (parsed) {
                            memoText = parsed.text || parsed.memo || '';
                            memoPrice = Number(parsed.price || 0);
                          }
                        }
                      } catch {}

                      let discountInfo: { type: string; value: number; amount: number } | null = null;
                      try {
                        const rawDisc = item.discount || item.discount_json;
                        if (rawDisc) {
                          const parsed = typeof rawDisc === 'string' ? JSON.parse(rawDisc) : rawDisc;
                          if (parsed && parsed.value > 0) {
                            const grossLine = (itemBasePrice + modifierTotal + memoPrice) * (item.quantity || 1);
                            const discAmt = parsed.amount || (grossLine * parsed.value / 100);
                            discountInfo = { type: parsed.type || 'Discount', value: parsed.value, amount: discAmt };
                          }
                        }
                      } catch {}

                      const isTogoBag = /togo\s*bag|to-go\s*bag/i.test(item.name || '');
                      
                      return (
                        <div key={idx} className="px-3 py-1.5">
                          <div className="grid grid-cols-12 text-sm">
                            <div className="col-span-2 font-medium text-blue-600">{item.quantity || 1}</div>
                            <div className={`col-span-7 text-gray-800 ${isTogoBag ? 'italic text-gray-500' : ''}`}>{item.name}</div>
                            <div className="col-span-3 text-right text-gray-600">
                              ${itemTotalPrice.toFixed(2)}
                            </div>
                          </div>
                          {modifierText && (
                            <div className="text-xs text-orange-600 ml-8 mt-0.5">
                              {modifierText}
                            </div>
                          )}
                          {memoText && (
                            <div className="text-xs text-purple-600 ml-8 mt-0.5">
                              📝 {memoText}{memoPrice > 0 ? ` (+$${memoPrice.toFixed(2)})` : ''}
                            </div>
                          )}
                          {discountInfo && (
                            <div className="text-xs text-red-500 ml-8 mt-0.5">
                              🏷️ {discountInfo.type} {discountInfo.value}% (-${Number(discountInfo.amount).toFixed(2)})
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="px-3 py-3 text-center text-gray-400 text-sm">No items</div>
                  )}
                </div>
                
                {/* 금액 요약 */}
                <div className="border-t bg-gray-50 px-3 py-2 space-y-1">
                  {(() => {
                    const items = selectedOrderDetail.fullOrder?.items || [];
                    let grossSubtotal = 0;
                    let totalDiscount = 0;
                    const taxBreakdown: { [key: string]: { rate: number; amount: number } } = {};
                    
                    items.forEach((item: any) => {
                      const basePrice = Number(item.price || 0);
                      let modifierTotal = 0;
                      (item.options || []).forEach((opt: any) => {
                        if (opt.totalModifierPrice !== undefined && opt.totalModifierPrice !== null) {
                          modifierTotal += Number(opt.totalModifierPrice || 0);
                        } else if (opt.selectedEntries && Array.isArray(opt.selectedEntries)) {
                          opt.selectedEntries.forEach((entry: any) => {
                            modifierTotal += Number(entry.price_delta || entry.priceDelta || entry.price || 0);
                          });
                        } else if (opt.price_delta || opt.priceDelta || opt.price) {
                          modifierTotal += Number(opt.price_delta || opt.priceDelta || opt.price || 0);
                        }
                      });

                      let memoPrice = 0;
                      try {
                        const rawMemo = item.memo || item.memo_json;
                        if (rawMemo) {
                          const parsed = typeof rawMemo === 'string' ? JSON.parse(rawMemo) : rawMemo;
                          if (parsed && typeof parsed === 'object') memoPrice = Number(parsed.price || 0);
                        }
                      } catch {}

                      const itemGross = (basePrice + modifierTotal + memoPrice) * (item.quantity || 1);
                      grossSubtotal += itemGross;

                      let discountAmt = 0;
                      try {
                        const rawDisc = item.discount || item.discount_json;
                        if (rawDisc) {
                          const disc = typeof rawDisc === 'string' ? JSON.parse(rawDisc) : rawDisc;
                          if (disc && disc.value > 0) {
                            discountAmt = disc.amount || (itemGross * disc.value / 100);
                          }
                        }
                      } catch {}
                      totalDiscount += discountAmt;

                      const itemNet = itemGross - discountAmt;
                      const itemTaxDetails = item.taxDetails || [{ name: 'GST', rate: 5 }];
                      itemTaxDetails.forEach((taxInfo: any) => {
                        const taxName = taxInfo.name || 'Tax';
                        const rate = Number(taxInfo.rate || 5);
                        const taxAmount = itemNet * (rate / 100);
                        if (!taxBreakdown[taxName]) {
                          taxBreakdown[taxName] = { rate, amount: 0 };
                        }
                        taxBreakdown[taxName].amount += taxAmount;
                      });
                    });

                    const subtotalVal = Number((grossSubtotal - totalDiscount).toFixed(2));
                    const taxesTotal = Number(Object.values(taxBreakdown).reduce((sum, t) => sum + t.amount, 0).toFixed(2));
                    const totalVal = Number((subtotalVal + taxesTotal).toFixed(2));

                    // Order-level discount from payment modal (adjustments_json)
                    let pmDiscountLabel = '';
                    let pmDiscountAmount = 0;
                    let pmNetSales = subtotalVal;
                    let pmTaxBreakdown = taxBreakdown;
                    let pmTaxesTotal = taxesTotal;
                    try {
                      const adjRaw = (selectedOrderDetail.fullOrder as any)?.adjustments_json;
                      if (adjRaw) {
                        const pmAdjs = typeof adjRaw === 'string' ? JSON.parse(adjRaw) : adjRaw;
                        if (Array.isArray(pmAdjs)) {
                          const pmDisc = pmAdjs.find((a: any) => a.percent > 0 && a.originalSubtotal > 0);
                          if (pmDisc) {
                            pmDiscountAmount = Math.abs(Number(pmDisc.amount || 0));
                            pmDiscountLabel = (pmDisc.label || `Discount (${pmDisc.percent}%)`).replace(/^Discount\b/, 'D/C');
                            pmNetSales = Number((subtotalVal - pmDiscountAmount).toFixed(2));
                            const discountRatio = subtotalVal > 0 ? pmNetSales / subtotalVal : 1;
                            const scaledBreakdown: { [key: string]: { rate: number; amount: number } } = {};
                            Object.entries(pmTaxBreakdown).forEach(([name, info]: [string, any]) => {
                              scaledBreakdown[name] = { rate: info.rate, amount: Number((info.amount * discountRatio).toFixed(2)) };
                            });
                            pmTaxBreakdown = scaledBreakdown;
                            pmTaxesTotal = Number(Object.values(scaledBreakdown).reduce((sum: number, t: any) => sum + t.amount, 0).toFixed(2));
                          }
                        }
                      }
                    } catch {}

                    const storedTotalRaw =
                      (selectedOrderDetail.fullOrder && (selectedOrderDetail.fullOrder as any).total) ??
                      (selectedOrderDetail as any).total ?? 0;
                    const storedTotal = Number(storedTotalRaw || 0);
                    const finalTotal = Number.isFinite(storedTotal) && storedTotal > 0 ? Number(storedTotal.toFixed(2)) : totalVal;
                    const onlineTipAmt = Number(
                      (selectedOrderDetail.fullOrder as any)?.online_tip ??
                        (selectedOrderDetail as any)?.tip ??
                        (selectedOrderDetail as any)?.onlineTip ??
                        0
                    );
                    const showOnlineTip =
                      selectedOrderType === 'online' && Number.isFinite(onlineTipAmt) && onlineTipAmt > 0.005;

                    return (
                      <>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">Sub Total</span>
                          <span>${subtotalVal.toFixed(2)}</span>
                        </div>
                        {pmDiscountAmount > 0 && (
                          <>
                            <div className="flex justify-between text-sm text-green-600">
                              <span>{pmDiscountLabel}</span>
                              <span>-${pmDiscountAmount.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-600">Net Sales</span>
                              <span>${pmNetSales.toFixed(2)}</span>
                            </div>
                          </>
                        )}
                        {Object.entries(pmTaxBreakdown).map(([taxName, info]: any) => (
                          <div key={taxName} className="flex justify-between text-sm">
                            <span className="text-gray-600">{info.rate ? `${taxName} (${info.rate}%)` : taxName}</span>
                            <span>${Number(info.amount || 0).toFixed(2)}</span>
                          </div>
                        ))}
                        {showOnlineTip && (
                          <div className="flex justify-between text-sm font-semibold text-emerald-800">
                            <span>Tip (online card)</span>
                            <span>${onlineTipAmt.toFixed(2)}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-base font-bold border-t pt-1">
                          <span>Total</span>
                          <span className="text-blue-600">${finalTotal.toFixed(2)}</span>
                        </div>
                      </>
                    );
                  })()}
                </div>
                
                {/* Paid/Unpaid 상태 */}
                <div className="border-t px-3 py-2">
                  {checkIsPaid(selectedOrderDetail) ? (
                    <div className="flex items-center justify-center py-1.5 bg-green-100 rounded">
                      <span className="text-green-700 font-bold">PAID</span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-1.5 bg-red-100 rounded">
                      <span className="text-red-700 font-bold">UNPAID</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-gray-600">
              Select an order to view details
            </div>
          )}
        </div>
      </div>
      {/* 하단 액션 — PrintBill Close와 동급 */}
      {!embedded && (
        <div className="mt-4 flex shrink-0 justify-end">
          <button
            type="button"
            onClick={onClose}
            className={`min-w-[110px] rounded-[10px] border-0 px-5 py-3 text-base font-semibold text-gray-900 touch-manipulation ${NEO_PRESS_INSET_ONLY_NO_SHIFT}`}
            style={PAY_NEO.key}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );

  // embedded 모드일 때는 모달 배경 없이 바로 내용만 렌더링
  if (embedded) {
    return modalContent;
  }

  // 일반 모달 모드 — PrintBillModal과 동일 오버레이·셸
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div
        className="flex max-h-[85vh] w-full max-w-[95vw] flex-col overflow-hidden rounded-2xl border-0 p-4 sm:max-w-5xl"
        style={{ ...PAY_NEO.modalShell, background: PAY_NEO_CANVAS }}
        onClick={(e) => e.stopPropagation()}
      >
        {modalContent}
      </div>
    </div>
  );
};

export default OrderDetailModal;
