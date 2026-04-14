import React, { useEffect, useMemo, useRef, useState } from 'react';
import { API_URL } from '../../config/constants';
import VirtualKeyboard from '../order/VirtualKeyboard';
import { Keyboard as KeyboardIcon } from 'lucide-react';
import TableSelectionModal from './TableSelectionModal';
import {
	PAY_NEO,
	PAY_NEO_CANVAS,
	PAY_NEO_PRIMARY_BLUE,
	PAY_KEYPAD_KEY,
	NEO_MODAL_BTN_PRESS_SNAP,
	NEO_PREP_TIME_BTN_PRESS_SNAP,
	NEO_COLOR_BTN_PRESS_SNAP,
} from '../../utils/softNeumorphic';

/** Reservation 모달 전용 — 눌림 오목이 지연 없이 바로 보이도록 SNAP 클래스 사용 */
const NEO_MODAL_BTN_PRESS = NEO_MODAL_BTN_PRESS_SNAP;
const NEO_PREP_TIME_BTN_PRESS = NEO_PREP_TIME_BTN_PRESS_SNAP;
const NEO_COLOR_BTN_PRESS = NEO_COLOR_BTN_PRESS_SNAP;

// Auto-capitalize first letter and first letter after space
const autoCapitalizeName = (s: string): string => {
	if (!s) return s;
	return s.replace(/(^|\s)([a-z])/g, (_, space, char) => space + char.toUpperCase());
};

// Party size → tables needed: 1~5 = 1 table, 6~9 = 2, 10~13 = 3, ...
const calcTablesNeeded = (partySize: number): number => {
	if (!partySize || partySize <= 0) return 1;
	if (partySize <= 5) return 1;
	return 1 + Math.ceil((partySize - 5) / 4);
};

