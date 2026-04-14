/**
 * SetupPage - Initial Setup Page
 * Firebase connection via Restaurant ID
 * QSR/FSR Mode Selection & Data Initialization
 * 
 * Storage: Backend DB (setup-status.json) only
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// Backend base URL (strip trailing /api if present)
const API_BASE = (process.env.REACT_APP_API_URL || 'http://localhost:3177').replace(/\/api\/?$/, '');
const FETCH_TIMEOUT_MS = 6000;

/** Setup PIN 화면에서 BackOffice / Sales 공통 PIN (고정, Intro와 동일) */
const INTRO_PIN = '0888';

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs: number = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

// PIN Screen Component (TheZonePOS Style)
// onDealerAccess: Callback when entering dealer mode
const PinScreen: React.FC<{ 
  onPinSubmit: (pin: string) => void; 
  targetPath: string;
  onDealerAccess?: () => void;
}> = ({ onPinSubmit, targetPath, onDealerAccess }) => {
  const navigate = useNavigate();
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const API_URL = API_BASE;
  
  // 🔐 Dealer Mode States
  const [showDealerModal, setShowDealerModal] = useState(false);
  const [dealerPin, setDealerPin] = useState('');
  const [dealerPinError, setDealerPinError] = useState('');
  const [isVerifyingDealer, setIsVerifyingDealer] = useState(false);
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null);
  const [longPressProgress, setLongPressProgress] = useState(0);
  const [isLongPressing, setIsLongPressing] = useState(false);

  // Long press start (5 seconds)
  const handleLogoTouchStart = () => {
    setIsLongPressing(true);
    setLongPressProgress(0);
    
    // Progress animation (0-100 over 5 seconds)
    const progressInterval = setInterval(() => {
      setLongPressProgress(prev => {
        if (prev >= 100) {
          clearInterval(progressInterval);
          return 100;
        }
        return prev + 2; // 2% every 100ms = 5 seconds
      });
    }, 100);
    
    const timer = setTimeout(() => {
      clearInterval(progressInterval);
      setLongPressProgress(100);
      setIsLongPressing(false);
      setShowDealerModal(true);
    }, 5000);
    
    setLongPressTimer(timer);
    (window as any)._longPressProgressInterval = progressInterval;
  };
  
  const handleLogoTouchEnd = () => {
    setIsLongPressing(false);
    setLongPressProgress(0);
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
    if ((window as any)._longPressProgressInterval) {
      clearInterval((window as any)._longPressProgressInterval);
    }
  };
  
  // Verify Dealer PIN
  const verifyDealerPin = async () => {
    if (dealerPin.length < 4) {
      setDealerPinError('PIN must be at least 4 digits');
      return;
    }
    
    setIsVerifyingDealer(true);
    setDealerPinError('');
    
    try {
      const response = await fetch(`${API_URL}/dealer-access/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: dealerPin })
      });
      
      const data = await response.json();
      
      if (data.success) {
        // Dealer auth success - save to session
        sessionStorage.setItem('dealer_pin', dealerPin);
        sessionStorage.setItem('dealer_role', data.role);
        sessionStorage.setItem('dealer_name', data.name);
        setShowDealerModal(false);
        // Return to setup screen
        if (onDealerAccess) {
          onDealerAccess();
        }
      } else {
        setDealerPinError(data.error || 'Invalid Dealer PIN');
      }
    } catch (err) {
      setDealerPinError('Verification failed');
    } finally {
      setIsVerifyingDealer(false);
    }
  };

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

  // PIN verification (Sales) — 고정 PIN 0888만 허용
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

  // PIN verification (BackOffice) — 고정 PIN 0888만 허용
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
      <div className="absolute inset-0 bg-black/40"></div>
      
      <div className="relative z-10 text-center">
        {/* Logo + Title - Long press to enter dealer mode (hidden - no cursor/indicator) */}
        <div className="relative inline-block">
          <img 
            src="/images/logo.png" 
            alt="Logo" 
            className="w-16 h-16 mx-auto mb-2 object-contain select-none"
            onMouseDown={handleLogoTouchStart}
            onMouseUp={handleLogoTouchEnd}
            onMouseLeave={handleLogoTouchEnd}
            onTouchStart={handleLogoTouchStart}
            onTouchEnd={handleLogoTouchEnd}
            draggable={false}
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
              className={`w-5 h-5 rounded-full border-2 ${
                pin.length > i ? 'bg-white border-white' : 'border-gray-400'
              }`}
            />
          ))}
        </div>
        
        {/* PIN Error Message */}
        <div className="min-h-[14px] mb-0.5 flex items-center justify-center">
          {pinError && <p className="text-red-400 text-sm leading-tight">{pinError}</p>}
        </div>

        {/* PIN Pad */}
        <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 inline-block border border-white/20" style={{ marginTop: '-8px' }}>
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
      
      {/* 🔐 Dealer PIN Modal */}
      {showDealerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-gradient-to-br from-purple-900 to-slate-900 rounded-2xl p-8 shadow-2xl border border-purple-500/30 w-full max-w-sm mx-4">
            {/* Header */}
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-purple-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-4xl">🔐</span>
              </div>
              <h2 className="text-xl font-bold text-white mb-1">Dealer Access</h2>
              <p className="text-purple-300 text-sm">Authorized Personnel Only</p>
            </div>
            
            {/* Dealer PIN Input */}
            <div className="mb-4">
              <input
                type="password"
                value={dealerPin}
                onChange={(e) => {
                  setDealerPin(e.target.value.replace(/\D/g, ''));
                  setDealerPinError('');
                }}
                onKeyDown={(e) => e.key === 'Enter' && verifyDealerPin()}
                placeholder="Dealer PIN"
                maxLength={10}
                className="w-full px-4 py-4 bg-white/10 border border-purple-500/30 rounded-xl text-white text-center text-2xl tracking-widest placeholder-purple-300 focus:outline-none focus:border-purple-400"
                readOnly
              />
              {dealerPinError && (
                <p className="text-red-400 text-sm mt-2 text-center">{dealerPinError}</p>
              )}
            </div>
            
            {/* Number Pad */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                <button
                  key={num}
                  onClick={() => {
                    if (dealerPin.length < 10) {
                      setDealerPin(prev => prev + num);
                      setDealerPinError('');
                    }
                  }}
                  className="py-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-white text-xl font-bold transition-all active:scale-95"
                >
                  {num}
                </button>
              ))}
              <button
                onClick={() => setDealerPin('')}
                className="py-3 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-xl text-red-300 text-sm font-bold transition-all active:scale-95"
              >
                Clear
              </button>
              <button
                onClick={() => {
                  if (dealerPin.length < 10) {
                    setDealerPin(prev => prev + '0');
                    setDealerPinError('');
                  }
                }}
                className="py-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-white text-xl font-bold transition-all active:scale-95"
              >
                0
              </button>
              <button
                onClick={() => setDealerPin(prev => prev.slice(0, -1))}
                className="py-3 bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-500/30 rounded-xl text-yellow-300 text-sm font-bold transition-all active:scale-95"
              >
                ←
              </button>
            </div>
            
            {/* Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowDealerModal(false);
                  setDealerPin('');
                  setDealerPinError('');
                }}
                className="flex-1 py-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-gray-300 font-medium transition-all"
              >
                Cancel
              </button>
              <button
                onClick={verifyDealerPin}
                disabled={isVerifyingDealer || dealerPin.length < 4}
                className={`flex-1 py-3 rounded-xl font-bold transition-all ${
                  isVerifyingDealer || dealerPin.length < 4
                    ? 'bg-gray-500/50 text-gray-300 cursor-not-allowed'
                    : 'bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white'
                }`}
              >
                {isVerifyingDealer ? '...' : 'Access'}
              </button>
            </div>
            
            {/* Warning */}
            <p className="text-yellow-300/70 text-xs text-center mt-4">
              ⚠️ Authorized dealers only
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

const API_URL = API_BASE;

interface RestaurantInfo {
  id: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  phone?: string;
}

type ServiceMode = 'QSR' | 'FSR';
type DataOption = 'empty' | 'cloud' | 'existing';

const SetupPage: React.FC = () => {
  const navigate = useNavigate();
  
  // States
  const [step, setStep] = useState<'setup' | 'loading' | 'complete' | 'checking'>('checking');
  const [restaurantId, setRestaurantId] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; restaurant?: RestaurantInfo } | null>(null);
  const [error, setError] = useState('');
  const [connectedRestaurant, setConnectedRestaurant] = useState<RestaurantInfo | null>(null);
  
  // Options states
  const [serviceMode, setServiceMode] = useState<ServiceMode>('FSR');
  const [dataOption, setDataOption] = useState<DataOption>('empty');
  const [setupProgress, setSetupProgress] = useState({ status: '', progress: 0 });
  
  // Target path state
  const [targetPath, setTargetPath] = useState<string>('/sales');
  
  // 🔐 Dealer Mode State
  const [isDealerMode, setIsDealerMode] = useState(false);
  const [dealerTimeoutWarning, setDealerTimeoutWarning] = useState(false);
  const [dealerTimeoutSeconds, setDealerTimeoutSeconds] = useState(15);
  
  // Use ref for last activity time (no re-render on update)
  const lastActivityTimeRef = React.useRef(Date.now());
  
  // Reset activity timer on user interaction (no state update = no re-render)
  const resetActivityTimer = React.useCallback(() => {
    lastActivityTimeRef.current = Date.now();
    // Only update state if warning is shown (to dismiss it)
    if (dealerTimeoutWarning) {
      setDealerTimeoutWarning(false);
    }
  }, [dealerTimeoutWarning]);
  
  // Listen for user activity in dealer mode (optimized - no mousemove)
  useEffect(() => {
    if (!isDealerMode || step !== 'setup') return;
    
    // Only track meaningful interactions (not mousemove - too frequent)
    const events = ['mousedown', 'keydown', 'touchstart', 'click'];
    
    events.forEach(event => {
      window.addEventListener(event, resetActivityTimer);
    });
    
    return () => {
      events.forEach(event => {
        window.removeEventListener(event, resetActivityTimer);
      });
    };
  }, [isDealerMode, step, resetActivityTimer]);
  
  // Dealer mode auto-timeout (3 minutes = 180 seconds of inactivity)
  // Check every second, warning at 2:45, logout at 3:00
  useEffect(() => {
    if (!isDealerMode || step !== 'setup') {
      setDealerTimeoutWarning(false);
      return;
    }
    
    // Reset activity time when entering dealer mode
    lastActivityTimeRef.current = Date.now();
    
    const checkInterval = setInterval(() => {
      const inactiveTime = Date.now() - lastActivityTimeRef.current;
      
      // Show warning at 2:45 (165 seconds)
      if (inactiveTime >= 165000 && !dealerTimeoutWarning) {
        setDealerTimeoutWarning(true);
        setDealerTimeoutSeconds(15);
      }
      
      // Auto-logout at 3:00 (180 seconds)
      if (inactiveTime >= 180000) {
        console.log('[Dealer Mode] Auto-logout due to inactivity');
        exitDealerMode();
      }
    }, 1000);
    
    return () => clearInterval(checkInterval);
  }, [isDealerMode, step, dealerTimeoutWarning]);
  
  // Countdown timer for warning
  useEffect(() => {
    if (!dealerTimeoutWarning) return;
    
    const interval = setInterval(() => {
      setDealerTimeoutSeconds(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }, [dealerTimeoutWarning]);
  
  // Exit dealer mode (shared function)
  const exitDealerMode = () => {
    setIsDealerMode(false);
    setDealerTimeoutWarning(false);
    sessionStorage.removeItem('dealer_pin');
    sessionStorage.removeItem('dealer_role');
    sessionStorage.removeItem('dealer_name');
    setStep('complete');
  };
  
  // Enter dealer mode - load existing settings and switch to setup screen
  const handleDealerAccess = async () => {
    console.log('[Dealer Mode] Entering dealer mode...');
    setIsDealerMode(true);
    
    // Load existing settings
    try {
      const dealerPin = sessionStorage.getItem('dealer_pin');
      const dealerRole = sessionStorage.getItem('dealer_role');
      
      if (dealerPin && dealerRole) {
        const response = await fetch(`${API_URL}/dealer-access/store-settings`, {
          headers: {
            'X-Dealer-Role': dealerRole,
            'X-Dealer-Pin': dealerPin
          }
        });
        
        const data = await response.json();
        if (data.success && data.data) {
          // Load existing settings values
          if (data.data.restaurantId) {
            setRestaurantId(data.data.restaurantId);
            setTestResult({
              success: true,
              message: `Connected: ${data.data.storeName || data.data.restaurantId}`,
              restaurant: {
                id: data.data.restaurantId,
                name: data.data.storeName || 'Current Restaurant'
              }
            });
          }
          if (data.data.serviceMode) {
            setServiceMode(data.data.serviceMode as ServiceMode);
          }
          if (data.data.storeName) {
            setConnectedRestaurant({
              id: data.data.restaurantId,
              name: data.data.storeName
            });
          }
        }
      }
    } catch (err) {
      console.error('[Dealer Mode] Failed to load settings:', err);
    }
    
    // Switch to setup screen
    setStep('setup');
  };

  // Check setup status on app start (backend DB only)
  useEffect(() => {
    const checkSetupStatus = async () => {
      try {
        const statusRes = await fetchWithTimeout(`${API_URL}/firebase-setup/status`, { cache: 'no-store' as any }, 5000);
        const statusPayload = await statusRes.json().catch(() => ({} as any));
        
        if (!statusPayload.success || !statusPayload.data) {
          setStep('setup');
          return;
        }
        
        const { setupCompleted, restaurantId: savedRestaurantId, storeName, serviceMode: savedServiceMode } = statusPayload.data;

        if (!setupCompleted || !savedRestaurantId) {
          setStep('setup');
          return;
        }

        setConnectedRestaurant({
          id: savedRestaurantId,
          name: storeName || 'Connected Restaurant'
        });
        
        // Use serviceMode directly from setup-status.json
        const currentMode = (savedServiceMode || '').toUpperCase() === 'QSR' ? 'QSR' : 'FSR';
        const path = currentMode === 'QSR' ? '/qsr' : '/sales';
        setTargetPath(path);
        setServiceMode(currentMode);
        
        // Save to localStorage for App.tsx SalesModeGate
        localStorage.setItem('pos_setup_config', JSON.stringify({ operationMode: currentMode }));
        
        setStep('complete');

      } catch (err) {
        console.error('Setup check failed:', err);
        setError('Backend is not responding. Please start backend server (port 3177) and refresh.');
        setStep('setup');
      }
    };

    checkSetupStatus();
  }, []);

  // Test connection with Restaurant ID
  const testConnection = async () => {
    if (!restaurantId.trim()) {
      setError('Please enter the Restaurant ID.');
      return;
    }

    setIsTesting(true);
    setTestResult(null);
    setError('');

    try {
      const response = await fetch(`${API_URL}/firebase-setup/verify-restaurant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurantId: restaurantId.trim() })
      });

      const data = await response.json();
      
      if (data.success) {
        setTestResult({ 
          success: true, 
          message: `✅ Connected: ${data.data.name}`,
          restaurant: data.data
        });
      } else {
        setTestResult({ 
          success: false, 
          message: `❌ ${data.error}` 
        });
      }
    } catch (err) {
      setTestResult({ 
        success: false, 
        message: '❌ Connection failed' 
      });
    } finally {
      setIsTesting(false);
    }
  };

  // Complete setup
  const completeSetup = async () => {
    if (!testResult?.success || !testResult.restaurant) {
      setError('Please verify the Restaurant ID first.');
      return;
    }

    setStep('loading');
    setSetupProgress({ status: 'Initializing...', progress: 10 });
    setError('');

    try {
      // Determine if restaurant ID changed (dealer mode only)
      const isSameRestaurant = isDealerMode && connectedRestaurant?.id === restaurantId.trim();
      
      // Dealer mode + same restaurant (mode-only switch): skip clear-data to preserve settings
      // Dealer mode + different restaurant: clear data (new restaurant needs fresh DB)
      // Initial setup (non-dealer): always clear data
      if (isSameRestaurant) {
        setSetupProgress({ status: 'Switching service mode...', progress: 20 });
      } else {
        setSetupProgress({ status: 'Preparing database...', progress: 20 });
        
        await fetch(`${API_URL}/firebase-setup/clear-data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      setSetupProgress({ status: 'Saving restaurant info...', progress: 40 });

      const saveResponse = await fetch(`${API_URL}/firebase-setup/save-restaurant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          restaurantId: restaurantId.trim(),
          storeName: testResult.restaurant.name,
          serviceMode: serviceMode
        })
      });

      const saveData = await saveResponse.json();
      
      if (!saveData.success) {
        throw new Error(saveData.error || 'Failed to save settings.');
      }

      setSetupProgress({ status: 'Setting up service mode...', progress: 60 });

      await fetch(`${API_URL}/admin-settings/service-type`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Role': 'MANAGER' },
        body: JSON.stringify({ 
          serviceType: serviceMode,
          restaurantId: restaurantId.trim(),
          businessName: testResult.restaurant.name
        })
      });

      if (isSameRestaurant) {
        // Same restaurant, mode switch only - no data sync needed
        setSetupProgress({ status: 'Mode switched successfully!', progress: 90 });
      } else if (isDealerMode) {
        // Dealer mode, different restaurant - auto-download from cloud
        setSetupProgress({ status: 'Downloading menu from Cloud...', progress: 70 });
        
        try {
          await fetch(`${API_URL}/menu-sync/sync-from-firebase`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Role': 'ADMIN' },
            body: JSON.stringify({ restaurantId: restaurantId.trim() })
          });
          setSetupProgress({ status: 'Menu download complete!', progress: 90 });
        } catch (syncErr) {
          console.error('Menu sync failed:', syncErr);
        }
      } else if (dataOption === 'cloud') {
        setSetupProgress({ status: 'Downloading menu from Cloud...', progress: 70 });
        
        try {
          await fetch(`${API_URL}/menu-sync/sync-from-firebase`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Role': 'ADMIN' },
            body: JSON.stringify({ restaurantId: restaurantId.trim() })
          });
          setSetupProgress({ status: 'Menu download complete!', progress: 90 });
        } catch (syncErr) {
          console.error('Menu sync failed:', syncErr);
        }
      } else if (dataOption === 'existing') {
        setSetupProgress({ status: 'Using existing data...', progress: 90 });
      } else {
        setSetupProgress({ status: 'Starting with empty database...', progress: 90 });
      }

      setSetupProgress({ status: 'Setup complete!', progress: 100 });
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      setConnectedRestaurant(testResult.restaurant);
      setTargetPath(serviceMode === 'QSR' ? '/qsr' : '/sales');
      
      // Save to localStorage for App.tsx SalesModeGate
      localStorage.setItem('pos_setup_config', JSON.stringify({ operationMode: serviceMode }));
      
      setStep('complete');
      
    } catch (err: any) {
      setError(err.message || 'Setup failed.');
      setStep('setup');
    }
  };

  const handlePinSubmit = async (pin: string) => {
    // 0000 is only allowed for Sales access
    if (pin === '0000') {
      navigate(targetPath, { replace: true });
      return;
    }
    
    // Verify BackOffice PIN (0888)
    try {
      const backofficeResponse = await fetch(`${API_URL}/admin-settings/verify-backoffice-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      if (backofficeResponse.ok) {
        navigate(targetPath, { replace: true });
        return;
      }
    } catch (err) {
      // continue
    }
    
    // Employee PIN verification
    try {
      const response = await fetch(`${API_URL}/employees/verify-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      const data = await response.json();
      
      if (data.success) {
        navigate(targetPath, { replace: true });
      } else {
        alert('Invalid PIN. Please try again.');
      }
    } catch (err) {
      alert('Verification failed. Please try again.');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl">
        
        {/* Checking Step */}
        {step === 'checking' && (
          <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-8 shadow-2xl border border-white/20 text-center">
            <img src="/images/logo.png" alt="Logo" className="w-16 h-16 mx-auto mb-4 object-contain"/>
            <h1 className="text-lg text-white mb-4" style={{ fontFamily: "'Lora', Georgia, serif", fontWeight: 700 }}>TheZonePOS</h1>
            <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin mx-auto"></div>
            {error && <div className="mt-4 text-red-200 text-sm font-semibold">{error}</div>}
          </div>
        )}

        {/* Setup Step - All options in one screen */}
        {step === 'setup' && (
          <div className={`backdrop-blur-lg rounded-2xl p-6 shadow-2xl border ${isDealerMode ? 'bg-purple-900/30 border-purple-500/30' : 'bg-white/10 border-white/20'}`}>
            {/* Dealer Mode Banner */}
            {isDealerMode && (
              <div className="bg-purple-500/20 border border-purple-500/30 rounded-lg p-3 mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">🔐</span>
                  <div>
                    <p className="text-purple-200 font-bold text-sm">Dealer Mode</p>
                    <p className="text-purple-300 text-xs">
                      {sessionStorage.getItem('dealer_name')} ({sessionStorage.getItem('dealer_role')})
                    </p>
                  </div>
                </div>
                <button
                  onClick={exitDealerMode}
                  className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-lg text-red-200 text-xs transition-all"
                >
                  Exit
                </button>
              </div>
            )}
            
            {/* Header */}
            <div className="text-center mb-5">
              <img src="/images/logo.png" alt="Logo" className="w-14 h-14 mx-auto mb-2 object-contain"/>
              <h1 className="text-2xl font-bold text-white">
                {isDealerMode ? 'Store Settings' : 'TheZonePOS Setup'}
              </h1>
              {isDealerMode && (
                <p className="text-purple-300 text-sm mt-1">Change restaurant or service mode</p>
              )}
            </div>

            {/* Restaurant ID */}
            <div className="mb-4">
              <label className="block text-blue-100 mb-1.5 font-medium text-sm">
                🏪 Restaurant ID
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={restaurantId}
                  onChange={(e) => {
                    setRestaurantId(e.target.value);
                    setTestResult(null);
                    setError('');
                  }}
                  placeholder="Enter Restaurant ID"
                  className="w-2/3 px-3 py-4 bg-white/10 border border-white/30 rounded-lg text-white placeholder-blue-300 focus:outline-none focus:border-yellow-400 font-mono text-base"
                />
                <button
                  onClick={testConnection}
                  disabled={!restaurantId.trim() || isTesting}
                  className={`w-1/3 py-4 rounded-lg font-semibold text-base transition-all ${
                    restaurantId.trim() && !isTesting
                      ? 'bg-yellow-500 hover:bg-yellow-600 text-black'
                      : 'bg-gray-500/50 text-gray-300 cursor-not-allowed'
                  }`}
                >
                  {isTesting ? '...' : 'Verify'}
                </button>
              </div>
              {testResult && (
                <p className={`mt-1.5 text-sm ${testResult.success ? 'text-green-400' : 'text-red-400'}`}>
                  {testResult.message}
                </p>
              )}
            </div>

            {/* Service Mode */}
            <div className="mb-4">
              <label className="block text-blue-100 mb-1.5 font-medium text-sm">
                🍽️ Service Mode
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setServiceMode('FSR')}
                  className={`p-3 rounded-xl border-2 transition-all ${
                    serviceMode === 'FSR'
                      ? 'bg-blue-500/30 border-blue-400 text-white'
                      : 'bg-white/5 border-white/20 text-blue-200 hover:bg-white/10'
                  }`}
                >
                  <div className="text-2xl mb-1">🍷</div>
                  <div className="font-bold text-sm">FSR</div>
                  <div className="text-xs opacity-70">Full Service</div>
                </button>
                
                <button
                  onClick={() => setServiceMode('QSR')}
                  className={`p-3 rounded-xl border-2 transition-all ${
                    serviceMode === 'QSR'
                      ? 'bg-orange-500/30 border-orange-400 text-white'
                      : 'bg-white/5 border-white/20 text-blue-200 hover:bg-white/10'
                  }`}
                >
                  <div className="text-2xl mb-1">🍔</div>
                  <div className="font-bold text-sm">QSR</div>
                  <div className="text-xs opacity-70">Quick Service</div>
                </button>
              </div>
            </div>

            {/* Data Option - Hidden in dealer mode (preserve existing data) */}
            {!isDealerMode && (
              <div className="mb-5">
                <label className="block text-blue-100 mb-1.5 font-medium text-sm">
                  📦 Data Initialization
                </label>
                <div className="grid grid-cols-3 gap-3">
                  <button
                    onClick={() => setDataOption('empty')}
                    className={`p-3 rounded-xl border-2 transition-all ${
                      dataOption === 'empty'
                        ? 'bg-green-500/20 border-green-400 text-white'
                        : 'bg-white/5 border-white/20 text-blue-200 hover:bg-white/10'
                    }`}
                  >
                    <div className="text-2xl mb-1">📝</div>
                    <div className="font-bold text-sm">Empty Database</div>
                    <div className="text-xs opacity-70">Start from scratch</div>
                  </button>
                  
                  <button
                    onClick={() => setDataOption('cloud')}
                    className={`p-3 rounded-xl border-2 transition-all ${
                      dataOption === 'cloud'
                        ? 'bg-purple-500/20 border-purple-400 text-white'
                        : 'bg-white/5 border-white/20 text-blue-200 hover:bg-white/10'
                    }`}
                  >
                    <div className="text-2xl mb-1">☁️</div>
                    <div className="font-bold text-sm">Import from Cloud</div>
                    <div className="text-xs opacity-70">Download from Firebase</div>
                  </button>
                  
                  <button
                    onClick={() => setDataOption('existing')}
                    className={`p-3 rounded-xl border-2 transition-all ${
                      dataOption === 'existing'
                        ? 'bg-yellow-500/20 border-yellow-400 text-white'
                        : 'bg-white/5 border-white/20 text-blue-200 hover:bg-white/10'
                    }`}
                  >
                    <div className="text-2xl mb-1">💾</div>
                    <div className="font-bold text-sm">Use Existing Data</div>
                    <div className="text-xs opacity-70">Keep current database</div>
                  </button>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="bg-red-500/20 border border-red-400 rounded-lg p-3 mb-4">
                <p className="text-red-200 text-sm">{error}</p>
              </div>
            )}

            {/* Complete / Save Button */}
            <button
              onClick={completeSetup}
              disabled={!testResult?.success}
              className={`w-full py-3.5 rounded-xl font-bold text-lg transition-all ${
                testResult?.success
                  ? isDealerMode 
                    ? 'bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white shadow-lg'
                    : 'bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white shadow-lg'
                  : 'bg-gray-500/50 text-gray-300 cursor-not-allowed'
              }`}
            >
              {isDealerMode ? '💾 Save Changes' : '✅ Complete Setup'}
            </button>
            
            {/* Dealer mode notice */}
            {isDealerMode && (
              <p className="text-yellow-300/70 text-xs text-center mt-3">
                ⚠️ After saving, restart the backend server for changes to take effect.
              </p>
            )}
          </div>
        )}

        {/* Loading Step */}
        {step === 'loading' && (
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20 text-center">
            <div className="text-5xl mb-4 animate-pulse">⚙️</div>
            <h2 className="text-xl font-bold text-white mb-3">Setting Up...</h2>
            <div className="w-full bg-white/20 rounded-full h-2.5 mb-2">
              <div 
                className="bg-gradient-to-r from-blue-500 to-green-500 h-2.5 rounded-full transition-all duration-300"
                style={{ width: `${setupProgress.progress}%` }}
              />
            </div>
            <p className="text-blue-200 text-sm">{setupProgress.status}</p>
          </div>
        )}

        {/* Complete Step - PIN Input Full Screen */}
        {step === 'complete' && (
          <PinScreen 
            onPinSubmit={handlePinSubmit}
            targetPath={targetPath}
            onDealerAccess={handleDealerAccess}
          />
        )}
      </div>
      
      {/* Dealer Mode Timeout Warning Modal */}
      {dealerTimeoutWarning && isDealerMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="bg-gradient-to-br from-red-900 to-orange-900 rounded-2xl p-8 shadow-2xl border border-red-500/50 w-full max-w-sm mx-4 animate-pulse">
            <div className="text-center">
              <div className="text-6xl mb-4">⏰</div>
              <h2 className="text-xl font-bold text-white mb-2">Session Timeout</h2>
              <p className="text-red-200 mb-4">
                Auto-logout in <span className="text-3xl font-bold text-yellow-400">{dealerTimeoutSeconds}</span> seconds
              </p>
              <p className="text-red-300/70 text-sm mb-6">
                Save your changes or the session will end automatically.
              </p>
              <button
                onClick={() => {
                  // Reset activity timer
                  resetActivityTimer();
                }}
                className="w-full py-3 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white font-bold rounded-xl transition-all"
              >
                🔄 Continue Session
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SetupPage;
