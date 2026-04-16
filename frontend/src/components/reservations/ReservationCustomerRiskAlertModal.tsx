import React from 'react';
import {
	NEO_COLOR_BTN_PRESS_SNAP,
	NEO_MODAL_BTN_PRESS,
	NEO_PREP_TIME_BTN_PRESS,
	PAY_NEO,
	PAY_NEO_CANVAS,
} from '../../utils/softNeumorphic';

export type CustomerRiskRow = {
	reservation_date?: string;
	reservation_time?: string;
	status?: string;
	customer_name?: string;
	phone_number?: string;
};

export interface ReservationCustomerRiskAlertModalProps {
	isOpen: boolean;
	noShow: CustomerRiskRow[];
	cancelled: CustomerRiskRow[];
	onDismiss: () => void;
}

const NEO_MODAL_BTN_PRESS_LOCAL = NEO_MODAL_BTN_PRESS;

function formatRowWhen(r: CustomerRiskRow): string {
	try {
		const raw = r.reservation_date;
		if (raw == null || raw === '') return '—';
		const d = new Date(String(raw).slice(0, 10));
		if (Number.isNaN(d.getTime())) return String(raw);
		const dateStr = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
		const t = String(r.reservation_time || '').slice(0, 5);
		return t ? `${dateStr} at ${t}` : dateStr;
	} catch {
		return '—';
	}
}

/**
 * New Reservation — past 2 years No-show / Cancelled history (alert only).
 */
const ReservationCustomerRiskAlertModal: React.FC<ReservationCustomerRiskAlertModalProps> = ({
	isOpen,
	noShow,
	cancelled,
	onDismiss,
}) => {
	if (!isOpen) return null;

	const hasNoShow = noShow.length > 0;
	const hasCancelled = cancelled.length > 0;

	return (
		<div
			className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4"
			onClick={onDismiss}
			role="presentation"
		>
			<div
				className="w-full max-w-md overflow-hidden rounded-2xl border-0 p-0 shadow-xl"
				style={{ ...PAY_NEO.modalShell, background: PAY_NEO_CANVAS }}
				onClick={e => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-labelledby="customer-risk-alert-title"
			>
				<div className="flex items-center justify-between gap-3 px-4 py-3" style={{ ...PAY_NEO.raised, borderRadius: '14px 14px 0 0' }}>
					<h2 id="customer-risk-alert-title" className="text-base font-bold text-amber-900">
						Customer history alert
					</h2>
					<button
						type="button"
						className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border-[3px] border-red-500 text-red-600 ${NEO_MODAL_BTN_PRESS_LOCAL} ${NEO_PREP_TIME_BTN_PRESS}`}
						style={{ ...PAY_NEO.raised }}
						onClick={onDismiss}
						aria-label="Close"
					>
						<svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>
				<div className="max-h-[min(60vh,420px)] space-y-4 overflow-y-auto px-4 py-4 text-sm text-slate-800" style={{ background: PAY_NEO_CANVAS }}>
					<p className="text-xs leading-relaxed text-slate-600">
						The last 2 years include reservation rows linked to this phone or name. You can still continue — this is for staff awareness only.
					</p>

					{hasNoShow && (
						<div className="rounded-[12px] px-3 py-2.5" style={{ ...PAY_NEO.inset, background: '#fff7ed' }}>
							<div className="mb-2 font-semibold text-orange-900">No-show history</div>
							<ul className="list-inside list-disc space-y-1.5 text-slate-800">
								{noShow.map((r, i) => (
									<li key={`ns-${i}-${r.reservation_date}-${r.reservation_time}`}>
										<span className="font-medium">{formatRowWhen(r)}</span>
										{r.customer_name ? <span className="text-slate-600"> — {r.customer_name}</span> : null}
									</li>
								))}
							</ul>
						</div>
					)}

					{hasCancelled && (
						<div className="rounded-[12px] px-3 py-2.5" style={{ ...PAY_NEO.inset, background: '#fef2f2' }}>
							<div className="mb-2 font-semibold text-red-900">Cancelled reservation history</div>
							<ul className="list-inside list-disc space-y-1.5 text-slate-800">
								{cancelled.map((r, i) => (
									<li key={`cx-${i}-${r.reservation_date}-${r.reservation_time}`}>
										<span className="font-medium">{formatRowWhen(r)}</span>
										{r.customer_name ? <span className="text-slate-600"> — {r.customer_name}</span> : null}
									</li>
								))}
							</ul>
						</div>
					)}
				</div>
				<div className="flex justify-end border-t border-slate-200/60 px-4 py-3" style={{ background: PAY_NEO_CANVAS }}>
					<button
						type="button"
						onClick={onDismiss}
						className={`min-w-[100px] rounded-[12px] border-0 px-5 py-2.5 text-sm font-semibold text-white ${NEO_COLOR_BTN_PRESS_SNAP}`}
						style={{ ...PAY_NEO_PRIMARY_BLUE }}
					>
						OK
					</button>
				</div>
			</div>
		</div>
	);
};

const PAY_NEO_PRIMARY_BLUE = {
	...PAY_NEO.raised,
	background: 'linear-gradient(145deg, #3b82f6, #1d4ed8)',
	color: '#ffffff',
	boxShadow: '5px 5px 12px rgba(29, 78, 216, 0.45), -3px -3px 10px rgba(255, 255, 255, 0.25)',
};

export default ReservationCustomerRiskAlertModal;
