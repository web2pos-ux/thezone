import React, { useState, useEffect } from 'react';
import {
  PAY_NEO,
  PAY_NEO_CANVAS,
  NEO_MODAL_BTN_PRESS,
  NEO_COLOR_BTN_PRESS,
  PAY_NEO_PRIMARY_BLUE,
  OH_ACTION_NEO,
} from '../utils/softNeumorphic';

const PCM_RX_ROUND: React.CSSProperties = { borderRadius: 12 };

interface PaymentCompleteModalProps {
  isOpen: boolean;
  onClose: (receiptCount: number) => void;
  mode?: 'full' | 'receiptOnly';
  onAddTips?: (receiptCount: number) => void;
  change: number;
  total: number;
  tip: number;
  payments: Array<{ method: string; amount: number }>;
  hasCashPayment: boolean;
  // Split bill guest props
  isPartialPayment?: boolean;
  currentGuestNumber?: number;
  allGuests?: number[];
  paidGuests?: number[];
  onPrintReceipt?: (receiptCount: number) => void;
  onSelectGuest?: (guestNumber: number) => void;
  onBackToOrder?: () => void;
  // Cash Tip (시나리오 4: 카드 결제 후 별도 현금 팁)
  onAddCashTip?: (tipAmount: number) => Promise<void>;
}

