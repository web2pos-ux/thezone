import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import { OrderItem } from '../pages/order/orderTypes';
import { API_URL } from '../config/constants';

interface PaymentCompleteData {
	change: number;
	total: number;
	payments: Array<{ method: string; amount: number }>;
	hasCashPayment: boolean;
	isPartialPayment?: boolean;  // 부분 결제 (게스트별 결제 중 일부만 결제)
}

interface PaymentModalProps {
	isOpen: boolean;
	onClose: () => void;
	subtotal: number;
	taxLines: Array<{ name: string; amount: number }>; 
	total: number;
	onConfirm: (payload: { method: string; amount: number; tip: number }) => void;
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
	onVoidPayment?: (paymentId: number) => void;
	onClearAllPayments?: () => void;
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

const PaymentModal: React.FC<PaymentModalProps> = ({ isOpen, onClose, subtotal, taxLines, total, onConfirm, onComplete, onPaymentComplete, channel, customerName, tableName, onSplitBill, guestCount, guestMode, onSelectGuestMode, forceGuestMode, showAllButton, outstandingDue, paidSoFar, payments, onVoidPayment, onClearAllPayments, prefillDueNonce, prefillUseTotalOnceNonce, offsetTopPx, onCreateAdhocGuests, orderItems = [], onShareSelected }) => {
	const [method, setMethod] = useState<string>('');
	const skipAmountResetRef = useRef<boolean>(false);
	const [amount, setAmount] = useState<string>('0.00');
	const [tip, setTip] = useState<string>('0');
	const [isTipFocused, setIsTipFocused] = useState<boolean>(false);
	const [optimisticPayments, setOptimisticPayments] = useState<Array<{ tempId: string; method?: string; amount: number }>>([]);
	const [rawAmountDigits, setRawAmountDigits] = useState<string>('');
  const [clampPopup, setClampPopup] = useState<{ entered: number; applied: number; method?: string } | null>(null);
  const clampTimerRef = useRef<number | null>(null);
  const [proceedArmed, setProceedArmed] = useState<boolean>(false);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const alertTimerRef = useRef<number | null>(null);
  const [lastChange, setLastChange] = useState<number | null>(null);
  const [forceAllMode, setForceAllMode] = useState<boolean>(false);
  const [isSplitCountMode, setIsSplitCountMode] = useState<boolean>(false);
  const [splitCountInput, setSplitCountInput] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);  // 더블 클릭 방지용
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

  // 초기 금액 고정 (Items, Tax, Total은 결제 후에도 절대 변경되지 않아야 함)
  const initialSubtotalRef = useRef<number | null>(null);
  const initialTaxTotalRef = useRef<number | null>(null);
  const initialTaxLinesRef = useRef<Array<{ name: string; amount: number }> | null>(null);
  const initialGrandRef = useRef<number | null>(null);
  const wasOpenRef = useRef<boolean>(false);
  
