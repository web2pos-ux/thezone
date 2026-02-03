import React from 'react';

interface PaymentCompleteModalProps {
  isOpen: boolean;
  onClose: (receiptCount: number) => void;
  change: number;
  total: number;
  payments: Array<{ method: string; amount: number }>;
  hasCashPayment: boolean;
}

const PaymentCompleteModal: React.FC<PaymentCompleteModalProps> = ({
  isOpen,
  onClose,
  change,
  total,
  payments,
  hasCashPayment
}) => {
  if (!isOpen) return null;

  const formatMoney = (n: number) => 
    new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

  const handleReceiptClick = (count: number) => {
    onClose(count);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      
      {/* Modal - 20% 더 크게: 420px → 504px */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-[504px] overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header - Payment Complete */}
        <div className="bg-gradient-to-r from-green-500 to-green-600 px-8 py-6 text-center">
          <div className="text-6xl mb-2">✓</div>
          <h2 className="text-3xl font-bold text-white">Payment Complete</h2>
        </div>
        
        {/* Content - 20% 더 크게 */}
        <div className="p-8">
          {/* Change Display - 현금 결제 시 큰 빨간색 텍스트 (25% 더 크게) */}
          {hasCashPayment && change > 0 && (
            <div className="mb-8 p-6 bg-red-50 border-2 border-red-300 rounded-xl text-center">
              <div className="text-xl font-bold text-red-700 mb-2">Change</div>
              <div className="text-[5rem] font-extrabold text-red-600 tracking-tight leading-none">
                ${formatMoney(change)}
              </div>
            </div>
          )}
          
          {/* Payment Summary */}
          <div className="mb-8 p-5 bg-gray-50 border border-gray-200 rounded-xl">
            <div className="flex justify-between items-center mb-4 pb-4 border-b border-gray-300">
              <span className="text-xl font-semibold text-gray-700">Total</span>
              <span className="text-3xl font-bold text-gray-900">${formatMoney(total)}</span>
            </div>
            
            {/* Payment Methods */}
            <div className="space-y-3">
              {payments.map((p, i) => (
                <div key={`payment-${i}`} className="flex justify-between items-center">
                  <span className="text-lg text-gray-600 font-medium">{p.method}</span>
                  <span className="text-lg font-semibold text-gray-800">${formatMoney(p.amount)}</span>
                </div>
              ))}
            </div>
          </div>
          
          {/* Receipt Options - 버튼 더 크게 */}
          <div className="mb-2">
            <div className="text-center mb-4">
              <span className="text-base font-semibold text-gray-500 uppercase tracking-wide">Select Receipt Option</span>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <button
                onClick={() => handleReceiptClick(0)}
                className="py-6 px-4 rounded-xl font-bold text-lg transition-all bg-gray-600 hover:bg-gray-700 text-white shadow-lg active:scale-95"
              >
                No Receipt
              </button>
              <button
                onClick={() => handleReceiptClick(1)}
                className="py-6 px-4 rounded-xl font-bold text-lg transition-all bg-blue-600 hover:bg-blue-700 text-white shadow-lg active:scale-95"
              >
                1 Receipt
              </button>
              <button
                onClick={() => handleReceiptClick(2)}
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
};

export default PaymentCompleteModal;
