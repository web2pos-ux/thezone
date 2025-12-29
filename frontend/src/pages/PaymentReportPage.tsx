import React, { useState, useEffect } from 'react';
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

export {};

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3177/api';

const PaymentReportPage = () => {
  const [selectedPeriod, setSelectedPeriod] = useState('day');
  const [refundByPayment, setRefundByPayment] = useState<any[]>([]);
  const [refundSummary, setRefundSummary] = useState({
    totalRefunds: 0,
    totalAmount: 0
  });

  // 날짜 범위 계산
  const getDateRange = (period: string) => {
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
  };

  // 환불 데이터 가져오기
  useEffect(() => {
    const fetchRefundData = async () => {
      const { startDate, endDate } = getDateRange(selectedPeriod);
      
      try {
        const response = await fetch(`${API_URL}/refunds/report/summary?startDate=${startDate}&endDate=${endDate}`);
        const data = await response.json();
        
        if (data.success) {
          setRefundSummary({
            totalRefunds: data.summary?.total_refunds || 0,
            totalAmount: data.summary?.total_amount || 0
          });
          setRefundByPayment(data.byPaymentMethod || []);
        }
      } catch (error) {
        console.error('Failed to fetch refund data:', error);
      }
    };

    fetchRefundData();
  }, [selectedPeriod]);

  // 샘플 데이터
  const paymentMethodData = [
    { method: 'Credit Card', transactions: 450, amount: 12500, percentage: 45 },
    { method: 'Cash', transactions: 300, amount: 8300, percentage: 30 },
    { method: 'Mobile Pay', transactions: 150, amount: 4200, percentage: 15 },
    { method: 'Online', transactions: 100, amount: 2800, percentage: 10 },
  ];

  const paymentTrendData = [
    { month: 'Jan', totalAmount: 11500, avgTransaction: 25.6, successRate: 98.5 },
    { month: 'Feb', totalAmount: 12200, avgTransaction: 26.1, successRate: 98.8 },
    { month: 'Mar', totalAmount: 12800, avgTransaction: 26.8, successRate: 99.1 },
    { month: 'Apr', totalAmount: 13500, avgTransaction: 27.2, successRate: 99.3 },
    { month: 'May', totalAmount: 14200, avgTransaction: 27.8, successRate: 99.5 },
    { month: 'Jun', totalAmount: 14800, avgTransaction: 28.3, successRate: 99.7 },
  ];

  const transactionStatusData = [
    { status: 'Successful', value: 95, fill: '#00C49F' },
    { status: 'Pending', value: 3, fill: '#FFBB28' },
    { status: 'Failed', value: 2, fill: '#FF8042' },
  ];

  const hourlyPaymentData = [
    { hour: '6AM', transactions: 25, amount: 650 },
    { hour: '8AM', transactions: 45, amount: 1200 },
    { hour: '10AM', transactions: 65, amount: 1800 },
    { hour: '12PM', transactions: 120, amount: 3200 },
    { hour: '2PM', transactions: 95, amount: 2500 },
    { hour: '4PM', transactions: 85, amount: 2200 },
    { hour: '6PM', transactions: 140, amount: 3800 },
    { hour: '8PM', transactions: 125, amount: 3400 },
    { hour: '10PM', transactions: 55, amount: 1500 },
  ];

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">Payment Report</h1>
        <p className="text-gray-600">Payment processing analysis and transaction insights</p>
      </div>

      {/* Period Selector */}
      <div className="mb-6">
        <div className="flex space-x-2">
          {['day', 'week', 'month', 'quarter', 'year'].map((period) => (
            <button
              key={period}
              onClick={() => setSelectedPeriod(period)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                selectedPeriod === period
                  ? 'bg-blue-500 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-100'
              }`}
            >
              {period.charAt(0).toUpperCase() + period.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <div className="bg-white rounded-lg shadow-md p-5">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-green-100">
              <span className="text-2xl">💰</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Total Revenue</p>
              <p className="text-2xl font-bold text-gray-900">$27,800</p>
              <p className="text-xs text-gray-500">{selectedPeriod === 'day' ? 'Today' : `Last ${selectedPeriod}`}</p>
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
              <p className="text-2xl font-bold text-gray-900">1,000</p>
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
              <p className="text-2xl font-bold text-gray-900">$27.80</p>
              <p className="text-xs text-gray-500">Per payment</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-5">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-orange-100">
              <span className="text-2xl">✅</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Success Rate</p>
              <p className="text-2xl font-bold text-gray-900">99.7%</p>
              <p className="text-xs text-gray-500">Approved</p>
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
              <p className="text-2xl font-bold text-red-600">-${refundSummary.totalAmount.toFixed(2)}</p>
              <p className="text-xs text-gray-500">{refundSummary.totalRefunds} refunds</p>
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
                dataKey="percentage"
              >
                {paymentMethodData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Transaction Status */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Transaction Status</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={transactionStatusData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ status, value }) => `${status} ${value}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {transactionStatusData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Payment Trends */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-8">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Payment Trends</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={paymentTrendData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis yAxisId="left" />
            <YAxis yAxisId="right" orientation="right" />
            <Tooltip />
            <Legend />
            <Line yAxisId="left" type="monotone" dataKey="totalAmount" stroke="#8884d8" strokeWidth={2} />
            <Line yAxisId="right" type="monotone" dataKey="successRate" stroke="#82ca9d" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Hourly Payment Pattern */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-8">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Hourly Payment Pattern</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={hourlyPaymentData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="hour" />
            <YAxis yAxisId="left" />
            <YAxis yAxisId="right" orientation="right" />
            <Tooltip />
            <Legend />
            <Bar yAxisId="left" dataKey="transactions" fill="#8884d8" />
            <Bar yAxisId="right" dataKey="amount" fill="#82ca9d" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Payment Insights */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Payment Insights</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <h4 className="font-medium text-gray-700 mb-2">Top Payment Methods</h4>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Credit Card</span>
                <span className="text-sm font-medium">$12,500</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Cash</span>
                <span className="text-sm font-medium">$8,300</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Mobile Pay</span>
                <span className="text-sm font-medium">$4,200</span>
              </div>
            </div>
          </div>
          
          <div>
            <h4 className="font-medium text-gray-700 mb-2">Transaction Analysis</h4>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Peak Hours</span>
                <span className="text-sm font-medium">6-8 PM</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Avg. Processing Time</span>
                <span className="text-sm font-medium">2.3 sec</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Decline Rate</span>
                <span className="text-sm font-medium">0.3%</span>
              </div>
            </div>
          </div>
          
          <div>
            <h4 className="font-medium text-gray-700 mb-2">Security Metrics</h4>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Fraud Attempts</span>
                <span className="text-sm font-medium">0</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Chargebacks</span>
                <span className="text-sm font-medium">2</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Disputes</span>
                <span className="text-sm font-medium">1</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PaymentReportPage; 