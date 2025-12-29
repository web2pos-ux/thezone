import React, { useEffect, useMemo, useRef, useState } from 'react';
import { API_URL } from '../../config/constants';
import VirtualKeyboard from '../order/VirtualKeyboard';
import { Keyboard as KeyboardIcon } from 'lucide-react';
import TableSelectionModal from './TableSelectionModal';

// Helpers: digits-only and phone formatting XXX-XXX-XXXX
const onlyDigits = (s: string) => (s || '').replace(/\D/g, '');
const formatPhone = (raw: string) => {
	const d = onlyDigits(raw).slice(0, 10);
	if (d.length <= 3) return d;
	if (d.length <= 6) return `${d.slice(0,3)}-${d.slice(3)}`;
	return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
};

interface ReservationCreateModalProps {
	open: boolean;
	onClose: () => void;
	onCreated?: () => void;
	onTableStatusChanged?: (tableId: number, tableName: string, status: string, customerName?: string) => void;
}

// Very lightweight two-month calendar (current and next month)
const buildMonth = (baseDate: Date) => {
	const year = baseDate.getFullYear();
	const month = baseDate.getMonth();
	const first = new Date(year, month, 1);
	const last = new Date(year, month + 1, 0);
	const days: { date: string; label: string }[] = [];
	for (let d = 1; d <= last.getDate(); d++) {
		const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
		days.push({ date: ds, label: String(d) });
	}
	return { year, month: month + 1, firstWeekday: first.getDay(), days };
};

