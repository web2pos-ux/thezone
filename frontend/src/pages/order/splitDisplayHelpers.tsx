import React from 'react';

export interface SplitQtyDisplay {
  isSplit: boolean;
  qty: number;
  remaining: number;
  total: number;
}

export interface SplitPriceDisplay {
  isSplit: boolean;
  originalPrice: number;
  displayPrice: number;
}

export function getSplitQtyDisplay(
  item: { quantity?: number; _preSplit?: boolean },
  effectiveSplitCount: number,
  paidGuestsCount: number,
): SplitQtyDisplay {
  const qty = item.quantity || 1;
  const remaining =
    effectiveSplitCount > 1 && paidGuestsCount > 0 && item._preSplit
      ? effectiveSplitCount - paidGuestsCount
      : 0;

  return { isSplit: remaining > 0, qty, remaining, total: effectiveSplitCount };
}

export function getSplitPriceDisplay(
  basePrice: number,
  effectiveSplitCount: number,
  paidGuestsCount: number,
  isPreSplit: boolean,
): SplitPriceDisplay {
  const remaining =
    effectiveSplitCount > 1 && paidGuestsCount > 0 && isPreSplit
      ? effectiveSplitCount - paidGuestsCount
      : 0;

  const displayPrice =
    remaining > 0
      ? Number((basePrice * remaining / effectiveSplitCount).toFixed(2))
      : basePrice;

  return { isSplit: remaining > 0, originalPrice: basePrice, displayPrice };
}

/**
 * Equal Split 모드에서 새로 추가된 아이템(_preSplit=false)은 lock 대상에서 제외.
 * 기존 아이템(_preSplit=true)이고 해당 게스트가 PAID면 lock.
 */
export function isItemLockedForSplit(
  itemGuestNumber: number | null | undefined,
  isPreSplit: boolean,
  effectiveSplitCount: number,
  guestStatusMap: Record<number, string> | null | undefined,
  persistedPaidGuests: number[],
): boolean {
  const g = Number(itemGuestNumber);
  if (!g || !Number.isFinite(g)) return false;
  if (effectiveSplitCount > 1 && !isPreSplit) return false;
  if (guestStatusMap && guestStatusMap[g] === 'PAID') return true;
  return Array.isArray(persistedPaidGuests) && persistedPaidGuests.includes(g);
}

export const SplitQtyLabel: React.FC<{
  item: { quantity?: number; _preSplit?: boolean };
  effectiveSplitCount: number;
  paidGuestsCount: number;
}> = ({ item, effectiveSplitCount, paidGuestsCount }) => {
  const sq = getSplitQtyDisplay(item, effectiveSplitCount, paidGuestsCount);
  if (sq.isSplit) {
    return (
      <span className="w-14 text-center font-bold text-base text-orange-600 leading-tight" style={{ fontSize: 'calc(var(--order-item-font) - 2px)' }}>
        {sq.qty > 1 ? <>{sq.qty}<span className="text-xs text-gray-400">({sq.remaining}/{sq.total})</span></> : <>{sq.remaining}/{sq.total}</>}
      </span>
    );
  }
  return (
    <span className="w-8 text-center font-medium text-base" style={{ fontSize: 'calc(var(--order-item-font) - 2px)' }}>{sq.qty}</span>
  );
};

export const SplitPriceLabel: React.FC<{
  basePrice: number;
  effectiveSplitCount: number;
  paidGuestsCount: number;
  isPreSplit: boolean;
  align?: 'left' | 'right';
}> = ({ basePrice, effectiveSplitCount, paidGuestsCount, isPreSplit, align }) => {
  const sp = getSplitPriceDisplay(basePrice, effectiveSplitCount, paidGuestsCount, isPreSplit);
  const textAlign = align === 'right' ? 'text-right' : '';
  return (
    <div>
      {sp.isSplit && <div className={`text-gray-400 line-through text-xs ${textAlign}`} style={{ fontSize: 'calc(var(--order-item-font) - 4px)' }}>{sp.originalPrice.toFixed(2)}</div>}
      <div className={`font-medium text-sm ${sp.isSplit ? 'text-orange-600' : 'text-gray-800'} ${textAlign}`} style={{ fontSize: 'calc(var(--order-item-font) - 2px)' }}>{sp.displayPrice.toFixed(2)}</div>
    </div>
  );
};
