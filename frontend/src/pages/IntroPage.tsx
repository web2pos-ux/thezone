import React, { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAPI_BASE } from '../config/constants';

const FETCH_TIMEOUT_MS = 5000;

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs: number = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal, cache: 'no-store' as any });
  } finally {
    window.clearTimeout(timeout);
  }
}

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
  const API_BASE = getAPI_BASE();
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

  // PIN verification (Sales - 0000 allowed)
  const verifySalesPin = async (): Promise<boolean> => {
    if (pin.length !== 4) {
      setPinError('Please enter 4-digit PIN');
      return false;
    }

    // 0000 is allowed for Sales access
    if (pin === '0000') return true;

    // 0888 (BackOffice PIN) also allowed for Sales access
    try {
      const response = await fetchWithTimeout(`${API_BASE}/api/admin-settings/verify-backoffice-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      if (response.ok) return true;
    } catch {
      // continue to employee verification
    }

    // Employee PIN verification
    try {
      const response = await fetchWithTimeout(`${API_BASE}/api/employees/verify-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const data = await response.json().catch(() => ({} as any));
      if (data.success) return true;
    } catch {
      // ignore
    }

    setPinError('Invalid PIN');
    return false;
  };

  // PIN verification (BackOffice - requires 0888, 0000 not allowed)
  const verifyBackOfficePin = async (): Promise<boolean> => {
    if (pin.length !== 4) {
      setPinError('Please enter 4-digit PIN');
      return false;
    }

    // 0000 not allowed for BackOffice access
    if (pin === '0000') {
      setPinError('BackOffice requires PIN 0888');
      return false;
    }

    try {
      const response = await fetchWithTimeout(`${API_BASE}/api/admin-settings/verify-backoffice-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      if (response.ok) return true;
      setPinError('Invalid BackOffice PIN');
      return false;
    } catch {
      setPinError('Verification failed');
      return false;
    }
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
        <h1 className="text-5xl text-white mb-1" style={{ fontFamily: "'Averia Libre', cursive", fontWeight: 700 }}>
          ThezonePOS
        </h1>
        <p className="text-xl text-sky-400 mb-8 italic">One Touch, So Much</p>

        {/* PIN Dots */}
        <div className="flex justify-center gap-3 mb-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`w-5 h-5 rounded-full border-2 ${pin.length > i ? 'bg-white border-white' : 'border-gray-400'}`}
            />
          ))}
        </div>

        {/* PIN Error Message (space reserved so layout doesn't jump) */}
        <div className="h-6 mb-4">
          {pinError && <p className="text-red-400 text-sm">{pinError}</p>}
        </div>

        {/* PIN Pad */}
        <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 inline-block border border-white/20">
          <div className="grid grid-cols-3 gap-4 mb-4">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
              <button
                key={num}
                onClick={() => handleNumber(num)}
                className="w-[76px] h-[76px] rounded-full bg-gray-400/40 hover:bg-gray-400/60 text-white text-3xl font-semibold transition-all active:scale-95"
              >
                {num}
              </button>
            ))}
            <button
              onClick={handleClear}
              className="w-[76px] h-[76px] rounded-full bg-red-500 hover:bg-red-600 text-white text-base font-bold transition-all active:scale-95"
            >
              Clear
            </button>
            <button
              onClick={() => handleNumber('0')}
              className="w-[76px] h-[76px] rounded-full bg-gray-400/40 hover:bg-gray-400/60 text-white text-3xl font-semibold transition-all active:scale-95"
            >
              0
            </button>
            <button
              onClick={handleBackspace}
              className="w-[76px] h-[76px] rounded-full bg-yellow-500 hover:bg-yellow-600 text-white text-3xl font-bold transition-all active:scale-95"
            >
              ←
            </button>
          </div>

          {/* Divider */}
          <div className="border-t border-white/20 my-4"></div>

          {/* Navigation Buttons - BackOffice 1/3, Sales 2/3 */}
          <div className="flex gap-3">
            <button
              onClick={goToBackOffice}
              className="w-1/3 px-2 bg-white/10 hover:bg-white/20 border border-white/30 rounded-lg text-gray-300 text-sm font-medium transition-all flex items-center justify-center gap-1"
              style={{ height: '57px' }}
            >
              <span>⚙️</span> BackOffice
            </button>
            <button
              onClick={goToSales}
              className="w-2/3 px-4 bg-white/10 hover:bg-white/20 border border-white/30 rounded-lg text-gray-300 text-sm font-medium transition-all flex items-center justify-center gap-2"
              style={{ height: '57px' }}
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
