export interface SortableItem {
  id: number;
  name: string;
  sort_order?: number;
}

export interface Menu {
  menu_id: number;
  name: string;
  description: string;
  is_active: number;
  created_at: string;
  sales_channels?: string[];
}

export interface Item {
  item_id: number;
  name: string;
  description: string;
  price: number;
  category_id: number;
  sort_order: number;
  short_name: string;
  image_url?: string;
}

export interface Category extends SortableItem {
  category_id: number;
  name: string;
  menu_id: number;
  sort_order: number;
  items: Item[];
  is_active?: boolean;
  image_url?: string;
}

// Tax System Types (exactly as used in TaxGroupManager)
export interface Tax {
  tax_id: number;
  name: string;
  rate: number;
}

export interface TaxGroup {
  id: number;
  group_id: number;
  name: string;
  taxes: Tax[];
}

// Printer System Types (matching Tax pattern exactly)
export interface Printer {
  printer_id: number;
  name: string;
  type: string; // 'RECEIPT' | 'KDS' | 'ORDER' | 'LABEL' | 'OTHER'
  ip_address?: string;
}

export interface PrinterGroup {
  id: number;
  group_id: number;
  name: string;
  printers: Printer[];
}

// Legacy interfaces for backward compatibility
// export interface ModifierGroup extends SortableItem {}

// === NEW MODIFIER TYPES ===
export interface ModifierOption {
  option_id: number;        // modifier_id와 매핑
  modifier_id?: number;     // 백엔드 호환성
  name: string;
  price_adjustment: number; // price_delta와 매핑
  is_default: boolean;      // 기본 선택 여부
  sort_order?: number;
}

export interface ModifierGroup {
  id: number;              // group_id와 매핑
  group_id: number;        // 백엔드 호환성
  name: string;
  description?: string;    // 그룹 설명
  tags?: string;           // 태그 (30개 미만 예상)
  menu_category?: string;  // 메뉴 카테고리
  selection_type: 'SINGLE' | 'MULTIPLE';
  min_selections: number;  // min_selection과 매핑
  max_selections: number;  // max_selection과 매핑
  is_required: boolean;    // Required/Optional 구분
  options: ModifierOption[];
}

// Required/Optional 헬퍼 함수들
export const getRequirementIcon = (group: ModifierGroup): string => {
  return group.min_selections > 0 ? '��' : '⚪';
};

export const getSelectionRuleText = (group: ModifierGroup): string => {
  const { min_selections, max_selections } = group;
  return min_selections === max_selections 
    ? `${min_selections}개 선택`
    : `${min_selections}-${max_selections}개 선택`;
};

export const getRequirementType = (group: ModifierGroup): 'REQUIRED' | 'OPTIONAL' => {
  return group.min_selections > 0 ? 'REQUIRED' : 'OPTIONAL';
};

// UI 폼에서 사용할 타입
export interface ModifierGroupFormData {
  name: string;
  description: string;
  tags: string;
  menu_category: string;
  selection_type: 'SINGLE' | 'MULTIPLE';
  min_selections: number;
  max_selections: number;
  options: Omit<ModifierOption, 'option_id' | 'modifier_id'>[];
}

export type Resource = ModifierGroup | TaxGroup | PrinterGroup;
export type ResourceType = 'modifier' | 'tax' | 'printer';

export interface MenuItem extends SortableItem {
  item_id?: number;
  name: string;
  short_name?: string;
  price: number;
  category_id: number;
  description?: string;
  image_url?: string;
  modifier_groups: number[];
  is_active?: boolean;
}

// === MENU ITEM OPTIONS TYPES ===
export interface MenuItemOptions {
  modifier_groups: MenuItemModifierGroup[];
  tax_groups: MenuItemTaxGroup[];
  printer_groups: MenuItemPrinterGroup[];
}

export interface MenuItemModifierGroup {
  group_id: number;
  name: string;
  selection_type: string;
  min_selection: number;
  max_selection: number;
  is_invalid?: boolean;
  is_ambiguous?: boolean;
}

export interface MenuItemTaxGroup {
  tax_group_id: number;
  name: string;
  is_invalid?: boolean;
  is_ambiguous?: boolean;
}

export interface MenuItemPrinterGroup {
  printer_group_id: number;
  name: string;
  is_invalid?: boolean;
  is_ambiguous?: boolean;
}

// === OPTIONS LIBRARY TYPES ===
export interface OptionsLibrary {
  modifier_groups: LibraryModifierGroup[];
  tax_groups: LibraryTaxGroup[];
  printer_groups: LibraryPrinterGroup[];
}

export interface LibraryModifierGroup {
  group_id: number;
  name: string;
  selection_type: string;
  min_selection: number;
  max_selection: number;
}

export interface LibraryTaxGroup {
  tax_group_id: number;
  name: string;
}

export interface LibraryPrinterGroup {
  printer_group_id: number;
  name: string;
}

// === DRAG AND DROP TYPES ===
export interface DraggableOption {
  id: string;
  type: 'modifier' | 'tax' | 'printer';
  data: LibraryModifierGroup | LibraryTaxGroup | LibraryPrinterGroup;
}

export interface DroppableZone {
  id: string;
  type: 'modifier' | 'tax' | 'printer';
  title: string;
  options: (MenuItemModifierGroup | MenuItemTaxGroup | MenuItemPrinterGroup)[];
}

// === MENU INDEPENDENT OPTIONS TYPES ===
export interface MenuIndependentModifierGroup {
  group_id: number;
  name: string;
  selection_type: string;
  min_selection: number;
  max_selection: number;
  modifiers: MenuIndependentModifier[];
}

export interface MenuIndependentModifier {
  modifier_id: number;
  name: string;
  price_delta: number;
  sort_order: number;
}

export interface MenuIndependentTaxGroup {
  tax_group_id: number;
  name: string;
  taxes: MenuIndependentTax[];
}

export interface MenuIndependentTax {
  tax_id: number;
  name: string;
  rate: number;
}

export interface MenuIndependentPrinterGroup {
  printer_group_id: number;
  name: string;
  printers: MenuIndependentPrinter[];
}

export interface MenuIndependentPrinter {
  printer_id: number;
  name: string;
  type: string;
  ip_address?: string;
}

// === MENU OPTIONS MANAGEMENT TYPES ===
export interface MenuOptionsData {
  modifier_groups: MenuIndependentModifierGroup[];
  tax_groups: MenuIndependentTaxGroup[];
  printer_groups: MenuIndependentPrinterGroup[];
}

export interface CreateModifierGroupRequest {
  name: string;
  selection_type: string;
  min_selection: number;
  max_selection: number;
  modifiers: {
    name: string;
    price_delta: number;
  }[];
}

export interface CreateTaxGroupRequest {
  name: string;
  taxes: {
    name: string;
    rate: number;
  }[];
}

export interface CreatePrinterGroupRequest {
  name: string;
  printers: {
    name: string;
    type: string;
    ip_address?: string;
  }[];
}

