import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { resolveMenuIdentifiers } from '../utils/menuIdentifier';
import { getLocalDateString } from '../utils/datetimeUtils';
import { isMasterPosPin, MASTER_POS_PIN } from '../constants/masterPosPin';
import {
  NEO_PRESS_INSET_ONLY_NO_SHIFT,
  NEO_MODAL_BTN_PRESS,
  NEO_PREP_TIME_BTN_PRESS,
  NEO_COLOR_BTN_PRESS_NO_SHIFT,
  PAY_NEO,
  PAY_NEO_CANVAS,
  PAY_KEYPAD_KEY,
  OH_ACTION_NEO,
} from '../utils/softNeumorphic';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend
} from 'recharts';

/** 키패드·회색 액션 — PinInputModal과 동일 인셋 네오 */
const CLOSING_PAD_NEO_PRESS = `${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS}`;

const OperationalReportsPanel = lazy(() => import('./OperationalReportsPanel'));

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3177/api';
const DAY_CLOSE_MIN_LEVEL_KEY = 'perm_reports_day_close_level';

interface PaymentMethodEntry {
  method: string;
  count: number;
  net: number;
  gross: number;
  tip: number;
}

interface ZReportData {
  session_id?: string;
  date: string;
  store_name: string;
  service_mode: string;
  opening_cash: number;
  expected_cash: number;
  total_sales: number;
  subtotal: number;
  order_count: number;
  tax_total: number;
  gst_total?: number;
  pst_total?: number;
  gratuity_total: number;
  guest_count: number;
  first_order_time: string | null;
  last_order_time: string | null;
  dine_in_sales: number;
  togo_sales: number;
  online_sales: number;
  delivery_sales: number;
  cash_sales: number;
  card_sales: number;
  other_sales: number;
  visa_sales: number;
  mastercard_sales: number;
  debit_sales: number;
  other_card_sales: number;
  tip_total: number;
  cash_tips: number;
  card_tips: number;
  visa_tips: number;
  mastercard_tips: number;
  debit_tips: number;
  other_card_tips: number;
  payment_methods: PaymentMethodEntry[];
  refund_total: number;
  refund_count: number;
  cash_refund_total: number;
  void_total: number;
  void_count: number;
  discount_total: number;
  discount_order_count?: number;
  gift_card_sold: number;
  gift_card_sold_count: number;
  gift_card_payment: number;
  gift_card_payment_count: number;
  reservation_fee_received: number;
  reservation_fee_received_count: number;
  reservation_fee_applied: number;
  reservation_fee_applied_count: number;
  no_show_forfeited: number;
  no_show_forfeited_count: number;
  refund_details?: Array<{
    id: number; order_id: number; order_number: string; type: string;
    total: number; payment_method: string; reason: string; refunded_by?: string; created_at: string;
  }>;
  void_details?: Array<{
    id: number; order_id: number; order_number: string; total: number;
    source: string; reason: string; created_by: string; created_at: string;
  }>;
  discount_details?: Array<{
    id: number; order_id: number; order_number: string; kind: string;
    amount_applied: number; label: string;
    applied_by_employee_id?: string; applied_by_name?: string; created_at: string;
  }>;
  status: string;
  opened_at?: string;
  closed_at?: string;
}

interface DayClosingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onClosingComplete: () => void;
}

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
};

const formatMoney = (amt: number) => `$${(amt || 0).toFixed(2)}`;

const centDenominations = [
  { key: 'cent1', label: '1¢', value: 0.01 },
  { key: 'cent5', label: '5¢', value: 0.05 },
  { key: 'cent10', label: '10¢', value: 0.10 },
  { key: 'cent25', label: '25¢', value: 0.25 },
];

const dollarDenominations = [
  { key: 'dollar1', label: '$1', value: 1 },
  { key: 'dollar2', label: '$2', value: 2 },
  { key: 'dollar5', label: '$5', value: 5 },
  { key: 'dollar10', label: '$10', value: 10 },
  { key: 'dollar20', label: '$20', value: 20 },
  { key: 'dollar50', label: '$50', value: 50 },
  { key: 'dollar100', label: '$100', value: 100 },
];

const allDenominations = [...centDenominations, ...dollarDenominations];

type CashCounts = {
  cent1: number; cent5: number; cent10: number; cent25: number;
  dollar1: number; dollar2: number; dollar5: number; dollar10: number;
  dollar20: number; dollar50: number; dollar100: number;
};

type ViewMode = 'cash-count' | 'print-preview' | 'shift-result';
type ModalTab = 'closing' | 'report-dashboard' | 'z-report' | 'item-report' | 'server-sales';
type ItemReportPeriod = 'today' | '7days' | 'weekly' | 'monthly' | 'custom';

interface ItemReportData {
  period: { startDate: string; endDate: string };
  summary: { totalOrders: number; totalSales: number; avgPerOrder: number };
  channels: Array<{ channel: string; orderCount: number; totalSales: number; subtotal: number; tax: number; avgPerOrder: number }>;
  paymentMethods: Array<{ method: string; orderCount: number; totalAmount: number; totalTip: number }>;
  items: Array<{
    rank: number;
    name: string;
    // backward-compatible (sold)
    quantity: number;
    revenue: number;
    orderCount: number;
    // detailed
    soldQty?: number;
    soldAmount?: number;
    refundQty?: number;
    refundAmount?: number;
    voidQty?: number;
    voidAmount?: number;
    netQty?: number;
    netAmount?: number;
  }>;
  itemTotals: {
    totalQuantity: number;
    totalRevenue: number;
    uniqueItems: number;
    refundQuantity?: number;
    refundAmount?: number;
    voidQuantity?: number;
    voidAmount?: number;
    netQuantity?: number;
    netAmount?: number;
  };
  dailyBreakdown: Array<{ date: string; orderCount: number; totalSales: number }>;
  categorySales?: Array<{ category: string; quantity: number; revenue: number }>;
}

type ServerSalesRow = {
  serverId: string;
  serverName: string;
  orderCount: number;
  grossSales: number;
  cashTips: number;
  cardTips: number;
  totalTip: number;
};

interface ZReportHistoryRecord {
  session_id: string;
  date: string;
  status: string;
  opened_at: string;
  closed_at: string;
  total_sales: number;
  order_count: number;
  opening_cash: number;
  closing_cash: number;
}

