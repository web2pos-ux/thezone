import React, { useState, useRef, useCallback, useEffect } from 'react';
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
import type { DeviceIntroRole } from '../constants/deviceIntroSession';
import { setDeviceIntroSession } from '../constants/deviceIntroSession';

/** 인트로 PIN: 레거시 고정값 또는 만능 PIN(1126) 또는 직원 PIN (Employee Manager → 최소 레벨 이상) */
const INTRO_FALLBACK_PIN = '0888';

/** 데모 인트로: 이 10자리를 입력하면 Back Office 관련 버튼만 활성화 */
const DEMO_INTRO_BO_UNLOCK_PIN = '9998887117';

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

/** 비데모: Dealer Settings `operationMode`에 대응하는 POS 라우트 */
const getIntroNavPathForStoredOperationMode = (): '/sales' | '/qsr' | '/bistro' => {
  const mode = getStoredOperationMode();
  if (mode === 'QSR') return '/qsr';
  if (mode === 'BISTRO') return '/bistro';
  return '/sales';
};

/** 데모 인트로: 노출은 FSR / QSR / Bistro / Back Office 4개만. (BO는 9998887117 입력 시 잠금 해제) */
type IntroDemoDestination =
  | { id: string; kind: 'mode'; mode: 'FSR' | 'QSR' | 'BISTRO'; label: string; emoji: string }
  | { id: string; kind: 'path'; path: string; label: string; emoji: string };

const INTRO_DEMO_DESTINATIONS: IntroDemoDestination[] = [
  { id: 'fsr', kind: 'mode', mode: 'FSR', label: 'FSR Mode', emoji: '🍽️' },
  { id: 'qsr', kind: 'mode', mode: 'QSR', label: 'QSR Mode', emoji: '🥤' },
  { id: 'bistro', kind: 'mode', mode: 'BISTRO', label: 'Bistro Mode', emoji: '☕' },
  { id: 'bo', kind: 'path', path: '/backoffice', label: 'Back Office', emoji: '⚙️' },
];

export type IntroPageProps = {
  /** Sub POS / Handheld 전용 인트로: PIN 후 해당 모드로만 진입 */
  deviceEntry?: DeviceIntroRole | null;
};

