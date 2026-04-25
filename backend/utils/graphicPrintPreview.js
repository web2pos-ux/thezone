/**
 * Graphic print preview — builds the same PNG slices used inside ESC/POS graphic jobs
 * (renderKitchenTicketGraphic / renderReceiptGraphic / renderBillGraphic with exportFormat "png").
 */

const fs = require('fs');
const path = require('path');

const _presetCache = new Map();

function deepClone(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return obj && typeof obj === 'object' ? { ...obj } : obj;
  }
}

function clampGraphicScale(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1.0;
  return Math.min(1.5, Math.max(0.5, Number(n.toFixed(2))));
}

function resolvePrinterPresetsDir() {
  const candidates = [
    path.join(__dirname, '..', 'printer-presets'),
    path.join(__dirname, '..', 'backend', 'printer-presets'),
  ];
  for (const d of candidates) {
    try {
      if (fs.existsSync(d)) return d;
    } catch {
      /* ignore */
    }
  }
  return candidates[0];
}

function loadPrintPreset(presetId) {
  const id = String(presetId || '').trim();
  if (!id) return null;
  if (_presetCache.has(id)) return _presetCache.get(id);
  try {
    const presetPath = path.join(resolvePrinterPresetsDir(), `${id}.json`);
    const raw = fs.readFileSync(presetPath, 'utf8');
    const parsed = JSON.parse(raw);
    const obj = parsed && typeof parsed === 'object' ? parsed : null;
    _presetCache.set(id, obj);
    return obj;
  } catch (e) {
    console.warn(`[graphicPrintPreview] preset load failed (${id}):`, e?.message || e);
    _presetCache.set(id, null);
    return null;
  }
}

function getLockedPresetIdFromPrintData(printData) {
  const v = printData?.layoutLock ?? printData?.layout_lock ?? process.env.PRINT_LAYOUT_LOCK ?? '';
  const id = String(v || '').trim();
  return id || null;
}

async function fillKitchenTableName(ticketData, orderInfo, orderData, dbGet) {
  try {
    const hasTableName = !!(
      ticketData?.tableName ||
      ticketData?.header?.tableName ||
      orderInfo?.tableName ||
      orderData?.tableName
    );
    if (!hasTableName) {
      const candidates = [
        ticketData?.tableId,
        ticketData?.table_id,
        ticketData?.header?.tableId,
        ticketData?.header?.table_id,
        orderInfo?.tableId,
        orderInfo?.table_id,
        orderData?.tableId,
        orderData?.table_id,
        ticketData?.table,
        ticketData?.header?.table,
        orderInfo?.table,
        orderData?.table,
      ].filter((v) => v !== undefined && v !== null && String(v).trim() !== '');

      const directName = candidates.find((v) => typeof v === 'string' && /^T\d+/i.test(v.trim()));
      if (directName) {
        ticketData.tableName = String(directName).trim();
        ticketData.header = ticketData.header || {};
        ticketData.header.tableName = ticketData.header.tableName || ticketData.tableName;
      } else {
        const tableId = candidates.find((v) => String(v).trim().length >= 4);
        if (tableId) {
          const row = await dbGet(
            'SELECT name FROM table_map_elements WHERE element_id = ? LIMIT 1',
            [String(tableId)]
          );
          if (row?.name) {
            ticketData.tableName = row.name;
            ticketData.header = ticketData.header || {};
            ticketData.header.tableName = ticketData.header.tableName || row.name;
          }
        }
      }
    }
  } catch {
    /* non-blocking */
  }
}

