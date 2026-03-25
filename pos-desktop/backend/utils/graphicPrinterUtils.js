/**
 * 그래픽 모드 프린터 유틸리티
 * 텍스트를 이미지로 렌더링하여 ESC/POS 비트맵으로 출력
 */

const { createCanvas, registerFont } = require('canvas');
const path = require('path');
const fs = require('fs');

// Keep font family string consistent across the file.
// (A missing FONT_FAMILY caused graphic Kitchen Ticket to crash and fall back to TEXT mode.)
const FONT_FAMILY = 'Arial", "Malgun Gothic", sans-serif';

// 한글 폰트 등록 (지연 로딩 - 첫 렌더링 전 1회 실행)
let _fontRegistered = false;
function ensureFontsRegistered() {
  if (_fontRegistered) return;
  _fontRegistered = true;
  try {
    const fontPaths = [
      { path: 'C:\\Windows\\Fonts\\malgunbd.ttf', family: 'Malgun Gothic', weight: 'bold', style: 'normal' },
      { path: 'C:\\Windows\\Fonts\\malgun.ttf', family: 'Malgun Gothic', weight: 'normal', style: 'normal' },
    ];
    for (const f of fontPaths) {
      if (fs.existsSync(f.path)) {
        registerFont(f.path, { family: f.family, weight: f.weight, style: f.style });
        console.log(`[GraphicPrinter] ${f.family} (${f.weight}) font registered`);
      }
    }
  } catch (fontErr) {
    console.warn('[GraphicPrinter] Font registration skipped:', fontErr.message);
  }
}

// 프린터 설정 (폰트 사이즈 15% 증가 적용)
const PRINTER_CONFIG = {
  width: 576,           // 80mm 용지 기준 (203 DPI)
  dpi: 203,
  charWidth: 42,        // 42자 기준
  lineHeight: 28,       // 기본 줄 높이 (15% 증가)
  padding: 10,          // 좌우 여백
  margin: 10,           // 좌우 마진
  fontSize: {
    small: 18,          // 16 * 1.15 = 18
    normal: 23,         // 20 * 1.15 = 23
    large: 32,          // 28 * 1.15 = 32
    xlarge: 41,         // 36 * 1.15 = 41
    xxlarge: 55         // 48 * 1.15 = 55
  }
};

function clampNumber(n, min, max, fallback) {
  const num = Number(n);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function getLayoutFromPrintData(data) {
  return data?.layout || data?.layoutSettings || data?._layout || data?.receiptLayout || data?.billLayout || null;
}

let _lockedPresetCache = new Map();
function loadPrintPreset(presetId) {
  const id = String(presetId || '').trim();
  if (!id) return null;
  if (_lockedPresetCache.has(id)) return _lockedPresetCache.get(id);
  try {
    const presetPath = path.join(__dirname, '..', 'printer-presets', `${id}.json`);
    const raw = fs.readFileSync(presetPath, 'utf8');
    const parsed = JSON.parse(raw);
    const obj = (parsed && typeof parsed === 'object') ? parsed : null;
    _lockedPresetCache.set(id, obj);
    return obj;
  } catch (e) {
    console.warn(`[GraphicPrinter] preset load failed (${id}):`, e?.message || e);
    _lockedPresetCache.set(id, null);
    return null;
  }
}

function getLockedPresetId(printData) {
  const v = printData?.layoutLock ?? printData?.layout_lock ?? process.env.PRINT_LAYOUT_LOCK ?? '';
  const id = String(v || '').trim();
  return id || null;
}

function applyLockedPresetLayout(baseLayout, presetLayout) {
  const base = (baseLayout && typeof baseLayout === 'object') ? baseLayout : null;
  const preset = (presetLayout && typeof presetLayout === 'object') ? presetLayout : null;
  if (!preset) return baseLayout || null;
  const merged = { ...(base || {}), ...preset };
  // Preserve runtime-controlled margins if they exist in base.
  if (base && Object.prototype.hasOwnProperty.call(base, 'topMargin')) merged.topMargin = base.topMargin;
  if (base && Object.prototype.hasOwnProperty.call(base, 'leftMargin')) merged.leftMargin = base.leftMargin;
  return merged;
}

function normalizeGraphicTextStyle(style, defaults) {
  const s = style && typeof style === 'object' ? style : {};
  const fontSize = Number.isFinite(Number(s.fontSize)) ? Number(s.fontSize) : defaults.fontSize;
  const fwRaw = (s.fontWeight || defaults.fontWeight || 'normal').toString().toLowerCase();
  const extraBold = fwRaw === 'extrabold';
  const fontWeight = (fwRaw === 'bold' || fwRaw === 'extrabold') ? 'bold' : 'normal';
  const fontStyle = s.isItalic ? 'italic' : (defaults.fontStyle || 'normal');
  const align = (s.textAlign || defaults.align || 'left');
  const inverse = (typeof s.inverse === 'boolean') ? s.inverse : !!defaults.inverse;
  const lineHeightRaw = s.lineHeight ?? s.lineSpacing ?? s.lineSpace ?? null;
  const lh = Number(lineHeightRaw);
  const lineHeight = (Number.isFinite(lh) && lh > 0) ? lh : null;
  return { fontSize, fontWeight, fontStyle, align, inverse, extraBold, lineHeight };
}

function getGraphicElementStyle(layout, key, defaults) {
  const raw = (layout && typeof layout === 'object') ? layout[key] : null;
  const visible =
    raw && typeof raw === 'object' && typeof raw.visible === 'boolean'
      ? raw.visible
      : true;
  const lineSpacingRaw = raw && typeof raw === 'object' ? (raw.lineSpacing ?? raw.lineSpace ?? 0) : 0;
  const lineSpacing = Math.max(0, Math.round(Number(lineSpacingRaw) || 0));

  const base = normalizeGraphicTextStyle(raw, defaults);
  const fontSize = clampNumber(base.fontSize, 6, 200, defaults.fontSize);

  return {
    visible,
    lineSpacing,
    fontSize,
    fontWeight: base.fontWeight,
    fontStyle: base.fontStyle,
    align: base.align,
    inverse: base.inverse,
    extraBold: base.extraBold,
    lineHeight: base.lineHeight
  };
}

// Graphic mode font scaling:
// - Use `graphicScale` (0.5 ~ 1.5) to adjust output size in bitmap mode (per-device override supported).
// - We intentionally do NOT read legacy `fontScale` here to avoid unexpectedly enlarging existing installs.
function getGraphicScaleFromData(data) {
  const raw = data?.graphicScale ?? data?.graphicsScale ?? null;
  return clampNumber(raw, 0.5, 1.5, 1.0);
}

// 용지 너비별 설정 (58mm = 384px, 80mm = 576px)
const getPrinterWidth = (paperWidth) => {
  if (paperWidth === 58 || paperWidth === '58mm') return 384;
  if (paperWidth === 80 || paperWidth === '80mm') return 576;
  if (typeof paperWidth === 'number' && paperWidth > 100) return paperWidth; // 직접 픽셀 지정
  return 576; // 기본값 80mm
};

// ESC/POS 명령어
const ESC_POS = {
  INIT: Buffer.from([0x1B, 0x40]),
  CUT: Buffer.from([0x1D, 0x56, 0x41, 0x03]),
  OPEN_DRAWER: Buffer.from([0x1B, 0x70, 0x00, 0x19, 0x19]),
  LINE_FEED: Buffer.from([0x0A]),
  // ESC J n - print and feed paper by n dots (0~255)
  FEED_DOTS: (n) => Buffer.from([0x1B, 0x4A, Math.max(0, Math.min(255, Number(n) || 0))]),
  // ESC d n - print and feed paper by n lines (0~255) (more widely supported than dot-feed on some models)
  FEED_LINES: (n) => Buffer.from([0x1B, 0x64, Math.max(0, Math.min(255, Number(n) || 0))]),
  // GS v 0 - 래스터 비트 이미지 명령
  RASTER_BIT_IMAGE: (width, height) => {
    const xL = (width / 8) & 0xFF;
    const xH = ((width / 8) >> 8) & 0xFF;
    const yL = height & 0xFF;
    const yH = (height >> 8) & 0xFF;
    return Buffer.from([0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH]);
  }
};

function pushFeedDots(buffers, dots) {
  const total = Math.max(0, Math.round(Number(dots) || 0));
  if (!total) return;
  let remaining = total;
  while (remaining > 0) {
    const chunk = Math.min(255, remaining);
    buffers.push(ESC_POS.FEED_DOTS(chunk));
    remaining -= chunk;
  }
}

function pushFeedLines(buffers, lines) {
  const total = Math.max(0, Math.round(Number(lines) || 0));
  if (!total) return;
  let remaining = total;
  while (remaining > 0) {
    const chunk = Math.min(255, remaining);
    buffers.push(ESC_POS.FEED_LINES(chunk));
    remaining -= chunk;
  }
}

function pushLineFeeds(buffers, lines) {
  const total = Math.max(0, Math.round(Number(lines) || 0));
  if (!total) return;
  for (let i = 0; i < total; i++) buffers.push(ESC_POS.LINE_FEED);
}

function pushBlankLineFeeds(buffers, lines) {
  const total = Math.max(0, Math.round(Number(lines) || 0));
  if (!total) return;
  // Some printers ignore LF when nothing was printed yet.
  // Printing a single space then LF forces "print+feed" behavior.
  const chunkLines = Math.min(512, total);
  const chunk = Buffer.alloc(chunkLines * 2);
  for (let i = 0; i < chunkLines; i++) {
    chunk[i * 2] = 0x20; // space
    chunk[i * 2 + 1] = 0x0A; // LF
  }
  let remaining = total;
  while (remaining > 0) {
    const take = Math.min(chunkLines, remaining);
    buffers.push(take === chunkLines ? chunk : chunk.subarray(0, take * 2));
    remaining -= take;
  }
}

// Delivery 채널명 표시 표준화 (출력용)
function normalizeDeliveryCompanyName(name) {
  const raw = (name || '').toString().trim();
  if (!raw) return '';
  const upper = raw.toUpperCase().replace(/\s+/g, '');
  const map = {
    UBEREATS: 'UberEats',
    UBER: 'UberEats',
    'UBER EATS': 'UberEats',
    DOORDASH: 'DoorDash',
    DOORASH: 'DoorDash',
    'DOOR DASH': 'DoorDash',
    'D DASH': 'DoorDash',
    SKIPTHEDISHES: 'SkipTheDishes',
    SKIP: 'SkipTheDishes',
    'SKIP THE DISHES': 'SkipTheDishes',
    FANTUAN: 'Fantuan',
    'F TUAN': 'Fantuan',
    THEZONE: 'TheZone',
    GRUBHUB: 'Grubhub',
  };
  // allow both compact-key and original spaced key
  return map[upper] || map[raw.toUpperCase()] || raw;
}

// Kitchen Ticket 헤더용: 딜리버리 채널 약어 표기
function getKitchenDeliveryCompanyLabel(name) {
  const normalized = normalizeDeliveryCompanyName(name);
  const key = (normalized || '').toString().toUpperCase().replace(/\s+/g, '');
  const map = {
    UBEREATS: 'UBER',
    DOORDASH: 'DDASH',
    SKIPTHEDISHES: 'SKIP',
    FANTUAN: 'FANTUAN',
  };
  return map[key] || normalized || '';
}

/**
 * 이미지를 ESC/POS 래스터 비트맵으로 변환
 * @param {Buffer} imageData - RGBA 이미지 데이터
 * @param {number} width - 이미지 너비
 * @param {number} height - 이미지 높이
 * @returns {Buffer} ESC/POS 비트맵 데이터
 */
function imageToEscPosRaster(imageData, width, height, graphicScale) {
  let srcData = imageData;
  let srcW = width;
  let srcH = height;

  const scale = Number(graphicScale);
  if (Number.isFinite(scale) && scale > 0 && Math.abs(scale - 1) > 0.01) {
    try {
      const newW = Math.round(width * scale);
      const newH = Math.round(height * scale);
      if (newW > 0 && newH > 0) {
        const srcCanvas = createCanvas(width, height);
        const srcCtx = srcCanvas.getContext('2d');
        const img = srcCtx.createImageData(width, height);
        Buffer.from(imageData.buffer || imageData).copy(Buffer.from(img.data.buffer));
        srcCtx.putImageData(img, 0, 0);

        const dstCanvas = createCanvas(newW, newH);
        const dstCtx = dstCanvas.getContext('2d');
        dstCtx.drawImage(srcCanvas, 0, 0, newW, newH);
        const dstImg = dstCtx.getImageData(0, 0, newW, newH);
        srcData = dstImg.data;
        srcW = newW;
        srcH = newH;
      }
    } catch (scaleErr) {
      console.error('[imageToEscPosRaster] Scale failed, using original size:', scaleErr.message);
    }
  }

  // 너비를 8의 배수로 맞춤
  const alignedWidth = Math.ceil(srcW / 8) * 8;
  const bytesPerRow = alignedWidth / 8;
  
  const bitmapData = [];
  
  for (let y = 0; y < srcH; y++) {
    for (let byteX = 0; byteX < bytesPerRow; byteX++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = byteX * 8 + bit;
        if (x < srcW) {
          const idx = (y * srcW + x) * 4;
          const r = srcData[idx];
          const g = srcData[idx + 1];
          const b = srcData[idx + 2];
          const a = srcData[idx + 3];
          
          // 그레이스케일 변환 후 이진화 (임계값 128)
          const gray = (r * 0.299 + g * 0.587 + b * 0.114);
          const isBlack = a > 128 && gray < 128;
          
          if (isBlack) {
            byte |= (0x80 >> bit);
          }
        }
      }
      bitmapData.push(byte);
    }
  }
  
  // ESC/POS 래스터 명령 + 비트맵 데이터
  const header = ESC_POS.RASTER_BIT_IMAGE(alignedWidth, srcH);
  return Buffer.concat([header, Buffer.from(bitmapData)]);
}

/**
 * 캔버스에 텍스트 블록 그리기
 * @param {CanvasRenderingContext2D} ctx - 캔버스 컨텍스트
 * @param {Object} block - 텍스트 블록 설정
 * @param {number} y - Y 위치
 * @returns {number} 다음 Y 위치
 */
