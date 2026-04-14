import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3177/api';

interface PaymentMethodData {
  method: string;
  count: number;
  amount: number;
  percentage: string | number;
}

interface HourlyData {
  hour: number;
  label: string;
  orders: number;
  revenue: number;
}

interface DailyTrendData {
  date: string;
  orders: number;
  revenue: number;
  avg_check?: number;
}

const PaymentReportPage = () => {
  const [selectedPeriod, setSelectedPeriod] = useState('week');
  const [customDateMode, setCustomDateMode] = useState(false);
  const [customStartDate, setCustomStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [customEndDate, setCustomEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(true);
  
  // 실제 데이터 상태
  const [paymentMethodData, setPaymentMethodData] = useState<PaymentMethodData[]>([]);
  const [hourlyData, setHourlyData] = useState<HourlyData[]>([]);
  const [dailyTrendData, setDailyTrendData] = useState<DailyTrendData[]>([]);
  const [refundByPayment, setRefundByPayment] = useState<any[]>([]);
  
  // Summary 상태
  const [summary, setSummary] = useState({
    totalRevenue: 0,
    totalTransactions: 0,
    avgTransaction: 0,
    totalRefunds: 0,
    refundAmount: 0
  });

  // 날짜 범위 계산
  const getDateRange = useCallback((period: string) => {
    if (customDateMode) {
      return { startDate: customStartDate, endDate: customEndDate };
    }
    
    const today = new Date();
    const endDate = today.toISOString().split('T')[0];
    let startDate = endDate;
    
    switch (period) {
      case 'day':
        startDate = endDate;
        break;
      case 'week':
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        startDate = weekAgo.toISOString().split('T')[0];
        break;
      case 'month':
        const monthAgo = new Date(today);
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        startDate = monthAgo.toISOString().split('T')[0];
        break;
      case 'quarter':
        const quarterAgo = new Date(today);
        quarterAgo.setMonth(quarterAgo.getMonth() - 3);
        startDate = quarterAgo.toISOString().split('T')[0];
        break;
      case 'year':
        const yearAgo = new Date(today);
        yearAgo.setFullYear(yearAgo.getFullYear() - 1);
        startDate = yearAgo.toISOString().split('T')[0];
        break;
    }
    return { startDate, endDate };
  }, [customDateMode, customStartDate, customEndDate]);

  // 데이터 가져오기
  const fetchData = useCallback(async () => {
    setLoading(true);
    const { startDate, endDate } = getDateRange(selectedPeriod);
    
    try {
      // 1. Payment Method Breakdown
      const paymentRes = await fetch(`${API_URL}/reports/payment-method-breakdown?startDate=${startDate}&endDate=${endDate}`);
      if (paymentRes.ok) {
        const paymentData = await paymentRes.json();
        if (paymentData.data?.chartData) {
          setPaymentMethodData(paymentData.data.chartData);
        }
      }

      // 2. Hourly Sales Distribution
      const hourlyRes = await fetch(`${API_URL}/reports/hourly-sales-distribution?startDate=${startDate}&endDate=${endDate}`);
      if (hourlyRes.ok) {
        const hourlyResult = await hourlyRes.json();
        if (hourlyResult.data?.chartData) {
          setHourlyData(hourlyResult.data.chartData);
        }
      }

      // 3. Weekly Sales Trend (for daily data)
      const trendRes = await fetch(`${API_URL}/reports/weekly-sales-trend?startDate=${startDate}&endDate=${endDate}`);
      if (trendRes.ok) {
        const trendResult = await trendRes.json();
        if (trendResult.data?.chartData) {
          setDailyTrendData(trendResult.data.chartData);
        }
      }

      // 4. Refund Summary
      const refundRes = await fetch(`${API_URL}/refunds/report/summary?startDate=${startDate}&endDate=${endDate}`);
      if (refundRes.ok) {
        const refundData = await refundRes.json();
        if (refundData.success) {
          setSummary(prev => ({
            ...prev,
            totalRefunds: refundData.summary?.total_refunds || 0,
            refundAmount: refundData.summary?.total_amount || 0
          }));
          setRefundByPayment(refundData.byPaymentMethod || []);
        }
      }

      // 5. Orders Summary (for total revenue and transactions)
      const ordersRes = await fetch(`${API_URL}/orders?startDate=${startDate}&endDate=${endDate}&status=PAID`);
      if (ordersRes.ok) {
        const ordersData = await ordersRes.json();
        if (ordersData.orders) {
          const orders = ordersData.orders;
          const totalRevenue = orders.reduce((sum: number, o: any) => sum + (o.total || 0), 0);
          const totalTransactions = orders.length;
          setSummary(prev => ({
            ...prev,
            totalRevenue,
            totalTransactions,
            avgTransaction: totalTransactions > 0 ? totalRevenue / totalTransactions : 0
          }));
        }
      }

    } catch (error) {
      console.error('Failed to fetch payment data:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedPeriod, getDateRange]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

  // 피크 시간 계산
  const getPeakHour = () => {
    if (hourlyData.length === 0) return 'N/A';
    const peak = hourlyData.reduce((max, h) => h.revenue > max.revenue ? h : max, hourlyData[0]);
    return peak?.label || 'N/A';
  };

  // 최다 결제 방법
  const getTopPaymentMethod = () => {
    if (paymentMethodData.length === 0) return { method: 'N/A', amount: 0 };
    const top = paymentMethodData.reduce((max, p) => p.amount > max.amount ? p : max, paymentMethodData[0]);
    return top;
  };

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">Payment Report</h1>
        <p className="text-gray-600">Payment processing analysis and transaction insights</p>
      </div>

      {/* Period Selector */}
      <div className="mb-6 bg-white rounded-lg shadow-md p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex space-x-2">
            {['day', 'week', 'month', 'quarter', 'year'].map((period) => (
              <button
                key={period}
                onClick={() => {
                  setCustomDateMode(false);
                  setSelectedPeriod(period);
                }}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  !customDateMode && selectedPeriod === period
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {period.charAt(0).toUpperCase() + period.slice(1)}
              </button>
            ))}
          </div>
          
          <div className="h-8 w-px bg-gray-300" />
          
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 font-medium">Custom:</span>
            <input
              type="date"
              value={customStartDate}
              onChange={(e) => setCustomStartDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-gray-400">to</span>
            <input
              type="date"
              value={customEndDate}
              onChange={(e) => setCustomEndDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={() => {
                setCustomDateMode(true);
                fetchData();
              }}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                customDateMode
                  ? 'bg-blue-500 text-white'
                  : 'bg-green-500 text-white hover:bg-green-600'
              }`}
            >
              Apply
            </button>
          </div>
        </div>
        
        {customDateMode && (
          <div className="mt-2 text-sm text-blue-600 font-medium">
            Showing data from {customStartDate} to {customEndDate}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Loading...</div>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
            <div className="bg-white rounded-lg shadow-md p-5">
              <div className="flex items-center">
                <div className="p-3 rounded-full bg-green-100">
                  <span className="text-2xl">💰</span>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Total Revenue</p>
                  <p className="text-2xl font-bold text-gray-900">${summary.totalRevenue.toFixed(2)}</p>
                  <p className="text-xs text-gray-500">{customDateMode ? `${customStartDate} ~ ${customEndDate}` : (selectedPeriod === 'day' ? 'Today' : `Last ${selectedPeriod}`)}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-md p-5">
              <div className="flex items-center">
                <div className="p-3 rounded-full bg-blue-100">
                  <span className="text-2xl">💳</span>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Transactions</p>
                  <p className="text-2xl font-bold text-gray-900">{summary.totalTransactions.toLocaleString()}</p>
                  <p className="text-xs text-gray-500">Total payments</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-md p-5">
              <div className="flex items-center">
                <div className="p-3 rounded-full bg-purple-100">
                  <span className="text-2xl">📊</span>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Avg. Transaction</p>
                  <p className="text-2xl font-bold text-gray-900">${summary.avgTransaction.toFixed(2)}</p>
                  <p className="text-xs text-gray-500">Per payment</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-md p-5">
              <div className="flex items-center">
                <div className="p-3 rounded-full bg-orange-100">
                  <span className="text-2xl">⏰</span>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Peak Hour</p>
                  <p className="text-2xl font-bold text-gray-900">{getPeakHour()}</p>
                  <p className="text-xs text-gray-500">Busiest time</p>
                </div>
              </div>
            </div>

            {/* Refunds Card */}
            <div className="bg-white rounded-lg shadow-md p-5 border-l-4 border-red-500">
              <div className="flex items-center">
                <div className="p-3 rounded-full bg-red-100">
                  <span className="text-2xl">↩️</span>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Refunds</p>
                  <p className="text-2xl font-bold text-red-600">-${summary.refundAmount.toFixed(2)}</p>
                  <p className="text-xs text-gray-500">{summary.totalRefunds} refunds</p>
                </div>
              </div>
            </div>
          </div>

          {/* Refund by Payment Method */}
          {refundByPayment.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-8">
              <h3 className="text-lg font-semibold text-red-800 mb-3">↩️ Refunds by Payment Method</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {refundByPayment.map((item: any, index: number) => (
                  <div key={index} className="bg-white rounded-lg p-3 border border-red-100">
                    <p className="text-sm text-gray-600">{item.payment_method || 'Unknown'}</p>
                    <p className="text-xl font-bold text-red-600">${(item.amount || 0).toFixed(2)}</p>
                    <p className="text-xs text-gray-500">{item.count} refunds</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Payment Methods */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Payment Methods Distribution</h3>
              {paymentMethodData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={paymentMethodData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ method, percentage }) => `${method} ${percentage}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="amount"
                      nameKey="method"
                    >
                      {paymentMethodData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => `$${value.toFixed(2)}`} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[300px] text-gray-500">
                  No payment data for this period
                </div>
              )}
            </div>

            {/* Hourly Payment Pattern */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Hourly Payment Pattern</h3>
              {hourlyData.some(h => h.orders > 0 || h.revenue > 0) ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={hourlyData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="left" />
                    <YAxis yAxisId="right" orientation="right" />
                    <Tooltip formatter={(value: number, name: string) => 
                      name === 'revenue' ? `$${value.toFixed(2)}` : value
                    } />
                    <Legend />
                    <Bar yAxisId="left" dataKey="orders" fill="#8884d8" name="Orders" />
                    <Bar yAxisId="right" dataKey="revenue" fill="#82ca9d" name="Revenue" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[300px] text-gray-500">
                  No hourly data for this period
                </div>
              )}
            </div>
          </div>

          {/* Daily Trend */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-8">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Daily Sales Trend</h3>
            {dailyTrendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={dailyTrendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="left" />
                  <YAxis yAxisId="right" orientation="right" />
                  <Tooltip formatter={(value: number, name: string) => 
                    name === 'revenue' ? `$${value.toFixed(2)}` : value
                  } />
                  <Legend />
                  <Line yAxisId="left" type="monotone" dataKey="revenue" stroke="#8884d8" strokeWidth={2} name="Revenue" />
                  <Line yAxisId="right" type="monotone" dataKey="orders" stroke="#82ca9d" strokeWidth={2} name="Orders" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-gray-500">
                No trend data for this period
              </div>
            )}
          </div>

          {/* Payment Insights */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Payment Insights</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <h4 className="font-medium text-gray-700 mb-2">Top Payment Methods</h4>
                <div className="space-y-2">
                  {paymentMethodData.slice(0, 3).map((item, idx) => (
                    <div key={idx} className="flex justify-between">
                      <span className="text-sm text-gray-600">{item.method}</span>
                      <span className="text-sm font-medium">${item.amount.toFixed(2)}</span>
                    </div>
                  ))}
                  {paymentMethodData.length === 0 && (
                    <p className="text-sm text-gray-400">No data</p>
                  )}
                </div>
              </div>
              
              <div>
                <h4 className="font-medium text-gray-700 mb-2">Transaction Analysis</h4>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Peak Hour</span>
                    <span className="text-sm font-medium">{getPeakHour()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Top Method</span>
                    <span className="text-sm font-medium">{getTopPaymentMethod().method}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Avg. Check</span>
                    <span className="text-sm font-medium">${summary.avgTransaction.toFixed(2)}</span>
                  </div>
                </div>
              </div>
              
              <div>
                <h4 className="font-medium text-gray-700 mb-2">Refund Summary</h4>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Total Refunds</span>
                    <span className="text-sm font-medium">{summary.totalRefunds}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Refund Amount</span>
                    <span className="text-sm font-medium text-red-600">-${summary.refundAmount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Refund Rate</span>
                    <span className="text-sm font-medium">
                      {summary.totalTransactions > 0 
                        ? ((summary.totalRefunds / summary.totalTransactions) * 100).toFixed(2) 
                        : 0}%
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default PaymentReportPage;
