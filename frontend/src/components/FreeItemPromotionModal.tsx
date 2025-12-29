import React from 'react';
import { FreeItemPromotion } from '../types/promotion';

interface Category { category_id: string | number; id?: string | number; name: string; title?: string }
interface MenuItem { id: string | number; name: string; category?: string; category_id?: string|number; categoryId?: string|number }

interface FreeItemPromotionModalProps {
  open: boolean;
  onClose: () => void;
  promotion?: FreeItemPromotion | null;
  onSave: (p: FreeItemPromotion) => void;
  categories: Category[];
  menuItems: MenuItem[];
  newMode?: boolean;
}

const emptyFreeItem = (id: string): FreeItemPromotion => ({
  id,
  createdAt: Date.now(),
  name: '',
  code: '',
  startDate: '',
  endDate: '',
  startTime: '',
  endTime: '',
  daysOfWeek: [],
  dateAlways: false,
  timeAlways: false,
  enabled: true,
  freeItemId: undefined,
  freeQty: 1,
  minSubtotal: 0,
  eligibleItemIds: [],
});

function capitalizeFirstEnglish(s: string): string {
  const idx = s.search(/[A-Za-z]/);
  if (idx === -1) return s;
  return s.slice(0, idx) + s[idx].toUpperCase() + s.slice(idx + 1);
}

