// frontend/src/components/OnlineOrderPanel.tsx
// 온라인 주문 패널 - 테이블맵 오른쪽에 표시
// Updated: 2026-01-20 v3

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { CSSProperties } from 'react';
import {
  PAY_NEO,
  PAY_NEO_PRIMARY_BLUE,
  NEO_COLOR_BTN_PRESS,
  NEO_MODAL_BTN_PRESS,
  SOFT_NEO,
} from '../utils/softNeumorphic';

/** Online 패널 본문·헤더·목록 등 공통 배경 */
const ONLINE_PANEL_BG = '#ffffff';

/** 헤더 — 흰 배경 + 하단 구분선 (회색 네오 캔버스 톤 제거) */
const ONLINE_PANEL_HEADER_RAISED: CSSProperties = {
  background: ONLINE_PANEL_BG,
  boxShadow: 'none',
  borderBottom: '1px solid #e5e7eb',
};

/** 우측 상단 닫기 — 볼록 네오; 하이라이트를 패널 배경과 동일 톤으로 */
const ONLINE_PANEL_CLOSE_BTN: CSSProperties = {
  background: ONLINE_PANEL_BG,
  borderRadius: 12,
  border: 0,
  boxShadow: `5px 5px 10px #babecc, -5px -5px 10px ${ONLINE_PANEL_BG}`,
};

// Order status labels
const STATUS_LABELS: Record<string, { label: string; color: string; bgColor: string }> = {
  pending: { label: 'Pending', color: 'text-yellow-800', bgColor: 'bg-yellow-100' },
  confirmed: { label: 'Confirmed', color: 'text-blue-800', bgColor: 'bg-blue-100' },
  preparing: { label: 'Preparing', color: 'text-orange-800', bgColor: 'bg-orange-100' },
  ready: { label: 'Ready', color: 'text-green-800', bgColor: 'bg-green-100' },
  completed: { label: 'Completed', color: 'text-gray-800', bgColor: 'bg-gray-100' },
  cancelled: { label: 'Cancelled', color: 'text-red-800', bgColor: 'bg-red-100' }
};

// 주문 유형 라벨
const ORDER_TYPE_LABELS: Record<string, { label: string; icon: string }> = {
  pickup: { label: 'PICKUP', icon: '🛍️' },
  delivery: { label: 'DELIVERY', icon: '🚗' },
  dine_in: { label: 'DINE-IN', icon: '🍽️' }
};

interface OnlineOrder {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  orderType: string;
  status: string;
  items: Array<{
    name: string;
    quantity: number;
    price: number;
    subtotal: number;
    discountAmount?: number;
    discountPercent?: number;
    promotionName?: string;
    priceAfterDiscount?: number;
    options?: Array<{
      optionName: string;
      choiceName: string;
      price: number;
    }>;
  }>;
  subtotal: number;
  subtotalAfterDiscount?: number;
  tax: number;
  total: number;
  notes?: string;
  createdAt: string;
  // Promotion fields
  discountAmount?: number;
  promotionId?: string;
  promotionName?: string;
  promotionType?: string;
  promotionPercent?: number;
  taxBreakdown?: Array<{
    name: string;
    rate: number;
    amount: number;
  }>;
}

interface OnlineOrderPanelProps {
  restaurantId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onOrderSelect?: (order: OnlineOrder) => void;
  autoConfirm?: boolean;
  soundEnabled?: boolean;
}

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3177';