const DayClosingModal: React.FC<DayClosingModalProps> = ({ isOpen, onClose, onClosingComplete }) => {
  const navigate = useNavigate();
  const [zReportData, setZReportData] = useState<ZReportData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isShiftClosing, setIsShiftClosing] = useState(false);
  const [showShiftCloseCashOk, setShowShiftCloseCashOk] = useState(false);
  /** Day Close 접근에 사용한 직원 — Shift Close는 본인만 (서버 선택 없음) */
  const [closingAccessEmployeeName, setClosingAccessEmployeeName] = useState<string>('');
  const [closingAccessEmployeeId, setClosingAccessEmployeeId] = useState<string>('');
  const [dayCloseMinLevel, setDayCloseMinLevel] = useState<number>(4);
  const [accessPin, setAccessPin] = useState<string>('');
  const [accessError, setAccessError] = useState<string>('');
  const [isVerifyingAccess, setIsVerifyingAccess] = useState<boolean>(false);
  const [accessGranted, setAccessGranted] = useState<boolean>(false);
  const [accessEmployeeLabel, setAccessEmployeeLabel] = useState<string>('');
  const [isPayLoading, setIsPayLoading] = useState<boolean>(false);

  const [voidTarget, setVoidTarget] = useState<any | null>(null);
  const [showVoidPinModal, setShowVoidPinModal] = useState<boolean>(false);
  const [voidPin, setVoidPin] = useState<string>('');
  const [voidReason, setVoidReason] = useState<string>('Unpaid order void (Day Close)');
  const [isVoiding, setIsVoiding] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<ViewMode>('cash-count');
  const [shiftResult, setShiftResult] = useState<any>(null);
  const [showCopiesModal, setShowCopiesModal] = useState(false);
  const [closingCopies, setClosingCopies] = useState(1);

  // Sales Report tab state
  const [activeTab, setActiveTab] = useState<ModalTab>('closing');

  // Z Report History tab state
  const [zReportHistoryList, setZReportHistoryList] = useState<ZReportHistoryRecord[]>([]);
  const [zReportHistoryData, setZReportHistoryData] = useState<ZReportData | null>(null);
  const [selectedZReportDate, setSelectedZReportDate] = useState<string>('');
  const [isZReportHistoryLoading, setIsZReportHistoryLoading] = useState(false);
  const [isPrintingZReport, setIsPrintingZReport] = useState(false);

  // Item Report tab state
  const [itemReportPeriod, setItemReportPeriod] = useState<ItemReportPeriod>('today');
  const [itemReportData, setItemReportData] = useState<ItemReportData | null>(null);
  const [isItemReportLoading, setIsItemReportLoading] = useState(false);
  const [itemCustomStartDate, setItemCustomStartDate] = useState<string>('');
  const [itemCustomEndDate, setItemCustomEndDate] = useState<string>('');
  const [isPrintingItemReport, setIsPrintingItemReport] = useState(false);
  const [topTrend, setTopTrend] = useState<{ items: Array<{ name: string; trend: Array<{ period: string; qty: number; revenue: number }> }>; periods: string[] } | null>(null);
  const [bottomTrend, setBottomTrend] = useState<{ items: Array<{ name: string; trend: Array<{ period: string; qty: number; revenue: number }> }>; periods: string[] } | null>(null);

  // Server Sales tab state
  const [serverSalesDate, setServerSalesDate] = useState<string>(() => {
    try { return getLocalDateString(); } catch { return ''; }
  });
  const [serverSalesRows, setServerSalesRows] = useState<ServerSalesRow[]>([]);
  const [selectedServerSalesId, setSelectedServerSalesId] = useState<string>('');
  const [isServerSalesLoading, setIsServerSalesLoading] = useState(false);
  const [isPrintingServerSales, setIsPrintingServerSales] = useState(false);
  const [showServerSalesCashCount, setShowServerSalesCashCount] = useState(false);
  const [serverSalesCashCounts, setServerSalesCashCounts] = useState<CashCounts>({
    cent1: 0, cent5: 0, cent10: 0, cent25: 0,
    dollar1: 0, dollar2: 0, dollar5: 0, dollar10: 0, dollar20: 0, dollar50: 0, dollar100: 0
  });
  const [serverSalesFocusedDenom, setServerSalesFocusedDenom] = useState<string>('dollar1');
  const selectedServerSales = useMemo(
    () => serverSalesRows.find(r => String(r.serverId) === String(selectedServerSalesId)) || null,
    [serverSalesRows, selectedServerSalesId]
  );

  const serverSalesCountedCashTotal = useMemo(() => {
    return allDenominations.reduce((sum, denom) => {
      return sum + (serverSalesCashCounts[denom.key as keyof CashCounts] * denom.value);
    }, 0);
  }, [serverSalesCashCounts]);
  
  const [cashCounts, setCashCounts] = useState<CashCounts>({
    cent1: 0, cent5: 0, cent10: 0, cent25: 0,
    dollar1: 0, dollar2: 0, dollar5: 0, dollar10: 0, dollar20: 0, dollar50: 0, dollar100: 0
  });
  const [focusedDenom, setFocusedDenom] = useState<string>('dollar1');
  
  const calculateCashTotal = () => {
    return allDenominations.reduce((sum, denom) => {
      return sum + (cashCounts[denom.key as keyof CashCounts] * denom.value);
    }, 0);
  };
  
  const closingCashTotal = calculateCashTotal();
  const expectedCash = zReportData?.expected_cash || 0;
  const cashDifference = closingCashTotal - expectedCash;


  // Z Report History fetch
  const fetchZReportHistory = useCallback(async () => {
    setIsZReportHistoryLoading(true);
    try {
      const res = await fetch(`${API_URL}/daily-closings/z-report-history?limit=60`);
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) setZReportHistoryList(json.data);
    } catch (e) { console.error('Z-Report history fetch failed:', e); }
    finally { setIsZReportHistoryLoading(false); }
  }, []);

  const fetchZReportByDate = useCallback(async (date: string) => {
    setIsZReportHistoryLoading(true);
    setSelectedZReportDate(date);
    try {
      const res = await fetch(`${API_URL}/daily-closings/z-report-history?date=${date}`);
      const json = await res.json();
      if (json.success && json.data) setZReportHistoryData(json.data as ZReportData);
      else setZReportHistoryData(null);
    } catch (e) { console.error('Z-Report by date fetch failed:', e); setZReportHistoryData(null); }
    finally { setIsZReportHistoryLoading(false); }
  }, []);

  const printZReportHistory = useCallback(async () => {
    if (!zReportHistoryData) return;
    setIsPrintingZReport(true);
    try {
      const res = await fetch(`${API_URL}/daily-closings/print-z-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          zReportData: zReportHistoryData,
          closingCash: (zReportHistoryData as any).closing_cash || 0,
          cashBreakdown: (zReportHistoryData as any).cash_breakdown || {},
          copies: 1
        })
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok || json?.success === false) throw new Error(json?.error || 'Print failed');
    } catch (err: any) { console.error('Z-Report print error:', err?.message); }
    finally { setIsPrintingZReport(false); }
  }, [zReportHistoryData]);

  useEffect(() => {
    if (activeTab === 'z-report' && accessGranted && zReportHistoryList.length === 0) fetchZReportHistory();
  }, [activeTab, accessGranted, zReportHistoryList.length, fetchZReportHistory]);

  // Item Report fetch
  const getItemReportDateRange = useCallback((period: ItemReportPeriod): { startDate: string; endDate: string } => {
    const today = new Date();
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if (period === 'today') return { startDate: fmt(today), endDate: fmt(today) };
    if (period === '7days') { const d = new Date(today); d.setDate(d.getDate() - 6); return { startDate: fmt(d), endDate: fmt(today) }; }
    if (period === 'weekly') {
      const dayOfWeek = today.getDay();
      const startOfWeek = new Date(today);
      startOfWeek.setDate(today.getDate() - dayOfWeek);
      return { startDate: fmt(startOfWeek), endDate: fmt(today) };
    }
    if (period === 'monthly') {
      const d = new Date(today.getFullYear(), today.getMonth(), 1);
      return { startDate: fmt(d), endDate: fmt(today) };
    }
    return { startDate: itemCustomStartDate || fmt(today), endDate: itemCustomEndDate || fmt(today) };
  }, [itemCustomStartDate, itemCustomEndDate]);

  const fetchItemReport = useCallback(async (period: ItemReportPeriod) => {
    setIsItemReportLoading(true);
    try {
      const { startDate, endDate } = getItemReportDateRange(period);
      const res = await fetch(`${API_URL}/daily-closings/item-report?startDate=${startDate}&endDate=${endDate}`);
      const json = await res.json();
      if (json.success) setItemReportData(json as ItemReportData);
      else console.error('Item report error:', json.error);
    } catch (e) { console.error('Item report fetch failed:', e); }
    finally { setIsItemReportLoading(false); }
  }, [getItemReportDateRange]);

  const printItemReport = useCallback(async () => {
    if (!itemReportData) return;
    setIsPrintingItemReport(true);
    try {
      const res = await fetch(`${API_URL}/daily-closings/print-item-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportData: itemReportData, copies: 1 })
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok || json?.success === false) throw new Error(json?.error || 'Print failed');
    } catch (err: any) { console.error('Item Report print error:', err?.message); }
    finally { setIsPrintingItemReport(false); }
  }, [itemReportData]);

  useEffect(() => {
    if (activeTab === 'item-report' && accessGranted) fetchItemReport(itemReportPeriod);
  }, [activeTab, itemReportPeriod, accessGranted, fetchItemReport]);

  useEffect(() => {
    if (activeTab === 'item-report' && accessGranted) {
      const fetchTrend = async (type: string, setter: (d: any) => void) => {
        try {
          const r = await fetch(`${API_URL}/daily-closings/item-trend?type=${type}`);
          const j = await r.json();
          if (j.success) setter(j);
        } catch { /* ignore */ }
      };
      fetchTrend('top', setTopTrend);
      fetchTrend('bottom', setBottomTrend);
    }
  }, [activeTab, accessGranted]);

  const fetchServerSales = useCallback(async () => {
    if (!serverSalesDate) return;
    setIsServerSalesLoading(true);
    try {
      const res = await fetch(`${API_URL}/server-settlements/server-sales?business_date=${encodeURIComponent(serverSalesDate)}`, {
        cache: 'no-store' as any,
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok || json?.success === false) throw new Error(json?.error || 'Failed to load server sales');
      const nextRows = Array.isArray(json?.rows) ? json.rows : [];
      setServerSalesRows(nextRows);
      setSelectedServerSalesId((prev) => {
        if (prev && nextRows.some((r: any) => String(r.serverId) === String(prev))) return prev;
        const first = nextRows?.[0]?.serverId;
        return first ? String(first) : '';
      });
    } catch (e: any) {
      console.error('Server sales fetch failed:', e);
      setServerSalesRows([]);
      setSelectedServerSalesId('');
    } finally {
      setIsServerSalesLoading(false);
    }
  }, [serverSalesDate]);

  useEffect(() => {
    if (activeTab === 'server-sales' && accessGranted) fetchServerSales();
  }, [activeTab, accessGranted, fetchServerSales]);

  const printSelectedServerSales = useCallback(async () => {
    if (!serverSalesDate || !selectedServerSalesId) return;
    if (isPrintingServerSales) return;
    setIsPrintingServerSales(true);
    try {
      const res = await fetch(`${API_URL}/server-settlements/print-server-sales`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_date: serverSalesDate,
          server_id: selectedServerSalesId,
          counted_cash: serverSalesCountedCashTotal,
          cash_breakdown: serverSalesCashCounts,
          copies: 1,
        }),
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok || json?.success === false) throw new Error(json?.error || 'Print failed');
      // print success - no alert needed
    } catch (e: any) {
      alert(e?.message || 'Print failed');
    } finally {
      setIsPrintingServerSales(false);
    }
  }, [serverSalesDate, selectedServerSalesId, isPrintingServerSales, serverSalesCountedCashTotal, serverSalesCashCounts]);

  const renderServerSalesDenomItem = (denom: { key: string; label: string; value: number }, isCent: boolean) => {
    const isSelected = serverSalesFocusedDenom === denom.key;
    const baseStyle = isCent
      ? isSelected ? 'border-amber-500 bg-amber-100' : 'border-amber-200 bg-amber-50 hover:border-amber-400'
      : isSelected ? 'border-green-500 bg-green-100' : 'border-green-200 bg-green-50 hover:border-green-400';
    return (
      <div
        key={denom.key}
        onClick={() => setServerSalesFocusedDenom(denom.key)}
        className={`flex items-center justify-between px-3 py-3 rounded-lg border-2 cursor-pointer transition-all ${baseStyle}`}
      >
        <span className={`font-bold text-base ${isCent ? 'text-amber-700' : 'text-green-700'}`}>{denom.label}</span>
        <div className="flex items-center gap-2">
          <span className={`font-bold text-lg ${isCent ? 'text-amber-600' : 'text-green-600'}`}>
            {serverSalesCashCounts[denom.key as keyof CashCounts]}
          </span>
          <span className="text-xs text-gray-400">
            ={formatCurrency(serverSalesCashCounts[denom.key as keyof CashCounts] * denom.value)}
          </span>
        </div>
      </div>
    );
  };

  const handleServerSalesNumPad = (num: string) => {
    if (!serverSalesFocusedDenom) return;
    const currentValue = serverSalesCashCounts[serverSalesFocusedDenom as keyof CashCounts];
    let newValue: number;
    if (num === 'C') newValue = 0;
    else if (num === '⌫') newValue = Math.floor(currentValue / 10);
    else {
      newValue = currentValue * 10 + parseInt(num);
      if (newValue > 9999) newValue = 9999;
    }
    setServerSalesCashCounts(prev => ({ ...prev, [serverSalesFocusedDenom]: newValue } as any));
  };

  const roleToLevel = (roleRaw: any): number => {
    const r = String(roleRaw || '').toLowerCase();
    if (r.includes('owner') || r.includes('admin')) return 5;
    if (r.includes('manager')) return 4;
    if (r.includes('supervisor')) return 3;
    if (r.includes('server') || r.includes('cashier')) return 2;
    if (r.includes('kitchen') || r.includes('bar')) return 1;
    return 2;
  };

  const clampLevel = (n: any, fallback: number) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return fallback;
    return Math.min(5, Math.max(1, Math.round(v)));
  };

  const loadDayCloseMinLevel = () => {
    try {
      const raw = localStorage.getItem(DAY_CLOSE_MIN_LEVEL_KEY);
      return clampLevel(raw, 4);
    } catch {
      return 4;
    }
  };

  const openPayForOrder = async (row: any) => {
    try {
      setIsPayLoading(true);
      const orderId = Number(row?.orderId);
      if (!Number.isFinite(orderId)) return;

      // Navigate to the SAME Dine-in payment flow (OrderPage + PaymentModal) for 100% identical behavior.
      const rawType = String(row?.orderType || row?.order_type || row?.order?.order_type || '').toLowerCase();
      const rawFulfillment = String(row?.fulfillmentMode || row?.fulfillment_mode || row?.order?.fulfillment_mode || '').toLowerCase();
      const nextOrderType =
        rawType.includes('togo') || rawFulfillment.includes('togo') || rawFulfillment.includes('pickup')
          ? 'togo'
          : rawType.includes('online')
          ? 'online'
          : rawType.includes('delivery')
          ? 'delivery'
          : 'pos';

      const ids = await resolveMenuIdentifiers(API_URL);
      const menuIdNum = Number(ids.menuId) || 1;

      onClose();
      navigate('/sales/order', {
        state: {
          orderType: nextOrderType,
          menuId: menuIdNum,
          menuName: ids.menuName || undefined,
          orderId,
          loadExisting: true,
          openPayment: true,
          fromClosing: true,
          customerName: row?.customerName || row?.order?.customer_name || '',
          customerPhone: row?.customerPhone || row?.order?.customer_phone || '',
          tableId: row?.tableId || row?.order?.table_id || undefined,
          tableName: row?.tableName || row?.order?.table_name || undefined,
          fulfillmentMode: row?.fulfillmentMode || row?.order?.fulfillment_mode || null,
        },
      });
    } catch (e: any) {
      console.error('Open pay modal error:', e);
      alert(e?.message || 'Failed to open payment');
    } finally {
      setIsPayLoading(false);
    }
  };

  const openVoidForOrder = (row: any) => {
    setVoidTarget(row);
    setVoidPin('');
    setVoidReason('Unpaid order void (Day Close)');
    setShowVoidPinModal(true);
  };

  const confirmVoid = async () => {
    try {
      if (!voidTarget?.orderId) return;
      const pin = String(voidPin || '').trim();
      if (!pin) {
        alert('Manager PIN is required.');
        return;
      }
      setIsVoiding(true);

      // Load full order to build void lines (entire order)
      const res = await fetch(`${API_URL}/orders/${voidTarget.orderId}`);
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Failed to load order for void');
      const order = json.order || {};
      const items = Array.isArray(json.items) ? json.items : [];

      const lines = items
        .filter((it: any) => (it?.type || 'item') === 'item')
        .map((it: any) => {
          const qty = Number(it.quantity || 0);
          const price = Number(it.price || 0);
          const amount = Number((qty * price).toFixed(2));
          const taxRate = Number(it.taxRate || 0); // decimal (ex: 0.05)
          const tax = Number((amount * taxRate).toFixed(2));
          return {
            order_line_id: it.orderLineId ?? it.order_line_id ?? null,
            menu_id: it.id ?? it.item_id ?? null,
            name: it.name || 'Item',
            qty,
            amount,
            tax,
            printer_group_id: null
          };
        })
        .filter((l: any) => l.qty > 0 && (l.amount !== 0 || l.tax !== 0));

      if (!lines.length) {
        // Fallback: one synthetic line using order totals
        const subtotal = Number(order.subtotal || voidTarget.subtotal || 0);
        const tax = Number(order.tax || voidTarget.tax || 0);
        lines.push({
          order_line_id: null,
          menu_id: null,
          name: 'ENTIRE ORDER',
          qty: 1,
          amount: Number(subtotal.toFixed(2)),
          tax: Number(tax.toFixed(2)),
          printer_group_id: null
        });
      }

      const vRes = await fetch(`${API_URL}/orders/${voidTarget.orderId}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'entire',
          manager_pin: pin,
          reason: voidReason || 'Unpaid order void (Day Close)',
          note: '',
          created_by: null,
          lines
        })
      });
      const vJson = await vRes.json().catch(() => ({}));
      if (!vRes.ok || vJson?.ok === false) {
        throw new Error(vJson?.error || 'Void failed');
      }

      setShowVoidPinModal(false);
      setVoidTarget(null);
      setVoidPin('');
      await fetchZReport();
    } catch (e: any) {
      console.error('Void confirm error:', e);
      alert(e?.message || 'Void failed');
    } finally {
      setIsVoiding(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      // Access gate: require employee PIN at open
      setAccessGranted(false);
      setAccessEmployeeLabel('');
      setClosingAccessEmployeeName('');
      setClosingAccessEmployeeId('');
      setAccessPin('');
      setAccessError('');
      setIsVerifyingAccess(false);
      setDayCloseMinLevel(loadDayCloseMinLevel());

      setCashCounts({
        cent1: 0, cent5: 0, cent10: 0, cent25: 0,
        dollar1: 0, dollar2: 0, dollar5: 0, dollar10: 0, dollar20: 0, dollar50: 0, dollar100: 0
      });
      setFocusedDenom('dollar1');
      setViewMode('cash-count');
      setShiftResult(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && accessGranted) {
      fetchZReport();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, accessGranted]);

  const fetchZReport = async (): Promise<ZReportData | null> => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_URL}/daily-closings/z-report`);
      const result = await response.json();
      if (result.success) {
        setZReportData(result.data);
        return result.data as ZReportData;
      }
      return null;
    } catch (error) {
      console.error('Failed to fetch Z-Report:', error);
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const handleNumPad = (num: string) => {
    if (!focusedDenom) return;
    const currentValue = cashCounts[focusedDenom as keyof CashCounts];
    let newValue: number;
    if (num === 'C') { newValue = 0; }
    else if (num === '⌫') { newValue = Math.floor(currentValue / 10); }
    else { newValue = currentValue * 10 + parseInt(num); if (newValue > 9999) newValue = 9999; }
    setCashCounts(prev => ({ ...prev, [focusedDenom]: newValue }));
  };

  const printZReport = async (overrideData?: ZReportData | null, copies: number = 1) => {
    try {
      const dataToPrint = overrideData || zReportData;
      if (!dataToPrint) {
        alert('No report data to print. Please try again.');
        return false;
      }
      const res = await fetch(`${API_URL}/daily-closings/print-z-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zReportData: dataToPrint, closingCash: closingCashTotal, cashBreakdown: cashCounts, copies })
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok || json?.success === false) {
        const msg = json?.error || 'Print failed. Please check Front printer settings.';
        throw new Error(msg);
      }
      return true;
    } catch (error: any) {
      console.error('Print error:', error);
      alert(error?.message || 'Print failed');
      return false;
    }
  };

  const handleShowPreview = async () => {
    // Always refresh z-report data before showing preview
    await fetchZReport();
    setViewMode('print-preview');
  };

  const handlePrintAndClose = async () => {
    setIsClosing(true);
    try {
      const response = await fetch(`${API_URL}/daily-closings/closing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ closingCash: closingCashTotal, cashBreakdown: cashCounts, closedBy: '' })
      });
      const result = await response.json();
      if (result.success) {
        const printed = await printZReport(zReportData, closingCopies);
        if (!printed) {
          alert('Day Closing completed, but printing failed. Please reprint Z-Report after checking the Front printer.');
        }
        setClosingCopies(1);
        const today = getLocalDateString();
        localStorage.setItem('pos_last_closed_date', today);
        onClosingComplete();
        onClose();
      } else {
        alert(result.error || 'Closing failed');
      }
    } catch (error: any) {
      console.error('Closing error:', error);
      alert('Closing failed: ' + error.message);
    } finally {
      setIsClosing(false);
    }
  };

  // ========== SHIFT CLOSE ==========
  const handleShiftClose = async () => {
    setIsShiftClosing(true);
    try {
      const response = await fetch(`${API_URL}/daily-closings/shift-close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          countedCash: closingCashTotal,
          cashDetails: cashCounts,
          closedBy: closingAccessEmployeeName || '',
          serverId: closingAccessEmployeeId || '',
          serverPin: accessPin || ''
        })
      });
      const result = await response.json();
      if (result.success) {
        setShiftResult(result.data);
        setViewMode('shift-result');
        // Print shift report
        await fetch(`${API_URL}/daily-closings/print-shift-report`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shiftData: result.data })
        });
        // Refresh z-report data
        fetchZReport();
      } else {
        alert(result.error || 'Shift close failed');
      }
    } catch (error: any) {
      console.error('Shift close error:', error);
      alert('Shift close failed: ' + error.message);
    } finally {
      setIsShiftClosing(false);
    }
  };

  const printShiftReport = async (overrideShift?: any) => {
    try {
      const dataToPrint = overrideShift || shiftResult;
      if (!dataToPrint) {
        alert('No shift result to print.');
        return false;
      }
      await fetch(`${API_URL}/daily-closings/print-shift-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shiftData: dataToPrint })
      });
      return true;
    } catch (e) {
      console.error('Shift report print failed:', e);
      alert('Shift report print failed');
      return false;
    }
  };

  // (Query button removed by request)

  const renderDenomItem = (denom: { key: string; label: string; value: number }, isCent: boolean) => {
    const isSelected = focusedDenom === denom.key;
    const count = cashCounts[denom.key as keyof CashCounts];
    const hasValue = count > 0;
    const baseStyle = isSelected
      ? (isCent ? 'border-amber-400 bg-amber-50 shadow-sm ring-2 ring-amber-300' : 'border-green-400 bg-green-50 shadow-sm ring-2 ring-green-300')
      : hasValue
        ? (isCent ? 'border-amber-200 bg-amber-50/50' : 'border-green-200 bg-green-50/50')
        : 'border-gray-200 bg-white';
    return (
      <div key={denom.key} onClick={() => setFocusedDenom(denom.key)}
        className={`flex items-center justify-between px-3 rounded-lg border cursor-pointer transition-all ${baseStyle}`}
        style={{ minHeight: 0 }}>
        <span className={`font-bold text-lg ${isCent ? 'text-amber-700' : 'text-green-700'}`}>{denom.label}</span>
        <div className="flex items-center gap-2">
          <span className={`font-bold text-lg tabular-nums ${hasValue ? (isCent ? 'text-amber-600' : 'text-green-600') : 'text-gray-300'}`}>
            {count}
          </span>
          <span className={`text-xs tabular-nums ${hasValue ? 'text-gray-500' : 'text-gray-300'}`}>
            ={formatCurrency(count * denom.value)}
          </span>
        </div>
      </div>
    );
  };

  // Receipt helpers
  const LINE_WIDTH = 42;
  const receiptLine = (char: string = '=') => char.repeat(LINE_WIDTH);
  const receiptCenter = (text: string) => {
    const pad = Math.max(0, Math.floor((LINE_WIDTH - text.length) / 2));
    return ' '.repeat(pad) + text;
  };
  const receiptLeftRight = (left: string, right: string) => {
    const spaces = Math.max(1, LINE_WIDTH - left.length - right.length);
    return left + ' '.repeat(spaces) + right;
  };

  const closeVoidPinModal = () => {
    setShowVoidPinModal(false);
    setVoidTarget(null);
    setVoidPin('');
  };

  const handleVoidPinKeypad = (key: string) => {
    if (isVoiding) return;
    if (key === 'CLEAR') {
      setVoidPin('');
      return;
    }
    if (key === 'BS') {
      setVoidPin(prev => prev.slice(0, -1));
      return;
    }
    if (/^\d$/.test(key)) {
      setVoidPin(prev => (prev.length >= 4 ? prev : prev + key));
    }
  };

  const handleAccessKeypad = async (key: string) => {
    if (isVerifyingAccess) return;
    if (key === 'CLEAR') {
      setAccessPin('');
      setAccessError('');
      return;
    }
    if (key === 'BS') {
      setAccessPin(prev => prev.slice(0, -1));
      setAccessError('');
      return;
    }
    if (/^\d$/.test(key)) {
      setAccessError('');
      setAccessPin(prev => {
        if (prev.length >= 4) return prev;
        const next = prev + key;
        return next;
      });
    }
  };

  useEffect(() => {
    const verify = async () => {
      if (!isOpen) return;
      if (accessGranted) return;
      if (isVerifyingAccess) return;
      if ((accessPin || '').length !== 4) return;

      setIsVerifyingAccess(true);
      setAccessError('');
      try {
        if (isMasterPosPin(accessPin)) {
          setAccessEmployeeLabel(`Master PIN (${MASTER_POS_PIN}) · Level 5`);
          setClosingAccessEmployeeName('Master PIN');
          setClosingAccessEmployeeId('');
          setAccessGranted(true);
          return;
        }
        const res = await fetch(`${API_URL}/work-schedule/verify-pin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: accessPin })
        });
        const json = await res.json().catch(() => ({} as any));
        if (!res.ok || !json?.employee) {
          setAccessError(json?.error || 'Invalid PIN');
          setAccessPin('');
          return;
        }
        const emp = json.employee;
        const level = roleToLevel(emp?.role);
        if (level < dayCloseMinLevel) {
          setAccessError(`Access denied. Requires Level ${dayCloseMinLevel}+`);
          setAccessPin('');
          return;
        }
        setAccessEmployeeLabel(`${emp?.name || 'Employee'} (Level ${level})`);
        setClosingAccessEmployeeName(String(emp?.name || '').trim());
        setClosingAccessEmployeeId(String(emp?.id ?? '').trim());
        setAccessGranted(true);
      } catch (e) {
        console.error('Day Close access verify failed:', e);
        setAccessError('Failed to verify PIN');
        setAccessPin('');
      } finally {
        setIsVerifyingAccess(false);
      }
    };
    verify();
  }, [accessPin, isOpen, accessGranted, isVerifyingAccess, dayCloseMinLevel]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/50">
      <div className="relative bg-white rounded-2xl shadow-2xl w-[820px] h-[90vh] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Close (X) - top-right */}
        <button
          type="button"
          onClick={onClose}
          disabled={isClosing || isShiftClosing || isVoiding || isPayLoading}
          className="absolute top-3 right-3 z-20 w-12 h-12 border-2 border-red-500 bg-gray-400/30 hover:bg-gray-400/50 rounded-full flex items-center justify-center touch-manipulation transition-colors backdrop-blur-sm disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Close"
          title="Close"
        >
          <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        {/* Header */}
        <div className="bg-slate-800 text-white px-5 py-3 flex-shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">
              {viewMode === 'cash-count' ? '🌙 Day Closing - Cash Count' 
                : viewMode === 'shift-result' ? '🔄 Shift Close - Result'
                : '🌙 Day Closing - Z Report'}
            </h2>
            <span className="text-slate-400 text-sm">
              {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </div>
          {accessEmployeeLabel && (
            <div className="mt-1 text-xs text-slate-300">
              Access: {accessEmployeeLabel} · Required Level {dayCloseMinLevel}+
            </div>
          )}
          {/* Tab Bar */}
          {accessGranted && (
            <div className="flex gap-1 mt-2">
              {([
                { key: 'closing' as ModalTab, label: 'Closing' },
                { key: 'report-dashboard' as ModalTab, label: 'Report Dashboard' },
                { key: 'z-report' as ModalTab, label: 'Z Report' },
                { key: 'item-report' as ModalTab, label: 'Item Report' },
                { key: 'server-sales' as ModalTab, label: 'Server Sales' },
              ]).map(tab => (
                <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                  className={`px-4 py-1.5 rounded-t-lg text-sm font-bold transition-colors ${
                    activeTab === tab.key ? 'bg-white text-slate-800' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}>
                  {tab.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Access Gate Overlay — PAY canvas neumorphic (PrintBillModal 동일 토큰) */}
        {!accessGranted && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black bg-opacity-50">
            <div
              className="flex w-full max-w-xl max-w-[95vw] max-h-[85vh] flex-col overflow-hidden rounded-2xl border-0 p-4"
              style={{ ...PAY_NEO.modalShell, background: PAY_NEO_CANVAS }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
                <div className="min-w-0 pr-2">
                  <h3 className="text-lg font-bold text-gray-800">Day Close Access</h3>
                  <div className="text-xs font-medium text-gray-600 mt-0.5">
                    Requires Level {dayCloseMinLevel}+ (Employee Manager → Reports → Day Close)
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center border-0 touch-manipulation ${NEO_PRESS_INSET_ONLY_NO_SHIFT}`}
                  style={PAY_NEO.raised}
                  aria-label="Close"
                  title="Close"
                >
                  <svg className="h-5 w-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
                <div className="flex justify-center gap-3">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      style={PAY_NEO.inset}
                      className={`flex h-12 w-12 items-center justify-center rounded-[14px] text-2xl ${
                        accessPin.length > i ? 'text-blue-700' : 'text-gray-500'
                      }`}
                    >
                      {accessPin.length > i ? '•' : ''}
                    </div>
                  ))}
                </div>
                {accessError && (
                  <div className="space-y-2 rounded-[14px] p-2.5" style={PAY_NEO.inset}>
                    <div className="text-center text-sm font-semibold text-red-700">{accessError}</div>
                  </div>
                )}
                <div className="space-y-2 rounded-[14px] p-2.5" style={PAY_NEO.inset}>
                  <div className="grid grid-cols-3 gap-2">
                    {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'CLEAR', '0', 'BS'].map((k) => {
                      const isClear = k === 'CLEAR';
                      const isBs = k === 'BS';
                      return (
                        <button
                          key={k}
                          type="button"
                          onClick={() => {
                            void handleAccessKeypad(k);
                          }}
                          disabled={isVerifyingAccess}
                          className={`h-14 rounded-[10px] border-0 font-bold touch-manipulation disabled:cursor-not-allowed disabled:opacity-50 ${
                            isClear || isBs ? NEO_COLOR_BTN_PRESS_NO_SHIFT : CLOSING_PAD_NEO_PRESS
                          } ${isClear ? 'text-sm text-red-700' : isBs ? 'text-xl text-amber-800' : 'text-xl text-gray-800'}`}
                          style={
                            isClear
                              ? { ...OH_ACTION_NEO.red, borderRadius: 10 }
                              : isBs
                                ? { ...OH_ACTION_NEO.orange, borderRadius: 10 }
                                : PAY_KEYPAD_KEY
                          }
                        >
                          {isClear ? 'Clear' : isBs ? '⌫' : k}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex shrink-0 flex-col items-stretch gap-2">
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={isVerifyingAccess}
                    className={`min-w-[110px] rounded-[10px] border-0 px-5 py-3 text-base font-semibold text-gray-900 touch-manipulation disabled:cursor-not-allowed disabled:opacity-50 ${CLOSING_PAD_NEO_PRESS}`}
                    style={PAY_NEO.key}
                  >
                    Cancel
                  </button>
                </div>
                {isVerifyingAccess && (
                  <div className="flex items-center justify-center gap-2 text-sm font-medium text-gray-600">
                    <div className="h-5 w-5 animate-spin rounded-full border-b-2 border-blue-600" />
                    Verifying...
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'report-dashboard' ? (
          /* ========== REPORT DASHBOARD TAB ========== */
          <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" /></div>}>
            <OperationalReportsPanel />
          </Suspense>
        ) : activeTab === 'z-report' ? (
          /* ========== Z REPORT TAB ========== */
          <div className="p-5 flex-1 overflow-y-auto">
            {isZReportHistoryLoading && !zReportHistoryData ? (
              <div className="py-12 text-center">
                <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-gray-500 text-sm mt-2">Loading Z-Report history...</p>
              </div>
            ) : !selectedZReportDate ? (
              <div className="space-y-3">
                <div className="text-sm font-bold text-gray-700 mb-2">Select a date to view Z-Report</div>
                <div className="flex items-center gap-2 mb-4">
                  <input type="date" value={selectedZReportDate}
                    onChange={e => { if (e.target.value) fetchZReportByDate(e.target.value); }}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                {zReportHistoryList.length > 0 ? (
                  <div className="space-y-1">
                    <div className="text-xs text-gray-500 font-bold mb-2">Recent Closings</div>
                    {zReportHistoryList.map((rec, idx) => (
                      <button key={rec.session_id || idx}
                        onClick={() => fetchZReportByDate(rec.date)}
                        className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-blue-300 transition-colors text-left">
                        <div>
                          <div className="font-bold text-sm text-gray-800">{rec.date}</div>
                          <div className="text-xs text-gray-500">
                            {rec.opened_at ? new Date(rec.opened_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : ''} ~{' '}
                            {rec.closed_at ? new Date(rec.closed_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : 'Open'}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-sm text-gray-800">{formatMoney(rec.total_sales || 0)}</div>
                          <div className="text-xs text-gray-500">{rec.order_count || 0} orders</div>
                        </div>
                        <span className={`ml-2 px-2 py-0.5 rounded text-xs font-bold ${
                          rec.status === 'closed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                        }`}>{rec.status === 'closed' ? 'Closed' : 'Open'}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="py-8 text-center text-gray-400">No closing history found</div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between mb-3">
                  <button onClick={() => { setSelectedZReportDate(''); setZReportHistoryData(null); }}
                    className="px-3 py-1.5 rounded-lg bg-gray-200 hover:bg-gray-300 text-sm font-bold text-gray-700">
                    ← Back to List
                  </button>
                  <div className="flex items-center gap-2">
                    <input type="date" value={selectedZReportDate}
                      onChange={e => { if (e.target.value) fetchZReportByDate(e.target.value); }}
                      className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
                    <button onClick={printZReportHistory} disabled={isPrintingZReport || !zReportHistoryData}
                      className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold disabled:bg-gray-300 disabled:cursor-not-allowed">
                      {isPrintingZReport ? 'Printing...' : '🖨 Print'}
                    </button>
                  </div>
                </div>
                {isZReportHistoryLoading ? (
                  <div className="py-8 text-center">
                    <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
                  </div>
                ) : zReportHistoryData ? (
                  <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 font-mono text-xs leading-relaxed whitespace-pre overflow-x-auto">
                    {(() => {
                      const d = zReportHistoryData;
                      const W = 48;
                      const SEP = () => '='.repeat(W);
                      const DOT = () => '-'.repeat(W);
                      const C = (t: string) => { const pad = Math.max(0, Math.floor((W - t.length) / 2)); return ' '.repeat(pad) + t; };
                      const LR = (l: string, r: string) => { const sp = Math.max(1, W - l.length - r.length); return l + ' '.repeat(sp) + r; };
                      const lines: string[] = [];
                      const L = (s: string) => lines.push(s);

                      L(SEP()); L(C('*** Z-REPORT ***')); L(C('DAY CLOSING REPORT')); L(SEP());
                      L(C(d.date || selectedZReportDate));
                      if (d.opened_at) L(C(`Opened: ${new Date(d.opened_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`));
                      if (d.closed_at) L(C(`Closed: ${new Date(d.closed_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`));
                      L(SEP());

                      L(''); L(C('-- SALES SUMMARY --')); L(DOT());
                      const col3 = (l: any, c: any, r: any) => {
                        const Lc = String(l ?? '').slice(0, 20).padEnd(20, ' ');
                        const Cc = String(c ?? '').slice(0, 6);
                        const CpadL = Math.floor((6 - Cc.length) / 2);
                        const CpadR = 6 - Cc.length - CpadL;
                        const Cm = ' '.repeat(Math.max(0, CpadL)) + Cc + ' '.repeat(Math.max(0, CpadR));
                        const Rc = String(r ?? '');
                        const Rm = Rc.length > 22 ? Rc.slice(0, 22) : Rc.padStart(22, ' ');
                        return Lc + Cm + Rm;
                      };
                      const salesSubtotal = Number((Number((d as any).subtotal || 0) + Number((d as any).tax_total || 0)).toFixed(2));
                      const tipsTotal = Number((d as any).tip_total || 0);
                      const totalAll = Number((salesSubtotal + tipsTotal).toFixed(2));
                      L(col3('Total Orders', `${d.order_count || 0}`, ''));
                      L(col3('Subtotal', '', formatMoney((d as any).subtotal || 0)));
                      L(col3('GST', '', formatMoney((d as any).gst_total || 0)));
                      L(col3('PST', '', formatMoney((d as any).pst_total || 0)));
                      L(col3('Tax Total', '', formatMoney((d as any).tax_total || 0)));
                      L(col3('Sales Total', '', formatMoney(salesSubtotal)));
                      L(col3('Tips', `${(d as any).total_tip_order_count || 0}`, formatMoney(tipsTotal)));
                      L(col3('Total', '', formatMoney(totalAll)));
                      if (d.guest_count) L(LR('Guest Count:', `${d.guest_count}`));

                      L(''); L(C('-- SALES BY TYPE --')); L(DOT());
                      L(col3('Dine-In', `${(d as any).dine_in_order_count || 0}`, formatMoney(d.dine_in_sales || 0)));
                      L(col3('Togo', `${(d as any).togo_order_count || 0}`, formatMoney(d.togo_sales || 0)));
                      L(col3('Online', `${(d as any).online_order_count || 0}`, formatMoney(d.online_sales || 0)));
                      L(col3('Delivery', `${(d as any).delivery_order_count || 0}`, formatMoney(d.delivery_sales || 0)));

                      L(''); L(C('-- PAYMENT BREAKDOWN --')); L(DOT());
                      L(col3('Cash', `${(d as any).cash_order_count || 0}`, formatMoney(d.cash_sales || 0)));
                      L(col3('  Cash Tips', `${(d as any).cash_tip_order_count || 0}`, formatMoney((d as any).cash_tips || 0)));
                      L(col3('Card', `${(d as any).card_order_count || 0}`, formatMoney(d.card_sales || 0)));
                      L(col3('  Card Tips', `${(d as any).card_tip_order_count || 0}`, formatMoney((d as any).card_tips || 0)));
                      L(col3('Other', `${(d as any).other_order_count || 0}`, formatMoney(d.other_sales || 0)));

                      L(''); L(C('-- TIPS --')); L(DOT());
                      L(col3('Total Tips', `${(d as any).total_tip_order_count || 0}`, formatMoney((d as any).tip_total || 0)));
                      L(col3('Cash Tips', `${(d as any).cash_tip_order_count || 0}`, formatMoney((d as any).cash_tips || 0)));
                      L(col3('Card Tips', `${(d as any).card_tip_order_count || 0}`, formatMoney((d as any).card_tips || 0)));

                      L(''); L(C('-- ADJUSTMENTS --')); L(DOT());
                      L(col3('Refunds', `${d.refund_count || 0}`, `-${formatMoney(d.refund_total || 0)}`));
                      if ((d as any).refund_details?.length) {
                        for (const r of (d as any).refund_details) {
                          const on = r.order_number || `#${r.order_id}`;
                          L(LR(`  Order ${on}`, `-${formatMoney(r.total)}`));
                          const rb = (r.refunded_by && String(r.refunded_by).trim()) ? String(r.refunded_by).trim() : '';
                          if (rb) L(`    Refund by: ${rb.slice(0, 40)}`);
                        }
                      }
                      L(col3('Voids', `${d.void_count || 0}`, `-${formatMoney(d.void_total || 0)}`));
                      if ((d as any).void_details?.length) {
                        for (const v of (d as any).void_details) {
                          const on = v.order_number || `#${v.order_id}`;
                          L(LR(`  Order ${on}`, `-${formatMoney(v.total)}`));
                          const vb = (v.created_by && String(v.created_by).trim()) ? String(v.created_by).trim() : '';
                          if (vb) L(`    Void by: ${vb.slice(0, 40)}`);
                        }
                      }
                      L(col3('Discounts', `${(d as any).discount_order_count || 0}`, `-${formatMoney(d.discount_total || 0)}`));
                      if ((d as any).discount_details?.length) {
                        for (const x of (d as any).discount_details) {
                          const on = x.order_number || `#${x.order_id}`;
                          const lb = (x.label && String(x.label).trim()) ? String(x.label).trim().slice(0, 18) : String(x.kind || '').slice(0, 18);
                          L(LR(`  ${on} ${lb}`, `-${formatMoney(x.amount_applied)}`));
                          const dbn = (x.applied_by_name && String(x.applied_by_name).trim()) ? String(x.applied_by_name).trim()
                            : (x.applied_by_employee_id && String(x.applied_by_employee_id).trim() ? String(x.applied_by_employee_id).trim() : '');
                          if (dbn) L(`    Discount by: ${dbn.slice(0, 40)}`);
                        }
                      }

                      L(''); L(C('-- CASH DRAWER --')); L(DOT());
                      L(col3('Opening Cash', '', formatMoney(d.opening_cash || 0)));
                      L(col3('Cash Sales', `${(d as any).cash_order_count || 0}`, formatMoney(d.cash_sales || 0)));
                      L(col3('Cash Tips', `${(d as any).cash_tip_order_count || 0}`, formatMoney((d as any).cash_tips || 0)));
                      L(col3('Expected Cash', '', formatMoney(d.expected_cash || 0)));
                      const closingCash = (d as any).closing_cash || 0;
                      if (closingCash > 0) {
                        L(col3('Closing Cash', '', formatMoney(closingCash)));
                        const diff = closingCash - (d.expected_cash || 0);
                        L(col3('OVER/SHORT', '', `${diff >= 0 ? '+' : ''}${formatMoney(diff)}`));
                      }
                      L(SEP());

                      return lines.join('\n');
                    })()}
                  </div>
                ) : (
                  <div className="py-8 text-center text-gray-400">No Z-Report data found for {selectedZReportDate}</div>
                )}
              </div>
            )}
          </div>
        ) : activeTab === 'item-report' ? (
          /* ========== ITEM REPORT TAB ========== */
          <div className="p-5 flex-1 overflow-y-auto">
            {/* Period selector */}
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              {([
                { key: 'today' as ItemReportPeriod, label: 'Today' },
                { key: '7days' as ItemReportPeriod, label: 'Last 7 Days' },
                { key: 'weekly' as ItemReportPeriod, label: 'This Week' },
                { key: 'monthly' as ItemReportPeriod, label: 'This Month' },
                { key: 'custom' as ItemReportPeriod, label: 'Custom' },
              ]).map(p => (
                <button key={p.key} onClick={() => setItemReportPeriod(p.key)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-colors ${
                    itemReportPeriod === p.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                  }`}>
                  {p.label}
                </button>
              ))}
              {itemReportPeriod === 'custom' && (
                <div className="flex items-center gap-1 ml-2">
                  <input type="date" value={itemCustomStartDate} onChange={e => setItemCustomStartDate(e.target.value)}
                    className="border rounded px-2 py-1 text-sm" />
                  <span className="text-gray-400">~</span>
                  <input type="date" value={itemCustomEndDate} onChange={e => setItemCustomEndDate(e.target.value)}
                    className="border rounded px-2 py-1 text-sm" />
                  <button onClick={() => fetchItemReport('custom')}
                    className="px-3 py-1 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700">
                    Search
                  </button>
                </div>
              )}
              {itemReportData && (
                <button onClick={printItemReport} disabled={isPrintingItemReport}
                  className="ml-auto px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold disabled:bg-gray-300 disabled:cursor-not-allowed">
                  {isPrintingItemReport ? 'Printing...' : '🖨 Print'}
                </button>
              )}
            </div>

            {isItemReportLoading ? (
              <div className="py-12 text-center">
                <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-gray-500 text-sm mt-2">Loading report...</p>
              </div>
            ) : itemReportData ? (
              <div className="space-y-4">
                {/* Period */}
                <div className="text-xs text-gray-500 font-medium">
                  {itemReportData.period.startDate} ~ {itemReportData.period.endDate}
                </div>

                {/* Summary */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Total Orders', value: String(itemReportData.summary.totalOrders) },
                    { label: 'Total Sales', value: formatMoney(itemReportData.summary.totalSales) },
                    { label: 'Avg / Order', value: formatMoney(itemReportData.summary.avgPerOrder) },
                  ].map(s => (
                    <div key={s.label} className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-3 border border-slate-200 text-center">
                      <div className="text-xs text-gray-500 font-medium">{s.label}</div>
                      <div className="text-lg font-extrabold text-slate-800 mt-0.5">{s.value}</div>
                    </div>
                  ))}
                </div>

                {/* Category Sales */}
                {itemReportData.categorySales && itemReportData.categorySales.length > 0 && (() => {
                  const totalRev = itemReportData.categorySales!.reduce((a: number, c: any) => a + c.revenue, 0);
                  const totalQty = itemReportData.categorySales!.reduce((a: number, c: any) => a + c.quantity, 0);
                  return (
                    <div className="bg-white rounded-xl border border-gray-200 p-4">
                      <div className="text-sm font-bold text-gray-700 mb-2">Sales by Category <span className="text-xs font-normal text-gray-400">({formatMoney(totalRev)} / {totalQty} qty)</span></div>
                      <table className="w-full text-sm">
                        <thead><tr className="border-b border-gray-200">
                          <th className="text-left py-1.5 text-xs text-gray-500 font-bold">Category</th>
                          <th className="text-right py-1.5 text-xs text-gray-500 font-bold">Revenue</th>
                          <th className="text-right py-1.5 text-xs text-gray-500 font-bold">Qty</th>
                          <th className="text-right py-1.5 text-xs text-gray-500 font-bold">%</th>
                        </tr></thead>
                        <tbody>
                          {itemReportData.categorySales!.map((c: any, i: number) => (
                            <tr key={i} className="border-b border-gray-100">
                              <td className="py-1.5 font-medium text-gray-800">{c.category}</td>
                              <td className="py-1.5 text-right font-bold text-gray-800">{formatMoney(c.revenue)}</td>
                              <td className="py-1.5 text-right text-gray-700">{c.quantity}</td>
                              <td className="py-1.5 text-right text-gray-500">{totalRev > 0 ? ((c.revenue / totalRev) * 100).toFixed(1) : 0}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}

                {/* Item Sales Table */}
                {itemReportData.items.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="text-sm font-bold text-gray-700 mb-1 flex items-center justify-between">
                      <span>
                        Item Sales (Most → Least)
                        <span className="ml-2 text-xs font-normal text-gray-400">
                          {itemReportData.itemTotals.uniqueItems} items, {itemReportData.itemTotals.totalQuantity} qty
                        </span>
                      </span>
                      <span className="text-xs font-normal text-gray-500">
                        Net: {formatMoney(itemReportData.itemTotals.netAmount ?? (itemReportData.itemTotals.totalRevenue - (itemReportData.itemTotals.refundAmount || 0) - (itemReportData.itemTotals.voidAmount || 0)))}
                      </span>
                    </div>
                    <table className="w-full text-sm mt-2">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-1.5 text-xs text-gray-500 font-bold w-8">#</th>
                          <th className="text-left py-1.5 text-xs text-gray-500 font-bold">Item</th>
                          <th className="text-right py-1.5 text-xs text-gray-500 font-bold">Sold</th>
                          <th className="text-right py-1.5 text-xs text-gray-500 font-bold">Refund</th>
                          <th className="text-right py-1.5 text-xs text-gray-500 font-bold">Void</th>
                          <th className="text-right py-1.5 text-xs text-gray-500 font-bold">Net</th>
                        </tr>
                      </thead>
                      <tbody>
                        {itemReportData.items.map((item, idx) => (
                          <tr key={item.name} className={`border-b border-gray-50 ${idx < 3 ? 'bg-yellow-50' : ''}`}>
                            <td className="py-1 text-xs text-gray-400">{item.rank}</td>
                            <td className="py-1 font-medium text-gray-800 truncate max-w-[200px]">{item.name}</td>
                            <td className="py-1 text-right font-bold text-gray-800">
                              {formatMoney(item.soldAmount ?? item.revenue)} / {item.soldQty ?? item.quantity}
                            </td>
                            <td className="py-1 text-right font-bold text-rose-700">
                              {formatMoney(item.refundAmount || 0)} / {(item.refundQty || 0)}
                            </td>
                            <td className="py-1 text-right font-bold text-orange-700">
                              {formatMoney(item.voidAmount || 0)} / {(item.voidQty || 0)}
                            </td>
                            <td className="py-1 text-right font-extrabold text-slate-900">
                              {formatMoney(item.netAmount ?? ((item.soldAmount ?? item.revenue) - (item.refundAmount || 0) - (item.voidAmount || 0)))} / {(item.netQty ?? ((item.soldQty ?? item.quantity) - (item.refundQty || 0) - (item.voidQty || 0)))}
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-gray-300 font-extrabold">
                          <td className="py-2" />
                          <td className="py-2 text-gray-900">TOTAL</td>
                          <td className="py-2 text-right text-gray-900">
                            {formatMoney(itemReportData.itemTotals.totalRevenue)} / {itemReportData.itemTotals.totalQuantity}
                          </td>
                          <td className="py-2 text-right text-rose-800">
                            {formatMoney(itemReportData.itemTotals.refundAmount || 0)} / {(itemReportData.itemTotals.refundQuantity || 0)}
                          </td>
                          <td className="py-2 text-right text-orange-800">
                            {formatMoney(itemReportData.itemTotals.voidAmount || 0)} / {(itemReportData.itemTotals.voidQuantity || 0)}
                          </td>
                          <td className="py-2 text-right text-gray-900">
                            {formatMoney(itemReportData.itemTotals.netAmount ?? (itemReportData.itemTotals.totalRevenue - (itemReportData.itemTotals.refundAmount || 0) - (itemReportData.itemTotals.voidAmount || 0)))} / {(itemReportData.itemTotals.netQuantity ?? (itemReportData.itemTotals.totalQuantity - (itemReportData.itemTotals.refundQuantity || 0) - (itemReportData.itemTotals.voidQuantity || 0)))}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Daily Breakdown */}
                {itemReportData.dailyBreakdown.length > 1 && (
                  <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="text-sm font-bold text-gray-700 mb-3">Daily Breakdown</div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-1.5 text-xs text-gray-500 font-bold">Date</th>
                          <th className="text-right py-1.5 text-xs text-gray-500 font-bold">Orders</th>
                          <th className="text-right py-1.5 text-xs text-gray-500 font-bold">Sales</th>
                        </tr>
                      </thead>
                      <tbody>
                        {itemReportData.dailyBreakdown.map(day => (
                          <tr key={day.date} className="border-b border-gray-100">
                            <td className="py-1.5 font-medium text-gray-800">{day.date}</td>
                            <td className="py-1.5 text-right text-gray-700">{day.orderCount}</td>
                            <td className="py-1.5 text-right font-bold text-gray-800">{formatMoney(day.totalSales)}</td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-gray-300 font-extrabold">
                          <td className="py-2 text-gray-900">TOTAL</td>
                          <td className="py-2 text-right text-gray-900">{itemReportData.dailyBreakdown.reduce((s, d) => s + d.orderCount, 0)}</td>
                          <td className="py-2 text-right text-gray-900">{formatMoney(itemReportData.dailyBreakdown.reduce((s, d) => s + d.totalSales, 0))}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Trend: Most Sold 15 Items */}
                {topTrend && topTrend.items.length > 0 && (() => {
                  const LINE_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#d946ef', '#f97316', '#14b8a6', '#6366f1', '#e11d48', '#a3e635', '#0ea5e9'];
                  const fmtM = (n: number) => `$${(n || 0).toFixed(2)}`;
                  const fmtKM = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : fmtM(n);
                  const chartData = topTrend.periods.map((p: string, pi: number) => {
                    const row: Record<string, any> = { period: p };
                    topTrend.items.forEach((item: any) => { row[item.name] = item.trend[pi]?.revenue || 0; });
                    return row;
                  });
                  return (
                    <div className="bg-white rounded-xl border border-blue-200 p-4">
                      <div className="text-sm font-bold text-blue-800 mb-3">Trend: Most Sold 15 Items (Revenue)</div>
                      <ResponsiveContainer width="100%" height={320}>
                        <LineChart data={chartData} margin={{ left: 5, right: 15, top: 5, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtKM} />
                          <Tooltip formatter={(v: number) => fmtM(v)} />
                          <Legend wrapperStyle={{ fontSize: 10 }} />
                          {topTrend.items.map((item: any, i: number) => (
                            <Line key={item.name} type="monotone" dataKey={item.name} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })()}

                {/* Trend: Least Sold 15 Items */}
                {bottomTrend && bottomTrend.items.length > 0 && (() => {
                  const LINE_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e'];
                  const fmtM = (n: number) => `$${(n || 0).toFixed(2)}`;
                  const fmtKM = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : fmtM(n);
                  const chartData = bottomTrend.periods.map((p: string, pi: number) => {
                    const row: Record<string, any> = { period: p };
                    bottomTrend.items.forEach((item: any) => { row[item.name] = item.trend[pi]?.revenue || 0; });
                    return row;
                  });
                  return (
                    <div className="bg-white rounded-xl border border-red-200 p-4">
                      <div className="text-sm font-bold text-red-800 mb-3">Trend: Least Sold 15 Items (Revenue)</div>
                      <ResponsiveContainer width="100%" height={320}>
                        <LineChart data={chartData} margin={{ left: 5, right: 15, top: 5, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtKM} />
                          <Tooltip formatter={(v: number) => fmtM(v)} />
                          <Legend wrapperStyle={{ fontSize: 10 }} />
                          {bottomTrend.items.map((item: any, i: number) => (
                            <Line key={item.name} type="monotone" dataKey={item.name} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="py-12 text-center text-gray-400">Select a period to view the report</div>
            )}
          </div>
        ) : activeTab === 'server-sales' ? (
          /* ========== SERVER SALES TAB ========== */
          <div className="p-5 flex-1 overflow-y-auto">
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <div className="text-sm font-extrabold text-gray-800">Server Sales</div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-gray-600">Date</span>
                <input
                  type="date"
                  value={serverSalesDate}
                  onChange={(e) => setServerSalesDate(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                <button
                  onClick={fetchServerSales}
                  disabled={isServerSalesLoading}
                  className="px-4 py-2 rounded-lg bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 text-sm font-extrabold disabled:opacity-50"
                >
                  {isServerSalesLoading ? 'Loading...' : 'Refresh'}
                </button>
              </div>
              <button
                onClick={() => {
                  setServerSalesCashCounts({
                    cent1: 0, cent5: 0, cent10: 0, cent25: 0,
                    dollar1: 0, dollar2: 0, dollar5: 0, dollar10: 0, dollar20: 0, dollar50: 0, dollar100: 0
                  });
                  setServerSalesFocusedDenom('dollar1');
                  setShowServerSalesCashCount(true);
                }}
                disabled={!selectedServerSalesId || isPrintingServerSales}
                className="ml-auto px-4 py-2 rounded-lg bg-slate-900 hover:bg-black text-white text-sm font-extrabold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPrintingServerSales ? 'Printing...' : '🖨 Print'}
              </button>
            </div>

            {isServerSalesLoading ? (
              <div className="py-12 text-center">
                <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-gray-500 text-sm mt-2">Loading server sales...</p>
              </div>
            ) : serverSalesRows.length === 0 ? (
              <div className="py-12 text-center text-gray-400">
                No server sales found for {serverSalesDate || 'selected date'}.
              </div>
            ) : (
              <div className="grid grid-cols-12 gap-4">
                <div className="col-span-12 lg:col-span-7">
                  <div className="text-xs text-gray-500 font-bold mb-2">Select Server</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {serverSalesRows
                      .slice()
                      .sort((a, b) => (a.serverName || a.serverId).localeCompare((b.serverName || b.serverId), 'en', { sensitivity: 'base' }))
                      .map((s) => {
                        const selected = String(s.serverId) === String(selectedServerSalesId);
                        const label = (s.serverName || '').trim() ? `${s.serverName}` : `Server ${s.serverId}`;
                        return (
                          <button
                            key={s.serverId}
                            onClick={() => setSelectedServerSalesId(String(s.serverId))}
                            className={`w-full min-h-[64px] rounded-xl px-3 py-3 text-center font-extrabold transition-all ${
                              selected
                                ? 'bg-blue-600 text-white shadow-lg'
                                : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                            }`}
                            title={label}
                          >
                            <div className="text-sm">{label}</div>
                            <div className={`text-[11px] mt-1 ${selected ? 'text-blue-100' : 'text-gray-500'}`}>
                              {s.orderCount} orders
                            </div>
                          </button>
                        );
                      })}
                  </div>
                </div>

                <div className="col-span-12 lg:col-span-5">
                  <div className="text-xs text-gray-500 font-bold mb-2">Selected</div>
                  {selectedServerSales ? (
                    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
                      <div className="text-lg font-extrabold text-gray-900">
                        {(selectedServerSales.serverName || '').trim()
                          ? `${selectedServerSales.serverName} (${selectedServerSales.serverId})`
                          : `Server ${selectedServerSales.serverId}`}
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                          <div className="text-xs text-gray-500 font-bold">Gross Sales</div>
                          <div className="text-lg font-extrabold">{formatMoney(selectedServerSales.grossSales)}</div>
                        </div>
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                          <div className="text-xs text-gray-500 font-bold">Orders</div>
                          <div className="text-lg font-extrabold">{selectedServerSales.orderCount}</div>
                        </div>
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                          <div className="text-xs text-gray-500 font-bold">Tips (Cash)</div>
                          <div className="text-lg font-extrabold">{formatMoney(selectedServerSales.cashTips)}</div>
                        </div>
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                          <div className="text-xs text-gray-500 font-bold">Tips (Card)</div>
                          <div className="text-lg font-extrabold">{formatMoney(selectedServerSales.cardTips)}</div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between border-t pt-3">
                        <div className="text-sm font-extrabold text-gray-800">Total Tips</div>
                        <div className="text-xl font-extrabold text-slate-900">{formatMoney(selectedServerSales.totalTip)}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="py-10 text-center text-gray-400">Select a server.</div>
                  )}
                </div>
              </div>
            )}

            {showServerSalesCashCount && (
              <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50">
                <div className="bg-white rounded-2xl shadow-2xl w-[920px] max-w-[96vw] max-h-[92vh] overflow-hidden flex flex-col">
                  <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
                    <div className="font-extrabold">Server Sales · Cash Counting</div>
                    <button
                      type="button"
                      onClick={() => { if (!isPrintingServerSales) setShowServerSalesCashCount(false); }}
                      className="h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-2xl font-extrabold leading-none flex items-center justify-center"
                      aria-label="Close"
                      title="Close"
                      disabled={isPrintingServerSales}
                    >
                      ×
                    </button>
                  </div>

                  <div className="p-5 flex-1 overflow-y-auto">
                    <div className="grid grid-cols-4 gap-2 mb-4">
                      <div className="bg-blue-50 rounded-xl p-3 text-center border border-blue-200 col-span-2">
                        <div className="text-xs text-blue-700 font-bold">Counted Cash</div>
                        <div className="text-2xl font-extrabold text-blue-900">{formatCurrency(serverSalesCountedCashTotal)}</div>
                      </div>
                      <div className="bg-white rounded-xl p-3 border border-gray-200 col-span-2">
                        <div className="text-xs text-gray-600 font-bold">Selected Server</div>
                        <div className="text-sm font-extrabold text-gray-900 truncate">
                          {selectedServerSales
                            ? ((selectedServerSales.serverName || '').trim()
                              ? `${selectedServerSales.serverName} (${selectedServerSales.serverId})`
                              : `Server ${selectedServerSales.serverId}`)
                            : '—'}
                        </div>
                        <div className="text-[12px] text-gray-600 mt-1">Press OK to include Counted Cash in the printout.</div>
                      </div>
                    </div>

                    <div className="flex gap-4">
                      <div className="flex-1 space-y-3">
                        <div className="bg-amber-50/50 rounded-xl border border-amber-200 p-3">
                          <div className="text-xs font-bold text-amber-700 mb-2">🪙 Coins</div>
                          <div className="grid grid-cols-2 gap-2">
                            {centDenominations.map(d => renderServerSalesDenomItem(d, true))}
                          </div>
                        </div>
                        <div className="bg-green-50/50 rounded-xl border border-green-200 p-3">
                          <div className="text-xs font-bold text-green-700 mb-2">💵 Bills</div>
                          <div className="grid grid-cols-2 gap-2">
                            {dollarDenominations.map(d => renderServerSalesDenomItem(d, false))}
                          </div>
                        </div>
                      </div>
                      <div className="w-[300px]">
                        <div className="grid grid-cols-3 gap-2 h-full">
                          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map(num => (
                            <button
                              key={num}
                              type="button"
                              onClick={() => handleServerSalesNumPad(num)}
                              className={`flex min-h-[68px] items-center justify-center rounded-xl border-0 text-2xl font-bold touch-manipulation ${
                                num === 'C' || num === '⌫' ? NEO_COLOR_BTN_PRESS_NO_SHIFT : CLOSING_PAD_NEO_PRESS
                              }`}
                              style={
                                num === 'C'
                                  ? { ...OH_ACTION_NEO.red, borderRadius: 12 }
                                  : num === '⌫'
                                    ? { ...OH_ACTION_NEO.orange, borderRadius: 12 }
                                    : PAY_KEYPAD_KEY
                              }
                            >
                              {num}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="px-5 py-4 border-t bg-gray-50 flex-shrink-0">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setShowServerSalesCashCount(false)}
                        disabled={isPrintingServerSales}
                        className={`flex-1 touch-manipulation rounded-xl border-0 py-3 font-semibold text-gray-700 hover:brightness-[1.02] disabled:cursor-not-allowed disabled:opacity-50 ${CLOSING_PAD_NEO_PRESS}`}
                        style={PAY_NEO.key}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (isPrintingServerSales) return;
                          await printSelectedServerSales();
                          setShowServerSalesCashCount(false);
                        }}
                        disabled={!selectedServerSalesId || isPrintingServerSales}
                        className={`flex-[2] touch-manipulation rounded-xl border-0 py-3 font-extrabold text-white hover:brightness-[1.02] disabled:cursor-not-allowed disabled:opacity-50 ${
                          !selectedServerSalesId || isPrintingServerSales
                            ? CLOSING_PAD_NEO_PRESS
                            : NEO_COLOR_BTN_PRESS_NO_SHIFT
                        }`}
                        style={
                          !selectedServerSalesId || isPrintingServerSales
                            ? { ...PAY_NEO.inset, color: '#64748b', borderRadius: 12 }
                            : { ...OH_ACTION_NEO.slate, borderRadius: 12, color: '#ffffff' }
                        }
                      >
                        {isPrintingServerSales ? 'Printing...' : 'OK → Print'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : viewMode === 'cash-count' ? (
          /* ========== CASH COUNT VIEW ========== */
          <>
            {/* Status bar — 미결제 건수로 마감 차단하지 않음 */}
            <div className="flex-shrink-0" style={{ height: '40px' }}>
              <div className="h-full px-4 bg-green-500 flex items-center">
                <span className="text-white font-bold text-sm">✓ Ready to close</span>
              </div>
            </div>

            {/* Main Content - 모달에 꽉 차게 */}
            <div className="px-4 py-3 flex-1 flex flex-col min-h-0">
              {isLoading ? (
                <div className="py-8 text-center">
                  <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
                  <p className="text-gray-500 text-sm mt-2">Loading...</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3 flex-1 min-h-0">
                  {/* Cash Summary Row */}
                  <div className="grid grid-cols-4 gap-2 flex-shrink-0">
                    <div className="bg-white rounded-xl px-3 py-2 text-center border border-gray-200 shadow-sm">
                      <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Opening Cash</div>
                      <div className="text-lg font-bold text-gray-700 tabular-nums">{formatCurrency(zReportData?.opening_cash || 0)}</div>
                    </div>
                    <div className="bg-white rounded-xl px-3 py-2 text-center border border-blue-200 shadow-sm">
                      <div className="text-[10px] uppercase tracking-wider text-blue-500 font-semibold">Closing Cash</div>
                      <div className="text-lg font-bold text-blue-700 tabular-nums">{formatCurrency(closingCashTotal)}</div>
                    </div>
                    <div className="bg-white rounded-xl px-3 py-2 text-center border border-gray-200 shadow-sm">
                      <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Expected Cash</div>
                      <div className="text-lg font-bold text-gray-700 tabular-nums">{formatCurrency(expectedCash)}</div>
                    </div>
                    <div className={`rounded-xl px-3 py-2 text-center border shadow-sm ${
                      cashDifference === 0 ? 'bg-green-50 border-green-300' : cashDifference > 0 ? 'bg-blue-50 border-blue-300' : 'bg-red-50 border-red-300'
                    }`}>
                      <div className={`text-[10px] uppercase tracking-wider font-semibold ${cashDifference === 0 ? 'text-green-500' : cashDifference > 0 ? 'text-blue-500' : 'text-red-500'}`}>
                        Difference
                      </div>
                      <div className={`text-lg font-bold tabular-nums ${cashDifference === 0 ? 'text-green-700' : cashDifference > 0 ? 'text-blue-700' : 'text-red-700'}`}>
                        {cashDifference >= 0 ? '+' : ''}{formatCurrency(cashDifference)}
                      </div>
                    </div>
                  </div>

                  {/* Cash Input + Number Pad - 나머지 공간 꽉 채움 */}
                  <div className="flex gap-3 flex-1 min-h-0 items-stretch">
                    {/* Coins + Bills */}
                    <div style={{ flex: '0 0 55%' }} className="flex flex-col gap-2 min-h-0">
                      {/* Coins */}
                      <div className="border border-amber-300 rounded-xl p-2">
                        <div className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-1.5">Coins</div>
                        <div className="grid grid-cols-2 gap-1.5" style={{ gridAutoRows: '52px' }}>
                          {centDenominations.map(d => renderDenomItem(d, true))}
                        </div>
                      </div>
                      {/* Bills */}
                      <div className="border border-green-300 rounded-xl p-2">
                        <div className="text-xs font-bold text-green-600 uppercase tracking-wider mb-1.5">Bills</div>
                        <div className="grid grid-cols-2 gap-1.5" style={{ gridAutoRows: '52px' }}>
                          {dollarDenominations.map(d => renderDenomItem(d, false))}
                        </div>
                      </div>
                    </div>
                    {/* Number Pad */}
                    <div className="flex-1 flex flex-col" style={{ height: '94%' }}>
                      <div className="grid grid-cols-3 gap-2 flex-1">
                        {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map(num => (
                          <button
                            key={num}
                            type="button"
                            onClick={() => handleNumPad(num)}
                            className={`flex items-center justify-center rounded-xl border-0 font-bold text-2xl touch-manipulation ${
                              num === 'C' || num === '⌫' ? NEO_COLOR_BTN_PRESS_NO_SHIFT : CLOSING_PAD_NEO_PRESS
                            }`}
                            style={
                              num === 'C'
                                ? { ...OH_ACTION_NEO.red, borderRadius: 12 }
                                : num === '⌫'
                                  ? { ...OH_ACTION_NEO.orange, borderRadius: 12 }
                                  : PAY_KEYPAD_KEY
                            }
                          >
                            {num}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t border-gray-200 bg-gray-50/80 flex-shrink-0">
              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  className={`w-[120px] touch-manipulation rounded-xl border-0 px-3 py-3 text-sm font-semibold text-gray-700 hover:brightness-[1.02] ${CLOSING_PAD_NEO_PRESS}`}
                  style={PAY_NEO.key}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('closing');
                    setViewMode('cash-count');
                    setShowShiftCloseCashOk(true);
                  }}
                  disabled={isLoading || isShiftClosing}
                  className={`w-[160px] touch-manipulation rounded-xl border-0 px-3 py-3 text-sm font-bold text-white hover:brightness-[1.02] disabled:cursor-not-allowed disabled:opacity-50 ${
                    isLoading || isShiftClosing ? CLOSING_PAD_NEO_PRESS : NEO_COLOR_BTN_PRESS_NO_SHIFT
                  }`}
                  style={
                    isLoading || isShiftClosing
                      ? { ...PAY_NEO.inset, color: '#64748b', borderRadius: 12 }
                      : { ...OH_ACTION_NEO.orange, borderRadius: 12 }
                  }
                >
                  {isShiftClosing ? 'Processing...' : 'Shift Close'}
                </button>
                <button
                  type="button"
                  onClick={handleShowPreview}
                  disabled={isLoading}
                  className={`flex-1 touch-manipulation rounded-xl border-0 px-3 py-3 text-sm font-bold text-white hover:brightness-[1.02] disabled:cursor-not-allowed disabled:opacity-50 ${
                    isLoading ? CLOSING_PAD_NEO_PRESS : NEO_COLOR_BTN_PRESS_NO_SHIFT
                  }`}
                  style={isLoading ? { ...PAY_NEO.inset, color: '#64748b', borderRadius: 12 } : { ...OH_ACTION_NEO.red, borderRadius: 12 }}
                >
                  Day Close &amp; Z-Report →
                </button>
              </div>
            </div>

            {showShiftCloseCashOk && (
              <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50">
                <div className="bg-white rounded-2xl shadow-2xl w-[920px] max-w-[96vw] max-h-[92vh] overflow-hidden flex flex-col">
                  <div className="px-5 py-4 bg-orange-600 text-white flex items-center justify-between">
                    <div className="font-extrabold">Shift Close · Cash Counting</div>
                    <button
                      type="button"
                      onClick={() => { if (!isShiftClosing) setShowShiftCloseCashOk(false); }}
                      className="h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-2xl font-extrabold leading-none flex items-center justify-center"
                      aria-label="Close"
                      title="Close"
                      disabled={isShiftClosing}
                    >
                      ×
                    </button>
                  </div>

                  <div className="p-5 flex-1 overflow-y-auto">
                    <div className="mb-4 rounded-xl border border-orange-200 bg-orange-50/80 px-4 py-3">
                      <div className="text-xs font-bold text-orange-800 mb-1">Shift Close (this device)</div>
                      <div className="text-sm text-gray-800">
                        Closing PIN으로 들어온 직원만 적용됩니다:{' '}
                        <span className="font-extrabold">{closingAccessEmployeeName || '—'}</span>
                      </div>
                      <div className="text-[11px] text-gray-600 mt-1">
                        리포트의 서버 팁 합계는 위 이름과 주문의 Server 이름이 일치할 때 집계됩니다.
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2 mb-4">
                      <div className="bg-blue-50 rounded-xl p-3 text-center border border-blue-200 col-span-2">
                        <div className="text-xs text-blue-700 font-bold">Counted Cash</div>
                        <div className="text-2xl font-extrabold text-blue-900">{formatCurrency(closingCashTotal)}</div>
                      </div>
                      <div className="bg-white rounded-xl p-3 border border-gray-200 col-span-2">
                        <div className="text-xs text-gray-600 font-bold">Cash count</div>
                        <div className="text-[12px] text-gray-700 leading-snug">
                          <span>Enter cash counts the same as closing. Press <span className="font-bold">OK</span> to proceed.</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-4">
                      <div className="flex-1 space-y-3">
                        <div className="bg-amber-50/50 rounded-xl border border-amber-200 p-3">
                          <div className="text-xs font-bold text-amber-700 mb-2">🪙 Coins</div>
                          <div className="grid grid-cols-2 gap-2">
                            {centDenominations.map(d => renderDenomItem(d, true))}
                          </div>
                        </div>
                        <div className="bg-green-50/50 rounded-xl border border-green-200 p-3">
                          <div className="text-xs font-bold text-green-700 mb-2">💵 Bills</div>
                          <div className="grid grid-cols-2 gap-2">
                            {dollarDenominations.map(d => renderDenomItem(d, false))}
                          </div>
                        </div>
                      </div>
                      <div className="w-[300px]">
                        <div className="grid grid-cols-3 gap-2 h-full">
                          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map(num => (
                            <button
                              key={num}
                              type="button"
                              onClick={() => handleNumPad(num)}
                              className={`flex min-h-[68px] items-center justify-center rounded-xl border-0 text-2xl font-bold touch-manipulation ${
                                num === 'C' || num === '⌫' ? NEO_COLOR_BTN_PRESS_NO_SHIFT : CLOSING_PAD_NEO_PRESS
                              }`}
                              style={
                                num === 'C'
                                  ? { ...OH_ACTION_NEO.red, borderRadius: 12 }
                                  : num === '⌫'
                                    ? { ...OH_ACTION_NEO.orange, borderRadius: 12 }
                                    : PAY_KEYPAD_KEY
                              }
                            >
                              {num}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="px-5 py-4 border-t bg-gray-50 flex-shrink-0">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setShowShiftCloseCashOk(false)}
                        disabled={isShiftClosing}
                        className={`flex-1 touch-manipulation rounded-xl border-0 py-3 font-semibold text-gray-700 hover:brightness-[1.02] disabled:cursor-not-allowed disabled:opacity-50 ${CLOSING_PAD_NEO_PRESS}`}
                        style={PAY_NEO.key}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (isShiftClosing) return;
                          setShowShiftCloseCashOk(false);
                          await handleShiftClose();
                        }}
                        disabled={isShiftClosing}
                        className={`flex-[2] touch-manipulation rounded-xl border-0 py-3 font-extrabold text-white hover:brightness-[1.02] disabled:cursor-not-allowed disabled:opacity-50 ${
                          isShiftClosing ? CLOSING_PAD_NEO_PRESS : NEO_COLOR_BTN_PRESS_NO_SHIFT
                        }`}
                        style={
                          isShiftClosing
                            ? { ...PAY_NEO.inset, color: '#64748b', borderRadius: 12 }
                            : { ...OH_ACTION_NEO.orange, borderRadius: 12 }
                        }
                      >
                        {isShiftClosing ? 'Processing...' : 'OK → Shift Close & Print'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>

        ) : viewMode === 'shift-result' ? (
          /* ========== SHIFT RESULT VIEW ========== */
          <>
            <div className="flex-1 overflow-y-auto bg-gray-200 p-6">
              <div className="max-w-[360px] mx-auto bg-white shadow-lg rounded-lg">
                <div className="p-5 space-y-4">
                  {/* Shift Header */}
                  <div className="text-center border-b pb-3">
                    <h3 className="text-lg font-bold text-gray-800">SHIFT CLOSING REPORT</h3>
                    <p className="text-sm text-gray-500">
                      Shift #{shiftResult?.shift_number || 1}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      {shiftResult?.shift_start && new Date(shiftResult.shift_start).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      {' ~ '}
                      {shiftResult?.shift_end && new Date(shiftResult.shift_end).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>

                  {/* Sales */}
                  <div>
                    <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">Sales Summary</h4>
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span>Total Sales</span>
                        <span className="font-bold">{formatCurrency(shiftResult?.total_sales || 0)}</span>
                      </div>
                      <div className="flex justify-between text-sm text-gray-600">
                        <span>Orders</span>
                        <span>{shiftResult?.order_count || 0}</span>
                      </div>
                      {(shiftResult?.gratuity_total || 0) > 0 && (
                        <div className="flex justify-between text-sm text-amber-700 font-medium">
                          <span>Gratuity</span>
                          <span>{formatCurrency(shiftResult?.gratuity_total || 0)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Payments */}
                  <div>
                    <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">Payments</h4>
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span>Cash</span><span className="font-bold">{formatCurrency(shiftResult?.cash_sales || 0)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Card</span><span className="font-bold">{formatCurrency(shiftResult?.card_sales || 0)}</span>
                      </div>
                      {(shiftResult?.other_sales || 0) > 0 && (
                        <div className="flex justify-between text-sm">
                          <span>Other</span><span className="font-bold">{formatCurrency(shiftResult?.other_sales || 0)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Tips */}
                  <div>
                    <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">Tips</h4>
                    <div className="flex justify-between text-sm">
                      <span>Total Tips</span>
                      <span className="font-bold">{formatCurrency(shiftResult?.tip_total || 0)}</span>
                    </div>
                  </div>

                  {/* Cash Drawer */}
                  <div className="bg-slate-50 rounded-lg p-3 border">
                    <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">Cash Drawer</h4>
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span>Opening Cash</span><span>{formatCurrency(shiftResult?.opening_cash || 0)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Cash Sales</span><span>{formatCurrency(shiftResult?.cash_sales || 0)}</span>
                      </div>
                      <div className="flex justify-between text-sm font-medium border-t pt-1">
                        <span>Expected Cash</span><span>{formatCurrency(shiftResult?.expected_cash || 0)}</span>
                      </div>
                      {/* Cash Count Breakdown */}
                      {(() => {
                        const cd = typeof shiftResult?.cash_details === 'string'
                          ? (() => { try { return JSON.parse(shiftResult.cash_details); } catch { return {}; } })()
                          : (shiftResult?.cash_details || {});
                        const denoms = [
                          { key: 'cent1', label: '1¢', value: 0.01 },
                          { key: 'cent5', label: '5¢', value: 0.05 },
                          { key: 'cent10', label: '10¢', value: 0.10 },
                          { key: 'cent25', label: '25¢', value: 0.25 },
                          { key: 'dollar1', label: '$1', value: 1 },
                          { key: 'dollar2', label: '$2', value: 2 },
                          { key: 'dollar5', label: '$5', value: 5 },
                          { key: 'dollar10', label: '$10', value: 10 },
                          { key: 'dollar20', label: '$20', value: 20 },
                          { key: 'dollar50', label: '$50', value: 50 },
                          { key: 'dollar100', label: '$100', value: 100 },
                        ];
                        const hasAny = denoms.some(d => (cd[d.key] || 0) > 0);
                        if (!hasAny) return null;
                        return (
                          <div className="border-t pt-1 mt-1">
                            <div className="text-xs font-bold text-gray-500 uppercase mb-1">Cash Count Breakdown</div>
                            {denoms.map(d => {
                              const count = cd[d.key] || 0;
                              if (count === 0) return null;
                              return (
                                <div key={d.key} className="flex justify-between text-xs text-gray-600">
                                  <span>{d.label} x {count}</span>
                                  <span>{formatCurrency(count * d.value)}</span>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                      <div className="flex justify-between text-sm font-medium">
                        <span>Counted Cash</span><span>{formatCurrency(shiftResult?.counted_cash || 0)}</span>
                      </div>
                      <div className={`flex justify-between text-sm font-bold border-t pt-1 ${
                        (shiftResult?.cash_difference || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        <span>OVER/SHORT</span>
                        <span>{(shiftResult?.cash_difference || 0) >= 0 ? '+' : ''}{formatCurrency(shiftResult?.cash_difference || 0)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t bg-gray-50 flex-shrink-0">
              <div className="flex gap-3">
                <button onClick={() => { setViewMode('cash-count'); setShiftResult(null); setCashCounts({
                  cent1: 0, cent5: 0, cent10: 0, cent25: 0,
                  dollar1: 0, dollar2: 0, dollar5: 0, dollar10: 0, dollar20: 0, dollar50: 0, dollar100: 0
                }); }}
                  className="flex-1 px-4 py-3 bg-gray-200 hover:bg-gray-300 rounded-xl font-semibold text-gray-700">
                  ← Back to Cash Count
                </button>
                <button onClick={onClose}
                  className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 rounded-xl font-bold text-white">
                  Done
                </button>
              </div>
            </div>
          </>

        ) : (
          /* ========== PRINT PREVIEW VIEW ========== */
          <>
            <div className="px-5 py-3 border-b bg-gray-100 flex-shrink-0">
              <div className="flex gap-3">
                <button onClick={() => setViewMode('cash-count')}
                  className="flex-1 px-4 py-3 bg-gray-300 hover:bg-gray-400 rounded-xl font-semibold text-gray-700">
                  ← Back
                </button>
                <button onClick={() => setShowCopiesModal(true)} disabled={isClosing}
                  className="flex-[2] px-4 py-3 bg-slate-800 hover:bg-slate-900 disabled:bg-gray-400 rounded-xl font-bold text-white">
                  {isClosing ? 'Processing...' : '🖨️ Print & Close Day'}
                </button>
              </div>
            </div>

            {showCopiesModal && (
              <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
                <div className="bg-white rounded-2xl shadow-2xl p-6 w-[340px]">
                  <h3 className="text-lg font-bold text-center mb-4">Print Copies</h3>
                  <div className="grid grid-cols-5 gap-2 mb-4">
                    {[1, 2, 3, 4, 5].map(n => (
                      <button key={n} onClick={() => setClosingCopies(n)}
                        className={`py-3 rounded-xl text-lg font-bold transition-all ${closingCopies === n ? 'bg-slate-800 text-white scale-105' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>
                        {n}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { setShowCopiesModal(false); setClosingCopies(1); }}
                      className="flex-1 py-3 bg-gray-300 hover:bg-gray-400 rounded-xl font-semibold text-gray-700">
                      Cancel
                    </button>
                    <button onClick={() => { setShowCopiesModal(false); handlePrintAndClose(); }}
                      disabled={isClosing}
                      className="flex-[2] py-3 bg-slate-800 hover:bg-slate-900 disabled:bg-gray-400 rounded-xl font-bold text-white">
                      Print {closingCopies} {closingCopies > 1 ? 'Copies' : 'Copy'} & Close
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto bg-gray-200 p-6">
              <div className="max-w-[320px] mx-auto bg-white shadow-lg">
                <pre className="font-mono text-xs leading-relaxed p-4 whitespace-pre-wrap text-black">
{(() => {
  const d = zReportData;
  const isQSR = d?.service_mode === 'QSR';
  const lines: string[] = [];
  const L = (s: string) => lines.push(s);
  const LR = receiptLeftRight;
  const C = receiptCenter;
  const SEP = () => L(receiptLine('-'));
  const SEP2 = () => L(receiptLine('='));

  // Header
  SEP2();
  L(C('*** Z-REPORT ***'));
  L(C('SALE-SUMMARY REPORT'));
  SEP2();
  L(C(d?.store_name || 'Restaurant'));
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  L(C(dateStr));
  L(C(`Printed: ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`));

  // Session time range
  if (d?.opened_at) {
    const fmt = (ts: string) => { try { return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
    L(C(`Session: ${fmt(d.opened_at)} ~ ${d.closed_at ? fmt(d.closed_at) : 'Now'}`));
  }
  if (d?.first_order_time) {
    const fmt = (ts: string) => { try { return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
    L(C(`First: ${fmt(d.first_order_time)}  Last: ${fmt(d.last_order_time || d.first_order_time)}`));
  }
  SEP2();
  L('');

  // SALES SUMMARY
  L(C('-- SALES SUMMARY --'));
  SEP();
  L(LR('Total Orders:', `${d?.order_count || 0}`));
  if (!isQSR && (d?.guest_count || 0) > 0) {
    L(LR('Total Guests:', `${d?.guest_count || 0}`));
    const avgGuests = (d?.order_count || 0) > 0 ? ((d?.guest_count || 0) / (d?.order_count || 0)).toFixed(1) : '0';
    L(LR('Avg Guests/Order:', avgGuests));
  }
  L('');
  const grossSales = (d?.subtotal || d?.total_sales || 0);
  L(LR('Gross Sales:', formatMoney(grossSales)));
  L(LR('Discounts:', `-${formatMoney(d?.discount_total || 0)}`));
  const netSales = grossSales - (d?.discount_total || 0);
  L(LR('Net Sales:', formatMoney(netSales)));
  if ((d as any)?.gst_total != null) L(LR('GST:', formatMoney((d as any).gst_total || 0)));
  if ((d as any)?.pst_total != null) L(LR('PST:', formatMoney((d as any).pst_total || 0)));
  L(LR('Tax:', formatMoney(d?.tax_total || 0)));
  if (!isQSR && (d?.gratuity_total || 0) > 0) {
    L(LR('Gratuity:', formatMoney(d?.gratuity_total || 0)));
  }
  const tipTotal = d?.tip_total || 0;
  L(LR('Tips:', formatMoney(tipTotal)));
  const total = netSales + (d?.tax_total || 0) + (isQSR ? 0 : (d?.gratuity_total || 0)) + tipTotal;
  L(LR('TOTAL:', formatMoney(total)));
  L('');

  // DESTINATIONS
  L(C('-- DESTINATIONS --'));
  SEP();
  const dineLabel = isQSR ? 'For Here:' : 'Dine-In:';
  const togoLabel = isQSR ? 'Pickup:' : 'Togo:';
  L(LR(dineLabel, formatMoney(d?.dine_in_sales || 0)));
  L(LR(togoLabel, formatMoney(d?.togo_sales || 0)));
  L(LR('Online:', formatMoney(d?.online_sales || 0)));
  L(LR('Delivery:', formatMoney(d?.delivery_sales || 0)));
  L('');

  // PAYMENTS
  L(C('-- PAYMENTS --'));
  SEP();
  const pmList = d?.payment_methods || [];
  if (pmList.length > 0) {
    for (const pm of pmList) {
      const label = pm.method === 'MC' ? 'MasterCard'
        : pm.method === 'OTHER_CARD' ? 'Other Card'
        : pm.method.charAt(0).toUpperCase() + pm.method.slice(1).toLowerCase();
      L(LR(`${label} (${pm.count}):`, formatMoney(pm.net)));
      if ((pm.tip || 0) > 0) L(LR(`  ${label} Tips:`, formatMoney(pm.tip)));
    }
  } else {
    L(LR('(none):', '$0.00'));
  }
  SEP();
  const pmTotal = pmList.reduce((sum: number, pm: PaymentMethodEntry) => sum + pm.net, 0);
  L(LR('TOTAL:', formatMoney(pmTotal)));
  L('');

  // TIPS
  L(C('-- TIPS --'));
  SEP();
  L(LR('Total Tips:', formatMoney(d?.tip_total || 0)));
  L(LR('  Cash Tips:', formatMoney(d?.cash_tips || 0)));
  L(LR('  Card Tips:', formatMoney(d?.card_tips || 0)));
  L('');

  // GIFT CARD
  const hasGiftCard = (d?.gift_card_sold || 0) > 0 || (d?.gift_card_payment || 0) > 0;
  if (hasGiftCard) {
    L(C('-- GIFT CARD --'));
    SEP();
    if ((d?.gift_card_sold || 0) > 0) L(LR(`Gift Card Sold (${d?.gift_card_sold_count || 0}):`, formatMoney(d?.gift_card_sold || 0)));
    if ((d?.gift_card_payment || 0) > 0) L(LR(`Gift Card Payment (${d?.gift_card_payment_count || 0}):`, formatMoney(d?.gift_card_payment || 0)));
    L('');
  }

  // RESERVATION FEE
  const hasReservation = !isQSR && ((d?.reservation_fee_received || 0) > 0 || (d?.reservation_fee_applied || 0) > 0 || (d?.no_show_forfeited || 0) > 0);
  if (hasReservation) {
    L(C('-- RESERVATION FEE --'));
    SEP();
    if ((d?.reservation_fee_received || 0) > 0) L(LR(`Fee Received (${d?.reservation_fee_received_count || 0}):`, formatMoney(d?.reservation_fee_received || 0)));
    if ((d?.reservation_fee_applied || 0) > 0) L(LR(`Fee Applied (${d?.reservation_fee_applied_count || 0}):`, formatMoney(d?.reservation_fee_applied || 0)));
    if ((d?.no_show_forfeited || 0) > 0) L(LR(`No-Show Forfeited (${d?.no_show_forfeited_count || 0}):`, formatMoney(d?.no_show_forfeited || 0)));
    L('');
  }

  // ADJUSTMENTS
  L(C('-- ADJUSTMENTS --'));
  SEP();
  L(LR(`Refunds (${d?.refund_count || 0}):`, `-${formatMoney(d?.refund_total || 0)}`));
  if (d?.refund_details && d.refund_details.length > 0) {
    for (const r of d.refund_details) {
      L(`  Order ${r.order_number || `#${r.order_id}`}${r.reason ? ` (${r.reason})` : ''}`);
      L(LR(`    ${r.type || 'FULL'} / ${r.payment_method || 'N/A'}`, `-${formatMoney(r.total)}`));
      const rb = (r.refunded_by && String(r.refunded_by).trim()) ? String(r.refunded_by).trim() : '';
      if (rb) L(`    Refund by: ${rb.slice(0, 44)}`);
    }
  }
  L(LR(`Voids (${d?.void_count || 0}):`, `-${formatMoney(d?.void_total || 0)}`));
  if (d?.void_details && d.void_details.length > 0) {
    for (const v of d.void_details) {
      L(`  Order ${v.order_number || `#${v.order_id}`} [${v.source === 'entire' ? 'Entire' : 'Partial'}]${v.reason ? ` (${v.reason})` : ''}`);
      L(LR(`    Amount`, `-${formatMoney(v.total)}`));
      const vb = (v.created_by && String(v.created_by).trim()) ? String(v.created_by).trim() : '';
      if (vb) L(`    Void by: ${vb.slice(0, 44)}`);
    }
  }
  L(LR(`Discounts (${d?.discount_order_count || 0}):`, `-${formatMoney(d?.discount_total || 0)}`));
  if (d?.discount_details && d.discount_details.length > 0) {
    for (const x of d.discount_details) {
      const on = x.order_number || `#${x.order_id}`;
      const lb = (x.label && String(x.label).trim()) ? String(x.label).trim().slice(0, 24) : String(x.kind || '').slice(0, 24);
      L(LR(`  ${on} ${lb}`, `-${formatMoney(x.amount_applied)}`));
      const dbn = (x.applied_by_name && String(x.applied_by_name).trim()) ? String(x.applied_by_name).trim()
        : (x.applied_by_employee_id && String(x.applied_by_employee_id).trim() ? String(x.applied_by_employee_id).trim() : '');
      if (dbn) L(`    Discount by: ${dbn.slice(0, 44)}`);
    }
  }
  L('');

  // CASH DRAWER
  L(C('-- CASH DRAWER --'));
  SEP();
  const expectedCash = Number(d?.expected_cash || 0);
  L(LR('Opening Cash:', formatMoney(d?.opening_cash || 0)));
  L(LR('Cash Sales:', formatMoney(d?.cash_sales || 0)));
  L(LR('Cash Tips:', formatMoney(d?.cash_tips || 0)));
  if ((d?.cash_refund_total || 0) > 0) L(LR('Cash Refunds:', `-${formatMoney(d?.cash_refund_total || 0)}`));
  L(LR('Expected Cash:', formatMoney(expectedCash)));
  SEP();
  L(C('CASH COUNT BREAKDOWN'));
  if (cashCounts.cent1 > 0) L(LR(`1 Cent x ${cashCounts.cent1}`, formatMoney(cashCounts.cent1 * 0.01)));
  if (cashCounts.cent5 > 0) L(LR(`5 Cents x ${cashCounts.cent5}`, formatMoney(cashCounts.cent5 * 0.05)));
  if (cashCounts.cent10 > 0) L(LR(`10 Cents x ${cashCounts.cent10}`, formatMoney(cashCounts.cent10 * 0.10)));
  if (cashCounts.cent25 > 0) L(LR(`25 Cents x ${cashCounts.cent25}`, formatMoney(cashCounts.cent25 * 0.25)));
  if (cashCounts.dollar1 > 0) L(LR(`$1 Bills x ${cashCounts.dollar1}`, formatMoney(cashCounts.dollar1 * 1)));
  if (cashCounts.dollar2 > 0) L(LR(`$2 Bills x ${cashCounts.dollar2}`, formatMoney(cashCounts.dollar2 * 2)));
  if (cashCounts.dollar5 > 0) L(LR(`$5 Bills x ${cashCounts.dollar5}`, formatMoney(cashCounts.dollar5 * 5)));
  if (cashCounts.dollar10 > 0) L(LR(`$10 Bills x ${cashCounts.dollar10}`, formatMoney(cashCounts.dollar10 * 10)));
  if (cashCounts.dollar20 > 0) L(LR(`$20 Bills x ${cashCounts.dollar20}`, formatMoney(cashCounts.dollar20 * 20)));
  if (cashCounts.dollar50 > 0) L(LR(`$50 Bills x ${cashCounts.dollar50}`, formatMoney(cashCounts.dollar50 * 50)));
  if (cashCounts.dollar100 > 0) L(LR(`$100 Bills x ${cashCounts.dollar100}`, formatMoney(cashCounts.dollar100 * 100)));
  SEP();
  L(LR('Closing Cash:', formatMoney(closingCashTotal)));
  L(LR('OVER/SHORT:', `${cashDifference >= 0 ? '+' : ''}${formatMoney(cashDifference)}`));
  SEP2();
  L('');

  return lines.join('\n');
})()}
                </pre>
              </div>
            </div>
          </>
        )}

        {/* Closing Pay now uses the SAME Dine-in payment modal via /sales/order (openPayment) */}

        {/* Void PIN Modal */}
        {showVoidPinModal && voidTarget && (
          <div className="fixed inset-0 z-[100000] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={() => { if (!isVoiding) closeVoidPinModal(); }} />
            <div className="relative w-[420px] max-w-[92vw] bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 bg-red-600 text-white flex items-center justify-between">
                <div>
                  <div className="text-lg font-extrabold">Void Unpaid Order</div>
                  <div className="text-xs opacity-90">
                    Order #{voidTarget.orderId} · {formatMoney(Number(voidTarget.total || 0))}
                  </div>
                </div>
                <button
                  className="px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-sm font-bold"
                  onClick={() => { if (!isVoiding) closeVoidPinModal(); }}
                >
                  Close
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <div className="text-sm font-bold text-gray-800 mb-1">Manager PIN (required)</div>
                  <input
                    type="password"
                    value={voidPin}
                    onChange={(e) => setVoidPin(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-red-300"
                    placeholder="Enter manager PIN"
                    disabled={isVoiding}
                    autoFocus
                    inputMode="numeric"
                  />
                </div>
                {/* Phone keypad order number pad (1-2-3 / 4-5-6 / 7-8-9 / Clear-0-⌫) */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    '1','2','3',
                    '4','5','6',
                    '7','8','9',
                    'CLEAR','0','BS'
                  ].map((k) => {
                    const isClear = k === 'CLEAR';
                    const isBs = k === 'BS';
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => handleVoidPinKeypad(k)}
                        disabled={isVoiding}
                        className={`h-14 touch-manipulation rounded-xl border-0 text-xl font-bold disabled:cursor-not-allowed disabled:opacity-50 ${
                          isClear || isBs ? NEO_COLOR_BTN_PRESS_NO_SHIFT : CLOSING_PAD_NEO_PRESS
                        } ${isClear ? 'text-red-700' : isBs ? 'text-yellow-800' : 'text-gray-800'}`}
                        style={
                          isClear
                            ? { ...OH_ACTION_NEO.red, borderRadius: 12 }
                            : isBs
                              ? { ...OH_ACTION_NEO.orange, borderRadius: 12 }
                              : PAY_KEYPAD_KEY
                        }
                      >
                        {isClear ? 'Clear' : isBs ? '⌫' : k}
                      </button>
                    );
                  })}
                </div>
                <div>
                  <div className="text-sm font-bold text-gray-800 mb-1">Reason</div>
                  <input
                    type="text"
                    value={voidReason}
                    onChange={(e) => setVoidReason(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-red-300"
                    placeholder="Reason"
                    disabled={isVoiding}
                  />
                </div>
                <div className="text-xs text-gray-600">
                  This will void the entire order and mark it as <b>VOIDED</b>. Only use this for unpaid cancelled/test orders.
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { if (!isVoiding) closeVoidPinModal(); }}
                    className={`flex-1 touch-manipulation rounded-xl border-0 px-4 py-2 font-bold text-gray-700 hover:brightness-[1.02] disabled:cursor-not-allowed disabled:opacity-50 ${CLOSING_PAD_NEO_PRESS}`}
                    style={PAY_NEO.key}
                    disabled={isVoiding}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmVoid}
                    className={`flex-1 touch-manipulation rounded-xl border-0 px-4 py-2 font-extrabold text-white hover:brightness-[1.02] disabled:cursor-not-allowed disabled:opacity-50 ${
                      isVoiding ? CLOSING_PAD_NEO_PRESS : NEO_COLOR_BTN_PRESS_NO_SHIFT
                    }`}
                    style={
                      isVoiding
                        ? { ...PAY_NEO.inset, color: '#64748b', borderRadius: 12 }
                        : { ...OH_ACTION_NEO.red, borderRadius: 12 }
                    }
                    disabled={isVoiding}
                  >
                    {isVoiding ? 'Voiding...' : 'Void Order'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DayClosingModal;
