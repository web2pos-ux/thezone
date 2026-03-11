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
      <div className="bg-white rounded-lg p-6 w-[798px] max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">Sold Out Options</h3>
            {selectedExtendItemId && (
              <div className="text-sm text-blue-600 font-medium mt-1">
                Select time to add to: {menuItems.find(i => i.id === selectedExtendItemId)?.name}
              </div>
            )}
          </div>
          <button 
            onClick={() => { onClose(); setSelectedExtendItemId(null); }} 
            className="w-12 h-12 border-2 border-red-500 bg-gray-400/30 hover:bg-gray-400/50 rounded-full flex items-center justify-center touch-manipulation transition-colors backdrop-blur-sm"
          >
            <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                className={`w-full p-4 text-left border rounded-lg transition-colors ${selectedExtendItemId ? 'border-blue-400 bg-blue-50 hover:bg-blue-100' : 'border-gray-300 hover:bg-gray-50'}`}
              >
                <div className="font-medium text-gray-800">{selectedExtendItemId ? '+ Add 30 minutes' : 'Pause for 30 minutes'}</div>
                <div className="text-sm text-gray-600">{selectedExtendItemId ? 'Adds 30 minutes to current time' : 'Resumes automatically after 30 minutes'}</div>
              </button>
              <button
                onClick={() => selectedExtendItemId ? handleAddTimeToSoldOut('1hour') : handleSoldOutOption('1hour')}
                className={`w-full p-4 text-left border rounded-lg transition-colors ${selectedExtendItemId ? 'border-blue-400 bg-blue-50 hover:bg-blue-100' : 'border-gray-300 hover:bg-gray-50'}`}
              >
                <div className="font-medium text-gray-800">{selectedExtendItemId ? '+ Add 1 hour' : 'Pause for 1 hour'}</div>
                <div className="text-sm text-gray-600">{selectedExtendItemId ? 'Adds 1 hour to current time' : 'Resumes automatically after 1 hour'}</div>
              </button>
              <button
                onClick={() => selectedExtendItemId ? handleAddTimeToSoldOut('today') : handleSoldOutOption('today')}
                className={`w-full p-4 text-left border rounded-lg transition-colors ${selectedExtendItemId ? 'border-blue-400 bg-blue-50 hover:bg-blue-100' : 'border-gray-300 hover:bg-gray-50'}`}
              >
                <div className="font-medium text-gray-800">{selectedExtendItemId ? '+ Add 1 day' : 'Pause for today'}</div>
                <div className="text-sm text-gray-600">{selectedExtendItemId ? 'Adds 24 hours to current time' : 'Available after midnight'}</div>
              </button>
              <button
                onClick={() => selectedExtendItemId ? handleAddTimeToSoldOut('indefinite') : handleSoldOutOption('indefinite')}
                className={`w-full p-4 text-left border rounded-lg transition-colors ${selectedExtendItemId ? 'border-blue-400 bg-blue-50 hover:bg-blue-100' : 'border-gray-300 hover:bg-gray-50'}`}
              >
                <div className="font-medium text-gray-800">Sold Out until cleared</div>
                <div className="text-sm text-gray-600">Remains sold out until manually cleared</div>
              </button>
            </div>

            {/* Right column: list with per-item actions */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="font-medium text-gray-800">Current Sold Out Items</div>
                <button
                  type="button"
                  onClick={handleClearAll}
                  disabled={loading || soldOutItems.size === 0}
                  className="h-8 px-3 rounded-lg bg-red-600 hover:bg-red-700 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-semibold shadow"
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
                      <div key={itemId} className={`flex items-center justify-between border rounded p-2 transition-all ${isSelected ? 'bg-blue-100 border-blue-400' : 'bg-gray-50'}`}>
                        <div>
                          <div className="text-sm font-medium text-gray-800">{item.name}</div>
                          <div className={`text-xs font-semibold ${info?.endTime === 0 ? 'text-orange-600' : 'text-blue-600'}`}>{timeLabel}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => handleExtendSoldOut(itemId)} 
                            className={`min-w-[80px] h-9 px-3 rounded-lg text-sm font-semibold shadow transition-all ${isSelected ? 'bg-blue-800 text-white' : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white'}`}
                          >
                            {isSelected ? 'Selected' : 'Extend'}
                          </button>
                          <button 
                            onClick={() => { handleClearSoldOutItem(itemId); setSelectedExtendItemId(null); }} 
                            className="min-w-[80px] h-9 px-3 rounded-lg bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-sm font-semibold shadow"
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
              <button onClick={() => { onClose(); setSelectedExtendItemId(null); }} className="min-w-[100px] px-6 py-2.5 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold">Cancel</button>
              <button onClick={() => { handleConfirm(); setSelectedExtendItemId(null); }} className="min-w-[100px] px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold">OK</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SoldOutModal;
