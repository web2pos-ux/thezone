import { useEffect, useState } from 'react';
import { PromotionMode, PromotionSettings } from '../types/promotion';

const LS_KEY = 'table_promotion_settings_v1';

export function usePromotion() {
  const [enabled, setEnabled] = useState(false);
  const [type, setType] = useState<PromotionMode>('percent');
  const [value, setValue] = useState<number>(0);
  const [eligibleItemIds, setEligibleItemIds] = useState<Array<string|number>>([]);
  const [eligibleCategoryIds, setEligibleCategoryIds] = useState<Array<string|number>>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setEnabled(!!parsed.enabled);
        setType((parsed.type === 'amount' ? 'amount' : 'percent'));
        setValue(Number(parsed.value || 0));
        setEligibleItemIds(Array.isArray(parsed.eligibleItemIds) ? parsed.eligibleItemIds : []);
        setEligibleCategoryIds(Array.isArray(parsed.eligibleCategoryIds) ? parsed.eligibleCategoryIds : []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      const toSave = { enabled, type, value, eligibleItemIds, eligibleCategoryIds };
      localStorage.setItem(LS_KEY, JSON.stringify(toSave));
    } catch {}
  }, [enabled, type, value, eligibleItemIds, eligibleCategoryIds]);

  const settings: PromotionSettings = {
    enabled,
    type,
    value,
    eligibleItemIds
  };

  return {
    // state
    enabled, setEnabled,
    type, setType,
    value, setValue,
    eligibleItemIds, setEligibleItemIds,
    eligibleCategoryIds, setEligibleCategoryIds,
    // derived
    settings
  };
} 