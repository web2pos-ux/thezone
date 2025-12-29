import React from 'react';
import { DndContext, closestCenter, DragOverlay, defaultDropAnimationSideEffects } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getContrastingTextColor, isHexColor, getSelectedButtonColor } from '../../utils/colorUtils';

interface ModifierEntry {
  id: string;
  label: string;
  groupId: string;
  selectionType?: string;
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
  setSelectedModifierIdForColor?: (id: string) => void;
  onAddAdhocModifier?: (payload: { name: string; price: number }) => void;
  canAddAdhoc?: boolean;
  extraButton1?: { enabled: boolean; name: string; price: number; colorClass?: string };
  extraButton2?: { enabled: boolean; name: string; price: number; colorClass?: string };
  showEmptySlots?: boolean;
  lockLayout?: boolean;
}

const SortableModifier: React.FC<{id: string; label: string; isSelected: boolean; groupId: string; selectionType?: string; onSelect: (groupId: string, id: string, selectionType: string) => void; layoutSettings: any; modifierColors: {[k:string]: string}; setSelectedModifierIdForColor?: (id: string) => void; lockLayout?: boolean;}> = ({ id, label, isSelected, groupId, selectionType, onSelect, layoutSettings, modifierColors, setSelectedModifierIdForColor, lockLayout }) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({ id, disabled: lockLayout });
  const [isHover, setIsHover] = React.useState(false);
  const baseTransform = CSS.Transform.toString(transform);
  const style: React.CSSProperties = {
    transform: isSelected
      ? `${baseTransform} translateY(1px)`
      : (isHover ? `${baseTransform} translateY(-1px)` : baseTransform),
    transition: isDragging ? undefined : 'transform 250ms cubic-bezier(0.22, 1, 0.36, 1)',
    willChange: 'transform',
    opacity: isDragging ? 0.85 : 1,
    touchAction: 'none',
    height: `${layoutSettings.modifierItemHeight}px`,
    fontSize: `${layoutSettings.modifierFontSize}px`,
    backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.28), rgba(255,255,255,0.06)), linear-gradient(180deg, rgba(255,255,255,0.08), rgba(0,0,0,0.18))',
    border: '1px solid rgba(255,255,255,0.18)',
    boxShadow: isSelected
      ? 'inset 0 3px 10px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.15) inset'
      : (isHover ? '0 6px 14px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.35)' : '0 4px 10px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.3)'),
    borderBottom: isSelected ? '2px solid rgba(0,0,0,0.25)' : '2px solid rgba(0,0,0,0.2)'
  };
  const bgClass = modifierColors[id] || layoutSettings.modifierDefaultColor;
  const isHex = isHexColor(bgClass || layoutSettings.modifierDefaultColor);
  const selectedBg = '#1E3A8A';
  const selectedIsHex = isHexColor(selectedBg);
  // Apply background color same as menu selected color when selected
  (style as any).backgroundColor = isSelected
    ? (selectedIsHex ? selectedBg : undefined)
    : (isHex ? bgClass : undefined);
  const textClass = getContrastingTextColor(
    isSelected ? selectedBg : (bgClass || layoutSettings.modifierDefaultColor)
  );
  const className = `${
    !isHex ? (
      isSelected
        ? `${selectedIsHex ? '' : ''}`
        : (bgClass || layoutSettings.modifierDefaultColor)
    ) : ''
  } p-2 rounded-xl ${textClass} border ${
    isSelected ? 'border-gray-300' : 'border-gray-200'
  } flex items-center justify-center w-full h-full`;

  return (
    <button
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(groupId, id, selectionType || 'SINGLE');
        if (setSelectedModifierIdForColor) setSelectedModifierIdForColor(id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (setSelectedModifierIdForColor) setSelectedModifierIdForColor(id);
      }}
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
      className={className}
      title={`Color: ${bgClass}`}
    >
      <div className={`${layoutSettings.modifierFontBold ? 'font-bold' : 'font-normal'} text-center break-words`} style={{ fontSize: `${layoutSettings.modifierFontSize}px`, letterSpacing: '0.1px' }}>
        {label}
      </div>
    </button>
  );
};

const SortableEmptySlot: React.FC<{ id: string; layoutSettings: any }> = ({ id, layoutSettings }) => {
  const { setNodeRef } = useSortable({ id, disabled: true });
  return (
    <div
      ref={setNodeRef}
      className="rounded-xl border border-dashed border-gray-300 w-full h-full"
      style={{ fontSize: `${layoutSettings.modifierFontSize}px` }}
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
  setSelectedModifierIdForColor,
  onAddAdhocModifier,
  canAddAdhoc,
  extraButton1,
  extraButton2,
  showEmptySlots = true,
  lockLayout = false
}) => {
  const placeholdersEnabled = showEmptySlots !== false;
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
              onDragStart={({active}) => setActiveModifierId(String(active.id))}
              onDragEnd={(e) => { handleModifierDragEnd(e); setActiveModifierId(null); }}
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
                          fontWeight: layoutSettings.modifierFontBold ? '600' : '400',
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
                            <div style={{ fontSize: `${layoutSettings.modifierFontSize}px`, fontWeight: layoutSettings.modifierFontBold ? '600' : '400', textAlign: 'center', wordBreak: 'break-word' }}>
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
                          fontWeight: layoutSettings.modifierFontBold ? '600' : '400',
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
                            <div style={{ fontSize: `${layoutSettings.modifierFontSize}px`, fontWeight: layoutSettings.modifierFontBold ? '600' : '400', textAlign: 'center', wordBreak: 'break-word' }}>
                              {extraButton2.name || 'Extra 2'}
                            </div>
                          </button>
                        );
                      }
                      if (typeof slotId === 'string' && slotId.startsWith('EMPTY:')) {
                        return placeholdersEnabled ? (
                          <SortableEmptySlot key={`empty-${idx}`} id={slotId} layoutSettings={layoutSettings} />
                        ) : null;
                      }
                      const entry = entryMap.get(slotId);
                      if (!entry) {
                        return <SortableEmptySlot key={`missing-${idx}`} id={`EMPTY:${idx}`} layoutSettings={layoutSettings} />
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
                          onSelect={handleModifierSelection}
                          layoutSettings={layoutSettings}
                          modifierColors={modifierColors}
                          setSelectedModifierIdForColor={setSelectedModifierIdForColor}
                          lockLayout={lockLayout}
                        />
                      );
                    });
                  })()}
                </div>
              </SortableContext>
              <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.5' } } }) }}>
                {activeModifierId ? (() => {
                  const entry = entryMap.get(activeModifierId);
                  if (!entry) return null;
                  return (
                    <div className={`rounded-xl shadow border border-gray-200 flex items-center justify-center ${getContrastingTextColor(layoutSettings.modifierDefaultColor)}`}
                         style={{ height: `${layoutSettings.modifierItemHeight}px`, backgroundColor: isHexColor(layoutSettings.modifierDefaultColor) ? layoutSettings.modifierDefaultColor : undefined, fontSize: `${layoutSettings.modifierFontSize}px` }}>
                      <div className={`${layoutSettings.modifierFontBold ? 'font-bold' : 'font-normal'} text-center break-words`}>
                        {entry.label}
                      </div>
                    </div>
                  );
                })() : null}
              </DragOverlay>
            </DndContext>
          </div>
        </div>
        {/* Extra buttons moved into grid (bottom-right) */}
      </div>
    </div>
  );
};

export default ModifierPanel;