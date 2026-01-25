/*
 * =====================================================
 * MENU MANAGER - LOCKED FOR MODIFICATION
 * =====================================================
 * 
 * ⚠️  WARNING: DO NOT MODIFY THIS FILE
 * 
 * This file is part of the Menu Manager module which is
 * currently locked for modifications. Any changes to this
 * file or related Menu Manager components should be avoided
 * until the lock is explicitly removed.
 * 
 * Last modified: [Current Date]
 * Lock status: INACTIVE
 * 
 * =====================================================
 */

import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Trash2, Settings, Save, X, Edit } from 'lucide-react';
// Header removed - using BackOfficeLayout header instead
import { Menu } from '../types';
import { API_URL } from '../config/constants';

interface BackupFile {
  filename: string;
  timestamp: Date;
  size: number;
}

// Manager PIN 관리 모달 컴포넌트
const ManagerPinModal = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  const [config, setConfig] = useState({
    pins: [] as string[],
    approval_limit: 50000,
    note_limit: 10000
  });
  const [newPin, setNewPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (isOpen) {
      loadConfig();
    }
  }, [isOpen]);

  const loadConfig = async () => {
    try {
      const response = await fetch(`${API_URL}/menu/manager-pins`);
      if (response.ok) {
        const data = await response.json();
        setConfig(data);
      }
    } catch (error) {
      console.error('Failed to load config:', error);
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
      const response = await fetch(`${API_URL}/menu/manager-pins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      
      if (response.ok) {
        setMessage('설정이 저장되었습니다.');
        setTimeout(() => setMessage(''), 3000);
      } else {
        const error = await response.json();
        setMessage(`오류: ${error.error}`);
      }
    } catch (error) {
      setMessage('저장 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Settings className="w-6 h-6 text-blue-600" />
              <h2 className="text-xl font-bold text-gray-900">Manager PIN Settings</h2>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
          <p className="text-gray-600 mt-2">Open Price 승인을 위한 Manager PIN과 임계값을 설정합니다.</p>
        </div>

        <div className="p-6 space-y-6">
          {/* Manager PINs */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Manager PIN 목록</h3>
            
            <div className="space-y-3">
              {config.pins.map((pin, index) => (
                <div key={index} className="flex items-center justify-between bg-gray-50 p-3 rounded-lg">
                  <span className="font-mono text-lg">{pin}</span>
                  <button
                    onClick={() => removePin(pin)}
                    className="text-red-600 hover:text-red-800 p-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex space-x-2 mt-4">
              <input
                type="text"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/[^0-9]/g, '').slice(0, 10))}
                placeholder="새 PIN 입력 (숫자만)"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={addPin}
                disabled={!newPin.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 flex items-center space-x-2"
              >
                <Plus className="w-4 h-4" />
                <span>추가</span>
              </button>
            </div>
          </div>

          {/* Thresholds */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                승인 필요 금액 (원)
              </label>
              <input
                type="number"
                value={config.approval_limit}
                onChange={(e) => setConfig(prev => ({ ...prev, approval_limit: Number(e.target.value) }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                min="0"
              />
              <p className="text-xs text-gray-500 mt-1">이 금액 이상일 때 Manager PIN이 필요합니다.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                메모 필요 금액 (원)
              </label>
              <input
                type="number"
                value={config.note_limit}
                onChange={(e) => setConfig(prev => ({ ...prev, note_limit: Number(e.target.value) }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                min="0"
              />
              <p className="text-xs text-gray-500 mt-1">이 금액 이상일 때 메모 입력이 필요합니다.</p>
            </div>
          </div>

          {/* Message */}
          {message && (
            <div className={`p-3 rounded-md ${message.includes('오류') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
              {message}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
            >
              취소
            </button>
            <button
              onClick={saveConfig}
              disabled={loading || config.pins.length === 0}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 flex items-center space-x-2"
            >
              <Save className="w-4 h-4" />
              <span>{loading ? '저장 중...' : '저장'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Tax Settings Tab Component
interface Tax {
  id: number;
  name: string;
  rate: number;
}

interface TaxGroup {
  id: number;
  name: string;
  taxIds: number[];
}

const TaxSettingsTab = () => {
  const [taxes, setTaxes] = useState<Tax[]>([]);
  const [taxGroups, setTaxGroups] = useState<TaxGroup[]>([]);
  
  // New tax form
  const [newTaxName, setNewTaxName] = useState('');
  const [newTaxRate, setNewTaxRate] = useState('');
  
  // New tax group form
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedTaxIds, setSelectedTaxIds] = useState<number[]>([]);
  
  // Edit tax modal
  const [editingTax, setEditingTax] = useState<Tax | null>(null);
  const [editTaxName, setEditTaxName] = useState('');
  const [editTaxRate, setEditTaxRate] = useState('');
  
  // Edit tax group modal
  const [editingGroup, setEditingGroup] = useState<TaxGroup | null>(null);
  const [editGroupName, setEditGroupName] = useState('');
  const [editGroupTaxIds, setEditGroupTaxIds] = useState<number[]>([]);

  // Load taxes and tax groups from API
  useEffect(() => {
    const loadData = async () => {
      try {
        const [taxesRes, groupsRes] = await Promise.all([
          fetch(`${API_URL}/taxes`).then(r => r.ok ? r.json() : []),
          fetch(`${API_URL}/taxes/groups`).then(r => r.ok ? r.json() : [])
        ]);
        setTaxes(Array.isArray(taxesRes) ? taxesRes : []);
        setTaxGroups(Array.isArray(groupsRes) ? groupsRes : []);
      } catch (error) {
        console.error('Failed to load tax data:', error);
      }
    };
    loadData();
  }, []);

  // Add new tax
  const handleAddTax = async () => {
    console.log('handleAddTax called:', { newTaxName, newTaxRate });
    
    if (!newTaxName.trim()) {
      alert('Tax name is required');
      return;
    }
    if (newTaxRate === '' || newTaxRate === null || newTaxRate === undefined) {
      alert('Tax rate is required');
      return;
    }
    
    try {
      const response = await fetch(`${API_URL}/taxes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTaxName.trim(), rate: parseFloat(newTaxRate) })
      });
      
      if (response.ok) {
        const newTax = await response.json();
        setTaxes(prev => [...prev, newTax]);
        setNewTaxName('');
        setNewTaxRate('');
        alert(`Tax "${newTax.name}" added successfully!`);
      } else {
        const errorText = await response.text();
        console.error('Failed to add tax:', errorText);
        alert('Failed to add tax: ' + errorText);
      }
    } catch (error) {
      console.error('Failed to add tax:', error);
      alert('Failed to add tax: ' + (error as Error).message);
    }
  };

  // Delete tax
  const handleDeleteTax = async (taxId: number) => {
    if (!window.confirm('Delete this tax?')) return;
    try {
      const response = await fetch(`${API_URL}/taxes/${taxId}`, { method: 'DELETE' });
      if (response.ok) {
        setTaxes(prev => prev.filter(t => t.id !== taxId));
      }
    } catch (error) {
      console.error('Failed to delete tax:', error);
    }
  };

  // Add new tax group
  const handleAddTaxGroup = async () => {
    if (!newGroupName.trim() || selectedTaxIds.length === 0) return;
    try {
      const response = await fetch(`${API_URL}/taxes/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newGroupName.trim(), taxIds: selectedTaxIds })
      });
      if (response.ok) {
        const newGroup = await response.json();
        setTaxGroups(prev => [...prev, newGroup]);
        setNewGroupName('');
        setSelectedTaxIds([]);
      }
    } catch (error) {
      console.error('Failed to add tax group:', error);
    }
  };

  // Delete tax group
  const handleDeleteTaxGroup = async (groupId: number) => {
    if (!window.confirm('Delete this tax group?')) return;
    try {
      const response = await fetch(`${API_URL}/taxes/groups/${groupId}`, { method: 'DELETE' });
      if (response.ok) {
        setTaxGroups(prev => prev.filter(g => g.id !== groupId));
      }
    } catch (error) {
      console.error('Failed to delete tax group:', error);
    }
  };

  // Toggle tax selection for group
  const toggleTaxSelection = (taxId: number) => {
    setSelectedTaxIds(prev => 
      prev.includes(taxId) 
        ? prev.filter(id => id !== taxId)
        : [...prev, taxId]
    );
  };

  // Open edit tax modal
  const openEditTax = (tax: Tax) => {
    setEditingTax(tax);
    setEditTaxName(tax.name);
    setEditTaxRate(tax.rate.toString());
  };

  // Update tax
  const handleUpdateTax = async () => {
    if (!editingTax || !editTaxName.trim() || editTaxRate === '') return;
    try {
      const response = await fetch(`${API_URL}/taxes/${editingTax.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editTaxName.trim(), rate: parseFloat(editTaxRate) })
      });
      if (response.ok) {
        const updatedTax = await response.json();
        setTaxes(prev => prev.map(t => t.id === updatedTax.id ? updatedTax : t));
        setEditingTax(null);
        alert('Tax updated successfully!');
      } else {
        alert('Failed to update tax');
      }
    } catch (error) {
      console.error('Failed to update tax:', error);
      alert('Failed to update tax');
    }
  };

  // Open edit tax group modal
  const openEditGroup = (group: TaxGroup) => {
    setEditingGroup(group);
    setEditGroupName(group.name);
    setEditGroupTaxIds([...group.taxIds]);
  };

  // Toggle tax in edit group
  const toggleEditGroupTax = (taxId: number) => {
    setEditGroupTaxIds(prev => 
      prev.includes(taxId) 
        ? prev.filter(id => id !== taxId)
        : [...prev, taxId]
    );
  };

  // Update tax group
  const handleUpdateTaxGroup = async () => {
    if (!editingGroup || !editGroupName.trim()) return;
    try {
      const response = await fetch(`${API_URL}/taxes/groups/${editingGroup.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editGroupName.trim(), taxIds: editGroupTaxIds })
      });
      if (response.ok) {
        const updatedGroup = await response.json();
        setTaxGroups(prev => prev.map(g => g.id === updatedGroup.id ? updatedGroup : g));
        setEditingGroup(null);
        alert('Tax group updated successfully!');
      } else {
        alert('Failed to update tax group');
      }
    } catch (error) {
      console.error('Failed to update tax group:', error);
      alert('Failed to update tax group');
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Left: Individual Taxes */}
      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-lg font-bold text-gray-800 mb-3">💰 Individual Taxes</h2>
        
        {/* Add Tax Form */}
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={newTaxName}
            onChange={(e) => setNewTaxName(e.target.value)}
            placeholder="Tax Name (e.g., GST)"
            className="flex-1 px-2 py-1.5 border rounded text-sm"
          />
          <input
            type="number"
            value={newTaxRate}
            onChange={(e) => setNewTaxRate(e.target.value)}
            placeholder="Rate %"
            step="0.01"
            min="0"
            className="w-20 px-2 py-1.5 border rounded text-sm"
          />
          <button
            type="button"
            onClick={handleAddTax}
            className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
          >
            Add
          </button>
        </div>

        {/* Tax List */}
        <div className="space-y-1">
          {taxes.length === 0 ? (
            <p className="text-gray-500 text-center py-2 text-sm">No taxes created yet.</p>
          ) : (
            taxes.map(tax => (
              <div key={tax.id} className="flex items-center justify-between p-2 bg-gray-50 rounded border text-sm">
                <div>
                  <span className="font-medium text-gray-800">{tax.name}</span>
                  <span className="ml-2 text-gray-600">({tax.rate}%)</span>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => openEditTax(tax)}
                    className="text-blue-500 hover:text-blue-700 p-1"
                    title="Edit"
                  >
                    <Edit size={18} />
                  </button>
                  <button
                    onClick={() => handleDeleteTax(tax.id)}
                    className="text-red-500 hover:text-red-700 p-1"
                    title="Delete"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right: Tax Groups */}
      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-lg font-bold text-gray-800 mb-3">📁 Tax Groups</h2>
        
        {/* Add Tax Group Form */}
        <div className="mb-3 p-3 bg-gray-50 rounded-lg border">
          <input
            type="text"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="Tax Group Name"
            className="w-full px-3 py-1.5 border rounded text-sm mb-2"
          />
          
          {/* Tax Selection */}
          <div className="mb-2">
            <label className="block text-xs text-gray-600 mb-1">Select Taxes:</label>
            <div className="flex flex-wrap gap-2">
              {taxes.length === 0 ? (
                <p className="text-gray-500 text-sm">Create taxes first</p>
              ) : (
                taxes.map(tax => (
                  <label
                    key={tax.id}
                    className={`flex items-center gap-1 px-2 py-1 rounded border cursor-pointer transition-colors text-sm ${
                      selectedTaxIds.includes(tax.id)
                        ? 'bg-blue-100 border-blue-500 text-blue-700'
                        : 'bg-white border-gray-300 hover:bg-gray-100'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedTaxIds.includes(tax.id)}
                      onChange={() => toggleTaxSelection(tax.id)}
                      className="sr-only"
                    />
                    <span>{tax.name} ({tax.rate}%)</span>
                  </label>
                ))
              )}
            </div>
          </div>
          
          <button
            onClick={handleAddTaxGroup}
            disabled={!newGroupName.trim() || selectedTaxIds.length === 0}
            className="w-full px-3 py-1.5 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create Tax Group
          </button>
        </div>

        {/* Tax Group List */}
        <div className="space-y-1">
          {taxGroups.length === 0 ? (
            <p className="text-gray-500 text-center py-2 text-sm">No tax groups created yet.</p>
          ) : (
            taxGroups.map(group => (
              <div key={group.id} className="p-2 bg-gray-50 rounded border">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-gray-800">{group.name}</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => openEditGroup(group)}
                      className="text-blue-500 hover:text-blue-700 p-1"
                      title="Edit"
                    >
                      <Edit size={18} />
                    </button>
                    <button
                      onClick={() => handleDeleteTaxGroup(group.id)}
                      className="text-red-500 hover:text-red-700 p-1"
                      title="Delete"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {group.taxIds.map(taxId => {
                    const tax = taxes.find(t => t.id === taxId);
                    return tax ? (
                      <span key={taxId} className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded">
                        {tax.name} ({tax.rate}%)
                      </span>
                    ) : null;
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Edit Tax Modal */}
      {editingTax && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-[400px]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold">Edit Tax</h3>
              <button
                onClick={() => setEditingTax(null)}
                className="text-2xl text-gray-500 hover:text-gray-700"
              >
                ×
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tax Name</label>
                <input
                  type="text"
                  value={editTaxName}
                  onChange={(e) => setEditTaxName(e.target.value)}
                  className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
                  placeholder="Tax Name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tax Rate (%)</label>
                <input
                  type="number"
                  value={editTaxRate}
                  onChange={(e) => setEditTaxRate(e.target.value)}
                  className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
                  placeholder="Rate"
                  step="0.01"
                  min="0"
                />
              </div>
            </div>
            
            <div className="flex gap-2 mt-6">
              <button
                onClick={() => setEditingTax(null)}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateTax}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Tax Group Modal */}
      {editingGroup && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-[450px] max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold">Edit Tax Group</h3>
              <button
                onClick={() => setEditingGroup(null)}
                className="text-2xl text-gray-500 hover:text-gray-700"
              >
                ×
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Group Name</label>
                <input
                  type="text"
                  value={editGroupName}
                  onChange={(e) => setEditGroupName(e.target.value)}
                  className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
                  placeholder="Group Name"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Select Taxes</label>
                <div className="space-y-2 max-h-[200px] overflow-y-auto border rounded p-2">
                  {taxes.length === 0 ? (
                    <p className="text-gray-500 text-center py-2">No taxes available</p>
                  ) : (
                    taxes.map(tax => (
                      <label key={tax.id} className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editGroupTaxIds.includes(tax.id)}
                          onChange={() => toggleEditGroupTax(tax.id)}
                          className="w-4 h-4 text-blue-600"
                        />
                        <span>{tax.name} ({tax.rate}%)</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            </div>
            
            <div className="flex gap-2 mt-6">
              <button
                onClick={() => setEditingGroup(null)}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateTaxGroup}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Thezoneorder Sync Tab Component
const ThezoneorderSyncTab = () => {
  const [profile, setProfile] = useState<any>({ firebase_restaurant_id: '' });
  const [syncing, setSyncing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fullSyncing, setFullSyncing] = useState(false);
  const [cloudConnected, setCloudConnected] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ linked: number; total: number } | null>(null);
  const [backups, setBackups] = useState<any[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  
  // Menu selection for upload - 고정 메뉴 ID 사용
  const [menus, setMenus] = useState<any[]>([]);
  const selectedMenuId = '200005'; // 고정 메뉴
  
  // Firebase menus list
  const [firebaseMenus, setFirebaseMenus] = useState<any[]>([]);
  const [loadingFirebaseMenus, setLoadingFirebaseMenus] = useState(false);

  // Load profile, sync status, and menus
  useEffect(() => {
    const loadData = async () => {
      try {
        const [profileRes, syncRes, menusRes] = await Promise.all([
          fetch(`${API_URL}/admin-settings/business-profile`).then(r => r.json()).catch(() => null),
          fetch(`${API_URL}/menu-sync/sync-status`).then(r => r.json()).catch(() => null),
          fetch(`${API_URL}/menus`).then(r => r.json()).catch(() => [])
        ]);
        
        if (profileRes) {
          setProfile(profileRes);
          if (profileRes.firebase_restaurant_id) {
            // Test connection
            try {
              const fbRes = await fetch(`${API_URL}/menu-sync/firebase-restaurant/${profileRes.firebase_restaurant_id}`);
              if (fbRes.ok) setCloudConnected(true);
            } catch {}
            // Load backups and Firebase menus
            loadBackups(profileRes.firebase_restaurant_id);
            loadFirebaseMenus(profileRes.firebase_restaurant_id);
          }
        }
        if (syncRes?.stats) {
          setSyncStatus({ linked: syncRes.stats.linkedItems, total: syncRes.stats.totalItems });
        }
        if (Array.isArray(menusRes)) {
          setMenus(menusRes.filter((m: any) => !m.is_deleted));
        }
      } catch (e) {
        console.error('Failed to load data:', e);
      }
    };
    loadData();
  }, []);

  const loadBackups = async (restaurantId: string) => {
    setLoadingBackups(true);
    try {
      const res = await fetch(`${API_URL}/menu-sync/backups/${restaurantId}`);
      const data = await res.json();
      if (data.success) setBackups(data.backups || []);
    } catch (e) {
      console.error('Failed to load backups:', e);
    } finally {
      setLoadingBackups(false);
    }
  };

  const handleTestConnection = async () => {
    if (!profile.firebase_restaurant_id) {
      alert('Please enter Thezoneorder Restaurant ID first');
      return;
    }
    try {
      const res = await fetch(`${API_URL}/menu-sync/firebase-restaurant/${profile.firebase_restaurant_id}`);
      if (res.ok) {
        const data = await res.json();
        setCloudConnected(true);
        alert(`✅ Connected!\nRestaurant: ${data.restaurant?.name || 'Unknown'}`);
        loadBackups(profile.firebase_restaurant_id);
      } else {
        setCloudConnected(false);
        alert('❌ Restaurant not found in Thezoneorder');
      }
    } catch {
      setCloudConnected(false);
      alert('❌ Connection failed');
    }
  };

  const handleSaveId = async () => {
    try {
      await fetch(`${API_URL}/admin-settings/business-profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Role': 'MANAGER' },
        body: JSON.stringify(profile)
      });
      alert('✅ Thezoneorder Restaurant ID saved!');
    } catch {
      alert('❌ Failed to save');
    }
  };

  const handleSyncFromThezoneorder = async () => {
    if (!profile.firebase_restaurant_id) {
      alert('Please enter Thezoneorder Restaurant ID first');
      return;
    }
    if (!window.confirm('⚠️ Download from Thezoneorder to POS?\n\nThis will download in order:\n1. Modifier Groups\n2. Tax Groups\n3. Printer Groups\n4. Menu\n\n⚠️ A backup will be created automatically before download.\nItems will be matched by name.')) return;
    
    setSyncing(true);
    
    try {
      // Step 1: Download Modifier Groups (먼저 다운로드 - 메뉴 연결에 필요)
      const modRes = await fetch(`${API_URL}/menu-sync/download-modifier-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Role': 'MANAGER' },
        body: JSON.stringify({ restaurantId: profile.firebase_restaurant_id })
      });
      const modData = await modRes.json();
      if (!modData.success) {
        throw new Error(`Step 1 failed: Modifier Groups download failed: ${modData.error || 'Unknown error'}`);
      }
      const modSummary = modData.summary || {};
      alert(`✅ Step 1 Complete!\n\nModifier Groups downloaded successfully!\n\n📊 Summary:\n• Groups created: ${modSummary.groupsCreated || 0}\n• Groups updated: ${modSummary.groupsUpdated || 0}\n• Modifiers created: ${modSummary.modifiersCreated || 0}\n• Total groups: ${modSummary.totalGroups || 0}\n\n⏭️ Proceeding to Step 2...`);
      
      // Step 2: Download Tax Groups (두 번째 다운로드 - 메뉴 연결에 필요)
      const taxRes = await fetch(`${API_URL}/menu-sync/download-tax-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Role': 'MANAGER' },
        body: JSON.stringify({ restaurantId: profile.firebase_restaurant_id })
      });
      const taxData = await taxRes.json();
      if (!taxData.success) {
        throw new Error(`Step 2 failed: Tax Groups download failed: ${taxData.error || 'Unknown error'}`);
      }
      const taxSummary = taxData.summary || {};
      alert(`✅ Step 2 Complete!\n\nTax Groups downloaded successfully!\n\n📊 Summary:\n• Groups created: ${taxSummary.groupsCreated || 0}\n• Groups updated: ${taxSummary.groupsUpdated || 0}\n• Taxes created: ${taxSummary.taxesCreated || 0}\n• Total groups: ${taxSummary.totalGroups || 0}\n\n⏭️ Proceeding to Step 3...`);
      
      // Step 3: Download Printer Groups (세 번째 다운로드 - 메뉴 연결에 필요)
      const printerRes = await fetch(`${API_URL}/menu-sync/download-printer-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Role': 'MANAGER' },
        body: JSON.stringify({ restaurantId: profile.firebase_restaurant_id })
      });
      const printerData = await printerRes.json();
      if (!printerData.success) {
        throw new Error(`Step 3 failed: Printer Groups download failed: ${printerData.error || 'Unknown error'}`);
      }
      const printerSummary = printerData.summary || {};
      alert(`✅ Step 3 Complete!\n\nPrinter Groups downloaded successfully!\n\n📊 Summary:\n• Groups created: ${printerSummary.groupsCreated || 0}\n• Groups updated: ${printerSummary.groupsUpdated || 0}\n• Total groups: ${printerSummary.totalGroups || 0}\n\n⏭️ Proceeding to Step 4 (Menu download)...`);
      
      // Step 4: Download Menu (마지막 다운로드 - 그룹들이 준비된 후)
      const res = await fetch(`${API_URL}/menu-sync/sync-from-firebase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Role': 'MANAGER' },
        body: JSON.stringify({ restaurantId: profile.firebase_restaurant_id, menuId: selectedMenuId })
      });
      const data = await res.json();
      
      if (!data.success) {
        throw new Error(`Step 4 failed: Menu download failed: ${data.error || 'Unknown error'}`);
      }
      
      const backupInfo = data.backup ? `\n\n💾 Backup created:\n• File: ${data.backup.filename}\n• Categories: ${data.backup.categoriesBackedUp || 0}\n• Items: ${data.backup.itemsBackedUp || 0}\n• Modifier Groups: ${data.backup.modifierGroupsBackedUp || 0}\n• Tax Groups: ${data.backup.taxGroupsBackedUp || 0}\n• Printer Groups: ${data.backup.printerGroupsBackedUp || 0}` : '';
      
      alert(`✅ Step 4 Complete!\n\nMenu downloaded successfully!\n\n📊 Summary:\n• Categories processed: ${data.summary.categoriesProcessed || 0}\n• New items created: ${data.summary.itemsCreated || 0}\n• Items updated: ${data.summary.itemsUpdated || 0}\n• Modifier links created: ${data.summary.modifierLinksCreated || 0}\n• Tax links created: ${data.summary.taxLinksCreated || 0}\n• Printer links created: ${data.summary.printerLinksCreated || 0}${backupInfo}\n\n✅ All downloads completed successfully!`);
      
        const syncRes = await fetch(`${API_URL}/menu-sync/sync-status`).then(r => r.json()).catch(() => null);
        if (syncRes?.stats) setSyncStatus({ linked: syncRes.stats.linkedItems, total: syncRes.stats.totalItems });
    } catch (e: any) {
      alert(`❌ Download failed at: ${e.message}\n\n⚠️ Previous steps completed successfully.\n💾 A backup was created before download.\n\nPlease check the error and try again or restore from backup.`);
    } finally {
      setSyncing(false);
    }
  };

  const handleUploadToThezoneorder = async () => {
    if (!profile.firebase_restaurant_id) {
      alert('Please enter Thezoneorder Restaurant ID first');
      return;
    }
    if (!window.confirm(`⚠️ Upload "Menu" to Thezoneorder?\n\nThis will upload:\n1. Modifier Groups\n2. Tax Groups\n3. Printer Groups\n4. Menu\n\nExisting Thezoneorder data will be backed up and replaced.`)) return;
    
    setUploading(true);
    
    try {
      // Step 1: Upload Modifier Groups
      const modRes = await fetch(`${API_URL}/menu-sync/upload-modifier-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Role': 'MANAGER' },
        body: JSON.stringify({ restaurantId: profile.firebase_restaurant_id, menuId: selectedMenuId })
      });
      const modData = await modRes.json();
      if (!modData.success) {
        throw new Error(`Modifier Groups upload failed: ${modData.error || 'Unknown error'}`);
      }
      const modGroups = modData.uploadedGroups || [];
      alert(`✅ Step 1 Complete!\n\nModifier Groups uploaded successfully!\n\n${modGroups.length} groups synced:\n${modGroups.map((g: any) => `• ${g.name} (${g.modifierCount || 0} options)`).join('\n')}`);
      
      // Step 2: Upload Tax Groups
      const taxRes = await fetch(`${API_URL}/menu-sync/upload-tax-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Role': 'MANAGER' },
        body: JSON.stringify({ restaurantId: profile.firebase_restaurant_id })
      });
      const taxData = await taxRes.json();
      if (!taxData.success) {
        throw new Error(`Tax Groups upload failed: ${taxData.error || 'Unknown error'}`);
      }
      const taxGroups = taxData.uploadedGroups || [];
      alert(`✅ Step 2 Complete!\n\nTax Groups uploaded successfully!\n\n${taxGroups.length} groups synced:\n${taxGroups.map((g: any) => `• ${g.name} (${g.taxCount || 0} taxes)`).join('\n')}`);
      
      // Step 3: Upload Printer Groups
      const printerRes = await fetch(`${API_URL}/menu-sync/upload-printer-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Role': 'MANAGER' },
        body: JSON.stringify({ restaurantId: profile.firebase_restaurant_id })
      });
      const printerData = await printerRes.json();
      if (!printerData.success) {
        throw new Error(`Printer Groups upload failed: ${printerData.error || 'Unknown error'}`);
      }
      const printerGroups = printerData.uploadedGroups || [];
      alert(`✅ Step 3 Complete!\n\nPrinter Groups uploaded successfully!\n\n${printerGroups.length} groups synced:\n${printerGroups.map((g: any) => `• ${g.name}`).join('\n')}`);
      
      // Step 4: Upload Menu (last)
      const res = await fetch(`${API_URL}/menu-sync/sync-to-firebase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Role': 'MANAGER' },
        body: JSON.stringify({ 
          restaurantId: profile.firebase_restaurant_id,
          menuId: selectedMenuId
        })
      });
      const data = await res.json();
      
      if (!data.success) {
        throw new Error(`Menu upload failed: ${data.error || 'Unknown error'}`);
      }
      
      alert(`✅ Step 4 Complete!\n\nMenu uploaded successfully!\n\n📤 Uploaded "Menu":\n  Categories: ${data.summary.categoriesUploaded}\n  Items: ${data.summary.itemsUploaded}\n\n💾 Backup saved:\n  Categories: ${data.backup?.categoriesBackedUp || 0}\n  Items: ${data.backup?.itemsBackedUp || 0}\n\n✅ All uploads completed successfully!`);
      
        loadBackups(profile.firebase_restaurant_id);
        const syncRes = await fetch(`${API_URL}/menu-sync/sync-status`).then(r => r.json()).catch(() => null);
        if (syncRes?.stats) setSyncStatus({ linked: syncRes.stats.linkedItems, total: syncRes.stats.totalItems });
    } catch (e: any) {
      alert(`❌ Upload failed: ${e.message}\n\nPlease try again or contact support.`);
    } finally {
      setUploading(false);
    }
  };

  const handleRestoreBackup = async (backupId: string) => {
    if (!window.confirm('⚠️ Restore this backup?\n\nCurrent Thezoneorder menu will be replaced.')) return;
    
    try {
      const res = await fetch(`${API_URL}/menu-sync/restore-backup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Role': 'MANAGER' },
        body: JSON.stringify({ backupId, restaurantId: profile.firebase_restaurant_id })
      });
      const data = await res.json();
      
      if (data.success) {
        alert(`✅ Restored!\n\nCategories: ${data.restored.categories}\nItems: ${data.restored.items}`);
      } else {
        alert('❌ Restore failed: ' + (data.error || 'Unknown error'));
      }
    } catch (e: any) {
      alert('❌ Restore failed: ' + e.message);
    }
  };

  // 🆕 전체 동기화 (TZO Cloud 형식) - 메뉴 컨테이너 + 카테고리 + 아이템 모두 동기화
  const handleFullSyncToCloud = async () => {
    if (!profile.firebase_restaurant_id) {
      alert('Please enter Thezoneorder Restaurant ID first');
      return;
    }
    if (!window.confirm(`🔄 Full Sync "Menu" to TZO Cloud?\n\n이 작업은:\n1. 모디파이어 그룹 업로드\n2. 세금 그룹 업로드\n3. 프린터 그룹 업로드\n4. 카테고리 업로드\n5. 메뉴 아이템 업로드\n6. 모든 연결 정보 업로드\n\n⚠️ 기존 같은 이름의 메뉴는 교체됩니다.\n\n계속하시겠습니까?`)) return;
    
    setFullSyncing(true);
    
    try {
      // Full sync to Firebase (모든 데이터를 한 번에 업로드)
      const res = await fetch(`${API_URL}/menu-sync/full-sync-to-firebase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Role': 'MANAGER' },
        body: JSON.stringify({ 
          restaurantId: profile.firebase_restaurant_id,
          menuId: selectedMenuId,
          deleteExisting: true
        })
      });
      const data = await res.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Full sync failed');
      }
      
      const s = data.summary;
      alert(`✅ Full Sync Complete!\n\n📁 Menu: ${s.menuName}\n\n📦 업로드된 데이터:\n• 모디파이어 그룹: ${s.modifierGroupsUploaded || 0}개\n• 세금 그룹: ${s.taxGroupsUploaded || 0}개\n• 프린터 그룹: ${s.printerGroupsUploaded || 0}개\n• 카테고리: ${s.categoriesUploaded}개\n• 아이템: ${s.itemsUploaded}개\n\n🔗 연결:\n• 카테고리-모디파이어: ${s.categoryModifierLinksUploaded || 0}개\n• 아이템-모디파이어: ${s.itemModifierLinksUploaded || 0}개\n• 카테고리-세금: ${s.categoryTaxLinksUploaded || 0}개\n• 아이템-세금: ${s.itemTaxLinksUploaded || 0}개\n• 카테고리-프린터: ${s.categoryPrinterLinksUploaded || 0}개\n• 아이템-프린터: ${s.itemPrinterLinksUploaded || 0}개\n\n🔗 Firebase Menu ID:\n${s.firebaseMenuId}\n\n이제 TZO Cloud와 온라인 주문에서 이 메뉴를 사용할 수 있습니다.`);
      
      // Refresh Firebase menus list
      loadFirebaseMenus(profile.firebase_restaurant_id);
      
    } catch (e: any) {
      alert(`❌ Full Sync Failed: ${e.message}\n\n일부 그룹은 업로드되었을 수 있습니다.`);
    } finally {
      setFullSyncing(false);
    }
  };

  // Load Firebase menus
  const loadFirebaseMenus = async (restaurantId: string) => {
    setLoadingFirebaseMenus(true);
    try {
      const res = await fetch(`${API_URL}/menu-sync/firebase-menus/${restaurantId}`);
      const data = await res.json();
      if (data.success) {
        setFirebaseMenus(data.menus || []);
      }
    } catch (e) {
      console.error('Failed to load Firebase menus:', e);
    } finally {
      setLoadingFirebaseMenus(false);
    }
  };

  // Delete Firebase menu
  const handleDeleteFirebaseMenu = async (menuId: string, menuName: string) => {
    if (!window.confirm(`⚠️ Delete "${menuName}" from TZO Cloud?\n\n이 메뉴와 연결된 모든 카테고리, 아이템이 삭제됩니다.\n\n⚠️ 이 작업은 취소할 수 없습니다!`)) return;
    
    try {
      const res = await fetch(`${API_URL}/menu-sync/firebase-menu/${profile.firebase_restaurant_id}/${menuId}`, {
        method: 'DELETE',
        headers: { 'X-Role': 'MANAGER' }
      });
      const data = await res.json();
      
      if (data.success) {
        alert(`✅ Deleted!\n\nCategories: ${data.deletedCategories}개\nItems: ${data.deletedItems}개`);
        loadFirebaseMenus(profile.firebase_restaurant_id);
      } else {
        alert('❌ Delete failed: ' + (data.error || 'Unknown error'));
      }
    } catch (e: any) {
      alert('❌ Delete failed: ' + e.message);
    }
  };

  // 프린터 그룹 업로드
  const [uploadingPrinters, setUploadingPrinters] = useState(false);
  
  const handleUploadPrinterGroups = async () => {
    if (!profile.firebase_restaurant_id) {
      alert('Please connect to Thezoneorder first');
      return;
    }
    
    if (!window.confirm('⚠️ Upload all printer group names to Thezoneorder?\n\nExisting Thezoneorder printer groups will be replaced.')) {
      return;
    }
    
    setUploadingPrinters(true);
    try {
      const res = await fetch(`${API_URL}/menu-sync/upload-printer-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Role': 'MANAGER' },
        body: JSON.stringify({ restaurantId: profile.firebase_restaurant_id })
      });
      const data = await res.json();
      
      if (data.success) {
        const groups = data.uploadedGroups || [];
        alert(`✅ Printer Groups Uploaded!\n\n${groups.length} groups synced:\n${groups.map((g: any) => `• ${g.name}`).join('\n')}`);
      } else {
        alert('❌ Upload failed: ' + (data.error || 'Unknown error'));
      }
    } catch (e: any) {
      alert('❌ Upload failed: ' + e.message);
    } finally {
      setUploadingPrinters(false);
    }
  };

  // 세금 그룹 업로드/다운로드
  const [uploadingTaxes, setUploadingTaxes] = useState(false);
  const [downloadingTaxes, setDownloadingTaxes] = useState(false);
  
  const handleUploadTaxGroups = async () => {
    if (!profile.firebase_restaurant_id) {
      alert('Please connect to Thezoneorder first');
      return;
    }
    
    if (!window.confirm('⚠️ Upload all tax groups to Thezoneorder?\n\nExisting Thezoneorder tax groups will be replaced.')) {
      return;
    }
    
    setUploadingTaxes(true);
    try {
      const res = await fetch(`${API_URL}/menu-sync/upload-tax-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Role': 'MANAGER' },
        body: JSON.stringify({ restaurantId: profile.firebase_restaurant_id })
      });
      const data = await res.json();
      
      if (data.success) {
        const groups = data.uploadedGroups || [];
        alert(`✅ Tax Groups Uploaded!\n\n${groups.length} groups synced:\n${groups.map((g: any) => `• ${g.name} (${g.taxCount} taxes)`).join('\n')}`);
      } else {
        alert('❌ Upload failed: ' + (data.error || 'Unknown error'));
      }
    } catch (e: any) {
      alert('❌ Upload failed: ' + e.message);
    } finally {
      setUploadingTaxes(false);
    }
  };

  const handleDownloadTaxGroups = async () => {
    if (!profile.firebase_restaurant_id) {
      alert('Please connect to Thezoneorder first');
      return;
    }
    
    if (!window.confirm('⚠️ Download tax groups from Thezoneorder?\n\nThis will add new tax groups and update existing ones (matched by name).')) {
      return;
    }
    
    setDownloadingTaxes(true);
    try {
      const res = await fetch(`${API_URL}/menu-sync/download-tax-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Role': 'MANAGER' },
        body: JSON.stringify({ restaurantId: profile.firebase_restaurant_id })
      });
      const data = await res.json();
      
      if (data.success) {
        const s = data.summary;
        alert(`✅ Tax Groups Downloaded!\n\n📊 Summary:\n• Groups created: ${s.groupsCreated}\n• Groups updated: ${s.groupsUpdated}\n• Taxes created: ${s.taxesCreated}\n• Total groups: ${s.totalGroups}`);
      } else {
        alert('❌ Download failed: ' + (data.error || 'Unknown error'));
      }
    } catch (e: any) {
      alert('❌ Download failed: ' + e.message);
    } finally {
      setDownloadingTaxes(false);
    }
  };

  // 모디파이어 그룹 업로드/다운로드
  const [uploadingModifiers, setUploadingModifiers] = useState(false);
  const [downloadingModifiers, setDownloadingModifiers] = useState(false);
  
  const handleUploadModifierGroups = async () => {
    if (!profile.firebase_restaurant_id) {
      alert('Please connect to Thezoneorder first');
      return;
    }
    
    if (!window.confirm('⚠️ Upload all Modifier groups to Thezoneorder?\n\nExisting Thezoneorder Modifier groups will be replaced.\n\nThis includes Price1 and Price2 for each option.')) {
      return;
    }
    
    setUploadingModifiers(true);
    try {
      const res = await fetch(`${API_URL}/menu-sync/upload-modifier-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Role': 'MANAGER' },
        body: JSON.stringify({ restaurantId: profile.firebase_restaurant_id })
      });
      const data = await res.json();
      
      if (data.success) {
        const groups = data.uploadedGroups || [];
        alert(`✅ Modifier Groups Uploaded!\n\n${groups.length} groups synced:\n${groups.map((g: any) => `• ${g.name} (${g.modifierCount} options)`).join('\n')}`);
      } else {
        alert('❌ Upload failed: ' + (data.error || 'Unknown error'));
      }
    } catch (e: any) {
      alert('❌ Upload failed: ' + e.message);
    } finally {
      setUploadingModifiers(false);
    }
  };

  const handleDownloadModifierGroups = async () => {
    if (!profile.firebase_restaurant_id) {
      alert('Please connect to Thezoneorder first');
      return;
    }
    
    if (!window.confirm('⚠️ Download Modifier groups from Thezoneorder?\n\nThis will add new Modifier groups and update existing ones (matched by name + label).\n\nPrice1 and Price2 will be downloaded for each option.')) {
      return;
    }
    
    setDownloadingModifiers(true);
    try {
      const res = await fetch(`${API_URL}/menu-sync/download-modifier-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Role': 'MANAGER' },
        body: JSON.stringify({ restaurantId: profile.firebase_restaurant_id })
      });
      const data = await res.json();
      
      if (data.success) {
        const s = data.summary;
        alert(`✅ Modifier Groups Downloaded!\n\n📊 Summary:\n• Groups created: ${s.groupsCreated}\n• Groups updated: ${s.groupsUpdated}\n• Modifiers created: ${s.modifiersCreated}\n• Total groups: ${s.totalGroups}`);
      } else {
        alert('❌ Download failed: ' + (data.error || 'Unknown error'));
      }
    } catch (e: any) {
      alert('❌ Download failed: ' + e.message);
    } finally {
      setDownloadingModifiers(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">🌐 Thezoneorder Sync</h1>
          <p className="text-gray-600">Synchronize your menu data between POS and Thezoneorder</p>
        </div>

        {/* Main Content - 2 Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* LEFT: Thezoneorder Connection */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-slate-600 px-6 py-4">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <span className="text-2xl">🔥</span>
                Thezoneorder Connection
          {cloudConnected && (
                  <span className="ml-auto text-sm font-normal bg-green-500 text-white px-3 py-1 rounded-full flex items-center gap-1">
                    <span className="w-2 h-2 bg-white rounded-full"></span>
                    Connected
            </span>
          )}
        </h2>
            </div>
        
            <div className="p-6 space-y-6">
              {/* Restaurant ID Input */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Thezoneorder Restaurant ID
                </label>
            <input 
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg font-mono text-sm bg-gray-100 text-gray-600 cursor-not-allowed" 
              value={profile.firebase_restaurant_id || ''} 
              readOnly
              disabled
              placeholder="e.g. 1TmCcBm2qQdVaQT30wVm"
            />
          </div>
              
              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-3">
                <button 
                  onClick={handleTestConnection} 
                  className="px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-all shadow-sm hover:shadow"
                >
                  ✓ Verify
            </button>
                <button 
                  onClick={handleSaveId} 
                  className="px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-all shadow-sm hover:shadow"
                >
              💾 Save ID
            </button>
        </div>
        
              {/* Sync Status */}
        {syncStatus && (
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-gray-700">Sync Status</div>
                      <div className="text-2xl font-bold text-gray-900 mt-1">
                        {syncStatus.linked} / {syncStatus.total}
                      </div>
                      <div className="text-xs text-gray-600 mt-1">items linked</div>
                    </div>
                    <div className="text-4xl">📊</div>
                  </div>
          </div>
        )}
            </div>
      </div>

          {/* RIGHT: Menu Synchronization */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-slate-600 px-6 py-4">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <span className="text-2xl">🔄</span>
                Menu Synchronization
              </h2>
            </div>
        
            <div className="p-6 space-y-6">
              {/* Upload Section */}
              <div className="border border-green-300 rounded-lg p-4 bg-green-50">
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-2xl">🔄</span>
                  <h3 className="text-lg font-bold text-green-800">Full Sync to TZO Cloud</h3>
                  <span className="ml-auto text-xs bg-green-600 text-white px-2 py-1 rounded-full">추천</span>
          </div>
          
                <div className="space-y-3">
            <button 
              onClick={handleFullSyncToCloud}
              disabled={fullSyncing || !profile.firebase_restaurant_id}
                    className={`w-full px-4 py-3 rounded-lg text-sm font-bold transition-all ${
                      fullSyncing 
                        ? 'bg-gray-300 cursor-not-allowed text-gray-500' 
                        : 'bg-green-600 text-white hover:bg-green-700 shadow-sm hover:shadow'
              }`}
            >
                    {fullSyncing ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="animate-spin">⏳</span>
                        Syncing...
                      </span>
                    ) : (
                      '🔄 Full Sync to Cloud'
                    )}
            </button>
                  
                  <p className="text-xs text-gray-600 mt-2">
                    ✅ 메뉴 + 카테고리 + 아이템을 TZO Cloud에 완전히 동기화합니다.<br/>
                    ✅ posId가 포함되어 온라인 주문 시 프린터 라우팅이 정확해집니다.
                  </p>
                </div>
          </div>

              {/* Download Section */}
              <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-2xl">📥</span>
                  <h3 className="text-lg font-bold text-gray-800">Download from Thezoneorder</h3>
          </div>

                <div className="space-y-3">
              <button 
                    onClick={handleSyncFromThezoneorder}
                    disabled={syncing || !profile.firebase_restaurant_id}
                    className={`w-full px-4 py-3 rounded-lg text-sm font-bold transition-all ${
                      syncing 
                        ? 'bg-gray-300 cursor-not-allowed text-gray-500' 
                        : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm hover:shadow'
                }`}
              >
                    {syncing ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="animate-spin">⏳</span>
                        Downloading...
                      </span>
                    ) : (
                      '📥 Download All'
                    )}
              </button>
                  
                  <p className="text-xs text-gray-500 mt-2">
                    Downloads: Modifiers → Taxes → Printers → Menu (with backup)
                  </p>
                </div>
            </div>
          </div>
        </div>
      </div>

        {/* Backups Section - Full Width */}
        <div className="mt-6 bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="bg-slate-600 px-6 py-4">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <span className="text-2xl">💾</span>
              Thezoneorder Menu Backups
            </h2>
          </div>
          
          <div className="p-6">
        {loadingBackups ? (
              <div className="text-center py-8 text-gray-500">
                <div className="animate-spin text-4xl mb-2">⏳</div>
                <div>Loading backups...</div>
              </div>
        ) : backups.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <div className="text-4xl mb-2">📦</div>
                <div>No backups yet.</div>
                <div className="text-sm mt-1">Backups are created automatically when uploading to Thezoneorder.</div>
              </div>
        ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {backups.map((backup) => (
                  <div key={backup.id} className="bg-gray-50 rounded-lg p-4 border border-gray-200 hover:shadow transition-all">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <div className="font-semibold text-gray-800 text-sm mb-1">
                    {new Date(backup.backupDate).toLocaleString()}
                  </div>
                        <div className="text-xs text-gray-600">
                    {backup.categoryCount} categories, {backup.itemCount} items
                        </div>
                  </div>
                </div>
                <button
                  onClick={() => handleRestoreBackup(backup.id)}
                      className="w-full px-3 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 font-medium transition-all shadow-sm hover:shadow"
                >
                  ↩️ Restore
                </button>
              </div>
            ))}
          </div>
        )}
          </div>
        </div>

      </div>
    </div>
  );
};

const MenuListPage = () => {
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  // Tab state - URL param으로 tax 또는 sync가 지정되면 해당 탭 표시, 아니면 menus(→ 편집 페이지로 리다이렉트)
  const [activeTab, setActiveTab] = useState<'menus' | 'tax' | 'sync'>(
    tabParam === 'tax' ? 'tax' : tabParam === 'sync' ? 'sync' : 'menus'
  );
  
  const [menus, setMenus] = useState<Menu[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [newMenuName, setNewMenuName] = useState('');
  const [newMenuDescription, setNewMenuDescription] = useState('');
  const [newMenuChannels, setNewMenuChannels] = useState<string[]>([]);
  
  // Copy Modal State
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [copyMenuId, setCopyMenuId] = useState<number | null>(null);
  const [copyMenuName, setCopyMenuName] = useState('');
  const [copyMenuChannels, setCopyMenuChannels] = useState<string[]>([]);
  
  const SALES_CHANNELS = [
    { id: 'dine-in', label: 'Dine-In' },
    { id: 'table-order', label: 'Table Order' },
    { id: 'online', label: 'Online' },
    { id: 'togo', label: 'Togo' },
    { id: 'delivery', label: 'Delivery' },
  ];
  const [deleteConfirm, setDeleteConfirm] = useState<{ show: boolean; menuId: number | null; menuName: string }>({
    show: false,
    menuId: null,
    menuName: ''
  });
  const [backups, setBackups] = useState<{ [menuId: number]: BackupFile[] }>({});
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [selectedMenuId, setSelectedMenuId] = useState<number | null>(null);
  const [isRestoringBackup, setIsRestoringBackup] = useState(false);
  // Manager PIN 모달 제거
  const navigate = useNavigate();

  // 'menus' 탭은 비워진 상태로 유지
  useEffect(() => {
    if (activeTab === 'menus') {
      navigate('/backoffice/menu?tab=menus', { replace: true });
    }
  }, [activeTab, navigate]);

  useEffect(() => {
    const fetchAllMenus = async () => {
      try {
        const res = await fetch(`${API_URL}/menus`);
        if (!res.ok) throw new Error('Failed to fetch menus');
        const data = await res.json();
        setMenus(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error('Failed to fetch menus', e);
        setMenus([]);
      }
    };
    fetchAllMenus();
  }, []);

  // Basic Info moved to BasicInfoPage (no-op here)

  const handleEditMenu = (menu: Menu) => {
    navigate(`/backoffice/menu/edit/${menu.menu_id}`);
  };

  const handleCopyMenuClick = (menu: Menu) => {
    setCopyMenuId(menu.menu_id);
    setCopyMenuName(`${menu.name} (Copy)`);
    setCopyMenuChannels(menu.sales_channels || []);
    setShowCopyModal(true);
  };

  const handleCopyMenu = async () => {
    if (!copyMenuId) return;
    if (copyMenuChannels.length === 0) {
      alert('Please select at least one sales channel');
      return;
    }
    try {
      const response = await fetch(`${API_URL}/menus/${copyMenuId}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: copyMenuName,
          sales_channels: copyMenuChannels
        })
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to copy menu');
      }
      const baseRes = await fetch(`${API_URL}/menus`);
      const baseData = await baseRes.json();
      setMenus(Array.isArray(baseData) ? baseData : []);
      setShowCopyModal(false);
      setCopyMenuId(null);
      setCopyMenuName('');
      setCopyMenuChannels([]);
    } catch (error: any) {
      console.error('Error copying menu:', error);
      alert(error?.message || 'Copy failed');
    }
  };

  const handleDeleteMenu = (menuId: number) => {
    const menu = menus.find(m => m.menu_id === menuId);
    if (menu) {
      setDeleteConfirm({ show: true, menuId: menuId, menuName: menu.name });
    }
  };

  const confirmDelete = async () => {
    if (!deleteConfirm.menuId) return;
    try {
      const response = await fetch(`${API_URL}/menus/${deleteConfirm.menuId}`, { method: 'DELETE' });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to delete');
      }
      setMenus(prev => prev.filter(menu => menu.menu_id !== deleteConfirm.menuId));
      setDeleteConfirm({ show: false, menuId: null, menuName: '' });
    } catch (e: any) {
      console.error('Error deleting menu:', e);
      alert(e?.message || 'Delete failed');
    }
  };

  const cancelDelete = () => {
    setDeleteConfirm({ show: false, menuId: null, menuName: '' });
  };

  const loadBackups = async (menuId: number) => {
    try {
      const response = await fetch(`${API_URL}/menu/${menuId}/backups`);
      if (!response.ok) throw new Error('Failed to fetch backups');
      const data = await response.json();
      setBackups(prev => ({ ...prev, [menuId]: data.backups }));
    } catch (error) {
      console.error('Failed to load backups:', error);
    }
  };

  const handleBackupClick = async (menuId: number) => {
    setSelectedMenuId(menuId);
    await loadBackups(menuId);
    setShowBackupModal(true);
  };

  const handleDownloadBackup = async (filename: string) => {
    if (!selectedMenuId) return;
    try {
      const response = await fetch(`${API_URL}/menu/${selectedMenuId}/backups/${filename}`);
      if (!response.ok) throw new Error('Failed to download backup');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Failed to download backup:', error);
      alert('Failed to download backup');
    }
  };

  const handleRestoreBackup = async (backupFile: File) => {
    if (!selectedMenuId) return;
    setIsRestoringBackup(true);
    try {
      const formData = new FormData();
      formData.append('backup', backupFile);
      const response = await fetch(`${API_URL}/menu/${selectedMenuId}/restore-backup`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) throw new Error('Failed to restore backup');
      alert('Backup restored successfully!');
      setShowBackupModal(false);
      setSelectedMenuId(null);
    } catch (error) {
      console.error('Failed to restore backup:', error);
      alert('Failed to restore backup');
    } finally {
      setIsRestoringBackup(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-2 pb-20">
        {/* Header with Tabs - 한 줄에 제목과 탭 */}
        <div className="flex items-center gap-6 mb-4 border-b pb-2">
          <h1 className="text-xl font-bold text-gray-900 whitespace-nowrap">Menu Manager</h1>
          
          {/* Tabs */}
          <div className="flex gap-1">
            <button
              onClick={() => { setActiveTab('menus'); navigate('/backoffice/menu?tab=menus', { replace: true }); }}
              className={`px-4 py-2 font-medium rounded-t-lg transition-colors text-sm ${
                activeTab === 'menus'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              Menu
            </button>
            <button
              onClick={() => { setActiveTab('tax'); navigate('/backoffice/menu?tab=tax', { replace: true }); }}
              className={`px-4 py-2 font-medium rounded-t-lg transition-colors text-sm ${
                activeTab === 'tax'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              Tax Settings
            </button>
            <button
              onClick={() => { setActiveTab('sync'); navigate('/backoffice/menu?tab=sync', { replace: true }); }}
              className={`px-4 py-2 font-medium rounded-t-lg transition-colors text-sm ${
                activeTab === 'sync'
                  ? 'bg-orange-500 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              🌐 Thezoneorder Sync
            </button>
          </div>
        </div>

        {/* Menus Tab Content */}
        {activeTab === 'menus' && (
          <div className="space-y-4">
            {menus.length === 0 ? (
              <div className="py-10 text-center text-gray-500">
                메뉴가 없습니다.
              </div>
            ) : (
              <div className="bg-white rounded-lg border shadow-sm">
                <div className="px-4 py-3 border-b text-sm font-medium text-gray-700">
                  Menus
                </div>
                <div className="divide-y">
                  {menus.map(menu => (
                    <div key={menu.menu_id} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <div className="font-semibold text-gray-900">{menu.name}</div>
                        <div className="text-xs text-gray-500">Menu ID: {menu.menu_id}</div>
                        <div className="text-xs text-gray-500">
                          Channels: {Array.isArray(menu.sales_channels) && menu.sales_channels.length > 0 ? menu.sales_channels.join(', ') : 'All'}
                        </div>
                      </div>
                      <button
                        onClick={() => handleEditMenu(menu)}
                        className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700"
                      >
                        Open
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tax Settings Tab Content */}
        {activeTab === 'tax' && (
          <TaxSettingsTab />
        )}

        {/* Thezoneorder Sync Tab Content */}
        {activeTab === 'sync' && (
          <ThezoneorderSyncTab />
        )}

       {/* Delete Confirmation Modal */}
       {deleteConfirm.show && (
         <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
           <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
             <h3 className="text-lg font-semibold text-slate-800 mb-4">Delete Menu</h3>
             <p className="text-slate-600 mb-6">
               Delete <strong>"{deleteConfirm.menuName}"</strong>?
             </p>
             <div className="flex justify-end space-x-3">
               <button 
                 onClick={cancelDelete}
                 className="px-4 py-2 text-slate-600 bg-slate-200 hover:bg-slate-300 rounded-md transition-colors"
               >
                 Cancel
               </button>
               <button 
                 onClick={confirmDelete}
                 className="px-4 py-2 text-white bg-red-500 hover:bg-red-600 rounded-md transition-colors"
               >
                 Delete
               </button>
             </div>
           </div>
         </div>
       )}

       {/* Copy Menu Modal */}
       {showCopyModal && copyMenuId && (
         <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
           <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
             <h3 className="text-lg font-semibold text-slate-800 mb-4">Copy Menu</h3>
             <div className="space-y-4">
               <div>
                 <label className="block text-sm font-medium text-gray-700 mb-1">Menu Name</label>
                 <input
                   type="text"
                   value={copyMenuName}
                   onChange={(e) => setCopyMenuName(e.target.value)}
                   className="w-full px-3 py-2 border rounded"
                 />
               </div>
               <div>
                 <label className="block text-sm font-medium text-gray-700 mb-2">
                   Sales Channels <span className="text-red-500">*</span>
                 </label>
                 <div className="flex flex-wrap gap-3">
                   {SALES_CHANNELS.map(channel => (
                     <label key={channel.id} className="flex items-center gap-2 cursor-pointer">
                       <input
                         type="checkbox"
                         checked={copyMenuChannels.includes(channel.id)}
                         onChange={(e) => {
                           if (e.target.checked) {
                             setCopyMenuChannels(prev => [...prev, channel.id]);
                           } else {
                             setCopyMenuChannels(prev => prev.filter(c => c !== channel.id));
                           }
                         }}
                         className="w-4 h-4 text-blue-600 rounded"
                       />
                       <span className="text-sm text-gray-700">{channel.label}</span>
                     </label>
                   ))}
                 </div>
                 {copyMenuChannels.length === 0 && (
                   <p className="text-xs text-red-500 mt-1">At least one channel must be selected</p>
                 )}
               </div>
             </div>
             <div className="flex justify-end space-x-3 mt-6">
               <button 
                 onClick={() => { setShowCopyModal(false); setCopyMenuId(null); setCopyMenuName(''); setCopyMenuChannels([]); }}
                 className="px-4 py-2 text-slate-600 bg-slate-200 hover:bg-slate-300 rounded-md transition-colors"
               >
                 Cancel
               </button>
               <button 
                 onClick={handleCopyMenu}
                 disabled={copyMenuChannels.length === 0}
                 className={`px-4 py-2 rounded-md transition-colors ${copyMenuChannels.length === 0 ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
               >
                 Copy
               </button>
             </div>
           </div>
         </div>
       )}

       {/* Backup Modal */}
       {showBackupModal && selectedMenuId && (
         <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
           <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
             <div className="flex justify-between items-center mb-4">
               <h3 className="text-lg font-semibold text-slate-800">Backup Management</h3>
               <button 
                 onClick={() => setShowBackupModal(false)}
                 className="text-slate-400 hover:text-slate-600"
               >
                 ✕
               </button>
             </div>
             <div className="mb-6">
               <h4 className="text-md font-medium text-slate-700 mb-3">Available Backups</h4>
               {backups[selectedMenuId] && backups[selectedMenuId].length > 0 ? (
                 <div className="space-y-2">
                   {backups[selectedMenuId].map((backup) => (
                     <div key={backup.filename} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                       <div className="flex-1">
                         <div className="font-medium text-slate-800">{backup.filename}</div>
                         <div className="text-sm text-slate-500">
                           {new Date(backup.timestamp).toLocaleString()} • {(backup.size / 1024).toFixed(1)} KB
                         </div>
                       </div>
                       <div className="flex space-x-2">
                         <button
                           onClick={() => handleDownloadBackup(backup.filename)}
                           className="px-3 py-1 text-xs font-medium text-blue-600 bg-blue-100 hover:bg-blue-200 rounded-md transition-colors"
                         >
                           Download
                         </button>
                       </div>
                     </div>
                   ))}
                 </div>
               ) : (
                 <p className="text-slate-500 text-center py-4">No backups available for this menu.</p>
               )}
             </div>
             <div className="border-t pt-4">
               <h4 className="text-md font-medium text-slate-700 mb-3">Restore from Backup</h4>
               <div className="space-y-3">
                 <input
                   type="file"
                   accept=".json"
                   onChange={(e) => {
                     const file = e.target.files?.[0];
                     if (file) handleRestoreBackup(file);
                   }}
                   className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                 />
                 {isRestoringBackup && (
                   <div className="text-sm text-blue-600">Restoring backup...</div>
                 )}
               </div>
             </div>
           </div>
         </div>
       )}
      </div>
    </div>
  );
};

export default MenuListPage;