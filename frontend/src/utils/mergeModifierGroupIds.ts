/**
 * 카테고리에 연결된 그룹을 먼저(중복 제거), 이어서 아이템에만 연결된 직접 그룹을 붙입니다.
 * Order 화면 fetchItemModifiers / composedModifierEntries와 동일 규칙을 유지합니다.
 */
export function mergeCategoryAndDirectModifierGroupIds(
  inheritedGroupIds: number[],
  directGroupIds: number[]
): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const gid of inheritedGroupIds) {
    const n = Number(gid);
    if (Number.isNaN(n) || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  for (const gid of directGroupIds) {
    const n = Number(gid);
    if (Number.isNaN(n) || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}
