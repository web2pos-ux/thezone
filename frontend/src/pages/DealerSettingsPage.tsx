import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../config/constants';

const MASTER_PIN = '9998887117';

const DealerSettingsPage: React.FC = () => {
  const navigate = useNavigate();

  const [authed, setAuthed] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [verifying, setVerifying] = useState(false);

  const [restaurantId, setRestaurantId] = useState('');
  const [storeName, setStoreName] = useState('');
  const [serviceMode, setServiceMode] = useState<'FSR' | 'QSR'>('FSR');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dealerRole, setDealerRole] = useState('');

  const handleVerify = async () => {
    if (pin.length < 4) { setPinError('4자리 이상 입력'); return; }
    setVerifying(true);
    setPinError('');
    try {
      const res = await fetch(`${API_URL}/dealer-access/verify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      const data = await res.json();
      if (data.success) {
        setDealerRole(data.role);
        sessionStorage.setItem('dealer_pin', pin);
        sessionStorage.setItem('dealer_role', data.role);
        setAuthed(true);
        loadSettings(data.role, pin);
      } else {
        setPinError(data.error || 'Invalid PIN');
      }
    } catch { setPinError('Verification failed'); }
    finally { setVerifying(false); }
  };

  const loadSettings = async (role: string, dealerPin: string) => {
    try {
      const res = await fetch(`${API_URL}/dealer-access/store-settings`, {
        headers: { 'X-Dealer-Role': role, 'X-Dealer-Pin': dealerPin }
      });
      const data = await res.json();
      if (data.success) {
        setRestaurantId(data.data.restaurantId || '');
        setStoreName(data.data.storeName || '');
        setServiceMode(data.data.serviceMode || 'FSR');
      }
    } catch {}
  };

  const handleSave = async () => {
    const dealerPin = sessionStorage.getItem('dealer_pin') || '';
    if (!dealerPin) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`${API_URL}/dealer-access/store-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dealer-Role': dealerRole, 'X-Dealer-Pin': dealerPin },
        body: JSON.stringify({ restaurantId: restaurantId.trim() || null, storeName: storeName.trim() || null, serviceMode })
      });
      const data = await res.json();
      if (data.success) {
        try {
          const existing = JSON.parse(localStorage.getItem('pos_setup_config') || '{}');
          existing.operationMode = serviceMode;
          localStorage.setItem('pos_setup_config', JSON.stringify(existing));
        } catch {}
        setMsg({ ok: true, text: 'Saved!' });
      } else {
        setMsg({ ok: false, text: data.error || 'Save failed' });
      }
    } catch { setMsg({ ok: false, text: 'Save failed' }); }
    finally { setSaving(false); }
  };

  const handleExit = () => {
    sessionStorage.removeItem('dealer_pin');
    sessionStorage.removeItem('dealer_role');
    navigate('/');
  };

  // PIN 화면
  if (!authed) {
    return (
      <div className="fixed inset-0 bg-gray-900 flex items-center justify-center">
        <div className="w-80 text-center">
          <h1 className="text-white text-xl font-bold mb-6">Dealer Access</h1>
          <div className="flex justify-center gap-2 mb-4">
            {Array.from({ length: Math.max(pin.length, 4) }).map((_, i) => (
              <div key={i} className={`w-4 h-4 rounded-full ${i < pin.length ? 'bg-white' : 'border-2 border-gray-500'}`} />
            ))}
          </div>
          {pinError && <p className="text-red-400 text-sm mb-3">{pinError}</p>}
          <div className="grid grid-cols-3 gap-2 mb-4">
            {[1,2,3,4,5,6,7,8,9].map(n => (
              <button key={n} onClick={() => { setPin(p => p + n); setPinError(''); }}
                className="h-14 bg-gray-700 hover:bg-gray-600 text-white text-xl font-bold rounded-lg active:scale-95">{n}</button>
            ))}
            <button onClick={() => setPin('')} className="h-14 bg-red-800 hover:bg-red-700 text-white text-sm font-bold rounded-lg">Clear</button>
            <button onClick={() => { setPin(p => p + '0'); setPinError(''); }}
              className="h-14 bg-gray-700 hover:bg-gray-600 text-white text-xl font-bold rounded-lg active:scale-95">0</button>
            <button onClick={() => setPin(p => p.slice(0, -1))} className="h-14 bg-yellow-700 hover:bg-yellow-600 text-white text-xl font-bold rounded-lg">←</button>
          </div>
          <button onClick={handleVerify} disabled={verifying || pin.length < 4}
            className={`w-full h-12 rounded-lg font-bold text-lg mb-3 ${pin.length >= 4 ? 'bg-purple-600 hover:bg-purple-500 text-white' : 'bg-gray-700 text-gray-400 cursor-not-allowed'}`}>
            {verifying ? '...' : 'Access'}
          </button>
          <button onClick={() => navigate(-1)} className="w-full h-10 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">Cancel</button>
        </div>
      </div>
    );
  }

  // 설정 화면 (한 화면)
  return (
    <div className="fixed inset-0 bg-gray-900 flex items-center justify-center">
      <div className="w-[420px]">
        <h1 className="text-white text-xl font-bold text-center mb-5">Dealer Settings</h1>

        {/* Restaurant ID */}
        <div className="mb-4">
          <label className="text-gray-400 text-xs block mb-1">Restaurant ID</label>
          <input type="text" value={restaurantId} onChange={e => setRestaurantId(e.target.value)}
            placeholder="Enter Restaurant ID"
            className="w-full h-11 px-3 bg-gray-800 border border-gray-600 rounded-lg text-white font-mono text-sm focus:outline-none focus:border-purple-500" />
        </div>

        {/* Store Name */}
        <div className="mb-4">
          <label className="text-gray-400 text-xs block mb-1">Store Name</label>
          <input type="text" value={storeName} onChange={e => setStoreName(e.target.value)}
            placeholder="Enter Store Name"
            className="w-full h-11 px-3 bg-gray-800 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500" />
        </div>

        {/* Service Mode */}
        <div className="mb-5">
          <label className="text-gray-400 text-xs block mb-1">Service Mode</label>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => setServiceMode('FSR')}
              className={`h-14 rounded-lg font-bold text-lg border-2 transition-all ${serviceMode === 'FSR' ? 'bg-blue-600 border-blue-400 text-white' : 'bg-gray-800 border-gray-600 text-gray-400 hover:border-gray-400'}`}>
              FSR
            </button>
            <button onClick={() => setServiceMode('QSR')}
              className={`h-14 rounded-lg font-bold text-lg border-2 transition-all ${serviceMode === 'QSR' ? 'bg-orange-600 border-orange-400 text-white' : 'bg-gray-800 border-gray-600 text-gray-400 hover:border-gray-400'}`}>
              QSR
            </button>
          </div>
        </div>

        {/* Message */}
        {msg && (
          <div className={`mb-4 p-2 rounded-lg text-center text-sm font-medium ${msg.ok ? 'bg-green-800 text-green-200' : 'bg-red-800 text-red-200'}`}>
            {msg.text}
          </div>
        )}

        {/* Save + Exit */}
        <div className="grid grid-cols-2 gap-3">
          <button onClick={handleSave} disabled={saving}
            className={`h-12 rounded-lg font-bold text-lg ${saving ? 'bg-gray-700 text-gray-400' : 'bg-green-600 hover:bg-green-500 text-white'}`}>
            {saving ? '...' : 'Save'}
          </button>
          <button onClick={handleExit}
            className="h-12 rounded-lg font-bold text-lg bg-gray-700 hover:bg-gray-600 text-white">
            Exit
          </button>
        </div>
      </div>
    </div>
  );
};

export default DealerSettingsPage;
