import React, { useCallback, useEffect, useState } from 'react';
import VirtualKeyboard from '../order/VirtualKeyboard';
import { createBistroTabOrder } from '../../utils/bistroCreateTabOrder';
import { formatBistroMoney, getBistroTabLabel } from '../../utils/bistroOrderHelpers';

export type BistroContainerModalProps = {
  open: boolean;
  onClose: () => void;
  containerId: string;
  containerTitle: string;
  /** 이 컨테이너(table_id)에 속한 오픈 주문만 */
  containerOrders: any[];
  onRefreshOrders: () => void;
  onOpenOrder: (orderId: number, tableId: string) => void;
};

const BistroContainerModal: React.FC<BistroContainerModalProps> = ({
  open,
  onClose,
  containerId,
  containerTitle,
  containerOrders,
  onRefreshOrders,
  onOpenOrder,
}) => {
  const [newTabName, setNewTabName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (open) {
      setNewTabName('');
      setSaveError('');
    }
  }, [open, containerId]);

  const handleSaveNewTab = useCallback(async () => {
    const label = newTabName.trim();
    if (!label) {
      setSaveError('Enter a tab name.');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const result = await createBistroTabOrder(containerId, label);
      if (!result.orderId) {
        setSaveError(result.error || 'Failed to create order.');
        return;
      }
      onRefreshOrders();
      onOpenOrder(Number(result.orderId), containerId);
      onClose();
    } catch (e: any) {
      setSaveError(e?.message || 'Failed to create order.');
    } finally {
      setSaving(false);
    }
  }, [newTabName, containerId, onRefreshOrders, onOpenOrder, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bistro-container-modal-title"
    >
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden p-3 sm:p-4"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="mx-auto flex w-full max-w-5xl min-h-0 flex-1 flex-col rounded-xl border border-slate-600 bg-slate-900 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
            <h2 id="bistro-container-modal-title" className="text-lg font-bold text-white">
              {containerTitle}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-600"
            >
              Close
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4 md:flex-row">
            <div className="flex w-full flex-col rounded-lg border border-slate-700 bg-slate-800/80 p-4 md:w-[340px]">
              <div className="mb-2 text-sm font-semibold text-sky-300">New Tab</div>
              <div className="mb-2 min-h-[44px] rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-white">
                {newTabName || '—'}
              </div>
              {saveError && <p className="mb-2 text-sm text-red-400">{saveError}</p>}
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSaveNewTab()}
                className="mt-2 rounded-lg bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>

            <div className="flex min-h-[200px] min-w-0 flex-1 flex-col rounded-lg border border-slate-700 bg-slate-800/80 p-4">
              <div className="mb-2 text-sm font-semibold text-sky-300">Open tabs</div>
              <ul className="max-h-[40vh] space-y-2 overflow-y-auto md:max-h-[min(50vh,420px)]">
                {containerOrders.length === 0 && (
                  <li className="text-sm text-slate-500">No open tabs.</li>
                )}
                {containerOrders.map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-left text-white hover:bg-slate-700"
                      onClick={() => {
                        onOpenOrder(Number(o.id), containerId);
                        onClose();
                      }}
                    >
                      <span className="font-medium">{getBistroTabLabel(o)}</span>
                      <span className="text-sm text-slate-300">{formatBistroMoney(Number(o.total || 0))}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="border-t border-slate-700 bg-slate-900 px-2 pb-safe">
            <VirtualKeyboard
              open={open}
              layoutMode="parentFlow"
              zIndex={90}
              maxWidthPx={960}
              showNumpad
              title="Tab name"
              displayText={newTabName}
              languages={['EN']}
              currentLanguage="EN"
              onType={(ch) => setNewTabName((s) => s + ch)}
              onBackspace={() => setNewTabName((s) => s.slice(0, -1))}
              onClear={() => setNewTabName('')}
              keepOpen
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default BistroContainerModal;
