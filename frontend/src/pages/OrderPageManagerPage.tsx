import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { DndContext, closestCenter, DragEndEvent, DragStartEvent, DragOverEvent, PointerSensor, TouchSensor, MouseSensor, useSensor, useSensors, useDroppable } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useLayoutSettings } from '../hooks/useLayoutSettings';
import { API_URL } from '../config/constants';
import { getModifierLayoutForCategory } from '../utils/modifierLayoutTemplate';
import { reorderModifierSlotIds } from '../utils/modifierSlotReorder';
import { fetchComposedModifierEntries } from '../utils/composedModifierEntries';

interface Category { category_id: number; name: string; }
interface MenuItem { id: string; name: string; price: number; category_id?: number; }
interface ModifierEntry { id: string; label: string; groupId: string; price?: number; }
interface MergedGroup { id: string; name: string; categoryNames: string[] }
type SortableRow =
  | { kind: 'item'; id: string; name: string; metaRight?: string }
  | { kind: 'modifier'; id: string; name: string; metaRight?: string }
  | { kind: 'blank'; id: string };

// 세로 목록용 SortableItem (Categories, Modifiers 패널)
const SortableItem: React.FC<{ id: string; children: React.ReactNode }> = ({ id, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1, touchAction: 'none' }}
      className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg shadow-sm cursor-grab active:cursor-grabbing select-none"
      {...attributes}
      {...listeners}
    >
      <span className="text-gray-400 text-sm">☰</span>
      {children}
    </div>
  );
};

// 그리드용 SortableGridCell (Items 패널)
const SortableGridCell: React.FC<{
  id: string;
  row: SortableRow;
  isSelected: boolean;
  isOver: boolean;
  isDragActive: boolean;
  onSelect: () => void;
  onRemoveBlank: () => void;
}> = ({ id, row, isSelected, isOver, isDragActive, onSelect, onRemoveBlank }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const baseStyle = `
    relative flex flex-col items-center justify-center
    rounded-lg border-2 select-none cursor-grab active:cursor-grabbing
    transition-all duration-150
    text-center px-1
  `;

  let cellClass = '';
  if (isDragging) {
    cellClass = 'border-blue-400 bg-blue-50 opacity-40 scale-95';
  } else if (isOver && isDragActive) {
    cellClass = 'border-green-400 bg-green-50 shadow-lg scale-105 ring-2 ring-green-400';
  } else if (row.kind === 'blank') {
    cellClass = 'border-dashed border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100';
  } else if (isSelected) {
    cellClass = 'border-blue-500 bg-blue-50 shadow-md';
  } else {
    cellClass = 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50 hover:shadow-sm';
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, touchAction: 'none', minHeight: 64 }}
      className={`${baseStyle} ${cellClass}`}
      {...attributes}
      {...listeners}
      onClick={row.kind !== 'blank' ? onSelect : undefined}
    >
      {row.kind === 'blank' ? (
        <div className="flex flex-col items-center gap-1 w-full">
          <span className="text-xs text-gray-400 italic">Empty</span>
          <button
            className="text-xs text-red-400 hover:text-red-600 leading-none"
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onRemoveBlank(); }}
            title="Remove blank"
          >✕</button>
        </div>
      ) : (
        <>
          <span className={`text-xs font-medium leading-tight break-words w-full ${isSelected ? 'text-blue-700' : 'text-gray-700'}`}>
            {row.name}
          </span>
          {row.metaRight && (
            <span className="text-[10px] text-gray-400 mt-0.5">{row.metaRight}</span>
          )}
        </>
      )}
      {/* 자석 효과: 드래그 활성화 중 over된 셀에 타겟 표시 */}
      {isOver && isDragActive && !isDragging && (
        <div className="absolute inset-0 rounded-lg border-2 border-green-400 pointer-events-none animate-pulse" />
      )}
    </div>
  );
};

