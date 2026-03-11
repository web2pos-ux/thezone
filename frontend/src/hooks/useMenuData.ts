import { useEffect, useState, useCallback, useRef } from 'react';
import { Category, MenuItem } from '../pages/order/orderTypes';
import { API_URL } from '../config/constants';
import { ORDER_BOOTSTRAP_TTL, readOrderBootstrap } from '../utils/orderBootstrap';

export interface UseMenuDataResult {
  categories: Category[];
  menuItems: MenuItem[];
  menuTaxes: any[];
  itemTaxGroups: { [itemId: string]: number[] };
  categoryTaxGroups: { [categoryId: number]: number[] };
  itemModifierGroups: { [itemId: string]: number[] };
  categoryModifierGroups: { [categoryId: number]: number[] };
  modifierGroupDetailById: { [groupId: number]: any };
  itemIdToCategoryId: { [itemId: string]: number };
  isLoading: boolean;
  error: string | null;
  fetchMenuData: (menuId: number) => Promise<void>;
  fetchItemModifiers: (itemId: string, menuId?: number) => Promise<any[]>;
  fetchMenuTaxes: (menuId: number) => Promise<void>;
}

export function useMenuData(menuId?: number, orderType: string = 'pos', priceType: 'price' | 'price1' | 'price2' = 'price'): UseMenuDataResult {
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [menuTaxes, setMenuTaxes] = useState<any[]>([]);
  const [itemTaxGroups, setItemTaxGroups] = useState<{ [itemId: string]: number[] }>({});
  const [categoryTaxGroups, setCategoryTaxGroups] = useState<{ [categoryId: number]: number[] }>({});
  const [itemModifierGroups, setItemModifierGroups] = useState<{ [itemId: string]: number[] }>({});
  const [categoryModifierGroups, setCategoryModifierGroups] = useState<{ [categoryId: number]: number[] }>({});
  const [modifierGroupDetailById, setModifierGroupDetailById] = useState<{ [groupId: number]: any }>({});
  const [itemIdToCategoryId, setItemIdToCategoryId] = useState<{ [itemId: string]: number }>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const categoriesRef = useRef<Category[]>([]);
  const loadedCategoryIdsRef = useRef<Set<number>>(new Set());
  const pendingCategoryIdsRef = useRef<Set<number>>(new Set());
  const bootstrapAppliedRef = useRef(false);

  useEffect(() => {
    categoriesRef.current = categories;
  }, [categories]);

  const insertItemsByCategoryOrder = useCallback((existing: MenuItem[], categoryId: number, items: MenuItem[]) => {
    const order = categoriesRef.current.map(cat => cat.category_id);
    const filtered = existing.filter(item => item.category_id !== categoryId);
    if (order.length === 0) return [...filtered, ...items];
    const targetIndex = order.indexOf(categoryId);
    if (targetIndex === -1) {
      return [...filtered, ...items];
    }
    let insertPos = filtered.length;
    for (let i = 0; i < filtered.length; i++) {
      const current = filtered[i];
      const idx = order.indexOf(current.category_id || 0);
      if (idx !== -1 && idx > targetIndex) {
        insertPos = i;
        break;
      }
    }
    return [...filtered.slice(0, insertPos), ...items, ...filtered.slice(insertPos)];
  }, []);

  const applyCategoryItems = useCallback(
    (
      categoryId: number,
      items: MenuItem[],
      taxMap?: Record<string, number[]>,
      modMap?: Record<string, number[]>,
      categoryMeta?: Category
    ) => {
      if (!categoryId) return;
      const sortedItems = [...items].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      setMenuItems(prev => insertItemsByCategoryOrder(prev, categoryId, sortedItems));
      setCategories(prev =>
        prev.some(cat => cat.category_id === categoryId)
          ? prev.map(cat => (cat.category_id === categoryId ? { ...cat, items: sortedItems } : cat))
          : categoryMeta
          ? [...prev, { ...categoryMeta, items: sortedItems }]
          : prev
      );
      if (taxMap) {
        setItemTaxGroups(prev => ({ ...prev, ...taxMap }));
      }
      if (modMap) {
        setItemModifierGroups(prev => ({ ...prev, ...modMap }));
      }
      setItemIdToCategoryId(prev => {
        const next = { ...prev };
        sortedItems.forEach(item => {
          if (typeof item.category_id === 'number') {
            next[String(item.id)] = item.category_id!;
          }
        });
        return next;
      });
    },
    [insertItemsByCategoryOrder]
  );

  useEffect(() => {
    if (!menuId) return;
    if (bootstrapAppliedRef.current) return;
    const bootstrap = readOrderBootstrap();
    if (!bootstrap) return;
    if (bootstrap.menuId !== menuId) return;
    const normalizedOrderType = (orderType || 'pos').toLowerCase();
    if ((bootstrap.orderType || 'pos').toLowerCase() !== normalizedOrderType) return;
    if (Date.now() - bootstrap.fetchedAt > ORDER_BOOTSTRAP_TTL) return;

    loadedCategoryIdsRef.current.clear();
    pendingCategoryIdsRef.current.clear();
    setMenuItems([]);
    setItemTaxGroups({});
    setItemModifierGroups({});
    setItemIdToCategoryId({});

    const orderedCategories = [...bootstrap.categories]
      .map(cat => ({ ...cat, items: [] }))
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    setCategories(orderedCategories);

    const grouped = (bootstrap.menuItems || []).reduce((map, item) => {
      const key = item.category_id != null ? Number(item.category_id) : null;
      if (key == null || Number.isNaN(key)) return map;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
      return map;
    }, new Map<number, MenuItem[]>());

    orderedCategories.forEach(cat => {
      const catItems = grouped.get(cat.category_id) || [];
      applyCategoryItems(cat.category_id, catItems, undefined, undefined, cat);
      loadedCategoryIdsRef.current.add(cat.category_id);
    });

    if (Array.isArray(bootstrap.modifierGroups) && bootstrap.modifierGroups.length > 0) {
      const detailMap: { [groupId: number]: any } = {};
      bootstrap.modifierGroups.forEach((group: any) => {
        const gid = Number(group.id || group.group_id);
        if (!Number.isNaN(gid)) {
          detailMap[gid] = group;
        }
      });
      setModifierGroupDetailById(detailMap);
    }

    bootstrapAppliedRef.current = true;
    setIsLoading(false);
  }, [menuId, orderType, applyCategoryItems]);

  const normalizeMenuItems = useCallback((rows: any[], category?: Category) => {
    const normalizedItems: MenuItem[] = [];
    const itemTaxMap: Record<string, number[]> = {};
    const itemModMap: Record<string, number[]> = {};
    rows.forEach(row => {
      const rawId = row.item_id ?? row.id;
      const id = rawId != null ? String(rawId) : `temp-${category?.category_id ?? 'unknown'}-${Date.now()}-${Math.random()}`;
      const categoryId = category?.category_id ?? (Number(row.category_id) || undefined);
      const categoryName = category?.name || row.category || '';
      // Use price2 if priceType is 'price2' and price2 exists, otherwise use price
      const selectedPrice = priceType === 'price2' && row.price2 != null 
        ? Number(row.price2 || 0) 
        : Number(row.price || 0);
      const printerGroups = Array.isArray(row.printer_groups) && row.printer_groups.length > 0
        ? row.printer_groups.map((n: any) => Number(n)).filter((n: number) => !Number.isNaN(n))
        : undefined;
      normalizedItems.push({
        id,
        name: row.name || '',
        price: selectedPrice,
        category: categoryName,
        category_id: categoryId,
        description: row.description || '',
        is_available: row.is_available !== 0,
        sort_order: row.sort_order || 0,
        color: row.color || '',
        short_name: row.short_name,
        ...(printerGroups ? { printer_groups: printerGroups } : {}),
      });
      if (Array.isArray(row.tax_groups) && row.tax_groups.length > 0) {
        itemTaxMap[id] = row.tax_groups.map((n: any) => Number(n)).filter((n: number) => !Number.isNaN(n));
      }
      if (Array.isArray(row.modifier_groups) && row.modifier_groups.length > 0) {
        itemModMap[id] = row.modifier_groups.map((n: any) => Number(n)).filter((n: number) => !Number.isNaN(n));
      }
    });
    normalizedItems.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    return { normalizedItems, itemTaxMap, itemModMap };
  }, [priceType]);

  const loadCategoryItemsFromApi = useCallback(
    async (categoryId: number, categoryOverride?: Category) => {
      if (!categoryId) return;
      if (loadedCategoryIdsRef.current.has(categoryId) || pendingCategoryIdsRef.current.has(categoryId)) return;
      const category = categoryOverride || categoriesRef.current.find(cat => cat.category_id === categoryId);
      if (!category) return;
      pendingCategoryIdsRef.current.add(categoryId);
      try {
        const response = await fetch(`${API_URL}/menu/items?categoryId=${categoryId}`);
        if (!response.ok) return;
        const rows = await response.json();
        const { normalizedItems, itemTaxMap, itemModMap } = normalizeMenuItems(rows, category);
        applyCategoryItems(categoryId, normalizedItems, itemTaxMap, itemModMap, category);
      } catch (e) {
        console.warn(`Failed to load items for category ${categoryId}`, e);
      } finally {
        pendingCategoryIdsRef.current.delete(categoryId);
        loadedCategoryIdsRef.current.add(categoryId);
      }
    },
    [applyCategoryItems, normalizeMenuItems]
  );

  const hydrateCategoryTaxGroups = useCallback(async (cats: Category[]) => {
    try {
      const catTaxPromises = cats.map(cat =>
        fetch(`${API_URL}/menu/categories/${cat.category_id}/taxes`)
          .then(res => (res.ok ? res.json() : []))
          .catch(() => [])
      );
      const catResults: any[][] = await Promise.all(catTaxPromises);
      const catMap: { [categoryId: number]: number[] } = {};
      cats.forEach((cat, idx) => {
        const rows = Array.isArray(catResults[idx]) ? catResults[idx] : [];
        const ids = rows
          .map((r: any) => Number(r.tax_group_id))
          .filter((n: number) => !Number.isNaN(n));
        if (ids.length > 0) catMap[cat.category_id] = ids;
      });
      if (Object.keys(catMap).length > 0) setCategoryTaxGroups(catMap);
    } catch {
      // ignore
    }
  }, []);

  const hydrateCategoryModifierGroups = useCallback(async (cats: Category[]) => {
    try {
      const catModPromises = cats.map(cat =>
        fetch(`${API_URL}/menu/categories/${cat.category_id}/modifiers`)
          .then(res => (res.ok ? res.json() : []))
          .catch(() => [])
      );
      const catModResults: any[][] = await Promise.all(catModPromises);
      const map: { [categoryId: number]: number[] } = {};
      cats.forEach((cat, idx) => {
        const rows = Array.isArray(catModResults[idx]) ? catModResults[idx] : [];
        const ids = rows
          .map((r: any) => Number(r.modifier_group_id))
          .filter((n: number) => !Number.isNaN(n));
        if (ids.length > 0) map[cat.category_id] = ids;
      });
      if (Object.keys(map).length > 0) setCategoryModifierGroups(map);
    } catch {
      // ignore
    }
  }, []);

  const loadModifierGroupDetails = useCallback(async () => {
    try {
      const allGroupsRes = await fetch(`${API_URL}/modifier-groups`);
      if (allGroupsRes.ok) {
        const allGroups = await allGroupsRes.json();
        const detailMap: { [groupId: number]: any } = {};
        (allGroups || []).forEach((g: any) => {
          const gid = Number(g.id || g.group_id);
          if (!Number.isNaN(gid)) {
            detailMap[gid] = g;
          }
        });
        setModifierGroupDetailById(detailMap);
      }
    } catch {
      // ignore
    }
  }, []);

  const sortCategories = useCallback((cats: Category[]) => {
    return [...cats].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }, []);

  useEffect(() => {
    if (!menuId) return;
    if (bootstrapAppliedRef.current) return;
    const bootstrap = readOrderBootstrap();
    if (!bootstrap) return;
    if (bootstrap.menuId !== menuId) return;
    const normalizedOrderType = (orderType || 'pos').toLowerCase();
    if ((bootstrap.orderType || 'pos').toLowerCase() !== normalizedOrderType) return;
    if (Date.now() - bootstrap.fetchedAt > ORDER_BOOTSTRAP_TTL) return;

    loadedCategoryIdsRef.current.clear();
    pendingCategoryIdsRef.current.clear();
    setMenuItems([]);
    setItemTaxGroups({});
    setItemModifierGroups({});
    setItemIdToCategoryId({});

    const orderedCategories = sortCategories(
      (bootstrap.categories || []).map(cat => ({ ...cat, items: [] }))
    );
    setCategories(orderedCategories);

    const grouped = (bootstrap.menuItems || []).reduce((map, item) => {
      const key = item.category_id != null ? Number(item.category_id) : null;
      if (key == null || Number.isNaN(key)) return map;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
      return map;
    }, new Map<number, MenuItem[]>());

    orderedCategories.forEach(cat => {
      const catItems = grouped.get(cat.category_id) || [];
      applyCategoryItems(cat.category_id, catItems, undefined, undefined, cat);
      loadedCategoryIdsRef.current.add(cat.category_id);
    });

    if (Array.isArray(bootstrap.modifierGroups) && bootstrap.modifierGroups.length > 0) {
      const detailMap: { [groupId: number]: any } = {};
      bootstrap.modifierGroups.forEach((group: any) => {
        const gid = Number(group.id || group.group_id);
        if (!Number.isNaN(gid)) {
          detailMap[gid] = group;
        }
      });
      setModifierGroupDetailById(detailMap);
    }

    bootstrapAppliedRef.current = true;
    setIsLoading(false);
  }, [menuId, orderType, applyCategoryItems, sortCategories]);

  const fetchMenuTaxes = useCallback(async (menuId: number) => {
    try {
      // 글로벌 세금 그룹을 가져옴 (Menu Manager -> Tax Settings에서 정의)
      // MenuEditPage와 동일한 API 사용 (/api/tax-groups) - 세금 그룹 내 개별 세금(GST, PST 등)이 포함됨
      const response = await fetch(`${API_URL}/tax-groups`);
      if (!response.ok) return;
      const taxGroups = await response.json();
      setMenuTaxes(taxGroups);
    } catch (e) {
      console.error('Failed to fetch tax groups:', e);
    }
  }, []);

  const fetchItemModifiers = async (_itemId: string, _menuId?: number) => {
    // placeholder; real logic can be implemented by consumer if needed
    return [];
  };

  const fetchMenuData = useCallback(
    async (menuId: number) => {
      try {
        setIsLoading(true);
        setError(null);
        loadedCategoryIdsRef.current.clear();
        pendingCategoryIdsRef.current.clear();

        const response = await fetch(`${API_URL}/menus/${menuId}/structure`);
        if (!response.ok) throw new Error('Failed to fetch menu structure');
        const data: Category[] = await response.json();

        const baseItemsMap = new Map<number, any[]>();
        (data || []).forEach(cat => {
          const cid = Number(cat.category_id ?? (cat as any).id);
          baseItemsMap.set(cid, Array.isArray(cat.items) ? cat.items : []);
        });

        const normalizedCategories = sortCategories((data || []).map(cat => ({
          ...cat,
          category_id: Number(cat.category_id ?? (cat as any).id),
          items: [],
        })));

        setCategories(normalizedCategories);
        setMenuItems([]);
        setItemTaxGroups({});
        setItemModifierGroups({});
        setItemIdToCategoryId({});
        setCategoryTaxGroups({});
        setCategoryModifierGroups({});

        if (normalizedCategories.length === 0) {
          await Promise.all([fetchMenuTaxes(menuId), loadModifierGroupDetails()]);
          return;
        }

        const lackingCategories: Category[] = [];
        normalizedCategories.forEach(cat => {
          const rows = baseItemsMap.get(cat.category_id) || [];
          if (rows.length === 0) {
            lackingCategories.push(cat);
            return;
          }
          const { normalizedItems, itemTaxMap, itemModMap } = normalizeMenuItems(rows, cat);
          applyCategoryItems(cat.category_id, normalizedItems, itemTaxMap, itemModMap, cat);
          loadedCategoryIdsRef.current.add(cat.category_id);
        });

        lackingCategories.forEach((cat, idx) => {
          const delay = 50 * (idx + 1);
          setTimeout(() => {
            loadCategoryItemsFromApi(cat.category_id, cat);
          }, delay);
        });

        await Promise.all([
          hydrateCategoryTaxGroups(normalizedCategories),
          hydrateCategoryModifierGroups(normalizedCategories),
          loadModifierGroupDetails(),
          fetchMenuTaxes(menuId),
        ]);
      } catch (e: any) {
        setError(e?.message || 'Failed to fetch menu data');
      } finally {
        setIsLoading(false);
      }
    },
    [
      fetchMenuTaxes,
      hydrateCategoryModifierGroups,
      hydrateCategoryTaxGroups,
      loadCategoryItemsFromApi,
      loadModifierGroupDetails,
    ]
  );

  useEffect(() => {
    // no-op: consumer will call fetchMenuData when menuId is ready
  }, []);

  return {
    categories,
    menuItems,
    menuTaxes,
    itemTaxGroups,
    categoryTaxGroups,
    itemModifierGroups,
    categoryModifierGroups,
    modifierGroupDetailById,
    itemIdToCategoryId,
    isLoading,
    error,
    fetchMenuData,
    fetchItemModifiers,
    fetchMenuTaxes,
  };
} 