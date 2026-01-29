/**
 * SetupPage - Initial Setup Page
 * Firebase connection via Restaurant ID
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3177';

interface SetupStatus {
  isFirstRun: boolean;
  setupCompleted: boolean;
  storeName: string;
  restaurantId: string | null;
  needsSetup: boolean;
}

interface RestaurantInfo {
  id: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  phone?: string;
}

const SetupPage: React.FC = () => {
  const navigate = useNavigate();
  
  // States
  const [step, setStep] = useState<'welcome' | 'connect' | 'complete'>('welcome');
  const [restaurantId, setRestaurantId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; restaurant?: RestaurantInfo } | null>(null);
  const [error, setError] = useState('');
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [connectedRestaurant, setConnectedRestaurant] = useState<RestaurantInfo | null>(null);

  // Check setup status
  useEffect(() => {
    checkSetupStatus();
  }, []);

  const checkSetupStatus = async () => {
    try {
      const response = await fetch(`${API_URL}/api/firebase-setup/status`);
      const data = await response.json();
      if (data.success) {
        setSetupStatus(data.data);
        // If already setup completed
        if (!data.data.needsSetup && data.data.restaurantId) {
          setStep('complete');
          setConnectedRestaurant({
            id: data.data.restaurantId,
            name: data.data.storeName || ''
          });
        }
      }
    } catch (err) {
      console.error('Failed to check setup status:', err);
    }
  };

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
          message: `✅ Connection successful!`,
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
        message: '❌ Server connection failed. Please check your internet connection.' 
      });
    } finally {
      setIsTesting(false);
    }
  };

  // Save setup
  const saveSetup = async () => {
    if (!testResult?.success || !testResult.restaurant) {
      setError('Please verify the connection first.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/api/firebase-setup/save-restaurant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          restaurantId: restaurantId.trim(),
          storeName: testResult.restaurant.name
        })
      });

      const data = await response.json();
      
      if (data.success) {
        setConnectedRestaurant(testResult.restaurant);
        setStep('complete');
      } else {
        setError(data.error || 'Failed to save settings.');
      }
    } catch (err) {
      setError('Server connection failed.');
    } finally {
      setIsLoading(false);
    }
  };

  // Start POS
  const startPOS = () => {
    navigate('/intro');
  };

  // Reset setup
  const resetSetup = async () => {
    if (!window.confirm('Are you sure you want to reset the setup?')) {
      return;
    }

    try {
      await fetch(`${API_URL}/api/firebase-setup/reset`, { method: 'DELETE' });
      setStep('welcome');
      setRestaurantId('');
      setTestResult(null);
      setConnectedRestaurant(null);
      setSetupStatus(null);
    } catch (err) {
      console.error('Reset failed:', err);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        
        {/* Welcome Step */}
        {step === 'welcome' && (
          <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-8 shadow-2xl border border-white/20">
            <div className="text-center mb-8">
              <div className="text-6xl mb-4">🍽️</div>
              <h1 className="text-4xl font-bold text-white mb-2">TheZonePOS</h1>
              <p className="text-blue-200 text-lg">Restaurant POS System</p>
            </div>
            
            <div className="bg-white/5 rounded-2xl p-6 mb-8">
              <h2 className="text-xl font-semibold text-white mb-4">👋 Welcome!</h2>
              <p className="text-blue-100 leading-relaxed">
                Thank you for using TheZonePOS.<br/>
                Before getting started, you need to connect your restaurant.
              </p>
            </div>

            <div className="space-y-3 mb-8">
              <div className="flex items-center text-blue-100">
                <span className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold mr-3">1</span>
                <span>Enter Restaurant ID</span>
              </div>
              <div className="flex items-center text-blue-100">
                <span className="w-8 h-8 bg-blue-500/50 rounded-full flex items-center justify-center text-white font-bold mr-3">2</span>
                <span>Verify Connection & Complete</span>
              </div>
            </div>

            <button
              onClick={() => setStep('connect')}
              className="w-full py-4 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-bold text-xl rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl"
            >
              Start Setup →
            </button>
          </div>
        )}

        {/* Connect Step */}
        {step === 'connect' && (
          <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-8 shadow-2xl border border-white/20">
            <div className="flex items-center mb-6">
              <button
                onClick={() => setStep('welcome')}
                className="text-blue-300 hover:text-white mr-4"
              >
                ← Back
              </button>
              <h2 className="text-2xl font-bold text-white">🏪 Connect Restaurant</h2>
            </div>

            <p className="text-blue-100 mb-6">
              Enter the <strong className="text-yellow-300">Restaurant ID</strong> provided by your POS vendor.
            </p>

            {/* Restaurant ID Input */}
            <div className="mb-6">
              <label className="block text-blue-100 mb-2 font-medium">
                Restaurant ID <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={restaurantId}
                onChange={(e) => {
                  setRestaurantId(e.target.value);
                  setTestResult(null);
                  setError('');
                }}
                placeholder="e.g., abc123xyz456"
                className="w-full px-4 py-4 bg-white/10 border-2 border-white/30 rounded-xl text-white text-lg placeholder-blue-300 focus:outline-none focus:border-yellow-400 transition-colors font-mono text-center tracking-wider"
              />
              <p className="text-blue-300 text-xs mt-2 text-center">
                Restaurant ID is provided by your POS vendor
              </p>
            </div>

            {/* Error Message */}
            {error && (
              <div className="bg-red-500/20 border border-red-400 rounded-xl p-4 mb-6">
                <p className="text-red-200">{error}</p>
              </div>
            )}

            {/* Test Result */}
            {testResult && (
              <div className={`rounded-xl p-4 mb-6 ${
                testResult.success 
                  ? 'bg-green-500/20 border border-green-400' 
                  : 'bg-red-500/20 border border-red-400'
              }`}>
                <p className={`font-semibold ${testResult.success ? 'text-green-200' : 'text-red-200'}`}>
                  {testResult.message}
                </p>
                {testResult.success && testResult.restaurant && (
                  <div className="mt-3 p-3 bg-white/10 rounded-lg">
                    <p className="text-white text-lg font-bold">{testResult.restaurant.name}</p>
                    {testResult.restaurant.address && (
                      <p className="text-blue-200 text-sm mt-1">
                        {testResult.restaurant.address}
                        {testResult.restaurant.city && `, ${testResult.restaurant.city}`}
                        {testResult.restaurant.state && `, ${testResult.restaurant.state}`}
                      </p>
                    )}
                    {testResult.restaurant.phone && (
                      <p className="text-blue-200 text-sm">📞 {testResult.restaurant.phone}</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Buttons */}
            <div className="flex gap-4">
              <button
                onClick={testConnection}
                disabled={!restaurantId.trim() || isTesting}
                className={`flex-1 py-3 rounded-xl font-semibold transition-all duration-200 ${
                  restaurantId.trim() && !isTesting
                    ? 'bg-yellow-500 hover:bg-yellow-600 text-black'
                    : 'bg-gray-500/50 text-gray-300 cursor-not-allowed'
                }`}
              >
                {isTesting ? 'Verifying...' : '🔍 Verify Connection'}
              </button>
              
              <button
                onClick={saveSetup}
                disabled={!testResult?.success || isLoading}
                className={`flex-1 py-3 rounded-xl font-semibold transition-all duration-200 ${
                  testResult?.success && !isLoading
                    ? 'bg-green-500 hover:bg-green-600 text-white'
                    : 'bg-gray-500/50 text-gray-300 cursor-not-allowed'
                }`}
              >
                {isLoading ? 'Saving...' : '✅ Complete Setup'}
              </button>
            </div>

            <p className="text-blue-300 text-xs mt-4 text-center">
              💡 You can complete setup after verifying the connection.
            </p>
          </div>
        )}

        {/* Complete Step */}
        {step === 'complete' && (
          <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-8 shadow-2xl border border-white/20 text-center">
            <div className="text-7xl mb-6">🎉</div>
            <h2 className="text-3xl font-bold text-white mb-4">Setup Complete!</h2>
            
            {connectedRestaurant && (
              <div className="bg-white/5 rounded-xl p-6 mb-6">
                <p className="text-xl text-white font-bold mb-2">
                  {connectedRestaurant.name}
                </p>
                <p className="text-blue-300 text-sm font-mono">
                  ID: {connectedRestaurant.id}
                </p>
              </div>
            )}

            <div className="bg-green-500/10 border border-green-400/30 rounded-xl p-6 mb-8">
              <p className="text-green-200">
                ✅ Restaurant connected successfully!<br/>
                You can now use the POS.
              </p>
            </div>

            <button
              onClick={startPOS}
              className="w-full py-4 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-bold text-xl rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl mb-4"
            >
              🚀 Start POS
            </button>

            <button
              onClick={resetSetup}
              className="text-sm text-blue-300 hover:text-white underline"
            >
              Change to another restaurant
            </button>
          </div>
        )}

        {/* Version Info */}
        <p className="text-center text-blue-400/50 text-sm mt-6">
          TheZonePOS v1.0.0
        </p>
      </div>
    </div>
  );
};

export default SetupPage;