const ReservationCreateModal: React.FC<ReservationCreateModalProps> = ({ open, onClose, onCreated, onTableStatusChanged }) => {
	const anchorRef = useRef<HTMLDivElement | null>(null);
	const slotModalRef = useRef<HTMLDivElement | null>(null);
	const [slotModalStyle, setSlotModalStyle] = useState<React.CSSProperties>({});
	const [name, setName] = useState<string>('');
	const [phone, setPhone] = useState<string>('');
	const [partySize, setPartySize] = useState<string>('');
	const [date, setDate] = useState<string>('');
	// Time selection: hour (12h), minute, AM/PM
	const [hour12, setHour12] = useState<string>('06');
	const [minute, setMinute] = useState<string>('00');
	const [ampm, setAmpm] = useState<'AM' | 'PM'>('PM');
	const [channel, setChannel] = useState<'Walk-in' | 'Phone' | 'Online'>('Walk-in');
	const [deposit, setDeposit] = useState<string>('');
	const [note, setNote] = useState<string>('');
	const [saving, setSaving] = useState<boolean>(false);
	const [error, setError] = useState<string | null>(null);
	const [successMsg, setSuccessMsg] = useState<string | null>(null);
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
	const [loadingDayReservations, setLoadingDayReservations] = useState<boolean>(false);
	const [reservationsByTime, setReservationsByTime] = useState<Record<string, any[]>>({});
	const [policy, setPolicy] = useState<{ peak_start?: string; peak_end?: string; peak_max_per_slot?: number; normal_max_per_slot?: number; dwell_minutes?: number } | null>(null);
	const [businessHours, setBusinessHours] = useState<Array<{ day_of_week: number; open_time: string; close_time: string; is_open: number }>>([]);
	const [timeSlotsDef, setTimeSlotsDef] = useState<Array<{ time_slot: string; is_available: number; max_reservations: number }> | null>(null);
	const [recents, setRecents] = useState<any[]>([]);
	const [showSlotModal, setShowSlotModal] = useState<boolean>(false); // legacy overlay (unused)
	const [customerHistory, setCustomerHistory] = useState<any[]>([]);
	const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);
	const [showDetailModal, setShowDetailModal] = useState<boolean>(false);
	const [selectedSlotTime, setSelectedSlotTime] = useState<string>('');
    const [cancelledReservations, setCancelledReservations] = useState<Set<string>>(new Set());
    const [confirmModalOpen, setConfirmModalOpen] = useState<boolean>(false);
    const [confirmTarget, setConfirmTarget] = useState<{ id: string; name: string; phone: string } | null>(null);
    const [cancelledLabelMap, setCancelledLabelMap] = useState<Record<string, 'Cancel' | 'No Show'>>({});
    const [reservationStatuses, setReservationStatuses] = useState<Record<string, { status: 'arrived' | 'occupied' | 'hold'; tableId?: number; tableName?: string }>>({});
	// Reschedule (Edit) mode state
	const [rescheduleMode, setRescheduleMode] = useState<boolean>(false);
	const [rescheduleTarget, setRescheduleTarget] = useState<{ id: string; name: string; phone: string; partySize?: number } | null>(null);
    // Drag & Drop state for rescheduling
    const [isDragging, setIsDragging] = useState<boolean>(false);
    const [dragSource, setDragSource] = useState<{ id: string; fromDate: string; fromTime24: string } | null>(null);
    const [reservationTimeLabelMap, setReservationTimeLabelMap] = useState<Record<string, string>>({});
	// Hour view inside slot modal
	const [hourViewHour, setHourViewHour] = useState<string>(''); // 'HH'
	// Lightweight toast
	const [showToast, setShowToast] = useState<boolean>(false);
	const [toastMsg, setToastMsg] = useState<string>('');
	// soft keyboard state
	const [softKbOpen, setSoftKbOpen] = useState<boolean>(false);
	const [softKbTarget, setSoftKbTarget] = useState<'name' | 'phone' | 'party' | 'deposit' | null>(null);
	const kbBottomOffset = 0;
	const [kbLang, setKbLang] = useState<string>('EN');
	// Filters removed per request
	// Wheel-only time selection (no extra time panel)

	// Availability calendar state
	const [availMonthOffset, setAvailMonthOffset] = useState<number>(0);
	
	// Max slots per day setting (2-30)
	const [maxSlotsPerDay, setMaxSlotsPerDay] = useState<number>(() => {
		const saved = localStorage.getItem('reservation_maxSlots');
		return saved ? parseInt(saved, 10) : 10;
	});
	
	// Table selection modal state
	const [showTableSelectionModal, setShowTableSelectionModal] = useState<boolean>(false);
	// Slot dropdown state
	const [showSlotDropdown, setShowSlotDropdown] = useState<boolean>(false);
	const [selectedReservationForTable, setSelectedReservationForTable] = useState<{ id: string; name: string; partySize: number } | null>(null);

	// Availability generator - all days open with configurable max slots
	const availabilityMonth = useMemo(() => {
		const base = new Date();
		base.setMonth(base.getMonth() + availMonthOffset, 1);
		const m = buildMonth(base);
		const enrich = m.days.map(d => {
			// All days are open with user-configured max slots
			return { ...d, slots: maxSlotsPerDay, isOpen: true };
		});
		return { year: base.getFullYear(), month: base.getMonth() + 1, firstWeekday: m.firstWeekday, days: enrich } as any;
	}, [availMonthOffset, maxSlotsPerDay]);

	const today = useMemo(() => {
		const now = new Date();
		return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
	}, []);

	// Today's reservations (flat list)
	const [todayReservations, setTodayReservations] = useState<any[]>([]);
	useEffect(() => {
		if (!open) return;
		let abort = false;
		(async () => {
			try {
				const res = await fetch(`${API_URL}/reservations/reservations?date=${encodeURIComponent(today)}`);
				if (!res.ok) { setTodayReservations([]); return; }
				const list = await res.json();
				if (!abort) setTodayReservations(Array.isArray(list) ? list : []);
			} catch { setTodayReservations([]); }
		})();
		return () => { abort = true; };
	}, [open, today]);

	// Load system settings + recents on open
	useEffect(() => {
		if (!open) return;
		let abort = false;
		(async () => {
			try {
				const res = await fetch(`${API_URL}/reservation-settings/system-settings`);
				if (res.ok) {
					const js = await res.json();
					if (abort) return;
					if (js?.policy) setPolicy(js.policy);
					if (Array.isArray(js?.timeSlots)) setTimeSlotsDef(js.timeSlots);
					if (Array.isArray(js?.businessHours)) setBusinessHours(js.businessHours);
				}
			} catch {}
		})();
		try {
			const raw = localStorage.getItem('reservation_recents');
			if (raw) setRecents(JSON.parse(raw));
		} catch {}
		return () => { abort = true; };
	}, [open]);

	// Return empty array (no mock data - real data only)
	const generateMockDayReservations = (_ds: string) => {
		return [];
	};

	// Load reservations for selected date and group by time (HH:MM)
	useEffect(() => {
		if (!open || !date) return;
		let abort = false;
		(async () => {
			try {
				setLoadingDayReservations(true);
				const res = await fetch(`${API_URL}/reservations/reservations?date=${encodeURIComponent(date)}`);
				let list: any[] = [];
				if (res.ok) {
					list = await res.json();
				}
				// fallback to mock when empty
				if (!Array.isArray(list) || list.length === 0) {
					list = generateMockDayReservations(date);
				}
				if (abort) return;
				const grouped: Record<string, any[]> = {};
				(list || []).forEach((r: any) => {
					const t = String(r?.reservation_time || '').slice(0,5);
					if (!grouped[t]) grouped[t] = [];
					grouped[t].push(r);
				});
				setReservationsByTime(grouped);
			} catch {
				// on error also show mock
				const grouped: Record<string, any[]> = {};
				generateMockDayReservations(date).forEach((r: any) => {
					const t = String(r?.reservation_time || '').slice(0,5);
					if (!grouped[t]) grouped[t] = [];
					grouped[t].push(r);
				});
				setReservationsByTime(grouped);
			} finally {
				setLoadingDayReservations(false);
			}
		})();
		return () => { abort = true; };
	}, [open, date]);

	// Load customer history when phone number changes
	useEffect(() => {
		if (phone && phone.length >= 4) {
			loadCustomerHistory(phone);
		} else {
			setCustomerHistory([]);
		}
	}, [phone]);

	// Position right-docked slot modal like a magnet to the main modal's right edge
    useEffect(() => {
		if (!showSlotModal) return;
		
		try {
			const root = anchorRef?.current;
			if (!root) return;
			const rect = root.getBoundingClientRect();
            // Position modal in center of screen
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const modalWidth = 468;
            const modalHeight = 600;
            
            setSlotModalStyle({ 
				position: 'fixed',
				left: `${(vw - modalWidth) / 2 + 457}px`, 
				top: `${(vh - modalHeight) / 2}px`,
				zIndex: 60
			});
		} catch {}
    }, [showSlotModal, date, availabilityMonth, open]);

	const loadCustomerHistory = async (phoneNumber: string) => {
		try {
			const response = await fetch(`${API_URL}/customer-history?phone=${encodeURIComponent(phoneNumber)}`);
			if (response.ok) {
				const data = await response.json();
				setCustomerHistory(data);
			}
		} catch (error) {
			console.error('Failed to load customer history:', error);
		}
	};

	// Get party size from reservation data (mock implementation)
	const getPartySizeFromReservation = (reservationId: string): number => {
		// Mock data - in real implementation, this would fetch from API
		const mockPartySizes: Record<string, number> = {
			'reservation-1': 4,
			'reservation-2': 2,
			'reservation-3': 6
		};
		return mockPartySizes[reservationId] || 2;
	};

	// Handle table selection for arrived guest
	const handleTableSelect = async (tableId: number, tableName: string) => {
		if (!selectedReservationForTable) return;

		try {
			// Update table status to Occupied
			const response = await fetch(`${API_URL}/table-map/elements/${tableId}/status`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: 'Occupied' })
			});

			if (response.ok) {
				// Update reservation status to 'arrived' with table info
				const reservationId = selectedReservationForTable.id;
				setReservationStatuses(prev => ({
					...prev,
					[reservationId]: {
						status: 'arrived',
						tableId: tableId,
						tableName: tableName
					}
				}));

				// Notify parent component about table status change with reservation name
				if (onTableStatusChanged) {
					onTableStatusChanged(tableId, tableName, 'Occupied', selectedReservationForTable.name);
				}

				// Show success message
				setToastMsg(`Table ${tableName} assigned to ${selectedReservationForTable.name}`);
				setShowToast(true);
				setTimeout(() => setShowToast(false), 3000);

				// Close table selection modal
				setShowTableSelectionModal(false);
				setSelectedReservationForTable(null);
			} else {
				throw new Error('Failed to update table status');
			}
		} catch (error) {
			console.error('Error assigning table:', error);
			setToastMsg('Failed to assign table. Please try again.');
			setShowToast(true);
			setTimeout(() => setShowToast(false), 3000);
		}
	};

	// Handle table status change (Occupied or Hold)
	const handleTableStatusChange = async (tableId: number, tableName: string, status: 'Occupied' | 'Reserved' | 'Hold') => {
		if (!selectedReservationForTable) return;

		try {
			// Update table status in database
			const response = await fetch(`${API_URL}/table-map/elements/${tableId}/status`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: status })
			});

			if (response.ok) {
				const reservationId = selectedReservationForTable.id;
				const newStatus = status === 'Occupied' ? 'occupied' : 'hold';
				
				setReservationStatuses(prev => ({
					...prev,
					[reservationId]: {
						status: newStatus,
						tableId: tableId,
						tableName: tableName
					}
				}));

				// Notify parent component about table status change with reservation name
				if (onTableStatusChanged) {
					onTableStatusChanged(tableId, tableName, status, selectedReservationForTable.name);
				}

				// Close both modals
				setShowTableSelectionModal(false);
				setSelectedReservationForTable(null);
				onClose(); // Close the main Create Reservation modal
			} else {
				console.error('Failed to update table status');
				setToastMsg('Failed to update table status. Please try again.');
				setShowToast(true);
				setTimeout(() => setShowToast(false), 3000);
			}
		} catch (error) {
			console.error('Error updating table status:', error);
			setToastMsg('Failed to update table status. Please try again.');
			setShowToast(true);
			setTimeout(() => setShowToast(false), 3000);
		}
	};

