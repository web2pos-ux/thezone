import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../config/constants';
import ReservationCreateModal from '../components/reservations/ReservationCreateModal';
import WaitingListModal from '../components/waiting/WaitingListModal';
import VirtualKeyboard from '../components/order/VirtualKeyboard';
import ClockInOutButtons from '../components/ClockInOutButtons';
import PinInputModal from '../components/PinInputModal';
import clockInOutApi, { ClockedInEmployee } from '../services/clockInOutApi';
import { useMenuCache } from '../contexts/MenuCacheContext';
import { resolveMenuIdentifiers } from '../utils/menuIdentifier';
import { fetchMenuStructure } from '../utils/menuDataFetcher';
import { ensureOrderBootstrap } from '../utils/orderBootstrap';
import ServerSelectionModal from '../components/ServerSelectionModal';
import { clearServerAssignment } from '../utils/serverAssignmentStorage';
import { formatNameForDisplay, parseCustomerName } from '../utils/nameParser';
import { assignDailySequenceNumbers } from '../utils/orderSequence';
import { MoveMergeHistoryModal } from '../components/MoveMergeHistoryModal';
import { SimplePartialSelectionModal } from '../components/SimplePartialSelectionModal';
import { PartialSelectionPayload } from '../types/MoveMergeTypes';
import OnlineOrderPanel from '../components/OnlineOrderPanel';
import TablePaymentModal from '../components/PaymentModal';

interface TableElement {
  id: string;
  type: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  rotation: number;
  text: string;
  fontSize: number;
  color: string;
  status?: string;
  current_order_id?: number | null;
}

interface CustomerSuggestion {
  key: string;
  name: string;
  phone: string;
  phoneRaw: string;
  orders: any[];
}

interface HistoryOrderDetailPayload {
  order: any;
  items: any[];
  adjustments: any[];
}

type VirtualOrderChannel = 'togo' | 'online';

interface VirtualOrderMeta {
  virtualTableId: string;
  channel: VirtualOrderChannel;
}

type MoveEndpointKind = 'table' | 'virtual';

interface OnlineQueueCard {
  id: string;
  number: string | number;
  time: string;
  phone: string;
  name: string;
  items: string[];
  virtualChannel: VirtualOrderChannel;
  virtualTableId: string;
  fullOrder?: any; // 전체 주문 데이터 추가
  placedTime?: string | Date; // 주문 시간
  pickupTime?: string | Date | null; // 픽업 시간
  total?: number; // 총액
  sequenceNumber?: number; // 순서번호
  status?: string; // 주문 상태 (pending, confirmed, preparing, ready, completed, cancelled)
}

const VIRTUAL_TABLE_POOL: Record<VirtualOrderChannel, { prefix: string; limit: number }> = {
  togo: { prefix: 'TG', limit: 500 },
  online: { prefix: 'OL', limit: 500 },
};

const normalizeVirtualOrderChannel = (
  value?: string | null,
  fallback: VirtualOrderChannel = 'togo'
): VirtualOrderChannel => {
  if (!value) return fallback;
  const key = String(value).trim().toLowerCase();
  if (key === 'online' || key === 'web' || key === 'qr') return 'online';
  if (key === 'togo' || key === 'pickup' || key === 'takeout') return 'togo';
  return fallback;
};

const buildVirtualTableCode = (channel: VirtualOrderChannel, index: number) => {
  const { prefix } = VIRTUAL_TABLE_POOL[channel];
  return `${prefix}-${index.toString().padStart(4, '0')}`;
};

const allocateVirtualTableId = (channel: VirtualOrderChannel, used: Set<string>) => {
  const { limit, prefix } = VIRTUAL_TABLE_POOL[channel];
  for (let idx = 1; idx <= limit; idx += 1) {
    const candidate = buildVirtualTableCode(channel, idx);
    if (!used.has(candidate)) {
      return candidate;
    }
  }
  let fallbackIndex = limit + 1;
  let candidate = buildVirtualTableCode(channel, fallbackIndex);
  while (used.has(candidate)) {
    fallbackIndex += 1;
    candidate = buildVirtualTableCode(channel, fallbackIndex);
  }
  console.warn(`[VIRTUAL-ID] ${prefix} 풀 소진 - 임시 ID ${candidate} 사용`);
  return candidate;
};

const buildVirtualTableMeta = (
  orders: Array<{ id: string | number; channel?: VirtualOrderChannel; virtualTableId?: string | null }>,
  prevMeta: Record<string, VirtualOrderMeta>,
  defaultChannel: VirtualOrderChannel
) => {
  const used = new Set<string>();
  const next: Record<string, VirtualOrderMeta> = {};
  orders.forEach((order) => {
    const key = String(order.id);
    const channel = order.channel || defaultChannel;
    const serverProvidedId = typeof order.virtualTableId === 'string' && order.virtualTableId
      ? order.virtualTableId.trim().toUpperCase()
      : null;
    const existing = prevMeta?.[key]?.virtualTableId;
    let assign: string | null = null;
    if (serverProvidedId && !used.has(serverProvidedId)) {
      assign = serverProvidedId;
    } else if (existing && !used.has(existing)) {
      assign = existing;
    } else {
      assign = allocateVirtualTableId(channel, used);
    }
    used.add(assign);
    next[key] = { virtualTableId: assign, channel };
  });
  return next;
};

const createInitialOnlineQueueCards = (): OnlineQueueCard[] => {
  // 빈 배열로 시작 - 실제 데이터는 loadOnlineOrders에서 가져옴
  return [];
};

interface ScreenSize {
  width: number;
  height: number;
  scale: number;
}

const LAYOUT_SETTINGS_SNAPSHOT_KEY = 'orderLayout:layoutSettingsSnapshot';

const formatPickupDateLabel = (date = new Date()) => {
  const month = date.toLocaleString('en-US', { month: 'short' });
  const day = date.getDate().toString().padStart(2, '0');
  const weekday = date.toLocaleString('en-US', { weekday: 'short' });
  return `${month}-${day} (${weekday})`;
};

const getCurrentAmPm = () => (new Date().getHours() >= 12 ? 'PM' : 'AM');

const formatMinutesToTime = (minutes: number) => {
  const normalized = Math.max(0, minutes);
  const hrs = Math.floor(normalized / 60) % 24;
  const mins = normalized % 60;
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
};

const SalesPage: React.FC = () => {
  const [tableElements, setTableElements] = useState<TableElement[]>([]);
  const [screenSize, setScreenSize] = useState({ width: '1024', height: '768', scale: 1 });
  const [loading, setLoading] = useState(true);
  const [frameReady, setFrameReady] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  // Floor 관련 상태
  const [selectedFloor, setSelectedFloor] = useState('1F');
  const [floorList, setFloorList] = useState<string[]>([]);
  const [firstElementColors, setFirstElementColors] = useState<{ [key: string]: string }>({});
  const [pressedTableId, setPressedTableId] = useState<string | null>(null);
  const [pressedButton, setPressedButton] = useState<string | null>(null);
  const [tableOccupiedTimes, setTableOccupiedTimes] = useState<Record<string, number>>({});
  const [tableReservationNames, setTableReservationNames] = useState<Record<string, string>>({});

  const persistOccupiedTimes = useCallback(
    (next: Record<string, number>) => {
      try {
        localStorage.setItem(`occupiedTimes_${selectedFloor}`, JSON.stringify(next));
      } catch {}
      return next;
    },
    [selectedFloor]
  );

  const setOccupiedTimestamp = useCallback(
    (tableId: string | number | null | undefined, timestamp: number | null | undefined) => {
      if (!tableId || typeof timestamp !== 'number' || Number.isNaN(timestamp)) return;
      setTableOccupiedTimes((prev) => {
        const key = String(tableId);
        if (prev[key] === timestamp) return prev;
        const next = { ...prev, [key]: timestamp };
        return persistOccupiedTimes(next);
      });
    },
    [persistOccupiedTimes]
  );

  const clearOccupiedTimestamp = useCallback(
    (tableId: string | number | null | undefined) => {
      if (!tableId) return;
      setTableOccupiedTimes((prev) => {
        const key = String(tableId);
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return persistOccupiedTimes(next);
      });
    },
    [persistOccupiedTimes]
  );

  const transferOccupiedTimestamp = useCallback(
    (
      fromId: string | number | null | undefined,
      toId: string | number | null | undefined,
      fallbackTimestamp?: number
    ) => {
      if (!toId) return;
      setTableOccupiedTimes((prev) => {
        const next = { ...prev };
        const toKey = String(toId);
        let timestamp =
          typeof fallbackTimestamp === 'number' && !Number.isNaN(fallbackTimestamp)
            ? fallbackTimestamp
            : undefined;
        if (fromId != null) {
          const fromKey = String(fromId);
          if (typeof next[fromKey] === 'number') {
            timestamp = next[fromKey];
          }
          delete next[fromKey];
        }
        if (typeof timestamp === 'number') {
          next[toKey] = timestamp;
        } else {
          delete next[toKey];
        }
        return persistOccupiedTimes(next);
      });
    },
    [persistOccupiedTimes]
  );
  const [selectedChannelTab, setSelectedChannelTab] = useState<string>('table-map');
  const [togoSearch, setTogoSearch] = useState<string>('');
  const [togoSort, setTogoSort] = useState<'time' | 'number'>('time');
  const [togoDir, setTogoDir] = useState<'asc' | 'desc'>('asc');
  const [togoStaleMinutes, setTogoStaleMinutes] = useState<number>(10);
  const [softKbOpen, setSoftKbOpen] = useState(false);
  const [kbLang, setKbLang] = useState<string>('EN');
  const [refreshOrdersTrigger, setRefreshOrdersTrigger] = useState(0);

  // Reservation modal state
  const [showReservationModal, setShowReservationModal] = useState<boolean>(false);
  const [showWaitingModal, setShowWaitingModal] = useState<boolean>(false);
  const [selectedWaitingEntry, setSelectedWaitingEntry] = useState<any|null>(null);
  
  // Online Order Panel state
  const [showOnlineOrderPanel, setShowOnlineOrderPanel] = useState<boolean>(false);
  const [onlineOrderRestaurantId, setOnlineOrderRestaurantId] = useState<string | null>(
    localStorage.getItem('firebaseRestaurantId')
  );

  // Online/Togo Order Detail Modal state (개별 카드 클릭 시)
  const [showOrderDetailModal, setShowOrderDetailModal] = useState<boolean>(false);
  const [selectedOrderDetail, setSelectedOrderDetail] = useState<any | null>(null);
  const [selectedOrderType, setSelectedOrderType] = useState<'online' | 'togo' | null>(null);

  // Online/Togo 결제 모달 state
  const [showOnlineTogoPaymentModal, setShowOnlineTogoPaymentModal] = useState<boolean>(false);
  const [onlineTogoPaymentOrder, setOnlineTogoPaymentOrder] = useState<any | null>(null);
  
  // 결제 완료 후 Pickup Complete 확인 모달
  const [showPickupConfirmModal, setShowPickupConfirmModal] = useState<boolean>(false);
  const [pickupConfirmOrder, setPickupConfirmOrder] = useState<any | null>(null);
  
  // UNPAID 주문 Pickup 시도 시 확인 모달
  const [showUnpaidPickupModal, setShowUnpaidPickupModal] = useState<boolean>(false);
  const [unpaidPickupOrder, setUnpaidPickupOrder] = useState<any | null>(null);

  // Clock In/Out modal state
  const [showClockInOutMenu, setShowClockInOutMenu] = useState<boolean>(false);
  const [showClockInModal, setShowClockInModal] = useState<boolean>(false);
  const [showClockOutModal, setShowClockOutModal] = useState<boolean>(false);
  const [clockError, setClockError] = useState<string>('');
  const [isClockLoading, setIsClockLoading] = useState<boolean>(false);
  const [selectedEmployee, setSelectedEmployee] = useState<{ id: string; name: string; } | null>(null);
  const [earlyOutReason, setEarlyOutReason] = useState('');
  const [approvedBy, setApprovedBy] = useState('');
  const [showEarlyOutModal, setShowEarlyOutModal] = useState(false);

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
  const [giftCardInputFocus, setGiftCardInputFocus] = useState<'card' | 'amount' | 'pin'>('card');
  const [showGiftCardNameKeyboard, setShowGiftCardNameKeyboard] = useState(false);
  const [showGiftCardSoldPopup, setShowGiftCardSoldPopup] = useState(false);
  const [giftCardSellerPin, setGiftCardSellerPin] = useState('');
  const [giftCardIsReload, setGiftCardIsReload] = useState(false);
  const [giftCardExistingBalance, setGiftCardExistingBalance] = useState<number | null>(null);
  const [showGiftCardReloadPopup, setShowGiftCardReloadPopup] = useState(false);

  // Refund States
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundStep, setRefundStep] = useState<'list' | 'detail' | 'card_input' | 'giftcard_input' | 'confirm'>('list');
  const [refundPaidOrders, setRefundPaidOrders] = useState<any[]>([]);
  const [refundSelectedOrder, setRefundSelectedOrder] = useState<any | null>(null);
  const [refundOrderItems, setRefundOrderItems] = useState<any[]>([]);
  const [refundPayments, setRefundPayments] = useState<any[]>([]);
  const [refundSelectedItems, setRefundSelectedItems] = useState<{ [key: number]: number }>({});
  const [refundType, setRefundType] = useState<'FULL' | 'PARTIAL'>('FULL');
  const [refundPin, setRefundPin] = useState('');
  const [refundPinError, setRefundPinError] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundCardNumber, setRefundCardNumber] = useState('');
  const [refundApprovalNumber, setRefundApprovalNumber] = useState('');
  const [refundGiftCardNumber, setRefundGiftCardNumber] = useState('');
  const [refundPendingData, setRefundPendingData] = useState<any>(null);
  const [refundLoading, setRefundLoading] = useState(false);
  const [refundSearchDate, setRefundSearchDate] = useState(new Date().toISOString().split('T')[0]);
  const [refundSearchText, setRefundSearchText] = useState('');
  const [showRefundSuccessPopup, setShowRefundSuccessPopup] = useState(false);
  const [refundResult, setRefundResult] = useState<any | null>(null);
  const [showRefundCalendar, setShowRefundCalendar] = useState(false);
  const [refundCalendarMonth, setRefundCalendarMonth] = useState(new Date());
  const [refundTaxRate, setRefundTaxRate] = useState<number>(0);

  // Move/Merge mode state (Restored from Backup)
  const [isMoveMergeMode, setIsMoveMergeMode] = useState<boolean>(false);
  const [sourceTableId, setSourceTableId] = useState<string | null>(null);
  const [sourceTogoOrder, setSourceTogoOrder] = useState<any | null>(null); // Togo → Togo 머지용
  const [sourceOnlineOrder, setSourceOnlineOrder] = useState<any | null>(null); // Online → Togo 머지용
  const [moveMergeStatus, setMoveMergeStatus] = useState<string>('');
  const [sourceSelectionInfo, setSourceSelectionInfo] = useState<{ tableId: string; label: string; orderId?: number | string | null } | null>(null);
  const [selectionChoice, setSelectionChoice] = useState<'ALL' | PartialSelectionPayload | null>(null);
  const [isSelectionModalOpen, setIsSelectionModalOpen] = useState(false);
  const [showMoveHistory, setShowMoveHistory] = useState(false);

  // Print Bill mode state
  const [isBillPrintMode, setIsBillPrintMode] = useState<boolean>(false);
  const [billPrintStatus, setBillPrintStatus] = useState<string>('');

  // Prep Time modal state
  const [showPrepTimeModal, setShowPrepTimeModal] = useState<boolean>(false);
  const [prepTimeSettings, setPrepTimeSettings] = useState<{
    thezoneorder: { mode: 'auto' | 'manual'; time: string };
    ubereats: { mode: 'auto' | 'manual'; time: string };
    doordash: { mode: 'auto' | 'manual'; time: string };
    skipthedishes: { mode: 'auto' | 'manual'; time: string };
  }>(() => {
    // Load saved settings from localStorage on init
    const saved = localStorage.getItem('prepTimeSettings');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.warn('Failed to parse prepTimeSettings from localStorage');
      }
    }
    return {
      thezoneorder: { mode: 'auto', time: '15m' },
      ubereats: { mode: 'auto', time: '15m' },
      doordash: { mode: 'auto', time: '15m' },
      skipthedishes: { mode: 'auto', time: '15m' },
    };
  });

  // 새 온라인 주문 알림 모달 상태
  const [showNewOrderAlert, setShowNewOrderAlert] = useState<boolean>(false);
  const [newOrderAlertData, setNewOrderAlertData] = useState<any>(null);
  const [selectedPrepTime, setSelectedPrepTime] = useState<number>(20);
  const previousOnlineOrdersRef = useRef<string[]>([]);

  // Order List modal state
  const [showOrderListModal, setShowOrderListModal] = useState<boolean>(false);
  const [orderListDate, setOrderListDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [orderListOrders, setOrderListOrders] = useState<any[]>([]);
  const [orderListSelectedOrder, setOrderListSelectedOrder] = useState<any | null>(null);
  const [orderListSelectedItems, setOrderListSelectedItems] = useState<any[]>([]);
  const [orderListLoading, setOrderListLoading] = useState<boolean>(false);
  const [showOrderListCalendar, setShowOrderListCalendar] = useState<boolean>(false);
  const [orderListCalendarMonth, setOrderListCalendarMonth] = useState<Date>(new Date());
  
  // Order List modal scroll refs
  const orderListScrollRef = useRef<HTMLDivElement>(null);
  const orderDetailScrollRef = useRef<HTMLDivElement>(null);

  const clearMoveMergeSelection = useCallback(() => {
    setSourceTableId(null);
    setSourceTogoOrder(null);
    setSourceOnlineOrder(null);
    setSourceSelectionInfo(null);
    setSelectionChoice(null);
    setIsSelectionModalOpen(false);
    setMoveMergeStatus('');
  }, []);

  const beginSourceSelection = useCallback(async (element: TableElement, label: string) => {
    setSourceSelectionInfo({
      tableId: String(element.id),
      label,
      orderId: element.current_order_id || undefined,
    });
    if (element.current_order_id) {
      // 스플릿 여부 확인 - guest_number가 1개만 있으면 스플릿되지 않은 것
      try {
        const res = await fetch(`${API_URL}/orders/${element.current_order_id}`);
        const data = await res.json();
        if (data.success && Array.isArray(data.items)) {
          const guestNumbers = new Set(data.items.map((item: any) => Number(item.guest_number) || 1));
          if (guestNumbers.size <= 1) {
            // 스플릿되지 않음 - 바로 ALL 선택
            setSelectionChoice('ALL');
            setMoveMergeStatus(`✓ [전체 이동] ${label} → 목적지를 선택하세요`);
            return;
          }
        }
      } catch (e) {
        console.error('Failed to check split status:', e);
      }
      // 스플릿됨 - 모달 표시
      setSelectionChoice(null);
      setIsSelectionModalOpen(true);
      setMoveMergeStatus('이동할 게스트/아이템을 선택하세요.');
    } else {
      setSelectionChoice('ALL');
      setMoveMergeStatus('목적 테이블을 선택하세요');
    }
  }, []);

  useEffect(() => {
    if (!isMoveMergeMode) {
      clearMoveMergeSelection();
    }
  }, [isMoveMergeMode, clearMoveMergeSelection]);

  // Front-office default order setup (menu)
  const [defaultMenu, setDefaultMenu] = useState<{ menuId: number | null; menuName: string }>(() => {
    const saved = localStorage.getItem('foh_default_menu');
    if (saved) {
      try { return JSON.parse(saved); } catch {}
    }
    return { menuId: null, menuName: '' };
  });
  const menuCache = useMenuCache();
  const prefetchWorkerRef = useRef<Worker | null>(null);
  const idlePrefetchHandleRef = useRef<number | null>(null);
  useEffect(() => {
    if (!defaultMenu.menuId) return;
    ensureOrderBootstrap(defaultMenu.menuId, 'pos').catch(err => {
      console.warn('Order bootstrap prefetch failed:', err);
    });
  }, [defaultMenu.menuId]);

  useEffect(() => {
    let cancelled = false;

    const applySelectServerSetting = (raw: any) => {
      if (cancelled) return;
      try {
        const nextValue = raw?.selectServerOnEntry;
        setSelectServerPromptEnabled(nextValue !== false);
      } catch (error) {
        console.warn('Failed to parse selectServerOnEntry flag:', error);
      }
    };

    const ensureLayoutSnapshot = async () => {
      if (typeof window === 'undefined') return;
      try {
        const existing = sessionStorage.getItem(LAYOUT_SETTINGS_SNAPSHOT_KEY);
        if (existing) {
          try {
            const parsed = JSON.parse(existing);
            if (parsed && typeof parsed === 'object') {
              applySelectServerSetting(parsed);
            }
          } catch (error) {
            console.warn('Failed to parse cached layout settings snapshot:', error);
          }
          return;
        }
        const res = await fetch(`${API_URL}/layout-settings`, { cache: 'no-store' as RequestCache });
        if (!res.ok) return;
        const json = await res.json();
        const payload = (json && typeof json === 'object' && json.data) ? json.data : json;
        if (!payload || typeof payload !== 'object') return;
        if (cancelled) return;
        sessionStorage.setItem(LAYOUT_SETTINGS_SNAPSHOT_KEY, JSON.stringify(payload));
        applySelectServerSetting(payload);
      } catch (error) {
        console.warn('Failed to prefetch layout settings:', error);
      }
    };
    ensureLayoutSnapshot();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const loadDefaultSetup = async () => {
      try {
        // Use saved if present; otherwise fetch the latest POS setup
        if (defaultMenu.menuId) return;
        const res = await fetch(`${API_URL}/order-page-setups/type/pos`);
        if (!res.ok) return;
        const json = await res.json();
        const rows = Array.isArray(json?.data) ? json.data : [];
        if (rows.length > 0) {
          const { menuId, menuName } = rows[0];
          const payload = { menuId: Number(menuId), menuName: String(menuName || '') };
          setDefaultMenu(payload);
          localStorage.setItem('foh_default_menu', JSON.stringify(payload));
        }
      } catch (e) {
        // ignore; FOH can still navigate but OrderPage will show empty without menuId
      }
    };
    loadDefaultSetup();
  }, []);

  useEffect(() => {
    if (menuCache.isReady || menuCache.isLoading) return;

    let cancelled = false;

    const startPrefetch = async () => {
      if (cancelled || menuCache.isReady) return;
      try {
        const identifiers = await resolveMenuIdentifiers(API_URL);
        if (cancelled || menuCache.isReady) return;

        if (typeof Worker === 'function') {
          const worker = new Worker(new URL('../workers/menuPrefetchWorker.ts', import.meta.url));
          prefetchWorkerRef.current = worker;
          worker.onmessage = (event: MessageEvent<any>) => {
            const { type, payload, error } = event.data || {};
            if (type === 'prefetch:success' && payload && !cancelled) {
              menuCache.primeCache(payload);
            } else if (type === 'prefetch:error') {
              console.warn('Menu prefetch worker error:', error);
            }
            worker.terminate();
            prefetchWorkerRef.current = null;
          };
          worker.postMessage({
            type: 'prefetch',
            payload: {
              apiUrl: API_URL,
              storeId: identifiers.storeId,
              menuId: identifiers.menuId
            }
          });
        } else {
          const payload = await fetchMenuStructure(API_URL, identifiers.menuId, identifiers.storeId);
          if (!cancelled) {
            menuCache.primeCache(payload);
          }
        }
      } catch (error) {
        console.warn('Menu prefetch failed:', error);
      }
    };

    const schedulePrefetch = () => {
      if ('requestIdleCallback' in window) {
        idlePrefetchHandleRef.current = (window as any).requestIdleCallback(startPrefetch, { timeout: 500 });
      } else {
        const timeoutId = (window as any).setTimeout(startPrefetch, 80);
        idlePrefetchHandleRef.current = timeoutId as unknown as number;
      }
    };

    schedulePrefetch();

    return () => {
      cancelled = true;
      if (prefetchWorkerRef.current) {
        prefetchWorkerRef.current.terminate();
        prefetchWorkerRef.current = null;
      }
      if (idlePrefetchHandleRef.current !== null) {
        if ('cancelIdleCallback' in window) {
          (window as any).cancelIdleCallback(idlePrefetchHandleRef.current);
        } else {
          clearTimeout(idlePrefetchHandleRef.current as unknown as number);
        }
        idlePrefetchHandleRef.current = null;
      }
    };
  }, [menuCache.isReady, menuCache.isLoading, menuCache.primeCache]);

  // localStorage에서 저장된 Floor 목록 불러오기 (백오피스와 동일)
  const getSavedFloorList = () => {
    const savedFloorList = localStorage.getItem('tableMapFloorList');
    if (savedFloorList) {
      try {
        return JSON.parse(savedFloorList);
      } catch (error) {
        console.error('Error parsing saved floor list:', error);
        return ['1F', '2F', '3F', 'Patio'];
      }
    }
    return ['1F', '2F', '3F', 'Patio'];
  };

  // Floor 목록 초기화
  useEffect(() => {
    const savedFloorList = getSavedFloorList();
    setFloorList(savedFloorList);
  }, []);

  // BO 상태별 색상 로드
  useEffect(() => {
    try {
      const savedColors = localStorage.getItem(`tableMapFirstColors_${selectedFloor}`);
      if (savedColors) {
        const parsed = JSON.parse(savedColors);
        setFirstElementColors(parsed && typeof parsed === 'object' ? parsed : {});
      } else {
        setFirstElementColors({});
      }
    } catch {
      setFirstElementColors({});
    }
  }, [selectedFloor]);

  // screenSize 값이 변경될 때마다 Console에 출력
  useEffect(() => {
    console.log('�� screenSize changed:', screenSize);
  }, [screenSize]);
  const [canvasStyle, setCanvasStyle] = useState<{ width?: string; height?: string; maxWidth?: string; maxHeight?: string }>({});
  // View mode 고정: 항상 Fixed(1:1 픽셀)
  const viewMode: 'fixed' = 'fixed';
  const [scaleFactor, setScaleFactor] = useState<number>(1);
  const pageHostRef = useRef<HTMLDivElement>(null);
  const fixedAreaRef = useRef<HTMLDivElement>(null);
  // BO Screen Size를 '전체 프레임' 크기로 그대로 사용
  // 백오피스에서 설정한 Screen Size를 동적으로 적용
  const frameWidthPx = parseInt(screenSize.width) || 1024;
  const frameHeightPx = parseInt(screenSize.height) || 768;
  const headerHeightPx = 56;
  const footerHeightPx = 64;
  const contentHeightPx = Math.max(0, frameHeightPx - headerHeightPx - footerHeightPx);
  // 좌/우 비율 66%/34%로 분할
  const leftWidthPx = Math.round(frameWidthPx * (66 / 100));
  const rightWidthPx = Math.max(0, frameWidthPx - leftWidthPx);
  // 요소는 BO 좌표/크기를 그대로 사용(스케일 없음)
  const elementScale = 1;
  const KEYBOARD_RESERVED_HEIGHT = 260;
  const TOGO_MODAL_MAX_WIDTH = 900;
  const togoModalMaxHeight = Math.max(360, frameHeightPx - KEYBOARD_RESERVED_HEIGHT - 32);
  const togoModalMaxWidth = Math.min(frameWidthPx - 48, TOGO_MODAL_MAX_WIDTH);
  const keyboardMaxWidth = Math.min(frameWidthPx - 120, 860);

  useEffect(() => {
    // 항상 Fixed 모드이므로 스케일은 1로 고정
    setScaleFactor(1);
  }, [screenSize]);

  // Togo 주문 관련 상태들
  const [showTogoOrderModal, setShowTogoOrderModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [pickupTime, setPickupTime] = useState(15);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerZip, setCustomerZip] = useState('');
  const [togoOrderMode, setTogoOrderMode] = useState<'togo' | 'delivery'>('togo');
  const [prepButtonsLocked, setPrepButtonsLocked] = useState(false);
  const [togoNote, setTogoNote] = useState('');
  const [pickupAmPm, setPickupAmPm] = useState<'AM' | 'PM'>(() => getCurrentAmPm());
  const [pickupDateLabel, setPickupDateLabel] = useState(() => formatPickupDateLabel());
  const [showServerSelectionModal, setShowServerSelectionModal] = useState(false);
  const [serverModalLoading, setServerModalLoading] = useState(false);
  const [serverModalError, setServerModalError] = useState('');
  const [clockedInServers, setClockedInServers] = useState<ClockedInEmployee[]>([]);
  const [selectedTogoServer, setSelectedTogoServer] = useState<ClockedInEmployee | null>(null);
  const [togoOrderMeta, setTogoOrderMeta] = useState<Record<string, VirtualOrderMeta>>({});
  const [selectServerPromptEnabled, setSelectServerPromptEnabled] = useState(true);
  const shouldPromptServerSelection = selectServerPromptEnabled !== false;
  const [selectedHistoryOrderId, setSelectedHistoryOrderId] = useState<number | null>(null);
  const [historyDetailsMap, setHistoryDetailsMap] = useState<Record<number, HistoryOrderDetailPayload>>({});
  const [historyOrderDetail, setHistoryOrderDetail] = useState<HistoryOrderDetailPayload | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  
  // 오늘의 예약 현황 상태
  const [todayReservations, setTodayReservations] = useState<any[]>([]);
  
  // 오늘의 예약 현황 로드
  useEffect(() => {
    const loadTodayReservations = async () => {
      try {
        const today = new Date().toISOString().split('T')[0];
        const res = await fetch(`${API_URL}/reservations?date=${today}`);
        if (!res.ok) return;
        const data = await res.json();
        const reservations = Array.isArray(data) ? data : (data.reservations || []);
        reservations.sort((a: any, b: any) => {
          const timeA = a.reservation_time || a.time || '';
          const timeB = b.reservation_time || b.time || '';
          return timeA.localeCompare(timeB);
        });
        setTodayReservations(reservations);
      } catch (err) {
        console.error('Failed to load reservations:', err);
      }
    };
    
    // 앱 실행/새로고침 시 로드
    loadTodayReservations();
    
    // 오후 2시 업데이트 체크 (1분마다 확인)
    const checkScheduledUpdate = () => {
      const now = new Date();
      if (now.getHours() === 14 && now.getMinutes() === 0) {
        loadTodayReservations();
      }
    };
    const interval = setInterval(checkScheduledUpdate, 60000);
    return () => clearInterval(interval);
  }, []);
  const [historyError, setHistoryError] = useState('');
  const [customerHistoryOrders, setCustomerHistoryOrders] = useState<any[]>([]);
  const [customerHistoryLoading, setCustomerHistoryLoading] = useState(false);
  const [customerHistoryError, setCustomerHistoryError] = useState('');
  const [togoKeyboardTarget, setTogoKeyboardTarget] = useState<'phone' | 'name' | 'address' | 'note' | 'zip'>('phone');
  const [customerSuggestions, setCustomerSuggestions] = useState<CustomerSuggestion[]>([]);
  const [customerSuggestionSource, setCustomerSuggestionSource] = useState<'phone' | 'name' | null>(null);
  const [selectedCustomerHistory, setSelectedCustomerHistory] = useState<CustomerSuggestion | null>(null);
  const [reorderLoading, setReorderLoading] = useState(false);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.getElementById('glass-pulse-style')) return;
    const styleEl = document.createElement('style');
    styleEl.id = 'glass-pulse-style';
    styleEl.innerHTML = `
      @keyframes glassPulse {
        0% {
          box-shadow: 0 10px 25px rgba(95, 0, 255, 0.2);
          border-color: rgba(255,255,255,0.45);
        }
        50% {
          box-shadow: 0 16px 32px rgba(95, 0, 255, 0.45);
          border-color: rgba(255,255,255,0.9);
        }
        100% {
          box-shadow: 0 10px 25px rgba(95, 0, 255, 0.2);
          border-color: rgba(255,255,255,0.45);
        }
      }
      @keyframes beamSweep {
        0% {
          transform: translateX(-100%);
        }
        100% {
          transform: translateX(100%);
        }
      }
    `;
    document.head.appendChild(styleEl);
  }, []);
  const suggestionHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customerSuggestionFetchIdRef = useRef(0);
  const historyFetchIdRef = useRef(0);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const addressInputRef = useRef<HTMLTextAreaElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const noteInputRef = useRef<HTMLTextAreaElement>(null);

  const formatEmployeeName = (fullName: string) => {
    const trimmed = (fullName || '').trim();
    if (!trimmed) return '';
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) return parts[0];
    const first = parts[0];
    const lastInitial = parts[parts.length - 1]?.[0] || '';
    return lastInitial ? `${first} ${lastInitial.toUpperCase()}` : first;
  };
  const formatCurrency = (value?: number | string | null) => {
    const num = Number(value || 0);
    return `$${num.toFixed(2)}`;
  };
  const normalizeOrderId = (value: any): number | null => {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };
  const formatHistoryTimestamp = (input?: string | null) => {
    if (!input) return '';
    const d = new Date(input);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('en-US', { month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true });
  };
  const buildOrderItemPreview = (items: any[]) => {
    if (!Array.isArray(items) || items.length === 0) return 'No items';
    const preview = items
      .slice(0, 3)
      .map((it: any) => `${it.quantity || 1}x ${it.name}`)
      .join(', ');
    return items.length > 3 ? `${preview} + ${items.length - 3} more` : preview;
  };
  const normalizePhoneDigits = (value: string) => (value || '').replace(/\D/g, '');
  const getTogoPhoneDigits = (input: string) => normalizePhoneDigits(input).slice(0, 11);
  const formatTogoPhone = (input: string) => {
    const digits = getTogoPhoneDigits(input);
    if (!digits) return '';
    
    // 3자리 이하일 때는 괄호 없이 숫자만 표시 (지우기 편하게)
    if (digits.length <= 3) return digits;

    const area = digits.slice(0, 3);
    const rest = digits.slice(3);
    let formatted = `(${area}) `; // 4자리 이상일 때 괄호와 공백 추가

    if (!rest) return formatted.trim(); // 혹시 모를 방어
    
    // 4번째 자리부터는 (123) 4... 형식
    if (rest.length <= 3) return `${formatted}${rest}`;

    const middleLength = digits.length > 10 ? 4 : 3;
    const middle = rest.slice(0, middleLength);
    const remaining = rest.slice(middleLength);
    const hyphenSection = remaining ? `-${remaining}` : '';

    return `${formatted}${middle}${hyphenSection}`;
  };
  const getOrderTimestamp = useCallback((order: any) => {
    const source =
      order?.createdAt ||
      order?.created_at ||
      order?.order_date ||
      order?.order_time ||
      order?.time ||
      '';
    const date = new Date(source);
    const fallback = Number(order?.id) || Date.now();
    return Number.isNaN(date.getTime()) ? fallback : date.getTime();
  }, []);

  const formatOrderPhoneDisplay = (input?: string | null) => {
    const digits = (input || '').replace(/\D/g, '');
    if (!digits) return input || '';
    const len = digits.length;
    if (len <= 4) return digits;
    if (len === 5) return `${digits.slice(0, 1)}-${digits.slice(1)}`;
    if (len === 6) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    if (len === 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    if (len === 8) return `(${digits.slice(0, 1)})${digits.slice(1, 4)}-${digits.slice(4)}`;
    if (len === 9) return `(${digits.slice(0, 2)})${digits.slice(2, 5)}-${digits.slice(5)}`;
    if (len === 10) return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
    if (len === 11) return `(${digits.slice(0, 3)})${digits.slice(3, 7)}-${digits.slice(7)}`;
    return digits;
  };
  const formatOrderListDate = (order: any) => {
    const source =
      order?.createdAt ||
      order?.created_at ||
      order?.order_date ||
      order?.order_time ||
      order?.time;
    if (!source) return '—';
    const date = new Date(source);
    if (Number.isNaN(date.getTime())) return source;
    return date.toLocaleString('en-US', {
      month: '2-digit',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };
  const formatOrderHistoryDate = (order: any) => {
    const source =
      order?.createdAt ||
      order?.created_at ||
      order?.order_date ||
      order?.order_time ||
      order?.time;
    if (!source) return '—';
    const date = new Date(source);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    });
  };
  const formatOrderListSummary = (order: any) => {
    if (Array.isArray(order?.items) && order.items.length) {
      return buildOrderItemPreview(order.items);
    }
    if (order?.summary) return order.summary;
    return 'View order';
  };
  const currentMenuPriceMap = useMemo(() => {
    if (!menuCache || !Array.isArray(menuCache.menuItems) || menuCache.menuItems.length === 0) {
      return null;
    }
    const map = new Map<string, number>();
    menuCache.menuItems.forEach((item: any) => {
      if (!item || item.id == null) return;
      map.set(String(item.id), Number(item.price || 0));
    });
    return map;
  }, [menuCache?.menuItems]);
  const getOrderTotalValue = (order: any) => {
    const raw =
      order?.total ??
      order?.total_amount ??
      order?.order_total ??
      order?.amount ??
      order?.orderTotal ??
      0;
    const num = Number(raw);
    if (!Number.isFinite(num)) return 0;
    return num;
  };
  const formatNameWithTrailingSpace = (value: string) => {
    if (value == null) return '';
    const raw = String(value);
    const hasTrailingSpace = /\s$/.test(raw);
    const formatted = formatNameForDisplay(raw);
    if (!formatted && hasTrailingSpace) {
      return ' ';
    }
    return hasTrailingSpace && formatted ? `${formatted} ` : formatted;
  };
  const parseJsonSafe = (value: any, fallback: any = null) => {
    if (value == null) return fallback;
    if (typeof value === 'object') return value;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return fallback;
      }
    }
    return fallback;
  };
  const sanitizeDisplayName = (value?: string | null) => {
    const formatted = formatNameForDisplay(value || '');
    if (!formatted) return '';
    return formatted.trim().toLowerCase() === 'unknown' ? '' : formatted;
  };

  const updateTogoField = (
    target: 'phone' | 'name' | 'address' | 'note' | 'zip',
    transformer: (value: string) => string
  ) => {
    switch (target) {
      case 'phone': {
        let nextValue = '';
        setCustomerPhone((prev) => {
          nextValue = formatTogoPhone(transformer(String(prev || '')));
          return nextValue;
        });
        updateCustomerSuggestions('phone', nextValue);
        break;
      }
      case 'name': {
        let nextValue = '';
        setCustomerName((prev) => {
          nextValue = formatNameWithTrailingSpace(transformer(String(prev || '')));
          return nextValue;
        });
        updateCustomerSuggestions('name', formatNameForDisplay(nextValue));
        break;
      }
      case 'address':
        setCustomerAddress((prev) => transformer(String(prev || '')));
        break;
      case 'note':
        setTogoNote((prev) => transformer(String(prev || '')));
        break;
      case 'zip':
        setCustomerZip((prev) => transformer(String(prev || '')));
        break;
      default:
        break;
    }
  };
  // placeholders for future functions (moved below)
  const handleHistoryOrderClick = (rawId: number | string) => {
    const normalized = normalizeOrderId(rawId);
    if (normalized == null) return;
    setSelectedHistoryOrderId(normalized);
  };
  const keyboardDisplayText = useMemo(() => {
    const target = togoKeyboardTarget || 'phone';
    const labelMap: Record<'phone' | 'name' | 'address' | 'note' | 'zip', string> = {
      phone: 'Phone',
      name: 'Name',
      address: 'Address',
      note: 'Note',
      zip: 'Zip',
    };
    const valueMap: Record<'phone' | 'name' | 'address' | 'note' | 'zip', string> = {
      phone: customerPhone,
      name: customerName,
      address: customerAddress,
      note: togoNote,
      zip: customerZip,
    };
    return `${labelMap[target]}: ${valueMap[target] || ''}`;
  }, [togoKeyboardTarget, customerPhone, customerName, customerAddress, togoNote, customerZip]);

  const getActiveTogoField = useCallback((): HTMLInputElement | HTMLTextAreaElement | null => {
    switch (togoKeyboardTarget) {
      case 'phone':
        return phoneInputRef.current;
      case 'name':
        return nameInputRef.current;
      case 'address':
        return addressInputRef.current;
      case 'note':
        return noteInputRef.current;
      case 'zip':
        return zipInputRef.current;
      default:
        return phoneInputRef.current;
    }
  }, [togoKeyboardTarget]);

  const ensureTogoFieldFocus = useCallback(() => {
    if (!showTogoOrderModal) return;
    const targetElement = getActiveTogoField();
    if (!targetElement) return;
    requestAnimationFrame(() => {
      targetElement.focus({ preventScroll: true });
      if (
        typeof targetElement.selectionStart === 'number' &&
        typeof targetElement.selectionEnd === 'number'
      ) {
        const length = targetElement.value?.length ?? 0;
        try {
          targetElement.setSelectionRange(length, length);
        } catch {
          // ignore selection errors
        }
      }
    });
  }, [getActiveTogoField, showTogoOrderModal]);

  useEffect(() => {
    ensureTogoFieldFocus();
  }, [ensureTogoFieldFocus, togoKeyboardTarget]);
  const handleTogoKeyboardType = (char: string) => {
    const target = togoKeyboardTarget || 'phone';
    updateTogoField(target, (prev) => `${prev}${char}`);
    ensureTogoFieldFocus();
  };
  const handleTogoKeyboardBackspace = () => {
    const target = togoKeyboardTarget || 'phone';
    updateTogoField(target, (prev) => prev.slice(0, -1));
    ensureTogoFieldFocus();
  };
  const handleTogoKeyboardClear = () => {
    const target = togoKeyboardTarget || 'phone';
    updateTogoField(target, () => '');
    ensureTogoFieldFocus();
  };
  const handlePhoneInputChange = (value: string) => {
    const formatted = formatTogoPhone(value);
    setCustomerPhone(formatted);
    updateCustomerSuggestions('phone', formatted);
  };
  const handleNameInputChange = (value: string) => {
    const formatted = formatNameWithTrailingSpace(value);
    setCustomerName(formatted);
    updateCustomerSuggestions('name', formatNameForDisplay(value));
  };
  const handleSuggestionBlur = () => {
    scheduleSuggestionHide();
  };

  const getFieldBorderClasses = (field: 'phone' | 'name' | 'address' | 'note' | 'zip') =>
    togoKeyboardTarget === field
      ? 'border-2 border-emerald-500 shadow-[0_0_0_1px_rgba(16,185,129,0.2)]'
      : 'border border-slate-300';

  // Togo 주문 목록 상태
  const [togoOrders, setTogoOrders] = useState<any[]>([]);
  const [onlineQueueCards, setOnlineQueueCards] = useState<OnlineQueueCard[]>(() =>
    createInitialOnlineQueueCards()
  );
  const displayedHistoryOrders = useMemo(() => {
    return [...customerHistoryOrders].slice(0, 6);
  }, [customerHistoryOrders]);
  const resetCustomerHistoryView = useCallback(() => {
    historyFetchIdRef.current += 1;
    setCustomerHistoryOrders([]);
    setCustomerHistoryError('');
    setCustomerHistoryLoading(false);
    setSelectedHistoryOrderId(null);
    setHistoryOrderDetail(null);
    setHistoryError('');
    setHistoryLoading(false);
  }, []);
  const resetTogoModalAfterAction = useCallback(() => {
    setShowTogoOrderModal(false);
    setCustomerName('');
    setCustomerPhone('');
    setCustomerAddress('');
    setCustomerZip('');
    setTogoNote('');
    setTogoOrderMode('togo');
    setPrepButtonsLocked(false);
    setPickupTime(15);
    setPickupAmPm(getCurrentAmPm());
    setPickupDateLabel(formatPickupDateLabel());
    setSelectedTogoServer(null);
    setSelectedCustomerHistory(null);
    setCustomerSuggestions([]);
    setCustomerSuggestionSource(null);
    setSelectedHistoryOrderId(null);
    setHistoryOrderDetail(null);
    setHistoryError('');
    resetCustomerHistoryView();
    setHistoryDetailsMap({});
  }, [resetCustomerHistoryView]);
  const fetchCustomerHistoryForSelection = useCallback(
    async (selection: CustomerSuggestion | null) => {
      const fetchId = ++historyFetchIdRef.current;
      if (!showTogoOrderModal || !selection) {
        setCustomerHistoryOrders([]);
        setCustomerHistoryError('');
        setCustomerHistoryLoading(false);
        setSelectedHistoryOrderId(null);
        setHistoryOrderDetail(null);
        return;
      }
      const digits = (selection.phoneRaw || '').replace(/\D/g, '').slice(0, 11);
      const nameTerm = formatNameForDisplay(selection.name).trim();
      if (digits.length < 2 && nameTerm.length < 2) {
        setCustomerHistoryOrders([]);
        setCustomerHistoryError('');
        setCustomerHistoryLoading(false);
        setSelectedHistoryOrderId(null);
        setHistoryOrderDetail(null);
        return;
      }
      setCustomerHistoryLoading(true);
      setCustomerHistoryError('');
      try {
        const params = new URLSearchParams();
        params.set('limit', '100');
        if (digits.length >= 2) {
          params.set('customerPhone', digits);
        } else {
          params.set('customerName', nameTerm);
        }
        const res = await fetch(`${API_URL}/orders?${params.toString()}`);
        if (!res.ok) throw new Error('Failed to load customer history.');
        const data = await res.json();
        if (historyFetchIdRef.current !== fetchId) return;
        const orders = Array.isArray(data.orders) ? data.orders : [];
        orders.sort((a: any, b: any) => getOrderTimestamp(b) - getOrderTimestamp(a));
        setCustomerHistoryOrders(orders);
      } catch (error: any) {
        if (historyFetchIdRef.current !== fetchId) return;
        setCustomerHistoryError(error?.message || 'Failed to load customer history.');
        setCustomerHistoryOrders([]);
      } finally {
        if (historyFetchIdRef.current === fetchId) {
          setCustomerHistoryLoading(false);
        }
      }
    },
    [getOrderTimestamp, showTogoOrderModal]
  );

  const clearCustomerSuggestions = useCallback(() => {
    setCustomerSuggestions([]);
    setCustomerSuggestionSource(null);
  }, []);
  const virtualOrderLookup = useMemo(() => {
    const lookup: Record<string, { orderId: string; channel: VirtualOrderChannel; order: any }> = {};
    togoOrders.forEach((order) => {
      const key = String(order.id);
      const meta = togoOrderMeta[key];
      const resolvedVirtualId = (order.virtualTableId && String(order.virtualTableId)) || meta?.virtualTableId;
      if (!resolvedVirtualId) return;
      const resolvedChannel = order.virtualChannel || meta?.channel || 'togo';
      lookup[resolvedVirtualId] = {
        orderId: key,
        channel: resolvedChannel,
        order,
      };
    });
    onlineQueueCards.forEach((order) => {
      const resolvedVirtualId = order.virtualTableId ? String(order.virtualTableId) : null;
      if (!resolvedVirtualId) return;
      const resolvedChannel = order.virtualChannel || 'online';
      lookup[resolvedVirtualId] = {
        orderId: String(order.id),
        channel: resolvedChannel,
        order,
      };
    });
    return lookup;
  }, [onlineQueueCards, togoOrders, togoOrderMeta]);

  const getVirtualIdForOrder = useCallback(
    (order: any, channel: VirtualOrderChannel) => {
      if (order?.virtualTableId) {
        return String(order.virtualTableId);
      }
      if (channel === 'togo') {
        return togoOrderMeta[String(order?.id)]?.virtualTableId || null;
      }
      return null;
    },
    [togoOrderMeta]
  );



  const updateTableStatus = useCallback(
    (
      tableId: string | null | undefined,
      nextStatus?: string | null,
      extra?: Partial<Pick<TableElement, 'current_order_id' | 'status'>>
    ) => {
      if (!tableId) return;
      setTableElements((prev) =>
        prev.map((element) => {
          if (String(element.id) !== String(tableId)) return element;
          const patch: Partial<TableElement> = { ...(extra || {}) };
          if (nextStatus) {
            patch.status = nextStatus;
          }
          return Object.keys(patch).length > 0 ? { ...element, ...patch } : element;
        })
      );
    },
    [setTableElements]
  );


  const loadOnlineOrders = useCallback(async () => {
    // 로컬 스토리지에서 최신 restaurantId를 가져옴
    const currentRestaurantId = localStorage.getItem('firebaseRestaurantId');
    if (!currentRestaurantId) {
      if (onlineOrderRestaurantId) setOnlineOrderRestaurantId(null);
      return;
    }
    
    if (currentRestaurantId !== onlineOrderRestaurantId) {
      setOnlineOrderRestaurantId(currentRestaurantId);
    }
    
    try {
      // 모든 상태의 주문을 불러오되, cancelled 제외 (결제 완료된 completed도 포함)
      const res = await fetch(`${API_URL}/online-orders/${currentRestaurantId}`);
      if (!res.ok) return;
      const json = await res.json();
      const orders = Array.isArray(json.orders) ? json.orders : [];
      
      // 온라인 앱에서 들어온 주문만 표시 (pickup, delivery, online 타입)
      const filteredOrders = orders.filter((o: any) => {
        const orderType = (o.orderType || '').toLowerCase();
        const status = (o.status || '').toLowerCase();
        const customerName = (o.customerName || '').toLowerCase().trim();
        
        // POS에서 생성된 주문 제외
        if (orderType === 'dine_in' || orderType === 'dine-in') return false;
        if (orderType === 'togo') return false;
        if (orderType === 'pos') return false;
        
        // POS Order 고객명 제외
        if (customerName === 'pos order') return false;
        
        // Table Order 제외
        if (customerName === 'table order' || customerName.startsWith('table ')) return false;
        
        // cancelled 상태 제외
        if (status === 'cancelled') return false;
        
        // picked_up 상태 제외 (픽업 완료된 주문)
        if (status === 'picked_up') return false;
        
        return true;
      });
      
      console.log('[loadOnlineOrders] Filtered orders:', filteredOrders.length);
      
      const mappedCards: OnlineQueueCard[] = filteredOrders.map((o: any, idx: number) => ({
        id: o.id,
        number: o.localOrderId || o.id || String(idx + 1),
        time: new Date(o.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
        phone: o.customerPhone || '',
        name: o.customerName || 'Online Order',
        items: (o.items || []).map((it: any) => it.name),
        virtualChannel: 'online',
        virtualTableId: buildVirtualTableCode('online', idx + 1),
        fullOrder: o, // 전체 데이터 보관
        // 추가 필드
        placedTime: o.createdAt,
        pickupTime: o.pickupTime || o.readyTime || null,
        total: o.total || 0,
        sequenceNumber: idx + 1,
        status: o.status || 'pending' // Firebase에서 가져온 상태
      }));
      
      // 새 주문 감지 (pending 상태이고 이전에 없던 주문)
      const currentOrderIds = filteredOrders.map((o: any) => o.id);
      const pendingOrders = filteredOrders.filter((o: any) => 
        (o.status || 'pending').toLowerCase() === 'pending' &&
        !previousOnlineOrdersRef.current.includes(o.id)
      );
      
      // Manual 모드일 때만 새 주문 알림 표시
      if (pendingOrders.length > 0 && prepTimeSettings.thezoneorder.mode === 'manual' && !showNewOrderAlert) {
        const newOrder = pendingOrders[0]; // 첫 번째 새 주문
        setNewOrderAlertData(newOrder);
        setSelectedPrepTime(20); // 기본 20분
        setShowNewOrderAlert(true);
        console.log('[loadOnlineOrders] New order detected (manual mode):', newOrder.id);
      }
      
      // 이전 주문 ID 목록 업데이트
      previousOnlineOrdersRef.current = currentOrderIds;
      
      setOnlineQueueCards(mappedCards);
    } catch (error) {
      console.warn('Failed to load online orders:', error);
    }
  }, [API_URL, onlineOrderRestaurantId]);

  useEffect(() => {
    loadOnlineOrders();
    const t = setInterval(loadOnlineOrders, 30000); // 30초마다 백업 갱신
    return () => clearInterval(t);
  }, [loadOnlineOrders]);

  // SSE 실시간 푸시 연결 - 새 주문 즉시 감지
  useEffect(() => {
    const restaurantId = localStorage.getItem('firebaseRestaurantId');
    if (!restaurantId) return;

    let eventSource: EventSource | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;

    const connectSSE = () => {
      eventSource = new EventSource(`${API_URL}/online-orders/stream/${restaurantId}`);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[SSE] Message received:', data.type);

          if (data.type === 'new_order') {
            // 새 주문 푸시 수신
            const newOrder = data.order;
            console.log('[SSE] New order received:', newOrder.id);

            if (prepTimeSettings.thezoneorder.mode === 'auto') {
              // Auto 모드: 자동으로 수락 (모달 없음)
              const prepTimeStr = prepTimeSettings.thezoneorder.time || '20m';
              const prepMinutes = parseInt(prepTimeStr.replace('m', '')) || 20;
              const pickupTime = new Date(Date.now() + prepMinutes * 60000).toISOString();
              
              console.log(`[SSE] Auto accepting order: ${newOrder.id}, prepTime: ${prepMinutes}min`);
              
              fetch(`${API_URL}/online-orders/order/${newOrder.id}/accept`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prepTime: prepMinutes, pickupTime })
              }).then(() => {
                console.log('[SSE] Order auto-accepted:', newOrder.id);
                loadOnlineOrders();
              }).catch(err => {
                console.error('[SSE] Auto accept failed:', err);
              });
            } else if (prepTimeSettings.thezoneorder.mode === 'manual' && !showNewOrderAlert) {
              // Manual 모드: 알림 모달 표시
              setNewOrderAlertData(newOrder);
              setSelectedPrepTime(20);
              setShowNewOrderAlert(true);
            }

            // 목록 즉시 갱신
            loadOnlineOrders();
          } else if (data.type === 'order_updated') {
            // 주문 상태 변경 시 목록 갱신
            loadOnlineOrders();
          }
        } catch (error) {
          console.warn('[SSE] Parse error:', error);
        }
      };

      eventSource.onerror = (error) => {
        console.warn('[SSE] Connection error, reconnecting in 5s...', error);
        eventSource?.close();
        // 5초 후 재연결
        reconnectTimeout = setTimeout(connectSSE, 5000);
      };

      eventSource.onopen = () => {
        console.log('[SSE] Connected to online orders stream');
      };
    };

    connectSSE();

    return () => {
      eventSource?.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [API_URL, prepTimeSettings.thezoneorder.mode, showNewOrderAlert, loadOnlineOrders]);

  const loadTogoOrders = useCallback(async () => {
    try {
      // PENDING과 PAID 상태 모두 불러오기 (PICKED_UP은 제외)
      const [pendingRes, paidRes] = await Promise.all([
        fetch(`${API_URL}/orders?type=TOGO&status=PENDING&limit=50`),
        fetch(`${API_URL}/orders?type=TOGO&status=PAID&limit=50`),
      ]);
      
      const pendingJson = pendingRes.ok ? await pendingRes.json() : { orders: [] };
      const paidJson = paidRes.ok ? await paidRes.json() : { orders: [] };
      
      const pendingOrders = Array.isArray(pendingJson.orders) ? pendingJson.orders : [];
      const paidOrders = Array.isArray(paidJson.orders) ? paidJson.orders : [];
      
      // 두 목록 합치기 (중복 제거)
      const orderMap = new Map();
      [...pendingOrders, ...paidOrders].forEach(o => orderMap.set(o.id, o));
      const allOrders = Array.from(orderMap.values());
      
      // PICKED_UP 상태만 제외 (Pickup Complete 된 것만 제외)
      const orders = allOrders.filter((o: any) => {
        const status = (o.status || '').toUpperCase();
        return status !== 'PICKED_UP';
      });
      const mapped = orders.map((o: any, idx: number) => {
        const parsedId = Number(o.id);
        const fallbackId = Number(o.order_number || o.orderId);
        const safeId = Number.isFinite(parsedId)
          ? parsedId
          : Number.isFinite(fallbackId)
          ? Number(fallbackId)
          : Date.now() + idx;
        const phoneValue = o.customer_phone || o.customerPhone || o.phone || '';
        const digitsOnly = String(phoneValue || '').replace(/\D/g, '');
        const nameValue = o.customer_name || o.customerName || o.name || '';
        const formattedName = formatNameForDisplay(nameValue);
        const sanitizedName = formattedName.trim().toLowerCase() === 'unknown' ? '' : formattedName;
        const createdRaw = o.created_at || o.createdAt || null;
        const createdDate = createdRaw ? new Date(createdRaw) : null;
        const pickupMinutesRaw = Number(
          o.pickup_minutes ?? o.pickupMinutes ?? o.ready_in_minutes ?? o.readyMinutes ?? 0
        );
        let readyTimeLabel = '';
        if (
          createdDate &&
          !Number.isNaN(createdDate.getTime()) &&
          Number.isFinite(pickupMinutesRaw) &&
          pickupMinutesRaw > 0
        ) {
          const readyDate = new Date(createdDate.getTime() + pickupMinutesRaw * 60000);
          readyTimeLabel = readyDate.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          });
        } else if (o.ready_time || o.pickup_time) {
          readyTimeLabel = String(o.ready_time || o.pickup_time);
        }
        const fulfillmentRaw = (
          o.fulfillment_mode ??
          o.fulfillmentMode ??
          o.fulfillment ??
          o.togoFulfillment ??
          ''
        )
          .toString()
          .trim()
          .toLowerCase();
        const fulfillment =
          fulfillmentRaw === 'delivery'
            ? 'delivery'
            : fulfillmentRaw === 'togo' || fulfillmentRaw === 'pickup'
            ? 'togo'
            : null;
        const apiVirtualId = typeof o.virtual_table_id === 'string' ? o.virtual_table_id.trim() : '';
        const virtualChannel = normalizeVirtualOrderChannel(o.virtual_table_channel, 'togo');
        return {
          id: safeId,
          type: fulfillment === 'delivery' ? 'Delivery' : 'Togo',
          number: o.order_number || o.id,
          time: new Date(createdRaw || Date.now()).toLocaleTimeString('ko-KR', {
            hour: '2-digit',
            minute: '2-digit',
          }),
          createdAt: createdRaw,
          phone: phoneValue,
          phoneRaw: digitsOnly,
          name: sanitizedName,
          status: o.status?.toLowerCase() || 'pending',
          serverId: o.server_id || o.serverId || null,
          serverName: o.server_name || o.serverName || '',
          fulfillment,
          total: Number(o.total || 0),
          readyTimeLabel,
          virtualTableId: apiVirtualId || null,
          virtualChannel,
        };
      });
      setTogoOrderMeta((prevMeta) => {
        const metaSource = mapped.map((order: any) => ({
          id: order.id,
          channel: order.virtualChannel,
          virtualTableId: order.virtualTableId,
        }));
        const nextMeta = buildVirtualTableMeta(metaSource, prevMeta, 'togo');
        const sequencedOrders = assignDailySequenceNumbers(mapped as any, 'TOGO') as any[];
        const normalizedOrders = sequencedOrders.map((order: any) => {
          const metakey = String(order.id);
          const resolvedMeta = nextMeta[metakey];
          return {
            ...order,
            virtualTableId: order.virtualTableId || resolvedMeta?.virtualTableId || null,
            virtualChannel: order.virtualChannel || resolvedMeta?.channel || 'togo',
          };
        });
        setTogoOrders(normalizedOrders);
        return nextMeta;
      });
    } catch (error) {
      console.warn('Failed to load togo orders:', error);
    }
  }, [API_URL, setTogoOrders]);
  const openChannelOrder = useCallback(
    (channel: VirtualOrderChannel, order: any) => {
      const resolvedVirtualId =
        typeof order?.virtualTableId === 'string' && order.virtualTableId
          ? String(order.virtualTableId)
          : channel === 'togo'
          ? togoOrderMeta[String(order?.id)]?.virtualTableId || null
          : null;
      if (channel === 'togo') {
        navigate('/sales/order', {
          state: {
            orderType: 'togo',
            menuId: defaultMenu.menuId,
            menuName: defaultMenu.menuName,
            orderId: order.id,
            serverId: order.serverId,
            serverName: order.serverName,
            customerName: order.name,
            customerPhone: order.phone,
            readyTimeLabel: order.readyTimeLabel,
            pickup: order.pickup || null,
            togoFulfillment: order.fulfillment || order.type || null,
            virtualTableId: resolvedVirtualId,
            virtualTableChannel: 'togo',
          },
        });
        return;
      }
      if (channel === 'online') {
        navigate('/sales/order', {
          state: {
            orderType: 'online',
            menuId: defaultMenu.menuId,
            menuName: defaultMenu.menuName,
            orderId: order.id,
            customerName: order.name || order.customerName,
            customerPhone: order.phone || order.customerPhone,
            virtualTableId: resolvedVirtualId || order.virtualTableId || null,
            virtualTableChannel: 'online',
            onlineOrder: order.fullOrder || order, // 전체 주문 데이터 전달
          },
        });
      }
    },
    [defaultMenu.menuId, defaultMenu.menuName, navigate, togoOrderMeta]
  );

  const handleVirtualOrderCardClick = useCallback(
    async (channel: VirtualOrderChannel, order: any) => {
      console.log('[handleVirtualOrderCardClick] Called:', { channel, orderId: order?.id, isMoveMergeMode, sourceTableId, sourceTogoOrder, selectionChoice });
      
      // Move/Merge 모드일 때
      if (isMoveMergeMode) {
        // 1. 테이블 → Togo 머지 (sourceTableId가 설정됨)
        if (sourceTableId && selectionChoice) {
          console.log('[handleVirtualOrderCardClick] Table to Togo merge');
          const targetLabel = channel === 'togo' 
            ? `Togo #${order.id}` 
            : `Online #${order.number ?? order.id}`;
          
          try {
            setMoveMergeStatus(`🔄 ${targetLabel}로 머지 중...`);
            
            const response = await fetch(`${API_URL}/table-operations/merge-to-togo`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fromTableId: sourceTableId,
                toOrderId: order.id,
                toChannel: channel,
                floor: selectedFloor,
                partialSelection: selectionChoice && selectionChoice !== 'ALL'
                  ? {
                      guestNumbers: (selectionChoice as PartialSelectionPayload).guestNumbers || [],
                      orderItemIds: (selectionChoice as PartialSelectionPayload).orderItemIds || [],
                      orderLineIds: (selectionChoice as PartialSelectionPayload).orderLineIds || [],
                    }
                  : null,
              }),
            });
            
            const result = await response.json();
            
            if (response.ok && result.success) {
              const isPartial = selectionChoice && selectionChoice !== 'ALL';
              const fromStatus = result.fromTable?.status || (isPartial ? 'Occupied' : 'Preparing');
              
              setTableElements(prev => prev.map(el => {
                if (String(el.id) === String(sourceTableId)) {
                  const next = { ...el, status: fromStatus };
                  if (fromStatus !== 'Occupied') {
                    next.current_order_id = null;
                  }
                  return next;
                }
                return el;
              }));
              
              setSourceTableId(null);
              setIsMoveMergeMode(false);
              clearMoveMergeSelection();
              loadTogoOrders();
              
              setMoveMergeStatus(result.message || `✅ ${targetLabel}로 머지 완료`);
              setTimeout(() => setMoveMergeStatus(''), 800);
            } else {
              setMoveMergeStatus(`❌ 머지 실패: ${result.error || result.details || 'Unknown error'}`);
              setTimeout(() => {
                setSourceTableId(null);
                setMoveMergeStatus('');
                clearMoveMergeSelection();
              }, 3000);
            }
          } catch (error: any) {
            console.error('Merge to Togo error:', error);
            setMoveMergeStatus(`❌ 오류: ${error.message}`);
            setTimeout(() => {
              setSourceTableId(null);
              setMoveMergeStatus('');
              clearMoveMergeSelection();
            }, 3000);
          }
          return;
        }
        
        // 2. Togo → Togo 머지 (sourceTogoOrder가 설정됨)
        if (sourceTogoOrder) {
          // 같은 Togo 선택 방지
          if (sourceTogoOrder.id === order.id) {
            setMoveMergeStatus('❌ 같은 Togo를 선택할 수 없습니다.');
            setTimeout(() => setMoveMergeStatus('✓ 목적 Togo를 선택하세요'), 1500);
            return;
          }
          
          console.log('[handleVirtualOrderCardClick] Togo to Togo merge');
          const sourceLabel = `Togo #${sourceTogoOrder.id}`;
          const targetLabel = `Togo #${order.id}`;
          
          try {
            setMoveMergeStatus(`🔄 ${sourceLabel} → ${targetLabel} 머지 중...`);
            
            const response = await fetch(`${API_URL}/table-operations/merge-togo-to-togo`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fromOrderId: sourceTogoOrder.id,
                toOrderId: order.id,
              }),
            });
            
            const result = await response.json();
            
            if (response.ok && result.success) {
              setSourceTogoOrder(null);
              setIsMoveMergeMode(false);
              clearMoveMergeSelection();
              loadTogoOrders();
              
              setMoveMergeStatus(result.message || `✅ ${sourceLabel} → ${targetLabel} 머지 완료`);
              setTimeout(() => setMoveMergeStatus(''), 800);
            } else {
              setMoveMergeStatus(`❌ 머지 실패: ${result.error || result.details || 'Unknown error'}`);
              setTimeout(() => {
                setSourceTogoOrder(null);
                setMoveMergeStatus('');
                clearMoveMergeSelection();
              }, 3000);
            }
          } catch (error: any) {
            console.error('Togo to Togo merge error:', error);
            setMoveMergeStatus(`❌ 오류: ${error.message}`);
            setTimeout(() => {
              setSourceTogoOrder(null);
              setMoveMergeStatus('');
              clearMoveMergeSelection();
            }, 3000);
          }
          return;
        }
        
        // 3. Online → Togo 머지 (sourceOnlineOrder가 설정됨)
        if (sourceOnlineOrder && channel === 'togo') {
          console.log('[handleVirtualOrderCardClick] Online to Togo merge');
          const sourceLabel = `Online #${sourceOnlineOrder.number ?? sourceOnlineOrder.id}`;
          const targetLabel = `Togo #${order.id}`;
          
          try {
            setMoveMergeStatus(`🔄 ${sourceLabel} → ${targetLabel} 머지 중...`);
            
            const response = await fetch(`${API_URL}/table-operations/merge-togo-to-togo`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fromOrderId: sourceOnlineOrder.id,
                toOrderId: order.id,
              }),
            });
            
            const result = await response.json();
            
            if (response.ok && result.success) {
              setSourceOnlineOrder(null);
              setIsMoveMergeMode(false);
              clearMoveMergeSelection();
              loadTogoOrders();
              
              setMoveMergeStatus(result.message || `✅ ${sourceLabel} → ${targetLabel} 머지 완료`);
              setTimeout(() => setMoveMergeStatus(''), 800);
            } else {
              setMoveMergeStatus(`❌ 머지 실패: ${result.error || result.details || 'Unknown error'}`);
              setTimeout(() => {
                setSourceOnlineOrder(null);
                setMoveMergeStatus('');
                clearMoveMergeSelection();
              }, 3000);
            }
          } catch (error: any) {
            console.error('Online to Togo merge error:', error);
            setMoveMergeStatus(`❌ 오류: ${error.message}`);
            setTimeout(() => {
              setSourceOnlineOrder(null);
              setMoveMergeStatus('');
              clearMoveMergeSelection();
            }, 3000);
          }
          return;
        }
        
        // 4. 출발 선택 (sourceTableId, sourceTogoOrder, sourceOnlineOrder 모두 없는 경우)
        if (!sourceTableId && !sourceTogoOrder && !sourceOnlineOrder) {
          if (channel === 'togo') {
            const sourceLabel = `Togo #${order.id}`;
            setSourceTogoOrder(order);
            setMoveMergeStatus(`✓ 출발: ${sourceLabel} → 목적 Togo를 선택하세요`);
          } else if (channel === 'online') {
            const sourceLabel = `Online #${order.number ?? order.id}`;
            setSourceOnlineOrder(order);
            setMoveMergeStatus(`✓ 출발: ${sourceLabel} → 목적 Togo를 선택하세요`);
          }
          return;
        }
      }
      
      // Move/Merge 모드가 아닐 때: 모달 열기
      setSelectedOrderDetail(order);
      setSelectedOrderType(channel);
      setShowOrderDetailModal(true);
    },
    [isMoveMergeMode, sourceTableId, sourceTogoOrder, sourceOnlineOrder, selectionChoice, selectedFloor, loadTogoOrders, clearMoveMergeSelection]
  );
  useEffect(() => {
    setTogoOrderMeta((prev) => {
      const activeKeys = new Set(
        Object.values(virtualOrderLookup).map((entry) => entry.orderId)
      );
      let mutated = false;
      const retained: Record<string, VirtualOrderMeta> = {};
      Object.keys(prev).forEach((key) => {
        if (activeKeys.has(key)) {
          retained[key] = prev[key];
        } else {
          mutated = true;
        }
      });
      return mutated ? retained : prev;
    });
  }, [virtualOrderLookup]);

  const buildCustomerSuggestionOrders = useCallback(
    (predicate: (order: any) => boolean) => {
      const buckets = new Map<string, any[]>();
      togoOrders.forEach((order) => {
        if (!predicate(order)) return;
        // 다양한 필드명 지원 (customer_phone, customerPhone, phoneRaw, phone)
        const rawPhone = order.customer_phone || order.customerPhone || order.phoneRaw || order.phone || '';
        const phoneKey = normalizePhoneDigits(rawPhone);
        const nameValue = order.customer_name || order.customerName || order.name || '';
        const key = phoneKey || nameValue.toLowerCase().trim();
        if (!key) return;
        const existing = buckets.get(key) || [];
        existing.push(order);
        buckets.set(key, existing);
      });
      const suggestions: CustomerSuggestion[] = [];
      buckets.forEach((orders, key) => {
        const sorted = [...orders].sort((a, b) => getOrderTimestamp(b) - getOrderTimestamp(a));
        const primary = sorted[0] || {};
        const primaryPhone = primary.customer_phone || primary.customerPhone || primary.phoneRaw || primary.phone || '';
        const primaryName = primary.customer_name || primary.customerName || primary.name || '';
        suggestions.push({
          key,
          name: sanitizeDisplayName(primaryName),
          phone: primaryPhone,
          phoneRaw: normalizePhoneDigits(primaryPhone),
          orders: sorted.slice(0, 5),
        });
      });
      suggestions.sort((a, b) => {
        const aTs = getOrderTimestamp(a.orders[0] || {});
        const bTs = getOrderTimestamp(b.orders[0] || {});
        return bTs - aTs;
      });
      return suggestions.slice(0, 5);
    },
    [togoOrders, getOrderTimestamp]
  );

  const buildRemoteSuggestions = useCallback(
    (orders: any[]): CustomerSuggestion[] => {
      const buckets = new Map<string, CustomerSuggestion>();
      orders.forEach((order) => {
        const rawPhone = order.customer_phone || order.customerPhone || order.phone || '';
        const digits = normalizePhoneDigits(rawPhone || '');
        const nameSource = order.customer_name || order.customerName || order.name || '';
        const key = digits || (nameSource || '').toLowerCase().trim();
        if (!key) return;
        const displayName = sanitizeDisplayName(nameSource);
        const displayPhone = digits ? formatTogoPhone(digits) : rawPhone;
        const normalizedOrder = {
          ...order,
          phone: rawPhone,
          phoneRaw: digits,
        };
        const existing = buckets.get(key);
        if (existing) {
          const merged = [...existing.orders];
          if (!merged.some((item: any) => String(item.id) === String(order.id))) {
            merged.push(normalizedOrder);
            merged.sort((a: any, b: any) => getOrderTimestamp(b) - getOrderTimestamp(a));
            if (merged.length > 5) {
              merged.length = 5;
            }
          }
          buckets.set(key, { ...existing, orders: merged });
        } else {
          buckets.set(key, {
            key,
            name: displayName,
            phone: displayPhone,
            phoneRaw: digits,
            orders: [normalizedOrder],
          });
        }
      });
      return Array.from(buckets.values()).sort(
        (a, b) => getOrderTimestamp(b.orders[0] || {}) - getOrderTimestamp(a.orders[0] || {})
      );
    },
    [getOrderTimestamp]
  );

  const historyInsights = useMemo(() => {
    if (!historyOrderDetail || !historyOrderDetail.order) return null;
    const order = historyOrderDetail.order;
    const items = Array.isArray(historyOrderDetail.items) ? historyOrderDetail.items : [];
    const adjustments = Array.isArray(historyOrderDetail.adjustments) ? historyOrderDetail.adjustments : [];
    const previousTotal = Number(getOrderTotalValue(order) || 0);

    let priceInsight: null | {
      previousTotal: number;
      estimatedCurrent?: number;
      diff?: number;
      direction?: 'up' | 'down' | 'same';
      hasMenuData: boolean;
    } = null;

    if (items.length > 0) {
      if (currentMenuPriceMap) {
        let estimatedCurrent = 0;
        items.forEach((item: any) => {
          const qty = Number(item.quantity || item.qty || 1);
          const basePrice = Number(item.price || item.unit_price || 0);
          const lookupKey = item.item_id ?? item.itemId ?? item.id;
          const menuPrice = lookupKey != null ? currentMenuPriceMap.get(String(lookupKey)) : undefined;
          const currentUnitPrice = Number.isFinite(menuPrice as number) ? (menuPrice as number) : basePrice;
          estimatedCurrent += currentUnitPrice * qty;
        });
        estimatedCurrent = Number(estimatedCurrent.toFixed(2));
        const diff = Number((estimatedCurrent - previousTotal).toFixed(2));
        let direction: 'up' | 'down' | 'same' = 'same';
        if (Math.abs(diff) >= 0.01) {
          direction = diff > 0 ? 'up' : 'down';
        }
        priceInsight = {
          previousTotal: Number(previousTotal.toFixed(2)),
          estimatedCurrent,
          diff,
          direction,
          hasMenuData: true,
        };
      } else {
        priceInsight = { previousTotal: Number(previousTotal.toFixed(2)), hasMenuData: false };
      }
    }

    const promoAdjustments = adjustments.filter(
      (adj: any) => String(adj?.kind || '').toUpperCase() === 'PROMOTION'
    );
    let promotionInsight: { message: string; tone: 'neutral' | 'info' } = { message: 'No changes', tone: 'neutral' };
    if (promoAdjustments.length > 0) {
      const names = Array.from(
        new Set(
          promoAdjustments
            .map((adj: any) => (adj?.label || 'Promotion').toString().trim())
            .filter(Boolean)
        )
      );
      const totalBenefit = promoAdjustments.reduce(
        (sum: number, adj: any) => sum + Math.abs(Number(adj?.amountApplied || 0)),
        0
      );
      const label = names.length ? names.join(', ') : 'Promotion';
      promotionInsight = {
        message: `${label} • -${formatCurrency(totalBenefit)}`,
        tone: 'info',
      };
    }

    return { price: priceInsight, promotion: promotionInsight };
  }, [historyOrderDetail, currentMenuPriceMap, getOrderTotalValue]);

  const priceChangeSummary = useMemo(() => {
    const neutral = { label: 'No change', tone: 'neutral' as 'neutral' | 'up' | 'down' };
    if (!historyInsights || !historyInsights.price) {
      return { label: 'No data', tone: 'neutral' as const };
    }
    const info = historyInsights.price;
    if (!info.hasMenuData) {
      return { label: 'No menu data', tone: 'neutral' as const };
    }
    if (!info.diff || Math.abs(info.diff) < 0.01) return neutral;
    const diffAbs = Math.abs(info.diff);
    const diffLabel = `${info.diff > 0 ? '+' : '-'}${formatCurrency(diffAbs)}`;
    return { label: diffLabel, tone: info.diff > 0 ? 'up' : 'down' };
  }, [historyInsights]);

  const promotionSummary = useMemo(() => {
    if (!historyInsights || !historyInsights.promotion) return '';
    const msg = historyInsights.promotion.message || '';
    if (!msg || msg === 'No changes' || msg === 'No promotion changes') return '';
    return msg;
  }, [historyInsights]);

  const mergeSuggestionLists = useCallback(
    (base: CustomerSuggestion[], additions: CustomerSuggestion[]) => {
      if (!additions.length) return base;
      const map = new Map<string, CustomerSuggestion>();
      base.forEach((entry) => map.set(entry.key, entry));
      additions.forEach((entry) => {
        if (map.has(entry.key)) {
          const existing = map.get(entry.key)!;
          const combined = [...existing.orders];
          entry.orders.forEach((ord: any) => {
            if (!combined.some((o: any) => String(o.id) === String(ord.id))) {
              combined.push(ord);
            }
          });
          combined.sort((a: any, b: any) => getOrderTimestamp(b) - getOrderTimestamp(a));
          if (combined.length > 5) {
            combined.length = 5;
          }
          map.set(entry.key, { ...existing, orders: combined });
        } else {
          map.set(entry.key, entry);
        }
      });
      return Array.from(map.values());
    },
    [getOrderTimestamp]
  );
  const updateCustomerSuggestions = useCallback(
    (mode: 'phone' | 'name', rawValue: string) => {
      const value = rawValue.trim();
      if (!value) {
        customerSuggestionFetchIdRef.current += 1;
        clearCustomerSuggestions();
        setSelectedCustomerHistory(null);
        resetCustomerHistoryView();
        return;
      }
      if (mode === 'phone') {
        const digits = getTogoPhoneDigits(value);
        // 1자리부터 검색 시작 (기존 2자리 제한 해제)
        if (digits.length < 1) {
          customerSuggestionFetchIdRef.current += 1;
          clearCustomerSuggestions();
          setSelectedCustomerHistory(null);
          resetCustomerHistoryView();
          return;
        }
        const localMatches = buildCustomerSuggestionOrders((order) => {
          // 다양한 필드명 지원 (customer_phone, customerPhone, phoneRaw, phone)
          const rawPhone = order.customer_phone || order.customerPhone || order.phoneRaw || order.phone || '';
          const orderDigits = normalizePhoneDigits(rawPhone);
          // 입력한 번호가 전화번호 어디에든 포함되면 매칭 (시작, 중간, 끝 모두)
          return orderDigits.includes(digits);
        });
        setCustomerSuggestions(localMatches);
        setCustomerSuggestionSource(localMatches.length ? 'phone' : null);
        setSelectedCustomerHistory(null);
        resetCustomerHistoryView();
        const fetchId = ++customerSuggestionFetchIdRef.current;
        (async () => {
          try {
            const params = new URLSearchParams();
            params.set('customerPhone', digits);
            params.set('limit', '50');
            const res = await fetch(`${API_URL}/orders?${params.toString()}`);
            if (!res.ok) throw new Error('Failed to load customer suggestions.');
            const data = await res.json();
            if (customerSuggestionFetchIdRef.current !== fetchId) return;
            // 원격 결과도 입력한 번호가 포함된 것만 필터링
            const remoteOrders = Array.isArray(data.orders) ? data.orders : [];
            const filteredRemote = remoteOrders.filter((order: any) => {
              const rawPhone = order.customer_phone || order.customerPhone || order.phoneRaw || order.phone || '';
              const orderDigits = normalizePhoneDigits(rawPhone);
              return orderDigits.includes(digits);
            });
            const remote = buildRemoteSuggestions(filteredRemote);
            const merged = mergeSuggestionLists(localMatches, remote);
            setCustomerSuggestions(merged);
            setCustomerSuggestionSource(merged.length ? 'phone' : null);
          } catch (error) {
            if (customerSuggestionFetchIdRef.current !== fetchId) return;
            console.warn('Failed to load customer suggestions:', error);
          }
        })();
        return;
      }
      const formattedName = formatNameForDisplay(value);
      const lowered = formattedName.toLowerCase();
      // 이름도 1글자부터 검색 (기존 2글자 제한 해제)
      if (lowered.replace(/\s+/g, '').length < 1) {
        customerSuggestionFetchIdRef.current += 1;
        clearCustomerSuggestions();
        setSelectedCustomerHistory(null);
        resetCustomerHistoryView();
        return;
      }
      const localMatches = buildCustomerSuggestionOrders((order) => {
        // 다양한 필드명 지원 (customer_name, customerName, name)
        const nameValue = order.customer_name || order.customerName || order.name || '';
        const orderName = formatNameForDisplay(nameValue).toLowerCase();
        return orderName.includes(lowered);
      });
      setCustomerSuggestions(localMatches);
      setCustomerSuggestionSource(localMatches.length ? 'name' : null);
      setSelectedCustomerHistory(null);
      resetCustomerHistoryView();
      const fetchId = ++customerSuggestionFetchIdRef.current;
      (async () => {
        try {
          const params = new URLSearchParams();
          params.set('customerName', formattedName);
          params.set('limit', '50');
          const res = await fetch(`${API_URL}/orders?${params.toString()}`);
          if (!res.ok) throw new Error('Failed to load customer suggestions.');
          const data = await res.json();
          if (customerSuggestionFetchIdRef.current !== fetchId) return;
          const remote = buildRemoteSuggestions(Array.isArray(data.orders) ? data.orders : []);
          const merged = mergeSuggestionLists(localMatches, remote);
          setCustomerSuggestions(merged);
          setCustomerSuggestionSource(merged.length ? 'name' : null);
        } catch (error) {
          if (customerSuggestionFetchIdRef.current !== fetchId) return;
          console.warn('Failed to load customer suggestions:', error);
        }
      })();
    },
    [API_URL, buildCustomerSuggestionOrders, buildRemoteSuggestions, clearCustomerSuggestions, getTogoPhoneDigits, mergeSuggestionLists, resetCustomerHistoryView]
  );
  const handleSuggestionFocus = () => {
    if (suggestionHideTimeoutRef.current) {
      clearTimeout(suggestionHideTimeoutRef.current);
      suggestionHideTimeoutRef.current = null;
    }
  };
  const scheduleSuggestionHide = () => {
    if (suggestionHideTimeoutRef.current) {
      clearTimeout(suggestionHideTimeoutRef.current);
    }
    suggestionHideTimeoutRef.current = setTimeout(() => {
      clearCustomerSuggestions();
    }, 120);
  };
  const handleCustomerSuggestionSelect = (suggestion: CustomerSuggestion) => {
    if (suggestionHideTimeoutRef.current) {
      clearTimeout(suggestionHideTimeoutRef.current);
      suggestionHideTimeoutRef.current = null;
    }
    historyFetchIdRef.current += 1;
    setCustomerHistoryOrders([]);
    setCustomerHistoryError('');
    setCustomerHistoryLoading(false);
    setSelectedHistoryOrderId(null);
    setHistoryOrderDetail(null);
    setHistoryError('');
    setCustomerPhone(formatTogoPhone(suggestion.phone));
    setCustomerName(sanitizeDisplayName(suggestion.name));
    setSelectedCustomerHistory(suggestion);
    setCustomerSuggestionSource(null);
    setCustomerSuggestions([]);
  };
  // placeholder to maintain ordering
  const renderCustomerSuggestionList = (source: 'phone' | 'name') => {
    if (customerSuggestionSource !== source || customerSuggestions.length === 0) return null;
    return (
      <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border border-slate-200 bg-white shadow-2xl z-50 max-h-60 overflow-y-auto">
        {customerSuggestions.map((suggestion) => (
          <button
            type="button"
            key={`${source}-${suggestion.key}`}
            className="w-full text-left px-4 py-3 hover:bg-emerald-50 border-b border-slate-100 last:border-0 transition-colors"
            onMouseDown={(event) => {
              event.preventDefault();
              handleCustomerSuggestionSelect(suggestion);
            }}
          >
            <div className="text-base font-semibold text-slate-800">{suggestion.name || '\u00A0'}</div>
            <div className="text-sm text-slate-500">{suggestion.phone}</div>
          </button>
        ))}
      </div>
    );
  };
  const readyTimeSnapshot = useMemo(() => {
    const now = new Date();
    const totalMinutes = now.getHours() * 60 + now.getMinutes() + pickupTime;
    const readyHours = Math.floor(totalMinutes / 60) % 24;
    const readyMinutes = totalMinutes % 60;
    const ready24 = `${readyHours.toString().padStart(2, '0')}:${readyMinutes.toString().padStart(2, '0')}`;
    const readyDisplay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), readyHours, readyMinutes).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const currentDisplay = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    return { current: formatMinutesToTime(now.getHours() * 60 + now.getMinutes()), ready: ready24, readyDisplay, currentDisplay };
  }, [pickupTime]);
  useEffect(() => {
    loadTogoOrders();
    const t = setInterval(loadTogoOrders, 10000);
    return () => clearInterval(t);
  }, [loadTogoOrders, refreshOrdersTrigger]);
  const handleReorderFromHistory = useCallback(async () => {
    if (reorderLoading) return;
    if (!selectedHistoryOrderId || !historyOrderDetail || !historyOrderDetail.order) {
      alert('Select an order to reorder.');
      return;
    }
    if (historyLoading) {
      alert('Order details are still loading. Please wait.');
      return;
    }
    if (!Array.isArray(historyOrderDetail.items) || historyOrderDetail.items.length === 0) {
      alert('No items available to reorder.');
      return;
    }
    if (shouldPromptServerSelection && !selectedTogoServer) {
      alert('Please select a server before reordering.');
      return;
    }
    try {
      setReorderLoading(true);
      const order = historyOrderDetail.order;
      const orderTypeRaw = (order.order_type || order.orderType || 'TOGO').toString().toUpperCase();
      const fulfillmentModeRaw =
        (
          order.fulfillment_mode ||
          order.fulfillmentMode ||
          order.fulfillment ||
          (orderTypeRaw === 'DELIVERY' ? 'delivery' : orderTypeRaw === 'TOGO' ? 'togo' : '')
        )
          ?.toString()
          .toLowerCase() || null;
      const now = new Date();
      const newOrderNumber = `REORDER-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
        now.getDate()
      ).padStart(2, '0')}-${now.getTime()}`;
      const itemsPayload = historyOrderDetail.items
        .map((item: any, idx: number) => {
          const modifiers = parseJsonSafe(item.modifiers_json ?? item.modifiersJson ?? item.modifiers, []);
          const memo = parseJsonSafe(item.memo_json ?? item.memoJson ?? item.memo, null);
          const discount = parseJsonSafe(item.discount_json ?? item.discountJson ?? item.discount, null);
          return {
            id: String(item.item_id ?? item.itemId ?? item.id ?? `history-${idx}`),
            name: item.name || `Item ${idx + 1}`,
            quantity: Number(item.quantity || 1),
            price: Number(item.price || 0),
            guestNumber: Number(item.guest_number || item.guestNumber || 1),
            modifiers: Array.isArray(modifiers) ? modifiers : [],
            memo: memo && typeof memo === 'object' ? memo : null,
            discount: discount && typeof discount === 'object' ? discount : null,
            splitDenominator: item.split_denominator || item.splitDenominator || null,
            orderLineId: String(item.order_line_id || item.orderLineId || `${Date.now()}-${idx}`),
          };
        })
        .filter((it) => Number(it.quantity) > 0);
      if (!itemsPayload.length) {
        alert('No items available to reorder.');
        setReorderLoading(false);
        return;
      }
      const adjustmentsPayload = Array.isArray(historyOrderDetail.adjustments)
        ? historyOrderDetail.adjustments.map((adj: any) => ({
            kind: String(adj.kind || ''),
            mode: adj.mode || '',
            value: Number(adj.value || 0),
            amountApplied: Number(adj.amountApplied ?? adj.amount_applied ?? 0),
            label: adj.label || null,
          }))
        : [];
      const phoneDigits = getTogoPhoneDigits(customerPhone || order.customer_phone || order.customerPhone || '');
      const customerPhoneForOrder = phoneDigits ? formatTogoPhone(phoneDigits) : (order.customer_phone || order.customerPhone || null);
      const customerNameForOrder =
        sanitizeDisplayName(customerName || order.customer_name || order.customerName || '') || null;
      const payload = {
        orderNumber: newOrderNumber,
        orderType: orderTypeRaw,
        total: Number(getOrderTotalValue(order) || 0),
        items: itemsPayload,
        adjustments: adjustmentsPayload,
        customerPhone: customerPhoneForOrder,
        customerName: customerNameForOrder,
        fulfillmentMode: fulfillmentModeRaw,
        readyTime: readyTimeSnapshot.readyDisplay,
        pickupMinutes: pickupTime,
        serverId: selectedTogoServer?.employee_id || null,
        serverName: selectedTogoServer?.employee_name || null,
      };
      const response = await fetch(`${API_URL}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error('Failed to process reorder.');
      await response.json();
      await loadTogoOrders();
      resetTogoModalAfterAction();
    } catch (error: any) {
      console.error('Failed to reorder:', error);
      alert(error?.message || 'Failed to reorder. Please try again.');
    } finally {
      setReorderLoading(false);
    }
  }, [
    reorderLoading,
    selectedHistoryOrderId,
    historyOrderDetail,
    historyLoading,
    shouldPromptServerSelection,
    selectedTogoServer,
    customerPhone,
    customerName,
    pickupTime,
    readyTimeSnapshot.readyDisplay,
    API_URL,
    getOrderTotalValue,
    loadTogoOrders,
    resetTogoModalAfterAction,
    formatTogoPhone,
    getTogoPhoneDigits,
    sanitizeDisplayName,
    parseJsonSafe,
  ]);
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
      setClockedInServers(filtered);
    } catch (error) {
      console.warn('Failed to load clocked-in employees:', error);
      setServerModalError(error instanceof Error ? error.message : 'Failed to load server list.');
    } finally {
      setServerModalLoading(false);
    }
  }, []);

  useEffect(() => {
    if (showServerSelectionModal) {
      fetchClockedInServers();
    }
  }, [showServerSelectionModal, fetchClockedInServers]);
  useEffect(() => {
    if (showTogoOrderModal) {
      setTogoKeyboardTarget('phone');
    } else {
      customerSuggestionFetchIdRef.current += 1;
      resetCustomerHistoryView();
      setHistoryDetailsMap({});
      setSelectedCustomerHistory(null);
      setCustomerSuggestions([]);
      setCustomerSuggestionSource(null);
    }
  }, [showTogoOrderModal, resetCustomerHistoryView]);
  useEffect(() => {
    if (!showTogoOrderModal) return;
    fetchCustomerHistoryForSelection(selectedCustomerHistory);
  }, [showTogoOrderModal, selectedCustomerHistory, fetchCustomerHistoryForSelection]);
  useEffect(() => {
    if (customerHistoryOrders.length === 0) {
      setSelectedHistoryOrderId(null);
      return;
    }
    setSelectedHistoryOrderId((prev) => {
      if (prev != null) {
        const exists = customerHistoryOrders.some((order) => normalizeOrderId(order.id) === prev);
        if (exists) return prev;
      }
      const firstId = normalizeOrderId(customerHistoryOrders[0]?.id);
      return firstId;
    });
  }, [customerHistoryOrders]);
  useEffect(() => {
    if (!showTogoOrderModal || !selectedHistoryOrderId) {
      if (!selectedHistoryOrderId) {
        setHistoryOrderDetail(null);
        setHistoryLoading(false);
      }
      return;
    }
    const cached = historyDetailsMap[selectedHistoryOrderId];
    if (cached) {
      setHistoryOrderDetail(cached);
      setHistoryLoading(false);
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError('');
    (async () => {
      try {
        const res = await fetch(`${API_URL}/orders/${encodeURIComponent(String(selectedHistoryOrderId))}`);
        if (!res.ok) throw new Error('Failed to load order history.');
        const data = await res.json();
        const payload: HistoryOrderDetailPayload = {
          order: data?.order || null,
          items: Array.isArray(data?.items) ? data.items : [],
          adjustments: Array.isArray(data?.adjustments) ? data.adjustments : [],
        };
        if (cancelled) return;
        setHistoryDetailsMap((prev) => ({ ...prev, [selectedHistoryOrderId]: payload }));
        setHistoryOrderDetail(payload);
      } catch (error: any) {
        if (cancelled) return;
        setHistoryError(error?.message || 'Failed to load order history.');
        setHistoryOrderDetail(null);
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedHistoryOrderId, showTogoOrderModal, historyDetailsMap]);

  const startTogoOrderFlow = useCallback((server: ClockedInEmployee | null) => {
    setSelectedTogoServer(server);
    setPickupTime(15);
    setPickupAmPm(getCurrentAmPm());
    setPickupDateLabel(formatPickupDateLabel());
    setCustomerName('');
    setCustomerPhone('');
    setCustomerAddress('');
    setCustomerZip('');
    setTogoNote('');
    setTogoOrderMode('togo');
    setPrepButtonsLocked(false);
    setSelectedHistoryOrderId(null);
    setHistoryDetailsMap({});
    setHistoryOrderDetail(null);
    setHistoryError('');
    setShowTogoOrderModal(true);
  }, []);

  const handleNewTogoClick = () => {
    if (isMoveMergeMode) {
      // Move/Merge 모드일 때는 'New Togo'를 타겟으로 선택할 수 없도록 막음 (요청사항)
      setMoveMergeStatus('❌ Cannot move to New Togo (Not supported)');
      setTimeout(() => setMoveMergeStatus(''), 2000);
      return;
    }

    setServerModalError('');
    setCustomerZip('');
    if (shouldPromptServerSelection) {
      setSelectedTogoServer(null);
      setShowServerSelectionModal(true);
    } else {
      startTogoOrderFlow(null);
    }
  };

  const handleServerModalClose = () => {
    setShowServerSelectionModal(false);
    setSelectedTogoServer(null);
  };

  const handleServerSelectForTogo = (employee: ClockedInEmployee) => {
    if (!employee) return;
    setShowServerSelectionModal(false);
    startTogoOrderFlow(employee);
  };

  // 요소 표시 이름 결정 함수 (백오피스와 동일)
  const getElementDisplayName = (element: TableElement) => {
    switch (element.type) {
      case 'rounded-rectangle':
      case 'circle':
        // 저장된 이름 우선 사용, 없으면 T{id}
        let displayName = (element.text && String(element.text).trim()) ? String(element.text).trim() : `T${element.id}`;
        
        // Occupied 또는 Payment Pending 상태인 경우 시간 표시
        if ((element.status === 'Occupied' || element.status === 'Payment Pending') && tableOccupiedTimes[String(element.id)]) {
          const now = Date.now();
          const elapsed = Math.floor((now - tableOccupiedTimes[String(element.id)]) / 1000 / 60); // 분 단위
          const hours = Math.floor(elapsed / 60);
          const minutes = elapsed % 60;
          displayName += `\n${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
          console.log(`Table ${element.id} occupied time:`, `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`);
        }
        // Hold 또는 Reserved 상태인 경우 예약자 이름 표시
        else if ((element.status === 'Hold' || element.status === 'Reserved') && tableReservationNames[String(element.id)]) {
          displayName += `\n${tableReservationNames[String(element.id)]}`;
          console.log(`Table ${element.id} reservation name:`, tableReservationNames[String(element.id)]);
        }
        
        return displayName;
      case 'entrance':
        return 'Entrance'; // 번호 없음
      case 'counter':
        return 'Counter'; // 번호 없음
      case 'washroom':
        return 'WashRoom'; // 번호 없음
      case 'restroom':
        return 'Restroom'; // 번호 없음
      case 'cook-area':
        return 'Cook'; // 번호 없음
      case 'divider':
        return ''; // Divider에는 이름을 넣지 않음
      case 'wall':
        return ''; // Wall에도 이름을 넣지 않음
      case 'other':
        return 'Other'; // 번호 없음
      case 'floor-label':
        return element.text || 'Floor'; // 번호 없음
      default:
        return 'Element'; // 번호 없음
    }
  };

  // 백엔드에서 테이블 맵 데이터 가져오기
  const fetchTableMapData = async (showLoading = false) => {
    try {
      // 초기 로딩 시에만 로딩 스피너 표시 (백그라운드 갱신 시에는 표시하지 않음)
      if (showLoading) {
        setLoading(true);
      }
      
      // Floor 이름을 백오피스와 동일하게 사용
      const apiFloor = selectedFloor;
      
      // 테이블 요소들 가져오기
      const elementsResponse = await fetch(`http://localhost:3177/api/table-map/elements?floor=${apiFloor}`);
      if (elementsResponse.ok) {
        const elements = await elementsResponse.json();
        // 저장된 text를 그대로 유지 (표시명은 렌더 시 계산)
        const transformedElements = elements.map((element: any) => ({
          ...element
        }));
        // Optimistically apply last occupied table state (for up to 60s)
        let patchedElements = transformedElements;
        try {
          const raw = localStorage.getItem('lastOccupiedTable');
          if (raw) {
            const hint = JSON.parse(raw);
            if (hint && hint.floor === apiFloor && Date.now() - (hint.ts || 0) < 60000) {
              patchedElements = transformedElements.map((el: any) => (
                String(el.id) === String(hint.tableId) ? { ...el, status: hint.status } : el
              ));
            }
          }
        } catch {}
        setTableElements(patchedElements);
        try {
          patchedElements.forEach((element: any) => {
            const key = `lastOrderIdByTable_${element.id}`;
            if (
              element &&
              (element.status === 'Occupied' || element.status === 'Payment Pending') &&
              element.current_order_id != null
            ) {
              localStorage.setItem(key, String(element.current_order_id));
            } else {
              localStorage.removeItem(key);
            }
          });
        } catch {}

        // 1) localStorage에서 우선 복원
        try {
          const tRaw = localStorage.getItem(`occupiedTimes_${selectedFloor}`);
          if (tRaw) setTableOccupiedTimes(JSON.parse(tRaw));
        } catch {}
        try {
          const nRaw = localStorage.getItem(`reservedNames_${selectedFloor}`);
          if (nRaw) setTableReservationNames(JSON.parse(nRaw));
        } catch {}

        // 2) 저장값이 없을 때만 초기 부팅 보정 (현재 시간을 시드)
        if (Object.keys(tableOccupiedTimes).length === 0) {
          const occupiedTimesSeed: Record<string, number> = {};
          patchedElements.forEach((element: any) => {
            if (element.status === 'Occupied' || element.status === 'Payment Pending') {
              // 시드가 없으면 현재시간으로, 있으면 유지
              const key = String(element.id);
              const existing = (() => { try { return JSON.parse(localStorage.getItem(`occupiedTimes_${selectedFloor}`) || '{}')[key]; } catch { return undefined; } })();
              occupiedTimesSeed[key] = existing || Date.now();
            }
          });
          if (Object.keys(occupiedTimesSeed).length > 0) {
            setTableOccupiedTimes(prev => ({ ...occupiedTimesSeed, ...prev }));
            try { localStorage.setItem(`occupiedTimes_${selectedFloor}`, JSON.stringify({ ...occupiedTimesSeed, ...tableOccupiedTimes })); } catch {}
          }
        }
      } else {
        console.warn('테이블 요소를 가져올 수 없습니다. 기본값을 사용합니다.');
        setTableElements([]);
      }

      // 화면 크기 설정 가져오기 (백오피스와 동일하게 사용)
      const screenResponse = await fetch(`http://localhost:3177/api/table-map/screen-size?floor=${encodeURIComponent(apiFloor)}&_ts=${Date.now()}` , { cache: 'no-store' as RequestCache });
      if (screenResponse.ok) {
        const screen = await screenResponse.json();
        // 백오피스에서 설정한 화면비/픽셀을 그대로 적용
        setScreenSize({ 
          width: String(screen.width), 
          height: String(screen.height), 
          scale: screen.scale || 1 
        });
      } else {
        console.warn('화면 크기를 가져올 수 없습니다. 백오피스와 동일한 기본값(1024x768)을 사용합니다.');
        setScreenSize({ width: '1024', height: '768', scale: 1 });
      }
    } catch (err) {
      console.error('데이터 가져오기 오류:', err);
      setError('데이터를 불러올 수 없습니다.');
    } finally {
      // 초기 로딩 시에만 로딩 상태 해제
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchTableMapData(true);  // 초기 로딩 시에만 로딩 스피너 표시
    
    // 테이블 상태 실시간 업데이트를 위한 타이머 (15초마다)
    const tableRefreshInterval = setInterval(() => {
      fetchTableMapData();  // 백그라운드 갱신 - 로딩 스피너 없음
    }, 15000);
    
    return () => clearInterval(tableRefreshInterval);
  }, [selectedFloor]); // selectedFloor가 변경될 때마다 데이터 다시 가져오기

  // Back Office 저장 신호(localStorage) 수신 시 재로드
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'tableMapUpdated' && e.newValue) {
        try {
          const payload = JSON.parse(e.newValue);
          if (!payload || typeof payload !== 'object') return;
          if (!payload.floor || payload.floor === selectedFloor) {
            fetchTableMapData();
          }
        } catch {}
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [selectedFloor]);

  // 라우팅 복귀/탭 가시성 변경 시 항상 화면 크기 재적용
  useEffect(() => {
    const onPageShow = () => fetchTableMapData();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') fetchTableMapData();
    };
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [selectedFloor]);

  // 창 포커스 시 재로드(동일 탭에서도 반영)
  useEffect(() => {
    const onFocus = () => {
      try {
        const raw = localStorage.getItem('tableMapUpdated');
        if (raw) {
          const payload = JSON.parse(raw);
          if (!payload || typeof payload !== 'object') return;
          if (!payload.floor || payload.floor === selectedFloor) {
            fetchTableMapData();
          }
        }
      } catch {}
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [selectedFloor]);

  // Occupied 테이블의 시간 업데이트
  useEffect(() => {
    const interval = setInterval(() => {
      setTableOccupiedTimes(prev => {
        const now = Date.now();
        const updated = { ...prev };
        
        // Occupied 상태인 테이블들의 시간 업데이트
        tableElements.forEach(table => {
          if (table.status === 'Occupied' && updated[String(table.id)]) {
            const elapsed = Math.floor((now - updated[String(table.id)]) / 1000 / 60); // 분 단위
            // 시간은 그대로 유지 (업데이트하지 않음)
          }
        });
        
        return updated;
      });
    }, 1000); // 1초마다 업데이트

    return () => clearInterval(interval);
  }, [tableElements]);

  // 요소 스타일 생성
  const getElementStyle = (element: TableElement) => {
    const isPressed = pressedTableId && String(pressedTableId) === String(element.id);
    const isSourceTable = isMoveMergeMode && sourceTableId === element.id;
    const status = element.status || 'Available';
    const isOccupied = status === 'Occupied';
    
    // 테이블 타입만 pointer 커서 적용
    const isClickable = element.type === 'rounded-rectangle' || element.type === 'circle';
    const rotationTransform = `rotate(${element.rotation}deg)`;
    
    const baseStyle: React.CSSProperties = {
      position: 'absolute',
      left: `${element.position.x * elementScale}px`,
      top: `${element.position.y * elementScale}px`,
      width: `${element.size.width * elementScale}px`,
      height: `${element.size.height * elementScale}px`,
      transform: rotationTransform,
      fontSize: `${Math.max(8, element.fontSize * elementScale)}px`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: isClickable ? 'pointer' : 'default',
      userSelect: 'none',
      border: '2px solid transparent',
      transition: 'all 0.2s ease',
    };

    // Move/Merge 모드에서 출발 테이블 하이라이트
    if (isSourceTable) {
      return {
        ...baseStyle,
        border: '5px solid #8B5CF6',
        boxShadow: '0 0 20px rgba(139, 92, 246, 0.8)',
        borderRadius: element.type === 'circle' ? '50%' : '8px',
        background: '#A78BFA',
        color: '#FFFFFF',
        fontWeight: 'bold',
      };
    }

    // Print Bill 모드에서 Occupied 테이블 하이라이트
    if (isBillPrintMode && isOccupied && isClickable) {
      return {
        ...baseStyle,
        border: '5px solid #10B981',
        boxShadow: '0 0 20px rgba(16, 185, 129, 0.8)',
        borderRadius: element.type === 'circle' ? '50%' : '8px',
        background: '#34D399',
        color: '#FFFFFF',
        fontWeight: 'bold',
      };
    }

    const applyPressedHighlight = (style: React.CSSProperties): React.CSSProperties => {
      if (!(isClickable && isPressed)) return style;
      return {
        ...style,
        background: '#ef4444',
        color: '#FFFFFF',
        filter: 'brightness(1.08)',
        boxShadow: 'inset 0 0 16px rgba(0,0,0,0.25)',
      };
    };

    // 요소 타입별 스타일 적용
    switch (element.type) {
      case 'rounded-rectangle': {
        // 상태별 테이블 색상 고정
        const status = element.status || 'Available';
        let backgroundStyle = '#3B82F6'; // Available: Blue (Restored)
        let borderColor: string | undefined = undefined;
        let borderWidth: string | undefined = undefined;

        if (status === 'Occupied') {
          backgroundStyle = '#ef4444'; // Occupied: Red (Restored)
        } else if (status === 'Payment Pending') {
          backgroundStyle = '#fb923c'; // Payment Pending: Bright Orange (Orange-400)
        } else if (status === 'Preparing') {
          backgroundStyle = '#9ca3af'; // Preparing: Silver/Gray (Gray-400)
        } else if (status === 'Hold') {
          backgroundStyle = '#9ca3af'; // Hold: Silver/Gray (Gray-400)
          borderColor = '#c2410c'; // Darker Orange border
          borderWidth = '6px';
        } else if (status === 'Reserved') {
          backgroundStyle = '#c2410c'; // Reserved: Darker Orange
        }

        return applyPressedHighlight({
          ...baseStyle,
          background: backgroundStyle,
          borderRadius: '8px',
          borderColor,
          borderWidth,
          color: getContrastColor(backgroundStyle),
          fontWeight: 'bold',
        });
      }
      case 'circle': {
        const status = element.status || 'Available';
        let backgroundStyle = '#3B82F6'; // Available: Blue (Restored)
        let borderColor: string | undefined = undefined;
        let borderWidth: string | undefined = undefined;
        if (status === 'Occupied') {
          backgroundStyle = '#ef4444'; // Occupied: Red (Restored)
        } else if (status === 'Payment Pending') {
          backgroundStyle = '#fb923c'; // Payment Pending: Bright Orange (Orange-400)
        } else if (status === 'Preparing') {
          backgroundStyle = '#9ca3af'; // Preparing: Silver/Gray (Gray-400)
        } else if (status === 'Hold') {
          backgroundStyle = '#9ca3af';
          borderColor = '#c2410c';
          borderWidth = '6px';
        } else if (status === 'Reserved') {
          backgroundStyle = '#c2410c'; // Reserved: Darker Orange
        }

        return applyPressedHighlight({
          ...baseStyle,
          background: backgroundStyle,
          borderRadius: '50%',
          borderColor,
          borderWidth,
          color: getContrastColor(backgroundStyle),
          fontWeight: 'bold',
        });
      }
      case 'entrance':
        return {
          ...baseStyle,
          backgroundColor: (element.status === 'Hold') ? '#EAB308' : (element.color || '#3B82F6'),
          color: 'white',
          fontWeight: 'bold',
          borderColor: element.status === 'Hold' ? '#F97316' : undefined,
          borderWidth: element.status === 'Hold' ? '6px' : undefined,
        };
      case 'counter':
        return {
          ...baseStyle,
          backgroundColor: 'transparent',
          borderRadius: '4px',
          color: 'inherit',
        };
      case 'restroom':
        return {
          ...baseStyle,
          backgroundColor: 'transparent',
          color: 'inherit',
        };
      case 'divider':
        return {
          ...baseStyle,
          backgroundColor: (element.status === 'Hold') ? '#EAB308' : (element.color || '#3B82F6'),
          color: getContrastColor(element.color || '#3B82F6'),
          borderColor: element.status === 'Hold' ? '#F97316' : undefined,
          borderWidth: element.status === 'Hold' ? '6px' : undefined,
        };
      case 'wall':
        return {
          ...baseStyle,
          backgroundColor: (element.status === 'Hold') ? '#EAB308' : (element.color || '#3B82F6'),
          color: getContrastColor(element.color || '#3B82F6'),
          borderColor: element.status === 'Hold' ? '#F97316' : undefined,
          borderWidth: element.status === 'Hold' ? '6px' : undefined,
        };
      case 'cook-area':
        return {
          ...baseStyle,
          backgroundColor: (element.status === 'Hold') ? '#EAB308' : (element.color || '#3B82F6'),
          color: getContrastColor(element.color || '#3B82F6'),
          fontWeight: 'bold',
          borderColor: element.status === 'Hold' ? '#F97316' : undefined,
          borderWidth: element.status === 'Hold' ? '6px' : undefined,
        };
      default:
        return {
          ...baseStyle,
          backgroundColor: (element.status === 'Hold') ? '#EAB308' : (element.color || '#3B82F6'),
          color: getContrastColor(element.color || '#3B82F6'),
          borderColor: element.status === 'Hold' ? '#F97316' : undefined,
          borderWidth: element.status === 'Hold' ? '6px' : undefined,
        };
    }
  };

  // BO와 동일한 입체효과 및 모양 클래스 적용
  const getElementClass = (element: TableElement) => {
    const baseStyle = ['restroom', 'counter'].includes(element.type)
      ? ''
      : 'shadow-[inset_3px_3px_8px_rgba(255,255,255,0.3),inset_-3px_-3px_8px_rgba(0,0,0,0.3),0_2px_4px_rgba(0,0,0,0.2)] hover:shadow-[inset_-3px_-3px_8px_rgba(255,255,255,0.3),inset_3px_3px_8px_rgba(0,0,0,0.3),0_2px_4px_rgba(0,0,0,0.2)] hover:scale-105 active:scale-95 active:shadow-[inset_4px_4px_10px_rgba(255,255,255,0.2),inset_-4px_-4px_10px_rgba(0,0,0,0.4),0_1px_2px_rgba(0,0,0,0.3)] transition-all duration-300';

    let shapeClass = '';
    switch (element.type) {
      case 'rounded-rectangle':
        shapeClass = 'rounded-2xl';
        break;
      case 'circle':
        shapeClass = 'rounded-full';
        break;
      case 'entrance':
      case 'wall':
      case 'cook-area':
      case 'other':
        shapeClass = 'rounded-xl';
        break;
      case 'divider':
        shapeClass = 'rounded-full';
        break;
      case 'floor-label':
        shapeClass = 'rounded-lg';
        break;
      default:
        shapeClass = 'rounded-xl';
    }
    const isPressed = pressedTableId && String(pressedTableId) === String(element.id);
    const pressedClass = isPressed ? 'bg-red-500 text-white transition-colors duration-200' : '';
    return `${shapeClass} ${baseStyle} ${pressedClass}`.trim();
  };

  // 텍스트 색상 대비 계산
  const getContrastColor = (hexColor: string) => {
    const hex = hexColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 128 ? '#000000' : '#FFFFFF';
  };

  // 간단한 색상 어둡게 처리
  const darkenColor = (hexColor: string, amount: number) => {
    const hex = hexColor.replace('#', '');
    const r = Math.max(0, Math.min(255, Math.round(parseInt(hex.substr(0, 2), 16) * (1 - amount))));
    const g = Math.max(0, Math.min(255, Math.round(parseInt(hex.substr(2, 2), 16) * (1 - amount))));
    const b = Math.max(0, Math.min(255, Math.round(parseInt(hex.substr(4, 2), 16) * (1 - amount))));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  };

  // 테이블 상태 변경 (release 시 동작)
  const handleTableClick = async (element: TableElement) => {
    const clickTime = performance.now();
    console.log('🖱️ 테이블 클릭!', element.text, clickTime);
    
    if (!(element.type === 'rounded-rectangle' || element.type === 'circle')) return;

    // Print Bill 모드 처리
    if (isBillPrintMode) {
      const status = element.status || 'Available';
      if (status === 'Occupied') {
        await printBillForTable(element);
      } else {
        setBillPrintStatus('❌ Only occupied tables can print bills');
        setTimeout(() => setBillPrintStatus(''), 2000);
      }
      return;
    }

    // Move/Merge 모드 처리
    if (isMoveMergeMode) {
      await handleMoveMergeTableClick(element);
      return;
    }

    try {
      // Assign-from-waiting flow: clicking a table reserves it for the selected waiting entry
      if (selectedWaitingEntry) {
        await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(String(element.id))}/status`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Reserved' })
        });
        // update local state
        setTableElements(prev => prev.map(el => String(el.id) === String(element.id) ? { ...el, status: 'Reserved' } : el));
        // save reservation name locally so it shows on the label
        const customerName = String(selectedWaitingEntry.customer_name || selectedWaitingEntry.name || '').trim();
        if (customerName) {
          setTableReservationNames(prev => {
            const next = { ...prev, [String(element.id)]: customerName };
            try { localStorage.setItem(`reservedNames_${selectedFloor}`, JSON.stringify(next)); } catch {}
            return next;
          });
        }
        setSelectedWaitingEntry(null);
        setShowWaitingModal(false);
        return;
      }
      const currentStatus = element.status || 'Available';
      
      if (currentStatus === 'Available') {
        // Available: Do NOT change to Occupied immediately. Only navigate.
        // Status will change to Occupied when order is saved.
        navigate('/sales/order', {
          state: {
            orderType: 'POS',
            menuId: defaultMenu.menuId,
            menuName: defaultMenu.menuName,
            tableId: element.id,
            tableLabel: element.text,
            floor: selectedFloor,
            loadExisting: false
          }
        });
      } else if (currentStatus === 'Reserved') {
        // Reserved → Occupied (즉시 변경)
        await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(String(element.id))}/status`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Occupied' })
        });
        setTableElements(prev => prev.map(el => String(el.id) === String(element.id) ? { ...el, status: 'Occupied', current_order_id: null as any } : el));
        setOccupiedTimestamp(element.id, Date.now());
        try { localStorage.setItem('lastOccupiedTable', JSON.stringify({ tableId: element.id, floor: selectedFloor, status: 'Occupied', ts: Date.now() })); } catch {}
        
        // 주문창으로 이동
        navigate('/sales/order', {
          state: {
            orderType: 'POS',
            menuId: defaultMenu.menuId,
            menuName: defaultMenu.menuName,
            tableId: element.id,
            tableLabel: element.text,
            floor: selectedFloor,
            loadExisting: Boolean((element as any).current_order_id)
          }
        });
      } else if (currentStatus === 'Preparing') {
        // Preparing → Available (청소 완료)
        await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(String(element.id))}/status`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Available' })
        });
        setTableElements(prev => prev.map(el => String(el.id) === String(element.id) ? { ...el, status: 'Available', current_order_id: null as any } : el));
        clearOccupiedTimestamp(element.id);
        
        // Reset table-specific LocalStorage to prevent ghost guests on next order
        try {
          localStorage.removeItem(`splitGuests_${element.id}`);
          localStorage.removeItem(`paidGuests_${element.id}`);
          localStorage.removeItem(`voidDisplay_${element.id}`);
          localStorage.removeItem(`lastOrderIdByTable_${element.id}`);
        } catch (e) {}

        try { localStorage.setItem('lastOccupiedTable', JSON.stringify({ tableId: element.id, floor: selectedFloor, status: 'Available', ts: Date.now() })); } catch {}
        clearServerAssignment('table', element.id);
      } else if (currentStatus === 'Hold') {
        // Hold (그라데이션) → Occupied + 주문페이지로 이동
        await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(String(element.id))}/status`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Occupied' })
        });
        setTableElements(prev => prev.map(el => String(el.id) === String(element.id) ? { ...el, status: 'Occupied', current_order_id: null as any } : el));
        setOccupiedTimestamp(element.id, Date.now());
        try { localStorage.setItem('lastOccupiedTable', JSON.stringify({ tableId: element.id, floor: selectedFloor, status: 'Occupied', ts: Date.now() })); } catch {}
        
        // 즉시 주문페이지로 이동
        console.log('🚀 테이블 클릭 → OrderPage 이동 시작', performance.now());
        navigate('/sales/order', {
          state: {
            orderType: 'POS',
            menuId: defaultMenu.menuId,
            menuName: defaultMenu.menuName,
            tableId: element.id,
            tableLabel: element.text,
            floor: selectedFloor,
            loadExisting: Boolean((element as any).current_order_id)
          }
        });
      } else {
        // Occupied 상태일 때는 주문 페이지로 이동
        // 최신 상태에서 current_order_id 가져오기 (React 비동기 상태 업데이트 대응)
        const latestElement = tableElements.find(el => String(el.id) === String(element.id));
        const currentStatus = latestElement?.status || element.status;
        const effectiveOrderId = latestElement?.current_order_id || (element as any).current_order_id;
        
        // Occupied 상태라면 주문이 있다고 가정 (안전장치)
        const hasOrder = Boolean(effectiveOrderId) || currentStatus === 'Occupied';
        
        console.log('🚀 테이블 클릭 → OrderPage 이동 시작', performance.now(), { 
          status: currentStatus,
          hasOrder, 
          latestOrderId: effectiveOrderId 
        });
        
        navigate('/sales/order', {
          state: {
            orderType: 'POS',
            menuId: defaultMenu.menuId,
            menuName: defaultMenu.menuName,
            tableId: element.id,
            tableLabel: element.text,
            floor: selectedFloor,
            loadExisting: hasOrder
          }
        });
      }
    } catch (e) {
      console.warn('handleTableClick failed:', e);
    } finally {
      setPressedTableId(prev => (prev === String(element.id) ? null : prev));
    }
  };

  /**
   * Print Bill for Table
   * 테이블의 현재 주문에 대해 Bill(영수증)을 출력합니다.
   */
  const printBillForTable = async (element: TableElement) => {
    const tableLabel = element.text || `Table ${element.id}`;
    setBillPrintStatus(`🔄 Printing bill for ${tableLabel}...`);

    try {
      // 1. 테이블의 주문 정보 가져오기
      const orderId = (element as any).current_order_id;
      if (!orderId) {
        setBillPrintStatus(`❌ No order found for ${tableLabel}`);
        setTimeout(() => setBillPrintStatus(''), 2000);
        return;
      }

      // 2. 주문 상세 정보 및 아이템 가져오기 (단일 API 호출)
      const orderResponse = await fetch(`${API_URL}/orders/${orderId}`);
      if (!orderResponse.ok) {
        throw new Error('Failed to fetch order');
      }
      const orderData = await orderResponse.json();
      
      if (!orderData.success) {
        throw new Error(orderData.error || 'Failed to fetch order');
      }

      const items = orderData.items || [];

      if (!items || items.length === 0) {
        setBillPrintStatus(`❌ No items found for ${tableLabel}`);
        setTimeout(() => setBillPrintStatus(''), 2000);
        return;
      }

      // 4. Store 정보 가져오기 (business profile)
      const storeResponse = await fetch(`${API_URL}/admin-settings/business-profile`);
      const storeData = await storeResponse.json();
      const store = {
        name: storeData?.business_name || 'Restaurant',
        address: [storeData?.address_line1, storeData?.address_line2, storeData?.city, storeData?.state, storeData?.zip].filter(Boolean).join(', ') || '',
        phone: storeData?.phone || ''
      };

      // 5. Tax 정보 가져오기
      const taxResponse = await fetch(`${API_URL}/taxes`);
      const taxes = await taxResponse.json();
      const activeTaxes = Array.isArray(taxes) ? taxes.filter((t: any) => !t.is_deleted) : [];
      const taxRate = activeTaxes.length > 0 
        ? (parseFloat(activeTaxes[0].rate) > 1 ? parseFloat(activeTaxes[0].rate) / 100 : parseFloat(activeTaxes[0].rate)) 
        : 0.05;

      // 6. Guest별로 아이템 그룹화
      const byGuest: { [guestNumber: number]: any[] } = {};
      items.forEach((item: any) => {
        const guestNum = item.guest_number || 1;
        if (!byGuest[guestNum]) byGuest[guestNum] = [];
        const itemPrice = item.price || 0;
        const itemQty = item.quantity || 1;
        byGuest[guestNum].push({
          name: item.name || 'Unknown Item',
          quantity: itemQty,
          unitPrice: itemPrice,
          total: itemQty * itemPrice,
          modifiers: item.modifiers_json ? (typeof item.modifiers_json === 'string' ? JSON.parse(item.modifiers_json) : item.modifiers_json) : []
        });
      });

      // 7. 금액 계산
      const subtotal = items.reduce((sum: number, item: any) => {
        const price = item.price || 0;
        const qty = item.quantity || 1;
        return sum + (price * qty);
      }, 0);

      const taxesTotal = subtotal * taxRate;
      const total = subtotal + taxesTotal;

      // 8. 영수증 데이터 구성
      const now = new Date();
      const order = orderData.order || orderData;
      const fullReceipt = {
        type: 'prebill',
        header: { 
          title: store.name, 
          address: store.address, 
          phone: store.phone, 
          dateTime: now.toISOString(), 
          orderNumber: order.order_number || orderId 
        },
        orderInfo: { 
          channel: 'POS', 
          table: tableLabel 
        },
        body: { 
          guestSections: Object.keys(byGuest).sort((a, b) => Number(a) - Number(b)).map(k => ({ 
            guestNumber: Number(k), 
            items: byGuest[Number(k)] 
          })), 
          subtotal, 
          adjustments: [], 
          taxLines: [{ name: activeTaxes[0]?.name || 'Tax', rate: taxRate, amount: taxesTotal }], 
          taxesTotal, 
          total 
        },
        footer: { message: 'Thank you for dining with us!' }
      };

      // 9. 프린터로 출력
      const printResponse = await fetch(`${API_URL}/printers/print`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ printerGroupId: 'RECEIPT', items: fullReceipt }) 
      });

      if (printResponse.ok) {
        setBillPrintStatus(`✅ Bill printed for ${tableLabel}`);
        setTimeout(() => {
          setIsBillPrintMode(false);
          setBillPrintStatus('');
        }, 1500);
      } else {
        const printError = await printResponse.json();
        throw new Error(printError.error || 'Print failed');
      }
    } catch (error: any) {
      console.error('Print bill error:', error);
      setBillPrintStatus(`❌ Print failed: ${error.message}`);
      setTimeout(() => setBillPrintStatus(''), 3000);
    }
  };

  /**
   * Order List 관련 함수들
   */
  const fetchOrderList = async (date: string) => {
    console.log('[fetchOrderList] Fetching orders for date:', date);
    console.log('[fetchOrderList] API URL:', `${API_URL}/orders?date=${date}`);
    setOrderListLoading(true);
    try {
      const response = await fetch(`${API_URL}/orders?date=${date}`);
      const data = await response.json();
      console.log('[fetchOrderList] Response:', data);
      console.log('[fetchOrderList] Orders count:', data.orders?.length || 0);
      if (data.success && Array.isArray(data.orders)) {
        setOrderListOrders(data.orders);
      } else if (Array.isArray(data)) {
        setOrderListOrders(data);
      } else {
        setOrderListOrders([]);
      }
    } catch (error) {
      console.error('Failed to fetch order list:', error);
      setOrderListOrders([]);
    } finally {
      setOrderListLoading(false);
    }
  };

  const fetchOrderDetails = async (orderId: number) => {
    try {
      const response = await fetch(`${API_URL}/orders/${orderId}`);
      const data = await response.json();
      if (data.success) {
        setOrderListSelectedOrder({ ...data.order, adjustments: data.adjustments || [] });
        setOrderListSelectedItems(data.items || []);
      }
    } catch (error) {
      console.error('Failed to fetch order details:', error);
    }
  };

  const handleOrderListDateChange = (days: number) => {
    const current = new Date(orderListDate);
    current.setDate(current.getDate() + days);
    const newDate = current.toISOString().split('T')[0];
    setOrderListDate(newDate);
    setOrderListSelectedOrder(null);
    setOrderListSelectedItems([]);
    fetchOrderList(newDate);
  };

  const handleOrderListPrintBill = async () => {
    if (!orderListSelectedOrder) return;
    
    try {
      // Store 정보 가져오기
      const storeResponse = await fetch(`${API_URL}/admin-settings/business-profile`);
      const storeData = await storeResponse.json();
      const store = {
        name: storeData?.business_name || 'Restaurant',
        address: [storeData?.address_line1, storeData?.address_line2, storeData?.city, storeData?.state, storeData?.zip].filter(Boolean).join(', ') || '',
        phone: storeData?.phone || ''
      };

      // Tax 정보 가져오기
      const taxResponse = await fetch(`${API_URL}/taxes`);
      const taxes = await taxResponse.json();
      const activeTaxes = Array.isArray(taxes) ? taxes.filter((t: any) => !t.is_deleted) : [];
      const taxRate = activeTaxes.length > 0 
        ? (parseFloat(activeTaxes[0].rate) > 1 ? parseFloat(activeTaxes[0].rate) / 100 : parseFloat(activeTaxes[0].rate)) 
        : 0.05;

      // Guest별로 아이템 그룹화
      const byGuest: { [guestNumber: number]: any[] } = {};
      orderListSelectedItems.forEach((item: any) => {
        const guestNum = item.guest_number || 1;
        if (!byGuest[guestNum]) byGuest[guestNum] = [];
        const itemPrice = item.price || 0;
        const itemQty = item.quantity || 1;
        byGuest[guestNum].push({
          name: item.name || 'Unknown Item',
          quantity: itemQty,
          unitPrice: itemPrice,
          total: itemQty * itemPrice,
          modifiers: item.modifiers_json ? (typeof item.modifiers_json === 'string' ? JSON.parse(item.modifiers_json) : item.modifiers_json) : []
        });
      });

      const subtotal = orderListSelectedItems.reduce((sum: number, item: any) => sum + ((item.price || 0) * (item.quantity || 1)), 0);
      const taxesTotal = subtotal * taxRate;
      const total = subtotal + taxesTotal;

      const now = new Date();
      const fullReceipt = {
        type: 'prebill',
        header: { 
          title: store.name, 
          address: store.address, 
          phone: store.phone, 
          dateTime: now.toISOString(), 
          orderNumber: orderListSelectedOrder.order_number || orderListSelectedOrder.id 
        },
        orderInfo: { 
          channel: orderListSelectedOrder.order_type || 'POS', 
          table: orderListSelectedOrder.table_id || undefined 
        },
        body: { 
          guestSections: Object.keys(byGuest).sort((a, b) => Number(a) - Number(b)).map(k => ({ 
            guestNumber: Number(k), 
            items: byGuest[Number(k)] 
          })), 
          subtotal, 
          adjustments: [], 
          taxLines: [{ name: activeTaxes[0]?.name || 'Tax', rate: taxRate, amount: taxesTotal }], 
          taxesTotal, 
          total 
        },
        footer: { message: 'Thank you for dining with us!' }
      };

      await fetch(`${API_URL}/printers/print`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ printerGroupId: 'RECEIPT', items: fullReceipt }) 
      });
      
      alert('Bill printed successfully!');
    } catch (error: any) {
      console.error('Print bill error:', error);
      alert(`Print failed: ${error.message}`);
    }
  };

  const handleOrderListPrintKitchen = async () => {
    if (!orderListSelectedOrder || orderListSelectedItems.length === 0) return;
    
    try {
      // 아이템별 프린터 그룹 설정에 따라 분기 출력
      const kitchenItems = orderListSelectedItems.map((item: any) => ({
        item_id: item.item_id, // 프린터 그룹 조회를 위해 item_id 포함
        name: item.name || 'Unknown Item',
        quantity: item.quantity || 1,
        modifiers: item.modifiers_json ? (typeof item.modifiers_json === 'string' ? JSON.parse(item.modifiers_json) : item.modifiers_json) : [],
        memo: item.memo_json ? (typeof item.memo_json === 'string' ? JSON.parse(item.memo_json) : item.memo_json) : null
      }));

      const response = await fetch(`${API_URL}/printers/print-kitchen-by-group`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ 
          orderId: orderListSelectedOrder.id,
          items: kitchenItems,
          orderInfo: {
            orderNumber: orderListSelectedOrder.order_number || orderListSelectedOrder.id,
            table: orderListSelectedOrder.table_id,
            orderType: orderListSelectedOrder.order_type
          }
        }) 
      });
      
      const result = await response.json();
      
      if (result.success) {
        let message = 'Sent to kitchen!';
        if (result.unassignedItems && result.unassignedItems.length > 0) {
          message += `\n\n⚠️ Warning: ${result.unassignedItems.length} items have no printer group:\n${result.unassignedItems.join(', ')}`;
        }
        alert(message);
      } else {
        alert(`Print result: ${result.message || 'Partial success'}`);
      }
    } catch (error: any) {
      console.error('Print kitchen error:', error);
      alert(`Print failed: ${error.message}`);
    }
  };

  // Order List Modal Helper Functions (moved outside to prevent re-creation on every render)
  const orderListFormatTime = (dateStr: string) => {
      if (!dateStr) return '--:--';
      const d = new Date(dateStr);
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    };

  const orderListFormatDate = (dateStr: string) => {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    };

  const orderListGetChannelDisplay = (order: any) => {
      const type = (order.order_type || '').toUpperCase();
      if (type === 'UBEREATS' || type === 'UBER') return 'UberEats';
      if (type === 'DOORDASH') return 'DoorDash';
      if (type === 'SKIP' || type === 'SKIPTHEDISHES') return 'SkipTheDishes';
      if (type === 'TOGO') return 'Togo';
      if (type === 'DELIVERY') return 'Delivery';
      return type || 'POS';
    };

  const orderListGetTableOrCustomer = (order: any) => {
      const parts: string[] = [];
      if (order.table_id) parts.push(`Table ${order.table_id}`);
      if (order.customer_name) parts.push(order.customer_name);
      if (order.customer_phone) parts.push(order.customer_phone);
      return parts.length > 0 ? parts.join(' / ') : '-';
    };

  // 채널 띠지 (badge) 정보 반환
  const orderListGetChannelBadge = (order: any): { label: string; bgColor: string; textColor: string } => {
    const type = (order.order_type || '').toUpperCase();
    
    // Online 채널 (UberEats, DoorDash, Skip, Online, Web, QR)
    if (type === 'UBEREATS' || type === 'UBER' || type === 'DOORDASH' || type === 'SKIP' || type === 'SKIPTHEDISHES' || type === 'ONLINE' || type === 'WEB' || type === 'QR') {
      return { label: 'Online', bgColor: 'bg-purple-500', textColor: 'text-white' };
    }
    
    // Delivery 채널
    if (type === 'DELIVERY') {
      return { label: 'Delivery', bgColor: 'bg-orange-500', textColor: 'text-white' };
    }
    
    // Togo 채널 (Togo, Pickup, Takeout)
    if (type === 'TOGO' || type === 'PICKUP' || type === 'TAKEOUT') {
      return { label: 'Togo', bgColor: 'bg-teal-500', textColor: 'text-white' };
    }
    
    // Dine-in (기본값 - Table Order 포함)
    return { label: 'Dine-in', bgColor: 'bg-blue-600', textColor: 'text-white' };
  };

  const orderListCalculateTotals = () => {
      const subtotal = orderListSelectedItems.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0);
      const adjustments = orderListSelectedOrder?.adjustments || [];
      const discountTotal = adjustments
        .filter((a: any) => String(a.kind).toUpperCase() === 'DISCOUNT')
        .reduce((sum: number, a: any) => sum + Math.abs(Number(a.amount_applied || 0)), 0);
      const subtotalAfterDiscount = subtotal - discountTotal;
      const tax = orderListSelectedOrder?.total ? (Number(orderListSelectedOrder.total) - subtotalAfterDiscount) : subtotalAfterDiscount * 0.05;
      const total = orderListSelectedOrder?.total || (subtotalAfterDiscount + tax);
      
      return { subtotal, discountTotal, subtotalAfterDiscount, tax, total };
    };

  const orderListGetDaysInMonth = (date: Date) => {
      const year = date.getFullYear();
      const month = date.getMonth();
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      const days: (Date | null)[] = [];
      
      // Add empty slots for days before first day of month
      for (let i = 0; i < firstDay.getDay(); i++) {
        days.push(null);
      }
      
      // Add all days of the month
      for (let d = 1; d <= lastDay.getDate(); d++) {
        days.push(new Date(year, month, d));
      }
      
      return days;
    };

  const orderListHandleCalendarDateSelect = (date: Date) => {
      const dateStr = date.toISOString().split('T')[0];
      setOrderListDate(dateStr);
      setShowOrderListCalendar(false);
      setOrderListSelectedOrder(null);
      setOrderListSelectedItems([]);
      fetchOrderList(dateStr);
  };

  /**
   * ⚠️ PROTECTED FUNCTION - Table Move/Merge Operations ⚠️
   * 
   * 기존 테이블 이동/병합 기능을 유지하면서 가상 주문 선택 흐름과 통합합니다.
   */
  const handleMoveMergeTableClick = async (element: TableElement) => {
    const tableLabel = element.text || `Table ${element.id}`;
    
    // Togo/Online → 테이블 이동/머지
    if (sourceTogoOrder || sourceOnlineOrder) {
      const sourceOrder = sourceTogoOrder || sourceOnlineOrder;
      const sourceType = sourceTogoOrder ? 'Togo' : 'Online';
      const sourceLabel = sourceTogoOrder 
        ? `Togo #${sourceTogoOrder.id}`
        : `Online #${sourceOnlineOrder.number ?? sourceOnlineOrder.id}`;
      
      // Available 테이블 → Move (이동)
      if (element.status === 'Available') {
        try {
          setMoveMergeStatus(`🔄 ${sourceLabel} → ${tableLabel} 이동 중...`);
          
          const response = await fetch(`${API_URL}/table-operations/move-togo-to-table`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fromOrderId: sourceOrder.id,
              toTableId: element.id,
              floor: selectedFloor,
            }),
          });
          
          const result = await response.json();
          
          if (response.ok && result.success) {
            // 1. 즉시 로컬 상태 업데이트 (테이블 색상 즉시 변경)
            setTableElements(prev => prev.map(el => {
              if (String(el.id) === String(element.id)) {
                return { ...el, status: 'Occupied', current_order_id: result.newOrderId };
              }
              return el;
            }));
            
            // 2. LocalStorage 및 점유 시간 업데이트
            const now = Date.now();
            setOccupiedTimestamp(element.id, now); // 로컬 상태 업데이트 (즉시 타이머 표시)
            
            try {
              localStorage.setItem(`lastOrderIdByTable_${element.id}`, String(result.newOrderId));
              localStorage.setItem('lastOccupiedTable', JSON.stringify({ 
                tableId: element.id, 
                floor: selectedFloor, 
                status: 'Occupied', 
                ts: now 
              }));
            } catch (e) {
              console.warn('Failed to update localStorage:', e);
            }
            
            setSourceTogoOrder(null);
            setSourceOnlineOrder(null);
            setIsMoveMergeMode(false);
            clearMoveMergeSelection();
            loadTogoOrders();
            
            setMoveMergeStatus(`✅ ${sourceLabel} → ${tableLabel} 이동 완료`);
            setTimeout(() => setMoveMergeStatus(''), 800);
          } else {
            setMoveMergeStatus(`❌ 이동 실패: ${result.error || result.details || 'Unknown error'}`);
            setTimeout(() => {
              setMoveMergeStatus('');
              clearMoveMergeSelection();
            }, 3000);
          }
        } catch (error: any) {
          console.error(`${sourceType} to Table move error:`, error);
          setMoveMergeStatus(`❌ 오류: ${error.message}`);
          setTimeout(() => {
            setMoveMergeStatus('');
            clearMoveMergeSelection();
          }, 3000);
        }
        return;
      }
      
      // Occupied 테이블 → Merge (병합)
      if (element.status === 'Occupied') {
        try {
          setMoveMergeStatus(`🔄 ${sourceLabel} → ${tableLabel} 머지 중...`);
          
          const response = await fetch(`${API_URL}/table-operations/merge-togo-to-table`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fromOrderId: sourceOrder.id,
              toTableId: element.id,
              floor: selectedFloor,
            }),
          });
          
          const result = await response.json();
          
          if (response.ok && result.success) {
            setSourceTogoOrder(null);
            setSourceOnlineOrder(null);
            setIsMoveMergeMode(false);
            clearMoveMergeSelection();
            loadTogoOrders();
            
            // 테이블맵 데이터 서버에서 새로고침 (동기화)
            try {
              const mapRes = await fetch(`${API_URL}/table-map/elements?floor=${selectedFloor}`);
              if (mapRes.ok) {
                const mapData = await mapRes.json();
                if (mapData.elements && mapData.elements.length > 0) {
                  setTableElements(mapData.elements);
                }
              }
            } catch (e) {
              console.error('Failed to refresh table map:', e);
            }
            
            setMoveMergeStatus(`✅ ${sourceLabel} → ${tableLabel} 머지 완료`);
            setTimeout(() => setMoveMergeStatus(''), 800);
          } else {
            setMoveMergeStatus(`❌ 머지 실패: ${result.error || result.details || 'Unknown error'}`);
            setTimeout(() => {
              setMoveMergeStatus('');
              clearMoveMergeSelection();
            }, 3000);
          }
        } catch (error: any) {
          console.error(`${sourceType} to Table merge error:`, error);
          setMoveMergeStatus(`❌ 오류: ${error.message}`);
          setTimeout(() => {
            setMoveMergeStatus('');
            clearMoveMergeSelection();
          }, 3000);
        }
        return;
      }
      
      // 다른 상태의 테이블
      setMoveMergeStatus('❌ 목적 테이블은 Available 또는 Occupied 상태여야 합니다.');
      setTimeout(() => setMoveMergeStatus(''), 2000);
      return;
    }
    
    // 첫 번째 클릭: 출발 테이블 선택 (Occupied만 가능)
    if (!sourceTableId) {
      if (element.status !== 'Occupied') {
        setMoveMergeStatus('❌ 출발 테이블은 Occupied 상태여야 합니다.');
        setTimeout(() => setMoveMergeStatus(''), 3000);
        return;
      }
      setSourceTableId(element.id);
      setMoveMergeStatus(`✓ 출발 테이블: ${tableLabel} → 목적 테이블을 선택하세요`);
      beginSourceSelection(element, tableLabel);
      return;
    }

    // 두 번째 클릭: 목적 테이블 선택
    if (sourceTableId === element.id) {
      setMoveMergeStatus('❌ 같은 테이블을 선택할 수 없습니다.');
      setTimeout(() => {
        clearMoveMergeSelection();
        setMoveMergeStatus('');
      }, 2000);
      return;
    }

    if (!selectionChoice) {
      setMoveMergeStatus('먼저 이동할 게스트/아이템을 선택해주세요.');
      return;
    }

    // MOVE: Occupied → Available
    if (element.status === 'Available') {
      try {
        setMoveMergeStatus('🔄 테이블 이동 중...');
        const response = await fetch(`${API_URL}/table-operations/move`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromTableId: sourceTableId,
            toTableId: element.id,
            floor: selectedFloor,
            partialSelection:
              selectionChoice && selectionChoice !== 'ALL'
                ? {
                    mode: 'partial',
                    guestNumbers: selectionChoice.guestNumbers,
                    orderItemIds: selectionChoice.orderItemIds,
                    orderLineIds: selectionChoice.orderLineIds,
                  }
                : undefined,
          })
        });

        const result = await response.json();

        if (result.success) {
          const isPartial = Boolean(result.partial);
          const fromStatus = result.fromTable?.status || (isPartial ? 'Occupied' : 'Preparing');
          const toStatus = result.toTable?.status || 'Occupied';
          const targetOrderId = result.toTable?.orderId ?? null;
          setMoveMergeStatus(result.message ? `✅ ${result.message}` : `✅ 테이블 이동 완료: ${sourceTableId} → ${element.text}`);
          
          setTableElements(prev => prev.map(el => {
            if (String(el.id) === String(sourceTableId)) {
              const next = { ...el, status: fromStatus };
              if (fromStatus !== 'Occupied') {
                next.current_order_id = null;
              }
              return next;
            }
            if (String(el.id) === String(element.id)) {
              return { ...el, status: toStatus, current_order_id: targetOrderId ?? el.current_order_id };
            }
            return el;
          }));
          
          // 1. Transfer Data (Only for Full Move)
          if (!isPartial) {
            try {
              const sourceOrderId = localStorage.getItem(`lastOrderIdByTable_${sourceTableId}`);
              if (sourceOrderId) {
                localStorage.setItem(`lastOrderIdByTable_${element.id}`, sourceOrderId);
                console.log(`[MOVE] 주문 ID ${sourceOrderId}를 테이블 ${sourceTableId}에서 ${element.id}로 이동`);
              }
              
              const splitGuests = localStorage.getItem(`splitGuests_${sourceTableId}`);
              if (splitGuests) {
                localStorage.setItem(`splitGuests_${element.id}`, splitGuests);
              }
              
              const voidDisplay = localStorage.getItem(`voidDisplay_${sourceTableId}`);
              if (voidDisplay) {
                localStorage.setItem(`voidDisplay_${element.id}`, voidDisplay);
              }
              
              const paidGuests = localStorage.getItem(`paidGuests_${sourceTableId}`);
              if (paidGuests) {
                localStorage.setItem(`paidGuests_${element.id}`, paidGuests);
              }
              
              const occupiedTimesKey = `occupiedTimes_${selectedFloor}`;
              const occupiedTimesRaw = localStorage.getItem(occupiedTimesKey);
              if (occupiedTimesRaw) {
                const occupiedTimes = JSON.parse(occupiedTimesRaw);
                const sourceTime = occupiedTimes[String(sourceTableId)];
                if (sourceTime) {
                  occupiedTimes[String(element.id)] = sourceTime;
                  delete occupiedTimes[String(sourceTableId)];
                  localStorage.setItem(occupiedTimesKey, JSON.stringify(occupiedTimes));
                  
                  setTableOccupiedTimes(prev => {
                    const next = { ...prev };
                    next[String(element.id)] = sourceTime;
                    delete next[String(sourceTableId)];
                    return next;
                  });
                }
              }
            } catch (e) {
              console.warn('[MOVE] localStorage 업데이트 실패:', e);
            }
          }

          // ALWAYS clean up UI cache for source table to prevent stale data
          try {
            localStorage.removeItem(`splitGuests_${sourceTableId}`);
            localStorage.removeItem(`paidGuests_${sourceTableId}`);
          } catch(e) {}

          // 2. Cleanup Source (Universal)
          if (fromStatus !== 'Occupied') {
            try {
              localStorage.removeItem(`lastOrderIdByTable_${sourceTableId}`);
              localStorage.removeItem(`voidDisplay_${sourceTableId}`);

              // Cleanup occupied time if not transferred (or duplicate safety)
              const occupiedTimesKey = `occupiedTimes_${selectedFloor}`;
              const occupiedTimesRaw = localStorage.getItem(occupiedTimesKey);
              if (occupiedTimesRaw) {
                const occupiedTimes = JSON.parse(occupiedTimesRaw);
                if (occupiedTimes[String(sourceTableId)]) {
                  delete occupiedTimes[String(sourceTableId)];
                  localStorage.setItem(occupiedTimesKey, JSON.stringify(occupiedTimes));
                  setTableOccupiedTimes(prev => {
                    const next = { ...prev };
                    delete next[String(sourceTableId)];
                    return next;
                  });
                }
              }
            } catch (e) {
              console.warn('[MOVE] cleanup failed', e);
            }
          }

          // 3. Cleanup Target/Partial Specifics
          if (isPartial) {
            try {
              // Partial move invalidates split/paid status on target usually
              localStorage.removeItem(`paidGuests_${element.id}`);
              localStorage.removeItem(`splitGuests_${element.id}`);
              
              if (targetOrderId) {
                localStorage.removeItem(`paidGuests_order_${targetOrderId}`);
                localStorage.setItem(`lastOrderIdByTable_${element.id}`, String(targetOrderId));
              } else {
                localStorage.removeItem(`lastOrderIdByTable_${element.id}`);
              }
            } catch (e) {
              console.warn('[MOVE] partial localStorage cleanup failed', e);
            }
          }
          
          try {
            localStorage.setItem('lastOccupiedTable', JSON.stringify({ 
              tableId: element.id, 
              floor: selectedFloor, 
              status: toStatus, 
              ts: Date.now() 
            }));
          } catch {}
          
          setSourceTableId(null);
            setMoveMergeStatus('');
          setIsMoveMergeMode(false);
          clearMoveMergeSelection();
          
          // 테이블 목록 다시 로드 (서버와 동기화)
          await fetchTableMapData();
        } else {
          console.error('[MOVE] Error details:', result);
          setMoveMergeStatus(`❌ 이동 실패: ${result.details || result.error}`);
          setTimeout(() => {
            setSourceTableId(null);
            setMoveMergeStatus('');
            clearMoveMergeSelection();
          }, 3000);
        }
      } catch (error: any) {
        console.error('Move table error:', error);
        setMoveMergeStatus(`❌ 오류: ${error.message}`);
        setTimeout(() => {
          setSourceTableId(null);
          setMoveMergeStatus('');
          clearMoveMergeSelection();
        }, 3000);
      }
    }
    // MERGE: Occupied → Occupied
    else if (element.status === 'Occupied') {
      try {
        setMoveMergeStatus('🔄 테이블 병합 중...');
        const response = await fetch(`${API_URL}/table-operations/merge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromTableId: sourceTableId,
            toTableId: element.id,
            floor: selectedFloor,
            partialSelection:
              selectionChoice && selectionChoice !== 'ALL'
                ? {
                    mode: 'partial',
                    guestNumbers: selectionChoice.guestNumbers,
                    orderItemIds: selectionChoice.orderItemIds,
                    orderLineIds: selectionChoice.orderLineIds,
                  }
                : undefined,
          })
        });

        const result = await response.json();

        if (result.success) {
          const isPartial = Boolean(result.partial);
          const fromStatus = result.fromTable?.status || (isPartial ? 'Occupied' : 'Preparing');
          const toStatus = result.toTable?.status || 'Occupied';
          const targetOrderId = result.toTable?.orderId ?? null;
          setMoveMergeStatus(result.message ? `✅ ${result.message}` : `✅ 테이블 병합 완료: ${sourceTableId} + ${element.text}`);
          
          setTableElements(prev => prev.map(el => {
            if (String(el.id) === String(sourceTableId)) {
              const next = { ...el, status: fromStatus };
              if (fromStatus !== 'Occupied') {
                next.current_order_id = null;
              }
              return next;
            }
            if (String(el.id) === String(element.id)) {
              return { ...el, status: toStatus, current_order_id: targetOrderId ?? el.current_order_id };
            }
            return el;
          }));
          
          // ALWAYS clean up UI cache for source table to prevent stale data
          try {
            localStorage.removeItem(`splitGuests_${sourceTableId}`);
            localStorage.removeItem(`paidGuests_${sourceTableId}`);
          } catch(e) {}

          // 1. Transfer Logic (Full Merge only)
          if (!isPartial) {
            try {
              const sourceOrderId = localStorage.getItem(`lastOrderIdByTable_${sourceTableId}`);
              const targetOrderIdLocal = localStorage.getItem(`lastOrderIdByTable_${element.id}`);
              
              if (sourceOrderId && !targetOrderIdLocal) {
                localStorage.setItem(`lastOrderIdByTable_${element.id}`, sourceOrderId);
                
                const splitGuests = localStorage.getItem(`splitGuests_${sourceTableId}`);
                if (splitGuests) {
                  localStorage.setItem(`splitGuests_${element.id}`, splitGuests);
                }
                
                const voidDisplay = localStorage.getItem(`voidDisplay_${sourceTableId}`);
                if (voidDisplay) {
                  localStorage.setItem(`voidDisplay_${element.id}`, voidDisplay);
                }
                
                const paidGuests = localStorage.getItem(`paidGuests_${sourceTableId}`);
                if (paidGuests) {
                  localStorage.setItem(`paidGuests_${element.id}`, paidGuests);
                }
                
                const occupiedTimesKey = `occupiedTimes_${selectedFloor}`;
                const occupiedTimesRaw = localStorage.getItem(occupiedTimesKey);
                if (occupiedTimesRaw) {
                  const occupiedTimes = JSON.parse(occupiedTimesRaw);
                  const sourceTime = occupiedTimes[String(sourceTableId)];
                  if (sourceTime) {
                    occupiedTimes[String(element.id)] = sourceTime;
                    localStorage.setItem(occupiedTimesKey, JSON.stringify(occupiedTimes));
                    
                    setTableOccupiedTimes(prev => {
                      const next = { ...prev };
                      next[String(element.id)] = sourceTime;
                      return next;
                    });
                  }
                }
              }
            } catch (e) {
              console.warn('[MERGE] localStorage 업데이트 실패:', e);
            }
          }

          // 2. Cleanup Source (Universal)
          if (fromStatus !== 'Occupied') {
            try {
              localStorage.removeItem(`lastOrderIdByTable_${sourceTableId}`);
              localStorage.removeItem(`splitGuests_${sourceTableId}`);
              localStorage.removeItem(`voidDisplay_${sourceTableId}`);
              localStorage.removeItem(`paidGuests_${sourceTableId}`);
              
              const occupiedTimesKey = `occupiedTimes_${selectedFloor}`;
              const occupiedTimesRaw = localStorage.getItem(occupiedTimesKey);
              if (occupiedTimesRaw) {
                const occupiedTimes = JSON.parse(occupiedTimesRaw);
                if (occupiedTimes[String(sourceTableId)]) {
                  delete occupiedTimes[String(sourceTableId)];
                  localStorage.setItem(occupiedTimesKey, JSON.stringify(occupiedTimes));
                  
                  setTableOccupiedTimes(prev => {
                    const next = { ...prev };
                    delete next[String(sourceTableId)];
                    return next;
                  });
                }
              }
            } catch (e) {
              console.warn('[MERGE] Source cleanup failed', e);
            }
          }

          // 3. Cleanup Target/Partial
          if (isPartial) {
            try {
              localStorage.removeItem(`splitGuests_${element.id}`);
              localStorage.removeItem(`paidGuests_${element.id}`);
              if (targetOrderId) {
                localStorage.removeItem(`paidGuests_order_${targetOrderId}`);
              }
            } catch (e) {
              console.warn('[MERGE] partial localStorage cleanup failed', e);
            }
          }
          
          try {
            localStorage.setItem('lastOccupiedTable', JSON.stringify({ 
              tableId: element.id, 
              floor: selectedFloor, 
              status: toStatus, 
              ts: Date.now() 
            }));
          } catch {}
          
          setSourceTableId(null);
          setMoveMergeStatus('');
          setIsMoveMergeMode(false);
          clearMoveMergeSelection();
          
          await fetchTableMapData();
        } else {
          console.error('[MERGE] Error details:', result);
          setMoveMergeStatus(`❌ 병합 실패: ${result.details || result.error}`);
          setTimeout(() => {
            setSourceTableId(null);
            setMoveMergeStatus('');
            clearMoveMergeSelection();
          }, 3000);
        }
      } catch (error: any) {
        console.error('Merge table error:', error);
        setMoveMergeStatus(`❌ 오류: ${error.message}`);
        setTimeout(() => {
          setSourceTableId(null);
          setMoveMergeStatus('');
          clearMoveMergeSelection();
        }, 3000);
      }
    } else {
      setMoveMergeStatus('❌ 목적 테이블은 Available 또는 Occupied 상태여야 합니다.');
      setTimeout(() => setMoveMergeStatus(''), 2000);
    }
  };

  // Partial Selection Modal Handlers
  const handlePartialModalClose = () => {
    clearMoveMergeSelection();
  };

  const handlePartialModalConfirm = (selection: PartialSelectionPayload | 'ALL') => {
    setIsSelectionModalOpen(false);
    setSelectionChoice(selection);
    
    if (selection === 'ALL') {
      setMoveMergeStatus(`✓ [전체 이동] ${sourceSelectionInfo?.label} → 목적 테이블을 선택하세요`);
    } else {
      const guestCount = selection.guestNumbers?.length || 0;
      const itemCount = (selection.orderItemIds?.length || 0) + (selection.orderLineIds?.length || 0);
      setMoveMergeStatus(`✓ [부분 이동: G${guestCount}/I${itemCount}] ${sourceSelectionInfo?.label} → 목적 테이블을 선택하세요`);
    }
  };

  // 버튼 클릭 핸들러
  const handleButtonClick = async (buttonName: string) => {
    console.log(`버튼 클릭: ${buttonName}`);
    switch (buttonName) {
      case 'Open Till':
        try {
          console.log('Opening cash drawer...');
          const response = await fetch(`${API_URL}/printers/open-drawer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          });
          const result = await response.json();
          
          if (result.success) {
            console.log('Cash drawer opened successfully:', result);
            // Optional: Show a brief success message to user
            // alert('Cash drawer opened');
          } else {
            console.error('Failed to open cash drawer:', result);
            alert('Failed to open cash drawer: ' + (result.error || 'Unknown error'));
          }
        } catch (error) {
          console.error('Error opening cash drawer:', error);
          alert('Error opening cash drawer. Check console for details.');
        }
        break;
      case 'Move/Merge':
        if (!isMoveMergeMode) {
          setIsBillPrintMode(false); // 다른 모드 끄기
          setBillPrintStatus('');
          setIsMoveMergeMode(true);
          setMoveMergeStatus('Select a source to move');
          break;
        }
        setIsMoveMergeMode(false);
        clearMoveMergeSelection();
        setMoveMergeStatus('');
        break;
      case 'Prep Time':
        setShowPrepTimeModal(true);
        break;
      case 'Order History':
        setShowOrderListModal(true);
        fetchOrderList(orderListDate);
        break;
      case 'Reservation':
        console.log('Reservation 버튼 클릭됨, 모달 열기');
        setShowReservationModal(true);
        break;
      case 'Waiting List':
        setShowWaitingModal(true);
        break;
      case 'Gift Card':
        setGiftCardNumber(['', '', '', '']);
        setGiftCardAmount('');
        setGiftCardPaymentMethod('Cash');
        setGiftCardCustomerName('');
        setGiftCardCustomerPhone('');
        setGiftCardBalance(null);
        setGiftCardError('');
        setGiftCardMode('sell');
        setShowGiftCardModal(true);
        break;
      case 'Clock In/Out':
        console.log('Clock In/Out 버튼 클릭됨, 메뉴 열기');
        setShowClockInOutMenu(true);
        break;
      case 'Online Order':
        console.log('Online Order 버튼 클릭됨');
        setShowOnlineOrderPanel(true);
        break;
      case 'Refund':
        console.log('Refund 버튼 클릭됨');
        openRefundModal();
        break;
      case 'Back Office':
        navigate('/backoffice/tables');
        break;
      default:
        console.log(`${buttonName} 버튼이 클릭되었습니다.`);
        break;
    }
  };

  // Refund Functions
  const openRefundModal = async () => {
    setShowRefundModal(true);
    setRefundStep('list');
    setRefundSelectedOrder(null);
    setRefundOrderItems([]);
    setRefundPayments([]);
    setRefundSelectedItems({});
    setRefundType('FULL');
    setRefundPin('');
    setRefundPinError('');
    setRefundReason('');
    setRefundResult(null);
    setRefundCardNumber('');
    setRefundApprovalNumber('');
    setRefundGiftCardNumber('');
    setRefundPendingData(null);
    
    // Fetch tax rate from database
    try {
      const taxResponse = await fetch(`${API_URL}/taxes`);
      const taxes = await taxResponse.json();
      if (Array.isArray(taxes) && taxes.length > 0) {
        // Find active taxes and sum their rates
        const activeTaxes = taxes.filter((t: any) => !t.is_deleted);
        if (activeTaxes.length > 0) {
          // Use the first tax rate (usually the main tax like HST)
          const firstTax = activeTaxes[0];
          const rate = parseFloat(firstTax.rate) || 0;
          // If rate > 1, it's stored as percentage (5), convert to decimal (0.05)
          const finalRate = rate > 1 ? rate / 100 : rate;
          setRefundTaxRate(finalRate);
          console.log('Tax:', firstTax.name, 'Rate:', rate, '-> Final rate:', finalRate);
        } else {
          setRefundTaxRate(0.05); // Default 5%
        }
      } else {
        setRefundTaxRate(0.05); // Default 5%
      }
    } catch (e) {
      console.error('Failed to fetch tax rate:', e);
      setRefundTaxRate(0.05); // Default fallback 5%
    }
    
    await fetchPaidOrders();
  };

  const fetchPaidOrders = async (dateOverride?: string, showLoading: boolean = true) => {
    try {
      if (showLoading) setRefundLoading(true);
      const params = new URLSearchParams();
      const searchDate = dateOverride !== undefined ? dateOverride : refundSearchDate;
      if (searchDate) params.append('date', searchDate);
      if (refundSearchText) params.append('search', refundSearchText);
      
      const response = await fetch(`${API_URL}/refunds/paid-orders?${params.toString()}`);
      const data = await response.json();
      if (data.success) {
        setRefundPaidOrders(data.orders || []);
      }
    } catch (error) {
      console.error('Failed to fetch paid orders:', error);
    } finally {
      if (showLoading) setRefundLoading(false);
    }
  };

  const selectOrderForRefund = async (order: any) => {
    try {
      setRefundLoading(true);
      const response = await fetch(`${API_URL}/refunds/order/${order.id}`);
      const data = await response.json();
      if (data.success) {
        setRefundSelectedOrder({ 
          ...order, 
          ...data.order, 
          totalPaid: data.totalPaid, 
          totalRefunded: data.totalRefunded, 
          refundableAmount: data.refundableAmount,
          totalAdjustments: data.totalAdjustments || 0
        });
        setRefundOrderItems(data.items || []);
        setRefundPayments(data.payments || []);
        setRefundStep('detail');
        
        // Calculate actual items subtotal (for proportional refund calculation)
        // Only count positive price items - negative prices are discounts
        const items = data.items || [];
        const itemsSubtotal = items.reduce((sum: number, item: any) => {
          const price = item.unit_price || item.price || 0;
          const qty = item.quantity || 1;
          return sum + (price > 0 ? price * qty : 0);  // Only positive prices
        }, 0);
        
        // Store for proportional calculation
        setRefundSelectedOrder((prev: any) => ({ ...prev, itemsSubtotal }));
        
        // Default to full refund with all items selected (only positive price items)
        const allItems: { [key: number]: number } = {};
        items.forEach((item: any) => {
          const price = item.unit_price || item.price || 0;
          if (item.refundable_quantity > 0 && price > 0) {
            allItems[item.id] = item.refundable_quantity;
          }
        });
        setRefundSelectedItems(allItems);
        setRefundType('FULL');
      }
    } catch (error) {
      console.error('Failed to fetch order details:', error);
    } finally {
      setRefundLoading(false);
    }
  };

  const toggleRefundItem = (itemId: number, maxQty: number) => {
    setRefundSelectedItems(prev => {
      const newItems = { ...prev };
      if (newItems[itemId]) {
        delete newItems[itemId];
      } else {
        newItems[itemId] = maxQty;
      }
      return newItems;
    });
    setRefundType('PARTIAL');
  };

  const updateRefundItemQty = (itemId: number, qty: number) => {
    if (qty <= 0) {
      setRefundSelectedItems(prev => {
        const newItems = { ...prev };
        delete newItems[itemId];
        return newItems;
      });
    } else {
      setRefundSelectedItems(prev => ({ ...prev, [itemId]: qty }));
    }
    setRefundType('PARTIAL');
  };

  const selectAllRefundItems = () => {
    const allItems: { [key: number]: number } = {};
    refundOrderItems.forEach((item: any) => {
      if (item.refundable_quantity > 0) {
        allItems[item.id] = item.refundable_quantity;
      }
    });
    setRefundSelectedItems(allItems);
    setRefundType('FULL');
  };

  const calculateRefundTotals = () => {
    let selectedSubtotal = 0;
    const items: any[] = [];

    // Calculate selected items subtotal (only positive price items)
    refundOrderItems.forEach((item: any) => {
      const qty = refundSelectedItems[item.id] || 0;
      if (qty > 0) {
        const unitPrice = item.unit_price || item.price || 0;
        if (unitPrice > 0) { // Only count positive price items
          const itemTotal = unitPrice * qty;
          selectedSubtotal += itemTotal;
          
          items.push({
            orderItemId: item.id,
            itemName: item.name || item.item_name,
            quantity: qty,
            unitPrice: unitPrice,
            totalPrice: itemTotal,
            tax: 0 // Will be calculated proportionally
          });
        }
      }
    });

    // Calculate total items subtotal (only positive price items)
    const totalItemsSubtotal = refundOrderItems.reduce((sum: number, item: any) => {
      const price = item.unit_price || item.price || 0;
      const qty = item.quantity || 1;
      return sum + (price > 0 ? price * qty : 0);
    }, 0);

    // Calculate proportional refund based on actual paid amount
    const refundableAmount = refundSelectedOrder?.refundableAmount || 0;
    let proportionalRefund = 0;
    
    if (totalItemsSubtotal > 0) {
      // Refund = (selected items / total items) * refundable amount
      proportionalRefund = (selectedSubtotal / totalItemsSubtotal) * refundableAmount;
    }
    
    // Separate into subtotal and tax (estimate based on tax rate)
    const taxRate = refundTaxRate || 0.05;
    const subtotal = proportionalRefund / (1 + taxRate);
    const tax = proportionalRefund - subtotal;
    const total = proportionalRefund;

    // Update item taxes proportionally
    items.forEach(item => {
      item.tax = (item.totalPrice / selectedSubtotal) * tax;
    });

    return { subtotal, tax, total, items };
  };

  const verifyRefundPin = async (pin: string): Promise<{ valid: boolean; employeeName?: string }> => {
    try {
      // PIN으로 직원 조회 및 권한 확인 (Manager 또는 Owner)
      const response = await fetch(`${API_URL}/work-schedule/employees`);
      const data = await response.json();
      
      // Handle both response formats: { success: true, employees: [...] } or direct array
      const employees = data.success ? data.employees : (Array.isArray(data) ? data : []);
      
      if (Array.isArray(employees)) {
        // Find employee by PIN (case-insensitive status check)
        const employee = employees.find((emp: any) => {
          const empPin = String(emp.pin || '');
          const inputPin = String(pin || '');
          const empStatus = (emp.status || '').toLowerCase();
          return empPin === inputPin && empStatus === 'active';
        });
        
        if (employee) {
          // Check role (Manager or Owner can process refunds)
          const role = (employee.role || '').toLowerCase();
          const isAuthorized = role.includes('manager') || role.includes('owner') || role.includes('admin');
          
          if (isAuthorized) {
            // Handle both name formats: single 'name' field or separate firstName/lastName
            const employeeName = employee.name || 
              `${employee.firstName || employee.first_name || ''} ${employee.lastName || employee.last_name || ''}`.trim();
            return { valid: true, employeeName };
          } else {
            return { valid: false };
          }
        }
      }
      return { valid: false };
    } catch (error) {
      console.error('PIN verification failed:', error);
      return { valid: false };
    }
  };

  const processRefund = async () => {
    if (!refundPin || refundPin.length < 4) {
      setRefundPinError('PIN Required (min 4 digits)');
      setTimeout(() => {
        setRefundPinError('');
      }, 1000);
      return;
    }

    // Verify PIN
    const pinResult = await verifyRefundPin(refundPin);
    if (!pinResult.valid) {
      setRefundPinError('Invalid PIN');
      // Auto clear after 1 second
      setTimeout(() => {
        setRefundPinError('');
      }, 1000);
      return;
    }

    setRefundPinError('');

    const { subtotal, tax, total, items } = calculateRefundTotals();
    
    if (total <= 0) {
      setRefundPinError('Please select items to refund');
      setTimeout(() => {
        setRefundPinError('');
      }, 1000);
      return;
    }

    // Determine payment method from original payments
    const paymentMethod = refundPayments.length > 0 ? refundPayments[0].method : 'CASH';
    const normalizedMethod = paymentMethod?.toUpperCase() || 'CASH';

    // Store pending data for later use
    const pendingData = {
      orderId: refundSelectedOrder.id,
      refundType: Object.keys(refundSelectedItems).length === refundOrderItems.filter((i: any) => i.refundable_quantity > 0 && parseFloat(i.price) > 0).length ? 'FULL' : 'PARTIAL',
      items,
      subtotal,
      tax,
      total,
      paymentMethod,
      refundedBy: pinResult.employeeName,
      refundedByPin: refundPin,
      reason: refundReason
    };
    setRefundPendingData(pendingData);

    // Check payment method and route accordingly
    if (normalizedMethod === 'CASH') {
      // Cash: Process immediately
      await executeRefund(pendingData, null, null);
    } else {
      // All card payments (VISA, MASTER, DEBIT, OTHER, GIFT_CARD): Go to card input screen
      setRefundCardNumber('');
      setRefundApprovalNumber('');
      // For Gift Card, pre-fill the card number if available
      if (normalizedMethod === 'GIFT_CARD' || normalizedMethod === 'GIFT CARD' || normalizedMethod === 'GIFT' || normalizedMethod.includes('GIFT')) {
        const gcPayment = refundPayments.find((p: any) => {
          const m = p.method?.toUpperCase() || '';
          return m === 'GIFT_CARD' || m === 'GIFT CARD' || m === 'GIFT' || m.includes('GIFT');
        });
        if (gcPayment && gcPayment.ref) {
          setRefundGiftCardNumber(gcPayment.ref);
        } else {
          setRefundGiftCardNumber('');
        }
      }
      setRefundStep('card_input');
    }
  };

  // Execute the actual refund API call
  const executeRefund = async (pendingData: any, cardInfo: { cardNumber?: string; approvalNumber?: string } | null, giftCardNumber: string | null) => {
    setRefundLoading(true);

    try {
      const response = await fetch(`${API_URL}/refunds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...pendingData,
          giftCardNumber,
          cardNumber: cardInfo?.cardNumber,
          approvalNumber: cardInfo?.approvalNumber
        })
      });

      const data = await response.json();
      if (data.success) {
        setRefundResult({
          ...data.refund,
          refundedBy: pendingData.refundedBy,
          originalOrderNumber: refundSelectedOrder.order_number,
          paymentMethod: pendingData.paymentMethod,
          cardNumber: cardInfo?.cardNumber,
          approvalNumber: cardInfo?.approvalNumber
        });
        setRefundStep('confirm');
        
        // Print refund receipt
        await printRefundReceipt({
          ...data.refund,
          refundedBy: pendingData.refundedBy,
          originalOrderNumber: refundSelectedOrder.order_number,
          paymentMethod: pendingData.paymentMethod,
          items: pendingData.items
        });

        // Show success popup
        setShowRefundSuccessPopup(true);
        setTimeout(() => setShowRefundSuccessPopup(false), 2000);
      } else {
        setRefundPinError(data.error || 'Refund failed');
        setTimeout(() => {
          setRefundPinError('');
        }, 2000);
      }
    } catch (error) {
      console.error('Refund processing failed:', error);
      setRefundPinError('Failed to process refund');
      setTimeout(() => {
        setRefundPinError('');
      }, 2000);
    } finally {
      setRefundLoading(false);
    }
  };

  // Process card refund
  const processCardRefund = async () => {
    if (!refundCardNumber || refundCardNumber.length < 4) {
      setRefundPinError('Card number required (last 4 digits)');
      setTimeout(() => {
        setRefundPinError('');
      }, 1000);
      return;
    }
    if (!refundApprovalNumber || refundApprovalNumber.length < 4) {
      setRefundPinError('Approval number required');
      setTimeout(() => {
        setRefundPinError('');
      }, 1000);
      return;
    }
    await executeRefund(refundPendingData, { cardNumber: refundCardNumber, approvalNumber: refundApprovalNumber }, null);
  };

  // Process gift card refund (reload amount to gift card)
  const processGiftCardRefund = async () => {
    if (!refundGiftCardNumber || refundGiftCardNumber.length < 4) {
      setRefundPinError('Gift card number required');
      setTimeout(() => {
        setRefundPinError('');
      }, 1000);
      return;
    }
    await executeRefund(refundPendingData, null, refundGiftCardNumber);
  };

  const printRefundReceipt = async (refundData: any) => {
    try {
      const receiptLines = [
        '========================================',
        '            REFUND RECEIPT',
        '========================================',
        '',
        `Date: ${new Date().toLocaleString()}`,
        `Original Order: #${refundData.originalOrderNumber || refundData.original_order_number}`,
        `Refund ID: #${refundData.id}`,
        `Processed by: ${refundData.refundedBy || refundData.refunded_by}`,
        '',
        '----------------------------------------',
        'REFUNDED ITEMS:',
        '----------------------------------------',
      ];

      if (refundData.items && refundData.items.length > 0) {
        refundData.items.forEach((item: any) => {
          receiptLines.push(`${item.itemName || item.item_name}`);
          receiptLines.push(`  ${item.quantity} x $${(item.unitPrice || item.unit_price || 0).toFixed(2)} = $${(item.totalPrice || item.total_price || 0).toFixed(2)}`);
        });
      }

      receiptLines.push('----------------------------------------');
      receiptLines.push(`Subtotal:        $${(refundData.subtotal || 0).toFixed(2)}`);
      receiptLines.push(`Tax Refund:      $${(refundData.tax || 0).toFixed(2)}`);
      receiptLines.push('========================================');
      receiptLines.push(`TOTAL REFUND:    $${(refundData.total || 0).toFixed(2)}`);
      receiptLines.push('========================================');
      receiptLines.push(`Payment Method: ${refundData.paymentMethod || refundData.payment_method}`);
      if (refundData.reason) {
        receiptLines.push(`Reason: ${refundData.reason}`);
      }
      receiptLines.push('');
      receiptLines.push('        Thank you for your patience');
      receiptLines.push('');
      receiptLines.push('========================================');

      // Send to printer
      await fetch(`${API_URL}/printers/print-receipt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lines: receiptLines,
          type: 'refund'
        })
      });
    } catch (error) {
      console.error('Failed to print refund receipt:', error);
    }
  };

  const closeRefundModal = () => {
    setShowRefundModal(false);
    setRefundStep('list');
    setRefundSelectedOrder(null);
    setRefundOrderItems([]);
    setRefundPayments([]);
    setRefundSelectedItems({});
    setRefundPin('');
    setRefundPinError('');
    setRefundReason('');
    setRefundResult(null);
  };

  // Gift Card Functions
  const handleGiftCardNumberChange = (index: number, value: string) => {
    const cleaned = value.replace(/\D/g, '').slice(0, 4);
    const newNumbers = [...giftCardNumber];
    newNumbers[index] = cleaned;
    setGiftCardNumber(newNumbers);
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
    if (!giftCardSellerPin || giftCardSellerPin.length < 4) {
      setGiftCardError('Please enter seller PIN (min 4 digits)');
      return;
    }
    setGiftCardError('');

    // 충전 모드인 경우
    if (giftCardIsReload) {
      try {
        const response = await fetch(`${API_URL}/gift-cards/${encodeURIComponent(cardNum)}/reload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: amount,
            payment_method: giftCardPaymentMethod,
            sold_by: 'Staff',
            seller_pin: giftCardSellerPin
          })
        });
        if (response.ok) {
          setShowGiftCardModal(false);
          setShowGiftCardReloadPopup(true);
          setTimeout(() => setShowGiftCardReloadPopup(false), 1000);
          // Reset states
          setGiftCardIsReload(false);
          setGiftCardExistingBalance(null);
          setGiftCardSellerPin('');
        } else {
          const err = await response.json();
          setGiftCardError(err.message || 'Failed to reload gift card');
        }
      } catch (error) {
        setGiftCardError('Failed to connect to server');
      }
      return;
    }

    // 신규 판매
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
          sold_by: 'Staff',
          seller_pin: giftCardSellerPin,
          created_at: new Date().toISOString()
        })
      });
      if (response.ok) {
        setShowGiftCardModal(false);
        setShowGiftCardSoldPopup(true);
        setTimeout(() => setShowGiftCardSoldPopup(false), 1000);
        setGiftCardSellerPin('');
      } else {
        const err = await response.json();
        // 카드가 이미 존재하면 자동으로 충전
        if (err.exists) {
          try {
            const reloadResponse = await fetch(`${API_URL}/gift-cards/${encodeURIComponent(cardNum)}/reload`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                amount: amount,
                payment_method: giftCardPaymentMethod,
                sold_by: 'Staff',
                seller_pin: giftCardSellerPin
              })
            });
            if (reloadResponse.ok) {
              setShowGiftCardModal(false);
              setShowGiftCardReloadPopup(true);
              setTimeout(() => setShowGiftCardReloadPopup(false), 1000);
              setGiftCardSellerPin('');
              setGiftCardIsReload(false);
              setGiftCardExistingBalance(null);
            } else {
              const reloadErr = await reloadResponse.json();
              setGiftCardError(reloadErr.message || 'Failed to reload gift card');
            }
          } catch {
            setGiftCardError('Failed to connect to server');
          }
        } else {
          setGiftCardError(err.message || 'Failed to sell gift card');
        }
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

  // 버튼 데이터
  const buttonData = [
    'Open Till',
    'Refund',
    'Order History',
    'Move/Merge',
    'Reservation',
    'Waiting List',
    'Gift Card',
    'Prep Time',
    'Clock In/Out',
    'Closing'
  ];

  // 그라데이션 색상 생성 함수 (백오피스와 동일)
  const generateGradientColors = (count: number) => {
    const startColor = '#75A2BF';
    const endColor = '#2F5F8A';
    
    const colors = [];
    for (let i = 0; i < count; i++) {
      const ratio = i / (count - 1);
      // 간단한 색상 보간
      const r1 = parseInt(startColor.slice(1, 3), 16);
      const g1 = parseInt(startColor.slice(3, 5), 16);
      const b1 = parseInt(startColor.slice(5, 7), 16);
      
      const r2 = parseInt(endColor.slice(1, 3), 16);
      const g2 = parseInt(endColor.slice(3, 5), 16);
      const b2 = parseInt(endColor.slice(5, 7), 16);
      
      const r = Math.round(r1 + (r2 - r1) * ratio);
      const g = Math.round(g1 + (g2 - g1) * ratio);
      const b = Math.round(b1 + (b2 - b1) * ratio);
      
      colors.push(`#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`);
    }
    return colors;
  };

  const gradientColors = generateGradientColors(buttonData.length);
  // 버튼별 색상 보정: 인덱스가 바뀐 Waiting List / Sold Out에 맞춰 직접 지정
  const getButtonColor = (name: string, index: number) => {
    // if (name === 'Waiting List') return '#2F5F8A';
    return gradientColors[index];
  };

  // Togo 주문 모달 컴포넌트
  const TogoOrderModal = () => {
    if (!showTogoOrderModal) return null;
    const serverSelectionRequired = shouldPromptServerSelection;
    const hasContactInfo = Boolean((customerPhone || '').trim()) || Boolean((customerName || '').trim());
    const canSubmitOrder = hasContactInfo && (!serverSelectionRequired || !!selectedTogoServer);

    const pickupDisplay = formatMinutesToTime(pickupTime);
    const readyTime = readyTimeSnapshot;
    const handleIncrement = (minutes: number) => {
      setPickupTime((prev) => Math.max(0, prev + minutes));
    };
    const handleResetPickup = () => {
      setPickupTime(0);
      setPickupAmPm(getCurrentAmPm());
      setPickupDateLabel(formatPickupDateLabel());
    };
  const handleToggleNoPrep = () => {
    setPrepButtonsLocked((prev) => {
      const next = !prev;
      if (next) {
        handleResetPickup();
      } else {
        setPickupTime(15);
        setPickupAmPm(getCurrentAmPm());
        setPickupDateLabel(formatPickupDateLabel());
      }
      return next;
    });
  };

    return (
      <div className="absolute inset-0 bg-black bg-opacity-70 flex items-start justify-center z-40 p-3 sm:p-4 pt-6">
        <div
          className="bg-gradient-to-b from-white to-slate-50 rounded-2xl shadow-[0_18px_45px_rgba(15,23,42,0.35)] px-4 sm:px-5 py-5 w-full border border-slate-200 flex flex-col"
          style={{ maxWidth: `${togoModalMaxWidth}px`, height: `${togoModalMaxHeight}px` }}
        >
          <div className="flex items-center justify-between mb-3 flex-shrink-0">
            <div>
              <h3 className="text-lg font-semibold text-slate-800">New Togo</h3>
            </div>
            <div className="px-2.5 py-1 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-semibold">
              {selectedTogoServer ? `Server: ${formatEmployeeName(selectedTogoServer.employee_name)}` : 'Server: —'}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] gap-4 mt-2 flex-1 min-h-0 overflow-hidden">
            <div className="space-y-3 overflow-hidden">
              <div className="grid gap-1.5">
                <div className="flex flex-col md:flex-row gap-2">
                  <div className="relative md:w-[34%] md:flex-none" onFocus={handleSuggestionFocus} onBlur={handleSuggestionBlur}>
                    <input
                      type="tel"
                      value={customerPhone}
                      onChange={(e) => handlePhoneInputChange(e.target.value)}
                      onFocus={() => setTogoKeyboardTarget('phone')}
                      ref={phoneInputRef}
                      className={`h-10 w-full px-3 rounded-lg ${getFieldBorderClasses('phone')} focus:outline-none focus:ring-0`}
                      placeholder="(000)000-0000"
                    />
                    {renderCustomerSuggestionList('phone')}
                  </div>
                  <div className="relative md:w-[31%] md:flex-none" onFocus={handleSuggestionFocus} onBlur={handleSuggestionBlur}>
              <input
                type="text"
                value={customerName}
                      onChange={(e) => handleNameInputChange(e.target.value)}
                      onFocus={() => setTogoKeyboardTarget('name')}
                      ref={nameInputRef}
                      className={`h-10 w-full px-3 rounded-lg ${getFieldBorderClasses('name')} focus:outline-none focus:ring-0`}
                      placeholder="Customer name"
                    />
                    {renderCustomerSuggestionList('name')}
                  </div>
                  <div className="flex md:flex-1 items-center justify-end">
                    <div
                      className="inline-flex w-full max-w-[214px] rounded-lg border border-slate-300 bg-white text-xs font-semibold overflow-hidden h-10"
                      role="group"
                      aria-label="Select order type"
                    >
                      {[
                        { key: 'togo' as const, label: 'TOGO' },
                        { key: 'delivery' as const, label: 'DELIVERY' },
                      ].map((option, idx) => {
                        const active = togoOrderMode === option.key;
                        return (
                          <button
                            type="button"
                            key={option.key}
                            aria-pressed={active}
                            onClick={() => setTogoOrderMode(option.key)}
                            className={`h-full transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 flex items-center justify-center text-center ${
                              active
                                ? 'bg-emerald-500 text-white'
                                : 'bg-transparent text-slate-500 hover:text-slate-700'
                            } ${idx === 0 ? 'border-r border-slate-300' : ''}`}
                            style={idx === 1 ? { flex: '0 0 46%' } : { flex: '0 0 54%' }}
                          >
                            <span className="mx-auto text-center">{option.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
            </div>
            
              <div className="rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-inner space-y-2">
                <div className="flex flex-nowrap items-center gap-1.5 text-sm font-semibold text-slate-700 min-w-0">
                  <div className="flex items-center gap-1 min-w-[140px]">
                    <span className={prepButtonsLocked ? 'text-slate-400' : ''}>Prep Time</span>
                    <span className={`text-3xl font-mono font-semibold leading-none ${prepButtonsLocked ? 'text-slate-400' : 'text-indigo-600'}`}>{pickupDisplay}</span>
                  </div>
                  <div className="flex items-center gap-1 text-xs sm:text-sm min-w-[170px]">
                    <span className={`px-2 py-0.5 rounded-full border font-semibold whitespace-nowrap ${prepButtonsLocked ? 'border-slate-200 bg-slate-100 text-slate-400' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                      Ready {readyTime.readyDisplay}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full border font-semibold whitespace-nowrap ${prepButtonsLocked ? 'border-slate-200 bg-slate-100 text-slate-400' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                      Current {readyTime.currentDisplay}
                    </span>
                  </div>
                  <div className="flex-1" />
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap gap-2">
                    {[5, 10, 15, 20, 25].map((min) => (
                      <button
                        type="button"
                        key={`top-${min}`}
                        onClick={() => setPickupTime(min)}
                        disabled={prepButtonsLocked}
                        className={`min-w-[75px] h-[48px] px-4 rounded-xl text-sm font-semibold shadow transition-transform flex items-center justify-center ${
                          prepButtonsLocked ? 'bg-slate-400 text-slate-200 cursor-not-allowed opacity-50' : 'bg-slate-500 text-white hover:bg-slate-600'
                        }`}
                      >
                        +{min}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[30, 40, 50, 60].map((min) => (
                      <button
                        type="button"
                        key={`bottom-${min}`}
                        onClick={() => setPickupTime(min)}
                        disabled={prepButtonsLocked}
                        className={`min-w-[75px] h-[48px] px-4 rounded-xl text-sm font-semibold shadow transition-transform flex items-center justify-center ${
                          prepButtonsLocked ? 'bg-slate-400 text-slate-200 cursor-not-allowed opacity-50' : 'bg-slate-500 text-white hover:bg-slate-600'
                        }`}
                      >
                        +{min}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={handleToggleNoPrep}
                      className={`w-[75px] h-[48px] px-4 rounded-xl text-sm font-semibold shadow transition-transform flex items-center justify-center ${
                        prepButtonsLocked ? 'bg-rose-600 text-white' : 'bg-rose-400 text-white hover:bg-rose-500'
                      }`}
                    >
                      {prepButtonsLocked ? 'Prep On' : 'Prep Off'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid gap-1.5">
                <div className="flex gap-2">
                  <textarea
                    value={customerAddress}
                    onChange={(e) => setCustomerAddress(e.target.value)}
                    onFocus={() => setTogoKeyboardTarget('address')}
                    ref={addressInputRef}
                    rows={1}
                    className={`flex-1 px-3 py-1 rounded-lg ${getFieldBorderClasses('address')} focus:outline-none focus:ring-0 text-sm resize-none min-h-[38px]`}
                    placeholder="Address"
                  />
              <input
                    type="text"
                    value={customerZip}
                    onChange={(e) => setCustomerZip(e.target.value)}
                    onFocus={() => setTogoKeyboardTarget('zip')}
                    ref={zipInputRef}
                    className={`w-24 px-3 py-1 rounded-lg ${getFieldBorderClasses('zip')} focus:outline-none focus:ring-0 text-sm`}
                    placeholder="Zip"
                  />
                </div>
            </div>
            
              <div className="grid gap-1.5">
                <textarea
                  value={togoNote}
                  onChange={(e) => setTogoNote(e.target.value)}
                  onFocus={() => setTogoKeyboardTarget('note')}
                  ref={noteInputRef}
                  rows={1}
                  className={`flex-1 px-3 py-1 rounded-lg ${getFieldBorderClasses('note')} focus:outline-none focus:ring-0 text-sm resize-none min-h-[38px]`}
                  placeholder="Note"
              />
            </div>
          </div>
          
            <div className="bg-white/85 rounded-2xl border border-slate-200 p-4 shadow-inner flex flex-col min-h-0 overflow-hidden">
              <div className="flex items-center justify-between flex-shrink-0" style={{ marginTop: '-15px' }}>
                <p className="text-base font-semibold text-slate-800">Order History</p>
              </div>
              <div className="overflow-y-auto max-h-28 pr-0.5 flex-shrink-0" style={{ marginTop: '2px' }}>
                {customerHistoryLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="h-6 w-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : customerHistoryError ? (
                  <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                    {customerHistoryError}
                  </div>
                ) : displayedHistoryOrders.length === 0 ? (
                  <div className="text-sm text-slate-500 border border-dashed border-slate-300 rounded-lg px-3 py-4 text-center">
                    {selectedCustomerHistory ? 'No past orders found.' : 'Select a customer to view history.'}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-1">
                    {displayedHistoryOrders.map((order) => {
                      const normalized = normalizeOrderId(order.id);
                      const isSelected = normalized != null && normalized === selectedHistoryOrderId;
                      const orderDate = formatOrderHistoryDate(order);
                      const totalValue = formatCurrency(getOrderTotalValue(order));
                      return (
            <button
                          type="button"
                          key={`${order.id}-${order.number}`}
                          onClick={() => normalized != null && handleHistoryOrderClick(normalized)}
                          className={`text-left px-3 py-2 rounded-xl border transition ${
                            isSelected
                              ? 'border-emerald-500 bg-emerald-50 shadow'
                              : 'border-slate-200 bg-white hover:bg-slate-50'
                          }`}
                          style={{ paddingTop: '0.55rem', paddingBottom: '0.55rem' }}
                        >
                          <div className="flex items-center justify-between text-[12px] font-semibold text-slate-800 gap-2">
                            <span className="truncate">{orderDate}</span>
                            <span className="text-sm text-slate-900">{totalValue}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="border-t border-slate-200 pt-3 flex-1 min-h-0 flex flex-col" style={{ marginTop: '-3px' }}>
                <div className="flex flex-col flex-1 min-h-0" style={{ marginTop: '-6px' }}>
                  <div className="flex items-center justify-between flex-shrink-0">
                    <p className="text-sm font-semibold text-slate-800" style={{ marginBottom: '3px' }}>Order Details</p>
                    <div className="text-[11px] text-slate-500 font-semibold">
                      <span
                        className={
                          priceChangeSummary.tone === 'up'
                            ? 'text-rose-600'
                            : priceChangeSummary.tone === 'down'
                            ? 'text-emerald-600'
                            : 'text-slate-500'
                        }
                      >
                        {priceChangeSummary.label}
                      </span>
                      {promotionSummary && (
                        <>
                          <span className="text-slate-400 mx-1">•</span>
                          <span className="text-slate-500 font-normal">{promotionSummary}</span>
                        </>
                      )}
                    </div>
                  </div>
                {historyLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="h-6 w-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : historyError ? (
                    <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mt-2">
                      {historyError}
                    </div>
                  ) : historyOrderDetail ? (
                    <div className="mt-3 border border-slate-200 rounded-xl overflow-hidden flex-1 min-h-0 flex flex-col">
                      <div className="flex-1 overflow-y-auto">
                        {historyOrderDetail.items.length === 0 ? (
                          <p className="text-sm text-slate-500 px-3 py-4">No items saved.</p>
                        ) : (
                          historyOrderDetail.items.map((item: any, idx: number) => {
                            const qty = item.quantity || 1;
                            const unitPrice = Number(item.price || item.unit_price || 0);
                            const lineTotal = unitPrice * qty;
                            const modifiers = Array.isArray(item.modifiers)
                              ? item.modifiers.map((mod: any) => mod?.name || mod).filter(Boolean)
                              : [];
                            const noteText = item.note || item.memo || item.specialRequest;
                            return (
                              <div key={item.order_line_id || `${item.id}-${idx}`} className="px-3 py-[3px] text-sm text-slate-700">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="flex-1 min-w-0">
                                    <div className="font-semibold truncate">{item.name}</div>
                                    {(modifiers.length > 0 || noteText) && (
                                      <div className="text-[11px] text-slate-500 space-y-0.5 mt-[2px]">
                                        {modifiers.length > 0 && <div>• {modifiers.join(', ')}</div>}
                                        {noteText && <div>• {noteText}</div>}
                                      </div>
                                    )}
                                  </div>
                                  <div className="text-center text-xs text-slate-500 w-12">{qty}</div>
                                  <div className="text-right font-semibold text-sm w-20">{formatCurrency(lineTotal)}</div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end items-center mt-4 gap-3 flex-shrink-0">
            <button
              type="button"
              onClick={() => {
                setShowTogoOrderModal(false);
                setCustomerName('');
                setCustomerPhone('');
                setCustomerAddress('');
                setCustomerZip('');
                setTogoNote('');
                setTogoOrderMode('togo');
                setPrepButtonsLocked(false);
                setPickupTime(15);
                setPickupAmPm(getCurrentAmPm());
                setPickupDateLabel(formatPickupDateLabel());
                setSelectedTogoServer(null);
              }}
              className="px-5 py-2 rounded bg-gradient-to-b from-white to-slate-100 border border-slate-200 text-slate-600 font-semibold shadow hover:shadow-md"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleReorderFromHistory}
              disabled={!selectedHistoryOrderId || reorderLoading}
              className="px-5 py-2 rounded bg-gradient-to-b from-white to-emerald-50 border border-emerald-200 text-emerald-700 font-semibold shadow hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {reorderLoading ? 'Reordering...' : 'Reorder'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (serverSelectionRequired && !selectedTogoServer) {
                  alert('Please select a server before creating a Togo order.');
                  return;
                }
                if (!hasContactInfo) {
                  alert('Please enter at least a phone number or a name.');
                  return;
                }
                const sanitizedCustomerName = sanitizeDisplayName(customerName);
                const {
                  firstName: customerFirstName,
                  lastName: customerLastName,
                  order: customerNameOrder,
                } = parseCustomerName(sanitizedCustomerName);
                const phoneRaw = getTogoPhoneDigits(customerPhone);
                const selectedServer = selectedTogoServer;
                const readyTimeLabel = readyTime?.readyDisplay || '';
                const createdIso = new Date().toISOString();
                const newOrder = {
                    id: Date.now(),
                  type: togoOrderMode === 'delivery' ? 'Delivery' : 'Togo',
                    time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
                  createdAt: createdIso,
                    phone: customerPhone,
                  phoneRaw,
                  name: sanitizedCustomerName,
                  firstName: customerFirstName,
                  lastName: customerLastName,
                  nameOrder: customerNameOrder,
                  status: 'pending',
                  serverId: selectedServer?.employee_id || null,
                  serverName: selectedServer?.employee_name || '',
                  address: customerAddress,
                  zip: customerZip,
                  note: togoNote,
                  fulfillment: togoOrderMode,
                  pickup: {
                    minutes: pickupTime,
                    ampm: pickupAmPm,
                    dateLabel: pickupDateLabel,
                  },
                  readyTimeLabel,
                  virtualChannel: 'togo' as VirtualOrderChannel,
                  virtualTableId: null as string | null,
                };
                const usedVirtualIds = new Set<string>();
                Object.values(togoOrderMeta).forEach((meta) => {
                  if (meta?.virtualTableId) usedVirtualIds.add(meta.virtualTableId);
                });
                const provisionalVirtualId = allocateVirtualTableId('togo', usedVirtualIds);
                newOrder.virtualTableId = provisionalVirtualId;
                setTogoOrderMeta((prev) => ({
                  ...prev,
                  [String(newOrder.id)]: { virtualTableId: provisionalVirtualId, channel: 'togo' },
                }));
                setTogoOrders((prev) => assignDailySequenceNumbers([...prev, newOrder], 'TOGO'));
                  setShowTogoOrderModal(false);
                  setCustomerName('');
                  setCustomerPhone('');
                setCustomerAddress('');
                setCustomerZip('');
                setTogoNote('');
                setTogoOrderMode('togo');
                setPrepButtonsLocked(false);
                  setPickupTime(15);
                setPickupAmPm(getCurrentAmPm());
                setPickupDateLabel(formatPickupDateLabel());
                setSelectedTogoServer(null);

                navigate('/sales/order', {
                  state: {
                    orderType: 'togo',
                    menuId: defaultMenu.menuId,
                    menuName: defaultMenu.menuName,
                    orderId: newOrder.id,
                    serverId: selectedServer?.employee_id || null,
                    serverName: selectedServer?.employee_name || '',
                    customerName: sanitizedCustomerName,
                    customerPhone,
                    customerAddress,
                    customerZip,
                    customerNote: togoNote,
                    togoFulfillment: togoOrderMode,
                    pickup: newOrder.pickup,
                  },
                });
              }}
              disabled={!canSubmitOrder}
              className="px-6 py-2 rounded bg-gradient-to-b from-emerald-400 to-emerald-600 text-white font-semibold shadow hover:shadow-lg disabled:from-slate-200 disabled:to-slate-300 disabled:text-slate-500"
            >
              OK
            </button>
          </div>
        </div>
      </div>
    );
  };

  // 결제 모달 컴포넌트
  const PaymentModal = () => {
    if (!showPaymentModal || !selectedOrder) return null;

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 w-96">
          <h3 className="text-lg font-semibold mb-4">Payment</h3>
          
          <div className="space-y-3 mb-6">
            <div className="flex justify-between">
              <span className="text-gray-600">Order Type:</span>
              <span className="font-medium">{selectedOrder.type}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Order Number:</span>
              <span className="font-medium">#{selectedOrder.number}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Time:</span>
              <span className="font-medium">{selectedOrder.time}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Customer:</span>
              <span className="font-medium">{selectedOrder.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Phone:</span>
              <span className="font-medium">{selectedOrder.phone}</span>
            </div>
          </div>
          
          <div className="flex justify-end space-x-3">
            <button
              onClick={() => {
                setShowPaymentModal(false);
                setSelectedOrder(null);
              }}
              className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={async () => {
                try {
                  if (selectedOrder) {
                    // 테이블 상태를 Preparing으로 변경
                    await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(String(selectedOrder.tableId))}/status`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ status: 'Preparing' })
                    });
                    
                    // 로컬 상태 업데이트
                    setTableElements(prev => prev.map(el => 
                      String(el.id) === String(selectedOrder.tableId) 
                        ? { ...el, status: 'Preparing' }
                        : el
                    ));
                    
                    // localStorage 업데이트
                    try {
                      localStorage.setItem('lastOccupiedTable', JSON.stringify({
                        tableId: selectedOrder.tableId,
                        floor: selectedFloor,
                        status: 'Preparing',
                        ts: Date.now()
                      }));
                    } catch {}
                  }
                  
                  console.log('Payment completed:', selectedOrder);
                  setShowPaymentModal(false);
                  setSelectedOrder(null);
                } catch (error) {
                  console.error('Payment completion error:', error);
                  alert('결제 완료 처리 중 오류가 발생했습니다.');
                }
              }}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
            >
              Payment Complete
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Floor 변경 핸들러
  const handleFloorChange = (floor: string) => {
    setSelectedFloor(floor);
    console.log(`Floor changed to: ${floor}`);
    
    // Floor 변경 시 즉시 데이터 로드
    const fetchFloorData = async () => {
      try {
        setLoading(true);
        
        // Floor 이름을 백오피스와 동일하게 사용
        const apiFloor = floor;
        
        // 테이블 요소들 가져오기
        const elementsResponse = await fetch(`http://localhost:3177/api/table-map/elements?floor=${apiFloor}`);
        if (elementsResponse.ok) {
          const elements = await elementsResponse.json();
          // 데이터 변환: text 필드를 getElementDisplayName으로 설정
          const transformedElements = elements.map((element: any) => ({
            ...element,
            text: getElementDisplayName(element)
          }));
          // Optimistically apply last occupied table state (for up to 60s)
          let patchedElements = transformedElements;
          try {
            const raw = localStorage.getItem('lastOccupiedTable');
            if (raw) {
              const hint = JSON.parse(raw);
              if (hint && hint.floor === apiFloor && Date.now() - (hint.ts || 0) < 60000) {
                patchedElements = transformedElements.map((el: any) => (
                  String(el.id) === String(hint.tableId) ? { ...el, status: hint.status } : el
                ));
              }
            }
          } catch {}
          setTableElements(patchedElements);
        } else {
          console.warn('테이블 요소를 가져올 수 없습니다. 기본값을 사용합니다.');
          setTableElements([]);
        }

        // 화면 크기 설정 가져오기 (백오피스와 동일하게 사용)
        const screenResponse = await fetch(`http://localhost:3177/api/table-map/screen-size?floor=${encodeURIComponent(apiFloor)}&_ts=${Date.now()}` , { cache: 'no-store' as RequestCache });
        if (screenResponse.ok) {
          const screen = await screenResponse.json();
          // 백오피스에서 설정한 화면비/픽셀을 그대로 적용
          setScreenSize({ 
            width: String(screen.width), 
            height: String(screen.height), 
            scale: screen.scale || 1 
          });
        } else {
          console.warn('화면 크기를 가져올 수 없습니다. 백오피스와 동일한 기본값(1024x768)을 사용합니다.');
          setScreenSize({ width: '1024', height: '768', scale: 1 });
        }
      } catch (err) {
        console.error('데이터 가져오기 오류:', err);
        setError('데이터를 불러올 수 없습니다.');
      } finally {
        setLoading(false);
      }
    };

    fetchFloorData();
  };

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 text-6xl mb-4">⚠️</div>
          <p className="text-xl text-gray-600 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-lg font-medium"
          >
            다시 시도
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white" ref={pageHostRef}>
      {/* 메인 콘텐츠 영역 (전체를 고정 해상도 프레임에 담음) */}
      <div className="pb-0 flex items-start justify-center">
        {!frameReady ? (
          <div className="flex items-center justify-center" style={{ width: '100%', height: '70vh' }}>
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
              <p className="text-sm text-gray-600">화면 크기 불러오는 중...</p>
            </div>
          </div>
        ) : (
        <div
          ref={fixedAreaRef}
          style={ {
            width: `${frameWidthPx}px`,
            height: `${frameHeightPx}px`,
            transform: 'scale(1)',
            transformOrigin: 'top left'
          }}
          className="bg-gray-100 relative flex flex-col"
          id="pos-canvas-anchor"
        >
          {/* Frame outline (neon green) */}
          <div className="pointer-events-none absolute inset-0" style={{ border: '4px solid #39FF14', boxShadow: '0 0 0 2px rgba(57,255,20,0.6) inset, 0 0 10px rgba(57,255,20,0.7)', borderRadius: 8 }} />
          {/* Frame size label */}
          <div className="pointer-events-none absolute -bottom-3 left-1/2 -translate-x-1/2 text-black text-[10px] px-2 py-0.5 rounded" style={{ backgroundColor: '#39FF14' }}>
            {frameWidthPx} × {frameHeightPx}px
          </div>
          {/* 1. 상단 바 (고정 높이) */}
          <div className="h-14 bg-gradient-to-b from-blue-100 to-blue-50 border-b-2 border-blue-300 shadow-lg grid grid-cols-3 items-center px-4">
            <div className="flex space-x-2 h-3/4 items-center">
              {/* Floor 탭들 */}
              {floorList.map((floor) => (
                <div key={floor} className="relative">
                  <button
                    className={`w-auto h-10 px-4 py-2 rounded-lg text-sm font-semibold ${
                      selectedFloor === floor
                        ? 'bg-indigo-500 text-white'
                        : 'bg-white text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 border border-gray-200'
                    }`}
                    onClick={() => handleFloorChange(floor)}
                    title={`Floor ${floor}로 전환`}
                  >
                    {floor}
                  </button>
                </div>
              ))}
            </div>
            {/* 주문채널 탭 (중앙) */}
            <div className="flex justify-center">
              {[
                { key: 'table-map', label: 'Dine-in' },
                { key: 'togo', label: 'Togo' },
                { key: 'delivery', label: 'Delivery' },
                { key: 'online', label: 'Online' }
              ].map((ch) => (
                <button
                  key={ch.key}
                  className={`h-9 px-3 mx-1 rounded-md text-sm font-medium border transition-colors ${
                    selectedChannelTab === ch.key
                      ? 'bg-purple-600 border-purple-600 text-white'
                      : 'bg-white border-gray-300 text-gray-700 hover:bg-purple-50'
                  }`}
                  onClick={() => setSelectedChannelTab(ch.key)}
                  title={ch.label}
                >
                  {ch.label}
                </button>
              ))}
            </div>
            {/* Clock In/Out Buttons (오른쪽) */}
            <div className="flex justify-end items-center">
              <button
                onClick={() => {
                  console.log('테스트 버튼 클릭됨!');
                  alert('버튼이 작동합니다!');
                }}
                className="h-9 px-3 bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold rounded mr-2"
              >
                테스트
              </button>
              <ClockInOutButtons compact />
            </div>
          </div>

          {/* 2. 중앙 영역 (프레임 높이에서 헤더/푸터 제외) */}
          <div className="flex-1 flex" style={{ height: `${contentHeightPx}px`, width: `${frameWidthPx}px` }}>
            {/* 3. 좌측 66% - Table Map 영역 */}
            <div 
              className="relative"
              style={{ width: `${leftWidthPx}px`, height: `${contentHeightPx}px` }}
            >
              {/* Move/Merge & Print Bill 모드 상태 표시 */}
              {(isMoveMergeMode || isBillPrintMode) && (moveMergeStatus || billPrintStatus) && (
                <div className="absolute top-2 left-1/2 transform -translate-x-1/2 z-50 px-4 py-2 rounded-lg shadow-lg text-white font-semibold text-sm"
                  style={{
                    backgroundColor: isBillPrintMode ? 'rgba(16, 185, 129, 0.95)' : 'rgba(139, 92, 246, 0.95)',
                    maxWidth: '90%'
                  }}>
                  {isBillPrintMode ? billPrintStatus : moveMergeStatus}
                </div>
              )}
              {/* 테이블맵 캔버스 (BO와 동일 고정 해상도 적용) */}
              <div 
                className="relative bg-white border-2 border-gray-300 shadow-lg"
                style={{
                  width: `${leftWidthPx}px`,
                  height: `${contentHeightPx}px`,
                  marginLeft: 'auto',
                  marginRight: 'auto'
                }}
              >
                {loading ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
                      <p className="text-sm text-gray-600">데이터 로딩 중...</p>
                    </div>
                  </div>
                ) : (
                  tableElements.map((element) => (
                    <div
                      key={element.id}
                      style={getElementStyle(element)}
                      className={`${getElementClass(element)} hover:border-blue-400`}
                      onMouseDown={() => setPressedTableId(String(element.id))}
                      onMouseUp={() => handleTableClick(element)}
                      onTouchStart={() => setPressedTableId(String(element.id))}
                      onTouchEnd={() => handleTableClick(element)}
                      onMouseLeave={() => setPressedTableId(prev => (prev === String(element.id) ? null : prev))}
                      title={`${element.type} - ${element.status || 'Available'}`}
                    >
                      {element.type === 'restroom' ? (
                        <img src={process.env.PUBLIC_URL + '/images/restroom.png'} alt="Restroom" className="w-full h-full object-contain" draggable={false} />
                      ) : element.type === 'counter' ? (
                        <img src={process.env.PUBLIC_URL + '/images/pos.png'} alt="Counter" className="w-full h-full object-contain" draggable={false} />
                      ) : (
                        (() => {
                          const raw = getElementDisplayName(element) || '';
                          const parts = String(raw).split('\n');
                          const firstLine = parts[0] || '';
                          const secondLine = parts[1] || '';
                          const baseFont = (element as any).fontSize ? Number((element as any).fontSize) : 14;
                          const timeFont = Math.max(8, Math.round((baseFont / 2) * 1.3225));
                          return (
                            <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                              <div
                                style={{
                                  position: 'absolute',
                                  inset: 0,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  textAlign: 'center',
                                  lineHeight: 1.0,
                                  transform: `rotate(${-Number(element.rotation || 0)}deg)`,
                                  transformOrigin: 'center'
                                }}
                              >
                                <div style={{ fontSize: baseFont, fontWeight: 'bold' }}>{firstLine}</div>
                                {secondLine ? (
                                  <div style={{ fontSize: timeFont, marginTop: 2 }}>{secondLine}</div>
                                ) : null}
                              </div>
                            </div>
                          );
                        })()
                      )}
                    </div>
                  ))
                )}
            </div>
          </div>

          {/* 4. 우측 34% - Togo Order 현황판 */}
          <div className="bg-blue-50 border-l border-gray-300 relative flex flex-col overflow-hidden" style={{ width: `${rightWidthPx}px`, height: `${contentHeightPx}px`, zIndex: 10 }}>
            {/* Scrollable content */}
            <div className="flex-1 overflow-auto p-2 pb-[85px]">
              <div className="flex items-center justify-between mb-3 gap-2">
                <button
                  onClick={handleNewTogoClick}
                  className="px-[13px] py-3 min-h-[44px] bg-green-800 text-white text-base font-medium rounded-lg hover:bg-green-900"
                >
                  New Togo
                </button>
                <div className="flex items-center gap-2 flex-1">
                  <div className="relative w-4/5">
                    <input value={togoSearch} onChange={e=>setTogoSearch(e.target.value)} className="w-full px-3 py-2 text-base border rounded-md min-h-[44px]" />
                    <span className="absolute right-10 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                    </span>
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                      onClick={() => { setSoftKbOpen(true); }}
                      title="Virtual keyboard"
                      aria-label="Virtual keyboard"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="6" width="20" height="12" rx="2" ry="2"></rect>
                        <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12"></path>
                      </svg>
                    </button>
                  </div>
                  <button className="px-4 py-2 min-h-[44px] bg-gray-300 text-gray-800 text-base rounded-md hover:bg-gray-400" onClick={()=>setTogoSearch('')} title="Clear">Clear</button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1 mb-3">
                {/* 왼쪽: Online 주문리스트 - 픽업시간 오름차순 정렬 */}
                <div className="space-y-1">
                  {[...onlineQueueCards].sort((a, b) => {
                    const getTimeMs = (order: any): number => {
                      // pickupTime 우선, 없으면 placedTime 사용
                      const pt = order.pickupTime;
                      if (pt) {
                        if (pt._seconds) return pt._seconds * 1000;
                        const d = new Date(pt);
                        if (!isNaN(d.getTime())) return d.getTime();
                      }
                      const placed = order.placedTime || order.time;
                      if (placed) {
                        const d = new Date(placed);
                        if (!isNaN(d.getTime())) return d.getTime();
                      }
                      return Infinity;
                    };
                    return getTimeMs(a) - getTimeMs(b);
                  }).map((card) => {
                    const q = togoSearch.trim().toLowerCase();
                    const inNumber = String(card.number).includes(q);
                    const inPhone = card.phone.toLowerCase().includes(q);
                    const inName = card.name.toLowerCase().includes(q);
                    const inItems = card.items.join(' ').toLowerCase().includes(q);
                    const matched = !q || inNumber || inPhone || inName || inItems;
                    
                    // Move/Merge 모드일 때 상태 표시
                    const isSourceOnline = isMoveMergeMode && sourceOnlineOrder?.id === card.id;
                    const isTargetSelectable = isMoveMergeMode && sourceTableId && selectionChoice;
                    
                    let backgroundColor = '#B1C4DD';
                    let borderColor = matched && q ? '#B91C1C' : '#9BB3D1';
                    let borderWidth = 1;
                    
                    if (isSourceOnline) {
                      // 출발 Online - 보라색 강조
                      backgroundColor = '#A78BFA';
                      borderColor = '#7C3AED';
                      borderWidth = 4;
                    } else if (isTargetSelectable) {
                      // 목적 선택 가능 - 연보라색
                      backgroundColor = '#D4B8E8';
                      borderColor = '#8B5CF6';
                      borderWidth = 3;
                    }

                    const cls = [
                      'w-full rounded-lg p-1 shadow-inner border transition-all duration-200 text-left',
                      'hover:shadow-lg',
                      q && !matched ? 'opacity-40 pointer-events-none' : '',
                      isTargetSelectable && !isSourceOnline ? 'animate-pulse' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    return (
                      <button
                        key={card.id}
                        className={cls}
                        style={{ backgroundColor, borderColor, borderWidth }}
                        onClick={() => handleVirtualOrderCardClick('online', card)}
                      >
                        {isSourceOnline && (
                          <div className="text-[10px] font-bold text-white mb-0.5">◀ Source Online</div>
                        )}
                        {isTargetSelectable && !isSourceOnline && (
                          <div className="text-[10px] font-bold text-purple-700 mb-0.5">▶ Merge Target</div>
                        )}
                        <div className="text-[13px] font-medium text-gray-800 mb-0.5 flex items-center">
                          <span className="w-[50px] text-left">Online</span>
                          <span className="flex-1 text-center">#{card.number}</span>
                          <span className="font-bold text-gray-900 text-right">{card.time}</span>
                        </div>
                        <div className="text-[13px] text-gray-700 flex justify-between items-center">
                          <span className="font-bold text-gray-900">{card.phone}</span>
                          <span className="text-[12px] text-right">{card.name}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                
                {/* 오른쪽: Togo 주문리스트 - 픽업시간 오름차순 정렬 */}
                <div className="space-y-1">
                  {[...togoOrders]
                    .sort((a, b) => (a.readyTimeLabel || '99:99').localeCompare(b.readyTimeLabel || '99:99'))
                    .filter(o => {
                      const q = togoSearch.trim().toLowerCase();
                      if (!q) return true;
                      const sequenceValue = o.sequenceNumber != null ? String(o.sequenceNumber).toLowerCase() : '';
                      const rawOrderNumber = String(o.number || '').toLowerCase();
                      const inNumber = sequenceValue.includes(q) || rawOrderNumber.includes(q);
                      const inPhone = String(o.phone || '').toLowerCase().includes(q);
                      const inName = String(o.name || '').toLowerCase().includes(q);
                      const items = (o.items || o.orderItems || [])
                        .map((it: any) => String(it.name || '').toLowerCase())
                        .join(' ');
                      const inItems = items.includes(q);
                      return inNumber || inPhone || inName || inItems;
                    })
                    .map((order) => {
                      // Move/Merge 모드일 때 상태 표시
                      const isSourceTogo = isMoveMergeMode && sourceTogoOrder?.id === order.id;
                      const isTargetSelectable = isMoveMergeMode && (
                        (sourceTableId && selectionChoice) || 
                        (sourceTogoOrder && sourceTogoOrder.id !== order.id) ||
                        (sourceOnlineOrder)
                      );
                      
                      let backgroundColor = '#A8D5A8';
                      let borderColor = '#95C295';
                      let borderWidth = 1;
                      
                      if (isSourceTogo) {
                        // 출발 Togo - 보라색 강조
                        backgroundColor = '#A78BFA';
                        borderColor = '#7C3AED';
                        borderWidth = 4;
                      } else if (isTargetSelectable) {
                        // 목적 Togo 선택 가능 - 연보라색
                        backgroundColor = '#D4B8E8';
                        borderColor = '#8B5CF6';
                        borderWidth = 3;
                      }

                      return (
                    <button 
                      key={order.id}
                          className={[
                            'w-full rounded-lg p-1 shadow-inner border transition-all duration-200 text-left hover:shadow-lg',
                            isTargetSelectable && !isSourceTogo ? 'animate-pulse' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          style={{ backgroundColor, borderColor, borderWidth }}
                          onClick={(e) => {
                            e.stopPropagation();
                            console.log('[TOGO BUTTON CLICKED]', { orderId: order.id, isSourceTogo, isTargetSelectable, isMoveMergeMode, sourceTableId, sourceTogoOrder });
                            handleVirtualOrderCardClick('togo', order);
                          }}
                        >
                          {isSourceTogo && (
                            <div className="text-[10px] font-bold text-white mb-0.5">◀ Source Togo</div>
                          )}
                          {isTargetSelectable && !isSourceTogo && (
                            <div className="text-[10px] font-bold text-purple-700 mb-0.5">▶ Merge Target</div>
                          )}
                          <div className="text-[13px] font-medium text-gray-800 mb-0.5 flex items-center">
                            <span className="w-[50px] text-left">Togo</span>
                            <span className="flex-1 text-center">#{order.id ?? '—'}</span>
                            <span className="font-bold text-gray-900 text-right flex items-center gap-1">
                              {order.readyTimeLabel || '--:--'}
                              {String(order.fulfillment || order.type).toLowerCase() === 'delivery' && (
                                <span className="px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide rounded-full bg-red-100 text-red-700 border border-red-300">
                                  DLV
                                </span>
                              )}
                            </span>
                      </div>
                          <div className="text-[13px] text-gray-700 flex justify-between">
                            <span className="font-bold text-gray-900 truncate pr-2">{formatOrderPhoneDisplay(order.phone) || '—'}</span>
                            <span className="text-[13px] text-gray-800 truncate text-right">{order.name || ''}</span>
                          </div>
                          {order.serverName ? (
                            <div className="text-[12px] text-gray-600">
                              Server: {formatEmployeeName(order.serverName)}
                            </div>
                          ) : null}
                    </button>
                      );
                    })}
                </div>
              </div>
            </div>

            {/* 하단 플로팅 예약 현황 - Online+Togo 그리드와 동일한 너비 */}
            <div className="absolute bg-amber-50/95 border border-amber-300 rounded-lg px-3 py-2 shadow-[0_-4px_12px_rgba(0,0,0,0.15)] z-[100] backdrop-blur-sm" style={{ height: '72px', left: '8px', right: '20px', bottom: '3px' }}>
              <div className="flex items-center justify-between mb-1">
                <div className="text-amber-800 text-xs font-bold flex items-center gap-1.5">
                  <span className="text-sm">📅</span>
                  Today's Reservations ({todayReservations.length})
                </div>
              </div>
              {todayReservations.length === 0 ? (
                <div className="text-[10px] text-amber-600/60 italic text-center py-1">No reservations for today</div>
              ) : (
                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                  {todayReservations.map((res: any, idx: number) => (
                    <div key={res.id || idx} className="flex-shrink-0 flex items-center gap-2 bg-white/80 px-2.5 py-1 rounded-lg border border-amber-200 shadow-sm min-w-[140px]">
                      <span className="font-extrabold text-amber-900 text-xs">{res.reservation_time || res.time || '--:--'}</span>
                      <span className="text-gray-800 text-xs font-bold truncate max-w-[70px]">{res.customer_name || res.name || '—'}</span>
                      <span className="bg-amber-100 text-amber-800 text-[9px] font-black px-1 py-0.5 rounded">p{res.party_size || res.guests || 0}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          </div>
          {/* 3. 하단 액션 바 (프레임 내부) */}
          <div className="bg-gray-200 border-t border-gray-300 py-1.5 pl-3 pr-3" style={{ height: '70px' }}>
            <div className="grid grid-cols-10 h-full w-full gap-1">
              {buttonData.map((buttonName, index) => {
                const isMoveMergeActive = buttonName === 'Move/Merge' && isMoveMergeMode;
                const isBillPrintActive = buttonName === 'Prep Time' && isBillPrintMode;
                const isButtonActive = isMoveMergeActive || isBillPrintActive;
                return (
                  <div key={buttonName} className="h-full flex items-center justify-center relative group">
                <button
                  onClick={() => handleButtonClick(buttonName)}
                      className={`relative w-full h-full rounded-lg text-base font-semibold flex items-center justify-center text-center leading-tight transition-all duration-200 shadow-md hover:shadow-lg active:shadow-sm active:translate-y-[1px] ring-1 ring-black/10 hover:ring-black/20 ${
                        isMoveMergeActive ? 'text-white bg-gradient-to-r from-purple-500 via-indigo-500 to-purple-600' : 
                        isBillPrintActive ? 'text-white bg-gradient-to-r from-emerald-500 via-green-500 to-emerald-600' : 'text-white'
                      }`}
                      style={
                        isMoveMergeActive
                          ? {
                              backgroundImage: 'linear-gradient(135deg, rgba(99,102,241,0.95), rgba(139,92,246,0.85))',
                              color: 'white',
                              position: 'relative',
                              overflow: 'hidden',
                            }
                          : isBillPrintActive
                          ? {
                              backgroundImage: 'linear-gradient(135deg, rgba(16,185,129,0.95), rgba(52,211,153,0.85))',
                              color: 'white',
                              position: 'relative',
                              overflow: 'hidden',
                            }
                          : { backgroundColor: getButtonColor(buttonName, index) }
                      }
                  onMouseEnter={(e) => {
                        if (isButtonActive) return;
                    e.currentTarget.style.filter = 'brightness(0.9)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.filter = 'brightness(1)';
                  }}
                >
                  {buttonName}
                      {isMoveMergeActive && (
                        <span
                          className="absolute bottom-1 left-1 right-1 h-[3px] rounded-full bg-white/80 opacity-90"
                          style={{
                            animation: 'beamSweep 0.9s linear infinite',
                            boxShadow: '0 0 12px rgba(255,255,255,0.7)',
                          }}
                        />
                      )}
                </button>
                {/* Tiny history button for Move/Merge */}
                {buttonName === 'Move/Merge' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowMoveHistory(true);
                    }}
                    className="absolute top-[-8px] right-[-8px] w-6 h-6 bg-gray-800 text-white rounded-full flex items-center justify-center shadow-md hover:bg-gray-700 z-10 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="View History"
                  >
                    <span className="text-[10px]">H</span>
                  </button>
                )}
            </div>
                );
              })}
          </div>
          </div>
        <TogoOrderModal />
        
        {/* Prep Time Settings Modal */}
        {showPrepTimeModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div 
              className="bg-white rounded-xl shadow-2xl w-[440px]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 bg-slate-700 rounded-t-xl">
                <h2 className="text-lg font-bold text-white">⏱️ Prep Time Settings</h2>
                <button
                  onClick={() => setShowPrepTimeModal(false)}
                  className="text-white hover:bg-white/20 rounded-full p-1"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              {/* Content */}
              <div className="p-4">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b">
                      <th className="text-left py-2 font-medium">Service</th>
                      <th className="text-center py-2 font-medium">Mode</th>
                      <th className="text-center py-2 font-medium">Prep Time</th>
                      <th className="w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* TheZoneOrder */}
                    <tr className="border-b border-gray-100">
                      <td className="py-3">
                        <span className="text-sm font-bold text-orange-600">TheZoneOrder</span>
                      </td>
                      <td className="py-3">
                        <div className="flex justify-center">
                          <div className="inline-flex bg-gray-100 rounded-md p-0.5">
                            <button
                              onClick={() => setPrepTimeSettings(prev => ({ ...prev, thezoneorder: { ...prev.thezoneorder, mode: 'auto' } }))}
                              className={`px-3 py-1 rounded text-xs font-semibold transition-all ${prepTimeSettings.thezoneorder.mode === 'auto' ? 'bg-orange-500 text-white' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                              Auto
                            </button>
                            <button
                              onClick={() => setPrepTimeSettings(prev => ({ ...prev, thezoneorder: { ...prev.thezoneorder, mode: 'manual' } }))}
                              className={`px-3 py-1 rounded text-xs font-semibold transition-all ${prepTimeSettings.thezoneorder.mode === 'manual' ? 'bg-orange-500 text-white' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                              Manual
                            </button>
                          </div>
                        </div>
                      </td>
                      <td className="py-3">
                        <select
                          value={prepTimeSettings.thezoneorder.time}
                          onChange={(e) => setPrepTimeSettings(prev => ({ ...prev, thezoneorder: { ...prev.thezoneorder, time: e.target.value } }))}
                          className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm font-semibold text-center bg-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                        >
                          {['10m', '15m', '20m', '25m', '30m', '45m', '1h'].map((time) => (
                            <option key={time} value={time}>{time}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-3 pl-2">
                        <button
                          onClick={() => setPrepTimeSettings(prev => ({
                            ...prev,
                            ubereats: { ...prev.ubereats, time: prev.thezoneorder.time },
                            doordash: { ...prev.doordash, time: prev.thezoneorder.time },
                            skipthedishes: { ...prev.skipthedishes, time: prev.thezoneorder.time },
                          }))}
                          className="px-2 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs font-semibold whitespace-nowrap"
                        >
                          Apply All
                        </button>
                      </td>
                    </tr>

                    {/* UberEats */}
                    <tr className="border-b border-gray-100">
                      <td className="py-3">
                        <span className="text-sm font-bold text-green-600">UberEats</span>
                      </td>
                      <td className="py-3">
                        <div className="flex justify-center">
                          <div className="inline-flex bg-gray-100 rounded-md p-0.5">
                            <button
                              onClick={() => setPrepTimeSettings(prev => ({ ...prev, ubereats: { ...prev.ubereats, mode: 'auto' } }))}
                              className={`px-3 py-1 rounded text-xs font-semibold transition-all ${prepTimeSettings.ubereats.mode === 'auto' ? 'bg-green-500 text-white' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                              Auto
                            </button>
                            <button
                              onClick={() => setPrepTimeSettings(prev => ({ ...prev, ubereats: { ...prev.ubereats, mode: 'manual' } }))}
                              className={`px-3 py-1 rounded text-xs font-semibold transition-all ${prepTimeSettings.ubereats.mode === 'manual' ? 'bg-green-500 text-white' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                              Manual
                            </button>
                          </div>
                        </div>
                      </td>
                      <td className="py-3">
                        <select
                          value={prepTimeSettings.ubereats.time}
                          onChange={(e) => setPrepTimeSettings(prev => ({ ...prev, ubereats: { ...prev.ubereats, time: e.target.value } }))}
                          className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm font-semibold text-center bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
                        >
                          {['10m', '15m', '20m', '25m', '30m', '45m', '1h'].map((time) => (
                            <option key={time} value={time}>{time}</option>
                          ))}
                        </select>
                      </td>
                      <td></td>
                    </tr>

                    {/* DoorDash */}
                    <tr className="border-b border-gray-100">
                      <td className="py-3">
                        <span className="text-sm font-bold text-red-600">DoorDash</span>
                      </td>
                      <td className="py-3">
                        <div className="flex justify-center">
                          <div className="inline-flex bg-gray-100 rounded-md p-0.5">
                            <button
                              onClick={() => setPrepTimeSettings(prev => ({ ...prev, doordash: { ...prev.doordash, mode: 'auto' } }))}
                              className={`px-3 py-1 rounded text-xs font-semibold transition-all ${prepTimeSettings.doordash.mode === 'auto' ? 'bg-red-500 text-white' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                              Auto
                            </button>
                            <button
                              onClick={() => setPrepTimeSettings(prev => ({ ...prev, doordash: { ...prev.doordash, mode: 'manual' } }))}
                              className={`px-3 py-1 rounded text-xs font-semibold transition-all ${prepTimeSettings.doordash.mode === 'manual' ? 'bg-red-500 text-white' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                              Manual
                            </button>
                          </div>
                        </div>
                      </td>
                      <td className="py-3">
                        <select
                          value={prepTimeSettings.doordash.time}
                          onChange={(e) => setPrepTimeSettings(prev => ({ ...prev, doordash: { ...prev.doordash, time: e.target.value } }))}
                          className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm font-semibold text-center bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
                        >
                          {['10m', '15m', '20m', '25m', '30m', '45m', '1h'].map((time) => (
                            <option key={time} value={time}>{time}</option>
                          ))}
                        </select>
                      </td>
                      <td></td>
                    </tr>

                    {/* SkipTheDishes */}
                    <tr>
                      <td className="py-3">
                        <span className="text-sm font-bold text-purple-600">SkipTheDishes</span>
                      </td>
                      <td className="py-3">
                        <div className="flex justify-center">
                          <div className="inline-flex bg-gray-100 rounded-md p-0.5">
                            <button
                              onClick={() => setPrepTimeSettings(prev => ({ ...prev, skipthedishes: { ...prev.skipthedishes, mode: 'auto' } }))}
                              className={`px-3 py-1 rounded text-xs font-semibold transition-all ${prepTimeSettings.skipthedishes.mode === 'auto' ? 'bg-purple-500 text-white' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                              Auto
                            </button>
                            <button
                              onClick={() => setPrepTimeSettings(prev => ({ ...prev, skipthedishes: { ...prev.skipthedishes, mode: 'manual' } }))}
                              className={`px-3 py-1 rounded text-xs font-semibold transition-all ${prepTimeSettings.skipthedishes.mode === 'manual' ? 'bg-purple-500 text-white' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                              Manual
                            </button>
                          </div>
                        </div>
                      </td>
                      <td className="py-3">
                        <select
                          value={prepTimeSettings.skipthedishes.time}
                          onChange={(e) => setPrepTimeSettings(prev => ({ ...prev, skipthedishes: { ...prev.skipthedishes, time: e.target.value } }))}
                          className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm font-semibold text-center bg-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                        >
                          {['10m', '15m', '20m', '25m', '30m', '45m', '1h'].map((time) => (
                            <option key={time} value={time}>{time}</option>
                          ))}
                        </select>
                      </td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              
              {/* Footer */}
              <div className="flex justify-end gap-2 px-4 py-3 bg-gray-100 rounded-b-xl border-t">
                <button
                  onClick={() => setShowPrepTimeModal(false)}
                  className="px-5 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    localStorage.setItem('prepTimeSettings', JSON.stringify(prepTimeSettings));
                    setShowPrepTimeModal(false);
                  }}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 새 온라인 주문 알림 모달 (Manual 모드) */}
        {showNewOrderAlert && newOrderAlertData && (
          <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[70]">
            <div className="bg-white rounded-2xl shadow-2xl w-[480px] max-h-[90vh] overflow-hidden animate-pulse-once">
              {/* Header */}
              <div className="bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-4">
                <h2 className="text-xl font-bold text-white text-center">🔔 New Online Order</h2>
              </div>
              
              {/* 주문 정보 */}
              <div className="p-5 space-y-4">
                {/* 고객 정보 */}
                <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500 text-sm">Customer</span>
                    <span className="font-semibold text-lg">{newOrderAlertData.customerName || 'Unknown'}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500 text-sm">Phone</span>
                    <span className="font-semibold">{newOrderAlertData.customerPhone || '-'}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500 text-sm">Order Type</span>
                    <span className="font-semibold capitalize">{newOrderAlertData.orderType || 'Online'}</span>
                  </div>
                </div>
                
                {/* 주문 항목 */}
                <div className="bg-gray-50 rounded-xl p-4">
                  <div className="text-gray-500 text-sm mb-2">Items</div>
                  <div className="max-h-[150px] overflow-y-auto space-y-1">
                    {(newOrderAlertData.items || []).map((item: any, idx: number) => (
                      <div key={idx} className="flex justify-between text-sm">
                        <span>{item.quantity || 1}x {item.name}</span>
                        <span className="font-medium">${(item.price * (item.quantity || 1)).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="border-t mt-3 pt-3 flex justify-between font-bold text-lg">
                    <span>Total</span>
                    <span className="text-green-600">${(newOrderAlertData.total || 0).toFixed(2)}</span>
                  </div>
                </div>
                
                {/* Prep Time 선택 */}
                <div className="bg-blue-50 rounded-xl p-4">
                  <div className="text-blue-700 font-semibold mb-3 text-center">Select Prep Time</div>
                  <div className="grid grid-cols-6 gap-2">
                    {[10, 15, 20, 30, 45, 60].map((min) => (
                      <button
                        key={min}
                        onClick={() => setSelectedPrepTime(min)}
                        className={`py-3 rounded-lg font-bold text-sm transition-all ${
                          selectedPrepTime === min
                            ? 'bg-blue-600 text-white shadow-lg scale-105'
                            : 'bg-white text-gray-700 border border-gray-200 hover:border-blue-400'
                        }`}
                      >
                        {min}m
                      </button>
                    ))}
                  </div>
                  <div className="text-center mt-3 text-sm text-gray-600">
                    Pickup Time: <span className="font-bold text-blue-700">
                      {new Date(Date.now() + selectedPrepTime * 60000).toLocaleTimeString('en-US', { 
                        hour: '2-digit', minute: '2-digit', hour12: true 
                      })}
                    </span>
                  </div>
                </div>
              </div>
              
              {/* 버튼 */}
              <div className="px-5 pb-5 flex gap-3">
                <button
                  onClick={async () => {
                    // Reject: 주문 거절
                    try {
                      await fetch(`${API_URL}/online-orders/order/${newOrderAlertData.id}/reject`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                      });
                      console.log('Order rejected:', newOrderAlertData.id);
                    } catch (error) {
                      console.error('Failed to reject order:', error);
                    }
                    setShowNewOrderAlert(false);
                    setNewOrderAlertData(null);
                    loadOnlineOrders();
                  }}
                  className="flex-1 py-4 bg-gray-400 hover:bg-gray-500 text-white rounded-xl font-bold text-lg transition-colors"
                >
                  Reject
                </button>
                <button
                  onClick={async () => {
                    // Accept: 주문 수락
                    try {
                      const pickupTime = new Date(Date.now() + selectedPrepTime * 60000).toISOString();
                      await fetch(`${API_URL}/online-orders/order/${newOrderAlertData.id}/accept`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                          prepTime: selectedPrepTime,
                          pickupTime: pickupTime
                        }),
                      });
                      console.log('Order accepted:', newOrderAlertData.id, 'Prep time:', selectedPrepTime);
                    } catch (error) {
                      console.error('Failed to accept order:', error);
                    }
                    setShowNewOrderAlert(false);
                    setNewOrderAlertData(null);
                    loadOnlineOrders();
                  }}
                  className="flex-[2] py-4 bg-green-500 hover:bg-green-600 text-white rounded-xl font-bold text-lg transition-colors"
                >
                  Accept
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Order List Modal - Inline rendering to prevent scroll reset on state change */}
        {showOrderListModal && (() => {
          const totals = orderListSelectedOrder ? orderListCalculateTotals() : null;
          return (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div 
                className="bg-gray-200 rounded-xl shadow-2xl w-full max-w-[1000px] h-full max-h-[740px] min-h-[400px] flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-300 bg-slate-700 rounded-t-xl flex-shrink-0">
                  <h2 className="text-lg sm:text-xl font-bold text-white">Order History</h2>
                  <div className="flex items-center gap-2 sm:gap-3 relative">
                    <button
                      onClick={() => handleOrderListDateChange(-1)}
                      className="px-3 sm:px-5 py-2 sm:py-3 bg-gray-200 hover:bg-gray-300 rounded-lg text-sm sm:text-base font-bold active:bg-gray-400"
                    >
                      ◀
                    </button>
                    <button
                      onClick={() => {
                        setOrderListCalendarMonth(new Date(orderListDate));
                        setShowOrderListCalendar(!showOrderListCalendar);
                      }}
                      className="px-3 sm:px-5 py-2 sm:py-3 bg-white hover:bg-gray-50 border-2 border-gray-300 rounded-lg text-sm sm:text-base font-bold min-w-[150px] sm:min-w-[200px] text-center active:bg-gray-100"
                    >
                      📅 {orderListFormatDate(orderListDate)}
                    </button>
                    <button
                      onClick={() => handleOrderListDateChange(1)}
                      className="px-3 sm:px-5 py-2 sm:py-3 bg-gray-200 hover:bg-gray-300 rounded-lg text-sm sm:text-base font-bold active:bg-gray-400"
                    >
                      ▶
                    </button>

                    {/* Calendar Dropdown */}
                    {showOrderListCalendar && (
                      <div className="absolute top-full mt-2 left-1/2 transform -translate-x-1/2 bg-white rounded-lg shadow-xl border border-gray-300 p-3 z-50" style={{ width: '300px' }}>
                        <div className="flex items-center justify-between mb-3">
                          <button
                            onClick={() => setOrderListCalendarMonth(new Date(orderListCalendarMonth.getFullYear(), orderListCalendarMonth.getMonth() - 1))}
                            className="p-2 hover:bg-gray-100 rounded-lg text-lg font-bold"
                          >
                            ◀
                          </button>
                          <span className="font-bold text-lg">
                            {orderListCalendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                          </span>
                          <button
                            onClick={() => setOrderListCalendarMonth(new Date(orderListCalendarMonth.getFullYear(), orderListCalendarMonth.getMonth() + 1))}
                            className="p-2 hover:bg-gray-100 rounded-lg text-lg font-bold"
                          >
                            ▶
                          </button>
                        </div>
                        <div className="grid grid-cols-7 gap-1 text-center text-sm mb-2">
                          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
                            <div key={d} className="font-bold text-gray-500 py-1">{d}</div>
                          ))}
                        </div>
                        <div className="grid grid-cols-7 gap-1">
                          {orderListGetDaysInMonth(orderListCalendarMonth).map((day, idx) => (
                            <button
                              key={idx}
                              onClick={() => day && orderListHandleCalendarDateSelect(day)}
                              disabled={!day}
                              className={`p-2 rounded-lg text-sm font-medium ${
                                !day ? '' :
                                day.toISOString().split('T')[0] === orderListDate 
                                  ? 'bg-blue-600 text-white' 
                                  : 'hover:bg-gray-100'
                              }`}
                            >
                              {day?.getDate() || ''}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      setShowOrderListModal(false);
                      setShowOrderListCalendar(false);
                      setOrderListSelectedOrder(null);
                      setOrderListSelectedItems([]);
                    }}
                    className="px-4 sm:px-6 py-2 sm:py-3 bg-red-500 hover:bg-red-600 active:bg-red-700 text-white rounded-lg text-base sm:text-lg font-bold"
                  >
                    ✕ Close
                  </button>
                </div>

                {/* Content - 6:4 Split */}
                <div className="flex flex-col md:flex-row p-2 sm:p-3 gap-2 sm:gap-3 flex-1 min-h-0" style={{ overflow: 'hidden' }}>
                  {/* Left Panel - Order List (60%) */}
                  <div className="w-full md:w-[60%] h-1/2 md:h-full bg-white rounded-xl shadow-lg border-2 border-gray-300 flex flex-col" style={{ overflow: 'hidden' }}>
                    <div className="bg-slate-700 px-2 py-2.5 text-sm font-bold text-white flex items-center gap-1.5 flex-shrink-0">
                      <span className="w-16 text-center">Channel</span>
                      <span className="w-28">ID / Order#</span>
                      <span className="w-20 text-center">Time</span>
                      <span className="flex-1 ml-2">Table/Customer</span>
                      <span className="w-18 text-right">Amount</span>
                    </div>
                    <div 
                      className="flex-1 bg-slate-50 relative" 
                      style={{ 
                        overflowY: 'auto', 
                        overflowX: 'hidden',
                        overscrollBehavior: 'contain', 
                        WebkitOverflowScrolling: 'touch',
                        minHeight: 0,
                        maxHeight: '100%'
                      }}
                    >
                      {orderListLoading ? (
                        <div className="flex items-center justify-center h-32 text-gray-500 text-base">Loading...</div>
                      ) : orderListOrders.length === 0 ? (
                        <div className="flex items-center justify-center h-32 text-gray-500 text-base">No orders found</div>
                      ) : (
                        orderListOrders.map((order) => {
                          const badge = orderListGetChannelBadge(order);
                          return (
                            <div
                              key={order.id}
                              onClick={(e) => { e.stopPropagation(); fetchOrderDetails(order.id); }}
                              className={`flex items-center gap-1.5 px-2 py-3 text-sm cursor-pointer hover:bg-blue-100 border-b border-gray-200 ${
                                orderListSelectedOrder?.id === order.id ? 'bg-blue-200' : 'bg-white'
                              }`}
                            >
                              {/* 채널 띠지 */}
                              <span className={`w-16 px-1.5 py-1 rounded text-center text-xs font-bold ${badge.bgColor} ${badge.textColor}`}>
                                {badge.label}
                              </span>
                              <span className="w-28 leading-tight truncate" title={order.order_number || ''}>
                                <span className="font-bold text-gray-700">#{order.id}</span>
                                {order.order_number && (
                                  <span className="text-[10px] font-normal text-gray-400 ml-0.5">
                                    {order.order_number.length > 12 ? order.order_number.slice(0, 12) + '...' : order.order_number}
                                  </span>
                                )}
                              </span>
                              <span className="w-20 text-center font-bold">{orderListFormatTime(order.created_at)}</span>
                              <span className="flex-1 truncate font-bold ml-2">{orderListGetTableOrCustomer(order)}</span>
                              <span className="w-18 text-right font-bold">${Number(order.total || 0).toFixed(2)}</span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Right Panel - Order Details (40%) */}
                  <div className="w-full md:w-[40%] h-1/2 md:h-full bg-blue-50 rounded-xl shadow-lg border-2 border-blue-200 flex flex-col" style={{ overflow: 'hidden' }}>
                    {!orderListSelectedOrder ? (
                      <div className="flex-1 flex items-center justify-center text-gray-400 text-base">
                        Select an order to view details
                      </div>
                    ) : (
                      <>
                        {/* Action Buttons - 맨 위로 이동 */}
                        <div className="px-4 py-3 bg-slate-700 flex gap-3 flex-shrink-0">
                          <button
                            onClick={handleOrderListPrintBill}
                            className="flex-1 py-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg text-base font-bold"
                          >
                            🧾 Print Bill
                          </button>
                          <button
                            onClick={handleOrderListPrintKitchen}
                            className="flex-1 py-4 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white rounded-lg text-base font-bold"
                          >
                            🍳 Print to Kitchen
                          </button>
                        </div>

                        {/* Channel Header - 버튼 아래로 이동 (높이 10% 감소) */}
                        <div className="px-4 py-2 bg-slate-100 border-b border-gray-300 text-center flex-shrink-0">
                          <span className="text-lg font-bold text-slate-700">
                            {orderListGetChannelDisplay(orderListSelectedOrder)}
                          </span>
                        </div>

                        {/* Order Info Header (높이 15% 감소) */}
                        <div className="px-4 py-1 bg-white border-b border-gray-200 text-sm flex-shrink-0">
                          <div className="flex justify-between items-center">
                            <span className="font-bold text-gray-800">
                              Server: {orderListSelectedOrder.server_name || '-'}
                            </span>
                            <span className="font-bold text-gray-800">
                              #{orderListSelectedOrder.id}
                            </span>
                          </div>
                          <div className="text-xs text-gray-500 truncate" title={orderListSelectedOrder.order_number || '-'}>
                            {orderListSelectedOrder.order_number || '-'}
                          </div>
                          <div className="text-gray-600 text-xs">
                            {orderListFormatDate(orderListSelectedOrder.created_at)} {orderListFormatTime(orderListSelectedOrder.created_at)}
                          </div>
                        </div>

                        {/* Items List + Totals - 함께 스크롤 */}
                        <div 
                          className="flex-1 bg-white relative" 
                          style={{ 
                            overflowY: 'auto', 
                            overflowX: 'hidden',
                            overscrollBehavior: 'contain', 
                            WebkitOverflowScrolling: 'touch',
                            minHeight: 0,
                            maxHeight: '100%'
                          }}
                        >
                          <div className="px-4 py-2">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b-2 border-gray-300 text-gray-700">
                                  <th className="text-left py-1 w-10 font-bold text-xs">Qty</th>
                                  <th className="text-left py-1 font-bold text-xs">Item</th>
                                  <th className="text-right py-1 w-16 font-bold text-xs">Price</th>
                                </tr>
                              </thead>
                              <tbody>
                                {orderListSelectedItems.map((item, idx) => {
                                  const rawModifiers = item.modifiers_json 
                                    ? (typeof item.modifiers_json === 'string' ? JSON.parse(item.modifiers_json) : item.modifiers_json) 
                                    : [];
                                  // 다양한 modifier 형식 처리
                                  const modifierNames: string[] = [];
                                  if (Array.isArray(rawModifiers)) {
                                    rawModifiers.forEach((m: any) => {
                                      if (typeof m === 'string') {
                                        modifierNames.push(m);
                                      } else if (m?.name) {
                                        modifierNames.push(m.name);
                                      } else if (m?.modifierNames && Array.isArray(m.modifierNames)) {
                                        modifierNames.push(...m.modifierNames);
                                      } else if (m?.selectedEntries && Array.isArray(m.selectedEntries)) {
                                        m.selectedEntries.forEach((entry: any) => {
                                          if (typeof entry === 'string') modifierNames.push(entry);
                                          else if (entry?.name) modifierNames.push(entry.name);
                                        });
                                      } else if (m?.groupName) {
                                        modifierNames.push(m.groupName);
                                      }
                                    });
                                  }
                                  return (
                                    <tr key={idx} className="border-b border-gray-100">
                                      <td className="py-0.5 text-center font-medium text-sm">{item.quantity || 1}</td>
                                      <td className="py-0.5">
                                        <div className="font-medium text-sm">{item.name}</div>
                                        {modifierNames.length > 0 && (
                                          <div className="text-xs text-gray-500 ml-2">
                                            {modifierNames.map((name: string, mi: number) => (
                                              <div key={mi}>• {name}</div>
                                            ))}
                                          </div>
                                        )}
                                      </td>
                                      <td className="py-0.5 text-right font-medium text-sm">${((item.price || 0) * (item.quantity || 1)).toFixed(2)}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>

                          {/* Totals - 아이템과 함께 스크롤 */}
                          {totals && (
                            <div className="px-4 py-2 bg-slate-100 border-t-2 border-gray-300 text-sm mt-1">
                              <div className="flex justify-between py-0.5">
                                <span className="font-medium text-xs">Sub Total:</span>
                                <span className="font-medium text-xs">${totals.subtotal.toFixed(2)}</span>
                              </div>
                              {totals.discountTotal > 0 && (
                                <>
                                  <div className="flex justify-between py-0.5 text-red-600">
                                    <span className="font-medium text-xs">Discount:</span>
                                    <span className="font-medium text-xs">-${totals.discountTotal.toFixed(2)}</span>
                                  </div>
                                  <div className="flex justify-between py-0.5">
                                    <span className="font-medium text-xs">After Discount:</span>
                                    <span className="font-medium text-xs">${totals.subtotalAfterDiscount.toFixed(2)}</span>
                                  </div>
                                </>
                              )}
                              <div className="flex justify-between py-0.5">
                                <span className="font-medium text-xs">Tax:</span>
                                <span className="font-medium text-xs">${totals.tax.toFixed(2)}</span>
                              </div>
                              <div className="flex justify-between py-1 font-bold text-base border-t-2 border-gray-400 mt-1">
                                <span>Total:</span>
                                <span>${totals.total.toFixed(2)}</span>
                              </div>
                              <div className="flex justify-center py-1.5">
                                <span className={`px-5 py-1.5 rounded-lg text-sm font-bold ${
                                  orderListSelectedOrder.status === 'paid' || orderListSelectedOrder.status === 'closed' || orderListSelectedOrder.status === 'completed' || orderListSelectedOrder.status === 'PAID'
                                    ? 'bg-green-500 text-white' 
                                    : 'bg-yellow-400 text-gray-800'
                                }`}>
                                  {orderListSelectedOrder.status === 'paid' || orderListSelectedOrder.status === 'closed' || orderListSelectedOrder.status === 'completed' || orderListSelectedOrder.status === 'PAID' ? 'PAID' : 'UNPAID'}
                                </span>
                              </div>
                            </div>
                          )}

                          {/* Customer Info - 스크롤 영역 안에 포함 */}
                          {(orderListSelectedOrder.customer_name || orderListSelectedOrder.customer_phone) && (
                            <div className="px-4 py-3 bg-blue-100 border-t-2 border-blue-300 text-sm">
                              <span className="font-bold text-blue-800">Customer: </span>
                              <span className="text-blue-700 font-medium">
                                {[orderListSelectedOrder.customer_name, orderListSelectedOrder.customer_phone].filter(Boolean).join(' • ')}
                              </span>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
        <MoveMergeHistoryModal
          open={showMoveHistory}
          onClose={() => setShowMoveHistory(false)}
          API_URL={API_URL}
        />
        <SimplePartialSelectionModal
          isOpen={isSelectionModalOpen}
          tableId={sourceSelectionInfo?.tableId || ''}
          tableLabel={sourceSelectionInfo?.label || ''}
          orderId={sourceSelectionInfo?.orderId}
          onClose={handlePartialModalClose}
          onConfirm={handlePartialModalConfirm}
        />
        {showTogoOrderModal && (
          <VirtualKeyboard
            open={showTogoOrderModal}
            onType={handleTogoKeyboardType}
            onBackspace={handleTogoKeyboardBackspace}
            onClear={handleTogoKeyboardClear}
            displayText={keyboardDisplayText}
            keepOpen
            languages={['EN', 'KO']}
            currentLanguage="EN"
          maxWidthPx={keyboardMaxWidth}
          />
        )}
        </div>
        )}
      </div>

      {/* 모달들 */}
      <ServerSelectionModal
        open={showServerSelectionModal}
        loading={serverModalLoading}
        error={serverModalError}
        employees={clockedInServers}
        onClose={handleServerModalClose}
        onSelect={handleServerSelectForTogo}
      />
      <PaymentModal />
      <WaitingListModal
        open={showWaitingModal}
        onClose={() => setShowWaitingModal(false)}
        onAssignTable={(entry) => {
          // Enable assign-from-waiting mode; next table click will reserve it for this entry
          setSelectedWaitingEntry(entry);
          try { alert('배정할 테이블을 선택하세요.'); } catch {}
        }}
      />

      {/* Online Order Panel */}
      <OnlineOrderPanel
        restaurantId={onlineOrderRestaurantId}
        isOpen={showOnlineOrderPanel}
        onClose={() => setShowOnlineOrderPanel(false)}
        autoConfirm={false}
        soundEnabled={true}
      />

      {/* Online/Togo 결제 모달 - z-index를 더 높게 설정 */}
      <div style={{ position: 'relative', zIndex: 60 }}>
      <TablePaymentModal
        isOpen={showOnlineTogoPaymentModal}
        onClose={() => {
          setShowOnlineTogoPaymentModal(false);
          setOnlineTogoPaymentOrder(null);
        }}
        subtotal={onlineTogoPaymentOrder?.subtotal || 0}
        taxLines={onlineTogoPaymentOrder?.tax ? [{ name: 'Tax', amount: onlineTogoPaymentOrder.tax }] : []}
        total={onlineTogoPaymentOrder?.total || 0}
        channel={onlineTogoPaymentOrder?.type?.toLowerCase() || 'togo'}
        customerName={onlineTogoPaymentOrder?.name || ''}
        tableName={`${onlineTogoPaymentOrder?.type || 'Order'} #${onlineTogoPaymentOrder?.number || ''}`}
        onConfirm={async (payload: { method: string; amount: number; tip: number }) => {
          console.log('Payment confirmed:', payload, 'for order:', onlineTogoPaymentOrder);
          // onConfirm은 결제 처리 후 호출되므로, 여기서는 로깅만 수행
        }}
        onComplete={async () => {
          // 결제 모달 닫기
          setShowOnlineTogoPaymentModal(false);
          
          try {
            // 주문 타입에 따라 다른 API 호출
            if (selectedOrderType === 'online' && onlineTogoPaymentOrder?.id) {
              // 온라인 주문: Firebase 상태를 completed로 업데이트
              const response = await fetch(`${API_URL}/online-orders/order/${onlineTogoPaymentOrder.id}/complete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
              });
              if (response.ok) {
                console.log('Online order status updated to completed');
              } else {
                console.error('Failed to update online order status');
              }
            } else if (selectedOrderType === 'togo' && onlineTogoPaymentOrder?.id) {
              // Togo 주문: 로컬 DB 상태를 PAID로 업데이트
              const response = await fetch(`${API_URL}/orders/${onlineTogoPaymentOrder.id}/close`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
              });
              if (response.ok) {
                console.log('Togo order status updated to PAID');
              } else {
                console.error('Failed to update Togo order status');
              }
            }
          } catch (error) {
            console.error('Payment status update error:', error);
          }
          
          // 현재 선택된 주문의 상태를 paid로 업데이트 (UI 즉시 반영)
          if (selectedOrderDetail && onlineTogoPaymentOrder) {
            const updatedOrder = {
              ...selectedOrderDetail,
              status: 'paid',
              fullOrder: selectedOrderDetail.fullOrder 
                ? { ...selectedOrderDetail.fullOrder, status: 'completed' }
                : { status: 'completed' }
            };
            setSelectedOrderDetail(updatedOrder);
            
            // 주문 목록에서도 상태 업데이트
            if (selectedOrderType === 'online') {
              setOnlineQueueCards(prev => prev.map(card => 
                card.id === onlineTogoPaymentOrder.id 
                  ? { ...card, status: 'PAID', fullOrder: { ...card.fullOrder, status: 'completed' } }
                  : card
              ));
            } else if (selectedOrderType === 'togo') {
              setTogoOrders(prev => prev.map(order => 
                order.id === onlineTogoPaymentOrder.id 
                  ? { ...order, status: 'paid' }
                  : order
              ));
            }
          }
          
          // Pickup Complete 확인 모달 표시 (타입 정보 포함)
          setPickupConfirmOrder({ ...onlineTogoPaymentOrder, orderType: selectedOrderType });
          setShowPickupConfirmModal(true);
          
          setOnlineTogoPaymentOrder(null);
          
          // 주문 목록 새로고침 (백그라운드)
          loadOnlineOrders();
          loadTogoOrders();
        }}
      />
      </div>

      {/* Pickup Complete 확인 모달 - 결제 완료 후 표시 */}
      {showPickupConfirmModal && pickupConfirmOrder && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70]">
          <div className="bg-white rounded-2xl shadow-2xl w-[400px] overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-green-500 to-green-600 text-white px-6 py-4 text-center">
              <div className="text-2xl font-bold">Payment Complete</div>
              <div className="text-green-100 mt-1">
                Order #{pickupConfirmOrder.number || pickupConfirmOrder.id}
              </div>
            </div>
            
            {/* Content */}
            <div className="p-6 text-center">
              <div className="text-6xl mb-4">✓</div>
              <div className="text-lg text-gray-600 mb-6">
                Would you like to mark this order as picked up?
              </div>
              
              {/* Buttons */}
              <div className="space-y-3">
                {/* Pickup Complete - 큰 버튼 */}
                <button
                  onClick={async () => {
                    const orderId = pickupConfirmOrder?.id;
                    const localOrderId = pickupConfirmOrder?.localOrderId || pickupConfirmOrder?.fullOrder?.localOrderId;
                    const orderType = pickupConfirmOrder?.orderType;
                    
                    if (orderId) {
                      try {
                        if (orderType === 'online') {
                          // 온라인 주문: Firebase 상태를 picked_up으로 변경
                          await fetch(`${API_URL}/online-orders/order/${orderId}/pickup`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                          });
                          console.log('Firebase: Order marked as picked_up');
                          
                          // POS 로컬 DB 상태도 업데이트 (localOrderId가 있는 경우)
                          if (localOrderId) {
                            await fetch(`${API_URL}/orders/${localOrderId}/status`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ status: 'PICKED_UP' }),
                            });
                            console.log('POS DB: Order marked as PICKED_UP');
                          }
                          
                          // 온라인 주문 목록에서 즉시 제거
                          setOnlineQueueCards(prev => prev.filter(card => card.id !== orderId));
                        } else if (orderType === 'togo') {
                          // Togo 주문: POS DB만 업데이트
                          await fetch(`${API_URL}/orders/${orderId}/status`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ status: 'PICKED_UP' }),
                          });
                          console.log('POS DB: Togo order marked as PICKED_UP');
                          
                          // Togo 주문 목록에서 즉시 제거
                          setTogoOrders(prev => prev.filter(order => order.id !== orderId));
                        }
                      } catch (error) {
                        console.error('Pickup complete error:', error);
                      }
                      
                      // 선택된 주문도 초기화
                      if (selectedOrderDetail?.id === orderId) {
                        setSelectedOrderDetail(null);
                      }
                    }
                    
                    // 모달 닫기
                    setShowPickupConfirmModal(false);
                    setPickupConfirmOrder(null);
                    
                    // 목록 새로고침
                    loadOnlineOrders();
                    loadTogoOrders();
                  }}
                  className="w-full py-4 bg-green-500 hover:bg-green-600 text-white text-xl font-bold rounded-xl transition-colors shadow-lg"
                >
                  Pickup Complete
                </button>
                
                {/* Back to List - 작은 버튼 */}
                <button
                  onClick={() => {
                    setShowPickupConfirmModal(false);
                    setPickupConfirmOrder(null);
                  }}
                  className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium rounded-lg transition-colors"
                >
                  Back to List
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* UNPAID 주문 Pickup 시도 시 확인 모달 */}
      {showUnpaidPickupModal && unpaidPickupOrder && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70]">
          <div className="bg-white rounded-2xl shadow-2xl w-[400px] overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-yellow-500 to-orange-500 text-white px-6 py-4 text-center">
              <div className="text-2xl font-bold">Are you sure?</div>
              <div className="text-yellow-100 mt-1">
                Order #{unpaidPickupOrder.number || unpaidPickupOrder.id}
              </div>
            </div>
            
            {/* Content */}
            <div className="p-6 text-center">
              <div className="text-5xl mb-4">⚠️</div>
              <div className="text-lg text-gray-700 font-medium mb-2">
                This order has not been paid yet.
              </div>
              <div className="text-gray-500 mb-6">
                Please complete payment before pickup.
              </div>
              
              {/* Buttons */}
              <div className="space-y-3">
                {/* Payment - 큰 버튼 */}
                <button
                  onClick={() => {
                    // UNPAID 모달 닫기
                    setShowUnpaidPickupModal(false);
                    
                    // selectedOrderType 설정 (결제 완료 후 처리를 위해)
                    if (unpaidPickupOrder?.orderType) {
                      setSelectedOrderType(unpaidPickupOrder.orderType);
                    }
                    
                    // 결제 모달 열기
                    setOnlineTogoPaymentOrder(unpaidPickupOrder);
                    setShowOnlineTogoPaymentModal(true);
                    
                    setUnpaidPickupOrder(null);
                  }}
                  className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white text-xl font-bold rounded-xl transition-colors shadow-lg"
                >
                  Payment
                </button>
                
                {/* Back to List - 작은 버튼 */}
                <button
                  onClick={() => {
                    setShowUnpaidPickupModal(false);
                    setUnpaidPickupOrder(null);
                  }}
                  className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium rounded-lg transition-colors"
                >
                  Back to List
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Order Detail Modal (Online/Togo 카드 클릭 시) - 좌우 분할 레이아웃 */}
      {showOrderDetailModal && selectedOrderDetail && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-[76%] max-w-4xl h-[80vh] flex flex-col">
            {/* Header */}
            <div className={`${selectedOrderType === 'online' ? 'bg-gradient-to-r from-blue-600 to-blue-700' : 'bg-gradient-to-r from-orange-500 to-orange-600'} text-white px-5 py-2.5 rounded-t-xl flex items-center justify-between flex-shrink-0`}>
              <h2 className="text-base font-bold flex items-center gap-2">
                {selectedOrderType === 'online' ? 'Online' : 'Togo'} Orders
                <span className="text-sm font-normal opacity-80">
                  ({selectedOrderType === 'online' ? onlineQueueCards.length : togoOrders.length})
                </span>
              </h2>
              <button
                onClick={() => {
                  setShowOrderDetailModal(false);
                  setSelectedOrderDetail(null);
                  setSelectedOrderType(null);
                }}
                className="text-white hover:bg-white/20 rounded-lg p-1.5 transition text-lg"
              >
                ✕
              </button>
            </div>
            
            {/* Content - 좌우 분할 */}
            <div className="flex-1 flex overflow-hidden bg-gray-200 gap-3 p-3">
              {/* 왼쪽: 주문 목록 테이블 (모든 온라인/Togo 주문) */}
              <div className="w-[55%] flex flex-col bg-white rounded-lg shadow-md overflow-hidden">
                <div className="flex-1 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-100 sticky top-0">
                      <tr>
                        <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600">Seq#</th>
                        <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600">Order#</th>
                        <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600">Placed</th>
                        <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600">Pickup</th>
                        <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600">Customer</th>
                        <th className="px-2 py-2 text-left text-xs font-semibold text-gray-600">Phone</th>
                        <th className="px-2 py-2 text-right text-xs font-semibold text-gray-600">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* 온라인 타입일 경우 모든 온라인 주문 표시 - 픽업시간 오름차순 */}
                      {selectedOrderType === 'online' && [...onlineQueueCards].sort((a, b) => {
                        const getTimeMs = (order: any): number => {
                          const pt = order.pickupTime;
                          if (pt) {
                            if (pt._seconds) return pt._seconds * 1000;
                            const d = new Date(pt);
                            if (!isNaN(d.getTime())) return d.getTime();
                          }
                          const placed = order.placedTime || order.time;
                          if (placed) {
                            const d = new Date(placed);
                            if (!isNaN(d.getTime())) return d.getTime();
                          }
                          return Infinity;
                        };
                        return getTimeMs(a) - getTimeMs(b);
                      }).map((order, idx) => (
                        <tr 
                          key={order.id}
                          onClick={() => setSelectedOrderDetail(order)}
                          className={`cursor-pointer hover:bg-blue-50 transition min-h-[44px] ${
                            selectedOrderDetail.id === order.id 
                              ? 'bg-blue-100 border-l-4 border-blue-500' 
                              : 'border-l-4 border-transparent'
                          }`}
                          style={{ height: '44px' }}
                        >
                          <td className="px-2 py-3 text-gray-800">{idx + 1}</td>
                          <td className="px-2 py-3 text-gray-800 font-bold">#{order.number || order.id}</td>
                          <td className="px-2 py-3 text-gray-600">
                            {order.placedTime 
                              ? new Date(order.placedTime).toLocaleTimeString('en-US', { 
                                  hour: '2-digit', minute: '2-digit', hour12: false 
                                })
                              : order.time || '-'}
                          </td>
                          <td className="px-2 py-3 text-gray-600">
                            {order.pickupTime 
                              ? new Date(order.pickupTime).toLocaleTimeString('en-US', { 
                                  hour: '2-digit', minute: '2-digit', hour12: false 
                                })
                              : '-'}
                          </td>
                          <td className="px-2 py-3 text-gray-800">{order.name || '-'}</td>
                          <td className="px-2 py-3 text-gray-800 font-bold">{order.phone || '-'}</td>
                          <td className="px-2 py-3 text-right text-gray-800">
                            ${Number(order.total || order.fullOrder?.total || 0).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                      {/* Togo 타입일 경우 모든 Togo 주문 표시 - 픽업시간 오름차순 */}
                      {selectedOrderType === 'togo' && [...togoOrders].sort((a, b) => (a.readyTimeLabel || '99:99').localeCompare(b.readyTimeLabel || '99:99')).map((order, idx) => (
                        <tr 
                          key={order.id}
                          onClick={() => setSelectedOrderDetail(order)}
                          className={`cursor-pointer hover:bg-orange-50 transition min-h-[44px] ${
                            selectedOrderDetail.id === order.id 
                              ? 'bg-orange-100 border-l-4 border-orange-500' 
                              : 'border-l-4 border-transparent'
                          }`}
                          style={{ height: '44px' }}
                        >
                          <td className="px-2 py-3 text-gray-800">{idx + 1}</td>
                          <td className="px-2 py-3 text-gray-800 font-bold">#{String(order.id).padStart(3, '0')}</td>
                          <td className="px-2 py-3 text-gray-600">
                            {order.createdAt 
                              ? new Date(order.createdAt).toLocaleTimeString('en-US', { 
                                  hour: '2-digit', minute: '2-digit', hour12: false 
                                })
                              : order.time || '-'}
                          </td>
                          <td className="px-2 py-3 text-gray-600">{order.readyTimeLabel || '-'}</td>
                          <td className="px-2 py-3 text-gray-800">{order.name || '-'}</td>
                          <td className="px-2 py-3 text-gray-800 font-bold">{order.phone || '-'}</td>
                          <td className="px-2 py-3 text-right text-gray-800">
                            ${Number(order.total || 0).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                      {/* 주문이 없을 경우 */}
                      {((selectedOrderType === 'online' && onlineQueueCards.length === 0) ||
                        (selectedOrderType === 'togo' && togoOrders.length === 0)) && (
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
              <div className="w-[45%] flex flex-col bg-white rounded-lg shadow-md overflow-hidden">
                {/* 상단 버튼 영역 */}
                <div className="p-2 flex gap-2 flex-shrink-0 bg-gray-50 border-b">
                  <button
                    onClick={async () => {
                      // 결제 상태 확인
                      const status = (selectedOrderDetail?.fullOrder?.status || selectedOrderDetail?.status || '').toLowerCase();
                      const isPaid = status === 'paid' || status === 'completed' || status === 'closed';
                      
                      if (!isPaid) {
                        // UNPAID: 확인 모달 표시
                        const orderForPayment = {
                          id: selectedOrderDetail.id,
                          type: selectedOrderType === 'online' ? 'Online' : 'Togo',
                          orderType: selectedOrderType, // online 또는 togo
                          number: selectedOrderType === 'togo' 
                            ? String(selectedOrderDetail.id).padStart(3, '0')
                            : (selectedOrderDetail.number || selectedOrderDetail.id),
                          time: selectedOrderDetail.time,
                          phone: selectedOrderDetail.phone || selectedOrderDetail.customerPhone || '',
                          name: selectedOrderDetail.name || selectedOrderDetail.customerName || '',
                          total: Number(selectedOrderDetail.fullOrder?.total || selectedOrderDetail.total || 0),
                          subtotal: Number(selectedOrderDetail.fullOrder?.subtotal || selectedOrderDetail.total || 0),
                          tax: Number(selectedOrderDetail.fullOrder?.tax || 0),
                          items: selectedOrderDetail.fullOrder?.items || selectedOrderDetail.items || [],
                          localOrderId: selectedOrderDetail.localOrderId || selectedOrderDetail.fullOrder?.localOrderId || selectedOrderDetail.number,
                          fullOrder: selectedOrderDetail.fullOrder,
                        };
                        setUnpaidPickupOrder(orderForPayment);
                        setShowUnpaidPickupModal(true);
                        return;
                      }
                      
                      // PAID: 바로 Pickup Complete 처리
                      const orderId = selectedOrderDetail?.id;
                      const localOrderId = selectedOrderDetail?.localOrderId || selectedOrderDetail?.fullOrder?.localOrderId || selectedOrderDetail?.number;
                      
                      if (orderId) {
                        try {
                          if (selectedOrderType === 'online') {
                            // 온라인 주문: Firebase 상태를 picked_up으로 변경
                            await fetch(`${API_URL}/online-orders/order/${orderId}/pickup`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                            });
                            console.log('Firebase: Order marked as picked_up');
                            
                            // POS 로컬 DB 상태도 업데이트 (localOrderId가 있는 경우)
                            if (localOrderId && typeof localOrderId === 'number') {
                              await fetch(`${API_URL}/orders/${localOrderId}/status`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ status: 'PICKED_UP' }),
                              });
                              console.log('POS DB: Order marked as PICKED_UP');
                            }
                            
                            // 온라인 주문 목록에서 즉시 제거
                            setOnlineQueueCards(prev => prev.filter(card => card.id !== orderId));
                          } else if (selectedOrderType === 'togo') {
                            // Togo 주문: POS DB만 업데이트
                            await fetch(`${API_URL}/orders/${orderId}/status`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ status: 'PICKED_UP' }),
                            });
                            console.log('POS DB: Togo order marked as PICKED_UP');
                            
                            // Togo 주문 목록에서 즉시 제거
                            setTogoOrders(prev => prev.filter(order => order.id !== orderId));
                          }
                        } catch (error) {
                          console.error('Pickup complete error:', error);
                        }
                      }
                      
                      // 모달 닫기
                      setShowOrderDetailModal(false);
                      setSelectedOrderDetail(null);
                      setSelectedOrderType(null);
                      
                      // 목록 새로고침
                      loadOnlineOrders();
                      loadTogoOrders();
                    }}
                    className="flex-1 py-3 bg-green-600 hover:bg-green-700 text-white text-base font-bold rounded-lg transition shadow-md"
                  >
                    Pickup Complete
                  </button>
                  {(() => {
                    const status = (selectedOrderDetail?.fullOrder?.status || selectedOrderDetail?.status || '').toLowerCase();
                    const isPaid = status === 'paid' || status === 'completed' || status === 'closed';
                    return (
                      <button
                        onClick={() => {
                          if (isPaid) return; // 이미 결제됨
                          // 결제 모달을 위한 주문 정보 설정
                          const orderForPayment = {
                            id: selectedOrderDetail.id,
                            type: selectedOrderType === 'online' ? 'Online' : 'Togo',
                            orderType: selectedOrderType,
                            number: selectedOrderType === 'togo' 
                              ? String(selectedOrderDetail.id).padStart(3, '0')
                              : (selectedOrderDetail.number || selectedOrderDetail.id),
                            time: selectedOrderDetail.time,
                            phone: selectedOrderDetail.phone || selectedOrderDetail.customerPhone || '',
                            name: selectedOrderDetail.name || selectedOrderDetail.customerName || '',
                            total: Number(selectedOrderDetail.fullOrder?.total || selectedOrderDetail.total || 0),
                            subtotal: Number(selectedOrderDetail.fullOrder?.subtotal || selectedOrderDetail.total || 0),
                            tax: Number(selectedOrderDetail.fullOrder?.tax || 0),
                            items: selectedOrderDetail.fullOrder?.items || selectedOrderDetail.items || [],
                            status: selectedOrderDetail.fullOrder?.status || selectedOrderDetail.status || 'pending',
                          };
                          setOnlineTogoPaymentOrder(orderForPayment);
                          setShowOnlineTogoPaymentModal(true);
                        }}
                        disabled={isPaid}
                        className={`flex-1 py-3 text-white text-base font-bold rounded-lg transition shadow-md ${
                          isPaid 
                            ? 'bg-gray-400 cursor-not-allowed' 
                            : 'bg-blue-600 hover:bg-blue-700'
                        }`}
                      >
                        {isPaid ? 'PAID' : 'Payment'}
                      </button>
                    );
                  })()}
                </div>
                
                {/* 주문 상세 정보 */}
                <div className="flex-1 overflow-auto p-2 space-y-2">
                  {/* 주문번호 & 픽업타임 & 고객정보 */}
                  <div className="bg-white rounded-lg p-3 shadow-sm">
                    <div className="flex justify-between items-center mb-1">
                      <div className="text-2xl font-bold text-gray-800">
                        #{selectedOrderType === 'togo' 
                          ? String(selectedOrderDetail.id).padStart(3, '0') 
                          : (selectedOrderDetail.number || selectedOrderDetail.id)}
                      </div>
                      <div className="text-3xl font-bold text-red-600">
                        {selectedOrderDetail.pickupTime 
                          ? new Date(selectedOrderDetail.pickupTime).toLocaleTimeString('en-US', { 
                              hour: '2-digit', minute: '2-digit', hour12: false 
                            })
                          : selectedOrderDetail.readyTimeLabel && selectedOrderDetail.readyTimeLabel !== 'ASAP'
                            ? selectedOrderDetail.readyTimeLabel
                            : selectedOrderDetail.fullOrder?.pickupTime
                              ? new Date(selectedOrderDetail.fullOrder.pickupTime).toLocaleTimeString('en-US', { 
                                  hour: '2-digit', minute: '2-digit', hour12: false 
                                })
                              : '--:--'}
                      </div>
                    </div>
                    <div className="flex justify-between text-sm text-gray-700">
                      <span className="font-medium">{selectedOrderDetail.name || selectedOrderDetail.customerName || '-'}</span>
                      <span className="font-bold">{selectedOrderDetail.phone || selectedOrderDetail.customerPhone || '-'}</span>
                    </div>
                  </div>
                  
                  {/* 아이템 목록 + 금액 요약 (하나의 컨테이너) */}
                  <div className="bg-white rounded-lg shadow-sm overflow-hidden flex-1 flex flex-col">
                    {/* 아이템 헤더 */}
                    <div className="bg-gray-100 px-3 py-1.5 border-b">
                      <div className="grid grid-cols-12 text-xs font-semibold text-gray-600">
                        <div className="col-span-2">Qty</div>
                        <div className="col-span-7">Item Name</div>
                        <div className="col-span-3 text-right">Price</div>
                      </div>
                    </div>
                    
                    {/* 아이템 목록 */}
                    <div className="divide-y flex-1 overflow-auto" style={{ maxHeight: '120px' }}>
                      {(selectedOrderDetail.fullOrder?.items || []).length > 0 ? (
                        (selectedOrderDetail.fullOrder?.items || []).map((item: any, idx: number) => (
                          <div key={idx} className="px-3 py-1 grid grid-cols-12 text-sm">
                            <div className="col-span-2 font-medium">{item.quantity || 1}</div>
                            <div className="col-span-7 text-gray-800 truncate">{item.name}</div>
                            <div className="col-span-3 text-right text-gray-600">
                              ${Number(item.price || item.subtotal || 0).toFixed(2)}
                            </div>
                          </div>
                        ))
                      ) : selectedOrderDetail.items && selectedOrderDetail.items.length > 0 ? (
                        selectedOrderDetail.items.map((itemName: string, idx: number) => (
                          <div key={idx} className="px-3 py-1 grid grid-cols-12 text-sm">
                            <div className="col-span-2 font-medium">1</div>
                            <div className="col-span-7 text-gray-800 truncate">{itemName}</div>
                            <div className="col-span-3 text-right text-gray-600">-</div>
                          </div>
                        ))
                      ) : (
                        <div className="px-3 py-3 text-center text-gray-400 text-sm">No items</div>
                      )}
                    </div>
                    
                    {/* 금액 요약 */}
                    <div className="border-t bg-gray-50 px-3 py-2 space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Sub Total</span>
                        <span>${Number(selectedOrderDetail.fullOrder?.subtotal || selectedOrderDetail.total || 0).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Tax</span>
                        <span>${Number(selectedOrderDetail.fullOrder?.tax || 0).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-base font-bold border-t pt-1">
                        <span>Total</span>
                        <span className="text-blue-600">${Number(selectedOrderDetail.fullOrder?.total || selectedOrderDetail.total || 0).toFixed(2)}</span>
                      </div>
                    </div>
                    
                    {/* Paid/Unpaid 상태 */}
                    <div className="border-t px-3 py-2">
                      {(selectedOrderDetail.fullOrder?.status === 'paid' || 
                        selectedOrderDetail.fullOrder?.status === 'completed' || 
                        selectedOrderDetail.fullOrder?.status === 'closed' ||
                        selectedOrderDetail.status === 'PAID' || 
                        selectedOrderDetail.status === 'paid' ||
                        selectedOrderDetail.status === 'completed' ||
                        selectedOrderDetail.status === 'closed') ? (
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
                
                {/* 하단 닫기 버튼 */}
                <div className="p-2 border-t bg-white flex-shrink-0">
                  <button
                    onClick={() => {
                      setShowOrderDetailModal(false);
                      setSelectedOrderDetail(null);
                      setSelectedOrderType(null);
                    }}
                    className="w-full py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition font-medium text-sm"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <ReservationCreateModal
        open={showReservationModal}
        onClose={() => setShowReservationModal(false)}
        onCreated={() => {
          setShowReservationModal(false);
        }}
        onTableStatusChanged={(tableId, tableName, status, customerName) => {
          // 테이블 상태가 변경되었을 때 테이블 목록을 새로고침
          fetchTableMapData();
          
          // Hold 또는 Reserved 상태인 경우 예약자 이름 저장
          if ((status === 'Hold' || status === 'Reserved') && customerName) {
            setTableReservationNames(prev => {
              const next = { ...prev, [String(tableId)]: customerName };
              try { localStorage.setItem(`reservedNames_${selectedFloor}`, JSON.stringify(next)); } catch {}
              return next;
            });
            console.log(`Setting reservation name for table ${tableId}:`, customerName);
          }
          
          // Occupied 상태인 경우 시간 기록 (기존 점유 시간이 없을 때만)
          if (status === 'Occupied') {
            const existingTime = tableOccupiedTimes[String(tableId)];
            if (!existingTime) {
              setOccupiedTimestamp(tableId, Date.now());
              console.log(`Setting occupied time for table ${tableId}:`, new Date().toLocaleTimeString());
            } else {
              console.log(`Keeping existing occupied time for table ${tableId}`);
            }
          }
        }}
      />
      {softKbOpen && (
        <VirtualKeyboard
          open={softKbOpen}
          title={''}
          bottomOffsetPx={0}
          zIndex={2147483646}
          languages={['EN']}
          currentLanguage={kbLang}
          onToggleLanguage={(next)=>setKbLang(next)}
          displayText={togoSearch}
          onRequestClose={() => setSoftKbOpen(false)}
          onType={(k)=> setTogoSearch(prev=>`${prev||''}${k}`)}
          onBackspace={()=> setTogoSearch(prev=> prev ? prev.slice(0,-1) : '')}
          onClear={()=> setTogoSearch('')}
        />
      )}
      
      {/* Clock In/Out Menu Modal */}
      {showClockInOutMenu && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-96">
            <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">
              ⏰ Clock In/Out
            </h2>
            
            <div className="space-y-3">
              <button
                onClick={() => {
                  console.log('Clock In 메뉴에서 선택됨');
                  setShowClockInOutMenu(false);
                  setShowClockInModal(true);
                }}
                className="w-full px-6 py-4 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-lg shadow-md transition-colors text-lg"
              >
                ⏰ Clock In (출근)
              </button>
              
              <button
                onClick={() => {
                  console.log('Clock Out 메뉴에서 선택됨');
                  setShowClockInOutMenu(false);
                  setShowClockOutModal(true);
                }}
                className="w-full px-6 py-4 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-lg shadow-md transition-colors text-lg"
              >
                🚪 Clock Out (퇴근)
              </button>
            </div>

            <button
              onClick={() => setShowClockInOutMenu(false)}
              className="mt-4 w-full px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg font-semibold text-gray-700 transition-colors"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* Clock In PIN Modal */}
      <PinInputModal
        isOpen={showClockInModal}
        onClose={() => {
          setShowClockInModal(false);
          setClockError('');
        }}
        onSubmit={async (pin: string) => {
          setIsClockLoading(true);
          setClockError('');

          try {
            const { employee } = await clockInOutApi.verifyPin(pin);
            const response = await clockInOutApi.clockIn(employee.id, employee.name, pin);
            
            alert(`${employee.name}님, 출근 처리되었습니다!\n시간: ${new Date(response.clockInTime).toLocaleTimeString('ko-KR')}`);
            
            setShowClockInModal(false);
          } catch (error: any) {
            setClockError(error.message || '출근 처리 실패');
          } finally {
            setIsClockLoading(false);
          }
        }}
        title="출근 (Clock In)"
        message="PIN 번호를 입력하세요"
        isLoading={isClockLoading}
        error={clockError}
      />

      {/* Clock Out PIN Modal */}
      <PinInputModal
        isOpen={showClockOutModal}
        onClose={() => {
          setShowClockOutModal(false);
          setClockError('');
        }}
        onSubmit={async (pin: string) => {
          setIsClockLoading(true);
          setClockError('');

          try {
            const { employee } = await clockInOutApi.verifyPin(pin);

            const now = new Date();
            const currentHour = now.getHours();
            
            if (currentHour < 18) {
              setSelectedEmployee(employee);
              setShowClockOutModal(false);
              setShowEarlyOutModal(true);
              setIsClockLoading(false);
              return;
            }

            const response = await clockInOutApi.clockOut(employee.id, pin);
            
            alert(`${employee.name}님, 퇴근 처리되었습니다!\n근무 시간: ${response.totalHours}시간`);
            
            setShowClockOutModal(false);
          } catch (error: any) {
            setClockError(error.message || '퇴근 처리 실패');
          } finally {
            setIsClockLoading(false);
          }
        }}
        title="퇴근 (Clock Out)"
        message="PIN 번호를 입력하세요"
        isLoading={isClockLoading}
        error={clockError}
      />

      {/* Early Out Modal */}
      {showEarlyOutModal && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-96">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">
              ⚠️ 조기 퇴근 (Early Out)
            </h2>
            
            <p className="text-gray-600 mb-4">
              {selectedEmployee?.name}님의 조기 퇴근 사유를 입력하세요.
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                조기 퇴근 사유 *
              </label>
              <textarea
                value={earlyOutReason}
                onChange={(e) => setEarlyOutReason(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
                placeholder="예: 개인 사정, 병원 방문 등"
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                승인자 (선택)
              </label>
              <input
                type="text"
                value={approvedBy}
                onChange={(e) => setApprovedBy(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="승인자 이름"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowEarlyOutModal(false);
                  setSelectedEmployee(null);
                  setEarlyOutReason('');
                  setApprovedBy('');
                }}
                className="flex-1 px-4 py-3 bg-gray-200 hover:bg-gray-300 rounded-lg font-semibold text-gray-700 transition-colors"
              >
                취소
              </button>
              <button
                onClick={async () => {
                  if (!selectedEmployee || !earlyOutReason.trim()) {
                    alert('조기 퇴근 사유를 입력해주세요.');
                    return;
                  }

                  setIsClockLoading(true);

                  try {
                    const pin = prompt(`${selectedEmployee.name}님, PIN을 다시 입력해주세요:`);
                    if (!pin) {
                      setIsClockLoading(false);
                      return;
                    }

                    const response = await clockInOutApi.clockOut(
                      selectedEmployee.id,
                      pin,
                      true,
                      earlyOutReason,
                      approvedBy
                    );

                    alert(`${selectedEmployee.name}님, 조기 퇴근 처리되었습니다.\n근무 시간: ${response.totalHours}시간`);

                    setShowEarlyOutModal(false);
                    setSelectedEmployee(null);
                    setEarlyOutReason('');
                    setApprovedBy('');
                  } catch (error: any) {
                    alert(`조기 퇴근 처리 실패: ${error.message}`);
                  } finally {
                    setIsClockLoading(false);
                  }
                }}
                disabled={!earlyOutReason.trim() || isClockLoading}
                className="flex-1 px-4 py-3 bg-red-500 hover:bg-red-600 rounded-lg font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isClockLoading ? '처리 중...' : '조기 퇴근 처리'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Gift Card Modal */}
      {showGiftCardModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-[600px] max-h-[90vh] overflow-hidden" style={{ transform: 'translateY(-70px)' }}>
            {/* Header */}
            <div className="bg-gradient-to-r from-amber-500 to-amber-600 px-4 py-3 flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">Gift Card</h3>
              <button 
                onClick={() => setShowGiftCardModal(false)} 
                className="text-white hover:text-gray-200 text-2xl font-bold leading-none"
              >
                &times;
              </button>
            </div>

            <div className="p-3 space-y-2">
              {/* Section 1: Card Number + Sell/Balance - Blue Background */}
              <div className="bg-blue-50 rounded-lg p-3">
                <div className="flex gap-3">
                  {/* Card Number */}
                  <div 
                    className={`flex-1 p-3 rounded-lg cursor-pointer ${
                      giftCardInputFocus === 'card' 
                        ? 'bg-white border-2 border-blue-400 shadow-md' 
                        : 'bg-blue-100 border-2 border-blue-200'
                    }`}
                    onClick={() => setGiftCardInputFocus('card')}
                  >
                    <div className="text-xs font-semibold text-blue-600 mb-1">Card Number</div>
                    <div className="text-3xl font-mono tracking-wide text-gray-800 flex items-center">
                      {[0, 1, 2, 3].map((groupIdx) => (
                        <span key={groupIdx} className="flex items-center">
                          {[0, 1, 2, 3].map((digitIdx) => {
                            const char = giftCardNumber[groupIdx]?.[digitIdx] || '';
                            return (
                              <span 
                                key={digitIdx} 
                                className={`w-5 inline-flex justify-center ${char ? 'text-gray-800' : 'text-gray-300'}`}
                              >
                                {char || '_'}
                              </span>
                            );
                          })}
                          {groupIdx < 3 && <span className="text-gray-400 mx-1">-</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                  {/* Sell / Balance Buttons */}
                  <div className="flex flex-col gap-2 w-28">
                    <button
                      onClick={() => { setGiftCardMode('sell'); setGiftCardBalance(null); setGiftCardError(''); }}
                      className={`flex-1 py-3 rounded-lg font-bold text-base ${
                        giftCardMode === 'sell'
                          ? 'bg-amber-500 text-white shadow-md'
                          : 'bg-white text-gray-700 hover:bg-gray-100 border border-blue-200'
                      }`}
                    >
                      Sell
                    </button>
                    <button
                      onClick={() => { 
                        setGiftCardMode('balance'); 
                        setGiftCardError(''); 
                        // 카드번호가 16자리면 바로 잔액 조회
                        const cardNum = giftCardNumber.join('');
                        if (cardNum.length === 16) {
                          (async () => {
                            try {
                              const response = await fetch(`${API_URL}/gift-cards/${encodeURIComponent(cardNum)}/balance`);
                              if (response.ok) {
                                const data = await response.json();
                                setGiftCardBalance(data.balance);
                              } else {
                                setGiftCardError('Gift card not found');
                              }
                            } catch {
                              setGiftCardError('Failed to connect to server');
                            }
                          })();
                        }
                      }}
                      className={`flex-1 py-3 rounded-lg font-bold text-base ${
                        giftCardMode === 'balance'
                          ? 'bg-green-500 text-white shadow-md'
                          : 'bg-white text-gray-700 hover:bg-gray-100 border border-blue-200'
                      }`}
                    >
                      Balance
                    </button>
                  </div>
                </div>
              </div>

              {/* Section 2 & 3: Amount + Bill Buttons + Payment Method (Sell mode only) */}
              {giftCardMode === 'sell' && (
                <div className="flex gap-2 items-stretch h-[112px]">
                  {/* Section 2: Amount + Quick Buttons - Gray Background */}
                  <div className="bg-gray-200 rounded-lg p-2 flex gap-2">
                    {/* Amount Display */}
                    <div 
                      className={`w-32 p-2 rounded-lg cursor-pointer flex flex-col justify-center ${
                        giftCardInputFocus === 'amount' 
                          ? 'bg-white border-2 border-amber-400 shadow-md' 
                          : 'bg-gray-100 border-2 border-gray-300'
                      }`}
                      onClick={() => setGiftCardInputFocus('amount')}
                    >
                      <div className="text-xs font-semibold text-gray-600 mb-1">Amount</div>
                      <div className="text-3xl font-bold text-amber-700 text-center py-2">
                        ${giftCardAmount || '0'}
                      </div>
                    </div>
                    {/* Quick Amount Buttons 2x2 */}
                    <div className="grid grid-cols-2 gap-2">
                      {[25, 50, 100, 200].map((amt) => (
                        <button
                          key={amt}
                          onClick={() => { setGiftCardAmount(String(amt)); setGiftCardInputFocus('amount'); }}
                          className={`w-24 h-12 rounded-lg text-base font-bold transition-all ${
                            giftCardAmount === String(amt)
                              ? 'bg-amber-500 text-white shadow-md'
                              : 'bg-white text-gray-700 hover:bg-amber-100 border border-gray-300'
                          }`}
                        >
                          ${amt}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Section 3: Payment Method 2x2 - Gray Background */}
                  <div className="bg-gray-200 rounded-lg p-2">
                    <div className="grid grid-cols-2 gap-2">
                      {(['Cash', 'Visa', 'Master', 'Other'] as const).map((method) => (
                        <button
                          key={method}
                          onClick={() => setGiftCardPaymentMethod(method === 'Master' ? 'MasterCard' : method as any)}
                          className={`w-24 h-12 rounded-lg text-base font-bold transition-all ${
                            (method === 'Master' ? giftCardPaymentMethod === 'MasterCard' : giftCardPaymentMethod === method)
                              ? 'bg-blue-500 text-white shadow-md'
                              : 'bg-white text-gray-700 hover:bg-blue-100 border border-gray-300'
                          }`}
                        >
                          {method}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Balance Display (Balance mode only) */}
              {giftCardMode === 'balance' && (
                <div className="bg-green-50 border-2 border-green-200 rounded-lg p-2 h-[112px] flex flex-col justify-center text-center">
                  <div className="text-xs text-green-600 mb-1">Available Balance</div>
                  {giftCardBalance !== null ? (
                    <div className="text-4xl font-bold text-green-600">${giftCardBalance.toFixed(2)}</div>
                  ) : (
                    <div className="text-base font-medium text-gray-400">Enter card number and check</div>
                  )}
                </div>
              )}

              {/* Section 4: Numpad - Gray Background */}
              <div className="bg-gray-200 rounded-lg p-3">
                <div className="grid grid-cols-4 gap-2">
                  {['1', '2', '3', 'C', '4', '5', '6', '⌫', '7', '8', '9', '', '0', '00', '.', ''].map((key, idx) => (
                    <button
                      key={`numpad-${key}-${idx}`}
                      onClick={() => {
                        if (giftCardInputFocus === 'card') {
                          // Card number input
                          const fullNumber = giftCardNumber.join('');
                          if (key === 'C') {
                            setGiftCardNumber(['', '', '', '']);
                          } else if (key === '⌫') {
                            const newNumber = fullNumber.slice(0, -1);
                            const segments = [
                              newNumber.slice(0, 4),
                              newNumber.slice(4, 8),
                              newNumber.slice(8, 12),
                              newNumber.slice(12, 16)
                            ];
                            setGiftCardNumber(segments);
                          } else if (key !== '.' && key !== '00') {
                            if (fullNumber.length < 16) {
                              const newNumber = fullNumber + key;
                              const segments = [
                                newNumber.slice(0, 4),
                                newNumber.slice(4, 8),
                                newNumber.slice(8, 12),
                                newNumber.slice(12, 16)
                              ];
                              setGiftCardNumber(segments);
                            }
                          }
                        } else if (giftCardInputFocus === 'amount') {
                          // Amount input
                          if (key === 'C') {
                            setGiftCardAmount('');
                          } else if (key === '⌫') {
                            setGiftCardAmount(prev => prev.slice(0, -1));
                          } else if (key === '.') {
                            if (!giftCardAmount.includes('.')) {
                              setGiftCardAmount(prev => prev ? prev + '.' : '0.');
                            }
                          } else {
                            setGiftCardAmount(prev => prev + key);
                          }
                        } else if (giftCardInputFocus === 'pin') {
                          // PIN input
                          if (key === 'C') {
                            setGiftCardSellerPin('');
                          } else if (key === '⌫') {
                            setGiftCardSellerPin(prev => prev.slice(0, -1));
                          } else if (key !== '.' && key !== '00') {
                            if (giftCardSellerPin.length < 6) {
                              setGiftCardSellerPin(prev => prev + key);
                            }
                          }
                        }
                      }}
                      className={`h-12 rounded-lg font-bold text-lg transition-all ${
                        key === ''
                          ? 'bg-transparent cursor-default'
                          : key === 'C'
                          ? 'bg-red-100 hover:bg-red-200 text-red-700'
                          : key === '⌫'
                          ? 'bg-gray-300 hover:bg-gray-400 text-gray-700'
                          : 'bg-white hover:bg-gray-200 text-gray-800 border border-gray-300'
                      }`}
                      disabled={key === ''}
                    >
                      {key}
                    </button>
                  ))}
                </div>
              </div>

              {/* Reload Mode Indicator */}
              {giftCardIsReload && giftCardMode === 'sell' && (
                <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-2 text-center">
                  <div className="text-blue-600 text-sm font-bold">
                    🔄 충전 모드 - 기존 잔액: ${giftCardExistingBalance?.toFixed(2)}
                  </div>
                </div>
              )}

              {/* Error Message */}
              {giftCardError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-center">
                  <div className="text-red-600 text-sm font-medium">{giftCardError}</div>
                </div>
              )}

              {/* Section 5: Bottom Row - Green Background */}
              <div className="bg-teal-50 rounded-lg p-3">
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <label className="block text-xs font-semibold text-teal-600 mb-1">Name</label>
                    <input
                      type="text"
                      value={giftCardCustomerName}
                      readOnly
                      onClick={() => setShowGiftCardNameKeyboard(true)}
                      className="w-full px-2 py-2 text-sm border-2 border-teal-200 rounded-lg focus:border-teal-400 focus:outline-none bg-white cursor-pointer"
                      placeholder="Touch to enter"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-semibold text-teal-600 mb-1">Phone</label>
                    <input
                      type="tel"
                      value={giftCardCustomerPhone}
                      onChange={(e) => setGiftCardCustomerPhone(e.target.value)}
                      className="w-full px-2 py-2 text-sm border-2 border-teal-200 rounded-lg focus:border-teal-400 focus:outline-none bg-white"
                      placeholder="Optional"
                    />
                  </div>
                  {giftCardMode === 'sell' && (
                    <div 
                      className="w-24 cursor-pointer"
                      onClick={() => setGiftCardInputFocus('pin')}
                    >
                      <label className="block text-xs font-semibold text-red-600 mb-1">Seller PIN *</label>
                      <div 
                        className={`w-full px-2 py-2 text-sm rounded-lg bg-white text-center font-mono tracking-widest ${
                          giftCardInputFocus === 'pin'
                            ? 'border-2 border-red-500 shadow-md'
                            : 'border-2 border-red-200'
                        }`}
                      >
                        {giftCardSellerPin ? '●'.repeat(giftCardSellerPin.length) : <span className="text-gray-400">PIN</span>}
                      </div>
                    </div>
                  )}
                  <button
                    onClick={() => {
                      setShowGiftCardModal(false);
                      setGiftCardIsReload(false);
                      setGiftCardExistingBalance(null);
                      setGiftCardSellerPin('');
                    }}
                    className="px-6 py-2 rounded-lg bg-gray-300 hover:bg-gray-400 text-gray-700 font-bold text-base transition-all"
                  >
                    Cancel
                  </button>
                  {giftCardMode === 'sell' ? (
                    <button
                      onClick={handleSellGiftCard}
                      className={`px-8 py-2 rounded-lg font-bold text-base transition-all ${
                        giftCardIsReload 
                          ? 'bg-blue-500 hover:bg-blue-600 text-white' 
                          : 'bg-amber-500 hover:bg-amber-600 text-white'
                      }`}
                    >
                      {giftCardIsReload ? 'Reload' : 'Ok'}
                    </button>
                  ) : (
                    <button
                      onClick={handleCheckGiftCardBalance}
                      className="px-8 py-2 rounded-lg bg-green-500 hover:bg-green-600 text-white font-bold text-base transition-all"
                    >
                      Ok
                    </button>
                  )}
                </div>
              </div>

            </div>

          </div>
        </div>
      )}

      {/* Gift Card Sold Popup */}
      {showGiftCardSoldPopup && (
        <div className="fixed inset-0 flex items-center justify-center z-[60] pointer-events-none" style={{ transform: 'translateY(-100px)' }}>
          <div className="bg-green-500 text-white px-16 py-8 rounded-2xl shadow-2xl animate-pulse">
            <div className="text-4xl font-bold text-center">Gift Card Sold</div>
          </div>
        </div>
      )}

      {/* Gift Card Reload Popup */}
      {showGiftCardReloadPopup && (
        <div className="fixed inset-0 flex items-center justify-center z-[60] pointer-events-none" style={{ transform: 'translateY(-100px)' }}>
          <div className="bg-blue-500 text-white px-16 py-8 rounded-2xl shadow-2xl animate-pulse">
            <div className="text-4xl font-bold text-center">Gift Card Reloaded</div>
          </div>
        </div>
      )}

      {/* Virtual Keyboard for Gift Card Name */}
      <VirtualKeyboard
        open={showGiftCardNameKeyboard}
        onType={(char) => {
          const shouldCapitalize = giftCardCustomerName.length === 0 || giftCardCustomerName.endsWith(' ');
          const newChar = shouldCapitalize && /[a-z]/i.test(char) ? char.toUpperCase() : char;
          setGiftCardCustomerName(prev => prev + newChar);
        }}
        onBackspace={() => setGiftCardCustomerName(prev => prev.slice(0, -1))}
        onClear={() => setGiftCardCustomerName('')}
        onEnter={() => setShowGiftCardNameKeyboard(false)}
        onRequestClose={() => setShowGiftCardNameKeyboard(false)}
        displayText={giftCardCustomerName}
        showNumpad={true}
        zIndex={99999}
        bottomOffsetPx={0}
      />

      {/* Refund Modal */}
      {showRefundModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-[800px] min-h-[660px] max-h-[85vh] overflow-hidden flex flex-col" style={{ transform: 'translateY(-80px)' }}>
            {/* Header */}
            <div className="bg-red-600 text-white px-6 py-4 flex justify-between items-center">
              <h2 className="text-xl font-bold">
                {refundStep === 'list' && 'Refund - Select Order'}
                {refundStep === 'detail' && 'Refund - Select Items'}
                {refundStep === 'card_input' && 'Refund - Card Information'}
                {refundStep === 'giftcard_input' && 'Refund - Gift Card Reload'}
                {refundStep === 'confirm' && 'Refund Complete'}
              </h2>
              <button onClick={closeRefundModal} className="text-white hover:text-gray-200 text-5xl font-bold w-14 h-14 flex items-center justify-center rounded-lg hover:bg-red-700 transition-colors">×</button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-4 min-h-[450px]">
              {/* Step 1: Order List */}
              {refundStep === 'list' && (
                <div className="min-h-[400px]">
                  {/* Search */}
                  <div className="flex gap-3 mb-4">
                    <div className="relative">
                      <button
                        onClick={() => setShowRefundCalendar(!showRefundCalendar)}
                        className="px-5 py-4 border-2 border-blue-400 rounded-xl text-lg font-bold min-w-[200px] cursor-pointer hover:border-blue-600 hover:bg-blue-50 bg-white flex items-center justify-between gap-2"
                        style={{ minHeight: '60px' }}
                      >
                        <span className="text-2xl">📅</span>
                        <span>{refundSearchDate ? new Date(refundSearchDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Select Date'}</span>
                      </button>
                      
                      {/* Custom Calendar Popup */}
                      {showRefundCalendar && (
                        <div className="absolute top-full left-0 mt-2 bg-white border-2 border-gray-300 rounded-xl shadow-2xl z-[100] p-4" style={{ width: '350px' }}>
                          {/* Calendar Header */}
                          <div className="flex justify-between items-center mb-4">
                            <button
                              onClick={() => setRefundCalendarMonth(new Date(refundCalendarMonth.getFullYear(), refundCalendarMonth.getMonth() - 1, 1))}
                              className="w-12 h-12 bg-gray-200 hover:bg-gray-300 rounded-lg text-2xl font-bold"
                            >
                              ◀
                            </button>
                            <div className="text-xl font-bold">
                              {refundCalendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                            </div>
                            <button
                              onClick={() => setRefundCalendarMonth(new Date(refundCalendarMonth.getFullYear(), refundCalendarMonth.getMonth() + 1, 1))}
                              className="w-12 h-12 bg-gray-200 hover:bg-gray-300 rounded-lg text-2xl font-bold"
                            >
                              ▶
                            </button>
                          </div>
                          
                          {/* Weekday Headers */}
                          <div className="grid grid-cols-7 gap-1 mb-2">
                            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                              <div key={day} className="text-center text-sm font-bold text-gray-600 py-1">
                                {day}
                              </div>
                            ))}
                          </div>
                          
                          {/* Calendar Days */}
                          <div className="grid grid-cols-7 gap-1">
                            {(() => {
                              const year = refundCalendarMonth.getFullYear();
                              const month = refundCalendarMonth.getMonth();
                              const firstDay = new Date(year, month, 1).getDay();
                              const daysInMonth = new Date(year, month + 1, 0).getDate();
                              const days = [];
                              
                              // Empty cells for days before the first of the month
                              for (let i = 0; i < firstDay; i++) {
                                days.push(<div key={`empty-${i}`} className="h-11"></div>);
                              }
                              
                              // Days of the month
                              for (let day = 1; day <= daysInMonth; day++) {
                                const dateStr = `${year}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
                                const isSelected = dateStr === refundSearchDate;
                                const isToday = dateStr === new Date().toISOString().split('T')[0];
                                
                                days.push(
                                  <button
                                    key={day}
                                    onClick={() => {
                                      setRefundSearchDate(dateStr);
                                      setShowRefundCalendar(false);
                                      fetchPaidOrders(dateStr, false);
                                    }}
                                    className={`h-11 w-full rounded-lg text-lg font-semibold transition-all
                                      ${isSelected ? 'bg-blue-600 text-white' : isToday ? 'bg-yellow-200 text-gray-800' : 'bg-gray-100 hover:bg-blue-200 text-gray-800'}
                                    `}
                                  >
                                    {day}
                                  </button>
                                );
                              }
                              
                              return days;
                            })()}
                          </div>
                          
                        </div>
                      )}
                    </div>
                    <input
                      type="text"
                      placeholder="Order # or Table"
                      value={refundSearchText}
                      onChange={(e) => setRefundSearchText(e.target.value)}
                      className="flex-1 px-4 py-4 border-2 rounded-xl text-lg"
                      style={{ minHeight: '60px' }}
                    />
                    <button
                      onClick={() => {
                        setShowRefundCalendar(false);
                        fetchPaidOrders();
                      }}
                      className="px-8 py-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-bold text-lg shadow-md"
                      style={{ minHeight: '60px' }}
                    >
                      Search
                    </button>
                  </div>

                  {/* Order List */}
                  {refundLoading ? (
                    <div className="text-center py-8 text-gray-500">Loading...</div>
                  ) : refundPaidOrders.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">No paid orders found</div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 max-h-[500px] overflow-y-auto pr-1">
                      {refundPaidOrders.map((order, idx) => {
                        const orderDate = new Date(order.created_at);
                        const dateStr = `${(orderDate.getMonth() + 1).toString().padStart(2, '0')}/${orderDate.getDate().toString().padStart(2, '0')}`;
                        const timeStr = `${orderDate.getHours().toString().padStart(2, '0')}:${orderDate.getMinutes().toString().padStart(2, '0')}`;
                        const customerPhone = order.customer_phone || '';
                        const customerName = order.customer_name || '';
                        const orderType = order.order_type?.toUpperCase() || '';
                        
                        // 주문 채널별 표시
                        let channelDisplay = '';
                        let showCustomerInfo = false;
                        if (orderType === 'ONLINE' || order.table_id?.startsWith('OL')) {
                          channelDisplay = 'ONLINE';
                          showCustomerInfo = true;
                        } else if (orderType === 'TOGO' || order.table_id?.startsWith('TG')) {
                          channelDisplay = 'TOGO';
                          showCustomerInfo = true;
                        } else if (orderType === 'TABLEORDER') {
                          channelDisplay = `T-ORD ${order.table_id || ''}`;
                        } else if (orderType === 'QRORDER') {
                          channelDisplay = `QR ${order.table_id || ''}`;
                        } else {
                          // Dine-in (POS)
                          channelDisplay = order.table_id ? `T-${order.table_id}` : 'TOGO';
                          if (!order.table_id) showCustomerInfo = true;
                        }
                        
                        const bgColors = ['bg-blue-50', 'bg-green-50', 'bg-yellow-50', 'bg-purple-50'];
                        const bgColor = bgColors[idx % 4];
                        
                        // Check if fully refunded
                        const paidAmount = parseFloat(order.paid_amount) || 0;
                        const refundedAmount = parseFloat(order.refunded_amount) || 0;
                        const isFullyRefunded = refundedAmount >= paidAmount && paidAmount > 0;
                        
                        return (
                          <div
                            key={order.id}
                            onClick={() => !isFullyRefunded && selectOrderForRefund(order)}
                            className={`p-3 border-2 rounded-lg transition-all ${
                              isFullyRefunded 
                                ? 'bg-gray-300 border-gray-400 cursor-not-allowed opacity-70' 
                                : `cursor-pointer hover:bg-orange-100 hover:border-orange-400 ${bgColor}`
                            }`}
                            style={{ minHeight: '70px' }}
                          >
                            {/* Fully Refunded Badge */}
                            {isFullyRefunded && (
                              <div className="bg-red-600 text-white text-xs font-bold px-2 py-1 rounded mb-1 inline-block">
                                REFUNDED
                              </div>
                            )}
                            {/* Line 1: 날짜 주문채널 (전번 이름 - ONLINE/TOGO만) */}
                            <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 mb-1">
                              <span>{dateStr} {timeStr}</span>
                              <span className="font-bold text-blue-700">{channelDisplay}</span>
                              {showCustomerInfo && customerPhone && <span className="text-gray-600">{customerPhone}</span>}
                              {showCustomerInfo && customerName && <span className="text-gray-700">{customerName}</span>}
                            </div>
                            {/* Line 2: 결제도구 금액 */}
                            <div className="flex justify-between items-center">
                              <span className="text-sm text-gray-600">
                                {order.payment_methods || 'N/A'}
                              </span>
                              <span className={`font-bold text-lg ${isFullyRefunded ? 'text-gray-500 line-through' : 'text-green-600'}`}>
                                ${paidAmount.toFixed(2)}
                              </span>
                            </div>
                            {refundedAmount > 0 && !isFullyRefunded && (
                              <div className="text-xs text-red-500 mt-1">
                                Partial Refund: ${refundedAmount.toFixed(2)}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Step 2: Item Selection */}
              {refundStep === 'detail' && refundSelectedOrder && (
                <div className="flex gap-4">
                  {/* Left Column: Order Info, Items, Summary */}
                  <div className="w-1/2">
                    {/* Order Info */}
                    <div className="bg-gray-100 p-2 rounded-lg mb-2">
                      {(() => {
                        const orderDate = new Date(refundSelectedOrder.created_at);
                        const dateStr = `${(orderDate.getMonth() + 1).toString().padStart(2, '0')}/${orderDate.getDate().toString().padStart(2, '0')}`;
                        const timeStr = `${orderDate.getHours().toString().padStart(2, '0')}:${orderDate.getMinutes().toString().padStart(2, '0')}`;
                        const orderType = refundSelectedOrder.order_type?.toUpperCase() || '';
                        const tableId = refundSelectedOrder.table_id || '';
                        
                        let channelDisplay = '';
                        if (orderType === 'ONLINE' || tableId.startsWith('OL')) {
                          channelDisplay = 'ONLINE';
                        } else if (orderType === 'TOGO' || tableId.startsWith('TG')) {
                          channelDisplay = 'TOGO';
                        } else if (orderType === 'TABLEORDER') {
                          channelDisplay = `T-ORD ${tableId}`;
                        } else if (orderType === 'QRORDER') {
                          channelDisplay = `QR ${tableId}`;
                        } else {
                          channelDisplay = tableId ? `T-${tableId}` : 'TOGO';
                        }
                        
                        const customerPhone = refundSelectedOrder.customer_phone || '';
                        const customerName = refundSelectedOrder.customer_name || '';
                        const paymentMethods = refundPayments.map((p: any) => p.method).join(', ') || 'N/A';
                        
                        return (
                          <>
                            {/* Line 1: Date Time Channel Phone Name */}
                            <div className="text-sm font-semibold text-gray-800">
                              <span>{dateStr} {timeStr}</span>
                              <span className="ml-2 font-bold text-blue-700">{channelDisplay}</span>
                              {customerPhone && <span className="ml-2 text-gray-600">({customerPhone})</span>}
                              {customerName && <span className="ml-1 text-gray-700">{customerName}</span>}
                            </div>
                            {/* Line 2: Order Number */}
                            <div className="text-sm font-bold text-gray-900 mt-1">
                              Order #{refundSelectedOrder.order_number}
                            </div>
                            {/* Line 3: Amount & Payment Method */}
                            <div className="text-sm mt-1">
                              <span>
                                Paid: <span className="font-bold text-green-600">${(refundSelectedOrder.totalPaid || 0).toFixed(2)}</span>
                                <span className="ml-2 text-gray-600">via {paymentMethods}</span>
                              </span>
                            </div>
                          </>
                        );
                      })()}
                    </div>


                    {/* Items */}
                    <div className="border rounded-lg overflow-hidden mb-2">
                      <div className="bg-gray-50 px-2 py-1 font-semibold text-xs border-b flex">
                        <div className="w-8"></div>
                        <div className="flex-1">Item</div>
                        <div className="w-14 text-center pl-1">Qty</div>
                        <div className="w-14 text-right pl-1">Price</div>
                        <div className="w-14 text-right pl-1">Total</div>
                      </div>
                      <div className="min-h-[263px] max-h-[263px] overflow-y-auto">
                        {refundOrderItems
                          .filter((item) => {
                            // Filter out negative price items (discounts)
                            const unitPrice = item.unit_price || item.price || 0;
                            return unitPrice > 0;
                          })
                          .map((item) => {
                          const isSelected = !!refundSelectedItems[item.id];
                          const selectedQty = refundSelectedItems[item.id] || 0;
                          const maxQty = item.refundable_quantity || 0;
                          const unitPrice = item.unit_price || item.price || 0;
                          
                          return (
                            <div
                              key={item.id}
                              className={`px-2 py-2 border-b flex items-center text-sm ${maxQty === 0 ? 'bg-gray-100 opacity-50' : isSelected ? 'bg-red-50' : ''}`}
                            >
                              <div className="w-8">
                                {maxQty > 0 && (
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleRefundItem(item.id, maxQty)}
                                    className="w-7 h-7 cursor-pointer"
                                  />
                                )}
                              </div>
                              <div className="flex-1">
                                <div className="font-medium text-sm">{item.name || item.item_name}</div>
                                {item.refunded_quantity > 0 && (
                                  <div className="text-xs text-red-500">Refunded: {item.refunded_quantity}</div>
                                )}
                              </div>
                              <div className="w-14 text-center pl-2">
                                {isSelected && maxQty > 1 ? (
                                  <div className="flex items-center justify-center gap-0.5">
                                    <button
                                      onClick={() => updateRefundItemQty(item.id, selectedQty - 1)}
                                      className="w-5 h-5 bg-gray-200 rounded text-xs font-bold"
                                    >-</button>
                                    <span className="w-5 text-center text-sm">{selectedQty}</span>
                                    <button
                                      onClick={() => updateRefundItemQty(item.id, Math.min(selectedQty + 1, maxQty))}
                                      className="w-5 h-5 bg-gray-200 rounded text-xs font-bold"
                                    >+</button>
                                  </div>
                                ) : (
                                  <span className="pl-2">{maxQty > 0 ? maxQty : '-'}</span>
                                )}
                              </div>
                              <div className="w-14 text-right text-sm">${unitPrice.toFixed(2)}</div>
                              <div className="w-14 text-right font-semibold text-sm">
                                ${(unitPrice * (isSelected ? selectedQty : maxQty)).toFixed(2)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Refund Summary */}
                    {(() => {
                      const { subtotal, tax, total } = calculateRefundTotals();
                      return (
                        <div className="bg-red-50 border-2 border-red-200 rounded-lg p-2 mb-2">
                          <div className="flex justify-between text-sm">
                            <span>Subtotal:</span>
                            <span>${subtotal.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span>Tax Refund:</span>
                            <span>${tax.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-lg font-bold text-red-600 border-t pt-1 mt-1">
                            <span>Total Refund:</span>
                            <span>${total.toFixed(2)}</span>
                          </div>
                        </div>
                      );
                    })()}

                  </div>

                  {/* Right Column: Reason, PIN, Numpad */}
                  <div className="w-1/2 flex flex-col gap-3">
                    {/* Reason Section */}
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          'Food Quality',
                          'Wrong Order',
                          'Cooking Delay',
                          'Delivery Damage',
                          'Duplicate Charge',
                          'Incorrect Amount'
                        ].map((reason) => (
                          <button
                            key={reason}
                            onClick={() => setRefundReason(reason)}
                            className={`px-1 py-4 text-xs rounded-lg border-2 font-bold whitespace-nowrap ${
                              refundReason === reason 
                                ? 'bg-red-600 text-white border-red-600' 
                                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                            }`}
                          >
                            {reason}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* PIN + Numpad Section */}
                    <div className="bg-gray-100 border border-gray-300 rounded-lg p-3">
                      {/* PIN Input */}
                      <div className="mb-2">
                        <label className="block text-sm font-semibold mb-1 text-red-600">Authorized PIN *</label>
                        <input
                          type="password"
                          value={refundPin}
                          readOnly
                          placeholder="Enter PIN"
                          className="w-full px-2 py-2.5 border-2 border-red-300 rounded-lg text-center text-xl font-mono tracking-widest bg-white"
                        />
                      </div>

                      {/* Numpad */}
                      <div className="grid grid-cols-4 gap-1.5">
                        {['1', '2', '3', 'C', '4', '5', '6', '⌫', '7', '8', '9', '', '.', '0', '00', ''].map((key, idx) => (
                          key === '' ? <div key={idx}></div> : (
                            <button
                              key={key}
                              onClick={() => {
                                if (key === 'C') {
                                  setRefundPin('');
                                } else if (key === '⌫') {
                                  setRefundPin(prev => prev.slice(0, -1));
                                } else if (key === '.' || key === '00') {
                                  // PIN doesn't need . or 00, but keep for consistency
                                  if (refundPin.length < 6) {
                                    setRefundPin(prev => prev + (key === '00' ? '00' : ''));
                                  }
                                } else if (refundPin.length < 6) {
                                  setRefundPin(prev => prev + key);
                                }
                                setRefundPinError('');
                              }}
                              className={`py-3 rounded-lg font-bold text-lg ${
                                key === 'C' ? 'bg-gray-300 text-gray-700' :
                                key === '⌫' ? 'bg-orange-200 text-orange-700' :
                                'bg-white hover:bg-gray-50'
                              }`}
                            >
                              {key}
                            </button>
                          )
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3a: Card Input for Card Refunds */}
              {refundStep === 'card_input' && refundPendingData && (() => {
                const methodUpper = refundPendingData.paymentMethod?.toUpperCase() || '';
                const isGiftCard = methodUpper === 'GIFT_CARD' || 
                                   methodUpper === 'GIFT CARD' ||
                                   methodUpper === 'GIFT' ||
                                   methodUpper.includes('GIFT');
                return (
                <div className="flex gap-4 h-full">
                  {/* Left: Info & Inputs */}
                  <div className="w-1/2 flex flex-col">
                    <div className={`${isGiftCard ? 'bg-purple-50' : 'bg-blue-50'} p-4 rounded-xl mb-3`}>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm text-gray-600">{isGiftCard ? 'Reload Amount:' : 'Refund Amount:'}</span>
                        <span className={`text-2xl font-bold ${isGiftCard ? 'text-purple-600' : 'text-red-600'}`}>${refundPendingData.total.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-600">Payment Method:</span>
                        <span className={`text-lg font-semibold ${isGiftCard ? 'text-purple-600' : 'text-blue-600'}`}>{refundPendingData.paymentMethod}</span>
                      </div>
                      {isGiftCard && (
                        <p className="text-sm text-gray-600 mt-2">
                          The refund amount will be reloaded to the gift card.
                        </p>
                      )}
                    </div>

                    {/* Card Number - Different for Gift Card vs Regular Card */}
                    <div className="mb-3">
                      <label className="block text-sm font-semibold mb-1 text-gray-700">
                        {isGiftCard ? 'Gift Card Number (16 Digits) *' : 'Card Number (Last 4 Digits) *'}
                      </label>
                      {isGiftCard ? (
                        <div className="w-full px-3 py-2.5 border-2 border-purple-300 focus-within:border-purple-500 rounded-lg text-center text-2xl font-mono bg-white flex justify-center items-center gap-0">
                          {[0, 1, 2, 3].map((group) => (
                            <span key={group} className="flex items-center">
                              {[0, 1, 2, 3].map((digit) => {
                                const idx = group * 4 + digit;
                                const char = refundGiftCardNumber[idx] || '';
                                return (
                                  <span 
                                    key={idx} 
                                    className={`w-5 h-8 flex items-center justify-center ${char ? 'text-gray-800' : 'text-gray-300'}`}
                                  >
                                    {char || '_'}
                                  </span>
                                );
                              })}
                              {group < 3 && <span className="text-gray-400 mx-1">-</span>}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <input
                          type="text"
                          value={refundCardNumber}
                          onChange={(e) => {
                            const value = e.target.value.replace(/\D/g, '');
                            setRefundCardNumber(value.slice(0, 4));
                          }}
                          placeholder="0000"
                          className="w-full px-3 py-2.5 border-2 border-gray-300 focus:border-blue-500 rounded-lg text-center text-2xl font-mono tracking-widest focus:outline-none"
                          maxLength={4}
                        />
                      )}
                    </div>

                    {/* Approval Number - Only for regular cards */}
                    {!isGiftCard && (
                      <div className="mb-3">
                        <label className="block text-sm font-semibold mb-1 text-gray-700">Card Authorization Code *</label>
                        <input
                          type="text"
                          value={refundApprovalNumber}
                          onChange={(e) => setRefundApprovalNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
                          placeholder="From card terminal receipt"
                          className="w-full px-3 py-2.5 border-2 border-gray-300 rounded-lg text-center text-2xl font-mono tracking-widest focus:border-blue-500 focus:outline-none"
                          maxLength={10}
                        />
                      </div>
                    )}
                  </div>

                  {/* Right: Numpad */}
                  <div className="w-1/2 flex flex-col">
                    <div className="grid grid-cols-3 gap-2 flex-1">
                      {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((key) => (
                        <button
                          key={key}
                          onClick={() => {
                            if (isGiftCard) {
                              // Gift Card: Only card number input
                              if (key === 'C') {
                                setRefundGiftCardNumber('');
                              } else if (key === '⌫') {
                                setRefundGiftCardNumber(refundGiftCardNumber.slice(0, -1));
                              } else {
                                if (refundGiftCardNumber.length < 16) {
                                  setRefundGiftCardNumber(refundGiftCardNumber + key);
                                }
                              }
                            } else {
                              // Regular Card: Card number + Approval number
                              if (key === 'C') {
                                setRefundCardNumber('');
                                setRefundApprovalNumber('');
                              } else if (key === '⌫') {
                                if (refundApprovalNumber) {
                                  setRefundApprovalNumber(refundApprovalNumber.slice(0, -1));
                                } else if (refundCardNumber) {
                                  setRefundCardNumber(refundCardNumber.slice(0, -1));
                                }
                              } else {
                                if (refundCardNumber.length < 4) {
                                  setRefundCardNumber(refundCardNumber + key);
                                } else if (refundApprovalNumber.length < 10) {
                                  setRefundApprovalNumber(refundApprovalNumber + key);
                                }
                              }
                            }
                          }}
                          className={`h-14 text-xl font-bold rounded-lg ${
                            key === 'C' ? 'bg-red-100 text-red-600 hover:bg-red-200' :
                            key === '⌫' ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' :
                            'bg-gray-100 text-gray-800 hover:bg-gray-200'
                          }`}
                        >
                          {key}
                        </button>
                      ))}
                    </div>
                    
                    {/* Action Buttons */}
                    <div className="grid grid-cols-2 gap-2 mt-3">
                      <button 
                        onClick={() => setRefundStep('detail')} 
                        className="py-3 bg-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-400"
                      >
                        Back
                      </button>
                      <button
                        onClick={isGiftCard ? processGiftCardRefund : processCardRefund}
                        disabled={refundLoading || (isGiftCard ? !refundGiftCardNumber : (!refundCardNumber || !refundApprovalNumber))}
                        className={`py-3 ${isGiftCard ? 'bg-purple-600 hover:bg-purple-700' : 'bg-red-600 hover:bg-red-700'} text-white rounded-lg font-semibold disabled:bg-gray-400`}
                      >
                        {refundLoading ? 'Processing...' : (isGiftCard ? 'Reload' : 'Complete')}
                      </button>
                    </div>
                  </div>
                </div>
                );
              })()}

              {/* Step 3b: Gift Card Input for Gift Card Refunds */}
              {refundStep === 'giftcard_input' && refundPendingData && (
                <div className="flex gap-4 h-full">
                  {/* Left: Info & Inputs */}
                  <div className="w-1/2 flex flex-col">
                    <div className="bg-purple-50 p-4 rounded-xl mb-3">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm text-gray-600">Reload Amount:</span>
                        <span className="text-2xl font-bold text-purple-600">${refundPendingData.total.toFixed(2)}</span>
                      </div>
                      <p className="text-sm text-gray-600">
                        The refund amount will be reloaded to the gift card.
                      </p>
                    </div>

                    {/* Gift Card Number */}
                    <div className="mb-3">
                      <label className="block text-sm font-semibold mb-1 text-gray-700">Gift Card Number *</label>
                      <input
                        type="text"
                        value={refundGiftCardNumber}
                        onChange={(e) => setRefundGiftCardNumber(e.target.value.replace(/\D/g, '').slice(0, 16))}
                        placeholder="Enter gift card number"
                        className="w-full px-3 py-2.5 border-2 border-purple-300 rounded-lg text-center text-2xl font-mono tracking-widest focus:border-purple-500 focus:outline-none"
                        maxLength={16}
                      />
                    </div>
                  </div>

                  {/* Right: Numpad */}
                  <div className="w-1/2 flex flex-col">
                    <div className="grid grid-cols-3 gap-2 flex-1">
                      {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((key) => (
                        <button
                          key={key}
                          onClick={() => {
                            if (key === 'C') {
                              setRefundGiftCardNumber('');
                            } else if (key === '⌫') {
                              setRefundGiftCardNumber(refundGiftCardNumber.slice(0, -1));
                            } else {
                              if (refundGiftCardNumber.length < 16) {
                                setRefundGiftCardNumber(refundGiftCardNumber + key);
                              }
                            }
                          }}
                          className={`h-14 text-xl font-bold rounded-lg ${
                            key === 'C' ? 'bg-red-100 text-red-600 hover:bg-red-200' :
                            key === '⌫' ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' :
                            'bg-gray-100 text-gray-800 hover:bg-gray-200'
                          }`}
                        >
                          {key}
                        </button>
                      ))}
                    </div>
                    
                    {/* Action Buttons */}
                    <div className="grid grid-cols-2 gap-2 mt-3">
                      <button 
                        onClick={() => setRefundStep('detail')} 
                        className="py-3 bg-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-400"
                      >
                        Back
                      </button>
                      <button
                        onClick={processGiftCardRefund}
                        disabled={refundLoading || !refundGiftCardNumber}
                        className="py-3 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-700 disabled:bg-gray-400"
                      >
                        {refundLoading ? 'Processing...' : 'Reload'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 4: Confirmation */}
              {refundStep === 'confirm' && refundResult && (
                <div className="text-center py-8">
                  <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 className="text-2xl font-bold text-green-600 mb-2">Refund Processed</h3>
                  <div className="bg-gray-100 rounded-lg p-4 text-left max-w-md mx-auto">
                    <div className="flex justify-between mb-1">
                      <span>Refund ID:</span>
                      <span className="font-semibold">#{refundResult.id}</span>
                    </div>
                    <div className="flex justify-between mb-1">
                      <span>Original Order:</span>
                      <span className="font-semibold">#{refundResult.originalOrderNumber}</span>
                    </div>
                    <div className="flex justify-between mb-1">
                      <span>Refund Amount:</span>
                      <span className="font-bold text-red-600">${(refundResult.total || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between mb-1">
                      <span>Processed by:</span>
                      <span className="font-semibold">{refundResult.refundedBy}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Payment Method:</span>
                      <span className="font-semibold">{refundResult.paymentMethod}</span>
                    </div>
                  </div>
                  <div className="text-sm text-gray-500 mt-4">Receipt has been printed</div>
                </div>
              )}
            </div>

            {/* Footer - Hidden for card_input and giftcard_input steps */}
            {refundStep !== 'card_input' && refundStep !== 'giftcard_input' && (
            <div className="border-t px-6 py-4 flex justify-between bg-gray-50">
              {refundStep === 'list' && (
                <button onClick={closeRefundModal} className="px-6 py-2 bg-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-400">
                  Cancel
                </button>
              )}
              {refundStep === 'detail' && (
                <>
                  <button onClick={() => setRefundStep('list')} className="px-6 py-2 bg-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-400">
                    Back
                  </button>
                  <button
                    onClick={processRefund}
                    disabled={refundLoading || Object.keys(refundSelectedItems).length === 0}
                    className="px-8 py-2 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 disabled:bg-gray-400"
                  >
                    {refundLoading ? 'Processing...' : 'Process Refund'}
                  </button>
                </>
              )}
              {refundStep === 'confirm' && (
                <button onClick={closeRefundModal} className="w-full px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700">
                  Close
                </button>
              )}
            </div>
            )}
          </div>
        </div>
      )}

      {/* Refund Success Popup */}
      {showRefundSuccessPopup && (
        <div className="fixed inset-0 flex items-center justify-center z-[60] pointer-events-none" style={{ transform: 'translateY(-100px)' }}>
          <div className="bg-green-500 text-white px-16 py-8 rounded-2xl shadow-2xl animate-pulse">
            <div className="text-4xl font-bold text-center">Refund Complete</div>
          </div>
        </div>
      )}

      {/* Refund PIN Error Popup */}
      {refundPinError && (
        <div className="fixed inset-0 flex items-center justify-center z-[60] pointer-events-none" style={{ transform: 'translateY(-100px)' }}>
          <div className="bg-red-600 text-white px-12 py-6 rounded-2xl shadow-2xl">
            <div className="text-2xl font-bold text-center">{refundPinError}</div>
          </div>
        </div>
      )}

    </div>
  );
};

export default SalesPage;

export {};