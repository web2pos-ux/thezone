import React, { useState, useEffect } from 'react';
import { RefreshCw, Check, X, Clock, Calendar } from 'lucide-react';

interface ShiftSwapRequest {
  id: string;
  firstEmployeeId: string;
  firstEmployeeName: string;
  firstScheduleDate: string;
  firstScheduleStart: string;
  firstScheduleEnd: string;
  secondEmployeeId: string;
  secondEmployeeName: string;
  secondScheduleDate: string;
  secondScheduleStart: string;
  secondScheduleEnd: string;
  requestDate: string;
  status: 'pending' | 'approved' | 'rejected';
  createdBy: string;
  approver?: string;
  approvalDate?: string;
  reason?: string;
}

interface Schedule {
  employeeId: string;
  date: string;
  scheduledStart: string;
  scheduledEnd: string;
  workedStart?: string;
  workedEnd?: string;
  swappedWith?: string;
  swappedEmployeeName?: string;
}

type FilterStatus = 'all' | 'pending' | 'approved' | 'rejected';

const ShiftSwapsPage = () => {
  const [shiftSwapRequests, setShiftSwapRequests] = useState<ShiftSwapRequest[]>([]);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');

  // Load shift swap requests from backend API
  useEffect(() => {
    loadShiftSwapRequests();
  }, []);

  const loadShiftSwapRequests = async () => {
    try {
      const response = await fetch('http://localhost:3177/api/work-schedule/shift-swaps');
      if (!response.ok) throw new Error('Failed to load shift swap requests');
      const data = await response.json();
      
      // Transform backend data to frontend format
      const transformedRequests: ShiftSwapRequest[] = data.map((req: any) => ({
        id: req.id,
        firstEmployeeId: req.employee1_id,
        firstEmployeeName: req.employee1_name,
        firstScheduleDate: req.employee1_date,
        firstScheduleStart: req.employee1_time || '00:00',
        firstScheduleEnd: req.employee1_time || '00:00',
        secondEmployeeId: req.employee2_id,
        secondEmployeeName: req.employee2_name,
        secondScheduleDate: req.employee2_date,
        secondScheduleStart: req.employee2_time || '00:00',
        secondScheduleEnd: req.employee2_time || '00:00',
        requestDate: req.requested_date,
        status: req.status,
        createdBy: req.employee1_name,
        approver: req.approver,
        approvalDate: req.approved_date,
        reason: req.notes
      }));
      
      setShiftSwapRequests(transformedRequests);
    } catch (error) {
      console.error('Error loading shift swap requests:', error);
      alert('Failed to load shift swap requests. Check console for details.');
    }
  };

  // Filter requests by status
  const filteredRequests = shiftSwapRequests.filter(request => {
    if (filterStatus === 'all') return true;
    return request.status === filterStatus;
  });

  // Sort by request date (newest first)
  const sortedRequests = [...filteredRequests].sort((a, b) => {
    return new Date(b.requestDate).getTime() - new Date(a.requestDate).getTime();
  });

  // Approve request
  const approveRequest = async (requestId: string) => {
    const request = shiftSwapRequests.find(r => r.id === requestId);
    if (!request) return;

    try {
      // Update the request status in backend
      const response = await fetch(`http://localhost:3177/api/work-schedule/shift-swaps/${requestId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'approved',
          approver: 'Admin',
          approvedDate: new Date().toISOString()
        })
      });

      if (!response.ok) throw new Error('Failed to approve shift swap');

      // Reload requests
      await loadShiftSwapRequests();
      alert('Shift swap request approved!');
    } catch (error) {
      console.error('Error approving shift swap:', error);
      alert('Failed to approve shift swap. Check console for details.');
    }
  };

  // Reject request
  const rejectRequest = async (requestId: string) => {
    try {
      const response = await fetch(`http://localhost:3177/api/work-schedule/shift-swaps/${requestId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'rejected',
          approver: 'Admin',
          approvedDate: new Date().toISOString()
        })
      });

      if (!response.ok) throw new Error('Failed to reject shift swap');

      // Reload requests
      await loadShiftSwapRequests();
      alert('Shift swap request rejected!');
    } catch (error) {
      console.error('Error rejecting shift swap:', error);
      alert('Failed to reject shift swap. Check console for details.');
    }
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'approved':
        return 'bg-green-100 text-green-800';
      case 'rejected':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Shift Swap Requests</h2>
            <p className="text-sm text-gray-600 mt-1">
              Review and manage shift swap requests
            </p>
          </div>
          <div className="flex items-center gap-2">
            <RefreshCw className="text-orange-600" size={24} />
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 mb-6 border-b border-gray-200">
          <button
            onClick={() => setFilterStatus('all')}
            className={`px-4 py-2 font-medium transition-colors border-b-2 ${
              filterStatus === 'all'
                ? 'border-orange-500 text-orange-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            All ({shiftSwapRequests.length})
          </button>
          <button
            onClick={() => setFilterStatus('pending')}
            className={`px-4 py-2 font-medium transition-colors border-b-2 ${
              filterStatus === 'pending'
                ? 'border-yellow-500 text-yellow-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Pending ({shiftSwapRequests.filter(r => r.status === 'pending').length})
          </button>
          <button
            onClick={() => setFilterStatus('approved')}
            className={`px-4 py-2 font-medium transition-colors border-b-2 ${
              filterStatus === 'approved'
                ? 'border-green-500 text-green-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Approved ({shiftSwapRequests.filter(r => r.status === 'approved').length})
          </button>
          <button
            onClick={() => setFilterStatus('rejected')}
            className={`px-4 py-2 font-medium transition-colors border-b-2 ${
              filterStatus === 'rejected'
                ? 'border-red-500 text-red-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Rejected ({shiftSwapRequests.filter(r => r.status === 'rejected').length})
          </button>
        </div>

        {/* Requests List */}
        <div className="space-y-4">
          {sortedRequests.length === 0 ? (
            <div className="text-center py-12">
              <RefreshCw className="mx-auto text-gray-400 mb-3" size={48} />
              <p className="text-gray-600 text-lg font-medium">No shift swap requests</p>
              <p className="text-gray-500 text-sm mt-1">
                {filterStatus === 'all' 
                  ? 'Create shift swaps from the Work Schedule page'
                  : `No ${filterStatus} requests`}
              </p>
            </div>
          ) : (
            sortedRequests.map(request => (
              <div
                key={request.id}
                className="border border-gray-200 rounded-lg p-5 hover:shadow-md transition-all"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusBadgeClass(request.status)}`}>
                      {request.status.toUpperCase()}
                    </span>
                    <div className="text-xs text-gray-500 flex items-center gap-1">
                      <Clock size={14} />
                      {formatDateTime(request.requestDate)}
                    </div>
                  </div>
                  <div className="text-xs text-gray-600">
                    Created by: <span className="font-semibold">{request.createdBy}</span>
                  </div>
                </div>

                {/* Swap Details */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
                  {/* Employee 1 */}
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="text-xs text-blue-800 font-semibold mb-2">Employee 1</div>
                    <div className="font-bold text-gray-900 text-lg mb-1">{request.firstEmployeeName}</div>
                    <div className="flex items-center gap-2 text-sm text-gray-700 mb-1">
                      <Calendar size={14} />
                      {formatDate(request.firstScheduleDate)}
                    </div>
                    <div className="text-sm font-medium text-gray-900">
                      {request.firstScheduleStart} ~ {request.firstScheduleEnd}
                    </div>
                  </div>

                  {/* Swap Arrow */}
                  <div className="flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-orange-500">
                      <path d="M17 2.1l4 4-4 4"/>
                      <path d="M3 12.2l4 4 4-4"/>
                      <path d="M21 6.1h-14"/>
                      <path d="M7 16.2h14"/>
                    </svg>
                  </div>

                  {/* Employee 2 */}
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="text-xs text-green-800 font-semibold mb-2">Employee 2</div>
                    <div className="font-bold text-gray-900 text-lg mb-1">{request.secondEmployeeName}</div>
                    <div className="flex items-center gap-2 text-sm text-gray-700 mb-1">
                      <Calendar size={14} />
                      {formatDate(request.secondScheduleDate)}
                    </div>
                    <div className="text-sm font-medium text-gray-900">
                      {request.secondScheduleStart} ~ {request.secondScheduleEnd}
                    </div>
                  </div>
                </div>

                {/* Approval Info or Action Buttons */}
                {request.status === 'pending' ? (
                  <div className="flex items-center justify-between pt-3 border-t border-gray-200">
                    <div className="text-sm text-gray-600">
                      <span className="font-semibold text-yellow-700">⏳ Awaiting approval</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => approveRequest(request.id)}
                        className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-medium text-sm"
                      >
                        <Check size={16} />
                        Approve
                      </button>
                      <button
                        onClick={() => rejectRequest(request.id)}
                        className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors font-medium text-sm"
                      >
                        <X size={16} />
                        Reject
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="pt-3 border-t border-gray-200 text-sm text-gray-600">
                    <span className="font-semibold">
                      {request.status === 'approved' ? '✅ Approved' : '❌ Rejected'}
                    </span>
                    {' by '}
                    <span className="font-semibold">{request.approver}</span>
                    {' on '}
                    <span>{request.approvalDate ? formatDateTime(request.approvalDate) : 'N/A'}</span>
                  </div>
                )}

                {request.reason && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <div className="text-xs text-gray-600 font-semibold mb-1">Reason:</div>
                    <div className="text-sm text-gray-700">{request.reason}</div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default ShiftSwapsPage;
