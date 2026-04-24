import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { OrderItem } from '../pages/order/orderTypes';
import { API_URL } from '../config/constants';
import { loadTetraBridgeReady, purchaseOnTetraTerminal } from '../utils/tetraIntegratedPayment';
import { PAY_NEO, PAY_NEO_CANVAS, SOFT_NEO } from '../utils/softNeumorphic';

interface PaymentCompleteData {
	change: number;
	total: number;
	tip: number;
	payments: Array<{ method: string; amount: number }>;
	hasCashPayment: boolean;
	isPartialPayment?: boolean;
	discount?: {
		percent: number;
		amount: number;
		originalSubtotal: number;
		discountedSubtotal: number;
		taxLines: Array<{ name: string; amount: number }>;
		taxesTotal: number;
	};
}

interface PaymentModalProps {
	isOpen: boolean;
	onClose: () => void;
	subtotal: number;
	taxLines: Array<{ name: string; amount: number }>; 
	total: number;
	onConfirm: (payload: { method: string; amount: number; tip: number; discountedGrand?: number; terminalRef?: string }) => void | Promise<void>;
	onComplete?: (receiptCount: number) => void;
	onPaymentComplete?: (data: PaymentCompleteData) => void;  // 결제 완료 시 별도 모달 표시용
	channel?: string;
	customerName?: string;
	tableName?: string;
	onSplitBill?: () => void;
	guestCount?: number;
	guestMode?: 'ALL' | number;
	onSelectGuestMode?: (mode: 'ALL' | number) => void;
	forceGuestMode?: 'ALL' | number;
	showAllButton?: boolean;
	outstandingDue?: number;
	paidSoFar?: number;
	payments?: Array<{ paymentId: number; method: string; amount: number; tip: number; guestNumber?: number }>;
  paidGuests?: number[];
	onVoidPayment?: (paymentId: number) => void;
	onClearAllPayments?: () => void;
  onClearScopedPayments?: (paymentIds: number[]) => Promise<void> | void;
	prefillDueNonce?: number;
	// Optional: prefill amount input with current total once when incremented
	prefillUseTotalOnceNonce?: number;
	// Optional vertical offset (px) when opened from SplitBill
	offsetTopPx?: number;
  // Callback to create adhoc guests for N-split
  onCreateAdhocGuests?: (count: number) => void;
  // Share Selected functionality
  orderItems?: OrderItem[];
  onShareSelected?: (rowIndex: number, guests: number[]) => void;
  // Optional: override root overlay z-index class (default: z-50)
  zIndexClassName?: string;
}

function calcFairShare(totalCents: number, n: number, guestIdx: number): number {
  const baseShare = Math.floor(totalCents / n);
  const rem = totalCents % n;
  return (baseShare + (guestIdx <= rem ? 1 : 0)) / 100;
}

/** 카드·직불: 입력 금액이 Due를 넘기면 초과분을 팁으로 흡수(현금처럼 Change Due 단계 없이 확정 가능) */
function isCardPaymentMethod(m: string): boolean {
  const u = String(m || '').toUpperCase();
  return u === 'DEBIT' || u === 'VISA' || u === 'MC' || u === 'OTHER_CARD';
}

const methods = [
	{ key: 'CASH', label: 'Cash', emoji: '💵' },
	{ key: 'DEBIT', label: 'Debit', emoji: '🏧' },
	{ key: 'VISA', label: 'Visa', emoji: '💳' },
	{ key: 'MC', label: 'MasterCard', emoji: '💳' },
	{ key: 'OTHER_CARD', label: 'Other Card', emoji: '💳' },
	{ key: 'GIFT', label: 'Gift Card', emoji: '🎁' },
	{ key: 'OTHER', label: 'Other', emoji: '✳️' },
];

/** 가운데 키패드 — 배경·그림자를 살짝 진하게 */
const PAY_KEYPAD_KEY: React.CSSProperties = {
	...PAY_NEO.key,
	background: '#d4d9e4',
	boxShadow: '5px 5px 10px #b0b6c4, -4px -4px 9px #ffffff',
};

/** 결제모달 내 모든 `<button>` — 눌림 시 오목(inset); 모달 shell `<style>`의 `.payneo-inset-press` */
const PAY_BTN_INSET =
	'payneo-inset-press touch-manipulation select-none transition-[transform,box-shadow] duration-100 ease-out';
/** Due $ / Change Due $ / Tip $ 행 — 오목이 transition 지연 없이 바로 보이도록 duration-0 */
const PAY_BTN_INSET_SNAP =
	'payneo-inset-press touch-manipulation select-none transition-[transform,box-shadow] duration-0 ease-out';
const PAY_KEYPAD_PRESS = PAY_BTN_INSET;
const PAY_SPLIT_PRESS = PAY_BTN_INSET;
const PAY_CANCEL_PRESS = PAY_BTN_INSET;
const PAY_OK_PRESS = PAY_BTN_INSET;