function drawTextBlock(ctx, block, y) {
  const {
    text,
    fontSize: rawFontSize = PRINTER_CONFIG.fontSize.normal,
    fontWeight = 'normal',
    fontStyle = 'normal',
    align = 'left',
    inverse = false,
    lineHeight = null,
    paddingY = 4,
    extraBold = false,
    box = false,
    boxPaddingX = 20,
    strikethrough = false
  } = block;
  
  const fontSize = rawFontSize;
  const defaultLH = fontSize + paddingY * 2;
  const actualLineHeight = (lineHeight && lineHeight >= fontSize) ? lineHeight : defaultLH;
  const width = ctx._receiptWidth || PRINTER_CONFIG.width;
  const padding = ctx._receiptPadding || PRINTER_CONFIG.padding;
  const rightPadding = Number(ctx._receiptRightPadding || 0);
  const effectiveRightPad = Math.max(padding, rightPadding);
  
  ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px "Arial", "Malgun Gothic", sans-serif`;
  
  const textWidth = ctx.measureText(text).width;
  
  if (inverse) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, y, width, actualLineHeight);
    ctx.fillStyle = '#FFFFFF';
  } else {
    ctx.fillStyle = '#000000';
  }
  
  let textX;
  
  switch (align) {
    case 'center': {
      const usableWidth = width - padding - effectiveRightPad;
      textX = padding + (usableWidth - textWidth) / 2;
      break;
    }
    case 'right':
      textX = width - textWidth - effectiveRightPad;
      break;
    default:
      textX = padding;
  }
  
  if (box) {
    const boxX = textX - boxPaddingX;
    const boxY = y + 2;
    const boxWidth = textWidth + boxPaddingX * 2;
    const boxHeight = actualLineHeight - 4;
    
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 5;
    ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
  }
  
  ctx.textBaseline = 'middle';
  const textY = y + actualLineHeight / 2;
  
  if (extraBold) {
    ctx.fillText(text, textX + 0.4, textY);
    ctx.fillText(text, textX - 0.4, textY);
  }
  ctx.fillText(text, textX, textY);
  
  if (strikethrough) {
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = Math.max(2, Math.round(fontSize / 10));
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(textX - 2, textY);
    ctx.lineTo(textX + textWidth + 2, textY);
    ctx.stroke();
  }
  
  return y + actualLineHeight;
}

/**
 * 구분선 그리기
 * @param {CanvasRenderingContext2D} ctx - 캔버스 컨텍스트
 * @param {number} y - Y 위치
 * @param {string} style - 스타일 ('solid', 'dashed', 'double')
 * @returns {number} 다음 Y 위치
 */
function drawSeparator(ctx, y, style = 'solid') {
  const width = ctx._receiptWidth || PRINTER_CONFIG.width;
  const padding = ctx._receiptPadding || PRINTER_CONFIG.padding;
  const rightPadding = Number(ctx._receiptRightPadding || 0);
  const effectiveRightPad = Math.max(padding, rightPadding);
  const gap = 8;
  const lineY = y + gap;
  
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = style === 'double' ? 2 : 1;
  
  if (style === 'dashed') {
    ctx.setLineDash([8, 4]);
  } else {
    ctx.setLineDash([]);
  }
  
  ctx.beginPath();
  ctx.moveTo(padding, lineY);
  ctx.lineTo(width - effectiveRightPad, lineY);
  ctx.stroke();
  
  if (style === 'double') {
    ctx.beginPath();
    ctx.moveTo(padding, lineY + 4);
    ctx.lineTo(width - effectiveRightPad, lineY + 4);
    ctx.stroke();
    return y + 20;
  }
  
  return y + 16;
}

/**
 * 좌우 정렬 텍스트 그리기 (예: "Item     $10.00")
 * @param {CanvasRenderingContext2D} ctx - 캔버스 컨텍스트
 * @param {string} leftText - 왼쪽 텍스트
 * @param {string} rightText - 오른쪽 텍스트
 * @param {number} y - Y 위치
 * @param {Object} options - 옵션
 * @returns {number} 다음 Y 위치
 */
function drawLeftRightText(ctx, leftText, rightText, y, options = {}) {
  const {
    fontSize: rawFontSize = PRINTER_CONFIG.fontSize.normal,
    fontWeight = 'normal',
    inverse = false,
    lineHeight = null,
    paddingY = 4,
    extraBold = false
  } = options;
  
  const fontSize = rawFontSize;
  const defaultLH = fontSize + paddingY * 2;
  const actualLineHeight = (lineHeight && lineHeight >= fontSize) ? lineHeight : defaultLH;
  const width = ctx._receiptWidth || PRINTER_CONFIG.width;
  const padding = ctx._receiptPadding || PRINTER_CONFIG.padding;
  
  ctx.font = `${fontWeight} ${fontSize}px "Arial", "Malgun Gothic", sans-serif`;
  
  const rightWidth = ctx.measureText(rightText).width;
  const configuredRightPadding = Number(ctx._receiptRightPadding || 0);
  const safeRightPadding = Math.max(padding, configuredRightPadding);
  const rightX = width - rightWidth - safeRightPadding;
  
  const maxLeftWidth = rightX - padding - 5;
  
  let displayLeftText = leftText;
  let leftTextWidth = ctx.measureText(displayLeftText).width;
  if (leftTextWidth > maxLeftWidth && maxLeftWidth > 0) {
    while (ctx.measureText(displayLeftText + '...').width > maxLeftWidth && displayLeftText.length > 3) {
      displayLeftText = displayLeftText.slice(0, -1);
    }
    displayLeftText = displayLeftText + '...';
  }
  
  if (inverse) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, y, width, actualLineHeight);
    ctx.fillStyle = '#FFFFFF';
  } else {
    ctx.fillStyle = '#000000';
  }
  
  ctx.textBaseline = 'middle';
  const textY = y + actualLineHeight / 2;
  
  ctx.fillText(displayLeftText, padding, textY);
  ctx.fillText(rightText, width - rightWidth - safeRightPadding, textY);

  if (extraBold) {
    ctx.fillText(displayLeftText, padding + 0.4, textY);
    ctx.fillText(displayLeftText, padding - 0.4, textY);
    ctx.fillText(rightText, width - rightWidth - safeRightPadding + 0.4, textY);
    ctx.fillText(rightText, width - rightWidth - safeRightPadding - 0.4, textY);
  }
  
  return y + actualLineHeight;
}

/**
 * Kitchen Ticket 그래픽 렌더링
 * @param {Object} orderData - 주문 데이터
 * @returns {Buffer} ESC/POS 비트맵 데이터
 */
function renderKitchenTicketGraphic(orderData) {
  ensureFontsRegistered();
  // 상단 마진 (mm를 픽셀로 변환)
  const topMarginMm = orderData.topMargin || 5;
  const topMarginPx = Math.round(topMarginMm * 8);
  
  // 먼저 필요한 높이 계산 (15% 증가된 폰트 사이즈 반영)
  let estimatedHeight = 310 + topMarginPx; // 기본 헤더/푸터 + 상단 마진 (Delivery: PAID/고객정보 라인 여유 포함)
  
  // 프린터 라벨 높이 추가
  if (orderData.printerLabel) {
    estimatedHeight += 40; // 라벨 높이 (축소된 폰트)
  }
  
  const items = orderData.items || [];
  estimatedHeight += items.length * 92; // 각 아이템 (80 * 1.15)
  items.forEach(item => {
    if (item.modifiers) estimatedHeight += item.modifiers.length * 46; // 40 * 1.15
    if (item.memo || item.note) estimatedHeight += 46; // 40 * 1.15
  });
  // 주문 전체 Kitchen Note 높이 (그래픽 주방티켓 하단에 출력)
  try {
    const oi = orderData.orderInfo || orderData;
    let kn = oi?.kitchenNote ?? oi?.kitchen_note ?? orderData?.kitchenNote ?? orderData?.kitchen_note ?? oi?.specialInstructions ?? oi?.notes ?? '';
    if (typeof kn === 'object' && kn) kn = kn.text || kn.note || kn.name || '';
    kn = String(kn || '').trim();
    if (kn) {
      // title + separator + note lines + spacing (conservative to prevent clipping)
      estimatedHeight += 140;
      // Use a taller per-line estimate (Kitchen Memo is printed in a larger font)
      estimatedHeight += Math.min(740, Math.ceil(kn.length / 22) * 46);
    }
  } catch {}
  // 게스트 구분선 높이 추가 (두 줄 구분선 + 게스트 번호 + 두 줄 구분선)
  const guestCountForHeight = [...new Set(items.map(item => item.guestNumber || item.guest_number || 1))];
  if (guestCountForHeight.length > 1) {
    estimatedHeight += guestCountForHeight.length * 100; // 각 게스트 구분선 (8+5+5+12+32+8+5+5+10 = ~90, 여유분 포함)
  }
  // 하단 여백 추가 (잘림 방지)
  estimatedHeight += 92; // 80 * 1.15
  estimatedHeight = Math.max(estimatedHeight, 345); // 300 * 1.15
  
  // 캔버스 생성
  const canvas = createCanvas(PRINTER_CONFIG.width, estimatedHeight);
  const ctx = canvas.getContext('2d');
  
  ctx._receiptWidth = PRINTER_CONFIG.width;
  ctx._receiptPadding = PRINTER_CONFIG.padding;
  const kitchenRightPad = (() => {
    const v = orderData?.rightPaddingPx ?? orderData?.rightPadding ?? null;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return n;
    return 0;
  })();
  ctx._receiptRightPadding = kitchenRightPad;
  
  // 배경 흰색
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, PRINTER_CONFIG.width, estimatedHeight);
  
  // 상단 마진 적용 (위에서 계산한 topMarginPx 재사용)
  let y = topMarginPx;
  
  // 주문 정보 추출
  const header = orderData.header || {};
  const orderInfo = orderData.orderInfo || orderData;
  const orderNumber = header.orderNumber || orderInfo.orderNumber || orderData.orderNumber || '';
  const rawChannel = header.channel || orderInfo.channel || orderData.channel || orderInfo.orderType || orderData.orderType || 'DINE-IN';
  const channel = String(rawChannel || 'DINE-IN').toUpperCase();
  // table 또는 tableName 둘 다 지원 (프론트엔드에서 table로 보내는 경우 대응)
  const tableName = header.tableName || orderInfo.tableName || orderData.tableName || orderInfo.table || orderData.table || '';
  console.log(`🍳 [GRAPHIC-TABLE-DEBUG] header.tableName="${header.tableName}" orderInfo.tableName="${orderInfo.tableName}" orderData.tableName="${orderData.tableName}" orderInfo.table="${orderInfo.table}" orderData.table="${orderData.table}" => tableName="${tableName}" channel="${channel}"`);
  const customerName = orderInfo.customerName || orderData.customerName || '';
  const customerPhone = orderInfo.customerPhone || orderData.customerPhone || '';
  const deliveryCompanyRaw =
    orderInfo.deliveryCompany || orderInfo.deliveryChannel ||
    orderData.deliveryCompany || orderData.deliveryChannel ||
    header.deliveryCompany || header.deliveryChannel ||
    '';
  const deliveryCompany = normalizeDeliveryCompanyName(deliveryCompanyRaw);
  const deliveryOrderNumber =
    orderInfo.deliveryOrderNumber || orderInfo.externalOrderNumber ||
    orderData.deliveryOrderNumber || orderData.externalOrderNumber ||
    header.deliveryOrderNumber || header.externalOrderNumber || '';
  const orderTypeUpper = String(header.orderType || orderInfo.orderType || orderData.orderType || '').toUpperCase();
  const isDeliveryLike = channel === 'DELIVERY' || orderTypeUpper === 'DELIVERY' || !!deliveryCompany || !!deliveryOrderNumber;
  const pickupTime =
    orderInfo.pickupTime ||
    orderInfo.readyTimeLabel ||
    orderInfo.ready_time_label ||
    orderInfo.readyTime ||
    orderData.pickupTime ||
    orderData.readyTimeLabel ||
    orderData.ready_time_label ||
    orderData.readyTime ||
    '';
  const pickupMinutes =
    orderInfo.pickupMinutes ||
    orderInfo.pickup_minutes ||
    orderInfo.prepTime ||
    orderInfo.prep_time ||
    orderData.pickupMinutes ||
    orderData.pickup_minutes ||
    orderData.prepTime ||
    orderData.prep_time ||
    '';
  const kitchenNoteText = (() => {
    try {
      let kn = orderInfo?.kitchenNote ?? orderInfo?.kitchen_note ?? orderData?.kitchenNote ?? orderData?.kitchen_note ?? orderInfo?.specialInstructions ?? orderInfo?.notes ?? '';
      if (typeof kn === 'object' && kn) kn = kn.text || kn.note || kn.name || '';
      return String(kn || '').trim();
    } catch {
      return '';
    }
  })();
  const isPaid = orderData.isPaid || false;
  const isReprint = orderData.isReprint || false;
  const isAdditionalOrder = orderData.isAdditionalOrder || false;
  const printerLabel = orderData.printerLabel || null;
  const LABEL_FONT_SIZE = Math.round(PRINTER_CONFIG.fontSize.xxlarge / 2);
  
  // === 프린터 라벨 (최상단 - 프린터 그룹명 표시) ===
  if (printerLabel) {
    y = drawTextBlock(ctx, {
      text: `[ ${printerLabel.toUpperCase()} ]`,
      fontSize: Math.round(PRINTER_CONFIG.fontSize.xxlarge / 2),
      fontWeight: 'bold',
      align: 'center',
      inverse: false
    }, y);
    y += 5;
  }
  
  // === REPRINT / ADDITIONAL 배너 (헤더 위 최상단) ===
  const statusFontSize = Math.round(PRINTER_CONFIG.fontSize.xxlarge * 0.8);
  if (isReprint) {
    y = drawTextBlock(ctx, {
      text: '** REPRINT **',
      fontSize: statusFontSize,
      fontWeight: 'bold',
      align: 'center',
      inverse: false
    }, y);
    y += 5;
  } else if (isAdditionalOrder) {
    y = drawTextBlock(ctx, {
      text: '** ADDITIONAL **',
      fontSize: statusFontSize,
      fontWeight: 'bold',
      align: 'center',
      inverse: false
    }, y);
    y += 5;
  }
  
  // === 헤더 (두 박스 레이아웃: [#주문번호 | 채널+정보]) ===
  // 매장식사 (DINE-IN/EAT IN): 흰 배경 + 검은 테두리 + 검은 글씨
  // 외부주문 (TOGO/PICKUP/ONLINE/DELIVERY): 검은 배경 + 흰 글씨 + 흰 구분선
  const cleanPosSeq = String(orderNumber || '').replace('#', '').trim();
  const isPickupLike = (channel === 'PICKUP');
  const isTogoLike = (channel === 'TOGO' || channel === 'TAKEOUT');
  const isOnlineLike = (channel === 'ONLINE' || channel === 'THEZONE');

  const formatExternalAlphaNumTail = (v, maxLen = 12) => {
    const raw = String(v || '').trim();
    if (!raw) return '';
    const cleaned = raw
      .replace(/^#\s*/, '')
      .replace(/\s+/g, '')
      .replace(/[^a-zA-Z0-9-]/g, '');
    if (!cleaned) return '';
    const upper = cleaned.toUpperCase();
    if (upper.length <= maxLen) return upper;
    return upper.slice(-maxLen);
  };

  const formatTableLabel = (rawName) => {
    const s = String(rawName || '').trim();
    if (!s) return '';
    const m = s.match(/^t\s*0*(\d+)\s*$/i);
    if (m && m[1]) return `Table ${Number(m[1])}`;
    const m2 = s.match(/^table\s*0*(\d+)\s*$/i);
    if (m2 && m2[1]) return `Table ${Number(m2[1])}`;
    return s;
  };

  // 왼쪽 박스: POS 주문번호
  const leftBoxText = cleanPosSeq ? `#${cleanPosSeq}` : '';

  // 오른쪽 박스: 채널 + 고객식별정보 (분리 저장)
  let rightBoxText = '';
  let rightBoxChannelPart = '';
  let rightBoxInfoPart = '';

  if (isPickupLike) {
    const phoneRaw = String(customerPhone || '').trim();
    const phoneDigits = phoneRaw.replace(/\D/g, '');
    rightBoxChannelPart = 'PICKUP';
    if (phoneDigits.length >= 4) {
      rightBoxInfoPart = `"${phoneDigits.slice(-4)}"`;
    } else if (phoneDigits.length > 0) {
      rightBoxInfoPart = `"${phoneDigits}"`;
    } else if (cleanPosSeq) {
      rightBoxInfoPart = `#${cleanPosSeq}`;
    }
    rightBoxText = rightBoxInfoPart ? `${rightBoxChannelPart} ${rightBoxInfoPart}` : rightBoxChannelPart;
  } else if (isTogoLike) {
    const phoneRaw = String(customerPhone || '').trim();
    const phoneDigits = phoneRaw.replace(/\D/g, '');
    rightBoxChannelPart = 'TOGO';
    if (phoneDigits.length >= 4) {
      rightBoxInfoPart = `"${phoneDigits.slice(-4)}"`;
    } else if (phoneDigits.length > 0) {
      rightBoxInfoPart = `"${phoneDigits}"`;
    }
    rightBoxText = rightBoxInfoPart ? `${rightBoxChannelPart} ${rightBoxInfoPart}` : rightBoxChannelPart;
  } else if (isOnlineLike) {
    const phoneRaw = String(customerPhone || '').trim();
    const phoneDigits = phoneRaw.replace(/\D/g, '');
    rightBoxChannelPart = 'ONLINE';
    if (phoneDigits.length >= 4) {
      rightBoxInfoPart = `"${phoneDigits.slice(-4)}"`;
    } else if (phoneDigits.length > 0) {
      rightBoxInfoPart = `"${phoneDigits}"`;
    } else if (cleanPosSeq) {
      rightBoxInfoPart = `#${cleanPosSeq}`;
    }
    rightBoxText = rightBoxInfoPart ? `${rightBoxChannelPart} ${rightBoxInfoPart}` : rightBoxChannelPart;
  } else if (isDeliveryLike) {
    const platform = getKitchenDeliveryCompanyLabel(deliveryCompany) || 'DELIVERY';
    const ext = formatExternalAlphaNumTail(deliveryOrderNumber, 12);
    rightBoxChannelPart = platform;
    if (ext) rightBoxInfoPart = `"${ext}"`;
    rightBoxText = rightBoxInfoPart ? `${rightBoxChannelPart} ${rightBoxInfoPart}` : rightBoxChannelPart;
  } else if (tableName) {
    const tableLabel = formatTableLabel(tableName);
    rightBoxChannelPart = tableLabel;
    rightBoxText = tableLabel;
  } else if (channel === 'EAT IN' || channel === 'EATIN' || channel === 'FOR HERE' || channel === 'FORHERE') {
    rightBoxChannelPart = 'EAT IN';
    rightBoxText = 'EAT IN';
  } else {
    rightBoxChannelPart = channel || '';
    rightBoxText = channel || '';
  }

  console.log(`🍳 [GRAPHIC-HEADER] leftBoxText="${leftBoxText}" rightBoxText="${rightBoxText}" channel="${channel}" tableName="${tableName}"`);

  // Dine-in 스타일(흰배경/검정글씨/검정테두리) vs Takeout/Delivery 스타일(검정배경/흰글씨)
  const isDineInStyle = (channel === 'DINE-IN' || channel === 'POS' || channel === 'TABLE' || channel === 'HANDHELD' || channel === 'SUBPOS' || channel === 'EAT IN' || channel === 'EATIN' || channel === 'FOR HERE' || channel === 'FORHERE');
  const isDineInLikeForBoxes = isDineInStyle;

  const hasTwoBoxes = !!(leftBoxText && rightBoxText);
  const headerStartY = y;
  const headerFontSize = 55;
  const orderNumberFontSize = Math.max(8, Math.round(headerFontSize * 0.772));
  const channelFontSize = Math.max(8, Math.round(headerFontSize * 1.105));
  const headerPaddingY = 4;
  const headerLineHeight = channelFontSize + Math.max(1, Math.round(headerPaddingY)) * 2;

  const bg = isDineInLikeForBoxes ? '#FFFFFF' : '#000000';
  const fg = isDineInLikeForBoxes ? '#000000' : '#FFFFFF';

  const leftHeaderPadX = Math.max(3, Math.round(8));
  const orderHeaderPadX = Math.max(2, Math.round(5));
  const headerX = isDineInLikeForBoxes ? (ctx._receiptPadding || PRINTER_CONFIG.padding) : 0;
  const headerSafeRightPadRaw = orderData?.rightPaddingPx ?? orderData?.rightPadding ?? 0;
  const headerSafeRightPad = Math.max(0, Math.round(Number(headerSafeRightPadRaw) || 0));
  const fullWidth = ctx._receiptWidth || PRINTER_CONFIG.width;
  const headerW = isDineInLikeForBoxes
    ? Math.max(0, PRINTER_CONFIG.width - PRINTER_CONFIG.padding * 2 - headerSafeRightPad)
    : Math.max(0, fullWidth - headerSafeRightPad);
  const headerH = Math.max(24, Math.ceil(headerLineHeight));

  ctx.save();
  const headerFont = `bold ${headerFontSize}px "${FONT_FAMILY}`;
  const orderNumFont = `bold ${orderNumberFontSize}px "${FONT_FAMILY}`;
  const channelFont = `bold ${channelFontSize}px "${FONT_FAMILY}`;

  // 왼쪽 박스(주문번호) 너비 측정
  let leftBoxW = 0;
  let rightBoxW = headerW;
  const dividerW = 4;

  if (hasTwoBoxes) {
    ctx.font = orderNumFont;
    const leftTextW = ctx.measureText(leftBoxText).width;
    leftBoxW = Math.ceil(leftTextW + leftHeaderPadX * 2);
    leftBoxW = Math.max(leftBoxW, Math.round(headerW * 0.178));
    leftBoxW = Math.min(leftBoxW, Math.round(headerW * 0.347));
    rightBoxW = Math.max(0, headerW - leftBoxW);
  }

  // 왼쪽 박스 그리기 (주문번호)
  if (leftBoxW > 0) {
    ctx.fillStyle = bg;
    ctx.fillRect(headerX, headerStartY, leftBoxW, headerH);
    if (isDineInLikeForBoxes) {
      ctx.strokeStyle = fg;
      ctx.lineWidth = 4;
      ctx.strokeRect(headerX, headerStartY, leftBoxW, headerH);
    }
    ctx.font = orderNumFont;
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(leftBoxText, headerX + leftBoxW / 2, headerStartY + headerH / 2);
  }

  // 구분선 (왼쪽 박스와 오른쪽 박스 사이)
  if (hasTwoBoxes) {
    ctx.fillStyle = fg;
    ctx.fillRect(headerX + leftBoxW - dividerW / 2, headerStartY + 4, dividerW, headerH - 8);
  }

  // 오른쪽 박스 그리기 (채널 + 정보)
  if (rightBoxW > 0) {
    const rightBoxX = headerX + leftBoxW;
    ctx.fillStyle = bg;
    ctx.fillRect(rightBoxX, headerStartY, rightBoxW, headerH);
    if (isDineInLikeForBoxes) {
      ctx.strokeStyle = fg;
      ctx.lineWidth = 4;
      ctx.strokeRect(rightBoxX, headerStartY, rightBoxW, headerH);
    }

    ctx.font = channelFont;
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const maxRightTextW = Math.max(0, rightBoxW - orderHeaderPadX * 2);

    if (rightBoxInfoPart) {
      // 채널명과 부가정보를 분리 렌더링
      const spaceBetween = 6;
      ctx.font = channelFont;
      const channelTextW = ctx.measureText(rightBoxChannelPart).width;
      const spaceW = ctx.measureText(' ').width;

      // 부가정보에 사용 가능한 너비
      const availableForInfo = Math.max(0, maxRightTextW - channelTextW - spaceBetween);

      // 부가정보 폰트 크기 계산 (박스에 맞춰 축소)
      let infoFontSize = channelFontSize;
      ctx.font = `bold ${infoFontSize}px "${FONT_FAMILY}`;
      let infoW = ctx.measureText(rightBoxInfoPart).width;
      if (infoW > availableForInfo && availableForInfo > 0) {
        infoFontSize = Math.max(8, Math.round(infoFontSize * (availableForInfo / infoW)));
        ctx.font = `bold ${infoFontSize}px "${FONT_FAMILY}`;
        infoW = ctx.measureText(rightBoxInfoPart).width;
        if (infoW > availableForInfo) {
          infoFontSize = Math.max(8, Math.round(infoFontSize * 0.9));
          ctx.font = `bold ${infoFontSize}px "${FONT_FAMILY}`;
          infoW = ctx.measureText(rightBoxInfoPart).width;
        }
      }

      // 전체 너비로 중앙 정렬 계산
      const totalTextW = channelTextW + spaceBetween + infoW;
      const startX = rightBoxX + (rightBoxW - totalTextW) / 2;
      const centerY = headerStartY + headerH / 2;

      // 채널명 그리기 (고정 크기)
      ctx.font = channelFont;
      ctx.textAlign = 'left';
      ctx.fillText(rightBoxChannelPart, startX, centerY);

      // 부가정보 그리기 (동적 크기)
      ctx.font = `bold ${infoFontSize}px "${FONT_FAMILY}`;
      ctx.textAlign = 'left';
      ctx.fillText(rightBoxInfoPart, startX + channelTextW + spaceBetween, centerY);
    } else {
      // 채널명만 있는 경우 (Table 1, EAT IN 등)
      let displayText = rightBoxText;
      if (ctx.measureText(displayText).width > maxRightTextW) {
        const reducedSize = Math.max(8, Math.round(channelFontSize * 0.75));
        ctx.font = `bold ${reducedSize}px "${FONT_FAMILY}`;
        if (ctx.measureText(displayText).width > maxRightTextW) {
          const smallerSize = Math.max(8, Math.round(channelFontSize * 0.6));
          ctx.font = `bold ${smallerSize}px "${FONT_FAMILY}`;
        }
      }
      ctx.fillText(displayText, rightBoxX + rightBoxW / 2, headerStartY + headerH / 2);
    }
  }

  ctx.restore();
  y = headerStartY + headerH;
  
  // 헤더 하단 보더와 Pickup Time 사이의 흰 줄 제거 (검은 strip으로 덮기)
  const headerBottomGap = 4;
  ctx.save();
  ctx.fillStyle = '#000000';
  ctx.fillRect(headerX, y - headerBottomGap, headerW, headerBottomGap + 2);
  ctx.restore();
  
  // PICKUP 시간 (TOGO, ONLINE, PICKUP, DELIVERY 채널에서 표시)
  // 헤더와 함께 검은 배경으로 묶어서 출력
  const showPickupTime = (channel === 'TOGO' || channel === 'ONLINE' || channel === 'PICKUP' || isDeliveryLike) && (pickupTime || pickupMinutes);
  if (showPickupTime) {
    // pickupTime이 시간 형식이면 그대로, 아니면 분 단위로 변환
    let pickupDisplay = '';
    if (pickupTime) {
      // "04:15PM" 또는 "4:15 PM" 형식인지 확인
      if (pickupTime.match(/\d{1,2}:\d{2}\s*(AM|PM|am|pm)?/i)) {
        pickupDisplay = pickupTime.replace(/\s+/g, ''); // 공백 제거하여 "04:15PM" 형식으로
      } else {
        pickupDisplay = pickupTime;
      }
    } else if (pickupMinutes) {
      // 분 단위를 시간으로 변환
      const now = new Date();
      now.setMinutes(now.getMinutes() + Number(pickupMinutes));
      const hours = now.getHours();
      const mins = now.getMinutes();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const hour12 = hours % 12 || 12;
      pickupDisplay = `${String(hour12).padStart(2, '0')}:${String(mins).padStart(2, '0')}${ampm}`;
    }
    
    // Pickup Time 폰트 사이즈: Header의 80%
    const pickupFontSize = Math.round(PRINTER_CONFIG.fontSize.xxlarge * 0.8);
    
    y = drawTextBlock(ctx, {
      text: `Pickup ${pickupDisplay}`,
      fontSize: pickupFontSize,  // Header의 80% (55 * 0.8 = 44px)
      fontWeight: 'bold',
      align: 'center',
      inverse: true  // 헤더와 같이 검은 배경 흰 글씨
    }, y);
  }
  
  // 주문자 정보 (TOGO, ONLINE, DELIVERY 채널에서 이름 · 전화번호 표시)
  const showCustomerInfo = (channel === 'TOGO' || channel === 'ONLINE' || isDeliveryLike) && (customerName || customerPhone);
  if (showCustomerInfo) {
    let customerDisplay = '';
    if (customerName && customerPhone) {
      customerDisplay = `${customerName} · ${customerPhone}`;
    } else if (customerName) {
      customerDisplay = customerName;
    } else if (customerPhone) {
      customerDisplay = customerPhone;
    }
    const CUSTOMER_INFO_FONT_SIZE = Math.round(LABEL_FONT_SIZE * 1.706);
    
    y = drawTextBlock(ctx, {
      text: customerDisplay,
      fontSize: CUSTOMER_INFO_FONT_SIZE, // 고객정보는 더 크게 (1.3x) + bold
      fontWeight: 'bold',
      align: 'center'
    }, y);
  }
  
  // 상태 표시
  // - Kitchen Printer: PAID/UNPAID 표시 안함 (주방에서는 결제 상태 불필요)
  // - Dine-in: PAID/UNPAID 표시 안함
  // - Delivery: TOGO 레이아웃과 동일 + 결제는 PAID만 표시
  // - Online/Togo/Pickup: Receipt Printer에만 PAID/UNPAID 표시
  // REPRINT/ADDITIONAL은 이미 헤더 위에 표시되었으므로 여기서는 PAID/UNPAID만 처리
  const isKitchenPrinter = orderData.isKitchenPrinter || false;
  const hidePaidStatus = isKitchenPrinter || isDineInStyle;
  let paidStatusText = '';
  if (!isReprint && !isAdditionalOrder) {
    if (isDeliveryLike && !isKitchenPrinter) paidStatusText = 'PAID';
    else if (!hidePaidStatus && isPaid) paidStatusText = 'PAID';
    else if (!hidePaidStatus) paidStatusText = 'UNPAID';
  }
  
  // PAID/UNPAID 폰트 사이즈 (Header의 80%)
  const paidStatusFontSize = Math.round(PRINTER_CONFIG.fontSize.xxlarge * 0.92);
  
  // PAID/UNPAID 텍스트가 있을 때만 출력 (흰 바탕에 검은 글씨 + 박스)
  if (paidStatusText) {
    y += 5;  // 헤더와 약간 간격
    y = drawTextBlock(ctx, {
      text: paidStatusText,
      fontSize: paidStatusFontSize,
      fontWeight: 'bold',
      align: 'center',
      inverse: false,  // 흰 바탕에 검은 글씨
      box: true         // 텍스트 주변에 박스 테두리
    }, y);
  }
  
  // 고객 이름 (TOGO, ONLINE, DELIVERY는 위에서 이미 표시했으므로 제외)
  // PICKUP 채널 등에서만 표시
  const alreadyShowedCustomer = (channel === 'TOGO' || channel === 'ONLINE' || isDeliveryLike);
  if (customerName && !alreadyShowedCustomer) {
    y = drawTextBlock(ctx, {
      text: `Customer: ${customerName}`,
      fontSize: Math.round(PRINTER_CONFIG.fontSize.normal * 1.3125),
      align: 'center'
    }, y);
  }
  
  // 구분선 (시간은 푸터로 이동)
  {
    // Increase spacing around the first separator:
    // - header → separator: 2x
    // - separator → first item: 2x
    const lineOffset = 8;
    const advance = 20;
    const afterGap = advance - lineOffset;
    y += lineOffset;
    y = drawSeparator(ctx, y, 'double');
    // Increase separator → first item spacing by +30% from current.
    y += Math.round(afterGap * 1.3);
  }
  
  // === 아이템 목록 ===
  // Item font size: 1.3x of large (28 * 1.3 = 36)
  const ITEM_FONT_SIZE = Math.round(PRINTER_CONFIG.fontSize.large * 1.3);
  const ITEM_SPACING = 11; // 10% more than previous (10 * 1.1 = 11)
  
  // Helper function to render a single item
  const renderItem = (item, isFirst) => {
    const itemName = item.name || item.itemName || '';
    const quantity = item.quantity || item.qty || 1;
    const isItemTogo = !!(item.togoLabel || item.togo_label);
    
    // Debug log for first item only
    if (isFirst) {
      console.log(`🍳 [Kitchen Graphic] Item structure:`, {
        name: item.name,
        modifiers: item.modifiers,
        memo: item.memo,
        guestNumber: item.guestNumber
      });
    }
    
    // 아이템 이름 + 수량 (1.3배 크기, 모디파이어보다 약간 더 굵게)
    y = drawTextBlock(ctx, {
      text: `${quantity}x ${itemName}`,
      fontSize: ITEM_FONT_SIZE,
      fontWeight: 'bold',
      align: 'left',
      extraBold: true
    }, y);

    // Item-level TOGO label (Dine-in TOGO label) under item name
    if (isItemTogo) {
      y = drawTextBlock(ctx, {
        text: `  <<TOGO>>`,
        fontSize: ITEM_FONT_SIZE,
        fontWeight: 'bold',
        fontStyle: 'italic',
        align: 'left',
        paddingY: 3
      }, y);
    }
    
    // Modifiers - handle various structures
    const modifiers = item.modifiers || item.modifier || [];
    const modArray = Array.isArray(modifiers) ? modifiers : 
                     (typeof modifiers === 'string' ? modifiers.split(',') : []);

    // Flatten all modifier texts first, then group-count for 1x/2x/3x output
    const allModTexts = [];
    modArray.forEach(mod => {
      // Extract modifier text from various structures
      let modTexts = [];
      
      if (typeof mod === 'string') {
        modTexts.push(mod);
      } else if (typeof mod === 'object' && mod !== null) {
        if (mod.name) {
          modTexts.push(mod.name);
        } else if (mod.modifierName) {
          modTexts.push(mod.modifierName);
        } else if (mod.groupName && mod.selectedEntries && Array.isArray(mod.selectedEntries)) {
          mod.selectedEntries.forEach(entry => {
            if (entry.name) modTexts.push(entry.name);
          });
        } else if (mod.modifierNames && Array.isArray(mod.modifierNames)) {
          modTexts = modTexts.concat(mod.modifierNames);
        } else if (mod.selectedEntries && Array.isArray(mod.selectedEntries)) {
          mod.selectedEntries.forEach(entry => {
            if (entry.name) modTexts.push(entry.name);
          });
        }
      }

      modTexts.forEach(t => {
        const s = (t == null ? '' : String(t)).trim();
        if (s) allModTexts.push(s);
      });
    });

    const modCounts = new Map();
    const modOrder = [];
    allModTexts.forEach(name => {
      const key = String(name);
      if (!modCounts.has(key)) modOrder.push(key);
      modCounts.set(key, (modCounts.get(key) || 0) + 1);
    });

    modOrder.forEach(name => {
      const count = modCounts.get(name) || 0;
      if (!count) return;
      y = drawTextBlock(ctx, {
        text: `  >> ${count}x ${name}`,
        fontSize: ITEM_FONT_SIZE,
        fontWeight: 'bold',
        fontStyle: 'italic',
        align: 'left',
        paddingY: 3  // 15% tighter spacing (default 4 → 3)
      }, y);
    });
    
    // Note/Memo - handle object or string (same size as item, italic, tighter spacing)
    let note = item.memo || item.note || item.specialInstructions || '';
    if (typeof note === 'object' && note !== null) {
      note = note.text || note.note || '';
    }
    if (note && note.trim()) {
      y = drawTextBlock(ctx, {
        text: `  * ${note.trim()}`,
        fontSize: ITEM_FONT_SIZE,
        fontWeight: 'bold',
        fontStyle: 'italic',
        align: 'left',
        paddingY: 3  // 15% tighter spacing (default 4 → 3)
      }, y);
    }

    // Item discount (if exists) - shown after memo
    try {
      const disc = item.discount || null;
      if (disc && typeof disc === 'object') {
        const dtype = (disc.type || disc.name || 'Discount').toString();
        const mode = (disc.mode || '').toString().toLowerCase();
        const rawVal = disc.value ?? disc.amount ?? disc.percentage ?? disc.percent ?? 0;
        const valNum = Number(rawVal);
        let label = `  - ${dtype}`;
        if (mode === 'percent') {
          if (Number.isFinite(valNum) && valNum > 0) label = `  - ${dtype} (${valNum}%)`;
        } else if (mode === 'amount') {
          if (Number.isFinite(valNum) && valNum > 0) label = `  - ${dtype} (-$${valNum.toFixed(2)})`;
        } else if (Number.isFinite(valNum) && valNum > 0) {
          // Fallback: show numeric value without assuming unit
          label = `  - ${dtype} (${valNum})`;
        }
        y = drawTextBlock(ctx, {
          text: label,
          fontSize: ITEM_FONT_SIZE,
          fontWeight: 'bold',
          fontStyle: 'italic',
          align: 'left',
          paddingY: 3
        }, y);
      }
    } catch {}
    
    y += ITEM_SPACING; // 아이템 간 간격 (1.2x)
  };
  
  // Group items by guestNumber
  const guestNumbers = [...new Set(items.map(item => item.guestNumber || item.guest_number || 1))].sort((a, b) => a - b);
  const hasMultipleGuests = guestNumbers.length > 1;
  
  if (hasMultipleGuests) {
    const drawGuestInlineSeparator = (yPos, guestNum) => {
      const width = ctx._receiptWidth || PRINTER_CONFIG.width;
      const padding = ctx._receiptPadding || PRINTER_CONFIG.padding;
      const fontSize = PRINTER_CONFIG.fontSize.large;
      const text = `Guest ${guestNum}`;
      const lineY = yPos + 16;

      ctx.save();
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 6; // 3x thicker
      ctx.setLineDash([]);

      ctx.font = `bold ${fontSize}px "Arial", "Malgun Gothic", sans-serif`;
      const textWidth = ctx.measureText(text).width;
      const centerX = width / 2;
      const gapHalf = Math.ceil(textWidth / 2) + 12; // space around text
      const leftEnd = Math.max(padding + 10, centerX - gapHalf);
      const rightStart = Math.min(width - padding - 10, centerX + gapHalf);

      // left segment
      ctx.beginPath();
      ctx.moveTo(padding, lineY);
      ctx.lineTo(leftEnd, lineY);
      ctx.stroke();
      // right segment
      ctx.beginPath();
      ctx.moveTo(rightStart, lineY);
      ctx.lineTo(width - padding, lineY);
      ctx.stroke();

      // centered label
      ctx.fillStyle = '#000000';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, centerX, lineY);

      ctx.restore();
      return yPos + 32;
    };

    // Helper: render dine-in items then TOGO items (keeps TOGO at bottom)
    const renderItemsWithTogoSeparator = (itemList, isFirstGroup) => {
      const dineItems = itemList.filter(it => !(it.togoLabel || it.togo_label));
      const togoItems = itemList.filter(it => !!(it.togoLabel || it.togo_label));
      dineItems.forEach((item, idx) => {
        renderItem(item, isFirstGroup && idx === 0);
      });
      if (togoItems.length > 0) {
        togoItems.forEach((item) => {
          renderItem(item, false);
        });
      }
    };

    // Multiple guests - show guest separators
    guestNumbers.forEach((guestNum, guestIdx) => {
      const guestItems = items.filter(item => (item.guestNumber || item.guest_number || 1) === guestNum);
      
      if (guestItems.length > 0) {
        y += 8;
        y = drawGuestInlineSeparator(y, guestNum);
        y += 8;
        
        renderItemsWithTogoSeparator(guestItems, guestIdx === 0);
        
        y += 5;
      }
    });
  } else {
    // Single guest - split dine-in and togo
    const dineItems = items.filter(it => !(it.togoLabel || it.togo_label));
    const togoItems = items.filter(it => !!(it.togoLabel || it.togo_label));
    dineItems.forEach((item, idx) => {
      renderItem(item, idx === 0);
    });
    if (togoItems.length > 0) {
      togoItems.forEach((item) => {
        renderItem(item, false);
      });
    }
  }
  
  // === Kitchen Note (order-level) ===
  if (kitchenNoteText) {
    y += 6;
    y = drawSeparator(ctx, y, 'dashed');
    y += 6;
    y = drawTextBlock(ctx, {
      text: '*** Kitchen Memo ***',
      fontSize: PRINTER_CONFIG.fontSize.large,
      fontWeight: 'bold',
      align: 'center'
    }, y);
    y += 4;
    y = drawTextBlock(ctx, {
      text: kitchenNoteText,
      fontSize: ITEM_FONT_SIZE,
      fontWeight: 'bold',
      fontStyle: 'italic',
      align: 'left',
      paddingY: 3
    }, y);
    y += 6;
  }

  // 구분선
  y = drawSeparator(ctx, y, 'solid');
  
  // 푸터: 서버이름 (왼쪽) + 주문시간 (오른쪽)
  y += 10;
  const serverName = orderInfo.server || orderInfo.serverName || orderData.server || orderData.serverName || '';
  const timeText = (() => { const now = new Date(); const h = now.getHours(); const m = now.getMinutes(); const ampm = h >= 12 ? 'PM' : 'AM'; const h12 = h % 12 || 12; return `${h12}:${String(m).padStart(2, '0')}${ampm}`; })();
  if (serverName) {
    y = drawLeftRightText(ctx, serverName, timeText, y, {
      fontSize: PRINTER_CONFIG.fontSize.large,
      fontWeight: 'bold'
    });
  } else {
    y = drawTextBlock(ctx, {
      text: timeText,
      fontSize: PRINTER_CONFIG.fontSize.large,
      fontWeight: 'bold',
      align: 'right'
    }, y);
  }
  
  // 여백
  y += 30;
  
  // 실제 사용된 높이로 이미지 추출
  const imageData = ctx.getImageData(0, 0, PRINTER_CONFIG.width, y);
  
  return imageToEscPosRaster(imageData.data, PRINTER_CONFIG.width, y, orderData?.graphicScale);
}

