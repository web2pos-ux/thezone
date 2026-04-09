export const MODIFIER_LAYOUT_EXPLICIT_ITEM_IDS_LS_KEY = 'orderModifierExplicitLayoutItemIds';

export function loadModifierLayoutExplicitItemIdsFromStorage(): Set<string> {
  try {
    const raw = localStorage.getItem(MODIFIER_LAYOUT_EXPLICIT_ITEM_IDS_LS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

export function persistModifierLayoutExplicitItemIds(ids: Set<string>) {
  try {
    localStorage.setItem(MODIFIER_LAYOUT_EXPLICIT_ITEM_IDS_LS_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // ignore
  }
}