const PaymentModal: React.FC<PaymentModalProps> = ({ isOpen, onClose, subtotal, taxLines, total, onConfirm, onComplete, onPaymentComplete, channel, customerName, tableName, onSplitBill, guestCount, guestMode, onSelectGuestMode, forceGuestMode, showAllButton, outstandingDue, paidSoFar, payments, paidGuests = [], onVoidPayment, onClearAllPayments, onClearScopedPayments, prefillDueNonce, prefillUseTotalOnceNonce, offsetTopPx, onCreateAdhocGuests, orderItems = [], onShareSelected, zIndexClassName }) => {
	const [method, setMethod] = useState<string>('');
	const skipAmountResetRef = useRef<boolean>(false);
	const [amount, setAmount] = useState<string>('0.00');
	const [tip, setTip] = useState<string>('0');
	const [isTipFocused, setIsTipFocused] = useState<boolean>(false);
  const [inputTarget, setInputTarget] = useState<'AMOUNT' | 'TIP' | 'DISCOUNT' | 'SPLIT_N' | 'CHANGE_DUE'>('AMOUNT');
	const [optimisticPayments, setOptimisticPayments] = useState<Array<{ tempId: string; method?: string; amount: number; tip?: number; displayAmount?: number }>>([]);
	const [rawAmountDigits, setRawAmountDigits] = useState<string>('');
  const [clampPopup, setClampPopup] = useState<{ entered: number; applied: number; method?: string } | null>(null);
  const clampTimerRef = useRef<number | null>(null);
  const [infoPopup, setInfoPopup] = useState<string | null>(null);
  const infoTimerRef = useRef<number | null>(null);
  const [proceedArmed, setProceedArmed] = useState<boolean>(false);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const alertTimerRef = useRef<number | null>(null);
  const [lastChange, setLastChange] = useState<number | null>(null);
  const [isClearingPaidBox, setIsClearingPaidBox] = useState<boolean>(false);
  const [forceAllMode, setForceAllMode] = useState<boolean>(false);
  const [isSplitCountMode, setIsSplitCountMode] = useState<boolean>(false);
  const [splitCountInput, setSplitCountInput] = useState<string>('');
  const [splitNActive, setSplitNActive] = useState<number>(0);
  const [splitNCustomMode, setSplitNCustomMode] = useState<boolean>(false);
  const [splitNCustomDigits, setSplitNCustomDigits] = useState<string>('');
  const [changeDueDigits, setChangeDueDigits] = useState<string>('');
  const changeDueTotalRef = useRef<number>(0);
  const committedChangeRef = useRef<number>(0);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);  // 더블 클릭 방지용
  const [cashReadyForOk, setCashReadyForOk] = useState<boolean>(false);
  const cashReadyDataRef = useRef<{ rawAmt: number; scopeDueNow: number; effectiveMethod: string; isFinalizeFlow: boolean } | null>(null);
  /** 스플릿(1/N) 게스트: 결제수단 클릭(commitDraft)으로 해당 게스트 몫이 끝난 뒤, 부모 payments 반영이 한 박자 늦어 canComplete가 false로 남는 경우 OK 시 onPaymentComplete 보장 */
  const splitGuestAwaitingOkForReceiptRef = useRef<boolean>(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState<boolean>(false);  // Cancel 확인 팝업
  const [selectedReceiptCount, setSelectedReceiptCount] = useState<number>(2);  // 영수증 출력 매수 (0: No Receipt, 1: 1 Receipt, 2: 2 Receipts)
  
  // Share Selected states
  const [isShareSelectedMode, setIsShareSelectedMode] = useState<boolean>(false);
  const [shareSelectedRowIndex, setShareSelectedRowIndex] = useState<number | null>(null);
  const [shareTargetGuests, setShareTargetGuests] = useState<Set<number>>(new Set());

  // Gift Card states
  const [showGiftCardModal, setShowGiftCardModal] = useState<boolean>(false);
  const [giftCardNumber, setGiftCardNumber] = useState<string>('');
  const [giftCardBalance, setGiftCardBalance] = useState<number | null>(null);
  const [giftCardError, setGiftCardError] = useState<string>('');
  const [giftCardLoading, setGiftCardLoading] = useState<boolean>(false);
  const [giftCardPayAmount, setGiftCardPayAmount] = useState<string>('');
  const [giftCardInputFocus, setGiftCardInputFocus] = useState<'card' | 'amount'>('card');
  /** Split Bill(하단) 진입 시 할인·1/N 분할 잠금용 */
  const [splitBillLaunchTouched, setSplitBillLaunchTouched] = useState(false);

  // Discount states (order-level percent; applied within this modal only)
  const DISCOUNT_PRESETS = [5, 10, 15, 20] as const;
  const [discountPreset, setDiscountPreset] = useState<number | null>(null);
  const [isCustomDiscount, setIsCustomDiscount] = useState<boolean>(false);
  const [customDiscountDigits, setCustomDiscountDigits] = useState<string>(''); // integer percent, 1..100
  const [discountBump5Pressed, setDiscountBump5Pressed] = useState(false);
  const [discountBump10Pressed, setDiscountBump10Pressed] = useState(false);

  // 초기 금액 고정 (Items, Tax, Total은 결제 후에도 절대 변경되지 않아야 함)
  const initialSubtotalRef = useRef<number | null>(null);
  const initialTaxTotalRef = useRef<number | null>(null);
  const initialTaxLinesRef = useRef<Array<{ name: string; amount: number }> | null>(null);
  const initialGrandRef = useRef<number | null>(null);
  const wasOpenRef = useRef<boolean>(false);
  
  // 모달이 열릴 때 한 번만 초기값 저장 (결제 후에도 절대 변경되지 않음)
  useEffect(() => {
    if (!isOpen) {
      if (wasOpenRef.current) {
        wasOpenRef.current = false;
        initialSubtotalRef.current = null;
        initialTaxTotalRef.current = null;
        initialTaxLinesRef.current = null;
        initialGrandRef.current = null;
      }
      return;
    }

    const taxTotal = taxLines.reduce((s, t) => s + t.amount, 0);
    const grandFromParts = parseFloat((subtotal + taxTotal).toFixed(2));
    const hasTotalProp = (typeof total === 'number' && Number.isFinite(total));
    const totalFixed = hasTotalProp ? Number(total.toFixed(2)) : NaN;
    const shouldTrustTotal =
      hasTotalProp && (totalFixed > 0.0001 || Math.abs(grandFromParts) < 0.0001);
    const grandFromProp = shouldTrustTotal ? totalFixed : grandFromParts;

    const snapshotGrand = initialGrandRef.current;
    const noActivity =
      (!method) &&
      (optimisticPayments.length === 0) &&
      ((payments || []).length === 0) &&
      (Math.abs((parseFloat(amount || '0') || 0)) < 0.0001) &&
      (Math.abs((parseFloat(tip || '0') || 0)) < 0.0001);
    const shouldSeedInitial = !wasOpenRef.current;
    const shouldReseedFromZero = wasOpenRef.current && noActivity && (snapshotGrand == null || Math.abs(snapshotGrand) < 0.0001) && grandFromProp > 0.0001;

    if (shouldSeedInitial || shouldReseedFromZero) {
      initialSubtotalRef.current = subtotal;
      initialTaxTotalRef.current = taxTotal;
      initialTaxLinesRef.current = taxLines.map(t => ({ name: t.name, amount: t.amount }));
      initialGrandRef.current = grandFromProp;
      wasOpenRef.current = true;
    }
  }, [isOpen, subtotal, taxLines, total, method, payments, optimisticPayments.length, amount, tip]);

	const forceCashMethod = useCallback(() => {
		skipAmountResetRef.current = true;
		setMethod('CASH');
	}, [setMethod]);

  // Gift Card functions (basic - no dependencies on remainingDue)
  const resetGiftCard = useCallback(() => {
    setGiftCardNumber('');
    setGiftCardBalance(null);
    setGiftCardError('');
    setGiftCardPayAmount('');
    setGiftCardLoading(false);
    setGiftCardInputFocus('card');
  }, []);

  const handleGiftCardKeypadPress = useCallback((key: string) => {
    if (giftCardInputFocus === 'card') {
      if (key === 'C') {
        setGiftCardNumber('');
        setGiftCardBalance(null);
        setGiftCardError('');
      } else if (key === '⌫') {
        setGiftCardNumber(prev => prev.slice(0, -1));
        setGiftCardBalance(null);
        setGiftCardError('');
      } else if (/^\d$/.test(key) && giftCardNumber.length < 16) {
        setGiftCardNumber(prev => prev + key);
        setGiftCardBalance(null);
        setGiftCardError('');
      }
    } else {
      // amount input
      if (key === 'C') {
        setGiftCardPayAmount('');
      } else if (key === '⌫') {
        setGiftCardPayAmount(prev => prev.slice(0, -1));
      } else if (key === '.') {
        if (!giftCardPayAmount.includes('.')) {
          setGiftCardPayAmount(prev => prev + '.');
        }
      } else if (/^\d$/.test(key)) {
        setGiftCardPayAmount(prev => {
          const newVal = prev + key;
          // Limit decimal places to 2
          if (newVal.includes('.') && newVal.split('.')[1]?.length > 2) return prev;
          return newVal;
        });
      }
    }
  }, [giftCardInputFocus, giftCardNumber]);

useEffect(() => {
  if (!isOpen) {
    setRawAmountDigits('');
    resetGiftCard();
    setShowGiftCardModal(false);
    setIsShareSelectedMode(false);
    setShareSelectedRowIndex(null);
    setShareTargetGuests(new Set());
    setDiscountPreset(null);
    setIsCustomDiscount(false);
    setCustomDiscountDigits('');
    setDiscountBump5Pressed(false);
    setDiscountBump10Pressed(false);
    setSplitNActive(0);
    setSplitNCustomMode(false);
    setSplitNCustomDigits('');
    setChangeDueDigits('');
    changeDueTotalRef.current = 0;
    committedChangeRef.current = 0;
    splitGuestAwaitingOkForReceiptRef.current = false;
    setSplitBillLaunchTouched(false);
  }
}, [isOpen, resetGiftCard]);
	useEffect(() => {
    if (isOpen) {
      setProceedArmed(false); setLastChange(null);
    }
  }, [isOpen]);
	useEffect(() => {
    return () => {
      if (clampTimerRef.current) { window.clearTimeout(clampTimerRef.current); clampTimerRef.current = null; }
      if (alertTimerRef.current) { window.clearTimeout(alertTimerRef.current); alertTimerRef.current = null; }
      if (infoTimerRef.current) { window.clearTimeout(infoTimerRef.current); infoTimerRef.current = null; }
    };
  }, []);

	const showClampPopup = (entered: number, applied: number, method?: string) => {
		setClampPopup({ entered, applied, method });
		if (clampTimerRef.current) { window.clearTimeout(clampTimerRef.current); }
		clampTimerRef.current = window.setTimeout(() => {
			setClampPopup(null);
			clampTimerRef.current = null;
		}, 2200);
	};

  const showInfoPopup = (message: string) => {
    try {
      setInfoPopup(message);
      if (infoTimerRef.current) { window.clearTimeout(infoTimerRef.current); }
      infoTimerRef.current = window.setTimeout(() => {
        setInfoPopup(null);
        infoTimerRef.current = null;
      }, 1700);
    } catch {}
  };

	const showAlert = (message: string) => {
		setAlertMessage(message);
		if (alertTimerRef.current) { window.clearTimeout(alertTimerRef.current); }
		alertTimerRef.current = window.setTimeout(() => {
			setAlertMessage(null);
			alertTimerRef.current = null;
		}, 3000);
	};
 
	// 초기값 사용 (고정된 금액 - 결제 후에도 변경되지 않음)
  const fallbackTaxTotal = taxLines.reduce((s, t) => s + (t.amount || 0), 0);
  const fallbackGrandFromDue =
    (typeof outstandingDue === 'number' && Number.isFinite(outstandingDue) && outstandingDue > 0)
      ? Number((outstandingDue + (typeof paidSoFar === 'number' && Number.isFinite(paidSoFar) ? paidSoFar : 0)).toFixed(2))
      : 0;
  const fallbackGrand =
    (() => {
      const hasTotalProp = (typeof total === 'number' && Number.isFinite(total));
      const totalFixed = hasTotalProp ? Number((total as number).toFixed(2)) : NaN;
      const parts = (subtotal > 0 || fallbackTaxTotal > 0)
        ? Number((subtotal + fallbackTaxTotal).toFixed(2))
        : 0;
      const trust = hasTotalProp && (totalFixed > 0.0001 || Math.abs(parts) < 0.0001);
      if (trust) return totalFixed;
      if (parts > 0.0001) return parts;
      return fallbackGrandFromDue;
    })()
  ;

	const fixedSubtotal = initialSubtotalRef.current !== null
    ? initialSubtotalRef.current
    : (subtotal > 0 ? subtotal : Math.max(0, Number((fallbackGrand - fallbackTaxTotal).toFixed(2))));
  const fixedTaxLines = initialTaxLinesRef.current !== null ? initialTaxLinesRef.current : taxLines;

  const selectedDiscountPercent = useMemo(() => {
    const raw = isCustomDiscount
      ? (customDiscountDigits === '' ? NaN : Number(customDiscountDigits))
      : (discountPreset == null ? NaN : Number(discountPreset));
    if (!Number.isFinite(raw)) return 0;
    const n = Math.floor(raw);
    if (n < 1) return 0;
    if (n > 100) return 100;
    return n;
  }, [isCustomDiscount, customDiscountDigits, discountPreset]);

  const bumpDiscountBy = useCallback(
    (delta: number) => {
      const base = selectedDiscountPercent;
      const next = Math.min(100, base + delta);
      if (next < 1) {
        setDiscountPreset(null);
        setIsCustomDiscount(false);
        setCustomDiscountDigits('');
      } else if ((DISCOUNT_PRESETS as readonly number[]).includes(next)) {
        setDiscountPreset(next);
        setIsCustomDiscount(false);
        setCustomDiscountDigits('');
      } else {
        setDiscountPreset(null);
        setIsCustomDiscount(true);
        setCustomDiscountDigits(String(next));
      }
      setLastChange(null);
      setInputTarget('AMOUNT');
      setIsTipFocused(false);
    },
    [selectedDiscountPercent]
  );

  const pricingEffective = useMemo(() => {
    const baseSubtotal = Number(fixedSubtotal || 0);
    const baseTaxLines = (fixedTaxLines || []).map(t => ({ name: String(t.name || 'Tax'), amount: Number(t.amount || 0) }));
    const baseTaxTotal = baseTaxLines.reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const baseGrand = Number((baseSubtotal + baseTaxTotal).toFixed(2));

    if (!selectedDiscountPercent || baseSubtotal <= 0) {
      return {
        discountPercent: 0,
        discountAmount: 0,
        baseSubtotal: Number(baseSubtotal.toFixed(2)),
        subtotal: Number(baseSubtotal.toFixed(2)),
        taxLines: baseTaxLines.map(t => ({ name: t.name, amount: Number((t.amount || 0).toFixed(2)) })),
        taxesTotal: Number(baseTaxTotal.toFixed(2)),
        total: Number(baseGrand.toFixed(2)),
      };
    }

    const discountAmount = Number(((baseSubtotal * selectedDiscountPercent) / 100).toFixed(2));
    const subAfter = Math.max(0, Number((baseSubtotal - discountAmount).toFixed(2)));
    const ratio = baseSubtotal > 0 ? (subAfter / baseSubtotal) : 0;
    const scaledTaxLines = baseTaxLines.map(t => ({ name: t.name, amount: Number((Number(t.amount || 0) * ratio).toFixed(2)) }));
    const scaledTaxTotal = Number(scaledTaxLines.reduce((s, t) => s + (Number(t.amount) || 0), 0).toFixed(2));
    const total = Number((subAfter + scaledTaxTotal).toFixed(2));

    return {
      discountPercent: selectedDiscountPercent,
      discountAmount,
      baseSubtotal: Number(baseSubtotal.toFixed(2)),
      subtotal: subAfter,
      taxLines: scaledTaxLines,
      taxesTotal: scaledTaxTotal,
      total,
    };
  }, [fixedSubtotal, fixedTaxLines, selectedDiscountPercent]);

	const taxTotal = pricingEffective.taxesTotal;
	const parsedAmount = useMemo(() => parseFloat(amount) || 0, [amount]);
	const parsedTip = useMemo(() => parseFloat(tip) || 0, [tip]);
  const grand = pricingEffective.total;

  const effectiveGuestMode = useMemo(() => {
    if (typeof forceGuestMode !== 'undefined') return forceGuestMode;
    return (forceAllMode ? 'ALL' : guestMode);
  }, [forceGuestMode, forceAllMode, guestMode]);

  const prevGuestRef = useRef(effectiveGuestMode);
  useEffect(() => {
    if (prevGuestRef.current !== effectiveGuestMode) {
      prevGuestRef.current = effectiveGuestMode;
      setRawAmountDigits('');
      setLastChange(null);
      setProceedArmed(false);
      setOptimisticPayments([]);
      setMethod('');
      setCashReadyForOk(false);
      cashReadyDataRef.current = null;
      // 게스트 전환 시 고정된 금액 ref를 리셋하여 새 게스트 금액으로 갱신
      initialSubtotalRef.current = null;
      initialTaxTotalRef.current = null;
      initialTaxLinesRef.current = null;
      initialGrandRef.current = null;
      wasOpenRef.current = false;
    }
  }, [effectiveGuestMode]);

  const displayPricing = useMemo(() => {
    if (splitNActive < 2) return pricingEffective;
    const n = splitNActive;
    const guestIdx = typeof effectiveGuestMode === 'number' ? effectiveGuestMode : 1;
    const totalCents = Math.round(pricingEffective.total * 100);
    const myTotal = calcFairShare(totalCents, n, guestIdx);
    const splitTaxLines = pricingEffective.taxLines.map(t => {
      const tCents = Math.round(t.amount * 100);
      return { name: t.name, amount: calcFairShare(tCents, n, guestIdx) };
    });
    const splitTaxesTotal = Number(splitTaxLines.reduce((s, t) => s + t.amount, 0).toFixed(2));
    const splitSubtotal = Number((myTotal - splitTaxesTotal).toFixed(2));
    const splitDiscountAmount = pricingEffective.discountPercent > 0
      ? Number((calcFairShare(Math.round(pricingEffective.discountAmount * 100), n, guestIdx)).toFixed(2))
      : 0;
    const splitBaseSubtotal = Number((splitSubtotal + splitDiscountAmount).toFixed(2));
    return {
      ...pricingEffective,
      baseSubtotal: splitBaseSubtotal,
      subtotal: splitSubtotal,
      discountAmount: splitDiscountAmount,
      taxLines: splitTaxLines,
      taxesTotal: splitTaxesTotal,
      total: myTotal,
    };
  }, [pricingEffective, splitNActive, effectiveGuestMode]);
  // Remaining due in current scope (after confirmed payments)
  // 우선순위: 실제 확정 결제(`payments`) 합계를 신뢰하고, 외부에서 전달된 outstandingDue는 보조로 사용
  // 중요: 결제 모달 내부에서 Discount가 켜지면 그 Total 기준으로 Due를 계산
  const remainingDue = useMemo(() => {
    try {
      const splitActive = (typeof effectiveGuestMode === 'number') || ((guestCount || 0) > 1);
      if (onCreateAdhocGuests && splitActive && splitNActive >= 2) {
        const grandCents = Math.round(grand * 100);
        const guestIdx = typeof effectiveGuestMode === 'number' ? effectiveGuestMode : 1;
        const myShare = calcFairShare(grandCents, splitNActive, guestIdx);
        const scopedPayments = Array.isArray(payments)
          ? (typeof effectiveGuestMode === 'number' ? payments.filter(p => p.guestNumber === effectiveGuestMode) : payments)
          : [];
        const paidFood = scopedPayments.reduce((s, p: any) => s + ((p.amount || 0) - ((p as any).tip || 0)), 0);
        return Math.max(0, Number((myShare - paidFood).toFixed(2)));
      }
      const confirmedTotal = Number(((cashPaidConfirmed + nonCashPaidConfirmed)).toFixed(2));
      const dueFull = Math.max(0, Number((grand - confirmedTotal).toFixed(2)));
      return Math.max(0, dueFull);
    } catch {
      return Math.max(0, Number(grand.toFixed(2)));
    }
  }, [outstandingDue, grand, onCreateAdhocGuests, guestCount, splitNActive, effectiveGuestMode, payments]);

  // Gift Card functions (depends on remainingDue)
  const handleCheckGiftCardBalance = useCallback(async () => {
    if (giftCardNumber.length !== 16) {
      setGiftCardError('Please enter a valid 16-digit card number');
      return;
    }
    setGiftCardLoading(true);
    setGiftCardError('');
    try {
      const response = await fetch(`${API_URL}/gift-cards/${giftCardNumber}/balance`);
      if (response.ok) {
        const data = await response.json();
        setGiftCardBalance(data.balance);
        // Pre-fill pay amount with min of balance or remaining due
        const maxPay = Math.min(data.balance, remainingDue);
        setGiftCardPayAmount(maxPay.toFixed(2));
        setGiftCardInputFocus('amount');
      } else {
        const err = await response.json();
        setGiftCardError(err.message || 'Card not found');
        setGiftCardBalance(null);
      }
    } catch {
      setGiftCardError('Failed to connect to server');
    } finally {
      setGiftCardLoading(false);
    }
  }, [giftCardNumber, remainingDue]);

  const handleGiftCardPay = useCallback(async () => {
    const enteredPayAmount = parseFloat(giftCardPayAmount);
    
    if (!enteredPayAmount || enteredPayAmount <= 0) {
      setGiftCardError('Please enter a valid amount');
      return;
    }
    if (giftCardBalance === null) {
      setGiftCardError('Please check balance first');
      return;
    }
    if (enteredPayAmount > giftCardBalance) {
      setGiftCardError('Insufficient balance');
      return;
    }
    // Gift Card: prevent overcharge; auto-clamp to remaining due
    const payAmount = Math.min(enteredPayAmount, remainingDue);
    if (enteredPayAmount > remainingDue) {
      setGiftCardError('');
      showInfoPopup('Overcharging is not allowed');
      try { setGiftCardPayAmount(remainingDue.toFixed(2)); } catch {}
    }

    setGiftCardLoading(true);
    setGiftCardError('');
    try {
      const response = await fetch(`${API_URL}/gift-cards/${giftCardNumber}/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: payAmount })
      });
      if (response.ok) {
        // Payment successful - call onConfirm with GIFT method
        onConfirm({ method: 'GIFT', amount: payAmount, tip: 0, discountedGrand: grand });
        setShowGiftCardModal(false);
        resetGiftCard();
      } else {
        const err = await response.json();
        setGiftCardError(err.message || 'Payment failed');
      }
    } catch {
      setGiftCardError('Failed to process payment');
    } finally {
      setGiftCardLoading(false);
    }
  }, [giftCardNumber, giftCardPayAmount, giftCardBalance, remainingDue, onConfirm, resetGiftCard, showInfoPopup]);

  const openGiftCardModal = useCallback(() => {
    resetGiftCard();
    // Pre-fill pay amount with remaining due
    setGiftCardPayAmount(remainingDue.toFixed(2));
    setShowGiftCardModal(true);
  }, [resetGiftCard, remainingDue]);
  
	// Reset keypad display when opening or when prefill is requested
	useEffect(() => {
		if (!isOpen) return;
		setAmount('0.00');
	}, [isOpen]);

useEffect(() => {
		if (!isOpen) return;
    if (typeof prefillDueNonce === 'number') {
			try {
				// Initialize with zero so Due shows full remaining amount; user can tap Due to autofill
				setAmount('0.00');
        setInputTarget('AMOUNT');
			} catch {}
		}
	}, [prefillDueNonce, isOpen]);

// Prefill with remaining due (ALL scope) once when requested (from SplitBillModal Pay in Full)
useEffect(() => {
    if (!isOpen) return;
    if (typeof prefillUseTotalOnceNonce === 'number' && showAllButton) {
        try {
            // Force ALL mode and prefill amount ONLY (do not auto-commit)
            setForceAllMode(true);
            try { if (onSelectGuestMode) onSelectGuestMode('ALL'); } catch {}
            // Show remaining in Due, but keep keypad display at 0 (no auto-input)
            setRawAmountDigits('');
            setAmount('0.00');
            // Leave method unset so user can choose; no commit here
        } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
}, [prefillUseTotalOnceNonce, isOpen, showAllButton]);

// 디스플레이 초기화: 모달 열림/게스트 스코프 변경 시에만 초기화
// 결제 수단 변경 시에는 금액을 유지하여 복합 결제 지원
useEffect(() => {
  if (!isOpen) return;
  if (skipAmountResetRef.current) {
    skipAmountResetRef.current = false;
    return;
  }
  try {
    setRawAmountDigits('');
    setAmount('0.00');
    setInputTarget('AMOUNT');
  } catch {}
}, [isOpen, effectiveGuestMode]);

// When discount changes, reset Pay amount to 0 so user enters the amount manually.
// Due $ automatically reflects the discounted total via `grand` (pricingEffective.total).
useEffect(() => {
  if (!isOpen) return;
  setRawAmountDigits('');
  setAmount('0.00');
  setInputTarget('AMOUNT');
  setLastChange(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [selectedDiscountPercent]);

  const tetraBridgeActiveRef = useRef(false);
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const active = await loadTetraBridgeReady(API_URL);
        if (!cancelled) tetraBridgeActiveRef.current = active;
      } catch {
        if (!cancelled) tetraBridgeActiveRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const confirmPaymentWithOptionalTetra = useCallback(
    async (effectiveMethod: string, finalAmount: number, t: number, grand: number) => {
      const payload: {
        method: string;
        amount: number;
        tip: number;
        discountedGrand: number;
        terminalRef?: string;
      } = {
        method: effectiveMethod,
        amount: parseFloat(finalAmount.toFixed(2)),
        tip: parseFloat(t.toFixed(2)),
        discountedGrand: grand,
      };
      if (isCardPaymentMethod(effectiveMethod) && tetraBridgeActiveRef.current) {
        const totalCents = Math.round((finalAmount + t) * 100);
        const invoice = `W${Date.now()}`.slice(-15);
        const ref = await purchaseOnTetraTerminal(API_URL, totalCents, invoice);
        if (ref) payload.terminalRef = ref;
      }
      await onConfirm(payload);
    },
    [onConfirm]
  );

  // Removed auto-commit: 결제도구/금액 조합은 OK 시점에만 확정

  const finalizeAndComplete = async () => {
    // canClickOk 조건 확인: (Next 단계) 또는 (금액>0 && 결제도구 선택됨) 또는 (잔액≈0) 또는 (cashReadyForOk)
    if (!canClickOk) return;
    // 더블 클릭 방지
    if (isProcessing) {
      console.log('⚠️ Payment already processing, ignoring duplicate click');
      return;
    }
    try {
      // === cashReadyForOk 상태: 사용자가 Tip/Change Due 입력 후 OK를 눌렀을 때 최종 확정 ===
      if (cashReadyForOk && cashReadyDataRef.current) {
        const { rawAmt, scopeDueNow, effectiveMethod, isFinalizeFlow } = cashReadyDataRef.current;
        const savedChangeDueDigits = changeDueDigits;
        const rawTip = parsedTip;
        setIsProcessing(true);
        let finalAmount = Math.min(rawAmt, scopeDueNow);
        let t = rawTip;
        if (savedChangeDueDigits && String(effectiveMethod || '').toUpperCase() === 'CASH') {
          const totalChange = Math.max(0, Number((rawAmt - scopeDueNow).toFixed(2)));
          const changeDueVal = parseInt(savedChangeDueDigits, 10) / 100;
          const clampedChangeDue = Math.min(changeDueVal, totalChange);
          t = Number((totalChange - clampedChangeDue).toFixed(2));
          setLastChange(clampedChangeDue > 0 ? clampedChangeDue : null);
          committedChangeRef.current = clampedChangeDue;
        } else {
          const nextChange = Math.max(0, Number((rawAmt - scopeDueNow - t).toFixed(2)));
          setLastChange(nextChange > 0 ? nextChange : null);
          committedChangeRef.current = nextChange;
        }
        const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
        const displayAmount = Number((finalAmount + t).toFixed(2));
        setOptimisticPayments(prev => [...prev, { tempId, method: effectiveMethod, amount: finalAmount, tip: t, displayAmount }]);
        setRawAmountDigits('');
        await confirmPaymentWithOptionalTetra(effectiveMethod, finalAmount, t, grand);
        setOptimisticPayments(prev => prev.filter(p => p.tempId !== tempId));
        setAmount('0.00');
        setTip('0');
        setMethod('');
        setInputTarget('AMOUNT');
        setIsTipFocused(false);
        setChangeDueDigits('');
        setIsProcessing(false);
        setCashReadyForOk(false);
        cashReadyDataRef.current = null;

        if (onPaymentComplete) {
          const cashDisplayAmt = rawAmt > 0 ? rawAmt : Number((finalAmount + t).toFixed(2));
          const prevPayments = (payments || []).map(p => ({ method: p.method, amount: p.amount }));
          const allPayments = [...prevPayments, { method: effectiveMethod, amount: cashDisplayAmt }];
          const hasCash = allPayments.some(p => (p.method || '').toUpperCase() === 'CASH');
          let currentChange: number;
          const isCashMethod = String(effectiveMethod || '').toUpperCase() === 'CASH';
          if (savedChangeDueDigits && isCashMethod) {
            const totalOverpay = Math.max(0, rawAmt - scopeDueNow);
            const changeDueVal = parseInt(savedChangeDueDigits, 10) / 100;
            currentChange = Math.min(changeDueVal, totalOverpay);
          } else if (isCashMethod) {
            currentChange = Math.max(0, rawAmt - scopeDueNow - t);
          } else {
            currentChange = committedChangeRef.current > 0 ? committedChangeRef.current : 0;
          }
          const totalTip = (payments || []).reduce((sum, p) => sum + ((p as any).tip || 0), 0) + t;
          const totalPaidAfter = (paidSoFar || 0) + finalAmount;
          const isPartial = Math.abs(totalPaidAfter - grand) > 0.01;
          onPaymentComplete({
            change: currentChange,
            total: grand,
            tip: totalTip,
            payments: allPayments,
            hasCashPayment: hasCash,
            isPartialPayment: isPartial,
            discount: pricingEffective.discountPercent > 0 ? {
              percent: pricingEffective.discountPercent,
              amount: pricingEffective.discountAmount,
              originalSubtotal: pricingEffective.baseSubtotal,
              discountedSubtotal: pricingEffective.subtotal,
              taxLines: pricingEffective.taxLines,
              taxesTotal: pricingEffective.taxesTotal,
            } : undefined,
          });
        }
        return;
      }

      // === 일반 결제 흐름 ===
      const rawAmt = parsedAmount;
      const rawTip = parsedTip;
      const savedChangeDueDigits = changeDueDigits;
      if (rawAmt > 0 || rawTip > 0) {
        const effectiveMethod = (method || (rawTip > 0 ? lastFoodPaymentMethod : '') || '').toUpperCase();
        if (!effectiveMethod) { showAlert('Please select a payment method.'); return; }
        setIsProcessing(true);
        const confirmedTotalNow = Number(((cashPaidConfirmed + nonCashPaidConfirmed)).toFixed(2));
        let scopeDueNow: number;
        if (onCreateAdhocGuests && isSplitActive && splitNActive >= 2) {
          const grandCents = Math.round(grand * 100);
          const guestIdx = typeof effectiveGuestMode === 'number' ? effectiveGuestMode : 1;
          scopeDueNow = Math.max(0, Number((calcFairShare(grandCents, splitNActive, guestIdx) - confirmedTotalNow).toFixed(2)));
        } else {
          scopeDueNow = Math.max(0, Number((grand - confirmedTotalNow).toFixed(2)));
        }
        const isCashMethod = effectiveMethod === 'CASH';
        const isCashLikeMethod = isCashMethod;

        // Cash/Card: 결제 금액이 Due 이상이면 대기 상태로 전환 (Tip 입력 기회 제공 — OK 누르기 전까지 Payment Complete로 가지 않음)
        if (isCashLikeMethod && rawAmt >= scopeDueNow && scopeDueNow > 0) {
          const cashChange = Math.max(0, Number((rawAmt - scopeDueNow).toFixed(2)));
          setLastChange(cashChange > 0 ? cashChange : null);
          committedChangeRef.current = cashChange;
          changeDueTotalRef.current = cashChange;
          setCashReadyForOk(true);
          cashReadyDataRef.current = { rawAmt, scopeDueNow, effectiveMethod, isFinalizeFlow: true };
          setIsProcessing(false);
          return;
        }

        let finalAmount: number;
        let t: number;
        const cardOverpayToTip =
          !isCashLikeMethod && isCardPaymentMethod(effectiveMethod) && rawAmt > scopeDueNow + 0.0005;

        if (isCashLikeMethod) {
          finalAmount = Math.min(rawAmt, scopeDueNow);
          t = rawTip;
        } else if (cardOverpayToTip) {
          finalAmount = Number(scopeDueNow.toFixed(2));
          t = Number((rawTip + Math.max(0, rawAmt - scopeDueNow)).toFixed(2));
        } else {
          finalAmount = Math.min(rawAmt, scopeDueNow);
          t = rawTip;
        }
        if (savedChangeDueDigits && isCashMethod) {
          const totalChange = Math.max(0, Number((rawAmt - scopeDueNow).toFixed(2)));
          const changeDueVal = parseInt(savedChangeDueDigits, 10) / 100;
          const clampedChangeDue = Math.min(changeDueVal, totalChange);
          t = Number((totalChange - clampedChangeDue).toFixed(2));
          setLastChange(clampedChangeDue > 0 ? clampedChangeDue : null);
          committedChangeRef.current = clampedChangeDue;
        } else if (isCashMethod) {
          const nextChange = Math.max(0, Number((rawAmt - scopeDueNow - t).toFixed(2)));
          setLastChange(nextChange > 0 ? nextChange : null);
          committedChangeRef.current = nextChange;
        } else {
          setLastChange(null);
          committedChangeRef.current = 0;
        }
        const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
        const displayAmount = Number((finalAmount + t).toFixed(2));
        setOptimisticPayments(prev => [...prev, { tempId, method: effectiveMethod, amount: finalAmount, tip: t, displayAmount }]);
        setRawAmountDigits('');
        await confirmPaymentWithOptionalTetra(effectiveMethod, finalAmount, t, grand);
        setOptimisticPayments(prev => prev.filter(p => p.tempId !== tempId));
        if (!isCashLikeMethod && rawAmt > finalAmount + 0.0005 && !cardOverpayToTip) {
          const upper = String(effectiveMethod || '').toUpperCase();
          if (upper === 'GIFT' || upper === 'COUPON' || upper === 'OTHER') {
            showInfoPopup('Overcharging is not allowed');
          } else {
            showClampPopup(rawAmt, finalAmount, effectiveMethod);
          }
        }
        setAmount('0.00');
        setTip('0');
        setMethod('');
        setInputTarget('AMOUNT');
        setIsTipFocused(false);
        setChangeDueDigits('');
        setIsProcessing(false);
        
        // 카드 부분결제는 잔액이 남아야 하므로 실제 남은 Due를 그대로 사용한다.
        const remainingAfterPayment = scopeDueNow - finalAmount;
        
        if (Math.abs(remainingAfterPayment) < 0.005 && onPaymentComplete) {
          const displayAmount = isCashLikeMethod
            ? (rawAmt > 0 ? rawAmt : Number((finalAmount + t).toFixed(2)))
            : Number((finalAmount + t).toFixed(2));
          const prevPayments = (payments || []).map(p => ({ method: p.method, amount: p.amount }));
          const allPayments = [...prevPayments, { method: effectiveMethod, amount: displayAmount }];
          const hasCash = allPayments.some(p => (p.method || '').toUpperCase() === 'CASH');
          let currentChange: number;
          const prevHasCash = (payments || []).some(p => (p.method || '').toUpperCase() === 'CASH');
          if (savedChangeDueDigits && isCashMethod) {
            const totalOverpay = Math.max(0, rawAmt - scopeDueNow);
            const changeDueVal = parseInt(savedChangeDueDigits, 10) / 100;
            currentChange = Math.min(changeDueVal, totalOverpay);
          } else if (isCashMethod) {
            currentChange = Math.max(0, rawAmt - scopeDueNow - t);
          } else if (prevHasCash && hasCash) {
            currentChange = lastChange != null && lastChange > 0 ? lastChange : 0;
          } else {
            currentChange = 0;
          }
          const totalTip = (payments || []).reduce((sum, p) => sum + ((p as any).tip || 0), 0) + t;
          const totalPaidAfter = (paidSoFar || 0) + finalAmount;
          const isPartial = Math.abs(totalPaidAfter - grand) > 0.01;
          onPaymentComplete({
            change: currentChange,
            total: grand,
            tip: totalTip,
            payments: allPayments,
            hasCashPayment: hasCash,
            isPartialPayment: isPartial,
            discount: pricingEffective.discountPercent > 0 ? {
              percent: pricingEffective.discountPercent,
              amount: pricingEffective.discountAmount,
              originalSubtotal: pricingEffective.baseSubtotal,
              discountedSubtotal: pricingEffective.subtotal,
              taxLines: pricingEffective.taxLines,
              taxesTotal: pricingEffective.taxesTotal,
            } : undefined,
          });
          return;
        }
      } else if (canComplete || (splitGuestAwaitingOkForReceiptRef.current && !cashReadyForOk)) {
        if (splitGuestAwaitingOkForReceiptRef.current) {
          splitGuestAwaitingOkForReceiptRef.current = false;
        }
        // 별도 Payment Complete 모달 표시
        if (onPaymentComplete) {
          const paymentsData = (payments || []).map(p => ({ method: p.method, amount: p.amount }));
          const hasCash = paymentsData.some(p => (p.method || '').toUpperCase() === 'CASH');
          let currentChange = committedChangeRef.current > 0
            ? committedChangeRef.current
            : (lastChange != null ? lastChange : change);
          if (savedChangeDueDigits && hasCash) {
            currentChange = parseInt(savedChangeDueDigits, 10) / 100;
          }
          const totalTip = (payments || []).reduce((sum, p) => sum + ((p as any).tip || 0), 0);
          const totalPaid = paymentsData.reduce((sum, p) => sum + (p.amount || 0), 0);
          const isPartial = Math.abs(totalPaid - grand) > 0.01;
          onPaymentComplete({
            change: currentChange > 0 ? currentChange : 0,
            total: grand,
            tip: totalTip,
            payments: paymentsData,
            hasCashPayment: hasCash,
            isPartialPayment: isPartial,
            discount: pricingEffective.discountPercent > 0 ? {
              percent: pricingEffective.discountPercent,
              amount: pricingEffective.discountAmount,
              originalSubtotal: pricingEffective.baseSubtotal,
              discountedSubtotal: pricingEffective.subtotal,
              taxLines: pricingEffective.taxLines,
              taxesTotal: pricingEffective.taxesTotal,
            } : undefined,
          });
        } else {
          setProceedArmed(true);
        }
      }
    } catch (e) {
      setOptimisticPayments(prev => prev.slice(0, -1));
      setAmount('0.00');
      setRawAmountDigits('');
      setMethod('');
      setInputTarget('AMOUNT');
      setIsTipFocused(false);
      setIsProcessing(false);
      setCashReadyForOk(false);
      cashReadyDataRef.current = null;
      showAlert(e instanceof Error && e.message ? e.message : 'Payment failed. Please try again.');
      try { console.error('Finalize failed', e); } catch {}
    }
  };

	const proceedNext = () => {
		if (onComplete) onComplete(selectedReceiptCount);
	};


	
	const formatMoney = (n: number) => new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

	const formatInput = (v: string) => {
		const num = parseFloat(v || '0');
		return isNaN(num) ? '' : new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
	};
	const unformatInput = (v: string) => v.replace(/,/g, '');



	const getMethodLabel = (key: string) => {
		const found = methods.find(m => m.key === key);
		return found ? found.label : key;
	};

  const paidTotal = useMemo(() => {
    // 게스트별 독립 스코프: 선택된 게스트(effectiveGuestMode)의 확정 결제만 합산
    if (Array.isArray(payments)) {
      const mode = effectiveGuestMode;
      const scoped = (typeof mode === 'number') ? payments.filter(p => p.guestNumber === mode) : payments;
      // Paid $는 "음식값(food portion)"만 합산: amount - tip
      const sum = scoped.reduce((s, p:any) => s + ((p.amount || 0) - ((p as any).tip || 0)), 0);
      return Number(sum.toFixed(2));
    }
    if (typeof paidSoFar === 'number') return Number(paidSoFar.toFixed(2));
    if (typeof outstandingDue === 'number') return Number((grand - outstandingDue).toFixed(2));
    return 0;
  }, [payments, paidSoFar, outstandingDue, grand, effectiveGuestMode]);
  // Paid $ 합계는 확정 결제만 합산 (Processing/optimistic 제외)
  const displayPaidTotal = useMemo(() => parseFloat(((paidTotal)).toFixed(2)), [paidTotal]);
  const isSplitActive = useMemo(() => (typeof effectiveGuestMode === 'number') || ((guestCount || 0) > 1), [effectiveGuestMode, guestCount]);
	// 게스트 수만큼 버튼 표시 (8명 상한 제거 — 8명 이상도 스크롤로 전부 표기)
	const maxGuestButtons = useMemo(() => {
		if (typeof guestCount === 'number' && guestCount >= 1) return guestCount;
		return 8;
	}, [guestCount]);

	// Due·금액(표시/키패드/퀵)·결제도구·Gift·Split Bill·Cash 대기·Change Due 입력·기결제 입력 후 → 할인·1/N 분할·Split 버튼 비활성
	const freezeDiscountAndSplit = useMemo(() => {
		if (showGiftCardModal) return true;
		if (cashReadyForOk) return true;
		if (splitBillLaunchTouched) return true;
		if (typeof method === 'string' && method.trim() !== '') return true;
		if (rawAmountDigits.length > 0) return true;
		const pa = parseFloat(String(amount ?? '0'));
		if (Number.isFinite(pa) && pa > 0.0001) return true;
		const payList = Array.isArray(payments) ? payments : [];
		const scopedPayLen =
			typeof effectiveGuestMode === 'number'
				? payList.filter((p: { guestNumber?: number }) => Number(p?.guestNumber) === Number(effectiveGuestMode)).length
				: payList.length;
		if (scopedPayLen > 0) return true;
		if (optimisticPayments.length > 0) return true;
		if (String(changeDueDigits || '').length > 0) return true;
		return false;
	}, [
		showGiftCardModal,
		cashReadyForOk,
		splitBillLaunchTouched,
		method,
		rawAmountDigits,
		amount,
		payments,
		effectiveGuestMode,
		optimisticPayments.length,
		changeDueDigits,
	]);

	// Change calculation based on confirmed payments across methods
	const paymentsInScope = useMemo(() => {
		if (!Array.isArray(payments)) return [] as Array<{ paymentId: number; method: string; amount: number; tip: number; guestNumber?: number }>;
		if (typeof effectiveGuestMode === 'number') {
			return payments.filter(p => p.guestNumber === effectiveGuestMode);
		}
		return payments;
	}, [payments, effectiveGuestMode]);

  const tipPaidConfirmed = useMemo(() => {
    try {
      return Number(paymentsInScope.reduce((s, p: any) => s + ((p as any).tip || 0), 0).toFixed(2));
    } catch {
      return 0;
    }
  }, [paymentsInScope]);

  const lastFoodPaymentMethod = useMemo(() => {
    try {
      for (let i = paymentsInScope.length - 1; i >= 0; i--) {
        const p: any = paymentsInScope[i];
        const foodPortion = (p.amount || 0) - (p.tip || 0);
        if (foodPortion > 0.0001 && p.method) return String(p.method);
      }
      // fallback: last payment method (even if tip-only)
      for (let i = paymentsInScope.length - 1; i >= 0; i--) {
        const p: any = paymentsInScope[i];
        if (p?.method) return String(p.method);
      }
      return '';
    } catch {
      return '';
    }
  }, [paymentsInScope]);

	const { cashPaidConfirmed, nonCashPaidConfirmed } = useMemo(() => {
		let cash = 0, nonCash = 0;
		paymentsInScope.forEach(p => {
			// amount에서 tip을 빼서 음식값(food portion)만 합산 → Due 계산 정확도 보장
			const foodPortion = (p.amount || 0) - ((p as any).tip || 0);
			if ((p.method || '').toUpperCase() === 'CASH') cash += foodPortion;
			else nonCash += foodPortion;
		});
		return { cashPaidConfirmed: parseFloat(cash.toFixed(2)), nonCashPaidConfirmed: parseFloat(nonCash.toFixed(2)) };
	}, [paymentsInScope]);

  const handleClearPaidBox = useCallback(async () => {
    try {
      if (isClearingPaidBox) return;
      const scoped = Array.isArray(paymentsInScope) ? paymentsInScope : [];
      const ids = scoped.map(p => p.paymentId).filter((id: any) => typeof id === 'number' && Number.isFinite(id));

      setIsClearingPaidBox(true);
      try {
        // 1) Void/clear confirmed payments (prefer scope clear in split mode)
        if (ids.length > 0) {
          if (typeof effectiveGuestMode === 'number') {
            if (typeof onClearScopedPayments === 'function') {
              await Promise.resolve(onClearScopedPayments(ids));
            } else if (typeof onClearAllPayments === 'function') {
              await Promise.resolve(onClearAllPayments());
            }
          } else {
            if (typeof onClearAllPayments === 'function') {
              await Promise.resolve(onClearAllPayments());
            } else if (typeof onClearScopedPayments === 'function') {
              await Promise.resolve(onClearScopedPayments(ids));
            }
          }
        }

        // 2) Reset modal-local state as if freshly opened (do not close)
        setOptimisticPayments([]);
        setAmount('0.00');
        setRawAmountDigits('');
        setTip('0');
        setMethod('');
        setIsTipFocused(false);
        setProceedArmed(false);
        setLastChange(null);
        setSelectedReceiptCount(2);
        setShowCancelConfirm(false);
        setCashReadyForOk(false);
        cashReadyDataRef.current = null;
        setSplitBillLaunchTouched(false);
        setChangeDueDigits('');
        changeDueTotalRef.current = 0;
        committedChangeRef.current = 0;
        splitGuestAwaitingOkForReceiptRef.current = false;
        setInputTarget('AMOUNT');

        // Reset auxiliary modes
        setIsSplitCountMode(false);
        setSplitCountInput('');
        setForceAllMode(false);

        // Reset Share Selected / Gift Card sub-modes
        setIsShareSelectedMode(false);
        setShareSelectedRowIndex(null);
        setShareTargetGuests(new Set());
        setShowGiftCardModal(false);
        try { resetGiftCard(); } catch {}
      } finally {
        setIsClearingPaidBox(false);
      }
    } catch (e) {
      console.error('Clear Paid$ failed:', e);
    }
  }, [paymentsInScope, effectiveGuestMode, onClearScopedPayments, onClearAllPayments, isClearingPaidBox, resetGiftCard]);

  // 방법 3: 다음 액션 시 자동 확정
  // 이전에 준비된 조합(결제 수단 + 금액)이 있으면 먼저 확정하는 헬퍼 함수
  const commitPendingIfReady = useCallback(async () => {
    if (cashReadyForOk) return;
    if (isProcessing) {
      console.log('⚠️ Payment already processing (commitPendingIfReady), ignoring');
      return;
    }
    const currentAmt = parseFloat(amount || '0') || 0;
    const currentTip = parseFloat(tip || '0') || 0;
    if (method && (currentAmt > 0 || currentTip > 0)) {
      // 준비된 조합이 있으면 확정
      // finalizeAndComplete의 로직을 직접 사용 (무한 루프 방지)
      try {
        setIsProcessing(true);  // 결제 처리 시작
        // finalizeAndComplete와 동일한 로직 사용
        const effectiveMethod = method;
        const confirmedTotalNow = Number(((cashPaidConfirmed + nonCashPaidConfirmed)).toFixed(2));
        let scopeDueNow: number;
        if (onCreateAdhocGuests && isSplitActive && splitNActive >= 2) {
          const grandCents = Math.round(grand * 100);
          const guestIdx = typeof effectiveGuestMode === 'number' ? effectiveGuestMode : 1;
          scopeDueNow = Math.max(0, Number((calcFairShare(grandCents, splitNActive, guestIdx) - confirmedTotalNow).toFixed(2)));
        } else {
          scopeDueNow = Math.max(0, Number((grand - confirmedTotalNow).toFixed(2)));
        }
        const isCashLikeMethod2 = effectiveMethod === 'CASH';
        let finalAmount: number;
        let t: number;
        const cardOverpayToTip2 =
          !isCashLikeMethod2 && isCardPaymentMethod(effectiveMethod) && currentAmt > scopeDueNow + 0.0005;

        if (isCashLikeMethod2) {
          finalAmount = Math.min(currentAmt, scopeDueNow);
          t = currentTip;
          if (changeDueDigits && effectiveMethod === 'CASH') {
            const totalChange2 = Math.max(0, Number((currentAmt - scopeDueNow).toFixed(2)));
            const changeDueVal2 = parseInt(changeDueDigits, 10) / 100;
            const clampedChangeDue2 = Math.min(changeDueVal2, totalChange2);
            t = Number((totalChange2 - clampedChangeDue2).toFixed(2));
            setLastChange(clampedChangeDue2 > 0 ? clampedChangeDue2 : null);
            committedChangeRef.current = clampedChangeDue2;
          } else {
            const nextChange = Math.max(0, Number((currentAmt - scopeDueNow - t).toFixed(2)));
            setLastChange(nextChange > 0 ? nextChange : null);
            committedChangeRef.current = nextChange;
          }
        } else if (cardOverpayToTip2) {
          finalAmount = Number(scopeDueNow.toFixed(2));
          t = Number((currentTip + Math.max(0, currentAmt - scopeDueNow)).toFixed(2));
          setLastChange(null);
        } else {
          finalAmount = Math.min(currentAmt, scopeDueNow);
          t = currentTip;
          setLastChange(null);
        }
        const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
        const displayAmount = Number((finalAmount + t).toFixed(2));
        setOptimisticPayments(prev => [...prev, { tempId, method: effectiveMethod, amount: finalAmount, tip: t, displayAmount }]);
        setRawAmountDigits('');
        await confirmPaymentWithOptionalTetra(effectiveMethod, finalAmount, t, grand);
        setOptimisticPayments(prev => prev.filter(p => p.tempId !== tempId));
        if (!isCashLikeMethod2 && currentAmt > finalAmount + 0.0005 && !cardOverpayToTip2) {
          const upper = String(effectiveMethod || '').toUpperCase();
          if (upper === 'GIFT' || upper === 'COUPON' || upper === 'OTHER') {
            showInfoPopup('Overcharging is not allowed');
          } else {
            showClampPopup(currentAmt, finalAmount, effectiveMethod);
          }
        }
        setAmount('0.00');
        setTip('0');
        setMethod('');
        setInputTarget('AMOUNT');
        setIsTipFocused(false);
        setIsProcessing(false);  // 결제 처리 완료
      } catch (e) {
        // 에러 시 optimisticPayments 정리 및 상태 초기화
        setOptimisticPayments(prev => prev.slice(0, -1));
        setAmount('0.00');
        setRawAmountDigits('');
        setMethod('');
        setInputTarget('AMOUNT');
        setIsTipFocused(false);
        setIsProcessing(false);
        showAlert(e instanceof Error && e.message ? e.message : 'Payment failed. Please try again.');
        try { console.error('Auto-commit failed', e); } catch {}
      }
    }
  }, [method, amount, tip, cashPaidConfirmed, nonCashPaidConfirmed, grand, onConfirm, confirmPaymentWithOptionalTetra, showClampPopup, showInfoPopup, onCreateAdhocGuests, isSplitActive, outstandingDue, isProcessing]);

  // Confirmed 결제를 반영해 최종 남은 금액(dueFull)과 화면 Due 값을 계산
  const due = useMemo(() => {
    if (onCreateAdhocGuests && isSplitActive && splitNActive >= 2) {
        const grandCents = Math.round(grand * 100);
        const guestIdx = typeof effectiveGuestMode === 'number' ? effectiveGuestMode : 1;
        const myShare = calcFairShare(grandCents, splitNActive, guestIdx);
        const myPaid = Number(((cashPaidConfirmed + nonCashPaidConfirmed)).toFixed(2));
        return Math.max(0, Number((myShare - myPaid - parsedAmount).toFixed(2)));
    }
    const confirmedTotal = Number(((cashPaidConfirmed + nonCashPaidConfirmed)).toFixed(2));
    const dueFull = Math.max(0, Number((grand - confirmedTotal).toFixed(2)));
    return Math.max(0, Number((dueFull - parsedAmount).toFixed(2)));
  }, [grand, cashPaidConfirmed, nonCashPaidConfirmed, parsedAmount, onCreateAdhocGuests, isSplitActive, splitNActive, effectiveGuestMode]);


  // Next는 사용자 조작으로만 진행 (자동 완료 제거)

  const currentDueRemaining = useMemo(() => {
    const confirmedTotal = Number(((cashPaidConfirmed + nonCashPaidConfirmed)).toFixed(2));
    if (onCreateAdhocGuests && isSplitActive && splitNActive >= 2) {
      const grandCents = Math.round(grand * 100);
      const guestIdx = typeof effectiveGuestMode === 'number' ? effectiveGuestMode : 1;
      const myShare = calcFairShare(grandCents, splitNActive, guestIdx);
      return Math.max(0, Number((myShare - confirmedTotal).toFixed(2)));
    }
    return Math.max(0, Number((grand - confirmedTotal).toFixed(2)));
  }, [grand, cashPaidConfirmed, nonCashPaidConfirmed, onCreateAdhocGuests, isSplitActive, splitNActive, effectiveGuestMode]);

  const change = useMemo(() => {
    // Change 표시 규칙:
    // - CASH: 실제 거스름돈(초과분) 표시
    // - CARD(DEBIT/VISA/MC/OTHER_CARD): 입력 금액이 Due를 초과하면 초과분을 Change처럼 표시 (Tap to add tip 또는 Tip 입력으로 전환 가능)
    const tipAmount = parsedTip || 0;
    const upper = String(method || '').toUpperCase();
    const isCard = ['DEBIT', 'VISA', 'MC', 'OTHER_CARD'].includes(upper);

    const confirmedTotal = Number(((cashPaidConfirmed + nonCashPaidConfirmed)).toFixed(2));
    let scopeDueNow: number;
    if (onCreateAdhocGuests && isSplitActive && splitNActive >= 2) {
      const grandCents = Math.round(grand * 100);
      const guestIdx = typeof effectiveGuestMode === 'number' ? effectiveGuestMode : 1;
      scopeDueNow = Math.max(0, Number((calcFairShare(grandCents, splitNActive, guestIdx) - confirmedTotal).toFixed(2)));
    } else {
      scopeDueNow = Math.max(0, Number((grand - confirmedTotal).toFixed(2)));
    }

    if (upper === 'CASH') {
      const projectedCash = Number(((cashPaidConfirmed + parsedAmount)).toFixed(2));
      let dueBeforeCash: number;
      if (onCreateAdhocGuests && isSplitActive && splitNActive >= 2) {
        const grandCents = Math.round(grand * 100);
        const guestIdx = typeof effectiveGuestMode === 'number' ? effectiveGuestMode : 1;
        dueBeforeCash = Math.max(0, Number((calcFairShare(grandCents, splitNActive, guestIdx) - nonCashPaidConfirmed).toFixed(2)));
      } else {
        dueBeforeCash = Math.max(0, Number((grand - nonCashPaidConfirmed).toFixed(2)));
      }
      return Math.max(0, Number((projectedCash - dueBeforeCash - tipAmount).toFixed(2)));
    }

    if (isCard) {
      return Math.max(0, Number((parsedAmount - scopeDueNow - tipAmount).toFixed(2)));
    }

    return 0;
  }, [grand, cashPaidConfirmed, nonCashPaidConfirmed, method, parsedAmount, parsedTip, onCreateAdhocGuests, isSplitActive, splitNActive, effectiveGuestMode]);

  const displayChange = useMemo(() => {
    if (lastChange == null) return change;
    return Number(((lastChange as number) || 0).toFixed(2));
  }, [lastChange, change]);

  /** Change 금액은 디스플레이 최우선 — 폭이 넓을 때는 항상 기존 최대(4.71 / 5.09rem), 좁을 때만 cqw로 축소 */
  const changeAmountDisplayString = useMemo(
    () => formatMoney(displayChange),
    [displayChange]
  );
 
  // canComplete: 잔액이 0에 충분히 근접하면 완료 가능
  const canComplete = useMemo(() => Math.abs(due) < 0.005, [due]);
  // OK 버튼 활성화 조건: (Next 단계) 또는 (금액>0 && 결제도구 선택됨) 또는 (잔액≈0)
  const canClickOk = useMemo(() => {
    if (cashReadyForOk) return true;
    const hasFoodDraft = (parsedAmount > 0) && !!method;
    const hasTipDraft = (parsedTip > 0) && !!(method || lastFoodPaymentMethod);
    return proceedArmed || hasFoodDraft || hasTipDraft || canComplete;
  }, [cashReadyForOk, proceedArmed, parsedAmount, parsedTip, method, lastFoodPaymentMethod, canComplete]);

  // Build header labels per channel
  const { headerLeftLabel, headerRightLabel, isCenterHeader } = useMemo(() => {
    const ch = (channel || '').toLowerCase();
    // Dine-In (POS/Table): show centered with table number
    if (!ch || ch === 'pos' || ch === 'table') {
      const t = String(tableName || customerName || '');
      const tagged = t.replace(/^Table\s+/i, '').trim();
      return { headerLeftLabel: (tagged ? `Dine - In - ${tagged}` : 'Dine - In'), headerRightLabel: '', isCenterHeader: true };
    }
    // QSR: For Here
    if (ch === 'forhere') {
      const name = String(customerName || tableName || '');
      return { headerLeftLabel: (name ? `For Here - ${name}` : 'For Here'), headerRightLabel: '', isCenterHeader: true };
    }
    // Togo: left 'Togo', right customer name
    if (ch === 'togo') {
      return { headerLeftLabel: 'Togo', headerRightLabel: String(customerName || tableName || ''), isCenterHeader: false };
    }
    // QSR: Pickup
    if (ch === 'pickup') {
      return { headerLeftLabel: 'Pickup', headerRightLabel: String(customerName || tableName || ''), isCenterHeader: false };
    }
    // Online: left 'Online', right customer name
    if (ch.includes('online') || ch === 'web') {
      return { headerLeftLabel: 'Online', headerRightLabel: String(customerName || tableName || ''), isCenterHeader: false };
    }
    // QSR: Delivery
    if (ch === 'delivery') {
      return { headerLeftLabel: 'Delivery', headerRightLabel: String(customerName || tableName || ''), isCenterHeader: false };
    }
    // Fallback: show channel on left, customer/table on right
    return { headerLeftLabel: String(channel || ''), headerRightLabel: String(customerName || tableName || ''), isCenterHeader: false };
  }, [channel, tableName, customerName]);
 
  // Even split (N-way) guest count mode
  // NOTE: Hooks must be above any early returns.
  const handleSplitCountConfirm = useCallback(() => {
    const count = parseInt(splitCountInput, 10);
    if (!Number.isFinite(count) || count < 2) {
      showAlert('Enter 2 or more guests');
      return;
    }
    if (count > 99) {
      showAlert('Guest count is too large');
      return;
    }
    if (onCreateAdhocGuests) {
      onCreateAdhocGuests(count);
      // Move to Guest 1 payment view immediately (parent will also force guestMode=1)
      try { setForceAllMode(false); } catch {}
      try { if (onSelectGuestMode) onSelectGuestMode(1); } catch {}
      try { setInputTarget('AMOUNT'); setIsTipFocused(false); } catch {}
      try { setAmount('0.00'); setRawAmountDigits(''); setTip('0'); setMethod(''); } catch {}
    }
    setIsSplitCountMode(false);
    setSplitCountInput('');
  }, [splitCountInput, onCreateAdhocGuests, onSelectGuestMode, showAlert]);

  const handleSplitCountCancel = useCallback(() => {
    setIsSplitCountMode(false);
    setSplitCountInput('');
  }, []);

  const openEvenSplitCountPad = useCallback(() => {
    setIsSplitCountMode(true);
    setSplitCountInput('');
    try { setInputTarget('AMOUNT'); setIsTipFocused(false); } catch {}
  }, []);

  // In split-count mode: Enter confirms, Esc cancels
  useEffect(() => {
    if (!isOpen || !isSplitCountMode) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSplitCountConfirm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleSplitCountCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, isSplitCountMode, handleSplitCountConfirm, handleSplitCountCancel]);

	if (!isOpen) return null;

	const appendDigit = async (d: string) => {
    if (isSplitCountMode) {
      let nextRaw = splitCountInput;
      if (d === 'C') nextRaw = '';
      else if (d === 'BS') nextRaw = nextRaw.slice(0, -1);
      else if (d === '00') return; // No double zero for count
      else if (d === '.') return; // No decimal for count
      else if (/^[0-9]$/.test(d)) nextRaw = nextRaw + d;
      
      // Limit realistic count
      if (nextRaw.length > 3) return;
      setSplitCountInput(nextRaw);
      return;
    }

		if (inputTarget === 'TIP') {
			// tip keeps previous behavior
			const updaterTip = (prev: string) => {
				const onlyDigits = (prev || '').replace(/[^0-9]/g, '');
				if (d === 'C') return '0';
				if (d === 'BS') {
					const chopped = onlyDigits.slice(0, -1);
					const val = chopped === '' ? 0 : parseInt(chopped, 10);
					return (val / 100).toFixed(2);
				}
				if (d === '.') return (parseInt(onlyDigits || '0', 10) / 100).toFixed(2);
				if (d === '00') { const val = parseInt(onlyDigits || '0', 10) * 100; return (val / 100).toFixed(2); }
				if (!/^[0-9]$/.test(d)) return (parseInt(onlyDigits || '0', 10) / 100).toFixed(2);
				const appended = (onlyDigits + d).replace(/^0+(\d)/, '$1');
				const val = parseInt(appended, 10);
				return (val / 100).toFixed(2);
			};
      setLastChange(null);
			setTip(updaterTip);
			return;
		}
    if (inputTarget === 'DISCOUNT') {
      // Discount percent input (integer 1..100)
      let nextRaw = customDiscountDigits;
      if (d === 'C') nextRaw = '';
      else if (d === 'BS') nextRaw = nextRaw.slice(0, -1);
      else if (d === '00') nextRaw = (nextRaw + '00').replace(/^0+(\d)/, '$1');
      else if (d === '.') return; // no decimals
      else if (/^[0-9]$/.test(d)) nextRaw = (nextRaw + d).replace(/^0+(\d)/, '$1');
      if (nextRaw.length > 3) return;
      const n = nextRaw === '' ? NaN : Number(nextRaw);
      if (Number.isFinite(n) && n > 100) nextRaw = '100';
      setCustomDiscountDigits(nextRaw);
      setLastChange(null);
      return;
    }
    if (inputTarget === 'SPLIT_N') {
      let nextRaw = splitNCustomDigits;
      if (d === 'C') nextRaw = '';
      else if (d === 'BS') nextRaw = nextRaw.slice(0, -1);
      else if (d === '00') return;
      else if (d === '.') return;
      else if (/^[0-9]$/.test(d)) nextRaw = (nextRaw + d).replace(/^0+(\d)/, '$1');
      if (nextRaw.length > 3) return;
      setSplitNCustomDigits(nextRaw);
      const n = parseInt(nextRaw, 10);
      if (Number.isFinite(n) && n >= 2) {
        setSplitNActive(n);
      } else {
        setSplitNActive(0);
      }
      setLastChange(null);
      return;
    }
    if (inputTarget === 'CHANGE_DUE') {
      let nextRaw = changeDueDigits;
      if (d === 'C') nextRaw = '';
      else if (d === 'BS') nextRaw = nextRaw.slice(0, -1);
      else if (d === '00') nextRaw = (nextRaw + '00').replace(/^0+(\d)/, '$1');
      else if (d === '.') return;
      else if (/^[0-9]$/.test(d)) nextRaw = (nextRaw + d).replace(/^0+(\d)/, '$1');
      if (nextRaw.length > 6) return;
      const cents = nextRaw === '' ? 0 : parseInt(nextRaw, 10);
      const changeDueVal = cents / 100;
      const maxChange = changeDueTotalRef.current;
      if (changeDueVal > maxChange) {
        nextRaw = String(Math.round(maxChange * 100));
      }
      setChangeDueDigits(nextRaw);
      const finalChangeDue = nextRaw === '' ? 0 : parseInt(nextRaw, 10) / 100;
      const autoTip = Number((maxChange - finalChangeDue).toFixed(2));
      setTip(autoTip > 0 ? autoTip.toFixed(2) : '0');
      setLastChange(finalChangeDue > 0 ? finalChangeDue : null);
      return;
    }
		// 숫자 버튼은 단순히 금액 입력만 함
		// cashReadyForOk 모드: amount 입력은 무시 (Tip/Change Due만 입력 가능)
		if (cashReadyForOk && inputTarget === 'AMOUNT') return;
		// amount: maintain raw cents buffer to avoid premature formatting issues
		let nextRaw = rawAmountDigits;
		if (d === 'C') nextRaw = '';
		else if (d === 'BS') nextRaw = nextRaw.slice(0, -1);
		else if (d === '00') nextRaw = (nextRaw + '00').replace(/^0+(\d)/, '$1');
		else if (/^[0-9]$/.test(d)) nextRaw = (nextRaw + d).replace(/^0+(\d)/, '$1');
		// '.' is ignored because we use implicit cents
    setLastChange(null);
		setRawAmountDigits(nextRaw);
		const cents = nextRaw === '' ? 0 : parseInt(nextRaw, 10);
		const next = (cents / 100).toFixed(2);
		setAmount(next);

	};

const addQuick = async (q: number) => {
    if (isSplitCountMode) return;
    if (inputTarget === 'SPLIT_N') return;
    if (inputTarget === 'CHANGE_DUE') return;
    if (cashReadyForOk && inputTarget === 'AMOUNT') return;
    if (inputTarget === 'TIP') {
        setLastChange(null);
        setTip(prev => (parseFloat(prev || '0') + q).toFixed(2));
        return;
    }
    if (inputTarget === 'DISCOUNT') {
      return;
    }
    // 금액 버튼은 단순히 현재 금액에 합산만 함
    // 결제 수단 선택 시 확정됨 (commitPendingIfReady 제거)
    const current = parseFloat(amount || '0') || 0;
    const next = Math.max(0, parseFloat((current + q).toFixed(2)));
    const cents = Math.round(next * 100);
    setLastChange(null);
    setRawAmountDigits(String(cents));
    setAmount(next.toFixed(2));
    // 결제 수단은 사용자가 선택한 것을 유지
};

	const handleTipChange = (raw: string) => {
    // Manual touch input should behave like a normal money field:
    // typing "5" means $5.00 (not $0.05). Keep max 2 decimals.
    const s = String(raw ?? '');
    const cleaned = s.replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    const integerPart = parts[0] ?? '';
    const decimalPart = parts[1] ?? '';
    if (parts.length > 2) return;
    const next = parts.length === 2
      ? `${integerPart}.${decimalPart.slice(0, 2)}`
      : integerPart;
    setLastChange(null);
    setInputTarget('TIP');
    setTip(next);
	};

	// Explicitly fill display with remaining due (no commit) when user taps Due
	const handleFillDue = async () => {
		if (cashReadyForOk) return;
		await commitPendingIfReady();
    const confirmedTotal = Number(((cashPaidConfirmed + nonCashPaidConfirmed)).toFixed(2));
    let dueFoodFull: number;
    if (onCreateAdhocGuests && isSplitActive && splitNActive >= 2) {
      const grandCents = Math.round(grand * 100);
      const guestIdx = typeof effectiveGuestMode === 'number' ? effectiveGuestMode : 1;
      dueFoodFull = Math.max(0, Number((calcFairShare(grandCents, splitNActive, guestIdx) - confirmedTotal).toFixed(2)));
    } else {
      dueFoodFull = Math.max(0, Number((grand - confirmedTotal).toFixed(2)));
    }
		const remaining = Math.max(0, Number(dueFoodFull.toFixed(2)));
		const cents = Math.round(remaining * 100);
    setLastChange(null);
    setInputTarget('AMOUNT');
		setRawAmountDigits(String(cents));
		setAmount(remaining.toFixed(2));
		// 결제 수단은 현재 선택된 것을 유지 (forceCashMethod 제거)
		// 사용자가 선택한 결제 수단과 금액을 매칭
	};


// (moved up) — removed duplicate block


	// Cancel: 확인 후 void all session payments, reset local state, close
	const handleCancelClick = () => {
		// 결제 내역이 있으면 확인 팝업 표시
		const hasPayments = (payments && payments.length > 0) || optimisticPayments.length > 0;
		if (hasPayments) {
			setShowCancelConfirm(true);
		} else {
			// 결제 내역이 없으면 바로 닫기
			handleCancelConfirmed();
		}
	};

	const handleCancelConfirmed = async () => {
		setShowCancelConfirm(false);
		try {
			if (onClearAllPayments) {
				await onClearAllPayments();
			}
		} catch (e) {
			try { console.error('Cancel failed to clear payments', e); } catch {}
		} finally {
			setOptimisticPayments([]);
			setAmount('0.00');
			setTip('0');
			setMethod('');
			setRawAmountDigits('');
			setLastChange(null);
			setCashReadyForOk(false);
			cashReadyDataRef.current = null;
			splitGuestAwaitingOkForReceiptRef.current = false;
			onClose();
		}
	};

	const handleCancelDismiss = () => {
		setShowCancelConfirm(false);
	};


	const commitDraft = async (clickedMethod?: string) => {
		try {
			if (!clickedMethod) {
				setMethod('');
				setRawAmountDigits('');
				setAmount('0.00');
        setInputTarget('AMOUNT');
        setIsTipFocused(false);
				return;
			}

      if (cashReadyForOk) return;

      if (inputTarget === 'TIP') {
        setMethod(clickedMethod);
        return;
      }

      if (inputTarget === 'SPLIT_N' && splitNActive >= 2) {
        if (onCreateAdhocGuests) {
          onCreateAdhocGuests(splitNActive);
          try { setForceAllMode(false); } catch {}
          try { if (onSelectGuestMode) onSelectGuestMode(1); } catch {}
        }
        setAmount('0.00'); setRawAmountDigits('');
        setTip('0'); setMethod('');
        setInputTarget('AMOUNT'); setSplitNCustomMode(false);
        return;
      }
			
			const currentAmt = parseFloat(amount || '0') || 0;
      const currentTip = parseFloat(tip || '0') || 0;
			
			if (currentAmt > 0 || currentTip > 0) {
				if (isProcessing) {
					console.log('⚠️ Payment already processing (commitDraft), ignoring');
					return;
				}
				setIsProcessing(true);
				const effectiveMethod = method || clickedMethod;
				
				const confirmedTotalNow = Number(((cashPaidConfirmed + nonCashPaidConfirmed)).toFixed(2));
				let scopeDueNow: number;
				if (onCreateAdhocGuests && isSplitActive && splitNActive >= 2) {
					const grandCents = Math.round(grand * 100);
					const guestIdx = typeof effectiveGuestMode === 'number' ? effectiveGuestMode : 1;
					scopeDueNow = Math.max(0, Number((calcFairShare(grandCents, splitNActive, guestIdx) - confirmedTotalNow).toFixed(2)));
				} else {
					scopeDueNow = Math.max(0, Number((grand - confirmedTotalNow).toFixed(2)));
				}
				
        const isCashMethodDraft = String(effectiveMethod || '').toUpperCase() === 'CASH';
        const isCashLikeMethodDraft = isCashMethodDraft;

        // Cash/Card: 결제 금액이 Due 이상이면 대기 상태로 전환 (Tip 입력 기회 제공 — OK 누르기 전까지 Payment Complete로 가지 않음)
        if (isCashLikeMethodDraft && currentAmt >= scopeDueNow && scopeDueNow > 0) {
          const cashChange = Math.max(0, Number((currentAmt - scopeDueNow).toFixed(2)));
          setLastChange(cashChange > 0 ? cashChange : null);
          committedChangeRef.current = cashChange;
          changeDueTotalRef.current = cashChange;
          setMethod(effectiveMethod);
          setCashReadyForOk(true);
          cashReadyDataRef.current = { rawAmt: currentAmt, scopeDueNow, effectiveMethod, isFinalizeFlow: false };
          setIsProcessing(false);
          return;
        }

				const parsedTipVal = currentTip;
        const cardOverpayToTipDraft =
          !isCashLikeMethodDraft && isCardPaymentMethod(effectiveMethod) && currentAmt > scopeDueNow + 0.0005;
        let finalAmount: number;
        let tipToSend: number;
        if (cardOverpayToTipDraft) {
          finalAmount = Number(scopeDueNow.toFixed(2));
          tipToSend = Number((parsedTipVal + Math.max(0, currentAmt - scopeDueNow)).toFixed(2));
        } else {
          finalAmount = Math.min(currentAmt, scopeDueNow);
          tipToSend = parsedTipVal;
        }

        if (changeDueDigits && isCashMethodDraft) {
          const totalChange = Math.max(0, Number((currentAmt - scopeDueNow).toFixed(2)));
          const changeDueVal = parseInt(changeDueDigits, 10) / 100;
          const clampedChangeDue = Math.min(changeDueVal, totalChange);
          tipToSend = Number((totalChange - clampedChangeDue).toFixed(2));
          setLastChange(clampedChangeDue > 0 ? clampedChangeDue : null);
          committedChangeRef.current = clampedChangeDue;
        } else if (isCashLikeMethodDraft) {
          const nextChange = Math.max(0, Number((currentAmt - scopeDueNow - tipToSend).toFixed(2)));
          setLastChange(nextChange > 0 ? nextChange : null);
          committedChangeRef.current = nextChange;
        } else {
          setLastChange(null);
          committedChangeRef.current = 0;
        }
				const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
				
        const displayAmount = Number((finalAmount + tipToSend).toFixed(2));
				setOptimisticPayments(prev => [...prev, { tempId, method: effectiveMethod, amount: finalAmount, tip: tipToSend, displayAmount }]);
				
				await confirmPaymentWithOptionalTetra(effectiveMethod, finalAmount, tipToSend, grand);
				
				setOptimisticPayments(prev => prev.filter(p => p.tempId !== tempId));
				
        if (!isCashLikeMethodDraft && currentAmt > finalAmount + 0.0005 && !cardOverpayToTipDraft) {
          const upper = String(effectiveMethod || '').toUpperCase();
          if (upper === 'GIFT' || upper === 'COUPON' || upper === 'OTHER') {
            showInfoPopup('Overcharging is not allowed');
          } else {
            showClampPopup(currentAmt, finalAmount, effectiveMethod);
          }
        }
				
				setAmount('0.00');
				setRawAmountDigits('');
				setTip('0');
        setInputTarget('AMOUNT');
        setIsTipFocused(false);
        setChangeDueDigits('');
				if (effectiveMethod === clickedMethod) {
					setMethod('');
				} else {
					setMethod(clickedMethod);
				}
				setIsProcessing(false);

        const remainingDraft = scopeDueNow - finalAmount;
        if (
          onCreateAdhocGuests &&
          isSplitActive &&
          splitNActive >= 2 &&
          typeof effectiveGuestMode === 'number' &&
          Math.abs(remainingDraft) < 0.005
        ) {
          splitGuestAwaitingOkForReceiptRef.current = true;
        }
        // Payment Complete(onPaymentComplete)는 OK(finalizeAndComplete)에서만 호출 — 결제수단 클릭(commitDraft)만으로는 열지 않음
			} else {
				setMethod(clickedMethod);
			}
		} catch (e) {
			setOptimisticPayments(prev => prev.slice(0, -1));
			setAmount('0.00');
			setRawAmountDigits('');
			setMethod('');
      setInputTarget('AMOUNT');
      setIsTipFocused(false);
			setIsProcessing(false);
			showAlert('Payment failed. Please try again.');
			try { console.error('Failed to commit draft payment', e); } catch {}
		}
	};

	return createPortal(
		<div
			className={`fixed inset-0 ${zIndexClassName || 'z-50'} flex items-start justify-center`}
			style={{
				paddingTop: '103px',
				backgroundColor: 'rgba(0, 0, 0, 0.55)',
				WebkitBackdropFilter: 'none',
				backdropFilter: 'none',
			}}
		>
			<div className="rounded-2xl p-0 overflow-hidden relative border-0" onClick={(e) => e.stopPropagation()} style={{ width: '960px', height: 'min(755px, calc(100vh - 16px))', transform: (typeof offsetTopPx === 'number' && offsetTopPx !== 0) ? `translateY(-${offsetTopPx}px)` : undefined, ...PAY_NEO.modalShell }}>
				<style>{`
					.payneo-inset-press:active:not(:disabled) {
						box-shadow: inset 5px 5px 14px rgba(0,0,0,0.22), inset -4px -4px 12px rgba(255,255,255,0.52) !important;
						transform: translateY(1px);
					}
					/* Tip $ 행: 내부 input 때문에 div에 :active가 안 잡힐 때 pointerdown으로 즉시 오목 */
					[data-payneo-press="1"].payneo-inset-press {
						box-shadow: inset 5px 5px 14px rgba(0,0,0,0.22), inset -4px -4px 12px rgba(255,255,255,0.52) !important;
						transform: translateY(1px);
					}
				`}</style>
				{/* X Close Button */}
				<button
					type="button"
					onClick={handleCancelClick}
					className={`absolute top-[28px] right-[3px] z-10 flex h-12 w-12 items-center justify-center rounded-full border-[3px] border-red-500 ${PAY_BTN_INSET} hover:brightness-105`}
					style={PAY_NEO.raised}
					aria-label="Close modal"
				>
					<X size={28} className="text-red-600" strokeWidth={3} />
				</button>
				<div className={`px-3 ${isSplitActive ? 'pt-3' : 'pt-3'}`}>
					<div
						className={`flex min-h-[44px] items-center gap-2 overflow-x-auto whitespace-nowrap rounded-full px-3 py-1.5 transition-all ring-offset-[#e0e5ec] ${
							isSplitActive ? 'ring-2 ring-blue-400/40 ring-offset-2' : ''
						}`}
						style={{ ...PAY_NEO.inset, background: PAY_NEO_CANVAS }}
					>
						{Array.from({ length: maxGuestButtons }, (_, i) => i + 1).map((n) => {
              const isActive = effectiveGuestMode === n || (effectiveGuestMode === 'ALL' && n === 1 && !isSplitActive);
              const isPaidGuest = Array.isArray(paidGuests) && paidGuests.includes(n);
              return (
								<button
									key={n}
                  disabled={isPaidGuest}
                  onClick={() => { if (isPaidGuest) return; setForceAllMode(false); if (onSelectGuestMode) onSelectGuestMode(n); }}
                  className={`rounded-full border-0 px-4 py-1.5 text-sm font-bold min-h-[36px] ${PAY_BTN_INSET} ${isPaidGuest ? 'cursor-not-allowed text-gray-500' : isActive ? 'text-white' : 'text-gray-800'}`}
                  style={
                    isPaidGuest
                      ? { ...PAY_NEO.inset, borderRadius: 9999, opacity: 0.85 }
                      : isActive
                        ? {
                            background: '#2563eb',
                            color: '#fff',
                            borderRadius: 9999,
                            boxShadow: '4px 4px 10px rgba(37,99,235,0.35), -2px -2px 8px rgba(255,255,255,0.3)',
                          }
                        : { ...PAY_NEO.raised, borderRadius: 9999 }
                  }
                  aria-pressed={isActive}
								>
									{isPaidGuest ? `Guest ${n} ✓` : `Guest ${n}`}
								</button>
							);
            })}
					</div>
				</div>
				<div className="grid grid-cols-1 md:[grid-template-columns:30%_40%_30%]">
					{/* Middle (first column): Totals / Inputs OR Payment Complete Screen */}
					{proceedArmed ? (
						/* ===== Payment Complete Screen ===== */
						<div className="p-3 md:order-1 h-full flex flex-col" style={{ background: PAY_NEO_CANVAS }}>
							{/* Payment Complete Header */}
							<div className="flex flex-col items-center justify-center py-4">
								<div className="text-4xl mb-2">✓</div>
								<span className="text-2xl font-bold text-green-700">Payment Complete</span>
							</div>
							
							{/* Change Display (현금 결제시 거스름돈 표시) */}
							{(lastChange != null && lastChange > 0) && (
								<div className="mb-4 flex w-full flex-col items-center px-4 py-4" style={PAY_NEO.inset}>
									<span className="text-lg font-bold text-red-700">Change</span>
									<span className="text-5xl font-extrabold text-red-600">${formatMoney(lastChange)}</span>
								</div>
							)}
							
							{/* Payment Summary */}
							<div className="mb-4 w-full px-4 py-3" style={PAY_NEO.inset}>
								<div className="flex justify-between items-center mb-2 pb-2 border-b">
									<span className="text-lg font-semibold text-gray-700">Total</span>
									<span className="text-xl font-bold text-gray-900">${formatMoney(grand)}</span>
								</div>
								<div className="space-y-1.5 max-h-24 overflow-y-auto">
									{paymentsInScope.map((p, i) => (
										<div key={`payment-complete-${i}`} className="flex justify-between items-center">
											<span className="text-sm text-gray-600">{p.method}</span>
											<span className="text-sm font-semibold text-gray-800">${formatMoney(p.amount || 0)}</span>
										</div>
									))}
								</div>
							</div>
							
							{/* Receipt Options */}
							<div className="mt-auto">
								<div className="text-center mb-3">
									<span className="text-sm font-semibold text-gray-600">Receipt Printing</span>
								</div>
								<div className="grid grid-cols-3 gap-2">
									<button
										type="button"
										onClick={() => setSelectedReceiptCount(0)}
										className={`py-3 px-2 rounded-lg font-bold text-sm ${PAY_BTN_INSET} ${selectedReceiptCount === 0 
											? 'bg-gray-700 text-white border-2 border-gray-900' 
											: 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'}`}
									>
										No Receipt
									</button>
									<button
										type="button"
										onClick={() => setSelectedReceiptCount(1)}
										className={`py-3 px-2 rounded-lg font-bold text-sm ${PAY_BTN_INSET} ${selectedReceiptCount === 1 
											? 'bg-blue-600 text-white border-2 border-blue-700' 
											: 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'}`}
									>
										1 Receipt
									</button>
									<button
										type="button"
										onClick={() => setSelectedReceiptCount(2)}
										className={`py-3 px-2 rounded-lg font-bold text-sm ${PAY_BTN_INSET} ${selectedReceiptCount === 2 
											? 'bg-green-600 text-white border-2 border-green-700' 
											: 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'}`}
									>
										2 Receipts
									</button>
								</div>
							</div>
						</div>
					) : (
						/* ===== Normal Payment Input Screen ===== */
						<div className={`p-3 space-y-3 md:order-1 h-full flex flex-col duration-200 transition-opacity ${isSplitCountMode ? 'opacity-30 pointer-events-none' : ''}`} style={{ background: PAY_NEO_CANVAS }}>
							{/* Items·D/C·세금 = 고정 높이(스크롤), 줄간격은 1 미만 금지(글리프 잘림 방지), 여백만 2/3 축소 */}
								<div className="flex shrink-0 flex-col overflow-hidden rounded-xl px-2.5 py-[calc(0.375rem*1.15*2/3)] text-sm" style={PAY_NEO.inset}>
									<div className="h-[calc(6.5rem*1.05)] min-h-[calc(6.5rem*1.05)] max-h-[calc(6.5rem*1.05)] shrink-0 overflow-x-hidden overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
										<div className="flex justify-between font-semibold leading-[1.35] text-gray-800">
											<span>Items</span>
											<span>${formatMoney(displayPricing.baseSubtotal)}</span>
										</div>
										<div
											className={`mt-[calc(0.25rem*1.15*2/3)] flex justify-between gap-2 text-xs font-semibold leading-[1.35] ${displayPricing.discountPercent > 0 ? '' : 'pointer-events-none select-none opacity-0'}`}
											aria-hidden={displayPricing.discountPercent <= 0}
										>
											<span className="min-w-0 break-words text-red-800">Discount ({displayPricing.discountPercent}%)</span>
											<span className="shrink-0 font-bold text-red-700">- ${formatMoney(displayPricing.discountAmount)}</span>
										</div>
										<div className="mt-[calc(0.25rem*1.15*2/3)] space-y-[calc(0.125rem*1.15*2/3)]">
											{displayPricing.taxLines && displayPricing.taxLines.length > 0 ? (
												displayPricing.taxLines.map((taxLine, idx) => (
													<div key={idx} className="flex justify-between gap-2 leading-[1.35] text-gray-800">
														<span className="min-w-0 flex-1 break-words pr-1">{taxLine.name}</span>
														<span className="shrink-0 self-start tabular-nums">${formatMoney(taxLine.amount)}</span>
													</div>
												))
											) : (
												<div className="flex justify-between leading-[1.35] text-gray-800">
													<span>Tax</span>
													<span className="tabular-nums">${formatMoney(displayPricing.taxesTotal)}</span>
												</div>
											)}
										</div>
									</div>
									<div className="mt-[calc(0.5rem*1.15*2/3)] flex shrink-0 justify-between gap-2 text-lg font-bold leading-snug text-gray-900">
										<span>Total</span>
										<span className="shrink-0 tabular-nums">${formatMoney(displayPricing.total)}</span>
									</div>
								</div>
						<div className="mt-3 text-base flex-1 flex flex-col min-h-0">
							{/* Change container at top */}
                                <div
                                    className={`mb-3 flex w-full min-w-0 max-w-full flex-col items-center justify-center overflow-hidden rounded-xl px-2 py-[calc(0.6rem-7.5px)] sm:px-3 ${(displayChange > 0 && !changeDueDigits) ? 'cursor-pointer hover:brightness-[1.02]' : 'cursor-default'}`}
                                    style={displayChange > 0.005 ? PAY_NEO.key : PAY_NEO.inset}
                                    onClick={() => {
                                      if (displayChange <= 0 || changeDueDigits) return;
                                      setTip(prev => {
                                        const base = parseFloat(String(prev || '0')) || 0;
                                        const next = Number((base + displayChange).toFixed(2));
                                        return next.toFixed(2);
                                      });
                                      setLastChange(null);
                                      setInputTarget('TIP');
                                      setIsTipFocused(false);
                                    }}
                                    role="button"
                                    aria-disabled={!(displayChange > 0)}
                                    tabIndex={(displayChange > 0) ? 0 : -1}
                                    onKeyDown={(e) => {
                                      if (!(displayChange > 0) || changeDueDigits) return;
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        setTip(prev => {
                                          const base = parseFloat(String(prev || '0')) || 0;
                                          const next = Number((base + displayChange).toFixed(2));
                                          return next.toFixed(2);
                                        });
                                        setLastChange(null);
                                        setInputTarget('TIP');
                                        setIsTipFocused(false);
                                      }
                                    }}
                                >
                                    <div className="flex w-full min-w-0 max-w-full flex-col items-center [container-type:inline-size] -translate-y-[10px]">
                                        <span className="mt-[5px] max-w-full truncate text-center text-lg font-bold text-red-700 md:text-xl">
                                          Change $
                                        </span>
                                        <span className="mt-[calc(0.125rem+5px)] block w-full min-w-0 max-w-full text-center font-extrabold leading-none tracking-tight text-red-600 tabular-nums [font-size:clamp(1.35rem,40cqw,4.71rem)] md:[font-size:clamp(1.5rem,44cqw,5.09rem)]">
                                          {changeAmountDisplayString}
                                        </span>
                                        <span className="mt-[14px] max-w-full truncate px-1 text-center text-sm font-semibold text-red-500">
                                          {changeDueDigits ? `Tip: $${formatMoney(parsedTip)}` : 'Tap to add tip'}
                                        </span>
                                    </div>
                                    {/* Tap Change to convert it to Tip */}
                                </div>
								<div className="h-2" />
								<div className="-mt-[10px]">
								{/* Amounts group */}
								<div className="space-y-1.5">
																{/* Due container: tap to fill display with remaining due for confirmation (button → 즉시 :active 오목) */}
										<button
											type="button"
											className={`relative flex h-[calc(5.15rem-5px)] w-full cursor-pointer flex-col items-center justify-center rounded-xl border-0 px-4 py-2 ${PAY_BTN_INSET_SNAP}`}
											style={due > 0.005 ? PAY_NEO.key : PAY_NEO.inset}
											onClick={handleFillDue}
											aria-label="Fill payment amount with due balance"
										>
											<div className="w-full flex items-center justify-between">
												<span className="text-2xl text-blue-700 whitespace-nowrap font-bold leading-none">Due $</span>
												<span className="text-4xl font-bold text-blue-700 leading-none">{formatMoney(due)}</span>
											</div>
											<span className="text-sm font-semibold text-blue-500 mt-1 w-full text-center">Tap to pay</span>
										</button>
							{/* Change Due input: 항상 표시, Cash 거스름돈 발생 시 활성화 — Change $와 동일하게 볼록(key)으로 표시 */}
							{(() => {
								const changeDueEnabled = displayChange > 0 && (lastChange != null && lastChange > 0);
								const changeDueRaised = displayChange > 0.005;
								return (
									<button
										type="button"
										disabled={!changeDueEnabled}
										className={`flex h-[3.51rem] w-full items-center justify-between rounded-xl border-0 px-4 py-2 ${PAY_BTN_INSET_SNAP} ${
											!changeDueEnabled
												? 'cursor-not-allowed opacity-50'
												: inputTarget === 'CHANGE_DUE'
													? 'cursor-pointer ring-2 ring-orange-300 ring-offset-2 ring-offset-[#e0e5ec]'
													: 'cursor-pointer hover:brightness-[1.02]'
										}`}
										style={
											!changeDueEnabled
												? changeDueRaised
													? { ...PAY_NEO.key, filter: 'grayscale(0.15)' }
													: { ...PAY_NEO.inset, filter: 'grayscale(0.15)' }
												: { ...PAY_NEO.key }
										}
										onClick={() => {
											if (!changeDueEnabled) return;
											const totalChange = displayChange > 0 ? displayChange : (lastChange != null ? lastChange : 0);
											changeDueTotalRef.current = totalChange;
											setInputTarget('CHANGE_DUE');
											setIsTipFocused(false);
										}}
										aria-label="Enter change due amount"
									>
										<span className={`text-2xl font-bold whitespace-nowrap ${changeDueEnabled ? 'text-orange-700' : 'text-gray-400'}`}>Change Due $</span>
										<span className={`text-3xl font-extrabold tabular-nums ${
											!changeDueEnabled ? 'text-gray-400'
											: inputTarget === 'CHANGE_DUE' ? 'text-orange-800' : 'text-orange-600'
										}`}>
											{changeDueDigits ? formatMoney(parseInt(changeDueDigits, 10) / 100) : '0.00'}
										</span>
									</button>
								);
							})()}
							{/* Pay container */}
													<div className="flex h-[7.02rem] w-full flex-col rounded-xl px-4 py-2" style={PAY_NEO.inset}>
									<div className="flex items-center justify-between gap-2">
										<span className="text-2xl text-gray-700 whitespace-nowrap font-bold leading-none h-10 flex items-center">Paid $</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleClearPaidBox}
                        disabled={isClearingPaidBox}
                        className={`h-8 rounded-lg border-0 px-3 text-sm font-bold text-red-700 ${PAY_BTN_INSET} hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40`}
                        style={PAY_NEO.raised}
                        title="Clear all payments and reset"
                      >
                        Clear
                      </button>
										  <span className="text-2xl font-bold text-gray-800">{formatMoney(displayPaidTotal)}</span>
                    </div>
									</div>
													<div className="mt-1 text-xs text-gray-600 max-h-12 overflow-y-auto space-y-0.5 pr-1">
										{(paymentsInScope && paymentsInScope.length > 0) && paymentsInScope.map((p, i) => (
											<div key={`pay-${i}`} className="flex items-center justify-between">
												<span className="truncate">{p.method}</span>
												<span className="font-semibold">{formatMoney(p.amount || 0)}</span>
											</div>
										))}
										{optimisticPayments.map(op => (
											<div key={op.tempId} className="flex items-center justify-between text-gray-700">
												<span className="truncate">{op.method ? getMethodLabel(op.method) : 'Processing'}</span>
												<span className="font-semibold">{formatMoney((typeof op.displayAmount === 'number' ? op.displayAmount : op.amount) || 0)}</span>
											</div>
										))}
										{/* 현재 입력 중인 금액 표시 (optimistic 처리 중이 아닐 때만) */}
										{(parsedAmount > 0 && !isProcessing && optimisticPayments.length === 0) && (
											<div className="flex items-center justify-between">
												<span className="truncate">{method ? getMethodLabel(method) : 'Processing'}</span>
												<span className="font-semibold">{formatInput(inputTarget === 'TIP' ? tip : amount)}</span>
											</div>
										)}
									</div>
									</div>
									{/* Tip container */}
								<div
									className={`flex h-[calc(4.29rem-10px)] w-full items-center justify-between rounded-xl px-4 ${PAY_BTN_INSET_SNAP}`}
									style={due > 0.005 ? PAY_NEO.inset : PAY_NEO.key}
									onClick={() => setInputTarget('TIP')}
									onPointerDown={(e) => {
										const el = e.currentTarget as HTMLDivElement;
										el.setAttribute('data-payneo-press', '1');
										const clear = () => {
											el.removeAttribute('data-payneo-press');
											window.removeEventListener('pointerup', clear);
											window.removeEventListener('pointercancel', clear);
										};
										window.addEventListener('pointerup', clear);
										window.addEventListener('pointercancel', clear);
									}}
								>
									<span className="text-2xl font-bold text-red-700 whitespace-nowrap">Tip $</span>
									<input
                    inputMode="decimal"
                    value={inputTarget === 'TIP' ? (isTipFocused ? tip : formatInput(tip)) : formatMoney(tipPaidConfirmed)}
                    readOnly={inputTarget !== 'TIP'}
                    onFocus={() => {
                      setInputTarget('TIP');
                      setIsTipFocused(true);
                      setLastChange(null);
                      // Start a new tip entry; confirmed tips are shown when not in TIP mode.
                      try { setTip('0'); } catch {}
                    }}
                    onBlur={() => {
                      setIsTipFocused(false);
                      if (inputTarget === 'TIP') {
                        const n = parseFloat(unformatInput(tip || '0'));
                        setTip((Number.isFinite(n) && n > 0) ? n.toFixed(2) : '0');
                      }
                    }}
                    onChange={(e) => handleTipChange(e.target.value)}
                    className="h-full flex-1 min-w-0 text-right outline-none bg-transparent text-4xl font-extrabold text-red-700 tabular-nums"
                  />
								</div>
								</div>
							</div>
						</div>

								</div>
					)}
						{/* Right: Keypad & Quick — 소프트 네오 */}
						<div className="p-3 md:order-2 h-full flex flex-col" style={{ background: PAY_NEO_CANVAS }}>
							{/* Customer info moved here */}
                            <div className={`mb-2 flex items-center rounded-xl px-4 py-[calc(1rem*1.1)] text-2xl ${isCenterHeader ? 'justify-center' : 'justify-between'}`} style={PAY_NEO.inset}>
                                <span className="text-gray-800 font-extrabold text-2xl">{headerLeftLabel}</span>
                                {!isCenterHeader && (
                                  <span className="text-gray-800 font-semibold text-2xl">{headerRightLabel}</span>
                                )}
                            </div>
					
							{/* 금액 디스플레이 + 안내 */}
							<div className="grid grid-cols-8 gap-2">
								{/* Row 1: Display */}
								<div
                  className={`col-span-8 flex h-[calc(3.96rem*1.1)] cursor-pointer items-center justify-end overflow-hidden rounded-xl px-3 text-[2.7rem] font-extrabold leading-none tracking-tight tabular-nums ring-offset-2 ring-offset-[#e0e5ec] ${
                    cashReadyForOk
                      ? 'text-green-800 ring-2 ring-green-400/45'
                      : inputTarget === 'DISCOUNT'
                      ? 'text-amber-900 ring-2 ring-amber-400/45'
                      : 'text-red-700'
                  }`}
                  style={PAY_NEO.inset}
                  onClick={() => { setInputTarget('AMOUNT'); setIsTipFocused(false); }}
                  title="Tap to enter payment amount"
                >
                  {isSplitCountMode
                    ? (splitCountInput ? `${splitCountInput}` : '—')
                    : (inputTarget === 'DISCOUNT'
                      ? (customDiscountDigits ? `${customDiscountDigits}%` : '—%')
                      : formatInput(inputTarget === 'TIP' ? tip : amount))}
                </div>
							</div>
							{/* 디스플레이 ↔ 패드 사이 오목(인셋) 구분선 + 상하 여백 */}
							<div className="my-[10px] px-1" aria-hidden>
								<div
									className="h-[7px] w-full rounded-full"
									style={{
										background: PAY_NEO_CANVAS,
										boxShadow: 'inset 0 2px 4px #babecc, inset 0 -2px 4px #ffffff',
									}}
								/>
							</div>
							{/* 숫자 패드 + 퀵금액 */}
							<div className="grid grid-cols-8 gap-[10px]">
								{/* Row 1: 1 2 3 $5 */}
                <button type="button" className={`col-span-2 h-[calc(4.07rem+5px)] w-full border-0 ${PAY_KEYPAD_PRESS} ${isSplitCountMode ? 'text-3xl font-extrabold text-gray-900 ring-2 ring-emerald-300' : 'text-2xl font-bold text-gray-800'}`} style={isSplitCountMode ? { ...PAY_KEYPAD_KEY, background: '#e5f5ec' } : PAY_KEYPAD_KEY} onClick={()=>appendDigit('1')}>1</button>
                <button type="button" className={`col-span-2 h-[calc(4.07rem+5px)] w-full border-0 ${PAY_KEYPAD_PRESS} ${isSplitCountMode ? 'text-3xl font-extrabold text-gray-900 ring-2 ring-emerald-300' : 'text-2xl font-bold text-gray-800'}`} style={isSplitCountMode ? { ...PAY_KEYPAD_KEY, background: '#e5f5ec' } : PAY_KEYPAD_KEY} onClick={()=>appendDigit('2')}>2</button>
                <button type="button" className={`col-span-2 h-[calc(4.07rem+5px)] w-full border-0 ${PAY_KEYPAD_PRESS} ${isSplitCountMode ? 'text-3xl font-extrabold text-gray-900 ring-2 ring-emerald-300' : 'text-2xl font-bold text-gray-800'}`} style={isSplitCountMode ? { ...PAY_KEYPAD_KEY, background: '#e5f5ec' } : PAY_KEYPAD_KEY} onClick={()=>appendDigit('3')}>3</button>
                <button type="button" className={`col-span-2 h-[calc(4.07rem+5px)] w-full border-0 text-xl font-bold text-blue-700 ${PAY_KEYPAD_PRESS} ${isSplitCountMode ? 'pointer-events-none opacity-35' : ''}`} style={PAY_KEYPAD_KEY} onClick={() => addQuick(5)}>$5</button>

								{/* Row 3: 4 5 6 $10 */}
                <button type="button" className={`col-span-2 h-[calc(4.07rem+5px)] w-full border-0 ${PAY_KEYPAD_PRESS} ${isSplitCountMode ? 'text-3xl font-extrabold text-gray-900 ring-2 ring-emerald-300' : 'text-2xl font-bold text-gray-800'}`} style={isSplitCountMode ? { ...PAY_KEYPAD_KEY, background: '#e5f5ec' } : PAY_KEYPAD_KEY} onClick={()=>appendDigit('4')}>4</button>
                <button type="button" className={`col-span-2 h-[calc(4.07rem+5px)] w-full border-0 ${PAY_KEYPAD_PRESS} ${isSplitCountMode ? 'text-3xl font-extrabold text-gray-900 ring-2 ring-emerald-300' : 'text-2xl font-bold text-gray-800'}`} style={isSplitCountMode ? { ...PAY_KEYPAD_KEY, background: '#e5f5ec' } : PAY_KEYPAD_KEY} onClick={()=>appendDigit('5')}>5</button>
                <button type="button" className={`col-span-2 h-[calc(4.07rem+5px)] w-full border-0 ${PAY_KEYPAD_PRESS} ${isSplitCountMode ? 'text-3xl font-extrabold text-gray-900 ring-2 ring-emerald-300' : 'text-2xl font-bold text-gray-800'}`} style={isSplitCountMode ? { ...PAY_KEYPAD_KEY, background: '#e5f5ec' } : PAY_KEYPAD_KEY} onClick={()=>appendDigit('6')}>6</button>
                <button type="button" className={`col-span-2 h-[calc(4.07rem+5px)] w-full border-0 text-xl font-bold text-blue-700 ${PAY_KEYPAD_PRESS} ${isSplitCountMode ? 'pointer-events-none opacity-35' : ''}`} style={PAY_KEYPAD_KEY} onClick={() => addQuick(10)}>$10</button>

								{/* Row 4: 7 8 9 $20 */}
                <button type="button" className={`col-span-2 h-[calc(4.07rem+5px)] w-full border-0 ${PAY_KEYPAD_PRESS} ${isSplitCountMode ? 'text-3xl font-extrabold text-gray-900 ring-2 ring-emerald-300' : 'text-2xl font-bold text-gray-800'}`} style={isSplitCountMode ? { ...PAY_KEYPAD_KEY, background: '#e5f5ec' } : PAY_KEYPAD_KEY} onClick={()=>appendDigit('7')}>7</button>
                <button type="button" className={`col-span-2 h-[calc(4.07rem+5px)] w-full border-0 ${PAY_KEYPAD_PRESS} ${isSplitCountMode ? 'text-3xl font-extrabold text-gray-900 ring-2 ring-emerald-300' : 'text-2xl font-bold text-gray-800'}`} style={isSplitCountMode ? { ...PAY_KEYPAD_KEY, background: '#e5f5ec' } : PAY_KEYPAD_KEY} onClick={()=>appendDigit('8')}>8</button>
                <button type="button" className={`col-span-2 h-[calc(4.07rem+5px)] w-full border-0 ${PAY_KEYPAD_PRESS} ${isSplitCountMode ? 'text-3xl font-extrabold text-gray-900 ring-2 ring-emerald-300' : 'text-2xl font-bold text-gray-800'}`} style={isSplitCountMode ? { ...PAY_KEYPAD_KEY, background: '#e5f5ec' } : PAY_KEYPAD_KEY} onClick={()=>appendDigit('9')}>9</button>
                <button type="button" className={`col-span-2 h-[calc(4.07rem+5px)] w-full border-0 text-xl font-bold text-blue-700 ${PAY_KEYPAD_PRESS} ${isSplitCountMode ? 'pointer-events-none opacity-35' : ''}`} style={PAY_KEYPAD_KEY} onClick={() => addQuick(20)}>$20</button>

								{/* Row 5: 0 00 . $50 */}
                <button type="button" className={`col-span-2 h-[calc(4.07rem+5px)] w-full border-0 ${PAY_KEYPAD_PRESS} ${isSplitCountMode ? 'text-3xl font-extrabold text-gray-900 ring-2 ring-emerald-300' : 'text-2xl font-bold text-gray-800'}`} style={isSplitCountMode ? { ...PAY_KEYPAD_KEY, background: '#e5f5ec' } : PAY_KEYPAD_KEY} onClick={()=>appendDigit('0')}>0</button>
                <button type="button" className={`col-span-2 h-[calc(4.07rem+5px)] w-full border-0 text-2xl font-bold text-gray-800 ${PAY_KEYPAD_PRESS} ${isSplitCountMode ? 'pointer-events-none opacity-35' : ''}`} style={PAY_KEYPAD_KEY} onClick={()=>appendDigit('00')}>00</button>
                <button type="button" className={`col-span-2 h-[calc(4.07rem+5px)] w-full border-0 text-3xl font-bold text-gray-800 ${PAY_KEYPAD_PRESS} ${isSplitCountMode ? 'pointer-events-none opacity-35' : ''}`} style={PAY_KEYPAD_KEY} onClick={()=>appendDigit('.')}>.</button>
                <button type="button" className={`col-span-2 h-[calc(4.07rem+5px)] w-full border-0 text-xl font-bold text-blue-700 ${PAY_KEYPAD_PRESS} ${isSplitCountMode ? 'pointer-events-none opacity-35' : ''}`} style={PAY_KEYPAD_KEY} onClick={() => addQuick(50)}>$50</button>

								{/* Row 6: Clear (3col) ← (3col) $100 (2col) */}
                <button
                  type="button"
                  className={`col-span-3 h-[calc(3.37rem+5px)] w-full border-0 text-lg font-bold text-gray-800 ${PAY_KEYPAD_PRESS}`}
                  style={PAY_KEYPAD_KEY}
                  onClick={() => {
                    if (isSplitCountMode) { setSplitCountInput(''); return; }
                    if (inputTarget === 'DISCOUNT') { setCustomDiscountDigits(''); setLastChange(null); return; }
                    if (inputTarget === 'SPLIT_N') { setSplitNCustomDigits(''); setSplitNActive(0); setLastChange(null); return; }
                    if (inputTarget === 'CHANGE_DUE') {
                      setChangeDueDigits('');
                      setTip('0');
                      const orig = changeDueTotalRef.current;
                      setLastChange(orig > 0 ? orig : null);
                      return;
                    }
                    setAmount('0.00'); setRawAmountDigits(''); setTip('0'); setMethod(''); setInputTarget('AMOUNT'); setIsTipFocused(false); setCashReadyForOk(false); cashReadyDataRef.current = null;
                  }}
                >
                  Clear
                </button>
                <button type="button" className={`col-span-3 h-[calc(3.37rem+5px)] w-full border-0 text-2xl font-bold text-gray-800 ${PAY_KEYPAD_PRESS}`} style={PAY_KEYPAD_KEY} onClick={()=>appendDigit('BS')}>←</button>
                <button type="button" className={`col-span-2 h-[calc(3.37rem+5px)] w-full border-0 text-xl font-bold text-blue-700 ${PAY_KEYPAD_PRESS} ${isSplitCountMode ? 'pointer-events-none opacity-35' : ''}`} style={PAY_KEYPAD_KEY} onClick={() => addQuick(100)}>$100</button>
							</div>
							{/* 패드 ↔ Cancel/OK — 하단은 Cancel/OK와 간격 3px 타이트 */}
							<div className="mt-[10px] mb-[7px] px-1" aria-hidden>
								<div
									className="h-[7px] w-full rounded-full"
									style={{
										background: PAY_NEO_CANVAS,
										boxShadow: 'inset 0 2px 4px #babecc, inset 0 -2px 4px #ffffff',
									}}
								/>
							</div>
            <div className="mt-0 mb-0 grid grid-cols-2 gap-2">
                <button 
                  type="button"
                  onClick={isSplitCountMode ? handleSplitCountCancel : handleCancelClick} 
                  className={`h-[calc(4.00rem+10px)] w-full rounded-xl border-0 text-xl font-bold text-white ${PAY_CANCEL_PRESS}`}
                  style={{ ...PAY_NEO.raised, background: '#374151', color: '#fff', boxShadow: '5px 5px 12px rgba(55,65,81,0.45), -3px -3px 10px rgba(255,255,255,0.25)' }}
                >
                  {isSplitCountMode ? 'Cancel Split' : 'Cancel'}
                </button>
                <button 
                  type="button"
                  onClick={isSplitCountMode ? handleSplitCountConfirm : (proceedArmed ? proceedNext : finalizeAndComplete)} 
                  className={`h-[calc(4.00rem+10px)] w-full rounded-xl border-0 text-xl font-bold ${PAY_OK_PRESS} ${(isSplitCountMode ? splitCountInput.length > 0 : canClickOk) ? 'text-white' : 'cursor-not-allowed text-green-800 opacity-60'}`}
                  style={
                    (isSplitCountMode ? splitCountInput.length > 0 : canClickOk)
                      ? { ...PAY_NEO.raised, background: '#16a34a', color: '#fff', boxShadow: '5px 5px 12px rgba(22,101,52,0.4), -3px -3px 10px rgba(255,255,255,0.25)' }
                      : { ...PAY_NEO.inset, background: '#c8e6c9' }
                  }
                  disabled={isSplitCountMode ? splitCountInput.length === 0 : !canClickOk}
                >
                  {isSplitCountMode ? 'Confirm' : (proceedArmed ? 'Next' : 'OK')}
                </button>
            </div>
							<div className="h-3" />
					</div>

					{/* Methods + Discount (right column) */}
					<div className={`border-l border-l-gray-300/50 p-2 md:order-3 flex flex-col h-full duration-200 transition-opacity ${isSplitCountMode ? 'opacity-30 pointer-events-none' : ''}`} style={{ background: PAY_NEO_CANVAS }}>
            {/* Payment tools (8 buttons, 4 cols x 2 rows) */}
            <div
              className="mb-2 rounded-[14px] p-2"
              style={{
                ...PAY_NEO.inset,
                background: 'linear-gradient(155deg, #dbeafe 0%, #bfdbfe 48%, #93c5fd 100%)',
              }}
            >
              <div className="mb-1 flex items-center py-[4px] text-xs font-extrabold text-blue-800">PAYMENT</div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ...methods.filter(m => m.key !== 'GIFT' && m.key !== 'OTHER').map(m => ({ key: m.key, label: m.label, onClick: () => commitDraft(m.key) })),
                  { key: 'GIFT', label: 'Gift', onClick: openGiftCardModal },
                  { key: 'COUPON', label: 'Coupon', onClick: () => commitDraft('COUPON') },
                  { key: 'OTHER', label: 'Other', onClick: () => commitDraft('OTHER') },
                ].slice(0, 8).map(btn => (
                  <button
                    type="button"
                    key={btn.key}
                    onClick={btn.onClick}
                    className={`min-h-[calc(40px*1.15*1.1*1.05+1px)] rounded-[10px] border-0 px-2 text-base font-extrabold ${PAY_BTN_INSET} ${
                      method === btn.key ? 'text-gray-600' : 'text-gray-500'
                    }`}
                    style={method === btn.key ? PAY_NEO.inset : PAY_NEO.key}
                    title={btn.label}
                  >
                    {btn.key === 'MC' ? (
                      <span className="leading-tight">
                        Master
                        <br />
                        Card
                      </span>
                    ) : (
                      btn.label
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Discount panel — 잠금 시 레이아웃·네오모픽 유지, 채도·불투명만 낮춤 */}
            <div
              className={`mb-2 rounded-[14px] p-2 transition-[opacity,filter,box-shadow] duration-200 ${
                freezeDiscountAndSplit
                  ? 'pointer-events-none select-none opacity-[0.6] saturate-[0.62] ring-1 ring-inset ring-black/[0.07]'
                  : ''
              }`}
              style={{
                ...PAY_NEO.inset,
                background: 'linear-gradient(155deg, #fef2f2 0%, #ffe4e6 42%, #fecdd3 100%)',
              }}
              aria-disabled={freezeDiscountAndSplit}
            >
              <div className="mb-1 flex items-center justify-between gap-2 py-[4px]">
                <div className="shrink-0 text-xs font-extrabold text-red-800">DISCOUNT</div>
                <button
                  type="button"
                  disabled={pricingEffective.discountPercent <= 0}
                  className={`shrink-0 rounded-md border-0 bg-transparent px-1.5 py-0.5 text-[10px] font-bold text-red-600 ${PAY_BTN_INSET} hover:text-red-800 disabled:pointer-events-none disabled:opacity-35`}
                  onClick={() => {
                    setDiscountPreset(null);
                    setIsCustomDiscount(false);
                    setCustomDiscountDigits('');
                    setDiscountBump5Pressed(false);
                    setDiscountBump10Pressed(false);
                    setLastChange(null);
                    setInputTarget('AMOUNT');
                    setIsTipFocused(false);
                  }}
                >
                  Clear
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {DISCOUNT_PRESETS.map((p) => {
                  const active = (!isCustomDiscount) && discountPreset === p;
                  return (
                    <button
                      type="button"
                      key={p}
                      onClick={() => {
                        // Toggle: press same preset again to cancel discount
                        if (active) {
                          setDiscountPreset(null);
                          setIsCustomDiscount(false);
                          setCustomDiscountDigits('');
                          setLastChange(null);
                          setInputTarget('AMOUNT');
                          setIsTipFocused(false);
                          return;
                        }
                        setDiscountPreset(p);
                        setIsCustomDiscount(false);
                        setCustomDiscountDigits('');
                        setLastChange(null);
                        setInputTarget('AMOUNT');
                        setIsTipFocused(false);
                      }}
                      className={`min-h-[43px] rounded-[10px] border-0 text-sm font-extrabold ${PAY_BTN_INSET} ${
                        active ? 'text-red-900' : 'text-gray-500'
                      }`}
                      style={active ? PAY_NEO.inset : PAY_NEO.key}
                    >
                      {p}%
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    setDiscountBump5Pressed(true);
                    bumpDiscountBy(5);
                  }}
                  className={`min-h-[43px] rounded-[10px] border-0 text-sm font-extrabold ${PAY_BTN_INSET} ${
                    discountBump5Pressed ? 'text-red-500' : 'text-red-400'
                  }`}
                  style={discountBump5Pressed ? PAY_NEO.inset : PAY_NEO.key}
                >
                  +5%
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDiscountBump10Pressed(true);
                    bumpDiscountBy(10);
                  }}
                  className={`min-h-[43px] rounded-[10px] border-0 text-sm font-extrabold ${PAY_BTN_INSET} ${
                    discountBump10Pressed ? 'text-red-500' : 'text-red-400'
                  }`}
                  style={discountBump10Pressed ? PAY_NEO.inset : PAY_NEO.key}
                >
                  +10%
                </button>
              </div>
            </div>

            {/* 1/N Split panel — 잠금 시 동일 스타일 + 채도·불투명만 낮춤 */}
            <div
              className={`mb-2 rounded-[14px] p-2 transition-[opacity,filter,box-shadow] duration-200 ${
                freezeDiscountAndSplit
                  ? 'pointer-events-none select-none opacity-[0.6] saturate-[0.62] ring-1 ring-inset ring-black/[0.07]'
                  : ''
              }`}
              style={{ ...PAY_NEO.inset, background: '#dcefe4' }}
              aria-disabled={freezeDiscountAndSplit}
            >
              <div className="mb-1 flex items-center justify-between gap-2 py-[4px]">
                <span className="shrink-0 text-xs font-bold text-emerald-700">1/N Split</span>
                <button
                  type="button"
                  disabled={splitNActive <= 0}
                  className={`shrink-0 rounded-md border-0 bg-transparent px-1.5 py-0.5 text-[10px] font-bold text-red-600 ${PAY_BTN_INSET} hover:text-red-800 disabled:pointer-events-none disabled:opacity-35`}
                  onClick={async () => {
                    if (splitNActive <= 0) return;
                    if (onClearAllPayments) {
                      try {
                        await onClearAllPayments();
                      } catch {
                        /* ignore */
                      }
                    }
                    setSplitNActive(0);
                    setSplitNCustomMode(false);
                    setSplitNCustomDigits('');
                    setInputTarget('AMOUNT');
                    setLastChange(null);
                    setAmount('0.00');
                    setRawAmountDigits('');
                    setTip('0');
                    setMethod('');
                    setOptimisticPayments([]);
                    if (onCreateAdhocGuests) onCreateAdhocGuests(0);
                    try {
                      if (onSelectGuestMode) onSelectGuestMode('ALL');
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  Clear
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[2, 3, 4, 5, 6].map(n => {
                  const active = splitNActive === n && !splitNCustomMode;
                  return (
                    <button key={n} type="button"
                      className={`min-h-[43px] rounded-[10px] border-0 text-xs font-extrabold ${PAY_BTN_INSET} ${
                        active ? 'text-emerald-900' : 'text-gray-500'
                      }`}
                      style={active ? PAY_NEO.inset : PAY_NEO.key}
                      onClick={async () => {
                        if (active) {
                          if (onClearAllPayments) { try { await onClearAllPayments(); } catch {} }
                          setSplitNActive(0); setSplitNCustomMode(false); setSplitNCustomDigits('');
                          setInputTarget('AMOUNT'); setLastChange(null);
                          setAmount('0.00'); setRawAmountDigits(''); setTip('0'); setMethod('');
                          setOptimisticPayments([]);
                          if (onCreateAdhocGuests) onCreateAdhocGuests(0);
                          try { if (onSelectGuestMode) onSelectGuestMode('ALL'); } catch {}
                          return;
                        }
                        setSplitNActive(n); setSplitNCustomMode(false); setSplitNCustomDigits('');
                        if (onCreateAdhocGuests) {
                          onCreateAdhocGuests(n);
                          try { setForceAllMode(false); } catch {}
                          try { if (onSelectGuestMode) onSelectGuestMode(1); } catch {}
                        }
                        setAmount('0.00'); setRawAmountDigits('');
                        setInputTarget('AMOUNT'); setIsTipFocused(false); setLastChange(null);
                        setTip('0'); setMethod('');
                      }}>
                      1/{n}P
                    </button>
                  );
                })}
                <button
                  type="button"
                  disabled={splitNActive >= 20}
                  className={`min-h-[43px] rounded-[10px] border-0 text-sm font-black leading-none ${PAY_BTN_INSET} disabled:pointer-events-none disabled:opacity-40 ${
                    splitNActive > 6 ? 'text-emerald-900' : 'text-emerald-700'
                  }`}
                  style={splitNActive > 6 ? PAY_NEO.inset : PAY_NEO.key}
                  onClick={async () => {
                    if (splitNActive >= 20) return;
                    const nextN = splitNActive < 2 ? 2 : splitNActive + 1;
                    setSplitNCustomMode(false);
                    setSplitNCustomDigits('');
                    setSplitNActive(nextN);
                    if (onCreateAdhocGuests) {
                      onCreateAdhocGuests(nextN);
                      try { setForceAllMode(false); } catch {}
                      try { if (onSelectGuestMode) onSelectGuestMode(1); } catch {}
                    }
                    setAmount('0.00'); setRawAmountDigits('');
                    setInputTarget('AMOUNT'); setIsTipFocused(false); setLastChange(null);
                    setTip('0'); setMethod('');
                  }}
                >
                  +1
                </button>
              </div>
            </div>

            {/* Split Bill button — freezeDiscountAndSplit 시 할인·1/N Split과 동일 비활성 */}
            {typeof onSplitBill === 'function' && (
              <div
                className={`rounded-[14px] p-2 transition-[opacity,filter,box-shadow] duration-200 ${
                  freezeDiscountAndSplit
                    ? 'pointer-events-none select-none opacity-[0.6] saturate-[0.62] ring-1 ring-inset ring-black/[0.07]'
                    : ''
                }`}
                style={PAY_NEO.inset}
                aria-disabled={freezeDiscountAndSplit}
              >
                <button
                  type="button"
                  disabled={freezeDiscountAndSplit}
                  className={`flex w-full items-center justify-center rounded-xl border-0 px-3 py-[0.68rem] font-extrabold text-violet-900 ${PAY_SPLIT_PRESS} disabled:pointer-events-none`}
                  style={{
                    ...PAY_KEYPAD_KEY,
                    background: 'linear-gradient(160deg, #ddd6fe 0%, #c4b5fd 55%, #a78bfa 100%)',
                    boxShadow: '5px 5px 10px #a78bfa99, -4px -4px 9px #ffffff',
                  }}
                  onClick={() => {
                    if (freezeDiscountAndSplit) return;
                    setSplitBillLaunchTouched(true);
                    onSplitBill();
                  }}
                >
                  Split
                </button>
              </div>
            )}
					</div>
				</div>
			{/* Clamp info popup */}
			{clampPopup && (
				<div className="absolute inset-0 flex items-center justify-center pointer-events-none z-50">
					<div className="pointer-events-auto bg-gray-900/90 text-white px-4 py-3 rounded-xl shadow-2xl border border-gray-700 text-center">
						<div className="text-sm font-semibold">{clampPopup.method ? `${getMethodLabel(clampPopup.method)}:` : 'Notice'}</div>
						<div className="text-base font-bold">${clampPopup.entered.toFixed(2)} was entered, but ${clampPopup.applied.toFixed(2)} was processed.</div>
					</div>
				</div>
			)}

      {/* Info popup (non-blocking) */}
      {infoPopup && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-50">
          <div className="pointer-events-none bg-gray-900/90 text-white px-4 py-3 rounded-xl shadow-2xl border border-gray-700 text-center">
            <div className="text-base font-bold">{infoPopup}</div>
          </div>
        </div>
      )}

			{/* Custom Alert Popup */}
			{alertMessage && (
				<div className="absolute inset-0 flex items-center justify-center pointer-events-none z-50">
					<div className="pointer-events-auto bg-white rounded-xl shadow-2xl border-2 border-blue-500 px-6 py-4 text-center min-w-[320px] max-w-[480px]">
						<div className="text-lg font-bold text-gray-800 mb-3">{alertMessage}</div>
						<button
							type="button"
							onClick={() => {
								setAlertMessage(null);
								if (alertTimerRef.current) {
									window.clearTimeout(alertTimerRef.current);
									alertTimerRef.current = null;
								}
							}}
							className={`px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold ${PAY_BTN_INSET} hover:bg-blue-700`}
						>
							OK
						</button>
					</div>
				</div>
			)}

			{/* Cancel Confirmation Modal */}
			{showCancelConfirm && (
				<div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
					<div className="bg-white rounded-xl shadow-2xl w-[380px] overflow-hidden">
						<div className="bg-gradient-to-r from-red-500 to-red-600 px-4 py-3">
							<h3 className="text-lg font-bold text-white text-center">Cancel Payment?</h3>
						</div>
						<div className="p-5 space-y-4">
							<p className="text-center text-gray-700">
								This will <span className="font-bold text-red-600">void all payments</span> and close the modal.
							</p>
							<p className="text-center text-sm text-gray-500">
								{payments && payments.length > 0 
									? `${payments.length} payment(s) will be voided.`
									: 'Are you sure you want to cancel?'
								}
							</p>
							<div className="flex gap-3">
								<button
									type="button"
									onClick={handleCancelDismiss}
									className={`flex-1 py-3 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold ${PAY_BTN_INSET}`}
								>
									Go Back
								</button>
								<button
									type="button"
									onClick={handleCancelConfirmed}
									className={`flex-1 py-3 rounded-lg bg-red-500 hover:bg-red-600 text-white font-semibold ${PAY_BTN_INSET}`}
								>
									Yes, Cancel All
								</button>
							</div>
						</div>
					</div>
				</div>
			)}

			{/* Gift Card Payment Modal — soft neumorphic shell (결제/Change 로직 미변경) */}
			{showGiftCardModal && (
				<div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
					<div className="rounded-2xl w-[420px] overflow-hidden" style={SOFT_NEO.shell}>
						<div className="flex shrink-0 items-center justify-between border-b border-gray-400/20 px-3 py-2">
							<h3 className="text-base font-bold text-gray-800">Gift Card Payment</h3>
							<button
								type="button"
								onClick={() => { setShowGiftCardModal(false); resetGiftCard(); }}
								aria-label="Close"
								className={`flex h-9 w-9 items-center justify-center rounded-full border-2 border-red-500 ${PAY_BTN_INSET}`}
								style={SOFT_NEO.btnRound}
							>
								<svg className="h-4 w-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
								</svg>
							</button>
						</div>

						<div className="p-3 space-y-2">
							<div className="rounded-xl py-2 px-2 text-center" style={SOFT_NEO.insetWell}>
								<div className="text-xs font-semibold text-blue-700/90">Remaining Due</div>
								<div className="text-lg font-bold text-blue-800">${remainingDue.toFixed(2)}</div>
							</div>

							<div
								onClick={() => setGiftCardInputFocus('card')}
								className={`cursor-pointer rounded-xl px-3 py-2 transition-all ${giftCardInputFocus === 'card' ? 'ring-2 ring-amber-400/90 ring-offset-2 ring-offset-[#e8ecf2]' : ''}`}
								style={SOFT_NEO.insetWell}
							>
								<div className="text-xs font-semibold text-gray-600 mb-0.5">Card Number</div>
								<div className="text-xl font-mono tracking-wide text-center text-gray-800">
									{giftCardNumber.slice(0, 4) || <span className="text-gray-400">____</span>}
									{'-'}
									{giftCardNumber.slice(4, 8) || <span className="text-gray-400">____</span>}
									{'-'}
									{giftCardNumber.slice(8, 12) || <span className="text-gray-400">____</span>}
									{'-'}
									{giftCardNumber.slice(12, 16) || <span className="text-gray-400">____</span>}
								</div>
							</div>

							<div className="flex gap-2">
								<div
									className="flex-1 rounded-xl py-1.5 px-2 text-center"
									style={SOFT_NEO.insetWell}
								>
									<div className="text-xs text-gray-600">Balance</div>
									<div className={`text-lg font-bold ${giftCardBalance !== null ? 'text-green-700' : 'text-gray-400'}`}>
										{giftCardBalance !== null ? `$${giftCardBalance.toFixed(2)}` : '---'}
									</div>
								</div>

								<div
									onClick={() => giftCardBalance !== null && setGiftCardInputFocus('amount')}
									className={`flex-1 cursor-pointer rounded-xl py-1.5 px-2 text-center transition-all ${giftCardInputFocus === 'amount' && giftCardBalance !== null ? 'ring-2 ring-amber-400/90 ring-offset-2 ring-offset-[#e8ecf2]' : ''}`}
									style={SOFT_NEO.insetWell}
								>
									<div className="text-xs text-gray-600">Pay Amount</div>
									<div className="text-lg font-bold text-gray-800">
										${giftCardPayAmount || '0.00'}
									</div>
								</div>
							</div>

							<div className="flex gap-2 h-[48px]">
								{giftCardBalance !== null && (
									<>
										{giftCardBalance >= remainingDue ? (
											<button
												type="button"
												onClick={() => { setGiftCardPayAmount(remainingDue.toFixed(2)); }}
												className={`flex-1 rounded-xl py-3 text-sm font-bold text-white ${PAY_BTN_INSET}`}
												style={SOFT_NEO.btnSuccess}
											>
												Full ${remainingDue.toFixed(2)}
											</button>
										) : (
											<button
												type="button"
												onClick={() => { setGiftCardPayAmount(giftCardBalance.toFixed(2)); }}
												className={`flex-1 rounded-xl py-3 text-sm font-bold text-white ${PAY_BTN_INSET}`}
												style={SOFT_NEO.btnWarn}
											>
												Use All ${giftCardBalance.toFixed(2)}
											</button>
										)}
									</>
								)}
							</div>

							<div className="rounded-xl p-2" style={SOFT_NEO.insetWell}>
								<div className="grid grid-cols-3 gap-1.5">
									{['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map((key, idx) => (
										<button
											key={idx}
											type="button"
											onClick={() => handleGiftCardKeypadPress(key)}
											className={`rounded-xl py-3 text-lg font-bold text-gray-800 ${PAY_BTN_INSET} ${
												key === '⌫' ? 'text-amber-800' : key === '.' ? 'text-gray-600' : ''
											}`}
											style={SOFT_NEO.tabRaised}
										>
											{key}
										</button>
									))}
								</div>
							</div>

							{giftCardError && (
								<div className="rounded-xl border border-red-200/80 bg-red-50/90 py-1.5 px-2 text-center">
									<div className="text-red-600 text-xs font-medium">{giftCardError}</div>
								</div>
							)}

							<div className="flex gap-2">
								<button
									type="button"
									onClick={handleCheckGiftCardBalance}
									disabled={giftCardLoading || giftCardNumber.length !== 16}
									className={`w-1/4 rounded-xl py-3 text-sm font-bold text-white ${PAY_BTN_INSET} disabled:cursor-not-allowed disabled:opacity-45`}
									style={SOFT_NEO.btnPrimary}
								>
									{giftCardLoading ? '...' : 'Balance'}
								</button>
								<button
									type="button"
									onClick={() => { setShowGiftCardModal(false); resetGiftCard(); }}
									className={`flex-1 rounded-xl py-3 text-sm font-bold text-gray-700 ${PAY_BTN_INSET}`}
									style={SOFT_NEO.tabRaised}
								>
									Cancel
								</button>
								<button
									type="button"
									onClick={handleGiftCardPay}
									disabled={giftCardLoading || giftCardBalance === null || !giftCardPayAmount || parseFloat(giftCardPayAmount) <= 0}
									className={`flex-1 rounded-xl py-3 text-sm font-bold text-white ${PAY_BTN_INSET} disabled:cursor-not-allowed disabled:opacity-45`}
									style={SOFT_NEO.btnAmber}
								>
									{giftCardLoading ? '...' : 'Pay'}
								</button>
							</div>
						</div>
					</div>
				</div>
			)}
			</div>
		</div>,
		document.body
	);
};

export default PaymentModal; 
