import React from 'react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { getContrastingTextColor, isHexColor } from '../../utils/colorUtils';

const tailwindBgToHex: Record<string, string> = {
  'bg-slate-300':'#cbd5e1','bg-slate-400':'#94a3b8','bg-slate-500':'#64748b','bg-slate-600':'#475569','bg-slate-700':'#334155',
  'bg-gray-200':'#e5e7eb','bg-gray-300':'#d1d5db','bg-gray-400':'#9ca3af','bg-gray-500':'#6b7280','bg-gray-600':'#4b5563','bg-gray-700':'#374151',
  'bg-zinc-500':'#71717a','bg-zinc-600':'#52525b','bg-neutral-500':'#737373','bg-neutral-600':'#525252','bg-stone-500':'#78716c','bg-stone-600':'#57534e',
  'bg-red-400':'#f87171','bg-red-500':'#ef4444','bg-red-600':'#dc2626','bg-red-700':'#b91c1c',
  'bg-orange-400':'#fb923c','bg-orange-500':'#f97316','bg-orange-600':'#ea580c','bg-orange-700':'#c2410c',
  'bg-amber-400':'#fbbf24','bg-amber-500':'#f59e0b','bg-amber-600':'#d97706','bg-amber-700':'#b45309',
  'bg-yellow-400':'#facc15','bg-yellow-500':'#eab308','bg-yellow-600':'#ca8a04','bg-yellow-700':'#a16207',
  'bg-lime-400':'#a3e635','bg-lime-500':'#84cc16','bg-lime-600':'#65a30d','bg-lime-700':'#4d7c0f',
  'bg-green-400':'#4ade80','bg-green-500':'#22c55e','bg-green-600':'#16a34a','bg-green-700':'#15803d',
  'bg-emerald-400':'#34d399','bg-emerald-500':'#10b981','bg-emerald-600':'#059669','bg-emerald-700':'#047857',
  'bg-teal-400':'#2dd4bf','bg-teal-500':'#14b8a6','bg-teal-600':'#0d9488','bg-teal-700':'#0f766e',
  'bg-cyan-400':'#22d3ee','bg-cyan-500':'#06b6d4','bg-cyan-600':'#0891b2','bg-cyan-700':'#0e7490',
  'bg-sky-400':'#38bdf8','bg-sky-500':'#0ea5e9','bg-sky-600':'#0284c7','bg-sky-700':'#0369a1',
  'bg-blue-400':'#60a5fa','bg-blue-500':'#3b82f6','bg-blue-600':'#2563eb','bg-blue-700':'#1d4ed8',
  'bg-indigo-400':'#818cf8','bg-indigo-500':'#6366f1','bg-indigo-600':'#4f46e5','bg-indigo-700':'#4338ca',
  'bg-violet-400':'#a78bfa','bg-violet-500':'#8b5cf6','bg-violet-600':'#7c3aed','bg-violet-700':'#6d28d9',
  'bg-purple-400':'#c084fc','bg-purple-500':'#a855f7','bg-purple-600':'#9333ea','bg-purple-700':'#7e22ce',
  'bg-fuchsia-400':'#e879f9','bg-fuchsia-500':'#d946ef','bg-fuchsia-600':'#c026d3','bg-fuchsia-700':'#a21caf',
  'bg-pink-400':'#f472b6','bg-pink-500':'#ec4899','bg-pink-600':'#db2777','bg-pink-700':'#be185d',
  'bg-rose-400':'#fb7185','bg-rose-500':'#f43f5e','bg-rose-600':'#e11d48','bg-rose-700':'#be123c',
  'bg-black':'#000000','bg-white':'#ffffff',
};

const resolveColorToHex = (colorClass: string): string | null => {
  if (isHexColor(colorClass)) return colorClass;
  return tailwindBgToHex[colorClass] || null;
};

interface ModifierEntry {
  id: string;
  label: string;
  groupId: string;
  selectionType?: string;
  price?: number;
}

