import React, { useState, useEffect } from 'react';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3177/api';

interface ZReportData {
  date: string;
  opening_cash: number;
  expected_cash: number;
  total_sales: number;
  order_count: number;
  tax_total: number;
  dine_in_sales: number;
  togo_sales: number;
  online_sales: number;
  delivery_sales: number;
  cash_sales: number;
  card_sales: number;
  other_sales: number;
  tip_total: number;
  refund_total: number;
  refund_count: number;
  void_total: number;
  void_count: number;
  discount_total: number;
  status: string;
}

interface DayClosingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onClosingComplete: () => void;
}

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount || 0);
};

const formatMoney = (amt: number) => `$${(amt || 0).toFixed(2)}`;

// Cent denominations
const centDenominations = [
  { key: 'cent1', label: '1¢', value: 0.01 },
  { key: 'cent5', label: '5¢', value: 0.05 },
  { key: 'cent10', label: '10¢', value: 0.10 },
  { key: 'cent25', label: '25¢', value: 0.25 },
];

// Dollar denominations
const dollarDenominations = [
  { key: 'dollar1', label: '$1', value: 1 },
  { key: 'dollar5', label: '$5', value: 5 },
  { key: 'dollar10', label: '$10', value: 10 },
  { key: 'dollar20', label: '$20', value: 20 },
  { key: 'dollar50', label: '$50', value: 50 },
  { key: 'dollar100', label: '$100', value: 100 },
];

const allDenominations = [...centDenominations, ...dollarDenominations];

type CashCounts = {
  cent1: number;
  cent5: number;
  cent10: number;
  cent25: number;
  dollar1: number;
  dollar5: number;
  dollar10: number;
  dollar20: number;
  dollar50: number;
  dollar100: number;
};

type ViewMode = 'cash-count' | 'print-preview';

