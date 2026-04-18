import React, { useState, useEffect, useCallback, useRef } from 'react';
import { API_URL } from '../config/constants';
import { fetchPickupDetailItemsPreferFirebase } from '../utils/onlineOrderPickupDetailItems';
import { getDeliveryAbbr } from '../utils/deliveryChannels';
import {
  classifyPickupChannel,
  getPickupListAmountLabel,
  orderPaymentComplete,
  shouldShowInPickupList,
  channelDisplayLabel,
  type PickupChannelClass,
} from '../utils/pickupListRules';

type ChannelFilter = 'ALL' | 'PICKUP' | 'ONLINE' | 'DELIVERY';

interface PickupOrder {
  id: number | string;
  order_id?: number | string;
  order_number?: string;
  number?: string;
  status?: string;
  total?: number;
  subtotal?: number;
  tax?: number;
  customer_name?: string;
  customerName?: string;
  name?: string;
  customer_phone?: string;
  customerPhone?: string;
  phone?: string;
  created_at?: string;
  createdAt?: string;
  placedTime?: string;
  ready_time?: string;
  readyTime?: string;
  readyTimeLabel?: string;
  pickupTime?: string;
  order_type?: string;
  adjustments_json?: string;
  fullOrder?: any;
  isLoading?: boolean;
  channel?: string;
  delivery_company?: string;
  deliveryCompany?: string;
  [key: string]: any;
}

interface PickupListPanelProps {
  onPayment: (orderId: number) => Promise<void>;
  onPickupComplete: (orderId: number) => Promise<void>;
  onBackToOrder?: (orderId: number) => void;
  initialChannelFilter?: ChannelFilter;
}

const CHANNEL_COLORS: Record<PickupChannelClass, { bg: string; text: string; label: string }> = {
  PICKUP: { bg: 'bg-blue-600', text: 'text-white', label: 'Pickup' },
  ONLINE: { bg: 'bg-violet-600', text: 'text-white', label: 'Online' },
  DELIVERY: { bg: 'bg-red-600', text: 'text-white', label: 'Delivery' },
  TOGO: { bg: 'bg-emerald-600', text: 'text-white', label: 'Togo' },
};

