import React, { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { NEO_PRESS_INSET_ONLY_NO_SHIFT, PAY_NEO, PAY_NEO_CANVAS, PAY_NEO_PRIMARY_BLUE } from '../utils/softNeumorphic';

interface PrintBillModalProps {
  onClose: () => void;
  onPrintAllDetails: () => void;
  onPrintIndividualGuest: (guestNumber: number) => void;
  onPrintAllSeparateBills: () => void;
  guestIds: number[];
}

export const PrintBillModal: React.FC<PrintBillModalProps> = ({
  onClose,
  onPrintAllDetails,
  onPrintIndividualGuest,
  onPrintAllSeparateBills,
  guestIds,
}) => {
  // Guest IDs should be sorted for display
  const sortedGuestIds = useMemo(() => {
    return [...guestIds].sort((a, b) => a - b);
  }, [guestIds]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div
        className="flex w-full max-w-xl max-w-[95vw] max-h-[85vh] flex-col overflow-hidden rounded-2xl border-0 p-4"
        style={{ ...PAY_NEO.modalShell, background: PAY_NEO_CANVAS }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex shrink-0 items-center justify-between">
          <h3 className="text-lg font-bold text-gray-800">Print Bill Options</h3>
          <button
            type="button"
            onClick={onClose}
            className={`flex h-9 w-9 items-center justify-center border-0 text-lg font-bold text-gray-700 touch-manipulation ${NEO_PRESS_INSET_ONLY_NO_SHIFT}`}
            style={PAY_NEO.raised}
            title="Close"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          <div className="space-y-2 rounded-[14px] p-2.5" style={PAY_NEO.inset}>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onPrintAllDetails}
                className={`flex min-h-[4.5rem] flex-1 flex-col items-center justify-center gap-2 border-0 py-4 text-base font-semibold text-white touch-manipulation ${NEO_PRESS_INSET_ONLY_NO_SHIFT}`}
                style={PAY_NEO_PRIMARY_BLUE}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                One Bill
              </button>
              <button
                type="button"
                onClick={onPrintAllSeparateBills}
                className={`flex min-h-[4.5rem] flex-1 flex-col items-center justify-center gap-2 border-0 py-4 text-base font-semibold text-gray-900 touch-manipulation ${NEO_PRESS_INSET_ONLY_NO_SHIFT}`}
                style={PAY_NEO.key}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                Separate Bills
              </button>
            </div>
          </div>

          <div className="space-y-2 rounded-[14px] p-2.5" style={PAY_NEO.inset}>
            <div className="text-sm font-semibold text-gray-800">Guest bills</div>
            <div className="grid grid-cols-3 gap-2">
              {sortedGuestIds.map((guestId) => (
                <button
                  key={guestId}
                  type="button"
                  onClick={() => onPrintIndividualGuest(guestId)}
                  className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-[10px] border-0 px-2 py-2 text-sm font-bold text-gray-800 touch-manipulation ${NEO_PRESS_INSET_ONLY_NO_SHIFT}`}
                  style={PAY_NEO.key}
                >
                  <span className="text-xs font-extrabold text-gray-600">{guestId}</span>
                  <span className="text-xs font-semibold text-gray-800">Guest {guestId}</span>
                  <span className="text-[10px] font-medium uppercase tracking-wide text-gray-500">Print</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 flex shrink-0 justify-end">
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
    </div>,
    document.body
  );
};
