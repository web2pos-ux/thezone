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

const EmployeePerformancePage = () => {
  const [selectedPeriod, setSelectedPeriod] = useState('month');

  // 샘플 데이터
  const employeePerformanceData = [
    { name: 'John Smith', sales: 8500, orders: 95, avgTicket: 89.5, rating: 4.8 },
    { name: 'Sarah Johnson', sales: 7200, orders: 88, avgTicket: 81.8, rating: 4.6 },
    { name: 'Mike Davis', sales: 6800, orders: 82, avgTicket: 82.9, rating: 4.7 },
    { name: 'Lisa Wilson', sales: 6100, orders: 75, avgTicket: 81.3, rating: 4.5 },
    { name: 'David Brown', sales: 5900, orders: 72, avgTicket: 81.9, rating: 4.4 },
    { name: 'Emma Taylor', sales: 5400, orders: 68, avgTicket: 79.4, rating: 4.3 },
  ];

  const performanceTrendData = [
    { month: 'Jan', avgSales: 7200, avgOrders: 85, satisfaction: 4.6 },
    { month: 'Feb', avgSales: 7500, avgOrders: 88, satisfaction: 4.7 },
    { month: 'Mar', avgSales: 7800, avgOrders: 92, satisfaction: 4.8 },
    { month: 'Apr', avgSales: 8100, avgOrders: 95, satisfaction: 4.9 },
    { month: 'May', avgSales: 8400, avgOrders: 98, satisfaction: 4.8 },
    { month: 'Jun', avgSales: 8700, avgOrders: 102, satisfaction: 4.9 },
  ];

  const shiftPerformanceData = [
    { shift: 'Morning', avgSales: 4200, employees: 4, efficiency: 85 },
    { shift: 'Afternoon', avgSales: 5800, employees: 6, efficiency: 92 },
    { shift: 'Evening', avgSales: 7200, employees: 8, efficiency: 88 },
    { shift: 'Night', avgSales: 3200, employees: 3, efficiency: 78 },
  ];

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">Employee Performance</h1>
        <p className="text-gray-600">Employee performance analysis and productivity metrics</p>
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
              <p className="text-sm font-medium text-gray-600">Total Sales</p>
              <p className="text-2xl font-bold text-gray-900">$39,900</p>
              <p className="text-sm text-green-600">+8.5% vs last period</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-blue-100">
              <span className="text-2xl">📦</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Total Orders</p>
              <p className="text-2xl font-bold text-gray-900">480</p>
              <p className="text-sm text-blue-600">+6.2% vs last period</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-purple-100">
              <span className="text-2xl">⭐</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Avg. Rating</p>
              <p className="text-2xl font-bold text-gray-900">4.7</p>
              <p className="text-sm text-purple-600">+0.2 vs last period</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-orange-100">
              <span className="text-2xl">⚡</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Efficiency</p>
              <p className="text-2xl font-bold text-gray-900">87%</p>
              <p className="text-sm text-orange-600">+3.1% vs last period</p>
            </div>
          </div>
        </div>
      </div>

      {/* Employee Performance Table */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-8">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Employee Performance Ranking</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Employee
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Sales
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Orders
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Avg. Ticket
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Rating
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Performance
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {employeePerformanceData.map((employee, index) => {
                const performancePercentage = (employee.sales / 8500) * 100;
                let performanceColor = 'bg-green-100 text-green-800';
                let performanceText = 'Excellent';
                
                if (performancePercentage < 70) {
                  performanceColor = 'bg-red-100 text-red-800';
                  performanceText = 'Needs Improvement';
                } else if (performancePercentage < 85) {
                  performanceColor = 'bg-yellow-100 text-yellow-800';
                  performanceText = 'Good';
                }

                return (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10">
                          <div className="h-10 w-10 rounded-full bg-gray-300 flex items-center justify-center">
                            <span className="text-sm font-medium text-gray-700">
                              {employee.name.split(' ').map(n => n[0]).join('')}
                            </span>
                          </div>
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">{employee.name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      ${employee.sales.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {employee.orders}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      ${employee.avgTicket}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {employee.rating}/5.0
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
        {/* Performance Trend */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Performance Trends</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={performanceTrendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis yAxisId="left" />
              <YAxis yAxisId="right" orientation="right" />
              <Tooltip />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="avgSales" stroke="#8884d8" strokeWidth={2} />
              <Line yAxisId="right" type="monotone" dataKey="satisfaction" stroke="#82ca9d" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Shift Performance */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Shift Performance</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={shiftPerformanceData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="shift" />
              <YAxis yAxisId="left" />
              <YAxis yAxisId="right" orientation="right" />
              <Tooltip />
              <Legend />
              <Bar yAxisId="left" dataKey="avgSales" fill="#8884d8" />
              <Bar yAxisId="right" dataKey="efficiency" fill="#82ca9d" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Performance Insights */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Performance Insights</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <h4 className="font-medium text-gray-700 mb-2">Top Performers</h4>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">John Smith</span>
                <span className="text-sm font-medium">$8,500</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Sarah Johnson</span>
                <span className="text-sm font-medium">$7,200</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Mike Davis</span>
                <span className="text-sm font-medium">$6,800</span>
              </div>
            </div>
          </div>
          
          <div>
            <h4 className="font-medium text-gray-700 mb-2">Training Needs</h4>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Customer Service</span>
                <span className="text-sm font-medium">3 employees</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Sales Techniques</span>
                <span className="text-sm font-medium">2 employees</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Product Knowledge</span>
                <span className="text-sm font-medium">1 employee</span>
              </div>
            </div>
          </div>
          
          <div>
            <h4 className="font-medium text-gray-700 mb-2">Recognition</h4>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Employee of Month</span>
                <span className="text-sm font-medium">John Smith</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Most Improved</span>
                <span className="text-sm font-medium">Emma Taylor</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Team Player</span>
                <span className="text-sm font-medium">Sarah Johnson</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmployeePerformancePage; 