/**
 * Receipt 그래픽 렌더링
 * @param {Object} receiptData - 영수증 데이터
 * @returns {Buffer} ESC/POS 비트맵 데이터
 */
function renderReceiptGraphic(receiptData) {
  ensureFontsRegistered();
  
  // 용지 너비 설정 (58mm 또는 80mm)
  const paperWidth = getPrinterWidth(receiptData.paperWidth);
  const RECEIPT_WIDTH = paperWidth;
  const RECEIPT_PADDING = paperWidth === 384 ? 8 : 8; // 80mm도 패딩을 줄여 실제 출력 폭을 넓힘
  // Extra right safety padding to avoid clipping on some printers.
  // 512px 기준이므로 대부분의 80mm 프린터에서 안전하게 출력됨.
  const RECEIPT_RIGHT_PADDING = (() => {
    const v = receiptData?.rightPaddingPx ?? receiptData?.rightPadding ?? null;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return n;
    return paperWidth === 384 ? 30 : 10;
  })();
  console.log(`🔍 [RENDER] rightPaddingPx=${receiptData?.rightPaddingPx}, RECEIPT_RIGHT_PADDING=${RECEIPT_RIGHT_PADDING}, paperWidth=${paperWidth}, RECEIPT_WIDTH=${RECEIPT_WIDTH}`);
  
  // 상단 마진 (mm를 픽셀로 변환)
  // Priority: payload(receiptData.topMargin) > layout(topMargin) > default(5mm)
  // Note: allow 0mm (do not use `||` fallback).
  const baseLayout = getLayoutFromPrintData(receiptData);
  const lockedPresetId = getLockedPresetId(receiptData);
  const lockedPresetLayout = lockedPresetId ? loadPrintPreset(lockedPresetId) : null;
  const layout = lockedPresetLayout ? applyLockedPresetLayout(baseLayout, lockedPresetLayout) : baseLayout;
  const topMarginMm = clampNumber(receiptData?.topMargin ?? layout?.topMargin ?? 5, 0, 120, 5);
  const topMarginPx = Math.round(topMarginMm * 8);
  // Left margin (mm) → additional safe padding (px) for graphic mode
  const leftMarginMm = clampNumber(receiptData?.leftMargin ?? layout?.leftMargin ?? 0, 0, 60, 0);
  const leftMarginPx = Math.round(leftMarginMm * 8);
  
  // 높이 추정 (모든 섹션을 고려하여 정확하게 계산)
  const items = receiptData.items || [];
  const guestSections = receiptData.guestSections || [];
  const togoDisplayMode = String(receiptData?.togoDisplayMode || '').trim().toLowerCase(); // 'per_item' | ''
  const showTogoSeparator = receiptData?.showTogoSeparator !== false;

  // DEBUG: Log TOGO data for troubleshooting
  const _togoDebugItems = items.filter(it => it.togoLabel || it.togo_label);
  const _togoDebugGuest = guestSections.flatMap(s => (s.items || []).filter(it => it.togoLabel || it.togo_label));
  if (_togoDebugItems.length > 0 || _togoDebugGuest.length > 0) {
    console.log(`🔍 [TOGO DEBUG] Receipt/Bill render: ${_togoDebugItems.length} togo items in items[], ${_togoDebugGuest.length} togo items in guestSections[], togoDisplayMode="${togoDisplayMode}"`);
  }
  const equalSplit =
    receiptData?.equalSplit ||
    receiptData?.orderInfo?.equalSplit ||
    receiptData?.header?.equalSplit ||
    null;
  const splitCount = Number(equalSplit?.count || 0);
  const splitIndex = Number(equalSplit?.index || 0);
  
  let estimatedHeight = 280 + topMarginPx; // 헤더 + 상단 마진 (Delivery: PAID/고객정보 라인 여유 포함)
  if (receiptData.isReprint) estimatedHeight += 45; // REPRINT banner
  if (splitCount > 1 && splitIndex >= 1) estimatedHeight += 35; // EQUAL SPLIT label
  
  // 아이템 높이
  const getMemoText = (memo) => {
    if (!memo) return '';
    if (typeof memo === 'string') return memo;
    return memo.text || memo.name || memo.note || memo.specialInstructions || '';
  };
  
  const flattenModifiers = (mods) => {
    if (!Array.isArray(mods)) return [];
    const flat = [];
    for (const mod of mods) {
      if (mod.selectedEntries && Array.isArray(mod.selectedEntries)) {
        for (const entry of mod.selectedEntries) {
          flat.push({ name: entry.name || entry.label || '', price: Number(entry.price_delta || entry.priceDelta || entry.price || 0) });
        }
      } else {
        flat.push({ name: typeof mod === 'string' ? mod : (mod.name || mod.label || ''), price: typeof mod === 'object' ? Number(mod.price || mod.price_delta || 0) : 0 });
      }
    }
    return flat.filter(m => m.name);
  };
  
  if (guestSections.length > 0) {
    guestSections.forEach(section => {
      estimatedHeight += 35;
      const sectionItems = section.items || [];
      sectionItems.forEach(item => {
        estimatedHeight += 40;
        if (item.togoLabel || item.togo_label) estimatedHeight += 32;
        const mods = flattenModifiers(item.modifiers);
        estimatedHeight += mods.length * 32;
        if (getMemoText(item.memo)) estimatedHeight += 32;
        if (item.discount && item.discount.amount > 0) estimatedHeight += 32;
      });
      // Per-guest summary (subtotal, adjustments, taxes, total)
      if (section.guestSubtotal != null || section.guestTaxLines) {
        estimatedHeight += 30; // subtotal
        estimatedHeight += ((section.guestAdjustments || []).length) * 26;
        estimatedHeight += ((section.guestTaxLines || []).length) * 26;
        estimatedHeight += 30; // guest total
      }
    });
  } else {
    items.forEach(item => {
      estimatedHeight += 40;
      if (item.togoLabel || item.togo_label) estimatedHeight += 32;
      const mods = flattenModifiers(item.modifiers);
      estimatedHeight += mods.length * 32;
      if (getMemoText(item.memo)) estimatedHeight += 32;
      if (item.discount && item.discount.amount > 0) estimatedHeight += 32;
    });
  }
  
  estimatedHeight += 30; // 구분선
  
  // 소계, 세금, 할인
  if (receiptData.subtotal != null) estimatedHeight += 35;
  if (receiptData.taxLines) estimatedHeight += receiptData.taxLines.length * 35;
  if (receiptData.adjustments) estimatedHeight += receiptData.adjustments.length * 35;
  estimatedHeight += 60; // TOTAL (반전 큰 글씨)
  estimatedHeight += 20; // 구분선
  
  // 결제 정보
  if (receiptData.payments && receiptData.payments.length > 0) {
    try {
      const foodMethods = new Set();
      const tipMethods = new Set();
      for (const p of (receiptData.payments || [])) {
        const m = String((p && p.method) || 'OTHER').toUpperCase();
        const amt = Number((p && p.amount) || 0);
        const tip = Number((p && p.tip) || 0);
        const food = amt - tip;
        if (food > 0.0001) foodMethods.add(m);
        if (tip > 0.0001) tipMethods.add(m);
      }
      // Payment total + food-by-method + tip-by-method
      estimatedHeight += (1 + foodMethods.size + tipMethods.size) * 35;
    } catch {
      estimatedHeight += 35; // Payment
      estimatedHeight += receiptData.payments.length * 35;
    }
    if (receiptData.cashTendered && Number(receiptData.cashTendered) > 0) estimatedHeight += 35; // Cash Tendered
    if (receiptData.change && Number(receiptData.change) > 0) estimatedHeight += 45; // Change
  }
  
  estimatedHeight += 100; // Footer + 하단 여백
  estimatedHeight = Math.max(estimatedHeight, 500);
  
  const canvas = createCanvas(RECEIPT_WIDTH, estimatedHeight);
  const ctx = canvas.getContext('2d');
  
  
  ctx._receiptWidth = RECEIPT_WIDTH;
  // Treat leftMargin as extra padding so all x positions shift consistently.
  ctx._receiptPadding = RECEIPT_PADDING + leftMarginPx;
  ctx._receiptRightPadding = RECEIPT_RIGHT_PADDING;
  // Method A: keep width 512, use a slightly smaller minimum right padding (receipt/bill only)
  // so content uses a bit more printable area without changing dot width.
  ctx._minRightPadding = RECEIPT_WIDTH === 512 ? 10 : 15;
  
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, RECEIPT_WIDTH, estimatedHeight);
  
  // 상단 마진 적용: 렌더링 내부에서도 반영 (단, buildGraphicReceipt에서 ESC/POS feed로 처리할 수도 있음)
  let y = topMarginPx;
  
  // 데이터 추출
  const header = receiptData.header || {};
  const orderInfo = receiptData.orderInfo || receiptData;
  const storeName = header.storeName || receiptData.storeName || 'Restaurant';
  const storeAddress = header.storeAddress || receiptData.storeAddress || '';
  const storePhone = header.storePhone || receiptData.storePhone || '';
  const orderNumber = header.orderNumber || orderInfo.orderNumber || receiptData.orderNumber || '';
  const rawChannel = header.channel || orderInfo.channel || receiptData.channel || '';
  const channel = String(rawChannel || '').toUpperCase();
  const tableName = header.tableName || orderInfo.tableName || receiptData.tableName || '';
  const serverName = header.serverName || orderInfo.serverName || receiptData.serverName || '';
  const customerName = header.customerName || orderInfo.customerName || receiptData.customerName || '';
  const customerPhone = header.customerPhone || orderInfo.customerPhone || receiptData.customerPhone || '';
  const deliveryCompanyRaw =
    header.deliveryCompany || header.deliveryChannel ||
    orderInfo.deliveryCompany || orderInfo.deliveryChannel ||
    receiptData.deliveryCompany || receiptData.deliveryChannel ||
    '';
  const deliveryCompany = normalizeDeliveryCompanyName(deliveryCompanyRaw);
  const deliveryOrderNumber =
    header.deliveryOrderNumber || header.externalOrderNumber ||
    orderInfo.deliveryOrderNumber || orderInfo.externalOrderNumber ||
    receiptData.deliveryOrderNumber || receiptData.externalOrderNumber || '';
  const orderTypeUpper = String(header.orderType || orderInfo.orderType || receiptData.orderType || '').toUpperCase();
  const isDeliveryLike = channel === 'DELIVERY' || orderTypeUpper === 'DELIVERY' || !!deliveryCompany || !!deliveryOrderNumber;
  const isPaid = !!(
    receiptData.isPaid || receiptData.paid ||
    orderInfo.isPaid || header.isPaid ||
    (Array.isArray(receiptData.payments) && receiptData.payments.length > 0)
  );
  const LABEL_FONT_SIZE = Math.round(PRINTER_CONFIG.fontSize.xxlarge / 2);
  // 폰트가 너무 작게 설정되어도(백오피스 레이아웃) 출력이 작아지지 않도록 바닥값 적용
  const META_MIN_FONT = Math.max(PRINTER_CONFIG.fontSize.small, 20);      // 주소/전화/날짜
  const SUMMARY_MIN_FONT = Math.max(PRINTER_CONFIG.fontSize.normal, 24);  // Subtotal/Tax/Payment
  const stItemsBaseForSizing = getGraphicElementStyle(layout, 'items', {
    fontSize: 26,
    fontWeight: 'bold',
    fontStyle: 'normal',
    align: 'left',
    inverse: false
  });
  const ITEM_BASE_FONT_SIZE = Math.max(Number(stItemsBaseForSizing.fontSize) || 0, 26);
  
  // === REPRINT 배너 (Receipt) ===
  const isReceiptReprint = receiptData.isReprint || false;
  if (isReceiptReprint) {
    const reprintFontSize = Math.round(PRINTER_CONFIG.fontSize.xlarge * 0.85);
    y = drawTextBlock(ctx, {
      text: '** REPRINT **',
      fontSize: reprintFontSize,
      fontWeight: 'bold',
      align: 'center',
      inverse: false
    }, y);
    y += 5;
  }

  // === 스토어 헤더 (반전) ===
  const stStoreName = getGraphicElementStyle(layout, 'storeName', {
    fontSize: PRINTER_CONFIG.fontSize.xlarge,
    fontWeight: 'bold',
    fontStyle: 'normal',
    align: 'center',
    inverse: true
  });
  if (stStoreName.visible) {
    y += stStoreName.lineSpacing;
    const storeBase = Math.max(Number(stStoreName.fontSize) || 0, PRINTER_CONFIG.fontSize.xlarge);
    const storeFontSize = Math.min(200, Math.round(storeBase * 1.15)); // +15%
    y = drawTextBlock(ctx, {
      text: storeName,
      fontSize: storeFontSize,
      fontWeight: stStoreName.fontWeight,
      fontStyle: stStoreName.fontStyle,
      align: stStoreName.align,
      // "이전 깔끔한 폼" 고정: 스토어 타이틀은 항상 반전(bar)
      inverse: true,
      extraBold: stStoreName.extraBold,
      lineHeight: stStoreName.lineHeight
    }, y);
  }
  
  if (storeAddress) {
    const stStoreAddress = getGraphicElementStyle(layout, 'storeAddress', {
      fontSize: PRINTER_CONFIG.fontSize.small,
      fontWeight: 'normal',
      fontStyle: 'normal',
      align: 'center',
      inverse: false
    });
    if (stStoreAddress.visible) {
      y += stStoreAddress.lineSpacing;
      const addrBase = Math.max(Number(stStoreAddress.fontSize) || 0, META_MIN_FONT);
      // 요청: 주소를 "지금보다 20% 줄임" (기존 +50%에서 0.8배)
      const addrFontSize = Math.min(200, Math.round(Math.round(addrBase * 1.5) * 0.8));
      y = drawTextBlock(ctx, {
        text: storeAddress,
        fontSize: addrFontSize,
        fontWeight: stStoreAddress.fontWeight,
        fontStyle: stStoreAddress.fontStyle,
        align: stStoreAddress.align,
        inverse: stStoreAddress.inverse,
        extraBold: stStoreAddress.extraBold,
        lineHeight: stStoreAddress.lineHeight
      }, y);
    }
  }
  
  if (storePhone) {
    const stStorePhone = getGraphicElementStyle(layout, 'storePhone', {
      fontSize: PRINTER_CONFIG.fontSize.small,
      fontWeight: 'normal',
      fontStyle: 'normal',
      align: 'center',
      inverse: false
    });
    if (stStorePhone.visible) {
      y += stStorePhone.lineSpacing;
      const phoneBase = Math.max(Number(stStorePhone.fontSize) || 0, META_MIN_FONT);
      const phoneFontSize = Math.min(200, Math.round(phoneBase * 1.5)); // +50%
      y = drawTextBlock(ctx, {
        text: `Tel: ${storePhone}`,
        fontSize: phoneFontSize,
        fontWeight: stStorePhone.fontWeight,
        fontStyle: stStorePhone.fontStyle,
        align: stStorePhone.align,
        inverse: stStorePhone.inverse,
        extraBold: stStorePhone.extraBold,
        lineHeight: stStorePhone.lineHeight
      }, y);
    }
  }
  
  y += 10;
  
  // === 주문 정보 (반전 헤더) ===
  // 채널명 매핑: POS, DINE-IN, TABLE 등은 "DINE-IN"으로 표시
  let orderTypeText;
  if (!channel || channel === 'DINE-IN' || channel === 'POS' || channel === 'TABLE') {
    orderTypeText = 'DINE-IN';
  } else if (channel === 'FORHERE' || channel === 'FOR HERE') {
    orderTypeText = 'FOR HERE';
  } else {
    orderTypeText = channel;
  }
  if (tableName && !channel) orderTypeText = tableName;
  
  // Delivery: 채널명 + 외부 주문번호 표시 (예: DoorDash / #7878)
  if (isDeliveryLike) {
    orderTypeText = deliveryCompany || 'DELIVERY';
  }
  const isDineInLikeForReceipt = (channel === 'DINE-IN' || channel === 'POS' || channel === 'TABLE' || channel === 'HANDHELD' || channel === 'SUBPOS');
  const dineInReceiptHeader = (isDineInLikeForReceipt && tableName) ? `DINE-IN / ${tableName}` : '';
  
  {
    const orderLineText = isDeliveryLike
      ? `${orderTypeText} / #${String(deliveryOrderNumber || orderNumber).replace('#', '')}`
      : (dineInReceiptHeader ? dineInReceiptHeader : `${orderTypeText} #${String(orderNumber).replace('#', '')}`);
    const orderLineKey =
      (layout && typeof layout === 'object' && layout.orderChannel) ? 'orderChannel' : 'orderType';
    const stOrderLine = getGraphicElementStyle(layout, orderLineKey, {
      fontSize: PRINTER_CONFIG.fontSize.large,
      fontWeight: 'bold',
      fontStyle: 'normal',
      align: 'center',
      inverse: false
    });
    // 주문 채널+테이블 라인은 레이아웃 visible 설정과 무관하게 항상 출력
    {
      y += stOrderLine.lineSpacing;
      y = drawTextBlock(ctx, {
        text: orderLineText,
        fontSize: Math.max(Number(stOrderLine.fontSize) || 0, PRINTER_CONFIG.fontSize.large),
        fontWeight: stOrderLine.fontWeight || 'bold',
        fontStyle: stOrderLine.fontStyle,
        align: stOrderLine.align || 'center',
        inverse: false,
        extraBold: stOrderLine.extraBold,
        lineHeight: stOrderLine.lineHeight
      }, y);
    }
  }

  // Delivery: PAID 표시 (항상 눈에 띄게)
  if (isDeliveryLike && isPaid) {
    const stPaid = getGraphicElementStyle(layout, 'paidStatus', {
      fontSize: LABEL_FONT_SIZE,
      fontWeight: 'bold',
      fontStyle: 'normal',
      align: 'center',
      inverse: false
    });
    if (stPaid.visible) {
      y += stPaid.lineSpacing;
      y = drawTextBlock(ctx, {
        text: 'PAID',
        fontSize: stPaid.fontSize,
        fontWeight: stPaid.fontWeight,
        fontStyle: stPaid.fontStyle,
        align: stPaid.align,
        inverse: stPaid.inverse,
        extraBold: stPaid.extraBold,
        lineHeight: stPaid.lineHeight,
        box: true
      }, y);
    }
  }

  // 고객 정보 (TOGO/ONLINE/DELIVERY에서 표시) - 라벨과 동일 폰트 사이즈
  if ((isDeliveryLike || channel === 'TOGO' || channel === 'ONLINE') && (customerName || customerPhone)) {
    const customerDisplay = customerName && customerPhone
      ? `${customerName} · ${customerPhone}`
      : (customerName || customerPhone);
    const stCustomer = getGraphicElementStyle(layout, 'customerName', {
      fontSize: LABEL_FONT_SIZE,
      fontWeight: 'bold',
      fontStyle: 'normal',
      align: 'center',
      inverse: false
    });
    if (stCustomer.visible) {
      y += stCustomer.lineSpacing;
      y = drawTextBlock(ctx, {
        text: customerDisplay,
        fontSize: stCustomer.fontSize,
        fontWeight: stCustomer.fontWeight,
        fontStyle: stCustomer.fontStyle,
        align: stCustomer.align,
        inverse: stCustomer.inverse,
        extraBold: stCustomer.extraBold,
        lineHeight: stCustomer.lineHeight
      }, y);
    }
  }

  // Equal Split label (show on every guest receipt)
  if (splitCount > 1 && splitIndex >= 1) {
    y = drawTextBlock(ctx, {
      text: `EQUAL SPLIT (${splitIndex} of ${splitCount})`,
      fontSize: LABEL_FONT_SIZE,
      fontWeight: 'bold',
      align: 'center',
      box: true
    }, y);
  }
  
  // 서버, 날짜 (15% 더 굵게)
  if (serverName) {
    const stServer = getGraphicElementStyle(layout, 'serverName', {
      fontSize: PRINTER_CONFIG.fontSize.small,
      fontWeight: 'bold',
      fontStyle: 'normal',
      align: 'left',
      inverse: false
    });
    if (stServer.visible) {
      y += stServer.lineSpacing;
      y = drawTextBlock(ctx, {
        text: `Server: ${serverName}`,
        fontSize: stServer.fontSize,
        fontWeight: stServer.fontWeight,
        fontStyle: stServer.fontStyle,
        align: stServer.align,
        inverse: stServer.inverse,
        extraBold: stServer.extraBold,
        lineHeight: stServer.lineHeight
      }, y);
    }
  }
  
  {
    const stDate = getGraphicElementStyle(layout, 'dateTime', {
      fontSize: PRINTER_CONFIG.fontSize.small,
      fontWeight: 'bold',
      fontStyle: 'normal',
      align: 'left',
      inverse: false
    });
    if (stDate.visible) {
      y += stDate.lineSpacing;
      y = drawTextBlock(ctx, {
        text: `Date: ${new Date().toLocaleString()}`,
        // 요청: Date/시간을 "지금보다 25% 키움"
        fontSize: Math.min(200, Math.round(Math.max(Number(stDate.fontSize) || 0, META_MIN_FONT) * 1.25)),
        fontWeight: stDate.fontWeight,
        fontStyle: stDate.fontStyle,
        align: stDate.align,
        inverse: stDate.inverse,
        extraBold: stDate.extraBold,
        lineHeight: stDate.lineHeight
      }, y);
    }
  }
  
  y = drawSeparator(ctx, y, 'dashed');
  
  // === 아이템 목록 (Dine-in → TOGO separator → TOGO items per guest) ===
  const allItems = [];
  const pushDineThenTogo = (itemList) => {
    const dine = itemList.filter(it => !(it.togoLabel || it.togo_label));
    const togo = itemList.filter(it => !!(it.togoLabel || it.togo_label));
    dine.forEach(item => allItems.push({ type: 'item', ...item }));
    if (togo.length > 0 && showTogoSeparator) {
      allItems.push({ type: 'togo_separator' });
      togo.forEach(item => allItems.push({ type: 'item', ...item }));
    } else if (togo.length > 0) {
      togo.forEach(item => allItems.push({ type: 'item', ...item }));
    }
  };
  if (guestSections.length > 0) {
    guestSections.forEach((section, idx) => {
      if (guestSections.length > 1) {
        allItems.push({ type: 'guest', guestNumber: section.guestNumber || idx + 1 });
      }
      pushDineThenTogo(section.items || []);
      if (guestSections.length > 1 && (section.guestSubtotal != null || section.guestTaxLines)) {
        allItems.push({
          type: 'guest_summary',
          guestNumber: section.guestNumber || idx + 1,
          guestSubtotal: section.guestSubtotal,
          guestTaxLines: section.guestTaxLines || [],
          guestTaxesTotal: section.guestTaxesTotal || 0,
          guestTotal: section.guestTotal || 0,
          guestAdjustments: section.guestAdjustments || []
        });
      }
    });
  } else {
    pushDineThenTogo(items);
  }
  
  allItems.forEach(entry => {
    if (entry.type === 'guest') {
      y = drawTextBlock(ctx, {
        text: `--- Guest ${entry.guestNumber} ---`,
        fontSize: PRINTER_CONFIG.fontSize.normal,
        align: 'center'
      }, y);
    } else if (entry.type === 'togo_separator') {
      y += 2;
      y = drawTextBlock(ctx, {
        text: '- - - - - - - TOGO - - - - - - -',
        fontSize: PRINTER_CONFIG.fontSize.normal,
        fontWeight: 'bold',
        align: 'center'
      }, y);
      y += 2;
    } else if (entry.type === 'guest_summary') {
      const guestSumRegularOpts = {
        fontSize: ITEM_BASE_FONT_SIZE,
        fontWeight: 'normal',
        fontStyle: 'normal',
        inverse: false,
        extraBold: false
      };
      const guestSumBoldOpts = {
        fontSize: ITEM_BASE_FONT_SIZE,
        fontWeight: 'bold',
        fontStyle: 'normal',
        inverse: false,
        extraBold: true
      };
      y += 4;
      // Guest subtotal
      if (entry.guestSubtotal != null) {
        y = drawLeftRightText(ctx, `  Subtotal`, `$${Number(entry.guestSubtotal).toFixed(2)}`, y, guestSumRegularOpts);
      }
      // Guest adjustments (discount, gratuity, fees)
      const hasGuestAdj = Array.isArray(entry.guestAdjustments) && entry.guestAdjustments.some(a => Math.abs(Number(a.amount || 0)) >= 0.005);
      if (hasGuestAdj) {
        entry.guestAdjustments.forEach(adj => {
          const amt = Number(adj.amount || 0);
          if (Math.abs(amt) < 0.005) return;
          let label = adj.label || 'Adjustment';
          const sign = amt < 0 ? '-' : '';
          y = drawLeftRightText(ctx, `  ${label}`, `${sign}$${Math.abs(amt).toFixed(2)}`, y, guestSumRegularOpts);
        });
        // Net Sales (할인이 있을 때만)
        const adjTotal = (entry.guestAdjustments || []).reduce((s, a) => s + Number(a.amount || 0), 0);
        const netSales = Number((Number(entry.guestSubtotal || 0) + adjTotal).toFixed(2));
        y = drawLeftRightText(ctx, `  Net Sales`, `$${netSales.toFixed(2)}`, y, guestSumRegularOpts);
      }
      // Guest tax lines
      if (Array.isArray(entry.guestTaxLines) && entry.guestTaxLines.length > 0) {
        entry.guestTaxLines.forEach(tax => {
          if (Number(tax.amount || 0) < 0.005) return;
          y = drawLeftRightText(ctx, `  ${tax.name}`, `$${Number(tax.amount).toFixed(2)}`, y, guestSumRegularOpts);
        });
      }
      // Guest total
      if (entry.guestTotal != null) {
        y = drawLeftRightText(ctx, `  Guest ${entry.guestNumber} Total`, `$${Number(entry.guestTotal).toFixed(2)}`, y, guestSumBoldOpts);
      }
      y += 2;
    } else {
      const itemName = entry.name || entry.itemName || '';
      const quantity = entry.quantity || entry.qty || 1;
      const basePrice = Number(entry.price || entry.itemPrice || 0);
      const itemOnlyTotal = basePrice * quantity;
      
      const unitLabel = quantity > 1 ? ` @$${basePrice.toFixed(2)}` : '';
      const stItems = getGraphicElementStyle(layout, 'items', {
        fontSize: 26,
        fontWeight: 'bold',
        fontStyle: 'normal',
        align: 'left',
        inverse: false
      });
      if (stItems.visible) {
        y += stItems.lineSpacing;
        y = drawLeftRightText(ctx, `${quantity}x ${itemName}${unitLabel}`, `$${itemOnlyTotal.toFixed(2)}`, y, {
          // 최소 폰트 크기 보장 (이전 깔끔한 폼 기준)
          fontSize: Math.max(Number(stItems.fontSize) || 0, 26),
          fontWeight: stItems.fontWeight,
          fontStyle: stItems.fontStyle,
          inverse: stItems.inverse,
          lineHeight: stItems.lineHeight,
          extraBold: true
        });
      }

      // TOGO label (per item) - always show if item has togoLabel
      const entryIsTogo = !!(entry.togoLabel || entry.togo_label);
      if (entryIsTogo) {
        console.log(`🔍 [TOGO DEBUG] Drawing <<TOGO>> for item: "${itemName}" at y=${y}`);
        const stTogo = getGraphicElementStyle(layout, 'modifiers', {
          fontSize: PRINTER_CONFIG.fontSize.normal,
          fontWeight: 'bold',
          fontStyle: 'normal',
          align: 'left',
          inverse: false
        });
        y += Math.max(0, stTogo.lineSpacing || 0);
        y = drawTextBlock(ctx, {
          text: `  <<TOGO>>`,
          fontSize: Math.max(Number(stTogo.fontSize) || 0, PRINTER_CONFIG.fontSize.normal),
          fontWeight: stTogo.fontWeight,
          fontStyle: stTogo.fontStyle,
          align: stTogo.align,
          inverse: false,
          extraBold: stTogo.extraBold,
          lineHeight: stTogo.lineHeight
        }, y);
      }
      
      // Modifiers (flatten nested structures)
      const modifiers = flattenModifiers(entry.modifiers);
      modifiers.forEach(mod => {
        if (mod.name) {
          const modPrice = Number(mod.price || 0);
          const priceText = modPrice > 0 ? `$${(modPrice * quantity).toFixed(2)}` : '';
          const stMods = getGraphicElementStyle(layout, 'modifiers', {
            fontSize: PRINTER_CONFIG.fontSize.normal,
            fontWeight: 'bold',
            fontStyle: 'normal',
            align: 'left',
            inverse: false
          });
          if (stMods.visible) {
            y += stMods.lineSpacing;
            y = drawLeftRightText(ctx, `  + ${mod.name}`, priceText, y, {
              // 최소 폰트 크기 보장 (이전 깔끔한 폼 기준)
              fontSize: Math.max(Number(stMods.fontSize) || 0, PRINTER_CONFIG.fontSize.normal),
              fontWeight: stMods.fontWeight,
              fontStyle: stMods.fontStyle,
              inverse: stMods.inverse,
              lineHeight: stMods.lineHeight,
              extraBold: true
            });
          }
        }
      });
      
      // Memo (if exists)
      const memoStr = getMemoText(entry.memo);
      if (memoStr) {
        const memoPrice = (entry.memo && typeof entry.memo === 'object') ? Number(entry.memo.price || 0) : 0;
        const memoPriceText = memoPrice > 0 ? `$${(memoPrice * quantity).toFixed(2)}` : '';
        const stNote = getGraphicElementStyle(layout, 'itemNote', {
          fontSize: PRINTER_CONFIG.fontSize.normal,
          fontWeight: 'bold',
          fontStyle: 'italic',
          align: 'left',
          inverse: false
        });
        if (stNote.visible) {
          y += stNote.lineSpacing;
          y = drawLeftRightText(ctx, `  * ${memoStr}`, memoPriceText, y, {
            fontSize: stNote.fontSize,
            fontWeight: stNote.fontWeight,
            fontStyle: stNote.fontStyle,
            inverse: stNote.inverse,
            lineHeight: stNote.lineHeight,
            paddingY: 4,
            extraBold: true
          });
        }
      }

      // Item discount (if exists)
      const discount = entry.discount;
      if (discount && discount.amount > 0) {
        const discLabel = discount.type || 'Discount';
        const stDisc = getGraphicElementStyle(layout, 'itemDiscount', {
          fontSize: PRINTER_CONFIG.fontSize.normal,
          fontWeight: 'bold',
          fontStyle: 'italic',
          align: 'left',
          inverse: false
        });
        if (stDisc.visible) {
          y += stDisc.lineSpacing;
          y = drawLeftRightText(ctx, `  - ${discLabel}`, `-$${Number(discount.amount).toFixed(2)}`, y, {
            fontSize: stDisc.fontSize,
            fontWeight: stDisc.fontWeight,
            fontStyle: stDisc.fontStyle,
            inverse: stDisc.inverse,
            lineHeight: stDisc.lineHeight,
            extraBold: stDisc.extraBold
          });
        }
      }
    }
  });
  
  y = drawSeparator(ctx, y, 'dashed');
  
  // === 소계, 세금, 할인 (15% 더 굵게) ===
  if (receiptData.subtotal != null) {
    const subLabel = (splitCount > 1 ? `Subtotal (1/${splitCount})` : 'Subtotal');
    const stSubtotal = getGraphicElementStyle(layout, 'subtotal', {
      fontSize: PRINTER_CONFIG.fontSize.normal,
      fontWeight: 'bold',
      fontStyle: 'normal',
      align: 'left',
      inverse: false
    });
    if (stSubtotal.visible) {
      y += stSubtotal.lineSpacing;
      y = drawLeftRightText(ctx, subLabel, `$${Number(receiptData.subtotal).toFixed(2)}`, y, {
        fontSize: ITEM_BASE_FONT_SIZE,
        fontWeight: stSubtotal.fontWeight,
        fontStyle: stSubtotal.fontStyle,
        inverse: stSubtotal.inverse,
        lineHeight: stSubtotal.lineHeight,
        extraBold: true
      });
    }
  }

  // 할인 (Subtotal 바로 아래에 표시)
  if (receiptData.adjustments && receiptData.adjustments.length > 0) {
    receiptData.adjustments.forEach(adj => {
      const amount = Number(adj.amount || 0);
      let label = adj.label || adj.name || 'Discount';
      if (amount < 0) label = label.replace(/^Discount\b/, 'D/C');
      const sign = amount < 0 ? '-' : '';
      const stAdj = getGraphicElementStyle(layout, 'discount', {
        fontSize: PRINTER_CONFIG.fontSize.normal,
        fontWeight: 'bold',
        fontStyle: 'normal',
        align: 'left',
        inverse: false
      });
      if (stAdj.visible) {
        y += stAdj.lineSpacing;
        y = drawLeftRightText(ctx, `${label}`, `${sign}$${Math.abs(amount).toFixed(2)}`, y, {
          fontSize: ITEM_BASE_FONT_SIZE,
          fontWeight: stAdj.fontWeight,
          fontStyle: stAdj.fontStyle,
          inverse: stAdj.inverse,
          lineHeight: stAdj.lineHeight,
          extraBold: stAdj.extraBold
        });
      }
    });
    // Net Sales (할인 적용 후 순매출)
    const hasDiscount = receiptData.adjustments.some(adj => Number(adj.amount || 0) < 0);
    if (hasDiscount && receiptData.subtotal != null) {
      const discountSum = receiptData.adjustments.reduce((s, adj) => s + Number(adj.amount || 0), 0);
      const netSales = Number((Number(receiptData.subtotal) + discountSum).toFixed(2));
      const stAdj = getGraphicElementStyle(layout, 'discount', {
        fontSize: PRINTER_CONFIG.fontSize.normal,
        fontWeight: 'bold',
        fontStyle: 'normal',
        align: 'left',
        inverse: false
      });
      y += stAdj.lineSpacing;
      y = drawLeftRightText(ctx, 'Net Sales', `$${netSales.toFixed(2)}`, y, {
        fontSize: ITEM_BASE_FONT_SIZE,
        fontWeight: stAdj.fontWeight,
        fontStyle: stAdj.fontStyle,
        inverse: stAdj.inverse,
        lineHeight: stAdj.lineHeight,
        extraBold: stAdj.extraBold
      });
    }
  }

  // 세금 (할인 후 금액 기준)
  if (receiptData.taxLines && receiptData.taxLines.length > 0) {
    receiptData.taxLines.forEach(tax => {
      const taxLabel = splitCount > 1 ? `${tax.name} (1/${splitCount})` : `${tax.name}`;
      const key = String(tax?.name || '').toUpperCase().includes('GST') ? 'taxGST' : 'taxPST';
      const stTax = getGraphicElementStyle(layout, key, {
        fontSize: PRINTER_CONFIG.fontSize.normal,
        fontWeight: 'bold',
        fontStyle: 'normal',
        align: 'left',
        inverse: false
      });
      if (stTax.visible) {
        y += stTax.lineSpacing;
        y = drawLeftRightText(ctx, taxLabel, `$${Number(tax.amount).toFixed(2)}`, y, {
          fontSize: ITEM_BASE_FONT_SIZE,
          fontWeight: stTax.fontWeight,
          fontStyle: stTax.fontStyle,
          inverse: stTax.inverse,
          lineHeight: stTax.lineHeight,
          extraBold: true
        });
      }
    });
  }
  
  // === TOTAL ===
  if (receiptData.total != null) {
    y = drawSeparator(ctx, y, 'solid');
    const totalLabel = (() => {
      if (!(splitCount > 1)) return 'TOTAL';
      const n = splitCount;
      if (RECEIPT_WIDTH === 384) return `TOTAL 1/${n}`;
      return `TOTAL (1/${n})`;
    })();
    y = drawLeftRightText(ctx, totalLabel, `$${Number(receiptData.total).toFixed(2)}`, y, {
      fontSize: ITEM_BASE_FONT_SIZE + 2,
      fontWeight: 'bold',
      fontStyle: 'normal',
      inverse: false,
      extraBold: true
    });
  }

  // === 결제 정보 ===
  if (receiptData.payments && receiptData.payments.length > 0) {
    const prettyMethod = (m) => {
      const upper = String(m || 'OTHER').toUpperCase();
      const map = {
        CASH: 'Cash',
        DEBIT: 'Debit',
        VISA: 'Visa',
        MC: 'MC',
        MASTERCARD: 'MC',
        OTHER_CARD: 'Other Card',
        OTHER: 'Other',
        PAID: 'Paid',
      };
      return map[upper] || upper;
    };

    const dineOrTogoTag = (() => {
      const ch = String(channel || '').toUpperCase();
      const ot = String(orderTypeUpper || '').toUpperCase();
      if (isDeliveryLike) return 'Togo';
      if (ch.includes('TOGO') || ch.includes('ONLINE') || ch.includes('PICKUP') || ch.includes('TAKEOUT') || ch.includes('DELIVERY')) return 'Togo';
      if (ot.includes('TOGO') || ot.includes('PICKUP') || ot.includes('TAKEOUT') || ot.includes('DELIVERY')) return 'Togo';
      return 'Dine-in';
    })();

    const tipByMethod = {};
    const paidByMethod = {};
    let grossPaidTotal = 0;
    receiptData.payments.forEach(p => {
      const method = (p.method || 'OTHER').toUpperCase();
      const amount = Number(p.amount || 0);
      const tipField = Number(p.tip || 0);
      grossPaidTotal += amount;
      if (!paidByMethod[method]) paidByMethod[method] = 0;
      paidByMethod[method] += amount;

      if (tipField > 0) {
        if (!tipByMethod[method]) tipByMethod[method] = 0;
        tipByMethod[method] += tipField;
      }
    });

    // 팁 (결제수단별)
    const tipEntries = Object.entries(tipByMethod).filter(([, v]) => Number(v || 0) > 0);
    if (tipEntries.length > 0) {
      tipEntries.forEach(([m, v]) => {
        y = drawLeftRightText(ctx, `Tip`, `$${Number(v).toFixed(2)}`, y, {
          fontSize: ITEM_BASE_FONT_SIZE,
          fontWeight: 'bold',
          fontStyle: 'normal',
          inverse: false
        });
      });
    }

    // PAID (Reverse — 검은 배경 + 흰 글씨)
    {
      const paidLabel = 'PAID';
      const paidAmountStr = `$${Number(grossPaidTotal).toFixed(2)}`;
      const paidFontSize = ITEM_BASE_FONT_SIZE + 2;
      const width = ctx._receiptWidth || PRINTER_CONFIG.width;
      const padX = Math.max(3, Math.round(PRINTER_CONFIG.padding));
      const boxPadY = 6;
      const lineH = paidFontSize + boxPadY * 2;

      ctx.fillStyle = '#000000';
      ctx.fillRect(padX, y, width - padX * 2, lineH);

      ctx.fillStyle = '#FFFFFF';
      ctx.textBaseline = 'middle';
      ctx.font = `normal bold ${paidFontSize}px "Arial", "Malgun Gothic", sans-serif`;
      const textY = y + lineH / 2;
      ctx.fillText(paidLabel, padX + 8, textY);
      ctx.fillText(paidLabel, padX + 8 + 0.5, textY);
      const amountW = ctx.measureText(paidAmountStr).width;
      ctx.fillText(paidAmountStr, width - padX - 8 - amountW, textY);
      ctx.fillText(paidAmountStr, width - padX - 8 - amountW + 0.5, textY);
      ctx.fillStyle = '#000000';
      y += lineH + 2;
    }

    // 결제 수단별 — 카드 등은 청구에 적용된 금액 합계, 현금은 손님이 실제로 낸 금액(cashTendered) 우선 표시
    y += 12;
    const cashTenderedNum = Number(receiptData.cashTendered || 0);
    Object.entries(paidByMethod).forEach(([method, totalPaid]) => {
      if (Number(totalPaid || 0) <= 0) return;
      const showCash =
        String(method).toUpperCase() === 'CASH' && cashTenderedNum > 0.0001;
      const rightAmt = showCash ? cashTenderedNum : Number(totalPaid);
      y = drawLeftRightText(ctx, `${prettyMethod(method)}`, `$${rightAmt.toFixed(2)}`, y, {
        fontSize: ITEM_BASE_FONT_SIZE,
        fontWeight: 'bold',
        fontStyle: 'normal',
        inverse: false
      });
    });

    y += 6;

    // CHANGE — 현금 거래에만 표시 (거스름). dashed 구분선 직후 strokeRect는 setLineDash 미초기화 시 점선으로 나옴 → 실선 강제
    const changeAmt = Number(receiptData.change || 0);
    const hasCashContext =
      (receiptData.cashTendered && Number(receiptData.cashTendered) > 0) ||
      (Array.isArray(receiptData.payments) &&
        receiptData.payments.some(p => String((p && p.method) || '').toUpperCase() === 'CASH'));
    const showChangeBox = changeAmt > 0.0001 && hasCashContext;
    if (showChangeBox) {
      const changeLabel = 'CHANGE';
      const changeAmountStr = `$${changeAmt.toFixed(2)}`;
      const changeFontSize = ITEM_BASE_FONT_SIZE + 2;
      const widthC = ctx._receiptWidth || PRINTER_CONFIG.width;
      const padXC = Math.max(3, Math.round(PRINTER_CONFIG.padding));
      const boxPadYC = 6;
      const lineHC = changeFontSize + boxPadYC * 2;

      y += 2;
      ctx.setLineDash([]);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1;
      ctx.strokeRect(padXC, y, widthC - padXC * 2, lineHC);

      ctx.fillStyle = '#000000';
      ctx.textBaseline = 'middle';
      ctx.font = `normal bold ${changeFontSize}px "Arial", "Malgun Gothic", sans-serif`;
      const textYC = y + lineHC / 2;
      ctx.fillText(changeLabel, padXC + 8, textYC);
      ctx.fillText(changeLabel, padXC + 8 + 0.5, textYC);
      const amountWC = ctx.measureText(changeAmountStr).width;
      ctx.fillText(changeAmountStr, widthC - padXC - 8 - amountWC, textYC);
      ctx.fillText(changeAmountStr, widthC - padXC - 8 - amountWC + 0.5, textYC);
      y += lineHC + 2;
    }

    if (!showChangeBox) {
      y = drawSeparator(ctx, y, 'solid');
    } else {
      y += 8;
    }
  } else if (receiptData.total != null) {
    y = drawSeparator(ctx, y, 'solid');
  }

  // === Footer ===
  y += 10;
  const footerMessage = receiptData.footer?.message || 'Thank you! Please come again!';
  const stGreeting = getGraphicElementStyle(layout, 'greeting', {
    fontSize: PRINTER_CONFIG.fontSize.normal,
    fontWeight: 'bold',
    fontStyle: 'normal',
    align: 'center',
    inverse: false
  });
  if (stGreeting.visible) {
    y += stGreeting.lineSpacing;
    const greetBase = Math.max(Number(stGreeting.fontSize) || 0, META_MIN_FONT);
    const greetFontSize = Math.min(200, Math.round(Math.round(greetBase * 1.5) * 0.8));
    y = drawTextBlock(ctx, {
      text: footerMessage,
      fontSize: greetFontSize,
      fontWeight: stGreeting.fontWeight,
      fontStyle: stGreeting.fontStyle,
      align: stGreeting.align,
      inverse: stGreeting.inverse,
      extraBold: stGreeting.extraBold,
      lineHeight: stGreeting.lineHeight
    }, y);
  }
  
  y += 30;
  
  // IMPORTANT: use the actual receipt width (58/80mm), not the global 80mm width,
  // otherwise the far-right edge can be clipped or the image can be cropped.
  const imageData = ctx.getImageData(0, 0, RECEIPT_WIDTH, y);
  return imageToEscPosRaster(imageData.data, RECEIPT_WIDTH, y, receiptData?.graphicScale);
}