  // 모달이 열릴 때 한 번만 초기값 저장 (결제 후에도 절대 변경되지 않음)
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      // 모달이 처음 열릴 때만 초기값 저장 (한 번 저장되면 절대 변경되지 않음)
      const taxTotal = taxLines.reduce((s, t) => s + t.amount, 0);
      const grand = parseFloat((subtotal + taxTotal).toFixed(2));
      initialSubtotalRef.current = subtotal;
      initialTaxTotalRef.current = taxTotal;
      initialTaxLinesRef.current = taxLines.map(t => ({ name: t.name, amount: t.amount }));
      initialGrandRef.current = grand;
      wasOpenRef.current = true;
      console.log('[PAYMENT] 초기값 고정:', { subtotal, taxTotal, taxLines, grand });
    } else if (!isOpen && wasOpenRef.current) {
      // 모달이 닫히면 플래그만 리셋 (초기값은 유지하지 않음 - 다음 열 때 새로 저장)
      wasOpenRef.current = false;
      initialSubtotalRef.current = null;
      initialTaxTotalRef.current = null;
      initialTaxLinesRef.current = null;
      initialGrandRef.current = null;
    }
  }, [isOpen]); // subtotal, taxLines를 의존성에서 제거하여 결제 후 변경되어도 초기값이 바뀌지 않도록 함

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

	useEffect(() => { if (!isOpen) { setRawAmountDigits(''); resetGiftCard(); setShowGiftCardModal(false); setIsShareSelectedMode(false); setShareSelectedRowIndex(null); setShareTargetGuests(new Set()); } }, [isOpen, resetGiftCard]);
	useEffect(() => { if (isOpen) { setProceedArmed(false); setLastChange(null); } }, [isOpen]);
	useEffect(() => { return () => { if (clampTimerRef.current) { window.clearTimeout(clampTimerRef.current); clampTimerRef.current = null; } if (alertTimerRef.current) { window.clearTimeout(alertTimerRef.current); alertTimerRef.current = null; } }; }, []);

	const showClampPopup = (entered: number, applied: number, method?: string) => {
		setClampPopup({ entered, applied, method });
		if (clampTimerRef.current) { window.clearTimeout(clampTimerRef.current); }
		clampTimerRef.current = window.setTimeout(() => {
			setClampPopup(null);
			clampTimerRef.current = null;
		}, 2200);
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
	const fixedSubtotal = initialSubtotalRef.current !== null ? initialSubtotalRef.current : subtotal;
	const fixedTaxTotal = initialTaxTotalRef.current !== null ? initialTaxTotalRef.current : taxLines.reduce((s, t) => s + t.amount, 0);
	const fixedGrand = initialGrandRef.current !== null ? initialGrandRef.current : parseFloat((subtotal + fixedTaxTotal).toFixed(2));
	
	const taxTotal = fixedTaxTotal; // 화면 표시용 (고정값)
	const parsedAmount = useMemo(() => parseFloat(amount) || 0, [amount]);
	const parsedTip = useMemo(() => parseFloat(tip) || 0, [tip]);
  const grand = fixedGrand; // 화면 표시용 (고정값)
  const effectiveGuestMode = useMemo(() => {
    if (typeof forceGuestMode !== 'undefined') return forceGuestMode;
    return (forceAllMode ? 'ALL' : guestMode);
  }, [forceGuestMode, forceAllMode, guestMode]);
  // Remaining due in current scope (after confirmed payments)
  // 우선순위: 실제 확정 결제(`payments`) 합계를 신뢰하고, 외부에서 전달된 outstandingDue는 보조로 사용
  // 중요: fixedGrand를 사용하여 Total 금액이 고정되도록 함
  const remainingDue = useMemo(() => {
    try {
      // 1) payments 기준으로 계산 (게스트 스코프를 고려한 합계는 아래 paymentsInScope/confirmed 합계로 산출)
      // paymentsInScope는 아래에서 정의되므로, 여기서는 우선 전체 기준 보정값만 사용하고 최종 due 계산에서 정밀 보정
      const baseByProp = (typeof outstandingDue === 'number') ? Number(outstandingDue.toFixed(2)) : Number(fixedGrand.toFixed(2));
      // In Even Split mode, we should trust baseByProp (calculated per guest) rather than grand (total for all)
      if (onCreateAdhocGuests && guestCount && guestCount > 1 && baseByProp <= Number(fixedGrand.toFixed(2))) {
         return Math.max(0, baseByProp);
      }
      // Fallback
      return Math.max(0, baseByProp);
    } catch {
      return Math.max(0, Number(fixedGrand.toFixed(2)));
    }
  }, [outstandingDue, fixedGrand, onCreateAdhocGuests, guestCount]);

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
    const payAmount = parseFloat(giftCardPayAmount);
    
    if (!payAmount || payAmount <= 0) {
      setGiftCardError('Please enter a valid amount');
      return;
    }
    if (giftCardBalance === null) {
      setGiftCardError('Please check balance first');
      return;
    }
    if (payAmount > giftCardBalance) {
      setGiftCardError('Insufficient balance');
      return;
    }
    if (payAmount > remainingDue) {
      setGiftCardError('Amount exceeds remaining due');
      return;
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
        onConfirm({ method: 'GIFT', amount: payAmount, tip: 0 });
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
  }, [giftCardNumber, giftCardPayAmount, giftCardBalance, remainingDue, onConfirm, resetGiftCard]);

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
  } catch {}
}, [isOpen, effectiveGuestMode]);

  // Removed auto-commit: 결제도구/금액 조합은 OK 시점에만 확정

  const finalizeAndComplete = async () => {
    // canClickOk 조건 확인: (Next 단계) 또는 (금액>0 && 결제도구 선택됨) 또는 (잔액≈0)
    if (!canClickOk) return;
    // 더블 클릭 방지
    if (isProcessing) {
      console.log('⚠️ Payment already processing, ignoring duplicate click');
      return;
    }
    try {
      // OK 시점 확정: 가장 마지막 결제도구(method)와 현재 입력 금액(amount) 조합만 확정 처리
      const rawAmt = parsedAmount;
      if (rawAmt > 0) {
        if (!method) { showAlert('Please select a payment method.'); return; }
        setIsProcessing(true);  // 결제 처리 시작
        const effectiveMethod = method;
        const confirmedTotalNow = Number(((cashPaidConfirmed + nonCashPaidConfirmed)).toFixed(2));
        // scopeDueNow 계산: fixedGrand에서 이미 결제한 금액을 빼서 남은 금액 계산 (Total은 고정)
        // adhoc split 모드에서는 outstandingDue를 직접 사용 (이미 결제 반영된 값)
        let scopeDueNow: number;
        if (onCreateAdhocGuests && isSplitActive && typeof outstandingDue === 'number') {
          scopeDueNow = Math.max(0, Number(outstandingDue.toFixed(2)));
        } else {
          scopeDueNow = Math.max(0, Number((fixedGrand - confirmedTotalNow).toFixed(2)));
        }
        // Cash일 때는 입력값을 그대로 사용 (Change 발생), Cash가 아닐 때만 Due에 맞춰 clamp
        const finalAmount = (effectiveMethod === 'CASH') ? rawAmt : Math.min(rawAmt, scopeDueNow);
        const t = parsedTip;
        // OK 버튼 클릭 시 lastChange를 즉시 null로 설정하여 change 변수를 사용하도록 함
        setLastChange(null);
        const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
        setOptimisticPayments(prev => [...prev, { tempId, method: effectiveMethod, amount: finalAmount }]);
        setRawAmountDigits('');
        await onConfirm({ method: effectiveMethod, amount: parseFloat(finalAmount.toFixed(2)), tip: parseFloat(t.toFixed(2)) });
        setOptimisticPayments(prev => prev.filter(p => p.tempId !== tempId));
        if (effectiveMethod !== 'CASH' && rawAmt > finalAmount) {
          showClampPopup(rawAmt, finalAmount, effectiveMethod);
        }
        setAmount('0.00');
        setTip('0');
        setMethod('');
        setIsProcessing(false);  // 결제 처리 완료
        
        // 결제 처리 후 잔액이 0이면 바로 Payment Complete 모달 표시
        // scopeDueNow - finalAmount로 남은 잔액 계산 (Cash는 더 많이 받을 수 있음)
        const remainingAfterPayment = effectiveMethod === 'CASH' 
          ? 0  // Cash는 항상 결제 완료로 처리 (거스름돈 발생)
          : scopeDueNow - finalAmount;
        
        if (Math.abs(remainingAfterPayment) < 0.005 && onPaymentComplete) {
          // 결제 완료됨 - 바로 Payment Complete 모달 표시
          const updatedPayments = [...(payments || []), { method: effectiveMethod, amount: finalAmount, paymentId: 0, tip: 0 }];
          const paymentsData = updatedPayments.map(p => ({ method: p.method, amount: p.amount }));
          const hasCash = paymentsData.some(p => (p.method || '').toUpperCase() === 'CASH');
          const currentChange = effectiveMethod === 'CASH' ? Math.max(0, rawAmt - scopeDueNow) : 0;
          
          // 부분 결제 여부 판단: 게스트별 결제 중 전체 금액이 아직 결제되지 않은 경우
          const totalPaidAfter = (paidSoFar || 0) + finalAmount;
          const isPartial = Math.abs(totalPaidAfter - fixedGrand) > 0.01;  // 전체 금액과 비교
          
          onPaymentComplete({
            change: currentChange,
            total: fixedGrand,
            payments: paymentsData,
            hasCashPayment: hasCash,
            isPartialPayment: isPartial
          });
          return;  // 여기서 바로 리턴
        }
      } else if (canComplete) {
        // 금액이 0이지만 잔액이 0에 근접한 경우 (이미 모든 결제가 완료된 경우)
        // 별도 Payment Complete 모달 표시
        if (onPaymentComplete) {
          const paymentsData = (payments || []).map(p => ({ method: p.method, amount: p.amount }));
          const hasCash = paymentsData.some(p => (p.method || '').toUpperCase() === 'CASH');
          const currentChange = lastChange != null ? lastChange : change;
          
          // 부분 결제 여부 판단: 전체 금액이 아직 결제되지 않은 경우
          const totalPaid = paymentsData.reduce((sum, p) => sum + (p.amount || 0), 0);
          const isPartial = Math.abs(totalPaid - fixedGrand) > 0.01;
          
          onPaymentComplete({
            change: currentChange > 0 ? currentChange : 0,
            total: fixedGrand,
            payments: paymentsData,
            hasCashPayment: hasCash,
            isPartialPayment: isPartial
          });
        } else {
          // fallback to old behavior
          setProceedArmed(true);
        }
      }
    } catch (e) {
      // 에러 시 optimisticPayments 정리 및 상태 초기화
      setOptimisticPayments(prev => prev.slice(0, -1));
      setAmount('0.00');
      setRawAmountDigits('');
      setMethod('');
      setIsProcessing(false);
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
      const sum = scoped.reduce((s, p:any) => s + (p.amount || 0), 0);
      return Number(sum.toFixed(2));
    }
    if (typeof paidSoFar === 'number') return Number(paidSoFar.toFixed(2));
    if (typeof outstandingDue === 'number') return Number((fixedGrand - outstandingDue).toFixed(2));
    return 0;
  }, [payments, paidSoFar, outstandingDue, fixedGrand, effectiveGuestMode]);
  // Paid $ 합계는 확정 결제만 합산 (Processing/optimistic 제외)
  const displayPaidTotal = useMemo(() => parseFloat(((paidTotal)).toFixed(2)), [paidTotal]);
  const isSplitActive = useMemo(() => (typeof effectiveGuestMode === 'number') || ((guestCount || 0) > 1), [effectiveGuestMode, guestCount]);
	const maxGuestButtons = useMemo(() => Math.min(8, (guestCount || 8)), [guestCount]);
 

	// Change calculation based on confirmed payments across methods
	const paymentsInScope = useMemo(() => {
		if (!Array.isArray(payments)) return [] as Array<{ method: string; amount: number; guestNumber?: number }>;
		if (typeof effectiveGuestMode === 'number') {
			return payments.filter(p => p.guestNumber === effectiveGuestMode);
		}
		return payments;
	}, [payments, effectiveGuestMode]);

	const { cashPaidConfirmed, nonCashPaidConfirmed } = useMemo(() => {
		let cash = 0, nonCash = 0;
		paymentsInScope.forEach(p => {
			if ((p.method || '').toUpperCase() === 'CASH') cash += (p.amount || 0);
			else nonCash += (p.amount || 0);
		});
		return { cashPaidConfirmed: parseFloat(cash.toFixed(2)), nonCashPaidConfirmed: parseFloat(nonCash.toFixed(2)) };
	}, [paymentsInScope]);

  // 방법 3: 다음 액션 시 자동 확정
  // 이전에 준비된 조합(결제 수단 + 금액)이 있으면 먼저 확정하는 헬퍼 함수
  const commitPendingIfReady = useCallback(async () => {
    // 더블 클릭 방지
    if (isProcessing) {
      console.log('⚠️ Payment already processing (commitPendingIfReady), ignoring');
      return;
    }
    const currentAmt = parseFloat(amount || '0') || 0;
    if (method && currentAmt > 0) {
      // 준비된 조합이 있으면 확정
      // finalizeAndComplete의 로직을 직접 사용 (무한 루프 방지)
      try {
        setIsProcessing(true);  // 결제 처리 시작
        // finalizeAndComplete와 동일한 로직 사용
        const effectiveMethod = method;
        const confirmedTotalNow = Number(((cashPaidConfirmed + nonCashPaidConfirmed)).toFixed(2));
        // scopeDueNow 계산: fixedGrand에서 이미 결제한 금액을 빼서 남은 금액 계산 (Total은 고정)
        // adhoc split 모드에서는 outstandingDue를 직접 사용 (이미 결제 반영된 값)
        let scopeDueNow: number;
        if (onCreateAdhocGuests && isSplitActive && typeof outstandingDue === 'number') {
          scopeDueNow = Math.max(0, Number(outstandingDue.toFixed(2)));
        } else {
          scopeDueNow = Math.max(0, Number((fixedGrand - confirmedTotalNow).toFixed(2)));
        }
        // Cash일 때는 입력값을 그대로 사용 (Change 발생), Cash가 아닐 때만 Due에 맞춰 clamp
        const finalAmount = (effectiveMethod === 'CASH') ? currentAmt : Math.min(currentAmt, scopeDueNow);
        const t = parsedTip;
        const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
        setOptimisticPayments(prev => [...prev, { tempId, method: effectiveMethod, amount: finalAmount }]);
        setRawAmountDigits('');
        await onConfirm({ method: effectiveMethod, amount: parseFloat(finalAmount.toFixed(2)), tip: parseFloat(t.toFixed(2)) });
        setOptimisticPayments(prev => prev.filter(p => p.tempId !== tempId));
        if (effectiveMethod !== 'CASH' && currentAmt > finalAmount) {
          showClampPopup(currentAmt, finalAmount, effectiveMethod);
        }
        setAmount('0.00');
        setTip('0');
        setMethod('');
        setIsProcessing(false);  // 결제 처리 완료
      } catch (e) {
        // 에러 시 optimisticPayments 정리 및 상태 초기화
        setOptimisticPayments(prev => prev.slice(0, -1));
        setAmount('0.00');
        setRawAmountDigits('');
        setMethod('');
        setIsProcessing(false);
        showAlert('Payment failed. Please try again.');
        try { console.error('Auto-commit failed', e); } catch {}
      }
    }
  }, [method, amount, cashPaidConfirmed, nonCashPaidConfirmed, fixedGrand, parsedTip, onConfirm, showClampPopup, onCreateAdhocGuests, isSplitActive, outstandingDue, isProcessing]);

  // Confirmed 결제를 반영해 최종 남은 금액(dueFull)과 화면 Due 값을 계산
  const due = useMemo(() => {
    // In adhoc split mode, we trust outstandingDue prop passed from parent which is calculated per guest
    if (onCreateAdhocGuests && isSplitActive && typeof outstandingDue === 'number') {
        // outstandingDue is already (MyTotal - MyPaid).
        // We subtract parsedAmount to show remaining balance if user is typing a partial payment?
        // Or if parsedAmount is 0, it shows full outstandingDue.
        return Math.max(0, Number((outstandingDue - parsedAmount).toFixed(2)));
    }

    const confirmedTotal = Number(((cashPaidConfirmed + nonCashPaidConfirmed)).toFixed(2));
    const dueFull = Math.max(0, Number((fixedGrand - confirmedTotal).toFixed(2)));
    return Math.max(0, Number((dueFull - parsedAmount).toFixed(2)));
  }, [fixedGrand, cashPaidConfirmed, nonCashPaidConfirmed, parsedAmount, outstandingDue, onCreateAdhocGuests, isSplitActive]);


  // Next는 사용자 조작으로만 진행 (자동 완료 제거)

  const change = useMemo(() => {
    // Change는 "현금으로 지불한 금액이 실제 필요한 금액보다 많을 때의 초과분"만 표시한다.
    // Cash 결제의 경우, Due가 0이어도 현금을 더 많이 받았으면 Change를 계산해야 함
    
    // 현금으로 지불한 금액 (확정된 현금 + 입력 중인 현금 금액)
    const projectedCash = Number(((cashPaidConfirmed + ((method === 'CASH') ? parsedAmount : 0))).toFixed(2));
    
    // 현금 결제 전 Due 계산 (현금으로 지불해야 할 금액)
    // fixedGrand에서 비현금 결제만 빼서 계산
    const dueBeforeCash = Math.max(0, Number((fixedGrand - nonCashPaidConfirmed).toFixed(2)));
    
    // Change = 현금 지불액 - 현금 결제 전 Due (현금이 더 많을 때만)
    // Cash가 아닌 결제 수단이면 Change는 0
    if (method !== 'CASH' && parsedAmount === 0) {
      // Cash 결제가 없고 입력 중인 금액도 Cash가 아니면 Change는 0
      const ch = Math.max(0, Number((cashPaidConfirmed - dueBeforeCash).toFixed(2)));
      return ch;
    }
    
    // Cash 결제가 있거나 입력 중인 경우
    const ch = Math.max(0, Number((projectedCash - dueBeforeCash).toFixed(2)));
    return ch;
  }, [fixedGrand, cashPaidConfirmed, nonCashPaidConfirmed, method, parsedAmount]);
 
  // canComplete: 잔액이 0에 충분히 근접하면 완료 가능
  const canComplete = useMemo(() => Math.abs(due) < 0.005, [due]);
  // OK 버튼 활성화 조건: (Next 단계) 또는 (금액>0 && 결제도구 선택됨) 또는 (잔액≈0)
  const canClickOk = useMemo(() => {
    const hasDraft = (parsedAmount > 0) && !!method;
    return proceedArmed || hasDraft || canComplete;
  }, [proceedArmed, parsedAmount, method, canComplete]);

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

		if (isTipFocused) {
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
			setTip(updaterTip);
			return;
		}
		// 숫자 버튼은 단순히 금액 입력만 함
		// 결제 수단 선택 시에만 확정됨 (commitPendingIfReady 제거)
		// amount: maintain raw cents buffer to avoid premature formatting issues
		let nextRaw = rawAmountDigits;
		if (d === 'C') nextRaw = '';
		else if (d === 'BS') nextRaw = nextRaw.slice(0, -1);
		else if (d === '00') nextRaw = (nextRaw + '00').replace(/^0+(\d)/, '$1');
		else if (/^[0-9]$/.test(d)) nextRaw = (nextRaw + d).replace(/^0+(\d)/, '$1');
		// '.' is ignored because we use implicit cents
		setRawAmountDigits(nextRaw);
		const cents = nextRaw === '' ? 0 : parseInt(nextRaw, 10);
		const next = (cents / 100).toFixed(2);
		setAmount(next);

	};

