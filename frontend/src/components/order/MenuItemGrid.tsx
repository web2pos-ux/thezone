import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { getContrastingTextColor, isHexColor } from '../../utils/colorUtils';
import { MenuItem } from '../../pages/order/orderTypes';

// Lightweight CSS color utils for rgb/hex lighten/darken
// Resolve Tailwind bg-* class to computed CSS color (module-scope for reuse)
const twBgToColorCache: Map<string, string> = new Map();
const resolveTailwindBgToCssColor = (bgClass: string): string | undefined => {
  if (!bgClass || !bgClass.startsWith('bg-')) return undefined;
  if (twBgToColorCache.has(bgClass)) return twBgToColorCache.get(bgClass);
  try {
    const el = document.createElement('div');
    el.style.position = 'absolute';
    el.style.left = '-99999px';
    el.style.top = '-99999px';
    el.className = bgClass;
    document.body.appendChild(el);
    const color = window.getComputedStyle(el).backgroundColor || undefined;
    document.body.removeChild(el);
    if (color) twBgToColorCache.set(bgClass, color);
    return color;
  } catch {
    return undefined;
  }
};

const parseCssColorToRgb = (c: string): { r: number; g: number; b: number } | null => {
  if (!c) return null;
  const hexMatch = c.match(/^#([0-9a-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return { r, g, b };
  }
  const rgbMatch = c.replace(/\s+/g, '').match(/^rgb\((\d{1,3}),(\d{1,3}),(\d{1,3})\)$/i);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10);
    const g = parseInt(rgbMatch[2], 10);
    const b = parseInt(rgbMatch[3], 10);
    return { r, g, b };
  }
  return null;
};
const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const toRgbString = (r: number, g: number, b: number) => `rgb(${clamp255(r)}, ${clamp255(g)}, ${clamp255(b)})`;
const lightenCssColor = (c: string, amount: number): string => {
  const rgb = parseCssColorToRgb(c);
  if (!rgb) return c;
  const { r, g, b } = rgb;
  return toRgbString(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
};
const darkenCssColor = (c: string, amount: number): string => {
  const rgb = parseCssColorToRgb(c);
  if (!rgb) return c;
  const { r, g, b } = rgb;
  return toRgbString(r * (1 - amount), g * (1 - amount), b * (1 - amount));
};

export type MenuItemGridItem = MenuItem;

interface MenuItemGridProps {
  sensors: any;
  filteredMenuItems: MenuItemGridItem[];
  layoutSettings: any;
  itemColors: { [key: string]: string };
  selectedMenuItemId: string | null;
  multiSelectMode: boolean;
  toggleSelectMenuItem: (id: string) => void;
  handleMenuItemClick: (item: MenuItemGridItem) => void;
  handleMenuItemDragEnd: (event: any) => void;
  activeMenuId: string | null;
  setActiveMenuId: (id: string | null) => void;
  mergyActive: boolean;
  isMergedSelected: boolean;
  selectedCategory: string;
  MERGY_CATEGORY_ID: string;
  currentMergyGroupId: string | null;
  mergedGroups: Array<{ id: string; name: string; categoryNames: string[] }>;
  menuItems: MenuItemGridItem[];
  extraItems?: MenuItemGridItem[];
  openItemColor: (item: MenuItemGridItem) => void;
  // NEW: optional layout ids for current category (may contain 'EMPTY:*')
  layoutIdsForCategory?: string[];
  // NEW: reorder callback with indices in the current sanitized layout
  onMenuGridReorder?: (params: { oldIndex: number; newIndex: number; ids: string[]; category: string }) => void;
  // NEW: fetch layout ids for any given category (merged view)
  getLayoutIdsForCategory?: (categoryName: string) => string[] | undefined;
  // Sold Out props
  soldOutItems?: Set<string>;
  soldOutCategories?: Set<string>;
  soldOutTimes?: Map<string, { type: string; endTime: number; selector: string }>;
  lockLayout?: boolean;
  showEmptySlots?: boolean;
  /**
   * Empty slot behavior:
   * - 'none': do not render EMPTY slots at all
   * - 'configured': render only EMPTY slots that exist in saved layout (no auto padding)
   * - 'fill': render EMPTY slots and auto-pad up to capacity (legacy behavior)
   */
  emptySlotMode?: 'none' | 'configured' | 'fill';
  // NEW: Show all categories grouped (like modifier extra modal)
  showAllCategoriesGrouped?: boolean;
  allCategories?: Array<{ category_id: string; name: string }>;
}

const SortableMenuItem: React.FC<{
  item: MenuItemGridItem;
  layoutSettings: any;
  itemColors: {[k:string]: string};
  isSelected: boolean;
  multiSelectMode: boolean;
  onClick: () => void;
  onContext: () => void;
  buttonWidth: number;
  emphasize?: boolean;
  isSoldOut?: boolean;
  soldOutInfo?: { type: string; endTime: number; selector: string };
  lockLayout?: boolean;
}>
= ({ item, layoutSettings, itemColors, isSelected, multiSelectMode, onClick, onContext, buttonWidth, emphasize, isSoldOut = false, soldOutInfo, lockLayout }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: !!lockLayout });
  const style: React.CSSProperties = { 
    touchAction: lockLayout ? 'manipulation' : 'none',
    transform: transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined,
    transition: isDragging ? 'none' : transition,
    opacity: isDragging ? 0.85 : 1,
    zIndex: isDragging ? 999 : undefined,
    cursor: isDragging ? 'grabbing' : (lockLayout ? undefined : 'grab'),
    height: `${layoutSettings.menuItemHeight}px`,
    position: 'relative',
    backgroundImage: 'none',
    border: 'none',
    boxShadow: isDragging
      ? '0 8px 24px rgba(0,0,0,0.3)'
      : isSelected
        ? 'inset 3px 3px 6px rgba(0,0,0,0.2), inset -3px -3px 6px rgba(255,255,255,0.7)'
        : '4px 4px 8px rgba(0,0,0,0.15), -4px -4px 8px rgba(255,255,255,0.8)',
    borderBottom: 'none'
  };
  const bgClass = itemColors[item.id] || (item as any).color || layoutSettings.menuDefaultColor;
  const isHex = isHexColor(bgClass || layoutSettings.menuDefaultColor);
  const selectedBg = '#1E3A8A';
  const selectedIsHex = isHexColor(selectedBg);
  const textClass = emphasize && !isSelected
    ? 'text-white'
    : getContrastingTextColor(
        isSelected ? selectedBg : (bgClass || layoutSettings.menuDefaultColor)
      );
  // Compute lightened background for Sold Out state (brighter than selected background)
  const baseCssColor = isHex ? String(bgClass) : (resolveTailwindBgToCssColor(String(bgClass || '')) || undefined);
  const sourceForLighten = baseCssColor || selectedBg; // prefer base; fallback to selected
  const soldOutBg = lightenCssColor(sourceForLighten, 0.45); // ~45% lighter
  const finalBgColor = isSoldOut ? soldOutBg : (isHex ? bgClass : undefined);
  const className = `${
    !isHex ? (
      isSelected
        ? `${selectedIsHex ? '' : selectedBg}`
        : bgClass || layoutSettings.menuDefaultColor
    ) : ''
  } p-2 pr-0 rounded-xl ${textClass} border ${
    isSelected ? 'border-gray-300' : 'border-gray-200'
  } flex flex-col items-center justify-center w-full h-full ${
    isSoldOut ? 'cursor-not-allowed' : ''
  }`;
  return (
    <button
      ref={setNodeRef}
      style={{ 
        ...style,
        fontSize: `${layoutSettings.menuFontSize}px`,
        backgroundColor: isSelected ? (selectedIsHex ? selectedBg : undefined) : finalBgColor,
        backgroundImage: isSelected ? (style as any).backgroundImage : (emphasize && typeof style.backgroundImage === 'string' ? `linear-gradient(0deg, rgba(255,255,255,0.25), rgba(255,255,255,0.25)), ${style.backgroundImage}` : (style as any).backgroundImage),
        borderRadius: undefined,
        border: undefined,
      }}
      onClick={isDragging || isSoldOut ? undefined : onClick}
      disabled={isSoldOut}
      data-menu-button="true"
      onContextMenu={(e) => {
        e.preventDefault();
        onContext();
      }}
      className={className}
      title={`Color: ${bgClass}`}
      {...attributes}
      {...listeners}
    >
      {isSoldOut && (
        <div className="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-red-600 text-white text-[10px] leading-none shadow">
          Sold Out
        </div>
      )}
      <div className={`text_center break_words leading-tight ${layoutSettings.menuFontExtraBold ? 'font-black' : layoutSettings.menuFontBold ? 'font-bold' : 'font-normal'} ${isSoldOut ? 'line-through decoration-2' : ''}`} style={{ fontSize: `${layoutSettings.menuFontSize}px`, letterSpacing: '0.1px' }}>
        {layoutSettings.useShortName && (item as any).short_name ? (item as any).short_name : item.name}
      </div>
      <div className="sr-only">{layoutSettings.useShortName && (item as any).short_name ? (item as any).short_name : ''}</div>
      {layoutSettings.showPrices && (
        <div className="text-sm text_center" style={{ letterSpacing: '0.1px' }}>
          {String(item.id) === '__EXTRA3_ITEM__' && (item as any).percent != null ? (
            <span>{(item as any).percent}%</span>
          ) : (
            <span>${item.price}</span>
          )}
        </div>
      )}
    </button>
  );
};