const handleReservationAction = async (action: 'cancel' | 'edit' | 'arrived' | 'rebook' | 'no_show' | 'to_waiting', customerName: string, phoneNumber: string, reservationId?: string) => {
		// Handle cancel action immediately for demo reservations
		if (action === 'cancel' && reservationId) {
			setCancelledReservations(prev => new Set([...Array.from(prev), reservationId]));
			return;
		}

		// Handle no_show similar to cancel (strike-through) and tag
        if (action === 'no_show' && reservationId) {
            setCancelledReservations((prev: Set<string>) => new Set([...Array.from(prev), reservationId]));
            setCancelledLabelMap((prev: Record<string, 'Cancel' | 'No Show'>) => ({ ...prev, [reservationId]: 'No Show' }));
			try { await fetch(`${API_URL}/reservations/${encodeURIComponent(reservationId)}/no-show`, { method: 'PATCH' }); } catch {}
			return;
		}

		// Handle rebook action for demo reservations
        if (action === 'rebook' && reservationId) {
            setCancelledReservations(prev => {
                const newSet = new Set(prev);
                newSet.delete(reservationId);
                return newSet;
            });
            setCancelledLabelMap(prev => {
                const next = { ...(prev || {}) } as Record<string, 'Cancel' | 'No Show'>;
                delete next[reservationId];
                return next;
            });
            return;
        }

		// Handle arrived action - show table selection modal

		// Convert reservation to waiting list (late arrival wants waiting)
		if (action === 'to_waiting' && reservationId) {
			try {
				await fetch(`${API_URL}/waiting-list/from-reservation/${encodeURIComponent(reservationId)}`, { method: 'POST' });
				setSuccessMsg('예약을 웨이팅으로 전환했습니다.');
				return;
			} catch (e:any) {
				setError(String(e?.message || '전환 실패'));
				return;
			}
		}
		if (action === 'arrived' && reservationId) {
			// Get party size from reservation data
			const partySize = getPartySizeFromReservation(reservationId);
			setSelectedReservationForTable({
				id: reservationId,
				name: customerName,
				partySize: partySize
			});
			setShowTableSelectionModal(true);
			return;
		}

		try {
			let response;
			if (action === 'rebook') {
				// Use the new rebook endpoint
				response = await fetch(`${API_URL}/reservations/${reservationId}/rebook`, {
					method: 'PATCH',
					headers: {
						'Content-Type': 'application/json',
					}
				});
			} else {
				response = await fetch(`${API_URL}/reservations/${action}`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						customer_name: customerName,
						phone_number: phoneNumber,
						action: action,
						reservation_id: reservationId,
						timestamp: new Date().toISOString()
					})
				});
			}

			if (response.ok) {
				// Refresh customer history
				if (phoneNumber === phone) {
					loadCustomerHistory(phoneNumber);
				}
			}
		} catch (error) {
			console.error(`Failed to ${action} reservation:`, error);
			setError(`Failed to ${action} reservation`);
		}
	};

// No external time slots UI; time is built from hour/minute/AMPM

	useEffect(() => {
		if (!open) return;
		// initialize defaults when opening
		try {
			setError(null);
			setSaving(false);
			if (!date) setDate(today);
			if (!channel) setChannel('Walk-in');
			// initialize time to nearest 5 minutes
			try {
				const now = new Date();
				const m = now.getMinutes();
				const next5 = Math.ceil(m / 5) * 5;
				const h = now.getHours();
				const isAM = h < 12;
				const h12 = h % 12 === 0 ? 12 : h % 12;
				setHour12(String(h12).padStart(2, '0'));
				setAmpm(isAM ? 'AM' : 'PM');
				setMinute(String(next5 === 60 ? 0 : next5).padStart(2, '0'));
			} catch {}
			// Prefill when reschedule mode is active
			if (rescheduleMode && rescheduleTarget) {
				setName(rescheduleTarget.name || '');
				setPhone(rescheduleTarget.phone || '');
				if (rescheduleTarget.partySize) setPartySize(String(rescheduleTarget.partySize));
			}
		} catch {}
	}, [open, today, rescheduleMode, rescheduleTarget]);

const time24 = useMemo(() => {
		const h12Num = Math.max(1, Math.min(12, Number(hour12) || 12));
		let h24 = h12Num % 12;
		if (ampm === 'PM') h24 += 12;
		const hStr = String(h24).padStart(2, '0');
		const mStr = String(Math.max(0, Math.min(59, Number(minute) || 0))).padStart(2, '0');
		return `${hStr}:${mStr}`;
	}, [hour12, minute, ampm]);

// Remaining capacity for selected time
const maxForSelectedTime = useMemo(() => {
	const def = (timeSlotsDef || []).find(s => String(s.time_slot).slice(0,5) === time24);
	if (def) return def.max_reservations;
	if (policy && time24) {
		const withinPeak = policy.peak_start && policy.peak_end && (time24 >= policy.peak_start && time24 < policy.peak_end);
		return withinPeak ? (policy.peak_max_per_slot || 0) : (policy.normal_max_per_slot || 0);
	}
	return undefined;
}, [timeSlotsDef, policy, time24]);
const existingForSelectedTime = (reservationsByTime[time24] || []).length;
const remainingForSelectedTime = typeof maxForSelectedTime === 'number' ? Math.max(0, maxForSelectedTime - existingForSelectedTime) : undefined;

