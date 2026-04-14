import React, { useEffect, useMemo, useState } from 'react';

interface TipEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (tipAmount: number) => Promise<void> | void;
}

const TipEntryModal: React.FC<TipEntryModalProps> = ({ isOpen, onClose, onSave }) => {
  const [raw, setRaw] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setRaw('');
      setIsSaving(false);
    }
  }, [isOpen]);

  const tipAmount = useMemo(() => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Number(n.toFixed(2));
  }, [raw]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={() => { if (!isSaving) onClose(); }} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-[420px] overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 px-6 py-4 text-center">
          <h2 className="text-2xl font-bold text-white">Add Tips</h2>
        </div>

        <div className="p-6">
          <div className="mb-4">
            <label className="text-sm font-semibold text-gray-700 block mb-1">Tip Amount</label>
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold text-gray-600">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                className="flex-1 h-12 px-3 text-xl font-semibold text-right border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-400 bg-white"
                placeholder="0.00"
                disabled={isSaving}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && tipAmount > 0 && !isSaving) {
                    setIsSaving(true);
                    try { await Promise.resolve(onSave(tipAmount)); } finally { setIsSaving(false); }
                  }
                }}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              className="px-5 py-2.5 rounded-lg bg-gray-200 hover:bg-gray-300 disabled:bg-gray-200 text-sm font-bold transition-colors min-w-[110px]"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="px-5 py-2.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-gray-300 disabled:text-gray-600 text-sm font-bold transition-colors min-w-[110px]"
              disabled={tipAmount <= 0 || isSaving}
              onClick={async () => {
                if (tipAmount <= 0 || isSaving) return;
                setIsSaving(true);
                try {
                  await Promise.resolve(onSave(tipAmount));
                } finally {
                  setIsSaving(false);
                }
              }}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TipEntryModal;

