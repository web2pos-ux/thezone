'use strict';

const firebaseDeliveryChannel = require('./firebaseDeliveryChannel');

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Firestore 온라인/Urban Piper 주문 문서 → SQLite orders 금액·세금·배달비 정규화.
 * total ≈ subtotal + tax + deliveryFee (Urban Piper 기본) 가정, 누락 시 역산.
 */
function getOrderLevelAmounts(order) {
  if (!order || typeof order !== 'object') {
    return { subtotal: 0, tax: 0, deliveryFee: 0, total: 0, taxRate: 0 };
  }
  let subtotal = num(order.subtotal, NaN);
  let tax = num(order.tax, NaN);
  const deliveryFee = num(order.deliveryFee ?? order.delivery_fee, 0);
  let total = num(order.total, NaN);

  if (!Number.isFinite(total)) total = 0;
  if (!Number.isFinite(subtotal)) subtotal = NaN;
  if (!Number.isFinite(tax)) tax = NaN;

  if (!Number.isFinite(subtotal) && Number.isFinite(tax) && total >= 0) {
    subtotal = Math.max(0, total - deliveryFee - tax);
  }
  if (!Number.isFinite(tax) && Number.isFinite(subtotal) && total >= 0) {
    tax = Math.max(0, total - deliveryFee - subtotal);
  }
  if (!Number.isFinite(subtotal) && !Number.isFinite(tax) && total >= 0) {
    subtotal = Math.max(0, total - deliveryFee);
    tax = 0;
  }
  if (!Number.isFinite(subtotal)) subtotal = 0;
  if (!Number.isFinite(tax)) tax = 0;

  const taxRate = subtotal > 0.0001 ? (tax / subtotal) * 100 : 0;
  return { subtotal, tax, deliveryFee, total, taxRate };
}

function stableJson(obj) {
  try {
    return JSON.stringify(obj);
  } catch {
    return null;
  }
}

/**
 * tax_breakdown TEXT 컬럼용 JSON. Firestore taxBreakdown 유지, 없으면 단일 브래킷.
 */
function buildTaxBreakdownJson(order, amounts) {
  const raw = order?.taxBreakdown ?? order?.tax_breakdown;
  if (raw != null) {
    if (typeof raw === 'string' && raw.trim()) {
      try {
        JSON.parse(raw);
        return raw.trim();
      } catch {
        /* fall through */
      }
    }
    if (typeof raw === 'object') {
      const s = stableJson(raw);
      if (s) return s;
    }
  }
  const { tax, taxRate } = amounts;
  if (tax <= 0) return stableJson([{ label: 'Tax', ratePercent: taxRate, amount: 0 }]);
  return stableJson([
    {
      label: 'Tax',
      ratePercent: Math.round(taxRate * 10000) / 10000,
      amount: Math.round(tax * 100) / 100,
      source: 'firebase_order',
    },
  ]);
}

/** 배달 플랫폼(외부) 주문 ID — 클레임·대사용 */
function extractPlatformExternalOrderId(order) {
  if (!order || typeof order !== 'object') return null;
  const raw = order.rawUrbanPiper;
  const ep = raw?.order?.details?.ext_platforms;
  if (Array.isArray(ep) && ep.length) {
    const first = ep[0];
    const extId = first?.id ?? first?.order_id ?? first?.external_order_id;
    if (extId != null && String(extId).trim()) return String(extId).trim();
  }
  const upId = order.sourceIds?.urbanpiperOrderId;
  if (upId != null && String(upId).trim()) return String(upId).trim();
  const on = order.orderNumber ?? order.order_number;
  if (on != null && String(on).trim()) return String(on).trim();
  return null;
}

function normalizeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function inferChannelSlug(order) {
  const ch = firebaseDeliveryChannel.getSourceIdsChannel(order);
  if (ch) return normalizeSlug(ch);
  const dc = String(order.delivery_company || order.deliveryCompany || '').toUpperCase();
  if (dc === 'UBEREATS') return 'ubereats';
  if (dc === 'DOORDASH') return 'doordash';
  if (dc === 'SKIPTHEDISHES') return 'skipthedishes';
  return '';
}

function inferOrderSource(order) {
  const src = String(order.source || '').toLowerCase();
  if (src.includes('urban') && src.includes('piper')) return 'URBAN_PIPER';
  if (src === 'urbanpiper') return 'URBAN_PIPER';
  if (firebaseDeliveryChannel.hasUrbanPiperMarker(order)) return 'URBAN_PIPER';
  if (src === 'online') return 'ONLINE';
  return src ? src.toUpperCase() : 'ONLINE';
}

function sumTaxesFromUpLine(rawLine) {
  if (!rawLine || typeof rawLine !== 'object') return 0;
  const taxes = rawLine.taxes;
  if (!Array.isArray(taxes) || taxes.length === 0) return 0;
  let s = 0;
  for (const t of taxes) {
    s += num(t?.amount ?? t?.tax_amount ?? t?.value, 0);
  }
  return Math.round(s * 100) / 100;
}

function modifiersJsonFromRawLine(rawLine) {
  if (!rawLine || typeof rawLine !== 'object') return null;
  const add = rawLine.options_to_add;
  if (!Array.isArray(add) || add.length === 0) return null;
  const compact = add.map((o) => ({
    title: o.title || o.name || '',
    price: num(o.price, 0),
  }));
  return stableJson(compact);
}

/**
 * Firestore 라인 + (가능하면) rawUrbanPiper.order.items 와 병합 → SQLite order_items용 행.
 */
function buildOrderItemRowsForSqlite(order) {
  const lines = Array.isArray(order.items) ? order.items : [];
  const rawItems = order.rawUrbanPiper?.order?.items;
  const rawArr = Array.isArray(rawItems) ? rawItems : null;

  const { tax: orderTax } = getOrderLevelAmounts(order);
  const lineSubs = lines.map((it) => num(it.price, 0) * num(it.quantity, 1));
  const sumSub = lineSubs.reduce((a, b) => a + b, 0);

  return lines.map((it, idx) => {
    const qty = Math.max(1, Math.round(num(it.quantity, 1)));
    const price = num(it.price, 0);
    const lineSub = price * qty;
    let lineTax = 0;
    let modJson = null;

    if (rawArr && rawArr[idx]) {
      lineTax = sumTaxesFromUpLine(rawArr[idx]);
      modJson = modifiersJsonFromRawLine(rawArr[idx]);
    } else if (orderTax > 0 && sumSub > 0.0001) {
      lineTax = (orderTax * lineSub) / sumSub;
    }

    lineTax = Math.round(lineTax * 100) / 100;
    const lineRate = lineSub > 0.0001 ? (lineTax / lineSub) * 100 : 0;

    const opts = it.options;
    if (!modJson && Array.isArray(opts) && opts.length) {
      modJson = stableJson(
        opts.map((o) => ({
          title: o.optionName || o.choiceName || o.title || '',
          price: num(o.price, 0),
        }))
      );
    }

    return {
      item_id: it.id != null ? it.id : null,
      name: String(it.name || '').trim() || 'Item',
      quantity: qty,
      price,
      tax: lineTax,
      tax_rate: Math.round(lineRate * 10000) / 10000,
      modifiers_json: modJson,
    };
  });
}

module.exports = {
  getOrderLevelAmounts,
  buildTaxBreakdownJson,
  extractPlatformExternalOrderId,
  inferChannelSlug,
  inferOrderSource,
  buildOrderItemRowsForSqlite,
};
