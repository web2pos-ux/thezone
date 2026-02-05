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

const InventoryReportPage = () => {
  const [selectedCategory, setSelectedCategory] = useState('all');

  // 이 기능은 현재 개발 중입니다
  const isFeatureDisabled = true;

  // 샘플 데이터
  const inventoryData = [
    { name: 'Beef', current: 150, min: 50, max: 200, cost: 12.50 },
    { name: 'Chicken', current: 200, min: 75, max: 250, cost: 8.75 },
    { name: 'Cheese', current: 80, min: 30, max: 120, cost: 6.25 },
    { name: 'Tomatoes', current: 120, min: 40, max: 150, cost: 3.50 },
    { name: 'Lettuce', current: 90, min: 35, max: 110, cost: 2.75 },
    { name: 'Onions', current: 60, min: 25, max: 80, cost: 1.50 },
    { name: 'Bread', current: 100, min: 40, max: 130, cost: 4.25 },
    { name: 'Potatoes', current: 180, min: 60, max: 220, cost: 2.00 },
  ];

  const stockLevelData = [
    { name: 'In Stock', value: 65, fill: '#00C49F' },
    { name: 'Low Stock', value: 20, fill: '#FFBB28' },
    { name: 'Out of Stock', value: 15, fill: '#FF8042' },
  ];

  const categoryData = [
    { name: 'Proteins', value: 35, fill: '#8884d8' },
    { name: 'Vegetables', value: 25, fill: '#82ca9d' },
    { name: 'Dairy', value: 20, fill: '#ffc658' },
    { name: 'Grains', value: 15, fill: '#ff7300' },
    { name: 'Condiments', value: 5, fill: '#00C49F' },
  ];

  const reorderTrendData = [
    { month: 'Jan', orders: 45, cost: 1250 },
    { month: 'Feb', orders: 52, cost: 1380 },
    { month: 'Mar', orders: 48, cost: 1320 },
    { month: 'Apr', orders: 61, cost: 1650 },
    { month: 'May', orders: 55, cost: 1480 },
    { month: 'Jun', orders: 58, cost: 1520 },
  ];

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">Inventory Report</h1>
        <p className="text-gray-600">Comprehensive inventory management and stock analysis</p>
      </div>

      {/* 개발 중 안내 배너 */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
        <div className="flex items-center">
          <span className="text-2xl mr-3">🚧</span>
          <div>
            <h3 className="font-semibold text-yellow-800">Coming Soon - Sample Data Displayed</h3>
            <p className="text-sm text-yellow-600">This feature is currently under development. The data shown below is sample data for preview purposes only.</p>
          </div>
        </div>
      </div>

      {/* Category Filter */}
      <div className="mb-6">
        <div className="flex space-x-2">
          {['all', 'proteins', 'vegetables', 'dairy', 'grains', 'condiments'].map((category) => (
            <button
              key={category}
              disabled={isFeatureDisabled}
              onClick={() => !isFeatureDisabled && setSelectedCategory(category)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors cursor-not-allowed ${
                selectedCategory === category
                  ? 'bg-gray-400 text-white'
                  : 'bg-gray-200 text-gray-500'
              }`}
            >
              {category.charAt(0).toUpperCase() + category.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-green-100">
              <span className="text-2xl">📦</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Total Items</p>
              <p className="text-2xl font-bold text-gray-900">1,240</p>
              <p className="text-sm text-green-600">+5.2% vs last month</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-yellow-100">
              <span className="text-2xl">⚠️</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Low Stock Items</p>
              <p className="text-2xl font-bold text-gray-900">23</p>
              <p className="text-sm text-yellow-600">Needs attention</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-red-100">
              <span className="text-2xl">❌</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Out of Stock</p>
              <p className="text-2xl font-bold text-gray-900">8</p>
              <p className="text-sm text-red-600">Urgent reorder needed</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-blue-100">
              <span className="text-2xl">💰</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Inventory Value</p>
              <p className="text-2xl font-bold text-gray-900">$15,680</p>
              <p className="text-sm text-blue-600">+3.8% vs last month</p>
            </div>
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Stock Levels */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Stock Level Distribution</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={stockLevelData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent = 0 }) => `${name} ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {stockLevelData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Category Distribution */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Inventory by Category</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={categoryData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent = 0 }) => `${name} ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {categoryData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Inventory Table */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-8">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Current Inventory Levels</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Item
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Current Stock
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Min Level
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Max Level
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Unit Cost
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {inventoryData.map((item, index) => {
                const stockPercentage = (item.current / item.max) * 100;
                let statusColor = 'bg-green-100 text-green-800';
                let statusText = 'In Stock';
                
                if (item.current <= item.min) {
                  statusColor = 'bg-red-100 text-red-800';
                  statusText = 'Low Stock';
                } else if (stockPercentage < 30) {
                  statusColor = 'bg-yellow-100 text-yellow-800';
                  statusText = 'Warning';
                }

                return (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {item.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {item.current}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {item.min}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {item.max}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      ${item.cost}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${statusColor}`}>
                        {statusText}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reorder Trends */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Reorder Trends</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={reorderTrendData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis yAxisId="left" />
            <YAxis yAxisId="right" orientation="right" />
            <Tooltip />
            <Legend />
            <Line yAxisId="left" type="monotone" dataKey="orders" stroke="#8884d8" strokeWidth={2} />
            <Line yAxisId="right" type="monotone" dataKey="cost" stroke="#82ca9d" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default InventoryReportPage; 