const PickupListPanel: React.FC<PickupListPanelProps> = ({
  onPayment,
  onPickupComplete,
  onBackToOrder,
  initialChannelFilter,
}) => {
  const [orders, setOrders] = useState<PickupOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<PickupOrder | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>(initialChannelFilter || 'ALL');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const formatPhone = (phone: string) => {
    const digits = (phone || '').replace(/\D/g, '');
    if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    if (digits.length === 11) return `${digits[0]} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    return phone || '';
  };

  const formatTime = (dateStr: string | undefined) => {
    if (!dateStr) return '--:--';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  const parsePickupTime = (val: any): Date | null => {
    if (!val) return null;
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  };

  const sortOrders = useCallback((list: PickupOrder[]): PickupOrder[] => {
    const now = Date.now();
    return [...list].sort((a, b) => {
      const getPickupMs = (o: PickupOrder): number => {
        const rt = o.readyTime || o.ready_time || o.pickupTime;
        if (rt) {
          const d = new Date(rt);
          if (!isNaN(d.getTime())) return d.getTime();
        }
        const ct = o.createdAt || o.created_at || o.placedTime;
        if (ct) {
          const d = new Date(ct);
          if (!isNaN(d.getTime())) return d.getTime() + 20 * 60000;
        }
        return now + 999999999;
      };

      const tA = getPickupMs(a);
      const tB = getPickupMs(b);
      const pastA = tA <= now;
      const pastB = tB <= now;

      if (pastA && pastB) return tA - tB;
      if (!pastA && !pastB) return tA - tB;
      if (pastA && !pastB) return -1;
      return 1;
    });
  }, []);

  const loadOrders = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/orders?pickup_pending=1&session_scope=1`);
      const data = await res.json();
      const raw: any[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.orders) ? data.orders
        : Array.isArray(data?.data) ? data.data
        : [];

      const filtered = raw.filter((o: any) => shouldShowInPickupList(o));

      const mapped: PickupOrder[] = filtered.map((o: any) => ({
        ...o,
        customerName: o.customer_name || o.customerName || '',
        name: o.customer_name || o.customerName || o.name || '',
        customerPhone: o.customer_phone || o.customerPhone || '',
        phone: o.customer_phone || o.customerPhone || o.phone || '',
        createdAt: o.created_at || o.createdAt || '',
        placedTime: o.created_at || o.createdAt || o.placedTime || '',
        readyTime: o.ready_time || o.readyTime || '',
        readyTimeLabel: o.ready_time || o.readyTimeLabel || '',
        number: o.order_number || o.number || '',
        channel: classifyPickupChannel(o),
        online_tip: o.online_tip,
      }));

      const sorted = sortOrders(mapped);
      setOrders(sorted);

      if (selectedOrder) {
        const still = sorted.find(o => String(o.id) === String(selectedOrder.id));
        if (!still) {
          setSelectedOrder(sorted[0] || null);
          if (sorted[0]) fetchDetail(sorted[0]);
        }
      } else if (sorted.length > 0) {
        setSelectedOrder(sorted[0]);
        fetchDetail(sorted[0]);
      }
    } catch (e) {
      console.error('[PickupList] load error:', e);
    }
  }, [sortOrders, selectedOrder]);

  useEffect(() => {
    const onTakeoutDayClosed = () => {
      setOrders([]);
      setSelectedOrder(null);
      void loadOrders();
    };
    const onTakeoutDayOpened = () => {
      void loadOrders();
    };
    window.addEventListener('posTakeoutDayClosed', onTakeoutDayClosed);
    window.addEventListener('posTakeoutDayOpened', onTakeoutDayOpened);
    return () => {
      window.removeEventListener('posTakeoutDayClosed', onTakeoutDayClosed);
      window.removeEventListener('posTakeoutDayOpened', onTakeoutDayOpened);
    };
  }, [loadOrders]);

  const fetchDetail = useCallback(async (order: PickupOrder) => {
    const orderId = Number(order.order_id ?? order.id);
    if (!Number.isFinite(orderId) || orderId <= 0) return;
    setDetailLoading(true);
    try {
      const res = await fetch(`${API_URL}/orders/${orderId}`);
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
                const mods = typeof item.modifiers_json === 'string' ? JSON.parse(item.modifiers_json) : item.modifiers_json;
                options = Array.isArray(mods) ? mods : [];
              }
            } catch {}
            try {
              if (item.memo_json) {
                const memoData = typeof item.memo_json === 'string' ? JSON.parse(item.memo_json) : item.memo_json;
                memo = typeof memoData === 'string' ? { text: memoData } : memoData;
              }
            } catch {}
            try {
              if (item.discount_json) {
                discount = typeof item.discount_json === 'string' ? JSON.parse(item.discount_json) : item.discount_json;
              }
            } catch {}
            return { ...item, options, memo, discount };
          });

          const fullOrder = {
            ...order,
            status: data.order?.status || order.status,
            items: parsedItems,
            subtotal: data.order?.subtotal ?? 0,
            tax: data.order?.tax ?? 0,
            total: data.order?.total ?? order.total ?? 0,
            adjustments_json: data.order?.adjustments_json ?? order.adjustments_json ?? null,
            online_tip: (data.order as any)?.online_tip ?? (order as any)?.online_tip ?? 0,
          };
          setSelectedOrder(prev => prev && String(prev.id) === String(order.id)
            ? { ...prev, fullOrder, isLoading: false }
            : prev
          );
          setDetailLoading(false);
          return;
        }
      }
    } catch (e) {
      console.warn('[PickupList] detail fetch error:', e);
    }
    setSelectedOrder(prev => prev && String(prev.id) === String(order.id)
      ? { ...prev, isLoading: false }
      : prev
    );
    setDetailLoading(false);
  }, []);

  useEffect(() => {
    if (initialChannelFilter) setChannelFilter(initialChannelFilter);
  }, [initialChannelFilter]);

  useEffect(() => {
    setLoading(true);
    loadOrders().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    pollRef.current = setInterval(() => {
      loadOrders();
    }, 10000);
    const handleOrderPaid = () => { loadOrders(); };
    window.addEventListener('orderPaid', handleOrderPaid);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      window.removeEventListener('orderPaid', handleOrderPaid);
    };
  }, [loadOrders]);

  const handleOrderClick = useCallback(async (order: PickupOrder) => {
    setSelectedOrder({ ...order, isLoading: true });
    await fetchDetail(order);
  }, [fetchDetail]);

  const isPaid = (order: PickupOrder): boolean => orderPaymentComplete(order);

  const getPickupTimeDisplay = (order: PickupOrder): string => {
    const rt = order.readyTime || order.ready_time || order.pickupTime;
    if (rt) {
      const d = new Date(rt);
      if (!isNaN(d.getTime())) {
        return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      }
      return rt;
    }
    if (order.readyTimeLabel && order.readyTimeLabel !== 'ASAP') return order.readyTimeLabel;
    return 'ASAP';
  };

  const isPickupOverdue = (order: PickupOrder): boolean => {
    const rt = order.readyTime || order.ready_time || order.pickupTime;
    if (!rt) return false;
    const d = new Date(rt);
    if (isNaN(d.getTime())) return false;
    return d.getTime() < Date.now();
  };

  const renderOrderDetail = () => {
    if (!selectedOrder) {
      return (
        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
          Select an order to view details
        </div>
      );
    }

    const order = selectedOrder;
    const detailChannel = classifyPickupChannel(order);
    const detailChColors = CHANNEL_COLORS[detailChannel];
    const items = order.fullOrder?.items || [];
    const orderPaid = isPaid(order);

    let pickupTimeDisplay = '--:--';
    const rt = order.readyTime || order.ready_time || order.pickupTime || order.fullOrder?.ready_time;
    if (rt) {
      const d = parsePickupTime(rt);
      if (d) pickupTimeDisplay = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      else if (typeof rt === 'string') pickupTimeDisplay = rt;
    }
    if (pickupTimeDisplay === '--:--' && order.readyTimeLabel && order.readyTimeLabel !== 'ASAP') {
      pickupTimeDisplay = order.readyTimeLabel;
    }

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
        if (!taxBreakdown[taxName]) taxBreakdown[taxName] = { rate, amount: 0 };
        taxBreakdown[taxName].amount += taxAmount;
      });
    });

    const subtotalVal = Number((grossSubtotal - totalDiscount).toFixed(2));
    const taxesTotal = Number(Object.values(taxBreakdown).reduce((sum, t) => sum + t.amount, 0).toFixed(2));
    const totalVal = Number((subtotalVal + taxesTotal).toFixed(2));
    const storedTotal = Number(order.fullOrder?.total ?? order.total ?? 0);
    const finalTotal = Number.isFinite(storedTotal) && storedTotal > 0 ? Number(storedTotal.toFixed(2)) : totalVal;

    // Order-level discount from payment modal (adjustments_json)
    let pmDiscountLabel = '';
    let pmDiscountAmount = 0;
    let pmNetSales = subtotalVal;
    let pmTaxBreakdown = taxBreakdown;
    try {
      const adjRaw = (order.fullOrder as any)?.adjustments_json ?? order.adjustments_json;
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
            Object.entries(pmTaxBreakdown).forEach(([name, info]) => {
              scaledBreakdown[name] = { rate: info.rate, amount: Number((info.amount * discountRatio).toFixed(2)) };
            });
            pmTaxBreakdown = scaledBreakdown;
          }
        }
      }
    } catch {}

    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Action buttons */}
        <div className="p-2 flex flex-wrap gap-2 flex-shrink-0 bg-gray-50 border-b">
          {onBackToOrder && (
            <button
              onClick={() => {
                const id = Number(order.order_id ?? order.id);
                if (Number.isFinite(id) && id > 0) onBackToOrder(id);
              }}
              className="py-3 px-3 bg-slate-700 hover:bg-slate-800 text-white text-sm font-bold rounded-lg transition shadow-md flex-1 min-w-[120px]"
            >
              Back to Order
            </button>
          )}
          <button
            onClick={async () => {
              const id = Number(order.order_id ?? order.id);
              if (!Number.isFinite(id) || id <= 0) return;
              if (orderPaid) {
                await onPickupComplete(id);
                loadOrders();
              } else {
                await onPayment(id);
                loadOrders();
              }
            }}
            className={`py-3 px-3 text-white text-sm font-bold rounded-lg transition shadow-md flex-1 min-w-[120px] ${
              orderPaid
                ? 'bg-emerald-600 hover:bg-emerald-700'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {orderPaid ? 'Pickup Complete' : 'Pay'}
          </button>
        </div>

        {/* Order info header */}
        <div className="bg-white rounded-lg p-3 shadow-sm mx-2 mt-2">
          <div className="flex justify-between items-center mb-1">
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-gray-800">
                #{String(order.order_number ?? order.number ?? order.id).padStart(3, '0').toUpperCase()}
              </span>
              {order.channel && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${detailChColors.bg} ${detailChColors.text}`}>
                  {detailChColors.label}
                </span>
              )}
            </div>
            <div className={`text-2xl font-bold ${isPickupOverdue(order) ? 'text-red-600 animate-pulse' : 'text-red-600'}`}>
              {pickupTimeDisplay}
            </div>
          </div>
          <div className="flex justify-between text-sm text-gray-700">
            <span className="font-medium">{order.name || order.customerName || '-'}</span>
            <span className="font-bold text-blue-700">{formatPhone(order.phone || order.customerPhone || '')}</span>
          </div>
          {order.channel === 'DELIVERY' && (order.delivery_company || order.deliveryCompany) && (
            <div className="text-xs text-gray-500 mt-1">
              via {getDeliveryAbbr(order.delivery_company || order.deliveryCompany)}
            </div>
          )}
        </div>

        {/* Items */}
        <div className="flex-1 overflow-auto mx-2 mt-2 bg-white rounded-lg shadow-sm">
          <div className="bg-gray-100 px-3 py-1.5 border-b sticky top-0">
            <div className="grid grid-cols-12 text-xs font-semibold text-gray-600">
              <div className="col-span-2">Qty</div>
              <div className="col-span-7">Item Name</div>
              <div className="col-span-3 text-right">Price</div>
            </div>
          </div>
          <div className="divide-y">
            {detailLoading || order.isLoading ? (
              <div className="px-3 py-6 text-center text-gray-400 text-sm">Loading...</div>
            ) : items.length > 0 ? (
              items.map((item: any, idx: number) => {
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
                    if (opt.totalModifierPrice !== undefined) modifierTotal += Number(opt.totalModifierPrice || 0);
                  } else if (opt.choiceName || opt.name) {
                    const price = Number(opt.price_delta || opt.priceDelta || opt.price || 0);
                    modifierNames.push({ name: opt.choiceName || opt.name, price });
                    modifierTotal += price;
                  } else if (opt.modifierNames && Array.isArray(opt.modifierNames)) {
                    opt.modifierNames.forEach((name: string) => modifierNames.push({ name, price: 0 }));
                  }
                });
                if (modifierTotal === 0 && modifierNames.length > 0) {
                  modifierTotal = modifierNames.reduce((sum, m) => sum + Number(m.price || 0), 0);
                }

                const modText = modifierNames
                  .filter(m => m.name)
                  .map(m => m.price > 0 ? `${m.name} (+$${Number(m.price).toFixed(2)})` : m.name)
                  .join(', ');
                const itemBasePrice = Number(item.price || 0);
                const itemTotalPrice = itemBasePrice + modifierTotal;

                let memoText = '';
                let memoPrice = 0;
                try {
                  const rawMemo = item.memo || item.memo_json;
                  if (rawMemo) {
                    const parsed = typeof rawMemo === 'string' ? JSON.parse(rawMemo) : rawMemo;
                    if (typeof parsed === 'string') memoText = parsed;
                    else if (parsed) { memoText = parsed.text || parsed.memo || ''; memoPrice = Number(parsed.price || 0); }
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

                return (
                  <div key={idx} className="px-3 py-1.5">
                    <div className="grid grid-cols-12 text-sm">
                      <div className="col-span-2 font-medium text-blue-600">{item.quantity || 1}</div>
                      <div className="col-span-7 text-gray-800">{item.name}</div>
                      <div className="col-span-3 text-right text-gray-600">${itemTotalPrice.toFixed(2)}</div>
                    </div>
                    {modText && (
                      <div className="text-xs text-orange-600 ml-8 mt-0.5">{modText}</div>
                    )}
                    {memoText && (
                      <div className="text-xs text-purple-600 ml-8 mt-0.5">
                        {memoText}{memoPrice > 0 ? ` (+$${memoPrice.toFixed(2)})` : ''}
                      </div>
                    )}
                    {discountInfo && (
                      <div className="text-xs text-red-500 ml-8 mt-0.5">
                        {discountInfo.type} {discountInfo.value}% (-${Number(discountInfo.amount).toFixed(2)})
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="px-3 py-6 text-center text-gray-400 text-sm">No items</div>
            )}
          </div>

          {/* Summary */}
          {items.length > 0 && (
            <div className="border-t bg-gray-50 px-3 py-2 space-y-1">
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
              {Object.entries(pmTaxBreakdown).map(([taxName, info]) => (
                <div key={taxName} className="flex justify-between text-sm">
                  <span className="text-gray-600">{info.rate ? `${taxName} (${info.rate}%)` : taxName}</span>
                  <span>${Number(info.amount || 0).toFixed(2)}</span>
                </div>
              ))}
              {(() => {
                const tipAmt = Number(
                  (order.fullOrder as any)?.online_tip ?? (order as any).online_tip ?? 0
                );
                if (!Number.isFinite(tipAmt) || tipAmt <= 0.005) return null;
                return (
                  <div className="flex justify-between text-sm font-semibold text-emerald-800">
                    <span>Tip (online)</span>
                    <span>${tipAmt.toFixed(2)}</span>
                  </div>
                );
              })()}
              <div className="flex justify-between text-base font-bold border-t pt-1">
                <span>Total</span>
                <span className="text-blue-600">${finalTotal.toFixed(2)}</span>
              </div>
            </div>
          )}

          {/* Paid status */}
          <div className="border-t px-3 py-2">
            {orderPaid ? (
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
    );
  };

  const filteredOrders =
    channelFilter === 'ALL'
      ? orders
      : channelFilter === 'PICKUP'
        ? orders.filter((o) => o.channel === 'PICKUP' || o.channel === 'TOGO')
        : orders.filter((o) => o.channel === channelFilter);

  const channelCounts = {
    ALL: orders.length,
    PICKUP: orders.filter((o) => o.channel === 'PICKUP' || o.channel === 'TOGO').length,
    ONLINE: orders.filter((o) => o.channel === 'ONLINE').length,
    DELIVERY: orders.filter((o) => o.channel === 'DELIVERY').length,
  };

  return (
    <div className="flex flex-col h-full bg-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b shadow-sm flex-shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold text-gray-800">Pickup List</h2>
          <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">
            {orders.length}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {(['ALL', 'PICKUP', 'ONLINE', 'DELIVERY'] as ChannelFilter[]).map((ch) => {
            const isActive = channelFilter === ch;
            const count = channelCounts[ch];
            const colors = ch === 'ALL'
              ? { bg: 'bg-gray-600', text: 'text-white' }
              : { bg: isActive ? (CHANNEL_COLORS[ch]?.bg || 'bg-gray-100') : 'bg-gray-100', text: isActive ? (CHANNEL_COLORS[ch]?.text || 'text-gray-600') : 'text-gray-500' };
            return (
              <button
                key={ch}
                onClick={() => setChannelFilter(ch)}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all border ${
                  isActive
                    ? ch === 'ALL'
                      ? 'bg-gray-700 text-white border-gray-700'
                      : `${colors.bg} ${colors.text} border-current`
                    : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {ch === 'ALL' ? 'All' : CHANNEL_COLORS[ch]?.label || ch}
                {count > 0 && <span className="ml-1 opacity-70">({count})</span>}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => { setLoading(true); loadOrders().finally(() => setLoading(false)); }}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg bg-gray-100 border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-200 transition disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Content: Left list + Right detail */}
      <div className="flex flex-1 min-h-0 gap-2 p-2">
        {/* Left: order list */}
        <div className="w-[50%] flex flex-col bg-white rounded-lg shadow-md overflow-hidden">
          <div className="bg-gray-50 px-2 py-1.5 border-b flex-shrink-0">
            <div className="grid grid-cols-12 text-[10px] font-semibold text-gray-500 uppercase">
              <div className="col-span-1">#</div>
              <div className="col-span-2">Channel</div>
              <div className="col-span-2">Order #</div>
              <div className="col-span-2">Placed</div>
              <div className="col-span-2">Pickup</div>
              <div className="col-span-3 text-right">Amount</div>
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {filteredOrders.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                {loading ? 'Loading...' : 'No orders'}
              </div>
            ) : (
              filteredOrders.map((order) => {
                const isSelected = selectedOrder && String(selectedOrder.id) === String(order.id);
                const overdue = isPickupOverdue(order);
                const chInfo = CHANNEL_COLORS[(order.channel as PickupChannelClass) || 'PICKUP'] || CHANNEL_COLORS.PICKUP;
                const amountLabel = getPickupListAmountLabel(order);
                const placedStr = formatTime(order.createdAt || order.placedTime);
                const orderNumRaw = String(order.order_number ?? order.number ?? '').trim() || String(order.id).padStart(3, '0');
                const chType = (order.channel || '').toUpperCase();
                const orderNumStr = (chType === 'ONLINE' || chType === 'DELIVERY') ? orderNumRaw.toUpperCase() : orderNumRaw;

                return (
                <React.Fragment key={order.id}>
                  <div
                    onClick={() => handleOrderClick(order)}
                    className={`px-2 py-2 cursor-pointer transition border-l-4 border-b border-white ${
                      isSelected
                        ? 'bg-blue-50 border-l-blue-500'
                        : 'border-l-transparent'
                    }`}
                    style={!isSelected ? {
                      backgroundColor: (() => {
                        const s = String(order.status || '').toUpperCase();
                        const isPaidStatus = s === 'PAID' || s === 'CLOSED' || s === 'COMPLETED';
                        if (s === 'PICKED_UP') return undefined;
                        if (isPaidStatus) return 'rgba(229,236,240,0.1)';
                        return 'rgba(219,229,239,0.15)';
                      })(),
                    } : undefined}
                  >
                    <div className="grid grid-cols-12 items-center text-xs gap-0.5">
                      <div className="col-span-1 text-gray-500 font-mono">
                        {String(order.order_number ?? order.number ?? order.id).padStart(3, '0')}
                      </div>
                      <div className="col-span-2">
                        <span
                          className={`inline-flex min-h-[22px] min-w-[52px] max-w-[72px] items-center justify-center rounded-[5px] px-2 py-0.5 text-[9px] font-bold uppercase leading-tight tracking-wide text-white shadow-sm ${chInfo.bg} ${chInfo.text}`}
                        >
                          {channelDisplayLabel((order.channel as PickupChannelClass) || 'PICKUP')}
                        </span>
                        {order.channel === 'DELIVERY' && (order.delivery_company || order.deliveryCompany) && (
                          <span className="ml-1 text-[8px] font-bold text-gray-500">
                            {getDeliveryAbbr(order.delivery_company || order.deliveryCompany)}
                          </span>
                        )}
                      </div>
                      <div className="col-span-2 font-semibold text-gray-800 truncate" title={orderNumStr}>
                        {orderNumStr}
                      </div>
                      <div className="col-span-2 text-gray-600">
                        {placedStr}
                      </div>
                      <div className={`col-span-2 font-bold ${overdue ? 'text-red-600 animate-pulse' : 'text-emerald-700'}`}>
                        {getPickupTimeDisplay(order)}
                      </div>
                      <div className="col-span-3 flex items-center justify-end gap-1">
                        <span className="inline-block w-[38px] text-center">
                          {amountLabel && (
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${amountLabel === 'Unpaid' ? 'text-red-600 bg-red-100' : 'text-emerald-700 bg-emerald-100'}`}>
                              {amountLabel}
                            </span>
                          )}
                        </span>
                        <span className="font-semibold text-gray-800 text-right">${Number(order.total || 0).toFixed(2)}</span>
                      </div>
                    </div>
                    {overdue && (
                      <div className="mt-0.5">
                        <span className="text-[9px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded border border-red-200">OVERDUE</span>
                      </div>
                    )}
                  </div>
                  <div style={{ height: '3px', backgroundColor: 'rgba(190,209,236,0.15)' }} />
                </React.Fragment>
                );
              })
            )}
          </div>
        </div>

        {/* Right: order detail */}
        <div className="w-[50%] flex flex-col bg-white rounded-lg shadow-md overflow-hidden">
          {renderOrderDetail()}
        </div>
      </div>
    </div>
  );
};

export default PickupListPanel;
