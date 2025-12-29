import React from 'react';

const EmployeeReportPage = () => {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Employee Report</h1>
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Employee Reports</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="p-4 bg-blue-50 rounded-lg">
            <h3 className="text-lg font-medium text-blue-700 mb-2">Work Hours Report</h3>
            <p className="text-sm text-blue-600 mb-3">Monthly/Weekly work time statistics</p>
            <button className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600">
              View
            </button>
          </div>
          <div className="p-4 bg-green-50 rounded-lg">
            <h3 className="text-lg font-medium text-green-700 mb-2">Attendance Report</h3>
            <p className="text-sm text-green-600 mb-3">Clock in/out time records</p>
            <button className="px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600">
              View
            </button>
          </div>
          <div className="p-4 bg-purple-50 rounded-lg">
            <h3 className="text-lg font-medium text-purple-700 mb-2">Leave Usage Report</h3>
            <p className="text-sm text-purple-600 mb-3">Annual leave and vacation usage</p>
            <button className="px-3 py-1 bg-purple-500 text-white rounded text-sm hover:bg-purple-600">
              View
            </button>
          </div>
          <div className="p-4 bg-orange-50 rounded-lg">
            <h3 className="text-lg font-medium text-orange-700 mb-2">Performance Report</h3>
            <p className="text-sm text-orange-600 mb-3">Employee performance and evaluation</p>
            <button className="px-3 py-1 bg-orange-500 text-white rounded text-sm hover:bg-orange-600">
              View
            </button>
          </div>
          <div className="p-4 bg-red-50 rounded-lg">
            <h3 className="text-lg font-medium text-red-700 mb-2">Turnover Report</h3>
            <p className="text-sm text-red-600 mb-3">Employee turnover analysis</p>
            <button className="px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600">
              View
            </button>
          </div>
          <div className="p-4 bg-indigo-50 rounded-lg">
            <h3 className="text-lg font-medium text-indigo-700 mb-2">Payroll Report</h3>
            <p className="text-sm text-indigo-600 mb-3">Payroll payment history</p>
            <button className="px-3 py-1 bg-indigo-500 text-white rounded text-sm hover:bg-indigo-600">
              View
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmployeeReportPage; 