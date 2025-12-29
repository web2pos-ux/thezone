import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';

interface PaymentModalProps {
	isOpen: boolean;
	onClose: () => void;
	subtotal: number;
	taxLines: Array<{ name: string; amount: number }>; 
	total: number;
	onConfirm: (payload: { method: string; amount: number; tip: number }) => void;
	onComplete?: () => void;
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

const PaymentModal: React.FC<PaymentModalProps> = ({ isOpen, onClose, subtotal, taxLines, total, onConfirm, onComplete, channel, customerName, tableName, onSplitBill, guestCount, guestMode, onSelectGuestMode, forceGuestMode, showAllButton, outstandingDue, paidSoFar, payments, onVoidPayment, onClearAllPayments, prefillDueNonce, prefillUseTotalOnceNonce, offsetTopPx, onCreateAdhocGuests }) => {
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
  const [lastChange, setLastChange] = useState<number | null>(null);
  const [forceAllMode, setForceAllMode] = useState<boolean>(false);
  const [isSplitCountMode, setIsSplitCountMode] = useState<boolean>(false);
  const [splitCountInput, setSplitCountInput] = useState<string>('');

  // Gift Card states
  const [showGiftCardModal, setShowGiftCardModal] = useState<boolean>(false);
  const [giftCardNumber, setGiftCardNumber] = useState<string>('');
  const [giftCardBalance, setGiftCardBalance] = useState<number | null>(null);
  const [giftCardError, setGiftCardError] = useState<string>('');
  const [giftCardLoading, setGiftCardLoading] = useState<boolean>(false);
  const [giftCardPayAmount, setGiftCardPayAmount] = useState<string>('');
  const [giftCardInputFocus, setGiftCardInputFocus] = useState<'card' | 'amount'>('card');

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

	useEffect(() => { if (!isOpen) { setRawAmountDigits(''); resetGiftCard(); setShowGiftCardModal(false); } }, [isOpen, resetGiftCard]);
	useEffect(() => { if (isOpen) { setProceedArmed(false); setLastChange(null); } }, [isOpen]);
	useEffect(() => { return () => { if (clampTimerRef.current) { window.clearTimeout(clampTimerRef.current); clampTimerRef.current = null; } }; }, []);

	const showClampPopup = (entered: number, applied: number, method?: string) => {
		setClampPopup({ entered, applied, method });
		if (clampTimerRef.current) { window.clearTimeout(clampTimerRef.current); }
		clampTimerRef.current = window.setTimeout(() => {
			setClampPopup(null);
			clampTimerRef.current = null;
		}, 2200);
	};
 
	const taxTotal = useMemo(() => taxLines.reduce((s, t) => s + t.amount, 0), [taxLines]);
	const parsedAmount = useMemo(() => parseFloat(amount) || 0, [amount]);
	const parsedTip = useMemo(() => parseFloat(tip) || 0, [tip]);
  const grand = useMemo(() => parseFloat((subtotal + taxTotal).toFixed(2)), [subtotal, taxTotal]);
  const effectiveGuestMode = useMemo(() => {
    if (typeof forceGuestMode !== 'undefined') return forceGuestMode;
    return (forceAllMode ? 'ALL' : guestMode);
  }, [forceGuestMode, forceAllMode, guestMode]);
  // Remaining due in current scope (after confirmed payments)
  // 우선순위: 실제 확정 결제(`payments`) 합계를 신뢰하고, 외부에서 전달된 outstandingDue는 보조로 사용
  const remainingDue = useMemo(() => {
    try {
      // 1) payments 기준으로 계산 (게스트 스코프를 고려한 합계는 아래 paymentsInScope/confirmed 합계로 산출)
      // paymentsInScope는 아래에서 정의되므로, 여기서는 우선 전체 기준 보정값만 사용하고 최종 due 계산에서 정밀 보정
      const baseByProp = (typeof outstandingDue === 'number') ? Number(outstandingDue.toFixed(2)) : Number(grand.toFixed(2));
      // In Even Split mode, we should trust baseByProp (calculated per guest) rather than grand (total for all)
      if (onCreateAdhocGuests && guestCount && guestCount > 1 && baseByProp <= Number(grand.toFixed(2))) {
         return Math.max(0, baseByProp);
      }
      // Fallback
      return Math.max(0, baseByProp);
    } catch {
      return Math.max(0, Number(grand.toFixed(2)));
    }
  }, [outstandingDue, grand, onCreateAdhocGuests, guestCount]);

  // Gift Card functions (depends on remainingDue)
  const handleCheckGiftCardBalance = useCallback(async () => {
    if (giftCardNumber.length !== 16) {
      setGiftCardError('Please enter a valid 16-digit card number');
      return;
    }
    setGiftCardLoading(true);
    setGiftCardError('');
    try {
      const response = await fetch(`http://localhost:3177/api/gift-cards/${giftCardNumber}/balance`);
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
      const response = await fetch(`http://localhost:3177/api/gift-cards/${giftCardNumber}/redeem`, {
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

// 디스플레이 초기화: 모달 열림/게스트 스코프 변경 시, 또는 사용자가 직접 결제수단을 바꿀 때만 초기화
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
}, [isOpen, method, effectiveGuestMode]);

  // Removed auto-commit: 결제도구/금액 조합은 OK 시점에만 확정

  const finalizeAndComplete = async () => {
    if (!canComplete) return;
    try {
      // OK 시점 확정: 가장 마지막 결제도구(method)와 현재 입력 금액(amount) 조합만 확정 처리
      const rawAmt = parsedAmount;
      if (rawAmt > 0) {
        if (!method) { try { alert('결제도구를 선택하세요.'); } catch {} return; }
        const effectiveMethod = method;
        const confirmedTotalNow = Number(((cashPaidConfirmed + nonCashPaidConfirmed)).toFixed(2));
        const scopeDueNow = Math.max(0, Number((remainingDue - confirmedTotalNow).toFixed(2)));
        const clampedAmt = Math.min(rawAmt, scopeDueNow);
        const t = parsedTip;
        try {
          const scopeDue = Number((remainingDue).toFixed(2));
          const confirmedTotal = Number(((cashPaidConfirmed + nonCashPaidConfirmed)).toFixed(2));
          const remainingDueNow = Math.max(0, Number((scopeDue - confirmedTotal).toFixed(2)));
          const draftTender = (effectiveMethod === 'CASH') ? rawAmt : 0;
          const snapChange = (effectiveMethod === 'CASH') ? Math.max(0, Number((draftTender - remainingDueNow).toFixed(2))) : 0;
          setLastChange(snapChange);
        } catch {}
        const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
        setOptimisticPayments(prev => [...prev, { tempId, method: effectiveMethod, amount: clampedAmt }]);
        setRawAmountDigits('');
        await onConfirm({ method: effectiveMethod, amount: parseFloat(clampedAmt.toFixed(2)), tip: parseFloat(t.toFixed(2)) });
        setOptimisticPayments(prev => prev.filter(p => p.tempId !== tempId));
        if (effectiveMethod !== 'CASH' && rawAmt > clampedAmt) {
          showClampPopup(rawAmt, clampedAmt, effectiveMethod);
        }
        setAmount('0.00');
        setTip('0');
        setMethod('');
      }
      setProceedArmed(true);
    } catch (e) {
      setOptimisticPayments(prev => prev.slice(0, -1));
      try { console.error('Finalize failed', e); } catch {}
    }
  };

	const proceedNext = () => {
		if (onComplete) onComplete();
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
    if (typeof outstandingDue === 'number') return Number((grand - outstandingDue).toFixed(2));
    return 0;
  }, [payments, paidSoFar, outstandingDue, grand, effectiveGuestMode]);
  // Paid $ 합계는 확정 결제만 합산 (Processing/optimistic 제외)
  const displayPaidTotal = useMemo(() => parseFloat(((paidTotal)).toFixed(2)), [paidTotal]);
  const isSplitActive = useMemo(() => (typeof effectiveGuestMode === 'number') || ((guestCount || 0) > 1), [effectiveGuestMode, guestCount]);
	const maxGuestButtons = useMemo(() => Math.min(8, (guestCount || 8)), [guestCount]);
 

	// Change calculation based on confirmed payments across methods
	const paymentsInScope = useMemo(() => {
		if (!Array.isArray(payments)) return [] as Array<{ method: string; amount: number; guestNumber?: number }>;
		if (typeof guestMode === 'number') {
			return payments.filter(p => p.guestNumber === guestMode);
		}
		return payments;
	}, [payments, guestMode]);

	const { cashPaidConfirmed, nonCashPaidConfirmed } = useMemo(() => {
		let cash = 0, nonCash = 0;
		paymentsInScope.forEach(p => {
			if ((p.method || '').toUpperCase() === 'CASH') cash += (p.amount || 0);
			else nonCash += (p.amount || 0);
		});
		return { cashPaidConfirmed: parseFloat(cash.toFixed(2)), nonCashPaidConfirmed: parseFloat(nonCash.toFixed(2)) };
	}, [paymentsInScope]);

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
    const dueFull = Math.max(0, Number((grand - confirmedTotal).toFixed(2)));
    return Math.max(0, Number((dueFull - parsedAmount).toFixed(2)));
  }, [grand, cashPaidConfirmed, nonCashPaidConfirmed, parsedAmount, outstandingDue, onCreateAdhocGuests, isSplitActive]);


  // Next는 사용자 조작으로만 진행 (자동 완료 제거)

  const change = useMemo(() => {
    // Change는 "현금이 남긴 초과분"만 표시한다.
    // 1) 확정된 비현금으로 먼저 총액을 상쇄
    const baseTotal = (onCreateAdhocGuests && isSplitActive && typeof outstandingDue === 'number') ? (outstandingDue + paidTotal) : grand;
    
    const remainingAfterNonCash = Math.max(0, Number((baseTotal - nonCashPaidConfirmed).toFixed(2)));
    // 2) 확정된 현금 + (입력 중인 금액이 현금이면 그 금액도 미리 더해 미리보기)
    const projectedCash = Number(((cashPaidConfirmed + ((method === 'CASH') ? parsedAmount : 0))).toFixed(2));
    // 3) 현금 초과분만 Change로 표시
    const ch = Math.max(0, Number((projectedCash - remainingAfterNonCash).toFixed(2)));
    return ch;
  }, [grand, nonCashPaidConfirmed, cashPaidConfirmed, method, parsedAmount, onCreateAdhocGuests, isSplitActive, outstandingDue, paidTotal]);
 
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
    // Togo: left 'Togo', right customer name
    if (ch === 'togo') {
      return { headerLeftLabel: 'Togo', headerRightLabel: String(customerName || tableName || ''), isCenterHeader: false };
    }
    // Online: left 'Online', right customer name
    if (ch.includes('online') || ch === 'web') {
      return { headerLeftLabel: 'Online', headerRightLabel: String(customerName || tableName || ''), isCenterHeader: false };
    }
    // Fallback: show channel on left, customer/table on right
    return { headerLeftLabel: String(channel || ''), headerRightLabel: String(customerName || tableName || ''), isCenterHeader: false };
  }, [channel, tableName, customerName]);
 
	if (!isOpen) return null;

	const appendDigit = (d: string) => {
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
    // Quick buttons just input amount; payment method is chosen independently (no auto-assign)
    const current = parseFloat(amount || '0') || 0;
    const next = Math.max(0, parseFloat((current + q).toFixed(2)));
    const cents = Math.round(next * 100);
    setRawAmountDigits(String(cents));
    setAmount(next.toFixed(2));
    forceCashMethod();
};

	const handleTipChange = (raw: string) => {
		const digitsOnly = (raw || '').replace(/[^0-9]/g, '');
		const cents = digitsOnly === '' ? 0 : parseInt(digitsOnly, 10);
		const formatted = (cents / 100).toFixed(2);
		setTip(formatted);
	};

	// Explicitly fill display with remaining due (no commit) when user taps Due
	const handleFillDue = () => {
		const remaining = Math.max(0, Number(due.toFixed(2)));
		const cents = Math.round(remaining * 100);
		setRawAmountDigits(String(cents));
		setAmount(remaining.toFixed(2));
		forceCashMethod();
	};


