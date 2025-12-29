import React, { useState, useEffect } from 'react';
import { Calendar, Clock, Plus, Check, X } from 'lucide-react';

interface TimeOffRequest {
  id: string;
  employee_id: string;
  employee_name: string;
  type: string;
  start_date: string;
  end_date: string;
  reason?: string;
  status: 'pending' | 'approved' | 'rejected';
  requested_date: string;
  approved_date?: string;
  approver?: string;
  is_partial?: number;
  partial_start_time?: string;
  partial_end_time?: string;
}

type FilterStatus = 'all' | 'pending' | 'approved' | 'rejected';

const TimeOffRequestsPage = () => {
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([]);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [employees, setEmployees] = useState<Array<{ id: string; name: string }>>([]);
  const [formData, setFormData] = useState({
    employeeId: '',
    employeeName: '',
    type: 'Annual Leave',
    startDate: '',
    endDate: '',
    reason: '',
    isPartial: false,
    partialStartTime: '',
    partialEndTime: ''
  });

  // Load employees
  useEffect(() => {
    loadEmployees();
  }, []);

  // Load time off requests
  useEffect(() => {
    loadTimeOffRequests();
  }, []);

  const loadEmployees = async () => {
    try {
      const response = await fetch('http://localhost:3177/api/work-schedule/employees');
      if (!response.ok) throw new Error('Failed to load employees');
      const data = await response.json();
      setEmployees(data.map((emp: any) => ({ id: emp.id, name: emp.name })));
    } catch (error) {
      console.error('Error loading employees:', error);
    }
  };

  const loadTimeOffRequests = async () => {
    try {
      const response = await fetch('http://localhost:3177/api/work-schedule/time-off');
      if (!response.ok) throw new Error('Failed to load time off requests');
      const data = await response.json();
      setTimeOffRequests(data);
    } catch (error) {
      console.error('Error loading time off requests:', error);
      alert('Failed to load time off requests. Check console for details.');
    }
  };

  const handleAddRequest = async () => {
    try {
      const selectedEmployee = employees.find(emp => emp.id === formData.employeeId);
      if (!selectedEmployee) {
        alert('Please select an employee');
        return;
      }

      const requestData = {
        id: `TO${Date.now()}`,
        employeeId: formData.employeeId,
        employeeName: selectedEmployee.name,
        type: formData.type,
        startDate: formData.startDate,
        endDate: formData.endDate,
        reason: formData.reason,
        status: 'pending',
        requestedDate: new Date().toISOString(),
        isPartial: formData.isPartial,
        partialStartTime: formData.partialStartTime || null,
        partialEndTime: formData.partialEndTime || null
      };

      const response = await fetch('http://localhost:3177/api/work-schedule/time-off', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData)
      });

      if (!response.ok) throw new Error('Failed to create time off request');

      await loadTimeOffRequests();
      setShowAddModal(false);
      resetForm();
      alert('Time off request created successfully!');
    } catch (error) {
      console.error('Error creating time off request:', error);
      alert('Failed to create time off request. Check console for details.');
    }
  };

  const handleApprove = async (requestId: string) => {
    try {
      const response = await fetch(`http://localhost:3177/api/work-schedule/time-off/${requestId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'approved',
          approver: 'Admin',
          approvedDate: new Date().toISOString()
        })
      });

      if (!response.ok) throw new Error('Failed to approve request');

      await loadTimeOffRequests();
      alert('Time off request approved!');
    } catch (error) {
      console.error('Error approving request:', error);
      alert('Failed to approve request. Check console for details.');
    }
  };

  const handleReject = async (requestId: string) => {
    try {
      const response = await fetch(`http://localhost:3177/api/work-schedule/time-off/${requestId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'rejected',
          approver: 'Admin',
          approvedDate: new Date().toISOString()
        })
      });

      if (!response.ok) throw new Error('Failed to reject request');

      await loadTimeOffRequests();
      alert('Time off request rejected!');
    } catch (error) {
      console.error('Error rejecting request:', error);
      alert('Failed to reject request. Check console for details.');
    }
  };

  const resetForm = () => {
    setFormData({
      employeeId: '',
      employeeName: '',
      type: 'Annual Leave',
      startDate: '',
      endDate: '',
      reason: '',
      isPartial: false,
      partialStartTime: '',
      partialEndTime: ''
    });
  };

  const filteredRequests = timeOffRequests.filter(request => {
    if (filterStatus === 'all') return true;
    return request.status === filterStatus;
  });

  const sortedRequests = [...filteredRequests].sort((a, b) => {
    return new Date(b.requested_date).getTime() - new Date(a.requested_date).getTime();
  });

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

  const calculateDays = (startDate: string, endDate: string) => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return diffDays;
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Time Off Requests</h2>
            <p className="text-sm text-gray-600 mt-1">
              Manage employee time off requests
            </p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
          >
            <Plus size={20} />
            New Request
          </button>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 mb-6 border-b border-gray-200">
          <button
            onClick={() => setFilterStatus('all')}
            className={`px-4 py-2 font-medium transition-colors border-b-2 ${
              filterStatus === 'all'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            All ({timeOffRequests.length})
          </button>
          <button
            onClick={() => setFilterStatus('pending')}
            className={`px-4 py-2 font-medium transition-colors border-b-2 ${
              filterStatus === 'pending'
                ? 'border-yellow-500 text-yellow-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Pending ({timeOffRequests.filter(r => r.status === 'pending').length})
          </button>
          <button
            onClick={() => setFilterStatus('approved')}
            className={`px-4 py-2 font-medium transition-colors border-b-2 ${
              filterStatus === 'approved'
                ? 'border-green-500 text-green-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Approved ({timeOffRequests.filter(r => r.status === 'approved').length})
          </button>
          <button
            onClick={() => setFilterStatus('rejected')}
            className={`px-4 py-2 font-medium transition-colors border-b-2 ${
              filterStatus === 'rejected'
                ? 'border-red-500 text-red-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Rejected ({timeOffRequests.filter(r => r.status === 'rejected').length})
          </button>
        </div>

        {/* Requests List */}
        <div className="space-y-4">
          {sortedRequests.length === 0 ? (
            <div className="text-center py-12">
              <Calendar className="mx-auto text-gray-400 mb-3" size={48} />
              <p className="text-gray-600 text-lg font-medium">No time off requests</p>
              <p className="text-gray-500 text-sm mt-1">
                {filterStatus === 'all' 
                  ? 'Click "New Request" to add a time off request'
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
                      {formatDate(request.requested_date)}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
                  <div>
                    <div className="text-xs text-gray-600 mb-1">Employee</div>
                    <div className="font-bold text-gray-900 text-lg">{request.employee_name}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-600 mb-1">Type</div>
                    <div className="font-medium text-gray-900">{request.type}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-600 mb-1">Duration</div>
                    <div className="font-medium text-gray-900">
                      {formatDate(request.start_date)} ~ {formatDate(request.end_date)}
                      <span className="ml-2 text-sm text-gray-600">
                        ({calculateDays(request.start_date, request.end_date)} days)
                      </span>
                    </div>
                  </div>
                </div>

                {request.is_partial === 1 && (
                  <div className="mb-4 p-3 bg-blue-50 rounded-lg">
                    <div className="text-xs text-blue-800 font-semibold mb-1">Partial Day</div>
                    <div className="text-sm text-blue-900">
                      {request.partial_start_time} ~ {request.partial_end_time}
                    </div>
                  </div>
                )}

                {request.reason && (
                  <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                    <div className="text-xs text-gray-600 font-semibold mb-1">Reason</div>
                    <div className="text-sm text-gray-700">{request.reason}</div>
                  </div>
                )}

                {request.status === 'pending' ? (
                  <div className="flex items-center justify-between pt-3 border-t border-gray-200">
                    <div className="text-sm text-gray-600">
                      <span className="font-semibold text-yellow-700">⏳ Awaiting approval</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleApprove(request.id)}
                        className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-medium text-sm"
                      >
                        <Check size={16} />
                        Approve
                      </button>
                      <button
                        onClick={() => handleReject(request.id)}
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
                    <span>{request.approved_date ? formatDate(request.approved_date) : 'N/A'}</span>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Add Request Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center sticky top-0 bg-white">
              <h2 className="text-xl font-bold text-gray-800">New Time Off Request</h2>
              <button 
                onClick={() => {
                  setShowAddModal(false);
                  resetForm();
                }} 
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>
            
            <div className="p-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Employee *</label>
                  <select
                    value={formData.employeeId}
                    onChange={(e) => setFormData({ ...formData, employeeId: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select Employee</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Type *</label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="Annual Leave">Annual Leave</option>
                    <option value="Sick Leave">Sick Leave</option>
                    <option value="Personal Leave">Personal Leave</option>
                    <option value="Unpaid Leave">Unpaid Leave</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Start Date *</label>
                    <input
                      type="date"
                      value={formData.startDate}
                      onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">End Date *</label>
                    <input
                      type="date"
                      value={formData.endDate}
                      onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="isPartial"
                    checked={formData.isPartial}
                    onChange={(e) => setFormData({ ...formData, isPartial: e.target.checked })}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <label htmlFor="isPartial" className="ml-2 text-sm font-medium text-gray-700">
                    Partial Day (Specify Time Range)
                  </label>
                </div>

                {formData.isPartial && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Start Time</label>
                      <input
                        type="time"
                        value={formData.partialStartTime}
                        onChange={(e) => setFormData({ ...formData, partialStartTime: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">End Time</label>
                      <input
                        type="time"
                        value={formData.partialEndTime}
                        onChange={(e) => setFormData({ ...formData, partialEndTime: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Reason</label>
                  <textarea
                    value={formData.reason}
                    onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={3}
                    placeholder="Optional reason for time off..."
                  />
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 sticky bottom-0 bg-white">
              <button
                onClick={() => {
                  setShowAddModal(false);
                  resetForm();
                }}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleAddRequest}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold"
              >
                Create Request
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TimeOffRequestsPage;

