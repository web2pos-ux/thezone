import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { getContrastingTextColor, isHexColor, getSelectedButtonColor } from '../../utils/colorUtils';
const PRESSED_PURPLE = '#4a002b';

interface CategoryBarProps {
  sensors: any;
  order: string[];
  categories: Array<{ category_id: number; name: string }>;
  mergedGroups: Array<{ id: string; name: string; categoryNames: string[] }>;
  layoutSettings: any;
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
  lockLayout?: boolean;
}

const SortableCategory: React.FC<{
  id: string;
  name: string;
  isActive: boolean;
  layoutSettings: any;
  onClick: () => void;
  lockLayout?: boolean;
}> = ({ id, name, isActive, layoutSettings, onClick, lockLayout }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !!lockLayout });
  const baseNormalBackground = isHexColor(layoutSettings.categoryNormalColor)
    ? layoutSettings.categoryNormalColor
    : undefined;

  const style: React.CSSProperties = { 
    touchAction: lockLayout ? 'manipulation' : 'none',
    transform: transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined,
    transition: isDragging ? 'none' : transition,
    opacity: isDragging ? 0.85 : 1,
    zIndex: isDragging ? 999 : undefined,
    position: 'relative' as const,
    cursor: isDragging ? 'grabbing' : (lockLayout ? undefined : 'grab'),
    boxShadow: isDragging
      ? '0 8px 24px rgba(0,0,0,0.3)'
      : isActive
        ? 'inset 3px 3px 6px rgba(0,0,0,0.2), inset -3px -3px 6px rgba(255,255,255,0.7)'
        : '4px 4px 8px rgba(0,0,0,0.15), -4px -4px 8px rgba(255,255,255,0.8)',
    height: `${layoutSettings.categoryHeight}px`,
    width: '100%',
    fontSize: `${layoutSettings.categoryFontSize}px`,
    backgroundColor: isActive
      ? PRESSED_PURPLE
      : baseNormalBackground
    , backgroundImage: 'none'
    , border: 'none'
    , borderBottom: 'none'
    , borderRadius: undefined
  };

  return (
    <button
      ref={setNodeRef}
      style={style}
      onClick={isDragging ? undefined : onClick}
      data-active-category={isActive ? 'true' : undefined}
      className={`${layoutSettings.categoryFontBold ? 'font-bold' : 'font-medium'} transition-colors duration-200 p-2 rounded-xl justify-self-start flex items-center justify-center text-center overflow-hidden break-words leading-tight ${
        isActive
          ? (!isHexColor(layoutSettings.categorySelectedColor) ? `${getSelectedButtonColor(layoutSettings.categorySelectedColor)} shadow-inner` : 'shadow-inner')
          : (!isHexColor(layoutSettings.categoryNormalColor) ? `${layoutSettings.categoryNormalColor} hover:bg-opacity-80` : 'hover:bg-opacity-80')
      } ${getContrastingTextColor(
        isActive ? PRESSED_PURPLE : layoutSettings.categoryNormalColor
      )}`}
      data-category-button="true"
      {...attributes}
      {...listeners}
    >
      <span className={`${layoutSettings.categoryFontBold ? 'font-bold' : 'font-medium'} text-center`} style={{ display: '-webkit-box', WebkitLineClamp: 3 as any, WebkitBoxOrient: 'vertical' as any, overflow: 'hidden', WebkitFontSmoothing: 'antialiased' as any, letterSpacing: '0.1px' }}>
        {name}
      </span>
    </button>
  );
};

