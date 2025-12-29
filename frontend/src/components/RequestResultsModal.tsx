import React, { useState, useEffect } from 'react';
import { X, RefreshCw, Calendar, Clock, CheckCircle, XCircle, AlertCircle, TrendingUp, ChevronLeft, ChevronRight } from 'lucide-react';

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

interface TimeOffRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  type: string;
  startDate: string;
  endDate: string;
  workDaysCount: number;
  status: 'pending' | 'approved' | 'rejected';
  requestDate: string;
  reason?: string;
  approver?: string;
  approvalDate?: string;
  isPartial?: boolean;
  partialStartTime?: string;
  partialEndTime?: string;
}

interface RequestResultsModalProps {
  onClose: () => void;
}

const RequestResultsModal: React.FC<RequestResultsModalProps> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<'all' | 'shift-swaps' | 'time-off'>('all');
  const [shiftSwapRequests, setShiftSwapRequests] = useState<ShiftSwapRequest[]>([]);
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([]);
  const [selectedShiftSwap, setSelectedShiftSwap] = useState<ShiftSwapRequest | null>(null);
  const [shiftSwapFilter, setShiftSwapFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [calendarMonth, setCalendarMonth] = useState(new Date());

  // Load shift swap requests from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('shiftSwapRequests');
    if (saved) {
      setShiftSwapRequests(JSON.parse(saved));
    }
  }, []);

  // Load time off requests from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('timeOffRequests');
    if (saved) {
      setTimeOffRequests(JSON.parse(saved));
    }
  }, []);

  // Save time off requests to localStorage
  useEffect(() => {
    if (timeOffRequests.length > 0) {
      localStorage.setItem('timeOffRequests', JSON.stringify(timeOffRequests));
    }
  }, [timeOffRequests]);

  // Statistics
  const shiftSwapStats = {
    total: shiftSwapRequests.length,
    approved: shiftSwapRequests.filter(r => r.status === 'approved').length,
    rejected: shiftSwapRequests.filter(r => r.status === 'rejected').length,
    pending: shiftSwapRequests.filter(r => r.status === 'pending').length,
  };

  const timeOffStats = {
    total: timeOffRequests.length,
    approved: timeOffRequests.filter(r => r.status === 'approved').length,
    rejected: timeOffRequests.filter(r => r.status === 'rejected').length,
    pending: timeOffRequests.filter(r => r.status === 'pending').length,
  };

  const totalStats = {
    total: shiftSwapStats.total + timeOffStats.total,
    approved: shiftSwapStats.approved + timeOffStats.approved,
    rejected: shiftSwapStats.rejected + timeOffStats.rejected,
    pending: shiftSwapStats.pending + timeOffStats.pending,
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
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

  // Approve Time Off Request
  const approveTimeOffRequest = (requestId: string) => {
    setTimeOffRequests(requests =>
      requests.map(request => {
        if (request.id === requestId) {
          return {
            ...request,
            status: 'approved' as const,
            approver: 'Admin',
            approvalDate: new Date().toISOString()
          };
        }
        return request;
      })
    );
  };

  // Reject Time Off Request
  const rejectTimeOffRequest = (requestId: string) => {
    setTimeOffRequests(requests =>
      requests.map(request => {
        if (request.id === requestId) {
          return {
            ...request,
            status: 'rejected' as const,
            approver: 'Admin',
            approvalDate: new Date().toISOString()
          };
        }
        return request;
      })
    );
  };

  // Get days in month for calendar
  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();
    
    return { daysInMonth, startingDayOfWeek, year, month };
  };

  // Check if date has shift swap
  const getShiftSwapsForDate = (date: Date) => {
    const dateString = date.toISOString().split('T')[0];
    return shiftSwapRequests.filter(
      req => req.firstScheduleDate === dateString || req.secondScheduleDate === dateString
    );
  };

  // Navigate calendar month
  const previousMonth = () => {
    setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1));
  };

  const goToToday = () => {
    setCalendarMonth(new Date());
  };

  const getStatusIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case 'approved':
        return <CheckCircle className="text-green-600" size={20} />;
      case 'rejected':
        return <XCircle className="text-red-600" size={20} />;
      case 'pending':
        return <AlertCircle className="text-yellow-600" size={20} />;
      default:
        return null;
    }
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status.toLowerCase()) {
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

  const renderStatCards = (stats: typeof totalStats) => (
    <div className="grid grid-cols-4 gap-3 mb-4">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium text-blue-800">Total</span>
          <TrendingUp className="text-blue-600" size={18} />
        </div>
        <div className="text-2xl font-bold text-blue-900">{stats.total}</div>
      </div>
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium text-yellow-800">Pending</span>
          <AlertCircle className="text-yellow-600" size={18} />
        </div>
        <div className="text-2xl font-bold text-yellow-900">{stats.pending}</div>
      </div>
      <div className="bg-green-50 border border-green-200 rounded-lg p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium text-green-800">Approved</span>
          <CheckCircle className="text-green-600" size={18} />
        </div>
        <div className="text-2xl font-bold text-green-900">{stats.approved}</div>
      </div>
      <div className="bg-red-50 border border-red-200 rounded-lg p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium text-red-800">Rejected</span>
          <XCircle className="text-red-600" size={18} />
        </div>
        <div className="text-2xl font-bold text-red-900">{stats.rejected}</div>
      </div>
    </div>
  );

  const renderShiftSwapRequests = () => {
    // Filter requests
    const filteredRequests = shiftSwapFilter === 'all' 
      ? shiftSwapRequests 
      : shiftSwapRequests.filter(req => req.status === shiftSwapFilter);

    const { daysInMonth, startingDayOfWeek, year, month } = getDaysInMonth(calendarMonth);
    const today = new Date();
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return (
      <div className="grid grid-cols-2 gap-4 h-[500px]">
        {/* Left Side - Requests List */}
        <div className="flex flex-col border-r border-gray-200 pr-4">
          {/* Filter Buttons */}
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Filter by Status</h3>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setShiftSwapFilter('all')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  shiftSwapFilter === 'all'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                All ({shiftSwapRequests.length})
              </button>
              <button
                onClick={() => setShiftSwapFilter('pending')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  shiftSwapFilter === 'pending'
                    ? 'bg-yellow-500 text-white'
                    : 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100'
                }`}
              >
                Pending ({shiftSwapRequests.filter(r => r.status === 'pending').length})
              </button>
              <button
                onClick={() => setShiftSwapFilter('approved')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  shiftSwapFilter === 'approved'
                    ? 'bg-green-600 text-white'
                    : 'bg-green-50 text-green-700 hover:bg-green-100'
                }`}
              >
                Approved ({shiftSwapRequests.filter(r => r.status === 'approved').length})
              </button>
              <button
                onClick={() => setShiftSwapFilter('rejected')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  shiftSwapFilter === 'rejected'
                    ? 'bg-red-600 text-white'
                    : 'bg-red-50 text-red-700 hover:bg-red-100'
                }`}
              >
                Rejected ({shiftSwapRequests.filter(r => r.status === 'rejected').length})
              </button>
            </div>
          </div>

          {/* Requests List */}
          <div className="flex-1 overflow-y-auto space-y-2">
            {filteredRequests.length === 0 ? (
              <div className="text-center py-12">
                <RefreshCw className="mx-auto text-gray-400 mb-3" size={48} />
                <p className="text-gray-600">No {shiftSwapFilter === 'all' ? '' : shiftSwapFilter} requests</p>
              </div>
            ) : (
              filteredRequests.map(request => (
                <div
                  key={request.id}
                  onClick={() => setSelectedShiftSwap(request)}
                  className={`border rounded-lg p-3 cursor-pointer transition-all ${
                    selectedShiftSwap?.id === request.id
                      ? 'border-blue-500 bg-blue-50 shadow-md'
                      : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    {getStatusIcon(request.status)}
                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${getStatusBadgeClass(request.status)}`}>
                      {request.status.toUpperCase()}
                    </span>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                      <span className="text-sm font-medium text-gray-900">{request.firstEmployeeName}</span>
                    </div>
                    <div className="text-xs text-gray-600 ml-4">
                      {formatDate(request.firstScheduleDate)} • {request.firstScheduleStart} ~ {request.firstScheduleEnd}
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500"></div>
                      <span className="text-sm font-medium text-gray-900">{request.secondEmployeeName}</span>
                    </div>
                    <div className="text-xs text-gray-600 ml-4">
                      {formatDate(request.secondScheduleDate)} • {request.secondScheduleStart} ~ {request.secondScheduleEnd}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Side - Calendar */}
        <div className="flex flex-col">
          {/* Calendar Header */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-gray-900">
                {monthNames[month]} {year}
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={goToToday}
                  className="px-2 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                >
                  Today
                </button>
                <button
                  onClick={previousMonth}
                  className="p-1 hover:bg-gray-100 rounded transition-colors"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  onClick={nextMonth}
                  className="p-1 hover:bg-gray-100 rounded transition-colors"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>

            {/* Calendar Grid */}
            <div className="bg-white rounded-lg border border-gray-200 p-2">
              {/* Day Headers */}
              <div className="grid grid-cols-7 gap-0.5 mb-1">
                {dayNames.map(day => (
                  <div key={day} className="text-center text-xs font-semibold text-gray-600 py-0.5">
                    {day}
                  </div>
                ))}
              </div>

              {/* Calendar Days */}
              <div className="grid grid-cols-7 gap-0.5">
                {/* Empty cells for days before month starts */}
                {Array.from({ length: startingDayOfWeek }).map((_, index) => (
                  <div key={`empty-${index}`} className="aspect-square"></div>
                ))}

                {/* Days of the month */}
                {Array.from({ length: daysInMonth }).map((_, dayIndex) => {
                  const day = dayIndex + 1;
                  const date = new Date(year, month, day);
                  const dateString = date.toISOString().split('T')[0];
                  const swapsForDate = getShiftSwapsForDate(date);
                  const isToday = date.toDateString() === today.toDateString();
                  const hasSwaps = swapsForDate.length > 0;
                  const hasPending = swapsForDate.some(s => s.status === 'pending');
                  const hasApproved = swapsForDate.some(s => s.status === 'approved');

                  return (
                    <div
                      key={day}
                      className={`aspect-square p-1 rounded-lg border transition-all cursor-pointer ${
                        isToday
                          ? 'border-blue-500 bg-blue-50'
                          : hasSwaps
                          ? 'border-orange-300 bg-orange-50 hover:bg-orange-100'
                          : 'border-gray-100 hover:bg-gray-50'
                      }`}
                      onClick={() => {
                        if (hasSwaps) {
                          setSelectedShiftSwap(swapsForDate[0]);
                        }
                      }}
                    >
                      <div className="text-xs font-medium text-center mb-1">
                        {day}
                      </div>
                      {hasSwaps && (
                        <div className="flex flex-col gap-0.5">
                          {hasPending && (
                            <div className="w-full h-1 bg-yellow-500 rounded-full"></div>
                          )}
                          {hasApproved && (
                            <div className="w-full h-1 bg-green-500 rounded-full"></div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Selected Shift Swap Details */}
          {selectedShiftSwap && (
            <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <h4 className="text-sm font-semibold text-gray-900 mb-2">Selected Shift Swap</h4>
              
              <div className="space-y-2">
                <div className="bg-blue-100 border border-blue-200 rounded p-2">
                  <div className="text-xs text-blue-800 font-semibold">Employee 1</div>
                  <div className="font-bold text-sm text-gray-900">{selectedShiftSwap.firstEmployeeName}</div>
                  <div className="text-xs text-gray-700">
                    {formatDate(selectedShiftSwap.firstScheduleDate)}
                  </div>
                  <div className="text-xs font-medium text-gray-900">
                    {selectedShiftSwap.firstScheduleStart} ~ {selectedShiftSwap.firstScheduleEnd}
                  </div>
                </div>

                <div className="flex justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-orange-500">
                    <path d="M17 2.1l4 4-4 4"/>
                    <path d="M3 12.2l4 4 4-4"/>
                    <path d="M21 6.1h-14"/>
                    <path d="M7 16.2h14"/>
                  </svg>
                </div>

                <div className="bg-green-100 border border-green-200 rounded p-2">
                  <div className="text-xs text-green-800 font-semibold">Employee 2</div>
                  <div className="font-bold text-sm text-gray-900">{selectedShiftSwap.secondEmployeeName}</div>
                  <div className="text-xs text-gray-700">
                    {formatDate(selectedShiftSwap.secondScheduleDate)}
                  </div>
                  <div className="text-xs font-medium text-gray-900">
                    {selectedShiftSwap.secondScheduleStart} ~ {selectedShiftSwap.secondScheduleEnd}
                  </div>
                </div>

                {selectedShiftSwap.status !== 'pending' && (
                  <div className="text-xs text-gray-600 bg-white rounded p-1.5">
                    <span className="font-semibold">
                      {selectedShiftSwap.status === 'approved' ? '✅ Approved' : '❌ Rejected'}
                    </span>
                    {' by '}
                    <span className="font-semibold">{selectedShiftSwap.approver}</span>
                    {selectedShiftSwap.approvalDate && (
                      <>
                        {' on '}
                        <span>{formatDateTime(selectedShiftSwap.approvalDate)}</span>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderTimeOffRequests = () => (
    <div className="space-y-4">
      {timeOffRequests.length === 0 ? (
        <div className="text-center py-12">
          <Calendar className="mx-auto text-gray-400 mb-3" size={48} />
          <p className="text-gray-600 text-lg font-medium">No time off requests</p>
        </div>
      ) : (
        timeOffRequests.map((request) => (
          <div key={request.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-all">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                {getStatusIcon(request.status)}
                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusBadgeClass(request.status)}`}>
                  {request.status.toUpperCase()}
                </span>
                {request.requestDate && (
                  <div className="text-xs text-gray-500 flex items-center gap-1">
                    <Clock size={14} />
                    {formatDateTime(request.requestDate)}
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-3">
              <div>
                <div className="font-bold text-gray-900 text-lg mb-1">{request.employeeName}</div>
                <div className="text-sm text-gray-600">{request.type}</div>
                {request.isPartial && (
                  <div className="text-xs text-blue-600 mt-1">
                    Partial: {request.partialStartTime} ~ {request.partialEndTime}
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className="flex items-center justify-end gap-2 text-sm text-gray-700 mb-1">
                  <Calendar size={14} />
                  {formatDate(request.startDate)} ~ {formatDate(request.endDate)}
                </div>
                <div className="text-sm font-medium text-gray-900">
                  {request.workDaysCount} day{request.workDaysCount !== 1 ? 's' : ''}
                </div>
              </div>
            </div>

            {/* Reason */}
            {request.reason && (
              <div className="mb-3 p-2 bg-gray-50 rounded">
                <div className="text-xs text-gray-600 font-semibold mb-1">Reason:</div>
                <div className="text-sm text-gray-700">{request.reason}</div>
              </div>
            )}

            {/* Action Buttons or Approval Info */}
            {request.status === 'pending' ? (
              <div className="flex items-center justify-between pt-3 border-t border-gray-200">
                <div className="text-sm text-gray-600">
                  <span className="font-semibold text-yellow-700">⏳ Awaiting approval</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => approveTimeOffRequest(request.id)}
                    className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-medium text-sm"
                  >
                    <CheckCircle size={16} />
                    Approve
                  </button>
                  <button
                    onClick={() => rejectTimeOffRequest(request.id)}
                    className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors font-medium text-sm"
                  >
                    <XCircle size={16} />
                    Reject
                  </button>
                </div>
              </div>
            ) : (
              <div className="pt-3 border-t border-gray-200 text-sm text-gray-600">
                <span className="font-semibold">
                  {request.status === 'approved' ? '✅ Approved' : '❌ Rejected'}
                </span>
                {request.approver && (
                  <>
                    {' by '}
                    <span className="font-semibold">{request.approver}</span>
                  </>
                )}
                {request.approvalDate && (
                  <>
                    {' on '}
                    <span>{formatDateTime(request.approvalDate)}</span>
                  </>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );

  const renderAllRequests = () => (
    <div className="space-y-6">
      {/* Shift Swaps Section */}
      {shiftSwapRequests.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <RefreshCw size={20} className="text-orange-600" />
            Shift Swap Requests ({shiftSwapRequests.length})
          </h3>
          {renderShiftSwapRequests()}
        </div>
      )}

      {/* Time Off Section */}
      {timeOffRequests.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Calendar size={20} className="text-blue-600" />
            Time Off Requests ({timeOffRequests.length})
          </h3>
          {renderTimeOffRequests()}
        </div>
      )}

      {shiftSwapRequests.length === 0 && timeOffRequests.length === 0 && (
        <div className="text-center py-12">
          <TrendingUp className="mx-auto text-gray-400 mb-3" size={48} />
          <p className="text-gray-600 text-lg font-medium">No requests found</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Request Results</h2>
            <p className="text-sm text-gray-600 mt-0.5">
              Overview of all shift swaps and time off requests
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 px-4 pt-3 border-b border-gray-200">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-4 py-2 font-medium transition-colors border-b-2 ${
              activeTab === 'all'
                ? 'border-orange-500 text-orange-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            All Requests
          </button>
          <button
            onClick={() => setActiveTab('shift-swaps')}
            className={`px-4 py-2 font-medium transition-colors border-b-2 ${
              activeTab === 'shift-swaps'
                ? 'border-orange-500 text-orange-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Shift Swaps ({shiftSwapRequests.length})
          </button>
          <button
            onClick={() => setActiveTab('time-off')}
            className={`px-4 py-2 font-medium transition-colors border-b-2 ${
              activeTab === 'time-off'
                ? 'border-orange-500 text-orange-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Time Off ({timeOffRequests.length})
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Statistics */}
          {activeTab === 'all' && renderStatCards(totalStats)}
          {activeTab === 'shift-swaps' && renderStatCards(shiftSwapStats)}
          {activeTab === 'time-off' && renderStatCards(timeOffStats)}

          {/* Requests List */}
          {activeTab === 'all' && renderAllRequests()}
          {activeTab === 'shift-swaps' && renderShiftSwapRequests()}
          {activeTab === 'time-off' && renderTimeOffRequests()}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default RequestResultsModal;


