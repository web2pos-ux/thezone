import { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutSettings } from '../pages/order/orderTypes';
import { API_URL } from '../config/constants';

export interface UseLayoutSettingsResult {
  layoutSettings: LayoutSettings;
  setLayoutSettings: React.Dispatch<React.SetStateAction<LayoutSettings>>;
  updateLayoutSetting: (key: keyof LayoutSettings, value: any) => void;
  loadLayoutSettings: () => Promise<void>;
  saveLayoutSettings: (args?: {
    itemColors?: Record<string, string>;
    modifierColors?: Record<string, string>;
    modifierLayoutByItem?: Record<string, string[]>;
    modifierLayoutByCategory?: Record<number, string[]> | Record<string, string[]>;
    categoryOrder?: number[];
    menuItemOrderByCategory?: Record<number, string[]>;
    selectServerOnEntry?: boolean;
  }) => Promise<void>;
  resetLayoutSettings: () => void;
  modifierColors: Record<string, string>;
  setModifierColors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  modifierColorsLoaded: boolean;
  modifierLayoutByItem: Record<string, string[]>;
  setModifierLayoutByItem: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  modifierLayoutLoaded: boolean;
}

// 화면 크기에 맞는 해상도와 비율 자동 감지
const detectScreenSettings = (): { screenAspect: '4:3' | '16:9', screenResolution: string } => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  
  // 비율 계산
  const ratio = width / height;
  
  // 4:3 비율 (1.33) vs 16:9 비율 (1.78)
  const screenAspect: '4:3' | '16:9' = ratio < 1.5 ? '4:3' : '16:9';
  
  // 실제 화면 크기를 해상도로 사용
  const screenResolution = `${width}x${height}`;
  
  console.log(`🖥️ [Auto-detect] Screen: ${width}x${height}, Ratio: ${ratio.toFixed(2)}, Aspect: ${screenAspect}`);
  
  return { screenAspect, screenResolution };
};

const defaultSettings: LayoutSettings = {
  leftPanelWidth: 30,
  rightPanelWidth: 70,
  screenAspect: '16:9',
  screenResolution: '1366x768',
  categoryRows: 2,
  categoryColumns: 8,
  categoryHeight: 45,
  categoryWidth: 110,
  categoryFontSize: 14,
  categoryNormalColor: 'bg-gray-200',
  categorySelectedColor: 'bg-blue-500',
  categoryFontBold: false,
  categoryFontExtraBold: false,
  mergedGroups: [],
  categoryBarOrder: [],
  menuGridColumns: 8,
  menuGridRows: 0,
  menuItemHeight: 80,
  menuFontSize: 12,
  menuFontBold: false,
  menuFontExtraBold: false,
  menuDefaultColor: 'bg-gray-200',
  menuSelectedColor: '#BDB76B',
  showPrices: true,
  useShortName: false,
  menuGridRowPattern: [4, 6, 3, 4],
  modifierRows: 3,
  modifierColumns: 4,
  modifierItemHeight: 60,
  modifierFontSize: 14,
  modifierFontBold: false,
  modifierFontExtraBold: false,
  modifierDefaultColor: 'bg-blue-600',
  modifierShowPrices: true,
  modifierRowPattern: [],
  baseColor: '#3B82F6',
  categoryAreaBgColor: '#f3f4f6',
  menuAreaBgColor: '#f9fafb',
  modifierAreaBgColor: '#f3f4f6',
  extraButtonPositions: {},
  keyboardLanguages: ['EN-US'],
  selectServerOnEntry: false,
  gratuityRate: 0,
  modExtra1Enabled: false,
  modExtra1Name: 'Modifier Extra 1',
  modExtra1Amount: 0,
  modExtra1Color: 'bg-indigo-700',
  modExtra1Tabs: [],
  modExtra2Enabled: false,
  modExtra2Name: 'Modifier Extra 2',
  modExtra2Amount: 0,
  modExtra2Color: 'bg-emerald-700',
  modExtra2Tabs: []
};