const SortableMergedGroup: React.FC<{ 
  group: { id: string; name: string; categoryNames: string[] }; 
  isActive: boolean; 
  onClick: () => void; 
  layoutSettings: any;
  lockLayout?: boolean;
}> = ({ group, isActive, onClick, layoutSettings, lockLayout }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: group.id, disabled: !!lockLayout });
  const style: React.CSSProperties = { 
    touchAction: lockLayout ? 'manipulation' : 'none',
    transform: transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined,
    transition: isDragging ? 'none' : transition,
    opacity: isDragging ? 0.85 : 1,
    zIndex: isDragging ? 999 : undefined,
    position: 'relative' as const,
    cursor: isDragging ? 'grabbing' : (lockLayout ? undefined : 'grab'),
    boxShadow: isDragging
      ? '0 8px 24px rgba(0,0,0,0.3)'
      : isActive
        ? 'inset 3px 3px 6px rgba(0,0,0,0.2), inset -3px -3px 6px rgba(255,255,255,0.7)'
        : '4px 4px 8px rgba(0,0,0,0.15), -4px -4px 8px rgba(255,255,255,0.8)',
    height: `${layoutSettings.categoryHeight}px`,
    width: '100%',
    fontSize: `${layoutSettings.categoryFontSize}px`,
    backgroundColor: isActive
      ? PRESSED_PURPLE
      : (isHexColor(layoutSettings.categoryNormalColor) ? layoutSettings.categoryNormalColor : undefined)
    , backgroundImage: 'none'
    , border: 'none'
    , borderBottom: 'none'
  };
  return (
    <button
      ref={setNodeRef}
      style={style}
      onClick={isDragging ? undefined : onClick}
      className={`${layoutSettings.categoryFontBold ? 'font-bold' : 'font-medium'} transition-colors duration-200 p-2 rounded-xl justify-self-start flex items-center justify-center text-center overflow-hidden break-words leading-tight ${
        isActive
          ? (!isHexColor(layoutSettings.categorySelectedColor) ? `${getSelectedButtonColor(layoutSettings.categorySelectedColor)} shadow-inner` : 'shadow-inner')
          : (!isHexColor(layoutSettings.categoryNormalColor) ? `${layoutSettings.categoryNormalColor} hover:bg-opacity-80` : 'hover:bg-opacity-80')
      } ${getContrastingTextColor(
        isActive ? PRESSED_PURPLE : layoutSettings.categoryNormalColor
      )}`}
      title={`${group.name}: ${group.categoryNames.join(', ')}`}
      {...attributes}
      {...listeners}
    >
      <span className={`${layoutSettings.categoryFontBold ? 'font-bold' : 'font-medium'} text-center`} style={{ display: '-webkit-box', WebkitLineClamp: 3 as any, WebkitBoxOrient: 'vertical' as any, overflow: 'hidden', WebkitFontSmoothing: 'antialiased' as any, letterSpacing: '0.1px' }}>
        {group.name}
      </span>
    </button>
  );
};

const CATEGORY_BAR_WIDTH_KEY = 'orderLayout:categoryBarWidth';

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

