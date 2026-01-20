import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ShoppingCart, Plus, Minus, X, Send, Utensils, Clock, Trash2, Bell, Receipt, Droplets, HelpCircle, CreditCard, UtensilsCrossed, Sparkles, Package } from 'lucide-react';

// 날아가는 아이템 인터페이스
interface FlyingItem {
  id: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  name: string;
  price: number;
  image_url?: string;
}

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3177/api';

interface MenuItem {
  item_id: number;
  name: string;
  price: number;
  description?: string;
  image_url?: string;
  category_id: number;
}

interface Category {
  category_id: number;
  name: string;
  items: MenuItem[];
}

interface Modifier {
  modifier_id: number;
  name: string;
  price_adjustment: number;
}

interface ModifierGroup {
  modifier_group_id: number;
  name: string;
  selection_type: 'SINGLE' | 'MULTIPLE';
  min_selection: number;
  max_selection: number;
  modifiers: Modifier[];
}

interface SelectedModifier {
  group_id: number;
  group_name: string;
  modifier_id: number;
  name: string;
  price_adjustment: number;
}

interface CartItem extends MenuItem {
  quantity: number;
  cartId: string;
  modifiers: SelectedModifier[];
}

interface TableInfo {
  store_id: string;
  table_id: string;
  table_label: string;
  menu_id: number;
  menu_name: string;
  business_name?: string;
}

interface FirebasePromotion {
  id: string;
  type: string;
  name: string;
  message?: string;
  description: string;
  active: boolean;
  channels: string[];
}

// Promo Banner with Marquee Animation (same as TZO Online Order)
function PromoBanner({ messages }: { messages: string[] }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [animating, setAnimating] = useState(true);

  useEffect(() => {
    if (messages.length === 0) return;
    
    // 각 메시지를 4초간 표시 (충분히 읽을 시간 제공)
    const interval = setInterval(() => {
      setAnimating(false);
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % messages.length);
        setAnimating(true);
      }, 50);
    }, 4000);

    return () => clearInterval(interval);
  }, [messages.length]);

  if (messages.length === 0) return null;

  return (
    <>
      <style>{`
        .promo-banner-marquee {
          background: linear-gradient(135deg, #dc2626 0%, #b91c1c 50%, #991b1b 100%);
          padding: 10px 0;
          position: sticky;
          top: 0;
          z-index: 150;
          overflow: hidden;
          box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        }
        .promo-marquee-content {
          display: inline-block;
          white-space: nowrap;
          padding-left: 100%;
          opacity: 0;
        }
        .promo-marquee-content.animate {
          animation: marqueeSlide 3.8s ease-in-out forwards;
        }
        .promo-marquee-text {
          color: white;
          font-size: 18px;
          font-weight: 700;
          text-shadow: 0 1px 3px rgba(0,0,0,0.3);
          letter-spacing: 0.5px;
        }
        @keyframes marqueeSlide {
          0% { transform: translateX(0); opacity: 0; }
          10% { opacity: 1; }
          30% { transform: translateX(-50%); opacity: 1; }
          70% { transform: translateX(-50%); opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateX(-100%); opacity: 0; }
        }
        @media (min-width: 641px) {
          .promo-banner-marquee { padding: 12px 0; }
          .promo-marquee-text { font-size: 22px; }
        }
        @media (min-width: 1025px) {
          .promo-banner-marquee { padding: 14px 0; }
          .promo-marquee-text { font-size: 26px; }
        }
      `}</style>
      <div className="promo-banner-marquee">
        <div className={`promo-marquee-content ${animating ? 'animate' : ''}`}>
          <span className="promo-marquee-text">🎁 {messages[currentIndex]}</span>
        </div>
      </div>
    </>
  );
}

