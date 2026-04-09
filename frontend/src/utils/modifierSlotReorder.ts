import { arrayMove } from '@dnd-kit/sortable';

export function isModifierLayoutEmptySlotId(id: string): boolean {
  return String(id).startsWith('EMPTY:');
}

export type ModifierSlotReorderOptions = {
  modifierColumns?: number;
  modifierRows?: number;
};

function slotRow(index: number, cols: number): number {
  return Math.floor(index / cols);
}

function newEmptyToken(atIndex: number): string {
  return `EMPTY:mod:${atIndex}:${Date.now()}`;
}

function findLastEmptyIndex(ids: string[]): number {
  for (let i = ids.length - 1; i >= 0; i--) {
    if (isModifierLayoutEmptySlotId(ids[i])) return i;
  }
  return -1;
}

/**
 * 행이 바뀌는 실제 모디 이동: 출발 칸은 EMPTY로 두고, over 앞에 삽입한 뒤 배열 길이는 원본과 동일하게 유지한다.
 */
function reorderCrossRowNonEmpty(current: string[], oldIdx: number, newIdx: number): string[] {
  const activeId = current[oldIdx];
  const overId = current[newIdx];
  const next = current.slice();
  const targetLen = next.length;
  next[oldIdx] = newEmptyToken(oldIdx);
  const insertIdx = next.indexOf(overId);
  if (insertIdx === -1) {
    return arrayMove(current, oldIdx, newIdx);
  }
  next.splice(insertIdx, 0, activeId);
  while (next.length > targetLen) {
    const ri = findLastEmptyIndex(next);
    if (ri === -1) {
      next.pop();
      continue;
    }
    next.splice(ri, 1);
  }
  while (next.length < targetLen) {
    next.push(newEmptyToken(next.length));
  }
  return next;
}

/**
 * Modifier 그리드 슬롯 id 배열을 드래그(oldIdx → newIdx, over 기준)에 맞게 재정렬한다.
 * opts에 modifierColumns/Rows가 있으면 행 경계를 알 수 있을 때,
 * 실제 모디를 다른 행으로 옮기면 출발 칸은 EMPTY로 남기고 over 앞에 삽입한다.
 * 같은 행에서는 arrayMove 후, 왼쪽으로 끌 때 trailing EMPTY 흡수 규칙을 적용한다.
 */
export function reorderModifierSlotIds(
  current: string[],
  oldIdx: number,
  newIdx: number,
  opts?: ModifierSlotReorderOptions
): string[] {
  const n = current.length;
  if (n === 0) return [];
  if (oldIdx < 0 || newIdx < 0 || oldIdx >= n || newIdx >= n || oldIdx === newIdx) {
    return current.slice();
  }

  const cols = opts?.modifierColumns != null ? Math.max(1, Math.floor(Number(opts.modifierColumns)) || 1) : 0;
  const rows = opts?.modifierRows != null ? Math.max(1, Math.floor(Number(opts.modifierRows)) || 1) : 0;
  const activeId = current[oldIdx];

  if (
    cols >= 1 &&
    rows >= 1 &&
    !isModifierLayoutEmptySlotId(activeId) &&
    slotRow(oldIdx, cols) !== slotRow(newIdx, cols)
  ) {
    return reorderCrossRowNonEmpty(current, oldIdx, newIdx);
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