/**
 * Bill 그래픽 렌더링 (Receipt와 유사하지만 결제 정보 없음)
 * @param {Object} billData - Bill 데이터
 * @returns {Buffer} ESC/POS 비트맵 데이터
 */
function renderBillGraphic(billData) {
  ensureFontsRegistered();
  // Receipt 렌더링 재사용하되 결제 정보 제외
  const billDataWithoutPayment = {
    ...billData,
    payments: null,
    change: null,
    footer: { message: billData.footer?.message || 'Thank you for dining with us!' },
    // Bill: show item-level TOGO label (<<TOGO>>) and hide TOGO separator line
    togoDisplayMode: 'per_item',
    showTogoSeparator: false,
  };
  
  return renderReceiptGraphic(billDataWithoutPayment);
}

/**
 * 그래픽 모드로 Kitchen Ticket 출력 데이터 생성
 * @param {Object} orderData - 주문 데이터
 * @param {boolean} openDrawer - 캐시 드로워 열기 여부
 * @param {boolean} cut - 용지 컷 여부
 * @returns {Buffer} ESC/POS 전체 데이터
 */
function buildGraphicKitchenTicket(orderData, openDrawer = false, cut = true) {
  const buffers = [ESC_POS.INIT];
  
  if (openDrawer) {
    buffers.push(ESC_POS.OPEN_DRAWER);
  }
  
  buffers.push(renderKitchenTicketGraphic(orderData));
  
  if (cut) {
    buffers.push(ESC_POS.LINE_FEED);
    buffers.push(ESC_POS.LINE_FEED);
    buffers.push(ESC_POS.LINE_FEED);
    buffers.push(ESC_POS.CUT);
  }
  
  return Buffer.concat(buffers);
}

