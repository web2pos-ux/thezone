/**
 * Category-level modifier layout from Order Screen Manager (JSON keys may be string or number).
 */
export function getModifierLayoutForCategory(
  byCategory: unknown,
  categoryId: number
): string[] | undefined {
  if (!byCategory || typeof byCategory !== 'object') return undefined;
  const o = byCategory as Record<string, unknown>;
  const raw =
    o[String(categoryId)] ??
    (o as any)[categoryId] ??
    o[String(Number(categoryId))];
  if (Array.isArray(raw) && raw.length > 0) return raw as string[];
  const sid = String(categoryId);
  for (const k of Object.keys(o)) {
    if (String(k) === sid || Number(k) === categoryId) {
      const v = o[k];
      if (Array.isArray(v) && v.length > 0) return v as string[];
    }
  }
  return undefined;
}

/**
 * Apply category-level modifier slot template to an item's available modifiers.
 * Keeps template order for ids that exist on this item; keeps EMPTY:* tokens from template;
 * appends item-only modifiers not in template (entry order).
 */
export function applyModifierLayoutTemplate(
  template: string[] | undefined,
  entries: Array<{ id: string }>
): string[] | undefined {
  if (!template || !Array.isArray(template) || template.length === 0) return undefined;
  /** 모디파이어 fetch 전에도 카테고리 템플릿 순서를 유지 (병합은 데이터 도착 후 다음 렌더에서 수행) */
  if (!entries || entries.length === 0) {
    return template.map(v => String(v));
  }
  const available = new Set(entries.map(e => String(e.id)));
  const entryOrder = entries.map(e => String(e.id));
  const result: string[] = [];
  for (const val of template) {
    const v = String(val);
    if (v.startsWith('EMPTY:')) {
      result.push(v);
    } else if (available.has(v)) {
      result.push(v);
    }
  }
  for (const id of entryOrder) {
    if (!result.includes(id)) {
      result.push(id);
    }
  }
  return result;
}

export interface CategoryRefForModifierLayout {
  category_id: number;
  name: string;
}

/**
 * 카테고리만 선택한 상태에서 바꾼 모디파이어 순서는 modifierLayoutByItem['__cat_<id>']에만 남는 경우가 많음.
 * 아이템을 눌렀을 때도 같은 순서를 쓰려면 이 키를 DB의 modifierLayoutByCategory보다 우선한다.
 */
export function resolveCategoryModifierTemplateForOrderScreen(
  categoryId: number | undefined | null,
  selectedCategoryName: string | undefined,
  modifierLayoutByCategory: unknown,
  modifierLayoutByItem: Record<string, string[]>
): string[] | undefined {
  const keys: string[] = [];
  if (categoryId != null && !Number.isNaN(Number(categoryId))) {
    keys.push(`__cat_${Number(categoryId)}`);
  }
  if (selectedCategoryName) {
    const alt = `__cat_${selectedCategoryName}`;
    if (!keys.includes(alt)) keys.push(alt);
  }
  for (const k of keys) {
    const v = modifierLayoutByItem[k];
    if (Array.isArray(v) && v.length > 0) return v.map(String);
  }
  if (categoryId != null && !Number.isNaN(Number(categoryId))) {
    return getModifierLayoutForCategory(modifierLayoutByCategory, Number(categoryId));
  }
  return undefined;
}

/** __cat_<id> 또는 __cat_<이름> 레이아웃 키에서 category_id 숫자를 뽑는다. */
export function parseCategoryIdFromModifierCatLayoutKey(
  layoutKey: string,
  categories: CategoryRefForModifierLayout[]
): number | undefined {
  const m = /^__cat_(.+)$/.exec(String(layoutKey));
  if (!m) return undefined;
  const tail = m[1];
  const n = Number(tail);
  if (!Number.isNaN(n)) return n;
  const c = categories.find(x => x.name === tail);
  if (c) return Number(c.category_id);
  return undefined;
}
