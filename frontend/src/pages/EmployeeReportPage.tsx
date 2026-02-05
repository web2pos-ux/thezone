import React from 'react';

const EmployeeReportPage = () => {
  // 이 기능은 현재 개발 중입니다
  const isFeatureDisabled = true;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Employee Report</h1>
      
      {/* 개발 중 안내 배너 */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
        <div className="flex items-center">
          <span className="text-2xl mr-3">🚧</span>
          <div>
            <h3 className="font-semibold text-yellow-800">Coming Soon</h3>
            <p className="text-sm text-yellow-600">This feature is currently under development.</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Employee Reports</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="p-4 bg-blue-50 rounded-lg opacity-60">
            <h3 className="text-lg font-medium text-blue-700 mb-2">Work Hours Report</h3>
            <p className="text-sm text-blue-600 mb-3">Monthly/Weekly work time statistics</p>
            <button 
              disabled={isFeatureDisabled}
              className="px-3 py-1 bg-gray-400 text-white rounded text-sm cursor-not-allowed"
            >
              Coming Soon
            </button>
          </div>
          <div className="p-4 bg-green-50 rounded-lg opacity-60">
            <h3 className="text-lg font-medium text-green-700 mb-2">Attendance Report</h3>
            <p className="text-sm text-green-600 mb-3">Clock in/out time records</p>
            <button 
              disabled={isFeatureDisabled}
              className="px-3 py-1 bg-gray-400 text-white rounded text-sm cursor-not-allowed"
            >
              Coming Soon
            </button>
          </div>
          <div className="p-4 bg-purple-50 rounded-lg opacity-60">
            <h3 className="text-lg font-medium text-purple-700 mb-2">Leave Usage Report</h3>
            <p className="text-sm text-purple-600 mb-3">Annual leave and vacation usage</p>
            <button 
              disabled={isFeatureDisabled}
              className="px-3 py-1 bg-gray-400 text-white rounded text-sm cursor-not-allowed"
            >
              Coming Soon
            </button>
          </div>
          <div className="p-4 bg-orange-50 rounded-lg opacity-60">
            <h3 className="text-lg font-medium text-orange-700 mb-2">Performance Report</h3>
            <p className="text-sm text-orange-600 mb-3">Employee performance and evaluation</p>
            <button 
              disabled={isFeatureDisabled}
              className="px-3 py-1 bg-gray-400 text-white rounded text-sm cursor-not-allowed"
            >
              Coming Soon
            </button>
          </div>
          <div className="p-4 bg-red-50 rounded-lg opacity-60">
            <h3 className="text-lg font-medium text-red-700 mb-2">Turnover Report</h3>
            <p className="text-sm text-red-600 mb-3">Employee turnover analysis</p>
            <button 
              disabled={isFeatureDisabled}
              className="px-3 py-1 bg-gray-400 text-white rounded text-sm cursor-not-allowed"
            >
              Coming Soon
            </button>
          </div>
          <div className="p-4 bg-indigo-50 rounded-lg opacity-60">
            <h3 className="text-lg font-medium text-indigo-700 mb-2">Payroll Report</h3>
            <p className="text-sm text-indigo-600 mb-3">Payroll payment history</p>
            <button 
              disabled={isFeatureDisabled}
              className="px-3 py-1 bg-gray-400 text-white rounded text-sm cursor-not-allowed"
            >
              Coming Soon
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmployeeReportPage; 