/**
 * 그래픽 모드로 Receipt 출력 데이터 생성
 * @param {Object} receiptData - 영수증 데이터
 * @param {boolean} openDrawer - 캐시 드로워 열기 여부
 * @param {boolean} cut - 용지 컷 여부
 * @returns {Buffer} ESC/POS 전체 데이터
 */
function buildGraphicReceipt(receiptData, openDrawer = false, cut = true) {
  const buffers = [ESC_POS.INIT];
  
  if (openDrawer) {
    buffers.push(ESC_POS.OPEN_DRAWER);
  }

  // TopMargin:
  // - 일부 프린터에서 dot feed(ESC J)가 무시되는 문제가 있어,
  //   기본값은 "lines + bitmap remainder"로 처리해 확실히 차이가 나게 함.
  // - PRINT_TOP_MARGIN_MODE:
  //    - lines (default): ESC d(라인 feed) + 남는 mm는 bitmap 내부 여백
  //    - bitmap: bitmap 내부 여백만
  //    - feed: dot feed만(호환성 낮은 기기 존재)
  const marginMode = String(process.env.PRINT_TOP_MARGIN_MODE || 'lines').toLowerCase();
  if (marginMode === 'feed') {
    try {
      const baseLayout = getLayoutFromPrintData(receiptData);
      const lockedPresetId = getLockedPresetId(receiptData);
      const lockedPresetLayout = lockedPresetId ? loadPrintPreset(lockedPresetId) : null;
      const layout = lockedPresetLayout ? applyLockedPresetLayout(baseLayout, lockedPresetLayout) : baseLayout;
      const tm = clampNumber(receiptData?.topMargin ?? layout?.topMargin ?? 5, 0, 120, 5);
      const dots = Math.round(tm * 8); // 203 DPI ≈ 8 dots/mm
      if (dots > 0) pushFeedDots(buffers, dots);
      // Avoid double-applying margin inside the bitmap.
      const dataForRender = {
        ...receiptData,
        topMargin: 0,
        layout: (layout && typeof layout === 'object') ? { ...layout, topMargin: 0 } : receiptData.layout
      };
      buffers.push(renderReceiptGraphic(dataForRender));
    } catch {
      buffers.push(renderReceiptGraphic(receiptData));
    }
  } else if (marginMode === 'bitmap') {
    // bitmap only: renderReceiptGraphic 내부에서 topMarginPx로 처리
    buffers.push(renderReceiptGraphic(receiptData));
  } else {
    // lines(default): feed lines + remaining mm in bitmap to make margin reliably visible
    try {
      const baseLayout = getLayoutFromPrintData(receiptData);
      const lockedPresetId = getLockedPresetId(receiptData);
      const lockedPresetLayout = lockedPresetId ? loadPrintPreset(lockedPresetId) : null;
      const layout = lockedPresetLayout ? applyLockedPresetLayout(baseLayout, lockedPresetLayout) : baseLayout;
      const tm = clampNumber(receiptData?.topMargin ?? layout?.topMargin ?? 5, 0, 120, 5);
      const mmPerLine = 25.4 / 6; // default ESC/POS line feed is commonly 1/6 inch
      const lines = Math.max(0, Math.floor(tm / mmPerLine));
      const remMm = Math.max(0, tm - lines * mmPerLine);
      // Some printers ignore pure LF at job start; use "space+LF" blank line prints.
      if (lines > 0) pushBlankLineFeeds(buffers, lines);
      const dataForRender = {
        ...receiptData,
        topMargin: remMm,
        layout: (layout && typeof layout === 'object') ? { ...layout, topMargin: remMm } : receiptData.layout
      };
      buffers.push(renderReceiptGraphic(dataForRender));
    } catch {
      buffers.push(renderReceiptGraphic(receiptData));
    }
  }
  
  if (cut) {
    buffers.push(ESC_POS.LINE_FEED);
    buffers.push(ESC_POS.LINE_FEED);
    buffers.push(ESC_POS.LINE_FEED);
    buffers.push(ESC_POS.CUT);
  }
  
  return Buffer.concat(buffers);
}

