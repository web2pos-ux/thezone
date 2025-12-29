import React, { useState } from 'react';
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

const MenuAnalysisPage = () => {
  const [selectedPeriod, setSelectedPeriod] = useState('month');

  // 샘플 데이터
  const topSellingItemsData = [
    { name: 'Classic Burger', sales: 2450, orders: 98, profit: 1225, margin: 50 },
    { name: 'Margherita Pizza', sales: 1890, orders: 76, profit: 945, margin: 50 },
    { name: 'Caesar Salad', sales: 1230, orders: 82, profit: 738, margin: 60 },
    { name: 'Chicken Wings', sales: 1150, orders: 58, profit: 690, margin: 60 },
    { name: 'Pasta Carbonara', sales: 980, orders: 49, profit: 588, margin: 60 },
    { name: 'Fish & Chips', sales: 890, orders: 45, profit: 534, margin: 60 },
  ];

  const categoryPerformanceData = [
    { category: 'Burgers', sales: 3500, orders: 140, avgPrice: 25.0, margin: 55 },
    { category: 'Pizza', sales: 2800, orders: 112, avgPrice: 25.0, margin: 50 },
    { category: 'Salads', sales: 1800, orders: 120, avgPrice: 15.0, margin: 65 },
    { category: 'Appetizers', sales: 1600, orders: 80, avgPrice: 20.0, margin: 60 },
    { category: 'Pasta', sales: 1400, orders: 70, avgPrice: 20.0, margin: 60 },
    { category: 'Desserts', sales: 800, orders: 40, avgPrice: 20.0, margin: 70 },
  ];

  const menuTrendData = [
    { month: 'Jan', totalSales: 12500, avgTicket: 18.5, itemsSold: 675 },
    { month: 'Feb', totalSales: 13200, avgTicket: 19.2, itemsSold: 688 },
    { month: 'Mar', totalSales: 14100, avgTicket: 19.8, itemsSold: 712 },
    { month: 'Apr', totalSales: 14800, avgTicket: 20.1, itemsSold: 736 },
    { month: 'May', totalSales: 15600, avgTicket: 20.5, itemsSold: 761 },
    { month: 'Jun', totalSales: 16200, avgTicket: 21.0, itemsSold: 771 },
  ];

  const profitMarginData = [
    { name: 'High Margin (>60%)', value: 25, fill: '#00C49F' },
    { name: 'Medium Margin (40-60%)', value: 45, fill: '#FFBB28' },
    { name: 'Low Margin (<40%)', value: 30, fill: '#FF8042' },
  ];

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">Menu Analysis</h1>
        <p className="text-gray-600">Menu performance analysis and optimization insights</p>
      </div>

      {/* Period Selector */}
      <div className="mb-6">
        <div className="flex space-x-2">
          {['week', 'month', 'quarter', 'year'].map((period) => (
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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-green-100">
              <span className="text-2xl">💰</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Total Menu Sales</p>
              <p className="text-2xl font-bold text-gray-900">$16,200</p>
              <p className="text-sm text-green-600">+8.5% vs last period</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-blue-100">
              <span className="text-2xl">🍽️</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Items Sold</p>
              <p className="text-2xl font-bold text-gray-900">771</p>
              <p className="text-sm text-blue-600">+6.2% vs last period</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-purple-100">
              <span className="text-2xl">📊</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Avg. Ticket</p>
              <p className="text-2xl font-bold text-gray-900">$21.00</p>
              <p className="text-sm text-purple-600">+2.4% vs last period</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-orange-100">
              <span className="text-2xl">📈</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Profit Margin</p>
              <p className="text-2xl font-bold text-gray-900">58%</p>
              <p className="text-sm text-orange-600">+1.2% vs last period</p>
            </div>
          </div>
        </div>
      </div>

      {/* Top Selling Items Table */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-8">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Top Selling Items</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Item
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Sales
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Orders
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Profit
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Margin
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Performance
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {topSellingItemsData.map((item, index) => {
                let performanceColor = 'bg-green-100 text-green-800';
                let performanceText = 'Excellent';
                
                if (item.margin < 45) {
                  performanceColor = 'bg-red-100 text-red-800';
                  performanceText = 'Low Margin';
                } else if (item.margin < 55) {
                  performanceColor = 'bg-yellow-100 text-yellow-800';
                  performanceText = 'Good';
                }

                return (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {item.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      ${item.sales.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {item.orders}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      ${item.profit.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {item.margin}%
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${performanceColor}`}>
                        {performanceText}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Menu Trends */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Menu Performance Trends</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={menuTrendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis yAxisId="left" />
              <YAxis yAxisId="right" orientation="right" />
              <Tooltip />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="totalSales" stroke="#8884d8" strokeWidth={2} />
              <Line yAxisId="right" type="monotone" dataKey="avgTicket" stroke="#82ca9d" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Profit Margin Distribution */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Profit Margin Distribution</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={profitMarginData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent = 0 }) => `${name} ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {profitMarginData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Category Performance */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-8">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Category Performance</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={categoryPerformanceData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="category" />
            <YAxis yAxisId="left" />
            <YAxis yAxisId="right" orientation="right" />
            <Tooltip />
            <Legend />
            <Bar yAxisId="left" dataKey="sales" fill="#8884d8" />
            <Bar yAxisId="right" dataKey="margin" fill="#82ca9d" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Menu Insights */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Menu Insights</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <h4 className="font-medium text-gray-700 mb-2">Best Performers</h4>
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
            <h4 className="font-medium text-gray-700 mb-2">Optimization Opportunities</h4>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Low Margin Items</span>
                <span className="text-sm font-medium">5 items</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Slow Moving Items</span>
                <span className="text-sm font-medium">3 items</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">High Cost Items</span>
                <span className="text-sm font-medium">2 items</span>
              </div>
            </div>
          </div>
          
          <div>
            <h4 className="font-medium text-gray-700 mb-2">Recommendations</h4>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Price Optimization</span>
                <span className="text-sm font-medium">3 items</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Menu Additions</span>
                <span className="text-sm font-medium">2 items</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Promotions</span>
                <span className="text-sm font-medium">4 items</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export {}; 