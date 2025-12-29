import React from 'react';

const PayrollSettingPage = () => {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Pay Roll Setting</h1>
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Payroll Settings</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-gray-700">Basic Pay Settings</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Base Hourly Rate</label>
                <input type="number" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="10,000" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Overtime Hourly Rate</label>
                <input type="number" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="15,000" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Night Shift Allowance</label>
                <input type="number" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="2,000" />
              </div>
            </div>
          </div>
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-gray-700">Deduction Settings</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">National Pension (%)</label>
                <input type="number" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="4.5" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Health Insurance (%)</label>
                <input type="number" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="3.545" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Employment Insurance (%)</label>
                <input type="number" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="0.8" />
              </div>
            </div>
          </div>
        </div>
        <div className="mt-6 pt-6 border-t border-gray-200">
          <h3 className="text-lg font-medium text-gray-700 mb-3">Payroll Payment Settings</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payment Date</label>
              <select className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option>25th of each month</option>
                <option>Last day of each month</option>
                <option>15th of each month</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payroll Period</label>
              <select className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option>1st ~ Last day</option>
                <option>16th ~ Next month 15th</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PayrollSettingPage; 