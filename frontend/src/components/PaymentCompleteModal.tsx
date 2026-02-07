import React, { useState, useEffect } from 'react';

interface PaymentCompleteModalProps {
  isOpen: boolean;
  onClose: (receiptCount: number) => void;
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
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        
        {/* Modal */}
        <div className="relative bg-white rounded-2xl shadow-2xl w-[504px] overflow-hidden animate-in zoom-in-95 duration-200">
          {/* Header */}
          <div className="bg-gradient-to-r from-green-500 to-green-600 px-8 py-6 text-center">
            <div className="text-6xl mb-2">✓</div>
            <h2 className="text-3xl font-bold text-white">Payment Complete</h2>
          </div>
          
          {/* Content */}
          <div className="p-8">
            {/* Change Display */}
            {change > 0 && (
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
            <div className="mb-6 p-5 bg-gray-50 border border-gray-200 rounded-xl">
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
              <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-xl">
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
                    className="flex-1 h-12 px-3 text-xl font-semibold text-right border border-green-300 rounded-lg outline-none focus:ring-2 focus:ring-green-400 bg-white"
                    onKeyDown={e => { if (e.key === 'Enter') handleAddCashTip(); }}
                  />
                  <button
                    onClick={handleAddCashTip}
                    disabled={!cashTipInput || parseFloat(cashTipInput) <= 0}
                    className="h-12 px-5 rounded-lg font-bold text-white bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all active:scale-95"
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
                  onClick={() => onClose(0)}
                  className="py-6 px-4 rounded-xl font-bold text-lg transition-all bg-gray-600 hover:bg-gray-700 text-white shadow-lg active:scale-95"
                >
                  No Receipt
                </button>
                <button
                  onClick={() => onClose(1)}
                  className="py-6 px-4 rounded-xl font-bold text-lg transition-all bg-blue-600 hover:bg-blue-700 text-white shadow-lg active:scale-95"
                >
                  1 Receipt
                </button>
                <button
                  onClick={() => onClose(2)}
                  className="py-6 px-4 rounded-xl font-bold text-lg transition-all bg-green-600 hover:bg-green-700 text-white shadow-lg active:scale-95"
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
  const handlePartialReceiptClick = (count: number) => {
    setSelectedReceipt(count);
    if (onPrintReceipt) onPrintReceipt(count);
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
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      
      {/* Modal - wider for 2-column layout */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-[700px] overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-green-500 to-green-600 px-8 py-5 text-center">
          <div className="text-5xl mb-1">✓</div>
          <h2 className="text-2xl font-bold text-white">Guest {currentGuestNumber} Payment Complete</h2>
        </div>

        {/* 2-column content */}
        <div className="flex p-6 gap-6" style={{ minHeight: '340px' }}>
          {/* ── Left: Payment Info + Receipt Options ── */}
          <div className="flex-1 flex flex-col">
            {/* Change */}
            {change > 0 && (
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
            <div className="mb-4 p-4 bg-gray-50 border border-gray-200 rounded-xl">
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
                  onClick={() => handlePartialReceiptClick(0)}
                  className={`py-4 px-2 rounded-xl font-bold text-sm transition-all active:scale-95 ${
                    selectedReceipt === 0
                      ? 'bg-gray-800 text-white ring-2 ring-gray-900'
                      : 'bg-gray-600 hover:bg-gray-700 text-white shadow-md'
                  }`}
                >
                  {selectedReceipt === 0 ? '✓ No Receipt' : 'No Receipt'}
                </button>
                <button
                  onClick={() => handlePartialReceiptClick(1)}
                  className={`py-4 px-2 rounded-xl font-bold text-sm transition-all active:scale-95 ${
                    selectedReceipt === 1
                      ? 'bg-blue-800 text-white ring-2 ring-blue-900'
                      : 'bg-blue-600 hover:bg-blue-700 text-white shadow-md'
                  }`}
                >
                  {selectedReceipt === 1 ? '✓ 1 Receipt' : '1 Receipt'}
                </button>
                <button
                  onClick={() => handlePartialReceiptClick(2)}
                  className={`py-4 px-2 rounded-xl font-bold text-sm transition-all active:scale-95 ${
                    selectedReceipt === 2
                      ? 'bg-green-800 text-white ring-2 ring-green-900'
                      : 'bg-green-600 hover:bg-green-700 text-white shadow-md'
                  }`}
                >
                  {selectedReceipt === 2 ? '✓ 2 Receipts' : '2 Receipts'}
                </button>
              </div>
            </div>
          </div>

          {/* ── Right: Guest List ── */}
          <div className="w-[180px] flex flex-col">
            <div className="text-center mb-3">
              <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Guests</span>
            </div>

            {/* Guest buttons - vertical list */}
            <div className="flex-1 flex flex-col gap-2 overflow-y-auto">
              {allGuests.map((g) => {
                const isPaid = paidGuests.includes(g);
                return (
                  <button
                    key={`guest-btn-${g}`}
                    disabled={isPaid}
                    onClick={() => handleGuestClick(g)}
                    className={`
                      w-full min-h-[56px] px-4 rounded-xl text-base font-semibold transition-all
                      ${isPaid
                        ? 'bg-gray-50 border border-gray-200 text-gray-400 cursor-not-allowed'
                        : 'bg-white/80 backdrop-blur-sm border border-gray-200/80 shadow-sm hover:bg-white hover:shadow-md hover:border-blue-300 text-gray-700 active:scale-[0.97] cursor-pointer'
                      }
                    `}
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
              onClick={handleBackClick}
              className="mt-3 w-full min-h-[56px] px-4 rounded-xl text-base font-semibold bg-white/80 backdrop-blur-sm border border-gray-300/80 shadow-sm hover:bg-gray-50 hover:shadow-md text-gray-500 active:scale-[0.97] transition-all"
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
