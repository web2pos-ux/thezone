import { Category, MenuItem } from '../pages/order/orderTypes';

export interface ModifierGroup {
  id: number;
  modifier_group_id?: number;
  name: string;
  modifiers?: any[];
  [key: string]: any;
}

export interface MenuCachePayload {
  categories: Category[];
  menuItems: MenuItem[];
  modifierGroups: ModifierGroup[];
}

export async function fetchMenuStructure(
  apiUrl: string,
  menuId: string,
  storeId: string
): Promise<MenuCachePayload> {
  const [structureRes, modifiersRes] = await Promise.all([
    fetch(`${apiUrl}/api/menus/${menuId}/structure`, { cache: 'no-store' }),
    fetch(`${apiUrl}/api/modifier-groups?store_id=${storeId}`, { cache: 'no-store' })
  ]);

  if (!structureRes.ok || !modifiersRes.ok) {
    throw new Error('Failed to fetch menu data from server');
  }

  const [structureData, modifiersData] = await Promise.all([
    structureRes.json(),
    modifiersRes.json()
  ]);

  const categories: Category[] = (structureData || []).map((c: any) => ({
    ...c,
    category_id: c.category_id || c.id,
    id: c.id || c.category_id,
    menu_id: c.menu_id || Number(menuId),
    sort_order: c.sort_order || 0,
    items: c.items || []
  }));

  const menuItems: MenuItem[] = [];
  categories.forEach((category: any) => {
    if (Array.isArray(category.items)) {
      category.items.forEach((item: any) => {
        menuItems.push({
          id: item.item_id?.toString() || item.id?.toString() || '',
          name: item.name || '',
          price: item.price || 0,
          category: category.name || '',
          color: item.color || '#808080',
          category_id: category.category_id,
          description: item.description,
          is_available: item.is_available === 1 || item.is_available === true,
          sort_order: item.sort_order,
          short_name: item.short_name
        });
      });
    }
  });

  const modifierGroups: ModifierGroup[] = (modifiersData || []).map((mg: any) => ({
    ...mg,
    id: mg.modifier_group_id || mg.id
  }));

  return { categories, menuItems, modifierGroups };
}

