import React, { useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { OrderItem } from '../pages/order/orderTypes';
import { DndContext, PointerSensor, useSensor, useSensors, DragEndEvent, useDraggable, useDroppable, DragOverlay, defaultDropAnimationSideEffects, useDndContext } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { X } from 'lucide-react';

interface SplitBillModalProps {
	isOpen: boolean;
	onClose: () => void;
	orderItems: OrderItem[];
	guestIds?: number[];
	guestStatusMap?: Record<number, 'PAID' | 'PARTIAL' | 'UNPAID'>;
	onSelectGuest: (mode: 'ALL' | number) => void;
	onPayInFull?: () => void;
	onMoveItem: (rowIndex: number, targetGuest: number) => void;
	onReorderLeft: (sourceRowIndex: number, destIndex: number) => void;
	onSplitItemEqual: (rowIndex: number) => void;
	onShareSelected?: (rowIndex: number, guests: number[]) => void;
	onResetSplit?: () => void;
  modalWidth?: number;
  modalHeight?: number;
}

const DraggableRow: React.FC<{ id: string; rowIndex: number; className?: string; children: React.ReactNode; onClick?: (e: React.MouseEvent<HTMLDivElement>) => void; disabled?: boolean }> = ({ id, rowIndex, className, children, onClick, disabled }) => {
	const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `${id}__rowIndex_${rowIndex}` });
	const style = {
		transform: transform ? CSS.Translate.toString(transform) : undefined,
		opacity: isDragging ? 0.6 : 1,
		transition: isDragging ? 'transform 150ms cubic-bezier(0.2, 0, 0, 1)' : undefined,
		cursor: disabled ? ('not-allowed' as const) : (isDragging ? ('grabbing' as const) : ('grab' as const)),
		pointerEvents: disabled ? 'none' as const : undefined,
	};
			return (
		<div ref={setNodeRef} style={style} className={className} onClick={onClick} {...(!disabled ? listeners : {})} {...(!disabled ? attributes : {})}>
			{children}
		</div>
	);
};

type DroppableGuestProps = React.HTMLAttributes<HTMLDivElement> & { guest: number; className?: string; children: React.ReactNode };
const DroppableGuest: React.FC<DroppableGuestProps> = ({ guest, className, children, ...rest }) => {
	const { isOver, setNodeRef } = useDroppable({ id: `guest-${guest}` });
	return (
		<div ref={setNodeRef} className={`${className || ''} ${isOver ? 'ring-2 ring-blue-500 ring-offset-1' : ''}`} {...rest}>
			{children}
		</div>
	);
};

const LeftDropSlot: React.FC<{ index: number }> = ({ index }) => {
	const { isOver, setNodeRef } = useDroppable({ id: `left-slot-${index}` });
	return (
		<div ref={setNodeRef} className={`h-0.5 my-px rounded ${isOver ? 'bg-blue-300/60' : 'bg-transparent'}`} />
	);
};

const OverlayContent: React.FC<{ orderItems: OrderItem[]; formatMoney: (n: number) => string }> = ({ orderItems, formatMoney }) => {
	const { active } = useDndContext();
	const id = String(active?.id || '');
	const m = id.match(/__rowIndex_(\d+)$/);
	if (!m) return null;
	const rowIndex = Number(m[1]);
	if (!Number.isFinite(rowIndex)) return null;
	const it = orderItems[rowIndex];
	if (!it || it.type === 'separator') return null;
	return (
		<div className="pointer-events-none select-none border rounded-lg bg-white shadow-xl px-3 py-2">
			<div className="text-base font-semibold text-gray-800 truncate max-w-[260px]">{it.name}</div>
			<div className="text-sm text-gray-600">x{it.quantity} • ${formatMoney(it.totalPrice * it.quantity)}</div>
		</div>
	);
};

