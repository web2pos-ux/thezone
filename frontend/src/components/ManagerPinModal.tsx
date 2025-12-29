import React, { useEffect, useState } from 'react';
import { Settings, Plus, Trash2, Save, X } from 'lucide-react';

interface LibraryTaxGroup {
  tax_group_id: number;
  name: string;
}

interface LibraryPrinterGroup {
  printer_group_id: number;
  name: string;
}

interface ManagerPinModalProps {
  isOpen: boolean;
  onClose: () => void;
  menuId?: string;
}

const ManagerPinModal: React.FC<ManagerPinModalProps> = ({ isOpen, onClose, menuId }) => {
  const [config, setConfig] = useState({
    pins: [] as string[],
    approval_limit: 50000,
    note_limit: 10000
  });
  const [newPin, setNewPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  
  // Open Price Settings 상태
  const [openPriceSettings, setOpenPriceSettings] = useState({
    defaultTaxGroupId: null as number | null,
    defaultPrinterGroupId: null as number | null
  });
  const [taxGroupsLibrary, setTaxGroupsLibrary] = useState<LibraryTaxGroup[]>([]);
  const [printerGroupsLibrary, setPrinterGroupsLibrary] = useState<LibraryPrinterGroup[]>([]);

  useEffect(() => {
    if (isOpen) {
      loadConfig();
      loadLibrary();
      loadOpenPriceSettings();
    }
  }, [isOpen]);

  const loadConfig = async () => {
    try {
      const response = await fetch('http://localhost:3177/api/menu/manager-pins');
      if (response.ok) {
        const data = await response.json();
        setConfig(data);
      }
    } catch (error) {
      console.error('Failed to load config:', error);
    }
  };

  const loadLibrary = async () => {
    try {
      if (!menuId) return;
      const mid = `?menu_id=${encodeURIComponent(menuId)}`;
      const res = await fetch(`http://localhost:3177/api/open-price/library${mid}`);
      const data = await res.json();
      setTaxGroupsLibrary(data?.tax_groups || []);
      const uniq = Array.isArray(data?.printer_groups)
        ? Object.values(
            (data.printer_groups as LibraryPrinterGroup[]).reduce((acc: any, g: any) => {
              const key = Number(g.printer_group_id);
              if (!acc[key]) acc[key] = g;
              return acc;
            }, {})
          )
        : [];
      setPrinterGroupsLibrary(uniq as LibraryPrinterGroup[]);
    } catch (e) {
      console.error('Failed to load options library:', e);
    }
  };

  const loadOpenPriceSettings = async () => {
    try {
      const response = await fetch('http://localhost:3177/api/open-price/settings');
      if (response.ok) {
        const data = await response.json();
        setOpenPriceSettings(data);
      }
    } catch (error) {
      console.error('Failed to load Open Price settings:', error);
    }
  };

  const addPin = () => {
    if (newPin.trim() && !config.pins.includes(newPin.trim())) {
      setConfig(prev => ({
        ...prev,
        pins: [...prev.pins, newPin.trim()]
      }));
      setNewPin('');
    }
  };

  const removePin = (pinToRemove: string) => {
    setConfig(prev => ({
      ...prev,
      pins: prev.pins.filter(pin => pin !== pinToRemove)
    }));
  };

  const saveConfig = async () => {
    setLoading(true);
    setMessage('');
    try {
      // Manager PIN 설정 저장
      const pinResponse = await fetch('http://localhost:3177/api/menu/manager-pins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });

      if (!pinResponse.ok) {
        const error = await pinResponse.json();
        setMessage(`Manager PIN 오류: ${error.error}`);
        return;
      }

      // Open Price Settings 저장
      const settingsResponse = await fetch('http://localhost:3177/api/open-price/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(openPriceSettings)
      });

      if (!settingsResponse.ok) {
        const error = await settingsResponse.json();
        setMessage(`Open Price Settings 오류: ${error.error}`);
        return;
      }

      setMessage('설정이 성공적으로 저장되었습니다.');
      setTimeout(() => {
        onClose();
        setMessage('');
      }, 1500);
    } catch (error) {
      setMessage('저장 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-4 py-3 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Settings className="w-6 h-6 text-blue-600" />
              <h2 className="text-xl font-bold text-gray-900">Open Price Settings</h2>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <X className="w-6 h-6" />
            </button>
          </div>
          <p className="text-gray-600 mt-2">Configure Manager PINs and thresholds for Open Price approvals.</p>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900 mb-3">Manager PINs</h3>
            <div className="grid grid-cols-4 gap-2">
              {config.pins.map((pin, index) => (
                <div key={index} className="flex items-center justify-between bg-gray-50 px-2 py-1.5 rounded-md">
                  <span className="font-mono text-sm">{pin}</span>
                  <button onClick={() => removePin(pin)} className="text-red-600 hover:text-red-800 p-1">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex space-x-2 mt-2">
              <input
                type="text"
                value={newPin}
                onChange={(e) => {
                  const onlyDigits = e.target.value.replace(/[^0-9]/g, '').slice(0, 4);
                  setNewPin(onlyDigits);
                }}
                placeholder="Enter 4-digit PIN"
                className="flex-1 px-2 py-1.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                maxLength={4}
                inputMode="numeric"
                pattern="[0-9]*"
              />
              <button onClick={addPin} disabled={newPin.length !== 4 || config.pins.includes(newPin)} className="px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 flex items-center space-x-2 text-sm">
                <Plus className="w-4 h-4" />
                <span>Add</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Approval required amount</label>
              <input
                type="number"
                value={config.approval_limit}
                onChange={(e) => setConfig(prev => ({ ...prev, approval_limit: Number(e.target.value) }))}
                className="w-full px-2 py-1.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                min={0}
              />
              <p className="text-xs text-gray-500 mt-1">Manager PIN is required at or above this amount.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Note required amount</label>
              <input
                type="number"
                value={config.note_limit}
                onChange={(e) => setConfig(prev => ({ ...prev, note_limit: Number(e.target.value) }))}
                className="w-full px-2 py-1.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                min={0}
              />
              <p className="text-xs text-gray-500 mt-1">A note is required at or above this amount.</p>
            </div>
          </div>

          {/* Open Price Default Settings */}
          <div className="border-t border-gray-200 pt-4">
            <h3 className="text-base font-semibold text-gray-900 mb-3">Open Price Default Settings</h3>
            
            {/* Default Tax Group */}
            <div className="mb-4">
              <label className="block text-sm font-semibold text-gray-700 mb-2">Default Tax Group</label>
              <div className="grid grid-cols-2 gap-2 max-h-32 overflow-auto border border-gray-200 rounded-md p-2">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="radio"
                    name="defaultTaxGroup"
                    checked={openPriceSettings.defaultTaxGroupId === null}
                    onChange={() => setOpenPriceSettings(prev => ({ ...prev, defaultTaxGroupId: null }))}
                  />
                  <span className="text-sm text-gray-800">None</span>
                </label>
                {taxGroupsLibrary.map(g => (
                  <label key={g.tax_group_id} className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="radio"
                      name="defaultTaxGroup"
                      checked={openPriceSettings.defaultTaxGroupId === g.tax_group_id}
                      onChange={() => setOpenPriceSettings(prev => ({ ...prev, defaultTaxGroupId: g.tax_group_id }))}
                    />
                    <span className="text-sm text-gray-800">{g.name}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Default Printer Group */}
            <div className="mb-4">
              <label className="block text-sm font-semibold text-gray-700 mb-2">Default Printer Group</label>
              <div className="grid grid-cols-2 gap-2 max-h-32 overflow-auto border border-gray-200 rounded-md p-2">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="radio"
                    name="defaultPrinterGroup"
                    checked={openPriceSettings.defaultPrinterGroupId === null}
                    onChange={() => setOpenPriceSettings(prev => ({ ...prev, defaultPrinterGroupId: null }))}
                  />
                  <span className="text-sm text-gray-800">None</span>
                </label>
                {printerGroupsLibrary.map(g => (
                  <label key={g.printer_group_id} className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="radio"
                      name="defaultPrinterGroup"
                      checked={openPriceSettings.defaultPrinterGroupId === g.printer_group_id}
                      onChange={() => setOpenPriceSettings(prev => ({ ...prev, defaultPrinterGroupId: g.printer_group_id }))}
                    />
                    <span className="text-sm text-gray-800">{g.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {message && (
            <div className={`p-3 rounded-md ${message.includes('Error') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
              {message}
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
            <button onClick={onClose} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200">Cancel</button>
            <button onClick={saveConfig} disabled={loading || config.pins.length === 0} className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 flex items-center space-x-2">
              <Save className="w-4 h-4" />
              <span>{loading ? 'Saving...' : 'Save'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ManagerPinModal; 