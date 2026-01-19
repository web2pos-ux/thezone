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

const DayClosingModal: React.FC<DayClosingModalProps> = ({ isOpen, onClose, onClosingComplete }) => {
  const [zReportData, setZReportData] = useState<ZReportData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  // Fetch Z-Report data
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

  useEffect(() => {
    if (isOpen) {
      fetchZReport();
    }
  }, [isOpen]);

  // Close day and print report
  const handleCloseDay = async () => {
    setIsClosing(true);
    try {
      // 1. Close the day
      const response = await fetch(`${API_URL}/daily-closings/closing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          closingCash: zReportData?.expected_cash || 0,
          closedBy: '' 
        })
      });
      const result = await response.json();
      
      if (result.success) {
        // 2. Print Z-Report
        await fetch(`${API_URL}/daily-closings/print-z-report`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            zReportData, 
            closingCash: zReportData?.expected_cash || 0,
            cashBreakdown: {}
          })
        });
        
        // 3. Update local state
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

  // Print Z-Report only (without closing)
  const handlePrintReport = async () => {
    try {
      await fetch(`${API_URL}/daily-closings/print-z-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          zReportData, 
          closingCash: zReportData?.expected_cash || 0,
          cashBreakdown: {}
        })
      });
    } catch (error: any) {
      console.error('Print error:', error);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-[600px] max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="bg-slate-800 text-white p-5">
          <h2 className="text-2xl font-bold text-center">🌙 Day Closing</h2>
          <p className="text-center text-slate-300 text-sm mt-1">
            {new Date().toLocaleDateString('en-US', { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            })}
          </p>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto max-h-[calc(85vh-180px)]">
          {isLoading ? (
            <div className="py-12 text-center">
              <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="mt-3 text-gray-500">Loading...</p>
            </div>
          ) : zReportData ? (
            <div className="space-y-4">
              {/* Sales Summary */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-emerald-50 rounded-xl p-4 text-center border border-emerald-200">
                  <div className="text-3xl font-bold text-emerald-600">{formatCurrency(zReportData.total_sales)}</div>
                  <div className="text-sm text-emerald-700 mt-1">Total Sales</div>
                </div>
                <div className="bg-blue-50 rounded-xl p-4 text-center border border-blue-200">
                  <div className="text-3xl font-bold text-blue-600">{zReportData.order_count}</div>
                  <div className="text-sm text-blue-700 mt-1">Orders</div>
                </div>
              </div>

              {/* Sales by Channel */}
              <div className="bg-gray-50 rounded-xl p-4">
                <h3 className="font-semibold text-gray-700 mb-3">📊 Sales by Channel</h3>
                <div className="grid grid-cols-4 gap-2 text-sm">
                  <div className="bg-white rounded-lg p-2 text-center shadow-sm">
                    <div className="font-bold text-gray-800">{formatCurrency(zReportData.dine_in_sales)}</div>
                    <div className="text-xs text-gray-500">Dine-In</div>
                  </div>
                  <div className="bg-white rounded-lg p-2 text-center shadow-sm">
                    <div className="font-bold text-gray-800">{formatCurrency(zReportData.togo_sales)}</div>
                    <div className="text-xs text-gray-500">Togo</div>
                  </div>
                  <div className="bg-white rounded-lg p-2 text-center shadow-sm">
                    <div className="font-bold text-gray-800">{formatCurrency(zReportData.online_sales)}</div>
                    <div className="text-xs text-gray-500">Online</div>
                  </div>
                  <div className="bg-white rounded-lg p-2 text-center shadow-sm">
                    <div className="font-bold text-gray-800">{formatCurrency(zReportData.delivery_sales)}</div>
                    <div className="text-xs text-gray-500">Delivery</div>
                  </div>
                </div>
              </div>

              {/* Payment Methods */}
              <div className="bg-gray-50 rounded-xl p-4">
                <h3 className="font-semibold text-gray-700 mb-3">💳 Payments</h3>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div className="bg-green-100 rounded-lg p-3 text-center">
                    <div className="font-bold text-green-700">{formatCurrency(zReportData.cash_sales)}</div>
                    <div className="text-xs text-green-600">Cash</div>
                  </div>
                  <div className="bg-blue-100 rounded-lg p-3 text-center">
                    <div className="font-bold text-blue-700">{formatCurrency(zReportData.card_sales)}</div>
                    <div className="text-xs text-blue-600">Card</div>
                  </div>
                  <div className="bg-gray-100 rounded-lg p-3 text-center">
                    <div className="font-bold text-gray-700">{formatCurrency(zReportData.other_sales)}</div>
                    <div className="text-xs text-gray-600">Other</div>
                  </div>
                </div>
              </div>

              {/* Tax & Tips */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-xl p-3 flex justify-between items-center">
                  <span className="text-gray-600">Tax</span>
                  <span className="font-bold">{formatCurrency(zReportData.tax_total)}</span>
                </div>
                <div className="bg-gray-50 rounded-xl p-3 flex justify-between items-center">
                  <span className="text-gray-600">Tips</span>
                  <span className="font-bold">{formatCurrency(zReportData.tip_total)}</span>
                </div>
              </div>

              {/* Adjustments (only show if there are any) */}
              {(zReportData.refund_total > 0 || zReportData.void_total > 0 || zReportData.discount_total > 0) && (
                <div className="bg-red-50 rounded-xl p-4 border border-red-100">
                  <h3 className="font-semibold text-red-700 mb-2">⚠️ Adjustments</h3>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    {zReportData.refund_total > 0 && (
                      <div className="text-center">
                        <div className="font-bold text-red-600">-{formatCurrency(zReportData.refund_total)}</div>
                        <div className="text-xs text-red-500">Refunds ({zReportData.refund_count})</div>
                      </div>
                    )}
                    {zReportData.void_total > 0 && (
                      <div className="text-center">
                        <div className="font-bold text-orange-600">-{formatCurrency(zReportData.void_total)}</div>
                        <div className="text-xs text-orange-500">Voids ({zReportData.void_count})</div>
                      </div>
                    )}
                    {zReportData.discount_total > 0 && (
                      <div className="text-center">
                        <div className="font-bold text-yellow-600">-{formatCurrency(zReportData.discount_total)}</div>
                        <div className="text-xs text-yellow-600">Discounts</div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="py-12 text-center text-gray-500">
              No data available
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 bg-gray-200 hover:bg-gray-300 rounded-xl font-semibold text-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handlePrintReport}
            disabled={!zReportData || isLoading}
            className="flex-1 px-4 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 rounded-xl font-semibold text-white transition-colors"
          >
            🖨️ Print Report
          </button>
          <button
            onClick={handleCloseDay}
            disabled={!zReportData || isLoading || isClosing}
            className="flex-[1.5] px-4 py-3 bg-red-500 hover:bg-red-600 disabled:bg-gray-300 rounded-xl font-bold text-white transition-colors"
          >
            {isClosing ? 'Closing...' : '✓ Close Day'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DayClosingModal;
