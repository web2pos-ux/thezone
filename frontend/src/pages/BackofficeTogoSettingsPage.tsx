import React, { useEffect, useState } from 'react';
import { API_URL } from '../config/constants';

interface MenuItem {
  id: string;
  name: string;
}

interface Category {
  id: string;
  name: string;
  items: MenuItem[];
}

const BackofficeTogoSettingsPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string|null>(null);
  const [settings, setSettings] = useState({
    discount_enabled: 0,
    discount_mode: 'percent',
    discount_value: 0,
    bag_fee_enabled: 0,
    bag_fee_mode: 'amount',
    bag_fee_value: 0,
    discount_stage: 'pre-tax',
    bag_fee_taxable: 0,
    discount_scope: 'categories',
    discount_item_ids: '' as any,
    discount_category_ids: '' as any,
  });

  const [categories, setCategories] = useState<Category[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const res = await fetch(`${API_URL}/admin-settings/channel-settings/TOGO`);
        if (res.ok) {
          const json = await res.json();
          if (json && json.settings) setSettings(json.settings);
        }
        // Load categories with items
        try {
          const menusRes = await fetch(`${API_URL}/menus`);
          if (menusRes.ok) {
            const menus = await menusRes.json();
            const first = Array.isArray(menus) && menus.length>0 ? menus[0] : null;
            if (first) {
              const str = await fetch(`${API_URL}/menus/${first.menu_id || first.id}/structure`);
              if (str.ok) {
                const data = await str.json();
                const cats: any[] = Array.isArray(data) ? data : [];
                setCategories(cats.map(c => ({
                  id: String(c.category_id),
                  name: c.name,
                  items: (c.items || []).map((it: any) => ({
                    id: String(it.item_id || it.id),
                    name: it.name
                  }))
                })));
              }
            }
          }
        } catch {}
      } catch (e:any) {
        setErr(e?.message||'Failed to load');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const save = async () => {
    try {
      setSaving(true);
      setErr(null);
      const res = await fetch(`${API_URL}/admin-settings/channel-settings/TOGO`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Role': 'Manager' },
        body: JSON.stringify({ settings })
      });
      if (!res.ok) throw new Error('Save failed');
      alert('Saved');
    } catch (e:any) {
      setErr(e?.message||'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setSettings({
      discount_enabled: 0,
      discount_mode: 'percent',
      discount_value: 0,
      bag_fee_enabled: 0,
      bag_fee_mode: 'amount',
      bag_fee_value: 0,
      discount_stage: 'pre-tax',
      bag_fee_taxable: 0,
      discount_scope: 'categories',
      discount_item_ids: '',
      discount_category_ids: '',
    });
    setExpandedCategories(new Set());
  };

  const isCategorySelected = (catId: string) => {
    return String(settings.discount_category_ids||'').split(',').filter(Boolean).includes(catId);
  };

  const isItemSelected = (itemId: string) => {
    return String(settings.discount_item_ids||'').split(',').filter(Boolean).includes(itemId);
  };

  const toggleCategory = (catId: string) => {
    const set = new Set(String(settings.discount_category_ids||'').split(',').filter(Boolean));
    if (set.has(catId)) {
      set.delete(catId);
    } else {
      set.add(catId);
    }
    setSettings(s => ({ ...s, discount_category_ids: Array.from(set).join(',') }));
  };

  const toggleItem = (itemId: string) => {
    const set = new Set(String(settings.discount_item_ids||'').split(',').filter(Boolean));
    if (set.has(itemId)) {
      set.delete(itemId);
    } else {
      set.add(itemId);
    }
    setSettings(s => ({ ...s, discount_item_ids: Array.from(set).join(',') }));
  };

  const toggleExpand = (catId: string) => {
    const newSet = new Set(expandedCategories);
    if (newSet.has(catId)) {
      newSet.delete(catId);
    } else {
      newSet.add(catId);
    }
    setExpandedCategories(newSet);
  };

  const getCategoryStatus = (cat: Category): 'none' | 'some' | 'all' => {
    if (isCategorySelected(cat.id)) return 'all';
    const selectedItems = cat.items.filter(item => isItemSelected(item.id));
    if (selectedItems.length === 0) return 'none';
    if (selectedItems.length === cat.items.length) return 'all';
    return 'some';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-900">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 p-6">
      <div className="max-w-sm mx-auto">
        {/* Header */}
        <div className="bg-blue-600 text-white px-4 py-3 rounded-t-lg">
          <h1 className="text-lg font-semibold">Promotion Settings</h1>
        </div>

        {/* Content */}
        <div className="bg-gray-800 rounded-b-lg p-4 space-y-4">
          {err && (
            <div className="p-2 bg-red-500/20 border border-red-500 text-red-400 rounded text-sm">
              {err}
            </div>
          )}

          {/* Auto Discount Toggle */}
          <div className="flex items-center justify-between">
            <span className="text-white font-medium">Auto Discount</span>
            <button
              onClick={() => setSettings(s => ({ ...s, discount_enabled: s.discount_enabled ? 0 : 1 }))}
              className={`relative w-14 h-7 rounded-full transition-colors ${
                settings.discount_enabled ? 'bg-yellow-500' : 'bg-gray-600'
              }`}
            >
              <span
                className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${
                  settings.discount_enabled ? 'left-7' : 'left-0.5'
                }`}
              />
            </button>
          </div>

          {/* Discount Mode & Value */}
          <div className="flex gap-2">
            <select
              value={settings.discount_mode}
              onChange={(e) => setSettings(s => ({ ...s, discount_mode: e.target.value }))}
              className="flex-1 bg-gray-700 text-white border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            >
              <option value="percent">Percent %</option>
              <option value="amount">Amount $</option>
            </select>
            <input
              type="number"
              min="0"
              step="0.01"
              value={settings.discount_value}
              onChange={(e) => setSettings(s => ({ ...s, discount_value: parseFloat(e.target.value || '0') }))}
              className="w-20 bg-gray-700 text-white border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Eligible Items Label */}
          <div className="text-gray-400 text-sm mt-4">Eligible Items</div>

          {/* Category List with Items */}
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {categories.map((cat) => {
              const status = getCategoryStatus(cat);
              const isExpanded = expandedCategories.has(cat.id);
              const hasItems = cat.items.length > 0;

              return (
                <div key={cat.id}>
                  {/* Category Row */}
                  <div className="flex items-center bg-gray-700 rounded">
                    {/* Expand Button */}
                    {hasItems && (
                      <button
                        onClick={() => toggleExpand(cat.id)}
                        className="px-2 py-2 text-gray-400 hover:text-white"
                      >
                        <svg 
                          className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} 
                          fill="currentColor" 
                          viewBox="0 0 20 20"
                        >
                          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                        </svg>
                      </button>
                    )}
                    
                    {/* Category Checkbox & Name */}
                    <button
                      onClick={() => toggleCategory(cat.id)}
                      className={`flex-1 flex items-center gap-3 px-3 py-2 transition-colors ${
                        status !== 'none' ? 'text-white' : 'text-gray-300'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                        status === 'all' ? 'bg-blue-500 border-blue-500' : 
                        status === 'some' ? 'bg-blue-500/50 border-blue-500' : 'border-gray-500'
                      }`}>
                        {status === 'all' && (
                          <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                        {status === 'some' && (
                          <div className="w-2 h-2 bg-white rounded-sm" />
                        )}
                      </div>
                      <span className="text-sm font-medium">{cat.name}</span>
                    </button>
                  </div>

                  {/* Items (expanded) */}
                  {isExpanded && hasItems && (
                    <div className="ml-6 mt-1 space-y-1">
                      {cat.items.map((item) => {
                        const itemSelected = isItemSelected(item.id) || isCategorySelected(cat.id);
                        return (
                          <button
                            key={item.id}
                            onClick={() => toggleItem(item.id)}
                            disabled={isCategorySelected(cat.id)}
                            className={`w-full flex items-center gap-3 px-3 py-1.5 rounded transition-colors ${
                              itemSelected 
                                ? 'bg-gray-600 text-white' 
                                : 'bg-gray-750 text-gray-400 hover:bg-gray-700 hover:text-gray-300'
                            } ${isCategorySelected(cat.id) ? 'opacity-60 cursor-not-allowed' : ''}`}
                          >
                            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${
                              itemSelected ? 'bg-blue-500 border-blue-500' : 'border-gray-500'
                            }`}>
                              {itemSelected && (
                                <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              )}
                            </div>
                            <span className="text-xs">{item.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-4 border-t border-gray-700">
            <button
              onClick={reset}
              className="flex-1 px-4 py-2.5 bg-gray-700 text-white rounded font-medium hover:bg-gray-600 transition-colors"
            >
              Reset
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="flex-[2] px-4 py-2.5 bg-blue-600 text-white rounded font-medium hover:bg-blue-700 transition-colors disabled:bg-gray-500"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BackofficeTogoSettingsPage;