async function resolveKitchenMarginsAndPadding(dbGet, orderInfo, orderData, lockedPresetId) {
  let effectiveTopMargin = null;
  let effectiveRightPadding = null;

  if (lockedPresetId) {
    const preset = loadPrintPreset(lockedPresetId);
    const ls = preset?.lockedSettings || null;
    if (ls) {
      const ch = (orderInfo?.channel || orderInfo?.orderType || orderData?.channel || orderData?.orderType || 'DINE-IN').toUpperCase();
      let channelLayout = null;
      if (ch === 'DELIVERY') channelLayout = ls.deliveryKitchen;
      else if (ch === 'TOGO' || ch === 'ONLINE' || ch === 'PICKUP') channelLayout = ls.externalKitchen;
      else channelLayout = ls.dineInKitchen;
      const presetTop =
        channelLayout?.kitchenPrinter?.topMargin ??
        channelLayout?.topMargin ??
        ls.kitchenLayout?.topMargin ??
        ls.kitchen?.topMargin ??
        ls.topMargin ??
        undefined;
      const tm = Number(presetTop);
      if (presetTop != null && Number.isFinite(tm) && tm >= 0) effectiveTopMargin = tm;
    }
  }

  if (effectiveTopMargin == null) {
    try {
      const layoutRow = await dbGet('SELECT settings FROM printer_layout_settings WHERE id = 1');
      if (layoutRow && layoutRow.settings) {
        const ls = JSON.parse(layoutRow.settings);
        const ch = (orderInfo?.channel || orderInfo?.orderType || orderData?.channel || orderData?.orderType || 'DINE-IN').toUpperCase();
        let channelLayout = null;
        if (ch === 'DELIVERY') channelLayout = ls.deliveryKitchen;
        else if (ch === 'TOGO' || ch === 'ONLINE' || ch === 'PICKUP') channelLayout = ls.externalKitchen;
        else channelLayout = ls.dineInKitchen;
        const dbTop =
          channelLayout?.kitchenPrinter?.topMargin ??
          channelLayout?.topMargin ??
          ls.kitchenLayout?.topMargin ??
          ls.kitchen?.topMargin ??
          ls.topMargin ??
          undefined;
        if (dbTop != null) {
          const tm = Number(dbTop);
          if (Number.isFinite(tm) && tm >= 0) effectiveTopMargin = tm;
        }
        const dbRp =
          channelLayout?.kitchenPrinter?.rightPaddingPx ??
          channelLayout?.rightPaddingPx ??
          ls.kitchenLayout?.rightPaddingPx ??
          ls.kitchen?.rightPaddingPx ??
          ls.rightPaddingPx ??
          undefined;
        if (dbRp != null) {
          const rp = Number(dbRp);
          if (Number.isFinite(rp) && rp >= 0) effectiveRightPadding = rp;
        }
      }
    } catch {
      /* ignore */
    }
  }
  if (effectiveTopMargin == null) effectiveTopMargin = 15;
  return { effectiveTopMargin, effectiveRightPadding };
}

async function buildKitchenPng(dbGet, mergeItemsForPrint, body) {
  const { renderKitchenTicketGraphic } = require('./graphicPrinterUtils');
  const orderData = body.orderData;
  const items = body.items;
  const orderInfo = body.orderInfo || orderData?.orderInfo || {};
  const orderDataRoot = orderData || {};

  let ticketData;
  if (orderData && typeof orderData === 'object') {
    ticketData = deepClone(orderData);
    if (!ticketData.items && Array.isArray(items)) ticketData.items = items;
  } else {
    ticketData = {
      items: Array.isArray(items) ? [...items] : [],
      ...deepClone(orderInfo),
      isPaid: body.isPaid,
      isReprint: body.isReprint,
      isAdditionalOrder: body.isAdditionalOrder,
    };
  }

  await fillKitchenTableName(ticketData, orderInfo || {}, orderDataRoot, dbGet);

  const lockedId = getLockedPresetIdFromPrintData(orderDataRoot || orderInfo || body);
  const { effectiveTopMargin, effectiveRightPadding } = await resolveKitchenMarginsAndPadding(
    dbGet,
    orderInfo,
    orderDataRoot,
    lockedId
  );
  ticketData.topMargin = effectiveTopMargin;
  if (effectiveRightPadding != null && effectiveRightPadding >= 0) {
    ticketData.rightPaddingPx = effectiveRightPadding;
  }

  if (Array.isArray(ticketData.items)) {
    ticketData.items = mergeItemsForPrint(ticketData.items);
  }

  try {
    const row = await dbGet(
      `SELECT COALESCE(graphic_scale, 1.0) AS graphic_scale FROM printers WHERE is_active = 1 AND (type LIKE '%kitchen%' OR LOWER(name) LIKE '%kitchen%') LIMIT 1`
    );
    const gs = Number(row?.graphic_scale);
    if (Number.isFinite(gs) && gs > 0) ticketData.graphicScale = clampGraphicScale(gs);
  } catch {
    /* ignore */
  }

  ticketData.isKitchenPrinter = true;
  if (body.showLabel && body.printerGroupName) {
    ticketData.printerLabel = body.printerGroupName;
  }

  return renderKitchenTicketGraphic(ticketData, 'png');
}

