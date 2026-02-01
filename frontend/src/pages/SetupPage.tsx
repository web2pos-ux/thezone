/**
 * SetupPage - Initial Setup Page
 * Firebase connection via Restaurant ID
 * QSR/FSR Mode Selection & Data Initialization
 * 
 * 저장 방식: 백엔드 DB (setup-status.json)만 사용
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// PIN Screen Component (TheZonePOS Style)
const PinScreen: React.FC<{ onPinSubmit: (pin: string) => void; targetPath: string }> = ({ onPinSubmit, targetPath }) => {
  const navigate = useNavigate();
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3177';

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

  // PIN 검증 함수 (Sales용 - 0000 허용)
  const verifySalesPin = async (): Promise<boolean> => {
    if (pin.length !== 4) {
      setPinError('Please enter 4-digit PIN');
      return false;
    }
    
    // 0000은 Sales 접근용으로 허용
    if (pin === '0000') {
      return true;
    }
    
    // 0888 (BackOffice PIN)도 Sales 접근 허용
    try {
      const response = await fetch(`${API_URL}/api/admin-settings/verify-backoffice-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      if (response.ok) {
        return true;
      }
    } catch (err) {
      // continue to employee verification
    }
    
    // Employee PIN verification
    try {
      const response = await fetch(`${API_URL}/api/employees/verify-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      const data = await response.json();
      if (data.success) {
        return true;
      }
    } catch (err) {
      // ignore
    }
    
    setPinError('Invalid PIN');
    return false;
  };

  // PIN 검증 함수 (BackOffice용 - 0888 필요, 0000 불허)
  const verifyBackOfficePin = async (): Promise<boolean> => {
    if (pin.length !== 4) {
      setPinError('Please enter 4-digit PIN');
      return false;
    }
    
    // 0000은 BackOffice 접근 불가
    if (pin === '0000') {
      setPinError('BackOffice requires PIN 0888');
      return false;
    }
    
    try {
      const response = await fetch(`${API_URL}/api/admin-settings/verify-backoffice-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      if (response.ok) {
        return true;
      } else {
        setPinError('Invalid BackOffice PIN');
        return false;
      }
    } catch (err) {
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
        backgroundImage: 'url(/images/intro.jpg)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {/* Blur Overlay */}
      <div className="absolute inset-0 backdrop-blur-md bg-black/40"></div>
      
      <div className="relative z-10 text-center">
        {/* Logo + Title */}
        <img src="/images/logo.png" alt="Logo" className="w-16 h-16 mx-auto mb-2 object-contain" />
        <h1 className="text-5xl font-bold text-white mb-1" style={{ fontFamily: 'Georgia, serif' }}>
          TheZonePOS
        </h1>
        <p className="text-xl text-sky-400 mb-8 italic">One Touch, So Much</p>

        {/* PIN Dots */}
        <div className="flex justify-center gap-3 mb-4">
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
                className="w-20 h-20 rounded-full bg-gray-400/40 hover:bg-gray-400/60 text-white text-3xl font-semibold transition-all active:scale-95"
              >
                {num}
              </button>
            ))}
            <button
              onClick={handleClear}
              className="w-20 h-20 rounded-full bg-red-500 hover:bg-red-600 text-white text-base font-bold transition-all active:scale-95"
            >
              Clear
            </button>
            <button
              onClick={() => handleNumber('0')}
              className="w-20 h-20 rounded-full bg-gray-400/40 hover:bg-gray-400/60 text-white text-3xl font-semibold transition-all active:scale-95"
            >
              0
            </button>
            <button
              onClick={handleBackspace}
              className="w-20 h-20 rounded-full bg-yellow-500 hover:bg-yellow-600 text-white text-3xl font-bold transition-all active:scale-95"
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
              className="w-1/3 py-3 px-2 bg-white/10 hover:bg-white/20 border border-white/30 rounded-lg text-gray-300 text-sm font-medium transition-all flex items-center justify-center gap-1"
            >
              <span>⚙️</span> BackOffice
            </button>
            <button
              onClick={goToSales}
              className="w-2/3 py-3 px-4 bg-white/10 hover:bg-white/20 border border-white/30 rounded-lg text-gray-300 text-sm font-medium transition-all flex items-center justify-center gap-2"
            >
              <span>📋</span> Sales
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3177';

interface RestaurantInfo {
  id: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  phone?: string;
}

