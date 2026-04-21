/** Sales 테이블맵 ↔ 우측 투고 패널 가로 비율 (localStorage) */
export const TABLE_MAP_TOGO_PANEL_SPLIT_KEY = 'tableMapTogoPanelSplit';

/** Bistro(`/bistro`) 테이블맵 좌측 너비 % — localStorage에 정수 문자열(5% 단위). FSR 투고와 분리 */
export const TABLE_MAP_BISTRO_PANEL_SPLIT_KEY = 'tableMapBistroPanelSplit';

export const BISTRO_TABLE_MAP_LEFT_PCT_DEFAULT = 60;
export const BISTRO_TABLE_MAP_LEFT_PCT_MIN = 30;
export const BISTRO_TABLE_MAP_LEFT_PCT_MAX = 85;
export const BISTRO_TABLE_MAP_LEFT_PCT_STEP = 5;

/** 이전 프리셋 문자열 → 테이블맵 좌측 % (마이그레이션) */
const LEGACY_BISTRO_PRESET_TO_LEFT: Record<string, number> = {
  '34-66': 34,
  '50-50': 50,
  '66-34': 66,
  '70-30': 70,
};

export type TableMapTogoPanelSplitPreset = '34-66' | '50-50' | '66-34' | '70-30' | '75-25';

const ALL_PRESET_VALUES: TableMapTogoPanelSplitPreset[] = ['34-66', '50-50', '66-34', '70-30', '75-25'];

const PRESET_LEFT_PCT: Record<TableMapTogoPanelSplitPreset, number> = {
  '34-66': 34,
  '50-50': 50,
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

function isValidTogoSplitPreset(raw: string | null): raw is TableMapTogoPanelSplitPreset {
  return raw != null && (ALL_PRESET_VALUES as string[]).includes(raw);
}

export function readTableMapTogoPanelSplitFromStorage(): TableMapTogoPanelSplitPreset {
  try {
    const raw = localStorage.getItem(TABLE_MAP_TOGO_PANEL_SPLIT_KEY);
    if (isValidTogoSplitPreset(raw)) return raw;
  } catch {
    /* ignore */
  }
  return '70-30';
}

export function clampSnapBistroTableMapLeftPct(n: number): number {
  const s = BISTRO_TABLE_MAP_LEFT_PCT_STEP;
  const rounded = Math.round(n / s) * s;
  return Math.max(BISTRO_TABLE_MAP_LEFT_PCT_MIN, Math.min(BISTRO_TABLE_MAP_LEFT_PCT_MAX, rounded));
}

/** 테이블맵(좌) 너비 % — 기본 60 (= 탭패널 40%) */
export function readBistroTableMapLeftPercentFromStorage(): number {
  try {
    const raw = localStorage.getItem(TABLE_MAP_BISTRO_PANEL_SPLIT_KEY);
    if (raw != null && raw !== '') {
      const legacy = LEGACY_BISTRO_PRESET_TO_LEFT[raw];
      if (legacy != null) return clampSnapBistroTableMapLeftPct(legacy);
      const num = Number(raw);
      if (Number.isFinite(num)) return clampSnapBistroTableMapLeftPct(num);
    }
  } catch {
    /* ignore */
  }
  return BISTRO_TABLE_MAP_LEFT_PCT_DEFAULT;
}

export function persistBistroTableMapLeftPercent(leftPct: number): number {
  const v = clampSnapBistroTableMapLeftPct(leftPct);
  try {
    localStorage.setItem(TABLE_MAP_BISTRO_PANEL_SPLIT_KEY, String(v));
    notifyTableMapTogoPanelSplitChanged();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: TABLE_MAP_BISTRO_PANEL_SPLIT_KEY,
          newValue: String(v),
          url: window.location.href,
        } as StorageEventInit)
      );
    }
  } catch {
    /* ignore */
  }
  return v;
}

/** + 버튼: 탭패널 넓히기 → 테이블맵 좌측 % 감소 */
export function adjustBistroTableMapLeftPercentWidenTabPanel(): number {
  const cur = readBistroTableMapLeftPercentFromStorage();
  return persistBistroTableMapLeftPercent(cur - BISTRO_TABLE_MAP_LEFT_PCT_STEP);
}

/** − 버튼: 탭패널 좁히기 → 테이블맵 좌측 % 증가 */
export function adjustBistroTableMapLeftPercentNarrowTabPanel(): number {
  const cur = readBistroTableMapLeftPercentFromStorage();
  return persistBistroTableMapLeftPercent(cur + BISTRO_TABLE_MAP_LEFT_PCT_STEP);
}

export function bistroPanelUiScaleFromLeftPct(rightPanelVisible: boolean, leftPct: number): number {
  if (!rightPanelVisible) return 1;
  const rightPct = 100 - leftPct;
  return rightPct / 34;
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
