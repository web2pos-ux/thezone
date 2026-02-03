/**
 * DealerSettingsPage - Dealer/Distributor/Admin Only
 * 
 * Settings page for dealers, distributors, and system administrators only
 * - Change Restaurant ID
 * - Switch Service Mode (QSR/FSR)
 * - Change Store Name
 * 
 * Store owners/employees cannot access
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../config/constants';

interface DealerInfo {
  success: boolean;
  role: string;
  name: string;
  dealerId?: string;
  permissions: string[];
}

interface StoreSettings {
  restaurantId: string | null;
  storeName: string | null;
  serviceMode: 'QSR' | 'FSR';
  setupCompleted: boolean;
  setupDate: string | null;
}

const DealerSettingsPage: React.FC = () => {
  const navigate = useNavigate();
  
  // Auth states
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [dealerInfo, setDealerInfo] = useState<DealerInfo | null>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  
  // Settings states
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  
  // Edit states
  const [editRestaurantId, setEditRestaurantId] = useState('');
  const [editStoreName, setEditStoreName] = useState('');
  const [editServiceMode, setEditServiceMode] = useState<'QSR' | 'FSR'>('FSR');
  const [verifyingRestaurant, setVerifyingRestaurant] = useState(false);
  const [restaurantVerified, setRestaurantVerified] = useState(false);
  const [restaurantInfo, setRestaurantInfo] = useState<{ name: string; address?: string } | null>(null);
  
  // Verify dealer PIN
  const handleVerifyPin = async () => {
    if (pin.length < 4) {
      setPinError('PIN must be at least 4 digits');
      return;
    }
    
    setIsVerifying(true);
    setPinError('');
    
    try {
      const response = await fetch(`${API_URL}/dealer-access/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setDealerInfo(data);
        setIsAuthenticated(true);
        // Store in session for API calls
        sessionStorage.setItem('dealer_pin', pin);
        sessionStorage.setItem('dealer_role', data.role);
        // Load settings
        loadSettings(data.role, pin);
      } else {
        setPinError(data.error || 'Invalid PIN');
      }
    } catch (err) {
      setPinError('Verification failed. Please try again.');
    } finally {
      setIsVerifying(false);
    }
  };
  
  // Load current settings
  const loadSettings = async (role: string, dealerPin: string) => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/dealer-access/store-settings`, {
        headers: {
          'X-Dealer-Role': role,
          'X-Dealer-Pin': dealerPin
        }
      });
      
      const data = await response.json();
      if (data.success) {
        setSettings(data.data);
        setEditRestaurantId(data.data.restaurantId || '');
        setEditStoreName(data.data.storeName || '');
        setEditServiceMode(data.data.serviceMode || 'FSR');
        if (data.data.restaurantId) {
          setRestaurantVerified(true);
        }
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to load settings' });
    } finally {
      setLoading(false);
    }
  };
  
  // Verify restaurant ID with Firebase
  const handleVerifyRestaurant = async () => {
    if (!editRestaurantId.trim()) return;
    
    setVerifyingRestaurant(true);
    setRestaurantVerified(false);
    setRestaurantInfo(null);
    
    try {
      const response = await fetch(`${API_URL}/firebase-setup/verify-restaurant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurantId: editRestaurantId.trim() })
      });
      
      const data = await response.json();
      if (data.success) {
        setRestaurantVerified(true);
        setRestaurantInfo({
          name: data.data.name,
          address: data.data.address
        });
        // Auto-fill store name if empty
        if (!editStoreName && data.data.name) {
          setEditStoreName(data.data.name);
        }
      } else {
        setMessage({ type: 'error', text: data.error || 'Restaurant not found' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to verify restaurant' });
    } finally {
      setVerifyingRestaurant(false);
    }
  };
  
  // Save settings
  const handleSaveSettings = async () => {
    if (!dealerInfo) return;
    
    const dealerPin = sessionStorage.getItem('dealer_pin');
    if (!dealerPin) {
      setMessage({ type: 'error', text: 'Session expired. Please re-authenticate.' });
      setIsAuthenticated(false);
      return;
    }
    
    // Validate restaurant ID if changed
    if (editRestaurantId !== settings?.restaurantId && !restaurantVerified) {
      setMessage({ type: 'error', text: 'Please verify the Restaurant ID first' });
      return;
    }
    
    setSaving(true);
    setMessage(null);
    
    try {
      const response = await fetch(`${API_URL}/dealer-access/store-settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dealer-Role': dealerInfo.role,
          'X-Dealer-Pin': dealerPin
        },
        body: JSON.stringify({
          restaurantId: editRestaurantId.trim() || null,
          storeName: editStoreName.trim() || null,
          serviceMode: editServiceMode
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setMessage({ 
          type: 'success', 
          text: 'Settings saved! Please restart the backend server for changes to take effect.' 
        });
        setSettings(data.data);
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to save settings' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to save settings' });
    } finally {
      setSaving(false);
    }
  };
  
  // Handle logout
  const handleLogout = () => {
    sessionStorage.removeItem('dealer_pin');
    sessionStorage.removeItem('dealer_role');
    setIsAuthenticated(false);
    setDealerInfo(null);
    setPin('');
    setSettings(null);
  };
  
  // PIN Input UI
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20 w-full max-w-md">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-purple-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-4xl">🔐</span>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Dealer Access</h1>
            <p className="text-purple-200 text-sm">
              Authorized Personnel Only<br/>
              <span className="text-purple-400 text-xs">Authorized Personnel Only</span>
            </p>
          </div>
          
          {/* PIN Input */}
          <div className="mb-6">
            <label className="block text-purple-100 mb-2 text-sm font-medium">
              Dealer PIN
            </label>
            <input
              type="password"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, ''));
                setPinError('');
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleVerifyPin()}
              placeholder="Enter your dealer PIN"
              maxLength={10}
              className="w-full px-4 py-4 bg-white/10 border border-white/30 rounded-xl text-white text-center text-2xl tracking-widest placeholder-purple-300 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-400/30"
              autoFocus
            />
            {pinError && (
              <p className="text-red-400 text-sm mt-2 text-center">{pinError}</p>
            )}
          </div>
          
          {/* Verify Button */}
          <button
            onClick={handleVerifyPin}
            disabled={isVerifying || pin.length < 4}
            className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${
              isVerifying || pin.length < 4
                ? 'bg-gray-500/50 text-gray-300 cursor-not-allowed'
                : 'bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white shadow-lg'
            }`}
          >
            {isVerifying ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                Verifying...
              </span>
            ) : (
              '🔓 Access'
            )}
          </button>
          
          {/* Back button */}
          <button
            onClick={() => navigate(-1)}
            className="w-full mt-4 py-3 bg-white/5 hover:bg-white/10 border border-white/20 rounded-xl text-purple-200 transition-all"
          >
            ← Back
          </button>
          
          {/* Warning */}
          <div className="mt-6 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
            <p className="text-yellow-200 text-xs text-center">
              ⚠️ This area is restricted to authorized dealers, distributors, and system administrators only.
              Unauthorized access attempts are logged.
            </p>
          </div>
        </div>
      </div>
    );
  }
  
  // Main Settings UI
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 shadow-xl border border-white/20 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-purple-500/20 rounded-full flex items-center justify-center">
                <span className="text-2xl">⚙️</span>
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">Store Settings</h1>
                <p className="text-purple-200 text-sm">
                  {dealerInfo?.name} 
                  <span className={`ml-2 px-2 py-0.5 rounded text-xs ${
                    dealerInfo?.role === 'SYSTEM_ADMIN' ? 'bg-red-500/30 text-red-200' :
                    dealerInfo?.role === 'DISTRIBUTOR' ? 'bg-orange-500/30 text-orange-200' :
                    'bg-blue-500/30 text-blue-200'
                  }`}>
                    {dealerInfo?.role}
                  </span>
                </p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-lg text-red-200 text-sm transition-all"
            >
              Logout
            </button>
          </div>
        </div>
        
        {/* Loading */}
        {loading ? (
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-xl border border-white/20 text-center">
            <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-white">Loading settings...</p>
          </div>
        ) : (
          <>
            {/* Message */}
            {message && (
              <div className={`mb-4 p-4 rounded-xl border ${
                message.type === 'success' 
                  ? 'bg-green-500/20 border-green-500/30 text-green-200' 
                  : 'bg-red-500/20 border-red-500/30 text-red-200'
              }`}>
                {message.type === 'success' ? '✅' : '❌'} {message.text}
              </div>
            )}
            
            {/* Current Settings */}
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 shadow-xl border border-white/20 mb-6">
              <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                📋 Current Settings
              </h2>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="p-3 bg-white/5 rounded-lg">
                  <span className="text-purple-300 block mb-1">Restaurant ID</span>
                  <span className="text-white font-mono">{settings?.restaurantId || 'Not set'}</span>
                </div>
                <div className="p-3 bg-white/5 rounded-lg">
                  <span className="text-purple-300 block mb-1">Service Mode</span>
                  <span className={`font-bold ${settings?.serviceMode === 'QSR' ? 'text-orange-400' : 'text-blue-400'}`}>
                    {settings?.serviceMode === 'QSR' ? '🍔 QSR' : '🍷 FSR'}
                  </span>
                </div>
                <div className="p-3 bg-white/5 rounded-lg col-span-2">
                  <span className="text-purple-300 block mb-1">Store Name</span>
                  <span className="text-white">{settings?.storeName || 'Not set'}</span>
                </div>
              </div>
            </div>
            
            {/* Edit Settings */}
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 shadow-xl border border-white/20">
              <h2 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                ✏️ Edit Settings
              </h2>
              
              {/* Restaurant ID */}
              <div className="mb-5">
                <label className="block text-purple-100 mb-2 text-sm font-medium">
                  🏪 Restaurant ID
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={editRestaurantId}
                    onChange={(e) => {
                      setEditRestaurantId(e.target.value);
                      setRestaurantVerified(false);
                      setRestaurantInfo(null);
                    }}
                    placeholder="Enter Restaurant ID"
                    className="flex-1 px-4 py-3 bg-white/10 border border-white/30 rounded-xl text-white font-mono placeholder-purple-300 focus:outline-none focus:border-purple-400"
                  />
                  <button
                    onClick={handleVerifyRestaurant}
                    disabled={verifyingRestaurant || !editRestaurantId.trim()}
                    className={`px-4 py-3 rounded-xl font-medium transition-all ${
                      verifyingRestaurant || !editRestaurantId.trim()
                        ? 'bg-gray-500/50 text-gray-300 cursor-not-allowed'
                        : 'bg-yellow-500 hover:bg-yellow-600 text-black'
                    }`}
                  >
                    {verifyingRestaurant ? '...' : 'Verify'}
                  </button>
                </div>
                {restaurantVerified && restaurantInfo && (
                  <div className="mt-2 p-3 bg-green-500/20 border border-green-500/30 rounded-lg">
                    <p className="text-green-200 text-sm">
                      ✅ {restaurantInfo.name}
                      {restaurantInfo.address && <span className="text-green-300 block text-xs">{restaurantInfo.address}</span>}
                    </p>
                  </div>
                )}
              </div>
              
              {/* Store Name */}
              <div className="mb-5">
                <label className="block text-purple-100 mb-2 text-sm font-medium">
                  🏷️ Store Name
                </label>
                <input
                  type="text"
                  value={editStoreName}
                  onChange={(e) => setEditStoreName(e.target.value)}
                  placeholder="Enter Store Name"
                  className="w-full px-4 py-3 bg-white/10 border border-white/30 rounded-xl text-white placeholder-purple-300 focus:outline-none focus:border-purple-400"
                />
              </div>
              
              {/* Service Mode */}
              <div className="mb-6">
                <label className="block text-purple-100 mb-2 text-sm font-medium">
                  🍽️ Service Mode
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setEditServiceMode('FSR')}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      editServiceMode === 'FSR'
                        ? 'bg-blue-500/30 border-blue-400 text-white'
                        : 'bg-white/5 border-white/20 text-purple-200 hover:bg-white/10'
                    }`}
                  >
                    <div className="text-3xl mb-2">🍷</div>
                    <div className="font-bold">FSR</div>
                    <div className="text-xs opacity-70">Full Service Restaurant</div>
                  </button>
                  
                  <button
                    onClick={() => setEditServiceMode('QSR')}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      editServiceMode === 'QSR'
                        ? 'bg-orange-500/30 border-orange-400 text-white'
                        : 'bg-white/5 border-white/20 text-purple-200 hover:bg-white/10'
                    }`}
                  >
                    <div className="text-3xl mb-2">🍔</div>
                    <div className="font-bold">QSR</div>
                    <div className="text-xs opacity-70">Quick Service Restaurant</div>
                  </button>
                </div>
              </div>
              
              {/* Save Button */}
              <button
                onClick={handleSaveSettings}
                disabled={saving}
                className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${
                  saving
                    ? 'bg-gray-500/50 text-gray-300 cursor-not-allowed'
                    : 'bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white shadow-lg'
                }`}
              >
                {saving ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                    Saving...
                  </span>
                ) : (
                  '💾 Save Changes'
                )}
              </button>
              
              {/* Warning */}
              <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <p className="text-yellow-200 text-xs">
                  ⚠️ After saving, you must restart the backend server for Firebase listeners to reconnect with the new settings.
                </p>
              </div>
            </div>
          </>
        )}
        
        {/* Back to POS */}
        <button
          onClick={() => navigate('/')}
          className="w-full mt-6 py-3 bg-white/5 hover:bg-white/10 border border-white/20 rounded-xl text-purple-200 transition-all"
        >
          ← Back to POS
        </button>
      </div>
    </div>
  );
};

export default DealerSettingsPage;
