import React, { useState } from 'react';

interface DangerousActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  warningItems: string[];
  confirmText?: string;
  cancelText?: string;
  confirmPhrase?: string; // e.g. "UPLOAD" - user must type this to unlock
}

/**
 * DangerousActionModal - 위험한 작업 전 사용자 승인을 받는 확인 모달
 * 
 * 사용법:
 * <DangerousActionModal
 *   isOpen={showModal}
 *   onClose={() => setShowModal(false)}
 *   onConfirm={handleDangerousAction}
 *   title="Upload Menu to Cloud"
 *   description="This will overwrite ALL menu data on TZO Cloud."
 *   warningItems={["Existing cloud menu will be deleted", "This cannot be undone"]}
 *   confirmPhrase="UPLOAD"
 * />
 */
const DangerousActionModal: React.FC<DangerousActionModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  warningItems,
  confirmText = 'Yes, Proceed',
  cancelText = 'Cancel',
  confirmPhrase,
}) => {
  const [typedPhrase, setTypedPhrase] = useState('');
  const [agreed, setAgreed] = useState(false);

  if (!isOpen) return null;

  const phraseMatched = !confirmPhrase || typedPhrase.trim().toUpperCase() === confirmPhrase.toUpperCase();
  const canProceed = agreed && phraseMatched;

  const handleClose = () => {
    setTypedPhrase('');
    setAgreed(false);
    onClose();
  };

  const handleConfirm = () => {
    if (!canProceed) return;
    setTypedPhrase('');
    setAgreed(false);
    onConfirm();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100]">
      <div className="bg-white rounded-2xl shadow-2xl w-[480px] overflow-hidden">
        {/* Header */}
        <div className="bg-red-600 text-white px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🔒</span>
            <div>
              <div className="text-xl font-bold">{title}</div>
              <div className="text-red-200 text-sm mt-0.5">This action requires your approval</div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Description */}
          <p className="text-gray-700 text-base leading-relaxed">{description}</p>

          {/* Warning Items */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="font-semibold text-amber-800 mb-2 flex items-center gap-2">
              <span>⚠️</span> Before you proceed, please understand:
            </div>
            <ul className="space-y-1.5">
              {warningItems.map((item, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm text-amber-900">
                  <span className="mt-0.5 text-amber-600">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Confirmation Phrase Input */}
          {confirmPhrase && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Type <span className="text-red-600 font-mono bg-red-50 px-1.5 py-0.5 rounded">{confirmPhrase}</span> to unlock:
              </label>
              <input
                type="text"
                value={typedPhrase}
                onChange={(e) => setTypedPhrase(e.target.value)}
                placeholder={`Type ${confirmPhrase} here...`}
                className={`w-full px-3 py-2.5 border-2 rounded-lg text-center font-mono text-lg tracking-widest ${
                  typedPhrase.length > 0 && phraseMatched
                    ? 'border-green-500 bg-green-50 text-green-700'
                    : typedPhrase.length > 0
                    ? 'border-red-300 bg-red-50 text-red-700'
                    : 'border-gray-300'
                } focus:outline-none`}
                autoFocus
              />
            </div>
          )}

          {/* Agreement Checkbox */}
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-1 w-5 h-5 accent-red-600 cursor-pointer"
            />
            <span className="text-sm text-gray-700 leading-relaxed">
              I understand the risks and want to proceed with this action.
            </span>
          </label>
        </div>

        {/* Footer Buttons */}
        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={handleClose}
            className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canProceed}
            className={`flex-1 py-3 font-bold rounded-xl transition-all ${
              canProceed
                ? 'bg-red-600 hover:bg-red-700 text-white shadow-md'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            {canProceed ? '🔓 ' : '🔒 '}{confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DangerousActionModal;
