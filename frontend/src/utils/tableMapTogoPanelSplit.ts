/** Sales 테이블맵 ↔ 우측 투고 패널 가로 비율 (localStorage) */
export const TABLE_MAP_TOGO_PANEL_SPLIT_KEY = 'tableMapTogoPanelSplit';

export type TableMapTogoPanelSplitPreset = '66-34' | '70-30' | '75-25';

const PRESET_LEFT_PCT: Record<TableMapTogoPanelSplitPreset, number> = {
  '66-34': 66,
  '70-30': 70,
  '75-25': 75,
};

export const TABLE_MAP_TOGO_PANEL_SPLIT_OPTIONS: {
  value: TableMapTogoPanelSplitPreset;
  label: string;
}[] = [
  { value: '66-34', label: '66 : 34' },
  { value: '70-30', label: '70 : 30' },
  { value: '75-25', label: '75 : 25' },
];

export function readTableMapTogoPanelSplitFromStorage(): TableMapTogoPanelSplitPreset {
  try {
    const raw = localStorage.getItem(TABLE_MAP_TOGO_PANEL_SPLIT_KEY);
    if (raw === '66-34' || raw === '70-30' || raw === '75-25') return raw;
  } catch {
    /* ignore */
  }
  return '70-30';
}

export function leftPercentFromSplitPreset(preset: TableMapTogoPanelSplitPreset): number {
  return PRESET_LEFT_PCT[preset];
}

/** BO/레이아웃 기준 우측 폭 34% 대비 실제 우측 비율로 투고 UI 밀도 스케일 */
export function togoPanelUiScaleFromPresets(
  rightPanelVisible: boolean,
  preset: TableMapTogoPanelSplitPreset
): number {
  if (!rightPanelVisible) return 1;
  const left = leftPercentFromSplitPreset(preset);
  const rightPct = 100 - left;
  return rightPct / 34;
}

export const TABLE_MAP_TOGO_PANEL_SPLIT_CHANGED_EVENT = 'tableMapTogoPanelSplitChanged';

export function notifyTableMapTogoPanelSplitChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent(TABLE_MAP_TOGO_PANEL_SPLIT_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
}