export const OnlineOrderPanel: React.FC<OnlineOrderPanelProps> = ({
  restaurantId,
  isOpen,
  onClose,
  onOrderSelect,
  autoConfirm = false,
  soundEnabled = true
}) => {
  const [orders, setOrders] = useState<OnlineOrder[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<OnlineOrder | null>(null);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [filter, setFilter] = useState<string>('pending');
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const audioUnlockedRef = useRef<boolean>(false);

  // 오디오 초기화 (한 번만)
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio('/sounds/Online_Order.mp3');
      audioRef.current.preload = 'auto';
      audioRef.current.volume = 1.0;
    }
  }, []);

  // 브라우저 자동재생 정책 해제 (사용자 상호작용 시)
  const unlockAudio = useCallback(() => {
    if (audioUnlockedRef.current || !audioRef.current) return;
    
    // 무음으로 한 번 재생해서 브라우저 정책 해제
    audioRef.current.volume = 0;
    audioRef.current.play()
      .then(() => {
        audioRef.current!.pause();
        audioRef.current!.currentTime = 0;
        audioRef.current!.volume = 1.0;
        audioUnlockedRef.current = true;
        setAudioUnlocked(true);
        console.log('🔓 오디오 자동재생 해제됨');
      })
      .catch(() => {
        // 무시 - 사용자 상호작용 필요
      });
  }, []);

  // 패널 열릴 때 오디오 해제 시도
  useEffect(() => {
    if (isOpen) {
      unlockAudio();
    }
  }, [isOpen, unlockAudio]);

  // 알림음 재생
  const playNotificationSound = useCallback(() => {
    if (!soundEnabled) return;
    
    try {
      if (!audioRef.current) {
        audioRef.current = new Audio('/sounds/Online_Order.mp3');
      }
      audioRef.current.currentTime = 0;
      audioRef.current.volume = 1.0;
      
      const playPromise = audioRef.current.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            console.log('🔔 알림음 재생 성공');
          })
          .catch(err => {
            console.warn('알림음 재생 실패 (자동재생 차단):', err.message);
            // 브라우저 알림으로 대체
            if ('Notification' in window && Notification.permission === 'granted') {
              new Notification('새 온라인 주문', {
                body: '새로운 주문이 들어왔습니다!',
                icon: '/favicon.ico'
              });
            }
          });
      }
    } catch (error) {
      console.error('오디오 초기화 실패:', error);
    }
  }, [soundEnabled]);

  // 주문 목록 조회
  const fetchOrders = useCallback(async () => {
    if (!restaurantId) return;
    
    setLoading(true);
    try {
      const url = `${API_BASE}/api/online-orders/${restaurantId}${filter ? `?status=${filter}` : ''}`;
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.success) {
        setOrders(data.orders || []);
      }
    } catch (error) {
      console.error('주문 목록 조회 실패:', error);
    } finally {
      setLoading(false);
    }
  }, [restaurantId, filter]);

  // SSE 연결 (실시간 주문 수신)
  const connectSSE = useCallback(() => {
    if (!restaurantId) return;

    // 기존 연결 정리
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const url = `${API_BASE}/api/online-orders/stream/${restaurantId}`;
    const eventSource = new EventSource(url);

    eventSource.onopen = () => {
      console.log('🔗 SSE 연결됨');
      setConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'connected') {
          console.log('📡 SSE 클라이언트 ID:', data.clientId);
        } else if (data.type === 'new_order') {
          console.log('🆕 새 주문:', data.order);
          
          // 알림음 재생 (새 주문이 SSE로 들어오면 항상 재생)
          // createdAt 시간과 관계없이 SSE new_order 이벤트 = 새 주문이므로 알림음 재생
          playNotificationSound();
          console.log('🔔 새 주문 알림음 재생:', data.order.orderNumber);
          
          // 주문 목록에 추가
          setOrders(prev => {
            // 중복 주문 체크
            if (prev.some(o => o.id === data.order.id)) return prev;
            return [data.order, ...prev];
          });
          
          // 자동 확인 모드
          if (autoConfirm) {
            confirmOrder(data.order.id);
          }
        } else if (data.type === 'order_updated') {
          console.log('📝 주문 업데이트:', data.order);
          
          // 주문 목록 업데이트
          setOrders(prev => 
            prev.map(o => o.id === data.order.id ? data.order : o)
          );
        }
      } catch (error) {
        console.error('SSE 메시지 파싱 실패:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('❌ SSE 오류:', error);
      setConnected(false);
      
      // 재연결 시도
      setTimeout(() => {
        if (isOpen && restaurantId) {
          connectSSE();
        }
      }, 5000);
    };

    eventSourceRef.current = eventSource;
  }, [restaurantId, isOpen, autoConfirm, playNotificationSound]);

  // 주문 확인
  const confirmOrder = async (orderId: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/online-orders/order/${orderId}/confirm`, {
        method: 'POST'
      });
      const data = await response.json();
      
      if (data.success) {
        // 상태 업데이트는 SSE로 수신됨
        console.log('✅ 주문 확인됨:', orderId);
      }
    } catch (error) {
      console.error('주문 확인 실패:', error);
    }
  };

  // 주문 상태 변경
  const updateOrderStatus = async (orderId: string, status: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/online-orders/order/${orderId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      const data = await response.json();
      
      if (data.success) {
        console.log(`✅ 주문 상태 변경: ${orderId} → ${status}`);
        fetchOrders();
      }
    } catch (error) {
      console.error('주문 상태 변경 실패:', error);
    }
  };

  // 주문 출력
  const printOrder = async (orderId: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/online-orders/order/${orderId}/print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printerType: 'both' })
      });
      const data = await response.json();
      
      if (data.success) {
        console.log('🖨️ 출력 요청 완료');
      }
    } catch (error) {
      console.error('출력 실패:', error);
    }
  };

  // 패널 열릴 때 연결 (연결은 restaurantId가 있으면 상시 유지)
  useEffect(() => {
    if (restaurantId) {
      fetchOrders();
      connectSSE();
    }
    
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        setConnected(false);
      }
    };
  }, [restaurantId, fetchOrders, connectSSE]);

  // 필터 변경 시 목록 새로고침
  useEffect(() => {
    if (isOpen && restaurantId) {
      fetchOrders();
    }
  }, [filter, isOpen, restaurantId, fetchOrders]);

  // UI 렌더링 조건은 하단으로 이동
  if (!isOpen) {
    // 패널이 닫혀있어도 SSE 연결은 유지되지만 UI는 렌더링하지 않음
    return null;
  }

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  };

  // Safari/모든 브라우저 호환: 패널 클릭 시 오디오 해제
  const handlePanelClick = () => {
    if (!audioUnlockedRef.current && audioRef.current) {
      audioRef.current.volume = 0;
      audioRef.current.play()
        .then(() => {
          audioRef.current!.pause();
          audioRef.current!.currentTime = 0;
          audioRef.current!.volume = 1.0;
          audioUnlockedRef.current = true;
          setAudioUnlocked(true);
          console.log('🔓 Safari: 오디오 자동재생 해제됨 (클릭)');
        })
        .catch(() => {});
    }
  };

  return (
    <div
      className="fixed right-0 top-0 z-50 flex h-full w-96 flex-col overflow-hidden"
      style={{
        ...PAY_NEO.modalShell,
        background: ONLINE_PANEL_BG,
        borderRadius: '16px 0 0 16px',
      }}
      onClick={handlePanelClick}
    >
      {/* Header */}
      <div
        className="relative flex shrink-0 items-center justify-between p-4 pr-16 text-slate-800"
        style={ONLINE_PANEL_HEADER_RAISED}
      >
        <div className="flex items-center gap-2">
          <span className="text-xl">🌐</span>
          <h2 className="text-lg font-bold">Online Orders</h2>
          {connected && (
            <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" title="Connected" />
          )}
          {soundEnabled && (
            <span
              className={`text-sm ${audioUnlocked ? 'text-green-700' : 'text-amber-600 animate-pulse cursor-pointer'}`}
              title={audioUnlocked ? 'Sound enabled' : 'Click to enable sound'}
            >
              {audioUnlocked ? '🔔' : '🔕'}
            </span>
          )}
        </div>
        {/* Gift Card 모달과 동일한 닫기 X (PaymentModal.tsx showGiftCardModal 버튼) */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          aria-label="Close"
          className={`absolute top-4 right-4 z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-0 touch-manipulation ${NEO_MODAL_BTN_PRESS}`}
          style={ONLINE_PANEL_CLOSE_BTN}
        >
          <svg className="h-5 w-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 필터 탭 */}
      <div
        className="flex shrink-0 gap-1 border-b border-transparent p-1.5"
        style={{ ...PAY_NEO.inset, borderRadius: 0, background: ONLINE_PANEL_BG }}
      >
        {['pending', 'confirmed', 'preparing', 'ready'].map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setFilter(status)}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${filter === status ? 'text-blue-800' : 'text-slate-600 hover:text-slate-800'}`}
            style={filter === status ? { ...PAY_NEO.inset } : { ...PAY_NEO.key }}
          >
            {STATUS_LABELS[status]?.label || status}
          </button>
        ))}
      </div>

      {/* 주문 목록 */}
      <div className="flex-1 overflow-y-auto" style={{ background: ONLINE_PANEL_BG }}>
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-400">
            <span className="text-3xl mb-2">📭</span>
            <span>No orders</span>
          </div>
        ) : (
          orders.map(order => (
            <div
              key={order.id}
              onClick={() => {
                setSelectedOrder(order);
                onOrderSelect?.(order);
              }}
              className={`p-3 border-b cursor-pointer hover:bg-gray-50 transition ${
                selectedOrder?.id === order.id ? 'bg-blue-50' : ''
              }`}
            >
              {/* 주문 헤더 */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg">
                    {ORDER_TYPE_LABELS[order.orderType]?.icon || '📦'}
                  </span>
                  <span className="font-bold text-sm">
                    {order.orderNumber?.slice(-8) || order.id.slice(-8)}
                  </span>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  STATUS_LABELS[order.status]?.bgColor || 'bg-gray-100'
                } ${STATUS_LABELS[order.status]?.color || 'text-gray-800'}`}>
                  {STATUS_LABELS[order.status]?.label || order.status}
                </span>
              </div>

              {/* 고객 정보 */}
              <div className="text-sm text-gray-600 mb-1">
                {order.customerName} · {formatTime(order.createdAt)}
              </div>

              {/* 아이템 미리보기 */}
              <div className="text-xs text-gray-500 truncate">
                {order.items?.map(item => `${item.name} x${item.quantity}`).join(', ')}
              </div>

              {/* 금액 */}
              <div className="text-right font-bold text-blue-600 mt-1">
                ${order.total?.toFixed(2)}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 선택된 주문 상세 */}
      {selectedOrder && (
        <div
          className="max-h-80 overflow-y-auto border-t border-transparent p-4"
          style={{ ...PAY_NEO.inset, borderRadius: 0, background: ONLINE_PANEL_BG }}
        >
          <div className="mb-3 flex items-start justify-between">
            <div>
              <div className="text-lg font-bold">{selectedOrder.orderNumber}</div>
              <div className="text-sm text-gray-600">
                {ORDER_TYPE_LABELS[selectedOrder.orderType]?.label || selectedOrder.orderType}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedOrder(null)}
              aria-label="Close"
              className="flex h-9 w-9 shrink-0 touch-manipulation items-center justify-center rounded-full border-2 border-red-500 transition-transform active:scale-95"
              style={SOFT_NEO.btnRound}
            >
              <svg className="h-4 w-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* 고객 정보 */}
          <div className="mb-3 rounded-lg p-3 text-sm" style={PAY_NEO.inset}>
            <div className="font-medium">{selectedOrder.customerName}</div>
            <div className="text-gray-600">{selectedOrder.customerPhone}</div>
          </div>

          {/* 주문 아이템 */}
          <div className="mb-3 rounded-lg p-3" style={PAY_NEO.inset}>
            {selectedOrder.items?.map((item: any, idx: number) => (
              <div key={idx} className="py-1 border-b last:border-0">
                <div className="flex justify-between text-sm">
                  <span>{item.name} x{item.quantity}</span>
                  <span>
                    {item.discountAmount && item.discountAmount > 0 ? (
                      <>
                        <span className="line-through text-gray-400 mr-1">${item.subtotal?.toFixed(2)}</span>
                        <span className="text-green-600">${item.priceAfterDiscount?.toFixed(2) || (item.subtotal - item.discountAmount).toFixed(2)}</span>
                      </>
                    ) : (
                      `$${item.subtotal?.toFixed(2)}`
                    )}
                  </span>
                </div>
                {item.options?.map((opt: any, optIdx: number) => (
                  <div key={optIdx} className="text-xs text-gray-500 pl-2">
                    + {opt.choiceName} {opt.price > 0 && `($${opt.price.toFixed(2)})`}
                  </div>
                ))}
                {item.discountPercent && item.discountPercent > 0 && (
                  <div className="text-xs text-green-600 pl-2 font-medium">
                    🎁 {item.discountPercent}% off ({item.promotionName || 'Promotion'})
                  </div>
                )}
              </div>
            ))}
            
            {/* Subtotal */}
            <div className="flex justify-between text-sm pt-2 mt-2 border-t">
              <span>Sub Total</span>
              <span>${selectedOrder.subtotal?.toFixed(2) || (selectedOrder.items?.reduce((sum: number, it: any) => sum + (it.subtotal || 0), 0) || 0).toFixed(2)}</span>
            </div>
            
            {/* Discount 표시 - TEST V2 */}
            {(() => {
              const subtotalVal = selectedOrder.subtotal || selectedOrder.items?.reduce((s: number, i: any) => s + (i.subtotal || 0), 0) || 0;
              const taxVal = selectedOrder.taxBreakdown?.reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0) || selectedOrder.tax || 0;
              const totalVal = selectedOrder.total || 0;
              const discountCalc = subtotalVal - (totalVal - taxVal);
              console.log('[DISCOUNT-TEST-V2]', { subtotalVal, taxVal, totalVal, discountCalc });
              
              if (discountCalc > 0.5) {
                const promoName = selectedOrder.promotionName || 
                  selectedOrder.items?.find((i: any) => i.promotionName)?.promotionName || 
                  'Promotion';
                return (
                  <>
                    <div className="flex justify-between text-sm text-green-600">
                      <span>🎁 {promoName}:</span>
                      <span>-${discountCalc.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm font-medium">
                      <span>After Discount</span>
                      <span>${(subtotalVal - discountCalc).toFixed(2)}</span>
                    </div>
                  </>
                );
              }
              return null;
            })()}
            
            {/* Tax */}
            {selectedOrder.taxBreakdown && Array.isArray(selectedOrder.taxBreakdown) ? (
              selectedOrder.taxBreakdown.map((tax: any, idx: number) => (
                <div key={idx} className="flex justify-between text-sm text-gray-600">
                  <span>{tax.name} ({tax.rate}%)</span>
                  <span>${tax.amount?.toFixed(2)}</span>
                </div>
              ))
            ) : selectedOrder.tax ? (
              <div className="flex justify-between text-sm text-gray-600">
                <span>Tax</span>
                <span>${selectedOrder.tax?.toFixed(2)}</span>
              </div>
            ) : null}
            
            {/* Total */}
            <div className="flex justify-between font-bold pt-2 mt-2 border-t">
              <span>Total</span>
              <span className="text-blue-600">${selectedOrder.total?.toFixed(2)}</span>
            </div>
          </div>

          {/* Notes */}
          {selectedOrder.notes && (
            <div className="mb-3 rounded-lg border border-amber-200/60 bg-amber-50/90 p-3 text-sm">
              <div className="font-medium text-yellow-800">Special Request</div>
              <div className="text-yellow-700">{selectedOrder.notes}</div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            {selectedOrder.status === 'pending' && (
              <>
                <button
                  type="button"
                  onClick={() => confirmOrder(selectedOrder.id)}
                  className={`flex-1 min-w-[120px] rounded-lg py-2 font-medium text-white ${NEO_COLOR_BTN_PRESS}`}
                  style={PAY_NEO_PRIMARY_BLUE}
                >
                  ✓ Confirm
                </button>
                <button
                  type="button"
                  onClick={() => updateOrderStatus(selectedOrder.id, 'cancelled')}
                  className={`rounded-lg px-4 py-2 font-medium text-red-700 ${NEO_MODAL_BTN_PRESS}`}
                  style={PAY_NEO.key}
                >
                  Cancel
                </button>
              </>
            )}
            {selectedOrder.status === 'confirmed' && (
              <button
                type="button"
                onClick={() => updateOrderStatus(selectedOrder.id, 'preparing')}
                className={`flex-1 rounded-lg py-2 font-medium text-white ${NEO_COLOR_BTN_PRESS}`}
                style={{
                  ...PAY_NEO.raised,
                  background: 'linear-gradient(145deg, #fb923c, #ea580c)',
                  color: '#fff',
                  boxShadow: '5px 5px 12px rgba(194,65,12,0.45), -3px -3px 10px rgba(255,255,255,0.25)',
                }}
              >
                🍳 Start Preparing
              </button>
            )}
            {selectedOrder.status === 'preparing' && (
              <button
                type="button"
                onClick={() => updateOrderStatus(selectedOrder.id, 'ready')}
                className={`flex-1 rounded-lg py-2 font-medium text-white ${NEO_COLOR_BTN_PRESS}`}
                style={{
                  ...PAY_NEO.raised,
                  background: 'linear-gradient(145deg, #22c55e, #16a34a)',
                  color: '#fff',
                  boxShadow: '5px 5px 12px rgba(22,101,52,0.45), -3px -3px 10px rgba(255,255,255,0.25)',
                }}
              >
                ✓ Ready
              </button>
            )}
            {selectedOrder.status === 'ready' && (
              <button
                type="button"
                onClick={() => updateOrderStatus(selectedOrder.id, 'completed')}
                className={`flex-1 rounded-lg py-2 font-medium text-white ${NEO_COLOR_BTN_PRESS}`}
                style={{
                  ...PAY_NEO.raised,
                  background: 'linear-gradient(145deg, #4b5563, #374151)',
                  color: '#fff',
                  boxShadow: '5px 5px 12px rgba(55,65,81,0.45), -3px -3px 10px rgba(255,255,255,0.25)',
                }}
              >
                ✓ Completed
              </button>
            )}
            <button
              type="button"
              onClick={() => printOrder(selectedOrder.id)}
              className={`rounded-lg px-4 py-2 font-medium text-slate-700 ${NEO_MODAL_BTN_PRESS}`}
              style={PAY_NEO.key}
            >
              🖨️
            </button>
          </div>
        </div>
      )}

      {/* Refresh button */}
      <div className="border-t border-transparent p-2" style={{ background: ONLINE_PANEL_BG }}>
        <button
          type="button"
          onClick={fetchOrders}
          disabled={loading}
          className={`w-full rounded-lg py-2 text-sm font-medium text-slate-700 disabled:opacity-50 ${NEO_MODAL_BTN_PRESS}`}
          style={PAY_NEO.key}
        >
          {loading ? 'Loading...' : '🔄 Refresh'}
        </button>
      </div>
    </div>
  );
};

export default OnlineOrderPanel;