async function applyStoreHeader(dbGet, receiptLike, { isBadString, cleanString, joinAddressParts }) {
  const businessInfo = await dbGet(
    'SELECT business_name, phone, address_line1, address_line2, city, state, zip FROM business_profile LIMIT 1'
  );
  if (!businessInfo) return;
  const fullAddress = joinAddressParts([
    businessInfo.address_line1,
    businessInfo.address_line2,
    businessInfo.city,
    businessInfo.state,
    businessInfo.zip,
  ]);
  receiptLike.header = receiptLike.header || {};
  receiptLike.header.storeName = receiptLike.header.storeName || businessInfo.business_name;
  receiptLike.header.storeAddress = isBadString(receiptLike.header.storeAddress)
    ? fullAddress
    : receiptLike.header.storeAddress || fullAddress;
  receiptLike.header.storePhone = isBadString(receiptLike.header.storePhone)
    ? cleanString(businessInfo.phone)
    : receiptLike.header.storePhone || cleanString(businessInfo.phone);
  receiptLike.storeName = receiptLike.storeName || businessInfo.business_name;
  receiptLike.storeAddress = isBadString(receiptLike.storeAddress) ? fullAddress : receiptLike.storeAddress || fullAddress;
  receiptLike.storePhone = isBadString(receiptLike.storePhone)
    ? cleanString(businessInfo.phone)
    : receiptLike.storePhone || cleanString(businessInfo.phone);
}

async function attachReceiptLayoutFromDb(dbGet, receiptData, lockedPresetId) {
  if (lockedPresetId) return;
  const layoutRowReceipt = await dbGet('SELECT settings FROM printer_layout_settings WHERE id = 1');
  if (!layoutRowReceipt?.settings) {
    if (receiptData.paperWidth == null) receiptData.paperWidth = 80;
    return;
  }
  try {
    const layoutSettings = JSON.parse(layoutRowReceipt.settings);
    receiptData.layout = layoutSettings.receiptLayout || layoutSettings.receipt || receiptData.layout || null;
    const dbTop =
      layoutSettings.receiptLayout?.topMargin ??
      layoutSettings.receipt?.topMargin ??
      layoutSettings.topMargin ??
      undefined;
    if (dbTop != null) {
      const tm = Number(dbTop);
      if (Number.isFinite(tm) && tm >= 0) receiptData.topMargin = tm;
    }
    const receiptPaperWidth =
      layoutSettings.receiptLayout?.paperWidth ||
      layoutSettings.receipt?.paperWidth ||
      layoutSettings.paperWidth ||
      80;
    receiptData.paperWidth = receiptPaperWidth;
    const rp =
      layoutSettings.receiptLayout?.rightPaddingPx ??
      layoutSettings.receiptLayout?.rightPadding ??
      layoutSettings.receipt?.rightPaddingPx ??
      layoutSettings.receipt?.rightPadding ??
      layoutSettings.rightPaddingPx ??
      layoutSettings.rightPadding ??
      null;
    const rpn = Number(rp);
    if (Number.isFinite(rpn) && rpn >= 0) {
      receiptData.rightPaddingPx = rpn;
    }
  } catch {
    receiptData.paperWidth = receiptData.paperWidth ?? 80;
  }
}

async function attachBillLayoutFromDb(dbGet, billData, lockedPresetId) {
  if (lockedPresetId) return;
  const layoutRow = await dbGet('SELECT settings FROM printer_layout_settings WHERE id = 1');
  if (!layoutRow?.settings) {
    if (billData.paperWidth == null) billData.paperWidth = 80;
    return;
  }
  try {
    const layoutSettings = JSON.parse(layoutRow.settings);
    billData.layout = layoutSettings.billLayout || layoutSettings.bill || billData.layout || null;
    const dbTop =
      layoutSettings.billLayout?.topMargin ??
      layoutSettings.bill?.topMargin ??
      layoutSettings.topMargin ??
      undefined;
    if (dbTop != null) {
      const tm = Number(dbTop);
      if (Number.isFinite(tm) && tm >= 0) billData.topMargin = tm;
    }
    const billPaperWidth =
      layoutSettings.billLayout?.paperWidth ||
      layoutSettings.bill?.paperWidth ||
      layoutSettings.paperWidth ||
      80;
    billData.paperWidth = billPaperWidth;
    const rp =
      layoutSettings.billLayout?.rightPaddingPx ??
      layoutSettings.billLayout?.rightPadding ??
      layoutSettings.bill?.rightPaddingPx ??
      layoutSettings.bill?.rightPadding ??
      layoutSettings.rightPaddingPx ??
      layoutSettings.rightPadding ??
      null;
    const rpn = Number(rp);
    if (Number.isFinite(rpn) && rpn >= 0) {
      billData.rightPaddingPx = rpn;
    }
  } catch {
    billData.paperWidth = billData.paperWidth ?? 80;
  }
}

