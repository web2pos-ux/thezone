import React from 'react';

interface OrderLoadingSkeletonProps {
  categoryRows?: number;
  categoryCols?: number;
  menuRows?: number;
  menuCols?: number;
}

const OrderLoadingSkeleton: React.FC<OrderLoadingSkeletonProps> = ({
  categoryRows = 2,
  categoryCols = 6,
  menuRows = 4,
  menuCols = 4,
}) => {
  const categoryCount = Math.max(1, categoryRows * categoryCols);
  const menuCount = Math.max(1, menuRows * menuCols);

  return (
    <div className="space-y-4">
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${categoryCols}, minmax(0, 1fr))` }}>
        {Array.from({ length: categoryCount }).map((_, idx) => (
          <div
            key={`cat-skel-${idx}`}
            className="h-12 rounded-md bg-gradient-to-br from-slate-200 via-slate-100 to-slate-200 animate-pulse shadow-inner"
          />
        ))}
      </div>

      <div className="space-y-3">
        {Array.from({ length: menuRows }).map((_, rowIdx) => (
          <div
            key={`menu-row-${rowIdx}`}
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${menuCols}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: menuCols }).map((__, colIdx) => (
              <div
                key={`menu-cell-${rowIdx}-${colIdx}`}
                className="h-24 rounded-xl bg-gradient-to-br from-slate-100 via-slate-50 to-slate-200 animate-pulse shadow-inner"
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

export default OrderLoadingSkeleton;

