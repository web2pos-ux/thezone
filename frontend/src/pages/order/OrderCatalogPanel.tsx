import React from 'react';
import { Category, LayoutSettings, MenuItem } from './orderTypes';
import CategoryBar from '../../components/order/CategoryBar';
import MenuItemGrid from '../../components/order/MenuItemGrid';
import OrderLoadingSkeleton from './OrderLoadingSkeleton';
import CatalogSnapshotOverlay from './CatalogSnapshotOverlay';

export interface CatalogSnapshot {
  timestamp: number;
  layout: {
    categoryRows: number;
    categoryCols: number;
    menuCols: number;
    menuRows?: number;
  };
  categories: Array<{ category_id: number; name: string }>;
  menuItems: Array<{ id: string | number; name: string; color?: string; price?: number }>;
  categoryOrder: string[];
}

interface OrderCatalogPanelProps {
  layoutSettings: LayoutSettings;
  showInitialMenuLoading: boolean;
  error: string | null;
  categories: Category[];
  sensors: any;
  getCategoryBarOrder: () => string[];
  selectedCategory: string;
  setSelectedCategory: (name: string) => void;
  mergyActive: boolean;
  setMergyActive: (active: boolean) => void;
  currentMergyGroupId: string | null;
  setCurrentMergyGroupId: (id: string | null) => void;
  MERGY_CATEGORY_ID: string;
  activeCategoryId: string | null;
  setActiveCategoryId: (id: string | null) => void;
  handleCategoryDragEnd: (event: any) => void;
  layoutLockReady: boolean;
  showBackgroundMenuLoading: boolean;
  filteredMenuItems: MenuItem[];
  itemColors: Record<string, string>;
  selectedMenuItemId: string | null;
  multiSelectMode: boolean;
  toggleSelectMenuItem: (id: string) => void;
  handleMenuItemClick: (item: MenuItem) => void;
  handleMenuItemDragEnd: (event: any) => void;
  activeMenuId: string | null;
  setActiveMenuId: (id: string | null) => void;
  isMergedSelected: boolean;
  menuItems: MenuItem[];
  extraButtons: any[];
  setSelectedItemForColor: (item: MenuItem) => void;
  setShowItemColorModal: (value: boolean) => void;
  soldOutItems: Set<string>;
  soldOutCategories: Set<string>;
  soldOutTimes: Map<string, { type: string; endTime: number; selector: string }>;
  updateLayoutSetting: (key: keyof LayoutSettings, value: any) => void;
  catalogSnapshot?: CatalogSnapshot | null;
  showEmptySlots?: boolean;
  emptySlotMode?: 'none' | 'configured' | 'fill';
  showAllCategoriesGrouped?: boolean;
}

