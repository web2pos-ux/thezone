/**
 * table-orders/submit 의 `source` 필드용.
 * Sub POS 브라우저는 sub-pos-mode-active, 핸드헬드는 handheld-mode-active 기준.
 */

const SUB_POS_MODE_KEY = 'sub-pos-mode-active';
const HANDHELD_MODE_KEY = 'handheld-mode-active';

export type TableOrderSubmitSource = 'TABLE_QR' | 'HANDHELD' | 'SUB_POS';

export function getTableOrderSubmitSource(): TableOrderSubmitSource {
  try {
    const subRaw = localStorage.getItem(SUB_POS_MODE_KEY);
    if (subRaw) {
      const sub = JSON.parse(subRaw) as { active?: boolean };
      if (sub.active === true) return 'SUB_POS';
    }
  } catch {}
  try {
    const hhRaw = localStorage.getItem(HANDHELD_MODE_KEY);
    if (hhRaw) {
      const hh = JSON.parse(hhRaw) as { active?: boolean };
      if (hh.active === true) return 'HANDHELD';
    }
  } catch {}
  return 'TABLE_QR';
}