async function applyGraphicScaleFromFrontPrinter(dbGet, dataObj) {
  try {
    const frontPrinter = await dbGet(
      "SELECT selected_printer FROM printers WHERE name LIKE '%Front%' OR name LIKE '%Receipt%' LIMIT 1"
    );
    const targetPrinter = frontPrinter?.selected_printer;
    if (!targetPrinter) return;
    const row = await dbGet(
      'SELECT graphic_scale FROM printers WHERE is_active = 1 AND selected_printer = ? LIMIT 1',
      [targetPrinter]
    );
    const gs = Number(row?.graphic_scale);
    if (Number.isFinite(gs) && gs > 0) dataObj.graphicScale = clampGraphicScale(gs);
  } catch {
    /* ignore */
  }
}

async function buildReservationConfirmPng(dbGet, body) {
  const { renderReservationConfirmGraphic } = require('./graphicPrinterUtils');
  const raw =
    body.reservationConfirm && typeof body.reservationConfirm === 'object'
      ? body.reservationConfirm
      : body;
  const data = deepClone(raw);

  const layoutRow = await dbGet('SELECT settings FROM printer_layout_settings WHERE id = 1');
  let paperWidth = 80;
  let topMargin = 5;
  let rightPaddingPx = null;
  if (layoutRow?.settings) {
    try {
      const ls = JSON.parse(layoutRow.settings);
      const rw = ls.receiptLayout?.paperWidth ?? ls.receipt?.paperWidth ?? ls.paperWidth;
      if (rw === 58 || rw === 80) paperWidth = rw;
      const tm = Number(ls.receiptLayout?.topMargin ?? ls.receipt?.topMargin ?? ls.topMargin);
      if (Number.isFinite(tm) && tm >= 0) topMargin = tm;
      const rp = Number(
        ls.receiptLayout?.rightPaddingPx ??
          ls.receiptLayout?.rightPadding ??
          ls.receipt?.rightPaddingPx ??
          ls.receipt?.rightPadding ??
          ls.rightPaddingPx ??
          ls.rightPadding
      );
      if (Number.isFinite(rp) && rp >= 0) rightPaddingPx = Math.round(rp);
    } catch {
      /* ignore */
    }
  }
  if (data.paperWidth == null) data.paperWidth = paperWidth;
  if (data.topMargin == null) data.topMargin = topMargin;
  if (rightPaddingPx != null && data.rightPaddingPx == null) data.rightPaddingPx = rightPaddingPx;

  await applyGraphicScaleFromFrontPrinter(dbGet, data);
  return renderReservationConfirmGraphic(data, 'png');
}

async function buildReceiptPng(dbGet, mergeItemsForPrint, body, helpers) {
  const { renderReceiptGraphic } = require('./graphicPrinterUtils');
  const { isBadString, cleanString, joinAddressParts } = helpers;

  let receiptData = deepClone(body.receiptData || body);
  const lockedPresetId = getLockedPresetIdFromPrintData(receiptData || body);

  if (lockedPresetId) {
    receiptData.layoutLock = lockedPresetId;
    const preset = loadPrintPreset(lockedPresetId);
    const meta = preset?.lockedSettings?.receiptLayout || null;
    if (meta) {
      const tm = Number(meta.topMargin);
      if (meta.topMargin != null && Number.isFinite(tm) && tm >= 0) receiptData.topMargin = tm;
      const pw = Number(meta.paperWidth);
      if (Number.isFinite(pw) && (pw === 58 || pw === 80)) receiptData.paperWidth = pw;
      const rp = Number(meta.rightPaddingPx ?? meta.rightPadding);
      if (Number.isFinite(rp) && rp >= 0) receiptData.rightPaddingPx = Math.round(rp);
    }
    receiptData.layout = null;
  }

  await applyStoreHeader(dbGet, receiptData, { isBadString, cleanString, joinAddressParts });

  if (Array.isArray(receiptData.items) && receiptData.items.length > 0) {
    receiptData.items = mergeItemsForPrint(receiptData.items);
  }

  await attachReceiptLayoutFromDb(dbGet, receiptData, lockedPresetId);
  if (lockedPresetId && receiptData.paperWidth == null) receiptData.paperWidth = 80;

  await applyGraphicScaleFromFrontPrinter(dbGet, receiptData);

  return renderReceiptGraphic(receiptData, 'png');
}

