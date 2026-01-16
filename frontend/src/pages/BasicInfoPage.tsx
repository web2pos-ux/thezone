import React, { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { API_URL } from '../config/constants';

type TabType = 'business-info' | 'sync';

const BasicInfoPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('business-info');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<any>({
    business_name: '',
    tax_number: '',
    phone: '',
    address_line1: '',
    address_line2: '',
    city: '',
    state: '',
    zip: '',
    country: '',
    logo_url: ''
  });
  const [hours, setHours] = useState<Array<{ day_of_week: number; open_time: string; close_time: string; is_open: number }>>([]);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);

  // Sync Tab States
  const [firebaseUrl, setFirebaseUrl] = useState(() => localStorage.getItem('firebase_admin_url') || 'https://thezoneorder.com');
  const [restaurantId, setRestaurantId] = useState(() => localStorage.getItem('firebase_restaurant_id') || '');
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

  // Load profile
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [p, h] = await Promise.all([
          fetch(`${API_URL}/admin-settings/business-profile`).then(r=>r.json()).catch(()=>null),
          fetch(`${API_URL}/admin-settings/business-hours`).then(r=>r.json()).catch(()=>[])
        ]);
        if (p) setProfile(p);
        if (Array.isArray(h)) setHours(h);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const updateHour = (idx: number, field: 'is_open'|'open_time'|'close_time', value: any) => {
    setHours(prev => {
      const copy = [...prev];
      if (!copy[idx]) copy[idx] = { day_of_week: idx, open_time: '11:00', close_time: '21:00', is_open: 1 } as any;
      copy[idx] = { ...copy[idx], [field]: field==='is_open' ? (value ? 1 : 0) : value } as any;
      return copy;
    });
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      await fetch(`${API_URL}/admin-settings/business-profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Role': 'MANAGER' },
        body: JSON.stringify(profile)
      });
      alert('Basic information has been saved.');
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
    const payload = (hours && hours.length ? hours : Array.from({length:7}).map((_,i)=>({ day_of_week:i, open_time:'11:00', close_time:'21:00', is_open:1 })));
    await fetch(`${API_URL}/admin-settings/business-hours`, { method:'PUT', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ businessHours: payload }) });
    alert('Business hours have been saved.');
  };

  // ===== SYNC FUNCTIONS =====
  
  // Save Firebase settings to localStorage
  const saveFirebaseSettings = (url: string, id: string) => {
    setFirebaseUrl(url);
    setRestaurantId(id);
    localStorage.setItem('firebase_admin_url', url);
    localStorage.setItem('firebase_restaurant_id', id);
  };

  // Upload Order Screen Layout to Firebase
  const uploadOrderScreenToFirebase = async () => {
    if (!restaurantId) {
      alert('Please enter the Restaurant ID first.');
      return;
    }
    
    setSyncStatus(prev => ({ ...prev, orderScreen: { status: 'syncing' } }));
    
    try {
      // Get layout from POS DB
      const response = await fetch(`${API_URL}/printers/layout-settings`, {
        method: 'GET',
        headers: { 'X-Role': 'ADMIN' }
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch layout from POS DB');
      }
      
      const result = await response.json();
      
      if (!result.settings) {
        throw new Error('No layout settings found in POS. Configure Order Screen first.');
      }
      
      // Note: This would require Firebase Admin SDK on POS backend
      // For now, we'll use the menu-sync endpoint which already has Firebase access
      const uploadResponse = await fetch(`${API_URL}/menu-sync/upload-layout-settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Role': 'ADMIN'
        },
        body: JSON.stringify({
          restaurantId,
          layoutSettings: result.settings
        })
      });
      
      if (!uploadResponse.ok) {
        const error = await uploadResponse.json();
        throw new Error(error.error || 'Failed to upload layout to Firebase');
      }
      
      setSyncStatus(prev => ({
        ...prev,
        orderScreen: { status: 'success', message: 'Layout uploaded to Thezoneorder!' }
      }));
      
      setTimeout(() => {
        setSyncStatus(prev => ({ ...prev, orderScreen: { status: 'idle' } }));
      }, 3000);
      
    } catch (error: any) {
      console.error('Upload Order Screen failed:', error);
      setSyncStatus(prev => ({
        ...prev,
        orderScreen: { status: 'error', message: error.message || 'Failed to upload layout' }
      }));
    }
  };

  // Download Order Screen Layout from Firebase
  const downloadOrderScreenFromFirebase = async () => {
    if (!restaurantId) {
      alert('Please enter the Restaurant ID first.');
      return;
    }
    
    setSyncStatus(prev => ({ ...prev, orderScreen: { status: 'syncing' } }));
    
    try {
      // Download from Firebase via POS backend
      const response = await fetch(`${API_URL}/menu-sync/download-layout-settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Role': 'ADMIN'
        },
        body: JSON.stringify({ restaurantId })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to download layout from Firebase');
      }
      
      const result = await response.json();
      
      // Save to POS DB
      await fetch(`${API_URL}/printers/layout-settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Role': 'ADMIN'
        },
        body: JSON.stringify({ settings: result.layoutSettings })
      });
      
      setSyncStatus(prev => ({
        ...prev,
        orderScreen: { status: 'success', message: 'Layout downloaded from Thezoneorder!' }
      }));
      
      setTimeout(() => {
        setSyncStatus(prev => ({ ...prev, orderScreen: { status: 'idle' } }));
      }, 3000);
      
    } catch (error: any) {
      console.error('Download Order Screen failed:', error);
      setSyncStatus(prev => ({
        ...prev,
        orderScreen: { status: 'error', message: error.message || 'Failed to download layout' }
      }));
    }
  };

  // Upload Table Map to Firebase
  const uploadTableMapToFirebase = async () => {
    if (!restaurantId) {
      alert('Please enter the Restaurant ID first.');
      return;
    }
    
    setSyncStatus(prev => ({ ...prev, tableMap: { status: 'syncing' } }));
    
    try {
      const response = await fetch(`${API_URL}/menu-sync/upload-table-map`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Role': 'ADMIN'
        },
        body: JSON.stringify({ restaurantId })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to upload table map to Firebase');
      }
      
      const result = await response.json();
      
      setSyncStatus(prev => ({
        ...prev,
        tableMap: { 
          status: 'success', 
          message: `Table map uploaded! Elements: ${result.summary?.elementsUploaded || 0}` 
        }
      }));
      
      setTimeout(() => {
        setSyncStatus(prev => ({ ...prev, tableMap: { status: 'idle' } }));
      }, 3000);
      
    } catch (error: any) {
      console.error('Upload Table Map failed:', error);
      setSyncStatus(prev => ({
        ...prev,
        tableMap: { status: 'error', message: error.message || 'Failed to upload table map' }
      }));
    }
  };

  // Download Table Map from Firebase
  const downloadTableMapFromFirebase = async () => {
    if (!restaurantId) {
      alert('Please enter the Restaurant ID first.');
      return;
    }
    
    if (!window.confirm('This will overwrite your local table map. Are you sure?')) {
      return;
    }
    
    setSyncStatus(prev => ({ ...prev, tableMap: { status: 'syncing' } }));
    
    try {
      const response = await fetch(`${API_URL}/menu-sync/download-table-map`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Role': 'ADMIN'
        },
        body: JSON.stringify({ restaurantId })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to download table map from Firebase');
      }
      
      const result = await response.json();
      
      setSyncStatus(prev => ({
        ...prev,
        tableMap: { 
          status: 'success', 
          message: `Table map downloaded! Elements: ${result.summary?.elementsDownloaded || 0}` 
        }
      }));
      
      setTimeout(() => {
        setSyncStatus(prev => ({ ...prev, tableMap: { status: 'idle' } }));
      }, 3000);
      
    } catch (error: any) {
      console.error('Download Table Map failed:', error);
      setSyncStatus(prev => ({
        ...prev,
        tableMap: { status: 'error', message: error.message || 'Failed to download table map' }
      }));
    }
  };

  // Upload Menu to Firebase
  const uploadMenuToFirebase = async () => {
    if (!restaurantId) {
      alert('Please enter the Restaurant ID first.');
      return;
    }
    
    setSyncStatus(prev => ({ ...prev, menu: { status: 'syncing' } }));
    
    try {
      const response = await fetch(`${API_URL}/menu-sync/sync-to-firebase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Role': 'ADMIN'
        },
        body: JSON.stringify({ restaurantId })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to upload menu to Firebase');
      }
      
      const result = await response.json();
      
      setSyncStatus(prev => ({
        ...prev,
        menu: { 
          status: 'success', 
          message: `Menu uploaded! Categories: ${result.summary?.categoriesUploaded || 0}, Items: ${result.summary?.itemsUploaded || 0}` 
        }
      }));
      
      setTimeout(() => {
        setSyncStatus(prev => ({ ...prev, menu: { status: 'idle' } }));
      }, 3000);
      
    } catch (error: any) {
      console.error('Upload Menu failed:', error);
      setSyncStatus(prev => ({
        ...prev,
        menu: { status: 'error', message: error.message || 'Failed to upload menu' }
      }));
    }
  };

  // ===== REMOTE SYNC FUNCTIONS =====
  
  // Load remote sync status
  const loadRemoteSyncStatus = async () => {
    try {
      const response = await fetch(`${API_URL}/remote-sync/status`, {
        headers: { 'X-Role': 'ADMIN' }
      });
      if (response.ok) {
        const data = await response.json();
        setRemoteSyncStatus(data);
        setRemoteSyncEnabled(data.connected);
      }
    } catch (e) {
      console.error('Failed to load remote sync status:', e);
    }
  };

  // Load remote sync history
  const loadRemoteSyncHistory = async () => {
    try {
      const response = await fetch(`${API_URL}/remote-sync/history`, {
        headers: { 'X-Role': 'ADMIN' }
      });
      if (response.ok) {
        const data = await response.json();
        setRemoteSyncHistory(data.history || []);
      }
    } catch (e) {
      console.error('Failed to load remote sync history:', e);
    }
  };

  // Initialize remote sync service
  const initializeRemoteSync = async () => {
    if (!restaurantId) {
      alert('Please enter the Restaurant ID first.');
      return;
    }

    try {
      const response = await fetch(`${API_URL}/remote-sync/initialize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Role': 'ADMIN'
        },
        body: JSON.stringify({ restaurantId })
      });

      if (response.ok) {
        const data = await response.json();
        setRemoteSyncStatus(data.status);
        setRemoteSyncEnabled(true);
        alert('✅ Remote sync service started! POS is now listening for sync requests from Thezoneorder.');
      } else {
        const error = await response.json();
        alert(`❌ Failed to start remote sync: ${error.error}`);
      }
    } catch (e: any) {
      alert(`❌ Failed to start remote sync: ${e.message}`);
    }
  };

  // Stop remote sync service
  const stopRemoteSync = async () => {
    try {
      const response = await fetch(`${API_URL}/remote-sync/stop`, {
        method: 'POST',
        headers: { 'X-Role': 'ADMIN' }
      });

      if (response.ok) {
        setRemoteSyncEnabled(false);
        setRemoteSyncStatus(null);
        alert('Remote sync service stopped.');
      }
    } catch (e: any) {
      alert(`❌ Failed to stop remote sync: ${e.message}`);
    }
  };

  // Load remote sync data when Sync tab is active
  useEffect(() => {
    if (activeTab === 'sync') {
      loadRemoteSyncStatus();
      loadRemoteSyncHistory();
      
      // Refresh every 30 seconds
      const interval = setInterval(() => {
        loadRemoteSyncStatus();
      }, 30000);

      return () => clearInterval(interval);
    }
  }, [activeTab]);

  // Download Menu from Firebase
  const downloadMenuFromFirebase = async () => {
    if (!restaurantId) {
      alert('Please enter the Restaurant ID first.');
      return;
    }
    
    setSyncStatus(prev => ({ ...prev, menu: { status: 'syncing' } }));
    
    try {
      const response = await fetch(`${API_URL}/menu-sync/sync-from-firebase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Role': 'ADMIN'
        },
        body: JSON.stringify({ restaurantId })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to download menu from Firebase');
      }
      
      const result = await response.json();
      
      setSyncStatus(prev => ({
        ...prev,
        menu: { 
          status: 'success', 
          message: `Menu synced! Created: ${result.summary?.itemsCreated || 0}, Updated: ${result.summary?.itemsUpdated || 0}` 
        }
      }));
      
      setTimeout(() => {
        setSyncStatus(prev => ({ ...prev, menu: { status: 'idle' } }));
      }, 3000);
      
    } catch (error: any) {
      console.error('Download Menu failed:', error);
      setSyncStatus(prev => ({
        ...prev,
        menu: { status: 'error', message: error.message || 'Failed to download menu' }
      }));
    }
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
          <div className="bg-white rounded-lg shadow p-4">
            <h2 className="text-xl font-bold mb-4">Business Info</h2>
            {loading ? (
              <div className="text-gray-500">Loading...</div>
            ) : (
              <div className="space-y-4">
                {/* Row 1: Business Name (4), Phone (3), Tax ID (3) */}
                <div className="grid grid-cols-1 md:grid-cols-10 gap-4">
                  <div className="md:col-span-4">
                    <label className="block text-sm text-gray-600 mb-1">Business Name</label>
                    <input className="w-full px-3 py-2 border rounded" value={profile.business_name||''} onChange={e=>setProfile({...profile, business_name:e.target.value})} placeholder="Business name" />
                  </div>
                  <div className="md:col-span-3">
                    <label className="block text-sm text-gray-600 mb-1">Phone</label>
                    <input className="w-full px-3 py-2 border rounded" value={profile.phone||''} onChange={e=>setProfile({...profile, phone:e.target.value})} placeholder="Phone number" />
                  </div>
                  <div className="md:col-span-3">
                    <label className="block text-sm text-gray-600 mb-1">Tax ID</label>
                    <input className="w-full px-3 py-2 border rounded" value={profile.tax_number||''} onChange={e=>setProfile({...profile, tax_number:e.target.value})} placeholder="Tax ID" />
                  </div>
                </div>

                {/* Row 2: Address1 (5), Address2 (5) */}
                <div className="grid grid-cols-1 md:grid-cols-10 gap-4">
                  <div className="md:col-span-5">
                    <label className="block text-sm text-gray-600 mb-1">Address Line 1</label>
                    <input className="w-full px-3 py-2 border rounded" value={profile.address_line1||''} onChange={e=>setProfile({...profile, address_line1:e.target.value})} placeholder="Address line 1" />
                  </div>
                  <div className="md:col-span-5">
                    <label className="block text-sm text-gray-600 mb-1">Address Line 2</label>
                    <input className="w-full px-3 py-2 border rounded" value={profile.address_line2||''} onChange={e=>setProfile({...profile, address_line2:e.target.value})} placeholder="Address line 2 (optional)" />
                  </div>
                </div>

                {/* Row 3: City, State, Country, Zip, Logo with 1.7:1.7:1.7:1.7:3.2 ratio */}
                <div className="grid grid-cols-1 gap-4 items-end md:grid-cols-none md:[grid-template-columns:1.7fr_1.7fr_1.7fr_1.7fr_3.2fr]">
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">City</label>
                    <input className="w-full px-3 py-2 border rounded" value={profile.city||''} onChange={e=>setProfile({...profile, city:e.target.value})} />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">State</label>
                    <input className="w-full px-3 py-2 border rounded" value={profile.state||''} onChange={e=>setProfile({...profile, state:e.target.value})} />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Country</label>
                    <input className="w-full px-3 py-2 border rounded" value={profile.country||''} onChange={e=>setProfile({...profile, country:e.target.value})} />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Zip Code</label>
                    <input className="w-full px-3 py-2 border rounded" value={profile.zip||''} onChange={e=>setProfile({...profile, zip:e.target.value})} placeholder="Zip code" />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Logo</label>
                    <div className="flex items-center gap-3">
                      {(logoPreviewUrl || profile.logo_url) ? (
                        <img src={logoPreviewUrl || profile.logo_url} alt="logo" className="w-16 h-16 object-contain border" />
                      ) : (
                        <div className="w-16 h-16 border flex items-center justify-center text-xs text-gray-400">No Logo</div>
                      )}
                      <input type="file" accept="image/*" onChange={e=>{ const f=e.target.files?.[0]; if (f) handleUploadLogo(f); }} />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50" onClick={handleSaveProfile}>Save</button>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left: Business Hours */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="text-xl font-bold mb-4">Business Hours</h2>
              <div className="space-y-1.5">
                {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day, i) => (
                  <div
                    key={i}
                    className="grid items-center gap-1 grid-cols-1 md:[grid-template-columns:1.5fr_1.2fr_4fr_1.5fr]"
                  >
                    {/* Day label */}
                    <div className="text-sm font-medium text-gray-700">{day}</div>

                    {/* Open toggle */}
                    <div className="flex items-center gap-1">
                      <label className="text-sm text-gray-600">Open</label>
                      <input
                        type="checkbox"
                        checked={(hours.find(h=>h.day_of_week===i)?.is_open||0)===1}
                        onChange={e=>updateHour(i,'is_open',e.target.checked)}
                      />
                    </div>

                    {/* Time range - tighter gap for space efficiency */}
                    <div className="flex items-center gap-1">
                      <input
                        type="time"
                        className="px-2 py-1 border rounded"
                        value={hours.find(h=>h.day_of_week===i)?.open_time||'11:00'}
                        onChange={e=>updateHour(i,'open_time',e.target.value)}
                      />
                      <span className="text-gray-500">~</span>
                      <input
                        type="time"
                        className="px-2 py-1 border rounded"
                        value={hours.find(h=>h.day_of_week===i)?.close_time||'21:00'}
                        onChange={e=>updateHour(i,'close_time',e.target.value)}
                      />
                    </div>

                    {/* Copy button column - inline on the same row (Sun only) */}
                    <div className="flex justify-start md:justify-end">
                      {i===0 ? (
                        <button
                          type="button"
                          className="px-3 py-1.5 text-sm font-medium bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 whitespace-nowrap"
                          onClick={()=>{
                            const sun = hours.find(h=>h.day_of_week===0) || { day_of_week:0, open_time:'11:00', close_time:'21:00', is_open:1 } as any;
                            setHours(prev => {
                              const base = Array.from({length:7}).map((_,idx)=> prev.find(h=>h.day_of_week===idx) || { day_of_week: idx, open_time:'11:00', close_time:'21:00', is_open:1 } as any);
                              return base.map((h)=> ({ ...h, open_time: sun.open_time, close_time: sun.close_time, is_open: sun.is_open }));
                            });
                          }}
                        >
                          Copy to all
                        </button>
                      ) : (
                        <div className="h-0" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-end pt-2">
                <button className="px-4 py-2 bg-green-600 text-white rounded" onClick={handleSaveHours}>Save Hours</button>
              </div>
            </div>

            {/* Right: Break Time / Happy Hours / Last Call */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="text-xl font-bold mb-4">Other Times</h2>
              <div className="space-y-4">
                <div className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-3 text-sm font-medium text-gray-700">Break Time</div>
                  <div className="col-span-9 flex items-center gap-2">
                    <input type="time" className="px-2 py-1 border rounded" />
                    <span className="text-gray-500">~</span>
                    <input type="time" className="px-2 py-1 border rounded" />
                  </div>
                </div>
                <div className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-3 text-sm font-medium text-gray-700">Happy Hours</div>
                  <div className="col-span-9 flex items-center gap-2">
                    <input type="time" className="px-2 py-1 border rounded" />
                    <span className="text-gray-500">~</span>
                    <input type="time" className="px-2 py-1 border rounded" />
                  </div>
                </div>
                <div className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-3 text-sm font-medium text-gray-700">Last Call</div>
                  <div className="col-span-9">
                    <input type="time" className="px-2 py-1 border rounded" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Thezoneorder Online Order Integration - Link to Menu Manager */}
          <div className="bg-gradient-to-r from-orange-50 to-amber-50 rounded-lg shadow p-4 border border-orange-200">
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
        </div>
        )}

        {/* Sync Tab Content */}
        {activeTab === 'sync' && (
          <div className="space-y-6">
            {/* Firebase Connection Settings */}
            <div className="bg-gradient-to-r from-slate-800 to-slate-900 rounded-lg shadow p-6 text-white">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                🔌 Thezoneorder Connection
              </h2>
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
                  <p className="text-sm text-gray-400">
                    Find your Restaurant ID in Thezoneorder Admin → Settings → Basic Info
                  </p>
                </div>
              </div>
            </div>

            {/* Remote Sync Section */}
            <div className="bg-gradient-to-r from-purple-800 to-indigo-900 rounded-lg shadow p-6 text-white">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                📡 Remote Sync (Real-time)
              </h2>
              <p className="text-purple-200 text-sm mb-4">
                Enable remote sync to allow Thezoneorder Admin to push/pull data directly to this POS, even from a different location.
              </p>
              
              {/* Status Display */}
              <div className={`mb-4 p-4 rounded-lg ${remoteSyncEnabled ? 'bg-green-900/50 border border-green-500' : 'bg-slate-700 border border-slate-600'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{remoteSyncEnabled ? '🟢' : '🔴'}</span>
                    <div>
                      <div className="font-semibold">
                        {remoteSyncEnabled ? 'Listening for sync requests' : 'Remote Sync Disabled'}
                      </div>
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
                        className={`px-4 py-2 rounded font-semibold transition ${
                          !restaurantId
                            ? 'bg-gray-500 cursor-not-allowed'
                            : 'bg-green-500 hover:bg-green-600'
                        }`}
                      >
                        ▶️ Start Listening
                      </button>
                    ) : (
                      <button
                        onClick={stopRemoteSync}
                        className="px-4 py-2 bg-red-500 hover:bg-red-600 rounded font-semibold transition"
                      >
                        ⏹️ Stop
                      </button>
                    )}
                    <button
                      onClick={loadRemoteSyncStatus}
                      className="px-3 py-2 bg-slate-600 hover:bg-slate-500 rounded transition"
                    >
                      🔄
                    </button>
                  </div>
                </div>
              </div>
              
              {/* How it works */}
              <div className="bg-slate-700/50 p-4 rounded-lg text-sm">
                <h4 className="font-semibold mb-2 text-purple-200">How Remote Sync Works:</h4>
                <ol className="list-decimal list-inside space-y-1 text-purple-100">
                  <li>Click "Start Listening" to begin listening for sync requests</li>
                  <li>Go to Thezoneorder Admin → Settings → Sync tab → Select "Remote Sync"</li>
                  <li>Click Upload/Download buttons in Thezoneorder Admin</li>
                  <li>POS will automatically process the request</li>
                </ol>
              </div>

              {/* Sync History */}
              {remoteSyncHistory.length > 0 && (
                <div className="mt-4">
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="font-semibold text-purple-200">Recent Sync History</h4>
                    <button onClick={loadRemoteSyncHistory} className="text-xs text-purple-300 hover:text-white">
                      🔄 Refresh
                    </button>
                  </div>
                  <div className="bg-slate-800 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                    {remoteSyncHistory.slice(0, 10).map((item: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between px-3 py-2 border-b border-slate-700 text-sm">
                        <div className="flex items-center gap-2">
                          <span>{item.success ? '✅' : '❌'}</span>
                          <span>{item.type}</span>
                        </div>
                        <div className="text-slate-400 text-xs">
                          {item.duration}ms | {new Date(item.createdAt).toLocaleString()}
                        </div>
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
                
                {syncStatus.menu.status === 'success' && (
                  <div className="mb-4 p-3 bg-green-100 border border-green-300 rounded text-green-700 text-sm">
                    ✅ {syncStatus.menu.message}
                  </div>
                )}
                {syncStatus.menu.status === 'error' && (
                  <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded text-red-700 text-sm">
                    ❌ {syncStatus.menu.message}
                  </div>
                )}
                
                <div className="flex gap-3">
                  <button
                    onClick={uploadMenuToFirebase}
                    disabled={syncStatus.menu.status === 'syncing' || !restaurantId}
                    className={`flex-1 px-4 py-3 rounded-lg font-semibold transition ${
                      syncStatus.menu.status === 'syncing' || !restaurantId
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : 'bg-green-500 text-white hover:bg-green-600'
                    }`}
                  >
                    {syncStatus.menu.status === 'syncing' ? '⏳ Syncing...' : '⬆️ Upload to TZO'}
                  </button>
                  <button
                    onClick={downloadMenuFromFirebase}
                    disabled={syncStatus.menu.status === 'syncing' || !restaurantId}
                    className={`flex-1 px-4 py-3 rounded-lg font-semibold transition ${
                      syncStatus.menu.status === 'syncing' || !restaurantId
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : 'bg-emerald-600 text-white hover:bg-emerald-700'
                    }`}
                  >
                    {syncStatus.menu.status === 'syncing' ? '⏳ Syncing...' : '⬇️ Download from TZO'}
                  </button>
                </div>
              </div>

              {/* Order Screen Layout Sync Card */}
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg shadow p-6 border border-blue-200">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-3xl">📱</span>
                  <div>
                    <h3 className="text-lg font-bold text-blue-800">Order Screen Layout</h3>
                    <p className="text-sm text-blue-600">Colors, Grid, Button Settings</p>
                  </div>
                </div>
                
                {syncStatus.orderScreen.status === 'success' && (
                  <div className="mb-4 p-3 bg-blue-100 border border-blue-300 rounded text-blue-700 text-sm">
                    ✅ {syncStatus.orderScreen.message}
                  </div>
                )}
                {syncStatus.orderScreen.status === 'error' && (
                  <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded text-red-700 text-sm">
                    ❌ {syncStatus.orderScreen.message}
                  </div>
                )}
                
                <div className="flex gap-3">
                  <button
                    onClick={uploadOrderScreenToFirebase}
                    disabled={syncStatus.orderScreen.status === 'syncing' || !restaurantId}
                    className={`flex-1 px-4 py-3 rounded-lg font-semibold transition ${
                      syncStatus.orderScreen.status === 'syncing' || !restaurantId
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : 'bg-blue-500 text-white hover:bg-blue-600'
                    }`}
                  >
                    {syncStatus.orderScreen.status === 'syncing' ? '⏳ Syncing...' : '⬆️ Upload to TZO'}
                  </button>
                  <button
                    onClick={downloadOrderScreenFromFirebase}
                    disabled={syncStatus.orderScreen.status === 'syncing' || !restaurantId}
                    className={`flex-1 px-4 py-3 rounded-lg font-semibold transition ${
                      syncStatus.orderScreen.status === 'syncing' || !restaurantId
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : 'bg-indigo-600 text-white hover:bg-indigo-700'
                    }`}
                  >
                    {syncStatus.orderScreen.status === 'syncing' ? '⏳ Syncing...' : '⬇️ Download from TZO'}
                  </button>
                </div>
              </div>

              {/* Table Map Sync Card */}
              <div className="bg-gradient-to-br from-amber-50 to-yellow-50 rounded-lg shadow p-6 border border-amber-200">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-3xl">🗺️</span>
                  <div>
                    <h3 className="text-lg font-bold text-amber-800">Table Map</h3>
                    <p className="text-sm text-amber-600">Tables, Floors, Layout</p>
                  </div>
                </div>

                {syncStatus.tableMap.status === 'success' && (
                  <div className="mb-4 p-3 bg-green-100 border border-green-300 rounded text-green-700 text-sm">
                    ✅ {syncStatus.tableMap.message}
                  </div>
                )}
                {syncStatus.tableMap.status === 'error' && (
                  <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded text-red-700 text-sm">
                    ❌ {syncStatus.tableMap.message}
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={uploadTableMapToFirebase}
                    disabled={syncStatus.tableMap.status === 'syncing' || !restaurantId}
                    className={`flex-1 px-4 py-3 rounded-lg font-semibold transition ${
                      syncStatus.tableMap.status === 'syncing' || !restaurantId
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : 'bg-amber-500 text-white hover:bg-amber-600'
                    }`}
                  >
                    {syncStatus.tableMap.status === 'syncing' ? '⏳ Syncing...' : '⬆️ Upload to TZO'}
                  </button>
                  <button
                    onClick={downloadTableMapFromFirebase}
                    disabled={syncStatus.tableMap.status === 'syncing' || !restaurantId}
                    className={`flex-1 px-4 py-3 rounded-lg font-semibold transition ${
                      syncStatus.tableMap.status === 'syncing' || !restaurantId
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : 'bg-yellow-600 text-white hover:bg-yellow-700'
                    }`}
                  >
                    {syncStatus.tableMap.status === 'syncing' ? '⏳ Syncing...' : '⬇️ Download from TZO'}
                  </button>
                </div>
              </div>

              {/* Promotions Sync Card - Coming Soon */}
              <div className="bg-gradient-to-br from-pink-50 to-rose-50 rounded-lg shadow p-6 border border-pink-200 opacity-60">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-3xl">🎁</span>
                  <div>
                    <h3 className="text-lg font-bold text-pink-800">Promotions</h3>
                    <span className="px-2 py-0.5 bg-pink-200 text-pink-700 text-xs rounded-full">Coming Soon</span>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button disabled className="flex-1 px-4 py-3 bg-gray-200 text-gray-400 rounded-lg cursor-not-allowed">
                    ⬆️ Upload
                  </button>
                  <button disabled className="flex-1 px-4 py-3 bg-gray-200 text-gray-400 rounded-lg cursor-not-allowed">
                    ⬇️ Download
                  </button>
                </div>
              </div>
            </div>

            {/* Sync Direction Guide */}
            <div className="bg-white rounded-lg shadow p-6 border">
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                ℹ️ Sync Direction Guide
              </h3>
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
          </div>
        )}
      </div>
    </div>
  );
};

export default BasicInfoPage;