const PaymentCompleteModal: React.FC<PaymentCompleteModalProps> = ({
  isOpen,
  onClose,
  mode = 'full',
  onAddTips,
  change,
  total,
  tip,
  payments,
  hasCashPayment,
  isPartialPayment = false,
  currentGuestNumber,
  allGuests = [],
  paidGuests = [],
  onPrintReceipt,
  onSelectGuest,
  onBackToOrder,
  onAddCashTip,
}) => {
  const [selectedReceipt, setSelectedReceipt] = useState<number | null>(null);
  const [isSubmittingReceipt, setIsSubmittingReceipt] = useState(false);
  const [cashTipInput, setCashTipInput] = useState('');
  const [cashTipAdded, setCashTipAdded] = useState(false);
  const [addedCashTip, setAddedCashTip] = useState(0);
  const [changeAsTipApplied, setChangeAsTipApplied] = useState(false);

  // Reset state when modal opens or guest changes
  useEffect(() => {
    if (isOpen) {
      setSelectedReceipt(null);
      setCashTipInput('');
      setCashTipAdded(false);
      setAddedCashTip(0);
      setChangeAsTipApplied(false);
    }
  }, [isOpen, currentGuestNumber]);

  if (!isOpen) return null;

  const formatMoney = (n: number) =>
    new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

  if (mode === 'receiptOnly') {
    const handleReceiptSelect = async (count: number) => {
      if (isSubmittingReceipt) return;
      setIsSubmittingReceipt(true);
      try {
        if (count > 0) {
          try {
            if (typeof onPrintReceipt === 'function') {
              await Promise.resolve(onPrintReceipt(count));
            }
          } catch {}
        }
        await Promise.resolve(onClose(count));
      } finally {
        setIsSubmittingReceipt(false);
      }
    };
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center">
        <div className="absolute inset-0 bg-black/60" />
        <div className="relative w-[504px] overflow-hidden animate-in zoom-in-95 duration-200 border-0" style={PAY_NEO.modalShell}>
          <div
            className="px-8 py-6 text-center"
            style={{
              ...PAY_NEO.raised,
              background: 'linear-gradient(145deg, #22c55e, #16a34a)',
              color: '#fff',
              boxShadow: '5px 5px 12px rgba(22,101,52,0.4), -3px -3px 10px rgba(255,255,255,0.22)',
            }}
          >
            <div className="text-6xl mb-2">✓</div>
            <h2 className="text-3xl font-bold text-white">Payment Complete</h2>
          </div>
          <div className="p-8" style={{ background: PAY_NEO_CANVAS }}>
            {hasCashPayment && change > 0 && (
              <div className="text-center mb-6 py-4 bg-red-50 rounded-xl border-2 border-red-200">
                <div className="text-xl font-bold text-red-700">Change</div>
                <div className="text-[5rem] font-extrabold text-red-600 tracking-tight leading-none">${formatMoney(change)}</div>
              </div>
            )}
            <div className="text-center mb-4">
              <span className="text-base font-semibold text-gray-500 uppercase tracking-wide">Select Receipt Option</span>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <button
                type="button"
                onClick={() => handleReceiptSelect(0)}
                disabled={isSubmittingReceipt}
                className={`border-0 py-6 px-4 text-lg font-bold text-white ${NEO_COLOR_BTN_PRESS} disabled:cursor-not-allowed disabled:opacity-50`}
                style={{ ...OH_ACTION_NEO.slate, ...PCM_RX_ROUND }}
              >
                No Receipt
              </button>
              <button
                type="button"
                onClick={() => handleReceiptSelect(1)}
                disabled={isSubmittingReceipt}
                className={`border-0 py-6 px-4 text-lg font-bold text-white ${NEO_COLOR_BTN_PRESS} disabled:cursor-not-allowed disabled:opacity-50`}
                style={{ ...PAY_NEO_PRIMARY_BLUE, ...PCM_RX_ROUND }}
              >
                1 Receipt
              </button>
              <button
                type="button"
                onClick={() => handleReceiptSelect(2)}
                disabled={isSubmittingReceipt}
                className={`border-0 py-6 px-4 text-lg font-bold text-white ${NEO_COLOR_BTN_PRESS} disabled:cursor-not-allowed disabled:opacity-50`}
                style={{ ...OH_ACTION_NEO.green, ...PCM_RX_ROUND }}
              >
                2 Receipts
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const displayTip = tip + addedCashTip + (changeAsTipApplied ? change : 0);
  const displayChange = changeAsTipApplied ? 0 : change;

  const handleChangeAsTip = async () => {
    if (change <= 0 || changeAsTipApplied) return;
    if (onAddCashTip) {
      await onAddCashTip(change);
    }
    setChangeAsTipApplied(true);
  };

  const handleAddCashTip = async () => {
    const amt = parseFloat(cashTipInput);
    if (amt > 0 && onAddCashTip) {
      await onAddCashTip(amt);
      setAddedCashTip(amt);
      setCashTipAdded(true);
      setCashTipInput('');
    }
  };

  // ═══════════════════════════════════════════════════
  // Full completion mode (non-split or all guests paid)
  // ═══════════════════════════════════════════════════
  if (!isPartialPayment || allGuests.length <= 1) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center">
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/60" />
        
        {/* Modal shell / header — PAY_NEO (Change·영수증 블록은 payment-lock 유지) */}
        <div className="relative w-[504px] overflow-hidden animate-in zoom-in-95 duration-200 border-0" style={PAY_NEO.modalShell}>
          <div
            className="px-8 py-6 text-center"
            style={{
              ...PAY_NEO.raised,
              background: 'linear-gradient(145deg, #22c55e, #16a34a)',
              color: '#fff',
              boxShadow: '5px 5px 12px rgba(22,101,52,0.4), -3px -3px 10px rgba(255,255,255,0.22)',
            }}
          >
            <div className="text-6xl mb-2">✓</div>
            <h2 className="text-3xl font-bold text-white">Payment Complete</h2>
          </div>

          <div className="p-8" style={{ background: PAY_NEO_CANVAS }}>
            {/* Change Display */}
            {hasCashPayment && change > 0 && (
              <div className="mb-8 p-6 bg-red-50 border-2 border-red-300 rounded-xl text-center">
                <div className="text-xl font-bold text-red-700 mb-2">Change</div>
                <div className="text-[5rem] font-extrabold text-red-600 tracking-tight leading-none">
                  ${formatMoney(displayChange)}
                </div>
                {/* Click to add Change as Tip */}
                {!changeAsTipApplied && onAddCashTip && (
                  <button
                    type="button"
                    className="mt-3 px-5 py-2 text-base font-semibold text-green-700 bg-green-100 hover:bg-green-200 rounded-full border border-green-300 transition-all active:scale-95"
                    onClick={handleChangeAsTip}
                  >
                    💰 Click to add as Tip
                  </button>
                )}
                {changeAsTipApplied && (
                  <div className="mt-3 text-base font-semibold text-green-600">
                    ✓ ${formatMoney(change)} added as Tip
                  </div>
                )}
              </div>
            )}
            
            {/* Payment Summary */}
            <div className="mb-6 p-5 rounded-xl" style={PAY_NEO.inset}>
              <div className="flex justify-between items-center mb-4 pb-4 border-b border-gray-300">
                <span className="text-xl font-semibold text-gray-700">Total</span>
                <span className="text-3xl font-bold text-gray-900">${formatMoney(total)}</span>
              </div>
              <div className="space-y-3">
                {payments.map((p, i) => (
                  <div key={`payment-${i}`} className="flex justify-between items-center">
                    <span className="text-lg text-gray-600 font-medium">{p.method}</span>
                    <span className="text-lg font-semibold text-gray-800">${formatMoney(p.amount)}</span>
                  </div>
                ))}
                {/* Cash Tip 추가된 경우 표시 */}
                {cashTipAdded && addedCashTip > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-lg text-gray-600 font-medium">Cash Tip</span>
                    <span className="text-lg font-semibold text-green-600">${formatMoney(addedCashTip)}</span>
                  </div>
                )}
              </div>
              {/* Tip 표시 */}
              {displayTip > 0 && (
                <div className="flex justify-between items-center mt-3 pt-3 border-t border-gray-200">
                  <span className="text-lg font-semibold text-green-700">Tip</span>
                  <span className="text-lg font-bold text-green-600">${formatMoney(displayTip)}</span>
                </div>
              )}
            </div>

            {/* Cash Tip 입력 (시나리오 4: 카드 정확 결제 후 별도 현금 팁) */}
            {!cashTipAdded && onAddCashTip && (
              <div className="mb-6 p-4 rounded-xl" style={{ ...PAY_NEO.inset, background: '#ecfdf5' }}>
                <div className="text-sm font-semibold text-green-700 mb-2">Add Cash Tip</div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-medium text-gray-600">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={cashTipInput}
                    onChange={e => setCashTipInput(e.target.value)}
                    placeholder="0.00"
                    className="flex-1 h-12 px-3 text-xl font-semibold text-right border-0 outline-none focus:ring-2 focus:ring-green-400/80"
                    style={PAY_NEO.inset}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddCashTip(); }}
                  />
                  <button
                    type="button"
                    onClick={handleAddCashTip}
                    disabled={!cashTipInput || parseFloat(cashTipInput) <= 0}
                    className={`h-12 shrink-0 px-5 rounded-lg font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 ${NEO_COLOR_BTN_PRESS}`}
                    style={{
                      ...PAY_NEO.raised,
                      background: 'linear-gradient(145deg, #22c55e, #16a34a)',
                      color: '#fff',
                      boxShadow: '5px 5px 12px rgba(22,101,52,0.45), -3px -3px 10px rgba(255,255,255,0.25)',
                    }}
                  >
                    Add
                  </button>
                </div>
              </div>
            )}
            
            {/* Receipt Options */}
            <div className="mb-2">
              <div className="text-center mb-4">
                <span className="text-base font-semibold text-gray-500 uppercase tracking-wide">Select Receipt Option</span>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <button
                  type="button"
                  onClick={() => onClose(0)}
                  className={`border-0 py-6 px-4 text-lg font-bold text-white ${NEO_COLOR_BTN_PRESS}`}
                  style={{ ...OH_ACTION_NEO.slate, ...PCM_RX_ROUND }}
                >
                  No Receipt
                </button>
                <button
                  type="button"
                  onClick={() => onClose(1)}
                  className={`border-0 py-6 px-4 text-lg font-bold text-white ${NEO_COLOR_BTN_PRESS}`}
                  style={{ ...PAY_NEO_PRIMARY_BLUE, ...PCM_RX_ROUND }}
                >
                  1 Receipt
                </button>
                <button
                  type="button"
                  onClick={() => onClose(2)}
                  className={`border-0 py-6 px-4 text-lg font-bold text-white ${NEO_COLOR_BTN_PRESS}`}
                  style={{ ...OH_ACTION_NEO.green, ...PCM_RX_ROUND }}
                >
                  2 Receipts
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════
  // Partial payment mode (split bill - guest completed)
  // ═══════════════════════════════════════════════════
  const handlePartialReceiptClick = async (count: number) => {
    if (isSubmittingReceipt) return;
    setIsSubmittingReceipt(true);
    try {
      setSelectedReceipt(count);
      if (count > 0) {
        try {
          if (onPrintReceipt) await Promise.resolve(onPrintReceipt(count));
        } catch {}
      }

      // Auto-advance:
      // - If there are unpaid guests remaining, jump to the next unpaid guest.
      // - If this was the last guest, finalize (onClose) so parent can close order and go back to table map.
      const unpaid = allGuests.filter(g => !paidGuests.includes(g));
      if (unpaid.length > 0 && typeof onSelectGuest === 'function') {
        const current = typeof currentGuestNumber === 'number' ? currentGuestNumber : null;
        const sortedUnpaid = [...unpaid].sort((a, b) => a - b);
        const next = (current != null)
          ? (sortedUnpaid.find(g => g > current) ?? sortedUnpaid[0])
          : sortedUnpaid[0];
        if (typeof next === 'number') {
          onSelectGuest(next);
          return;
        }
      }

      await Promise.resolve(onClose(count));
    } finally {
      setIsSubmittingReceipt(false);
    }
  };

  const handleGuestClick = (guestNumber: number) => {
    setSelectedReceipt(null);
    if (onSelectGuest) onSelectGuest(guestNumber);
  };

  const handleBackClick = () => {
    setSelectedReceipt(null);
    if (onBackToOrder) onBackToOrder();
  };

  const unpaidGuests = allGuests.filter(g => !paidGuests.includes(g));

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" />
      
      {/* Modal - wider for 2-column layout */}
      <div className="relative w-[700px] overflow-hidden animate-in zoom-in-95 duration-200 border-0" style={PAY_NEO.modalShell}>
        <div
          className="px-8 py-5 text-center"
          style={{
            ...PAY_NEO.raised,
            background: 'linear-gradient(145deg, #22c55e, #16a34a)',
            color: '#fff',
            boxShadow: '5px 5px 12px rgba(22,101,52,0.4), -3px -3px 10px rgba(255,255,255,0.22)',
          }}
        >
          <div className="text-5xl mb-1">✓</div>
          <h2 className="text-2xl font-bold text-white">Guest {currentGuestNumber} Payment Complete</h2>
        </div>

        <div className="flex p-6 gap-6 rounded-b-2xl" style={{ minHeight: '340px', background: PAY_NEO_CANVAS }}>
          {/* ── Left: Payment Info + Receipt Options ── */}
          <div className="flex-1 flex flex-col">
            {/* Change */}
            {hasCashPayment && change > 0 && (
              <div className="mb-4 p-5 bg-red-50 border-2 border-red-300 rounded-xl text-center">
                <div className="text-lg font-bold text-red-700 mb-1">Change</div>
                <div className="text-[4rem] font-extrabold text-red-600 tracking-tight leading-none">
                  ${formatMoney(displayChange)}
                </div>
                {!changeAsTipApplied && onAddCashTip && (
                  <button
                    type="button"
                    className="mt-2 px-4 py-1.5 text-sm font-semibold text-green-700 bg-green-100 hover:bg-green-200 rounded-full border border-green-300 transition-all active:scale-95"
                    onClick={handleChangeAsTip}
                  >
                    💰 Click to add as Tip
                  </button>
                )}
                {changeAsTipApplied && (
                  <div className="mt-2 text-sm font-semibold text-green-600">
                    ✓ ${formatMoney(change)} added as Tip
                  </div>
                )}
              </div>
            )}

            {/* Payment Summary */}
            <div className="mb-4 p-4 rounded-xl" style={PAY_NEO.inset}>
              <div className="flex justify-between items-center mb-3 pb-3 border-b border-gray-300">
                <span className="text-lg font-semibold text-gray-700">Guest {currentGuestNumber} Total</span>
                <span className="text-2xl font-bold text-gray-900">${formatMoney(total)}</span>
              </div>
              <div className="space-y-2">
                {payments.map((p, i) => (
                  <div key={`partial-pay-${i}`} className="flex justify-between items-center">
                    <span className="text-base text-gray-600 font-medium">{p.method}</span>
                    <span className="text-base font-semibold text-gray-800">${formatMoney(p.amount)}</span>
                  </div>
                ))}
              </div>
              {/* Tip 표시 */}
              {displayTip > 0 && (
                <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-200">
                  <span className="text-base font-semibold text-green-700">Tip</span>
                  <span className="text-base font-bold text-green-600">${formatMoney(displayTip)}</span>
                </div>
              )}
            </div>

            {/* Receipt Options */}
            <div className="mt-auto">
              <div className="text-center mb-3">
                <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Receipt for Guest {currentGuestNumber}</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <button
                  type="button"
                  disabled={isSubmittingReceipt}
                  onClick={() => handlePartialReceiptClick(0)}
                  className={`border-0 py-4 px-2 text-sm font-bold text-white ${selectedReceipt === 0 ? NEO_MODAL_BTN_PRESS : NEO_COLOR_BTN_PRESS} disabled:cursor-not-allowed disabled:opacity-50`}
                  style={
                    selectedReceipt === 0
                      ? { ...PAY_NEO.inset, ...PCM_RX_ROUND, background: '#1f2937', color: '#fff' }
                      : { ...OH_ACTION_NEO.slate, ...PCM_RX_ROUND }
                  }
                >
                  {selectedReceipt === 0 ? '✓ No Receipt' : 'No Receipt'}
                </button>
                <button
                  type="button"
                  disabled={isSubmittingReceipt}
                  onClick={() => handlePartialReceiptClick(1)}
                  className={`border-0 py-4 px-2 text-sm font-bold text-white ${selectedReceipt === 1 ? NEO_MODAL_BTN_PRESS : NEO_COLOR_BTN_PRESS} disabled:cursor-not-allowed disabled:opacity-50`}
                  style={
                    selectedReceipt === 1
                      ? { ...PAY_NEO.inset, ...PCM_RX_ROUND, background: '#1e3a8a', color: '#fff' }
                      : { ...PAY_NEO_PRIMARY_BLUE, ...PCM_RX_ROUND }
                  }
                >
                  {selectedReceipt === 1 ? '✓ 1 Receipt' : '1 Receipt'}
                </button>
                <button
                  type="button"
                  disabled={isSubmittingReceipt}
                  onClick={() => handlePartialReceiptClick(2)}
                  className={`border-0 py-4 px-2 text-sm font-bold text-white ${selectedReceipt === 2 ? NEO_MODAL_BTN_PRESS : NEO_COLOR_BTN_PRESS} disabled:cursor-not-allowed disabled:opacity-50`}
                  style={
                    selectedReceipt === 2
                      ? { ...PAY_NEO.inset, ...PCM_RX_ROUND, background: '#14532d', color: '#fff' }
                      : { ...OH_ACTION_NEO.green, ...PCM_RX_ROUND }
                  }
                >
                  {selectedReceipt === 2 ? '✓ 2 Receipts' : '2 Receipts'}
                </button>
              </div>
            </div>
          </div>

          {/* ── Right: Guest List (영수증 그리드는 payment-lock 유지) ── */}
          <div className="flex w-[180px] flex-col rounded-xl p-2" style={PAY_NEO.inset}>
            <div className="mb-3 text-center">
              <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Guests</span>
            </div>

            {/* Guest buttons - vertical list */}
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
              {allGuests.map((g) => {
                const isPaid = paidGuests.includes(g);
                return (
                  <button
                    key={`guest-btn-${g}`}
                    type="button"
                    disabled={isPaid}
                    onClick={() => handleGuestClick(g)}
                    className={`w-full min-h-[56px] rounded-xl border-0 px-4 text-base font-semibold ${isPaid ? 'cursor-not-allowed text-gray-400' : `cursor-pointer text-gray-700 ${NEO_MODAL_BTN_PRESS}`}`}
                    style={isPaid ? { ...PAY_NEO.inset, opacity: 0.72 } : PAY_NEO.key}
                  >
                    <div className="flex items-center justify-between">
                      <span>Guest {g}</span>
                      {isPaid && (
                        <span className="text-xs font-bold text-green-500 bg-green-50 px-2 py-0.5 rounded-full">PAID</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Remaining count */}
            {unpaidGuests.length > 0 && (
              <div className="mt-2 text-center text-xs text-gray-400">
                {unpaidGuests.length} guest{unpaidGuests.length > 1 ? 's' : ''} remaining
              </div>
            )}

            {/* Back to Order */}
            <button
              type="button"
              onClick={handleBackClick}
              className={`mt-3 w-full min-h-[56px] rounded-xl border-0 px-4 text-base font-semibold text-gray-600 ${NEO_MODAL_BTN_PRESS}`}
              style={PAY_NEO.key}
            >
              ← Back to Order
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PaymentCompleteModal;
