import React from 'react';

const ScreenSizePage = () => {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Screen Size</h1>
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Display Settings</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h3 className="text-lg font-medium text-gray-700 mb-3">Screen Configuration</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Screen Resolution</label>
                <select className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option>1920x1080 (Full HD)</option>
                  <option>1366x768 (HD)</option>
                  <option>2560x1440 (2K)</option>
                  <option>3840x2160 (4K)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Display Orientation</label>
                <select className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option>Landscape</option>
                  <option>Portrait</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Screen Size (inches)</label>
                <input type="number" className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="24" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Refresh Rate (Hz)</label>
                <select className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option>60 Hz</option>
                  <option>75 Hz</option>
                  <option>120 Hz</option>
                  <option>144 Hz</option>
                </select>
              </div>
            </div>
          </div>
          <div>
            <h3 className="text-lg font-medium text-gray-700 mb-3">Preview</h3>
            <div className="bg-gray-100 rounded-lg p-4 min-h-[300px] flex items-center justify-center">
              <div className="text-center">
                <div className="text-gray-500 mb-2">🖥️</div>
                <p className="text-gray-600">Screen preview will be displayed here</p>
                <p className="text-sm text-gray-500 mt-2">Current: 1920x1080 Landscape</p>
              </div>
            </div>
            <div className="mt-4">
              <button className="w-full px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
                Apply Settings
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScreenSizePage; 