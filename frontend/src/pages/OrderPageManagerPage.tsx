import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { DndContext, closestCenter, DragEndEvent, DragStartEvent, PointerSensor, TouchSensor, MouseSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useLayoutSettings } from '../hooks/useLayoutSettings';
import { API_URL } from '../config/constants';

interface Category { category_id: number; name: string; }
interface MenuItem { id: string; name: string; price: number; category_id?: number; }
interface ModifierEntry { id: string; label: string; groupId: string; price?: number; }
interface MergedGroup { id: string; name: string; categoryNames: string[] }
type SortableRow =
  | { kind: 'item'; id: string; name: string; metaRight?: string }
  | { kind: 'modifier'; id: string; name: string; metaRight?: string }
  | { kind: 'blank'; id: string };

const SortableItem: React.FC<{ id: string; children: React.ReactNode }> = ({ id, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        touchAction: 'none',
      }}
      className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg shadow-sm cursor-grab active:cursor-grabbing select-none"
      {...attributes}
      {...listeners}
    >
      <span className="text-gray-400 text-sm">☰</span>
      {children}
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // Fallbacks for environments where Pointer events are flaky/disabled
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 80, tolerance: 8 } })
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
    if (!menuId) {
      setCategories([]);
      return;
    }
    (async () => {
      try {
        const catRes = await fetch(`${API_URL}/menu/categories?menu_id=${encodeURIComponent(String(menuId))}`);
        if (catRes.ok) {
          const cats = await catRes.json();
          setCategories(Array.isArray(cats) ? cats : []);
        } else {
          console.warn('Failed to load categories:', catRes.status);
          setCategories([]);
        }
      } catch (e) {
        console.error('Failed to load categories:', e);
        setCategories([]);
      }
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
    if (!selectedItemId) { setItemModifiers([]); return; }
    (async () => {
      try {
        const res = await fetch(`${API_URL}/menu/items/${selectedItemId}/options/modifier`);
        if (res.ok) {
          const data = await res.json();
          const entries: ModifierEntry[] = [];
          (Array.isArray(data) ? data : []).forEach((link: any) => {
            (link.modifiers || []).forEach((mod: any) => {
              const id = String(mod.option_id ?? mod.modifier_id ?? mod.id);
              entries.push({
                id,
                label: mod.name || mod.option_name || '',
                groupId: String(link.modifier_group_id),
                price: mod.price_delta ?? mod.price_adjustment ?? 0,
              });
            });
          });
          setItemModifiers(entries);
        }
      } catch (e) { console.error(e); }
    })();
  }, [selectedItemId]);

  // These are plain derived values; memoization here causes noisy deps warnings without benefits.
  const mergedGroups: MergedGroup[] = (layoutSettings.mergedGroups || []) as MergedGroup[];
  const savedCategoryBarOrder = (((layoutSettings as any).categoryBarOrder || []) as string[]);
  const menuItemOrderByCategory = (((layoutSettings as any).menuItemOrderByCategory || {}) as Record<number, string[]>);
  const modifierLayoutByItemFromSettings = (((layoutSettings as any).modifierLayoutByItem || {}) as Record<string, string[]>);

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

  const getModifierOrder = useCallback((itemId: string): string[] => {
    return modifierLayoutByItemFromSettings[itemId] || [];
  }, [modifierLayoutByItemFromSettings]);

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
          rows.push({
            kind: 'item',
            id: item.id,
            name: item.name,
            metaRight: `$${Number(item.price || 0).toFixed(2)}`,
          });
        }
      }
      for (const id of available) {
        if (!saved.includes(id)) {
          const item = menuItems.find(i => i.id === id);
          if (item) {
            rows.push({
              kind: 'item',
              id: item.id,
              name: item.name,
              metaRight: `$${Number(item.price || 0).toFixed(2)}`,
            });
          }
        }
      }
      return rows;
    }
    return menuItems.map(item => ({
      kind: 'item',
      id: item.id,
      name: item.name,
      metaRight: `$${Number(item.price || 0).toFixed(2)}`,
    }));
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
          rows.push({
            kind: 'modifier',
            id: entry.id,
            name: entry.label,
            metaRight: price !== 0 ? `${price > 0 ? '+' : ''}$${price.toFixed(2)}` : undefined,
          });
        }
      }
      for (const id of available) {
        if (!saved.includes(id)) {
          const entry = itemModifiers.find(m => m.id === id);
          if (entry) {
            const price = Number(entry.price || 0);
            rows.push({
              kind: 'modifier',
              id: entry.id,
              name: entry.label,
              metaRight: price !== 0 ? `${price > 0 ? '+' : ''}$${price.toFixed(2)}` : undefined,
            });
          }
        }
      }
      return rows;
    }
    return itemModifiers.map(entry => {
      const price = Number(entry.price || 0);
      return ({
        kind: 'modifier',
        id: entry.id,
        name: entry.label,
        metaRight: price !== 0 ? `${price > 0 ? '+' : ''}$${price.toFixed(2)}` : undefined,
      });
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

  const insertBlankIntoModifiers = useCallback(() => {
    if (!selectedItemId) return;
    const currentIds = orderedModifierRows.map(r => r.id);
    const blankId = createBlankId('modifiers');
    const insertAfter = selectedModifierRowId ? currentIds.indexOf(selectedModifierRowId) : -1;
    const next = currentIds.slice();
    if (insertAfter >= 0) next.splice(insertAfter + 1, 0, blankId);
    else next.push(blankId);
    const map = { ...((layoutSettings as any).modifierLayoutByItem || {}) };
    map[selectedItemId] = next;
    setLayoutSettings(prev => ({ ...prev, modifierLayoutByItem: map } as any));
  }, [selectedItemId, orderedModifierRows, createBlankId, selectedModifierRowId, layoutSettings, setLayoutSettings]);

  const removeBlankFromModifiers = useCallback((blankId: string) => {
    if (!selectedItemId) return;
    const current = orderedModifierRows.map(r => r.id).filter(id => id !== blankId);
    const map = { ...((layoutSettings as any).modifierLayoutByItem || {}) };
    map[selectedItemId] = current;
    setLayoutSettings(prev => ({ ...prev, modifierLayoutByItem: map } as any));
  }, [selectedItemId, orderedModifierRows, layoutSettings, setLayoutSettings]);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg('');
    try {
      await saveLayoutSettings({
        modifierLayoutByItem: (layoutSettings as any).modifierLayoutByItem || {},
        menuItemOrderByCategory: (layoutSettings as any).menuItemOrderByCategory || {},
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
    const updatedGroups = mergedGroups.map(g =>
      g.id === groupId ? { ...g, categoryNames: newNames } : g
    );
    setLayoutSettings(prev => ({ ...prev, mergedGroups: updatedGroups }));
    console.log('[OrderScreenManager] merged group internal reorder', { groupId, active: String(active.id), over: String(over.id), oldIndex, newIndex });
  };

  const handleItemDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || selectedCategoryId == null) return;
    const ids = orderedCategoryRows.map(r => r.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const newIds = arrayMove(ids, oldIndex, newIndex);
    const map = { ...((layoutSettings as any).menuItemOrderByCategory || {}) };
    map[selectedCategoryId] = newIds;
    setLayoutSettings(prev => ({ ...prev, menuItemOrderByCategory: map } as any));
    console.log('[OrderScreenManager] item reorder', { categoryId: selectedCategoryId, active: String(active.id), over: String(over.id), oldIndex, newIndex });
  };

  const handleModifierDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !selectedItemId) return;
    const ids = orderedModifierRows.map(r => r.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const newIds = arrayMove(ids, oldIndex, newIndex);
    const map = { ...((layoutSettings as any).modifierLayoutByItem || {}) };
    map[selectedItemId] = newIds;
    setLayoutSettings(prev => ({ ...prev, modifierLayoutByItem: map } as any));
    console.log('[OrderScreenManager] modifier reorder', { itemId: selectedItemId, active: String(active.id), over: String(over.id), oldIndex, newIndex });
  };

  const catMap = useMemo(() => new Map(categories.map(c => [String(c.category_id), c])), [categories]);
  const groupMap = useMemo(() => new Map(mergedGroups.map(g => [g.id, g])), [mergedGroups]);

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
      <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <div className="font-semibold">Backoffice — Order Screen Manager</div>
        <div className="text-xs text-blue-800 mt-1">
          Current route: {typeof window !== 'undefined' ? window.location.pathname : ''} (drag logs start with <span className="font-mono">[OrderScreenManager]</span>)
        </div>
      </div>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Column 1: Categories & Merged Groups */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="bg-indigo-50 px-4 py-3 border-b border-indigo-100">
            <h2 className="font-semibold text-indigo-900">Categories & Groups</h2>
            <p className="text-xs text-indigo-600 mt-0.5">Drag to reorder the category bar</p>
          </div>
          <div className="p-3 max-h-[70vh] overflow-y-auto">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={logDragStart('categoryBar')}
              onDragEnd={handleCategoryBarDragEnd}
            >
              <SortableContext items={visibleCategoryBarOrder} strategy={verticalListSortingStrategy}>
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
                              <SortableContext items={group.categoryNames} strategy={verticalListSortingStrategy}>
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

        {/* Column 2: Items (for selected category) */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="bg-green-50 px-4 py-3 border-b border-green-100">
            <h2 className="font-semibold text-green-900">
              Items
              {selectedCategoryId != null && (
                <span className="text-sm font-normal text-green-600 ml-2">
                  — {categories.find(c => c.category_id === selectedCategoryId)?.name || ''}
                </span>
              )}
            </h2>
            <p className="text-xs text-green-600 mt-0.5">
              {selectedCategoryId ? 'Drag to reorder items. Click to edit modifiers.' : 'Select a category first.'}
            </p>
            <div className="mt-2">
              <button
                onClick={insertBlankIntoCategory}
                disabled={selectedCategoryId == null}
                className="text-xs px-3 py-1 rounded bg-white/70 border border-green-200 hover:bg-white disabled:opacity-50"
                title="Insert a blank slot (EMPTY) into this category layout"
              >
                + Blank
              </button>
            </div>
          </div>
          <div className="p-3 max-h-[70vh] overflow-y-auto">
            {selectedCategoryId == null ? (
              <p className="text-gray-400 text-center py-8 text-sm">Select a category on the left</p>
            ) : orderedCategoryRows.length === 0 ? (
              <p className="text-gray-400 text-center py-8 text-sm">No items in this category</p>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={logDragStart('items')}
                onDragEnd={handleItemDragEnd}
              >
                <SortableContext items={orderedCategoryRows.map(r => r.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">
                    {orderedCategoryRows.map(row => (
                      <SortableItem key={row.id} id={row.id}>
                        {row.kind === 'blank' ? (
                          <>
                            <span className="text-sm flex-1 text-gray-400 italic">[ Blank ]</span>
                            <button
                              className="text-xs text-red-600 hover:text-red-700"
                              onClick={(e) => { e.stopPropagation(); removeBlankFromCategory(row.id); }}
                              title="Remove blank"
                            >
                              ✕
                            </button>
                          </>
                        ) : (
                          <>
                            <span
                              className={`text-sm flex-1 cursor-pointer ${selectedItemId === row.id ? 'font-bold text-blue-700' : 'text-gray-700'}`}
                              onClick={() => { setSelectedItemId(row.id); setSelectedModifierRowId(null); }}
                            >
                              {row.name}
                            </span>
                            <span className="text-xs text-gray-400">{row.metaRight}</span>
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

        {/* Column 3: Modifiers (for selected item) */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="bg-amber-50 px-4 py-3 border-b border-amber-100">
            <h2 className="font-semibold text-amber-900">
              Modifiers
              {selectedItemId && (
                <span className="text-sm font-normal text-amber-600 ml-2">
                  — {menuItems.find(i => i.id === selectedItemId)?.name || ''}
                </span>
              )}
            </h2>
            <p className="text-xs text-amber-600 mt-0.5">
              {selectedItemId ? 'Drag to reorder modifiers for this item.' : 'Select an item first.'}
            </p>
            <div className="mt-2">
              <button
                onClick={insertBlankIntoModifiers}
                disabled={!selectedItemId}
                className="text-xs px-3 py-1 rounded bg-white/70 border border-amber-200 hover:bg-white disabled:opacity-50"
                title="Insert a blank slot (EMPTY) into this item's modifier layout"
              >
                + Blank
              </button>
            </div>
          </div>
          <div className="p-3 max-h-[70vh] overflow-y-auto">
            {!selectedItemId ? (
              <p className="text-gray-400 text-center py-8 text-sm">Select an item to see modifiers</p>
            ) : orderedModifierRows.length === 0 ? (
              <p className="text-gray-400 text-center py-8 text-sm">No modifiers linked to this item</p>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={logDragStart('modifiers')}
                onDragEnd={handleModifierDragEnd}
              >
                <SortableContext items={orderedModifierRows.map(r => r.id)} strategy={verticalListSortingStrategy}>
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
                            >
                              ✕
                            </button>
                          </>
                        ) : (
                          <>
                            <span
                              className={`text-sm text-gray-700 flex-1 cursor-pointer ${selectedModifierRowId === row.id ? 'font-bold text-blue-700' : ''}`}
                              onClick={() => setSelectedModifierRowId(row.id)}
                            >
                              {row.name}
                            </span>
                            {row.metaRight && (
                              <span className="text-xs text-gray-400">{row.metaRight}</span>
                            )}
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
      </div>
    </div>
  );
};

export default OrderPageManagerPage;
