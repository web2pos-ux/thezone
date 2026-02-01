import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../config/constants';

const IntroPage: React.FC = () => {
  const [pin, setPin] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [serviceType, setServiceType] = useState<string | null>(null);
  const [pinVerified, setPinVerified] = useState(false);
  const navigate = useNavigate();

  // Load service type on mount (setup already completed if we're here)
  useEffect(() => {
    const loadServiceType = async () => {
      try {
        const response = await fetch(`${API_URL}/admin-settings/service-type`);
        if (response.ok) {
          const data = await response.json();
          if (data.serviceType) {
            setServiceType(data.serviceType);
          }
        }
      } catch (error) {
        console.error('Failed to load service type:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadServiceType();
  }, []);

  const handlePinInput = (digit: string) => {
    if (pin.length < 4) {
      const newPin = pin + digit;
      setPin(newPin);
      
      if (newPin.length === 4) {
        handlePinSubmit(newPin);
      }
    }
  };

  const handlePinSubmit = async (submittedPin: string) => {
    // Sales PIN (0000) is allowed for sales access
    if (submittedPin === '0000') {
      setPinVerified(true);
      setMessage('');
      // Store that this is a sales-only PIN
      sessionStorage.setItem('pin_type', 'sales');
      return;
    }
    
    // Check if it's the BackOffice PIN (0888)
    try {
      const response = await fetch(`${API_URL}/api/admin-settings/verify-backoffice-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: submittedPin })
      });
      
      if (response.ok) {
        setPinVerified(true);
        setMessage('');
        // Store that this is a backoffice PIN
        sessionStorage.setItem('pin_type', 'backoffice');
        return;
      }
    } catch (error) {
      console.error('PIN verification failed:', error);
    }
    
    // Invalid PIN
    setMessage('Invalid PIN. Please try again.');
    setPinVerified(false);
    setTimeout(() => {
      setPin('');
      setMessage('');
    }, 2000);
  };

  const handleNavigate = async (destination: 'sales' | 'backoffice') => {
    if (!pinVerified) return;
    
    // Check if trying to access backoffice with sales PIN (0000)
    const pinType = sessionStorage.getItem('pin_type');
    if (destination === 'backoffice' && pinType === 'sales') {
      setMessage('BackOffice requires different PIN (0888)');
      setTimeout(() => setMessage(''), 3000);
      return;
    }
    
    if (destination === 'sales') {
      // If serviceType is not loaded, fetch it again
      let currentServiceType = serviceType;
      if (!currentServiceType) {
        try {
          const response = await fetch(`${API_URL}/admin-settings/service-type`);
          if (response.ok) {
            const data = await response.json();
            currentServiceType = data.serviceType;
            setServiceType(data.serviceType);
          }
        } catch (error) {
          console.error('Failed to fetch service type:', error);
        }
      }
      
      if (currentServiceType === 'QSR') {
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
    setPinVerified(false);
  };

  const handleBackspace = () => {
    setPin(prev => prev.slice(0, -1));
    if (pinVerified) {
      setPinVerified(false);
      setMessage('');
    }
  };

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
                    ? pinVerified 
                      ? 'bg-green-400 border-green-400' 
                      : 'bg-white border-white'
                    : 'border-white/50'
                }`}
              />
            ))}
          </div>
          {message && (
            <p className={`text-lg font-medium ${pinVerified ? 'text-green-300' : 'text-red-300'}`}>
              {message}
            </p>
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
                disabled={pinVerified}
                className={`w-16 h-16 text-white text-2xl font-bold rounded-full border transition-all duration-200 backdrop-blur-sm ${
                  pinVerified 
                    ? 'bg-white/10 border-white/20 opacity-50 cursor-not-allowed' 
                    : 'bg-white/20 hover:bg-white/30 border-white/30 hover:scale-105 active:scale-95'
                }`}
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
              disabled={pinVerified}
              className={`w-16 h-16 text-white text-2xl font-bold rounded-full border transition-all duration-200 backdrop-blur-sm ${
                pinVerified 
                  ? 'bg-white/10 border-white/20 opacity-50 cursor-not-allowed' 
                  : 'bg-white/20 hover:bg-white/30 border-white/30 hover:scale-105 active:scale-95'
              }`}
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

          {/* 구분선 */}
          <div className="my-5 border-t border-white/20"></div>

          {/* BackOffice / Sales 버튼 (4:6 비율) */}
          <div className="flex gap-3 justify-center w-full">
            <button
              onClick={() => handleNavigate('backoffice')}
              disabled={!pinVerified}
              className={`w-2/5 py-3 rounded-xl font-semibold text-sm transition-all transform shadow-lg backdrop-blur-sm flex items-center justify-center gap-2 ${
                pinVerified
                  ? 'bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 text-white border border-purple-400/50 hover:scale-[1.02] active:scale-95 animate-pulse'
                  : 'bg-white/10 text-white/40 border border-white/10 cursor-not-allowed'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>BackOffice</span>
            </button>
            
            <button
              onClick={() => handleNavigate('sales')}
              disabled={!pinVerified}
              className={`w-3/5 py-3 rounded-xl font-semibold text-sm transition-all transform shadow-lg backdrop-blur-sm flex items-center justify-center gap-2 ${
                pinVerified
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white border border-cyan-400/50 hover:scale-[1.02] active:scale-95 animate-pulse'
                  : 'bg-white/10 text-white/40 border border-white/10 cursor-not-allowed'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              <span>Sales</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default IntroPage; 
