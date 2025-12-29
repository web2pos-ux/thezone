import React from 'react';

export interface PromotionTabProps {
  isTogo: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onCreatePromotionClick?: () => void;
  code?: string;
  onChangeCode?: (v: string) => void;
}

export const PromotionTab: React.FC<PromotionTabProps> = ({
  isTogo,
  expanded,
  onToggleExpanded,
  onCreatePromotionClick,
  code,
  onChangeCode,
}) => {
  return (
    <div className="mb-3 bg-gray-700 rounded-lg p-2" style={{ display: isTogo ? 'none' : undefined }}>
      <div className="flex items-center justify-between mb-2 bg-purple-500 rounded-t-lg p-2 -m-2 mb-3">
        <h3 className="text-sm font-semibold text-white">Promotion Tab</h3>
        <button onClick={onToggleExpanded} className="text-white hover:text-gray-200 transition-colors" title={expanded ? '접기' : '펼치기'}>
          {expanded ? '▲' : '▼'}
        </button>
      </div>
      {expanded && (
        <div className="space-y-2">
          <div className="p-2 bg-gray-600 rounded text-sm text-gray-100">
            <button
              onClick={() => onCreatePromotionClick && onCreatePromotionClick()}
              className="w-full py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors"
              title="Create a new promotion"
            >
              Create Promotion
            </button>
          </div>
          <div className="p-2 bg-gray-600 rounded text-sm text-gray-100 flex items-center gap-2">
            <label className="text-xs text-gray-200">Promotion Code</label>
            <input
              value={code || ''}
              onChange={(e)=> onChangeCode && onChangeCode(e.target.value)}
              onBlur={(e)=> onChangeCode && onChangeCode(e.target.value.trim())}
              className="flex-1 min-w-0 rounded px-2 py-1 text-sm text-gray-900"
              placeholder="Enter code (case-sensitive)"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default PromotionTab; 