import React, { useState, useMemo, useCallback } from 'react';
import { getDeliveryAbbr, getDeliveryChannelInfo } from '../utils/deliveryChannels';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3177';

export interface OnlineOrderForAccept {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone?: string;
  orderType: string;
  status: string;
  items: Array<{
    name: string;
    quantity: number;
    price: number;
    subtotal: number;
    options?: Array<{
      optionName: string;
      choiceName: string;
      price: number;
    }>;
  }>;
  subtotal: number;
  tax: number;
  total: number;
  notes?: string;
  createdAt: string;
  pickupTime?: string;
  readyTime?: string;
  source?: string;
  deliveryCompany?: string;
  deliveryOrderNumber?: string;
  deliveryFee?: number;
}

interface OnlineOrderAcceptModalProps {
  isOpen: boolean;
  order: OnlineOrderForAccept | null;
  queueCount: number;
  restaurantId: string | null;
  onAccept: (order: OnlineOrderForAccept, readyTime: string) => void;
  onReject: (order: OnlineOrderForAccept, reason: string) => void;
  onClose: () => void;
}

const PICKUP_MINUTES = [5, 10, 15, 20, 25, 30, 40, 50, 60];

const REJECT_REASONS = [
  'Too Busy',
  'Out of Stock',
  'Closing Soon',
  'Other',
];

function formatTime(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60000);
}

