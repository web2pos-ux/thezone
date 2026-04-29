import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense, lazy } from 'react';
import { API_URL } from '../config/constants';
import { shouldShowInPickupList } from '../utils/pickupListRules';
import { formatNameForDisplay } from '../utils/nameParser';
import OrderDetailModal, { OrderData } from './OrderDetailModal';
import { PAY_NEO, PAY_NEO_CANVAS, PAY_NEO_PRIMARY_BLUE, OH_ACTION_NEO, NEO_MODAL_BTN_PRESS, NEO_PREP_TIME_BTN_PRESS } from '../utils/softNeumorphic';

const VirtualKeyboard = lazy(() => import('./order/VirtualKeyboard'));

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

export interface PickupOrderConfirmData {
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerZip: string;
  note: string;
  fulfillmentMode: 'togo' | 'delivery' | 'online';
  readyTimeLabel: string;
  pickupMinutes: number;
  /** Online modal: Order Number field (Kitchen Ticket quoted id; empty if not online) */
  onlineOrderNumber?: string;
  /** Online prepaid: customer already paid online — skip payment modal, save as PAID with CREDIT CARD */
  isPrepaid?: boolean;
}

interface PickupOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: PickupOrderConfirmData) => void;
  onPayment?: (order: any, orderType: string) => void;
  onPickupComplete?: (order: any) => Promise<void>;
  selectedServer?: { id?: number | null; name?: string } | null;
  initialMode?: 'togo' | 'delivery' | 'online';
  initialTab?: 'pickup' | 'complete';
  /** Prefill when opening from Order screen (Take Info) */
  prefillSnapshot?: {
    customerPhone?: string;
    customerName?: string;
    pickupMinutes?: number;
    customerAddress?: string;
    customerZip?: string;
    note?: string;
    onlineOrderNumber?: string;
  } | null;
  /** Hide Online "Payment Complete" when used only to edit customer/prep info */
  hideOnlinePaymentComplete?: boolean;
}

