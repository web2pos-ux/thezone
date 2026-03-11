import React, { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { API_URL } from '../config/constants';
import DangerousActionModal from '../components/DangerousActionModal';

type TabType = 'business-info' | 'sync';

interface BusinessHour {
  day_of_week: number;
  day_name?: string;
  open_time: string;
  close_time: string;
  is_open: number;
  break_start?: string;
  break_end?: string;
  happy_hour_start?: string;
  happy_hour_end?: string;
  busy_hour_start?: string;
  busy_hour_end?: string;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const BasicInfoPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('business-info');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [appVersion, setAppVersion] = useState<{ version: string; releaseDate: string; releaseNotes: string } | null>(null);
  const [profile, setProfile] = useState<any>({
    business_name: '',
    tax_number: '',
    phone: '',
    email: '',
    address_line1: '',
    address_line2: '',
    city: '',
    state: '',
    zip: '',
    country: '',
    logo_url: '',
    banner_url: ''
  });
  const [syncing, setSyncing] = useState(false);
  const [hours, setHours] = useState<BusinessHour[]>([]);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);

  // Sync Tab States
  const [firebaseUrl, setFirebaseUrl] = useState(() => localStorage.getItem('firebase_admin_url') || 'https://thezoneorder.com');
  const [restaurantId, setRestaurantId] = useState(() => localStorage.getItem('firebase_restaurant_id') || '');
  
  // Dangerous action lock states
  const [dangerousAction, setDangerousAction] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    warningItems: string[];
    confirmPhrase: string;
    onConfirm: () => void;
  }>({ isOpen: false, title: '', description: '', warningItems: [], confirmPhrase: '', onConfirm: () => {} });

  const [syncStatus, setSyncStatus] = useState<{
    menu: { status: 'idle' | 'syncing' | 'success' | 'error'; message?: string };
    orderScreen: { status: 'idle' | 'syncing' | 'success' | 'error'; message?: string };
    tableMap: { status: 'idle' | 'syncing' | 'success' | 'error'; message?: string };
  }>({
    menu: { status: 'idle' },
    orderScreen: { status: 'idle' },
    tableMap: { status: 'idle' }
  });

  // Remote Sync States
  const [remoteSyncStatus, setRemoteSyncStatus] = useState<{
    connected: boolean;
    restaurantId: string | null;
    isProcessing: boolean;
    queueLength: number;
    version: string | null;
  } | null>(null);
  const [remoteSyncHistory, setRemoteSyncHistory] = useState<any[]>([]);
  const [remoteSyncEnabled, setRemoteSyncEnabled] = useState(false);

  // Initialize default hours
  const getDefaultHours = (): BusinessHour[] => {
    return DAY_NAMES.map((name, idx) => ({
      day_of_week: idx,
      day_name: name,
      open_time: '09:00',
      close_time: '21:00',
      is_open: 1,
      break_start: '',
      break_end: '',
      happy_hour_start: '',
      happy_hour_end: '',
      busy_hour_start: '',
      busy_hour_end: ''
    }));
  };

  // Load profile and version
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [p, h, v] = await Promise.all([
          fetch(`${API_URL}/admin-settings/business-profile`).then(r=>r.json()).catch(()=>null),
          fetch(`${API_URL}/admin-settings/business-hours`).then(r=>r.json()).catch(()=>[]),
          fetch(`${API_URL}/app-update/version`).then(r=>r.json()).catch(()=>null)
        ]);
        if (p) setProfile(p);
        if (Array.isArray(h) && h.length > 0) {
          // Merge with defaults to ensure all fields exist
          const merged = getDefaultHours().map(def => {
            const found = h.find((hr: any) => hr.day_of_week === def.day_of_week);
            return found ? { ...def, ...found } : def;
          });
          setHours(merged);
        } else {
          setHours(getDefaultHours());
        }
        if (v?.success && v.data) {
          setAppVersion(v.data);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const updateHour = (dayOfWeek: number, field: keyof BusinessHour, value: any) => {
    setHours(prev => prev.map(h => 
      h.day_of_week === dayOfWeek 
        ? { ...h, [field]: field === 'is_open' ? (value ? 1 : 0) : value }
        : h
    ));
  };

  // Apply All functions (like TZO Admin)
  const applyAllBusinessHours = () => {
    const sunday = hours.find(h => h.day_of_week === 0);
    if (!sunday) return;
    setHours(prev => prev.map(h => ({
      ...h,
      open_time: sunday.open_time,
      close_time: sunday.close_time,
      is_open: sunday.is_open
    })));
  };

  const applyAllBreakTime = () => {
    const sunday = hours.find(h => h.day_of_week === 0);
    if (!sunday) return;
    setHours(prev => prev.map(h => ({
      ...h,
      break_start: sunday.break_start,
      break_end: sunday.break_end
    })));
  };

  const applyAllHappyHour = () => {
    const sunday = hours.find(h => h.day_of_week === 0);
    if (!sunday) return;
    setHours(prev => prev.map(h => ({
      ...h,
      happy_hour_start: sunday.happy_hour_start,
      happy_hour_end: sunday.happy_hour_end
    })));
  };

  const applyAllBusyTime = () => {
    const sunday = hours.find(h => h.day_of_week === 0);
    if (!sunday) return;
    setHours(prev => prev.map(h => ({
      ...h,
      busy_hour_start: sunday.busy_hour_start,
      busy_hour_end: sunday.busy_hour_end
    })));
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      const response = await fetch(`${API_URL}/admin-settings/business-profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Role': 'MANAGER' },
        body: JSON.stringify(profile)
      });
      
      if (response.ok) {
        alert('Basic information has been saved.');
      } else {
        const data = await response.json();
        alert(`Failed to save: ${data.error || 'Unknown error'}`);
      }
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleUploadLogo = async (file: File) => {
    try {
      const localUrl = URL.createObjectURL(file);
      setLogoPreviewUrl(localUrl);
    } catch {}
    const fd = new FormData();
    fd.append('logo', file);
    const res = await fetch(`${API_URL}/admin-settings/business-profile/logo`, { method:'POST', headers:{ 'X-Role': 'MANAGER' as any }, body: fd as any });
    const data = await res.json();
    if (data?.imageUrl) setProfile((p:any)=>({ ...p, logo_url: data.imageUrl }));
  };

  useEffect(() => {
    if (logoPreviewUrl && profile.logo_url) {
      try { URL.revokeObjectURL(logoPreviewUrl); } catch {}
      setLogoPreviewUrl(null);
    }
  }, [profile.logo_url]);

  const handleSaveHours = async () => {
    const payload = hours.map(h => ({
      day_of_week: h.day_of_week,
      open_time: h.open_time,
      close_time: h.close_time,
      is_open: h.is_open,
      break_start: h.break_start || null,
      break_end: h.break_end || null,
      happy_hour_start: h.happy_hour_start || null,
      happy_hour_end: h.happy_hour_end || null,
      busy_hour_start: h.busy_hour_start || null,
      busy_hour_end: h.busy_hour_end || null
    }));
    
    try {
      const response = await fetch(`${API_URL}/admin-settings/business-hours/bulk`, { 
        method:'POST', 
        headers:{ 'Content-Type':'application/json', 'X-Role': 'MANAGER' }, 
        body: JSON.stringify({ businessHours: payload }) 
      });
      
      if (response.ok) {
        alert('Business hours have been saved.');
      } else {
        const data = await response.json();
        alert(`Failed to save: ${data.error || 'Unknown error'}`);
      }
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    }
  };

  // Sync from Firebase
  const handleSyncFromFirebase = async () => {
    if (!restaurantId) {
      alert('Please set the Restaurant ID in the Sync tab first.');
      return;
    }
    setSyncing(true);
    try {
      const res = await fetch(`${API_URL}/admin-settings/business-profile/sync-from-firebase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Role': 'MANAGER' },
        body: JSON.stringify({ restaurantId })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.profile) setProfile(data.profile);
        // Reload hours
        const hoursRes = await fetch(`${API_URL}/admin-settings/business-hours`).then(r=>r.json()).catch(()=>[]);
        if (Array.isArray(hoursRes) && hoursRes.length > 0) {
          const merged = getDefaultHours().map(def => {
            const found = hoursRes.find((hr: any) => hr.day_of_week === def.day_of_week);
            return found ? { ...def, ...found } : def;
          });
          setHours(merged);
        }
        alert(`✅ Synced from Firebase! ${data.hoursUpdated ? `(${data.hoursUpdated} days of hours updated)` : ''}`);
      } else {
        const err = await res.json();
        alert(`❌ Sync failed: ${err.error}`);
      }
    } catch (e: any) {
      alert(`❌ Sync failed: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  // ===== SYNC FUNCTIONS =====
  const saveFirebaseSettings = (url: string, id: string) => {
    setFirebaseUrl(url);
    setRestaurantId(id);
    localStorage.setItem('firebase_admin_url', url);
    localStorage.setItem('firebase_restaurant_id', id);
  };

  const uploadOrderScreenToFirebase = async () => {
    if (!restaurantId) { alert('Please enter the Restaurant ID first.'); return; }
    setSyncStatus(prev => ({ ...prev, orderScreen: { status: 'syncing' } }));
    try {
      const response = await fetch(`${API_URL}/printers/layout-settings`, { method: 'GET', headers: { 'X-Role': 'ADMIN' } });
      if (!response.ok) throw new Error('Failed to fetch layout from POS DB');
      const result = await response.json();
      if (!result.settings) throw new Error('No layout settings found in POS.');
      const uploadResponse = await fetch(`${API_URL}/menu-sync/upload-layout-settings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Role': 'ADMIN' },
        body: JSON.stringify({ restaurantId, layoutSettings: result.settings })
      });
      if (!uploadResponse.ok) { const error = await uploadResponse.json(); throw new Error(error.error || 'Failed'); }
      setSyncStatus(prev => ({ ...prev, orderScreen: { status: 'success', message: 'Layout uploaded!' } }));
      setTimeout(() => setSyncStatus(prev => ({ ...prev, orderScreen: { status: 'idle' } })), 3000);
    } catch (error: any) {
      setSyncStatus(prev => ({ ...prev, orderScreen: { status: 'error', message: error.message } }));
    }
  };

  const downloadOrderScreenFromFirebase = async () => {
    if (!restaurantId) { alert('Please enter the Restaurant ID first.'); return; }
    setSyncStatus(prev => ({ ...prev, orderScreen: { status: 'syncing' } }));
    try {
      const response = await fetch(`${API_URL}/menu-sync/download-layout-settings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Role': 'ADMIN' },
        body: JSON.stringify({ restaurantId })
      });
      if (!response.ok) { const error = await response.json(); throw new Error(error.error || 'Failed'); }
      const result = await response.json();
      await fetch(`${API_URL}/printers/layout-settings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Role': 'ADMIN' },
        body: JSON.stringify({ settings: result.layoutSettings })
      });
      setSyncStatus(prev => ({ ...prev, orderScreen: { status: 'success', message: 'Layout downloaded!' } }));
      setTimeout(() => setSyncStatus(prev => ({ ...prev, orderScreen: { status: 'idle' } })), 3000);
    } catch (error: any) {
      setSyncStatus(prev => ({ ...prev, orderScreen: { status: 'error', message: error.message } }));
    }
  };

  const uploadTableMapToFirebase = async () => {
    if (!restaurantId) { alert('Please enter the Restaurant ID first.'); return; }
    setSyncStatus(prev => ({ ...prev, tableMap: { status: 'syncing' } }));
    try {
      const response = await fetch(`${API_URL}/menu-sync/upload-table-map`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Role': 'ADMIN' },
        body: JSON.stringify({ restaurantId })
      });
      if (!response.ok) { const error = await response.json(); throw new Error(error.error || 'Failed'); }
      const result = await response.json();
      setSyncStatus(prev => ({ ...prev, tableMap: { status: 'success', message: `Uploaded ${result.summary?.elementsUploaded || 0} elements` } }));
      setTimeout(() => setSyncStatus(prev => ({ ...prev, tableMap: { status: 'idle' } })), 3000);
    } catch (error: any) {
      setSyncStatus(prev => ({ ...prev, tableMap: { status: 'error', message: error.message } }));
    }
  };

  const downloadTableMapFromFirebase = async () => {
    if (!restaurantId) { alert('Please enter the Restaurant ID first.'); return; }
    if (!window.confirm('This will overwrite your local table map. Are you sure?')) return;
    setSyncStatus(prev => ({ ...prev, tableMap: { status: 'syncing' } }));
    try {
      const response = await fetch(`${API_URL}/menu-sync/download-table-map`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Role': 'ADMIN' },
        body: JSON.stringify({ restaurantId })
      });
      if (!response.ok) { const error = await response.json(); throw new Error(error.error || 'Failed'); }
      const result = await response.json();
      setSyncStatus(prev => ({ ...prev, tableMap: { status: 'success', message: `Downloaded ${result.summary?.elementsDownloaded || 0} elements` } }));
      setTimeout(() => setSyncStatus(prev => ({ ...prev, tableMap: { status: 'idle' } })), 3000);
    } catch (error: any) {
      setSyncStatus(prev => ({ ...prev, tableMap: { status: 'error', message: error.message } }));
    }
  };

  const uploadMenuToFirebase = async () => {
    if (!restaurantId) { alert('Please enter the Restaurant ID first.'); return; }
    setSyncStatus(prev => ({ ...prev, menu: { status: 'syncing' } }));
    try {
      const response = await fetch(`${API_URL}/menu-sync/sync-to-firebase`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Role': 'ADMIN' },
        body: JSON.stringify({ restaurantId })
      });
      if (!response.ok) { const error = await response.json(); throw new Error(error.error || 'Failed'); }
      const result = await response.json();
      setSyncStatus(prev => ({ ...prev, menu: { status: 'success', message: `Uploaded: ${result.summary?.categoriesUploaded || 0} cats, ${result.summary?.itemsUploaded || 0} items` } }));
      setTimeout(() => setSyncStatus(prev => ({ ...prev, menu: { status: 'idle' } })), 3000);
    } catch (error: any) {
      setSyncStatus(prev => ({ ...prev, menu: { status: 'error', message: error.message } }));
    }
  };

  const downloadMenuFromFirebase = async () => {
    if (!restaurantId) { alert('Please enter the Restaurant ID first.'); return; }
    setSyncStatus(prev => ({ ...prev, menu: { status: 'syncing' } }));
    try {
      const response = await fetch(`${API_URL}/menu-sync/sync-from-firebase`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Role': 'ADMIN' },
        body: JSON.stringify({ restaurantId })
      });
      if (!response.ok) { const error = await response.json(); throw new Error(error.error || 'Failed'); }
      const result = await response.json();
      setSyncStatus(prev => ({ ...prev, menu: { status: 'success', message: `Synced: ${result.summary?.itemsCreated || 0} created, ${result.summary?.itemsUpdated || 0} updated` } }));
      setTimeout(() => setSyncStatus(prev => ({ ...prev, menu: { status: 'idle' } })), 3000);
    } catch (error: any) {
      setSyncStatus(prev => ({ ...prev, menu: { status: 'error', message: error.message } }));
    }
  };

  // Remote sync functions
  const loadRemoteSyncStatus = async () => {
    try {
      const response = await fetch(`${API_URL}/remote-sync/status`, { headers: { 'X-Role': 'ADMIN' } });
      if (response.ok) {
        const data = await response.json();
        setRemoteSyncStatus(data);
        setRemoteSyncEnabled(data.connected);
      }
    } catch (e) { console.error('Failed to load remote sync status:', e); }
  };

  const loadRemoteSyncHistory = async () => {
    try {
      const response = await fetch(`${API_URL}/remote-sync/history`, { headers: { 'X-Role': 'ADMIN' } });
      if (response.ok) {
        const data = await response.json();
        setRemoteSyncHistory(data.history || []);
      }
    } catch (e) { console.error('Failed to load remote sync history:', e); }
  };

  const initializeRemoteSync = async () => {
    if (!restaurantId) { alert('Please enter the Restaurant ID first.'); return; }
    try {
      const response = await fetch(`${API_URL}/remote-sync/initialize`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Role': 'ADMIN' },
        body: JSON.stringify({ restaurantId })
      });
      if (response.ok) {
        const data = await response.json();
        setRemoteSyncStatus(data.status);
        setRemoteSyncEnabled(true);
        alert('✅ Remote sync service started!');
      } else {
        const error = await response.json();
        alert(`❌ Failed: ${error.error}`);
      }
    } catch (e: any) { alert(`❌ Failed: ${e.message}`); }
  };

  const stopRemoteSync = async () => {
    try {
      const response = await fetch(`${API_URL}/remote-sync/stop`, { method: 'POST', headers: { 'X-Role': 'ADMIN' } });
      if (response.ok) {
        setRemoteSyncEnabled(false);
        setRemoteSyncStatus(null);
        alert('Remote sync service stopped.');
      }
    } catch (e: any) { alert(`❌ Failed: ${e.message}`); }
  };

  useEffect(() => {
    if (activeTab === 'sync') {
      loadRemoteSyncStatus();
      loadRemoteSyncHistory();
      const interval = setInterval(() => loadRemoteSyncStatus(), 30000);
      return () => clearInterval(interval);
    }
  }, [activeTab]);

  // Styles (TZO Admin style)
  const styles = {
    sectionTitle: { fontSize: '18px', fontWeight: '600' as const, color: '#1e293b', marginBottom: '16px', marginTop: '24px' },
    basicInfoBox: { backgroundColor: '#f8fafc', borderRadius: '12px', padding: '24px', border: '1px solid #e2e8f0', marginBottom: '24px' },
    basicInfoContainer: { display: 'grid', gridTemplateColumns: '1fr 280px', gap: '24px', alignItems: 'start' },
    basicInfoFields: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' },
    addressRow: { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '16px', gridColumn: 'span 3' },
    formGroup: { marginBottom: '0' },
    label: { display: 'block', fontSize: '13px', fontWeight: '500' as const, color: '#64748b', marginBottom: '6px' },
    input: { width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', backgroundColor: 'white' },
    imageContainer: { display: 'flex', flexDirection: 'column' as const, gap: '16px' },
    imageBox: { 
      width: '100%', height: '100px', border: '2px dashed #cbd5e1', borderRadius: '8px', 
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' as const,
      backgroundColor: '#f8fafc', cursor: 'pointer', transition: 'all 0.2s'
    },
    hoursTable: { width: '100%', borderCollapse: 'collapse' as const, backgroundColor: 'white', borderRadius: '12px', overflow: 'hidden', border: '2px solid #e2e8f0' },
    thCell: { padding: '12px 16px', textAlign: 'center' as const, fontWeight: '600' as const, color: '#1e293b', fontSize: '14px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
    tdCell: { padding: '8px 12px', textAlign: 'center' as const, borderBottom: '1px solid #f1f5f9' },
    dayCell: { padding: '12px 16px', textAlign: 'left' as const, fontWeight: '500' as const, color: '#334155', borderBottom: '1px solid #f1f5f9', minWidth: '100px' },
    timeInput: { padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '13px', width: '100px' },
    applyBtn: { padding: '4px 10px', fontSize: '11px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: '500' as const }
  };

  return (
    <div className="h-screen bg-gray-50 overflow-y-auto">
      <div className="max-w-7xl mx-auto p-6 pb-20">
        {/* Tabs */}
        <div className="mb-4">
          <div className="flex items-end space-x-2 border-b">
            <button 
              onClick={() => setActiveTab('business-info')}
              className={`px-4 py-2 text-sm font-semibold rounded-t ${activeTab === 'business-info' ? 'text-blue-600 border-b-2 border-blue-600 bg-white' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'}`}
            >
              Business Info
            </button>
            <button 
              onClick={() => setActiveTab('sync')}
              className={`px-4 py-2 text-sm font-semibold rounded-t ${activeTab === 'sync' ? 'text-blue-600 border-b-2 border-blue-600 bg-white' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'}`}
            >
              🔄 Sync
            </button>
          </div>
        </div>

        {/* Business Info Tab Content */}
        {activeTab === 'business-info' && (
        <div className="space-y-6">
          
          {/* Restaurant ID Display */}
          {restaurantId && (
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-4 border border-blue-200">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm text-blue-600 font-medium">Restaurant ID:</span>
                  <span className="ml-2 font-mono text-blue-800">{restaurantId}</span>
                </div>
                <button
                  onClick={handleSyncFromFirebase}
                  disabled={syncing}
                  className={`px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-2 ${
                    syncing ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-blue-500 text-white hover:bg-blue-600'
                  }`}
                >
                  {syncing ? '⏳ Syncing...' : '📥 Download from TZO'}
                </button>
              </div>
            </div>
          )}

          {/* Basic Information Section - TZO Style */}
          <h2 style={styles.sectionTitle}>Basic Information</h2>
          <div style={styles.basicInfoBox}>
            {loading ? (
              <div className="text-gray-500">Loading...</div>
            ) : (
              <div style={styles.basicInfoContainer}>
                {/* Left: Form Fields */}
                <div style={styles.basicInfoFields}>
                  {/* First Row: Name, Phone, Email */}
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Restaurant Name</label>
                    <input
                      type="text"
                      value={profile.business_name || ''}
                      onChange={e => setProfile({...profile, business_name: e.target.value})}
                      style={styles.input}
                    />
                  </div>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Phone</label>
                    <input
                      type="text"
                      value={profile.phone || ''}
                      onChange={e => setProfile({...profile, phone: e.target.value})}
                      style={styles.input}
                    />
                  </div>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Email</label>
                    <input
                      type="email"
                      value={profile.email || ''}
                      onChange={e => setProfile({...profile, email: e.target.value})}
                      style={styles.input}
                    />
                  </div>
                  
                  {/* Second Row: Address, City, State, Zip Code */}
                  <div style={styles.addressRow}>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Address</label>
                      <input
                        type="text"
                        value={profile.address_line1 || ''}
                        onChange={e => setProfile({...profile, address_line1: e.target.value})}
                        style={styles.input}
                      />
                    </div>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>City</label>
                      <input
                        type="text"
                        value={profile.city || ''}
                        onChange={e => setProfile({...profile, city: e.target.value})}
                        style={styles.input}
                      />
                    </div>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>State</label>
                      <input
                        type="text"
                        value={profile.state || ''}
                        onChange={e => setProfile({...profile, state: e.target.value})}
                        style={styles.input}
                      />
                    </div>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Zip Code</label>
                      <input
                        type="text"
                        value={profile.zip || ''}
                        onChange={e => setProfile({...profile, zip: e.target.value})}
                        style={styles.input}
                      />
                    </div>
                  </div>
                </div>

                {/* Right: Restaurant Images */}
                <div style={styles.imageContainer}>
                  <div>
                    <label style={styles.label}>Logo</label>
                    <div 
                      style={styles.imageBox}
                      onClick={() => document.getElementById('logo-upload')?.click()}
                    >
                      {(logoPreviewUrl || profile.logo_url) ? (
                        <img src={logoPreviewUrl || profile.logo_url} alt="logo" className="w-full h-full object-contain" />
                      ) : (
                        <>
                          <span className="text-2xl text-gray-400">📷</span>
                          <span className="text-xs text-gray-400 mt-1">Click to upload</span>
                        </>
                      )}
                    </div>
                    <input 
                      id="logo-upload" 
                      type="file" 
                      accept="image/*" 
                      className="hidden" 
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadLogo(f); }} 
                    />
                  </div>
                  <div>
                    <label style={styles.label}>Banner</label>
                    <div style={{ ...styles.imageBox, height: '80px' }}>
                      {profile.banner_url ? (
                        <img src={profile.banner_url} alt="banner" className="w-full h-full object-cover rounded" />
                      ) : (
                        <>
                          <span className="text-2xl text-gray-400">🖼️</span>
                          <span className="text-xs text-gray-400 mt-1">Synced from TZO</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {/* Save Button */}
            <div className="flex justify-end mt-4 pt-4 border-t border-gray-200">
              <button 
                disabled={saving} 
                className="px-6 py-2 bg-green-500 text-white rounded-lg font-medium hover:bg-green-600 disabled:opacity-50"
                onClick={handleSaveProfile}
              >
                {saving ? 'Saving...' : '✓ Save Basic Info'}
              </button>
            </div>
          </div>

          {/* Business Hours Section - TZO Style Table */}
          <h2 style={styles.sectionTitle}>Business Hours</h2>
          <div className="overflow-x-auto">
            <table style={styles.hoursTable}>
              <thead>
                <tr>
                  <th style={{ ...styles.thCell, textAlign: 'left', minWidth: '100px' }}>Day</th>
                  <th style={styles.thCell}>
                    <div className="flex items-center justify-center gap-2">
                      <span>Business Hours</span>
                      <button onClick={applyAllBusinessHours} style={styles.applyBtn}>Apply All</button>
                    </div>
                  </th>
                  <th style={styles.thCell}>
                    <div className="flex items-center justify-center gap-2">
                      <span>Break Time</span>
                      <button onClick={applyAllBreakTime} style={styles.applyBtn}>Apply All</button>
                    </div>
                  </th>
                  <th style={styles.thCell}>
                    <div className="flex items-center justify-center gap-2">
                      <span>Happy Hour</span>
                      <button onClick={applyAllHappyHour} style={styles.applyBtn}>Apply All</button>
                    </div>
                  </th>
                  <th style={styles.thCell}>
                    <div className="flex items-center justify-center gap-2">
                      <span>Busy Time</span>
                      <button onClick={applyAllBusyTime} style={styles.applyBtn}>Apply All</button>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {hours.map((hour) => (
                  <tr key={hour.day_of_week} className={hour.is_open ? '' : 'bg-gray-50 opacity-60'}>
                    <td style={styles.dayCell}>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={hour.is_open === 1}
                          onChange={e => updateHour(hour.day_of_week, 'is_open', e.target.checked)}
                          className="w-4 h-4"
                        />
                        <span>{DAY_NAMES[hour.day_of_week]}</span>
                      </div>
                    </td>
                    <td style={styles.tdCell}>
                      <div className="flex items-center justify-center gap-1">
                        <input
                          type="time"
                          value={hour.open_time}
                          onChange={e => updateHour(hour.day_of_week, 'open_time', e.target.value)}
                          style={styles.timeInput}
                          disabled={!hour.is_open}
                        />
                        <span className="text-gray-400">~</span>
                        <input
                          type="time"
                          value={hour.close_time}
                          onChange={e => updateHour(hour.day_of_week, 'close_time', e.target.value)}
                          style={styles.timeInput}
                          disabled={!hour.is_open}
                        />
                      </div>
                    </td>
                    <td style={styles.tdCell}>
                      <div className="flex items-center justify-center gap-1">
                        <input
                          type="time"
                          value={hour.break_start || ''}
                          onChange={e => updateHour(hour.day_of_week, 'break_start', e.target.value)}
                          style={styles.timeInput}
                          disabled={!hour.is_open}
                        />
                        <span className="text-gray-400">~</span>
                        <input
                          type="time"
                          value={hour.break_end || ''}
                          onChange={e => updateHour(hour.day_of_week, 'break_end', e.target.value)}
                          style={styles.timeInput}
                          disabled={!hour.is_open}
                        />
                      </div>
                    </td>
                    <td style={styles.tdCell}>
                      <div className="flex items-center justify-center gap-1">
                        <input
                          type="time"
                          value={hour.happy_hour_start || ''}
                          onChange={e => updateHour(hour.day_of_week, 'happy_hour_start', e.target.value)}
                          style={styles.timeInput}
                          disabled={!hour.is_open}
                        />
                        <span className="text-gray-400">~</span>
                        <input
                          type="time"
                          value={hour.happy_hour_end || ''}
                          onChange={e => updateHour(hour.day_of_week, 'happy_hour_end', e.target.value)}
                          style={styles.timeInput}
                          disabled={!hour.is_open}
                        />
                      </div>
                    </td>
                    <td style={styles.tdCell}>
                      <div className="flex items-center justify-center gap-1">
                        <input
                          type="time"
                          value={hour.busy_hour_start || ''}
                          onChange={e => updateHour(hour.day_of_week, 'busy_hour_start', e.target.value)}
                          style={styles.timeInput}
                          disabled={!hour.is_open}
                        />
                        <span className="text-gray-400">~</span>
                        <input
                          type="time"
                          value={hour.busy_hour_end || ''}
                          onChange={e => updateHour(hour.day_of_week, 'busy_hour_end', e.target.value)}
                          style={styles.timeInput}
                          disabled={!hour.is_open}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {/* Save Hours Button */}
          <div className="flex justify-end mt-4">
            <button 
              className="px-6 py-2 bg-green-500 text-white rounded-lg font-medium hover:bg-green-600"
              onClick={handleSaveHours}
            >
              ✓ Save Business Hours
            </button>
          </div>

          {/* Online Order Integration Link */}
          <div className="bg-gradient-to-r from-orange-50 to-amber-50 rounded-lg shadow p-4 border border-orange-200 mt-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold flex items-center gap-2">
                  🔥 Online Order Integration
                </h2>
                <p className="text-sm text-gray-600 mt-1">
                  Thezoneorder menu sync has moved to Menu Manager
                </p>
              </div>
              <NavLink 
                to="/backoffice/menus"
                className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition font-medium"
              >
                Go to Thezoneorder Sync
              </NavLink>
            </div>
          </div>

          {/* App Version Info */}
          <div className="bg-gradient-to-r from-slate-100 to-gray-100 rounded-lg shadow p-4 border border-slate-200 mt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-slate-800 rounded-lg flex items-center justify-center">
                  <span className="text-white text-xl font-bold">P</span>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800">TheZonePOS</h3>
                  <p className="text-sm text-slate-600">Restaurant Point of Sale System</p>
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-slate-800">
                  v{appVersion?.version || '---'}
                </div>
                <p className="text-xs text-slate-500">
                  {appVersion?.releaseDate ? `Released: ${appVersion.releaseDate}` : ''}
                </p>
              </div>
            </div>
            {appVersion?.releaseNotes && (
              <div className="mt-3 pt-3 border-t border-slate-200">
                <p className="text-xs text-slate-500">
                  <span className="font-medium">Release Notes:</span> {appVersion.releaseNotes}
                </p>
              </div>
            )}
          </div>
        </div>
        )}

        {/* Sync Tab Content */}
        {activeTab === 'sync' && (
          <div className="space-y-6">
            {/* Firebase Connection Settings */}
            <div className="bg-gradient-to-r from-slate-800 to-slate-900 rounded-lg shadow p-6 text-white">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">🔌 Thezoneorder Connection</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Restaurant ID (from Thezoneorder Admin)</label>
                  <input
                    type="text"
                    value={restaurantId}
                    onChange={e => saveFirebaseSettings(firebaseUrl, e.target.value)}
                    placeholder="e.g., abc123xyz"
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-gray-400"
                  />
                </div>
                <div className="flex items-end">
                  <p className="text-sm text-gray-400">Find your Restaurant ID in Thezoneorder Admin → Settings → Basic Info</p>
                </div>
              </div>
            </div>

            {/* Remote Sync Section */}
            <div className="bg-gradient-to-r from-purple-800 to-indigo-900 rounded-lg shadow p-6 text-white">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">📡 Remote Sync (Real-time)</h2>
              <p className="text-purple-200 text-sm mb-4">Enable remote sync to allow Thezoneorder Admin to push/pull data directly to this POS.</p>
              
              <div className={`mb-4 p-4 rounded-lg ${remoteSyncEnabled ? 'bg-green-900/50 border border-green-500' : 'bg-slate-700 border border-slate-600'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{remoteSyncEnabled ? '🟢' : '🔴'}</span>
                    <div>
                      <div className="font-semibold">{remoteSyncEnabled ? 'Listening for sync requests' : 'Remote Sync Disabled'}</div>
                      {remoteSyncStatus && (
                        <div className="text-sm text-purple-200">
                          Version: {remoteSyncStatus.version} | Queue: {remoteSyncStatus.queueLength}
                          {remoteSyncStatus.isProcessing && ' | ⏳ Processing...'}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {!remoteSyncEnabled ? (
                      <button
                        onClick={initializeRemoteSync}
                        disabled={!restaurantId}
                        className={`px-4 py-2 rounded font-semibold transition ${!restaurantId ? 'bg-gray-500 cursor-not-allowed' : 'bg-green-500 hover:bg-green-600'}`}
                      >
                        ▶️ Start Listening
                      </button>
                    ) : (
                      <button onClick={stopRemoteSync} className="px-4 py-2 bg-red-500 hover:bg-red-600 rounded font-semibold transition">
                        ⏹️ Stop
                      </button>
                    )}
                    <button onClick={loadRemoteSyncStatus} className="px-3 py-2 bg-slate-600 hover:bg-slate-500 rounded transition">🔄</button>
                  </div>
                </div>
              </div>

              {remoteSyncHistory.length > 0 && (
                <div className="mt-4">
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="font-semibold text-purple-200">Recent Sync History</h4>
                    <button onClick={loadRemoteSyncHistory} className="text-xs text-purple-300 hover:text-white">🔄 Refresh</button>
                  </div>
                  <div className="bg-slate-800 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                    {remoteSyncHistory.slice(0, 10).map((item: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between px-3 py-2 border-b border-slate-700 text-sm">
                        <div className="flex items-center gap-2">
                          <span>{item.success ? '✅' : '❌'}</span>
                          <span>{item.type}</span>
                        </div>
                        <div className="text-slate-400 text-xs">{item.duration}ms | {new Date(item.createdAt).toLocaleString()}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Manual Sync Cards */}
            <h3 className="text-lg font-semibold text-slate-700 mt-6 mb-2">📤📥 Manual Sync (Direct Connection)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Menu Sync Card */}
              <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg shadow p-6 border border-green-200">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-3xl">🍽️</span>
                  <div>
                    <h3 className="text-lg font-bold text-green-800">Menu</h3>
                    <p className="text-sm text-green-600">Categories, Items, Modifiers</p>
                  </div>
                </div>
                {syncStatus.menu.status === 'success' && <div className="mb-4 p-3 bg-green-100 border border-green-300 rounded text-green-700 text-sm">✅ {syncStatus.menu.message}</div>}
                {syncStatus.menu.status === 'error' && <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded text-red-700 text-sm">❌ {syncStatus.menu.message}</div>}
                <div className="flex gap-3">
                  <button onClick={() => setDangerousAction({
                    isOpen: true,
                    title: 'Upload Menu to TZO Cloud',
                    description: 'This will overwrite ALL menu data currently stored on TZO Cloud with your local POS menu.',
                    warningItems: [
                      'All existing cloud menu data will be replaced',
                      'Other devices syncing from cloud will receive this menu',
                      'A backup will be created before upload'
                    ],
                    confirmPhrase: 'UPLOAD',
                    onConfirm: uploadMenuToFirebase
                  })} disabled={syncStatus.menu.status === 'syncing' || !restaurantId}
                    className={`flex-1 px-4 py-3 rounded-lg font-semibold transition ${syncStatus.menu.status === 'syncing' || !restaurantId ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-green-500 text-white hover:bg-green-600'}`}>
                    {syncStatus.menu.status === 'syncing' ? '⏳ Syncing...' : '🔒 Upload to TZO'}
                  </button>
                  <button onClick={() => setDangerousAction({
                    isOpen: true,
                    title: 'Download Menu from TZO Cloud',
                    description: 'This will overwrite your local POS menu with data from TZO Cloud.',
                    warningItems: [
                      'Your current POS menu will be replaced',
                      'Menu item links (modifiers, tax, printer) may change',
                      'A local backup will be created before download'
                    ],
                    confirmPhrase: 'DOWNLOAD',
                    onConfirm: downloadMenuFromFirebase
                  })} disabled={syncStatus.menu.status === 'syncing' || !restaurantId}
                    className={`flex-1 px-4 py-3 rounded-lg font-semibold transition ${syncStatus.menu.status === 'syncing' || !restaurantId ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}>
                    {syncStatus.menu.status === 'syncing' ? '⏳ Syncing...' : '🔒 Download from TZO'}
                  </button>
                </div>
              </div>

              {/* Order Screen Layout Card */}
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg shadow p-6 border border-blue-200">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-3xl">📱</span>
                  <div>
                    <h3 className="text-lg font-bold text-blue-800">Order Screen Layout</h3>
                    <p className="text-sm text-blue-600">Colors, Grid, Button Settings</p>
                  </div>
                </div>
                {syncStatus.orderScreen.status === 'success' && <div className="mb-4 p-3 bg-blue-100 border border-blue-300 rounded text-blue-700 text-sm">✅ {syncStatus.orderScreen.message}</div>}
                {syncStatus.orderScreen.status === 'error' && <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded text-red-700 text-sm">❌ {syncStatus.orderScreen.message}</div>}
                <div className="flex gap-3">
                  <button onClick={uploadOrderScreenToFirebase} disabled={syncStatus.orderScreen.status === 'syncing' || !restaurantId}
                    className={`flex-1 px-4 py-3 rounded-lg font-semibold transition ${syncStatus.orderScreen.status === 'syncing' || !restaurantId ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-blue-500 text-white hover:bg-blue-600'}`}>
                    {syncStatus.orderScreen.status === 'syncing' ? '⏳ Syncing...' : '⬆️ Upload to TZO'}
                  </button>
                  <button onClick={downloadOrderScreenFromFirebase} disabled={syncStatus.orderScreen.status === 'syncing' || !restaurantId}
                    className={`flex-1 px-4 py-3 rounded-lg font-semibold transition ${syncStatus.orderScreen.status === 'syncing' || !restaurantId ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>
                    {syncStatus.orderScreen.status === 'syncing' ? '⏳ Syncing...' : '⬇️ Download from TZO'}
                  </button>
                </div>
              </div>

              {/* Table Map Card */}
              <div className="bg-gradient-to-br from-amber-50 to-yellow-50 rounded-lg shadow p-6 border border-amber-200">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-3xl">🗺️</span>
                  <div>
                    <h3 className="text-lg font-bold text-amber-800">Table Map</h3>
                    <p className="text-sm text-amber-600">Tables, Floors, Layout</p>
                  </div>
                </div>
                {syncStatus.tableMap.status === 'success' && <div className="mb-4 p-3 bg-green-100 border border-green-300 rounded text-green-700 text-sm">✅ {syncStatus.tableMap.message}</div>}
                {syncStatus.tableMap.status === 'error' && <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded text-red-700 text-sm">❌ {syncStatus.tableMap.message}</div>}
                <div className="flex gap-3">
                  <button onClick={uploadTableMapToFirebase} disabled={syncStatus.tableMap.status === 'syncing' || !restaurantId}
                    className={`flex-1 px-4 py-3 rounded-lg font-semibold transition ${syncStatus.tableMap.status === 'syncing' || !restaurantId ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-amber-500 text-white hover:bg-amber-600'}`}>
                    {syncStatus.tableMap.status === 'syncing' ? '⏳ Syncing...' : '⬆️ Upload to TZO'}
                  </button>
                  <button onClick={downloadTableMapFromFirebase} disabled={syncStatus.tableMap.status === 'syncing' || !restaurantId}
                    className={`flex-1 px-4 py-3 rounded-lg font-semibold transition ${syncStatus.tableMap.status === 'syncing' || !restaurantId ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-yellow-600 text-white hover:bg-yellow-700'}`}>
                    {syncStatus.tableMap.status === 'syncing' ? '⏳ Syncing...' : '⬇️ Download from TZO'}
                  </button>
                </div>
              </div>

              {/* Promotions Card (Coming Soon) */}
              <div className="bg-gradient-to-br from-pink-50 to-rose-50 rounded-lg shadow p-6 border border-pink-200 opacity-60">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-3xl">🎁</span>
                  <div>
                    <h3 className="text-lg font-bold text-pink-800">Promotions</h3>
                    <span className="px-2 py-0.5 bg-pink-200 text-pink-700 text-xs rounded-full">Coming Soon</span>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button disabled className="flex-1 px-4 py-3 bg-gray-200 text-gray-400 rounded-lg cursor-not-allowed">⬆️ Upload</button>
                  <button disabled className="flex-1 px-4 py-3 bg-gray-200 text-gray-400 rounded-lg cursor-not-allowed">⬇️ Download</button>
                </div>
              </div>
            </div>

            {/* Sync Direction Guide */}
            <div className="bg-white rounded-lg shadow p-6 border mt-6">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2">ℹ️ Sync Direction Guide</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm text-gray-600">
                <div className="p-4 bg-green-50 rounded-lg border border-green-100">
                  <p className="font-semibold text-green-700 mb-2">⬆️ Upload to TZO</p>
                  <p>Send your local POS data to the cloud. Use this when you've made changes in POS and want them reflected online.</p>
                </div>
                <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
                  <p className="font-semibold text-blue-700 mb-2">⬇️ Download from TZO</p>
                  <p>Get the latest data from the cloud to your local POS. Use this after editing in Thezoneorder Admin or when setting up a new POS.</p>
                </div>
              </div>
            </div>

            {/* Reset Setup Section */}
            <div className="bg-gradient-to-r from-red-800 to-red-900 rounded-lg shadow p-6 text-white mt-6">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2">🔄 Reset Setup (새 매장 설정)</h3>
              <p className="text-sm text-red-200 mb-4">
                새로운 매장으로 POS를 설정하려면 Reset 버튼을 눌러주세요. 
                앱을 재시작하면 Setup 화면이 나타납니다.
              </p>
              <button 
                onClick={async () => {
                  if (!window.confirm('정말로 Setup을 초기화하시겠습니까?\n\n앱을 재시작하면 새로운 매장 설정 화면이 나타납니다.')) return;
                  try {
                    const res = await fetch(`${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/api/firebase-setup/reset`, { method: 'DELETE' });
                    const data = await res.json();
                    if (data.success) {
                      alert('✅ Setup 초기화 완료!\n\n앱을 재시작해주세요.');
                    } else {
                      alert('❌ 오류: ' + (data.error || 'Unknown error'));
                    }
                  } catch (err: any) {
                    alert('❌ 오류: ' + err.message);
                  }
                }}
                className="px-6 py-3 bg-red-600 hover:bg-red-500 rounded-lg font-semibold transition border-2 border-red-400"
              >
                🔄 Reset Setup (새 매장 연결)
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Dangerous Action Lock Modal */}
      <DangerousActionModal
        isOpen={dangerousAction.isOpen}
        onClose={() => setDangerousAction(prev => ({ ...prev, isOpen: false }))}
        onConfirm={() => {
          setDangerousAction(prev => ({ ...prev, isOpen: false }));
          dangerousAction.onConfirm();
        }}
        title={dangerousAction.title}
        description={dangerousAction.description}
        warningItems={dangerousAction.warningItems}
        confirmPhrase={dangerousAction.confirmPhrase}
      />
    </div>
  );
};

export default BasicInfoPage;