/**
 * 그래픽 모드로 Bill 출력 데이터 생성
 * @param {Object} billData - Bill 데이터
 * @param {boolean} cut - 용지 컷 여부
 * @returns {Buffer} ESC/POS 전체 데이터
 */
function buildGraphicBill(billData, cut = true) {
  const buffers = [ESC_POS.INIT];

  const marginMode = String(process.env.PRINT_TOP_MARGIN_MODE || 'lines').toLowerCase();
  if (marginMode === 'feed') {
    // Apply topMargin as real paper feed (same logic as receipt).
    try {
      const baseLayout = getLayoutFromPrintData(billData);
      const lockedPresetId = getLockedPresetId(billData);
      const lockedPresetLayout = lockedPresetId ? loadPrintPreset(lockedPresetId) : null;
      const layout = lockedPresetLayout ? applyLockedPresetLayout(baseLayout, lockedPresetLayout) : baseLayout;
      const tm = clampNumber(billData?.topMargin ?? layout?.topMargin ?? 5, 0, 120, 5);
      const dots = Math.round(tm * 8);
      if (dots > 0) pushFeedDots(buffers, dots);
      const dataForRender = {
        ...billData,
        topMargin: 0,
        layout: (layout && typeof layout === 'object') ? { ...layout, topMargin: 0 } : billData.layout
      };
      buffers.push(renderBillGraphic(dataForRender));
    } catch {
      buffers.push(renderBillGraphic(billData));
    }
  } else if (marginMode === 'bitmap') {
    buffers.push(renderBillGraphic(billData));
  } else {
    // lines(default): feed lines + remaining mm in bitmap to make margin reliably visible
    try {
      const baseLayout = getLayoutFromPrintData(billData);
      const lockedPresetId = getLockedPresetId(billData);
      const lockedPresetLayout = lockedPresetId ? loadPrintPreset(lockedPresetId) : null;
      const layout = lockedPresetLayout ? applyLockedPresetLayout(baseLayout, lockedPresetLayout) : baseLayout;
      const tm = clampNumber(billData?.topMargin ?? layout?.topMargin ?? 5, 0, 120, 5);
      const mmPerLine = 25.4 / 6;
      const lines = Math.max(0, Math.floor(tm / mmPerLine));
      const remMm = Math.max(0, tm - lines * mmPerLine);
      if (lines > 0) pushBlankLineFeeds(buffers, lines);
      const dataForRender = {
        ...billData,
        topMargin: remMm,
        layout: (layout && typeof layout === 'object') ? { ...layout, topMargin: remMm } : billData.layout
      };
      buffers.push(renderBillGraphic(dataForRender));
    } catch {
      buffers.push(renderBillGraphic(billData));
    }
  }
  
  if (cut) {
    buffers.push(ESC_POS.LINE_FEED);
    buffers.push(ESC_POS.LINE_FEED);
    buffers.push(ESC_POS.LINE_FEED);
    buffers.push(ESC_POS.CUT);
  }
  
  return Buffer.concat(buffers);
}

/**
 * VOID 티켓 그래픽 렌더링
 * 최상단 **VOID** 박스 + 보이드된 아이템 취소선
 * @param {Object} voidData - VOID 티켓 데이터
 * @returns {Buffer} ESC/POS 비트맵 데이터
 */
function renderVoidTicketGraphic(voidData) {
  ensureFontsRegistered();

  const topMarginMm = (voidData.topMargin != null && Number.isFinite(Number(voidData.topMargin))) ? Number(voidData.topMargin) : 15;
  const topMarginPx = Math.round(topMarginMm * 8);
  const items = voidData.items || [];
  const reason = voidData.reason || '';
  const note = voidData.note || '';
  const orderNumber = voidData.orderNumber || voidData.order_number || '';
  const tableName = voidData.tableName || voidData.table_name || '';
  const printerLabel = voidData.printerLabel || null;

  // 높이 추정
  let estimatedHeight = 300 + topMarginPx;
  if (printerLabel) estimatedHeight += 40;
  estimatedHeight += items.length * 80;
  if (reason) estimatedHeight += 60;
  if (note) estimatedHeight += 60;
  estimatedHeight = Math.max(estimatedHeight, 400);

  const canvas = createCanvas(PRINTER_CONFIG.width, estimatedHeight);
  const ctx = canvas.getContext('2d');

  ctx._receiptWidth = PRINTER_CONFIG.width;
  ctx._receiptPadding = PRINTER_CONFIG.padding;
  ctx._receiptRightPadding = (() => {
    const v = voidData?.rightPaddingPx ?? voidData?.rightPadding ?? null;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return n;
    return 10;
  })();

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, PRINTER_CONFIG.width, estimatedHeight);

  let y = topMarginPx;

  // === 프린터 라벨 (최상단) ===
  if (printerLabel) {
    y = drawTextBlock(ctx, {
      text: `[ ${printerLabel.toUpperCase()} ]`,
      fontSize: Math.round(PRINTER_CONFIG.fontSize.xxlarge / 2),
      fontWeight: 'bold',
      align: 'center',
      inverse: false
    }, y);
    y += 5;
  }

  // === ** VOID ** 배너 ===
  const statusFontSize = Math.round(PRINTER_CONFIG.fontSize.xxlarge * 0.8);
  y = drawTextBlock(ctx, {
    text: '** VOID **',
    fontSize: statusFontSize,
    fontWeight: 'bold',
    align: 'center',
    inverse: false
  }, y);
  y += 5;

  // === 헤더 (주문번호 / 테이블) ===
  let headerText = '';
  if (tableName) {
    headerText = tableName;
    if (orderNumber) headerText += ` #${String(orderNumber).replace('#', '')}`;
  } else if (orderNumber) {
    headerText = `#${String(orderNumber).replace('#', '')}`;
  }
  if (headerText) {
    y = drawTextBlock(ctx, {
      text: headerText,
      fontSize: PRINTER_CONFIG.fontSize.xxlarge,
      fontWeight: 'bold',
      align: 'center',
      inverse: true
    }, y);
    y += 3;
  }

  // 구분선
  y = drawSeparator(ctx, y, 'double');

  // === VOID 아이템 목록 (취소선 포함) ===
  const ITEM_FONT_SIZE = Math.round(PRINTER_CONFIG.fontSize.large * 1.3);
  const ITEM_SPACING = 11;

  items.forEach((item) => {
    const itemName = item.name || item.itemName || '';
    const quantity = item.quantity || item.qty || 1;

    // 아이템 이름 + 수량 (취소선 포함)
    y = drawTextBlock(ctx, {
      text: `${quantity}x ${itemName}`,
      fontSize: ITEM_FONT_SIZE,
      fontWeight: 'bold',
      align: 'left',
      extraBold: true,
      strikethrough: true
    }, y);

    // 금액 표시 (있으면)
    const amount = Number(item.amount || 0);
    if (amount > 0) {
      y = drawTextBlock(ctx, {
        text: `  -$${amount.toFixed(2)}`,
        fontSize: PRINTER_CONFIG.fontSize.large,
        fontWeight: 'bold',
        fontStyle: 'italic',
        align: 'left',
        paddingY: 3
      }, y);
    }

    y += ITEM_SPACING;
  });

  // 구분선
  y = drawSeparator(ctx, y, 'solid');

  // === Reason ===
  if (reason) {
    y = drawTextBlock(ctx, {
      text: `Reason: ${reason}`,
      fontSize: PRINTER_CONFIG.fontSize.large,
      fontWeight: 'bold',
      align: 'left'
    }, y);
    y += 3;
  }

  // === Note ===
  if (note) {
    y = drawTextBlock(ctx, {
      text: `Note: ${note}`,
      fontSize: PRINTER_CONFIG.fontSize.normal,
      align: 'left'
    }, y);
    y += 3;
  }

  // 구분선 (reason/note 있을 때)
  if (reason || note) {
    y = drawSeparator(ctx, y, 'solid');
  }

  // === 푸터: 시간 ===
  y += 10;
  y = drawTextBlock(ctx, {
    text: (() => { const now = new Date(); const h = now.getHours(); const m = now.getMinutes(); const ampm = h >= 12 ? 'PM' : 'AM'; const h12 = h % 12 || 12; return `${h12}:${String(m).padStart(2, '0')}${ampm}`; })(),
    fontSize: PRINTER_CONFIG.fontSize.large,
    fontWeight: 'bold',
    align: 'right'
  }, y);

  y += 30;

  const imageData = ctx.getImageData(0, 0, PRINTER_CONFIG.width, y);
  return imageToEscPosRaster(imageData.data, PRINTER_CONFIG.width, y, voidData?.graphicScale);
}
/**
 * 그래픽 모드로 VOID 티켓 출력 데이터 생성
 * @param {Object} voidData - VOID 티켓 데이터
 * @param {boolean} cut - 용지 컷 여부
 * @returns {Buffer} ESC/POS 전체 데이터
 */
function buildGraphicVoidTicket(voidData, cut = true) {
  const buffers = [ESC_POS.INIT];

  buffers.push(renderVoidTicketGraphic(voidData));

  if (cut) {
    buffers.push(ESC_POS.LINE_FEED);
    buffers.push(ESC_POS.LINE_FEED);
    buffers.push(ESC_POS.LINE_FEED);
    buffers.push(ESC_POS.CUT);
  }

  return Buffer.concat(buffers);
}

/**
 * Z-Report 그래픽 렌더링
 * @param {Object} zReportData - Z-Report 데이터
 * @param {number} closingCash - 실제 현금 카운트
 * @param {Object} cashBreakdown - 현금 단위별 수량
 * @returns {Buffer} ESC/POS 비트맵 데이터
 */
function renderZReportGraphic(zReportData, closingCash = 0, cashBreakdown = {}, printerOpts = {}) {
  ensureFontsRegistered();

  const paperWidthPx = getPrinterWidth(printerOpts.paperWidth || 80);
  const WIDTH = paperWidthPx;
  const PADDING = PRINTER_CONFIG.padding;
  const RIGHT_PADDING = (() => {
    const v = Number(printerOpts.rightPaddingPx ?? printerOpts.rightPadding ?? null);
    if (Number.isFinite(v) && v >= 0) return v;
    return paperWidthPx === 384 ? 30 : 10;
  })();
  const formatMoney = (amt) => `$${(amt || 0).toFixed(2)}`;

  // 높이 추정 (섹션별) - 넉넉하게 확보
  let estH = 200; // 헤더
  estH += 350; // Sales Summary (rows + separators)
  estH += 200; // Sales by Type
  estH += 300; // Payment Breakdown (multiple methods)
  estH += 200; // Tips
  estH += 200; // Adjustments header + base rows
  if (zReportData?.refund_details?.length) estH += zReportData.refund_details.length * 50;
  if (zReportData?.void_details?.length) estH += zReportData.void_details.length * 50;
  estH += 250; // Cash Drawer
  estH += 400; // Denominations (up to 11 rows)
  estH += 150; // footer
  estH = Math.max(estH, 2400);

  const canvas = createCanvas(WIDTH, estH);
  const ctx = canvas.getContext('2d');
  ctx._receiptWidth = WIDTH;
  ctx._receiptPadding = PADDING;
  ctx._receiptRightPadding = RIGHT_PADDING;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, WIDTH, estH);

  let y = 20;
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  const ZR_BASE = 1.05;
  const ZR_FONT = {
    small: Math.round(PRINTER_CONFIG.fontSize.small * ZR_BASE),
    normal: Math.round(PRINTER_CONFIG.fontSize.normal * ZR_BASE),
    large: Math.round(PRINTER_CONFIG.fontSize.large * ZR_BASE),
    xlarge: Math.round(PRINTER_CONFIG.fontSize.xlarge * ZR_BASE),
    xxlarge: Math.round(PRINTER_CONFIG.fontSize.xxlarge * ZR_BASE),
    dateTime: Math.round(PRINTER_CONFIG.fontSize.normal * ZR_BASE * 1.15),
    sectionTitle: Math.round(PRINTER_CONFIG.fontSize.normal * ZR_BASE * 1.10),
  };

  // === 헤더 ===
  y = drawTextBlock(ctx, { text: '*** Z-REPORT ***', fontSize: ZR_FONT.xxlarge, fontWeight: 'bold', align: 'center', inverse: true }, y);
  y += 4;
  y = drawTextBlock(ctx, { text: 'DAY CLOSING REPORT', fontSize: ZR_FONT.large, fontWeight: 'bold', align: 'center' }, y);
  y = drawSeparator(ctx, y, 'double');
  y = drawTextBlock(ctx, { text: now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }), fontSize: ZR_FONT.dateTime, fontWeight: 'bold', align: 'center' }, y);
  y = drawTextBlock(ctx, { text: `Printed: ${timeStr}`, fontSize: ZR_FONT.dateTime, align: 'center' }, y);
  y = drawSeparator(ctx, y, 'solid');

  const salesSubtotal = Number((Number(zReportData?.subtotal || 0) + Number(zReportData?.tax_total || 0)).toFixed(2));
  const tipsTotal = Number(zReportData?.tip_total || 0);
  const grandTotal = Number((salesSubtotal + tipsTotal).toFixed(2));

  const QTY_OFFSET_PX = Math.round(15 * 8);
  const row = (l, c, r, bold = false) => {
    const opts = { fontSize: ZR_FONT.normal, fontWeight: bold ? 'bold' : '500', extraBold: bold };
    if (c) {
      const paddingY = 4;
      const lh = ZR_FONT.normal + paddingY * 2;
      const padding = ctx._receiptPadding || PRINTER_CONFIG.padding;
      const rp = Math.max(padding, Number(ctx._receiptRightPadding || 0));
      ctx.font = `${opts.fontWeight} ${ZR_FONT.normal}px "Arial", "Malgun Gothic", sans-serif`;
      ctx.fillStyle = '#000000';
      ctx.textBaseline = 'middle';
      const textY = y + lh / 2;
      ctx.fillText(l, padding, textY);
      const cw = ctx.measureText(c).width;
      const qtyX = WIDTH - rp - QTY_OFFSET_PX;
      ctx.fillText(c, qtyX, textY);
      if (r) {
        const rw = ctx.measureText(r).width;
        ctx.fillText(r, WIDTH - rw - rp, textY);
      }
      if (opts.extraBold) {
        ctx.fillText(l, padding + 0.4, textY);
        ctx.fillText(l, padding - 0.4, textY);
        ctx.fillText(c, qtyX + 0.4, textY);
        ctx.fillText(c, qtyX - 0.4, textY);
        if (r) {
          const rw = ctx.measureText(r).width;
          ctx.fillText(r, WIDTH - rw - rp + 0.4, textY);
          ctx.fillText(r, WIDTH - rw - rp - 0.4, textY);
        }
      }
      y += lh;
    } else {
      y = drawLeftRightText(ctx, l, r || '', y, opts);
    }
  };

  // Sales Summary
  y = drawTextBlock(ctx, { text: '-- SALES SUMMARY --', fontSize: ZR_FONT.sectionTitle, fontWeight: 'bold', align: 'center' }, y);
  y = drawSeparator(ctx, y, 'dashed');
  row('Total Orders', `${zReportData?.order_count || 0}`, '', true);
  row('Subtotal', '', formatMoney(zReportData?.subtotal || 0));
  row('GST', '', formatMoney(zReportData?.gst_total || 0));
  row('PST', '', formatMoney(zReportData?.pst_total || 0));
  row('Tax Total', '', formatMoney(zReportData?.tax_total || 0));
  y = drawLeftRightText(ctx, 'Sales Total', formatMoney(salesSubtotal), y, { fontSize: Math.round(ZR_FONT.normal * 1.15), fontWeight: 'bold', extraBold: true });
  row('Tips', `${zReportData?.total_tip_order_count || 0}`, formatMoney(tipsTotal));
  row('Total', '', formatMoney(grandTotal));

  // Sales by Type
  y += 8;
  y = drawTextBlock(ctx, { text: '-- SALES BY TYPE --', fontSize: ZR_FONT.sectionTitle, fontWeight: 'bold', align: 'center' }, y);
  y = drawSeparator(ctx, y, 'dashed');
  row('Dine-In', `${zReportData?.dine_in_order_count || 0}`, formatMoney(zReportData?.dine_in_sales || 0));
  row('Togo', `${zReportData?.togo_order_count || 0}`, formatMoney(zReportData?.togo_sales || 0));
  row('Online', `${zReportData?.online_order_count || 0}`, formatMoney(zReportData?.online_sales || 0));
  row('Delivery', `${zReportData?.delivery_order_count || 0}`, formatMoney(zReportData?.delivery_sales || 0));

  // Payment Breakdown
  y += 8;
  y = drawTextBlock(ctx, { text: '-- PAYMENT BREAKDOWN --', fontSize: ZR_FONT.sectionTitle, fontWeight: 'bold', align: 'center' }, y);
  y = drawSeparator(ctx, y, 'dashed');
  row('Cash', `${zReportData?.cash_order_count || 0}`, formatMoney(zReportData?.cash_sales || 0), true);
  row('Card', `${zReportData?.card_order_count || 0}`, formatMoney(zReportData?.card_sales || 0), true);
  if ((zReportData?.other_sales || 0) > 0) {
    row('Other', `${zReportData?.other_order_count || 0}`, formatMoney(zReportData?.other_sales || 0), true);
  }
  y = drawSeparator(ctx, y, 'dashed');
  y = drawLeftRightText(ctx, 'Sales Total', formatMoney(salesSubtotal), y, { fontSize: ZR_FONT.normal, fontWeight: 'bold', extraBold: true });

  // Tips
  y += 8;
  y = drawTextBlock(ctx, { text: '-- TIPS --', fontSize: ZR_FONT.sectionTitle, fontWeight: 'bold', align: 'center' }, y);
  y = drawSeparator(ctx, y, 'dashed');
  row('Total Tips', `${zReportData?.total_tip_order_count || 0}`, formatMoney(zReportData?.tip_total || 0), true);
  row('Cash Tips', `${zReportData?.cash_tip_order_count || 0}`, formatMoney(zReportData?.cash_tips || 0));
  row('Card Tips', `${zReportData?.card_tip_order_count || 0}`, formatMoney(zReportData?.card_tips || 0));

  // Adjustments
  y += 8;
  y = drawTextBlock(ctx, { text: '-- ADJUSTMENTS --', fontSize: ZR_FONT.sectionTitle, fontWeight: 'bold', align: 'center' }, y);
  y = drawSeparator(ctx, y, 'dashed');
  row('Refunds', `${zReportData?.refund_count || 0}`, `-${formatMoney(zReportData?.refund_total || 0)}`);
  (zReportData?.refund_details || []).forEach(r => {
    const orderNum = r.order_number || `#${r.order_id}`;
    y = drawLeftRightText(ctx, `  Order ${orderNum}`, `-${formatMoney(r.total)}`, y, { fontSize: ZR_FONT.small, fontWeight: '600' });
  });
  row('Voids', `${zReportData?.void_count || 0}`, `-${formatMoney(zReportData?.void_total || 0)}`);
  (zReportData?.void_details || []).forEach(v => {
    const orderNum = v.order_number || `#${v.order_id}`;
    y = drawLeftRightText(ctx, `  Order ${orderNum}`, `-${formatMoney(v.total)}`, y, { fontSize: ZR_FONT.small, fontWeight: '600' });
  });
  row('Discounts', `${zReportData?.discount_order_count || 0}`, `-${formatMoney(zReportData?.discount_total || 0)}`);

  // Cash Drawer
  y += 8;
  y = drawTextBlock(ctx, { text: '-- CASH DRAWER --', fontSize: ZR_FONT.sectionTitle, fontWeight: 'bold', align: 'center' }, y);
  y = drawSeparator(ctx, y, 'dashed');
  row('Opening Cash', '', formatMoney(zReportData?.opening_cash || 0), true);
  row('Cash Sales', `${zReportData?.cash_order_count || 0}`, formatMoney(zReportData?.cash_sales || 0), true);
  row('Cash Tips', `${zReportData?.cash_tip_order_count || 0}`, formatMoney(zReportData?.cash_tips || 0), true);
  row('Expected Cash', '', formatMoney(zReportData?.expected_cash || 0), true);
  y = drawSeparator(ctx, y, 'dashed');

  y = drawTextBlock(ctx, { text: 'ACTUAL CASH COUNT', fontSize: ZR_FONT.sectionTitle, fontWeight: 'bold', align: 'center' }, y);
  const denominations = [
    { key: 'cent1', label: '1 Cent', value: 0.01 }, { key: 'cent5', label: '5 Cents', value: 0.05 },
    { key: 'cent10', label: '10 Cents', value: 0.10 }, { key: 'cent25', label: '25 Cents', value: 0.25 },
    { key: 'dollar1', label: '$1 Bills', value: 1 }, { key: 'dollar2', label: '$2 Bills', value: 2 },
    { key: 'dollar5', label: '$5 Bills', value: 5 }, { key: 'dollar10', label: '$10 Bills', value: 10 },
    { key: 'dollar20', label: '$20 Bills', value: 20 }, { key: 'dollar50', label: '$50 Bills', value: 50 },
    { key: 'dollar100', label: '$100 Bills', value: 100 },
  ];
  denominations.forEach(d => {
    const count = cashBreakdown[d.key] || 0;
    if (count > 0) {
      y = drawLeftRightText(ctx, `${d.label} x ${count}`, `$${(count * d.value).toFixed(2)}`, y, { fontWeight: '600' });
    }
  });

  y = drawSeparator(ctx, y, 'dashed');
  y = drawLeftRightText(ctx, 'ACTUAL CASH:', formatMoney(closingCash), y, { fontWeight: 'bold', extraBold: true });
  const difference = closingCash - (zReportData?.expected_cash || 0);
  const diffStr = difference >= 0 ? `+${formatMoney(difference)}` : formatMoney(difference);
  y = drawLeftRightText(ctx, 'DIFFERENCE:', diffStr, y, { fontWeight: 'bold', extraBold: true });
  y = drawSeparator(ctx, y, 'double');
  y += 30;

  const imageData = ctx.getImageData(0, 0, WIDTH, y);
  return imageToEscPosRaster(imageData.data, WIDTH, y, printerOpts.graphicScale ?? zReportData?.graphicScale);
}

