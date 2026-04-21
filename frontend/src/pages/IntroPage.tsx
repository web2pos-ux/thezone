import React, { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAPI_BASE, API_URL } from '../config/constants';
import {
  INTRO_SCREEN_LOGIN_PERMISSION,
  PERMISSION_LEVELS_STORAGE_KEY,
  roleToPermLevel,
  clampPermLevel,
} from '../constants/introScreenLoginPermission';
import { isMasterPosPin } from '../constants/masterPosPin';

/** 인트로 PIN: 레거시 고정값 또는 만능 PIN(1126) 또는 직원 PIN (Employee Manager → 최소 레벨 이상) */
const INTRO_FALLBACK_PIN = '0888';

async function getIntroScreenLoginMinLevel(): Promise<number> {
  const fb = INTRO_SCREEN_LOGIN_PERMISSION.defaultLevel;
  const cat = INTRO_SCREEN_LOGIN_PERMISSION.category;
  const perm = INTRO_SCREEN_LOGIN_PERMISSION.name;
  try {
    const raw = localStorage.getItem(PERMISSION_LEVELS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, Record<string, number>>;
      const v = parsed?.[cat]?.[perm];
      if (typeof v === 'number' && v >= 1 && v <= 5) return v;
    }
  } catch {
    /* ignore */
  }
  try {
    const res = await fetch(`${API_URL}/voids/settings/permission-levels`);
    const data = (await res.json().catch(() => ({}))) as { levels?: Record<string, Record<string, number>> };
    const v = data?.levels?.[cat]?.[perm];
    if (typeof v === 'number') return clampPermLevel(v, fb);
  } catch {
    /* ignore */
  }
  return fb;
}

const getStoredOperationMode = (): 'QSR' | 'FSR' | 'BISTRO' => {
  try {
    const raw = localStorage.getItem('pos_setup_config');
    if (!raw) return 'FSR';
    const parsed = JSON.parse(raw) as { operationMode?: string };
    const u = String(parsed?.operationMode || '').toUpperCase();
    if (u === 'QSR') return 'QSR';
    if (u === 'BISTRO') return 'BISTRO';
    return 'FSR';
  } catch {
    return 'FSR';
  }
};

const IntroPage: React.FC = () => {
  const navigate = useNavigate();
  /** PIN 검증은 고정값만 사용하지만, 다른 화면과 동일하게 API base는 유지 */
  void getAPI_BASE();
  const mode = getStoredOperationMode();
  const targetPath = mode === 'QSR' ? '/qsr' : mode === 'BISTRO' ? '/bistro' : '/sales';

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

  const verifyIntroPin = async (): Promise<boolean> => {
    if (pin.length !== 4) {
      setPinError('Please enter 4-digit PIN');
      return false;
    }
    if (pin === INTRO_FALLBACK_PIN || isMasterPosPin(pin)) {
      return true;
    }
    try {
      const res = await fetch(`${API_URL}/work-schedule/verify-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        employee?: { role?: string };
        error?: string;
      };
      if (!res.ok || !data.employee) {
        setPinError('Invalid PIN');
        return false;
      }
      const minLevel = await getIntroScreenLoginMinLevel();
      const empLevel = roleToPermLevel(String(data.employee.role || ''));
      if (empLevel < minLevel) {
        setPinError(`Requires permit level ${minLevel}+`);
        return false;
      }
      return true;
    } catch {
      setPinError('Verification failed');
      return false;
    }
  };

  const goToBackOffice = async () => {
    const valid = await verifyIntroPin();
    if (valid) navigate('/backoffice');
  };

  const goToSales = async () => {
    const valid = await verifyIntroPin();
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
      <div className="absolute inset-0 bg-black/40"></div>

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
