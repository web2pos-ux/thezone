import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import { OrderItem } from '../pages/order/orderTypes';
import { API_URL } from '../config/constants';

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
	onConfirm: (payload: { method: string; amount: number; tip: number; discountedGrand?: number }) => void;
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

const methods = [
	{ key: 'CASH', label: 'Cash', emoji: '💵' },
	{ key: 'DEBIT', label: 'Debit', emoji: '🏧' },
	{ key: 'VISA', label: 'Visa', emoji: '💳' },
	{ key: 'MC', label: 'MasterCard', emoji: '💳' },
	{ key: 'OTHER_CARD', label: 'Other Card', emoji: '💳' },
	{ key: 'GIFT', label: 'Gift Card', emoji: '🎁' },
	{ key: 'OTHER', label: 'Other', emoji: '✳️' },
];

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

  // Discount states (order-level percent; applied within this modal only)
  const DISCOUNT_PRESETS = [5, 10, 15, 20, 25, 30, 50, 75, 100] as const;
  const [discountPreset, setDiscountPreset] = useState<number | null>(null);
  const [isCustomDiscount, setIsCustomDiscount] = useState<boolean>(false);
  const [customDiscountDigits, setCustomDiscountDigits] = useState<string>(''); // integer percent, 1..100

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
    setSplitNActive(0);
    setSplitNCustomMode(false);
    setSplitNCustomDigits('');
    setChangeDueDigits('');
    changeDueTotalRef.current = 0;
    committedChangeRef.current = 0;
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
      const baseByProp = (typeof outstandingDue === 'number') ? Number(outstandingDue.toFixed(2)) : Number(grand.toFixed(2));
      if (onCreateAdhocGuests && guestCount && guestCount > 1 && baseByProp <= Number(grand.toFixed(2))) {
         return Math.max(0, baseByProp);
      }
      return Math.max(0, baseByProp);
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
        await onConfirm({ method: effectiveMethod, amount: parseFloat(finalAmount.toFixed(2)), tip: parseFloat(t.toFixed(2)), discountedGrand: grand });
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
        } else if (onCreateAdhocGuests && isSplitActive && typeof outstandingDue === 'number') {
          scopeDueNow = Math.max(0, Number(outstandingDue.toFixed(2)));
        } else {
          scopeDueNow = Math.max(0, Number((grand - confirmedTotalNow).toFixed(2)));
        }
        const isCardPayment = ['DEBIT', 'VISA', 'MC', 'OTHER_CARD'].includes(effectiveMethod.toUpperCase());
        const isCashLikeMethod = (effectiveMethod === 'CASH') || isCardPayment;
        const isCashMethod = effectiveMethod === 'CASH';

        // Cash: 결제 금액이 Due 이상이면 대기 상태로 전환 (Tip/Change Due 입력 기회 제공)
        if (isCashMethod && rawAmt >= scopeDueNow && scopeDueNow > 0) {
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
        
        if (isCashLikeMethod) {
          finalAmount = Math.min(rawAmt, scopeDueNow);
          t = rawTip;
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
        await onConfirm({ method: effectiveMethod, amount: parseFloat(finalAmount.toFixed(2)), tip: parseFloat(t.toFixed(2)), discountedGrand: grand });
        setOptimisticPayments(prev => prev.filter(p => p.tempId !== tempId));
        if (!isCashLikeMethod && rawAmt > finalAmount) {
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
        
        // 결제 처리 후 잔액이 0이면 바로 Payment Complete 모달 표시
        // Cash-like (Cash + Cards): 항상 결제 완료 처리 (초과분은 Change)
        // 기타: scopeDueNow - finalAmount로 남은 잔액 계산
        const remainingAfterPayment = isCashLikeMethod
          ? 0
          : scopeDueNow - finalAmount;
        
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
      } else if (canComplete) {
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
      showAlert('Payment failed. Please try again.');
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
	const maxGuestButtons = useMemo(() => Math.min(8, (guestCount || 8)), [guestCount]);
 

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
        } else if (onCreateAdhocGuests && isSplitActive && typeof outstandingDue === 'number') {
          scopeDueNow = Math.max(0, Number(outstandingDue.toFixed(2)));
        } else {
          scopeDueNow = Math.max(0, Number((grand - confirmedTotalNow).toFixed(2)));
        }
        const isCardPayment2 = ['DEBIT', 'VISA', 'MC', 'OTHER_CARD'].includes(effectiveMethod.toUpperCase());
        const isCashLikeMethod2 = (effectiveMethod === 'CASH') || isCardPayment2;
        let finalAmount: number;
        let t: number;
        
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
        } else {
          finalAmount = Math.min(currentAmt, scopeDueNow);
          t = currentTip;
          setLastChange(null);
        }
        const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
        const displayAmount = Number((finalAmount + t).toFixed(2));
        setOptimisticPayments(prev => [...prev, { tempId, method: effectiveMethod, amount: finalAmount, tip: t, displayAmount }]);
        setRawAmountDigits('');
        await onConfirm({ method: effectiveMethod, amount: parseFloat(finalAmount.toFixed(2)), tip: parseFloat(t.toFixed(2)), discountedGrand: grand });
        setOptimisticPayments(prev => prev.filter(p => p.tempId !== tempId));
        if (!isCashLikeMethod2 && currentAmt > finalAmount) {
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
        showAlert('Payment failed. Please try again.');
        try { console.error('Auto-commit failed', e); } catch {}
      }
    }
  }, [method, amount, tip, cashPaidConfirmed, nonCashPaidConfirmed, grand, onConfirm, showClampPopup, showInfoPopup, onCreateAdhocGuests, isSplitActive, outstandingDue, isProcessing]);

  // Confirmed 결제를 반영해 최종 남은 금액(dueFull)과 화면 Due 값을 계산
  const due = useMemo(() => {
    if (onCreateAdhocGuests && isSplitActive && splitNActive >= 2) {
        const grandCents = Math.round(grand * 100);
        const guestIdx = typeof effectiveGuestMode === 'number' ? effectiveGuestMode : 1;
        const myShare = calcFairShare(grandCents, splitNActive, guestIdx);
        const myPaid = Number(((cashPaidConfirmed + nonCashPaidConfirmed)).toFixed(2));
        return Math.max(0, Number((myShare - myPaid - parsedAmount).toFixed(2)));
    }
    if (onCreateAdhocGuests && isSplitActive && typeof outstandingDue === 'number') {
        return Math.max(0, Number((outstandingDue - parsedAmount).toFixed(2)));
    }

    const confirmedTotal = Number(((cashPaidConfirmed + nonCashPaidConfirmed)).toFixed(2));
    const dueFull = Math.max(0, Number((grand - confirmedTotal).toFixed(2)));
    return Math.max(0, Number((dueFull - parsedAmount).toFixed(2)));
  }, [grand, cashPaidConfirmed, nonCashPaidConfirmed, parsedAmount, outstandingDue, onCreateAdhocGuests, isSplitActive, splitNActive, effectiveGuestMode]);


  // Next는 사용자 조작으로만 진행 (자동 완료 제거)

  const currentDueRemaining = useMemo(() => {
    const confirmedTotal = Number(((cashPaidConfirmed + nonCashPaidConfirmed)).toFixed(2));
    if (onCreateAdhocGuests && isSplitActive && splitNActive >= 2) {
      const grandCents = Math.round(grand * 100);
      const guestIdx = typeof effectiveGuestMode === 'number' ? effectiveGuestMode : 1;
      const myShare = calcFairShare(grandCents, splitNActive, guestIdx);
      return Math.max(0, Number((myShare - confirmedTotal).toFixed(2)));
    }
    if (onCreateAdhocGuests && isSplitActive && typeof outstandingDue === 'number') {
      return Math.max(0, Number(outstandingDue.toFixed(2)));
    }
    return Math.max(0, Number((grand - confirmedTotal).toFixed(2)));
  }, [grand, cashPaidConfirmed, nonCashPaidConfirmed, outstandingDue, onCreateAdhocGuests, isSplitActive, splitNActive, effectiveGuestMode]);

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
				} else if (onCreateAdhocGuests && isSplitActive && typeof outstandingDue === 'number') {
					scopeDueNow = Math.max(0, Number(outstandingDue.toFixed(2)));
				} else {
					scopeDueNow = Math.max(0, Number((grand - confirmedTotalNow).toFixed(2)));
				}
				
        const isCardPaymentDraft = ['DEBIT', 'VISA', 'MC', 'OTHER_CARD'].includes(String(effectiveMethod || '').toUpperCase());
        const isCashLikeMethodDraft = (String(effectiveMethod || '').toUpperCase() === 'CASH') || isCardPaymentDraft;
        const isCashMethodDraft = String(effectiveMethod || '').toUpperCase() === 'CASH';

        // Cash: 결제 금액이 Due 이상이면 대기 상태로 전환 (Tip/Change Due 입력 기회 제공)
        if (isCashMethodDraft && currentAmt >= scopeDueNow && scopeDueNow > 0) {
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
        let finalAmount: number;
        let tipToSend: number;
        finalAmount = Math.min(currentAmt, scopeDueNow);
        tipToSend = parsedTipVal;

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
				
				await onConfirm({ 
					method: effectiveMethod, 
					amount: parseFloat(finalAmount.toFixed(2)), 
					tip: parseFloat(tipToSend.toFixed(2)),
					discountedGrand: grand
				});
				
				setOptimisticPayments(prev => prev.filter(p => p.tempId !== tempId));
				
        if (!isCashLikeMethodDraft && currentAmt > finalAmount) {
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

        const remainingDraft = isCashLikeMethodDraft ? 0 : scopeDueNow - finalAmount;
        if (Math.abs(remainingDraft) < 0.005 && onPaymentComplete) {
          const draftDisplayAmount = isCashLikeMethodDraft
            ? (currentAmt > 0 ? currentAmt : Number((finalAmount + tipToSend).toFixed(2)))
            : Number((finalAmount + tipToSend).toFixed(2));
          const prevPayments = (payments || []).map(p => ({ method: p.method, amount: p.amount }));
          const allPayments = [...prevPayments, { method: effectiveMethod, amount: draftDisplayAmount }];
          const hasCash = allPayments.some(p => (p.method || '').toUpperCase() === 'CASH');
          let draftChange = committedChangeRef.current;
          const totalTip = (payments || []).reduce((sum, p) => sum + ((p as any).tip || 0), 0) + tipToSend;
          const totalPaidAfter = (paidSoFar || 0) + finalAmount;
          const isPartial = Math.abs(totalPaidAfter - grand) > 0.01;
          onPaymentComplete({
            change: draftChange > 0 ? draftChange : 0,
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

	return (
		<div className={`fixed inset-0 bg-black/60 ${zIndexClassName || 'z-50'} flex items-start justify-center`} style={{ paddingTop: '103px' }}>
			<div className="bg-white rounded-2xl shadow-2xl p-0 overflow-hidden relative" onClick={(e) => e.stopPropagation()} style={{ width: '960px', height: 'min(755px, calc(100vh - 16px))', transform: (typeof offsetTopPx === 'number' && offsetTopPx !== 0) ? `translateY(-${offsetTopPx}px)` : undefined }}>
				{/* X Close Button */}
				<button
					onClick={handleCancelClick}
					className="absolute top-[28px] right-[3px] z-10 p-2 rounded-full bg-white/30 hover:bg-white/50 shadow-xl hover:shadow-2xl transition-all border-[3px] border-red-500 ring-3 ring-red-300/50"
					aria-label="Close modal"
				>
					<X size={28} className="text-red-600" strokeWidth={3} />
				</button>
				<div className={`px-3 ${isSplitActive ? 'pt-3' : 'pt-3'}`}>
					<div className={`flex items-center gap-2 border rounded-full shadow px-3 overflow-x-auto whitespace-nowrap transition-all ${
						isSplitActive ? 'bg-blue-50 border-blue-300 py-1.5 min-h-[44px]' : 'bg-gray-50 border-gray-200 py-1.5 min-h-[44px]'
					}`}>
						{Array.from({ length: maxGuestButtons }, (_, i) => i + 1).map((n) => {
              const isActive = effectiveGuestMode === n || (effectiveGuestMode === 'ALL' && n === 1 && !isSplitActive);
              const isPaidGuest = Array.isArray(paidGuests) && paidGuests.includes(n);
              return (
								<button
									key={n}
                  disabled={isPaidGuest}
                  onClick={() => { if (isPaidGuest) return; setForceAllMode(false); if (onSelectGuestMode) onSelectGuestMode(n); }}
                  className={`${isActive ? 'bg-blue-600 text-white' : (isPaidGuest ? 'bg-gray-100 text-gray-400' : 'bg-white text-gray-800')} border border-gray-300 rounded-full px-4 py-1.5 text-sm font-bold ${isPaidGuest ? 'cursor-not-allowed' : 'hover:bg-gray-50'} min-h-[36px]`}
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
						<div className="p-3 md:order-1 bg-gradient-to-b from-green-50 to-green-100 h-full flex flex-col">
							{/* Payment Complete Header */}
							<div className="flex flex-col items-center justify-center py-4">
								<div className="text-4xl mb-2">✓</div>
								<span className="text-2xl font-bold text-green-700">Payment Complete</span>
							</div>
							
							{/* Change Display (현금 결제시 거스름돈 표시) */}
							{(lastChange != null && lastChange > 0) && (
								<div className="w-full rounded-lg bg-red-50 border-2 border-red-300 px-4 py-4 mb-4 flex flex-col items-center">
									<span className="text-lg font-bold text-red-700">Change</span>
									<span className="text-5xl font-extrabold text-red-600">${formatMoney(lastChange)}</span>
								</div>
							)}
							
							{/* Payment Summary */}
							<div className="w-full rounded-lg bg-white border border-gray-300 px-4 py-3 mb-4">
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
										onClick={() => setSelectedReceiptCount(0)}
										className={`py-3 px-2 rounded-lg font-bold text-sm transition-all ${selectedReceiptCount === 0 
											? 'bg-gray-700 text-white border-2 border-gray-900' 
											: 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'}`}
									>
										No Receipt
									</button>
									<button
										onClick={() => setSelectedReceiptCount(1)}
										className={`py-3 px-2 rounded-lg font-bold text-sm transition-all ${selectedReceiptCount === 1 
											? 'bg-blue-600 text-white border-2 border-blue-700' 
											: 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'}`}
									>
										1 Receipt
									</button>
									<button
										onClick={() => setSelectedReceiptCount(2)}
										className={`py-3 px-2 rounded-lg font-bold text-sm transition-all ${selectedReceiptCount === 2 
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
						<div className={`p-3 space-y-3 md:order-1 bg-gray-100 h-full flex flex-col duration-200 transition-opacity ${isSplitCountMode ? 'opacity-30 pointer-events-none filter blur-[1px]' : ''}`}>
							{/* Totals area must stay fixed-height so Change/Due/Paid/Tip positions don't shift
							    even when tax lines vary by region/item. */}
								<div className="h-[110px] flex flex-col">
								<div className="text-sm">
									<div className="flex justify-between"><span>Items</span><span>${formatMoney(displayPricing.baseSubtotal)}</span></div>
                  {displayPricing.discountPercent > 0 && (
                    <div className="flex justify-between text-red-700 font-semibold">
                      <span>Discount ({displayPricing.discountPercent}%)</span>
                      <span>- ${formatMoney(displayPricing.discountAmount)}</span>
                    </div>
                  )}
									{/* Tax lines (scrollable, fixed space) */}
									<div className="mt-1 max-h-[44px] overflow-y-auto space-y-1 pr-1">
										{displayPricing.taxLines && displayPricing.taxLines.length > 0 ? (
											displayPricing.taxLines.map((taxLine, idx) => (
												<div key={idx} className="flex justify-between"><span>{taxLine.name}</span><span>${formatMoney(taxLine.amount)}</span></div>
											))
										) : (
											<div className="flex justify-between"><span>Tax</span><span>${formatMoney(displayPricing.taxesTotal)}</span></div>
										)}
									</div>
								</div>
								<div className="mt-auto flex justify-between text-xl font-bold border-t pt-1.5"><span>Total</span><span>${formatMoney(displayPricing.total)}</span></div>
							</div>
						<div className="mt-3 text-base flex-1 flex flex-col min-h-0">
							{/* Change container at top */}
                                <div
                                    className={`w-full px-0 rounded-md flex flex-col items-center justify-center py-[0.6rem] mb-3 bg-red-50 border border-red-200 ${(displayChange > 0 && !changeDueDigits) ? 'cursor-pointer hover:opacity-90' : 'cursor-default'}`}
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
                                    <div className="flex flex-col items-center -translate-y-[10px] translate-x-[35px]">
                                        <span className={`text-2xl font-bold text-red-700`}>Change $</span>
                                        <span className={`font-extrabold leading-none tracking-tight text-[4.71rem] md:text-[5.09rem] text-red-600`}>{formatMoney(displayChange)}</span>
                                        <span className="mt-[9px] text-sm font-semibold text-red-500">
                                          {changeDueDigits ? `Tip: $${formatMoney(parsedTip)}` : 'Tap to add tip'}
                                        </span>
                                    </div>
                                    {/* Tap Change to convert it to Tip */}
                                </div>
								<div className="h-2" />
								<div className="-mt-[10px]">
								{/* Amounts group */}
								<div className="space-y-1.5">
																{/* Due container: tap to fill display with remaining due for confirmation */}
										<div className="w-full rounded-md border border-blue-200 bg-blue-50 px-4 py-2 h-[5.15rem] flex flex-col items-center justify-center cursor-pointer relative" onClick={handleFillDue}>
											<div className="w-full flex items-center justify-between">
												<span className="text-2xl text-blue-700 whitespace-nowrap font-bold leading-none">Due $</span>
												<span className="text-4xl font-bold text-blue-700 leading-none">{formatMoney(due)}</span>
											</div>
											<span className="text-sm font-semibold text-blue-500 mt-1 w-full text-center">Tap to fill payment amount</span>
									</div>
							{/* Change Due input: 항상 표시, Cash 거스름돈 발생 시 활성화 */}
							{(() => {
								const changeDueEnabled = displayChange > 0 && (lastChange != null && lastChange > 0);
								return (
									<div
										className={`w-full rounded-md border-2 px-4 py-2 h-[3.51rem] flex items-center justify-between transition ${
											!changeDueEnabled
												? 'border-gray-200 bg-gray-100 cursor-not-allowed opacity-50'
												: inputTarget === 'CHANGE_DUE'
													? 'border-orange-500 bg-orange-50 shadow ring-2 ring-orange-200 cursor-pointer'
													: 'border-orange-300 bg-orange-50 hover:bg-orange-100 cursor-pointer'
										}`}
										onClick={() => {
											if (!changeDueEnabled) return;
											const totalChange = displayChange > 0 ? displayChange : (lastChange != null ? lastChange : 0);
											changeDueTotalRef.current = totalChange;
											setInputTarget('CHANGE_DUE');
											setIsTipFocused(false);
										}}
									>
										<span className={`text-2xl font-bold whitespace-nowrap ${changeDueEnabled ? 'text-orange-700' : 'text-gray-400'}`}>Change Due $</span>
										<span className={`text-3xl font-extrabold tabular-nums ${
											!changeDueEnabled ? 'text-gray-400'
											: inputTarget === 'CHANGE_DUE' ? 'text-orange-800' : 'text-orange-600'
										}`}>
											{changeDueDigits ? formatMoney(parseInt(changeDueDigits, 10) / 100) : '0.00'}
										</span>
									</div>
								);
							})()}
							{/* Pay container */}
													<div className="w-full px-4 py-2 rounded-md border bg-white h-[7.02rem] flex flex-col">
									<div className="flex items-center justify-between gap-2">
										<span className="text-2xl text-gray-700 whitespace-nowrap font-bold leading-none h-10 flex items-center">Paid $</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleClearPaidBox}
                        disabled={isClearingPaidBox}
                        className="h-8 px-3 rounded-md border border-red-300 bg-red-50 text-red-700 text-sm font-bold hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed"
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
								<div className="h-[calc(4.29rem-10px)] w-full px-4 rounded-md bg-red-50 border border-red-200 flex items-center justify-between" onClick={() => setInputTarget('TIP')}>
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
						{/* Right: Keypad & Quick */}
						<div className="p-3 md:order-2 bg-gray-300 h-full flex flex-col">
							{/* Customer info moved here */}
                            <div className={`mb-2 flex items-center ${isCenterHeader ? 'justify-center' : 'justify-between'} text-2xl rounded-md px-4 py-4 bg-gray-300 border border-gray-400`}>
                                <span className="text-gray-800 font-extrabold text-2xl">{headerLeftLabel}</span>
                                {!isCenterHeader && (
                                  <span className="text-gray-800 font-semibold text-2xl">{headerRightLabel}</span>
                                )}
                            </div>
					
							{/* Keypad + Quick amounts unified grid - 8 columns */}
							<div className="grid grid-cols-8 gap-2 mb-2">
								{/* Row 1: Display */}
								<div
                  className={`col-span-8 h-[3.96rem] px-3 rounded-md border-2 flex items-center justify-end text-[2.7rem] font-extrabold leading-none tracking-tight tabular-nums overflow-hidden cursor-pointer ${
                    cashReadyForOk
                      ? 'border-green-400 bg-green-50 text-green-800 shadow-[0_0_0_3px_rgba(74,222,128,0.25)]'
                      : inputTarget === 'DISCOUNT'
                      ? 'border-amber-400 bg-amber-50 text-amber-900 shadow-[0_0_0_3px_rgba(251,191,36,0.25)]'
                      : 'border-red-300 bg-red-50 text-red-700'
                  }`}
                  onClick={() => { setInputTarget('AMOUNT'); setIsTipFocused(false); }}
                  title="Tap to enter payment amount"
                >
                  {isSplitCountMode
                    ? (splitCountInput ? `${splitCountInput}` : '—')
                    : (inputTarget === 'DISCOUNT'
                      ? (customDiscountDigits ? `${customDiscountDigits}%` : '—%')
                      : formatInput(inputTarget === 'TIP' ? tip : amount))}
                </div>
                {isSplitCountMode && (
                  <div className="col-span-8 -mt-1 mb-0.5 text-center text-sm font-bold text-gray-700">
                    Equal Split — Enter guest count, then press OK / Enter
                  </div>
                )}
                {cashReadyForOk && !isSplitCountMode && (
                  <div className="col-span-8 -mt-1 mb-0.5 text-center text-sm font-bold text-green-700">
                    Cash ${formatMoney(cashReadyDataRef.current?.rawAmt || 0)} — Enter Tip or Change Due, then press OK
                  </div>
                )}
								{/* Row 2: 1 2 3 $5 */}
                <button className={`col-span-2 h-[4.07rem] w-full rounded-md border ${isSplitCountMode ? 'border-2 border-emerald-400 bg-white text-gray-900 shadow-md ring-2 ring-emerald-200 font-extrabold text-3xl hover:bg-emerald-50' : 'text-2xl font-semibold bg-white text-gray-500 border-gray-300 hover:bg-gray-100'}`} onClick={()=>appendDigit('1')}>1</button>
                <button className={`col-span-2 h-[4.07rem] w-full rounded-md border ${isSplitCountMode ? 'border-2 border-emerald-400 bg-white text-gray-900 shadow-md ring-2 ring-emerald-200 font-extrabold text-3xl hover:bg-emerald-50' : 'text-2xl font-semibold bg-white text-gray-500 border-gray-300 hover:bg-gray-100'}`} onClick={()=>appendDigit('2')}>2</button>
                <button className={`col-span-2 h-[4.07rem] w-full rounded-md border ${isSplitCountMode ? 'border-2 border-emerald-400 bg-white text-gray-900 shadow-md ring-2 ring-emerald-200 font-extrabold text-3xl hover:bg-emerald-50' : 'text-2xl font-semibold bg-white text-gray-500 border-gray-300 hover:bg-gray-100'}`} onClick={()=>appendDigit('3')}>3</button>
                <button className={`col-span-2 h-[4.07rem] w-full rounded-md border text-xl font-semibold bg-blue-50 border-blue-200 text-blue-500 hover:bg-blue-100 ${isSplitCountMode ? 'opacity-35 pointer-events-none' : ''}`} onClick={() => addQuick(5)}>$5</button>

								{/* Row 3: 4 5 6 $10 */}
                <button className={`col-span-2 h-[4.07rem] w-full rounded-md border ${isSplitCountMode ? 'border-2 border-emerald-400 bg-white text-gray-900 shadow-md ring-2 ring-emerald-200 font-extrabold text-3xl hover:bg-emerald-50' : 'text-2xl font-semibold bg-white text-gray-500 border-gray-300 hover:bg-gray-100'}`} onClick={()=>appendDigit('4')}>4</button>
                <button className={`col-span-2 h-[4.07rem] w-full rounded-md border ${isSplitCountMode ? 'border-2 border-emerald-400 bg-white text-gray-900 shadow-md ring-2 ring-emerald-200 font-extrabold text-3xl hover:bg-emerald-50' : 'text-2xl font-semibold bg-white text-gray-500 border-gray-300 hover:bg-gray-100'}`} onClick={()=>appendDigit('5')}>5</button>
                <button className={`col-span-2 h-[4.07rem] w-full rounded-md border ${isSplitCountMode ? 'border-2 border-emerald-400 bg-white text-gray-900 shadow-md ring-2 ring-emerald-200 font-extrabold text-3xl hover:bg-emerald-50' : 'text-2xl font-semibold bg-white text-gray-500 border-gray-300 hover:bg-gray-100'}`} onClick={()=>appendDigit('6')}>6</button>
                <button className={`col-span-2 h-[4.07rem] w-full rounded-md border text-xl font-semibold bg-blue-50 border-blue-200 text-blue-500 hover:bg-blue-100 ${isSplitCountMode ? 'opacity-35 pointer-events-none' : ''}`} onClick={() => addQuick(10)}>$10</button>

								{/* Row 4: 7 8 9 $20 */}
                <button className={`col-span-2 h-[4.07rem] w-full rounded-md border ${isSplitCountMode ? 'border-2 border-emerald-400 bg-white text-gray-900 shadow-md ring-2 ring-emerald-200 font-extrabold text-3xl hover:bg-emerald-50' : 'text-2xl font-semibold bg-white text-gray-500 border-gray-300 hover:bg-gray-100'}`} onClick={()=>appendDigit('7')}>7</button>
                <button className={`col-span-2 h-[4.07rem] w-full rounded-md border ${isSplitCountMode ? 'border-2 border-emerald-400 bg-white text-gray-900 shadow-md ring-2 ring-emerald-200 font-extrabold text-3xl hover:bg-emerald-50' : 'text-2xl font-semibold bg-white text-gray-500 border-gray-300 hover:bg-gray-100'}`} onClick={()=>appendDigit('8')}>8</button>
                <button className={`col-span-2 h-[4.07rem] w-full rounded-md border ${isSplitCountMode ? 'border-2 border-emerald-400 bg-white text-gray-900 shadow-md ring-2 ring-emerald-200 font-extrabold text-3xl hover:bg-emerald-50' : 'text-2xl font-semibold bg-white text-gray-500 border-gray-300 hover:bg-gray-100'}`} onClick={()=>appendDigit('9')}>9</button>
                <button className={`col-span-2 h-[4.07rem] w-full rounded-md border text-xl font-semibold bg-blue-50 border-blue-200 text-blue-500 hover:bg-blue-100 ${isSplitCountMode ? 'opacity-35 pointer-events-none' : ''}`} onClick={() => addQuick(20)}>$20</button>

								{/* Row 5: 0 00 . $50 */}
                <button className={`col-span-2 h-[4.07rem] w-full rounded-md border ${isSplitCountMode ? 'border-2 border-emerald-400 bg-white text-gray-900 shadow-md ring-2 ring-emerald-200 font-extrabold text-3xl hover:bg-emerald-50' : 'text-2xl font-semibold bg-white text-gray-500 border-gray-300 hover:bg-gray-100'}`} onClick={()=>appendDigit('0')}>0</button>
                <button className={`col-span-2 h-[4.07rem] w-full rounded-md border text-2xl font-semibold bg-white text-gray-500 border-gray-300 hover:bg-gray-100 ${isSplitCountMode ? 'opacity-35 pointer-events-none' : ''}`} onClick={()=>appendDigit('00')}>00</button>
                <button className={`col-span-2 h-[4.07rem] w-full rounded-md border text-3xl font-semibold bg-white text-gray-600 border-gray-300 hover:bg-gray-100 ${isSplitCountMode ? 'opacity-35 pointer-events-none' : ''}`} onClick={()=>appendDigit('.')}>.</button>
                <button className={`col-span-2 h-[4.07rem] w-full rounded-md border text-xl font-semibold bg-blue-50 border-blue-200 text-blue-500 hover:bg-blue-100 ${isSplitCountMode ? 'opacity-35 pointer-events-none' : ''}`} onClick={() => addQuick(50)}>$50</button>

								{/* Row 6: Clear (3col) ← (3col) $100 (2col) */}
                <button
                  className="col-span-3 h-[3.37rem] w-full rounded-md border-2 text-lg font-semibold bg-white text-gray-600 border-gray-400 hover:bg-gray-100"
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
                <button className="col-span-3 h-[3.37rem] w-full rounded-md border text-2xl font-semibold bg-white text-gray-600 border-gray-300 hover:bg-gray-100" onClick={()=>appendDigit('BS')}>←</button>
                <button className={`col-span-2 h-[3.37rem] w-full rounded-md border text-xl font-semibold bg-blue-50 border-blue-200 text-blue-500 hover:bg-blue-100 ${isSplitCountMode ? 'opacity-35 pointer-events-none' : ''}`} onClick={() => addQuick(100)}>$100</button>
							</div>
							<div className="h-3" />
            <div className="mt-0 mb-0 grid grid-cols-2 gap-2">
                <button 
                  onClick={isSplitCountMode ? handleSplitCountCancel : handleCancelClick} 
                  className="h-[4.00rem] w-full rounded-md bg-gray-700 text-white hover:bg-gray-800 active:bg-red-600 active:text-white font-bold"
                >
                  {isSplitCountMode ? 'Cancel Split' : 'Cancel'}
                </button>
                <button 
                  onClick={isSplitCountMode ? handleSplitCountConfirm : (proceedArmed ? proceedNext : finalizeAndComplete)} 
                  className={`${(isSplitCountMode ? splitCountInput.length > 0 : canClickOk) ? 'h-[4.00rem] w-full rounded-md bg-green-600 text-white hover:bg-green-700 active:bg-red-600' : 'h-[4.00rem] w-full rounded-md bg-green-200 text-green-700 cursor-not-allowed'} font-bold`} 
                  disabled={isSplitCountMode ? splitCountInput.length === 0 : !canClickOk}
                >
                  {isSplitCountMode ? 'Confirm' : (proceedArmed ? 'Next' : 'OK')}
                </button>
            </div>
							<div className="h-3" />
					</div>

					{/* Methods + Discount (right column) */}
					<div className={`bg-gray-100 border-l p-2 md:order-3 flex flex-col h-full duration-200 transition-opacity ${isSplitCountMode ? 'opacity-30 pointer-events-none filter blur-[1px]' : ''}`}>
            {/* Payment tools (8 buttons, 4 cols x 2 rows) */}
            <div className="mb-2 rounded-lg border border-gray-300 bg-white p-2">
              <div className="text-xs font-extrabold text-gray-600 mb-1">PAYMENT</div>
              <div className="grid grid-cols-2 gap-1">
                {[
                  ...methods.filter(m => m.key !== 'GIFT' && m.key !== 'OTHER').map(m => ({ key: m.key, label: m.label, onClick: () => commitDraft(m.key) })),
                  { key: 'GIFT', label: 'Gift', onClick: openGiftCardModal },
                  { key: 'COUPON', label: 'Coupon', onClick: () => commitDraft('COUPON') },
                  { key: 'OTHER', label: 'Other', onClick: () => commitDraft('OTHER') },
                ].slice(0, 8).map(btn => (
                  <button
                    key={btn.key}
                    onClick={btn.onClick}
                    className={`min-h-[40px] rounded-lg border transition active:bg-red-600 active:text-white active:border-red-600 font-extrabold text-sm px-2 ${
                      method===btn.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-100'
                    }`}
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

            {/* Discount panel */}
            <div className="mb-2 rounded-lg border border-gray-300 bg-white p-2">
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs font-extrabold text-gray-600">DISCOUNT</div>
                <div className={`text-xs font-extrabold ${pricingEffective.discountPercent > 0 ? 'text-red-700' : 'text-gray-500'}`}>
                  {pricingEffective.discountPercent > 0 ? `-${pricingEffective.discountPercent}%` : 'OFF'}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {DISCOUNT_PRESETS.map((p) => {
                  const active = (!isCustomDiscount) && discountPreset === p;
                  return (
                    <button
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
                      className={`min-h-[40px] rounded-lg border font-extrabold text-sm transition active:bg-red-600 active:text-white active:border-red-600 ${
                        active ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      {p}%
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 1/N Split panel */}
            <div className="mb-2 rounded-lg border border-emerald-300 bg-emerald-50 p-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-emerald-700">1/N Split</span>
                {splitNActive > 0 && (
                  <button className="text-[10px] font-bold text-red-500 hover:text-red-700" onClick={() => {
                    setSplitNActive(0); setSplitNCustomMode(false); setSplitNCustomDigits('');
                    setInputTarget('AMOUNT'); setLastChange(null);
                    setAmount('0.00'); setRawAmountDigits(''); setTip('0'); setMethod('');
                  }}>Clear</button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-1">
                {[2,3,4,5,6,7,8,9].map(n => {
                  const active = splitNActive === n && !splitNCustomMode;
                  return (
                    <button key={n} type="button"
                      className={`min-h-[40px] rounded-lg border-2 text-xs font-extrabold transition ${
                        active ? 'border-emerald-600 bg-emerald-600 text-white shadow' : 'border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-100'
                      }`}
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
                <button type="button"
                  className={`min-h-[40px] rounded-lg border-2 text-xs font-extrabold transition ${
                    splitNCustomMode ? 'border-amber-500 bg-amber-500 text-white shadow' : 'border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-100'
                  }`}
                  onClick={() => {
                    if (splitNCustomMode) {
                      setSplitNCustomMode(false); setSplitNActive(0); setSplitNCustomDigits('');
                      return;
                    }
                    setSplitNCustomMode(true); setSplitNActive(0); setSplitNCustomDigits('');
                    setInputTarget('SPLIT_N'); setIsTipFocused(false); setLastChange(null);
                  }}>
                  Custom
                </button>
              </div>
              {splitNCustomMode && (
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="text-xs font-bold text-amber-700">Guests:</span>
                  <span className="text-lg font-extrabold text-amber-900 tabular-nums min-w-[2rem] text-center">
                    {splitNCustomDigits || '—'}
                  </span>
                  <span className="text-[10px] text-amber-600">Use keypad, then press a payment method</span>
                </div>
              )}
              {splitNActive > 0 && (() => {
                const gc = Math.round(grand * 100);
                const hi = calcFairShare(gc, splitNActive, 1);
                const lo = calcFairShare(gc, splitNActive, splitNActive);
                return (
                  <div className="mt-1 text-[11px] font-bold text-emerald-700">
                    {formatMoney(grand)} ÷ {splitNActive} = {hi === lo
                      ? <>{formatMoney(hi)} per person</>
                      : <>{formatMoney(hi)} ~ {formatMoney(lo)} per person</>
                    }
                  </div>
                );
              })()}
            </div>

            {/* Split Bill button */}
            {typeof onSplitBill === 'function' && (
              <div className="rounded-lg border border-gray-300 bg-white p-2">
                <button
                  className="w-full flex items-center justify-center px-3 py-[0.68rem] rounded-lg border-2 border-purple-500 bg-purple-50 text-purple-700 hover:bg-purple-100 shadow font-bold"
                  onClick={() => onSplitBill()}
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
							onClick={() => {
								setAlertMessage(null);
								if (alertTimerRef.current) {
									window.clearTimeout(alertTimerRef.current);
									alertTimerRef.current = null;
								}
							}}
							className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
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
									onClick={handleCancelDismiss}
									className="flex-1 py-3 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold transition-all"
								>
									Go Back
								</button>
								<button
									onClick={handleCancelConfirmed}
									className="flex-1 py-3 rounded-lg bg-red-500 hover:bg-red-600 text-white font-semibold transition-all"
								>
									Yes, Cancel All
								</button>
							</div>
						</div>
					</div>
				</div>
			)}

			{/* Gift Card Payment Modal */}
			{showGiftCardModal && (
				<div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
					<div className="bg-white rounded-xl shadow-2xl w-[420px] overflow-hidden">
						{/* Header */}
						<div className="bg-gradient-to-r from-amber-500 to-amber-600 px-3 py-2 flex justify-between items-center">
							<h3 className="text-base font-bold text-white">Gift Card Payment</h3>
							<button 
								onClick={() => { setShowGiftCardModal(false); resetGiftCard(); }}
								className="text-white hover:text-gray-200 text-xl font-bold leading-none"
							>
								&times;
							</button>
						</div>

						<div className="p-3 space-y-2">
							{/* Remaining Due */}
							<div className="bg-blue-50 border border-blue-200 rounded-lg py-1.5 px-2 text-center">
								<div className="text-xs text-blue-600">Remaining Due</div>
								<div className="text-lg font-bold text-blue-700">${remainingDue.toFixed(2)}</div>
							</div>

							{/* Card Number Display */}
							<div 
								onClick={() => setGiftCardInputFocus('card')}
								className={`py-2 px-3 rounded-lg cursor-pointer transition-all ${giftCardInputFocus === 'card' ? 'bg-amber-50 border-2 border-amber-400' : 'bg-gray-100 border-2 border-gray-200'}`}
							>
								<div className="text-xs font-semibold text-gray-600 mb-0.5">Card Number</div>
								<div className="text-xl font-mono tracking-wide text-center text-gray-800">
									{giftCardNumber.slice(0, 4) || <span className="text-gray-300">____</span>}
									{'-'}
									{giftCardNumber.slice(4, 8) || <span className="text-gray-300">____</span>}
									{'-'}
									{giftCardNumber.slice(8, 12) || <span className="text-gray-300">____</span>}
									{'-'}
									{giftCardNumber.slice(12, 16) || <span className="text-gray-300">____</span>}
								</div>
							</div>

							{/* Balance & Pay Amount Row */}
							<div className="flex gap-2">
								{/* Balance Display */}
								<div className={`flex-1 py-1.5 px-2 rounded-lg text-center ${giftCardBalance !== null ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border border-gray-200'}`}>
									<div className="text-xs text-gray-600">Balance</div>
									<div className={`text-lg font-bold ${giftCardBalance !== null ? 'text-green-700' : 'text-gray-400'}`}>
										{giftCardBalance !== null ? `$${giftCardBalance.toFixed(2)}` : '---'}
									</div>
								</div>

								{/* Pay Amount */}
								<div 
									onClick={() => giftCardBalance !== null && setGiftCardInputFocus('amount')}
									className={`flex-1 py-1.5 px-2 rounded-lg text-center cursor-pointer transition-all ${giftCardInputFocus === 'amount' && giftCardBalance !== null ? 'bg-amber-50 border-2 border-amber-400' : 'bg-gray-50 border-2 border-gray-200'}`}
								>
									<div className="text-xs text-gray-600">Pay Amount</div>
									<div className="text-lg font-bold text-gray-800">
										${giftCardPayAmount || '0.00'}
									</div>
								</div>
							</div>

							{/* Quick Pay Buttons - always show space to prevent modal height change */}
							<div className="flex gap-2 h-[48px]">
								{giftCardBalance !== null && (
									<>
										{giftCardBalance >= remainingDue ? (
											<button
												onClick={() => { setGiftCardPayAmount(remainingDue.toFixed(2)); }}
												className="flex-1 py-3 rounded-lg bg-green-500 hover:bg-green-600 text-white font-semibold transition-all"
											>
												Full ${remainingDue.toFixed(2)}
											</button>
										) : (
											<button
												onClick={() => { setGiftCardPayAmount(giftCardBalance.toFixed(2)); }}
												className="flex-1 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold transition-all"
											>
												Use All ${giftCardBalance.toFixed(2)}
											</button>
										)}
									</>
								)}
							</div>

							{/* Numpad */}
							<div className="bg-gray-100 p-1.5 rounded-lg">
								<div className="grid grid-cols-3 gap-1">
									{['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map((key, idx) => (
											<button
												key={idx}
												onClick={() => handleGiftCardKeypadPress(key)}
												className={`py-3 rounded-lg text-lg font-semibold transition-all active:scale-95 ${
													key === '⌫' ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200' :
													key === '.' ? 'bg-gray-200 text-gray-700 hover:bg-gray-300' :
													'bg-white text-gray-800 hover:bg-gray-50 border border-gray-300'
												}`}
											>
												{key}
											</button>
									))}
								</div>
							</div>

							{/* Error Message */}
							{giftCardError && (
								<div className="bg-red-50 border border-red-200 rounded-lg py-1.5 px-2 text-center">
									<div className="text-red-600 text-xs font-medium">{giftCardError}</div>
								</div>
							)}

							{/* Action Buttons - Balance, Cancel & Pay */}
							<div className="flex gap-2">
								<button
									onClick={handleCheckGiftCardBalance}
									disabled={giftCardLoading || giftCardNumber.length !== 16}
									className="w-1/4 py-3 rounded-lg bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white font-semibold transition-all"
								>
									{giftCardLoading ? '...' : 'Balance'}
								</button>
								<button
									onClick={() => { setShowGiftCardModal(false); resetGiftCard(); }}
									className="flex-1 py-3 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold transition-all"
								>
									Cancel
								</button>
								<button
									onClick={handleGiftCardPay}
									disabled={giftCardLoading || giftCardBalance === null || !giftCardPayAmount || parseFloat(giftCardPayAmount) <= 0}
									className="flex-1 py-3 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 text-white font-semibold transition-all"
								>
									{giftCardLoading ? '...' : 'Pay'}
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

export default PaymentModal; 
