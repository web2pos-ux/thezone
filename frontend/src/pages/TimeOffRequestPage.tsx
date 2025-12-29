import React, { useState } from 'react';
import { BarChart3 } from 'lucide-react';
import RequestResultsModal from '../components/RequestResultsModal';

const TimeOffRequestPage = () => {
  const [showResultsModal, setShowResultsModal] = useState(false);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Time off Request</h1>
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Time Off Requests</h2>
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-medium text-gray-700">Request History</h3>
            <button className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
              New Request
            </button>
          </div>
          <div className="space-y-3">
            {[
              { name: 'John Smith', type: 'Annual Leave', startDate: '2024-01-20', endDate: '2024-01-22', days: 3, status: 'Approved' },
              { name: 'Jane Doe', type: 'Sick Leave', startDate: '2024-01-25', endDate: '2024-01-26', days: 2, status: 'Pending' },
              { name: 'Mike Johnson', type: 'Half Day', startDate: '2024-01-30', endDate: '2024-01-30', days: 0.5, status: 'Rejected' }
            ].map((request, index) => (
              <div key={index} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                <div className="flex items-center space-x-4">
                  <div>
                    <p className="font-medium">{request.name}</p>
                    <p className="text-sm text-gray-500">{request.type}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">{request.startDate} ~ {request.endDate}</p>
                    <p className="text-sm text-gray-500">{request.days} days</p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    request.status === 'Pending' ? 'bg-yellow-100 text-yellow-800' :
                    request.status === 'Approved' ? 'bg-green-100 text-green-800' :
                    'bg-red-100 text-red-800'
                  }`}>
                    {request.status}
                  </span>
                  {request.status === 'Pending' && (
                    <div className="flex space-x-1">
                      <button className="px-2 py-1 bg-green-500 text-white rounded text-xs hover:bg-green-600">Approve</button>
                      <button className="px-2 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600">Reject</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          
          {/* View Results Button - 아래에 배치 */}
          <div className="flex justify-center pt-4">
            <button 
              onClick={() => setShowResultsModal(true)}
              className="flex items-center gap-2 px-6 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors font-medium shadow-md hover:shadow-lg"
            >
              <BarChart3 size={20} />
              View Results
            </button>
          </div>
        </div>
      </div>
      
      {/* Results Modal */}
      {showResultsModal && (
        <RequestResultsModal onClose={() => setShowResultsModal(false)} />
      )}
    </div>
  );
};

export default TimeOffRequestPage; 