const addQuick = async (q: number) => {
    if (isTipFocused) {
        setTip(prev => (parseFloat(prev || '0') + q).toFixed(2));
        return;
    }
    // 금액 버튼은 단순히 현재 금액에 합산만 함
    // 결제 수단 선택 시 확정됨 (commitPendingIfReady 제거)
    const current = parseFloat(amount || '0') || 0;
    const next = Math.max(0, parseFloat((current + q).toFixed(2)));
    const cents = Math.round(next * 100);
    setRawAmountDigits(String(cents));
    setAmount(next.toFixed(2));
    // 결제 수단은 사용자가 선택한 것을 유지
};

	const handleTipChange = (raw: string) => {
		const digitsOnly = (raw || '').replace(/[^0-9]/g, '');
		const cents = digitsOnly === '' ? 0 : parseInt(digitsOnly, 10);
		const formatted = (cents / 100).toFixed(2);
		setTip(formatted);
	};

	// Explicitly fill display with remaining due (no commit) when user taps Due
	const handleFillDue = async () => {
		// 방법 3: 다음 액션 시 자동 확정
		// 이전에 준비된 조합(결제 수단 + 금액)이 있으면 먼저 확정
		await commitPendingIfReady();
		const remaining = Math.max(0, Number(due.toFixed(2)));
		const cents = Math.round(remaining * 100);
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
			onClose();
		}
	};

	const handleCancelDismiss = () => {
		setShowCancelConfirm(false);
	};


  // Handle Evenly Split OK
  const handleSplitCountConfirm = () => {
    const count = parseInt(splitCountInput, 10);
    if (count > 1 && onCreateAdhocGuests) {
      onCreateAdhocGuests(count);
      setIsSplitCountMode(false);
      setSplitCountInput('');
    } else {
      setIsSplitCountMode(false);
      setSplitCountInput('');
    }
  };

  // Cancel split mode
  const handleSplitCountCancel = () => {
    setIsSplitCountMode(false);
    setSplitCountInput('');
  };

	const commitDraft = async (clickedMethod?: string) => {
		try {
			if (!clickedMethod) {
				// 결제 수단이 없으면 초기화
				setMethod('');
				setRawAmountDigits('');
				setAmount('0.00');
				return;
			}
			
			const currentAmt = parseFloat(amount || '0') || 0;
			
			if (currentAmt > 0) {
				// 더블 클릭 방지
				if (isProcessing) {
					console.log('⚠️ Payment already processing (commitDraft), ignoring');
					return;
				}
				setIsProcessing(true);  // 결제 처리 시작
				
				// 현재 금액 > 0이면: 기존 결제 수단이 있으면 그것으로, 없으면 클릭한 것으로 확정
				// 기존 method가 있으면 그것을 사용, 없으면 clickedMethod 사용
				const effectiveMethod = method || clickedMethod;
				
				const fixedGrandVal = initialGrandRef.current ?? (subtotal + taxLines.reduce((s, t) => s + t.amount, 0));
				const confirmedTotalNow = (payments || []).reduce((sum, p) => sum + (p.amount || 0), 0);
				let scopeDueNow: number;
				// 게스트별 분할 결제 모드에서는 outstandingDue 사용 (게스트별 금액 계산 필요)
				// 일반 결제 모드에서는 payments에서 직접 계산 (outstandingDue가 stale할 수 있으므로)
				if (typeof effectiveGuestMode === 'number' && typeof outstandingDue === 'number' && outstandingDue >= 0) {
					scopeDueNow = Math.max(0, Number(outstandingDue.toFixed(2)));
				} else {
					scopeDueNow = Math.max(0, Number((fixedGrandVal - confirmedTotalNow).toFixed(2)));
				}
				
				const finalAmount = (effectiveMethod === 'CASH') ? currentAmt : Math.min(currentAmt, scopeDueNow);
				const parsedTipVal = parseFloat(tip || '0') || 0;
				const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
				
				setOptimisticPayments(prev => [...prev, { tempId, method: effectiveMethod, amount: finalAmount }]);
				
				await onConfirm({ 
					method: effectiveMethod, 
					amount: parseFloat(finalAmount.toFixed(2)), 
					tip: parseFloat(parsedTipVal.toFixed(2)) 
				});
				
				setOptimisticPayments(prev => prev.filter(p => p.tempId !== tempId));
				
				if (effectiveMethod !== 'CASH' && currentAmt > finalAmount) {
					showClampPopup(currentAmt, finalAmount, effectiveMethod);
				}
				
				// 금액 초기화
				setAmount('0.00');
				setRawAmountDigits('');
				setTip('0');
				// 결제 수단 처리: 같은 수단으로 확정했으면 초기화, 다른 수단으로 전환했으면 새 수단 유지
				if (effectiveMethod === clickedMethod) {
					setMethod(''); // 같은 수단 → 초기화
				} else {
					setMethod(clickedMethod); // 다른 수단 → 새 수단 활성화
				}
				setIsProcessing(false);  // 결제 처리 완료
			} else {
				// 현재 금액 = 0이면: 결제 수단만 활성화
				setMethod(clickedMethod);
			}
		} catch (e) {
			// 에러 시 optimisticPayments 정리 및 상태 초기화
			setOptimisticPayments(prev => prev.slice(0, -1));
			setAmount('0.00');
			setRawAmountDigits('');
			setMethod('');
			setIsProcessing(false);
			showAlert('Payment failed. Please try again.');
			try { console.error('Failed to commit draft payment', e); } catch {}
		}
	};

	return (
		<div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
			<div className="bg-white rounded-2xl shadow-2xl p-0 overflow-hidden relative" onClick={(e) => e.stopPropagation()} style={{ width: '960px', height: '610px', transform: (typeof offsetTopPx === 'number' && offsetTopPx !== 0) ? `translateY(-${offsetTopPx}px)` : undefined }}>
				{/* X Close Button */}
				<button
					onClick={handleCancelClick}
					className="absolute top-[3px] right-[3px] z-10 p-2 rounded-full bg-white/30 hover:bg-white/50 shadow-xl hover:shadow-2xl transition-all border-[3px] border-red-500 ring-3 ring-red-300/50"
					aria-label="Close modal"
				>
					<X size={28} className="text-red-600" strokeWidth={3} />
				</button>
				<div className="px-3 pt-3">
					<div className="flex items-center gap-2 bg-white border rounded-full shadow px-3 py-2 overflow-x-auto whitespace-nowrap min-h-[60px]">
						{Array.from({ length: isSplitActive ? maxGuestButtons : 0 }, (_, i) => i + 1).map((n) => {
              const isActive = effectiveGuestMode === n || (effectiveGuestMode === 'ALL' && n === 1 && !isSplitActive);
              return (
								<button
									key={n}
                  onClick={() => { setForceAllMode(false); if (onSelectGuestMode) onSelectGuestMode(n); }}
                  className={`${isActive ? 'bg-blue-600 text-white' : 'bg-white text-gray-800'} border border-gray-300 rounded-full px-4 py-2 text-base font-bold hover:bg-gray-50 min-h-[44px]`}
                  aria-pressed={isActive}
								>
									{`Guest ${n}`}
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
									<span className="text-xl font-bold text-gray-900">${formatMoney(fixedGrand)}</span>
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
							<div className="space-y-1.5 text-sm">
								<div className="flex justify-between"><span>Items</span><span>${formatMoney(fixedSubtotal)}</span></div>
								{/* 개별 세금 라인 표시 (GST, PST 등) */}
								{initialTaxLinesRef.current && initialTaxLinesRef.current.length > 0 ? (
									initialTaxLinesRef.current.map((taxLine, idx) => (
										<div key={idx} className="flex justify-between"><span>{taxLine.name}</span><span>${formatMoney(taxLine.amount)}</span></div>
									))
								) : (
									<div className="flex justify-between"><span>Tax</span><span>${formatMoney(fixedTaxTotal)}</span></div>
								)}
								<div className="flex justify-between text-xl font-bold border-t pt-2"><span>Total</span><span>${formatMoney(fixedGrand)}</span></div>
							</div>
						<div className="mt-3 text-base flex-1 flex flex-col min-h-0">
							{/* Change container at top */}
                                <div
                                    className={`w-full px-0 rounded-md flex flex-col items-center justify-center py-[1.38rem] mb-3 bg-red-50 border border-red-200 ${canComplete ? 'cursor-pointer hover:opacity-90' : 'cursor-not-allowed'}`}
                                    onClick={() => { if (canComplete) finalizeAndComplete(); }}
                                    role="button"
                                    aria-disabled={!canComplete}
                                    tabIndex={canComplete ? 0 : -1}
                                    onKeyDown={(e) => { if (canComplete && (e.key === 'Enter' || e.key === ' ')) { finalizeAndComplete(); } }}
                                >
                                    <div className="flex flex-col items-center -translate-y-[10px] translate-x-[20px]">
                                        <span className={`text-xl font-bold text-red-700`}>Change $</span>
                                        <span className={`font-extrabold leading-none tracking-tight text-[4.2625rem] md:text-[4.60625rem] text-red-600`}>{formatMoney(change)}</span>
                                    </div>
                                </div>
								<div className="h-2" />
								{/* Amounts group */}
								<div className="space-y-1.5">
																{/* Due container: tap to fill display with remaining due for confirmation */}
										<div className="w-full rounded-md border border-blue-200 bg-blue-50 px-4 py-2 h-[4.4rem] flex items-center justify-between cursor-pointer" onClick={handleFillDue}>
											<span className="text-xl text-blue-700 whitespace-nowrap font-semibold leading-none">Due $</span>
											<span className="text-3xl font-bold text-blue-700 leading-none">{formatMoney(due)}</span>
										</div>
								{/* Pay container */}
													<div className="w-full px-4 py-2 rounded-md border bg-white h-[7.2rem] flex flex-col">
									<div className="flex items-center justify-between">
										<span className="text-lg text-gray-700 whitespace-nowrap font-semibold leading-none h-8 flex items-center">Paid $</span>
										<span className="text-lg font-bold text-gray-800">{formatMoney(displayPaidTotal)}</span>
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
												<span className="font-semibold">{formatMoney(op.amount)}</span>
											</div>
										))}
										{/* 현재 입력 중인 금액 표시 (optimistic 처리 중이 아닐 때만) */}
										{(parsedAmount > 0 && !isProcessing && optimisticPayments.length === 0) && (
											<div className="flex items-center justify-between">
												<span className="truncate">{method ? getMethodLabel(method) : 'Processing'}</span>
												<span className="font-semibold">{formatInput(amount)}</span>
											</div>
										)}
									</div>
									</div>
									{/* Tip container */}
								<div className="h-12 w-full px-4 rounded-md border bg-white flex items-center justify-between">
									<span className="text-sm text-gray-500 whitespace-nowrap">Tip $</span>
									<input value={isTipFocused ? tip : formatInput(tip)} onFocus={() => setIsTipFocused(true)} onBlur={() => { setIsTipFocused(false); setTip(unformatInput(tip)); }} onChange={(e) => handleTipChange(e.target.value)} className="h-full flex-1 min-w-0 text-right outline-none bg-transparent" />
								</div>
							</div>
						</div>

								</div>
					)}
						{/* Right: Keypad & Quick */}
						<div className="p-3 md:order-2 bg-gray-300 h-full flex flex-col">
							{/* Customer info moved here */}
                            <div className={`mb-2 flex items-center ${isCenterHeader ? 'justify-center' : 'justify-between'} text-lg rounded-md px-4 py-2 bg-gray-300 border border-gray-400`}>
                                <span className="text-gray-800 font-extrabold text-lg">{headerLeftLabel}</span>
                                {!isCenterHeader && (
                                  <span className="text-gray-800 font-semibold text-lg">{headerRightLabel}</span>
                                )}
                            </div>
					
							{/* Keypad + Quick amounts unified grid - 8 columns */}
							<div className="grid grid-cols-8 gap-2 mb-2">
								{/* Row 1: Display */}
								<div className="col-span-8 h-12 px-3 rounded-md border bg-white/60 backdrop-blur-sm flex items-center justify-end text-lg font-semibold">
                  {formatInput(amount)}
                </div>
								{/* Row 2: 1 2 3 $5 */}
                <button className="col-span-2 h-[3.3rem] w-full rounded-md border text-2xl font-semibold bg-white text-gray-500 border-gray-300 hover:bg-gray-100" onClick={()=>appendDigit('1')}>1</button>
                <button className="col-span-2 h-[3.3rem] w-full rounded-md border text-2xl font-semibold bg-white text-gray-500 border-gray-300 hover:bg-gray-100" onClick={()=>appendDigit('2')}>2</button>
                <button className="col-span-2 h-[3.3rem] w-full rounded-md border text-2xl font-semibold bg-white text-gray-500 border-gray-300 hover:bg-gray-100" onClick={()=>appendDigit('3')}>3</button>
                <button className="col-span-2 h-[3.3rem] w-full rounded-md border text-xl font-semibold bg-blue-50 border-blue-200 text-blue-500 hover:bg-blue-100" onClick={() => addQuick(5)}>$5</button>

								{/* Row 3: 4 5 6 $10 */}
                <button className="col-span-2 h-[3.3rem] w-full rounded-md border text-2xl font-semibold bg-white text-gray-500 border-gray-300 hover:bg-gray-100" onClick={()=>appendDigit('4')}>4</button>
                <button className="col-span-2 h-[3.3rem] w-full rounded-md border text-2xl font-semibold bg-white text-gray-500 border-gray-300 hover:bg-gray-100" onClick={()=>appendDigit('5')}>5</button>
                <button className="col-span-2 h-[3.3rem] w-full rounded-md border text-2xl font-semibold bg-white text-gray-500 border-gray-300 hover:bg-gray-100" onClick={()=>appendDigit('6')}>6</button>
                <button className="col-span-2 h-[3.3rem] w-full rounded-md border text-xl font-semibold bg-blue-50 border-blue-200 text-blue-500 hover:bg-blue-100" onClick={() => addQuick(10)}>$10</button>

								{/* Row 4: 7 8 9 $20 */}
                <button className="col-span-2 h-[3.3rem] w-full rounded-md border text-2xl font-semibold bg-white text-gray-500 border-gray-300 hover:bg-gray-100" onClick={()=>appendDigit('7')}>7</button>
                <button className="col-span-2 h-[3.3rem] w-full rounded-md border text-2xl font-semibold bg-white text-gray-500 border-gray-300 hover:bg-gray-100" onClick={()=>appendDigit('8')}>8</button>
                <button className="col-span-2 h-[3.3rem] w-full rounded-md border text-2xl font-semibold bg-white text-gray-500 border-gray-300 hover:bg-gray-100" onClick={()=>appendDigit('9')}>9</button>
                <button className="col-span-2 h-[3.3rem] w-full rounded-md border text-xl font-semibold bg-blue-50 border-blue-200 text-blue-500 hover:bg-blue-100" onClick={() => addQuick(20)}>$20</button>

								{/* Row 5: 0 00 . $50 */}
                <button className="col-span-2 h-[3.3rem] w-full rounded-md border text-2xl font-semibold bg-white text-gray-500 border-gray-300 hover:bg-gray-100" onClick={()=>appendDigit('0')}>0</button>
                <button className="col-span-2 h-[3.3rem] w-full rounded-md border text-2xl font-semibold bg-white text-gray-500 border-gray-300 hover:bg-gray-100" onClick={()=>appendDigit('00')}>00</button>
                <button className="col-span-2 h-[3.3rem] w-full rounded-md border text-3xl font-semibold bg-white text-gray-600 border-gray-300 hover:bg-gray-100" onClick={()=>appendDigit('.')}>.</button>
                <button className="col-span-2 h-[3.3rem] w-full rounded-md border text-xl font-semibold bg-blue-50 border-blue-200 text-blue-500 hover:bg-blue-100" onClick={() => addQuick(50)}>$50</button>

								{/* Row 6: Clear (3col) ← (3col) $100 (2col) */}
                <button className="col-span-3 h-[3.3rem] w-full rounded-md border-2 text-lg font-semibold bg-white text-gray-600 border-gray-400 hover:bg-gray-100" onClick={()=>{ setAmount('0.00'); setRawAmountDigits(''); setTip('0'); setMethod(''); }}>Clear</button>
                <button className="col-span-3 h-[3.3rem] w-full rounded-md border text-2xl font-semibold bg-white text-gray-600 border-gray-300 hover:bg-gray-100" onClick={()=>appendDigit('BS')}>←</button>
                <button className="col-span-2 h-[3.3rem] w-full rounded-md border text-xl font-semibold bg-blue-50 border-blue-200 text-blue-500 hover:bg-blue-100" onClick={() => addQuick(100)}>$100</button>
							</div>
							<div className="h-3" />
            <div className="mt-0 mb-0 grid grid-cols-2 gap-2">
                <button 
                  onClick={isSplitCountMode ? handleSplitCountCancel : handleCancelClick} 
                  className="h-12 w-full rounded-md bg-gray-700 text-white hover:bg-gray-800 active:bg-red-600 active:text-white font-bold"
                >
                  {isSplitCountMode ? 'Cancel Split' : 'Cancel'}
                </button>
                <button 
                  onClick={isSplitCountMode ? handleSplitCountConfirm : (proceedArmed ? proceedNext : finalizeAndComplete)} 
                  className={`${(isSplitCountMode ? splitCountInput.length > 0 : canClickOk) ? 'h-12 w-full rounded-md bg-green-600 text-white hover:bg-green-700 active:bg-red-600' : 'h-12 w-full rounded-md bg-green-200 text-green-700 cursor-not-allowed'} font-bold`} 
                  disabled={isSplitCountMode ? splitCountInput.length === 0 : !canClickOk}
                >
                  {isSplitCountMode ? 'Confirm' : (proceedArmed ? 'Next' : 'OK')}
                </button>
            </div>
							<div className="h-3" />
					</div>

					{/* Methods (right column) */}
					<div className={`bg-gray-100 border-l p-3 md:order-3 flex flex-col h-full space-y-1 duration-200 transition-opacity ${isSplitCountMode ? 'opacity-30 pointer-events-none filter blur-[1px]' : ''}`}>
						{methods.filter(m => m.key !== 'GIFT' && m.key !== 'OTHER').map(m => (
							<button key={m.key} onClick={() => commitDraft(m.key)} className={`w-full flex items-center justify-between px-4 py-[0.71rem] rounded-lg border transition active:bg-red-600 active:text-white active:border-red-600 ${method===m.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-100'}`}>
								<span className="flex items-center font-bold">{m.label}</span>
							</button>
						))}

						<button key="GIFT" onClick={openGiftCardModal} className={`min-w-0 w-full flex items-center justify-between px-4 py-[0.71rem] rounded-lg border transition active:bg-red-600 active:text-white active:border-red-600 ${method==='GIFT' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-100'} mt-1`}>
							<span className="flex items-center whitespace-nowrap overflow-hidden text-ellipsis font-bold">Gift Card</span>
						</button>
						<button key="COUPON" onClick={() => commitDraft('COUPON')} className={`min-w-0 w-full flex items-center justify-between px-4 py-[0.71rem] rounded-lg border transition active:bg-red-600 active:text-white active:border-red-600 ${method==='COUPON' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-100'} mt-1`}>
							<span className="flex items-center overflow-hidden text-ellipsis font-bold">Coupon</span>
						</button>
						<button key="OTHER" onClick={() => commitDraft('OTHER')} className={`min-w-0 w-full flex items-center justify-between px-4 py-[0.71rem] rounded-lg border transition active:bg-red-600 active:text-white active:border-red-600 ${method==='OTHER' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-100'} mt-1`}>
							<span className="flex items-center overflow-hidden text-ellipsis font-bold">Other</span>
						</button>
                        <div className="h-2" />
                        {/* Split Button - opens Split Bill modal (only show if onSplitBill is provided) */}
                        {typeof onSplitBill === 'function' && (
                        <button 
                          className="w-full flex items-center justify-center px-4 py-[0.71rem] rounded-lg border-2 border-purple-500 bg-purple-50 text-purple-700 hover:bg-purple-100 shadow font-bold" 
                          onClick={() => onSplitBill()}
                        >
                          Split
                          </button>
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
