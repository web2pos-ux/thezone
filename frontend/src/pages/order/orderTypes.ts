export interface OrderItem {
  id: string;
  orderLineId?: string; // unique per UI row (menu id + timestamp/random), used for selection and edits
  name: string;
  short_name?: string;
  quantity: number;
  price: number;
  modifiers?: {
    groupId: string;
    groupName: string;
    modifierIds: string[];
    modifierNames: string[];
    selectedEntries?: { id: string; name: string; price_delta: number }[];
    totalModifierPrice: number;
  }[];
  totalPrice: number;
  type?: 'item' | 'separator' | 'discount' | 'void';
  guestNumber?: number;
  priceSource?: 'open' | 'fixed';
  note?: string | null;
  taxGroupId?: number | null;
  printerGroupId?: number | null;
  memo?: { text: string; price: number } | undefined;
  discount?: {
    type: string;
    percentage: number;
    mode: 'percent';
    value: number;
  } | undefined;
  // Evenly shared indicator: when present, UI can render as 1/splitDenominator
  splitDenominator?: number;
  // Share Evenly attempt sequence for ordering within lists
  splitOrder?: number;
}

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  category: string;
  color: string;
  category_id?: number;
  description?: string;
  is_available?: boolean;
  sort_order?: number;
  short_name?: string;
}

export interface Category {
  category_id: number;
  name: string;
  menu_id: number;
  sort_order: number;
  items: MenuItem[];
  menu_name?: string;
}

export interface LayoutSettings {
  leftPanelWidth: number;
  rightPanelWidth: number;
  screenAspect: '4:3' | '16:9';
  screenResolution: string;
  categoryRows: number;
  categoryColumns: number;
  categoryHeight: number;
  categoryWidth: number;
  categoryFontSize: number;
  categoryNormalColor: string;
  categorySelectedColor: string;
  categoryFontBold?: boolean;
  mergedGroups?: Array<{ id: string; name: string; categoryNames: string[] }>;
  categoryBarOrder?: string[];
  menuGridColumns: number;
  menuItemHeight: number;
  menuFontSize: number;
  menuFontBold?: boolean;
  menuDefaultColor: string;
  menuSelectedColor: string;
  showPrices: boolean;
  useShortName?: boolean;
  modifierRows: number;
  modifierColumns: number;
  modifierItemHeight: number;
  modifierFontSize: number;
  modifierFontBold?: boolean;
  modifierDefaultColor: string;
  modifierShowPrices: boolean;
  baseColor?: string;
  categoryAreaBgColor?: string;
  menuAreaBgColor?: string;
  modifierAreaBgColor?: string;
  selectServerOnEntry?: boolean;
  // Function Tab: Void settings (simplified + internationalized)
  voidThreshold?: number; // displayed threshold in current profile scale (kept for backward compatibility)
  voidRequireManager?: boolean; // legacy, ignored
  voidCurrencyProfile?: string; // e.g., 'US','KR','JP','EU'
  voidBaseThresholdUSD?: number; // internal base threshold in USD-equivalent
  // Extra buttons placement by id within visible capacity (0-based)
  extraButtonPositions?: { [id: string]: number };
  // In-app soft keyboard languages (Function Tab)
  keyboardLanguages?: string[];
  // Show all categories grouped in menu grid (like modifier extra modal)
  showAllCategoriesGrouped?: boolean;
  // Modifier layout by item (drag order)
  modifierLayoutByItem?: Record<string, string[]>;
  // Modifier Extra Button 1 settings
  modExtra1Enabled?: boolean;
  modExtra1Name?: string;
  modExtra1Amount?: number;
  modExtra1Color?: string;
  modExtra1Tabs?: Array<{
    id: string;
    name: string;
    defaultColor: string;
    gridCols: number;
    groups: Array<{
      id: string;
      name: string;
      color: string;
      buttons: Array<{ name: string; amount: number; color: string; enabled: boolean }>;
    }>;
  }>;
  // Modifier Extra Button 2 settings
  modExtra2Enabled?: boolean;
  modExtra2Name?: string;
  modExtra2Amount?: number;
  modExtra2Color?: string;
  modExtra2Tabs?: Array<{
    id: string;
    name: string;
    defaultColor: string;
    gridCols: number;
    groups: Array<{
      id: string;
      name: string;
      color: string;
      buttons: Array<{ name: string; amount: number; color: string; enabled: boolean }>;
    }>;
  }>;
} 