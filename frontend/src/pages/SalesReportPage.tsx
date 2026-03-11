import React, { useState, useEffect, useCallback } from 'react';
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

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#ff7300'];

const SalesReportPage = () => {
  const [selectedPeriod, setSelectedPeriod] = useState('day');
  const [customDateMode, setCustomDateMode] = useState(false);
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  
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
  
  const [dailySalesData, setDailySalesData] = useState<any[]>([]);
  const [categorySalesData, setCategorySalesData] = useState<any[]>([]);
  const [hourlyData, setHourlyData] = useState<any[]>([]);
  const [paymentMethodData, setPaymentMethodData] = useState<any[]>([]);
  const [topSellingItems, setTopSellingItems] = useState<any[]>([]);
  
  const [loading, setLoading] = useState(true);

  const getDateRange = useCallback((period: string) => {
    if (customDateMode) {
      return { startDate, endDate };
    }
    
    const today = new Date();
    const end = today.toISOString().split('T')[0];
    let start = end;
    
    switch (period) {
      case 'day':
        start = end;
        break;
      case 'week':
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        start = weekAgo.toISOString().split('T')[0];
        break;
      case 'month':
        const monthAgo = new Date(today);
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        start = monthAgo.toISOString().split('T')[0];
        break;
      case 'quarter':
        const quarterAgo = new Date(today);
        quarterAgo.setMonth(quarterAgo.getMonth() - 3);
        start = quarterAgo.toISOString().split('T')[0];
        break;
      case 'year':
        const yearAgo = new Date(today);
        yearAgo.setFullYear(yearAgo.getFullYear() - 1);
        start = yearAgo.toISOString().split('T')[0];
        break;
    }
    return { startDate: start, endDate: end };
  }, [customDateMode, startDate, endDate]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { startDate: start, endDate: end } = getDateRange(selectedPeriod);
    
    try {
      const ordersRes = await fetch(`${API_URL}/orders?startDate=${start}&endDate=${end}&status=PAID`);
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

        const salesByDate: Record<string, { date: string; sales: number; orders: number }> = {};
        orders.forEach((o: any) => {
          const dateKey = o.created_at?.split('T')[0] || o.order_date?.split('T')[0] || 'Unknown';
          if (!salesByDate[dateKey]) {
            salesByDate[dateKey] = { date: dateKey, sales: 0, orders: 0 };
          }
          salesByDate[dateKey].sales += (o.total || 0);
          salesByDate[dateKey].orders += 1;
        });
        const dailyData = Object.values(salesByDate).sort((a, b) => a.date.localeCompare(b.date));
        setDailySalesData(dailyData.map(d => ({
          name: d.date,
          sales: d.sales,
          orders: d.orders,
          avgTicket: d.orders > 0 ? d.sales / d.orders : 0
        })));

        const salesByHour: Record<number, number> = {};
        orders.forEach((o: any) => {
          const hour = new Date(o.created_at || o.order_date).getHours();
          if (!salesByHour[hour]) salesByHour[hour] = 0;
          salesByHour[hour] += (o.total || 0);
        });
        const hourlyArr = [];
        for (let h = 6; h < 24; h++) {
          hourlyArr.push({
            hour: `${h}:00`,
            sales: salesByHour[h] || 0
          });
        }
        setHourlyData(hourlyArr);
      } else {
        setSalesSummary({ totalSales: 0, totalOrders: 0, avgTicket: 0, totalTax: 0 });
        setDailySalesData([]);
        setHourlyData([]);
      }

      const refundsRes = await fetch(`${API_URL}/refunds/report/summary?startDate=${start}&endDate=${end}`);
      const refundsData = await refundsRes.json();
      
      if (refundsData.success && refundsData.summary) {
        setRefundSummary({
          totalRefunds: refundsData.summary.total_refunds || 0,
          totalAmount: refundsData.summary.total_amount || 0,
          fullRefunds: refundsData.summary.full_refunds || 0,
          partialRefunds: refundsData.summary.partial_refunds || 0
        });
      } else {
        setRefundSummary({ totalRefunds: 0, totalAmount: 0, fullRefunds: 0, partialRefunds: 0 });
      }

      try {
        const paymentsRes = await fetch(`${API_URL}/payments?startDate=${start}&endDate=${end}`);
        const paymentsData = await paymentsRes.json();
        
        if (paymentsData.payments || Array.isArray(paymentsData)) {
          const payments = paymentsData.payments || paymentsData;
          const byMethod: Record<string, number> = {};
          payments.forEach((p: any) => {
            const method = p.payment_method || p.method || 'Other';
            if (!byMethod[method]) byMethod[method] = 0;
            byMethod[method] += (p.amount || 0);
          });
          const total = Object.values(byMethod).reduce((a, b) => a + b, 0);
          const paymentArr = Object.entries(byMethod).map(([name, value], idx) => ({
            name,
            value,
            percentage: total > 0 ? ((value / total) * 100).toFixed(1) : '0',
            fill: COLORS[idx % COLORS.length]
          }));
          setPaymentMethodData(paymentArr);
        } else {
          setPaymentMethodData([]);
        }
      } catch {
        setPaymentMethodData([]);
      }

      try {
        const categoryRes = await fetch(`${API_URL}/reports/category-sales-breakdown?startDate=${start}&endDate=${end}`);
        const categoryData = await categoryRes.json();
        
        if (categoryData.data?.chartData) {
          setCategorySalesData(categoryData.data.chartData.map((c: any, idx: number) => ({
            name: c.name || c.category || 'Unknown',
            value: c.revenue || c.sales || c.value || 0,
            fill: COLORS[idx % COLORS.length]
          })));
        } else {
          setCategorySalesData([]);
        }
      } catch {
        setCategorySalesData([]);
      }

      try {
        const topItemsRes = await fetch(`${API_URL}/reports/top-selling-items?startDate=${start}&endDate=${end}`);
        const topItemsData = await topItemsRes.json();
        
        if (topItemsData.data?.chartData) {
          setTopSellingItems(topItemsData.data.chartData.slice(0, 5));
        } else {
          setTopSellingItems([]);
        }
      } catch {
        setTopSellingItems([]);
      }

    } catch (error) {
      console.error('Failed to fetch report data:', error);
    } finally {
      setLoading(false);
    }
  }, [getDateRange, selectedPeriod]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handlePeriodClick = (period: string) => {
    setCustomDateMode(false);
    setSelectedPeriod(period);
  };

  const handleCustomDateApply = () => {
    setCustomDateMode(true);
    fetchData();
  };

  const formatCurrency = (value: number) => `$${value.toFixed(2)}`;

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">Sales Report</h1>
        <p className="text-gray-600">Comprehensive sales analysis and performance metrics</p>
      </div>

      {/* Period Selector */}
      <div className="mb-6 bg-white rounded-lg shadow-md p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex space-x-2">
            {['day', 'week', 'month', 'quarter', 'year'].map((period) => (
              <button
                key={period}
                onClick={() => handlePeriodClick(period)}
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
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-gray-400">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleCustomDateApply}
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
            Showing data from {startDate} to {endDate}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
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
                  <p className="text-sm font-medium text-gray-600">Total Sales</p>
                  <p className="text-2xl font-bold text-gray-900">{formatCurrency(salesSummary.totalSales)}</p>
                  <p className="text-xs text-gray-500">{customDateMode ? `${startDate} ~ ${endDate}` : (selectedPeriod === 'day' ? 'Today' : `Last ${selectedPeriod}`)}</p>
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
                  <p className="text-2xl font-bold text-gray-900">{formatCurrency(salesSummary.avgTicket)}</p>
                  <p className="text-xs text-gray-500">Per order</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-md p-5 border-l-4 border-red-500">
              <div className="flex items-center">
                <div className="p-3 rounded-full bg-red-100">
                  <span className="text-2xl">↩️</span>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Refunds</p>
                  <p className="text-2xl font-bold text-red-600">-{formatCurrency(refundSummary.totalAmount)}</p>
                  <p className="text-xs text-gray-500">{refundSummary.totalRefunds} refunds</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-md p-5 border-l-4 border-green-500">
              <div className="flex items-center">
                <div className="p-3 rounded-full bg-green-100">
                  <span className="text-2xl">✅</span>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Net Sales</p>
                  <p className="text-2xl font-bold text-green-700">{formatCurrency(salesSummary.totalSales - refundSummary.totalAmount)}</p>
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
                  <p className="text-xl font-bold text-red-600">{formatCurrency(refundSummary.totalAmount)}</p>
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
              {dailySalesData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={dailySalesData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tickFormatter={(v) => `$${v}`} />
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    <Legend />
                    <Area type="monotone" dataKey="sales" stackId="1" stroke="#8884d8" fill="#8884d8" fillOpacity={0.6} name="Sales" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[300px] text-gray-400">No data available for selected period</div>
              )}
            </div>

            {/* Category Sales Distribution */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Sales by Category</h3>
              {categorySalesData.length > 0 ? (
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
                        <Cell key={`cell-${index}`} fill={entry.fill || COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[300px] text-gray-400">No category data available</div>
              )}
            </div>
          </div>

          {/* Additional Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Hourly Sales Pattern */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Hourly Sales Pattern</h3>
              {hourlyData.some(h => h.sales > 0) ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={hourlyData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                    <YAxis tickFormatter={(v) => `$${v}`} />
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    <Bar dataKey="sales" fill="#82ca9d" name="Sales" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[300px] text-gray-400">No hourly data available</div>
              )}
            </div>

            {/* Payment Methods */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Payment Methods</h3>
              {paymentMethodData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={paymentMethodData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percentage }) => `${name} ${percentage}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {paymentMethodData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[300px] text-gray-400">No payment data available</div>
              )}
            </div>
          </div>

          {/* Detailed Metrics */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Detailed Metrics</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <h4 className="font-medium text-gray-700 mb-2">Top Selling Items</h4>
                <div className="space-y-2">
                  {topSellingItems.length > 0 ? topSellingItems.map((item, idx) => (
                    <div key={idx} className="flex justify-between">
                      <span className="text-sm text-gray-600">{item.name || item.itemName || `Item ${idx + 1}`}</span>
                      <span className="text-sm font-medium">{formatCurrency(item.revenue || item.sales || 0)}</span>
                    </div>
                  )) : (
                    <p className="text-sm text-gray-400">No data available</p>
                  )}
                </div>
              </div>
              
              <div>
                <h4 className="font-medium text-gray-700 mb-2">Sales by Period</h4>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Total Revenue</span>
                    <span className="text-sm font-medium">{formatCurrency(salesSummary.totalSales)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Total Tax</span>
                    <span className="text-sm font-medium">{formatCurrency(salesSummary.totalTax)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Net (After Refunds)</span>
                    <span className="text-sm font-medium text-green-600">{formatCurrency(salesSummary.totalSales - refundSummary.totalAmount)}</span>
                  </div>
                </div>
              </div>
              
              <div>
                <h4 className="font-medium text-gray-700 mb-2">Order Statistics</h4>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Total Orders</span>
                    <span className="text-sm font-medium">{salesSummary.totalOrders}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Average Check</span>
                    <span className="text-sm font-medium">{formatCurrency(salesSummary.avgTicket)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Refund Rate</span>
                    <span className="text-sm font-medium text-red-600">
                      {salesSummary.totalOrders > 0 
                        ? ((refundSummary.totalRefunds / salesSummary.totalOrders) * 100).toFixed(1) 
                        : '0'}%
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

export default SalesReportPage;
