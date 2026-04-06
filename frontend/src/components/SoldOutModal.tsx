import React, { useState, useEffect, useCallback, useRef } from 'react';

interface SoldOutModalProps {
  isOpen: boolean;
  onClose: () => void;
  menuId?: number | string;
  apiUrl: string;
  menuItems: { id: string; name: string }[];
  onSoldOutChange?: (soldOutIds: Set<string>, soldOutMap: Map<string, any>) => void;
  onEnterSoldOutMode?: (durationType?: string) => void;
  currentUser?: string;
}

const SoldOutModal: React.FC<SoldOutModalProps> = ({
  isOpen,
  onClose,
  menuId,
  apiUrl,
  menuItems,
  onSoldOutChange,
  onEnterSoldOutMode,
  currentUser = 'Staff'
}) => {
  const [soldOutItems, setSoldOutItems] = useState<Set<string>>(new Set());
  const [soldOutTimes, setSoldOutTimes] = useState<Map<string, { type: string; endTime: number; selector: string }>>(new Map());
  const [selectedExtendItemId, setSelectedExtendItemId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Avoid infinite reload loops caused by parent passing a new callback identity on each render.
  const onSoldOutChangeRef = useRef<SoldOutModalProps['onSoldOutChange']>(onSoldOutChange);
  useEffect(() => {
    onSoldOutChangeRef.current = onSoldOutChange;
  }, [onSoldOutChange]);

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
      
      records.forEach((r: any) => {
        if (String(r.scope) === 'item') {
          const itemId = String(r.key_id);
          itemSet.add(itemId);
          timesMap.set(itemId, {
            // Backend returns `soldout_type`; keep `type` as backward-compatible fallback.
            type: r.soldout_type || r.type || 'indefinite',
            endTime: Number(r.end_time || 0),
            selector: r.selector || currentUser
          });
        }
      });
      
      setSoldOutItems(itemSet);
      setSoldOutTimes(timesMap);
      onSoldOutChangeRef.current?.(itemSet, timesMap);
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

  const handleExtendSoldOut = (itemId: string) => {
    setSelectedExtendItemId(prev => prev === itemId ? null : itemId);
  };

  const handleAddTimeToSoldOut = async (optionType: string) => {
    if (!selectedExtendItemId || !menuId) return;
    
    const now = Date.now();
    const info = soldOutTimes.get(selectedExtendItemId);
    const newTimes = new Map(soldOutTimes);
    
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
    
    newTimes.set(selectedExtendItemId, {
      type: newType,
      endTime: newEndTime,
      selector: currentUser
    });
    
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
    
    setSelectedExtendItemId(null);
    onSoldOutChange?.(soldOutItems, newTimes);
  };

  const handleClearSoldOutItem = async (itemId: string) => {
    if (!menuId) return;
    
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
      setSelectedExtendItemId(null);
      onSoldOutChangeRef.current?.(new Set(), new Map());
      return;
    }

    setLoading(true);
    try {
      const mid = String(menuId);

      // Use both local + server ids to be robust.
      const allIds = new Set<string>(Array.from(soldOutItems).map(String));
      try {
        const res = await fetch(`${apiUrl}/sold-out/${encodeURIComponent(mid)}`);
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          const serverItemIds: string[] = Array.isArray(data?.records)
            ? data.records
                .filter((r: any) => String(r.scope) === 'item')
                .map((r: any) => String(r.key_id))
            : [];
          serverItemIds.forEach((id) => allIds.add(String(id)));
        }
      } catch {}

      await Promise.all(
        Array.from(allIds).map((itemId) =>
          fetch(
            `${apiUrl}/sold-out/${encodeURIComponent(mid)}/item/${encodeURIComponent(String(itemId))}`,
            { method: 'DELETE' }
          ).catch(() => null)
        )
      );

      const emptyItems = new Set<string>();
      const emptyTimes = new Map<string, { type: string; endTime: number; selector: string }>();
      setSoldOutItems(emptyItems);
      setSoldOutTimes(emptyTimes);
      setSelectedExtendItemId(null);
      onSoldOutChangeRef.current?.(emptyItems, emptyTimes);
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
      soldOutItems.forEach((itemId) => {
        const info = soldOutTimes.get(itemId) || { type: 'indefinite', endTime: 0, selector: currentUser };
        putOps.push(fetch(`${apiUrl}/sold-out/${encodeURIComponent(String(menuId))}/item/${encodeURIComponent(String(itemId))}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: info.type || 'indefinite', endTime: typeof info.endTime === 'number' ? info.endTime : 0, selector: currentUser })
        }));
      });
      
      try {
        const res = await fetch(`${apiUrl}/sold-out/${encodeURIComponent(String(menuId))}`);
        if (res.ok) {
          const data = await res.json();
          const serverItemIds: string[] = Array.isArray(data?.records) ? data.records.filter((r: any) => String(r.scope) === 'item').map((r: any) => String(r.key_id)) : [];
          serverItemIds.forEach((sid) => {
            if (!soldOutItems.has(String(sid))) {
              putOps.push(fetch(`${apiUrl}/sold-out/${encodeURIComponent(String(menuId))}/item/${encodeURIComponent(String(sid))}`, { method: 'DELETE' }));
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
            onClick={() => { onClose(); setSelectedExtendItemId(null); }} 
            className="w-9 h-9 rounded-full flex items-center justify-center text-red-400 hover:text-red-500 transition-all active:scale-90"
            style={{ background: 'linear-gradient(145deg, #e8edf4, #d8dde4)', boxShadow: '3px 3px 6px #b8bec7, -3px -3px 6px #ffffff' }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                <div className="font-bold text-gray-700">Current Sold Out Items</div>
                <button
                  type="button"
                  onClick={handleClearAll}
                  disabled={loading || soldOutItems.size === 0}
                  className="h-8 px-3 rounded-xl border-0 text-sm font-bold transition-all duration-200 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={loading || soldOutItems.size === 0
                    ? { background: 'linear-gradient(145deg, #eaeff6, #dce1e8)', boxShadow: '3px 3px 6px #b8bec7, -3px -3px 6px #ffffff', color: '#9ca3af' }
                    : { background: 'linear-gradient(145deg, #f0d4d4, #f4dcdc)', boxShadow: '3px 3px 6px #c9b0b0, -3px -3px 6px #ffffff', color: '#dc2626' }}
                >
                  Clear All
                </button>
              </div>
              <div className="space-y-2 max-h-[52vh] overflow-y-auto pr-1">
                {soldOutItems.size === 0 ? (
                  <div className="text-sm text-gray-500">No items are currently sold out.</div>
                ) : (
                  Array.from(soldOutItems).map(itemId => {
                    const item = menuItems.find(i => i.id === itemId);
                    const info = soldOutTimes.get(itemId);
                    if (!item) return null;
                    const isSelected = selectedExtendItemId === itemId;
                    const timeLabel = formatRemainingTime(info?.endTime || 0);
                    return (
                      <div
                        key={itemId}
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
                            onClick={() => handleExtendSoldOut(itemId)} 
                            className="min-w-[80px] h-9 px-3 rounded-xl border-0 text-sm font-bold transition-all duration-200 active:scale-95"
                            style={isSelected
                              ? { background: 'linear-gradient(145deg, #d4dcee, #dfe7f5)', boxShadow: 'inset 3px 3px 6px #a8b0c4, inset -3px -3px 6px #f0f5ff', color: '#2563eb' }
                              : { background: 'linear-gradient(145deg, #dde4f0, #e4e8f4)', boxShadow: '4px 4px 8px #b0b8c9, -4px -4px 8px #ffffff', color: '#3b82f6' }}
                          >
                            {isSelected ? 'Selected' : 'Extend'}
                          </button>
                          <button 
                            onClick={() => { handleClearSoldOutItem(itemId); setSelectedExtendItemId(null); }} 
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
