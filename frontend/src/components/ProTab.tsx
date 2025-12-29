import React from 'react';

interface ProTabProps {
  isTogo: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onDiscountClick?: () => void;
}

export const ProTab: React.FC<ProTabProps> = ({ isTogo, expanded, onToggleExpanded, onDiscountClick }) => {
  return (
    <div className="mb-3 bg-gray-700 rounded-lg p-2" style={{ display: isTogo ? 'none' : undefined }}>
      <div className="flex items-center justify-between mb-2 bg-slate-400 rounded-t-lg p-2 -m-2 mb-3">
        <h3 className="text-sm font-semibold text-white">Promotion Tab</h3>
        <button
          onClick={onToggleExpanded}
          className="text-white hover:text-gray-200 transition-colors"
          title={expanded ? '접기' : '펼치기'}
        >
          {expanded ? '▲' : '▼'}
        </button>
      </div>
      {expanded && (
        <div className="space-y-2">
          <div className="p-2 bg-gray-600 rounded text-sm text-gray-100">
            <div className="text-xs text-gray-200 mb-2">Advanced features</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={onDiscountClick}
                className="col-span-2 w-full py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors"
                title="Promotion settings"
              >
                Promotion Setting
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProTab; 