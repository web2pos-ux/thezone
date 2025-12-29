import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings, Wifi, Hash, Save, RefreshCw, CheckCircle, AlertCircle, Utensils } from 'lucide-react';

interface SetupConfig {
  posHost: string;
  storeId: string;
  tableId: string;
  configured: boolean;
}

const STORAGE_KEY = 'table-order-setup';

const TableOrderSetupPage: React.FC = () => {
  const navigate = useNavigate();
  const [config, setConfig] = useState<SetupConfig>({
    posHost: '',
    storeId: 'default',
    tableId: '',
    configured: false
  });
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Load saved config on mount
  useEffect(() => {
    const savedConfig = localStorage.getItem(STORAGE_KEY);
    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig);
        setConfig(parsed);
        
        // If already configured, auto-navigate to table order
        if (parsed.configured && parsed.posHost && parsed.tableId) {
          // Small delay to show the page briefly
          setTimeout(() => {
            navigate(`/table-order/${parsed.storeId}/${parsed.tableId}`);
          }, 500);
        }
      } catch (e) {
        console.error('Failed to parse saved config:', e);
      }
    } else {
      // Auto-detect current host
      const currentHost = window.location.origin;
      setConfig(prev => ({ ...prev, posHost: currentHost }));
    }
  }, [navigate]);

  // Test connection to POS
  const testConnection = async () => {
    setConnectionStatus('testing');
    setErrorMessage('');
    
    try {
      const response = await fetch(`${config.posHost}/api/business-profile`);
      if (response.ok) {
        setConnectionStatus('success');
      } else {
        throw new Error('Server responded with error');
      }
    } catch (error) {
      setConnectionStatus('error');
      setErrorMessage('Cannot connect to POS. Check the IP address.');
    }
  };

  // Save config and navigate
  const handleSave = () => {
    if (!config.posHost || !config.tableId) {
      setErrorMessage('Please fill in all required fields');
      return;
    }

    const configToSave = { ...config, configured: true };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configToSave));
    
    // Navigate to table order page
    navigate(`/table-order/${config.storeId}/${config.tableId}`);
  };

  // Reset configuration
  const handleReset = () => {
    if (window.confirm('Reset all settings?')) {
      localStorage.removeItem(STORAGE_KEY);
      setConfig({
        posHost: window.location.origin,
        storeId: 'default',
        tableId: '',
        configured: false
      });
      setConnectionStatus('idle');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 p-6 text-white">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-3 rounded-xl">
              <Utensils className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Table Order Setup</h1>
              <p className="text-amber-100 text-sm">Configure this device for table ordering</p>
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="p-6 space-y-6">
          {/* POS Connection */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <Wifi className="w-4 h-4" />
              POS Server Address
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={config.posHost}
                onChange={(e) => setConfig({ ...config, posHost: e.target.value })}
                placeholder="http://192.168.1.100:3088"
                className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-amber-500 focus:outline-none transition-colors"
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
                <CheckCircle className="w-4 h-4" /> Connected to POS
              </p>
            )}
            {connectionStatus === 'error' && (
              <p className="text-red-600 text-sm flex items-center gap-1">
                <AlertCircle className="w-4 h-4" /> {errorMessage}
              </p>
            )}
          </div>

          {/* Table ID */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <Hash className="w-4 h-4" />
              Table Number (Required)
            </label>
            <input
              type="text"
              value={config.tableId}
              onChange={(e) => setConfig({ ...config, tableId: e.target.value.toUpperCase() })}
              placeholder="T1, T2, A1, B3..."
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-amber-500 focus:outline-none transition-colors text-lg font-mono"
            />
            <p className="text-gray-500 text-xs">
              Enter the table ID exactly as shown in POS (e.g., T1, T2, A1)
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
                  <label className="text-sm text-gray-600">Store ID</label>
                  <input
                    type="text"
                    value={config.storeId}
                    onChange={(e) => setConfig({ ...config, storeId: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg mt-1"
                  />
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
              disabled={!config.posHost || !config.tableId}
              className="flex-1 px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:from-gray-300 disabled:to-gray-400 rounded-xl text-white font-bold transition-all shadow-lg hover:shadow-xl disabled:shadow-none flex items-center justify-center gap-2"
            >
              <Save className="w-5 h-5" />
              Save & Start
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-4 text-center text-xs text-gray-500">
          <p>WEB2POS Table Order System</p>
          <p className="mt-1">Add to Home Screen for best experience</p>
        </div>
      </div>

      {/* PWA Install Hint */}
      <div className="fixed bottom-4 left-4 right-4 bg-white rounded-2xl shadow-xl p-4 flex items-center gap-4 max-w-md mx-auto">
        <div className="bg-amber-100 p-3 rounded-xl">
          <Utensils className="w-6 h-6 text-amber-600" />
        </div>
        <div className="flex-1">
          <p className="font-semibold text-gray-800">Install as App</p>
          <p className="text-xs text-gray-500">
            iOS: Tap Share → Add to Home Screen
          </p>
        </div>
      </div>
    </div>
  );
};

export default TableOrderSetupPage;

















