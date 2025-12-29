import React, { useState, useEffect } from 'react';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
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

const SalesReportPage = () => {
  const [selectedPeriod, setSelectedPeriod] = useState('day');
  const [salesSummary, setSalesSummary] = useState({
    totalSales: 0,
    totalOrders: 0,
    avgTicket: 0,
    totalTax: 0
  });
  const [refundSummary, setRefundSummary] = useState({
    totalRefunds: 0,
    totalAmount: 0,
    fullRefunds: 0,
    partialRefunds: 0
  });
  const [loading, setLoading] = useState(true);

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

  // 데이터 가져오기
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const { startDate, endDate } = getDateRange(selectedPeriod);
      
      try {
        // 매출 데이터 가져오기
        const ordersRes = await fetch(`${API_URL}/orders?startDate=${startDate}&endDate=${endDate}&status=PAID`);
        const ordersData = await ordersRes.json();
        
        if (ordersData.orders) {
          const orders = ordersData.orders;
          const totalSales = orders.reduce((sum: number, o: any) => sum + (o.total || 0), 0);
          const totalTax = orders.reduce((sum: number, o: any) => sum + (o.tax || 0), 0);
          setSalesSummary({
            totalSales,
            totalOrders: orders.length,
            avgTicket: orders.length > 0 ? totalSales / orders.length : 0,
            totalTax
          });
        }

        // 환불 데이터 가져오기
        const refundsRes = await fetch(`${API_URL}/refunds/report/summary?startDate=${startDate}&endDate=${endDate}`);
        const refundsData = await refundsRes.json();
        
        if (refundsData.success && refundsData.summary) {
          setRefundSummary({
            totalRefunds: refundsData.summary.total_refunds || 0,
            totalAmount: refundsData.summary.total_amount || 0,
            fullRefunds: refundsData.summary.full_refunds || 0,
            partialRefunds: refundsData.summary.partial_refunds || 0
          });
        }
      } catch (error) {
        console.error('Failed to fetch report data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [selectedPeriod]);

  // 샘플 데이터
  const dailySalesData = [
    { name: 'Mon', sales: 2400, orders: 24, avgTicket: 100 },
    { name: 'Tue', sales: 1398, orders: 18, avgTicket: 78 },
    { name: 'Wed', sales: 9800, orders: 98, avgTicket: 100 },
    { name: 'Thu', sales: 3908, orders: 39, avgTicket: 100 },
    { name: 'Fri', sales: 4800, orders: 48, avgTicket: 100 },
    { name: 'Sat', sales: 3800, orders: 38, avgTicket: 100 },
    { name: 'Sun', sales: 4300, orders: 43, avgTicket: 100 },
  ];

  const categorySalesData = [
    { name: 'Burgers', value: 35, fill: '#8884d8' },
    { name: 'Pizza', value: 25, fill: '#82ca9d' },
    { name: 'Pasta', value: 20, fill: '#ffc658' },
    { name: 'Salads', value: 15, fill: '#ff7300' },
    { name: 'Drinks', value: 5, fill: '#00C49F' },
  ];

  const hourlyData = [
    { hour: '6AM', sales: 1200 },
    { hour: '8AM', sales: 1800 },
    { hour: '10AM', sales: 2200 },
    { hour: '12PM', sales: 4500 },
    { hour: '2PM', sales: 3800 },
    { hour: '4PM', sales: 3200 },
    { hour: '6PM', sales: 5200 },
    { hour: '8PM', sales: 4800 },
    { hour: '10PM', sales: 2100 },
  ];

  const paymentMethodData = [
    { name: 'Credit Card', value: 45, fill: '#0088FE' },
    { name: 'Cash', value: 30, fill: '#00C49F' },
    { name: 'Mobile Pay', value: 15, fill: '#FFBB28' },
    { name: 'Online', value: 10, fill: '#FF8042' },
  ];

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">Sales Report</h1>
        <p className="text-gray-600">Comprehensive sales analysis and performance metrics</p>
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
              <p className="text-sm font-medium text-gray-600">Total Sales</p>
              <p className="text-2xl font-bold text-gray-900">${salesSummary.totalSales.toFixed(2)}</p>
              <p className="text-xs text-gray-500">{selectedPeriod === 'day' ? 'Today' : `Last ${selectedPeriod}`}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-5">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-blue-100">
              <span className="text-2xl">📦</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Total Orders</p>
              <p className="text-2xl font-bold text-gray-900">{salesSummary.totalOrders}</p>
              <p className="text-xs text-gray-500">Completed orders</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-5">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-purple-100">
              <span className="text-2xl">💵</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Average Ticket</p>
              <p className="text-2xl font-bold text-gray-900">${salesSummary.avgTicket.toFixed(2)}</p>
              <p className="text-xs text-gray-500">Per order</p>
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

        {/* Net Sales Card */}
        <div className="bg-white rounded-lg shadow-md p-5 border-l-4 border-green-500">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-green-100">
              <span className="text-2xl">✅</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Net Sales</p>
              <p className="text-2xl font-bold text-green-700">${(salesSummary.totalSales - refundSummary.totalAmount).toFixed(2)}</p>
              <p className="text-xs text-gray-500">After refunds</p>
            </div>
          </div>
        </div>
      </div>

      {/* Refund Details */}
      {refundSummary.totalRefunds > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-8">
          <h3 className="text-lg font-semibold text-red-800 mb-3">📊 Refund Summary</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg p-3 border border-red-100">
              <p className="text-sm text-gray-600">Total Refunds</p>
              <p className="text-xl font-bold text-red-600">{refundSummary.totalRefunds}</p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-red-100">
              <p className="text-sm text-gray-600">Refund Amount</p>
              <p className="text-xl font-bold text-red-600">${refundSummary.totalAmount.toFixed(2)}</p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-red-100">
              <p className="text-sm text-gray-600">Full Refunds</p>
              <p className="text-xl font-bold text-orange-600">{refundSummary.fullRefunds}</p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-red-100">
              <p className="text-sm text-gray-600">Partial Refunds</p>
              <p className="text-xl font-bold text-yellow-600">{refundSummary.partialRefunds}</p>
            </div>
          </div>
        </div>
      )}

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Daily Sales Trend */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Daily Sales Trend</h3>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={dailySalesData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Area type="monotone" dataKey="sales" stackId="1" stroke="#8884d8" fill="#8884d8" fillOpacity={0.6} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Category Sales Distribution */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Sales by Category</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={categorySalesData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent = 0 }) => `${name} ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {categorySalesData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Additional Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Hourly Sales Pattern */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Hourly Sales Pattern</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={hourlyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="hour" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="sales" fill="#82ca9d" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Payment Methods */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Payment Methods</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={paymentMethodData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent = 0 }) => `${name} ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {paymentMethodData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Detailed Metrics */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Detailed Metrics</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <h4 className="font-medium text-gray-700 mb-2">Top Selling Items</h4>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Classic Burger</span>
                <span className="text-sm font-medium">$2,450</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Margherita Pizza</span>
                <span className="text-sm font-medium">$1,890</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Caesar Salad</span>
                <span className="text-sm font-medium">$1,230</span>
              </div>
            </div>
          </div>
          
          <div>
            <h4 className="font-medium text-gray-700 mb-2">Peak Hours</h4>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Lunch (12-2 PM)</span>
                <span className="text-sm font-medium">35%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Dinner (6-8 PM)</span>
                <span className="text-sm font-medium">42%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Late Night (9-11 PM)</span>
                <span className="text-sm font-medium">23%</span>
              </div>
            </div>
          </div>
          
          <div>
            <h4 className="font-medium text-gray-700 mb-2">Customer Insights</h4>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">New Customers</span>
                <span className="text-sm font-medium">45</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Returning Customers</span>
                <span className="text-sm font-medium">200</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Avg. Visit Frequency</span>
                <span className="text-sm font-medium">2.3/week</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export {}; 