const PickupOrderModal: React.FC<PickupOrderModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  onPayment,
  onPickupComplete,
  selectedServer,
  initialMode,
  initialTab,
  prefillSnapshot,
  hideOnlinePaymentComplete,
}) => {
  const [activeTab, setActiveTab] = useState<'pickup' | 'complete'>(initialTab || 'pickup');
  const [pickupTime, setPickupTime] = useState(15);
  const [customerNameInput, setCustomerNameInput] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const customerPhoneRef = useRef('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerZip, setCustomerZip] = useState('');
  const [orderMode, setOrderMode] = useState<'togo' | 'delivery' | 'online'>(initialMode || 'togo');
  const [prepButtonsLocked, setPrepButtonsLocked] = useState(false);
  const [togoNote, setTogoNote] = useState('');
  const [pickupAmPm, setPickupAmPm] = useState<'AM' | 'PM'>(() => getCurrentAmPm());
  const [pickupDateLabel, setPickupDateLabel] = useState(() => formatPickupDateLabel());
  const [keyboardTarget, setKeyboardTarget] = useState<'phone' | 'name' | 'address' | 'note' | 'zip'>('phone');

  const [customerHistoryOrders, setCustomerHistoryOrders] = useState<any[]>([]);
  const [customerHistoryLoading, setCustomerHistoryLoading] = useState(false);
  const [customerHistoryError, setCustomerHistoryError] = useState('');
  const [selectedCustomerHistory, setSelectedCustomerHistory] = useState<any | null>(null);
  const [selectedHistoryOrderId, setSelectedHistoryOrderId] = useState<number | null>(null);
  const [historyOrderDetail, setHistoryOrderDetail] = useState<any | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyDetailsMap, setHistoryDetailsMap] = useState<Record<number, any>>({});

  const historyFetchIdRef = useRef(0);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const addressInputRef = useRef<HTMLTextAreaElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const noteInputRef = useRef<HTMLTextAreaElement>(null);

  const [pickupCompleteOrders, setPickupCompleteOrders] = useState<OrderData[]>([]);
  const [pickupCompleteLoading, setPickupCompleteLoading] = useState(false);
  const [pickupCompleteError, setPickupCompleteError] = useState('');

  // --- Helpers ---
  const normalizePhoneDigits = (value: string) => (value || '').replace(/\D/g, '');
  const getTogoPhoneDigits = (input: string) => normalizePhoneDigits(input).slice(0, 11);

  const formatTogoPhone = (input: string) => {
    const digits = getTogoPhoneDigits(input);
    if (!digits) return '';
    if (digits.length <= 3) return digits;
    const area = digits.slice(0, 3);
    const rest = digits.slice(3);
    let formatted = `(${area}) `;
    if (!rest) return formatted.trim();
    if (rest.length <= 3) return `${formatted}${rest}`;
    const mid = rest.slice(0, 3);
    const last = rest.slice(3);
    return `${formatted}${mid}-${last}`;
  };

  const formatNameWithTrailingSpace = (value: string) => {
    if (value == null) return '';
    const raw = String(value);
    const hasTrailingSpace = /\s$/.test(raw);
    const formatted = formatNameForDisplay(raw);
    if (!formatted && hasTrailingSpace) return ' ';
    return hasTrailingSpace && formatted ? `${formatted} ` : formatted;
  };

  const normalizeOrderId = (value: any): number | null => {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  const formatOrderHistoryDate = (order: any) => {
    const source = order?.createdAt || order?.created_at || order?.order_date || order?.order_time || order?.time;
    if (!source) return '—';
    const date = new Date(source);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: '2-digit' });
  };

  const getOrderTotalValue = (order: any) => {
    const raw = order?.total ?? order?.total_amount ?? order?.order_total ?? order?.amount ?? order?.orderTotal ?? 0;
    const num = Number(raw);
    if (!Number.isFinite(num)) return 0;
    return num;
  };

  const formatCurrency = (value?: number | string | null) => {
    const num = Number(value || 0);
    return `$${num.toFixed(2)}`;
  };

  const sanitizeDisplayName = (value?: string | null) => {
    const formatted = formatNameForDisplay(value || '');
    if (!formatted) return '';
    return formatted.trim().toLowerCase() === 'unknown' ? '' : formatted;
  };

  const pickupFieldRing = (field: 'phone' | 'name' | 'address' | 'note' | 'zip') =>
    keyboardTarget === field ? 'ring-2 ring-emerald-400/70 ring-offset-2 ring-offset-[#e0e5ec]' : '';

  const displayedHistoryOrders = useMemo(() => {
    return [...customerHistoryOrders].slice(0, 6);
  }, [customerHistoryOrders]);

  const parseJsonSafe = (value: any, fallback: any = null) => {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return fallback; }
  };

  // --- Data fetching ---
  const getOrderTimestamp = useCallback((order: any): number => {
    const source = order?.createdAt || order?.created_at || order?.order_date || order?.order_time || order?.time;
    if (!source) return 0;
    const date = new Date(source);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }, []);

  const fetchCustomerHistoryForSelection = useCallback(async (selection: any | null) => {
    const fetchId = ++historyFetchIdRef.current;
    if (!isOpen || !selection) {
      setCustomerHistoryOrders([]);
      setCustomerHistoryError('');
      setCustomerHistoryLoading(false);
      setSelectedHistoryOrderId(null);
      setHistoryOrderDetail(null);
      return;
    }
    const digits = (selection.phoneRaw || selection.phone || '').replace(/\D/g, '').slice(0, 11);
    const nameTerm = formatNameForDisplay(selection.name || '').trim();
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
      if (digits.length >= 2) { params.set('customerPhone', digits); } else { params.set('customerName', nameTerm); }
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
      if (historyFetchIdRef.current === fetchId) setCustomerHistoryLoading(false);
    }
  }, [getOrderTimestamp, isOpen]);

  const loadPickupCompleteOrders = useCallback(async () => {
    setPickupCompleteLoading(true);
    setPickupCompleteError('');
    try {
      const res = await fetch(`${API_URL}/orders?pickup_pending=1&session_scope=1`);
      const data = await res.json();
      const raw: any[] = Array.isArray(data) ? data : Array.isArray(data?.orders) ? data.orders : Array.isArray(data?.data) ? data.data : [];
      const filtered = raw.filter((o: any) => shouldShowInPickupList(o));
      const mapped = filtered.map((o: any) => ({
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
      }));
      mapped.sort((a: any, b: any) => {
        const now = Date.now();
        const parseTime = (t: string): number => { if (!t) return now + 999999999; const d = new Date(t); return isNaN(d.getTime()) ? now + 999999999 : d.getTime(); };
        return parseTime(a.readyTime || a.createdAt) - parseTime(b.readyTime || b.createdAt);
      });
      setPickupCompleteOrders(mapped as OrderData[]);
    } catch (e) {
      console.error('[PickupModal] Failed to load pickup complete orders:', e);
      setPickupCompleteError('Failed to load pickup complete orders.');
      setPickupCompleteOrders([]);
    } finally {
      setPickupCompleteLoading(false);
    }
  }, []);

  useEffect(() => {
    const onDayClosed = () => {
      setPickupCompleteOrders([]);
      setPickupCompleteError('');
    };
    const onDayOpened = () => {
      if (isOpen && activeTab === 'complete') void loadPickupCompleteOrders();
    };
    window.addEventListener('posTakeoutDayClosed', onDayClosed);
    window.addEventListener('posTakeoutDayOpened', onDayOpened);
    return () => {
      window.removeEventListener('posTakeoutDayClosed', onDayClosed);
      window.removeEventListener('posTakeoutDayOpened', onDayOpened);
    };
  }, [isOpen, activeTab, loadPickupCompleteOrders]);

  // --- Effects ---
  useEffect(() => {
    if (!isOpen) return;
    if (activeTab !== 'complete') return;
    loadPickupCompleteOrders();
  }, [isOpen, activeTab, loadPickupCompleteOrders]);

  useEffect(() => {
    if (!isOpen) return;
    fetchCustomerHistoryForSelection(selectedCustomerHistory);
  }, [isOpen, selectedCustomerHistory, fetchCustomerHistoryForSelection]);

  useEffect(() => {
    if (customerHistoryOrders.length === 0) { setSelectedHistoryOrderId(null); return; }
    setSelectedHistoryOrderId((prev) => {
      if (prev != null) {
        if (customerHistoryOrders.some((o) => normalizeOrderId(o.id) === prev)) return prev;
      }
      return normalizeOrderId(customerHistoryOrders[0]?.id);
    });
  }, [customerHistoryOrders]);

  useEffect(() => {
    if (!isOpen || !selectedHistoryOrderId) {
      if (!selectedHistoryOrderId) { setHistoryOrderDetail(null); setHistoryLoading(false); }
      return;
    }
    const cached = historyDetailsMap[selectedHistoryOrderId];
    if (cached) { setHistoryOrderDetail(cached); setHistoryLoading(false); return; }
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError('');
    (async () => {
      try {
        const res = await fetch(`${API_URL}/orders/${encodeURIComponent(String(selectedHistoryOrderId))}`);
        if (!res.ok) throw new Error('Failed to load order history.');
        const data = await res.json();
        const payload = { order: data?.order || null, items: Array.isArray(data?.items) ? data.items : [], adjustments: Array.isArray(data?.adjustments) ? data.adjustments : [] };
        if (cancelled) return;
        setHistoryDetailsMap((prev) => ({ ...prev, [selectedHistoryOrderId]: payload }));
        setHistoryOrderDetail(payload);
      } catch (error: any) {
        if (cancelled) return;
        setHistoryError(error?.message || 'Failed to load order history.');
        setHistoryOrderDetail(null);
      } finally { if (!cancelled) setHistoryLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [isOpen, selectedHistoryOrderId, historyDetailsMap]);

  useEffect(() => {
    if (isOpen) {
      const mode = initialMode || 'togo';
      setOrderMode(mode);
      setActiveTab(initialTab || 'pickup');
      const pf = prefillSnapshot;
      if (pf) {
        if (pf.customerPhone != null && pf.customerPhone !== '') {
          const formatted = formatTogoPhone(pf.customerPhone);
          setCustomerPhone(formatted);
          customerPhoneRef.current = formatted;
        }
        if (mode === 'online') {
          const onum = (pf.onlineOrderNumber != null && String(pf.onlineOrderNumber).trim() !== '')
            ? String(pf.onlineOrderNumber).trim()
            : (pf.customerName != null ? String(pf.customerName) : '');
          if (onum) setCustomerNameInput(onum);
        } else if (pf.customerName != null && pf.customerName !== '') {
          setCustomerNameInput(formatNameWithTrailingSpace(String(pf.customerName)));
        }
        if (typeof pf.pickupMinutes === 'number' && Number.isFinite(pf.pickupMinutes)) {
          setPickupTime(Math.max(0, pf.pickupMinutes));
        }
        if (pf.customerAddress != null) setCustomerAddress(pf.customerAddress);
        if (pf.customerZip != null) setCustomerZip(pf.customerZip);
        if (pf.note != null) setTogoNote(pf.note);
      }
      if (initialMode === 'online') {
        setKeyboardTarget('name');
        setTimeout(() => nameInputRef.current?.focus(), 100);
      }
    }
  }, [isOpen, initialMode, initialTab, prefillSnapshot]);

  useEffect(() => {
    if (!isOpen) {
      setActiveTab('pickup');
      setCustomerNameInput('');
      setCustomerPhone('');
      customerPhoneRef.current = '';
      setCustomerAddress('');
      setCustomerZip('');
      setTogoNote('');
      setOrderMode(initialMode || 'togo');
      setPrepButtonsLocked(false);
      setPickupTime(15);
      setPickupAmPm(getCurrentAmPm());
      setPickupDateLabel(formatPickupDateLabel());
      setKeyboardTarget('phone');
      setSelectedHistoryOrderId(null);
      setHistoryOrderDetail(null);
      setCustomerHistoryOrders([]);
      setSelectedCustomerHistory(null);
      setHistoryDetailsMap({});
    }
  }, [isOpen]);

  // --- Memos ---
  const readyTimeSnapshot = useMemo(() => {
    const now = new Date();
    const totalMinutes = now.getHours() * 60 + now.getMinutes() + pickupTime;
    const readyHours = Math.floor(totalMinutes / 60) % 24;
    const readyMinutes = totalMinutes % 60;
    const ready24 = `${readyHours.toString().padStart(2, '0')}:${readyMinutes.toString().padStart(2, '0')}`;
    const readyDisplay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), readyHours, readyMinutes).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    const currentDisplay = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    return { current: formatMinutesToTime(now.getHours() * 60 + now.getMinutes()), ready: ready24, readyDisplay, currentDisplay };
  }, [pickupTime]);

  const modeLabel = orderMode === 'online' ? 'Online' : orderMode === 'delivery' ? 'Delivery' : 'Togo';
  const newTabLabel = `New ${modeLabel}`;

  const keyboardDisplayText = useMemo(() => {
    const labelMap: Record<string, string> = { phone: 'Phone', name: 'Name', address: 'Address', note: 'Note', zip: 'Zip' };
    const valueMap: Record<string, string> = { phone: customerPhone, name: customerNameInput, address: customerAddress, note: togoNote, zip: customerZip };
    return `${labelMap[keyboardTarget]}: ${valueMap[keyboardTarget] || ''}`;
  }, [keyboardTarget, customerPhone, customerNameInput, customerAddress, togoNote, customerZip]);

  // --- Input handlers ---
  const handlePhoneInputChange = (value: string) => {
    const formatted = formatTogoPhone(value);
    setCustomerPhone(formatted);
    customerPhoneRef.current = formatted;
    const digits = formatted.replace(/\D/g, '');
    if (digits.length >= 4) setSelectedCustomerHistory({ phone: formatted, phoneRaw: digits, name: customerNameInput });
  };

  const handleNameInputChange = (value: string) => {
    const formatted = formatNameWithTrailingSpace(value);
    setCustomerNameInput(formatted);
    const phoneDigits = (customerPhone || '').replace(/\D/g, '');
    if (formatted.trim().length >= 2 && phoneDigits.length < 4) setSelectedCustomerHistory({ phone: customerPhone, phoneRaw: phoneDigits, name: formatted });
  };

  const handleHistoryOrderClick = (rawId: number | string) => {
    const normalized = normalizeOrderId(rawId);
    if (normalized != null) setSelectedHistoryOrderId(normalized);
  };

  // --- Keyboard handlers ---
  const handleKeyboardType = useCallback((char: string) => {
    switch (keyboardTarget) {
      case 'phone': setCustomerPhone((p) => formatTogoPhone(p + char)); break;
      case 'name': setCustomerNameInput((p) => formatNameWithTrailingSpace(p + char)); break;
      case 'address': setCustomerAddress((p) => p + char); break;
      case 'note': setTogoNote((p) => p + char); break;
      case 'zip': setCustomerZip((p) => p + char); break;
    }
  }, [keyboardTarget]);

  const handleKeyboardBackspace = useCallback(() => {
    switch (keyboardTarget) {
      case 'phone': setCustomerPhone((p) => formatTogoPhone(p.slice(0, -1))); break;
      case 'name': setCustomerNameInput((p) => formatNameWithTrailingSpace(p.slice(0, -1))); break;
      case 'address': setCustomerAddress((p) => p.slice(0, -1)); break;
      case 'note': setTogoNote((p) => p.slice(0, -1)); break;
      case 'zip': setCustomerZip((p) => p.slice(0, -1)); break;
    }
  }, [keyboardTarget]);

  const handleKeyboardClear = useCallback(() => {
    switch (keyboardTarget) {
      case 'phone': setCustomerPhone(''); break;
      case 'name': setCustomerNameInput(''); break;
      case 'address': setCustomerAddress(''); break;
      case 'note': setTogoNote(''); break;
      case 'zip': setCustomerZip(''); break;
    }
  }, [keyboardTarget]);

  const buildConfirmData = (isPrepaid: boolean = false): PickupOrderConfirmData => {
    const sanitizedName = sanitizeDisplayName(customerNameInput);
    return {
      customerName: sanitizedName,
      customerPhone,
      customerAddress,
      customerZip,
      note: togoNote,
      fulfillmentMode: orderMode,
      readyTimeLabel: readyTimeSnapshot.readyDisplay,
      pickupMinutes: pickupTime,
      onlineOrderNumber: orderMode === 'online' ? String(customerNameInput || '').trim() : '',
      isPrepaid,
    };
  };

  const handleOkClick = () => onConfirm(buildConfirmData(false));
  const handlePaymentCompleteClick = () => onConfirm(buildConfirmData(true));

  const resetAndClose = () => {
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center bg-black bg-opacity-70 p-2 pt-2 sm:p-3">
      <div
        className="flex w-full flex-col overflow-hidden border-0"
        style={{ ...PAY_NEO.modalShell, maxWidth: '1000px', height: '96vh', maxHeight: '760px' }}
      >
        <div className="flex flex-shrink-0 items-center justify-end px-3 pt-2">
          <button
            type="button"
            onClick={resetAndClose}
            className={`flex h-11 w-11 items-center justify-center rounded-full border-0 text-red-600 transition-all hover:brightness-[1.03] touch-manipulation ${NEO_MODAL_BTN_PRESS}`}
            style={{ ...PAY_NEO.key, borderRadius: 9999 }}
            title="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Tabs — always hidden (single-purpose modals: New Togo / New Online / Pickup List) */}
        {false && (
          <div className="flex gap-2 mb-4 flex-shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('pickup')}
              className={`flex-1 py-3 px-6 font-bold text-base rounded-lg transition-all border-2 ${activeTab === 'pickup' ? 'bg-blue-600 text-white shadow-lg border-blue-700 ring-2 ring-blue-300' : 'bg-slate-100 text-slate-500 border-slate-300 hover:bg-slate-200 hover:text-slate-700 hover:border-slate-400'}`}
            >
              {newTabLabel}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('complete')}
              className={`flex-1 py-3 px-6 font-bold text-base rounded-lg transition-all border-2 ${activeTab === 'complete' ? 'bg-emerald-600 text-white shadow-lg border-emerald-700 ring-2 ring-emerald-300' : 'bg-slate-100 text-slate-500 border-slate-300 hover:bg-slate-200 hover:text-slate-700 hover:border-slate-400'}`}
            >
              {modeLabel} List
            </button>
          </div>
        )}

        {/* ---- New Pickup Tab ---- */}
        {activeTab === 'pickup' && (
          <>
            <div className="flex flex-shrink-0 items-center justify-between px-5 py-3" style={{ ...PAY_NEO.raised, borderRadius: 0 }}>
              <h3 className="text-lg font-extrabold text-slate-800">{newTabLabel}</h3>
              <div className="flex items-center gap-2">
                <button type="button" onClick={resetAndClose} className={`rounded-[14px] border-0 px-4 py-3 font-bold text-gray-700 transition-all hover:brightness-[1.02] touch-manipulation ${NEO_MODAL_BTN_PRESS}`} style={PAY_NEO.inset}>Cancel</button>
                {orderMode === 'online' && !hideOnlinePaymentComplete && (
                  <button type="button" onClick={handlePaymentCompleteClick} className={`rounded-[14px] border-0 px-4 py-3 text-sm font-bold text-white transition-all hover:brightness-[1.02] touch-manipulation ${NEO_MODAL_BTN_PRESS}`} style={PAY_NEO_PRIMARY_BLUE}>Payment Complete</button>
                )}
                <button type="button" onClick={handleOkClick} className={`rounded-[14px] border-0 px-5 py-3 font-bold text-white transition-all hover:brightness-[1.02] touch-manipulation ${NEO_MODAL_BTN_PRESS}`} style={PAY_NEO_PRIMARY_BLUE}>OK</button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col" style={{ background: PAY_NEO_CANVAS }}>
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden px-4 pb-2 pt-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]" style={{ overflow: 'visible' }}>
              {/* Left Column */}
              <div className="min-h-0 space-y-3 overflow-y-auto overflow-x-visible" style={{ overflow: 'visible' }}>
                <div className="grid gap-1.5" style={{ overflow: 'visible' }}>
                  <div className="flex flex-col md:flex-row gap-2" style={{ overflow: 'visible' }}>
                    {orderMode === 'online' ? (
                      <>
                        <div className="relative flex-1" style={{ overflow: 'visible', zIndex: 100 }}>
                          <input type="text" value={customerNameInput} onChange={(e) => handleNameInputChange(e.target.value)} onFocus={() => setKeyboardTarget('name')} ref={nameInputRef} className={`h-11 w-full rounded-[14px] border-0 px-3 focus:outline-none focus:ring-0 ${pickupFieldRing('name')}`} style={PAY_NEO.inset} placeholder="Order Number" />
                        </div>
                        <div className="relative flex-1" style={{ overflow: 'visible', zIndex: 100 }}>
                          <input type="tel" value={customerPhone} onChange={(e) => handlePhoneInputChange(e.target.value)} onFocus={() => setKeyboardTarget('phone')} ref={phoneInputRef} className={`h-11 w-full rounded-[14px] border-0 px-3 focus:outline-none focus:ring-0 ${pickupFieldRing('phone')}`} style={PAY_NEO.inset} placeholder="(000)000-0000" />
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="relative md:w-[34%] md:flex-none" style={{ overflow: 'visible', zIndex: 100 }}>
                          <input type="tel" value={customerPhone} onChange={(e) => handlePhoneInputChange(e.target.value)} onFocus={() => setKeyboardTarget('phone')} ref={phoneInputRef} className={`h-11 w-full rounded-[14px] border-0 px-3 focus:outline-none focus:ring-0 ${pickupFieldRing('phone')}`} style={PAY_NEO.inset} placeholder="(000)000-0000" />
                        </div>
                        <div className="relative md:w-[31%] md:flex-none" style={{ overflow: 'visible', zIndex: 100 }}>
                          <input type="text" value={customerNameInput} onChange={(e) => handleNameInputChange(e.target.value)} onFocus={() => setKeyboardTarget('name')} ref={nameInputRef} className={`h-11 w-full rounded-[14px] border-0 px-3 focus:outline-none focus:ring-0 ${pickupFieldRing('name')}`} style={PAY_NEO.inset} placeholder="Customer name" />
                        </div>
                      </>
                    )}
                    {orderMode !== 'online' && (
                    <div className="flex md:flex-1 items-center justify-end">
                      <div className="inline-flex h-11 w-full max-w-[214px] overflow-hidden rounded-[14px] border-0 text-xs font-bold" style={PAY_NEO.raised} role="group">
                        {[{ key: 'togo' as const, label: 'TOGO' }, { key: 'delivery' as const, label: 'DELIVERY' }].map((option, idx, arr) => {
                          const active = orderMode === option.key;
                          return (
                            <button type="button" key={option.key} onClick={() => setOrderMode(option.key)} className={`flex h-full items-center justify-center text-center transition-all duration-150 focus:outline-none ${active ? 'ring-2 ring-emerald-400/60 ring-inset text-slate-800' : 'text-slate-600 hover:brightness-[1.02]'} ${NEO_MODAL_BTN_PRESS}`} style={active ? { ...PAY_NEO.inset, flex: idx === 1 ? '0 0 46%' : '0 0 54%' } : { ...PAY_NEO.key, flex: idx === 1 ? '0 0 46%' : '0 0 54%' }}>
                              <span className="mx-auto text-center">{option.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    )}
                  </div>
                </div>

                {/* Prep Time */}
                <div className="space-y-2 rounded-[18px] border-0 p-3" style={PAY_NEO.inset}>
                  <div className="flex min-w-0 flex-nowrap items-center gap-1.5 text-sm font-semibold text-slate-700">
                    <div className="flex min-w-[140px] items-center gap-1">
                      <span className={prepButtonsLocked ? 'text-slate-400' : ''}>Prep Time</span>
                      <span className={`font-mono text-3xl font-semibold leading-none ${prepButtonsLocked ? 'text-slate-400' : 'text-indigo-600'}`}>{formatMinutesToTime(pickupTime)}</span>
                    </div>
                    <div className="flex min-w-[188px] items-center gap-1.5 text-sm sm:text-base">
                      <span className={`whitespace-nowrap rounded-full border px-2.5 py-1 font-semibold ${prepButtonsLocked ? 'border-slate-200 bg-slate-100 text-slate-400' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>Ready {readyTimeSnapshot.readyDisplay}</span>
                      <span className={`whitespace-nowrap rounded-full border px-2.5 py-1 font-semibold ${prepButtonsLocked ? 'border-slate-200 bg-slate-100 text-slate-400' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>Current {readyTimeSnapshot.currentDisplay}</span>
                    </div>
                    <div className="flex-1" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap gap-2">
                      {[5, 10, 15, 20, 25].map((min) => (
                        <button type="button" key={`top-${min}`} onClick={() => setPickupTime(min)} disabled={prepButtonsLocked} className={`flex h-12 min-w-[75px] items-center justify-center rounded-[14px] border-0 px-4 text-sm font-bold transition-all ${prepButtonsLocked ? 'cursor-not-allowed opacity-45' : 'text-slate-800 hover:brightness-[1.02] touch-manipulation'} ${NEO_PREP_TIME_BTN_PRESS}`} style={prepButtonsLocked ? PAY_NEO.inset : PAY_NEO.key}>+{min}</button>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {[30, 40, 50, 60].map((min) => (
                        <button type="button" key={`bottom-${min}`} onClick={() => setPickupTime(min)} disabled={prepButtonsLocked} className={`flex h-12 min-w-[75px] items-center justify-center rounded-[14px] border-0 px-4 text-sm font-bold transition-all ${prepButtonsLocked ? 'cursor-not-allowed opacity-45' : 'text-slate-800 hover:brightness-[1.02] touch-manipulation'} ${NEO_PREP_TIME_BTN_PRESS}`} style={prepButtonsLocked ? PAY_NEO.inset : PAY_NEO.key}>+{min}</button>
                      ))}
                      <button type="button" onClick={() => { setPrepButtonsLocked((prev) => { const next = !prev; if (next) { setPickupTime(0); } else { setPickupTime(15); } setPickupAmPm(getCurrentAmPm()); setPickupDateLabel(formatPickupDateLabel()); return next; }); }} className={`flex h-12 w-[75px] items-center justify-center rounded-[14px] border-0 px-4 text-sm font-bold text-white transition-all hover:brightness-[1.02] touch-manipulation ${NEO_MODAL_BTN_PRESS}`} style={OH_ACTION_NEO.red}>{prepButtonsLocked ? 'Prep On' : 'Prep Off'}</button>
                    </div>
                  </div>
                </div>

                {/* Address & Zip */}
                <div className="grid gap-1.5">
                  <div className="flex gap-2">
                    <textarea value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} onFocus={() => setKeyboardTarget('address')} ref={addressInputRef} rows={1} className={`min-h-[40px] flex-1 resize-none rounded-[14px] border-0 px-3 py-2 text-sm focus:outline-none focus:ring-0 ${pickupFieldRing('address')}`} style={PAY_NEO.inset} placeholder="Address" />
                    <input type="text" value={customerZip} onChange={(e) => setCustomerZip(e.target.value)} onFocus={() => setKeyboardTarget('zip')} ref={zipInputRef} className={`w-24 rounded-[14px] border-0 px-3 py-2 text-sm focus:outline-none focus:ring-0 ${pickupFieldRing('zip')}`} style={PAY_NEO.inset} placeholder="Zip" />
                  </div>
                </div>

                {/* Note */}
                <div className="grid gap-1.5">
                  <textarea value={togoNote} onChange={(e) => setTogoNote(e.target.value)} onFocus={() => setKeyboardTarget('note')} ref={noteInputRef} rows={1} className={`min-h-[40px] flex-1 resize-none rounded-[14px] border-0 px-3 py-2 text-sm focus:outline-none focus:ring-0 ${pickupFieldRing('note')}`} style={PAY_NEO.inset} placeholder="Note" />
                </div>
              </div>

              {/* Right Column - Order History */}
              <div className="flex min-h-0 flex-col overflow-hidden rounded-[18px] border-0 p-4" style={PAY_NEO.inset}>
                <div className="flex items-center justify-between flex-shrink-0" style={{ marginTop: '-15px' }}>
                  <p className="text-base font-semibold text-slate-800">Order History</p>
                </div>
                <div className="overflow-y-auto max-h-28 pr-0.5 flex-shrink-0" style={{ marginTop: '2px' }}>
                  {customerHistoryLoading ? (
                    <div className="flex items-center justify-center py-8"><div className="h-6 w-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>
                  ) : customerHistoryError ? (
                    <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{customerHistoryError}</div>
                  ) : displayedHistoryOrders.length === 0 ? (
                    <div className="text-sm text-slate-500 border border-dashed border-slate-300 rounded-lg px-3 py-4 text-center">{selectedCustomerHistory ? 'No past orders found.' : 'Select a customer to view history.'}</div>
                  ) : (
                    <div className="grid grid-cols-2 gap-1">
                      {displayedHistoryOrders.map((order) => {
                        const normalized = normalizeOrderId(order.id);
                        const isSelected = normalized != null && normalized === selectedHistoryOrderId;
                        const hStatus = String(order.status || '').toUpperCase();
                        const hIsPaid = hStatus === 'PAID' || hStatus === 'COMPLETED' || hStatus === 'CLOSED';
                        const hIsPickedUp = hStatus === 'PICKED_UP';
                        const hBg = isSelected ? undefined : hIsPickedUp ? undefined : hIsPaid ? 'rgba(229,236,240,0.1)' : 'rgba(219,229,239,0.15)';
                        const hType = String(order.order_type || order.orderType || '').toUpperCase();
                        const hIsDineIn = hType === 'DINE_IN' || hType === 'DINE-IN' || hType === 'POS';
                        const hLabel = hIsDineIn ? null : !hIsPaid && !hIsPickedUp ? 'Unpaid' : (hIsPaid && !hIsPickedUp) ? 'Ready' : null;
                        return (
                          <div key={`${order.id}-${order.number}`}>
                          <button type="button" onClick={() => normalized != null && handleHistoryOrderClick(normalized)} className={`w-full rounded-[14px] border-0 px-3 py-2 text-left transition-all hover:brightness-[1.02] touch-manipulation ${isSelected ? 'ring-2 ring-emerald-400/70' : ''} ${NEO_MODAL_BTN_PRESS}`} style={{ paddingTop: '0.55rem', paddingBottom: '0.55rem', ...(isSelected ? PAY_NEO.inset : PAY_NEO.key), ...(hBg && !isSelected ? { backgroundColor: hBg } : {}) }}>
                            <div className="flex items-center justify-between text-[12px] font-semibold text-slate-800 gap-2">
                              <span className="truncate">{formatOrderHistoryDate(order)}</span>
                              <span className="flex items-center gap-1.5">
                                {hLabel && (
                                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${hLabel === 'Unpaid' ? 'text-red-600 bg-red-100' : 'text-emerald-700 bg-emerald-100'}`}>{hLabel}</span>
                                )}
                                <span className="text-sm text-slate-900">{formatCurrency(getOrderTotalValue(order))}</span>
                              </span>
                            </div>
                          </button>
                          <div style={{ height: '3px', backgroundColor: 'rgba(190,209,236,0.15)', borderRadius: '0 0 8px 8px', marginTop: '1px' }} />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="border-t border-slate-200 pt-3 flex-1 min-h-0 flex flex-col" style={{ marginTop: '-3px' }}>
                  <div className="flex flex-col flex-1 min-h-0" style={{ marginTop: '-6px' }}>
                    <div className="flex items-center justify-between flex-shrink-0"><p className="text-sm font-semibold text-slate-800" style={{ marginBottom: '3px' }}>Order Details</p></div>
                    {historyLoading ? (
                      <div className="flex items-center justify-center py-8"><div className="h-6 w-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>
                    ) : historyError ? (
                      <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mt-2">{historyError}</div>
                    ) : historyOrderDetail ? (
                      <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border-0" style={PAY_NEO.raised}>
                        <div className="flex-1 overflow-y-auto">
                          {historyOrderDetail.items.length === 0 ? (
                            <p className="text-sm text-slate-500 px-3 py-4">No items saved.</p>
                          ) : (
                            historyOrderDetail.items.map((item: any, idx: number) => {
                              const qty = item.quantity || 1;
                              const unitPrice = Number(item.price || item.unit_price || 0);
                              const lineTotal = unitPrice * qty;
                              const modifiers = Array.isArray(item.modifiers) ? item.modifiers.map((mod: any) => mod?.name || mod).filter(Boolean) : [];
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
                    ) : (
                      <div className="text-sm text-slate-500 border border-dashed border-slate-300 rounded-lg px-3 py-4 text-center mt-3">Select an order to view details.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Virtual Keyboard */}
            <div className="-mt-[30px] flex-shrink-0 px-4 pb-3">
              <Suspense fallback={<div className="h-40 animate-pulse rounded-[14px]" style={PAY_NEO.inset} />}>
                <VirtualKeyboard open={true} onType={handleKeyboardType} onBackspace={handleKeyboardBackspace} onClear={handleKeyboardClear} displayText={keyboardDisplayText} keepOpen={true} showNumpad={true} languages={['EN', 'KO']} currentLanguage="EN" maxWidthPx={1000} layoutMode="parentFlow" />
              </Suspense>
            </div>
            </div>
          </>
        )}

        {/* ---- Pickup List Tab ---- */}
        {activeTab === 'complete' && (
          <div className="flex min-h-0 flex-1 flex-col px-4 pb-3 pt-2" style={{ background: PAY_NEO_CANVAS }}>
            <div className="mb-3 flex flex-shrink-0 items-center justify-between rounded-[14px] border-0 px-4 py-3" style={PAY_NEO.raised}>
              <div>
                <h3 className="text-lg font-extrabold text-slate-800">{modeLabel} List</h3>
                <p className="text-xs text-slate-500">Unpaid / Ready pickup — Amount column shows status. Picked up orders are removed.</p>
              </div>
              <button type="button" onClick={loadPickupCompleteOrders} disabled={pickupCompleteLoading} className={`rounded-[14px] border-0 px-4 py-3 font-bold text-slate-800 transition-all hover:brightness-[1.02] disabled:cursor-not-allowed disabled:opacity-50 touch-manipulation ${NEO_MODAL_BTN_PRESS}`} style={PAY_NEO.key}>{pickupCompleteLoading ? 'Loading...' : 'Refresh'}</button>
            </div>
            {pickupCompleteError && <div className="mb-3 rounded-[14px] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-red-700">{pickupCompleteError}</div>}
            <div className="min-h-0 flex-1 overflow-hidden rounded-[18px] border-0" style={PAY_NEO.inset}>
              {pickupCompleteLoading ? (
                <div className="h-full flex items-center justify-center text-slate-400 text-sm">Loading...</div>
              ) : pickupCompleteOrders.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-400 text-sm">No paid pickup orders.</div>
              ) : (
                <OrderDetailModal
                  isOpen={true}
                  embedded={true}
                  showTabs={false}
                  defaultTab="togo"
                  onlineOrders={[]}
                  deliveryOrders={[]}
                  togoOrders={pickupCompleteOrders}
                  initialOrderType="togo"
                  initialSelectedOrder={pickupCompleteOrders[0] || null}
                  onClose={() => {}}
                  onOrdersRefresh={loadPickupCompleteOrders}
                  onPayment={(order, orderType) => {
                    if (!onPayment) return;
                    onPayment(order, orderType);
                  }}
                  onPickupComplete={async (order) => {
                    if (!onPickupComplete) return;
                    const orderId: any = (order as any)?.order_id ?? order?.id;
                    if (!orderId) return;
                    try {
                      await fetch(`${API_URL}/orders/${orderId}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'PICKED_UP' }) });
                    } catch (e) { console.error('[PickupModal] Pickup complete error:', e); } finally {
                      const removeA = String(order?.id ?? '');
                      const removeB = String(orderId ?? '');
                      setPickupCompleteOrders((prev) => prev.filter((o) => { const id = String((o as any)?.id ?? ''); return id !== removeA && id !== removeB; }));
                      loadPickupCompleteOrders();
                    }
                  }}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PickupOrderModal;
