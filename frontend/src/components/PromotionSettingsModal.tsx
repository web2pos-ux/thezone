import React from 'react';
import { PromotionRule, FreeItemPromotion } from '../types/promotion';
import { Edit, Trash2 } from 'lucide-react';

interface PromotionSettingsModalProps {
  open: boolean;
  onClose: () => void;
  discountRules: PromotionRule[];
  freeItemPromotions: FreeItemPromotion[];
  onOpenDiscountRules: () => void;
  onOpenFreeItemModal: () => void;
  onEditDiscountRule: (id: string) => void;
  onDeleteDiscountRule: (id: string) => void;
  onToggleDiscountRule: (id: string, enabled: boolean) => void;
  onEditFreeItemPromotion: (id: string) => void;
  onDeleteFreeItemPromotion: (id: string) => void;
  onToggleFreeItemPromotion: (id: string, enabled: boolean) => void;
  applyMode: 'both' | 'single';
  onChangeApplyMode: (mode: 'both' | 'single') => void;
}

export default function PromotionSettingsModal({ open, onClose, discountRules, freeItemPromotions, onOpenDiscountRules, onOpenFreeItemModal, onEditDiscountRule, onDeleteDiscountRule, onToggleDiscountRule, onEditFreeItemPromotion, onDeleteFreeItemPromotion, onToggleFreeItemPromotion, applyMode, onChangeApplyMode }: PromotionSettingsModalProps) {
  if (!open) return null;
  const stop = (e:any)=> e.stopPropagation();
  return (
    <div className="fixed inset-0 bg-black/40 z-[200] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-[49%] max-h-[85vh] overflow-hidden" onClick={stop}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">Promotion Settings</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl font-bold">×</button>
        </div>

        <div className="p-6 overflow-auto">
          {/* Apply Mode Selector */}
          <div className="mb-4">
            <div className="text-sm text-gray-700 mb-1">Apply Mode</div>
            <div className="inline-flex rounded-md overflow-hidden border border-gray-300">
              <button type="button" onClick={()=> onChangeApplyMode('both')} className={`px-4 py-2 text-sm ${applyMode==='both' ? 'bg-blue-600 text-white' : 'bg-white text-gray-800 hover:bg-gray-50'}`}>Allow Both</button>
              <button type="button" onClick={()=> onChangeApplyMode('single')} className={`px-4 py-2 text-sm ${applyMode==='single' ? 'bg-blue-600 text-white' : 'bg-white text-gray-800 hover:bg-gray-50'}`}>Single Only</button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Discount Promotions Section */}
            <div className="border border-gray-200 rounded-lg">
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-t-lg border-b">
                <h3 className="text-sm font-semibold text-gray-800">Discount Promotions</h3>
                <button onClick={onOpenDiscountRules} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm hover:bg-emerald-700">New Promotion</button>
              </div>
              <div className="p-3">
                {(!discountRules || discountRules.length === 0) ? (
                  <div className="text-xs text-gray-500">No discount promotions</div>
                ) : (
                  <ul className="divide-y divide-gray-200 rounded border border-gray-200 overflow-hidden">
                    {discountRules.map(r => {
                      const enabled = r.enabled !== false;
                      return (
                        <li key={`disc-${r.id}`} className="px-3 py-2 text-sm flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-gray-900 truncate">{r.name || '(Untitled)'}</div>
                            <div className="text-xs text-gray-500 truncate">{r.code ? `Code: ${r.code}` : 'No code'}{r.startDate?` • ${r.startDate}`:''}{r.endDate?` ~ ${r.endDate}`:''}</div>
                          </div>
                          <div className="text-xs text-gray-600 whitespace-nowrap">{r.mode==='percent'?`${r.value}%`:`$${r.value}`}</div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={()=> onToggleDiscountRule(r.id, !enabled)}
                              aria-pressed={enabled}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? 'bg-emerald-600' : 'bg-gray-300'}`}
                              title={enabled ? 'On' : 'Off'}
                            >
                              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                            </button>
                            <button onClick={()=> onEditDiscountRule(r.id)} className="p-1.5 rounded border text-gray-700 hover:bg-gray-50" title="Edit">
                              <Edit className="w-4 h-4" />
                            </button>
                            <button onClick={()=> onDeleteDiscountRule(r.id)} className="p-1.5 rounded border text-red-600 hover:bg-red-50 border-red-200" title="Delete">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>

            {/* Free Item Promotions Section */}
            <div className="border border-gray-200 rounded-lg">
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-t-lg border-b">
                <h3 className="text-sm font-semibold text-gray-800">Free Item Promotions</h3>
                <button onClick={onOpenFreeItemModal} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700">New Promotion</button>
              </div>
              <div className="p-3">
                {(!freeItemPromotions || freeItemPromotions.length === 0) ? (
                  <div className="text-xs text-gray-500">No free item promotions</div>
                ) : (
                  <ul className="divide-y divide-gray-200 rounded border border-gray-200 overflow-hidden">
                    {freeItemPromotions.map(p => {
                      const enabled = p.enabled !== false;
                      return (
                        <li key={`free-${p.id}`} className="px-3 py-2 text-sm flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-gray-900 truncate">{p.name || '(Untitled)'}</div>
                            <div className="text-xs text-gray-500 truncate">{p.code ? `Code: ${p.code}` : 'No code'}{p.startDate?` • ${p.startDate}`:''}{p.endDate?` ~ ${p.endDate}`:''}</div>
                          </div>
                          <div className="text-xs text-gray-600 whitespace-nowrap">{(p.kind||'FREE')==='BOGO' ? 'BOGO' : (p.freeItemId ? `Free: ${p.freeQty}x ${p.freeItemId}` : 'Free Item')}</div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={()=> onToggleFreeItemPromotion(p.id, !enabled)}
                              aria-pressed={enabled}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? 'bg-emerald-600' : 'bg-gray-300'}`}
                              title={enabled ? 'On' : 'Off'}
                            >
                              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                            </button>
                            <button onClick={()=> onEditFreeItemPromotion(p.id)} className="p-1.5 rounded border text-gray-700 hover:bg-gray-50" title="Edit">
                              <Edit className="w-4 h-4" />
                            </button>
                            <button onClick={()=> onDeleteFreeItemPromotion(p.id)} className="p-1.5 rounded border text-red-600 hover:bg-red-50 border-red-200" title="Delete">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
