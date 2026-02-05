import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../config/constants';
import ReservationCreateModal from '../components/reservations/ReservationCreateModal';
import WaitingListModal from '../components/waiting/WaitingListModal';
import VirtualKeyboard from '../components/order/VirtualKeyboard';
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
import { printReceipt, printKitchenTicket, printBill, openCashDrawer } from '../utils/printUtils';
import { MoveMergeHistoryModal } from '../components/MoveMergeHistoryModal';
import { SimplePartialSelectionModal } from '../components/SimplePartialSelectionModal';
import { PartialSelectionPayload } from '../types/MoveMergeTypes';
import OnlineOrderPanel from '../components/OnlineOrderPanel';
import TablePaymentModal from '../components/PaymentModal';
import DayClosingModal from '../components/DayClosingModal';
import DayOpeningModal from '../components/DayOpeningModal';
import OrderDetailModal, { OrderData, OrderChannelType } from '../components/OrderDetailModal';

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

type VirtualOrderChannel = 'togo' | 'online' | 'delivery';

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
  fullOrder?: any; // ì „ì²´ ì£¼ë¬¸ ë°ì´í„° ì¶”ê°€
  placedTime?: string | Date; // ì£¼ë¬¸ ì‹œê°„
  pickupTime?: string | Date | null; // í”½ì—… ì‹œê°„
  total?: number; // ì´ì•¡
  sequenceNumber?: number; // ìˆœì„œë²ˆí˜¸
  status?: string; // ì£¼ë¬¸ ìƒíƒœ (pending, confirmed, preparing, ready, completed, cancelled)
}

const VIRTUAL_TABLE_POOL: Record<VirtualOrderChannel, { prefix: string; limit: number }> = {
  togo: { prefix: 'TG', limit: 500 },
  online: { prefix: 'OL', limit: 500 },
  delivery: { prefix: 'DL', limit: 500 },
};