const OrderCatalogPanel: React.FC<OrderCatalogPanelProps> = ({
  layoutSettings,
  showInitialMenuLoading,
  error,
  categories,
  sensors,
  getCategoryBarOrder,
  selectedCategory,
  setSelectedCategory,
  mergyActive,
  setMergyActive,
  currentMergyGroupId,
  setCurrentMergyGroupId,
  MERGY_CATEGORY_ID,
  activeCategoryId,
  setActiveCategoryId,
  handleCategoryDragEnd,
  layoutLockReady,
  showBackgroundMenuLoading,
  filteredMenuItems,
  itemColors,
  selectedMenuItemId,
  multiSelectMode,
  toggleSelectMenuItem,
  handleMenuItemClick,
  handleMenuItemDragEnd,
  activeMenuId,
  setActiveMenuId,
  isMergedSelected,
  menuItems,
  extraButtons,
  setSelectedItemForColor,
  setShowItemColorModal,
  soldOutItems,
  soldOutCategories,
  soldOutTimes,
  updateLayoutSetting,
  catalogSnapshot,
  showEmptySlots = true,
  emptySlotMode,
  showAllCategoriesGrouped = false,
}) => {
  const placeholdersEnabled = showEmptySlots !== false;
  const showLoadingState = showInitialMenuLoading;
  const showPlaceholderLoading = placeholdersEnabled && showLoadingState;
  const showMinimalLoading = !placeholdersEnabled && showLoadingState;

  const layoutIdsForSelectedCategory = React.useMemo(() => {
    if (!selectedCategory) return undefined as any;
    if (selectedCategory === MERGY_CATEGORY_ID) return undefined as any;
    const cat = categories.find(c => c.name === selectedCategory);
    if (!cat) return undefined as any;
    const map = (layoutSettings as any).menuItemOrderByCategory || {};
    return map[cat.category_id] as any;
  }, [categories, layoutSettings, selectedCategory, MERGY_CATEGORY_ID]);

  const getLayoutIdsForCategory = React.useCallback((catName: string) => {
    const cat = categories.find(c => c.name === catName);
    if (!cat) return undefined;
    const map = (layoutSettings as any).menuItemOrderByCategory || {};
    return map[cat.category_id];
  }, [categories, layoutSettings]);

  return (
    <div className="relative flex-1 flex flex-col min-h-0">
      {showPlaceholderLoading && catalogSnapshot && (
        <CatalogSnapshotOverlay snapshot={catalogSnapshot} layoutSettings={layoutSettings} />
      )}
      <div className="border-b flex-shrink-0" style={{ backgroundColor: layoutSettings.categoryAreaBgColor || '#f3f4f6' }}>
        {showPlaceholderLoading ? (
          catalogSnapshot ? (
            <SnapshotCategoryPlaceholder snapshot={catalogSnapshot} layoutSettings={layoutSettings} />
          ) : (
            <div className="py-4">
              <OrderLoadingSkeleton
                categoryRows={Math.max(1, Number(layoutSettings.categoryRows) || 1)}
                categoryCols={Math.max(1, Number(layoutSettings.categoryColumns) || 1)}
                menuRows={1}
                menuCols={Math.max(2, Math.min(6, Number(layoutSettings.categoryColumns) || 4))}
              />
            </div>
          )
        ) : showMinimalLoading ? (
          <div className="py-5 text-center text-gray-400 text-sm">Loading…</div>
        ) : error ? (
          <div className="text-center py-8 text-red-600">
            <p className="font-medium">Failed to load menu data</p>
            <p className="text-sm text-red-500">{error}</p>
          </div>
        ) : categories.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No categories found</p>
            <p className="text-sm">Please select a menu with categories</p>
          </div>
        ) : (
          <CategoryBar
            sensors={sensors}
            order={getCategoryBarOrder()}
            categories={categories.map(c => ({ category_id: c.category_id, name: c.name }))}
            mergedGroups={layoutSettings.mergedGroups || []}
            layoutSettings={layoutSettings}
            selectedCategory={selectedCategory}
            setSelectedCategory={setSelectedCategory}
            mergyActive={mergyActive}
            setMergyActive={setMergyActive}
            currentMergyGroupId={currentMergyGroupId}
            setCurrentMergyGroupId={setCurrentMergyGroupId}
            MERGY_CATEGORY_ID={MERGY_CATEGORY_ID}
            activeCategoryId={activeCategoryId}
            setActiveCategoryId={setActiveCategoryId}
            handleCategoryDragEnd={handleCategoryDragEnd}
            lockLayout={layoutLockReady}
          />
        )}
      </div>

      <div className="px-2">
        <div className="h-1 bg-white" />
      </div>

      <div className="flex-1 overflow-hidden pt-0 pl-2 pr-2 pb-0 min-h-0" style={{ backgroundColor: layoutSettings.menuAreaBgColor || '#f9fafb' }}>
        {showPlaceholderLoading ? (
          catalogSnapshot ? (
            <SnapshotMenuPlaceholder snapshot={catalogSnapshot} />
          ) : (
            <div className="h-full overflow-hidden px-2 pt-2">
              <OrderLoadingSkeleton
                categoryRows={Math.max(1, Number(layoutSettings.categoryRows) || 1)}
                categoryCols={Math.max(1, Number(layoutSettings.categoryColumns) || 1)}
                menuRows={4}
                menuCols={Math.max(2, Number(layoutSettings.menuGridColumns) || 4)}
              />
            </div>
          )
        ) : showMinimalLoading ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">Loading…</div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-red-600">
            <div className="text-center">
              <p className="font-medium">Failed to load menu items</p>
              <p className="text-sm text-red-500">{error}</p>
            </div>
          </div>
        ) : !selectedCategory ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <p className="font-medium">No category selected</p>
              <p className="text-sm">Please select a category to view menu items</p>
            </div>
          </div>
        ) : (
          <div className={`${isMergedSelected ? 'w-full h-full overflow-hidden pr-1' : 'w-full h-full'} relative`}>
            {showBackgroundMenuLoading && (
              <div className="absolute top-2 right-2 pointer-events-none">
                <div className="px-3 py-1 rounded-full bg-amber-500/90 text-white text-xs font-semibold shadow">
                  Syncing…
                </div>
              </div>
            )}

            <MenuItemGrid
              sensors={sensors}
              filteredMenuItems={filteredMenuItems}
              layoutSettings={layoutSettings}
              itemColors={itemColors}
              selectedMenuItemId={selectedMenuItemId}
              multiSelectMode={multiSelectMode}
              toggleSelectMenuItem={toggleSelectMenuItem}
              handleMenuItemClick={handleMenuItemClick}
              handleMenuItemDragEnd={handleMenuItemDragEnd}
              activeMenuId={activeMenuId}
              setActiveMenuId={setActiveMenuId}
              mergyActive={mergyActive}
              isMergedSelected={isMergedSelected}
              selectedCategory={selectedCategory}
              MERGY_CATEGORY_ID={MERGY_CATEGORY_ID}
              currentMergyGroupId={currentMergyGroupId}
              mergedGroups={layoutSettings.mergedGroups || []}
              menuItems={menuItems}
              extraItems={extraButtons}
              openItemColor={(item) => {
                setSelectedItemForColor(item as any);
                setShowItemColorModal(true);
              }}
              layoutIdsForCategory={layoutIdsForSelectedCategory}
              getLayoutIdsForCategory={getLayoutIdsForCategory}
              onMenuGridReorder={({ ids, category }) => {
                if (!category) return;
                const cat = categories.find(c => c.name === category);
                if (!cat) return;
                const map = { ...(layoutSettings as any).menuItemOrderByCategory };
                (map as any)[cat.category_id] = Array.isArray(ids) ? ids : [];
                updateLayoutSetting('menuItemOrderByCategory' as keyof LayoutSettings, map as any);
              }}
              soldOutItems={soldOutItems}
              soldOutCategories={soldOutCategories}
              soldOutTimes={soldOutTimes}
              lockLayout={layoutLockReady}
              showEmptySlots={showEmptySlots}
              emptySlotMode={emptySlotMode}
              showAllCategoriesGrouped={showAllCategoriesGrouped}
              allCategories={categories.map(c => ({ category_id: String(c.category_id), name: c.name }))}
            />
          </div>
        )}
      </div>

      <div className="px-2">
        <div className="h-1 bg-white" />
      </div>
    </div>
  );
};

