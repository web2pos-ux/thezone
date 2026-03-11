export type Money = number; // dollars, 2-decimal

export type DiscountMode = 'percent' | 'amount';

export interface DiscountLike {
  mode?: DiscountMode;
  value?: number;
  percentage?: number;
}

export interface MemoLike {
  text?: string;
  price?: number;
}

export interface ModifierEntryLike {
  price_delta?: number;
  priceDelta?: number;
  price_adjustment?: number;
  price?: number;
}

export interface ModifierGroupLike {
  totalModifierPrice?: number;
  selectedEntries?: Array<ModifierEntryLike & { id?: string; name?: string }>;
}

export interface TaxRuleLike {
  name: string;
  rate: number; // percent
}

export interface TaxContext {
  itemTaxGroups?: Record<string, number[]>;
  categoryTaxGroups?: Record<number, number[]>;
  itemIdToCategoryId?: Record<string, number>;
  taxGroupIdToTaxes?: Record<number, TaxRuleLike[]>;
}

export interface OrderItemLike {
  id: string | number;
  orderLineId?: string;
  name?: string;
  type?: 'item' | 'separator' | 'discount' | 'void' | string;
  quantity?: number;
  price?: number; // base unit price after Open/Edit Price
  totalPrice?: number; // may include modifiers (legacy)
  modifiers?: ModifierGroupLike[];
  memo?: MemoLike | null;
  discount?: DiscountLike | null;
  guestNumber?: number;
  taxGroupId?: number | null;
  void_id?: any;
  voidId?: any;
  is_void?: any;
}

export interface PricingLine {
  orderLineId?: string;
  itemId: string;
  guestNumber: number;
  quantity: number;
  unitItem: Money;
  unitModifiers: Money;
  unitMemo: Money;
  unitGross: Money;
  lineGross: Money;
  itemDiscount: Money;
  lineNetAfterItemDiscount: Money;
  orderDiscountAllocated: Money;
  lineTaxable: Money;
  taxLines: Array<{ name: string; amount: Money }>;
  taxTotal: Money;
  lineTotal: Money;
}

export interface OrderDiscountResult {
  mode: DiscountMode;
  value: number; // percent or amount input value
  amountApplied: Money;
}

export interface OrderPricingResult {
  lines: PricingLine[];
  orderDiscount: OrderDiscountResult | null;
  totals: {
    grossSubtotal: Money;
    itemDiscountTotal: Money;
    subtotalAfterItemDiscount: Money;
    orderDiscountTotal: Money;
    subtotalAfterAllDiscounts: Money;
    taxLines: Array<{ name: string; amount: Money }>;
    taxesTotal: Money;
    total: Money;
  };
}

