import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MODAL_CLOSE_X_RAISED_STYLE, NEO_PRESS_INSET_ONLY_NO_SHIFT } from '../utils/softNeumorphic';

interface SoldOutModalProps {
  isOpen: boolean;
  onClose: () => void;
  menuId?: number | string;
  apiUrl: string;
  menuItems: { id: string; name: string }[];
  /** Optional: list of all modifiers (id, label) so modifier sold-outs can be shown by name. */
  modifierItems?: { id: string; name: string }[];
  onSoldOutChange?: (soldOutIds: Set<string>, soldOutMap: Map<string, any>) => void;
  /**
   * Optional: receives current sold-out modifier ids + their per-id duration map.
   * Called whenever the modal loads modifier sold-out records or the user
   * extends / clears them in this modal.
   */
  onModifierSoldOutChange?: (
    soldOutModifierIds: Set<string>,
    soldOutModifierTimes: Map<string, { type: string; endTime: number; selector: string }>,
  ) => void;
  onEnterSoldOutMode?: (durationType?: string) => void;
  currentUser?: string;
}

const SoldOutModal: React.FC<SoldOutModalProps> = ({
  isOpen,
  onClose,
  menuId,
  apiUrl,
  menuItems,
  modifierItems,
  onSoldOutChange,
  onModifierSoldOutChange,
  onEnterSoldOutMode,
  currentUser = 'Staff'
}) => {
  const [soldOutItems, setSoldOutItems] = useState<Set<string>>(new Set());
  const [soldOutTimes, setSoldOutTimes] = useState<Map<string, { type: string; endTime: number; selector: string }>>(new Map());
  const [soldOutModifiers, setSoldOutModifiers] = useState<Set<string>>(new Set());
  const [soldOutModifierTimes, setSoldOutModifierTimes] = useState<Map<string, { type: string; endTime: number; selector: string }>>(new Map());
  const [selectedExtendItemId, setSelectedExtendItemId] = useState<string | null>(null);
  // When extending an entry, we also need to know whether it is an item or a modifier
  // so the API call routes to the correct endpoint.
  const [selectedExtendScope, setSelectedExtendScope] = useState<'item' | 'modifier'>('item');
  const [loading, setLoading] = useState(false);

  // Avoid infinite reload loops caused by parent passing a new callback identity on each render.
  const onSoldOutChangeRef = useRef<SoldOutModalProps['onSoldOutChange']>(onSoldOutChange);
  const onModifierSoldOutChangeRef = useRef<SoldOutModalProps['onModifierSoldOutChange']>(onModifierSoldOutChange);
  useEffect(() => {
    onSoldOutChangeRef.current = onSoldOutChange;
  }, [onSoldOutChange]);
  useEffect(() => {
    onModifierSoldOutChangeRef.current = onModifierSoldOutChange;
  }, [onModifierSoldOutChange]);

  const loadSoldOutFromServer = useCallback(async () => {
    if (!menuId) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/sold-out/${encodeURIComponent(String(menuId))}`);
      if (!res.ok) return;
      const data = await res.json();
      const records = Array.isArray(data?.records) ? data.records : [];
      const itemSet = new Set<string>();
      const timesMap = new Map<string, { type: string; endTime: number; selector: string }>();
      const modSet = new Set<string>();
      const modTimesMap = new Map<string, { type: string; endTime: number; selector: string }>();
      
      records.forEach((r: any) => {
        const scope = String(r.scope);
        const id = String(r.key_id);
        const info = {
          // Backend returns `soldout_type`; keep `type` as backward-compatible fallback.
          type: r.soldout_type || r.type || 'indefinite',
          endTime: Number(r.end_time || 0),
          selector: r.selector || currentUser,
        };
        if (scope === 'item') {
          itemSet.add(id);
          timesMap.set(id, info);
        } else if (scope === 'modifier') {
          modSet.add(id);
          modTimesMap.set(id, info);
        }
      });
      
      setSoldOutItems(itemSet);
      setSoldOutTimes(timesMap);
      setSoldOutModifiers(modSet);
      setSoldOutModifierTimes(modTimesMap);
      onSoldOutChangeRef.current?.(itemSet, timesMap);
      onModifierSoldOutChangeRef.current?.(modSet, modTimesMap);
    } catch (e) {
      console.error('Failed to load sold out items:', e);
    } finally {
      setLoading(false);
    }
  }, [menuId, apiUrl, currentUser]);

  useEffect(() => {
    if (isOpen) {
      loadSoldOutFromServer();
    }
  }, [isOpen, loadSoldOutFromServer]);

  const formatRemainingTime = (endTime: number) => {
    if (endTime === 0) return 'Until cleared';
    const now = Date.now();
    const remaining = endTime - now;
    if (remaining <= 0) return 'Expired';
    
    const days = Math.floor(remaining / (24 * 60 * 60 * 1000));
    const hours = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const mins = Math.ceil((remaining % (60 * 60 * 1000)) / (30 * 60 * 1000)) * 30;
    
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins > 0 ? mins + 'm' : ''}`;
    return `${mins}m`;
  };

  const handleSoldOutOption = (option: string) => {
    onEnterSoldOutMode?.(option);
  };

  const handleExtendSoldOut = (itemId: string, scope: 'item' | 'modifier' = 'item') => {
    setSelectedExtendItemId(prev => (prev === itemId && selectedExtendScope === scope) ? null : itemId);
    setSelectedExtendScope(scope);
  };

  const handleAddTimeToSoldOut = async (optionType: string) => {
    if (!selectedExtendItemId || !menuId) return;
    
    const isModifier = selectedExtendScope === 'modifier';
    const now = Date.now();
    const info = isModifier
      ? soldOutModifierTimes.get(selectedExtendItemId)
      : soldOutTimes.get(selectedExtendItemId);
    
    let addMs = 0;
    let newType = optionType;
    
    switch (optionType) {
      case '30min':
        addMs = 30 * 60 * 1000;
        break;
      case '1hour':
        addMs = 60 * 60 * 1000;
        break;
      case 'today':
        addMs = 24 * 60 * 60 * 1000;
        break;
      case 'indefinite':
      default:
        addMs = 0;
        newType = 'indefinite';
        break;
    }
    
    let newEndTime = 0;
    if (optionType !== 'indefinite') {
      const currentEnd = info?.endTime || 0;
      if (currentEnd > 0 && currentEnd > now) {
        newEndTime = currentEnd + addMs;
      } else {
        newEndTime = now + addMs;
      }
    }
    
    const nextEntry = { type: newType, endTime: newEndTime, selector: currentUser };
    
    if (isModifier) {
      const newTimes = new Map(soldOutModifierTimes);
      newTimes.set(selectedExtendItemId, nextEntry);
      setSoldOutModifierTimes(newTimes);
      try {
        await fetch(`${apiUrl}/sold-out/${encodeURIComponent(String(menuId))}/modifier/${encodeURIComponent(selectedExtendItemId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: newType, endTime: newEndTime, selector: currentUser })
        });
      } catch (e) {
        console.error('Failed to update sold out modifier:', e);
      }
      onModifierSoldOutChange?.(soldOutModifiers, newTimes);
    } else {
      const newTimes = new Map(soldOutTimes);
      newTimes.set(selectedExtendItemId, nextEntry);
      setSoldOutTimes(newTimes);
      try {
        await fetch(`${apiUrl}/sold-out/${encodeURIComponent(String(menuId))}/item/${encodeURIComponent(selectedExtendItemId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: newType, endTime: newEndTime, selector: currentUser })
        });
      } catch (e) {
        console.error('Failed to update sold out item:', e);
      }
      onSoldOutChange?.(soldOutItems, newTimes);
    }
    
    setSelectedExtendItemId(null);
  };

  const handleClearSoldOutItem = async (itemId: string, scope: 'item' | 'modifier' = 'item') => {
    if (!menuId) return;
    
    if (scope === 'modifier') {
      const newSet = new Set(soldOutModifiers);
      newSet.delete(itemId);
      const newTimes = new Map(soldOutModifierTimes);
      newTimes.delete(itemId);
      setSoldOutModifiers(newSet);
      setSoldOutModifierTimes(newTimes);
      try {
        await fetch(`${apiUrl}/sold-out/${encodeURIComponent(String(menuId))}/modifier/${encodeURIComponent(itemId)}`, {
          method: 'DELETE'
        });
      } catch (e) {
        console.error('Failed to clear sold out modifier:', e);
      }
      onModifierSoldOutChange?.(newSet, newTimes);
      return;
    }
    
    const newItems = new Set(soldOutItems);
    newItems.delete(itemId);
    
    const newTimes = new Map(soldOutTimes);
    newTimes.delete(itemId);
    
    setSoldOutItems(newItems);
    setSoldOutTimes(newTimes);
    
    try {
      await fetch(`${apiUrl}/sold-out/${encodeURIComponent(String(menuId))}/item/${encodeURIComponent(itemId)}`, {
        method: 'DELETE'
      });
    } catch (e) {
      console.error('Failed to clear sold out item:', e);
    }
    
    onSoldOutChange?.(newItems, newTimes);
  };

  const handleClearAll = async () => {
    if (!menuId) {
      setSoldOutItems(new Set());
      setSoldOutTimes(new Map());
      setSoldOutModifiers(new Set());
      setSoldOutModifierTimes(new Map());
      setSelectedExtendItemId(null);
      onSoldOutChangeRef.current?.(new Set(), new Map());
      onModifierSoldOutChangeRef.current?.(new Set(), new Map());
      return;
    }

    setLoading(true);
    try {
      const mid = String(menuId);

      // Use both local + server ids to be robust (items + modifiers).
      const allItemIds = new Set<string>(Array.from(soldOutItems).map(String));
      const allModIds = new Set<string>(Array.from(soldOutModifiers).map(String));
      try {
        const res = await fetch(`${apiUrl}/sold-out/${encodeURIComponent(mid)}`);
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          const records = Array.isArray(data?.records) ? data.records : [];
          records.forEach((r: any) => {
            const id = String(r.key_id);
            if (String(r.scope) === 'item') allItemIds.add(id);
            else if (String(r.scope) === 'modifier') allModIds.add(id);
          });
        }
      } catch {}

      await Promise.all([
        ...Array.from(allItemIds).map((id) =>
          fetch(
            `${apiUrl}/sold-out/${encodeURIComponent(mid)}/item/${encodeURIComponent(String(id))}`,
            { method: 'DELETE' }
          ).catch(() => null)
        ),
        ...Array.from(allModIds).map((id) =>
          fetch(
            `${apiUrl}/sold-out/${encodeURIComponent(mid)}/modifier/${encodeURIComponent(String(id))}`,
            { method: 'DELETE' }
          ).catch(() => null)
        ),
      ]);

      const emptyItems = new Set<string>();
      const emptyTimes = new Map<string, { type: string; endTime: number; selector: string }>();
      const emptyMods = new Set<string>();
      const emptyModTimes = new Map<string, { type: string; endTime: number; selector: string }>();
      setSoldOutItems(emptyItems);
      setSoldOutTimes(emptyTimes);
      setSoldOutModifiers(emptyMods);
      setSoldOutModifierTimes(emptyModTimes);
      setSelectedExtendItemId(null);
      onSoldOutChangeRef.current?.(emptyItems, emptyTimes);
      onModifierSoldOutChangeRef.current?.(emptyMods, emptyModTimes);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!menuId) {
      onClose();
      return;
    }
    
    try {
      const putOps: Promise<any>[] = [];
      // Items
      soldOutItems.forEach((itemId) => {
        const info = soldOutTimes.get(itemId) || { type: 'indefinite', endTime: 0, selector: currentUser };
        putOps.push(fetch(`${apiUrl}/sold-out/${encodeURIComponent(String(menuId))}/item/${encodeURIComponent(String(itemId))}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: info.type || 'indefinite', endTime: typeof info.endTime === 'number' ? info.endTime : 0, selector: currentUser })
        }));
      });
      // Modifiers
      soldOutModifiers.forEach((modId) => {
        const info = soldOutModifierTimes.get(modId) || { type: 'indefinite', endTime: 0, selector: currentUser };
        putOps.push(fetch(`${apiUrl}/sold-out/${encodeURIComponent(String(menuId))}/modifier/${encodeURIComponent(String(modId))}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: info.type || 'indefinite', endTime: typeof info.endTime === 'number' ? info.endTime : 0, selector: currentUser })
        }));
      });
      
      try {
        const res = await fetch(`${apiUrl}/sold-out/${encodeURIComponent(String(menuId))}`);
        if (res.ok) {
          const data = await res.json();
          const records = Array.isArray(data?.records) ? data.records : [];
          // Delete server-side items not in our local set
          const serverItemIds: string[] = records.filter((r: any) => String(r.scope) === 'item').map((r: any) => String(r.key_id));
          serverItemIds.forEach((sid) => {
            if (!soldOutItems.has(String(sid))) {
              putOps.push(fetch(`${apiUrl}/sold-out/${encodeURIComponent(String(menuId))}/item/${encodeURIComponent(String(sid))}`, { method: 'DELETE' }));
            }
          });
          const serverModIds: string[] = records.filter((r: any) => String(r.scope) === 'modifier').map((r: any) => String(r.key_id));
          serverModIds.forEach((sid) => {
            if (!soldOutModifiers.has(String(sid))) {
              putOps.push(fetch(`${apiUrl}/sold-out/${encodeURIComponent(String(menuId))}/modifier/${encodeURIComponent(String(sid))}`, { method: 'DELETE' }));
            }
          });
        }
      } catch {}
      
      await Promise.all(putOps);
    } catch (e) {
      console.error('Failed to save sold out items:', e);
    }
    
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="rounded-3xl p-6 w-[798px] max-h-[80vh] overflow-y-auto" style={{ background: 'linear-gradient(145deg, #e6ebf2, #dce1e8)', boxShadow: '12px 12px 24px rgba(0,0,0,0.3)' }}>
        <div className="flex justify-between items-center mb-4">
          <div>
            <h3 className="text-lg font-bold text-gray-700 tracking-wide">Sold Out Options</h3>
            {selectedExtendItemId && (
              <div className="text-sm text-blue-600 font-medium mt-1">
                Select time to add to: {menuItems.find(i => i.id === selectedExtendItemId)?.name}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => { onClose(); setSelectedExtendItemId(null); }}
            className={`flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-full border-[3px] border-red-500 transition-all hover:brightness-[1.03] ${NEO_PRESS_INSET_ONLY_NO_SHIFT}`}
            style={MODAL_CLOSE_X_RAISED_STYLE}
            aria-label="Close"
          >
            <svg className="h-5 w-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-gray-500">Loading...</div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {/* Left column: actions */}
            <div className="space-y-3">
              <button
                onClick={() => selectedExtendItemId ? handleAddTimeToSoldOut('30min') : handleSoldOutOption('30min')}
                className="w-full p-4 text-left rounded-2xl border-0 transition-all duration-200 active:scale-[0.98]"
                style={selectedExtendItemId
                  ? { background: 'linear-gradient(145deg, #d4dcee, #dfe7f5)', boxShadow: 'inset 3px 3px 7px #a8b0c4, inset -3px -3px 7px #f0f5ff' }
                  : { background: 'linear-gradient(145deg, #eaeff6, #dce1e8)', boxShadow: '5px 5px 10px #b8bec7, -5px -5px 10px #ffffff' }}
              >
                <div className={`font-bold ${selectedExtendItemId ? 'text-blue-600' : 'text-gray-700'}`}>{selectedExtendItemId ? '+ Add 30 minutes' : 'Pause for 30 minutes'}</div>
                <div className="text-sm text-gray-500 mt-0.5">{selectedExtendItemId ? 'Adds 30 minutes to current time' : 'Resumes automatically after 30 minutes'}</div>
              </button>
              <button
                onClick={() => selectedExtendItemId ? handleAddTimeToSoldOut('1hour') : handleSoldOutOption('1hour')}
                className="w-full p-4 text-left rounded-2xl border-0 transition-all duration-200 active:scale-[0.98]"
                style={selectedExtendItemId
                  ? { background: 'linear-gradient(145deg, #d4dcee, #dfe7f5)', boxShadow: 'inset 3px 3px 7px #a8b0c4, inset -3px -3px 7px #f0f5ff' }
                  : { background: 'linear-gradient(145deg, #eaeff6, #dce1e8)', boxShadow: '5px 5px 10px #b8bec7, -5px -5px 10px #ffffff' }}
              >
                <div className={`font-bold ${selectedExtendItemId ? 'text-blue-600' : 'text-gray-700'}`}>{selectedExtendItemId ? '+ Add 1 hour' : 'Pause for 1 hour'}</div>
                <div className="text-sm text-gray-500 mt-0.5">{selectedExtendItemId ? 'Adds 1 hour to current time' : 'Resumes automatically after 1 hour'}</div>
              </button>
              <button
                onClick={() => selectedExtendItemId ? handleAddTimeToSoldOut('today') : handleSoldOutOption('today')}
                className="w-full p-4 text-left rounded-2xl border-0 transition-all duration-200 active:scale-[0.98]"
                style={selectedExtendItemId
                  ? { background: 'linear-gradient(145deg, #d4dcee, #dfe7f5)', boxShadow: 'inset 3px 3px 7px #a8b0c4, inset -3px -3px 7px #f0f5ff' }
                  : { background: 'linear-gradient(145deg, #eaeff6, #dce1e8)', boxShadow: '5px 5px 10px #b8bec7, -5px -5px 10px #ffffff' }}
              >
                <div className={`font-bold ${selectedExtendItemId ? 'text-blue-600' : 'text-gray-700'}`}>{selectedExtendItemId ? '+ Add 1 day' : 'Pause for today'}</div>
                <div className="text-sm text-gray-500 mt-0.5">{selectedExtendItemId ? 'Adds 24 hours to current time' : 'Available after midnight'}</div>
              </button>
              <button
                onClick={() => selectedExtendItemId ? handleAddTimeToSoldOut('indefinite') : handleSoldOutOption('indefinite')}
                className="w-full p-4 text-left rounded-2xl border-0 transition-all duration-200 active:scale-[0.98]"
                style={selectedExtendItemId
                  ? { background: 'linear-gradient(145deg, #f0dcd0, #f4e4d8)', boxShadow: 'inset 3px 3px 7px #c9b0a0, inset -3px -3px 7px #fff5f0' }
                  : { background: 'linear-gradient(145deg, #f6eee8, #eee4dc)', boxShadow: '5px 5px 10px #c9beb8, -5px -5px 10px #ffffff' }}
              >
                <div className={`font-bold ${selectedExtendItemId ? 'text-orange-600' : 'text-gray-700'}`}>Sold Out until cleared</div>
                <div className="text-sm text-gray-500 mt-0.5">Remains sold out until manually cleared</div>
              </button>
            </div>

            {/* Right column: list with per-item actions */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="font-bold text-gray-700">Current Sold Out</div>
                <button
                  type="button"
                  onClick={handleClearAll}
                  disabled={loading || (soldOutItems.size === 0 && soldOutModifiers.size === 0)}
                  className="h-8 px-3 rounded-xl border-0 text-sm font-bold transition-all duration-200 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={loading || (soldOutItems.size === 0 && soldOutModifiers.size === 0)
                    ? { background: 'linear-gradient(145deg, #eaeff6, #dce1e8)', boxShadow: '3px 3px 6px #b8bec7, -3px -3px 6px #ffffff', color: '#9ca3af' }
                    : { background: 'linear-gradient(145deg, #f0d4d4, #f4dcdc)', boxShadow: '3px 3px 6px #c9b0b0, -3px -3px 6px #ffffff', color: '#dc2626' }}
                >
                  Clear All
                </button>
              </div>
              <div className="space-y-3 max-h-[52vh] overflow-y-auto pr-1">
                {/* Items section */}
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1 px-1">Items</div>
                  <div className="space-y-2">
                    {soldOutItems.size === 0 ? (
                      <div className="text-xs text-gray-400 px-1">No items are currently sold out.</div>
                    ) : (
                      Array.from(soldOutItems).map(itemId => {
                        const item = menuItems.find(i => i.id === itemId);
                        const info = soldOutTimes.get(itemId);
                        if (!item) return null;
                        const isSelected = selectedExtendItemId === itemId && selectedExtendScope === 'item';
                        const timeLabel = formatRemainingTime(info?.endTime || 0);
                        return (
                          <div
                            key={`item-${itemId}`}
                            className="flex items-center justify-between rounded-xl p-2.5 transition-all duration-200"
                            style={isSelected
                              ? { background: 'linear-gradient(145deg, #d4dcee, #dfe7f5)', boxShadow: 'inset 3px 3px 6px #a8b0c4, inset -3px -3px 6px #f0f5ff' }
                              : { background: 'linear-gradient(145deg, #eaeff6, #dce1e8)', boxShadow: '3px 3px 6px #b8bec7, -3px -3px 6px #ffffff' }}
                          >
                            <div>
                              <div className="text-sm font-bold text-gray-700">{item.name}</div>
                              <div className={`text-xs font-semibold ${info?.endTime === 0 ? 'text-orange-600' : 'text-blue-600'}`}>{timeLabel}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button 
                                onClick={() => handleExtendSoldOut(itemId, 'item')} 
                                className="min-w-[80px] h-9 px-3 rounded-xl border-0 text-sm font-bold transition-all duration-200 active:scale-95"
                                style={isSelected
                                  ? { background: 'linear-gradient(145deg, #d4dcee, #dfe7f5)', boxShadow: 'inset 3px 3px 6px #a8b0c4, inset -3px -3px 6px #f0f5ff', color: '#2563eb' }
                                  : { background: 'linear-gradient(145deg, #dde4f0, #e4e8f4)', boxShadow: '4px 4px 8px #b0b8c9, -4px -4px 8px #ffffff', color: '#3b82f6' }}
                              >
                                {isSelected ? 'Selected' : 'Extend'}
                              </button>
                              <button 
                                onClick={() => { void handleClearSoldOutItem(itemId, 'item'); setSelectedExtendItemId(null); }} 
                                className="min-w-[80px] h-9 px-3 rounded-xl border-0 text-sm font-bold transition-all duration-200 active:scale-95"
                                style={{ background: 'linear-gradient(145deg, #f0d4d4, #f4dcdc)', boxShadow: '4px 4px 8px #c9b0b0, -4px -4px 8px #ffffff', color: '#dc2626' }}
                              >
                                Clear
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Modifiers section */}
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1 px-1">Modifiers</div>
                  <div className="space-y-2">
                    {soldOutModifiers.size === 0 ? (
                      <div className="text-xs text-gray-400 px-1">No modifiers are currently sold out.</div>
                    ) : (
                      Array.from(soldOutModifiers).map(modId => {
                        const mod = (modifierItems || []).find(m => m.id === modId);
                        const info = soldOutModifierTimes.get(modId);
                        const isSelected = selectedExtendItemId === modId && selectedExtendScope === 'modifier';
                        const timeLabel = formatRemainingTime(info?.endTime || 0);
                        const displayName = mod?.name || `Modifier ${modId}`;
                        return (
                          <div
                            key={`mod-${modId}`}
                            className="flex items-center justify-between rounded-xl p-2.5 transition-all duration-200"
                            style={isSelected
                              ? { background: 'linear-gradient(145deg, #f0e0d4, #f5e7df)', boxShadow: 'inset 3px 3px 6px #c4b0a8, inset -3px -3px 6px #fff5f0' }
                              : { background: 'linear-gradient(145deg, #f6eee8, #eee4dc)', boxShadow: '3px 3px 6px #c9beb8, -3px -3px 6px #ffffff' }}
                          >
                            <div>
                              <div className="text-sm font-bold text-gray-700">{displayName}</div>
                              <div className={`text-xs font-semibold ${info?.endTime === 0 ? 'text-orange-600' : 'text-blue-600'}`}>{timeLabel}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button 
                                onClick={() => handleExtendSoldOut(modId, 'modifier')} 
                                className="min-w-[80px] h-9 px-3 rounded-xl border-0 text-sm font-bold transition-all duration-200 active:scale-95"
                                style={isSelected
                                  ? { background: 'linear-gradient(145deg, #f0e0d4, #f5e7df)', boxShadow: 'inset 3px 3px 6px #c4b0a8, inset -3px -3px 6px #fff5f0', color: '#c2410c' }
                                  : { background: 'linear-gradient(145deg, #f0e0d4, #f5e7df)', boxShadow: '4px 4px 8px #c4b0a8, -4px -4px 8px #ffffff', color: '#ea580c' }}
                              >
                                {isSelected ? 'Selected' : 'Extend'}
                              </button>
                              <button 
                                onClick={() => { void handleClearSoldOutItem(modId, 'modifier'); setSelectedExtendItemId(null); }} 
                                className="min-w-[80px] h-9 px-3 rounded-xl border-0 text-sm font-bold transition-all duration-200 active:scale-95"
                                style={{ background: 'linear-gradient(145deg, #f0d4d4, #f4dcdc)', boxShadow: '4px 4px 8px #c9b0b0, -4px -4px 8px #ffffff', color: '#dc2626' }}
                              >
                                Clear
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>
            
            <div className="col-span-2 flex justify-end gap-3 pt-4">
              <button
                onClick={() => { onClose(); setSelectedExtendItemId(null); }}
                className="min-w-[100px] px-6 py-2.5 rounded-2xl border-0 text-gray-500 font-bold transition-all duration-200 active:scale-95 hover:text-gray-600"
                style={{ background: 'linear-gradient(145deg, #eaeff6, #dce1e8)', boxShadow: '6px 6px 12px #b8bec7, -6px -6px 12px #ffffff' }}
              >
                Cancel
              </button>
              <button
                onClick={() => { handleConfirm(); setSelectedExtendItemId(null); }}
                className="min-w-[120px] px-6 py-2.5 rounded-2xl border-0 text-blue-600 font-extrabold transition-all duration-200 active:scale-95 hover:text-blue-700"
                style={{ background: 'linear-gradient(145deg, #dde4f0, #e4e8f4)', boxShadow: '6px 6px 12px #b0b8c9, -6px -6px 12px #ffffff' }}
              >
                OK
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SoldOutModal;
