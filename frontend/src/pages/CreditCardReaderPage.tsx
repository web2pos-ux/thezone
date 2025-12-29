import React, { useState, useEffect } from 'react';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3177/api';

interface CreditCardReaderSettings {
  integrationMode: 'integrated' | 'standalone';
  terminalType: string;
  terminalId: string;
  merchantId: string;
  apiKey: string;
  apiEndpoint: string;
  connectionPort: string;
  timeout: number;
}

const CreditCardReaderPage = () => {
  const [settings, setSettings] = useState<CreditCardReaderSettings>({
    integrationMode: 'standalone',
    terminalType: '',
    terminalId: '',
    merchantId: '',
    apiKey: '',
    apiEndpoint: '',
    connectionPort: '',
    timeout: 30
  });
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await fetch(`${API_URL}/settings/hardware/credit-card`);
        if (response.ok) {
          const data = await response.json();
          if (data.settings) {
            setSettings(data.settings);
          }
        }
      } catch (error) {
        console.error('Failed to load credit card settings:', error);
      }
    };
    loadSettings();
  }, []);

  // Save settings
  const handleSaveSettings = async () => {
    setSaveStatus('saving');
    try {
      const response = await fetch(`${API_URL}/settings/hardware/credit-card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings })
      });
      if (response.ok) {
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } else {
        setSaveStatus('error');
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
      setSaveStatus('error');
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Credit Card Reader</h1>
          <p className="text-gray-600 mt-1">Configure credit card terminal integration</p>
        </div>
        <div className="flex items-center gap-3">
          {saveStatus === 'saved' && (
            <span className="text-green-600 font-medium">✓ Saved</span>
          )}
          {saveStatus === 'error' && (
            <span className="text-red-600 font-medium">Error saving</span>
          )}
          <button
            onClick={handleSaveSettings}
            disabled={saveStatus === 'saving'}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-400 transition-all"
          >
            {saveStatus === 'saving' ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6">
        {/* Integration Mode Selection */}
        <div className="mb-8">
          <label className="block text-sm font-semibold text-gray-700 mb-3">Integration Mode</label>
          <div className="grid grid-cols-2 gap-4">
            {/* Standalone (Non-Integrated) */}
            <div
              onClick={() => setSettings({ ...settings, integrationMode: 'standalone' })}
              className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                settings.integrationMode === 'standalone'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300 bg-white'
              }`}
            >
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  settings.integrationMode === 'standalone'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-200 text-gray-600'
                }`}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-lg text-gray-800">Standalone (Non-Integrated)</h3>
                </div>
                {settings.integrationMode === 'standalone' && (
                  <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </div>
            </div>

            {/* Integrated */}
            <div
              onClick={() => setSettings({ ...settings, integrationMode: 'integrated' })}
              className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                settings.integrationMode === 'integrated'
                  ? 'border-green-500 bg-green-50'
                  : 'border-gray-200 hover:border-gray-300 bg-white'
              }`}
            >
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  settings.integrationMode === 'integrated'
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-200 text-gray-600'
                }`}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-lg text-gray-800">Integrated Terminal</h3>
                </div>
                {settings.integrationMode === 'integrated' && (
                  <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Integrated Mode Settings */}
        {settings.integrationMode === 'integrated' && (
          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4">Terminal Configuration</h3>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
              <div className="flex items-center gap-2 text-yellow-800">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span className="font-semibold">Configuration Required</span>
              </div>
              <p className="text-yellow-700 text-sm mt-1">
                Please configure the terminal settings below to enable integrated payments.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-6">
              {/* Terminal Type */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Terminal Type</label>
                <select
                  value={settings.terminalType}
                  onChange={(e) => setSettings({ ...settings, terminalType: e.target.value })}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Select Terminal Type</option>
                  <option value="ingenico">Ingenico</option>
                  <option value="verifone">Verifone</option>
                  <option value="pax">PAX</option>
                  <option value="clover">Clover</option>
                  <option value="square">Square</option>
                  <option value="stripe">Stripe Terminal</option>
                  <option value="other">Other</option>
                </select>
              </div>

              {/* Terminal ID */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Terminal ID</label>
                <input
                  type="text"
                  value={settings.terminalId}
                  onChange={(e) => setSettings({ ...settings, terminalId: e.target.value })}
                  placeholder="Enter Terminal ID"
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                />
              </div>

              {/* Merchant ID */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Merchant ID</label>
                <input
                  type="text"
                  value={settings.merchantId}
                  onChange={(e) => setSettings({ ...settings, merchantId: e.target.value })}
                  placeholder="Enter Merchant ID"
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                />
              </div>

              {/* API Key */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">API Key</label>
                <input
                  type="password"
                  value={settings.apiKey}
                  onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
                  placeholder="Enter API Key"
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                />
              </div>

              {/* API Endpoint */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">API Endpoint URL</label>
                <input
                  type="text"
                  value={settings.apiEndpoint}
                  onChange={(e) => setSettings({ ...settings, apiEndpoint: e.target.value })}
                  placeholder="https://api.terminal.com/v1"
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                />
              </div>

              {/* Connection Port */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Connection Port (Optional)</label>
                <input
                  type="text"
                  value={settings.connectionPort}
                  onChange={(e) => setSettings({ ...settings, connectionPort: e.target.value })}
                  placeholder="COM3 or IP:Port"
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                />
              </div>

              {/* Timeout */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Transaction Timeout (seconds)</label>
                <input
                  type="number"
                  value={settings.timeout}
                  onChange={(e) => setSettings({ ...settings, timeout: parseInt(e.target.value) || 30 })}
                  min={10}
                  max={120}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Test Connection Button */}
            <div className="mt-6 flex justify-end">
              <button
                onClick={() => alert('Connection test will be implemented later')}
                className="px-6 py-2 bg-gray-600 text-white rounded-lg font-semibold hover:bg-gray-700 transition-all"
              >
                Test Connection
              </button>
            </div>
          </div>
        )}

        {/* Standalone Mode Info */}
        {settings.integrationMode === 'standalone' && (
          <div className="border-t border-gray-200 pt-6">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
              <h3 className="text-lg font-bold text-blue-800 mb-2">Standalone Mode Active</h3>
              <p className="text-blue-700 mb-4">
                In standalone mode, card transactions are processed manually without terminal integration.
              </p>
              <div className="space-y-2 text-blue-600">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Card payments: Use external terminal and enter approval code</span>
                </div>
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Refunds: Enter card last 4 digits and authorization code manually</span>
                </div>
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>No additional hardware configuration needed</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CreditCardReaderPage;