interface ModifierPanelProps {
  sensors: any;
  slotItemIds: string[];
  entryMap: Map<string, ModifierEntry>;
  selectedModifiers: { [key: string]: string[] };
  layoutSettings: any;
  modifierColors: { [key: string]: string };
  isLoading: boolean;
  activeModifierId: string | null;
  setActiveModifierId: (id: string | null) => void;
  handleModifierSelection: (groupId: string, modifierId: string, selectionType: string) => void;
  handleModifierDragEnd: (event: any) => void;
  onModifierReorder?: (reorderedIds: string[]) => void;
  setSelectedModifierIdForColor?: (id: string) => void;
  onAddAdhocModifier?: (payload: { name: string; price: number }) => void;
  canAddAdhoc?: boolean;
  extraButton1?: { enabled: boolean; name: string; price: number; colorClass?: string };
  extraButton2?: { enabled: boolean; name: string; price: number; colorClass?: string };
  showEmptySlots?: boolean;
  emptySlotMode?: 'none' | 'configured' | 'fill';
  lockLayout?: boolean;
}

const SortableModifier: React.FC<{id: string; label: string; isSelected: boolean; groupId: string; selectionType?: string; price?: number; onSelect: (groupId: string, id: string, selectionType: string) => void; layoutSettings: any; modifierColors: {[k:string]: string}; itemHeightPx: number; setSelectedModifierIdForColor?: (id: string) => void; lockLayout?: boolean;}> = ({ id, label, isSelected, groupId, selectionType, price, onSelect, layoutSettings, modifierColors, itemHeightPx, setSelectedModifierIdForColor, lockLayout }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !!lockLayout });
  const style: React.CSSProperties = {
    touchAction: lockLayout ? 'manipulation' : 'none',
    transform: transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined,
    transition: isDragging ? 'none' : transition,
    opacity: isDragging ? 0.85 : 1,
    zIndex: isDragging ? 999 : undefined,
    cursor: isDragging ? 'grabbing' : (lockLayout ? undefined : 'grab'),
    height: `${itemHeightPx}px`,
    fontSize: `${layoutSettings.modifierFontSize}px`,
    backgroundImage: 'none',
    border: 'none',
    boxShadow: isDragging
      ? '0 8px 24px rgba(0,0,0,0.3)'
      : isSelected
        ? 'inset 3px 3px 6px rgba(0,0,0,0.2), inset -3px -3px 6px rgba(255,255,255,0.7)'
        : '4px 4px 8px rgba(0,0,0,0.15), -4px -4px 8px rgba(255,255,255,0.8)',
    borderBottom: 'none'
  };
  const bgClass = modifierColors[id] || layoutSettings.modifierDefaultColor;
  const selectedBg = '#1E3A8A';
  const resolvedBg = resolveColorToHex(bgClass) || bgClass;
  const resolvedBgIsHex = isHexColor(resolvedBg);
  (style as any).backgroundColor = isSelected
    ? selectedBg
    : (resolvedBgIsHex ? resolvedBg : undefined);
  const textClass = getContrastingTextColor(
    isSelected ? selectedBg : (resolvedBgIsHex ? resolvedBg : bgClass)
  );
  const className = `${
    !resolvedBgIsHex && !isSelected ? bgClass : ''
  } p-2 rounded-xl ${textClass} border ${
    isSelected ? 'border-gray-300' : 'border-gray-200'
  } flex items-center justify-center w-full h-full`;

  return (
    <button
      ref={setNodeRef}
      style={style}
      onClick={(e) => {
        if (isDragging) return;
        e.stopPropagation();
        onSelect(groupId, id, selectionType || 'SINGLE');
        if (setSelectedModifierIdForColor) setSelectedModifierIdForColor(id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (setSelectedModifierIdForColor) setSelectedModifierIdForColor(id);
      }}
      className={className}
      title={`Color: ${bgClass}`}
      {...attributes}
      {...listeners}
    >
      <div className={`${layoutSettings.modifierFontExtraBold ? 'font-black' : layoutSettings.modifierFontBold ? 'font-bold' : 'font-normal'} text-center break-words flex flex-col items-center justify-center`} style={{ fontSize: `${layoutSettings.modifierFontSize}px`, letterSpacing: '0.1px' }}>
        <span>{label}</span>
        {layoutSettings.modifierShowPrices && price !== undefined && price !== 0 && (
          <span style={{ fontSize: `${Math.max(10, layoutSettings.modifierFontSize - 2)}px` }} className="opacity-80">
            {price > 0 ? '+' : ''}${price.toFixed(2)}
          </span>
        )}
      </div>
    </button>
  );
};