// (moved up) — removed duplicate block


	// Cancel: void all session payments, reset local state, close
	const handleCancel = async () => {
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
			const amt = parseFloat(amount || '0') || 0;
			const t = parseFloat(tip || '0') || 0;
			const total = Number((amt + t).toFixed(2));

			// 1) 금액 선입력 후 결제도구 클릭: 클릭한 수단으로 즉시 확정 + 같은 수단을 선택 상태로 유지
            if (clickedMethod && total > 0) {
                const confirmedTotalNow2 = Number(((cashPaidConfirmed + nonCashPaidConfirmed)).toFixed(2));
                const scopeDueNow2 = Math.max(0, Number((remainingDue - confirmedTotalNow2).toFixed(2)));
                const effectiveAmount = clickedMethod === 'CASH' ? total : Math.min(total, scopeDueNow2);
				const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
				setOptimisticPayments(prev => [...prev, { tempId, method: clickedMethod, amount: effectiveAmount }]);
				setAmount('0.00');
				setTip('0');
				setRawAmountDigits('');
				await onConfirm({ method: clickedMethod, amount: parseFloat(effectiveAmount.toFixed(2)), tip: parseFloat(t.toFixed(2)) });
				setOptimisticPayments(prev => prev.filter(p => p.tempId !== tempId));
				setMethod(clickedMethod); // 다음 입력을 같은 수단으로 받기
				// Show clamp popup for non-cash if clamped
				if (clickedMethod !== 'CASH' && total > effectiveAmount) {
					showClampPopup(total, effectiveAmount, clickedMethod);
				}
				return;
			}
            // 2) 첫 결제도구 선택만(금액 0): 라벨만 지정 (아직 결제완료 아님)
			if (clickedMethod && total <= 0) { setMethod(clickedMethod); setAmount('0.00'); setRawAmountDigits(''); return; }
            // 3) 유효 금액이 없으면 결제도구만 전환 (아직 결제완료 아님)
			if (total <= 0) { if (clickedMethod) { setMethod(clickedMethod); setAmount('0.00'); setRawAmountDigits(''); } else { setMethod(''); setRawAmountDigits(''); setAmount('0.00'); } return; }
		} catch (e) {
			// rollback optimistic on failure
			setOptimisticPayments(prev => prev.slice(0, -1));
			try { console.error('Failed to commit draft payment', e); } catch {}
		}
	};

	return (
		<div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
			<div className="bg-white rounded-2xl shadow-2xl w-[100%] md:w-[50.4%] p-0 overflow-hidden max-h-[90vh] md:max-h-[90vh] relative" onClick={(e) => e.stopPropagation()} style={{ transform: (typeof offsetTopPx === 'number' && offsetTopPx !== 0) ? `translateY(-${offsetTopPx}px)` : undefined }}>
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
					{/* Middle (first column): Totals / Inputs */}
											<div className={`p-3 space-y-3 md:order-1 bg-gray-100 h-full flex flex-col duration-200 transition-opacity ${isSplitCountMode ? 'opacity-30 pointer-events-none filter blur-[1px]' : ''}`}>
							<div className="space-y-1.5 text-sm">
								<div className="flex justify-between"><span>Items</span><span>${formatMoney(subtotal)}</span></div>
								<div className="flex justify-between"><span>Tax</span><span>${formatMoney(taxTotal)}</span></div>
								<div className="flex justify-between text-xl font-bold border-t pt-2"><span>Total</span><span>${formatMoney(grand)}</span></div>
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
                                        <span className={`font-extrabold leading-none tracking-tight text-[4.2625rem] md:text-[4.60625rem] text-red-600`}>{formatMoney((proceedArmed && lastChange != null) ? lastChange : change)}</span>
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
										{(parsedAmount > 0) && (
											<div className="flex items-center justify-between">
												<span className="truncate">{method ? getMethodLabel(method) : 'Processing'}</span>
												<span className="font-semibold">{formatInput(amount)}</span>
											</div>
										)}
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
                <button className="col-span-3 h-[3.3rem] w-full rounded-md border-2 text-lg font-semibold bg-white text-gray-600 border-gray-400 hover:bg-gray-100" onClick={()=>{ try { onClearAllPayments && onClearAllPayments(); } catch {} setAmount('0.00'); setTip('0'); }}>Clear</button>
                <button className="col-span-3 h-[3.3rem] w-full rounded-md border text-2xl font-semibold bg-white text-gray-600 border-gray-300 hover:bg-gray-100" onClick={()=>appendDigit('BS')}>←</button>
                <button className="col-span-2 h-[3.3rem] w-full rounded-md border text-xl font-semibold bg-blue-50 border-blue-200 text-blue-500 hover:bg-blue-100" onClick={() => addQuick(100)}>$100</button>
							</div>
							<div className="h-3" />
            <div className="mt-0 mb-0 grid grid-cols-2 gap-2">
                <button 
                  onClick={isSplitCountMode ? handleSplitCountCancel : handleCancel} 
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
                        {/* Split Button - opens Split Bill modal */}
                        <button 
                          className="w-full flex items-center justify-center px-4 py-[0.71rem] rounded-lg border-2 border-purple-500 bg-purple-50 text-purple-700 hover:bg-purple-100 shadow font-bold" 
                          onClick={() => { if (typeof onSplitBill === 'function') onSplitBill(); }}
                        >
                          Split
                          </button>
					</div>
				</div>
			{/* Clamp info popup */}
			{clampPopup && (
				<div className="absolute inset-0 flex items-center justify-center pointer-events-none">
					<div className="pointer-events-auto bg-gray-900/90 text-white px-4 py-3 rounded-xl shadow-2xl border border-gray-700 text-center">
						<div className="text-sm font-semibold">{clampPopup.method ? `${getMethodLabel(clampPopup.method)}:` : 'Notice'}</div>
						<div className="text-base font-bold">${clampPopup.entered.toFixed(2)} was entered, but ${clampPopup.applied.toFixed(2)} was processed.</div>
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
