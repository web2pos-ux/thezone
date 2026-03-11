import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings, Wifi, Monitor, Save, RefreshCw, CheckCircle, AlertCircle, Printer, Hash } from 'lucide-react';

interface SetupConfig {
  posHost: string;
  deviceName: string;
  deviceId: string;
  printerEnabled: boolean;
  configured: boolean;
}

const STORAGE_KEY = 'sub-pos-setup';
const SUB_POS_MODE_KEY = 'sub-pos-mode-active';
const HANDHELD_MODE_KEY = 'handheld-mode-active';

function activateSubPosMode(config: SetupConfig) {
  localStorage.setItem(SUB_POS_MODE_KEY, JSON.stringify({
    active: true,
    posHost: config.posHost,
    deviceName: config.deviceName,
    deviceId: config.deviceId,
  }));
  localStorage.setItem(HANDHELD_MODE_KEY, JSON.stringify({
    active: true,
    posHost: config.posHost,
  }));
}

const SubPosSetupPage: React.FC = () => {
  const navigate = useNavigate();
  const [config, setConfig] = useState<SetupConfig>({
    posHost: '',
    deviceName: '',
    deviceId: '',
    printerEnabled: false,
    configured: false
  });
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [businessName, setBusinessName] = useState('');

  // Load saved config on mount
  useEffect(() => {
    const savedConfig = localStorage.getItem(STORAGE_KEY);
    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig);
        setConfig(parsed);
        
        // If already configured, auto-navigate to sub pos main
        if (parsed.configured && parsed.posHost && parsed.deviceName) {
          activateSubPosMode(parsed);
          setTimeout(() => navigate('/sales', { replace: true }), 300);
        }
      } catch (e) {
        console.error('Failed to parse saved config:', e);
      }
    } else {
      // Auto-detect current host
      const currentHost = window.location.hostname;
      const apiHost = currentHost === 'localhost' 
        ? 'http://localhost:3177' 
        : `http://${currentHost}:3177`;
      
      // Generate device ID
      const deviceId = `SUB-${Date.now().toString(36).toUpperCase()}`;
      
      setConfig(prev => ({ ...prev, posHost: apiHost, deviceId }));
    }
  }, [navigate]);

  // Test connection to Main POS
  const testConnection = async () => {
    setConnectionStatus('testing');
    setErrorMessage('');
    
    try {
      const response = await fetch(`${config.posHost}/ping`);
      if (response.ok) {
        setConnectionStatus('success');
        
        // Try to get business name
        try {
          const profileRes = await fetch(`${config.posHost}/api/admin-settings`);
          if (profileRes.ok) {
            const profile = await profileRes.json();
            setBusinessName(profile.business_name || '');
          }
        } catch (e) {
          // Ignore if business profile doesn't exist
        }
      } else {
        throw new Error('Server responded with error');
      }
    } catch (error) {
      setConnectionStatus('error');
      setErrorMessage('Cannot connect to Main POS. Check the IP address and make sure Main POS is running.');
    }
  };

  // Save config and navigate
  const handleSave = () => {
    if (!config.posHost || !config.deviceName) {
      setErrorMessage('Please fill in Main POS address and device name');
      return;
    }

    const configToSave = { ...config, configured: true };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configToSave));
    activateSubPosMode(configToSave);
    navigate('/sales', { replace: true });
  };

  // Reset configuration
  const handleReset = () => {
    if (window.confirm('Reset all settings? You will need to reconfigure this device.')) {
      localStorage.removeItem(STORAGE_KEY);
      const currentHost = window.location.hostname;
      const apiHost = currentHost === 'localhost' 
        ? 'http://localhost:3177' 
        : `http://${currentHost}:3177`;
      const deviceId = `SUB-${Date.now().toString(36).toUpperCase()}`;
      
      setConfig({
        posHost: apiHost,
        deviceName: '',
        deviceId,
        printerEnabled: false,
        configured: false
      });
      setConnectionStatus('idle');
      setBusinessName('');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-900 via-teal-900 to-cyan-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 p-6 text-white">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-3 rounded-xl">
              <Monitor className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Sub POS Setup</h1>
              <p className="text-emerald-100 text-sm">Configure this device as a secondary POS station</p>
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="p-6 space-y-6">
          {/* Main POS Connection */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <Wifi className="w-4 h-4" />
              Main POS Server Address
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={config.posHost}
                onChange={(e) => setConfig({ ...config, posHost: e.target.value })}
                placeholder="http://192.168.1.100:3177"
                className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-emerald-500 focus:outline-none transition-colors font-mono text-sm"
              />
              <button
                onClick={testConnection}
                disabled={connectionStatus === 'testing'}
                className="px-4 py-3 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors disabled:opacity-50"
              >
                {connectionStatus === 'testing' ? (
                  <RefreshCw className="w-5 h-5 animate-spin" />
                ) : connectionStatus === 'success' ? (
                  <CheckCircle className="w-5 h-5 text-green-500" />
                ) : connectionStatus === 'error' ? (
                  <AlertCircle className="w-5 h-5 text-red-500" />
                ) : (
                  <Wifi className="w-5 h-5" />
                )}
              </button>
            </div>
            {connectionStatus === 'success' && (
              <p className="text-green-600 text-sm flex items-center gap-1">
                <CheckCircle className="w-4 h-4" /> 
                Connected to Main POS {businessName && `- ${businessName}`}
              </p>
            )}
            {connectionStatus === 'error' && (
              <p className="text-red-600 text-sm flex items-center gap-1">
                <AlertCircle className="w-4 h-4" /> {errorMessage}
              </p>
            )}
          </div>

          {/* Device Name */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <Monitor className="w-4 h-4" />
              Device Name (Required)
            </label>
            <input
              type="text"
              value={config.deviceName}
              onChange={(e) => setConfig({ ...config, deviceName: e.target.value })}
              placeholder="Counter 2, Bar, Patio POS..."
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-emerald-500 focus:outline-none transition-colors text-lg"
            />
            <p className="text-gray-500 text-xs">
              Give this POS station a descriptive name
            </p>
          </div>

          {/* Advanced Settings */}
          <div>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
            >
              <Settings className="w-4 h-4" />
              {showAdvanced ? 'Hide' : 'Show'} Advanced Settings
            </button>
            
            {showAdvanced && (
              <div className="mt-3 p-4 bg-gray-50 rounded-xl space-y-4">
                <div>
                  <label className="text-sm text-gray-600 flex items-center gap-1">
                    <Hash className="w-3 h-3" /> Device ID
                  </label>
                  <input
                    type="text"
                    value={config.deviceId}
                    readOnly
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg mt-1 font-mono text-sm bg-gray-100"
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Printer className="w-4 h-4 text-gray-500" />
                    <span className="text-sm text-gray-600">Local Receipt Printer</span>
                  </div>
                  <button
                    onClick={() => setConfig({ ...config, printerEnabled: !config.printerEnabled })}
                    className={`w-12 h-6 rounded-full transition-colors ${
                      config.printerEnabled ? 'bg-emerald-500' : 'bg-gray-300'
                    }`}
                  >
                    <div className={`w-5 h-5 bg-white rounded-full shadow transform transition-transform ${
                      config.printerEnabled ? 'translate-x-6' : 'translate-x-0.5'
                    }`} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Error Message */}
          {errorMessage && connectionStatus !== 'error' && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-600 text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              {errorMessage}
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3 pt-4">
            <button
              onClick={handleReset}
              className="px-6 py-3 bg-gray-100 hover:bg-gray-200 rounded-xl text-gray-700 font-medium transition-colors"
            >
              Reset
            </button>
            <button
              onClick={handleSave}
              disabled={!config.posHost || !config.deviceName || connectionStatus !== 'success'}
              className="flex-1 px-6 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:from-gray-300 disabled:to-gray-400 rounded-xl text-white font-bold transition-all shadow-lg hover:shadow-xl disabled:shadow-none flex items-center justify-center gap-2"
            >
              <Save className="w-5 h-5" />
              Save & Start
            </button>
          </div>
          
          {connectionStatus !== 'success' && (
            <p className="text-center text-gray-400 text-sm">
              Test connection before saving
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-4 text-center text-xs text-gray-500">
          <p>WEB2POS Sub POS System</p>
          <p className="mt-1">Full POS functionality with Main POS sync</p>
        </div>
      </div>

      {/* Info Card */}
      <div className="fixed bottom-4 left-4 right-4 bg-white/95 backdrop-blur rounded-2xl shadow-xl p-4 flex items-center gap-4 max-w-md mx-auto border border-white/20">
        <div className="bg-emerald-100 p-3 rounded-xl">
          <Monitor className="w-6 h-6 text-emerald-600" />
        </div>
        <div className="flex-1">
          <p className="font-semibold text-gray-800">Sub POS Capabilities</p>
          <p className="text-xs text-gray-500">
            Orders • Payments • Table Management • Real-time Sync
          </p>
        </div>
      </div>
    </div>
  );
};

export default SubPosSetupPage;