const SortableEmptySlot: React.FC<{ id: string; layoutSettings: any; itemHeightPx: number; lockLayout?: boolean; invisible?: boolean }> = ({ id, layoutSettings, itemHeightPx, lockLayout, invisible }) => {
  const { setNodeRef } = useSortable({ id, disabled: !!lockLayout });
  return (
    <div
      ref={setNodeRef}
      className={invisible ? 'w-full h-full' : 'rounded-xl border border-dashed border-gray-300 w-full h-full'}
      style={{ height: `${itemHeightPx}px`, fontSize: `${layoutSettings.modifierFontSize}px` }}
    />
  );
};

const ModifierPanel: React.FC<ModifierPanelProps> = ({
  sensors,
  slotItemIds,
  entryMap,
  selectedModifiers,
  layoutSettings,
  modifierColors,
  isLoading,
  activeModifierId,
  setActiveModifierId,
  handleModifierSelection,
  handleModifierDragEnd,
  onModifierReorder,
  setSelectedModifierIdForColor,
  onAddAdhocModifier,
  canAddAdhoc,
  extraButton1,
  extraButton2,
  showEmptySlots = true,
  emptySlotMode,
  lockLayout = false
}) => {
  const effectiveEmptyMode: 'none' | 'configured' | 'fill' =
    emptySlotMode || (showEmptySlots === false ? 'none' : 'fill');
  const placeholdersEnabled = effectiveEmptyMode !== 'none';
  // 패널 높이 = 외부 padding(상하 16px) + 내부 padding(상하 8px) + (행수 * 버튼높이) + (행-1) * 행간격(4px)
  const rowCount = Math.max(1, Number(layoutSettings.modifierRows) || 1);
  const baseItemHeight = Math.max(24, Number(layoutSettings.modifierItemHeight) || 24);
  // Shrink each button height as rows increase (3 rows = 100%, 4 rows ≈ 75%, 5 rows ≈ 60%)
  const shrinkFactor = Math.min(1, 3 / rowCount);
  const itemHeight = Math.max(28, Math.floor(baseItemHeight * shrinkFactor));
  const gapPx = 4; // Tailwind gap-1
  const outerPadY = 2; // pt-0.5 (2px) + pb-0 (0px) = 2px
  const innerPadY = 3; // pt-px (1px) + pb-0.5 (2px) = 3px
  const computedPanelHeight = outerPadY + innerPadY + rowCount * itemHeight + (rowCount - 1) * gapPx;

  // UI states for extra buttons (hover/active) to mimic normal modifier interactions
  const [isExtra1Hover, setIsExtra1Hover] = React.useState(false);
  const [isExtra1Active, setIsExtra1Active] = React.useState(false);
  const [isExtra2Hover, setIsExtra2Hover] = React.useState(false);
  const [isExtra2Active, setIsExtra2Active] = React.useState(false);

  return (
    <div className="border-t border-gray-200 px-2 pt-0.5 pb-0 flex-shrink-0 overflow-y-auto" style={{ 
      height: `${computedPanelHeight}px`, 
      maxHeight: `${computedPanelHeight}px`, 
      backgroundColor: layoutSettings.modifierAreaBgColor || '#f3f4f6'
    }}>
      <div className="relative h-full">
        <div className={`space-y-1 transition-opacity duration-200 ${isLoading ? 'opacity-60' : 'opacity-100'}`}>
          <div className="px-1 pt-px pb-0.5">
            <DndContext 
              sensors={sensors} 
              collisionDetection={closestCenter} 
              onDragStart={({active}) => {
                setActiveModifierId(String(active.id));
              }}
              onDragEnd={(e) => {
                const activeId = String(e?.active?.id || '');
                const overId = e?.over ? String(e.over.id) : '';
                if (overId && activeId !== overId && onModifierReorder) {
                  const current = slotItemIds.map(String);
                  const oldIdx = current.indexOf(activeId);
                  const newIdx = current.indexOf(overId);
                  if (oldIdx !== -1 && newIdx !== -1) {
                    const next = current.slice();
                    const emptyToken = `EMPTY:mod:${oldIdx}:${Date.now()}`;
                    next[oldIdx] = emptyToken;
                    const insertIdx = next.indexOf(overId);
                    if (insertIdx !== -1) {
                      next.splice(insertIdx, 0, activeId);
                    }
                    if (next.length > current.length && next[next.length - 1].startsWith('EMPTY:') && next[next.length - 1] !== emptyToken) {
                      next.pop();
                    }
                    onModifierReorder(next);
                  } else {
                    handleModifierDragEnd(e);
                  }
                } else {
                  handleModifierDragEnd(e);
                }
                setActiveModifierId(null);
              }}
            >
              <SortableContext items={slotItemIds} strategy={rectSortingStrategy}>
                <div 
                  className="grid gap-1"
                  style={{ 
                    gridTemplateColumns: `repeat(${layoutSettings.modifierColumns}, minmax(0, 1fr))`,
                    gridTemplateRows: `repeat(${layoutSettings.modifierRows}, ${itemHeight}px)`
                  }}
                >
                  {(() => {
                    const cols = Math.max(1, Number(layoutSettings.modifierColumns) || 1);
                    const rows = Math.max(1, Number(layoutSettings.modifierRows) || 1);
                    const capacity = cols * rows;
                    let cells = slotItemIds.slice(0, capacity);
                    if (!placeholdersEnabled) {
                      cells = cells.filter(id => !String(id).startsWith('EMPTY:'));
                    }
                    if (placeholdersEnabled) {
                      const emptyIndexes: number[] = [];
                      for (let i = Math.min(cells.length, capacity) - 1; i >= 0; i--) {
                        const v = cells[i];
                        if (typeof v === 'string' && v.startsWith('EMPTY:')) {
                          emptyIndexes.push(i);
                          if (emptyIndexes.length >= 2) break;
                        }
                      }
                      if (extraButton2 && extraButton2.enabled && emptyIndexes.length > 0) {
                        const idx = emptyIndexes.shift() as number;
                        (cells as any)[idx] = '__MOD_EXTRA2__';
                      }
                      if (extraButton1 && extraButton1.enabled && emptyIndexes.length > 0) {
                        const idx = emptyIndexes.shift() as number;
                        (cells as any)[idx] = '__MOD_EXTRA1__';
                      }
                    } else {
                      const appendCell = (id: string) => {
                        if (cells.length < capacity) {
                          (cells as any).push(id);
                        }
                      };
                      if (extraButton2 && extraButton2.enabled) appendCell('__MOD_EXTRA2__');
                      if (extraButton1 && extraButton1.enabled) appendCell('__MOD_EXTRA1__');
                    }
                    return cells.map((slotId, idx) => {
                      if (slotId === '__MOD_EXTRA1__' && extraButton1) {
                        const disabled = !onAddAdhocModifier;
                        const bgClass = (extraButton1.colorClass||'bg-blue-600');
                        const isHex = isHexColor(bgClass);
                        const className = `${!isHex ? bgClass : ''} w-full h-full px-3 rounded-xl border text-white border-white/20 ${disabled ? 'opacity-60 cursor-not-allowed' : (isExtra1Active ? '' : 'hover:opacity-95')}`;
                        const style: React.CSSProperties = {
                          height: '100%',
                          fontSize: `${layoutSettings.modifierFontSize}px`,
                          fontWeight: layoutSettings.modifierFontExtraBold ? '900' : layoutSettings.modifierFontBold ? '700' : '400',
                          backgroundImage: isExtra1Active
                            ? 'linear-gradient(180deg, rgba(0,0,0,0.25), rgba(0,0,0,0.25))'
                            : 'linear-gradient(180deg, rgba(255,255,255,0.28), rgba(255,255,255,0.06)), linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.18))',
                          border: '1px solid rgba(255,255,255,0.18)',
                          boxShadow: isExtra1Active
                            ? 'inset 0 3px 10px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.15) inset'
                            : (isExtra1Hover ? '0 6px 14px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.35)' : '0 4px 10px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.3)'),
                          borderBottom: isExtra1Active ? '2px solid rgba(0,0,0,0.25)' : '2px solid rgba(0,0,0,0.2)',
                          backgroundColor: isHex ? bgClass : undefined
                        };
                        return (
                          <button
                            key={`extra1-${idx}`}
                            className={className}
                            style={style}
                            onMouseEnter={() => setIsExtra1Hover(true)}
                            onMouseLeave={() => { setIsExtra1Hover(false); setIsExtra1Active(false); }}
                            onMouseDown={() => setIsExtra1Active(true)}
                            onMouseUp={() => setIsExtra1Active(false)}
                            onClick={(e) => { e.stopPropagation(); if (disabled) return; onAddAdhocModifier!({ name: extraButton1.name || 'Extra 1', price: Number(extraButton1.price || 0) }); }}
                            title={extraButton1.name || 'Extra 1'}
                          >
                            <div style={{ fontSize: `${layoutSettings.modifierFontSize}px`, fontWeight: layoutSettings.modifierFontExtraBold ? '900' : layoutSettings.modifierFontBold ? '700' : '400', textAlign: 'center', wordBreak: 'break-word' }}>
                              {extraButton1.name || 'Extra 1'}
                            </div>
                          </button>
                        );
                      }
                      if (slotId === '__MOD_EXTRA2__' && extraButton2) {
                        const disabled = !onAddAdhocModifier;
                        const bgClass = (extraButton2.colorClass||'bg-teal-600');
                        const isHex = isHexColor(bgClass);
                        const className = `${!isHex ? bgClass : ''} w-full h-full px-3 rounded-xl border text-white border-white/20 ${disabled ? 'opacity-60 cursor-not-allowed' : (isExtra2Active ? '' : 'hover:opacity-95')}`;
                        const style: React.CSSProperties = {
                          height: '100%',
                          fontSize: `${layoutSettings.modifierFontSize}px`,
                          fontWeight: layoutSettings.modifierFontExtraBold ? '900' : layoutSettings.modifierFontBold ? '700' : '400',
                          backgroundImage: isExtra2Active
                            ? 'linear-gradient(180deg, rgba(0,0,0,0.25), rgba(0,0,0,0.25))'
                            : 'linear-gradient(180deg, rgba(255,255,255,0.28), rgba(255,255,255,0.06)), linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.18))',
                          border: '1px solid rgba(255,255,255,0.18)',
                          boxShadow: isExtra2Active
                            ? 'inset 0 3px 10px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.15) inset'
                            : (isExtra2Hover ? '0 6px 14px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.35)' : '0 4px 10px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.3)'),
                          borderBottom: isExtra2Active ? '2px solid rgba(0,0,0,0.25)' : '2px solid rgba(0,0,0,0.2)',
                          backgroundColor: isHex ? bgClass : undefined
                        };
                        return (
                          <button
                            key={`extra2-${idx}`}
                            className={className}
                            style={style}
                            onMouseEnter={() => setIsExtra2Hover(true)}
                            onMouseLeave={() => { setIsExtra2Hover(false); setIsExtra2Active(false); }}
                            onMouseDown={() => setIsExtra2Active(true)}
                            onMouseUp={() => setIsExtra2Active(false)}
                            onClick={(e) => { e.stopPropagation(); if (disabled) return; onAddAdhocModifier!({ name: extraButton2.name || 'Extra 2', price: Number(extraButton2.price || 0) }); }}
                            title={extraButton2.name || 'Extra 2'}
                          >
                            <div style={{ fontSize: `${layoutSettings.modifierFontSize}px`, fontWeight: layoutSettings.modifierFontExtraBold ? '900' : layoutSettings.modifierFontBold ? '700' : '400', textAlign: 'center', wordBreak: 'break-word' }}>
                              {extraButton2.name || 'Extra 2'}
                            </div>
                          </button>
                        );
                      }
                      if (typeof slotId === 'string' && slotId.startsWith('EMPTY:')) {
                        return placeholdersEnabled ? (
                          <SortableEmptySlot key={`empty-${idx}`} id={slotId} layoutSettings={layoutSettings} itemHeightPx={itemHeight} invisible={effectiveEmptyMode === 'configured'} />
                        ) : null;
                      }
                      const entry = entryMap.get(slotId);
                      if (!entry) {
                        return <SortableEmptySlot key={`missing-${idx}`} id={`EMPTY:${idx}`} layoutSettings={layoutSettings} itemHeightPx={itemHeight} />
                      }
                      const isSelected = selectedModifiers[entry.groupId]?.includes(slotId);
                      return (
                        <SortableModifier 
                          key={slotId}
                          id={slotId}
                          label={entry.label}
                          isSelected={!!isSelected}
                          groupId={entry.groupId}
                          selectionType={entry.selectionType}
                          price={entry.price}
                          onSelect={handleModifierSelection}
                          layoutSettings={layoutSettings}
                          modifierColors={modifierColors}
                          itemHeightPx={itemHeight}
                          setSelectedModifierIdForColor={setSelectedModifierIdForColor}
                          lockLayout={lockLayout}
                        />
                      );
                    });
                  })()}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        </div>
        {/* Extra buttons moved into grid (bottom-right) */}
      </div>
    </div>
  );
};

export default ModifierPanel;