// Suggested end time based on dwell_minutes policy
const suggestedEnd24 = useMemo(() => {
  try {
    const dwell = Number(policy?.dwell_minutes || 0);
    if (!time24 || !dwell) return '';
    const [hh, mm] = time24.split(':').map(n => Number(n));
    const base = new Date();
    base.setHours(hh, mm, 0, 0);
    base.setMinutes(base.getMinutes() + dwell);
    const H = String(base.getHours()).padStart(2,'0');
    const M = String(base.getMinutes()).padStart(2,'0');
    return `${H}:${M}`;
  } catch { return ''; }
}, [time24, policy]);

const suggestedEndLabel = useMemo(() => {
  if (!suggestedEnd24) return '';
  const [hh, mm] = suggestedEnd24.split(':').map(n => Number(n));
  const isAM = hh < 12;
  const h12 = (hh % 12) === 0 ? 12 : (hh % 12);
  return `${String(h12).padStart(2,'0')}:${String(mm).padStart(2,'0')} ${isAM ? 'AM' : 'PM'}`;
}, [suggestedEnd24]);

// Convert HH:MM to 12h label
const to12hLabel = (time24: string): string => {
  try {
    const [hhS, mmS] = (time24 || '').split(':');
    const hh = Math.max(0, Math.min(23, Number(hhS)));
    const mm = Math.max(0, Math.min(59, Number(mmS)));
    const isAM = hh < 12; const h12 = (hh % 12) === 0 ? 12 : (hh % 12);
    return `${String(h12).padStart(2,'0')}:${String(mm).padStart(2,'0')} ${isAM ? 'AM' : 'PM'}`;
  } catch { return time24; }
};

