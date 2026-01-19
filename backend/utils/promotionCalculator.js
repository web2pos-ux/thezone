/**
 * Backend promotion calculator
 * Mirrors frontend logic for consistency
 */

function toLocalDate(t) {
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
}

function parseYmd(v) {
  if (!v) return null;
  const parts = v.split('-').map(n => parseInt(n, 10));
  if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function getEligibleSubtotal(items, eligibleItemIds) {
  const eligibleIds = new Set((eligibleItemIds || []).map(String));
  return (items || [])
    .filter(it => it && it.type !== 'separator')
    .reduce((sum, it) => {
      const price = Number(it.totalPrice || it.price || 0);
      const memoPrice = (it.memo && typeof it.memo.price === 'number') ? it.memo.price : 0;
      const isEligible = eligibleIds.size > 0 ? eligibleIds.has(String(it.id || it.item_id || it.menuItemId)) : true;
      return isEligible ? sum + ((price + memoPrice) * Number(it.quantity || 1)) : sum;
    }, 0);
}

function isRuleActiveNow(rule, now) {
  // Date range check
  if (!rule.dateAlways) {
    const s = parseYmd(rule.startDate);
    const e = parseYmd(rule.endDate);
    const today = toLocalDate(now);
    if (s && e) {
      const sd = toLocalDate(s);
      const ed = toLocalDate(e);
      if (today < sd || today > ed) return false;
    } else if (s && !e) {
      if (today < toLocalDate(s)) return false;
    } else if (!s && e) {
      if (today > toLocalDate(e)) return false;
    }
  }

  // Day-of-week check
  if (rule.daysOfWeek && rule.daysOfWeek.length > 0) {
    const dow = now.getDay();
    if (!rule.daysOfWeek.includes(dow)) return false;
  }

  // Time window check
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
        if (!(minutesNow >= startMin || minutesNow <= endMin)) return false;
      }
    }
  }

  return true;
}

function isRuleForChannel(rule, channel) {
  if (!channel) return true;
  if (!rule.channels) return true;
  return !!rule.channels[channel];
}

function normalizeCodeInput(code) {
  return (code || '').trim();
}

function computeAmountApplied(subtotal, rule) {
  const v = Number(rule.value) || 0;
  if (v <= 0 || subtotal <= 0) return 0;
  const raw = rule.mode === 'percent' ? (subtotal * v / 100) : v;
  const rounded = Math.round(raw * 1000) / 1000;
  return Number((Math.round(rounded * 100) / 100).toFixed(2));
}

/**
 * Compute promotion adjustment for given items and settings
 * @param {Array} items - Order items
 * @param {Object} settings - Promotion settings
 * @param {boolean} settings.enabled - Whether promotions are enabled
 * @param {string} settings.type - 'percent' or 'amount'
 * @param {number} settings.value - Discount value
 * @param {Array} settings.eligibleItemIds - Eligible item IDs
 * @param {string} settings.codeInput - User entered promo code
 * @param {Array} settings.rules - Promotion rules
 * @param {string} settings.channel - Current channel ('table', 'togo', 'online', 'tableOrder', 'kiosk', 'delivery')
 * @returns {Object|null} Promotion adjustment record
 */
function computePromotionAdjustment(items, settings) {
  if (!settings.enabled) return null;

  const rules = Array.isArray(settings.rules) ? settings.rules : [];
  const now = new Date();
  const userCode = normalizeCodeInput(settings.codeInput);
  const currentChannel = settings.channel;

  if (rules.length > 0) {
    const candidates = rules.filter(r => {
      if (r.enabled === false) return false;
      if (!isRuleForChannel(r, currentChannel)) return false;
      const ruleCode = normalizeCodeInput(r.code);
      if (ruleCode && ruleCode !== userCode) return false;
      if (!isRuleActiveNow(r, now)) return false;
      const eligibleSubtotal = getEligibleSubtotal(items, r.eligibleItemIds || []);
      if (eligibleSubtotal <= 0) return false;
      if ((Number(r.minSubtotal) || 0) > eligibleSubtotal) return false;
      const amount = computeAmountApplied(eligibleSubtotal, r);
      if (amount <= 0) return false;
      return true;
    });

    if (candidates.length === 0) return null;

    const withAmounts = candidates.map(r => {
      const eligibleSubtotal = getEligibleSubtotal(items, r.eligibleItemIds || []);
      const amount = computeAmountApplied(eligibleSubtotal, r);
      return { r, amount, createdAt: r.createdAt || 0 };
    });

    if (userCode) {
      withAmounts.sort((a, b) => {
        if ((b.createdAt || 0) !== (a.createdAt || 0)) return (b.createdAt || 0) - (a.createdAt || 0);
        if (b.amount !== a.amount) return b.amount - a.amount;
        return 0;
      });
    } else {
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

module.exports = {
  computePromotionAdjustment,
  getEligibleSubtotal,
  isRuleActiveNow,
  isRuleForChannel
};
