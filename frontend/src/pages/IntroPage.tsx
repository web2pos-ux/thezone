import React, { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAPI_BASE } from '../config/constants';

/** 인트로에서 BackOffice / Sales 공통 PIN (고정) */
const INTRO_PIN = '0888';

const getStoredOperationMode = (): 'QSR' | 'FSR' => {
  try {
    const raw = localStorage.getItem('pos_setup_config');
    if (!raw) return 'FSR';
    const parsed = JSON.parse(raw) as { operationMode?: 'QSR' | 'FSR' };
    return parsed?.operationMode === 'QSR' ? 'QSR' : 'FSR';
  } catch {
    return 'FSR';
  }
};

const IntroPage: React.FC = () => {
  const navigate = useNavigate();
  /** PIN 검증은 고정값만 사용하지만, 다른 화면과 동일하게 API base는 유지 */
  void getAPI_BASE();
  const targetPath = getStoredOperationMode() === 'QSR' ? '/qsr' : '/sales';

  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');

  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleLogoDown = useCallback(() => {
    longPressTimerRef.current = setTimeout(() => {
      navigate('/dealer-settings');
    }, 5000);
  }, [navigate]);
  const handleLogoUp = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleNumber = (num: string) => {
    if (pin.length < 4) {
      setPin(pin + num);
      setPinError('');
    }
  };

  const handleClear = () => {
    setPin('');
    setPinError('');
  };

  const handleBackspace = () => {
    setPin(pin.slice(0, -1));
    setPinError('');
  };

  // PIN verification (Sales) — 인트로 고정 PIN 0888만 허용
  const verifySalesPin = async (): Promise<boolean> => {
    if (pin.length !== 4) {
      setPinError('Please enter 4-digit PIN');
      return false;
    }
    if (pin !== INTRO_PIN) {
      setPinError('PIN must be 0888');
      return false;
    }
    return true;
  };

  // PIN verification (BackOffice) — 인트로 고정 PIN 0888만 허용
  const verifyBackOfficePin = async (): Promise<boolean> => {
    if (pin.length !== 4) {
      setPinError('Please enter 4-digit PIN');
      return false;
    }
    if (pin !== INTRO_PIN) {
      setPinError('PIN must be 0888');
      return false;
    }
    return true;
  };

  const goToBackOffice = async () => {
    const valid = await verifyBackOfficePin();
    if (valid) navigate('/backoffice');
  };

  const goToSales = async () => {
    const valid = await verifySalesPin();
    if (valid) navigate(targetPath);
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{
        backgroundImage: 'url(/images/intro.png)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {/* Blur Overlay */}
      <div className="absolute inset-0 backdrop-blur-md bg-black/40"></div>

      <div className="relative z-10 text-center">
        {/* Logo + Title */}
        <div className="relative inline-block">
          <img
            src="/images/logo.png"
            alt="Logo"
            className="w-16 h-16 mx-auto mb-2 object-contain select-none cursor-pointer"
            draggable={false}
            onMouseDown={handleLogoDown}
            onMouseUp={handleLogoUp}
            onMouseLeave={handleLogoUp}
            onTouchStart={handleLogoDown}
            onTouchEnd={handleLogoUp}
          />
        </div>
        <h1 className="text-[2.5rem] leading-tight text-white mb-1" style={{ fontFamily: "'Lora', Georgia, serif", fontWeight: 700 }}>
          ThezonePOS
        </h1>
        <p className="text-xl text-sky-400 mb-8 italic font-bold">One Touch, So Much</p>

        {/* PIN Dots */}
        <div className="flex justify-center gap-3 mb-0.5">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`w-5 h-5 rounded-full border-2 ${pin.length > i ? 'bg-white border-white' : 'border-gray-400'}`}
            />
          ))}
        </div>

        {/* PIN Error Message (space reserved so layout doesn't jump) */}
        <div className="min-h-[14px] mb-0.5 flex items-center justify-center">
          {pinError && <p className="text-red-400 text-sm leading-tight">{pinError}</p>}
        </div>

        {/* PIN Pad */}
        <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 inline-block border border-white/20 -mt-1">
          <div className="grid grid-cols-3 gap-3 mb-3">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
              <button
                key={num}
                onClick={() => handleNumber(num)}
                className="w-[57px] h-[57px] rounded-full bg-white/10 hover:bg-white/20 border border-white/30 text-white text-2xl font-semibold transition-all active:scale-95"
              >
                {num}
              </button>
            ))}
            <button
              onClick={handleClear}
              className="w-[57px] h-[57px] rounded-full bg-red-500 hover:bg-red-600 text-white text-sm font-bold transition-all active:scale-95"
            >
              Clear
            </button>
            <button
              onClick={() => handleNumber('0')}
              className="w-[57px] h-[57px] rounded-full bg-white/10 hover:bg-white/20 border border-white/30 text-white text-2xl font-semibold transition-all active:scale-95"
            >
              0
            </button>
            <button
              onClick={handleBackspace}
              className="w-[57px] h-[57px] rounded-full bg-yellow-500 hover:bg-yellow-600 text-white text-2xl font-bold transition-all active:scale-95"
            >
              ←
            </button>
          </div>

          {/* Divider */}
          <div className="border-t border-white/20 my-2"></div>

          {/* Navigation Buttons - BackOffice 1/3, Sales 2/3 */}
          <div className="flex gap-2">
            <button
              onClick={goToBackOffice}
              className="w-1/3 px-2 bg-white/10 hover:bg-white/20 border border-white/30 rounded-lg text-gray-300 transition-all flex flex-row items-center justify-center gap-1.5 leading-tight py-1"
              style={{ minHeight: '43px' }}
            >
              <span className="text-base shrink-0" aria-hidden>⚙️</span>
              <span className="text-sm font-medium text-left">
                <span className="block leading-tight">Back</span>
                <span className="block leading-tight">Office</span>
              </span>
            </button>
            <button
              onClick={goToSales}
              className="w-2/3 px-4 bg-white/10 hover:bg-white/20 border border-white/30 rounded-lg text-gray-300 text-sm font-medium transition-all flex items-center justify-center gap-2"
              style={{ height: '43px' }}
            >
              <span>📋</span> Sales
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default IntroPage;