function isFiniteNumber(v: any): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function toCents(v: any): number {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function fromCents(c: number): Money {
  return Number((c / 100).toFixed(2));
}

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function getQty(it: OrderItemLike): number {
  const q = Number(it.quantity || 1);
  return Number.isFinite(q) && q > 0 ? Math.floor(q) : 1;
}

function getGuest(it: OrderItemLike): number {
  const g = Number(it.guestNumber || 1);
  return Number.isFinite(g) && g > 0 ? Math.floor(g) : 1;
}

function computeUnitModifierCents(it: OrderItemLike): number {
  const mods = Array.isArray(it.modifiers) ? it.modifiers : [];
  let cents = 0;
  for (const g of mods) {
    if (isFiniteNumber(g.totalModifierPrice)) {
      cents += toCents(g.totalModifierPrice);
      continue;
    }
    const entries = Array.isArray(g.selectedEntries) ? g.selectedEntries : [];
    for (const e of entries) {
      const pv =
        (e && (e.price_delta ?? e.priceDelta ?? e.price_adjustment ?? e.price)) ?? 0;
      cents += toCents(pv);
    }
  }
  return cents;
}

function computeUnitItemBaseCents(it: OrderItemLike, unitModifierCents: number): number {
  const tp = Number(it.totalPrice);
  if (Number.isFinite(tp)) {
    const tpC = toCents(tp);
    // If modifiers exist, totalPrice is usually (base + modifiers). Derive base from it.
    // This also protects against legacy persisted orders where `price` may already include modifiers.
    if (unitModifierCents > 0) {
      const derived = tpC - unitModifierCents;
      return derived >= 0 ? derived : tpC;
    }
    // No modifiers: totalPrice is a safe base candidate.
    return tpC;
  }

  // Fallback: use it.price as base whenever possible (Open/Edit Price already applied there).
  const p = Number(it.price);
  if (Number.isFinite(p)) return toCents(p);
  return 0;
}

function computeItemDiscountCents(lineGrossCents: number, d: DiscountLike | null | undefined): number {
  if (!d) return 0;
  const mode: DiscountMode = d.mode === 'amount' ? 'amount' : 'percent';
  const rawVal = isFiniteNumber(d.value) ? d.value : (isFiniteNumber(d.percentage) ? d.percentage : 0);
  if (!Number.isFinite(rawVal) || rawVal <= 0) return 0;
  if (lineGrossCents <= 0) return 0;

  if (mode === 'percent') {
    const pct = Math.max(0, Math.min(100, rawVal));
    const amt = Math.round((lineGrossCents * pct) / 100);
    return clampInt(amt, 0, lineGrossCents);
  }
  // amount
  const amt = toCents(rawVal);
  return clampInt(amt, 0, lineGrossCents);
}

function isVoidLike(it: OrderItemLike): boolean {
  return !!(it && ((it as any).type === 'void' || (it as any).void_id || (it as any).voidId || (it as any).is_void));
}

function isSeparator(it: OrderItemLike): boolean {
  return !!(it && it.type === 'separator');
}

function isOrderDiscountLine(it: OrderItemLike): boolean {
  if (!it) return false;
  if (it.type === 'discount') return true;
  const p = Number(it.price ?? it.totalPrice ?? 0);
  // Negative-price lines are treated as discount/adjustment lines in this project.
  return Number.isFinite(p) && p < 0;
}

function parseOrderDiscount(items: OrderItemLike[], subtotalAfterItemDiscountCents: number): { result: OrderDiscountResult | null; amountCents: number } {
  const discountLines = (items || []).filter(it => it && !isSeparator(it) && !isVoidLike(it) && isOrderDiscountLine(it));
  if (discountLines.length === 0) return { result: null, amountCents: 0 };

  // Collect percent-mode lines (take the first valid percent) and sum amount-mode lines.
  let percentValue: number | null = null;
  let amountCents = 0;
  for (const dl of discountLines) {
    const d = (dl as any).discount as DiscountLike | null | undefined;
    const mode: DiscountMode = d && d.mode === 'amount' ? 'amount' : 'percent';
    const val =
      d && isFiniteNumber(d.value)
        ? Number(d.value)
        : (d && isFiniteNumber(d.percentage) ? Number(d.percentage) : 0);

    const hasValidPercent = mode === 'percent' && Number.isFinite(val) && val > 0;
    const isAmountMode = mode === 'amount';

    if (hasValidPercent) {
      if (percentValue == null) {
        percentValue = Math.max(0, Math.min(100, val));
      }
      continue;
    }

    // Project policy: negative-price lines are discount/adjustment lines.
    // If there's no explicit percent discount value, treat the line as an amount discount.
    if (isAmountMode || !d) {
      const perLine = Math.abs(toCents((dl.totalPrice != null ? dl.totalPrice : dl.price) || 0)) * getQty(dl);
      amountCents += perLine;
    } else {
      // Percent mode but missing/invalid value: fall back to amount for negative lines.
      const p = Number(dl.totalPrice != null ? dl.totalPrice : dl.price);
      if (Number.isFinite(p) && p < 0) {
        const perLine = Math.abs(toCents(p)) * getQty(dl);
        amountCents += perLine;
      }
    }
  }

  let appliedPercentCents = 0;
  if (percentValue != null && subtotalAfterItemDiscountCents > 0) {
    appliedPercentCents = Math.round((subtotalAfterItemDiscountCents * percentValue) / 100);
  }
  appliedPercentCents = clampInt(appliedPercentCents, 0, subtotalAfterItemDiscountCents);

  const remaining = Math.max(0, subtotalAfterItemDiscountCents - appliedPercentCents);
  const appliedAmountCents = clampInt(amountCents, 0, remaining);
  const totalApplied = clampInt(appliedPercentCents + appliedAmountCents, 0, subtotalAfterItemDiscountCents);

  if (totalApplied <= 0) return { result: null, amountCents: 0 };

  // Prefer percent if present; otherwise amount.
  if (percentValue != null) {
    return {
      result: { mode: 'percent', value: percentValue, amountApplied: fromCents(totalApplied) },
      amountCents: totalApplied,
    };
  }
  const amountValue = fromCents(totalApplied);
  return {
    result: { mode: 'amount', value: amountValue, amountApplied: amountValue },
    amountCents: totalApplied,
  };
}

function allocateOrderDiscountCents(lines: Array<{ netAfterItemDiscountCents: number }>, subtotalAfterItemDiscountCents: number, orderDiscountCents: number): number[] {
  if (orderDiscountCents <= 0 || subtotalAfterItemDiscountCents <= 0 || lines.length === 0) {
    return lines.map(() => 0);
  }
  const floors: number[] = [];
  const remainders: Array<{ idx: number; rem: number }> = [];
  let sumFloors = 0;
  for (let i = 0; i < lines.length; i++) {
    const net = lines[i].netAfterItemDiscountCents;
    if (net <= 0) {
      floors.push(0);
      remainders.push({ idx: i, rem: 0 });
      continue;
    }
    const raw = (orderDiscountCents * net) / subtotalAfterItemDiscountCents; // float cents
    const fl = Math.floor(raw);
    const rem = raw - fl;
    floors.push(fl);
    remainders.push({ idx: i, rem });
    sumFloors += fl;
  }
  let left = orderDiscountCents - sumFloors;
  if (left <= 0) return floors.map(c => clampInt(c, 0, orderDiscountCents));

  remainders.sort((a, b) => b.rem - a.rem);
  const alloc = [...floors];
  let k = 0;
  while (left > 0 && k < remainders.length) {
    const idx = remainders[k].idx;
    alloc[idx] += 1;
    left -= 1;
    k += 1;
    if (k >= remainders.length) k = 0;
  }
  return alloc.map(c => clampInt(c, 0, orderDiscountCents));
}

function computeLineTaxLinesCents(taxableCents: number, it: OrderItemLike, ctx?: TaxContext): Record<string, number> {
  const out: Record<string, number> = {};
  if (!ctx || taxableCents <= 0) return out;
  const itemKey = String(it.id ?? '');
  const itemGroupIds = (ctx.itemTaxGroups && itemKey && Array.isArray(ctx.itemTaxGroups[itemKey])) ? ctx.itemTaxGroups[itemKey] : [];
  const catId = (ctx.itemIdToCategoryId && itemKey && typeof ctx.itemIdToCategoryId[itemKey] === 'number') ? ctx.itemIdToCategoryId[itemKey] : undefined;
  const catGroupIds = (typeof catId === 'number' && ctx.categoryTaxGroups && Array.isArray(ctx.categoryTaxGroups[catId])) ? ctx.categoryTaxGroups[catId] : [];
  const overrideGroupIds = (typeof (it as any).taxGroupId === 'number') ? [Number((it as any).taxGroupId)] : [];
  const mergedGroupIds = Array.from(new Set<number>([...itemGroupIds, ...catGroupIds, ...overrideGroupIds]));

  for (const gid of mergedGroupIds) {
    const rules = (ctx.taxGroupIdToTaxes && Array.isArray(ctx.taxGroupIdToTaxes[gid])) ? ctx.taxGroupIdToTaxes[gid] : [];
    for (const r of rules) {
      const name = String((r as any).name || 'Tax');
      const rate = Number((r as any).rate || 0);
      if (!Number.isFinite(rate) || rate <= 0) continue;
      const taxCents = Math.round((taxableCents * rate) / 100);
      out[name] = (out[name] || 0) + clampInt(taxCents, 0, Number.MAX_SAFE_INTEGER);
    }
  }
  return out;
}

export function calculateOrderPricing(allItems: OrderItemLike[], ctx?: TaxContext): OrderPricingResult {
  const items = Array.isArray(allItems) ? allItems : [];
  const itemLines: Array<{
    it: OrderItemLike;
    orderLineId?: string;
    itemId: string;
    guestNumber: number;
    qty: number;
    unitItemCents: number;
    unitModCents: number;
    unitMemoCents: number;
    unitGrossCents: number;
    lineGrossCents: number;
    itemDiscountCents: number;
    netAfterItemDiscountCents: number;
  }> = [];

  for (const it of items) {
    if (!it || isSeparator(it) || isVoidLike(it) || isOrderDiscountLine(it)) continue;
    const qty = getQty(it);
    const guestNumber = getGuest(it);
    const unitModCents = computeUnitModifierCents(it);
    const unitItemCents = computeUnitItemBaseCents(it, unitModCents);
    const unitMemoCents = toCents((it.memo && isFiniteNumber(it.memo.price)) ? it.memo.price : 0);
    const unitGrossCents = unitItemCents + unitModCents + unitMemoCents;
    const lineGrossCents = unitGrossCents * qty;
    const itemDiscountCents = computeItemDiscountCents(lineGrossCents, it.discount);
    const netAfterItemDiscountCents = Math.max(0, lineGrossCents - itemDiscountCents);

    itemLines.push({
      it,
      orderLineId: it.orderLineId,
      itemId: String(it.id ?? ''),
      guestNumber,
      qty,
      unitItemCents,
      unitModCents,
      unitMemoCents,
      unitGrossCents,
      lineGrossCents,
      itemDiscountCents,
      netAfterItemDiscountCents,
    });
  }

  const grossSubtotalCents = itemLines.reduce((s, l) => s + l.lineGrossCents, 0);
  const itemDiscountTotalCents = itemLines.reduce((s, l) => s + l.itemDiscountCents, 0);
  const subtotalAfterItemDiscountCents = itemLines.reduce((s, l) => s + l.netAfterItemDiscountCents, 0);

  const { result: orderDiscountResult, amountCents: orderDiscountCents } = parseOrderDiscount(items, subtotalAfterItemDiscountCents);
  const allocCents = allocateOrderDiscountCents(
    itemLines.map(l => ({ netAfterItemDiscountCents: l.netAfterItemDiscountCents })),
    subtotalAfterItemDiscountCents,
    orderDiscountCents,
  );

  const taxByNameCents: Record<string, number> = {};
  const lines: PricingLine[] = itemLines.map((l, idx) => {
    const orderAlloc = clampInt(allocCents[idx] || 0, 0, l.netAfterItemDiscountCents);
    const taxableCents = Math.max(0, l.netAfterItemDiscountCents - orderAlloc);
    const taxLinesCents = computeLineTaxLinesCents(taxableCents, l.it, ctx);
    const taxLines = Object.entries(taxLinesCents).map(([name, cents]) => ({ name, amount: fromCents(cents) }));
    const taxTotalCents = Object.values(taxLinesCents).reduce((s, c) => s + c, 0);
    for (const [name, cents] of Object.entries(taxLinesCents)) {
      taxByNameCents[name] = (taxByNameCents[name] || 0) + cents;
    }
    const lineTotalCents = taxableCents + taxTotalCents;
    return {
      orderLineId: l.orderLineId,
      itemId: l.itemId,
      guestNumber: l.guestNumber,
      quantity: l.qty,
      unitItem: fromCents(l.unitItemCents),
      unitModifiers: fromCents(l.unitModCents),
      unitMemo: fromCents(l.unitMemoCents),
      unitGross: fromCents(l.unitGrossCents),
      lineGross: fromCents(l.lineGrossCents),
      itemDiscount: fromCents(l.itemDiscountCents),
      lineNetAfterItemDiscount: fromCents(l.netAfterItemDiscountCents),
      orderDiscountAllocated: fromCents(orderAlloc),
      lineTaxable: fromCents(taxableCents),
      taxLines,
      taxTotal: fromCents(taxTotalCents),
      lineTotal: fromCents(lineTotalCents),
    };
  });

  const taxLines = Object.entries(taxByNameCents).map(([name, cents]) => ({ name, amount: fromCents(cents) }));
  const taxesTotalCents = Object.values(taxByNameCents).reduce((s, c) => s + c, 0);
  const subtotalAfterAllDiscountsCents = Math.max(0, subtotalAfterItemDiscountCents - orderDiscountCents);
  const totalCents = subtotalAfterAllDiscountsCents + taxesTotalCents;

  return {
    lines,
    orderDiscount: orderDiscountResult,
    totals: {
      grossSubtotal: fromCents(grossSubtotalCents),
      itemDiscountTotal: fromCents(itemDiscountTotalCents),
      subtotalAfterItemDiscount: fromCents(subtotalAfterItemDiscountCents),
      orderDiscountTotal: fromCents(orderDiscountCents),
      subtotalAfterAllDiscounts: fromCents(subtotalAfterAllDiscountsCents),
      taxLines,
      taxesTotal: fromCents(taxesTotalCents),
      total: fromCents(totalCents),
    },
  };
}

export function summarizePricingByGuest(pricing: OrderPricingResult): Record<number, { subtotal: Money; taxLines: Array<{ name: string; amount: Money }>; taxesTotal: Money; total: Money }> {
  const byGuest: Record<number, { subtotalC: number; taxByNameC: Record<string, number> }> = {};
  for (const l of pricing.lines) {
    const g = Number(l.guestNumber || 1);
    if (!byGuest[g]) byGuest[g] = { subtotalC: 0, taxByNameC: {} };
    byGuest[g].subtotalC += toCents(l.lineTaxable);
    for (const t of l.taxLines) {
      byGuest[g].taxByNameC[t.name] = (byGuest[g].taxByNameC[t.name] || 0) + toCents(t.amount);
    }
  }
  const out: Record<number, { subtotal: Money; taxLines: Array<{ name: string; amount: Money }>; taxesTotal: Money; total: Money }> = {};
  for (const [k, v] of Object.entries(byGuest)) {
    const taxLines = Object.entries(v.taxByNameC).map(([name, cents]) => ({ name, amount: fromCents(cents) }));
    const taxesTotalC = Object.values(v.taxByNameC).reduce((s, c) => s + c, 0);
    const subtotal = fromCents(v.subtotalC);
    const taxesTotal = fromCents(taxesTotalC);
    out[Number(k)] = { subtotal, taxLines, taxesTotal, total: Number((subtotal + taxesTotal).toFixed(2)) };
  }
  return out;
}

export type SubtotalAdjustment =
  | { kind: 'DISCOUNT'; label?: string; mode?: DiscountMode; value?: number; amount?: Money }
  | { kind: 'FEE'; label?: string; amount: Money };

export function computeDiscountAmount(subtotal: Money, mode: DiscountMode, value: number): Money {
  const subC = toCents(subtotal);
  if (subC <= 0) return 0;
  const v = Number(value || 0);
  if (!Number.isFinite(v) || v <= 0) return 0;
  if (mode === 'percent') {
    const pct = Math.max(0, Math.min(100, v));
    return fromCents(Math.round((subC * pct) / 100));
  }
  return fromCents(clampInt(toCents(v), 0, subC));
}

/**
 * Apply order-level adjustments to an already-computed (discounted) subtotal/tax.
 * Policy:
 * - DISCOUNT reduces taxable base (tax scaled proportionally).
 * - FEE is treated as non-taxable by default (added after tax).
 */
export function applySubtotalAdjustments(
  base: { subtotal: Money; taxLines: Array<{ name: string; amount: Money }> },
  adjustments: SubtotalAdjustment[],
): { subtotal: Money; taxLines: Array<{ name: string; amount: Money }>; taxesTotal: Money; total: Money; discountTotal: Money; feeTotal: Money } {
  const baseSubC = toCents(base.subtotal);
  const baseTaxByNameC: Record<string, number> = {};
  for (const t of (base.taxLines || [])) {
    baseTaxByNameC[String(t.name || 'Tax')] = (baseTaxByNameC[String(t.name || 'Tax')] || 0) + toCents(t.amount || 0);
  }
  const baseTaxTotalC = Object.values(baseTaxByNameC).reduce((s, c) => s + c, 0);

  let discountC = 0;
  let feeC = 0;
  for (const a of (adjustments || [])) {
    if (!a) continue;
    if (a.kind === 'FEE') {
      feeC += toCents((a as any).amount || 0);
      continue;
    }
    // DISCOUNT
    if (typeof (a as any).amount === 'number') {
      discountC += toCents((a as any).amount || 0);
    } else {
      const mode: DiscountMode = (a as any).mode === 'amount' ? 'amount' : 'percent';
      const val = Number((a as any).value || 0);
      discountC += toCents(computeDiscountAmount(fromCents(baseSubC), mode, val));
    }
  }

  discountC = clampInt(discountC, 0, baseSubC);
  const subAfterC = Math.max(0, baseSubC - discountC);

  // Scale tax by subtotal ratio (discount affects taxable base)
  const ratio = baseSubC > 0 ? (subAfterC / baseSubC) : 0;
  const outTaxByNameC: Record<string, number> = {};
  for (const [name, c] of Object.entries(baseTaxByNameC)) {
    outTaxByNameC[name] = Math.round(c * ratio);
  }
  const taxesTotalC = Object.values(outTaxByNameC).reduce((s, c) => s + c, 0);

  // Fees are treated as non-taxable here
  const totalC = subAfterC + taxesTotalC + feeC;
  const taxLines = Object.entries(outTaxByNameC).map(([name, c]) => ({ name, amount: fromCents(c) }));

  return {
    subtotal: fromCents(subAfterC),
    taxLines,
    taxesTotal: fromCents(taxesTotalC),
    total: fromCents(totalC),
    discountTotal: fromCents(discountC),
    feeTotal: fromCents(feeC),
  };
}

