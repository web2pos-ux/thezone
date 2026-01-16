import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings, Wifi, User, Save, RefreshCw, CheckCircle, AlertCircle, Smartphone, Lock } from 'lucide-react';

interface SetupConfig {
  posHost: string;
  serverName: string;
  serverPin: string;
  configured: boolean;
}

const STORAGE_KEY = 'handheld-pos-setup';

const HandheldSetupPage: React.FC = () => {
  const navigate = useNavigate();
  const [config, setConfig] = useState<SetupConfig>({
    posHost: '',
    serverName: '',
    serverPin: '',
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
        
        // If already configured, auto-navigate to handheld main
        if (parsed.configured && parsed.posHost && parsed.serverName) {
          setTimeout(() => {
            navigate('/handheld');
          }, 500);
        }
      } catch (e) {
        console.error('Failed to parse saved config:', e);
      }
    } else {
      // Auto-detect current host (for development on same machine)
      const currentHost = window.location.hostname;
      const apiHost = currentHost === 'localhost' 
        ? 'http://localhost:3177' 
        : `http://${currentHost}:3177`;
      setConfig(prev => ({ ...prev, posHost: apiHost }));
    }
  }, [navigate]);

  // Test connection to POS
  const testConnection = async () => {
    setConnectionStatus('testing');
    setErrorMessage('');
    
    try {
      // Test API connection
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
      setErrorMessage('Cannot connect to POS. Check the IP address and make sure POS is running.');
    }
  };

  // Save config and navigate
  const handleSave = () => {
    if (!config.posHost || !config.serverName) {
      setErrorMessage('Please fill in POS address and your name');
      return;
    }

    const configToSave = { ...config, configured: true };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configToSave));
    
    // Navigate to handheld main page
    navigate('/handheld');
  };

  // Reset configuration
  const handleReset = () => {
    if (window.confirm('Reset all settings? You will need to reconfigure this device.')) {
      localStorage.removeItem(STORAGE_KEY);
      const currentHost = window.location.hostname;
      const apiHost = currentHost === 'localhost' 
        ? 'http://localhost:3177' 
        : `http://${currentHost}:3177`;
      setConfig({
        posHost: apiHost,
        serverName: '',
        serverPin: '',
        configured: false
      });
      setConnectionStatus('idle');
      setBusinessName('');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-6 text-white">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-3 rounded-xl">
              <Smartphone className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Handheld POS Setup</h1>
              <p className="text-blue-100 text-sm">Configure this device for server ordering</p>
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="p-6 space-y-6">
          {/* POS Connection */}
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
                className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none transition-colors font-mono text-sm"
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
                Connected to POS {businessName && `- ${businessName}`}
              </p>
            )}
            {connectionStatus === 'error' && (
              <p className="text-red-600 text-sm flex items-center gap-1">
                <AlertCircle className="w-4 h-4" /> {errorMessage}
              </p>
            )}
          </div>

          {/* Server Name */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <User className="w-4 h-4" />
              Server Name (Required)
            </label>
            <input
              type="text"
              value={config.serverName}
              onChange={(e) => setConfig({ ...config, serverName: e.target.value })}
              placeholder="Enter your name"
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none transition-colors text-lg"
            />
            <p className="text-gray-500 text-xs">
              Your name will appear on orders you submit
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
              <div className="mt-3 p-4 bg-gray-50 rounded-xl space-y-3">
                <div>
                  <label className="text-sm text-gray-600 flex items-center gap-1">
                    <Lock className="w-3 h-3" /> Server PIN (Optional)
                  </label>
                  <input
                    type="password"
                    value={config.serverPin}
                    onChange={(e) => setConfig({ ...config, serverPin: e.target.value })}
                    placeholder="4-digit PIN"
                    maxLength={4}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg mt-1 font-mono"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    PIN protects this device from unauthorized use
                  </p>
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
              disabled={!config.posHost || !config.serverName || connectionStatus !== 'success'}
              className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:from-gray-300 disabled:to-gray-400 rounded-xl text-white font-bold transition-all shadow-lg hover:shadow-xl disabled:shadow-none flex items-center justify-center gap-2"
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
          <p>WEB2POS Handheld System</p>
          <p className="mt-1">Add to Home Screen for best experience</p>
        </div>
      </div>

      {/* PWA Install Hint */}
      <div className="fixed bottom-4 left-4 right-4 bg-white/95 backdrop-blur rounded-2xl shadow-xl p-4 flex items-center gap-4 max-w-md mx-auto border border-white/20">
        <div className="bg-blue-100 p-3 rounded-xl">
          <Smartphone className="w-6 h-6 text-blue-600" />
        </div>
        <div className="flex-1">
          <p className="font-semibold text-gray-800">Install as App</p>
          <p className="text-xs text-gray-500">
            iOS: Share → Add to Home Screen | Android: Menu → Add to Home
          </p>
        </div>
      </div>
    </div>
  );
};

export default HandheldSetupPage;