/**
 * Z-Report 그래픽 출력 버퍼 생성
 */
function buildGraphicZReport(zReportData, closingCash = 0, cashBreakdown = {}, printerOpts = {}) {
  const buffers = [ESC_POS.INIT];
  buffers.push(renderZReportGraphic(zReportData, closingCash, cashBreakdown, printerOpts));
  buffers.push(ESC_POS.LINE_FEED);
  buffers.push(ESC_POS.LINE_FEED);
  buffers.push(ESC_POS.LINE_FEED);
  buffers.push(ESC_POS.CUT);
  return Buffer.concat(buffers);
}

/**
 * Item Report 그래픽 렌더링 — Item Sales 테이블만 출력
 */
function renderItemReportGraphic(reportData, printerOpts = {}) {
  ensureFontsRegistered();

  const paperWidthPx = getPrinterWidth(printerOpts.paperWidth || 80);
  const WIDTH = paperWidthPx;
  const PADDING = PRINTER_CONFIG.padding;
  const RIGHT_PADDING = (() => {
    const v = Number(printerOpts.rightPaddingPx ?? printerOpts.rightPadding ?? null);
    if (Number.isFinite(v) && v >= 0) return v;
    return paperWidthPx === 384 ? 30 : 10;
  })();
  const fmt = (amt) => `$${(amt || 0).toFixed(2)}`;

  const IR_BASE = 1.22;
  const IR_FONT = {
    small: Math.round(PRINTER_CONFIG.fontSize.small * IR_BASE),
    normal: Math.round(PRINTER_CONFIG.fontSize.normal * IR_BASE),
    large: Math.round(PRINTER_CONFIG.fontSize.large * IR_BASE),
    xxlarge: Math.round(PRINTER_CONFIG.fontSize.xxlarge * IR_BASE),
    dateTime: Math.round(PRINTER_CONFIG.fontSize.normal * IR_BASE * 1.2),
    sectionTitle: Math.round(PRINTER_CONFIG.fontSize.normal * IR_BASE * 1.15),
  };

  const items = reportData.items || [];
  const ITEM_BLOCK_GAP = Math.round(4 * 1.2);
  const perItemH = Math.ceil(82 * 1.2);
  let estH = 320 + items.length * perItemH + 220;
  estH = Math.max(estH, 800);

  const canvas = createCanvas(WIDTH, estH);
  const ctx = canvas.getContext('2d');
  ctx._receiptWidth = WIDTH;
  ctx._receiptPadding = PADDING;
  ctx._receiptRightPadding = RIGHT_PADDING;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, WIDTH, estH);

  let y = 20;
  const now = new Date();

  // Header: Title + Period
  y = drawTextBlock(ctx, { text: 'ITEM REPORT', fontSize: IR_FONT.xxlarge, fontWeight: 'bold', align: 'center', inverse: true }, y);
  y += 4;
  const periodStr = `${reportData.period?.startDate || ''} ~ ${reportData.period?.endDate || ''}`;
  y = drawTextBlock(ctx, { text: periodStr, fontSize: IR_FONT.dateTime, fontWeight: 'bold', align: 'center' }, y);
  y = drawTextBlock(ctx, { text: `Printed: ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`, fontSize: IR_FONT.dateTime, align: 'center' }, y);
  y = drawSeparator(ctx, y, 'double');

  // Item Sales
  if (items.length > 0) {
    y = drawTextBlock(ctx, { text: 'ITEM SALES', fontSize: IR_FONT.sectionTitle, fontWeight: 'bold', align: 'center' }, y);
    y += 2;
    const totals = reportData.itemTotals || {};
    const uniqueStr = `${totals.uniqueItems || items.length} items, ${totals.totalQuantity || 0} qty`;
    const netTotalAmt = totals.netAmount ?? ((totals.totalRevenue || 0) - (totals.refundAmount || 0) - (totals.voidAmount || 0));
    y = drawLeftRightText(ctx, uniqueStr, `Net: ${fmt(netTotalAmt)}`, y, { fontSize: IR_FONT.normal, fontWeight: '500' });
    y = drawSeparator(ctx, y, 'dashed');

    // Column header (Net aligns with item lines)
    y = drawLeftRightText(ctx, '#  Item', 'Net', y, { fontSize: IR_FONT.normal, fontWeight: 'bold' });
    y = drawTextBlock(ctx, { text: '  Sold / Refund / Void', fontSize: IR_FONT.normal, fontWeight: 'bold', align: 'left' }, y);
    y = drawSeparator(ctx, y, 'dashed');

    const itemLineOpts = { fontSize: IR_FONT.normal, fontWeight: '600', extraBold: true };
    const srvLineOpts = { fontSize: IR_FONT.normal, fontWeight: 'normal' };

    for (const item of items) {
      const rank = item.rank ?? '';
      const name = String(item.name || '');
      const soldAmt = fmt(item.soldAmount ?? item.revenue ?? 0);
      const soldQty = item.soldQty ?? item.quantity ?? 0;
      const refAmt = fmt(item.refundAmount || 0);
      const refQty = item.refundQty || 0;
      const voidAmt = fmt(item.voidAmount || 0);
      const voidQty = item.voidQty || 0;
      const netAmt = fmt(item.netAmount ?? ((item.soldAmount ?? item.revenue ?? 0) - (item.refundAmount || 0) - (item.voidAmount || 0)));
      const netQty = item.netQty ?? ((item.soldQty ?? item.quantity ?? 0) - (item.refundQty || 0) - (item.voidQty || 0));

      const netRight = `N:${netAmt}/${netQty}`;
      y = drawLeftRightText(ctx, `${rank}. ${name}`, netRight, y, itemLineOpts);
      const srvLine = `  S:${soldAmt}/${soldQty}  R:${refAmt}/${refQty}  V:${voidAmt}/${voidQty}`;
      y = drawTextBlock(ctx, { text: srvLine, ...srvLineOpts, align: 'left' }, y);
      y += ITEM_BLOCK_GAP;
    }

    // TOTAL row
    y = drawSeparator(ctx, y, 'double');
    const tSoldAmt = fmt(totals.totalRevenue || 0);
    const tSoldQty = totals.totalQuantity || 0;
    const tRefAmt = fmt(totals.refundAmount || 0);
    const tRefQty = totals.refundQuantity || 0;
    const tVoidAmt = fmt(totals.voidAmount || 0);
    const tVoidQty = totals.voidQuantity || 0;
    const tNetAmt = fmt(netTotalAmt);
    const tNetQty = totals.netQuantity ?? (tSoldQty - tRefQty - tVoidQty);

    y = drawLeftRightText(ctx, 'TOTAL', `N:${tNetAmt}/${tNetQty}`, y, { fontSize: IR_FONT.normal, fontWeight: '600', extraBold: true });
    y = drawTextBlock(ctx, { text: `  S:${tSoldAmt}/${tSoldQty}  R:${tRefAmt}/${tRefQty}  V:${tVoidAmt}/${tVoidQty}`, fontSize: IR_FONT.normal, fontWeight: 'normal', align: 'left' }, y);
  } else {
    y = drawTextBlock(ctx, { text: 'No item data available', fontSize: IR_FONT.normal, align: 'center' }, y);
  }

  y += 8;
  y = drawSeparator(ctx, y, 'double');
  y = drawTextBlock(ctx, { text: `Printed: ${now.toLocaleString('en-US')}`, fontSize: IR_FONT.normal, align: 'center' }, y);
  y += 30;

  const imageData = ctx.getImageData(0, 0, WIDTH, y);
  return imageToEscPosRaster(imageData.data, WIDTH, y, printerOpts.graphicScale);
}

function buildGraphicItemReport(reportData, printerOpts = {}) {
  const buffers = [ESC_POS.INIT];
  buffers.push(renderItemReportGraphic(reportData, printerOpts));
  buffers.push(ESC_POS.LINE_FEED);
  buffers.push(ESC_POS.LINE_FEED);
  buffers.push(ESC_POS.LINE_FEED);
  buffers.push(ESC_POS.CUT);
  return Buffer.concat(buffers);
}

/**
 * Report Dashboard (sales-report API shape) — text sections matching on-screen summary
 */
function renderSalesDashboardGraphic(reportData, printerOpts = {}) {
  ensureFontsRegistered();

  const paperWidthPx = getPrinterWidth(printerOpts.paperWidth || 80);
  const WIDTH = paperWidthPx;
  const PADDING = PRINTER_CONFIG.padding;
  const RIGHT_PADDING = (() => {
    const v = Number(printerOpts.rightPaddingPx ?? printerOpts.rightPadding ?? null);
    if (Number.isFinite(v) && v >= 0) return v;
    return paperWidthPx === 384 ? 30 : 10;
  })();
  const fmt = (n) => `$${(n || 0).toFixed(2)}`;

  const SDR_BASE = 1.08;
  const SDR_FONT = {
    small: Math.round(PRINTER_CONFIG.fontSize.small * SDR_BASE),
    normal: Math.round(PRINTER_CONFIG.fontSize.normal * SDR_BASE),
    large: Math.round(PRINTER_CONFIG.fontSize.large * SDR_BASE),
    xxlarge: Math.round(PRINTER_CONFIG.fontSize.xxlarge * SDR_BASE),
    section: Math.round(PRINTER_CONFIG.fontSize.normal * SDR_BASE * 1.08),
  };

  const payLen = (reportData.paymentBreakdown || []).length;
  const hourLen = (reportData.hourlySales || []).length;
  const tblLen = (reportData.tableTurnover || []).length;
  const delKeys = Object.keys(reportData.deliveryPlatforms || []).length;
  const taxRows = (reportData.taxDetails || []).length;
  const chMap = reportData.channels || {};
  const chWithData = ['DINE-IN', 'TOGO', 'ONLINE', 'DELIVERY', 'OTHER'].filter((k) => {
    const c = chMap[k];
    return c && ((c.count || 0) > 0 || (c.sales || 0) > 0);
  }).length;
  const tbPre = reportData.tipBreakdown;
  const tipDetailRows = tbPre
    ? (tbPre.byPaymentMethod || []).length + (tbPre.byChannel || []).length + Math.min(25, (tbPre.byServer || []).length)
    : 0;
  let rawEst =
    1400 +
    taxRows * 44 +
    chWithData * 110 +
    delKeys * 42 +
    payLen * 105 +
    tipDetailRows * 42 +
    hourLen * 52 +
    tblLen * 38 +
    3500;
  let estH = Math.min(32767, Math.max(rawEst + 8000, 16000));

  const canvas = createCanvas(WIDTH, estH);
  const ctx = canvas.getContext('2d');
  ctx._receiptWidth = WIDTH;
  ctx._receiptPadding = PADDING;
  ctx._receiptRightPadding = RIGHT_PADDING;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, WIDTH, estH);

  let y = 18;
  const now = new Date();
  const row = (l, r, bold = false) => {
    y = drawLeftRightText(ctx, l, r || '', y, {
      fontSize: SDR_FONT.normal,
      fontWeight: bold ? 'bold' : '500',
      extraBold: bold,
    });
  };

  {
    const mainSize = SDR_FONT.xxlarge;
    const subSize = Math.round(mainSize * 0.5);
    const paddingY = 4;
    const mainPart = 'REPORT';
    const subPart = ' (Dashboard)';
    ctx.font = `bold ${mainSize}px "Arial", "Malgun Gothic", sans-serif`;
    const wMain = ctx.measureText(mainPart).width;
    ctx.font = `600 ${subSize}px "Arial", "Malgun Gothic", sans-serif`;
    const wSub = ctx.measureText(subPart).width;
    const totalW = wMain + wSub;
    const usableTitleW = WIDTH - PADDING - RIGHT_PADDING;
    const startX = PADDING + Math.max(0, (usableTitleW - totalW) / 2);
    const titleLineH = mainSize + paddingY * 2;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, y, WIDTH, titleLineH);
    ctx.fillStyle = '#FFFFFF';
    ctx.textBaseline = 'middle';
    const textY = y + titleLineH / 2;
    ctx.font = `bold ${mainSize}px "Arial", "Malgun Gothic", sans-serif`;
    ctx.fillText(mainPart, startX, textY);
    ctx.font = `600 ${subSize}px "Arial", "Malgun Gothic", sans-serif`;
    ctx.fillText(subPart, startX + wMain, textY);
    y += titleLineH;
  }
  y += 2;
  const p = reportData.period || {};
  y = drawTextBlock(ctx, { text: `${p.startDate || ''} ~ ${p.endDate || ''}`, fontSize: SDR_FONT.section, fontWeight: 'bold', align: 'center' }, y);
  y = drawTextBlock(ctx, { text: `Printed: ${now.toLocaleString('en-US')}`, fontSize: SDR_FONT.small, align: 'center' }, y);
  y = drawSeparator(ctx, y, 'double');

  const ov = reportData.overall || {};
  y = drawTextBlock(ctx, { text: '-- ALL ORDERS (Paid) --', fontSize: SDR_FONT.section, fontWeight: 'bold', align: 'center' }, y);
  y = drawSeparator(ctx, y, 'dashed');
  row('Orders:', `${ov.orderCount ?? 0}`, true);
  row('Subtotal:', fmt(ov.subtotal), false);
  const taxList = reportData.taxDetails || [];
  if (taxList.length > 0) {
    taxList.forEach((t) => {
      const lab = t.rate > 0 ? `${t.name} ${t.rate}%` : t.name;
      row(lab, fmt(t.amount), false);
    });
  } else if ((ov.taxTotal || 0) > 0) {
    row('Tax Total:', fmt(ov.taxTotal), false);
  }
  if ((ov.serviceCharge || 0) > 0) row('Service Charge:', fmt(ov.serviceCharge), false);
  row('Total Sales:', fmt(ov.totalSales), true);
  if ((ov.totalTip || 0) > 0) row('Tips (total):', fmt(ov.totalTip), false);

  const up = reportData.unpaid;
  if (up && (up.orderCount || 0) > 0) {
    y += 6;
    y = drawTextBlock(ctx, { text: `Unpaid: ${fmt(up.totalAmount || 0)} (${up.orderCount} orders)`, fontSize: SDR_FONT.small, fontWeight: 'bold', align: 'left' }, y);
  }

  y += 8;
  y = drawTextBlock(ctx, { text: '-- CHANNEL BREAKDOWN --', fontSize: SDR_FONT.section, fontWeight: 'bold', align: 'center' }, y);
  y = drawSeparator(ctx, y, 'dashed');
  const chOrder = ['DINE-IN', 'TOGO', 'ONLINE', 'DELIVERY', 'OTHER'];
  const chLabel = { 'DINE-IN': 'Dine-In', TOGO: 'Togo', ONLINE: 'Online', DELIVERY: 'Delivery', OTHER: 'Other' };
  const channels = reportData.channels || {};
  chOrder.forEach((k) => {
    const c = channels[k];
    if (!c || ((c.count || 0) === 0 && (c.sales || 0) === 0)) return;
    row(`${chLabel[k] || k}:`, `${fmt(c.sales)}  (${c.count} ord)`, true);
    row('  Sub / Tax / Tip', `${fmt(c.subtotal)} / ${fmt(c.tax)} / ${fmt(c.tips || 0)}`, false);
  });

  const dts = reportData.dineInTableStats;
  if (dts && (dts.tableOrderCount || 0) > 0) {
    y += 4;
    row('Dine-In tables / Avg:', `${dts.tableOrderCount} / ${fmt(dts.avgPerTable)}`, false);
  }

  const dplat = reportData.deliveryPlatforms || {};
  const dplatEntries = Object.entries(dplat).filter(([, v]) => v && (v.sales > 0 || v.count > 0));
  if (dplatEntries.length > 0) {
    y += 6;
    y = drawTextBlock(ctx, { text: 'Delivery by Platform', fontSize: SDR_FONT.small, fontWeight: 'bold', align: 'left' }, y);
    dplatEntries.forEach(([name, v]) => {
      row(`  ${name}`, `${fmt(v.sales)} (${v.count})`, false);
    });
  }

  const pbreak = reportData.paymentBreakdown || [];
  if (pbreak.length > 0) {
    y += 8;
    y = drawTextBlock(ctx, { text: '-- PAYMENTS BY METHOD --', fontSize: SDR_FONT.section, fontWeight: 'bold', align: 'center' }, y);
    y = drawSeparator(ctx, y, 'dashed');
    let paySum = 0;
    let tipSum = 0;
    let cntSum = 0;
    pbreak.forEach((p) => {
      paySum += p.net_amount || 0;
      tipSum += p.tips || 0;
      cntSum += p.count || 0;
      row(p.payment_method || '—', `${fmt(p.net_amount)} / ${p.count} txn`, true);
      if ((p.tips || 0) > 0) row('  Tips', fmt(p.tips), false);
    });
    y = drawSeparator(ctx, y, 'dashed');
    row('TOTAL', `${fmt(paySum)} / ${cntSum}`, true);
    if (tipSum > 0) row('Tips total', fmt(tipSum), false);
  }

  const tb = reportData.tipBreakdown;
  if (tb && (tb.total || 0) > 0) {
    y += 8;
    y = drawTextBlock(ctx, { text: '-- TIPS --', fontSize: SDR_FONT.section, fontWeight: 'bold', align: 'center' }, y);
    y = drawSeparator(ctx, y, 'dashed');
    row('Total Tips:', fmt(tb.total), true);
    (tb.byPaymentMethod || []).forEach((m) => {
      if ((m.tips || 0) > 0) row(`  ${m.method}`, fmt(m.tips), false);
    });
    (tb.byChannel || []).forEach((c) => {
      if ((c.tips || 0) > 0) row(`  ${c.channel}`, fmt(c.tips), false);
    });
    (tb.byServer || []).slice(0, 25).forEach((s) => {
      if ((s.tips || 0) > 0) row(`  ${s.server}`, fmt(s.tips), false);
    });
  }

  const hourly = reportData.hourlySales || [];
  if (hourly.length > 0) {
    y += 8;
    y = drawTextBlock(ctx, { text: '-- HOURLY SALES --', fontSize: SDR_FONT.section, fontWeight: 'bold', align: 'center' }, y);
    y = drawSeparator(ctx, y, 'dashed');
    hourly.forEach((h) => {
      const hr = h.hour != null ? String(h.hour).padStart(2, '0') : '';
      row(`${hr}:00`, `${fmt(h.revenue)} (${h.order_count || 0} ord)`, false);
    });
  }

  const tt = reportData.tableTurnover || [];
  if (tt.length > 0) {
    y += 8;
    y = drawTextBlock(ctx, { text: '-- TABLE TURNOVER --', fontSize: SDR_FONT.section, fontWeight: 'bold', align: 'center' }, y);
    y = drawSeparator(ctx, y, 'dashed');
    tt.slice(0, 40).forEach((t) => {
      row(String(t.table_name || '').slice(0, 22), `${t.order_count} ord / ${Math.round(t.avg_duration_min || 0)}m`, false);
    });
  }

  const rv = reportData.refundsVoids || [];
  if (rv.length > 0) {
    const refund = rv.find((r) => r.type === 'refund');
    const voidD = rv.find((r) => r.type === 'void');
    if ((refund?.count || 0) > 0 || (voidD?.count || 0) > 0) {
      y += 8;
      y = drawTextBlock(ctx, { text: '-- CANCELLATIONS & REFUNDS --', fontSize: SDR_FONT.section, fontWeight: 'bold', align: 'center' }, y);
      y = drawSeparator(ctx, y, 'dashed');
      if (refund && (refund.count || 0) > 0) row('Refunds', `${refund.count} (${fmt(refund.total)})`, true);
      if (voidD && (voidD.count || 0) > 0) row('Voids', `${voidD.count} (${fmt(voidD.total)})`, true);
    }
  }

  y += 10;
  y = drawSeparator(ctx, y, 'double');
  y = drawTextBlock(ctx, { text: 'End of Report', fontSize: SDR_FONT.small, align: 'center' }, y);
  y += 28;

  const imageData = ctx.getImageData(0, 0, WIDTH, y);
  return imageToEscPosRaster(imageData.data, WIDTH, y, printerOpts.graphicScale);
}

