import React from 'react';
import PaymentModal from '../components/PaymentModal';

const DebugPaymentPage: React.FC = () => {
  const [open, setOpen] = React.useState(true);
  const [guestMode, setGuestMode] = React.useState<'ALL' | number>(1);
  const [guestCount] = React.useState<number>(8);
  const [payments, setPayments] = React.useState<Array<{ paymentId: number; method: string; amount: number; tip: number; guestNumber?: number }>>([]);

  const subtotal = 180.00;
  const taxLines = [{ name: 'Tax', amount: 14.83 }];
  const total = subtotal + taxLines.reduce((s, t) => s + t.amount, 0);

  const handleConfirm = async ({ method, amount, tip }: { method: string; amount: number; tip: number; }) => {
    // simulate processing delay
    await new Promise(r => setTimeout(r, 300));
    setPayments(prev => [
      ...prev,
      {
        paymentId: Date.now(),
        method,
        amount: Number((amount + tip).toFixed(2)),
        tip,
        guestNumber: typeof guestMode === 'number' ? guestMode : undefined,
      },
    ]);
  };

  const handleComplete = () => {
    // keep modal open for repeated viewing in the demo
  };

  const handleVoidPayment = (paymentId: number) => {
    setPayments(prev => prev.filter(p => p.paymentId !== paymentId));
  };

  const handleClearAllPayments = () => {
    setPayments([]);
  };

  return (
    <div className="w-full h-full flex items-center justify-center p-6">
      <button className="px-4 py-2 rounded bg-blue-600 text-white font-bold" onClick={() => setOpen(true)}>Open Split Payment Demo</button>
      <PaymentModal
        isOpen={open}
        onClose={() => setOpen(false)}
        subtotal={subtotal}
        taxLines={taxLines}
        total={total}
        onConfirm={handleConfirm}
        onComplete={handleComplete}
        channel={'POS'}
        customerName={undefined}
        tableName={'Demo Table A1'}
        onSplitBill={() => {}}
        guestCount={guestCount}
        guestMode={guestMode}
        onSelectGuestMode={setGuestMode}
        payments={payments}
        onVoidPayment={handleVoidPayment}
        onClearAllPayments={handleClearAllPayments}
      />
    </div>
  );
};

export default DebugPaymentPage; 