const CategoryBar: React.FC<CategoryBarProps> = ({
  sensors,
  order,
  categories,
  mergedGroups,
  layoutSettings,
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
  lockLayout = false
}) => {
  const groupMap = new Map(mergedGroups.map(g => [g.id, g] as const));
  const catMap = new Map(categories.map(c => [c.category_id.toString(), c] as const));
  const containerRef = useRef<HTMLDivElement>(null);
  // Lock width per detected/saved screen resolution so switching between 1024x768 ↔ 1920x1080
  // doesn't reuse an old width value and distort category button sizing.
  const widthKey = `${CATEGORY_BAR_WIDTH_KEY}:${String((layoutSettings as any)?.screenResolution || 'unknown')}`;
  const savedWidth = lockLayout ? readSavedNumber(widthKey) : null;
  const [containerWidth, setContainerWidth] = useState<number>(savedWidth ?? 0);
  const [lockedWidth, setLockedWidth] = useState<number | null>(savedWidth);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cw = Math.max(0, Math.round(entry.contentRect.width));
        setContainerWidth(prev => (prev === cw ? prev : cw));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (lockLayout) {
      if (lockedWidth === null && containerWidth > 0) {
        const next = Math.max(0, Math.round(containerWidth));
        setLockedWidth(next);
        try { sessionStorage.setItem(widthKey, String(next)); } catch {}
      }
    } else {
      if (lockedWidth !== null) {
        setLockedWidth(null);
      }
      try { sessionStorage.removeItem(widthKey); } catch {}
    }
  }, [lockLayout, containerWidth, lockedWidth, widthKey]);

  const effectiveWidth = lockLayout && lockedWidth !== null ? lockedWidth : containerWidth;

  // Build render list in order, skipping missing items and 'Open Price'
  const renderList = useMemo(() => {
    const list: Array<{ kind: 'group'|'cat'; id: string }> = [];
    order.forEach(id => {
      if (id.startsWith('mergy_')) {
        const g = groupMap.get(id);
        if (g) list.push({ kind: 'group', id: g.id });
      } else {
        const c = catMap.get(id);
        if (c && c.name !== 'Open Price') list.push({ kind: 'cat', id: String(c.category_id) });
      }
    });
    return list;
  }, [order, groupMap, catMap]);

  const rows = Math.max(1, Number(layoutSettings.categoryRows) || 1);
  const total = renderList.length;
  const configuredCols = Math.max(1, Number(layoutSettings.categoryColumns) || 1);

  const effectiveCols = Math.max(1, configuredCols);

  let remaining = total;
  const rowCounts: number[] = [];
  for (let idx = 0; idx < rows; idx += 1) {
    if (remaining <= 0) break;
    const take = Math.min(effectiveCols, remaining);
    rowCounts.push(take);
    remaining -= take;
  }
  let cursor = 0;

  return (
    <div ref={containerRef} className="pl-2 pr-0 pt-2 pb-2 space-y-1">
      <DndContext 
        sensors={sensors} 
        collisionDetection={closestCenter} 
        onDragStart={({active}) => {
          setActiveCategoryId(String(active.id));
        }}
        onDragEnd={(e) => { handleCategoryDragEnd(e); setActiveCategoryId(null); }}
      >
        <SortableContext
          items={order}
          strategy={rectSortingStrategy}
        >
          {rowCounts.map((cnt, rowIdx) => {
            const slice = renderList.slice(cursor, cursor + cnt);
            cursor += cnt;
            return (
              <div
                key={`row-${rowIdx}`}
                className="grid gap-1"
                style={{ gridTemplateColumns: `repeat(${effectiveCols}, minmax(0, 1fr))` }}
              >
                {slice.map((it) => {
                  if (it.kind === 'group') {
                    const g = groupMap.get(it.id);
                    if (!g) return null;
                    return (
                      <SortableMergedGroup
                        key={`g-${g.id}`}
                        group={g}
                        isActive={mergyActive && currentMergyGroupId === g.id && selectedCategory === MERGY_CATEGORY_ID}
                        onClick={() => { setCurrentMergyGroupId(g.id); setMergyActive(true); setSelectedCategory(MERGY_CATEGORY_ID); }}
                        layoutSettings={layoutSettings}
                        lockLayout={lockLayout}
                      />
                    );
                  } else {
                    const c = catMap.get(it.id);
                    if (!c) return null;
                    return (
                      <SortableCategory
                        key={`c-${c.category_id}`}
                        id={String(c.category_id)}
                        name={c.name}
                        isActive={selectedCategory === c.name}
                        layoutSettings={layoutSettings}
                        onClick={() => setSelectedCategory(c.name)}
                        lockLayout={lockLayout}
                      />
                    );
                  }
                })}
                {cnt < effectiveCols &&
                  Array.from({ length: effectiveCols - cnt }).map((_, idx) => (
                    <div key={`spacer-${rowIdx}-${idx}`} aria-hidden="true" style={{ visibility: 'hidden' }}>
                      spacer
                    </div>
                  ))}
              </div>
            );
          })}
         </SortableContext>
      </DndContext>
    </div>
  );
};

export default CategoryBar; 