import React from 'react';

const AccessPermissionsPage = () => {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Access & Permissions</h1>
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Access Permission Management</h2>
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-medium text-gray-700 mb-3">System Permissions</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="flex items-center space-x-3">
                <input type="checkbox" className="rounded border-gray-300 text-green-600 focus:ring-green-500" />
                <span className="text-sm text-gray-700">Menu Management</span>
              </label>
              <label className="flex items-center space-x-3">
                <input type="checkbox" className="rounded border-gray-300 text-green-600 focus:ring-green-500" />
                <span className="text-sm text-gray-700">Order Management</span>
              </label>
              <label className="flex items-center space-x-3">
                <input type="checkbox" className="rounded border-gray-300 text-green-600 focus:ring-green-500" />
                <span className="text-sm text-gray-700">Employee Management</span>
              </label>
              <label className="flex items-center space-x-3">
                <input type="checkbox" className="rounded border-gray-300 text-green-600 focus:ring-green-500" />
                <span className="text-sm text-gray-700">Report Access</span>
              </label>
            </div>
          </div>
          <div>
            <h3 className="text-lg font-medium text-gray-700 mb-3">POS Permissions</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="flex items-center space-x-3">
                <input type="checkbox" className="rounded border-gray-300 text-green-600 focus:ring-green-500" />
                <span className="text-sm text-gray-700">Create Orders</span>
              </label>
              <label className="flex items-center space-x-3">
                <input type="checkbox" className="rounded border-gray-300 text-green-600 focus:ring-green-500" />
                <span className="text-sm text-gray-700">Process Payments</span>
              </label>
              <label className="flex items-center space-x-3">
                <input type="checkbox" className="rounded border-gray-300 text-green-600 focus:ring-green-500" />
                <span className="text-sm text-gray-700">Process Refunds</span>
              </label>
              <label className="flex items-center space-x-3">
                <input type="checkbox" className="rounded border-gray-300 text-green-600 focus:ring-green-500" />
                <span className="text-sm text-gray-700">Apply Discounts</span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AccessPermissionsPage; 