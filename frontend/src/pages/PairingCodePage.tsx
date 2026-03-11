import React, { useState, useEffect, useCallback } from 'react';
import { Key, Copy, RefreshCw, Shield, Smartphone, CheckCircle, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import { getAPI_URL, getAPI_BASE } from '../config/constants';

interface TokenInfo {
  device_id: string;
  created_at: string;
  revoked: number;
}

const PairingCodePage: React.FC = () => {
  const [pairingCode, setPairingCode] = useState('');
  const [newCode, setNewCode] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [tabletUrl, setTabletUrl] = useState('');

  const fetchPairingCode = useCallback(async () => {
    try {
      const resp = await fetch(`${getAPI_URL()}/devices/pairing-code`);
      const data = await resp.json();
      if (data.success) {
        setPairingCode(data.pairing_code || '');
      }
    } catch (err) {
      console.error('Failed to fetch pairing code:', err);
    }
  }, []);

  useEffect(() => {
    fetchPairingCode();
    setTabletUrl(`${getAPI_BASE()}/table`);
  }, [fetchPairingCode]);

  const handleSave = async () => {
    const code = newCode.trim();
    if (!code) {
      setMessage({ type: 'error', text: 'Please enter a pairing code' });
      return;
    }
    if (code.length > 10) {
      setMessage({ type: 'error', text: 'Pairing code must be 10 characters or less' });
      return;
    }

    setLoading(true);
    try {
      const resp = await fetch(`${getAPI_URL()}/devices/pairing-code`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairing_code: code }),
      });
      const data = await resp.json();
      if (data.success) {
        setPairingCode(code);
        setNewCode('');
        setIsEditing(false);
        setMessage({
          type: 'success',
          text: data.tokens_revoked > 0
            ? `Pairing code updated. ${data.tokens_revoked} device(s) will need to re-pair.`
            : 'Pairing code saved successfully.'
        });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to save' });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage({ type: 'info', text: 'Copied to clipboard!' });
      setTimeout(() => setMessage(null), 2000);
    } catch {
      setMessage({ type: 'error', text: 'Failed to copy' });
    }
  };

  const maskedCode = pairingCode ? '•'.repeat(pairingCode.length) : '(not set)';

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Key className="w-7 h-7 text-blue-500" />
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Pairing Code</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Manage device pairing code for Table Order tablets
          </p>
        </div>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-lg flex items-center gap-2 text-sm ${
          message.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
          message.type === 'error' ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
          'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
        }`}>
          {message.type === 'success' ? <CheckCircle className="w-4 h-4" /> :
           message.type === 'error' ? <AlertTriangle className="w-4 h-4" /> : null}
          {message.text}
        </div>
      )}

      {/* Current Pairing Code */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-500" />
            Current Pairing Code
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCode(!showCode)}
              className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
              title={showCode ? 'Hide' : 'Show'}
            >
              {showCode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
            {pairingCode && (
              <button
                onClick={() => copyToClipboard(pairingCode)}
                className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                title="Copy"
              >
                <Copy className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex-1 py-3 px-4 bg-gray-50 dark:bg-gray-900 rounded-lg font-mono text-xl tracking-wider text-gray-800 dark:text-gray-200">
            {showCode ? (pairingCode || <span className="text-gray-400 text-base font-sans">(not set)</span>) : maskedCode}
          </div>
          <button
            onClick={() => { setIsEditing(!isEditing); setNewCode(pairingCode); }}
            className="px-4 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-medium text-sm"
          >
            {isEditing ? 'Cancel' : pairingCode ? 'Change' : 'Set Code'}
          </button>
        </div>

        {isEditing && (
          <div className="mt-4 flex items-center gap-3">
            <input
              type="text"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value.slice(0, 10))}
              placeholder="Enter new pairing code (max 10 chars)"
              className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 text-lg focus:ring-2 focus:ring-blue-500 outline-none"
              maxLength={10}
              autoFocus
            />
            <button
              onClick={handleSave}
              disabled={loading || !newCode.trim()}
              className="px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading && <RefreshCw className="w-4 h-4 animate-spin" />}
              Save
            </button>
          </div>
        )}

        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          Changing the code will disconnect all currently paired tablets. They will need to re-pair with the new code.
        </p>
      </div>

      {/* Tablet Setup URL */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-2 mb-4">
          <Smartphone className="w-5 h-5 text-green-500" />
          Tablet Setup
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">
              Open this URL in the tablet's browser to download the app:
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1 py-2 px-3 bg-gray-50 dark:bg-gray-900 rounded-lg font-mono text-sm text-blue-600 dark:text-blue-400 break-all">
                {tabletUrl}
              </div>
              <button
                onClick={() => copyToClipboard(tabletUrl)}
                className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 shrink-0"
                title="Copy URL"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg text-sm text-blue-700 dark:text-blue-300">
            <p className="font-medium mb-2">Setup Steps:</p>
            <ol className="list-decimal list-inside space-y-1 text-blue-600 dark:text-blue-400">
              <li>On the tablet, open Chrome browser</li>
              <li>Enter the URL above (POS IP + /table)</li>
              <li>Enter the pairing code and download the APK</li>
              <li>Install and open the app</li>
              <li>Enter the pairing code in the app — it auto-configures</li>
            </ol>
          </div>
        </div>
      </div>

      {/* Security Info */}
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 text-sm text-amber-700 dark:text-amber-300">
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium mb-1">Security Notice</p>
            <ul className="space-y-1 text-amber-600 dark:text-amber-400">
              <li>• The pairing code is stored encrypted on each tablet</li>
              <li>• Store staff cannot see or access the pairing code</li>
              <li>• Changing the code in Firebase will auto-disconnect all tablets</li>
              <li>• Each tablet receives a unique auth token after pairing</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PairingCodePage;
