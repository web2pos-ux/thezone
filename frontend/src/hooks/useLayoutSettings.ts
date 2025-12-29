import { useCallback, useEffect, useState } from 'react';
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
    categoryOrder?: number[];
    menuItemOrderByCategory?: Record<number, string[]>;
  }) => Promise<void>;
  resetLayoutSettings: () => void;
}

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
  mergedGroups: [],
  categoryBarOrder: [],
  menuGridColumns: 8,
  menuItemHeight: 80,
  menuFontSize: 12,
  menuFontBold: false,
  menuDefaultColor: 'bg-gray-200',
  menuSelectedColor: '#BDB76B',
  showPrices: true,
  useShortName: false,
  modifierRows: 3,
  modifierColumns: 4,
  modifierItemHeight: 60,
  modifierFontSize: 14,
  modifierFontBold: false,
  modifierDefaultColor: 'bg-blue-600',
  modifierShowPrices: true,
  baseColor: '#3B82F6',
  categoryAreaBgColor: '#f3f4f6',
  menuAreaBgColor: '#f9fafb',
  modifierAreaBgColor: '#f3f4f6',
  extraButtonPositions: {},
  keyboardLanguages: ['EN-US'],
  selectServerOnEntry: true,
  modifierLayoutByItem: {},
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

  const updateLayoutSetting = useCallback((key: keyof LayoutSettings, value: any) => {
    setLayoutSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  const saveLayoutSettings = useCallback(async (args?: {
    itemColors?: Record<string, string>;
    modifierColors?: Record<string, string>;
    modifierLayoutByItem?: Record<string, string[]>;
    categoryOrder?: number[];
    menuItemOrderByCategory?: Record<number, string[]>;
  }) => {
    const payload = {
      ...layoutSettings,
      ...(args || {}),
    };
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
      const { itemColors, modifierColors, modifierLayoutByItem, categoryOrder, menuItemOrderByCategory, ...layoutData } = result.data;
      setLayoutSettings(prev => ({ ...prev, ...layoutData }));
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
  };
} 