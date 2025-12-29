import React, { useEffect, useMemo, useState } from 'react';
import { PartialSelectionPayload } from '../types/MoveMergeTypes';
import { API_URL } from '../config/constants';

interface SimplePartialSelectionModalProps {
  isOpen: boolean;
  tableId: string;
  tableLabel: string;
  orderId?: number | string | null;
  onClose: () => void;
  onConfirm: (selection: PartialSelectionPayload | 'ALL') => void;
}

interface GuestGroup {
  guestNumber: number;
  count: number;
  subtotal: number;
}

export const SimplePartialSelectionModal: React.FC<SimplePartialSelectionModalProps> = ({
  isOpen,
  tableId,
  tableLabel,
  orderId,
  onClose,
  onConfirm,
}) => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<number>>(new Set());
  const [selectedOrderLineIds, setSelectedOrderLineIds] = useState<Set<string>>(new Set());
  const [selectedGuests, setSelectedGuests] = useState<Set<number>>(new Set());
  const hasOrder = Boolean(orderId);

  useEffect(() => {
    if (!isOpen) return;

    setSelectedItemIds(new Set());
    setSelectedOrderLineIds(new Set());
    setSelectedGuests(new Set());

    if (!orderId) {
      setItems([]);
      return;
    }

    setLoading(true);
    fetch(`${API_URL}/orders/${orderId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.items)) {
          setItems(data.items);
        } else {
          setItems([]);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch order items for partial selection:', err);
        setItems([]);
      })
      .finally(() => setLoading(false));
  }, [isOpen, orderId]);

  const guestGroups: GuestGroup[] = useMemo(() => {
    const map = new Map<number, GuestGroup>();
    items.forEach((item) => {
      const guestNumber = Number(item.guest_number) || 1;
      const current = map.get(guestNumber) || { guestNumber, count: 0, subtotal: 0 };
      current.count += Number(item.quantity) || 1;
      current.subtotal += Number(item.price || 0) * (Number(item.quantity) || 1);
      map.set(guestNumber, current);
    });
    return Array.from(map.values()).sort((a, b) => a.guestNumber - b.guestNumber);
  }, [items]);

  const itemsByGuest = useMemo(() => {
    const map = new Map<number, any[]>();
    items.forEach((item) => {
      const guestNumber = Number(item.guest_number) || 1;
      const list = map.get(guestNumber) || [];
      list.push(item);
      map.set(guestNumber, list);
    });
    return map;
  }, [items]);

  if (!isOpen) return null;

  const handleToggleGuest = (guestNumber: number) => {
    setSelectedGuests((prev) => {
      const next = new Set(prev);
      if (next.has(guestNumber)) next.delete(guestNumber);
      else next.add(guestNumber);
      return next;
    });
  };

  const handleToggleItem = (item: any) => {
    const itemId = Number(item.id);
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
    if (item.order_line_id != null) {
      setSelectedOrderLineIds((prev) => {
        const key = String(item.order_line_id).trim();
        const next = new Set(prev);
        if (!key) return next;
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    }
  };

  const handleToggleGuestItems = (guestNumber: number) => {
    const guestItems = itemsByGuest.get(guestNumber) || [];
    if (guestItems.length === 0) return;

    // Check if all items in this guest are already selected
    const allSelected = guestItems.every((item) => {
      const itemId = Number(item.id);
      return selectedItemIds.has(itemId) || selectedGuests.has(guestNumber);
    });

    if (allSelected) {
      // Deselect all items in this guest
      setSelectedItemIds((prev) => {
        const next = new Set(prev);
        guestItems.forEach((item) => next.delete(Number(item.id)));
        return next;
      });
      setSelectedOrderLineIds((prev) => {
        const next = new Set(prev);
        guestItems.forEach((item) => {
          if (item.order_line_id != null) {
            next.delete(String(item.order_line_id).trim());
          }
        });
        return next;
      });
    } else {
      // Select all items in this guest
      setSelectedItemIds((prev) => {
        const next = new Set(prev);
        guestItems.forEach((item) => next.add(Number(item.id)));
        return next;
      });
      setSelectedOrderLineIds((prev) => {
        const next = new Set(prev);
        guestItems.forEach((item) => {
          if (item.order_line_id != null) {
            const key = String(item.order_line_id).trim();
            if (key) next.add(key);
          }
        });
        return next;
      });
    }
  };

  const handleSubmit = () => {
    const payload: PartialSelectionPayload = {
      mode: 'partial',
      guestNumbers: Array.from(selectedGuests),
      orderItemIds: Array.from(selectedItemIds),
      orderLineIds: Array.from(selectedOrderLineIds),
    };

    if (
      payload.guestNumbers.length === 0 &&
      payload.orderItemIds.length === 0 &&
      payload.orderLineIds.length === 0
    ) {
      alert('이동할 게스트 또는 아이템을 선택해주세요.');
      return;
    }

    onConfirm(payload);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4 py-6">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col border border-slate-200" style={{ marginTop: '-150px' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b bg-slate-50 rounded-t-2xl">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">{`Select items to move from ${tableLabel || tableId}`}</h3>
          </div>
        </div>

        <div className="px-5 py-4 border-b">
          {!hasOrder ? (
            <div className="text-sm text-amber-600">No active order found. Only full-table move is available.</div>
          ) : guestGroups.length === 0 ? (
            <div className="text-sm text-slate-500">No items found for this order.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {guestGroups.map((guest) => {
                const active = selectedGuests.has(guest.guestNumber);
                return (
                  <button
                    key={guest.guestNumber}
                    onClick={() => handleToggleGuest(guest.guestNumber)}
                    className={`flex flex-col justify-center h-16 px-3 py-2 rounded-xl border text-sm font-semibold transition ${
                      active
                        ? 'bg-purple-600 border-purple-600 text-white shadow'
                        : 'bg-white border-slate-200 text-slate-700 hover:border-purple-300'
                    }`}
                  >
                    <span className="text-base font-semibold">{`Guest ${guest.guestNumber}`}</span>
                    <span className="text-xs font-medium">
                      {guest.count} items · ${guest.subtotal.toFixed(2)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {loading ? (
            <div className="text-center text-slate-500 py-6">Loading items...</div>
          ) : items.length === 0 ? (
            <div className="text-center text-slate-500 py-6">There are no selectable items.</div>
          ) : (
            guestGroups.map((guest) => {
              const guestItems = itemsByGuest.get(guest.guestNumber) || [];
              if (guestItems.length === 0) return null;
              
              // Check if all items of this guest are selected
              const allGuestItemsSelected = guestItems.every((item) => {
                const itemId = Number(item.id);
                return selectedItemIds.has(itemId) || selectedGuests.has(guest.guestNumber);
              });

              return (
                <div
                  key={`guest-block-${guest.guestNumber}`}
                  className="flex w-full rounded-xl border border-slate-200 overflow-hidden"
                >
                  <button
                    onClick={() => handleToggleGuestItems(guest.guestNumber)}
                    className={`w-24 flex flex-col items-center justify-center px-3 py-4 text-sm font-semibold transition cursor-pointer ${
                      allGuestItemsSelected
                        ? 'bg-purple-600 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    <span className="text-base">{`Guest ${guest.guestNumber}`}</span>
                    <span className={`text-xs font-normal ${allGuestItemsSelected ? 'text-white/90' : ''}`}>
                      {`${guest.count} items`}
                    </span>
                  </button>
                  <div className="flex-1 divide-y divide-slate-100">
                    {guestItems.map((item) => {
                      const numericId = Number(item.id);
                      const active =
                        selectedItemIds.has(numericId) || selectedGuests.has(Number(item.guest_number) || 1);
                      return (
                        <div
                          key={item.id}
                          onClick={() => handleToggleItem(item)}
                          className={`flex items-center justify-between gap-3 px-3 py-2 text-sm font-semibold transition cursor-pointer ${
                            active
                              ? 'bg-indigo-50 text-indigo-700'
                              : 'hover:bg-slate-50 text-slate-800'
                          }`}
                        >
                          <span className="truncate">{item.name}</span>
                          <span className="text-xs text-slate-500 whitespace-nowrap">{`Qty ${item.quantity} · $${Number(item.price || 0).toFixed(2)}`}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="px-5 py-4 border-t bg-slate-50 rounded-b-2xl flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3">
          <div className="flex gap-3 w-full sm:w-auto">
            <button
              onClick={onClose}
              className="flex-1 h-12 px-4 rounded-xl border border-slate-300 text-slate-600 font-semibold hover:bg-white"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!hasOrder}
              className="flex-1 h-12 px-4 rounded-xl bg-indigo-600 text-white font-semibold shadow hover:bg-indigo-500 disabled:opacity-50"
            >
              Move Selected
            </button>
          </div>
          <div className="flex w-full sm:w-auto">
            <button
              onClick={() => {
                onConfirm('ALL');
              }}
              className="flex-1 h-12 px-4 rounded-xl bg-blue-800 text-white font-semibold hover:bg-blue-900 leading-tight text-left sm:text-center min-w-[150px] shadow"
            >
              <span className="block">Move</span>
              <span className="block">All</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

