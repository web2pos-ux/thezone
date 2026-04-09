import { mergeCategoryAndDirectModifierGroupIds } from './mergeModifierGroupIds';
import { orderModifierEntriesByCategoryTemplate } from './orderModifierEntriesByCategoryTemplate';

/**
 * Order 화면 fetchItemModifiers와 동일한 규칙으로 아이템 모디파이어 목록을 구성합니다.
 * Order Screen Manager가 잘못된 GET /items/:id/options/modifier(미구현) 대신 이 경로를 써야
 * 저장된 슬롯 ID가 주문 화면 combinedEntries와 일치합니다.
 */
export type ComposedModifierEntry = {
  id: string;
  label: string;
  groupId: string;
  price: number;
};

export async function fetchComposedModifierEntries(
  apiUrl: string,
  itemId: string,
  categoryId: number,
  categoryModifierTemplate?: string[]
): Promise<ComposedModifierEntry[]> {
  try {
    const [itemsResp, catModsResp, allGroupsResp] = await Promise.all([
      fetch(`${apiUrl}/menu/items?categoryId=${categoryId}`),
      fetch(`${apiUrl}/menu/categories/${categoryId}/modifiers`),
      fetch(`${apiUrl}/modifier-groups`),
    ]);
    if (!itemsResp.ok || !catModsResp.ok || !allGroupsResp.ok) return [];

    const itemsData: any[] = await itemsResp.json();
    const catModsData: any[] = await catModsResp.json();
    const allGroupsData: any[] = await allGroupsResp.json();

    const itemRow = itemsData.find(r => String(r.item_id || r.id) === String(itemId));
    const directGroupIds: number[] = Array.isArray(itemRow?.modifier_groups)
      ? itemRow!.modifier_groups.map((n: any) => Number(n)).filter((n: number) => !Number.isNaN(n))
      : [];
    const inheritedGroupIds: number[] = Array.isArray(catModsData)
      ? catModsData.map((r: any) => Number(r.modifier_group_id)).filter((n: number) => !Number.isNaN(n))
      : [];

    const groupById: { [id: number]: any } = {};
    (allGroupsData || []).forEach((g: any) => {
      groupById[Number(g.id || g.group_id)] = g;
    });

    const usedGroupIds: number[] = mergeCategoryAndDirectModifierGroupIds(
      inheritedGroupIds,
      directGroupIds
    );

    const entries: ComposedModifierEntry[] = [];
    for (const gid of usedGroupIds) {
      const g = groupById[gid];
      if (!g) continue;
      const options = g.options || g.modifiers || [];
      for (const opt of options) {
        const rawId = opt.modifier_id ?? opt.option_id ?? opt.id;
        if (rawId == null && rawId !== 0) continue;
        const id = String(rawId);
        entries.push({
          id,
          label: String(opt.name || opt.option_name || ''),
          groupId: String(gid),
          price: Number(opt.price_delta ?? opt.price_adjustment ?? 0),
        });
      }
    }
    return orderModifierEntriesByCategoryTemplate(entries, categoryModifierTemplate);
  } catch {
    return [];
  }
}