// Handle drop on a time slot (reschedule)
const handleDropOnTimeSlot = async (targetTime24: string) => {
  try {
    if (!rescheduleMode || !dragSource) return;
    // Check capacity
    const def = (timeSlotsDef || []).find(s => String(s.time_slot).slice(0,5) === targetTime24);
    let max = 0;
    if (def) max = Number(def.max_reservations || 0);
    else if (policy) {
      const pk = policy.peak_start && policy.peak_end && (targetTime24 >= (policy.peak_start||'') && targetTime24 < (policy.peak_end||''));
      max = pk ? Number(policy.peak_max_per_slot||0) : Number(policy.normal_max_per_slot||0);
    }
    const used = (reservationsByTime[targetTime24] || []).length;
    if (max && used >= max) return; // full

    // Optimistic UI updates: adjust counts
    setReservationsByTime(prev => {
      const next: Record<string, any[]> = { ...(prev || {}) };
      const from = dragSource.fromTime24;
      const to = targetTime24;
      if (!next[to]) next[to] = [];
      next[to] = [...next[to], { id: dragSource.id }];
      if (next[from] && next[from].length > 0) next[from] = next[from].slice(0, next[from].length - 1);
      return next;
    });

    // Update label for the dragged reservation row
    setReservationTimeLabelMap(prev => ({ ...(prev || {}), [dragSource.id]: to12hLabel(targetTime24) }));

    // Clear drag state
    setIsDragging(false);
    setDragSource(src => (src ? { ...src, fromTime24: targetTime24 } : src));

    // Show toast for 1s with name and target date/time in English
    try {
      const ds = (date || today);
      const [Y, M, D] = ds.split('-');
      const mmdd = `${Number(M)}/${Number(D)}`;
      const timeLabel = to12hLabel(targetTime24);
      const who = rescheduleTarget?.name || 'Guest';
      setToastMsg(`"${who}" has been rebooked for ${mmdd} ${timeLabel}`);
    } catch {
      setToastMsg('Reservation rescheduled');
    }
    setShowToast(true);
    setTimeout(() => setShowToast(false), 1500);

    // Persist via API (best-effort)
    try {
      await fetch(`${API_URL}/reservations/${encodeURIComponent(dragSource.id)}/reschedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reservation_date: date, reservation_time: targetTime24 })
      });
    } catch {}
  } catch {}
};

const canSave = name.trim().length > 0 && phone.trim().length > 0 && Number(partySize) > 0 && !!date && !!time24 && !saving && (remainingForSelectedTime === undefined || remainingForSelectedTime > 0);

const handleSave = async () => {
		if (!canSave) return;
		setSaving(true);
		setError(null);
		setSuccessMsg(null);
		setFieldErrors({});
		try {
			const fe: Record<string, string> = {};
			if (!name.trim()) fe['name'] = 'Name is required';
			if (!phone.trim()) fe['phone'] = 'Phone is required';
			if (!(Number(partySize) > 0)) fe['party'] = 'Party size must be > 0';
			if (!date) fe['date'] = 'Date required';
			if (!time24) fe['time'] = 'Time required';
			if (Object.keys(fe).length) { setFieldErrors(fe); throw new Error('Please fix highlighted fields'); }

			try {
				const vres = await fetch(`${API_URL}/reservation-settings/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, time: time24, party_size: Number(partySize) }) });
				if (vres.ok) {
					const v = await vres.json();
					if (!v?.isValid) {
						const msg = (v?.errors || []).join(', ') || 'Validation failed';
						throw new Error(msg);
					}
				}
			} catch (ve:any) {
				throw new Error(String(ve?.message || 'Validation failed'));
			}
			const payload: any = {
				customer_name: name.trim(),
				phone_number: phone.trim(),
				reservation_date: date,
				reservation_time: time24,
				party_size: Number(partySize),
				special_requests: JSON.stringify({ channel, deposit: Number(deposit || '0'), note: (note||'') })
			};
			const res = await fetch(`${API_URL}/reservations/reservations`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			if (!res.ok) {
				const msg = await res.text();
				throw new Error(msg || 'Failed to create reservation');
			}
			// Online channel integration placeholder
			if (channel === 'Online') {
				try {
					// TODO: integrate with actual online provider
					// await syncOnlineReservation(payload)
				} catch {}
			}
			if (onCreated) onCreated();
			onClose();
		} catch (e: any) {
			setError(String(e?.message || 'Failed to create reservation'));
		} finally {
			setSaving(false);
		}
	};

	if (!open) return null;

	return (
		<>
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40 p-4">
			<div className="bg-white rounded-lg shadow-xl w-full max-w-[700px] p-4 max-h-[80vh] overflow-y-auto">
                {showToast && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none">
                        <div className="px-5 py-3 rounded-lg bg-black/80 text-white shadow-2xl" style={{ fontSize: 20 }}>
                            {toastMsg}
                        </div>
                    </div>
                )}
				<div className="mb-2">
					<div className="flex items-center justify-between mb-1">
						<h2 className="text-lg font-semibold whitespace-nowrap">Create Reservation</h2>
						<button
							onClick={onClose}
							className="p-4 bg-gray-100 hover:bg-gray-200 rounded-full touch-manipulation"
						>
							<svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					</div>
				</div>

				{/* Main layout: calendar left, slot settings right */}
				<div className="flex gap-4">
					{/* Left: Calendar Section */}
					<div className="flex-1 min-w-0">
						<div className="flex items-center justify-center gap-2 mb-2">
							<button
								onClick={() => setAvailMonthOffset(prev => prev - 1)}
								className="p-3 hover:bg-gray-100 rounded touch-manipulation"
							>
								<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
								</svg>
							</button>
							<span className="text-base font-semibold min-w-[140px] text-center">
								{new Date(availabilityMonth.year, availabilityMonth.month - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
							</span>
							<button
								onClick={() => setAvailMonthOffset(prev => prev + 1)}
								className="p-3 hover:bg-gray-100 rounded touch-manipulation"
							>
								<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
								</svg>
							</button>
						</div>

					{/* Availability calendar with mock slots */}
					<div ref={anchorRef} className="inline-block">
						<div className="flex text-center text-xs font-medium text-gray-600 mb-0.5">
							{['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => <span key={d} className="w-[53px] text-center">{d}</span>)}
						</div>
						<div className="flex flex-wrap gap-[2px]" style={{ width: `${51 * 7 + 6 * 2}px` }}>
							{Array.from({ length: availabilityMonth.firstWeekday }).map((_, i) => (
								<div key={`pad-av-${i}`} className="w-[51px] h-[45px]" />
							))}
								{availabilityMonth.days.map((d: any) => {
									// Single-hue palette (blue) by availability level
									// closed -> gray, full -> darkest blue, many -> dark blue, medium -> mid blue, low -> light blue
									let state: 'closed' | 'full' | 'low' | 'medium' | 'many';
									if (!d.isOpen) state = 'closed';
									else if (d.slots === 0) state = 'full';
									else if (d.slots <= 3) state = 'low';
									else if (d.slots <= 7) state = 'medium';
									else state = 'many';
									const cls = state === 'closed' ? 'bg-gray-600 text-white cursor-not-allowed'
										: state === 'full' ? 'bg-blue-900 text-white cursor-not-allowed'
										: state === 'many' ? 'bg-blue-500 text-white hover:bg-blue-600'
										: state === 'medium' ? 'bg-blue-300 text-blue-900 hover:bg-blue-400'
										: 'bg-blue-100 text-blue-800 hover:bg-blue-200';
								return (
									<button
										key={d.date}
										disabled={!d.isOpen}
								className={`rounded text-sm w-[51px] h-[45px] flex flex-col items-center justify-center ${cls}`}
                                    onClick={() => { 
										setDate(d.date); 
										// Always show slot modal when date is selected
										setShowSlotModal(true);
									}}
									>
								<div className="text-base font-bold leading-tight">{d.label}</div>
								<div className={`text-xs font-normal leading-none ${
									!d.isOpen ? 'text-gray-300' : // closed dates
									state === 'closed' ? 'text-gray-300' : // closed
									state === 'full' ? 'text-white' : // dark blue background
									state === 'many' ? 'text-white' : // dark blue background
									state === 'medium' ? 'text-blue-900' : // light blue background
									'text-blue-800' // lightest blue background
								}`}>{d.isOpen ? `${d.slots}` : 'X'}</div>
									</button>
								);
							})}
							</div>
					</div>

				{/* Today's reservation list under calendar */}
				<div className="mt-2">
					<div className="text-sm font-semibold">Today's Reservations</div>
						<div className="mt-2 border rounded divide-y max-h-64 overflow-auto">
{(todayReservations || []).length === 0 && (
							<div className="px-3 py-2 text-xs text-gray-500">No reservations today.</div>
						)}
						{(todayReservations || [])
							.slice()
							.sort((a:any,b:any)=>{
								const toMin = (t:string) => { const m=t.match(/^(\d{2}):(\d{2})/); if(!m) return 0; return Number(m[1])*60+Number(m[2]); };
								return toMin(String(a?.reservation_time||'')) - toMin(String(b?.reservation_time||''));
							})
							.map((r:any, idx:number)=>{
								const t = String(r.reservation_time||'').slice(0,5);
								const [hh, mm] = t.split(':').map((n:string)=>Number(n));
								const isAM = hh < 12; const h12 = (hh%12)===0?12:(hh%12);
								const tl = `${String(h12).padStart(2,'0')}:${String(mm).padStart(2,'0')} ${isAM?'AM':'PM'}`;
								return (
									<div key={idx} className="px-3 py-1 flex items-center justify-between">
										<div className="text-sm font-medium">{tl}</div>
										<div className="text-sm text-gray-700 truncate">
											{r.customer_name || 'Guest'} • {r.phone_number || ''} • {r.party_size || ''}
										</div>
									</div>
								);
							})}
					</div>
				</div>
				</div>

					{/* Right: Slot Settings Panel */}
					<div className="w-[290px] flex-shrink-0 bg-gray-50 rounded-lg p-3 border border-gray-200">
						<div className="text-sm font-semibold text-gray-700 mb-2">⚙️ Slot Settings</div>
						
						<div className="mb-2 relative">
							<label className="block text-xs text-gray-500 mb-1">Max Slots Per Day</label>
							{/* Custom dropdown with 5x6 grid */}
							<button
								onClick={() => setShowSlotDropdown(!showSlotDropdown)}
								className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-semibold text-center bg-white hover:bg-gray-50 flex items-center justify-between"
							>
								<span>{maxSlotsPerDay}</span>
								<svg className={`w-4 h-4 transition-transform ${showSlotDropdown ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
								</svg>
							</button>
							{showSlotDropdown && (
								<div className="absolute top-full right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-2 z-50">
									<div className="grid grid-cols-6 gap-[2px]">
										{Array.from({ length: 30 }, (_, i) => i + 1).map((num) => (
											<button
												key={num}
												onClick={() => {
													setMaxSlotsPerDay(num);
													localStorage.setItem('reservation_maxSlots', String(num));
													setShowSlotDropdown(false);
												}}
												className={`w-[40px] h-[40px] rounded text-base font-semibold transition-colors ${
													maxSlotsPerDay === num
														? 'bg-blue-600 text-white'
														: 'bg-gray-100 text-gray-700 hover:bg-blue-100'
												}`}
											>
												{num}
											</button>
										))}
									</div>
								</div>
							)}
						</div>
						
						<div className="mt-3 pt-2 border-t border-gray-200">
							<div className="text-xs font-medium text-gray-600 mb-1">Color Guide</div>
							<div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs">
								<div className="flex items-center gap-1">
									<div className="w-3 h-3 rounded bg-blue-500"></div>
									<span>Many</span>
								</div>
								<div className="flex items-center gap-1">
									<div className="w-3 h-3 rounded bg-blue-300"></div>
									<span>Medium</span>
								</div>
								<div className="flex items-center gap-1">
									<div className="w-3 h-3 rounded bg-blue-100 border border-blue-200"></div>
									<span>Low</span>
								</div>
								<div className="flex items-center gap-1">
									<div className="w-3 h-3 rounded bg-blue-900"></div>
									<span>Full</span>
								</div>
								<div className="flex items-center gap-1">
									<div className="w-3 h-3 rounded bg-gray-600"></div>
									<span>Closed</span>
								</div>
							</div>
						</div>
					</div>
				</div>

				{/* Day reservations timeline removed by request */}

				{/* Inline time slot list removed - using separate modal instead */}

				{/* Bottom time wheel removed per request */}

		{/* Time Slot Availability Modal (docked to right of main modal) */}
		{showSlotModal && (
			<div className="absolute z-[60]"
				ref={slotModalRef}
				style={slotModalStyle}
			>
				<div className="bg-white rounded-lg shadow-xl w-[468px] p-4 max-h-[80vh] overflow-y-auto">
					<div className="flex items-center justify-between mb-3">
						<div className="text-sm font-semibold">Time Slot Availability • {date}</div>
						<button 
							className="p-3 bg-gray-100 hover:bg-gray-200 rounded-full touch-manipulation"
							onClick={() => setShowSlotModal(false)}
						>
							<svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					</div>
					<div className="mb-0.5">
						<span className="text-sm text-gray-600">Numbers show available tables</span>
					</div>
					<div className="mb-2" />
					<div className="border rounded p-2">
						{(() => {
							// Build 15-min slots within business hours and render 4-columns per hour row
							const dow = (new Date(date || today).getDay());
							const bh = businessHours.find(b => Number(b.day_of_week) === dow && Number(b.is_open) === 1);
							const open = (bh?.open_time) || '11:00';
							const close = (bh?.close_time) || '21:00';
							const toMins = (s:string) => { const [H,M] = s.split(':').map(n=>Number(n)); return H*60+M; };
							const fromMins = (m:number) => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
							const startM = toMins(open), endM = toMins(close);
							const startHour = Math.floor(startM/60), endHour = Math.floor((endM-1)/60);
							const hours:number[] = []; for (let h=startHour; h<=endHour; h++) hours.push(h);
							const isEnabled = (t:string) => { const m = toMins(t); return m>=startM && m<endM; };
							const computeLeft = (t:string) => {
								const max = (() => {
									const def = (timeSlotsDef || []).find(s => String(s.time_slot).slice(0,5) === t);
									if (def) return def.max_reservations;
									if (policy) {
										const pk = policy.peak_start && policy.peak_end && (t >= policy.peak_start && t < policy.peak_end);
										return pk ? (policy.peak_max_per_slot||0) : (policy.normal_max_per_slot||0);
									}
									return 0;
								})();
								const used = (reservationsByTime[t] || []).length;
								return Math.max(0, max - used);
							};
							return (
								<div className="space-y-0.5">
									{/* Column header: 00/15/30/45 minutes */}
									<div className="grid grid-cols-5 gap-x-0.5 gap-y-0 items-center px-0.5 py-1 bg-gray-100 rounded-lg">
										<div className="text-base font-bold px-3 py-2 whitespace-nowrap text-gray-800">Time</div>
										<div className="text-xs font-bold text-gray-700 text-center">00Min</div>
										<div className="text-xs font-bold text-gray-700 text-center">15Min</div>
										<div className="text-xs font-bold text-gray-700 text-center">30Min</div>
										<div className="text-xs font-bold text-gray-700 text-center">45Min</div>
									</div>
									{hours.map(h => {
										const label = `${String(h).padStart(2,'0')}:00`;
										const mins = [0,15,30,45];
										return (
									<div key={h} className={`grid grid-cols-5 gap-x-0.5 gap-y-0 items-center ${h % 2 === 1 ? 'bg-blue-50' : 'bg-orange-50'}`}>
										<div className="flex items-center justify-between text-lg font-bold px-1 py-1 whitespace-nowrap text-gray-800">
											<span className="cursor-pointer select-none" onClick={() => setHourViewHour(String(h).padStart(2,'0'))}>{label}</span>
                                            <button className="ml-2 inline-flex items-center justify-center text-xs font-semibold px-2 py-1 min-h-[32px] rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
												onClick={() => setHourViewHour(String(h).padStart(2,'0'))}
											>
												View
											</button>
										</div>
												{mins.map(m => {
													const t = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
													const enabled = isEnabled(t);
                                                    if (!enabled) return <div key={m} className="h-12 bg-gray-100 rounded flex items-center justify-center"><span className="text-gray-400 text-xs">Closed</span></div>;
													const left = computeLeft(t);
													const full = left <= 0;
												return (
                                                <div
                                                    key={m}
                                                    className="flex items-center justify-between px-1 py-0 min-h-[12px] w-full"
                                                    onDragOver={(e) => { if (!full) e.preventDefault(); }}
                                                    onDrop={(e) => { if (!full) { handleDropOnTimeSlot(t); } }}
                                                >
										<div className="whitespace-nowrap text-right w-14 mr-1.5 flex items-center justify-end">
														<span className="tabular-nums text-base font-semibold inline-block w-[2ch] text-right">{left}</span>
													</div>
                                                    {full ? (
                                                    <span className="inline-flex items-center justify-center text-sm px-2.5 py-1.5 rounded bg-red-100 text-red-700 min-h-[32px] min-w-[40px]">Full</span>
                                                    ) : (
													<button className="inline-flex items-center justify-center text-sm font-bold px-2.5 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 min-h-[32px] min-w-[40px]" onClick={() => { setSelectedSlotTime(t); setShowDetailModal(true); }}>
														Add
													</button>
												)}
													</div>
												);
												})}
											</div>
										);
									})}
								</div>
							);
						})()}
					</div>
				</div>
			</div>
		)}

		{/* Hour View Overlay Modal */}
		{hourViewHour && (
			<div className="fixed inset-0 z-[95] flex items-center justify-center bg-black bg-opacity-60">
				<div className="bg-white rounded-lg shadow-xl w-full max-w-md p-4 max-h-[70vh] overflow-y-auto">
					<div className="flex items-center justify-between mb-2">
						<div className="text-base font-semibold">Reservations • {date} {hourViewHour}:00</div>
						<button className="p-3 bg-gray-100 hover:bg-gray-200 rounded-full touch-manipulation" onClick={() => setHourViewHour('')}>
							<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					</div>
					<div className="max-h-[55vh] overflow-auto divide-y">
						{[0,15,30,45].map((min) => {
							const t = `${hourViewHour}:${String(min).padStart(2,'0')}`;
							const list = reservationsByTime[t] || [];
							return (
								<div key={min} className="py-2">
									<div className="text-sm font-bold text-gray-700 mb-1">{hourViewHour}:{String(min).padStart(2,'0')}</div>
                                    {(list.length === 0 ? ([
                                        { customer_name: 'Guest A', phone_number: '010-1234-5678', party_size: 2 },
                                        { customer_name: 'Guest B', phone_number: '010-9876-5432', party_size: 4 }
                                    ]) : list).map((r: any, i: number) => (
                                        <div key={i} className="text-sm text-gray-800">
                                            {r.customer_name || 'Guest'} • {r.phone_number || ''} {r.party_size ? `• #${r.party_size}` : ''}
                                        </div>
                                    ))}
							</div>
						);
						})}
					</div>
				</div>
			</div>
		)}

		{/* Customer History Modal */}
		{showHistoryModal && (
			<div className="fixed inset-0 z-[80] flex items-center justify-center bg-black bg-opacity-40">
				<div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-4 max-h-[80vh] overflow-y-auto">
					<div className="flex items-center justify-between mb-3">
						<div className="text-lg font-semibold">Customer History</div>
						<button className="text-gray-500 hover:text-gray-700" onClick={() => setShowHistoryModal(false)}>Close</button>
					</div>
					<div className="space-y-2">
						{customerHistory.length === 0 ? (
							<div className="text-gray-500 text-center py-4">No history found</div>
						) : (
							customerHistory.map((history: any, index: number) => (
								<div key={index} className="border rounded p-3 bg-gray-50">
									<div className="flex justify-between items-start">
										<div>
											<div className="font-medium">{history.customer_name}</div>
											<div className="text-sm text-gray-600">{history.phone_number}</div>
											<div className="text-sm text-gray-500">
												{new Date(history.reservation_date).toLocaleDateString()} at {history.reservation_time}
											</div>
										</div>
										<div className="text-right">
											<span className={`px-2 py-1 rounded text-xs font-medium ${
												history.status === 'cancelled' ? 'bg-red-100 text-red-700' :
												history.status === 'no_show' ? 'bg-orange-100 text-orange-700' :
												'bg-green-100 text-green-700'
											}`}>
												{history.status === 'cancelled' ? 'Cancelled' :
												 history.status === 'no_show' ? 'No Show' : 'Completed'}
											</span>
										</div>
									</div>
									{history.note && (
										<div className="mt-2 text-sm text-gray-600 italic">"{history.note}"</div>
									)}
								</div>
							))
						)}
					</div>
				</div>
			</div>
		)}

		{/* Confirm Cancel / No-Show Modal */}
		{confirmModalOpen && (
			<div className="fixed inset-0 z-[85] flex items-center justify-center bg-black bg-opacity-40">
				<div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-4">
					<div className="flex items-center justify-between mb-2">
						<div className="text-base font-semibold">Select action</div>
						<button className="p-3 bg-gray-100 hover:bg-gray-200 rounded-full touch-manipulation" onClick={() => { setConfirmModalOpen(false); setConfirmTarget(null); }}>
							<svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					</div>
					<div className="text-sm text-gray-700 mb-4">
						{confirmTarget?.name} • {confirmTarget?.phone}
					</div>
					<div className="flex items-center justify-end gap-2">
                        <button className="px-3 py-2 rounded bg-red-100 text-red-700 hover:bg-red-200" onClick={() => { if (confirmTarget) { setCancelledLabelMap((prev: Record<string, 'Cancel' | 'No Show'>) => ({ ...prev, [confirmTarget.id]: 'Cancel' })); handleReservationAction('cancel', confirmTarget.name, confirmTarget.phone, confirmTarget.id); } setConfirmModalOpen(false); }}>Cancel</button>
						<button className="px-3 py-2 rounded bg-orange-100 text-orange-700 hover:bg-orange-200" onClick={() => { if (confirmTarget) { handleReservationAction('no_show', confirmTarget.name, confirmTarget.phone, confirmTarget.id); } setConfirmModalOpen(false); }}>No Show</button>
					</div>
				</div>
			</div>
		)}

		{/* Detail Reservation Modal (per-slot input) */}
		{showDetailModal && (
			<div className="fixed inset-0 z-[70] flex items-center justify-center bg-black bg-opacity-50">
				<div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-5">
					<div className="flex items-center justify-between mb-3">
						<div className="text-sm font-semibold">{rescheduleMode ? 'Reschedule' : 'Add'} • {date} {selectedSlotTime}</div>
						<button className="text-gray-500 hover:text-gray-700" onClick={() => { setShowDetailModal(false); setRescheduleMode(false); setRescheduleTarget(null); }}>Back</button>
					</div>
					{/* Row 1: Name (4), Phone (4), Party Size (2) */}
					<div className="grid grid-cols-10 gap-2">
						<div className="col-span-4">
							<label className="block text-sm font-medium mb-1">Name</label>
							<div className="relative">
								<input className="w-full border rounded px-3 py-2 pr-12" value={name} onChange={e=>setName(e.target.value)} onFocus={() => { if (softKbOpen) setSoftKbTarget('name'); }} placeholder="Customer name" />
								<button className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-700" title="Open Keyboard" onClick={() => { setSoftKbTarget('name'); setSoftKbOpen(true); }}>
									<KeyboardIcon size={22} />
								</button>
							</div>
						</div>
						<div className="col-span-4">
							<label className="block text-sm font-medium mb-1">Phone</label>
							<div className="relative">
								<input className="w-full border rounded px-3 py-2 pr-12" value={phone} onChange={e=>setPhone(formatPhone(e.target.value))} onFocus={() => { if (softKbOpen) setSoftKbTarget('phone'); }} placeholder="Contact number" />
								<button className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-700" title="Open Keyboard" onClick={() => { setSoftKbTarget('phone'); setSoftKbOpen(true); }}>
									<KeyboardIcon size={22} />
								</button>
							</div>
						</div>
						<div className="col-span-2">
							<label className="block text-sm font-medium mb-1">Party Size</label>
							<div className="relative">
								<input className="w-full border rounded px-3 py-2 pr-12" value={partySize} onChange={e=>setPartySize(e.target.value.replace(/[^0-9]/g,''))} onFocus={() => { if (softKbOpen) setSoftKbTarget('party'); }} placeholder="2" />
								<button className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-700" title="Open Keyboard" onClick={() => { setSoftKbTarget('party'); setSoftKbOpen(true); }}>
									<KeyboardIcon size={22} />
								</button>
							</div>
						</div>
					</div>
					{/* Row 2: Deposit, Channel segmented */}
					<div className="mt-3 flex gap-3">
						<div className="w-[32%]">
							<label className="block text-sm font-medium mb-1">Deposit</label>
							<div className="relative">
								<input className="w-full border rounded px-3 py-2 pr-12" value={deposit} onChange={e=>setDeposit(e.target.value.replace(/[^0-9.]/g,''))} onFocus={() => { if (softKbOpen) setSoftKbTarget('deposit'); }} placeholder="0" />
								<button className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-700" title="Open Keyboard" onClick={() => { setSoftKbTarget('deposit'); setSoftKbOpen(true); }}>
									<KeyboardIcon size={22} />
								</button>
							</div>
						</div>
						<div className="w-[68%]">
							<label className="block text-sm font-medium mb-1">Channel</label>
							<div className="flex gap-2">
								{(['Walk-in','Phone','Online'] as const).map((c) => (
									<button key={c} onClick={()=>setChannel(c)} className={`px-4 py-2 rounded border ${channel===c ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-100 hover:bg-gray-200 text-gray-800 border-gray-300'}`}>{c}</button>
								))}
							</div>
						</div>
					</div>
					<div className="mt-4 flex items-center justify-end gap-2">
						<button className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300" onClick={()=>{ setShowDetailModal(false); setRescheduleMode(false); setRescheduleTarget(null); }}>Cancel</button>
						<button className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700" onClick={async ()=>{
							try {
								const payload:any = { customer_name:name.trim(), phone_number:phone.trim(), reservation_date:date, reservation_time:selectedSlotTime, party_size:Number(partySize), special_requests: JSON.stringify({ channel, deposit: Number(deposit||'0') }) };
								const res = await fetch(`${API_URL}/reservations/reservations`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
								if (!res.ok) throw new Error(await res.text()||'Failed');
								setShowDetailModal(false);
								setRescheduleMode(false);
								setRescheduleTarget(null);
							} catch (e:any) {
								alert(String(e?.message||'Failed to save'));
							}
						}}>Save</button>
					</div>
				</div>
			</div>
		)}

		{/* Soft Virtual Keyboard */}
		{softKbOpen && (
			<VirtualKeyboard
				open={softKbOpen}
				title={''}
				bottomOffsetPx={kbBottomOffset}
				zIndex={2147483647}
				languages={['EN']}
				currentLanguage={kbLang}
				onToggleLanguage={(next)=>setKbLang(next)}
				displayText={softKbTarget==='name'?name:softKbTarget==='phone'?phone:softKbTarget==='party'?partySize:softKbTarget==='deposit'?deposit:''}
				onRequestClose={() => { setSoftKbOpen(false); setSoftKbTarget(null); }}
				onType={(k)=>{
					if (softKbTarget==='name') setName(prev=>`${prev||''}${k}`);
					if (softKbTarget==='phone') setPhone(prev=>formatPhone(`${prev||''}${k}`));
					if (softKbTarget==='party') setPartySize(prev=>`${(prev||'').replace(/[^0-9]/g,'')}${k}`.replace(/[^0-9]/g,''));
					if (softKbTarget==='deposit') setDeposit(prev=>{
						const next=`${prev||''}${k}`;
						const sanitized=next.replace(/[^0-9.]/g,'');
						const dots=(sanitized.match(/\./g)||[]).length;
						return dots>1 ? (prev||'') : sanitized;
					});
				}}
				onBackspace={()=>{
					if (softKbTarget==='name') setName(prev=>prev?prev.slice(0,-1):'');
					if (softKbTarget==='phone') setPhone(prev=>{
						const d = onlyDigits(prev||'');
						return formatPhone(d ? d.slice(0, -1) : '');
					});
					if (softKbTarget==='party') setPartySize(prev=>prev?String(prev).slice(0,-1):'');
					if (softKbTarget==='deposit') setDeposit(prev=>prev?String(prev).slice(0,-1):'');
				}}
				onClear={()=>{
					if (softKbTarget==='name') setName('');
					if (softKbTarget==='phone') setPhone('');
					if (softKbTarget==='party') setPartySize('');
					if (softKbTarget==='deposit') setDeposit('');
				}}
			/>
		)}
				<div className="mt-3 flex items-end justify-end gap-0">
						{error && <div className="text-sm text-red-600 mr-auto">{error}</div>}
						{successMsg && <div className="text-sm text-green-700 mr-auto">{successMsg}</div>}
				</div>
			</div>
		</div>

		{/* Table Selection Modal */}
		<TableSelectionModal
			isOpen={showTableSelectionModal}
			onClose={() => {
				setShowTableSelectionModal(false);
				setSelectedReservationForTable(null);
			}}
			onTableSelect={handleTableSelect}
			onTableStatusChange={handleTableStatusChange}
			partySize={selectedReservationForTable?.partySize || 1}
			customerName={selectedReservationForTable?.name || 'Guest'}
		/>
		</>
	);
};

export default ReservationCreateModal;


