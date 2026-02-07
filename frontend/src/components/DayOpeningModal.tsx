import React, { useState, useEffect } from 'react';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3177/api';

interface DayOpeningModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpeningComplete: (data: any) => void;
}

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount || 0);
};

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
  { key: 'dollar2', label: '$2', value: 2 },
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
  dollar2: number;
  dollar5: number;
  dollar10: number;
  dollar20: number;
  dollar50: number;
  dollar100: number;
};

const DayOpeningModal: React.FC<DayOpeningModalProps> = ({ isOpen, onClose, onOpeningComplete }) => {
  const [isOpening, setIsOpening] = useState(false);
  const [cashCounts, setCashCounts] = useState<CashCounts>({
    cent1: 0, cent5: 0, cent10: 0, cent25: 0,
    dollar1: 0, dollar2: 0, dollar5: 0, dollar10: 0, dollar20: 0, dollar50: 0, dollar100: 0
  });
  const [focusedDenom, setFocusedDenom] = useState<string>('dollar1');
  
  const calculateCashTotal = () => {
    return allDenominations.reduce((sum, denom) => {
      return sum + (cashCounts[denom.key as keyof CashCounts] * denom.value);
    }, 0);
  };
  
  const openingCashTotal = calculateCashTotal();

  useEffect(() => {
    if (isOpen) {
      setCashCounts({
        cent1: 0, cent5: 0, cent10: 0, cent25: 0,
        dollar1: 0, dollar2: 0, dollar5: 0, dollar10: 0, dollar20: 0, dollar50: 0, dollar100: 0
      });
      setFocusedDenom('dollar1');
    }
  }, [isOpen]);

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

  const handleOpenDay = async () => {
    setIsOpening(true);
    try {
      const response = await fetch(`${API_URL}/daily-closings/opening`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          openingCash: openingCashTotal,
          cashBreakdown: cashCounts,
          openedBy: '' 
        })
      });
      const result = await response.json();
      
      if (result.success) {
        // Print Opening Report
        await fetch(`${API_URL}/daily-closings/print-opening`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            openingCash: openingCashTotal,
            cashBreakdown: cashCounts
          })
        });
        
        onOpeningComplete(result.data);
      } else {
        alert(result.error || 'Opening failed');
      }
    } catch (error: any) {
      console.error('Opening error:', error);
      alert('Opening failed: ' + error.message);
    } finally {
      setIsOpening(false);
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
        className={`flex items-center justify-between px-3 py-3 rounded-lg border-2 cursor-pointer transition-all ${baseStyle}`}
      >
        <span className={`font-bold text-base ${isCent ? 'text-amber-700' : 'text-green-700'}`}>{denom.label}</span>
        <div className="flex items-center gap-2">
          <span className={`font-bold text-lg ${isCent ? 'text-amber-600' : 'text-green-600'}`}>
            {cashCounts[denom.key as keyof CashCounts]}
          </span>
          <span className="text-xs text-gray-400">
            ={formatCurrency(cashCounts[denom.key as keyof CashCounts] * denom.value)}
          </span>
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-[820px]">
        {/* Header */}
        <div className="bg-green-600 text-white px-4 py-3 rounded-t-2xl">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">☀️ Day Opening - Count Starting Cash</h2>
            <span className="text-green-100 text-sm">
              {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="p-4">
          <div className="space-y-3">
            {/* Summary Row */}
            <div className="bg-green-50 rounded-lg p-3 text-center border border-green-200">
              <div className="text-xs text-green-600 uppercase font-bold tracking-wider">Total Starting Cash</div>
              <div className="text-3xl font-black text-green-700">{formatCurrency(openingCashTotal)}</div>
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
              <div className="w-[300px]">
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
                      style={{ minHeight: '68px' }}
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t bg-gray-50 rounded-b-2xl">
          <div className="flex gap-2">
            <button onClick={() => window.close()} className="flex-1 px-3 py-2.5 bg-gray-200 hover:bg-gray-300 rounded-lg font-semibold text-gray-700 text-sm">
              Exit
            </button>
            <button 
              onClick={handleOpenDay} 
              disabled={isOpening} 
              className="flex-[2] px-3 py-2.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 rounded-lg font-bold text-white shadow-lg"
            >
              {isOpening ? 'Opening...' : '🚀 Start Day & Print Opening Report'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DayOpeningModal;
