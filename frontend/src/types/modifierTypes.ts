// === NEW MODIFIER TYPES ===
export interface ModifierOption {
  option_id: number;        // modifier_id와 매핑
  modifier_id?: number;     // 백엔드 호환성
  name: string;
  price_adjustment: number; // price_delta와 매핑
  is_default: boolean;      // 기본 선택 여부
  sort_order?: number;
}

export interface NewModifierGroup {
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
export const getRequirementIcon = (group: NewModifierGroup): string => {
  return group.min_selections > 0 ? '🔴' : '⚪';
};

export const getSelectionRuleText = (group: NewModifierGroup): string => {
  const { min_selections, max_selections } = group;
  return min_selections === max_selections 
    ? `${min_selections}개 선택`
    : `${min_selections}-${max_selections}개 선택`;
};

export const getRequirementType = (group: NewModifierGroup): 'REQUIRED' | 'OPTIONAL' => {
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