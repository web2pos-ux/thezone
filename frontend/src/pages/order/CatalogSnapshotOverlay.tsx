import React from 'react';
import { CatalogSnapshot } from './OrderCatalogPanel';
import { LayoutSettings } from './orderTypes';

interface CatalogSnapshotOverlayProps {
  snapshot: CatalogSnapshot;
  layoutSettings: LayoutSettings;
}

const CatalogSnapshotOverlay: React.FC<CatalogSnapshotOverlayProps> = ({ snapshot, layoutSettings }) => {
  const categoryRows = Math.max(1, snapshot.layout.categoryRows || 1);
  const categoryCols = Math.max(1, snapshot.layout.categoryCols || 1);
  const catTotal = categoryRows * categoryCols;

  const categoryMap = new Map(snapshot.categories.map((c) => [String(c.category_id), c]));
  const order = snapshot.categoryOrder.length ? snapshot.categoryOrder : snapshot.categories.map((c) => String(c.category_id));
  const resolvedCategories = order
    .map((id) => {
      if (id.startsWith('mergy_')) {
        const group = (layoutSettings.mergedGroups || []).find((g: any) => g.id === id);
        if (!group) return null;
        return { id, name: group.name, isGroup: true };
      }
      const cat = categoryMap.get(id);
      if (!cat) return null;
      return { id, name: cat.name, isGroup: false };
    })
    .filter(Boolean)
    .slice(0, catTotal);
  const catPaddingCount = Math.max(0, catTotal - resolvedCategories.length);

  const menuCols = Math.max(1, snapshot.layout.menuCols || 4);
  const menuRows = Math.max(1, snapshot.layout.menuRows || Math.ceil(snapshot.menuItems.length / menuCols));
  const menuItems = snapshot.menuItems.slice(0, menuCols * menuRows);

  return (
    <div className="absolute inset-0 z-10 pointer-events-none flex flex-col">
      <div
        className="border-b flex-shrink-0 px-2 py-2 space-y-1"
        style={{ backgroundColor: layoutSettings.categoryAreaBgColor || '#f3f4f6' }}
      >
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${categoryCols}, minmax(0, 1fr))` }}>
          {resolvedCategories.map((entry, idx) => (
            <div
              key={`snapshot-cat-${entry!.id}-${idx}`}
              className={`h-12 rounded-md text-center flex items-center justify-center text-sm font-semibold ${
                entry!.isGroup ? 'bg-purple-800 text-white' : 'bg-indigo-900 text-white'
              }`}
              style={{
                boxShadow: 'inset 0 3px 10px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.15) inset',
              }}
            >
              {entry!.name}
            </div>
          ))}
          {catPaddingCount > 0 &&
            Array.from({ length: catPaddingCount }).map((_, idx) => (
              <div key={`snapshot-cat-pad-${idx}`} className="h-12 rounded-md bg-white/40 border border-white/60" />
            ))}
        </div>
      </div>
      <div
        className="flex-1 overflow-hidden px-2 py-2 space-y-3"
        style={{ backgroundColor: layoutSettings.menuAreaBgColor || '#f9fafb' }}
      >
        {Array.from({ length: menuRows }).map((_, rowIdx) => {
          const slice = menuItems.slice(rowIdx * menuCols, rowIdx * menuCols + menuCols);
          const padCount = Math.max(0, menuCols - slice.length);
          return (
            <div
              key={`snapshot-menu-row-${rowIdx}`}
              className="grid gap-3"
              style={{ gridTemplateColumns: `repeat(${menuCols}, minmax(0, 1fr))` }}
            >
              {slice.map((item, idx) => (
                <div
                  key={`snapshot-menu-${rowIdx}-${idx}`}
                  className="h-24 rounded-xl border border-white/60 shadow-inner bg-gradient-to-br from-slate-200 via-white to-slate-200 flex flex-col items-center justify-center text-sm font-semibold text-gray-700 px-2 text-center"
                >
                  <span className="truncate">{item.name}</span>
                  {item.price != null && (
                    <span className="text-xs text-gray-500 mt-1">${item.price?.toFixed?.(2) ?? item.price}</span>
                  )}
                </div>
              ))}
              {padCount > 0 &&
                Array.from({ length: padCount }).map((__, idx) => (
                  <div key={`snapshot-menu-pad-${rowIdx}-${idx}`} className="h-24 rounded-xl bg-white/40 border border-white/50 shadow-inner" />
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CatalogSnapshotOverlay;

