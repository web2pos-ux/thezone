/**
 * Device management page
 * - Table Devices: register/assign/status for table_order devices
 * - Sub POS: sub_pos + handheld approve request/pending/approve/disable
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Tablet, 
  Wifi, 
  WifiOff, 
  Battery, 
  BatteryCharging,
  BatteryLow,
  RefreshCw, 
  Trash2, 
  Link, 
  Unlink,
  AlertTriangle,
  CheckCircle,
  Clock,
  MapPin,
  MoreVertical,
  Search,
  Filter,
  Settings,
  Key,
  Copy,
  Shield,
  Smartphone,
  Eye,
  EyeOff
} from 'lucide-react';

import { getAPI_URL, getAPI_BASE } from '../config/constants';

interface Device {
  id: number;
  device_id: string;
  device_name: string;
  device_type: string;
  assigned_table_id: string | null;
  assigned_table_label: string | null;
  store_id: string;
  status: 'pending' | 'active' | 'inactive';
  app_version: string | null;
  os_version: string | null;
  ip_address: string | null;
  battery_level: number | null;
  is_charging: number;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
  is_online: boolean;
  seconds_since_seen: number;
}

interface TableElement {
  element_id: string;
  name: string;
  type: string;
}

interface DeviceStats {
  total: number;
  assigned: number;
  unassigned: number;
  pending: number;
  online: number;
  offline: number;
  low_battery: number;
}

const TableDevicesPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'table' | 'pairing'>('table');
  const [devices, setDevices] = useState<Device[]>([]);
  const [unassignedTables, setUnassignedTables] = useState<TableElement[]>([]);
  const [stats, setStats] = useState<DeviceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Filter state
  const [filterStatus, setFilterStatus] = useState<'all' | 'online' | 'offline' | 'pending'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Modal state
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [selectedTableId, setSelectedTableId] = useState('');
  
  // Delete confirmation modal
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deviceToDelete, setDeviceToDelete] = useState<Device | null>(null);
  
  // Details modal
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detailDevice, setDetailDevice] = useState<Device | null>(null);

  // Pairing Code state
  const [pairingCode, setPairingCode] = useState('');
  const [newPairingCode, setNewPairingCode] = useState('');
  const [isPairingEditing, setIsPairingEditing] = useState(false);
  const [showPairingCode, setShowPairingCode] = useState(false);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingMessage, setPairingMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [tabletSetupUrl, setTabletSetupUrl] = useState('');

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

  const handleSavePairingCode = async () => {
    const code = newPairingCode.trim();
    if (!code) {
      setPairingMessage({ type: 'error', text: 'Please enter a pairing code' });
      return;
    }
    if (code.length > 10) {
      setPairingMessage({ type: 'error', text: 'Pairing code must be 10 characters or less' });
      return;
    }
    setPairingLoading(true);
    try {
      const resp = await fetch(`${getAPI_URL()}/devices/pairing-code`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairing_code: code }),
      });
      const data = await resp.json();
      if (data.success) {
        setPairingCode(code);
        setNewPairingCode('');
        setIsPairingEditing(false);
        setPairingMessage({
          type: 'success',
          text: data.tokens_revoked > 0
            ? `Pairing code updated. ${data.tokens_revoked} device(s) will need to re-pair.`
            : 'Pairing code saved successfully.'
        });
      } else {
        setPairingMessage({ type: 'error', text: data.error || 'Failed to save' });
      }
    } catch (err: any) {
      setPairingMessage({ type: 'error', text: err.message });
    } finally {
      setPairingLoading(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setPairingMessage({ type: 'info', text: 'Copied to clipboard!' });
      setTimeout(() => setPairingMessage(null), 2000);
    } catch {
      setPairingMessage({ type: 'error', text: 'Failed to copy' });
    }
  };

  useEffect(() => {
    if (activeTab === 'pairing') {
      fetchPairingCode();
      setTabletSetupUrl(`${getAPI_BASE()}/table`);
    }
  }, [activeTab, fetchPairingCode]);

  // Load data
  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const apiUrl = getAPI_URL();
      const deviceTypeQuery = `?device_type=${encodeURIComponent('table_order')}`;
      
      const [devicesRes, tablesRes, statsRes] = await Promise.all([
        fetch(`${apiUrl}/devices${deviceTypeQuery}`),
        fetch(`${apiUrl}/devices/tables/unassigned`),
        fetch(`${apiUrl}/devices/stats/summary`)
      ]);
      
      if (!devicesRes.ok) throw new Error('Failed to load devices');
      
      const devicesData = await devicesRes.json();
      setDevices((devicesData.devices || []) as Device[]);
      
      if (tablesRes.ok) {
        const tablesData = await tablesRes.json();
        setUnassignedTables(tablesData.tables || []);
      }
      
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData.stats);
      }
      
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [activeTab]);
  
  useEffect(() => {
    fetchData();
    
    // Auto refresh every 5 seconds
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const updateDeviceStatus = async (device: Device, nextStatus: Device['status']) => {
    const apiUrl = getAPI_URL();
    try {
      const res = await fetch(`${apiUrl}/devices/${encodeURIComponent(device.device_id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus })
      });
      if (!res.ok) throw new Error('Failed to update device');
      fetchData();
    } catch (err: any) {
      alert(err.message || 'Failed to update device');
    }
  };
  
  // Assign table to device
  const handleAssignTable = async () => {
    if (!selectedDevice || !selectedTableId) return;
    
    try {
      const apiUrl = getAPI_URL();
      const res = await fetch(`${apiUrl}/devices/${selectedDevice.device_id}/assign`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          table_id: selectedTableId,
          table_label: selectedTableId
        })
      });
      
      if (res.status === 409) {
        const data = await res.json();
        if (data.conflict && data.existing_device) {
          const oldName = data.existing_device.device_name || data.existing_device.device_id;
          const confirmed = window.confirm(
            `Table ${selectedTableId} is already assigned to "${oldName}".\n\nReplace it with this device?`
          );
          if (confirmed) {
            const retryRes = await fetch(`${apiUrl}/devices/${selectedDevice.device_id}/assign`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                table_id: selectedTableId,
                table_label: selectedTableId,
                force_replace: true
              })
            });
            if (!retryRes.ok) {
              const retryData = await retryRes.json();
              throw new Error(retryData.error || 'Failed to replace assignment');
            }
          } else {
            return;
          }
        } else {
          throw new Error(data.error || 'Conflict');
        }
      } else if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to assign table');
      }
      
      setShowAssignModal(false);
      setSelectedDevice(null);
      setSelectedTableId('');
      fetchData();
      
    } catch (err: any) {
      alert(err.message);
    }
  };
  
  // Unassign table
  const handleUnassignTable = async (device: Device) => {
    if (!window.confirm(`Remove table assignment from "${device.device_name}"?`)) return;
    
    try {
      const apiUrl = getAPI_URL();
      const res = await fetch(`${apiUrl}/devices/${device.device_id}/assign`, {
        method: 'DELETE'
      });
      
      if (!res.ok) throw new Error('Failed to unassign table');
      
      fetchData();
      
    } catch (err: any) {
      alert(err.message);
    }
  };
  
  // Delete device
  const handleDeleteDevice = async () => {
    if (!deviceToDelete) return;
    
    try {
      const apiUrl = getAPI_URL();
      const res = await fetch(`${apiUrl}/devices/${deviceToDelete.device_id}`, {
        method: 'DELETE'
      });
      
      if (!res.ok) throw new Error('Failed to delete device');
      
      setShowDeleteModal(false);
      setDeviceToDelete(null);
      fetchData();
      
    } catch (err: any) {
      alert(err.message);
    }
  };
  
  // Filtered devices list
  const filteredDevices = devices.filter(device => {
    // Status filter
    if (filterStatus === 'online' && !device.is_online) return false;
    if (filterStatus === 'offline' && device.is_online) return false;
    if (filterStatus === 'pending' && device.status !== 'pending') return false;
    
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesName = device.device_name?.toLowerCase().includes(query);
      const matchesId = device.device_id.toLowerCase().includes(query);
      const matchesTable = device.assigned_table_id?.toLowerCase().includes(query);
      if (!matchesName && !matchesId && !matchesTable) return false;
    }
    
    return true;
  });
  
  // Time format
  const formatLastSeen = (seconds: number) => {
    if (seconds < 60) return `${seconds} sec ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
    return `${Math.floor(seconds / 86400)} days ago`;
  };
  
  // Battery icon
  const BatteryIcon = ({ level, charging }: { level: number | null; charging: boolean }) => {
    if (level === null) return <Battery className="w-4 h-4 text-gray-400" />;
    if (charging) return <BatteryCharging className="w-4 h-4 text-green-500" />;
    if (level < 20) return <BatteryLow className="w-4 h-4 text-red-500" />;
    return <Battery className="w-4 h-4 text-gray-600" />;
  };
  
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50">
        <div className="text-center">
          <RefreshCw className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading devices...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-gray-50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-3">
              <Tablet className="w-7 h-7 text-blue-600" />
                Device Manager
            </h1>
            <p className="text-gray-500 text-sm mt-1">
                {activeTab === 'table'
                  ? 'Table Devices (register and assign devices for table orders)'
                  : 'Pairing Code (manage pairing code for table order tablets)'}
            </p>
          </div>
          
          <button
            onClick={fetchData}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

        {/* Tabs */}
        <div className="bg-white border-b px-6 py-3">
          <div className="inline-flex rounded-xl bg-gray-100 p-1">
            <button
              onClick={() => setActiveTab('table')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                activeTab === 'table' ? 'bg-white shadow text-blue-700' : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              Table Devices
            </button>
            <button
              onClick={() => setActiveTab('pairing')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                activeTab === 'pairing' ? 'bg-white shadow text-blue-700' : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              Pairing Code
            </button>
          </div>
        </div>
      
      {/* Pairing Code tab content */}
      {activeTab === 'pairing' && (
        <div className="flex-1 overflow-auto p-6">
          {pairingMessage && (
            <div className={`mb-4 p-3 rounded-lg flex items-center gap-2 text-sm ${
              pairingMessage.type === 'success' ? 'bg-green-50 text-green-700' :
              pairingMessage.type === 'error' ? 'bg-red-50 text-red-700' :
              'bg-blue-50 text-blue-700'
            }`}>
              {pairingMessage.type === 'success' ? <CheckCircle className="w-4 h-4" /> :
               pairingMessage.type === 'error' ? <AlertTriangle className="w-4 h-4" /> : null}
              {pairingMessage.text}
            </div>
          )}

          {/* Current Pairing Code */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-700 flex items-center gap-2">
                <Shield className="w-5 h-5 text-blue-500" />
                Current Pairing Code
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowPairingCode(!showPairingCode)}
                  className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100"
                  title={showPairingCode ? 'Hide' : 'Show'}
                >
                  {showPairingCode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                {pairingCode && (
                  <button
                    onClick={() => copyToClipboard(pairingCode)}
                    className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100"
                    title="Copy"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex-1 py-3 px-4 bg-gray-50 rounded-lg font-mono text-xl tracking-wider text-gray-800">
                {showPairingCode
                  ? (pairingCode || <span className="text-gray-400 text-base font-sans">(not set)</span>)
                  : (pairingCode ? '•'.repeat(pairingCode.length) : '(not set)')}
              </div>
              <button
                onClick={() => { setIsPairingEditing(!isPairingEditing); setNewPairingCode(pairingCode); }}
                className="px-4 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-medium text-sm"
              >
                {isPairingEditing ? 'Cancel' : pairingCode ? 'Change' : 'Set Code'}
              </button>
            </div>

            {isPairingEditing && (
              <div className="mt-4 flex items-center gap-3">
                <input
                  type="text"
                  value={newPairingCode}
                  onChange={(e) => setNewPairingCode(e.target.value.slice(0, 10))}
                  placeholder="Enter new pairing code (max 10 chars)"
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-lg text-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  maxLength={10}
                  autoFocus
                />
                <button
                  onClick={handleSavePairingCode}
                  disabled={pairingLoading || !newPairingCode.trim()}
                  className="px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {pairingLoading && <RefreshCw className="w-4 h-4 animate-spin" />}
                  Save
                </button>
              </div>
            )}

            <p className="mt-3 text-xs text-gray-500">
              Changing the code will disconnect all currently paired tablets. They will need to re-pair with the new code.
            </p>
          </div>

          {/* Tablet Setup URL */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-700 flex items-center gap-2 mb-4">
              <Smartphone className="w-5 h-5 text-green-500" />
              Tablet Setup
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-500 mb-1">
                  Open this URL in the tablet's browser to download the app:
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 py-2 px-3 bg-gray-50 rounded-lg font-mono text-sm text-blue-600 break-all">
                    {tabletSetupUrl}
                  </div>
                  <button
                    onClick={() => copyToClipboard(tabletSetupUrl)}
                    className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 shrink-0"
                    title="Copy URL"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="bg-blue-50 p-4 rounded-lg text-sm text-blue-700">
                <p className="font-medium mb-2">Setup Steps:</p>
                <ol className="list-decimal list-inside space-y-1 text-blue-600">
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
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium mb-1">Security Notice</p>
                <ul className="space-y-1 text-amber-600">
                  <li>• The pairing code is stored encrypted on each tablet</li>
                  <li>• Store staff cannot see or access the pairing code</li>
                  <li>• Changing the code in Firebase will auto-disconnect all tablets</li>
                  <li>• Each tablet receives a unique auth token after pairing</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stats cards */}
      {activeTab !== 'pairing' && stats && (
        <div className="px-6 py-4 bg-white border-b">
          <div className="grid grid-cols-6 gap-4">
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-gray-800">{stats.total}</p>
              <p className="text-xs text-gray-500">Total</p>
            </div>
            <div className="bg-green-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-green-600">{stats.online}</p>
              <p className="text-xs text-gray-500">Online</p>
            </div>
            <div className="bg-red-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-red-600">{stats.offline}</p>
              <p className="text-xs text-gray-500">Offline</p>
            </div>
            <div className="bg-blue-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-blue-600">{stats.assigned}</p>
              <p className="text-xs text-gray-500">Assigned</p>
            </div>
            <div className="bg-yellow-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-yellow-600">{stats.pending}</p>
              <p className="text-xs text-gray-500">Pending</p>
            </div>
            <div className="bg-orange-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-orange-600">{stats.low_battery}</p>
              <p className="text-xs text-gray-500">Low Battery</p>
            </div>
          </div>
        </div>
      )}
      
      {/* Filter bar */}
      {activeTab !== 'pairing' && <div className="px-6 py-3 bg-white border-b flex items-center gap-4">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, ID, or table..."
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
          />
        </div>
        
        {/* Status filter */}
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as any)}
            className="px-3 py-2 border border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
          >
            <option value="all">All Status</option>
            <option value="online">🟢 Online</option>
            <option value="offline">🔴 Offline</option>
            <option value="pending">🟡 Pending</option>
          </select>
        </div>
      </div>}
      
      {/* Device list */}
      {activeTab !== 'pairing' && <div className="flex-1 overflow-auto p-6">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            <span className="text-red-700">{error}</span>
          </div>
        )}
        
        {filteredDevices.length === 0 ? (
          <div className="text-center py-20">
            <Tablet className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-600 mb-2">
              {searchQuery || filterStatus !== 'all' 
                ? 'No results found' 
                : 'No registered devices'}
            </h3>
            <p className="text-gray-400 text-sm">
              Devices will appear here when the Table Order app is launched
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
            {filteredDevices.map(device => (
              <div
                key={device.device_id}
                className={`bg-white rounded-xl shadow-sm border-2 transition-all hover:shadow-md ${
                  device.is_online 
                    ? 'border-green-200' 
                    : device.status === 'pending'
                    ? 'border-yellow-200'
                    : 'border-gray-200'
                }`}
              >
                {/* Card header */}
                <div className="p-4 border-b flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      device.is_online ? 'bg-green-100' : 'bg-gray-100'
                    }`}>
                      <Tablet className={`w-5 h-5 ${
                        device.is_online ? 'text-green-600' : 'text-gray-400'
                      }`} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-800">
                        {device.device_name || device.device_id}
                      </h3>
                      <p className="text-xs text-gray-400 font-mono">
                        {device.device_id}
                      </p>
                    </div>
                  </div>
                  
                  {/* Status badge */}
                  <div className="flex items-center gap-2">
                    {device.is_online ? (
                      <span className="flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                        <Wifi className="w-3 h-3" />
                        Online
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-medium">
                        <WifiOff className="w-3 h-3" />
                        Offline
                      </span>
                    )}
                  </div>
                </div>
                
                {/* Card body */}
                <div className="p-4 space-y-3">
                  {/* Table assignment info */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500 flex items-center gap-2">
                      <MapPin className="w-4 h-4" />
                      Table
                    </span>
                    {device.assigned_table_id ? (
                      <span className="font-bold text-blue-600 bg-blue-50 px-3 py-1 rounded-lg">
                        {device.assigned_table_label || device.assigned_table_id}
                      </span>
                    ) : (
                      <span className="text-yellow-600 bg-yellow-50 px-3 py-1 rounded-lg text-sm">
                        Unassigned
                      </span>
                    )}
                  </div>
                  
                  {/* Battery */}
                  {device.battery_level !== null && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-500 flex items-center gap-2">
                        <BatteryIcon level={device.battery_level} charging={device.is_charging === 1} />
                        Battery
                      </span>
                      <span className={`font-medium ${
                        device.battery_level < 20 ? 'text-red-600' : 'text-gray-700'
                      }`}>
                        {device.battery_level}%
                        {device.is_charging === 1 && ' ⚡'}
                      </span>
                    </div>
                  )}
                  
                  {/* Last seen */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500 flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      Last Seen
                    </span>
                    <span className="text-sm text-gray-600">
                      {device.last_seen_at 
                        ? formatLastSeen(device.seconds_since_seen)
                        : 'Never'}
                    </span>
                  </div>
                  
                  {/* IP address */}
                  {device.ip_address && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-500">IP</span>
                      <span className="text-xs text-gray-500 font-mono">
                        {device.ip_address.replace('::ffff:', '')}
                      </span>
                    </div>
                  )}
                </div>
                
                {/* Card footer - action buttons */}
                <div className="px-4 py-3 bg-gray-50 rounded-b-xl flex items-center gap-2">
                  {/* Assign/unassign table */}
                  {device.assigned_table_id ? (
                      <button
                        onClick={() => handleUnassignTable(device)}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-100 transition text-sm"
                      >
                        <Unlink className="w-4 h-4" />
                        Unassign
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setSelectedDevice(device);
                          setShowAssignModal(true);
                        }}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition text-sm"
                      >
                        <Link className="w-4 h-4" />
                        Assign Table
                      </button>
                    )}
                  
                  <button
                    onClick={() => {
                      setDetailDevice(device);
                      setShowDetailModal(true);
                    }}
                    className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-100 transition"
                    title="Details"
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                  
                  <button
                    onClick={() => {
                      setDeviceToDelete(device);
                      setShowDeleteModal(true);
                    }}
                    className="px-3 py-2 bg-white border border-red-200 rounded-lg text-red-500 hover:bg-red-50 transition"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>}
      
      {/* Assign table modal */}
      {showAssignModal && selectedDevice && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-6 border-b">
              <h3 className="text-lg font-bold text-gray-800">Assign Table</h3>
              <p className="text-sm text-gray-500 mt-1">
                "{selectedDevice.device_name}" will be assigned to a table
              </p>
            </div>
            
            <div className="p-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Table
              </label>
              <select
                value={selectedTableId}
                onChange={(e) => setSelectedTableId(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
              >
                <option value="">Select a table</option>
                {/* Unassigned tables */}
                {unassignedTables.length > 0 && (
                  <optgroup label="Unassigned Tables">
                    {unassignedTables.map(table => (
                      <option key={table.element_id} value={table.name || table.element_id}>
                        {table.name || table.element_id}
                      </option>
                    ))}
                  </optgroup>
                )}
                {/* Manual input */}
                <optgroup label="Manual Input">
                  <option value="__custom__">Enter manually...</option>
                </optgroup>
              </select>
              
              {selectedTableId === '__custom__' && (
                <input
                  type="text"
                  placeholder="Enter table ID (e.g. T1, A1)"
                  onChange={(e) => setSelectedTableId(e.target.value)}
                  className="w-full mt-3 px-4 py-3 border border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
                />
              )}
            </div>
            
            <div className="p-6 bg-gray-50 rounded-b-2xl flex gap-3">
              <button
                onClick={() => {
                  setShowAssignModal(false);
                  setSelectedDevice(null);
                  setSelectedTableId('');
                }}
                className="flex-1 px-4 py-3 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-100 transition font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleAssignTable}
                disabled={!selectedTableId || selectedTableId === '__custom__'}
                className="flex-1 px-4 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition font-medium"
              >
                Assign
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Delete confirmation modal */}
      {showDeleteModal && deviceToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-8 h-8 text-red-500" />
              </div>
              <h3 className="text-lg font-bold text-gray-800 mb-2">Delete Device</h3>
              <p className="text-gray-600">
                "{deviceToDelete.device_name}" will be deleted. Are you sure?
              </p>
              <p className="text-sm text-gray-400 mt-2">
                This action cannot be undone.
              </p>
            </div>
            
            <div className="p-4 bg-gray-50 rounded-b-2xl flex gap-3">
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeviceToDelete(null);
                }}
                className="flex-1 px-4 py-3 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-100 transition font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteDevice}
                className="flex-1 px-4 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 transition font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Details modal */}
      {showDetailModal && detailDevice && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="p-6 border-b flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-800">Device Details</h3>
              <button
                onClick={() => setShowDetailModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition"
              >
                ✕
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">Device ID</p>
                  <p className="font-mono text-sm">{detailDevice.device_id}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Device Name</p>
                  <p className="font-medium">{detailDevice.device_name}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Status</p>
                  <p className={`font-medium ${
                    detailDevice.is_online ? 'text-green-600' : 'text-gray-500'
                  }`}>
                    {detailDevice.is_online ? 'Online' : 'Offline'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Assigned Table</p>
                  <p className="font-medium">
                    {detailDevice.assigned_table_id || 'Unassigned'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">IP Address</p>
                  <p className="font-mono text-sm">
                    {detailDevice.ip_address?.replace('::ffff:', '') || '-'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Battery</p>
                  <p className="font-medium">
                    {detailDevice.battery_level !== null 
                      ? `${detailDevice.battery_level}%${detailDevice.is_charging ? ' (Charging)' : ''}`
                      : '-'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">App Version</p>
                  <p className="font-mono text-sm">{detailDevice.app_version || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">OS Version</p>
                  <p className="text-sm">{detailDevice.os_version || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Registered</p>
                  <p className="text-sm">
                    {new Date(detailDevice.created_at).toLocaleString('en-US')}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Last Seen</p>
                  <p className="text-sm">
                    {detailDevice.last_seen_at 
                      ? new Date(detailDevice.last_seen_at).toLocaleString('en-US')
                      : '-'}
                  </p>
                </div>
              </div>
            </div>
            
            <div className="p-4 bg-gray-50 rounded-b-2xl">
              <button
                onClick={() => setShowDetailModal(false)}
                className="w-full px-4 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TableDevicesPage;
