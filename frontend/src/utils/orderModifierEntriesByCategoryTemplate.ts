/**
 * 카테고리 레이아웃 템플릿에 등장한 순서대로 엔트리를 재정렬하고,
 * 템플릿에 없는 옵션은 원래 배열에서의 상대 순서를 유지해 뒤에 붙입니다.
 *
 * fetchCategoryModifiers(카테고리만 선택)와 fetchItemModifiers(아이템 선택)는
 * 그룹 병합 순서가 달라 flatten 순서가 달라질 수 있어, 주문 화면에서 동일 템플릿을 쓰더라도
 * 버튼 순서가 어긋나지 않도록 합니다.
 */
export function orderModifierEntriesByCategoryTemplate<T extends { id: string }>(
  entries: T[],
  categoryTemplate: string[] | undefined | null
): T[] {
  if (!entries.length) return entries;
  if (!categoryTemplate || !Array.isArray(categoryTemplate) || categoryTemplate.length === 0) {
    return entries;
  }
  const byId = new Map<string, T>();
  for (const e of entries) {
    const id = String(e.id);
    if (!id) continue;
    if (!byId.has(id)) {
      byId.set(id, e);
    }
  }
  const seen = new Set<string>();
  const out: T[] = [];
  for (const raw of categoryTemplate) {
    const id = String(raw);
    if (!id || id.startsWith('EMPTY:')) continue;
    const e = byId.get(id);
    if (e) {
      out.push(e);
      seen.add(id);
    }
  }
  for (const e of entries) {
    const id = String(e.id);
    if (!id) continue;
    if (!seen.has(id)) {
      out.push(e);
      seen.add(id);
    }
  }
  return out;
}
