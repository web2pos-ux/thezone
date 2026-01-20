import React, { useState, useEffect, useCallback } from 'react';
import { API_URL } from '../config/constants';

type PromotionType = 
  | 'percent_cart' 
  | 'percent_items' 
  | 'free_delivery' 
  | 'bogo' 
  | 'fixed_discount' 
  | 'free_item';

interface Promotion {
  id: string;
  type: PromotionType;
  name: string;
  message?: string;
  description: string;
  active: boolean;
  minOrderAmount?: number;
  discountPercent?: number;
  discountAmount?: number;
  validFrom?: string;
  validUntil?: string;
  channels: string[];
  selectedItems?: string[];
  selectedCategories?: string[];
  freeItemId?: string;
  freeItemName?: string;
  buyQuantity?: number;
  getQuantity?: number;
  createdAt?: string;
  updatedAt?: string;
  syncedFromFirebase?: boolean;
}

interface Category {
  id: string;
  name: string;
}

interface MenuItem {
  id: string;
  name: string;
  price: number;
  categoryId?: string;
}

const PosPromotionsPage: React.FC = () => {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  
  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<PromotionType>('percent_cart');
  const [editingPromotion, setEditingPromotion] = useState<Promotion | null>(null);
  
  // Item selection state
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<{ id: string; name: string }[]>([]);
  
  // Channel selection state
  const ALL_CHANNELS = [
    { id: 'online', label: 'Online Order' },
    { id: 'togo', label: 'Togo' },
    { id: 'dine-in', label: 'Dine-in' },
    { id: 'delivery', label: 'Delivery' },
    { id: 'table-order', label: 'Table Order' },
    { id: 'kiosk', label: 'Kiosk' }
  ];
  const [selectedChannels, setSelectedChannels] = useState<string[]>(ALL_CHANNELS.map(c => c.id));
  
  // Load promotions
  const loadPromotions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/promotions/pos-promotions`);
      if (res.ok) {
        const data = await res.json();
        setPromotions(data.promotions || []);
      }
    } catch (e) {
      console.error('Failed to load promotions:', e);
    } finally {
      setLoading(false);
    }
  }, []);
  
  // Load categories and menu items
  const loadMenuData = useCallback(async () => {
    try {
      const menusRes = await fetch(`${API_URL}/menus`);
      if (menusRes.ok) {
        const menus = await menusRes.json();
        const first = Array.isArray(menus) && menus.length > 0 ? menus[0] : null;
        if (first) {
          const strRes = await fetch(`${API_URL}/menus/${first.menu_id || first.id}/structure`);
          if (strRes.ok) {
            const data = await strRes.json();
            const cats: Category[] = [];
            const items: MenuItem[] = [];
            (Array.isArray(data) ? data : []).forEach((c: any) => {
              cats.push({ id: String(c.category_id), name: c.name });
              (c.items || []).forEach((it: any) => {
                items.push({
                  id: String(it.item_id || it.id),
                  name: it.name,
                  price: it.price || 0,
                  categoryId: String(c.category_id)
                });
              });
            });
            setCategories(cats);
            setMenuItems(items);
          }
        }
      }
    } catch (e) {
      console.error('Failed to load menu data:', e);
    }
  }, []);
  
  useEffect(() => {
    loadPromotions();
  }, [loadPromotions]);
  
  // Save promotion (with auto-sync to Firebase)
  const savePromotion = async (promo: Promotion, isNew: boolean) => {
    setSaving(true);
    try {
      const url = isNew 
        ? `${API_URL}/promotions/pos-promotions`
        : `${API_URL}/promotions/pos-promotions/${promo.id}`;
      const method = isNew ? 'POST' : 'PUT';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(promo)
      });
      
      if (res.ok) {
        // 🔄 Auto-sync to Firebase after saving to POS
        try {
          console.log('🔄 Auto-syncing promotion to Firebase...');
          const syncRes = await fetch(`${API_URL}/promotions/pos-promotions/sync-to-firebase`, { method: 'POST' });
          if (syncRes.ok) {
            const syncData = await syncRes.json();
            console.log(`✅ Auto-synced ${syncData.synced} promotions to Firebase`);
          } else {
            console.warn('⚠️ Firebase sync failed, but POS save succeeded');
          }
        } catch (syncErr) {
          console.warn('⚠️ Firebase auto-sync error:', syncErr);
        }
        
        await loadPromotions();
        setModalOpen(false);
        setEditingPromotion(null);
        setSelectedItems([]);
      }
    } catch (e) {
      console.error('Failed to save promotion:', e);
    } finally {
      setSaving(false);
    }
  };
  
  // Delete promotion (with auto-sync to Firebase)
  const deletePromotion = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this promotion?')) return;
    try {
      await fetch(`${API_URL}/promotions/pos-promotions/${id}`, { method: 'DELETE' });
      
      // 🔄 Auto-sync to Firebase after delete
      try {
        console.log('🔄 Auto-syncing promotions to Firebase after delete...');
        await fetch(`${API_URL}/promotions/pos-promotions/sync-to-firebase`, { method: 'POST' });
      } catch (syncErr) {
        console.warn('⚠️ Firebase auto-sync error:', syncErr);
      }
      
      await loadPromotions();
    } catch (e) {
      console.error('Failed to delete promotion:', e);
    }
  };
  
  // Toggle promotion active status (with auto-sync to Firebase)
  const togglePromotion = async (id: string, active: boolean) => {
    try {
      await fetch(`${API_URL}/promotions/pos-promotions/${id}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active })
      });
      
      // 🔄 Auto-sync to Firebase after toggle
      try {
        console.log('🔄 Auto-syncing promotions to Firebase after toggle...');
        await fetch(`${API_URL}/promotions/pos-promotions/sync-to-firebase`, { method: 'POST' });
      } catch (syncErr) {
        console.warn('⚠️ Firebase auto-sync error:', syncErr);
      }
      
      await loadPromotions();
    } catch (e) {
      console.error('Failed to toggle promotion:', e);
    }
  };
  
  // Sync from Firebase
  const syncFromFirebase = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`${API_URL}/promotions/pos-promotions/sync-from-firebase`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        alert(`Synced ${data.synced} promotions from Thezone Cloud`);
        await loadPromotions();
      }
    } catch (e) {
      console.error('Failed to sync from Firebase:', e);
      alert('Failed to sync from Thezone Cloud');
    } finally {
      setSyncing(false);
    }
  };
  
  // Sync to Firebase
  const syncToFirebase = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`${API_URL}/promotions/pos-promotions/sync-to-firebase`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        alert(`Synced ${data.synced} promotions to Thezone Cloud`);
      }
    } catch (e) {
      console.error('Failed to sync to Firebase:', e);
      alert('Failed to sync to Thezone Cloud');
    } finally {
      setSyncing(false);
    }
  };
  
  // Open create modal
  const openCreateModal = (type: PromotionType) => {
    setEditingPromotion(null);
    setModalType(type);
    setSelectedItems([]);
    setSelectedCategory(null);
    setSelectedChannels(ALL_CHANNELS.map(c => c.id)); // Default: all channels selected
    if (['percent_items', 'bogo', 'free_item'].includes(type)) {
      loadMenuData();
    }
    setModalOpen(true);
  };
  
  // Open edit modal
  const openEditModal = (promo: Promotion) => {
    setEditingPromotion(promo);
    setModalType(promo.type);
    if (promo.selectedItems && promo.selectedCategories) {
      setSelectedItems(promo.selectedItems.map((id, idx) => ({
        id,
        name: promo.selectedCategories?.[idx] || id
      })));
    } else {
      setSelectedItems([]);
    }
    setSelectedCategory(null);
    // Load existing channels or default to all
    setSelectedChannels(promo.channels?.length > 0 ? promo.channels : ALL_CHANNELS.map(c => c.id));
    if (['percent_items', 'bogo', 'free_item'].includes(promo.type)) {
      loadMenuData();
    }
    setModalOpen(true);
  };
  
  // Handle form submit
  const handleSubmit = () => {
    const nameInput = document.getElementById('promo-name') as HTMLInputElement;
    const messageInput = document.getElementById('promo-message') as HTMLInputElement;
    const descInput = document.getElementById('promo-desc') as HTMLTextAreaElement;
    const discountInput = document.getElementById('promo-discount') as HTMLInputElement;
    const minOrderInput = document.getElementById('promo-min-order') as HTMLInputElement;
    const validFromInput = document.getElementById('promo-valid-from') as HTMLInputElement;
    const validUntilInput = document.getElementById('promo-valid-until') as HTMLInputElement;
    
    const promo: Promotion = {
      id: editingPromotion?.id || `promo_${Date.now()}`,
      type: modalType,
      name: nameInput?.value || 'Untitled Promotion',
      message: messageInput?.value || '',
      description: descInput?.value || '',
      active: editingPromotion?.active ?? true,
      discountPercent: modalType !== 'fixed_discount' ? parseFloat(discountInput?.value) || undefined : undefined,
      discountAmount: modalType === 'fixed_discount' ? parseFloat(discountInput?.value) || undefined : undefined,
      minOrderAmount: parseFloat(minOrderInput?.value) || undefined,
      validFrom: validFromInput?.value || undefined,
      validUntil: validUntilInput?.value || undefined,
      channels: selectedChannels,
      selectedItems: ['percent_items', 'bogo', 'free_item'].includes(modalType) ? selectedItems.map(i => i.id) : undefined,
      selectedCategories: ['percent_items', 'bogo', 'free_item'].includes(modalType) ? selectedItems.map(i => i.name) : undefined
    };
    
    savePromotion(promo, !editingPromotion);
  };
  
  // Get promotion type icon
  const getTypeIcon = (type: PromotionType) => {
    switch (type) {
      case 'percent_cart': return '💰';
      case 'percent_items': return '🏷️';
      case 'free_delivery': return '🚚';
      case 'bogo': return '🎁';
      case 'fixed_discount': return '💵';
      case 'free_item': return '🆓';
      default: return '🎁';
    }
  };
  
  // Get promotion type label
  const getTypeLabel = (type: PromotionType) => {
    switch (type) {
      case 'percent_cart': return '% Discount on Cart';
      case 'percent_items': return '% Discount on Items';
      case 'free_delivery': return 'Free Delivery';
      case 'bogo': return 'Buy One, Get One Free';
      case 'fixed_discount': return 'Fixed Discount';
      case 'free_item': return 'Free Item';
      default: return type;
    }
  };
  
  // Filtered items for selected category
  const filteredItems = selectedCategory 
    ? menuItems.filter(item => item.categoryId === selectedCategory)
    : [];
  
  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Promotions</h1>
              <p className="text-gray-500 mt-1">Manage POS promotions and sync with Thezone Cloud</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={syncFromFirebase}
                disabled={syncing}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 flex items-center gap-2"
              >
                ⬇️ Sync from Thezone Cloud
              </button>
              <button
                onClick={syncToFirebase}
                disabled={syncing}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 flex items-center gap-2"
              >
                ⬆️ Sync to Thezone Cloud
              </button>
            </div>
          </div>
        </div>
        
        {/* Existing Promotions */}
        {loading ? (
          <div className="bg-white rounded-lg shadow-sm p-8 text-center text-gray-500">
            Loading promotions...
          </div>
        ) : promotions.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Active Promotions ({promotions.length})</h2>
            <div className="space-y-3">
              {promotions.map(promo => (
                <div 
                  key={promo.id}
                  className={`p-4 rounded-lg border-2 flex items-center justify-between ${
                    promo.active ? 'border-green-500 bg-green-50' : 'border-gray-200 bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-lg bg-white flex items-center justify-center text-2xl shadow-sm">
                      {getTypeIcon(promo.type)}
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900">{promo.name}</div>
                      <div className="text-sm text-gray-500">{promo.description}</div>
                      {(promo.validFrom || promo.validUntil) && (
                        <div className="text-xs text-indigo-600 mt-1">
                          🗓️ {promo.validFrom || 'Start'} ~ {promo.validUntil || 'Ongoing'}
                        </div>
                      )}
                      {promo.syncedFromFirebase && (
                        <span className="inline-block mt-1 px-2 py-0.5 bg-orange-100 text-orange-700 text-xs rounded">
                          ☁️ Thezone Cloud
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => togglePromotion(promo.id, !promo.active)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                        promo.active 
                          ? 'bg-green-100 text-green-700' 
                          : 'bg-gray-200 text-gray-600'
                      }`}
                    >
                      {promo.active ? '✓ Active' : 'Inactive'}
                    </button>
                    <button
                      onClick={() => openEditModal(promo)}
                      className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deletePromotion(promo.id)}
                      className="px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-sm font-medium"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* Create New Promotion */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Create New Promotion</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[
              { type: 'percent_cart' as const, icon: '💰', title: '% Discount on Cart', desc: 'Percentage off total order value' },
              { type: 'percent_items' as const, icon: '🏷️', title: '% Discount on Items', desc: 'Percentage off selected items' },
              { type: 'free_delivery' as const, icon: '🚚', title: 'Free Delivery', desc: 'Free delivery for qualifying orders' },
              { type: 'bogo' as const, icon: '🎁', title: 'Buy One, Get One Free', desc: 'BOGO deals on selected items' },
              { type: 'fixed_discount' as const, icon: '💵', title: 'Fixed Discount', desc: 'Fixed dollar amount off cart' },
              { type: 'free_item' as const, icon: '🆓', title: 'Free Item', desc: 'Free item with qualifying purchase' },
            ].map(item => (
              <button
                key={item.type}
                onClick={() => openCreateModal(item.type)}
                className="p-4 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-all text-left"
              >
                <div className="text-3xl mb-2">{item.icon}</div>
                <div className="font-semibold text-gray-900">{item.title}</div>
                <div className="text-sm text-gray-500">{item.desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
      
      {/* Create/Edit Modal - Optimized for no-scroll view */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-2">
          <div className={`bg-white rounded-xl shadow-2xl ${
            ['percent_items', 'bogo', 'free_item'].includes(modalType) ? 'max-w-5xl' : 'max-w-2xl'
          } w-full`}>
            {/* Modal Header */}
            <div className="px-4 py-2 border-b flex items-center justify-between bg-gray-50 rounded-t-xl">
              <h3 className="text-base font-semibold text-gray-800">
                {editingPromotion ? 'Edit' : 'Create'} Promotion ({getTypeLabel(modalType)})
              </h3>
              <button onClick={() => setModalOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            
            {/* Modal Body - Compact Grid Layout */}
            <div className={`p-4 ${
              ['percent_items', 'bogo', 'free_item'].includes(modalType) ? 'grid grid-cols-2 gap-4' : ''
            }`}>
              {/* Left Column - Settings */}
              <div className="space-y-3">
                {/* Row 1: Name & Message */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-0.5">Promotion Name *</label>
                    <input
                      type="text"
                      id="promo-name"
                      defaultValue={editingPromotion?.name || ''}
                      placeholder="e.g., 10% Off Cart"
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-0.5">Message</label>
                    <input
                      type="text"
                      id="promo-message"
                      defaultValue={editingPromotion?.message || ''}
                      placeholder="e.g., 🎉 Special offer!"
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
                
                {/* Row 2: Description */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-0.5">Description</label>
                  <input
                    type="text"
                    id="promo-desc"
                    defaultValue={editingPromotion?.description || ''}
                    placeholder="Promotion description..."
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                
                {/* Row 3: Discount & Min Order */}
                <div className="grid grid-cols-2 gap-3">
                  {['percent_cart', 'percent_items', 'fixed_discount'].includes(modalType) && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-0.5">
                        {modalType === 'fixed_discount' ? 'Discount ($)' : 'Discount (%)'}
                      </label>
                      <input
                        type="number"
                        id="promo-discount"
                        defaultValue={editingPromotion?.discountPercent || editingPromotion?.discountAmount || ''}
                        placeholder={modalType === 'fixed_discount' ? '5.00' : '10'}
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  )}
                  <div className={['percent_cart', 'percent_items', 'fixed_discount'].includes(modalType) ? '' : 'col-span-2'}>
                    <label className="block text-xs font-medium text-gray-600 mb-0.5">Min. Order ($)</label>
                    <input
                      type="number"
                      id="promo-min-order"
                      defaultValue={editingPromotion?.minOrderAmount || ''}
                      placeholder="0.00"
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
                
                {/* Row 4: Valid Period */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-0.5">Valid Period</label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="date"
                      id="promo-valid-from"
                      defaultValue={editingPromotion?.validFrom || ''}
                      className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                    />
                    <span className="text-gray-400 text-sm">~</span>
                    <input
                      type="date"
                      id="promo-valid-until"
                      defaultValue={editingPromotion?.validUntil || ''}
                      className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-0.5">Leave empty for no date restrictions</p>
                </div>
                
                {/* Row 5: Apply to Channels */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Apply to Channels</label>
                  <div className="flex flex-wrap gap-2">
                    {ALL_CHANNELS.map(channel => {
                      const isChecked = selectedChannels.includes(channel.id);
                      return (
                        <label
                          key={channel.id}
                          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border cursor-pointer text-xs transition-colors ${
                            isChecked 
                              ? 'bg-blue-100 border-blue-400 text-blue-700' 
                              : 'bg-gray-50 border-gray-300 text-gray-600 hover:bg-gray-100'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedChannels(prev => [...prev, channel.id]);
                              } else {
                                setSelectedChannels(prev => prev.filter(c => c !== channel.id));
                              }
                            }}
                            className="w-3 h-3"
                          />
                          {channel.label}
                        </label>
                      );
                    })}
                  </div>
                  <div className="flex gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => setSelectedChannels(ALL_CHANNELS.map(c => c.id))}
                      className="text-[10px] text-blue-600 hover:underline"
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedChannels([])}
                      className="text-[10px] text-gray-500 hover:underline"
                    >
                      Clear All
                    </button>
                  </div>
                </div>
              </div>
              
              {/* Right Column - Item Selection (for percent_items, bogo, free_item) */}
              {['percent_items', 'bogo', 'free_item'].includes(modalType) && (
                <div className="border-l pl-4">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Select Items</label>
                  
                  {/* Selected Items */}
                  {selectedItems.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1 max-h-16 overflow-auto">
                      {selectedItems.map(item => (
                        <span 
                          key={item.id}
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-xs"
                        >
                          {item.name}
                          <button 
                            onClick={() => setSelectedItems(prev => prev.filter(i => i.id !== item.id))}
                            className="hover:text-red-600 ml-0.5"
                          >×</button>
                        </span>
                      ))}
                    </div>
                  )}
                  
                  {/* Category Selection */}
                  <div className="mb-2">
                    <select
                      value={selectedCategory || ''}
                      onChange={(e) => setSelectedCategory(e.target.value || null)}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
                    >
                      <option value="">Select a category</option>
                      {categories.map(cat => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                      ))}
                    </select>
                  </div>
                  
                  {/* Items in Category */}
                  {selectedCategory && (
                    <div className="max-h-40 overflow-auto border rounded text-sm">
                      {filteredItems.length === 0 ? (
                        <div className="p-2 text-gray-500 text-center text-xs">No items in this category</div>
                      ) : (
                        filteredItems.map(item => {
                          const isSelected = selectedItems.some(i => i.id === item.id);
                          return (
                            <label
                              key={item.id}
                              className={`flex items-center gap-2 px-2 py-1.5 border-b last:border-b-0 cursor-pointer hover:bg-gray-50 ${
                                isSelected ? 'bg-blue-50' : ''
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedItems(prev => [...prev, { id: item.id, name: item.name }]);
                                  } else {
                                    setSelectedItems(prev => prev.filter(i => i.id !== item.id));
                                  }
                                }}
                                className="w-3.5 h-3.5"
                              />
                              <span className="flex-1 truncate">{item.name}</span>
                              <span className="text-gray-400 text-xs">${item.price.toFixed(2)}</span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            
            {/* Modal Footer - Compact */}
            <div className="px-4 py-2 border-t bg-gray-50 rounded-b-xl flex justify-end gap-2">
              <button
                onClick={() => setModalOpen(false)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving}
                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
              >
                {saving ? 'Saving...' : editingPromotion ? 'Update' : 'Create'} Promotion
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PosPromotionsPage;
