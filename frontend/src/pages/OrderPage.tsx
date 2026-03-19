import React, { useState, useEffect, useRef, useMemo, Suspense, lazy, useCallback, useTransition } from 'react'
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
// import { X } from 'lucide-react';
import '../styles/scrollbar.css';
import { PointerSensor, useSensor, useSensors, closestCenter, pointerWithin } from '@dnd-kit/core';
// import { CSS } from '@dnd-kit/utilities';
import { LibraryTaxGroup, LibraryPrinterGroup } from '../types';
import { OrderItem, MenuItem, Category, LayoutSettings } from './order/orderTypes';
import { getSplitPriceDisplay, SplitQtyLabel, SplitPriceLabel, isItemLockedForSplit } from './order/splitDisplayHelpers';
import { useMenuData } from '../hooks/useMenuData';
import { useOrderManagement } from '../hooks/useOrderManagement';
import { useLayoutSettings } from '../hooks/useLayoutSettings';
import ManagerPinModal from '../components/ManagerPinModal';
import SoldOutModal from '../components/SoldOutModal';
import { API_URL } from '../config/constants';
import BottomActionBar from '../components/order/BottomActionBar';
import ModifierPanel from '../components/order/ModifierPanel';
import OrderCatalogPanel, { CatalogSnapshot } from './order/OrderCatalogPanel';
import PaymentSplitModals from './order/modules/PaymentSplitModals';
import ServerSelectionModal from '../components/ServerSelectionModal';
import { getSelectedButtonColor, getComplementaryNormalColor } from '../utils/colorUtils';
import { DndContext, DragEndEvent, DragOverEvent, useDraggable, useDroppable } from '@dnd-kit/core';
import { Keyboard as KeyboardIcon } from 'lucide-react';
import { CSS } from '@dnd-kit/utilities';
import { usePromotion } from '../hooks/usePromotion';
import { computePromotionAdjustment, buildPromotionReceiptLine } from '../utils/promotionCalculator';
import { calculateOrderPricing, summarizePricingByGuest, applySubtotalAdjustments, computeDiscountAmount } from '../utils/orderPricing';
import { getFirebasePromotions, FirebasePromotion, checkPromotionApplicable, calculatePromotionDiscount } from '../services/firebasePromotionsApi';
import { ProTab } from '../components/ProTab';
import { CacheDebugger } from '../components/CacheDebugger';
import clockInOutApi, { ClockedInEmployee } from '../services/clockInOutApi';
import { loadServerAssignment, saveServerAssignment, clearServerAssignment } from '../utils/serverAssignmentStorage';
import { getLocalDatetimeString, getLocalDateString } from '../utils/datetimeUtils';
import { PrintBillModal } from '../components/PrintBillModal';
import PaymentCompleteModal from '../components/PaymentCompleteModal';
import TipEntryModal from '../components/TipEntryModal';

const LAYOUT_SETTINGS_SNAPSHOT_KEY = 'orderLayout:layoutSettingsSnapshot';
const CATALOG_SNAPSHOT_KEY = 'orderLayout:lastCatalogSnapshot';

const readLayoutSettingsSnapshotSeed = (): { raw: string | null; data: Partial<LayoutSettings> | null } => {
  if (typeof window === 'undefined') {
    return { raw: null, data: null };
  }
  try {
    const raw = sessionStorage.getItem(LAYOUT_SETTINGS_SNAPSHOT_KEY);
    if (!raw) return { raw: null, data: null };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return { raw, data: parsed as Partial<LayoutSettings> };
    }
  } catch {
    // ignore malformed snapshot
  }
  return { raw: null, data: null };
};

const readCatalogSnapshot = (): CatalogSnapshot | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CATALOG_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as CatalogSnapshot;
    }
  } catch {
    // ignore
  }
  return null;
};

// 🔄 모달 컴포넌트 - 지연 로딩 (필요할 때만 로드)
const SearchModal = lazy(() => import('../components/SearchModal'));
const VirtualKeyboard = lazy(() => import('../components/order/VirtualKeyboard'));
const DualFieldKeyboardModal = lazy(() => import('../components/common/DualFieldKeyboardModal'));
const PromotionRulesModal = lazy(() => import('../components/PromotionRulesModal'));
const PromotionCreateModal = lazy(() => import('../components/PromotionCreateModal'));
const PromotionSettingsModal = lazy(() => import('../components/PromotionSettingsModal'));
const FreeItemRulesModal = lazy(() => import('../components/FreeItemRulesModal'));

// (inline VirtualKeyboard removed; using component version)

function KeyboardPortal({ children }: { children: React.ReactNode }) {
  if (typeof document === 'undefined') return null as any;
  return createPortal(children as any, document.body);
}

const OrderPage = () => {
  // 🚀 1단계: 빈 화면 즉시 표시 (0ms)
  const [mounted, setMounted] = useState(false);
  
  // 🚀 2단계: 기본 UI 로드 (50ms 후)
  const [uiReady, setUiReady] = useState(false);
  
  // 🚀 3단계: 전체 기능 로드 (100ms 후)
  const [isFullyMounted, setIsFullyMounted] = useState(false);
  
  useEffect(() => {
    // 즉시 마운트 상태 활성화
    setMounted(true);
    
    // 50ms 후 UI 준비
    const uiTimer = setTimeout(() => setUiReady(true), 50);
    
    // 100ms 후 전체 기능 활성화
    const fullTimer = setTimeout(() => setIsFullyMounted(true), 100);
    
    return () => {
      clearTimeout(uiTimer);
      clearTimeout(fullTimer);
    };
  }, []);
  
  const DEBUG = false; // true로 변경하면 디버그 로그 활성화
  
  const location = useLocation();
  const locationKey = location.key;
  const navigate = useNavigate();
  const locationState: any = location.state || {};
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const memoInputRef = useRef<HTMLInputElement | null>(null);
  const memoPriceInputRef = useRef<HTMLInputElement | null>(null);
  const customDiscountInputRef = useRef<HTMLInputElement | null>(null);

  const isSalesOrder = (location.pathname || '').startsWith('/sales/order');
  const shouldShowButtonPlaceholders = !isSalesOrder;
  
  // 반응형: 화면 너비 감지 (Back Office에서 작은 화면일 때 주문목록 숨김)
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1920);
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  const hideOrderListPanel = !isSalesOrder && windowWidth <= 1280;
  const { orderType, menuId, menuName, priceType: locationPriceType, soldOutModeFromSales } = locationState;
  const menuIdNumber = typeof menuId === 'number' ? menuId : Number(menuId) || undefined;
  const normalizedOrderType = typeof orderType === 'string' ? orderType : 'pos';
  const normalizedOrderTypeLower = normalizedOrderType.toLowerCase();
  const isTogo = (normalizedOrderTypeLower === 'togo');
  const normalizedPriceType: 'price' | 'price2' = locationPriceType === 'price2' ? 'price2' : 'price';

  // Resolve accurate table name for POS/table orders when not provided directly
  const [resolvedTableName, setResolvedTableName] = useState<string>('');
  const tableIdFromState = (location.state as any)?.tableId;
  const tableNameFromState = (location.state as any)?.tableName;
  const orderIdFromState = (location.state as any)?.orderId;
  const [showServerModal, setShowServerModal] = useState(false);
  const [serverList, setServerList] = useState<ClockedInEmployee[]>([]);
  const [serverModalLoading, setServerModalLoading] = useState(false);
  const [serverModalError, setServerModalError] = useState('');
  const [selectedServer, setSelectedServer] = useState<{ id: string; name: string } | null>(null);
  const serverPromptedRef = useRef(false);
  const serverAssignmentBootstrappedRef = useRef(false);
  const [serverBootstrapComplete, setServerBootstrapComplete] = useState(false);
  const initialCustomerName = typeof locationState.customerName === 'string' ? locationState.customerName : '';
  const initialCustomerPhone = typeof locationState.customerPhone === 'string' ? locationState.customerPhone : '';
  const sanitizeCustomerName = (value?: string | null) => {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return '';
    return raw.toLowerCase() === 'unknown' ? '' : raw;
  };
  const [orderCustomerInfo, setOrderCustomerInfo] = useState<{ name: string; phone: string }>({
    name: sanitizeCustomerName(initialCustomerName),
    phone: initialCustomerPhone,
  });
  const getPersistableCustomerName = () => {
    const safe = sanitizeCustomerName(orderCustomerInfo.name);
    return safe || null;
  };
  const initialPickup = (locationState && typeof locationState.pickup === 'object') ? locationState.pickup : null;
  const initialPickupMinutes = (initialPickup && typeof initialPickup.minutes === 'number') ? Number(initialPickup.minutes) : null;
  const initialReadyTimeLabel = typeof locationState.readyTimeLabel === 'string' ? locationState.readyTimeLabel : '';
  const [orderPickupInfo, setOrderPickupInfo] = useState<{ readyTimeLabel: string; pickupMinutes: number | null }>({
    readyTimeLabel: initialReadyTimeLabel,
    pickupMinutes: initialPickupMinutes,
  });
  const initialFulfillmentModeRaw = typeof locationState.togoFulfillment === 'string'
    ? locationState.togoFulfillment
    : (typeof locationState.fulfillmentMode === 'string' ? locationState.fulfillmentMode : null);
  const [orderFulfillmentMode, setOrderFulfillmentMode] = useState<string | null>(
    initialFulfillmentModeRaw ? String(initialFulfillmentModeRaw).toLowerCase() : null
  );
  const applyCustomerInfoFromOrder = useCallback((order: any) => {
    if (!order) return;
    if (order.customer_name != null || order.customerName != null || order.customer_phone != null || order.customerPhone != null) {
      setOrderCustomerInfo(prev => {
        const nextNameRaw = order.customer_name ?? order.customerName;
        const nextPhoneRaw = order.customer_phone ?? order.customerPhone;
        const nextName = nextNameRaw != null ? sanitizeCustomerName(String(nextNameRaw)) : prev.name;
        const nextPhone = nextPhoneRaw != null ? String(nextPhoneRaw) : prev.phone;
        if (nextName === prev.name && nextPhone === prev.phone) return prev;
        return {
          name: nextName,
          phone: nextPhone,
        };
      });
    }
    if (order.ready_time != null || order.readyTime != null || order.pickup_minutes != null || order.pickupMinutes != null) {
      setOrderPickupInfo(prev => {
        const nextReadyRaw = order.ready_time ?? order.readyTime ?? '';
        const nextPickupMinutesRaw = order.pickup_minutes ?? order.pickupMinutes;
        const nextLabel = nextReadyRaw != null && nextReadyRaw !== '' ? String(nextReadyRaw) : prev.readyTimeLabel;
        const nextMinutes = Number.isFinite(Number(nextPickupMinutesRaw)) ? Number(nextPickupMinutesRaw) : prev.pickupMinutes;
        if (nextLabel === prev.readyTimeLabel && nextMinutes === prev.pickupMinutes) return prev;
        return {
          readyTimeLabel: nextLabel,
          pickupMinutes: nextMinutes,
        };
      });
    }
    if (order.fulfillment_mode != null || order.fulfillmentMode != null || order.fulfillment != null) {
      const nextFulfillmentRaw = order.fulfillment_mode ?? order.fulfillmentMode ?? order.fulfillment;
      const nextFulfillment = nextFulfillmentRaw != null ? String(nextFulfillmentRaw).toLowerCase() : null;
      setOrderFulfillmentMode(prev => {
        if (nextFulfillment === prev) return prev;
        return nextFulfillment;
      });
    }
  }, []);
  
  const layoutSnapshotSeed = useMemo(() => readLayoutSettingsSnapshotSeed(), []);
  const { layoutSettings, setLayoutSettings, updateLayoutSetting, loadLayoutSettings, saveLayoutSettings, resetLayoutSettings, modifierColors, setModifierColors, modifierColorsLoaded, modifierLayoutByItem: hookModifierLayout, setModifierLayoutByItem: hookSetModifierLayout, modifierLayoutLoaded } = useLayoutSettings(layoutSnapshotSeed.data || undefined);
  const mergedGroups = useMemo(() => layoutSettings.mergedGroups || [], [layoutSettings.mergedGroups]);
  const savedCategoryOrder = useMemo(() => layoutSettings.categoryBarOrder || [], [layoutSettings.categoryBarOrder]);
  const selectServerPromptEnabled = layoutSettings.selectServerOnEntry ?? false;
  const modifierColorsAutoSaveRef = useRef(modifierColors);
  modifierColorsAutoSaveRef.current = modifierColors;
  
  // Layout Tab 권한 체크: Admin과 Distributor만 수정 가능 (Select Server 제외)
  // localStorage에서 'pos_user_role' 값을 확인 (admin, distributor, dealer, owner, staff)
  const posUserRole = useMemo(() => {
    try {
      return localStorage.getItem('pos_user_role') || 'admin'; // 기본값: admin (모든 권한)
    } catch {
      return 'admin';
    }
  }, []);
  const canEditLayoutTab = posUserRole === 'admin' || posUserRole === 'distributor';

  // Device type (approved device registration)
  const registeredDeviceType = useMemo(() => {
    try {
      return (localStorage.getItem('pos_device_type') || '').toLowerCase();
    } catch {
      return '';
    }
  }, []);
  const isHandheldDevice = registeredDeviceType === 'handheld';

  // Back Office: auto-save layout settings (rows/cols/colors/heights, etc.)
  const layoutAutoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastLayoutAutoSavedRef = useRef<string | null>(null);
  useEffect(() => {
    if (isSalesOrder) return; // only Back Office screen
    if (!canEditLayoutTab) return;
    let serialized: string;
    try {
      serialized = JSON.stringify(layoutSettings);
    } catch {
      return;
    }
    if (lastLayoutAutoSavedRef.current === serialized) return;
    if (layoutAutoSaveTimerRef.current) {
      clearTimeout(layoutAutoSaveTimerRef.current);
    }
    layoutAutoSaveTimerRef.current = setTimeout(async () => {
      try {
        const currentModColors = modifierColorsAutoSaveRef.current;
        const args = Object.keys(currentModColors).length > 0 ? { modifierColors: currentModColors } : undefined;
        await saveLayoutSettings(args);
        lastLayoutAutoSavedRef.current = serialized;
      } catch (e) {
        console.error('[OrderPage] Failed to auto-save layout settings:', e);
      }
    }, 600);
    return () => {
      if (layoutAutoSaveTimerRef.current) {
        clearTimeout(layoutAutoSaveTimerRef.current);
      }
    };
  }, [isSalesOrder, canEditLayoutTab, layoutSettings, saveLayoutSettings]);

  useEffect(() => {
    // 백그라운드에서 테이블 이름 로드 (화면 표시 후 300ms 지연)
    const timer = setTimeout(() => {
      try {
        if (normalizedOrderTypeLower === 'togo') { setResolvedTableName(''); return; }
        const directName = (tableNameFromState || '').toString();
        if (directName) { setResolvedTableName(directName); return; }
        if (!tableIdFromState) { setResolvedTableName(''); return; }
        (async () => {
          try {
            const res = await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(String(tableIdFromState))}`, { cache: 'no-store' });
            if (!res.ok) { setResolvedTableName(''); return; }
            const data = await res.json();
            const txt = (data?.text || data?.name || '').toString();
            setResolvedTableName(txt);
          } catch { setResolvedTableName(''); }
        })();
      } catch {}
    }, 300);
    
    return () => clearTimeout(timer);
  }, [normalizedOrderTypeLower, tableIdFromState, tableNameFromState]);

  useEffect(() => {
    if (serverAssignmentBootstrappedRef.current) return;
    serverAssignmentBootstrappedRef.current = true;

    if (!isSalesOrder) {
      setServerBootstrapComplete(true);
      return;
    }

    const st: any = location.state || {};
    if (st?.serverName && st?.serverId) {
      setSelectedServer({ id: String(st.serverId), name: String(st.serverName) });
      setServerBootstrapComplete(true);
      return;
    }

    const stored =
      (tableIdFromState ? loadServerAssignment('table', tableIdFromState) : null) ||
      (orderIdFromState ? loadServerAssignment('order', orderIdFromState) : null) ||
      loadServerAssignment('session', locationKey);

    if (stored) {
      setSelectedServer({ id: stored.serverId, name: stored.serverName });
    }

    setServerBootstrapComplete(true);
  }, [isSalesOrder, tableIdFromState, orderIdFromState, locationKey]);

  const persistServerSelection = useCallback(
    (server: { id: string; name: string }) => {
      if (!server || !server.id) return;
      if (tableIdFromState) {
        saveServerAssignment('table', tableIdFromState, {
          serverId: server.id,
          serverName: server.name,
        });
      }
      const resolvedOrderId = savedOrderIdRef.current || orderIdFromState;
      if (resolvedOrderId) {
        saveServerAssignment('order', resolvedOrderId, {
          serverId: server.id,
          serverName: server.name,
        });
      }
      if (!tableIdFromState && !resolvedOrderId) {
        saveServerAssignment('session', locationKey, {
          serverId: server.id,
          serverName: server.name,
        });
      } else {
        clearServerAssignment('session', locationKey);
      }
    },
    [tableIdFromState, orderIdFromState, locationKey]
  );

  useEffect(() => {
    if (selectedServer) {
      serverPromptedRef.current = true;
      persistServerSelection(selectedServer);
    }
  }, [selectedServer, persistServerSelection]);

  const clearServerAssignmentForContext = useCallback(() => {
    clearServerAssignment('session', locationKey);
    if (tableIdFromState) {
      clearServerAssignment('table', tableIdFromState);
    }
    const resolvedOrderId = savedOrderIdRef.current || orderIdFromState;
    if (resolvedOrderId) {
      clearServerAssignment('order', resolvedOrderId);
    }
  }, [locationKey, tableIdFromState, orderIdFromState]);

  const fetchClockedInServers = useCallback(async () => {
    setServerModalLoading(true);
    setServerModalError('');
    try {
      const employees = await clockInOutApi.getClockedInEmployees();
      const filtered = Array.isArray(employees)
        ? employees.filter((employee) => {
            const role = (employee.role || '').toString().toLowerCase();
            return role.includes('server') || role.includes('manager');
          })
        : [];
      setServerList(filtered);
    } catch (error) {
      console.warn('Failed to load clocked-in employees:', error);
      setServerModalError(error instanceof Error ? error.message : 'Failed to load server list.');
    } finally {
      setServerModalLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isSalesOrder) return;
    if (!serverBootstrapComplete) return;
    if (selectedServer) return;
    if (serverPromptedRef.current) return;
    const shouldPrompt =
      selectServerPromptEnabled &&
      (normalizedOrderTypeLower === 'pos' || normalizedOrderTypeLower === 'togo');
    if (shouldPrompt) {
      serverPromptedRef.current = true;
      setShowServerModal(true);
    }
  }, [isSalesOrder, serverBootstrapComplete, selectedServer, selectServerPromptEnabled, normalizedOrderTypeLower]);

  useEffect(() => {
    if (!showServerModal) return;
    fetchClockedInServers();
  }, [showServerModal, fetchClockedInServers]);

  const handleServerModalClose = useCallback(() => {
    setShowServerModal(false);
    if (isSalesOrder) {
      navigate('/sales');
    }
  }, [isSalesOrder, navigate]);

  const handleServerSelect = useCallback((employee: ClockedInEmployee) => {
    if (!employee) return;
    setSelectedServer({ id: employee.employee_id, name: employee.employee_name });
    setShowServerModal(false);
  }, []);

  // Screen size from Back Office (/backoffice/tables screen-size API) for sales/order
  const [boScreenSize, setBoScreenSize] = useState<{ width: number; height: number } | null>(null);
  const [renderSize, setRenderSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [orderPageScale, setOrderPageScale] = useState<number>(1);
  const [actualScreenSize, setActualScreenSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const rightAreaRef = useRef<HTMLDivElement | null>(null);
  const [boCanvasZoom, setBoCanvasZoom] = useState<number>(1);
  const floorFromState = (location.state as any)?.floor;
  
  useEffect(() => {
    if (!isSalesOrder) return;
    
    // 백그라운드에서 화면 크기 로드 (화면 표시 후 300ms 지연)
    const timer = setTimeout(() => {
      const floor = floorFromState || '1F';
      const ts = Date.now();
      (async () => {
        try {
          const res = await fetch(`${API_URL}/table-map/screen-size?floor=${encodeURIComponent(String(floor))}&_=${ts}`, { cache: 'no-store' });
          if (!res.ok) throw new Error(await res.text());
          const data = await res.json();
          const w = Number(data.width) || 1024;
          const h = Number(data.height) || 768;
          setBoScreenSize({ width: w, height: h });
        } catch (e) {
          try { console.warn('Failed to load BO screen size, fallback to 1024x768', e); } catch {}
          setBoScreenSize({ width: 1024, height: 768 });
        }
      })();
    }, 300);
    
    return () => clearTimeout(timer);
  }, [isSalesOrder, floorFromState]);

  // 실제 화면 크기 감지
  useEffect(() => {
    const updateScreenSize = () => {
      setActualScreenSize({
        width: window.innerWidth,
        height: window.innerHeight
      });
    };

    updateScreenSize();
    window.addEventListener('resize', updateScreenSize);
    return () => window.removeEventListener('resize', updateScreenSize);
  }, []);

  // 백오피스 해상도와 실제 화면 크기를 비교하여 스케일 계산 (OrderPage용)
  useEffect(() => {
    if (!isSalesOrder || !boScreenSize) {
      setOrderPageScale(1);
      return;
    }

    const actualWidth = actualScreenSize.width;
    const actualHeight = actualScreenSize.height;
    const boWidth = boScreenSize.width;
    const boHeight = boScreenSize.height;
    
    const scaleX = actualWidth / boWidth;
    const scaleY = actualHeight / boHeight;
    const calculatedScale = Math.max(0.5, Math.min(2.0, Math.min(scaleX, scaleY)));
    
    setOrderPageScale(calculatedScale);
    console.log(`[OrderPage] Screen scaling: BO=${boWidth}x${boHeight}, Actual=${actualWidth}x${actualHeight}, Scale=${calculatedScale.toFixed(2)}`);
  }, [boScreenSize, actualScreenSize, isSalesOrder]);

  // Back Office: auto-zoom canvas to fit the available right-area space
  useEffect(() => {
    if (isSalesOrder) { setBoCanvasZoom(1); return; }
    const el = rightAreaRef.current;
    if (!el) return;
    const compute = () => {
      const rect = el.getBoundingClientRect();
      const availW = rect.width - 32;
      const availH = rect.height - 32;
      const parts = layoutSettings.screenResolution.split('x').map(Number);
      const canvasW = parts[0] || 1024;
      const canvasH = parts[1] || 768;
      if (canvasW <= availW && canvasH <= availH) { setBoCanvasZoom(1); return; }
      const z = Math.max(0.3, Math.min(1, Math.min(availW / canvasW, availH / canvasH)));
      setBoCanvasZoom(z);
    };
    compute();
    window.addEventListener('resize', compute);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(compute) : null;
    if (ro) ro.observe(el);
    return () => { window.removeEventListener('resize', compute); if (ro) ro.disconnect(); };
  }, [isSalesOrder, layoutSettings.screenResolution]);

  // Measure actual rendered size of the canvas (to verify no scaling)
  useEffect(() => {
    const measure = () => {
      const el = canvasRef?.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRenderSize({ width: Math.round(r.width), height: Math.round(r.height) });
    };
    measure();
    window.addEventListener('resize', measure);
    const id = window.setInterval(measure, 500);
    return () => { window.removeEventListener('resize', measure); window.clearInterval(id); };
  }, [boScreenSize, isSalesOrder]);

  // Safe guard in case VirtualKeyboard import fails for any reason
  const VirtualKeyboardComponent = (VirtualKeyboard as unknown as React.ComponentType<any>);

  const {
    orderItems,
    setOrderItems,
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
  } = useOrderManagement();

  // Payment modal state
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [adhocSplitCount, setAdhocSplitCount] = useState<number>(0); // Even Split count
  const originalSplitDenomRef = useRef<number>(0); // original N before partial payment cancel
  const [showKitchenMemoModal, setShowKitchenMemoModal] = useState(false);
  const [kitchenMemo, setKitchenMemo] = useState<string>('');
  const [savedKitchenMemo, setSavedKitchenMemo] = useState<string>('');
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [showSoldOutModal, setShowSoldOutModal] = useState(false);
  const [soldOutItems, setSoldOutItems] = useState<Set<string>>(new Set());
  const [soldOutCategories, setSoldOutCategories] = useState<Set<string>>(new Set());
  const [soldOutTimes, setSoldOutTimes] = useState<Map<string, { type: string; endTime: number; selector: string }>>(new Map());
  const [soldOutMode, setSoldOutMode] = useState(false);
  const [selectedSoldOutType, setSelectedSoldOutType] = useState<string>('');
  const [currentUser, setCurrentUser] = useState<string>('Staff'); // TODO: Replace with actual signed-in user info

  // Auto-open Sold Out modal when navigated from SalesPage
  const soldOutFromSalesHandled = useRef(false);
  useEffect(() => {
    if (soldOutModeFromSales && !soldOutFromSalesHandled.current) {
      soldOutFromSalesHandled.current = true;
      setShowSoldOutModal(true);
    }
  }, [soldOutModeFromSales]);
  
  // Gift Card States
  const [showGiftCardModal, setShowGiftCardModal] = useState(false);
  const [giftCardMode, setGiftCardMode] = useState<'sell' | 'balance'>('sell');
  const [giftCardNumber, setGiftCardNumber] = useState(['', '', '', '']);
  const [giftCardAmount, setGiftCardAmount] = useState('');
  const [giftCardPaymentMethod, setGiftCardPaymentMethod] = useState<'Cash' | 'Visa' | 'MasterCard' | 'Other'>('Cash');
  const [giftCardCustomerName, setGiftCardCustomerName] = useState('');
  const [giftCardCustomerPhone, setGiftCardCustomerPhone] = useState('');
  const [giftCardBalance, setGiftCardBalance] = useState<number | null>(null);
  const [giftCardError, setGiftCardError] = useState('');
  const [selectedDiscountType, setSelectedDiscountType] = useState<string>('');
  const [discountPercentage, setDiscountPercentage] = useState<string>('');
  const [customDiscountPercentage, setCustomDiscountPercentage] = useState<string>('');
  const [showCustomDiscountModal, setShowCustomDiscountModal] = useState(false);
  const [discountInputMode, setDiscountInputMode] = useState<'percent' | 'amount'>('percent');
  const [discountAmountValue, setDiscountAmountValue] = useState<string>('');
  const [promotionTabExpanded, setPromotionTabExpanded] = useState(false);
  const [proTabExpanded, setProTabExpanded] = useState(false);
  // Soft keyboard (in-app) for Open Price/Search/Item Memo fields
  const [softKbTarget, setSoftKbTarget] = useState<
    | 'name'
    | 'note'
    | 'search'
    | 'memo'
    | 'memoPrice'
    | 'openPriceAmount'
    | 'customDiscount'
    | 'kitchenMemo'
    | 'customTypeF1'
    | 'customTypeF2'
    | 'editPrice'
    | 'voidNote'
    | null
  >(null);
  // Void UI state
  const [showVoidModal, setShowVoidModal] = useState(false);
  const [voidSelections, setVoidSelections] = useState<Record<string, { checked: boolean; qty: number }>>({});
  const [voidReason, setVoidReason] = useState<string>('');
  const [voidReasonPreset, setVoidReasonPreset] = useState<string>('');
  const [voidNote, setVoidNote] = useState<string>('');
  const [voidPolicyThreshold, setVoidPolicyThreshold] = useState<number>(0);
  const [voidPin, setVoidPin] = useState<string>('');
  const [voidPinError, setVoidPinError] = useState<string>('');
  const voidPinInputRef = useRef<HTMLInputElement | null>(null);
  const voidModalRef = useRef<HTMLDivElement | null>(null);
  const voidNoteInputRef = useRef<HTMLInputElement | null>(null);
  const voidSelectAllRef = useRef<HTMLInputElement | null>(null);

const handleVoidPinDigit = useCallback((digit: string) => {
  setVoidPinError('');
  setVoidPin((prev) => `${prev || ''}${digit}`.slice(0, 4));
  try { voidPinInputRef.current?.focus(); } catch {}
}, []);

const handleVoidPinBackspace = useCallback(() => {
  setVoidPin((prev) => (prev ? prev.slice(0, -1) : ''));
  setVoidPinError('');
  try { voidPinInputRef.current?.focus(); } catch {}
}, []);

const handleVoidPinClear = useCallback(() => {
  setVoidPin('');
  setVoidPinError('');
  try { voidPinInputRef.current?.focus(); } catch {}
}, []);

  // Tax & modifier metadata
  const [menuTaxes, setMenuTaxes] = useState<any[]>([]);
  const [itemTaxGroups, setItemTaxGroups] = useState<{ [itemId: string]: number[] }>({});
  const [categoryTaxGroups, setCategoryTaxGroups] = useState<{ [categoryId: number]: number[] }>({});
  const [itemIdToCategoryId, setItemIdToCategoryId] = useState<{ [itemId: string]: number }>({});
  const [itemModifierGroups, setItemModifierGroups] = useState<{ [itemId: string]: number[] }>({});
  const [categoryModifierGroups, setCategoryModifierGroups] = useState<{ [categoryId: number]: number[] }>({});
  const [modifierGroupDetailById, setModifierGroupDetailById] = useState<{ [groupId: number]: any }>({});

  const taxGroupIdToTaxes: { [groupId: number]: Array<{ name: string; rate: number }> } = useMemo(() => {
    if (!Array.isArray(menuTaxes)) return {};
    return menuTaxes.reduce((acc: Record<number, Array<{ name: string; rate: number }>>, group: any) => {
      const gid = Number(group.id || group.group_id || group.tax_group_id);
      if (!Number.isFinite(gid)) return acc;

      const rawTaxes = Array.isArray(group.taxes)
        ? group.taxes
        : Array.isArray(group.taxItems)
        ? group.taxItems
        : [];

      const normalized = rawTaxes
        .map((tax: any) => ({
          name: tax.name || group.name || `Tax ${gid}`,
          rate: Number(
            tax.rate ??
              tax.value ??
              tax.percentage ??
              group.rate ??
              group.value ??
              0
          ),
        }))
        .filter((t: { name: string; rate: number }) => Number.isFinite(t.rate));

      if (normalized.length > 0) {
        acc[gid] = normalized;
      }

      return acc;
    }, {});
  }, [menuTaxes]);

  const allTaxNames = useMemo(() => {
    const names = new Set<string>();
    Object.values(taxGroupIdToTaxes).forEach(taxes => taxes.forEach(t => names.add(t.name)));
    return Array.from(names);
  }, [taxGroupIdToTaxes]);

  useEffect(() => {
    if (showVoidModal) {
      try { setTimeout(() => { voidSelectAllRef.current?.focus(); }, 0); } catch {}
    }
  }, [showVoidModal]);
  const [voidToast, setVoidToast] = useState<string>('');

  // --- Sold Out persistence (server sync) ---
  const loadSoldOutFromServer = useMemo(() => {
    return async (menuIdForLoad?: string | number) => {
      try {
        const mid = String(menuIdForLoad ?? (menuId || ''));
        if (!mid) return;
        const res = await fetch(`${API_URL}/sold-out/${encodeURIComponent(mid)}`);
        if (!res.ok) return;
        const data = await res.json();
        const records: Array<{ scope: string; key_id: string; soldout_type: string; end_time: number; selector?: string }>
          = Array.isArray(data?.records) ? data.records : [];
        const itemSet = new Set<string>();
        const catSet = new Set<string>();
        const times = new Map<string, { type: string; endTime: number; selector: string }>();
        records.forEach(r => {
          if (String(r.scope) === 'item') {
            const id = String(r.key_id);
            itemSet.add(id);
            times.set(id, { type: String(r.soldout_type || ''), endTime: Number(r.end_time || 0), selector: String(r.selector || '') });
          } else if (String(r.scope) === 'category') {
            catSet.add(String(r.key_id));
          }
        });
        setSoldOutItems(itemSet);
        setSoldOutCategories(catSet);
        setSoldOutTimes(times);
      } catch {}
    };
  }, [API_URL, menuId]);

  useEffect(() => {
    // 즉시 품절 정보 로드 (Sold Out 표시를 위해 지연 없이)
    loadSoldOutFromServer(menuId);
    
    // 60초마다 갱신
    const interval = setInterval(() => loadSoldOutFromServer(menuId), 60000);
    
    return () => {
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuId]);

  // Sold Out auto-recovery timer (clears expired items)
  useEffect(() => {
    const checkSoldOutTimes = () => {
      const now = Date.now();
      const newSoldOutItems = new Set(soldOutItems);
      const newSoldOutTimes = new Map(soldOutTimes);
      let hasChanges = false;
      
      soldOutTimes.forEach((timeInfo, itemId) => {
        if (timeInfo.endTime > 0 && now >= timeInfo.endTime) {
          newSoldOutItems.delete(itemId);
          newSoldOutTimes.delete(itemId);
          hasChanges = true;
        }
      });
      
      if (hasChanges) {
        setSoldOutItems(newSoldOutItems);
        setSoldOutTimes(newSoldOutTimes);
      }
    };
    
    const interval = setInterval(checkSoldOutTimes, 60000); // check every 1 minute
    return () => clearInterval(interval);
  }, [soldOutItems, soldOutTimes]);

  const handleOpenKitchenMemo = () => {
    setKitchenMemo('');
    setShowKitchenMemoModal(true);
  };

  const handleOpenSoldOut = () => {
    setShowSoldOutModal(true);
  };

  // === Reprint Kitchen Ticket ===
  const handleReprint = async () => {
    const items = (orderItems || []).filter((it: any) => it.type === 'item');
    if (items.length === 0) {
      console.warn('[Reprint] No items to reprint.');
      return;
    }

    const printItems: any[] = items.map((it: any) => {
      const printerGroupIds = Array.isArray(it.printerGroupIds) ? it.printerGroupIds : 
                              Array.isArray(it.printer_groups) ? it.printer_groups :
                              (it.printerGroupId || it.printer_group_id) ? [it.printerGroupId || it.printer_group_id] : [];
      return {
        id: it.id,
        orderLineId: it.orderLineId || null,
        name: it.short_name || it.name || 'Unknown',
        qty: it.quantity,
        lineQuantityAfter: it.quantity,
        guestNumber: it.guestNumber || 1,
        modifiers: (it as any).modifiers || [],
        memo: (it as any).memo || null,
        discount: (it as any).discount || null,
        togoLabel: !!(it as any).togoLabel,
        printerGroupIds: printerGroupIds,
      };
    });

    const currentOrderType = (orderType || 'dine-in').toUpperCase();
    const orderTypeDisplay = currentOrderType === 'TOGO' ? 'TOGO' : 
                             currentOrderType === 'ONLINE' ? 'ONLINE' : 
                             currentOrderType === 'DELIVERY' ? 'DELIVERY' : 'DINE-IN';

    const printTableName = resolvedTableName || tableNameFromState || '';
    const printServerName = selectedServer?.name || '';
    const printOrderNumber = savedOrderNumberRef.current ? `#${savedOrderNumberRef.current}` : (savedOrderIdRef.current || `ORD-${Date.now()}`);

    try {
      const response = await fetch(`${API_URL}/printers/print-order`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ 
          items: printItems,
          orderInfo: {
            orderNumber: printOrderNumber,
            table: printTableName,
            server: printServerName,
            orderType: orderTypeDisplay,
            channel: orderTypeDisplay,
            pickupTime: orderPickupInfo.readyTimeLabel || '',
            pickupMinutes: orderPickupInfo.pickupMinutes,
            kitchenNote: savedKitchenMemo || '',
          },
          isAdditionalOrder: false,
          isPaid: false,
          isReprint: true
        }) 
      });
      const result = await response.json();
      if (result.success) {
        console.log(`🖨️ Kitchen Reprint complete: ${result.message}`);
      } else {
        console.error('❌ Kitchen Reprint failed:', result.error);
        console.error('[Reprint] Failed:', result.error || 'Unknown error');
      }
    } catch (err) {
      console.error('❌ Kitchen Reprint error:', err);
      console.error('[Reprint] Failed. Check printer connection.');
    }
  };

  // handleSoldOutOption, handleSoldOutConfirm, handleExtendSoldOut, handleAddTimeToSoldOut, handleClearSoldOutItem
  // are now handled by SoldOutModal component

  // Gift Card Functions
  const resetGiftCardForm = () => {
    setGiftCardNumber(['', '', '', '']);
    setGiftCardAmount('');
    setGiftCardPaymentMethod('Cash');
    setGiftCardCustomerName('');
    setGiftCardCustomerPhone('');
    setGiftCardBalance(null);
    setGiftCardError('');
  };

  const handleOpenGiftCard = () => {
    resetGiftCardForm();
    setGiftCardMode('sell');
    setShowGiftCardModal(true);
  };

  const handleGiftCardNumberChange = (index: number, value: string) => {
    const cleaned = value.replace(/\D/g, '').slice(0, 4);
    const newNumbers = [...giftCardNumber];
    newNumbers[index] = cleaned;
    setGiftCardNumber(newNumbers);
    
    // Auto-focus next input if 4 digits entered
    if (cleaned.length === 4 && index < 3) {
      const nextInput = document.getElementById(`gift-card-input-${index + 1}`);
      nextInput?.focus();
    }
  };

  const getFullGiftCardNumber = () => giftCardNumber.join('');

  const handleSellGiftCard = async () => {
    const cardNum = getFullGiftCardNumber();
    if (cardNum.length !== 16) {
      setGiftCardError('Please enter a valid 16-digit card number');
      return;
    }
    const amount = parseFloat(giftCardAmount);
    if (isNaN(amount) || amount <= 0) {
      setGiftCardError('Please enter a valid amount');
      return;
    }
    
    setGiftCardError('');
    
    try {
      const response = await fetch(`${API_URL}/gift-cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card_number: cardNum,
          amount: amount,
          payment_method: giftCardPaymentMethod,
          customer_name: giftCardCustomerName || null,
          customer_phone: giftCardCustomerPhone || null,
          sold_by: currentUser,
          menu_id: menuId,
          created_at: getLocalDatetimeString()
        })
      });
      
      if (response.ok) {
        alert(`Gift Card sold successfully!\nCard: ${cardNum.replace(/(\d{4})/g, '$1 ').trim()}\nAmount: $${amount.toFixed(2)}`);
        resetGiftCardForm();
        setShowGiftCardModal(false);
      } else {
        const err = await response.json();
        setGiftCardError(err.message || 'Failed to sell gift card');
      }
    } catch (error) {
      setGiftCardError('Failed to connect to server');
    }
  };

  const handleCheckGiftCardBalance = async () => {
    const cardNum = getFullGiftCardNumber();
    if (cardNum.length !== 16) {
      setGiftCardError('Please enter a valid 16-digit card number');
      return;
    }
    
    setGiftCardError('');
    setGiftCardBalance(null);
    
    try {
      const response = await fetch(`${API_URL}/gift-cards/${encodeURIComponent(cardNum)}/balance`);
      if (response.ok) {
        const data = await response.json();
        setGiftCardBalance(data.balance);
      } else {
        setGiftCardError('Gift card not found');
      }
    } catch (error) {
      setGiftCardError('Failed to connect to server');
    }
  };

  const handleMenuItemClickForSoldOut = (item: MenuItem) => {
    if (soldOutMode) {
      // In Sold Out mode: mark clicked item as Sold Out using selected duration
      const now = Date.now();
      let endTime: number;
      
      switch (selectedSoldOutType) {
        case '30min':
          endTime = now + (30 * 60 * 1000); // 30 minutes
          break;
        case '1hour':
          endTime = now + (60 * 60 * 1000); // 1 hour
          break;
        case 'today':
          // until today midnight
          const today = new Date();
          today.setHours(23, 59, 59, 999);
          endTime = today.getTime();
          break;
        case 'indefinite':
          endTime = 0; // 0 = indefinite
          break;
        default:
          return;
      }
      
      const newSoldOutItems = new Set(soldOutItems);
      const newSoldOutTimes = new Map(soldOutTimes);
      
      newSoldOutItems.add(item.id);
      newSoldOutTimes.set(item.id, { type: selectedSoldOutType, endTime, selector: currentUser });
      
      setSoldOutItems(newSoldOutItems);
      setSoldOutTimes(newSoldOutTimes);
      
      console.log('Menu item sold out:', item.name, 'Type:', selectedSoldOutType);
      // Sync to server
      (async () => {
        try {
          const mid = String(menuId || '');
          if (!mid) return;
          await fetch(`${API_URL}/sold-out/${encodeURIComponent(mid)}/item/${encodeURIComponent(String(item.id))}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: selectedSoldOutType, endTime, selector: currentUser })
          });
        } catch {}
      })();
    }
  };

  const handleSaveKitchenMemo = async () => {
    try {
      const tableIdForMap = (location.state && (location.state as any).tableId) || null;
      const payload: any = {
        message: String(kitchenMemo || '').slice(0, 500),
        orderNumber: undefined,
        context: {
          tableId: tableIdForMap || null,
          guest: activeGuestNumber || null,
        }
      };
      await fetch(`${API_URL}/printers/print-memo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      // Kitchen Note를 저장하여 주문목록에 표시
      setSavedKitchenMemo(kitchenMemo);
    } catch (e) {
      console.warn('Failed to send kitchen memo:', e);
    }
    setShowKitchenMemoModal(false);
  };
  const [showPromotionRulesModal, setShowPromotionRulesModal] = useState(false);
  const [showPromotionSettingsModal, setShowPromotionSettingsModal] = useState(false);
  const [openDiscountRuleModals, setOpenDiscountRuleModals] = useState<Array<{ modalId: string; mode: 'new'|'edit'; ruleId?: string }>>([]);

  const [showPromotionCreateModal, setShowPromotionCreateModal] = useState(false);
  const [showFreeItemModal, setShowFreeItemModal] = useState(false);
  const [freeItemPromotions, setFreeItemPromotions] = useState<import('../types/promotion').FreeItemPromotion[]>([]);
  const [freePromosLoaded, setFreePromosLoaded] = useState(false);
  const [promotionRules, setPromotionRules] = useState<import('../types/promotion').PromotionRule[]>([]);
  const [promosLoaded, setPromosLoaded] = useState(false);
  // const [promotionCode, setPromotionCode] = useState<string>('');
  const { enabled: promotionEnabled, setEnabled: setPromotionEnabled, type: promotionType, setType: setPromotionType, value: promotionValue, setValue: setPromotionValue, eligibleItemIds: promotionEligibleItemIds, setEligibleItemIds: setPromotionEligibleItemIds } = usePromotion();
  const [showSplitBillModal, setShowSplitBillModal] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState<Array<{ id: string | number; name: string; short_name?: string; category?: string; price?: number; normName: string; normShort: string; normCat: string }>>([]);
  const [searchReady, setSearchReady] = useState<boolean>(false);
  const [prefillDueNonce, setPrefillDueNonce] = useState(0);
  const orderSubtotal = useMemo(() => orderItems.reduce((sum, item:any) => {
    if (item.type==='separator') return sum;
    const base = Number((item.totalPrice != null ? item.totalPrice : item.price) || 0);
    const memoAdd = Number((item.memo?.price) || 0);
    return sum + ((base + memoAdd) * (item.quantity || 1));
  }, 0), [orderItems]);

  const orderDiscount = useMemo(() => {
    return orderItems.reduce((sum, item: any) => {
      if (item.type === 'separator' || !item.discount) return sum;
      const base = Number((item.totalPrice != null ? item.totalPrice : item.price) || 0);
      const memoAdd = Number((item.memo?.price) || 0);
      const itemTotal = (base + memoAdd) * (item.quantity || 1);
      const discountAmount = (itemTotal * item.discount.value) / 100;
      return sum + discountAmount;
    }, 0);
  }, [orderItems]);

  const orderSubtotalAfterDiscount = useMemo(() => {
    return orderSubtotal - orderDiscount;
  }, [orderSubtotal, orderDiscount]);

  // (Removed: compute inline where displayed to avoid TDZ with guestStatusMap)

  // 할인 정보 (첫 번째 할인된 아이템의 정보)
  const discountInfo = useMemo(() => {
    const discountedItem = orderItems.find(item => item.type !== 'separator' && (item as any).discount);
    if (!discountedItem || !(discountedItem as any).discount) return null;
    
    const discount = (discountedItem as any).discount;
    return {
      type: discount.type,
      percentage: discount.value,
      amount: orderDiscount
    };
  }, [orderItems, orderDiscount]);
  const savedOrderIdRef = React.useRef<number | null>(null);
  const savedOrderNumberRef = React.useRef<string | null>(null);
  const gratuityAmountRef = React.useRef<number>(0);
  // Track original saved quantities: orderLineId -> original quantity
  const originalSavedQuantitiesRef = React.useRef<{ [orderLineId: string]: number }>({});
  const [guestPaymentMode, setGuestPaymentMode] = useState<'ALL' | number>('ALL');
  const [paymentsByGuest, setPaymentsByGuest] = useState<Record<string, number>>({});
  const [sessionPayments, setSessionPayments] = useState<Array<{ paymentId: number; method: string; amount: number; tip: number; guestNumber?: number }>>([]);
  const splitOriginalSnapshotRef = useRef<OrderItem[] | null>(null);
  const splitGuestsInitDoneRef = useRef<boolean>(false);
  // Track whether PaymentModal was opened via Split -> Pay in Full flow
  const payInFullFromSplitRef = useRef<boolean>(false);
  const priorPaymentIdsRef = useRef<Set<number>>(new Set());
  // Track whether PaymentModal was opened from Split screen (any path)
  const openedFromSplitRef = useRef<boolean>(false);
  // Lock ALL mode when Pay in Full is chosen (from Split or inside PaymentModal)
  const allModeStickyRef = useRef<boolean>(false);
  // Track whether receipt has been printed for this payment session (prevent duplicate prints)
  const receiptPrintedRef = useRef<boolean>(false);
  // Prevent accidental duplicate guest-receipt prints (double-click / re-render edge cases)
  const lastGuestReceiptPrintRef = useRef<{ key: string; ts: number } | null>(null);
  // Payment Complete Modal state
  const [showPaymentCompleteModal, setShowPaymentCompleteModal] = useState(false);
  const [paymentCompleteData, setPaymentCompleteData] = useState<{
    change: number;
    total: number;
    tip: number;
    payments: Array<{ method: string; amount: number }>;
    hasCashPayment: boolean;
    isPartialPayment?: boolean;
    currentGuestNumber?: number;
    discount?: {
      percent: number;
      amount: number;
      originalSubtotal: number;
      discountedSubtotal: number;
      taxLines: Array<{ name: string; amount: number }>;
      taxesTotal: number;
    };
  } | null>(null);
  const [showTipEntryModal, setShowTipEntryModal] = useState(false);
  const [pendingReceiptCountForTip, setPendingReceiptCountForTip] = useState<number>(0);
  // Persisted PAID locks from DB (order_guest_status) to ensure UI remains locked across navigation
  const [persistedPaidGuests, _setPersistedPaidGuests] = useState<number[]>([]);
  const persistedPaidGuestsRef = useRef<number[]>([]);
  const setPersistedPaidGuests: typeof _setPersistedPaidGuests = (val) => {
    _setPersistedPaidGuests(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      persistedPaidGuestsRef.current = next;
      return next;
    });
  };

  // TOGO channel settings (must be declared before use in calculations)
  const [togoSettings, setTogoSettings] = useState<{
    discountEnabled: boolean;
    discountMode: 'percent' | 'amount';
    discountValue: number;
    bagFeeEnabled: boolean;
    bagFeeValue: number;
    bagFeeTaxable?: boolean;
    discountScope?: 'all' | 'items';
    discountItemIds?: string[];
  }>(() => {
    try {
      const raw = localStorage.getItem('togo_settings_v1');
      if (raw) return JSON.parse(raw);
    } catch {}
    return {
      discountEnabled: false,
      discountMode: 'percent',
      discountValue: 0,
      bagFeeEnabled: false,
      bagFeeValue: 0,
      bagFeeTaxable: false,
      discountScope: 'all',
      discountItemIds: [],
    };
  });
  useEffect(() => {
    try {
      localStorage.setItem('togo_settings_v1', JSON.stringify(togoSettings));
    } catch {}
  }, [togoSettings]);

  // POS promotions for Togo orders
  const [togoFirebasePromotions, setTogoFirebasePromotions] = useState<FirebasePromotion[]>([]);
  const [togoAppliedPromotion, setTogoAppliedPromotion] = useState<FirebasePromotion | null>(null);
  
  // POS promotions for Dine-in orders
  const [dineInPromotions, setDineInPromotions] = useState<FirebasePromotion[]>([]);

  // Restore split guests only for tables with existing orders (run once per table)
  const loadExistingFromState = (location.state as any)?.loadExisting;
  
  React.useEffect(() => {
    try {
      const tableId = tableIdFromState || null;
      if (!tableId) return;
      if (splitGuestsInitDoneRef.current) return;
      const hasSeparators = (orderItems || []).some(it => it.type === 'separator');
      if (hasSeparators) { splitGuestsInitDoneRef.current = true; return; }
      const hasExistingOrder = Boolean(loadExistingFromState) || Boolean(localStorage.getItem(`lastOrderIdByTable_${tableId}`)) || ((orderItems || []).some(it => it.type !== 'separator'));
      if (!hasExistingOrder) return;
      const raw = localStorage.getItem(`splitGuests_${tableId}`);
      if (!raw) { splitGuestsInitDoneRef.current = true; return; }
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0) {
        initializeSplitGuests(arr.map((n:any)=>Number(n)).filter((n:any)=>Number.isFinite(n) && n>0));
      }
      splitGuestsInitDoneRef.current = true;
    } catch {}
  }, [tableIdFromState, loadExistingFromState, orderItems, initializeSplitGuests]);

  // Ensure soft keyboard opens automatically when Search modal opens
  useEffect(() => {
    try {
      if (showSearchModal) {
        setSoftKbTarget('search' as any);
      }
    } catch {}
  }, [showSearchModal]);

  // Persist split guests for this table whenever separators change
  React.useEffect(() => {
    try {
      const tableId = tableIdFromState || null;
      if (!tableId) return;
      const sepGuests = Array.from(new Set((orderItems || []).filter(it => it.type === 'separator' && typeof it.guestNumber === 'number').map(it => it.guestNumber as number))).sort((a,b)=>a-b);
      if (sepGuests.length > 1) {
        localStorage.setItem(`splitGuests_${tableId}`, JSON.stringify(sepGuests));
      } else if (sepGuests.length <= 1) {
        // Keep single-guest clean by removing key
        localStorage.removeItem(`splitGuests_${tableId}`);
      }
    } catch {}
  }, [tableIdFromState, orderItems]);

  // Compute per-guest subtotals and taxes using existing tax logic
  // Note: computeGuestTotals is declared below; to avoid temporal access during render,
  // we compute paid state using only paymentsByGuest and simple totals computed inline here.
  const guestIds: number[] = useMemo<number[]>(() => {
    const nums: number[] = (orderItems||[]).filter(it=>it.type!=='separator').map(it => (it.guestNumber || 1) as number);
    const maxG: number = Math.max(1, ...nums, guestCount||1);
    const ids: number[] = Array.from({ length: maxG }, (_, i) => i+1);
    // 우선순위: DB/로컬에 영속된 PAID 우선, 없으면 결제합계 기반 추정
    const inlineTotals = (g: number) => {
      const items = (orderItems || []).filter(it => it.type !== 'separator' && (it.guestNumber || 1) === g);
      const subtotal = items.reduce((s, it: any) => s + (((it.totalPrice||0) + ((it.memo?.price)||0)) * (it.quantity||1)), 0);
      return subtotal;
    };
    const isPaidByPersistOrHeuristic = (g: number): boolean => {
      if (Array.isArray(persistedPaidGuests) && persistedPaidGuests.includes(g)) return true;
      const approxTotal = inlineTotals(g);
      const paid = Number((paymentsByGuest[String(g)] || 0).toFixed(2));
      const EPS = 0.05;
      const hasItems = approxTotal > EPS;
      const hasPaid = paid > EPS;
      if (!hasItems && !hasPaid) return false;
      return (approxTotal - paid) <= EPS;
    };
    return Array.from(ids).sort((a, b) => {
      const ka = isPaidByPersistOrHeuristic(a) ? 1 : 0;
      const kb = isPaidByPersistOrHeuristic(b) ? 1 : 0;
      if (ka !== kb) return ka - kb; // 미결제(0) 먼저, 결제(1) 나중
      return a - b;
    });
  }, [orderItems, guestCount, paymentsByGuest, persistedPaidGuests]);

  // ─────────────────────────────────────────────────────────────────────────────
  // ✅ Single source of truth for all money calculations
  // Item unit price (Open/Edit applied) + modifiers + memo − discounts (item + order) + taxes
  // Used everywhere (screen, payment, history, print) via shared results.
  // ─────────────────────────────────────────────────────────────────────────────
  const pricingAll = useMemo(() => {
    return calculateOrderPricing(orderItems as any, {
      itemTaxGroups,
      categoryTaxGroups,
      itemIdToCategoryId,
      taxGroupIdToTaxes,
    } as any);
  }, [orderItems, itemTaxGroups, categoryTaxGroups, itemIdToCategoryId, taxGroupIdToTaxes]);

  const pricingLineByLineId = useMemo(() => {
    const m = new Map<string, any>();
    (pricingAll.lines || []).forEach((l: any) => {
      if (l && l.orderLineId) m.set(String(l.orderLineId), l);
    });
    return m;
  }, [pricingAll]);

  const getPricingLineForItem = useCallback((orderItem: any) => {
    if (!orderItem || orderItem.type === 'separator') return null;
    const lid = String(orderItem.orderLineId || '');
    if (lid && pricingLineByLineId.has(lid)) return pricingLineByLineId.get(lid);
    // Fallback (should be rare): compute as single-line (no order-level discount allocation).
    try {
      const one = calculateOrderPricing([orderItem] as any, {
        itemTaxGroups,
        categoryTaxGroups,
        itemIdToCategoryId,
        taxGroupIdToTaxes,
      } as any);
      return (one.lines && one.lines[0]) ? one.lines[0] : null;
    } catch {
      return null;
    }
  }, [pricingLineByLineId, itemTaxGroups, categoryTaxGroups, itemIdToCategoryId, taxGroupIdToTaxes]);

  const guestPricingMap = useMemo(() => summarizePricingByGuest(pricingAll as any), [pricingAll]);

  // Backward-compatible helpers (now powered by pricingAll)
  const computeItemLineBase = useCallback((orderItem: any): number => {
    const l = getPricingLineForItem(orderItem);
    return l ? Number(l.lineGross || 0) : 0;
  }, [getPricingLineForItem]);

  const computeItemDiscountAmount = useCallback((orderItem: any): number => {
    const l = getPricingLineForItem(orderItem);
    return l ? Number(l.itemDiscount || 0) : 0;
  }, [getPricingLineForItem]);

  const computeOrderItemNetTotal = useCallback((orderItem: any): number => {
    const l = getPricingLineForItem(orderItem);
    return l ? Number(l.lineTaxable || 0) : 0;
  }, [getPricingLineForItem]);

  const computeGuestTotals = useCallback((mode: 'ALL' | number) => {
    if (mode === 'ALL') {
      const subtotal = Number((pricingAll.totals?.subtotalAfterAllDiscounts || 0).toFixed(2));
      const taxLines = (pricingAll.totals?.taxLines || []).map((t: any) => ({ name: t.name, amount: Number((t.amount || 0).toFixed(2)) }));
      const grand = Number((pricingAll.totals?.total || 0).toFixed(2));
      return { subtotal, taxLines, grand };
    }
    const g = Number(mode || 1);
    const res = guestPricingMap[g] || { subtotal: 0, taxLines: [], total: 0 };
    return { subtotal: Number((res.subtotal || 0).toFixed(2)), taxLines: res.taxLines || [], grand: Number((res.total || 0).toFixed(2)) };
  }, [pricingAll, guestPricingMap]);

  const guestStatusMap: Record<number, 'PAID' | 'PARTIAL' | 'UNPAID'> = useMemo(() => {
    const EPS = 0.05;
    const map: Record<number, 'PAID' | 'PARTIAL' | 'UNPAID'> = {};
    guestIds.forEach((g: number) => {
      const { grand } = computeGuestTotals(g);
      const paid = Number((paymentsByGuest[String(g)] || 0).toFixed(2));
      const rawDue = Number((grand - paid).toFixed(2));
      const due = rawDue <= EPS ? 0 : Math.max(0, rawDue);
      if (grand <= EPS && paid <= EPS) {
        map[g] = 'UNPAID';
        return;
      }
      map[g] = due === 0 ? 'PAID' : (paid > 0 ? 'PARTIAL' : 'UNPAID');
    });
    try {
      const tableIdForMap = (location.state && (location.state as any).tableId) || null;
      const orderId = savedOrderIdRef.current || (location.state && (location.state as any).orderId) || null;
      
      if (orderId) {
        const orderKey = `paidGuests_order_${orderId}`;
        try {
          const raw = localStorage.getItem(orderKey);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.orderId && String(parsed.orderId) === String(orderId)) {
              const list: number[] = Array.isArray(parsed?.paidGuests) ? parsed.paidGuests : [];
              list.forEach((guest: number) => { 
                if (guestIds.includes(guest)) {
                  const paidAmount = Number((paymentsByGuest[String(guest)] || 0).toFixed(2));
                  if (paidAmount > 0.01) {
                    map[guest] = 'PAID';
                  }
                }
              });
            }
          }
        } catch {}
      }
    } catch {}
    try {
      if (Array.isArray(persistedPaidGuests) && persistedPaidGuests.length > 0) {
        persistedPaidGuests.forEach((guest) => { 
          if (guestIds.includes(guest)) {
            map[guest] = 'PAID';
          }
        });
      }
    } catch {}
    return map;
  }, [guestIds, paymentsByGuest, orderItems, promotionEnabled, promotionType, promotionValue, promotionEligibleItemIds, promotionRules, persistedPaidGuests, computeGuestTotals, location.state, adhocSplitCount]);

  const effectiveSplitCount: number = useMemo(() => {
    if (adhocSplitCount > 1) {
      console.log(`🔍 [SPLIT DEBUG] effectiveSplitCount = ${adhocSplitCount} (from adhocSplitCount)`);
      return adhocSplitCount;
    }
    try {
      const orderId = savedOrderIdRef.current || (location.state && (location.state as any).orderId) || null;
      if (!orderId) { console.log(`🔍 [SPLIT DEBUG] effectiveSplitCount = 0 (no orderId, ref=${savedOrderIdRef.current})`); return 0; }
      const raw = localStorage.getItem(`paidGuests_order_${orderId}`);
      if (!raw) { console.log(`🔍 [SPLIT DEBUG] effectiveSplitCount = 0 (no localStorage for order ${orderId})`); return 0; }
      const parsed = JSON.parse(raw);
      if (parsed && parsed.splitCount > 1) {
        console.log(`🔍 [SPLIT DEBUG] effectiveSplitCount = ${parsed.splitCount} (from localStorage, paidGuests=${JSON.stringify(parsed.paidGuests)}, persistedPaidGuests=${JSON.stringify(persistedPaidGuests)})`);
        return parsed.splitCount;
      }
      console.log(`🔍 [SPLIT DEBUG] effectiveSplitCount = 0 (localStorage splitCount=${parsed?.splitCount})`);
    } catch {}
    return 0;
  }, [adhocSplitCount, persistedPaidGuests, location.state]);

  const isGuestLocked = (g: number | null | undefined): boolean => {
    if (!g || !Number.isFinite(g as any)) return false;
    try {
      const num = Number(g);
      if (guestStatusMap && guestStatusMap[num] === 'PAID') return true;
      return Array.isArray(persistedPaidGuests) && persistedPaidGuests.includes(num);
    } catch {
      return false;
    }
  };

  // Automatically enter per-guest payment mode after splitting
  // BUT never override ALL when Pay in Full flow is active or ALL sticky is set
  React.useEffect(() => {
    // Disable auto-switch entirely when payment modal is open to prevent race conditions
    if (showPaymentModal) return;
    if (guestCount > 1) {
      let next = activeGuestNumber;
      if (isGuestLocked(next)) {
        const firstUnpaid = (Array.isArray(guestIds) ? guestIds : []).find(g => !isGuestLocked(g));
        if (typeof firstUnpaid === 'number') next = firstUnpaid;
      }
      setActiveGuestNumber(next);
      if (guestPaymentMode === 'ALL') {
        // If Pay in Full flow is active or sticky ALL is set, keep ALL scope locked
        if (payInFullFromSplitRef.current || allModeStickyRef.current) return;
        setGuestPaymentMode(next);
      }
    }
  }, [guestCount, activeGuestNumber, guestPaymentMode, guestIds, persistedPaidGuests, showPaymentModal]);

  // Ensure order is saved and return orderId
  const ensureOrderSaved = async (): Promise<number> => {
    if (savedOrderIdRef.current) return savedOrderIdRef.current as number;
    const items = (orderItems || []).filter((it:any) => it.type === 'item');
    const now = new Date();
    const orderNumber = `ORD-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${now.getTime()}`;
    // Calculate totals before saving (shared adjustment rules)
    const orderTotals = computeGuestTotals('ALL');
    const baseSubtotal = Number((orderTotals.subtotal || 0).toFixed(2));
    const baseTaxLines = (orderTotals.taxLines || []).map((t: any) => ({ name: t.name, amount: Number((t.amount || 0).toFixed(2)) }));
    const isTogo = (orderType || '').toLowerCase() === 'togo';
    const adjustments: any[] = [];
    if (isTogo) {
      if (togoSettings.discountEnabled && Number(togoSettings.discountValue || 0) > 0) {
        const dv = Number(togoSettings.discountValue || 0);
        const discountAmt = computeDiscountAmount(baseSubtotal, (togoSettings.discountMode === 'amount' ? 'amount' : 'percent') as any, dv);
        if (discountAmt > 0) adjustments.push({ kind: 'DISCOUNT', label: 'TOGO Discount', amount: discountAmt });
      }
      if (togoSettings.bagFeeEnabled && Number(togoSettings.bagFeeValue || 0) > 0) {
        const feeAmt = Number(Number(togoSettings.bagFeeValue || 0).toFixed(2));
        if (feeAmt > 0) adjustments.push({ kind: 'FEE', label: 'Bag Fee', amount: feeAmt });
      }
    }
    const applied = applySubtotalAdjustments({ subtotal: baseSubtotal, taxLines: baseTaxLines }, adjustments);
    const calcSubtotal = Number((applied.subtotal || 0).toFixed(2));
    const calcTax = Number((applied.taxesTotal || 0).toFixed(2));
    const calcTotal = Number((applied.total || 0).toFixed(2));
    const saveRes = await fetch(`${API_URL}/orders`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ orderNumber, orderType: orderType||'POS', total: calcTotal, subtotal: calcSubtotal, tax: calcTax, items: items.map((it:any)=>({ id: it.id, name: it.name, quantity: it.quantity, price: it.totalPrice, guestNumber: it.guestNumber || 1, modifiers: it.modifiers || [], memo: it.memo || null, discount: (it as any).discount || null, splitDenominator: it.splitDenominator || null, splitNumerator: it.splitNumerator || null, orderLineId: (it as any).orderLineId || null, taxRate: Number(it.taxRate || it.tax_rate || 0), tax: Number(it.tax || 0), togoLabel: it.togoLabel || false, taxGroupId: it.taxGroupId || null, printerGroupId: it.printerGroupId || null })), customerName: getPersistableCustomerName(), customerPhone: orderCustomerInfo.phone || null, fulfillmentMode: orderFulfillmentMode || null, readyTime: orderPickupInfo.readyTimeLabel || null, pickupMinutes: orderPickupInfo.pickupMinutes ?? null, orderMode: 'FSR' }) });
    if (!saveRes.ok) throw new Error('Failed to save order');
    const saved = await saveRes.json();
    savedOrderIdRef.current = saved.orderId;
    savedOrderNumberRef.current = saved.order_number || String(saved.dailyNumber || '').padStart(3, '0') || null;
    
    // Live Order 실시간 업데이트를 위한 이벤트 발생
    const tableIdForOrder = (location.state && (location.state as any).tableId) || null;
    window.dispatchEvent(new CustomEvent('orderCreated', { detail: { orderId: saved.orderId, tableId: tableIdForOrder } }));
    
    return saved.orderId;
  };

  // Open Void modal
  const handleOpenVoid = async () => {
    try {
      const sel: Record<string, { checked: boolean; qty: number }> = {};
      (orderItems || []).forEach((it:any) => {
        if (it.type === 'separator') return;
        const key = String(it.orderLineId || it.id);
        sel[key] = { checked: false, qty: Math.max(1, Number(it.quantity || 1)) };
      });
      setVoidSelections(sel);
      // fetch policy
      try {
        const r = await fetch(`${API_URL}/settings/void-policy`);
        if (r.ok) {
          const js = await r.json();
          setVoidPolicyThreshold(Number(js?.approval_threshold || 0));
        }
      } catch {}
      setShowVoidModal(true);
    } catch {}
  };

  const computeVoidTotals = () => {
    let subtotal = 0;
    (orderItems || []).forEach((it:any) => {
      if (it.type === 'separator') return;
      const key = String(it.orderLineId || it.id);
      const sel = voidSelections[key];
      if (!sel || !sel.checked) return;
      const unit = Number((it.totalPrice != null ? it.totalPrice : it.price) || 0) + Number((it.memo?.price)||0);
      const qty = Math.min(Number(it.quantity || 1), Number(sel.qty || 0));
      subtotal += unit * qty;
    });
    const tax = 0; // 세금 상세 계산은 기존 로직 활용 영역. 1차 버전은 0으로 기록
    return { subtotal, tax, total: subtotal + tax };
  };

  const computeVoidSelectionCount = () => {
    let count = 0;
    (orderItems || []).forEach((it:any) => {
      if (it.type === 'separator') return;
      const key = String(it.orderLineId || it.id);
      const sel = voidSelections[key];
      if (sel && sel.checked && Number(sel.qty||0) > 0) count += 1;
    });
    return count;
  };

  const isPinValid = () => {
    return !!voidPin && /^\d{4}$/.test(voidPin);
  };
  const handleConfirmVoid = async () => {
    try {
      const orderId = await ensureOrderSaved();
      const lines: Array<any> = [];
      (orderItems || []).forEach((it:any) => {
        if (it.type === 'separator') return;
        const key = String(it.orderLineId || it.id);
        const sel = voidSelections[key];
        if (!sel || !sel.checked) return;
        const qty = Math.min(Number(it.quantity || 1), Number(sel.qty || 0));
        if (qty <= 0) return;
        const amount = ((Number((it.totalPrice != null ? it.totalPrice : it.price) || 0) + Number((it.memo?.price)||0)) * qty);
        lines.push({ order_line_id: it.orderLineId || null, menu_id: it.id || null, name: it.name, qty, amount, tax: 0, printer_group_id: (it as any).printerGroupId || null });
      });
      if (!lines.length) { setShowVoidModal(false); return; }
      // 승인 한도 체크
      if (!voidPin || !/^\d{4}$/.test(voidPin)) {
        setVoidPinError('Enter 4-digit PIN');
        try { voidPinInputRef.current?.focus(); } catch {}
        return;
      }
      // 전체 취소인지 여부를 판별: 모든 실제 아이템이 전량 선택되었는지 확인
      const allRealItems = (orderItems || []).filter((it:any) => it.type !== 'separator');
      const isEntire = allRealItems.length > 0 && allRealItems.every((it:any) => {
        const key = String(it.orderLineId || it.id);
        const sel = voidSelections[key];
        const fullQty = Number(it.quantity || 1);
        return sel && sel.checked && Number(sel.qty || 0) >= fullQty;
      });
      const body:any = { lines, reason: voidReason, note: voidNote, source: (isEntire ? 'entire' : 'partial'), manager_pin: voidPin || null, created_by: currentUser || null };
      const r = await fetch(`${API_URL}/orders/${orderId}/void`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      if (!r.ok) {
        const msg = await r.text();
        alert(msg || 'Void failed');
        return;
      }
      const js = await r.json();
      
      // Void 프린터 작업 디스패치: 백엔드가 생성한 VOID_TICKET 프린터 작업을 전송
      try {
        await fetch(`${API_URL}/printers/jobs/dispatch`, { method: 'POST' });
        console.log('[VOID] Printer jobs dispatched successfully');
      } catch (printerErr) {
        console.warn('[VOID] Failed to dispatch printer jobs:', printerErr);
        // 프린터 실패는 void 자체를 막지 않음
      }
      
      // 화면 아이템에 취소선/VOID 라벨 반영: 선택된 수량만큼 VOID 라인을 생성하고, 남은 수량은 유지
      setOrderItems((prev:any[])=>{
        const next: any[] = [];
        (prev||[]).forEach((it:any)=>{
          if (it.type === 'separator') { next.push(it); return; }
          if (it.type === 'void') { next.push(it); return; } // 이미 VOID된 아이템은 그대로 유지
          const key = String((it as any).orderLineId || it.id);
          const sel = (voidSelections as any)[key];
          const curQty = Math.max(1, Number(it.quantity||1));
          if (!sel || !sel.checked || Number(sel.qty||0) <= 0) {
            next.push(it);
            return;
          }
          const dec = Math.max(0, Math.min(curQty, Number(sel.qty||0)));
          const remain = curQty - dec;
          if (remain > 0) {
            next.push({ ...it, quantity: remain });
          }
          // VOID 표시용 라인 추가
          next.push({
            id: `void-${(it as any).orderLineId || it.id}-${Date.now()}`,
            name: it.name,
            quantity: dec,
            price: 0,
            totalPrice: 0,
            type: 'void',
            guestNumber: it.guestNumber || 1,
          });
        });
        return next;
      });
      setShowVoidModal(false);
      // 현재 테이블과 주문 연결 유지(Occupied 유지)
      try {
        const tableIdForMap = (location.state && (location.state as any).tableId) || null;
        if (tableIdForMap && savedOrderIdRef.current) {
          try { localStorage.setItem(`lastOrderIdByTable_${tableIdForMap}`, String(savedOrderIdRef.current)); } catch {}
          try { await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(tableIdForMap)}/current-order`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ orderId: savedOrderIdRef.current }) }); } catch {}
          // 테이블 상태는 그대로 유지(Occupied)
        }
      } catch {}
      // Persist VOID display lines so that re-entering the table shows cancelled items with strikethrough until payment
      try {
        const tableIdForMap = (location.state && (location.state as any).tableId) || null;
        const orderId = savedOrderIdRef.current as any;
        if (tableIdForMap && orderId) {
          const key = `voidDisplay_${tableIdForMap}`;
          let data: any = null;
          try { data = JSON.parse(String(localStorage.getItem(key) || 'null')); } catch {}
          if (!data || String(data.orderId) !== String(orderId)) {
            data = { orderId: String(orderId), voids: [] };
          }
          const appended: any[] = [];
          (orderItems || []).forEach((it:any) => {
            if (it.type === 'separator') return;
            const keySel = String((it as any).orderLineId || it.id);
            const sel = (voidSelections as any)[keySel];
            if (!sel || !sel.checked) return;
            const curQty = Math.max(1, Number(it.quantity||1));
            const dec = Math.max(0, Math.min(curQty, Number(sel.qty||0)));
            if (dec > 0) {
              appended.push({ name: it.name, qty: dec, guestNumber: it.guestNumber || 1, itemId: it.id, orderLineId: (it as any).orderLineId || null });
            }
          });
          const nextVoids = Array.isArray(data.voids) ? [...data.voids, ...appended] : appended;
          const next = { orderId: String(orderId), voids: nextVoids };
          try { localStorage.setItem(key, JSON.stringify(next)); } catch {}
        }
      } catch {}
      setVoidToast(`Voided ${lines.length} item(s)`);
      setTimeout(()=> setVoidToast(''), 1500);
      // TODO: 재계산 훅 연동(합계/세금/영수증)
      // 비동기로 프린터 잡 디스패치 트리거 (실패해도 무시)
      try { await fetch(`${API_URL}/printers/jobs/dispatch`, { method:'POST' }); } catch {}
    } catch (e:any) {
      alert(String(e?.message||'Void failed'));
    }
  };

  // Select all items for Void
  const handleSelectAllVoid = (check: boolean) => {
    setVoidSelections(prev => {
      const next: Record<string, { checked: boolean; qty: number }> = { ...prev };
      Object.keys(next).forEach(k => {
        next[k] = { checked: check, qty: Math.max(1, Number(next[k]?.qty || 1)) };
      });
      return next;
    });
  };

  const handleAddPayment = async ({ method, amount, tip, discountedGrand, change: changeVal = 0 }:{ method:string; amount:number; tip:number; discountedGrand?: number; change?: number }) => {
    try {
      // 저장된 주문 id가 없으므로, 우선 OK에서 저장되는 흐름과 달리 Payment에서는 주문 저장 선행 필요할 수 있음
      // 간단히 임시 order 저장 후 id 회수
      const items = (orderItems || []).filter(it => it.type === 'item');
      const now = new Date();
      const orderNumber = `ORD-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${now.getTime()}`;
      if (!savedOrderIdRef.current) {
        // Calculate tax before saving
        const payTotals = computeGuestTotals('ALL');
        const paySubtotal = Number((payTotals.subtotal || 0).toFixed(2));
        const payTax = Number(((payTotals.taxLines || []).reduce((s: number, t: any) => s + (t.amount || 0), 0)).toFixed(2));
        const payTotal = Number((paySubtotal + payTax).toFixed(2));
        const saveRes = await fetch(`${API_URL}/orders`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ orderNumber, orderType: orderType||'POS', total: payTotal, subtotal: paySubtotal, tax: payTax, items: items.map((it:any)=>({ id: it.id, name: it.name, quantity: it.quantity, price: it.totalPrice, guestNumber: it.guestNumber || 1, modifiers: it.modifiers || [], memo: it.memo || null, discount: (it as any).discount || null, splitDenominator: it.splitDenominator || null, splitNumerator: it.splitNumerator || null, orderLineId: (it as any).orderLineId || null, taxRate: Number(it.taxRate || it.tax_rate || 0), tax: Number(it.tax || 0), togoLabel: it.togoLabel || false, taxGroupId: it.taxGroupId || null, printerGroupId: it.printerGroupId || null })), customerName: getPersistableCustomerName(), customerPhone: orderCustomerInfo.phone || null, orderMode: 'FSR' }) });
        if (!saveRes.ok) throw new Error('Failed to save order');
        const saved = await saveRes.json();
        savedOrderIdRef.current = saved.orderId;
        savedOrderNumberRef.current = saved.order_number || String(saved.dailyNumber || '').padStart(3, '0') || null;
        
        // Live Order 실시간 업데이트를 위한 이벤트 발생
        const tableIdForOrder = (location.state && (location.state as any).tableId) || null;
        window.dispatchEvent(new CustomEvent('orderCreated', { detail: { orderId: saved.orderId, tableId: tableIdForOrder } }));
      }
      const orderId = savedOrderIdRef.current as number;
      if (guestPaymentMode === 'ALL') {
        // 한 건 결제로 전체 금액(세금 포함)의 일부/전부를 결제
        const payRes = await fetch(`${API_URL}/payments`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ orderId, method, amount: Number((amount + tip).toFixed(2)), tip, guestNumber: null, changeAmount: changeVal }) });
        if (!payRes.ok) throw new Error('Failed to save payment');
        const payData = await payRes.json();
        // 로컬 집계: 전체 스코프의 결제 합계를 갱신하고, 게스트별 표시용으로는 동일 금액을 순서대로 소진하도록 가상 분배만 반영
        setPaymentsByGuest(prev => {
                      const perGuestTotals = guestIds.reduce((acc: Record<string, number>, g: number) => {
            const { grand } = computeGuestTotals(g);
            acc[String(g)] = Number(grand.toFixed(2));
            return acc;
          }, {} as Record<string, number>);
          const next = { ...prev } as Record<string, number>;
          let remaining = Number(amount.toFixed(2));
          for (const g of guestIds) {
            if (remaining <= 0) break;
            const key = String(g);
            const paid = next[key] || 0;
            const due = Math.max(0, Number((perGuestTotals[key] - paid).toFixed(2)));
            if (due <= 0) continue;
            const use = Math.min(due, remaining);
            next[key] = Number((paid + use).toFixed(2));
            remaining = Number((remaining - use).toFixed(2));
          }
          return next;
        });
        setSessionPayments(prev => ([ ...prev, { paymentId: payData.paymentId, method, amount: Number(amount.toFixed(2)), tip, guestNumber: undefined } ]));
        // onPaymentComplete 콜백이 PaymentModal에서 결제 완료를 감지하여 PaymentCompleteModal을 표시함
        return;
      } else {
        // 단일 게스트 결제 저장
        const payRes = await fetch(`${API_URL}/payments`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ orderId, method, amount: Number((amount + tip).toFixed(2)), tip, guestNumber: Number(guestPaymentMode), changeAmount: changeVal }) });
        if (!payRes.ok) throw new Error('Failed to save payment');
        const payData = await payRes.json();
        // Track paid locally for live due update
        setPaymentsByGuest(prev => {
          const key = String(guestPaymentMode);
          const current = prev[key] || 0;
          return { ...prev, [key]: Number((current + amount).toFixed(2)) };
        });
        setSessionPayments(prev => ([ ...prev, { paymentId: payData.paymentId, method, amount: Number(amount.toFixed(2)), tip, guestNumber: Number(guestPaymentMode) } ]));
        
        // 게스트 전액 결제 완료 시에만 Receipt 출력 (복합결제 중간에는 출력 안 함)
        try {
          const guestNum = Number(guestPaymentMode);
          // IMPORTANT:
          // - For Equal Split(adhocSplitCount), items are not physically split by guestNumber.
          // - Therefore computeGuestTotals(guestNum) is NOT the correct "due" for Guest 2/3... (often 0),
          //   and Guest 1 becomes the whole order (causing an extra payment loop).
          // - Use the same fair-penny distribution used by PaymentModal for the "guest share due".
          let guestSubtotal = 0;
          let guestTaxLines: any[] = [];
          let guestTaxTotal = 0;
          let guestTotal = 0;

          const hasPartialPaidHistory = (persistedPaidGuestsRef.current || []).length > 0;
          const isEvenSplit = (adhocSplitCount > 1 || (adhocSplitCount === 1 && hasPartialPaidHistory)) && Number.isFinite(guestNum) && guestNum >= 1;
          if (isEvenSplit) {
            const n = Math.max(1, Math.floor(Number(adhocSplitCount) || 0));
            const idx = guestNum;

            const priorPaid = sessionPayments
              .filter(p => priorPaymentIdsRef.current.has(p.paymentId))
              .reduce((s, p) => s + (p.amount || 0), 0);
            const fullBase = (typeof discountedGrand === 'number' && discountedGrand > 0) ? discountedGrand : payGrandAll;
            const effectiveBase = Math.max(0, Number((fullBase - priorPaid).toFixed(2)));
            const grandCents = Math.round(Number(effectiveBase || 0) * 100);
            const baseGrand = Math.floor(grandCents / n);
            const remGrand = grandCents % n;
            guestTotal = (baseGrand + (idx <= remGrand ? 1 : 0)) / 100;

            const balanceRatio = fullBase > 0 ? effectiveBase / fullBase : 1;
            const totalLines = Array.isArray(payTaxLinesAll) ? payTaxLinesAll : [];
            guestTaxLines = totalLines.map((t: any) => {
              const scaledCents = Math.round(Number(t?.amount || 0) * balanceRatio * 100);
              const tBase = Math.floor(scaledCents / n);
              const tRem = scaledCents % n;
              const myT = (tBase + (idx <= tRem ? 1 : 0)) / 100;
              return { ...t, amount: myT };
            });
            guestTaxTotal = Number((guestTaxLines.reduce((s: number, t: any) => s + (t.amount || 0), 0)).toFixed(2));

            guestSubtotal = Number((guestTotal - guestTaxTotal).toFixed(2));
          } else {
            const guestTotals = computeGuestTotals(guestNum);
            guestSubtotal = Number((guestTotals.subtotal || 0).toFixed(2));
            guestTaxLines = guestTotals.taxLines || [];
            guestTaxTotal = Number((guestTaxLines.reduce((s: number, t: any) => s + (t.amount || 0), 0)).toFixed(2));
            guestTotal = Number((guestSubtotal + guestTaxTotal).toFixed(2));
          }
          
          // 이전 결제 + 현재 결제 합계
          const previousPaid = Number((paymentsByGuest[String(guestNum)] || 0).toFixed(2));
          const currentPayment = Number((amount + tip).toFixed(2));
          const totalPaidNow = Number((previousPaid + currentPayment).toFixed(2));
          const outstanding = Number((guestTotal - totalPaidNow).toFixed(2));
          
          const EPS = 0.05; // 미세한 오차 허용
          const isGuestFullyPaid = outstanding <= EPS;
          
          console.log(`🧾 Guest ${guestNum} payment check: total=${guestTotal}, paid=${totalPaidNow}, outstanding=${outstanding}, fullyPaid=${isGuestFullyPaid}`);
          
          // 게스트 전액 결제 완료 시 Receipt 출력은 PaymentCompleteModal에서 처리
          // (사용자가 No Receipt / 1 Receipt / 2 Receipts 선택)
          if (isGuestFullyPaid) {
            // 게스트 결제 완료 시 즉시 DB에 PAID 상태 저장
            try {
              const currentOrderId = savedOrderIdRef.current || orderIdFromState;
              if (currentOrderId) {
                console.log(`💾 Saving Guest ${guestNum} PAID status to DB (orderId: ${currentOrderId})...`);
                const saveRes = await fetch(`${API_URL}/orders/${encodeURIComponent(String(currentOrderId))}/guest-status/bulk`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ statuses: [{ guestNumber: guestNum, status: 'PAID', locked: true }] })
                });
                if (saveRes.ok) {
                  // persistedPaidGuests 상태 즉시 업데이트
                  setPersistedPaidGuests(prev => {
                    if (prev.includes(guestNum)) return prev;
                    const next = [...prev, guestNum].sort((a, b) => a - b);
                    console.log(`💾 persistedPaidGuests updated:`, next);
                    return next;
                  });
                  console.log(`💾 Guest ${guestNum} PAID status saved successfully`);
                } else {
                  console.error(`💾 Failed to save Guest ${guestNum} PAID status: ${saveRes.status}`);
                }
              } else {
                console.warn(`💾 No orderId available, cannot save Guest ${guestNum} PAID status`);
              }
            } catch (dbErr) {
              console.error('Failed to save guest PAID status to DB:', dbErr);
            }
          } else {
            console.log(`🧾 Guest ${guestNum} not fully paid yet, skipping receipt print`);
          }
        } catch (receiptErr) {
          console.warn('Guest Receipt print failed (ignored):', receiptErr);
        }
        
        // Keep modal open; navigation occurs on Next
        // Auto-complete is deferred to onComplete
      }
    } catch (e) {
      console.error(e);
      alert('An error occurred during payment processing.');
    }
  };
  const handleCompletePayment = async (receiptCount: number = 2) => {
    try {
      // Guard: only close order when ALL guests are fully paid
      const totals = computeGuestTotals('ALL');
      const baseNetSubtotal = Number((totals.subtotal || 0).toFixed(2)); // after item+order discounts (pre-TOGO adj)
      const baseTaxLines: { name: string; amount: number }[] =
        (totals.taxLines || []).map((t: any) => ({ name: t.name, amount: Number((t.amount || 0).toFixed(2)) }));
      const baseTaxesTotal = Number((baseTaxLines.reduce((s: number, t: any) => s + (t.amount || 0), 0)).toFixed(2));
      const baseGrand = Number((totals.grand || 0).toFixed(2));

      // Receipt subtotal line should match item sums (before order-wide discount line),
      // so we add back orderDiscountTotal for display while keeping tax/total discounted.
      const orderDiscountTotal = Number((pricingAll.totals?.orderDiscountTotal || 0).toFixed(2));
      const subtotalForReceipt = Number((baseNetSubtotal + orderDiscountTotal).toFixed(2));

      const isTogo = (orderType || '').toLowerCase() === 'togo';
      const togoAdjustments: any[] = [];
      let togoDiscountAmt = 0;
      let bagFeeAmt = 0;
      if (isTogo && togoSettings.discountEnabled && Number(togoSettings.discountValue || 0) > 0) {
        const dv = Number(togoSettings.discountValue || 0);
        togoDiscountAmt = computeDiscountAmount(baseNetSubtotal, (togoSettings.discountMode === 'amount' ? 'amount' : 'percent') as any, dv);
        if (togoDiscountAmt > 0) togoAdjustments.push({ kind: 'DISCOUNT', label: 'TOGO Discount', amount: togoDiscountAmt });
      }
      if (isTogo && togoSettings.bagFeeEnabled && Number(togoSettings.bagFeeValue || 0) > 0) {
        bagFeeAmt = Number(Number(togoSettings.bagFeeValue || 0).toFixed(2));
        if (bagFeeAmt > 0) togoAdjustments.push({ kind: 'FEE', label: 'Bag Fee', amount: bagFeeAmt });
      }
      const appliedTotals = (togoAdjustments.length > 0)
        ? applySubtotalAdjustments({ subtotal: baseNetSubtotal, taxLines: baseTaxLines }, togoAdjustments)
        : { subtotal: baseNetSubtotal, taxLines: baseTaxLines, taxesTotal: baseTaxesTotal, total: baseGrand } as any;
      const taxLinesForReceipt: { name: string; amount: number }[] =
        (appliedTotals.taxLines || []).map((t: any) => ({ name: t.name, amount: Number((t.amount || 0).toFixed(2)) }));
      const taxTotal = Number((appliedTotals.taxesTotal || 0).toFixed(2));
      const expectedGrand = Number((appliedTotals.total || 0).toFixed(2));
      const paidByGuests = Object.values(paymentsByGuest).reduce((s, v) => s + (v || 0), 0);
      const paidBySession = (Array.isArray(sessionPayments) ? sessionPayments.reduce((s, p) => s + (p.amount || 0), 0) : 0);
      const paidTotal = Math.max(Number((paidByGuests).toFixed(2)), Number((paidBySession).toFixed(2)));
      const outstanding = Math.max(0, Number((expectedGrand - paidTotal).toFixed(2)));
      const EPS = 0.05; // treat tiny residuals/rounding as fully paid
      
      const orderId = savedOrderIdRef.current;
      const tableIdForMap = (location.state && (location.state as any).tableId) || null;
      const floor = (location.state && (location.state as any).floor) || null;
      // 일부 게스트만 결제된 경우: 기본은 Split Bill로 복귀
      // 단, Pay in Full(ALL) 플로우 중에는 상태 반영 레이스를 피하기 위해 결제창을 유지하고 대기 (자동완료 useEffect가 처리)
      // 또한 잔액이 미세한 오차(EPS) 이하면 전액 결제로 간주하고 테이블맵으로 이동
      if (outstanding > EPS) {
        // 스플릿이 아닌 경우엔 스플릿 모달로 보내지 않고 결제 계속 진행
        const hasSplit = ((guestIds || []).length > 1) || (orderItems || []).some(it => it.type === 'separator');
        if (!hasSplit) {
          setShowPaymentModal(true);
          return;
        }
        if (payInFullFromSplitRef.current && guestPaymentMode === 'ALL') {
          // Keep PaymentModal open; wait for auto-complete trigger
          return;
        }
        setShowPaymentModal(false);
        setShowSplitBillModal(true);
        return;
      }

      // 모든 게스트 결제가 완료된 경우: 테이블 상태를 Available로 변경 (Preparing 제거)
      try {
        if (tableIdForMap) {
          await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(tableIdForMap)}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Available' }) });
          try { localStorage.setItem('lastOccupiedTable', JSON.stringify({ tableId: tableIdForMap, floor, status: 'Available', ts: Date.now() })); } catch {}
        }
      } catch {}

      if (orderId) {
        // Save gratuity (service_charge) to order if applicable
        const gRate = layoutSettings.gratuityRate ?? 0;
        const gratuityAmt = gratuityAmountRef.current > 0
          ? gratuityAmountRef.current
          : (gRate > 0 ? Number((baseNetSubtotal * gRate / 100).toFixed(2)) : 0);
        if (gratuityAmt > 0) {
          try {
            await fetch(`${API_URL}/orders/${orderId}/service-charge`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ service_charge: gratuityAmt })
            });
          } catch (e) { console.warn('Failed to save service_charge:', e); }
        }

        const pmDiscountForClose = paymentCompleteData?.discount;
        try {
          await fetch(`${API_URL}/orders/${orderId}/close`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pmDiscountForClose && pmDiscountForClose.percent > 0 ? { discount: pmDiscountForClose } : {})
          });
        } catch (e) { console.warn('Order status update failed (can be ignored):', e); }
      }
      try {
        if (tableIdForMap) {
          await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(tableIdForMap)}/current-order`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: null }) });
        }
      } catch {}

      // Live Order 실시간 업데이트를 위한 이벤트 발생
      window.dispatchEvent(new CustomEvent('orderPaid', { detail: { orderId, tableId: tableIdForMap } }));

      // Open Cash Drawer (Till) after payment completion
      try {
        console.log('💰 Opening cash drawer after payment completion...');
        await fetch(`${API_URL}/printers/open-drawer`, { method: 'POST' });
        console.log('💰 Cash drawer opened successfully');
      } catch (drawerErr) {
        console.warn('Cash drawer open failed (ignored):', drawerErr);
      }

      // Print Receipt after payment completion (only once per payment session)
      if (!receiptPrintedRef.current) {
        receiptPrintedRef.current = true; // Mark as printed to prevent duplicates
        try {
          // Build receipt data
        const guestSections = guestIds.map((g: number) => {
          const guestItems = (orderItems || []).filter(it => it.type === 'item' && (it.guestNumber || 1) === g);
          return {
            guestNumber: g,
            items: guestItems.map(item => ({
              name: item.name,
              quantity: item.quantity || 1,
              price: item.price || 0,
              totalPrice: item.totalPrice || item.price || 0,
              modifiers: item.modifiers || [],
              memo: item.memo,
              togoLabel: !!(item as any).togoLabel
            }))
          };
        }).filter(s => s.items.length > 0);

        // Build adjustments for receipt (Discount / Fees)
        const receiptAdjustments: Array<{ label: string; amount: number }> = [];

        // Order D/C (전체 할인) - use pricing module's applied amount for accuracy
        if (orderDiscountTotal > 0.01) {
          const orderDiscountItem = (orderItems || []).find(it => it.id === 'DISCOUNT_ITEM' && it.type === 'discount');
          const discountData = (orderDiscountItem as any)?.discount || {};
          const discountMode = discountData.mode || 'percent';
          const discountValue = Number(discountData.value || 0);
          const discountType = discountData.type || 'Order D/C';
          const label = (discountMode === 'percent' && discountValue > 0)
            ? `${discountType} (${discountValue}%)`
            : discountType;
          receiptAdjustments.push({ label, amount: -Number(orderDiscountTotal.toFixed(2)) });
        }

        // TOGO Discount / Bag Fee (channel adjustments; applied pre-tax with tax recalculation)
        if (togoDiscountAmt > 0.01) receiptAdjustments.push({ label: 'TOGO Discount', amount: -Number(togoDiscountAmt.toFixed(2)) });
        if (bagFeeAmt > 0.01) receiptAdjustments.push({ label: 'Bag Fee', amount: Number(bagFeeAmt.toFixed(2)) });

        // PaymentModal discount (결제 시 적용된 할인)
        const pmDiscount2 = paymentCompleteData?.discount;
        console.log('🧾 [handleCompletePayment] discount data:', JSON.stringify(pmDiscount2));
        let finalSubtotal2 = subtotalForReceipt;
        let finalTaxLines2 = taxLinesForReceipt;
        let finalTaxTotal2 = taxTotal;
        let finalTotal2 = expectedGrand;

        if (pmDiscount2 && pmDiscount2.percent > 0) {
          receiptAdjustments.push({
            label: `Discount (${pmDiscount2.percent}%)`,
            amount: -Number(pmDiscount2.amount.toFixed(2))
          });
          finalTaxLines2 = pmDiscount2.taxLines.map(t => ({ name: t.name, amount: Number((t.amount || 0).toFixed(2)) }));
          finalTaxTotal2 = Number(pmDiscount2.taxesTotal.toFixed(2));
          finalTotal2 = Number((pmDiscount2.discountedSubtotal + pmDiscount2.taxesTotal).toFixed(2));
        }
        
        const receiptData = {
          header: {
            orderNumber: savedOrderNumberRef.current ? `#${savedOrderNumberRef.current}` : (orderId || ''),
            channel: orderType || 'Dine-in',
            tableName: resolvedTableName || '',
            serverName: selectedServer?.name || ''
          },
          orderInfo: {
            channel: orderType || 'Dine-in',
            tableName: resolvedTableName || '',
            serverName: selectedServer?.name || ''
          },
          items: (orderItems || []).filter(it => it.type === 'item').map(item => {
            const memoPrice =
              item.memo && typeof item.memo.price === 'number' ? Number(item.memo.price) : 0;
            const perUnit = Number((item.totalPrice != null ? item.totalPrice : item.price) || 0) + memoPrice;
            const gross = perUnit * (item.quantity || 1);
            const discountAmount = computeItemDiscountAmount(item as any);
            const lineTotal = Math.max(0, gross - discountAmount);
            return {
              name: item.name,
              quantity: item.quantity || 1,
              price: item.price || 0,
              totalPrice: item.totalPrice || item.price || 0,
              lineTotal,
              originalTotal: discountAmount > 0 ? gross : undefined,
              discount: discountAmount > 0 ? {
                type: (item as any).discount?.type || 'Item Discount',
                value: (item as any).discount?.value || 0,
                amount: discountAmount
              } : undefined,
              modifiers: item.modifiers || [],
              memo: item.memo,
              togoLabel: !!(item as any).togoLabel
            };
          }),
          guestSections,
          // Receipt: show item-level TOGO label and hide TOGO separator line
          togoDisplayMode: 'per_item',
          showTogoSeparator: false,
          subtotal: finalSubtotal2,
          adjustments: receiptAdjustments,
          taxLines: finalTaxLines2,
          taxesTotal: finalTaxTotal2,
          total: finalTotal2,
          payments: sessionPayments.map(p => ({
            method: p.method || 'Unknown',
            amount: (p.amount || 0) + (p.tip || 0),
            tip: p.tip || 0
          })),
          change: 0,
          footer: {}
        };

        // 결제 완료 시 무조건 영수증 출력
        if (receiptCount > 0) {
          await fetch(`${API_URL}/printers/print-receipt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ receiptData, copies: receiptCount })
          });
          console.log(`Receipt printed successfully (${receiptCount} copies)`);
        } else {
          console.log('No receipt requested by user');
        }
        } catch (printErr) {
          console.warn('Receipt print failed (ignored):', printErr);
        }
      } // End of receiptPrintedRef guard
    
    clearServerAssignmentForContext();
    setSelectedServer(null);
    navigate('/sales', { replace: true });
    } catch (e) {
      console.error(e);
      alert('Error during payment completion');
    }
  };

  // ═══════════════════════════════════════════════════
  // Payment Complete Modal handlers
  // ═══════════════════════════════════════════════════

  // 결제 완료 모달에서 최종 완료 처리 (전체 결제 완료 시)
  const handlePaymentCompleteClose = async (receiptCount: number) => {
    const savedPaymentData = paymentCompleteData;
    setShowPaymentCompleteModal(false);
    setPaymentCompleteData(null);

    // Equal Split(adhoc) / Split 결제에서 "마지막 게스트"까지 결제 완료된 경우:
    // - Receipt 선택 후 즉시 테이블맵으로 이동
    // - 테이블 상태/주문 close/current-order 해제는 백그라운드로 처리 (UX 개선)
    try {
      const splitAllGuests: number[] =
        (adhocSplitCount > 0)
          ? Array.from({ length: Math.max(1, adhocSplitCount) }, (_, i) => i + 1)
          : Array.from(guestIds || []);
      const currentGuest = savedPaymentData?.currentGuestNumber;
      const latestPaid = persistedPaidGuestsRef.current;
      const paidSet = new Set<number>([
        ...(Array.isArray(latestPaid) ? latestPaid : []),
        ...(typeof currentGuest === 'number' ? [currentGuest] : []),
      ]);
      const unpaid = splitAllGuests.filter(g => !paidSet.has(g));
      const isLastGuest = unpaid.length === 0 && typeof currentGuest === 'number';
      const hasSplitContext = (adhocSplitCount > 0) || splitAllGuests.length > 1;

      if (hasSplitContext && isLastGuest) {
        // Double-check paid-in-full to avoid navigating away prematurely
        const totals = computeGuestTotals('ALL');
        const baseSubtotal = Number((totals.subtotal || 0).toFixed(2));
        const taxTotal = Number(((totals.taxLines || []).reduce((s: number, t: any) => s + (t.amount || 0), 0)).toFixed(2));
        let expectedGrand = Number((baseSubtotal + taxTotal).toFixed(2));

        // PaymentModal에서 적용된 할인 반영
        const pmDiscount = savedPaymentData?.discount;
        if (pmDiscount && pmDiscount.percent > 0) {
          const discountedSub = Number((pmDiscount.discountedSubtotal || 0).toFixed(2));
          const discountedTax = Number((pmDiscount.taxesTotal || 0).toFixed(2));
          expectedGrand = Number((discountedSub + discountedTax).toFixed(2));
        } else if ((orderType || '').toLowerCase() === 'togo') {
          const discountActive = togoSettings.discountEnabled && Number(togoSettings.discountValue || 0) > 0;
          const bagActive = togoSettings.bagFeeEnabled && Number(togoSettings.bagFeeValue || 0) > 0;
          const discountValue = Number(togoSettings.discountValue || 0);
          const bagFeeValue = Number(togoSettings.bagFeeValue || 0);
          const discountAmtBase = discountActive
            ? (togoSettings.discountMode === 'percent'
                ? (baseSubtotal * discountValue) / 100
                : discountValue)
            : 0;
          const discountAmt = Number(discountAmtBase.toFixed(2));
          const subtotalAfterDiscount = Math.max(0, Number((baseSubtotal - discountAmt).toFixed(2)));
          const bagFeeAmt = bagActive ? Number(bagFeeValue.toFixed(2)) : 0;
          expectedGrand = Number((subtotalAfterDiscount + bagFeeAmt + taxTotal).toFixed(2));
        }
        const paidByGuests = Object.values(paymentsByGuest).reduce((s, v) => s + (v || 0), 0);
        const paidBySession = (Array.isArray(sessionPayments) ? sessionPayments.reduce((s, p) => s + (p.amount || 0), 0) : 0);
        const paidTotal = Math.max(Number((paidByGuests).toFixed(2)), Number((paidBySession).toFixed(2)));
        const outstanding = Math.max(0, Number((expectedGrand - paidTotal).toFixed(2)));
        const EPS = 0.05;

        if (outstanding <= EPS) {
          const orderId = savedOrderIdRef.current;
          const tableIdForMap = (location.state && (location.state as any).tableId) || null;
          const floor = (location.state && (location.state as any).floor) || null;

          // Receipt count was chosen in PaymentCompleteModal; ensure we print BEFORE leaving to TableMap.
          // In split/adhoc mode, the per-guest receipt is the expected output.
          try {
            await handlePartialPrintReceipt(receiptCount);
          } catch (e) {
            try { console.warn('Guest receipt print failed (ignored):', e); } catch {}
          }

          // Immediate UI cleanup + navigate first
          clearServerAssignmentForContext();
          setSelectedServer(null);
          navigate('/sales', { replace: true });

          // Background finalization (no UI state updates)
          void (async () => {
            try {
              if (tableIdForMap) {
                try {
                  await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(tableIdForMap)}/status`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'Available' })
                  });
                  try { localStorage.setItem('lastOccupiedTable', JSON.stringify({ tableId: tableIdForMap, floor, status: 'Available', ts: Date.now() })); } catch {}
                } catch {}
              }

              if (orderId) {
                try {
                  await fetch(`${API_URL}/orders/${orderId}/close`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(pmDiscount && pmDiscount.percent > 0 ? { discount: pmDiscount } : {})
                  });
                } catch {}
              }

              if (tableIdForMap) {
                try {
                  await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(tableIdForMap)}/current-order`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ orderId: null })
                  });
                } catch {}
              }

              try {
                window.dispatchEvent(new CustomEvent('orderPaid', { detail: { orderId, tableId: tableIdForMap } }));
              } catch {}

              // Optional: open drawer (ignore failures)
              try { await fetch(`${API_URL}/printers/open-drawer`, { method: 'POST' }); } catch {}
            } catch {}
          })();
          return;
        }
      }
    } catch {}

    // Split 결제인 경우: 위의 split 경로에서 이미 처리됨 (outstanding 불일치로 여기까지 온 경우에도 전체 영수증 출력 방지)
    const hasSplitContextFallback = (adhocSplitCount > 0) || (guestIds || []).length > 1;

    // Non-split (single payment) completion:
    const orderId = savedOrderIdRef.current;
    const tableIdForMap = (location.state && (location.state as any).tableId) || null;
    const floor = (location.state && (location.state as any).floor) || null;

    // Print receipt (결제 완료 시 무조건 출력)
    if (!receiptPrintedRef.current && receiptCount > 0) {
      receiptPrintedRef.current = true;
      try {
        const totals = computeGuestTotals('ALL');
        const baseNetSubtotal = Number((totals.subtotal || 0).toFixed(2)); // after item+order discounts (pre-TOGO adj)
        const baseTaxLines: { name: string; amount: number }[] =
          (totals.taxLines || []).map((t: any) => ({ name: t.name, amount: Number((t.amount || 0).toFixed(2)) }));
        const baseTaxesTotal = Number((baseTaxLines.reduce((s: number, t: any) => s + (t.amount || 0), 0)).toFixed(2));
        const baseGrand = Number((totals.grand || 0).toFixed(2));

        const orderDiscountTotal = Number((pricingAll.totals?.orderDiscountTotal || 0).toFixed(2));
        const subtotalForReceipt = Number((baseNetSubtotal + orderDiscountTotal).toFixed(2));

        const isTogo = (orderType || '').toLowerCase() === 'togo';
        const togoAdjustments: any[] = [];
        let togoDiscountAmt = 0;
        let bagFeeAmt = 0;
        if (isTogo && togoSettings.discountEnabled && Number(togoSettings.discountValue || 0) > 0) {
          const dv = Number(togoSettings.discountValue || 0);
          togoDiscountAmt = computeDiscountAmount(baseNetSubtotal, (togoSettings.discountMode === 'amount' ? 'amount' : 'percent') as any, dv);
          if (togoDiscountAmt > 0) togoAdjustments.push({ kind: 'DISCOUNT', label: 'TOGO Discount', amount: togoDiscountAmt });
        }
        if (isTogo && togoSettings.bagFeeEnabled && Number(togoSettings.bagFeeValue || 0) > 0) {
          bagFeeAmt = Number(Number(togoSettings.bagFeeValue || 0).toFixed(2));
          if (bagFeeAmt > 0) togoAdjustments.push({ kind: 'FEE', label: 'Bag Fee', amount: bagFeeAmt });
        }
        const appliedTotals = (togoAdjustments.length > 0)
          ? applySubtotalAdjustments({ subtotal: baseNetSubtotal, taxLines: baseTaxLines }, togoAdjustments)
          : { subtotal: baseNetSubtotal, taxLines: baseTaxLines, taxesTotal: baseTaxesTotal, total: baseGrand } as any;
        const taxLinesForReceipt: { name: string; amount: number }[] =
          (appliedTotals.taxLines || []).map((t: any) => ({ name: t.name, amount: Number((t.amount || 0).toFixed(2)) }));
        const taxTotal = Number((appliedTotals.taxesTotal || 0).toFixed(2));
        const expectedGrand = Number((appliedTotals.total || 0).toFixed(2));

        const guestSections = guestIds.map((g: number) => {
          const guestItems = (orderItems || []).filter(it => it.type === 'item' && (it.guestNumber || 1) === g);
          return {
            guestNumber: g,
            items: guestItems.map(item => ({
              name: item.name,
              quantity: item.quantity || 1,
              price: item.price || 0,
              totalPrice: item.totalPrice || item.price || 0,
              modifiers: item.modifiers || [],
              memo: item.memo,
              togoLabel: !!(item as any).togoLabel
            }))
          };
        }).filter(s => s.items.length > 0);

        const receiptAdjustments: Array<{ label: string; amount: number }> = [];
        if (orderDiscountTotal > 0.01) {
          const orderDiscountItem = (orderItems || []).find(it => it.id === 'DISCOUNT_ITEM' && it.type === 'discount');
          const discountData = (orderDiscountItem as any)?.discount || {};
          const discountMode = discountData.mode || 'percent';
          const discountValue = Number(discountData.value || 0);
          const discountType = discountData.type || 'Order D/C';
          const label = (discountMode === 'percent' && discountValue > 0)
            ? `${discountType} (${discountValue}%)`
            : discountType;
          receiptAdjustments.push({ label, amount: -Number(orderDiscountTotal.toFixed(2)) });
        }
        if (togoDiscountAmt > 0.01) receiptAdjustments.push({ label: 'TOGO Discount', amount: -Number(togoDiscountAmt.toFixed(2)) });
        if (bagFeeAmt > 0.01) receiptAdjustments.push({ label: 'Bag Fee', amount: Number(bagFeeAmt.toFixed(2)) });

        // PaymentModal discount (결제 시 적용된 할인)
        const pmDiscount = savedPaymentData?.discount;
        console.log('🧾 Receipt discount data:', JSON.stringify(pmDiscount), 'savedPaymentData keys:', savedPaymentData ? Object.keys(savedPaymentData) : 'null');
        let finalSubtotal = subtotalForReceipt;
        let finalTaxLines = taxLinesForReceipt;
        let finalTaxTotal = taxTotal;
        let finalTotal = expectedGrand;

        if (pmDiscount && pmDiscount.percent > 0) {
          console.log(`🧾 Adding Discount (${pmDiscount.percent}%) = -$${pmDiscount.amount.toFixed(2)} to receipt`);
          receiptAdjustments.push({
            label: `Discount (${pmDiscount.percent}%)`,
            amount: -Number(pmDiscount.amount.toFixed(2))
          });
          finalTaxLines = pmDiscount.taxLines.map(t => ({ name: t.name, amount: Number((t.amount || 0).toFixed(2)) }));
          finalTaxTotal = Number(pmDiscount.taxesTotal.toFixed(2));
          finalTotal = Number((pmDiscount.discountedSubtotal + pmDiscount.taxesTotal).toFixed(2));
        }

        const receiptData = {
          header: {
            orderNumber: savedOrderNumberRef.current ? `#${savedOrderNumberRef.current}` : (orderId || ''),
            channel: orderType || 'Dine-in',
            tableName: resolvedTableName || '',
            serverName: selectedServer?.name || ''
          },
          orderInfo: {
            channel: orderType || 'Dine-in',
            tableName: resolvedTableName || '',
            serverName: selectedServer?.name || ''
          },
          items: (orderItems || []).filter(it => it.type === 'item').map(item => {
            const memoPrice =
              item.memo && typeof item.memo.price === 'number' ? Number(item.memo.price) : 0;
            const perUnit = Number((item.totalPrice != null ? item.totalPrice : item.price) || 0) + memoPrice;
            const gross = perUnit * (item.quantity || 1);
            const discountAmount = computeItemDiscountAmount(item as any);
            const lineTotal = Math.max(0, gross - discountAmount);
            return {
              name: item.name,
              quantity: item.quantity || 1,
              price: item.price || 0,
              totalPrice: item.totalPrice || item.price || 0,
              lineTotal,
              originalTotal: discountAmount > 0 ? gross : undefined,
              discount: discountAmount > 0 ? {
                type: (item as any).discount?.type || 'Item Discount',
                value: (item as any).discount?.value || 0,
                amount: discountAmount
              } : undefined,
              modifiers: item.modifiers || [],
              memo: item.memo,
              togoLabel: !!(item as any).togoLabel
            };
          }),
          guestSections,
          // Receipt: show item-level TOGO label and hide TOGO separator line
          togoDisplayMode: 'per_item',
          showTogoSeparator: false,
          subtotal: finalSubtotal,
          adjustments: receiptAdjustments,
          taxLines: finalTaxLines,
          taxesTotal: finalTaxTotal,
          total: finalTotal,
          payments: sessionPayments.map(p => ({
            method: p.method || 'Unknown',
            amount: (p.amount || 0) + (p.tip || 0),
            tip: p.tip || 0
          })),
          change: savedPaymentData?.change || 0,
          footer: {}
        };

        await fetch(`${API_URL}/printers/print-receipt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ receiptData, copies: receiptCount })
        });
        console.log(`Receipt printed successfully (${receiptCount} copies) from PaymentCompleteClose`);
      } catch (printErr) {
        console.warn('Receipt print failed (ignored):', printErr);
      }
    }

    // Navigate to table map immediately
    clearServerAssignmentForContext();
    setSelectedServer(null);
    navigate('/sales', { replace: true });

    // Background finalization
    void (async () => {
      try {
        if (tableIdForMap) {
          try {
            await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(tableIdForMap)}/status`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'Available' })
            });
            try { localStorage.setItem('lastOccupiedTable', JSON.stringify({ tableId: tableIdForMap, floor, status: 'Available', ts: Date.now() })); } catch {}
          } catch {}
        }
        if (orderId) {
          const pmDiscClose = savedPaymentData?.discount;
          try {
            await fetch(`${API_URL}/orders/${orderId}/close`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(pmDiscClose && pmDiscClose.percent > 0 ? { discount: pmDiscClose } : {})
            });
          } catch {}
        }
        if (tableIdForMap) {
          try {
            await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(tableIdForMap)}/current-order`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ orderId: null })
            });
          } catch {}
        }
        window.dispatchEvent(new CustomEvent('orderPaid', { detail: { orderId, tableId: tableIdForMap } }));
      } catch {}
    })();
  };

  // 스플릿 결제 중 개별 게스트 영수증 출력
  const handlePartialPrintReceipt = async (receiptCount: number) => {
    if (receiptCount <= 0 || !paymentCompleteData?.currentGuestNumber) return;
    
    const guestNum = paymentCompleteData.currentGuestNumber;
    try {
      const safeCopies = Math.max(0, Math.min(10, Math.floor(Number(receiptCount) || 0)));
      if (safeCopies <= 0) return;
      const orderKey = String(savedOrderIdRef.current || orderIdFromState || '');
      const dedupeKey = `${orderKey}|G${guestNum}|C${safeCopies}|ES${adhocSplitCount}`;
      const now = Date.now();
      const last = lastGuestReceiptPrintRef.current;
      if (last && last.key === dedupeKey && (now - last.ts) < 2500) {
        console.warn(`🧾 Skipping duplicate receipt print (dedupe): ${dedupeKey}`);
        return;
      }
      lastGuestReceiptPrintRef.current = { key: dedupeKey, ts: now };

      const isEvenSplit = adhocSplitCount > 0 || effectiveSplitCount > 1;
      const splitCount = adhocSplitCount > 0 ? adhocSplitCount : effectiveSplitCount;
      const splitIndex = Number(guestNum);

      // preSplit 아이템의 원래 splitCount를 localStorage에서 복원
      // 두 번째 결제에서 다른 N으로 split해도, 기존 아이템은 원래 N 기준으로 표시
      let originalSplitCount = splitCount;
      try {
        const orderId = savedOrderIdRef.current || orderIdFromState || null;
        if (orderId) {
          const lsRaw = localStorage.getItem(`paidGuests_order_${orderId}`);
          if (lsRaw) {
            const lsParsed = JSON.parse(lsRaw);
            if (lsParsed && lsParsed.splitCount > 1) {
              originalSplitCount = lsParsed.splitCount;
            }
          }
        }
      } catch {}
      console.log(`🧾 [RECEIPT DEBUG] splitCount=${splitCount}, originalSplitCount=${originalSplitCount}, adhocSplitCount=${adhocSplitCount}, effectiveSplitCount=${effectiveSplitCount}`);
      let guestSubtotal = 0;
      let guestTaxLines: any[] = [];
      let guestTaxTotal = 0;
      let guestTotal = 0;

      // PaymentModal 할인 정보
      const pmDiscount = paymentCompleteData?.discount;
      const hasPaymentDiscount = pmDiscount && pmDiscount.percent > 0;

      // preSplit 아이템의 잔여 share 비율 계산 (원래 splitCount 기준)
      // 예: 원래 1/3P → Guest 1 결제 → 잔여분 = (3-1)/3 = 2/3
      const allPaidGuests = Array.from(new Set([...persistedPaidGuests, ...(paymentCompleteData?.currentGuestNumber ? [paymentCompleteData.currentGuestNumber] : [])]));
      const previouslyPaidCount = allPaidGuests.filter(g => g !== guestNum).length;
      const myShareNumerator = previouslyPaidCount > 0 ? Math.max(1, originalSplitCount - previouslyPaidCount) : 1;
      console.log(`🧾 [RECEIPT DEBUG] guestNum=${guestNum}, splitCount=${splitCount}, originalSplitCount=${originalSplitCount}, previouslyPaidCount=${previouslyPaidCount}, myShareNumerator=${myShareNumerator}, allPaidGuests=${JSON.stringify(allPaidGuests)}, persistedPaidGuests=${JSON.stringify(persistedPaidGuests)}`);

      if (isEvenSplit && splitCount > 1 && Number.isFinite(splitIndex) && splitIndex >= 1) {
        // preSplit 아이템의 share 합계 + 새 아이템 전액으로 subtotal 계산
        const allItems = (orderItems || []).filter(it => it.type === 'item');
        let preSplitSubtotal = 0;
        let newItemSubtotal = 0;
        allItems.forEach((it: any) => {
          const unitPrice = Number((it.totalPrice != null ? it.totalPrice : it.price) || 0);
          const memoAdd = (it.memo && typeof it.memo.price === 'number') ? Number(it.memo.price) : 0;
          const itemTotal = (unitPrice + memoAdd) * (it.quantity || 1);
          if (it._preSplit !== false) {
            // 기존 아이템: share 가격 (원래 splitCount 기준)
            const cents = Math.round(itemTotal * 100);
            const sharePrice = Math.round(cents * myShareNumerator / originalSplitCount) / 100;
            preSplitSubtotal += sharePrice;
          } else {
            newItemSubtotal += itemTotal;
          }
        });
        guestSubtotal = Number((preSplitSubtotal + newItemSubtotal).toFixed(2));

        // Tax: subtotal 비율로 재계산
        const fullTotals = computeGuestTotals('ALL');
        const fullSubtotal = Number((fullTotals.subtotal || 0).toFixed(2));
        const fullTaxLines = fullTotals.taxLines || [];
        const taxRatio = fullSubtotal > 0 ? guestSubtotal / fullSubtotal : (1 / splitCount);
        guestTaxLines = fullTaxLines.map((t: any) => ({
          ...t,
          amount: Number((Number(t.amount || 0) * taxRatio).toFixed(2))
        }));
        guestTaxTotal = Number((guestTaxLines.reduce((s: number, t: any) => s + (t.amount || 0), 0)).toFixed(2));
        guestTotal = Number((guestSubtotal + guestTaxTotal).toFixed(2));
      } else {
        const guestTotals = computeGuestTotals(guestNum);
        guestSubtotal = Number((guestTotals.subtotal || 0).toFixed(2));
        guestTaxLines = guestTotals.taxLines || [];
        guestTaxTotal = Number((guestTaxLines.reduce((s: number, t: any) => s + (t.amount || 0), 0)).toFixed(2));
        guestTotal = Number((guestSubtotal + guestTaxTotal).toFixed(2));
      }

      // 아이템 목록: _preSplit 아이템은 분수 수량/가격, 새 아이템은 그대로
      const guestItems = (orderItems || []).filter(it =>
        it.type !== 'separator' && (isEvenSplit ? true : ((it.guestNumber || 1) === guestNum))
      );

      const receiptItems = (isEvenSplit && splitCount > 1) ? guestItems.map((item: any) => {
        const unitPrice = Number((item.totalPrice != null ? item.totalPrice : item.price) || 0);
        const memoAdd = (item.memo && typeof item.memo.price === 'number') ? Number(item.memo.price) : 0;
        const perUnit = unitPrice + memoAdd;
        const fullTotal = perUnit * (item.quantity || 1);
        if (item._preSplit !== false) {
          const shareCents = Math.round(Math.round(fullTotal * 100) * myShareNumerator / originalSplitCount);
          return {
            name: item.name,
            displayQty: `${myShareNumerator}/${originalSplitCount}`,
            quantity: item.quantity || 1,
            price: item.price || 0,
            totalPrice: item.totalPrice || item.price || 0,
            lineTotal: shareCents / 100,
            modifiers: item.modifiers || [],
            memo: item.memo,
            togoLabel: !!(item as any).togoLabel
          };
        }
        return {
          name: item.name,
          quantity: item.quantity || 1,
          price: item.price || 0,
          totalPrice: item.totalPrice || item.price || 0,
          lineTotal: fullTotal,
          modifiers: item.modifiers || [],
          memo: item.memo,
          togoLabel: !!(item as any).togoLabel
        };
      }) : guestItems.map(item => ({
        name: item.name,
        quantity: item.quantity || 1,
        price: item.price || 0,
        totalPrice: item.totalPrice || item.price || 0,
        modifiers: item.modifiers || [],
        memo: item.memo,
        togoLabel: !!(item as any).togoLabel
      }));
      
      // 해당 게스트의 모든 결제 내역 수집 (amount = 음식값 + 팁, PAID에 반영)
      const guestPaymentsList = sessionPayments
        .filter(p => p.guestNumber === guestNum)
        .map(p => ({ method: p.method, amount: (p.amount || 0) + (p.tip || 0), tip: p.tip || 0 }));
      
      const guestReceiptData = {
        header: {
          title: '*** RECEIPT ***',
          orderNumber: savedOrderNumberRef.current ? `#${savedOrderNumberRef.current}` : (savedOrderIdRef.current ? `#${savedOrderIdRef.current}` : `ORD-${Date.now()}`),
          channel: orderType?.toUpperCase() === 'POS' ? 'Dine-In' : (orderType || 'POS').toUpperCase(),
          tableName: (location.state as any)?.tableName || resolvedTableName || '',
          serverName: selectedServer?.name || '',
          guestNumber: guestNum,
          ...(isEvenSplit && splitCount > 1 ? { equalSplit: { index: splitIndex, count: splitCount } } : {})
        },
        orderInfo: {
          channel: orderType?.toUpperCase() === 'POS' ? 'Dine-In' : (orderType || 'POS').toUpperCase(),
          tableName: (location.state as any)?.tableName || resolvedTableName || '',
          serverName: selectedServer?.name || '',
          guestNumber: guestNum,
          ...(isEvenSplit && splitCount > 1 ? { equalSplit: { index: splitIndex, count: splitCount } } : {})
        },
        items: [],
        guestSections: [{
          guestNumber: guestNum,
          items: receiptItems
        }],
        togoDisplayMode: 'per_item',
        showTogoSeparator: false,
        subtotal: guestSubtotal,
        adjustments: (() => {
          if (!hasPaymentDiscount || !isEvenSplit) return [] as any[];
          const discCents = Math.round(Number(pmDiscount.amount || 0) * 100);
          const bDisc = Math.floor(discCents / splitCount);
          const rDisc = discCents % splitCount;
          const myDisc = (bDisc + (splitIndex <= rDisc ? 1 : 0)) / 100;
          return [{ label: `Discount (${pmDiscount.percent}%)`, amount: -myDisc }];
        })(),
        taxLines: guestTaxLines,
        taxesTotal: guestTaxTotal,
        total: guestTotal,
        payments: guestPaymentsList,
        change: paymentCompleteData?.change || 0,
        footer: { message: 'Thank you for dining with us!' }
      };
      
      console.log(`🧾 Printing Receipt for Guest ${guestNum} (${safeCopies} copies)...`);
      await fetch(`${API_URL}/printers/print-receipt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiptData: guestReceiptData, copies: safeCopies })
      });
      console.log(`🧾 Guest ${guestNum} Receipt printed successfully`);
    } catch (printErr) {
      console.warn('Guest receipt print failed (ignored):', printErr);
    }
  };

  // 시나리오 4: PaymentComplete 모달에서 별도 Cash Tip 추가
  const handleAddCashTip = async (tipAmount: number) => {
    const orderId = savedOrderIdRef.current;
    if (!orderId || tipAmount <= 0) return;
    try {
      const payRes = await fetch(`${API_URL}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          method: 'CASH',
          amount: tipAmount,  // 전액 팁
          tip: tipAmount,
          guestNumber: typeof guestPaymentMode === 'number' ? guestPaymentMode : null
        })
      });
      if (!payRes.ok) throw new Error('Failed to save cash tip');
      const payData = await payRes.json();
      setSessionPayments(prev => ([
        ...prev,
        { paymentId: payData.paymentId, method: 'CASH', amount: tipAmount, tip: tipAmount, guestNumber: typeof guestPaymentMode === 'number' ? guestPaymentMode : undefined }
      ]));
      console.log(`💰 Cash tip $${tipAmount} saved successfully`);
    } catch (e) {
      console.error('Failed to save cash tip:', e);
    }
  };

  // 스플릿 결제 완료 모달에서 다음 게스트 선택
  const handleGuestSelectFromModal = (guestNumber: number) => {
    setShowPaymentCompleteModal(false);
    setPaymentCompleteData(null);
    allModeStickyRef.current = false;
    payInFullFromSplitRef.current = false;
    receiptPrintedRef.current = false;
    setGuestPaymentMode(guestNumber);
    if (typeof guestNumber === 'number') {
      setActiveGuestNumber(guestNumber);
    }
    setPrefillDueNonce(n => n + 1);
  };

  const [selectedCategory, setSelectedCategory] = useState<string>('');
  // Mergy state (positioned early to be available before computed selectors)
  const [mergySelectedCategories, setMergySelectedCategories] = useState<string[]>([]);
  const [mergyActive, setMergyActive] = useState<boolean>(false);
  const [currentMergyGroupId, setCurrentMergyGroupId] = useState<string | null>(null);
  const MERGY_CATEGORY_ID = '__MERGY__';
  const [mergyName, setMergyName] = useState<string>('Merged');
  const [editingMergyGroup, setEditingMergyGroup] = useState<{id: string, name: string, categories: string[]} | null>(null);
  
  const isMergedSelected = mergyActive && selectedCategory === MERGY_CATEGORY_ID;
  
  const toggleMergyCategory = (name: string) => {
    setMergySelectedCategories(prev => {
      if (prev.includes(name)) return prev.filter(n => n !== name);
      if (prev.length >= 10) return prev; // 최대 10개로 증가
      return [...prev, name];
    });
  };
  
  const initialCategoryAppliedRef = useRef(false);
  const firstCategoryIdRef = useRef<string | null>(null);
  const [hasDisplayedMenuData, setHasDisplayedMenuData] = useState(false);
  const [layoutLockReady, setLayoutLockReady] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('orderLayoutLocked') === '1';
    } catch {
      return false;
    }
  });
  const lastSavedLayoutSnapshotRef = useRef<string | null>(layoutSnapshotSeed.raw);
  // Prefill PaymentModal amount with total when Pay in Full is used from Split screen
  const [prefillUseTotalOnceNonce, setPrefillUseTotalOnceNonce] = useState<number>(0);

  const [, startMenuDataTransition] = useTransition();
  const [catalogSnapshot, setCatalogSnapshot] = useState<CatalogSnapshot | null>(() => readCatalogSnapshot());
  const catalogSnapshotHashRef = useRef<string>('');

  const queueBackgroundUpdate = useCallback(
    (task: () => void) => {
      startMenuDataTransition(() => {
        task();
      });
    },
    [startMenuDataTransition]
  );


  
  const createMergyGroup = () => {
    if (mergySelectedCategories.length < 2) return;
    
    const newGroupId = `mergy_${Date.now()}`;
    const newGroup = {
      id: newGroupId,
      name: mergyName,
      categoryNames: [...mergySelectedCategories]
    };
    
    setLayoutSettings(prev => ({
      ...prev,
      mergedGroups: [...(prev.mergedGroups || []), newGroup]
    }));
    
    // 머지 그룹 생성 후 선택 초기화 (누적 방지)
    setMergySelectedCategories([]);
    setMergyName(`Merged_${(layoutSettings.mergedGroups?.length || 0) + 1}`);
    
    // 성공 메시지 표시
    console.log(`✅ Merge group "${mergyName}" created! (${newGroup.categoryNames.length} categories included)`);
    console.log(`📊 Total ${(layoutSettings.mergedGroups?.length || 0) + 1} merge groups now.`);
  };
  
  const deleteMergyGroup = (groupId: string) => {
    setLayoutSettings(prev => ({
      ...prev,
      mergedGroups: (prev.mergedGroups || []).filter(g => g.id !== groupId)
    }));
    
    // 현재 활성화된 그룹이 삭제된 경우 머지 비활성화
    if (currentMergyGroupId === groupId) {
      setMergyActive(false);
      setCurrentMergyGroupId(null);
      setSelectedCategory(categories[0]?.name || '');
    }
  };
  
  const editMergyGroup = (group: any) => {
    // Normalize to local editing shape { id, name, categories }
    setEditingMergyGroup({ id: group.id, name: group.name, categories: Array.isArray(group.categoryNames) ? [...group.categoryNames] : [] });
    setMergyName(group.name);
    setMergySelectedCategories(Array.isArray(group.categoryNames) ? [...group.categoryNames] : []);
  };
  
  const updateMergyGroup = () => {
    if (!editingMergyGroup) return;

    // If fewer than 2 categories remain, treat as unmerge: delete the group and free categories
    if (mergySelectedCategories.length < 2) {
      setLayoutSettings(prev => ({
        ...prev,
        mergedGroups: (prev.mergedGroups || []).filter(g => g.id !== editingMergyGroup.id)
      }));

      // If the currently active group is the one being edited, deactivate merge view
      if (currentMergyGroupId === editingMergyGroup.id) {
        setMergyActive(false);
        setCurrentMergyGroupId(null);
      }

      // If exactly one category remains, switch to it so it appears as a standalone category
      if (mergySelectedCategories.length === 1) {
        setSelectedCategory(mergySelectedCategories[0]);
      } else {
        // If none remain, fall back to the first available category
        setSelectedCategory(categories[0]?.name || '');
      }

      setEditingMergyGroup(null);
      setMergySelectedCategories([]);
      setMergyName('Merged');
      return;
    }
    
    setLayoutSettings(prev => ({
      ...prev,
      mergedGroups: (prev.mergedGroups || []).map(g => 
        g.id === editingMergyGroup.id 
          ? { ...g, name: mergyName, categoryNames: [...mergySelectedCategories] }
          : g
      )
    }));
    
    setEditingMergyGroup(null);
    setMergySelectedCategories([]);
    setMergyName('Merged');
  };
  
  const cancelEditMergyGroup = () => {
    setEditingMergyGroup(null);
    setMergySelectedCategories([]);
    setMergyName('Merged');
  };
  const [showColorModal, setShowColorModal] = useState(false);
  const [showItemColorModal, setShowItemColorModal] = useState(false);
  const [showCustomColorModal, setShowCustomColorModal] = useState(false);
  const [customColorModalSource, setCustomColorModalSource] = useState<'category' | 'menu' | 'modifier'>('category');
  const [showModifierColorModal, setShowModifierColorModal] = useState(false);
  const [modifierColorModalSource, setModifierColorModalSource] = useState<'default'|'custom'|'modExtra1'|'modExtra2'|'modExtra1Tab'|'modExtra2Tab'>('default');
  const [showUnifiedColorModal, setShowUnifiedColorModal] = useState(false);
  const [showCategoryColorModal, setShowCategoryColorModal] = useState(false);
  const [showMenuColorModal, setShowMenuColorModal] = useState(false);
  const [showCustomMenuColorModal, setShowCustomMenuColorModal] = useState(false);

  const [selectedItemForColor, setSelectedItemForColor] = useState<MenuItem | null>(null);

  const [itemColors, setItemColors] = useState<{ [key: string]: string }>({});
useEffect(() => {
  (async () => {
    try {
      const res = await fetch(`${API_URL}/menu-item-colors`);
      if (res.ok) {
        const data = await res.json();
        setItemColors(data || {});
      }
    } catch {}
  })();
}, []);
  const modifierColorsSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // modifierColors 변경 시 서버에 직접 저장 (debounce)
  const saveModifierColorsDirect = useCallback(async (colors: Record<string, string>) => {
    try {
      const res = await fetch(`${API_URL}/layout-settings`);
      if (!res.ok) return;
      const result = await res.json();
      const existing = result?.data || {};
      const payload = { ...existing, modifierColors: colors };
      const saveRes = await fetch(`${API_URL}/layout-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (saveRes.ok) {
        console.log('🎨 [Modifier Color] Saved directly:', colors);
      } else {
        console.error('🎨 [Modifier Color] Save failed:', saveRes.status);
      }
    } catch (err) {
      console.error('Failed to save modifierColors:', err);
    }
  }, []);

  useEffect(() => {
    if (!modifierColorsLoaded) return;
    if (Object.keys(modifierColors).length === 0) return;
    if (modifierColorsSaveTimeoutRef.current) {
      clearTimeout(modifierColorsSaveTimeoutRef.current);
    }
    modifierColorsSaveTimeoutRef.current = setTimeout(() => {
      saveModifierColorsDirect(modifierColorsAutoSaveRef.current);
    }, 500);
    return () => {
      if (modifierColorsSaveTimeoutRef.current) {
        clearTimeout(modifierColorsSaveTimeoutRef.current);
      }
    };
  }, [modifierColors, modifierColorsLoaded, saveModifierColorsDirect]);
  
  const [selectedModifierIdForColor, setSelectedModifierIdForColor] = useState<string | null>(null);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedMenuItemIds, setSelectedMenuItemIds] = useState<string[]>([]);
  
  // Item Memo 관련 상태
  const [showItemMemoModal, setShowItemMemoModal] = useState(false);
  const [itemMemo, setItemMemo] = useState('');
  const [itemMemoPrice, setItemMemoPrice] = useState('');
  
  // 메뉴 선택 및 Edit Price 모달 상태
  const [selectedOrderItemId, setSelectedOrderItemId] = useState<string | null>(null);
const [selectedOrderLineId, setSelectedOrderLineId] = useState<string | null>(null);
const [selectedOrderGuestNumber, setSelectedOrderGuestNumber] = useState<number | null>(null);
const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [showEditPriceModal, setShowEditPriceModal] = useState(false);
  const [newPrice, setNewPrice] = useState<string>('');
  const editPriceInputRef = useRef<HTMLInputElement | null>(null);
  
  // Open Price 모달 상태
  const [showOpenPriceModal, setShowOpenPriceModal] = useState(false);
  const [openPriceName, setOpenPriceName] = useState<string>('Open Charge');
  const [openPriceAmount, setOpenPriceAmount] = useState<string>('');
  const [openPriceNote, setOpenPriceNote] = useState<string>('');
  const [openPriceManagerPin, setOpenPriceManagerPin] = useState<string>('');
  const [openPriceError, setOpenPriceError] = useState<string>('');
  const [taxGroupsLibrary, setTaxGroupsLibrary] = useState<LibraryTaxGroup[]>([]);
  const [printerGroupsLibrary, setPrinterGroupsLibrary] = useState<LibraryPrinterGroup[]>([]);
  const [selectedTaxGroupId, setSelectedTaxGroupId] = useState<number | null>(null);
  const [selectedPrinterGroupId, setSelectedPrinterGroupId] = useState<number | null>(null);
  const openPriceNameInputRef = useRef<HTMLInputElement | null>(null);
  const openPriceAmountInputRef = useRef<HTMLInputElement | null>(null);
  const openPriceNoteInputRef = useRef<HTMLInputElement | null>(null);

  // Open Price Settings 상태
  const [openPriceSettings, setOpenPriceSettings] = useState({
    defaultTaxGroupId: null as number | null,
    defaultPrinterGroupId: null as number | null
  });

  // Open Price Settings 로드 함수
  const loadOpenPriceSettings = async () => {
    try {
      const response = await fetch(`${API_URL}/open-price/settings`);
      if (response.ok) {
        const data = await response.json();
        setOpenPriceSettings(data);
        console.log('Loaded Open Price Settings:', data);
      }
    } catch (error) {
      console.error('Failed to load Open Price settings:', error);
    }
  };

  // Auto focus Item Name when modal opens
  useEffect(() => {
    if (showOpenPriceModal && openPriceNameInputRef.current) {
      // 약간의 지연 후 포커스/키보드 표시로 충돌 방지
      setTimeout(() => {
        openPriceNameInputRef.current && openPriceNameInputRef.current.focus();
      }, 120);
      // Open Price Settings 로드
      loadOpenPriceSettings();
    }
  }, [showOpenPriceModal]);

  // 모달이 닫힐 때 소프트 키보드도 닫기
  useEffect(() => {
    if (!showOpenPriceModal) {
      try { setSoftKbTarget(null); } catch {}
    }
  }, [showOpenPriceModal]);

  // (Removed) Auto-show soft keyboard on modal open. Keyboard appears only via keyboard icons.

  // 저장된 기본값 주입을 비활성화하여, 아래 최소/최대 자동 선택 로직을 사용합니다.

  useEffect(() => {
    const fetchLibrary = async () => {
      try {
        if (!menuId) return; // wait until menuId is available
        const mid = `?menu_id=${encodeURIComponent(menuId)}`;
        const res = await fetch(`${API_URL}/open-price/library${mid}`);
        const data = await res.json();
        setTaxGroupsLibrary(data?.tax_groups || []);
        const uniq = Array.isArray(data?.printer_groups)
          ? Object.values(
              (data.printer_groups as LibraryPrinterGroup[]).reduce((acc: any, g: any) => {
                const key = Number(g.printer_group_id);
                if (!acc[key]) acc[key] = g;
                return acc;
              }, {})
            )
          : [];
        setPrinterGroupsLibrary(uniq as LibraryPrinterGroup[]);
      } catch (e) {
        console.error('Failed to load options library:', e);
      }
    };
    fetchLibrary();
  }, [menuId]);

  

  // Open Price 제출 핸들러
  const handleSubmitOpenPrice = async () => {
    try {
      const name = (openPriceName || '').trim();
      const amount = parseFloat(openPriceAmount || '0');
      const note = (openPriceNote || '').trim();
      if (!name) {
        setOpenPriceError('Please enter a name.');
        return;
      }
      if (!(amount > 0)) {
        setOpenPriceError('Please enter an amount greater than 0.');
        return;
      }

      // 서버 스냅샷 기록 (승인/노트 정책은 서버가 검증)
      try {
        const res = await fetch(`${API_URL}/open-price/line`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            order_id: savedOrderIdRef?.current || null,
            menu_id: null,
            name_label: name,
            amount,
            note: note || null,
            tax_group_id: selectedTaxGroupId ?? null,
            printer_group_id: selectedPrinterGroupId ?? null,
            entered_by_user_id: null,
            approved_by_user_id: null,
            manager_pin: (openPriceManagerPin || '').trim() || null
          })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({} as any));
          setOpenPriceError(err?.error || 'Server save failed');
          return;
        }
      } catch (e) {
        setOpenPriceError('Network error');
        return;
      }

      // 프론트 주문행 추가 (Open Price의 Note는 Item Memo 스타일로 표시)
      setOrderItems(prev => {
        const newItem: OrderItem = {
          id: `openprice-${Date.now()}`,
          name,
          quantity: 1,
          price: amount,
          totalPrice: amount,
          priceSource: 'open',
          memo: note ? { text: note, price: 0 } as any : null,
          taxGroupId: selectedTaxGroupId ?? null,
          printerGroupId: selectedPrinterGroupId ?? null,
          type: 'item',
          guestNumber: activeGuestNumber
        };
        return [...prev, newItem];
      });

      // 모달 닫기 및 초기화
      setShowOpenPriceModal(false);
      setOpenPriceName('Open Charge');
      setOpenPriceAmount('');
      setOpenPriceNote('');
      setOpenPriceManagerPin('');
      setOpenPriceError('');
    } catch (e) {
      setOpenPriceError('An error occurred during processing.');
    }
  };
  
  // 실제 메뉴 데이터 상태
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);

  useEffect(() => {
    if (!hasDisplayedMenuData && categories.length > 0 && menuItems.length > 0) {
      setHasDisplayedMenuData(true);
    }
  }, [categories, menuItems, hasDisplayedMenuData]);

  useEffect(() => {
    if (hasDisplayedMenuData && !layoutLockReady) {
      setLayoutLockReady(true);
      try { sessionStorage.setItem('orderLayoutLocked', '1'); } catch {}
    }
  }, [hasDisplayedMenuData, layoutLockReady]);

  useEffect(() => {
    if (!layoutLockReady) return;
    try {
      const serialized = JSON.stringify(layoutSettings);
      if (lastSavedLayoutSnapshotRef.current === serialized) return;
      sessionStorage.setItem(LAYOUT_SETTINGS_SNAPSHOT_KEY, serialized);
      lastSavedLayoutSnapshotRef.current = serialized;
    } catch {
      // ignore storage saturation
    }
  }, [layoutLockReady, layoutSettings]);

  useEffect(() => {
    if (hasDisplayedMenuData && !layoutLockReady) {
      setLayoutLockReady(true);
      try { sessionStorage.setItem('orderLayoutLocked', '1'); } catch {}
    }
  }, [hasDisplayedMenuData, layoutLockReady]);
  // 모디파이어 로딩/매칭 경고 메시지

  // 모디파이어 관련 상태
  const [selectedItemModifiers, setSelectedItemModifiers] = useState<any[]>([]);
  const [modifierGroups, setModifierGroups] = useState<any[]>([]);
  const [modifiers, setModifiers] = useState<any[]>([]);
  const [isLoadingModifiers, setIsLoadingModifiers] = useState(false);
  const [selectedModifiers, setSelectedModifiers] = useState<{[key: string]: string[]}>({});

  // 선택된 메뉴 아이템 상태
  const [selectedMenuItemId, setSelectedMenuItemId] = useState<string | null>(null);
  // 주문목록에서 선택한 라인(중간 아이템) 모디파이어 편집 타겟
  const [modifierEditTargetLineId, setModifierEditTargetLineId] = useState<string | null>(null);
  const [modifierEditTargetRowIndex, setModifierEditTargetRowIndex] = useState<number | null>(null);
  const pendingModifierJumpRef = useRef<null | { itemId: string; categoryName: string; selected: { [key: string]: string[] } }>(null);
  // 모디파이어 커스텀 배치: itemId -> 배열(슬롯에 배치된 modifierId들), 빈 슬롯은 'EMPTY:idx'
  // DB(layoutSettings)에서 초기값을 로드하고, localStorage는 fallback
  const modifierLayoutByItem = hookModifierLayout;
  const setModifierLayoutByItem = hookSetModifierLayout;

  // modifierLayoutByItem 변경 시 서버에 저장 (debounce)
  const modLayoutSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const modLayoutAutoSaveRef = useRef(modifierLayoutByItem);
  modLayoutAutoSaveRef.current = modifierLayoutByItem;

  const saveModifierLayoutDirect = useCallback(async (layout: Record<string, string[]>) => {
    try {
      const res = await fetch(`${API_URL}/layout-settings`);
      if (!res.ok) return;
      const result = await res.json();
      const existing = result?.data || {};
      const payload = { ...existing, modifierLayoutByItem: layout };
      await fetch(`${API_URL}/layout-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {}
  }, []);

  useEffect(() => {
    if (!modifierLayoutLoaded) return;
    if (Object.keys(modifierLayoutByItem).length === 0) return;
    if (modLayoutSaveTimeoutRef.current) {
      clearTimeout(modLayoutSaveTimeoutRef.current);
    }
    modLayoutSaveTimeoutRef.current = setTimeout(() => {
      saveModifierLayoutDirect(modLayoutAutoSaveRef.current);
    }, 800);
    return () => {
      if (modLayoutSaveTimeoutRef.current) {
        clearTimeout(modLayoutSaveTimeoutRef.current);
      }
    };
  }, [modifierLayoutByItem, modifierLayoutLoaded, saveModifierLayoutDirect]);

  // 레이아웃 매니저 탭 접기/펼침 상태
  const [panelWidthExpanded, setPanelWidthExpanded] = useState(true);
  const [categoryTabExpanded, setCategoryTabExpanded] = useState(false);
  const [menuTabExpanded, setMenuTabExpanded] = useState(false);
  const [modifierTabExpanded, setModifierTabExpanded] = useState(false);
  const [bagFeeTabExpanded, setBagFeeTabExpanded] = useState(false);
  const [functionTabExpanded, setFunctionTabExpanded] = useState(false);
  const [keyboardLangSelect, setKeyboardLangSelect] = useState<string>('');
  const bottomBarRef = useRef<HTMLDivElement | null>(null);
  const [kbBottomOffset, setKbBottomOffset] = useState<number>(0);
  const [kbLang, setKbLang] = useState<string | undefined>(undefined);
  useEffect(() => {
    const measure = () => {
      try {
        const h = bottomBarRef.current ? bottomBarRef.current.getBoundingClientRect().height : 0;
        setKbBottomOffset(Math.max(0, Math.round(h)));
      } catch {}
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Focus active input when soft keyboard target changes (ensures blue ring and blinking caret)
  useEffect(() => {
    const focusAndSelectEnd = (el?: HTMLInputElement | HTMLTextAreaElement | null) => {
      if (!el) return;
      try {
        el.focus();
        const length = typeof el.value === 'string' ? el.value.length : 0;
        if (typeof el.setSelectionRange === 'function') {
          el.setSelectionRange(length, length);
        }
      } catch {}
    };

    try {
      if (softKbTarget === 'name') focusAndSelectEnd(openPriceNameInputRef.current);
      if (softKbTarget === 'note') focusAndSelectEnd(openPriceNoteInputRef.current);
      if (softKbTarget === 'openPriceAmount') focusAndSelectEnd(openPriceAmountInputRef.current);
      if (softKbTarget === 'memo') focusAndSelectEnd(memoInputRef.current);
      if (softKbTarget === 'memoPrice') focusAndSelectEnd(memoPriceInputRef.current);
      if (softKbTarget === 'customDiscount') focusAndSelectEnd(customDiscountInputRef.current);
      if (softKbTarget === 'voidNote') focusAndSelectEnd(voidNoteInputRef.current);
      if (softKbTarget === 'editPrice') focusAndSelectEnd(editPriceInputRef.current);
    } catch {}
  }, [softKbTarget]);

  // Initialize selected keyboard language from Function Tab's configured languages when keyboard opens
  useEffect(() => {
    try {
      if (softKbTarget) {
        const langs = ((((layoutSettings as any).keyboardLanguages || []) as string[]) || []);
        if (!kbLang && langs.length > 0) {
          setKbLang(String(langs[0] || 'EN').toUpperCase());
        } else if (kbLang && langs.length > 0) {
          const list = langs.map((c: string) => (c || '').toUpperCase());
          if (!list.includes(String(kbLang).toUpperCase())) {
            setKbLang(String(langs[0] || 'EN').toUpperCase());
          }
        }
      }
    } catch {}
  }, [softKbTarget, layoutSettings, kbLang]);
  const [showManagerPinModal, setShowManagerPinModal] = useState(false);
  const [pendingVoid, setPendingVoid] = useState<{ amount: number } | null>(null);

  // Open Price 선택 옵션 상태 (compact tiles UI용)
  const [taxGroupOptions, setTaxGroupOptions] = useState<Array<{ id: number; name: string; totalRate: number }>>([]);
  const [printerGroupOptions, setPrinterGroupOptions] = useState<Array<{ id: number; name: string; count: number }>>([]);

  // 모달 열릴 때: Tax 옵션 구성 + 기본값(최소 세율 그룹) 자동 선택
  useEffect(() => {
    if (!showOpenPriceModal) return;
    try {
      const opts = Array.isArray(menuTaxes)
        ? menuTaxes.map((g: any) => {
            const totalRate = Array.isArray(g.taxes)
              ? g.taxes.reduce((s: number, t: any) => s + (Number(t.rate) || 0), 0)
              : 0;
            return { id: Number(g.id), name: String(g.name || ''), totalRate };
          })
        : [];
      setTaxGroupOptions(opts);
      if (selectedTaxGroupId == null && opts.length > 0) {
        const minRate = Math.min(...opts.map(o => o.totalRate));
        const def = opts.find(o => o.totalRate === minRate);
        if (def) setSelectedTaxGroupId(def.id);
      }
    } catch {}
  }, [showOpenPriceModal, menuTaxes, selectedTaxGroupId]);

  // 모달 열릴 때: Printer 그룹 목록(+프린터 수) 로드 + 기본값(가장 많은 프린터 포함 그룹) 자동 선택
  useEffect(() => {
    if (!showOpenPriceModal || !menuId) return;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/printers/groups?menu_id=${encodeURIComponent(String(menuId))}`);
        if (!res.ok) return;
        const rows = await res.json();
        const opts = Array.isArray(rows)
          ? rows.map((r: any) => ({ id: Number(r.group_id || r.id), name: String(r.name || ''), count: Array.isArray(r.printers) ? r.printers.length : 0 }))
          : [];
        setPrinterGroupOptions(opts);
        if (selectedPrinterGroupId == null && opts.length > 0) {
          const maxCount = Math.max(...opts.map(o => o.count));
          const def = opts.find(o => o.count === maxCount);
          if (def) setSelectedPrinterGroupId(def.id);
        }
      } catch {}
    })();
  }, [showOpenPriceModal, menuId, selectedPrinterGroupId]);

  // Item-level TOGO label button (Dine-in only, separate from orderType TOGO)
  const [itemTogoEnabled, setItemTogoEnabled] = useState(() => {
    try { return localStorage.getItem('item_togo_enabled') === '1'; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem('item_togo_enabled', itemTogoEnabled ? '1' : '0'); } catch {} }, [itemTogoEnabled]);
  const lastAddedItemIdRef = React.useRef<string | null>(null);

  // Table-only Bag Fee UI states
  const [tableBagFeeEnabled, setTableBagFeeEnabled] = useState(() => {
    try { return localStorage.getItem('table_bag_fee_enabled') === '1'; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem('table_bag_fee_enabled', tableBagFeeEnabled ? '1' : '0'); } catch {} }, [tableBagFeeEnabled]);
  const [tableBagFeeValue, setTableBagFeeValue] = useState(() => {
    try { const v = Number(localStorage.getItem('table_bag_fee_value') || '0'); return isNaN(v) ? 0 : v; } catch { return 0; }
  });
  useEffect(() => { try { localStorage.setItem('table_bag_fee_value', String(tableBagFeeValue)); } catch {} }, [tableBagFeeValue]);
  const [bagFeeColor, setBagFeeColor] = useState<string>(() => {
    try { return localStorage.getItem('table_bag_fee_color') || 'bg-blue-600'; } catch { return 'bg-blue-600'; }
  });
  useEffect(() => { try { localStorage.setItem('table_bag_fee_color', bagFeeColor); } catch {} }, [bagFeeColor]);
  const [bagFeeTaxGroupId, setBagFeeTaxGroupId] = useState<number | ''>(() => {
    try { const v = localStorage.getItem('bag_fee_tax_group_id'); return v ? Number(v) : ''; } catch { return ''; }
  });
  useEffect(() => { try { if (bagFeeTaxGroupId === '') localStorage.removeItem('bag_fee_tax_group_id'); else localStorage.setItem('bag_fee_tax_group_id', String(bagFeeTaxGroupId)); } catch {} }, [bagFeeTaxGroupId]);
  const [bagFeePrinterGroupId, setBagFeePrinterGroupId] = useState<string | ''>(() => {
    try { return localStorage.getItem('bag_fee_printer_group_id') || ''; } catch { return ''; }
  });
  useEffect(() => { try { if (!bagFeePrinterGroupId) localStorage.removeItem('bag_fee_printer_group_id'); else localStorage.setItem('bag_fee_printer_group_id', String(bagFeePrinterGroupId)); } catch {} }, [bagFeePrinterGroupId]);
  const [showBagFeeColorModal, setShowBagFeeColorModal] = useState(false);
  // Item Extra Buttons Settings Modals
  const [showItemExtra1SettingsModal, setShowItemExtra1SettingsModal] = useState(false);
  const [showItemExtra2SettingsModal, setShowItemExtra2SettingsModal] = useState(false);
  const [showItemExtra3SettingsModal, setShowItemExtra3SettingsModal] = useState(false);
  const BAG_FEE_ID = '__BAG_FEE__';
  const BAG_FEE_ITEM_ID = '__BAG_FEE_ITEM__';
const SERVICE_CHARGE_ITEM_ID = '__SERVICE_CHARGE__';
  const [bagFeeButtonName, setBagFeeButtonName] = useState<string>(() => {
    try { return localStorage.getItem('bag_fee_button_name') || 'Bag Fee'; } catch { return 'Bag Fee'; }
  });
  useEffect(() => { try { localStorage.setItem('bag_fee_button_name', bagFeeButtonName); } catch {} }, [bagFeeButtonName]);
  // Second extra menu button (left of last cell) states
  const [extra2Enabled, setExtra2Enabled] = useState<boolean>(() => {
    try { return (localStorage.getItem('extra2_enabled') || '0') === '1'; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem('extra2_enabled', extra2Enabled ? '1' : '0'); } catch {} }, [extra2Enabled]);
  const [extra2Name, setExtra2Name] = useState<string>(() => {
    try { return localStorage.getItem('extra2_name') || 'Extra'; } catch { return 'Extra'; }
  });
  useEffect(() => { try { localStorage.setItem('extra2_name', extra2Name); } catch {} }, [extra2Name]);
  const [extra2Amount, setExtra2Amount] = useState<number>(() => {
    try { const v = Number(localStorage.getItem('extra2_amount') || '0'); return isNaN(v) ? 0 : v; } catch { return 0; }
  });
  useEffect(() => { try { localStorage.setItem('extra2_amount', String(extra2Amount)); } catch {} }, [extra2Amount]);
  const [extra2Color, setExtra2Color] = useState<string>(() => {
    try { return localStorage.getItem('extra2_color') || 'bg-blue-700'; } catch { return 'bg-blue-700'; }
  });
  useEffect(() => { try { localStorage.setItem('extra2_color', extra2Color); } catch {} }, [extra2Color]);
  const [extra2TaxGroupId, setExtra2TaxGroupId] = useState<number | ''>(() => {
    try { const v = localStorage.getItem('extra2_tax_group'); return v ? Number(v) : ''; } catch { return ''; }
  });
  useEffect(() => { try { if (extra2TaxGroupId==='') localStorage.removeItem('extra2_tax_group'); else localStorage.setItem('extra2_tax_group', String(extra2TaxGroupId)); } catch {} }, [extra2TaxGroupId]);
  const [extra2PrinterGroupId, setExtra2PrinterGroupId] = useState<string | ''>(() => {
    try { return localStorage.getItem('extra2_printer_group') || ''; } catch { return ''; }
  });
  useEffect(() => { try { if (!extra2PrinterGroupId) localStorage.removeItem('extra2_printer_group'); else localStorage.setItem('extra2_printer_group', String(extra2PrinterGroupId)); } catch {} }, [extra2PrinterGroupId]);
  const [bagFeeSlotIndex, setBagFeeSlotIndex] = useState<number>(() => {
    try { const v = localStorage.getItem('bag_fee_slot_index'); return v ? Number(v) : 0; } catch { return 0; }
  });
  useEffect(() => { try { localStorage.setItem('bag_fee_slot_index', String(bagFeeSlotIndex)); } catch {} }, [bagFeeSlotIndex]);
  const [showExtra2ColorModal, setShowExtra2ColorModal] = useState(false);
// Extra 3 (extra2와 동일한 형태)
const [extra3Enabled, setExtra3Enabled] = useState<boolean>(() => {
  try { return (localStorage.getItem('extra3_enabled') || '0') === '1'; } catch { return false; }
});
useEffect(() => { try { localStorage.setItem('extra3_enabled', extra3Enabled ? '1' : '0'); } catch {} }, [extra3Enabled]);

const [extra3Name, setExtra3Name] = useState<string>(() => {
  try { return localStorage.getItem('extra3_name') || 'Extra 3'; } catch { return 'Extra 3'; }
});
useEffect(() => { try { localStorage.setItem('extra3_name', extra3Name); } catch {} }, [extra3Name]);

const [extra3Amount, setExtra3Amount] = useState<number>(() => {
  try { const v = Number(localStorage.getItem('extra3_amount') || '0'); return isNaN(v) ? 0 : v; } catch { return 0; }
});
useEffect(() => { try { localStorage.setItem('extra3_amount', String(extra3Amount)); } catch {} }, [extra3Amount]);

const [extra3Color, setExtra3Color] = useState<string>(() => {
  try { return localStorage.getItem('extra3_color') || 'bg-teal-700'; } catch { return 'bg-teal-700'; }
});
useEffect(() => { try { localStorage.setItem('extra3_color', extra3Color); } catch {} }, [extra3Color]);

const [extra3TaxGroupId, setExtra3TaxGroupId] = useState<number | ''>(() => {
  try { const v = localStorage.getItem('extra3_tax_group'); return v ? Number(v) : ''; } catch { return ''; }
});
useEffect(() => { try { if (extra3TaxGroupId==='') localStorage.removeItem('extra3_tax_group'); else localStorage.setItem('extra3_tax_group', String(extra3TaxGroupId)); } catch {} }, [extra3TaxGroupId]);

const [extra3PrinterGroupId, setExtra3PrinterGroupId] = useState<string | ''>(() => {
  try { return localStorage.getItem('extra3_printer_group') || ''; } catch { return ''; }
});
useEffect(() => { try { if (!extra3PrinterGroupId) localStorage.removeItem('extra3_printer_group'); else localStorage.setItem('extra3_printer_group', String(extra3PrinterGroupId)); } catch {} }, [extra3PrinterGroupId]);
const [showExtra3ColorModal, setShowExtra3ColorModal] = useState(false);
  // Modifier Extra Buttons Color Modals
  const [showModExtra1ColorModal, setShowModExtra1ColorModal] = useState(false);
  const [showModExtra2ColorModal, setShowModExtra2ColorModal] = useState(false);

  // Modifier Extra Buttons Settings Modals (2개)
  const [showModifierExtra1SettingsModal, setShowModifierExtra1SettingsModal] = useState(false);
  const [showModifierExtra2SettingsModal, setShowModifierExtra2SettingsModal] = useState(false);
  // Modifier Extra Buttons Selection Popups (세일즈 페이지에서 사용)
  const [showModExtra1Popup, setShowModExtra1Popup] = useState(false);
  const [showModExtra2Popup, setShowModExtra2Popup] = useState(false);
  
  // Modifier Extra Button 1 Tabs & Grid Data
  type ModExtraButton = { name: string; amount: number; color: string; enabled: boolean };
  type ModExtraGroup = { id: string; name: string; color: string; buttons: ModExtraButton[] };
  type ModExtraTab = { id: string; name: string; defaultColor: string; groups: ModExtraGroup[]; gridCols: number };
  const defaultModExtraGroup = (name: string = 'New Group', color: string = 'bg-indigo-600'): ModExtraGroup => ({
    id: `group${Date.now()}${Math.random().toString(36).substr(2, 5)}`,
    name,
    color,
    buttons: []
  });
  const defaultModExtraButton = (color: string = 'bg-gray-600'): ModExtraButton => ({ name: '', amount: 0, color, enabled: true });
  
  const [modExtra1Tabs, setModExtra1Tabs] = useState<ModExtraTab[]>(() => {
    try {
      const saved = localStorage.getItem('mod_extra1_tabs_v2');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Sanitize: ensure all buttons have a color property
          return parsed.map((tab: ModExtraTab) => ({
            ...tab,
            defaultColor: tab.defaultColor || 'bg-indigo-600',
            groups: (tab.groups || []).map((group: ModExtraGroup) => ({
              ...group,
              color: group.color || 'bg-indigo-600',
              buttons: (group.buttons || []).map((btn: ModExtraButton) => ({
                ...btn,
                color: btn.color || group.color || 'bg-indigo-600',
                enabled: btn.enabled !== false
              }))
            }))
          }));
        }
      }
    } catch {}
    return [{ id: 'tab1', name: 'Tab 1', defaultColor: 'bg-indigo-600', groups: [defaultModExtraGroup('Add'), defaultModExtraGroup('No'), defaultModExtraGroup('Extra')], gridCols: 6 }];
  });
  useEffect(() => { try { localStorage.setItem('mod_extra1_tabs_v2', JSON.stringify(modExtra1Tabs)); } catch {} }, [modExtra1Tabs]);
  const [modExtra1ActiveTabId, setModExtra1ActiveTabId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('mod_extra1_tabs');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed[0].id;
      }
    } catch {}
    return 'tab1';
  });
  const [modExtra1SelectedGroup, setModExtra1SelectedGroup] = useState<string | null>(null);
  const [modExtra1SelectedBtn, setModExtra1SelectedBtn] = useState<number | null>(null);
  const [modExtra1DeleteConfirm, setModExtra1DeleteConfirm] = useState<{ groupId: string; groupName: string } | null>(null);
  const [modExtra1Name, setModExtra1Name] = useState<string>(() => localStorage.getItem('mod_extra1_name') || 'Modifier Extra 1');
  useEffect(() => { localStorage.setItem('mod_extra1_name', modExtra1Name); }, [modExtra1Name]);

  // Modifier Extra Button 2 Tabs & Grid Data
  const [modExtra2Tabs, setModExtra2Tabs] = useState<ModExtraTab[]>(() => {
    try {
      const saved = localStorage.getItem('mod_extra2_tabs_v2');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Sanitize: ensure all buttons have a color property
          return parsed.map((tab: ModExtraTab) => ({
            ...tab,
            defaultColor: tab.defaultColor || 'bg-emerald-600',
            groups: (tab.groups || []).map((group: ModExtraGroup) => ({
              ...group,
              color: group.color || 'bg-emerald-600',
              buttons: (group.buttons || []).map((btn: ModExtraButton) => ({
                ...btn,
                color: btn.color || group.color || 'bg-emerald-600',
                enabled: btn.enabled !== false
              }))
            }))
          }));
        }
      }
    } catch {}
    return [{ id: 'tab1', name: 'Tab 1', defaultColor: 'bg-emerald-600', groups: [defaultModExtraGroup('Add'), defaultModExtraGroup('No'), defaultModExtraGroup('Extra')], gridCols: 6 }];
  });
  useEffect(() => { try { localStorage.setItem('mod_extra2_tabs_v2', JSON.stringify(modExtra2Tabs)); } catch {} }, [modExtra2Tabs]);
  const [modExtra2ActiveTabId, setModExtra2ActiveTabId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('mod_extra2_tabs');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed[0].id;
      }
    } catch {}
    return 'tab1';
  });
  const [modExtra2SelectedGroup, setModExtra2SelectedGroup] = useState<string | null>(null);
  const [modExtra2SelectedBtn, setModExtra2SelectedBtn] = useState<number | null>(null);
  const [modExtra2DeleteConfirm, setModExtra2DeleteConfirm] = useState<{ groupId: string; groupName: string } | null>(null);
  const [modExtra2Name, setModExtra2Name] = useState<string>(() => localStorage.getItem('mod_extra2_name') || 'Modifier Extra 2');
  useEffect(() => { localStorage.setItem('mod_extra2_name', modExtra2Name); }, [modExtra2Name]);

  // Modifier Extra Buttons (for Modifier Panel bottom-right)
  const [modExtra1Enabled, setModExtra1Enabled] = useState<boolean>(() => { try { return (localStorage.getItem('mod_extra1_enabled') || '0') === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('mod_extra1_enabled', modExtra1Enabled ? '1' : '0'); } catch {} }, [modExtra1Enabled]);
  const [modExtra1Amount, setModExtra1Amount] = useState<number>(() => { try { const v = Number(localStorage.getItem('mod_extra1_amount') || '0'); return isNaN(v) ? 0 : v; } catch { return 0; } });
  useEffect(() => { try { localStorage.setItem('mod_extra1_amount', String(modExtra1Amount)); } catch {} }, [modExtra1Amount]);
  const [modExtra1Color, setModExtra1Color] = useState<string>(() => { try { return localStorage.getItem('mod_extra1_color') || 'bg-indigo-700'; } catch { return 'bg-indigo-700'; } });
  useEffect(() => { try { localStorage.setItem('mod_extra1_color', modExtra1Color); } catch {} }, [modExtra1Color]);

  const [modExtra2Enabled, setModExtra2Enabled] = useState<boolean>(() => { try { return (localStorage.getItem('mod_extra2_enabled') || '0') === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('mod_extra2_enabled', modExtra2Enabled ? '1' : '0'); } catch {} }, [modExtra2Enabled]);
  const [modExtra2Amount, setModExtra2Amount] = useState<number>(() => { try { const v = Number(localStorage.getItem('mod_extra2_amount') || '0'); return isNaN(v) ? 0 : v; } catch { return 0; } });
  useEffect(() => { try { localStorage.setItem('mod_extra2_amount', String(modExtra2Amount)); } catch {} }, [modExtra2Amount]);
  const [modExtra2Color, setModExtra2Color] = useState<string>(() => { try { return localStorage.getItem('mod_extra2_color') || 'bg-emerald-700'; } catch { return 'bg-emerald-700'; } });
  useEffect(() => { try { localStorage.setItem('mod_extra2_color', modExtra2Color); } catch {} }, [modExtra2Color]);


  const [togoExpandedCats, setTogoExpandedCats] = useState<Set<string>>(() => new Set());

  // Auto-load TOGO settings and Firebase promotions when entering TOGO channel
  useEffect(() => {
    const ch = (orderType || '').toLowerCase();
    if (ch !== 'togo') return;
    const load = async () => {
      // Load TOGO channel settings
      try {
        const res = await fetch(`${API_URL}/admin-settings/channel-settings/TOGO`);
        if (res.ok) {
          const json = await res.json();
          const s = json && json.settings ? json.settings : null;
          if (s) {
            setTogoSettings(prev => ({
              discountEnabled: !!((s.discount_enabled ?? (prev.discountEnabled ? 1 : 0))),
              discountMode: String((s.discount_mode ?? (prev.discountMode || 'percent'))) as any,
              discountValue: Number((s.discount_value ?? (prev.discountValue || 0))),
              bagFeeEnabled: !!((s.bag_fee_enabled ?? (prev.bagFeeEnabled ? 1 : 0))),
              bagFeeValue: Number((s.bag_fee_value ?? (prev.bagFeeValue || 0))),
              bagFeeTaxable: !!((s.bag_fee_taxable ?? (prev.bagFeeTaxable ? 1 : 0))),
            }));
          }
        }
      } catch {}
      
      // Load promotions from POS database for Togo
      try {
        const promoRes = await fetch(`${API_URL}/promotions/pos-promotions`);
        if (promoRes.ok) {
          const promoData = await promoRes.json();
          console.log('🎁 All POS promotions:', promoData.promotions?.length, promoData.promotions?.map((p: any) => ({ name: p.name, channels: p.channels, active: p.active })));
          
          // Check for various Togo channel names (togo, takeout, pick-up, pickup)
          const togoChannelNames = ['togo', 'takeout', 'pick-up', 'pickup', 'to-go'];
          const togoPromos = (promoData.promotions || []).filter(
            (p: any) => p.active && p.channels?.some((ch: string) => togoChannelNames.includes(ch.toLowerCase()))
          );
          // Convert to FirebasePromotion format for compatibility
          const convertedPromos: FirebasePromotion[] = togoPromos.map((p: any) => ({
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
          setTogoFirebasePromotions(convertedPromos);
          console.log('🎁 Togo POS promotions loaded:', convertedPromos.length, convertedPromos.map(p => p.name));
        }
      } catch (e) {
        console.warn('Failed to load Togo POS promotions:', e);
      }
    };
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderType]);

  // Load POS promotions for Dine-in orders (on component mount)
  useEffect(() => {
    const loadDineInPromotions = async () => {
      try {
        console.log('🎁 [DINE-IN PROMO] Loading POS promotions...');
        const promoRes = await fetch(`${API_URL}/promotions/pos-promotions`);
        if (promoRes.ok) {
          const promoData = await promoRes.json();
          console.log('🎁 [DINE-IN PROMO] All POS promotions:', promoData.promotions?.length, promoData.promotions?.map((p: any) => ({ name: p.name, channels: p.channels, active: p.active })));
          
          // Filter promotions for dine-in channel
          const dineInChannelNames = ['dine-in', 'table', 'dinein'];
          const dineInPromos = (promoData.promotions || []).filter(
            (p: any) => {
              const hasChannel = p.channels?.some((c: string) => dineInChannelNames.includes(c.toLowerCase()));
              console.log(`🎁 [DINE-IN PROMO] Checking "${p.name}": active=${p.active}, channels=${JSON.stringify(p.channels)}, hasChannel=${hasChannel}`);
              return p.active && hasChannel;
            }
          );
          
          // Convert to FirebasePromotion format
          const convertedPromos: FirebasePromotion[] = dineInPromos.map((p: any) => ({
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
          setDineInPromotions(convertedPromos);
          console.log('🎁 [DINE-IN PROMO] Final filtered promotions:', convertedPromos.length, convertedPromos.map(p => p.name));
        } else {
          console.warn('🎁 [DINE-IN PROMO] Failed to fetch, status:', promoRes.status);
        }
      } catch (e) {
        console.warn('🎁 [DINE-IN PROMO] Error loading promotions:', e);
      }
    };
    loadDineInPromotions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 모디파이어 선택 처리
  const handleModifierSelection = (groupId: string, modifierId: string, selectionType: string) => {
    console.log('Modifier selection:', { groupId, modifierId, selectionType });
    
    const groupExistsInPanel = selectedItemModifiers.some(gl => String(gl.modifier_group_id) === String(groupId));
    if (!groupExistsInPanel) {
      console.warn('Ignored selection for non-present group:', groupId);
      return;
    }
    
    let newSelectedModifiers = { ...selectedModifiers };
    
    if (selectionType === 'SINGLE') {
      newSelectedModifiers[groupId] = [modifierId];
    } else {
      if (!newSelectedModifiers[groupId]) {
        newSelectedModifiers[groupId] = [];
      }
      const modifierGroup = modifierGroups.find(g => g.id?.toString() === groupId);
      if (modifierGroup && modifierGroup.max_selections === 1) {
        newSelectedModifiers[groupId] = [modifierId];
      } else {
        const cur = Array.isArray(newSelectedModifiers[groupId]) ? [...newSelectedModifiers[groupId]] : [];
        const maxSel = Number((modifierGroup as any)?.max_selections ?? (modifierGroup as any)?.max_selection ?? 0);
        const distinctCount = new Set(cur).size;
        const alreadySelected = cur.includes(modifierId);
        // Multi-select: clicking again increases count (duplicates mean 2x/3x...)
        // If max selections is set, enforce it by distinct options (but still allow increasing an already selected modifier).
        if (!alreadySelected && Number.isFinite(maxSel) && maxSel > 0 && distinctCount >= maxSel) {
          // ignore
        } else {
          cur.push(modifierId);
        }
        newSelectedModifiers[groupId] = cur;
      }
    }
    
    console.log('Updated selected modifiers:', newSelectedModifiers);
    setSelectedModifiers(newSelectedModifiers);
    
    // 부모 메뉴 아이템에 모디파이어를 종속시켜 업데이트
    if (selectedMenuItemId) {
      const selectedItem = menuItems.find(item => item.id === selectedMenuItemId);
      if (selectedItem) {
        updateOrderItemWithModifiersImmediate(selectedItem, newSelectedModifiers);
      }
    }
  };

  // 선택된 모디파이어의 총 가격 변동 계산
  // const getModifierPriceDelta = () => {
  //   let totalDelta = 0;
  //   Object.values(selectedModifiers).forEach(modifierIds => {
  //     modifierIds.forEach(modifierId => {
  //       const modifier = modifiers.find(m => 
  //         (m.option_id?.toString() === modifierId) || 
  //         (m.modifier_id?.toString() === modifierId) || 
  //         (m.id?.toString() === modifierId)
  //       );
  //       if (modifier) {
  //         const priceChange = modifier.price_adjustment || modifier.price_delta || 0;
  //         totalDelta += priceChange;
  //       }
  //     });
  //   });
  //   return totalDelta;
  // };

  // 선택된 메뉴 아이템의 모디파이어를 가져오는 함수
  const fetchItemModifiers = async (itemId: string) => {
    if (!menuId) {
      console.log('No menuId available');
      return;
    }
    
    try {
      setIsLoadingModifiers(true);
      console.log('Fetching modifiers for item (composed):', itemId, 'menu:', menuId);

      // 1) 현재 아이템의 category_id 찾기
      const itemObj = menuItems.find(mi => mi.id === itemId);
      if (!itemObj || !itemObj.category_id) {
        console.warn('Item not found or missing category_id for item:', itemId);
        setSelectedItemModifiers([]);
        return;
      }
      const categoryId = itemObj.category_id;

      // 2) 병렬로 데이터 수집
      const [itemsResp, catModsResp, allGroupsResp] = await Promise.all([
        fetch(`${API_URL}/menu/items?categoryId=${categoryId}`),
        fetch(`${API_URL}/menu/categories/${categoryId}/modifiers`),
        fetch(`${API_URL}/modifier-groups`)
      ]);

      if (!itemsResp.ok) throw new Error(`Failed items query: ${itemsResp.status}`);
      if (!catModsResp.ok) throw new Error(`Failed category modifiers query: ${catModsResp.status}`);
      if (!allGroupsResp.ok) throw new Error(`Failed modifier groups query: ${allGroupsResp.status}`);

      const itemsData: any[] = await itemsResp.json();
      const catModsData: any[] = await catModsResp.json();
      const allGroupsData: any[] = await allGroupsResp.json();

      // 3) 아이템에 직접 연결된 그룹들 추출
      const itemRow = itemsData.find(r => String(r.item_id || r.id) === String(itemId));
      const directGroupIds: number[] = Array.isArray(itemRow?.modifier_groups) ? itemRow!.modifier_groups.map((n: any) => Number(n)).filter((n: number) => !Number.isNaN(n)) : [];

      // 4) 카테고리 연결 그룹들 추출 (상속)
      const inheritedGroupIds: number[] = Array.isArray(catModsData)
        ? catModsData.map((r: any) => Number(r.modifier_group_id)).filter((n: number) => !Number.isNaN(n))
        : [];

      // 5) 시나리오 2 적용: 아이템에 직접 연결된 모디파이어가 있으면 그것만 표시, 없으면 카테고리 모디파이어만 표시 (병합 X)
      const groupById: { [id: number]: any } = {};
      (allGroupsData || []).forEach((g: any) => { groupById[Number(g.id || g.group_id)] = g; });

      // 직접 연결이 있으면 직접 연결만, 없으면 상속만 사용
      const usedGroupIds: number[] = directGroupIds.length > 0 
        ? directGroupIds 
        : inheritedGroupIds;
      
      console.log('📂 [Item Modifier] Direct:', directGroupIds.length, 'Inherited:', inheritedGroupIds.length, '→ Using:', usedGroupIds.length);

      const processedModifiers = usedGroupIds.map((gid) => {
        const g = groupById[gid];
        if (!g) return null;
        const selection_type = g.selection_type;
        const min_selection = g.min_selection ?? g.min_selections ?? 0;
        const max_selection = g.max_selection ?? g.max_selections ?? 0;
        const options = g.options || g.modifiers || [];
        const mappedOptions = options.map((opt: any) => ({
          modifier_id: opt.modifier_id ?? opt.option_id ?? opt.id,
          name: opt.name,
          price_delta: opt.price_delta ?? opt.price_adjustment ?? 0,
          sort_order: opt.sort_order ?? 0
        }));
        const source = directGroupIds.includes(gid) ? 'direct' : 'inherited';
              return {
          link_id: gid, // UI 정렬용 임시 값
          item_id: itemId,
          modifier_group_id: gid,
          group: { id: gid, name: g.name, selection_type, min_selection, max_selection, is_required: false },
          modifiers: mappedOptions,
          source,
          isActive: 1
        };
      }).filter(Boolean);

      // 전역 라벨/옵션 조회용 상태 업데이트 (주문목록 표시에서 Unknown 방지)
      const normalizedGroups = (processedModifiers as any[]).map(pm => ({ id: pm.modifier_group_id, name: pm.group?.name }));
      const normalizedModifiers = (processedModifiers as any[]).flatMap(pm =>
        pm.modifiers.map((m: any) => ({
          id: m.modifier_id,
          option_id: m.modifier_id,
          modifier_id: m.modifier_id,
          name: m.name,
          price_delta: m.price_delta,
          price_adjustment: m.price_delta,
          sort_order: m.sort_order
        }))
      );
      setModifierGroups(normalizedGroups);
      setModifiers(normalizedModifiers);

      console.log('Processed modifiers (composed):', processedModifiers);
      setSelectedItemModifiers(processedModifiers as any[]);

    } catch (error) {
      console.error('Error composing item modifiers:', error);
      setSelectedItemModifiers([]);
    } finally {
      setIsLoadingModifiers(false);
    }
  };

  /**
   * 카테고리 선택 시 모디파이어 자동 로드 함수
   * - 시나리오 1,2: 카테고리에 모디파이어가 연결된 경우 → 카테고리 모디파이어 표시
   * - 시나리오 3: 카테고리에 모디파이어가 없고 아이템에만 연결된 경우 → 첫 번째 아이템의 모디파이어 표시
   * - 시나리오 4: 모디파이어가 없는 경우 → 빈 패널 표시
   */
  const fetchCategoryModifiers = async (categoryId: number) => {
    try {
      setIsLoadingModifiers(true);
      console.log('📂 [Category Modifier] Fetching modifiers for category:', categoryId);

      // 1) 카테고리에 연결된 모디파이어 그룹 가져오기
      const [catModsResp, allGroupsResp] = await Promise.all([
        fetch(`${API_URL}/menu/categories/${categoryId}/modifiers`),
        fetch(`${API_URL}/modifier-groups`)
      ]);

      if (!catModsResp.ok) {
        console.log('📂 [Category Modifier] No category modifiers found');
        // 카테고리에 모디파이어가 없음 → 시나리오 3 또는 4
        await handleNoCategoryModifiers(categoryId);
        return;
      }

      const catModsData: any[] = await catModsResp.json();
      const allGroupsData: any[] = await allGroupsResp.json();

      // 카테고리에 연결된 그룹 ID 추출
      const categoryGroupIds: number[] = Array.isArray(catModsData)
        ? catModsData.map((r: any) => Number(r.modifier_group_id)).filter((n: number) => !Number.isNaN(n))
        : [];

      if (categoryGroupIds.length === 0) {
        console.log('📂 [Category Modifier] Category has no modifiers → checking items');
        // 카테고리에 모디파이어가 없음 → 시나리오 3 또는 4
        await handleNoCategoryModifiers(categoryId);
        return;
      }

      // 시나리오 1, 2: 카테고리에 모디파이어가 있음
      console.log('📂 [Category Modifier] Category has modifiers:', categoryGroupIds);

      const groupById: { [id: number]: any } = {};
      (allGroupsData || []).forEach((g: any) => { groupById[Number(g.id || g.group_id)] = g; });

      const processedModifiers = categoryGroupIds.map((gid) => {
        const g = groupById[gid];
        if (!g) return null;
        const options = g.options || g.modifiers || [];
        const mappedOptions = options.map((opt: any) => ({
          modifier_id: opt.modifier_id ?? opt.option_id ?? opt.id,
          name: opt.name,
          price_delta: opt.price_delta ?? opt.price_adjustment ?? 0,
          sort_order: opt.sort_order ?? 0
        }));
        return {
          link_id: gid,
          item_id: null, // 카테고리 레벨
          modifier_group_id: gid,
          group: { 
            id: gid, 
            name: g.name, 
            selection_type: g.selection_type,
            min_selection: g.min_selection ?? g.min_selections ?? 0, 
            max_selection: g.max_selection ?? g.max_selections ?? 0, 
            is_required: false 
          },
          modifiers: mappedOptions,
          source: 'category',
          isActive: 1
        };
      }).filter(Boolean);

      // 전역 상태 업데이트
      const normalizedGroups = (processedModifiers as any[]).map(pm => ({ id: pm.modifier_group_id, name: pm.group?.name }));
      const normalizedModifiers = (processedModifiers as any[]).flatMap(pm =>
        pm.modifiers.map((m: any) => ({
          id: m.modifier_id,
          option_id: m.modifier_id,
          modifier_id: m.modifier_id,
          name: m.name,
          price_delta: m.price_delta,
          price_adjustment: m.price_delta,
          sort_order: m.sort_order
        }))
      );
      setModifierGroups(normalizedGroups);
      setModifiers(normalizedModifiers);
      setSelectedItemModifiers(processedModifiers as any[]);
      
      console.log('📂 [Category Modifier] Loaded category modifiers:', processedModifiers.length, 'groups');

    } catch (error) {
      console.error('📂 [Category Modifier] Error:', error);
      setSelectedItemModifiers([]);
    } finally {
      setIsLoadingModifiers(false);
    }
  };

  /**
   * 카테고리에 모디파이어가 없는 경우 처리 (시나리오 3, 4)
   * - 첫 번째 아이템에 모디파이어가 있으면 해당 아이템 모디파이어 표시
   * - 없으면 빈 패널 표시
   */
  const handleNoCategoryModifiers = async (categoryId: number) => {
    try {
      // 해당 카테고리의 아이템들 가져오기
      const itemsResp = await fetch(`${API_URL}/menu/items?categoryId=${categoryId}`);
      if (!itemsResp.ok) {
        console.log('📂 [No Category Modifier] Failed to fetch items');
        setSelectedItemModifiers([]);
        return;
      }

      const itemsData: any[] = await itemsResp.json();
      
      // 화면 그리드 순서대로 정렬 (sort_order 기준)
      const sortedItems = [...itemsData].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

      // 모디파이어가 연결된 첫 번째 아이템 찾기
      const firstItemWithModifier = sortedItems.find(item => 
        Array.isArray(item.modifier_groups) && item.modifier_groups.length > 0
      );

      if (firstItemWithModifier) {
        const itemId = String(firstItemWithModifier.item_id || firstItemWithModifier.id);
        console.log('📂 [No Category Modifier] Found item with modifiers:', itemId);
        // 해당 아이템의 모디파이어 로드 (기존 함수 재사용)
        await fetchItemModifiers(itemId);
        // 해당 아이템을 선택 상태로 설정
        setSelectedMenuItemId(itemId);
      } else {
        // 시나리오 4: 모디파이어가 없음 → 빈 패널
        console.log('📂 [No Category Modifier] No items with modifiers → empty panel');
        setSelectedItemModifiers([]);
        setModifierGroups([]);
        setModifiers([]);
      }
    } catch (error) {
      console.error('📂 [No Category Modifier] Error:', error);
      setSelectedItemModifiers([]);
    }
  };

  // 카테고리 변경 시 모디파이어 자동 로드
  useEffect(() => {
    if (!selectedCategory || selectedCategory === MERGY_CATEGORY_ID) return;
    
    // 카테고리 ID 찾기
    const category = categories.find(c => c.name === selectedCategory);
    if (!category) return;

    console.log('📂 [Category Change] Category selected:', selectedCategory, '→ ID:', category.category_id);
    
    const pending = pendingModifierJumpRef.current;
    const hasPending = !!(pending && pending.categoryName === selectedCategory);

    // 일반 카테고리 이동일 때만 초기화 (주문목록 클릭으로 "해당 아이템"으로 점프하는 경우는 유지)
    if (!hasPending) {
      setSelectedMenuItemId(null);
      setSelectedModifiers({});
      setModifierEditTargetLineId(null);
      setModifierEditTargetRowIndex(null);
    }

    // 카테고리 모디파이어 로드 후, 주문목록 클릭 점프가 있으면 해당 아이템 모디파이어 편집으로 진입
    (async () => {
      await fetchCategoryModifiers(category.category_id);
      const pendingAfter = pendingModifierJumpRef.current;
      if (pendingAfter && pendingAfter.categoryName === selectedCategory) {
        pendingModifierJumpRef.current = null;
        try {
          setSelectedMenuItemId(pendingAfter.itemId);
          setSelectedMenuItemIds([pendingAfter.itemId]);
          setModifierTabExpanded(true);
          await fetchItemModifiers(pendingAfter.itemId);
          setSelectedModifiers(pendingAfter.selected || {});
        } catch {}
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory, categories]);

  // 페이지 로드 시 저장된 화면 크기 복원 (/sales/order에서는 BO 사이즈를 사용하므로 완전히 비활성화)
  useEffect(() => {
    if (isSalesOrder) {
      console.log('🚫 Skipping localStorage restore for /sales/order');
      return; // disable entirely for sales order
    }
    const savedScreenSize = localStorage.getItem('orderPageScreenSize');
    if (savedScreenSize) {
      try {
        const parsed = JSON.parse(savedScreenSize);
        console.log('📱 Restoring saved screen size:', parsed);
        
        // 저장된 해상도로 layoutSettings 업데이트
        if (parsed.screenAspect && parsed.screenResolution) {
          setLayoutSettings(prev => ({
            ...prev,
            screenAspect: parsed.screenAspect,
            screenResolution: parsed.screenResolution
          }));
        }
        
        // 저장된 화면 크기 적용
        if (parsed.appliedWidth && parsed.appliedHeight) {
          setTimeout(() => {
            if (canvasRef.current) {
              canvasRef.current.style.width = `${parsed.appliedWidth}px`;
              canvasRef.current.style.height = `${parsed.appliedHeight}px`;
              canvasRef.current.style.maxWidth = `${parsed.appliedWidth}px`;
              canvasRef.current.style.maxHeight = `${parsed.appliedHeight}px`;
              canvasRef.current.style.margin = '0 auto';
              canvasRef.current.style.overflow = 'auto';
            }
            console.log(`✅ Restored screen size: ${parsed.appliedWidth}x${parsed.appliedHeight}`);
          }, 100); // 약간의 지연을 두어 컴포넌트가 완전히 마운트된 후 적용
        }
      } catch (error) {
        console.error('❌ Error restoring screen size:', error);
      }
    } else {
      // 기본값: 4:3, 1024x768
      setLayoutSettings(prev => ({
        ...prev,
        screenAspect: '4:3',
        screenResolution: '1024x768'
      }));
      try {
        const [w, h] = '1024x768'.split('x').map(n=>parseInt(n,10));
        localStorage.setItem('orderPageScreenSize', JSON.stringify({ screenAspect: '4:3', screenResolution: '1024x768', appliedWidth: w, appliedHeight: h }));
        setTimeout(() => {
          if (canvasRef.current) {
            canvasRef.current.style.width = `${w}px`;
            canvasRef.current.style.height = `${h}px`;
            canvasRef.current.style.maxWidth = `${w}px`;
            canvasRef.current.style.maxHeight = `${h}px`;
            canvasRef.current.style.margin = '0 auto';
            canvasRef.current.style.overflow = 'auto';
          }
          console.log(`✅ Default screen size applied: ${w}x${h}`);
        }, 100);
      } catch {}
    }
  }, [isSalesOrder]);

  // 선택된 카테고리에 따른 메뉴 아이템 필터링
  const filteredMenuItems = (() => {
    // 머지 모드가 활성화되고 머지 카테고리가 선택된 경우
    if (mergyActive && selectedCategory === MERGY_CATEGORY_ID && currentMergyGroupId) {
      const currentGroup = layoutSettings.mergedGroups?.find(g => g.id === currentMergyGroupId);
      if (currentGroup) {
        const merged = menuItems.filter(item => currentGroup.categoryNames.includes(item.category));
        const seen = new Set<string>();
        const unique: typeof merged = [] as any;
        for (const it of merged) {
          const key = String(it.id);
          if (!seen.has(key)) { seen.add(key); unique.push(it); }
        }
        return unique;
      }
    }
    const base = selectedCategory ? menuItems.filter(item => item.category === selectedCategory) : menuItems;
    // 숨김 카테고리: 'Open Price'는 리스트에서 제외
    let list = base.filter(it => it.category !== 'Open Price');

      // Extra Button은 별도 고정 영역(우측 하단)에서 렌더링합니다.

    return list;
  })();

  // Service charge (% of subtotal)
  const [svcEnabled, setSvcEnabled] = useState<boolean>(() => {
    try { return (localStorage.getItem('svc_enabled') || '0') === '1'; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem('svc_enabled', svcEnabled ? '1' : '0'); } catch {} }, [svcEnabled]);
  const [svcName, setSvcName] = useState<string>(() => {
    try { return localStorage.getItem('svc_name') || 'Service'; } catch { return 'Service'; }
  });
  useEffect(() => { try { localStorage.setItem('svc_name', svcName); } catch {} }, [svcName]);
  const [svcPercent, setSvcPercent] = useState<number>(() => {
    try { return Number(localStorage.getItem('svc_percent') || '10'); } catch { return 10; }
  });
  useEffect(() => { try { localStorage.setItem('svc_percent', String(svcPercent)); } catch {} }, [svcPercent]);

  // Extra items (Bag Fee / Extra2) available for placement (normal and merged)
 const TOGO_LABEL_ITEM_ID = '__TOGO_LABEL__';
 const extraButtons: MenuItem[] = useMemo(() => {
   const items: MenuItem[] = [] as any;
   if (itemTogoEnabled && !isTogo) items.push({ id: TOGO_LABEL_ITEM_ID, name: 'Togo', price: 0, category: 'TogoLabel', color: 'bg-gray-500' } as any);
   const wantBag = !!tableBagFeeEnabled;
   const wantExtra2 = typeof extra2Enabled !== 'undefined' ? !!extra2Enabled : false;
   const wantSvc = !!svcEnabled;
   if (wantBag) items.push({ id: BAG_FEE_ITEM_ID, name: bagFeeButtonName || 'Bag Fee', price: Number(tableBagFeeValue||0), category: 'BagFee', color: bagFeeColor } as any);
   if (wantExtra2) items.push({ id: '__EXTRA2_ITEM__', name: extra2Name || 'Extra', price: Number(extra2Amount||0), category: 'Extra2', color: extra2Color } as any);
   if (!!extra3Enabled) items.push({ id: '__EXTRA3_ITEM__', name: extra3Name || 'Service', price: 0, category: 'Extra3', color: extra3Color, percent: Number(extra3Amount || 0) } as any);
   if (wantSvc) items.push({ id: SERVICE_CHARGE_ITEM_ID, name: `${svcName} ${svcPercent}%`, price: 0, category: 'Service', color: 'bg-amber-600' } as any);
   return items;
 }, [itemTogoEnabled, isTogo, tableBagFeeEnabled, extra2Enabled, bagFeeButtonName, tableBagFeeValue, bagFeeColor, extra2Name, extra2Amount, extra2Color, extra3Enabled, extra3Name, extra3Amount, extra3Color, svcEnabled, svcName, svcPercent]);

  // 메뉴 아이템 클릭 시 모디파이어 로드
  const handleMenuItemClick = async (item: MenuItem) => {
    // Sold Out 모드일 때는 Sold Out 처리
    if (soldOutMode) {
      handleMenuItemClickForSoldOut(item);
      return;
    }
    
    // Block ordering sold out items (double safety)
    if (soldOutItems.has(item.id)) {
      return;
    }

    // 주문목록 아이템(중간 라인) 편집 모드 해제: 오른쪽 메뉴를 눌러 추가 주문으로 들어가면 기존 동작 유지
    setModifierEditTargetLineId(null);
    setModifierEditTargetRowIndex(null);
    pendingModifierJumpRef.current = null;
    
    // Togo Label: apply to selected order item, or last added item if none selected
    if (item.id === TOGO_LABEL_ITEM_ID) {
      setOrderItems(prev => {
        let targetIdx = -1;
        if (selectedRowIndex != null && selectedOrderItemId != null) {
          targetIdx = selectedRowIndex;
        } else if (lastAddedItemIdRef.current) {
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].id === lastAddedItemIdRef.current && prev[i].type !== 'separator') {
              targetIdx = i;
              break;
            }
          }
        }
        if (targetIdx < 0) {
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].type !== 'separator' && prev[i].type !== 'discount' && !(prev[i] as any).type?.includes('void')) {
              targetIdx = i;
              break;
            }
          }
        }
        if (targetIdx < 0) return prev;
        const target = prev[targetIdx];
        if (!target || target.type === 'separator') return prev;
        const copy = [...prev];
        copy[targetIdx] = { ...target, togoLabel: !(target as any).togoLabel } as any;
        return copy;
      });
      return;
    }

    // Bag Fee pseudo item handling
    if (item.id === BAG_FEE_ITEM_ID) {
      setSelectedMenuItemId(item.id);
      const amount = Number(tableBagFeeValue || 0);
      if (amount <= 0) return;
      setOrderItems(prev => {
        const name = bagFeeButtonName || 'Bag Fee';
        const idx = prev.findIndex(it => it.type !== 'separator' && it.name === name && (it.guestNumber || 1) === (activeGuestNumber || 1) && Number(it.price) === amount);
        if (idx >= 0) {
          const copy = [...prev];
          const target = copy[idx];
          copy[idx] = { ...target, quantity: (target.quantity || 1) + 1 } as any;
          return copy;
        }
        const newItem: OrderItem = {
          id: `bagfee-${Date.now()}`,
          name,
          quantity: 1,
          price: amount,
          totalPrice: amount,
          taxGroupId: typeof bagFeeTaxGroupId === 'number' ? bagFeeTaxGroupId : null,
          printerGroupId: bagFeePrinterGroupId ? (isNaN(Number(bagFeePrinterGroupId)) ? null : Number(bagFeePrinterGroupId)) as any : null,
          type: 'item',
          guestNumber: activeGuestNumber
        };
        return [...prev, newItem];
      });
      return;
    }
    // Extra2 pseudo item handling
    if (item.id === '__EXTRA2_ITEM__') {
      setSelectedMenuItemId(item.id);
      const amount = Number(extra2Amount || 0);
      if (amount <= 0) return;
      setOrderItems(prev => {
        const name = extra2Name || 'Extra';
        const idx = prev.findIndex(it => it.type !== 'separator' && it.name === name && (it.guestNumber || 1) === (activeGuestNumber || 1) && Number(it.price) === amount);
        if (idx >= 0) {
          const copy = [...prev];
          const target = copy[idx];
          copy[idx] = { ...target, quantity: (target.quantity || 1) + 1 } as any;
          return copy;
        }
        const newItem: OrderItem = {
          id: `extra2-${Date.now()}`,
          name,
          quantity: 1,
          price: amount,
          totalPrice: amount,
          taxGroupId: typeof extra2TaxGroupId === 'number' ? extra2TaxGroupId : null,
          printerGroupId: extra2PrinterGroupId ? (isNaN(Number(extra2PrinterGroupId)) ? null : Number(extra2PrinterGroupId)) as any : null,
          type: 'item',
          guestNumber: activeGuestNumber
        };
        return [...prev, newItem];
      });
      return;
    }
    // Service charge (% of subtotal per current guest or whole order)
    if (item.id === SERVICE_CHARGE_ITEM_ID) {
      const percent = Number(svcPercent || 0);
      if (percent <= 0) return;
      // current subtotal (after existing items, before this service)
      const subtotal = orderItems.reduce((sum, it:any) => {
        if (it.type === 'separator') return sum;
        const memoPrice = ((it.memo?.price) || 0);
        return sum + ((it.totalPrice + memoPrice) * (it.quantity || 1));
      }, 0);
      const amount = Number(((subtotal * percent) / 100).toFixed(2));
      if (amount <= 0) return;
      setOrderItems(prev => {
        const name = `${svcName || 'Service'} ${percent}%`;
        const idx = prev.findIndex(it => it.type !== 'separator' && it.name === name && (it.guestNumber || 1) === (activeGuestNumber || 1) && Number(it.price) === amount);
        if (idx >= 0) {
          const copy = [...prev];
          const target = copy[idx];
          copy[idx] = { ...target, quantity: (target.quantity || 1) + 1 } as any;
          return copy;
        }
        const newItem: OrderItem = {
          id: `svc-${Date.now()}`,
          name,
          quantity: 1,
          price: amount,
          totalPrice: amount,
          type: 'item',
          guestNumber: activeGuestNumber
        };
        return [...prev, newItem];
      });
      return;
    }
    // Extra3 charge (% of subtotal)
    if (item.id === '__EXTRA3_ITEM__') { setSelectedMenuItemId(item.id);
      const percent = Number(extra3Amount || 0);
      if (percent <= 0) return;
      // current subtotal (after existing items, before this service)
      const subtotal = orderItems.reduce((sum, it:any) => {
        if (it.type === 'separator') return sum;
        const memoPrice = ((it.memo?.price) || 0);
        return sum + ((it.totalPrice + memoPrice) * (it.quantity || 1));
      }, 0);
      const amount = Number(((subtotal * percent) / 100).toFixed(2));
      if (amount <= 0) return;
      setOrderItems(prev => {
        const name = `${extra3Name || 'Service'} ${percent}%`;
        const idx = prev.findIndex(it => it.type !== 'separator' && it.name === name && (it.guestNumber || 1) === (activeGuestNumber || 1) && Number(it.price) === amount);
        if (idx >= 0) {
          const copy = [...prev];
          const target = copy[idx];
          copy[idx] = { ...target, quantity: (target.quantity || 1) + 1 } as any;
          return copy;
        }
        const newItem: OrderItem = {
          id: `extra3-${Date.now()}`,
          name,
          quantity: 1,
          price: amount,
          totalPrice: amount,
          taxGroupId: typeof extra3TaxGroupId === 'number' ? extra3TaxGroupId : null,
          printerGroupId: extra3PrinterGroupId ? (isNaN(Number(extra3PrinterGroupId)) ? null : Number(extra3PrinterGroupId)) as any : null,
          type: 'item',
          guestNumber: activeGuestNumber
        };
        return [...prev, newItem];
      });
      return;
    }
    // 이전 선택 해제하고 새로운 아이템 선택
    setSelectedMenuItemId(item.id);
    // 다른 아이템에서 남아있던 선택 상태 초기화 (Unknown 방지)
    setSelectedModifiers({});
    
    // 캐시 기반으로 모디파이어 표시 구성
    const catId = item.category_id;
    const directIds = itemModifierGroups[item.id] || [];
    const inheritedIds = (typeof catId === 'number' && categoryModifierGroups[catId]) ? categoryModifierGroups[catId] : [];
    const usedIds = Array.from(new Set<number>([...directIds, ...inheritedIds]));

    // 로컬 상세 맵으로 컴포지션 (state 비동기 반영 문제 회피)
    let detailMap: { [groupId: number]: any } = { ...modifierGroupDetailById };

    // 누락된 그룹 상세 보완 시도
    const missingBefore = usedIds.filter(gid => !detailMap[gid]);
    if (missingBefore.length > 0) {
      try {
        const resAll = await fetch(`${API_URL}/modifier-groups`);
        if (resAll.ok) {
          const allGs = await resAll.json();
          allGs.forEach((g: any) => {
            const gid = Number(g.id || g.group_id);
            if (!detailMap[gid]) {
              detailMap[gid] = g;
            }
          });
        }
      } catch {}
    }
    if (missingBefore.length > 0 && menuId) {
      try {
        const res = await fetch(`${API_URL}/menu-independent-options/${menuId}/modifier-groups`);
        if (res.ok) {
          const altGroups = await res.json();
          altGroups.forEach((g: any) => {
            const gid = Number(g.group_id || g.id);
            if (!detailMap[gid]) {
              detailMap[gid] = {
                id: gid,
                name: g.name,
                selection_type: g.selection_type,
                min_selection: g.min_selection ?? 0,
                max_selection: g.max_selection ?? 0,
                modifiers: (g.modifiers || []).map((m: any) => ({
                  modifier_id: m.modifier_id,
                  name: m.name,
                  price_delta: m.price_delta ?? 0,
                  sort_order: m.sort_order ?? 0
                }))
              };
            }
          });
          // 배경 캐시도 업데이트(다음 클릭 대비)
          setModifierGroupDetailById(detailMap);
        }
      } catch (e) {
        console.warn('Fallback fetch for modifier groups failed');
      }
    }

    // 최종 누락 확인
    const missingAfter = usedIds.filter(gid => !detailMap[gid]);

    const composed = usedIds.map(gid => {
      const g = detailMap[gid];
      if (!g) return null;
      const options = (g.options || g.modifiers || []).map((opt: any) => ({
        modifier_id: opt.modifier_id ?? opt.option_id ?? opt.id,
        name: opt.name,
        price_delta: opt.price_delta ?? opt.price_adjustment ?? 0,
        sort_order: opt.sort_order ?? 0
      }));
      return {
        link_id: gid,
        item_id: item.id,
        modifier_group_id: gid,
        group: { id: gid, name: g.name, selection_type: g.selection_type, min_selection: g.min_selection ?? g.min_selections ?? 0, max_selection: g.max_selection ?? g.max_selections ?? 0, is_required: false },
        modifiers: options,
        source: directIds.includes(gid) ? 'direct' : 'inherited',
        isActive: 1
      };
    }).filter(Boolean) as any[];

    // 표시 순서: 직결(아이템에 연결된 순서) 먼저, 그 다음 상속(카테고리 순서)
    const sortKey = (gid: number) => {
      const directIdx = directIds.indexOf(gid);
      if (directIdx !== -1) return directIdx; // 직결 순서 유지
      const inhIdx = inheritedIds.indexOf(gid);
      return 1000 + (inhIdx === -1 ? 999 : inhIdx); // 상속은 뒤로
    };
    composed.sort((a, b) => sortKey(a.modifier_group_id) - sortKey(b.modifier_group_id));
    setSelectedItemModifiers(composed);

    // 검증: 기대 그룹 수 vs 표시된 그룹 수
    const expectedCount = usedIds.length;
    const shownCount = composed.length;
    const baseMsg = `Groups - direct: ${directIds.length}, inherited: ${inheritedIds.length}, total: ${expectedCount}`;
    if (shownCount !== expectedCount) {
      const missingList = missingAfter.length ? ` | missing ids: ${missingAfter.join(',')}` : '';
      const renderedIds = composed.map(c => c.modifier_group_id).join(',');
      console.warn(`${baseMsg} | mismatch: expected ${expectedCount}, rendered ${shownCount} | used: ${usedIds.join(',')} | rendered: ${renderedIds}${missingList}`);
    } else {
      console.log(baseMsg);
    }

    // Block adding when active guest is locked (PAID)
    if (effectiveSplitCount > 1) {
      // Equal Split (active or restored): 미결제 게스트를 찾아서 새 아이템 추가
      let targetGuest = activeGuestNumber || 1;
      if (isGuestLocked(targetGuest)) {
        const allGuests = Array.isArray(guestIds) && guestIds.length > 0
          ? guestIds
          : Array.from({ length: effectiveSplitCount }, (_, i) => i + 1);
        const firstUnpaid = allGuests.find(g => !isGuestLocked(g));
        if (typeof firstUnpaid === 'number') {
          targetGuest = firstUnpaid;
          setActiveGuestNumber(firstUnpaid);
        }
      }
      const isTogoItem = !!(item as any).togoLabel;
      setOrderItems(prev => {
        const existingIdx = prev.findIndex((it: any) =>
          it.type === 'item' &&
          String(it.id) === String(item.id) &&
          it.guestNumber === targetGuest &&
          !it._preSplit &&
          !!(it.togoLabel) === isTogoItem &&
          (!it.modifiers || it.modifiers.length === 0)
        );
        if (existingIdx >= 0) {
          const updated = [...prev];
          updated[existingIdx] = { ...updated[existingIdx], quantity: (updated[existingIdx].quantity || 1) + 1 } as any;
          return updated;
        }
        const orderLineId = `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        return [...prev, {
          id: item.id,
          name: item.name,
          short_name: (item as any).short_name,
          quantity: 1,
          price: item.price,
          modifiers: [],
          totalPrice: item.price,
          type: 'item' as const,
          guestNumber: targetGuest,
          orderLineId,
          togoLabel: isTogoItem,
          _preSplit: false,
          ...(Array.isArray((item as any).printer_groups) && (item as any).printer_groups.length > 0
            ? { printer_groups: (item as any).printer_groups }
            : {}),
        } as any];
      });
      lastAddedItemIdRef.current = item.id;
      return;
    } else if (isGuestLocked(activeGuestNumber)) {
      try { alert('Cannot add to a guest that has already paid.'); } catch {}
      return;
    }
    addToOrder(item);
    lastAddedItemIdRef.current = item.id;
  };

  const toggleSelectMenuItem = (itemId: string) => {
    setSelectedMenuItemIds(prev =>
      prev.includes(itemId) ? prev.filter(id => id !== itemId) : [...prev, itemId]
    );
  };

  const moveCategory = (from: number, to: number) => {
    setCategories(prev => {
      const copy = [...prev];
      const [moved] = copy.splice(from, 1);
      copy.splice(to, 0, moved);
      return copy;
    });
  };


  const moveMenuItemInCategory = (from: number, to: number, categoryName: string) => {
    setCategories(prev => {
      const copy = [...prev];
      const categoryIndex = copy.findIndex(cat => cat.name === categoryName);
      
      if (categoryIndex === -1) return prev;
      
      const category = copy[categoryIndex];
      const items = [...category.items];
      
      if (from < 0 || to < 0 || from >= items.length || to >= items.length) return prev;
      
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved);
      
      copy[categoryIndex] = {
        ...category,
        items: items
      };
      
      return copy;
    });
    
    // menuItems 상태도 업데이트
    setMenuItems(prev => {
      const copy = [...prev];
      const categoryItems = copy.filter(item => item.category === categoryName);
      
      if (from < 0 || to < 0 || from >= categoryItems.length || to >= categoryItems.length) return prev;
      
      const reorderedInCat = [...categoryItems];
      const [moved] = reorderedInCat.splice(from, 1);
      reorderedInCat.splice(to, 0, moved);
      
      // 재정렬된 아이템들을 원래 위치에 배치
      const indices: number[] = [];
      copy.forEach((item, i) => { 
        if (item.category === categoryName) indices.push(i); 
      });
      
      indices.forEach((idx, j) => {
        copy[idx] = reorderedInCat[j];
      });
      
      return copy;
    });
  };

  // Edit Price 관련 함수들
  const handleOrderItemClick = (itemId: string, guestNum: number | undefined, rowIndex: number, orderLineId?: string) => {
    setSelectedOrderItemId(itemId);
    setSelectedOrderLineId(orderLineId || null);
    setSelectedOrderGuestNumber(typeof guestNum === 'number' ? guestNum : null);
    setSelectedRowIndex(Number.isFinite(rowIndex) ? rowIndex : null);
    setModifierEditTargetLineId(orderLineId || null);
    setModifierEditTargetRowIndex(Number.isFinite(rowIndex) ? rowIndex : null);
    // Ensure subsequent menu additions go to the clicked guest
    if (typeof guestNum === 'number') {
      setActiveGuestNumber(guestNum);
    }

    // 주문목록 아이템 클릭 → 오른쪽 카테고리 이동 + 해당 아이템 모디파이어 편집 진입
    try {
      const clickedRow: any = (orderItems as any[])[rowIndex];
      if (!clickedRow || clickedRow.type === 'separator') return;
      const menuItem = menuItems.find(mi => String(mi.id) === String(itemId));
      if (!menuItem) return;
      const categoryName = String((menuItem as any).category || '');
      if (!categoryName) return;

      // 기존 선택된 모디파이어를 패널 선택값으로 복원
      const restoreSelected: { [key: string]: string[] } = {};
      const mods = Array.isArray(clickedRow.modifiers) ? clickedRow.modifiers : [];
      mods.forEach((m: any) => {
        const gid = String(m.groupId ?? m.modifier_group_id ?? '');
        if (!gid || gid.startsWith('__')) return; // __MOD_EXTRA1__/__MOD_EXTRA2__ 등은 패널 대상 아님
        const ids = Array.isArray(m.modifierIds) ? m.modifierIds : (Array.isArray(m.modifier_ids) ? m.modifier_ids : []);
        if (!ids || ids.length === 0) return;
        restoreSelected[gid] = ids.map((x: any) => String(x));
      });

      const doApply = async () => {
        try {
          pendingModifierJumpRef.current = null;
          setSelectedMenuItemId(String(menuItem.id));
          setSelectedMenuItemIds([String(menuItem.id)]);
          setModifierTabExpanded(true);
          await fetchItemModifiers(String(menuItem.id));
          setSelectedModifiers(restoreSelected);
        } catch {}
      };

      // 카테고리가 이미 선택된 상태면 즉시 적용, 아니면 카테고리 이동 후 effect에서 적용
      if (selectedCategory === categoryName) {
        void doApply();
      } else {
        pendingModifierJumpRef.current = { itemId: String(menuItem.id), categoryName, selected: restoreSelected };
        try { setActiveCategoryId(menuItem.category_id ? String(menuItem.category_id) : null); } catch {}
        setSelectedCategory(categoryName);
      }
    } catch {}
  };

  const handleEditPriceClick = () => {
    if (!selectedOrderItemId) {
      alert('Please select a menu item to change the price.');
      return;
    }
    
    setNewPrice('');
    setShowEditPriceModal(true);
  };

  const handleEditPrice = () => {
    if (!selectedOrderItemId || !newPrice) return;
    
    const price = parseFloat(newPrice);
    if (isNaN(price) || price < 0) {
      alert('Please enter a valid price.');
      return;
    }

    setOrderItems(prev => prev.map(item => 
      (item.id === selectedOrderItemId && ((item.guestNumber||1) === (selectedOrderGuestNumber||1)))
        ? { ...item, price: price, totalPrice: price + (item.modifiers?.reduce((sum, mod) => sum + mod.totalModifierPrice, 0) || 0) }
        : item
    ));

    setShowEditPriceModal(false);
    setSelectedOrderItemId(null);
    setSelectedOrderGuestNumber(null);
    setNewPrice('');
  };

  const handleCancelEditPrice = () => {
    setShowEditPriceModal(false);
    setSelectedOrderItemId(null);
    setSelectedOrderGuestNumber(null);
    setNewPrice('');
  };

  // Per-item Discount state and helpers
  const [showItemDiscountModal, setShowItemDiscountModal] = useState(false);
  const [itemDiscountMode, setItemDiscountMode] = useState<'percent'|'amount'>('percent');
  const [itemDiscountValue, setItemDiscountValue] = useState<string>('');
  const [showDiscountModeModal, setShowDiscountModeModal] = useState(false);

  const appendDiscountDigit = (digit: string) => {
    setItemDiscountValue(prev => {
      let next = String(prev || '');
      if (digit === '.') {
        if (itemDiscountMode === 'amount') {
          if (next.includes('.')) return next;
          if (next === '') return '0.';
          return next + '.';
        }
        return next;
      }
      if (!/^[0-9]$/.test(digit)) return next;
      if (next === '0') next = '';
      next = next + digit;
      return next;
    });
  };

  const backspaceDiscountValue = () => {
    setItemDiscountValue(prev => prev ? prev.slice(0, -1) : '');
  };

  const clearDiscountValue = () => {
    setItemDiscountValue('');
  };

  const handleApplyItemDiscount = () => {
    if (!selectedOrderItemId) return;
    const raw = Number(itemDiscountValue || '0');
    if (!isFinite(raw) || raw <= 0) return;
    
    if (itemDiscountMode === 'percent') {
      // Clamp to 0 ~ 100 for percentage
      const clamped = Math.max(0, Math.min(100, raw));
      setOrderItems(prev => prev.map(item =>
        (item.id === selectedOrderItemId && ((item.guestNumber||1) === (selectedOrderGuestNumber||1)))
          ? { ...item, discount: { type: 'Item Discount', percentage: clamped, mode: 'percent' as const, value: clamped } }
          : item
      ));
    } else {
      // Amount mode - store the dollar amount
      setOrderItems((prev: any) => prev.map((item: any) =>
        (item.id === selectedOrderItemId && ((item.guestNumber||1) === (selectedOrderGuestNumber||1)))
          ? { ...item, discount: { type: 'Item Discount', percentage: 0, mode: 'amount', value: raw } }
          : item
      ));
    }
    setShowItemDiscountModal(false);
    setItemDiscountValue('');
  };

  const handleCancelItemDiscount = () => {
    setShowItemDiscountModal(false);
    setItemDiscountValue('');
  };

  const handleClearClick = () => {
    preserveOrderListScroll(async () => {
      if (selectedOrderItemId) {
        // Decrement like pressing '-' until it reaches 0, which removes the line
        if (selectedOrderLineId) {
          updateQuantityByLineId(selectedOrderLineId, -1);
        } else {
          // fallback by id+guest (legacy)
          const idx = orderItems.findIndex(it => it.id === selectedOrderItemId && ((it.guestNumber||1) === (selectedOrderGuestNumber||1)));
          if (idx >= 0) {
            const lineId = (orderItems[idx] as any).orderLineId;
            if (lineId) updateQuantityByLineId(lineId, -1);
          }
        }
        setSelectedOrderItemId(null);
        setSelectedOrderLineId(null);
        setSelectedOrderGuestNumber(null);
        return;
      }
      // Clear ALL: 모든 주문 아이템 삭제 + 스플릿 정보(구분선/게스트) 초기화, VOID 표시 캐시 제거
      setOrderItems([]);
      setActiveGuestNumber(1);
      try { initializeSplitGuests([] as any); } catch {}
      try {
        const tableIdForMap = (location.state && (location.state as any).tableId) || null;
        if (tableIdForMap) {
          localStorage.removeItem(`voidDisplay_${tableIdForMap}`);
          localStorage.removeItem(`splitGuests_${tableIdForMap}`);
        }
      } catch {}
    });
  };

  const orderListRef = useRef<HTMLDivElement | null>(null);
  const preserveOrderListScroll = (fn: () => void) => {
    const el = orderListRef.current;
    const top = el ? el.scrollTop : 0;
    fn();
    requestAnimationFrame(() => {
      if (el) el.scrollTop = top;
    });
  };

  // Item Memo 관련 함수들
  const handleItemMemoClick = () => {
    if (!selectedOrderItemId) {
      alert('Please select an order item to add a memo.');
      return;
    }
    
    // 기존 메모가 있다면 불러오기
    const selectedItem = orderItems.find(item => item.id === selectedOrderItemId && ((item.guestNumber||1) === (selectedOrderGuestNumber||1)));
    if (selectedItem && (selectedItem as any).memo) {
      setItemMemo((selectedItem as any).memo.text || '');
      setItemMemoPrice((selectedItem as any).memo.price ? (selectedItem as any).memo.price.toString() : '');
    } else {
      setItemMemo('');
      setItemMemoPrice('');
    }
    
    setShowItemMemoModal(true);
  };

  const handleSaveItemMemo = () => {
    if (!selectedOrderItemId) return;
    
    const memoData = {
      text: itemMemo,
      price: itemMemoPrice ? parseFloat(itemMemoPrice) : 0
    };
    
    setOrderItems(prev => prev.map(item => 
      (item.id === selectedOrderItemId && ((item.guestNumber||1) === (selectedOrderGuestNumber||1)))
        ? { ...item, memo: memoData }
        : item
    ));
    
    try { setSoftKbTarget(null); } catch {}
    setShowItemMemoModal(false);
    setItemMemo('');
    setItemMemoPrice('');
  };

  const handleCancelItemMemo = () => {
    try { setSoftKbTarget(null); } catch {}
    setShowItemMemoModal(false);
    setItemMemo('');
    setItemMemoPrice('');
  };

  // Split (per selected item) - open SplitBillModal
  const handleSplitSelectedItem = () => {
    try {
      if (!selectedOrderLineId && !selectedOrderItemId) {
        alert('Please select an order item to split.');
        return;
      }
      const g = selectedOrderGuestNumber || activeGuestNumber;
      if (isGuestLocked(g)) {
        alert('Items from guests who have already paid cannot be split.');
        return;
      }
      if (!splitOriginalSnapshotRef.current) {
        splitOriginalSnapshotRef.current = JSON.parse(JSON.stringify(orderItems));
      }
      setShowSplitBillModal(true);
    } catch {}
  };



  // 주문 총액 계산 (단일 계산 모듈 결과를 그대로 사용)
  const baseSubtotal = Number((pricingAll.totals?.subtotalAfterAllDiscounts || 0).toFixed(2));
  const grossSubtotal = Number((pricingAll.totals?.grossSubtotal || 0).toFixed(2));
  const baseTaxLines: { name: string; amount: number }[] = (pricingAll.totals?.taxLines || []).map((t: any) => ({ name: t.name, amount: Number((t.amount || 0).toFixed(2)) }));
  const baseTaxesTotal = Number((pricingAll.totals?.taxesTotal || 0).toFixed(2));
  const baseTotal = Number((pricingAll.totals?.total || 0).toFixed(2));

  // Apply channel-level adjustments (TOGO discount + Bag Fee) via shared helper.
  const togoAdjustments: any[] = [];
  let togoDiscountAmt = 0;
  if (isTogo && togoSettings.discountEnabled && Number(togoSettings.discountValue || 0) > 0) {
    const dv = Number(togoSettings.discountValue || 0);
    togoDiscountAmt = computeDiscountAmount(baseSubtotal, (togoSettings.discountMode === 'amount' ? 'amount' : 'percent') as any, dv);
    if (togoDiscountAmt > 0) togoAdjustments.push({ kind: 'DISCOUNT', label: 'TOGO Discount', amount: togoDiscountAmt });
  }
  if (isTogo && togoSettings.bagFeeEnabled && Number(togoSettings.bagFeeValue || 0) > 0) {
    const feeAmt = Number(Number(togoSettings.bagFeeValue || 0).toFixed(2));
    if (feeAmt > 0) togoAdjustments.push({ kind: 'FEE', label: 'Bag Fee', amount: feeAmt });
  }
  const appliedTotals = (togoAdjustments.length > 0)
    ? applySubtotalAdjustments({ subtotal: baseSubtotal, taxLines: baseTaxLines }, togoAdjustments)
    : { subtotal: baseSubtotal, taxLines: baseTaxLines, taxesTotal: baseTaxesTotal, total: baseTotal, discountTotal: 0, feeTotal: 0 } as any;

  const subtotal = Number((appliedTotals.subtotal || 0).toFixed(2));
  const taxLines: { name: string; amount: number }[] = (appliedTotals.taxLines || []).map((t: any) => ({ name: t.name, amount: Number((t.amount || 0).toFixed(2)) }));
  const taxesTotal = Number((appliedTotals.taxesTotal || 0).toFixed(2));
  const total = Number((appliedTotals.total || 0).toFixed(2));
  const discountTotal = Number(((pricingAll.totals?.itemDiscountTotal || 0) + (pricingAll.totals?.orderDiscountTotal || 0) + (togoDiscountAmt || 0)).toFixed(2));

  // HEX 색상의 밝기를 계산하는 함수
  const getHexLuminance = (hex: string): number => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    
    // 상대적 밝기 계산 (0.299*R + 0.587*G + 0.114*B)
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  };
  // Choose readable text color (black for light backgrounds, white for dark)
  // 선택된 메뉴 아이템의 주문을 모디파이어 정보와 함께 업데이트
  const updateOrderItemWithModifiers = (item: MenuItem) => {
    setOrderItems(prev => {
      // Guest 별 독립처리: 가장 최근에 추가된 (마지막) 해당 메뉴 아이템 찾기
      let existingItemIndex = -1;
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].id === item.id && prev[i].guestNumber === activeGuestNumber) {
          existingItemIndex = i;
          break;
        }
      }
      
      if (existingItemIndex !== -1) {
        // 기존 아이템이 있으면 모디파이어 정보만 업데이트
        const updatedItems = [...prev];
        const existingItem = updatedItems[existingItemIndex];
        
        // 현재 선택된 모디파이어 정보 생성
        const modifierInfo = Object.entries(selectedModifiers).map(([groupId, modifierIds]) => {
          const group = modifierGroups.find(g => g.id?.toString() === groupId);
          const selectedModifierNames = modifierIds.map(modId => {
            const modifier = modifiers.find(m => 
              (m.option_id?.toString() === modId) || 
              (m.modifier_id?.toString() === modId) || 
              (m.id?.toString() === modId)
            );
            return modifier?.name || 'Unknown';
          });
          
          const totalModifierPrice = modifierIds.reduce((total, modId) => {
            const modifier = modifiers.find(m => 
              (m.option_id?.toString() === modId) || 
              (m.modifier_id?.toString() === modId) || 
              (m.id?.toString() === modId)
            );
            return total + (modifier?.price_adjustment || modifier?.price_delta || 0);
          }, 0);
          
          return {
            groupId,
            groupName: group?.name || 'Unknown Group',
            modifierIds,
            modifierNames: selectedModifierNames,
            totalModifierPrice
          };
        });
        
        const totalPrice = item.price + modifierInfo.reduce((sum, mod) => sum + mod.totalModifierPrice, 0);
        
        // 기존 아이템 업데이트
        updatedItems[existingItemIndex] = {
          ...existingItem,
          modifiers: modifierInfo,
          totalPrice
        };
        
        return updatedItems;
      } else {
        // 기존 아이템이 없으면 새로 추가 (새로운 게스트의 메뉴 또는 새로운 메뉴)
        console.log(`Adding new item for Guest ${activeGuestNumber}: ${item.name}`);
        
        const modifierInfo = Object.entries(selectedModifiers).map(([groupId, modifierIds]) => {
          const group = modifierGroups.find(g => g.id?.toString() === groupId);
          const selectedModifierNames = modifierIds.map(modId => {
            const modifier = modifiers.find(m => 
              (m.option_id?.toString() === modId) || 
              (m.modifier_id?.toString() === modId) || 
              (m.id?.toString() === modId)
            );
            return modifier?.name || 'Unknown';
          });
          
          const totalModifierPrice = modifierIds.reduce((total, modId) => {
            const modifier = modifiers.find(m => 
              (m.option_id?.toString() === modId) || 
              (m.modifier_id?.toString() === modId) || 
              (m.id?.toString() === modId)
            );
            return total + (modifier?.price_adjustment || modifier?.price_delta || 0);
          }, 0);
          
          return {
            groupId,
            groupName: group?.name || 'Unknown Group',
            modifierIds,
            modifierNames: selectedModifierNames,
            totalModifierPrice
          };
        });
        
        const totalPrice = item.price + modifierInfo.reduce((sum, mod) => sum + mod.totalModifierPrice, 0);
        
        const newOrderItem: OrderItem = {
          id: item.id,
          name: layoutSettings.useShortName && (item as any).short_name ? (item as any).short_name : item.name,
          quantity: 1,
          price: item.price,
          modifiers: modifierInfo,
          totalPrice,
          type: 'item',
          guestNumber: activeGuestNumber // 현재 활성 게스트 번호 할당
        };
        
        return [...prev, newOrderItem];
      }
    });
  };

  // 선택된 메뉴 아이템의 주문을 모디파이어 정보와 함께 즉시 업데이트
  const updateOrderItemWithModifiersImmediate = (item: MenuItem, currentSelectedModifiers: {[key: string]: string[]}) => {
    setOrderItems(prev => {
      // 현재 표시 중인 모디파이어 데이터로 이름 매핑 생성 (가장 신뢰도 높음)
      const groupNameById = new Map<string, string>();
      const modifierNameById = new Map<string, string>();
      selectedItemModifiers.forEach(link => {
        const gid = String(link.modifier_group_id);
        if (link.group?.name) groupNameById.set(gid, link.group.name);
        (link.modifiers || []).forEach((m: any) => {
          const mid = String(m.option_id ?? m.modifier_id ?? m.id);
          if (m.name) modifierNameById.set(mid, m.name);
        });
      });

      // 주문목록 클릭 편집 모드면 해당 라인(중간 아이템)을 우선 업데이트
      let existingItemIndex = -1;
      if (modifierEditTargetLineId) {
        existingItemIndex = prev.findIndex(it => String((it as any).orderLineId || '') === String(modifierEditTargetLineId));
      }
      if (existingItemIndex === -1 && modifierEditTargetRowIndex != null) {
        const idx = Number(modifierEditTargetRowIndex);
        if (Number.isFinite(idx) && idx >= 0 && idx < prev.length && prev[idx]?.type !== 'separator') {
          existingItemIndex = idx;
        }
      }
      // 기본 동작: Guest 별 가장 최근(마지막) 해당 메뉴 아이템
      if (existingItemIndex === -1) {
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].id === item.id && prev[i].guestNumber === activeGuestNumber) {
            existingItemIndex = i;
            break;
          }
        }
      }

      if (existingItemIndex !== -1) {
        // 기존 아이템 업데이트
        const updatedItems = [...prev];
        const existingItem = updatedItems[existingItemIndex];
        
        const modifierInfo = Object.entries(currentSelectedModifiers).map(([groupId, modifierIds]) => {
          const groupName = groupNameById.get(groupId) || 'Unknown Group';
          
          // selectedItemModifiers에서 해당 그룹의 모디파이어 찾기
          const groupLink = selectedItemModifiers.find(link => String(link.modifier_group_id) === String(groupId));
          const groupModifiers = groupLink?.modifiers || [];
          
          // 각 모디파이어에 대한 selectedEntries 생성 (가격 포함)
          const selectedEntries = modifierIds.map(modId => {
            // 먼저 selectedItemModifiers에서 찾기
            const modFromGroup = groupModifiers.find((m: any) => 
              String(m.modifier_id) === String(modId) || 
              String(m.option_id) === String(modId) || 
              String(m.id) === String(modId)
            );
            // 없으면 전역 modifiers에서 찾기
            const modifier = modFromGroup || modifiers.find(m => 
              (m.option_id?.toString() === modId) || 
              (m.modifier_id?.toString() === modId) || 
              (m.id?.toString() === modId)
            );
            const name = modifierNameById.get(modId) || modifier?.name || 'Unknown';
            const price_delta = Number(modifier?.price_delta ?? modifier?.price_adjustment ?? 0);
            return { id: modId, name, price_delta };
          });
          
          const selectedModifierNames = selectedEntries.map(e => e.name);
          const totalModifierPrice = selectedEntries.reduce((total, e) => total + e.price_delta, 0);
          
          return {
            groupId,
            groupName,
            modifierIds,
            modifierNames: selectedModifierNames,
            selectedEntries,
            totalModifierPrice
          };
        });

        // 기존 확장 모디파이어 유지 (__MOD_EXTRA1__, __MOD_EXTRA2__)
        const existingExtraModifiers = (existingItem.modifiers || []).filter((mod: any) => 
          mod.groupId === '__MOD_EXTRA1__' || mod.groupId === '__MOD_EXTRA2__'
        );
        
        // 확장 모디파이어 + 일반 모디파이어 병합
        const mergedModifiers = [...existingExtraModifiers, ...modifierInfo];
        
        const totalPrice = item.price + mergedModifiers.reduce((sum, mod) => sum + (mod.totalModifierPrice || 0), 0);
        
        updatedItems[existingItemIndex] = {
          ...existingItem,
          modifiers: mergedModifiers,
          totalPrice
        };
        
        return updatedItems;
      } else {
        return prev;
      }
    });
  };

  // 레이아웃 설정 저장 함수
  /* legacy saveLayoutSettings removed; handled by useLayoutSettings */

  
  // 컴포넌트 마운트 시 레이아웃 설정 불러오기 (hook)
  useEffect(() => {
    loadLayoutSettings();
  }, [loadLayoutSettings]);

  // Fallback: modifierColors가 로드되지 않았으면 직접 로드
  useEffect(() => {
    if (modifierColorsLoaded && Object.keys(modifierColors).length === 0) {
      (async () => {
        try {
          const res = await fetch(`${API_URL}/layout-settings`);
          if (res.ok) {
            const result = await res.json();
            if (result?.success && result?.data?.modifierColors && Object.keys(result.data.modifierColors).length > 0) {
              setModifierColors(result.data.modifierColors);
            }
          }
        } catch {}
      })();
    }
  }, [modifierColorsLoaded, modifierColors, setModifierColors]);

  // resetLayoutSettings is provided by useLayoutSettings hook

  // dnd-kit sensors
  const pointerSensor = useSensor(PointerSensor, { activationConstraint: { distance: 5 } });
  const sensors = useSensors(pointerSensor);
  const hoverGuestRef = useRef<number | null>(null);

  const DraggableOrderRow: React.FC<{ idx: number; children: React.ReactNode }> = ({ idx, children }) => {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `order-${idx}`, data: { idx } });
    const style: React.CSSProperties = {
      transform: CSS.Transform.toString(transform),
      opacity: isDragging ? 0.9 : 1,
      touchAction: 'none'
    };
    return (
      <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
        {children}
      </div>
    );
  };
  const DroppableGuestLabel: React.FC<{ guest: number; children: React.ReactNode }> = ({ guest, children }) => {
    const { setNodeRef, isOver } = useDroppable({ id: `guest-${guest}`, data: { guest } });
    const isLocked = isGuestLocked(guest);
    const isPaid = guestStatusMap && guestStatusMap[guest] === 'PAID';
    return (
      <div
        ref={setNodeRef}
        className={`w-full flex items-center justify-center min-h-[44px] py-3 my-2 relative ${isOver && !isLocked ? 'ring-2 ring-blue-400 rounded-sm bg-blue-50' : ''} ${activeGuestNumber === guest && !isLocked ? 'bg-yellow-100 rounded-sm border border-yellow-300' : ''} ${isLocked ? 'opacity-50 cursor-not-allowed bg-green-100 border border-green-400 rounded-sm' : ''}`}
        style={{ pointerEvents: isLocked ? 'none' : 'auto' }}
        onClick={() => { if (isLocked) return; setActiveGuestNumber(guest); }}
      >
        {children}
        {isPaid && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-bold text-green-700 bg-green-200 px-1.5 py-0.5 rounded">PAID</span>
        )}
      </div>
    );
  };

  const GuestRowDropZone: React.FC<{ guest: number; children: React.ReactNode }> = ({ guest, children }) => {
    const { setNodeRef, isOver } = useDroppable({ id: `guest-zone-${guest}`, data: { guest } });
    return (
      <div ref={setNodeRef} className={`${isOver ? 'ring-2 ring-blue-300 rounded-sm' : ''}`} onClick={() => { if (isGuestLocked(guest)) return; setActiveGuestNumber(guest); }}>
        {children}
      </div>
    );
  };

  const DraggableDroppableOrderRow: React.FC<{ idx: number; guest: number; children: React.ReactNode; disabled?: boolean }> = ({ idx, guest, children, disabled }) => {
    const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({ id: `order-${idx}`, data: { idx } });
    const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `row-${idx}`, data: { guest } });
    const style: React.CSSProperties = {
      transform: CSS.Transform.toString(transform),
      opacity: isDragging ? 0.9 : 1,
      touchAction: 'none',
      transition: isDragging ? undefined : 'transform 250ms cubic-bezier(0.22, 1, 0.36, 1)'
    };
    return (
      <div ref={setDropRef} className={isOver ? 'ring-2 ring-blue-300 rounded-sm' : ''}>
        <div
          ref={setDragRef}
          style={{ ...style, pointerEvents: disabled ? 'none' as const : style.pointerEvents }}
          {...(disabled ? {} : attributes)}
          {...(disabled ? {} : listeners)}
        >
          {children}
        </div>
      </div>
    );
  };

  const handleOrderDragEnd = (event: DragEndEvent) => {
    const src = event.active?.data?.current as any;
    const dst = event.over?.data?.current as any;
    const overGuest = (dst && typeof dst.guest === 'number') ? dst.guest : hoverGuestRef.current;
    console.log('Order DnD end:', { src, dst, overGuest, active: event.active?.id, over: event.over?.id });
    if (!src || typeof src.idx !== 'number') return;
    if (typeof overGuest !== 'number') return;
    const sourceItem = orderItems[src.idx];
    if (sourceItem && sourceItem.guestNumber === overGuest) return;
    moveItemToGuest(src.idx, overGuest);
    hoverGuestRef.current = null;
  };

  const handleOrderDragOver = (event: DragOverEvent) => {
    const dst = event.over?.data?.current as any;
    const src = event.active?.data?.current as any;
    if (dst && typeof dst.guest === 'number') {
      hoverGuestRef.current = dst.guest;
      // Remove real-time movement during drag over to prevent duplicate moves
    }
  };









  // Helpers to build combined entries and layout for the selected item
  const getCombinedModifierEntries = () => {
    const entries: Array<{ id: string; label: string; groupId: string; selectionType?: string; price?: number; }> = [];
    selectedItemModifiers.forEach((modifierLink: any) => {
      (modifierLink.modifiers || []).forEach((modifier: any) => {
        const id = modifier.option_id?.toString() || modifier.modifier_id?.toString() || modifier.id?.toString();
        if (!id) return;
        entries.push({
          id,
          label: modifier.name || modifier.option_name || modifier.modifier_name,
          groupId: modifierLink.modifier_group_id,
          selectionType: modifierLink.group?.selection_type,
          price: modifier.price_delta ?? modifier.price_adjustment ?? 0
        });
      });
    });
    return entries;
  };

  const getLayoutKey = (itemId: string) => `modifierLayout:${itemId}`;

  const computeDefaultLayout = (entries: Array<{id:string}>, capacity: number) => {
    const ids = entries.map(e => e.id).slice(0, capacity);
    if (shouldShowButtonPlaceholders) {
      while (ids.length < capacity) {
        ids.push(`EMPTY:${ids.length}`);
      }
    }
    return ids;
  };

  const sanitizeExistingLayout = (existing: string[] | undefined, entries: Array<{id:string}>, capacity: number) => {
    const availableIds = new Set(entries.map(e => e.id));
    const result: string[] = [];
    if (existing && Array.isArray(existing)) {
      for (const val of existing) {
        if (val.startsWith('EMPTY:')) {
          result.push(val);
        } else if (availableIds.has(val)) {
          result.push(val);
        }
      }
      Array.from(availableIds).forEach((id) => {
        if (!result.includes(id) && result.length < capacity) {
          result.push(id);
        }
      });
      if (result.length > capacity) {
        result.length = capacity;
      }
      if (shouldShowButtonPlaceholders) {
        while (result.length < capacity) {
          result.push(`EMPTY:${result.length}`);
        }
      }
      return result.slice(0, capacity);
    }
    return computeDefaultLayout(entries, capacity);
  };

  // derive slot ids for current item
  const capacity = Math.max(1, layoutSettings.modifierColumns * layoutSettings.modifierRows);
  // const bagFeeActive = (tableBagFeeEnabled || isTogo);
  let combinedEntries = getCombinedModifierEntries();
  // Bag Fee is no longer injected into the modifier panel
  const entryMap = new Map(combinedEntries.map(e => [e.id, e]));
  const modCategoryKey = (() => {
    const cat = categories.find(c => c.name === selectedCategory);
    return cat ? `__cat_${cat.category_id}` : (selectedCategory ? `__cat_${selectedCategory}` : undefined);
  })();
  const modLayoutKey = (() => {
    if (selectedMenuItemId && modifierLayoutByItem[selectedMenuItemId]) return selectedMenuItemId;
    if (modCategoryKey) return modCategoryKey;
    return selectedMenuItemId;
  })();
  const currentItemLayout = modLayoutKey ? modifierLayoutByItem[modLayoutKey] : undefined;
  let slotItemIds = sanitizeExistingLayout(currentItemLayout, combinedEntries, capacity);

  // persist layout when dependencies change (only after DB load completes)
  useEffect(() => {
    const key = modLayoutKey;
    if (!key) return;
    if (!modifierLayoutLoaded) return;
    const sanitized = sanitizeExistingLayout(modifierLayoutByItem[key], combinedEntries, capacity);
    const existing = (modifierLayoutByItem[key] || []).join('|');
    const sanitizedStr = sanitized.join('|');
    if (!modifierLayoutByItem[key] || sanitizedStr !== existing) {
      setModifierLayoutByItem(prev => ({ ...prev, [key]: sanitized }));
      try { localStorage.setItem(getLayoutKey(key), JSON.stringify(sanitized)); } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modLayoutKey, modifierLayoutLoaded, layoutSettings.modifierColumns, layoutSettings.modifierRows, selectedItemModifiers]);

  // initialize modifier layout on item/category change: prefer hook state (from DB), fallback to localStorage
  useEffect(() => {
    const key = modLayoutKey;
    if (!key) return;
    if (modifierLayoutByItem[key]) return;
    try {
      const raw = localStorage.getItem(getLayoutKey(key));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setModifierLayoutByItem(prev => ({ ...prev, [key]: parsed }));
        }
      }
    } catch {}
  }, [modLayoutKey, modifierLayoutByItem]);

  const handleModifierDragEnd = (event: any) => {
    const { active, over } = event;
    const saveKey = modLayoutKey || modCategoryKey || selectedMenuItemId;
    if (!saveKey || !over || active.id === over.id) return;
    const current = (modifierLayoutByItem[saveKey] || slotItemIds).map(String);
    const activeId = String(active.id);
    const overId = String(over.id);
    const oldIdx = current.indexOf(activeId);
    const newIdx = current.indexOf(overId);
    if (oldIdx === -1 || newIdx === -1) return;

    const next = current.slice();
    const emptyToken = `EMPTY:mod:${oldIdx}:${Date.now()}`;
    next[oldIdx] = emptyToken;
    const insertIdx = next.indexOf(overId);
    if (insertIdx !== -1) {
      next.splice(insertIdx, 0, activeId);
    }
    if (next.length > current.length && next[next.length - 1].startsWith('EMPTY:') && next[next.length - 1] !== emptyToken) {
      next.pop();
    }

    if (activeId === BAG_FEE_ID || overId === BAG_FEE_ID) {
      const newPos = next.indexOf(BAG_FEE_ID);
      if (newPos >= 0) setBagFeeSlotIndex(newPos);
    }

    setModifierLayoutByItem(prev => ({ ...prev, [saveKey]: next }));
    try { localStorage.setItem(getLayoutKey(saveKey), JSON.stringify(next)); } catch {}
    modDragItemIdRef.current = null;
  };

  // Drag end handlers
  const handleCategoryDragEnd = (event: any) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    
    console.log('🔍 Drag and drop started:', { active: active.id, over: over.id });
    
    const orderBefore = getCategoryBarOrder();
    const oldIndex = orderBefore.findIndex(id => id === String(active.id));
    const newIndex = orderBefore.findIndex(id => id === String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    
    const orderAfter = [...orderBefore];
    const [movedId] = orderAfter.splice(oldIndex, 1);
    orderAfter.splice(newIndex, 0, movedId);
    console.log('🔄 New order:', orderAfter);
    
    // Persist unified order
    setLayoutSettings(prev => ({ ...prev, categoryBarOrder: orderAfter }));
    
    // Recompute mergedGroups array order and categories array order from unified order
    const merged = layoutSettings.mergedGroups || [];
    const groupMap = new Map(merged.map(g => [g.id, g] as const));
    const catMap = new Map(categories.map(c => [c.category_id.toString(), c] as const));
    const newMergedGroups = orderAfter
      .filter(id => id.startsWith('mergy_'))
      .map(id => groupMap.get(id)!)
      .filter(Boolean);
    const newCategories = orderAfter
      .filter(id => !id.startsWith('mergy_'))
      .map(id => catMap.get(id)!)
      .filter(Boolean);
    
    setLayoutSettings(prev => ({ ...prev, mergedGroups: newMergedGroups }));
      setCategories(prev => {
      // reorder only those in bar; preserve others (if any) after them
      const others = prev.filter(c => !newCategories.some(nc => nc.category_id === c.category_id));
      return [...newCategories, ...others];
    });
  };

    const handleMenuItemDragEnd = (event: any) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    // Merged view: allow reordering within the same original category section only
    if (mergyActive && selectedCategory === MERGY_CATEGORY_ID) {
      const activeItem = menuItems.find(i => String(i.id) === String(active.id));
      const overItem = menuItems.find(i => String(i.id) === String(over.id));
      if (!activeItem || !overItem) return;
      const sourceCategory = activeItem.category;
      const targetCategory = overItem.category;
      if (sourceCategory !== targetCategory) return; // prevent cross-category reorder in merged view
      const categoryItems = menuItems.filter(i => i.category === sourceCategory);
      const ids = categoryItems.map(i => i.id);
      const oldIndex = ids.indexOf(String(active.id));
      const newIndex = ids.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return;
      moveMenuItemInCategory(oldIndex, newIndex, sourceCategory);
      return;
    }

    // Normal category view
    if (!selectedCategory) return;
    const capacity = layoutSettings.categoryColumns;
    const displayed = (selectedCategory ? menuItems.filter(item => item.category === selectedCategory) : menuItems).slice(0, capacity);
    const ids = displayed.map(i => i.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    // If either active/over is an Extra Button, persist its new position
    const isExtra = (id: string) =>
      id === BAG_FEE_ITEM_ID || id === '__EXTRA2_ITEM__' || id === '__EXTRA3_ITEM__';
    if (isExtra(String(active.id)) || isExtra(String(over.id))) {
      const updated: { [id: string]: number } = { ...(layoutSettings.extraButtonPositions || {}) };
      if (isExtra(String(active.id))) updated[String(active.id)] = newIndex;
      if (isExtra(String(over.id))) updated[String(over.id)] = oldIndex;
      updateLayoutSetting('extraButtonPositions', updated);
    }

    moveMenuItemInCategory(oldIndex, newIndex, selectedCategory);
  };

  // Active drag states for overlays
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [activeModifierId, setActiveModifierId] = useState<string | null>(null);
  const modDragItemIdRef = useRef<string | null>(null);



  // helper to get unified order
  const getCategoryBarOrder = useCallback((): string[] => {
    const mergedIds = mergedGroups.map(g => g.id);
    // available categories not inside any merged group
    const available = categories.filter(c => !mergedGroups.some(g => g.categoryNames.includes(c.name)));
    const catIds = available.map(c => c.category_id.toString());
    const computed = [...mergedIds, ...catIds];
    // if state has custom order, keep only still-present ids and append any new ids to the end
    const existing = savedCategoryOrder.filter(id => computed.includes(id));
    const missing = computed.filter(id => !existing.includes(id));
    return [...existing, ...missing];
  }, [categories, mergedGroups, savedCategoryOrder]);

  // 드래그 상태 관리

  // Split Order: 게스트 구분선 추가
  /* handleSplitOrderClick is provided by useOrderManagement hook */

  const {
    categories: hookCategories,
    menuItems: hookMenuItems,
    menuTaxes: hookMenuTaxes,
    itemTaxGroups: hookItemTaxGroups,
    categoryTaxGroups: hookCategoryTaxGroups,
    itemModifierGroups: hookItemModifierGroups,
    categoryModifierGroups: hookCategoryModifierGroups,
    modifierGroupDetailById: hookModifierGroupDetailById,
    itemIdToCategoryId: hookItemIdToCategoryId,
    isLoading: hookIsLoading,
    error: hookError,
    fetchMenuData: fetchMenuDataHook,
    fetchMenuTaxes: fetchMenuTaxesHook,
  } = useMenuData(menuIdNumber, normalizedOrderType, normalizedPriceType);
  const showInitialMenuLoading = hookIsLoading && !hasDisplayedMenuData;
  const showBackgroundMenuLoading = hookIsLoading && hasDisplayedMenuData;

  useEffect(() => { 
    setCategories(hookCategories);
  }, [hookCategories]);

  useEffect(() => {
    initialCategoryAppliedRef.current = false;
    firstCategoryIdRef.current = null;
    setSelectedCategory('');
    setMergyActive(false);
    setCurrentMergyGroupId(null);
  }, [locationKey, menuId, tableIdFromState]);

  // 🎯 화면에 표시되는 첫 번째 카테고리 자동 선택
  useEffect(() => {
    if (!categories || categories.length === 0) return;
    const barOrder = getCategoryBarOrder();
    if (!barOrder || barOrder.length === 0) return;

    const firstOrderId = barOrder[0];
    let nextCategory = '';
    let nextMergyGroup: string | null = null;
    if (firstOrderId.startsWith('mergy_')) {
      const mergedGroup = mergedGroups.find(g => g.id === firstOrderId && Array.isArray(g.categoryNames) && g.categoryNames.length > 0);
      if (!mergedGroup) return;
      nextCategory = MERGY_CATEGORY_ID;
      nextMergyGroup = firstOrderId;
    } else {
      const cat = categories.find(c => c.category_id.toString() === firstOrderId);
      if (!cat) return;
      nextCategory = cat.name;
    }

    if (!nextCategory) return;

    const hasValidSelection =
      selectedCategory === MERGY_CATEGORY_ID ||
      (selectedCategory && categories.some(c => c.name === selectedCategory));

    const shouldApply =
      !initialCategoryAppliedRef.current ||
      !hasValidSelection ||
      firstCategoryIdRef.current !== firstOrderId;

    if (shouldApply) {
      setSelectedCategory(nextCategory);
      setMergyActive(Boolean(nextMergyGroup));
      setCurrentMergyGroupId(nextMergyGroup);
      initialCategoryAppliedRef.current = true;
      firstCategoryIdRef.current = firstOrderId;
    }
  }, [categories, getCategoryBarOrder, MERGY_CATEGORY_ID, mergedGroups, selectedCategory]);
  useEffect(() => {
    queueBackgroundUpdate(() => setMenuItems(hookMenuItems));
  }, [hookMenuItems, queueBackgroundUpdate]);
  useEffect(() => {
    queueBackgroundUpdate(() => setMenuTaxes(hookMenuTaxes));
  }, [hookMenuTaxes, queueBackgroundUpdate]);
  useEffect(() => {
    queueBackgroundUpdate(() => setItemTaxGroups(hookItemTaxGroups));
  }, [hookItemTaxGroups, queueBackgroundUpdate]);
  useEffect(() => {
    queueBackgroundUpdate(() => setCategoryTaxGroups(hookCategoryTaxGroups));
  }, [hookCategoryTaxGroups, queueBackgroundUpdate]);
  useEffect(() => {
    queueBackgroundUpdate(() => setItemModifierGroups(hookItemModifierGroups));
  }, [hookItemModifierGroups, queueBackgroundUpdate]);
  useEffect(() => {
    queueBackgroundUpdate(() => setCategoryModifierGroups(hookCategoryModifierGroups));
  }, [hookCategoryModifierGroups, queueBackgroundUpdate]);
  useEffect(() => {
    queueBackgroundUpdate(() => setModifierGroupDetailById(hookModifierGroupDetailById));
  }, [hookModifierGroupDetailById, queueBackgroundUpdate]);
  useEffect(() => {
    queueBackgroundUpdate(() => setItemIdToCategoryId(hookItemIdToCategoryId));
  }, [hookItemIdToCategoryId, queueBackgroundUpdate]);
  useEffect(() => {
    if (menuIdNumber) {
      fetchMenuDataHook(menuIdNumber);
      fetchMenuTaxesHook(menuIdNumber);
    }
  }, [menuIdNumber, fetchMenuDataHook, fetchMenuTaxesHook]);

  const guestTotals = useMemo(() => {
    const totals: Record<number, number> = {};
    
    orderItems.forEach((item) => {
      if (!item.guestNumber) return;
      if ((item as any).type === 'void' || (item as any).void_id) return;

      if (item.type === 'item') {
        const base = computeItemLineBase(item);
        const disc = computeItemDiscountAmount(item);
        const lineAfter = Math.max(0, base - disc);
        totals[item.guestNumber] = (totals[item.guestNumber] || 0) + lineAfter;
      } else if (item.type === 'discount') {
        // 개별 할인 아이템 합산 (음수)
        const price = Number((item.totalPrice != null ? item.totalPrice : item.price) || 0);
        // totals에 더함 (price가 이미 음수이므로 차감됨)
        totals[item.guestNumber] = (totals[item.guestNumber] || 0) + price;
      }
    });
    
    // 음수가 되지 않도록 보정
    Object.keys(totals).forEach(key => {
        const k = Number(key);
        if (totals[k] < 0) totals[k] = 0;
    });
    
    return totals;
  }, [orderItems, computeItemLineBase, computeItemDiscountAmount]);

  const requestVoid = (amount: number) => {
    // 유지: 다른 기능과의 호환을 위해 남겨둠(현재는 새 모달 사용)
    handleOpenVoid();
  };
  // Print Bill (Pre-bill) 출력 핸들러 - 최소 구현 (헤더/합계/게스트 구분 포함)
  const [showPrintBillModal, setShowPrintBillModal] = useState(false);

  // 공통 Bill 데이터 빌드 함수 (주문 제출 시 Bill과 Print Bill 버튼에서 공통 사용)
  const buildBillDataForPrint = useCallback((options: {
    orderNumber: string;
    channel: string;
    tableName: string;
    serverName: string;
  }) => {
    const items = (orderItems || []).filter(it => it.type === 'item');
    const isTogo = (orderType || '').toLowerCase() === 'togo';
    
    // Calculate gross subtotal (before item discounts)
    const grossSubtotal = items.reduce((sum: number, item: any) => {
      const memoPrice = item.memo && typeof item.memo.price === 'number' ? Number(item.memo.price) : 0;
      const perUnit = Number((item.totalPrice != null ? item.totalPrice : item.price) || 0) + memoPrice;
      return sum + perUnit * (item.quantity || 1);
    }, 0);
    
    // Calculate net subtotal (after item discounts)
    const totals = computeGuestTotals('ALL');
    const billSubtotal = Number((totals.subtotal || 0).toFixed(2));
    const billTaxLines = totals.taxLines || [];
    const billTaxTotal = billTaxLines.reduce((s: number, t: any) => s + (t.amount || 0), 0);
    let billTotal = Number((billSubtotal + billTaxTotal).toFixed(2));
    
    // Calculate total item-level discounts (Item D/C)
    const totalItemDiscount = Number((grossSubtotal - billSubtotal).toFixed(2));
    
    // Build adjustments array
    const adjustments: any[] = [];
    
    // Add Item D/C to adjustments if any item has discount
    if (totalItemDiscount > 0.01) {
      adjustments.push({ label: 'Item Discount', amount: -totalItemDiscount });
      console.log(`🧾 [buildBillData] Item D/C total: -$${totalItemDiscount.toFixed(2)}`);
    }
    
    // Apply POS Promotions for TOGO
    if (isTogo && togoFirebasePromotions.length > 0) {
      const billCartItemIds = items.map((it: any) => String(it.id || it.item_id || it.menuItemId));
      const billCartItemNames = items.map((it: any) => String(it.name || ''));
      const billCartItems = items.map((it: any) => ({
        menuItemId: String(it.id || it.item_id || it.menuItemId),
        name: String(it.name || ''),
        subtotal: Number(it.totalPrice || it.price || 0) * Number(it.quantity || 1),
        quantity: Number(it.quantity || 1)
      }));
      
      let bestBillPromo: FirebasePromotion | null = null;
      let bestBillDiscount = 0;
      
      for (const promo of togoFirebasePromotions) {
        if (checkPromotionApplicable(promo, 'togo', billSubtotal, billCartItemIds, billCartItemNames)) {
          const discount = calculatePromotionDiscount(promo, billSubtotal, billCartItems, 0);
          if (discount > bestBillDiscount) {
            bestBillDiscount = discount;
            bestBillPromo = promo;
          }
        }
      }
      
      if (bestBillPromo && bestBillDiscount > 0) {
        const promoDiscount = Number(bestBillDiscount.toFixed(2));
        adjustments.push({ label: `🎁 ${bestBillPromo.name}`, amount: -promoDiscount });
        billTotal = Number((billTotal - promoDiscount).toFixed(2));
        console.log(`🧾 [buildBillData] Promotion applied: ${bestBillPromo.name} - $${promoDiscount}`);
      }
    }
    
    // Apply Dine-in Promotions
    if (!isTogo && dineInPromotions.length > 0) {
      const billCartItemIds = items.map((it: any) => String(it.id || it.item_id || it.menuItemId));
      const billCartItemNames = items.map((it: any) => String(it.name || ''));
      const billCartItems = items.map((it: any) => ({
        menuItemId: String(it.id || it.item_id || it.menuItemId),
        name: String(it.name || ''),
        subtotal: Number(it.totalPrice || it.price || 0) * Number(it.quantity || 1),
        quantity: Number(it.quantity || 1)
      }));
      
      let bestPromo: FirebasePromotion | null = null;
      let bestDiscount = 0;
      
      for (const promo of dineInPromotions) {
        if (checkPromotionApplicable(promo, 'table', billSubtotal, billCartItemIds, billCartItemNames)) {
          const discount = calculatePromotionDiscount(promo, billSubtotal, billCartItems, 0);
          if (discount > bestDiscount) {
            bestDiscount = discount;
            bestPromo = promo;
          }
        }
      }
      
      if (bestPromo && bestDiscount > 0) {
        const promoDiscount = Number(bestDiscount.toFixed(2));
        adjustments.push({ label: `🎁 ${bestPromo.name}`, amount: -promoDiscount });
        billTotal = Number((billTotal - promoDiscount).toFixed(2));
        console.log(`🧾 [buildBillData] Dine-in Promotion applied: ${bestPromo.name} - $${promoDiscount}`);
      }
    }
    
    // TOGO channel discount
    if (isTogo && togoSettings.discountEnabled && Number(togoSettings.discountValue || 0) > 0) {
      const discountValue = Number(togoSettings.discountValue || 0);
      const discountAmt = togoSettings.discountMode === 'percent'
        ? Number(((billSubtotal * discountValue) / 100).toFixed(2))
        : Number(discountValue.toFixed(2));
      if (discountAmt > 0) {
        adjustments.push({ label: `Discount (${togoSettings.discountMode === 'percent' ? discountValue + '%' : '$' + discountValue})`, amount: -discountAmt });
        billTotal = Number((billTotal - discountAmt).toFixed(2));
        console.log(`🧾 [buildBillData] TOGO channel discount: -$${discountAmt.toFixed(2)}`);
      }
    }
    
    // Bag fee for TOGO
    if (isTogo && togoSettings.bagFeeEnabled && Number(togoSettings.bagFeeValue || 0) > 0) {
      const bagFee = Number(togoSettings.bagFeeValue || 0);
      adjustments.push({ label: 'Bag Fee', amount: bagFee });
      billTotal = Number((billTotal + bagFee).toFixed(2));
    }
    
    // Build billData object
    const billData = {
      header: {
        orderNumber: options.orderNumber,
        channel: options.channel,
        tableName: options.tableName || options.channel,
        serverName: options.serverName
      },
      orderInfo: {
        channel: options.channel,
        tableName: options.tableName || options.channel,
        serverName: options.serverName
      },
      items: items.map((item: any) => {
        // Calculate item-level discount amount
        const base = Number((item.totalPrice != null ? item.totalPrice : item.price) || 0);
        const memoAdd = Number((item.memo?.price) || 0);
        const perUnit = base + memoAdd;
        const itemGross = perUnit * (item.quantity || 1);
        const discountAmount = item.discount ? (itemGross * (item.discount.value || 0)) / 100 : 0;
        const itemNet = itemGross - discountAmount;
        
        return {
          name: item.name,
          quantity: item.quantity || 1,
          price: item.price || 0,
          totalPrice: item.totalPrice || item.price || 0,
          lineTotal: discountAmount > 0 ? itemNet : itemGross, // Final price after discount
          originalTotal: discountAmount > 0 ? itemGross : undefined, // Original price before discount
          discount: item.discount ? {
            type: item.discount.type || 'Item Discount',
            value: item.discount.value || 0,
            amount: discountAmount
          } : undefined,
          modifiers: item.modifiers || [],
          memo: item.memo,
          togoLabel: !!(item as any).togoLabel
        };
      }),
      // Split 테이블인 경우 Guest 분리 표시를 위한 guestSections 생성
      guestSections: (() => {
        // Guest별로 아이템 그룹화
        const byGuest: Record<number, any[]> = {};
        items.forEach((item: any) => {
          const g = item.guestNumber || 1;
          if (!byGuest[g]) byGuest[g] = [];
          
          const base = Number((item.totalPrice != null ? item.totalPrice : item.price) || 0);
          const memoAdd = Number((item.memo?.price) || 0);
          const perUnit = base + memoAdd;
          const itemGross = perUnit * (item.quantity || 1);
          const discountAmount = item.discount ? (itemGross * (item.discount.value || 0)) / 100 : 0;
          const itemNet = itemGross - discountAmount;
          
          byGuest[g].push({
            name: item.name,
            quantity: item.quantity || 1,
            price: item.price || 0,
            totalPrice: discountAmount > 0 ? itemNet : itemGross,
            modifiers: item.modifiers || [],
            memo: item.memo,
            togoLabel: !!(item as any).togoLabel
          });
        });
        
        // 단일 Guest인 경우 guestSections 생략 (기존 동작 유지)
        const guestNumbers = Object.keys(byGuest).map(Number).sort((a, b) => a - b);
        if (guestNumbers.length <= 1) return [];
        
        // 다중 Guest인 경우 guestSections 생성
        return guestNumbers.map(gNum => ({
          guestNumber: gNum,
          items: byGuest[gNum]
        }));
      })(),
      // Show original subtotal if there are item discounts, otherwise show net subtotal
      subtotal: totalItemDiscount > 0.01 ? Number(grossSubtotal.toFixed(2)) : billSubtotal,
      adjustments,
      taxLines: billTaxLines,
      taxesTotal: billTaxTotal,
      total: billTotal,
      footer: { message: 'Thank you for dining with us!' }
    };
    
    console.log(`🧾 [buildBillData] Final billData:`, {
      subtotal: billData.subtotal,
      adjustments: billData.adjustments,
      taxesTotal: billData.taxesTotal,
      total: billData.total
    });
    
    return billData;
  }, [orderItems, orderType, computeGuestTotals, togoFirebasePromotions, dineInPromotions, togoSettings, checkPromotionApplicable, calculatePromotionDiscount]);

  const executePrintBill = async (mode: 'ALL_DETAILS' | 'INDIVIDUAL_GUEST' | 'ALL_SEPARATE', targetGuestId?: number) => {
     try {
      const now = new Date();
      const orderNumber = `PB-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${now.getTime()}`;
      const store = {
        name: (localStorage.getItem('storeName') || 'The Zone POS') as string,
        address: (localStorage.getItem('storeAddress') || '') as string,
        phone: (localStorage.getItem('storePhone') || '') as string,
      };
      const items = (orderItems || []).filter(it => it.type === 'item');
      const byGuest: Record<number, any[]> = {};

      items.forEach(it => {
        const g = it.guestNumber || 1;
        if (!byGuest[g]) byGuest[g] = [];
        const qty = it.quantity || 1;
        const base = (((it.totalPrice||0) + (((it as any).memo && typeof (it as any).memo.price === 'number') ? (it as any).memo.price : 0)) * qty);
        const disc = computeItemDiscountAmount(it as any);
        const discountType = (it as any).discount?.type || 'Item D/C';
        const lineTotal = Math.max(0, base - disc);
        const unitPrice = qty > 0 ? lineTotal / qty : 0;
        byGuest[g].push({
          qty,
          quantity: qty,
          name: it.name,
          price: unitPrice,
          totalPrice: lineTotal,
          modifiers: (it as any).modifiers || [],
          memo: (it as any).memo || null,
          lineTotal,
          originalTotal: disc > 0 ? base : undefined,
          discount: disc > 0 ? {
            type: discountType,
            value: (it as any).discount?.value || 0,
            amount: disc
          } : undefined,
          togoLabel: !!(it as any).togoLabel
        });
      });

      // Helper to build receipt object
      const buildReceipt = (guestList: number[], isIndividual: boolean) => {
         const receiptItems = guestList.map(g => ({ guestNumber: g, items: byGuest[g] || [] }));
         
         // Calculate totals for these specific guests
         let totalSubtotal = 0;
         let totalTax = 0;
         
         // Re-calculate subtotal/tax for the specific guests
         const specificItems = items.filter(it => guestList.includes(it.guestNumber || 1));
         const grossSubtotal = specificItems.reduce((sum, it:any) => sum + ((((it.totalPrice||0) + ((it.memo?.price)||0)) * (it.quantity||1))), 0);
         const totalItemDiscount = specificItems.reduce((sum, it:any) => sum + computeItemDiscountAmount(it), 0);
         const netSubtotal = Math.max(0, grossSubtotal - totalItemDiscount);
         
         // Calculate tax for specific items
         const specificTaxAmountByName: { [taxName: string]: number } = {};
         specificItems.forEach((orderItem: any) => {
            const itemKey = orderItem.id?.toString();
            const itemSubtotal = Math.max(0, ((((orderItem.totalPrice||0) + ((orderItem.memo?.price)||0)) * (orderItem.quantity||1)) - computeItemDiscountAmount(orderItem)));
            const itemGroupIds = itemKey && itemTaxGroups[itemKey] ? itemTaxGroups[itemKey] : [];
            const catId = itemKey ? itemIdToCategoryId[itemKey] : undefined;
            const catGroupIds = typeof catId === 'number' && categoryTaxGroups[catId] ? categoryTaxGroups[catId] : [];
            const mergedGroupIds = Array.from(new Set<number>([...itemGroupIds, ...catGroupIds]));
            
            mergedGroupIds.forEach((gid) => {
                const taxes = taxGroupIdToTaxes[gid] || [];
                taxes.forEach((t) => {
                    const delta = itemSubtotal * (t.rate / 100);
                    specificTaxAmountByName[t.name] = (specificTaxAmountByName[t.name] || 0) + delta;
                });
            });
         });
         const specificTaxLines = Object.entries(specificTaxAmountByName).map(([name, amount]) => ({ name, amount }));
         const specificTaxTotal = specificTaxLines.reduce((s, t) => s + t.amount, 0);
         
         // Item D/C (아이템 할인) - 개별 할인 합계
         const orderDiscountItem = orderItems.find(it => it.id === 'DISCOUNT_ITEM' && it.type === 'discount');
         const receiptAdjustments: Array<{ label: string; amount: number }> = [];
         
         if (totalItemDiscount > 0.01) {
            receiptAdjustments.push({ label: 'Item D/C', amount: -totalItemDiscount });
         }
         
         // Order D/C (전체 할인) - 할인율이면 비율 적용, 할인금액이면 균등 분할
         
         if (orderDiscountItem) {
            const discountData = (orderDiscountItem as any).discount || {};
            const discountMode = discountData.mode || 'percent';
            const discountValue = Number(discountData.value || 0);
            const discountType = discountData.type || 'Order D/C';
            const allGuestNumbers = Array.from(new Set(items.map(it => it.guestNumber || 1))).filter(g => g > 0);
            
            if (allGuestNumbers.length > 0 && discountValue > 0) {
               const guestsInThisReceipt = guestList.filter(g => allGuestNumbers.includes(g));
               
               if (guestsInThisReceipt.length > 0) {
                  let discountForThisReceipt = 0;
                  
                  if (discountMode === 'percent') {
                     // 할인율: 이 영수증에 포함된 게스트들의 소계에 할인율 적용
                     discountForThisReceipt = netSubtotal * (discountValue / 100);
                  } else {
                     // 할인금액: 균등 분할
                     const totalOrderDiscount = Math.abs(Number(orderDiscountItem.totalPrice || orderDiscountItem.price || 0));
                     const discountPerGuest = totalOrderDiscount / allGuestNumbers.length;
                     discountForThisReceipt = discountPerGuest * guestsInThisReceipt.length;
                  }
                  
                  if (discountForThisReceipt > 0) {
                     receiptAdjustments.push({ label: discountType, amount: -discountForThisReceipt });
                  }
               }
            }
         }
         
         const orderAdjustmentsTotal = receiptAdjustments
            .filter(a => a.label !== 'Item D/C')
            .reduce((s, a) => s + a.amount, 0);
         
         // 할인 후 금액에 대해 세금 재계산
         const subtotalAfterDiscount = Math.max(0, netSubtotal + orderAdjustmentsTotal);
         const discountRatio = netSubtotal > 0 ? subtotalAfterDiscount / netSubtotal : 1;
         const taxAfterDiscount = Number((specificTaxTotal * discountRatio).toFixed(2));
         
         return {
            type: 'prebill',
            header: { title: store.name, address: store.address, phone: store.phone, dateTime: getLocalDatetimeString(now), orderNumber, showGuestNumber: true },
            orderInfo: { channel: normalizedOrderType.toUpperCase() === 'POS' ? 'Dine-In' : normalizedOrderType.toUpperCase(), tableName: resolvedTableName || tableNameFromState || undefined, showGuestNumber: true },
            body: { 
                guestSections: receiptItems, 
                subtotal: totalItemDiscount > 0.01 ? Number(grossSubtotal.toFixed(2)) : netSubtotal, 
                adjustments: receiptAdjustments,
                taxLines: specificTaxLines.map(t => ({ ...t, amount: Number((t.amount * discountRatio).toFixed(2)) })), 
                taxesTotal: taxAfterDiscount, 
                total: subtotalAfterDiscount + taxAfterDiscount 
            },
            footer: { message: 'Thank you for dining with us!' }
         };
      };

      if (mode === 'ALL_DETAILS') {
         // 공통 Bill 데이터 빌드 함수 사용 (주문 제출 시 Bill과 동일한 로직)
         const printOrderNumber = savedOrderNumberRef.current ? `#${savedOrderNumberRef.current}` : (savedOrderIdRef.current ? `#${savedOrderIdRef.current}` : orderNumber);
         const channelDisplay = normalizedOrderType.toUpperCase() === 'POS' ? 'Dine-In' : normalizedOrderType.toUpperCase();
         
         const billData = buildBillDataForPrint({
           orderNumber: printOrderNumber,
           channel: channelDisplay,
           tableName: resolvedTableName || tableNameFromState || '',
           serverName: selectedServer?.name || ''
         });
         
         console.log(`🧾 [executePrintBill] Using buildBillDataForPrint - adjustments:`, billData.adjustments);
         
         // Use new print-bill API with billLayout settings (1장만 출력)
         await fetch(`${API_URL}/printers/print-bill`, { 
           method: 'POST', 
           headers: { 'Content-Type': 'application/json' }, 
           body: JSON.stringify({ billData, copies: 1 }) 
         });

      } else if (mode === 'INDIVIDUAL_GUEST' && targetGuestId) {
         const receipt = buildReceipt([targetGuestId], true);
         // Use new print-bill API with billLayout settings (1장만 출력)
         await fetch(`${API_URL}/printers/print-bill`, { 
           method: 'POST', 
           headers: { 'Content-Type': 'application/json' }, 
           body: JSON.stringify({ 
             billData: {
               header: receipt.header,
               orderInfo: receipt.orderInfo,
               guestSections: receipt.body.guestSections,
               subtotal: receipt.body.subtotal,
               adjustments: receipt.body.adjustments,
               taxLines: receipt.body.taxLines,
               taxesTotal: receipt.body.taxesTotal,
               total: receipt.body.total,
               footer: receipt.footer
             },
             copies: 1
           }) 
         });

      } else if (mode === 'ALL_SEPARATE') {
         const allGuestIds = Object.keys(byGuest).map(Number).sort((a,b)=>a-b);
         // Sequentially print each guest bill (1장씩 출력)
         for (const guestId of allGuestIds) {
            const receipt = buildReceipt([guestId], true);
            // Use new print-bill API with billLayout settings (1장만 출력)
            await fetch(`${API_URL}/printers/print-bill`, { 
              method: 'POST', 
              headers: { 'Content-Type': 'application/json' }, 
              body: JSON.stringify({ 
                billData: {
                  header: receipt.header,
                  orderInfo: receipt.orderInfo,
                  guestSections: receipt.body.guestSections,
                  subtotal: receipt.body.subtotal,
                  adjustments: receipt.body.adjustments,
                  taxLines: receipt.body.taxLines,
                  taxesTotal: receipt.body.taxesTotal,
                  total: receipt.body.total,
                  footer: receipt.footer
                },
                copies: 1
              }) 
            });
            // Small delay to prevent printer buffer overflow if needed, or let backend handle queue
         }
      }

      // Update table status to Payment Pending AFTER successful print
      try {
        const tableIdForMap = (location.state && (location.state as any).tableId) || null;
        const floor = (location.state && (location.state as any).floor) || null;
        if (tableIdForMap) {
            // 기존 점유 시간 읽기
            let oldTs = Date.now();
            let occupiedAtStr: string | null = null;
            try {
                const oldRaw = localStorage.getItem('lastOccupiedTable');
                if (oldRaw) {
                    const parsed = JSON.parse(oldRaw);
                    if (parsed.tableId === tableIdForMap && parsed.ts) {
                        oldTs = parsed.ts;
                        occupiedAtStr = getLocalDatetimeString(new Date(oldTs));
                    }
                }
            } catch {}

            const body: any = { status: 'Payment Pending' };
            if (occupiedAtStr) body.occupiedAt = occupiedAtStr;

            fetch(`${API_URL}/table-map/elements/${encodeURIComponent(tableIdForMap)}/status`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            }).catch(err => console.warn('Failed to update status to Payment Pending:', err));

            try {
                localStorage.setItem('lastOccupiedTable', JSON.stringify({
                    tableId: tableIdForMap,
                    floor,
                    status: 'Payment Pending',
                    ts: oldTs // 기존 시간 유지
                }));
            } catch {}
        }
      } catch (err) {
        console.warn('Error updating table status on Print Bill:', err);
      }

    } catch (e) {
      console.error('Print Bill failed', e);
      alert('Print Bill failed');
    }
  };

  const saveOrderToBackend = async (orderItemsOverride?: any[]) => {
    const source = Array.isArray(orderItemsOverride) ? orderItemsOverride : (orderItems || []);
    // Include discount items so they are saved with guest numbers
    const items = (source || []).filter((it: any) => it && (it.type === 'item' || it.type === 'discount'));
    if (items.length === 0) return false;

    const now = new Date();
    const orderNumber = `ORD-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${now.getTime()}`;
    
    const tableIdForMap = (location.state && (location.state as any).tableId) || null;
    
    // Calculate total: Items (positive) + Discounts (negative)
    const baseTotal = items.reduce((s,it:any)=> {
        if (it.type === 'discount') {
            return s + Number(it.totalPrice || it.price || 0);
        }
        return s + Math.max(0, ((((it.totalPrice||0) + ((it.memo?.price)||0)) * (it.quantity||1)) - computeItemDiscountAmount(it)));
    }, 0);
    
    const adjustments: any[] = [];
    // Old discount adjustment logic removed to avoid double counting
    
    let adjustedTotal = Math.max(0, Number(baseTotal.toFixed(2)));

    // Determine channel for promotion filtering
    const isTogo = (orderType||'').toLowerCase()==='togo';
    const promoChannel = isTogo ? 'togo' : 'table';
    
    // Apply promotions (works for both Dine-In and Togo with channel filtering)
    const todayKey = getLocalDateString();
    const usageKey = tableIdForMap ? `promo_used_${tableIdForMap}_${todayKey}` : null;
    const alreadyUsedToday = usageKey ? (localStorage.getItem(usageKey) === '1') : false;
    
    let promoApplied = false;
    
    // For Togo orders, try POS promotions first
    if (isTogo && togoFirebasePromotions.length > 0) {
        console.log('🎁 [Togo Promo] Checking promotions, count:', togoFirebasePromotions.length, 'subtotal:', adjustedTotal);
        const cartItemIds = items.map((it: any) => String(it.id || it.item_id || it.menuItemId));
        const cartItemNames = items.map((it: any) => String(it.name || ''));
        const cartItems = items.map((it: any) => ({
            menuItemId: String(it.id || it.item_id || it.menuItemId),
            name: String(it.name || ''),
            subtotal: Number(it.totalPrice || it.price || 0) * Number(it.quantity || 1),
            quantity: Number(it.quantity || 1)
        }));
        console.log('🎁 [Togo Promo] Cart item IDs:', cartItemIds, 'Names:', cartItemNames);
        
        // Find best applicable POS promotion
        let bestPromo: FirebasePromotion | null = null;
        let bestDiscount = 0;
        
        for (const promo of togoFirebasePromotions) {
            const isApplicable = checkPromotionApplicable(promo, 'togo', adjustedTotal, cartItemIds, cartItemNames);
            console.log(`🎁 [Togo Promo] Checking "${promo.name}": applicable=${isApplicable}, minOrder=${promo.minOrderAmount}, type=${promo.type}, selectedItems=${(promo as any).selectedItems?.join(',')}, selectedCategories=${(promo as any).selectedCategories?.join(',')}`);
            if (isApplicable) {
                const discount = calculatePromotionDiscount(promo, adjustedTotal, cartItems, 0);
                console.log(`🎁 [Togo Promo] "${promo.name}" discount: $${discount.toFixed(2)}`);
                if (discount > bestDiscount) {
                    bestDiscount = discount;
                    bestPromo = promo;
                }
            }
        }
        
        if (bestPromo && bestDiscount > 0) {
            const amountApplied = Number(bestDiscount.toFixed(2));
            adjustedTotal = Math.max(0, Number((adjustedTotal - amountApplied).toFixed(2)));
            adjustments.push({
                kind: 'PROMOTION',
                mode: bestPromo.type === 'fixed_discount' ? 'amount' : 'percent',
                value: bestPromo.discountPercent || bestPromo.discountAmount || 0,
                amountApplied,
                label: bestPromo.name || 'Promotion'
            });
            setTogoAppliedPromotion(bestPromo);
            promoApplied = true;
            console.log(`🎁 Togo Firebase promotion applied: ${bestPromo.name} - $${amountApplied}`);
        }
    }
    
    // For Dine-in orders, try POS promotions
    console.log('🎁 [DINE-IN CHECK] isTogo:', isTogo, 'promoApplied:', promoApplied, 'dineInPromotions.length:', dineInPromotions.length, 'orderType:', orderType);
    if (!isTogo && !promoApplied && dineInPromotions.length > 0) {
        console.log('🎁 [Dine-in Promo] Checking promotions, count:', dineInPromotions.length, 'subtotal:', adjustedTotal);
        const cartItemIds = items.map((it: any) => String(it.id || it.item_id || it.menuItemId));
        const cartItemNames = items.map((it: any) => String(it.name || ''));
        const cartItems = items.map((it: any) => ({
            menuItemId: String(it.id || it.item_id || it.menuItemId),
            name: String(it.name || ''),
            subtotal: Number(it.totalPrice || it.price || 0) * Number(it.quantity || 1),
            quantity: Number(it.quantity || 1)
        }));
        
        let bestPromo: FirebasePromotion | null = null;
        let bestDiscount = 0;
        
        for (const promo of dineInPromotions) {
            const isApplicable = checkPromotionApplicable(promo, 'table', adjustedTotal, cartItemIds, cartItemNames);
            console.log(`🎁 [Dine-in Promo] Checking "${promo.name}": applicable=${isApplicable}`);
            if (isApplicable) {
                const discount = calculatePromotionDiscount(promo, adjustedTotal, cartItems, 0);
                console.log(`🎁 [Dine-in Promo] "${promo.name}" discount: $${discount.toFixed(2)}`);
                if (discount > bestDiscount) {
                    bestDiscount = discount;
                    bestPromo = promo;
                }
            }
        }
        
        if (bestPromo && bestDiscount > 0) {
            const amountApplied = Number(bestDiscount.toFixed(2));
            adjustedTotal = Math.max(0, Number((adjustedTotal - amountApplied).toFixed(2)));
            adjustments.push({
                kind: 'PROMOTION',
                mode: bestPromo.type === 'fixed_discount' ? 'amount' : 'percent',
                value: bestPromo.discountPercent || bestPromo.discountAmount || 0,
                amountApplied,
                label: bestPromo.name || 'Promotion'
            });
            promoApplied = true;
            console.log(`🎁 Dine-in POS promotion applied: ${bestPromo.name} - $${amountApplied}`);
        }
    }
    
    // Fallback to local promotions if no POS promotion was applied
    if (!promoApplied) {
        const promoAdj = computePromotionAdjustment(items as any, { 
            enabled: promotionEnabled && !alreadyUsedToday, 
            type: promotionType as any, 
            value: (typeof promotionValue === 'number' ? promotionValue : 0), 
            eligibleItemIds: promotionEligibleItemIds, 
            codeInput: '', 
            rules: promotionRules,
            channel: promoChannel as any
        });
        if (promoAdj) {
            const amountApplied = promoAdj.amountApplied;
            adjustedTotal = Math.max(0, Number((adjustedTotal - amountApplied).toFixed(2)));
            adjustments.push({
                kind:'PROMOTION',
                mode: promoAdj.mode,
                value: promoAdj.value,
                amountApplied,
                label: promoAdj.label || 'Promotion'
            });
            try {
                if (usageKey) localStorage.setItem(usageKey, '1');
                const customerName = (location.state && (location.state as any).customerName) || null;
                if (customerName) localStorage.setItem(`promo_used_customer_${customerName}_${todayKey}`, '1');
            } catch {}
        }
    }
    
    // TOGO channel discount (from channel settings) - applied AFTER promotions
    if (isTogo && togoSettings.discountEnabled && Number(togoSettings.discountValue || 0) > 0) {
        const discountValue = Number(togoSettings.discountValue || 0);
        const discountAmt = togoSettings.discountMode === 'percent'
            ? Number(((adjustedTotal * discountValue) / 100).toFixed(2))
            : Number(discountValue.toFixed(2));
        if (discountAmt > 0) {
            adjustedTotal = Math.max(0, Number((adjustedTotal - discountAmt).toFixed(2)));
            const discountLabel = togoSettings.discountMode === 'percent'
                ? `Discount (${discountValue}%)`
                : 'Discount';
            adjustments.push({
                kind: 'CHANNEL_DISCOUNT',
                mode: togoSettings.discountMode,
                value: discountValue,
                amountApplied: discountAmt,
                label: discountLabel
            });
            console.log(`🧾 [saveOrderToBackend] TOGO channel discount applied: ${discountLabel} - $${discountAmt.toFixed(2)}`);
        }
    }
    
    // Bag fee for Togo orders only
    if (isTogo && togoSettings.bagFeeEnabled && togoSettings.bagFeeValue>0) {
        const bv = Number(togoSettings.bagFeeValue)||0;
        const amountApplied = bv;
        adjustedTotal = Number((adjustedTotal + amountApplied).toFixed(2));
        adjustments.push({
            kind:'BAG_FEE',
            mode: 'amount',
            value: bv,
            amountApplied: Number(amountApplied.toFixed(2)),
            label: 'Bag Fee'
        });
    }

    const itemsWithLineId = items.map((it:any) => {
        if (!it.orderLineId) {
          const newLineId = `${it.id}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
          return { ...it, orderLineId: newLineId };
        }
        return it;
    });

    if (!savedOrderIdRef.current) {
        const saveRes = await fetch(`${API_URL}/orders`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderNumber,
            orderType: orderType || 'POS',
            total: adjustedTotal,
            items: itemsWithLineId.map((it:any)=> ({ id: it.id, name: it.name, quantity: it.quantity, price: it.totalPrice, guestNumber: it.guestNumber || 1, modifiers: it.modifiers || [], memo: it.memo || null, discount: (it as any).discount || null, splitDenominator: it.splitDenominator || null, splitNumerator: it.splitNumerator || null, orderLineId: it.orderLineId, togoLabel: it.togoLabel || false, taxGroupId: it.taxGroupId || null, printerGroupId: it.printerGroupId || null })),
            adjustments,
            tableId: tableIdForMap,
            serverId: selectedServer?.id || null,
            serverName: selectedServer?.name || null,
            customerName: getPersistableCustomerName(),
            customerPhone: orderCustomerInfo.phone || null,
            fulfillmentMode: orderFulfillmentMode || null,
            readyTime: orderPickupInfo.readyTimeLabel || null,
            pickupMinutes: orderPickupInfo.pickupMinutes ?? null,
            kitchenNote: savedKitchenMemo || null,
            orderSource: (location.state as any)?.deliveryCompany || null
          })
        });
        if (!saveRes.ok) throw new Error('Failed to save order');
        const savedOrder = await saveRes.json();
        const newOrderId = savedOrder?.orderId ?? savedOrder?.id;
        try { savedOrderIdRef.current = newOrderId ?? savedOrderIdRef.current; } catch {}
        try { savedOrderNumberRef.current = savedOrder?.order_number || String(savedOrder?.dailyNumber || '').padStart(3, '0') || savedOrderNumberRef.current; } catch {}
        
        // New Order Created: Clear stale paidGuests state for this table to prevent merging old data
        try {
          if (tableIdForMap) {
            localStorage.removeItem(`paidGuests_${tableIdForMap}`);
          }
        } catch {}
        
        if (selectedServer) persistServerSelection(selectedServer);
        
        setOrderItems(prev => prev.map(it => {
          if (it.type !== 'item' && it.type !== 'discount') return it;
          const found = itemsWithLineId.find((item:any) => 
            item.id === it.id && 
            (item.guestNumber || 1) === (it.guestNumber || 1) &&
            JSON.stringify(item.modifiers || []) === JSON.stringify(it.modifiers || [])
          );
          if (found && !(it as any).orderLineId) return { ...it, orderLineId: found.orderLineId } as any;
          return it;
        }));
        
        try {
          // 명시적으로 tableIdForMap을 사용하여 로컬 스토리지와 DB 업데이트 (타입 안전성 확보)
          if (tableIdForMap && newOrderId) {
            const key = `lastOrderIdByTable_${tableIdForMap}`;
            localStorage.setItem(key, String(newOrderId));
            await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(String(tableIdForMap))}/current-order`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderId: newOrderId })
            }).catch(e => console.warn('Failed to link table to order:', e));
            
            // Ensure table status becomes Occupied when a new order is successfully saved
            await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(String(tableIdForMap))}/status`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'Occupied' })
            }).catch(e => console.warn('Failed to set table status to Occupied:', e));
          }
        } catch {}
    } else {
        const putRes = await fetch(`${API_URL}/orders/${encodeURIComponent(String(savedOrderIdRef.current))}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            total: adjustedTotal,
            items: itemsWithLineId.map((it:any)=> ({ id: it.id, name: it.name, quantity: it.quantity, price: it.totalPrice, guestNumber: it.guestNumber || 1, modifiers: it.modifiers || [], memo: it.memo || null, discount: (it as any).discount || null, splitDenominator: it.splitDenominator || null, splitNumerator: it.splitNumerator || null, orderLineId: it.orderLineId, togoLabel: it.togoLabel || false, taxGroupId: it.taxGroupId || null, printerGroupId: it.printerGroupId || null })),
            adjustments,
            serverId: selectedServer?.id || null,
            serverName: selectedServer?.name || null,
            customerName: getPersistableCustomerName(),
            customerPhone: orderCustomerInfo.phone || null,
            fulfillmentMode: orderFulfillmentMode || null,
            readyTime: orderPickupInfo.readyTimeLabel || null,
            pickupMinutes: orderPickupInfo.pickupMinutes ?? null,
            kitchenNote: savedKitchenMemo || null,
            orderSource: (location.state as any)?.deliveryCompany || null
          })
        });
        if (!putRes.ok) throw new Error('Failed to update order');
        if (selectedServer) persistServerSelection(selectedServer);
        
        setOrderItems(prev => prev.map(it => {
          if (it.type !== 'item' && it.type !== 'discount') return it;
          const found = itemsWithLineId.find((item:any) => 
            item.id === it.id && 
            (item.guestNumber || 1) === (it.guestNumber || 1) &&
            JSON.stringify(item.modifiers || []) === JSON.stringify(it.modifiers || [])
          );
          if (found && !(it as any).orderLineId) return { ...it, orderLineId: found.orderLineId } as any;
          return it;
        }));

        try {
          if (tableIdForMap && savedOrderIdRef.current) {
            const key = `lastOrderIdByTable_${tableIdForMap}`;
            localStorage.setItem(key, String(savedOrderIdRef.current));
            await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(String(tableIdForMap))}/current-order`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderId: savedOrderIdRef.current })
            }).catch(e => console.warn('Failed to relink table to order:', e));

            // 새로운 아이템이 추가된 경우에만 Occupied로 상태 변경 (Payment Pending 유지)
            const hasNewItemsInUpdate = itemsWithLineId.some((it:any) => !it.orderLineId);
            if (hasNewItemsInUpdate) {
              // 기존 점유 시간 읽기
              let oldTs = Date.now();
              let occupiedAtStr: string | null = null;
              try {
                  const oldRaw = localStorage.getItem('lastOccupiedTable');
                  if (oldRaw) {
                      const parsed = JSON.parse(oldRaw);
                      if (parsed.tableId === tableIdForMap && parsed.ts) {
                          oldTs = parsed.ts;
                          occupiedAtStr = getLocalDatetimeString(new Date(oldTs));
                      }
                  }
              } catch {}

              const body: any = { status: 'Occupied' };
              if (occupiedAtStr) body.occupiedAt = occupiedAtStr;

              await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(String(tableIdForMap))}/status`, {
                  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(body)
              }).catch(e => console.warn('Failed to restore table status to Occupied:', e));
              
              try {
                  const floor = (location.state && (location.state as any).floor) || null;
                  localStorage.setItem('lastOccupiedTable', JSON.stringify({
                      tableId: tableIdForMap,
                      floor,
                      status: 'Occupied',
                      ts: oldTs
                  }));
              } catch {}
            }
          }
        } catch {}
    }
    return true;
  };

  const printKitchenOrders = async (wasUpdateMode: boolean, orderItemsOverride?: any[]) => {
      const source = Array.isArray(orderItemsOverride) ? orderItemsOverride : (orderItems || []);
      const items = (source || []).filter((it: any) => it && it.type === 'item');
      const printItems: any[] = [];
      
      items.forEach((it:any) => {
        const hasOrderLineId = !!it.orderLineId;
        const orderLineId = hasOrderLineId ? String(it.orderLineId) : '';
        const currentQty = Number(it.quantity || 0);
        const originalSavedQtyRaw =
          (wasUpdateMode && orderLineId)
            ? (originalSavedQuantitiesRef.current[orderLineId] as any)
            : undefined;
        // In update mode, a line that is NOT in originalSavedQuantitiesRef is a newly added line.
        const isNewLineInUpdate = !!(wasUpdateMode && orderLineId && (originalSavedQtyRaw == null));
        
        // Print policy:
        // - New order OR no orderLineId: print full quantity
        // - Update mode:
        //   - New line (not in baseline): print full quantity
        //   - Existing line: print (currentQty - originalSavedQty), do NOT rely on quantityDelta (can be missing in prod builds)
        let printQty = 0;
        if (!wasUpdateMode || !hasOrderLineId) {
          printQty = currentQty;
        } else if (isNewLineInUpdate) {
          printQty = currentQty;
        } else {
          const originalSavedQtyNum = Number(originalSavedQtyRaw ?? 0);
          if (Number.isFinite(originalSavedQtyNum)) {
            printQty = currentQty - originalSavedQtyNum;
          } else {
            // Fallback: if baseline is invalid, treat as full quantity (better than silently skipping)
            printQty = currentQty;
          }
        }
        if (!printQty || Number(printQty) <= 0) return;
          
          // 프린터 그룹 ID들 수집
          const printerGroupIds = Array.isArray(it.printerGroupIds) ? it.printerGroupIds : 
                                  Array.isArray(it.printer_groups) ? it.printer_groups :
                                  (it.printerGroupId || it.printer_group_id) ? [it.printerGroupId || it.printer_group_id] : [];
          
          printItems.push({
            id: it.id,
            orderLineId: it.orderLineId || null,
            name: it.short_name || it.name || 'Unknown',
            qty: printQty,
            lineQuantityAfter: it.quantity,
            guestNumber: it.guestNumber || 1,
            modifiers: (it as any).modifiers || [],
            memo: (it as any).memo || null,
            discount: (it as any).discount || null,
            printerGroupIds: printerGroupIds,
            togoLabel: !!(it as any).togoLabel
          });
      });
      
      // Kitchen Note는 orderInfo.kitchenNote로 전달됨 (Body 하단에 고정 출력)
      
      // 주문 타입 결정 (DINE-IN, TOGO, ONLINE 등)
      const currentOrderType = (orderType || 'dine-in').toUpperCase();
      const orderTypeDisplay = currentOrderType === 'TOGO' ? 'TOGO' : 
                               currentOrderType === 'ONLINE' ? 'ONLINE' : 
                               currentOrderType === 'DELIVERY' ? 'DELIVERY' : 'DINE-IN';

      // 딜리버리 주문은 items가 없어도 Kitchen Ticket 출력 필요
      const isDeliveryOrder = orderTypeDisplay === 'DELIVERY';
      
      if (printItems.length === 0 && !isDeliveryOrder) {
        console.log('🖨️ No items to print');
        return;
      }

      // 통합 출력 API 호출 (프린터별로 한 번씩만 출력)
      const printTableName = resolvedTableName || tableNameFromState || '';
      const printServerName = selectedServer?.name || '';
      const printOrderNumber = savedOrderNumberRef.current ? `#${savedOrderNumberRef.current}` : (savedOrderIdRef.current || `ORD-${Date.now()}`);
      
      // 딜리버리 정보 추출
      const deliveryCompany = (location.state as any)?.deliveryCompany || '';
      const deliveryOrderNumber = (location.state as any)?.deliveryOrderNumber || '';
      
      console.log('🖨️ Sending to print-order API:', printItems.length, 'items', isDeliveryOrder ? `(Delivery: ${deliveryCompany} #${deliveryOrderNumber})` : '');
      try {
        const response = await fetch(`${API_URL}/printers/print-order`, { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' }, 
          body: JSON.stringify({ 
            items: printItems,
            orderInfo: {
              orderNumber: printOrderNumber,
              table: printTableName,
              tableName: printTableName,
              tableId: tableIdFromState || '',
              server: printServerName,
              orderType: orderTypeDisplay,
              channel: orderTypeDisplay,
              pickupTime: orderPickupInfo.readyTimeLabel || '',
              pickupMinutes: orderPickupInfo.pickupMinutes,
              kitchenNote: savedKitchenMemo || '',
              // 딜리버리 주문 정보 추가
              deliveryCompany: deliveryCompany,
              deliveryOrderNumber: deliveryOrderNumber,
              // 고객 정보 (입력값 있을 때만 출력됨)
              customerName: getPersistableCustomerName() || '',
              customerPhone: orderCustomerInfo?.phone || ''
            },
            isAdditionalOrder: wasUpdateMode,
            // Delivery 주문은 항상 PAID로 출력
            isPaid: isDeliveryOrder
          }) 
        });
        const result = await response.json();
        console.log('🖨️ Print-order result:', result);
        
        if (result.success) {
          console.log(`🖨️ Kitchen print complete: ${result.message}`);
          // Mark printed lines as "saved baseline" so future additional prints don't reprint them.
          // For existing lines, this advances the baseline to the current quantity.
          // For newly added lines, this records their initial saved quantity.
          try {
            if (wasUpdateMode && Array.isArray(printItems)) {
              for (const pi of printItems) {
                const lid = pi?.orderLineId ? String(pi.orderLineId) : '';
                if (!lid) continue;
                const qAfter = Number(pi?.lineQuantityAfter);
                if (Number.isFinite(qAfter) && qAfter > 0) {
                  originalSavedQuantitiesRef.current[lid] = qAfter;
                }
              }
            }
          } catch {}
        } else {
          console.error('❌ Print-order failed:', result.error);
        }

        // TOGO/ONLINE/DELIVERY 주문 완료 시: Kitchen Ticket만 출력 (Bill/Receipt 자동 출력 제거)
      } catch (err) {
        console.error('❌ Print-order error:', err);
      }

      setOrderItems(prev => prev.map(it => {
        if ((it as any).quantityDelta) return { ...it, quantityDelta: 0 } as any;
        return it;
      }));
  };

  const handlePrintBill = async () => {
     try {
       // 0. 주문 저장 (데이터 소실 방지) - saveOrderToBackend 내부에서 이미 orderId 갱신 및 localStorage/DB 매핑을 처리함
       const saved = await saveOrderToBackend();
       // 저장 로직이 실패했거나, orderId가 확보되지 않은 경우 처리
       const items = (orderItems || []).filter(it => it.type === 'item');
       if (items.length > 0 && (!savedOrderIdRef.current)) {
          // 아이템이 있는데 저장된 ID가 없으면 심각한 오류
          alert('Cannot proceed with Print Bill because order save failed.');
          return;
       }
     } catch (e) {
       console.error('Order save failed before print:', e);
       alert('Order save failed. Please try again.');
       return;
     }

     // 1. Check if bill is split
     const hasSplit = (guestIds.length > 1) || (orderItems || []).some(it => it.type === 'separator');
     
     if (!hasSplit) {
        await executePrintBill('ALL_DETAILS');
        navigate('/sales', { replace: true });
     } else {
        setShowPrintBillModal(true);
     }
  };

  // OK: 프린터 전송 → 주문 초기화 → /sales 복귀 (빈 주문이면 바로 이동)
  const handleOkClick = async () => {
    try {
      const items = (orderItems || []).filter(it => it.type === 'item');
      const tableIdForMap = (location.state && (location.state as any).tableId) || null;
      const floor = (location.state && (location.state as any).floor) || null;
      const allGuestsPaid = (() => {
        try {
          const totalPaidSoFar = sessionPayments.reduce((s, p) => s + p.amount, 0);
          if (totalPaidSoFar > 0 && totalPaidSoFar < payGrandAll - 0.01) return false;
          const ids = Array.isArray(guestIds) ? guestIds : [];
          if (ids.length === 0) return false;
          return ids.every(g => (guestStatusMap as any)[g] === 'PAID');
        } catch { return false; }
      })();

      // If nothing to save OR everything is already paid → exit or mark table Preparing
      if (items.length === 0 || allGuestsPaid) {
        try {
          if (tableIdForMap) {
            // If no items at all: Don't change status (keep Available if it was)
            // If all guests paid: Set to Available (Preparing 제거)
            if (allGuestsPaid && items.length > 0) {
              await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(tableIdForMap)}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Available' }) });
              try { localStorage.setItem('lastOccupiedTable', JSON.stringify({ tableId: tableIdForMap, floor, status: 'Available', ts: Date.now() })); } catch {}
            }
            // If items.length === 0: Don't update status at all (leave it as is)
            
            // Clear order link regardless
            try { localStorage.removeItem(`lastOrderIdByTable_${tableIdForMap}`); } catch {}
            try { localStorage.removeItem(`voidDisplay_${tableIdForMap}`); } catch {}
          }
        } catch {}
        clearServerAssignmentForContext();
        setSelectedServer(null);
        navigate('/sales', { replace: true });
        return;
      }

      // 저장 전 상태 확인 (새 주문인지 업데이트인지)
      const wasUpdateMode = !!savedOrderIdRef.current;
      const hasNewItems = items.some((it:any) => !it.orderLineId);

      // 추가주문(update mode)에서는 "증가분 기준"이 꼬여서 0으로 계산되는 것을 피하기 위해:
      // - 먼저 현재 스냅샷 기준으로 출력(증가분만)
      // - 그 다음 저장
      // 신규 주문은 기존대로 저장 후 출력
      const stamp = Date.now();
      let seq = 0;
      const orderItemsSnapshot = (orderItems || []).map((it: any) => {
        if (!it || (it.type !== 'item' && it.type !== 'discount')) return it;
        if (it.orderLineId) return it;
        seq += 1;
        return { ...it, orderLineId: `${it.id}-${stamp}-${seq}` };
      });

      if (wasUpdateMode) {
        try {
          await printKitchenOrders(true, orderItemsSnapshot);
        } catch {}
      }

      // 1. DB 저장
      const saved = await saveOrderToBackend(orderItemsSnapshot);
      
      // 1.5. Delivery 주문이면 delivery_orders 테이블에 order_id 연결
      const isDeliveryOrder = (orderType || '').toUpperCase() === 'DELIVERY';
      const deliveryMetaId = (location.state as any)?.deliveryMetaId || (location.state as any)?.id;
      if (isDeliveryOrder && deliveryMetaId && savedOrderIdRef.current) {
        try {
          await fetch(`${API_URL}/orders/delivery-orders/${deliveryMetaId}/link`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: savedOrderIdRef.current })
          });
          console.log(`🚗 Linked delivery_order ${deliveryMetaId} to order ${savedOrderIdRef.current}`);
        } catch (e) {
          console.warn('Failed to link delivery order:', e);
        }
      }
      
      // 2. 주방 프린트
      if (saved) {
         if (!wasUpdateMode) {
           await printKitchenOrders(false, orderItemsSnapshot);
         }
      }

      // 3. 게스트 상태 저장 - 제거됨 (OK 시점에 불완전한 상태를 저장하면 재진입시 PAID로 잠기는 문제 발생)
      /*
      try {
        const orderId = savedOrderIdRef.current;
        if (orderId) {
          const statuses = Object.entries(guestStatusMap).map(([g, st]) => ({ guestNumber: Number(g), status: st, locked: st === 'PAID' }));
          await fetch(`${API_URL}/orders/${encodeURIComponent(String(orderId))}/guest-status/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ statuses })
          });
        }
      } catch {}
      */

      // 4. Split 정보 저장
      try {
        if (tableIdForMap) {
          const guestNumbers = Array.from(new Set((orderItems || []).filter(it => it.type === 'separator' && typeof it.guestNumber === 'number').map(it => it.guestNumber as number))).sort((a,b)=>a-b);
          if (guestNumbers.length > 1) {
            localStorage.setItem(`splitGuests_${tableIdForMap}`, JSON.stringify(guestNumbers));
          } else {
            localStorage.removeItem(`splitGuests_${tableIdForMap}`);
          }
        }
      } catch {}

      // 5. 테이블 상태 업데이트
      try {
        const tableId = tableIdForMap;
        if (tableId) {
          if (hasNewItems) {
             // 새로운 아이템이 추가되었으면 Occupied로 변경 (점유 시간은 유지)
             const floor = (location.state as any)?.floor || '1F';
             
             // 기존 점유 시간 읽기
             let oldTs = Date.now();
             let occupiedAtStr: string | null = null;
             try {
                 const oldRaw = localStorage.getItem('lastOccupiedTable');
                 if (oldRaw) {
                     const parsed = JSON.parse(oldRaw);
                     if (parsed.tableId === tableId && parsed.ts) {
                         oldTs = parsed.ts;
                         occupiedAtStr = getLocalDatetimeString(new Date(oldTs));
                     }
                 }
             } catch {}

             const body: any = { status: 'Occupied' };
             if (occupiedAtStr) body.occupiedAt = occupiedAtStr;

             await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(tableId)}/status`, {
               method: 'PATCH',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify(body)
             });
             try { localStorage.setItem('lastOccupiedTable', JSON.stringify({ tableId, floor, status: 'Occupied', ts: oldTs })); } catch {}
          } else {
             // 새 아이템이 없으면 -> 상태 변경 안 함 (Payment Pending 등 기존 상태 유지)
             // Note: Payment Pending 상태는 결제 완료(handleCompletePayment)에서만 Preparing으로 변경됨
          }
        }
      } catch (e) {
        console.warn('Table status update failed (ignored):', e);
      }

      // 5) 정리 및 이동: 테이블맵으로 이동하지만, VOID 표시를 유지하기 위해 로컬 스냅샷은 삭제하지 않음
      navigate('/sales', { replace: true });
    } catch (e) {
      console.error('OK flow failed', e);
      alert('OK processing failed');
    }
  };

  const handleVoidPayment = async (paymentId: number) => {
    try {
      const res = await fetch(`${API_URL}/payments/${paymentId}/void`, { method: 'POST' });
      if (!res.ok) throw new Error('Payment cancellation failed');
      let removed: { paymentId: number; method: string; amount: number; tip: number; guestNumber?: number } | undefined;
      setSessionPayments(prev => {
        const idx = prev.findIndex(p => p.paymentId === paymentId);
        if (idx >= 0) removed = prev[idx];
        const copy = [...prev];
        if (idx >= 0) copy.splice(idx, 1);
        return copy;
      });
      if (removed) {
        if (removed.guestNumber) {
          const key = String(removed.guestNumber);
          setPaymentsByGuest(prev => {
            const next = { ...prev } as Record<string, number>;
            next[key] = Math.max(0, Number(((next[key] || 0) - (removed!.amount)).toFixed(2)));
            return next;
          });
        } else {
          // ALL bucket was not used for stored entries in current logic; skip
        }
      }
      alert('Payment has been cancelled.');
    } catch (e) {
      console.error(e);
      alert('An error occurred while cancelling payment.');
    }
  };

  const handleClearAllPayments = async () => {
    try {
      const payments = [...sessionPayments];
      for (const p of payments) {
        try {
          const res = await fetch(`${API_URL}/payments/${p.paymentId}/void`, { method: 'POST' });
          if (!res.ok) throw new Error('Payment cancellation failed');
        } catch (e) {
          console.warn('Some payment cancellation failed:', p.paymentId, e);
        }
      }
    } catch (e) {
      console.error('Error during payment initialization:', e);
    } finally {
      setSessionPayments([]);
      setPaymentsByGuest({});
    }
  };

  const handleClearScopedPayments = async (paymentIds: number[]) => {
    try {
      const idSet = new Set((paymentIds || []).filter((id) => typeof id === 'number' && Number.isFinite(id)));
      if (idSet.size === 0) return;
      const toVoid = sessionPayments.filter(p => idSet.has(p.paymentId));
      for (const p of toVoid) {
        try {
          const res = await fetch(`${API_URL}/payments/${p.paymentId}/void`, { method: 'POST' });
          if (!res.ok) throw new Error('Payment cancellation failed');
        } catch (e) {
          console.warn('Some payment cancellation failed:', p.paymentId, e);
        }
      }
      // Remove locally (single state update)
      setSessionPayments(prev => prev.filter(p => !idSet.has(p.paymentId)));
      // Adjust guest paid tracking and revert persisted PAID status if fully voided
      const affectedGuests = new Set<number>();
      const voidedAmountByGuest: Record<string, number> = {};
      toVoid.forEach((p) => {
        const g = p.guestNumber;
        if (typeof g === 'number') {
          affectedGuests.add(g);
          const key = String(g);
          voidedAmountByGuest[key] = (voidedAmountByGuest[key] || 0) + (p.amount || 0);
        }
      });
      setPaymentsByGuest(prev => {
        const next = { ...prev } as Record<string, number>;
        affectedGuests.forEach(g => {
          const key = String(g);
          next[key] = Math.max(0, Number(((next[key] || 0) - (voidedAmountByGuest[key] || 0)).toFixed(2)));
        });
        return next;
      });
      // Revert persisted PAID guests whose remaining paid amount is now 0
      const guestsToUnpaid: number[] = [];
      affectedGuests.forEach(g => {
        const key = String(g);
        const remainingSessionPaid = sessionPayments
          .filter(p => !idSet.has(p.paymentId) && p.guestNumber === g)
          .reduce((s, p) => s + (p.amount || 0), 0);
        if (remainingSessionPaid < 0.01) {
          guestsToUnpaid.push(g);
        }
      });
      if (guestsToUnpaid.length > 0) {
        const unpaidSet = new Set(guestsToUnpaid);
        setPersistedPaidGuests(prev => prev.filter(g => !unpaidSet.has(g)));
        // Update DB guest status back to UNPAID
        const currentOrderId = savedOrderIdRef.current || (location.state && (location.state as any).orderId);
        if (currentOrderId) {
          try {
            await fetch(`${API_URL}/orders/${encodeURIComponent(String(currentOrderId))}/guest-status/bulk`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ statuses: guestsToUnpaid.map(g => ({ guestNumber: g, status: 'UNPAID', locked: false })) })
            });
          } catch (dbErr) {
            console.error('Failed to revert guest PAID status in DB:', dbErr);
          }
        }
        // Clear localStorage paid guest data
        if (currentOrderId) {
          try {
            const orderKey = `paidGuests_order_${currentOrderId}`;
            const raw = localStorage.getItem(orderKey);
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed && Array.isArray(parsed.paidGuests)) {
                parsed.paidGuests = parsed.paidGuests.filter((g: number) => !unpaidSet.has(g));
                localStorage.setItem(orderKey, JSON.stringify(parsed));
              }
            }
          } catch {}
        }
      }
    } catch (e) {
      console.error('Clear scoped payments failed:', e);
    }
  };

  // 1) computeGuestTotals를 useCallback으로 감싸서 useMemo/useEffect에서 안전하게 사용 가능하게 함
  // [Duplicate Removed] - Already defined at line ~2690
  // const computeGuestTotals = useCallback((mode: 'ALL' | number) => { ... });

  // 2) 그 다음 useMemo 훅들이 computeGuestTotals를 사용
  const sortedGuestIds = useMemo(() => {
    const ids = new Set<number>();
    (orderItems || []).forEach((it: any) => {
      if (it.type === 'separator' && typeof it.guestNumber === 'number') ids.add(it.guestNumber);
      if (it.guestNumber && it.type !== 'separator') ids.add(it.guestNumber);
    });
    // Add persisted paid guests to ensure they appear even if items removed (though logic usually keeps them)
    if (Array.isArray(persistedPaidGuests)) {
      persistedPaidGuests.forEach(g => ids.add(g));
    }
    
    const isPaidByPersistOrHeuristic = (g: number): boolean => {
      if (Array.isArray(persistedPaidGuests) && persistedPaidGuests.includes(g)) return true;
      // If not persisted, check if amounts match (heuristic)
      const { grand: approxTotal } = computeGuestTotals(g);
      const paid = Number((paymentsByGuest[String(g)] || 0).toFixed(2));
      const EPS = 0.05;
      const hasItems = approxTotal > EPS;
      const hasPaid = paid > EPS;
      if (!hasItems && !hasPaid) return false;
      return (approxTotal - paid) <= EPS;
    };
    return Array.from(ids).sort((a, b) => {
      const ka = isPaidByPersistOrHeuristic(a) ? 1 : 0;
      const kb = isPaidByPersistOrHeuristic(b) ? 1 : 0;
      if (ka !== kb) return ka - kb; // 미결제(0) 먼저, 결제(1) 나중
      return a - b;
    });
  }, [orderItems, guestCount, paymentsByGuest, persistedPaidGuests, computeGuestTotals]);

  // Precompute ALL-scope totals for PaymentModal (used for Pay in Full)
  const { subtotal: paySubtotalAll, taxLines: payTaxLinesAll, grand: payGrandAll } = useMemo(() => {
    const base = computeGuestTotals('ALL');
    const baseTaxLines = base.taxLines || [];
    const isTogo = (orderType || '').toLowerCase() === 'togo';

    const adjustments: any[] = [];
    if (isTogo) {
      if (togoSettings.discountEnabled && Number(togoSettings.discountValue || 0) > 0) {
        const dv = Number(togoSettings.discountValue || 0);
        const discountAmt = computeDiscountAmount(base.subtotal, (togoSettings.discountMode === 'amount' ? 'amount' : 'percent') as any, dv);
        if (discountAmt > 0) adjustments.push({ kind: 'DISCOUNT', label: 'TOGO Discount', amount: discountAmt });
      }
      if (togoSettings.bagFeeEnabled && Number(togoSettings.bagFeeValue || 0) > 0) {
        const feeAmt = Number(Number(togoSettings.bagFeeValue || 0).toFixed(2));
        if (feeAmt > 0) adjustments.push({ kind: 'FEE', label: 'Bag Fee', amount: feeAmt });
      }
    }

    const applied = applySubtotalAdjustments({ subtotal: base.subtotal, taxLines: baseTaxLines }, adjustments);
    return { subtotal: applied.subtotal, taxLines: applied.taxLines, grand: applied.total } as any;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderItems, orderType, taxLines, computeGuestTotals, togoSettings]);

  const { subtotal: paySubtotal, taxLines: payTaxLines, grand: payGrand } = useMemo(() => {
    if (guestPaymentMode === 'ALL') {
      return { subtotal: paySubtotalAll, taxLines: payTaxLinesAll, grand: payGrandAll };
    }
    const base = computeGuestTotals(guestPaymentMode);
    const baseTaxLines = base.taxLines || [];
    const isTogo = (orderType || '').toLowerCase() === 'togo';

    const adjustments: any[] = [];
    if (isTogo) {
      if (togoSettings.discountEnabled && Number(togoSettings.discountValue || 0) > 0) {
        const dv = Number(togoSettings.discountValue || 0);
        const discountAmt = computeDiscountAmount(base.subtotal, (togoSettings.discountMode === 'amount' ? 'amount' : 'percent') as any, dv);
        if (discountAmt > 0) adjustments.push({ kind: 'DISCOUNT', label: 'TOGO Discount', amount: discountAmt });
      }
      if (togoSettings.bagFeeEnabled && Number(togoSettings.bagFeeValue || 0) > 0) {
        const feeAmt = Number(Number(togoSettings.bagFeeValue || 0).toFixed(2));
        if (feeAmt > 0) adjustments.push({ kind: 'FEE', label: 'Bag Fee', amount: feeAmt });
      }
    } else {
      const items = (orderItems || []).filter(it =>
        it.type !== 'separator' && (it.guestNumber || 1) === guestPaymentMode
      );
      const promoAdj = computePromotionAdjustment(items as any, {
        enabled: promotionEnabled,
        type: promotionType as any,
        value: (typeof promotionValue === 'number' ? promotionValue : 0),
        eligibleItemIds: promotionEligibleItemIds,
        codeInput: '',
        rules: promotionRules,
      });
      const discountAmt = promoAdj ? promoAdj.amountApplied : 0;
      if (discountAmt > 0) adjustments.push({ kind: 'DISCOUNT', label: 'Promotion', amount: Number(discountAmt.toFixed(2)) });
    }

    const applied = applySubtotalAdjustments({ subtotal: base.subtotal, taxLines: baseTaxLines }, adjustments);
    return { subtotal: applied.subtotal, taxLines: applied.taxLines, grand: applied.total };

  }, [
    guestPaymentMode,
    computeGuestTotals,
    paySubtotalAll,
    payTaxLinesAll,
    payGrandAll,
    taxLines,
    orderItems,
    orderType,
    togoSettings,
    promotionEnabled,
    promotionType,
    promotionValue,
    promotionEligibleItemIds,
    promotionRules,
  ]);

  
  const paidSoFarCurrent = useMemo(() => {
    if (guestPaymentMode === 'ALL') return Object.values(paymentsByGuest).reduce((s, v) => s + (v||0), 0);
    return paymentsByGuest[String(guestPaymentMode)] || 0;
  }, [paymentsByGuest, guestPaymentMode]);
  const { grand: allGrand } = useMemo(() => computeGuestTotals('ALL'), [orderItems, itemTaxGroups, itemIdToCategoryId, categoryTaxGroups, taxGroupIdToTaxes]);
  const paidSoFarAll = useMemo(() => Object.values(paymentsByGuest).reduce((s, v) => s + (v||0), 0), [paymentsByGuest]);
  const outstandingDueAll = useMemo(() => Math.max(0, Number((allGrand - paidSoFarAll).toFixed(2))), [allGrand, paidSoFarAll]);

  const paymentModalCalc = useMemo(() => {
    const foodPaid = sessionPayments.reduce((s, p) => s + (p.amount || 0), 0);
    const remaining = Math.max(0, Number((payGrandAll - foodPaid).toFixed(2)));
    const ratio = payGrandAll > 0 ? remaining / payGrandAll : 1;

    let sub: number;
    let tl: Array<{ name: string; amount: number }>;
    let tot: number;
    let oDue: number;
    let pSoFar: number;
    let filteredPayments: typeof sessionPayments;

    if (adhocSplitCount > 0 && typeof guestPaymentMode === 'number') {
      const balance = Math.max(0, Number((payGrandAll - foodPaid).toFixed(2)));
      const balanceRatio = payGrandAll > 0 ? balance / payGrandAll : 1;
      sub = Number((paySubtotalAll * balanceRatio).toFixed(2));
      tl = payTaxLinesAll.map((t: any) => ({ ...t, amount: Number((t.amount * balanceRatio).toFixed(2)) }));
      tot = balance;
      oDue = balance;
      pSoFar = 0;
      filteredPayments = sessionPayments.filter(p => !priorPaymentIdsRef.current.has(p.paymentId));
    } else if (foodPaid > 0.005) {
      sub = Number((paySubtotalAll * ratio).toFixed(2));
      tl = payTaxLinesAll.map((t: any) => ({ ...t, amount: Number((t.amount * ratio).toFixed(2)) }));
      tot = remaining;
      oDue = remaining;
      pSoFar = 0;
      filteredPayments = sessionPayments.filter(p => !priorPaymentIdsRef.current.has(p.paymentId));
    } else {
      sub = guestPaymentMode === 'ALL' ? paySubtotalAll : paySubtotal;
      tl = guestPaymentMode === 'ALL' ? payTaxLinesAll : payTaxLines;
      tot = guestPaymentMode === 'ALL' ? payGrandAll : payGrand;
      oDue = guestPaymentMode === 'ALL' ? remaining : Math.max(0, Number((payGrand - paidSoFarCurrent).toFixed(2)));
      pSoFar = guestPaymentMode === 'ALL' ? paidSoFarAll : paidSoFarCurrent;
      filteredPayments = sessionPayments;
    }

    return { subtotal: sub, taxLines: tl, total: tot, outstandingDue: oDue, paidSoFar: pSoFar, filteredPayments };
  }, [sessionPayments, payGrandAll, paySubtotalAll, payTaxLinesAll, adhocSplitCount, guestPaymentMode,
      paySubtotal, payTaxLines, payGrand, paidSoFarCurrent, paidSoFarAll]);

  // Removed auto-complete: require explicit Next click to navigate to table map

  // When SplitBillModal is open and all guests are fully paid, auto-complete and navigate to Table Map
  useEffect(() => {
    try {
      if (!showSplitBillModal) return;
      
      // 아이템이 있는 게스트만 확인 (아이템 없는 게스트는 제외)
      const guestsWithItems = (guestIds || []).filter((g: number) => {
        const items = (orderItems || []).filter(it => it.type !== 'separator' && (it.guestNumber || 1) === g);
        return items.length > 0;
      });
      
      if (guestsWithItems.length === 0) return;
      
      // 모든 게스트가 PAID 상태인지 확인 (guestStatusMap 또는 persistedPaidGuests 사용)
      const allGuestsPaid = guestsWithItems.every((g: number) => {
        const statusFromMap = guestStatusMap && guestStatusMap[g];
        const isPersisted = Array.isArray(persistedPaidGuests) && persistedPaidGuests.includes(g);
        return statusFromMap === 'PAID' || isPersisted;
      });
      
      console.log(`🔍 Split Bill auto-complete check: guestsWithItems=${guestsWithItems}, allGuestsPaid=${allGuestsPaid}`);
      
      if (allGuestsPaid) {
        console.log(`✅ All guests paid! Auto-completing and navigating to table map...`);
        setShowSplitBillModal(false);
        // 테이블맵으로 이동 (Receipt는 이미 개별 게스트 결제 시 출력됨)
        clearServerAssignmentForContext();
        setSelectedServer(null);
        navigate('/sales', { replace: true });
      }
    } catch (err) {
      console.error('Auto-complete check error:', err);
    }
  }, [showSplitBillModal, guestIds, orderItems, guestStatusMap, persistedPaidGuests]);

  // For SplitBillModal: per-guest precise grand/tax and overall totals (using computeGuestTotals)
  const splitGuestTotals = useMemo(() => {
    try {
      const byGuest: Record<number, { grand: number; tax: number; subtotal: number }> = {} as any;
      (guestIds || []).forEach((g: number) => {
        const res = computeGuestTotals(g as any);
        const guestSubtotal = Number((res.subtotal || 0).toFixed(2));
        // If subtotal is 0 (100% discount), tax should also be 0
        const rawTax = (res.taxLines || []).reduce((s: number, t: any) => s + (t.amount || 0), 0);
        const tax = guestSubtotal <= 0 ? 0 : rawTax;
        const grand = guestSubtotal <= 0 ? 0 : Number((res.grand || 0).toFixed(2));
        byGuest[g] = { grand: Number(grand.toFixed(2)), tax: Number(tax.toFixed(2)), subtotal: guestSubtotal };
      });
      const all = computeGuestTotals('ALL');
      const allSubtotal = Number((all.subtotal || 0).toFixed(2));
      // If subtotal is 0 (100% discount), tax should also be 0
      const rawAllTax = (all.taxLines || []).reduce((s: number, t: any) => s + (t.amount || 0), 0);
      const allTax = allSubtotal <= 0 ? 0 : rawAllTax;
      const allGrand = allSubtotal <= 0 ? 0 : Number((all.grand || 0).toFixed(2));
      return { byGuest, allGrand: Number(allGrand.toFixed(2)), allTax: Number(allTax.toFixed(2)) };
    } catch { return { byGuest: {}, allGrand: 0, allTax: 0 }; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestIds, orderItems]);

  // Pay Balance mode: when some portion is already paid and there is still due remaining
  const hasSomeGuestsPaid = useMemo(() => {
    try {
      const anyPaidSession = Object.values(paymentsByGuest).some(v => (v || 0) > 0);
      const anyPersistedPaid = Array.isArray(persistedPaidGuests) && persistedPaidGuests.length > 0;
      return (anyPaidSession || anyPersistedPaid) && outstandingDueAll > 0.005;
    } catch { return false; }
  }, [paymentsByGuest, persistedPaidGuests, outstandingDueAll]);

  // Remaining totals (Items/Tax/Total) = sum of guests' remaining amounts (exclude persisted paid; pro-rate partial payments)
  const balanceTotalsAll = useMemo(() => {
    if (!hasSomeGuestsPaid) return null as null | { subtotal: number; taxLines: Array<{ name: string; amount: number }>; grand: number };
    try {
      const EPS = 0.005;
      let subtotalRemain = 0;
      let taxRemain = 0;
      (guestIds || []).forEach((g: number) => {
        // If guest is persisted-paid, exclude fully
        if (Array.isArray(persistedPaidGuests) && persistedPaidGuests.includes(g)) return;
        const ref = (splitGuestTotals && (splitGuestTotals as any).byGuest && (splitGuestTotals as any).byGuest[g]) ? (splitGuestTotals as any).byGuest[g] : null;
        const sub = ref ? (ref.subtotal || 0) : computeGuestTotals(g as any).subtotal;
        const tax = ref ? (ref.tax || 0) : Number(((computeGuestTotals(g as any).taxLines || []).reduce((s: number, t: any) => s + (t.amount || 0), 0)).toFixed(2));
        const grandGuest = Number(((sub) + (tax)).toFixed(2));
        const paid = Number(((paymentsByGuest[String(g)] || 0)).toFixed(2));
        const due = Math.max(0, Number((grandGuest - paid).toFixed(2)));
        if (due <= EPS) return;
        // Pro-rate remaining across subtotal and tax to maintain breakdown
        const ratio = grandGuest > 0 ? Math.max(0, Math.min(1, Number((due / grandGuest).toFixed(6)))) : 0;
        subtotalRemain += Number(((sub * ratio)).toFixed(2));
        taxRemain += Number(((tax * ratio)).toFixed(2));
      });
      subtotalRemain = Number((subtotalRemain).toFixed(2));
      taxRemain = Number((taxRemain).toFixed(2));
      const grand = Number((subtotalRemain + taxRemain).toFixed(2));
      return { subtotal: subtotalRemain, taxLines: [{ name: 'Tax', amount: taxRemain }], grand };
    } catch { return null; }
  }, [hasSomeGuestsPaid, guestIds, paymentsByGuest, persistedPaidGuests, splitGuestTotals]);



  // Expose split totals to SplitBillModal via window (lightweight bridge without prop threading here)
  useEffect(() => {
    try {
      (window as any).__ORDER_SPLIT_TOTALS__ = splitGuestTotals;
    } catch {}
  }, [splitGuestTotals]);

  React.useEffect(() => {
    try {
      if (DEBUG) { console.log('guestStatusMap snapshot', guestStatusMap); }
    } catch {}
  }, [guestStatusMap]);

  // Persist to DB on payment completion or when guest status changes with an orderId
  React.useEffect(() => {
    (async () => {
      try {
        const orderId = savedOrderIdRef.current;
        if (!orderId) return;
        // Build payload from computed status (locked when PAID)
        const statuses = Object.entries(guestStatusMap).map(([g, st]) => ({ guestNumber: Number(g), status: st, locked: st === 'PAID' }));
        await fetch(`${API_URL}/orders/${encodeURIComponent(String(orderId))}/guest-status/bulk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ statuses })
        });
      } catch (e) {
        console.warn('Failed to persist guest status (non-fatal):', e);
      }
    })();
  }, [guestStatusMap]);

  // 페이지 로드 시 DB에서 결제된 게스트 상태 불러오기
  const loadPersistedPaidGuests = React.useCallback(async () => {
    try {
      const orderId = savedOrderIdRef.current || orderIdFromState || null;
      if (!orderId) {
        setPersistedPaidGuests([]);
        return;
      }
      console.log(`📥 Loading guest payment status from DB for order ${orderId}...`);
      const res = await fetch(`${API_URL}/orders/${encodeURIComponent(String(orderId))}/guest-status`);
      if (!res.ok) {
        setPersistedPaidGuests([]);
        return;
      }
      const data = await res.json();
      if (!data || !Array.isArray(data.statuses)) {
        setPersistedPaidGuests([]);
        return;
      }
      const paidFromDb: number[] = [];
      (data.statuses || []).forEach((row: any) => {
        const g = Number(row.guestNumber);
        const st = String(row.status || 'UNPAID').toUpperCase();
        if (st === 'PAID' || row.locked) paidFromDb.push(g);
      });
      // DB에 결과가 없으면 localStorage fallback
      if (paidFromDb.length === 0) {
        try {
          const lsRaw = localStorage.getItem(`paidGuests_order_${orderId}`);
          if (lsRaw) {
            const lsParsed = JSON.parse(lsRaw);
            if (lsParsed && Array.isArray(lsParsed.paidGuests)) {
              lsParsed.paidGuests.forEach((g: any) => {
                const num = Number(g);
                if (Number.isFinite(num) && num > 0) paidFromDb.push(num);
              });
            }
          }
        } catch {}
      }
      const sorted = Array.from(new Set(paidFromDb)).sort((a,b)=>a-b);
      console.log(`📥 Loaded paid guests from DB:`, sorted);
      setPersistedPaidGuests(sorted);
      splitDataRestoredRef.current = true;
      console.log(`🔍 [SPLIT DEBUG] splitDataRestoredRef = true (DB load done, paid=${JSON.stringify(sorted)})`);
    } catch {
      setPersistedPaidGuests([]);
      splitDataRestoredRef.current = true;
      console.log(`🔍 [SPLIT DEBUG] splitDataRestoredRef = true (DB load failed/empty)`);
    }
  }, [orderIdFromState]);

  React.useEffect(() => {
    loadPersistedPaidGuests();
  }, [loadPersistedPaidGuests]);

  // Reorder guest blocks on the left list: UNPAID/PARTIAL first, PAID last
  React.useEffect(() => {
    try {
      if (!Array.isArray(orderItems) || orderItems.length === 0) return;
      const EPS = 0.05;
      const nonSepItems = (orderItems || []).filter(it => it.type !== 'separator');
      if (nonSepItems.length === 0) return;

      const guestsPresent = Array.from(new Set<number>(nonSepItems.map(it => Number((it as any).guestNumber || 1)))).filter(n => Number.isFinite(n) && n > 0).sort((a,b)=>a-b);
      if (guestsPresent.length <= 1) return;

      const inlineTotals = (g: number) => nonSepItems.filter(it => (it as any).guestNumber === g)
        .reduce((s, it: any) => s + (((it.totalPrice||0) + ((it.memo?.price)||0)) * (it.quantity||1)), 0);
      const isPaidGuest = (g: number): boolean => {
        if (Array.isArray(persistedPaidGuests) && persistedPaidGuests.includes(g)) return true;
        if (guestStatusMap && guestStatusMap[g] === 'PAID') return true;
        const approxTotal = inlineTotals(g);
        const paid = Number((paymentsByGuest[String(g)] || 0).toFixed(2));
        const hasItems = approxTotal > EPS;
        const hasPaid = paid > EPS;
        if (!hasItems && !hasPaid) return false;
        return (approxTotal - paid) <= EPS;
      };

      const desiredOrder = [...guestsPresent].sort((a, b) => {
        const ka = isPaidGuest(a) ? 1 : 0;
        const kb = isPaidGuest(b) ? 1 : 0;
        if (ka !== kb) return ka - kb; // unpaid/partial first
        return a - b;
      });

      // Build normalized list: [sep(g1), items(g1), sep(g2), items(g2), ...]
      const normalized: any[] = [];
      desiredOrder.forEach(g => {
        normalized.push({ id: `sep-guest-${g}`, name: `구분선 Guest ${g}`, quantity: 0, price: 0, totalPrice: 0, type: 'separator', guestNumber: g });
        nonSepItems.forEach(it => { if ((it as any).guestNumber === g) normalized.push(it); });
      });

      // Compare signatures to avoid unnecessary state churn
      const curSig = JSON.stringify((orderItems || []).map((it: any) => `${it.type}:${it.guestNumber||''}:${it.orderLineId||it.id}`));
      const nextSig = JSON.stringify(normalized.map((it: any) => `${it.type}:${it.guestNumber||''}:${it.orderLineId||it.id}`));
      if (curSig !== nextSig) {
        setOrderItems(normalized as any);
      }
    } catch {}
  }, [orderItems, paymentsByGuest, guestStatusMap, persistedPaidGuests]);
  // Clear stale persisted PAID flags when starting a brand new unpaid order on same table
  // DB에서 결제 데이터가 복원 완료될 때까지 localStorage 조작을 방지
  const splitDataRestoredRef = React.useRef(false);
  React.useEffect(() => {
    if (!splitDataRestoredRef.current) {
      console.log(`🔍 [SPLIT DEBUG] Clear-stale skip (DB restore not done)`);
      return;
    }
    try {
      const anyPaidSession = Object.values(paymentsByGuest).some(v => (v || 0) > 0);
      const orderId = savedOrderIdRef.current || ((location.state && (location.state as any).orderId) || null);
      
      const allGuestsUnpaid = Object.values(guestStatusMap).every(st => st === 'UNPAID');
      
      const hasPersistedPaid = Array.isArray(persistedPaidGuests) && persistedPaidGuests.length > 0;
      console.log(`🔍 [SPLIT DEBUG] Clear-stale check: anyPaid=${anyPaidSession}, allUnpaid=${allGuestsUnpaid}, hasPersistedPaid=${hasPersistedPaid}, orderId=${orderId}, guestStatusMap=${JSON.stringify(guestStatusMap)}, paymentsByGuest=${JSON.stringify(paymentsByGuest)}`);
      
      if (!anyPaidSession && allGuestsUnpaid && !hasPersistedPaid && orderId) {
        console.log(`🔍 [SPLIT DEBUG] ⚠️ CLEARING localStorage paidGuests_order_${orderId}`);
        try { 
          localStorage.removeItem(`paidGuests_order_${orderId}`); 
        } catch {}
      }
    } catch {}
  }, [orderIdFromState, paymentsByGuest, guestStatusMap]);

  // Persist PAID guests so UI lock survives navigation back to table map and return
  // DB에서 결제 데이터가 복원 완료될 때까지 빈 paidGuests로 덮어쓰기 방지
  React.useEffect(() => {
    if (!splitDataRestoredRef.current) {
      console.log(`🔍 [SPLIT DEBUG] Persist-paid skip (DB restore not done)`);
      return;
    }
    try {
      const orderId = savedOrderIdRef.current;
      if (!orderId) return;
      
      const paidGuests = Object.entries(guestStatusMap)
        .filter(([g, st]) => st === 'PAID')
        .map(([g]) => Number(g))
        .filter(g => {
           const paidAmount = Number((paymentsByGuest[String(g)] || 0).toFixed(2));
           return paidAmount > 0.01;
        });

      let splitN = adhocSplitCount > 1 ? adhocSplitCount : (guestIds.length > 1 ? guestIds.length : 0);
      const orderKey = `paidGuests_order_${orderId}`;
      let existingPaidGuests: number[] | undefined;
      let existingPreSplitLineIds: string[] | undefined;
      let existingSplitCount = 0;
      try {
        const existingRaw = localStorage.getItem(orderKey);
        if (existingRaw) {
          const existingParsed = JSON.parse(existingRaw);
          if (existingParsed && Array.isArray(existingParsed.paidGuests)) {
            existingPaidGuests = existingParsed.paidGuests;
          }
          if (existingParsed && Array.isArray(existingParsed.preSplitLineIds)) {
            existingPreSplitLineIds = existingParsed.preSplitLineIds;
          }
          if (existingParsed && existingParsed.splitCount > 1) {
            existingSplitCount = existingParsed.splitCount;
          }
        }
      } catch {}
      if (splitN <= 0 && existingSplitCount > 1) {
        splitN = existingSplitCount;
      }
      // paymentsByGuest가 아직 비어있고, 기존 localStorage에 paidGuests가 있으면 보존
      const totalPayments = Object.values(paymentsByGuest).reduce((s: number, v: any) => s + (Number(v) || 0), 0);
      const finalPaidGuests = (paidGuests.length === 0 && totalPayments < 0.01 && Array.isArray(existingPaidGuests) && existingPaidGuests.length > 0)
        ? existingPaidGuests
        : paidGuests;
      const preSplitLineIds = existingPreSplitLineIds || (orderItems || []).filter((it: any) => it && it.orderLineId && it.type === 'item').map((it: any) => it.orderLineId);
      const payload = { paidGuests: finalPaidGuests, ts: Date.now(), orderId: orderId, splitCount: splitN, preSplitLineIds };
      console.log(`🔍 [SPLIT DEBUG] Persist-paid: saving paidGuests=${JSON.stringify(finalPaidGuests)}, splitN=${splitN}, totalPayments=${totalPayments}, existingPaid=${JSON.stringify(existingPaidGuests)}`);
      localStorage.setItem(orderKey, JSON.stringify(payload));
    } catch {}
  }, [guestStatusMap, paymentsByGuest]);

  // 왼쪽 목록 내에서 아이템 순서 재배치 (separator 제외한 슬롯 기준)
  const handleReorderLeft = (sourceRowIndex: number, destIndex: number) => {
    setOrderItems(prev => {
      if (sourceRowIndex < 0 || sourceRowIndex >= prev.length) return prev;
      if (prev[sourceRowIndex]?.type === 'separator') return prev;
      const nonSepGlobal = prev
        .map((it, idx) => ({ it, idx }))
        .filter(x => x.it.type !== 'separator')
        .map(x => x.idx);
      let targetSlot = destIndex;
      if (!Number.isFinite(targetSlot)) targetSlot = 0;
      if (targetSlot < 0) targetSlot = 0;
      if (targetSlot > nonSepGlobal.length) targetSlot = nonSepGlobal.length;
      const destGlobal = targetSlot < nonSepGlobal.length
        ? nonSepGlobal[targetSlot]
        : (nonSepGlobal[nonSepGlobal.length - 1] ?? prev.length - 1) + 1;
      const next = [...prev];
      const [moved] = next.splice(sourceRowIndex, 1);
      const adjusted = sourceRowIndex < destGlobal ? destGlobal - 1 : destGlobal;
      next.splice(Math.max(0, Math.min(next.length, adjusted)), 0, moved);
      return next;
    });
  };
  // 기존 주문 불러오기 (Occupied 테이블)
  useEffect(() => {
    const run = async () => {
      try {
        const st: any = location.state || {};
        if (!st || !st.tableId) return;
        if (!st.loadExisting) return;
        
        // 주문 ID 결정: 여러 소스에서 가장 신뢰할 수 있는 값 사용
        // 1순위: navigation state의 orderId (SalesPage에서 직접 전달)
        // 2순위: localStorage (주문 저장 시 설정됨)
        // 3순위: table element의 current_order_id (DB)
        let resolvedOrderId: string | null = null;
        
        // navigation state에서 orderId 확인
        if (st.orderId) {
          resolvedOrderId = String(st.orderId);
        }
        
        // localStorage에서 확인
        const mapKey = `lastOrderIdByTable_${st.tableId}`;
        const savedOrderId = localStorage.getItem(mapKey);
        if (!resolvedOrderId && savedOrderId) {
          resolvedOrderId = savedOrderId;
        }
        
        // table element의 current_order_id에서 확인 (보조 수단)
        try {
          const elRes = await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(st.tableId)}`);
          if (elRes.ok) {
            const el = await elRes.json();
            if (el && el.current_order_id != null) {
              // DB에 current_order_id가 있으면 이를 우선 사용
              resolvedOrderId = String(el.current_order_id);
              // localStorage도 동기화
              try { localStorage.setItem(mapKey, resolvedOrderId); } catch {}
            } else if (!resolvedOrderId) {
              // DB에도 없고 다른 소스에서도 못 찾았으면 → 주문 없음
              try { localStorage.removeItem(mapKey); } catch {}
              return;
            }
            // DB의 current_order_id가 null이지만 다른 소스에서 orderId를 찾은 경우 → 계속 진행
          }
          // fetch 실패 시 → resolvedOrderId가 있으면 계속 진행 (localStorage/navigation state 기반)
        } catch {}
        
        if (!resolvedOrderId) return;
        try { savedOrderIdRef.current = Number(resolvedOrderId); } catch {}
        const res = await fetch(`${API_URL}/orders/${encodeURIComponent(resolvedOrderId)}`);
        try { savedOrderNumberRef.current = null; } catch {}
        if (!res.ok) return;
        const json = await res.json();
        savedOrderNumberRef.current = json?.order?.order_number || null;
        applyCustomerInfoFromOrder(json?.order);
        const serverIdFromApi = json?.order?.server_id || json?.order?.serverId;
        const serverNameFromApi = json?.order?.server_name || json?.order?.serverName;
        if (serverIdFromApi && serverNameFromApi) {
          setSelectedServer(prev => prev ?? { id: String(serverIdFromApi), name: String(serverNameFromApi) });
        }
        if (json && json.order && String(json.order.status).toUpperCase() === 'PAID') {
          try { localStorage.removeItem(mapKey); } catch {}
          return;
        }
        const items = Array.isArray(json.items) ? json.items : [];
        
        // Store original quantities for saved items
        items.forEach((it: any) => {
          if (it.order_line_id) {
            originalSavedQuantitiesRef.current[it.order_line_id] = it.quantity || 1;
          }
        });
        
        let preSplitLineIdSet: Set<string> | null = null;
        let lsSplitCountRestore = 0;
        try {
          const pgRaw = localStorage.getItem(`paidGuests_order_${resolvedOrderId}`);
          if (pgRaw) {
            const pgParsed = JSON.parse(pgRaw);
            if (pgParsed && Array.isArray(pgParsed.preSplitLineIds)) {
              preSplitLineIdSet = new Set(pgParsed.preSplitLineIds.map(String));
            }
            if (pgParsed && pgParsed.splitCount > 1) {
              lsSplitCountRestore = pgParsed.splitCount;
            }
          }
        } catch {}
        const restored = items.map((it:any) => ({
          id: it.item_id?.toString() || it.id?.toString() || Math.random().toString(),
          name: it.name,
          quantity: it.quantity || 1,
          price: it.price || 0,
          totalPrice: it.price || 0,
          type: (Number(it.price || 0) < 0) ? 'discount' : 'item',
          guestNumber: Number(it.guest_number || it.guestNumber || 1),
          modifiers: (() => { try { return JSON.parse(it.modifiers_json || '[]'); } catch { return []; } })(),
          memo: (() => { try { return it.memo_json ? JSON.parse(it.memo_json) : undefined; } catch { return undefined; } })(),
          discount: (() => { try { return it.discount_json ? JSON.parse(it.discount_json) : undefined; } catch { return undefined; } })(),
          splitDenominator: (typeof it.split_denominator === 'number' && it.split_denominator > 0) ? it.split_denominator : undefined,
          splitNumerator: (typeof it.split_numerator === 'number' && it.split_numerator > 0) ? it.split_numerator : undefined,
          orderLineId: it.order_line_id || undefined,
          item_source: it.item_source || undefined,
          togoLabel: !!(it.togo_label || it.togoLabel),
          _preSplit: preSplitLineIdSet
            ? preSplitLineIdSet.has(it.order_line_id || '')
            : (lsSplitCountRestore > 1 && Number(it.price || 0) >= 0)
        }));
        // Restore existing payments from DB
        try {
          if (resolvedOrderId) {
            const payRes = await fetch(`${API_URL}/payments/order/${resolvedOrderId}`);
            if (payRes.ok) {
              const payJson = await payRes.json();
              const dbPayments = Array.isArray(payJson.payments) ? payJson.payments : [];
              const activePayments = dbPayments.filter((p: any) => p.status !== 'voided' && p.status !== 'VOIDED');
              if (activePayments.length > 0) {
                setSessionPayments(activePayments.map((p: any) => ({
                  paymentId: p.id,
                  method: p.payment_method || '',
                  amount: Math.max(0, Number(p.amount || 0) - Number(p.tip || 0)),
                  tip: Number(p.tip || 0),
                  guestNumber: p.guest_number || undefined,
                })));
                const byGuest: Record<string, number> = {};
                activePayments.forEach((p: any) => {
                  const key = String(p.guest_number || 1);
                  byGuest[key] = (byGuest[key] || 0) + Math.max(0, Number(p.amount || 0) - Number(p.tip || 0));
                });
                setPaymentsByGuest(byGuest);
              }
            }
          }
        } catch {}
        // Restore order-level Discount as a discount line from adjustments
        try {
          const adjs = Array.isArray(json.adjustments) ? json.adjustments : [];
          const discAdj = adjs.find((a:any)=> String((a.kind||'').toUpperCase()) === 'DISCOUNT' && Number(a.amount_applied||a.amountApplied||0) > 0);
          if (discAdj) {
            const amountApplied = Number(discAdj.amount_applied||discAdj.amountApplied||0);
            const mode = String(discAdj.mode||'percent');
            const value = Number(discAdj.value||0);
            restored.push({
              id: 'DISCOUNT_ITEM',
              name: mode === 'percent' ? `Order D/C (${value}%)` : `Order D/C ($${amountApplied.toFixed(2)})`,
              quantity: 1,
              price: -amountApplied,
              totalPrice: -amountApplied,
              type: 'discount',
              guestNumber: 1,
              discount: { type: 'Order D/C', percentage: value, mode: 'percent', value }
            } as any);
          }
        } catch {}
        // VOID 표시 복원(결제 완료 전까지 유지)
        try {
          const keyVoid = `voidDisplay_${st.tableId}`;
          const rawVoid = localStorage.getItem(keyVoid);
          if (rawVoid) {
            const data = JSON.parse(rawVoid);
            if (data && String(data.orderId) === String(resolvedOrderId)) {
              const voids = Array.isArray(data.voids) ? data.voids : [];
              voids.forEach((v:any) => {
                restored.push({ id: `void-${v.orderLineId||v.itemId}-${Math.random().toString(36).slice(2,8)}`, name: v.name, quantity: v.qty, price: 0, totalPrice: 0, type: 'void', guestNumber: Number(v.guestNumber||1) });
              });
            }
          }
        } catch {}
        // Reorder by payment status immediately on restore (unpaid/partial first, paid last)
        try {
          const nonSep = restored.filter((it:any)=> it && it.type !== 'separator');
          const guestsPresent = Array.from(new Set<number>(nonSep.map((it:any)=> Number(it.guestNumber||1)))).filter(n=>Number.isFinite(n)&&n>0).sort((a,b)=>a-b);
          if (guestsPresent.length > 1) {
            const paidSet = new Set<number>();
            try {
              const gs = await fetch(`${API_URL}/orders/${encodeURIComponent(String(resolvedOrderId))}/guest-status`);
              if (gs.ok) {
                const data = await gs.json();
                const rows = Array.isArray(data?.statuses) ? data.statuses : [];
                rows.forEach((r:any)=>{ const g = Number(r.guestNumber); const st = String(r.status||'').toUpperCase(); if (st==='PAID' || r.locked) paidSet.add(g); });
                try { setPersistedPaidGuests(Array.from(paidSet)); } catch {}
              }
            } catch {}
            const EPS = 0.05;
            const inlineTotals = (g:number) => nonSep.filter((it:any)=> Number(it.guestNumber||1)===g).reduce((s:number, it:any)=> s + (((it.totalPrice||0) + ((it.memo?.price)||0)) * (it.quantity||1)), 0);
            const isPaid = (g:number) => {
              if (paidSet.has(g)) return true;
              const approx = inlineTotals(g);
              const paid = 0; // on restore, session payments are not yet known; rely on DB or totals only
              const hasItems = approx > EPS;
              const hasPaid = paid > EPS;
              if (!hasItems && !hasPaid) return false;
              return (approx - paid) <= EPS;
            };
            const desired = [...guestsPresent].sort((a,b)=>{ const ka = isPaid(a)?1:0; const kb = isPaid(b)?1:0; if (ka!==kb) return ka-kb; return a-b; });
            const normalized:any[] = [];
            desired.forEach(g=>{
              normalized.push({ id:`sep-guest-${g}`, name:`구분선 Guest ${g}`, quantity:0, price:0, totalPrice:0, type:'separator', guestNumber:g });
              nonSep.forEach((it:any)=>{ if (Number(it.guestNumber||1)===g) normalized.push(it); });
            });
            if (normalized.length > 0) {
              setOrderItems(normalized as any);
            } else {
              setOrderItems(restored);
            }
          } else {
            setOrderItems(restored);
          }
        } catch {
          setOrderItems(restored);
        }
        // Re-apply split guests for this table if saved; otherwise derive from item guest numbers
        try {
          const key = `splitGuests_${st.tableId}`;
          const raw = localStorage.getItem(key);
          if (raw) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr) && arr.length > 1) {
              initializeSplitGuests(arr.map((n:any)=>Number(n)).filter((n:any)=>Number.isFinite(n) && n>0));
            }
          } else {
            const uniqueGuests: number[] = Array.from(
              new Set<number>(
                (items || [])
                  .map((x: any) => Number(x.guest_number || x.guestNumber || 1))
                  .filter((n: number) => Number.isFinite(n) && n > 0)
              )
            ).sort((a: number, b: number) => a - b);
            if (uniqueGuests.length > 1) {
              initializeSplitGuests(uniqueGuests as number[]);
            }
          }
        } catch {}
      } catch (e) {
        console.warn('Failed to load existing order:', e);
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 주문ID로 기존 주문 불러오기 (Togo/Online 등에서 진입)
  useEffect(() => {
    // 백그라운드에서 주문 로드 (화면 표시 후 200ms 지연)
    const timer = setTimeout(() => {
      const run = async () => {
        try {
          const st: any = location.state || {};
          if (!st || !st.orderId) return;
          const res = await fetch(`${API_URL}/orders/${encodeURIComponent(st.orderId)}`);
          if (!res.ok) return;
          const json = await res.json();
          applyCustomerInfoFromOrder(json?.order);
          const serverIdFromApi = json?.order?.server_id || json?.order?.serverId;
          const serverNameFromApi = json?.order?.server_name || json?.order?.serverName;
          if (serverIdFromApi && serverNameFromApi) {
            setSelectedServer(prev => prev ?? { id: String(serverIdFromApi), name: String(serverNameFromApi) });
          }
          // Load kitchen note from order
          const kitchenNoteFromApi = json?.order?.kitchen_note || json?.order?.kitchenNote;
          if (kitchenNoteFromApi) {
            setSavedKitchenMemo(String(kitchenNoteFromApi));
          }
          const items = Array.isArray(json.items) ? json.items : [];
          
          // Store original quantities for saved items
          items.forEach((it: any) => {
            if (it.order_line_id) {
              originalSavedQuantitiesRef.current[it.order_line_id] = it.quantity || 1;
            }
          });
          
          let preSplitLineIdSet2: Set<string> | null = null;
          let lsSplitCount2 = 0;
          try {
            const pgRaw2 = localStorage.getItem(`paidGuests_order_${st.orderId}`);
            if (pgRaw2) {
              const pgParsed2 = JSON.parse(pgRaw2);
              if (pgParsed2 && Array.isArray(pgParsed2.preSplitLineIds)) {
                preSplitLineIdSet2 = new Set(pgParsed2.preSplitLineIds.map(String));
              }
              if (pgParsed2 && pgParsed2.splitCount > 1) {
                lsSplitCount2 = pgParsed2.splitCount;
              }
            }
          } catch {}
          setOrderItems(items.map((it:any) => ({
          id: it.item_id?.toString() || it.id?.toString() || Math.random().toString(),
          name: it.name,
          quantity: it.quantity || 1,
          price: it.price || 0,
          totalPrice: it.price || 0,
          type: (Number(it.price || 0) < 0) ? 'discount' : 'item',
          guestNumber: (typeof it.guest_number === 'number' && it.guest_number > 0) ? it.guest_number : 1,
          modifiers: (() => { try { return JSON.parse(it.modifiers_json || '[]'); } catch { return []; } })(),
          memo: (() => { try { return it.memo_json ? JSON.parse(it.memo_json) : undefined; } catch { return undefined; } })(),
          discount: (() => { try { return it.discount_json ? JSON.parse(it.discount_json) : undefined; } catch { return undefined; } })(),
          splitDenominator: (typeof it.split_denominator === 'number' && it.split_denominator > 0) ? it.split_denominator : undefined,
          splitNumerator: (typeof it.split_numerator === 'number' && it.split_numerator > 0) ? it.split_numerator : undefined,
          orderLineId: it.order_line_id || undefined,
          togoLabel: !!(it.togo_label || it.togoLabel),
          _preSplit: preSplitLineIdSet2
            ? preSplitLineIdSet2.has(it.order_line_id || '')
            : (lsSplitCount2 > 1 && Number(it.price || 0) >= 0)
        })));
        // After loading, if multiple guest numbers exist, add separators via initializeSplitGuests
        try {
          const guestSet = new Set<number>(items.map((it:any) => (typeof it.guest_number === 'number' && it.guest_number > 0) ? Number(it.guest_number) : 1));
          const guests: number[] = Array.from(guestSet).sort((a: number, b: number) => a - b);
          if (guests.length > 1) initializeSplitGuests(guests);
        } catch {}
        try { 
          savedOrderIdRef.current = Number(st.orderId); 
          // orderId가 설정된 후 결제 상태 불러오기
          console.log(`📥 Order loaded, fetching paid guests for orderId: ${st.orderId}`);
          loadPersistedPaidGuests();

          // Restore existing payments from DB
          try {
            const payRes = await fetch(`${API_URL}/payments/order/${st.orderId}`);
            if (payRes.ok) {
              const payJson = await payRes.json();
              const dbPayments = Array.isArray(payJson.payments) ? payJson.payments : [];
              const activePayments = dbPayments.filter((p: any) => p.status !== 'voided' && p.status !== 'VOIDED');
              if (activePayments.length > 0) {
                setSessionPayments(activePayments.map((p: any) => ({
                  paymentId: p.id,
                  method: p.payment_method || '',
                  amount: Math.max(0, Number(p.amount || 0) - Number(p.tip || 0)),
                  tip: Number(p.tip || 0),
                  guestNumber: p.guest_number || undefined,
                })));
                const byGuest: Record<string, number> = {};
                activePayments.forEach((p: any) => {
                  const key = String(p.guest_number || 1);
                  byGuest[key] = (byGuest[key] || 0) + Math.max(0, Number(p.amount || 0) - Number(p.tip || 0));
                });
                setPaymentsByGuest(byGuest);
              }
            }
          } catch {}
          
          // If openPayment flag is set, open payment modal after loading
          if (st.openPayment) {
            setTimeout(() => {
              priorPaymentIdsRef.current = new Set(sessionPayments.map(p => p.paymentId));
              setShowPaymentModal(true);
            }, 100);
          }
        } catch {}
      } catch (e) {
        console.warn('Failed to load existing order by orderId:', e);
      }
    };
    run();
    }, 200);
    
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadPersistedPaidGuests]);

  // Persist promotion rules across refresh
  React.useEffect(() => {
    // 백그라운드에서 프로모션 정보 로드 (화면 표시 후 400ms 지연)
    const timer = setTimeout(() => {
      (async () => {
        let loaded = false;
        try {
          const res = await fetch(`${API_URL}/promotions/discount`);
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
              setPromotionRules(data);
              loaded = true;
            }
          }
        } catch {}
        if (!loaded) {
          try {
            const raw = localStorage.getItem('promotion_rules_v1');
            if (raw) {
              const parsed = JSON.parse(raw);
              if (Array.isArray(parsed) && parsed.length > 0) {
                setPromotionRules(parsed);
                loaded = true;
              }
            }
          } catch {}
        }
        setPromosLoaded(true);
      })();
    }, 400);
    
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!promosLoaded) return;
    (async () => {
      try {
        await fetch(`${API_URL}/promotions/discount`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(promotionRules || []) });
      } catch {}
      try {
        localStorage.setItem('promotion_rules_v1', JSON.stringify(promotionRules || []));
      } catch {}
    })();
  }, [promotionRules, promosLoaded]);

  // Free item promotions load/save
  React.useEffect(() => {
    // 백그라운드에서 무료 아이템 프로모션 로드 (화면 표시 후 500ms 지연)
    const timer = setTimeout(() => {
      (async () => {
        let loaded = false;
        try {
          const res = await fetch(`${API_URL}/promotions/free`);
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
              setFreeItemPromotions(data);
              loaded = true;
            }
          }
        } catch {}
        if (!loaded) {
          try {
            const raw = localStorage.getItem('free_item_promotions_v1');
            if (raw) {
              const parsed = JSON.parse(raw);
              if (Array.isArray(parsed) && parsed.length > 0) {
                setFreeItemPromotions(parsed);
                loaded = true;
              }
            }
          } catch {}
        }
        setFreePromosLoaded(true);
      })();
    }, 500);
    
    return () => clearTimeout(timer);
  }, []);

  React.useEffect(() => {
    if (!freePromosLoaded) return;
    (async () => {
      try {
        await fetch(`${API_URL}/promotions/free`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(freeItemPromotions || []) });
      } catch {}
      try {
        localStorage.setItem('free_item_promotions_v1', JSON.stringify(freeItemPromotions || []));
      } catch {}
    })();
  }, [freeItemPromotions, freePromosLoaded]);

  const [editingFreePromoId, setEditingFreePromoId] = useState<string | null>(null);
  const [promotionApplyMode, setPromotionApplyMode] = useState<'both'|'single'>('both');
  // Custom Discount Type modal state
  const [showCustomTypeModal, setShowCustomTypeModal] = useState(false);
  const [customTypeName, setCustomTypeName] = useState('');
  const [customTypeAmount, setCustomTypeAmount] = useState('');

  // Track when first real menu item is added to set table Occupied immediately
  // (새로운 아이템이 추가될 때만, 기존 주문 로드 시에는 실행하지 않음)
  const firstItemCountRef = useRef<number>(0);
  const initialLoadCompleteRef = useRef<boolean>(false);
  useEffect(() => {
    try {
      const realItemCount = orderItems.filter((it:any) => it && it.type !== 'separator' && it.type !== 'discount').length;
      const prev = firstItemCountRef.current || 0;
      
      // 기존 주문 로드 시에는 건너뜀 (loadExisting이 true이거나, 이미 orderId가 있는 경우)
      const isLoadingExisting = (location.state && (location.state as any).loadExisting) || savedOrderIdRef.current;
      
      // 초기 로드 완료 체크: 처음 아이템이 로드되면 마킹
      if (!initialLoadCompleteRef.current && realItemCount > 0 && isLoadingExisting) {
        initialLoadCompleteRef.current = true;
        firstItemCountRef.current = realItemCount;
        return; // 기존 주문 로드 시에는 상태 변경하지 않음
      }
      
      if (prev === 0 && realItemCount > 0 && !isLoadingExisting) {
        const tableId = (location.state && (location.state as any).tableId) || null;
        const floor = (location.state && (location.state as any).floor) || null;
        if (tableId) {
          fetch(`${API_URL}/table-map/elements/${encodeURIComponent(tableId)}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'Occupied' })
          }).catch(()=>{});
          try { localStorage.setItem('lastOccupiedTable', JSON.stringify({ tableId, floor, status: 'Occupied', ts: Date.now() })); } catch {}
        }
      }
      firstItemCountRef.current = realItemCount;
    } catch {}
  }, [orderItems]);

  const discountTypes = [
    'Birthday DC',
    'Employee D/C',
    'VIP D/C',
    'Promotion D/C',
    'Complaint D/C',
    'Happy Hour D/C',
    'Senior D/C',
    'Other D/C',
    'Custom'
  ];

  const discountPercentages = ['5%', '10%', '15%', '20%', '25%', '30%', '50%', '75%', '100%'];
  const discountAmounts = [5, 10, 15, 20, 30, 40, 50, 100];
  
  // Numpad modal state for discount
  const [showDiscountNumpad, setShowDiscountNumpad] = useState(false);
  const [discountNumpadMode, setDiscountNumpadMode] = useState<'percent' | 'amount'>('percent');
  const [discountNumpadValue, setDiscountNumpadValue] = useState('');

  const handleOpenDiscount = () => {
    setSelectedDiscountType('');
    setDiscountPercentage('');
    setCustomDiscountPercentage('');
    setDiscountInputMode('percent');
    setDiscountAmountValue('');
    setShowDiscountModal(true);
  };
  const handleApplyDiscount = () => {
    if (!selectedDiscountType) {
      alert('Please select at least one discount type.');
      return;
    }
    
    let percentValue = 0;
    let amountValue = 0;
    
    if (discountInputMode === 'percent') {
      const percentage = discountPercentage === 'Custom' ? customDiscountPercentage : discountPercentage;
      if (!percentage) {
        alert('Please select or enter a discount percentage.');
        return;
      }
      
      percentValue = parseFloat(percentage.replace('%', ''));
      if (isNaN(percentValue) || percentValue < 0 || percentValue > 100) {
        alert('Please enter a valid percentage (0-100).');
        return;
      }
    } else {
      amountValue = parseFloat(discountAmountValue);
      if (isNaN(amountValue) || amountValue <= 0) {
        alert('Please select or enter a valid discount amount.');
        return;
      }
    }

    // Identify active guests (exclude void items)
    const activeGuests = Array.from(new Set(
      orderItems
        .filter(it => it.type === 'item' && !(it as any).void_id && !(it as any).is_void)
        .map(it => it.guestNumber || 1)
    )).filter(g => g > 0);

    if (activeGuests.length === 0) activeGuests.push(1);

    const newDiscountItems: any[] = [];
    const timestamp = Date.now();

    activeGuests.forEach((guestNum, idx) => {
      // Get subtotal for this guest (after item discounts)
      const guestItems = orderItems.filter(it => 
        it.type === 'item' && 
        (it.guestNumber || 1) === guestNum && 
        !(it as any).void_id && !(it as any).is_void
      );

      const guestSubtotal = guestItems.reduce((sum, it) => {
        const base = ((it.totalPrice || 0) + (((it as any).memo?.price) || 0)) * (it.quantity || 1);
        const itemDisc = computeItemDiscountAmount(it as any);
        return sum + Math.max(0, base - itemDisc);
      }, 0);

      if (guestSubtotal <= 0) return;

      let discountAmount = 0;
      if (discountInputMode === 'percent') {
        discountAmount = guestSubtotal * (percentValue / 100);
      } else {
        // Split amount equally among guests
        discountAmount = amountValue / activeGuests.length;
        // Cap at guest subtotal
        discountAmount = Math.min(discountAmount, guestSubtotal);
      }

      if (discountAmount > 0) {
        newDiscountItems.push({
          id: `DISCOUNT_${guestNum}_${timestamp}_${idx}`,
          name: selectedDiscountType,
          quantity: 1,
          price: -Number(discountAmount.toFixed(2)),
          totalPrice: -Number(discountAmount.toFixed(2)),
          type: 'discount',
          guestNumber: guestNum,
          discount: {
            type: selectedDiscountType,
            value: discountInputMode === 'percent' ? percentValue : discountAmount,
            mode: discountInputMode
          }
        });
      }
    });

    // Update order items: remove existing Order D/C items and add new ones
    setOrderItems(prev => {
      const filtered = prev.filter(item => item.type !== 'discount');
      return [...filtered, ...newDiscountItems];
    });

    setShowDiscountModal(false);
  };

  const handleCancelDiscount = () => {
    setShowDiscountModal(false);
  };

  const handleRemoveDiscount = () => {
    setOrderItems(prev => prev.map(item => {
      if (item.type === 'separator') return item;
      return {
        ...item,
        discount: undefined
      };
    }));
  };

  const handleCustomDiscountClick = () => {
    setShowCustomDiscountModal(true);
    setSoftKbTarget('customDiscount');
  };

  const handleCustomDiscountSave = () => {
    const value = parseFloat(customDiscountPercentage);
    if (isNaN(value) || value < 0 || value > 100) {
      alert('Please enter a valid percentage between 0 and 100');
      return;
    }
    setDiscountPercentage('Custom');
    setShowCustomDiscountModal(false);
    setSoftKbTarget(null);
  };

  const handleCustomDiscountCancel = () => {
    setShowCustomDiscountModal(false);
    setSoftKbTarget(null);
  };

  // Clear selection helper for FloatingActionBar dismissal
  const clearSelection = React.useCallback(() => {
    try {
      setSelectedOrderItemId(null);
      setSelectedOrderLineId(null);
      setSelectedOrderGuestNumber(null);
      setSelectedRowIndex(null);
    } catch {}
  }, []);

  // Floating action bar for selected order item
  const FloatingActionBar = ({
    itemId,
    guestNumber,
    rowIndex,
    orderLineId,
    isNearBottom = false,
  }: {
    itemId: string;
    guestNumber: number;
    rowIndex: number;
    orderLineId?: string;
    isNearBottom?: boolean;
  }) => {
    const handleDiscount = () => {
      setSelectedOrderItemId(itemId);
      setSelectedOrderLineId(orderLineId || null);
      setSelectedOrderGuestNumber(guestNumber);
      setSelectedRowIndex(rowIndex);
      const selectedItem = orderItems.find(
        (item) => item.id === itemId && (item.guestNumber || 1) === guestNumber,
      );
      if (selectedItem && (selectedItem as any).discount) {
        setItemDiscountMode(
          (selectedItem as any).discount.mode === 'amount' ? 'amount' : 'percent',
        );
        setItemDiscountValue(String((selectedItem as any).discount.value ?? ''));
      } else {
        setItemDiscountMode('percent');
        setItemDiscountValue('');
      }
      setShowItemDiscountModal(true);
    };

    const handleMemo = () => {
      setSelectedOrderItemId(itemId);
      setSelectedOrderLineId(orderLineId || null);
      setSelectedOrderGuestNumber(guestNumber);
      setSelectedRowIndex(rowIndex);

      const selectedItem = orderItems.find(
        (item) => item.id === itemId && (item.guestNumber || 1) === guestNumber,
      );
      if (selectedItem && (selectedItem as any).memo) {
        setItemMemo((selectedItem as any).memo.text || '');
        setItemMemoPrice(
          (selectedItem as any).memo.price
            ? (selectedItem as any).memo.price.toString()
            : '',
        );
      } else {
        setItemMemo('');
        setItemMemoPrice('');
      }

      setShowItemMemoModal(true);
      // 모달이 열릴 때 키보드도 자동으로 열기
      setTimeout(() => setSoftKbTarget('memo'), 100);
    };

    const handlePrice = () => {
      setSelectedOrderItemId(itemId);
      setSelectedOrderLineId(orderLineId || null);
      setSelectedOrderGuestNumber(guestNumber);
      setSelectedRowIndex(rowIndex);
      setNewPrice('');
      setShowEditPriceModal(true);
    };

    // 🔧 맨 아래 아이템인 경우 위쪽에 표시
    if (isNearBottom) {
      return (
        <div
          className="floating-action-bar absolute left-0 right-0 z-50 bg-white border border-gray-300 rounded-2xl shadow-lg px-2 py-2 flex items-center justify-center gap-1 animate-fade-in"
          style={{ bottom: '100%', marginBottom: '2px' }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleMemo}
            className="flex-1 min-h-[44px] py-2 px-2 hover:bg-blue-100 active:bg-blue-200 rounded-lg transition-colors text-blue-600 font-semibold text-sm text-center"
            title="Memo"
          >
            Memo
          </button>

          <button
            onClick={handlePrice}
            className="flex-1 min-h-[44px] py-2 px-2 hover:bg-green-100 active:bg-green-200 rounded-lg transition-colors text-green-600 font-semibold text-sm text-center"
            title="Edit Price"
          >
            Edit Price
          </button>

          <button
            onClick={handleDiscount}
            className="flex-1 min-h-[44px] py-2 px-2 hover:bg-orange-100 active:bg-orange-200 rounded-lg transition-colors text-orange-600 font-semibold text-sm text-center"
            title="Item Discount"
          >
            Item D/C
          </button>
        </div>
      );
    }

    return (
      <div
        className="floating-action-bar relative z-50 bg-white border border-gray-300 rounded-2xl shadow-lg px-2 py-2 flex items-center justify-center gap-1 animate-fade-in w-full"
        style={{ marginTop: '2px' }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={handleMemo}
          className="flex-1 min-h-[44px] py-2 px-2 hover:bg-blue-100 active:bg-blue-200 rounded-lg transition-colors text-blue-600 font-semibold text-sm text-center"
          title="Memo"
        >
          Memo
        </button>

        <button
          onClick={handlePrice}
          className="flex-1 min-h-[44px] py-2 px-2 hover:bg-green-100 active:bg-green-200 rounded-lg transition-colors text-green-600 font-semibold text-sm text-center"
          title="Edit Price"
        >
          Edit Price
        </button>

        <button
          onClick={handleDiscount}
          className="flex-1 min-h-[44px] py-2 px-2 hover:bg-orange-100 active:bg-orange-200 rounded-lg transition-colors text-orange-600 font-semibold text-sm text-center"
          title="Item Discount"
        >
          Item D/C
        </button>
      </div>
    );
  };

  // 🚀 초기 로딩 화면 제거 - 바로 표시
  // if (!mounted || !uiReady) {
  //   return (
  //     <div className="h-screen w-screen flex items-center justify-center bg-gray-100">
  //       <div className="text-center">
  //         <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-500 mx-auto mb-4"></div>
  //         <p className="text-gray-600 text-lg font-medium">Loading Order Page...</p>
  //       </div>
  //     </div>
  //   );
  // }

  return (
    <div className="orderpage-scope h-screen bg-gray-100 flex fixed inset-0" data-pos-page="order" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
      {/* Background overlay to close FloatingActionBar on outside click */}
      {((selectedOrderItemId != null) || (selectedOrderLineId != null)) && (
        <div
          className="fixed inset-0 z-40"
          onMouseDown={(e) => { try { e.stopPropagation(); clearSelection(); } catch {} }}
          onClick={(e) => { try { e.stopPropagation(); clearSelection(); } catch {} }}
        />
      )}

      {/* Left Panel - Layout Management (Back Office: 30% 고정) */}
      <div className="bg-gray-800 text-white p-2 overflow-y-auto" style={{ display: isSalesOrder ? 'none' : undefined, width: '30%' }}>
        { !isTogo && (
          <>
            <div className="bg-gray-800 rounded-lg p-3 mb-3">
              {/* Layout Tab */}
            </div>
            {/* Category/Menu/Modifier/Function Tabs remain as existing code below */}
          </>
        )}
                  <div className="bg-gray-800 rounded-lg p-3 mb-3">
          {/* Back to Order Setup Button */}
          <button
            onClick={() => navigate('/backoffice/order-setup')}
            className="w-full mb-3 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <span>←</span>
            <span>Back to Order Setup</span>
          </button>
          {/* Layout Tab */}
          <div className="mb-3 bg-gray-700 rounded-lg p-2" style={{ display: isTogo ? 'none' : undefined }}>
            <div className="flex items-center justify-between mb-2 bg-slate-400 rounded-t-lg p-2 -m-2 mb-3">
              <h3 className="text-sm font-semibold text-white">Layout Tab</h3>
              <button
                onClick={() => setPanelWidthExpanded(!panelWidthExpanded)}
                className="text-white hover:text-slate-200 transition-colors"
                title={panelWidthExpanded ? 'Collapse' : 'Expand'}
              >
                {panelWidthExpanded ? '▲' : '▼'}
              </button>
            </div>
            
            {panelWidthExpanded && (
              <div className="mb-1">
                {/* 권한 없음 안내 메시지 */}
                {!canEditLayoutTab && (
                  <div className="bg-yellow-100 border border-yellow-500 rounded p-2 mb-2 text-xs text-yellow-800">
                    ⚠️ Admin 또는 Distributor 권한이 필요합니다. (Select Server 제외)
                  </div>
                )}
                
                {/* Screen Size */}
                <div className={`mb-1 ${!canEditLayoutTab ? 'opacity-50' : ''}`}>
                  <div className="text-sm text-gray-200 mb-1">Screen Size</div>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={layoutSettings.screenAspect}
                      onChange={(e) => updateLayoutSetting('screenAspect', e.target.value as '4:3' | '16:9')}
                      disabled={!canEditLayoutTab}
                      className={`bg-gray-600 text-white text-sm rounded px-2 py-1 ${!canEditLayoutTab ? 'cursor-not-allowed' : ''}`}
                    >
                      <option value="4:3">4:3</option>
                      <option value="16:9">16:9</option>
                    </select>
                    <select
                      value={layoutSettings.screenResolution}
                      onChange={(e) => updateLayoutSetting('screenResolution', e.target.value)}
                      disabled={!canEditLayoutTab}
                      className={`bg-gray-600 text-white text-sm rounded px-2 py-1 ${!canEditLayoutTab ? 'cursor-not-allowed' : ''}`}
                    >
                      {layoutSettings.screenAspect === '4:3' ? (
                        <>
                          <option value="1280x960">1280x960</option>
                          <option value="1024x768">1024x768</option>
                          <option value="800x600">800x600</option>
                        </>
                      ) : (
                        <>
                          <option value="1366x768">1366x768</option>
                          <option value="1920x1080">1920x1080</option>
                        </>
                      )}
                    </select>
                  </div>
                </div>
                <div className={`${!canEditLayoutTab ? 'opacity-50' : ''}`}>
                  <div className="flex justify-between text-sm mb-1 text-gray-300">
                    <span>Panel Width</span>
                  </div>
                  <div className="flex justify-between text-sm mb-1 text-gray-300">
                    <span>Left: {layoutSettings.leftPanelWidth}%</span>
                    <span>Right: {layoutSettings.rightPanelWidth}%</span>
                  </div>
                  <input
                    type="range"
                    min="20"
                    max="50"
                    value={layoutSettings.leftPanelWidth}
                    onChange={(e) => {
                      if (!canEditLayoutTab) return;
                      const leftWidth = parseInt(e.target.value);
                      updateLayoutSetting('leftPanelWidth', leftWidth);
                      updateLayoutSetting('rightPanelWidth', 100 - leftWidth);
                    }}
                    disabled={!canEditLayoutTab}
                    className={`w-full h-2 bg-gray-600 rounded-lg appearance-none slider ${canEditLayoutTab ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                  />
                </div>

                {/* Base Color */}
                <div className={`mt-2 ${!canEditLayoutTab ? 'opacity-50' : ''}`}>
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-gray-200">Base Color</div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => { if (canEditLayoutTab) setShowColorModal(!showColorModal); }}
                        disabled={!canEditLayoutTab}
                        className={`w-8 h-8 rounded border-2 border-white/50 shadow transition-all duration-200 ${canEditLayoutTab ? 'hover:scale-105 cursor-pointer' : 'cursor-not-allowed'}`}
                        style={{ backgroundColor: layoutSettings.baseColor || '#3B82F6' }}
                        title={canEditLayoutTab ? "Click to toggle color grid" : "Permission required"}
                      >
                      </button>
                    </div>
                  </div>
                  
                                      {/* Color Modal */}
                    {showColorModal && (
                      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                        <div className="bg-white rounded-lg p-6 shadow-xl max-w-xl w-full mx-4 max-h-[90vh] flex flex-col">
                          <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-gray-800">색상 세트 선택</h3>
                            <button
                              onClick={() => setShowColorModal(false)}
                              className="text-gray-500 hover:text-gray-700 text-2xl font-bold"
                            >
                              ×
                            </button>
                          </div>
                          
                          <div className="overflow-y-auto flex-1 pr-2 custom-scrollbar" style={{ 
                            scrollbarWidth: 'thin', 
                            scrollbarColor: '#cbd5e0 #f7fafc',
                            maxHeight: '60vh'
                          }}>
                            {/* 24개 단일 색상 선택: 카테고리/메뉴 12 + 모디파이어 12. 클릭 시 모두 동일 색상 적용 */}
                            <div className="space-y-4">
                              <div>
                                <div className="text-sm font-semibold text-gray-700 mb-2">Category/Menu 색상 (12)</div>
                                <div className="grid grid-cols-6 gap-2">
                                  {[
                                    { hex: '#f0e6d2', name: 'Warm Beige' },
                                    { hex: '#e9ecef', name: 'Soft Gray' },
                                    { hex: '#cce7ff', name: 'Sky Blue' },
                                    { hex: '#d7f4d7', name: 'Nature Green' },
                                    { hex: '#f3e5f5', name: 'Lavender' },
                                    { hex: '#faf8f2', name: 'Cream' },
                                    { hex: '#fdf2f8', name: 'Rose Pink' },
                                    { hex: '#ede7e0', name: 'Earth Mud' },
                                    { hex: '#fff3e0', name: 'Golden Orange' },
                                    { hex: '#e8eaf6', name: 'Navy Blue' },
                                    { hex: '#e0f2f1', name: 'Aqua Mint' },
                                    { hex: '#fff3e0', name: 'Salmon Peach' }
                                  ].map(({ hex, name }, idx) => (
                                    <div key={`cat-${idx}`} className="flex flex-col items-center">
                                      <button
                                        className="w-10 h-10 rounded border border-gray-300 hover:scale-105 transition-transform"
                                        style={{ backgroundColor: hex }}
                                        title={name}
                                        onClick={async () => {
                                          updateLayoutSetting('categoryAreaBgColor', hex);
                                          updateLayoutSetting('menuAreaBgColor', hex);
                                          updateLayoutSetting('modifierAreaBgColor', hex);
                                          updateLayoutSetting('baseColor', hex);
                                          try { await saveLayoutSettings(); } catch (e) { console.error(e); }
                                          setShowColorModal(false);
                                        }}
                                      />
                                      <div className="mt-1 text-[11px] text-gray-600 text-center leading-tight truncate w-14" title={name}>{name}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              <div>
                                <div className="text-sm font-semibold text-gray-700 mb-2">Modifier 색상 (12)</div>
                                <div className="grid grid-cols-6 gap-2">
                                  {[
                                    { hex: '#d4c4a8', name: 'Warm Beige' },
                                    { hex: '#ced4da', name: 'Soft Gray' },
                                    { hex: '#a5d6ff', name: 'Sky Blue' },
                                    { hex: '#b8ddb8', name: 'Nature Green' },
                                    { hex: '#dcc7e8', name: 'Lavender' },
                                    { hex: '#f4f0e6', name: 'Cream' },
                                    { hex: '#fbdbe8', name: 'Rose Pink' },
                                    { hex: '#d9d0c7', name: 'Earth Mud' },
                                    { hex: '#ffcc80', name: 'Golden Orange' },
                                    { hex: '#9fa8da', name: 'Navy Blue' },
                                    { hex: '#80cbc4', name: 'Aqua Mint' },
                                    { hex: '#ffab91', name: 'Salmon Peach' }
                                  ].map(({ hex, name }, idx) => (
                                    <div key={`mod-${idx}`} className="flex flex-col items-center">
                                      <button
                                        className="w-10 h-10 rounded border border-gray-300 hover:scale-105 transition-transform"
                                        style={{ backgroundColor: hex }}
                                        title={name}
                                        onClick={async () => {
                                          updateLayoutSetting('categoryAreaBgColor', hex);
                                          updateLayoutSetting('menuAreaBgColor', hex);
                                          updateLayoutSetting('modifierAreaBgColor', hex);
                                          updateLayoutSetting('baseColor', hex);
                                          try { await saveLayoutSettings(); } catch (e) { console.error(e); }
                                          setShowColorModal(false);
                                        }}
                                      />
                                      <div className="mt-1 text-[11px] text-gray-600 text-center leading-tight truncate w-14" title={name}>{name}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                            
                          <div className="text-center mt-4">
                            <button
                              onClick={() => setShowColorModal(false)}
                              className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
                            >
                              닫기
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                </div>

                <div className="pt-1 border-t border-gray-600">
                  <div className="p-2 bg-gray-600 rounded-lg space-y-1.5">
                    <div className="flex items-center justify-between gap-3">
                      <label className="text-sm font-medium text-gray-300">Select Server</label>
                      <button
                        onClick={async () => {
                          const newValue = !selectServerPromptEnabled;
                          updateLayoutSetting('selectServerOnEntry', newValue);
                          // 즉시 서버에 저장하여 SalesPage에서도 반영되도록 함
                          try {
                            await saveLayoutSettings({ selectServerOnEntry: newValue });
                          } catch (e) {
                            console.error('Failed to save selectServerOnEntry:', e);
                          }
                        }}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${selectServerPromptEnabled ? 'bg-yellow-600' : 'bg-gray-500'}`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${selectServerPromptEnabled ? 'translate-x-6' : 'translate-x-1'}`}
                        />
                      </button>
                    </div>
                    <p className="text-xs text-gray-400">Show server selection modal when entering Table/ToGo orders</p>
                  </div>
                </div>

                <div className="pt-1 border-t border-gray-600">
                  <div className="p-2 bg-gray-600 rounded-lg space-y-1.5">
                    <div className="flex items-center justify-between gap-3">
                      <label className="text-sm font-medium text-gray-300">Gratuity %</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.5}
                          value={layoutSettings.gratuityRate ?? 0}
                          onChange={async (e) => {
                            const val = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                            updateLayoutSetting('gratuityRate', val);
                            try {
                              await saveLayoutSettings({ gratuityRate: val } as any);
                            } catch (err) {
                              console.error('Failed to save gratuityRate:', err);
                            }
                          }}
                          className="w-20 px-2 py-1 text-sm text-right bg-gray-700 border border-gray-500 rounded text-white focus:outline-none focus:border-yellow-500"
                        />
                        <span className="text-sm text-gray-300">%</span>
                      </div>
                    </div>
                    <p className="text-xs text-gray-400">Auto-apply gratuity as restaurant revenue (not server tip)</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Category Tab Settings */}
          <div className="mb-3 bg-gray-700 rounded-lg p-2" style={{ display: isTogo ? 'none' : undefined }}>
            <div className="flex items-center justify-between mb-2 bg-slate-400 rounded-t-lg p-2 -m-2 mb-3">
              <h3 className="text-sm font-semibold text-white">Category Tab</h3>
              <button
                onClick={() => setCategoryTabExpanded(!categoryTabExpanded)}
                className="text-white hover:text-slate-200 transition-colors"
                title={categoryTabExpanded ? 'Collapse' : 'Expand'}
              >
                {categoryTabExpanded ? '▲' : '▼'}
              </button>
            </div>
            
            {categoryTabExpanded && (
              <>
                {/* Mergy Controls */}
                <div className="mb-1 p-2 rounded bg-gray-600">
                  <div className="text-xs text-gray-200 mb-1">
                    Mergy: Select 2-10 categories → Create merge group
                    {layoutSettings.mergedGroups && layoutSettings.mergedGroups.length > 0 && (
                      <span className="text-blue-300 ml-2">
                        ({layoutSettings.mergedGroups.length} groups)
                      </span>
                    )}
                  </div>
                  
                  
                  {/* 기존 머지 그룹 목록 */}
                  {layoutSettings.mergedGroups && layoutSettings.mergedGroups.length > 0 && (
                    <div className="mb-2 p-2 rounded bg-gray-500">
                      <div className="text-xs text-gray-200 mb-1">Created merge groups:</div>
                      {layoutSettings.mergedGroups.map((group) => (
                        <div key={group.id} className="flex items-center justify-between mb-1 p-1 rounded bg-gray-400">
                          <div className="text-xs text-gray-800">
                            <span className="font-semibold">{group.name}</span>
                            <span className="ml-2 text-gray-600">({group.categoryNames.join(', ')})</span>
                          </div>
                          <div className="flex space-x-1">
                            <button
                              onClick={() => editMergyGroup(group)}
                              className="text-xs px-1 py-0.5 rounded bg-gray-500 text-gray-200 hover:bg-gray-600"
                              title="Edit"
                            >
                              <svg className="w-3 h-3 transform rotate-135" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                              </svg>
                            </button>
                            <button
                              onClick={() => deleteMergyGroup(group.id)}
                              className="text-xs px-1 py-0.5 rounded bg-gray-500 text-gray-200 hover:bg-gray-600"
                              title="Delete"
                            >
                              🗑
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {/* 새 머지 그룹 생성/편집 */}
                  <div className="mb-1">
                    <label className="text-xs text-gray-200 mr-2">이름</label>
                    <input
                      type="text"
                      value={mergyName}
                      onChange={(e) => setMergyName(e.target.value)}
                      className="text-xs px-2 py-1 rounded bg-gray-500 text-white outline-none border border-gray-400"
                      placeholder="Merged"
                      maxLength={20}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-1 max-h-28 overflow-auto pr-1 p-2 rounded bg-gray-800 border border-gray-600">
                    <div className="col-span-2 text-xs text-gray-200 mb-1 font-medium">Select categories to merge:</div>
                    {categories.map((c) => {
                      if (c.name === 'Open Price') return null;
                      // 이미 머지된 카테고리인지 확인
                      const isAlreadyMerged = layoutSettings.mergedGroups?.some(group => 
                        group.categoryNames.includes(c.name)
                      );
                      
                      return (
                        <label key={`mergy-opt-${c.name}`} className="flex items-center text-xs text-gray-100 space-x-1">
                          {(() => {
                            const isInEditingGroup = !!(editingMergyGroup && Array.isArray(editingMergyGroup.categories) && editingMergyGroup.categories.includes(c.name));
                            // 이미 머지된 카테고리는 편집 모드가 아니면 비활성화 (새 머지 그룹 생성 시에는 허용하지 않음)
                            const disabled = isAlreadyMerged && !isInEditingGroup;
                            return (
                              <>
                                <input
                                  type="checkbox"
                                  className="accent-gray-400"
                                  checked={mergySelectedCategories.includes(c.name)}
                                  onChange={() => toggleMergyCategory(c.name)}
                                  disabled={disabled}
                                />
                                <span className={(isAlreadyMerged && !isInEditingGroup) ? 'text-gray-300 line-through' : 'text-gray-100'}>
                                  {c.name}
                                  {(isAlreadyMerged && !isInEditingGroup) && <span className="text-xs text-gray-400 ml-1">(already merged)</span>}
                                </span>
                              </>
                            );
                          })()}
                        </label>
                      );
                    })}
                  </div>
                  <div className="mt-1 flex items-center space-x-2">
                    {editingMergyGroup ? (
                      <>
                        <button
                          className="px-2 py-1 text-xs rounded bg-green-600 text-white hover:bg-green-700"
                          onClick={updateMergyGroup}
                          disabled={mergySelectedCategories.length < 2}
                          title={mergySelectedCategories.length < 2 ? 'Select at least 2' : `Update (${mergySelectedCategories.length} selected)`}
                        >
                          Update
                        </button>
                        <button
                          className="px-2 py-1 text-xs rounded bg-gray-500 text-white hover:bg-gray-600"
                          onClick={cancelEditMergyGroup}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700"
                          onClick={createMergyGroup}
                          disabled={mergySelectedCategories.length < 2}
                          title={mergySelectedCategories.length < 2 ? 'Select at least 2' : `Create Merge Group (${mergySelectedCategories.length} selected)`}
                        >
                          Create Merge Group
                        </button>
                        <button
                          className="px-2 py-1 text-xs rounded bg-gray-500 text-white hover:bg-gray-600"
                          onClick={() => {
                            setMergySelectedCategories([]);
                            setMergyName('Merged');
                          }}
                          title="Clear Selection"
                        >
                          Clear Selection
                        </button>
                        <button
                          className={`px-2 py-1 text-xs rounded ${!mergyActive ? 'bg-gray-500 text-gray-200' : 'bg-stone-600 text-white hover:bg-stone-700'}`}
                          onClick={() => { setMergyActive(false); setCurrentMergyGroupId(null); setSelectedCategory(categories[0]?.name || ''); }}
                          disabled={!mergyActive}
                        >
                          Disable Merge
                        </button>
                      </>
                    )}
                  </div>

                </div>
                {/* Row/Column Settings */}
                <div className="grid grid-cols-2 gap-2 mb-1">
                  <div>
                    <label className="block text-sm mb-1 text-gray-300">Rows: {layoutSettings.categoryRows}</label>
                    <input
                      type="range"
                      min="1"
                      max="4"
                      value={layoutSettings.categoryRows}
                      onChange={(e) => { const v = parseInt(e.target.value); updateLayoutSetting('categoryRows', v); }}
                      className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer slider"
                    />
                  </div>

                  <div>
                    <label className="block text-sm mb-1 text-gray-300">Columns: {layoutSettings.categoryColumns}</label>
                    <input
                      type="range"
                      min="2"
                      max="12"
                      value={layoutSettings.categoryColumns}
                      onChange={(e) => updateLayoutSetting('categoryColumns', parseInt(e.target.value))}
                      className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer slider"
                    />
                  </div>
                </div>

                {/* Button Size Settings */}
                <div className="mb-1">
                  <label className="block text-sm mb-1 text-gray-300">Button Height: {layoutSettings.categoryHeight}px</label>
                                    <input
                     type="range"
                     min="32"
                     max="80"
                     value={layoutSettings.categoryHeight}
                     onChange={(e) => updateLayoutSetting('categoryHeight', parseInt(e.target.value))}
                     className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer slider border border-white/50"
                   />
                </div>



                {/* Font Size Settings */}
                <div className="mb-1">
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-gray-300">Font Size: {layoutSettings.categoryFontSize}px</label>
                    <div className="flex space-x-1">
                      <button
                        onClick={() => { updateLayoutSetting('categoryFontBold', !layoutSettings.categoryFontBold); if (!layoutSettings.categoryFontBold) updateLayoutSetting('categoryFontExtraBold', false); }}
                        className={`text-xs px-2 py-0.5 rounded border ${layoutSettings.categoryFontBold ? 'bg-blue-600 text-white border-blue-700' : 'bg-gray-600 text-gray-200 border-gray-500'}`}
                        title="Toggle bold (+100)"
                      >
                        Bold
                      </button>
                      <button
                        onClick={() => { updateLayoutSetting('categoryFontExtraBold', !layoutSettings.categoryFontExtraBold); if (!layoutSettings.categoryFontExtraBold) updateLayoutSetting('categoryFontBold', false); }}
                        className={`text-xs px-2 py-0.5 rounded border ${layoutSettings.categoryFontExtraBold ? 'bg-purple-600 text-white border-purple-700' : 'bg-gray-600 text-gray-200 border-gray-500'}`}
                        title="Toggle extra bold (+200)"
                      >
                        Extra Bold
                      </button>
                    </div>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="25"
                    value={layoutSettings.categoryFontSize}
                    onChange={(e) => updateLayoutSetting('categoryFontSize', parseInt(e.target.value))}
                    className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer slider border border-white/50"
                  />
                </div>

                {/* Category Button Color Selection */}
                <div className="mb-1">
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-gray-300">Category Button Color</label>
                    <div 
                      className={`w-8 h-8 rounded border-2 border-blue-400 cursor-pointer ${layoutSettings.categoryNormalColor}`}
                      onClick={() => setShowCategoryColorModal(true)}
                      title="Current color - click to change"
                    />
                  </div>
                </div>



              </>
            )}
          </div>

          {/* Menu Tab Settings */}
          <div className="mb-3 bg-gray-700 rounded-lg p-2" style={{ display: isTogo ? 'none' : undefined }}>
            <div className="flex items-center justify-between mb-2 bg-slate-400 rounded-t-lg p-2 -m-2 mb-3">
              <h3 className="text-sm font-semibold text-white">Menu Tab</h3>
              <button
                onClick={() => setMenuTabExpanded(!menuTabExpanded)}
                className="text-white hover:text-stone-200 transition-colors"
                title={menuTabExpanded ? 'Collapse' : 'Expand'}
              >
                {menuTabExpanded ? '▲' : '▼'}
              </button>
            </div>
            
                            {menuTabExpanded && (
                  <>
                {/* Column Settings */}
                <div className="grid grid-cols-1 gap-2 mb-1">
                  <div>
                    <label className="block text-sm mb-1 text-gray-300">Columns: {layoutSettings.menuGridColumns}</label>
                    <input
                      type="range"
                      min="2"
                      max="12"
                      value={layoutSettings.menuGridColumns}
                      onChange={(e) => updateLayoutSetting('menuGridColumns', parseInt(e.target.value))}
                      className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer slider"
                    />
                  </div>
                </div>

                {/* Fixed Rows (6x4 등 고정 그리드 지원) */}
                <div className="mb-2 border-t border-gray-600 pt-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-sm text-gray-300">
                      Rows: {Number(layoutSettings.menuGridRows || 0) > 0 ? layoutSettings.menuGridRows : 'Auto'}
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const cur = Number(layoutSettings.menuGridRows || 0);
                        updateLayoutSetting('menuGridRows' as any, cur > 0 ? 0 : 4);
                      }}
                      className="px-2 py-1 rounded bg-gray-600 hover:bg-gray-500 text-xs text-white"
                      title="Toggle fixed rows"
                    >
                      {Number(layoutSettings.menuGridRows || 0) > 0 ? 'Auto' : 'Fixed'}
                    </button>
                  </div>
                  {Number(layoutSettings.menuGridRows || 0) > 0 && (
                    <input
                      type="range"
                      min="1"
                      max="10"
                      value={Number(layoutSettings.menuGridRows || 1)}
                      onChange={(e) => updateLayoutSetting('menuGridRows' as any, parseInt(e.target.value))}
                      className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer slider mt-1"
                    />
                  )}
                </div>

                {/* Row Pattern (예: 4,6,3,4) -> EMPTY 슬롯 자동 생성 */}
                <div className="mb-2 border-t border-gray-600 pt-2">
                  <label className="block text-sm mb-1 text-gray-300">Row pattern (comma):</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={String((layoutSettings as any).menuGridRowPattern?.join(',') || '4,6,3,4')}
                      onChange={(e) => {
                        const raw = String(e.target.value || '');
                        const nums = (raw.match(/\d+/g) || []).map(n => parseInt(n, 10)).filter(n => Number.isFinite(n));
                        updateLayoutSetting('menuGridRowPattern' as any, nums);
                      }}
                      className="flex-1 h-10 px-3 rounded bg-gray-800 border border-gray-600 text-gray-100 text-sm font-mono"
                      placeholder="e.g. 4,6,3,4"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        try {
                          if (!selectedCategory || selectedCategory === MERGY_CATEGORY_ID) {
                            alert('Please select a category first.');
                            return;
                          }
                          const cat = categories.find(c => c.name === selectedCategory);
                          if (!cat) {
                            alert('Selected category not found.');
                            return;
                          }
                          const cols = Math.max(1, Number(layoutSettings.menuGridColumns) || 1);
                          const rows = Math.max(1, Number(layoutSettings.menuGridRows || 0) > 0 ? Number(layoutSettings.menuGridRows) : 4);
                          const patRaw = Array.isArray((layoutSettings as any).menuGridRowPattern) ? (layoutSettings as any).menuGridRowPattern : [];
                          const pat = Array.from({ length: rows }, (_, i) => {
                            const v = Number(patRaw[i] ?? cols);
                            if (!Number.isFinite(v)) return cols;
                            return Math.max(0, Math.min(cols, Math.floor(v)));
                          });

                          // Build ordered list of real items (preserve existing layout order first)
                          const available = filteredMenuItems.map(it => String(it.id));
                          const map = { ...((layoutSettings as any).menuItemOrderByCategory || {}) };
                          const saved: string[] = Array.isArray(map[cat.category_id]) ? map[cat.category_id] : [];
                          const ordered: string[] = [];
                          for (const id of saved) {
                            const sid = String(id);
                            if (sid.startsWith('EMPTY:')) continue;
                            if (available.includes(sid) && !ordered.includes(sid)) ordered.push(sid);
                          }
                          for (const id of available) {
                            if (!ordered.includes(id)) ordered.push(id);
                          }

                          let cursor = 0;
                          const nextIds: string[] = [];
                          let emptySeq = 0;
                          for (let r = 0; r < rows; r++) {
                            const take = pat[r] ?? cols;
                            for (let c = 0; c < take; c++) {
                              if (cursor < ordered.length) nextIds.push(ordered[cursor++]);
                            }
                            for (let c = take; c < cols; c++) {
                              nextIds.push(`EMPTY:${cat.category_id}:${r}:${emptySeq++}`);
                            }
                          }
                          while (cursor < ordered.length) nextIds.push(ordered[cursor++]);

                          map[cat.category_id] = nextIds;
                          updateLayoutSetting('menuItemOrderByCategory' as any, map);
                          // Ensure fixed rows is enabled for predictable 6x4 behavior
                          if (!(Number(layoutSettings.menuGridRows || 0) > 0)) {
                            updateLayoutSetting('menuGridRows' as any, rows);
                          }
                        } catch (err: any) {
                          console.warn('Failed to apply row pattern:', err);
                          alert('Failed to apply row pattern.');
                        }
                      }}
                      className="h-10 px-3 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold"
                      title="Apply pattern to current category"
                    >
                      Apply
                    </button>
                  </div>
                  <div className="mt-1 text-xs text-gray-400">
                    Example: 6x4 with <span className="font-mono">4,6,3,4</span> keeps empty slots to lock line breaks.
                  </div>
                </div>

                {/* Font Size Settings */}
                <div className="mb-1">
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-gray-300">Font Size: {layoutSettings.menuFontSize}px</label>
                    <div className="flex space-x-1">
                      <button
                        onClick={() => {
                           updateLayoutSetting('menuFontBold', !layoutSettings.menuFontBold);
                           if (!layoutSettings.menuFontBold) updateLayoutSetting('menuFontExtraBold', false);
                         }}
                        className={`text-xs px-2 py-0.5 rounded border ${layoutSettings.menuFontBold ? 'bg-blue-600 text-white border-blue-700' : 'bg-gray-600 text-gray-200 border-gray-500'}`}
                        title="Toggle bold (+100)"
                      >
                        Bold
                      </button>
                      <button
                        onClick={() => {
                           updateLayoutSetting('menuFontExtraBold', !layoutSettings.menuFontExtraBold);
                           if (!layoutSettings.menuFontExtraBold) updateLayoutSetting('menuFontBold', false);
                         }}
                        className={`text-xs px-2 py-0.5 rounded border ${layoutSettings.menuFontExtraBold ? 'bg-purple-600 text-white border-purple-700' : 'bg-gray-600 text-gray-200 border-gray-500'}`}
                        title="Toggle extra bold (+200)"
                      >
                        Extra Bold
                      </button>
                    </div>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="25"
                    value={layoutSettings.menuFontSize}
                    onChange={(e) => updateLayoutSetting('menuFontSize', parseInt(e.target.value))}
                    className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer slider"
                  />
                </div>

                {/* Button Size Settings */}
                <div className="mb-1">
                  <label className="block text-sm mb-1 text-gray-300">Button Height: {layoutSettings.menuItemHeight}px</label>
                  <input
                    type="range"
                    min="32"
                    max="80"
                    value={layoutSettings.menuItemHeight}
                    onChange={(e) => updateLayoutSetting('menuItemHeight', parseInt(e.target.value))}
                    className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer slider"
                  />
                </div>

                {/* Show Prices Toggle */}
                <div className="pt-1 border-t border-gray-600">
                  <div className="p-2 bg-gray-600 rounded-lg space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-gray-300">Show Prices</label>
                      <button
                        onClick={() => updateLayoutSetting('showPrices', !layoutSettings.showPrices)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${layoutSettings.showPrices ? 'bg-yellow-600' : 'bg-gray-500'}`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${layoutSettings.showPrices ? 'translate-x-6' : 'translate-x-1'}`}
                        />
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-gray-300">Use Short Name</label>
                      <button
                        onClick={() => updateLayoutSetting('useShortName', !layoutSettings.useShortName)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${layoutSettings.useShortName ? 'bg-yellow-600' : 'bg-gray-500'}`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${layoutSettings.useShortName ? 'translate-x-6' : 'translate-x-1'}`}
                        />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Menu Item Button Color Selection */}

                <div className="pt-1 border-t border-gray-600">
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-gray-300">Menu Item Button Color</label>
                    <div 
                      className={`w-8 h-8 rounded border-2 border-blue-400 cursor-pointer ${layoutSettings.menuDefaultColor}`}
                      onClick={() => setShowMenuColorModal(true)}
                      title="Current color - click to change"
                    />
                  </div>
                </div>

                {/* Custom Menu Item Colors */}
                <div className="pt-1 border-t border-gray-600">
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-gray-300">Custom Menu Item Colors</label>
                    <button
                      onClick={() => { if (!selectedMenuItemId) { alert('Please select a menu item to change color.'); return; } const it = menuItems.find(m => m.id === selectedMenuItemId); if (it) { setSelectedItemForColor(it as any); setShowItemColorModal(true); } }}
                      className="w-8 h-8 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg transition-colors flex items-center justify-center"
                      title="Set individual colors for menu items"
                    >
                      C
                    </button>
                  </div>
                </div>

                
              </>
            )}
          </div>
          {/* Modifier Tab Settings */}
          <div className="mb-3 bg-gray-700 rounded-lg p-2" style={{ display: isTogo ? 'none' : undefined }}>
            <div className="flex items-center justify-between mb-2 bg-gray-500 rounded-t-lg p-2 -m-2 mb-3">
              <h3 className="text-sm font-semibold text-white">Modifier Tab</h3>
              <button
                onClick={() => setModifierTabExpanded(!modifierTabExpanded)}
                className="text-white hover:text-gray-200 transition-colors"
                title={modifierTabExpanded ? 'Collapse' : 'Expand'}
              >
                {modifierTabExpanded ? '▲' : '▼'}
              </button>
            </div>
            
            
            {modifierTabExpanded && (
              <>
                {/* Row/Column Settings */}
                <div className="grid grid-cols-2 gap-2 mb-1">
                  <div>
                    <label className="block text-sm mb-1 text-gray-300">Rows: {layoutSettings.modifierRows}</label>
                    <input
                      type="range"
                      min="1"
                      max="10"
                      value={layoutSettings.modifierRows}
                      onChange={(e) => updateLayoutSetting('modifierRows', parseInt(e.target.value))}
                      className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer slider"
                    />
                  </div>

                  <div>
                    <label className="block text-sm mb-1 text-gray-300">Columns: {layoutSettings.modifierColumns}</label>
                    <input
                      type="range"
                      min="2"
                      max="10"
                      value={layoutSettings.modifierColumns}
                      onChange={(e) => updateLayoutSetting('modifierColumns', parseInt(e.target.value))}
                      className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer slider"
                    />
                  </div>
                </div>

                {/* Per-item modifier layout override */}
                {selectedMenuItemId && modCategoryKey && (
                  <div className="mb-2 border-t border-gray-600 pt-2">
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-gray-300 flex-1">Per-item modifier layout:</label>
                      {modifierLayoutByItem[selectedMenuItemId] ? (
                        <button
                          type="button"
                          onClick={() => {
                            setModifierLayoutByItem(prev => {
                              const copy = { ...prev };
                              delete copy[selectedMenuItemId];
                              return copy;
                            });
                            try { localStorage.removeItem(getLayoutKey(selectedMenuItemId)); } catch {}
                          }}
                          className="h-8 px-3 rounded bg-yellow-600 hover:bg-yellow-700 text-white text-xs font-bold"
                        >
                          Reset to Category
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            const catLayout = modCategoryKey ? modifierLayoutByItem[modCategoryKey] : undefined;
                            const base = catLayout ? catLayout.slice() : slotItemIds.slice();
                            setModifierLayoutByItem(prev => ({ ...prev, [selectedMenuItemId]: base }));
                            try { localStorage.setItem(getLayoutKey(selectedMenuItemId), JSON.stringify(base)); } catch {}
                          }}
                          className="h-8 px-3 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold"
                        >
                          Override for this item
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {modifierLayoutByItem[selectedMenuItemId]
                        ? 'This item has its own modifier layout. DnD changes apply to this item only.'
                        : 'Using category layout. DnD changes apply to all items in this category.'}
                    </p>
                  </div>
                )}

                {/* Modifier Row Pattern (예: 4,6,3,4) -> EMPTY 슬롯 자동 생성 */}
                <div className="mb-2 border-t border-gray-600 pt-2">
                  <label className="block text-sm mb-1 text-gray-300">Row pattern (comma):</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={String((layoutSettings as any).modifierRowPattern?.join(',') || '')}
                      onChange={(e) => {
                        const raw = String(e.target.value || '');
                        const nums = (raw.match(/\d+/g) || []).map(n => parseInt(n, 10)).filter(n => Number.isFinite(n));
                        updateLayoutSetting('modifierRowPattern' as any, nums);
                      }}
                      className="flex-1 h-10 px-3 rounded bg-gray-800 border border-gray-600 text-gray-100 text-sm font-mono"
                      placeholder="e.g. 4,6,3,4"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        try {
                          const cols = Math.max(1, Number(layoutSettings.modifierColumns) || 1);
                          const rows = Math.max(1, Number(layoutSettings.modifierRows) || 1);
                          const capacity = cols * rows;
                          const patRaw = Array.isArray((layoutSettings as any).modifierRowPattern) ? (layoutSettings as any).modifierRowPattern : [];
                          const pat = Array.from({ length: rows }, (_, i) => {
                            const v = Number(patRaw[i] ?? cols);
                            if (!Number.isFinite(v)) return cols;
                            return Math.max(0, Math.min(cols, Math.floor(v)));
                          });

                          const targetKey = modLayoutKey || modCategoryKey;
                          if (!targetKey) {
                            alert('Please select a menu item (or a category) first.');
                            return;
                          }

                          const allAvailable = combinedEntries.map((e: any) => String(e.id));
                          const currentIds = (modifierLayoutByItem[targetKey] || slotItemIds || []).map(String);
                          const ordered: string[] = [];
                          for (const id of currentIds) {
                            if (id.startsWith('EMPTY:')) continue;
                            if (id === '__MOD_EXTRA1__' || id === '__MOD_EXTRA2__') continue;
                            if (allAvailable.includes(id) && !ordered.includes(id)) ordered.push(id);
                          }
                          for (const id of allAvailable) {
                            if (!ordered.includes(id)) ordered.push(id);
                          }

                          let cursor = 0;
                          const nextIds: string[] = [];
                          let emptySeq = 0;
                          for (let r = 0; r < rows; r++) {
                            const take = pat[r] ?? cols;
                            for (let c = 0; c < take; c++) {
                              if (cursor < ordered.length && nextIds.length < capacity) nextIds.push(ordered[cursor++]);
                            }
                            for (let c = take; c < cols; c++) {
                              if (nextIds.length < capacity) nextIds.push(`EMPTY:${targetKey}:${r}:${emptySeq++}`);
                            }
                          }
                          while (cursor < ordered.length && nextIds.length < capacity) nextIds.push(ordered[cursor++]);
                          while (nextIds.length < capacity) nextIds.push(`EMPTY:${targetKey}:tail:${emptySeq++}`);

                          setModifierLayoutByItem((prev: any) => ({ ...(prev || {}), [targetKey]: nextIds }));
                          try { localStorage.setItem(getLayoutKey(targetKey), JSON.stringify(nextIds)); } catch {}
                        } catch (err: any) {
                          console.warn('Failed to apply modifier row pattern:', err);
                          alert('Failed to apply modifier row pattern.');
                        }
                      }}
                      className="h-10 px-3 rounded bg-purple-600 hover:bg-purple-700 text-white text-sm font-bold"
                      title="Apply pattern to current modifier grid"
                    >
                      Apply
                    </button>
                  </div>
                  <div className="mt-1 text-xs text-gray-400">
                    Tip: set Columns=6, Rows=4, pattern <span className="font-mono">4,6,3,4</span>.
                  </div>
                </div>

                {/* Font Size Settings */}
                <div className="mb-1">
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-gray-300">Font Size: {layoutSettings.modifierFontSize}px</label>
                    <div className="flex space-x-1">
                      <button
                        onClick={() => {
                          updateLayoutSetting('modifierFontBold', !layoutSettings.modifierFontBold);
                          if (!layoutSettings.modifierFontBold) updateLayoutSetting('modifierFontExtraBold', false);
                        }}
                        className={`text-xs px-2 py-0.5 rounded border ${layoutSettings.modifierFontBold ? 'bg-blue-600 text-white border-blue-700' : 'bg-gray-600 text-gray-200 border-gray-500'}`}
                        title="Toggle bold (+100)"
                      >
                        Bold
                      </button>
                      <button
                        onClick={() => {
                          updateLayoutSetting('modifierFontExtraBold', !layoutSettings.modifierFontExtraBold);
                          if (!layoutSettings.modifierFontExtraBold) updateLayoutSetting('modifierFontBold', false);
                        }}
                        className={`text-xs px-2 py-0.5 rounded border ${layoutSettings.modifierFontExtraBold ? 'bg-purple-600 text-white border-purple-700' : 'bg-gray-600 text-gray-200 border-gray-500'}`}
                        title="Toggle extra bold (+200)"
                      >
                        Extra Bold
                      </button>
                    </div>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="20"
                    value={layoutSettings.modifierFontSize}
                    onChange={(e) => updateLayoutSetting('modifierFontSize', parseInt(e.target.value))}
                    className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer slider"
                  />
                </div>

                {/* Button Size Settings */}
                <div className="mb-1">
                  <label className="block text-sm mb-1 text-gray-300">Button Height: {layoutSettings.modifierItemHeight}px</label>
                  <input
                    type="range"
                    min="32"
                    max="80"
                    value={layoutSettings.modifierItemHeight}
                    onChange={(e) => updateLayoutSetting('modifierItemHeight', parseInt(e.target.value))}
                    className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer slider"
                  />
                </div>



                {/* Show Prices Toggle */}
                <div className="pt-1 border-t border-gray-600">
                  <div className="flex items-center justify-between p-2 bg-gray-600 rounded-lg">
                    <div>
                      <label className="text-sm font-medium text-gray-300">Show Prices</label>
                    </div>
                    <button
                      onClick={() => updateLayoutSetting('modifierShowPrices', !layoutSettings.modifierShowPrices)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${layoutSettings.modifierShowPrices ? 'bg-yellow-600' : 'bg-gray-500'}`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${layoutSettings.modifierShowPrices ? 'translate-x-6' : 'translate-x-1'}`}
                      />
                    </button>
                  </div>
                </div>

                {/* Modifier Button Color */}
                <div className="pt-1 border-t border-gray-600">
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-gray-300">Modifier Button Color</label>
                    <div 
                      onClick={() => { setModifierColorModalSource('default'); setShowModifierColorModal(true); }}
                      className={`w-8 h-8 rounded cursor-pointer border-2 border-white/50 transition-all duration-200 hover:scale-105 ${layoutSettings.modifierDefaultColor}`}
                      title="Click to select modifier button color"
                    ></div>
                  </div>
                </div>

                {/* Custom Modifier Colors */}
                <div className="pt-1 border-t border-gray-600">
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-gray-300">Custom Modifier Colors</label>
                    <button
                      onClick={() => { if (!selectedModifierIdForColor) { alert('Please select a modifier to change color.'); return; } setModifierColorModalSource('custom'); setShowModifierColorModal(true); }}
                      className="w-8 h-8 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg transition-colors flex items-center justify-center"
                      title="Set individual colors for modifiers"
                    >
                      C
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
          {/* Extra Button Tab (Table only) */}
          {!isTogo && (
            <div className="mb-3 bg-gray-700 rounded-lg p-2">
                             <div className="flex items-center justify-between mb-2 bg-gray-500 rounded-t-lg p-2 -m-2 mb-3">
                 <h3 className="text-sm font-semibold text-white">Extra Button Tab</h3>
                <button
                  onClick={() => setBagFeeTabExpanded(!bagFeeTabExpanded)}
                  className="text-white hover:text-gray-200 transition-colors"
                  title={bagFeeTabExpanded ? 'Collapse' : 'Expand'}
                >
                  {bagFeeTabExpanded ? '▲' : '▼'}
                </button>
              </div>
              {bagFeeTabExpanded && (
                <div className="p-1 rounded bg-gray-600 text-sm text-gray-200 space-y-1">
                  {/* Item Extra Buttons */}
                  <div className="space-y-1 p-1.5 rounded-lg bg-gray-700 border border-gray-500">
                    <h4 className="text-xs font-semibold text-white">Item Extra Buttons</h4>
                    {/* Togo Label Button */}
                    <div className="flex items-center justify-between">
                      <span className="text-gray-200">Togo Label Enable</span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setItemTogoEnabled(v => !v)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${itemTogoEnabled ? 'bg-yellow-600' : 'bg-gray-500'}`}>
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${itemTogoEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      </div>
                    </div>
                    {/* Extra Button 1 */}
                    <div className="flex items-center justify-between">
                      <span className="text-gray-200">Extra 1 Enable</span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setShowItemExtra1SettingsModal(true)} className="text-xs px-2 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded">Settings</button>
                        <button onClick={() => setTableBagFeeEnabled(v => !v)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${tableBagFeeEnabled ? 'bg-yellow-600' : 'bg-gray-500'}`}>
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${tableBagFeeEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      </div>
                    </div>
                    {/* Extra Button 2 */}
                    <div className="flex items-center justify-between">
                      <span className="text-gray-200">Extra 2 Enable</span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setShowItemExtra2SettingsModal(true)} className="text-xs px-2 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded">Settings</button>
                        <button onClick={() => setExtra2Enabled(v => !v)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${extra2Enabled ? 'bg-yellow-600' : 'bg-gray-500'}`}>
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${extra2Enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      </div>
                    </div>
                    {/* Extra Button 3 */}
                    <div className="flex items-center justify-between">
                      <span className="text-gray-200">Extra 3 Enable</span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setShowItemExtra3SettingsModal(true)} className="text-xs px-2 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded">Settings</button>
                        <button onClick={() => setExtra3Enabled(v => !v)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${extra3Enabled ? 'bg-yellow-600' : 'bg-gray-500'}`}>
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${extra3Enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="my-1.5 border-t-2 border-gray-500" />
                  {/* Modifier Extra Buttons */}
                  <div className="space-y-1 p-1.5 rounded-lg bg-gray-700 border border-gray-500">
                    <h4 className="text-xs font-semibold text-white">Modifier Extra Buttons</h4>
                    {/* Modifier Extra 1 */}
                    <div className="flex items-center justify-between">
                      <span className="text-gray-200">Extra 1 Enable</span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setShowModifierExtra1SettingsModal(true)} className="text-xs px-2 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded">Settings</button>
                        <button onClick={() => setModExtra1Enabled(v => !v)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${modExtra1Enabled ? 'bg-yellow-600' : 'bg-gray-500'}`}>
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${modExtra1Enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      </div>
                    </div>
                    {/* Modifier Extra 2 */}
                    <div className="flex items-center justify-between">
                      <span className="text-gray-200">Extra 2 Enable</span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setShowModifierExtra2SettingsModal(true)} className="text-xs px-2 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded">Settings</button>
                        <button onClick={() => setModExtra2Enabled(v => !v)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${modExtra2Enabled ? 'bg-yellow-600' : 'bg-gray-500'}`}>
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${modExtra2Enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Function Tab */}
          <div className="mb-3 bg-gray-700 rounded-lg p-2" style={{ display: isTogo ? 'none' : undefined }}>
            <div className="flex items-center justify-between mb-2 bg-gray-500 rounded-t-lg p-2 -m-2 mb-3">
              <h3 className="text-sm font-semibold text-white">Function Tab</h3>
              <button
                onClick={() => setFunctionTabExpanded(!functionTabExpanded)}
                className="text-white hover:text-gray-200 transition-colors"
                title={functionTabExpanded ? 'Collapse' : 'Expand'}
              >
                {functionTabExpanded ? '▲' : '▼'}
              </button>
            </div>
            {functionTabExpanded && (
              <>
                {/* Soft Keyboard Languages (for on-screen keyboard) */}
                <div className="space-y-2 mt-0">
                  <div className="p-2 bg-gray-600 rounded-lg border border-gray-500 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-gray-100">Keyboard Languages</div>
                    </div>
                    <div className="text-[11px] text-gray-200">Select languages available for the in-app soft keyboard. You can add or remove codes like EN, KO, JA, ZH.</div>
                    <div className="space-y-2">
                      <div>
                        <label className="block text-xs text-gray-200 mb-1 whitespace-nowrap">Add from presets</label>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            className="h-8 w-auto min-w-[180px] max-w-full text-xs px-2 rounded bg-gray-700 text-white border border-gray-500"
                            value={keyboardLangSelect}
                            onChange={(e) => setKeyboardLangSelect(e.target.value)}
                          >
                            <option value="">Select Preset</option>
                            <option value="EN">English (EN)</option>
                            <option value="KO">Korean (KO)</option>
                            <option value="JA">Japanese (JA)</option>
                            <option value="ZH">Chinese (ZH)</option>
                            <option value="ES">Spanish (ES)</option>
                            <option value="FR">French (FR)</option>
                            <option value="DE">German (DE)</option>
                            <option value="IT">Italian (IT)</option>
                          </select>
                          <button
                            className="h-8 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs"
                            onClick={() => {
                              const next = ((layoutSettings as any).keyboardLanguages || []);
                              const toAdd = keyboardLangSelect;
                              const code = (toAdd || '').trim().toUpperCase();
                              if (!code) return;
                              if (!next.includes(code)) {
                                updateLayoutSetting('keyboardLanguages' as keyof LayoutSettings, [...next, code]);
                              }
                              setKeyboardLangSelect('');
                            }}
                          >Add</button>
                          <button
                            className="h-8 px-3 bg-gray-500 hover:bg-gray-600 text-white rounded text-xs"
                            onClick={() => { setKeyboardLangSelect(''); }}
                          >Clear</button>
                        </div>
                      </div>
                    </div>
                    <div className="pt-2">
                      <div className="text-xs text-gray-200 mb-1">Selected Languages</div>
                      <div className="flex flex-wrap gap-2 items-center">
                        {(((layoutSettings as any).keyboardLanguages || []).length === 0) && (
                          <span className="text-[11px] text-gray-300">No languages selected</span>
                        )}
                        {(((layoutSettings as any).keyboardLanguages || []) as string[]).map((code: string) => (
                          <div key={code} className="flex items-center gap-1 bg-gray-700 text-white text-xs pl-2 pr-1 py-1 rounded border border-gray-500">
                            <span className="px-0.5">{code}</span>
                            <button
                              className="h-5 w-5 flex items-center justify-center rounded hover:bg-gray-600 text-red-300 hover:text-red-200"
                              onClick={() => {
                                const next = (((layoutSettings as any).keyboardLanguages || []) as string[]).filter((c: string) => c !== code);
                                updateLayoutSetting('keyboardLanguages' as keyof LayoutSettings, next);
                              }}
                              title="Remove"
                            >×</button>
                          </div>
                        ))}
                        {(((layoutSettings as any).keyboardLanguages || []) as string[]).length > 0 && (
                          <span className="text-[11px] text-gray-300 ml-1">(Total {(((layoutSettings as any).keyboardLanguages || []) as string[]).length})</span>
                        )}
                      </div>
                    </div>
                    <div className="text-[11px] text-gray-300">This list is used by the in-app soft keyboard only. OS system keyboards are managed in device settings.</div>
                  </div>
                </div>

                {/* Void Settings Block */}
                <div className="space-y-2 mt-3">
                  <div className="p-2 bg-gray-600 rounded-lg border border-gray-500 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-gray-100">Void Settings</div>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-200 mb-1">Country/Currency</label>
                      <select
                        className="w-full text-xs px-2 py-1 rounded bg-gray-700 text-white border border-gray-500"
                        value={layoutSettings.voidCurrencyProfile || 'US'}
                        onChange={(e) => updateLayoutSetting('voidCurrencyProfile', e.target.value)}
                      >
                        <option value="CA">Canada (CA)</option>
                        <option value="US">United States (US)</option>
                        <option value="UK">United Kingdom (UK)</option>
                        <option value="EU">European Union (EU)</option>
                        <option value="MX">Mexico (MX)</option>
                        <option value="KR">South Korea (KR)</option>
                        <option value="JP">Japan (JP)</option>
                        <option value="CN">China (CN)</option>
                      </select>
                    </div>
                    <div className="text-xs text-gray-200">Threshold</div>
                    <div>
                      <label className="block text-xs text-gray-200 mb-1">Manager approval when amount ≥ {layoutSettings.voidThreshold ?? 0}</label>
                      <input
                        type="range"
                        min={0}
                        max={(layoutSettings.voidCurrencyProfile || 'US') === 'KR' ? 200000 : (layoutSettings.voidCurrencyProfile === 'JP' ? 20000 : 200)}
                        step={(layoutSettings.voidCurrencyProfile || 'US') === 'KR' ? 5000 : (layoutSettings.voidCurrencyProfile === 'JP' ? 500 : 5)}
                         className="w-full slider"
                        list="voidThresholdTicks"
                        value={layoutSettings.voidThreshold ?? 0}
                        onChange={(e) => {
                          const raw = parseFloat(e.target.value) || 0;
                          const clamped = raw === 0 ? 0 : Math.max(20, raw);
                          updateLayoutSetting('voidThreshold', clamped);
                        }}
                      />
                      <datalist id="voidThresholdTicks">
                        <option value="0" />
                        <option value="20" />
                        <option value="40" />
                        <option value="60" />
                        <option value="80" />
                        <option value="100" />
                        <option value="120" />
                        <option value="140" />
                        <option value="160" />
                        <option value="180" />
                        <option value="200" />
                      </datalist>
                    </div>

                    <div className="pt-1 border-t border-gray-500 mt-2 text-[11px]">
                      {(layoutSettings.voidThreshold ?? 0) === 0 ? (
                        <span className="text-green-300">No manager approval required</span>
                      ) : (
                        <div className="space-y-0.5">
                          <div className="text-gray-200">Manager approval required for amount ≥ {layoutSettings.voidThreshold}</div>
                          <div className="text-gray-300">Manager approval required for amount ≥ 200</div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Open Price Settings Block removed as per request */}
              </>
            )}
          </div>



          {/* Pro Tab (Table only) */}
          <ProTab
            isTogo={isTogo}
            expanded={proTabExpanded}
            onToggleExpanded={() => setProTabExpanded(!proTabExpanded)}
            onDiscountClick={() => setShowPromotionSettingsModal(true)}
                     />

          <Suspense fallback={null}>
          <PromotionSettingsModal
            open={showPromotionSettingsModal}
            onClose={() => setShowPromotionSettingsModal(false)}
            discountRules={promotionRules}
            freeItemPromotions={freeItemPromotions as any}
            applyMode={promotionApplyMode}
            onChangeApplyMode={setPromotionApplyMode}
            onOpenDiscountRules={() => {
              setShowPromotionSettingsModal(false);
              const modalId = `disc-new-${Date.now()}`;
              setOpenDiscountRuleModals(prev => [...prev, { modalId, mode: 'new' }]);
            }}
            onOpenFreeItemModal={() => {
              setShowPromotionSettingsModal(false);
              setEditingFreePromoId(null);
              setShowFreeItemModal(true);
            }}
            onEditDiscountRule={(id)=> {
              setShowPromotionSettingsModal(false);
              const modalId = `disc-edit-${id}-${Date.now()}`;
              setOpenDiscountRuleModals(prev => [...prev, { modalId, mode: 'edit', ruleId: id }]);
            }}
            onDeleteDiscountRule={(id)=> setPromotionRules(prev => (prev||[]).filter(r => r.id !== id))}
            onToggleDiscountRule={(id, enabled)=> setPromotionRules(prev => (prev||[]).map(r => r.id===id ? { ...r, enabled } : r))}
            onEditFreeItemPromotion={(id)=> { setShowPromotionSettingsModal(false); setEditingFreePromoId(id); setShowFreeItemModal(true); }}
            onDeleteFreeItemPromotion={(id)=> setFreeItemPromotions(prev => (prev||[]).filter(p => p.id !== id))}
            onToggleFreeItemPromotion={(id, enabled)=> setFreeItemPromotions(prev => (prev||[]).map(p => p.id===id ? { ...p, enabled } : p))}
          />

          {openDiscountRuleModals.map(m => (
            <PromotionRulesModal
              key={m.modalId}
              open={true}
              onClose={() => { setOpenDiscountRuleModals(prev => prev.filter(x => x.modalId !== m.modalId)); setShowPromotionSettingsModal(true); }}
              rules={m.mode === 'edit' ? (promotionRules || []).filter(r => r.id === m.ruleId) : []}
              onChangeRules={(saved)=> {
                if (m.mode === 'new') {
                  setPromotionRules(prev => {
                    const newer = (saved || []).map((r:any) => ({ ...r, createdAt: (r as any).createdAt || Date.now() }));
                    return [...newer, ...(prev || [])];
                  });
                } else if (m.mode === 'edit' && m.ruleId) {
                  const updated = saved && saved[0] ? saved[0] : null;
                  if (updated) setPromotionRules(prev => (prev||[]).map(r => r.id === m.ruleId ? { ...r, ...updated } : r));
                }
                setOpenDiscountRuleModals(prev => prev.filter(x => x.modalId !== m.modalId));
                setShowPromotionSettingsModal(true);
              }}
              categories={categories as any}
              menuItems={menuItems as any}
              newMode={m.mode === 'new'}
            />
          ))}

          <FreeItemRulesModal
            open={showFreeItemModal}
            onClose={() => { setShowFreeItemModal(false); setShowPromotionSettingsModal(true); setEditingFreePromoId(null); }}
            rules={editingFreePromoId ? (freeItemPromotions||[]).filter(p => p.id === editingFreePromoId) : []}
            onChangeRules={(saved)=> {
              if (Array.isArray(saved) && saved.length>0) {
                if (editingFreePromoId) {
                  const updated = saved[0];
                  setFreeItemPromotions(prev => (prev||[]).map(p => p.id===editingFreePromoId ? { ...p, ...updated } : p));
                } else {
                  setFreeItemPromotions(prev => [{ ...saved[0], createdAt: (saved[0] as any).createdAt || Date.now() }, ...prev]);
                }
              }
              setShowFreeItemModal(false);
              setShowPromotionSettingsModal(true);
              setEditingFreePromoId(null);
            }}
            categories={categories as any}
            menuItems={menuItems as any}
            newMode={!editingFreePromoId}
          />

                    <PromotionCreateModal
            open={showPromotionCreateModal}
            onClose={() => setShowPromotionCreateModal(false)}
            discountRules={promotionRules}
            onChangeDiscountRules={setPromotionRules}
          />
          </Suspense>
 
          <div className="flex space-x-2">
            <button 
              onClick={resetLayoutSettings}
              className="w-[30%] bg-gray-600 hover:bg-gray-700 text-white py-2 px-4 rounded-lg transition-colors font-medium text-sm"
            >
              Reset
            </button>
            <button 
              onClick={() => saveLayoutSettings()}
              className="w-[70%] bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg transition-colors font-medium text-sm"
            >
              Save
            </button>
          </div>
        </div>
      </div>
      {/* Right Area - Canvas with Order Interface (Back Office: 70% 고정) */}
      <div 
        ref={rightAreaRef}
        className="flex flex-col items-center justify-start relative z-50 overflow-hidden"
        style={{ width: !isSalesOrder ? '70%' : undefined, flex: !isSalesOrder ? undefined : 1 }}
        onClick={(e) => {
          const target = e.target as HTMLElement;
          if (!target.closest('.floating-action-bar') && !target.closest('[data-order-item]')) {
            if (selectedOrderItemId || selectedOrderLineId) {
              clearSelection();
            }
          }
        }}
      >
        {/* Canvas Container */}
         <div 
           ref={canvasRef}
           className="flex-none flex flex-col bg-white shadow-lg my-4 rounded-lg overflow-hidden"
          style={{ 
            width: isSalesOrder ? `${(boScreenSize ? boScreenSize.width : 1024)}px` : (() => { const p = layoutSettings.screenResolution.split('x').map(Number); return p[0] ? `${p[0]}px` : '800px'; })(),
            height: isSalesOrder ? `${(boScreenSize ? boScreenSize.height : 768)}px` : (() => { const p = layoutSettings.screenResolution.split('x').map(Number); return p[1] ? `${p[1]}px` : '600px'; })(),
            minWidth: isSalesOrder ? `${(boScreenSize ? boScreenSize.width : 1024)}px` : undefined,
            minHeight: isSalesOrder ? `${(boScreenSize ? boScreenSize.height : 768)}px` : undefined,
            maxWidth: isSalesOrder ? `${(boScreenSize ? boScreenSize.width : 1024)}px` : undefined,
            maxHeight: isSalesOrder ? `${(boScreenSize ? boScreenSize.height : 768)}px` : undefined,
            overflow: 'hidden',
            position: 'relative',
            transform: isSalesOrder ? `scale(${orderPageScale})` : 'none',
            transformOrigin: 'top center',
            zoom: !isSalesOrder && boCanvasZoom < 1 ? boCanvasZoom : undefined,
            scrollbarWidth: 'none',
            msOverflowStyle: 'none'
          } as React.CSSProperties}
           id="pos-canvas-anchor"
         >
            {/* Content wrapper - 스케일링 없이 꽉 차게 (하단 버튼 잘림 방지 위해 20px 여유) */}
            <div
              style={{
                width: '100%',
                height: 'calc(100% - 20px)',
                display: 'flex',
                flexDirection: 'column'
              }}
            >
                        {/* Top Section - Left Panel + Right Panel */}
            <div className="flex flex-1 min-h-0">
            {/* Left Panel - Order List (숨김: Back Office + 화면 ≤ 1280px) */}
            {!hideOrderListPanel && (
            <div className="bg-white flex flex-col h-full" data-pos-lock="order-left-panel" style={{ width: `${layoutSettings.leftPanelWidth}%` }}>
              {/* Order Management Section */}
              <div className="bg-gray-100 flex-shrink-0">
                {/* Header */}
                <div className="px-1 py-0">
                  <div className="flex justify-between items-center">
                    {(() => {
                      const st: any = (location && (location as any).state) ? (location as any).state : {};
                      const serverNameRaw = (selectedServer?.name || st?.serverName || '').toString();
                      const formatServerName = (fullName: string) => {
                        const trimmed = fullName.trim();
                        if (!trimmed) return '';
                        const parts = trimmed.split(/\s+/);
                        if (parts.length === 1) return parts[0];
                        const first = parts[0];
                        const lastInitial = parts[parts.length - 1]?.[0] || '';
                        return lastInitial ? `${first} ${lastInitial.toUpperCase()}` : first;
                      };
                      const serverName = formatServerName(serverNameRaw);
                      return (
                        <div data-pos-lock="order-server-block">
                          <span className="text-gray-600" data-pos-lock="order-server-label" style={{ fontSize: 'var(--order-label-font)' }}>Server: </span>
                          <span className="font-medium" data-pos-lock="order-server-value" style={{ fontSize: 'var(--order-value-font)' }}>{serverName || ''}</span>
                        </div>
                      );
                    })()}
                    {(() => {
                      // Channel label with customer info (for TOGO)
                      const st: any = (location && (location as any).state) ? (location as any).state : {};
                      const ch = ((orderType || '') as string).toLowerCase();
                      const tableName = (st?.tableName || resolvedTableName || '').toString();
                      const customerNameRaw = (st?.customerName || '').toString();
                      const customerPhoneRaw = (st?.customerPhone || '').toString();

                      const formatNameBadge = (input: string) => {
                        const trimmed = input.trim();
                        if (!trimmed) return '';
                        const parts = trimmed.split(/\s+/);
                        const first = parts[0];
                        const lastInitial = parts.length > 1 ? (parts[parts.length - 1]?.[0] || '').toUpperCase() : '';
                        if (!first) return '';
                        const normalizedFirst = first.charAt(0).toUpperCase() + first.slice(1);
                        return lastInitial ? `${normalizedFirst} ${lastInitial}` : normalizedFirst;
                      };

                      const formatPhoneBadge = (input: string) => {
                        const trimmed = input.trim();
                        if (!trimmed) return '';
                        const digits = trimmed.replace(/\D/g, '');
                        if (!digits) return trimmed;
                        const len = digits.length;
                        const getTail = (count: number) => digits.slice(-count);
                        if (len <= 4) {
                          return getTail(len);
                        }
                        if (len === 7) {
                          const tail = getTail(7);
                          return `${tail.slice(0, 3)}-${tail.slice(3)}`;
                        }
                        if (len === 8) {
                          const tail = getTail(8);
                          return `${tail.slice(0, 4)}-${tail.slice(4)}`;
                        }
                        if (len === 9) {
                          const tail = getTail(9);
                          return `(${tail.slice(0, 2)})${tail.slice(2, 5)}-${tail.slice(5)}`;
                        }
                        if (len === 10) {
                          return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
                        }
                        if (len === 11) {
                          return `(${digits.slice(0, 3)})${digits.slice(3, 7)}-${digits.slice(7)}`;
                        }
                        return trimmed;
                      };

                      const customerBadge = formatNameBadge(customerNameRaw) || formatPhoneBadge(customerPhoneRaw);

                      let channelInfo = '';
                      if (ch === 'togo') {
                        channelInfo = `Togo${customerBadge ? ` • ${customerBadge}` : ''}`;
                      } else if (ch === 'delivery') {
                        channelInfo = tableName || 'Delivery';
                      } else if (ch === 'online') {
                        channelInfo = 'Online';
                      } else {
                        channelInfo = tableName ? `Table ${tableName}` : '';
                      }

                      // 일일 주문번호(order_number, 001/002...) 우선 표시. Closing 후 Opening 시 리셋됨.
                      const displayOrderId = savedOrderNumberRef.current || (savedOrderIdRef.current != null ? String(savedOrderIdRef.current) : '') || ((location.state as any)?.orderId) || '';

                      return (
                        <div data-pos-lock="order-channel-block" className="flex items-center gap-2">
                          {displayOrderId && <span className="font-medium" data-pos-lock="order-number-value" style={{ fontSize: 'var(--order-value-font)' }}>#{displayOrderId}</span>}
                          {channelInfo && <span className="font-medium" data-pos-lock="order-channel-value" style={{ fontSize: 'var(--order-value-font)' }}>{channelInfo}</span>}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Order Items Table */}
              <div className="flex-1 overflow-hidden px-1 py-0 bg-gray-100 flex flex-col min-h-0">
                {/* (Removed top banner; using centered banner within the list) */}
                <div className="mb-0">
                  <div className="bg-blue-200 py-1" data-pos-lock="order-items-header" style={{ fontSize: 'var(--order-header-font)' }}>
                    <div className="grid grid-cols-12 gap-1 font-medium text-gray-700">
                      <div className="col-span-6">Item Name</div>
                      <div className="col-span-3 text-center">Qty</div>
                      <div className="col-span-3 text-right">E.Total</div>
                    </div>
                  </div>
                </div>
                {/* Removed split banner as requested */}
                
                {/* 주문목록 스크롤 영역 + 중간 안내 배너 */}
                <div className="relative flex-1 min-h-0">
                  {soldOutMode && (
                    <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
                      <div className="pointer-events-auto bg-yellow-100 border border-yellow-400 rounded px-3 py-2 text-yellow-800 text-sm shadow min-w-[220px]">
                        <div className="font-semibold text-center text-base md:text-lg whitespace-nowrap">
                          Sold Out Mode - {selectedSoldOutType === '30min' ? '30 min' : selectedSoldOutType === '1hour' ? '1 hour' : selectedSoldOutType === 'today' ? 'Today' : selectedSoldOutType === 'indefinite' ? 'Until next opening' : ''}
                        </div>
                        <div className="text-yellow-700 text-sm md:text-base mt-1 text-center">Click on the menu and click the Done button below.</div>
                        <div className="mt-3 flex justify-center">
                          <button
                            onClick={() => {
                              setSoldOutMode(false);
                              setSelectedSoldOutType('');
                              if (soldOutModeFromSales) {
                                navigate('/sales', { replace: true });
                              }
                            }}
                            className="min-w-[120px] h-12 px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-base font-semibold shadow"
                          >
                            Done
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={orderListRef} className="absolute inset-0 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-400 scrollbar-track-gray-100 pt-0" data-pos-lock="order-items-scroll">
                  <DndContext sensors={sensors} onDragEnd={handleOrderDragEnd} onDragOver={handleOrderDragOver} collisionDetection={pointerWithin}>
                    {guestIds.map((g) => {
                      // 해당 게스트의 모든 아이템(Separator 제외)을 원본 인덱스와 함께 수집
                      const guestRows = orderItems
                        .map((it, idx) => ({ it, idx }))
                        .filter(x => x.it.type !== 'separator' && (x.it.guestNumber || 1) === g);
                        const hasSeparatorsInList = (orderItems || []).some(it => it.type === 'separator');
                        const hasRealItems = (orderItems || []).some(it => it.type !== 'separator');
                      return (
                        <React.Fragment key={`guest-block-${g}`}>
                          {hasRealItems && (guestCount > 1 || hasSeparatorsInList) && (
                            <DroppableGuestLabel guest={g}>
                          <div className={`text-center text-sm md:text-base font-semibold px-2 ${guestStatusMap[g] === 'PAID' ? 'text-gray-400' : 'text-gray-600'} flex items-center justify-center`}
                               style={{ height: `${layoutSettings.menuItemHeight * 0.4}px` }}> ･･･････ Guest {g} <span className={`ml-1 italic ${guestStatusMap[g] === 'PAID' ? 'text-gray-400' : 'text-gray-500'}`}>(${(guestTotals[g] || 0).toFixed(2)})</span> {guestStatusMap[g] === 'PAID' && <span className="ml-2 text-xs font-bold text-green-600">PAID</span>} ･･･････</div>
                            </DroppableGuestLabel>
                          )}
                          {hasRealItems && (guestCount > 1 || hasSeparatorsInList) && guestRows.length === 0 ? (
                            <GuestRowDropZone guest={g}>
                              <div style={{ height: `${layoutSettings.menuItemHeight * 0.4}px` }} />
                            </GuestRowDropZone>
                          ) : null}
                          {guestRows.filter(row => row.it.type !== 'discount' && !(row.it as any).togoLabel).map(({ it: item, idx: index }) => (
                            <DraggableDroppableOrderRow disabled={guestStatusMap[item.guestNumber || 1] === 'PAID'} guest={item.guestNumber || 1} idx={index} key={`${item.id}-${index}-${item.modifiers?.length || 0}-${(item as any).orderLineId || ''}-${item.splitDenominator || 'whole'}`}>
                              <div 
                                  data-order-item="true"
                                  className={`relative transition-all duration-200 ${
                                   item.type === 'discount' || (item as any).type === 'void'
                                     ? 'cursor-default opacity-60' 
                                     : `cursor-pointer ${
                                         ((selectedOrderLineId && (item as any).orderLineId === selectedOrderLineId) || (selectedOrderItemId === item.id && (selectedOrderGuestNumber||1) === (item.guestNumber||1) && (selectedRowIndex === index)))
                                           ? 'bg-blue-200 border-2 border-blue-600 shadow-lg' 
                                           : 'hover:bg-blue-50 border-2 border-transparent'
                                       } ${guestStatusMap[item.guestNumber || 1] === 'PAID' ? 'opacity-60 pointer-events-none' : ''}`
                                 }`}
                                  onClick={item.type === 'discount' || (item as any).type === 'void' ? undefined : (guestStatusMap[item.guestNumber || 1] === 'PAID' ? undefined : () => preserveOrderListScroll(() => handleOrderItemClick(item.id, item.guestNumber, index, (item as any).orderLineId)))}
                                  style={{ pointerEvents: (guestStatusMap[item.guestNumber || 1] === 'PAID' || (item as any).type === 'void') ? 'none' : 'auto', marginBottom: '0px' }}
                                >

                                <div className={`grid grid-cols-12 gap-1 items-center py-0 px-1 ${item.type === 'discount' ? 'bg-yellow-100 border-l-4 border-yellow-500' : (((item as any).type === 'void') ? 'bg-red-50 border-l-4 border-red-500' : (index % 2 === 0 ? 'bg-blue-100' : 'bg-blue-50'))}`}>
                                  {/* 메뉴 아이템 이름 (고정 위치) */}
                                  <div className="col-span-6">
                                    <div className={`font-medium ${item.type === 'discount' ? 'text-red-600' : (((item as any).type === 'void') ? 'text-gray-500 line-through' : 'text-gray-800')} flex items-center gap-1`} data-pos-lock="order-item-name" style={{ fontSize: 'calc(var(--order-item-font) - 2px)', lineHeight: '1.2' }}>
                                      {(item as any).item_source === 'TABLE_ORDER' && (
                                        <span className="text-[10px] px-1 py-0.5 bg-emerald-500 text-white rounded font-bold whitespace-nowrap">TBL</span>
                                      )}
                                      <span className="truncate" data-pos-lock="order-item-name-text">{item.type === 'discount' ? item.name : (layoutSettings.useShortName && item.short_name ? item.short_name : item.name)}</span>
                                    </div>
                                  </div>
                                  
                                  {/* 수량 조절 (고정 위치) */}
                                  <div className="col-span-3 flex items-center justify-center space-x-2" style={{ transform: 'translateX(14px)' }}>
                                    {item.type === 'discount' ? (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setOrderItems(prev => prev.filter(orderItem => orderItem.id !== 'DISCOUNT_ITEM'));
                                        }}
                                        className="text-white rounded-md hover:bg-red-600 transition-colors flex items-center justify-center text-sm font-bold px-4 py-2"
                                        style={{ 
                                          backgroundColor: 'rgba(239, 68, 68, 0.9)', // red-500 with 90% opacity
                                          width: '40px',
                                          height: '40px',
                                          minWidth: '40px',
                                          minHeight: '40px',
                                          fontSize: 'calc(var(--order-item-font) - 2px)'
                                        }}
                                      >
                                        X
                                      </button>
                                    ) : ((item as any).type === 'void') ? (
                                      <div className="flex items-center gap-2">
                                        <div className="text-xs font-bold text-red-600 px-2 py-1 border border-red-400 rounded">VOID</div>
                                        <div className="text-sm font-bold text-red-600" style={{ fontSize: 'calc(var(--order-item-font) - 2px)' }}>x{item.quantity || 1}</div>
                                      </div>
                                    ) : (
                                      <>
                {(() => {
                  const orderSaved = !!savedOrderIdRef.current;
                  const orderLineIdRaw = (item as any).orderLineId;
                  const orderLineId = (orderLineIdRaw != null && String(orderLineIdRaw).trim() !== '') ? String(orderLineIdRaw) : '';
                  const hasOrderLineId = !!orderLineId;

                  // In update mode (Occupied / saved order), "existing saved line" means:
                  // - has orderLineId
                  // - and it existed in the originally loaded DB snapshot (tracked in originalSavedQuantitiesRef).
                  // Newly added lines in update mode also have orderLineId, but are NOT present in originalSavedQuantitiesRef.
                  const hasOriginal =
                    hasOrderLineId &&
                    Object.prototype.hasOwnProperty.call(originalSavedQuantitiesRef.current || {}, orderLineId);
                  const isExistingSavedLine = orderSaved && hasOrderLineId && hasOriginal;

                  // For existing saved lines: '-' only allowed when currentQty > originalQty.
                  // For newly added lines (even in update mode): treat as new → '-' enabled (handled by "new item" branch).
                  const currentQty = item.quantity || 1;
                  const originalQty = hasOriginal ? (originalSavedQuantitiesRef.current[orderLineId] || currentQty) : currentQty;
                  const canDecrement = currentQty > originalQty;

                  console.log(`🔍 ${item.name}: orderLineId=${orderLineId}, savedOrderId=${savedOrderIdRef.current}, isExistingSavedLine=${isExistingSavedLine}, hasOrderLineId=${hasOrderLineId}, hasOriginal=${hasOriginal}, currentQty=${currentQty}, originalQty=${originalQty}, canDecrement=${canDecrement}`);
                  return isExistingSavedLine;
                })() ? (
                  // 저장된 메뉴: 현재 수량 > 원래 수량일 때만 - 버튼 활성화
                  <>
                    {(() => {
                      const orderLineIdRaw = (item as any).orderLineId;
                      const orderLineId = (orderLineIdRaw != null && String(orderLineIdRaw).trim() !== '') ? String(orderLineIdRaw) : '';
                      const currentQty = item.quantity || 1;
                      const hasOriginal =
                        !!orderLineId &&
                        Object.prototype.hasOwnProperty.call(originalSavedQuantitiesRef.current || {}, orderLineId);
                      const originalQty = hasOriginal ? (originalSavedQuantitiesRef.current[orderLineId] || currentQty) : currentQty;
                      const canDecrement = currentQty > originalQty;
                      
                      return (
                        <button
                          disabled={!canDecrement}
                          onClick={() => { 
                            if (isItemLockedForSplit(item.guestNumber, !!(item as any)._preSplit, effectiveSplitCount, guestStatusMap, Array.isArray(persistedPaidGuests) ? persistedPaidGuests : []) || !canDecrement) return; 
                            preserveOrderListScroll(() => updateQuantityByLineId(orderLineId, -1)); 
                          }}
                          className={`text-white rounded-md transition-colors flex items-center justify-center text-lg font-bold ${canDecrement ? 'hover:bg-red-600' : 'opacity-30 cursor-not-allowed'}`}
                          style={{ 
                            width: '40px', 
                            height: '40px', 
                            minWidth: '40px', 
                            minHeight: '40px',
                            backgroundColor: 'rgba(239, 68, 68, 0.75)', // red-500 with 75% opacity
                            fontSize: 'calc(var(--order-item-font) - 2px)'
                          }}
                        >
                          -
                        </button>
                      );
                    })()}
                    <SplitQtyLabel item={item as any} effectiveSplitCount={effectiveSplitCount} paidGuestsCount={Array.isArray(persistedPaidGuests) ? persistedPaidGuests.length : 0} />
                    <button
                      onClick={() => {
                        if (isItemLockedForSplit(item.guestNumber, !!(item as any)._preSplit, effectiveSplitCount, guestStatusMap, Array.isArray(persistedPaidGuests) ? persistedPaidGuests : [])) return;
                        const orderLineIdRaw = (item as any).orderLineId;
                        const orderLineId = (orderLineIdRaw != null && String(orderLineIdRaw).trim() !== '') ? String(orderLineIdRaw) : '';
                        if (!orderLineId) return;
                        preserveOrderListScroll(() => updateQuantityByLineId(orderLineId, 1)); 
                      }}
                      className="text-white rounded-md hover:bg-green-600 transition-colors flex items-center justify-center text-lg font-bold"
                      style={{ 
                        width: '40px', 
                        height: '40px', 
                        minWidth: '40px', 
                        minHeight: '40px',
                        backgroundColor: 'rgba(34, 197, 94, 0.75)', // green-500 with 75% opacity
                        fontSize: 'calc(var(--order-item-font) - 2px)'
                      }}
                    >
                      +
                    </button>
                  </>
                ) : (
                  // 새로 추가된 메뉴: - 버튼 활성화
                  <>
                    <button
                      onClick={(e) => { 
                        e.stopPropagation();
                        if (isItemLockedForSplit(item.guestNumber, !!(item as any)._preSplit, effectiveSplitCount, guestStatusMap, Array.isArray(persistedPaidGuests) ? persistedPaidGuests : [])) return; 
                        preserveOrderListScroll(() => {
                          setOrderItems(prev => {
                            const updated = prev.map((it, idx) => {
                              if (idx === index && it.id === item.id && (it.guestNumber || 1) === (item.guestNumber || 1)) {
                                const newQty = (it.quantity || 0) - 1;
                                if (newQty <= 0) return null as any;
                                return { ...it, quantity: newQty };
                              }
                              return it;
                            }).filter(Boolean);
                            return updated as any;
                          });
                        });
                      }}
                      className="text-white rounded-md hover:bg-red-600 transition-colors flex items-center justify-center text-lg font-bold"
                      style={{ 
                        width: '40px', 
                        height: '40px', 
                        minWidth: '40px', 
                        minHeight: '40px',
                        backgroundColor: 'rgba(239, 68, 68, 0.75)', // red-500 with 75% opacity
                        fontSize: 'calc(var(--order-item-font) - 2px)'
                      }}
                    >
                      -
                    </button>
                    <SplitQtyLabel item={item as any} effectiveSplitCount={effectiveSplitCount} paidGuestsCount={Array.isArray(persistedPaidGuests) ? persistedPaidGuests.length : 0} />
                    <button
                      onClick={(e) => { 
                        e.stopPropagation();
                        if (isItemLockedForSplit(item.guestNumber, !!(item as any)._preSplit, effectiveSplitCount, guestStatusMap, Array.isArray(persistedPaidGuests) ? persistedPaidGuests : [])) return; 
                        preserveOrderListScroll(() => {
                          setOrderItems(prev => {
                            return prev.map((it, idx) => {
                              if (idx === index && it.id === item.id && (it.guestNumber || 1) === (item.guestNumber || 1)) {
                                return { ...it, quantity: (it.quantity || 0) + 1 };
                              }
                              return it;
                            });
                          });
                        });
                      }}
                      className="text-white rounded-md hover:bg-green-600 transition-colors flex items-center justify-center text-lg font-bold"
                      style={{ 
                        width: '40px', 
                        height: '40px', 
                        minWidth: '40px', 
                        minHeight: '40px',
                        backgroundColor: 'rgba(34, 197, 94, 0.75)', // green-500 with 75% opacity
                        fontSize: 'calc(var(--order-item-font) - 2px)'
                      }}
                    >
                      +
                    </button>
                  </>
                )}
                                      </>
                                    )}
                                  </div>
                                  
                                  {/* 총 가격 (고정 위치) - 아이템 원가만 표시 (모디파이어 제외) */}
                                  <div className="col-span-3 text-right">
                                    {item.type === 'discount' ? (
                                      <div className="font-medium text-red-600 text-base" style={{ fontSize: 'calc(var(--order-item-font) - 2px)' }}>
                                        {item.totalPrice.toFixed(2)}
                                      </div>
                                    ) : ((item as any).type === 'void') ? (
                                      <div className="font-medium text-gray-500 text-base line-through" style={{ fontSize: 'calc(var(--order-item-font) - 2px)' }}>0.00</div>
                                    ) : (() => {
                                      const line = getPricingLineForItem(item as any);
                                      const itemBasePrice = line ? Number(line.lineGross || 0) : (Number(item.price || 0) * Number(item.quantity || 1));
                                      const disc = line ? Number(line.itemDiscount || 0) : computeItemDiscountAmount(item as any);
                                      const sp = getSplitPriceDisplay(itemBasePrice, effectiveSplitCount, Array.isArray(persistedPaidGuests) ? persistedPaidGuests.length : 0, !!(item as any)._preSplit);
                                      if (disc > 0) {
                                        const after = Math.max(0, Number((itemBasePrice - disc).toFixed(2)));
                                        const spDisc = getSplitPriceDisplay(after, effectiveSplitCount, Array.isArray(persistedPaidGuests) ? persistedPaidGuests.length : 0, !!(item as any)._preSplit);
                                        const d = (item as any).discount || {};
                                        return (
                                           <div>
                                             {d.mode === 'percent' ? (
                                               <>
                                                <div className="text-gray-500 line-through text-xs" style={{ fontSize: 'calc(var(--order-item-font) - 4px)' }}>{itemBasePrice.toFixed(2)}</div>
                                                 <div className="text-red-600 text-xs">
                                                   {`${Math.max(0, Math.min(100, Number(d.value || 0)))}% -${disc.toFixed(2)}`}
                                                 </div>
                                                {spDisc.isSplit && <div className="text-gray-400 line-through text-xs" style={{ fontSize: 'calc(var(--order-item-font) - 4px)' }}>{after.toFixed(2)}</div>}
                                                <div className={`text-sm font-medium ${spDisc.isSplit ? 'text-orange-600' : 'text-gray-900'}`} style={{ fontSize: 'calc(var(--order-item-font) - 2px)' }}>{spDisc.displayPrice.toFixed(2)}</div>
                                               </>
                                            ) : (
                                              <>
                                                <div className="text-gray-500 line-through text-xs" style={{ fontSize: 'calc(var(--order-item-font) - 4px)' }}>{itemBasePrice.toFixed(2)}</div>
                                                <div className="text-red-600 text-xs">
                                                  -${disc.toFixed(2)}
                                                </div>
                                                {spDisc.isSplit && <div className="text-gray-400 line-through text-xs" style={{ fontSize: 'calc(var(--order-item-font) - 4px)' }}>{after.toFixed(2)}</div>}
                                                <div className={`text-sm font-bold ${spDisc.isSplit ? 'text-orange-600' : 'text-gray-900'}`} style={{ fontSize: 'calc(var(--order-item-font) - 2px)' }}>{spDisc.displayPrice.toFixed(2)}</div>
                                              </>
                                            )}
                                           </div>
                                         );
                                      }
                                      return (
                                        <div>
                                          {sp.isSplit && <div className="text-gray-400 line-through text-xs" style={{ fontSize: 'calc(var(--order-item-font) - 4px)' }}>{sp.originalPrice.toFixed(2)}</div>}
                                          <div className={`font-medium text-sm ${sp.isSplit ? 'text-orange-600' : 'text-gray-800'}`} style={{ fontSize: 'calc(var(--order-item-font) - 2px)' }}>{sp.displayPrice.toFixed(2)}</div>
                                        </div>
                                      );
                                    })()}
                                  </div>
                                </div>

                                {/* 모디파이어 및 메모 정보 (별도 영역) */}
                                {(item.modifiers && item.modifiers.length > 0) || ((item as any).memo && (item as any).memo.text) ? (
                                  <div className={`px-2 pb-0 ${index % 2 === 0 ? 'bg-blue-100' : 'bg-blue-50'}`}>
                                    {/* 모디파이어 정보 */}
                                    {item.modifiers && item.modifiers.length > 0 && (
                                      <div className="space-y-0 mb-0">
                                        {/* 모든 모디파이어 동일하게 표시 (확장 + 일반) */}
                                        {item.modifiers.flatMap((mod: any, modIndex: number) => (
                                          (mod.selectedEntries && mod.selectedEntries.length > 0
                                            ? (() => {
                                                const grouped = new Map<string, { name: string; priceDelta: number; count: number }>();
                                                (mod.selectedEntries || []).forEach((entry: any) => {
                                                  const name = String(entry?.name || '');
                                                  const priceDelta = Number(entry?.price_delta || 0);
                                                  const key = `${name}@@${priceDelta}`;
                                                  const cur = grouped.get(key) || { name, priceDelta, count: 0 };
                                                  cur.count += 1;
                                                  grouped.set(key, cur);
                                                });
                                                return Array.from(grouped.values()).map((g, entryIdx: number) => {
                                                  const label = `${g.count}x ${g.name}`;
                                                  const totalDelta = Number((g.priceDelta * g.count).toFixed(2));
                                                  return (
                                                    <div key={`${item.id}-mod-${modIndex}-${entryIdx}`} className="flex items-center justify-between text-gray-600" data-pos-lock="order-item-modline" style={{ fontSize: 'var(--order-mod-font)', lineHeight: '1.2' }}>
                                                      <div className="flex items-center">
                                                        <span className="text-blue-600 font-medium mr-2">{'>>'}</span>
                                                        <span className="ml-0.5 font-medium italic">{label}</span>
                                                      </div>
                                                      <span className={`${totalDelta > 0 ? 'text-red-600' : totalDelta < 0 ? 'text-green-600' : 'text-gray-500'} font-medium italic`}>
                                                        {totalDelta > 0 ? '+' : ''}${Math.abs(totalDelta).toFixed(2)}
                                                      </span>
                                                    </div>
                                                  );
                                                });
                                              })()
                                            : (Array.isArray((mod as any).modifierNames)
                                                ? (() => {
                                                    const counts = new Map<string, number>();
                                                    (mod as any).modifierNames.forEach((n: string) => {
                                                      const key = String(n || '');
                                                      counts.set(key, (counts.get(key) || 0) + 1);
                                                    });
                                                    return Array.from(counts.entries()).map(([name, count], entryIdx: number) => (
                                                      <div key={`${item.id}-modname-${modIndex}-${entryIdx}`} className="flex items-center justify-between text-sm text-gray-600 leading-none">
                                                        <div className="flex items-center">
                                                          <span className="text-blue-600 font-medium mr-2">{'>>'}</span>
                                                          <span className="ml-0.5 font-medium italic">{`${count}x ${name}`}</span>
                                                        </div>
                                                        <span className="text-gray-500 font-medium italic">0.00</span>
                                                      </div>
                                                    ));
                                                  })()
                                                : []
                                              )
                                          )
                                        ))}
                                      </div>
                                    )}
                                    
                                    {/* 메모 정보 */}
                                    {(item as any).memo && (item as any).memo.text && (
                                      <div className="flex items-center justify-between text-gray-600" data-pos-lock="order-item-memoline" style={{ fontSize: 'var(--order-mod-font)', lineHeight: '1.2' }}>
                                        <div className="flex items-center">
                                           <span className="text-blue-600 font-medium mr-2">{'-->'}</span>
                                          <span className="ml-0.5 font-medium italic">{(item as any).memo.text}</span>
                                        </div>
                                        {(item as any).memo.price && (item as any).memo.price > 0 && (
                                          <span className="text-green-600 font-medium italic">
                                            +${(item as any).memo.price.toFixed(2)}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ) : null}

                            
                            {/* Floating Action Bar for selected item */}
                            {((selectedOrderLineId && (item as any).orderLineId === selectedOrderLineId) || 
                              (selectedOrderItemId === item.id && (selectedOrderGuestNumber||1) === (item.guestNumber||1) && (selectedRowIndex === index))) && (
                              <FloatingActionBar 
                                itemId={item.id} 
                                guestNumber={item.guestNumber || 1} 
                                rowIndex={index} 
                                orderLineId={(item as any).orderLineId}
                                isNearBottom={index >= orderItems.length - 3 && index > 0}
                              />
                            )}
                          </div>
                        </DraggableDroppableOrderRow>
                          ))}
                          {/* TOGO separator + TOGO items */}
                          {(() => {
                            const togoRows = guestRows.filter(row => row.it.type !== 'discount' && !!(row.it as any).togoLabel);
                            if (togoRows.length === 0) return null;
                            return (
                              <>
                                {togoRows.map(({ it: item, idx: index }) => (
                            <DraggableDroppableOrderRow disabled={guestStatusMap[item.guestNumber || 1] === 'PAID'} guest={item.guestNumber || 1} idx={index} key={`togo-${item.id}-${index}-${(item as any).orderLineId || ''}`}>
                              <div 
                                  data-order-item="true"
                                  className={`transition-all duration-200 ${
                                   `cursor-pointer ${
                                       ((selectedOrderLineId && (item as any).orderLineId === selectedOrderLineId) || (selectedOrderItemId === item.id && (selectedOrderGuestNumber||1) === (item.guestNumber||1) && (selectedRowIndex === index)))
                                         ? 'bg-blue-200 border-2 border-blue-600 shadow-lg' 
                                         : 'hover:bg-blue-50 border-2 border-transparent'
                                     } ${guestStatusMap[item.guestNumber || 1] === 'PAID' ? 'opacity-60 pointer-events-none' : ''}`
                                 }`}
                                  onClick={guestStatusMap[item.guestNumber || 1] === 'PAID' ? undefined : () => preserveOrderListScroll(() => handleOrderItemClick(item.id, item.guestNumber, index, (item as any).orderLineId))}
                                  style={{ pointerEvents: guestStatusMap[item.guestNumber || 1] === 'PAID' ? 'none' : 'auto', marginBottom: '0px' }}
                                >
                                <div className={`grid grid-cols-12 gap-1 items-center py-0 px-1 ${index % 2 === 0 ? 'bg-orange-50' : 'bg-orange-100'}`}>
                                  <div className="col-span-6">
                                    <div className="font-medium text-gray-800 flex flex-col gap-0" data-pos-lock="order-item-name" style={{ fontSize: 'calc(var(--order-item-font) - 2px)', lineHeight: '1.2' }}>
                                      <span className="truncate" data-pos-lock="order-item-name-text">{layoutSettings.useShortName && item.short_name ? item.short_name : item.name}</span>
                                      <span className="text-gray-600 font-medium italic leading-none" style={{ fontSize: 'var(--order-mod-font)' }}>{'<<TOGO>>'}</span>
                                    </div>
                                  </div>
                                  <div className="col-span-3 flex items-center justify-center space-x-2" style={{ transform: 'translateX(14px)' }}>
                                    {(() => {
                                      const togoOrderLineId = (item as any).orderLineId || '';
                                      const togoHasOriginal = !!togoOrderLineId && Object.prototype.hasOwnProperty.call(originalSavedQuantitiesRef.current || {}, togoOrderLineId);
                                      const togoIsExistingSaved = !!savedOrderIdRef.current && !!togoOrderLineId && togoHasOriginal;
                                      const togoCurrentQty = item.quantity || 1;
                                      const togoOriginalQty = togoHasOriginal ? (originalSavedQuantitiesRef.current[togoOrderLineId] || togoCurrentQty) : togoCurrentQty;
                                      const togoCanDecrement = togoIsExistingSaved ? togoCurrentQty > togoOriginalQty : true;
                                      return (
                                    <button
                                      disabled={!togoCanDecrement}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (isItemLockedForSplit(item.guestNumber, !!(item as any)._preSplit, effectiveSplitCount, guestStatusMap, Array.isArray(persistedPaidGuests) ? persistedPaidGuests : []) || !togoCanDecrement) return;
                                        preserveOrderListScroll(() => {
                                          setOrderItems(prev => {
                                            const updated = prev.map((it, i) => {
                                              if (i === index && it.id === item.id && (it.guestNumber || 1) === (item.guestNumber || 1)) {
                                                const newQty = (it.quantity || 0) - 1;
                                                if (newQty <= 0) return null as any;
                                                return { ...it, quantity: newQty };
                                              }
                                              return it;
                                            }).filter(Boolean);
                                            return updated as any;
                                          });
                                        });
                                      }}
                                      className={`text-white rounded-md transition-colors flex items-center justify-center text-lg font-bold ${togoCanDecrement ? 'hover:bg-red-600' : 'opacity-30 cursor-not-allowed'}`}
                                      style={{ width: '40px', height: '40px', minWidth: '40px', minHeight: '40px', backgroundColor: 'rgba(239, 68, 68, 0.75)', fontSize: 'calc(var(--order-item-font) - 2px)' }}
                                    >-</button>
                                      );
                                    })()}
                                    <SplitQtyLabel item={item as any} effectiveSplitCount={effectiveSplitCount} paidGuestsCount={Array.isArray(persistedPaidGuests) ? persistedPaidGuests.length : 0} />
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (isItemLockedForSplit(item.guestNumber, !!(item as any)._preSplit, effectiveSplitCount, guestStatusMap, Array.isArray(persistedPaidGuests) ? persistedPaidGuests : [])) return;
                                        preserveOrderListScroll(() => {
                                          setOrderItems(prev => prev.map((it, i) => {
                                            if (i === index && it.id === item.id && (it.guestNumber || 1) === (item.guestNumber || 1)) {
                                              return { ...it, quantity: (it.quantity || 0) + 1 };
                                            }
                                            return it;
                                          }));
                                        });
                                      }}
                                      className="text-white rounded-md hover:bg-green-600 transition-colors flex items-center justify-center text-lg font-bold"
                                      style={{ width: '40px', height: '40px', minWidth: '40px', minHeight: '40px', backgroundColor: 'rgba(34, 197, 94, 0.75)', fontSize: 'calc(var(--order-item-font) - 2px)' }}
                                    >+</button>
                                  </div>
                                  <div className="col-span-3 text-right">
                                    <div data-pos-lock="order-item-total">
                                      <SplitPriceLabel
                                        basePrice={(((item.totalPrice || item.price || 0) + ((item.memo?.price || 0))) * (item.quantity || 1))}
                                        effectiveSplitCount={effectiveSplitCount}
                                        paidGuestsCount={Array.isArray(persistedPaidGuests) ? persistedPaidGuests.length : 0}
                                        isPreSplit={!!(item as any)._preSplit}
                                        align="right"
                                      />
                                    </div>
                                  </div>
                                </div>
                                {/* 모디파이어 및 메모 정보 (TOGO 아이템 - <<TOGO>> 아래 표시) */}
                                {(item.modifiers && item.modifiers.length > 0) || ((item as any).memo && (item as any).memo.text) ? (
                                  <div className={`px-2 pb-0 ${index % 2 === 0 ? 'bg-orange-50' : 'bg-orange-100'}`}>
                                    {/* 모디파이어 정보 */}
                                    {item.modifiers && item.modifiers.length > 0 && (
                                      <div className="space-y-0 mb-0">
                                        {item.modifiers.flatMap((mod: any, modIndex: number) => (
                                          (mod.selectedEntries && mod.selectedEntries.length > 0
                                            ? (() => {
                                                const grouped = new Map<string, { name: string; priceDelta: number; count: number }>();
                                                (mod.selectedEntries || []).forEach((entry: any) => {
                                                  const name = String(entry?.name || '');
                                                  const priceDelta = Number(entry?.price_delta || 0);
                                                  const key = `${name}@@${priceDelta}`;
                                                  const cur = grouped.get(key) || { name, priceDelta, count: 0 };
                                                  cur.count += 1;
                                                  grouped.set(key, cur);
                                                });
                                                return Array.from(grouped.values()).map((g, entryIdx: number) => {
                                                  const label = `${g.count}x ${g.name}`;
                                                  const totalDelta = Number((g.priceDelta * g.count).toFixed(2));
                                                  return (
                                                    <div key={`${item.id}-togo-mod-${modIndex}-${entryIdx}`} className="flex items-center justify-between text-gray-600" data-pos-lock="order-item-modline" style={{ fontSize: 'var(--order-mod-font)', lineHeight: '1.2' }}>
                                                      <div className="flex items-center">
                                                        <span className="ml-0.5 font-medium italic">{label}</span>
                                                      </div>
                                                      <span className={`${totalDelta > 0 ? 'text-red-600' : totalDelta < 0 ? 'text-green-600' : 'text-gray-500'} font-medium italic`}>
                                                        {totalDelta > 0 ? '+' : ''}{Math.abs(totalDelta).toFixed(2)}
                                                      </span>
                                                    </div>
                                                  );
                                                });
                                              })()
                                            : (Array.isArray((mod as any).modifierNames)
                                                ? (() => {
                                                    const counts = new Map<string, number>();
                                                    (mod as any).modifierNames.forEach((n: string) => {
                                                      const key = String(n || '');
                                                      counts.set(key, (counts.get(key) || 0) + 1);
                                                    });
                                                    return Array.from(counts.entries()).map(([name, count], entryIdx: number) => (
                                                      <div key={`${item.id}-togo-modname-${modIndex}-${entryIdx}`} className="flex items-center justify-between text-sm text-gray-600 leading-none" style={{ fontSize: 'var(--order-mod-font)', lineHeight: '1.2' }}>
                                                        <div className="flex items-center">
                                                          <span className="ml-0.5 font-medium italic">{`${count}x ${name}`}</span>
                                                        </div>
                                                        <span className="text-gray-500 font-medium italic">0.00</span>
                                                      </div>
                                                    ));
                                                  })()
                                                : []
                                              )
                                          )
                                        ))}
                                      </div>
                                    )}

                                    {/* 메모 정보 */}
                                    {(item as any).memo && (item as any).memo.text && (
                                      <div className="flex items-center justify-between text-gray-600" data-pos-lock="order-item-memoline" style={{ fontSize: 'var(--order-mod-font)', lineHeight: '1.2' }}>
                                        <div className="flex items-center">
                                          <span className="ml-0.5 font-medium italic">{(item as any).memo.text}</span>
                                        </div>
                                        {(item as any).memo.price && (item as any).memo.price > 0 && (
                                          <span className="text-green-600 font-medium italic">
                                            +{(item as any).memo.price.toFixed(2)}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ) : null}
                              </div>
                            </DraggableDroppableOrderRow>
                                ))}
                              </>
                            );
                          })()}
                          {/* Display Discount Items (Type 'discount') at the bottom of the list */}
                          {guestRows.filter(row => row.it.type === 'discount').map(({ it: item, idx: index }) => {
                             const d = (item as any).discount || {};
                             const isPercent = d.mode === 'percent';
                             // Use Number() to preserve decimals (e.g. 12.5%) instead of Math.round()
                             const percentText = isPercent ? ` ${Number(d.value)||0}%` : '';
                             
                             // Discount Type Name priority: discount.type > discount.name > item.name
                             let displayName = d.type || d.name || item.name;
                             // Remove redundant (50%) in name
                             if (displayName) {
                                 displayName = displayName.replace(/\s*\(\d+%\)/g, '').trim();
                             }
                             
                             const amount = Math.abs(Number((item.totalPrice != null ? item.totalPrice : item.price) || 0));
                             
                             return (
                               <div key={`disc-${item.id}-${index}`} className="px-2 py-2 bg-yellow-50 border-l-4 border-yellow-400 mb-1 flex items-center justify-between" data-pos-lock="order-discount-row" style={{ fontSize: 'var(--order-mod-font)' }}>
                                   <div className="font-medium text-sm text-red-600">
                                       {displayName}{percentText}
                                   </div>
                                   <div className="flex items-center gap-3">
                                       <span className="font-medium text-red-600 text-sm">-${amount.toFixed(2)}</span>
                                       <button
                                           onClick={(e) => {
                                               e.stopPropagation();
                                               // Remove this discount item
                                               setOrderItems(prev => prev.filter(orderItem => orderItem.id !== item.id));
                                           }}
                                           className="text-white rounded hover:bg-red-600 transition-colors flex items-center justify-center text-xs font-bold w-6 h-6"
                                           style={{ backgroundColor: 'rgba(239, 68, 68, 0.9)' }}
                                       >
                                           ✕
                                       </button>
                                   </div>
                               </div>
                             );
                          })}
                        </React.Fragment>
                      );
                    })}
                  </DndContext>
                  </div>
                </div>
                
                {/* Kitchen Note - 스플릿 주문과 관계없이 항상 맨 아래에 표시 */}
                {savedKitchenMemo && (
                  <div className="px-2 py-1 bg-yellow-100 border-l-4 border-yellow-500">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="text-sm font-medium text-yellow-800">
                          Kitchen Note
                        </div>
                        <div className="text-xs text-yellow-700 mt-1">
                          {savedKitchenMemo}
                        </div>
                      </div>
                      <button
                        onClick={() => setSavedKitchenMemo('')}
                        className="text-yellow-600 hover:text-yellow-800 text-2xl font-bold w-10 h-10 flex items-center justify-center rounded-full hover:bg-yellow-200 transition-colors"
                        title="Remove Kitchen Note"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                )}

                </div>

                {/* Summary Section */}
                <div className="px-2 py-0.5 bg-blue-200 border-t border-blue-300 flex-shrink-0" data-pos-lock="order-summary" style={{ fontSize: 'var(--order-summary-font)' }}>
                    <div className="space-y-0">
                    {(() => {
                      // Use unpaid-only totals when split is active
                      const splitActive = (guestCount > 1) || ((orderItems||[]).some(it=>it.type==='separator'));
                      const fmt = (n:number)=> new Intl.NumberFormat(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
                      let sub = subtotal; let tax = taxesTotal; let tot = sub + tax;
                      if (splitActive) {
                        const all = computeGuestTotals('ALL');
                        const allSubVal = Number((all.subtotal || 0).toFixed(2));
                        const allTaxVal = Number(((all.taxLines || []).reduce((s:number,t:any)=>s+(t.amount||0),0)).toFixed(2));
                        let paidSub = 0, paidTax = 0;
                        (guestIds||[]).forEach((g:number)=>{ if (guestStatusMap[g]==='PAID') { const res = computeGuestTotals(g as any); const tx = (res.taxLines||[]).reduce((s:number,t:any)=>s+(t.amount||0),0); paidSub += Number(res.subtotal||0); paidTax += Number(tx||0); }});
                        sub = Math.max(0, Number((allSubVal - paidSub).toFixed(2)));
                        tax = Math.max(0, Number((allTaxVal - paidTax).toFixed(2)));
                        tot = Math.max(0, Number((sub + tax).toFixed(2)));
                      }
                      // ✅ Summary도 단일 계산 모듈 결과만 사용 (중복 계산 금지)
                      const grossTotal = Number((pricingAll.totals?.grossSubtotal || 0).toFixed(2));
                      const itemDiscountsTotal = Number((pricingAll.totals?.itemDiscountTotal || 0).toFixed(2));
                      const orderDiscountsTotal = Number((pricingAll.totals?.orderDiscountTotal || 0).toFixed(2));
                      const totalDiscountDisplay = Number((itemDiscountsTotal + orderDiscountsTotal).toFixed(2));
                      const subBeforeDiscount = grossTotal;
                      const subAfterDiscount = Number((pricingAll.totals?.subtotalAfterAllDiscounts || Math.max(0, grossTotal - totalDiscountDisplay)).toFixed(2));
                      const taxAfterDiscount = Number((tax || 0).toFixed(2)); // tax는 상단에서 unpaid/ALL 모드에 맞게 이미 결정됨
                      const totalAfterDiscount = Number((subAfterDiscount + taxAfterDiscount).toFixed(2));

                      const individualTaxLines: Array<{ name: string; amount: number }> = (taxLines || []).map((t: any) => ({
                        name: t.name || 'Tax',
                        amount: Number((t.amount || 0).toFixed(2)),
                      }));
                      
                      return (
                        <>
                          <div className="flex justify-between font-medium">
                            <span>Sub Total:</span>
                            <span>${fmt(subBeforeDiscount)}</span>
                          </div>
                          {totalDiscountDisplay > 0 && (
                            <>
                              <div className="flex justify-between text-red-600 font-semibold text-sm">
                                <span>Discount:</span>
                                <span>- ${fmt(totalDiscountDisplay)}</span>
                              </div>
                              <div className="flex justify-between text-blue-600 font-medium text-sm">
                                <span>Sub After D/C:</span>
                                <span>${fmt(subAfterDiscount)}</span>
                              </div>
                            </>
                          )}
                          {individualTaxLines.length > 0 ? (
                            individualTaxLines.map((taxLine, idx) => (
                              <div key={idx} className="flex justify-between">
                                <span>{taxLine.name}:</span>
                                <span>${fmt(taxLine.amount)}</span>
                              </div>
                            ))
                          ) : (
                            <div className="flex justify-between">
                              <span>Tax:</span>
                              <span>${fmt(taxAfterDiscount)}</span>
                            </div>
                          )}
                          <div className="flex justify-between font-bold" data-pos-lock="order-summary-total" style={{ fontSize: 'var(--order-total-font)' }}>
                            <span>Total:</span>
                            <span>${fmt(totalAfterDiscount)}</span>
                          </div>
                          {(() => {
                            const paidSoFar = sessionPayments.reduce((s, p) => s + p.amount, 0);
                            if (paidSoFar > 0.01) {
                              const balance = Math.max(0, Number((totalAfterDiscount - paidSoFar).toFixed(2)));
                              return (
                                <>
                                  <div className="flex justify-between text-green-700 font-bold" style={{ borderTop: '2px solid #16a34a', paddingTop: '4px', marginTop: '4px', fontSize: 'calc(var(--order-summary-font) + 1px)' }}>
                                    <span>Paid:</span>
                                    <span>- ${fmt(paidSoFar)}</span>
                                  </div>
                                  <div className="flex justify-between font-extrabold text-orange-600" style={{ fontSize: 'var(--order-total-font)', borderTop: '2px solid #ea580c', paddingTop: '2px', marginTop: '2px' }}>
                                    <span>Balance:</span>
                                    <span>${fmt(balance)}</span>
                                  </div>
                                </>
                              );
                            }
                            return null;
                          })()}
                        </>
                      );
                    })()}
                    {/* Promotion/Togo adjustments display */}
                    {(() => {
                      const items = (orderItems || []).filter(it => it.type !== 'separator');
                      const sub = items.reduce((s,it:any)=> s + ((it.totalPrice + ((it.memo?.price)||0)) * it.quantity), 0);
                      const adj: Array<{ label: string; amount: number }> = [];
                      if ((orderType||'').toLowerCase()==='togo') {
                        if (togoSettings.discountEnabled && togoSettings.discountValue>0) {
                          const dv = Number(togoSettings.discountValue)||0;
                          const amountApplied = togoSettings.discountMode==='percent' ? (sub*dv/100) : dv;
                          adj.push({ label: `Discount (${togoSettings.discountMode==='percent'?dv+'%':'$'+dv})`, amount: -Number(amountApplied.toFixed(2)) });
                        }
                        if (togoSettings.bagFeeEnabled && togoSettings.bagFeeValue>0) {
                          const bv = Number(togoSettings.bagFeeValue)||0;
                          adj.push({ label: `Bag Fee ($${bv})`, amount: Number(bv.toFixed(2)) });
                        }
                      } else {
                        // Calculate alreadyUsedToday first (needed for both local promo and BOGO)
                        const tableIdForMap = (location.state && (location.state as any).tableId) || null;
                        const customerName = (location.state && (location.state as any).customerName) || null;
                        const todayKey = getLocalDateString();
                        const usageKeyTable = tableIdForMap ? `promo_used_${tableIdForMap}_${todayKey}` : null;
                        const usageKeyCustomer = customerName ? `promo_used_customer_${customerName}_${todayKey}` : null;
                        const alreadyUsedToday = (usageKeyTable && localStorage.getItem(usageKeyTable) === '1') || (usageKeyCustomer && localStorage.getItem(usageKeyCustomer) === '1');
                        
                        // Check POS promotions for Dine-in first
                        if (dineInPromotions.length > 0) {
                          const cartItemIds = items.map((it: any) => String(it.id || it.item_id || it.menuItemId));
                          const cartItemNames = items.map((it: any) => String(it.name || ''));
                          const cartItems = items.map((it: any) => ({
                            menuItemId: String(it.id || it.item_id || it.menuItemId),
                            name: String(it.name || ''),
                            subtotal: Number(it.totalPrice || it.price || 0) * Number(it.quantity || 1),
                            quantity: Number(it.quantity || 1)
                          }));
                          
                          let bestPromo: typeof dineInPromotions[0] | null = null;
                          let bestDiscount = 0;
                          
                          for (const promo of dineInPromotions) {
                            const isApplicable = checkPromotionApplicable(promo, 'table', sub, cartItemIds, cartItemNames);
                            if (isApplicable) {
                              const discount = calculatePromotionDiscount(promo, sub, cartItems, 0);
                              if (discount > bestDiscount) {
                                bestDiscount = discount;
                                bestPromo = promo;
                              }
                            }
                          }
                          
                          if (bestPromo && bestDiscount > 0) {
                            adj.push({ label: `🎁 ${bestPromo.name || 'Promotion'}`, amount: -Number(bestDiscount.toFixed(2)) });
                          }
                        }
                        
                        // Fallback to local promotions if no POS promotion was applied
                        if (adj.length === 0) {
                          const promoAdj = computePromotionAdjustment(items as any, { enabled: promotionEnabled && !alreadyUsedToday, type: promotionType as any, value: (typeof promotionValue === 'number' ? promotionValue : 0), eligibleItemIds: promotionEligibleItemIds, codeInput: '', rules: promotionRules });
                          const line = buildPromotionReceiptLine(promoAdj);
                          if (line) adj.push(line);
                        }

                        // BOGO (same-item 1+1) preview line
                        try {
                          const freePromos = (freeItemPromotions||[]).filter(p => p && (p.enabled!==false) && (p.kind==='BOGO'));
                          if (!alreadyUsedToday && freePromos.length>0) {
                            const eligibleIdsAll = new Set<string>((freePromos.flatMap(p => p.eligibleItemIds||[])||[]).map(String));
                            const eligibleSubtotal = (items||[]).reduce((s,it:any)=>{
                              const ok = eligibleIdsAll.size>0 ? eligibleIdsAll.has(String(it.id)) : true;
                              const memoPrice = ((it.memo && typeof it.memo.price==='number')?it.memo.price:0);
                              return ok ? s + ((it.totalPrice + memoPrice) * it.quantity) : s;
                            }, 0);
                            const minAny = Math.min(...freePromos.map(p=> Number(p.minSubtotal||0)));
                            if (eligibleSubtotal >= (isFinite(minAny)?minAny:0)) {
                              const target = (items||[]).find((it:any)=>{
                                if (it.type==='separator') return false;
                                const ok = eligibleIdsAll.size>0 ? eligibleIdsAll.has(String(it.id)) : true;
                                return ok && (Number(it.quantity)||0) >= 2;
                              });
                              if (target) {
                                const memoPrice = ((target.memo && typeof target.memo.price==='number')?target.memo.price:0);
                                const unit = Number((target.totalPrice + memoPrice) || 0);
                                if (unit>0) adj.push({ label: `Free Item (BOGO): ${target.name} x1`, amount: -Number(unit.toFixed(2)) });
                              }
                            }
                          }
                        } catch {}
                      }
                      return adj.map((a,idx) => (
                        <div key={`adj-${idx}`} className="flex justify-between">
                          <span>{a.label}:</span>
                          <span>{a.amount>=0?'+':''}${a.amount.toFixed(2)}</span>
                        </div>
                      ));
                    })()}
                    {/* 기존 전체 세금 라인/총합은 중복이므로 제거 (미결제 기준 합계만 표시) */}
                  </div>
                </div>
 
                {/* Action Buttons */}
                <div className="py-1 px-2 bg-[#e0e5ec] border-t border-gray-200 flex-shrink-0 rounded-b-xl">
                  <div
                    className="grid"
                    data-pos-lock="order-primary-actions"
                    style={{
                      gridTemplateColumns: isHandheldDevice ? '3fr 4fr' : '3fr 4fr 4fr',
                      gap: 'clamp(6px, 1vh, 12px)'
                    }}
                  >
                    <button className="px-1 py-2 flex items-center justify-center rounded-xl font-bold bg-[#e0e5ec] text-gray-700 transition-all duration-150 shadow-[6px_6px_12px_#b8bec7,_-6px_-6px_12px_#ffffff] hover:shadow-[8px_8px_16px_#b8bec7,_-8px_-8px_16px_#ffffff] active:shadow-[inset_4px_4px_8px_#b8bec7,_inset_-4px_-4px_8px_#ffffff] active:text-gray-500" style={{ height: 'var(--bottom-bar-btn-height, clamp(44px, 6vh, 68px))', fontSize: 'var(--bottom-bar-btn-font, clamp(13px, 1.9vh, 17px))', lineHeight: '1.2', textAlign: 'center', wordBreak: 'keep-all' }} onClick={handlePrintBill}>
                      Print<br/>Bill
                    </button>
                    {!isHandheldDevice && (
                      <button className="px-1 py-2 flex items-center justify-center rounded-xl font-bold bg-[#e0e5ec] text-gray-700 transition-all duration-150 shadow-[6px_6px_12px_#b8bec7,_-6px_-6px_12px_#ffffff] hover:shadow-[8px_8px_16px_#b8bec7,_-8px_-8px_16px_#ffffff] active:shadow-[inset_4px_4px_8px_#b8bec7,_inset_-4px_-4px_8px_#ffffff] active:text-gray-500" style={{ height: 'var(--bottom-bar-btn-height, clamp(44px, 6vh, 68px))', fontSize: 'var(--bottom-bar-btn-font, clamp(13px, 1.9vh, 17px))', lineHeight: '1.2', textAlign: 'center' }} onClick={() => {
                        try { setPrefillUseTotalOnceNonce(0); setPrefillDueNonce(n=>n+0); } catch {}
                        priorPaymentIdsRef.current = new Set(sessionPayments.map(p => p.paymentId));

                        const paid = persistedPaidGuestsRef.current || [];
                        if (adhocSplitCount > 1 && paid.length > 0) {
                          const allG = Array.from({ length: adhocSplitCount }, (_, i) => i + 1);
                          const nextUnpaid = allG.find(g => !paid.includes(g));
                          if (nextUnpaid) { setGuestPaymentMode(nextUnpaid); setActiveGuestNumber(nextUnpaid); }
                          openedFromSplitRef.current = true;
                          setShowPaymentModal(true);
                          return;
                        }
                        let lsSplit = 0;
                        if (paid.length > 0) {
                          try {
                            const oid = savedOrderIdRef.current || (location.state && (location.state as any).orderId) || null;
                            if (oid) {
                              const raw = localStorage.getItem(`paidGuests_order_${oid}`);
                              if (raw) { const p = JSON.parse(raw); if (p && p.splitCount > 1) lsSplit = p.splitCount; }
                            }
                          } catch {}
                        }
                        if (lsSplit > 1 && paid.length > 0) {
                          setAdhocSplitCount(lsSplit);
                          const allG = Array.from({ length: lsSplit }, (_, i) => i + 1);
                          const nextUnpaid = allG.find(g => !paid.includes(g));
                          if (nextUnpaid) { setGuestPaymentMode(nextUnpaid); setActiveGuestNumber(nextUnpaid); }
                          openedFromSplitRef.current = true;
                          setShowPaymentModal(true);
                          return;
                        }

                        if ((guestCount||0) > 1 || (orderItems||[]).some(it => it.type === 'separator')) {
                          if (!splitOriginalSnapshotRef.current) { splitOriginalSnapshotRef.current = JSON.parse(JSON.stringify(orderItems)); }
                          setShowSplitBillModal(true);
                        } else {
                          setShowPaymentModal(true);
                        }
                      }}>
                        Payment
                      </button>
                    )}
                    <button className="px-1 py-2 flex items-center justify-center rounded-xl font-bold bg-[#22c55e] text-white transition-all duration-150 shadow-[4px_4px_8px_#15803d,_-4px_-4px_8px_#34d399] hover:shadow-[6px_6px_10px_#15803d,_-6px_-6px_10px_#34d399] active:shadow-[inset_3px_3px_6px_#15803d,_inset_-3px_-3px_6px_#34d399] active:text-green-100" style={{ height: 'var(--bottom-bar-btn-height, clamp(44px, 6vh, 68px))', fontSize: 'var(--bottom-bar-btn-font, clamp(13px, 1.9vh, 17px))', lineHeight: '1.2', textAlign: 'center' }} onClick={handleOkClick}>
                      OK
                    </button>
                  </div>
                </div>

                <PaymentSplitModals
                  showPaymentModal={showPaymentModal}
                  showSplitBillModal={showSplitBillModal}
                  paymentModalKey="pay-modal"
                  paymentModalProps={{
                    isOpen: showPaymentModal,
                    onClose: () => {
                      setShowPaymentModal(false);
                      try { setPrefillUseTotalOnceNonce(0); } catch {}
                      payInFullFromSplitRef.current = false;
                      openedFromSplitRef.current = false;
                      allModeStickyRef.current = false;
                      receiptPrintedRef.current = false;

                      const paid = persistedPaidGuestsRef.current || [];
                      const hasPartiallyPaidSplit = paid.length > 0 && adhocSplitCount > 1;
                      let lsSplitCount = 0;
                      if (!hasPartiallyPaidSplit && paid.length > 0) {
                        try {
                          const oid = savedOrderIdRef.current || (location.state && (location.state as any).orderId) || null;
                          if (oid) {
                            const raw = localStorage.getItem(`paidGuests_order_${oid}`);
                            if (raw) { const p = JSON.parse(raw); if (p && p.splitCount > 1) lsSplitCount = p.splitCount; }
                          }
                        } catch {}
                      }

                      if (hasPartiallyPaidSplit || lsSplitCount > 1) {
                        const sc = hasPartiallyPaidSplit ? adhocSplitCount : lsSplitCount;
                        setAdhocSplitCount(sc);
                        const allGuests = Array.from({ length: sc }, (_, i) => i + 1);
                        const nextUnpaid = allGuests.find(g => !paid.includes(g));
                        setGuestPaymentMode(nextUnpaid ?? 'ALL');
                      } else {
                        setAdhocSplitCount(0);
                        setGuestPaymentMode('ALL');
                      }
                    },
                    paidGuests: Array.isArray(persistedPaidGuests) ? persistedPaidGuests : [],
                    onCreateAdhocGuests: (n: number) => {
                      const prevPaid = persistedPaidGuestsRef.current || [];
                      setPersistedPaidGuests([]);
                      try {
                        const oid = savedOrderIdRef.current;
                        if (oid) {
                          localStorage.removeItem(`paidGuests_order_${oid}`);
                          if (prevPaid.length > 0) {
                            fetch(`${API_URL}/orders/${encodeURIComponent(String(oid))}/guest-status/bulk`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ statuses: prevPaid.map(g => ({ guestNumber: g, status: 'UNPAID', locked: false })) })
                            }).catch(() => {});
                          }
                        }
                      } catch {}
                      setAdhocSplitCount(n);
                      setGuestPaymentMode(1);
                      setActiveGuestNumber(1);
                      setOrderItems(prev => prev.map(it => it.type === 'item' ? { ...it, _preSplit: true } as any : it));
                    },
                    subtotal: paymentModalCalc.subtotal,
                    taxLines: paymentModalCalc.taxLines,
                    total: paymentModalCalc.total,
                    offsetTopPx: 80,
                    onConfirm: handleAddPayment,
                    onComplete: handleCompletePayment,
                    onPaymentComplete: (data: { change: number; total: number; tip: number; payments: Array<{ method: string; amount: number }>; hasCashPayment: boolean; isPartialPayment?: boolean; discount?: { percent: number; amount: number; originalSubtotal: number; discountedSubtotal: number; taxLines: Array<{ name: string; amount: number }>; taxesTotal: number }; gratuity?: number }) => {
                      if (data.gratuity && data.gratuity > 0) {
                        gratuityAmountRef.current = data.gratuity;
                      }
                      const currentGuest = typeof guestPaymentMode === 'number' ? guestPaymentMode : undefined;
                      const hasSplitBill = (adhocSplitCount > 0) || guestIds.length > 1 || (orderItems || []).some(it => it.type === 'separator');
                      
                      // 실제 부분 결제 여부: 스플릿 결제에서 아직 미결제 게스트가 남아있는 경우
                      let isActuallyPartial = false;
                      if (hasSplitBill && currentGuest) {
                        const latestPaid = persistedPaidGuestsRef.current;
                        const newPaidGuests = Array.from(new Set([...latestPaid, currentGuest]));
                        const allGuestsForSplit = (adhocSplitCount > 0)
                          ? Array.from({ length: Math.max(1, adhocSplitCount) }, (_, i) => i + 1)
                          : guestIds;
                        const unpaidGuests = allGuestsForSplit.filter(g => !newPaidGuests.includes(g));
                        isActuallyPartial = unpaidGuests.length > 0;
                      }
                      
                      // Cash drawer 오픈 (결제 완료 시 즉시)
                      try { fetch(`${API_URL}/printers/open-drawer`, { method: 'POST' }); } catch {}
                      
                      setPaymentCompleteData({
                        ...data,
                        isPartialPayment: isActuallyPartial,
                        currentGuestNumber: currentGuest,
                      });
                      if (isActuallyPartial && hasSplitBill && currentGuest) {
                        setShowPaymentCompleteModal(true);
                      } else {
                        setShowPaymentModal(false);
                        setShowPaymentCompleteModal(true);
                      }
                    },
                    channel: orderType,
                    customerName: (location.state && (location.state as any).customerName) || undefined,
                    tableName: (() => { const st:any = location.state || {}; return (st.tableName || resolvedTableName || '') || undefined; })(),
                    onSplitBill: () => {
                        if (!splitOriginalSnapshotRef.current) {
                          splitOriginalSnapshotRef.current = JSON.parse(JSON.stringify(orderItems));
                        }
                        setShowSplitBillModal(true);
                    },
                    guestCount: adhocSplitCount > 0 ? adhocSplitCount : guestIds.length,
                    guestMode: guestPaymentMode,
                    forceGuestMode: guestPaymentMode,
                    showAllButton: guestPaymentMode === 'ALL',
                    onSelectGuestMode: (mode: any) => {
                      setGuestPaymentMode(mode);
                      if (mode === 'ALL') {
                        allModeStickyRef.current = true;
                      } else {
                        allModeStickyRef.current = false;
                        if (typeof mode === 'number') setActiveGuestNumber(mode);
                      }
                    },
                    outstandingDue: paymentModalCalc.outstandingDue,
                    paidSoFar: paymentModalCalc.paidSoFar,
                    payments: paymentModalCalc.filteredPayments,
                    onVoidPayment: handleVoidPayment,
                    onClearAllPayments: handleClearAllPayments,
                    onClearScopedPayments: handleClearScopedPayments,
                    prefillDueNonce,
                    prefillUseTotalOnceNonce,
                    serviceMode: 'FSR',
                    gratuityRate: layoutSettings.gratuityRate ?? 0,
                    allTaxNames,
                    onApplyGratuity: (gratuityAmount: number) => {
                      gratuityAmountRef.current = gratuityAmount;
                    },
                    initialSplitN: undefined,
                  }}
                  splitBillModalProps={{
                    isOpen: showSplitBillModal,
                    onClose: () => setShowSplitBillModal(false),
                    orderItems,
                    guestIds,
                    guestStatusMap,
                    onSelectGuest: (mode: 'ALL' | number) => {
                      allModeStickyRef.current = false;
                      payInFullFromSplitRef.current = false;
                      setGuestPaymentMode(mode);
                      if (typeof mode === 'number') {
                        setActiveGuestNumber(mode);
                      }
                      setPrefillDueNonce(n => n + 1);
                      setShowSplitBillModal(false);
                      openedFromSplitRef.current = true;
                      priorPaymentIdsRef.current = new Set(sessionPayments.map(p => p.paymentId));
                      setTimeout(() => {
                        setShowPaymentModal(true);
                      }, 0);
                    },
                    onPayInFull: async () => {
                      setGuestPaymentMode('ALL');
                      setShowSplitBillModal(false);
                      payInFullFromSplitRef.current = true;
                      openedFromSplitRef.current = true;
                      allModeStickyRef.current = true;
                      priorPaymentIdsRef.current = new Set(sessionPayments.map(p => p.paymentId));
                      setTimeout(() => {
                        setPrefillUseTotalOnceNonce(n => n + 1);
                        setShowPaymentModal(true);
                      }, 0);
                    },
                    onMoveItemToGuest: moveItemToGuest,
                    onReorderLeftList: handleReorderLeft,
                    setOrderItems,
                    splitOriginalSnapshotRef,
                  }}
                />
              </div>
            )}
              {/* Right Panel - Menu Categories and Items (Back Office: 주문목록 숨김시 100%) */}
              <div className="bg-white flex flex-col overflow-hidden h-full" style={{ width: hideOrderListPanel ? '100%' : `${layoutSettings.rightPanelWidth}%` }}>
                <OrderCatalogPanel
                  layoutSettings={layoutSettings}
                  showInitialMenuLoading={showInitialMenuLoading}
                  error={hookError}
                  categories={categories}
                  sensors={sensors}
                  getCategoryBarOrder={getCategoryBarOrder}
                  selectedCategory={selectedCategory}
                  setSelectedCategory={setSelectedCategory}
                  mergyActive={mergyActive}
                  setMergyActive={setMergyActive}
                  currentMergyGroupId={currentMergyGroupId}
                  setCurrentMergyGroupId={setCurrentMergyGroupId}
                  MERGY_CATEGORY_ID={MERGY_CATEGORY_ID}
                  activeCategoryId={activeCategoryId}
                  setActiveCategoryId={setActiveCategoryId}
                  handleCategoryDragEnd={handleCategoryDragEnd}
                  layoutLockReady={isSalesOrder}
                  showBackgroundMenuLoading={showBackgroundMenuLoading}
                  filteredMenuItems={filteredMenuItems}
                  itemColors={itemColors}
                  selectedMenuItemId={selectedMenuItemId}
                  multiSelectMode={multiSelectMode}
                  toggleSelectMenuItem={toggleSelectMenuItem}
                  handleMenuItemClick={handleMenuItemClick}
                  handleMenuItemDragEnd={handleMenuItemDragEnd}
                  activeMenuId={activeMenuId}
                  setActiveMenuId={setActiveMenuId}
                  isMergedSelected={isMergedSelected}
                  menuItems={menuItems}
                  extraButtons={extraButtons}
                  setSelectedItemForColor={setSelectedItemForColor}
                  setShowItemColorModal={setShowItemColorModal}
                  soldOutItems={soldOutItems}
                  soldOutCategories={soldOutCategories}
                  soldOutTimes={soldOutTimes}
                  updateLayoutSetting={updateLayoutSetting}
                  catalogSnapshot={catalogSnapshot}
                  showEmptySlots={true}
                  emptySlotMode={isSalesOrder ? 'configured' : 'fill'}
                  showAllCategoriesGrouped={layoutSettings.showAllCategoriesGrouped}
                />

                {/* Modifier Section */}
                <ModifierPanel
                  sensors={sensors}
                  slotItemIds={slotItemIds}
                  entryMap={entryMap as any}
                  selectedModifiers={selectedModifiers}
                  layoutSettings={layoutSettings}
                  modifierColors={modifierColors}
                  isLoading={isLoadingModifiers}
                  activeModifierId={activeModifierId}
                  setActiveModifierId={(id: string | null) => {
                    setActiveModifierId(id);
                    if (id !== null) {
                      if (selectedMenuItemId) {
                        modDragItemIdRef.current = selectedMenuItemId;
                      } else {
                        const cat = categories.find(c => c.name === selectedCategory);
                        modDragItemIdRef.current = cat ? `__cat_${cat.category_id}` : (selectedCategory ? `__cat_${selectedCategory}` : null);
                      }
                    }
                  }}
                  handleModifierSelection={handleModifierSelection}
                  handleModifierDragEnd={handleModifierDragEnd}
                  onModifierReorder={(reordered: string[]) => {
                    const key = modLayoutKey || modCategoryKey;
                    if (!key) return;
                    setModifierLayoutByItem(prev => ({ ...prev, [key]: reordered }));
                    try { localStorage.setItem(getLayoutKey(key), JSON.stringify(reordered)); } catch {}
                    modDragItemIdRef.current = null;
                  }}
                  setSelectedModifierIdForColor={(id: string) => setSelectedModifierIdForColor(id)}
                  canAddAdhoc={!!selectedMenuItemId}
                  onAddAdhocModifier={({ name, price }) => {
                    try {
                      // Check if this is a modExtra popup trigger
                      if (name === modExtra1Name && modExtra1Enabled) {
                        setShowModExtra1Popup(true);
                        return;
                      }
                      if (name === modExtra2Name && modExtra2Enabled) {
                        setShowModExtra2Popup(true);
                        return;
                      }
                      const currentItem = selectedMenuItemId ? menuItems.find(m => m.id === selectedMenuItemId) : null;
                      if (!currentItem) return;
                      setOrderItems(prev => {
                        const idx = prev.findIndex(oi => oi.id === currentItem.id && oi.guestNumber === activeGuestNumber);
                        if (idx === -1) return prev;
                        const updated = [...prev];
                        const target: any = { ...updated[idx] };
                        const mods = Array.isArray(target.modifiers) ? [...target.modifiers] : [];
                        const GROUP_ID = '__EXTRA__';
                        const existing = mods.find((m: any) => m.groupId === GROUP_ID);
                        const newEntry = { id: `adhoc-${Date.now()}-${Math.random().toString(36).slice(2,8)}`, name, price_delta: Number(price || 0) };
                        if (existing) {
                          const entries = Array.isArray(existing.selectedEntries) ? [...existing.selectedEntries, newEntry] : [newEntry];
                          const totalModifierPrice = entries.reduce((s: number, e: any) => s + (e.price_delta || 0), 0);
                          const merged = { ...existing, selectedEntries: entries, modifierNames: entries.map((e: any) => e.name), totalModifierPrice };
                          const nextMods = mods.map((m: any) => (m.groupId === GROUP_ID ? merged : m));
                          target.modifiers = nextMods;
                        } else {
                          const group = { groupId: GROUP_ID, groupName: 'Extra', modifierIds: [], modifierNames: [name], selectedEntries: [newEntry], totalModifierPrice: Number(price || 0) } as any;
                          target.modifiers = [...mods, group];
                        }
                        // Keep base price fixed; compute total only for internal per-unit total
                        target.totalPrice = Number(((target.price || 0) + (target.modifiers || []).reduce((sum: number, m: any) => sum + (m.totalModifierPrice || 0), 0)).toFixed(2));
                        updated[idx] = target;
                        return updated;
                      });
                    } catch {}
                  }}
                  extraButton1={{ enabled: modExtra1Enabled, name: modExtra1Name, price: modExtra1Amount, colorClass: modExtra1Color }}
                  extraButton2={{ enabled: modExtra2Enabled, name: modExtra2Name, price: modExtra2Amount, colorClass: modExtra2Color }}
                  showEmptySlots={true}
                  emptySlotMode={isSalesOrder ? 'configured' : 'fill'}
                  lockLayout={isSalesOrder}
                />

                {/* Right-side Function Buttons (placed under modifier panel) */}
                <div className="pl-2 pr-0 py-0 flex-shrink-0 mt-auto">
                  <BottomActionBar
                    onReprint={handleReprint}
                    onVoid={() => { handleOpenVoid(); }}
                    onSplitOrder={handleSplitOrderClick}
                    onItemMemo={handleOpenKitchenMemo}
                    onOpenPrice={() => { setOpenPriceName(''); setOpenPriceAmount(''); setOpenPriceNote(''); setSelectedTaxGroupId(null); setSelectedPrinterGroupId(null); setShowOpenPriceModal(true); }}
                    onDiscount={handleOpenDiscount}
                    onSoldOut={handleOpenSoldOut}
                    onSearch={() => { setShowSearchModal(true); }}
                  />
                </div>
              </div>
            </div>

            {/* Bottom Section - Function Buttons Panel (moved to right panel) */}
            <div ref={bottomBarRef} />
          </div>
        </div>
      </div>


      {/* Color Selection Modal */}
      {/* Search Modal */}
      {isFullyMounted && showSearchModal && (
        <Suspense fallback={null}>
          <SearchModal
            isOpen={showSearchModal}
            onClose={() => { setShowSearchModal(false); setSoftKbTarget(prev => (prev !== 'name' && prev !== 'note') ? null : prev); }}
            items={(menuItems || []).map((it:any) => ({ id: it.id, name: it.name, short_name: it.short_name || it.shortName, category: it.category, price: it.price }))}
            itemsIndexed={searchIndex}
            keyboardOpen={!!softKbTarget}
            onSelect={(it) => {
              try {
                const item = (menuItems || []).find(m => String(m.id) === String(it.id));
                if (item) {
                  if (effectiveSplitCount > 1) {
                    let targetGuest = activeGuestNumber || 1;
                    if (isGuestLocked(targetGuest)) {
                      const allGuests = Array.isArray(guestIds) && guestIds.length > 0
                        ? guestIds
                        : Array.from({ length: effectiveSplitCount }, (_, i) => i + 1);
                      const firstUnpaid = allGuests.find(g => !isGuestLocked(g));
                      if (typeof firstUnpaid === 'number') { targetGuest = firstUnpaid; setActiveGuestNumber(firstUnpaid); }
                    }
                    const isTogoItem = !!(item as any).togoLabel;
                    setOrderItems(prev => {
                      const existingIdx = prev.findIndex((it: any) =>
                        it.type === 'item' && String(it.id) === String(item.id) && it.guestNumber === targetGuest &&
                        !it._preSplit && !!(it.togoLabel) === isTogoItem && (!it.modifiers || it.modifiers.length === 0)
                      );
                      if (existingIdx >= 0) {
                        const updated = [...prev];
                        updated[existingIdx] = { ...updated[existingIdx], quantity: (updated[existingIdx].quantity || 1) + 1 } as any;
                        return updated;
                      }
                      const olId = `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                      return [...prev, { id: item.id, name: item.name, short_name: (item as any).short_name, quantity: 1, price: item.price, modifiers: [], totalPrice: item.price, type: 'item' as const, guestNumber: targetGuest, orderLineId: olId, togoLabel: isTogoItem, _preSplit: false, ...(Array.isArray((item as any).printer_groups) && (item as any).printer_groups.length > 0 ? { printer_groups: (item as any).printer_groups } : {}) } as any];
                    });
                  } else {
                    if (isGuestLocked(activeGuestNumber)) { try { alert('Cannot add to a guest that has already paid.'); } catch {} return; }
                    addToOrder(item);
                  }
                  setShowSearchModal(false);
                  setSoftKbTarget(null);
                }
              } catch {}
            }}
            query={searchQuery}
            onChangeQuery={setSearchQuery}
            onOpenKeyboard={() => {
              try {
                setSoftKbTarget('search' as any);
                // 강제로 중앙 키보드가 보이도록 스크롤 보정
                try { document.querySelector('input[placeholder="Search menu, abbreviation, category"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
              } catch {}
            }}
          />
        </Suspense>
      )}

      {isFullyMounted && (
        <>
      {/* Global Soft Keyboard (bottom anchored overlay)
          - 숨김 조건: Item Memo / Kitchen Note 등 모달 내부 키보드가 활성일 때는 중복 방지
      */}
      {(softKbTarget && softKbTarget !== 'customTypeF1' && softKbTarget !== 'customTypeF2' && !showItemMemoModal && !showKitchenMemoModal && !showEditPriceModal && VirtualKeyboardComponent) && (
        <KeyboardPortal>
          <VirtualKeyboardComponent
            open={!!softKbTarget}
            title={''}
            bottomOffsetPx={kbBottomOffset}
            zIndex={2147483647}
            centerOffsetPx={60}
            languages={(((layoutSettings as any).keyboardLanguages || []) as string[])}
            currentLanguage={kbLang}
            onToggleLanguage={(next: string) => setKbLang(next)}
            displayText={(softKbTarget === 'name' ? (openPriceName || '') : softKbTarget === 'openPriceAmount' ? (String(openPriceAmount || '')) : softKbTarget === 'note' ? (openPriceNote || '') : softKbTarget === 'memo' ? (itemMemo || '') : softKbTarget === 'memoPrice' ? (String(itemMemoPrice || '')) : softKbTarget === 'customDiscount' ? (customDiscountPercentage || '') : softKbTarget === 'kitchenMemo' ? (kitchenMemo || '') : softKbTarget === 'editPrice' ? (String(newPrice || '')) : softKbTarget === 'voidNote' ? (voidNote || '') : (searchQuery || ''))}
            onType={(k: string) => {
              const target = softKbTarget || 'name';
              if (target === 'name') setOpenPriceName(prev => {
                const next = `${prev||''}${k}`;
                return next.replace(/(^|\s)([a-z])/g, (m, p1, p2) => p1 + p2.toUpperCase());
              });
              if (target === 'note') setOpenPriceNote(prev => {
                const next = `${prev||''}${k}`;
                const idx = next.search(/[A-Za-z]/);
                if (idx >= 0) {
                  const ch = next[idx];
                  return (ch >= 'a' && ch <= 'z') ? next.slice(0, idx) + ch.toUpperCase() + next.slice(idx + 1) : next;
                }
                return next;
              });
              if (target === 'openPriceAmount') setOpenPriceAmount(prev => {
                const base = String(prev || '');
                const next = `${base}${k}`;
                const sanitized = next.replace(/[^0-9.]/g, '');
                const dotCount = (sanitized.match(/\./g) || []).length;
                if (dotCount > 1) return base;
                return sanitized;
              });
              if (target === 'memo') setItemMemo(prev => `${prev||''}${k}`);
              if (target === 'memoPrice') setItemMemoPrice(prev => {
                const base = String(prev || '');
                const next = `${base}${k}`;
                const sanitized = next.replace(/[^0-9.]/g, '');
                const dotCount = (sanitized.match(/\./g) || []).length;
                if (dotCount > 1) return base;
                return sanitized;
              });
              if (target === 'customDiscount') setCustomDiscountPercentage(prev => {
                const base = String(prev || '');
                const next = `${base}${k}`;
                const sanitized = next.replace(/[^0-9.]/g, '');
                const dotCount = (sanitized.match(/\./g) || []).length;
                if (dotCount > 1) return base;
                return sanitized;
              });
              if (target === 'editPrice') setNewPrice(prev => {
                const base = String(prev || '');
                const next = `${base}${k}`;
                const sanitized = next.replace(/[^0-9.]/g, '');
                const dotCount = (sanitized.match(/\./g) || []).length;
                if (dotCount > 1) return base;
                return sanitized;
              });
              if (target === 'search') setSearchQuery(prev => `${prev||''}${k}`);
              if (target === 'kitchenMemo') setKitchenMemo(prev => `${prev||''}${k}`);
              if (target === 'voidNote') setVoidNote(prev => `${prev||''}${k}`);
              try {
                if (target === 'memo') {
                  const el = memoInputRef && memoInputRef.current;
                  if (el) {
                    el.focus();
                    el.setSelectionRange(String(el.value || '').length, String(el.value || '').length);
                  }
                }
                if (target === 'memoPrice') {
                  const el = memoPriceInputRef && memoPriceInputRef.current;
                  if (el) {
                    el.focus();
                    el.setSelectionRange(String(el.value || '').length, String(el.value || '').length);
                  }
                }
                if (target === 'voidNote') {
                  const el = voidNoteInputRef && voidNoteInputRef.current;
                  if (el) {
                    el.focus();
                    el.setSelectionRange(String(el.value || '').length, String(el.value || '').length);
                  }
                }
              } catch {}
            }}
            onBackspace={() => {
              if (softKbTarget === 'name') setOpenPriceName(prev => (prev ? prev.slice(0, -1) : ''));
              if (softKbTarget === 'note') setOpenPriceNote(prev => (prev ? prev.slice(0, -1) : ''));
              if (softKbTarget === 'openPriceAmount') setOpenPriceAmount(prev => (prev ? String(prev).slice(0, -1) : ''));
              if (softKbTarget === 'memo') setItemMemo(prev => (prev ? prev.slice(0, -1) : ''));
              if (softKbTarget === 'memoPrice') setItemMemoPrice(prev => (prev ? String(prev).slice(0, -1) : ''));
              if (softKbTarget === 'customDiscount') setCustomDiscountPercentage(prev => (prev ? String(prev).slice(0, -1) : ''));
              if (softKbTarget === 'editPrice') setNewPrice(prev => (prev ? String(prev).slice(0, -1) : ''));
              if (softKbTarget === 'search') setSearchQuery(prev => (prev ? prev.slice(0, -1) : ''));
              if (softKbTarget === 'voidNote') setVoidNote(prev => (prev ? prev.slice(0, -1) : ''));
              try {
                if (softKbTarget === 'memo') {
                  const el = memoInputRef && memoInputRef.current;
                  if (el) {
                    el.focus();
                    el.setSelectionRange(String(el.value || '').length, String(el.value || '').length);
                  }
                }
                if (softKbTarget === 'memoPrice') {
                  const el = memoPriceInputRef && memoPriceInputRef.current;
                  if (el) {
                    el.focus();
                    el.setSelectionRange(String(el.value || '').length, String(el.value || '').length);
                  }
                }
                if (softKbTarget === 'customDiscount') {
                  const el = customDiscountInputRef && customDiscountInputRef.current;
                  if (el) {
                    el.focus();
                    el.setSelectionRange(String(el.value || '').length, String(el.value || '').length);
                  }
                }
                if (softKbTarget === 'voidNote') {
                  const el = voidNoteInputRef && voidNoteInputRef.current;
                  if (el) {
                    el.focus();
                    el.setSelectionRange(String(el.value || '').length, String(el.value || '').length);
                  }
                }
              } catch {}
            }}
            onClear={() => {
              if (softKbTarget === 'name') setOpenPriceName('');
              if (softKbTarget === 'note') setOpenPriceNote('');
              if (softKbTarget === 'openPriceAmount') setOpenPriceAmount('');
              if (softKbTarget === 'memo') setItemMemo('');
              if (softKbTarget === 'memoPrice') setItemMemoPrice('');
              if (softKbTarget === 'customDiscount') setCustomDiscountPercentage('');
              if (softKbTarget === 'editPrice') setNewPrice('');
              if (softKbTarget === 'search') setSearchQuery('');
              if (softKbTarget === 'voidNote') setVoidNote('');
              try {
                if (softKbTarget === 'memo') {
                  const el = memoInputRef && memoInputRef.current;
                  if (el) el.focus();
                }
                if (softKbTarget === 'memoPrice') {
                  const el = memoPriceInputRef && memoPriceInputRef.current;
                  if (el) el.focus();
                }
                if (softKbTarget === 'customDiscount') {
                  const el = customDiscountInputRef && customDiscountInputRef.current;
                  if (el) el.focus();
                }
                if (softKbTarget === 'voidNote') {
                  const el = voidNoteInputRef && voidNoteInputRef.current;
                  if (el) el.focus();
                }
              } catch {}
            }}
            onTab={() => {
              if (softKbTarget === 'memo') {
                setSoftKbTarget('memoPrice');
                try {
                  setTimeout(() => {
                    const el = memoPriceInputRef && memoPriceInputRef.current;
                    if (el) {
                      el.focus();
                      el.setSelectionRange(String(el.value || '').length, String(el.value || '').length);
                    }
                  }, 0);
                } catch {}
              }
              if (softKbTarget === 'name') {
                setSoftKbTarget('openPriceAmount');
                try {
                  setTimeout(() => {
                    const el = document.querySelector('input[placeholder="0.00"]') as HTMLInputElement | null;
                    if (el) {
                      el.focus();
                      el.setSelectionRange(String(el.value || '').length, String(el.value || '').length);
                    }
                  }, 0);
                } catch {}
              }
            }}
            onEnter={() => {
              // Enter: 기본적으로 Open Price 모달이면 Add 제출, Custom Discount이면 Save
              try {
                if (showOpenPriceModal) {
                  handleSubmitOpenPrice();
                }
              } catch {}
              try { setSoftKbTarget(null); } catch {}
            }}
            onRequestClose={() => setSoftKbTarget(null)}
          />
        </KeyboardPortal>
      )}
      <ServerSelectionModal
        open={showServerModal}
        loading={serverModalLoading}
        error={serverModalError}
        employees={serverList}
        onClose={handleServerModalClose}
        onSelect={handleServerSelect}
      />
  {/* Manager PIN / Open Price Settings Modal */}
  {showManagerPinModal && (
    <ManagerPinModal isOpen={showManagerPinModal} onClose={() => setShowManagerPinModal(false)} />
  )}

  {voidToast && (
    <div className="fixed inset-0 z-[90] flex items-center justify-center pointer-events-none">
      <div className="px-5 py-3 rounded-lg bg-black/80 text-white shadow-2xl" style={{ fontSize: 20 }}>{voidToast}</div>
    </div>
  )}

  {showVoidModal && (() => {
    const voidTotals = computeVoidTotals();
    const voidSelectionCount = computeVoidSelectionCount();
    const requireManagerPin = true;
    const canConfirmVoid = voidSelectionCount > 0 && (!requireManagerPin || isPinValid());
    return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black bg-opacity-50" onKeyDown={(e)=>{
      if (e.key === 'Escape') { e.stopPropagation(); setShowVoidModal(false); }
      if (e.key === 'Enter' && canConfirmVoid) { e.preventDefault(); handleConfirmVoid(); }
    }}>
      <div ref={voidModalRef as any} className="bg-white rounded-xl shadow-2xl w-full max-w-[720px] p-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <div className="text-lg font-bold text-gray-900">Void Items</div>
          <button className="text-gray-600 hover:text-gray-800 text-3xl font-bold w-11 h-11 flex items-center justify-center rounded hover:bg-gray-100 active:bg-gray-200" onClick={()=>setShowVoidModal(false)} title="Close">×</button>
        </div>
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="w-full lg:max-w-[400px] lg:flex-none space-y-3">
            <div className="space-y-0">
          <div className="flex items-center justify-between pb-1.5 border-b-2 border-gray-300">
            <div className="text-sm font-bold text-gray-800">Select Items</div>
            <label className="text-sm flex items-center gap-2 cursor-pointer">
              <input ref={voidSelectAllRef as any} type="checkbox" className="w-5 h-5 cursor-pointer" onChange={e=>{
                const checked = e.target.checked;
                setVoidSelections((prev:any)=>{
                  const next:any = { ...(prev||{}) };
                  (orderItems||[]).forEach((it:any)=>{
                    if (it.type==='separator' || it.type==='void') return;
                    const key = String(it.orderLineId || it.id);
                    const maxQty = Math.max(1, Number(it.quantity||1));
                    next[key] = { checked, qty: (next[key]?.qty ?? maxQty) };
                  });
                  return next;
                });
              }} />
              <span className="font-medium">Select All</span>
            </label>
          </div>
          {(() => {
            // Group items by guest
            const hasSplit = (guestCount > 1) || ((orderItems||[]).some(it=>it.type==='separator'));
            if (!hasSplit) {
              // No split: show all items without guest grouping (excluding void items)
              return (orderItems||[]).filter((it:any)=>it.type!=='separator' && it.type!=='void').map((it:any)=>{
            const key = String((it as any).orderLineId || it.id);
            const sel = (voidSelections as any)[key] || { checked:false, qty: Math.max(1, Number(it.quantity||1)) };
            const maxQty = Math.max(1, Number(it.quantity||1));
            return (
                  <div key={key} className="flex items-center gap-2 py-0 px-2 hover:bg-gray-50 rounded">
                    <input type="checkbox" className="w-5 h-5 cursor-pointer flex-shrink-0" checked={!!sel.checked} onChange={e=>setVoidSelections((prev:any)=>({ ...prev, [key]: { ...(prev?.[key]||{}), checked: e.target.checked } }))} />
                    <div className="flex-1 truncate text-sm font-medium">{it.name}</div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        type="button"
                        className="w-11 h-11 flex items-center justify-center border-2 border-gray-300 rounded-lg bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-700 font-bold text-2xl disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        onClick={()=>{
                          const newQty = Math.max(1, sel.qty - 1);
                          setVoidSelections((prev:any)=>({ ...prev, [key]: { ...(prev?.[key]||{}), qty: newQty, checked: true } }));
                        }}
                        disabled={sel.qty <= 1}
                      >−</button>
                      <span className="w-9 text-center text-base font-bold">{sel.qty}</span>
                      <button
                        type="button"
                        className="w-11 h-11 flex items-center justify-center border-2 border-gray-300 rounded-lg bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-700 font-bold text-2xl disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        onClick={()=>{
                          const newQty = Math.min(maxQty, sel.qty + 1);
                          setVoidSelections((prev:any)=>({ ...prev, [key]: { ...(prev?.[key]||{}), qty: newQty, checked: true } }));
                        }}
                        disabled={sel.qty >= maxQty}
                      >+</button>
                      <span className="text-xs text-gray-500 ml-0.5 w-7">/ {maxQty}</span>
                    </div>
                  </div>
                );
              });
            } else {
              // Has split: group by guest (excluding void items)
              const itemsByGuest: Record<number, any[]> = {};
              (orderItems||[]).forEach((it:any)=>{
                if (it.type==='separator' || it.type==='void') return;
                const guestNum = it.guestNumber || 1;
                if (!itemsByGuest[guestNum]) itemsByGuest[guestNum] = [];
                itemsByGuest[guestNum].push(it);
              });
              
              const sortedGuests = Object.keys(itemsByGuest).map(Number).sort((a,b)=>a-b);
              
              return sortedGuests.map(guestNum => {
                const items = itemsByGuest[guestNum];
                const guestStatus = guestStatusMap[guestNum] || 'UNPAID';
                const isPaid = guestStatus === 'PAID';
                
                return (
                  <div key={`guest-${guestNum}`} className="mb-1">
                    <div className={`text-xs font-bold py-1 px-2.5 rounded-lg mb-0.5 ${isPaid ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>
                      Guest {guestNum} {isPaid && '(PAID)'}
                    </div>
                    <div className="space-y-0 pl-2">
                      {items.map((it:any)=>{
                        const key = String((it as any).orderLineId || it.id);
                        const sel = (voidSelections as any)[key] || { checked:false, qty: Math.max(1, Number(it.quantity||1)) };
                        const maxQty = Math.max(1, Number(it.quantity||1));
                        return (
                          <div key={key} className="flex items-center gap-2 py-0 px-2 hover:bg-gray-50 rounded">
                            <input type="checkbox" className="w-5 h-5 cursor-pointer flex-shrink-0" checked={!!sel.checked} onChange={e=>setVoidSelections((prev:any)=>({ ...prev, [key]: { ...(prev?.[key]||{}), checked: e.target.checked } }))} />
                            <div className="flex-1 truncate text-sm font-medium">{it.name}</div>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <button
                                type="button"
                                className="w-11 h-11 flex items-center justify-center border-2 border-gray-300 rounded-lg bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-700 font-bold text-2xl disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                onClick={()=>{
                                  const newQty = Math.max(1, sel.qty - 1);
                                  setVoidSelections((prev:any)=>({ ...prev, [key]: { ...(prev?.[key]||{}), qty: newQty, checked: true } }));
                                }}
                                disabled={sel.qty <= 1}
                              >−</button>
                              <span className="w-9 text-center text-base font-bold">{sel.qty}</span>
                              <button
                                type="button"
                                className="w-11 h-11 flex items-center justify-center border-2 border-gray-300 rounded-lg bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-700 font-bold text-2xl disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                onClick={()=>{
                                  const newQty = Math.min(maxQty, sel.qty + 1);
                                  setVoidSelections((prev:any)=>({ ...prev, [key]: { ...(prev?.[key]||{}), qty: newQty, checked: true } }));
                                }}
                                disabled={sel.qty >= maxQty}
                              >+</button>
                              <span className="text-xs text-gray-500 ml-0.5 w-7">/ {maxQty}</span>
                            </div>
              </div>
            );
          })}
        </div>
                  </div>
                );
              });
            }
          })()}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-semibold text-gray-800 block mb-1">Reason</label>
                <select className="w-full border-2 border-gray-300 rounded-lg px-3 py-2.5 text-sm" value={voidReasonPreset} onChange={e=>{ setVoidReasonPreset(e.target.value); if (e.target.value !== 'Other') setVoidReason(e.target.value); }}>
                  <option value="">Select a reason</option>
                  <option>Customer Cancel</option>
                  <option>Wrong Item</option>
                  <option>Kitchen Error</option>
                  <option>Overcharge</option>
                  <option>Other</option>
                </select>
                {voidReasonPreset === 'Other' && (
                  <input className="mt-1.5 w-full border-2 border-gray-300 rounded-lg px-3 py-2.5 text-sm" value={voidReason} onChange={e=>setVoidReason(e.target.value)} placeholder="Enter reason" />
                )}
              </div>
              <div>
                <label className="text-sm font-semibold text-gray-800 block mb-1">Note</label>
                <div className="relative">
                  <input 
                    ref={voidNoteInputRef}
                    className="w-full border-2 border-gray-300 rounded-lg px-3 py-2.5 pr-12 text-sm" 
                    value={voidNote} 
                    onChange={e=>setVoidNote(e.target.value)} 
                    placeholder="Note (optional)"
                    onFocus={() => setSoftKbTarget('voidNote')}
                    onMouseDown={() => { setSoftKbTarget('voidNote'); }}
                    onTouchStart={() => { setSoftKbTarget('voidNote'); }}
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-1 w-10 flex items-center justify-center text-gray-500 hover:text-gray-700"
                    onClick={() => {
                      try {
                        voidNoteInputRef.current?.focus();
                        setSoftKbTarget('voidNote');
                        try { window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); } catch {}
                      } catch {}
                    }}
                    title="Open Keyboard"
                  >
                    <KeyboardIcon size={24} />
                  </button>
                </div>
              </div>
            </div>
            <div className="text-sm font-bold text-gray-900">
              Selected: {voidSelectionCount} • Subtotal: ${voidTotals.subtotal.toFixed(2)} • Total: ${voidTotals.total.toFixed(2)}
            </div>
          </div>
          <div className="w-full lg:w-[280px] flex-shrink-0">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 shadow-inner h-full">
              <p className="text-sm font-semibold text-gray-800 mb-2">Void Authorization PIN</p>
              {requireManagerPin ? (
                <div className="flex flex-col gap-3 items-start w-full">
                  <input
                    ref={voidPinInputRef as any}
                    className={`w-full border-2 rounded-lg px-3 py-2.5 text-sm font-medium ${voidPinError ? 'border-red-500' : 'border-gray-300'}`}
                    placeholder="Authorization PIN"
                    value={voidPin}
                    onChange={e=>{ setVoidPinError(''); setVoidPin(e.target.value.replace(/[^0-9]/g,'')); }}
                    onFocus={()=> setVoidPinError('')}
                    inputMode="numeric"
                    maxLength={4}
                  />
                  {voidPinError && <span className="text-xs text-red-600 font-medium whitespace-nowrap">{voidPinError}</span>}
                  <div className="grid grid-cols-3 gap-2 w-full">
                    {[1,2,3,4,5,6,7,8,9].map((num) => (
                      <button
                        key={`void-pin-${num}`}
                        type="button"
                        className="h-12 rounded-lg bg-white hover:bg-gray-100 active:bg-gray-200 font-semibold text-gray-800 shadow border border-gray-200"
                        onClick={() => handleVoidPinDigit(String(num))}
                      >
                        {num}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="h-12 rounded-lg bg-white hover:bg-gray-100 active:bg-gray-200 font-semibold text-gray-800 shadow border border-gray-200"
                      onClick={handleVoidPinClear}
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      className="h-12 rounded-lg bg-white hover:bg-gray-100 active:bg-gray-200 font-semibold text-gray-800 shadow border border-gray-200"
                      onClick={() => handleVoidPinDigit('0')}
                    >
                      0
                    </button>
                    <button
                      type="button"
                      className="h-12 rounded-lg bg-white hover:bg-gray-100 active:bg-gray-200 font-semibold text-gray-800 shadow border border-gray-200"
                      onClick={handleVoidPinBackspace}
                    >
                      ←
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-500">Manager PIN not required for this amount.</p>
              )}
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-end gap-3">
          <button className="px-5 py-2.5 rounded-lg bg-gray-200 hover:bg-gray-300 active:bg-gray-400 text-sm font-bold transition-colors min-w-[110px]" onClick={()=>setShowVoidModal(false)}>Cancel</button>
          <button className="px-5 py-2.5 rounded-lg bg-red-600 text-white hover:bg-red-700 active:bg-red-800 disabled:bg-gray-300 disabled:text-gray-600 text-sm font-bold transition-colors min-w-[110px]" disabled={!canConfirmVoid} onClick={handleConfirmVoid}>Void</button>
        </div>
      </div>
    </div>
    );
  })()}
      {/* Open Price Modal */}
      {showOpenPriceModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-4 w-[400px] max-w-[95vw] shadow-2xl">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-lg font-bold text-gray-900">Open Price</h3>
              <button onClick={() => { setSoftKbTarget(null); setShowOpenPriceModal(false); }} className="text-gray-600 hover:text-gray-800 text-2xl font-bold" title="Close">×</button>
            </div>

            {openPriceError && (
              <div className="mb-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
                {openPriceError}
              </div>
            )}

            <div className="space-y-3">
              {/* Item Name 70% + Amount 30% 상단 배치 */}
              <div className="grid grid-cols-12 gap-2">
                <div className="col-span-8">
                  <label className="block text-sm text-gray-800 mb-1">Item Name</label>
                  <div className="relative">
                    <input
                      ref={openPriceNameInputRef}
                      value={openPriceName}
                      onChange={(e) => {
                        const raw = e.target.value || '';
                        // Title-case for English words: uppercase first English letter and first after spaces
                        const transformed = raw.replace(/(^|\s)([a-z])/g, (m, p1, p2) => p1 + p2.toUpperCase());
                        setOpenPriceName(transformed);
                      }}
                      onFocus={() => setSoftKbTarget('name')}
                      onMouseDown={() => { setSoftKbTarget('name'); }}
                      onTouchStart={() => { setSoftKbTarget('name'); }}
                      className="w-full h-12 rounded-lg border border-gray-300 pr-16 px-3 text-gray-900 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g. Open Charge"
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-1 w-14 flex items-center justify-center text-gray-500 hover:text-gray-700"
                      onClick={() => {
                        try {
                          const userAgent = navigator.userAgent || '';
                          const isWindows = userAgent.includes('Windows');
                          const isIOS = /iPad|iPhone|iPod/.test(userAgent);
                          const isAndroid = /Android/.test(userAgent);
                      // 포커스를 주어 OS 가상 키보드 표시 유도 + 소프트 키보드 표시
                      openPriceNameInputRef.current?.focus();
                      setSoftKbTarget('name');
                      try { window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); } catch {}
                          // Windows: TabTip.exe 직접 실행은 브라우저 보안상 불가. Kiosk/WebView 브리지 사용 시 여기서 호출 가능
                        } catch {}
                      }}
                      title="Open OS Keyboard"
                    >
                      <KeyboardIcon size={28} />
                    </button>
                  </div>
                </div>
                <div className="col-span-4">
                  <label className="block text-sm text-gray-800 mb-1">Amount</label>
                  <div className="relative">
                    <input
                      ref={openPriceAmountInputRef}
                      inputMode="decimal"
                      type="text"
                      value={openPriceAmount}
                      onChange={(e) => setOpenPriceAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                      onFocus={() => setSoftKbTarget('openPriceAmount')}
                      onMouseDown={() => {
                        setSoftKbTarget('openPriceAmount');
                        requestAnimationFrame(() => {
                          try {
                            openPriceAmountInputRef.current?.focus();
                            const value = openPriceAmountInputRef.current?.value || '';
                            openPriceAmountInputRef.current?.setSelectionRange(value.length, value.length);
                          } catch {}
                        });
                      }}
                      onTouchStart={() => {
                        setSoftKbTarget('openPriceAmount');
                        requestAnimationFrame(() => {
                          try {
                            openPriceAmountInputRef.current?.focus();
                            const value = openPriceAmountInputRef.current?.value || '';
                            openPriceAmountInputRef.current?.setSelectionRange(value.length, value.length);
                          } catch {}
                        });
                      }}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-14 text-gray-900 text-xl font-semibold tracking-wide focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="0.00"
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-1 w-12 flex items-center justify-center text-gray-500 hover:text-gray-700"
                      onClick={() => {
                        setSoftKbTarget('openPriceAmount');
                        try {
                          openPriceAmountInputRef.current?.focus();
                          const value = openPriceAmountInputRef.current?.value || '';
                          openPriceAmountInputRef.current?.setSelectionRange(value.length, value.length);
                        } catch {}
                      }}
                      title="Open Keyboard"
                    >
                      <KeyboardIcon size={24} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Numeric keypad removed per request */}

              <div>
                <label className="block text-sm text-gray-800 mb-1">Note (as Modifier)</label>
                <div className="relative">
                  <input
                    ref={openPriceNoteInputRef}
                    value={openPriceNote}
                    onChange={(e) => {
                      const raw = e.target.value || '';
                      // Capitalize ONLY the first English letter (once). Do not force others.
                      const idx = raw.search(/[A-Za-z]/);
                      if (idx >= 0) {
                        const ch = raw[idx];
                        const transformed = (ch >= 'a' && ch <= 'z') ? raw.slice(0, idx) + ch.toUpperCase() + raw.slice(idx + 1) : raw;
                        setOpenPriceNote(transformed);
                      } else {
                        setOpenPriceNote(raw);
                      }
                    }}
                    onFocus={() => setSoftKbTarget('note')}
                    onMouseDown={() => { setSoftKbTarget('note'); }}
                    onTouchStart={() => { setSoftKbTarget('note'); }}
                    className="w-full h-12 rounded-lg border border-gray-300 pr-16 px-3 text-gray-900 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Optional"
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-1 w-14 flex items-center justify-center text-gray-500 hover:text-gray-700"
                    onClick={() => {
                      try {
                        const userAgent = navigator.userAgent || '';
                        const isWindows = userAgent.includes('Windows');
                        const isIOS = /iPad|iPhone|iPod/.test(userAgent);
                        const isAndroid = /Android/.test(userAgent);
                        // 포커스를 주어 OS 가상 키보드 표시 유도 + 소프트 키보드 표시
                        openPriceNoteInputRef.current?.focus();
                        setSoftKbTarget('note');
                        try { window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); } catch {}
                      } catch {}
                    }}
                    title="Open OS Keyboard"
                  >
                    <KeyboardIcon size={28} />
                  </button>
                </div>
              </div>

              {/* Tax/Printer 선택 - 각각의 행으로 분리 */}
              <div className="space-y-2">
                <div>
                  <label className="block text-sm text-gray-800 mb-1">Tax Group</label>
                  <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1">
                    {taxGroupOptions.map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => setSelectedTaxGroupId(opt.id)}
                        className={`rounded-lg px-3 py-2 min-h-12 text-left ${selectedTaxGroupId === opt.id ? 'border-2 border-blue-500 bg-blue-50 hover:bg-blue-100' : 'border border-gray-300 bg-gray-50 hover:bg-gray-100'}`}
                        title={`Rate: ${opt.totalRate}%`}
                      >
                        <div className="flex justify-between items-center gap-2 w-full">
                          <span className="text-sm font-semibold text-gray-900 truncate">{opt.name}</span>
                          <span className="text-xs text-gray-600 whitespace-nowrap">{opt.totalRate}%</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-gray-800 mb-1">Printer Group</label>
                  <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1">
                    {printerGroupOptions.map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => setSelectedPrinterGroupId(opt.id)}
                        className={`rounded-lg px-3 py-2 min-h-12 text-left ${selectedPrinterGroupId === opt.id ? 'border-2 border-blue-500 bg-blue-50 hover:bg-blue-100' : 'border border-gray-300 bg-gray-50 hover:bg-gray-100'}`}
                        title={`Printers: ${opt.count}`}
                      >
                        <div className="flex justify-between items-center gap-2 w-full">
                          <span className="text-sm font-semibold text-gray-900 truncate">{opt.name}</span>
                          <span className="text-xs text-gray-600 whitespace-nowrap">{opt.count} PRT</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Manager PIN UI removed as requested */}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button onClick={() => { setSoftKbTarget(null); setShowOpenPriceModal(false); }} className="py-3 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-900 text-base font-semibold">Cancel</button>
              <button onClick={() => { setSoftKbTarget(null); handleSubmitOpenPrice(); }} className="py-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-base font-semibold">Add</button>
            </div>
          </div>
        </div>
      )}
      {showMenuColorModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-auto max-w-[90vw] max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-800">Menu Tab Colors</h3>
              <button
                onClick={() => setShowMenuColorModal(false)}
                className="text-gray-600 hover:text-gray-800 text-2xl font-bold"
              >
                ×
              </button>
            </div>

            {/* Normal Color */}
            <div className="mb-4">
              <p className="text-sm text-gray-600 mb-2">Current Default Color:</p>
              <div className="flex items-center space-x-3 mb-3">
                <div 
                  className={`w-8 h-8 rounded-lg ${layoutSettings.menuDefaultColor}`}
                  title={layoutSettings.menuDefaultColor}
                ></div>
                <span className="text-sm font-medium text-gray-800">
                  {layoutSettings.menuDefaultColor.replace('bg-', '').replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </span>
              </div>
            </div>

            {/* Selected Color */}
            <div className="mb-6">
              <p className="text-sm text-gray-600 mb-3">Select a new selected color:</p>
              <div className="grid grid-cols-8 gap-x-1 gap-y-2">
                {[
                  'bg-slate-500','bg-gray-500','bg-zinc-500','bg-neutral-500','bg-stone-500',
                  'bg-red-500','bg-orange-500','bg-amber-500','bg-yellow-500','bg-lime-500',
                  'bg-green-500','bg-emerald-500','bg-teal-500','bg-cyan-500','bg-sky-500',
                  'bg-blue-500','bg-indigo-500','bg-violet-500','bg-purple-500','bg-fuchsia-500',
                  'bg-pink-500','bg-rose-500',
                  'bg-red-600','bg-orange-600','bg-amber-600','bg-yellow-600','bg-lime-600',
                  'bg-green-600','bg-emerald-600','bg-teal-600','bg-cyan-600','bg-sky-600',
                  'bg-blue-600','bg-indigo-600','bg-violet-600','bg-purple-600','bg-fuchsia-600',
                  'bg-pink-600','bg-rose-600','bg-slate-600'
                ].map((color, idx) => {
                  const isSelected = layoutSettings.menuDefaultColor === color;
                  const selectedColor = color.replace(/-(?:300|400|500|600|700)/, '-600');
                  return (
                    <button
                      key={color}
                      onClick={() => {
                        updateLayoutSetting('menuDefaultColor', color);
                      }}
                      className={`w-12 h-12 rounded-lg transition-all ${(idx % 8 === 3) ? 'mr-6' : ''} ${isSelected ? `scale-110 shadow-lg ring-4 ring-blue-400 ${selectedColor}` : `hover:scale-105 ${color}`}`}
                      title={color.replace('bg-', '').replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    />
                  );
                })}
              </div>
            </div>

            {/* Close Button */}
            <div className="flex justify-end">
              <button
                onClick={() => setShowMenuColorModal(false)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Individual Item Color Modal */}
      {showItemColorModal && selectedItemForColor && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-auto max-w-[90vw] max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-800">Change Item Color</h3>
              <button
                onClick={() => setShowItemColorModal(false)}
                className="text-gray-600 hover:text-gray-800 text-2xl font-bold"
              >
                ×
              </button>
            </div>

            <div className="mb-4">
              <p className="text-sm text-gray-600 mb-2">Item: <span className="font-medium">{selectedItemForColor ? selectedItemForColor.name : ''}</span></p>
              <p className="text-xs text-gray-500">Select a new color for this specific item</p>
            </div>

            {/* Color Grid */}
            <div className="mb-6">
              <div className="grid grid-cols-8 gap-x-1 gap-y-2">
                {[
                  'bg-slate-500','bg-gray-500','bg-zinc-500','bg-neutral-500','bg-stone-500',
                  'bg-red-500','bg-orange-500','bg-amber-500','bg-yellow-500','bg-lime-500',
                  'bg-green-500','bg-emerald-500','bg-teal-500','bg-cyan-500','bg-sky-500',
                  'bg-blue-500','bg-indigo-500','bg-violet-500','bg-purple-500','bg-fuchsia-500',
                  'bg-pink-500','bg-rose-500',
                  'bg-red-600','bg-orange-600','bg-amber-600','bg-yellow-600','bg-lime-600',
                  'bg-green-600','bg-emerald-600','bg-teal-600','bg-cyan-600','bg-sky-600',
                  'bg-blue-600','bg-indigo-600','bg-violet-600','bg-purple-600','bg-fuchsia-600',
                  'bg-pink-600','bg-rose-600','bg-slate-600'
                ].map((color, idx) => {
                  const isSelected = selectedItemForColor ? ((itemColors[selectedItemForColor.id] || layoutSettings.menuDefaultColor) === color) : false;
                  const selectedColor = color.replace(/-(?:300|400|500|600|700)/, '-600');
                  return (
                    <button
                      key={color}
                      onClick={async () => {
                        setItemColors(prev => ({
                          ...prev,
                          ...(selectedItemForColor ? { [selectedItemForColor.id]: color } : {})
                        }));
                        try {
                          if (selectedItemForColor) {
                            await fetch(`${API_URL}/menu-item-colors`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ [selectedItemForColor.id]: color }) });
                          }
                        } catch {}
                        setShowItemColorModal(false);
                      }}
                      className={`w-12 h-12 rounded-lg transition-all ${(idx % 8 === 3) ? 'mr-6' : ''} ${isSelected ? `scale-110 shadow-lg ring-4 ring-blue-400 ${selectedColor}` : `hover:scale-105 ${color}`}`}
                      title={color.replace('bg-', '').replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    />
                  );
                })}
              </div>
            </div>

            {/* Reset to Default Button */}
            <div className="mb-6">
              <button
                onClick={async () => {
                  setItemColors(prev => {
                    const newColors = { ...prev };
                    if (selectedItemForColor) {
                      delete newColors[selectedItemForColor.id];
                    }
                    return newColors;
                  });
                  try {
                    if (selectedItemForColor) {
                      // null/empty value means "delete override" (reset to default)
                      await fetch(`${API_URL}/menu-item-colors`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ [selectedItemForColor.id]: null }),
                      });
                    }
                  } catch {}
                  setShowItemColorModal(false);
                }}
                className="w-full bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg transition-colors font-medium"
              >
                Reset to Default
              </button>
            </div>

            {/* Close Button */}
            <div className="flex justify-end">
              <button
                onClick={() => setShowItemColorModal(false)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Color Modal */}
      {showCustomColorModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-auto max-w-[90vw] max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-800">Custom Color</h3>
              <button
                onClick={() => setShowCustomColorModal(false)}
                className="text-gray-600 hover:text-gray-800 text-2xl font-bold"
              >
                ×
              </button>
            </div>

            <div className="mb-4">
              <p className="text-sm text-gray-600 mb-2">
                {customColorModalSource === 'menu' 
                  ? 'Choose colors and menu items to apply them' 
                  : 'Choose colors and modifier options to apply them'
                }
              </p>
            </div>

            {/* Items Selection */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-gray-700">
                  {customColorModalSource === 'menu' ? 'Select Menu Items' : 'Select Modifier Options'}
                </label>
                <button
                  onClick={() => setMultiSelectMode((v) => !v)}
                  className={`text-[10px] px-2 py-0.5 rounded border ${multiSelectMode ? 'bg-blue-600 text-white border-blue-700' : 'bg-gray-600 text-gray-200 border-gray-500'}`}
                  title="Toggle multi-select mode"
                >
                  Multi
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto">
                {customColorModalSource === 'menu' ? (
                  // Menu Items
                  menuItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        if (multiSelectMode) {
                          toggleSelectMenuItem(item.id);
                        } else {
                          setSelectedItemForColor(prev => prev?.id === item.id ? null : item);
                        }
                      }}
                      className={`p-2 text-xs rounded border transition-colors ${
                        (multiSelectMode && selectedMenuItemIds.includes(item.id)) || (!multiSelectMode && selectedItemForColor?.id === item.id)
                          ? 'bg-blue-500 text-white border-blue-600'
                          : 'bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200'
                      }`}
                    >
                      {item.name}
                    </button>
                  ))
                ) : (
                  // Modifier Options
                  selectedItemModifiers.flatMap(modifierLink => 
                    modifierLink.modifiers?.map((modifier: any) => ({
                      id: modifier.option_id || modifier.modifier_id || modifier.id,
                      name: modifier.name,
                      groupName: modifierLink.group?.name || 'Unknown Group'
                    })) || []
                  ).map((modifier) => (
                    <button
                      key={modifier.id}
                      onClick={() => {
                        if (multiSelectMode) {
                          toggleSelectMenuItem(modifier.id);
                        } else {
                          setSelectedItemForColor(prev => prev?.id === modifier.id ? null : { 
                            id: modifier.id, 
                            name: modifier.name, 
                            price: 0, 
                            category: modifier.groupName,
                            color: layoutSettings.modifierDefaultColor
                          });
                        }
                      }}
                      className={`p-2 text-xs rounded border transition-colors ${
                        (multiSelectMode && selectedMenuItemIds.includes(modifier.id)) || (!multiSelectMode && selectedItemForColor?.id === modifier.id)
                          ? 'bg-blue-500 text-white border-blue-600'
                          : 'bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200'
                      }`}
                    >
                      {modifier.name}
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Color Grid */}
            <div className="mb-6">
              <label className="block text-sm mb-2 text-gray-700">Choose Colors</label>
              <div className="grid grid-cols-8 gap-x-1 gap-y-2">
                {[
                  'bg-blue-500', 'bg-green-500', 'bg-yellow-500', 'bg-red-500',
                  'bg-purple-500', 'bg-indigo-500', 'bg-pink-500', 'bg-orange-500',
                  'bg-teal-500', 'bg-emerald-500', 'bg-cyan-500', 'bg-rose-500',
                  'bg-violet-500', 'bg-fuchsia-500', 'bg-sky-500', 'bg-lime-500'
                ].map((color, idx) => (
                  <button
                    key={color}
                    onClick={async () => {
                      if (multiSelectMode && selectedMenuItemIds.length > 0) {
                        let payload: { [key: string]: string } = {};
                        setItemColors(prev => {
                          const updated = { ...prev } as { [key: string]: string };
                          selectedMenuItemIds.forEach(id => {
                            updated[id] = color;
                            payload[id] = color;
                          });
                          return updated;
                        });
                        try { await fetch(`${API_URL}/menu-item-colors`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) }); } catch {}
                        setShowCustomColorModal(false);
                      } else if (!multiSelectMode && selectedItemForColor) {
                        setItemColors(prev => ({ ...prev, [selectedItemForColor.id]: color }));
                        try { await fetch(`${API_URL}/menu-item-colors`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ [selectedItemForColor.id]: color }) }); } catch {}
                        setShowCustomColorModal(false);
                      } else {
                        // no selection; do nothing
                      }
                    }}
                    className={`w-12 h-12 rounded-lg transition-all ${(idx % 8 === 3) ? 'mr-6' : ''} ${color}`}
                    title={color.replace('bg-', '').replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  />
                ))}
              </div>
            </div>

            {/* Apply Colors Button */}
            {selectedColors.length > 0 && selectedItemForColor && (
              <div className="mb-6">
                <button
                  onClick={async () => {
                    // Apply the first selected color to the selected menu item
                    const colorToApply = selectedColors[0];
                    setItemColors(prev => ({
                      ...prev,
                      [selectedItemForColor.id]: colorToApply
                    }));
                    try {
                      await fetch(`${API_URL}/menu-item-colors`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ [selectedItemForColor.id]: colorToApply }),
                      });
                    } catch {}
                    setSelectedColors([]);
                    setShowCustomColorModal(false);
                  }}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors font-medium"
                >
                  Apply {selectedColors.length} Color{selectedColors.length > 1 ? 's' : ''} to {selectedItemForColor ? selectedItemForColor.name : ''}
                </button>
              </div>
            )}

            {/* Close Button */}
            <div className="flex justify-end">
              <button
                onClick={() => setShowCustomColorModal(false)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modifier Color Modal */}
      {showModifierColorModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg p-6 w-auto max-w-[90vw] max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">🔧 {
                modifierColorModalSource === 'modExtra1' ? 'Modifier Extra 1 Button' 
                : modifierColorModalSource === 'modExtra2' ? 'Modifier Extra 2 Button' 
                : modifierColorModalSource === 'modExtra1Tab' ? 'Modifier Extra 1 Tab Default'
                : modifierColorModalSource === 'modExtra2Tab' ? 'Modifier Extra 2 Tab Default'
                : 'Modifier Button'
              } Color</h2>
              <button
                onClick={() => setShowModifierColorModal(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl font-bold"
              >
                ×
              </button>
            </div>

            {/* Current Color Display */}
            <div className="mb-4">
              <div className="flex items-center space-x-2">
                <span className="text-base text-gray-600">Current Color:</span>
                <div 
                  className={`w-6 h-6 rounded border border-gray-300 ${
                    modifierColorModalSource === 'modExtra1Tab' && modExtra1SelectedGroup
                      ? modExtra1Tabs.find(t => t.id === modExtra1ActiveTabId)?.groups.find(g => g.id === modExtra1SelectedGroup)?.color || 'bg-indigo-600'
                      : modifierColorModalSource === 'modExtra2Tab' && modExtra2SelectedGroup
                      ? modExtra2Tabs.find(t => t.id === modExtra2ActiveTabId)?.groups.find(g => g.id === modExtra2SelectedGroup)?.color || 'bg-emerald-600'
                      : modifierColorModalSource === 'modExtra1' && modExtra1SelectedGroup && modExtra1SelectedBtn !== null
                      ? modExtra1Tabs.find(t => t.id === modExtra1ActiveTabId)?.groups.find(g => g.id === modExtra1SelectedGroup)?.buttons[modExtra1SelectedBtn]?.color || 'bg-gray-400'
                      : modifierColorModalSource === 'modExtra2' && modExtra2SelectedGroup && modExtra2SelectedBtn !== null
                      ? modExtra2Tabs.find(t => t.id === modExtra2ActiveTabId)?.groups.find(g => g.id === modExtra2SelectedGroup)?.buttons[modExtra2SelectedBtn]?.color || 'bg-gray-400'
                      : modifierColorModalSource==='custom' && selectedModifierIdForColor && modifierColors[selectedModifierIdForColor] 
                      ? modifierColors[selectedModifierIdForColor] 
                      : layoutSettings.modifierDefaultColor
                  }`}
                ></div>
                <span className="text-sm text-gray-500">{
                  modifierColorModalSource === 'modExtra1Tab' && modExtra1SelectedGroup
                    ? modExtra1Tabs.find(t => t.id === modExtra1ActiveTabId)?.groups.find(g => g.id === modExtra1SelectedGroup)?.color || 'bg-indigo-600'
                    : modifierColorModalSource === 'modExtra2Tab' && modExtra2SelectedGroup
                    ? modExtra2Tabs.find(t => t.id === modExtra2ActiveTabId)?.groups.find(g => g.id === modExtra2SelectedGroup)?.color || 'bg-emerald-600'
                    : modifierColorModalSource === 'modExtra1' && modExtra1SelectedGroup && modExtra1SelectedBtn !== null
                    ? modExtra1Tabs.find(t => t.id === modExtra1ActiveTabId)?.groups.find(g => g.id === modExtra1SelectedGroup)?.buttons[modExtra1SelectedBtn]?.color || 'bg-gray-400'
                    : modifierColorModalSource === 'modExtra2' && modExtra2SelectedGroup && modExtra2SelectedBtn !== null
                    ? modExtra2Tabs.find(t => t.id === modExtra2ActiveTabId)?.groups.find(g => g.id === modExtra2SelectedGroup)?.buttons[modExtra2SelectedBtn]?.color || 'bg-gray-400'
                    : modifierColorModalSource==='custom' && selectedModifierIdForColor && modifierColors[selectedModifierIdForColor] 
                    ? modifierColors[selectedModifierIdForColor] 
                    : layoutSettings.modifierDefaultColor
                }</span>
              </div>
            </div>

            {/* Color Selection */}
            <div className="mb-4">
              <div className="grid grid-cols-8 gap-x-1 gap-y-1 justify-center" style={{ gridTemplateColumns: 'repeat(8, max-content)' }}>
                {[
                  'bg-slate-500','bg-gray-500','bg-zinc-500','bg-neutral-500','bg-stone-500',
                  'bg-red-500','bg-orange-500','bg-amber-500','bg-yellow-500','bg-lime-500',
                  'bg-green-500','bg-emerald-500','bg-teal-500','bg-cyan-500','bg-sky-500',
                  'bg-blue-500','bg-indigo-500','bg-violet-500','bg-purple-500','bg-fuchsia-500',
                  'bg-pink-500','bg-rose-500',
                  'bg-red-600','bg-orange-600','bg-amber-600','bg-yellow-600','bg-lime-600',
                  'bg-green-600','bg-emerald-600','bg-teal-600','bg-cyan-600','bg-sky-600',
                  'bg-blue-600','bg-indigo-600','bg-violet-600','bg-purple-600','bg-fuchsia-600',
                  'bg-pink-600','bg-rose-600','bg-slate-600'
                ].map((color, idx) => (
                  <button
                    key={color}
                    onClick={() => {
                      if (modifierColorModalSource === 'modExtra1Tab' && modExtra1SelectedGroup) {
                        setModExtra1Tabs(prev => prev.map(t => t.id === modExtra1ActiveTabId ? { ...t, groups: t.groups.map(g => g.id === modExtra1SelectedGroup ? { ...g, color, buttons: g.buttons.map(btn => ({ ...btn, color })) } : g) } : t));
                      } else if (modifierColorModalSource === 'modExtra2Tab' && modExtra2SelectedGroup) {
                        setModExtra2Tabs(prev => prev.map(t => t.id === modExtra2ActiveTabId ? { ...t, groups: t.groups.map(g => g.id === modExtra2SelectedGroup ? { ...g, color, buttons: g.buttons.map(btn => ({ ...btn, color })) } : g) } : t));
                      } else if (modifierColorModalSource === 'modExtra1' && modExtra1SelectedGroup && modExtra1SelectedBtn !== null) {
                        setModExtra1Tabs(prev => prev.map(t => {
                          if (t.id !== modExtra1ActiveTabId) return t;
                          return { ...t, groups: t.groups.map(g => {
                            if (g.id !== modExtra1SelectedGroup) return g;
                            const newBtns = [...g.buttons];
                            newBtns[modExtra1SelectedBtn] = { ...newBtns[modExtra1SelectedBtn], color };
                            return { ...g, buttons: newBtns };
                          })};
                        }));
                      } else if (modifierColorModalSource === 'modExtra2' && modExtra2SelectedGroup && modExtra2SelectedBtn !== null) {
                        setModExtra2Tabs(prev => prev.map(t => {
                          if (t.id !== modExtra2ActiveTabId) return t;
                          return { ...t, groups: t.groups.map(g => {
                            if (g.id !== modExtra2SelectedGroup) return g;
                            const newBtns = [...g.buttons];
                            newBtns[modExtra2SelectedBtn] = { ...newBtns[modExtra2SelectedBtn], color };
                            return { ...g, buttons: newBtns };
                          })};
                        }));
                      } else if (modifierColorModalSource === 'custom' && selectedModifierIdForColor) {
                        console.log('🎨 [Modifier Color] Setting color for ID:', selectedModifierIdForColor, '→', color);
                        setModifierColors(prev => {
                          const newColors = { ...prev, [selectedModifierIdForColor]: color };
                          console.log('🎨 [Modifier Color] New modifierColors:', newColors);
                          return newColors;
                        });
                      } else {
                        updateLayoutSetting('modifierDefaultColor', color);
                      }
                    }}
                    className={`w-12 h-12 rounded-lg transition-all ${(idx % 8 === 3) ? 'mr-6' : ''} ${
                      (modifierColorModalSource === 'modExtra1Tab' && modExtra1SelectedGroup
                        ? modExtra1Tabs.find(t => t.id === modExtra1ActiveTabId)?.groups.find(g => g.id === modExtra1SelectedGroup)?.color === color
                        : modifierColorModalSource === 'modExtra2Tab' && modExtra2SelectedGroup
                        ? modExtra2Tabs.find(t => t.id === modExtra2ActiveTabId)?.groups.find(g => g.id === modExtra2SelectedGroup)?.color === color
                        : modifierColorModalSource === 'modExtra1' && modExtra1SelectedGroup && modExtra1SelectedBtn !== null 
                        ? modExtra1Tabs.find(t => t.id === modExtra1ActiveTabId)?.groups.find(g => g.id === modExtra1SelectedGroup)?.buttons[modExtra1SelectedBtn]?.color === color
                        : modifierColorModalSource === 'modExtra2' && modExtra2SelectedGroup && modExtra2SelectedBtn !== null
                        ? modExtra2Tabs.find(t => t.id === modExtra2ActiveTabId)?.groups.find(g => g.id === modExtra2SelectedGroup)?.buttons[modExtra2SelectedBtn]?.color === color
                        : layoutSettings.modifierDefaultColor === color)
                        ? `scale-110 shadow-lg ring-4 ring-blue-400 ${color.replace(/-(?:300|400|500|600|700)/, '-600')}` 
                        : `hover:scale-105 ${color}`
                    }`}
                    title={color.replace('bg-', '').replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  />
                ))}
              </div>
            </div>

            {/* Buttons */}
            <div className="flex justify-between items-center pt-2">
              <button
                onClick={() => {
                  if (modifierColorModalSource === 'modExtra1Tab' && modExtra1SelectedGroup) {
                    setModExtra1Tabs(prev => prev.map(t => t.id === modExtra1ActiveTabId ? { ...t, groups: t.groups.map(g => g.id === modExtra1SelectedGroup ? { ...g, color: 'bg-indigo-600', buttons: g.buttons.map(btn => ({ ...btn, color: 'bg-indigo-600' })) } : g) } : t));
                  } else if (modifierColorModalSource === 'modExtra2Tab' && modExtra2SelectedGroup) {
                    setModExtra2Tabs(prev => prev.map(t => t.id === modExtra2ActiveTabId ? { ...t, groups: t.groups.map(g => g.id === modExtra2SelectedGroup ? { ...g, color: 'bg-emerald-600', buttons: g.buttons.map(btn => ({ ...btn, color: 'bg-emerald-600' })) } : g) } : t));
                  } else if (modifierColorModalSource === 'modExtra1' && modExtra1SelectedGroup && modExtra1SelectedBtn !== null) {
                    setModExtra1Tabs(prev => prev.map(t => {
                      if (t.id !== modExtra1ActiveTabId) return t;
                      const group = t.groups.find(g => g.id === modExtra1SelectedGroup);
                      return { ...t, groups: t.groups.map(g => {
                        if (g.id !== modExtra1SelectedGroup) return g;
                        const newBtns = [...g.buttons];
                        newBtns[modExtra1SelectedBtn] = { ...newBtns[modExtra1SelectedBtn], color: group?.color || 'bg-indigo-600' };
                        return { ...g, buttons: newBtns };
                      })};
                    }));
                  } else if (modifierColorModalSource === 'modExtra2' && modExtra2SelectedGroup && modExtra2SelectedBtn !== null) {
                    setModExtra2Tabs(prev => prev.map(t => {
                      if (t.id !== modExtra2ActiveTabId) return t;
                      const group = t.groups.find(g => g.id === modExtra2SelectedGroup);
                      return { ...t, groups: t.groups.map(g => {
                        if (g.id !== modExtra2SelectedGroup) return g;
                        const newBtns = [...g.buttons];
                        newBtns[modExtra2SelectedBtn] = { ...newBtns[modExtra2SelectedBtn], color: group?.color || 'bg-emerald-600' };
                        return { ...g, buttons: newBtns };
                      })};
                    }));
                  } else {
                    updateLayoutSetting('modifierDefaultColor', 'bg-gray-200');
                  }
                }}
                className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg transition-colors"
                title="Reset to default color"
              >
                Reset to Default
              </button>
              
              <button
                onClick={() => setShowModifierColorModal(false)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg transition-colors font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Category Color Modal */}
      {showCategoryColorModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                     <div className="bg-white rounded-lg p-6 w-auto max-w-[90vw] max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-800">Category Button Color</h3>
              <button onClick={() => setShowCategoryColorModal(false)} className="text-gray-600 hover:text-gray-800 text-2xl font-bold">×</button>
            </div>
            <div className="grid grid-cols-8 gap-x-1 gap-y-1 justify-center" style={{ gridTemplateColumns: 'repeat(8, max-content)' }}>
              {              [
                'bg-slate-500','bg-gray-500','bg-zinc-500','bg-neutral-500','bg-stone-500',
                'bg-red-500','bg-orange-500','bg-amber-500','bg-yellow-500','bg-lime-500',
                'bg-green-500','bg-emerald-500','bg-teal-500','bg-cyan-500','bg-sky-500',
                'bg-blue-500','bg-indigo-500','bg-violet-500','bg-purple-500','bg-fuchsia-500',
                'bg-pink-500','bg-rose-500',
                'bg-red-600','bg-orange-600','bg-amber-600','bg-yellow-600','bg-lime-600',
                'bg-green-600','bg-emerald-600','bg-teal-600','bg-cyan-600','bg-sky-600',
                'bg-blue-600','bg-indigo-600','bg-violet-600','bg-purple-600','bg-fuchsia-600',
                'bg-pink-600','bg-rose-600','bg-slate-600'
              ].map((color, idx) => {
                const isSelected = layoutSettings.categoryNormalColor === color;
                const selectedColor = color.replace(/-(?:300|400|500|600|700)/, '-600');
                return (
                  <button
                    key={color}
                    onClick={() => {
                      updateLayoutSetting('categoryNormalColor', color);
                      setShowCategoryColorModal(false);
                    }}
                    className={`w-12 h-12 rounded-lg transition-all ${(idx % 8 === 3) ? 'mr-6' : ''} ${isSelected ? `scale-110 shadow-lg ring-4 ring-blue-400 ${selectedColor}` : `hover:scale-105 ${color}`}`}
                    title={color.replace('bg-', '').replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}
      {/* Extra Button Color Modals */}
      {/* Bag Fee Color Modal */}
      {showBagFeeColorModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-auto max-w-[90vw] max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-800">Bag Fee Button Color</h3>
              <button onClick={() => setShowBagFeeColorModal(false)} className="text-gray-600 hover:text-gray-800 text-2xl font-bold">×</button>
            </div>
            <div className="mb-4">
              <div className="flex items-center space-x-3 mb-3">
                <div className={`w-8 h-8 rounded-lg ${bagFeeColor}`}></div>
                <span className="text-sm font-medium text-gray-800">{bagFeeColor.replace('bg-', '').replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
              </div>
            </div>
            <div className="grid grid-cols-8 gap-x-1 gap-y-2">
              {[
                'bg-slate-500','bg-gray-500','bg-zinc-500','bg-neutral-500','bg-stone-500',
                'bg-red-500','bg-orange-500','bg-amber-500','bg-yellow-500','bg-lime-500',
                'bg-green-500','bg-emerald-500','bg-teal-500','bg-cyan-500','bg-sky-500',
                'bg-blue-500','bg-indigo-500','bg-violet-500','bg-purple-500','bg-fuchsia-500',
                'bg-pink-500','bg-rose-500',
                'bg-red-600','bg-orange-600','bg-amber-600','bg-yellow-600','bg-lime-600',
                'bg-green-600','bg-emerald-600','bg-teal-600','bg-cyan-600','bg-sky-600',
                'bg-blue-600','bg-indigo-600','bg-violet-600','bg-purple-600','bg-fuchsia-600',
                'bg-pink-600','bg-rose-600','bg-slate-600'
              ].map((color, idx) => {
                const isSelected = bagFeeColor === color;
                const selectedColor = color.replace(/-(?:300|400|500|600|700)/, '-600');
                return (
                  <button
                    key={color}
                    onClick={() => setBagFeeColor(color)}
                    className={`w-12 h-12 rounded-lg transition-all ${(idx % 8 === 3) ? 'mr-6' : ''} ${isSelected ? `scale-110 shadow-lg ring-4 ring-blue-400 ${selectedColor}` : `hover:scale-105 ${color}`}`}
                    title={color.replace('bg-', '').replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  />
                );
              })}
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={() => setShowBagFeeColorModal(false)} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors font-medium">Close</button>
            </div>
          </div>
        </div>
      )}
      {/* Extra 2 Color Modal */}
      {showExtra2ColorModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-auto max-w-[90vw] max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-800">Extra Button Color</h3>
              <button onClick={() => setShowExtra2ColorModal(false)} className="text-gray-600 hover:text-gray-800 text-2xl font-bold">×</button>
            </div>
            <div className="mb-4">
              <div className="flex items-center space-x-3 mb-3">
                <div className={`w-8 h-8 rounded-lg ${extra2Color}`}></div>
                <span className="text-sm font-medium text-gray-800">{extra2Color.replace('bg-', '').replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
              </div>
            </div>
            <div className="grid grid-cols-8 gap-x-1 gap-y-2">
              {[
                'bg-slate-500','bg-gray-500','bg-zinc-500','bg-neutral-500','bg-stone-500',
                'bg-red-500','bg-orange-500','bg-amber-500','bg-yellow-500','bg-lime-500',
                'bg-green-500','bg-emerald-500','bg-teal-500','bg-cyan-500','bg-sky-500',
                'bg-blue-500','bg-indigo-500','bg-violet-500','bg-purple-500','bg-fuchsia-500',
                'bg-pink-500','bg-rose-500',
                'bg-red-600','bg-orange-600','bg-amber-600','bg-yellow-600','bg-lime-600',
                'bg-green-600','bg-emerald-600','bg-teal-600','bg-cyan-600','bg-sky-600',
                'bg-blue-600','bg-indigo-600','bg-violet-600','bg-purple-600','bg-fuchsia-600',
                'bg-pink-600','bg-rose-600','bg-slate-600'
              ].map((color, idx) => {
                const isSelected = extra2Color === color;
                const selectedColor = color.replace(/-(?:300|400|500|600|700)/, '-600');
                return (
                  <button
                    key={color}
                    onClick={() => setExtra2Color(color)}
                    className={`w-12 h-12 rounded-lg transition-all ${(idx % 8 === 3) ? 'mr-6' : ''} ${isSelected ? `scale-110 shadow-lg ring-4 ring-blue-400 ${selectedColor}` : `hover:scale-105 ${color}`}`}
                    title={color.replace('bg-', '').replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  />
                );
              })}
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={() => setShowExtra2ColorModal(false)} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors font-medium">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Extra 3 Color Modal */}
      {showExtra3ColorModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-auto max-w-[90vw] max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-800">Extra 3 Button Color</h3>
              <button onClick={() => setShowExtra3ColorModal(false)} className="text-gray-600 hover:text-gray-800 text-2xl font-bold">×</button>
            </div>
            <div className="mb-4">
              <div className="flex items-center space-x-3 mb-3">
                <div className={`w-8 h-8 rounded-lg ${extra3Color}`}></div>
                <span className="text-sm font-medium text-gray-800">{extra3Color.replace('bg-', '').replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
              </div>
            </div>
            <div className="grid grid-cols-8 gap-x-1 gap-y-2">
              {[
                'bg-slate-500','bg-gray-500','bg-zinc-500','bg-neutral-500','bg-stone-500',
                'bg-red-500','bg-orange-500','bg-amber-500','bg-yellow-500','bg-lime-500',
                'bg-green-500','bg-emerald-500','bg-teal-500','bg-cyan-500','bg-sky-500',
                'bg-blue-500','bg-indigo-500','bg-violet-500','bg-purple-500','bg-fuchsia-500',
                'bg-pink-500','bg-rose-500',
                'bg-red-600','bg-orange-600','bg-amber-600','bg-yellow-600','bg-lime-600',
                'bg-green-600','bg-emerald-600','bg-teal-600','bg-cyan-600','bg-sky-600',
                'bg-blue-600','bg-indigo-600','bg-violet-600','bg-purple-600','bg-fuchsia-600',
                'bg-pink-600','bg-rose-600','bg-slate-600'
              ].map((color, idx) => {
                const isSelected = extra3Color === color;
                const selectedColor = color.replace(/-(?:300|400|500|600|700)/, '-600');
                return (
                  <button
                    key={color}
                    onClick={() => setExtra3Color(color)}
                    className={`w-12 h-12 rounded-lg transition-all ${(idx % 8 === 3) ? 'mr-6' : ''} ${isSelected ? `scale-110 shadow-lg ring-4 ring-blue-400 ${selectedColor}` : `hover:scale-105 ${color}`}`}
                    title={color.replace('bg-', '').replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  />
                );
              })}
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={() => setShowExtra3ColorModal(false)} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors font-medium">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Item Extra 1 Settings Modal */}
      {showItemExtra1SettingsModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowItemExtra1SettingsModal(false)}>
          <div className="bg-gray-800 rounded-lg p-4 w-80" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-sm font-semibold text-white">Extra Button 1</h3>
              <button onClick={() => setShowItemExtra1SettingsModal(false)} className="text-gray-400 hover:text-white text-xl">×</button>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Name</label>
                  <input type="text" value={bagFeeButtonName} onChange={(e) => setBagFeeButtonName(e.target.value)} className="w-full text-xs px-2 py-1.5 rounded bg-gray-700 text-white border border-gray-600" placeholder="Bag Fee" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Amount ($)</label>
                  <input type="number" min="0" step="0.01" value={tableBagFeeValue} onChange={(e) => setTableBagFeeValue(Number(e.target.value||0))} className="w-full text-xs px-2 py-1.5 rounded bg-gray-700 text-white border border-gray-600" placeholder="0.00" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Color</label>
                  <button onClick={() => { setShowItemExtra1SettingsModal(false); setShowBagFeeColorModal(true); }} className={`w-full h-8 rounded border border-gray-600 ${bagFeeColor}`}></button>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Tax</label>
                  <select value={bagFeeTaxGroupId} onChange={(e) => setBagFeeTaxGroupId(e.target.value ? Number(e.target.value) : '')} className="w-full text-xs px-1 py-1.5 rounded bg-gray-700 text-white border border-gray-600">
                    <option value="">-</option>
                    {(Array.isArray(menuTaxes)?menuTaxes:[]).map((g:any) => (<option key={g.id} value={g.id}>{g.name || `G${g.id}`}</option>))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Printer</label>
                  <select value={bagFeePrinterGroupId} onChange={(e) => setBagFeePrinterGroupId(e.target.value)} className="w-full text-xs px-1 py-1.5 rounded bg-gray-700 text-white border border-gray-600">
                    <option value="">-</option>
                    {(Array.isArray(printerGroupsLibrary)?printerGroupsLibrary:[]).map((g:any) => (<option key={g.id || g.group_id || g.name} value={g.id || g.group_id || g.name}>{g.name || g.id}</option>))}
                  </select>
                </div>
              </div>
            </div>
            <button onClick={() => setShowItemExtra1SettingsModal(false)} className="w-full mt-3 bg-blue-600 hover:bg-blue-700 text-white text-xs py-1.5 rounded">OK</button>
          </div>
        </div>
      )}

      {/* Item Extra 2 Settings Modal */}
      {showItemExtra2SettingsModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowItemExtra2SettingsModal(false)}>
          <div className="bg-gray-800 rounded-lg p-4 w-80" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-sm font-semibold text-white">Extra Button 2</h3>
              <button onClick={() => setShowItemExtra2SettingsModal(false)} className="text-gray-400 hover:text-white text-xl">×</button>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Name</label>
                  <input type="text" value={extra2Name} onChange={(e) => setExtra2Name(e.target.value)} className="w-full text-xs px-2 py-1.5 rounded bg-gray-700 text-white border border-gray-600" placeholder="Extra" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Amount ($)</label>
                  <input type="number" min="0" step="0.01" value={extra2Amount} onChange={(e) => setExtra2Amount(Number(e.target.value||0))} className="w-full text-xs px-2 py-1.5 rounded bg-gray-700 text-white border border-gray-600" placeholder="0.00" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Color</label>
                  <button onClick={() => { setShowItemExtra2SettingsModal(false); setShowExtra2ColorModal(true); }} className={`w-full h-8 rounded border border-gray-600 ${extra2Color}`}></button>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Tax</label>
                  <select value={extra2TaxGroupId} onChange={(e) => setExtra2TaxGroupId(e.target.value ? Number(e.target.value) : '')} className="w-full text-xs px-1 py-1.5 rounded bg-gray-700 text-white border border-gray-600">
                    <option value="">-</option>
                    {(Array.isArray(menuTaxes)?menuTaxes:[]).map((g:any) => (<option key={g.id} value={g.id}>{g.name || `G${g.id}`}</option>))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Printer</label>
                  <select value={extra2PrinterGroupId} onChange={(e) => setExtra2PrinterGroupId(e.target.value)} className="w-full text-xs px-1 py-1.5 rounded bg-gray-700 text-white border border-gray-600">
                    <option value="">-</option>
                    {(Array.isArray(printerGroupsLibrary)?printerGroupsLibrary:[]).map((g:any) => (<option key={g.id || g.group_id || g.name} value={g.id || g.group_id || g.name}>{g.name || g.id}</option>))}
                  </select>
                </div>
              </div>
            </div>
            <button onClick={() => setShowItemExtra2SettingsModal(false)} className="w-full mt-3 bg-blue-600 hover:bg-blue-700 text-white text-xs py-1.5 rounded">OK</button>
          </div>
        </div>
      )}

      {/* Item Extra 3 Settings Modal */}
      {showItemExtra3SettingsModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowItemExtra3SettingsModal(false)}>
          <div className="bg-gray-800 rounded-lg p-4 w-80" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-sm font-semibold text-white">Extra Button 3</h3>
              <button onClick={() => setShowItemExtra3SettingsModal(false)} className="text-gray-400 hover:text-white text-xl">×</button>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Name</label>
                  <input type="text" value={extra3Name} onChange={(e) => setExtra3Name(e.target.value)} className="w-full text-xs px-2 py-1.5 rounded bg-gray-700 text-white border border-gray-600" placeholder="Extra 3" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Percent (%)</label>
                  <input type="number" min="0" step="0.1" value={extra3Amount} onChange={(e) => setExtra3Amount(Number(e.target.value||0))} className="w-full text-xs px-2 py-1.5 rounded bg-gray-700 text-white border border-gray-600" placeholder="10" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Color</label>
                  <button onClick={() => { setShowItemExtra3SettingsModal(false); setShowExtra3ColorModal(true); }} className={`w-full h-8 rounded border border-gray-600 ${extra3Color}`}></button>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Tax</label>
                  <select value={extra3TaxGroupId} onChange={(e) => setExtra3TaxGroupId(e.target.value ? Number(e.target.value) : '')} className="w-full text-xs px-1 py-1.5 rounded bg-gray-700 text-white border border-gray-600">
                    <option value="">-</option>
                    {(Array.isArray(menuTaxes)?menuTaxes:[]).map((g:any) => (<option key={g.id} value={g.id}>{g.name || `G${g.id}`}</option>))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Printer</label>
                  <select value={extra3PrinterGroupId} onChange={(e) => setExtra3PrinterGroupId(e.target.value)} className="w-full text-xs px-1 py-1.5 rounded bg-gray-700 text-white border border-gray-600">
                    <option value="">-</option>
                    {(Array.isArray(printerGroupsLibrary)?printerGroupsLibrary:[]).map((g:any) => (<option key={g.id || g.group_id || g.name} value={g.id || g.group_id || g.name}>{g.name || g.id}</option>))}
                  </select>
                </div>
              </div>
            </div>
            <button onClick={() => setShowItemExtra3SettingsModal(false)} className="w-full mt-3 bg-blue-600 hover:bg-blue-700 text-white text-xs py-1.5 rounded">OK</button>
          </div>
        </div>
      )}

      {/* Modifier Extra 1 Settings Modal */}
      {showModifierExtra1SettingsModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowModifierExtra1SettingsModal(false)}>
          <div className="bg-white rounded-2xl overflow-hidden shadow-2xl" style={{ width: '96%', maxWidth: '1200px', height: '96vh', transform: 'translateY(-50px)' }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex justify-between items-center px-5 py-3 bg-gradient-to-r from-blue-600 to-blue-500">
              <div className="flex items-center gap-3">
                <input type="text" value={modExtra1Name} onChange={(e) => setModExtra1Name(e.target.value)}
                  className="text-lg font-bold bg-white text-gray-800 px-3 py-1.5 rounded-lg border-2 border-blue-300 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400 w-56 cursor-text" placeholder="Button Name" />
                <span className="text-white/70 text-xs">✏️ Click to edit</span>
              </div>
              <button onClick={() => setShowModifierExtra1SettingsModal(false)} className="text-white/80 hover:text-white text-2xl font-light transition-colors">×</button>
            </div>
            <div className="flex h-[calc(100%-52px)]">
              {/* Left Panel - Groups & Buttons (75%) */}
              <div className="w-[75%] p-4 flex flex-col bg-gradient-to-b from-gray-50 to-white overflow-auto">
                {/* Tabs Row */}
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex gap-1.5 flex-1 overflow-x-auto pb-1">
                    {modExtra1Tabs.map((tab) => (
                      <div key={tab.id} onClick={() => { setModExtra1ActiveTabId(tab.id); setModExtra1SelectedGroup(null); setModExtra1SelectedBtn(null); }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg cursor-pointer text-sm whitespace-nowrap transition-all shadow-sm ${modExtra1ActiveTabId === tab.id ? 'bg-blue-600 text-white shadow-blue-200' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'}`}>
                        <span>{tab.name}</span>
                        {modExtra1Tabs.length > 1 && (
                          <button onClick={(e) => { e.stopPropagation(); setModExtra1Tabs(prev => prev.filter(t => t.id !== tab.id)); if (modExtra1ActiveTabId === tab.id) setModExtra1ActiveTabId(modExtra1Tabs[0]?.id || ''); }} className="text-red-400 hover:text-red-600 ml-1">×</button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button onClick={() => { const newId = `tab${Date.now()}`; setModExtra1Tabs(prev => [...prev, { id: newId, name: `Tab ${prev.length + 1}`, defaultColor: 'bg-indigo-600', groups: [defaultModExtraGroup('New Group')], gridCols: 6 }]); setModExtra1ActiveTabId(newId); }}
                    className="text-sm px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg shadow-sm transition-colors">+ Tab</button>
                </div>
                {/* Tab Settings */}
                <div className="flex gap-4 mb-3 items-center p-2 bg-white rounded-lg border border-gray-100 shadow-sm">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium text-gray-500">Tab:</label>
                    <input type="text" value={modExtra1Tabs.find(t => t.id === modExtra1ActiveTabId)?.name || ''} onChange={(e) => setModExtra1Tabs(prev => prev.map(t => t.id === modExtra1ActiveTabId ? { ...t, name: e.target.value } : t))}
                      className="text-sm px-2 py-1 rounded-md bg-gray-50 text-gray-800 border border-gray-200 w-28 focus:outline-none focus:ring-2 focus:ring-blue-300" />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium text-gray-500">Cols:</label>
                    <select value={modExtra1Tabs.find(t => t.id === modExtra1ActiveTabId)?.gridCols || 6}
                      onChange={(e) => setModExtra1Tabs(prev => prev.map(t => t.id === modExtra1ActiveTabId ? { ...t, gridCols: Number(e.target.value) } : t))}
                      className="text-sm px-2 py-1 rounded-md bg-gray-50 text-gray-800 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-300">
                      {[4,5,6,7,8].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <button onClick={() => { const activeTab = modExtra1Tabs.find(t => t.id === modExtra1ActiveTabId); if (activeTab) { setModExtra1Tabs(prev => prev.map(t => t.id === modExtra1ActiveTabId ? { ...t, groups: [...t.groups, defaultModExtraGroup('New Group', t.defaultColor || 'bg-indigo-600')] } : t)); } }}
                    className="text-xs px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg shadow-sm transition-colors ml-auto">+ Add Group</button>
                </div>
                {/* Groups & Buttons */}
                <div className="flex-1 overflow-auto space-y-4">
                  {(() => {
                    const activeTab = modExtra1Tabs.find(t => t.id === modExtra1ActiveTabId);
                    if (!activeTab) return null;
                    return activeTab.groups.map((group) => (
                      <div key={group.id} className="bg-white rounded-lg border border-gray-200 shadow-sm">
                        {/* Group Header */}
                        <div className={`flex items-center gap-2 px-3 py-2 border-b border-gray-100 ${modExtra1SelectedGroup === group.id && modExtra1SelectedBtn === null ? 'bg-yellow-50' : 'bg-gray-50'}`}>
                          <input type="text" value={group.name} onChange={(e) => setModExtra1Tabs(prev => prev.map(t => t.id === modExtra1ActiveTabId ? { ...t, groups: t.groups.map(g => g.id === group.id ? { ...g, name: e.target.value } : g) } : t))}
                            className="text-sm font-semibold text-gray-700 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-400 focus:outline-none px-1 py-0.5 flex-1"
                            onClick={() => { setModExtra1SelectedGroup(group.id); setModExtra1SelectedBtn(null); }} />
                          <button onClick={() => { setModExtra1SelectedGroup(group.id); setModExtra1SelectedBtn(null); setModifierColorModalSource('modExtra1Tab'); setShowModifierColorModal(true); }}
                            className={`w-6 h-6 rounded border-2 border-gray-300 hover:border-blue-400 transition-all ${group.color || 'bg-indigo-600'}`}
                            title="Group Color" />
                          <span className="text-xs text-gray-400">{group.buttons.length} items</span>
                          <button onClick={() => { const newBtn = defaultModExtraButton(group.color || 'bg-indigo-600'); setModExtra1Tabs(prev => prev.map(t => t.id === modExtra1ActiveTabId ? { ...t, groups: t.groups.map(g => g.id === group.id ? { ...g, buttons: [...g.buttons, newBtn] } : g) } : t)); }}
                            className="text-xs px-2 py-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded transition-colors">+ Button</button>
                          {activeTab.groups.length > 1 && (
                            <button onClick={() => setModExtra1DeleteConfirm({ groupId: group.id, groupName: group.name })}
                              className="text-xs px-2 py-1 text-red-500 hover:bg-red-50 rounded transition-colors">×</button>
                          )}
                        </div>
                        {/* Group Buttons */}
                        <div className="p-2">
                          {group.buttons.length === 0 ? (
                            <div className="text-xs text-gray-400 text-center py-4">No buttons. Click "+ Button" to add.</div>
                          ) : (
                            <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${activeTab.gridCols}, minmax(0, 1fr))` }}>
                              {group.buttons.map((btn, idx) => (
                                <button key={idx} onClick={() => { setModExtra1SelectedGroup(group.id); setModExtra1SelectedBtn(idx); }}
                                  className={`rounded-lg text-white font-medium transition-all shadow-sm flex flex-col items-center justify-center ${btn.enabled !== false ? (btn.color || group.color || 'bg-indigo-600') : 'bg-gray-400'} ${modExtra1SelectedGroup === group.id && modExtra1SelectedBtn === idx ? 'ring-2 ring-yellow-400 ring-offset-1 scale-105' : 'hover:opacity-90 hover:shadow-md'}`}
                                  style={{ height: '56px', fontSize: `${layoutSettings.modifierFontSize}px` }}>
                                  <span className="truncate w-full text-center px-1">{btn.name || `Btn ${idx + 1}`}</span>
                                  <span style={{ fontSize: `${Math.max(10, layoutSettings.modifierFontSize - 2)}px` }} className="opacity-90">${btn.amount.toFixed(2)}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </div>
              {/* Right Panel - Settings (25%) */}
              <div className="w-[25%] border-l border-gray-200 p-4 flex flex-col bg-gray-50">
                <div className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                  {modExtra1SelectedGroup && modExtra1SelectedBtn !== null ? 'Button Settings' : modExtra1SelectedGroup ? 'Group Settings' : 'Settings'}
                </div>
                {modExtra1SelectedGroup && modExtra1SelectedBtn !== null ? (
                  <div className="space-y-3">
                    {(() => {
                      const activeTab = modExtra1Tabs.find(t => t.id === modExtra1ActiveTabId);
                      const group = activeTab?.groups.find(g => g.id === modExtra1SelectedGroup);
                      if (!group || modExtra1SelectedBtn >= group.buttons.length) return null;
                      const btn = group.buttons[modExtra1SelectedBtn];
                      const updateBtn = (updates: Partial<ModExtraButton>) => {
                        setModExtra1Tabs(prev => prev.map(t => {
                          if (t.id !== modExtra1ActiveTabId) return t;
                          return { ...t, groups: t.groups.map(g => {
                            if (g.id !== modExtra1SelectedGroup) return g;
                            const newBtns = [...g.buttons];
                            newBtns[modExtra1SelectedBtn!] = { ...newBtns[modExtra1SelectedBtn!], ...updates };
                            return { ...g, buttons: newBtns };
                          })};
                        }));
                      };
                      return (
                        <>
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
                            <input type="text" value={btn.name} onChange={(e) => updateBtn({ name: e.target.value })} className="w-full text-sm px-2 py-1.5 rounded-lg bg-white text-gray-800 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-300" placeholder="Name" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Price</label>
                            <input type="number" min="0" step="0.01" value={btn.amount} onChange={(e) => updateBtn({ amount: Number(e.target.value || 0) })} className="w-full text-sm px-2 py-1.5 rounded-lg bg-white text-gray-800 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-300" placeholder="0" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Color</label>
                            <button
                              onClick={() => { setModifierColorModalSource('modExtra1'); setShowModifierColorModal(true); }}
                              className={`w-full h-10 rounded-lg border-2 border-gray-300 hover:border-blue-400 transition-all ${btn.color || 'bg-indigo-600'}`}
                              title="Click to select color"
                            />
                          </div>
                          <button onClick={() => { setModExtra1Tabs(prev => prev.map(t => { if (t.id !== modExtra1ActiveTabId) return t; return { ...t, groups: t.groups.map(g => { if (g.id !== modExtra1SelectedGroup) return g; return { ...g, buttons: g.buttons.filter((_, i) => i !== modExtra1SelectedBtn) }; })}; })); setModExtra1SelectedBtn(null); }}
                            className="w-full py-2 bg-red-100 text-red-600 hover:bg-red-200 rounded-lg text-xs font-medium transition-colors mt-2">Delete Button</button>
                        </>
                      );
                    })()}
                  </div>
                ) : modExtra1SelectedGroup ? (
                  <div className="space-y-3">
                    {(() => {
                      const activeTab = modExtra1Tabs.find(t => t.id === modExtra1ActiveTabId);
                      const group = activeTab?.groups.find(g => g.id === modExtra1SelectedGroup);
                      if (!group) return null;
                      return (
                        <>
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Group Name</label>
                            <input type="text" value={group.name} onChange={(e) => setModExtra1Tabs(prev => prev.map(t => t.id === modExtra1ActiveTabId ? { ...t, groups: t.groups.map(g => g.id === group.id ? { ...g, name: e.target.value } : g) } : t))}
                              className="w-full text-sm px-2 py-1.5 rounded-lg bg-white text-gray-800 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-300" placeholder="Group Name" />
                          </div>
                          <div className="text-xs text-gray-500">Buttons: {group.buttons.length}</div>
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="text-center text-gray-400">
                      <div className="text-3xl mb-2">👆</div>
                      <div className="text-sm">Select a group or button<br/>to edit</div>
                    </div>
                  </div>
                )}
                {/* Save Button */}
                <div className="mt-auto pt-3" style={{ marginBottom: '10px' }}>
                  <button onClick={() => setShowModifierExtra1SettingsModal(false)} className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors shadow-sm">
                    Save & Close
                  </button>
                </div>
              </div>
            </div>
            {/* Delete Confirm Popup */}
            {modExtra1DeleteConfirm && (
              <div className="absolute inset-0 bg-black/30 flex items-center justify-center z-10">
                <div className="bg-white rounded-xl shadow-2xl p-5 w-72 text-center">
                  <div className="text-red-500 text-3xl mb-2">⚠️</div>
                  <div className="text-gray-800 font-semibold mb-1">Delete Group</div>
                  <div className="text-sm text-gray-600 mb-4">
                    Are you sure you want to delete "<span className="font-medium">{modExtra1DeleteConfirm.groupName}</span>"?<br/>
                    <span className="text-red-500 text-xs">All buttons in this group will be deleted.</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setModExtra1DeleteConfirm(null)}
                      className="flex-1 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-medium transition-colors">Cancel</button>
                    <button onClick={() => { setModExtra1Tabs(prev => prev.map(t => t.id === modExtra1ActiveTabId ? { ...t, groups: t.groups.filter(g => g.id !== modExtra1DeleteConfirm.groupId) } : t)); setModExtra1DeleteConfirm(null); }}
                      className="flex-1 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors">Delete</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modifier Extra 2 Settings Modal */}
      {showModifierExtra2SettingsModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowModifierExtra2SettingsModal(false)}>
          <div className="bg-white rounded-2xl overflow-hidden shadow-2xl" style={{ width: '96%', maxWidth: '1200px', height: '96vh', transform: 'translateY(-50px)' }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex justify-between items-center px-5 py-3 bg-gradient-to-r from-emerald-600 to-emerald-500">
              <div className="flex items-center gap-3">
                <input type="text" value={modExtra2Name} onChange={(e) => setModExtra2Name(e.target.value)}
                  className="text-lg font-bold bg-white text-gray-800 px-3 py-1.5 rounded-lg border-2 border-emerald-300 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-yellow-400 w-56 cursor-text" placeholder="Button Name" />
                <span className="text-white/70 text-xs">✏️ Click to edit</span>
              </div>
              <button onClick={() => setShowModifierExtra2SettingsModal(false)} className="text-white/80 hover:text-white text-2xl font-light transition-colors">×</button>
            </div>
            <div className="flex h-[calc(100%-52px)]">
              {/* Left Panel - Groups & Buttons (75%) */}
              <div className="w-[75%] p-4 flex flex-col bg-gradient-to-b from-gray-50 to-white overflow-auto">
                {/* Tabs Row */}
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex gap-1.5 flex-1 overflow-x-auto pb-1">
                    {modExtra2Tabs.map((tab) => (
                      <div key={tab.id} onClick={() => { setModExtra2ActiveTabId(tab.id); setModExtra2SelectedGroup(null); setModExtra2SelectedBtn(null); }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg cursor-pointer text-sm whitespace-nowrap transition-all shadow-sm ${modExtra2ActiveTabId === tab.id ? 'bg-emerald-600 text-white shadow-emerald-200' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'}`}>
                        <span>{tab.name}</span>
                        {modExtra2Tabs.length > 1 && (
                          <button onClick={(e) => { e.stopPropagation(); setModExtra2Tabs(prev => prev.filter(t => t.id !== tab.id)); if (modExtra2ActiveTabId === tab.id) setModExtra2ActiveTabId(modExtra2Tabs[0]?.id || ''); }} className="text-red-400 hover:text-red-600 ml-1">×</button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button onClick={() => { const newId = `tab${Date.now()}`; setModExtra2Tabs(prev => [...prev, { id: newId, name: `Tab ${prev.length + 1}`, defaultColor: 'bg-emerald-600', groups: [defaultModExtraGroup('New Group')], gridCols: 6 }]); setModExtra2ActiveTabId(newId); }}
                    className="text-sm px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg shadow-sm transition-colors">+ Tab</button>
                </div>
                {/* Tab Settings */}
                <div className="flex gap-4 mb-3 items-center p-2 bg-white rounded-lg border border-gray-100 shadow-sm">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium text-gray-500">Tab:</label>
                    <input type="text" value={modExtra2Tabs.find(t => t.id === modExtra2ActiveTabId)?.name || ''} onChange={(e) => setModExtra2Tabs(prev => prev.map(t => t.id === modExtra2ActiveTabId ? { ...t, name: e.target.value } : t))}
                      className="text-sm px-2 py-1 rounded-md bg-gray-50 text-gray-800 border border-gray-200 w-28 focus:outline-none focus:ring-2 focus:ring-emerald-300" />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium text-gray-500">Cols:</label>
                    <select value={modExtra2Tabs.find(t => t.id === modExtra2ActiveTabId)?.gridCols || 6}
                      onChange={(e) => setModExtra2Tabs(prev => prev.map(t => t.id === modExtra2ActiveTabId ? { ...t, gridCols: Number(e.target.value) } : t))}
                      className="text-sm px-2 py-1 rounded-md bg-gray-50 text-gray-800 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-300">
                      {[4,5,6,7,8].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <button onClick={() => { const activeTab = modExtra2Tabs.find(t => t.id === modExtra2ActiveTabId); if (activeTab) { setModExtra2Tabs(prev => prev.map(t => t.id === modExtra2ActiveTabId ? { ...t, groups: [...t.groups, defaultModExtraGroup('New Group', t.defaultColor || 'bg-emerald-600')] } : t)); } }}
                    className="text-xs px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg shadow-sm transition-colors ml-auto">+ Add Group</button>
                </div>
                {/* Groups & Buttons */}
                <div className="flex-1 overflow-auto space-y-4">
                  {(() => {
                    const activeTab = modExtra2Tabs.find(t => t.id === modExtra2ActiveTabId);
                    if (!activeTab) return null;
                    return activeTab.groups.map((group) => (
                      <div key={group.id} className="bg-white rounded-lg border border-gray-200 shadow-sm">
                        {/* Group Header */}
                        <div className={`flex items-center gap-2 px-3 py-2 border-b border-gray-100 ${modExtra2SelectedGroup === group.id && modExtra2SelectedBtn === null ? 'bg-yellow-50' : 'bg-gray-50'}`}>
                          <input type="text" value={group.name} onChange={(e) => setModExtra2Tabs(prev => prev.map(t => t.id === modExtra2ActiveTabId ? { ...t, groups: t.groups.map(g => g.id === group.id ? { ...g, name: e.target.value } : g) } : t))}
                            className="text-sm font-semibold text-gray-700 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-emerald-400 focus:outline-none px-1 py-0.5 flex-1"
                            onClick={() => { setModExtra2SelectedGroup(group.id); setModExtra2SelectedBtn(null); }} />
                          <button onClick={() => { setModExtra2SelectedGroup(group.id); setModExtra2SelectedBtn(null); setModifierColorModalSource('modExtra2Tab'); setShowModifierColorModal(true); }}
                            className={`w-6 h-6 rounded border-2 border-gray-300 hover:border-emerald-400 transition-all ${group.color || 'bg-emerald-600'}`}
                            title="Group Color" />
                          <span className="text-xs text-gray-400">{group.buttons.length} items</span>
                          <button onClick={() => { const newBtn = defaultModExtraButton(group.color || 'bg-emerald-600'); setModExtra2Tabs(prev => prev.map(t => t.id === modExtra2ActiveTabId ? { ...t, groups: t.groups.map(g => g.id === group.id ? { ...g, buttons: [...g.buttons, newBtn] } : g) } : t)); }}
                            className="text-xs px-2 py-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded transition-colors">+ Button</button>
                          {activeTab.groups.length > 1 && (
                            <button onClick={() => setModExtra2DeleteConfirm({ groupId: group.id, groupName: group.name })}
                              className="text-xs px-2 py-1 text-red-500 hover:bg-red-50 rounded transition-colors">×</button>
                          )}
                        </div>
                        {/* Group Buttons */}
                        <div className="p-2">
                          {group.buttons.length === 0 ? (
                            <div className="text-xs text-gray-400 text-center py-4">No buttons. Click "+ Button" to add.</div>
                          ) : (
                            <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${activeTab.gridCols}, minmax(0, 1fr))` }}>
                              {group.buttons.map((btn, idx) => (
                                <button key={idx} onClick={() => { setModExtra2SelectedGroup(group.id); setModExtra2SelectedBtn(idx); }}
                                  className={`rounded-lg text-white font-medium transition-all shadow-sm flex flex-col items-center justify-center ${btn.enabled !== false ? (btn.color || group.color || 'bg-emerald-600') : 'bg-gray-400'} ${modExtra2SelectedGroup === group.id && modExtra2SelectedBtn === idx ? 'ring-2 ring-yellow-400 ring-offset-1 scale-105' : 'hover:opacity-90 hover:shadow-md'}`}
                                  style={{ height: '56px', fontSize: `${layoutSettings.modifierFontSize}px` }}>
                                  <span className="truncate w-full text-center px-1">{btn.name || `Btn ${idx + 1}`}</span>
                                  <span style={{ fontSize: `${Math.max(10, layoutSettings.modifierFontSize - 2)}px` }} className="opacity-90">${btn.amount.toFixed(2)}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </div>
              {/* Right Panel - Settings (25%) */}
              <div className="w-[25%] border-l border-gray-200 p-4 flex flex-col bg-gray-50">
                <div className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
                  {modExtra2SelectedGroup && modExtra2SelectedBtn !== null ? 'Button Settings' : modExtra2SelectedGroup ? 'Group Settings' : 'Settings'}
                </div>
                {modExtra2SelectedGroup && modExtra2SelectedBtn !== null ? (
                  <div className="space-y-3">
                    {(() => {
                      const activeTab = modExtra2Tabs.find(t => t.id === modExtra2ActiveTabId);
                      const group = activeTab?.groups.find(g => g.id === modExtra2SelectedGroup);
                      if (!group || modExtra2SelectedBtn >= group.buttons.length) return null;
                      const btn = group.buttons[modExtra2SelectedBtn];
                      const updateBtn = (updates: Partial<ModExtraButton>) => {
                        setModExtra2Tabs(prev => prev.map(t => {
                          if (t.id !== modExtra2ActiveTabId) return t;
                          return { ...t, groups: t.groups.map(g => {
                            if (g.id !== modExtra2SelectedGroup) return g;
                            const newBtns = [...g.buttons];
                            newBtns[modExtra2SelectedBtn!] = { ...newBtns[modExtra2SelectedBtn!], ...updates };
                            return { ...g, buttons: newBtns };
                          })};
                        }));
                      };
                      return (
                        <>
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
                            <input type="text" value={btn.name} onChange={(e) => updateBtn({ name: e.target.value })} className="w-full text-sm px-2 py-1.5 rounded-lg bg-white text-gray-800 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-300" placeholder="Name" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Price</label>
                            <input type="number" min="0" step="0.01" value={btn.amount} onChange={(e) => updateBtn({ amount: Number(e.target.value || 0) })} className="w-full text-sm px-2 py-1.5 rounded-lg bg-white text-gray-800 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-300" placeholder="0" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Color</label>
                            <button
                              onClick={() => { setModifierColorModalSource('modExtra2'); setShowModifierColorModal(true); }}
                              className={`w-full h-10 rounded-lg border-2 border-gray-300 hover:border-emerald-400 transition-all ${btn.color || 'bg-emerald-600'}`}
                              title="Click to select color"
                            />
                          </div>
                          <button onClick={() => { setModExtra2Tabs(prev => prev.map(t => { if (t.id !== modExtra2ActiveTabId) return t; return { ...t, groups: t.groups.map(g => { if (g.id !== modExtra2SelectedGroup) return g; return { ...g, buttons: g.buttons.filter((_, i) => i !== modExtra2SelectedBtn) }; })}; })); setModExtra2SelectedBtn(null); }}
                            className="w-full py-2 bg-red-100 text-red-600 hover:bg-red-200 rounded-lg text-xs font-medium transition-colors mt-2">Delete Button</button>
                        </>
                      );
                    })()}
                  </div>
                ) : modExtra2SelectedGroup ? (
                  <div className="space-y-3">
                    {(() => {
                      const activeTab = modExtra2Tabs.find(t => t.id === modExtra2ActiveTabId);
                      const group = activeTab?.groups.find(g => g.id === modExtra2SelectedGroup);
                      if (!group) return null;
                      return (
                        <>
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Group Name</label>
                            <input type="text" value={group.name} onChange={(e) => setModExtra2Tabs(prev => prev.map(t => t.id === modExtra2ActiveTabId ? { ...t, groups: t.groups.map(g => g.id === group.id ? { ...g, name: e.target.value } : g) } : t))}
                              className="w-full text-sm px-2 py-1.5 rounded-lg bg-white text-gray-800 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-300" placeholder="Group Name" />
                          </div>
                          <div className="text-xs text-gray-500">Buttons: {group.buttons.length}</div>
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="text-center text-gray-400">
                      <div className="text-3xl mb-2">👆</div>
                      <div className="text-sm">Select a group or button<br/>to edit</div>
                    </div>
                  </div>
                )}
                {/* Save Button */}
                <div className="mt-auto pt-3" style={{ marginBottom: '10px' }}>
                  <button onClick={() => setShowModifierExtra2SettingsModal(false)} className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors shadow-sm">
                    Save & Close
                  </button>
                </div>
              </div>
            </div>
            {/* Delete Confirm Popup */}
            {modExtra2DeleteConfirm && (
              <div className="absolute inset-0 bg-black/30 flex items-center justify-center z-10">
                <div className="bg-white rounded-xl shadow-2xl p-5 w-72 text-center">
                  <div className="text-red-500 text-3xl mb-2">⚠️</div>
                  <div className="text-gray-800 font-semibold mb-1">Delete Group</div>
                  <div className="text-sm text-gray-600 mb-4">
                    Are you sure you want to delete "<span className="font-medium">{modExtra2DeleteConfirm.groupName}</span>"?<br/>
                    <span className="text-red-500 text-xs">All buttons in this group will be deleted.</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setModExtra2DeleteConfirm(null)}
                      className="flex-1 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-medium transition-colors">Cancel</button>
                    <button onClick={() => { setModExtra2Tabs(prev => prev.map(t => t.id === modExtra2ActiveTabId ? { ...t, groups: t.groups.filter(g => g.id !== modExtra2DeleteConfirm.groupId) } : t)); setModExtra2DeleteConfirm(null); }}
                      className="flex-1 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors">Delete</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modifier Extra 1 Selection Popup (Sales Page) */}
      {showModExtra1Popup && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowModExtra1Popup(false)}>
          <div className="bg-white rounded-xl shadow-2xl overflow-hidden" style={{ width: '600px', maxHeight: '84vh', transform: 'translateY(-40px)' }} onClick={e => e.stopPropagation()}>
            <div className="bg-gradient-to-r from-blue-600 to-blue-500 px-4 py-3 flex justify-between items-center">
              <span className="text-white font-semibold">{modExtra1Name}</span>
              <button onClick={() => setShowModExtra1Popup(false)} className="text-white/80 hover:text-white text-xl">×</button>
            </div>
            <div className="p-3 overflow-auto" style={{ maxHeight: 'calc(84vh - 52px)' }}>
              {(() => {
                const activeTab = modExtra1Tabs.find(t => t.id === modExtra1ActiveTabId);
                if (!activeTab || !activeTab.groups) return <div className="text-gray-400 text-center py-8">No buttons configured</div>;
                return activeTab.groups.map((group) => (
                  <div key={group.id} className="mb-3">
                    <div className="text-xs font-semibold text-gray-500 mb-1 px-1">{group.name}</div>
                    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${activeTab.gridCols || 6}, minmax(0, 1fr))` }}>
                      {group.buttons.filter(btn => btn.enabled !== false).map((btn, idx) => (
                        <button key={idx} onClick={() => {
                          // Add modifier to selected item
                          const currentItem = selectedMenuItemId ? menuItems.find(m => m.id === selectedMenuItemId) : null;
                          if (!currentItem) return;
                          setOrderItems(prev => {
                            const itemIdx = prev.findIndex(oi => oi.id === currentItem.id && oi.guestNumber === activeGuestNumber);
                            if (itemIdx === -1) return prev;
                            const updated = [...prev];
                            const target: any = { ...updated[itemIdx] };
                            const mods = Array.isArray(target.modifiers) ? [...target.modifiers] : [];
                            const GROUP_ID = '__MOD_EXTRA1__';
                            const existing = mods.find((m: any) => m.groupId === GROUP_ID);
                            const newEntry = { id: `mod1-${Date.now()}-${Math.random().toString(36).slice(2,8)}`, name: btn.name || `Button ${idx + 1}`, price_delta: Number(btn.amount || 0) };
                            if (existing) {
                              const entries = Array.isArray(existing.selectedEntries) ? [...existing.selectedEntries, newEntry] : [newEntry];
                              const totalModifierPrice = entries.reduce((s: number, e: any) => s + (e.price_delta || 0), 0);
                              const merged = { ...existing, selectedEntries: entries, modifierNames: entries.map((e: any) => e.name), totalModifierPrice };
                              target.modifiers = mods.map((m: any) => (m.groupId === GROUP_ID ? merged : m));
                            } else {
                              const grp = { groupId: GROUP_ID, groupName: modExtra1Name, modifierIds: [], modifierNames: [btn.name || `Button ${idx + 1}`], selectedEntries: [newEntry], totalModifierPrice: Number(btn.amount || 0) } as any;
                              target.modifiers = [...mods, grp];
                            }
                            target.totalPrice = Number(((target.price || 0) + (target.modifiers || []).reduce((sum: number, m: any) => sum + (m.totalModifierPrice || 0), 0)).toFixed(2));
                            updated[itemIdx] = target;
                            return updated;
                          });
                          setShowModExtra1Popup(false);
                        }}
                          className={`${btn.color || 'bg-indigo-600'} text-white rounded-lg font-medium shadow-md hover:opacity-90 hover:shadow-lg transition-all flex flex-col items-center justify-center border border-white/20`}
                          style={{ 
                            height: '56px', 
                            fontSize: `${layoutSettings.modifierFontSize}px`,
                            backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.15), rgba(0,0,0,0.1))'
                          }}>
                          <span className="truncate w-full text-center px-1 font-semibold">{btn.name || `Button ${idx + 1}`}</span>
                          <span style={{ fontSize: `${Math.max(10, layoutSettings.modifierFontSize - 2)}px` }} className="opacity-80">${btn.amount.toFixed(2)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Modifier Extra 2 Selection Popup (Sales Page) */}
      {showModExtra2Popup && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowModExtra2Popup(false)}>
          <div className="bg-white rounded-xl shadow-2xl overflow-hidden" style={{ width: '600px', maxHeight: '84vh', transform: 'translateY(-40px)' }} onClick={e => e.stopPropagation()}>
            <div className="bg-gradient-to-r from-emerald-600 to-emerald-500 px-4 py-3 flex justify-between items-center">
              <span className="text-white font-semibold">{modExtra2Name}</span>
              <button onClick={() => setShowModExtra2Popup(false)} className="text-white/80 hover:text-white text-xl">×</button>
            </div>
            <div className="p-3 overflow-auto" style={{ maxHeight: 'calc(84vh - 52px)' }}>
              {(() => {
                const activeTab = modExtra2Tabs.find(t => t.id === modExtra2ActiveTabId);
                if (!activeTab || !activeTab.groups) return <div className="text-gray-400 text-center py-8">No buttons configured</div>;
                return activeTab.groups.map((group) => (
                  <div key={group.id} className="mb-3">
                    <div className="text-xs font-semibold text-gray-500 mb-1 px-1">{group.name}</div>
                    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${activeTab.gridCols || 6}, minmax(0, 1fr))` }}>
                      {group.buttons.filter(btn => btn.enabled !== false).map((btn, idx) => (
                        <button key={idx} onClick={() => {
                          // Add modifier to selected item
                          const currentItem = selectedMenuItemId ? menuItems.find(m => m.id === selectedMenuItemId) : null;
                          if (!currentItem) return;
                          setOrderItems(prev => {
                            const itemIdx = prev.findIndex(oi => oi.id === currentItem.id && oi.guestNumber === activeGuestNumber);
                            if (itemIdx === -1) return prev;
                            const updated = [...prev];
                            const target: any = { ...updated[itemIdx] };
                            const mods = Array.isArray(target.modifiers) ? [...target.modifiers] : [];
                            const GROUP_ID = '__MOD_EXTRA2__';
                            const existing = mods.find((m: any) => m.groupId === GROUP_ID);
                            const newEntry = { id: `mod2-${Date.now()}-${Math.random().toString(36).slice(2,8)}`, name: btn.name || `Button ${idx + 1}`, price_delta: Number(btn.amount || 0) };
                            if (existing) {
                              const entries = Array.isArray(existing.selectedEntries) ? [...existing.selectedEntries, newEntry] : [newEntry];
                              const totalModifierPrice = entries.reduce((s: number, e: any) => s + (e.price_delta || 0), 0);
                              const merged = { ...existing, selectedEntries: entries, modifierNames: entries.map((e: any) => e.name), totalModifierPrice };
                              target.modifiers = mods.map((m: any) => (m.groupId === GROUP_ID ? merged : m));
                            } else {
                              const grp = { groupId: GROUP_ID, groupName: modExtra2Name, modifierIds: [], modifierNames: [btn.name || `Button ${idx + 1}`], selectedEntries: [newEntry], totalModifierPrice: Number(btn.amount || 0) } as any;
                              target.modifiers = [...mods, grp];
                            }
                            target.totalPrice = Number(((target.price || 0) + (target.modifiers || []).reduce((sum: number, m: any) => sum + (m.totalModifierPrice || 0), 0)).toFixed(2));
                            updated[itemIdx] = target;
                            return updated;
                          });
                          setShowModExtra2Popup(false);
                        }}
                          className={`${btn.color || 'bg-emerald-600'} text-white rounded-lg font-medium shadow-md hover:opacity-90 hover:shadow-lg transition-all flex flex-col items-center justify-center border border-white/20`}
                          style={{ 
                            height: '56px', 
                            fontSize: `${layoutSettings.modifierFontSize}px`,
                            backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.15), rgba(0,0,0,0.1))'
                          }}>
                          <span className="truncate w-full text-center px-1 font-semibold">{btn.name || `Button ${idx + 1}`}</span>
                          <span style={{ fontSize: `${Math.max(10, layoutSettings.modifierFontSize - 2)}px` }} className="opacity-80">${btn.amount.toFixed(2)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Modifier Extra 1 Color Modal */}
      {showModExtra1ColorModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-auto max-w-[90vw] max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-800">Modifier Extra 1 Button Color</h3>
              <button onClick={() => setShowModExtra1ColorModal(false)} className="text-gray-600 hover:text-gray-800 text-2xl font-bold">×</button>
            </div>
            <div className="mb-4">
              <div className="flex items-center space-x-3 mb-3">
                <div className={`w-8 h-8 rounded-lg ${modExtra1Color}`}></div>
                <span className="text-sm font-medium text-gray-800">{modExtra1Color.replace('bg-', '').replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
              </div>
            </div>
            <div className="grid grid-cols-8 gap-x-1 gap-y-2">
              {[ 'bg-slate-500','bg-gray-500','bg-zinc-500','bg-neutral-500','bg-stone-500',
                 'bg-red-500','bg-orange-500','bg-amber-500','bg-yellow-500','bg-lime-500',
                 'bg-green-500','bg-emerald-500','bg-teal-500','bg-cyan-500','bg-sky-500',
                 'bg-blue-500','bg-indigo-500','bg-violet-500','bg-purple-500','bg-fuchsia-500',
                 'bg-pink-500','bg-rose-500',
                 'bg-red-600','bg-orange-600','bg-amber-600','bg-yellow-600','bg-lime-600',
                 'bg-green-600','bg-emerald-600','bg-teal-600','bg-cyan-600','bg-sky-600',
                 'bg-blue-600','bg-indigo-600','bg-violet-600','bg-purple-600','bg-fuchsia-600',
                 'bg-pink-600','bg-rose-600','bg-slate-600' ].map((color, idx) => {
                const isSelected = modExtra1Color === color;
                const selectedColor = color.replace(/-(?:300|400|500|600|700)/, '-600');
                return (
                  <button
                    key={color}
                    onClick={() => setModExtra1Color(color)}
                    className={`w-12 h-12 rounded-lg transition-all ${(idx % 8 === 3) ? 'mr-6' : ''} ${isSelected ? `scale-110 shadow-lg ring-4 ring-blue-400 ${selectedColor}` : `hover:scale-105 ${color}`}`}
                    title={color.replace('bg-', '').replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  />
                );
              })}
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={() => setShowModExtra1ColorModal(false)} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors font-medium">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Modifier Extra 2 Color Modal */}
      {showModExtra2ColorModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-auto max-w-[90vw] max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-800">Modifier Extra 2 Button Color</h3>
              <button onClick={() => setShowModExtra2ColorModal(false)} className="text-gray-600 hover:text-gray-800 text-2xl font-bold">×</button>
            </div>
            <div className="mb-4">
              <div className="flex items-center space-x-3 mb-3">
                <div className={`w-8 h-8 rounded-lg ${modExtra2Color}`}></div>
                <span className="text-sm font-medium text-gray-800">{modExtra2Color.replace('bg-', '').replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
              </div>
            </div>
            <div className="grid grid-cols-8 gap-x-1 gap-y-2">
              {[ 'bg-slate-500','bg-gray-500','bg-zinc-500','bg-neutral-500','bg-stone-500',
                 'bg-red-500','bg-orange-500','bg-amber-500','bg-yellow-500','bg-lime-500',
                 'bg-green-500','bg-emerald-500','bg-teal-500','bg-cyan-500','bg-sky-500',
                 'bg-blue-500','bg-indigo-500','bg-violet-500','bg-purple-500','bg-fuchsia-500',
                 'bg-pink-500','bg-rose-500',
                 'bg-red-600','bg-orange-600','bg-amber-600','bg-yellow-600','bg-lime-600',
                 'bg-green-600','bg-emerald-600','bg-teal-600','bg-cyan-600','bg-sky-600',
                 'bg-blue-600','bg-indigo-600','bg-violet-600','bg-purple-600','bg-fuchsia-600',
                 'bg-pink-600','bg-rose-600','bg-slate-600' ].map((color, idx) => {
                const isSelected = modExtra2Color === color;
                const selectedColor = color.replace(/-(?:300|400|500|600|700)/, '-600');
                return (
                  <button
                    key={color}
                    onClick={() => setModExtra2Color(color)}
                    className={`w-12 h-12 rounded-lg transition-all ${(idx % 8 === 3) ? 'mr-6' : ''} ${isSelected ? `scale-110 shadow-lg ring-4 ring-blue-400 ${selectedColor}` : `hover:scale-105 ${color}`}`}
                    title={color.replace('bg-', '').replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  />
                );
              })}
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={() => setShowModExtra2ColorModal(false)} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors font-medium">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Price Modal */}
      {showEditPriceModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg p-6 w-[720px] max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-800">Edit Price</h3>
              <button onClick={handleCancelEditPrice} className="text-gray-600 hover:text-gray-800 text-2xl font-bold">×</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-700 mb-1">New Price</label>
                <div className="relative">
                  <input
                    ref={editPriceInputRef}
                    value={newPrice}
                    onChange={(e) => setNewPrice(e.target.value.replace(/[^0-9.]/g, ''))}
                    inputMode="decimal"
                    type="text"
                    className="w-full border border-gray-300 rounded px-3 py-2 pr-12 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    placeholder="0.00"
                    onFocus={() => setSoftKbTarget('editPrice')}
                    onMouseDown={() => {
                      setSoftKbTarget('editPrice');
                      requestAnimationFrame(() => {
                        try {
                          editPriceInputRef.current?.focus();
                          const value = editPriceInputRef.current?.value || '';
                          editPriceInputRef.current?.setSelectionRange(value.length, value.length);
                        } catch {}
                      });
                    }}
                    onTouchStart={() => {
                      setSoftKbTarget('editPrice');
                      requestAnimationFrame(() => {
                        try {
                          editPriceInputRef.current?.focus();
                          const value = editPriceInputRef.current?.value || '';
                          editPriceInputRef.current?.setSelectionRange(value.length, value.length);
                        } catch {}
                      });
                    }}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-1 w-10 flex items-center justify-center text-gray-500 hover:text-gray-700"
                    onClick={() => {
                      setSoftKbTarget('editPrice');
                      try {
                        editPriceInputRef.current?.focus();
                        const value = editPriceInputRef.current?.value || '';
                        editPriceInputRef.current?.setSelectionRange(value.length, value.length);
                      } catch {}
                    }}
                    title="Open Keyboard"
                  >
                    <KeyboardIcon size={20} />
                  </button>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={handleCancelEditPrice} className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300 text-gray-800">Cancel</button>
                <button onClick={handleEditPrice} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white">Save</button>
              </div>
            </div>
          </div>
          
          {/* Virtual Keyboard for Edit Price Modal */}
          {softKbTarget === 'editPrice' && VirtualKeyboardComponent && (
            <KeyboardPortal>
              <VirtualKeyboardComponent
                open={true}
                title={''}
                bottomOffsetPx={kbBottomOffset}
                zIndex={2147483647}
                centerOffsetPx={60}
                languages={[]}
                currentLanguage={'EN'}
                onToggleLanguage={() => {}}
                displayText={String(newPrice || '')}
                onType={(k: string) => {
                  setNewPrice(prev => {
                    const base = String(prev || '');
                    const next = `${base}${k}`;
                    const sanitized = next.replace(/[^0-9.]/g, '');
                    const dotCount = (sanitized.match(/\./g) || []).length;
                    if (dotCount > 1) return base;
                    return sanitized;
                  });
                }}
                onBackspace={() => {
                  setNewPrice(prev => (prev ? String(prev).slice(0, -1) : ''));
                }}
                onClear={() => {
                  setNewPrice('');
                }}
                onEnter={() => {}}
                onTab={() => {}}
                onRequestClose={() => setSoftKbTarget(null)}
                keepOpen={true}
                showNumpad={true}
              />
            </KeyboardPortal>
          )}
        </div>
      )}

      {/* Item Discount Modal - Unified */}
      {showItemDiscountModal && (() => {
        const selectedItem = orderItems.find(item => item.id === selectedOrderItemId && ((item.guestNumber||1) === (selectedOrderGuestNumber||1)));
        const itemName = selectedItem?.name || 'Selected Item';
        const itemOriginalPrice = selectedItem ? ((selectedItem.totalPrice || selectedItem.price || 0) + ((selectedItem as any).memo?.price || 0)) * (selectedItem.quantity || 1) : 0;
        const inputVal = Number(itemDiscountValue || '0');
        const discountAmount = itemDiscountMode === 'percent' 
          ? (itemOriginalPrice * Math.min(inputVal, 100) / 100)
          : Math.min(inputVal, itemOriginalPrice);
        const finalPrice = Math.max(0, itemOriginalPrice - discountAmount);
        
        return (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl w-[520px] max-h-[95vh] overflow-hidden" style={{ transform: 'translateY(-70px)' }}>
              {/* Header */}
              <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-3 flex justify-between items-center">
                <h3 className="text-lg font-bold text-white">Item Discount</h3>
                <button onClick={handleCancelItemDiscount} className="text-white hover:text-gray-200 text-2xl font-bold leading-none">&times;</button>
              </div>
              
              {/* Item Info */}
              <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-700 truncate max-w-[280px]">{itemName}</span>
                  <span className="text-base font-bold text-gray-900">${itemOriginalPrice.toFixed(2)}</span>
                </div>
              </div>

              <div className="p-4 space-y-3">
                {/* Combined Display Area - Final Price (Left) + Discount (Right) */}
                <div className={`rounded-lg p-2 ${itemDiscountMode === 'percent' ? 'bg-blue-50 border border-blue-200' : 'bg-green-50 border border-green-200'}`}>
                  <div className="flex justify-between items-center">
                    <div className="text-center flex-1">
                      <div className="text-xs text-gray-500">Final Price</div>
                      <div className="text-lg font-bold text-gray-800">${finalPrice.toFixed(2)}</div>
                      <div className="text-gray-400 text-xs line-through">${itemOriginalPrice.toFixed(2)}</div>
                    </div>
                    <div className="border-l border-gray-300 h-10 mx-3"></div>
                    <div className="text-center flex-1">
                      <div className="text-xs text-gray-500">Discount</div>
                      <div className="text-lg font-bold" style={{ color: itemDiscountMode === 'percent' ? '#2563eb' : '#16a34a' }}>
                        {itemDiscountMode === 'percent' ? `${inputVal || 0}%` : `$${inputVal.toFixed(2)}`}
                      </div>
                      <div className="text-red-500 font-semibold text-xs">
                        -${discountAmount.toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Percent & Amount Presets - Side by Side */}
                <div className="flex gap-3">
                  {/* Percent Presets - Left */}
                  <div className="flex-1 bg-blue-50 rounded-lg p-3 border border-blue-200">
                    <div className="text-xs font-semibold text-blue-700 mb-2 flex items-center gap-1">
                      <span className="bg-blue-600 text-white px-2 py-0.5 rounded text-xs">%</span>
                      Percent
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[5, 10, 15, 20, 25, 30, 50, 75, 100].map(v => (
                        <button
                          key={`pct-${v}`}
                          onClick={() => { setItemDiscountMode('percent'); setItemDiscountValue(String(v)); }}
                          className={`py-3 rounded text-base font-semibold transition-all ${
                            itemDiscountMode === 'percent' && itemDiscountValue === String(v)
                              ? 'bg-blue-600 text-white shadow-md'
                              : 'bg-white hover:bg-blue-100 text-gray-700 border border-gray-300'
                          }`}
                        >
                          {v}%
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Amount Presets - Right */}
                  <div className="flex-1 bg-green-50 rounded-lg p-3 border border-green-200">
                    <div className="text-xs font-semibold text-green-700 mb-2 flex items-center gap-1">
                      <span className="bg-green-600 text-white px-2 py-0.5 rounded text-xs">$</span>
                      Amount
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[1, 2, 5, 10, 20, 25, 50, 100].map(v => (
                        <button
                          key={`amt-${v}`}
                          onClick={() => { setItemDiscountMode('amount'); setItemDiscountValue(String(v)); }}
                          className={`py-3 rounded text-base font-semibold transition-all ${
                            itemDiscountMode === 'amount' && itemDiscountValue === String(v)
                              ? 'bg-green-600 text-white shadow-md'
                              : 'bg-white hover:bg-green-100 text-gray-700 border border-gray-300'
                          }`}
                        >
                          ${v}
                        </button>
                      ))}
                      <button
                        onClick={() => { setItemDiscountMode('amount'); setItemDiscountValue(String(Number(itemOriginalPrice.toFixed(2)))); }}
                        className={`py-3 rounded text-base font-bold transition-all ${
                          itemDiscountMode === 'amount' && Number(itemDiscountValue) === Number(itemOriginalPrice.toFixed(2))
                            ? 'bg-yellow-500 text-white shadow-md'
                            : 'bg-yellow-400 hover:bg-yellow-500 text-white'
                        }`}
                      >
                        Full
                      </button>
                    </div>
                  </div>
                </div>

                {/* Numpad for Custom Input */}
                <div className="bg-gray-100 rounded-lg p-3">
                  <div className="grid grid-cols-5 gap-2">
                    {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '00', '.', '⌫', '%', '$'].map((key, idx) => {
                      const isPercent = key === '%';
                      const isDollar = key === '$';
                      const isBackspace = key === '⌫';
                      
                      return (
                        <button
                          key={key + idx}
                          onClick={() => {
                            if (key === '⌫') {
                              backspaceDiscountValue();
                            } else if (key === '00') {
                              appendDiscountDigit('0');
                              appendDiscountDigit('0');
                            } else if (key === '%') {
                              setItemDiscountMode('percent');
                            } else if (key === '$') {
                              setItemDiscountMode('amount');
                            } else {
                              appendDiscountDigit(key);
                            }
                          }}
                          className={`h-12 rounded font-semibold text-lg transition-all ${
                            isPercent
                              ? itemDiscountMode === 'percent'
                                ? 'bg-blue-600 text-white'
                                : 'bg-blue-100 hover:bg-blue-200 text-blue-700 border border-blue-300'
                              : isDollar
                                ? itemDiscountMode === 'amount'
                                  ? 'bg-green-600 text-white'
                                  : 'bg-green-100 hover:bg-green-200 text-green-700 border border-green-300'
                                : isBackspace
                                  ? 'bg-gray-300 hover:bg-gray-400 text-gray-700'
                                  : 'bg-white hover:bg-gray-200 text-gray-800 border border-gray-300'
                          }`}
                        >
                          {key}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3">
                  <button 
                    onClick={handleCancelItemDiscount} 
                    className="flex-1 py-3 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold transition-all text-base"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleApplyItemDiscount} 
                    className="flex-1 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-all text-base"
                  >
                    Apply Discount
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Item Memo Modal (reused module) */}
      {showItemMemoModal && (
        <DualFieldKeyboardModal
          isOpen={showItemMemoModal}
          title={'Item Memo'}
          field1={{ label: 'Memo', value: itemMemo, onChange: setItemMemo, mode: 'text', placeholder: 'Enter item memo' }}
          field2={{ label: 'Memo Price', value: itemMemoPrice, onChange: (v) => setItemMemoPrice(v), mode: 'numeric', placeholder: '0.00' }}
          onCancel={handleCancelItemMemo}
          onSave={handleSaveItemMemo}
          languages={(((layoutSettings as any).keyboardLanguages || []) as string[])}
          currentLanguage={kbLang}
          onToggleLanguage={(next: string) => setKbLang(next)}
          softKbTarget={softKbTarget === 'memo' ? 'f1' : (softKbTarget === 'memoPrice' ? 'f2' : null)}
          setSoftKbTarget={(target) => setSoftKbTarget(target === 'f1' ? 'memo' : target === 'f2' ? 'memoPrice' : null)}
          kbBottomOffset={kbBottomOffset}
          offsetYPx={200}
        />
      )}

      {/* Kitchen Note Modal (single-field) */}
      {showKitchenMemoModal && (
        <DualFieldKeyboardModal
          isOpen={showKitchenMemoModal}
          title={'Kitchen Note'}
          field1={{ label: 'Kitchen Note', value: kitchenMemo, onChange: setKitchenMemo, mode: 'text', placeholder: 'Type note for kitchen' }}
          onCancel={() => { setSoftKbTarget(null); setShowKitchenMemoModal(false); }}
          onSave={() => { setSoftKbTarget(null); handleSaveKitchenMemo(); }}
          languages={(((layoutSettings as any).keyboardLanguages || []) as string[])}
          currentLanguage={kbLang}
          onToggleLanguage={(next: string) => setKbLang(next)}
          softKbTarget={softKbTarget === 'kitchenMemo' ? 'f1' : null}
          setSoftKbTarget={(target) => setSoftKbTarget(target === 'f1' ? 'kitchenMemo' : null)}
          kbBottomOffset={kbBottomOffset}
        />
      )}

      {/* Print Bill Options Modal */}
      {showPrintBillModal && (
        <PrintBillModal
            onClose={() => setShowPrintBillModal(false)}
            onPrintAllDetails={async () => {
                await executePrintBill('ALL_DETAILS');
                setShowPrintBillModal(false);
                navigate('/sales', { replace: true });
            }}
            onPrintIndividualGuest={async (guestId) => {
                await executePrintBill('INDIVIDUAL_GUEST', guestId);
                // Don't close modal to allow printing other guests
            }}
            onPrintAllSeparateBills={async () => {
                await executePrintBill('ALL_SEPARATE');
                setShowPrintBillModal(false);
                navigate('/sales', { replace: true });
            }}
            guestIds={Array.from(guestIds)}
        />
      )}

      {/* Payment Complete Modal */}
      <PaymentCompleteModal
        isOpen={showPaymentCompleteModal}
        onClose={handlePaymentCompleteClose}
        mode={paymentCompleteData?.isPartialPayment ? 'full' : 'receiptOnly'}
        onAddTips={(receiptCount) => {
          setPendingReceiptCountForTip(receiptCount);
          setShowPaymentCompleteModal(false);
          setShowTipEntryModal(true);
        }}
        change={paymentCompleteData?.change || 0}
        total={paymentCompleteData?.total || 0}
        tip={paymentCompleteData?.tip || 0}
        payments={paymentCompleteData?.payments || []}
        hasCashPayment={paymentCompleteData?.hasCashPayment || false}
        isPartialPayment={paymentCompleteData?.isPartialPayment}
        currentGuestNumber={paymentCompleteData?.currentGuestNumber}
        allGuests={adhocSplitCount > 0 ? Array.from({ length: Math.max(1, adhocSplitCount) }, (_, i) => i + 1) : Array.from(guestIds)}
        paidGuests={Array.from(new Set([...persistedPaidGuests, ...(paymentCompleteData?.currentGuestNumber ? [paymentCompleteData.currentGuestNumber] : [])]))}
        onPrintReceipt={handlePartialPrintReceipt}
        onSelectGuest={handleGuestSelectFromModal}
        onBackToOrder={() => { setShowPaymentCompleteModal(false); setPaymentCompleteData(null); setShowPaymentModal(false); }}
        onAddCashTip={handleAddCashTip}
      />

      <TipEntryModal
        isOpen={showTipEntryModal}
        onClose={() => {
          setShowTipEntryModal(false);
          setShowPaymentCompleteModal(true);
        }}
        onSave={async (tipAmount) => {
          await handleAddCashTip(tipAmount);
          setShowTipEntryModal(false);
          await handlePaymentCompleteClose(pendingReceiptCountForTip);
        }}
      />

      {/* Discount Modal - Enhanced */}
      {showDiscountModal && (() => {
        const dcInputVal = discountInputMode === 'percent'
          ? Number(discountPercentage === 'Custom' ? customDiscountPercentage : discountPercentage?.replace('%','') || '0')
          : Number(discountAmountValue || '0');
        const dcDiscountAmount = discountInputMode === 'percent'
          ? (orderSubtotal * Math.min(dcInputVal, 100) / 100)
          : Math.min(dcInputVal, orderSubtotal);
        const dcFinalPrice = Math.max(0, orderSubtotal - dcDiscountAmount);
        
        return (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl w-[520px] max-h-[95vh] overflow-hidden" style={{ transform: 'translateY(-70px)' }}>
              {/* Header */}
              <div className="bg-gradient-to-r from-purple-600 to-purple-700 px-3 py-2 flex justify-between items-center">
                <h3 className="text-base font-bold text-white">Order Discount</h3>
                <button onClick={handleCancelDiscount} className="text-white hover:text-gray-200 text-xl font-bold leading-none">&times;</button>
              </div>
              
              {/* Order Subtotal Info */}
              <div className="bg-gray-50 px-3 py-1.5 border-b border-gray-200">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-medium text-gray-700">Order Subtotal</span>
                  <span className="text-sm font-bold text-gray-900">${orderSubtotal.toFixed(2)}</span>
                </div>
              </div>

              <div className="p-3 space-y-2">
                {/* Combined Display Area - Final Price (Left) + Discount (Right) */}
                <div className={`rounded-lg p-1 ${discountInputMode === 'percent' ? 'bg-blue-50 border border-blue-200' : 'bg-green-50 border border-green-200'}`}>
                  <div className="flex justify-between items-center">
                    <div className="text-center flex-1">
                      <div className="text-xs text-gray-500">Final Price</div>
                      <div className="text-base font-bold text-gray-800">${dcFinalPrice.toFixed(2)}</div>
                      <div className="text-gray-400 text-xs line-through">${orderSubtotal.toFixed(2)}</div>
                    </div>
                    <div className="border-l border-gray-300 h-8 mx-2"></div>
                    <div className="text-center flex-1">
                      <div className="text-xs text-gray-500">Discount</div>
                      <div className="text-base font-bold" style={{ color: discountInputMode === 'percent' ? '#2563eb' : '#16a34a' }}>
                        {discountInputMode === 'percent' ? `${dcInputVal || 0}%` : `$${dcInputVal.toFixed(2)}`}
                      </div>
                      <div className="text-red-500 font-semibold text-xs">
                        -${dcDiscountAmount.toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Discount Type */}
                <div className="grid grid-cols-4 gap-1">
                  {discountTypes.filter(type => type !== 'Custom').sort((a, b) => a.localeCompare(b)).map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setSelectedDiscountType(type)}
                      className={`h-10 px-1 rounded text-sm font-semibold text-center transition-all ${
                        selectedDiscountType === type
                          ? 'bg-purple-600 text-white shadow-md'
                          : 'bg-purple-50 text-gray-800 border border-purple-200 hover:bg-purple-100'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>

                {/* Percent & Amount Presets - Side by Side */}
                <div className="flex gap-2">
                  {/* Percent Presets - Left */}
                  <div className="flex-1 bg-blue-50 rounded-lg p-2 border border-blue-200">
                    <div className="text-xs font-semibold text-blue-700 mb-1 flex items-center gap-1">
                      <span className="bg-blue-600 text-white px-1.5 py-0.5 rounded text-xs">%</span>
                      Percent
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {[5, 10, 15, 20, 25, 30, 50, 75, 100].map(v => (
                        <button
                          key={`dc-pct-${v}`}
                          onClick={() => { setDiscountInputMode('percent'); setDiscountPercentage(`${v}%`); setCustomDiscountPercentage(''); }}
                          className={`h-10 rounded text-sm font-semibold transition-all ${
                            discountInputMode === 'percent' && discountPercentage === `${v}%`
                              ? 'bg-blue-600 text-white shadow-md'
                              : 'bg-blue-100 hover:bg-blue-200 text-gray-800 border border-blue-200'
                          }`}
                        >
                          {v}%
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Amount Presets - Right */}
                  <div className="flex-1 bg-green-50 rounded-lg p-2 border border-green-200">
                    <div className="text-xs font-semibold text-green-700 mb-1 flex items-center gap-1">
                      <span className="bg-green-600 text-white px-1.5 py-0.5 rounded text-xs">$</span>
                      Amount
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {[1, 2, 5, 10, 20, 25, 50, 100].map(v => (
                        <button
                          key={`dc-amt-${v}`}
                          onClick={() => { setDiscountInputMode('amount'); setDiscountAmountValue(String(v)); }}
                          className={`h-10 rounded text-sm font-semibold transition-all ${
                            discountInputMode === 'amount' && discountAmountValue === String(v)
                              ? 'bg-green-600 text-white shadow-md'
                              : 'bg-green-100 hover:bg-green-200 text-gray-800 border border-green-200'
                          }`}
                        >
                          ${v}
                        </button>
                      ))}
                      <button
                        onClick={() => { setDiscountInputMode('amount'); setDiscountAmountValue(String(Number(orderSubtotal.toFixed(2)))); }}
                        className={`h-10 rounded text-sm font-bold transition-all ${
                          discountInputMode === 'amount' && Number(discountAmountValue) === Number(orderSubtotal.toFixed(2))
                            ? 'bg-yellow-500 text-white shadow-md'
                            : 'bg-yellow-400 hover:bg-yellow-500 text-white'
                        }`}
                      >
                        Full
                      </button>
                    </div>
                  </div>
                </div>

                {/* Numpad for Custom Input */}
                <div className="bg-gray-100 rounded-lg p-2">
                  <div className="grid grid-cols-5 gap-1">
                    {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '00', '.', '⌫', '%', '$'].map((key, idx) => {
                      const isPercent = key === '%';
                      const isDollar = key === '$';
                      const isBackspace = key === '⌫';
                      
                      return (
                        <button
                          key={`dc-${key}-${idx}`}
                          onClick={() => {
                            if (key === '⌫') {
                              if (discountInputMode === 'percent') {
                                if (discountPercentage === 'Custom') {
                                  setCustomDiscountPercentage(prev => prev.slice(0, -1));
                                } else {
                                  setDiscountPercentage('');
                                }
                              } else {
                                setDiscountAmountValue(prev => prev.slice(0, -1));
                              }
                            } else if (key === '00') {
                              if (discountInputMode === 'percent') {
                                setDiscountPercentage('Custom');
                                setCustomDiscountPercentage(prev => prev + '00');
                              } else {
                                setDiscountAmountValue(prev => prev + '00');
                              }
                            } else if (key === '%') {
                              setDiscountInputMode('percent');
                            } else if (key === '$') {
                              setDiscountInputMode('amount');
                            } else if (key === '.') {
                              if (discountInputMode === 'amount' && !discountAmountValue.includes('.')) {
                                setDiscountAmountValue(prev => prev ? prev + '.' : '0.');
                              }
                            } else {
                              if (discountInputMode === 'percent') {
                                setDiscountPercentage('Custom');
                                setCustomDiscountPercentage(prev => prev + key);
                              } else {
                                setDiscountAmountValue(prev => prev + key);
                              }
                            }
                          }}
                          className={`h-10 rounded font-semibold text-base transition-all ${
                            isPercent
                              ? discountInputMode === 'percent'
                                ? 'bg-blue-600 text-white'
                                : 'bg-blue-100 hover:bg-blue-200 text-blue-700 border border-blue-300'
                              : isDollar
                                ? discountInputMode === 'amount'
                                  ? 'bg-green-600 text-white'
                                  : 'bg-green-100 hover:bg-green-200 text-green-700 border border-green-300'
                                : isBackspace
                                  ? 'bg-gray-300 hover:bg-gray-400 text-gray-700'
                                  : 'bg-white hover:bg-gray-200 text-gray-800 border border-gray-300'
                          }`}
                        >
                          {key}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2">
                  <button 
                    onClick={handleCancelDiscount} 
                    className="flex-1 py-2.5 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold transition-all text-sm"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleApplyDiscount} 
                    className="flex-1 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-semibold transition-all text-sm"
                  >
                    Apply Discount
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Custom Discount Modal */}
      {showCustomDiscountModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-800">Custom Discount</h3>
              <button onClick={handleCustomDiscountCancel} className="text-gray-600 hover:text-gray-800 text-3xl font-bold w-10 h-10 flex items-center justify-center">×</button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-700 mb-2">Enter Discount Percentage</label>
                <input
                  ref={customDiscountInputRef}
                  type="text"
                  value={customDiscountPercentage}
                  onChange={(e) => setCustomDiscountPercentage(e.target.value)}
                  onFocus={() => setSoftKbTarget('customDiscount')}
                  onMouseDown={() => setSoftKbTarget('customDiscount')}
                  onTouchStart={() => setSoftKbTarget('customDiscount')}
                  placeholder="Enter percentage (e.g., 12.5)"
                  className="w-full border border-gray-300 rounded px-3 py-2 text-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={handleCustomDiscountCancel} className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300 text-gray-800">Cancel</button>
                <button onClick={handleCustomDiscountSave} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom Discount Type Modal */}
      {showCustomTypeModal && (
        <DualFieldKeyboardModal
          isOpen={showCustomTypeModal}
          title={'Custom Discount Type'}
          field1={{ label: 'Discount Type', value: customTypeName, onChange: setCustomTypeName, mode: 'text', placeholder: 'e.g., Manager D/C' }}
          field2={{ label: 'Amount ($)', value: customTypeAmount, onChange: setCustomTypeAmount, mode: 'numeric', placeholder: '0.00' }}
          onCancel={() => { setSoftKbTarget(null); setShowCustomTypeModal(false); }}
          onSave={() => {
            const name = (customTypeName||'').trim();
            const amt = Number(customTypeAmount||'0');
            if (!name) { alert('Enter discount type.'); return; }
            if (!(amt>0)) { alert('Enter valid amount.'); return; }
            setSelectedDiscountType(name);
            setDiscountPercentage('Custom');
            setCustomDiscountPercentage(String(amt));
            setShowCustomTypeModal(false);
          }}
          languages={(((layoutSettings as any).keyboardLanguages || []) as string[])}
          currentLanguage={kbLang}
          onToggleLanguage={(next) => setKbLang(next)}
          softKbTarget={softKbTarget === 'customTypeF1' ? 'f1' : softKbTarget === 'customTypeF2' ? 'f2' : null}
          setSoftKbTarget={(t) => setSoftKbTarget(t === 'f1' ? 'customTypeF1' : t === 'f2' ? 'customTypeF2' : null)}
          offsetYPx={150}
        />
      )}

      {/* Sold Out Modal */}
      <SoldOutModal
        isOpen={showSoldOutModal}
        onClose={() => {
          setShowSoldOutModal(false);
          if (soldOutModeFromSales) {
            navigate('/sales', { replace: true });
          }
        }}
        menuId={menuId}
        apiUrl={API_URL}
        menuItems={menuItems.map(i => ({ id: i.id, name: i.name }))}
        onSoldOutChange={(items: Set<string>, times: Map<string, any>) => {
          // Only update if modal actually loaded data (prevent reset from empty initial state)
          if (items.size > 0 || soldOutItems.size === 0) {
            setSoldOutItems(items);
            setSoldOutTimes(times);
          }
        }}
        onEnterSoldOutMode={(durationType?: string) => {
          setSelectedSoldOutType(durationType || 'indefinite');
          setSoldOutMode(true);
          setShowSoldOutModal(false);
          // Immediately load sold out data to ensure menu grid shows correct state
          loadSoldOutFromServer(menuId);
        }}
        currentUser={currentUser}
      />

      {/* Gift Card Modal */}
      {showGiftCardModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-[480px] max-h-[90vh] overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-amber-500 to-amber-600 px-4 py-3 flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">Gift Card</h3>
              <button 
                onClick={() => { setShowGiftCardModal(false); resetGiftCardForm(); }} 
                className="text-white hover:text-gray-200 text-2xl font-bold leading-none"
              >
                &times;
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Mode Toggle */}
              <div className="flex gap-2">
                <button
                  onClick={() => { setGiftCardMode('sell'); setGiftCardBalance(null); setGiftCardError(''); }}
                  className={`flex-1 py-3 rounded-lg font-semibold transition-all ${
                    giftCardMode === 'sell'
                      ? 'bg-amber-500 text-white shadow-md'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Sell Gift Card
                </button>
                <button
                  onClick={() => { setGiftCardMode('balance'); setGiftCardError(''); }}
                  className={`flex-1 py-3 rounded-lg font-semibold transition-all ${
                    giftCardMode === 'balance'
                      ? 'bg-amber-500 text-white shadow-md'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Check Balance
                </button>
              </div>

              {/* Card Number Input - 4 groups of 4 digits */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Card Number</label>
                <div className="flex gap-2">
                  {[0, 1, 2, 3].map((idx) => (
                    <input
                      key={idx}
                      id={`gift-card-input-${idx}`}
                      type="text"
                      maxLength={4}
                      value={giftCardNumber[idx]}
                      onChange={(e) => handleGiftCardNumberChange(idx, e.target.value)}
                      className="flex-1 text-center text-lg font-mono border-2 border-gray-300 rounded-lg py-2 focus:border-amber-500 focus:outline-none"
                      placeholder="0000"
                    />
                  ))}
                </div>
              </div>

              {/* Balance Display (for balance mode) */}
              {giftCardMode === 'balance' && giftCardBalance !== null && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                  <div className="text-sm text-green-600 mb-1">Available Balance</div>
                  <div className="text-3xl font-bold text-green-700">${giftCardBalance.toFixed(2)}</div>
                </div>
              )}

              {/* Sell Mode Fields */}
              {giftCardMode === 'sell' && (
                <>
                  {/* Amount */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Amount</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-lg">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={giftCardAmount}
                        onChange={(e) => setGiftCardAmount(e.target.value)}
                        className="w-full pl-8 pr-3 py-2.5 text-lg border-2 border-gray-300 rounded-lg focus:border-amber-500 focus:outline-none"
                        placeholder="0.00"
                      />
                    </div>
                    {/* Quick Amount Buttons */}
                    <div className="flex gap-2 mt-2">
                      {[25, 50, 100, 200].map((amt) => (
                        <button
                          key={amt}
                          onClick={() => setGiftCardAmount(String(amt))}
                          className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                            giftCardAmount === String(amt)
                              ? 'bg-amber-500 text-white'
                              : 'bg-gray-100 text-gray-700 hover:bg-amber-100'
                          }`}
                        >
                          ${amt}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Payment Method */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Payment Method</label>
                    <div className="grid grid-cols-4 gap-2">
                      {(['Cash', 'Visa', 'MasterCard', 'Other'] as const).map((method) => (
                        <button
                          key={method}
                          onClick={() => setGiftCardPaymentMethod(method)}
                          className={`py-2.5 rounded-lg text-sm font-semibold transition-all ${
                            giftCardPaymentMethod === method
                              ? 'bg-amber-500 text-white shadow-md'
                              : 'bg-gray-100 text-gray-700 hover:bg-amber-100 border border-gray-200'
                          }`}
                        >
                          {method}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Customer Info */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Customer Name</label>
                      <input
                        type="text"
                        value={giftCardCustomerName}
                        onChange={(e) => setGiftCardCustomerName(e.target.value)}
                        className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:border-amber-500 focus:outline-none"
                        placeholder="Optional"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Phone Number</label>
                      <input
                        type="tel"
                        value={giftCardCustomerPhone}
                        onChange={(e) => setGiftCardCustomerPhone(e.target.value)}
                        className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:border-amber-500 focus:outline-none"
                        placeholder="Optional"
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Error Message */}
              {giftCardError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                  <div className="text-red-600 text-sm font-medium">{giftCardError}</div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => { setShowGiftCardModal(false); resetGiftCardForm(); }}
                  className="flex-1 py-3 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold transition-all"
                >
                  Cancel
                </button>
                {giftCardMode === 'sell' ? (
                  <button
                    onClick={handleSellGiftCard}
                    className="flex-1 py-3 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-semibold transition-all"
                  >
                    Sell Gift Card
                  </button>
                ) : (
                  <button
                    onClick={handleCheckGiftCardBalance}
                    className="flex-1 py-3 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-semibold transition-all"
                  >
                    Check Balance
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
        </>
      )}

    </div>
  );
};

// 🚀 React.memo로 불필요한 리렌더링 방지
export default React.memo(OrderPage);
