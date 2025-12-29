import React, { useState, useEffect } from 'react';
import PinInputModal from '../components/PinInputModal';
import clockInOutApi, { ClockedInEmployee } from '../services/clockInOutApi';

const TableMapPage = () => {
  const [showClockInModal, setShowClockInModal] = useState(false);
  const [showClockOutModal, setShowClockOutModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [clockedInEmployees, setClockedInEmployees] = useState<ClockedInEmployee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [showEarlyOutModal, setShowEarlyOutModal] = useState(false);
  const [earlyOutReason, setEarlyOutReason] = useState('');
  const [approvedBy, setApprovedBy] = useState('');

  // Load clocked in employees
  useEffect(() => {
    loadClockedInEmployees();
    
    // Refresh every minute
    const interval = setInterval(loadClockedInEmployees, 60000);
    return () => clearInterval(interval);
  }, []);

  const loadClockedInEmployees = async () => {
    try {
      const employees = await clockInOutApi.getClockedInEmployees();
      setClockedInEmployees(employees);
    } catch (error) {
      console.error('Failed to load clocked in employees:', error);
    }
  };

  const handleClockIn = async (pin: string) => {
    setIsLoading(true);
    setError('');

    try {
      // Verify PIN first
      const { employee } = await clockInOutApi.verifyPin(pin);
      
      // Then clock in
      const response = await clockInOutApi.clockIn(employee.id, employee.name, pin);
      
      alert(`${employee.name}님, 출근 처리되었습니다!\n시간: ${new Date(response.clockInTime).toLocaleTimeString('ko-KR')}`);
      
      setShowClockInModal(false);
      loadClockedInEmployees();
    } catch (error: any) {
      setError(error.message || '출근 처리 실패');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClockOut = async (pin: string) => {
    setIsLoading(true);
    setError('');

    try {
      // Verify PIN and get employee info
      const { employee } = await clockInOutApi.verifyPin(pin);
      
      // Check if employee is clocked in
      const isClockedIn = clockedInEmployees.some(e => e.employee_id === employee.id);
      
      if (!isClockedIn) {
        setError('출근 기록이 없습니다.');
        setIsLoading(false);
        return;
      }

      // Ask if early out
      const now = new Date();
      const currentHour = now.getHours();
      
      // If before 6 PM, ask if early out
      if (currentHour < 18) {
        setSelectedEmployee(employee);
        setShowClockOutModal(false);
        setShowEarlyOutModal(true);
        setIsLoading(false);
        return;
      }

      // Normal clock out
      const response = await clockInOutApi.clockOut(employee.id, pin);
      
      alert(`${employee.name}님, 퇴근 처리되었습니다!\n근무 시간: ${response.totalHours}시간`);
      
      setShowClockOutModal(false);
      loadClockedInEmployees();
    } catch (error: any) {
      setError(error.message || '퇴근 처리 실패');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEarlyOut = async () => {
    if (!selectedEmployee || !earlyOutReason.trim()) {
      alert('조기 퇴근 사유를 입력해주세요.');
      return;
    }

    setIsLoading(true);

    try {
      // Get PIN again for security
      const pin = prompt(`${selectedEmployee.name}님, PIN을 다시 입력해주세요:`);
      if (!pin) {
        setIsLoading(false);
        return;
      }

      const response = await clockInOutApi.clockOut(
        selectedEmployee.id,
        pin,
        true,
        earlyOutReason,
        approvedBy
      );

      alert(`${selectedEmployee.name}님, 조기 퇴근 처리되었습니다.\n근무 시간: ${response.totalHours}시간\n사유: ${earlyOutReason}`);

      setShowEarlyOutModal(false);
      setSelectedEmployee(null);
      setEarlyOutReason('');
      setApprovedBy('');
      loadClockedInEmployees();
    } catch (error: any) {
      alert(`조기 퇴근 처리 실패: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const calculateWorkTime = (clockInTime: string): string => {
    const start = new Date(clockInTime);
    const now = new Date();
    const diff = now.getTime() - start.getTime();
    
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    return `${hours}시간 ${minutes}분`;
  };

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex justify-between items-center">
          <h1 className="text-3xl font-bold text-gray-800">🗺️ Table Map & Clock In/Out</h1>
          <div className="flex gap-3">
            <button
              onClick={() => {
                console.log('Clock In button clicked!');
                setShowClockInModal(true);
              }}
              className="px-6 py-3 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-lg shadow-md transition-colors"
            >
              ⏰ Clock In (출근)
            </button>
            <button
              onClick={() => {
                console.log('Clock Out button clicked!');
                setShowClockOutModal(true);
              }}
              className="px-6 py-3 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-lg shadow-md transition-colors"
            >
              🚪 Clock Out (퇴근)
            </button>
          </div>
        </div>

        {/* Currently Clocked In Employees */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center">
            <span className="mr-2">👥</span>
            현재 출근 중인 직원 ({clockedInEmployees.length}명)
          </h2>
          
          {clockedInEmployees.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>출근한 직원이 없습니다.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {clockedInEmployees.map((employee) => (
                <div
                  key={employee.id}
                  className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h3 className="font-semibold text-lg text-gray-800">
                        {employee.employee_name}
                      </h3>
                      <p className="text-sm text-gray-600">{employee.role}</p>
                      <p className="text-xs text-gray-500">{employee.department}</p>
                    </div>
                    <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                  </div>
                  
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">출근 시간:</span>
                      <span className="font-medium text-gray-800">
                        {new Date(employee.clock_in_time).toLocaleTimeString('ko-KR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm mt-1">
                      <span className="text-gray-600">근무 시간:</span>
                      <span className="font-medium text-blue-600">
                        {calculateWorkTime(employee.clock_in_time)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Table Map Placeholder */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-bold text-gray-800 mb-4">
            테이블 배치도
          </h2>
          <div className="bg-gray-100 rounded-lg p-8 min-h-[400px] flex items-center justify-center">
            <div className="text-center">
              <div className="text-6xl mb-4">📋</div>
              <p className="text-gray-600 text-lg">테이블 배치도가 여기에 표시됩니다</p>
              <p className="text-sm text-gray-500 mt-2">
                드래그 앤 드롭으로 테이블을 배치하세요
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Clock In Modal */}
      <PinInputModal
        isOpen={showClockInModal}
        onClose={() => {
          setShowClockInModal(false);
          setError('');
        }}
        onSubmit={handleClockIn}
        title="출근 (Clock In)"
        message="PIN 번호를 입력하세요"
        isLoading={isLoading}
        error={error}
      />

      {/* Clock Out Modal */}
      <PinInputModal
        isOpen={showClockOutModal}
        onClose={() => {
          setShowClockOutModal(false);
          setError('');
        }}
        onSubmit={handleClockOut}
        title="퇴근 (Clock Out)"
        message="PIN 번호를 입력하세요"
        isLoading={isLoading}
        error={error}
      />

      {/* Early Out Modal */}
      {showEarlyOutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-96">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">
              ⚠️ 조기 퇴근 (Early Out)
            </h2>
            
            <p className="text-gray-600 mb-4">
              {selectedEmployee?.name}님의 조기 퇴근 사유를 입력하세요.
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                조기 퇴근 사유 *
              </label>
              <textarea
                value={earlyOutReason}
                onChange={(e) => setEarlyOutReason(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
                placeholder="예: 개인 사정, 병원 방문 등"
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                승인자 (선택)
              </label>
              <input
                type="text"
                value={approvedBy}
                onChange={(e) => setApprovedBy(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="승인자 이름"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowEarlyOutModal(false);
                  setSelectedEmployee(null);
                  setEarlyOutReason('');
                  setApprovedBy('');
                }}
                className="flex-1 px-4 py-3 bg-gray-200 hover:bg-gray-300 rounded-lg font-semibold text-gray-700 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleEarlyOut}
                disabled={!earlyOutReason.trim() || isLoading}
                className="flex-1 px-4 py-3 bg-red-500 hover:bg-red-600 rounded-lg font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? '처리 중...' : '조기 퇴근 처리'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TableMapPage;
