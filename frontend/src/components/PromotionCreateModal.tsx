import React from 'react';
import { PromotionRule } from '../types/promotion';



interface PromotionCreateModalProps {
  open: boolean;
  onClose: () => void;
  discountRules: PromotionRule[];
  onChangeDiscountRules: (rules: PromotionRule[]) => void;
}

// Utilities for date range
function ymd(d: Date) { const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; }
function parseYmd(v?: string) { if(!v) return null; const [y,m,d]=v.split('-').map(n=>parseInt(n,10)); if(!y||!m||!d) return null; return new Date(y, m-1, d); }
function addMonths(d: Date, delta: number) { const nd = new Date(d); nd.setMonth(nd.getMonth()+delta); return nd; }
function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function getMonthMatrix(d: Date) { const s = startOfMonth(d); const startIdx = s.getDay(); const daysInMonth = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate(); const cells: Array<Date|null> = Array.from({length:42}, ()=>null); for(let i=0;i<daysInMonth;i++){ cells[startIdx+i]= new Date(d.getFullYear(), d.getMonth(), i+1); } return cells; }
// Display helpers
function formatYmdShort(v?: string) {
  if (!v) return '';
  const parts = v.split('-');
  if (parts.length !== 3) return v;
  const yy = parts[0].slice(-2);
  const mm = parts[1];
  const dd = parts[2];
  return `${yy}.${mm}.${dd}`;
}
function capitalizeFirstEnglish(s: string): string {
  const idx = s.search(/[A-Za-z]/);
  if (idx === -1) return s;
  return s.slice(0, idx) + s[idx].toUpperCase() + s.slice(idx + 1);
}
const DateRangeOverlay: React.FC<{ open: boolean; initialStart?: string; initialEnd?: string; onClose: () => void; onApply: (start: string, end: string) => void; }>
= ({ open, initialStart, initialEnd, onClose, onApply }) => {
  const today = new Date();
  const initStartDate = parseYmd(initialStart) || today;
  const [cursor, setCursor] = React.useState<Date>(new Date(initStartDate.getFullYear(), initStartDate.getMonth(), 1));
  const [tmpStart, setTmpStart] = React.useState<string>(initialStart||'');
  const [tmpEnd, setTmpEnd] = React.useState<string>(initialEnd||'');

  React.useEffect(()=>{ if (open) { const s = parseYmd(initialStart); const base = s || today; setCursor(new Date(base.getFullYear(), base.getMonth(), 1)); setTmpStart(initialStart||''); setTmpEnd(initialEnd||''); } }, [open, initialStart, initialEnd]);

  if (!open) return null;
  const stop = (e:any)=>e.stopPropagation();
  const left = cursor; const right = addMonths(cursor, 1);

  const selectDate = (d: Date) => {
    const s = tmpStart ? parseYmd(tmpStart) : null;
    const e = tmpEnd ? parseYmd(tmpEnd) : null;
    if (!s || (s && e)) { setTmpStart(ymd(d)); setTmpEnd(''); return; }
    if (d < s) { setTmpEnd(tmpStart); setTmpStart(ymd(d)); } else { setTmpEnd(ymd(d)); }
  };

  const isInRange = (d: Date) => {
    const s = parseYmd(tmpStart); const e = parseYmd(tmpEnd);
    if (!s) return false; if (!e) return ymd(d)===tmpStart;
    return d >= s && d <= e;
  };

  const Month = ({ base }: { base: Date }) => {
    const cells = getMonthMatrix(base);
    const monthLabel = base.toLocaleString(undefined, { month:'long', year:'numeric' });
    return (
      <div className="w-72">
        <div className="text-center font-semibold text-gray-700 mb-2">{monthLabel}</div>
        <div className="grid grid-cols-7 text-[11px] text-gray-500 mb-1">
          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=> <div key={d} className="text-center">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1 text-sm">
          {cells.map((c, idx)=> (
            <button key={idx} disabled={!c} onClick={()=> c && selectDate(c)} className={`h-8 rounded text-center ${!c? 'opacity-0 pointer-events-none' : isInRange(c) ? 'bg-blue-600 text-white' : 'hover:bg-blue-50 text-gray-800'} `}>
              {c ? c.getDate() : ''}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const apply = () => { onApply(tmpStart||'', tmpEnd||tmpStart||''); onClose(); };

  return (
    <div className="fixed inset-0 bg-black/40 z-[200] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl p-4 w-full max-w-3xl" onClick={stop}>
        <div className="mb-3 text-center text-gray-700 font-semibold">Date Range</div>
        <div className="relative flex items-center justify-center px-10">
          <button
            aria-label="Previous month"
            title="Previous month"
            onClick={()=> setCursor(addMonths(cursor,-1))}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-white w-11 h-11 flex items-center justify-center rounded-full hover:bg-gray-100 border border-gray-300 shadow text-gray-700"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" className="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div className="flex gap-6">
            <Month base={left} />
            <Month base={right} />
          </div>
          <button
            aria-label="Next month"
            title="Next month"
            onClick={()=> setCursor(addMonths(cursor,1))}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-white w-11 h-11 flex items-center justify-center rounded-full hover:bg-gray-100 border border-gray-300 shadow text-gray-700"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" className="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
          </button>
        </div>
        <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
          <div>
            {tmpStart ? new Date(tmpStart).toLocaleDateString() : '—'} {' '}~{' '} {tmpEnd ? new Date(tmpEnd).toLocaleDateString() : (tmpStart ? new Date(tmpStart).toLocaleDateString() : '—')}
          </div>
          <div className="space-x-2">
            <button onClick={onClose} className="px-4 py-2 rounded bg-gray-600 text-white hover:bg-gray-700">Cancel</button>
            <button onClick={apply} className="px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700">Apply</button>
          </div>
        </div>
      </div>
    </div>
  );
};

// TimePicker (24-hour, 5-minute steps)
function parseTimeToParts24(value?: string): { h24: number; m: number } {
  if (!value) return { h24: 0, m: 0 };
  const [hh, mm] = value.split(':').map(v => parseInt(v, 10));
  const h24 = Math.max(0, Math.min(23, isNaN(hh) ? 0 : hh));
  const m = Math.max(0, Math.min(59, isNaN(mm) ? 0 : mm));
  return { h24, m };
}
function partsToTime24({ h24, m }: { h24: number; m: number }): string {
  const hh = String(Math.max(0, Math.min(23, h24))).padStart(2, '0');
  const mm = String(Math.max(0, Math.min(59, m))).padStart(2, '0');
  return `${hh}:${mm}`;
}
const TimePicker: React.FC<{ value?: string; onChange: (v: string) => void }>
= ({ value, onChange }) => {
  const normalized = React.useMemo(() => {
    if (!value) return '';
    const [hh, mm] = value.split(':');
    const h = String(Math.max(0, Math.min(23, parseInt(hh || '0', 10)))).padStart(2, '0');
    const m = String(Math.max(0, Math.min(59, parseInt(mm || '0', 10)))).padStart(2, '0');
    return `${h}:${m}`;
  }, [value]);

  const [open, setOpen] = React.useState(false);
  const [tmpH, setTmpH] = React.useState(0); // 0~12
  const [tmpM, setTmpM] = React.useState(0); // 0~59 (steps of 5)
  const [tmpAm, setTmpAm] = React.useState(true);

  const openOverlay = () => {
    const [hh, mm] = (normalized || '00:00').split(':').map(v=> parseInt(v||'0',10));
    const h24 = isNaN(hh)?0:hh;
    const am = h24 < 12;
    const h12 = ((h24 % 12) + 12) % 12; // 0..11
    setTmpAm(am);
    setTmpH(Math.max(0, Math.min(11, h12)));
    setTmpM(isNaN(mm)?0:mm - (mm%5));
    setOpen(true);
  };
  const apply = () => {
    const h24 = tmpAm ? (tmpH % 12) : ((tmpH % 12) + 12); // 00..11 or 12..23
    onChange(`${String(h24).padStart(2,'0')}:${String(tmpM).padStart(2,'0')}`);
    setOpen(false);
  };

  return (
    <>
      <input
        type="text"
        readOnly
        value={normalized}
        onClick={openOverlay}
        className="no-time-indicator w-20 text-center font-mono bg-gray-50 text-gray-900 border border-gray-300 rounded-md px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
        title="Time"
      />
      {open && (
        <div className="fixed inset-0 bg-black/40 z-[300] flex items-center justify-center p-4" onClick={()=> setOpen(false)}>
          <div className="bg-white rounded-xl shadow-2xl p-4 w-full max-w-sm" onClick={(e)=> e.stopPropagation()}>
            <div className="mb-3 text-center text-gray-700 font-semibold">Select Time</div>
            <div className="space-y-4">
              <div className="flex items-center justify-center gap-3">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={()=> setTmpAm(true)}
                    aria-pressed={tmpAm}
                    className={`px-5 py-3 rounded-md border text-base ${tmpAm ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-800 hover:bg-gray-50'}`}
                    title="AM"
                  >AM</button>
                  <button
                    type="button"
                    onClick={()=> setTmpAm(false)}
                    aria-pressed={!tmpAm}
                    className={`px-5 py-3 rounded-md border text-base ${!tmpAm ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-800 hover:bg-gray-50'}`}
                    title="PM"
                  >PM</button>
                </div>
              </div>

              <div className="text-xs text-gray-500 font-medium text-center">Hour (00–11)</div>
              <div className="grid grid-cols-6 gap-2 justify-items-center">
                {Array.from({ length: 12 }, (_, i) => i).map(h => (
                  <button
                    type="button"
                    key={`h-${h}`}
                    onClick={()=> setTmpH(h)}
                    className={`w-12 h-12 rounded-md border text-base ${tmpH===h ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-800 hover:bg-gray-50'}`}
                  >{String(h).padStart(2,'0')}</button>
                ))}
              </div>

              <div className="h-px bg-gray-200" />
              <div className="text-xs text-gray-500 font-medium text-center">Minute (5 min)</div>
              <div className="grid grid-cols-6 gap-2 justify-items-center">
                {[0,5,10,15,20,25,30,35,40,45,50,55].map(mm => (
                  <button
                    type="button"
                    key={`m-${mm}`}
                    onClick={()=> setTmpM(mm)}
                    className={`w-12 h-12 rounded-md border text-base ${tmpM===mm ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-800 hover:bg-gray-50'}`}
                  >{String(mm).padStart(2,'0')}</button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-end mt-4 gap-2">
              <button onClick={()=> setOpen(false)} className="px-4 py-2 rounded bg-gray-600 text-white hover:bg-gray-700">Cancel</button>
              <button onClick={apply} className="px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700">Apply</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const emptyDiscountRule = (id: string): PromotionRule => ({
  id,
  createdAt: Date.now(),
  name: '',
  code: '',
  startDate: '',
  endDate: '',
  startTime: '',
  endTime: '',
  mode: 'percent',
  value: 0,
  minSubtotal: 0,
  eligibleItemIds: [],
  daysOfWeek: [],
  dateAlways: false,
  timeAlways: false,
  enabled: true,
});

const PromotionCreateModal: React.FC<PromotionCreateModalProps> = ({ open, onClose, discountRules, onChangeDiscountRules }) => {
  const [rangeForDiscountId, setRangeForDiscountId] = React.useState<string|null>(null);
    const firstNameInputRef = React.useRef<HTMLInputElement|null>(null);
  const [localRules, setLocalRules] = React.useState<PromotionRule[]>([]); // Initialize empty, will be set on open
  React.useEffect(()=>{
    if (open) {
      setLocalRules(discountRules || []); // Initialize once when opening
      setTimeout(()=> firstNameInputRef.current?.focus(), 0);
    } else {
      // When closing, reset local state to prevent stale data on next open
      setLocalRules([]);
    }
  }, [open]); // Only depends on open. discountRules is only used on initial open.

  // We will now use refs for all input fields in RulePanel
  const fieldRefs = React.useRef<Record<string, { name: React.RefObject<HTMLInputElement | null>; code: React.RefObject<HTMLInputElement | null>; val: React.RefObject<HTMLInputElement | null>; min: React.RefObject<HTMLInputElement | null>; }>>({});
 
  if (!open) return null;
 
  const addDiscount = () => {
    const id = `disc-${Date.now()}`;
    const next = [...(localRules || []), emptyDiscountRule(id)];
    setLocalRules(next);
  };

  // updateDiscount now primarily used for non-input fields (checkboxes, buttons)
  const updateDiscount = (id: string, patch: Partial<PromotionRule>) => {
    setLocalRules(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeDiscount = (id: string) => {
    setLocalRules(prev => prev.filter(r => r.id !== id));
  };

  const stop = (e: any) => e.stopPropagation();

  const RulePanel: React.FC<{ rule: PromotionRule; idx: number; attachFocus?: boolean }> = ({ rule, idx, attachFocus }) => {
    // Introduce local states for input fields to ensure immediate feedback and prevent external interference.
    const [name, setName] = React.useState(rule.name);
    const [code, setCode] = React.useState(rule.code);
    const [val, setVal] = React.useState(rule.value);
    const [minSub, setMinSub] = React.useState(rule.minSubtotal);

    // Update local states when the parent rule prop changes (e.g., when adding a new rule or initial load).
    React.useEffect(() => { setName(rule.name); }, [rule.name]);
    React.useEffect(() => { setCode(rule.code); }, [rule.code]);
    React.useEffect(() => { setVal(rule.value); }, [rule.value]);
    React.useEffect(() => { setMinSub(rule.minSubtotal); }, [rule.minSubtotal]);

    return (
      <div className="grid grid-cols-4 gap-3">
        {/* Row 1: Promotion Name, Promotion Code */}
        <div className="col-span-4">
          <div className="flex gap-2">
            <div className="w-[100%]">
              <label className="block text-sm text-gray-600 mb-1">Promotion Name</label>
              <input
                type="text"
                ref={attachFocus ? firstNameInputRef : null} // firstNameInputRef for autoFocus
                autoFocus={attachFocus}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={(e) => updateDiscount(rule.id, { name: capitalizeFirstEnglish(e.target.value) })}
                className="w-full text-base px-3 py-2 h-11 rounded border border-gray-300"
              />
            </div>
          </div>
        </div>

        {/* Row 2: Discount, Value input, Min Order */}
        <div className="col-span-4">
          <div className="flex items-start gap-2">
            <div className="flex flex-col">
              <label className="block text-sm text-gray-600 mb-1">Discount</label>
              <div className="inline-flex rounded-md overflow-hidden border border-gray-300">
                <button type="button" onClick={()=> updateDiscount(rule.id, { mode: 'percent' })} className={`px-4 py-2 text-base ${rule.mode==='percent' ? 'bg-blue-600 text-white' : 'bg-white text-gray-800 hover:bg-gray-50'}`}>%</button>
                <button type="button" onClick={()=> updateDiscount(rule.id, { mode: 'amount' })} className={`px-4 py-2 text-base ${rule.mode==='amount' ? 'bg-blue-600 text-white' : 'bg-white text-gray-800 hover:bg-gray-50'}`}>$</button>
              </div>
            </div>
            <div className="flex flex-col w-16">
              <label className="block text-sm text-gray-600 mb-1">Value</label>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={val === 0 ? '' : String(val)}
                onChange={(e) => {
                  const v = e.target.value;
                  setVal(v === '' ? 0 : Number(v));
                }}
                onBlur={(e) => updateDiscount(rule.id, { value: Number(e.target.value) || 0 })}
                className="w-full text-base px-3 py-2 h-11 rounded border border-gray-300"
                placeholder="Value"
              />
            </div>
            <div className="flex flex-col w-16">
              <label className="block text-sm text-gray-600 mb-1">Min Order</label>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={minSub === 0 ? '' : String(minSub)}
                onChange={(e) => {
                  const v = e.target.value;
                  setMinSub(v === '' ? 0 : Number(v));
                }}
                onBlur={(e) => updateDiscount(rule.id, { minSubtotal: Number(e.target.value) || 0 })}
                className="w-full text-base px-3 py-2 h-11 rounded border border-gray-300"
              />
            </div>
            <div className="flex flex-col w-[8rem]">
              <label className="block text-sm text-gray-600 mb-1">Promotion Code</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onBlur={(e) => updateDiscount(rule.id, { code: e.target.value.trim() })}
                className="w-full text-base px-3 py-2 h-11 rounded border border-gray-300"
              />
            </div>
          </div>
        </div>

        {/* Row 2b: Select Period + Times */}
        <div className="col-span-4">
          <div className="flex items-start gap-4">
            <div className="flex flex-col w-[10.3rem]">
              <label className="block text-sm text-gray-600 mb-1">Select Period</label>
              <input
                type="text"
                readOnly
                onClick={()=> !rule.dateAlways && setRangeForDiscountId(rule.id)}
                value={rule.dateAlways ? 'Any date' : (rule.startDate && rule.endDate ? `${formatYmdShort(rule.startDate)} ~ ${formatYmdShort(rule.endDate)}` : '')}
                className={`w-full text-base px-3 py-2 h-11 rounded border bg-white text-gray-900 cursor-pointer ${rule.dateAlways ? 'border-gray-200 text-gray-400 cursor-not-allowed' : 'border-gray-300'}`}
                placeholder="Pick a date range"
              />
              <label className="mt-2 inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={!!rule.dateAlways}
                  onChange={(e)=> updateDiscount(rule.id, { dateAlways: e.target.checked, startDate: e.target.checked ? '' : rule.startDate, endDate: e.target.checked ? '' : rule.endDate })}
                />
                Any date
              </label>
            </div>
            <div className="flex items-start gap-1">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Start Time</label>
                <div className="opacity-100">
                  <TimePicker value={rule.timeAlways ? '' : rule.startTime} onChange={(v)=> updateDiscount(rule.id, { startTime: v })} />
                </div>
                <label className="mt-2 inline-flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={!!rule.timeAlways}
                    onChange={(e)=> updateDiscount(rule.id, { timeAlways: e.target.checked, startTime: e.target.checked ? '' : rule.startTime, endTime: e.target.checked ? '' : rule.endTime })}
                  />
                  Any time
                </label>
              </div>
              <div className="px-1 self-center text-gray-500 select-none">~</div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">End Time</label>
                <div className={rule.timeAlways ? 'pointer-events-none opacity-50' : ''}>
                  <TimePicker value={rule.timeAlways ? '' : rule.endTime} onChange={(v)=> updateDiscount(rule.id, { endTime: v })} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Row 3: Days of Week */}
        <div className="col-span-4">
          <div className="text-sm text-gray-600 mb-1">Days of Week</div>
          <div className="flex gap-[0.405rem]">
            {[
              { label: 'Sun', idx: 0 },
              { label: 'Mon', idx: 1 },
              { label: 'Tue', idx: 2 },
              { label: 'Wed', idx: 3 },
              { label: 'Thu', idx: 4 },
              { label: 'Fri', idx: 5 },
              { label: 'Sat', idx: 6 },
            ].map(({ label, idx: dow })=>{
              const active = (rule.daysOfWeek||[]).includes(dow);
              return (
                <button
                  key={`dow-${rule.id}-${dow}`}
                  type="button"
                  onClick={()=>{
                    const set = new Set(rule.daysOfWeek||[]);
                    if (set.has(dow)) set.delete(dow); else set.add(dow);
                    updateDiscount(rule.id, { daysOfWeek: Array.from(set).sort((a,b)=>a-b) });
                  }}
                  className={`w-[47px] h-11 p-0 flex items-center justify-center rounded border text-sm leading-none ${active ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                  title={label}
                >{label}</button>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-y-auto" onClick={stop} onKeyDownCapture={(e)=>e.stopPropagation()} onKeyUpCapture={(e)=>e.stopPropagation()} onKeyPressCapture={(e)=>e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">Create Discount Promotions</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl font-bold">×</button>
        </div>
        <style>{`
          input.no-time-indicator::-webkit-calendar-picker-indicator{display:none!important;}
          input.no-time-indicator::-webkit-clear-button{display:none!important;}
          input.no-time-indicator::-webkit-inner-spin-button{display:none!important;}
          input.no-time-indicator{-moz-appearance:textfield;}
        `}</style>

        <div className="p-6">
          <div className="border border-gray-300 rounded-lg w-fit">
            <div className="flex items-center justify-between p-3 bg-gray-50 border-b rounded-t-lg">
              <h3 className="text-sm font-semibold text-gray-800">Discount / Free Item</h3>
              <button onClick={addDiscount} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-base hover:bg-emerald-700">Add</button>
            </div>
            <div className="p-3 space-y-3">
              {(discountRules||[]).length === 0 && (
                <div className="text-xs text-gray-500">No discount promotions</div>
              )}
              {(localRules||[]).map((rule, idx) => (
                <div key={rule.id} className="border rounded p-3 space-y-2">
                  <div className="grid grid-cols-1 gap-4">
                    <RulePanel rule={rule} idx={idx} attachFocus={idx===0} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end">
          <button onClick={() => {
            const highRisk = (localRules||[]).some(r => (r.mode === 'percent' && Number(r.value) >= 30) || (r.mode === 'amount' && Number(r.value) >= 50));
            if (highRisk) {
              const ok = window.confirm('Are you sure about this discount value? It looks unusually high (>= 30% or >= $50). Please confirm.');
              if (!ok) return;
            }
            onChangeDiscountRules(localRules);
            onClose();
          }} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm">Done</button>
        </div>
      </div>

      {/* Range picker */}
      <DateRangeOverlay
        open={!!rangeForDiscountId}
        initialStart={(localRules||[]).find(r=>r.id===rangeForDiscountId)?.startDate} // Use localRules here
        initialEnd={(localRules||[]).find(r=>r.id===rangeForDiscountId)?.endDate} // Use localRules here
        onClose={()=> setRangeForDiscountId(null)}
        onApply={(start, end)=>{
          if (!rangeForDiscountId) return;
          updateDiscount(rangeForDiscountId, { startDate:start, endDate:end });
        }}
      />
    </div>
  );
};

export default PromotionCreateModal; 