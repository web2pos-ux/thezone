import React, { useMemo } from 'react';
import { createPortal } from 'react-dom';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-xl rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-3 text-white flex justify-between items-center shrink-0">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Print Bill Options
          </h2>
          <button 
            onClick={onClose}
            className="p-1.5 hover:bg-white/20 rounded-full transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
          
          {/* Option 1: Print Consolidated & All Separate */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 hover:border-indigo-300 hover:shadow transition-all">
            <div className="flex justify-between items-center gap-4">
              <button
                onClick={onPrintAllDetails}
                className="flex-1 px-5 py-6 bg-indigo-100 hover:bg-indigo-200 text-indigo-800 rounded-lg font-bold text-lg shadow-sm active:bg-red-100 active:text-red-600 active:ring-2 active:ring-red-400 transition-all flex items-center justify-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                One Bill
              </button>
              <button
                onClick={onPrintAllSeparateBills}
                className="flex-1 px-5 py-6 bg-green-100 hover:bg-green-200 text-green-800 rounded-lg font-bold text-lg shadow-sm active:bg-red-100 active:text-red-600 active:ring-2 active:ring-red-400 transition-all flex items-center justify-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                Separate Bills
              </button>
            </div>
          </div>

          {/* Option 2: Individual Guest Bills */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 hover:border-indigo-300 hover:shadow transition-all">
            {/* Guest Grid */}
            <div className="grid grid-cols-4 gap-3">
              {sortedGuestIds.map((guestId) => (
                <button
                  key={guestId}
                  onClick={() => onPrintIndividualGuest(guestId)}
                  className="flex flex-col items-center justify-center p-2 bg-gray-50 border border-gray-200 rounded-lg hover:border-indigo-500 hover:bg-indigo-50 active:bg-red-50 active:border-red-400 active:text-red-600 transition-all group h-16"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-white border border-gray-300 group-hover:border-indigo-300 group-active:border-red-300 flex items-center justify-center text-gray-500 group-hover:text-indigo-600 group-active:text-red-600 transition-colors text-xs font-bold">
                        {guestId}
                    </div>
                    <span className="font-bold text-gray-700 group-hover:text-indigo-700 group-active:text-red-700 text-sm">Guest {guestId}</span>
                  </div>
                  <span className="text-[10px] text-gray-400 mt-0.5 font-medium group-hover:text-indigo-400 group-active:text-red-400 uppercase tracking-wide">Print</span>
                </button>
              ))}
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 rounded-lg font-semibold text-base shadow-sm active:transform active:scale-95 transition-all min-w-[100px]"
          >
            Close
          </button>
        </div>

      </div>
    </div>,
    document.body
  );
};

