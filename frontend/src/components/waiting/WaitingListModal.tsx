import React, { useEffect, useRef, useState } from 'react';
import { API_URL } from '../../config/constants';
import VirtualKeyboard from '../order/VirtualKeyboard';
import {
  PAY_NEO,
  PAY_NEO_CANVAS,
  PAY_KEYPAD_KEY,
  NEO_MODAL_BTN_PRESS,
  NEO_PREP_TIME_BTN_PRESS,
  NEO_COLOR_BTN_PRESS,
  NEO_COLOR_BTN_PRESS_SNAP,
  NEO_MODAL_BTN_PRESS_SNAP,
  NEO_PREP_TIME_BTN_PRESS_SNAP,
} from '../../utils/softNeumorphic';

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
  onTableStatusChanged?: (tableId: number, tableName: string, status: string, customerName?: string) => void;
}

/** Add — PaymentModal과 동일 계열 액센트(볼록 유지 + 그라데이션) */
const addButtonNeo: React.CSSProperties = {
  ...PAY_NEO.raised,
  background: 'linear-gradient(145deg, #3b82f6, #2563eb)',
  color: '#fff',
  boxShadow: '5px 5px 12px rgba(37,99,235,0.35), -3px -3px 10px rgba(255,255,255,0.25)',
};

