import { arrayMove } from '@dnd-kit/sortable';

export function isModifierLayoutEmptySlotId(id: string): boolean {
  return String(id).startsWith('EMPTY:');
}

/**
 * Modifier 그리드 슬롯 id 배열을 드래그(oldIdx → newIdx, over 기준)에 맞게 재정렬한다.
 * 왼쪽으로 끌어올릴 때, 원래 드래그 출발지(oldIdx) 오른쪽에 EMPTY 슬롯이 있으면
 * 그중 drop 대상(over) 뒤에서 첫 EMPTY 하나를 제거해 “빈칸이 밀림”을 흡수하고,
 * 그 너머 실제 모디파이어는 저장 레이아웃에서 불필요하게 밀리지 않게 한다.
 */
export function reorderModifierSlotIds(current: string[], oldIdx: number, newIdx: number): string[] {
  const n = current.length;
  if (n === 0) return [];
  if (oldIdx < 0 || newIdx < 0 || oldIdx >= n || newIdx >= n || oldIdx === newIdx) {
    return current.slice();
  }

  let result = arrayMove(current, oldIdx, newIdx);

  if (oldIdx > newIdx) {
    const hadEmptyRight = current.some((id, i) => isModifierLayoutEmptySlotId(id) && i > oldIdx);
    if (hadEmptyRight) {
      const overId = current[newIdx];
      const overPos = result.indexOf(overId);
      if (overPos !== -1) {
        const fi = result.findIndex((id, i) => isModifierLayoutEmptySlotId(id) && i > overPos);
        if (fi !== -1) {
          result = result.slice();
          result.splice(fi, 1);
        }
      }
    }
  }

  return result;
}
