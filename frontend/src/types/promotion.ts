export type PromotionMode = 'percent' | 'amount';

export type PromotionChannel = 'table' | 'togo' | 'online' | 'tableOrder' | 'kiosk' | 'delivery';

export interface PromotionSettings {
  enabled: boolean;
  type: PromotionMode;
  value: number;
  eligibleItemIds: Array<string|number>;
  codeInput?: string; // user-entered code (trimmed), case-sensitive match policy
  rules?: PromotionRule[]; // full rules list to evaluate
  channel?: PromotionChannel; // current channel for filtering rules
}

export interface PromotionAdjustmentRecord {
  kind: 'PROMOTION';
  mode: PromotionMode;
  value: number;
  amountApplied: number;
  ruleId?: string; // which rule produced this adjustment (for usage tracking)
  label?: string;
}

export interface PromotionChannels {
  table?: boolean;
  togo?: boolean;
  online?: boolean;
  tableOrder?: boolean;
  kiosk?: boolean;
  delivery?: boolean;
}

export interface PromotionRule {
  id: string;
  createdAt?: number; // epoch ms when the rule was created (used for tie-breaking and "latest" selection)
  name: string;
  code: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  mode: PromotionMode;
  value: number;
  minSubtotal: number;
  eligibleItemIds: Array<string|number>;
  daysOfWeek?: number[]; // 0..6 (Sun..Sat)
  dateAlways?: boolean; // if true, applies regardless of date
  timeAlways?: boolean; // if true, applies regardless of time
  enabled?: boolean; // if false, rule is ignored
  channels?: PromotionChannels; // per-channel enable flags
}

export interface FreeItemPromotion {
  id: string;
  name: string;
  code: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  daysOfWeek?: number[]; // 0..6 (Sun..Sat)
  dateAlways?: boolean;
  timeAlways?: boolean;
  enabled?: boolean;
  createdAt?: number;
  kind?: 'FREE' | 'BOGO';
  freeItemId?: string | number;
  freeQty: number;
  minSubtotal: number;
  eligibleItemIds: Array<string|number>;
} 