const OnlineOrderAcceptModal: React.FC<OnlineOrderAcceptModalProps> = ({
  isOpen,
  order,
  queueCount,
  restaurantId,
  onAccept,
  onReject,
  onClose,
}) => {
  const [selectedMinutes, setSelectedMinutes] = useState<number>(15);
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  const [selectedReason, setSelectedReason] = useState('Too Busy');
  const [processing, setProcessing] = useState(false);

  const now = useMemo(() => new Date(), []);

  const isAsap = useMemo(() => {
    if (!order) return true;
    return !order.pickupTime || order.pickupTime.toLowerCase() === 'asap';
  }, [order]);

  const readyTimeDisplay = useMemo(() => {
    if (!order) return '';
    if (!isAsap && order.pickupTime) {
      return order.pickupTime;
    }
    return formatTime(addMinutes(now, selectedMinutes));
  }, [order, isAsap, now, selectedMinutes]);

  const handleAccept = useCallback(async () => {
    if (!order || processing) return;
    setProcessing(true);
    try {
      const readyTime = isAsap
        ? addMinutes(new Date(), selectedMinutes).toISOString()
        : order.pickupTime || addMinutes(new Date(), selectedMinutes).toISOString();

      const response = await fetch(`${API_BASE}/api/online-orders/order/${order.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prepTime: selectedMinutes,
          pickupTime: readyTimeDisplay,
          readyTime,
          restaurantId,
        }),
      });
      const data = await response.json();
      if (data.success) {
        onAccept(order, readyTime);
      } else {
        console.error('Accept failed:', data.error);
      }
    } catch (err) {
      console.error('Accept error:', err);
    } finally {
      setProcessing(false);
    }
  }, [order, processing, isAsap, selectedMinutes, readyTimeDisplay, restaurantId, onAccept]);

  const handleReject = useCallback(async () => {
    if (!order || processing) return;
    setProcessing(true);
    try {
      const response = await fetch(`${API_BASE}/api/online-orders/order/${order.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: selectedReason,
          restaurantId,
        }),
      });
      const data = await response.json();
      if (data.success) {
        onReject(order, selectedReason);
      } else {
        console.error('Reject failed:', data.error);
      }
    } catch (err) {
      console.error('Reject error:', err);
    } finally {
      setProcessing(false);
      setShowRejectConfirm(false);
    }
  }, [order, processing, selectedReason, restaurantId, onReject]);

  if (!isOpen || !order) return null;

  const isDelivery = order.orderType === 'delivery';
  const deliveryChInfo = isDelivery ? getDeliveryChannelInfo(order.deliveryCompany || order.source || '') : null;
  const deliveryAbbrLabel = isDelivery ? getDeliveryAbbr(order.deliveryCompany || order.source || '') : '';
  const orderTypeLabel = isDelivery ? 'Delivery' : 'Pickup';
  const headerBg = isDelivery ? 'bg-red-600' : 'bg-blue-600';
  const headerTitle = isDelivery ? `New Delivery Order — ${deliveryAbbrLabel}` : 'New Online Order';

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" />

      <div className="relative bg-white rounded-xl shadow-2xl w-[780px] max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className={`flex items-center justify-between px-5 py-3 ${headerBg} text-white`}>
          <div className="flex items-center gap-3">
            <span className="text-xl font-bold">{headerTitle}</span>
            <span className="bg-white/20 rounded-full px-3 py-0.5 text-sm font-medium">
              #{order.orderNumber}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {queueCount > 1 && (
              <span className="bg-red-500 rounded-full px-2.5 py-0.5 text-xs font-bold">
                +{queueCount - 1} more
              </span>
            )}
            <span className="text-sm opacity-80">Now: {formatTime(now)}</span>
          </div>
        </div>

        {/* Body: Left + Right panels */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left Panel: Customer Info + Pickup Time */}
          <div className="w-[340px] border-r border-gray-200 p-4 flex flex-col gap-4 overflow-y-auto">
            {/* Customer Info */}
            <div className="bg-gray-50 rounded-lg p-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Customer</h3>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 text-sm w-5 text-center">👤</span>
                  <span className="font-medium text-gray-800">{order.customerName || 'Guest'}</span>
                </div>
                {order.customerPhone && (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-sm w-5 text-center">📞</span>
                    <span className="text-gray-700">{order.customerPhone}</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 text-sm w-5 text-center">📦</span>
                  <span className="text-gray-700 font-medium">{orderTypeLabel}</span>
                  {isDelivery && deliveryChInfo && (
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${deliveryChInfo.bgColor} ${deliveryChInfo.color}`}>
                      {deliveryChInfo.abbr}
                    </span>
                  )}
                  {!isDelivery && order.source && (
                    <span className="text-xs text-gray-400 ml-1">via {order.source}</span>
                  )}
                </div>
                {isDelivery && order.deliveryOrderNumber && (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-sm w-5 text-center">#</span>
                    <span className="text-gray-700 font-mono font-medium">{order.deliveryOrderNumber}</span>
                  </div>
                )}
              </div>
            </div>

            {order.notes && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                <h3 className="text-xs font-semibold text-yellow-700 uppercase mb-1">Note</h3>
                <p className="text-sm text-yellow-800">{order.notes}</p>
              </div>
            )}

            {/* Pickup Time Selection */}
            <div className="flex-1">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-gray-500 uppercase">{isDelivery ? 'Ready Time' : 'Pickup Time'}</h3>
                {!isAsap && (
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                    Customer Selected
                  </span>
                )}
              </div>

              {isAsap ? (
                <>
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-2 mb-3 text-center">
                    <span className="text-xs text-orange-600 font-medium">ASAP Order</span>
                    <div className="text-lg font-bold text-orange-800 mt-0.5">
                      Ready by {readyTimeDisplay}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {PICKUP_MINUTES.map((min) => (
                      <button
                        key={min}
                        onClick={() => setSelectedMinutes(min)}
                        className={`py-2.5 rounded-lg text-sm font-semibold border transition-all ${
                          selectedMinutes === min
                            ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                            : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:bg-blue-50'
                        }`}
                      >
                        {min} min
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                  <span className="text-xs text-green-600 font-medium">Scheduled Pickup</span>
                  <div className="text-2xl font-bold text-green-800 mt-1">
                    {order.pickupTime}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Panel: Order Items + Total */}
          <div className="flex-1 p-4 flex flex-col overflow-hidden">
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">
              Order Items ({order.items.length})
            </h3>

            <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="text-left py-2 px-3 font-medium text-gray-600">Item</th>
                    <th className="text-center py-2 px-1 font-medium text-gray-600 w-12">Qty</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-600 w-20">Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {order.items.map((item, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="py-2 px-3">
                        <div className="font-medium text-gray-800">{item.name}</div>
                        {item.options && item.options.length > 0 && (
                          <div className="text-xs text-gray-500 mt-0.5">
                            {item.options.map((opt, oi) => (
                              <span key={oi}>
                                {oi > 0 && ', '}
                                {opt.choiceName}
                                {opt.price > 0 && ` (+$${opt.price.toFixed(2)})`}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-1 text-center text-gray-700">{item.quantity}</td>
                      <td className="py-2 px-3 text-right text-gray-800 font-medium">
                        ${item.subtotal.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="mt-3 bg-gray-50 rounded-lg p-3 space-y-1.5">
              <div className="flex justify-between text-sm text-gray-600">
                <span>Subtotal</span>
                <span>${order.subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm text-gray-600">
                <span>Tax</span>
                <span>${order.tax.toFixed(2)}</span>
              </div>
              {isDelivery && (order.deliveryFee ?? 0) > 0 && (
                <div className="flex justify-between text-sm text-gray-600">
                  <span>Delivery Fee</span>
                  <span>${(order.deliveryFee ?? 0).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-lg font-bold text-gray-900 pt-1 border-t border-gray-300">
                <span>Total</span>
                <span>${order.total.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer: Action Buttons */}
        <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
          {!showRejectConfirm ? (
            <>
              <button
                onClick={() => setShowRejectConfirm(true)}
                disabled={processing}
                className="px-6 py-2.5 rounded-lg bg-red-100 text-red-700 font-semibold hover:bg-red-200 transition-colors disabled:opacity-50"
              >
                Reject
              </button>
              <button
                onClick={handleAccept}
                disabled={processing}
                className="px-10 py-2.5 rounded-lg bg-blue-600 text-white font-bold text-lg hover:bg-blue-700 transition-colors shadow-md disabled:opacity-50"
              >
                {processing ? 'Processing...' : 'OK'}
              </button>
            </>
          ) : (
            <div className="flex items-center gap-3 w-full">
              <button
                onClick={() => setShowRejectConfirm(false)}
                className="px-4 py-2 rounded-lg bg-gray-200 text-gray-700 font-medium hover:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
              <div className="flex-1 flex items-center gap-2">
                <span className="text-sm text-gray-600 whitespace-nowrap">Reason:</span>
                <div className="flex gap-1.5 flex-1 flex-wrap">
                  {REJECT_REASONS.map((r) => (
                    <button
                      key={r}
                      onClick={() => setSelectedReason(r)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                        selectedReason === r
                          ? 'bg-red-600 text-white border-red-600'
                          : 'bg-white text-gray-600 border-gray-300 hover:border-red-400'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={handleReject}
                disabled={processing}
                className="px-6 py-2 rounded-lg bg-red-600 text-white font-bold hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {processing ? 'Rejecting...' : 'Confirm Reject'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OnlineOrderAcceptModal;