const TableOrderPage: React.FC = () => {
  const { storeId, tableId } = useParams<{ storeId: string; tableId: string }>();
  const [searchParams] = useSearchParams();
  
  const effectiveStoreId = storeId || searchParams.get('store') || 'default';
  const effectiveTableId = tableId || searchParams.get('table') || 'T01';

  const [tableInfo, setTableInfo] = useState<TableInfo | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderSubmitted, setOrderSubmitted] = useState(false);
  const [submittedOrderId, setSubmittedOrderId] = useState<string>('');
  const [customerNote, setCustomerNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  
  // 화면 전환 상태 (Thank You → Video)
  const [showVideo, setShowVideo] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const thankYouTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // 날아가는 애니메이션 상태
  const [flyingItems, setFlyingItems] = useState<FlyingItem[]>([]);
  const cartIconRef = useRef<HTMLDivElement>(null);
  
  // 모디파이어 모달 상태
  const [showModifierModal, setShowModifierModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [selectedModifiers, setSelectedModifiers] = useState<SelectedModifier[]>([]);
  const [loadingModifiers, setLoadingModifiers] = useState(false);
  const [itemQuantity, setItemQuantity] = useState(1);
  const lastClickEvent = useRef<React.MouseEvent | null>(null);
  
  // 삭제 확인 모달 상태
  const [deleteConfirm, setDeleteConfirm] = useState<{ show: boolean; cartId: string; itemName: string }>({
    show: false,
    cartId: '',
    itemName: ''
  });
  
  // 전체 삭제 확인 모달 상태
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  
  // Call Server 모달 상태
  const [showCallServerModal, setShowCallServerModal] = useState(false);
  const [callServerSent, setCallServerSent] = useState<string | null>(null);
  const [isCallingServer, setIsCallingServer] = useState(false);
  
  // 프로모션 상태
  const [promotions, setPromotions] = useState<FirebasePromotion[]>([]);
  
  // Call Server 전송 함수
  const sendCallServerRequest = async (callType: string, message: string) => {
    setIsCallingServer(true);
    try {
      const response = await fetch(`${API_URL}/call-server`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table_id: effectiveTableId,
          table_label: tableInfo?.table_label || effectiveTableId,
          call_type: callType,
          message: message,
          store_id: effectiveStoreId
        })
      });
      
      if (response.ok) {
        setCallServerSent(message);
      } else {
        setCallServerSent('Failed to send request. Please try again.');
      }
    } catch (error) {
      console.error('Call server error:', error);
      setCallServerSent('Network error. Please try again.');
    } finally {
      setIsCallingServer(false);
    }
  };

  // 테이블 정보 및 메뉴 로드
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const infoRes = await fetch(`${API_URL}/table-orders/info?storeId=${effectiveStoreId}&tableId=${effectiveTableId}`);
        if (!infoRes.ok) throw new Error('Failed to load table info');
        const info = await infoRes.json();
        setTableInfo(info);
        
        // 동영상 URL 설정 (테이블 정보에서 가져오거나 기본값 사용)
        if (info.screensaver_video_url) {
          setVideoUrl(info.screensaver_video_url);
        }

        if (info.menu_id) {
          const menuRes = await fetch(`${API_URL}/table-orders/menu/${info.menu_id}`);
          if (menuRes.ok) {
            const menuData = await menuRes.json();
            setCategories(menuData.categories || []);
            if (menuData.categories?.length > 0) {
              setSelectedCategory(menuData.categories[0].category_id);
            }
          }
        }
        
        // 프로모션 로드 (POS 데이터베이스에서)
        try {
          const promoRes = await fetch(`${API_URL}/promotions/pos-promotions`);
          if (promoRes.ok) {
            const promoData = await promoRes.json();
            // table-order 채널에 적용되는 활성 프로모션만 필터링
            const tableOrderChannelNames = ['table-order', 'tableorder', 'qr-order', 'qrorder'];
            const tableOrderPromos = (promoData.promotions || []).filter(
              (p: any) => p.active && p.message && p.channels?.some((c: string) => tableOrderChannelNames.includes(c.toLowerCase()))
            );
            // Convert to FirebasePromotion format for compatibility
            const convertedPromos: FirebasePromotion[] = tableOrderPromos.map((p: any) => ({
              id: p.id,
              type: p.type,
              name: p.name,
              message: p.message || '',
              description: p.description || '',
              active: p.active,
              minOrderAmount: p.minOrderAmount || 0,
              discountPercent: p.discountPercent || 0,
              discountAmount: p.discountAmount || 0,
              validFrom: p.validFrom || '',
              validUntil: p.validUntil || '',
              channels: p.channels || [],
              selectedItems: p.selectedItems || [],
              selectedCategories: p.selectedCategories || []
            }));
            setPromotions(convertedPromos);
            console.log('🎁 Table Order POS promotions loaded:', convertedPromos.length);
          }
        } catch (promoError) {
          console.log('Failed to load promotions:', promoError);
        }
      } catch (err: any) {
        console.error('Failed to load data:', err);
        setError(err.message || 'Failed to load menu');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [effectiveStoreId, effectiveTableId]);
  
  // Thank You 페이지에서 동영상으로 자동 전환 (5초 후)
  useEffect(() => {
    if (orderSubmitted && !showVideo) {
      thankYouTimerRef.current = setTimeout(() => {
        // 부드러운 전환 시작
        setIsTransitioning(true);
        setTimeout(() => {
          setShowVideo(true);
          // 전환 완료 후 트랜지션 상태 해제
          setTimeout(() => setIsTransitioning(false), 100);
        }, 800); // 페이드아웃 시간
      }, 5000); // 5초 후 전환
    }
    
    return () => {
      if (thankYouTimerRef.current) {
        clearTimeout(thankYouTimerRef.current);
      }
    };
  }, [orderSubmitted, showVideo]);
  
  // 동영상 화면에서 터치하면 메뉴로 복귀
  const handleVideoScreenTouch = () => {
    setIsTransitioning(true);
    setTimeout(() => {
      setShowVideo(false);
      setOrderSubmitted(false);
      setTimeout(() => setIsTransitioning(false), 100);
    }, 800);
  };

  // 현재 카테고리 아이템
  const currentItems = useMemo(() => {
    if (!selectedCategory) return [];
    const cat = categories.find(c => c.category_id === selectedCategory);
    return cat?.items || [];
  }, [categories, selectedCategory]);

  // 장바구니 총 수량
  const cartCount = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.quantity, 0);
  }, [cart]);

  // 장바구니 총액 (모디파이어 포함)
  const cartTotal = useMemo(() => {
    return cart.reduce((sum, item) => {
      const modifierTotal = item.modifiers.reduce((mSum, m) => mSum + m.price_adjustment, 0);
      return sum + ((item.price + modifierTotal) * item.quantity);
    }, 0);
  }, [cart]);

  // 아이템 클릭 - 모디파이어 모달 열기
  const handleItemClick = async (item: MenuItem, event: React.MouseEvent) => {
    lastClickEvent.current = event;
    setSelectedItem(item);
    setItemQuantity(1);
    setSelectedModifiers([]);
    setLoadingModifiers(true);
    setShowModifierModal(true);
    
    try {
      // 모디파이어 가져오기
      const res = await fetch(`${API_URL}/menu/items/${item.item_id}/options`);
      if (res.ok) {
        const data = await res.json();
        // API는 modifier_groups를 반환하고, 각 그룹에 modifiers 배열이 포함됨
        const groups = (data.modifier_groups || [])
          .filter((g: any) => !g.is_invalid && g.modifier_group_id)
          .map((g: any) => ({
            modifier_group_id: g.modifier_group_id,
            name: g.name || 'Options',
            selection_type: g.selection_type || 'MULTIPLE',
            min_selection: g.min_selection || 0,
            max_selection: g.max_selection || 10,
            modifiers: (g.modifiers || []).map((m: any) => ({
              modifier_id: m.modifier_id,
              name: m.name,
              price_adjustment: m.price_adjustment || 0
            }))
          }));
        setModifierGroups(groups);
      } else {
        setModifierGroups([]);
      }
    } catch (err) {
      console.error('Failed to load modifiers:', err);
      setModifierGroups([]);
    } finally {
      setLoadingModifiers(false);
    }
  };

  // 모디파이어 토글
  const toggleModifier = (group: ModifierGroup, modifier: Modifier) => {
    setSelectedModifiers(prev => {
      const existing = prev.find(m => m.modifier_id === modifier.modifier_id);
      
      if (group.selection_type === 'SINGLE') {
        // 싱글 선택: 같은 그룹의 다른 것 제거하고 새것 추가
        const filtered = prev.filter(m => m.group_id !== group.modifier_group_id);
        if (existing) {
          return filtered; // 이미 선택된 것 클릭하면 해제
        }
        return [...filtered, {
          group_id: group.modifier_group_id,
          group_name: group.name,
          modifier_id: modifier.modifier_id,
          name: modifier.name,
          price_adjustment: modifier.price_adjustment
        }];
      } else {
        // 멀티 선택
        if (existing) {
          return prev.filter(m => m.modifier_id !== modifier.modifier_id);
        }
        // max_selection 체크
        const groupCount = prev.filter(m => m.group_id === group.modifier_group_id).length;
        if (group.max_selection > 0 && groupCount >= group.max_selection) {
          return prev; // 최대 선택 초과
        }
        return [...prev, {
          group_id: group.modifier_group_id,
          group_name: group.name,
          modifier_id: modifier.modifier_id,
          name: modifier.name,
          price_adjustment: modifier.price_adjustment
        }];
      }
    });
  };

  // 모디파이어 선택이 유효한지 확인
  const isModifierSelectionValid = () => {
    for (const group of modifierGroups) {
      const selectedCount = selectedModifiers.filter(m => m.group_id === group.modifier_group_id).length;
      if (group.min_selection > 0 && selectedCount < group.min_selection) {
        return false;
      }
    }
    return true;
  };

  // 장바구니에 추가 (모디파이어 포함)
  const addToCartWithModifiers = () => {
    if (!selectedItem) return;
    
    // 애니메이션 트리거
    if (lastClickEvent.current && cartIconRef.current) {
      const button = document.querySelector(`[data-item-id="${selectedItem.item_id}"]`) as HTMLElement;
      if (button) {
        const buttonRect = button.getBoundingClientRect();
        const cartRect = cartIconRef.current.getBoundingClientRect();
        
        const flyingItem: FlyingItem = {
          id: `fly_${Date.now()}_${Math.random()}`,
          startX: buttonRect.left + buttonRect.width / 2,
          startY: buttonRect.top + buttonRect.height / 2,
          endX: cartRect.left + cartRect.width / 2,
          endY: cartRect.top + cartRect.height / 2,
          name: selectedItem.name,
          price: selectedItem.price,
          image_url: selectedItem.image_url
        };
        
        setFlyingItems(prev => [...prev, flyingItem]);
        setTimeout(() => {
          setFlyingItems(prev => prev.filter(f => f.id !== flyingItem.id));
        }, 700);
      }
    }
    
    // 장바구니에 추가
    setCart(prev => [...prev, { 
      ...selectedItem, 
      quantity: itemQuantity, 
      cartId: `${selectedItem.item_id}_${Date.now()}`,
      modifiers: selectedModifiers
    }]);
    
    // 모달 닫기
    setShowModifierModal(false);
    setSelectedItem(null);
    setModifierGroups([]);
    setSelectedModifiers([]);
  };

  // 모디파이어 추가 가격 계산
  const getModifierTotal = () => {
    return selectedModifiers.reduce((sum, m) => sum + m.price_adjustment, 0);
  };

  // 아이템 총 가격 (모디파이어 포함)
  const getItemTotal = () => {
    if (!selectedItem) return 0;
    return (selectedItem.price + getModifierTotal()) * itemQuantity;
  };

  // 수량 변경
  const updateQuantity = (cartId: string, delta: number) => {
    setCart(prev => {
      return prev.map(item => {
        if (item.cartId === cartId) {
          const newQty = item.quantity + delta;
          if (newQty <= 0) return null;
          return { ...item, quantity: newQty };
        }
        return item;
      }).filter(Boolean) as CartItem[];
    });
  };

  // 아이템 제거
  const removeFromCart = (cartId: string) => {
    setCart(prev => prev.filter(item => item.cartId !== cartId));
  };

  // 장바구니 비우기
  const clearCart = () => {
    setCart([]);
    setCustomerNote('');
  };

  // 주문 제출
  const submitOrder = async () => {
    if (cart.length === 0) return;

    setIsSubmitting(true);
    try {
      const orderData = {
        store_id: effectiveStoreId,
        table_id: effectiveTableId,
        table_label: tableInfo?.table_label || effectiveTableId,
        items: cart.map(item => ({
          item_id: item.item_id,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          modifiers: item.modifiers || []
        })),
        customer_note: customerNote
      };

      const res = await fetch(`${API_URL}/table-orders/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderData)
      });

      if (!res.ok) throw new Error('Failed to submit order');

      const result = await res.json();
      setSubmittedOrderId(result.order_id);
      setOrderSubmitted(true);
      setCart([]);
      setCustomerNote('');
    } catch (err: any) {
      alert('Failed to submit order: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 동영상/스크린세이버 화면
  if (orderSubmitted && showVideo) {
    return (
      <div 
        className={`h-screen w-screen bg-black flex items-center justify-center cursor-pointer overflow-hidden transition-opacity duration-700 ease-in-out ${isTransitioning ? 'opacity-0' : 'opacity-100'}`}
        onClick={handleVideoScreenTouch}
      >
        {/* 동영상 배경 - 오른쪽 20%가 메뉴 영역이므로 왼쪽 80% 영역의 중앙(40%)에 맞춤 */}
        {videoUrl ? (
          <video
            autoPlay
            loop
            muted
            playsInline
            className="absolute inset-0 w-full h-full object-cover"
            style={{ objectPosition: '0% center' }}
          >
            <source src={videoUrl} type="video/mp4" />
          </video>
        ) : (
          /* 기본 애니메이션 스크린세이버 - 왼쪽 80% 영역에 맞춤 */
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 overflow-hidden">
            {/* 움직이는 그라데이션 배경 */}
            <div className="absolute inset-0 opacity-30">
              <div className="absolute w-[800px] h-[800px] bg-gradient-to-r from-amber-500/40 to-orange-600/40 rounded-full blur-3xl animate-pulse" 
                   style={{ top: '10%', left: '-20%', animation: 'float1 15s ease-in-out infinite' }} />
              <div className="absolute w-[600px] h-[600px] bg-gradient-to-r from-teal-500/30 to-cyan-600/30 rounded-full blur-3xl animate-pulse" 
                   style={{ bottom: '10%', right: '10%', animation: 'float2 18s ease-in-out infinite' }} />
              <div className="absolute w-[500px] h-[500px] bg-gradient-to-r from-purple-500/20 to-pink-600/20 rounded-full blur-3xl" 
                   style={{ top: '50%', left: '40%', transform: 'translate(-50%, -50%)', animation: 'float3 20s ease-in-out infinite' }} />
            </div>
            
            {/* 레스토랑 정보 표시 - 왼쪽 80% 영역의 중앙에 배치 */}
            <div className="relative z-10 flex flex-col items-center justify-center h-full text-white" style={{ paddingRight: '20%' }}>
              <div className="w-28 h-28 bg-gradient-to-br from-amber-500 to-orange-600 rounded-3xl flex items-center justify-center mb-8 shadow-2xl animate-pulse">
                <Utensils className="w-14 h-14 text-white" />
              </div>
              <h1 className="text-5xl font-bold mb-4 text-center px-8" style={{ animation: 'fadeInUp 1s ease-out' }}>
                {tableInfo?.business_name || 'Welcome'}
              </h1>
              <p className="text-xl text-white/60 mb-12">Touch to Order</p>
              
              {/* 터치 안내 애니메이션 */}
              <div className="absolute bottom-16 flex flex-col items-center animate-bounce" style={{ right: 'calc(50% + 10%)' }}>
                <div className="w-12 h-12 border-2 border-white/40 rounded-full flex items-center justify-center">
                  <div className="w-3 h-3 bg-white/60 rounded-full" />
                </div>
                <p className="text-white/40 text-sm mt-3">Tap anywhere to continue</p>
              </div>
            </div>
          </div>
        )}
        
        {/* 스크린세이버 CSS 애니메이션 */}
        <style>{`
          @keyframes float1 {
            0%, 100% { transform: translate(0, 0) scale(1); }
            33% { transform: translate(100px, -80px) scale(1.1); }
            66% { transform: translate(-50px, 60px) scale(0.9); }
          }
          @keyframes float2 {
            0%, 100% { transform: translate(0, 0) scale(1); }
            33% { transform: translate(-80px, 60px) scale(1.15); }
            66% { transform: translate(60px, -40px) scale(0.85); }
          }
          @keyframes float3 {
            0%, 100% { transform: translate(-50%, -50%) scale(1); }
            50% { transform: translate(-50%, -50%) scale(1.3); }
          }
          @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </div>
    );
  }

  // 주문 완료 화면 (Thank You 페이지)
  if (orderSubmitted) {
    return (
      <div className={`h-screen bg-gradient-to-br from-emerald-900 via-teal-800 to-cyan-900 flex items-center justify-center p-8 transition-opacity duration-700 ease-in-out ${isTransitioning ? 'opacity-0' : 'opacity-100'}`}>
        <div className="bg-white/95 backdrop-blur rounded-3xl shadow-2xl p-12 max-w-2xl w-full text-center animate-[scaleIn_0.5s_ease-out]">
          {/* 체크마크 애니메이션 */}
          <div className="w-32 h-32 bg-gradient-to-br from-green-400 to-emerald-600 rounded-full flex items-center justify-center mx-auto mb-8 shadow-lg animate-[bounceIn_0.6s_ease-out]">
            <svg className="w-16 h-16 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                d="M5 13l4 4L19 7"
                className="animate-[drawCheck_0.5s_ease-out_0.3s_forwards]"
                style={{ strokeDasharray: 30, strokeDashoffset: 30 }}
              />
            </svg>
          </div>
          <h1 className="text-4xl font-bold text-gray-800 mb-4 animate-[fadeInUp_0.5s_ease-out_0.2s_both]">Order Submitted!</h1>
          <p className="text-xl text-gray-600 mb-8 animate-[fadeInUp_0.5s_ease-out_0.3s_both]">Your order has been sent to the kitchen.</p>
          <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-2xl p-8 mb-8 border border-emerald-200 animate-[fadeInUp_0.5s_ease-out_0.4s_both]">
            <p className="text-lg text-gray-500 mb-2">Order Number</p>
            <p className="text-5xl font-bold text-emerald-600">{submittedOrderId}</p>
          </div>
          <div className="flex items-center justify-center text-gray-500 mb-8 text-lg animate-[fadeInUp_0.5s_ease-out_0.5s_both]">
            <Clock className="w-6 h-6 mr-3" />
            <span>Estimated wait: 15-20 minutes</span>
          </div>
          <button
            onClick={() => {
              if (thankYouTimerRef.current) clearTimeout(thankYouTimerRef.current);
              setOrderSubmitted(false);
              setShowVideo(false);
            }}
            className="px-12 py-4 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-2xl font-bold text-xl hover:from-emerald-600 hover:to-teal-700 transition-all shadow-lg hover:shadow-xl transform hover:scale-105 animate-[fadeInUp_0.5s_ease-out_0.6s_both]"
          >
            Order More
          </button>
          
          {/* 자동 전환 진행 표시 */}
          <div className="mt-8 animate-[fadeInUp_0.5s_ease-out_0.7s_both]">
            <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-emerald-400 to-teal-500 rounded-full animate-[progressBar_5s_linear]" />
            </div>
            <p className="text-sm text-gray-400 mt-2">Returning to menu...</p>
          </div>
        </div>
        
        {/* Thank You 페이지 CSS 애니메이션 */}
        <style>{`
          @keyframes scaleIn {
            from { opacity: 0; transform: scale(0.9); }
            to { opacity: 1; transform: scale(1); }
          }
          @keyframes bounceIn {
            0% { opacity: 0; transform: scale(0.3); }
            50% { transform: scale(1.1); }
            70% { transform: scale(0.9); }
            100% { opacity: 1; transform: scale(1); }
          }
          @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes drawCheck {
            to { stroke-dashoffset: 0; }
          }
          @keyframes progressBar {
            from { width: 0%; }
            to { width: 100%; }
          }
        `}</style>
      </div>
    );
  }

  // 로딩 화면
  if (isLoading) {
    return (
      <div className="h-screen bg-gradient-to-br from-amber-900 via-orange-900 to-red-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-20 h-20 border-4 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto mb-6" />
          <p className="text-2xl text-white/80">Loading menu...</p>
        </div>
      </div>
    );
  }

  // 에러 화면
  if (error) {
    return (
      <div className="h-screen bg-gradient-to-br from-slate-900 via-red-900 to-rose-900 flex items-center justify-center p-8">
        <div className="text-center bg-white/95 backdrop-blur rounded-3xl p-12 max-w-lg">
          <div className="w-24 h-24 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <X className="w-12 h-12 text-red-500" />
          </div>
          <h1 className="text-3xl font-bold text-gray-800 mb-4">Something went wrong</h1>
          <p className="text-lg text-gray-600 mb-8">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-8 py-3 bg-amber-500 text-white rounded-xl text-lg hover:bg-amber-600 transition"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gradient-to-br from-slate-100 via-gray-100 to-zinc-200 flex flex-col overflow-hidden relative">
      {/* 날아가는 아이템 애니메이션 */}
      {flyingItems.map(flyItem => (
        <div
          key={flyItem.id}
          className="fixed z-[9999] pointer-events-none"
          style={{
            left: flyItem.startX,
            top: flyItem.startY,
            animation: 'flyToCart 0.5s ease-in-out forwards',
            '--end-x': `${flyItem.endX - flyItem.startX}px`,
            '--end-y': `${flyItem.endY - flyItem.startY}px`,
          } as React.CSSProperties}
        >
          <div className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white px-4 py-2 rounded-full shadow-2xl font-bold text-sm whitespace-nowrap">
            {flyItem.name}
          </div>
        </div>
      ))}
      
      {/* CSS 애니메이션 정의 */}
      <style>{`
        @keyframes flyToCart {
          0% {
            transform: translate(-50%, -50%) scale(1);
            opacity: 1;
          }
          50% {
            transform: translate(
              calc(var(--end-x) * 0.5 - 50%), 
              calc(var(--end-y) * 0.5 - 100px - 50%)
            ) scale(1.2);
            opacity: 1;
          }
          100% {
            transform: translate(
              calc(var(--end-x) - 50%), 
              calc(var(--end-y) - 50%)
            ) scale(0.3);
            opacity: 0;
          }
        }
      `}</style>

      {/* 모디파이어 모달 */}
      {showModifierModal && selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* 오버레이 */}
          <div 
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowModifierModal(false)}
          />
          
          {/* 모달 */}
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden">
            {/* 헤더 */}
            <div className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white p-6 flex items-start gap-4">
              <div className="w-20 h-20 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
                {selectedItem.image_url ? (
                  <img src={selectedItem.image_url} alt={selectedItem.name} className="w-full h-full object-cover rounded-xl" />
                ) : (
                  <Utensils className="w-10 h-10 text-white/80" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-2xl font-bold">{selectedItem.name}</h2>
                {selectedItem.description && (
                  <p className="text-blue-100 mt-1 text-sm line-clamp-2">{selectedItem.description}</p>
                )}
                <p className="text-xl font-bold mt-2">${selectedItem.price.toFixed(2)}</p>
              </div>
              <button
                onClick={() => setShowModifierModal(false)}
                className="p-2 hover:bg-white/20 rounded-lg transition"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* 모디파이어 선택 */}
            <div className="flex-1 overflow-y-auto p-6">
              {loadingModifiers ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : modifierGroups.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <p>No options available for this item</p>
                </div>
              ) : (
                <div className={`${modifierGroups.length >= 2 ? 'grid grid-cols-2 gap-4' : 'space-y-6'}`}>
                  {modifierGroups.map(group => {
                    const selectedCount = selectedModifiers.filter(m => m.group_id === group.modifier_group_id).length;
                    const isRequired = group.min_selection > 0;
                    const hasMultipleOptions = (group.modifiers?.length || 0) > 4;
                    
                    return (
                      <div key={group.modifier_group_id} className="border border-slate-200 rounded-xl overflow-hidden">
                        {/* 그룹 헤더 */}
                        <div className="bg-slate-50 px-4 py-3 flex items-center justify-between">
                          <div>
                            <h3 className="font-bold text-slate-800 text-sm">{group.name}</h3>
                            <p className="text-xs text-slate-500">
                              {group.selection_type === 'SINGLE' ? 'Choose one' : `Choose up to ${group.max_selection}`}
                              {isRequired && <span className="text-red-500 ml-1">• Required</span>}
                            </p>
                          </div>
                          {isRequired && (
                            <span className={`text-xs px-2 py-1 rounded-full ${
                              selectedCount >= group.min_selection 
                                ? 'bg-green-100 text-green-700' 
                                : 'bg-red-100 text-red-700'
                            }`}>
                              {selectedCount}/{group.min_selection}
                            </span>
                          )}
                        </div>
                        
                        {/* 모디파이어 옵션 - 옵션이 많으면 2열 */}
                        <div className={`${hasMultipleOptions ? 'grid grid-cols-2' : ''}`}>
                          {group.modifiers?.map((modifier, idx) => {
                            const isSelected = selectedModifiers.some(m => m.modifier_id === modifier.modifier_id);
                            return (
                              <button
                                key={modifier.modifier_id}
                                onClick={() => toggleModifier(group, modifier)}
                                className={`w-full px-3 py-2.5 flex items-center justify-between hover:bg-slate-50 transition border-b border-slate-100 ${
                                  hasMultipleOptions && idx % 2 === 0 ? 'border-r' : ''
                                } ${isSelected ? 'bg-blue-50' : ''}`}
                              >
                                <div className="flex items-center gap-2">
                                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                                    isSelected 
                                      ? 'border-blue-500 bg-blue-500' 
                                      : 'border-slate-300'
                                  }`}>
                                    {isSelected && (
                                      <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                      </svg>
                                    )}
                                  </div>
                                  <span className={`text-sm font-semibold ${isSelected ? 'text-blue-700' : 'text-slate-700'}`}>
                                    {modifier.name}
                                  </span>
                                </div>
                                {modifier.price_adjustment > 0 && (
                                  <span className="text-slate-500 text-xs">+${modifier.price_adjustment.toFixed(2)}</span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 푸터 - 수량 및 추가 버튼 */}
            <div className="border-t p-4 bg-slate-50">
              <div className="flex items-center justify-between mb-4">
                <span className="font-medium text-slate-700">Quantity</span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setItemQuantity(q => Math.max(1, q - 1))}
                    className="w-10 h-10 bg-slate-200 rounded-lg flex items-center justify-center hover:bg-slate-300 transition"
                  >
                    <Minus className="w-5 h-5" />
                  </button>
                  <span className="w-10 text-center text-xl font-bold">{itemQuantity}</span>
                  <button
                    onClick={() => setItemQuantity(q => q + 1)}
                    className="w-10 h-10 bg-blue-500 text-white rounded-lg flex items-center justify-center hover:bg-blue-600 transition"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
              </div>
              
              <button
                onClick={addToCartWithModifiers}
                disabled={!isModifierSelectionValid()}
                className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all ${
                  isModifierSelectionValid()
                    ? 'bg-gradient-to-r from-green-500 to-emerald-600 text-white hover:from-green-600 hover:to-emerald-700 shadow-lg'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
              >
                <ShoppingCart className="w-5 h-5" />
                Add to Cart - ${getItemTotal().toFixed(2)}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 헤더 - Warm Restaurant Theme */}
      <header className="bg-gradient-to-r from-amber-900 via-amber-800 to-amber-900 text-white px-6 py-3 flex items-center justify-between shadow-lg flex-shrink-0">
        {/* 왼쪽: 아이콘 + Table */}
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-orange-400 to-red-500 rounded-xl flex items-center justify-center shadow-md">
            <Utensils className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-xl font-bold tracking-wide">
            Table {tableInfo?.table_label || effectiveTableId}
          </h1>
        </div>
        
        {/* 가운데: Welcome + 레스토랑명 */}
        <div className="absolute left-1/2 transform -translate-x-1/2">
          <h2 className="text-xl font-bold tracking-wide text-white">
            {tableInfo?.business_name 
              ? `Welcome to ${tableInfo.business_name}` 
              : 'Welcome'}
          </h2>
        </div>
        
        {/* 오른쪽: Call Server */}
        <button
          onClick={() => setShowCallServerModal(true)}
          className="bg-orange-500 hover:bg-orange-600 rounded-xl px-5 py-2.5 flex items-center gap-2 transition-all shadow-md hover:shadow-lg"
        >
          <Bell className="w-5 h-5" />
          <span className="font-bold">Call Server</span>
        </button>
      </header>

      {/* 프로모션 배너 */}
      {promotions.length > 0 && (
        <PromoBanner messages={promotions.map(p => p.message!).filter(Boolean)} />
      )}

      {/* 메인 컨텐츠 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 왼쪽: 카테고리 사이드바 */}
        <aside className="w-48 bg-white shadow-xl flex flex-col overflow-hidden flex-shrink-0">
          <div className="p-3 bg-slate-50 border-b">
            <h2 className="text-sm font-bold text-slate-700">Categories</h2>
          </div>
          <nav className="flex-1 overflow-y-auto p-2 space-y-1">
            {categories.map(cat => (
              <button
                key={cat.category_id}
                onClick={() => setSelectedCategory(cat.category_id)}
                className={`w-full text-left px-3 py-3 rounded-lg font-medium transition-all duration-200 ${
                  selectedCategory === cat.category_id
                    ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg'
                    : 'bg-amber-50 text-amber-900 hover:bg-amber-100'
                }`}
              >
                <span className="text-sm font-bold">{cat.name}</span>
              </button>
            ))}
          </nav>
        </aside>

        {/* 중앙: 메뉴 아이템 그리드 */}
        <main className="flex-1 overflow-y-auto p-3">
          <div className="grid grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2">
            {currentItems.map(item => (
              <button
                key={item.item_id}
                data-item-id={item.item_id}
                onClick={(e) => handleItemClick(item, e)}
                className="bg-white rounded-xl shadow-md hover:shadow-xl transition-all duration-200 p-2 flex flex-col items-center text-center group hover:scale-[1.02] border border-transparent hover:border-amber-300"
              >
                {/* 이미지 또는 플레이스홀더 */}
                <div className="w-full aspect-[4/3] bg-gradient-to-br from-slate-100 to-slate-200 rounded-lg mb-1.5 flex items-center justify-center overflow-hidden">
                  {item.image_url ? (
                    <img
                      src={item.image_url}
                      alt={item.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Utensils className="w-10 h-10 text-slate-300" />
                  )}
                </div>
                
                {/* 이름 */}
                <h3 className="font-bold text-slate-800 text-sm leading-tight mb-1 line-clamp-2 min-h-[2rem]">
                  {item.name}
                </h3>
                
                {/* 가격 */}
                <p className="text-amber-600 font-bold text-base">${item.price.toFixed(2)}</p>
                
                {/* 추가 버튼 */}
                <div className="mt-1.5 w-full">
                  <div className="bg-gradient-to-r from-amber-500 to-orange-600 text-white py-1.5 px-3 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 group-hover:from-amber-600 group-hover:to-orange-700 transition-all">
                    <Plus className="w-3.5 h-3.5" />
                    Add
                  </div>
                </div>
              </button>
            ))}

            {currentItems.length === 0 && (
              <div className="col-span-full flex items-center justify-center py-20">
                <p className="text-xl text-slate-400">No items in this category</p>
              </div>
            )}
          </div>
        </main>

        {/* 오른쪽: 장바구니 패널 */}
        <aside className="w-72 bg-white shadow-xl flex flex-col overflow-hidden flex-shrink-0 border-l">
          {/* 장바구니 헤더 */}
          <div ref={cartIconRef} className="p-4 bg-gradient-to-r from-amber-600 to-orange-700 text-white flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ShoppingCart className="w-6 h-6" />
              <h2 className="text-lg font-bold">Your Order</h2>
              {cartCount > 0 && (
                <span className="bg-white text-amber-700 text-sm font-bold px-2 py-0.5 rounded-full">
                  {cartCount}
                </span>
              )}
            </div>
            {cart.length > 0 && (
              <button
                onClick={() => setShowClearConfirm(true)}
                className="p-2 hover:bg-white/20 rounded-lg transition"
                title="Clear cart"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* 장바구니 아이템 */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400">
                <ShoppingCart className="w-16 h-16 mb-4 opacity-30" />
                <p className="text-lg">Your cart is empty</p>
                <p className="text-sm mt-1">Tap items to add them</p>
              </div>
            ) : (
              cart.map(item => {
                const modifierTotal = item.modifiers.reduce((sum, m) => sum + m.price_adjustment, 0);
                const itemTotal = (item.price + modifierTotal) * item.quantity;
                return (
                  <div key={item.cartId} className="bg-slate-50 rounded-lg px-2 py-1 border border-slate-100">
                    {/* 아이템 이름과 삭제 버튼 */}
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-slate-800 text-sm leading-none flex-1 truncate">{item.name}</p>
                      <button
                        onClick={() => setDeleteConfirm({ show: true, cartId: item.cartId, itemName: item.name })}
                        className="w-6 h-6 flex items-center justify-center bg-red-100 text-red-500 hover:bg-red-200 hover:text-red-600 rounded transition"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    {/* 모디파이어 표시 */}
                    {item.modifiers.length > 0 && (
                      <div>
                        {item.modifiers.map((mod, idx) => (
                          <p key={idx} className="text-xs text-slate-500 leading-none">
                            + {mod.name} {mod.price_adjustment > 0 && `(+$${mod.price_adjustment.toFixed(2)})`}
                          </p>
                        ))}
                      </div>
                    )}
                    {/* 금액과 수량 - 같은 라인 */}
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-amber-600 font-bold text-sm">${itemTotal.toFixed(2)}</p>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => updateQuantity(item.cartId, -1)}
                          className="w-7 h-7 bg-slate-200 rounded flex items-center justify-center hover:bg-slate-300 transition"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <span className="w-5 text-center font-bold text-sm">{item.quantity}</span>
                        <button
                          onClick={() => updateQuantity(item.cartId, 1)}
                          className="w-7 h-7 bg-amber-500 text-white rounded flex items-center justify-center hover:bg-amber-600 transition"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>


          {/* 합계 및 주문 버튼 */}
          <div className="border-t p-3 bg-white space-y-1">
            <div className="flex justify-between text-xs text-slate-400">
              <span>Subtotal</span>
              <span>${cartTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs text-slate-400">
              <span>Tax (5%)</span>
              <span>${(cartTotal * 0.05).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-lg font-bold text-slate-800 pt-1 border-t mt-1">
              <span>Total</span>
              <span className="text-amber-600">${(cartTotal * 1.05).toFixed(2)}</span>
            </div>
            
            <button
              onClick={submitOrder}
              disabled={isSubmitting || cart.length === 0}
              className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all duration-200 ${
                cart.length > 0 && !isSubmitting
                  ? 'bg-gradient-to-r from-green-500 to-emerald-600 text-white hover:from-green-600 hover:to-emerald-700 shadow-lg hover:shadow-xl transform hover:scale-[1.02]'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }`}
            >
              {isSubmitting ? (
                <>
                  <div className="w-6 h-6 border-3 border-white border-t-transparent rounded-full animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Send className="w-6 h-6" />
                  Submit Order
                </>
              )}
            </button>
          </div>
        </aside>
      </div>

      {/* Call Server 모달 */}
      {showCallServerModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-[scaleIn_0.2s_ease-out]">
            {/* 헤더 */}
            <div className="bg-gradient-to-r from-amber-500 to-orange-600 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Bell className="w-6 h-6 text-white" />
                <h3 className="text-xl font-bold text-white">Call Server</h3>
              </div>
              <button
                onClick={() => {
                  setShowCallServerModal(false);
                  setCallServerSent(null);
                }}
                className="text-white/80 hover:text-white transition"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            {/* 내용 */}
            <div className="p-6">
              {callServerSent ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Sparkles className="w-8 h-8 text-green-500" />
                  </div>
                  <h4 className="text-xl font-bold text-slate-800 mb-2">Request Sent!</h4>
                  <p className="text-slate-600">{callServerSent}</p>
                  <button
                    onClick={() => {
                      setShowCallServerModal(false);
                      setCallServerSent(null);
                    }}
                    className="mt-6 px-8 py-3 bg-amber-500 text-white rounded-xl font-bold hover:bg-amber-600 transition"
                  >
                    Close
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { icon: Droplets, label: 'Water', callType: 'water', color: 'bg-cyan-500', message: 'Water refill request sent.' },
                    { icon: UtensilsCrossed, label: 'Utensils', callType: 'utensils', color: 'bg-purple-500', message: 'Utensils request sent.' },
                    { icon: Package, label: 'Togo Box', callType: 'togo_box', color: 'bg-teal-500', message: 'Togo box request sent.' },
                    { icon: Receipt, label: 'Bill', callType: 'bill', color: 'bg-blue-500', message: 'Bill request sent. Server will bring the check.' },
                    { icon: CreditCard, label: 'Pay at Table', callType: 'pay_at_table', color: 'bg-green-500', message: 'Payment request sent. Server will assist you.' },
                    { icon: Bell, label: 'Call Server', callType: 'call_server', color: 'bg-amber-500', message: 'Server has been called to your table.' },
                  ].map((item) => (
                    <button
                      key={item.label}
                      disabled={isCallingServer}
                      onClick={() => sendCallServerRequest(item.callType, item.message)}
                      className={`${item.color} hover:opacity-90 text-white rounded-xl p-4 flex flex-col items-center gap-2 transition-all shadow-md hover:shadow-lg disabled:opacity-50`}
                    >
                      <item.icon className="w-8 h-8" />
                      <span className="font-bold text-sm">{item.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 전체 삭제 확인 모달 */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-[scaleIn_0.2s_ease-out]">
            {/* 헤더 */}
            <div className="bg-red-50 px-6 py-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-500" />
              </div>
              <h3 className="text-lg font-bold text-slate-800">Clear Cart</h3>
            </div>
            
            {/* 내용 */}
            <div className="px-6 py-5">
              <p className="text-slate-600 text-center">
                Are you sure you want to remove
                <br />
                <span className="font-semibold text-slate-800">all {cart.length} items</span> from your cart?
              </p>
            </div>
            
            {/* 버튼 */}
            <div className="flex border-t">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 py-4 text-slate-600 font-semibold hover:bg-slate-50 transition border-r"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  clearCart();
                  setShowClearConfirm(false);
                }}
                className="flex-1 py-4 text-red-500 font-semibold hover:bg-red-50 transition"
              >
                Clear All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 삭제 확인 모달 */}
      {deleteConfirm.show && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-[scaleIn_0.2s_ease-out]">
            {/* 헤더 */}
            <div className="bg-red-50 px-6 py-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-500" />
              </div>
              <h3 className="text-lg font-bold text-slate-800">Delete Item</h3>
            </div>
            
            {/* 내용 */}
            <div className="px-6 py-5">
              <p className="text-slate-600 text-center">
                Are you sure you want to remove
                <br />
                <span className="font-semibold text-slate-800">"{deleteConfirm.itemName}"</span>?
              </p>
            </div>
            
            {/* 버튼 */}
            <div className="flex border-t">
              <button
                onClick={() => setDeleteConfirm({ show: false, cartId: '', itemName: '' })}
                className="flex-1 py-4 text-slate-600 font-semibold hover:bg-slate-50 transition border-r"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  removeFromCart(deleteConfirm.cartId);
                  setDeleteConfirm({ show: false, cartId: '', itemName: '' });
                }}
                className="flex-1 py-4 text-red-500 font-semibold hover:bg-red-50 transition"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TableOrderPage;