const IntroPage: React.FC<IntroPageProps> = ({ deviceEntry = null }) => {
  const navigate = useNavigate();
  /** PIN 검증은 고정값만 사용하지만, 다른 화면과 동일하게 API base는 유지 */
  void getAPI_BASE();
  const demo = isWeb2posDemoBuild();

  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  /** 데모: DEMO_INTRO_BO_UNLOCK_PIN(9998887117) 입력 완료 후에만 Back Office 버튼 활성 */
  const [demoIntroBoUnlocked, setDemoIntroBoUnlocked] = useState(false);

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
    setPinError('');
    if (demo && !demoIntroBoUnlocked) {
      if (pin.length >= 10) return;
      const next = pin + num;
      if (next.length === 10) {
        if (next === DEMO_INTRO_BO_UNLOCK_PIN) {
          setDemoIntroBoUnlocked(true);
          setPin('');
          setPinError('');
        } else {
          setPin(next);
          setPinError('Invalid code');
        }
        return;
      }
      setPin(next);
      return;
    }
    if (pin.length < 4) {
      setPin(pin + num);
    }
  };

  const handleClear = () => {
    setPin('');
    setPinError('');
    if (demo) {
      setDemoIntroBoUnlocked(false);
    }
  };

  const handleBackspace = () => {
    setPin((p) => p.slice(0, -1));
    setPinError('');
  };

  const verifyIntroPin = useCallback(async (pinToCheck?: string): Promise<boolean> => {
    const p = pinToCheck ?? pin;
    if (p.length !== 4) {
      setPinError('Please enter 4-digit PIN');
      return false;
    }
    if (p === INTRO_FALLBACK_PIN || isMasterPosPin(p)) {
      return true;
    }
    try {
      const res = await fetch(`${API_URL}/work-schedule/verify-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: p }),
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
  }, [pin]);

  const goToBackOffice = async () => {
    const valid = await verifyIntroPin();
    if (valid) navigate('/backoffice');
  };

  const goToSalesFloor = async () => {
    const valid = await verifyIntroPin();
    if (!valid) return;
    if (deviceEntry) {
      setDeviceIntroSession(deviceEntry);
      navigate(deviceEntry === 'handheld' ? '/handheld' : '/sub-pos');
      return;
    }
    navigate(getIntroNavPathForStoredOperationMode());
  };

  /** 비데모: Dealer Settings가 저장한 `pos_setup_config.operationMode` 기준으로, PIN 4자리 검증 성공 시 즉시 POS 진입 */
  useEffect(() => {
    if (demo) return;
    if (pin.length !== 4) return;

    let cancelled = false;
    const snapshot = pin;
    void (async () => {
      const valid = await verifyIntroPin(snapshot);
      if (cancelled) return;
      if (!valid) return;
      if (deviceEntry) {
        setDeviceIntroSession(deviceEntry);
        navigate(deviceEntry === 'handheld' ? '/handheld' : '/sub-pos');
        return;
      }
      navigate(getIntroNavPathForStoredOperationMode());
    })();

    return () => {
      cancelled = true;
    };
  }, [pin, demo, navigate, verifyIntroPin, deviceEntry]);

  const runDemoDestination = async (d: IntroDemoDestination) => {
    if (d.kind === 'path') {
      if (demo) {
        if (!demoIntroBoUnlocked) return;
        navigate(d.path);
        return;
      }
    }
    const valid = await verifyIntroPin();
    if (!valid) return;
    if (deviceEntry) {
      setDeviceIntroSession(deviceEntry);
      navigate(deviceEntry === 'handheld' ? '/handheld' : '/sub-pos');
      return;
    }
    if (d.kind === 'mode') {
      persistOperationMode(d.mode);
      if (d.mode === 'QSR') navigate('/qsr');
      else if (d.mode === 'BISTRO') navigate('/bistro');
      else navigate('/sales');
    } else {
      navigate(d.path);
    }
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
        {deviceEntry === 'sub_pos' && (
          <p className="text-sm text-white/90 mb-3 font-semibold tracking-wide">Sub POS — staff PIN required</p>
        )}
        {deviceEntry === 'handheld' && (
          <p className="text-sm text-white/90 mb-3 font-semibold tracking-wide">Handheld — staff PIN required</p>
        )}

        {/* PIN Dots — 항상 4칸으로 표시(데모 BO 잠금 해제 코드는 내부적으로 최대 10자리까지 받지만 화면엔 노출하지 않음) */}
        <div className="mb-0.5 flex justify-center gap-2.5">
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              className={`rounded-full border-2 h-4 w-4 ${pin.length > i ? 'border-white bg-white' : 'border-gray-400'}`}
            />
          ))}
        </div>

        {/* PIN Error Message (space reserved so layout doesn't jump) */}
        <div className="min-h-[14px] mb-0.5 flex items-center justify-center">
          {pinError && <p className="text-red-400 text-sm leading-tight">{pinError}</p>}
        </div>

        {/* PIN Pad — same key size; panel max-width +10%, gaps slightly wider */}
        <div className="bg-white/[0.08] backdrop-blur-md rounded-xl px-3 py-3 inline-flex flex-col items-stretch w-[min(100vw-2rem,14.85rem)] border border-white/15 shadow-sm -mt-0.5">
          <div className="grid grid-cols-3 gap-x-2 gap-y-2 mb-2 justify-items-center">
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

          {/* 데모: FSR / QSR / Bistro / Back Office 4버튼만 노출 (BO는 9998887117 입력 시 활성화) / 비데모: Back Office(너비 1) + Sales(너비 2) */}
          <div className="flex flex-col gap-1.5 w-full">
            {demo ? (
              <>
                {INTRO_DEMO_DESTINATIONS.map((d) => {
                  const boLocked = d.kind === 'path' && !demoIntroBoUnlocked;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      disabled={boLocked}
                      onClick={() => void runDemoDestination(d)}
                      className={`w-full px-2.5 py-2 border border-white/25 rounded-md text-gray-100 text-[13px] font-semibold transition-all flex flex-row items-center justify-center gap-1.5 ${
                        boLocked
                          ? 'cursor-not-allowed bg-white/5 opacity-40'
                          : 'bg-white/10 hover:bg-white/18'
                      }`}
                    >
                      <span aria-hidden className="text-[15px]">
                        {d.emoji}
                      </span>
                      {d.label}
                    </button>
                  );
                })}
              </>
            ) : (
              <div className="flex flex-row gap-1.5 w-full items-stretch">
                <button
                  type="button"
                  onClick={() => void goToBackOffice()}
                  title="Back Office"
                  className="flex-[1] min-w-0 px-1 py-2 bg-white/10 hover:bg-white/18 border border-white/25 rounded-md text-gray-300 text-[10px] font-semibold transition-all flex flex-col items-center justify-center gap-0.5 leading-tight"
                  style={{ minHeight: '40px' }}
                >
                  <span className="text-[14px] shrink-0 leading-none" aria-hidden>
                    ⚙️
                  </span>
                  <span className="text-center px-0.5">
                    <span className="block">Back</span>
                    <span className="block">Office</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void goToSalesFloor()}
                  className="flex-[2] min-w-0 px-2 py-2 bg-white/10 hover:bg-white/18 border border-white/25 rounded-md text-gray-100 text-[13px] font-semibold transition-all flex flex-row items-center justify-center gap-1.5"
                  style={{ minHeight: '40px' }}
                >
                  <span className="text-[15px] shrink-0" aria-hidden>
                    💳
                  </span>
                  <span>{deviceEntry === 'handheld' ? 'Handheld' : deviceEntry === 'sub_pos' ? 'Sub POS' : 'Sales'}</span>
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