type ServiceMode = 'QSR' | 'FSR';
type DataOption = 'empty' | 'cloud';

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

  // 앱 시작 시 setup 상태 확인 (백엔드 DB만 확인)
  useEffect(() => {
    const checkSetupStatus = async () => {
      try {
        const statusRes = await fetch(`${API_URL}/api/firebase-setup/status`);
        const statusPayload = await statusRes.json();
        
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
        
        // setup-status.json에서 serviceMode 직접 사용
        const currentMode = (savedServiceMode || '').toUpperCase() === 'QSR' ? 'QSR' : 'FSR';
        const path = currentMode === 'QSR' ? '/qsr' : '/sales';
        setTargetPath(path);
        setServiceMode(currentMode);
        
        // App.tsx SalesModeGate에서 사용하는 localStorage 저장
        localStorage.setItem('pos_setup_config', JSON.stringify({ operationMode: currentMode }));
        
        setStep('complete');

      } catch (err) {
        console.error('Setup check failed:', err);
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
      const response = await fetch(`${API_URL}/api/firebase-setup/verify-restaurant`, {
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
      setSetupProgress({ status: 'Preparing database...', progress: 20 });
      
      await fetch(`${API_URL}/api/firebase-setup/clear-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      setSetupProgress({ status: 'Saving restaurant info...', progress: 40 });

      const saveResponse = await fetch(`${API_URL}/api/firebase-setup/save-restaurant`, {
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

      await fetch(`${API_URL}/api/admin-settings/service-type`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Role': 'MANAGER' },
        body: JSON.stringify({ 
          serviceType: serviceMode,
          restaurantId: restaurantId.trim(),
          businessName: testResult.restaurant.name
        })
      });

      if (dataOption === 'cloud') {
        setSetupProgress({ status: 'Downloading menu from Cloud...', progress: 70 });
        
        try {
          await fetch(`${API_URL}/api/menu-sync/sync-from-firebase`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Role': 'ADMIN' },
            body: JSON.stringify({ restaurantId: restaurantId.trim() })
          });
          setSetupProgress({ status: 'Menu download complete!', progress: 90 });
        } catch (syncErr) {
          console.error('Menu sync failed:', syncErr);
        }
      } else {
        setSetupProgress({ status: 'Starting with empty database...', progress: 90 });
      }

      setSetupProgress({ status: 'Setup complete!', progress: 100 });
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      setConnectedRestaurant(testResult.restaurant);
      setTargetPath(serviceMode === 'QSR' ? '/qsr' : '/sales');
      
      // App.tsx SalesModeGate에서 사용하는 localStorage 저장
      localStorage.setItem('pos_setup_config', JSON.stringify({ operationMode: serviceMode }));
      
      setStep('complete');
      
    } catch (err: any) {
      setError(err.message || 'Setup failed.');
      setStep('setup');
    }
  };

  const handlePinSubmit = async (pin: string) => {
    // 0000은 Sales 접근용으로만 허용
    if (pin === '0000') {
      navigate(targetPath, { replace: true });
      return;
    }
    
    // BackOffice PIN 확인 (0888)
    try {
      const backofficeResponse = await fetch(`${API_URL}/api/admin-settings/verify-backoffice-pin`, {
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
      const response = await fetch(`${API_URL}/api/employees/verify-pin`, {
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
            <h1 className="text-2xl font-bold text-white mb-4">TheZonePOS</h1>
            <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin mx-auto"></div>
          </div>
        )}

        {/* Setup Step - 한 화면에 모든 옵션 */}
        {step === 'setup' && (
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 shadow-2xl border border-white/20">
            {/* Header */}
            <div className="text-center mb-5">
              <img src="/images/logo.png" alt="Logo" className="w-14 h-14 mx-auto mb-2 object-contain"/>
              <h1 className="text-2xl font-bold text-white">TheZonePOS Setup</h1>
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

            {/* Data Option */}
            <div className="mb-5">
              <label className="block text-blue-100 mb-1.5 font-medium text-sm">
                📦 Data Initialization
              </label>
              <div className="grid grid-cols-2 gap-3">
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
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-500/20 border border-red-400 rounded-lg p-3 mb-4">
                <p className="text-red-200 text-sm">{error}</p>
              </div>
            )}

            {/* Complete Button */}
            <button
              onClick={completeSetup}
              disabled={!testResult?.success}
              className={`w-full py-3.5 rounded-xl font-bold text-lg transition-all ${
                testResult?.success
                  ? 'bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white shadow-lg'
                  : 'bg-gray-500/50 text-gray-300 cursor-not-allowed'
              }`}
            >
              ✅ Complete Setup
            </button>
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
          />
        )}
      </div>
    </div>
  );
};

export default SetupPage;
