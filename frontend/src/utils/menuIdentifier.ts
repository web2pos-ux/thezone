const DEFAULT_MENU_STORAGE_KEY = 'defaultMenuId';
const DEFAULT_STORE_KEY = 'storeId';
const FOH_MENU_KEY = 'foh_default_menu';

export interface MenuIdentifierResult {
  storeId: string;
  menuId: string;
  menuName?: string;
}

export async function resolveMenuIdentifiers(apiUrl: string): Promise<MenuIdentifierResult> {
  let storeId = localStorage.getItem(DEFAULT_STORE_KEY);
  if (!storeId || storeId === 'null') {
    storeId = '1';
    localStorage.setItem(DEFAULT_STORE_KEY, '1');
  }

  let menuId = localStorage.getItem(DEFAULT_MENU_STORAGE_KEY);
  let menuName: string | undefined;

  if (!menuId || menuId === 'null') {
    const foh = localStorage.getItem(FOH_MENU_KEY);
    if (foh) {
      try {
        const data = JSON.parse(foh);
        if (data?.menuId) {
          menuId = String(data.menuId);
          menuName = data.menuName;
        }
      } catch {
        // ignore parse errors
      }
    }
  }

  if (!menuId || menuId === 'null') {
    const menusRes = await fetch(`${apiUrl}/api/menus`, { cache: 'no-store' });
    if (menusRes.ok) {
      const menus = await menusRes.json();
      if (Array.isArray(menus) && menus.length > 0) {
        menuId = menus[0].menu_id ? menus[0].menu_id.toString() : '1';
        menuName = menus[0].name || 'Default Menu';
      }
    }
  }

  if (!menuId || menuId === 'null') {
    menuId = '1';
  }

  localStorage.setItem(DEFAULT_MENU_STORAGE_KEY, menuId);
  if (menuName) {
    localStorage.setItem(
      FOH_MENU_KEY,
      JSON.stringify({ menuId: Number(menuId), menuName })
    );
  }

  return { storeId, menuId, menuName };
}

