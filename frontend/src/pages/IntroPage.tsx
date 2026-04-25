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
import { isWeb2posDemoBuild } from '../utils/web2posDemoBuild';

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

const persistOperationMode = (operationMode: 'FSR' | 'QSR' | 'BISTRO') => {
  try {
    const existing = JSON.parse(localStorage.getItem('pos_setup_config') || '{}') as Record<string, unknown>;
    existing.operationMode = operationMode;
    localStorage.setItem('pos_setup_config', JSON.stringify(existing));
  } catch {
    localStorage.setItem('pos_setup_config', JSON.stringify({ operationMode }));
  }
};

/** 일반 모드: 설정에 따른 Sales 진입 경로 */
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
  const demo = isWeb2posDemoBuild();
  const storedMode = getStoredOperationMode();
  const targetPath = storedMode === 'QSR' ? '/qsr' : storedMode === 'BISTRO' ? '/bistro' : '/sales';

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

  const goToMode = async (operationMode: 'FSR' | 'QSR' | 'BISTRO') => {
    const valid = await verifyIntroPin();
    if (!valid) return;
    persistOperationMode(operationMode);
    if (operationMode === 'QSR') navigate('/qsr');
    else if (operationMode === 'BISTRO') navigate('/bistro');
    else navigate('/sales');
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
        <p className="text-lg text-sky-400 mb-5 italic font-bold sm:text-xl">One Touch, So Much</p>

        {/* PIN Dots */}
        <div className="flex justify-center gap-2.5 mb-0.5">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`w-4 h-4 rounded-full border-2 ${pin.length > i ? 'bg-white border-white' : 'border-gray-400'}`}
            />
          ))}
        </div>

        {/* PIN Error Message (space reserved so layout doesn't jump) */}
        <div className="min-h-[14px] mb-0.5 flex items-center justify-center">
          {pinError && <p className="text-red-400 text-sm leading-tight">{pinError}</p>}
        </div>

        {/* PIN Pad — tighter key gaps, narrower panel (same w-14 keys) */}
        <div className="bg-white/[0.08] backdrop-blur-md rounded-xl px-3 py-3 inline-flex flex-col items-stretch w-[min(100vw-2rem,13.5rem)] border border-white/15 shadow-sm -mt-0.5">
          <div className="grid grid-cols-3 gap-x-[calc(0.375rem*1.05)] gap-y-1.5 mb-2 justify-items-center">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
              <button
                key={num}
                type="button"
                onClick={() => handleNumber(num)}
                className="box-border w-14 h-14 min-w-[3.5rem] min-h-[3.5rem] rounded-full bg-white/10 hover:bg-white/18 border border-white/25 text-white text-xl font-semibold leading-none transition-all active:scale-[0.97] shadow-sm"
              >
                {num}
              </button>
            ))}
            <button
              type="button"
              onClick={handleClear}
              className="box-border w-14 h-14 min-w-[3.5rem] min-h-[3.5rem] rounded-full bg-red-500/95 hover:bg-red-600 text-white text-xs font-bold leading-tight transition-all active:scale-[0.97] px-0.5"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => handleNumber('0')}
              className="box-border w-14 h-14 min-w-[3.5rem] min-h-[3.5rem] rounded-full bg-white/10 hover:bg-white/18 border border-white/25 text-white text-xl font-semibold leading-none transition-all active:scale-[0.97]"
            >
              0
            </button>
            <button
              type="button"
              onClick={handleBackspace}
              className="box-border w-14 h-14 min-w-[3.5rem] min-h-[3.5rem] rounded-full bg-amber-500 hover:bg-amber-600 text-white text-xl font-bold leading-none transition-all active:scale-[0.97]"
            >
              ←
            </button>
          </div>

          {/* Divider */}
          <div className="border-t border-white/15 my-1.5"></div>

          {/* 데모: FSR/QSR/Bistro 선택 + Back Office 비활성 / 일반: Sales + Back Office */}
          <div className="flex flex-col gap-1.5 w-full">
            {demo ? (
              <>
                <button
                  type="button"
                  onClick={() => void goToMode('FSR')}
                  className="w-full px-2.5 py-2 bg-white/10 hover:bg-white/18 border border-white/25 rounded-md text-gray-100 text-[13px] font-semibold transition-all flex flex-row items-center justify-center gap-1.5"
                >
                  <span aria-hidden className="text-[15px]">🍽️</span>
                  FSR Mode
                </button>
                <button
                  type="button"
                  onClick={() => void goToMode('QSR')}
                  className="w-full px-2.5 py-2 bg-white/10 hover:bg-white/18 border border-white/25 rounded-md text-gray-100 text-[13px] font-semibold transition-all flex flex-row items-center justify-center gap-1.5"
                >
                  <span aria-hidden className="text-[15px]">🥤</span>
                  QSR Mode
                </button>
                <button
                  type="button"
                  onClick={() => void goToMode('BISTRO')}
                  className="w-full px-2.5 py-2 bg-white/10 hover:bg-white/18 border border-white/25 rounded-md text-gray-100 text-[13px] font-semibold transition-all flex flex-row items-center justify-center gap-1.5"
                >
                  <span aria-hidden className="text-[15px]">☕</span>
                  Bistro Mode
                </button>
                <button
                  type="button"
                  disabled
                  className="w-full px-2 py-2 bg-white/10 border border-white/25 rounded-md text-gray-300 text-[13px] font-semibold flex flex-row items-center justify-center gap-1.5 opacity-40 cursor-not-allowed"
                  style={{ minHeight: '40px' }}
                >
                  <span className="text-[15px] shrink-0" aria-hidden>⚙️</span>
                  <span className="text-[12px] font-medium text-left leading-tight">
                    <span className="block">Back</span>
                    <span className="block">Office</span>
                  </span>
                </button>
              </>
            ) : (
              <div className="grid grid-cols-3 gap-1.5 w-full">
                <button
                  type="button"
                  onClick={goToBackOffice}
                  className="col-span-1 px-1.5 py-1.5 bg-white/10 hover:bg-white/18 border border-white/25 rounded-md text-gray-300 text-[13px] font-semibold transition-all flex flex-row items-center justify-center gap-1"
                  style={{ minHeight: '40px' }}
                >
                  <span className="text-[15px] shrink-0" aria-hidden>⚙️</span>
                  <span className="text-[12px] font-medium text-left leading-tight">
                    <span className="block">Back</span>
                    <span className="block">Office</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void goToSales()}
                  className="col-span-2 px-2.5 py-1.5 bg-white/10 hover:bg-white/18 border border-white/25 rounded-md text-gray-100 text-[13px] font-semibold transition-all flex flex-row items-center justify-center gap-1.5"
                  style={{ minHeight: '40px' }}
                >
                  <span aria-hidden className="text-[15px]">📋</span>
                  Sales
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default IntroPage;
