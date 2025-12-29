import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, closestCenter, DragOverlay, defaultDropAnimationSideEffects } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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
  buttonWidth: number;
  lockLayout?: boolean;
}> = ({ id, name, isActive, layoutSettings, onClick, buttonWidth, lockLayout }) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({ id, disabled: lockLayout });
  const [isHover, setIsHover] = useState(false);
  const baseTransform = CSS.Transform.toString(transform);
  const baseNormalBackground = isHexColor(layoutSettings.categoryNormalColor)
    ? layoutSettings.categoryNormalColor
    : undefined;

  const style: React.CSSProperties = { 
    transform: isActive
      ? `${baseTransform} translateY(1px)`
      : (isHover ? `${baseTransform} translateY(-1px)` : baseTransform), 
    transition: isDragging ? undefined : 'transform 250ms cubic-bezier(0.22, 1, 0.36, 1)',
    willChange: 'transform',
    opacity: isDragging ? 0.85 : 1,
    height: `${layoutSettings.categoryHeight}px`,
    width: `${buttonWidth}px`,
    fontSize: `${layoutSettings.categoryFontSize}px`,
    backgroundColor: isActive
      ? PRESSED_PURPLE
      : baseNormalBackground
    , backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.28), rgba(255,255,255,0.06)), linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.18))'
    , border: '1px solid rgba(255,255,255,0.18)'
    , boxShadow: isActive
      ? 'inset 0 3px 10px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.15) inset'
      : (isHover ? '0 6px 14px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.35)' : '0 4px 10px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.3)')
    , borderBottom: isActive ? '2px solid rgba(0,0,0,0.25)' : '2px solid rgba(0,0,0,0.2)'
    , borderRadius: undefined
  };

  return (
    <button
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
      data-active-category={isActive ? 'true' : undefined}
      className={`${layoutSettings.categoryFontBold ? 'font-bold' : 'font-medium'} transition-all duration-200 p-2 rounded-xl justify-self-start flex items-center justify-center text-center overflow-hidden break-words leading-tight ${
        isActive
          ? (!isHexColor(layoutSettings.categorySelectedColor) ? `${getSelectedButtonColor(layoutSettings.categorySelectedColor)} transform scale-95 shadow-inner` : 'transform scale-95 shadow-inner')
          : (!isHexColor(layoutSettings.categoryNormalColor) ? `${layoutSettings.categoryNormalColor} hover:bg-opacity-80` : 'hover:bg-opacity-80')
      } ${getContrastingTextColor(
        isActive ? PRESSED_PURPLE : layoutSettings.categoryNormalColor
      )}`}
      data-category-button="true"
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
  buttonWidth: number;
  lockLayout?: boolean;
}> = ({ group, isActive, onClick, layoutSettings, buttonWidth, lockLayout }) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({ id: group.id, disabled: lockLayout });
  const [isHover, setIsHover] = useState(false);
  const baseTransform = CSS.Transform.toString(transform);
  const style: React.CSSProperties = { 
    transform: isActive
      ? `${baseTransform} translateY(1px)`
      : (isHover ? `${baseTransform} translateY(-1px)` : baseTransform), 
    transition: isDragging ? undefined : 'transform 250ms cubic-bezier(0.22, 1, 0.36, 1)',
    willChange: 'transform',
    opacity: isDragging ? 0.85 : 1,
    height: `${layoutSettings.categoryHeight}px`,
    width: `${buttonWidth}px`,
    fontSize: `${layoutSettings.categoryFontSize}px`,
    backgroundColor: isActive
      ? PRESSED_PURPLE
      : (isHexColor(layoutSettings.categoryNormalColor) ? layoutSettings.categoryNormalColor : undefined)
    , backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.28), rgba(255,255,255,0.06)), linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.18))'
    , border: '1px solid rgba(255,255,255,0.18)'
    , boxShadow: isActive
      ? 'inset 0 3px 10px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.15) inset'
      : (isHover ? '0 6px 14px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.35)' : '0 4px 10px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.3)')
    , borderBottom: isActive ? '2px solid rgba(0,0,0,0.25)' : '2px solid rgba(0,0,0,0.2)'
  };
  return (
    <button
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
      className={`${layoutSettings.categoryFontBold ? 'font-bold' : 'font-medium'} transition-all duration-200 p-2 rounded-xl justify-self-start flex items-center justify-center text-center overflow-hidden break-words leading-tight ${
        isActive
          ? (!isHexColor(layoutSettings.categorySelectedColor) ? `${getSelectedButtonColor(layoutSettings.categorySelectedColor)} transform scale-95 shadow-inner` : 'transform scale-95 shadow-inner')
          : (!isHexColor(layoutSettings.categoryNormalColor) ? `${layoutSettings.categoryNormalColor} hover:bg-opacity-80` : 'hover:bg-opacity-80')
      } ${getContrastingTextColor(
        isActive ? PRESSED_PURPLE : layoutSettings.categoryNormalColor
      )}`}
      title={`${group.name}: ${group.categoryNames.join(', ')}`}
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
  const savedWidth = lockLayout ? readSavedNumber(CATEGORY_BAR_WIDTH_KEY) : null;
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
        try { sessionStorage.setItem(CATEGORY_BAR_WIDTH_KEY, String(next)); } catch {}
      }
    } else {
      if (lockedWidth !== null) {
        setLockedWidth(null);
      }
      try { sessionStorage.removeItem(CATEGORY_BAR_WIDTH_KEY); } catch {}
    }
  }, [lockLayout, containerWidth, lockedWidth]);

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
  const cols = Math.max(1, Number(layoutSettings.categoryColumns) || 1);
  let remaining = total;
  const rowCounts: number[] = [];
  for (let idx = 0; idx < rows; idx++) {
    if (remaining <= 0) break;
    const take = Math.min(cols, remaining);
    rowCounts.push(take);
    remaining -= take;
  }
  const gapPx = 4; // gap-1
  const paddingPx = 8; // pl-2 (8px) + pr-0 (0px)
  const usableWidth = Math.max(0, effectiveWidth - paddingPx);
  const buttonWidth = Math.max(64, Math.floor((usableWidth - gapPx * (cols - 1)) / cols));

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
              <div key={`row-${rowIdx}`} className="flex justify-start gap-1">
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
                        buttonWidth={buttonWidth}
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
                        buttonWidth={buttonWidth}
                        lockLayout={lockLayout}
                      />
                    );
                  }
                })}
              </div>
            );
          })}
         </SortableContext>
        <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.5' } } }) }}>
          {activeCategoryId ? (() => {
            if (activeCategoryId.startsWith('mergy_')) {
              const group = mergedGroups.find(g => g.id === activeCategoryId);
              if (!group) return null;
              return (
                <div className="p-2 rounded-xl bg-blue-500 text-white"
                     style={{ height: `${layoutSettings.categoryHeight}px`, width: `${buttonWidth}px`, fontSize: `${layoutSettings.categoryFontSize}px`, backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.28), rgba(255,255,255,0.06)), linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.18))', border: '1px solid rgba(255,255,255,0.18)', boxShadow: '0 4px 10px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.3)', borderBottom: '2px solid rgba(0,0,0,0.2)' }}>
                  <span className={`${layoutSettings.categoryFontBold ? 'font-bold' : 'font-medium'} text-center`} style={{ display: '-webkit-box', WebkitLineClamp: 3 as any, WebkitBoxOrient: 'vertical' as any, overflow: 'hidden', WebkitFontSmoothing: 'antialiased' as any, letterSpacing: '0.1px' }}>{group.name}</span>
                </div>
              );
            }
            const cat = categories.find(c => String(c.category_id) === activeCategoryId);
            if (!cat) return null;
            const isActive = selectedCategory === cat.name;
            return (
              <div className={`p-2 rounded-xl ${getContrastingTextColor(isActive ? PRESSED_PURPLE : layoutSettings.categoryNormalColor)}`}
                   style={{ height: `${layoutSettings.categoryHeight}px`, width: `${buttonWidth}px`, fontSize: `${layoutSettings.categoryFontSize}px`, backgroundColor: isActive ? PRESSED_PURPLE : (isHexColor(layoutSettings.categoryNormalColor) ? layoutSettings.categoryNormalColor : undefined), backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.28), rgba(255,255,255,0.06)), linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.18))', border: '1px solid rgba(255,255,255,0.18)', boxShadow: (isActive ? 'inset 0 3px 10px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.15) inset' : '0 4px 10px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.3)'), borderBottom: (isActive ? '2px solid rgba(0,0,0,0.25)' : '2px solid rgba(0,0,0,0.2)') }}>
                <span className={`${layoutSettings.categoryFontBold ? 'font-bold' : 'font-medium'} text-center`} style={{ display: '-webkit-box', WebkitLineClamp: 3 as any, WebkitBoxOrient: 'vertical' as any, overflow: 'hidden', WebkitFontSmoothing: 'antialiased' as any, letterSpacing: '0.1px' }}>{cat.name}</span>
              </div>
            );
          })() : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
};

export default CategoryBar; 