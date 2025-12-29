import { PromotionSettings, PromotionAdjustmentRecord, PromotionRule } from '../types/promotion';

export interface LineItemLike {
  id: string | number;
  totalPrice: number;
  quantity: number;
  memo?: { price?: number } | null;
  type?: string;
}

function toLocalDate(t: Date) { return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
function parseYmd(v?: string): Date | null {
  if (!v) return null;
  const [y, m, d] = v.split('-').map(n => parseInt(n, 10));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function getEligibleSubtotal(items: LineItemLike[], eligibleItemIds: Array<string|number>): number {
  const eligibleIds = new Set((eligibleItemIds || []).map(String));
  return (items || [])
    .filter(it => it && it.type !== 'separator')
    .reduce((sum, it) => {
      const memoPrice = (it.memo && typeof it.memo.price === 'number') ? it.memo.price : 0;
      const isEligible = eligibleIds.size > 0 ? eligibleIds.has(String(it.id)) : true;
      return isEligible ? sum + ((Number(it.totalPrice) + Number(memoPrice)) * Number(it.quantity || 1)) : sum;
    }, 0);
}

function isRuleActiveNow(rule: PromotionRule, now: Date): boolean {
  // Date range policy:
  // - If both startDate and endDate empty => always (dateAlways covers this but also enforce default)
  // - If only startDate present => apply from that day forward (no limit)
  // - If both present => within inclusive range
  if (!rule.dateAlways) {
    const s = parseYmd(rule.startDate);
    const e = parseYmd(rule.endDate);
    const today = toLocalDate(now);
    if (s && e) {
      const sd = toLocalDate(s);
      const ed = toLocalDate(e);
      if (today < sd || today > ed) return false;
    } else if (s && !e) {
      const sd = toLocalDate(s);
      if (today < sd) return false;
    } else if (!s && e) {
      const ed = toLocalDate(e);
      if (today > ed) return false;
    }
  }

  // Day-of-week policy: Sun=0..Sat=6
  if (rule.daysOfWeek && rule.daysOfWeek.length > 0) {
    const dow = now.getDay(); // 0..6 Sun..Sat
    if (!rule.daysOfWeek.includes(dow)) return false;
  }

  // Time window policy:
  // - If timeAlways true or both empty: always
  // - If only start set: apply from start to end of day
  // - If only end set: apply from start of day to end
  // - If both set and end < start: overnight window allowed (e.g., 22:00~02:00)
  if (!rule.timeAlways) {
    const st = (rule.startTime || '').trim();
    const et = (rule.endTime || '').trim();
    if (st || et) {
      const [sh, sm] = (st || '00:00').split(':').map(n => parseInt(n || '0', 10));
      const [eh, em] = (et || '23:59').split(':').map(n => parseInt(n || '0', 10));
      const minutesNow = now.getHours() * 60 + now.getMinutes();
      const startMin = Math.max(0, Math.min(23, isNaN(sh) ? 0 : sh)) * 60 + Math.max(0, Math.min(59, isNaN(sm) ? 0 : sm));
      const endMin = Math.max(0, Math.min(23, isNaN(eh) ? 23 : eh)) * 60 + Math.max(0, Math.min(59, isNaN(em) ? 59 : em));
      if (endMin >= startMin) {
        if (!(minutesNow >= startMin && minutesNow <= endMin)) return false;
      } else {
        // overnight: valid if now >= start OR now <= end
        if (!(minutesNow >= startMin || minutesNow <= endMin)) return false;
      }
    }
  }

  return true;
}

function normalizeCodeInput(code?: string): string {
  // trim only, case-sensitive match
  return (code || '').trim();
}

function computeAmountApplied(subtotal: number, rule: PromotionRule): number {
  const v = Number(rule.value) || 0;
  if (v <= 0 || subtotal <= 0) return 0;
  const raw = rule.mode === 'percent' ? (subtotal * v / 100) : v;
  // Round with 3rd decimal rounding, then show 2 decimals
  const rounded = Math.round(raw * 1000) / 1000; // round to 3 decimals
  return Number((Math.round(rounded * 100) / 100).toFixed(2)); // to 2 decimals
}

export function computePromotionAdjustment(items: LineItemLike[], settings: PromotionSettings): PromotionAdjustmentRecord | null {
  if (!settings.enabled) return null;

  // If rules are provided, evaluate them; otherwise fall back to simple percent/amount on eligible items
  const rules = Array.isArray(settings.rules) ? settings.rules : [];
  const now = new Date();
  const userCode = normalizeCodeInput(settings.codeInput);

  if (rules.length > 0) {
    // Build candidates that pass filters
    const candidates = rules.filter(r => {
      if (r.enabled === false) return false;
      // code policy: if r.code non-empty, require exact match; if empty, ignore code
      const ruleCode = normalizeCodeInput(r.code);
      if (ruleCode && ruleCode !== userCode) return false;
      if (!isRuleActiveNow(r, now)) return false;
      const eligibleSubtotal = getEligibleSubtotal(items, r.eligibleItemIds || []);
      if (eligibleSubtotal <= 0) return false;
      if ((Number(r.minSubtotal) || 0) > eligibleSubtotal) return false; // min order on eligible subtotal
      const amount = computeAmountApplied(eligibleSubtotal, r);
      if (amount <= 0) return false;
      return true;
    });

    if (candidates.length === 0) return null;

    // pick best benefit (max discount amount). If tie, use latest (createdAt desc, else keep as is)
    const withAmounts = candidates.map(r => {
      const eligibleSubtotal = getEligibleSubtotal(items, r.eligibleItemIds || []);
      const amount = computeAmountApplied(eligibleSubtotal, r);
      return { r, amount, createdAt: r.createdAt || 0 };
    });
    if (userCode) {
      // When user explicitly entered a code, prefer the latest rule for that code
      withAmounts.sort((a, b) => {
        if ((b.createdAt || 0) !== (a.createdAt || 0)) return (b.createdAt || 0) - (a.createdAt || 0);
        if (b.amount !== a.amount) return b.amount - a.amount;
        return 0;
      });
    } else {
      // Otherwise, pick maximum benefit; tie-breaker: latest
      withAmounts.sort((a, b) => {
        if (b.amount !== a.amount) return b.amount - a.amount;
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
    }
    const best = withAmounts[0];
    return {
      kind: 'PROMOTION',
      mode: best.r.mode,
      value: Number(best.r.value) || 0,
      amountApplied: Number(best.amount.toFixed(2)),
      ruleId: best.r.id,
      label: best.r.name || 'Promotion',
    };
  }

  // Legacy/simple mode
  const dv = Number(settings.value) || 0;
  if (dv <= 0) return null;
  const eligibleSubtotal = getEligibleSubtotal(items, settings.eligibleItemIds || []);
  if (eligibleSubtotal <= 0) return null;
  const amountApplied = settings.type === 'percent' ? (eligibleSubtotal * dv / 100) : dv;
  const rounded = Math.round(amountApplied * 1000) / 1000;
  const amount2 = Number((Math.round(rounded * 100) / 100).toFixed(2));
  if (amount2 <= 0) return null;
  return {
    kind: 'PROMOTION',
    mode: settings.type,
    value: dv,
    amountApplied: amount2,
    label: 'Promotion',
  };
}

export function buildPromotionReceiptLine(adj: PromotionAdjustmentRecord | null): { label: string; amount: number } | null {
  if (!adj) return null;
  const label = `Discount (${adj.mode === 'percent' ? `${adj.value.toFixed(2)}%` : `$${adj.value.toFixed(2)}`})`;
  return { label, amount: -Math.abs(Number(adj.amountApplied.toFixed(2))) };
} 