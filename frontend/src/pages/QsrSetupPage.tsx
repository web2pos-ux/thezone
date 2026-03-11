import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Coffee, Save, ArrowLeft, Monitor, Percent, Check, AlertCircle } from 'lucide-react';
import { API_URL } from '../config/constants';

interface SetupConfig {
  deviceName: string;
  menuId: number;
  taxRate: number;
  configured: boolean;
}

interface Menu {
  menu_id: number;
  name: string;
}

const STORAGE_KEY = 'qsr-pos-setup';

const QsrSetupPage: React.FC = () => {
  const navigate = useNavigate();
  
  const [deviceName, setDeviceName] = useState('QSR Counter');
  const [menuId, setMenuId] = useState(1);
  const [taxRate, setTaxRate] = useState(8.25);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  
  // Load existing config and menus
  useEffect(() => {
    const savedConfig = localStorage.getItem(STORAGE_KEY);
    if (savedConfig) {
      try {
        const config: SetupConfig = JSON.parse(savedConfig);
        setDeviceName(config.deviceName || 'QSR Counter');
        setMenuId(config.menuId || 1);
        setTaxRate(config.taxRate || 8.25);
      } catch (e) {
        console.error('Failed to parse config:', e);
      }
    }
    
    loadMenus();
  }, []);
  
  // Auto-hide notification
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);
  
  const loadMenus = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_URL}/menus`);
      if (res.ok) {
        const data = await res.json();
        setMenus(data);
        if (data.length > 0 && !menuId) {
          setMenuId(data[0].menu_id);
        }
      }
    } catch (err) {
      console.error('Failed to load menus:', err);
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleSave = () => {
    setIsSaving(true);
    
    try {
      const config: SetupConfig = {
        deviceName: deviceName.trim() || 'QSR Counter',
        menuId,
        taxRate,
        configured: true
      };
      
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      setNotification({ type: 'success', message: 'Settings saved successfully!' });
      
      // Navigate to QSR page after short delay
      setTimeout(() => {
        navigate('/qsr');
      }, 1000);
      
    } catch (err) {
      setNotification({ type: 'error', message: 'Failed to save settings' });
    } finally {
      setIsSaving(false);
    }
  };
  
  const handleStartQsr = () => {
    // Save and go to QSR
    const config: SetupConfig = {
      deviceName: deviceName.trim() || 'QSR Counter',
      menuId,
      taxRate,
      configured: true
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    navigate('/qsr');
  };
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-100 flex items-center justify-center p-6">
      {/* Notification */}
      {notification && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-xl shadow-lg flex items-center gap-3 ${
          notification.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
        }`}>
          {notification.type === 'success' ? <Check className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          <span className="font-medium">{notification.message}</span>
        </div>
      )}
      
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-5 flex items-center gap-4">
          <button
            onClick={() => navigate('/sales')}
            className="p-2 hover:bg-white/20 rounded-lg transition"
          >
            <ArrowLeft className="w-6 h-6 text-white" />
          </button>
          <div>
            <h1 className="text-white font-bold text-2xl flex items-center gap-3">
              <Coffee className="w-8 h-8" />
              QSR / Café Setup
            </h1>
            <p className="text-amber-100 text-sm mt-1">Configure your quick service counter</p>
          </div>
        </div>
        
        {/* Form */}
        <div className="p-6 space-y-6">
          {/* Device Name */}
          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
              <Monitor className="w-4 h-4" />
              Device Name
            </label>
            <input
              type="text"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="QSR Counter"
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-amber-500 text-lg"
            />
            <p className="text-xs text-gray-400 mt-1">Displayed on receipts and kitchen tickets</p>
          </div>
          
          {/* Menu Selection */}
          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
              <Coffee className="w-4 h-4" />
              Menu
            </label>
            <select
              value={menuId}
              onChange={(e) => setMenuId(Number(e.target.value))}
              disabled={isLoading}
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-amber-500 text-lg appearance-none bg-white"
            >
              {menus.map(menu => (
                <option key={menu.menu_id} value={menu.menu_id}>
                  {menu.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">Select the menu to use for this counter</p>
          </div>
          
          {/* Tax Rate */}
          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
              <Percent className="w-4 h-4" />
              Tax Rate (%)
            </label>
            <input
              type="number"
              value={taxRate}
              onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)}
              step="0.01"
              min="0"
              max="100"
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-amber-500 text-lg"
            />
            <p className="text-xs text-gray-400 mt-1">Applied to all orders at this counter</p>
          </div>
          
          {/* Info Box */}
          <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
            <h4 className="font-semibold text-amber-800 mb-2">QSR/Café Mode Features</h4>
            <ul className="text-sm text-amber-700 space-y-1">
              <li>• Quick counter ordering without table selection</li>
              <li>• Order number based system</li>
              <li>• Eat In / To Go / Pickup options</li>
              <li>• Fast payment processing</li>
              <li>• Kitchen ticket printing</li>
            </ul>
          </div>
        </div>
        
        {/* Actions */}
        <div className="px-6 pb-6 space-y-3">
          <button
            onClick={handleStartQsr}
            className="w-full py-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-xl font-bold text-lg transition shadow-lg flex items-center justify-center gap-2"
          >
            <Coffee className="w-6 h-6" />
            Start QSR Mode
          </button>
          
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium transition flex items-center justify-center gap-2"
          >
            <Save className="w-5 h-5" />
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
};

export default QsrSetupPage;