const OrderPageManagerPage: React.FC = () => {
  const { layoutSettings, setLayoutSettings, loadLayoutSettings, saveLayoutSettings } = useLayoutSettings();
  const [menuId, setMenuId] = useState<number | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedModifierRowId, setSelectedModifierRowId] = useState<string | null>(null);
  const [itemModifiers, setItemModifiers] = useState<ModifierEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeItemDragId, setActiveItemDragId] = useState<string | null>(null);
  const [overItemId, setOverItemId] = useState<string | null>(null);

  const [togoPanelEnabled, setTogoPanelEnabled] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem('tableMapChannelVisibility');
      if (raw) { const parsed = JSON.parse(raw); return parsed?.togo !== false; }
    } catch {}
    return true;
  });

  const handleTogoPanelToggle = (enabled: boolean) => {
    try {
      const raw = localStorage.getItem('tableMapChannelVisibility');
      const current = raw ? JSON.parse(raw) : { togo: true, delivery: true };
      const updated = { ...current, togo: enabled };
      localStorage.setItem('tableMapChannelVisibility', JSON.stringify(updated));
      window.dispatchEvent(new StorageEvent('storage', { key: 'tableMapChannelVisibility', newValue: JSON.stringify(updated) }));
      setTogoPanelEnabled(enabled);
    } catch {}
  };

  // distance: 10 으로 완화 → 클릭 시 의도치 않은 드래그 방지
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 10 } }),
    useSensor(MouseSensor, { activationConstraint: { distance: 10 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 10 } })
  );

  const logDragStart = useCallback((scope: string) => (event: DragStartEvent) => {
    console.log('[OrderScreenManager] drag start', { scope, active: String(event.active.id) });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await loadLayoutSettings();
        let resolvedMenuId: number | null = null;

        // 1) Find menuId for Dine-In(QSR Mode) - orderType 'pos'
        try {
          const setupRes = await fetch(`${API_URL}/order-page-setups`);
          if (setupRes.ok) {
            const result = await setupRes.json();
            const data = (result && (result.data || result)) || [];
            const list = Array.isArray(data) ? data : [];
            const pos = list.find((s: any) => String(s.orderType).toLowerCase() === 'pos');
            const selected = pos || list[0];
            const mid = selected?.menuId != null ? Number(selected.menuId) : null;
            if (mid && !Number.isNaN(mid)) resolvedMenuId = mid;
          }
        } catch (e) {
          console.warn('Failed to load order-page-setups:', e);
        }

        // 2) Fallback: if no setup exists yet, pick active menu (or first menu)
        try {
          if (!resolvedMenuId) {
            const base = API_URL.replace(/\/api$/, '');
            const menusRes = await fetch(`${base}/api/menus`);
            if (menusRes.ok) {
              const result = await menusRes.json();
              const list = Array.isArray(result?.value) ? result.value : (Array.isArray(result) ? result : []);
              const active = list.find((m: any) => Number(m.is_active) === 1) || list[0];
              const mid = active?.menu_id != null ? Number(active.menu_id) : null;
              if (mid && !Number.isNaN(mid)) resolvedMenuId = mid;
            }
          }
        } catch (e) {
          console.warn('Failed to load menus fallback:', e);
        }

        if (resolvedMenuId) setMenuId(resolvedMenuId);
      } catch (e) {
        console.error('Failed to load data:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [loadLayoutSettings]);

  useEffect(() => {
    console.log('[OrderScreenManager] mounted', { path: window.location.pathname, href: window.location.href });
  }, []);

  useEffect(() => {
    if (!menuId) { setCategories([]); return; }
    (async () => {
      try {
        const catRes = await fetch(`${API_URL}/menu/categories?menu_id=${encodeURIComponent(String(menuId))}`);
        if (catRes.ok) {
          const cats = await catRes.json();
          setCategories(Array.isArray(cats) ? cats : []);
        } else {
          setCategories([]);
        }
      } catch (e) { console.error(e); setCategories([]); }
    })();
  }, [menuId]);

  useEffect(() => {
    if (selectedCategoryId == null) { setMenuItems([]); return; }
    (async () => {
      try {
        const res = await fetch(`${API_URL}/menu/items?categoryId=${selectedCategoryId}`);
        if (res.ok) {
          const items = await res.json();
          setMenuItems(Array.isArray(items) ? items.map((r: any) => ({
            id: String(r.item_id ?? r.id),
            name: r.name || '',
            price: Number(r.price || 0),
            category_id: r.category_id,
          })) : []);
        }
      } catch (e) { console.error(e); }
    })();
  }, [selectedCategoryId]);

  useEffect(() => {
    if (!selectedItemId) {
      setItemModifiers([]);
      return;
    }
    const row = menuItems.find(m => String(m.id) === String(selectedItemId));
    const categoryIdForItem = row?.category_id ?? selectedCategoryId ?? null;
    if (categoryIdForItem == null) {
      setItemModifiers([]);
      return;
    }
    (async () => {
      try {
        const catTmpl = getModifierLayoutForCategory(
          (layoutSettings as any).modifierLayoutByCategory,
          Number(categoryIdForItem)
        );
        const composed = await fetchComposedModifierEntries(
          API_URL,
          selectedItemId,
          Number(categoryIdForItem),
          catTmpl
        );
        const entries: ModifierEntry[] = composed.map(c => ({
          id: c.id,
          label: c.label,
          groupId: c.groupId,
          price: c.price,
        }));
        setItemModifiers(entries);
      } catch (e) {
        console.error(e);
        setItemModifiers([]);
      }
    })();
  }, [selectedItemId, selectedCategoryId, menuItems, layoutSettings]);

  const mergedGroups: MergedGroup[] = (layoutSettings.mergedGroups || []) as MergedGroup[];
  const savedCategoryBarOrder = (((layoutSettings as any).categoryBarOrder || []) as string[]);
  const menuItemOrderByCategory = (((layoutSettings as any).menuItemOrderByCategory || {}) as Record<number, string[]>);
  const modifierLayoutByItemFromSettings = (((layoutSettings as any).modifierLayoutByItem || {}) as Record<string, string[]>);
  const modifierLayoutByCategoryFromSettings = (layoutSettings as any).modifierLayoutByCategory;

  // 실제 Order Screen의 열 수를 그대로 사용
  const gridCols: number = useMemo(() => {
    const v = (layoutSettings as any).menuGridColumns;
    const n = Number(v);
    return (!Number.isNaN(n) && n >= 1) ? n : 6;
  }, [layoutSettings]);

  const categoryBarOrder: string[] = useMemo(() => {
    if (savedCategoryBarOrder.length > 0) return savedCategoryBarOrder;
    const mergedIds = mergedGroups.map(g => g.id);
    const mergedCatNames = new Set(mergedGroups.flatMap(g => g.categoryNames));
    const available = categories.filter(c => !mergedCatNames.has(c.name));
    return [...mergedIds, ...available.map(c => String(c.category_id))];
  }, [savedCategoryBarOrder, mergedGroups, categories]);

  const visibleCategoryBarOrder: string[] = useMemo(() => {
    const catIdSet = new Set(categories.map(c => String(c.category_id)));
    const groupIdSet = new Set(mergedGroups.map(g => g.id));
    return categoryBarOrder.filter(id => groupIdSet.has(id) || catIdSet.has(id));
  }, [categoryBarOrder, categories, mergedGroups]);

  const getCategoryItemOrder = useCallback((catId: number): string[] => {
    return menuItemOrderByCategory[catId] || [];
  }, [menuItemOrderByCategory]);

  const getModifierOrder = useCallback(
    (itemId: string): string[] => {
      if (selectedCategoryId != null) {
        const fromCat = getModifierLayoutForCategory(modifierLayoutByCategoryFromSettings, selectedCategoryId);
        if (fromCat && fromCat.length > 0) return fromCat;
      }
      const fromItem = modifierLayoutByItemFromSettings[itemId];
      if (fromItem && fromItem.length > 0) return fromItem;
      return [];
    },
    [modifierLayoutByItemFromSettings, modifierLayoutByCategoryFromSettings, selectedCategoryId]
  );

  const orderedCategoryRows: SortableRow[] = useMemo(() => {
    if (selectedCategoryId == null) return [];
    const saved = getCategoryItemOrder(selectedCategoryId);
    const rows: SortableRow[] = [];
    const available = menuItems.map(i => i.id);
    if (saved.length > 0) {
      for (const id of saved) {
        if (String(id).startsWith('EMPTY:')) {
          rows.push({ kind: 'blank', id: String(id) });
          continue;
        }
        const item = menuItems.find(i => i.id === String(id));
        if (item) {
          rows.push({ kind: 'item', id: item.id, name: item.name, metaRight: `$${Number(item.price || 0).toFixed(2)}` });
        }
      }
      for (const id of available) {
        if (!saved.includes(id)) {
          const item = menuItems.find(i => i.id === id);
          if (item) {
            rows.push({ kind: 'item', id: item.id, name: item.name, metaRight: `$${Number(item.price || 0).toFixed(2)}` });
          }
        }
      }
      return rows;
    }
    return menuItems.map(item => ({ kind: 'item', id: item.id, name: item.name, metaRight: `$${Number(item.price || 0).toFixed(2)}` }));
  }, [menuItems, selectedCategoryId, getCategoryItemOrder]);

  const orderedModifierRows: SortableRow[] = useMemo(() => {
    if (!selectedItemId) return [];
    const saved = getModifierOrder(selectedItemId);
    const rows: SortableRow[] = [];
    const available = itemModifiers.map(m => m.id);
    if (saved.length > 0) {
      for (const id of saved) {
        if (String(id).startsWith('EMPTY:')) {
          rows.push({ kind: 'blank', id: String(id) });
          continue;
        }
        const entry = itemModifiers.find(m => m.id === String(id));
        if (entry) {
          const price = Number(entry.price || 0);
          rows.push({ kind: 'modifier', id: entry.id, name: entry.label, metaRight: price !== 0 ? `${price > 0 ? '+' : ''}$${price.toFixed(2)}` : undefined });
        }
      }
      for (const id of available) {
        if (!saved.includes(id)) {
          const entry = itemModifiers.find(m => m.id === id);
          if (entry) {
            const price = Number(entry.price || 0);
            rows.push({ kind: 'modifier', id: entry.id, name: entry.label, metaRight: price !== 0 ? `${price > 0 ? '+' : ''}$${price.toFixed(2)}` : undefined });
          }
        }
      }
      return rows;
    }
    return itemModifiers.map(entry => {
      const price = Number(entry.price || 0);
      return { kind: 'modifier' as const, id: entry.id, name: entry.label, metaRight: price !== 0 ? `${price > 0 ? '+' : ''}$${price.toFixed(2)}` : undefined };
    });
  }, [itemModifiers, selectedItemId, getModifierOrder]);

  const createBlankId = useCallback((scope: 'items' | 'modifiers') => {
    return `EMPTY:${scope}:${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }, []);

  const insertBlankIntoCategory = useCallback(() => {
    if (selectedCategoryId == null) return;
    const currentIds = orderedCategoryRows.map(r => r.id);
    const blankId = createBlankId('items');
    const insertAfter = selectedItemId ? currentIds.indexOf(selectedItemId) : -1;
    const next = currentIds.slice();
    if (insertAfter >= 0) next.splice(insertAfter + 1, 0, blankId);
    else next.push(blankId);
    const map = { ...((layoutSettings as any).menuItemOrderByCategory || {}) };
    map[selectedCategoryId] = next;
    setLayoutSettings(prev => ({ ...prev, menuItemOrderByCategory: map } as any));
  }, [selectedCategoryId, orderedCategoryRows, createBlankId, selectedItemId, layoutSettings, setLayoutSettings]);

  const removeBlankFromCategory = useCallback((blankId: string) => {
    if (selectedCategoryId == null) return;
    const current = orderedCategoryRows.map(r => r.id).filter(id => id !== blankId);
    const map = { ...((layoutSettings as any).menuItemOrderByCategory || {}) };
    map[selectedCategoryId] = current;
    setLayoutSettings(prev => ({ ...prev, menuItemOrderByCategory: map } as any));
  }, [selectedCategoryId, orderedCategoryRows, layoutSettings, setLayoutSettings]);

  const stripModifierLayoutsForCurrentCategoryItems = useCallback(() => {
    const prevMap = { ...((layoutSettings as any).modifierLayoutByItem || {}) };
    for (const it of menuItems) {
      delete prevMap[String(it.id)];
    }
    return prevMap;
  }, [layoutSettings, menuItems]);

  /** modifierLayoutByCategory는 자동 저장 시 undefined로 덮여 DB에서 사라질 수 있어, 변경 직후 명시 인자로 POST */
  const persistModifierCategoryLayout = useCallback(
    async (map: Record<string, string[]>, catMap: Record<string, string[]>) => {
      try {
        await saveLayoutSettings({
          modifierLayoutByItem: map,
          modifierLayoutByCategory: catMap,
          menuItemOrderByCategory: (layoutSettings as any).menuItemOrderByCategory || {},
        });
      } catch (e) {
        console.error('[OrderScreenManager] persist modifier category layout failed', e);
      }
    },
    [saveLayoutSettings, layoutSettings]
  );

  const insertBlankIntoModifiers = useCallback(() => {
    if (!selectedItemId || selectedCategoryId == null) return;
    const currentIds = orderedModifierRows.map(r => r.id);
    const blankId = createBlankId('modifiers');
    const insertAfter = selectedModifierRowId ? currentIds.indexOf(selectedModifierRowId) : -1;
    const next = currentIds.slice();
    if (insertAfter >= 0) next.splice(insertAfter + 1, 0, blankId);
    else next.push(blankId);
    const map = stripModifierLayoutsForCurrentCategoryItems();
    const catMap = { ...((layoutSettings as any).modifierLayoutByCategory || {}) };
    catMap[String(selectedCategoryId)] = next;
    setLayoutSettings(prev => ({ ...prev, modifierLayoutByItem: map, modifierLayoutByCategory: catMap } as any));
    void persistModifierCategoryLayout(map, catMap);
  }, [
    selectedItemId,
    selectedCategoryId,
    orderedModifierRows,
    createBlankId,
    selectedModifierRowId,
    layoutSettings,
    setLayoutSettings,
    stripModifierLayoutsForCurrentCategoryItems,
    persistModifierCategoryLayout,
  ]);

  const removeBlankFromModifiers = useCallback(
    (blankId: string) => {
      if (!selectedItemId || selectedCategoryId == null) return;
      const current = orderedModifierRows.map(r => r.id).filter(id => id !== blankId);
      const map = stripModifierLayoutsForCurrentCategoryItems();
      const catMap = { ...((layoutSettings as any).modifierLayoutByCategory || {}) };
      catMap[String(selectedCategoryId)] = current;
      setLayoutSettings(prev => ({ ...prev, modifierLayoutByItem: map, modifierLayoutByCategory: catMap } as any));
      void persistModifierCategoryLayout(map, catMap);
    },
    [
      selectedItemId,
      selectedCategoryId,
      orderedModifierRows,
      layoutSettings,
      setLayoutSettings,
      stripModifierLayoutsForCurrentCategoryItems,
      persistModifierCategoryLayout,
    ]
  );

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg('');
    try {
      const modByCat = (layoutSettings as any).modifierLayoutByCategory;
      await saveLayoutSettings({
        modifierLayoutByItem: (layoutSettings as any).modifierLayoutByItem || {},
        menuItemOrderByCategory: (layoutSettings as any).menuItemOrderByCategory || {},
        ...(modByCat != null ? { modifierLayoutByCategory: modByCat } : {}),
      });
      setSaveMsg('Saved successfully!');
      setTimeout(() => setSaveMsg(''), 3000);
    } catch (e) {
      setSaveMsg('Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleCategoryBarDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = visibleCategoryBarOrder.indexOf(String(active.id));
    const newIndex = visibleCategoryBarOrder.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const newOrder = arrayMove(visibleCategoryBarOrder, oldIndex, newIndex);
    setLayoutSettings(prev => ({ ...prev, categoryBarOrder: newOrder }));
    const newMergedGroups = newOrder
      .filter(id => id.startsWith('mergy_'))
      .map(id => mergedGroups.find(g => g.id === id))
      .filter(Boolean) as MergedGroup[];
    setLayoutSettings(prev => ({ ...prev, mergedGroups: newMergedGroups }));
    console.log('[OrderScreenManager] category/group reorder', { active: String(active.id), over: String(over.id), oldIndex, newIndex });
  };

  const handleMergedGroupInternalDragEnd = (groupId: string) => (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const group = mergedGroups.find(g => g.id === groupId);
    if (!group) return;
    const oldIndex = group.categoryNames.indexOf(String(active.id));
    const newIndex = group.categoryNames.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const newNames = arrayMove(group.categoryNames, oldIndex, newIndex);
    const updatedGroups = mergedGroups.map(g => g.id === groupId ? { ...g, categoryNames: newNames } : g);
    setLayoutSettings(prev => ({ ...prev, mergedGroups: updatedGroups }));
    console.log('[OrderScreenManager] merged group internal reorder', { groupId, active: String(active.id), over: String(over.id), oldIndex, newIndex });
  };

  // 시나리오 1: 아이템이 있는 위치에 드롭 → push (밀어내기, 원위치는 EMPTY)
  // 시나리오 2: 빈슬롯에 드롭 → 이동 (swap, 원위치는 EMPTY)
  const handleItemDragEnd = (event: DragEndEvent) => {
    setActiveItemDragId(null);
    setOverItemId(null);
    const { active, over } = event;
    if (!over || active.id === over.id || selectedCategoryId == null) return;

    const ids = orderedCategoryRows.map(r => r.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    const overRow = orderedCategoryRows[newIndex];
    let newIds: string[];

    if (overRow.kind === 'blank') {
      // 시나리오 2: 빈슬롯 → 아이템 이동, 원위치 EMPTY로
      newIds = ids.slice();
      newIds[newIndex] = ids[oldIndex];       // 빈슬롯 자리에 아이템 배치
      newIds[oldIndex] = overRow.id;           // 원위치를 빈슬롯으로
    } else {
      // 시나리오 1: 아이템 → 아이템 push 삽입 (splice), 원위치는 EMPTY
      newIds = ids.slice();
      const [moved] = newIds.splice(oldIndex, 1);  // 원위치에서 제거
      newIds.splice(newIndex, 0, moved);            // 목표 위치에 삽입 (뒤로 밀기)
    }

    const map = { ...((layoutSettings as any).menuItemOrderByCategory || {}) };
    map[selectedCategoryId] = newIds;
    setLayoutSettings(prev => ({ ...prev, menuItemOrderByCategory: map } as any));
    console.log('[OrderScreenManager] item reorder', { categoryId: selectedCategoryId, active: String(active.id), over: String(over.id), oldIndex, newIndex, mode: overRow.kind === 'blank' ? 'swap-empty' : 'push' });
  };

  const handleModifierDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !selectedItemId || selectedCategoryId == null) return;
    const ids = orderedModifierRows.map(r => r.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const newIds = reorderModifierSlotIds(ids, oldIndex, newIndex);
    const map = stripModifierLayoutsForCurrentCategoryItems();
    const catMap = { ...((layoutSettings as any).modifierLayoutByCategory || {}) };
    catMap[String(selectedCategoryId)] = newIds;
    setLayoutSettings(prev => ({ ...prev, modifierLayoutByItem: map, modifierLayoutByCategory: catMap } as any));
    void persistModifierCategoryLayout(map, catMap);
    console.log('[OrderScreenManager] modifier reorder → category template', {
      categoryId: selectedCategoryId,
      itemId: selectedItemId,
      active: String(active.id),
      over: String(over.id),
      oldIndex,
      newIndex,
    });
  };

  const catMap = useMemo(() => new Map(categories.map(c => [String(c.category_id), c])), [categories]);
  const groupMap = useMemo(() => new Map(mergedGroups.map(g => [g.id, g])), [mergedGroups]);

  // Tailwind grid-cols 동적 매핑
  const gridColsClass: Record<number, string> = {
    1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3',
    4: 'grid-cols-4', 5: 'grid-cols-5', 6: 'grid-cols-6',
    7: 'grid-cols-7', 8: 'grid-cols-8', 9: 'grid-cols-9',
    10: 'grid-cols-10',
  };
  const colClass = gridColsClass[gridCols] || 'grid-cols-6';

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mr-3" />
        <span className="text-gray-600">Loading...</span>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Order Screen Manager</h1>
          <p className="text-sm text-gray-500 mt-1">Drag and drop to reorder categories, items, and modifiers.</p>
          <p className="text-xs text-gray-400 mt-1">
            Editing scope: Dine-In(QSR Mode) menuId {menuId ? `#${menuId}` : '(not set — configure in Order Setup)'}.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saveMsg && (
            <span className={`text-sm font-medium ${saveMsg.includes('fail') ? 'text-red-600' : 'text-green-600'}`}>{saveMsg}</span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors shadow"
          >
            {saving ? 'Saving...' : 'Save Layout'}
          </button>
        </div>
      </div>

      {/* TOGO Panel Toggle */}
      <div className="mb-6 bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-900 text-sm">TOGO Panel (Right Side)</h2>
            <p className="text-xs text-gray-500 mt-0.5">Show or hide the Togo/Delivery/Online order panel on the Sales screen</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleTogoPanelToggle(true)}
              className={`px-4 py-2 rounded-lg border-2 text-sm font-semibold transition-all ${
                togoPanelEnabled
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              ON
            </button>
            <button
              type="button"
              onClick={() => handleTogoPanelToggle(false)}
              className={`px-4 py-2 rounded-lg border-2 text-sm font-semibold transition-all ${
                !togoPanelEnabled
                  ? 'border-rose-500 bg-rose-50 text-rose-700'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              OFF
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Column 1: Categories & Merged Groups */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="bg-indigo-50 px-4 py-3 border-b border-indigo-100">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-indigo-900">Categories & Groups</h2>
                <p className="text-xs text-indigo-600 mt-0.5">Drag to reorder the category bar</p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setLayoutSettings({ ...layoutSettings, categoryFontBold: !layoutSettings.categoryFontBold, categoryFontExtraBold: false })}
                  className={`text-xs px-2 py-1 rounded border ${layoutSettings.categoryFontBold && !layoutSettings.categoryFontExtraBold ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                >Bold</button>
                <button
                  onClick={() => setLayoutSettings({ ...layoutSettings, categoryFontExtraBold: !layoutSettings.categoryFontExtraBold, categoryFontBold: false })}
                  className={`text-xs px-2 py-1 rounded border ${layoutSettings.categoryFontExtraBold ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                >Extra Bold</button>
              </div>
            </div>
          </div>
          <div className="p-3 max-h-[70vh] overflow-y-auto">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={logDragStart('categoryBar')}
              onDragEnd={handleCategoryBarDragEnd}
            >
              <SortableContext items={visibleCategoryBarOrder} strategy={rectSortingStrategy}>
                <div className="space-y-2">
                  {visibleCategoryBarOrder.map(id => {
                    const group = groupMap.get(id);
                    if (group) {
                      return (
                        <div key={id}>
                          <SortableItem id={id}>
                            <div className="flex-1">
                              <span className="font-semibold text-purple-700">{group.name}</span>
                              <span className="text-xs text-gray-400 ml-2">(merged group)</span>
                            </div>
                          </SortableItem>
                          <div className="ml-8 mt-1 mb-2 border-l-2 border-purple-200 pl-3">
                            <DndContext
                              sensors={sensors}
                              collisionDetection={closestCenter}
                              onDragStart={logDragStart(`mergedGroup:${group.id}`)}
                              onDragEnd={handleMergedGroupInternalDragEnd(group.id)}
                            >
                              <SortableContext items={group.categoryNames} strategy={rectSortingStrategy}>
                                <div className="space-y-1">
                                  {group.categoryNames.map(catName => (
                                    <SortableItem key={catName} id={catName}>
                                      <span className="text-sm text-gray-700">{catName}</span>
                                    </SortableItem>
                                  ))}
                                </div>
                              </SortableContext>
                            </DndContext>
                          </div>
                        </div>
                      );
                    }
                    const cat = catMap.get(id);
                    if (cat) {
                      return (
                        <SortableItem key={id} id={id}>
                          <span
                            className={`text-sm cursor-pointer ${selectedCategoryId === cat.category_id ? 'font-bold text-blue-700' : 'text-gray-700'}`}
                            onClick={() => { setSelectedCategoryId(cat.category_id); setSelectedItemId(null); }}
                          >
                            {cat.name}
                          </span>
                        </SortableItem>
                      );
                    }
                    return null;
                  })}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        </div>

        {/* Column 2: Items (그리드 형태 - 실제 Order Screen과 동일한 열 수) */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden lg:col-span-2">
          <div className="bg-green-50 px-4 py-3 border-b border-green-100">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-green-900">
                  Items
                  {selectedCategoryId != null && (
                    <span className="text-sm font-normal text-green-600 ml-2">
                      — {categories.find(c => c.category_id === selectedCategoryId)?.name || ''}
                    </span>
                  )}
                </h2>
                <p className="text-xs text-green-600 mt-0.5">
                  {selectedCategoryId
                    ? `Drag to reorder · ${gridCols} columns (matches Order Screen) · Drop on item = push, drop on Empty = swap`
                    : 'Select a category first.'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setLayoutSettings({ ...layoutSettings, menuFontBold: !layoutSettings.menuFontBold, menuFontExtraBold: false })}
                  className={`text-xs px-2 py-1 rounded border ${layoutSettings.menuFontBold && !layoutSettings.menuFontExtraBold ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                >Bold</button>
                <button
                  onClick={() => setLayoutSettings({ ...layoutSettings, menuFontExtraBold: !layoutSettings.menuFontExtraBold, menuFontBold: false })}
                  className={`text-xs px-2 py-1 rounded border ${layoutSettings.menuFontExtraBold ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                >Extra Bold</button>
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">
                  {gridCols} cols
                </span>
                <button
                  onClick={insertBlankIntoCategory}
                  disabled={selectedCategoryId == null}
                  className="text-xs px-3 py-1 rounded bg-white/70 border border-green-200 hover:bg-white disabled:opacity-50"
                  title="Insert a blank slot after selected item"
                >
                  + Blank
                </button>
              </div>
            </div>
          </div>
          <div className="p-3 overflow-y-auto" style={{ maxHeight: '70vh' }}>
            {selectedCategoryId == null ? (
              <p className="text-gray-400 text-center py-12 text-sm">Select a category on the left</p>
            ) : orderedCategoryRows.length === 0 ? (
              <p className="text-gray-400 text-center py-12 text-sm">No items in this category</p>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={(event) => {
                  logDragStart('items')(event);
                  setActiveItemDragId(String(event.active.id));
                }}
                onDragOver={(event: DragOverEvent) => {
                  setOverItemId(event.over ? String(event.over.id) : null);
                }}
                onDragEnd={handleItemDragEnd}
                onDragCancel={() => { setActiveItemDragId(null); setOverItemId(null); }}
              >
                <SortableContext items={orderedCategoryRows.map(r => r.id)} strategy={rectSortingStrategy}>
                  <div className={`grid ${colClass} gap-2`}>
                    {orderedCategoryRows.map(row => (
                      <SortableGridCell
                        key={row.id}
                        id={row.id}
                        row={row}
                        isSelected={selectedItemId === row.id}
                        isOver={overItemId === row.id}
                        isDragActive={activeItemDragId !== null}
                        onSelect={() => { setSelectedItemId(row.id); setSelectedModifierRowId(null); }}
                        onRemoveBlank={() => removeBlankFromCategory(row.id)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        </div>
      </div>

      {/* Modifiers 패널 (선택된 아이템이 있을 때) */}
      {selectedItemId && (
        <div className="mt-6 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="bg-amber-50 px-4 py-3 border-b border-amber-100">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-amber-900">
                  Modifiers
                  <span className="text-sm font-normal text-amber-600 ml-2">
                    — {menuItems.find(i => i.id === selectedItemId)?.name || ''}
                  </span>
                </h2>
                <p className="text-xs text-amber-600 mt-0.5">Drag to reorder modifiers for this item.</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setLayoutSettings({ ...layoutSettings, modifierFontBold: !layoutSettings.modifierFontBold, modifierFontExtraBold: false })}
                  className={`text-xs px-2 py-1 rounded border ${layoutSettings.modifierFontBold && !layoutSettings.modifierFontExtraBold ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                >Bold</button>
                <button
                  onClick={() => setLayoutSettings({ ...layoutSettings, modifierFontExtraBold: !layoutSettings.modifierFontExtraBold, modifierFontBold: false })}
                  className={`text-xs px-2 py-1 rounded border ${layoutSettings.modifierFontExtraBold ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                >Extra Bold</button>
                <button
                  onClick={insertBlankIntoModifiers}
                  className="text-xs px-3 py-1 rounded bg-white/70 border border-amber-200 hover:bg-white"
                  title="Insert a blank slot into this item's modifier layout"
                >
                  + Blank
                </button>
              </div>
            </div>
          </div>
          <div className="p-3 max-h-[40vh] overflow-y-auto">
            {orderedModifierRows.length === 0 ? (
              <p className="text-gray-400 text-center py-8 text-sm">No modifiers linked to this item</p>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={logDragStart('modifiers')}
                onDragEnd={handleModifierDragEnd}
              >
                <SortableContext items={orderedModifierRows.map(r => r.id)} strategy={rectSortingStrategy}>
                  <div className="space-y-2">
                    {orderedModifierRows.map(row => (
                      <SortableItem key={row.id} id={row.id}>
                        {row.kind === 'blank' ? (
                          <>
                            <span className="text-sm flex-1 text-gray-400 italic">[ Blank ]</span>
                            <button
                              className="text-xs text-red-600 hover:text-red-700"
                              onClick={(e) => { e.stopPropagation(); removeBlankFromModifiers(row.id); }}
                              title="Remove blank"
                            >✕</button>
                          </>
                        ) : (
                          <>
                            <span
                              className={`text-sm text-gray-700 flex-1 cursor-pointer ${selectedModifierRowId === row.id ? 'font-bold text-blue-700' : ''}`}
                              onClick={() => setSelectedModifierRowId(row.id)}
                            >
                              {row.name}
                            </span>
                            {row.metaRight && <span className="text-xs text-gray-400">{row.metaRight}</span>}
                          </>
                        )}
                      </SortableItem>
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default OrderPageManagerPage;
