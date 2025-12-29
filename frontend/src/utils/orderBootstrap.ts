import { Category, MenuItem } from '../pages/order/orderTypes';
import { API_URL } from '../config/constants';

export interface OrderBootstrapPayload {
  menuId: number;
  orderType: string;
  fetchedAt: number;
  categories: Category[];
  menuItems: MenuItem[];
  modifierGroups: any[];
}

export const ORDER_BOOTSTRAP_KEY = 'orderBootstrap:data';
export const ORDER_BOOTSTRAP_TTL = 1000 * 60 * 2; // 2 minutes

const serialize = (payload: OrderBootstrapPayload) => {
  try {
    sessionStorage.setItem(ORDER_BOOTSTRAP_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage quota issues
  }
};

export const readOrderBootstrap = (): OrderBootstrapPayload | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(ORDER_BOOTSTRAP_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as OrderBootstrapPayload;
  } catch {
    return null;
  }
};

const normalizeCategories = (rows: any[], menuId: number): Category[] => {
  return (rows || []).map((cat: any) => ({
    ...cat,
    category_id: Number(cat.category_id ?? cat.id),
    id: cat.id ?? cat.category_id,
    menu_id: cat.menu_id ?? menuId,
    sort_order: cat.sort_order ?? 0,
    items: Array.isArray(cat.items) ? cat.items : [],
  }));
};

const flattenMenuItems = (categories: Category[]): MenuItem[] => {
  const allItems: MenuItem[] = [];
  categories.forEach(category => {
    if (!Array.isArray(category.items)) return;
    category.items.forEach((item: any) => {
      allItems.push({
        id: item.item_id?.toString() || item.id?.toString() || Math.random().toString(),
        name: item.name || '',
        price: Number(item.price || 0),
        category: category.name,
        category_id: category.category_id,
        description: item.description || '',
        is_available: item.is_available !== 0,
        sort_order: item.sort_order || 0,
        color: item.color || '',
        short_name: item.short_name,
      });
    });
  });
  allItems.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  return allItems;
};

export const fetchOrderBootstrap = async (
  menuId: number,
  orderType: string
): Promise<OrderBootstrapPayload> => {
  const channelParam = encodeURIComponent((orderType || 'pos').toLowerCase());
  const primaryRes = await fetch(`${API_URL}/menus/${menuId}/structure?channel=${channelParam}`, {
    cache: 'no-store' as RequestCache,
  });
  if (!primaryRes.ok) {
    throw new Error(`Failed to fetch menu structure (${primaryRes.status})`);
  }
  let categoriesRaw: any[] = await primaryRes.json();

  const hasItems =
    Array.isArray(categoriesRaw) &&
    categoriesRaw.some(cat => Array.isArray(cat.items) && cat.items.length > 0);
  if (!hasItems) {
    const fallbackRes = await fetch(`${API_URL}/menus/${menuId}/structure`, {
      cache: 'no-store' as RequestCache,
    });
    if (fallbackRes.ok) {
      categoriesRaw = await fallbackRes.json();
    }
  }

  const categories = normalizeCategories(categoriesRaw, menuId).sort(
    (a, b) => (a.sort_order || 0) - (b.sort_order || 0)
  );
  const menuItems = flattenMenuItems(categories);

  let modifierGroups: any[] = [];
  try {
    const modifierRes = await fetch(`${API_URL}/modifier-groups`, { cache: 'no-store' as RequestCache });
    if (modifierRes.ok) {
      modifierGroups = await modifierRes.json();
    }
  } catch {
    modifierGroups = [];
  }

  return {
    menuId,
    orderType: orderType || 'pos',
    fetchedAt: Date.now(),
    categories,
    menuItems,
    modifierGroups,
  };
};

export const ensureOrderBootstrap = async (menuId: number | null, orderType: string = 'pos') => {
  if (!menuId) return;
  if (typeof window === 'undefined') return;

  const existing = readOrderBootstrap();
  if (
    existing &&
    existing.menuId === menuId &&
    existing.orderType === (orderType || 'pos') &&
    Date.now() - existing.fetchedAt < ORDER_BOOTSTRAP_TTL
  ) {
    return;
  }

  try {
    const payload = await fetchOrderBootstrap(menuId, orderType);
    serialize(payload);
  } catch (error) {
    console.warn('Failed to prefetch order bootstrap data:', error);
  }
};