// Helper component for the Pay Card (can show split guest placeholder on top)
const SplitBillPayCard: React.FC<{
  rowBgClass: string;
  splitGuestId: number;
  showSplitGuest: boolean;
  guestSubtotals: Record<string, number>;
  guestStatusMap?: Record<number, 'PAID' | 'PARTIAL' | 'UNPAID'>;
  itemsByGuest: Record<string, Array<{ rowIndex: number; item: OrderItem }>>;
  isShareSelectedMode: boolean;
  shareSelectedRowIndex: number | null;
  setShareSelectedRowIndex: React.Dispatch<React.SetStateAction<number | null>>;
  shareTargetGuests: Set<number>;
  toggleShareTargetGuest: (guest: number) => void;
  isMoveMode: boolean;
  moveSelectedRowIndex: number | null;
  setMoveSelectedRowIndex: React.Dispatch<React.SetStateAction<number | null>>;
  setMoveTargetGuest: React.Dispatch<React.SetStateAction<number | null>>;
  onMoveItem: (rowIndex: number, targetGuest: number) => void;
  isSplitSelectMode: boolean;
  setIsSplitSelectMode: (mode: boolean) => void;
  preselectedRowIndex: number | null;
  setPreselectedRowIndex: React.Dispatch<React.SetStateAction<number | null>>;
  onSplitItemEqual: (rowIndex: number) => void;
  onPayInFull?: () => void;
  onSelectGuest: (mode: 'ALL' | number) => void;
  onClose: () => void;
  isShareActionActive: boolean;
  formatMoney: (n: number) => string;
}> = ({
  rowBgClass,
  splitGuestId,
  showSplitGuest,
  guestSubtotals,
  guestStatusMap,
  itemsByGuest,
  isShareSelectedMode,
  shareSelectedRowIndex,
  setShareSelectedRowIndex,
  shareTargetGuests,
  toggleShareTargetGuest,
  isMoveMode,
  moveSelectedRowIndex,
  setMoveSelectedRowIndex,
  setMoveTargetGuest,
  onMoveItem,
  isSplitSelectMode,
  setIsSplitSelectMode,
  preselectedRowIndex,
  setPreselectedRowIndex,
  onSplitItemEqual,
  onPayInFull,
  onSelectGuest,
  onClose,
  isShareActionActive,
  formatMoney,
}) => {
  // --- HELPERS FOR ITEM RENDERING (DUPLICATED FROM PARENT OR SHARED) ---
  // We need these to render the items in the "Top Half" guest card
  const getBaseId = (it: OrderItem) => {
		const raw = String(it.id || '');
		const parts = raw.split(/-(split|share)-/);
		return parts && parts.length > 1 ? parts[0] : raw;
	};
  const gcd = (a: number, b: number): number => {
		let x = Math.abs(a), y = Math.abs(b);
		while (y) { const t = y; y = x % y; x = t; }
		return x || 1;
	};
	const normalizeShare = (whole: number, num: number, den?: number) => {
		if (!den || den <= 0 || num <= 0) return { whole, num: 0, den: 0 };
		const extra = Math.floor(num / den);
		let n = num % den;
		let w = whole + extra;
		if (n === 0) return { whole: w, num: 0, den: 0 };
		const g = gcd(n, den);
		return { whole: w, num: Math.floor(n / g), den: Math.floor(den / g) };
	};
  // -----------------------------------------------------------------------

  const renderPaySummary = () => {
    const allTotal = guestSubtotals['ALL'] || 0;
    const paidEntries = Object.entries(guestStatusMap || {}).filter(([, st]) => st === 'PAID');
    const paidSum = paidEntries.reduce((s, [gid]) => s + (guestSubtotals[String(gid)] || 0), 0);
    const remaining = Math.max(0, Number((allTotal - paidSum).toFixed(2)));
    const label = paidEntries.length > 0 ? 'Pay Balance' : 'Pay in Full';
    
    const allTax = (() => {
      try {
        const node: any = (window as any).__ORDER_SPLIT_TOTALS__;
        return Number(node?.allTax || 0);
      } catch {
        return 0;
      }
    })();
    const paidGuests = Object.entries(guestStatusMap || {})
      .filter(([, st]) => st === 'PAID')
      .map(([gid]) => Number(gid))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    const nodeAny: any = (window as any).__ORDER_SPLIT_TOTALS__;
    const map: Record<number, { grand: number; tax: number; subtotal: number }> = nodeAny && nodeAny.byGuest ? nodeAny.byGuest : ({} as any);
    const paidTaxRaw = paidGuests.reduce((s, g) => s + Number(map[g]?.tax || 0), 0);
    const taxAllByGuests = Object.values(map || {}).reduce((s: number, v: any) => s + Number(v?.tax || 0), 0);
    const delta = Number((allTax - taxAllByGuests).toFixed(2));
    const paidTax = Number((paidTaxRaw + (paidGuests.length > 0 ? delta : 0)).toFixed(2));
    const remainingTax = Math.max(0, Number((allTax - paidTax).toFixed(2)));

    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto p-3 text-center text-base font-semibold">
          <span className="block text-lg font-bold text-blue-600 mb-2">Total : ${formatMoney(allTotal)}</span>
          <div className="border-t border-gray-300 pt-2 mt-2">
            <span className="block">Remaining : ${formatMoney(remaining)}</span>
            <span className="block text-xs text-gray-600 mt-0.5">Remaining Tax : ${formatMoney(remainingTax)}</span>
          </div>
          {paidGuests.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {paidGuests.map((g) => (
                <span key={`pg-${g}`} className="block text-xs text-gray-600">{`Paid Guest ${g} : $${formatMoney(guestSubtotals[String(g)] || 0)}`}</span>
              ))}
            </div>
          )}
        </div>
        <div className="mt-auto shrink-0 p-0 border-t">
          <button
            onClick={(e) => {
              if (isShareActionActive) {
                e.stopPropagation();
                return;
              }
              e.stopPropagation();
              if (typeof onPayInFull === 'function') {
                onPayInFull();
              } else {
                onSelectGuest('ALL');
              }
              onClose();
            }}
            disabled={isShareActionActive}
            className={`w-full h-12 rounded-b-lg flex items-center justify-center px-3 text-sm font-semibold transition ${
              isShareActionActive ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
            aria-disabled={isShareActionActive}
          >
            {label} {`$${formatMoney(remaining)}`}
          </button>
        </div>
      </div>
    );
  };

  // Render Logic
  if (showSplitGuest) {
    // --- SCENARIO 2: SPLIT VIEW (Top: Guest Card, Bottom: Pay Card) ---
    const cell = splitGuestId;
    const cellKey = String(cell);
    const list = (itemsByGuest[cellKey] || []);
    const subtotal = guestSubtotals[cellKey] || 0;

    // Logic to group items for the guest card (reused from main render)
    const byKey: Record<string, { name: string; representRowIndex: number; wholeQty: number; splitNum: number; splitDen: number | undefined; amount: number; splitOrderMin?: number; hasSplit?: boolean }>= {};
    (list || []).forEach(({ rowIndex, item }) => {
      const key = getBaseId(item);
      const entry = byKey[key] || { name: item.name, representRowIndex: rowIndex, wholeQty: 0, splitNum: 0, splitDen: undefined, amount: 0 } as any;
      if (!entry.splitDen && !(item as any).splitDenominator) { entry.representRowIndex = rowIndex; }
      if ((item as any).splitDenominator) {
        entry.splitDen = entry.splitDen || (item as any).splitDenominator;
        entry.splitNum += (item.quantity || 1);
        entry.hasSplit = true;
        const so = (item as any).splitOrder as number | undefined;
        if (typeof so === 'number') entry.splitOrderMin = Math.min(entry.splitOrderMin ?? so, so);
      } else {
        entry.wholeQty += item.quantity || 0;
        const so = (item as any).splitOrder as number | undefined;
        const isSharedWhole = (typeof so === 'number') || /-(split|share)-/.test(String((item as any).id || ''));
        if (isSharedWhole) {
          entry.hasSplit = true;
          if (typeof so === 'number') entry.splitOrderMin = Math.min(entry.splitOrderMin ?? so, so);
        }
      }
      entry.amount = Number((entry.amount + (item.totalPrice * item.quantity)).toFixed(2));
      byKey[key] = entry;
    });
    const grouped = Object.values(byKey).sort((a: any, b: any) => {
      const aKey = (a.hasSplit ? 0 : 1);
      const bKey = (b.hasSplit ? 0 : 1);
      if (aKey !== bKey) return aKey - bKey;
      if (a.hasSplit && b.hasSplit) {
        const aa = a.splitOrderMin ?? Number.MAX_SAFE_INTEGER;
        const bb = b.splitOrderMin ?? Number.MAX_SAFE_INTEGER;
        if (aa !== bb) return aa - bb;
      }
      return 0;
    });

    return (
      <div className="h-full flex flex-col gap-2">
        {/* Top Half: Guest Card */}
        <DroppableGuest
          guest={splitGuestId}
          className={`relative border rounded-lg bg-gray-50 flex flex-col flex-1 min-h-0 transition overflow-hidden`}
          onClick={(e) => {
              const target = e.target as HTMLElement;
              // Logic for move mode click
              if (isMoveMode && moveSelectedRowIndex !== null) {
                  e.stopPropagation();
                  onMoveItem(moveSelectedRowIndex, splitGuestId);
                  setMoveSelectedRowIndex(null);
                  setMoveTargetGuest(null);
              }
          }}
        >
             <div 
                className={`px-2 py-1 border-b text-xs md:text-sm font-bold text-center tracking-wide ${isShareSelectedMode && shareTargetGuests.has(splitGuestId) ? 'bg-indigo-600 text-white' : isMoveMode && moveSelectedRowIndex !== null ? 'bg-purple-100 text-purple-900' : 'bg-gray-300 text-gray-700'} ${isShareSelectedMode ? 'cursor-pointer hover:bg-indigo-700' : ''}`}
                onClick={(e) => { 
                  if (isShareSelectedMode) { 
                    e.stopPropagation();
                    toggleShareTargetGuest(splitGuestId); 
                  }
                }}
              >
              {`Guest ${splitGuestId}`} • ${formatMoney(subtotal)}
            </div>
            {isShareSelectedMode && shareTargetGuests.has(splitGuestId) && (
              <div className="absolute top-1 right-1 text-[10px] font-bold text-white bg-indigo-600 rounded px-1.5 py-0.5 shadow">Selected</div>
            )}
            <div className="flex-1 p-1.5 pr-1 space-y-0 overflow-y-auto overscroll-contain -translate-y-[5px]">
              {grouped.length === 0 ? (
                <div className="text-xs text-gray-400 text-center mt-2">No items</div>
              ) : (
                grouped.map((g, idx2) => (
                  <DraggableRow key={`g-${cellKey}-${g.representRowIndex}-${idx2}`} id={`g-${cellKey}-${g.representRowIndex}`} rowIndex={g.representRowIndex} className={`px-2 py-0 ${isShareSelectedMode && shareSelectedRowIndex===g.representRowIndex ? 'ring-4 ring-indigo-500 ring-offset-2 bg-indigo-50 rounded' : ''} ${isMoveMode && moveSelectedRowIndex===g.representRowIndex ? 'ring-4 ring-purple-500 ring-offset-2 bg-purple-50 rounded' : ''} ${isSplitSelectMode && preselectedRowIndex===g.representRowIndex ? 'ring-4 ring-blue-500 ring-offset-2 bg-blue-50 rounded' : ''} ${(!isShareSelectedMode && !isSplitSelectMode && !isMoveMode && preselectedRowIndex===g.representRowIndex) ? 'bg-blue-50 ring-2 ring-blue-400 rounded' : ''}`} disabled={isShareActionActive} onClick={(e)=>{ e.stopPropagation(); if (isShareActionActive) { return; } if (isSplitSelectMode) { setPreselectedRowIndex(g.representRowIndex); onSplitItemEqual(g.representRowIndex); setIsSplitSelectMode(false); } else if (isShareSelectedMode) { setShareSelectedRowIndex(g.representRowIndex); toggleShareTargetGuest(splitGuestId); } else if (isMoveMode) { setMoveSelectedRowIndex(g.representRowIndex); } else { setPreselectedRowIndex(g.representRowIndex); } }}>
                    <div className="flex flex-col w-full">
                      <div className="text-base text-gray-800 flex items-center gap-2 break-words">
                        <span className={`font-medium ${preselectedRowIndex===g.representRowIndex ? 'text-blue-900' : ''}`}>{g.name}</span>
                      </div>
                      <div className="mt-0 flex items-center justify-start gap-1.5 -translate-y-[3px]">
                        {(() => {
                          // 규칙 1-3: 쉐어된 아이템은 항상 1/N 형식으로 표시 (N = splitDenominator)
                          if (g.splitDen) {
                            return <span className={`text-xs font-normal text-blue-800 -translate-y-[3px] inline-block ${preselectedRowIndex===g.representRowIndex ? 'text-blue-900' : ''}`}>1/{g.splitDen}</span>;
                          }
                          return <span className={`text-xs font-normal text-gray-800 -translate-y-[3px] inline-block ${preselectedRowIndex===g.representRowIndex ? 'text-blue-900' : ''}`}>x{g.wholeQty}</span>;
                        })()}
                        <span className={`text-xs font-normal text-gray-800 -translate-y-[3px] inline-block ${preselectedRowIndex===g.representRowIndex ? 'underline decoration-blue-400' : ''}`}>${formatMoney(g.amount)}</span>
                      </div>
                    </div>
                  </DraggableRow>
                ))
              )}
            </div>
        </DroppableGuest>

        {/* Bottom Half: Pay Card Summary */}
        <div className={`border rounded-lg bg-white flex flex-col flex-1 min-h-0 transition overflow-hidden`}>
             {renderPaySummary()}
        </div>
      </div>
    );
  } else {
    // --- SCENARIO 1: SINGLE PAY CARD VIEW ---
    return (
      <div
        data-rowcard="1"
        className={`border rounded-lg bg-white min-h-[154px] h-full flex flex-col transition ${isShareActionActive ? 'cursor-not-allowed opacity-60' : ''}`}
      >
        <div className="px-2 py-1 border-b text-xs md:text-sm font-bold text-center tracking-wide bg-gray-300 text-gray-700">
          Reserved for next guest
        </div>
        {renderPaySummary()}
      </div>
    );
  }
};

const SplitBillModal: React.FC<SplitBillModalProps> = ({ isOpen, onClose, orderItems, guestIds, guestStatusMap, onSelectGuest, onPayInFull, onMoveItem, onReorderLeft, onSplitItemEqual, onShareSelected, onResetSplit, modalWidth, modalHeight }) => {
	const safeGuestIds = useMemo(() => {
		if (guestIds && guestIds.length > 0) return guestIds;
		const guests = new Set<number>();
		(orderItems || []).forEach(it => {
			if (it.type === 'item' && it.guestNumber) guests.add(it.guestNumber);
		});
		if (guests.size === 0) return [1];
		return Array.from(guests).sort((a, b) => a - b);
	}, [guestIds, orderItems]);

	// Build map: guest -> list of { rowIndex, item }
	const itemsByGuest = useMemo(() => {
		const map: Record<string, Array<{ rowIndex: number; item: OrderItem }>> = {};
		(orderItems || []).forEach((it, idx) => {
			if (it.type === 'separator') return;
			// Filter out void items
			if ((it as any).type === 'void') return;
			const key = String(it.guestNumber || 1);
			if (!map[key]) map[key] = [];
			map[key].push({ rowIndex: idx, item: it });
		});
		return map;
	}, [orderItems]);

	const guestSubtotals = useMemo(() => {
		const toAmount = (list: Array<{ rowIndex: number; item: OrderItem }>) => list.reduce((s, it) => s + (it.item.totalPrice * it.item.quantity), 0);
		const map: Record<string, number> = {};
		Object.entries(itemsByGuest).forEach(([k, list]) => {
			map[k] = Number(toAmount(list).toFixed(2));
		});
		const all = Number(((orderItems || []).filter(it => it.type !== 'separator' && (it as any).type !== 'void').reduce((s, it:any) => s + (it.totalPrice * it.quantity), 0)).toFixed(2));
		map['ALL'] = all;
		return map;
	}, [itemsByGuest, orderItems]);

	// Helper used by grouping functions
	const getBaseId = (it: OrderItem) => {
		const raw = String(it.id || '');
		const parts = raw.split(/-(split|share)-/);
		return parts && parts.length > 1 ? parts[0] : raw;
	};

	// Build grouped view and slot mapping for the left list
	const leftGrouped = useMemo(() => {
		const rows: Array<any> = [];
		const slotRaw: number[] = [0];
		const len = (orderItems || []).length;
		const pushGroups = (start: number, end: number, guestForBlock: number) => {
			const groups: Record<string, { name: string; rep: number; idxs: number[]; wholeQty: number; splitNum: number; splitDen?: number; amount: number; splitOrderMin?: number; hasSplit?: boolean }> = {};
			for (let k = start; k < end; k++) {
				const it = orderItems[k];
				if (!it || it.type === 'separator') continue;
				// Filter out void items
				if ((it as any).type === 'void') continue;
				const key = getBaseId(it as any);
				const g = groups[key] || { name: it.name, rep: k, idxs: [], wholeQty: 0, splitNum: 0, amount: 0 } as any;
				if (!(it as any).splitDenominator) {
					g.wholeQty += it.quantity || 0;
					g.rep = g.rep ?? k;
					// Treat whole-only items originated from Share as shared as well
					const so = (it as any).splitOrder as number | undefined;
					const isSharedWhole = (typeof so === 'number') || /-(split|share)-/.test(String((it as any).id || ''));
					if (isSharedWhole) {
						g.hasSplit = true;
						if (typeof so === 'number') g.splitOrderMin = Math.min(g.splitOrderMin ?? so, so);
					}
				} else {
										g.splitDen = g.splitDen || (it as any).splitDenominator;
					g.splitNum += (it.quantity || 1);
					g.hasSplit = true;
					const so = (it as any).splitOrder as number | undefined;
					if (typeof so === 'number') g.splitOrderMin = Math.min(g.splitOrderMin ?? so, so);
				}
				g.idxs.push(k);
				g.amount = Number((g.amount + (it.totalPrice * it.quantity)).toFixed(2));
				groups[key] = g;
			}
			const ordered = Object.values(groups).sort((a: any, b: any) => {
				// Split items first by earliest split order; then by original appearance
				const aKey = (a.hasSplit ? 0 : 1);
				const bKey = (b.hasSplit ? 0 : 1);
				if (aKey !== bKey) return aKey - bKey;
				if (a.hasSplit && b.hasSplit) {
					const aa = a.splitOrderMin ?? Number.MAX_SAFE_INTEGER;
					const bb = b.splitOrderMin ?? Number.MAX_SAFE_INTEGER;
					if (aa !== bb) return aa - bb;
				}
				return Math.min(...a.idxs) - Math.min(...b.idxs);
			});
			for (const g of ordered as any[]) {
				const lastIndex = Math.max(...g.idxs);
				rows.push({ kind: 'group', guest: guestForBlock, representIndex: g.rep, name: g.name, wholeQty: g.wholeQty, splitNum: g.splitNum, splitDen: g.splitDen, amount: g.amount, hasSplit: !!g.hasSplit });
				slotRaw.push(lastIndex + 1);
			}
		};
		let i = 0;
		while (i < len) {
			const it = orderItems[i];
			if (it.type === 'separator') {
				rows.push({ kind: 'sep', guest: it.guestNumber, subtotal: guestSubtotals[String(it.guestNumber || 1)] || 0 });
				slotRaw.push(i + 1);
				let j = i + 1;
				while (j < len && orderItems[j].type !== 'separator') j++;
				pushGroups(i + 1, j, (it.guestNumber || 1));
				i = j;
			} else {
				let j = i;
				while (j < len && orderItems[j].type !== 'separator') j++;
				// Derive guest for this pre-separator block from first non-separator item, fallback to 1
				let derivedGuest = 1;
				if (i < j) {
					const firstItem = orderItems[i];
					derivedGuest = (firstItem && typeof (firstItem as any).guestNumber === 'number') ? ((firstItem as any).guestNumber || 1) : 1;
				}
				pushGroups(i, j, derivedGuest);
				i = j;
			}
		}
		return { rows, slotRaw };
	}, [orderItems, guestSubtotals]);

	// Right grid: show only guests with data + one next guest (+ Pay in Full card below)
  const actualGuestIds = useMemo(() => {
    const ids = Object.keys(itemsByGuest).map(n => Number(n)).filter(n => Number.isFinite(n));
    ids.sort((a, b) => a - b);
    // Unpaid/partial first, Paid last; keep ascending within groups
    const getKey = (g: number) => ((guestStatusMap && guestStatusMap[g] === 'PAID') ? 1 : 0);
    return [...ids].sort((a, b) => {
      const ka = getKey(a), kb = getKey(b);
      if (ka !== kb) return ka - kb;
      return a - b;
    });
  }, [itemsByGuest, guestStatusMap]);
const GRID_COLUMNS = 4;

const payLayout = useMemo(() => {
	const sortedGuests = [...actualGuestIds];
	let row = 1;
	let guestCapacity = GRID_COLUMNS - 1;
	while (sortedGuests.length > guestCapacity) {
		row += 1;
		guestCapacity = row * GRID_COLUMNS - 1;
	}
	const guestSlots: Array<{ id: number; isSynthetic: boolean }> = [];
	const usedIds = new Set(sortedGuests);
	let nextSyntheticId = sortedGuests.length > 0 ? Math.max(...sortedGuests) + 1 : 1;
	for (let i = 0; i < guestCapacity; i += 1) {
		const existing = sortedGuests[i];
		if (typeof existing === 'number') {
			guestSlots.push({ id: existing, isSynthetic: false });
		} else {
			while (usedIds.has(nextSyntheticId)) nextSyntheticId += 1;
			guestSlots.push({ id: nextSyntheticId, isSynthetic: true });
			usedIds.add(nextSyntheticId);
			nextSyntheticId += 1;
		}
	}
	while (guestSlots.length < guestCapacity) {
		while (usedIds.has(nextSyntheticId)) nextSyntheticId += 1;
		guestSlots.push({ id: nextSyntheticId, isSynthetic: true });
		usedIds.add(nextSyntheticId);
		nextSyntheticId += 1;
	}
	while (usedIds.has(nextSyntheticId)) nextSyntheticId += 1;
	const splitGuestId = nextSyntheticId;
	const totalSlots = row * GRID_COLUMNS;
	return { guestSlots, splitGuestId, totalSlots };
}, [actualGuestIds]);

	const formatMoney = (n: number) => new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
	const maxGuestButton = Math.max(9, safeGuestIds.length);

	// Helpers for evenly-shared quantity display
	const getWholeCountInGuest = (guest: number, baseId: string) => {
		return (orderItems || []).reduce((sum, o) => {
			if (o.type === 'separator') return sum;
			if ((o.guestNumber || 1) !== guest) return sum;
			if ((o as any).splitDenominator) return sum;
			return getBaseId(o) === baseId ? sum + (o.quantity || 0) : sum;
		}, 0);
	};
	const gcd = (a: number, b: number): number => {
		let x = Math.abs(a), y = Math.abs(b);
		while (y) { const t = y; y = x % y; x = t; }
		return x || 1;
	};
	const normalizeShare = (whole: number, num: number, den?: number) => {
		if (!den || den <= 0 || num <= 0) return { whole, num: 0, den: 0 };
		const extra = Math.floor(num / den);
		let n = num % den;
		let w = whole + extra;
		if (n === 0) return { whole: w, num: 0, den: 0 };
		const g = gcd(n, den);
		return { whole: w, num: Math.floor(n / g), den: Math.floor(den / g) };
	};

	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

	// Selection state for equal-split flow
	const [isSplitSelectMode, setIsSplitSelectMode] = useState<boolean>(false);
	const [preselectedRowIndex, setPreselectedRowIndex] = useState<number | null>(null);
	const [isShareSelectedMode, setIsShareSelectedMode] = useState<boolean>(false);
	const [shareSelectedRowIndex, setShareSelectedRowIndex] = useState<number | null>(null);
	const [shareTargetGuests, setShareTargetGuests] = useState<Set<number>>(new Set());
	const [isMoveMode, setIsMoveMode] = useState<boolean>(false);
	const [moveSelectedRowIndex, setMoveSelectedRowIndex] = useState<number | null>(null);
	const [moveTargetGuest, setMoveTargetGuest] = useState<number | null>(null);
	const [isShowShare, setIsShowShare] = useState<boolean>(false);
	const [resetSplitNonce, setResetSplitNonce] = useState<number>(0);
	const [showShareBlinkOn, setShowShareBlinkOn] = useState<boolean>(false);

	// Clicking on whitespace should clear the simple selection highlight
	const handleClearSelection = () => {
		setPreselectedRowIndex(null);
	};

	// Grid ref for per-row height equalization (to align Pay buttons horizontally per row)
	const rightGridRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!isOpen) return;
		const grid = rightGridRef.current;
		if (!grid) return;
		const selector = '[data-rowcard="1"]';
		let cards = Array.from(grid.querySelectorAll(selector)) as HTMLElement[];
		if (cards.length === 0) return;
		const clearHeights = () => { cards.forEach(el => { el.style.minHeight = ''; }); };
		let rafId: number | null = null;
		const applyHeights = () => {
			cards = Array.from(grid.querySelectorAll(selector)) as HTMLElement[];
			if (cards.length === 0) return;
			const scrollArea = grid.parentElement;
			const availableHeight = (scrollArea?.clientHeight || 600) - 8;
			const targetH = Math.max(120, Math.floor(availableHeight / 2));
			cards.forEach(el => {
				const next = `${targetH}px`;
				if (el.style.minHeight !== next) el.style.minHeight = next;
				if (el.style.height !== next) el.style.height = next;
			});
		};
		const schedule = () => {
			if (rafId != null) cancelAnimationFrame(rafId as any);
			rafId = requestAnimationFrame(() => { applyHeights(); rafId = null; });
		};
		schedule();
		const ro = new ResizeObserver(() => { schedule(); });
		try { ro.observe(grid); } catch {}
		const onResize = () => schedule();
		window.addEventListener('resize', onResize);
		return () => { if (rafId != null) cancelAnimationFrame(rafId as any); ro.disconnect(); window.removeEventListener('resize', onResize); clearHeights(); };
	}, [isOpen, orderItems, isShareSelectedMode, isSplitSelectMode, payLayout.totalSlots]);

	const isShareActionActive = useMemo(() => {
		return isShareSelectedMode && shareSelectedRowIndex !== null;
	}, [isShareSelectedMode, shareSelectedRowIndex]);

	const precedingGuestSlot = payLayout.guestSlots[payLayout.guestSlots.length - 1];
	const shouldShowSplitGuest =
		!!precedingGuestSlot && (itemsByGuest[String(precedingGuestSlot.id)]?.length ?? 0) > 0;

	useEffect(() => {
		if (!isShowShare) return;
		setShowShareBlinkOn(true);
		const t = setTimeout(() => {
			setShowShareBlinkOn(false);
			setIsShowShare(false);
		}, 1500);
		return () => clearTimeout(t);
	}, [isShowShare]);

	if (!isOpen) return null;

	const toggleShareTargetGuest = (guest: number) => {
		setShareTargetGuests(prev => {
			const next = new Set(prev);
			if (next.has(guest)) next.delete(guest); else next.add(guest);
			return next;
		});
	};

	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;
		if (!active || !over) return;
		const overId = String(over.id);
		// Right guest drop
		if (overId.startsWith('guest-')) {
			const targetGuest = Number(overId.replace('guest-', ''));
			// 결제된 게스트로의 이동 방지
			if (guestStatusMap && guestStatusMap[targetGuest] === 'PAID') {
				return;
			}
			const m = String(active.id).match(/__rowIndex_(\d+)$/);
			if (!m) return;
			const rowIndex = Number(m[1]);
			if (Number.isFinite(rowIndex) && Number.isFinite(targetGuest) && targetGuest >= 1 && targetGuest <= 9999) {
				onMoveItem(rowIndex, targetGuest);
			}
			return;
		}
		// Left insertion drop (map display slot index to raw index)
		if (overId.startsWith('left-slot-')) {
			const destDisplayIndex = Number(overId.replace('left-slot-', ''));
			const destIndex = leftGrouped.slotRaw[destDisplayIndex] ?? destDisplayIndex;
			const m = String(active.id).match(/__rowIndex_(\d+)$/);
			if (!m) return;
			const rowIndex = Number(m[1]);
			if (Number.isFinite(rowIndex) && Number.isFinite(destIndex)) {
				onReorderLeft(rowIndex, destIndex);
			}
		}
	};

	// Portal로 document.body에 직접 렌더링하여 스케일링 영향 방지
	const modalContent = (
		<div className={`fixed inset-0 z-[9999] ${isOpen ? '' : 'hidden'}`} role="dialog" aria-modal="true" style={{ transform: 'none' }}>
			<div className={`absolute inset-0 bg-black/60 flex items-center justify-center`} />
			<div className="relative w-full h-full flex items-center justify-center p-3">
				<div className="relative bg-white rounded-2xl shadow-2xl overflow-hidden" style={{ width: `${Math.floor(Math.max(640, Math.min((modalWidth || 1024), (typeof window !== 'undefined' ? window.innerWidth * 0.92 : 1280))))}px`, height: `${Math.floor(Math.max(480, Math.min((modalHeight || 720), (typeof window !== 'undefined' ? window.innerHeight * 0.88 : 800))))}px` }}>
					{/* Close button inside modal (on white background) */}
					<button
						onClick={onClose}
						className="absolute top-[3px] right-[3px] z-10 p-2 rounded-full bg-white/30 hover:bg-white/50 shadow-xl hover:shadow-2xl transition-all border-[3px] border-red-500 ring-3 ring-red-300/50 pointer-events-auto"
						aria-label="Close modal"
					>
						<X size={28} className="text-red-600" strokeWidth={3} />
					</button>
					<DndContext sensors={sensors} onDragEnd={handleDragEnd}>
						<div className="grid grid-cols-1 md:grid-cols-[10fr_70fr] items-stretch h-full">

						{/* Middle: Vertical function buttons */}
						<div className="border-r overflow-visible p-3 bg-white">
							<div className="h-2 rounded bg-gray-50 mb-2" style={{ backgroundImage: 'radial-gradient(rgba(148,163,184,0.25) 1px, transparent 1px)', backgroundSize: '6px 6px' }}></div>
							<div className="flex flex-col gap-2 mt-3">
								<button
									onClick={() => { if (onPayInFull) { onPayInFull(); } else { onSelectGuest('ALL'); onClose(); } }}
									className="w-full h-14 rounded-lg text-base font-semibold text-center bg-gradient-to-r from-orange-400 to-orange-600 text-white hover:from-orange-500 hover:to-orange-700 border border-orange-500 shadow-md hover:shadow-lg active:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300 transition-all duration-300 transform active:translate-y-[1px]"
								>
									Pay in Full
								</button>
								<button
									onClick={() => { if (preselectedRowIndex !== null) { onSplitItemEqual(preselectedRowIndex); setIsSplitSelectMode(false); } else { setIsSplitSelectMode(true); } }}
									className={`w-full h-14 rounded-lg text-base font-semibold text-center transform transition-all duration-300 active:translate-y-[1px] ${isSplitSelectMode ? 'bg-gradient-to-l from-orange-600 to-orange-400 text-white hover:from-orange-700 hover:to-orange-500 border border-orange-500 shadow-md hover:shadow-lg active:shadow' : 'bg-gradient-to-r from-orange-400 to-orange-600 text-white hover:from-orange-500 hover:to-orange-700 border border-orange-500 shadow-md hover:shadow-lg active:shadow'}`}
									aria-pressed={isSplitSelectMode}
									>
									Share Evenly
								</button>
								<button
									onClick={() => {
										if (!isShareSelectedMode) {
											setIsShareSelectedMode(true);
											if (preselectedRowIndex !== null) setShareSelectedRowIndex(preselectedRowIndex);
											// Auto-select the guest of the selected item as initial target
											if (preselectedRowIndex !== null) {
												const item = orderItems[preselectedRowIndex];
												const g = (item && typeof item.guestNumber === 'number') ? item.guestNumber : 1;
												setShareTargetGuests(new Set<number>([g]));
											}
										} else {
											// Apply if we have item and at least one guest
											if (shareSelectedRowIndex !== null && shareTargetGuests.size > 0) {
												if (onShareSelected) onShareSelected(shareSelectedRowIndex, Array.from(shareTargetGuests));
											}
											// reset state
											setIsShareSelectedMode(false);
											setShareSelectedRowIndex(null);
											setShareTargetGuests(new Set());
										}
									}}
									className={`w-full h-14 rounded-lg text-base font-semibold text-center transform transition-all duration-300 active:translate-y-[1px] ${isShareSelectedMode ? 'bg-gradient-to-r from-orange-700 to-orange-800 text-white hover:from-orange-800 hover:to-orange-900 border border-orange-700 shadow-md hover:shadow-lg active:shadow' : 'bg-gradient-to-r from-orange-400 to-orange-600 text-white hover:from-orange-500 hover:to-orange-700 border border-orange-500 shadow-md hover:shadow-lg active:shadow'}`}
									aria-pressed={isShareSelectedMode}
									>
									Share Selected
								</button>
								<button
									onClick={() => {
										if (!isMoveMode) {
											setIsMoveMode(true);
											if (preselectedRowIndex !== null) setMoveSelectedRowIndex(preselectedRowIndex);
										} else {
											// Cancel mode
											setIsMoveMode(false);
											setMoveSelectedRowIndex(null);
											setMoveTargetGuest(null);
										}
									}}
									className={`w-full h-14 rounded-lg text-base font-semibold text-center transform transition-all duration-300 active:translate-y-[1px] ${isMoveMode ? 'bg-gradient-to-l from-orange-600 to-orange-400 text-white hover:from-orange-700 hover:to-orange-500 border border-orange-500 shadow-md hover:shadow-lg active:shadow' : 'bg-gradient-to-r from-orange-400 to-orange-600 text-white hover:from-orange-500 hover:to-orange-700 border border-orange-500 shadow-md hover:shadow-lg active:shadow'}`}
									aria-pressed={isMoveMode}
									>
									Move
								</button>
								<button
									onClick={() => { setIsShowShare(true); }}
									className={`w-full h-14 rounded-lg text-base font-semibold text-center transform transition-all duration-300 active:translate-y-[1px] ${isShowShare ? 'bg-gradient-to-l from-orange-600 to-orange-400 text-white hover:from-orange-700 hover:to-orange-500 border border-orange-500 shadow-md hover:shadow-lg active:shadow' : 'bg-gradient-to-r from-orange-400 to-orange-600 text-white hover:from-orange-500 hover:to-orange-700 border border-orange-500 shadow-md hover:shadow-lg active:shadow'}`}
									aria-pressed={isShowShare}
									>
									Show Share
								</button>
								<button
									onClick={() => { if (onResetSplit) onResetSplit(); setIsSplitSelectMode(false); setIsShareSelectedMode(false); setShareSelectedRowIndex(null); setShareTargetGuests(new Set()); setIsMoveMode(false); setMoveSelectedRowIndex(null); setMoveTargetGuest(null); setIsShowShare(false); setShowShareBlinkOn(false); }}
									className="w-full h-14 rounded-lg text-base font-semibold text-center bg-gradient-to-r from-orange-400 to-orange-600 text-white hover:from-orange-500 hover:to-orange-700 border border-orange-500 shadow-md hover:shadow-lg active:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300 transition-all duration-300 transform active:translate-y-[1px]"
								>
									Reset Split
								</button>
								<div className="h-px bg-gray-200 my-1" />
								<button
									onClick={onClose}
									className="w-full h-14 rounded-lg text-base font-semibold text-center bg-gradient-to-r from-orange-400 to-orange-600 text-white hover:from-orange-500 hover:to-orange-700 border-2 border-red-500 shadow-md hover:shadow-lg active:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300 transition-all duration-300 transform active:translate-y-[1px]"
								>
									Back to Order
								</button>
							</div>
						</div>

						{/* Right: 4xN guest grid */}
						<div className="overflow-hidden p-3 h-full flex flex-col">
							<div className="h-2 rounded bg-gray-50 mb-2 shrink-0" style={{ backgroundImage: 'radial-gradient(rgba(148,163,184,0.25) 1px, transparent 1px)', backgroundSize: '6px 6px' }}></div>
							<div className="flex-1 overflow-y-auto min-h-0">
								<div ref={rightGridRef} className="grid grid-cols-4 gap-2 items-stretch">
								{payLayout.guestSlots.map((slot, slotIndex) => {
									const rowIdx = Math.floor(slotIndex / GRID_COLUMNS);
									const rowBg = rowIdx % 2 === 0 ? 'bg-amber-50' : 'bg-red-50';
									const cell = slot.id;
									const cellKey = String(cell);
									const list = (itemsByGuest[cellKey] || []);
									const hasItems = list.length > 0;
									const subtotal = guestSubtotals[cellKey] || 0;
									const status = guestStatusMap ? guestStatusMap[Number(cell)] : undefined;
									const isSyntheticGuest = slot.isSynthetic;
									const isPaid = isSyntheticGuest ? false : status === 'PAID';
									return (
										<DroppableGuest
											data-rowcard="1"
											key={`cell-${cellKey}-${slotIndex}`}
											guest={Number(cell)}
											className={`relative border rounded-lg ${rowBg} min-h-[114px] flex flex-col ${
												isPaid ? 'opacity-60' : 'transition'
											} ${isMoveMode && moveSelectedRowIndex !== null && !isPaid ? 'cursor-pointer hover:shadow-lg' : ''}`}
											onClick={(e) => {
												const target = e.target as HTMLElement;
												const isPayButton = target.closest('button');
												if (isMoveMode && moveSelectedRowIndex !== null && !isPaid && !isPayButton) {
													e.stopPropagation();
													onMoveItem(moveSelectedRowIndex, Number(cell));
													setIsMoveMode(false);
													setMoveSelectedRowIndex(null);
													setMoveTargetGuest(null);
												}
											}}
										>
											<div 
															className={`${isShareSelectedMode && shareTargetGuests.has(Number(cell)) ? 'bg-indigo-600 text-white' : isMoveMode && moveSelectedRowIndex !== null ? 'bg-purple-100 text-purple-900' : (isPaid ? 'bg-green-600 text-white' : 'bg-gray-300 text-gray-700')} px-2 py-1 border-b text-xs md:text-sm font-bold text-center tracking-wide ${isShareSelectedMode && !isPaid ? 'cursor-pointer hover:bg-indigo-700' : ''}`}
															onClick={(e) => { 
																if (isPaid) return;
																if (isShareSelectedMode) { 
																	e.stopPropagation();
																	toggleShareTargetGuest(Number(cell)); 
																}
															}}
														>
														{`Guest ${cellKey}`} • ${formatMoney(subtotal)} {(!isSyntheticGuest && isPaid) ? '• PAID' : ''}
													</div>
											{isShareSelectedMode && shareTargetGuests.has(Number(cell)) && (
												<div className="absolute top-1 right-1 text-[10px] font-bold text-white bg-indigo-600 rounded px-1.5 py-0.5 shadow">Selected</div>
											)}
											<div className="flex-1 p-1.5 pr-1 space-y-0 overflow-y-auto overscroll-contain max-h-[300px] -translate-y-[5px]">
												{(() => {
													// Group items by base id for this guest to merge whole and split parts
													const byKey: Record<string, { name: string; representRowIndex: number; wholeQty: number; splitNum: number; splitDen: number | undefined; amount: number; splitOrderMin?: number; hasSplit?: boolean; modifiers?: any[]; memo?: string; discount?: any }>= {};
													(list || []).forEach(({ rowIndex, item }) => {
														const key = getBaseId(item);
														const entry = byKey[key] || { name: item.name, representRowIndex: rowIndex, wholeQty: 0, splitNum: 0, splitDen: undefined, amount: 0, modifiers: [], memo: '', discount: null } as any;
														// Prefer non-split row as representative
														if (!entry.splitDen && !(item as any).splitDenominator) { entry.representRowIndex = rowIndex; }
														// 모디파이어, 메모, 디스카운트 저장
														if (item.modifiers && item.modifiers.length > 0 && (!entry.modifiers || entry.modifiers.length === 0)) {
															entry.modifiers = item.modifiers;
														}
														if (item.memo && !entry.memo) {
															entry.memo = typeof item.memo === 'string' ? item.memo : (item.memo as any)?.text || '';
														}
														if ((item as any).discount && !entry.discount) {
															entry.discount = (item as any).discount;
														}
																											if ((item as any).splitDenominator) {
														entry.splitDen = entry.splitDen || (item as any).splitDenominator;
														entry.splitNum += (item.quantity || 1);
														entry.hasSplit = true;
															const so = (item as any).splitOrder as number | undefined;
															if (typeof so === 'number') entry.splitOrderMin = Math.min(entry.splitOrderMin ?? so, so);
														} else {
															entry.wholeQty += item.quantity || 0;
															// Mark whole-only shares as split for highlighting and ordering
															const so = (item as any).splitOrder as number | undefined;
															const isSharedWhole = (typeof so === 'number') || /-(split|share)-/.test(String((item as any).id || ''));
															if (isSharedWhole) {
																entry.hasSplit = true;
																if (typeof so === 'number') entry.splitOrderMin = Math.min(entry.splitOrderMin ?? so, so);
															}
														}
														entry.amount = Number((entry.amount + (item.totalPrice * item.quantity)).toFixed(2));
														byKey[key] = entry;
													});
													const grouped = Object.values(byKey).sort((a: any, b: any) => {
														const aKey = (a.hasSplit ? 0 : 1);
														const bKey = (b.hasSplit ? 0 : 1);
														if (aKey !== bKey) return aKey - bKey;
														if (a.hasSplit && b.hasSplit) {
															const aa = a.splitOrderMin ?? Number.MAX_SAFE_INTEGER;
															const bb = b.splitOrderMin ?? Number.MAX_SAFE_INTEGER;
															if (aa !== bb) return aa - bb;
														}
														return 0;
													});
													if (grouped.length === 0) {
														return (<div className="text-xs text-gray-400 text-center">No items</div>);
													}
													return grouped.map((g, idx2) => (
														<DraggableRow key={`g-${cellKey}-${g.representRowIndex}-${idx2}`} id={`g-${cellKey}-${g.representRowIndex}`} rowIndex={g.representRowIndex} className={`px-2 py-1 mb-1 ${isShareSelectedMode && shareSelectedRowIndex===g.representRowIndex ? 'ring-4 ring-indigo-500 ring-offset-2 bg-indigo-50 rounded' : ''} ${isMoveMode && moveSelectedRowIndex===g.representRowIndex ? 'ring-4 ring-purple-500 ring-offset-2 bg-purple-50 rounded' : ''} ${isSplitSelectMode && preselectedRowIndex===g.representRowIndex ? 'ring-4 ring-blue-500 ring-offset-2 bg-blue-50 rounded' : ''} ${(!isShareSelectedMode && !isSplitSelectMode && !isMoveMode && preselectedRowIndex===g.representRowIndex) ? 'bg-blue-50 ring-2 ring-blue-400 rounded' : ''}`} disabled={isShareActionActive} onClick={(e)=>{ e.stopPropagation(); if (isShareActionActive) { return; } if (isSplitSelectMode) { setPreselectedRowIndex(g.representRowIndex); onSplitItemEqual(g.representRowIndex); setIsSplitSelectMode(false); } else if (isShareSelectedMode) { setShareSelectedRowIndex(g.representRowIndex); toggleShareTargetGuest(Number(cell)); } else if (isMoveMode) { setMoveSelectedRowIndex(g.representRowIndex); } else { setPreselectedRowIndex(g.representRowIndex); } }}>
															<div className="flex flex-col w-full">
																<div className="text-sm text-gray-800 flex items-center gap-2 break-words">
																	<span className={`${showShareBlinkOn && (g.hasSplit || g.splitDen) ? 'bg-yellow-200' : ''} font-medium ${preselectedRowIndex===g.representRowIndex ? 'text-blue-900' : ''}`}>{g.name}</span>
																</div>
																{/* 모디파이어 표시 */}
																{Array.isArray(g.modifiers) && g.modifiers.length > 0 && (
																	<div className="text-xs text-gray-500 pl-2 -mt-0.5 flex flex-wrap">
																		{g.modifiers.map((mod: any, mi: number) => {
																			const modName = mod?.name || mod?.label || mod?.modifierName || (typeof mod === 'string' ? mod : '');
																			const modPrice = Number(mod?.price || mod?.totalModifierPrice || 0);
																			if (!modName) return null;
																			return (
																				<span key={mi} className="mr-1 whitespace-nowrap">
																					+ {modName}{modPrice > 0 ? ` ($${modPrice.toFixed(2)})` : ''}
																				</span>
																			);
																		})}
																	</div>
																)}
																{/* 메모 표시 */}
																{g.memo && String(g.memo).trim() && (
																	<div className="text-xs text-orange-600 pl-2 italic -mt-0.5">📝 {String(g.memo)}</div>
																)}
																{/* 디스카운트 표시 */}
																{g.discount && (Number(g.discount.value) > 0 || Number(g.discount.percentage) > 0) && (
																	<div className="text-xs text-red-600 pl-2 -mt-0.5">
																		🏷️ -{g.discount.mode === 'percent' || g.discount.percentage > 0 
																			? `${g.discount.value || g.discount.percentage}%` 
																			: `$${Number(g.discount.value || 0).toFixed(2)}`}
																	</div>
																)}
																<div className="mt-0 flex items-center justify-start gap-1.5">
																	{(() => {
																		// 규칙 1-3: 쉐어된 아이템은 항상 1/N 형식으로 표시 (N = splitDenominator)
																		if (g.splitDen) {
																			return <span className={`${showShareBlinkOn ? 'bg-yellow-200' : ''} text-xs font-normal text-blue-800 inline-block ${preselectedRowIndex===g.representRowIndex ? 'text-blue-900' : ''}`}>1/{g.splitDen}</span>;
																	}
																	return <span className={`${showShareBlinkOn && (g.hasSplit || g.splitDen) ? 'bg-yellow-200' : ''} text-xs font-normal text-gray-800 inline-block ${preselectedRowIndex===g.representRowIndex ? 'text-blue-900' : ''}`}>x{g.wholeQty}</span>;
																})()}
																{(() => {
																	const isShared = !!g.splitDen || !!g.hasSplit;
																	return <span className={`${isShared ? 'text-blue-800' : 'text-gray-800'} ${showShareBlinkOn && isShared ? 'bg-yellow-200' : ''} text-xs font-normal inline-block ${preselectedRowIndex===g.representRowIndex ? 'underline decoration-blue-400' : ''}`}>${formatMoney(g.amount)}</span>;
																})()}
															</div>
														</div>
													</DraggableRow>
												));
											})()}
											</div>
											<div className="mt-auto shrink-0 p-0 border-t">
												{isPaid ? (
													<div className="w-full h-14 rounded-b-lg flex items-center justify-center px-3 text-sm font-bold bg-green-600 text-white select-none">PAID</div>
												) : (
													<button 
														onClick={(e) => { if (isShareActionActive || !hasItems) { e.stopPropagation(); return; } e.stopPropagation(); onSelectGuest(Number(cell)); onClose(); }}
														disabled={isShareActionActive || !hasItems}
														className={`w-full h-12 rounded-b-lg flex items-center justify-center px-3 text-sm font-semibold transition ${(isShareActionActive || !hasItems) ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
														aria-disabled={isShareActionActive || !hasItems}
													>
														Pay
													</button>
												)}
											</div>
										</DroppableGuest>
								);
							})}
							{(() => {
								const payRowIdx = Math.floor(payLayout.guestSlots.length / GRID_COLUMNS);
								const rowBg = payRowIdx % 2 === 0 ? 'bg-amber-50' : 'bg-red-50';
								return (
									<SplitBillPayCard
										key="pay-card"
										rowBgClass={rowBg}
										splitGuestId={payLayout.splitGuestId}
										showSplitGuest={shouldShowSplitGuest}
										guestSubtotals={guestSubtotals}
										guestStatusMap={guestStatusMap}
										itemsByGuest={itemsByGuest}
										isShareSelectedMode={isShareSelectedMode}
										shareSelectedRowIndex={shareSelectedRowIndex}
										setShareSelectedRowIndex={setShareSelectedRowIndex}
										shareTargetGuests={shareTargetGuests}
										toggleShareTargetGuest={toggleShareTargetGuest}
										isMoveMode={isMoveMode}
										moveSelectedRowIndex={moveSelectedRowIndex}
										setMoveSelectedRowIndex={setMoveSelectedRowIndex}
										setMoveTargetGuest={setMoveTargetGuest}
										onMoveItem={onMoveItem}
										isSplitSelectMode={isSplitSelectMode}
										setIsSplitSelectMode={setIsSplitSelectMode}
										preselectedRowIndex={preselectedRowIndex}
										setPreselectedRowIndex={setPreselectedRowIndex}
										onSplitItemEqual={onSplitItemEqual}
										onPayInFull={onPayInFull}
										onSelectGuest={onSelectGuest}
										onClose={onClose}
										isShareActionActive={isShareActionActive}
										formatMoney={formatMoney}
									/>
								);
							})()}
							</div>
							</div>
						</div>
					</div>
						<DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)', sideEffects: (defaultDropAnimationSideEffects ? defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.5' } } }) : undefined) }}>
							<OverlayContent orderItems={orderItems} formatMoney={formatMoney} />
						</DragOverlay>
					</DndContext>
				</div>
			</div>
		</div>
	);

	// Portal로 document.body에 렌더링하여 부모 스케일링 영향 방지
	if (typeof document !== 'undefined') {
		return createPortal(modalContent, document.body);
	}
	return modalContent;
};

export default SplitBillModal; 
