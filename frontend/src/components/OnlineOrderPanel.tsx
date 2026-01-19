// frontend/src/components/OnlineOrderPanel.tsx
// 온라인 주문 패널 - 테이블맵 오른쪽에 표시

import React, { useState, useEffect, useRef, useCallback } from 'react';

// 주문 상태 라벨
const STATUS_LABELS: Record<string, { label: string; color: string; bgColor: string }> = {
  pending: { label: '대기', color: 'text-yellow-800', bgColor: 'bg-yellow-100' },
  confirmed: { label: '확인', color: 'text-blue-800', bgColor: 'bg-blue-100' },
  preparing: { label: '준비중', color: 'text-orange-800', bgColor: 'bg-orange-100' },
  ready: { label: '완료', color: 'text-green-800', bgColor: 'bg-green-100' },
  completed: { label: '수령', color: 'text-gray-800', bgColor: 'bg-gray-100' },
  cancelled: { label: '취소', color: 'text-red-800', bgColor: 'bg-red-100' }
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
      audioRef.current = new Audio('/sounds/new-order.mp3');
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
        audioRef.current = new Audio('/sounds/new-order.mp3');
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
      className="fixed right-0 top-0 h-full w-96 bg-white shadow-2xl z-50 flex flex-col"
      onClick={handlePanelClick}
    >
      {/* 헤더 */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">🌐</span>
          <h2 className="text-lg font-bold">온라인 주문</h2>
          {connected && (
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" title="연결됨" />
          )}
          {soundEnabled && (
            <span 
              className={`text-sm ${audioUnlocked ? 'text-green-300' : 'text-yellow-300 animate-pulse cursor-pointer'}`}
              title={audioUnlocked ? '알림음 활성화됨' : '클릭하여 알림음 활성화'}
            >
              {audioUnlocked ? '🔔' : '🔕'}
            </span>
          )}
        </div>
        <button 
          onClick={onClose}
          className="text-white hover:bg-white/20 rounded-lg p-2 transition"
        >
          ✕
        </button>
      </div>

      {/* 필터 탭 */}
      <div className="flex border-b bg-gray-50">
        {['pending', 'confirmed', 'preparing', 'ready'].map(status => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`flex-1 py-2 text-sm font-medium transition ${
              filter === status 
                ? 'bg-white text-blue-600 border-b-2 border-blue-600' 
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {STATUS_LABELS[status]?.label || status}
          </button>
        ))}
      </div>

      {/* 주문 목록 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-400">
            <span className="text-3xl mb-2">📭</span>
            <span>주문이 없습니다</span>
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
        <div className="border-t bg-gray-50 p-4 max-h-80 overflow-y-auto">
          <div className="flex justify-between items-start mb-3">
            <div>
              <div className="font-bold text-lg">{selectedOrder.orderNumber}</div>
              <div className="text-sm text-gray-600">
                {ORDER_TYPE_LABELS[selectedOrder.orderType]?.label || selectedOrder.orderType}
              </div>
            </div>
            <button
              onClick={() => setSelectedOrder(null)}
              className="text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>

          {/* 고객 정보 */}
          <div className="bg-white rounded-lg p-3 mb-3 text-sm">
            <div className="font-medium">{selectedOrder.customerName}</div>
            <div className="text-gray-600">{selectedOrder.customerPhone}</div>
          </div>

          {/* 주문 아이템 */}
          <div className="bg-white rounded-lg p-3 mb-3">
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
              <span>Subtotal</span>
              <span>${selectedOrder.subtotal?.toFixed(2) || (selectedOrder.items?.reduce((sum: number, it: any) => sum + (it.subtotal || 0), 0) || 0).toFixed(2)}</span>
            </div>
            
            {/* Discount */}
            {selectedOrder.discountAmount && selectedOrder.discountAmount > 0 && (
              <>
                <div className="flex justify-between text-sm text-green-600">
                  <span>🎁 {selectedOrder.promotionName || 'Discount'}</span>
                  <span>-${selectedOrder.discountAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm font-medium">
                  <span>After Discount</span>
                  <span>${((selectedOrder.subtotal || 0) - selectedOrder.discountAmount).toFixed(2)}</span>
                </div>
              </>
            )}
            
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

          {/* 요청사항 */}
          {selectedOrder.notes && (
            <div className="bg-yellow-50 rounded-lg p-3 mb-3 text-sm">
              <div className="font-medium text-yellow-800">요청사항</div>
              <div className="text-yellow-700">{selectedOrder.notes}</div>
            </div>
          )}

          {/* 액션 버튼 */}
          <div className="flex gap-2">
            {selectedOrder.status === 'pending' && (
              <>
                <button
                  onClick={() => confirmOrder(selectedOrder.id)}
                  className="flex-1 bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 transition"
                >
                  ✓ 확인
                </button>
                <button
                  onClick={() => updateOrderStatus(selectedOrder.id, 'cancelled')}
                  className="px-4 bg-red-100 text-red-600 py-2 rounded-lg font-medium hover:bg-red-200 transition"
                >
                  취소
                </button>
              </>
            )}
            {selectedOrder.status === 'confirmed' && (
              <button
                onClick={() => updateOrderStatus(selectedOrder.id, 'preparing')}
                className="flex-1 bg-orange-500 text-white py-2 rounded-lg font-medium hover:bg-orange-600 transition"
              >
                🍳 준비 시작
              </button>
            )}
            {selectedOrder.status === 'preparing' && (
              <button
                onClick={() => updateOrderStatus(selectedOrder.id, 'ready')}
                className="flex-1 bg-green-500 text-white py-2 rounded-lg font-medium hover:bg-green-600 transition"
              >
                ✓ 준비 완료
              </button>
            )}
            {selectedOrder.status === 'ready' && (
              <button
                onClick={() => updateOrderStatus(selectedOrder.id, 'completed')}
                className="flex-1 bg-gray-600 text-white py-2 rounded-lg font-medium hover:bg-gray-700 transition"
              >
                ✓ 수령 완료
              </button>
            )}
            <button
              onClick={() => printOrder(selectedOrder.id)}
              className="px-4 bg-gray-100 text-gray-700 py-2 rounded-lg font-medium hover:bg-gray-200 transition"
            >
              🖨️
            </button>
          </div>
        </div>
      )}

      {/* 새로고침 버튼 */}
      <div className="p-2 border-t bg-gray-50">
        <button
          onClick={fetchOrders}
          disabled={loading}
          className="w-full py-2 text-sm text-gray-600 hover:text-blue-600 transition"
        >
          {loading ? '로딩...' : '🔄 새로고침'}
        </button>
      </div>
    </div>
  );
};

export default OnlineOrderPanel;

