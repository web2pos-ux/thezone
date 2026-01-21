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

const CustomerReportPage = () => {
  const [selectedPeriod, setSelectedPeriod] = useState('month');

  // 샘플 데이터
  const customerGrowthData = [
    { month: 'Jan', new: 45, returning: 120, total: 165 },
    { month: 'Feb', new: 52, returning: 135, total: 187 },
    { month: 'Mar', new: 48, returning: 142, total: 190 },
    { month: 'Apr', new: 61, returning: 158, total: 219 },
    { month: 'May', new: 55, returning: 165, total: 220 },
    { month: 'Jun', new: 58, returning: 172, total: 230 },
  ];

  const customerSegmentsData = [
    { name: 'VIP Customers', value: 15, fill: '#FFD700' },
    { name: 'Regular Customers', value: 45, fill: '#4CAF50' },
    { name: 'Occasional Customers', value: 30, fill: '#2196F3' },
    { name: 'New Customers', value: 10, fill: '#9C27B0' },
  ];

  const ageGroupData = [
    { age: '18-25', count: 85, avgSpend: 45 },
    { age: '26-35', count: 120, avgSpend: 65 },
    { age: '36-45', count: 95, avgSpend: 75 },
    { age: '46-55', count: 70, avgSpend: 85 },
    { age: '55+', count: 45, avgSpend: 60 },
  ];

  const visitFrequencyData = [
    { frequency: 'Daily', customers: 25, percentage: 8 },
    { frequency: 'Weekly', customers: 120, percentage: 38 },
    { frequency: 'Monthly', customers: 95, percentage: 30 },
    { frequency: 'Quarterly', customers: 45, percentage: 14 },
    { frequency: 'Yearly', customers: 35, percentage: 10 },
  ];

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">Customer Report</h1>
        <p className="text-gray-600">Customer behavior analysis and insights</p>
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
            <div className="p-3 rounded-full bg-blue-100">
              <span className="text-2xl">👥</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Total Customers</p>
              <p className="text-2xl font-bold text-gray-900">2,450</p>
              <p className="text-sm text-blue-600">+12.5% vs last period</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-green-100">
              <span className="text-2xl">🆕</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">New Customers</p>
              <p className="text-2xl font-bold text-gray-900">185</p>
              <p className="text-sm text-green-600">+8.2% vs last period</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-purple-100">
              <span className="text-2xl">💰</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Avg. Customer Value</p>
              <p className="text-2xl font-bold text-gray-900">$156</p>
              <p className="text-sm text-purple-600">+4.1% vs last period</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-orange-100">
              <span className="text-2xl">🔄</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Retention Rate</p>
              <p className="text-2xl font-bold text-gray-900">78%</p>
              <p className="text-sm text-orange-600">+2.3% vs last period</p>
            </div>
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Customer Growth */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Customer Growth</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={customerGrowthData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="new" stroke="#8884d8" strokeWidth={2} />
              <Line type="monotone" dataKey="returning" stroke="#82ca9d" strokeWidth={2} />
              <Line type="monotone" dataKey="total" stroke="#ffc658" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Customer Segments */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Customer Segments</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={customerSegmentsData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent = 0 }) => `${name} ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {customerSegmentsData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Additional Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Age Distribution */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Age Distribution & Spending</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={ageGroupData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="age" />
              <YAxis yAxisId="left" />
              <YAxis yAxisId="right" orientation="right" />
              <Tooltip />
              <Legend />
              <Bar yAxisId="left" dataKey="count" fill="#8884d8" />
              <Bar yAxisId="right" dataKey="avgSpend" fill="#82ca9d" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Visit Frequency */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Visit Frequency</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={visitFrequencyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="frequency" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="customers" fill="#8884d8" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Customer Insights */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Customer Insights</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <h4 className="font-medium text-gray-700 mb-2">Top Customers</h4>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">John Smith</span>
                <span className="text-sm font-medium">$2,450</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Sarah Johnson</span>
                <span className="text-sm font-medium">$1,890</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Mike Davis</span>
                <span className="text-sm font-medium">$1,230</span>
              </div>
            </div>
          </div>
          
          <div>
            <h4 className="font-medium text-gray-700 mb-2">Customer Satisfaction</h4>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Very Satisfied</span>
                <span className="text-sm font-medium">65%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Satisfied</span>
                <span className="text-sm font-medium">25%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Neutral</span>
                <span className="text-sm font-medium">8%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Dissatisfied</span>
                <span className="text-sm font-medium">2%</span>
              </div>
            </div>
          </div>
          
          <div>
            <h4 className="font-medium text-gray-700 mb-2">Customer Behavior</h4>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Avg. Visit Duration</span>
                <span className="text-sm font-medium">45 min</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Peak Visit Time</span>
                <span className="text-sm font-medium">6-8 PM</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Preferred Payment</span>
                <span className="text-sm font-medium">Credit Card</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CustomerReportPage; 