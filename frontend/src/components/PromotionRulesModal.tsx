import React from 'react';
import { PromotionMode, PromotionRule } from '../types/promotion';

interface Category { category_id: string | number; id?: string | number; name: string; title?: string }
interface MenuItem { id: string | number; name: string; category?: string; category_id?: string|number; categoryId?: string|number }

// Display helpers (match PromotionCreateModal)
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
// 24-hour overlay TimePicker (copied behavior from PromotionCreateModal)
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
  const [tmpH, setTmpH] = React.useState(0); // 0~11
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
        placeholder="--:--"
        className="no-time-indicator w-20 h-11 text-center font-mono bg-gray-50 text-gray-900 border border-gray-300 rounded-md px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
        title="Time"
      />
      {open && (
        <div className="fixed inset-0 bg-black/40 z-[300] flex items-center justify-center p-4" onClick={()=> setOpen(false)}>
          <div className="bg-white rounded-xl shadow-2xl p-4 w-full max-w-sm" onClick={(e)=> e.stopPropagation()}>
            <div className="mb-3 text-center text-gray-700 font-semibold">Select Time</div>
            <div className="space-y-4">
              <div className="flex items-center justify-center gap-3">
                <div className="flex gap-2">
                  <button type="button" onClick={()=> setTmpAm(true)} aria-pressed={tmpAm} className={`px-5 py-2 rounded-md border text-sm ${tmpAm ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-800 hover:bg-gray-50'}`} title="AM">AM</button>
                  <button type="button" onClick={()=> setTmpAm(false)} aria-pressed={!tmpAm} className={`px-5 py-2 rounded-md border text-sm ${!tmpAm ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-800 hover:bg-gray-50'}`} title="PM">PM</button>
                </div>
              </div>
              <div className="text-xs text-gray-500 font-medium text-center">Hour (00–11)</div>
              <div className="grid grid-cols-6 gap-2 justify-items-center">
                {Array.from({ length: 12 }, (_, i) => i).map(h => (
                  <button type="button" key={`h-${h}`} onClick={()=> setTmpH(h)} className={`w-12 h-12 rounded-md border text-base ${tmpH===h ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-800 hover:bg-gray-50'}`}>{String(h).padStart(2,'0')}</button>
                ))}
              </div>
              <div className="h-px bg-gray-200" />
              <div className="text-xs text-gray-500 font-medium text-center">Minute (5 min)</div>
              <div className="grid grid-cols-6 gap-2 justify-items-center">
                {[0,5,10,15,20,25,30,35,40,45,50,55].map(mm => (
                  <button type="button" key={`m-${mm}`} onClick={()=> setTmpM(mm)} className={`w-12 h-12 rounded-md border text-base ${tmpM===mm ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-800 hover:bg-gray-50'}`}>{String(mm).padStart(2,'0')}</button>
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

const ArrowButton: React.FC<{ onClick: () => void; disabled?: boolean; label: string }>
  = ({ onClick, disabled, label }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="leading-none text-gray-500 hover:text-gray-700 disabled:opacity-50"
    aria-label={label}
    title={label}
  >
    ▲
  </button>
);

const ArrowDownButton: React.FC<{ onClick: () => void; disabled?: boolean; label: string }>
  = ({ onClick, disabled, label }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="leading-none text-gray-500 hover:text-gray-700 disabled:opacity-50"
    aria-label={label}
    title={label}
  >
    ▼
  </button>
);

interface PromotionRulesModalProps {
  open: boolean;
  onClose: () => void;
  rules: PromotionRule[];
  onChangeRules: (rules: PromotionRule[]) => void;
  categories: Category[];
  menuItems: MenuItem[];
  embedded?: boolean;
  newMode?: boolean;
}

const emptyRule = (id: string): PromotionRule => ({ id, createdAt: Date.now(), name: '', code: '', startDate: '', endDate: '', startTime: '', endTime: '', mode: 'percent', value: 0, minSubtotal: 0, eligibleItemIds: [], daysOfWeek: [], dateAlways: false, timeAlways: false, enabled: true } as any);

function ymd(d: Date) { const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; }
function parseYmd(v?: string) { if(!v) return null; const [y,m,d]=v.split('-').map(n=>parseInt(n,10)); if(!y||!m||!d) return null; return new Date(y, m-1, d); }
function addMonths(d: Date, delta: number) { const nd = new Date(d); nd.setMonth(nd.getMonth()+delta); return nd; }
function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function getMonthMatrix(d: Date) { // Monday-first grid 6x7
  const s = startOfMonth(d);
  const startIdx = s.getDay(); // Sun=0
  const daysInMonth = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
  const cells: Array<Date|null> = Array.from({length:42}, ()=>null);
  for(let i=0;i<daysInMonth;i++){ cells[startIdx+i]= new Date(d.getFullYear(), d.getMonth(), i+1); }
  return cells;
}

const DateRangeOverlay: React.FC<{
  open: boolean;
  initialStart?: string;
  initialEnd?: string;
  onClose: () => void;
  onApply: (start: string, end: string) => void;
}> = ({ open, initialStart, initialEnd, onClose, onApply }) => {
  const today = new Date();
  const initStartDate = parseYmd(initialStart) || today;
  const [cursor, setCursor] = React.useState<Date>(new Date(initStartDate.getFullYear(), initStartDate.getMonth(), 1));
  const [tmpStart, setTmpStart] = React.useState<string>(initialStart||'');
  const [tmpEnd, setTmpEnd] = React.useState<string>(initialEnd||'');

  React.useEffect(()=>{
    if (open) {
      const s = parseYmd(initialStart); const base = s || today;
      setCursor(new Date(base.getFullYear(), base.getMonth(), 1));
      setTmpStart(initialStart||'');
      setTmpEnd(initialEnd||'');
    }
  }, [open, initialStart, initialEnd]);

  if (!open) return null;
  const stop = (e:any)=>e.stopPropagation();
  const left = cursor; const right = addMonths(cursor, 1);

  const selectDate = (d: Date) => {
    const s = tmpStart ? parseYmd(tmpStart) : null;
    const e = tmpEnd ? parseYmd(tmpEnd) : null;
    if (!s || (s && e)) { setTmpStart(ymd(d)); setTmpEnd(''); return; }
    // set end and normalize order
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
            <button
              key={idx}
              disabled={!c}
              onClick={()=> c && selectDate(c)}
              className={`h-8 rounded text-center ${!c? 'opacity-0 pointer-events-none' : isInRange(c) ? 'bg-blue-600 text-white' : 'hover:bg-blue-50 text-gray-800'} `}
            >
              {c ? c.getDate() : ''}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const apply = () => { onApply(tmpStart||'', tmpEnd||tmpStart||''); onClose(); };

  return (
    <div className="fixed inset-0 bg-black/40 z-[100] flex items-center justify-center p-4" onClick={onClose}>
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
            <button onClick={onClose} className="px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200">Cancel</button>
            <button onClick={apply} className="px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700">Apply</button>
          </div>
        </div>
      </div>
    </div>
  );
};

const PromotionRulesModal: React.FC<PromotionRulesModalProps> = ({ open, onClose, rules, onChangeRules, categories, menuItems, embedded = false, newMode = false }) => {
  const [localRules, setLocalRules] = React.useState<PromotionRule[]>([]);
  const [expandedCatsByRule, setExpandedCatsByRule] = React.useState<Record<string, Set<string>>>(()=>({}));
  const [rangeForRuleId, setRangeForRuleId] = React.useState<string|null>(null);
  const [editMap, setEditMap] = React.useState<Record<string, { valueText?: string; minText?: string }>>({});
  const [errorsByRule, setErrorsByRule] = React.useState<Record<string, { name?: string; value?: string; min?: string; eligible?: string }>>({});

  React.useEffect(()=>{
    if (open) {
      const initial = newMode ? [emptyRule(`rule-${Date.now()}`)] : ((rules && rules.length>0) ? rules.slice(0,4) : [emptyRule('rule-1')]);
      setLocalRules(initial);
      const initExp: Record<string, Set<string>> = {};
      initial.forEach(r => { initExp[r.id] = new Set(); });
      setExpandedCatsByRule(initExp);
    }
  }, [open, rules, newMode]);

  const updateRule = (id: string, patch: Partial<PromotionRule>) => {
    setLocalRules(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  };

  const toggleRuleCat = (ruleId: string, catId: string) => {
    setExpandedCatsByRule(prev => {
      const next = { ...prev };
      if (!next[ruleId]) next[ruleId] = new Set();
      const set = new Set(next[ruleId]);
      if (set.has(catId)) set.delete(catId); else set.add(catId);
      next[ruleId] = set;
      return next;
    });
  };

  const addRule = () => {
    setLocalRules(prev => prev.length >= 4 ? prev : [...prev, emptyRule(`rule-${prev.length+1}`)]);
  };

  const removeRule = (id: string) => {
    setLocalRules(prev => prev.filter(r => r.id !== id));
  };

  const handleSave = () => {
    try { (document.activeElement as any)?.blur?.(); } catch {}
    // validate required fields
    const nextErrors: Record<string, { name?: string; value?: string; min?: string; eligible?: string }> = {};
    (localRules || []).forEach(r => {
      const errs: { name?: string; value?: string; min?: string; eligible?: string } = {};
      if (!String(r.name || '').trim()) errs.name = 'Required';
      if (!(r as any).mode) { updateRule(r.id, { mode: 'percent' as any }); }
      const v = Number(r.value || 0);
      if (!(v > 0)) errs.value = 'Enter a value > 0';
      // Min Order required
      const minText = (editMap[r.id]?.minText ?? '').trim();
      const mNum = Number((r.minSubtotal as any));
      if (newMode) {
        if (minText === '') errs.min = 'Required';
        else if (isNaN(mNum) || mNum < 0) errs.min = 'Enter a number ≥ 0';
      } else {
        if (r.minSubtotal == null || isNaN(mNum) || mNum < 0) errs.min = 'Enter a number ≥ 0';
      }
      if (!Array.isArray(r.eligibleItemIds) || r.eligibleItemIds.length === 0) errs.eligible = 'Select at least one item';
      if (errs.name || errs.value || errs.min || errs.eligible) nextErrors[r.id] = errs;
    });
    if (Object.keys(nextErrors).length > 0) { setErrorsByRule(nextErrors); try { const lines = (localRules||[]).map(r=>{ const e = nextErrors[r.id]; if (!e) return null; const fields: string[] = []; if (e.name) fields.push('Promotion Name'); if (e.value) fields.push('Value'); if (e.min) fields.push('Min Order'); if (e.eligible) fields.push('Eligible Items'); return `- ${r.name || '(Untitled)'}: ${fields.join(', ')}`; }).filter(Boolean).join('\n'); alert(`Please fill the required fields.\n\n${lines}`); } catch {} return; }

    setErrorsByRule({});
    onChangeRules(localRules);
    onClose();
  };

  if (!embedded && !open) return null;

  const stop = (e: React.MouseEvent | React.TouchEvent | any) => { e.stopPropagation(); }

  const header = (
    <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
      <h2 className="text-xl font-bold text-gray-900">Discount Rules</h2>
      {!embedded && (<button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl font-bold">×</button>)}
    </div>
  );

  const body = (
    <div>
      <style>{`
        input.no-time-indicator::-webkit-calendar-picker-indicator{display:none!important;}
        input.no-time-indicator::-webkit-clear-button{display:none!important;}
        input.no-time-indicator::-webkit-inner-spin-button{display:none!important;}
        input.no-time-indicator{-moz-appearance:textfield;}
      `}</style>

      <div className="px-6 py-4 space-y-4">
        {localRules.map((rule, idx) => {
            const exp = expandedCatsByRule[rule.id] || new Set<string>();
            const selectedSet = new Set((rule.eligibleItemIds||[]).map(String));
            return (
              <div key={rule.id} className="rounded-lg border border-gray-200">
                

                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-[0.9fr_1.1fr] gap-6">
                    {/* Left: Four rows layout */}
                    <div className="space-y-[1.512rem] w-fit">
                      {/* Row 1: Promotion Name */}
                      <div>
                        <label className="block text-sm text-gray-600 mb-1">Promotion Name <span className="text-red-600">*</span></label>
                        <input value={rule.name} onChange={e=>updateRule(rule.id, { name: capitalizeFirstEnglish(e.target.value) })} onBlur={e=>updateRule(rule.id, { name: capitalizeFirstEnglish(e.target.value) })} autoFocus={idx===0} className={`w-full text-base px-2 py-2 rounded border ${errorsByRule[rule.id]?.name ? 'border-red-500' : 'border-gray-300'} bg-white text-gray-900 placeholder-gray-400`} placeholder="e.g. Happy Hour" />
                        
                      </div>

                      {/* Row 2: Mode, Value, Min Subtotal, Promotion Code (match PromotionCreateModal) */}
                      <div className="flex items-start gap-2">
                        <div className="flex flex-col">
                          <label className="block text-sm text-gray-600 mb-1">Mode <span className="text-red-600">*</span></label>
                          <div className="inline-flex rounded-md overflow-hidden border border-gray-300">
                            <button type="button" onClick={()=> updateRule(rule.id, { mode: 'percent' })} className={`px-4 py-2 text-base ${rule.mode==='percent' ? 'bg-blue-600 text-white' : 'bg-white text-gray-800 hover:bg-gray-50'}`}>%</button>
                            <button type="button" onClick={()=> updateRule(rule.id, { mode: 'amount' })} className={`px-4 py-2 text-base ${rule.mode==='amount' ? 'bg-blue-600 text-white' : 'bg-white text-gray-800 hover:bg-gray-50'}`}>$</button>
                          </div>
                        </div>
                        <div className="flex flex-col w-[4.6rem]">
                          <label className="block text-sm text-gray-600 mb-1">Value <span className="text-red-600">*</span></label>
                          <input
                            type="text"
                            inputMode="decimal"
                            defaultValue={(newMode && (!rule.value || Number(rule.value) === 0)) ? '' : String(rule.value ?? '')}
                            onBlur={(e)=>{
                              const raw = (e.target.value || '').trim();
                              const num = raw === '' ? 0 : Number(raw);
                              updateRule(rule.id, { value: isNaN(num) ? 0 : num });
                            }}
                            className={`w-full text-base px-2 py-2 rounded border ${errorsByRule[rule.id]?.value ? 'border-red-500' : 'border-gray-300'} text-gray-900`}
                            placeholder="Value"
                            autoComplete="off" spellCheck={false}
                          />
                          
                        </div>
                        <div className="flex flex-col w-[4.92rem]">
                          <label className="block text-sm text-gray-600 mb-1">Min Order <span className="text-red-600">*</span></label>
                          <input
                            type="text"
                            inputMode="decimal"
                            defaultValue={(newMode && (!rule.minSubtotal || Number(rule.minSubtotal) === 0)) ? '' : String(rule.minSubtotal ?? '')}
                            onChange={(e)=> setEditMap(prev => ({ ...prev, [rule.id]: { ...(prev[rule.id]||{}), minText: e.target.value } }))}
                            onBlur={(e)=>{
                              const raw = (e.target.value || '').trim();
                              const num = raw === '' ? NaN : Number(raw);
                              updateRule(rule.id, { minSubtotal: isNaN(num) ? (rule.minSubtotal ?? 0) : num });
                            }}
                            className={`w-full text-base px-2 py-2 rounded border ${errorsByRule[rule.id]?.min ? 'border-red-500' : 'border-gray-300'} text-gray-900`}
                            autoComplete="off" spellCheck={false}
                          />
                          
                        </div>
                        <div className="flex flex-col w-[6.5rem]">
                          <label className="block text-sm text-gray-600 mb-1">Promotion Code</label>
                          <input value={rule.code} onChange={e=>updateRule(rule.id, { code: e.target.value })} onBlur={e=>updateRule(rule.id, { code: (e.target.value||'').trim() })} className="w-full text-base px-2 py-2 rounded border border-gray-300 text-gray-900" />
                        </div>
                      </div>

                      {/* Row 3: Date Range, Start Time, End Time */}
                      <div className="flex flex-row items-start gap-4">
                        <div className="flex flex-col w-[10.3rem]">
                          <label className="block text-sm text-gray-600 mb-1">Date Range</label>
                          <input
                            type="text"
                            readOnly
                            onClick={()=> setRangeForRuleId(rule.id)}
                            value={(rule.startDate && rule.endDate ? `${formatYmdShort(rule.startDate)} ~ ${formatYmdShort(rule.endDate)}` : '')}
                            className={`w-full h-11 text-base px-2 py-2 rounded border bg-white text-gray-900 cursor-pointer border-gray-300`}
                            placeholder="Pick a date range"
                          />
                        </div>
                        <div className="flex items-start gap-1">
                          <div>
                            <label className="block text-sm text-gray-600 mb-1">Start Time</label>
                            <div className="opacity-100">
                              <TimePicker value={rule.startTime} onChange={(v)=> updateRule(rule.id, { startTime: v } as any)} />
                            </div>
                          </div>
                          <div className="px-1 self-center text-gray-500 select-none">~</div>
                          <div>
                            <label className="block text-sm text-gray-600 mb-1">End Time</label>
                            <div>
                               <TimePicker value={rule.endTime} onChange={(v)=> updateRule(rule.id, { endTime: v } as any)} />
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Row 4: Days of Week (match sizes) */}
                      <div>
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
                            const active = ((rule as any).daysOfWeek||[]).includes(dow);
                            return (
                              <button
                                key={`dow-${rule.id}-${dow}`}
                                type="button"
                                onClick={()=>{
                                  const set = new Set(((rule as any).daysOfWeek||[]));
                                  if (set.has(dow)) set.delete(dow); else set.add(dow);
                                  updateRule(rule.id, { daysOfWeek: Array.from(set).sort((a:any,b:any)=>a-b) } as any);
                                }}
                                className={`w-[47px] h-11 p-0 flex items-center justify-center rounded border text-sm leading-none ${active ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                                title={label}
                              >{label}</button>
                            );
                          })}
                        </div>
                      </div>
                      
                    </div>

                    {/* Right: Eligible Items */}
                    <div className="flex flex-col min-h-0 w-full">
                      {(() => {
                        const allItemIds = (Array.isArray(menuItems)?menuItems:[]).map((it:any)=> String(it.id));
                        const selectedSetAll = new Set((rule.eligibleItemIds||[]).map(String));
                        const selectedCountAll = allItemIds.filter(id => selectedSetAll.has(id)).length;
                        const allCheckedAll = allItemIds.length>0 && selectedCountAll===allItemIds.length;
                        const indeterminateAll = selectedCountAll>0 && selectedCountAll<allItemIds.length;
                        return (
                          <div className="text-sm text-gray-700 mb-1 flex items-center justify-between w-full">
                            <span>Eligible Items <span className="text-red-600">*</span></span>
                            <label className="inline-flex items-center gap-2 -translate-x-1">
                              <input
                                type="checkbox"
                                className={`w-5 h-5 ${errorsByRule[rule.id]?.eligible ? 'ring-2 ring-red-500 rounded' : ''}`}
                                checked={allCheckedAll}
                                ref={(el)=>{ if (el) (el as any).indeterminate = indeterminateAll; }}
                                onChange={(e)=>{
                                  if (e.target.checked) updateRule(rule.id, { eligibleItemIds: allItemIds });
                                  else updateRule(rule.id, { eligibleItemIds: [] });
                                }}
                              />
                              <span>Select All</span>
                            </label>
                          </div>
                        );
                      })()}
                      <div className="space-y-1 overflow-auto pr-1 flex-1 min-h-0 max-h-[19.8rem] w-full">
                        {(Array.isArray(categories)?categories:[]).map((cat:any) => {
                          const catId = String(cat.category_id || cat.id || cat.name);
                          const items = (Array.isArray(menuItems)?menuItems:[]).filter((it:any) => String(it.category) === cat.name || String(it.category_id) === String(cat.category_id) || String(it.categoryId) === String(catId));
                          const catSelectedCount = items.filter((it:any) => selectedSet.has(String(it.id))).length;
                          const allChecked = items.length>0 && catSelectedCount===items.length;
                          const indeterminate = catSelectedCount>0 && catSelectedCount<items.length;
                          const expanded = exp.has(catId);
                          return (
                            <div key={`rule-${rule.id}-cat-${catId}`} className="border border-gray-300 rounded">
                              <div className="flex items-center justify-between px-3 py-[0.35rem] bg-gray-100">
                                <label className="flex items-center gap-3 text-sm text-gray-800">
                                  <input
                                    type="checkbox"
                                    className="w-5 h-5"
                                    checked={allChecked}
                                    ref={(el)=>{ if (el) (el as any).indeterminate = indeterminate; }}
                                    onChange={(e)=>{
                                      const nextIds = new Set((rule.eligibleItemIds||[]).map(String));
                                      if (e.target.checked) { items.forEach((it:any)=> nextIds.add(String(it.id))); }
                                      else { items.forEach((it:any)=> nextIds.delete(String(it.id))); }
                                      updateRule(rule.id, { eligibleItemIds: Array.from(nextIds) });
                                    }}
                                  />
                                  <span>{cat.name || cat.title}</span>
                                </label>
                                <button
                                  onClick={()=> toggleRuleCat(rule.id, catId)}
                                  className="text-gray-600 text-base w-[2.375rem] h-[2.375rem] flex items-center justify-center rounded hover:bg-gray-200 active:bg-gray-300"
                                  aria-label={expanded ? 'Collapse category' : 'Expand category'}
                                  title={expanded ? 'Collapse' : 'Expand'}
                                >{expanded ? '▾' : '▸'}</button>
                              </div>
                              {expanded && (
                                <div className="px-2 py-1">
                                  <div className="grid grid-cols-1 gap-0.5">
                                    {items.map((it:any) => (
                                      <label key={`rule-${rule.id}-it-${it.id}`} className="flex items-center gap-3 pl-4 pr-2 py-2 min-h-[38px] text-base text-gray-800 rounded hover:bg-gray-50 transition-colors">
                                        <input
                                          type="checkbox"
                                          className="w-5 h-5"
                                          checked={selectedSet.has(String(it.id))}
                                          onChange={(e)=>{
                                            const next = new Set((rule.eligibleItemIds||[]).map(String));
                                            if (e.target.checked) next.add(String(it.id)); else next.delete(String(it.id));
                                            updateRule(rule.id, { eligibleItemIds: Array.from(next) });
                                          }}
                                        />
                                        <span className="truncate">{it.name}</span>
                                      </label>
                                    ))}
                                    {items.length===0 && (
                                      <div className="text-[12px] text-gray-400">No items</div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

                  <div className="flex justify-end items-center">
          <div className="space-x-2">
            {!embedded && (<button onClick={onClose} className="px-3 py-2 text-sm rounded bg-gray-100 text-gray-700 hover:bg-gray-200">Cancel</button>)}
            <button onClick={handleSave} className="px-3 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700">Save</button>
          </div>
        </div>
        </div>

      <DateRangeOverlay
        open={!!rangeForRuleId}
        initialStart={rangeForRuleId ? (localRules.find(r=>r.id===rangeForRuleId)?.startDate||'') : ''}
        initialEnd={rangeForRuleId ? (localRules.find(r=>r.id===rangeForRuleId)?.endDate||'') : ''}
        onClose={()=> setRangeForRuleId(null)}
        onApply={(s,e)=>{ if (!rangeForRuleId) return; updateRule(rangeForRuleId, { startDate: s, endDate: e }); }}
      />
    </div>
  );

  if (embedded) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-[43.2rem] text-base max-h-[32rem] overflow-hidden">
        {header}
        {body}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-[43.2rem] text-base max-h-[32rem] overflow-hidden" onMouseDown={stop as any} onClick={stop as any} onTouchStart={stop as any}>
        {header}
        {body}
      </div>
    </div>
  );
};

export default PromotionRulesModal; 