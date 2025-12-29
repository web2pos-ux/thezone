import React, { useEffect, useMemo, useRef, useState } from 'react';
import { API_URL } from '../../config/constants';
import VirtualKeyboard from '../order/VirtualKeyboard';

interface WaitingEntry {
  id: number;
  customer_name: string;
  phone_number?: string;
  party_size: number;
  notes?: string;
  status: 'waiting' | 'notified' | 'seated' | 'cancelled';
  table_number?: string;
  reservation_id?: number;
  joined_at: string;
  notified_at?: string;
  seated_at?: string;
  cancelled_at?: string;
  waiting_seconds?: number;
  sms_count?: number;
}

interface WaitingListModalProps {
  open: boolean;
  onClose: () => void;
  onAssignTable?: (entry: WaitingEntry) => void;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const fmtDuration = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  // Display as HH:MM starting at 00:00
  return `${pad2(h)}:${pad2(m)}`;
};

const WaitingListModal: React.FC<WaitingListModalProps> = ({ open, onClose, onAssignTable }) => {
  const [entries, setEntries] = useState<WaitingEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [processed, setProcessed] = useState<WaitingEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phoneDigits, setPhoneDigits] = useState(''); // store only digits
  const [party, setParty] = useState('');
  const [notes, setNotes] = useState('');
  const [tick, setTick] = useState(0); // for elapsed time render
  const [showKb, setShowKb] = useState(false);
  const [kbLang, setKbLang] = useState<'EN'|'KR'|'NUM'>('EN');
  const [activeField, setActiveField] = useState<'name'|'phone'|'party'|'notes'>('name');
  // Local fallback start time for entries without joined_at
  const [localStartMap, setLocalStartMap] = useState<Record<number, number>>({});
  // Base waiting seconds from server to avoid Date.parse issues
  const [baseWaitMap, setBaseWaitMap] = useState<Record<number, number>>({});
  const [fetchedAtMs, setFetchedAtMs] = useState<number>(Date.now());

  // phone formatting helpers
  const formatPhone = (digits: string) => {
    const d = digits.replace(/\D/g, '').slice(0, 10);
    if (!d) return '';
    if (d.length <= 3) return `(${d}`;
    if (d.length <= 6) return `(${d.slice(0,3)})${d.slice(3)}`;
    return `(${d.slice(0,3)})${d.slice(3,6)}-${d.slice(6)}`;
  };
  const phoneFormatted = formatPhone(phoneDigits);

  // smart capitalize: first english letter at start or after space -> uppercase
  const smartCapitalize = (s: string) => s.replace(/\b([a-z])/g, (m, p1) => p1.toUpperCase());

  console.log('WaitingListModal render:', { open });

  // Persist elapsed time across screen changes: we rely on server joined_at and client tick
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchEntries = async () => {
    setLoading(true);
    setError(null);
    try {
      const ts = Date.now();
      const [resActive, resProcessed] = await Promise.all([
        fetch(`${API_URL}/waiting-list?_=${ts}`, { cache: 'no-store' }),
        fetch(`${API_URL}/waiting-list/processed?_=${ts}`, { cache: 'no-store' })
      ]);
      if (!resActive.ok) throw new Error(await resActive.text());
      if (!resProcessed.ok) throw new Error(await resProcessed.text());
      const data: WaitingEntry[] = await resActive.json();
      const processedData: WaitingEntry[] = await resProcessed.json();
      setEntries(data || []);
      setProcessed(processedData || []);
      // Capture base waiting seconds and fetch time for smooth accumulation on client
      setFetchedAtMs(Date.now());
      setBaseWaitMap(() => {
        const map: Record<number, number> = {};
        (data || []).forEach((e) => {
          // Prefer server computed seconds; fallback to safe join time diff
          if (typeof e.waiting_seconds === 'number' && isFinite(e.waiting_seconds)) {
            map[e.id] = Math.max(0, Math.floor(e.waiting_seconds));
          } else {
            const jsDate = e.joined_at ? new Date((e.joined_at as any).toString().replace(' ', 'T')) : null;
            const ts = jsDate && !isNaN(jsDate.getTime()) ? jsDate.getTime() : Date.now();
            map[e.id] = Math.max(0, Math.floor((Date.now() - ts) / 1000));
          }
        });
        return map;
      });
      // Capture local start time for entries missing joined_at
      try {
        const list: any[] = Array.isArray(data) ? data : [];
        setLocalStartMap(prev => {
          const next = { ...prev };
          list.forEach((e: any) => {
            if (!e?.joined_at && typeof e?.id === 'number' && next[e.id] === undefined) {
              next[e.id] = Date.now();
            }
          });
          return next;
        });
      } catch {}
    } catch (e: any) {
      setError(String(e?.message || 'Failed to load waiting list'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) fetchEntries();
  }, [open]);

  const canAdd = name.trim() && Number(party) > 0;
  const handleAdd = async () => {
    if (!canAdd) return;
    try {
      const res = await fetch(`${API_URL}/waiting-list`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_name: name.trim(), phone_number: formatPhone(phoneDigits), party_size: Number(party), notes })
      });
      if (!res.ok) throw new Error(await res.text());
      const created: WaitingEntry = await res.json();
      // Optimistic add to active list
      setEntries(prev => Array.isArray(prev) ? [...prev, created] : [created]);
      // Reset inputs
      setName(''); setPhoneDigits(''); setParty(''); setNotes('');
      // Sync with server shortly after
      setTimeout(() => { fetchEntries(); }, 150);
    } catch (e: any) {
      alert(String(e?.message || 'Failed to add'));
    }
  };

  const handleCancel = async (id: number) => {
    try {
      const res = await fetch(`${API_URL}/waiting-list/${id}/cancel`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      await fetchEntries();
    } catch (e: any) {
      alert(String(e?.message || 'Failed to cancel'));
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete?')) return;
    try {
      const res = await fetch(`${API_URL}/waiting-list/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      await fetchEntries();
    } catch (e: any) {
      alert(String(e?.message || 'Failed to delete'));
    }
  };

  const handleNotify = async (id: number) => {
    try {
      const res = await fetch(`${API_URL}/waiting-list/${id}/notify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Your table is ready. Please come to the counter.' }) });
      if (!res.ok) throw new Error(await res.text());
      await fetchEntries();
    } catch (e: any) {
      alert(String(e?.message || 'Failed to send SMS'));
    }
  };

  const handleAssign = async (entry: WaitingEntry) => {
    if (onAssignTable) onAssignTable(entry);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[660px] max-w-[72vw] bg-white rounded-lg shadow-xl overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between">
          <div className="text-lg font-bold">Waiting List</div>
          <button onClick={onClose} aria-label="Close" title="Close" className="w-11 h-11 flex items-center justify-center border rounded-full text-gray-700 hover:bg-gray-100 text-lg">×</button>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); if (canAdd) handleAdd(); }}
          className="p-4 grid gap-2 items-stretch w-full"
          style={{ display: 'grid', gridTemplateColumns: '23fr 23fr 10fr 30fr 14fr' }}
        >
          <div className="relative">
            <input
              value={name}
              onChange={e=>setName(smartCapitalize(e.target.value))}
              onFocus={()=>setActiveField('name')}
              placeholder="Customer Name"
              className="w-full h-full border rounded px-2 pr-10"
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-800"
              onClick={() => setShowKb(true)}
              title="Virtual keyboard"
              aria-label="Virtual keyboard"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="6" width="20" height="12" rx="2" ry="2"></rect>
                <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12"></path>
              </svg>
            </button>
          </div>
          <input
            value={phoneFormatted}
            onChange={e=> setPhoneDigits(e.target.value.replace(/\D/g,'').slice(0,10))}
            onFocus={()=>setActiveField('phone')}
            placeholder="Phone Number"
            className="border rounded px-2 h-full w-full"
          />
          <input value={party} onChange={e=>setParty(e.target.value)} onFocus={()=>setActiveField('party')} placeholder="Guests" className="border rounded px-2 h-full w-full" />
          <input value={notes} onChange={e=>setNotes(e.target.value)} onFocus={()=>setActiveField('notes')} placeholder="Notes" className="border rounded px-2 h-full w-full" />
          <button type="submit" disabled={!canAdd} className="bg-blue-600 text-white rounded px-6 py-3 h-full w-full disabled:opacity-50">Add</button>
        </form>

        <div className="px-4 pb-2 overflow-auto" style={{ maxHeight: 'calc(5 * 48px + 38px)' }}>
          <table className="w-full text-sm border table-fixed">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-2 border text-center" style={{ width: '5%' }}>No.</th>
                <th className="p-2 border" style={{ width: '22%' }}>Name</th>
                <th className="p-2 border" style={{ width: '22%' }}>Phone</th>
                <th className="p-2 border" style={{ width: '14%' }}>Status</th>
                <th className="p-2 border" style={{ width: '37%' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td className="p-4 text-center" colSpan={4}>Loading...</td></tr>
              )}
              {!loading && entries.length === 0 && (
                <tr><td className="p-4 text-center" colSpan={5}>No customers waiting</td></tr>
              )}
              {!loading && entries.map((e, idx) => {
                // Accumulate based on server-provided waiting_seconds + client delta
                const base = baseWaitMap[e.id] ?? 0;
                const delta = Math.max(0, Math.floor((Date.now() - fetchedAtMs) / 1000));
                const elapsed = base + delta;
                return (
                  <tr key={e.id} className="odd:bg-white even:bg-gray-50">
                    {/* Row number */}
                    <td className="px-2 border text-center" style={{ width: '5%', paddingTop: '2px', paddingBottom: '2px' }}>{idx + 1}</td>
                    {/* Name + subline (Guests, Wait Time) */}
                    <td className="px-2 border" style={{ width: '22%', paddingTop: '2px', paddingBottom: '2px' }}>
                      <div className="font-semibold text-base">{e.customer_name}</div>
                      <div className="text-sm text-gray-600 flex items-center gap-6">
                        <span>{e.party_size}</span>
                        <span className="font-mono">{fmtDuration(elapsed)}</span>
                      </div>
                    </td>
                    {/* Phone + subline (Notes) */}
                    <td className="px-2 border" style={{ width: '22%', paddingTop: '2px', paddingBottom: '2px' }}>
                      <div className="font-semibold text-base">{formatPhone(String(e.phone_number||'').replace(/\D/g,''))}</div>
                      <div className="text-sm text-gray-600 truncate">{e.notes || ''}</div>
                    </td>
                    <td className="px-2 border text-center font-semibold text-base" style={{ width: '14%', paddingTop: '2px', paddingBottom: '2px' }}>{e.status}</td>
                    <td className="px-2 border" style={{ width: '37%', paddingTop: '2px', paddingBottom: '2px' }}>
                      <div className="flex gap-3 justify-center">
                        <button
                          className="w-[61px] h-[45px] px-1 py-1 border rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200 text-xs font-medium flex items-center justify-center text-center"
                          onClick={() => handleAssign(e)}
                        >
                          Assign Table
                        </button>
                        <button
                          className="w-[61px] h-[45px] px-1 py-1 border rounded-lg bg-green-50 hover:bg-green-100 text-green-700 border-green-200 text-xs font-medium flex items-center justify-center text-center"
                          onClick={() => handleNotify(e.id)}
                        >
                          Send SMS
                        </button>
                        <button
                          className="w-[61px] h-[45px] px-1 py-1 border rounded-lg bg-red-50 hover:bg-red-100 text-red-700 border-red-200 text-xs font-medium flex items-center justify-center text-center"
                          onClick={() => handleCancel(e.id)}
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Divider */}
        <div className="px-4"><div className="h-[1px] bg-gray-300 my-2" /></div>
        {/* Processed results section */}
        <div className="px-4 pb-4 overflow-auto" style={{ maxHeight: 180 }}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold text-gray-700">Processed Results</div>
            <div className="text-xs text-gray-500">Cancelled / Seated / SMS 2+ times</div>
          </div>
          <table className="w-full text-xs border table-fixed">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-2 border" style={{ width: '30%' }}>Name</th>
                <th className="p-2 border" style={{ width: '20%' }}>Phone</th>
                <th className="p-2 border text-center" style={{ width: '15%' }}>Status</th>
                <th className="p-2 border" style={{ width: '20%' }}>Time</th>
                <th className="p-2 border text-center" style={{ width: '15%' }}>SMS</th>
              </tr>
            </thead>
            <tbody>
              {processed.length === 0 && (
                <tr><td className="p-3 text-center text-gray-500" colSpan={5}>No processed records</td></tr>
              )}
              {processed.map((e) => {
                const time = e.seated_at || e.cancelled_at || e.notified_at || e.joined_at;
                return (
                  <tr key={`p-${e.id}`} className="odd:bg-white even:bg-gray-50">
                    <td className="px-2 py-1 border truncate" title={e.customer_name}>{e.customer_name}</td>
                    <td className="px-2 py-1 border truncate" title={String(e.phone_number||'')}>{String(e.phone_number||'')}</td>
                    <td className="px-2 py-1 border text-center">{e.status}</td>
                    <td className="px-2 py-1 border truncate">{time?.toString().replace('T',' ').replace('Z','')}</td>
                    <td className="px-2 py-1 border text-center">{e.sms_count ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {showKb && (
        <VirtualKeyboard
          open={showKb}
          title="Virtual Keyboard"
          bottomOffsetPx={0}
          zIndex={2147483646}
          languages={['EN']}
          currentLanguage={kbLang}
          onToggleLanguage={(next:any)=>setKbLang(next)}
          displayText={activeField==='name'?name: activeField==='phone'?phoneFormatted: activeField==='party'?party: notes}
          onRequestClose={() => setShowKb(false)}
          onType={(k:string)=> {
            if (activeField==='name') setName(prev => smartCapitalize(`${prev||''}${k}`));
            else if (activeField==='phone') setPhoneDigits(prev => (prev + k.replace(/\D/g,'')).slice(0,10));
            else if (activeField==='party') setParty(prev => `${prev||''}${k.replace(/[^0-9]/g,'')}`);
            else setNotes(prev => `${prev||''}${k}`);
          }}
          onBackspace={()=> {
            if (activeField==='name') setName(prev => prev ? prev.slice(0,-1) : '');
            else if (activeField==='phone') setPhoneDigits(prev => prev ? prev.slice(0,-1) : '');
            else if (activeField==='party') setParty(prev => prev ? prev.slice(0,-1) : '');
            else setNotes(prev => prev ? prev.slice(0,-1) : '');
          }}
          onClear={()=> {
            if (activeField==='name') setName('');
            else if (activeField==='phone') setPhoneDigits('');
            else if (activeField==='party') setParty('');
            else setNotes('');
          }}
        />
      )}
    </div>
  );
};

export default WaitingListModal;