const SnapshotCategoryPlaceholder: React.FC<{ snapshot: CatalogSnapshot; layoutSettings: LayoutSettings }> = ({ snapshot, layoutSettings }) => {
  const rows = Math.max(1, snapshot.layout.categoryRows || 1);
  const cols = Math.max(1, snapshot.layout.categoryCols || 1);
  const total = rows * cols;

  const categoryMap = new Map(snapshot.categories.map((c) => [String(c.category_id), c]));
  const order = snapshot.categoryOrder.length ? snapshot.categoryOrder : snapshot.categories.map((c) => String(c.category_id));
  const resolved = order
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
    .slice(0, total);

  return (
    <div className="py-3 select-none pointer-events-none px-2">
      <div className="text-xs text-gray-500 mb-2">Restoring layout...</div>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {resolved.map((entry, idx) => (
          <div
            key={`${entry!.id}-${idx}`}
            className={`h-12 rounded-md flex items-center justify-center text-sm font-medium ${
              entry!.isGroup ? 'bg-purple-700 text-white' : 'bg-white/90 text-gray-700'
            } border border-white/60 shadow-inner`}
          >
            {entry!.name}
          </div>
        ))}
        {resolved.length < total &&
          Array.from({ length: total - resolved.length }).map((_, idx) => (
            <div key={`cat-pad-${idx}`} className="h-12 rounded-md bg-slate-100 border border-gray-200" />
          ))}
      </div>
    </div>
  );
};

const SnapshotMenuPlaceholder: React.FC<{ snapshot: CatalogSnapshot }> = ({ snapshot }) => {
  const cols = Math.max(1, snapshot.layout.menuCols || 4);
  const menuItems = snapshot.menuItems.slice();
  const rows = snapshot.layout.menuRows || Math.max(3, Math.ceil(menuItems.length / cols));

  return (
    <div className="h-full overflow-hidden px-2 pt-2 select-none pointer-events-none">
      <div className="text-xs text-gray-500 mb-2">Showing previous menu while syncing…</div>
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, rowIdx) => {
          const slice = menuItems.slice(rowIdx * cols, rowIdx * cols + cols);
          return (
            <div
              key={`snapshot-row-${rowIdx}`}
              className="grid gap-3"
              style={{ gridTemplateColumns: `repeat(cols, minmax(0, 1fr))`.replace('cols', String(cols)) }}
            >
              {slice.map((item, idx) => (
                <div
                  key={`snapshot-item-${rowIdx}-${idx}`}
                  className="h-24 rounded-xl border border-gray-200 shadow-inner bg-white flex items-center justify-center text-sm font-semibold text-gray-600 text-center px-2"
                >
                  <span className="truncate">{item.name}</span>
                </div>
              ))}
              {slice.length < cols &&
                Array.from({ length: cols - slice.length }).map((__, padIdx) => (
                  <div key={`snapshot-pad-${rowIdx}-${padIdx}`} className="h-24 rounded-xl bg-slate-100 border border-gray-200 shadow-inner" />
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default OrderCatalogPanel;