// Party size dropdown options (2~30) with table count label
const PARTY_SIZE_OPTIONS = Array.from({ length: 29 }, (_, i) => {
	const size = i + 2;
	const tables = calcTablesNeeded(size);
	return { value: String(size), label: `${size} guests — ${tables} table${tables > 1 ? 's' : ''}` };
});

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
	onTableStatusChanged?: (tableId: number, tableName: string, status: string, customerName?: string, reservationTime?: string, partySize?: number) => void;
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
	const [softKbTarget, setSoftKbTarget] = useState<'name' | 'phone' | 'party' | 'deposit' | 'tl_name' | 'tl_phone' | 'tl_party' | 'tl_deposit' | null>(null);
	const kbBottomOffset = 0;
	const [kbLang, setKbLang] = useState<string>('EN');
	// Filters removed per request
	// Wheel-only time selection (no extra time panel)

	// Tab state
	const [activeTab, setActiveTab] = useState<'create' | 'checkin' | 'manage'>('create');

	// Availability calendar state
	const [availMonthOffset, setAvailMonthOffset] = useState<number>(0);
	
	// Monthly reservation counts (date -> count)
	const [monthReservationCounts, setMonthReservationCounts] = useState<Record<string, number>>({});
	
	// Max slots per day setting (2-30)
	const [maxSlotsPerDay, setMaxSlotsPerDay] = useState<number>(() => {
		const saved = localStorage.getItem('reservation_maxSlots');
		return saved ? parseInt(saved, 10) : 10;
	});
	
	// Table selection modal state
	const [showTableSelectionModal, setShowTableSelectionModal] = useState<boolean>(false);
	const [slotViewMode, setSlotViewMode] = useState<'grid' | 'timeline'>('timeline');
	const [showTimelineForm, setShowTimelineForm] = useState<boolean>(false);
	const [tlFormName, setTlFormName] = useState('');
	const [tlFormPhone, setTlFormPhone] = useState('');
	const [tlFormParty, setTlFormParty] = useState('');
	const [tlFormHour, setTlFormHour] = useState('06');
	const [tlFormMinute, setTlFormMinute] = useState('00');
	const [tlFormAmpm, setTlFormAmpm] = useState<'AM' | 'PM'>('PM');
	const [tlFormDeposit, setTlFormDeposit] = useState('');
	const [tlFormChannel, setTlFormChannel] = useState<'Walk-in' | 'Phone' | 'Online'>('Walk-in');
	const [tlFormSaving, setTlFormSaving] = useState(false);
	const [tlFormError, setTlFormError] = useState<string | null>(null);
	// Slot save states
	const [savingSlots, setSavingSlots] = useState<boolean>(false);
	const [slotsSaved, setSlotsSaved] = useState<boolean>(false);
	const [selectedReservationForTable, setSelectedReservationForTable] = useState<{ id: string; name: string; partySize: number; tablesNeeded?: number; tableIndex?: number; reservationTime?: string } | null>(null);
	// Track how many tables have been assigned per reservation ID
	const [tableAssignmentCount, setTableAssignmentCount] = useState<Record<string, number>>({});
	// Track assigned table names per reservation ID (for display on bars)
	const [assignedTableNames, setAssignedTableNames] = useState<Record<string, string[]>>({});

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

	// Fetch reservation counts for the visible calendar month
	useEffect(() => {
		if (!open) return;
		let abort = false;
		const base = new Date();
		base.setMonth(base.getMonth() + availMonthOffset, 1);
		const year = base.getFullYear();
		const month = base.getMonth();
		const firstDay = `${year}-${String(month + 1).padStart(2, '0')}-01`;
		const lastDate = new Date(year, month + 1, 0);
		const lastDay = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDate.getDate()).padStart(2, '0')}`;
		(async () => {
			try {
				const res = await fetch(`${API_URL}/reservations/reservations?start_date=${encodeURIComponent(firstDay)}&end_date=${encodeURIComponent(lastDay)}`);
				if (!res.ok || abort) return;
				const list = await res.json();
				if (abort) return;
				const counts: Record<string, number> = {};
				(Array.isArray(list) ? list : []).forEach((r: any) => {
					if (r.status === 'cancelled' || r.status === 'no_show') return; // exclude cancelled/no-show
					const d = String(r.reservation_date || '').slice(0, 10);
					counts[d] = (counts[d] || 0) + 1;
				});
				setMonthReservationCounts(counts);
			} catch {
				if (!abort) setMonthReservationCounts({});
			}
		})();
		return () => { abort = true; };
	}, [open, availMonthOffset]);

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
					if (js?.policy) {
						setPolicy(js.policy);
						// Sync maxSlotsPerDay from backend policy
						const policyMax = Math.max(js.policy.normal_max_per_slot || 0, js.policy.peak_max_per_slot || 0);
						if (policyMax > 0) {
							setMaxSlotsPerDay(policyMax);
							localStorage.setItem('reservation_maxSlots', String(policyMax));
						}
					}
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

	// Auto no-show: 예약 시간 30분 경과 시 자동 No Show 처리 (1분마다 체크)
	useEffect(() => {
		if (!open) return;
		const runAutoNoShow = async () => {
			try {
				const res = await fetch(`${API_URL}/reservations/auto-noshow`, { method: 'PATCH' });
				if (res.ok) {
					const data = await res.json();
					if (data.changes > 0) {
						// Refresh today's reservations
						try {
							const todayRes = await fetch(`${API_URL}/reservations/reservations?date=${encodeURIComponent(today)}`);
							if (todayRes.ok) {
								const list = await todayRes.json();
								setTodayReservations(Array.isArray(list) ? list : []);
							}
						} catch {}
						// Refresh selected date reservations
						if (date) {
							try {
								const dateRes = await fetch(`${API_URL}/reservations/reservations?date=${encodeURIComponent(date)}`);
								if (dateRes.ok) {
									const list = await dateRes.json();
									const grouped: Record<string, any[]> = {};
									(Array.isArray(list) ? list : []).forEach((r: any) => {
										const t = String(r?.reservation_time || '').slice(0, 5);
										if (!grouped[t]) grouped[t] = [];
										grouped[t].push(r);
									});
									setReservationsByTime(grouped);
								}
							} catch {}
						}
					}
				}
			} catch {}
		};
		runAutoNoShow(); // 모달 열 때 즉시 1회 실행
		const interval = setInterval(runAutoNoShow, 60000); // 1분마다 체크
		return () => clearInterval(interval);
	}, [open, today, date]);

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

	// Position slot modal: timeline = centered full-width; grid = docked right of main modal
    useEffect(() => {
		if (!showSlotModal) return;
		
		try {
			const root = anchorRef?.current;
			if (!root) return;
			const rect = root.getBoundingClientRect();
            const vw = window.innerWidth;
            const vh = window.innerHeight;

            if (slotViewMode === 'timeline') {
				const modalWidth = Math.min(1035, vw - 20);
				const modalHeight = Math.min(vh * 0.95, vh - 20);
				const leftPos = Math.max(10, (vw - modalWidth) / 2);
				const topPos = Math.max(10, Math.min((vh - modalHeight) / 2, vh - modalHeight - 10));
				setSlotModalStyle({
					position: 'fixed',
					left: `${leftPos}px`,
					top: `${topPos}px`,
					width: `${modalWidth}px`,
					zIndex: 60
				});
            } else {
				const modalWidth = Math.min(538, vw - 20);
				const modalHeight = 690;
				let leftPos = rect.right + 8 - 35;
				if (leftPos + modalWidth > vw - 10) {
					leftPos = Math.max(10, vw - modalWidth - 10);
				}
				const topPos = Math.max(10, Math.min((vh - modalHeight) / 2, vh - modalHeight - 10));
				setSlotModalStyle({
					position: 'fixed',
					left: `${leftPos}px`,
					top: `${topPos}px`,
					width: `${modalWidth}px`,
					zIndex: 60
				});
            }
		} catch {}
    }, [showSlotModal, date, availabilityMonth, open, slotViewMode]);

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
			const response = await fetch(`${API_URL}/table-map/elements/${tableId}/status`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: 'Reserved' })
			});

			if (response.ok) {
				const reservationId = selectedReservationForTable.id;
				const tablesNeeded = selectedReservationForTable.tablesNeeded || 1;

				setReservationStatuses(prev => ({
					...prev,
					[reservationId]: {
						status: 'arrived',
						tableId: tableId,
						tableName: tableName
					}
				}));

				if (onTableStatusChanged) {
					onTableStatusChanged(tableId, tableName, 'Reserved', selectedReservationForTable.name, selectedReservationForTable.reservationTime, selectedReservationForTable.partySize);
				}

				const newCount = (tableAssignmentCount[reservationId] || 0) + 1;
				setTableAssignmentCount(prev => ({ ...prev, [reservationId]: newCount }));
				setAssignedTableNames(prev => ({ ...prev, [reservationId]: [...(prev[reservationId] || []), tableName] }));

				setShowTableSelectionModal(false);
				setSelectedReservationForTable(null);

				if (newCount >= tablesNeeded) {
					setToastMsg(`All ${tablesNeeded} tables assigned to ${selectedReservationForTable.name}`);
					setShowToast(true);
					setTimeout(() => setShowToast(false), 3000);
					setShowSlotModal(false);
					setTableAssignmentCount(prev => { const next = { ...prev }; delete next[reservationId]; return next; });
				} else {
					setToastMsg(`Table ${tableName} assigned (${newCount}/${tablesNeeded}) — select next table`);
					setShowToast(true);
					setTimeout(() => setShowToast(false), 3000);
				}
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
			const response = await fetch(`${API_URL}/table-map/elements/${tableId}/status`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: status })
			});

			if (response.ok) {
				const reservationId = selectedReservationForTable.id;
				const tablesNeeded = selectedReservationForTable.tablesNeeded || 1;
				const newStatus = status === 'Occupied' ? 'occupied' : status === 'Reserved' ? 'arrived' : 'hold';
				
				setReservationStatuses(prev => ({
					...prev,
					[reservationId]: {
						status: newStatus,
						tableId: tableId,
						tableName: tableName
					}
				}));

				if (onTableStatusChanged) {
					onTableStatusChanged(tableId, tableName, status, selectedReservationForTable.name, selectedReservationForTable.reservationTime, selectedReservationForTable.partySize);
				}

				const newCount = (tableAssignmentCount[reservationId] || 0) + 1;
				setTableAssignmentCount(prev => ({ ...prev, [reservationId]: newCount }));
				setAssignedTableNames(prev => ({ ...prev, [reservationId]: [...(prev[reservationId] || []), tableName] }));

				setShowTableSelectionModal(false);
				setSelectedReservationForTable(null);

				if (newCount >= tablesNeeded) {
					setToastMsg(`All ${tablesNeeded} tables assigned to ${selectedReservationForTable.name}`);
					setShowToast(true);
					setTimeout(() => setShowToast(false), 3000);
					setShowSlotModal(false);
					setTableAssignmentCount(prev => { const next = { ...prev }; delete next[reservationId]; return next; });
				} else {
					setToastMsg(`Table ${tableName} assigned (${newCount}/${tablesNeeded}) — select next table`);
					setShowToast(true);
					setTimeout(() => setShowToast(false), 3000);
				}
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
			const partySize = getPartySizeFromReservation(reservationId);
			const tablesNeeded = calcTablesNeeded(partySize);
			setSelectedReservationForTable({
				id: reservationId,
				name: customerName,
				partySize: partySize,
				tablesNeeded
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

	// Auto-focus Name input when detail modal opens (once)
	useEffect(() => {
		if (!showDetailModal) return;
		const timer = setTimeout(() => {
			const el = document.getElementById('detail-modal-name-input') as HTMLInputElement | null;
			if (el) { el.focus(); setSoftKbTarget('name'); setSoftKbOpen(true); }
		}, 150);
		return () => clearTimeout(timer);
	}, [showDetailModal]);

	// Auto-focus Name input when timeline form opens (once)
	useEffect(() => {
		if (!showTimelineForm) return;
		const timer = setTimeout(() => {
			const el = document.getElementById('timeline-form-name-input') as HTMLInputElement | null;
			if (el) el.focus();
		}, 150);
		return () => clearTimeout(timer);
	}, [showTimelineForm]);

const time24 = useMemo(() => {
		const h12Num = Math.max(1, Math.min(12, Number(hour12) || 12));
		let h24 = h12Num % 12;
		if (ampm === 'PM') h24 += 12;
		const hStr = String(h24).padStart(2, '0');
		const mStr = String(Math.max(0, Math.min(59, Number(minute) || 0))).padStart(2, '0');
		return `${hStr}:${mStr}`;
	}, [hour12, minute, ampm]);

// Remaining capacity for selected time - 단일 Max Slots Per Day 값 사용
const maxForSelectedTime = useMemo(() => {
	return maxSlotsPerDay;
}, [maxSlotsPerDay]);
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
    // Check capacity - 단일 Max Slots Per Day 값 사용
    const max = maxSlotsPerDay;
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

	const handleTimelineFormSave = async () => {
		setTlFormError(null);
		const h12 = Math.max(1, Math.min(12, Number(tlFormHour) || 12));
		let h24 = h12 % 12;
		if (tlFormAmpm === 'PM') h24 += 12;
		const formTime24 = `${String(h24).padStart(2, '0')}:${String(Math.max(0, Math.min(59, Number(tlFormMinute) || 0))).padStart(2, '0')}`;
		if (!tlFormName.trim() || !tlFormPhone.trim() || !(Number(tlFormParty) > 0)) {
			setTlFormError('Name, Phone, Party Size are required');
			return;
		}
		setTlFormSaving(true);
		try {
			const payload = {
				customer_name: tlFormName.trim(),
				phone_number: tlFormPhone.trim(),
				reservation_date: date,
				reservation_time: formTime24,
				party_size: Number(tlFormParty),
				special_requests: JSON.stringify({ channel: tlFormChannel, deposit: Number(tlFormDeposit || '0'), note: '' })
			};
			const res = await fetch(`${API_URL}/reservations/reservations`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			if (!res.ok) throw new Error(await res.text() || 'Failed');
			setShowTimelineForm(false);
			setTlFormName(''); setTlFormPhone(''); setTlFormParty(''); setTlFormDeposit('');
			setTlFormHour('06'); setTlFormMinute('00'); setTlFormAmpm('PM'); setTlFormChannel('Walk-in');
			const listRes = await fetch(`${API_URL}/reservations/reservations?date=${encodeURIComponent(date)}`);
			if (listRes.ok) {
				const list = await listRes.json();
				const grouped: Record<string, any[]> = {};
				(list || []).forEach((r: any) => { const t = String(r?.reservation_time || '').slice(0, 5); if (!grouped[t]) grouped[t] = []; grouped[t].push(r); });
				setReservationsByTime(grouped);
			}
			if (onCreated) onCreated();
		} catch (e: any) {
			setTlFormError(String(e?.message || 'Failed to create reservation'));
		} finally {
			setTlFormSaving(false);
		}
	};

	if (!open) return null;

	return (
		<>
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40 p-4">
			<div
				className="flex w-[580px] flex-col border-0 p-4"
				style={{ marginLeft: '-40px', height: '80vh', ...PAY_NEO.modalShell }}
			>
                {showToast && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none">
                        <div className="px-5 py-3 rounded-lg bg-black/80 text-white shadow-2xl" style={{ fontSize: 20 }}>
                            {toastMsg}
                        </div>
                    </div>
                )}
				<div className="mb-2 relative">
					<div className="flex items-center justify-center mb-1 h-12">
						<h2 className="text-lg font-semibold whitespace-nowrap">Reservation</h2>
						<button
							type="button"
							onClick={onClose}
							className={`absolute z-[55] flex h-12 w-12 touch-manipulation select-none items-center justify-center rounded-full border-[3px] border-red-500 hover:brightness-[1.03] ${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS}`}
							style={{ ...PAY_NEO.raised, right: '-5px', top: 'calc(50% - 25px)', transform: 'translateY(-50%)' }}
						>
							<svg className="h-5 w-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					</div>
					{/* Tab buttons — PAY_NEO key / primary */}
					<div className="flex gap-1.5 pb-0" style={{ borderBottom: '1px solid rgba(148,163,184,0.35)' }}>
						{([
							{ key: 'create' as const, label: '📅 Create', desc: 'New Reservation' },
							{ key: 'checkin' as const, label: '🪑 Check-in', desc: 'Assign Table' },
							{ key: 'manage' as const, label: '⚙️ Manage', desc: 'Cancel / Edit' },
						]).map(tab => (
							<button
								type="button"
								key={tab.key}
								onClick={() => setActiveTab(tab.key)}
								className={`flex-1 rounded-t-[12px] border-0 px-3 py-2 text-sm font-semibold touch-manipulation select-none ${
									activeTab === tab.key
										? `text-white ${NEO_COLOR_BTN_PRESS}`
										: `text-slate-700 ${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS}`
								}`}
								style={activeTab === tab.key ? { ...PAY_NEO_PRIMARY_BLUE } : { ...PAY_NEO.key }}
							>
								{tab.label}
							</button>
						))}
					</div>
				</div>

				{/* Tab content area - scrollable, fixed size */}
				<div className="flex-1 min-h-0 overflow-y-auto rounded-b-[14px] px-1 pt-1" style={{ background: PAY_NEO_CANVAS }}>

				{/* ===== CREATE TAB ===== */}
				{activeTab === 'create' && <>
				{/* Main layout: calendar left, slot settings right */}
				<div className="flex gap-2">
					{/* Left: Calendar Section */}
					<div className="flex-1 min-w-0">
						<div className="flex items-center justify-center gap-2 mb-2">
							<button
								type="button"
								onClick={() => setAvailMonthOffset(prev => prev - 1)}
								className={`rounded-[10px] border-0 p-3 text-slate-800 touch-manipulation select-none hover:brightness-[1.03] ${NEO_PREP_TIME_BTN_PRESS}`}
								style={{ ...PAY_KEYPAD_KEY }}
							>
								<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
								</svg>
							</button>
							<span className="text-base font-semibold min-w-[140px] text-center">
								{new Date(availabilityMonth.year, availabilityMonth.month - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
							</span>
							<button
								type="button"
								onClick={() => setAvailMonthOffset(prev => prev + 1)}
								className={`rounded-[10px] border-0 p-3 text-slate-800 touch-manipulation select-none hover:brightness-[1.03] ${NEO_PREP_TIME_BTN_PRESS}`}
								style={{ ...PAY_KEYPAD_KEY }}
							>
								<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
								</svg>
							</button>
						</div>

					{/* Availability calendar */}
					<div ref={anchorRef} className="rounded-[14px] p-3" style={{ ...PAY_NEO.inset }}>
						<div className="grid grid-cols-7 gap-[5px] mb-2">
							{['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => <span key={d} className="text-center text-xs font-bold text-gray-500">{d}</span>)}
						</div>
						<div className="grid grid-cols-7 gap-[5px]">
							{Array.from({ length: availabilityMonth.firstWeekday }).map((_, i) => (
								<div key={`pad-av-${i}`} style={{ height: '54px' }} />
							))}
								{availabilityMonth.days.map((d: any) => {
									const hasReservations = (monthReservationCounts[d.date] || 0) > 0;
									const isSelected = date === d.date;
									const isToday = d.date === today;
								return (
									<button
										type="button"
										key={d.date}
										disabled={!d.isOpen}
										className={`w-full flex flex-col items-center justify-center rounded-[10px] border-0 touch-manipulation select-none ${
											!d.isOpen
												? 'cursor-not-allowed opacity-50'
												: isSelected
													? `text-white ${NEO_COLOR_BTN_PRESS}`
													: `${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS} text-slate-800 ${isToday ? 'ring-2 ring-blue-400/80' : ''}`
										}`}
										style={
											!d.isOpen
												? { ...PAY_NEO.inset, height: '54px', opacity: 0.45 }
												: isSelected
													? { ...PAY_NEO_PRIMARY_BLUE, height: '54px' }
													: { ...PAY_NEO.key, height: '54px' }
										}
                                    onClick={() => { 
										if (!d.isOpen) return;
										setDate(d.date); 
										setShowSlotModal(true);
									}}
									>
							<div style={{ fontSize: '15px', fontWeight: isSelected ? 800 : 600, lineHeight: 1.1 }}>{d.label}</div>
							{d.isOpen && hasReservations && (
								<div className={`text-[10px] font-bold leading-none mt-0.5 rounded-full px-1.5 py-[1px] min-w-[16px] text-center ${
									isSelected ? 'bg-white text-blue-600' : 'bg-yellow-400 text-gray-900'
								}`}>{monthReservationCounts[d.date]}</div>
							)}
									</button>
								);
							})}
							</div>
					</div>

				{/* Today's reservation list under calendar */}
				<div className="mt-2">
					<div className="text-sm font-semibold">Today's Reservations</div>
						<div className="mt-2 max-h-64 divide-y divide-slate-300/40 overflow-auto rounded-[14px]" style={{ ...PAY_NEO.inset }}>
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
					<div className="w-[160px] flex-shrink-0 rounded-[14px] p-3" style={{ ...PAY_NEO.inset }}>
						<div className="text-sm font-semibold text-gray-700 mb-3">⚙️ Slot Settings</div>
						
						<div className="mb-3">
							<label className="block text-xs text-gray-500 mb-2 text-center">Max Tables Per Day</label>
							<div className="flex items-center justify-center gap-2">
								<button
									type="button"
									onClick={() => {
										const v = Math.max(1, maxSlotsPerDay - 1);
										setMaxSlotsPerDay(v);
										localStorage.setItem('reservation_maxSlots', String(v));
									}}
									className={`flex h-9 w-9 items-center justify-center rounded-[10px] border-0 text-lg font-bold text-slate-800 touch-manipulation select-none hover:brightness-[1.03] ${NEO_PREP_TIME_BTN_PRESS}`}
									style={{ ...PAY_KEYPAD_KEY }}
								>−</button>
								<div className="flex h-9 w-12 items-center justify-center rounded-[10px] text-lg font-bold text-blue-700" style={{ ...PAY_NEO.inset }}>
									{maxSlotsPerDay}
								</div>
								<button
									type="button"
									onClick={() => {
										const v = Math.min(99, maxSlotsPerDay + 1);
										setMaxSlotsPerDay(v);
										localStorage.setItem('reservation_maxSlots', String(v));
									}}
									className={`flex h-9 w-9 items-center justify-center rounded-[10px] border-0 text-lg font-bold text-slate-800 touch-manipulation select-none hover:brightness-[1.03] ${NEO_PREP_TIME_BTN_PRESS}`}
									style={{ ...PAY_KEYPAD_KEY }}
								>+</button>
							</div>
						</div>
						
						<button
							type="button"
							onClick={async () => {
								try {
									setSavingSlots(true);
									const res = await fetch(`${API_URL}/reservation-settings/policy`, {
										method: 'PUT',
										headers: { 'Content-Type': 'application/json' },
										body: JSON.stringify({
											peak_start: policy?.peak_start || '17:00',
											peak_end: policy?.peak_end || '21:00',
											peak_max_per_slot: maxSlotsPerDay,
											normal_max_per_slot: maxSlotsPerDay,
											dwell_minutes: policy?.dwell_minutes || 120,
											no_show_grace_minutes: 10,
										}),
									});
									if (res.ok) {
										setSlotsSaved(true);
										setTimeout(() => setSlotsSaved(false), 2000);
									}
								} catch (err) {
									console.error('Failed to save slot settings:', err);
								} finally {
									setSavingSlots(false);
								}
							}}
							disabled={savingSlots}
							className={`w-full rounded-[12px] border-0 py-2 text-sm font-semibold touch-manipulation select-none ${
								slotsSaved
									? `text-white ${NEO_COLOR_BTN_PRESS}`
									: savingSlots
										? 'cursor-not-allowed opacity-70'
										: `text-white ${NEO_COLOR_BTN_PRESS}`
							}`}
							style={
								slotsSaved
									? { ...PAY_NEO.raised, background: '#16a34a', color: '#fff', boxShadow: '5px 5px 12px rgba(22,101,52,0.4), -3px -3px 10px rgba(255,255,255,0.25)' }
									: savingSlots
										? { ...PAY_NEO.inset, color: '#64748b' }
										: { ...PAY_NEO_PRIMARY_BLUE }
							}
						>
							{slotsSaved ? '✓ Saved' : savingSlots ? 'Saving...' : 'Save'}
						</button>
					</div>
				</div>

				{/* Day reservations timeline removed by request */}

				{/* Inline time slot list removed - using separate modal instead */}

				{/* Bottom time wheel removed per request */}
				</>}

				{/* ===== CHECK-IN TAB ===== */}
				{activeTab === 'checkin' && (
					<div>
						<div className="text-sm font-semibold mb-2">Today's Reservations — Assign Table</div>
						<div className="text-xs text-gray-500 mb-3">Select a reservation to assign a table for arrived guests.</div>
						<div className="max-h-[55vh] divide-y divide-slate-300/40 overflow-auto rounded-[14px]" style={{ ...PAY_NEO.inset }}>
							{(todayReservations || []).length === 0 && (
								<div className="px-4 py-8 text-center text-gray-400">No reservations today.</div>
							)}
							{(todayReservations || [])
								.slice()
								.filter((r: any) => r.status !== 'cancelled' && r.status !== 'no_show' && r.status !== 'completed')
								.sort((a: any, b: any) => {
									const toMin = (t: string) => { const m = t.match(/^(\d{2}):(\d{2})/); if (!m) return 0; return Number(m[1]) * 60 + Number(m[2]); };
									return toMin(String(a?.reservation_time || '')) - toMin(String(b?.reservation_time || ''));
								})
								.map((r: any, idx: number) => {
									const t = String(r.reservation_time || '').slice(0, 5);
									const [hh, mm] = t.split(':').map((n: string) => Number(n));
									const isAM = hh < 12; const h12 = (hh % 12) === 0 ? 12 : (hh % 12);
									const tl = `${String(h12).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${isAM ? 'AM' : 'PM'}`;
									const isAssigned = reservationStatuses[r.id]?.status === 'arrived' || reservationStatuses[r.id]?.status === 'occupied';
									const assignedTable = reservationStatuses[r.id]?.tableName;
									return (
										<div key={idx} className={`px-4 py-3 flex items-center justify-between ${isAssigned ? 'bg-green-50' : 'hover:bg-gray-50'}`}>
											<div className="flex-1 min-w-0">
												<div className="flex items-center gap-2">
													<span className="text-sm font-bold text-gray-800">{tl}</span>
													<span className="text-sm font-medium text-gray-700">{r.customer_name || 'Guest'}</span>
													<span className="text-xs text-gray-500">👥 {r.party_size || '-'}</span>
													{r.phone_number && <span className="text-xs text-gray-400">📞 {r.phone_number}</span>}
												</div>
												{isAssigned && assignedTable && (
													<div className="mt-0.5 text-xs text-green-600 font-medium">✅ Assigned to {assignedTable}</div>
												)}
											</div>
											<div className="flex-shrink-0 ml-3">
												{isAssigned ? (
													<span className="px-3 py-1.5 rounded text-xs font-semibold bg-green-100 text-green-700">Seated</span>
												) : (
													<button
														type="button"
														className={`rounded-[10px] border-0 px-3 py-1.5 text-xs font-semibold text-white touch-manipulation select-none ${NEO_COLOR_BTN_PRESS}`}
														style={{ ...PAY_NEO_PRIMARY_BLUE }}
														onClick={() => {
															const ps = Number(r.party_size || 2);
															setSelectedReservationForTable({
																id: r.id,
																name: r.customer_name || 'Guest',
																partySize: ps,
																tablesNeeded: r.tables_needed || calcTablesNeeded(ps),
																reservationTime: r.reservation_time || ''
															});
															setShowTableSelectionModal(true);
														}}
													>
														Assign Table
													</button>
												)}
											</div>
										</div>
									);
								})}
						</div>
					</div>
				)}

				{/* ===== MANAGE TAB ===== */}
				{activeTab === 'manage' && (
					<div>
						<div className="text-sm font-semibold mb-2">Manage Reservations</div>
						{/* Date selector for manage tab */}
						<div className="flex items-center gap-2 mb-3">
							<label className="text-xs text-gray-500">Date:</label>
							<input
								type="date"
								value={date || today}
								onChange={(e) => setDate(e.target.value)}
								className="rounded-[10px] border-0 px-2 py-1.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-400/60"
								style={{ ...PAY_NEO.inset }}
							/>
							<button
								type="button"
								className={`rounded-[10px] border-0 px-2.5 py-1 text-xs font-semibold text-blue-800 touch-manipulation select-none hover:brightness-[1.03] ${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS}`}
								style={{ ...PAY_NEO.key }}
								onClick={() => setDate(today)}
							>Today</button>
						</div>
						<div className="max-h-[55vh] divide-y divide-slate-300/40 overflow-auto rounded-[14px]" style={{ ...PAY_NEO.inset }}>
							{(() => {
								// Flatten all reservations for the selected date
								const allReservations: any[] = [];
								for (const [, rList] of Object.entries(reservationsByTime)) {
									(rList || []).forEach((r: any) => allReservations.push(r));
								}
								// Also include today's reservations if viewing today
								if ((date || today) === today) {
									(todayReservations || []).forEach((r: any) => {
										if (!allReservations.find((ar: any) => ar.id === r.id)) {
											allReservations.push(r);
										}
									});
								}
								const sorted = allReservations.sort((a: any, b: any) => {
									const toMin = (t: string) => { const m = t.match(/^(\d{2}):(\d{2})/); if (!m) return 0; return Number(m[1]) * 60 + Number(m[2]); };
									return toMin(String(a?.reservation_time || '')) - toMin(String(b?.reservation_time || ''));
								});
								if (sorted.length === 0) {
									return <div className="px-4 py-8 text-center text-gray-400">No reservations for this date.</div>;
								}
								return sorted.map((r: any, idx: number) => {
									const t = String(r.reservation_time || '').slice(0, 5);
									const [hh, mm] = t.split(':').map((n: string) => Number(n));
									const isAM = hh < 12; const h12 = (hh % 12) === 0 ? 12 : (hh % 12);
									const tl = `${String(h12).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${isAM ? 'AM' : 'PM'}`;
									const isCancelled = cancelledReservations.has(r.id) || r.status === 'cancelled';
									const isNoShow = r.status === 'no_show' || cancelledLabelMap[r.id] === 'No Show';
									const isCompleted = r.status === 'completed';
									const isInactive = isCancelled || isNoShow || isCompleted;
									let channelInfo = '';
									try { const sp = JSON.parse(r.special_requests || '{}'); channelInfo = sp.channel || ''; } catch {}
									return (
										<div key={idx} className={`px-4 py-3 flex items-center justify-between ${isInactive ? 'bg-gray-50 opacity-60' : 'hover:bg-gray-50'}`}>
											<div className="flex-1 min-w-0">
												<div className="flex items-center gap-2">
													<span className={`text-sm font-bold ${isInactive ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{tl}</span>
													<span className={`text-sm font-medium ${isInactive ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{r.customer_name || 'Guest'}</span>
													<span className="text-xs text-gray-500">👥 {r.party_size || '-'}</span>
													{channelInfo && <span className="text-xs text-gray-400">📌 {channelInfo}</span>}
												</div>
												<div className="mt-0.5 flex items-center gap-2">
													{r.phone_number && <span className="text-xs text-gray-400">📞 {r.phone_number}</span>}
													{isCancelled && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-medium">Cancelled</span>}
													{isNoShow && <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-600 font-medium">No Show</span>}
													{isCompleted && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 font-medium">Completed</span>}
												</div>
											</div>
											{!isInactive && (
												<div className="flex-shrink-0 ml-3 flex items-center gap-1.5">
													{/* Reschedule */}
													<button
														type="button"
														className={`rounded-[10px] border-0 px-2.5 py-1.5 text-xs font-semibold text-blue-800 touch-manipulation select-none ${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS}`}
														style={{ ...PAY_NEO.key }}
														onClick={() => {
															setRescheduleMode(true);
															setRescheduleTarget({ id: r.id, name: r.customer_name, phone: r.phone_number, partySize: r.party_size });
															setName(r.customer_name || '');
															setPhone(r.phone_number || '');
															setPartySize(String(r.party_size || ''));
															setSelectedSlotTime(t);
															setShowDetailModal(true);
														}}
													>
														Reschedule
													</button>
													{/* Cancel */}
													<button
														type="button"
														className={`rounded-[10px] border-0 px-2.5 py-1.5 text-xs font-semibold text-red-700 touch-manipulation select-none ${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS}`}
														style={{ ...PAY_NEO.key, background: '#f1d5d8' }}
														onClick={() => {
															setConfirmTarget({ id: r.id, name: r.customer_name, phone: r.phone_number });
															setConfirmModalOpen(true);
														}}
													>
														Cancel
													</button>
													{/* No Show */}
													<button
														type="button"
														className={`rounded-[10px] border-0 px-2.5 py-1.5 text-xs font-semibold text-amber-800 touch-manipulation select-none ${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS}`}
														style={{ ...PAY_NEO.key, background: '#fde8d0' }}
														onClick={() => {
															handleReservationAction('no_show', r.customer_name, r.phone_number, r.id);
														}}
													>
														No Show
													</button>
												</div>
											)}
											{isInactive && !isCompleted && (
												<div className="flex-shrink-0 ml-3">
													<button
														type="button"
														className={`rounded-[10px] border-0 px-2.5 py-1.5 text-xs font-semibold text-emerald-900 touch-manipulation select-none ${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS}`}
														style={{ ...PAY_NEO.key, background: '#d1fae5' }}
														onClick={() => {
															handleReservationAction('rebook', r.customer_name, r.phone_number, r.id);
														}}
													>
														Rebook
													</button>
												</div>
											)}
										</div>
									);
								});
							})()}
						</div>
					</div>
				)}

				</div>{/* end scrollable tab content */}

				<div className="mt-3 flex items-end justify-end gap-0">
						{error && <div className="text-sm text-red-600 mr-auto">{error}</div>}
						{successMsg && <div className="text-sm text-green-700 mr-auto">{successMsg}</div>}
				</div>
			</div>{/* end main modal white box */}
		</div>{/* end main modal backdrop */}

		{/* Time Slot Availability Modal — PAY_NEO shell (date pick → timeline/grid) */}
		{showSlotModal && (
			<div className="fixed z-[60]"
				ref={slotModalRef}
				style={slotModalStyle}
			>
				<div className="w-full max-h-[92vh] overflow-y-auto overflow-x-hidden border-0 p-0" style={{ ...PAY_NEO.modalShell }}>
					<div className="flex items-center justify-between gap-3 px-4 py-3" style={{ ...PAY_NEO.raised, borderRadius: '14px 14px 0 0' }}>
						<div className="min-w-0 flex-1">
							<div className="text-base font-bold text-slate-800 truncate">Reservation Timeline • {date}</div>
							<div className="mt-0.5 text-xs text-slate-600">
								<span>{slotViewMode === 'grid' ? 'Numbers show available tables' : 'Reservation timeline'}</span>
								<span className="ml-2 font-semibold text-blue-600">MAX {maxSlotsPerDay}</span>
							</div>
						</div>
						<button
							type="button"
							className={`flex h-11 w-11 flex-shrink-0 touch-manipulation select-none items-center justify-center rounded-full border-[3px] border-red-500 hover:brightness-[1.03] ${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS}`}
							style={{ ...PAY_NEO.raised }}
							onClick={() => setShowSlotModal(false)}
							aria-label="Close"
						>
							<svg className="h-5 w-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					</div>
					<div className="px-3 pb-4 pt-2" style={{ background: PAY_NEO_CANVAS }}>
					{slotViewMode === 'timeline' ? (() => {
						const dwellMinsT = Number(policy?.dwell_minutes || 120);
						const toMinsT = (s: string) => { const [H, M] = s.split(':').map(n => Number(n)); return H * 60 + M; };
						const fromMinsT = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
						const dowT = new Date(date || new Date().toISOString().slice(0, 10)).getDay();
						const bhT = businessHours.find(b => Number(b.day_of_week) === dowT && Number(b.is_open) === 1);
						const openT = bhT?.open_time || '11:00';
						const closeT = bhT?.close_time || '21:00';
						const startMT = toMinsT(openT);
						const endMT = toMinsT(closeT);
						const totalSlots = Math.ceil((endMT - startMT) / 15);
						const labelWidth = 52;
						const nowDate = new Date();
						const todayStr = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}-${String(nowDate.getDate()).padStart(2, '0')}`;
						const isToday = date === todayStr;
						const nowMins = nowDate.getHours() * 60 + nowDate.getMinutes();

						const allReservations: any[] = [];
						for (const [rTime, rList] of Object.entries(reservationsByTime)) {
							for (const r of (rList || [])) {
								if (r.status === 'cancelled' || r.status === 'completed') continue;
								allReservations.push({ ...r, _startTime: rTime });
							}
						}

						const ROW_H = 51;
						const BAR_H = ROW_H - 8;
						const rsvRows = maxSlotsPerDay;
						const assigned: any[][] = Array.from({ length: rsvRows }, () => []);
						const sorted = [...allReservations].sort((a, b) => toMinsT(a._startTime) - toMinsT(b._startTime));

						// Color mapping: same reservation ID → same color, different time slots → different colors
						let colorCounter = 0;
						const timeColorMap: Record<string, number> = {};
						const idColorMap: Record<string, number> = {};
						const timeColors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316', '#84CC16', '#14B8A6', '#A855F7', '#F43F5E'];

						for (const rsv of sorted) {
							const rStart = toMinsT(rsv._startTime);
							const rEnd = rStart + dwellMinsT;
							const tablesNeeded = rsv.tables_needed || calcTablesNeeded(Number(rsv.party_size || 1));
							const rsvId = String(rsv.id || rsv.reservation_number || '');

							// Assign color: same ID → same color; otherwise time-based
							if (!(rsvId && idColorMap[rsvId] !== undefined)) {
								const timeKey = rsv._startTime;
								if (timeColorMap[timeKey] === undefined) timeColorMap[timeKey] = colorCounter++;
								if (rsvId) idColorMap[rsvId] = timeColorMap[timeKey];
							}
							const assignedColor = rsvId ? idColorMap[rsvId] : (timeColorMap[rsv._startTime] ?? colorCounter++);

							// Place each table copy into separate rows and track row positions
							const placedRows: number[] = [];
							let placedCount = 0;
							for (let row = 0; row < rsvRows && placedCount < tablesNeeded; row++) {
								const conflict = assigned[row].some((existing: any) => {
									const eStart = toMinsT(existing._startTime);
									const eEnd = eStart + dwellMinsT;
									return rStart < eEnd && rEnd > eStart;
								});
								if (!conflict) {
									assigned[row].push({ ...rsv, _tableIndex: placedCount + 1, _tablesTotal: tablesNeeded, _colorIdx: assignedColor, _placedRows: [] });
									placedRows.push(row);
									placedCount++;
								}
							}
							if (placedCount === 0 && assigned.length > 0) {
								assigned[assigned.length - 1].push({ ...rsv, _tableIndex: 1, _tablesTotal: tablesNeeded, _colorIdx: assignedColor, _placedRows: [] });
								placedRows.push(assigned.length - 1);
							}
							// Store placed row indices on each copy for gap-fill rendering
							for (const row of placedRows) {
								const items = assigned[row];
								const last = items[items.length - 1];
								if (last && last._placedRows !== undefined) last._placedRows = placedRows;
							}
						}

						return (<>
							<div className="overflow-hidden p-2" style={{ ...PAY_NEO.inset, maxWidth: '100%' }}>
								<div style={{ width: '100%', position: 'relative' }}>
									{/* Time header — pure % layout, no fixed slot widths */}
									<div className="flex items-end border-b border-gray-300 pb-1 mb-1" style={{ marginLeft: labelWidth }}>
										{Array.from({ length: totalSlots }).map((_, i) => {
											const m = startMT + i * 15;
											const min = m % 60;
											const isHour = min === 0;
											return (
												<div key={i} style={{ flex: '1 1 0%', minWidth: 0 }} className="text-center">
													{isHour ? (
														<span className="text-xs font-bold text-gray-800">{fromMinsT(m)}</span>
													) : min === 30 ? (
														<span className="text-[11px] font-semibold text-gray-500">30</span>
													) : null}
												</div>
											);
										})}
									</div>

									{/* Current time indicator */}
									{isToday && nowMins >= startMT && nowMins <= endMT && (() => {
										const pct = (nowMins - startMT) / (endMT - startMT) * 100;
										return (
											<div
												className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-20"
												style={{ left: `calc(${labelWidth}px + (100% - ${labelWidth}px) * ${pct / 100})` }}
											/>
										);
									})()}

									{/* RSV rows */}
									{Array.from({ length: rsvRows }).map((_, rowIdx) => {
										const rowReservations = assigned[rowIdx] || [];
										return (
											<div key={rowIdx} className="flex items-center border-b border-gray-100" style={{ height: ROW_H }}>
												<div className="text-xs font-bold text-gray-700 flex-shrink-0 flex items-center justify-center" style={{ width: labelWidth }}>
													RSV{rowIdx + 1}
												</div>
												<div className="relative flex-1 min-w-0" style={{ height: BAR_H }}>
													{/* Grid lines — % based */}
													{Array.from({ length: totalSlots }).map((_, i) => {
														const m = startMT + i * 15;
														const min = m % 60;
														const borderColor = min === 0 ? 'rgba(0,0,0,0.25)' : min === 30 ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.04)';
														const borderW = min === 0 ? 1.5 : 1;
														const leftPct = (i / totalSlots) * 100;
														return (
															<div
																key={i}
																className="absolute top-0 bottom-0"
																style={{ left: `${leftPct}%`, borderLeft: `${borderW}px solid ${borderColor}` }}
															/>
														);
													})}

													{/* Connector band between multi-table rows */}
													{[...rowReservations].map((rsv: any, bi: number) => {
														const tblTotal = rsv._tablesTotal || 1;
														const placedRows: number[] = rsv._placedRows || [];
														if (tblTotal <= 1 || placedRows.length < 2) return null;
														const myPosInPlaced = placedRows.indexOf(rowIdx);
														if (myPosInPlaced < 0 || myPosInPlaced >= placedRows.length - 1) return null;
														const nextRow = placedRows[myPosInPlaced + 1];
														const rowSpan = nextRow - rowIdx;
														const rStart = toMinsT(rsv._startTime);
														const rEnd = Math.min(rStart + dwellMinsT, endMT);
														const leftPct = ((rStart - startMT) / (endMT - startMT)) * 100;
														const widthPct = ((rEnd - rStart) / (endMT - startMT)) * 100;
														const color = timeColors[(rsv._colorIdx ?? 0) % timeColors.length];
														const bandTop = (BAR_H - 4) / 2 + 2;
														const bandHeight = rowSpan * ROW_H - (BAR_H - 4) / 2;
														return (
															<div
																key={`conn-${rsv.id || bi}-r${rowIdx}`}
																className="absolute z-[2] pointer-events-none"
																style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 2)}%`, top: bandTop, height: bandHeight, backgroundColor: color, opacity: 0.4, borderRadius: 2 }}
															/>
														);
													})}

													{/* Reservation bars */}
													{[...rowReservations].sort((a, b) => toMinsT(a._startTime) - toMinsT(b._startTime)).map((rsv: any, bi: number) => {
														const rStart = toMinsT(rsv._startTime);
														const rEnd = Math.min(rStart + dwellMinsT, endMT);
														const leftPct = ((rStart - startMT) / (endMT - startMT)) * 100;
														const widthPct = ((rEnd - rStart) / (endMT - startMT)) * 100;
														const color = timeColors[(rsv._colorIdx ?? 0) % timeColors.length];
														const rsvName = rsv.customer_name || rsv.guest_name || rsv.name || '';
														const rsvParty = rsv.party_size || 1;
														const tblIdx = rsv._tableIndex || 1;
														const tblTotal = rsv._tablesTotal || 1;
														const timeLabel = `${fromMinsT(rStart)}-${fromMinsT(rEnd)}`;
														const isFirstTable = tblIdx === 1;
														const rsvId = String(rsv.id || '');
														const dbTable = rsv.table_number || '';
														const sessionTables = assignedTableNames[rsvId] || [];
														const thisTableName = sessionTables[tblIdx - 1] || '';
														const allTableDisplay = dbTable || sessionTables.join(', ');

														return (
															<div
																key={`${rsv.id || bi}-t${tblIdx}`}
																className="absolute top-0.5 rounded-md flex flex-col justify-center px-1.5 text-white font-semibold overflow-hidden cursor-pointer hover:brightness-110 transition-all shadow-sm z-[5]"
																style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 2)}%`, height: BAR_H - 4, backgroundColor: thisTableName ? color : color, border: thisTableName ? '2px solid rgba(255,255,255,0.6)' : 'none' }}
																title={`${timeLabel}\n${rsvName} • ${rsvParty}ppl (T${tblIdx}/${tblTotal})${allTableDisplay ? `\nTables: ${allTableDisplay}` : ''}`}
																onClick={(e) => {
																	e.stopPropagation();
																	setSelectedReservationForTable({ id: rsvId, name: rsvName, partySize: rsvParty, tablesNeeded: tblTotal, tableIndex: tblIdx, reservationTime: rsv._startTime });
																	setShowTableSelectionModal(true);
																}}
															>
																{isFirstTable ? (<>
																	<div className="text-[11px] leading-tight truncate opacity-90">
																		{timeLabel} • {rsvParty}ppl{tblTotal > 1 ? ` [T${tblIdx}/${tblTotal}]` : ''}
																	</div>
																	<div className="text-xs leading-tight truncate font-bold flex items-center gap-1">
																		<span>{rsvName || 'Guest'}</span>
																		{allTableDisplay && <span className="text-[10px] font-normal opacity-80">📍{allTableDisplay}</span>}
																	</div>
																</>) : (
																	<div className="text-[11px] leading-tight truncate text-center font-bold opacity-90">
																		[T{tblIdx}/{tblTotal}]{thisTableName ? ` 📍${thisTableName}` : ''}
																	</div>
																)}
															</div>
														);
													})}

													{/* Clickable background for adding reservation in empty time gaps */}
													<div
														className="absolute inset-0 z-[1] cursor-pointer hover:bg-blue-50/30 rounded transition-colors"
														onClick={() => { setShowTimelineForm(true); setSoftKbOpen(true); setSoftKbTarget('tl_name'); }}
													/>
													{rowReservations.length === 0 && (
														<div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[3]">
															<span className="text-xs text-blue-300 font-medium italic whitespace-nowrap">+ Add new reservation</span>
														</div>
													)}
												</div>
											</div>
										);
									})}
								</div>
							</div>
						</>);
					})() : (
					<div className="overflow-hidden p-2" style={{ ...PAY_NEO.inset }}>
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
							// Dwell time (체류 시간): 예약 1건이 테이블을 점유하는 시간 (분)
							const dwellMinutes = Number(policy?.dwell_minutes || 120);

							// calcTablesNeeded is defined at module top level

							const computeLeft = (t:string) => {
								const max = maxSlotsPerDay;

								// 구간 겹침(interval overlap) 기반 점유 계산:
								// t에 새 예약 시 [t, t+dwell) 구간과 기존 예약 [s, s+dwell) 구간이 겹치는지 확인
								// 겹침 조건: s < t + dwell AND t < s + dwell
								const tMins = toMins(t);
								let occupiedTables = 0;
								for (const [slotTime, reservations] of Object.entries(reservationsByTime)) {
									const sMins = toMins(slotTime);
									if (sMins < tMins + dwellMinutes && tMins < sMins + dwellMinutes) {
										const activeReservations = (reservations || []).filter(
											(r: any) => r.status !== 'cancelled' && r.status !== 'no_show' && r.status !== 'completed'
										);
										for (const r of activeReservations) {
											occupiedTables += Number(r.tables_needed) || calcTablesNeeded(Number(r.party_size || 1));
										}
									}
								}
								return Math.max(0, max - occupiedTables);
							};
							return (
								<div className="space-y-0.5">
									{/* Column header: 00/15/30/45 minutes */}
									<div className="grid grid-cols-5 gap-x-0.5 gap-y-0 items-center px-0.5 py-1 rounded-[14px]" style={{ ...PAY_NEO.inset, background: '#d8dde6' }}>
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
											<button
												type="button"
												className={`ml-2 inline-flex min-h-[32px] min-w-[40px] touch-manipulation select-none items-center justify-center rounded-[10px] border-0 px-2.5 py-1.5 text-sm font-semibold text-blue-800 hover:brightness-[1.03] ${NEO_PREP_TIME_BTN_PRESS}`}
												style={{ ...PAY_KEYPAD_KEY }}
												onClick={() => setHourViewHour(String(h).padStart(2,'0'))}
											>
												View
											</button>
										</div>
												{mins.map(m => {
													const t = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
													const enabled = isEnabled(t);
                                                    if (!enabled) return (
														<div key={m} className="flex h-12 items-center justify-center rounded-[10px]" style={{ ...PAY_NEO.inset, opacity: 0.85 }}>
															<span className="text-xs text-gray-500">Closed</span>
														</div>
													);
													const left = computeLeft(t);
													const full = left <= 0;
												return (
                                                <div
                                                    key={m}
                                                    className={`flex min-h-[12px] w-full items-center justify-between rounded-[10px] px-1 py-0 transition-[filter] ${full ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:brightness-[1.02]'}`}
                                                    onClick={() => { if (!full) { setSelectedSlotTime(t); setShowDetailModal(true); } }}
                                                    onDragOver={(e) => { if (!full) e.preventDefault(); }}
                                                    onDrop={(e) => { if (!full) { handleDropOnTimeSlot(t); } }}
                                                >
										<div className="whitespace-nowrap text-right w-14 mr-1.5 flex items-center justify-end">
														<span className="tabular-nums text-base font-semibold inline-block w-[2ch] text-right">{left}</span>
													</div>
                                                    {full ? (
														<span
															className="inline-flex min-h-[32px] min-w-[40px] cursor-not-allowed select-none items-center justify-center rounded-[10px] px-2.5 py-1.5 text-sm font-bold text-red-800"
															style={{ ...PAY_NEO.inset, background: '#e8ccd0' }}
														>
															Full
														</span>
                                                    ) : (
													<button
														type="button"
														className={`inline-flex min-h-[32px] min-w-[40px] touch-manipulation select-none items-center justify-center rounded-[10px] border-0 px-2.5 py-1.5 text-sm font-semibold text-blue-800 hover:brightness-[1.03] ${NEO_PREP_TIME_BTN_PRESS}`}
														style={{ ...PAY_KEYPAD_KEY }}
														onClick={(e) => { e.stopPropagation(); setSelectedSlotTime(t); setShowDetailModal(true); }}
													>
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
					)}
				</div>
				</div>
			</div>
		)}

		{/* Hour View Overlay Modal */}
		{hourViewHour && (() => {
			const dwellMins = Number(policy?.dwell_minutes || 120);
			const toM = (s: string) => { const [H, M] = s.split(':').map(n => Number(n)); return H * 60 + M; };

			// 각 15분 슬롯별로 "이 슬롯에 예약된 사람" + "이전 예약이지만 아직 체류 중인 사람" 구분
			const buildSlotData = (slotTime: string) => {
				const slotMins = toM(slotTime);
				const directReservations = reservationsByTime[slotTime] || [];
				// 이전 시간대에 예약했지만 아직 체류 중인 예약들
				const occupyingReservations: any[] = [];
				for (const [rTime, rList] of Object.entries(reservationsByTime)) {
					const rMins = toM(rTime);
					// 이 슬롯보다 이전 시간에 예약했고, 아직 체류 중인 경우
					if (rMins < slotMins && slotMins < rMins + dwellMins) {
						for (const r of (rList || [])) {
							if (r.status !== 'cancelled' && r.status !== 'no_show' && r.status !== 'completed') {
								occupyingReservations.push({ ...r, _occupyingFrom: rTime });
							}
						}
					}
				}
				return { directReservations, occupyingReservations };
			};

			const renderReservationRow = (r: any, i: number, isOccupying: boolean) => {
				const statusColor = r.status === 'confirmed' ? 'bg-green-100 text-green-700' :
					r.status === 'cancelled' ? 'bg-red-100 text-red-700' :
					r.status === 'no_show' ? 'bg-orange-100 text-orange-700' :
					r.status === 'completed' ? 'bg-blue-100 text-blue-700' :
					'bg-yellow-100 text-yellow-700';
				const statusLabel = r.status === 'confirmed' ? 'Confirmed' :
					r.status === 'cancelled' ? 'Cancelled' :
					r.status === 'no_show' ? 'No Show' :
					r.status === 'completed' ? 'Completed' : 'Pending';
				let channelInfo = '';
				let depositInfo = '';
				try {
					const sp = JSON.parse(r.special_requests || '{}');
					channelInfo = sp.channel || '';
					depositInfo = sp.deposit ? `$${sp.deposit}` : '';
				} catch {}
				const tablesUsed = Number(r.tables_needed) || calcTablesNeeded(Number(r.party_size || 1));
				return (
					<div key={`${isOccupying ? 'occ' : 'dir'}-${i}`} className={`px-3 py-2.5 flex items-center gap-3 ${isOccupying ? 'bg-amber-50/50' : 'hover:bg-gray-50'}`}>
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-2">
								<span className="font-semibold text-sm text-gray-900">{r.customer_name || 'Guest'}</span>
								<span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${statusColor}`}>{statusLabel}</span>
								{isOccupying && (
									<span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">
										🕐 {r._occupyingFrom}~
									</span>
								)}
							</div>
							<div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
								{r.phone_number && <span>📞 {r.phone_number}</span>}
								{r.party_size && <span>👥 {r.party_size}</span>}
								{tablesUsed > 1 && <span>🪑 {tablesUsed} tables</span>}
								{channelInfo && <span>📌 {channelInfo}</span>}
								{depositInfo && <span>💰 {depositInfo}</span>}
							</div>
						</div>
						<div className="flex items-center gap-1 flex-shrink-0">
							{!isOccupying && r.status !== 'cancelled' && r.status !== 'no_show' && r.status !== 'completed' && (
								<button
									type="button"
									className={`rounded-[10px] border-0 px-2 py-1 text-xs font-semibold text-red-700 touch-manipulation select-none ${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS}`}
									style={{ ...PAY_NEO.key, background: '#f1d5d8' }}
									onClick={() => { setConfirmTarget({ id: r.id, name: r.customer_name, phone: r.phone_number }); setConfirmModalOpen(true); }}
								>Cancel</button>
							)}
						</div>
					</div>
				);
			};

			return (
			<div className="fixed inset-0 z-[95] flex items-center justify-center bg-black bg-opacity-60">
				<div className="w-full max-w-lg max-h-[70vh] overflow-y-auto border-0 p-0" style={{ ...PAY_NEO.modalShell }}>
					<div className="flex items-center justify-between gap-3 px-4 py-3" style={{ ...PAY_NEO.raised, borderRadius: '14px 14px 0 0' }}>
						<div className="min-w-0 text-lg font-semibold text-slate-800">📋 Reservations • {date} {hourViewHour}:00</div>
						<button type="button" className={'flex h-11 w-11 flex-shrink-0 touch-manipulation select-none items-center justify-center rounded-full border-[3px] border-red-500 hover:brightness-[1.03] ' + NEO_MODAL_BTN_PRESS + ' ' + NEO_PREP_TIME_BTN_PRESS} style={{ ...PAY_NEO.raised }} onClick={() => setHourViewHour('')} aria-label="Close">
							<svg className="h-5 w-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					</div>
					<div className="max-h-[55vh] space-y-3 overflow-auto px-4 pb-4 pt-3" style={{ background: PAY_NEO_CANVAS }}>
						{[0,15,30,45].map((min) => {
							const t = `${hourViewHour}:${String(min).padStart(2,'0')}`;
							const { directReservations, occupyingReservations } = buildSlotData(t);
							const totalCount = directReservations.length + occupyingReservations.length;
							return (
								<div key={min} className="overflow-hidden rounded-[14px]" style={{ ...PAY_NEO.inset }}>
									<div className="flex items-center justify-between px-3 py-2" style={{ ...PAY_NEO.inset, background: '#d8dde6' }}>
										<span className="text-sm font-bold text-gray-700">{hourViewHour}:{String(min).padStart(2,'0')}</span>
										<div className="flex items-center gap-2">
											{occupyingReservations.length > 0 && (
												<span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
													+{occupyingReservations.length} occupying
												</span>
											)}
											<span className="text-xs text-gray-500">{totalCount} total</span>
										</div>
									</div>
									{totalCount === 0 ? (
										<div className="px-3 py-3 text-sm text-gray-400 italic">No reservations</div>
									) : (
										<div className="divide-y">
											{directReservations.map((r: any, i: number) => renderReservationRow(r, i, false))}
											{occupyingReservations.map((r: any, i: number) => renderReservationRow(r, i, true))}
										</div>
									)}
								</div>
							);
						})}
					</div>
				</div>
			</div>
			);
		})()}

		{/* Customer History Modal */}
		{showHistoryModal && (
			<div className="fixed inset-0 z-[80] flex items-center justify-center bg-black bg-opacity-40">
				<div className="w-full max-w-lg max-h-[80vh] overflow-y-auto border-0 p-0" style={{ ...PAY_NEO.modalShell }}>
					<div className="flex items-center justify-between gap-3 px-4 py-3" style={{ ...PAY_NEO.raised, borderRadius: '14px 14px 0 0' }}>
						<div className="text-lg font-semibold text-slate-800">Customer History</div>
						<button type="button" className={'rounded-[10px] border-0 px-3 py-1.5 text-sm font-semibold text-slate-700 touch-manipulation select-none hover:brightness-[1.03] ' + NEO_MODAL_BTN_PRESS + ' ' + NEO_PREP_TIME_BTN_PRESS} style={{ ...PAY_NEO.key }} onClick={() => setShowHistoryModal(false)}>Close</button>
					</div>
					<div className="space-y-2 px-4 pb-4 pt-2" style={{ background: PAY_NEO_CANVAS }}>
						{customerHistory.length === 0 ? (
							<div className="text-gray-500 text-center py-4">No history found</div>
						) : (
							customerHistory.map((history: any, index: number) => (
								<div key={index} className="rounded-[14px] p-3" style={{ ...PAY_NEO.inset }}>
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
				<div className="w-full max-w-sm border-0 p-0" style={{ ...PAY_NEO.modalShell }}>
					<div className="flex items-center justify-between gap-3 px-4 py-3" style={{ ...PAY_NEO.raised, borderRadius: '14px 14px 0 0' }}>
						<div className="text-base font-semibold text-slate-800">Select action</div>
						<button type="button" className={`flex h-10 w-10 flex-shrink-0 touch-manipulation select-none items-center justify-center rounded-full border-[3px] border-red-500 hover:brightness-[1.03] ${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS}`} style={{ ...PAY_NEO.raised }} onClick={() => { setConfirmModalOpen(false); setConfirmTarget(null); }} aria-label="Close">
							<svg className="h-5 w-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					</div>
					<div className="px-4 pb-4 pt-2" style={{ background: PAY_NEO_CANVAS }}>
					<div className="mb-4 text-sm text-slate-700">
						{confirmTarget?.name} • {confirmTarget?.phone}
					</div>
					<div className="flex items-center justify-end gap-2">
                        <button type="button" className={`rounded-[10px] border-0 px-3 py-2 text-sm font-semibold text-red-800 touch-manipulation select-none ${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS}`} style={{ ...PAY_NEO.key, background: '#f1d5d8' }} onClick={() => { if (confirmTarget) { setCancelledLabelMap((prev: Record<string, 'Cancel' | 'No Show'>) => ({ ...prev, [confirmTarget.id]: 'Cancel' })); handleReservationAction('cancel', confirmTarget.name, confirmTarget.phone, confirmTarget.id); } setConfirmModalOpen(false); }}>Cancel</button>
						<button type="button" className={`rounded-[10px] border-0 px-3 py-2 text-sm font-semibold text-amber-900 touch-manipulation select-none ${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS}`} style={{ ...PAY_NEO.key, background: '#fde8d0' }} onClick={() => { if (confirmTarget) { handleReservationAction('no_show', confirmTarget.name, confirmTarget.phone, confirmTarget.id); } setConfirmModalOpen(false); }}>No Show</button>
					</div>
					</div>
				</div>
			</div>
		)}

		{/* Detail Reservation Modal (per-slot input) */}
		{showDetailModal && (
			<div className="fixed inset-0 z-[70] flex items-center justify-center bg-black bg-opacity-50">
				<div className="w-full max-w-lg border-0 p-0" style={{ ...PAY_NEO.modalShell }}>
					<div className="flex items-center justify-between gap-3 px-4 py-3" style={{ ...PAY_NEO.raised, borderRadius: '14px 14px 0 0' }}>
						<div className="min-w-0 text-sm font-semibold text-slate-800">{rescheduleMode ? 'Reschedule' : 'Add'} • {date} {selectedSlotTime}</div>
						<button type="button" className={`rounded-[10px] border-0 px-3 py-1.5 text-sm font-semibold text-slate-700 touch-manipulation select-none ${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS}`} style={{ ...PAY_NEO.key }} onClick={() => { setShowDetailModal(false); setRescheduleMode(false); setRescheduleTarget(null); setSoftKbOpen(false); setSoftKbTarget(null); }}>Back</button>
					</div>
					<div className="p-5" style={{ background: PAY_NEO_CANVAS }}>
					{/* Row 1: Name (4), Phone (4), Party Size (2) */}
					<div className="grid grid-cols-10 gap-2">
						<div className="col-span-4">
							<label className="block text-sm font-medium mb-1">Name</label>
							<div className="relative">
								<input id="detail-modal-name-input" className="w-full border-0 px-3 py-2 pr-12 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-400/60" style={{ ...PAY_NEO.inset }} value={name} onChange={e=>setName(autoCapitalizeName(e.target.value))} onFocus={() => { setSoftKbTarget('name'); setSoftKbOpen(true); }} placeholder="Customer name" />
								<button type="button" className={'absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 touch-manipulation select-none items-center justify-center text-slate-700 hover:brightness-[1.03] ' + NEO_PREP_TIME_BTN_PRESS} style={{ ...PAY_KEYPAD_KEY }} title="Open Keyboard" onClick={() => { setSoftKbTarget('name'); setSoftKbOpen(true); }}>
									<KeyboardIcon size={22} />
								</button>
							</div>
						</div>
						<div className="col-span-4">
							<label className="block text-sm font-medium mb-1">Phone</label>
							<div className="relative">
								<input className="w-full border-0 px-3 py-2 pr-12 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-400/60" style={{ ...PAY_NEO.inset }} value={phone} onChange={e=>setPhone(formatPhone(e.target.value))} onFocus={() => { if (softKbOpen) setSoftKbTarget('phone'); }} placeholder="Contact number" />
								<button type="button" className={'absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 touch-manipulation select-none items-center justify-center text-slate-700 hover:brightness-[1.03] ' + NEO_PREP_TIME_BTN_PRESS} style={{ ...PAY_KEYPAD_KEY }} title="Open Keyboard" onClick={() => { setSoftKbTarget('phone'); setSoftKbOpen(true); }}>
									<KeyboardIcon size={22} />
								</button>
							</div>
						</div>
						<div className="col-span-2">
							<label className="block text-sm font-medium mb-1">Party</label>
							<select className="w-full cursor-pointer border-0 px-2 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-400/60" style={{ ...PAY_NEO.inset, background: PAY_NEO_CANVAS }} value={partySize} onChange={e => setPartySize(e.target.value)}>
								<option value="">—</option>
								{PARTY_SIZE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.value} ({calcTablesNeeded(Number(o.value))}T)</option>)}
							</select>
						</div>
					</div>
					{/* Row 2: Deposit, Channel segmented */}
					<div className="mt-3 flex gap-3">
						<div className="w-[32%]">
							<label className="block text-sm font-medium mb-1">Deposit</label>
							<div className="relative">
								<input className="w-full border-0 px-3 py-2 pr-12 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-400/60" style={{ ...PAY_NEO.inset }} value={deposit} onChange={e=>setDeposit(e.target.value.replace(/[^0-9.]/g,''))} onFocus={() => { if (softKbOpen) setSoftKbTarget('deposit'); }} placeholder="0" />
								<button type="button" className={'absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 touch-manipulation select-none items-center justify-center text-slate-700 hover:brightness-[1.03] ' + NEO_PREP_TIME_BTN_PRESS} style={{ ...PAY_KEYPAD_KEY }} title="Open Keyboard" onClick={() => { setSoftKbTarget('deposit'); setSoftKbOpen(true); }}>
									<KeyboardIcon size={22} />
								</button>
							</div>
						</div>
						<div className="w-[68%]">
							<label className="block text-sm font-medium mb-1">Channel</label>
							<div className="flex gap-2">
								{(['Walk-in','Phone','Online'] as const).map((c) => (
									<button type="button" key={c} onClick={()=>setChannel(c)} className={(channel === c ? 'text-white ' + NEO_COLOR_BTN_PRESS : 'text-slate-800 ' + NEO_MODAL_BTN_PRESS + ' ' + NEO_PREP_TIME_BTN_PRESS) + ' flex-1 touch-manipulation select-none rounded-[10px] border-0 px-3 py-2 text-xs font-semibold'} style={channel === c ? { ...PAY_NEO_PRIMARY_BLUE } : { ...PAY_NEO.key }}>{c}</button>
								))}
							</div>
						</div>
					</div>
					<div className="mt-4 flex items-center justify-end gap-2">
						<button type="button" className={'rounded-[12px] border-0 px-4 py-2 text-sm font-semibold text-slate-800 touch-manipulation select-none hover:brightness-[1.03] ' + NEO_MODAL_BTN_PRESS + ' ' + NEO_PREP_TIME_BTN_PRESS} style={{ ...PAY_NEO.key }} onClick={()=>{ setShowDetailModal(false); setRescheduleMode(false); setRescheduleTarget(null); setSoftKbOpen(false); setSoftKbTarget(null); }}>Cancel</button>
						<button type="button" className={'rounded-[12px] border-0 px-4 py-2 text-sm font-semibold text-white touch-manipulation select-none disabled:opacity-50 ' + NEO_COLOR_BTN_PRESS} style={{ ...PAY_NEO_PRIMARY_BLUE }} onClick={async ()=>{
							try {
								// Validation
								if (!name.trim()) { alert('Please enter customer name.'); return; }
								if (!phone.trim()) { alert('Please enter phone number.'); return; }
								if (!partySize || Number(partySize) < 1) { alert('Please enter party size (at least 1).'); return; }
								if (!date) { alert('Please select a date.'); return; }
								if (!selectedSlotTime) { alert('Please select a time slot.'); return; }

								setSaving(true);
								const payload:any = { customer_name:name.trim(), phone_number:phone.trim(), reservation_date:date, reservation_time:selectedSlotTime, party_size:Number(partySize), special_requests: JSON.stringify({ channel, deposit: Number(deposit||'0') }) };
								const res = await fetch(`${API_URL}/reservations/reservations`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
								if (!res.ok) {
									const errText = await res.text().catch(() => 'Failed');
									throw new Error(errText || 'Failed');
								}

								// Reset form fields
								setName(''); setPhone(''); setPartySize(''); setDeposit(''); setNote(''); setChannel('Walk-in');

								// Refresh reservations for the selected date
								try {
									const refreshRes = await fetch(`${API_URL}/reservations/reservations?date=${encodeURIComponent(date)}`);
									if (refreshRes.ok) {
										const list = await refreshRes.json();
										const grouped: Record<string, any[]> = {};
										(Array.isArray(list) ? list : []).forEach((r: any) => {
											const t = String(r?.reservation_time || '').slice(0,5);
											if (!grouped[t]) grouped[t] = [];
											grouped[t].push(r);
										});
										setReservationsByTime(grouped);
									}
								} catch {}

								// Refresh today's reservations
								try {
									const todayRes = await fetch(`${API_URL}/reservations/reservations?date=${encodeURIComponent(today)}`);
									if (todayRes.ok) {
										const list = await todayRes.json();
										setTodayReservations(Array.isArray(list) ? list : []);
									}
								} catch {}

								setShowDetailModal(false);
								setRescheduleMode(false);
								setRescheduleTarget(null);
								setSoftKbOpen(false);
								setSoftKbTarget(null);
								if (onCreated) onCreated();
							} catch (e:any) {
								alert(String(e?.message||'Failed to save'));
							} finally {
								setSaving(false);
							}
						}} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
					</div>
					</div>
				</div>
			</div>
		)}

		{/* Timeline New Reservation Modal — PAY_NEO shell + inset fields (keyboard below) */}
		{showTimelineForm && (
			<div className="fixed inset-0 z-[70] flex items-end justify-center pointer-events-none" style={{ paddingBottom: '380px' }}>
				<div className="fixed inset-0 bg-black/40 pointer-events-auto" style={{ zIndex: -1 }} onClick={() => { if (softKbOpen) return; setShowTimelineForm(false); setTlFormError(null); setSoftKbOpen(false); setSoftKbTarget(null); }} />
				<div
					className="mb-[15px] w-[700px] max-w-[95vw] pointer-events-auto overflow-hidden border-0 p-0"
					style={{ ...PAY_NEO.modalShell }}
					onClick={e => e.stopPropagation()}
				>
					<div className="flex items-center justify-between gap-3 px-4 py-3" style={{ ...PAY_NEO.raised, borderRadius: '14px 14px 0 0' }}>
						<span className="font-bold text-lg text-slate-800">New Reservation • {date}</span>
						<button
							type="button"
							onClick={() => { setShowTimelineForm(false); setTlFormError(null); setSoftKbOpen(false); setSoftKbTarget(null); }}
							className={`flex h-11 w-11 flex-shrink-0 touch-manipulation select-none items-center justify-center rounded-full border-[3px] border-red-500 hover:brightness-[1.03] ${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS}`}
							style={{ ...PAY_NEO.raised }}
							aria-label="Close"
						>
							<svg className="h-5 w-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					</div>
					<div className="space-y-3 p-5" style={{ background: PAY_NEO_CANVAS }}>
						{tlFormError && (
							<div className="rounded-[14px] px-3 py-2 text-sm text-red-700" style={{ ...PAY_NEO.inset, background: '#fee2e2' }}>
								{tlFormError}
							</div>
						)}
						<div className="grid grid-cols-2 gap-4">
							<div>
								<label className="mb-1 block text-xs font-semibold text-slate-600">Name</label>
								<input
									id="timeline-form-name-input"
									className="w-full border-0 px-3 py-2.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-400/60"
									style={{ ...PAY_NEO.inset }}
									placeholder="Guest name"
									value={tlFormName}
									onChange={e => setTlFormName(autoCapitalizeName(e.target.value))}
									onFocus={() => { setSoftKbOpen(true); setSoftKbTarget('tl_name'); }}
								/>
							</div>
							<div>
								<label className="mb-1 block text-xs font-semibold text-slate-600">Phone</label>
								<input
									className="w-full border-0 px-3 py-2.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-400/60"
									style={{ ...PAY_NEO.inset }}
									placeholder="XXX-XXX-XXXX"
									value={tlFormPhone}
									onChange={e => setTlFormPhone(formatPhone(e.target.value))}
									onFocus={() => { setSoftKbOpen(true); setSoftKbTarget('tl_phone'); }}
								/>
							</div>
						</div>
						<div className="grid grid-cols-3 gap-4">
							<div>
								<label className="mb-1 block text-xs font-semibold text-slate-600">Party Size</label>
								<select
									className="w-full cursor-pointer border-0 px-3 py-2.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-400/60"
									style={{ ...PAY_NEO.inset, background: PAY_NEO_CANVAS }}
									value={tlFormParty}
									onChange={e => setTlFormParty(e.target.value)}
								>
									<option value="">—</option>
									{PARTY_SIZE_OPTIONS.map(o => (
										<option key={o.value} value={o.value}>{o.label}</option>
									))}
								</select>
							</div>
							<div>
								<label className="mb-1 block text-xs font-semibold text-slate-600">Deposit ($)</label>
								<input
									className="w-full border-0 px-3 py-2.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-400/60"
									style={{ ...PAY_NEO.inset }}
									type="number"
									min="0"
									placeholder="0"
									value={tlFormDeposit}
									onChange={e => setTlFormDeposit(e.target.value.replace(/[^0-9.]/g, ''))}
									onFocus={() => { setSoftKbOpen(true); setSoftKbTarget('tl_deposit'); }}
								/>
							</div>
							<div>
								<label className="mb-1 block text-xs font-semibold text-slate-600">Channel</label>
								<div className="flex gap-1">
									{(['Walk-in', 'Phone', 'Online'] as const).map(ch => (
										<button
											type="button"
											key={ch}
											className={`flex-1 touch-manipulation select-none rounded-[10px] border-0 py-2 text-xs font-semibold ${tlFormChannel === ch ? `text-white ${NEO_COLOR_BTN_PRESS}` : `text-slate-800 ${NEO_MODAL_BTN_PRESS} ${NEO_PREP_TIME_BTN_PRESS}`}`}
											style={tlFormChannel === ch ? { ...PAY_NEO_PRIMARY_BLUE } : { ...PAY_NEO.key }}
											onClick={() => setTlFormChannel(ch)}
										>
											{ch}
										</button>
									))}
								</div>
							</div>
						</div>
						<div className="grid grid-cols-2 gap-4">
							<div>
								<label className="mb-1 block text-xs font-semibold text-slate-600">Reservation Time</label>
								<div className="flex gap-2">
									<select
										className="min-w-0 flex-1 cursor-pointer border-0 px-3 py-2.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-400/60"
										style={{ ...PAY_NEO.inset, background: PAY_NEO_CANVAS }}
										value={tlFormHour}
										onChange={e => setTlFormHour(e.target.value)}
									>
										{Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map(h => (
											<option key={h} value={h}>{h}</option>
										))}
									</select>
									<select
										className="min-w-0 flex-1 cursor-pointer border-0 px-3 py-2.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-400/60"
										style={{ ...PAY_NEO.inset, background: PAY_NEO_CANVAS }}
										value={tlFormMinute}
										onChange={e => setTlFormMinute(e.target.value)}
									>
										{['00', '15', '30', '45'].map(m => (
											<option key={m} value={m}>{m}</option>
										))}
									</select>
									<select
										className="w-20 cursor-pointer border-0 px-2 py-2.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-400/60"
										style={{ ...PAY_NEO.inset, background: PAY_NEO_CANVAS }}
										value={tlFormAmpm}
										onChange={e => setTlFormAmpm(e.target.value as 'AM' | 'PM')}
									>
										<option value="AM">AM</option>
										<option value="PM">PM</option>
									</select>
								</div>
							</div>
							<div className="flex items-end">
								<button
									type="button"
									className={`w-full rounded-[14px] border-0 px-4 py-2.5 text-base font-bold text-white disabled:opacity-50 ${NEO_COLOR_BTN_PRESS}`}
									style={PAY_NEO_PRIMARY_BLUE}
									disabled={tlFormSaving}
									onClick={handleTimelineFormSave}
								>
									{tlFormSaving ? 'Saving...' : 'Save Reservation'}
								</button>
							</div>
						</div>
					</div>
				</div>
			</div>
		)}

		{/* Soft Virtual Keyboard — rendered at top-level Fragment so it's above all modals */}
		{softKbOpen && (
			<VirtualKeyboard
				open={softKbOpen}
				title={''}
				bottomOffsetPx={(showTimelineForm ? 100 : kbBottomOffset) - 15}
				zIndex={2147483647}
				languages={['EN']}
				currentLanguage={kbLang}
				onToggleLanguage={(next)=>setKbLang(next)}
				displayText={softKbTarget==='name'?name:softKbTarget==='phone'?phone:softKbTarget==='party'?partySize:softKbTarget==='deposit'?deposit:softKbTarget==='tl_name'?tlFormName:softKbTarget==='tl_phone'?tlFormPhone:softKbTarget==='tl_party'?tlFormParty:softKbTarget==='tl_deposit'?tlFormDeposit:''}
				onRequestClose={() => { setSoftKbOpen(false); setSoftKbTarget(null); }}
				onType={(k)=>{
					if (softKbTarget==='name') setName(prev=>autoCapitalizeName(`${prev||''}${k}`));
					if (softKbTarget==='phone') setPhone(prev=>formatPhone(`${prev||''}${k}`));
					if (softKbTarget==='party') setPartySize(prev=>`${(prev||'').replace(/[^0-9]/g,'')}${k}`.replace(/[^0-9]/g,''));
					if (softKbTarget==='deposit') setDeposit(prev=>{
						const next=`${prev||''}${k}`;
						const sanitized=next.replace(/[^0-9.]/g,'');
						const dots=(sanitized.match(/\./g)||[]).length;
						return dots>1 ? (prev||'') : sanitized;
					});
					if (softKbTarget==='tl_name') setTlFormName(prev=>autoCapitalizeName(`${prev||''}${k}`));
					if (softKbTarget==='tl_phone') setTlFormPhone(prev=>formatPhone(`${prev||''}${k}`));
					if (softKbTarget==='tl_party') setTlFormParty(prev=>`${(prev||'').replace(/[^0-9]/g,'')}${k}`.replace(/[^0-9]/g,''));
					if (softKbTarget==='tl_deposit') setTlFormDeposit(prev=>{
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
					if (softKbTarget==='tl_name') setTlFormName(prev=>prev?prev.slice(0,-1):'');
					if (softKbTarget==='tl_phone') setTlFormPhone(prev=>{
						const d = onlyDigits(prev||'');
						return formatPhone(d ? d.slice(0, -1) : '');
					});
					if (softKbTarget==='tl_party') setTlFormParty(prev=>prev?String(prev).slice(0,-1):'');
					if (softKbTarget==='tl_deposit') setTlFormDeposit(prev=>prev?String(prev).slice(0,-1):'');
				}}
				onClear={()=>{
					if (softKbTarget==='name') setName('');
					if (softKbTarget==='phone') setPhone('');
					if (softKbTarget==='party') setPartySize('');
					if (softKbTarget==='deposit') setDeposit('');
					if (softKbTarget==='tl_name') setTlFormName('');
					if (softKbTarget==='tl_phone') setTlFormPhone('');
					if (softKbTarget==='tl_party') setTlFormParty('');
					if (softKbTarget==='tl_deposit') setTlFormDeposit('');
				}}
			/>
		)}

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