export default function FreeItemPromotionModal({ open, onClose, promotion, onSave, categories, menuItems, newMode = false }: FreeItemPromotionModalProps) {
  const [local, setLocal] = React.useState<FreeItemPromotion>(promotion || emptyFreeItem(`free-${Date.now()}`));
  const nameRef = React.useRef<HTMLInputElement | null>(null);
  React.useEffect(()=>{ if (open) { setLocal(promotion || emptyFreeItem(`free-${Date.now()}`)); setTimeout(()=> nameRef.current?.focus(), 0); } }, [open, promotion]);

  const setField = (patch: Partial<FreeItemPromotion>) => setLocal(prev => ({ ...prev, ...patch }));

  const toggleEligible = (id: string|number) => {
    setLocal(prev => {
      const key = String(id);
      const set = new Set((prev.eligibleItemIds||[]).map(String));
      if (set.has(key)) set.delete(key); else set.add(key);
      return { ...prev, eligibleItemIds: Array.from(set) } as any;
    });
  };

  const handleSave = () => {
    if (!local.name.trim() || !local.freeQty || !local.freeItemId || (local.eligibleItemIds||[]).length === 0) {
      alert('필수 항목을 입력해주세요. (Name, Free Item, Free Qty, Eligible Items)');
      return;
    }
    onSave({ ...local, name: capitalizeFirstEnglish(local.name.trim()) });
  };

  if (!open) return null;
  const stop = (e:any)=> e.stopPropagation();

  return (
    <div className="fixed inset-0 bg-black/40 z-[200] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-[43.2rem] max-h-[85vh] overflow-hidden" onClick={stop}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">Free Item Promotion</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl font-bold">×</button>
        </div>

        <div className="p-6 overflow-auto">
          <div className="grid grid-cols-1 md:grid-cols-[0.9fr_1.1fr] gap-6">
            {/* Left: settings */}
            <div className="space-y-[1.512rem]">
              <div className="flex items-center gap-3">
                <input ref={nameRef} value={local.name} onChange={e=> setField({ name: e.target.value })} onBlur={()=> setField({ name: local.name })} placeholder="Promotion Name" className="flex-1 h-11 bg-white text-gray-900 border border-gray-300 rounded-md px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={local.enabled!==false} onChange={e=> setField({ enabled: e.target.checked })} />
                  <span>Enabled</span>
                </label>
              </div>

              <div className="flex items-center gap-3">
                <input value={local.code} onChange={e=> setField({ code: e.target.value })} onBlur={()=> setField({ code: (local.code||'').trim() })} placeholder="Promotion Code (optional)" className="w-[6.5rem] h-11 bg-white text-gray-900 border border-gray-300 rounded-md px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <select value={String(local.freeItemId||'')} onChange={e=> setField({ freeItemId: e.target.value })} className="flex-1 h-11 bg-white text-gray-900 border border-gray-300 rounded-md px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Select Free Item</option>
                  {menuItems.map(mi => (
                    <option key={`mi-${mi.id}`} value={String(mi.id)}>{mi.name}</option>
                  ))}
                </select>
                <input type="number" min={1} value={local.freeQty} onChange={e=> setField({ freeQty: Math.max(1, parseInt(e.target.value||'1',10) || 1) })} className="w-[4.6rem] h-11 bg-white text-gray-900 border border-gray-300 rounded-md px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Qty" />
              </div>

              <div className="flex items-center gap-3">
                <input type="number" min={0} value={local.minSubtotal || ''} onChange={e=> setField({ minSubtotal: e.target.value===''?0:Number(e.target.value) })} placeholder="Min Order" className="w-[4.92rem] h-11 bg-white text-gray-900 border border-gray-300 rounded-md px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              <div className="flex items-center gap-3">
                <input type="date" value={local.startDate} onChange={e=> setField({ startDate: e.target.value })} className="h-11 bg-white text-gray-900 border border-gray-300 rounded-md px-3 py-2 text-base" />
                <span className="text-gray-600">~</span>
                <input type="date" value={local.endDate} onChange={e=> setField({ endDate: e.target.value })} className="h-11 bg-white text-gray-900 border border-gray-300 rounded-md px-3 py-2 text-base" />
              </div>
              <div className="flex items-center gap-3">
                <input type="time" value={local.startTime} onChange={e=> setField({ startTime: e.target.value })} className="w-20 h-11 text-center font-mono bg-gray-50 text-gray-900 border border-gray-300 rounded-md px-3 py-2 text-base" />
                <span className="text-gray-600">~</span>
                <input type="time" value={local.endTime} onChange={e=> setField({ endTime: e.target.value })} className="w-20 h-11 text-center font-mono bg-gray-50 text-gray-900 border border-gray-300 rounded-md px-3 py-2 text-base" />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d, idx) => {
                  const on = (local.daysOfWeek||[]).includes(idx);
                  return (
                    <button key={`dow-${idx}`} type="button" onClick={()=> setField({ daysOfWeek: on ? (local.daysOfWeek||[]).filter(n=>n!==idx) : [ ...(local.daysOfWeek||[]), idx ] })} className={`px-3 py-1.5 rounded border text-sm ${on ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-800 hover:bg-gray-50'}`}>{d}</button>
                  );
                })}
              </div>

              <div className="flex items-center gap-6">
                <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={!!local.dateAlways} onChange={e=> setField({ dateAlways: e.target.checked })} />
                  <span>Any Date</span>
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={!!local.timeAlways} onChange={e=> setField({ timeAlways: e.target.checked })} />
                  <span>Any Time</span>
                </label>
              </div>
            </div>

            {/* Right: Eligible Items */}
            <div className="w-full">
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-gray-50 border-b text-sm font-semibold text-gray-800">Eligible Items</div>
                <div className="max-h-[48vh] overflow-auto divide-y divide-gray-100">
                  {categories.map(cat => {
                    const catId = String(cat.category_id || cat.id);
                    const items = menuItems.filter(mi => String(mi.category_id || mi.categoryId || mi.category) === catId);
                    return (
                      <div key={`cat-${catId}`} className="">
                        <div className="px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white sticky top-0 z-10">{cat.name || (cat as any).title || ''}</div>
                        {items.map(mi => {
                          const checked = new Set((local.eligibleItemIds||[]).map(String)).has(String(mi.id));
                          return (
                            <label key={`mi-${mi.id}`} className="flex items-center justify-between px-3 py-1.5 text-sm">
                              <span className="text-gray-800 truncate mr-3">{mi.name}</span>
                              <input type="checkbox" checked={checked} onChange={()=> toggleEligible(String(mi.id))} />
                            </label>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded bg-gray-600 text-white hover:bg-gray-700">Cancel</button>
          <button onClick={handleSave} className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700">Save</button>
        </div>
      </div>
    </div>
  );
} 