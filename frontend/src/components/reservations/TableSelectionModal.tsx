import React, { useState, useEffect } from 'react';
import { API_URL } from '../../config/constants';
import {
	NEO_COLOR_BTN_PRESS_SNAP,
	NEO_PREP_TIME_BTN_PRESS_SNAP,
	NEO_PRESS_INSET_ONLY_NO_SHIFT,
	PAY_NEO,
	PAY_NEO_CANVAS,
} from '../../utils/softNeumorphic';

/** 녹색 Seated 칩 — idle 볼록 유지, :active 시 인셋으로 확실한 오목 눌림 */
const SEATED_GREEN_PRESS_INSET_SNAP =
	'[-webkit-tap-highlight-color:transparent] transition-[box-shadow,transform,filter] duration-0 ease-out active:!shadow-[inset_8px_8px_20px_rgba(0,0,0,0.58),inset_-4px_-4px_14px_rgba(255,255,255,0.22)] active:translate-y-px active:scale-[0.95] active:brightness-[0.86] disabled:translate-y-0 disabled:scale-100 disabled:brightness-100';

interface TableElement {
	id: number;
	type: string;
	position: { x: number; y: number };
	size: { width: number; height: number };
	rotation: number;
	text?: string;
	fontSize?: number;
	color?: string;
	status?: string;
}

interface TableSelectionModalProps {
	isOpen: boolean;
	onClose: () => void;
	onTableSelect: (tableId: number, tableName: string) => void;
	onTableStatusChange?: (tableId: number, tableName: string, status: 'Occupied' | 'Reserved' | 'Hold', customerName?: string) => void;
	partySize?: number;
	customerName?: string;
	customerPhone?: string;
	/** English formatted slot time */
	reservationSlotDisplay?: string;
	/** When the reservation was created */
	bookedAtDisplay?: string;
	/** Online / Phone / Walk-in */
	channelLabel?: string;
	reservationId?: string;
	onReservationCancel?: () => void | Promise<void>;
	onReservationNoShow?: () => void | Promise<void>;
}

