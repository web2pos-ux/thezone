import React, { useState, useEffect, useCallback } from 'react';
import { Monitor, Printer, Shield, RefreshCw, Trash2, CheckCircle, AlertTriangle, Wifi, WifiOff, Clock, Smartphone } from 'lucide-react';
import { getAPI_URL } from '../config/constants';

interface RegisteredDevice {
  id: string;
  device_id: string;
  device_name: string;
  device_type: string;
  assigned_table_id: string | null;
  assigned_table_label: string | null;
  last_seen_at: string | null;
  last_heartbeat: string;
  status: 'pending' | 'active' | 'inactive';
  ip_address: string | null;
  is_online: boolean;
  seconds_since_seen: number;
  created_at: string;
}

const SubPosSettingsPage: React.FC = () => {
  const API_URL = getAPI_URL();
  const [printEnabled, setPrintEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [devices, setDevices] = useState<RegisteredDevice[]>([]);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetchSettings();
    fetchDevices();
    const interval = setInterval(fetchDevices, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchSettings = async () => {
    try {
      const resp = await fetch(`${API_URL}/app-settings/sub_pos_print_enabled`);
      if (resp.ok) {
        const data = await resp.json();
        setPrintEnabled(data.value === 'true' || data.value === '1');
      }
    } catch (err) {
      console.error('Failed to fetch sub pos settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchDevices = useCallback(async () => {
    try {
      const resp = await fetch(`${API_URL}/devices`);
      if (resp.ok) {
        const data = await resp.json();
        const filtered = (data.devices || data || []).filter(
          (d: RegisteredDevice) =>
            d.device_type === 'sub_pos' || d.device_type === 'subpos' || d.device_type === 'handheld'
        );
        setDevices(filtered);
      }
    } catch (err) {
      console.error('Failed to fetch devices:', err);
    }
  }, [API_URL]);

  const handleTogglePrint = async () => {
    setSaving(true);
    try {
      const newValue = !printEnabled;
      const resp = await fetch(`${API_URL}/app-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { sub_pos_print_enabled: newValue ? 'true' : 'false' } }),
      });
      if (resp.ok) {
        setPrintEnabled(newValue);
        showMsg('success', `Sub POS printer output ${newValue ? 'enabled' : 'disabled'}`);
      } else {
        showMsg('error', 'Failed to save settings');
      }
    } catch {
      showMsg('error', 'Error saving settings');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateStatus = async (device: RegisteredDevice, nextStatus: 'active' | 'inactive') => {
    try {
      const resp = await fetch(`${API_URL}/devices/${encodeURIComponent(device.device_id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (resp.ok) {
        showMsg('success', `${device.device_name || device.device_id} → ${nextStatus === 'active' ? 'Approved' : 'Disabled'}`);
        fetchDevices();
      } else {
        showMsg('error', 'Failed to update status');
      }
    } catch {
      showMsg('error', 'Error updating status');
    }
  };

  const handleDelete = async (device: RegisteredDevice) => {
    if (!window.confirm(`"${device.device_name || device.device_id}" will be deleted. Are you sure?`)) return;
    try {
      const resp = await fetch(`${API_URL}/devices/${encodeURIComponent(device.device_id)}`, { method: 'DELETE' });
      if (resp.ok) {
        setDevices(prev => prev.filter(d => d.device_id !== device.device_id));
        showMsg('success', 'Device deleted');
      } else {
        showMsg('error', 'Failed to delete device');
      }
    } catch {
      showMsg('error', 'Error deleting device');
    }
  };

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const formatLastSeen = (seconds: number) => {
    if (seconds < 60) return `${seconds} sec ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
    return `${Math.floor(seconds / 86400)} days ago`;
  };

  const getDeviceTypeLabel = (type: string) => {
    if (type === 'sub_pos' || type === 'subpos') return 'Sub POS';
    if (type === 'handheld') return 'Handheld';
    return type;
  };

  const getStatusBadge = (device: RegisteredDevice) => {
    if (device.status === 'pending') {
      return <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-bold">Pending</span>;
    }
    if (device.status === 'inactive') {
      return <span className="px-2 py-1 bg-gray-200 text-gray-500 rounded-full text-xs font-bold">Inactive</span>;
    }
    return null;
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <RefreshCw className="animate-spin mr-2" size={20} />
        <span>Loading...</span>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Monitor size={28} className="text-blue-600" />
        <div>
          <h1 className="text-2xl font-bold">Sub POS / Handheld Settings</h1>
          <p className="text-sm text-gray-500">Device management and printer output settings</p>
        </div>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm font-medium flex items-center gap-2 ${
          message.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          {message.type === 'success' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
          {message.text}
        </div>
      )}

      {/* Printer Output Setting */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <Printer size={22} className="text-gray-600" />
          <h2 className="text-lg font-semibold">Printer Output Settings</h2>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Control whether Sub POS can print Kitchen Ticket, Receipt, and Bill.
          When disabled, all print requests from Sub POS are ignored and only the main POS will print.
        </p>
        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
          <div>
            <span className="font-medium text-gray-700">Sub POS Printer Output</span>
            <span className={`ml-3 px-2 py-1 rounded text-xs font-bold ${
              printEnabled ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'
            }`}>
              {printEnabled ? 'ON' : 'OFF'}
            </span>
          </div>
          <button
            onClick={handleTogglePrint}
            disabled={saving}
            className={`px-4 py-2 rounded-lg text-white font-medium transition-colors ${
              printEnabled
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-blue-600 hover:bg-blue-700'
            } disabled:opacity-50`}
          >
            {saving ? 'Saving...' : printEnabled ? 'Disable' : 'Enable'}
          </button>
        </div>
      </div>

      {/* Registered Devices */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Shield size={22} className="text-gray-600" />
            <h2 className="text-lg font-semibold">Registered Devices</h2>
            <span className="text-sm text-gray-400">({devices.length})</span>
          </div>
          <button
            onClick={fetchDevices}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
        </div>

        {devices.length === 0 ? (
          <div className="text-center py-12">
            <Smartphone className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-400">No Sub POS / Handheld devices registered</p>
            <p className="text-xs text-gray-300 mt-1">Devices will appear here when connected</p>
          </div>
        ) : (
          <div className="space-y-3">
            {devices.map(device => (
              <div
                key={device.device_id}
                className={`p-4 rounded-xl border-2 transition-all ${
                  device.status === 'pending'
                    ? 'border-yellow-300 bg-yellow-50'
                    : device.status === 'inactive'
                    ? 'border-gray-200 bg-gray-50 opacity-60'
                    : device.is_online
                    ? 'border-green-200 bg-white'
                    : 'border-gray-200 bg-white'
                }`}
              >
                <div className="flex items-center justify-between">
                  {/* Left: Device info */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                      device.is_online ? 'bg-green-100' : 'bg-gray-100'
                    }`}>
                      {device.device_type === 'handheld'
                        ? <Smartphone className={`w-5 h-5 ${device.is_online ? 'text-green-600' : 'text-gray-400'}`} />
                        : <Monitor className={`w-5 h-5 ${device.is_online ? 'text-green-600' : 'text-gray-400'}`} />
                      }
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-800 truncate">
                          {device.device_name || device.device_id}
                        </span>
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">
                          {getDeviceTypeLabel(device.device_type)}
                        </span>
                        {device.is_online ? (
                          <span className="flex items-center gap-1 text-green-600 text-xs">
                            <Wifi size={12} /> Online
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-gray-400 text-xs">
                            <WifiOff size={12} /> Offline
                          </span>
                        )}
                        {getStatusBadge(device)}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                        <span className="font-mono">{device.device_id}</span>
                        {device.ip_address && (
                          <span className="font-mono">{device.ip_address.replace('::ffff:', '')}</span>
                        )}
                        {device.last_seen_at && (
                          <span className="flex items-center gap-1">
                            <Clock size={10} />
                            {formatLastSeen(device.seconds_since_seen)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: Action buttons */}
                  <div className="flex items-center gap-2 shrink-0 ml-4">
                    {device.status === 'pending' && (
                      <button
                        onClick={() => handleUpdateStatus(device, 'active')}
                        className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition flex items-center gap-1"
                      >
                        <CheckCircle size={14} /> Approve
                      </button>
                    )}
                    {device.status === 'active' && (
                      <button
                        onClick={() => handleUpdateStatus(device, 'inactive')}
                        className="px-3 py-1.5 bg-white border border-orange-300 text-orange-600 rounded-lg text-sm font-medium hover:bg-orange-50 transition flex items-center gap-1"
                      >
                        <AlertTriangle size={14} /> Disable
                      </button>
                    )}
                    {device.status === 'inactive' && (
                      <button
                        onClick={() => handleUpdateStatus(device, 'active')}
                        className="px-3 py-1.5 bg-white border border-emerald-300 text-emerald-700 rounded-lg text-sm font-medium hover:bg-emerald-50 transition flex items-center gap-1"
                      >
                        <CheckCircle size={14} /> Enable
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(device)}
                      className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Setup Guide */}
      <div className="bg-blue-50 rounded-xl border border-blue-200 p-6">
        <h3 className="font-semibold text-blue-800 mb-3">Setup Guide</h3>
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <h4 className="font-medium text-blue-700 mb-2">Sub POS</h4>
            <ol className="text-sm text-blue-600 space-y-1 list-decimal list-inside">
              <li>On the device browser, go to <code className="bg-blue-100 px-1 rounded">http://[POS IP]:3000/subpos</code></li>
              <li>Enter POS Host address + device name</li>
              <li>Setup complete → Shows the same screen as main POS</li>
            </ol>
          </div>
          <div>
            <h4 className="font-medium text-blue-700 mb-2">Handheld POS</h4>
            <ol className="text-sm text-blue-600 space-y-1 list-decimal list-inside">
              <li>On smartphone/tablet browser, go to <code className="bg-blue-100 px-1 rounded">http://[POS IP]:3000/handheld</code></li>
              <li>Enter POS Host address + test connection</li>
              <li>Setup complete → Same screen as POS + Call Server notifications</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SubPosSettingsPage;
