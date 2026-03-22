/**
 * 그래픽 모드 프린터 유틸리티
 * 텍스트를 이미지로 렌더링하여 ESC/POS 비트맵으로 출력
 */

const { createCanvas, registerFont } = require('canvas');
const path = require('path');
const fs = require('fs');

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
  // GS v 0 - 래스터 비트 이미지 명령
  RASTER_BIT_IMAGE: (width, height) => {
    const xL = (width / 8) & 0xFF;
    const xH = ((width / 8) >> 8) & 0xFF;
    const yL = height & 0xFF;
    const yH = (height >> 8) & 0xFF;
    return Buffer.from([0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH]);
  }
};

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
    UBEREATS: 'Uber',
    DOORDASH: 'Ddash',
    SKIPTHEDISHES: 'SKIP',
    FANTUAN: 'Fantuan',
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
  
  const fontScale = Number(ctx?._fontScale || 1);
  const fontSize = Math.max(6, Math.round(rawFontSize * fontScale));
  const actualLineHeight = lineHeight ? Math.round(lineHeight * fontScale) : fontSize + paddingY * 2;
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
  const fontScale = Number(ctx?._fontScale || 1);
  const gap = Math.round(8 * fontScale);
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
    return y + Math.round(20 * fontScale);
  }
  
  return y + Math.round(16 * fontScale);
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
    paddingY = 4
  } = options;
  
  const fontScale = Number(ctx?._fontScale || 1);
  const fontSize = Math.max(6, Math.round(rawFontSize * fontScale));
  const actualLineHeight = lineHeight ? Math.round(lineHeight * fontScale) : fontSize + paddingY * 2;
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
  
  ctx._fontScale = getGraphicScaleFromData(orderData);
  ctx._receiptWidth = PRINTER_CONFIG.width;
  ctx._receiptPadding = PRINTER_CONFIG.padding;
  const kitchenRightPad = (() => {
    const v = orderData?.rightPaddingPx ?? orderData?.rightPadding ?? null;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return n;
    return 0;
  })();
  ctx._receiptRightPadding = kitchenRightPad;
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
  const pickupTime = orderInfo.pickupTime || orderData.pickupTime || '';
  const pickupMinutes = orderInfo.pickupMinutes || orderData.pickupMinutes || '';
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
      inverse: false,
      box: true
    }, y);
    y += 5;
  } else if (isAdditionalOrder) {
    y = drawTextBlock(ctx, {
      text: '** ADDITIONAL **',
      fontSize: statusFontSize,
      fontWeight: 'bold',
      align: 'center',
      inverse: false,
      box: true
    }, y);
    y += 5;
  }
  
  // === 헤더 (반전 + 큰 글씨) ===
  // 공통: #주문번호 + 채널 + 채널번호
  const cleanOrderNum = String(orderNumber || '').replace('#', '').trim();
  let headerText = '';
  if (isDeliveryLike) {
    const displayCompany = getKitchenDeliveryCompanyLabel(deliveryCompany) || 'DELIVERY';
    const ext = String(deliveryOrderNumber || '').replace('#', '').trim();
    const right = ext ? `${displayCompany} "${ext}"` : displayCompany;
    headerText = cleanOrderNum ? `#${cleanOrderNum}  ${right}` : right;
  } else if (channel === 'TOGO' || channel === 'TAKEOUT') {
    const phoneRaw = String(customerPhone || '').trim();
    const phoneDigits = phoneRaw.replace(/\D/g, '');
    if (phoneDigits.length >= 4) {
      headerText = cleanOrderNum ? `#${cleanOrderNum}  TOGO "${phoneDigits.slice(-4)}"` : `TOGO "${phoneDigits.slice(-4)}"`;
    } else if (phoneDigits.length > 0) {
      headerText = cleanOrderNum ? `#${cleanOrderNum}  TOGO "${phoneDigits}"` : `TOGO "${phoneDigits}"`;
    } else {
      headerText = cleanOrderNum ? `#${cleanOrderNum}  TOGO` : 'TOGO';
    }
  } else if (channel === 'PICKUP') {
    const phoneRaw = String(customerPhone || '').trim();
    const phoneDigits = phoneRaw.replace(/\D/g, '');
    if (phoneDigits.length >= 4) {
      headerText = cleanOrderNum ? `#${cleanOrderNum}  PICKUP "${phoneDigits.slice(-4)}"` : `PICKUP "${phoneDigits.slice(-4)}"`;
    } else if (phoneDigits.length > 0) {
      headerText = cleanOrderNum ? `#${cleanOrderNum}  PICKUP "${phoneDigits}"` : `PICKUP "${phoneDigits}"`;
    } else {
      headerText = cleanOrderNum ? `#${cleanOrderNum}  PICKUP` : 'PICKUP';
    }
  } else if (channel === 'ONLINE' || channel === 'THEZONE') {
    const phoneRaw = String(customerPhone || '').trim();
    const phoneDigits = phoneRaw.replace(/\D/g, '');
    if (phoneDigits.length >= 4) {
      headerText = cleanOrderNum ? `#${cleanOrderNum}  ONLINE "${phoneDigits.slice(-4)}"` : `ONLINE "${phoneDigits.slice(-4)}"`;
    } else if (phoneDigits.length > 0) {
      headerText = cleanOrderNum ? `#${cleanOrderNum}  ONLINE "${phoneDigits}"` : `ONLINE "${phoneDigits.slice(-4)}"`;
    } else {
      headerText = cleanOrderNum ? `#${cleanOrderNum}  ONLINE` : 'ONLINE';
    }
  } else if (channel === 'FOR HERE' || channel === 'FORHERE' || channel === 'EAT IN' || channel === 'EATIN') {
    const displayChannel = (channel === 'FORHERE') ? 'FOR HERE' : (channel === 'EATIN') ? 'EAT IN' : channel;
    headerText = cleanOrderNum ? `#${cleanOrderNum}  ${displayChannel}` : displayChannel;
  } else if (tableName) {
    const formatTbl = (s) => {
      const m1 = s.match(/^t\s*0*(\d+)\s*$/i);
      if (m1) return `Table ${Number(m1[1])}`;
      const m2 = s.match(/^table\s*0*(\d+)\s*$/i);
      if (m2) return `Table ${Number(m2[1])}`;
      return s;
    };
    const tableLabel = formatTbl(String(tableName).trim());
    headerText = cleanOrderNum ? `#${cleanOrderNum}  ${tableLabel}` : tableLabel;
  } else {
    headerText = cleanOrderNum ? `#${cleanOrderNum}` : '';
  }
  
  console.log(`🍳 [GRAPHIC-HEADER] headerText="${headerText}" isDeliveryLike=${isDeliveryLike} tableName="${tableName}" channel="${channel}"`);
  
  // Dine-in 스타일: 테두리만 (검은 배경 X), 다른 채널: 검은 배경 (inverse)
  const isDineInStyle = (channel === 'DINE-IN' || channel === 'POS' || channel === 'TABLE' || channel === 'HANDHELD' || channel === 'SUBPOS' || channel === 'EAT IN' || channel === 'EATIN' || channel === 'FOR HERE' || channel === 'FORHERE');
  
  y = drawTextBlock(ctx, {
    text: headerText,
    fontSize: PRINTER_CONFIG.fontSize.xxlarge,
    fontWeight: 'bold',
    align: 'center',
    inverse: !isDineInStyle,  // Dine-in: false (흰 배경), 나머지: true (검은 배경)
    box: isDineInStyle,       // Dine-in: 테두리 표시
    boxPaddingX: 30           // 테두리 좌우 여백
  }, y);
  
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
  
  // 상태 표시 (Dine-in, Delivery는 PAID/UNPAID 표시 안함)
  // Online은 PAID/UNPAID 표시함
  // REPRINT/ADDITIONAL은 이미 헤더 위에 표시되었으므로 여기서는 PAID/UNPAID만 처리
  const hidePaidStatus = channel === 'DINE-IN' || channel === 'TABLE' || channel === 'HANDHELD' || channel === 'SUBPOS';
  let paidStatusText = '';
  if (!isReprint && !isAdditionalOrder) {
    // REPRINT/ADDITIONAL이 아닌 경우에만 PAID/UNPAID 표시
    if (!hidePaidStatus && isPaid) paidStatusText = 'PAID';
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
  y = drawSeparator(ctx, y, 'double');
  
  // === 아이템 목록 ===
  // Item font size: 1.3x of large (28 * 1.3 = 36)
  const ITEM_FONT_SIZE = Math.round(PRINTER_CONFIG.fontSize.large * 1.3);
  const ITEM_SPACING = 11; // 10% more than previous (10 * 1.1 = 11)
  
  // Helper function to render a single item
  const renderItem = (item, isFirst) => {
    const itemName = item.name || item.itemName || '';
    const quantity = item.quantity || item.qty || 1;
    
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
      extraBold: true  // Slightly bolder than modifiers
    }, y);
    
    // Modifiers - handle various structures
    const modifiers = item.modifiers || item.modifier || [];
    const modArray = Array.isArray(modifiers) ? modifiers : 
                     (typeof modifiers === 'string' ? modifiers.split(',') : []);
    
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
      
      // Print each modifier text (same size as item, italic, tighter spacing)
      modTexts.forEach(modText => {
        if (modText && modText.trim()) {
          y = drawTextBlock(ctx, {
            text: `  >> ${modText.trim()}`,
            fontSize: ITEM_FONT_SIZE,
            fontWeight: 'bold',
            fontStyle: 'italic',
            align: 'left',
            paddingY: 3  // 15% tighter spacing (default 4 → 3)
          }, y);
        }
      });
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

    // Multiple guests - show guest separators
    guestNumbers.forEach((guestNum, guestIdx) => {
      const guestItems = items.filter(item => (item.guestNumber || item.guest_number || 1) === guestNum);
      
      if (guestItems.length > 0) {
        // Guest inline separator: ------------- Guest N ------------- (thicker straight line)
        y += 8;
        y = drawGuestInlineSeparator(y, guestNum);
        y += 8;
        
        // Render items for this guest
        guestItems.forEach((item, idx) => {
          renderItem(item, guestIdx === 0 && idx === 0);
        });
        
        y += 5; // Extra spacing between guest sections
      }
    });
  } else {
    // Single guest - no separators needed
    items.forEach((item, idx) => {
      renderItem(item, idx === 0);
    });
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
  const RECEIPT_PADDING = paperWidth === 384 ? 8 : 10; // 58mm는 패딩 줄임
  
  // 상단 마진 (mm를 픽셀로 변환)
  const topMarginMm = receiptData.topMargin || 5;
  const topMarginPx = Math.round(topMarginMm * 8);
  
  // 높이 추정 (모든 섹션을 고려하여 정확하게 계산)
  const items = receiptData.items || [];
  const guestSections = receiptData.guestSections || [];
  
  let estimatedHeight = 280 + topMarginPx; // 헤더 + 상단 마진 (Delivery: PAID/고객정보 라인 여유 포함)
  
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
        const mods = flattenModifiers(item.modifiers);
        estimatedHeight += mods.length * 32;
        if (getMemoText(item.memo)) estimatedHeight += 32;
        if (item.discount && item.discount.amount > 0) estimatedHeight += 32;
      });
      if (section.guestSubtotal != null || section.guestTaxLines) {
        estimatedHeight += 30;
        estimatedHeight += ((section.guestAdjustments || []).length) * 26;
        estimatedHeight += ((section.guestTaxLines || []).length) * 26;
        estimatedHeight += 30;
      }
    });
  } else {
    items.forEach(item => {
      estimatedHeight += 40;
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
    estimatedHeight += 35; // "Payment" 헤더
    estimatedHeight += receiptData.payments.length * 35; // 결제 방법별
    estimatedHeight += 35; // Tip
    if (receiptData.change && Number(receiptData.change) > 0) estimatedHeight += 45; // Change
  }
  
  estimatedHeight += 100; // Footer + 하단 여백
  estimatedHeight = Math.max(estimatedHeight, 500);
  
  const canvas = createCanvas(RECEIPT_WIDTH, estimatedHeight);
  const ctx = canvas.getContext('2d');
  
  ctx._fontScale = getGraphicScaleFromData(receiptData);
  
  // 동적 용지 너비를 컨텍스트에 저장
  ctx._receiptWidth = RECEIPT_WIDTH;
  ctx._receiptPadding = RECEIPT_PADDING;
  // Right padding
  const RECEIPT_RIGHT_PADDING = (() => {
    const v = receiptData?.rightPaddingPx ?? receiptData?.rightPadding ?? null;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return n;
    return RECEIPT_WIDTH === 384 ? 30 : 10;
  })();
  ctx._receiptRightPadding = RECEIPT_RIGHT_PADDING;
  
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, RECEIPT_WIDTH, estimatedHeight);
  
  // 상단 마진 적용 (mm를 픽셀로 변환, 1mm ≈ 8 pixels at 203 DPI)
  const topMarginMmApply = receiptData.topMargin || 5;
  const topMarginPxApply = Math.round(topMarginMmApply * 8);
  let y = topMarginPxApply;
  
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
  
  // === 스토어 헤더 (반전) ===
  y = drawTextBlock(ctx, {
    text: storeName,
    fontSize: PRINTER_CONFIG.fontSize.xlarge,
    fontWeight: 'bold',
    align: 'center',
    inverse: true
  }, y);
  
  if (storeAddress) {
    y = drawTextBlock(ctx, {
      text: storeAddress,
      fontSize: PRINTER_CONFIG.fontSize.small,
      align: 'center'
    }, y);
  }
  
  if (storePhone) {
    y = drawTextBlock(ctx, {
      text: `Tel: ${storePhone}`,
      fontSize: PRINTER_CONFIG.fontSize.small,
      align: 'center'
    }, y);
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

  y = drawTextBlock(ctx, {
    text: isDeliveryLike
      ? `${orderTypeText} / #${String(deliveryOrderNumber || orderNumber).replace('#', '')}`
      : (dineInReceiptHeader ? dineInReceiptHeader : `${orderTypeText} #${String(orderNumber).replace('#', '')}`),
    fontSize: PRINTER_CONFIG.fontSize.large,
    fontWeight: 'bold',
    align: 'center'
  }, y);

  // Delivery: PAID 표시 (항상 눈에 띄게)
  if (isDeliveryLike && isPaid) {
    y = drawTextBlock(ctx, {
      text: 'PAID',
      fontSize: LABEL_FONT_SIZE,
      fontWeight: 'bold',
      align: 'center',
      box: true
    }, y);
  }

  // 고객 정보 (TOGO/ONLINE/DELIVERY에서 표시) - 라벨과 동일 폰트 사이즈
  if ((isDeliveryLike || channel === 'TOGO' || channel === 'ONLINE') && (customerName || customerPhone)) {
    const customerDisplay = customerName && customerPhone
      ? `${customerName} · ${customerPhone}`
      : (customerName || customerPhone);
    y = drawTextBlock(ctx, {
      text: customerDisplay,
      fontSize: LABEL_FONT_SIZE,
      fontWeight: 'bold',
      align: 'center'
    }, y);
  }
  
  // 서버, 날짜 (15% 더 굵게)
  if (serverName) {
    y = drawTextBlock(ctx, {
      text: `Server: ${serverName}`,
      fontSize: PRINTER_CONFIG.fontSize.small,
      fontWeight: 'bold',
      align: 'left'
    }, y);
  }
  
  y = drawTextBlock(ctx, {
    text: `Date: ${new Date().toLocaleString()}`,
    fontSize: PRINTER_CONFIG.fontSize.small,
    fontWeight: 'bold',
    align: 'left'
  }, y);
  
  y = drawSeparator(ctx, y, 'dashed');
  
  // === 아이템 목록 ===
  const allItems = [];
  if (guestSections.length > 0) {
    guestSections.forEach((section, idx) => {
      if (guestSections.length > 1) {
        allItems.push({ type: 'guest', guestNumber: section.guestNumber || idx + 1 });
      }
      (section.items || []).forEach(item => allItems.push({ type: 'item', ...item }));
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
    items.forEach(item => allItems.push({ type: 'item', ...item }));
  }
  
  allItems.forEach(entry => {
    if (entry.type === 'guest') {
      y = drawTextBlock(ctx, {
        text: `--- Guest ${entry.guestNumber} ---`,
        fontSize: PRINTER_CONFIG.fontSize.normal,
        align: 'center'
      }, y);
    } else if (entry.type === 'guest_summary') {
      const smFontSize = Math.max(PRINTER_CONFIG.fontSize.normal - 2, 18);
      y += 4;
      if (entry.guestSubtotal != null) {
        y = drawLeftRightText(ctx, `  Subtotal`, `$${Number(entry.guestSubtotal).toFixed(2)}`, y, {
          fontSize: smFontSize, fontWeight: 'normal', fontStyle: 'normal'
        });
      }
      if (Array.isArray(entry.guestAdjustments) && entry.guestAdjustments.length > 0) {
        entry.guestAdjustments.forEach(adj => {
          const amt = Number(adj.amount || 0);
          if (Math.abs(amt) < 0.005) return;
          let label = adj.label || 'Adjustment';
          const sign = amt < 0 ? '-' : '';
          y = drawLeftRightText(ctx, `  ${label}`, `${sign}$${Math.abs(amt).toFixed(2)}`, y, {
            fontSize: smFontSize, fontWeight: 'normal', fontStyle: 'normal'
          });
        });
      }
      if (Array.isArray(entry.guestTaxLines) && entry.guestTaxLines.length > 0) {
        entry.guestTaxLines.forEach(tax => {
          if (Number(tax.amount || 0) < 0.005) return;
          y = drawLeftRightText(ctx, `  ${tax.name}`, `$${Number(tax.amount).toFixed(2)}`, y, {
            fontSize: smFontSize, fontWeight: 'normal', fontStyle: 'normal'
          });
        });
      }
      if (entry.guestTotal != null) {
        y = drawLeftRightText(ctx, `  Guest ${entry.guestNumber} Total`, `$${Number(entry.guestTotal).toFixed(2)}`, y, {
          fontSize: smFontSize, fontWeight: 'bold', fontStyle: 'normal'
        });
      }
      y += 2;
    } else {
      const itemName = entry.name || entry.itemName || '';
      const quantity = entry.quantity || entry.qty || 1;
      const basePrice = Number(entry.price || entry.itemPrice || 0);
      const itemOnlyTotal = basePrice * quantity;
      
      const unitLabel = quantity > 1 ? ` @$${basePrice.toFixed(2)}` : '';
      y = drawLeftRightText(ctx, `${quantity}x ${itemName}${unitLabel}`, `$${itemOnlyTotal.toFixed(2)}`, y, {
        fontSize: 26,
        fontWeight: 'bold'
      });
      
      // Modifiers (flatten nested structures)
      const modifiers = flattenModifiers(entry.modifiers);
      modifiers.forEach(mod => {
        if (mod.name) {
          const modPrice = Number(mod.price || 0);
          const priceText = modPrice > 0 ? `$${(modPrice * quantity).toFixed(2)}` : '';
          y = drawLeftRightText(ctx, `  + ${mod.name}`, priceText, y, {
            fontSize: PRINTER_CONFIG.fontSize.normal,
            fontWeight: 'bold'
          });
        }
      });
      
      // Memo (if exists)
      const memoStr = getMemoText(entry.memo);
      if (memoStr) {
        const memoPrice = (entry.memo && typeof entry.memo === 'object') ? Number(entry.memo.price || 0) : 0;
        const memoPriceText = memoPrice > 0 ? `$${(memoPrice * quantity).toFixed(2)}` : '';
        y = drawLeftRightText(ctx, `  * ${memoStr}`, memoPriceText, y, {
          fontSize: PRINTER_CONFIG.fontSize.normal,
          fontWeight: 'bold'
        });
      }
      
      // Item discount (if exists)
      const discount = entry.discount;
      if (discount && discount.amount > 0) {
        const discLabel = discount.type || 'Discount';
        y = drawLeftRightText(ctx, `  - ${discLabel}`, `-$${Number(discount.amount).toFixed(2)}`, y, {
          fontSize: PRINTER_CONFIG.fontSize.normal,
          fontWeight: 'bold'
        });
      }
    }
  });
  
  y = drawSeparator(ctx, y, 'dashed');
  
  // === 소계, 세금, 할인 ===
  if (receiptData.subtotal != null) {
    y = drawLeftRightText(ctx, 'Subtotal', `$${Number(receiptData.subtotal).toFixed(2)}`, y, {
      fontSize: PRINTER_CONFIG.fontSize.normal,
      fontWeight: 'bold'
    });
  }
  
  // 할인
  if (receiptData.adjustments && receiptData.adjustments.length > 0) {
    receiptData.adjustments.forEach(adj => {
      const amount = Number(adj.amount || 0);
      let label = adj.label || adj.name || 'Discount';
      if (amount < 0) label = label.replace(/^Discount\b/, 'D/C');
      const sign = amount < 0 ? '-' : '';
      y = drawLeftRightText(ctx, `${label}`, `${sign}$${Math.abs(amount).toFixed(2)}`, y, {
        fontSize: PRINTER_CONFIG.fontSize.normal,
        fontWeight: 'bold'
      });
    });
    // Net Sales
    const hasDiscount = receiptData.adjustments.some(adj => Number(adj.amount || 0) < 0);
    if (hasDiscount && receiptData.subtotal != null) {
      const discountSum = receiptData.adjustments.reduce((s, adj) => s + Number(adj.amount || 0), 0);
      const netSales = Number((Number(receiptData.subtotal) + discountSum).toFixed(2));
      y = drawLeftRightText(ctx, 'Net Sales', `$${netSales.toFixed(2)}`, y, {
        fontSize: PRINTER_CONFIG.fontSize.normal,
        fontWeight: 'bold'
      });
    }
  }
  
  // 세금
  if (receiptData.taxLines && receiptData.taxLines.length > 0) {
    receiptData.taxLines.forEach(tax => {
      y = drawLeftRightText(ctx, `${tax.name}`, `$${Number(tax.amount).toFixed(2)}`, y, {
        fontSize: PRINTER_CONFIG.fontSize.normal,
        fontWeight: 'bold'
      });
    });
  }
  
  y = drawSeparator(ctx, y, 'dashed');
  
  // === TOTAL (박스 스타일) ===
  if (receiptData.total != null) {
    const totalLabel = 'TOTAL';
    const totalAmountStr = `$${Number(receiptData.total).toFixed(2)}`;
    const totalFontSize = PRINTER_CONFIG.fontSize.normal + 2;
    const width = ctx._receiptWidth || PRINTER_CONFIG.width;
    const padX = Math.max(3, Math.round(PRINTER_CONFIG.padding || 10));
    const boxPadY = 6;
    const lineH = totalFontSize + boxPadY * 2;

    y += 2;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.strokeRect(padX, y, width - padX * 2, lineH);

    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'middle';
    ctx.font = `normal bold ${totalFontSize}px "Arial", "Malgun Gothic", sans-serif`;
    const textY = y + lineH / 2;
    ctx.fillText(totalLabel, padX + 8, textY);
    ctx.fillText(totalLabel, padX + 8 + 0.5, textY);
    const amountW = ctx.measureText(totalAmountStr).width;
    ctx.fillText(totalAmountStr, width - padX - 8 - amountW, textY);
    ctx.fillText(totalAmountStr, width - padX - 8 - amountW + 0.5, textY);
    y += lineH + 2;
  }
  
  y = drawSeparator(ctx, y, 'solid');
  
  // === 결제 정보 ===
  if (receiptData.payments && receiptData.payments.length > 0) {
    const prettyMethod = (m) => {
      const upper = String(m || 'OTHER').toUpperCase();
      const map = {
        CASH: 'Cash', DEBIT: 'Debit', VISA: 'Visa', MC: 'MC',
        MASTERCARD: 'MC', OTHER_CARD: 'Other Card', OTHER: 'Other', PAID: 'Paid',
      };
      return map[upper] || upper;
    };

    const foodByMethod = {};
    const tipByMethod = {};
    let grossPaidTotal = 0;
    
    receiptData.payments.forEach(p => {
      const method = (p.method || 'OTHER').toUpperCase();
      const amount = Number(p.amount || 0);
      const tipField = Number(p.tip || 0);
      grossPaidTotal += amount;

      const foodPortion = Math.max(0, Number((amount - tipField).toFixed(2)));
      if (!foodByMethod[method]) foodByMethod[method] = 0;
      foodByMethod[method] += foodPortion;

      if (tipField > 0) {
        if (!tipByMethod[method]) tipByMethod[method] = 0;
        tipByMethod[method] += tipField;
      }
    });

    // 팁
    const tipEntries = Object.entries(tipByMethod).filter(([, v]) => Number(v || 0) > 0);
    if (tipEntries.length > 0) {
      tipEntries.forEach(([m, v]) => {
        y = drawLeftRightText(ctx, 'Tip', `$${Number(v).toFixed(2)}`, y, {
          fontSize: PRINTER_CONFIG.fontSize.normal,
          fontWeight: 'bold'
        });
      });
      y = drawSeparator(ctx, y, 'dashed');
    }

    // PAID (박스 스타일)
    {
      const paidLabel = 'PAID';
      const paidAmountStr = `$${Number(grossPaidTotal).toFixed(2)}`;
      const paidFontSize = PRINTER_CONFIG.fontSize.normal + 2;
      const width = ctx._receiptWidth || PRINTER_CONFIG.width;
      const padX = Math.max(3, Math.round(PRINTER_CONFIG.padding || 10));
      const boxPadY = 6;
      const lineH = paidFontSize + boxPadY * 2;

      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.strokeRect(padX, y, width - padX * 2, lineH);

      ctx.fillStyle = '#000000';
      ctx.textBaseline = 'middle';
      ctx.font = `normal bold ${paidFontSize}px "Arial", "Malgun Gothic", sans-serif`;
      const textY = y + lineH / 2;
      ctx.fillText(paidLabel, padX + 8, textY);
      ctx.fillText(paidLabel, padX + 8 + 0.5, textY);
      const amountW = ctx.measureText(paidAmountStr).width;
      ctx.fillText(paidAmountStr, width - padX - 8 - amountW, textY);
      ctx.fillText(paidAmountStr, width - padX - 8 - amountW + 0.5, textY);
      y += lineH + 2;
    }

    // 결제 수단별
    y += 2;
    Object.entries(foodByMethod).forEach(([method, totalAmount]) => {
      if (Number(totalAmount || 0) <= 0) return;
      y = drawLeftRightText(ctx, `${prettyMethod(method)}`, '', y, {
        fontSize: PRINTER_CONFIG.fontSize.normal,
        fontWeight: 'bold'
      });
    });

    y = drawSeparator(ctx, y, 'dashed');
    
    // CHANGE
    if (receiptData.change && Number(receiptData.change) > 0) {
      y = drawLeftRightText(ctx, 'CHANGE', `$${Number(receiptData.change).toFixed(2)}`, y, {
        fontSize: PRINTER_CONFIG.fontSize.normal + 2,
        fontWeight: 'bold',
        extraBold: true
      });
    }

    y = drawSeparator(ctx, y, 'solid');
  }
  
  // === Footer ===
  y += 10;
  const footerMessage = receiptData.footer?.message || 'Thank you! Please come again!';
  y = drawTextBlock(ctx, {
    text: footerMessage,
    fontSize: PRINTER_CONFIG.fontSize.normal,
    fontWeight: 'bold',
    align: 'center'
  }, y);
  
  y += 30;
  
  const imageData = ctx.getImageData(0, 0, PRINTER_CONFIG.width, y);
  return imageToEscPosRaster(imageData.data, PRINTER_CONFIG.width, y, receiptData?.graphicScale);
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
    footer: { message: billData.footer?.message || 'Thank you for dining with us!' }
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
  
  buffers.push(renderReceiptGraphic(receiptData));
  
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
  
  buffers.push(renderBillGraphic(billData));
  
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

  const topMarginMm = voidData.topMargin || 5;
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

  ctx._fontScale = getGraphicScaleFromData(voidData);
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

  // === ** VOID ** 배너 (박스 처리) ===
  const statusFontSize = Math.round(PRINTER_CONFIG.fontSize.xxlarge * 0.8);
  y = drawTextBlock(ctx, {
    text: '** VOID **',
    fontSize: statusFontSize,
    fontWeight: 'bold',
    align: 'center',
    inverse: false,
    box: true
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

module.exports = {
  PRINTER_CONFIG,
  ESC_POS,
  imageToEscPosRaster,
  renderKitchenTicketGraphic,
  renderReceiptGraphic,
  renderBillGraphic,
  renderVoidTicketGraphic,
  buildGraphicKitchenTicket,
  buildGraphicReceipt,
  buildGraphicBill,
  buildGraphicVoidTicket
};
