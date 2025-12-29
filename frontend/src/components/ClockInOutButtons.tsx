import React, { useState } from 'react';
import PinInputModal from './PinInputModal';
import clockInOutApi from '../services/clockInOutApi';

interface ClockInOutButtonsProps {
  compact?: boolean; // 작은 버튼으로 표시할지 여부
}

const ClockInOutButtons: React.FC<ClockInOutButtonsProps> = ({ compact = false }) => {
  console.log('🔵 ClockInOutButtons 컴포넌트 렌더링됨, compact:', compact);
  
  const [showClockInModal, setShowClockInModal] = useState(false);
  const [showClockOutModal, setShowClockOutModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [showEarlyOutModal, setShowEarlyOutModal] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [earlyOutReason, setEarlyOutReason] = useState('');
  const [approvedBy, setApprovedBy] = useState('');

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

      // Check if early out (before 6 PM)
      const now = new Date();
      const currentHour = now.getHours();
      
      if (currentHour < 18) {
        // Ask for early out reason
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

      alert(`${selectedEmployee.name}님, 조기 퇴근 처리되었습니다.\n근무 시간: ${response.totalHours}시간`);

      setShowEarlyOutModal(false);
      setSelectedEmployee(null);
      setEarlyOutReason('');
      setApprovedBy('');
    } catch (error: any) {
      alert(`조기 퇴근 처리 실패: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  if (compact) {
    return (
      <>
        <div className="flex gap-1">
          <button
            onClick={() => {
              console.log('🟢 Clock In 버튼 클릭됨!');
              setShowClockInModal(true);
            }}
            className="h-9 px-2 bg-green-500 hover:bg-green-600 text-white text-xs font-semibold rounded transition-colors"
            title="출근 (Clock In)"
          >
            ⏰ IN
          </button>
          <button
            onClick={() => {
              console.log('🔴 Clock Out 버튼 클릭됨!');
              setShowClockOutModal(true);
            }}
            className="h-9 px-2 bg-red-500 hover:bg-red-600 text-white text-xs font-semibold rounded transition-colors"
            title="퇴근 (Clock Out)"
          >
            🚪 OUT
          </button>
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
      </>
    );
  }

  // Default: Large buttons
  return (
    <>
      <div className="flex gap-3">
        <button
          onClick={() => setShowClockInModal(true)}
          className="px-6 py-3 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-lg shadow-md transition-colors"
        >
          ⏰ Clock In (출근)
        </button>
        <button
          onClick={() => setShowClockOutModal(true)}
          className="px-6 py-3 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-lg shadow-md transition-colors"
        >
          🚪 Clock Out (퇴근)
        </button>
      </div>

      {/* Modals */}
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
    </>
  );
};

export default ClockInOutButtons;