const inputNeo =
  'w-full min-h-[52px] rounded-xl px-3.5 py-2.5 border-0 text-base text-gray-800 placeholder:text-gray-500 outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50';

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
  const [showSmsNotice, setShowSmsNotice] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (message: string) => {
    if (toastTimerRef.current != null) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToastMessage(message);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 3000);
  };

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

  useEffect(() => {
    if (!open) {
      setShowSmsNotice(false);
      setToastMessage(null);
      if (toastTimerRef.current != null) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    }
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
      showToast('Canceled');
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

  const handleNotify = () => {
    setShowSmsNotice(true);
  };

  /** Assign Table: 부모에 테이블 배정 플로우만 넘기고, 목록에서는 즉시 제거 → 아래 행이 순번·자리를 채움 */
  const handleAssign = (entry: WaitingEntry) => {
    showToast('Assigned');
    const id = entry.id;
    setEntries((prev) => prev.filter((e) => e.id !== id));
    setBaseWaitMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setLocalStartMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (onAssignTable) onAssignTable(entry);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2">
      <div
        className="flex max-h-[min(94vh,940px)] w-[820px] max-w-[86vw] flex-col overflow-hidden pointer-events-auto"
        style={PAY_NEO.modalShell}
      >
        <div className="flex shrink-0 items-center justify-between px-5 py-3.5" style={{ background: PAY_NEO_CANVAS }}>
          <h2 className="text-xl font-bold text-gray-800">Waiting List</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            className={`flex h-12 w-12 shrink-0 touch-manipulation items-center justify-center rounded-xl border-[3px] border-red-500 transition-all hover:brightness-[1.03] ${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS}`}
            style={{ ...PAY_NEO.raised }}
          >
            <svg className="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); if (canAdd) handleAdd(); }}
          className="mx-4 mt-4 flex shrink-0 flex-col gap-3.5 p-3"
          style={{ background: PAY_NEO_CANVAS }}
        >
          {/* Row 1: Name : Phone : Guest = 4 : 4 : 2 */}
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-[4fr_4fr_2fr]">
            <div className="min-w-0">
              <label htmlFor="wl-customer-name" className="mb-1.5 block text-sm font-semibold text-slate-600">
                Customer Name
              </label>
              <div className="relative min-w-0" style={PAY_NEO.inset}>
                <input
                  id="wl-customer-name"
                  value={name}
                  onChange={e=>setName(smartCapitalize(e.target.value))}
                  onFocus={()=>setActiveField('name')}
                  placeholder="Enter name"
                  className={`${inputNeo} pr-12 bg-transparent`}
                />
                <button
                  type="button"
                  className="absolute right-2.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center text-gray-600 touch-manipulation border-0 transition-all active:brightness-95"
                  style={PAY_NEO.keyPad}
                  onClick={() => setShowKb(true)}
                  title="Virtual keyboard"
                  aria-label="Virtual keyboard"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="6" width="20" height="12" rx="2" ry="2"></rect>
                    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12"></path>
                  </svg>
                </button>
              </div>
            </div>
            <div className="min-w-0">
              <label htmlFor="wl-phone" className="mb-1.5 block text-sm font-semibold text-slate-600">
                Phone
              </label>
              <div className="min-w-0" style={PAY_NEO.inset}>
                <input
                  id="wl-phone"
                  value={phoneFormatted}
                  onChange={e=> setPhoneDigits(e.target.value.replace(/\D/g,'').slice(0,10))}
                  onFocus={()=>setActiveField('phone')}
                  placeholder="(000) 000-0000"
                  className={`${inputNeo} w-full bg-transparent`}
                />
              </div>
            </div>
            <div className="min-w-0">
              <label htmlFor="wl-guests" className="mb-1.5 block text-sm font-semibold text-slate-600">
                Guests
              </label>
              <div className="min-w-0" style={PAY_NEO.inset}>
                <input
                  id="wl-guests"
                  value={party}
                  onChange={e=>setParty(e.target.value.replace(/\D/g, ''))}
                  onFocus={()=>setActiveField('party')}
                  placeholder="Required (1+)"
                  inputMode="numeric"
                  className={`${inputNeo} w-full bg-transparent`}
                />
              </div>
            </div>
          </div>
          {/* Row 2: Notes (inset) + Add */}
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <label htmlFor="wl-notes" className="mb-1.5 block text-sm font-semibold text-slate-600">
                Notes
              </label>
              <div className="min-w-0" style={PAY_NEO.inset}>
                <input
                  id="wl-notes"
                  value={notes}
                  onChange={e=>setNotes(e.target.value)}
                  onFocus={()=>setActiveField('notes')}
                  placeholder="Optional"
                  className={`${inputNeo} w-full bg-transparent`}
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={!canAdd}
              title={canAdd ? 'Add to waiting list' : 'Enter customer name and guest count (1+)'}
              className={`min-h-[52px] w-full shrink-0 rounded-[12px] border-0 px-6 text-base font-semibold transition-all touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40 disabled:pointer-events-none disabled:opacity-45 disabled:translate-y-0 disabled:scale-100 disabled:brightness-100 sm:min-w-[140px] sm:w-auto ${NEO_COLOR_BTN_PRESS}`}
              style={addButtonNeo}
            >
              Add
            </button>
          </div>
        </form>

        <div
          className="min-h-0 flex-1 overflow-auto px-4 py-2.5"
          style={{ maxHeight: 'calc(5 * 80px + 56px)', background: PAY_NEO_CANVAS }}
        >
          <div className="overflow-hidden p-2.5" style={PAY_NEO.inset}>
            <table className="w-full table-fixed border-separate border-spacing-0 text-base">
              <thead>
                <tr className="text-left text-xs font-bold uppercase tracking-wide text-gray-600">
                  <th className="w-[5%] rounded-tl-[10px] px-2.5 py-3 text-center" style={{ background: 'rgba(255,255,255,0.28)' }}>No.</th>
                  <th className="w-[20%] px-2.5 py-3" style={{ background: 'rgba(255,255,255,0.28)' }}>Name</th>
                  <th className="w-[20%] px-2.5 py-3" style={{ background: 'rgba(255,255,255,0.28)' }}>Phone</th>
                  <th className="w-[12%] px-2.5 py-3 text-center" style={{ background: 'rgba(255,255,255,0.28)' }}>Status</th>
                  <th className="w-[43%] rounded-tr-[10px] px-2.5 py-3 text-center" style={{ background: 'rgba(255,255,255,0.28)' }}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-400/25">
              {loading && (
                <tr><td className="p-7 text-center text-base text-gray-600" colSpan={5}>Loading...</td></tr>
              )}
              {!loading && entries.length === 0 && (
                <tr><td className="p-7 text-center text-base text-gray-600" colSpan={5}>No customers waiting</td></tr>
              )}
              {!loading && entries.map((e, idx) => {
                const base = baseWaitMap[e.id] ?? 0;
                const delta = Math.max(0, Math.floor((Date.now() - fetchedAtMs) / 1000));
                const elapsed = base + delta;
                return (
                  <tr
                    key={e.id}
                    className={`transition-colors hover:bg-white/22 ${idx % 2 === 0 ? 'bg-white/[0.07]' : 'bg-slate-600/[0.055]'}`}
                  >
                    <td className="px-2.5 py-3 text-center align-top text-base font-semibold text-gray-800">{idx + 1}</td>
                    <td className="px-2.5 py-3 align-top">
                      <div className="truncate font-semibold text-gray-900" title={e.customer_name}>{e.customer_name}</div>
                      <div className="mt-0.5 text-sm text-gray-600">
                        Guests <span className="font-medium text-gray-800">{e.party_size}</span>
                        <span className="mx-1.5 text-gray-400">·</span>
                        <span className="font-mono tabular-nums text-gray-700">{fmtDuration(elapsed)}</span>
                      </div>
                    </td>
                    <td className="px-2.5 py-3 align-top">
                      <div className="truncate font-medium text-gray-800" title={formatPhone(String(e.phone_number || '').replace(/\D/g, ''))}>
                        {formatPhone(String(e.phone_number || '').replace(/\D/g, ''))}
                      </div>
                      {e.notes ? (
                        <div className="mt-0.5 truncate text-sm text-gray-600" title={e.notes}>{e.notes}</div>
                      ) : null}
                    </td>
                    <td className="px-2.5 py-3 text-center align-top text-base font-medium capitalize text-gray-800">{e.status}</td>
                    <td className="px-1.5 py-2.5 align-middle">
                      <div className="flex flex-nowrap items-center justify-center gap-1.5 overflow-x-auto">
                        <button
                          type="button"
                          className={`min-h-[42px] shrink-0 whitespace-nowrap rounded-[10px] border-0 px-3 py-2 text-[13px] font-bold leading-tight text-gray-800 touch-manipulation select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40 ${NEO_MODAL_BTN_PRESS_SNAP} ${NEO_PREP_TIME_BTN_PRESS_SNAP}`}
                          style={PAY_KEYPAD_KEY}
                          onClick={() => handleAssign(e)}
                        >
                          Assign Table
                        </button>
                        <button
                          type="button"
                          className={`min-h-[42px] shrink-0 whitespace-nowrap rounded-[10px] border-0 px-3 py-2 text-[13px] font-bold leading-tight text-gray-800 touch-manipulation select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40 ${NEO_MODAL_BTN_PRESS_SNAP} ${NEO_PREP_TIME_BTN_PRESS_SNAP}`}
                          style={PAY_KEYPAD_KEY}
                          title="Send SMS"
                          onClick={() => handleNotify()}
                        >
                          Send SMS
                        </button>
                        <button
                          type="button"
                          className={`min-h-[42px] shrink-0 whitespace-nowrap rounded-[10px] border-0 px-3 py-2 text-[13px] font-bold leading-tight text-red-800 touch-manipulation select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40 ${NEO_MODAL_BTN_PRESS_SNAP} ${NEO_PREP_TIME_BTN_PRESS_SNAP}`}
                          style={PAY_KEYPAD_KEY}
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
        </div>

        <div className="shrink-0 px-4 pb-3.5 pt-2.5" style={{ background: PAY_NEO_CANVAS }}>
          <div className="mb-2.5 p-3.5" style={PAY_NEO.raised}>
            <div className="mb-2.5 flex items-center justify-between px-0.5">
              <div className="text-base font-bold text-gray-800">Processed Results</div>
              <div className="text-sm text-gray-600">Cancelled / Seated / SMS 2+ times</div>
            </div>
            <div className="max-h-[228px] overflow-auto p-2.5" style={PAY_NEO.inset}>
              <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
                <thead className="sticky top-0 z-[1] text-left text-xs font-bold uppercase tracking-wide text-gray-600">
                  <tr>
                    <th className="w-[30%] rounded-tl-[10px] px-2.5 py-2.5" style={{ background: 'rgba(255,255,255,0.28)' }}>Name</th>
                    <th className="w-[20%] px-2.5 py-2.5" style={{ background: 'rgba(255,255,255,0.28)' }}>Phone</th>
                    <th className="w-[15%] px-2.5 py-2.5 text-center" style={{ background: 'rgba(255,255,255,0.28)' }}>Status</th>
                    <th className="w-[20%] px-2.5 py-2.5" style={{ background: 'rgba(255,255,255,0.28)' }}>Time</th>
                    <th className="w-[15%] rounded-tr-[10px] px-2.5 py-2.5 text-center" style={{ background: 'rgba(255,255,255,0.28)' }}>SMS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-400/20">
                  {processed.length === 0 && (
                    <tr><td className="p-5 text-center text-sm text-gray-500" colSpan={5}>No processed records</td></tr>
                  )}
                  {processed.map((e, pIdx) => {
                    const time = e.seated_at || e.cancelled_at || e.notified_at || e.joined_at;
                    return (
                      <tr
                        key={`p-${e.id}`}
                        className={`transition-colors hover:bg-white/28 ${pIdx % 2 === 0 ? 'bg-white/[0.06]' : 'bg-slate-600/[0.05]'}`}
                      >
                        <td className="truncate px-2.5 py-2.5 text-sm text-gray-800" title={e.customer_name}>{e.customer_name}</td>
                        <td className="truncate px-2.5 py-2.5 text-sm text-gray-800" title={String(e.phone_number||'')}>{String(e.phone_number||'')}</td>
                        <td className="px-2.5 py-2.5 text-center text-sm text-gray-800">{e.status}</td>
                        <td className="truncate px-2.5 py-2.5 text-sm text-gray-700">{time?.toString().replace('T',' ').replace('Z','')}</td>
                        <td className="px-2.5 py-2.5 text-center text-sm text-gray-800">{e.sms_count ?? 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      {toastMessage && (
        <div className="pointer-events-none fixed inset-0 z-[130] flex items-center justify-center p-4">
          <div
            className="min-w-[220px] max-w-[90vw] rounded-2xl border-0 px-10 py-6 shadow-2xl"
            style={PAY_NEO.modalShell}
            role="status"
            aria-live="polite"
          >
            <p className="text-center text-lg font-bold tracking-wide text-slate-800">{toastMessage}</p>
          </div>
        </div>
      )}
      {showSmsNotice && (
        <div
          className="pointer-events-auto fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="wl-sms-notice-title"
          onClick={() => setShowSmsNotice(false)}
        >
          <div
            className="w-full max-w-[360px] overflow-hidden rounded-2xl border-0 shadow-2xl"
            style={PAY_NEO.modalShell}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 pt-7 pb-2 text-center" style={{ background: PAY_NEO_CANVAS }}>
              <p id="wl-sms-notice-title" className="text-[15px] font-semibold leading-snug text-slate-800">
                SMS isn&apos;t connected. Nothing was sent.
              </p>
            </div>
            <div className="flex justify-center px-6 pb-6 pt-4" style={{ background: PAY_NEO_CANVAS }}>
              <button
                type="button"
                onClick={() => setShowSmsNotice(false)}
                className={`min-h-[44px] min-w-[120px] rounded-[12px] border-0 px-6 text-sm font-bold text-white touch-manipulation select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 ${NEO_COLOR_BTN_PRESS_SNAP}`}
                style={addButtonNeo}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
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