const SortableEmptyCell: React.FC<{ id: string; height: number; lockLayout?: boolean; invisible?: boolean }> = ({ id, height, lockLayout, invisible }) => {
  const { setNodeRef } = useSortable({ id, disabled: !!lockLayout });
  return (
    <div
      ref={setNodeRef}
      className="w-full h-full"
      style={{ height: `${height}px` }}
      aria-hidden
    />
  );
};

const GRID_WIDTH_KEY = 'orderLayout:menuGridWidth';
const GRID_HEIGHT_KEY = 'orderLayout:menuGridHeight';

const readSavedNumber = (key: string): number | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const num = Number(raw);
    return Number.isFinite(num) ? num : null;
  } catch {
    return null;
  }
};

const MenuItemGrid: React.FC<MenuItemGridProps> = ({
  sensors,
  filteredMenuItems,
  layoutSettings,
  itemColors,
  selectedMenuItemId,
  multiSelectMode,
  toggleSelectMenuItem,
  handleMenuItemClick,
  handleMenuItemDragEnd,
  activeMenuId,
  setActiveMenuId,
  mergyActive,
  isMergedSelected,
  selectedCategory,
  MERGY_CATEGORY_ID,
  currentMergyGroupId,
  mergedGroups,
  menuItems,
  extraItems,
  openItemColor,
  layoutIdsForCategory,
  onMenuGridReorder,
  getLayoutIdsForCategory,
  soldOutItems = new Set(),
  soldOutCategories = new Set(),
  soldOutTimes = new Map(),
  lockLayout = false,
  showEmptySlots = true,
  emptySlotMode,
  showAllCategoriesGrouped = false,
  allCategories = []
}) => {
  const effectiveEmptyMode: 'none' | 'configured' | 'fill' =
    emptySlotMode || (showEmptySlots === false ? 'none' : 'fill');
  const shouldShowEmptySlots = effectiveEmptyMode !== 'none';
  const shouldAutoFillEmptySlots = effectiveEmptyMode === 'fill';
  const containerRef = useRef<HTMLDivElement>(null);
  const savedWidth = lockLayout ? readSavedNumber(GRID_WIDTH_KEY) : null;
  const savedHeight = lockLayout ? readSavedNumber(GRID_HEIGHT_KEY) : null;
  const [containerWidth, setContainerWidth] = useState<number>(savedWidth ?? 0);
  const [containerHeight, setContainerHeight] = useState<number>(savedHeight ?? 0);
  const [lockedWidth, setLockedWidth] = useState<number | null>(savedWidth);
  const [lockedHeight, setLockedHeight] = useState<number | null>(savedHeight);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = Math.max(0, Math.round(entry.contentRect.width));
        const height = Math.max(0, Math.round(entry.contentRect.height));
        setContainerWidth(prev => (prev === width ? prev : width));
        setContainerHeight(prev => (prev === height ? prev : height));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (lockLayout) {
      if (lockedWidth === null && containerWidth > 0) {
        const nextW = Math.max(0, Math.round(containerWidth));
        setLockedWidth(nextW);
        try { sessionStorage.setItem(GRID_WIDTH_KEY, String(nextW)); } catch {}
      }
      if (lockedHeight === null && containerHeight > 0) {
        const nextH = Math.max(0, Math.round(containerHeight));
        setLockedHeight(nextH);
        try { sessionStorage.setItem(GRID_HEIGHT_KEY, String(nextH)); } catch {}
      }
    } else {
      if (lockedWidth !== null) setLockedWidth(null);
      if (lockedHeight !== null) setLockedHeight(null);
      try {
        sessionStorage.removeItem(GRID_WIDTH_KEY);
        sessionStorage.removeItem(GRID_HEIGHT_KEY);
      } catch {}
    }
  }, [lockLayout, containerWidth, containerHeight, lockedWidth, lockedHeight]);

  const effectiveWidth = lockLayout && lockedWidth !== null ? lockedWidth : containerWidth;
  const effectiveHeight = lockLayout && lockedHeight !== null ? lockedHeight : containerHeight;

  const gapPx = 4;
  const paddingPx = 4;
  const maxCols = Math.max(1, Number(layoutSettings.menuGridColumns) || 1);
  const usableWidth = Math.max(0, effectiveWidth - paddingPx);
  const buttonWidth = Math.max(80, Math.floor((usableWidth - gapPx * (maxCols - 1)) / maxCols));
  const buttonHeight = Math.max(24, Number(layoutSettings.menuItemHeight) || 24);
  // Calculate rows based on container height
  const calculatedRows = Math.floor((effectiveHeight + gapPx) / (buttonHeight + gapPx)) || 1;
  const fixedRowsRaw = Number((layoutSettings as any).menuGridRows || 0);
  const fixedRows = Number.isFinite(fixedRowsRaw) ? Math.max(0, Math.floor(fixedRowsRaw)) : 0;
  const rows = fixedRows > 0 ? fixedRows : calculatedRows;
  // Build layout ids including configured EMPTY slots.
  const availableIds = filteredMenuItems.map(it => String(it.id));
  let baseIds: string[] = Array.isArray(layoutIdsForCategory) && layoutIdsForCategory.length > 0
    ? layoutIdsForCategory.slice(0)
    : availableIds.slice(0);
  // keep only known ids or EMPTY, then append any missing items, then pad EMPTY to capacity
  const kept: string[] = [];
  for (const id of baseIds) {
    if (id.startsWith('EMPTY:')) {
      if (shouldShowEmptySlots) kept.push(id);
    } else if (availableIds.includes(id)) {
      kept.push(id);
    }
  }
  for (const id of availableIds) {
    if (!kept.includes(id)) kept.push(id);
  }
  const capacity = (() => {
    if (!shouldShowEmptySlots) return Math.max(1, availableIds.length);
    if (!shouldAutoFillEmptySlots) return Math.max(1, kept.length);
    // fill-mode: never truncate configured EMPTY slots, and optionally pad to a fixed grid capacity
    const base = Math.max(1, availableIds.length, kept.length);
    const fixedCapacity = fixedRows > 0 ? (Math.max(1, rows) * Math.max(1, maxCols)) : 0;
    return fixedCapacity > 0 ? Math.max(base, fixedCapacity) : base;
  })();
  if (shouldAutoFillEmptySlots && shouldShowEmptySlots) {
    while (kept.length < capacity) kept.push(`EMPTY:${kept.length}`);
  }
  const layoutIds = shouldShowEmptySlots
    ? (shouldAutoFillEmptySlots ? kept.slice(0, capacity) : kept.slice(0, capacity))
    : kept.filter(id => !id.startsWith('EMPTY:'));
  // Map ids to items or EMPTY placeholders
  const allItems = layoutIds.map((id) => {
    if (String(id).startsWith('EMPTY:')) return { id } as unknown as MenuItemGridItem;
    const it = filteredMenuItems.find(mi => String(mi.id) === String(id));
    return (it || ({ id } as unknown as MenuItemGridItem));
  });
  const total = allItems.length;
  const target = Math.ceil(total / rows);
  let remaining = total;
  const rowCounts: number[] = Array.from({ length: rows }, (_, idx) => {
    if (idx === rows - 1) { const cnt = Math.max(0, remaining); remaining -= cnt; return cnt; }
    const take = Math.min(target, Math.max(0, remaining - (rows - 1 - idx))); remaining -= take; return take;
  }).filter(c => c > 0);


  // Pagination states for merged mode (no scroll)
  const [page, setPage] = useState<number>(0);
  const cols = maxCols;
  const rowsPerPage = rows; // item rows only

  // Build merged pages: keep headers but do not count them towards item-rows
  const mergedPages: Array<{ blocks: Array<{ kind: 'header'|'items'; text?: string; items?: MenuItemGridItem[] }> }> = useMemo(() => {
    if (!(mergyActive && isMergedSelected && currentMergyGroupId)) return [];
    const g = mergedGroups.find(x => x.id === currentMergyGroupId);
    if (!g) return [];
    const pages: Array<{ blocks: Array<{ kind: 'header'|'items'; text?: string; items?: MenuItemGridItem[] }> }> = [];
    let current: { blocks: Array<{ kind: 'header'|'items'; text?: string; items?: MenuItemGridItem[] }>; usedRows: number } = { blocks: [], usedRows: 0 };
    const pushPage = () => { pages.push({ blocks: current.blocks }); current = { blocks: [], usedRows: 0 }; };
    for (const catName of g.categoryNames) {
      const items = menuItems.filter(it => it.category === catName);
      if (items.length === 0) continue;
      // header (does not count rows)
      // if remaining rows are 0, start new page so header is visible with items
      if (current.usedRows >= rowsPerPage) { pushPage(); }
      current.blocks.push({ kind: 'header', text: catName });
      // chunk items by cols into rows
      let idx = 0;
      while (idx < items.length) {
        if (current.usedRows >= rowsPerPage) { pushPage(); current.blocks.push({ kind: 'header', text: catName }); }
        const slice = items.slice(idx, idx + cols);
        current.blocks.push({ kind: 'items', items: slice });
        current.usedRows += 1;
        idx += cols;
      }
    }
    if (current.blocks.length > 0) pages.push({ blocks: current.blocks });
    return pages;
  }, [mergyActive, isMergedSelected, currentMergyGroupId, mergedGroups, menuItems, rowsPerPage, cols]);

  useEffect(() => { setPage(0); }, [selectedCategory, currentMergyGroupId, rowsPerPage, cols]);

  // For merged mode: keep current drag context (ids and category)
  const mergedDragRef = useRef<{ ids: string[]; category: string } | null>(null);

  // Resolve Tailwind bg-* class to actual CSS color using a temporary element; cache results
  const twBgToColorCacheRef = useRef<Map<string, string>>(new Map());
  const resolveTailwindBgToCssColor = (bgClass: string): string | undefined => {
    if (!bgClass || !bgClass.startsWith('bg-')) return undefined;
    const cache = twBgToColorCacheRef.current;
    if (cache.has(bgClass)) return cache.get(bgClass);
    try {
      const el = document.createElement('div');
      el.style.position = 'absolute';
      el.style.left = '-99999px';
      el.style.top = '-99999px';
      el.className = bgClass;
      document.body.appendChild(el);
      const color = window.getComputedStyle(el).backgroundColor || undefined;
      document.body.removeChild(el);
      if (color) cache.set(bgClass, color);
      return color;
    } catch {
      return undefined;
    }
  };

  const buildIdsForCategory = (categoryName: string): string[] => {
    const available = menuItems.filter(it => it.category === categoryName).map(it => String(it.id));
    const saved = typeof getLayoutIdsForCategory === 'function' ? (getLayoutIdsForCategory(categoryName) || []) : [];
    // sanitize with category-unique EMPTY ids
    const kept: string[] = [];
    for (const id of saved) {
      if (id.startsWith('EMPTY:')) {
        if (shouldShowEmptySlots) {
          kept.push(`EMPTY:${categoryName}:${kept.length}`);
        }
      } else if (available.includes(id)) {
        kept.push(id);
      }
    }
    for (const id of available) { if (!kept.includes(id)) kept.push(id); }
    if (!shouldShowEmptySlots) return kept;
    if (!shouldAutoFillEmptySlots) return kept;
    // capacity heuristic: rows needed for items with (cols-1) per row
    const perRow = Math.max(1, cols - 1);
    const rowsNeeded = Math.max(1, Math.ceil(available.length / perRow));
    const capacityForCategory = rowsNeeded * perRow;
    while (kept.length < capacityForCategory) kept.push(`EMPTY:${categoryName}:${kept.length}`);
    return kept.slice(0, capacityForCategory);
  };

  // Row counts for normal mode using configured columns
  let cursor = 0;
  const normalRowCounts: number[] = useMemo(() => {
    if (mergyActive && isMergedSelected && currentMergyGroupId && mergedPages.length > 0) return [];
    const counts: number[] = [];
    let remaining = total;
    for (let r = 0; r < rows; r++) {
      if (remaining <= 0) break;
      const take = Math.min(maxCols, remaining);
      counts.push(take);
      remaining -= take;
    }
    // if list was padded to capacity elsewhere, counts may be shorter; pad visually to full rows if needed
    while (counts.length < rows && total >= rows * maxCols) counts.push(maxCols);
    return counts;
  }, [mergyActive, isMergedSelected, currentMergyGroupId, mergedPages.length, total, rows, maxCols]);

  return (
    <DndContext 
      sensors={sensors} 
      collisionDetection={closestCenter} 
      onDragStart={({active}) => {
        setActiveMenuId(String(active.id));
        if (mergyActive && isMergedSelected && currentMergyGroupId) {
          const actId = String(active.id);
          const it = menuItems.find(mi => String(mi.id) === actId);
          if (it && it.category) {
            const rawItems = menuItems.filter(mi => mi.category === it.category);
            const savedOrder: string[] | undefined = typeof getLayoutIdsForCategory === 'function' ? getLayoutIdsForCategory(it.category) : undefined;
            let orderedIds: string[];
            if (savedOrder && savedOrder.length > 0) {
              const ordered: string[] = [];
              for (const sid of savedOrder) {
                if (rawItems.some(mi => String(mi.id) === sid)) ordered.push(sid);
              }
              for (const mi of rawItems) {
                if (!ordered.includes(String(mi.id))) ordered.push(String(mi.id));
              }
              orderedIds = ordered;
            } else {
              orderedIds = rawItems.map(mi => String(mi.id));
            }
            mergedDragRef.current = { ids: orderedIds, category: it.category };
          } else {
            mergedDragRef.current = null;
          }
        } else {
          mergedDragRef.current = null;
        }
      }}
      onDragEnd={(e) => {
        const activeId = String(e?.active?.id || '');
        const overId = String(e?.over?.id || '');
        const isExtra = (id: string) => Array.isArray(extraItems) && extraItems.some(x => String(x.id) === id);
        if (isExtra(activeId) || isExtra(overId)) {
          handleMenuItemDragEnd(e);
          setActiveMenuId(null);
          return;
        }
        if (!overId || activeId === overId) { setActiveMenuId(null); return; }
        const ids = (mergyActive && isMergedSelected && currentMergyGroupId && mergedDragRef.current) ? mergedDragRef.current.ids : layoutIds;
        const categoryForReorder = (mergyActive && isMergedSelected && currentMergyGroupId && mergedDragRef.current) ? mergedDragRef.current.category : selectedCategory;
        const oldIndex = ids.indexOf(activeId);
        const newIndex = ids.indexOf(overId);
        if (oldIndex === -1 || newIndex === -1) { setActiveMenuId(null); return; }
        if (typeof onMenuGridReorder === 'function') {
          const next = ids.slice();
          const emptyToken = `EMPTY:${categoryForReorder}:${oldIndex}:${Date.now()}`;
          next[oldIndex] = emptyToken;
          const insertIdx = next.indexOf(overId);
          if (insertIdx !== -1) {
            next.splice(insertIdx, 0, activeId);
          }
          if (next.length > ids.length && next[next.length - 1].startsWith('EMPTY:') && next[next.length - 1] !== emptyToken) {
            next.pop();
          }
          onMenuGridReorder({ oldIndex, newIndex, ids: next, category: categoryForReorder });
        }
        setActiveMenuId(null);
      }}
    >
      <div ref={containerRef} className={`relative w-full h-full flex flex-col`}>
      {/* Scrollable Menu Items Area */}
      <div className="flex-1 overflow-auto pr-0 min-h-0">
      {mergyActive && isMergedSelected && currentMergyGroupId ? (
        <div className="space-y-2">
          <>
          {(() => {
            const g = mergedGroups.find(x => x.id === currentMergyGroupId);
            if (!g) return null;
            return g.categoryNames.map((catName, catIdx) => {
              const rawCatItems = menuItems.filter(mi => mi.category === catName);
              if (rawCatItems.length === 0) return null;
              // Apply saved order from menuItemOrderByCategory
              const savedOrder: string[] | undefined = (() => {
                const cat = (allCategories || []).find(c => c.name === catName);
                if (!cat) return undefined;
                return typeof getLayoutIdsForCategory === 'function' ? getLayoutIdsForCategory(catName) : undefined;
              })();
              let catItems = rawCatItems;
              if (savedOrder && savedOrder.length > 0) {
                const ordered: typeof rawCatItems = [];
                for (const id of savedOrder) {
                  const found = rawCatItems.find(mi => String(mi.id) === id);
                  if (found) ordered.push(found);
                }
                for (const mi of rawCatItems) {
                  if (!ordered.some(o => o.id === mi.id)) ordered.push(mi);
                }
                catItems = ordered;
              }
              const headerOffset = 0;
              const standardGapPx = 2;
              const extraSeparationPx = 4;
              const catIds = catItems.map(mi => String(mi.id));
              // Determine border color strictly from Category Tab's category button color (categoryNormalColor)
              let borderColorFinal: string | undefined;
              if (isHexColor(String(layoutSettings.categoryNormalColor || ''))) {
                borderColorFinal = String(layoutSettings.categoryNormalColor);
              } else {
                const cssCol = resolveTailwindBgToCssColor(String(layoutSettings.categoryNormalColor || ''));
                borderColorFinal = cssCol || undefined;
              }
              if (!borderColorFinal) borderColorFinal = '#4a002b';
              const borderLight = lightenCssColor(borderColorFinal, 0.35);
              const borderDark = darkenCssColor(borderColorFinal, 0.35);
              return (
                <div key={`catgrid-${catName}`} className="w-full" style={{ marginTop: catIdx === 0 ? `${headerOffset}px` : `${headerOffset + standardGapPx + extraSeparationPx}px` }}>
                  {/* Category Header - emphasized */}
                  <div className="text-base font-bold text-gray-700 mb-0.5 px-1.5 py-0.5 bg-gray-100" style={{ borderLeft: `6px solid ${borderColorFinal}` }}>{catName}</div>
                  {/* Items Grid - full width */}
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: `${layoutSettings.menuItemHeight}px`, gap: '0.25rem' }}>
                    <SortableContext items={catIds} strategy={rectSortingStrategy}>
                      {catItems.map((item) => (
                        <SortableMenuItem 
                          key={String(item.id)} 
                          item={item} 
                          layoutSettings={layoutSettings} 
                          itemColors={itemColors} 
                          isSelected={selectedMenuItemId === item.id} 
                          multiSelectMode={multiSelectMode} 
                          onClick={() => handleMenuItemClick(item)} 
                          onContext={() => multiSelectMode ? toggleSelectMenuItem(item.id) : openItemColor(item)} 
                          buttonWidth={buttonWidth} 
                          emphasize={(catIdx % 2) === 1} 
                          isSoldOut={soldOutItems.has(item.id) || (item.category_id ? soldOutCategories.has(String(item.category_id)) : false)} 
                          soldOutInfo={soldOutItems.has(item.id) ? soldOutTimes.get(item.id) : undefined} 
                          lockLayout={lockLayout} 
                        />
                      ))}
                    </SortableContext>
                  </div>
                </div>
              );
            });
          })()}
          </>
         </div>
      ) : showAllCategoriesGrouped && allCategories.length > 0 ? (
        /* All Categories Grouped View - like modifier extra modal */
        <div className="space-y-3 overflow-auto pb-20">
          {allCategories.map((cat) => {
            const catItems = menuItems.filter(it => it.category === cat.name || String(it.category_id) === String(cat.category_id));
            if (catItems.length === 0) return null;
            const catItemIds = catItems.map(it => String(it.id));
            return (
              <div key={cat.category_id} className="mb-2">
                {/* Category Header - like modifier group name */}
                <div className="text-sm font-semibold text-gray-600 mb-1.5 px-1 border-b border-gray-200 pb-1">
                  {cat.name}
                </div>
                {/* Items Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${maxCols}, minmax(0, 1fr))`, gap: '0.25rem' }}>
                  <SortableContext items={catItemIds} strategy={rectSortingStrategy}>
                    {catItems.map((item) => (
                      <SortableMenuItem 
                        key={item.id} 
                        item={item} 
                        layoutSettings={layoutSettings} 
                        itemColors={itemColors} 
                        isSelected={selectedMenuItemId === item.id} 
                        multiSelectMode={multiSelectMode} 
                        onClick={() => handleMenuItemClick(item)} 
                        onContext={() => multiSelectMode ? toggleSelectMenuItem(item.id) : openItemColor(item)} 
                        buttonWidth={buttonWidth} 
                        isSoldOut={soldOutItems.has(item.id) || (item.category_id ? soldOutCategories.has(String(item.category_id)) : false)} 
                        soldOutInfo={soldOutItems.has(item.id) ? soldOutTimes.get(item.id) : undefined} 
                        lockLayout={lockLayout} 
                      />
                    ))}
                  </SortableContext>
                </div>
              </div>
            );
          })}
         </div>
      ) : (
        <div className="h-full w-full" style={{ display: 'grid', gridTemplateColumns: `repeat(${maxCols}, minmax(0, 1fr))`, gridAutoRows: `${layoutSettings.menuItemHeight}px`, gap: '0.25rem' }}>
          <SortableContext items={layoutIds} strategy={rectSortingStrategy}>
            {allItems.map((item, itemIndex) => {
              // Calculate row-based color variation (2 rows original, 2 rows lighter, repeat)
              const rowIndex = Math.floor(itemIndex / maxCols);
              const emphasize = Math.floor(rowIndex / 2) % 2 === 1;
              return String(item.id).startsWith('EMPTY:') ? (
                <SortableEmptyCell key={item.id} id={String(item.id)} height={layoutSettings.menuItemHeight} invisible={effectiveEmptyMode === 'configured'} />
              ) : (
                <SortableMenuItem key={item.id} item={item} layoutSettings={layoutSettings} itemColors={itemColors} isSelected={selectedMenuItemId === item.id} multiSelectMode={multiSelectMode} onClick={() => handleMenuItemClick(item)} onContext={() => multiSelectMode ? toggleSelectMenuItem(item.id) : openItemColor(item)} buttonWidth={buttonWidth} emphasize={emphasize} isSoldOut={soldOutItems.has(item.id) || (item.category_id ? soldOutCategories.has(String(item.category_id)) : false)} soldOutInfo={soldOutItems.has(item.id) ? soldOutTimes.get(item.id) : undefined} lockLayout={lockLayout} />
              );
            })}
          </SortableContext>
        </div>
      )}
      </div>
      {/* Extra Buttons - floating overlay at bottom-right */}
      {Array.isArray(extraItems) && extraItems.length > 0 && (() => {
        const extraCount = Math.min(extraItems.length, 3);
        return (
          <div className="absolute bottom-2 right-2 z-20 flex justify-end" style={{ pointerEvents: 'none' }}>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${extraCount}, ${buttonWidth}px)`, gap: '0.25rem', pointerEvents: 'auto' }}>
              <SortableContext items={extraItems.slice(0, 3).map(i => i.id)} strategy={rectSortingStrategy}>
                {extraItems.slice(0, 3).map((item) => (
                  <SortableMenuItem key={item.id} item={item} layoutSettings={layoutSettings} itemColors={itemColors} isSelected={selectedMenuItemId === item.id} multiSelectMode={multiSelectMode} onClick={() => handleMenuItemClick(item)} onContext={() => multiSelectMode ? toggleSelectMenuItem(item.id) : openItemColor(item)} buttonWidth={buttonWidth} emphasize={true} isSoldOut={soldOutItems.has(item.id) || (item.category_id ? soldOutCategories.has(String(item.category_id)) : false)} soldOutInfo={soldOutItems.has(item.id) ? soldOutTimes.get(item.id) : undefined} lockLayout={lockLayout} />
                ))}
              </SortableContext>
            </div>
          </div>
        );
      })()}
      </div>
    </DndContext>
  );
};

export default MenuItemGrid; 