const TableSelectionModal: React.FC<TableSelectionModalProps> = ({
	isOpen,
	onClose,
	onTableSelect,
	onTableStatusChange,
	partySize = 1,
	customerName = 'Guest',
	customerPhone,
	reservationSlotDisplay,
	bookedAtDisplay,
	channelLabel,
	reservationId,
	onReservationCancel,
	onReservationNoShow,
}) => {
	const [tables, setTables] = useState<TableElement[]>([]);
	const [loading, setLoading] = useState(false);

	// 테이블 상태별 색상 정의
	const getTableStatusColor = (status: string) => {
		const normalizedStatus = (status || '').toLowerCase();
		switch (normalizedStatus) {
			case 'available':
				return '#22C55E';
			case 'preparing':
				return '#F97316';
			case 'occupied':
				return '#EF4444';
			case 'reserved':
				return '#EAB308';
			case 'hold':
				return '#EAB308';
			default:
				return '#6B7280';
		}
	};

	// 테이블 목록 가져오기
	const fetchTables = async () => {
		setLoading(true);
		try {
			const response = await fetch(`${API_URL}/table-map/elements?floor=1F`);

			if (!response.ok) {
				throw new Error(`Failed to fetch tables: ${response.status} ${response.statusText}`);
			}

			const allTables = await response.json();

			if (!Array.isArray(allTables)) {
				setTables([]);
				return;
			}

			const tableTypeFiltered = allTables.filter((table: TableElement) => {
				return table.type === 'rounded-rectangle' || table.type === 'circle';
			});

			const availableTables = tableTypeFiltered.filter((table: TableElement) => {
				const status = (table.status || '').toLowerCase();
				return status === 'available' || status === 'preparing';
			});

			setTables(availableTables);
		} catch (error) {
			console.error('Error fetching tables:', error);
			setTables([]);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		if (isOpen) {
			fetchTables();
		}
	}, [isOpen]);

	// 테이블 상태 변경 함수
	const handleTableStatusChange = async (tableId: number, newStatus: 'Occupied' | 'Reserved' | 'Hold') => {
		try {
			const response = await fetch(`${API_URL}/table-map/elements/${tableId}/status`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: newStatus }),
			});

			if (response.ok) {
				const table = tables.find(t => t.id === tableId);
				const tableName = table?.text || `Table ${tableId}`;

				if (onTableStatusChange) {
					onTableStatusChange(tableId, tableName, newStatus, customerName);
				}

				setTables(prev => prev.filter(t => t.id !== tableId));
			} else {
				throw new Error('Failed to update table status');
			}
		} catch (error) {
			console.error('Error updating table status:', error);
			alert('Failed to update table status. Please try again.');
		}
	};

	if (!isOpen) return null;

	return (
		<div
			className="fixed inset-0 z-[110] flex items-center justify-center bg-black bg-opacity-50"
			onClick={onClose}
			role="presentation"
		>
			<div
				className="flex w-full max-h-[85vh] max-w-[min(1024px,96vw)] flex-col overflow-hidden rounded-2xl border-0 p-4 sm:p-5"
				style={{ ...PAY_NEO.modalShell, background: PAY_NEO_CANVAS }}
				onClick={e => e.stopPropagation()}
			>
				<div className="mb-3 flex shrink-0 items-center justify-between gap-3">
					<h3 className="min-w-0 text-lg font-bold text-gray-800">Select Table for Arrived Guest</h3>
					<button
						type="button"
						onClick={onClose}
						className={`flex h-10 w-10 flex-shrink-0 items-center justify-center border-0 text-xl font-bold text-gray-700 touch-manipulation ${NEO_PRESS_INSET_ONLY_NO_SHIFT}`}
						style={PAY_NEO.raised}
						title="Close"
					>
						×
					</button>
				</div>

				<div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
					<div className="space-y-2 rounded-[14px] p-2.5" style={PAY_NEO.inset}>
						<div className="space-y-2 text-sm leading-snug text-gray-800">
							<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
								<span className="font-semibold">{customerName}</span>
								<span className="text-gray-400" aria-hidden>
									·
								</span>
								<span>{customerPhone?.trim() ? customerPhone : '—'}</span>
								<span className="text-gray-400" aria-hidden>
									·
								</span>
								<span>{partySize}</span>
							</div>
							<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
								<span className="font-medium">{(channelLabel || '').trim() || '—'}</span>
								<span className="text-gray-400" aria-hidden>
									·
								</span>
								<span>{bookedAtDisplay ?? '—'}</span>
								<span className="text-gray-400" aria-hidden>
									·
								</span>
								<span>{reservationSlotDisplay ?? '—'}</span>
							</div>
						</div>
					</div>

					<div className="space-y-2 rounded-[14px] p-2.5" style={PAY_NEO.inset}>
						<div className="text-sm font-semibold text-gray-800">Tables</div>
						{loading ? (
							<div className="flex items-center justify-center py-12 text-base text-gray-600">Loading tables...</div>
						) : tables.length === 0 ? (
							<div className="space-y-1 py-6 text-center">
								<div className="text-base font-medium text-gray-700">No available tables</div>
								<div className="text-sm text-gray-600">All tables are currently occupied or reserved</div>
							</div>
						) : (
							<>
								<p className="text-sm text-gray-600">Select an available or preparing table for the arrived guest</p>
								<div className="grid grid-cols-5 gap-2">
									{tables.map(table => {
										const statusLower = (table.status || '').toLowerCase();
										const isAvailable = statusLower === 'available';
										const seatedPressClass = isAvailable ? SEATED_GREEN_PRESS_INSET_SNAP : NEO_COLOR_BTN_PRESS_SNAP;
										const seatedChipStyle: React.CSSProperties = isAvailable
											? {
													background: 'linear-gradient(155deg, #4ade80 0%, #22c55e 42%, #15803d 100%)',
													boxShadow:
														'8px 8px 20px rgba(0, 64, 32, 0.55), -5px -5px 16px rgba(255, 255, 255, 0.35), inset 0 2px 0 rgba(255, 255, 255, 0.35)',
												}
											: {
													backgroundColor: getTableStatusColor(table.status || 'available'),
													background:
														statusLower === 'hold'
															? '#EAB308'
															: getTableStatusColor(table.status || 'available'),
													boxShadow: 'inset 2px 2px 6px rgba(0,0,0,0.15)',
												};
										return (
										<div key={table.id} className="flex min-w-0 flex-col items-center space-y-2 rounded-[10px] p-1.5 sm:p-2" style={PAY_NEO.key}>
											<button
												type="button"
												onClick={e => {
													e.stopPropagation();
													handleTableStatusChange(table.id, 'Occupied');
												}}
												className={`flex min-h-[96px] w-[96px] flex-col items-center justify-center gap-0.5 border-0 px-1 py-1.5 text-center touch-manipulation ${
													table.type === 'circle' ? 'rounded-full' : 'rounded-lg'
												} ${seatedPressClass}`}
												style={seatedChipStyle}
											>
												<span className="max-w-[88px] truncate text-xl font-bold leading-tight text-white drop-shadow-sm">
													{table.text || table.id}
												</span>
												<span className="text-xs font-semibold leading-tight text-white/95 drop-shadow-sm">Seated</span>
											</button>
											<button
												type="button"
												onClick={e => {
													e.stopPropagation();
													const currentStatus = (table.status || '').toLowerCase();
													const newStatus = currentStatus === 'available' ? 'Reserved' : 'Hold';
													handleTableStatusChange(table.id, newStatus);
												}}
												className={`flex w-full min-h-[44px] items-center justify-center border-0 px-1 py-2 text-xs font-semibold text-gray-900 touch-manipulation ${NEO_PREP_TIME_BTN_PRESS_SNAP}`}
												style={PAY_NEO.key}
											>
												Hold
											</button>
										</div>
										);
									})}
								</div>
							</>
						)}
					</div>
				</div>

				<div className="mt-4 flex shrink-0 flex-wrap items-center justify-between gap-2">
					<div className="flex flex-wrap gap-2">
						{reservationId && onReservationCancel && (
							<button
								type="button"
								onClick={() => void onReservationCancel()}
								className={`min-w-[152px] whitespace-nowrap rounded-[10px] border-0 px-4 py-3 text-sm font-semibold text-red-800 touch-manipulation ${NEO_PRESS_INSET_ONLY_NO_SHIFT}`}
								style={PAY_NEO.key}
							>
								Cancel Reservation
							</button>
						)}
						{reservationId && onReservationNoShow && (
							<button
								type="button"
								onClick={() => void onReservationNoShow()}
								className={`min-w-[100px] rounded-[10px] border-0 px-4 py-3 text-sm font-semibold text-amber-900 touch-manipulation ${NEO_PRESS_INSET_ONLY_NO_SHIFT}`}
								style={PAY_NEO.key}
							>
								No Show
							</button>
						)}
					</div>
					<button
						type="button"
						onClick={onClose}
						className={`min-w-[110px] rounded-[10px] border-0 px-5 py-3 text-base font-semibold text-gray-900 touch-manipulation ${NEO_PRESS_INSET_ONLY_NO_SHIFT}`}
						style={PAY_NEO.key}
					>
						Close
					</button>
				</div>
			</div>
		</div>
	);
};

export default TableSelectionModal;