async function buildBillPng(dbGet, mergeItemsForPrint, body, helpers) {
  const { renderBillGraphic } = require('./graphicPrinterUtils');
  const { isBadString, cleanString, joinAddressParts } = helpers;

  let billData = deepClone(body.billData || body);
  const lockedPresetId = getLockedPresetIdFromPrintData(billData || body);

  if (lockedPresetId) {
    billData.layoutLock = lockedPresetId;
    const preset = loadPrintPreset(lockedPresetId);
    const meta = preset?.lockedSettings?.billLayout || null;
    if (meta) {
      const tm = Number(meta.topMargin);
      if (meta.topMargin != null && Number.isFinite(tm) && tm >= 0) billData.topMargin = tm;
      const pw = Number(meta.paperWidth);
      if (Number.isFinite(pw) && (pw === 58 || pw === 80)) billData.paperWidth = pw;
      const rp = Number(meta.rightPaddingPx ?? meta.rightPadding);
      if (Number.isFinite(rp) && rp >= 0) billData.rightPaddingPx = Math.round(rp);
    }
    billData.layout = null;
  }

  await applyStoreHeader(dbGet, billData, { isBadString, cleanString, joinAddressParts });

  if (Array.isArray(billData.items) && billData.items.length > 0) {
    billData.items = mergeItemsForPrint(billData.items);
  }
  if (Array.isArray(billData.guestSections)) {
    billData.guestSections.forEach((section) => {
      if (Array.isArray(section.items) && section.items.length > 0) {
        section.items = mergeItemsForPrint(section.items);
      }
    });
  }

  const payloadPaperWidth = Number(billData?.paperWidth);
  const payloadPaperWidthMm =
    Number.isFinite(payloadPaperWidth) && (payloadPaperWidth === 58 || payloadPaperWidth === 80)
      ? payloadPaperWidth
      : null;
  if (payloadPaperWidthMm != null) billData.paperWidth = payloadPaperWidthMm;

  const payloadRightPaddingRaw = billData?.rightPaddingPx ?? billData?.rightPadding ?? null;
  const payloadRightPaddingPx = Number(payloadRightPaddingRaw);
  const payloadRightPaddingFinite =
    Number.isFinite(payloadRightPaddingPx) && payloadRightPaddingPx >= 0 ? payloadRightPaddingPx : null;
  if (payloadRightPaddingFinite != null) billData.rightPaddingPx = payloadRightPaddingFinite;

  await attachBillLayoutFromDb(dbGet, billData, lockedPresetId);
  if (billData.rightPaddingPx == null) billData.rightPaddingPx = 0;

  await applyGraphicScaleFromFrontPrinter(dbGet, billData);

  return renderBillGraphic(billData, 'png');
}

function readPngDimensions(pngBuffer) {
  try {
    if (!pngBuffer || pngBuffer.length < 24) return { width: null, height: null };
    const width = pngBuffer.readUInt32BE(16);
    const height = pngBuffer.readUInt32BE(20);
    return { width, height };
  } catch {
    return { width: null, height: null };
  }
}

/**
 * @param {object} opts
 * @param {Function} opts.dbGet
 * @param {Function} opts.mergeItemsForPrint
 * @param {'kitchen'|'receipt'|'bill'|'reservation_confirm'} opts.kind
 * @param {object} opts.body — same JSON body as print-order / print-receipt / print-bill
 * @param {object} opts.helpers — isBadString, cleanString, joinAddressParts (from printers route)
 */
async function buildPngBuffer(opts) {
  const { dbGet, mergeItemsForPrint, kind, body, helpers } = opts;
  if (kind === 'kitchen') {
    return buildKitchenPng(dbGet, mergeItemsForPrint, body);
  }
  if (kind === 'receipt') {
    return buildReceiptPng(dbGet, mergeItemsForPrint, body, helpers);
  }
  if (kind === 'bill') {
    return buildBillPng(dbGet, mergeItemsForPrint, body, helpers);
  }
  if (kind === 'reservation_confirm') {
    return buildReservationConfirmPng(dbGet, body);
  }
  throw new Error(`Unsupported preview kind: ${kind}`);
}

module.exports = {
  buildPngBuffer,
  readPngDimensions,
};