const normalizeVirtualOrderChannel = (
  value?: string | null,
  fallback: VirtualOrderChannel = 'togo'
): VirtualOrderChannel => {
  if (!value) return fallback;
  const key = String(value).trim().toLowerCase();
  if (key === 'online' || key === 'web' || key === 'qr') return 'online';
  if (key === 'delivery' || key === 'ubereats' || key === 'doordash' || key === 'skipthedishes' || key === 'fantuan') return 'delivery';
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
  console.warn(`[VIRTUAL-ID] ${prefix} í’€ ì†Œì§„ - ìž„ì‹œ ID ${candidate} ì‚¬ìš©`);
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
  // ë¹ˆ ë°°ì—´ë¡œ ì‹œìž‘ - ì‹¤ì œ ë°ì´í„°ëŠ” loadOnlineOrdersì—ì„œ ê°€ì ¸ì˜´
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

  // Floor ê´€ë ¨ ìƒíƒœ
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

  // Online/Togo Order Detail Modal state (ê°œë³„ ì¹´ë“œ í´ë¦­ ì‹œ)
  const [showOrderDetailModal, setShowOrderDetailModal] = useState<boolean>(false);
  const [selectedOrderDetail, setSelectedOrderDetail] = useState<any | null>(null);
  const [selectedOrderType, setSelectedOrderType] = useState<'online' | 'togo' | 'delivery' | null>(null);

  // Online/Togo ê²°ì œ ëª¨ë‹¬ state
  const [showOnlineTogoPaymentModal, setShowOnlineTogoPaymentModal] = useState<boolean>(false);
  const [onlineTogoPaymentOrder, setOnlineTogoPaymentOrder] = useState<any | null>(null);
  
  // Online/Togo ê²°ì œ ì„¸ì…˜ ê´€ë¦¬ (Dine-Inê³¼ ë™ì¼í•œ ë°©ì‹)
  const [onlineTogoSessionPayments, setOnlineTogoSessionPayments] = useState<Array<{ paymentId: number; method: string; amount: number; tip: number }>>([]);
  const onlineTogoSavedOrderIdRef = React.useRef<number | null>(null);
  
  // ê²°ì œ ì™„ë£Œ í›„ Pickup Complete í™•ì¸ ëª¨ë‹¬
  const [showPickupConfirmModal, setShowPickupConfirmModal] = useState<boolean>(false);
  const [pickupConfirmOrder, setPickupConfirmOrder] = useState<any | null>(null);
  
  // UNPAID ì£¼ë¬¸ Pickup ì‹œë„ ì‹œ í™•ì¸ ëª¨ë‹¬
  const [showUnpaidPickupModal, setShowUnpaidPickupModal] = useState<boolean>(false);
  const [unpaidPickupOrder, setUnpaidPickupOrder] = useState<any | null>(null);
  
  // EXIT ëª¨ë‹¬ ìƒíƒœ
  const [showExitModal, setShowExitModal] = useState<boolean>(false);

  // Clock In/Out modal state
  const [showClockInOutMenu, setShowClockInOutMenu] = useState<boolean>(false);
  const [showClockInModal, setShowClockInModal] = useState<boolean>(false);
  const [showClockOutModal, setShowClockOutModal] = useState<boolean>(false);
  const [isDayClosed, setIsDayClosed] = useState<boolean>(false);

  // Day status check
  const checkDayStatus = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/api/daily-closings/today`);
      const result = await response.json();
      if (result.success) {
        if (!result.isOpen && !result.isClosed) {
          setShowOpeningModal(true);
        } else if (result.isClosed) {
          setIsDayClosed(true);
        }
      }
    } catch (error) {
      console.error('Failed to check day status:', error);
    }
  }, []);

  useEffect(() => {
    checkDayStatus();
  }, [checkDayStatus]);

  // Opening/Closing modal state
  const [showOpeningModal, setShowOpeningModal] = useState<boolean>(false);
  const [showClosingModal, setShowClosingModal] = useState<boolean>(false);
  const [closingStep, setClosingStep] = useState<'report' | 'cash'>('report'); // 'report' = Z-Report ë³´ê¸°, 'cash' = í˜„ê¸ˆ ìž…ë ¥
  const [zReportData, setZReportData] = useState<any>(null);
  const [isLoadingZReport, setIsLoadingZReport] = useState<boolean>(false);
  
  // Cash denomination counts for Opening
  const [openingCashCounts, setOpeningCashCounts] = useState({
    cent1: 0, cent5: 0, cent10: 0, cent25: 0,
    dollar1: 0, dollar5: 0, dollar10: 0, dollar20: 0, dollar50: 0, dollar100: 0
  });
  
  // Cash denomination counts for Closing
  const [closingCashCounts, setClosingCashCounts] = useState({
    cent1: 0, cent5: 0, cent10: 0, cent25: 0,
    dollar1: 0, dollar5: 0, dollar10: 0, dollar20: 0, dollar50: 0, dollar100: 0
  });
  
  // Cash denomination definitions
  const cashDenominations = [
    { key: 'cent1', label: '1Â¢', value: 0.01 },
    { key: 'cent5', label: '5Â¢', value: 0.05 },
    { key: 'cent10', label: '10Â¢', value: 0.10 },
    { key: 'cent25', label: '25Â¢', value: 0.25 },
    { key: 'dollar1', label: '$1', value: 1 },
    { key: 'dollar5', label: '$5', value: 5 },
    { key: 'dollar10', label: '$10', value: 10 },
    { key: 'dollar20', label: '$20', value: 20 },
    { key: 'dollar50', label: '$50', value: 50 },
    { key: 'dollar100', label: '$100', value: 100 },
  ];
  
  // Calculate total from cash counts
  const calculateCashTotal = (counts: typeof openingCashCounts) => {
    return cashDenominations.reduce((sum, denom) => {
      return sum + (counts[denom.key as keyof typeof counts] * denom.value);
    }, 0);
  };
  
  const openingCashTotal = calculateCashTotal(openingCashCounts);
  const closingCashTotal = calculateCashTotal(closingCashCounts);
  
  // Reset cash counts
  const resetOpeningCashCounts = () => {
    setOpeningCashCounts({
      cent1: 0, cent5: 0, cent10: 0, cent25: 0,
      dollar1: 0, dollar5: 0, dollar10: 0, dollar20: 0, dollar50: 0, dollar100: 0
    });
  };
  
  const resetClosingCashCounts = () => {
    setClosingCashCounts({
      cent1: 0, cent5: 0, cent10: 0, cent25: 0,
      dollar1: 0, dollar5: 0, dollar10: 0, dollar20: 0, dollar50: 0, dollar100: 0
    });
  };
  
  // Currently focused denomination for number pad
  const [focusedOpeningDenom, setFocusedOpeningDenom] = useState<string>('dollar1');
  const [focusedClosingDenom, setFocusedClosingDenom] = useState<string>('dollar1');
  
  // Number pad handler for Opening
  const handleOpeningNumPad = (num: string) => {
    if (!focusedOpeningDenom) return;
    const currentValue = openingCashCounts[focusedOpeningDenom as keyof typeof openingCashCounts];
    let newValue: number;
    
    if (num === 'C') {
      newValue = 0;
    } else if (num === 'âŒ«') {
      newValue = Math.floor(currentValue / 10);
    } else {
      newValue = currentValue * 10 + parseInt(num);
      if (newValue > 9999) newValue = 9999;
    }
    
    setOpeningCashCounts(prev => ({ ...prev, [focusedOpeningDenom]: newValue }));
  };
  
  // Number pad handler for Closing
  const handleClosingNumPad = (num: string) => {
    if (!focusedClosingDenom) return;
    const currentValue = closingCashCounts[focusedClosingDenom as keyof typeof closingCashCounts];
    let newValue: number;
    
    if (num === 'C') {
      newValue = 0;
    } else if (num === 'âŒ«') {
      newValue = Math.floor(currentValue / 10);
    } else {
      newValue = currentValue * 10 + parseInt(num);
      if (newValue > 9999) newValue = 9999;
    }
    
    setClosingCashCounts(prev => ({ ...prev, [focusedClosingDenom]: newValue }));
  };
  
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

  // Day Opening/Closing state
  // isDayClosed is already declared above with checkDayStatus

  // Move/Merge mode state (Restored from Backup)
  const [isMoveMergeMode, setIsMoveMergeMode] = useState<boolean>(false);
  const [isMergeInProgress, setIsMergeInProgress] = useState<boolean>(false); // ë”ë¸” í´ë¦­ ë°©ì§€
  const [sourceTableId, setSourceTableId] = useState<string | null>(null);
  const [sourceTogoOrder, setSourceTogoOrder] = useState<any | null>(null); // Togo → Togo ë¨¸ì§€ìš©
  const [sourceOnlineOrder, setSourceOnlineOrder] = useState<any | null>(null); // Online → Togo ë¨¸ì§€ìš©
  const [moveMergeStatus, setMoveMergeStatus] = useState<string>('');
  const [sourceSelectionInfo, setSourceSelectionInfo] = useState<{ tableId: string; label: string; orderId?: number | string | null } | null>(null);
  const [selectionChoice, setSelectionChoice] = useState<'ALL' | PartialSelectionPayload | null>(null);
  const [isSelectionModalOpen, setIsSelectionModalOpen] = useState(false);
  const [showMoveHistory, setShowMoveHistory] = useState(false);

  // Print Bill mode state
  const [isBillPrintMode, setIsBillPrintMode] = useState<boolean>(false);
  const [billPrintStatus, setBillPrintStatus] = useState<string>('');

  // Online Settings modal state (Prep Time, Pause, Day Off, Menu Hide tabs)
  const [showPrepTimeModal, setShowPrepTimeModal] = useState<boolean>(false);
  const [onlineModalTab, setOnlineModalTab] = useState<'preptime' | 'pause' | 'dayoff' | 'menuhide'>('preptime');
  
  // Menu Hide tab state
  const [menuHideCategories, setMenuHideCategories] = useState<Array<{
    category_id: string;
    name: string;
    item_count: number;
    hidden_online_count: number;
    hidden_delivery_count: number;
  }>>([]);
  const [menuHideItems, setMenuHideItems] = useState<Array<{
    item_id: string;
    name: string;
    price: number;
    online_visible: number;
    delivery_visible: number;
    online_hide_type: 'visible' | 'permanent' | 'time_limited';
    online_available_until: string | null;
    delivery_hide_type: 'visible' | 'permanent' | 'time_limited';
    delivery_available_until: string | null;
  }>>([]);
  const [menuHideSelectedCategory, setMenuHideSelectedCategory] = useState<string | null>(null);
  const [menuHideLoading, setMenuHideLoading] = useState<boolean>(false);
  const [menuHideSelectedItem, setMenuHideSelectedItem] = useState<string | null>(null);
  const [menuHideEditMode, setMenuHideEditMode] = useState<'online' | 'delivery' | null>(null);
  
  // Pause ì„¤ì • state (ê° ì±„ë„ë³„ pause ìƒíƒœì™€ ë‚¨ì€ ì‹œê°„)
  const [pauseSettings, setPauseSettings] = useState<{
    thezoneorder: { paused: boolean; pauseUntil: Date | null };
    ubereats: { paused: boolean; pauseUntil: Date | null };
    doordash: { paused: boolean; pauseUntil: Date | null };
    skipthedishes: { paused: boolean; pauseUntil: Date | null };
  }>({
    thezoneorder: { paused: false, pauseUntil: null },
    ubereats: { paused: false, pauseUntil: null },
    doordash: { paused: false, pauseUntil: null },
    skipthedishes: { paused: false, pauseUntil: null },
  });
  const [selectedPauseDuration, setSelectedPauseDuration] = useState<string | null>(null);
  
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

  // Day Off ì„¤ì • state
  const [dayOffDates, setDayOffDates] = useState<{ date: string; channels: string; type: string }[]>([]);
  const [dayOffCalendarMonth, setDayOffCalendarMonth] = useState<Date>(new Date());
  const [dayOffSelectedDates, setDayOffSelectedDates] = useState<string[]>([]);
  const [dayOffSelectedChannels, setDayOffSelectedChannels] = useState<string[]>(['all']);
  const [dayOffType, setDayOffType] = useState<'closed' | 'extended' | 'early' | 'late'>('closed');
  const [dayOffTime, setDayOffTime] = useState<{ start: string; end: string }>({ start: '09:00', end: '21:00' });
  const [dayOffSaveStatus, setDayOffSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  // ìƒˆ ì˜¨ë¼ì¸ ì£¼ë¬¸ ì•Œë¦¼ ëª¨ë‹¬ ìƒíƒœ
  const [showNewOrderAlert, setShowNewOrderAlert] = useState<boolean>(false);
  const [newOrderAlertData, setNewOrderAlertData] = useState<any>(null);
  const [selectedPrepTime, setSelectedPrepTime] = useState<number>(20);
  const previousOnlineOrdersRef = useRef<string[]>([]);
  const isFirstOnlineOrderLoadRef = useRef<boolean>(true); // ì²« ë¡œë“œ ì‹œ ì•ŒëžŒ ë°©ì§€
  
  // ì˜¨ë¼ì¸ ì£¼ë¬¸ ì•Œë¦¼ìŒ
  const onlineOrderAudioRef = useRef<HTMLAudioElement | null>(null);
  
  // ì˜¨ë¼ì¸ ì£¼ë¬¸ ì•Œë¦¼ìŒ ì´ˆê¸°í™”
  useEffect(() => {
    if (!onlineOrderAudioRef.current) {
      onlineOrderAudioRef.current = new Audio('/sounds/new-order.mp3');
      onlineOrderAudioRef.current.preload = 'auto';
      onlineOrderAudioRef.current.volume = 1.0;
    }
  }, []);
  
  // ì˜¨ë¼ì¸ ì£¼ë¬¸ ì•Œë¦¼ìŒ ìž¬ìƒ í•¨ìˆ˜
  const playOnlineOrderSound = useCallback(() => {
    try {
      if (!onlineOrderAudioRef.current) {
        onlineOrderAudioRef.current = new Audio('/sounds/new-order.mp3');
      }
      onlineOrderAudioRef.current.currentTime = 0;
      onlineOrderAudioRef.current.volume = 1.0;
      onlineOrderAudioRef.current.play()
        .then(() => console.log('🔄 ì˜¨ë¼ì¸ ì£¼ë¬¸ ì•Œë¦¼ìŒ ìž¬ìƒ'))
        .catch(err => console.warn('ì•Œë¦¼ìŒ ìž¬ìƒ ì‹¤íŒ¨:', err.message));
    } catch (error) {
      console.error('ì˜¤ë””ì˜¤ ìž¬ìƒ ì˜¤ë¥˜:', error);
    }
  }, []);

  // Order List modal state
  const [showOrderListModal, setShowOrderListModal] = useState<boolean>(false);
  const [orderListDate, setOrderListDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [orderListOrders, setOrderListOrders] = useState<any[]>([]);
  const [orderListSelectedOrder, setOrderListSelectedOrder] = useState<any | null>(null);
  const [orderListSelectedItems, setOrderListSelectedItems] = useState<any[]>([]);
  const [orderListLoading, setOrderListLoading] = useState<boolean>(false);
  const [showOrderListCalendar, setShowOrderListCalendar] = useState<boolean>(false);
  const [orderListCalendarMonth, setOrderListCalendarMonth] = useState<Date>(new Date());
  const [orderListTab, setOrderListTab] = useState<'history' | 'live'>('history');
  const [liveOrders, setLiveOrders] = useState<any[]>([]);
  const [liveOrderHighlightItem, setLiveOrderHighlightItem] = useState<string | null>(null);
  
  // Order List modal scroll refs
  const liveOrderCardRefs = useRef<{ [tableId: string]: HTMLDivElement | null }>({});
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
    setIsMergeInProgress(false); // ë”ë¸” í´ë¦­ ë°©ì§€ ìƒíƒœë„ ë¦¬ì…‹
  }, []);

  const beginSourceSelection = useCallback(async (element: TableElement, label: string) => {
    setSourceSelectionInfo({
      tableId: String(element.id),
      label,
      orderId: element.current_order_id || undefined,
    });
    if (element.current_order_id) {
      // ìŠ¤í”Œë¦¿ ì—¬ë¶€ í™•ì¸ - guest_numberê°€ 1ê°œë§Œ ìžˆìœ¼ë©´ ìŠ¤í”Œë¦¿ë˜ì§€ ì•Šì€ ê²ƒ
      try {
        const res = await fetch(`${API_URL}/orders/${element.current_order_id}`);
        const data = await res.json();
        if (data.success && Array.isArray(data.items)) {
          const guestNumbers = new Set(data.items.map((item: any) => Number(item.guest_number) || 1));
          if (guestNumbers.size <= 1) {
            // ìŠ¤í”Œë¦¿ë˜ì§€ ì•ŠìŒ - ë°”ë¡œ ALL ì„ íƒ
            setSelectionChoice('ALL');
            setMoveMergeStatus(`âœ“ [Move All] ${label} → Select destination`);
            return;
          }
        }
      } catch (e) {
        console.error('Failed to check split status:', e);
      }
      // ìŠ¤í”Œë¦¿ë¨ - ëª¨ë‹¬ í‘œì‹œ
      setSelectionChoice(null);
      setIsSelectionModalOpen(true);
      setMoveMergeStatus('Select guests/items to move.');
    } else {
      setSelectionChoice('ALL');
      setMoveMergeStatus('Select destination table');
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
        // ëª…ì‹œì ìœ¼ë¡œ trueì¸ ê²½ìš°ì—ë§Œ í™œì„±í™” (ê¸°ë³¸ê°’: false)
        setSelectServerPromptEnabled(nextValue === true);
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
        const res = await fetch(`${API_URL}/printers/layout-settings`, { cache: 'no-store' as RequestCache });
        if (!res.ok) return;
        const json = await res.json();
        const payload = (json && typeof json === 'object' && json.settings) ? json.settings : json;
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

  // localStorageì—ì„œ ì €ìž¥ëœ Floor ëª©ë¡ ë¶ˆëŸ¬ì˜¤ê¸° (ë°±ì˜¤í”¼ìŠ¤ì™€ ë™ì¼)
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

  // Floor ëª©ë¡ ì´ˆê¸°í™”
  useEffect(() => {
    const savedFloorList = getSavedFloorList();
    setFloorList(savedFloorList);
  }, []);

  // BO ìƒíƒœë³„ ìƒ‰ìƒ ë¡œë“œ
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

  // screenSize ê°’ì´ ë³€ê²½ë  ë•Œë§ˆë‹¤ Consoleì— ì¶œë ¥
  useEffect(() => {
    console.log('ï¿½ï¿½ screenSize changed:', screenSize);
  }, [screenSize]);
  const [canvasStyle, setCanvasStyle] = useState<{ width?: string; height?: string; maxWidth?: string; maxHeight?: string }>({});
  // View mode ê³ ì •: í•­ìƒ Fixed(1:1 í”½ì…€)
  const viewMode: 'fixed' = 'fixed';
  const [scaleFactor, setScaleFactor] = useState<number>(1);
  const [actualScreenSize, setActualScreenSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const pageHostRef = useRef<HTMLDivElement>(null);
  const fixedAreaRef = useRef<HTMLDivElement>(null);
  // BO Screen Sizeë¥¼ 'ì „ì²´ í”„ë ˆìž„' í¬ê¸°ë¡œ ê·¸ëŒ€ë¡œ ì‚¬ìš©
  // ë°±ì˜¤í”¼ìŠ¤ì—ì„œ ì„¤ì •í•œ Screen Sizeë¥¼ ë™ì ìœ¼ë¡œ ì ìš©
  const frameWidthPx = parseInt(screenSize.width) || 1024;
  const frameHeightPx = parseInt(screenSize.height) || 768;
  const headerHeightPx = 56;
  const footerHeightPx = 70;
  const contentHeightPx = Math.max(0, frameHeightPx - headerHeightPx - footerHeightPx);
  // ì¢Œ/ìš° ë¹„ìœ¨ 66%/34%ë¡œ ë¶„í• 
  const leftWidthPx = Math.round(frameWidthPx * (66 / 100));
  const rightWidthPx = Math.max(0, frameWidthPx - leftWidthPx);
  // ìš”ì†ŒëŠ” BO ì¢Œí‘œ/í¬ê¸°ë¥¼ ê·¸ëŒ€ë¡œ ì‚¬ìš©(ìŠ¤ì¼€ì¼ ì—†ìŒ)
  // BO TableMapManagerPageì™€ ì¢Œí‘œ ì¼ì¹˜ë¥¼ ìœ„í•œ ìŠ¤ì¼€ì¼ ê³„ì‚°
  // BOì—ì„œ í…Œì´ë¸”ë§µ ì˜ì—­ ë†’ì´: ìº”ë²„ìŠ¤ ë†’ì´ì˜ 93% (ìƒë‹¨ 7% í—¤ë” ì œì™¸)
  const boMapHeight = frameHeightPx * 0.93;
  const boMapWidth = frameWidthPx * 0.66;
  const elementScaleX = leftWidthPx / boMapWidth;
  const elementScaleY = contentHeightPx / boMapHeight;
  const elementScale = Math.min(elementScaleX, elementScaleY);
  const KEYBOARD_RESERVED_HEIGHT = 260;
  const TOGO_MODAL_MAX_WIDTH = 900;
  const togoModalMaxHeight = Math.max(360, frameHeightPx - KEYBOARD_RESERVED_HEIGHT - 32);
  const togoModalMaxWidth = Math.min(frameWidthPx - 48, TOGO_MODAL_MAX_WIDTH);
  const keyboardMaxWidth = Math.min(frameWidthPx - 120, 860);

  // ì‹¤ì œ í™”ë©´ í¬ê¸° ê°ì§€ ë° ìŠ¤ì¼€ì¼ ê³„ì‚°
  useEffect(() => {
    const updateScreenSize = () => {
      setActualScreenSize({
        width: window.innerWidth,
        height: window.innerHeight
      });
    };

    // ì´ˆê¸° í¬ê¸° ì„¤ì •
    updateScreenSize();

    // ë¦¬ì‚¬ì´ì¦ˆ ì´ë²¤íŠ¸ ë¦¬ìŠ¤ë„ˆ
    window.addEventListener('resize', updateScreenSize);
    return () => window.removeEventListener('resize', updateScreenSize);
  }, []);

  // ë°±ì˜¤í”¼ìŠ¤ í•´ìƒë„ì™€ ì‹¤ì œ í™”ë©´ í¬ê¸°ë¥¼ ë¹„êµí•˜ì—¬ ìŠ¤ì¼€ì¼ ê³„ì‚°
  useEffect(() => {
    const actualWidth = actualScreenSize.width;
    const actualHeight = actualScreenSize.height;
    
    // ë°±ì˜¤í”¼ìŠ¤ì—ì„œ ì„¤ì •í•œ í•´ìƒë„
    const boWidth = frameWidthPx;
    const boHeight = frameHeightPx;
    
    // ë„ˆë¹„ì™€ ë†’ì´ ë¹„ìœ¨ ê³„ì‚°
    const scaleX = actualWidth / boWidth;
    const scaleY = actualHeight / boHeight;
    
    // ë” ìž‘ì€ ë¹„ìœ¨ì„ ì‚¬ìš©í•˜ì—¬ í™”ë©´ì— ë§žì¶¤ (ë¹„ìœ¨ ìœ ì§€)
    // ìµœì†Œ 0.5ë°°, ìµœëŒ€ 2ë°°ë¡œ ì œí•œ
    const calculatedScale = Math.max(0.5, Math.min(2.0, Math.min(scaleX, scaleY)));
    
    setScaleFactor(calculatedScale);
    console.log(`[SalesPage] Screen scaling: BO=${boWidth}x${boHeight}, Actual=${actualWidth}x${actualHeight}, Scale=${calculatedScale.toFixed(2)}`);
  }, [frameWidthPx, frameHeightPx, actualScreenSize]);

  // Togo ì£¼ë¬¸ ê´€ë ¨ ìƒíƒœë“¤
  const [showTogoOrderModal, setShowTogoOrderModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [pickupTime, setPickupTime] = useState(15);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const customerPhoneRef = useRef(''); // ë¹„ë™ê¸° í´ë¡œì €ìš© ref
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerZip, setCustomerZip] = useState('');
  const [togoOrderMode, setTogoOrderMode] = useState<'togo' | 'delivery'>('togo');
  
  // Delivery ì „ìš© ëª¨ë‹¬ state
  const [showDeliveryOrderModal, setShowDeliveryOrderModal] = useState(false);
  const [deliveryCompany, setDeliveryCompany] = useState<'UberEats' | 'Doordash' | 'SkipTheDishes' | 'Fantuan' | ''>('');
  const [deliveryOrderNumber, setDeliveryOrderNumber] = useState('');
  const [deliveryPrepTime, setDeliveryPrepTime] = useState(15);
  const deliveryOrderInputRef = useRef<HTMLInputElement>(null);
  
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
  const [selectServerPromptEnabled, setSelectServerPromptEnabled] = useState(false);
  const shouldPromptServerSelection = selectServerPromptEnabled !== false;
  const [selectedHistoryOrderId, setSelectedHistoryOrderId] = useState<number | null>(null);
  const [historyDetailsMap, setHistoryDetailsMap] = useState<Record<number, HistoryOrderDetailPayload>>({});
  const [historyOrderDetail, setHistoryOrderDetail] = useState<HistoryOrderDetailPayload | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  
  // ì˜¤ëŠ˜ì˜ ì˜ˆì•½ í˜„í™© ìƒíƒœ
  const [todayReservations, setTodayReservations] = useState<any[]>([]);
  
  // ì˜¤ëŠ˜ì˜ ì˜ˆì•½ í˜„í™© ë¡œë“œ
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
    
    // ì•± ì‹¤í–‰/ìƒˆë¡œê³ ì¹¨ ì‹œ ë¡œë“œ
    loadTodayReservations();
    
    // ì˜¤í›„ 2ì‹œ ì—…ë°ì´íŠ¸ ì²´í¬ (1ë¶„ë§ˆë‹¤ í™•ì¸)
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
    
    // 3ìžë¦¬ ì´í•˜ì¼ ë•ŒëŠ” ê´„í˜¸ ì—†ì´ ìˆ«ìžë§Œ í‘œì‹œ (ì§€ìš°ê¸° íŽ¸í•˜ê²Œ)
    if (digits.length <= 3) return digits;

    const area = digits.slice(0, 3);
    const rest = digits.slice(3);
    let formatted = `(${area}) `; // 4ìžë¦¬ ì´ìƒì¼ ë•Œ ê´„í˜¸ì™€ ê³µë°± ì¶”ê°€

    if (!rest) return formatted.trim(); // í˜¹ì‹œ ëª¨ë¥¼ ë°©ì–´
    
    // 4ë²ˆì§¸ ìžë¦¬ë¶€í„°ëŠ” (123) 4... í˜•ì‹
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
    if (!source) return 'â€”';
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
    if (!source) return 'â€”';
    const date = new Date(source);
    if (Number.isNaN(date.getTime())) return 'â€”';
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
    customerPhoneRef.current = formatted; // refë„ ë™ê¸°í™”
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

  // Togo ì£¼ë¬¸ ëª©ë¡ ìƒíƒœ
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
      console.log('[CustomerHistory] fetchCustomerHistoryForSelection called', {
        showTogoOrderModal,
        selection: selection ? { name: selection.name, phone: selection.phone, phoneRaw: selection.phoneRaw } : null
      });
      
      if (!showTogoOrderModal || !selection) {
        console.log('[CustomerHistory] Skipping - modal not open or no selection');
        setCustomerHistoryOrders([]);
        setCustomerHistoryError('');
        setCustomerHistoryLoading(false);
        setSelectedHistoryOrderId(null);
        setHistoryOrderDetail(null);
        return;
      }
      const digits = (selection.phoneRaw || '').replace(/\D/g, '').slice(0, 11);
      const nameTerm = formatNameForDisplay(selection.name).trim();
      console.log('[CustomerHistory] Parsed values:', { digits, digitsLength: digits.length, nameTerm, nameLength: nameTerm.length });
      
      if (digits.length < 2 && nameTerm.length < 2) {
        console.log('[CustomerHistory] Skipping - digits and name too short');
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
        const url = `${API_URL}/orders?${params.toString()}`;
        console.log('[CustomerHistory] Fetching:', url);
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to load customer history.');
        const data = await res.json();
        console.log('[CustomerHistory] API Response:', { success: data.success, ordersCount: data.orders?.length || 0 });
        if (historyFetchIdRef.current !== fetchId) return;
        const orders = Array.isArray(data.orders) ? data.orders : [];
        orders.sort((a: any, b: any) => getOrderTimestamp(b) - getOrderTimestamp(a));
        console.log('[CustomerHistory] Setting customerHistoryOrders:', orders.length, 'orders');
        setCustomerHistoryOrders(orders);
      } catch (error: any) {
        console.error('[CustomerHistory] Error:', error);
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
    // ë¡œì»¬ ìŠ¤í† ë¦¬ì§€ì—ì„œ ìµœì‹  restaurantIdë¥¼ ê°€ì ¸ì˜´
    const currentRestaurantId = localStorage.getItem('firebaseRestaurantId');
    if (!currentRestaurantId) {
      if (onlineOrderRestaurantId) setOnlineOrderRestaurantId(null);
      return;
    }
    
    if (currentRestaurantId !== onlineOrderRestaurantId) {
      setOnlineOrderRestaurantId(currentRestaurantId);
    }
    
    try {
      // ëª¨ë“  ìƒíƒœì˜ ì£¼ë¬¸ì„ ë¶ˆëŸ¬ì˜¤ë˜, cancelled ì œì™¸ (ê²°ì œ ì™„ë£Œëœ completedë„ í¬í•¨)
      const res = await fetch(`${API_URL}/online-orders/${currentRestaurantId}`);
      if (!res.ok) return;
      const json = await res.json();
      const orders = Array.isArray(json.orders) ? json.orders : [];
      
      // ì˜¨ë¼ì¸ ì•±ì—ì„œ ë“¤ì–´ì˜¨ ì£¼ë¬¸ë§Œ í‘œì‹œ (pickup, delivery, online íƒ€ìž…)
      const filteredOrders = orders.filter((o: any) => {
        const orderType = (o.orderType || '').toLowerCase();
        const status = (o.status || '').toLowerCase();
        const customerName = (o.customerName || '').toLowerCase().trim();
        
        // POSì—ì„œ ìƒì„±ëœ ì£¼ë¬¸ ì œì™¸
        if (orderType === 'dine_in' || orderType === 'dine-in') return false;
        if (orderType === 'togo') return false;
        if (orderType === 'pos') return false;
        
        // POS Order ê³ ê°ëª… ì œì™¸
        if (customerName === 'pos order') return false;
        
        // Table Order ì œì™¸
        if (customerName === 'table order' || customerName.startsWith('table ')) return false;
        
        // cancelled ìƒíƒœ ì œì™¸
        if (status === 'cancelled') return false;
        
        // picked_up ìƒíƒœ ì œì™¸ (í”½ì—… ì™„ë£Œëœ ì£¼ë¬¸)
        if (status === 'picked_up') return false;
        
        // merged ìƒíƒœ ì œì™¸ (ì´ë¯¸ ë¨¸ì§€ëœ ì£¼ë¬¸)
        if (status === 'merged') return false;
        
        // completed/paid ìƒíƒœ ì œì™¸ (ì™„ë£Œëœ ì£¼ë¬¸)
        if (status === 'completed' || status === 'paid') return false;
        
        return true;
      });
      
      console.log('[loadOnlineOrders] Filtered orders:', filteredOrders.length);
      
      const mappedCards: OnlineQueueCard[] = filteredOrders.map((o: any, idx: number) => ({
        id: o.id,
        number: o.localOrderId || o.id || String(idx + 1),
        localOrderId: o.localOrderId || null, // SQLite ID ëª…ì‹œì  ì €ìž¥
        time: new Date(o.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
        phone: o.customerPhone || '',
        name: o.customerName || 'Online Order',
        items: (o.items || []).map((it: any) => it.name),
        virtualChannel: 'online',
        virtualTableId: buildVirtualTableCode('online', idx + 1),
        fullOrder: o, // ì „ì²´ ë°ì´í„° ë³´ê´€
        // ì¶”ê°€ í•„ë“œ
        placedTime: o.createdAt,
        // Firebase Timestamp ê°ì²´ë¥¼ Dateë¡œ ë³€í™˜, ì—†ìœ¼ë©´ createdAt + 20ë¶„
        pickupTime: (() => {
          const pt = o.pickupTime || o.readyTime;
          if (pt) {
            if (pt._seconds) return new Date(pt._seconds * 1000);
            if (pt.seconds) return new Date(pt.seconds * 1000);
            const d = new Date(pt);
            if (!isNaN(d.getTime())) return d;
          }
          // pickupTime ì—†ìœ¼ë©´ createdAt + 20ë¶„ìœ¼ë¡œ ê³„ì‚°
          const created = o.createdAt;
          if (created) {
            let createdDate: Date;
            if (created._seconds) createdDate = new Date(created._seconds * 1000);
            else if (created.seconds) createdDate = new Date(created.seconds * 1000);
            else createdDate = new Date(created);
            if (!isNaN(createdDate.getTime())) {
              return new Date(createdDate.getTime() + 20 * 60000); // +20ë¶„
            }
          }
          return null;
        })(),
        total: o.total || 0,
        sequenceNumber: idx + 1,
        status: o.status || 'pending' // Firebaseì—ì„œ ê°€ì ¸ì˜¨ ìƒíƒœ
      }));
      
      // ë””ë²„ê¹…: pickupTime í™•ì¸
      if (mappedCards.length > 0) {
        console.log('[DEBUG] First online order pickupTime:', {
          raw: filteredOrders[0]?.pickupTime,
          parsed: mappedCards[0]?.pickupTime,
          status: filteredOrders[0]?.status
        });
      }
      
      // ìƒˆ ì£¼ë¬¸ ê°ì§€ (pending ìƒíƒœì´ê³  ì´ì „ì— ì—†ë˜ ì£¼ë¬¸)
      const currentOrderIds = filteredOrders.map((o: any) => o.id);
      
      // ì²« ë²ˆì§¸ ë¡œë“œ ì‹œì—ëŠ” ì•ŒëžŒìŒ ìž¬ìƒ ì•ˆí•¨ (íŽ˜ì´ì§€ ì§„ìž… ì‹œ ê¸°ì¡´ ì£¼ë¬¸ë“¤ì´ ìƒˆ ì£¼ë¬¸ìœ¼ë¡œ ì¸ì‹ë˜ëŠ” ê²ƒ ë°©ì§€)
      if (isFirstOnlineOrderLoadRef.current) {
        isFirstOnlineOrderLoadRef.current = false;
        previousOnlineOrdersRef.current = currentOrderIds;
        console.log('[loadOnlineOrders] ì²« ë¡œë“œ ì™„ë£Œ - ê¸°ì¡´ ì£¼ë¬¸ ID ì´ˆê¸°í™”:', currentOrderIds.length, 'ê±´');
        setOnlineQueueCards(mappedCards);
        return;
      }
      
      const pendingOrders = filteredOrders.filter((o: any) => 
        (o.status || 'pending').toLowerCase() === 'pending' &&
        !previousOnlineOrdersRef.current.includes(o.id)
      );
      
      // ìƒˆ ì£¼ë¬¸ ì²˜ë¦¬
      if (pendingOrders.length > 0) {
        const newOrder = pendingOrders[0];
        
        // 🔄 ì•Œë¦¼ìŒì€ OnlineOrderPanelì˜ SSEì—ì„œ ìž¬ìƒë¨ (ì¤‘ë³µ ë°©ì§€)
        console.log('🔄 ìƒˆ ì˜¨ë¼ì¸ ì£¼ë¬¸ ê°ì§€:', newOrder.id);
        
        if (prepTimeSettings.thezoneorder.mode === 'auto') {
          // Auto ëª¨ë“œ: ìžë™ ìˆ˜ë½ (ëª¨ë‹¬ ì—†ìŒ)
          const prepTimeStr = prepTimeSettings.thezoneorder.time || '20m';
          const prepMinutes = parseInt(prepTimeStr.replace('m', '')) || 20;
          const pickupTime = new Date(Date.now() + prepMinutes * 60000).toISOString();
          
          console.log(`[loadOnlineOrders] Auto accepting order: ${newOrder.id}, prepTime: ${prepMinutes}min, pickupTime: ${pickupTime}`);
          
          fetch(`${API_URL}/online-orders/order/${newOrder.id}/accept`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prepTime: prepMinutes, pickupTime })
          }).then(() => {
            console.log('[loadOnlineOrders] Order auto-accepted:', newOrder.id);
          }).catch(err => {
            console.error('[loadOnlineOrders] Auto accept failed:', err);
          });
        } else if (prepTimeSettings.thezoneorder.mode === 'manual' && !showNewOrderAlert) {
          // Manual ëª¨ë“œ: ì•Œë¦¼ ëª¨ë‹¬ í‘œì‹œ
          setNewOrderAlertData(newOrder);
          setSelectedPrepTime(20);
          setShowNewOrderAlert(true);
          console.log('[loadOnlineOrders] New order detected (manual mode):', newOrder.id);
        }
      }
      
      // ì´ì „ ì£¼ë¬¸ ID ëª©ë¡ ì—…ë°ì´íŠ¸
      previousOnlineOrdersRef.current = currentOrderIds;
      
      setOnlineQueueCards(mappedCards);
    } catch (error) {
      console.warn('Failed to load online orders:', error);
    }
  }, [API_URL, onlineOrderRestaurantId, playOnlineOrderSound]);

  useEffect(() => {
    loadOnlineOrders();
    const t = setInterval(loadOnlineOrders, 30000); // 30ì´ˆë§ˆë‹¤ ë°±ì—… ê°±ì‹ 
    return () => clearInterval(t);
  }, [loadOnlineOrders]);

  // Day Off ë°ì´í„° ë¡œë“œ
  const loadDayOffDates = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/online-orders/day-off`);
      if (response.ok) {
        const data = await response.json();
        if (data.success && Array.isArray(data.dayOffs)) {
          setDayOffDates(data.dayOffs.map((d: any) => ({ 
            date: d.date, 
            channels: d.channels || 'all',
            type: d.type || 'closed'
          })));
        }
      }
    } catch (error) {
      console.warn('Failed to load day off dates:', error);
    }
  }, [API_URL]);

  useEffect(() => {
    loadDayOffDates();
  }, [loadDayOffDates]);

  // Day Off ë‚ ì§œ ì„ íƒ í† ê¸€ (UIìš© - ì•„ì§ ì €ìž¥ ì•ˆí•¨)
  const toggleDayOffSelection = (dateStr: string) => {
    setDayOffSaveStatus('idle'); // ë³€ê²½ ì‹œ ìƒíƒœ ë¦¬ì…‹
    setDayOffSelectedDates(prev => {
      if (prev.includes(dateStr)) {
        return prev.filter(d => d !== dateStr);
      } else {
        return [...prev, dateStr].sort();
      }
    });
  };

  // Day Off ì±„ë„ ì„ íƒ í† ê¸€
  const toggleDayOffChannel = (channel: string) => {
    setDayOffSaveStatus('idle'); // ë³€ê²½ ì‹œ ìƒíƒœ ë¦¬ì…‹
    if (channel === 'all') {
      // All Channels í† ê¸€: ì´ë¯¸ allì´ë©´ í•´ì œ, ì•„ë‹ˆë©´ all ì„ íƒ
      setDayOffSelectedChannels(prev => {
        if (prev.includes('all')) {
          return []; // ì „ì²´ í•´ì œ
        } else {
          return ['all']; // ì „ì²´ ì„ íƒ
        }
      });
    } else {
      setDayOffSelectedChannels(prev => {
        const newChannels = prev.filter(c => c !== 'all');
        if (newChannels.includes(channel)) {
          return newChannels.filter(c => c !== channel);
        } else {
          return [...newChannels, channel];
        }
      });
    }
  };

  // Day Off ì €ìž¥ (ì„ íƒëœ ë‚ ì§œë“¤ ì €ìž¥) - Firebase ë™ê¸°í™” í¬í•¨
  const saveDayOffs = async () => {
    // ì €ìž¥í•  ë‚ ì§œê°€ ì—†ê±°ë‚˜ ì´ë¯¸ ì €ìž¥ ì¤‘ì´ë©´ ë¬´ì‹œ
    if (dayOffSelectedDates.length === 0) {
      console.log('[Day Off] No dates selected');
      return;
    }
    if (dayOffSaveStatus === 'saving') {
      console.log('[Day Off] Already saving...');
      return;
    }

    const restaurantId = localStorage.getItem('firebaseRestaurantId');
    console.log('[Day Off] Saving...', dayOffSelectedDates, dayOffSelectedChannels, dayOffType, 'restaurantId:', restaurantId);
    setDayOffSaveStatus('saving');
    
    const channelsStr = dayOffSelectedChannels.length === 0 || dayOffSelectedChannels.includes('all')
      ? 'all'
      : dayOffSelectedChannels.join(',');

    try {
      const res = await fetch(`${API_URL}/online-orders/day-off/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dates: dayOffSelectedDates,
          channels: channelsStr,
          type: dayOffType,
          restaurantId: restaurantId || undefined
        })
      });
      
      const data = await res.json();
      console.log('[Day Off] Response:', data);
      
      if (res.ok && data.success) {
        await loadDayOffDates();
        // ì €ìž¥ í›„ ì„ íƒëœ ë‚ ì§œ ì´ˆê¸°í™” (ë‹¬ë ¥ì— ì €ìž¥ëœ ìƒíƒœë¡œ í‘œì‹œ)
        setDayOffSelectedDates([]);
        setDayOffSaveStatus('saved');
        console.log('[Day Off] Save successful! (synced to Firebase)');
        // 3ì´ˆ í›„ saved ìƒíƒœ ì´ˆê¸°í™”
        setTimeout(() => setDayOffSaveStatus('idle'), 3000);
      } else {
        console.error('[Day Off] Save failed:', data);
        setDayOffSaveStatus('idle');
      }
    } catch (err) {
      console.error('[Day Off] Save error:', err);
      setDayOffSaveStatus('idle');
    }
  };

  // Day Off ì‚­ì œ - Firebase ë™ê¸°í™” í¬í•¨
  const removeDayOff = async (dateStr: string) => {
    try {
      const restaurantId = localStorage.getItem('firebaseRestaurantId');
      const url = restaurantId 
        ? `${API_URL}/online-orders/day-off/${dateStr}?restaurantId=${restaurantId}`
        : `${API_URL}/online-orders/day-off/${dateStr}`;
      
      const res = await fetch(url, { method: 'DELETE' });
      if (res.ok) {
        setDayOffDates(prev => prev.filter(d => d.date !== dateStr));
        setDayOffSaveStatus('idle'); // ì‚­ì œ ì‹œ ìƒíƒœ ë¦¬ì…‹
        console.log('[Day Off] Removed:', dateStr, '(synced to Firebase)');
      }
    } catch (err) {
      console.error('Day off remove error:', err);
    }
  };

  // ===== Menu Hide íƒ­ ê¸°ëŠ¥ =====
  // ì¹´í…Œê³ ë¦¬ ëª©ë¡ ë¡œë“œ
  const loadMenuHideCategories = useCallback(async () => {
    try {
      setMenuHideLoading(true);
      // defaultMenuì—ì„œ menuId ê°€ì ¸ì˜¤ê¸°
      const menuId = defaultMenu.menuId || localStorage.getItem('menuId') || '200005';
      const response = await fetch(`${API_URL}/menu-visibility/categories?menu_id=${menuId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setMenuHideCategories(data.categories);
        }
      }
    } catch (error) {
      console.error('Failed to load menu hide categories:', error);
    } finally {
      setMenuHideLoading(false);
    }
  }, [API_URL, defaultMenu.menuId]);

  // ì¹´í…Œê³ ë¦¬ë³„ ì•„ì´í…œ ë¡œë“œ
  const loadMenuHideItems = useCallback(async (categoryId: string) => {
    try {
      setMenuHideLoading(true);
      const response = await fetch(`${API_URL}/menu-visibility/items/${categoryId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setMenuHideItems(data.items);
        }
      }
    } catch (error) {
      console.error('Failed to load menu hide items:', error);
    } finally {
      setMenuHideLoading(false);
    }
  }, [API_URL]);

  // ì•„ì´í…œ visibility í† ê¸€
  const toggleItemVisibility = async (itemId: string, field: 'online_visible' | 'delivery_visible') => {
    const item = menuHideItems.find(i => i.item_id === itemId);
    if (!item) return;
    
    const newValue = field === 'online_visible' 
      ? (item.online_visible === 1 ? 0 : 1)
      : (item.delivery_visible === 1 ? 0 : 1);
    
    // Optimistic update
    setMenuHideItems(prev => prev.map(i => 
      i.item_id === itemId ? { ...i, [field]: newValue } : i
    ));
    
    try {
      const response = await fetch(`${API_URL}/menu-visibility/item/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: newValue })
      });
      
      if (response.ok) {
        // ì¹´í…Œê³ ë¦¬ ëª©ë¡ ìƒˆë¡œê³ ì¹¨ (hidden count ì—…ë°ì´íŠ¸)
        loadMenuHideCategories();
      } else {
        // Rollback on failure
        setMenuHideItems(prev => prev.map(i => 
          i.item_id === itemId ? { ...i, [field]: item[field] } : i
        ));
      }
    } catch (error) {
      console.error('Failed to toggle item visibility:', error);
      // Rollback on error
      setMenuHideItems(prev => prev.map(i => 
        i.item_id === itemId ? { ...i, [field]: item[field] } : i
      ));
    }
  };

  // ì¹´í…Œê³ ë¦¬ ì „ì²´ í† ê¸€
  const toggleCategoryVisibility = async (categoryId: string, field: 'online_visible' | 'delivery_visible', value: number) => {
    try {
      const response = await fetch(`${API_URL}/menu-visibility/category/${categoryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value })
      });
      
      if (response.ok) {
        // í˜„ìž¬ ì¹´í…Œê³ ë¦¬ê°€ ì„ íƒë˜ì–´ ìžˆìœ¼ë©´ ì•„ì´í…œ ë¦¬ìŠ¤íŠ¸ ìƒˆë¡œê³ ì¹¨
        if (menuHideSelectedCategory === categoryId) {
          loadMenuHideItems(categoryId);
        }
        loadMenuHideCategories();
      }
    } catch (error) {
      console.error('Failed to toggle category visibility:', error);
    }
  };

  // Menu Hide íƒ­ ì—´ë¦´ ë•Œ ì¹´í…Œê³ ë¦¬ ë¡œë“œ
  useEffect(() => {
    if (onlineModalTab === 'menuhide' && showPrepTimeModal) {
      loadMenuHideCategories();
      setMenuHideSelectedCategory(null);
      setMenuHideItems([]);
    }
  }, [onlineModalTab, showPrepTimeModal, loadMenuHideCategories]);

  // ì¹´í…Œê³ ë¦¬ ì„ íƒ ì‹œ ì•„ì´í…œ ë¡œë“œ
  useEffect(() => {
    if (menuHideSelectedCategory) {
      loadMenuHideItems(menuHideSelectedCategory);
    }
  }, [menuHideSelectedCategory, loadMenuHideItems]);

  // SSE ì‹¤ì‹œê°„ í‘¸ì‹œ ì—°ê²° - ìƒˆ ì£¼ë¬¸ ì¦‰ì‹œ ê°ì§€
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
            // ìƒˆ ì£¼ë¬¸ í‘¸ì‹œ ìˆ˜ì‹ 
            const newOrder = data.order;
            console.log('[SSE] New order received:', newOrder.id);

            if (prepTimeSettings.thezoneorder.mode === 'auto') {
              // Auto ëª¨ë“œ: ìžë™ìœ¼ë¡œ ìˆ˜ë½ (ëª¨ë‹¬ ì—†ìŒ)
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
              // Manual ëª¨ë“œ: ì•Œë¦¼ ëª¨ë‹¬ í‘œì‹œ
              setNewOrderAlertData(newOrder);
              setSelectedPrepTime(20);
              setShowNewOrderAlert(true);
            }

            // ëª©ë¡ ì¦‰ì‹œ ê°±ì‹ 
            loadOnlineOrders();
          } else if (data.type === 'order_updated') {
            // ì£¼ë¬¸ ìƒíƒœ ë³€ê²½ ì‹œ ëª©ë¡ ê°±ì‹ 
            loadOnlineOrders();
          }
        } catch (error) {
          console.warn('[SSE] Parse error:', error);
        }
      };

      eventSource.onerror = (error) => {
        console.warn('[SSE] Connection error, reconnecting in 5s...', error);
        eventSource?.close();
        // 5ì´ˆ í›„ ìž¬ì—°ê²°
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
      // PENDINGê³¼ PAID ìƒíƒœ ëª¨ë‘ ë¶ˆëŸ¬ì˜¤ê¸° (PICKED_UPì€ ì œì™¸) - TOGO + DELIVERY
      const [togoOpenRes, togoPendingRes, togoPaidRes, deliveryOpenRes, deliveryPendingRes, deliveryPaidRes, deliveryOrdersRes] = await Promise.all([
        fetch(`${API_URL}/orders?type=TOGO&status=OPEN&limit=50`),
        fetch(`${API_URL}/orders?type=TOGO&status=PENDING&limit=50`),
        fetch(`${API_URL}/orders?type=TOGO&status=PAID&limit=50`),
        fetch(`${API_URL}/orders?type=DELIVERY&status=OPEN&limit=50`),
        fetch(`${API_URL}/orders?type=DELIVERY&status=PENDING&limit=50`),
        fetch(`${API_URL}/orders?type=DELIVERY&status=PAID&limit=50`),
        fetch(`${API_URL}/orders/delivery-orders`), // delivery_orders í…Œì´ë¸”ì—ì„œë„ ë¶ˆëŸ¬ì˜¤ê¸°
      ]);
      
      const togoOpenJson = togoOpenRes.ok ? await togoOpenRes.json() : { orders: [] };
      const togoPendingJson = togoPendingRes.ok ? await togoPendingRes.json() : { orders: [] };
      const togoPaidJson = togoPaidRes.ok ? await togoPaidRes.json() : { orders: [] };
      const deliveryOpenJson = deliveryOpenRes.ok ? await deliveryOpenRes.json() : { orders: [] };
      const deliveryPendingJson = deliveryPendingRes.ok ? await deliveryPendingRes.json() : { orders: [] };
      const deliveryPaidJson = deliveryPaidRes.ok ? await deliveryPaidRes.json() : { orders: [] };
      const deliveryOrdersJson = deliveryOrdersRes.ok ? await deliveryOrdersRes.json() : { orders: [] };
      
      const togoOpenOrders = Array.isArray(togoOpenJson.orders) ? togoOpenJson.orders : [];
      const togoPendingOrders = Array.isArray(togoPendingJson.orders) ? togoPendingJson.orders : [];
      const togoPaidOrders = Array.isArray(togoPaidJson.orders) ? togoPaidJson.orders : [];
      const deliveryOpenOrders = Array.isArray(deliveryOpenJson.orders) ? deliveryOpenJson.orders : [];
      const deliveryPendingOrders = Array.isArray(deliveryPendingJson.orders) ? deliveryPendingJson.orders : [];
      const deliveryPaidOrders = Array.isArray(deliveryPaidJson.orders) ? deliveryPaidJson.orders : [];
      const deliveryMetaOrders = Array.isArray(deliveryOrdersJson.orders) ? deliveryOrdersJson.orders : [];
      
      // ë””ë²„ê·¸ ë¡œê·¸
      console.log('ðŸš— [loadTogoOrders] deliveryPendingOrders:', deliveryPendingOrders.length);
      console.log('ðŸš— [loadTogoOrders] deliveryPaidOrders:', deliveryPaidOrders.length);
      console.log('ðŸš— [loadTogoOrders] deliveryMetaOrders:', deliveryMetaOrders.length, deliveryMetaOrders);
      
      // ë‘ ëª©ë¡ í•©ì¹˜ê¸° (ì¤‘ë³µ ì œê±°)
      const orderMap = new Map();
      [...togoOpenOrders, ...togoPendingOrders, ...togoPaidOrders, ...deliveryOpenOrders, ...deliveryPendingOrders, ...deliveryPaidOrders].forEach(o => orderMap.set(o.id, o));
      
      // orders í…Œì´ë¸”ì˜ delivery ì£¼ë¬¸ì—ì„œ table_idë¡œ delivery_orders.id ë§¤í•‘ ìƒì„±
      // table_id = "DL" + delivery_orders.id í˜•ì‹
      const tableIdToOrderId = new Map();
      [...deliveryOpenOrders, ...deliveryPendingOrders, ...deliveryPaidOrders].forEach((o: any) => {
        if (o.table_id && String(o.table_id).startsWith('DL')) {
          const deliveryMetaId = String(o.table_id).substring(2); // "DL" ì œê±°
          tableIdToOrderId.set(deliveryMetaId, o.id);
          console.log('ðŸš— [loadTogoOrders] table_id mapping:', o.table_id, '->', o.id);
        }
      });
      
      // delivery_orders í…Œì´ë¸”ì˜ ë©”íƒ€ë°ì´í„° ë³‘í•© (deliveryCompany, deliveryOrderNumber ë“±)
      deliveryMetaOrders.forEach((meta: any) => {
        // 1ìˆœìœ„: order_idë¡œ ë§¤ì¹­
        // 2ìˆœìœ„: table_idì—ì„œ ì¶”ì¶œí•œ ë§¤í•‘ìœ¼ë¡œ ë§¤ì¹­
        // 3ìˆœìœ„: meta.idë¡œ ì§ì ‘ ë§¤ì¹­
        const metaIdStr = String(meta.id);
        const mappedOrderId = tableIdToOrderId.get(metaIdStr);
        const matchId = meta.order_id || mappedOrderId || meta.id;
        const existing = orderMap.get(matchId);
        
        console.log('ðŸš— [loadTogoOrders] Matching meta:', meta.id, 'order_id:', meta.order_id, 'mappedOrderId:', mappedOrderId, 'matchId:', matchId, 'found:', !!existing);
        
        if (existing) {
          // ê¸°ì¡´ ì£¼ë¬¸ì— delivery ë©”íƒ€ë°ì´í„° ì¶”ê°€
          existing.deliveryCompany = meta.delivery_company || meta.deliveryCompany;
          existing.deliveryOrderNumber = meta.delivery_order_number || meta.deliveryOrderNumber;
          existing.readyTimeLabel = meta.ready_time_label || meta.readyTimeLabel || existing.readyTimeLabel;
          existing.prepTime = meta.prep_time || meta.prepTime;
          existing.fulfillment_mode = 'delivery';
          existing.fulfillment = 'delivery';
          existing.order_id = existing.id; // orders í…Œì´ë¸”ì˜ id ì €ìž¥
          existing.deliveryMetaId = meta.id; // delivery_orders í…Œì´ë¸”ì˜ id ì €ìž¥
        } else {
          // delivery_ordersì—ë§Œ ìžˆëŠ” ì£¼ë¬¸ (ì•„ì§ OK ì•ˆ ëˆ„ë¥¸ ì£¼ë¬¸)
          orderMap.set(meta.id, {
            id: meta.id,
            order_id: meta.order_id || null, // orders í…Œì´ë¸”ê³¼ ì—°ê²°ëœ id
            type: 'Delivery',
            status: meta.status || 'pending',
            created_at: meta.created_at || meta.createdAt,
            customer_name: meta.name,
            deliveryCompany: meta.delivery_company || meta.deliveryCompany,
            deliveryOrderNumber: meta.delivery_order_number || meta.deliveryOrderNumber,
            ready_time: meta.ready_time_label || meta.readyTimeLabel,
            readyTimeLabel: meta.ready_time_label || meta.readyTimeLabel,
            fulfillment_mode: 'delivery',
            fulfillment: 'delivery',  // í•„í„°ë§ìš© ì¶”ê°€
            prepTime: meta.prep_time || meta.prepTime,
          });
        }
      });
      
      const allOrders = Array.from(orderMap.values());
      
      // PICKED_UP ìƒíƒœë§Œ ì œì™¸ (Pickup Complete ëœ ê²ƒë§Œ ì œì™¸)
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
          order_id: o.order_id || null, // orders í…Œì´ë¸”ì˜ ì‹¤ì œ id (delivery ì£¼ë¬¸ì—ì„œ items ì¡°íšŒìš©)
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
          readyTimeLabel: o.readyTimeLabel || readyTimeLabel,
          virtualTableId: apiVirtualId || null,
          virtualChannel,
          // Delivery ì „ìš© í•„ë“œ
          deliveryCompany: o.deliveryCompany || o.delivery_company || '',
          deliveryOrderNumber: o.deliveryOrderNumber || o.delivery_order_number || '',
          prepTime: o.prepTime || o.prep_time || 0,
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
        
        // ë””ë²„ê·¸ ë¡œê·¸: ë”œë¦¬ë²„ë¦¬ ì£¼ë¬¸ í™•ì¸
        const deliveryOrders = normalizedOrders.filter((o: any) => 
          String(o.fulfillment || '').toLowerCase() === 'delivery' ||
          String(o.type || '').toLowerCase() === 'delivery' ||
          o.deliveryCompany
        );
        console.log('ðŸš— [loadTogoOrders] Final deliveryOrders:', deliveryOrders.length, deliveryOrders);
        
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
            onlineOrder: order.fullOrder || order, // ì „ì²´ ì£¼ë¬¸ ë°ì´í„° ì „ë‹¬
          },
        });
      }
    },
    [defaultMenu.menuId, defaultMenu.menuName, navigate, togoOrderMeta]
  );

  const handleVirtualOrderCardClick = useCallback(
    async (channel: VirtualOrderChannel, order: any) => {
      console.log('[handleVirtualOrderCardClick] Called:', { channel, orderId: order?.id, isMoveMergeMode, sourceTableId, sourceTogoOrder, selectionChoice });
      
      // Move/Merge ëª¨ë“œì¼ ë•Œ
      if (isMoveMergeMode) {
        // 1. í…Œì´ë¸” → Togo ë¨¸ì§€ (sourceTableIdê°€ ì„¤ì •ë¨)
        if (sourceTableId && selectionChoice) {
          console.log('[handleVirtualOrderCardClick] Table to Togo merge');
          const targetLabel = channel === 'togo' 
            ? `Togo #${order.id}` 
            : `Online #${order.number ?? order.id}`;
          
          try {
            setMoveMergeStatus(`🔄 Merging to ${targetLabel}...`);
            
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
              
              setMoveMergeStatus(result.message || `âœ… Merged to ${targetLabel}`);
              setTimeout(() => setMoveMergeStatus(''), 800);
            } else {
              setMoveMergeStatus(`âŒ Merge failed: ${result.error || result.details || 'Unknown error'}`);
              setTimeout(() => {
                setSourceTableId(null);
                setMoveMergeStatus('');
                clearMoveMergeSelection();
              }, 3000);
            }
          } catch (error: any) {
            console.error('Merge to Togo error:', error);
            setMoveMergeStatus(`âŒ Error: ${error.message}`);
            setTimeout(() => {
              setSourceTableId(null);
              setMoveMergeStatus('');
              clearMoveMergeSelection();
            }, 3000);
          }
          return;
        }
        
        // 2. Togo → Togo ë¨¸ì§€ (sourceTogoOrderê°€ ì„¤ì •ë¨)
        if (sourceTogoOrder) {
          // ê°™ì€ Togo ì„ íƒ ë°©ì§€
          if (sourceTogoOrder.id === order.id) {
            setMoveMergeStatus('âŒ Cannot select the same Togo.');
            setTimeout(() => setMoveMergeStatus('âœ“ Select destination Togo'), 1500);
            return;
          }
          
          // ë”ë¸” í´ë¦­ ë°©ì§€
          if (isMergeInProgress) {
            console.log('[handleVirtualOrderCardClick] Merge already in progress, ignoring');
            return;
          }
          
          console.log('[handleVirtualOrderCardClick] Togo to Togo merge');
          const sourceLabel = `Togo #${sourceTogoOrder.id}`;
          const targetLabel = `Togo #${order.id}`;
          
          try {
            setIsMergeInProgress(true);
            setMoveMergeStatus(`🔄 Merging ${sourceLabel} → ${targetLabel}...`);
            
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
              setIsMergeInProgress(false);
              clearMoveMergeSelection();
              loadTogoOrders();
              
              setMoveMergeStatus(result.message || `âœ… Merged ${sourceLabel} → ${targetLabel}`);
              setTimeout(() => setMoveMergeStatus(''), 800);
            } else {
              setIsMergeInProgress(false);
              setMoveMergeStatus(`âŒ Merge failed: ${result.error || result.details || 'Unknown error'}`);
              setTimeout(() => {
                setSourceTogoOrder(null);
                setMoveMergeStatus('');
                clearMoveMergeSelection();
              }, 3000);
            }
          } catch (error: any) {
            setIsMergeInProgress(false);
            console.error('Togo to Togo merge error:', error);
            setMoveMergeStatus(`âŒ Error: ${error.message}`);
            setTimeout(() => {
              setSourceTogoOrder(null);
              setMoveMergeStatus('');
              clearMoveMergeSelection();
            }, 3000);
          }
          return;
        }
        
        // 3. Online → Togo ë¨¸ì§€ (sourceOnlineOrderê°€ ì„¤ì •ë¨)
        if (sourceOnlineOrder && channel === 'togo') {
          // ë”ë¸” í´ë¦­ ë°©ì§€
          if (isMergeInProgress) {
            console.log('[handleVirtualOrderCardClick] Merge already in progress, ignoring');
            return;
          }
          
          console.log('[handleVirtualOrderCardClick] Online to Togo merge');
          const sourceLabel = `Online #${sourceOnlineOrder.number ?? sourceOnlineOrder.id}`;
          const targetLabel = `Togo #${order.id}`;
          
          // Online ì£¼ë¬¸ì€ localOrderId (SQLite ID) ì‚¬ìš©
          // ìš°ì„ ìˆœìœ„: localOrderId > fullOrder.localOrderId > number (ìˆ«ìžì¸ ê²½ìš°) > id
          const sourceOrderId = sourceOnlineOrder.localOrderId || 
            sourceOnlineOrder.fullOrder?.localOrderId || 
            (typeof sourceOnlineOrder.number === 'number' ? sourceOnlineOrder.number : null) ||
            sourceOnlineOrder.id;
          
          console.log('[handleVirtualOrderCardClick] Online sourceOrderId:', sourceOrderId,
            'localOrderId:', sourceOnlineOrder.localOrderId,
            'fullOrder.localOrderId:', sourceOnlineOrder.fullOrder?.localOrderId);
          
          try {
            setIsMergeInProgress(true);
            setMoveMergeStatus(`🔄 Merging ${sourceLabel} → ${targetLabel}...`);
            
            const response = await fetch(`${API_URL}/table-operations/merge-togo-to-togo`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fromOrderId: sourceOrderId,
                toOrderId: order.id,
              }),
            });
            
            const result = await response.json();
            
            if (response.ok && result.success) {
              setSourceOnlineOrder(null);
              setIsMoveMergeMode(false);
              setIsMergeInProgress(false);
              clearMoveMergeSelection();
              loadTogoOrders();
              loadOnlineOrders(); // ì˜¨ë¼ì¸ ì£¼ë¬¸ ëª©ë¡ ìƒˆë¡œê³ ì¹¨
              
              setMoveMergeStatus(result.message || `âœ… Merged ${sourceLabel} → ${targetLabel}`);
              setTimeout(() => setMoveMergeStatus(''), 800);
            } else {
              setIsMergeInProgress(false);
              setMoveMergeStatus(`âŒ Merge failed: ${result.error || result.details || 'Unknown error'}`);
              setTimeout(() => {
                setSourceOnlineOrder(null);
                setMoveMergeStatus('');
                clearMoveMergeSelection();
              }, 3000);
            }
          } catch (error: any) {
            setIsMergeInProgress(false);
            console.error('Online to Togo merge error:', error);
            setMoveMergeStatus(`âŒ Error: ${error.message}`);
            setTimeout(() => {
              setSourceOnlineOrder(null);
              setMoveMergeStatus('');
              clearMoveMergeSelection();
            }, 3000);
          }
          return;
        }
        
        // 4. ì¶œë°œ ì„ íƒ (sourceTableId, sourceTogoOrder, sourceOnlineOrder ëª¨ë‘ ì—†ëŠ” ê²½ìš°)
        if (!sourceTableId && !sourceTogoOrder && !sourceOnlineOrder) {
          if (channel === 'togo') {
            const sourceLabel = `Togo #${order.id}`;
            setSourceTogoOrder(order);
            setMoveMergeStatus(`âœ“ Source: ${sourceLabel} → Select destination Togo`);
          } else if (channel === 'online') {
            const sourceLabel = `Online #${order.number ?? order.id}`;
            setSourceOnlineOrder(order);
            setMoveMergeStatus(`âœ“ Source: ${sourceLabel} → Select destination Togo`);
          }
          return;
        }
      }
      
      // Move/Merge ëª¨ë“œê°€ ì•„ë‹ ë•Œ: ëª¨ë‹¬ ì—´ê¸°
      // Togo ë˜ëŠ” Delivery ì£¼ë¬¸ì¸ ê²½ìš° ìƒì„¸ ì •ë³´(items) ê°€ì ¸ì˜¤ê¸°
      if ((channel === 'togo' || channel === 'delivery') && order.id) {
        try {
          // Delivery ì£¼ë¬¸ì€ order_id ì‚¬ìš©
          const actualOrderId = channel === 'delivery' ? (order.order_id || order.id) : order.id;
          const res = await fetch(`${API_URL}/orders/${actualOrderId}`);
          if (res.ok) {
            const data = await res.json();
            if (data.success && data.items) {
              // fullOrder í˜•íƒœë¡œ ë³€í™˜í•˜ì—¬ ì €ìž¥
              const parsedItems = data.items.map((item: any) => {
                let options: any[] = [];
                let totalModifierPrice = 0;
                try {
                  if (item.modifiers_json) {
                    const mods = typeof item.modifiers_json === 'string' 
                      ? JSON.parse(item.modifiers_json) 
                      : item.modifiers_json;
                    options = Array.isArray(mods) ? mods : [];
                    // Calculate totalModifierPrice
                    options.forEach((modGroup: any) => {
                      if (modGroup.totalModifierPrice) {
                        totalModifierPrice += Number(modGroup.totalModifierPrice);
                      } else if (modGroup.selectedEntries) {
                        modGroup.selectedEntries.forEach((entry: any) => {
                          totalModifierPrice += Number(entry.price_delta || entry.price || 0);
                        });
                      }
                    });
                  }
                } catch {}
                return {
                  ...item,
                  name: item.name,
                  quantity: item.quantity || 1,
                  price: item.price || 0,
                  options,
                  totalModifierPrice,
                  taxDetails: item.taxDetails || []
                };
              });
              // DB subtotal ì‚¬ìš©, ì—†ìœ¼ë©´ ì•„ì´í…œ í•©ê³„ë¡œ ê³„ì‚°
              const calculatedSubtotal = parsedItems.reduce((sum: number, item: any) => 
                sum + ((item.price + (item.totalModifierPrice || 0)) * item.quantity), 0);
              
              const fullOrder = {
                ...order,
                status: data.order?.status || order.status,
                paymentStatus: data.order?.paymentStatus || order.paymentStatus,
                items: parsedItems,
                subtotal: data.order?.subtotal || calculatedSubtotal,
                tax: data.order?.tax || 0,
                taxBreakdown: data.order?.tax_breakdown ? JSON.parse(data.order.tax_breakdown) : null,
                total: data.order?.total || order.total || 0
              };
              setSelectedOrderDetail({ ...order, fullOrder });
              setSelectedOrderType(channel);
              setShowOrderDetailModal(true);
              return;
            }
          }
        } catch (e) {
          console.warn(`Failed to load ${channel} order details:`, e);
        }
      }
      setSelectedOrderDetail(order);
      setSelectedOrderType(channel);
      setShowOrderDetailModal(true);
    },
    [isMoveMergeMode, sourceTableId, sourceTogoOrder, sourceOnlineOrder, selectionChoice, selectedFloor, loadTogoOrders, clearMoveMergeSelection, API_URL]
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
        // ë‹¤ì–‘í•œ í•„ë“œëª… ì§€ì› (customer_phone, customerPhone, phoneRaw, phone)
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
        message: `${label} · -${formatCurrency(totalBenefit)}`,
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
        // 1ìžë¦¬ë¶€í„° ê²€ìƒ‰ ì‹œìž‘
        if (digits.length < 1) {
          setCustomerSuggestions([]);
          setCustomerSuggestionSource(null);
          setSelectedCustomerHistory(null);
          resetCustomerHistoryView();
          return;
        }
        
        // ë¡œì»¬ ê²€ìƒ‰ (togoOrdersì—ì„œ) - ë™ê¸°ì ìœ¼ë¡œ ì²˜ë¦¬
        const localMatches = buildCustomerSuggestionOrders((order) => {
          const rawPhone = order.customer_phone || order.customerPhone || order.phoneRaw || order.phone || '';
          const orderDigits = normalizePhoneDigits(rawPhone);
          return orderDigits.startsWith(digits);
        });
        
        // ê²°ê³¼ ì¦‰ì‹œ í‘œì‹œ
        setCustomerSuggestions(localMatches);
        setCustomerSuggestionSource(localMatches.length > 0 ? 'phone' : null);
        setSelectedCustomerHistory(null);
        resetCustomerHistoryView();
        return;
      }
      const formattedName = formatNameForDisplay(value);
      const lowered = formattedName.toLowerCase();
      // ì´ë¦„ë„ 1ê¸€ìžë¶€í„° ê²€ìƒ‰ (ê¸°ì¡´ 2ê¸€ìž ì œí•œ í•´ì œ)
      if (lowered.replace(/\s+/g, '').length < 1) {
        customerSuggestionFetchIdRef.current += 1;
        clearCustomerSuggestions();
        setSelectedCustomerHistory(null);
        resetCustomerHistoryView();
        return;
      }
      const localMatches = buildCustomerSuggestionOrders((order) => {
        // ë‹¤ì–‘í•œ í•„ë“œëª… ì§€ì› (customer_name, customerName, name)
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
    // ë“œë¡­ë‹¤ìš´ ìˆ¨ê¸°ê¸° ë¹„í™œì„±í™” - ì‚¬ìš©ìžê°€ ì„ íƒí•˜ê±°ë‚˜ ëª¨ë‹¬ ë‹«ì„ ë•Œë§Œ ìˆ¨ê¹€
    // if (suggestionHideTimeoutRef.current) {
    //   clearTimeout(suggestionHideTimeoutRef.current);
    // }
    // suggestionHideTimeoutRef.current = setTimeout(() => {
    //   clearCustomerSuggestions();
    // }, 120);
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
  // ì „í™”ë²ˆí˜¸ ìž…ë ¥ ì‹œ ë¬´ì¡°ê±´ ì¼ì¹˜í•˜ëŠ” ê³ ê° í‘œì‹œ
  const renderCustomerSuggestionList = (source: 'phone' | 'name') => {
    // ê°„ë‹¨í•˜ê²Œ: ê²°ê³¼ê°€ ìžˆìœ¼ë©´ ë¬´ì¡°ê±´ í‘œì‹œ
    if (customerSuggestions.length === 0) return null;
    if (source === 'name' && customerSuggestionSource === 'phone') return null;
    if (source === 'phone' && customerSuggestionSource === 'name') return null;
    
    return (
      <div 
        className="absolute left-0 right-0 mt-1 rounded-xl border border-slate-200 bg-white shadow-2xl max-h-60 overflow-y-auto"
        style={{ zIndex: 99999, top: '100%' }}
      >
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
      const orderResult = await response.json();
      
      // Kitchen Ticket ì¶œë ¥ (Ticket for Take-out ë ˆì´ì•„ì›ƒ ì‚¬ìš©)
      try {
        const orderTypeForPrint = orderTypeRaw === 'DELIVERY' ? 'DELIVERY' : 'TOGO';
        // ì‹¤ì œ ì£¼ë¬¸ ë²ˆí˜¸ ì‚¬ìš© (#1043 í˜•ì‹)
        const actualOrderNumber = orderResult.orderId || orderResult.id || newOrderNumber;
        const printPayload = {
          orderInfo: {
            orderId: actualOrderNumber,
            orderNumber: `#${actualOrderNumber}`,
            orderType: orderTypeForPrint,
            channel: orderTypeForPrint,
            orderSource: orderTypeForPrint,
            readyTime: payload.readyTime,
            pickupTime: payload.readyTime,
            customerName: payload.customerName,
            customerPhone: payload.customerPhone,
          },
          items: itemsPayload.map((item: any) => ({
            id: item.id,
            name: item.name,
            quantity: item.quantity,
            modifiers: item.modifiers,
            memo: item.memo,
          })),
        };
        
        console.log('ðŸ–¨ï¸ [Reorder] Printing Kitchen Ticket:', printPayload);
        await printKitchenTicket(printPayload, 1);
        
        // Bill 출력
        const subtotal = itemsPayload.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0);
        const billData = {
          storeName: '',
          orderNumber: `#${actualOrderNumber}`,
          orderType: orderTypeForPrint,
          channel: orderTypeForPrint,
          customerName: payload.customerName || '',
          customerPhone: payload.customerPhone || '',
          pickupTime: payload.readyTime || '',
          items: itemsPayload.map((item: any) => ({
            name: item.name,
            quantity: item.quantity,
            price: item.price,
            modifiers: item.modifiers || [],
            memo: item.memo || null,
          })),
          guestSections: [],
          subtotal: subtotal,
          taxLines: [],
          total: subtotal,
          adjustments: [],
          footer: {},
        };
        
        console.log('🧾 [Reorder] Printing Bill:', billData);
        await printBill(billData, 1);
      } catch (printError) {
        console.warn('Kitchen Ticket/Bill print failed (ignored):', printError);
      }
      
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
      // Move/Merge ëª¨ë“œì¼ ë•ŒëŠ” 'New Togo'ë¥¼ íƒ€ê²Ÿìœ¼ë¡œ ì„ íƒí•  ìˆ˜ ì—†ë„ë¡ ë§‰ìŒ (ìš”ì²­ì‚¬í•­)
      setMoveMergeStatus('âŒ Cannot move to New Togo (Not supported)');
      setTimeout(() => setMoveMergeStatus(''), 2000);
      return;
    }

    setTogoOrderMode('togo');
    setServerModalError('');
    setCustomerZip('');
    if (shouldPromptServerSelection) {
      setSelectedTogoServer(null);
      setShowServerSelectionModal(true);
    } else {
      startTogoOrderFlow(null);
    }
  };

  const handleNewDeliveryClick = () => {
    if (isMoveMergeMode) {
      setMoveMergeStatus('âŒ Cannot create new Delivery in Move/Merge mode');
      setTimeout(() => setMoveMergeStatus(''), 2000);
      return;
    }
    // Delivery ì „ìš© ëª¨ë‹¬ ì—´ê¸°
    setDeliveryCompany('');
    setDeliveryOrderNumber('');
    setShowDeliveryOrderModal(true);
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

  // ìš”ì†Œ í‘œì‹œ ì´ë¦„ ê²°ì • í•¨ìˆ˜ (ë°±ì˜¤í”¼ìŠ¤ì™€ ë™ì¼)
  const getElementDisplayName = (element: TableElement) => {
    switch (element.type) {
      case 'rounded-rectangle':
      case 'circle':
        // ì €ìž¥ëœ ì´ë¦„ ìš°ì„  ì‚¬ìš©, ì—†ìœ¼ë©´ T{id}
        let displayName = (element.text && String(element.text).trim()) ? String(element.text).trim() : `T${element.id}`;
        
        // Occupied ë˜ëŠ” Payment Pending ìƒíƒœì¸ ê²½ìš° ì‹œê°„ í‘œì‹œ
        if ((element.status === 'Occupied' || element.status === 'Payment Pending') && tableOccupiedTimes[String(element.id)]) {
          const now = Date.now();
          const elapsed = Math.floor((now - tableOccupiedTimes[String(element.id)]) / 1000 / 60); // ë¶„ ë‹¨ìœ„
          const hours = Math.floor(elapsed / 60);
          const minutes = elapsed % 60;
          displayName += `\n${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
          console.log(`Table ${element.id} occupied time:`, `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`);
        }
        // Hold ë˜ëŠ” Reserved ìƒíƒœì¸ ê²½ìš° ì˜ˆì•½ìž ì´ë¦„ í‘œì‹œ
        else if ((element.status === 'Hold' || element.status === 'Reserved') && tableReservationNames[String(element.id)]) {
          displayName += `\n${tableReservationNames[String(element.id)]}`;
          console.log(`Table ${element.id} reservation name:`, tableReservationNames[String(element.id)]);
        }
        
        return displayName;
      case 'entrance':
        return 'Entrance'; // ë²ˆí˜¸ ì—†ìŒ
      case 'counter':
        return 'Counter'; // ë²ˆí˜¸ ì—†ìŒ
      case 'washroom':
        return 'WashRoom'; // ë²ˆí˜¸ ì—†ìŒ
      case 'restroom':
        return 'Restroom'; // ë²ˆí˜¸ ì—†ìŒ
      case 'cook-area':
        return 'Cook'; // ë²ˆí˜¸ ì—†ìŒ
      case 'divider':
        return ''; // Dividerì—ëŠ” ì´ë¦„ì„ ë„£ì§€ ì•ŠìŒ
      case 'wall':
        return ''; // Wallì—ë„ ì´ë¦„ì„ ë„£ì§€ ì•ŠìŒ
      case 'other':
        return 'Other'; // ë²ˆí˜¸ ì—†ìŒ
      case 'floor-label':
        return element.text || 'Floor'; // ë²ˆí˜¸ ì—†ìŒ
      default:
        return 'Element'; // ë²ˆí˜¸ ì—†ìŒ
    }
  };

  // ë°±ì—”ë“œì—ì„œ í…Œì´ë¸” ë§µ ë°ì´í„° ê°€ì ¸ì˜¤ê¸°
  const fetchTableMapData = async (showLoading = false) => {
    try {
      // ì´ˆê¸° ë¡œë”© ì‹œì—ë§Œ ë¡œë”© ìŠ¤í”¼ë„ˆ í‘œì‹œ (ë°±ê·¸ë¼ìš´ë“œ ê°±ì‹  ì‹œì—ëŠ” í‘œì‹œí•˜ì§€ ì•ŠìŒ)
      if (showLoading) {
        setLoading(true);
      }
      
      // Floor ì´ë¦„ì„ ë°±ì˜¤í”¼ìŠ¤ì™€ ë™ì¼í•˜ê²Œ ì‚¬ìš©
      const apiFloor = selectedFloor;
      
      // í…Œì´ë¸” ìš”ì†Œë“¤ ê°€ì ¸ì˜¤ê¸°
      const elementsResponse = await fetch(`${API_URL}/table-map/elements?floor=${apiFloor}`);
      if (elementsResponse.ok) {
        const elements = await elementsResponse.json();
        // ì €ìž¥ëœ textë¥¼ ê·¸ëŒ€ë¡œ ìœ ì§€ (í‘œì‹œëª…ì€ ë Œë” ì‹œ ê³„ì‚°)
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

        // 1) localStorageì—ì„œ ìš°ì„  ë³µì›
        try {
          const tRaw = localStorage.getItem(`occupiedTimes_${selectedFloor}`);
          if (tRaw) setTableOccupiedTimes(JSON.parse(tRaw));
        } catch {}
        try {
          const nRaw = localStorage.getItem(`reservedNames_${selectedFloor}`);
          if (nRaw) setTableReservationNames(JSON.parse(nRaw));
        } catch {}

        // 2) ì €ìž¥ê°’ì´ ì—†ì„ ë•Œë§Œ ì´ˆê¸° ë¶€íŒ… ë³´ì • (í˜„ìž¬ ì‹œê°„ì„ ì‹œë“œ)
        if (Object.keys(tableOccupiedTimes).length === 0) {
          const occupiedTimesSeed: Record<string, number> = {};
          patchedElements.forEach((element: any) => {
            if (element.status === 'Occupied' || element.status === 'Payment Pending') {
              // ì‹œë“œê°€ ì—†ìœ¼ë©´ í˜„ìž¬ì‹œê°„ìœ¼ë¡œ, ìžˆìœ¼ë©´ ìœ ì§€
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
        console.warn('í…Œì´ë¸” ìš”ì†Œë¥¼ ê°€ì ¸ì˜¬ ìˆ˜ ì—†ìŠµë‹ˆë‹¤. ê¸°ë³¸ê°’ì„ ì‚¬ìš©í•©ë‹ˆë‹¤.');
        setTableElements([]);
      }

      // í™”ë©´ í¬ê¸° ì„¤ì • ê°€ì ¸ì˜¤ê¸° (ë°±ì˜¤í”¼ìŠ¤ì™€ ë™ì¼í•˜ê²Œ ì‚¬ìš©)
      const screenResponse = await fetch(`${API_URL}/table-map/screen-size?floor=${encodeURIComponent(apiFloor)}&_ts=${Date.now()}` , { cache: 'no-store' as RequestCache });
      if (screenResponse.ok) {
        const screen = await screenResponse.json();
        // ë°±ì˜¤í”¼ìŠ¤ì—ì„œ ì„¤ì •í•œ í™”ë©´ë¹„/í”½ì…€ì„ ê·¸ëŒ€ë¡œ ì ìš©
        setScreenSize({ 
          width: String(screen.width), 
          height: String(screen.height), 
          scale: screen.scale || 1 
        });
      } else {
        console.warn('í™”ë©´ í¬ê¸°ë¥¼ ê°€ì ¸ì˜¬ ìˆ˜ ì—†ìŠµë‹ˆë‹¤. ë°±ì˜¤í”¼ìŠ¤ì™€ ë™ì¼í•œ ê¸°ë³¸ê°’(1024x768)ì„ ì‚¬ìš©í•©ë‹ˆë‹¤.');
        // Auto-detect screen size
        const detectedWidth = window.innerWidth;
        const detectedHeight = window.innerHeight;
        console.log(`🖥️ [Auto-detect] No saved screen size, using current: ${detectedWidth}x${detectedHeight}`);
        setScreenSize({ width: String(detectedWidth), height: String(detectedHeight), scale: 1 });
        
        // Save detected size to DB
        try {
          await fetch(`${API_URL}/table-map/screen-size`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ floor: apiFloor, width: detectedWidth, height: detectedHeight, scale: 1 })
          });
          console.log('✅ [Auto-detect] Screen size saved to database');
        } catch (saveErr) {
          console.warn('⚠️ [Auto-detect] Failed to save screen size:', saveErr);
        }
      }
    } catch (err) {
      console.error('ë°ì´í„° ê°€ì ¸ì˜¤ê¸° ì˜¤ë¥˜:', err);
      setError('ë°ì´í„°ë¥¼ ë¶ˆëŸ¬ì˜¬ ìˆ˜ ì—†ìŠµë‹ˆë‹¤.');
    } finally {
      // ì´ˆê¸° ë¡œë”© ì‹œì—ë§Œ ë¡œë”© ìƒíƒœ í•´ì œ
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchTableMapData(true);  // ì´ˆê¸° ë¡œë”© ì‹œì—ë§Œ ë¡œë”© ìŠ¤í”¼ë„ˆ í‘œì‹œ
    
    // í…Œì´ë¸” ìƒíƒœ ì‹¤ì‹œê°„ ì—…ë°ì´íŠ¸ë¥¼ ìœ„í•œ íƒ€ì´ë¨¸ (15ì´ˆë§ˆë‹¤)
    const tableRefreshInterval = setInterval(() => {
      fetchTableMapData();  // ë°±ê·¸ë¼ìš´ë“œ ê°±ì‹  - ë¡œë”© ìŠ¤í”¼ë„ˆ ì—†ìŒ
    }, 15000);
    
    return () => clearInterval(tableRefreshInterval);
  }, [selectedFloor]); // selectedFloorê°€ ë³€ê²½ë  ë•Œë§ˆë‹¤ ë°ì´í„° ë‹¤ì‹œ ê°€ì ¸ì˜¤ê¸°

  // Back Office ì €ìž¥ ì‹ í˜¸(localStorage) ìˆ˜ì‹  ì‹œ ìž¬ë¡œë“œ
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

  // ë¼ìš°íŒ… ë³µê·€/íƒ­ ê°€ì‹œì„± ë³€ê²½ ì‹œ í•­ìƒ í™”ë©´ í¬ê¸° ìž¬ì ìš©
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

  // ì°½ í¬ì»¤ìŠ¤ ì‹œ ìž¬ë¡œë“œ(ë™ì¼ íƒ­ì—ì„œë„ ë°˜ì˜)
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

  // Occupied í…Œì´ë¸”ì˜ ì‹œê°„ ì—…ë°ì´íŠ¸
  useEffect(() => {
    const interval = setInterval(() => {
      setTableOccupiedTimes(prev => {
        const now = Date.now();
        const updated = { ...prev };
        
        // Occupied ìƒíƒœì¸ í…Œì´ë¸”ë“¤ì˜ ì‹œê°„ ì—…ë°ì´íŠ¸
        tableElements.forEach(table => {
          if (table.status === 'Occupied' && updated[String(table.id)]) {
            const elapsed = Math.floor((now - updated[String(table.id)]) / 1000 / 60); // ë¶„ ë‹¨ìœ„
            // ì‹œê°„ì€ ê·¸ëŒ€ë¡œ ìœ ì§€ (ì—…ë°ì´íŠ¸í•˜ì§€ ì•ŠìŒ)
          }
        });
        
        return updated;
      });
    }, 1000); // 1ì´ˆë§ˆë‹¤ ì—…ë°ì´íŠ¸

    return () => clearInterval(interval);
  }, [tableElements]);

  // ìš”ì†Œ ìŠ¤íƒ€ì¼ ìƒì„±
  const getElementStyle = (element: TableElement) => {
    const isPressed = pressedTableId && String(pressedTableId) === String(element.id);
    const isSourceTable = isMoveMergeMode && sourceTableId === element.id;
    const status = element.status || 'Available';
    const isOccupied = status === 'Occupied';
    
    // í…Œì´ë¸” íƒ€ìž…ë§Œ pointer ì»¤ì„œ ì ìš©
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

    // Move/Merge ëª¨ë“œì—ì„œ ì¶œë°œ í…Œì´ë¸” í•˜ì´ë¼ì´íŠ¸
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

    // Print Bill ëª¨ë“œì—ì„œ Occupied í…Œì´ë¸” í•˜ì´ë¼ì´íŠ¸
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

    // ìš”ì†Œ íƒ€ìž…ë³„ ìŠ¤íƒ€ì¼ ì ìš©
    switch (element.type) {
      case 'rounded-rectangle': {
        // ìƒíƒœë³„ í…Œì´ë¸” ìƒ‰ìƒ ê³ ì •
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

  // BOì™€ ë™ì¼í•œ ìž…ì²´íš¨ê³¼ ë° ëª¨ì–‘ í´ëž˜ìŠ¤ ì ìš©
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

  // í…ìŠ¤íŠ¸ ìƒ‰ìƒ ëŒ€ë¹„ ê³„ì‚°
  const getContrastColor = (hexColor: string) => {
    const hex = hexColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 128 ? '#000000' : '#FFFFFF';
  };

  // ê°„ë‹¨í•œ ìƒ‰ìƒ ì–´ë‘¡ê²Œ ì²˜ë¦¬
  const darkenColor = (hexColor: string, amount: number) => {
    const hex = hexColor.replace('#', '');
    const r = Math.max(0, Math.min(255, Math.round(parseInt(hex.substr(0, 2), 16) * (1 - amount))));
    const g = Math.max(0, Math.min(255, Math.round(parseInt(hex.substr(2, 2), 16) * (1 - amount))));
    const b = Math.max(0, Math.min(255, Math.round(parseInt(hex.substr(4, 2), 16) * (1 - amount))));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  };

  // í…Œì´ë¸” ìƒíƒœ ë³€ê²½ (release ì‹œ ë™ìž‘)
  const handleTableClick = async (element: TableElement) => {
    const clickTime = performance.now();
    console.log('ðŸ–±ï¸ í…Œì´ë¸” í´ë¦­!', element.text, clickTime);
    
    if (!(element.type === 'rounded-rectangle' || element.type === 'circle')) return;

    // Print Bill ëª¨ë“œ ì²˜ë¦¬
    if (isBillPrintMode) {
      const status = element.status || 'Available';
      if (status === 'Occupied') {
        await printBillForTable(element);
      } else {
        setBillPrintStatus('âŒ Only occupied tables can print bills');
        setTimeout(() => setBillPrintStatus(''), 2000);
      }
      return;
    }

    // Move/Merge ëª¨ë“œ ì²˜ë¦¬
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
        // Reserved → Occupied (ì¦‰ì‹œ ë³€ê²½)
        await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(String(element.id))}/status`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Occupied' })
        });
        setTableElements(prev => prev.map(el => String(el.id) === String(element.id) ? { ...el, status: 'Occupied', current_order_id: null as any } : el));
        setOccupiedTimestamp(element.id, Date.now());
        try { localStorage.setItem('lastOccupiedTable', JSON.stringify({ tableId: element.id, floor: selectedFloor, status: 'Occupied', ts: Date.now() })); } catch {}
        
        // ì£¼ë¬¸ì°½ìœ¼ë¡œ ì´ë™
        navigate('/sales/order', {
          state: {
            orderType: 'POS',
            menuId: defaultMenu.menuId,
            menuName: defaultMenu.menuName,
            tableId: element.id,
            tableLabel: element.text,
            floor: selectedFloor,
            loadExisting: Boolean((element as any).current_order_id),
            orderId: (element as any).current_order_id || null  // ê²ŒìŠ¤íŠ¸ ê²°ì œ ìƒíƒœ ë³µì›ì„ ìœ„í•´ orderId ì „ë‹¬
          }
        });
      } else if (currentStatus === 'Preparing') {
        // Preparing → Available (ì²­ì†Œ ì™„ë£Œ)
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
        // Hold (ê·¸ë¼ë°ì´ì…˜) → Occupied + ì£¼ë¬¸íŽ˜ì´ì§€ë¡œ ì´ë™
        await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(String(element.id))}/status`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'Occupied' })
        });
        setTableElements(prev => prev.map(el => String(el.id) === String(element.id) ? { ...el, status: 'Occupied', current_order_id: null as any } : el));
        setOccupiedTimestamp(element.id, Date.now());
        try { localStorage.setItem('lastOccupiedTable', JSON.stringify({ tableId: element.id, floor: selectedFloor, status: 'Occupied', ts: Date.now() })); } catch {}
        
        // ì¦‰ì‹œ ì£¼ë¬¸íŽ˜ì´ì§€ë¡œ ì´ë™
        console.log('ðŸš€ í…Œì´ë¸” í´ë¦­ → OrderPage ì´ë™ ì‹œìž‘', performance.now());
        navigate('/sales/order', {
          state: {
            orderType: 'POS',
            menuId: defaultMenu.menuId,
            menuName: defaultMenu.menuName,
            tableId: element.id,
            tableLabel: element.text,
            floor: selectedFloor,
            loadExisting: Boolean((element as any).current_order_id),
            orderId: (element as any).current_order_id || null  // ê²ŒìŠ¤íŠ¸ ê²°ì œ ìƒíƒœ ë³µì›ì„ ìœ„í•´ orderId ì „ë‹¬
          }
        });
      } else {
        // Occupied ìƒíƒœì¼ ë•ŒëŠ” ì£¼ë¬¸ íŽ˜ì´ì§€ë¡œ ì´ë™
        // ìµœì‹  ìƒíƒœì—ì„œ current_order_id ê°€ì ¸ì˜¤ê¸° (React ë¹„ë™ê¸° ìƒíƒœ ì—…ë°ì´íŠ¸ ëŒ€ì‘)
        const latestElement = tableElements.find(el => String(el.id) === String(element.id));
        const currentStatus = latestElement?.status || element.status;
        const effectiveOrderId = latestElement?.current_order_id || (element as any).current_order_id;
        
        // Occupied ìƒíƒœë¼ë©´ ì£¼ë¬¸ì´ ìžˆë‹¤ê³  ê°€ì • (ì•ˆì „ìž¥ì¹˜)
        const hasOrder = Boolean(effectiveOrderId) || currentStatus === 'Occupied';
        
        console.log('ðŸš€ í…Œì´ë¸” í´ë¦­ → OrderPage ì´ë™ ì‹œìž‘', performance.now(), { 
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
            loadExisting: hasOrder,
            orderId: effectiveOrderId || null  // ê²ŒìŠ¤íŠ¸ ê²°ì œ ìƒíƒœ ë³µì›ì„ ìœ„í•´ orderId ì „ë‹¬
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
   * í…Œì´ë¸”ì˜ í˜„ìž¬ ì£¼ë¬¸ì— ëŒ€í•´ Bill(ì˜ìˆ˜ì¦)ì„ ì¶œë ¥í•©ë‹ˆë‹¤.
   */
  const printBillForTable = async (element: TableElement) => {
    const tableLabel = element.text || `Table ${element.id}`;
    setBillPrintStatus(`🔄 Printing bill for ${tableLabel}...`);

    try {
      // 1. í…Œì´ë¸”ì˜ ì£¼ë¬¸ ì •ë³´ ê°€ì ¸ì˜¤ê¸°
      const orderId = (element as any).current_order_id;
      if (!orderId) {
        setBillPrintStatus(`âŒ No order found for ${tableLabel}`);
        setTimeout(() => setBillPrintStatus(''), 2000);
        return;
      }

      // 2. ì£¼ë¬¸ ìƒì„¸ ì •ë³´ ë° ì•„ì´í…œ ê°€ì ¸ì˜¤ê¸° (ë‹¨ì¼ API í˜¸ì¶œ)
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
        setBillPrintStatus(`âŒ No items found for ${tableLabel}`);
        setTimeout(() => setBillPrintStatus(''), 2000);
        return;
      }

      // 4. Store ì •ë³´ ê°€ì ¸ì˜¤ê¸° (business profile)
      const storeResponse = await fetch(`${API_URL}/admin-settings/business-profile`);
      const storeData = await storeResponse.json();
      const store = {
        name: storeData?.business_name || 'Restaurant',
        address: [storeData?.address_line1, storeData?.address_line2, storeData?.city, storeData?.state, storeData?.zip].filter(Boolean).join(', ') || '',
        phone: storeData?.phone || ''
      };

      // 5. Tax ì •ë³´ ê°€ì ¸ì˜¤ê¸°
      const taxResponse = await fetch(`${API_URL}/taxes`);
      const taxes = await taxResponse.json();
      const activeTaxes = Array.isArray(taxes) ? taxes.filter((t: any) => !t.is_deleted) : [];
      const taxRate = activeTaxes.length > 0 
        ? (parseFloat(activeTaxes[0].rate) > 1 ? parseFloat(activeTaxes[0].rate) / 100 : parseFloat(activeTaxes[0].rate)) 
        : 0.05;

      // 6. Guestë³„ë¡œ ì•„ì´í…œ ê·¸ë£¹í™”
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

      // 7. ê¸ˆì•¡ ê³„ì‚°
      const subtotal = items.reduce((sum: number, item: any) => {
        const price = item.price || 0;
        const qty = item.quantity || 1;
        return sum + (price * qty);
      }, 0);

      const taxesTotal = subtotal * taxRate;
      const total = subtotal + taxesTotal;

      // 8. ì˜ìˆ˜ì¦ ë°ì´í„° êµ¬ì„±
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

      // 9. í”„ë¦°í„°ë¡œ ì¶œë ¥ (print-bill API ì‚¬ìš© - billLayout ì ìš©)
      await printBill({
        header: fullReceipt.header,
        orderInfo: fullReceipt.orderInfo,
        guestSections: fullReceipt.body.guestSections,
        subtotal: fullReceipt.body.subtotal,
        adjustments: fullReceipt.body.adjustments,
        taxLines: fullReceipt.body.taxLines,
        taxesTotal: fullReceipt.body.taxesTotal,
        total: fullReceipt.body.total,
        footer: fullReceipt.footer
      }, 1);
      
      setBillPrintStatus(`✅ Bill printed for ${tableLabel}`);
      setTimeout(() => {
        setIsBillPrintMode(false);
        setBillPrintStatus('');
      }, 1500);
    } catch (error: any) {
      console.error('Print bill error:', error);
      setBillPrintStatus(`âŒ Print failed: ${error.message}`);
      setTimeout(() => setBillPrintStatus(''), 3000);
    }
  };

  /**
   * Order List ê´€ë ¨ í•¨ìˆ˜ë“¤
   */
  const fetchOrderList = async (date: string) => {
    console.log('[fetchOrderList] Fetching orders for date:', date);
    // FSR ëª¨ë“œì—ì„œëŠ” FSR ì£¼ë¬¸ë§Œ ì¡°íšŒ
    console.log('[fetchOrderList] API URL:', `${API_URL}/orders?date=${date}&order_mode=FSR`);
    setOrderListLoading(true);
    try {
      const response = await fetch(`${API_URL}/orders?date=${date}&order_mode=FSR`);
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

  // Live Order ë¡œë“œ - í…Œì´ë¸”ë³„ ë¯¸ê²°ì œ ì£¼ë¬¸
  const fetchLiveOrders = useCallback(async () => {
    try {
      // ë¨¼ì € í…Œì´ë¸” ë°ì´í„°ë¥¼ ìµœì‹  ìƒíƒœë¡œ ê°€ì ¸ì˜¤ê¸° (ëª¨ë“  ì¸µ)
      let currentTableElements = tableElements;
      try {
        const tableRes = await fetch(`${API_URL}/table-map/elements`);
        if (tableRes.ok) {
          const tableData = await tableRes.json();
          currentTableElements = tableData.elements || tableData || [];
        }
      } catch (e) {
        console.warn('[Live Order] Failed to fetch latest table data:', e);
      }

      // í…Œì´ë¸”ì— ì—°ê²°ëœ ì£¼ë¬¸ ID ê°€ì ¸ì˜¤ê¸°
      const tableOrdersMap: { tableId: string; tableLabel: string; orderId: string }[] = [];
      
      currentTableElements
        .filter((t: any) => t.type === 'rounded-rectangle' || t.type === 'circle')
        .forEach((table: any) => {
          // 1. DBì—ì„œ ê°€ì ¸ì˜¨ current_order_id ìš°ì„  í™•ì¸
          // 2. localStorageì˜ lastOrderIdByTable_ í‚¤ í™•ì¸ (OrderPageì™€ ë™ì¼)
          const dbOrderId = table.current_order_id;
          const localOrderId = localStorage.getItem(`lastOrderIdByTable_${table.id}`);
          const orderId = dbOrderId || localOrderId;
          
          console.log(`[Live Order] Table ${table.id}: DB orderId=${dbOrderId}, Local orderId=${localOrderId}`);
          
          if (orderId && orderId !== 'null' && orderId !== '' && String(orderId) !== '0') {
            tableOrdersMap.push({
              tableId: table.id,
              tableLabel: table.text || `Table ${table.id}`,
              orderId: String(orderId)
            });
          }
        });

      console.log('[Live Order] Tables with orders:', tableOrdersMap);

      // ê° ì£¼ë¬¸ì˜ ìƒì„¸ ì •ë³´ ê°€ì ¸ì˜¤ê¸°
      const ordersWithDetails = await Promise.all(
        tableOrdersMap.map(async (tableOrder) => {
          try {
            const response = await fetch(`${API_URL}/orders/${tableOrder.orderId}`);
            const data = await response.json();
            console.log(`[Live Order] Order ${tableOrder.orderId} data:`, data);
            
            if (data.success && data.order) {
              // PENDING, UNPAID, ë˜ëŠ” ë¹ˆ ìƒíƒœë§Œ í¬í•¨ (ê²°ì œ ì™„ë£Œëœ ì£¼ë¬¸ ì œì™¸)
              const status = (data.order.status || '').toUpperCase();
              const isPaid = status === 'PAID' || status === 'CLOSED' || status === 'COMPLETED';
              
              if (!isPaid) {
                return {
                  ...tableOrder,
                  order: data.order,
                  items: (data.items || []).map((item: any) => ({
                    ...item,
                    modifiers: item.modifiers_json ? JSON.parse(item.modifiers_json) : [],
                    memo: item.memo_json ? JSON.parse(item.memo_json) : null
                  }))
                };
              } else {
                console.log(`[Live Order] Order ${tableOrder.orderId} is paid, skipping`);
              }
            }
          } catch (err) {
            console.error(`Failed to fetch order ${tableOrder.orderId}:`, err);
          }
          return null;
        })
      );

      setLiveOrders(ordersWithDetails.filter(Boolean));
    } catch (error) {
      console.error('Failed to fetch live orders:', error);
    }
  }, [tableElements, API_URL]);

  // Live Order íƒ­ ì„ íƒ ì‹œ ì´ˆê¸° ë¡œë“œ
  useEffect(() => {
    if (orderListTab === 'live' && showOrderListModal) {
      fetchLiveOrders();
    }
  }, [orderListTab, showOrderListModal, fetchLiveOrders]);

  // ì£¼ë¬¸ ìƒì„±/ê²°ì œ ì´ë²¤íŠ¸ ë¦¬ìŠ¤ë„ˆ - Live Order ì‹¤ì‹œê°„ ì—…ë°ì´íŠ¸
  useEffect(() => {
    const handleOrderChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      console.log('[Live Order] Event received:', e.type, detail);
      
      // Live Order íƒ­ì´ ì—´ë ¤ìžˆìœ¼ë©´ ì¦‰ì‹œ ìƒˆë¡œê³ ì¹¨
      if (orderListTab === 'live' && showOrderListModal) {
        fetchLiveOrders();
      }
    };

    // ì»¤ìŠ¤í…€ ì´ë²¤íŠ¸ ë¦¬ìŠ¤ë„ˆ ë“±ë¡
    window.addEventListener('orderCreated', handleOrderChange);
    window.addEventListener('orderPaid', handleOrderChange);
    window.addEventListener('orderUpdated', handleOrderChange);

    return () => {
      window.removeEventListener('orderCreated', handleOrderChange);
      window.removeEventListener('orderPaid', handleOrderChange);
      window.removeEventListener('orderUpdated', handleOrderChange);
    };
  }, [orderListTab, showOrderListModal, fetchLiveOrders]);

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
      // Store ì •ë³´ ê°€ì ¸ì˜¤ê¸°
      const storeResponse = await fetch(`${API_URL}/admin-settings/business-profile`);
      const storeData = await storeResponse.json();
      const store = {
        name: storeData?.business_name || 'Restaurant',
        address: [storeData?.address_line1, storeData?.address_line2, storeData?.city, storeData?.state, storeData?.zip].filter(Boolean).join(', ') || '',
        phone: storeData?.phone || ''
      };

      // Tax ì •ë³´ ê°€ì ¸ì˜¤ê¸°
      const taxResponse = await fetch(`${API_URL}/taxes`);
      const taxes = await taxResponse.json();
      const activeTaxes = Array.isArray(taxes) ? taxes.filter((t: any) => !t.is_deleted) : [];
      const taxRate = activeTaxes.length > 0 
        ? (parseFloat(activeTaxes[0].rate) > 1 ? parseFloat(activeTaxes[0].rate) / 100 : parseFloat(activeTaxes[0].rate)) 
        : 0.05;

      // Guestë³„ë¡œ ì•„ì´í…œ ê·¸ë£¹í™”
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

      // print-bill API ì‚¬ìš© - billLayout ì ìš© (1ìž¥ë§Œ ì¶œë ¥)
      await printBill({
        header: fullReceipt.header,
        orderInfo: fullReceipt.orderInfo,
        guestSections: fullReceipt.body.guestSections,
        subtotal: fullReceipt.body.subtotal,
        adjustments: fullReceipt.body.adjustments,
        taxLines: fullReceipt.body.taxLines,
        taxesTotal: fullReceipt.body.taxesTotal,
        total: fullReceipt.body.total,
        footer: fullReceipt.footer
      }, 1);
      
      console.log('Bill printed successfully');
    } catch (error: any) {
      console.error('Print bill error:', error);
      alert(`Print failed: ${error.message}`);
    }
  };

  const handleOrderListPrintKitchen = async () => {
    if (!orderListSelectedOrder || orderListSelectedItems.length === 0) return;
    
    try {
      // OrderPageì˜ printKitchenOrdersì™€ ë™ì¼í•œ í˜•ì‹ìœ¼ë¡œ ì•„ì´í…œ êµ¬ì„±
      const printItems = orderListSelectedItems.map((item: any) => {
        // modifiers íŒŒì‹±
        let modifiers: any[] = [];
        if (item.modifiers_json) {
          try {
            const parsed = typeof item.modifiers_json === 'string' 
              ? JSON.parse(item.modifiers_json) 
              : item.modifiers_json;
            if (Array.isArray(parsed)) {
              modifiers = parsed;
            }
          } catch {}
        }
        
        // memo íŒŒì‹±
        let memo: string | null = null;
        if (item.memo_json) {
          try {
            const parsed = typeof item.memo_json === 'string' 
              ? JSON.parse(item.memo_json) 
              : item.memo_json;
            memo = parsed?.text || (typeof parsed === 'string' ? parsed : null);
          } catch {}
        }
        
        return {
          id: item.item_id || 0, // í”„ë¦°í„° ê·¸ë£¹ ì¡°íšŒë¥¼ ìœ„í•´ item_id í¬í•¨
          name: item.name || 'Unknown Item',
          qty: item.quantity || 1, // OrderPageì™€ ë™ì¼í•˜ê²Œ qty ì‚¬ìš©
          guestNumber: item.guest_number || 1,
          modifiers: modifiers,
          memo: memo
        };
      });

      // ì£¼ë¬¸ íƒ€ìž… ê²°ì • (Dine-In, Togo, Online, Delivery ë“±)
      const rawOrderType = (orderListSelectedOrder.order_type || 'DINE-IN').toUpperCase();
      const orderSource = (orderListSelectedOrder.order_source || '').toUpperCase();
      
      // ë°°ë‹¬ì•±/ì˜¨ë¼ì¸ ì£¼ë¬¸ì¸ì§€ í™•ì¸
      const isOnlineOrDelivery = ['ONLINE', 'TOGO', 'DELIVERY'].includes(rawOrderType) ||
                                  ['THEZONE', 'UBEREATS', 'DOORDASH', 'SKIPTHEDISHES', 'SKIP', 'FANTUAN', 'GRUBHUB'].includes(orderSource);
      
      // ì±„ë„ëª… ê²°ì • (order_source ìš°ì„  ì‚¬ìš©)
      const channelDisplay = orderSource || rawOrderType;
      const deliveryChannel = ['THEZONE', 'UBEREATS', 'DOORDASH', 'SKIPTHEDISHES', 'SKIP', 'FANTUAN', 'GRUBHUB'].includes(orderSource) 
                              ? orderSource 
                              : (rawOrderType === 'ONLINE' ? 'THEZONE' : rawOrderType);
      
      // Pickup ì‹œê°„ ê³„ì‚° (ready_time ë˜ëŠ” pickup_minutes ì‚¬ìš©)
      let pickupTimeStr = '';
      let pickupMinutes = orderListSelectedOrder.pickup_minutes || 0;
      
      if (orderListSelectedOrder.ready_time) {
        const readyDate = new Date(orderListSelectedOrder.ready_time);
        pickupTimeStr = readyDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      } else if (pickupMinutes > 0) {
        const createdAt = new Date(orderListSelectedOrder.created_at);
        const pickupDate = new Date(createdAt.getTime() + pickupMinutes * 60000);
        pickupTimeStr = pickupDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      } else if (isOnlineOrDelivery) {
        // ì˜¨ë¼ì¸/Togo ì£¼ë¬¸ì¸ë° pickup_minutesê°€ ì—†ìœ¼ë©´ created_at + 20ë¶„ ê¸°ë³¸ê°’ ì‚¬ìš©
        pickupMinutes = 20;
        const createdAt = new Date(orderListSelectedOrder.created_at);
        const pickupDate = new Date(createdAt.getTime() + pickupMinutes * 60000);
        pickupTimeStr = pickupDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      }
      
      // í…Œì´ë¸” í‘œì‹œ (ì˜¨ë¼ì¸/TogoëŠ” PICKUP/DELIVERY, Dine-Inì€ í…Œì´ë¸” ë²ˆí˜¸)
      const tableDisplay = isOnlineOrDelivery 
        ? (orderListSelectedOrder.fulfillment_mode === 'delivery' ? 'DELIVERY' : 'PICKUP')
        : (orderListSelectedOrder.table_id ? `Table ${orderListSelectedOrder.table_id}` : '');
      
      const response = await fetch(`${API_URL}/printers/print-order`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ 
          items: printItems,
          orderInfo: {
            // ì£¼ë¬¸ë²ˆí˜¸: ë¡œì»¬ ID í˜•ì‹ (#912) ì‚¬ìš©
            orderNumber: `#${orderListSelectedOrder.id}`,
            externalOrderNumber: `#${orderListSelectedOrder.id}`, // TZO/Onlineì€ POS ì£¼ë¬¸ë²ˆí˜¸ ì‚¬ìš©
            table: tableDisplay,
            orderType: rawOrderType,
            channel: deliveryChannel,                    // ì¶œë ¥ë¬¼ì— í‘œì‹œë  ì±„ë„ëª… (THEZONE, UBEREATS ë“±)
            deliveryChannel: deliveryChannel,            // ë°°ë‹¬ ì±„ë„ëª…
            orderSource: orderSource || rawOrderType,    // ì›ë³¸ ì£¼ë¬¸ ì†ŒìŠ¤
            server: orderListSelectedOrder.server_name || '',
            customerName: orderListSelectedOrder.customer_name || '',
            customerPhone: orderListSelectedOrder.customer_phone || '',
            notes: orderListSelectedOrder.notes || '',
            specialInstructions: orderListSelectedOrder.kitchen_note || '', // Footerì— ì¶œë ¥ë  Special Instructions
            kitchenNote: orderListSelectedOrder.kitchen_note || '',
            pickupMinutes: pickupMinutes,                // ê³„ì‚°ëœ pickup_minutes
            pickupTime: pickupTimeStr                    // ê³„ì‚°ëœ Pickup ì‹œê°„
          },
          isReprint: true, // Reprint í‘œì‹œ (** REPRINT ** ë°°ë„ˆ ì¶œë ¥)
          isPaid: orderListSelectedOrder.status === 'paid' || orderListSelectedOrder.status === 'PAID' || orderListSelectedOrder.status === 'closed'
        }) 
      });
      
      const result = await response.json();
      
      if (result.success) {
        // ì„±ê³µ ì‹œ ì¡°ìš©ížˆ ì²˜ë¦¬ (alert ì œê±°)
        console.log('Reprint sent to kitchen:', result.message);
      } else {
        alert(`Print failed: ${result.error || result.message || 'Unknown error'}`);
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
      // null/undefined/빈문자열 체크
      if (!dateStr) return '--';
      
      let d: Date;
      
      // YYYY-MM-DD 형식인 경우 로컬 시간으로 파싱 (UTC 변환 방지)
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const [year, month, day] = dateStr.split('-').map(Number);
        d = new Date(year, month - 1, day);
      } else {
        // 다른 형식 (ISO 타임스탬프 등)은 그대로 파싱
        d = new Date(dateStr);
      }
      
      // Invalid Date 체크
      if (isNaN(d.getTime())) return '--';
      
      return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    };
    
    // YYYY-MM-DD 문자열을 로컬 Date 객체로 변환하는 헬퍼 함수
    const parseLocalDate = (dateStr: string): Date => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const [year, month, day] = dateStr.split('-').map(Number);
        return new Date(year, month - 1, day);
      }
      return new Date(dateStr);
    };

  const orderListGetChannelDisplay = (order: any) => {
      const type = (order.order_type || '').toUpperCase();
      // Online channels
      if (type === 'UBEREATS' || type === 'UBER') return 'UberEats';
      if (type === 'DOORDASH') return 'DoorDash';
      if (type === 'SKIP' || type === 'SKIPTHEDISHES') return 'SkipTheDishes';
      if (type === 'ONLINE' || type === 'WEB' || type === 'QR') return 'Online';
      // Delivery
      if (type === 'DELIVERY') return 'Delivery';
      // Pickup
      if (type === 'PICKUP') return 'Pickup';
      // Togo
      if (type === 'TOGO' || type === 'TAKEOUT') return 'Togo';
      // For Here (default)
      return 'For Here';
    };

  const orderListGetTableOrCustomer = (order: any) => {
      const parts: string[] = [];
      if (order.table_id) parts.push(`Table ${order.table_id}`);
      if (order.customer_name) parts.push(order.customer_name);
      if (order.customer_phone) parts.push(order.customer_phone);
      return parts.length > 0 ? parts.join(' / ') : '-';
    };

  // ì±„ë„ ë ì§€ (badge) ì •ë³´ ë°˜í™˜
  const orderListGetChannelBadge = (order: any): { label: string; bgColor: string; textColor: string } => {
    const type = (order.order_type || '').toUpperCase();
    const tableId = (order.table_id || '').toString().toUpperCase();
    
    // Online channel (UberEats, DoorDash, Skip, Online, Web, QR) - or table_id starts with 'OL'
    if (type === 'UBEREATS' || type === 'UBER' || type === 'DOORDASH' || type === 'SKIP' || type === 'SKIPTHEDISHES' || type === 'ONLINE' || type === 'WEB' || type === 'QR' || tableId.startsWith('OL')) {
      return { label: 'Online', bgColor: 'bg-purple-500', textColor: 'text-white' };
    }
    
    // Delivery channel
    if (type === 'DELIVERY') {
      return { label: 'Delivery', bgColor: 'bg-red-500', textColor: 'text-white' };
    }
    
    // Pickup channel
    if (type === 'PICKUP') {
      return { label: 'Pickup', bgColor: 'bg-blue-500', textColor: 'text-white' };
    }
    
    // Togo channel - order_type or table_id starts with 'TG'
    if (type === 'TOGO' || type === 'TAKEOUT' || type === 'TO GO' || type === 'TO-GO' || tableId.startsWith('TG')) {
      return { label: 'Togo', bgColor: 'bg-green-600', textColor: 'text-white' };
    }
    
    // For Here (default - POS, Table Order, Dine-in, Forhere)
    return { label: 'For Here', bgColor: 'bg-amber-500', textColor: 'text-white' };
  };

  const orderListCalculateTotals = () => {
      // Helper: Calculate item total including modifiers and memo
      const getItemTotal = (item: any) => {
        const basePrice = Number((item.totalPrice != null ? item.totalPrice : item.price) || 0);
        const memoPrice = item.memo && typeof item.memo.price === 'number' ? Number(item.memo.price) : 0;
        return (basePrice + memoPrice) * (item.quantity || 1);
      };
      const subtotal = orderListSelectedItems.reduce((sum, item) => sum + getItemTotal(item), 0);
      
      // ì•„ì´í…œ ë ˆë²¨ í• ì¸ (Item D/C) ê³„ì‚°
      let itemDiscountTotal = 0;
      let hasItemDiscount = false;
      orderListSelectedItems.forEach((item: any) => {
        if (item.discount_json || item.discount) {
          const discount = typeof item.discount_json === 'string' 
            ? JSON.parse(item.discount_json) 
            : (item.discount_json || item.discount);
          if (discount && discount.value > 0) {
            hasItemDiscount = true;
            const itemPrice = getItemTotal(item); // Includes modifiers and memo
            if (discount.mode === 'percent') {
              itemDiscountTotal += itemPrice * (discount.value / 100);
            } else {
              itemDiscountTotal += Number(discount.value || 0);
            }
          }
        }
      });
      itemDiscountTotal = Number(itemDiscountTotal.toFixed(2));
      
      // adjustments_json ë˜ëŠ” adjustments ë°°ì—´ì—ì„œ í• ì¸ ì •ë³´ ê°€ì ¸ì˜¤ê¸°
      let adjustments = orderListSelectedOrder?.adjustments || [];
      if (orderListSelectedOrder?.adjustments_json) {
        try {
          const parsed = typeof orderListSelectedOrder.adjustments_json === 'string' 
            ? JSON.parse(orderListSelectedOrder.adjustments_json) 
            : orderListSelectedOrder.adjustments_json;
          if (Array.isArray(parsed)) {
            adjustments = [...adjustments, ...parsed];
          }
        } catch (e) { /* ignore */ }
      }
      
      // DISCOUNT ë˜ëŠ” PROMOTION ë˜ëŠ” CHANNEL_DISCOUNT íƒ€ìž… í• ì¸ í•©ì‚°
      const adjustmentDiscountTotal = adjustments
        .filter((a: any) => ['DISCOUNT', 'PROMOTION', 'CHANNEL_DISCOUNT'].includes(String(a.kind).toUpperCase()))
        .reduce((sum: number, a: any) => sum + Math.abs(Number(a.amount_applied || a.amountApplied || a.value || 0)), 0);
      
      // ì´ í• ì¸ = ì•„ì´í…œ í• ì¸ + ì£¼ë¬¸ ë ˆë²¨ í• ì¸
      const discountTotal = itemDiscountTotal + adjustmentDiscountTotal;
      const subtotalAfterDiscount = subtotal - discountTotal;
      
      // TaxëŠ” í• ì¸ í›„ ê¸ˆì•¡ì—ì„œ ê³„ì‚° (ë˜ëŠ” ì €ìž¥ëœ totalì—ì„œ ì—­ì‚°)
      const storedTotal = Number(orderListSelectedOrder?.total || 0);
      const calculatedTax = storedTotal > 0 ? Math.max(0, storedTotal - subtotalAfterDiscount) : subtotalAfterDiscount * 0.05;
      const tax = calculatedTax;
      const total = storedTotal || (subtotalAfterDiscount + tax);
      
      // í• ì¸ ë¼ë²¨ ê²°ì •: Item D/Cê°€ ìžˆìœ¼ë©´ 'Item Discount', ì•„ë‹ˆë©´ í”„ë¡œëª¨ì…˜ ì´ë¦„
      const promotionLabel = adjustments.find((a: any) => String(a.kind).toUpperCase() === 'PROMOTION')?.label || null;
      const discountLabel = hasItemDiscount ? 'Item Discount' : (promotionLabel || 'Discount');
      
      return { subtotal, discountTotal, subtotalAfterDiscount, tax, total, promotionName: discountLabel };
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
   * âš ï¸ PROTECTED FUNCTION - Table Move/Merge Operations âš ï¸
   * 
   * ê¸°ì¡´ í…Œì´ë¸” ì´ë™/ë³‘í•© ê¸°ëŠ¥ì„ ìœ ì§€í•˜ë©´ì„œ ê°€ìƒ ì£¼ë¬¸ ì„ íƒ íë¦„ê³¼ í†µí•©í•©ë‹ˆë‹¤.
   */
  const handleMoveMergeTableClick = async (element: TableElement) => {
    const tableLabel = element.text || `Table ${element.id}`;
    
    // Togo/Online → í…Œì´ë¸” ì´ë™/ë¨¸ì§€
    if (sourceTogoOrder || sourceOnlineOrder) {
      const sourceOrder = sourceTogoOrder || sourceOnlineOrder;
      const sourceType = sourceTogoOrder ? 'Togo' : 'Online';
      const sourceLabel = sourceTogoOrder 
        ? `Togo #${sourceTogoOrder.id}`
        : `Online #${sourceOnlineOrder.number ?? sourceOnlineOrder.id}`;
      
      // Online ì£¼ë¬¸ì€ localOrderId (SQLite ID) ì‚¬ìš©, TogoëŠ” ê·¸ëƒ¥ id ì‚¬ìš©
      // ìš°ì„ ìˆœìœ„: localOrderId > fullOrder.localOrderId > number (ìˆ«ìžì¸ ê²½ìš°) > id
      const sourceOrderId = sourceTogoOrder 
        ? sourceTogoOrder.id 
        : (sourceOnlineOrder?.localOrderId || 
           sourceOnlineOrder?.fullOrder?.localOrderId || 
           (typeof sourceOnlineOrder?.number === 'number' ? sourceOnlineOrder.number : null) ||
           sourceOnlineOrder?.id);
      
      console.log('[handleMoveMergeTableClick] Online sourceOrderId:', sourceOrderId, 
        'localOrderId:', sourceOnlineOrder?.localOrderId,
        'fullOrder.localOrderId:', sourceOnlineOrder?.fullOrder?.localOrderId,
        'number:', sourceOnlineOrder?.number,
        'id:', sourceOnlineOrder?.id);
      
      // ë”ë¸” í´ë¦­ ë°©ì§€
      if (isMergeInProgress) {
        console.log('[handleMoveMergeTableClick] Merge already in progress, ignoring');
        return;
      }
      
      // Available í…Œì´ë¸” → Move (ì´ë™)
      if (element.status === 'Available') {
        try {
            setIsMergeInProgress(true);
            setMoveMergeStatus(`🔄 Moving ${sourceLabel} → ${tableLabel}...`);
          
          const response = await fetch(`${API_URL}/table-operations/move-togo-to-table`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fromOrderId: sourceOrderId,
              toTableId: element.id,
              floor: selectedFloor,
            }),
          });
          
          const result = await response.json();
          
          if (response.ok && result.success) {
            // 1. ì¦‰ì‹œ ë¡œì»¬ ìƒíƒœ ì—…ë°ì´íŠ¸ (í…Œì´ë¸” ìƒ‰ìƒ ì¦‰ì‹œ ë³€ê²½)
            setTableElements(prev => prev.map(el => {
              if (String(el.id) === String(element.id)) {
                return { ...el, status: 'Occupied', current_order_id: result.newOrderId };
              }
              return el;
            }));
            
            // 2. LocalStorage ë° ì ìœ  ì‹œê°„ ì—…ë°ì´íŠ¸
            const now = Date.now();
            setOccupiedTimestamp(element.id, now); // ë¡œì»¬ ìƒíƒœ ì—…ë°ì´íŠ¸ (ì¦‰ì‹œ íƒ€ì´ë¨¸ í‘œì‹œ)
            
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
            
            // ì˜¨ë¼ì¸ ì£¼ë¬¸ ì¹´ë“œ ì¦‰ì‹œ ì œê±° (API ì‘ë‹µ ê¸°ë‹¤ë¦¬ì§€ ì•Šê³  ì¦‰ê° UI ë°˜ì˜)
            if (sourceOnlineOrder) {
              setOnlineQueueCards(prev => prev.filter(card => card.id !== sourceOnlineOrder.id));
            }
            
            setSourceTogoOrder(null);
            setSourceOnlineOrder(null);
            setIsMoveMergeMode(false);
            setIsMergeInProgress(false);
            clearMoveMergeSelection();
            loadTogoOrders();
            loadOnlineOrders(); // ì˜¨ë¼ì¸ ì£¼ë¬¸ ëª©ë¡ ì„œë²„ì—ì„œ ìƒˆë¡œê³ ì¹¨
            
            setMoveMergeStatus(`âœ… Moved ${sourceLabel} → ${tableLabel}`);
            setTimeout(() => setMoveMergeStatus(''), 800);
          } else {
            setIsMergeInProgress(false);
            setMoveMergeStatus(`âŒ Move failed: ${result.error || result.details || 'Unknown error'}`);
            setTimeout(() => {
              setMoveMergeStatus('');
              clearMoveMergeSelection();
            }, 3000);
          }
        } catch (error: any) {
          setIsMergeInProgress(false);
          console.error(`${sourceType} to Table move error:`, error);
          setMoveMergeStatus(`âŒ Error: ${error.message}`);
          setTimeout(() => {
            setMoveMergeStatus('');
            clearMoveMergeSelection();
          }, 3000);
        }
        return;
      }
      
      // Occupied ë˜ëŠ” Payment Pending í…Œì´ë¸” → Merge (ë³‘í•©)
      if (element.status === 'Occupied' || element.status === 'Payment Pending') {
        try {
            setIsMergeInProgress(true);
            setMoveMergeStatus(`🔄 Merging ${sourceLabel} → ${tableLabel}...`);
          
          const response = await fetch(`${API_URL}/table-operations/merge-togo-to-table`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fromOrderId: sourceOrderId,
              toTableId: element.id,
              floor: selectedFloor,
            }),
          });
          
          const result = await response.json();
          
          if (response.ok && result.success) {
            setSourceTogoOrder(null);
            setSourceOnlineOrder(null);
            setIsMoveMergeMode(false);
            setIsMergeInProgress(false);
            clearMoveMergeSelection();
            loadTogoOrders();
            
            // ì˜¨ë¼ì¸ ì£¼ë¬¸ ëª©ë¡ë„ ìƒˆë¡œê³ ì¹¨ (ë¨¸ì§€ëœ ì£¼ë¬¸ ì œê±°)
            loadOnlineOrders();
            
            // í…Œì´ë¸”ë§µ ë°ì´í„° ì„œë²„ì—ì„œ ìƒˆë¡œê³ ì¹¨ (ë™ê¸°í™”)
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
            
            setMoveMergeStatus(`âœ… Merged ${sourceLabel} → ${tableLabel}`);
            setTimeout(() => setMoveMergeStatus(''), 800);
          } else {
            setIsMergeInProgress(false);
            setMoveMergeStatus(`âŒ Merge failed: ${result.error || result.details || 'Unknown error'}`);
            setTimeout(() => {
              setMoveMergeStatus('');
              clearMoveMergeSelection();
            }, 3000);
          }
        } catch (error: any) {
          setIsMergeInProgress(false);
          console.error(`${sourceType} to Table merge error:`, error);
          setMoveMergeStatus(`âŒ Error: ${error.message}`);
          setTimeout(() => {
            setMoveMergeStatus('');
            clearMoveMergeSelection();
          }, 3000);
        }
        return;
      }
      
      // ë‹¤ë¥¸ ìƒíƒœì˜ í…Œì´ë¸”
      setMoveMergeStatus('âŒ Destination table must be Available, Occupied, or Payment Pending.');
      setTimeout(() => setMoveMergeStatus(''), 2000);
      return;
    }
    
    // ì²« ë²ˆì§¸ í´ë¦­: ì¶œë°œ í…Œì´ë¸” ì„ íƒ (Occupied ë˜ëŠ” Payment Pending ê°€ëŠ¥)
    if (!sourceTableId) {
      if (element.status !== 'Occupied' && element.status !== 'Payment Pending') {
        setMoveMergeStatus('âŒ Source table must be Occupied or Payment Pending.');
        setTimeout(() => setMoveMergeStatus(''), 3000);
        return;
      }
      setSourceTableId(element.id);
      setMoveMergeStatus(`âœ“ Source: ${tableLabel} → Select destination table`);
      beginSourceSelection(element, tableLabel);
      return;
    }

    // ë‘ ë²ˆì§¸ í´ë¦­: ëª©ì  í…Œì´ë¸” ì„ íƒ
    if (sourceTableId === element.id) {
      setMoveMergeStatus('âŒ Cannot select the same table.');
      setTimeout(() => {
        clearMoveMergeSelection();
        setMoveMergeStatus('');
      }, 2000);
      return;
    }

    if (!selectionChoice) {
      setMoveMergeStatus('Please select guests/items to move first.');
      return;
    }

    // MOVE: Occupied → Available
    if (element.status === 'Available') {
      try {
        setMoveMergeStatus('🔄 Moving table...');
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
          setMoveMergeStatus(result.message ? `âœ… ${result.message}` : `âœ… Table moved: ${sourceTableId} → ${element.text}`);
          
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
                console.log(`[MOVE] ì£¼ë¬¸ ID ${sourceOrderId}ë¥¼ í…Œì´ë¸” ${sourceTableId}ì—ì„œ ${element.id}ë¡œ ì´ë™`);
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
              console.warn('[MOVE] localStorage ì—…ë°ì´íŠ¸ ì‹¤íŒ¨:', e);
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
          
          // í…Œì´ë¸” ëª©ë¡ ë‹¤ì‹œ ë¡œë“œ (ì„œë²„ì™€ ë™ê¸°í™”)
          await fetchTableMapData();
        } else {
          console.error('[MOVE] Error details:', result);
          setMoveMergeStatus(`âŒ Move failed: ${result.details || result.error}`);
          setTimeout(() => {
            setSourceTableId(null);
            setMoveMergeStatus('');
            clearMoveMergeSelection();
          }, 3000);
        }
      } catch (error: any) {
        console.error('Move table error:', error);
        setMoveMergeStatus(`âŒ Error: ${error.message}`);
        setTimeout(() => {
          setSourceTableId(null);
          setMoveMergeStatus('');
          clearMoveMergeSelection();
        }, 3000);
      }
    }
    // MERGE: Occupied/Payment Pending → Occupied/Payment Pending
    else if (element.status === 'Occupied' || element.status === 'Payment Pending') {
      try {
        setMoveMergeStatus('🔄 Merging tables...');
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
          setMoveMergeStatus(result.message ? `âœ… ${result.message}` : `âœ… Tables merged: ${sourceTableId} + ${element.text}`);
          
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
              console.warn('[MERGE] localStorage ì—…ë°ì´íŠ¸ ì‹¤íŒ¨:', e);
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
          setMoveMergeStatus(`âŒ Merge failed: ${result.details || result.error}`);
          setTimeout(() => {
            setSourceTableId(null);
            setMoveMergeStatus('');
            clearMoveMergeSelection();
          }, 3000);
        }
      } catch (error: any) {
        console.error('Merge table error:', error);
        setMoveMergeStatus(`âŒ Error: ${error.message}`);
        setTimeout(() => {
          setSourceTableId(null);
          setMoveMergeStatus('');
          clearMoveMergeSelection();
        }, 3000);
      }
    } else {
      setMoveMergeStatus('âŒ Destination table must be Available, Occupied, or Payment Pending.');
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
      setMoveMergeStatus(`âœ“ [Move All] ${sourceSelectionInfo?.label} → Select destination table`);
    } else {
      const guestCount = selection.guestNumbers?.length || 0;
      const itemCount = (selection.orderItemIds?.length || 0) + (selection.orderLineIds?.length || 0);
      setMoveMergeStatus(`âœ“ [Partial: G${guestCount}/I${itemCount}] ${sourceSelectionInfo?.label} → Select destination table`);
    }
  };

  // ë²„íŠ¼ í´ë¦­ í•¸ë“¤ëŸ¬
  const handleButtonClick = async (buttonName: string) => {
    console.log(`ë²„íŠ¼ í´ë¦­: ${buttonName}`);
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
          setIsBillPrintMode(false); // ë‹¤ë¥¸ ëª¨ë“œ ë„ê¸°
          setBillPrintStatus('');
          setIsMoveMergeMode(true);
          setMoveMergeStatus('Select a source to move');
          break;
        }
        setIsMoveMergeMode(false);
        clearMoveMergeSelection();
        setMoveMergeStatus('');
        break;
      case 'Online':
        setOnlineModalTab('preptime');
        setShowPrepTimeModal(true);
        break;
      case 'Order History':
        setShowOrderListModal(true);
        fetchOrderList(orderListDate);
        break;
      case 'Reservation':
        console.log('Reservation ë²„íŠ¼ í´ë¦­ë¨, ëª¨ë‹¬ ì—´ê¸°');
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
        console.log('Clock In/Out ë²„íŠ¼ í´ë¦­ë¨, ë©”ë‰´ ì—´ê¸°');
        setShowClockInOutMenu(true);
        break;
      case 'Online Order':
        console.log('Online Order ë²„íŠ¼ í´ë¦­ë¨');
        setShowOnlineOrderPanel(true);
        break;
      case 'Refund':
        console.log('Refund ë²„íŠ¼ í´ë¦­ë¨');
        openRefundModal();
        break;
      case 'Back Office':
        navigate('/backoffice/tables');
        break;
      case 'QSR/Cafe':
        console.log('QSR/Cafe ë²„íŠ¼ í´ë¦­ë¨');
        navigate('/qsr');
        break;
      case 'Closing':
        console.log('Closing button clicked');
        setShowClosingModal(true);
        break;
      case 'Opening':
        console.log('Opening button clicked');
        setShowOpeningModal(true);
        resetOpeningCashCounts();
        break;
      default:
        console.log(`${buttonName} ë²„íŠ¼ì´ í´ë¦­ë˜ì—ˆìŠµë‹ˆë‹¤.`);
        break;
    }
  };

  // ============ Opening/Closing Functions ============
  const fetchZReportData = async () => {
    setIsLoadingZReport(true);
    try {
      const response = await fetch(`${API_URL}/daily-closings/z-report`);
      const result = await response.json();
      if (result.success) {
        setZReportData(result.data);
      }
    } catch (error) {
      console.error('Failed to fetch Z-Report:', error);
    } finally {
      setIsLoadingZReport(false);
    }
  };

  const handleOpening = async () => {
    try {
      const response = await fetch(`${API_URL}/daily-closings/opening`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          openingCash: openingCashTotal, 
          cashBreakdown: openingCashCounts,
          openedBy: '' 
        })
      });
      const result = await response.json();
      
      if (result.success) {
        // Print opening report (also opens cash drawer)
        await fetch(`${API_URL}/daily-closings/print-opening`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            openingCash: openingCashTotal, 
            cashBreakdown: openingCashCounts 
          })
        });
        
        localStorage.removeItem('pos_last_closed_date');
        setIsDayClosed(false);
        setShowOpeningModal(false);
        resetOpeningCashCounts();
      } else {
        alert(result.error || 'Opening failed');
      }
    } catch (error: any) {
      console.error('Opening error:', error);
      alert('Opening failed: ' + error.message);
    }
  };

  // Print Z-Report function
  const handlePrintZReport = async () => {
    try {
      await fetch(`${API_URL}/daily-closings/print-z-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          zReportData, 
          closingCash: closingCashTotal, 
          cashBreakdown: closingCashCounts 
        })
      });
    } catch (error: any) {
      console.error('Print Z-Report error:', error);
    }
  };

  const handleClosing = async () => {
    console.log('handleClosing called!', { closingCashTotal, closingCashCounts });
    try {
      const response = await fetch(`${API_URL}/daily-closings/closing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          closingCash: closingCashTotal, 
          cashBreakdown: closingCashCounts,
          closedBy: '' 
        })
      });
      const result = await response.json();
      console.log('Closing API result:', result);
      
      if (result.success) {
        // Print Z-Report when closing
        await handlePrintZReport();
        
        const today = new Date().toISOString().split('T')[0];
        localStorage.setItem('pos_last_closed_date', today);
        setIsDayClosed(true);
        setShowClosingModal(false);
        resetClosingCashCounts();
        setZReportData(null);
        setClosingStep('report');
      } else {
        alert(result.error || 'Closing failed');
      }
    } catch (error: any) {
      console.error('Closing error:', error);
      alert('Closing failed: ' + error.message);
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
      // PINìœ¼ë¡œ ì§ì› ì¡°íšŒ ë° ê¶Œí•œ í™•ì¸ (Manager ë˜ëŠ” Owner)
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

    // ì¶©ì „ ëª¨ë“œì¸ ê²½ìš°
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

    // ì‹ ê·œ íŒë§¤
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
        // ì¹´ë“œê°€ ì´ë¯¸ ì¡´ìž¬í•˜ë©´ ìžë™ìœ¼ë¡œ ì¶©ì „
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

  // ë²„íŠ¼ ë°ì´í„° (Opening/Closingì€ ìƒíƒœì— ë”°ë¼ ë™ì ìœ¼ë¡œ ë³€ê²½)
  const buttonData = [
    'Open Till',
    'Move/Merge',
    'Reservation',
    'Waiting List',
    'Gift Card',
    'Online',
    'Order History',
    'Clock In/Out',
    isDayClosed ? 'Opening' : 'Closing'
  ];

  // ê·¸ë¼ë°ì´ì…˜ ìƒ‰ìƒ ìƒì„± í•¨ìˆ˜ (ë°±ì˜¤í”¼ìŠ¤ì™€ ë™ì¼)
  const generateGradientColors = (count: number) => {
    const startColor = '#75A2BF';
    const endColor = '#2F5F8A';
    
    const colors = [];
    for (let i = 0; i < count; i++) {
      const ratio = i / (count - 1);
      // ê°„ë‹¨í•œ ìƒ‰ìƒ ë³´ê°„
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
  // ë²„íŠ¼ë³„ ìƒ‰ìƒ ë³´ì •: ì¸ë±ìŠ¤ê°€ ë°”ë€ Waiting List / Sold Outì— ë§žì¶° ì§ì ‘ ì§€ì •
  const getButtonColor = (name: string, index: number) => {
    // if (name === 'Waiting List') return '#2F5F8A';
    return gradientColors[index];
  };

  // Togo ì£¼ë¬¸ ëª¨ë‹¬ ì»´í¬ë„ŒíŠ¸
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
              {selectedTogoServer ? `Server: ${formatEmployeeName(selectedTogoServer.employee_name)}` : 'Server: â€”'}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] gap-4 mt-2 flex-1 min-h-0" style={{ overflow: 'visible' }}>
            <div className="space-y-3" style={{ overflow: 'visible' }}>
              <div className="grid gap-1.5" style={{ overflow: 'visible' }}>
                <div className="flex flex-col md:flex-row gap-2" style={{ overflow: 'visible' }}>
                  <div className="relative md:w-[34%] md:flex-none" style={{ overflow: 'visible', zIndex: 100 }} onFocus={handleSuggestionFocus} onBlur={handleSuggestionBlur}>
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
                  <div className="relative md:w-[31%] md:flex-none" style={{ overflow: 'visible', zIndex: 100 }} onFocus={handleSuggestionFocus} onBlur={handleSuggestionBlur}>
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
                          <span className="text-slate-400 mx-1">·</span>
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
                                        {modifiers.length > 0 && <div>· {modifiers.join(', ')}</div>}
                                        {noteText && <div>· {noteText}</div>}
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

  // ê²°ì œ ëª¨ë‹¬ ì»´í¬ë„ŒíŠ¸
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
                    // í…Œì´ë¸” ìƒíƒœë¥¼ Preparingìœ¼ë¡œ ë³€ê²½
                    await fetch(`${API_URL}/table-map/elements/${encodeURIComponent(String(selectedOrder.tableId))}/status`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ status: 'Preparing' })
                    });
                    
                    // ë¡œì»¬ ìƒíƒœ ì—…ë°ì´íŠ¸
                    setTableElements(prev => prev.map(el => 
                      String(el.id) === String(selectedOrder.tableId) 
                        ? { ...el, status: 'Preparing' }
                        : el
                    ));
                    
                    // localStorage ì—…ë°ì´íŠ¸
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
                  alert('ê²°ì œ ì™„ë£Œ ì²˜ë¦¬ ì¤‘ ì˜¤ë¥˜ê°€ ë°œìƒí–ˆìŠµë‹ˆë‹¤.');
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

  // Floor ë³€ê²½ í•¸ë“¤ëŸ¬
  const handleFloorChange = (floor: string) => {
    setSelectedFloor(floor);
    console.log(`Floor changed to: ${floor}`);
    
    // Floor ë³€ê²½ ì‹œ ì¦‰ì‹œ ë°ì´í„° ë¡œë“œ
    const fetchFloorData = async () => {
      try {
        setLoading(true);
        
        // Floor ì´ë¦„ì„ ë°±ì˜¤í”¼ìŠ¤ì™€ ë™ì¼í•˜ê²Œ ì‚¬ìš©
        const apiFloor = floor;
        
        // í…Œì´ë¸” ìš”ì†Œë“¤ ê°€ì ¸ì˜¤ê¸°
        const elementsResponse = await fetch(`${API_URL}/table-map/elements?floor=${apiFloor}`);
        if (elementsResponse.ok) {
          const elements = await elementsResponse.json();
          // ë°ì´í„° ë³€í™˜: text í•„ë“œë¥¼ getElementDisplayNameìœ¼ë¡œ ì„¤ì •
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
          console.warn('í…Œì´ë¸” ìš”ì†Œë¥¼ ê°€ì ¸ì˜¬ ìˆ˜ ì—†ìŠµë‹ˆë‹¤. ê¸°ë³¸ê°’ì„ ì‚¬ìš©í•©ë‹ˆë‹¤.');
          setTableElements([]);
        }

        // í™”ë©´ í¬ê¸° ì„¤ì • ê°€ì ¸ì˜¤ê¸° (ë°±ì˜¤í”¼ìŠ¤ì™€ ë™ì¼í•˜ê²Œ ì‚¬ìš©)
        const screenResponse = await fetch(`${API_URL}/table-map/screen-size?floor=${encodeURIComponent(apiFloor)}&_ts=${Date.now()}` , { cache: 'no-store' as RequestCache });
        if (screenResponse.ok) {
          const screen = await screenResponse.json();
          // ë°±ì˜¤í”¼ìŠ¤ì—ì„œ ì„¤ì •í•œ í™”ë©´ë¹„/í”½ì…€ì„ ê·¸ëŒ€ë¡œ ì ìš©
          setScreenSize({ 
            width: String(screen.width), 
            height: String(screen.height), 
            scale: screen.scale || 1 
          });
        } else {
          console.warn('í™”ë©´ í¬ê¸°ë¥¼ ê°€ì ¸ì˜¬ ìˆ˜ ì—†ìŠµë‹ˆë‹¤. ë°±ì˜¤í”¼ìŠ¤ì™€ ë™ì¼í•œ ê¸°ë³¸ê°’(1024x768)ì„ ì‚¬ìš©í•©ë‹ˆë‹¤.');
          // Auto-detect screen size
          const detectedWidth = window.innerWidth;
          const detectedHeight = window.innerHeight;
          console.log(`🖥️ [Auto-detect] No saved screen size, using current: ${detectedWidth}x${detectedHeight}`);
          setScreenSize({ width: String(detectedWidth), height: String(detectedHeight), scale: 1 });
          
          // Save detected size to DB
          try {
            await fetch(`${API_URL}/table-map/screen-size`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ floor: apiFloor, width: detectedWidth, height: detectedHeight, scale: 1 })
            });
            console.log('✅ [Auto-detect] Screen size saved to database');
          } catch (saveErr) {
            console.warn('⚠️ [Auto-detect] Failed to save screen size:', saveErr);
          }
        }
      } catch (err) {
        console.error('ë°ì´í„° ê°€ì ¸ì˜¤ê¸° ì˜¤ë¥˜:', err);
        setError('ë°ì´í„°ë¥¼ ë¶ˆëŸ¬ì˜¬ ìˆ˜ ì—†ìŠµë‹ˆë‹¤.');
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
          <div className="text-red-500 text-6xl mb-4">âš ï¸</div>
          <p className="text-xl text-gray-600 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-lg font-medium"
          >
            ë‹¤ì‹œ ì‹œë„
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white" ref={pageHostRef}>
      {/* ë©”ì¸ ì½˜í…ì¸  ì˜ì—­ (ì „ì²´ë¥¼ ê³ ì • í•´ìƒë„ í”„ë ˆìž„ì— ë‹´ìŒ) */}
      <div className="pb-0 flex items-start justify-center">
        {!frameReady ? (
          <div className="flex items-center justify-center" style={{ width: '100%', height: '70vh' }}>
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
              <p className="text-sm text-gray-600">í™”ë©´ í¬ê¸° ë¶ˆëŸ¬ì˜¤ëŠ” ì¤‘...</p>
            </div>
          </div>
        ) : (
        <div
          ref={fixedAreaRef}
          style={ {
            width: `${frameWidthPx}px`,
            height: `${frameHeightPx}px`,
            transform: `scale(${scaleFactor})`,
            transformOrigin: 'top left'
          }}
          className="bg-gray-100 relative flex flex-col"
          id="pos-canvas-anchor"
        >
          {/* 1. ìƒë‹¨ ë°” (ê³ ì • ë†’ì´) */}
          <div className="h-14 bg-gradient-to-b from-blue-100 to-blue-50 border-b-2 border-blue-300 shadow-lg grid grid-cols-3 items-center px-4">
            <div className="flex space-x-2 h-3/4 items-center">
              {/* Floor íƒ­ - 1Fë§Œ í™œì„±í™” */}
              {floorList.map((floor) => (
                <div key={floor} className="relative">
                  <button
                    className={`w-auto h-10 px-4 py-2 rounded-lg text-sm font-semibold ${
                      floor === '1F' 
                        ? (selectedFloor === floor
                            ? 'bg-indigo-500 text-white'
                            : 'bg-white text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 border border-gray-200')
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed border border-gray-200'
                    }`}
                    onClick={() => floor === '1F' && handleFloorChange(floor)}
                    disabled={floor !== '1F'}
                    title={floor === '1F' ? `Floor ${floor}ë¡œ ì „í™˜` : 'ë¹„í™œì„±í™”ë¨'}
                  >
                    {floor}
                  </button>
                </div>
              ))}
            </div>
            {/* ì£¼ë¬¸ì±„ë„ íƒ­ (ì¤‘ì•™) - Deliveryë§Œ í‘œì‹œ */}
            <div className="flex justify-center">
              <button
                className="h-9 px-3 mx-1 rounded-md text-sm font-medium border transition-colors bg-purple-600 border-purple-600 text-white"
                onClick={() => setSelectedChannelTab('delivery')}
                title="Delivery"
              >
                Delivery
              </button>
            </div>
            {/* EXIT ë²„íŠ¼ (ì˜¤ë¥¸ìª½) */}
            <div className="flex justify-end">
              <button
                className="h-10 px-5 rounded-lg text-sm font-bold bg-red-600 text-white hover:bg-red-700 border-2 border-red-700 shadow-md transition-all"
                onClick={() => setShowExitModal(true)}
                title="Exit Menu"
              >
                EXIT
              </button>
            </div>
          </div>

          {/* 2. ì¤‘ì•™ ì˜ì—­ (í”„ë ˆìž„ ë†’ì´ì—ì„œ í—¤ë”/í‘¸í„° ì œì™¸) */}
          <div className="flex-1 flex" style={{ height: `${contentHeightPx}px`, width: `${frameWidthPx}px` }}>
            {/* 3. ì¢Œì¸¡ 66% - Table Map ì˜ì—­ */}
            <div 
              className="relative"
              style={{ width: `${leftWidthPx}px`, height: `${contentHeightPx}px` }}
            >
              {/* Move/Merge & Print Bill ëª¨ë“œ ìƒíƒœ í‘œì‹œ */}
              {(isMoveMergeMode || isBillPrintMode) && (moveMergeStatus || billPrintStatus) && (
                <div className="absolute top-2 left-1/2 transform -translate-x-1/2 z-50 px-4 py-2 rounded-lg shadow-lg text-white font-semibold text-sm"
                  style={{
                    backgroundColor: isBillPrintMode ? 'rgba(16, 185, 129, 0.95)' : 'rgba(139, 92, 246, 0.95)',
                    maxWidth: '90%'
                  }}>
                  {isBillPrintMode ? billPrintStatus : moveMergeStatus}
                </div>
              )}
              {/* í…Œì´ë¸”ë§µ ìº”ë²„ìŠ¤ (BOì™€ ë™ì¼ ê³ ì • í•´ìƒë„ ì ìš©) */}
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
                      <p className="text-sm text-gray-600">ë°ì´í„° ë¡œë”© ì¤‘...</p>
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

          {/* 4. ìš°ì¸¡ 34% - Togo/Delivery Order í˜„í™©íŒ */}
          <div className="bg-blue-50 border-l border-gray-300 relative flex flex-col overflow-hidden" style={{ width: `${rightWidthPx}px`, height: `${contentHeightPx}px`, zIndex: 10 }}>
            {/* ìƒë‹¨ ê³ ì • ë²„íŠ¼ ì˜ì—­ */}
            <div className="flex gap-2 p-2 pb-1 flex-shrink-0">
              <button
                onClick={handleNewDeliveryClick}
                className="flex-1 py-2 min-h-[40px] bg-purple-600 hover:bg-purple-700 text-white text-sm font-bold rounded-lg shadow-md transition-all"
              >
                Delivery
              </button>
              <button
                onClick={handleNewTogoClick}
                className="flex-1 py-2 min-h-[40px] bg-green-700 hover:bg-green-800 text-white text-sm font-bold rounded-lg shadow-md transition-all"
              >
                Togo
              </button>
            </div>
            {/* ìŠ¤í¬ë¡¤ ê°€ëŠ¥í•œ ì£¼ë¬¸ ëª©ë¡ ì˜ì—­ */}
            <div className="flex-1 overflow-auto px-2 pb-[85px]">
              <div className="grid grid-cols-2 gap-1">
                {/* ì™¼ìª½: Delivery ì£¼ë¬¸ ëª©ë¡ */}
                <div className="space-y-1">
                  {(() => {
                    const deliveryFiltered = togoOrders.filter(order => 
                      String(order.fulfillment || '').toLowerCase() === 'delivery' ||
                      String(order.type || '').toLowerCase() === 'delivery' ||
                      order.deliveryCompany
                    );
                    console.log('ðŸš— [UI] togoOrders total:', togoOrders.length);
                    console.log('ðŸš— [UI] deliveryFiltered:', deliveryFiltered.length, deliveryFiltered);
                    return deliveryFiltered;
                  })()
                    .sort((a, b) => (a.readyTimeLabel || '99:99').localeCompare(b.readyTimeLabel || '99:99'))
                    .map(order => {
                      const isSourceTogo = isMoveMergeMode && sourceTogoOrder?.id === order.id;
                      const isTargetSelectable = isMoveMergeMode && (
                        (sourceTableId && selectionChoice) || 
                        (sourceTogoOrder && sourceTogoOrder.id !== order.id) ||
                        (sourceOnlineOrder)
                      );
                      let backgroundColor = '#E9D5FF';
                      let borderColor = '#C084FC';
                      let borderWidth = 1;
                      if (isSourceTogo) {
                        backgroundColor = '#A78BFA';
                        borderColor = '#7C3AED';
                        borderWidth = 4;
                      } else if (isTargetSelectable) {
                        backgroundColor = '#D4B8E8';
                        borderColor = '#8B5CF6';
                        borderWidth = 3;
                      }
                      return (
                        <button 
                          key={`delivery-${order.id}`}
                          className={`w-full rounded-lg p-1 shadow-inner border transition-all duration-200 text-left hover:shadow-lg ${isTargetSelectable && !isSourceTogo ? 'animate-pulse' : ''}`}
                          style={{ backgroundColor, borderColor, borderWidth }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleVirtualOrderCardClick('delivery', order);
                          }}
                        >
                          {/* ìœ—ì¤„: ë”œë¦¬ë²„ë¦¬ì±„ë„(ë³¼ë“œ) / ë”œë¦¬ë²„ë¦¬ì£¼ë¬¸ë²ˆí˜¸(ë³¼ë“œ) */}
                          <div className="text-[13px] text-gray-800 mb-0.5 flex items-center">
                            <span className="text-purple-700 font-bold">{order.deliveryCompany || 'Delivery'}</span>
                            <span className="mx-1 text-gray-400">/</span>
                            <span className="font-bold text-gray-900">#{order.deliveryOrderNumber || order.id}</span>
                          </div>
                          {/* ì•„ëž«ì¤„: í”½ì—…íƒ€ìž„ */}
                          <div className="text-[12px] text-gray-600">
                            Ready: {order.readyTimeLabel || '--:--'}
                          </div>
                        </button>
                      );
                    })}
                  {togoOrders.filter(order => 
                    String(order.fulfillment || '').toLowerCase() === 'delivery' ||
                    String(order.type || '').toLowerCase() === 'delivery' ||
                    order.deliveryCompany
                  ).length === 0 && (
                    <div className="text-center text-gray-400 text-xs py-4">No Delivery Orders</div>
                  )}
                </div>
                
                {/* ì˜¤ë¥¸ìª½: Togo + Online í†µí•© ì£¼ë¬¸ë¦¬ìŠ¤íŠ¸ - í”½ì—…ì‹œê°„ ì˜¤ë¦„ì°¨ìˆœ ì •ë ¬ */}
                <div className="space-y-1">
                  {(() => {
                    // Togo (delivery ì œì™¸)ì™€ Onlineì„ í•©ì³ì„œ í”½ì—…ì‹œê°„ ìˆœìœ¼ë¡œ ì •ë ¬
                    const getPickupTimeMs = (order: any, type: 'togo' | 'online'): number => {
                      if (type === 'togo') {
                        const label = order.readyTimeLabel || '99:99';
                        const [h, m] = label.split(':').map(Number);
                        if (!isNaN(h) && !isNaN(m)) {
                          const now = new Date();
                          now.setHours(h, m, 0, 0);
                          return now.getTime();
                        }
                        return Infinity;
                      } else {
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
                      }
                    };
                    const combinedOrders: Array<{ order: any; type: 'togo' | 'online'; pickupMs: number }> = [
                      ...togoOrders
                        .filter(o => 
                          String(o.fulfillment || '').toLowerCase() !== 'delivery' &&
                          String(o.type || '').toLowerCase() !== 'delivery' &&
                          !o.deliveryCompany
                        )
                        .map(o => ({ order: o, type: 'togo' as const, pickupMs: getPickupTimeMs(o, 'togo') })),
                      ...onlineQueueCards.map(o => ({ order: o, type: 'online' as const, pickupMs: getPickupTimeMs(o, 'online') })),
                    ];
                    combinedOrders.sort((a, b) => a.pickupMs - b.pickupMs);
                    return combinedOrders.map(({ order, type }) => {
                      if (type === 'togo') {
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
                          backgroundColor = '#A78BFA';
                          borderColor = '#7C3AED';
                          borderWidth = 4;
                        } else if (isTargetSelectable) {
                          backgroundColor = '#D4B8E8';
                          borderColor = '#8B5CF6';
                          borderWidth = 3;
                        }
                        return (
                          <button 
                            key={`togo-${order.id}`}
                            className={`w-full rounded-lg p-1 shadow-inner border transition-all duration-200 text-left hover:shadow-lg ${isTargetSelectable && !isSourceTogo ? 'animate-pulse' : ''}`}
                            style={{ backgroundColor, borderColor, borderWidth }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleVirtualOrderCardClick('togo', order);
                            }}
                          >
                            {/* ìœ—ì¤„: Togo(ë³¼ë“œ), ì£¼ë¬¸ë²ˆí˜¸(ë³¼ë“œ), í”½ì—…ì‹œê°„ */}
                            <div className="text-[13px] text-gray-800 mb-0.5 flex items-center">
                              <span className="w-[40px] text-left text-green-700 font-bold">Togo</span>
                              <span className="flex-1 text-center font-bold">#{order.id ?? 'â€”'}</span>
                              <span className="text-gray-900 text-right">{order.readyTimeLabel || '--:--'}</span>
                            </div>
                            {/* ì•„ëž«ì¤„: ì „í™”ë²ˆí˜¸(ë³¼ë“œ), ê³ ê°ì´ë¦„ */}
                            <div className="text-[12px] text-gray-700 flex justify-between">
                              <span className="font-bold text-gray-900 truncate pr-1">{formatOrderPhoneDisplay(order.phone) || 'â€”'}</span>
                              <span className="text-gray-800 truncate text-right">{order.name || ''}</span>
                            </div>
                          </button>
                        );
                      } else {
                        // Online ì¹´ë“œ ë Œë”ë§
                        const card = order;
                        const isSourceOnline = isMoveMergeMode && sourceOnlineOrder?.id === card.id;
                        const isTargetSelectable = isMoveMergeMode && sourceTableId && selectionChoice;
                        let backgroundColor = '#B1C4DD';
                        let borderColor = '#9BB3D1';
                        let borderWidth = 1;
                        if (isSourceOnline) {
                          backgroundColor = '#A78BFA';
                          borderColor = '#7C3AED';
                          borderWidth = 4;
                        } else if (isTargetSelectable) {
                          backgroundColor = '#D4B8E8';
                          borderColor = '#8B5CF6';
                          borderWidth = 3;
                        }
                        return (
                          <button
                            key={`online-${card.id}`}
                            className={`w-full rounded-lg p-1 shadow-inner border transition-all duration-200 text-left hover:shadow-lg ${isTargetSelectable && !isSourceOnline ? 'animate-pulse' : ''}`}
                            style={{ backgroundColor, borderColor, borderWidth }}
                            onClick={() => handleVirtualOrderCardClick('online', card)}
                          >
                            {/* ìœ—ì¤„: Online(ë³¼ë“œ), ì£¼ë¬¸ë²ˆí˜¸(ë³¼ë“œ), í”½ì—…ì‹œê°„ */}
                            <div className="text-[13px] text-gray-800 mb-0.5 flex items-center">
                              <span className="w-[45px] text-left text-blue-700 font-bold">Online</span>
                              <span className="flex-1 text-center font-bold">#{card.number}</span>
                              <span className="text-gray-900 text-right">{card.time}</span>
                            </div>
                            {/* ì•„ëž«ì¤„: ì „í™”ë²ˆí˜¸(ë³¼ë“œ), ê³ ê°ì´ë¦„ */}
                            <div className="text-[12px] text-gray-700 flex justify-between">
                              <span className="font-bold text-gray-900">{card.phone}</span>
                              <span className="text-right">{card.name}</span>
                            </div>
                          </button>
                        );
                      }
                    });
                  })()}
                </div>
              </div>
            </div>

            {/* í•˜ë‹¨ í”Œë¡œíŒ… ì˜ˆì•½ í˜„í™© - Online+Togo ê·¸ë¦¬ë“œì™€ ë™ì¼í•œ ë„ˆë¹„ */}
            <div className="absolute bg-amber-50/95 border border-amber-300 rounded-lg px-3 py-2 shadow-[0_-4px_12px_rgba(0,0,0,0.15)] z-[100] backdrop-blur-sm" style={{ height: '72px', left: '8px', right: '20px', bottom: '3px' }}>
              <div className="flex items-center justify-between mb-1">
                <div className="text-amber-800 text-xs font-bold flex items-center gap-1.5">
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
                      <span className="text-gray-800 text-xs font-bold truncate max-w-[70px]">{res.customer_name || res.name || 'â€”'}</span>
                      <span className="bg-amber-100 text-amber-800 text-[9px] font-black px-1 py-0.5 rounded">p{res.party_size || res.guests || 0}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          </div>
          {/* 3. í•˜ë‹¨ ì•¡ì…˜ ë°” (í”„ë ˆìž„ ë‚´ë¶€) */}
          <div className="bg-gray-200 border-t border-gray-300 py-1.5 pl-3 pr-3" style={{ height: '70px' }}>
            <div className="grid grid-cols-9 h-full w-full gap-1">
              {buttonData.map((buttonName, index) => {
                const isMoveMergeActive = buttonName === 'Move/Merge' && isMoveMergeMode;
                const isBillPrintActive = buttonName === 'Online' && isBillPrintMode;
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
        
        {/* Online Settings Modal (Prep Time, Pause, Day Off, Order Type) */}
        {showPrepTimeModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div 
              className="bg-white rounded-xl shadow-2xl w-[644px]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-center px-5 py-3 bg-slate-700 rounded-t-xl">
                <h2 className="text-lg font-bold text-white">Online Settings</h2>
              </div>
              
              {/* Tabs - ìž…ì²´ê° ìžˆëŠ” ë²„íŠ¼ */}
              <div className="flex gap-2 p-3 bg-gray-100">
                <button
                  onClick={() => setOnlineModalTab('preptime')}
                  className={`flex-1 py-4 text-lg font-bold rounded-lg transition-all ${onlineModalTab === 'preptime' ? 'bg-white text-blue-700 shadow-md border-2 border-blue-400' : 'bg-gray-200 text-gray-600 hover:bg-gray-300 border-2 border-transparent'}`}
                >
                  Prep Time
                </button>
                <button
                  onClick={() => setOnlineModalTab('pause')}
                  className={`flex-1 py-4 text-lg font-bold rounded-lg transition-all ${onlineModalTab === 'pause' ? 'bg-white text-orange-700 shadow-md border-2 border-orange-400' : 'bg-gray-200 text-gray-600 hover:bg-gray-300 border-2 border-transparent'}`}
                >
                  Pause
                </button>
                <button
                  onClick={() => setOnlineModalTab('dayoff')}
                  className={`flex-1 py-4 text-lg font-bold rounded-lg transition-all ${onlineModalTab === 'dayoff' ? 'bg-white text-red-700 shadow-md border-2 border-red-400' : 'bg-gray-200 text-gray-600 hover:bg-gray-300 border-2 border-transparent'}`}
                >
                  Day Off
                </button>
                <button
                  onClick={() => setOnlineModalTab('menuhide')}
                  className={`flex-1 py-4 text-lg font-bold rounded-lg transition-all ${onlineModalTab === 'menuhide' ? 'bg-white text-purple-700 shadow-md border-2 border-purple-400' : 'bg-gray-200 text-gray-600 hover:bg-gray-300 border-2 border-transparent'}`}
                >
                  Menu Hide
                </button>
              </div>
              
              {/* Tab Content - ê³ ì • ë†’ì´ (15% ì¦ê°€) */}
              <div className="p-4 h-[437px] overflow-auto">
                {/* Prep Time Tab */}
                {onlineModalTab === 'preptime' && (
                <div className="flex flex-col h-full">
                <table className="w-full border-collapse flex-1">
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
                    <tr className="border-b border-gray-200">
                      <td className="py-4">
                        <span className="text-base font-bold text-gray-800">TheZoneOrder</span>
                      </td>
                      <td className="py-4">
                        <div className="flex justify-center">
                          <div className="inline-flex bg-gray-100 rounded-lg p-1">
                            <button
                              onClick={() => setPrepTimeSettings(prev => ({ ...prev, thezoneorder: { ...prev.thezoneorder, mode: 'auto' } }))}
                              className={`px-5 py-2.5 rounded-md text-sm font-semibold transition-all ${prepTimeSettings.thezoneorder.mode === 'auto' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                              Auto
                            </button>
                            <button
                              onClick={() => setPrepTimeSettings(prev => ({ ...prev, thezoneorder: { ...prev.thezoneorder, mode: 'manual' } }))}
                              className={`px-5 py-2.5 rounded-md text-sm font-semibold transition-all ${prepTimeSettings.thezoneorder.mode === 'manual' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                              Manual
                            </button>
                          </div>
                        </div>
                      </td>
                      <td className="py-4">
                        <select
                          value={prepTimeSettings.thezoneorder.time}
                          onChange={(e) => setPrepTimeSettings(prev => ({ ...prev, thezoneorder: { ...prev.thezoneorder, time: e.target.value } }))}
                          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-base font-semibold text-center bg-white focus:outline-none focus:ring-2 focus:ring-gray-500"
                        >
                          {['10m', '15m', '20m', '25m', '30m', '45m', '1h'].map((time) => (
                            <option key={time} value={time}>{time}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-4 pl-3">
                        <button
                          onClick={() => setPrepTimeSettings(prev => ({
                            ...prev,
                            ubereats: { ...prev.ubereats, time: prev.thezoneorder.time },
                            doordash: { ...prev.doordash, time: prev.thezoneorder.time },
                            skipthedishes: { ...prev.skipthedishes, time: prev.thezoneorder.time },
                          }))}
                          className="px-3 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-semibold whitespace-nowrap"
                        >
                          Apply All
                        </button>
                      </td>
                    </tr>

                    {/* UberEats */}
                    <tr className="border-b border-gray-200">
                      <td className="py-4">
                        <span className="text-base font-bold text-gray-800">UberEats</span>
                      </td>
                      <td className="py-4">
                        <div className="flex justify-center">
                          <div className="inline-flex bg-gray-100 rounded-lg p-1">
                            <button
                              onClick={() => setPrepTimeSettings(prev => ({ ...prev, ubereats: { ...prev.ubereats, mode: 'auto' } }))}
                              className={`px-5 py-2.5 rounded-md text-sm font-semibold transition-all ${prepTimeSettings.ubereats.mode === 'auto' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                              Auto
                            </button>
                            <button
                              onClick={() => setPrepTimeSettings(prev => ({ ...prev, ubereats: { ...prev.ubereats, mode: 'manual' } }))}
                              className={`px-5 py-2.5 rounded-md text-sm font-semibold transition-all ${prepTimeSettings.ubereats.mode === 'manual' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                              Manual
                            </button>
                          </div>
                        </div>
                      </td>
                      <td className="py-4">
                        <select
                          value={prepTimeSettings.ubereats.time}
                          onChange={(e) => setPrepTimeSettings(prev => ({ ...prev, ubereats: { ...prev.ubereats, time: e.target.value } }))}
                          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-base font-semibold text-center bg-white focus:outline-none focus:ring-2 focus:ring-gray-500"
                        >
                          {['10m', '15m', '20m', '25m', '30m', '45m', '1h'].map((time) => (
                            <option key={time} value={time}>{time}</option>
                          ))}
                        </select>
                      </td>
                      <td></td>
                    </tr>

                    {/* DoorDash */}
                    <tr className="border-b border-gray-200">
                      <td className="py-4">
                        <span className="text-base font-bold text-gray-800">DoorDash</span>
                      </td>
                      <td className="py-4">
                        <div className="flex justify-center">
                          <div className="inline-flex bg-gray-100 rounded-lg p-1">
                            <button
                              onClick={() => setPrepTimeSettings(prev => ({ ...prev, doordash: { ...prev.doordash, mode: 'auto' } }))}
                              className={`px-5 py-2.5 rounded-md text-sm font-semibold transition-all ${prepTimeSettings.doordash.mode === 'auto' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                              Auto
                            </button>
                            <button
                              onClick={() => setPrepTimeSettings(prev => ({ ...prev, doordash: { ...prev.doordash, mode: 'manual' } }))}
                              className={`px-5 py-2.5 rounded-md text-sm font-semibold transition-all ${prepTimeSettings.doordash.mode === 'manual' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                              Manual
                            </button>
                          </div>
                        </div>
                      </td>
                      <td className="py-4">
                        <select
                          value={prepTimeSettings.doordash.time}
                          onChange={(e) => setPrepTimeSettings(prev => ({ ...prev, doordash: { ...prev.doordash, time: e.target.value } }))}
                          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-base font-semibold text-center bg-white focus:outline-none focus:ring-2 focus:ring-gray-500"
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
                      <td className="py-4">
                        <span className="text-base font-bold text-gray-800">SkipTheDishes</span>
                      </td>
                      <td className="py-4">
                        <div className="flex justify-center">
                          <div className="inline-flex bg-gray-100 rounded-lg p-1">
                            <button
                              onClick={() => setPrepTimeSettings(prev => ({ ...prev, skipthedishes: { ...prev.skipthedishes, mode: 'auto' } }))}
                              className={`px-5 py-2.5 rounded-md text-sm font-semibold transition-all ${prepTimeSettings.skipthedishes.mode === 'auto' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                              Auto
                            </button>
                            <button
                              onClick={() => setPrepTimeSettings(prev => ({ ...prev, skipthedishes: { ...prev.skipthedishes, mode: 'manual' } }))}
                              className={`px-5 py-2.5 rounded-md text-sm font-semibold transition-all ${prepTimeSettings.skipthedishes.mode === 'manual' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                              Manual
                            </button>
                          </div>
                        </div>
                      </td>
                      <td className="py-4">
                        <select
                          value={prepTimeSettings.skipthedishes.time}
                          onChange={(e) => setPrepTimeSettings(prev => ({ ...prev, skipthedishes: { ...prev.skipthedishes, time: e.target.value } }))}
                          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-base font-semibold text-center bg-white focus:outline-none focus:ring-2 focus:ring-gray-500"
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
                {/* Save Button */}
                <div className="mt-2 pt-2 border-t border-gray-200">
                  <button
                    onClick={async () => {
                      try {
                        const response = await fetch(`${API_URL}/online-orders/prep-time-settings`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ settings: prepTimeSettings })
                        });
                        const data = await response.json();
                        if (data.success) {
                          alert('Prep Time settings saved successfully!');
                        } else {
                          alert('Failed to save: ' + (data.error || 'Unknown error'));
                        }
                      } catch (error) {
                        console.error('Prep Time save error:', error);
                        alert('Failed to save settings');
                      }
                    }}
                    className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-lg font-bold shadow-md transition-all"
                  >
                    Save
                  </button>
                </div>
                </div>
                )}
                
                {/* Pause Tab */}
                {onlineModalTab === 'pause' && (
                  <div className="flex flex-col h-full justify-between">
                    {/* ìƒë‹¨: í˜„ìž¬ ì‹œê°„ & Resume at & Resume All */}
                    <div className="flex items-center justify-between p-3 bg-slate-100 rounded-lg">
                      <div className="flex items-center gap-4">
                        <div className="text-center">
                          <div className="text-xs text-gray-500">Now</div>
                          <div className="text-xl font-bold text-gray-800">{new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
                        </div>
                        <div className="text-2xl text-gray-400">→</div>
                        <div className="text-center">
                          <div className="text-xs text-gray-500">Resume at</div>
                          <div className="text-xl font-bold text-orange-600">
                            {(() => {
                              const pausedChannels = (['thezoneorder', 'ubereats', 'doordash', 'skipthedishes'] as const).filter(ch => pauseSettings[ch].pauseUntil);
                              if (pausedChannels.length > 0 && pauseSettings[pausedChannels[0]].pauseUntil) {
                                return pauseSettings[pausedChannels[0]].pauseUntil!.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                              }
                              if (selectedPauseDuration) {
                                const durationMap: { [key: string]: number } = { '15m': 15, '30m': 30, '1h': 60, '2h': 120, '3h': 180, '4h': 240, '5h': 300, 'Today': -1 };
                                const min = durationMap[selectedPauseDuration];
                                if (min !== undefined) {
                                  const previewTime = min === -1 ? new Date(new Date().setHours(23, 59, 59, 999)) : new Date(Date.now() + min * 60000);
                                  return previewTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                                }
                              }
                              return '--:--';
                            })()}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          const restaurantId = localStorage.getItem('firebaseRestaurantId');
                          if (!restaurantId) { alert('Restaurant ID not found'); return; }
                          try {
                            await fetch(`${API_URL}/online-orders/resume/${restaurantId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
                            setPauseSettings({ thezoneorder: { paused: false, pauseUntil: null }, ubereats: { paused: false, pauseUntil: null }, doordash: { paused: false, pauseUntil: null }, skipthedishes: { paused: false, pauseUntil: null } });
                            setSelectedPauseDuration(null);
                          } catch (error) { console.error('Resume failed:', error); alert('Resume failed'); }
                        }}
                        className="px-5 py-3 bg-green-500 hover:bg-green-600 text-white rounded-lg text-base font-bold shadow-md"
                      >
                        Resume All
                      </button>
                    </div>
                    
                    {/* ì¤‘ê°„: ì±„ë„ ì„ íƒ */}
                    <div className="p-3 bg-gray-50 rounded-lg border">
                      <div className="grid grid-cols-5 gap-3">
                        <button
                          onClick={() => {
                            const allSelected = ['thezoneorder', 'ubereats', 'doordash', 'skipthedishes'].every(ch => pauseSettings[ch as keyof typeof pauseSettings].paused);
                            setPauseSettings(prev => ({
                              thezoneorder: { ...prev.thezoneorder, paused: !allSelected },
                              ubereats: { ...prev.ubereats, paused: !allSelected },
                              doordash: { ...prev.doordash, paused: !allSelected },
                              skipthedishes: { ...prev.skipthedishes, paused: !allSelected },
                            }));
                          }}
                          className={`py-4 rounded-lg text-base font-bold transition-all border-2 ${
                            ['thezoneorder', 'ubereats', 'doordash', 'skipthedishes'].every(ch => pauseSettings[ch as keyof typeof pauseSettings].paused)
                              ? 'bg-gray-700 text-white border-gray-800'
                              : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
                          }`}
                        >
                          All
                        </button>
                        {(['thezoneorder', 'ubereats', 'doordash', 'skipthedishes'] as const).map((channel) => {
                          const labels = { thezoneorder: 'TZO', ubereats: 'Uber', doordash: 'Door', skipthedishes: 'Skip' };
                          const isSelected = pauseSettings[channel].paused;
                          return (
                            <button
                              key={channel}
                              onClick={() => setPauseSettings(prev => ({ ...prev, [channel]: { ...prev[channel], paused: !prev[channel].paused } }))}
                              className={`py-4 rounded-lg text-base font-bold transition-all border-2 ${isSelected ? 'bg-orange-500 text-white border-orange-600' : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'}`}
                            >
                              {labels[channel]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    
                    {/* í•˜ë‹¨: Pause ì‹œê°„ ì„ íƒ - 4x2 ê·¸ë¦¬ë“œ */}
                    <div className="p-3 bg-gray-50 rounded-lg border">
                      <div className="grid grid-cols-4 gap-3">
                        {[
                          { label: '15m', min: 15 },
                          { label: '30m', min: 30 },
                          { label: '1h', min: 60 },
                          { label: '2h', min: 120 },
                          { label: '3h', min: 180 },
                          { label: '4h', min: 240 },
                          { label: '5h', min: 300 },
                          { label: 'Today', min: -1 },
                        ].map(({ label, min }) => (
                          <button
                            key={label}
                            onClick={() => {
                              setSelectedPauseDuration(label);
                              const pauseUntil = min === -1 
                                ? new Date(new Date().setHours(23, 59, 59, 999)) 
                                : new Date(Date.now() + min * 60000);
                              setPauseSettings(prev => {
                                const updated = { ...prev };
                                (['thezoneorder', 'ubereats', 'doordash', 'skipthedishes'] as const).forEach((ch) => {
                                  if (prev[ch].paused) {
                                    updated[ch] = { paused: true, pauseUntil };
                                  }
                                });
                                return updated;
                              });
                            }}
                            className={`py-4 rounded-lg text-base font-bold transition-all border-2 ${
                              selectedPauseDuration === label 
                                ? 'bg-orange-600 text-white border-orange-700 shadow-md' 
                                : 'bg-orange-100 text-orange-700 border-orange-300 hover:bg-orange-200'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* Save Button */}
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <button
                        onClick={async () => {
                          try {
                            const response = await fetch(`${API_URL}/online-orders/pause-settings`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ 
                                settings: {
                                  thezoneorder: { paused: pauseSettings.thezoneorder.paused, pausedUntil: pauseSettings.thezoneorder.pauseUntil?.toISOString() || null },
                                  ubereats: { paused: pauseSettings.ubereats.paused, pausedUntil: pauseSettings.ubereats.pauseUntil?.toISOString() || null },
                                  doordash: { paused: pauseSettings.doordash.paused, pausedUntil: pauseSettings.doordash.pauseUntil?.toISOString() || null },
                                  skipthedishes: { paused: pauseSettings.skipthedishes.paused, pausedUntil: pauseSettings.skipthedishes.pauseUntil?.toISOString() || null },
                                }
                              })
                            });
                            const data = await response.json();
                            if (data.success) {
                              alert('Pause settings saved successfully!');
                            } else {
                              alert('Failed to save: ' + (data.error || 'Unknown error'));
                            }
                          } catch (error) {
                            console.error('Pause save error:', error);
                            alert('Failed to save settings');
                          }
                        }}
                        className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-lg font-bold shadow-md transition-all"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                )}
                
                {/* Day Off Tab - Firebase ìŠ¤íƒ€ì¼ ë ˆì´ì•„ì›ƒ */}
                {onlineModalTab === 'dayoff' && (
                  <div className="flex flex-col h-full">
                    {/* ìƒë‹¨: 3-column ë ˆì´ì•„ì›ƒ */}
                    <div className="flex gap-3 flex-1">
                      {/* ì™¼ìª½: Channels (16%) */}
                      <div className="flex flex-col bg-gray-50 rounded-lg p-3 border border-gray-200" style={{ width: '16%' }}>
                        <div className="text-sm font-bold text-orange-500 mb-2">Channels</div>
                        <div className="space-y-2">
                          {[
                            { id: 'all', name: 'All' },
                            { id: 'thezoneorder', name: 'TZO' },
                            { id: 'ubereats', name: 'Uber' },
                            { id: 'doordash', name: 'Door' },
                            { id: 'skipthedishes', name: 'Skip' },
                          ].map((channel) => {
                            const isAllSelected = dayOffSelectedChannels.includes('all');
                            const isSelected = channel.id === 'all' 
                              ? isAllSelected
                              : isAllSelected || dayOffSelectedChannels.includes(channel.id);
                            return (
                              <button
                                key={channel.id}
                                onClick={() => toggleDayOffChannel(channel.id)}
                                className={`
                                  w-full py-2 px-2 rounded-lg text-sm font-semibold text-center transition-all border-2
                                  ${isSelected 
                                    ? 'bg-orange-500 text-white border-orange-600' 
                                    : 'bg-white text-gray-600 hover:bg-gray-100 border-orange-300'}
                                `}
                              >
                                {channel.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      
                      {/* ì¤‘ì•™: ìº˜ë¦°ë” (54%) */}
                      <div className="flex flex-col bg-gray-50 rounded-lg p-3 border border-gray-200" style={{ width: '54%' }}>
                        {/* ìº˜ë¦°ë” í—¤ë” */}
                        <div className="flex items-center justify-between mb-2">
                          <button
                            onClick={() => setDayOffCalendarMonth(new Date(dayOffCalendarMonth.getFullYear(), dayOffCalendarMonth.getMonth() - 1, 1))}
                            className="p-1.5 bg-blue-500 hover:bg-blue-600 rounded-lg transition text-white"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                          </button>
                          <div className="text-base font-bold text-gray-800">
                            {dayOffCalendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                          </div>
                          <button
                            onClick={() => setDayOffCalendarMonth(new Date(dayOffCalendarMonth.getFullYear(), dayOffCalendarMonth.getMonth() + 1, 1))}
                            className="p-1.5 bg-blue-500 hover:bg-blue-600 rounded-lg transition text-white"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                        </div>
                        
                        {/* ìš”ì¼ í—¤ë” */}
                        <div className="grid grid-cols-7 gap-1 mb-1">
                          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
                            <div key={idx} className="text-center text-xs font-semibold text-gray-500 py-1">
                              {day}
                            </div>
                          ))}
                        </div>
                        
                        {/* ìº˜ë¦°ë” ê·¸ë¦¬ë“œ */}
                        <div className="grid grid-cols-7 gap-1 flex-1">
                          {(() => {
                            const year = dayOffCalendarMonth.getFullYear();
                            const month = dayOffCalendarMonth.getMonth();
                            const firstDay = new Date(year, month, 1).getDay();
                            const daysInMonth = new Date(year, month + 1, 0).getDate();
                            const today = new Date().toISOString().split('T')[0];
                            const cells = [];
                            
                            // ë¹ˆ ì…€ (ì´ì „ ë‹¬)
                            for (let i = 0; i < firstDay; i++) {
                              cells.push(<div key={`empty-${i}`} className="h-8" />);
                            }
                            
                            // ë‚ ì§œ ì…€
                            for (let day = 1; day <= daysInMonth; day++) {
                              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                              const savedDayOff = dayOffDates.find(d => d.date === dateStr);
                              const isSavedDayOff = !!savedDayOff;
                              const isSelected = dayOffSelectedDates.includes(dateStr);
                              const isToday = dateStr === today;
                              const isPast = dateStr < today;
                              
                              cells.push(
                                <button
                                  key={dateStr}
                                  onClick={() => !isPast && toggleDayOffSelection(dateStr)}
                                  disabled={isPast}
                                  className={`
                                    h-8 rounded-lg text-sm font-semibold transition-all
                                    ${isPast ? 'text-gray-300 cursor-not-allowed' : 'hover:bg-white cursor-pointer'}
                                    ${isSavedDayOff ? (savedDayOff?.type === 'closed' ? 'bg-red-500 text-white' : savedDayOff?.type === 'extended' ? 'bg-green-500 text-white' : savedDayOff?.type === 'early' ? 'bg-yellow-500 text-white' : 'bg-purple-500 text-white') : ''}
                                    ${isSelected && !isSavedDayOff ? 'bg-blue-500 text-white' : ''}
                                    ${isToday && !isSavedDayOff && !isSelected ? 'ring-2 ring-blue-400' : ''}
                                  `}
                                >
                                  {day}
                                </button>
                              );
                            }
                            
                            return cells;
                          })()}
                        </div>
                      </div>
                      
                      {/* ì˜¤ë¥¸ìª½: Type + Add Schedule (30%) */}
                      <div className="flex flex-col bg-gray-50 rounded-lg p-3 border border-gray-200" style={{ width: '30%' }}>
                        <div className="text-xs font-bold text-gray-700 mb-1">Type</div>
                        {/* Type ì„ íƒ - 2x2 ê·¸ë¦¬ë“œ (í„°ì¹˜ ì¹œí™”ì ) */}
                        <div className="grid grid-cols-2 gap-1.5 mb-2">
                          {[
                            { id: 'closed', name: 'Closed', color: 'red' },
                            { id: 'extended', name: 'Ext Open', color: 'green' },
                            { id: 'early', name: 'Early Close', color: 'yellow' },
                            { id: 'late', name: 'Late Open', color: 'purple' },
                          ].map((type) => (
                            <button
                              key={type.id}
                              onClick={() => setDayOffType(type.id as 'closed' | 'extended' | 'early' | 'late')}
                              className={`
                                py-2.5 px-1 rounded-lg text-xs font-bold text-center transition-all min-h-[40px]
                                ${dayOffType === type.id 
                                  ? type.id === 'closed' ? 'bg-red-500 text-white shadow-md' 
                                    : type.id === 'extended' ? 'bg-green-500 text-white shadow-md'
                                    : type.id === 'early' ? 'bg-yellow-500 text-white shadow-md'
                                    : 'bg-purple-500 text-white shadow-md'
                                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-300 active:bg-gray-300'}
                              `}
                            >
                              {type.name}
                            </button>
                          ))}
                        </div>
                        
                        {/* ì‹œê°„ ì„ íƒ (Closedê°€ ì•„ë‹ ë•Œë§Œ í‘œì‹œ) */}
                        {dayOffType !== 'closed' && (
                          <div className="mb-2 p-2 bg-white rounded-lg border border-gray-200">
                            <div className="text-xs text-gray-500 mb-1 font-medium">
                              {dayOffType === 'extended' ? 'Open Until' : dayOffType === 'early' ? 'Close At' : 'Open At'}
                            </div>
                            <select
                              value={dayOffType === 'late' ? dayOffTime.start : dayOffTime.end}
                              onChange={(e) => setDayOffTime(prev => 
                                dayOffType === 'late' 
                                  ? { ...prev, start: e.target.value }
                                  : { ...prev, end: e.target.value }
                              )}
                              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm font-medium"
                            >
                              {Array.from({ length: 24 }, (_, i) => {
                                const hour = i.toString().padStart(2, '0');
                                return <option key={hour} value={`${hour}:00`}>{hour}:00</option>;
                              })}
                            </select>
                          </div>
                        )}
                        
                        {/* ì„ íƒ ì •ë³´ í‘œì‹œ */}
                        <div className="text-xs text-gray-500 mb-2 text-center">
                          {dayOffSelectedDates.length} dates, {dayOffSelectedChannels.includes('all') ? 'All' : dayOffSelectedChannels.length} channels
                        </div>
                        
                        {/* Save ë²„íŠ¼ */}
                        <div className="pt-2 border-t border-gray-200">
                          <button
                            onClick={saveDayOffs}
                            disabled={dayOffSaveStatus === 'saving' || dayOffSelectedDates.length === 0}
                            className={`
                              w-full py-3 rounded-lg font-bold text-lg transition-all shadow-md
                              ${dayOffSaveStatus === 'saving'
                                ? 'bg-gray-400 text-white cursor-wait'
                                : dayOffSelectedDates.length > 0
                                ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                                : 'bg-gray-200 text-gray-400 cursor-not-allowed'}
                            `}
                          >
                            {dayOffSaveStatus === 'saving' ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                        
                        {/* ì €ìž¥ ì™„ë£Œ ìƒíƒœ í‘œì‹œ */}
                        {dayOffSaveStatus === 'saved' && (
                          <div className="mt-2 text-center text-sm text-green-600 font-medium flex items-center justify-center gap-1">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            Saved!
                          </div>
                        )}
                        
                        {/* Clear ë²„íŠ¼ */}
                        {dayOffSelectedDates.length > 0 && (
                          <button
                            onClick={() => {
                              setDayOffSelectedDates([]);
                              setDayOffSaveStatus('idle');
                            }}
                            className="mt-2 w-full py-2 text-sm text-gray-500 hover:text-gray-700 hover:underline"
                          >
                            Clear Selection
                          </button>
                        )}
                      </div>
                    </div>
                    
                    {/* í•˜ë‹¨: Scheduled ëª©ë¡ */}
                    <div className="mt-3 bg-gray-50 rounded-lg p-3 border border-gray-200">
                      <div className="text-sm font-bold text-gray-700 mb-2">
                        Scheduled ({dayOffDates.filter(d => d.date >= new Date().toISOString().split('T')[0]).length})
                      </div>
                      {dayOffDates.filter(d => d.date >= new Date().toISOString().split('T')[0]).length === 0 ? (
                        <div className="text-sm text-gray-400 text-center py-2">No scheduled day offs</div>
                      ) : (
                        <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto">
                          {dayOffDates
                            .filter(d => d.date >= new Date().toISOString().split('T')[0])
                            .sort((a, b) => a.date.localeCompare(b.date))
                            .map((d) => {
                              const typeColor = d.type === 'closed' ? 'bg-red-100 text-red-700 border-red-300' 
                                : d.type === 'extended' ? 'bg-green-100 text-green-700 border-green-300'
                                : d.type === 'early' ? 'bg-yellow-100 text-yellow-700 border-yellow-300'
                                : 'bg-purple-100 text-purple-700 border-purple-300';
                              return (
                                <div
                                  key={`${d.date}-${d.channels}`}
                                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border ${typeColor}`}
                                >
                                  <span className="font-bold">
                                    {new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                  </span>
                                  <span className="text-xs opacity-75">
                                    {d.channels === 'all' ? 'All' : d.channels}
                                  </span>
                                  <span className="px-1.5 py-0.5 rounded text-xs bg-white bg-opacity-50">
                                    {d.type === 'closed' ? 'Closed' : d.type === 'extended' ? 'Ext' : d.type === 'early' ? 'Early' : 'Late'}
                                  </span>
                                  <button 
                                    onClick={() => removeDayOff(d.date)} 
                                    className="hover:opacity-70 font-bold ml-1"
                                  >
                                    Ã—
                                  </button>
                                </div>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                
                {/* Menu Hide Tab */}
                {onlineModalTab === 'menuhide' && (
                  <div className="flex flex-col h-full">
                    <div className="text-sm text-gray-500 mb-2">
                      Hide menu items or set time limits for Online/Delivery orders.
                    </div>
                    
                    <div className="flex gap-3 flex-1 min-h-0">
                      {/* ì¹´í…Œê³ ë¦¬ ëª©ë¡ (ì¢Œì¸¡ 1/3) */}
                      <div className="w-1/3 bg-gray-50 rounded-lg border border-gray-200 overflow-hidden flex flex-col">
                        <div className="bg-gray-700 text-white text-sm font-bold px-3 py-2 text-center">
                          Categories
                        </div>
                        <div className="flex-1 overflow-y-auto">
                          {menuHideLoading && menuHideCategories.length === 0 ? (
                            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                              Loading...
                            </div>
                          ) : menuHideCategories.length === 0 ? (
                            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                              No categories
                            </div>
                          ) : (
                            menuHideCategories.map((cat) => (
                              <button
                                key={cat.category_id}
                                onClick={() => {
                                  setMenuHideSelectedCategory(cat.category_id);
                                  setMenuHideSelectedItem(null);
                                }}
                                className={`w-full text-left px-3 py-2 border-b border-gray-200 transition-all ${
                                  menuHideSelectedCategory === cat.category_id 
                                    ? 'bg-blue-100 text-blue-700 font-bold' 
                                    : 'hover:bg-gray-100'
                                }`}
                              >
                                <div className="text-sm">{cat.name}</div>
                                {(cat.hidden_online_count > 0 || cat.hidden_delivery_count > 0) && (
                                  <div className="flex gap-2 mt-1 text-[10px]">
                                    {cat.hidden_online_count > 0 && (
                                      <span className="text-orange-600 font-semibold">O:{cat.hidden_online_count} hidden</span>
                                    )}
                                    {cat.hidden_delivery_count > 0 && (
                                      <span className="text-red-600 font-semibold">D:{cat.hidden_delivery_count} hidden</span>
                                    )}
                                  </div>
                                )}
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                      
                      {/* ë©”ë‰´ ì•„ì´í…œ ëª©ë¡ (ì¤‘ì•™ 1/3) */}
                      <div className="w-1/3 bg-gray-50 rounded-lg border border-gray-200 overflow-hidden flex flex-col">
                        <div className="bg-gray-700 text-white text-sm font-bold px-3 py-2 text-center">
                          Menu Items
                        </div>
                        <div className="flex-1 overflow-y-auto">
                          {!menuHideSelectedCategory ? (
                            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                              Select a category
                            </div>
                          ) : menuHideLoading && menuHideItems.length === 0 ? (
                            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                              Loading...
                            </div>
                          ) : menuHideItems.length === 0 ? (
                            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                              No items
                            </div>
                          ) : (
                            <>
                              {/* ì•„ì´í…œ ë¦¬ìŠ¤íŠ¸ */}
                              {menuHideItems.map((item) => {
                                const getStatusLabel = (channel: 'online' | 'delivery') => {
                                  const hideType = channel === 'online' ? item.online_hide_type : item.delivery_hide_type;
                                  const availableUntil = channel === 'online' ? item.online_available_until : item.delivery_available_until;
                                  const label = channel === 'online' ? 'O' : 'D';
                                  
                                  if (hideType === 'permanent') {
                                    return <span className={`${channel === 'online' ? 'text-orange-600' : 'text-red-600'} font-semibold`}>{label}:Hidden</span>;
                                  } else if (hideType === 'time_limited' && availableUntil) {
                                    return <span className="text-amber-600 font-semibold">{label}:~{availableUntil}</span>;
                                  }
                                  return <span className="text-emerald-600 font-semibold">{label}:Visible</span>;
                                };
                                
                                return (
                                  <div 
                                    key={item.item_id}
                                    onClick={() => setMenuHideSelectedItem(item.item_id === menuHideSelectedItem ? null : item.item_id)}
                                    className={`px-3 py-2 border-b border-gray-200 cursor-pointer transition-all ${
                                      menuHideSelectedItem === item.item_id 
                                        ? 'bg-blue-50 border-l-4 border-l-blue-500' 
                                        : 'hover:bg-gray-100'
                                    }`}
                                  >
                                    <div className="text-sm font-medium leading-tight">{item.name}</div>
                                    <div className="flex gap-2 mt-1 text-[10px]">
                                      {getStatusLabel('online')}
                                      {getStatusLabel('delivery')}
                                    </div>
                                  </div>
                                );
                              })}
                            </>
                          )}
                        </div>
                      </div>
                      
                      {/* ì„¤ì • íŒ¨ë„ (ìš°ì¸¡ 1/3) - Modern Design */}
                      <div className="w-1/3 bg-gradient-to-b from-slate-50 to-slate-100 rounded-xl border border-slate-200 overflow-hidden flex flex-col shadow-lg">
                        <div className="bg-gradient-to-r from-slate-700 to-slate-800 text-white text-sm font-semibold px-4 py-3 flex items-center gap-2">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          Visibility Settings
                        </div>
                        <div className="flex-1 flex flex-col overflow-hidden">
                          {!menuHideSelectedItem ? (
                            <div className="flex-1 flex flex-col items-center justify-center p-3 text-slate-400 text-sm text-center gap-3">
                              <svg className="w-12 h-12 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                              </svg>
                              <div>
                                <div className="font-medium text-slate-500">No item selected</div>
                                <div className="text-xs text-slate-400 mt-1">Click a menu item to configure</div>
                              </div>
                            </div>
                          ) : (() => {
                            const selectedItem = menuHideItems.find(i => i.item_id === menuHideSelectedItem);
                            if (!selectedItem) return null;
                            
                            const updateItemHideType = async (
                              channel: 'online' | 'delivery',
                              hideType: 'visible' | 'permanent' | 'time_limited',
                              availableUntil?: string
                            ) => {
                              try {
                                const updateData: any = {};
                                if (channel === 'online') {
                                  updateData.online_hide_type = hideType;
                                  updateData.online_available_until = hideType === 'time_limited' ? availableUntil : null;
                                } else {
                                  updateData.delivery_hide_type = hideType;
                                  updateData.delivery_available_until = hideType === 'time_limited' ? availableUntil : null;
                                }
                                
                                await fetch(`${API_URL}/menu-visibility/item/${selectedItem.item_id}`, {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify(updateData)
                                });
                                
                                setMenuHideItems(prev => prev.map(item => {
                                  if (item.item_id === selectedItem.item_id) {
                                    return {
                                      ...item,
                                      ...(channel === 'online' ? {
                                        online_hide_type: hideType,
                                        online_available_until: hideType === 'time_limited' ? (availableUntil || null) : null,
                                        online_visible: hideType === 'permanent' ? 0 : 1
                                      } : {
                                        delivery_hide_type: hideType,
                                        delivery_available_until: hideType === 'time_limited' ? (availableUntil || null) : null,
                                        delivery_visible: hideType === 'permanent' ? 0 : 1
                                      })
                                    };
                                  }
                                  return item;
                                }));
                              } catch (error) {
                                console.error('Failed to update hide type:', error);
                              }
                            };
                            
                            const timeOptions = [
                              '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', 
                              '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
                              '17:00', '17:30', '18:00', '18:30', '19:00', '19:30',
                              '20:00', '20:30', '21:00', '21:30', '22:00'
                            ];
                            
                            // í† ê¸€ ë²„íŠ¼ ì»´í¬ë„ŒíŠ¸: í´ë¦­í•˜ë©´ í™œì„±í™”, ë‹¤ì‹œ í´ë¦­í•˜ë©´ visibleë¡œ
                            const ToggleButton = ({ 
                              active, onClick, icon, label, activeColor, hoverColor 
                            }: { 
                              active: boolean; onClick: () => void; icon: string; label: string; 
                              activeColor: string; hoverColor: string;
                            }) => (
                              <button
                                onClick={onClick}
                                className={`w-full py-2.5 px-3 rounded-lg text-xs font-semibold transition-all duration-200 flex items-center gap-2 ${
                                  active
                                    ? `${activeColor} text-white shadow-md transform scale-[1.02]`
                                    : `bg-white border border-slate-200 text-slate-600 ${hoverColor} hover:border-slate-300 hover:shadow-sm`
                                }`}
                              >
                                <span className="text-sm">{icon}</span>
                                <span>{label}</span>
                                {active && (
                                  <svg className="w-4 h-4 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                )}
                              </button>
                            );
                            
                            // í† ê¸€ í•¸ë“¤ëŸ¬: ì´ë¯¸ í™œì„±í™”ëœ ìƒíƒœë©´ visibleë¡œ, ì•„ë‹ˆë©´ í•´ë‹¹ íƒ€ìž…ìœ¼ë¡œ
                            const handleToggle = (channel: 'online' | 'delivery', targetType: 'permanent' | 'time_limited') => {
                              const currentType = channel === 'online' ? selectedItem.online_hide_type : selectedItem.delivery_hide_type;
                              const currentUntil = channel === 'online' ? selectedItem.online_available_until : selectedItem.delivery_available_until;
                              
                              if (currentType === targetType) {
                                // ì´ë¯¸ í™œì„±í™” → visibleë¡œ í† ê¸€
                                updateItemHideType(channel, 'visible');
                              } else {
                                // ë‹¤ë¥¸ ìƒíƒœ → í•´ë‹¹ íƒ€ìž…ìœ¼ë¡œ ë³€ê²½
                                if (targetType === 'time_limited') {
                                  updateItemHideType(channel, 'time_limited', currentUntil || '15:00');
                                } else {
                                  updateItemHideType(channel, 'permanent');
                                }
                              }
                            };
                            
                            return (
                              <div className="flex flex-col h-full">
                                {/* Item Name Header - Fixed */}
                                <div className="flex-shrink-0 bg-white border-b border-slate-200 px-3 py-3">
                                  <div className="text-sm font-bold text-slate-900 truncate">{selectedItem.name}</div>
                                </div>
                                
                                {/* Scrollable Content */}
                                <div className="flex-1 overflow-y-auto p-3 space-y-4">
                                  {/* Online Settings */}
                                  <div className="bg-white rounded-xl p-3 shadow-sm border border-slate-200 relative overflow-hidden">
                                  <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-orange-400 to-orange-600"></div>
                                  <div className="flex items-center justify-between mb-3 pl-2">
                                    <div className="flex items-center gap-2">
                                      <div className="w-6 h-6 rounded-full bg-orange-100 flex items-center justify-center">
                                        <svg className="w-3.5 h-3.5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                                        </svg>
                                      </div>
                                      <span className="text-xs font-bold text-slate-700">Online</span>
                                    </div>
                                    {selectedItem.online_hide_type === 'visible' && (
                                      <span className="text-[10px] px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-medium">Active</span>
                                    )}
                                  </div>
                                  <div className="space-y-2 pl-2">
                                    <ToggleButton
                                      active={selectedItem.online_hide_type === 'permanent'}
                                      onClick={() => handleToggle('online', 'permanent')}
                                      icon={selectedItem.online_hide_type === 'permanent' ? "✕" : "🚫"}
                                      label={selectedItem.online_hide_type === 'permanent' ? "Hidden" : "Permanent Hide"}
                                      activeColor="bg-gradient-to-r from-orange-500 to-orange-600"
                                      hoverColor="hover:bg-orange-50"
                                    />
                                    <div className={`rounded-lg overflow-hidden transition-all duration-200 ${
                                      selectedItem.online_hide_type === 'time_limited'
                                        ? 'ring-2 ring-amber-400 shadow-md'
                                        : 'border border-slate-200'
                                    }`}>
                                      <button
                                        onClick={() => handleToggle('online', 'time_limited')}
                                        className={`w-full py-2.5 px-3 text-xs font-semibold transition-all flex items-center gap-2 ${
                                          selectedItem.online_hide_type === 'time_limited'
                                            ? 'bg-gradient-to-r from-amber-400 to-amber-500 text-white'
                                            : 'bg-white text-slate-600 hover:bg-amber-50'
                                        }`}
                                      >
                                        <span className="text-sm">â°</span>
                                        <span>{selectedItem.online_hide_type === 'time_limited' ? 'Limited' : 'Available Until'}</span>
                                        {selectedItem.online_hide_type === 'time_limited' && (
                                          <svg className="w-4 h-4 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                          </svg>
                                        )}
                                      </button>
                                      {selectedItem.online_hide_type === 'time_limited' && (
                                        <select
                                          value={selectedItem.online_available_until || '15:00'}
                                          onChange={(e) => updateItemHideType('online', 'time_limited', e.target.value)}
                                          className="w-full px-3 py-2 text-xs bg-amber-50 border-t border-amber-200 font-medium text-amber-800 focus:outline-none"
                                        >
                                          {timeOptions.map(t => (
                                            <option key={t} value={t}>{t}</option>
                                          ))}
                                        </select>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                
                                {/* Delivery Settings */}
                                <div className="bg-white rounded-xl p-3 shadow-sm border border-slate-200 relative overflow-hidden">
                                  <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-rose-400 to-rose-600"></div>
                                  <div className="flex items-center justify-between mb-3 pl-2">
                                    <div className="flex items-center gap-2">
                                      <div className="w-6 h-6 rounded-full bg-rose-100 flex items-center justify-center">
                                        <svg className="w-3.5 h-3.5 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
                                        </svg>
                                      </div>
                                      <span className="text-xs font-bold text-slate-700">Delivery</span>
                                    </div>
                                    {selectedItem.delivery_hide_type === 'visible' && (
                                      <span className="text-[10px] px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-medium">Active</span>
                                    )}
                                  </div>
                                  <div className="space-y-2 pl-2">
                                    <ToggleButton
                                      active={selectedItem.delivery_hide_type === 'permanent'}
                                      onClick={() => handleToggle('delivery', 'permanent')}
                                      icon={selectedItem.delivery_hide_type === 'permanent' ? "✕" : "🚫"}
                                      label={selectedItem.delivery_hide_type === 'permanent' ? "Hidden" : "Permanent Hide"}
                                      activeColor="bg-gradient-to-r from-rose-500 to-rose-600"
                                      hoverColor="hover:bg-rose-50"
                                    />
                                    <div className={`rounded-lg overflow-hidden transition-all duration-200 ${
                                      selectedItem.delivery_hide_type === 'time_limited'
                                        ? 'ring-2 ring-amber-400 shadow-md'
                                        : 'border border-slate-200'
                                    }`}>
                                      <button
                                        onClick={() => handleToggle('delivery', 'time_limited')}
                                        className={`w-full py-2.5 px-3 text-xs font-semibold transition-all flex items-center gap-2 ${
                                          selectedItem.delivery_hide_type === 'time_limited'
                                            ? 'bg-gradient-to-r from-amber-400 to-amber-500 text-white'
                                            : 'bg-white text-slate-600 hover:bg-amber-50'
                                        }`}
                                      >
                                        <span className="text-sm">â°</span>
                                        <span>{selectedItem.delivery_hide_type === 'time_limited' ? 'Limited' : 'Available Until'}</span>
                                        {selectedItem.delivery_hide_type === 'time_limited' && (
                                          <svg className="w-4 h-4 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                          </svg>
                                        )}
                                      </button>
                                      {selectedItem.delivery_hide_type === 'time_limited' && (
                                        <select
                                          value={selectedItem.delivery_available_until || '15:00'}
                                          onChange={(e) => updateItemHideType('delivery', 'time_limited', e.target.value)}
                                          className="w-full px-3 py-2 text-xs bg-amber-50 border-t border-amber-200 font-medium text-amber-800 focus:outline-none"
                                        >
                                          {timeOptions.map(t => (
                                            <option key={t} value={t}>{t}</option>
                                          ))}
                                        </select>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                    {/* Save Button */}
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <button
                        onClick={async () => {
                          if (!menuHideSelectedItem) {
                            alert('Please select a menu item first');
                            return;
                          }
                          const selectedItem = menuHideItems.find(i => i.item_id === menuHideSelectedItem);
                          if (!selectedItem) return;
                          
                          try {
                            const response = await fetch(`${API_URL}/menu-visibility/item/${selectedItem.item_id}`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                online_hide_type: selectedItem.online_hide_type,
                                online_available_until: selectedItem.online_available_until,
                                delivery_hide_type: selectedItem.delivery_hide_type,
                                delivery_available_until: selectedItem.delivery_available_until,
                              })
                            });
                            const data = await response.json();
                            if (data.success) {
                              alert('Menu Hide settings saved successfully!');
                              loadMenuHideCategories();
                            } else {
                              alert('Failed to save: ' + (data.error || 'Unknown error'));
                            }
                          } catch (error) {
                            console.error('Menu Hide save error:', error);
                            alert('Failed to save settings');
                          }
                        }}
                        disabled={!menuHideSelectedItem}
                        className={`w-full py-3 rounded-lg text-lg font-bold shadow-md transition-all ${
                          menuHideSelectedItem
                            ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                            : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        }`}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                )}
                
              </div>
              
              {/* Footer - Close ë²„íŠ¼ë§Œ */}
              <div className="flex justify-end gap-2 px-4 py-3 bg-gray-100 rounded-b-xl border-t">
                <button
                  onClick={() => setShowPrepTimeModal(false)}
                  className="px-5 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg text-sm font-semibold"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ìƒˆ ì˜¨ë¼ì¸ ì£¼ë¬¸ ì•Œë¦¼ ëª¨ë‹¬ (Manual ëª¨ë“œ) */}
        {showNewOrderAlert && newOrderAlertData && (
          <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[70]">
            <div className="bg-white rounded-2xl shadow-2xl w-[480px] max-h-[90vh] overflow-hidden animate-pulse-once">
              {/* Header */}
              <div className="bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-4">
                <h2 className="text-xl font-bold text-white text-center">New Online Order</h2>
              </div>
              
              {/* ì£¼ë¬¸ ì •ë³´ */}
              <div className="p-5 space-y-4">
                {/* ê³ ê° ì •ë³´ */}
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
                
                {/* ì£¼ë¬¸ í•­ëª© */}
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
                
                {/* Prep Time ì„ íƒ */}
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
              
              {/* ë²„íŠ¼ */}
              <div className="px-5 pb-5 flex gap-3">
                <button
                  onClick={async () => {
                    // Reject: ì£¼ë¬¸ ê±°ì ˆ
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
                    // Accept: ì£¼ë¬¸ ìˆ˜ë½
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
                  {/* íƒ­ ë²„íŠ¼: Order History / Live Order */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { setOrderListTab('history'); setLiveOrderHighlightItem(null); }}
                      className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                        orderListTab === 'history'
                          ? 'bg-white text-slate-700'
                          : 'bg-slate-600 text-white hover:bg-slate-500'
                      }`}
                    >
                      Order History
                    </button>
                    <button
                      onClick={() => setOrderListTab('live')}
                      className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                        orderListTab === 'live'
                          ? 'bg-green-500 text-white'
                          : 'bg-slate-600 text-white hover:bg-slate-500'
                      }`}
                    >
                      🟢 Live Order
                    </button>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-3 relative">
                    {/* ë‚ ì§œ ì„ íƒì€ Order History íƒ­ì—ì„œë§Œ í‘œì‹œ */}
                    {orderListTab === 'history' && (
                      <>
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
                      </>
                    )}

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
                      setLiveOrderHighlightItem(null);
                    }}
                    className="px-4 sm:px-6 py-2 sm:py-3 bg-red-500 hover:bg-red-600 active:bg-red-700 text-white rounded-lg text-base sm:text-lg font-bold"
                  >
                    ✕ Close
                  </button>
                </div>

                {/* Content - Order History Tab */}
                {orderListTab === 'history' && (
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
                              {/* ì±„ë„ ë ì§€ */}
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
                        {/* Action Buttons - ë§¨ ìœ„ë¡œ ì´ë™ */}
                        <div className="px-4 py-3 bg-slate-700 flex gap-3 flex-shrink-0">
                          {/* Pay Button - Only show for unpaid orders */}
                          {(() => {
                            const status = (orderListSelectedOrder.status || '').toLowerCase();
                            const paymentStatus = (orderListSelectedOrder.paymentStatus || '').toLowerCase();
                            const isPaid = status === 'paid' || status === 'closed' || status === 'completed' || 
                                          paymentStatus === 'paid' || paymentStatus === 'completed' ||
                                          orderListSelectedOrder.paid === true;
                            if (!isPaid) {
                              return (
                                <button
                                  onClick={() => {
                                    // Navigate to order page with this order loaded
                                    const orderId = orderListSelectedOrder.id;
                                    const tableId = orderListSelectedOrder.table_id;
                                    if (tableId) {
                                      // FSR mode - go to order page with table and orderId
                                      navigate('/order', { state: { tableId: tableId, orderId: orderId, openPayment: true } });
                                    } else {
                                      // QSR mode - go to QSR order page
                                      navigate('/qsr-order', { state: { orderId: orderId, openPayment: true } });
                                    }
                                  }}
                                  style={{ flex: 3 }}
                                  className="py-4 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white rounded-lg text-base font-bold"
                                >
                                  💳 Pay
                                </button>
                              );
                            }
                            return null;
                          })()}
                          <button
                            onClick={async () => {
                              // Check if order is paid
                              const status = (orderListSelectedOrder.status || '').toLowerCase();
                              const isPaid = status === 'paid' || status === 'closed' || status === 'completed';
                              if (!isPaid) {
                                alert('Only paid orders can be refunded.');
                                return;
                              }
                              // Open refund modal with this order pre-selected
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
                              // Pre-select the order for refund
                              await selectOrderForRefund(orderListSelectedOrder);
                            }}
                            style={{ flex: 3 }}
                            className="py-4 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white rounded-lg text-base font-bold"
                          >
                            Refund
                          </button>
                          <button
                            onClick={handleOrderListPrintBill}
                            style={{ flex: 4 }}
                            className="py-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg text-base font-bold"
                          >
                            Print Bill
                          </button>
                          <button
                            onClick={handleOrderListPrintKitchen}
                            style={{ flex: 4 }}
                            className="py-4 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white rounded-lg text-base font-bold"
                          >
                            Reprint
                          </button>
                        </div>

                        {/* Channel Header - ë²„íŠ¼ ì•„ëž˜ë¡œ ì´ë™ (ë†’ì´ 10% ê°ì†Œ) */}
                        <div className="px-4 py-2 bg-slate-100 border-b border-gray-300 text-center flex-shrink-0">
                          {(() => {
                            const badge = orderListGetChannelBadge(orderListSelectedOrder);
                            return (
                              <span className={`inline-block px-4 py-1.5 rounded-lg text-lg font-bold ${badge.bgColor} ${badge.textColor}`}>
                                {badge.label}
                              </span>
                            );
                          })()}
                        </div>

                        {/* Order Info Header (ë†’ì´ 15% ê°ì†Œ) */}
                        <div className="px-4 py-1 bg-white border-b border-gray-200 text-sm flex-shrink-0">
                          <div className="flex justify-between items-center">
                            <span className="font-bold text-gray-800">
                              Server: {orderListSelectedOrder.server_name || '-'}
                            </span>
                            <span className="font-bold text-gray-800">
                              #{orderListSelectedOrder.id}
                            </span>
                          </div>
                          {(orderListSelectedOrder.customer_name || orderListSelectedOrder.customer_phone) && (
                            <div className="text-xs text-gray-700 font-bold truncate">
                              Customer: {[orderListSelectedOrder.customer_name, orderListSelectedOrder.customer_phone].filter(Boolean).join(' · ')}
                            </div>
                          )}
                          <div className="text-gray-600 text-xs">
                            {orderListFormatDate(orderListSelectedOrder.created_at)} {orderListFormatTime(orderListSelectedOrder.created_at)}
                          </div>
                        </div>

                        {/* Items List + Totals - í•¨ê»˜ ìŠ¤í¬ë¡¤ */}
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
                          <div className="px-4 py-1">
                            <table className="w-full text-sm" style={{ lineHeight: 1.2 }}>
                              <thead>
                                <tr className="border-b-2 border-gray-300 text-gray-700">
                                  <th className="text-left py-0.5 w-10 font-bold text-xs">Qty</th>
                                  <th className="text-left py-0.5 font-bold text-xs">Item</th>
                                  <th className="text-right py-0.5 w-16 font-bold text-xs">Price</th>
                                </tr>
                              </thead>
                              <tbody>
                                {orderListSelectedItems.map((item, idx) => {
                                  const rawModifiers = item.modifiers_json 
                                    ? (typeof item.modifiers_json === 'string' ? JSON.parse(item.modifiers_json) : item.modifiers_json) 
                                    : [];
                                  // ë‹¤ì–‘í•œ modifier í˜•ì‹ ì²˜ë¦¬
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
                                      <td className="text-center font-medium text-sm" style={{ paddingTop: 2, paddingBottom: 2 }}>{item.quantity || 1}</td>
                                      <td style={{ paddingTop: 2, paddingBottom: 2 }}>
                                        <div className="font-medium text-sm" style={{ lineHeight: 1.15 }}>{item.name}</div>
                                        {modifierNames.length > 0 && (
                                          <div className="text-xs text-gray-500 ml-2" style={{ lineHeight: 1.1 }}>
                                            {modifierNames.map((name: string, mi: number) => (
                                              <div key={mi}>· {name}</div>
                                            ))}
                                          </div>
                                        )}
                                        {item.discountPercent && item.discountPercent > 0 && (
                                          <div className="text-xs text-green-600 ml-2 font-medium" style={{ lineHeight: 1.1 }}>
                                            🎁 {item.discountPercent}% off {item.promotionName && `(${item.promotionName})`}
                                          </div>
                                        )}
                                      </td>
                                      <td className="text-right font-medium text-sm" style={{ paddingTop: 2, paddingBottom: 2 }}>
                                        {item.discountAmount && item.discountAmount > 0 ? (
                                          <div style={{ lineHeight: 1.1 }}>
                                            <span className="line-through text-gray-400 text-xs">${((item.price || 0) * (item.quantity || 1)).toFixed(2)}</span>
                                            <div className="text-green-600">${(((item.price || 0) * (item.quantity || 1)) - item.discountAmount).toFixed(2)}</div>
                                          </div>
                                        ) : (
                                          `$${((item.price || 0) * (item.quantity || 1)).toFixed(2)}`
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>

                          {/* Totals - ì•„ì´í…œê³¼ í•¨ê»˜ ìŠ¤í¬ë¡¤ */}
                          {totals && (
                            <div className="px-4 py-1 bg-slate-100 border-t-2 border-gray-300 text-sm">
                              <div className="flex justify-between" style={{ paddingTop: 1, paddingBottom: 1 }}>
                                <span className="font-medium text-xs">Sub Total:</span>
                                <span className="font-medium text-xs">${totals.subtotal.toFixed(2)}</span>
                              </div>
                              {totals.discountTotal > 0 && (
                                <>
                                  <div className="flex justify-between text-green-600" style={{ paddingTop: 1, paddingBottom: 1 }}>
                                    <span className="font-medium text-xs">{totals.promotionName === 'Item Discount' ? 'ðŸ·ï¸' : '🎁'} {totals.promotionName || 'Discount'}:</span>
                                    <span className="font-medium text-xs">-${totals.discountTotal.toFixed(2)}</span>
                                  </div>
                                  <div className="flex justify-between" style={{ paddingTop: 1, paddingBottom: 1 }}>
                                    <span className="font-medium text-xs">After Discount:</span>
                                    <span className="font-medium text-xs">${totals.subtotalAfterDiscount.toFixed(2)}</span>
                                  </div>
                                </>
                              )}
                              <div className="flex justify-between" style={{ paddingTop: 1, paddingBottom: 1 }}>
                                <span className="font-medium text-xs">Tax:</span>
                                <span className="font-medium text-xs">${totals.tax.toFixed(2)}</span>
                              </div>
                              <div className="flex justify-between py-0.5 font-bold text-base border-t-2 border-gray-400 mt-0.5">
                                <span>Total:</span>
                                <span>${totals.total.toFixed(2)}</span>
                              </div>
                              <div className="flex justify-center py-1">
                                <span className={`px-5 py-1.5 rounded-lg text-sm font-bold ${
                                  orderListSelectedOrder.status === 'paid' || orderListSelectedOrder.status === 'closed' || orderListSelectedOrder.status === 'completed' || orderListSelectedOrder.status === 'PAID' ||
                                  orderListSelectedOrder.paymentStatus === 'PAID' || orderListSelectedOrder.paymentStatus === 'paid' || orderListSelectedOrder.paymentStatus === 'completed' || orderListSelectedOrder.paymentStatus === 'COMPLETED' ||
                                  orderListSelectedOrder.paid === true
                                    ? 'bg-green-500 text-white' 
                                    : 'bg-yellow-400 text-gray-800'
                                }`}>
                                  {orderListSelectedOrder.status === 'paid' || orderListSelectedOrder.status === 'closed' || orderListSelectedOrder.status === 'completed' || orderListSelectedOrder.status === 'PAID' ||
                                  orderListSelectedOrder.paymentStatus === 'PAID' || orderListSelectedOrder.paymentStatus === 'paid' || orderListSelectedOrder.paymentStatus === 'completed' || orderListSelectedOrder.paymentStatus === 'COMPLETED' ||
                                  orderListSelectedOrder.paid === true ? 'PAID' : 'UNPAID'}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
                )}

                {/* Content - Live Order Tab */}
                {orderListTab === 'live' && (
                <div className="flex-1 p-3 overflow-auto flex flex-col">
                  {/* í•˜ì´ë¼ì´íŠ¸ëœ ì•„ì´í…œì´ ìžˆëŠ” í…Œì´ë¸” ëª©ë¡ í‘œì‹œ */}
                  {liveOrderHighlightItem && (() => {
                    const tablesWithItem = liveOrders
                      .filter((order: any) => 
                        order.items?.some((item: any) => item.name === liveOrderHighlightItem)
                      )
                      .map((order: any) => order.tableLabel)
                      .sort((a: string, b: string) => {
                        const numA = parseInt((a || '').replace(/\D/g, '') || '9999');
                        const numB = parseInt((b || '').replace(/\D/g, '') || '9999');
                        return numA - numB;
                      });
                    
                    if (tablesWithItem.length <= 1) return null;
                    
                    return (
                      <div className="mb-3 p-3 bg-red-50 border-2 border-red-300 rounded-xl flex items-center gap-3 flex-shrink-0">
                        <span className="text-red-600 font-bold text-sm">📍 "{liveOrderHighlightItem}"</span>
                        <span className="text-gray-600 text-sm">found in:</span>
                        <div className="flex flex-wrap gap-2">
                          {tablesWithItem.map((tableLabel: string) => (
                            <button
                              key={tableLabel}
                              onClick={() => {
                                // í•´ë‹¹ í…Œì´ë¸”ë¡œ ìŠ¤í¬ë¡¤
                                const order = liveOrders.find((o: any) => o.tableLabel === tableLabel);
                                if (order) {
                                  const cardEl = liveOrderCardRefs.current[order.tableId];
                                  if (cardEl) {
                                    cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                  }
                                }
                              }}
                              className="px-3 py-1 bg-red-500 text-white text-sm font-bold rounded-lg hover:bg-red-600 transition-all"
                            >
                              {tableLabel}
                            </button>
                          ))}
                        </div>
                        <button
                          onClick={() => setLiveOrderHighlightItem(null)}
                          className="ml-auto text-gray-500 hover:text-gray-700 text-lg"
                        >
                          âœ•
                        </button>
                      </div>
                    );
                  })()}
                  
                  <div className="grid grid-cols-4 gap-3 auto-rows-[minmax(200px,1fr)] flex-1">
                    {/* ê²°ì œ ì™„ë£Œë˜ì§€ ì•Šì€ í…Œì´ë¸” ì£¼ë¬¸ í‘œì‹œ - í…Œì´ë¸” ë²ˆí˜¸ ì˜¤ë¦„ì°¨ìˆœ */}
                    {liveOrders
                      .slice()
                      .sort((a: any, b: any) => {
                        // í…Œì´ë¸” ë¼ë²¨ì—ì„œ ìˆ«ìž ì¶”ì¶œí•˜ì—¬ ì •ë ¬ (T1, T2, Table 1, Table 2 ë“±)
                        const numA = parseInt((a.tableLabel || '').replace(/\D/g, '') || '9999');
                        const numB = parseInt((b.tableLabel || '').replace(/\D/g, '') || '9999');
                        return numA - numB;
                      })
                      .map((liveOrder: any) => {
                        // ì´ í…Œì´ë¸”ì— í•˜ì´ë¼ì´íŠ¸ëœ ì•„ì´í…œì´ ìžˆëŠ”ì§€ í™•ì¸
                        const hasHighlightedItem = liveOrderHighlightItem && 
                          liveOrder.items?.some((item: any) => item.name === liveOrderHighlightItem);
                        
                        return (
                      <div
                        key={liveOrder.tableId}
                        ref={(el) => { liveOrderCardRefs.current[liveOrder.tableId] = el; }}
                        className={`bg-white rounded-xl border-2 shadow-lg p-3 flex flex-col overflow-hidden transition-all ${
                          hasHighlightedItem ? 'border-red-400 ring-2 ring-red-200' : 'border-gray-300'
                        }`}
                      >
                        {/* í…Œì´ë¸” ë²ˆí˜¸ í—¤ë” */}
                        <div className={`mb-2 flex-shrink-0 border-b pb-2 ${
                          hasHighlightedItem ? 'border-red-200' : 'border-gray-200'
                        }`}>
                          <span className={`text-xl font-bold ${
                            hasHighlightedItem ? 'text-red-600' : 'text-slate-700'
                          }`}>
                            {liveOrder.tableLabel}
                            {hasHighlightedItem && <span className="ml-2 text-sm text-red-500">*</span>}
                          </span>
                        </div>
                        
                        {/* ì£¼ë¬¸ ë‚´ì—­ - ìŠ¤í¬ë¡¤ ê°€ëŠ¥, ì•ŒíŒŒë²³ ì˜¤ë¦„ì°¨ìˆœ ì •ë ¬ */}
                        <div
                          className="flex-1 overflow-y-auto text-sm space-y-2 pr-1" 
                          style={{ minHeight: 0 }}
                        >
                          {liveOrder.items && liveOrder.items.length > 0 ? (
                            liveOrder.items
                              .slice()
                              .sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''))
                              .map((item: any, idx: number) => {
                                const isHighlighted = liveOrderHighlightItem === item.name;
                                return (
                              <div 
                                key={idx} 
                                data-item-name={item.name}
                                className={`border-b border-gray-100 pb-1.5 cursor-pointer hover:bg-gray-50 rounded px-1 -mx-1 transition-all ${
                                  isHighlighted ? 'bg-red-50 border-red-200' : ''
                                }`}
                                onClick={() => {
                                  // ê°™ì€ ì•„ì´í…œ í´ë¦­ ì‹œ í•´ì œ, ë‹¤ë¥¸ ì•„ì´í…œ í´ë¦­ ì‹œ í•˜ì´ë¼ì´íŠ¸
                                  if (liveOrderHighlightItem === item.name) {
                                    setLiveOrderHighlightItem(null);
                                  } else {
                                    setLiveOrderHighlightItem(item.name);
                                    // ë‹¤ë¥¸ í…Œì´ë¸” ì¹´ë“œì—ì„œ ê°™ì€ ì•„ì´í…œìœ¼ë¡œ ìŠ¤í¬ë¡¤
                                    setTimeout(() => {
                                      liveOrders.forEach((order: any) => {
                                        if (order.tableId === liveOrder.tableId) return;
                                        const cardEl = liveOrderCardRefs.current[order.tableId];
                                        if (cardEl) {
                                          const itemEl = cardEl.querySelector(`[data-item-name="${item.name}"]`);
                                          if (itemEl) {
                                            itemEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                          }
                                        }
                                      });
                                    }, 50);
                                  }
                                }}
                              >
                                {/* ë©”ë‰´ ì´ë¦„ & ìˆ˜ëŸ‰ */}
                                <div className="flex justify-between items-start">
                                  <span className={`leading-snug flex-1 ${
                                    isHighlighted ? 'text-red-600 font-bold' : 'font-semibold text-gray-800'
                                  }`}>{item.name}</span>
                                  <span className={`ml-2 ${
                                    isHighlighted ? 'text-red-600 font-bold' : 'text-gray-700 font-bold'
                                  }`}>x{item.quantity || 1}</span>
                                </div>
                                
                                {/* ëª¨ë””íŒŒì´ì–´ */}
                                {item.modifiers && item.modifiers.length > 0 && (
                                  <div className={`ml-3 text-xs leading-snug ${isHighlighted ? 'text-red-500' : 'text-blue-600'}`}>
                                    {item.modifiers.map((mod: any, mIdx: number) => {
                                      const label = typeof mod === 'string'
                                        ? mod
                                        : (mod?.name
                                          || (Array.isArray(mod?.modifierNames) ? mod.modifierNames.join(', ') : '')
                                          || (Array.isArray(mod?.selectedEntries) ? mod.selectedEntries.map((entry: any) => entry?.name || entry).filter(Boolean).join(', ') : '')
                                          || mod?.groupName
                                          || '');
                                      if (!label) return null;
                                      return <div key={mIdx}>+ {label}</div>;
                                    })}
                                  </div>
                                )}
                                
                                {/* Note (Memo) */}
                                {item.memo && (
                                  <div className={`ml-3 text-xs italic leading-snug ${isHighlighted ? 'text-red-500' : 'text-orange-600'}`}>
                                    📍 {typeof item.memo === 'string' ? item.memo : item.memo.text || JSON.stringify(item.memo)}
                                  </div>
                                )}
                              </div>
                              );
                            })
                          ) : (
                            <div className="text-gray-400 italic text-center py-2">No items</div>
                          )}
                        </div>
                        
                        {/* ì´ì•¡ */}
                        <div className="mt-2 pt-2 border-t border-gray-200 flex justify-between items-center flex-shrink-0">
                          <span className="text-xs text-gray-500">Total</span>
                          <span className="text-sm font-bold text-slate-800">
                            ${liveOrder.order?.total?.toFixed(2) || liveOrder.items?.reduce((sum: number, item: any) => sum + (item.price || 0) * (item.quantity || 1), 0).toFixed(2) || '0.00'}
                          </span>
                        </div>
                      </div>
                      );
                    })}
                    
                    {/* ì£¼ë¬¸ì´ ì—†ì„ ë•Œ ì•ˆë‚´ ë©”ì‹œì§€ */}
                    {liveOrders.length === 0 && (
                      <div className="col-span-4 flex items-center justify-center h-48">
                        <span className="text-gray-400 text-lg">No active orders</span>
                      </div>
                    )}
                  </div>
                </div>
                )}

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

      {/* ëª¨ë‹¬ë“¤ */}
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
          try { alert('ë°°ì •í•  í…Œì´ë¸”ì„ ì„ íƒí•˜ì„¸ìš”.'); } catch {}
        }}
      />

      {/* Delivery ì „ìš© ëª¨ë‹¬ */}
      {showDeliveryOrderModal && (
        <div className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center p-2">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[950px] flex flex-col overflow-hidden" style={{ height: 'min(90vh, 560px)' }}>
            {/* ìƒë‹¨: ì¢Œ-ì±„ë„(35%), ì¤‘-í”„ë ™íƒ€ìž„(50%), ìš°-ë²„íŠ¼(15%) */}
            <div className="flex-shrink-0 border-b border-gray-300">
              <div className="flex items-stretch">
                {/* ì¢Œì¸¡: ë”œë¦¬ë²„ë¦¬ ì±„ë„ (35%) - ì—°í•œ íŒŒëž€ìƒ‰ ë°°ê²½ */}
                <div className="p-3 bg-blue-50" style={{ width: '35%' }}>
                  <div className="grid grid-cols-2 gap-1.5 mb-1.5">
                    {(['UberEats', 'Doordash', 'SkipTheDishes', 'Fantuan'] as const).map((company) => (
                      <button
                        key={company}
                        type="button"
                        onClick={() => setDeliveryCompany(company)}
                        className={`h-10 rounded-lg font-bold text-xs transition-all shadow ${
                          deliveryCompany === company
                            ? company === 'UberEats' ? 'bg-green-500 text-white ring-2 ring-green-300'
                            : company === 'Doordash' ? 'bg-red-500 text-white ring-2 ring-red-300'
                            : company === 'SkipTheDishes' ? 'bg-orange-500 text-white ring-2 ring-orange-300'
                            : 'bg-yellow-500 text-white ring-2 ring-yellow-300'
                            : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
                        }`}
                      >
                        {company === 'SkipTheDishes' ? 'Skip' : company}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    ref={deliveryOrderInputRef}
                    value={deliveryOrderNumber}
                    onChange={(e) => setDeliveryOrderNumber(e.target.value.toUpperCase())}
                    placeholder="Order #"
                    className="w-full h-11 px-3 text-lg font-mono bg-white border-2 border-purple-400 rounded-lg text-gray-800 text-center tracking-widest focus:outline-none focus:border-purple-600"
                  />
                </div>

                {/* ì¤‘ì•™: í”„ë ™íƒ€ìž„ (50%) - ì—°í•œ ë…¸ëž€ìƒ‰ ë°°ê²½ */}
                <div className="p-3 bg-amber-50 flex flex-col justify-end" style={{ width: '50%' }}>
                  <div className="flex items-center gap-3 mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-500 text-xs">Now</span>
                      <span className="text-sm font-mono text-gray-600">
                        {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-600 text-sm font-semibold">+</span>
                      <span className="text-xl font-mono font-bold text-purple-600">{deliveryPrepTime}m</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-600 text-sm">=</span>
                      <span className="px-3 py-1 rounded-lg bg-emerald-500 text-white text-lg font-bold shadow-md">
                        Ready {(() => {
                          const now = new Date();
                          now.setMinutes(now.getMinutes() + deliveryPrepTime);
                          return now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
                        })()}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-5 gap-1.5">
                    {[5, 10, 15, 20, 25, 30, 40, 50, 60, 90].map((min) => (
                      <button
                        key={`prep-${min}`}
                        type="button"
                        onClick={() => setDeliveryPrepTime(min)}
                        className={`h-11 rounded-lg text-sm font-bold transition-all ${
                          deliveryPrepTime === min ? 'bg-purple-500 text-white shadow-md' : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
                        }`}
                      >
                        {min}
                      </button>
                    ))}
                  </div>
                </div>

                {/* ìš°ì¸¡: ë²„íŠ¼ (15%) - ì—°í•œ ë³´ë¼ìƒ‰ ë°°ê²½ */}
                <div className="p-3 bg-purple-50 flex flex-col gap-1.5" style={{ width: '15%' }}>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!deliveryCompany) { alert('Select channel'); return; }
                      if (!deliveryOrderNumber.trim()) { alert('Enter order #'); return; }
                      
                      const now = new Date();
                      now.setMinutes(now.getMinutes() + deliveryPrepTime);
                      const readyTimeLabel = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
                      
                      const newOrder = {
                        id: Date.now(),
                        type: 'Delivery',
                        time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
                        createdAt: new Date().toISOString(),
                        phone: '',
                        name: `${deliveryCompany} #${deliveryOrderNumber}`,
                        status: 'pending',
                        serverId: null,
                        serverName: '',
                        items: [],
                        orderItems: [],
                        fulfillment: 'delivery',
                        deliveryCompany,
                        deliveryOrderNumber: deliveryOrderNumber.trim(),
                        readyTimeLabel,
                        prepTime: deliveryPrepTime,
                      };
                      
                      setTogoOrders(prev => [...prev, newOrder]);
                      
                      // DB ì €ìž¥ (Kitchen Ticket/ReceiptëŠ” ì£¼ë¬¸íŽ˜ì´ì§€ì—ì„œ ë©”ë‰´ ì¶”ê°€ í›„ ì¶œë ¥)
                      try {
                        await fetch(`${API_URL}/orders/delivery-orders`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ storeId: 'STORE001', ...newOrder }),
                        });
                        console.log('âœ… Delivery order saved to DB and Firebase');
                      } catch (err) { console.error('âŒ Failed to save delivery order:', err); }
                      
                      setShowDeliveryOrderModal(false);
                      navigate('/sales/order', {
                        state: {
                          tableId: `DL${newOrder.id}`,
                          tableName: newOrder.name,
                          channel: 'delivery',
                          orderType: 'delivery',
                          priceType: 'price2',
                          menuId: defaultMenu.menuId,
                          menuName: defaultMenu.menuName,
                          deliveryMetaId: newOrder.id,  // delivery_orders í…Œì´ë¸”ì˜ id
                          deliveryCompany,
                          deliveryOrderNumber: deliveryOrderNumber.trim(),
                        },
                      });
                    }}
                    disabled={!deliveryCompany || !deliveryOrderNumber.trim()}
                    className={`flex-1 font-bold rounded-lg transition-all ${
                      deliveryCompany && deliveryOrderNumber.trim()
                        ? 'bg-purple-600 text-white hover:bg-purple-500 shadow-md'
                        : 'bg-gray-300 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDeliveryOrderModal(false)}
                    className="flex-1 bg-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-400"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>

            {/* í•˜ë‹¨: í‚¤ë³´ë“œ */}
            <div className="flex-1 flex items-start justify-center bg-gray-100 pt-1 px-2">
              <VirtualKeyboard
                open={true}
                onType={(char) => setDeliveryOrderNumber(prev => (prev + char).toUpperCase())}
                onBackspace={() => setDeliveryOrderNumber(prev => prev.slice(0, -1))}
                onClear={() => setDeliveryOrderNumber('')}
                displayText={deliveryOrderNumber}
                keepOpen={true}
                showNumpad={true}
                languages={['EN']}
                currentLanguage="EN"
                maxWidthPx={900}
              />
            </div>
          </div>
        </div>
      )}

      {/* Online Order Panel */}
      <OnlineOrderPanel
        restaurantId={onlineOrderRestaurantId}
        isOpen={showOnlineOrderPanel}
        onClose={() => setShowOnlineOrderPanel(false)}
        autoConfirm={false}
        soundEnabled={true}
      />

      {/* Online/Togo ê²°ì œ ëª¨ë‹¬ - z-indexë¥¼ ë” ë†’ê²Œ ì„¤ì • */}
      <div style={{ position: 'relative', zIndex: 60 }}>
      <TablePaymentModal
        isOpen={showOnlineTogoPaymentModal}
        onClose={() => {
          setShowOnlineTogoPaymentModal(false);
          setOnlineTogoPaymentOrder(null);
          // ê²°ì œ ì„¸ì…˜ ì´ˆê¸°í™”
          setOnlineTogoSessionPayments([]);
          onlineTogoSavedOrderIdRef.current = null;
        }}
        subtotal={onlineTogoPaymentOrder?.subtotal || 0}
        taxLines={onlineTogoPaymentOrder?.tax ? [{ name: 'Tax', amount: onlineTogoPaymentOrder.tax }] : []}
        total={onlineTogoPaymentOrder?.total || 0}
        channel={onlineTogoPaymentOrder?.type?.toLowerCase() || 'togo'}
        customerName={onlineTogoPaymentOrder?.name || ''}
        tableName={`${onlineTogoPaymentOrder?.type || 'Order'} #${onlineTogoPaymentOrder?.number || ''}`}
        payments={onlineTogoSessionPayments}
        outstandingDue={(() => {
          const total = onlineTogoPaymentOrder?.total || 0;
          const paidSum = onlineTogoSessionPayments.reduce((s, p) => s + (p.amount || 0), 0);
          return Math.max(0, Number((total - paidSum).toFixed(2)));
        })()}
        paidSoFar={onlineTogoSessionPayments.reduce((s, p) => s + (p.amount || 0), 0)}
        onClearAllPayments={async () => {
          // ê²°ì œ ì„¸ì…˜ë§Œ ì´ˆê¸°í™” (DB ê²°ì œëŠ” ìœ ì§€ - void ì²˜ë¦¬ëŠ” ë³„ë„ë¡œ)
          setOnlineTogoSessionPayments([]);
        }}
        onConfirm={async (payload: { method: string; amount: number; tip: number }) => {
          try {
            // Togo ì£¼ë¬¸ì˜ ê²½ìš° ì´ë¯¸ ë¡œì»¬ DBì— orderIdê°€ ìžˆìŒ
            // Online ì£¼ë¬¸ì˜ ê²½ìš° ë¡œì»¬ DBì— ì €ìž¥ë˜ì–´ ìžˆì§€ ì•Šìœ¼ë¯€ë¡œ ë¨¼ì € ì €ìž¥ í•„ìš”
            let orderId = onlineTogoSavedOrderIdRef.current;
            
            // selectedOrderType ëŒ€ì‹  onlineTogoPaymentOrder.orderType ì‚¬ìš© (í´ë¡œì € stale ê°’ ë°©ì§€)
            const orderType = onlineTogoPaymentOrder?.orderType;
            
            if (!orderId) {
              if ((orderType === 'togo' || orderType === 'forhere' || orderType === 'pickup') && onlineTogoPaymentOrder?.id) {
                // Togo/ForHere/Pickup: ì´ë¯¸ ë¡œì»¬ DBì— ìžˆìŒ
                orderId = onlineTogoPaymentOrder.id;
                onlineTogoSavedOrderIdRef.current = orderId;
              } else if (orderType === 'online' && onlineTogoPaymentOrder?.id) {
                // Online: ë¡œì»¬ DBì— ì£¼ë¬¸ ì €ìž¥
                const orderData = selectedOrderDetail?.fullOrder || onlineTogoPaymentOrder;
                const items = orderData?.items || [];
                const now = new Date();
                const orderNumber = `ONLINE-${onlineTogoPaymentOrder.number || now.getTime()}`;
                
                const saveRes = await fetch(`${API_URL}/orders`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    orderNumber,
                    orderType: 'ONLINE',
                    total: onlineTogoPaymentOrder.total || 0,
                    items: items.map((it: any) => ({
                      id: it.id || it.item_id,
                      name: it.name,
                      quantity: it.quantity || 1,
                      price: (it.price || 0) * (it.quantity || 1),
                      modifiers: it.modifiers || []
                    })),
                    customerName: onlineTogoPaymentOrder.name || '',
                    customerPhone: onlineTogoPaymentOrder.phone || ''
                  })
                });
                
                if (!saveRes.ok) throw new Error('Failed to save online order to local DB');
                const saved = await saveRes.json();
                orderId = saved.orderId;
                onlineTogoSavedOrderIdRef.current = orderId;
              }
            }
            
            if (!orderId) {
              console.error('No orderId available for payment');
              return;
            }
            
            // ê²°ì œ ì €ìž¥ API í˜¸ì¶œ (Dine-Inê³¼ ë™ì¼)
            const payRes = await fetch(`${API_URL}/payments`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                orderId,
                method: payload.method,
                amount: Number((payload.amount + payload.tip).toFixed(2)),
                tip: payload.tip,
                guestNumber: null
              })
            });
            
            if (!payRes.ok) throw new Error('Failed to save payment');
            const payData = await payRes.json();
            
            // ë¡œì»¬ ì„¸ì…˜ì— ê²°ì œ ì¶”ê°€
            setOnlineTogoSessionPayments(prev => ([
              ...prev,
              {
                paymentId: payData.paymentId,
                method: payload.method,
                amount: Number((payload.amount + payload.tip).toFixed(2)),
                tip: payload.tip
              }
            ]));
            
            console.log('Payment saved:', payData, 'for order:', orderId);
          } catch (e) {
            console.error('Payment processing error:', e);
            alert('An error occurred during payment processing.');
          }
        }}
        onComplete={async () => {
          // ê²°ì œ ëª¨ë‹¬ ë‹«ê¸°
          setShowOnlineTogoPaymentModal(false);
          
          try {
            // ì£¼ë¬¸ íƒ€ìž…ì— ë”°ë¼ ë‹¤ë¥¸ API í˜¸ì¶œ
            if (selectedOrderType === 'online' && onlineTogoPaymentOrder?.id) {
              // ì˜¨ë¼ì¸ ì£¼ë¬¸: Firebase ìƒíƒœë¥¼ completedë¡œ ì—…ë°ì´íŠ¸
              const response = await fetch(`${API_URL}/online-orders/order/${onlineTogoPaymentOrder.id}/complete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
              });
              if (response.ok) {
                console.log('Online order status updated to completed');
              } else {
                console.error('Failed to update online order status');
              }
              
              // Receipt 2ìž¥ ì¶œë ¥ (Online Order) - Receipt í”„ë¦°í„°ì—ë§Œ ì¶œë ¥
              try {
                // ì˜¨ë¼ì¸ ì£¼ë¬¸ ì •ë³´ë¡œ Receipt ë°ì´í„° êµ¬ì„±
                const orderData = selectedOrderDetail?.fullOrder || onlineTogoPaymentOrder;
                // ì‹¤ì œ ê²°ì œ ë‚´ì—­ ì‚¬ìš© (ì—†ìœ¼ë©´ ê¸°ë³¸ê°’)
                const actualPayments = onlineTogoSessionPayments.length > 0
                  ? onlineTogoSessionPayments.map(p => ({ method: p.method, amount: p.amount }))
                  : [{ method: 'PAID', amount: onlineTogoPaymentOrder.total || 0 }];
                // í˜„ê¸ˆ ê²°ì œì—ì„œ Change ê³„ì‚°
                const cashPaid = onlineTogoSessionPayments.filter(p => p.method === 'CASH').reduce((s, p) => s + p.amount, 0);
                const totalAmount = onlineTogoPaymentOrder.total || 0;
                const nonCashPaid = onlineTogoSessionPayments.filter(p => p.method !== 'CASH').reduce((s, p) => s + p.amount, 0);
                const changeAmount = Math.max(0, cashPaid - (totalAmount - nonCashPaid));
                const receiptData = {
                  orderInfo: {
                    orderNumber: onlineTogoPaymentOrder.number || onlineTogoPaymentOrder.id,
                    orderType: 'ONLINE',
                    customerName: onlineTogoPaymentOrder.name || '',
                    customerPhone: onlineTogoPaymentOrder.phone || '',
                  },
                  items: orderData?.items?.map((item: any) => ({
                    name: item.name,
                    quantity: item.quantity || 1,
                    unitPrice: item.price || 0,
                    totalPrice: (item.price || 0) * (item.quantity || 1)
                  })) || [],
                  subtotal: onlineTogoPaymentOrder.subtotal || 0,
                  taxLines: onlineTogoPaymentOrder.tax ? [{ name: 'Tax', amount: onlineTogoPaymentOrder.tax }] : [],
                  taxesTotal: onlineTogoPaymentOrder.tax || 0,
                  total: onlineTogoPaymentOrder.total || 0,
                  payments: actualPayments,
                  change: changeAmount
                };
                
                await printReceipt(receiptData, 2);
                console.log('Receipt printed 2 copies');
              } catch (printErr) {
                console.error('Receipt print error:', printErr);
              }
            } else if (selectedOrderType === 'togo' && onlineTogoPaymentOrder?.id) {
              // Togo ì£¼ë¬¸: ë¡œì»¬ DB ìƒíƒœë¥¼ PAIDë¡œ ì—…ë°ì´íŠ¸
              const response = await fetch(`${API_URL}/orders/${onlineTogoPaymentOrder.id}/close`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
              });
              if (response.ok) {
                console.log('Togo order status updated to PAID');
              } else {
                console.error('Failed to update Togo order status');
              }
              
              // Receipt 2ìž¥ ì¶œë ¥ (Togo Order) - Receipt í”„ë¦°í„°ì—ë§Œ ì¶œë ¥
              try {
                const orderData = selectedOrderDetail?.fullOrder || onlineTogoPaymentOrder;
                // ì‹¤ì œ ê²°ì œ ë‚´ì—­ ì‚¬ìš© (ì—†ìœ¼ë©´ ê¸°ë³¸ê°’)
                const actualPaymentsTogo = onlineTogoSessionPayments.length > 0
                  ? onlineTogoSessionPayments.map(p => ({ method: p.method, amount: p.amount }))
                  : [{ method: 'PAID', amount: onlineTogoPaymentOrder.total || 0 }];
                // í˜„ê¸ˆ ê²°ì œì—ì„œ Change ê³„ì‚°
                const cashPaidTogo = onlineTogoSessionPayments.filter(p => p.method === 'CASH').reduce((s, p) => s + p.amount, 0);
                const totalAmountTogo = onlineTogoPaymentOrder.total || 0;
                const nonCashPaidTogo = onlineTogoSessionPayments.filter(p => p.method !== 'CASH').reduce((s, p) => s + p.amount, 0);
                const changeAmountTogo = Math.max(0, cashPaidTogo - (totalAmountTogo - nonCashPaidTogo));
                const receiptData = {
                  orderInfo: {
                    orderNumber: onlineTogoPaymentOrder.number || onlineTogoPaymentOrder.id,
                    orderType: 'TOGO',
                    customerName: onlineTogoPaymentOrder.name || '',
                    customerPhone: onlineTogoPaymentOrder.phone || '',
                  },
                  items: orderData?.items?.map((item: any) => ({
                    name: item.name,
                    quantity: item.quantity || 1,
                    unitPrice: item.price || 0,
                    totalPrice: (item.price || 0) * (item.quantity || 1)
                  })) || [],
                  subtotal: onlineTogoPaymentOrder.subtotal || 0,
                  taxLines: onlineTogoPaymentOrder.tax ? [{ name: 'Tax', amount: onlineTogoPaymentOrder.tax }] : [],
                  taxesTotal: onlineTogoPaymentOrder.tax || 0,
                  total: onlineTogoPaymentOrder.total || 0,
                  payments: actualPaymentsTogo,
                  change: changeAmountTogo
                };
                
                await printReceipt(receiptData, 2);
                console.log('Receipt printed 2 copies');
              } catch (printErr) {
                console.error('Receipt print error:', printErr);
              }
            }
          } catch (error) {
            console.error('Payment status update error:', error);
          }
          
          // ê²°ì œ ì™„ë£Œ í›„ ì£¼ë¬¸ ëª©ë¡ì—ì„œ ì¦‰ì‹œ ì œê±°
          if (selectedOrderDetail && onlineTogoPaymentOrder) {
            // ì„ íƒëœ ì£¼ë¬¸ ì´ˆê¸°í™”
            setSelectedOrderDetail(null);
            
            // ì£¼ë¬¸ ëª©ë¡ì—ì„œ ì œê±°
            if (selectedOrderType === 'online') {
              setOnlineQueueCards(prev => prev.filter(card => card.id !== onlineTogoPaymentOrder.id));
            } else if (selectedOrderType === 'togo') {
              setTogoOrders(prev => prev.filter(order => order.id !== onlineTogoPaymentOrder.id));
            }
          }
          
          // ðŸ’° Cash Drawer ì—´ê¸° (Dine-Inê³¼ ë™ì¼)
          try {
            console.log('ðŸ’° Opening cash drawer after Online/Togo payment completion...');
            await openCashDrawer();
            console.log('ðŸ’° Cash drawer opened successfully');
          } catch (drawerErr) {
            console.warn('Cash drawer open failed (ignored):', drawerErr);
          }
          
          // Pickup Complete í™•ì¸ ëª¨ë‹¬ í‘œì‹œ (íƒ€ìž… ì •ë³´ í¬í•¨)
          setPickupConfirmOrder({ ...onlineTogoPaymentOrder, orderType: selectedOrderType });
          setShowPickupConfirmModal(true);
          
          setOnlineTogoPaymentOrder(null);
          
          // ê²°ì œ ì„¸ì…˜ ì´ˆê¸°í™”
          setOnlineTogoSessionPayments([]);
          onlineTogoSavedOrderIdRef.current = null;
          
          // ì£¼ë¬¸ ëª©ë¡ ìƒˆë¡œê³ ì¹¨ (ë°±ê·¸ë¼ìš´ë“œ)
          loadOnlineOrders();
          loadTogoOrders();
        }}
      />
      </div>

      {/* Pickup Complete í™•ì¸ ëª¨ë‹¬ - ê²°ì œ ì™„ë£Œ í›„ í‘œì‹œ */}
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
              <div className="text-6xl mb-4">âœ“</div>
              <div className="text-lg text-gray-600 mb-6">
                Would you like to mark this order as picked up?
              </div>
              
              {/* Buttons */}
              <div className="space-y-3">
                {/* Pickup Complete - í° ë²„íŠ¼ */}
                <button
                  onClick={async () => {
                    const orderId = pickupConfirmOrder?.id;
                    const localOrderId = pickupConfirmOrder?.localOrderId || pickupConfirmOrder?.fullOrder?.localOrderId;
                    const orderType = pickupConfirmOrder?.orderType;
                    
                    if (orderId) {
                      try {
                        if (orderType === 'online') {
                          // ì˜¨ë¼ì¸ ì£¼ë¬¸: Firebase ìƒíƒœë¥¼ picked_upìœ¼ë¡œ ë³€ê²½
                          await fetch(`${API_URL}/online-orders/order/${orderId}/pickup`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                          });
                          console.log('Firebase: Order marked as picked_up');
                          
                          // POS ë¡œì»¬ DB ìƒíƒœë„ ì—…ë°ì´íŠ¸ (localOrderIdê°€ ìžˆëŠ” ê²½ìš°)
                          if (localOrderId) {
                            await fetch(`${API_URL}/orders/${localOrderId}/status`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ status: 'PICKED_UP' }),
                            });
                            console.log('POS DB: Order marked as PICKED_UP');
                          }
                          
                          // ì˜¨ë¼ì¸ ì£¼ë¬¸ ëª©ë¡ì—ì„œ ì¦‰ì‹œ ì œê±°
                          setOnlineQueueCards(prev => prev.filter(card => card.id !== orderId));
                        } else if (orderType === 'togo') {
                          // Togo ì£¼ë¬¸: POS DBë§Œ ì—…ë°ì´íŠ¸
                          await fetch(`${API_URL}/orders/${orderId}/status`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ status: 'PICKED_UP' }),
                          });
                          console.log('POS DB: Togo order marked as PICKED_UP');
                          
                          // Togo ì£¼ë¬¸ ëª©ë¡ì—ì„œ ì¦‰ì‹œ ì œê±°
                          setTogoOrders(prev => prev.filter(order => order.id !== orderId));
                        }
                      } catch (error) {
                        console.error('Pickup complete error:', error);
                      }
                      
                      // ì„ íƒëœ ì£¼ë¬¸ë„ ì´ˆê¸°í™”
                      if (selectedOrderDetail?.id === orderId) {
                        setSelectedOrderDetail(null);
                      }
                    }
                    
                    // ëª¨ë‹¬ ë‹«ê¸°
                    setShowPickupConfirmModal(false);
                    setPickupConfirmOrder(null);
                    
                    // ëª©ë¡ ìƒˆë¡œê³ ì¹¨
                    loadOnlineOrders();
                    loadTogoOrders();
                  }}
                  className="w-full py-4 bg-green-500 hover:bg-green-600 text-white text-xl font-bold rounded-xl transition-colors shadow-lg"
                >
                  Pickup Complete
                </button>
                
                {/* Back to List - ìž‘ì€ ë²„íŠ¼ */}
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

      {/* UNPAID ì£¼ë¬¸ Pickup ì‹œë„ ì‹œ í™•ì¸ ëª¨ë‹¬ */}
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
              <div className="text-5xl mb-4">âš ï¸</div>
              <div className="text-lg text-gray-700 font-medium mb-2">
                This order has not been paid yet.
              </div>
              <div className="text-gray-500 mb-6">
                Please complete payment before pickup.
              </div>
              
              {/* Buttons */}
              <div className="space-y-3">
                {/* Payment - í° ë²„íŠ¼ */}
                <button
                  onClick={() => {
                    // UNPAID ëª¨ë‹¬ ë‹«ê¸°
                    setShowUnpaidPickupModal(false);
                    
                    // selectedOrderType ì„¤ì • (ê²°ì œ ì™„ë£Œ í›„ ì²˜ë¦¬ë¥¼ ìœ„í•´)
                    if (unpaidPickupOrder?.orderType) {
                      setSelectedOrderType(unpaidPickupOrder.orderType);
                    }
                    
                    // ê²°ì œ ëª¨ë‹¬ ì—´ê¸°
                    setOnlineTogoPaymentOrder(unpaidPickupOrder);
                    setShowOnlineTogoPaymentModal(true);
                    
                    setUnpaidPickupOrder(null);
                  }}
                  className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white text-xl font-bold rounded-xl transition-colors shadow-lg"
                >
                  Payment
                </button>
                
                {/* Back to List - ìž‘ì€ ë²„íŠ¼ */}
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

      {/* EXIT ëª¨ë‹¬ */}
      {showExitModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[80]">
          <div className="bg-white rounded-2xl shadow-2xl w-[350px] overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-gray-700 to-gray-800 text-white px-6 py-4 text-center">
              <div className="text-2xl font-bold">Exit Menu</div>
              <div className="text-gray-300 mt-1 text-sm">Select an option</div>
            </div>
            
            {/* Buttons */}
            <div className="p-6 space-y-3">
              {/* Go to Back Office ë²„íŠ¼ */}
              <button
                onClick={() => {
                  setShowExitModal(false);
                  navigate('/backoffice');
                }}
                className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white text-lg font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-3"
              >
                Go to Back Office
              </button>
              
              {/* Go to Windows 버튼 (앱 종료 또는 Intro로 이동) */}
              <button
                onClick={() => {
                  setShowExitModal(false);
                  try {
                    if (window.electron && window.electron.quit) {
                      // Electron 앱에서는 앱 종료
                      window.electron.quit();
                    } else {
                      // 브라우저에서는 Intro 페이지로 이동
                      window.location.href = '/';
                    }
                  } catch (e) {
                    console.error('Quit failed:', e);
                    window.location.href = '/';
                  }
                }}
                className="w-full py-4 bg-amber-500 hover:bg-amber-600 text-white text-lg font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-3"
              >
                <span className="text-2xl">🪟</span>
                Go to Windows
              </button>
            </div>
            
            {/* Cancel */}
            <div className="px-6 pb-6">
              <button
                onClick={() => setShowExitModal(false)}
                className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium rounded-xl transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Order Detail Modal (Online/Togo ì¹´ë“œ í´ë¦­ ì‹œ) - ê³µìš© ì»´í¬ë„ŒíŠ¸ ì‚¬ìš© */}
      <OrderDetailModal
        isOpen={showOrderDetailModal}
        onClose={() => {
          setShowOrderDetailModal(false);
          setSelectedOrderDetail(null);
          setSelectedOrderType(null);
        }}
        onlineOrders={onlineQueueCards as OrderData[]}
        togoOrders={togoOrders.filter(o => String(o.fulfillment || '').toLowerCase() !== 'delivery' && String(o.type || '').toLowerCase() !== 'delivery' && !o.deliveryCompany) as OrderData[]}
        deliveryOrders={togoOrders.filter(o => String(o.fulfillment || '').toLowerCase() === 'delivery' || String(o.type || '').toLowerCase() === 'delivery' || o.deliveryCompany) as OrderData[]}
        initialOrderType={(selectedOrderType as OrderChannelType) || 'togo'}
        initialSelectedOrder={selectedOrderDetail as OrderData}
        onPayment={(order, orderType) => {
          const orderForPayment = {
            id: order.id,
            type: orderType === 'online' ? 'Online' : 'Togo',
            orderType: orderType,
            number: (orderType === 'togo' || orderType === 'pickup')
              ? String(order.id).padStart(3, '0')
              : (order.number || order.id),
            time: order.time,
            phone: order.phone || order.customerPhone || '',
            name: order.name || order.customerName || '',
            total: Number(order.fullOrder?.total || order.total || 0),
            subtotal: Number(order.fullOrder?.subtotal || order.total || 0),
            tax: Number(order.fullOrder?.tax || 0),
            items: order.fullOrder?.items || order.items || [],
            localOrderId: order.localOrderId || order.fullOrder?.localOrderId || order.number,
            fullOrder: order.fullOrder,
            status: order.fullOrder?.status || order.status || 'pending',
          };
          setOnlineTogoPaymentOrder(orderForPayment);
          setShowOnlineTogoPaymentModal(true);
        }}
        onPickupComplete={async (order, orderType) => {
          const orderId = order.id;
          const localOrderId = order.localOrderId || order.fullOrder?.localOrderId || order.number;
          
          if (orderId) {
            try {
              if (orderType === 'online') {
                await fetch(`${API_URL}/online-orders/order/${orderId}/pickup`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                });
                if (localOrderId && typeof localOrderId === 'number') {
                  await fetch(`${API_URL}/orders/${localOrderId}/status`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'PICKED_UP' }),
                  });
                }
                setOnlineQueueCards(prev => prev.filter(card => card.id !== orderId));
              } else if (orderType === 'togo' || orderType === 'pickup') {
                await fetch(`${API_URL}/orders/${orderId}/status`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ status: 'PICKED_UP' }),
                });
                setTogoOrders(prev => prev.filter(o => o.id !== orderId));
              } else if (orderType === 'delivery') {
                const actualOrderId = order.order_id || orderId;
                await fetch(`${API_URL}/orders/${actualOrderId}/status`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ status: 'PICKED_UP' }),
                });
                setTogoOrders(prev => prev.filter(o => o.id !== orderId));
              }
            } catch (error) {
              console.error('Pickup complete error:', error);
            }
          }
          setShowOrderDetailModal(false);
          setSelectedOrderDetail(null);
          setSelectedOrderType(null);
          loadOnlineOrders();
          loadTogoOrders();
        }}
        onOrdersRefresh={() => {
          loadOnlineOrders();
          loadTogoOrders();
        }}
      />


      <ReservationCreateModal
        open={showReservationModal}
        onClose={() => setShowReservationModal(false)}
        onCreated={() => {
          setShowReservationModal(false);
        }}
        onTableStatusChanged={(tableId, tableName, status, customerName) => {
          // í…Œì´ë¸” ìƒíƒœê°€ ë³€ê²½ë˜ì—ˆì„ ë•Œ í…Œì´ë¸” ëª©ë¡ì„ ìƒˆë¡œê³ ì¹¨
          fetchTableMapData();
          
          // Hold ë˜ëŠ” Reserved ìƒíƒœì¸ ê²½ìš° ì˜ˆì•½ìž ì´ë¦„ ì €ìž¥
          if ((status === 'Hold' || status === 'Reserved') && customerName) {
            setTableReservationNames(prev => {
              const next = { ...prev, [String(tableId)]: customerName };
              try { localStorage.setItem(`reservedNames_${selectedFloor}`, JSON.stringify(next)); } catch {}
              return next;
            });
            console.log(`Setting reservation name for table ${tableId}:`, customerName);
          }
          
          // Occupied ìƒíƒœì¸ ê²½ìš° ì‹œê°„ ê¸°ë¡ (ê¸°ì¡´ ì ìœ  ì‹œê°„ì´ ì—†ì„ ë•Œë§Œ)
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
      
      {/* Day Opening Modal */}
      <DayOpeningModal 
        isOpen={showOpeningModal} 
        onClose={() => {
          // If they close without opening, maybe show exit confirmation or just keep it open
          setShowOpeningModal(false);
        }} 
        onOpeningComplete={(data) => {
          setShowOpeningModal(false);
          setIsDayClosed(false);
          // Optional: Refresh any day-related state
        }} 
      />

      {/* Day Closed Overlay */}
      {isDayClosed && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black bg-opacity-70 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full text-center">
            <div className="text-6xl mb-4"></div>
            <h2 className="text-3xl font-bold text-gray-800 mb-2">Day is Closed</h2>
            <p className="text-gray-600 mb-8">
              Today's business has been closed. <br/>
              To start taking orders, please re-open the day.
            </p>
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => {
                  setIsDayClosed(false);
                  setShowOpeningModal(true);
                }}
                className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xl rounded-xl shadow-lg transition-all"
              >
                🔄 Re-Open Day
              </button>
              <button 
                onClick={() => navigate('/')}
                className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl transition-all"
              >
                Go to Home
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Day Closing Modal */}
      <DayClosingModal
        isOpen={showClosingModal}
        onClose={() => setShowClosingModal(false)}
        onClosingComplete={() => setIsDayClosed(true)}
      />

      {/* Clock In/Out Menu Modal */}
      {showClockInOutMenu && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-96">
            <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">
              â° Clock In/Out
            </h2>
            
            <div className="space-y-3">
              <button
                onClick={() => {
                  console.log('Clock In ë©”ë‰´ì—ì„œ ì„ íƒë¨');
                  setShowClockInOutMenu(false);
                  setShowClockInModal(true);
                }}
                className="w-full px-6 py-4 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-lg shadow-md transition-colors text-lg"
              >
                â° Clock In
              </button>
              
              <button
                onClick={() => {
                  console.log('Clock Out ë©”ë‰´ì—ì„œ ì„ íƒë¨');
                  setShowClockInOutMenu(false);
                  setShowClockOutModal(true);
                }}
                className="w-full px-6 py-4 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-lg shadow-md transition-colors text-lg"
              >
                🚪 Clock Out
              </button>
            </div>

            <button
              onClick={() => setShowClockInOutMenu(false)}
              className="mt-4 w-full px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg font-semibold text-gray-700 transition-colors"
            >
              Cancel
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
            
            alert(`${employee.name}, you have clocked in!\nTime: ${new Date(response.clockInTime).toLocaleTimeString('en-US')}`);
            
            setShowClockInModal(false);
          } catch (error: any) {
            setClockError(error.message || 'Clock in failed');
          } finally {
            setIsClockLoading(false);
          }
        }}
        title="Clock In"
        message="Enter your PIN"
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
            
            alert(`${employee.name}, you have clocked out!\nTotal hours: ${response.totalHours} hours`);
            
            setShowClockOutModal(false);
          } catch (error: any) {
            setClockError(error.message || 'Clock out failed');
          } finally {
            setIsClockLoading(false);
          }
        }}
        title="Clock Out"
        message="Enter your PIN"
        isLoading={isClockLoading}
        error={clockError}
      />

      {/* Early Out Modal */}
      {showEarlyOutModal && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-96">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">
              âš ï¸ Early Out
            </h2>
            
            <p className="text-gray-600 mb-4">
              Please enter the reason for {selectedEmployee?.name}'s early out.
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Early Out Reason *
              </label>
              <textarea
                value={earlyOutReason}
                onChange={(e) => setEarlyOutReason(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
                placeholder="ì˜ˆ: ê°œì¸ ì‚¬ì •, ë³‘ì› ë°©ë¬¸ ë“±"
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                ìŠ¹ì¸ìž (ì„ íƒ)
              </label>
              <input
                type="text"
                value={approvedBy}
                onChange={(e) => setApprovedBy(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="ìŠ¹ì¸ìž ì´ë¦„"
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
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!selectedEmployee || !earlyOutReason.trim()) {
                    alert('Please enter a reason for early out.');
                    return;
                  }

                  setIsClockLoading(true);

                  try {
                    const pin = prompt(`${selectedEmployee.name}ë‹˜, PINì„ ë‹¤ì‹œ ìž…ë ¥í•´ì£¼ì„¸ìš”:`);
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

                    alert(`${selectedEmployee.name}, early out processed.\nTotal hours: ${response.totalHours} hours`);

                    setShowEarlyOutModal(false);
                    setSelectedEmployee(null);
                    setEarlyOutReason('');
                    setApprovedBy('');
                  } catch (error: any) {
                    alert(`Early out failed: ${error.message}`);
                  } finally {
                    setIsClockLoading(false);
                  }
                }}
                disabled={!earlyOutReason.trim() || isClockLoading}
                className="flex-1 px-4 py-3 bg-red-500 hover:bg-red-600 rounded-lg font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isClockLoading ? 'Processing...' : 'Process Early Out'}
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
                        // ì¹´ë“œë²ˆí˜¸ê°€ 16ìžë¦¬ë©´ ë°”ë¡œ ìž”ì•¡ ì¡°íšŒ
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
                  {['1', '2', '3', 'C', '4', '5', '6', 'âŒ«', '7', '8', '9', '', '0', '00', '.', ''].map((key, idx) => (
                    <button
                      key={`numpad-${key}-${idx}`}
                      onClick={() => {
                        if (giftCardInputFocus === 'card') {
                          // Card number input
                          const fullNumber = giftCardNumber.join('');
                          if (key === 'C') {
                            setGiftCardNumber(['', '', '', '']);
                          } else if (key === 'âŒ«') {
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
                          } else if (key === 'âŒ«') {
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
                          } else if (key === 'âŒ«') {
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
                          : key === 'âŒ«'
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
                    🔄 ì¶©ì „ ëª¨ë“œ - ê¸°ì¡´ ìž”ì•¡: ${giftCardExistingBalance?.toFixed(2)}
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
                        {giftCardSellerPin ? 'â—'.repeat(giftCardSellerPin.length) : <span className="text-gray-400">PIN</span>}
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
              <button onClick={closeRefundModal} className="text-white hover:text-gray-200 text-5xl font-bold w-14 h-14 flex items-center justify-center rounded-lg hover:bg-red-700 transition-colors">Ã—</button>
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
                        <span className="text-2xl"></span>
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
                        
                        // ì£¼ë¬¸ ì±„ë„ë³„ í‘œì‹œ
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
                            {/* Line 1: ë‚ ì§œ ì£¼ë¬¸ì±„ë„ (ì „ë²ˆ ì´ë¦„ - ONLINE/TOGOë§Œ) */}
                            <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 mb-1">
                              <span>{dateStr} {timeStr}</span>
                              <span className="font-bold text-blue-700">{channelDisplay}</span>
                              {showCustomerInfo && customerPhone && <span className="text-gray-600">{customerPhone}</span>}
                              {showCustomerInfo && customerName && <span className="text-gray-700">{customerName}</span>}
                            </div>
                            {/* Line 2: ê²°ì œë„êµ¬ ê¸ˆì•¡ */}
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
                        {['1', '2', '3', 'C', '4', '5', '6', 'âŒ«', '7', '8', '9', '', '.', '0', '00', ''].map((key, idx) => (
                          key === '' ? <div key={idx}></div> : (
                            <button
                              key={key}
                              onClick={() => {
                                if (key === 'C') {
                                  setRefundPin('');
                                } else if (key === 'âŒ«') {
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
                                key === 'âŒ«' ? 'bg-orange-200 text-orange-700' :
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
                      {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'âŒ«'].map((key) => (
                        <button
                          key={key}
                          onClick={() => {
                            if (isGiftCard) {
                              // Gift Card: Only card number input
                              if (key === 'C') {
                                setRefundGiftCardNumber('');
                              } else if (key === 'âŒ«') {
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
                              } else if (key === 'âŒ«') {
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
                            key === 'âŒ«' ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' :
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
                      {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'âŒ«'].map((key) => (
                        <button
                          key={key}
                          onClick={() => {
                            if (key === 'C') {
                              setRefundGiftCardNumber('');
                            } else if (key === 'âŒ«') {
                              setRefundGiftCardNumber(refundGiftCardNumber.slice(0, -1));
                            } else {
                              if (refundGiftCardNumber.length < 16) {
                                setRefundGiftCardNumber(refundGiftCardNumber + key);
                              }
                            }
                          }}
                          className={`h-14 text-xl font-bold rounded-lg ${
                            key === 'C' ? 'bg-red-100 text-red-600 hover:bg-red-200' :
                            key === 'âŒ«' ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' :
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