function buildGraphicSalesReport(reportData, printerOpts = {}) {
  const buffers = [ESC_POS.INIT];
  buffers.push(renderSalesDashboardGraphic(reportData, printerOpts));
  buffers.push(ESC_POS.LINE_FEED);
  buffers.push(ESC_POS.LINE_FEED);
  buffers.push(ESC_POS.LINE_FEED);
  buffers.push(ESC_POS.CUT);
  return Buffer.concat(buffers);
}

// ============================================================
// Shift Report — 고해상도 그래픽 출력
// ============================================================
function renderShiftReportGraphic(shiftData = {}, printerOpts = {}) {
  ensureFontsRegistered();

  const paperWidthPx = getPrinterWidth(printerOpts.paperWidth || 80);
  const WIDTH = paperWidthPx;
  const PADDING = PRINTER_CONFIG.padding;
  const RIGHT_PADDING = (() => {
    const v = Number(printerOpts.rightPaddingPx ?? printerOpts.rightPadding ?? null);
    if (Number.isFinite(v) && v >= 0) return v;
    return paperWidthPx === 384 ? 30 : 10;
  })();
  const formatMoney = (amt) => `$${(amt || 0).toFixed(2)}`;
  const fmtTime = (ts) => { try { return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

  const SR_BASE = 1.05;
  const SR_FONT = {
    small: Math.round(PRINTER_CONFIG.fontSize.small * SR_BASE),
    normal: Math.round(PRINTER_CONFIG.fontSize.normal * SR_BASE),
    large: Math.round(PRINTER_CONFIG.fontSize.large * SR_BASE),
    xlarge: Math.round(PRINTER_CONFIG.fontSize.xlarge * SR_BASE),
    xxlarge: Math.round(PRINTER_CONFIG.fontSize.xxlarge * SR_BASE),
    dateTime: Math.round(PRINTER_CONFIG.fontSize.normal * SR_BASE * 1.15),
    sectionTitle: Math.round(PRINTER_CONFIG.fontSize.normal * SR_BASE * 1.10),
  };

  let estH = 200 + 350 + 250 + 200 + 200 + 350 + 500 + 150;
  estH = Math.max(estH, 2100);

  const canvas = createCanvas(WIDTH, estH);
  const ctx = canvas.getContext('2d');
  ctx._receiptWidth = WIDTH;
  ctx._receiptPadding = PADDING;
  ctx._receiptRightPadding = RIGHT_PADDING;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, WIDTH, estH);

  let y = 20;
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  const row = (l, r, bold = false) => {
    const opts = { fontSize: SR_FONT.normal, fontWeight: bold ? 'bold' : '500', extraBold: bold };
    y = drawLeftRightText(ctx, l, r || '', y, opts);
  };

  // Header
  y = drawTextBlock(ctx, { text: 'SHIFT REPORT', fontSize: SR_FONT.xxlarge, fontWeight: 'bold', align: 'center', inverse: true }, y);
  y += 4;
  y = drawTextBlock(ctx, {
    text: now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    fontSize: SR_FONT.dateTime, fontWeight: 'bold', align: 'center'
  }, y);
  y = drawTextBlock(ctx, {
    text: `Shift #${shiftData.shift_number || 1}  (${fmtTime(shiftData.shift_start)} ~ ${fmtTime(shiftData.shift_end)})`,
    fontSize: SR_FONT.dateTime, align: 'center'
  }, y);
  if (shiftData.closed_by) {
    y = drawTextBlock(ctx, { text: `Closed by: ${shiftData.closed_by}`, fontSize: SR_FONT.small, align: 'center' }, y);
  }
  y = drawTextBlock(ctx, { text: `Printed: ${timeStr}`, fontSize: SR_FONT.small, align: 'center' }, y);
  y = drawSeparator(ctx, y, 'double');

  // Sales Summary
  y = drawTextBlock(ctx, { text: '-- SALES SUMMARY --', fontSize: SR_FONT.sectionTitle, fontWeight: 'bold', align: 'center' }, y);
  y = drawSeparator(ctx, y, 'dashed');
  row('Total Sales', formatMoney(shiftData.total_sales), true);
  row('Order Count', `${shiftData.order_count || 0}`, true);
  y = drawSeparator(ctx, y, 'dashed');

  // Sales by Type
  y += 4;
  y = drawTextBlock(ctx, { text: '-- SALES BY TYPE --', fontSize: SR_FONT.sectionTitle, fontWeight: 'bold', align: 'center' }, y);
  y = drawSeparator(ctx, y, 'dashed');
  const chRow = (label, count, sales) => {
    const opts = { fontSize: SR_FONT.normal, fontWeight: '500' };
    y = drawLeftRightText(ctx, `${label}  ${count || 0}`, formatMoney(sales), y, opts);
  };
  chRow('Dine-In', shiftData.dine_in_count, shiftData.dine_in_sales);
  chRow('Togo', shiftData.togo_count, shiftData.togo_sales);
  chRow('Online', shiftData.online_count, shiftData.online_sales);
  chRow('Delivery', shiftData.delivery_count, shiftData.delivery_sales);
  y = drawSeparator(ctx, y, 'dashed');

  // Payments
  y += 4;
  y = drawTextBlock(ctx, { text: '-- PAYMENTS --', fontSize: SR_FONT.sectionTitle, fontWeight: 'bold', align: 'center' }, y);
  y = drawSeparator(ctx, y, 'dashed');
  row('Cash', formatMoney(shiftData.cash_sales));
  row('Card', formatMoney(shiftData.card_sales));
  if ((shiftData.other_sales || 0) > 0) {
    row('Other', formatMoney(shiftData.other_sales));
  }
  y = drawSeparator(ctx, y, 'dashed');

  // Tips
  y += 4;
  y = drawTextBlock(ctx, { text: '-- TIPS --', fontSize: SR_FONT.sectionTitle, fontWeight: 'bold', align: 'center' }, y);
  y = drawSeparator(ctx, y, 'dashed');
  row('Total Tips', formatMoney(shiftData.tip_total), true);
  y = drawSeparator(ctx, y, 'dashed');

  // Cash Drawer
  y += 4;
  y = drawTextBlock(ctx, { text: '-- CASH DRAWER --', fontSize: SR_FONT.sectionTitle, fontWeight: 'bold', align: 'center' }, y);
  y = drawSeparator(ctx, y, 'dashed');
  row('Opening Cash', formatMoney(shiftData.opening_cash), true);
  row('Cash Sales', formatMoney(shiftData.cash_sales), true);
  row('Expected Cash', formatMoney(shiftData.expected_cash), true);
  y = drawSeparator(ctx, y, 'dashed');

  // Cash Count Breakdown
  let cashBreakdown = {};
  try {
    if (shiftData.cash_details) {
      cashBreakdown = typeof shiftData.cash_details === 'string' ? JSON.parse(shiftData.cash_details) : shiftData.cash_details;
    }
  } catch (e) { /* ignore */ }

  const denominations = [
    { key: 'cent1', label: '1 Cent', value: 0.01 }, { key: 'cent5', label: '5 Cents', value: 0.05 },
    { key: 'cent10', label: '10 Cents', value: 0.10 }, { key: 'cent25', label: '25 Cents', value: 0.25 },
    { key: 'dollar1', label: '$1 Bills', value: 1 }, { key: 'dollar2', label: '$2 Bills', value: 2 },
    { key: 'dollar5', label: '$5 Bills', value: 5 }, { key: 'dollar10', label: '$10 Bills', value: 10 },
    { key: 'dollar20', label: '$20 Bills', value: 20 }, { key: 'dollar50', label: '$50 Bills', value: 50 },
    { key: 'dollar100', label: '$100 Bills', value: 100 },
  ];
  const hasBreakdown = denominations.some(d => (cashBreakdown[d.key] || 0) > 0);
  if (hasBreakdown) {
    y = drawTextBlock(ctx, { text: 'CASH COUNT BREAKDOWN', fontSize: SR_FONT.sectionTitle, fontWeight: 'bold', align: 'center' }, y);
    denominations.forEach(d => {
      const count = cashBreakdown[d.key] || 0;
      if (count > 0) {
        y = drawLeftRightText(ctx, `${d.label} x ${count}`, `$${(count * d.value).toFixed(2)}`, y, { fontWeight: '600' });
      }
    });
    y = drawSeparator(ctx, y, 'dashed');
  }

  row('Counted Cash', formatMoney(shiftData.counted_cash), true);
  const diff = (shiftData.counted_cash || 0) - (shiftData.expected_cash || 0);
  const diffStr = diff >= 0 ? `+${formatMoney(diff)}` : formatMoney(diff);
  y = drawLeftRightText(ctx, 'OVER/SHORT', diffStr, y, { fontSize: SR_FONT.normal, fontWeight: 'bold', extraBold: true });
  y = drawSeparator(ctx, y, 'double');
  y += 30;

  const imageData = ctx.getImageData(0, 0, WIDTH, y);
  return imageToEscPosRaster(imageData.data, WIDTH, y, printerOpts.graphicScale ?? shiftData?.graphicScale);
}

function buildGraphicShiftReport(shiftData = {}, printerOpts = {}) {
  const buffers = [ESC_POS.INIT];
  buffers.push(renderShiftReportGraphic(shiftData, printerOpts));
  buffers.push(ESC_POS.LINE_FEED);
  buffers.push(ESC_POS.LINE_FEED);
  buffers.push(ESC_POS.LINE_FEED);
  buffers.push(ESC_POS.CUT);
  return Buffer.concat(buffers);
}

// ============================================================
// Day Opening Report — 고해상도 그래픽 출력
// ============================================================
function renderOpeningReportGraphic(openingCash = 0, cashBreakdown = {}, printerOpts = {}) {
  ensureFontsRegistered();

  const paperWidthPx = getPrinterWidth(printerOpts.paperWidth || 80);
  const WIDTH = paperWidthPx;
  const PADDING = PRINTER_CONFIG.padding;
  const RIGHT_PADDING = (() => {
    const v = Number(printerOpts.rightPaddingPx ?? printerOpts.rightPadding ?? null);
    if (Number.isFinite(v) && v >= 0) return v;
    return paperWidthPx === 384 ? 30 : 10;
  })();
  const formatMoney = (amt) => `$${(amt || 0).toFixed(2)}`;

  const OR_BASE = 1.05;
  const OR_FONT = {
    small: Math.round(PRINTER_CONFIG.fontSize.small * OR_BASE),
    normal: Math.round(PRINTER_CONFIG.fontSize.normal * OR_BASE),
    large: Math.round(PRINTER_CONFIG.fontSize.large * OR_BASE),
    xxlarge: Math.round(PRINTER_CONFIG.fontSize.xxlarge * OR_BASE),
    dateTime: Math.round(PRINTER_CONFIG.fontSize.normal * OR_BASE * 1.15),
    sectionTitle: Math.round(PRINTER_CONFIG.fontSize.normal * OR_BASE * 1.10),
  };

  let estH = 200 + 500 + 150;
  estH = Math.max(estH, 1000);

  const canvas = createCanvas(WIDTH, estH);
  const ctx = canvas.getContext('2d');
  ctx._receiptWidth = WIDTH;
  ctx._receiptPadding = PADDING;
  ctx._receiptRightPadding = RIGHT_PADDING;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, WIDTH, estH);

  let y = 20;
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  // Header
  y = drawTextBlock(ctx, { text: '*** DAY OPENING ***', fontSize: OR_FONT.xxlarge, fontWeight: 'bold', align: 'center', inverse: true }, y);
  y += 4;
  y = drawTextBlock(ctx, {
    text: now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    fontSize: OR_FONT.dateTime, fontWeight: 'bold', align: 'center'
  }, y);
  y = drawTextBlock(ctx, { text: `Time: ${timeStr}`, fontSize: OR_FONT.dateTime, align: 'center' }, y);
  y = drawSeparator(ctx, y, 'double');

  // Starting Cash Count
  y = drawTextBlock(ctx, { text: 'STARTING CASH COUNT', fontSize: OR_FONT.sectionTitle, fontWeight: 'bold', align: 'center' }, y);
  y = drawSeparator(ctx, y, 'dashed');

  const denominations = [
    { key: 'cent1', label: '1 Cent', value: 0.01 }, { key: 'cent5', label: '5 Cents', value: 0.05 },
    { key: 'cent10', label: '10 Cents', value: 0.10 }, { key: 'cent25', label: '25 Cents', value: 0.25 },
    { key: 'dollar1', label: '$1 Bills', value: 1 }, { key: 'dollar2', label: '$2 Bills', value: 2 },
    { key: 'dollar5', label: '$5 Bills', value: 5 }, { key: 'dollar10', label: '$10 Bills', value: 10 },
    { key: 'dollar20', label: '$20 Bills', value: 20 }, { key: 'dollar50', label: '$50 Bills', value: 50 },
    { key: 'dollar100', label: '$100 Bills', value: 100 },
  ];
  denominations.forEach(d => {
    const count = cashBreakdown[d.key] || 0;
    if (count > 0) {
      y = drawLeftRightText(ctx, `${d.label} x ${count}`, formatMoney(count * d.value), y, { fontSize: OR_FONT.normal, fontWeight: '600' });
    }
  });

  y = drawSeparator(ctx, y, 'dashed');
  y = drawLeftRightText(ctx, 'TOTAL STARTING CASH', formatMoney(openingCash), y, { fontSize: Math.round(OR_FONT.normal * 1.15), fontWeight: 'bold', extraBold: true });
  y = drawSeparator(ctx, y, 'double');
  y += 30;

  const imageData = ctx.getImageData(0, 0, WIDTH, y);
  return imageToEscPosRaster(imageData.data, WIDTH, y, printerOpts.graphicScale);
}

function buildGraphicOpeningReport(openingCash = 0, cashBreakdown = {}, printerOpts = {}) {
  const buffers = [ESC_POS.INIT];
  buffers.push(renderOpeningReportGraphic(openingCash, cashBreakdown, printerOpts));
  buffers.push(ESC_POS.LINE_FEED);
  buffers.push(ESC_POS.LINE_FEED);
  buffers.push(ESC_POS.LINE_FEED);
  buffers.push(ESC_POS.CUT);
  return Buffer.concat(buffers);
}

module.exports = {
  PRINTER_CONFIG,
  ESC_POS,
  imageToEscPosRaster,
  renderKitchenTicketGraphic,
  renderReceiptGraphic,
  renderBillGraphic,
  renderVoidTicketGraphic,
  renderZReportGraphic,
  renderItemReportGraphic,
  renderSalesDashboardGraphic,
  renderShiftReportGraphic,
  renderOpeningReportGraphic,
  buildGraphicKitchenTicket,
  buildGraphicReceipt,
  buildGraphicBill,
  buildGraphicVoidTicket,
  buildGraphicZReport,
  buildGraphicItemReport,
  buildGraphicSalesReport,
  buildGraphicShiftReport,
  buildGraphicOpeningReport
};