const DayClosingModal: React.FC<DayClosingModalProps> = ({ isOpen, onClose, onClosingComplete }) => {
  const [zReportData, setZReportData] = useState<ZReportData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [hasUnpaidOrders, setHasUnpaidOrders] = useState(false);
  const [unpaidOrderCount, setUnpaidOrderCount] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('cash-count');
  
  const [cashCounts, setCashCounts] = useState<CashCounts>({
    cent1: 0, cent5: 0, cent10: 0, cent25: 0,
    dollar1: 0, dollar5: 0, dollar10: 0, dollar20: 0, dollar50: 0, dollar100: 0
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

  const checkUnpaidOrders = async () => {
    try {
      const response = await fetch(`${API_URL}/daily-closings/check-unpaid-orders`);
      const result = await response.json();
      if (result.success) {
        setHasUnpaidOrders(result.hasUnpaidOrders);
        setUnpaidOrderCount(result.count || 0);
        return result.hasUnpaidOrders;
      }
    } catch (error) {
      console.error('Failed to check unpaid orders:', error);
    }
    return false;
  };

  useEffect(() => {
    if (isOpen) {
      setCashCounts({
        cent1: 0, cent5: 0, cent10: 0, cent25: 0,
        dollar1: 0, dollar5: 0, dollar10: 0, dollar20: 0, dollar50: 0, dollar100: 0
      });
      setFocusedDenom('dollar1');
      setViewMode('cash-count');
      fetchZReport();
      checkUnpaidOrders();
    }
  }, [isOpen]);

  const fetchZReport = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_URL}/daily-closings/z-report`);
      const result = await response.json();
      if (result.success) {
        setZReportData(result.data);
      }
    } catch (error) {
      console.error('Failed to fetch Z-Report:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNumPad = (num: string) => {
    if (!focusedDenom) return;
    const currentValue = cashCounts[focusedDenom as keyof CashCounts];
    let newValue: number;
    
    if (num === 'C') {
      newValue = 0;
    } else if (num === '⌫') {
      newValue = Math.floor(currentValue / 10);
    } else {
      newValue = currentValue * 10 + parseInt(num);
      if (newValue > 9999) newValue = 9999;
    }
    
    setCashCounts(prev => ({ ...prev, [focusedDenom]: newValue }));
  };

  const printZReport = async () => {
    try {
      await fetch(`${API_URL}/daily-closings/print-z-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          zReportData, 
          closingCash: closingCashTotal,
          cashBreakdown: cashCounts
        })
      });
    } catch (error: any) {
      console.error('Print error:', error);
    }
  };

  const handleShowPreview = async () => {
    // Check for unpaid orders before showing preview
    const stillHasUnpaid = await checkUnpaidOrders();
    if (stillHasUnpaid) {
      alert('There are unpaid orders remaining. Please complete all payments before closing the day.');
      return;
    }
    setViewMode('print-preview');
  };

  const handlePrintAndClose = async () => {
    setIsClosing(true);
    try {
      const response = await fetch(`${API_URL}/daily-closings/closing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          closingCash: closingCashTotal,
          cashBreakdown: cashCounts,
          closedBy: '' 
        })
      });
      const result = await response.json();
      
      if (result.success) {
        // Print Z-Report
        await printZReport();
        const today = new Date().toISOString().split('T')[0];
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

  const renderDenomItem = (denom: { key: string; label: string; value: number }, isCent: boolean) => {
    const isSelected = focusedDenom === denom.key;
    const baseStyle = isCent
      ? isSelected 
        ? 'border-amber-500 bg-amber-100' 
        : 'border-amber-200 bg-amber-50 hover:border-amber-400'
      : isSelected 
        ? 'border-green-500 bg-green-100' 
        : 'border-green-200 bg-green-50 hover:border-green-400';
    
    return (
      <div 
        key={denom.key}
        onClick={() => setFocusedDenom(denom.key)}
        className={`flex items-center justify-between px-2 py-1.5 rounded border-2 cursor-pointer transition-all ${baseStyle}`}
      >
        <span className={`font-semibold text-sm ${isCent ? 'text-amber-700' : 'text-green-700'}`}>{denom.label}</span>
        <div className="flex items-center gap-1">
          <span className={`font-bold ${isCent ? 'text-amber-600' : 'text-green-600'}`}>
            {cashCounts[denom.key as keyof CashCounts]}
          </span>
          <span className="text-[10px] text-gray-400">
            ={formatCurrency(cashCounts[denom.key as keyof CashCounts] * denom.value)}
          </span>
        </div>
      </div>
    );
  };

  // Receipt style line helpers
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-[720px] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-slate-800 text-white px-5 py-3 flex-shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">
              {viewMode === 'cash-count' ? '🌙 Day Closing - Cash Count' : '🌙 Day Closing - Z Report'}
            </h2>
            <span className="text-slate-400 text-sm">
              {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </div>
        </div>

        {viewMode === 'cash-count' ? (
          /* ========== CASH COUNT VIEW ========== */
          <>
            {/* Content */}
            <div className="p-5 flex-1 overflow-y-auto">
              {isLoading ? (
                <div className="py-8 text-center">
                  <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
                  <p className="text-gray-500 text-sm mt-2">Loading...</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Cash Summary Row */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-blue-50 rounded-xl p-3 text-center border border-blue-200">
                      <div className="text-xs text-blue-600 font-medium">Counted Cash</div>
                      <div className="text-2xl font-bold text-blue-700">{formatCurrency(closingCashTotal)}</div>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-3 text-center border border-gray-200">
                      <div className="text-xs text-gray-600 font-medium">Expected Cash</div>
                      <div className="text-2xl font-bold text-gray-700">{formatCurrency(expectedCash)}</div>
                    </div>
                    <div className={`rounded-xl p-3 text-center border ${
                      cashDifference === 0 ? 'bg-green-50 border-green-200' : cashDifference > 0 ? 'bg-blue-50 border-blue-200' : 'bg-red-50 border-red-200'
                    }`}>
                      <div className={`text-xs font-medium ${cashDifference === 0 ? 'text-green-600' : cashDifference > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                        Difference
                      </div>
                      <div className={`text-2xl font-bold ${cashDifference === 0 ? 'text-green-700' : cashDifference > 0 ? 'text-blue-700' : 'text-red-700'}`}>
                        {cashDifference >= 0 ? '+' : ''}{formatCurrency(cashDifference)}
                      </div>
                    </div>
                  </div>

                  {/* Cash Input + Number Pad */}
                  <div className="flex gap-4">
                    {/* Left: Denominations */}
                    <div className="flex-1 space-y-3">
                      {/* Coins */}
                      <div className="bg-amber-50/50 rounded-xl border border-amber-200 p-3">
                        <div className="text-xs font-bold text-amber-700 mb-2">🪙 Coins</div>
                        <div className="grid grid-cols-2 gap-2">
                          {centDenominations.map(d => renderDenomItem(d, true))}
                        </div>
                      </div>
                      {/* Bills */}
                      <div className="bg-green-50/50 rounded-xl border border-green-200 p-3">
                        <div className="text-xs font-bold text-green-700 mb-2">💵 Bills</div>
                        <div className="grid grid-cols-2 gap-2">
                          {dollarDenominations.map(d => renderDenomItem(d, false))}
                        </div>
                      </div>
                    </div>

                    {/* Right: Number Pad */}
                    <div className="w-[280px]">
                      <div className="grid grid-cols-3 gap-2 h-full">
                        {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map(num => (
                          <button
                            key={num}
                            onClick={() => handleNumPad(num)}
                            className={`rounded-xl font-bold text-2xl transition-all flex items-center justify-center ${
                              num === 'C' 
                                ? 'bg-red-100 text-red-600 hover:bg-red-200 active:bg-red-300' 
                                : num === '⌫' 
                                  ? 'bg-yellow-100 text-yellow-600 hover:bg-yellow-200 active:bg-yellow-300'
                                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 active:bg-slate-300'
                            }`}
                            style={{ minHeight: '60px' }}
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
            <div className="px-5 py-4 border-t bg-gray-50 flex-shrink-0">
              {hasUnpaidOrders && (
                <div className="mb-3 p-3 bg-red-100 border border-red-300 rounded-xl flex items-center gap-3">
                  <span className="text-red-500 text-xl">⚠️</span>
                  <div className="flex-1">
                    <p className="text-red-700 font-semibold text-sm">
                      Cannot close day - {unpaidOrderCount} unpaid order{unpaidOrderCount !== 1 ? 's' : ''} remaining
                    </p>
                    <p className="text-red-600 text-xs mt-0.5">
                      Please complete all payments before closing the day.
                    </p>
                  </div>
                  <button 
                    onClick={checkUnpaidOrders}
                    className="px-4 py-2 bg-red-200 hover:bg-red-300 rounded-lg text-red-700 text-xs font-semibold"
                  >
                    Refresh
                  </button>
                </div>
              )}
              <div className="flex gap-3">
                <button 
                  onClick={onClose} 
                  className="flex-1 px-4 py-3 bg-gray-200 hover:bg-gray-300 rounded-xl font-semibold text-gray-700"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleShowPreview} 
                  disabled={isLoading || hasUnpaidOrders} 
                  className={`flex-[2] px-4 py-3 rounded-xl font-bold text-white ${
                    hasUnpaidOrders 
                      ? 'bg-gray-400 cursor-not-allowed' 
                      : 'bg-red-500 hover:bg-red-600 disabled:bg-gray-300'
                  }`}
                >
                  {hasUnpaidOrders ? '⛔ Complete Payments First' : 'Close Day & Z-Report →'}
                </button>
              </div>
            </div>
          </>
        ) : (
          /* ========== PRINT PREVIEW VIEW ========== */
          <>
            {/* Top Buttons */}
            <div className="px-5 py-3 border-b bg-gray-100 flex-shrink-0">
              <div className="flex gap-3">
                <button 
                  onClick={() => setViewMode('cash-count')} 
                  className="flex-1 px-4 py-3 bg-gray-300 hover:bg-gray-400 rounded-xl font-semibold text-gray-700"
                >
                  ← Back
                </button>
                <button 
                  onClick={handlePrintAndClose} 
                  disabled={isClosing} 
                  className="flex-[2] px-4 py-3 bg-slate-800 hover:bg-slate-900 disabled:bg-gray-400 rounded-xl font-bold text-white"
                >
                  {isClosing ? 'Processing...' : '🖨️ Print & Close Day'}
                </button>
              </div>
            </div>

            {/* Receipt Preview - Scrollable */}
            <div className="flex-1 overflow-y-auto bg-gray-200 p-6">
              <div className="max-w-[320px] mx-auto bg-white shadow-lg">
                {/* Receipt Paper Style */}
                <pre className="font-mono text-xs leading-relaxed p-4 whitespace-pre-wrap text-black">
{receiptLine('=')}{'\n'}
{receiptCenter('*** Z-REPORT ***')}{'\n'}
{receiptCenter('DAY CLOSING REPORT')}{'\n'}
{receiptLine('=')}{'\n'}
{receiptCenter(new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }))}{'\n'}
{receiptCenter(`Printed: ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`)}{'\n'}
{receiptLine('=')}{'\n'}
{'\n'}
{receiptCenter('-- SALES SUMMARY --')}{'\n'}
{receiptLine('-')}{'\n'}
{receiptLeftRight('Total Orders:', `${zReportData?.order_count || 0}`)}{'\n'}
{receiptLeftRight('Total Sales:', formatMoney(zReportData?.total_sales || 0))}{'\n'}
{receiptLeftRight('Tax Collected:', formatMoney(zReportData?.tax_total || 0))}{'\n'}
{receiptLeftRight('Tips:', formatMoney(zReportData?.tip_total || 0))}{'\n'}
{'\n'}
{receiptCenter('-- SALES BY CHANNEL --')}{'\n'}
{receiptLine('-')}{'\n'}
{receiptLeftRight('Dine-In:', formatMoney(zReportData?.dine_in_sales || 0))}{'\n'}
{receiptLeftRight('Togo:', formatMoney(zReportData?.togo_sales || 0))}{'\n'}
{receiptLeftRight('Online:', formatMoney(zReportData?.online_sales || 0))}{'\n'}
{receiptLeftRight('Delivery:', formatMoney(zReportData?.delivery_sales || 0))}{'\n'}
{'\n'}
{receiptCenter('-- PAYMENT BREAKDOWN --')}{'\n'}
{receiptLine('-')}{'\n'}
{receiptLeftRight('Cash:', formatMoney(zReportData?.cash_sales || 0))}{'\n'}
{receiptLeftRight('Card:', formatMoney(zReportData?.card_sales || 0))}{'\n'}
{receiptLeftRight('Other:', formatMoney(zReportData?.other_sales || 0))}{'\n'}
{'\n'}
{receiptCenter('-- ADJUSTMENTS --')}{'\n'}
{receiptLine('-')}{'\n'}
{receiptLeftRight(`Refunds (${zReportData?.refund_count || 0}):`, `-${formatMoney(zReportData?.refund_total || 0)}`)}{'\n'}
{receiptLeftRight(`Voids (${zReportData?.void_count || 0}):`, `-${formatMoney(zReportData?.void_total || 0)}`)}{'\n'}
{receiptLeftRight('Discounts:', `-${formatMoney(zReportData?.discount_total || 0)}`)}{'\n'}
{'\n'}
{receiptCenter('-- CASH DRAWER --')}{'\n'}
{receiptLine('-')}{'\n'}
{receiptLeftRight('Opening Cash:', formatMoney(zReportData?.opening_cash || 0))}{'\n'}
{receiptLeftRight('Cash Sales:', formatMoney(zReportData?.cash_sales || 0))}{'\n'}
{receiptLeftRight('Expected Cash:', formatMoney(expectedCash))}{'\n'}
{receiptLine('-')}{'\n'}
{receiptCenter('ACTUAL CASH COUNT')}{'\n'}
{cashCounts.cent1 > 0 ? receiptLeftRight(`1 Cent x ${cashCounts.cent1}`, formatMoney(cashCounts.cent1 * 0.01)) + '\n' : ''}
{cashCounts.cent5 > 0 ? receiptLeftRight(`5 Cents x ${cashCounts.cent5}`, formatMoney(cashCounts.cent5 * 0.05)) + '\n' : ''}
{cashCounts.cent10 > 0 ? receiptLeftRight(`10 Cents x ${cashCounts.cent10}`, formatMoney(cashCounts.cent10 * 0.10)) + '\n' : ''}
{cashCounts.cent25 > 0 ? receiptLeftRight(`25 Cents x ${cashCounts.cent25}`, formatMoney(cashCounts.cent25 * 0.25)) + '\n' : ''}
{cashCounts.dollar1 > 0 ? receiptLeftRight(`$1 Bills x ${cashCounts.dollar1}`, formatMoney(cashCounts.dollar1 * 1)) + '\n' : ''}
{cashCounts.dollar5 > 0 ? receiptLeftRight(`$5 Bills x ${cashCounts.dollar5}`, formatMoney(cashCounts.dollar5 * 5)) + '\n' : ''}
{cashCounts.dollar10 > 0 ? receiptLeftRight(`$10 Bills x ${cashCounts.dollar10}`, formatMoney(cashCounts.dollar10 * 10)) + '\n' : ''}
{cashCounts.dollar20 > 0 ? receiptLeftRight(`$20 Bills x ${cashCounts.dollar20}`, formatMoney(cashCounts.dollar20 * 20)) + '\n' : ''}
{cashCounts.dollar50 > 0 ? receiptLeftRight(`$50 Bills x ${cashCounts.dollar50}`, formatMoney(cashCounts.dollar50 * 50)) + '\n' : ''}
{cashCounts.dollar100 > 0 ? receiptLeftRight(`$100 Bills x ${cashCounts.dollar100}`, formatMoney(cashCounts.dollar100 * 100)) + '\n' : ''}
{receiptLine('-')}{'\n'}
{receiptLeftRight('ACTUAL CASH:', formatMoney(closingCashTotal))}{'\n'}
{receiptLeftRight('DIFFERENCE:', `${cashDifference >= 0 ? '+' : ''}${formatMoney(cashDifference)}`)}{'\n'}
{receiptLine('=')}{'\n'}
{'\n'}
{'\n'}
                </pre>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default DayClosingModal;