export function useLayoutSettings(initial?: Partial<LayoutSettings>): UseLayoutSettingsResult {
  const [layoutSettings, setLayoutSettings] = useState<LayoutSettings>({
    ...defaultSettings,
    ...(initial || {}),
  });
  const [modifierColors, setModifierColors] = useState<Record<string, string>>({});
  const [modifierColorsLoaded, setModifierColorsLoaded] = useState(false);
  const [modifierLayoutByItem, setModifierLayoutByItem] = useState<Record<string, string[]>>({});
  const [modifierLayoutLoaded, setModifierLayoutLoaded] = useState(false);

  const updateLayoutSetting = useCallback((key: keyof LayoutSettings, value: any) => {
    setLayoutSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  const modifierColorsRef = useRef(modifierColors);
  modifierColorsRef.current = modifierColors;
  const modifierLayoutRef = useRef(modifierLayoutByItem);
  modifierLayoutRef.current = modifierLayoutByItem;

  const saveLayoutSettings = useCallback(async (args?: {
    itemColors?: Record<string, string>;
    modifierColors?: Record<string, string>;
    modifierLayoutByItem?: Record<string, string[]>;
    modifierLayoutByCategory?: Record<number, string[]> | Record<string, string[]>;
    categoryOrder?: number[];
    menuItemOrderByCategory?: Record<number, string[]>;
    selectServerOnEntry?: boolean;
  }) => {
    let existing: Record<string, any> = {};
    try {
      const cur = await fetch(`${API_URL}/layout-settings`);
      if (cur.ok) {
        const r = await cur.json();
        if (r?.success && r?.data) existing = r.data;
      }
    } catch {}
    const currentModColors = modifierColorsRef.current;
    const modColorsToSave = args?.modifierColors || (Object.keys(currentModColors).length > 0 ? currentModColors : existing.modifierColors);
    const currentModLayout = modifierLayoutRef.current;
    const modLayoutToSave = args?.modifierLayoutByItem || (Object.keys(currentModLayout).length > 0 ? currentModLayout : existing.modifierLayoutByItem);
    const { modifierColors: _mc, modifierLayoutByItem: _ml, ...safeLayoutSettings } = layoutSettings as any;
    const payload: Record<string, any> = {
      ...existing,
      ...safeLayoutSettings,
      ...(args || {}),
      ...(modColorsToSave ? { modifierColors: modColorsToSave } : {}),
      ...(modLayoutToSave ? { modifierLayoutByItem: modLayoutToSave } : {}),
    };
    // JSON.stringify는 value가 undefined인 키를 제거함 → 레이아웃 전체 교체 저장 시 DB에서 필드가 사라질 수 있음
    const preserveIfUndefined = [
      'modifierLayoutByCategory',
      'menuItemOrderByCategory',
      'mergedGroups',
      'categoryBarOrder',
    ] as const;
    for (const key of preserveIfUndefined) {
      if (payload[key] === undefined && existing[key] !== undefined) {
        payload[key] = existing[key];
      }
    }
    const response = await fetch(`${API_URL}/layout-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Failed to save layout settings: ${response.status}`);
  }, [layoutSettings]);

  const loadLayoutSettings = useCallback(async () => {
    const response = await fetch(`${API_URL}/layout-settings`);
    if (!response.ok) throw new Error(`Failed to load layout settings: ${response.status}`);
    const result = await response.json();
    if (result?.success && result?.data) {
      const { itemColors, modifierColors: loadedModColors, modifierLayoutByItem: loadedModLayout, categoryOrder, ...layoutData } = result.data;
      setLayoutSettings(prev => ({ ...prev, ...layoutData }));
      if (loadedModColors && typeof loadedModColors === 'object' && Object.keys(loadedModColors).length > 0) {
        setModifierColors(loadedModColors);
      }
      // 빈 객체도 반드시 반영 — 서버에서 per-item 레이아웃이 비워진 경우(카테고리 템플릿만 쓸 때) stale 방지
      if (loadedModLayout && typeof loadedModLayout === 'object') {
        setModifierLayoutByItem(loadedModLayout);
      } else {
        setModifierLayoutByItem({});
      }
      setModifierColorsLoaded(true);
      setModifierLayoutLoaded(true);
    } else {
      // 저장된 설정이 없으면 자동 화면 감지 사용
      const detected = detectScreenSettings();
      console.log('🖥️ [Auto-detect] No saved settings, using detected screen size:', detected);
      setLayoutSettings(prev => ({ ...prev, ...detected }));
      
      // 감지된 설정을 자동 저장
      try {
        await fetch(`${API_URL}/layout-settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...defaultSettings, ...detected }),
        });
        console.log('✅ [Auto-detect] Screen settings saved to database');
      } catch (err) {
        console.warn('⚠️ [Auto-detect] Failed to save screen settings:', err);
      }
      setModifierColorsLoaded(true);
      setModifierLayoutLoaded(true);
    }
  }, []);

  const resetLayoutSettings = useCallback(() => {
    setLayoutSettings(defaultSettings);
  }, []);

  useEffect(() => {
    // no-op, consumer chooses when to load
  }, []);

  return {
    layoutSettings,
    setLayoutSettings,
    updateLayoutSetting,
    loadLayoutSettings,
    saveLayoutSettings,
    resetLayoutSettings,
    modifierColors,
    setModifierColors,
    modifierColorsLoaded,
    modifierLayoutByItem,
    setModifierLayoutByItem,
    modifierLayoutLoaded,
  };
} 