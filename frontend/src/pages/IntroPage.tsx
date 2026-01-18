import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../config/constants';

const IntroPage: React.FC = () => {
  const [pin, setPin] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [serviceType, setServiceType] = useState<string | null>(null);
  const [showSelection, setShowSelection] = useState(false);
  const navigate = useNavigate();

  // Check if initial setup is needed
  useEffect(() => {
    const checkInitialSetup = async () => {
      try {
        const response = await fetch(`${API_URL}/admin-settings/initial-setup-status`);
        if (response.ok) {
          const data = await response.json();
          if (data.needsSetup) {
            // Redirect to initial setup page
            navigate('/initial-setup');
            return;
          }
          setServiceType(data.serviceType);
        }
      } catch (error) {
        console.error('Failed to check initial setup status:', error);
      } finally {
        setIsLoading(false);
      }
    };

    checkInitialSetup();
  }, [navigate]);

  const handlePinInput = (digit: string) => {
    if (pin.length < 4) {
      const newPin = pin + digit;
      setPin(newPin);
      
      if (newPin.length === 4) {
        handlePinSubmit(newPin);
      }
    }
  };

  const handlePinSubmit = (submittedPin: string) => {
    if (submittedPin === '0000') {
      // Show selection modal
      setShowSelection(true);
    } else {
      setMessage('잘못된 PIN입니다. 다시 시도해주세요.');
      setTimeout(() => {
        setPin('');
        setMessage('');
      }, 2000);
    }
  };

  const handleNavigate = (destination: 'sales' | 'backoffice') => {
    if (destination === 'sales') {
      if (serviceType === 'QSR') {
        navigate('/qsr');
      } else {
        navigate('/sales');
      }
    } else {
      navigate('/backoffice/menu');
    }
  };

  const handleClear = () => {
    setPin('');
    setMessage('');
  };

  const handleBackspace = () => {
    setPin(prev => prev.slice(0, -1));
  };

  useEffect(() => {
    // PIN이 4자리가 되면 자동으로 제출
    if (pin.length === 4) {
      handlePinSubmit(pin);
    }
  }, [pin]);

  // Show loading while checking setup status
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-white/70 text-lg">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 flex items-center justify-center p-4">
      {/* 배경 이미지와 블러 효과 */}
      <div className="absolute inset-0 z-0">
        <div 
          className="w-full h-full bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: 'url("/images/intro.jpg")',
            filter: 'blur(8px) brightness(0.3) saturate(1.2)'
          }}
        />
      </div>

      {/* 메인 콘텐츠 */}
      <div className="relative z-10 text-center">
        {/* 로고 */}
        <div className="mb-8">
          <h1 className="text-5xl font-bold text-white mb-2 drop-shadow-2xl">
            The Zone POS
          </h1>
          <p className="text-3xl text-blue-200 font-bold">
            One Touch, So Much
          </p>
        </div>

        {/* PIN 입력 표시 */}
        <div className="mb-8">
          <div className="flex justify-center space-x-4 mb-4">
            {[...Array(4)].map((_, index) => (
              <div
                key={index}
                className={`w-4 h-4 rounded-full border-2 transition-all duration-200 ${
                  index < pin.length
                    ? 'bg-white border-white'
                    : 'border-white/50'
                }`}
              />
            ))}
          </div>
          {message && (
            <p className="text-red-300 text-lg font-medium">{message}</p>
          )}
        </div>

        {/* PIN 패드 */}
        <div className="bg-white/10 backdrop-blur-md rounded-3xl p-8 border border-white/20 shadow-2xl">
          <div className="grid grid-cols-3 gap-4 max-w-xs mx-auto">
            {/* 숫자 버튼들 */}
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
              <button
                key={num}
                onClick={() => handlePinInput(num.toString())}
                className="w-16 h-16 bg-white/20 hover:bg-white/30 text-white text-2xl font-bold rounded-full border border-white/30 transition-all duration-200 hover:scale-105 active:scale-95 backdrop-blur-sm"
              >
                {num}
              </button>
            ))}
            
            {/* Clear 버튼 */}
            <button
              onClick={handleClear}
              className="w-16 h-16 bg-red-500/80 hover:bg-red-500 text-white text-sm font-bold rounded-full border border-red-400/50 transition-all duration-200 hover:scale-105 active:scale-95 backdrop-blur-sm"
            >
              Clear
            </button>
            
            {/* 0 버튼 */}
            <button
              onClick={() => handlePinInput('0')}
              className="w-16 h-16 bg-white/20 hover:bg-white/30 text-white text-2xl font-bold rounded-full border border-white/30 transition-all duration-200 hover:scale-105 active:scale-95 backdrop-blur-sm"
            >
              0
            </button>
            
            {/* Backspace 버튼 */}
            <button
              onClick={handleBackspace}
              className="w-16 h-16 bg-yellow-500/80 hover:bg-yellow-500 text-white text-xl font-bold rounded-full border border-yellow-400/50 transition-all duration-200 hover:scale-105 active:scale-95 backdrop-blur-sm"
            >
              ←
            </button>
          </div>
        </div>

        {/* 안내 메시지 */}
        <div className="mt-8 text-white/80 text-sm space-y-2">
          <p>Enter PIN to continue</p>
          {serviceType && (
            <p className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
              serviceType === 'QSR' 
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' 
                : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
            }`}>
              <span className="w-2 h-2 rounded-full bg-current"></span>
              {serviceType === 'QSR' ? 'Quick Service Mode' : 'Full Service Mode'}
            </p>
          )}
        </div>
      </div>

      {/* Selection Modal */}
      {showSelection && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4 transform animate-pulse-once">
            <h2 className="text-2xl font-bold text-gray-800 text-center mb-6">
              Select Destination
            </h2>
            
            <div className="space-y-4">
              {/* Sales Page Button */}
              <button
                onClick={() => handleNavigate('sales')}
                className="w-full py-5 px-6 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-xl font-bold text-lg transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg flex items-center justify-center gap-3"
              >
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                <span>Sales Page</span>
                <span className="text-blue-200 text-sm ml-auto">
                  {serviceType === 'QSR' ? '(QSR)' : '(FSR)'}
                </span>
              </button>
              
              {/* Back Office Button */}
              <button
                onClick={() => handleNavigate('backoffice')}
                className="w-full py-5 px-6 bg-gradient-to-r from-slate-600 to-slate-700 hover:from-slate-700 hover:to-slate-800 text-white rounded-xl font-bold text-lg transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg flex items-center justify-center gap-3"
              >
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>Back Office</span>
              </button>
            </div>
            
            {/* Cancel */}
            <button
              onClick={() => {
                setShowSelection(false);
                setPin('');
              }}
              className="w-full mt-4 py-3 text-gray-500 hover:text-gray-700 font-medium transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default IntroPage; 