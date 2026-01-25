const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// Thermal Printer for Roll Graphic mode
const ThermalPrinter = require('node-thermal-printer').printer;
const PrinterTypes = require('node-thermal-printer').types;
const fs = require('fs');
const path = require('path');
const os = require('os');

// Canvas for high-quality image-based printing
let createCanvas, registerFont;
try {
  const canvas = require('canvas');
  createCanvas = canvas.createCanvas;
  registerFont = canvas.registerFont;
  console.log('✅ Canvas library loaded for high-quality printing');
} catch (e) {
  console.warn('⚠️ Canvas library not available, falling back to text mode');
}

// ESC/POS Commands for Roll Graphic printing
const ESC = '\x1B';
const GS = '\x1D';
const ESCPOS = {
  INIT: ESC + '@',                    // Initialize printer
  ALIGN_LEFT: ESC + 'a' + '\x00',
  ALIGN_CENTER: ESC + 'a' + '\x01',
  ALIGN_RIGHT: ESC + 'a' + '\x02',
  BOLD_ON: ESC + 'E' + '\x01',
  BOLD_OFF: ESC + 'E' + '\x00',
  UNDERLINE_ON: ESC + '-' + '\x01',
  UNDERLINE_OFF: ESC + '-' + '\x00',
  INVERT_ON: GS + 'B' + '\x01',       // White on black
  INVERT_OFF: GS + 'B' + '\x00',
  DOUBLE_WIDTH: GS + '!' + '\x10',
  DOUBLE_HEIGHT: GS + '!' + '\x01',
  DOUBLE_SIZE: GS + '!' + '\x11',     // Double width + height
  NORMAL_SIZE: GS + '!' + '\x00',
  CUT: GS + 'V' + '\x00',             // Full cut
  PARTIAL_CUT: GS + 'V' + '\x01',
  FEED_LINE: '\n',
  FEED_LINES: (n) => ESC + 'd' + String.fromCharCode(n),
  LINE: '================================',
  DASHED_LINE: '- - - - - - - - - - - - - - - -',
  // Cash drawer kick command: ESC p m t1 t2
  // m=0 (pin 2), t1=25 (50ms on), t2=250 (500ms off)
  DRAWER_KICK: ESC + 'p' + '\x00' + '\x19' + '\xFA',
};

// ============ IMAGE-BASED PRINTING (High Quality) ============

/**
 * Render kitchen ticket as high-quality image using Canvas
 * @param {Object} options - Print options
 * @returns {Buffer} - ESC/POS commands with embedded bitmap
 */
function renderKitchenTicketImage(options) {
  if (!createCanvas) {
    console.warn('Canvas not available, cannot render image');
    return null;
  }

  const {
    orderInfo = {},
    items = [],
    layoutSettings = {},
    isAdditionalOrder = false,
    isPaid = false,
    isReprint = false,
    paperWidth = 80 // 80mm or 58mm
  } = options;

  // Paper width in pixels (203 DPI thermal printer)
  // 80mm = ~576 pixels, 58mm = ~384 pixels
  const PAPER_WIDTH_PX = paperWidth === 80 ? 576 : 384;
  const MARGIN = 20;
  const CONTENT_WIDTH = PAPER_WIDTH_PX - (MARGIN * 2);

  // Calculate total height needed
  let totalHeight = 40; // Top margin
  
  // Count elements for height calculation
  const headerElements = [];
  if (isReprint) totalHeight += 50;
  if (isAdditionalOrder) totalHeight += 50;
  
  // Order type
  if (layoutSettings.orderType?.visible !== false) {
    totalHeight += 45;
  }
  // Table number
  if (layoutSettings.tableNumber?.visible !== false && orderInfo.table) {
    totalHeight += 50;
  }
  // POS Order number
  if (layoutSettings.posOrderNumber?.visible !== false && orderInfo.orderNumber) {
    totalHeight += 30;
  }
  // Server name
  if (layoutSettings.serverName?.visible !== false && orderInfo.server) {
    totalHeight += 25;
  }
  // Date/time
  if (layoutSettings.dateTime?.visible !== false) {
    totalHeight += 25;
  }
  // Separator
  totalHeight += 20;
  
  // Items
  items.forEach(item => {
    totalHeight += 35; // Item name
    if (item.modifiers?.length > 0) {
      totalHeight += item.modifiers.length * 22;
    }
    if (item.memo) {
      totalHeight += 22;
    }
  });
  
  // Footer
  totalHeight += 15; // Bottom margin + cut space

  // Create canvas
  const canvas = createCanvas(PAPER_WIDTH_PX, totalHeight);
  const ctx = canvas.getContext('2d');

  // White background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, PAPER_WIDTH_PX, totalHeight);

  // Text settings
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let y = 30;

  // Helper function to draw inverse text (white on black)
  const drawInverseText = (text, x, yPos, fontSize, fontWeight = 'bold') => {
    ctx.font = `${fontWeight} ${fontSize}px Arial`;
    const metrics = ctx.measureText(text);
    const textWidth = metrics.width + 20;
    const textHeight = fontSize + 10;
    
    ctx.fillStyle = '#000000';
    ctx.fillRect(x - textWidth / 2, yPos - textHeight / 2, textWidth, textHeight);
    
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(text, x, yPos);
    ctx.fillStyle = '#000000';
  };

  // Helper function to draw normal text
  const drawText = (text, x, yPos, fontSize, fontWeight = 'normal', align = 'center') => {
    ctx.font = `${fontWeight} ${fontSize}px Arial`;
    ctx.textAlign = align;
    if (align === 'left') x = MARGIN;
    if (align === 'right') x = PAPER_WIDTH_PX - MARGIN;
    ctx.fillText(text, x, yPos);
    ctx.textAlign = 'center';
  };

  // Helper function to draw dashed line
  const drawDashedLine = (yPos) => {
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(MARGIN, yPos);
    ctx.lineTo(PAPER_WIDTH_PX - MARGIN, yPos);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  // Helper function to draw solid line
  const drawSolidLine = (yPos) => {
    ctx.beginPath();
    ctx.moveTo(MARGIN, yPos);
    ctx.lineTo(PAPER_WIDTH_PX - MARGIN, yPos);
    ctx.stroke();
  };

  const centerX = PAPER_WIDTH_PX / 2;

  // === REPRINT BANNER === (전체 너비 검은 띠)
  if (isReprint) {
    const bannerFontSize = 24;
    const bannerHeight = bannerFontSize + 16;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, y - bannerHeight / 2, PAPER_WIDTH_PX, bannerHeight);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold ${bannerFontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.fillText('** REPRINT **', centerX, y + bannerFontSize / 4);
    ctx.fillStyle = '#000000';
    y += 40;
  }

  // === ADDITIONAL ORDER BANNER === (전체 너비 검은 띠)
  if (isAdditionalOrder) {
    const bannerFontSize = 20;
    const bannerHeight = bannerFontSize + 16;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, y - bannerHeight / 2, PAPER_WIDTH_PX, bannerHeight);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold ${bannerFontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.fillText('++ ADDITIONAL ++', centerX, y + bannerFontSize / 4);
    ctx.fillStyle = '#000000';
    y += 40;
  }

  // === ORDER TYPE ===
  const orderTypeEl = layoutSettings.orderType || { visible: true, inverse: true, fontSize: 28 };
  if (orderTypeEl.visible !== false) {
    const orderType = (orderInfo.orderType || orderInfo.channel || 'DINE-IN').toUpperCase();
    const fontSize = Math.min(orderTypeEl.fontSize || 28, 36);
    
    if (orderTypeEl.inverse) {
      drawInverseText(orderType, centerX, y, fontSize);
    } else {
      drawText(orderType, centerX, y, fontSize, 'bold');
    }
    y += fontSize + 15;
  }

  // === TABLE NUMBER ===
  const tableNumberEl = layoutSettings.tableNumber || { visible: true, fontSize: 32 };
  if (tableNumberEl.visible !== false && orderInfo.table) {
    const fontSize = Math.min(tableNumberEl.fontSize || 32, 42);
    
    if (tableNumberEl.inverse) {
      drawInverseText(orderInfo.table, centerX, y, fontSize);
    } else {
      drawText(orderInfo.table, centerX, y, fontSize, 'bold');
    }
    y += fontSize + 15;
  }

  // === POS ORDER NUMBER ===
  const posOrderNumberEl = layoutSettings.posOrderNumber || { visible: true, fontSize: 18 };
  if (posOrderNumberEl.visible !== false && orderInfo.orderNumber) {
    const fontSize = posOrderNumberEl.fontSize || 18;
    drawText(`Order: ${orderInfo.orderNumber}`, centerX, y, fontSize);
    y += fontSize + 8;
  }

  // === SERVER NAME ===
  const serverNameEl = layoutSettings.serverName || { visible: true, fontSize: 16 };
  if (serverNameEl.visible !== false && orderInfo.server) {
    const fontSize = serverNameEl.fontSize || 16;
    drawText(`Server: ${orderInfo.server}`, centerX, y, fontSize);
    y += fontSize + 8;
  }

  // === DATE/TIME ===
  const dateTimeEl = layoutSettings.dateTime || { visible: true, fontSize: 14 };
  if (dateTimeEl.visible !== false) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const fontSize = dateTimeEl.fontSize || 14;
    drawText(timeStr, centerX, y, fontSize);
    y += fontSize + 8;
  }

  // === SEPARATOR 1 ===
  const separator1 = layoutSettings.separator1 || { visible: true, style: 'solid' };
  const sep1SpacingOld = separator1.lineSpacing || 5;  // lineSpacing 지원
  y += sep1SpacingOld;
  if (separator1.visible !== false) {
    if (separator1.style === 'dashed') {
      drawDashedLine(y);
    } else {
      drawSolidLine(y);
    }
    y += 15;
  }

  // === ITEMS ===
  const itemsEl = layoutSettings.items || { visible: true, fontSize: 22 };
  const modifiersEl = layoutSettings.modifiers || { visible: true, fontSize: 16, prefix: '>>' };
  const itemNoteEl = layoutSettings.itemNote || { visible: true, fontSize: 14, prefix: '->' };

  // Group items by guest
  const itemsByGuest = {};
  items.forEach(item => {
    const guest = item.guestNumber || 1;
    if (!itemsByGuest[guest]) itemsByGuest[guest] = [];
    itemsByGuest[guest].push(item);
  });
  // 각 게스트 내에서 아이템을 알파벳 오름차순으로 정렬
  Object.keys(itemsByGuest).forEach(guestNum => {
    itemsByGuest[guestNum].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  });

  const guestNumbers = Object.keys(itemsByGuest).sort((a, b) => Number(a) - Number(b));
  const guestNumberEl = layoutSettings.guestNumber || { visible: true, inverse: true, fontSize: 16 };

  guestNumbers.forEach((guestNum, guestIdx) => {
    // Guest separator (if more than one guest or if visible)
    if (guestNumberEl.visible !== false && guestNumbers.length > 1) {
      if (guestIdx > 0) {
        const splitSep = layoutSettings.splitSeparator || { visible: true, style: 'dashed' };
        if (splitSep.visible !== false) {
          y += 5;
          drawDashedLine(y);
          y += 10;
        }
      }
      
      const guestFontSize = guestNumberEl.fontSize || 16;
      if (guestNumberEl.inverse) {
        drawInverseText(`GUEST ${guestNum}`, centerX, y, guestFontSize);
      } else {
        drawText(`GUEST ${guestNum}`, centerX, y, guestFontSize, 'bold');
      }
      y += guestFontSize + 12;
    }

    // Items for this guest
    itemsByGuest[guestNum].forEach(item => {
      const qty = item.qty || item.quantity || 1;
      const name = item.name || 'Unknown Item';
      const itemFontSize = itemsEl.fontSize || 22;
      const itemSpacing = Math.round((itemsEl.lineSpacing || 1.2) * 10);
      
      // Item: 위쪽 간격 추가 후 출력
      y += itemSpacing;
      ctx.font = `bold ${itemFontSize}px Arial`;
      ctx.textAlign = 'left';
      ctx.fillText(`${qty}x ${name}`, MARGIN, y);
      y += itemFontSize;

      // Modifiers - 위쪽 간격 방식
      if (modifiersEl.visible !== false && item.modifiers?.length > 0) {
        const modFontSize = modifiersEl.fontSize || 16;
        const modSpacing = Math.round((modifiersEl.lineSpacing || 1.2) * 10);
        const prefix = modifiersEl.prefix || '>>';
        ctx.font = `normal ${modFontSize}px Arial`;
        
        item.modifiers.forEach(mod => {
          const modText = typeof mod === 'string' ? mod : (mod.name || mod.text || '');
          if (modText) {
            y += modSpacing;
            ctx.fillText(`  ${prefix} ${modText}`, MARGIN, y);
            y += modFontSize;
          }
        });
      }

      // Item note/memo - 위쪽 간격 방식
      if (itemNoteEl.visible !== false && item.memo) {
        const noteFontSize = itemNoteEl.fontSize || 14;
        const noteSpacing = Math.round((itemNoteEl.lineSpacing || 1.2) * 10);
        const prefix = itemNoteEl.prefix || '->';
        y += noteSpacing;
        ctx.font = `italic ${noteFontSize}px Arial`;
        ctx.fillText(`  ${prefix} ${item.memo}`, MARGIN, y);
        y += noteFontSize;
      }
    });
  });

  // === SEPARATOR 2 ===
  const separator2 = layoutSettings.separator2 || { visible: true, style: 'solid' };
  const sep2SpacingOld = separator2.lineSpacing || 10;  // lineSpacing 지원
  y += sep2SpacingOld;
  if (separator2.visible !== false) {
    if (separator2.style === 'dashed') {
      drawDashedLine(y);
    } else {
      drawSolidLine(y);
    }
    y += 15;
  }

  // === PAID STATUS ===
  const paidStatusEl = layoutSettings.paidStatus || { visible: true, inverse: true, fontSize: 20 };
  if (paidStatusEl.visible !== false && isPaid) {
    const fontSize = paidStatusEl.fontSize || 20;
    if (paidStatusEl.inverse) {
      drawInverseText('PAID', centerX, y, fontSize);
    } else {
      drawText('PAID', centerX, y, fontSize, 'bold');
    }
    y += fontSize + 15;
  }

  // Get image buffer
  return canvas.toBuffer('image/png');
}

/**
 * Convert PNG image to ESC/POS raster bitmap commands
 * @param {Buffer} pngBuffer - PNG image buffer
 * @param {number} paperWidth - Paper width in mm (80 or 58)
 * @returns {Buffer} - ESC/POS commands with bitmap
 */
function convertImageToEscPos(pngBuffer, paperWidth = 80) {
  if (!createCanvas) {
    return null;
  }

  const { createCanvas: cc, loadImage } = require('canvas');
  
  // This is async, so we'll use a sync approach
  // Load PNG to get dimensions and pixel data
  const img = require('canvas').Image ? new (require('canvas').Image)() : null;
  if (!img) return null;
  
  // For simplicity, we'll use a different approach - directly access PNG data
  // This requires the sharp library for better performance, but we'll use canvas
  
  return null; // Placeholder - we'll implement sync version below
}

/**
 * Convert canvas to ESC/POS using ESC * (bit image) command
 * 
 * 규격:
 * - 입력: Canvas (정확히 576px 또는 384px 폭)
 * - 출력: 1-bit 흑백 비트맵 (threshold 128)
 * - 명령: ESC * m=33 (24-dot double density, 203 DPI)
 * - 라인별 전송으로 모든 ESC/POS 프린터 호환
 * 
 * @param {Canvas} canvas - Node-canvas instance (width must be 576 or 384)
 * @returns {Buffer} - ESC/POS commands
 */
function canvasToEscPosBitmap(canvas) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width;  // 576px (80mm) or 384px (58mm)
  const height = canvas.height;
  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = imageData.data;

  console.log(`🖼️ Converting image: ${width}x${height}px to 1-bit ESC/POS`);

  // ============ ESC * 명령 (bit image mode) ============
  // ESC * m nL nH [data]
  // m = 33: 24-dot double density (203 DPI 기준)
  // nL nH = 가로 도트 수 (little endian)
  
  const buffers = [];
  
  // 프린터 초기화
  buffers.push(Buffer.from([0x1B, 0x40])); // ESC @ (Initialize)
  
  // 라인 스페이싱을 24 도트로 설정 (24-dot 모드용)
  buffers.push(Buffer.from([0x1B, 0x33, 24])); // ESC 3 n (Set line spacing to 24 dots)
  
  // 24줄씩 청크 단위로 처리 (24-dot 모드)
  const CHUNK_HEIGHT = 24;
  
  for (let chunkY = 0; chunkY < height; chunkY += CHUNK_HEIGHT) {
    // ESC * m nL nH - 비트 이미지 명령
    const nL = width & 0xFF;
    const nH = (width >> 8) & 0xFF;
    buffers.push(Buffer.from([0x1B, 0x2A, 33, nL, nH])); // ESC * 33 nL nH
    
    // 각 가로 위치에 대해 24개의 세로 도트 구성
    const lineData = [];
    for (let x = 0; x < width; x++) {
      // 24 dots = 3 bytes per column (8 bits × 3 = 24)
      for (let byteIdx = 0; byteIdx < 3; byteIdx++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          const y = chunkY + (byteIdx * 8) + bit;
          if (y < height) {
            const pixelIdx = (y * width + x) * 4;
            const r = pixels[pixelIdx];
            const g = pixels[pixelIdx + 1];
            const b = pixels[pixelIdx + 2];
            
            // ============ 1-bit 흑백 변환 (threshold 128) ============
            // ITU-R BT.601 grayscale conversion
            const gray = (r * 0.299 + g * 0.587 + b * 0.114);
            
            // gray < 128 이면 검은색 (도트 찍음)
            if (gray < 128) {
              byte |= (0x80 >> bit);
            }
          }
        }
        lineData.push(byte);
      }
    }
    
    buffers.push(Buffer.from(lineData));
    buffers.push(Buffer.from([0x0A])); // Line feed (다음 줄로)
  }
  
  // 라인 스페이싱 기본값으로 복원
  buffers.push(Buffer.from([0x1B, 0x32])); // ESC 2 (Default line spacing)
  
  // 피드 및 컷
  buffers.push(Buffer.from([0x1B, 0x64, 0x04])); // ESC d 4 (Feed 4 lines)
  buffers.push(Buffer.from([0x1D, 0x56, 0x00])); // GS V 0 (Full cut)
  
  const result = Buffer.concat(buffers);
  console.log(`🖼️ ESC/POS data size: ${result.length} bytes`);
  
  return result;
}

/**
 * Alternative: Convert canvas using GS v 0 (raster bit image)
 * Some printers support this better than ESC *
 */
function canvasToEscPosRaster(canvas) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  
  // Width in bytes (8 pixels per byte)
  const widthBytes = Math.ceil(width / 8);
  const xL = widthBytes & 0xFF;
  const xH = (widthBytes >> 8) & 0xFF;
  const yL = height & 0xFF;
  const yH = (height >> 8) & 0xFF;

  const bitmapData = [];
  
  for (let row = 0; row < height; row++) {
    for (let byteIdx = 0; byteIdx < widthBytes; byteIdx++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = byteIdx * 8 + bit;
        if (x < width) {
          const pixelIdx = (row * width + x) * 4;
          const r = pixels[pixelIdx];
          const g = pixels[pixelIdx + 1];
          const b = pixels[pixelIdx + 2];
          const gray = (r * 0.299 + g * 0.587 + b * 0.114);
          if (gray < 128) {
            byte |= (0x80 >> bit);
          }
        }
      }
      bitmapData.push(byte);
    }
  }

  const buffers = [];
  buffers.push(Buffer.from([0x1B, 0x40])); // ESC @ init
  buffers.push(Buffer.from([0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH])); // GS v 0
  buffers.push(Buffer.from(bitmapData));
  buffers.push(Buffer.from([0x1B, 0x64, 0x03, 0x1D, 0x56, 0x00])); // feed + cut

  return Buffer.concat(buffers);
}

/**
 * Build high-quality image-based kitchen ticket
 * 
 * 규격:
 * - 해상도: 203 DPI
 * - 폭: 576px (80mm) 또는 384px (58mm) - 정확히 맞춤
 * - 색상: 1-bit 흑백 (threshold 128)
 * - 렌더링: Canvas (no CSS scale/transform)
 * - 출력: ESC * 명령 (24-dot double density)
 * 
 * @param {Object} options - Print options
 * @returns {Buffer|null} - ESC/POS commands or null if not available
 */
function buildImageKitchenTicket(options) {
  if (!createCanvas) {
    console.warn('Canvas not available for image-based printing');
    return null;
  }

  const {
    orderInfo = {},
    items = [],
    layoutSettings = {},
    isAdditionalOrder = false,
    isPaid = false,
    isReprint = false,
    paperWidth = 80,
    printerName = '',  // 프린터 이름 (Front, Sushi Bar, Kitchen 등)
    isServerTicket = false  // Server Ticket 여부 (Front 프린터 = Server Ticket, PAID/UNPAID 출력)
  } = options;

  // ============ DPI 스케일링 ============
  // 화면: 96 DPI, 프린터: 203 DPI
  // 화면에서 보이는 것과 동일한 시각적 크기를 얻으려면 2.1배 스케일 필요
  const DPI_SCALE = 2.1; // 203 / 96 ≈ 2.1
  
  // 폰트 사이즈 스케일링 함수
  const scaleFontSize = (size) => Math.round((size || 16) * DPI_SCALE);

  // DEBUG: Log received layout settings and items
  console.log('=== buildImageKitchenTicket DEBUG ===');
  console.log('orderInfo:', JSON.stringify(orderInfo));
  console.log('isPaid:', isPaid);
  console.log('isServerTicket:', isServerTicket);
  console.log('items count:', items.length);
  console.log('paidStatus setting:', JSON.stringify(layoutSettings.paidStatus));
  console.log('dateTime setting:', JSON.stringify(layoutSettings.dateTime));
  console.log('specialInstructions setting:', JSON.stringify(layoutSettings.specialInstructions));
  console.log('orderInfo.specialInstructions:', orderInfo.specialInstructions);
  console.log('mergedElements:', JSON.stringify(layoutSettings.mergedElements));
  if (layoutSettings.mergedElements?.length > 0) {
    layoutSettings.mergedElements.forEach((m, i) => {
      console.log(`  merged[${i}] lineInverse:`, m.lineInverse);
    });
  }
  console.log('=====================================');

  // ============ 203 DPI 규격 정확히 적용 ============
  // 80mm paper = 576px @ 203 DPI (80mm * 203dpi / 25.4mm = 639.37, but standard is 576)
  // 58mm paper = 384px @ 203 DPI
  const PAPER_WIDTH_PX = paperWidth === 80 ? 576 : 384;
  
  // 마진을 mm에서 픽셀로 변환 (203 DPI: 1mm = 8 pixels)
  const MM_TO_PX = 8; // 203 DPI / 25.4 ≈ 8
  const MARGIN = Math.round((layoutSettings.leftMargin || 0) * MM_TO_PX) + 16;
  const TOP_MARGIN = Math.round((layoutSettings.topMargin || 0) * MM_TO_PX) + 24;

  // Helper to get element settings with defaults
  const getEl = (key, defaults = {}) => {
    const el = layoutSettings[key] || {};
    return {
      visible: el.visible !== false,
      fontSize: el.fontSize || defaults.fontSize || 16,
      lineSpacing: el.lineSpacing || defaults.lineSpacing || 1.4,
      fontWeight: el.fontWeight || defaults.fontWeight || 'normal',
      inverse: el.inverse || false,
      isItalic: el.isItalic || false,
      textAlign: el.textAlign || defaults.textAlign || 'center',
      showInHeader: el.showInHeader !== false,
      showInFooter: el.showInFooter || false,
      ...el
    };
  };

  // Get all element settings from layout
  const orderTypeEl = getEl('orderType', { fontSize: 28, fontWeight: 'bold', inverse: true });
  const tableNumberEl = getEl('tableNumber', { fontSize: 32, fontWeight: 'bold' });
  const posOrderNumberEl = getEl('posOrderNumber', { fontSize: 18 });
  const externalOrderNumberEl = getEl('externalOrderNumber', { fontSize: 24, fontWeight: 'bold', inverse: true }); // Take-out용 크게 수정
  const deliveryChannelEl = getEl('deliveryChannel', { fontSize: 24, fontWeight: 'bold', inverse: true }); // Take-out용 추가
  const pickupTimeEl = getEl('pickupTime', { fontSize: 20, fontWeight: 'bold', inverse: true }); // Take-out용 추가
  const serverNameEl = getEl('serverName', { fontSize: 16 });
  const dateTimeEl = getEl('dateTime', { fontSize: 14 });
  const paidStatusEl = getEl('paidStatus', { fontSize: 20, inverse: true });
  const guestNumberEl = getEl('guestNumber', { fontSize: 18, fontWeight: 'bold', inverse: true });
  const itemsEl = getEl('items', { fontSize: 22, fontWeight: 'bold', textAlign: 'left' });
  const modifiersEl = getEl('modifiers', { fontSize: 16, prefix: '>>' });
  const itemNoteEl = getEl('itemNote', { fontSize: 14, prefix: '->' });
  const specialInstructionsEl = getEl('specialInstructions', { fontSize: 12, fontWeight: 'bold' });
  const separator1 = layoutSettings.separator1 || { visible: true, style: 'solid' };
  const separator2 = layoutSettings.separator2 || { visible: true, style: 'solid' };
  const splitSeparator = layoutSettings.splitSeparator || { visible: true, style: 'dashed' };

  // 폰트 높이 (순수 폰트 크기만) - DPI 스케일링 적용
  const getFontHeight = (el) => Math.round(scaleFontSize(el.fontSize));
  
  // 윗 요소와의 간격 (lineSpacing 값을 그대로 픽셀로 사용, DPI 스케일링 없음)
  const getSpacing = (el) => {
    const spacing = el.lineSpacing || 0;
    return spacing;  // 설정값 그대로 사용 (14px면 14px)
  };
  
  // 전체 줄 높이 = 폰트 높이 + 간격
  const getLineHeight = (el) => getFontHeight(el) + getSpacing(el);
  
  // DEBUG: lineSpacing 값 확인 (함수 정의 후에 호출)
  console.log('🔍 [Kitchen Ticket DEBUG] Items lineSpacing:', itemsEl.lineSpacing, '-> scaled:', getSpacing(itemsEl), 'px');
  console.log('🔍 [Kitchen Ticket DEBUG] Modifiers lineSpacing:', modifiersEl.lineSpacing, '-> scaled:', getSpacing(modifiersEl), 'px');
  console.log('🔍 [Kitchen Ticket DEBUG] ItemNote lineSpacing:', itemNoteEl.lineSpacing, '-> scaled:', getSpacing(itemNoteEl), 'px');
  console.log('🔍 [Kitchen Ticket DEBUG] layoutSettings.items:', JSON.stringify(layoutSettings.items));

  // Calculate dynamic height based on actual settings
  let totalHeight = TOP_MARGIN;
  if (printerName) totalHeight += scaleFontSize(16) + 25;  // 프린터 이름 높이
  if (isReprint) totalHeight += 45;
  if (isAdditionalOrder) totalHeight += 45;
  
  // Check for merged elements
  const mergedElementsForHeight = layoutSettings.mergedElements || [];
  const mergedKeysForHeight = new Set();
  mergedElementsForHeight.forEach(m => {
    if (m.leftElement?.key) mergedKeysForHeight.add(m.leftElement.key);
    if (m.rightElement?.key) mergedKeysForHeight.add(m.rightElement.key);
  });
  
  // Add height for merged elements (병합된 요소는 무조건 출력되므로 항상 높이 추가)
  // 연속된 lineInverse 요소 사이에는 간격이 줄어듦
  mergedElementsForHeight.forEach((merged, idx) => {
    const nextMerged = mergedElementsForHeight[idx + 1];
    const isLineInverse = merged.lineInverse === true;
    const nextIsLineInverse = nextMerged?.lineInverse === true;
    
    if (isLineInverse && nextIsLineInverse) {
      // 연속된 inverse - 간격 축소
      totalHeight += scaleFontSize(24) / 2 + 8;
    } else {
      totalHeight += scaleFontSize(24) + 15;
    }
  });
  
  // Individual elements (skip if merged)
  if (!mergedKeysForHeight.has('orderType') && orderTypeEl.visible && orderTypeEl.showInHeader) totalHeight += getLineHeight(orderTypeEl) + 10;
  if (!mergedKeysForHeight.has('tableNumber') && tableNumberEl.visible && tableNumberEl.showInHeader && orderInfo.table) totalHeight += getLineHeight(tableNumberEl) + 10;
  if (!mergedKeysForHeight.has('posOrderNumber') && posOrderNumberEl.visible && posOrderNumberEl.showInHeader && orderInfo.orderNumber) totalHeight += getLineHeight(posOrderNumberEl) + 5;
  if (!mergedKeysForHeight.has('serverName') && serverNameEl.visible && serverNameEl.showInHeader && orderInfo.server) totalHeight += getLineHeight(serverNameEl) + 5;
  if (!mergedKeysForHeight.has('dateTime') && dateTimeEl.visible && dateTimeEl.showInHeader) totalHeight += getLineHeight(dateTimeEl) + 5;
  // Dine-in: 설정에 따라 출력, Take-out/Online: Server Ticket(Front)에서는 항상 출력
  // PAID는 Top spacing이 위쪽 간격으로만 적용되어야 함 (getFontHeight + topSpacing + 고정값)
  const heightOrderType = (orderInfo.orderType || orderInfo.channel || 'DINE-IN').toUpperCase();
  const heightIsDineIn = heightOrderType === 'DINE-IN' || heightOrderType === 'DINEIN';
  if (!mergedKeysForHeight.has('paidStatus') && paidStatusEl.visible && (paidStatusEl.showInHeader || (isServerTicket && !heightIsDineIn))) {
    // 마지막 merged element가 lineInverse이고 paidStatus도 inverse면 간격 최소화
    const lastMergedH = mergedElementsForHeight[mergedElementsForHeight.length - 1];
    const lastMergedIsLineInverse = lastMergedH?.lineInverse === true;
    const paidIsInverseH = paidStatusEl.inverse === true;
    
    if (lastMergedIsLineInverse && paidIsInverseH) {
      // 연속 inverse - topSpacing 생략
      totalHeight += getFontHeight(paidStatusEl) + 2;
    } else {
      const paidTopSpacing = paidStatusEl.lineSpacing || 0;
      totalHeight += getFontHeight(paidStatusEl) + paidTopSpacing + 2;
    }
  }
  if (separator1.visible) totalHeight += (separator1.lineSpacing || 8) + 15;

  // Items height
  items.forEach(item => {
    totalHeight += getLineHeight(itemsEl) + 8;
    if (modifiersEl.visible && item.modifiers?.length) {
      // Count actual modifier entries
      let modCount = 0;
      item.modifiers.forEach(modGroup => {
        if (modGroup.selectedEntries?.length) {
          modCount += modGroup.selectedEntries.length;
        } else if (modGroup.modifierNames?.length) {
          modCount += modGroup.modifierNames.length;
        } else if (modGroup.name || typeof modGroup === 'string') {
          modCount += 1;
        }
      });
      totalHeight += modCount * (getLineHeight(modifiersEl) + 4);
    }
    if (itemNoteEl.visible && item.memo) {
      totalHeight += getLineHeight(itemNoteEl) + 4;
    }
  });

  // Guest separators
  const guestNumbers = [...new Set(items.map(it => it.guestNumber || 1))].sort((a, b) => a - b);
  if (guestNumberEl.visible && guestNumbers.length > 1) {
    totalHeight += guestNumbers.length * (getLineHeight(guestNumberEl) + 20);
  }

  // Kitchen Note 높이
  const kitchenNoteEl = getEl('kitchenNote', { fontSize: 14, fontWeight: 'bold' });
  console.log('🍳 [Kitchen Note Debug] printerName:', printerName, 'isServerTicket:', isServerTicket);
  console.log('🍳 [Kitchen Note Debug] layoutSettings.kitchenNote:', JSON.stringify(layoutSettings.kitchenNote));
  console.log('🍳 [Kitchen Note Debug] kitchenNoteEl.visible:', kitchenNoteEl.visible);
  console.log('🍳 [Kitchen Note Debug] orderInfo.kitchenNote:', orderInfo.kitchenNote);
  if (kitchenNoteEl.visible && orderInfo.kitchenNote) {
    const kitchenNoteTopSpacing = Math.round((kitchenNoteEl.lineSpacing || 1.2) * 10);
    totalHeight += getFontHeight(kitchenNoteEl) + kitchenNoteTopSpacing + 5;
  }

  if (separator2.visible) totalHeight += (separator2.lineSpacing || 10) + 15;
  // Footer elements: dateTime (showInFooter), paidStatus (showInFooter), specialInstructions
  if (dateTimeEl.visible && dateTimeEl.showInFooter) totalHeight += getLineHeight(dateTimeEl) + 5;
  // PAID는 Top spacing이 위쪽 간격으로만 적용되어야 함
  if (paidStatusEl.visible && paidStatusEl.showInFooter) {
    const paidFooterTopSpacing = Math.round((paidStatusEl.lineSpacing || 1.2) * 10);
    totalHeight += getFontHeight(paidStatusEl) + paidFooterTopSpacing + 10;
  }
  if (specialInstructionsEl.visible && orderInfo.specialInstructions) totalHeight += getLineHeight(specialInstructionsEl) + 10;
  totalHeight -= 18; // Bottom margin reduced further (half of previous)

  // Create canvas
  const canvas = createCanvas(PAPER_WIDTH_PX, totalHeight);
  const ctx = canvas.getContext('2d');

  // White background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, PAPER_WIDTH_PX, totalHeight);
  ctx.fillStyle = '#000000';

  let y = TOP_MARGIN;
  const centerX = PAPER_WIDTH_PX / 2;

  // Helper: Get font weight string
  const getFontWeight = (el) => {
    if (el.fontWeight === 'extrabold') return '900';
    if (el.fontWeight === 'bold') return 'bold';
    return 'normal';
  };

  // === PRINTER NAME (프린터 이름: Front, Sushi Bar, Kitchen 등) ===
  if (printerName) {
    const printerNameFs = scaleFontSize(16);
    ctx.font = `bold ${printerNameFs}px Arial`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#000000';
    
    // 프린터 이름을 inverse (흰색 글씨, 검은 배경)로 표시
    const textMetrics = ctx.measureText(printerName);
    const textWidth = textMetrics.width + 30;
    const textHeight = printerNameFs + 12;
    
    ctx.fillRect(centerX - textWidth/2, y - textHeight/2, textWidth, textHeight);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(printerName, centerX, y + printerNameFs/4);
    ctx.fillStyle = '#000000';
    
    y += printerNameFs + 20;
  }

  // Helper: Get font style
  const getFontStyle = (el) => el.isItalic ? 'italic' : 'normal';

  // Draw inverse text (white on black background) - with DPI scaling
  // fullWidth=true: 전체 너비 검은 막대 (연속 inverse 간격 제거용)
  const drawInverse = (text, yPos, el, fullWidth = false) => {
    const fs = scaleFontSize(el.fontSize);
    ctx.font = `${getFontStyle(el)} ${getFontWeight(el)} ${fs}px Arial`;
    const metrics = ctx.measureText(text);
    const h = fs + 16;
    ctx.fillStyle = '#000000';
    if (fullWidth) {
      // 전체 너비로 그려서 연속 inverse 시 흰띠 제거
      ctx.fillRect(0, yPos - h/2 - 2, PAPER_WIDTH_PX, h + 4);
    } else {
      const w = metrics.width + 30;
      ctx.fillRect(centerX - w/2, yPos - h/2 - 2, w, h);
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.fillText(text, centerX, yPos + fs/4);
    ctx.fillStyle = '#000000';
  };

  // Draw normal text with full element settings - with DPI scaling
  const drawText = (text, yPos, el, overrideAlign = null) => {
    const fs = scaleFontSize(el.fontSize);
    const align = overrideAlign || el.textAlign || 'center';
    ctx.font = `${getFontStyle(el)} ${getFontWeight(el)} ${fs}px Arial`;
    ctx.textAlign = align;
    let x = centerX;
    if (align === 'left') x = MARGIN;
    if (align === 'right') x = PAPER_WIDTH_PX - MARGIN;
    ctx.fillText(text, x, yPos);
    ctx.textAlign = 'left'; // Reset
  };

  // Draw separator line
  const drawLine = (yPos, style = 'solid') => {
    ctx.lineWidth = style === 'dotted' ? 2 : 1;
    if (style === 'dashed') ctx.setLineDash([6, 4]);
    else if (style === 'dotted') ctx.setLineDash([2, 3]);
    else ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(MARGIN, yPos);
    ctx.lineTo(PAPER_WIDTH_PX - MARGIN, yPos);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  // === REPRINT BANNER === (전체 너비 검은 띠)
  if (isReprint) {
    const bannerFs = scaleFontSize(22);
    const bannerH = bannerFs + 16;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, y - bannerH / 2, PAPER_WIDTH_PX, bannerH);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold ${bannerFs}px Arial`;
    ctx.textAlign = 'center';
    ctx.fillText('** REPRINT **', centerX, y + bannerFs / 4);
    ctx.fillStyle = '#000000';
    y += 40;
  }

  // === ADDITIONAL ORDER BANNER === (전체 너비 검은 띠)
  if (isAdditionalOrder) {
    const bannerFs = scaleFontSize(20);
    const bannerH = bannerFs + 16;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, y - bannerH / 2, PAPER_WIDTH_PX, bannerH);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold ${bannerFs}px Arial`;
    ctx.textAlign = 'center';
    ctx.fillText('++ ADDITIONAL ++', centerX, y + bannerFs / 4);
    ctx.fillStyle = '#000000';
    y += 40;
  }

  // === MERGED ELEMENTS HANDLING ===
  const mergedElements = layoutSettings.mergedElements || [];
  const mergedKeys = new Set();
  mergedElements.forEach(m => {
    if (m.leftElement?.key) mergedKeys.add(m.leftElement.key);
    if (m.rightElement?.key) mergedKeys.add(m.rightElement.key);
  });

  // Helper function to get element value
  const getElementValue = (key) => {
    // Togo/TZO 여부 판단 (여러 case에서 사용)
    const channel = (orderInfo.deliveryChannel || orderInfo.channel || orderInfo.orderSource || '').toUpperCase();
    const isTogoOrTZO = ['TOGO', 'TAKEOUT', 'TO-GO', 'THEZONE', 'ONLINE'].includes(channel) ||
                       ['TOGO', 'TAKEOUT', 'THEZONE'].includes((orderInfo.orderType || '').toUpperCase());
    const isDelivery = ['DOORDASH', 'UBEREATS', 'SKIPTHEDISHES', 'SKIP', 'FANTUAN', 'GRUBHUB', 'DELIVERY'].includes(channel);
    
    switch (key) {
      case 'orderType': return (orderInfo.orderType || orderInfo.channel || 'DINE-IN').toUpperCase();
      case 'tableNumber': return orderInfo.table || '';
      case 'posOrderNumber': {
        // Togo/TZO: 빈 공간 (externalOrderNumber에서 이미 주문번호 표시)
        if (isTogoOrTZO && !isDelivery) {
          return '';
        }
        // 배달/다인인: 기존처럼 표시
        return orderInfo.orderNumber ? `Order #: ${orderInfo.orderNumber.replace('#', '')}` : '';
      }
      case 'serverName': return orderInfo.server || '';
      case 'dateTime': return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      case 'paidStatus': return isPaid ? 'PAID' : '';
      // Kitchen for Takeout 요소들 추가
      case 'deliveryChannel': return (orderInfo.deliveryChannel || orderInfo.channel || orderInfo.orderSource || '').toUpperCase();
      case 'pickupTime': {
        // 라벨: Togo/TZO는 "PICKUP", 배달은 "READY"
        const label = isTogoOrTZO && !isDelivery ? 'PICKUP' : 'READY';
        
        // pickupTime(readyTimeLabel)이 있으면 사용
        if (orderInfo.pickupTime) return `${label}: ${orderInfo.pickupTime}`;
        if (orderInfo.readyTime) return `${label}: ${orderInfo.readyTime}`;
        // pickupMinutes가 있으면 현재 시간 + minutes로 계산
        if (orderInfo.pickupMinutes) {
          const pickupDate = new Date(Date.now() + orderInfo.pickupMinutes * 60000);
          return `${label}: ${pickupDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
        }
        if (orderInfo.pickup_minutes) {
          const pickupDate = new Date(Date.now() + orderInfo.pickup_minutes * 60000);
          return `${label}: ${pickupDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
        }
        if (orderInfo.prepTime) {
          const pickupDate = new Date(Date.now() + orderInfo.prepTime * 60000);
          return `${label}: ${pickupDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
        }
        // 기본값: 빈 문자열
        return '';
      }
      case 'externalOrderNumber': {
        if (isTogoOrTZO && !isDelivery) {
          // Togo/TZO: POS 주문번호를 여기에 표시 (#916 형식)
          return orderInfo.orderNumber || '';
        }
        // 배달: 외부 주문번호 사용 (#DD-78542 형식)
        return orderInfo.externalOrderNumber || '';
      }
      case 'customerName': return orderInfo.customerName || '';
      case 'customerPhone': return orderInfo.customerPhone || '';
      case 'deliveryAddress': return orderInfo.deliveryAddress || '';
      case 'guestNumber': return orderInfo.guestNumber || '';
      default: return '';
    }
  };

  // Render merged elements (e.g., "DINE-IN TABLE 5" on same line)
  // 병합된 요소는 visible 설정과 관계없이 무조건 출력
  mergedElements.forEach((merged, mergedIdx) => {
    if (!merged.leftElement || !merged.rightElement) return;
    
    const leftKey = merged.leftElement.key;
    const rightKey = merged.rightElement.key;
    const leftEl = getEl(leftKey, { fontSize: 24, fontWeight: 'bold', visible: true, inverse: true });
    const rightEl = getEl(rightKey, { fontSize: 24, fontWeight: 'bold', visible: true });
    
    // LINE INV 옵션 확인 (전체 라인 inverse)
    const lineInverse = merged.lineInverse === true;
    
    // 병합된 요소는 무조건 출력 - 값이 없으면 기본값 사용
    let leftValue = getElementValue(leftKey);
    let rightValue = getElementValue(rightKey);
    
    // 기본값 설정 (값이 없을 경우)
    if (!leftValue && leftKey === 'orderType') leftValue = 'DINE-IN';
    if (!rightValue && rightKey === 'tableNumber') rightValue = orderInfo.table || 'TABLE';
    
    if (!leftValue && !rightValue) return;
    
    // Calculate positions for side-by-side rendering
    // MERGED 요소에 설정된 fontSize를 직접 사용 (headerScale 제거)
    const leftMergedFs = merged.leftElement.fontSize || leftEl.fontSize || 24;
    const rightMergedFs = merged.rightElement.fontSize || rightEl.fontSize || 24;
    const leftFs = scaleFontSize(leftMergedFs);
    let rightFs = scaleFontSize(rightMergedFs);
    
    console.log(`🔍 [MERGED DEBUG] ${leftKey}+${rightKey}: leftFs=${leftMergedFs}→${leftFs}px, rightFs=${rightMergedFs}→${rightFs}px`);
    const maxFs = Math.max(leftFs, rightFs);
    
    ctx.font = `bold ${leftFs}px Arial`;
    const leftWidth = ctx.measureText(leftValue).width;
    ctx.font = `bold ${rightFs}px Arial`;
    const rightWidth = ctx.measureText(rightValue).width;
    
    const gap = 20; // Gap between elements
    const totalWidth = leftWidth + gap + rightWidth;
    const startX = (PAPER_WIDTH_PX - totalWidth) / 2;
    
    // LINE INV가 체크된 경우: 전체 너비 검은색 배경 (왼쪽 끝 ~ 오른쪽 끝)
    if (lineInverse) {
      const barHeight = maxFs + 16;
      
      // Draw FULL WIDTH black bar (from edge to edge)
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, y - barHeight/2, PAPER_WIDTH_PX, barHeight);
      
      // Draw both texts in white, centered
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `bold ${leftFs}px Arial`;
      ctx.textAlign = 'left';
      ctx.fillText(leftValue, startX, y + leftFs/4);
      
      ctx.font = `bold ${rightFs}px Arial`;
      const rightX = startX + leftWidth + gap;
      ctx.fillText(rightValue, rightX, y + rightFs/4);
      
      ctx.fillStyle = '#000000';
    } else {
      // 개별 요소별 inverse 처리
      // Draw left element (with inverse if set)
      if (leftValue) {
        if (leftEl.inverse) {
          ctx.font = `bold ${leftFs}px Arial`;
          const lw = ctx.measureText(leftValue).width + 16;
          const lh = leftFs + 10;
          ctx.fillStyle = '#000000';
          ctx.fillRect(startX - 8, y - lh/2, lw, lh);
          ctx.fillStyle = '#FFFFFF';
          ctx.textAlign = 'left';
          ctx.fillText(leftValue, startX, y + leftFs/4);
          ctx.fillStyle = '#000000';
        } else {
          ctx.font = `bold ${leftFs}px Arial`;
          ctx.textAlign = 'left';
          ctx.fillText(leftValue, startX, y + leftFs/4);
        }
      }
      
      // Draw right element (with inverse if set)
      if (rightValue) {
        const rightX = startX + leftWidth + gap + (leftEl.inverse ? 8 : 0);
        if (rightEl.inverse) {
          ctx.font = `bold ${rightFs}px Arial`;
          const rw = ctx.measureText(rightValue).width + 16;
          const rh = rightFs + 10;
          ctx.fillStyle = '#000000';
          ctx.fillRect(rightX - 8, y - rh/2, rw, rh);
          ctx.fillStyle = '#FFFFFF';
          ctx.textAlign = 'left';
          ctx.fillText(rightValue, rightX, y + rightFs/4);
          ctx.fillStyle = '#000000';
        } else {
          ctx.font = `bold ${rightFs}px Arial`;
          ctx.textAlign = 'left';
          ctx.fillText(rightValue, rightX, y + rightFs/4);
        }
      }
    }
    
    // 연속된 lineInverse 요소 사이에는 간격 없음 (흰 띠 제거)
    const nextMerged = mergedElements[mergedIdx + 1];
    const nextIsLineInverse = nextMerged?.lineInverse === true;
    
    if (lineInverse && nextIsLineInverse) {
      // 연속된 inverse - 간격 없이 바로 붙임
      y += maxFs / 2 + 8;  // 절반 높이만 이동 (다음 요소가 나머지 절반 차지)
    } else {
      y += maxFs + 12;
    }
  });

  // === ORDER TYPE === (skip if merged)
  if (!mergedKeys.has('orderType') && orderTypeEl.visible && orderTypeEl.showInHeader) {
    const orderType = (orderInfo.orderType || 'DINE-IN').toUpperCase();
    if (orderTypeEl.inverse) {
      drawInverse(orderType, y, orderTypeEl);
    } else {
      drawText(orderType, y, orderTypeEl);
    }
    y += getLineHeight(orderTypeEl) + 8;
  }

  // === TABLE NUMBER === (skip if merged)
  if (!mergedKeys.has('tableNumber') && tableNumberEl.visible && tableNumberEl.showInHeader && orderInfo.table) {
    if (tableNumberEl.inverse) {
      drawInverse(orderInfo.table, y, tableNumberEl);
    } else {
      drawText(orderInfo.table, y, tableNumberEl);
    }
    y += getLineHeight(tableNumberEl) + 8;
  }

  // === POS ORDER NUMBER === (skip if merged)
  if (!mergedKeys.has('posOrderNumber') && posOrderNumberEl.visible && posOrderNumberEl.showInHeader && orderInfo.orderNumber) {
    const orderText = `Order: ${orderInfo.orderNumber}`;
    const align = posOrderNumberEl.textAlign || 'center';
    if (align === 'right') {
      const fs = scaleFontSize(posOrderNumberEl.fontSize);
      const shiftLeft = scaleFontSize(60);
      ctx.font = `${getFontStyle(posOrderNumberEl)} ${getFontWeight(posOrderNumberEl)} ${fs}px Arial`;
      ctx.textAlign = 'right';
      ctx.fillText(orderText, PAPER_WIDTH_PX - MARGIN - shiftLeft, y);
      ctx.textAlign = 'left';
    } else {
      drawText(orderText, y, posOrderNumberEl);
    }
    y += getLineHeight(posOrderNumberEl) + 4;
  }

  // === SERVER NAME === (skip if merged)
  if (!mergedKeys.has('serverName') && serverNameEl.visible && serverNameEl.showInHeader && orderInfo.server) {
    drawText(`Server: ${orderInfo.server}`, y, serverNameEl);
    y += getLineHeight(serverNameEl) + 4;
  }

  // === DATE/TIME === (skip if merged)
  if (!mergedKeys.has('dateTime') && dateTimeEl.visible && dateTimeEl.showInHeader) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    drawText(timeStr, y, dateTimeEl);
    y += getLineHeight(dateTimeEl) + 4;
  }

  // === PAID STATUS IN HEADER === (show PAID or UNPAID)
  // Dine-in: 설정(visible, showInHeader)에 따라 출력
  // Take-out/Online: Server Ticket(Front)에서는 설정과 관계없이 항상 출력
  const orderType = (orderInfo.orderType || orderInfo.channel || 'DINE-IN').toUpperCase();
  const isDineIn = orderType === 'DINE-IN' || orderType === 'DINEIN';
  const shouldShowPaidStatusInHeader = !mergedKeys.has('paidStatus') && paidStatusEl.visible && 
                                       (paidStatusEl.showInHeader || (isServerTicket && !isDineIn));
  if (shouldShowPaidStatusInHeader) {
    // 마지막 merged element가 lineInverse이고, paidStatus도 inverse이면 간격 최소화 (흰 띠 제거)
    const lastMerged = mergedElements[mergedElements.length - 1];
    const lastMergedIsLineInverse = lastMerged?.lineInverse === true;
    const paidIsInverse = paidStatusEl.inverse === true;
    
    if (lastMergedIsLineInverse && paidIsInverse) {
      // 연속된 inverse - 간격 없이 바로 붙임
      // y 위치는 이미 마지막 merged element에서 적절히 이동됨
    } else {
      // Top spacing 적용 (lineSpacing 값 그대로 사용, 프리뷰와 일치)
      const topSpacing = paidStatusEl.lineSpacing || 0;
      y += topSpacing;
    }
    
    const statusText = isPaid ? 'PAID' : 'UNPAID';
    if (paidStatusEl.inverse) {
      // fullWidth=true: 전체 너비로 그려서 연속 inverse 시 흰띠 제거
      drawInverse(statusText, y, paidStatusEl, true);
    } else {
      drawText(statusText, y, paidStatusEl);
    }
    y += getFontHeight(paidStatusEl) + 2;  // 아래 여백 축소 (8 → 2)
  }

  // === SEPARATOR 1 ===
  const sep1Spacing = separator1.lineSpacing || 8;  // lineSpacing 지원
  y += sep1Spacing;
  if (separator1.visible) {
    drawLine(y, separator1.style);
    y += 15;
  }

  // === ITEMS BY GUEST ===
  // Group items by guest
  const byGuest = {};
  items.forEach(it => {
    const g = it.guestNumber || 1;
    if (!byGuest[g]) byGuest[g] = [];
    byGuest[g].push(it);
  });
  // 각 게스트 내에서 아이템을 알파벳 오름차순으로 정렬
  Object.keys(byGuest).forEach(g => {
    byGuest[g].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  });

  const guests = Object.keys(byGuest).sort((a, b) => +a - +b);

  guests.forEach((gNum, idx) => {
    // Guest header with decorative dashes: ----GUEST 1----
    // 게스트가 2명 이상일 때만 표시 (1명일 때는 표시 안함)
    if (guestNumberEl.visible && guests.length > 1) {
      // 첫번째 게스트는 위쪽 여백 추가, 이후 게스트는 기존 여백 유지
      if (idx === 0) {
        y += 8;
      } else {
        y += 10;
      }
      
      const guestFs = scaleFontSize(guestNumberEl.fontSize);
      const guestText = `GUEST ${gNum}`;
      ctx.font = `${getFontStyle(guestNumberEl)} ${getFontWeight(guestNumberEl)} ${guestFs}px Arial`;
      const textMetrics = ctx.measureText(guestText);
      const textWidth = textMetrics.width;
      
      if (guestNumberEl.inverse) {
        drawInverse(guestText, y, guestNumberEl);
      } else {
        // Draw with dashes on both sides (한 줄로)
        ctx.textAlign = 'center';
        const centerX = PAPER_WIDTH_PX / 2;
        
        // Left dashes
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(MARGIN, y);
        ctx.lineTo(centerX - textWidth/2 - 10, y);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Guest text
        ctx.fillText(guestText, centerX, y);
        
        // Right dashes
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(centerX + textWidth/2 + 10, y);
        ctx.lineTo(PAPER_WIDTH_PX - MARGIN, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      y += getLineHeight(guestNumberEl) + 10;
    }

    // Items for this guest
    byGuest[gNum].forEach((item, itemIdx) => {
      const qty = item.qty || item.quantity || 1;
      const name = item.name || 'Unknown';
      
      // Item: 위쪽 간격 추가 후 출력 (첫 번째 아이템은 간격 없이)
      const itemSpacing = (idx === 0 && itemIdx === 0) ? 0 : getSpacing(itemsEl);
      console.log(`🔍 [Item Render] Guest ${gNum}, Item ${itemIdx}: "${name}", spacing: ${itemSpacing}px, y before: ${y}`);
      y += itemSpacing;
      const itemFs = scaleFontSize(itemsEl.fontSize);
      ctx.font = `${getFontStyle(itemsEl)} ${getFontWeight(itemsEl)} ${itemFs}px Arial`;
      ctx.textAlign = 'left';
      ctx.fillText(`${qty}x ${name}`, MARGIN, y);
      y += getFontHeight(itemsEl);

      // Modifiers - 위쪽 간격 방식
      if (modifiersEl.visible && item.modifiers?.length) {
        const modFs = scaleFontSize(modifiersEl.fontSize);
        ctx.font = `${getFontStyle(modifiersEl)} ${getFontWeight(modifiersEl)} ${modFs}px Arial`;
        const prefix = modifiersEl.prefix || '>>';
        
        item.modifiers.forEach(modGroup => {
          let modNames = [];
          
          if (modGroup.selectedEntries?.length) {
            modNames = modGroup.selectedEntries.map(e => e.name).filter(Boolean);
          } else if (modGroup.modifierNames?.length) {
            modNames = modGroup.modifierNames.filter(Boolean);
          } else if (modGroup.name) {
            modNames = [modGroup.name];
          } else if (typeof modGroup === 'string') {
            modNames = [modGroup];
          }
          
          modNames.forEach(txt => {
            if (txt) {
              // Modifier: 위쪽 간격 추가 후 출력
              ctx.fillText(`   ${prefix} ${txt}`, MARGIN, y);
              y += getFontHeight(modifiersEl);
            }
          });
        });
      }

      // Item note/memo - 위쪽 간격 방식
      if (itemNoteEl.visible && item.memo) {
        const noteFs = scaleFontSize(itemNoteEl.fontSize);
        ctx.font = `italic ${getFontWeight(itemNoteEl)} ${noteFs}px Arial`;
        const prefix = itemNoteEl.prefix || '->';
        ctx.fillText(`   ${prefix} ${item.memo}`, MARGIN, y);
        y += getFontHeight(itemNoteEl);
      }
    });
  });

  // === KITCHEN NOTE === (Body 하단 고정)
  if (kitchenNoteEl.visible && orderInfo.kitchenNote) {
    const topSpacing = Math.round((kitchenNoteEl.lineSpacing || 1.2) * 10);
    y += topSpacing;
    const kitchenNoteText = `*** ${orderInfo.kitchenNote} ***`;
    if (kitchenNoteEl.inverse) {
      drawInverse(kitchenNoteText, y, kitchenNoteEl);
    } else {
      drawText(kitchenNoteText, y, kitchenNoteEl);
    }
    y += getFontHeight(kitchenNoteEl) + 5;
  }

  // === SEPARATOR 2 ===
  const sep2Spacing = separator2.lineSpacing || 10;  // lineSpacing 지원
  y += sep2Spacing;
  if (separator2.visible) {
    drawLine(y, separator2.style);
    y += 15;
  }

  // === FOOTER SECTION ===
  
  // DateTime in Footer (if showInFooter is true)
  if (dateTimeEl.visible && dateTimeEl.showInFooter) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    drawText(timeStr, y, dateTimeEl);
    y += getLineHeight(dateTimeEl) + 2;
  }

  // === PAID STATUS === (show PAID or UNPAID in Footer if showInFooter is true)
  if (paidStatusEl.visible && paidStatusEl.showInFooter) {
    // Top spacing 적용 (lineSpacing 값 그대로 사용)
    const footerTopSpacing = paidStatusEl.lineSpacing || 0;
    y += footerTopSpacing;
    
    const statusText = isPaid ? 'PAID' : 'UNPAID';
    if (paidStatusEl.inverse) {
      // fullWidth=true: 전체 너비로 그려서 연속 inverse 시 흰띠 제거
      drawInverse(statusText, y, paidStatusEl, true);
    } else {
      drawText(statusText, y, paidStatusEl);
    }
    y += getFontHeight(paidStatusEl) + 10;
  }

  // === SPECIAL INSTRUCTIONS ===
  if (specialInstructionsEl.visible && orderInfo.specialInstructions) {
    const instructionsText = orderInfo.specialInstructions;
    if (specialInstructionsEl.inverse) {
      drawInverse(instructionsText, y, specialInstructionsEl);
    } else {
      drawText(instructionsText, y, specialInstructionsEl);
    }
    y += getLineHeight(specialInstructionsEl) + 10;
  }

  // DEBUG: 하단 여백 확인
  const bottomMargin = totalHeight - y;
  console.log(`🔍 [Bottom Margin DEBUG] y: ${y}, totalHeight: ${totalHeight}, bottomMargin: ${bottomMargin}px (${(bottomMargin / 8).toFixed(1)}mm)`);

  // Convert to ESC/POS bitmap using ESC * command
  return canvasToEscPosBitmap(canvas);
}

// Build ESC/POS content for kitchen ticket
function buildEscPosKitchenTicket(options) {
  const {
    orderInfo = {},
    items = [],
    layoutSettings = {},
    isAdditionalOrder = false,
    isPaid = false,
    isReprint = false,
    printerName = '',  // 프린터 이름 (Front, Sushi Bar, Kitchen 등)
    isServerTicket = false  // Server Ticket 여부 (Front 프린터 = Server Ticket, PAID/UNPAID 출력)
  } = options;
  
  // Extract element settings from layoutSettings
  const orderTypeEl = layoutSettings.orderType || { visible: true, inverse: true };
  const tableNumberEl = layoutSettings.tableNumber || { visible: true, inverse: false };
  const posOrderNumberEl = layoutSettings.posOrderNumber || { visible: true };
  const externalOrderNumberEl = layoutSettings.externalOrderNumber || { visible: true };
  const serverNameEl = layoutSettings.serverName || { visible: true };
  const dateTimeEl = layoutSettings.dateTime || { visible: true };
  const paidStatusEl = layoutSettings.paidStatus || { visible: true, inverse: true };
  const guestNumberEl = layoutSettings.guestNumber || { visible: true, inverse: true };
  const itemsEl = layoutSettings.items || { visible: true };
  const modifiersEl = layoutSettings.modifiers || { visible: true, prefix: '>>' };
  const itemNoteEl = layoutSettings.itemNote || { visible: true, prefix: '->' };
  const specialInstructionsEl = layoutSettings.specialInstructions || { visible: true, fontWeight: 'bold', fontSize: 12 };
  const separator1 = layoutSettings.separator1 || { visible: true, style: 'solid' };
  const separator2 = layoutSettings.separator2 || { visible: true, style: 'solid' };
  const splitSeparator = layoutSettings.splitSeparator || { visible: true, style: 'dashed' };
  
  // Helper function to get separator line
  const getSeparatorLine = (style) => {
    if (style === 'dashed') return ESCPOS.DASHED_LINE;
    if (style === 'double') return ESCPOS.LINE + '\n' + ESCPOS.LINE;
    return ESCPOS.LINE; // solid
  };
  
  // Helper function to apply font size (ESC/POS approximation)
  const applyFontSize = (fontSize) => {
    if (fontSize >= 20) return ESCPOS.DOUBLE_SIZE;
    if (fontSize >= 16) return ESCPOS.DOUBLE_HEIGHT;
    return ESCPOS.NORMAL_SIZE;
  };
  
  // Helper function to render two elements on the same line (merged)
  const LINE_WIDTH = 32; // Standard 80mm thermal printer width in characters
  const renderMergedLine = (leftText, rightText, alignment = 'left-right') => {
    let line = '';
    const leftLen = leftText.length;
    const rightLen = rightText.length;
    
    if (alignment === 'left-right') {
      // Left text on left, right text on right
      const spaces = Math.max(1, LINE_WIDTH - leftLen - rightLen);
      line = leftText + ' '.repeat(spaces) + rightText;
    } else if (alignment === 'left-center') {
      // Left text on left, right text in center-ish
      const centerPos = Math.floor(LINE_WIDTH / 2);
      const leftPad = Math.max(leftLen + 1, centerPos - Math.floor(rightLen / 2));
      const spaces = Math.max(1, leftPad - leftLen);
      line = leftText + ' '.repeat(spaces) + rightText;
    } else if (alignment === 'center-center') {
      // Both centered with gap
      const totalLen = leftLen + rightLen + 2;
      const startPos = Math.floor((LINE_WIDTH - totalLen) / 2);
      line = ' '.repeat(Math.max(0, startPos)) + leftText + '  ' + rightText;
    } else {
      // Default: space between
      const spaces = Math.max(1, LINE_WIDTH - leftLen - rightLen);
      line = leftText + ' '.repeat(spaces) + rightText;
    }
    
    return line.substring(0, LINE_WIDTH); // Trim to line width
  };
  
  // Get merged elements
  const mergedElements = layoutSettings.mergedElements || [];
  const mergedKeys = new Set();
  mergedElements.forEach(m => {
    if (m.leftElement) mergedKeys.add(m.leftElement.key);
    if (m.rightElement) mergedKeys.add(m.rightElement.key);
  });
  
  // Sample data mapping for merged elements
  const getElementValue = (key) => {
    const sampleData = {
      orderType: (orderInfo.orderType || orderInfo.channel || 'DINE-IN').toUpperCase(),
      tableNumber: orderInfo.table || '',
      posOrderNumber: orderInfo.orderNumber ? `#${orderInfo.orderNumber}` : '',
      externalOrderNumber: orderInfo.externalOrderNumber || '',
      serverName: orderInfo.server || '',
      dateTime: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
      paidStatus: isPaid ? 'PAID' : 'UNPAID',
      pickupTime: orderInfo.pickupTime || '',
      deliveryChannel: orderInfo.deliveryChannel || orderInfo.channel || '',
      customerName: orderInfo.customerName || '',
      customerPhone: orderInfo.customerPhone || '',
      deliveryAddress: orderInfo.deliveryAddress || '',
    };
    return sampleData[key] || '';
  };
  
  let content = '';
  
  // Initialize printer
  content += ESCPOS.INIT;
  
  // ===== HEADER SECTION =====
  
  // Printer Name (프린터 이름: Front, Sushi Bar, Kitchen 등)
  if (printerName) {
    content += ESCPOS.ALIGN_CENTER;
    content += ESCPOS.INVERT_ON;
    content += ESCPOS.BOLD_ON;
    content += ` ${printerName} `;
    content += ESCPOS.FEED_LINE;
    content += ESCPOS.INVERT_OFF;
    content += ESCPOS.BOLD_OFF;
    content += ESCPOS.FEED_LINE;
  }
  
  // Reprint banner
  if (isReprint) {
    content += ESCPOS.ALIGN_CENTER;
    content += ESCPOS.INVERT_ON;
    content += ESCPOS.BOLD_ON;
    content += ESCPOS.DOUBLE_SIZE;
    content += ' ** REPRINT ** ';
    content += ESCPOS.FEED_LINE;
    content += ESCPOS.NORMAL_SIZE;
    content += ESCPOS.INVERT_OFF;
    content += ESCPOS.BOLD_OFF;
    content += ESCPOS.LINE + ESCPOS.FEED_LINE;
  }
  
  // Additional order banner (전체 너비 검은 띠)
  if (isAdditionalOrder) {
    content += ESCPOS.ALIGN_CENTER;
    content += ESCPOS.INVERT_ON;
    content += ESCPOS.BOLD_ON;
    content += '      ++ ADDITIONAL ++      ';  // 패딩 추가로 전체 너비 효과
    content += ESCPOS.FEED_LINE;
    content += ESCPOS.INVERT_OFF;
    content += ESCPOS.BOLD_OFF;
    content += ESCPOS.LINE + ESCPOS.FEED_LINE;
  }
  
  // Render a single element
  const renderSingleElement = (key, el, value) => {
    if (!el || el.visible === false) return '';
    if (!value && key !== 'paidStatus') return '';
    
    let out = '';
    out += ESCPOS.ALIGN_CENTER;
    if (el.inverse) out += ESCPOS.INVERT_ON;
    if (el.fontWeight === 'bold') out += ESCPOS.BOLD_ON;
    out += applyFontSize(el.fontSize || 14);
    out += key === 'paidStatus' ? ` ${value} ` : value;
    out += ESCPOS.FEED_LINE;
    out += ESCPOS.NORMAL_SIZE;
    if (el.inverse) out += ESCPOS.INVERT_OFF;
    if (el.fontWeight === 'bold') out += ESCPOS.BOLD_OFF;
    return out;
  };
  
  // Render merged elements (two elements on one line)
  const renderMergedElements = () => {
    let out = '';
    mergedElements.forEach(merged => {
      if (!merged.leftElement || !merged.rightElement) return;
      
      const leftKey = merged.leftElement.key;
      const rightKey = merged.rightElement.key;
      const leftEl = layoutSettings[leftKey] || {};
      const rightEl = layoutSettings[rightKey] || {};
      
      // Skip if both are not visible in header
      if (leftEl.showInHeader === false && rightEl.showInHeader === false) return;
      
      const leftValue = getElementValue(leftKey);
      const rightValue = getElementValue(rightKey);
      
      // Skip if both values are empty
      if (!leftValue && !rightValue) return;
      
      out += ESCPOS.ALIGN_LEFT;
      out += ESCPOS.NORMAL_SIZE;
      
      // Apply bold if either is bold
      if (leftEl.fontWeight === 'bold' || rightEl.fontWeight === 'bold') {
        out += ESCPOS.BOLD_ON;
      }
      
      out += renderMergedLine(leftValue || '', rightValue || '', merged.alignment || 'left-right');
      out += ESCPOS.FEED_LINE;
      
      if (leftEl.fontWeight === 'bold' || rightEl.fontWeight === 'bold') {
        out += ESCPOS.BOLD_OFF;
      }
    });
    return out;
  };
  
  // Render merged elements first (in header)
  content += renderMergedElements();
  
  // Order Type (DINE-IN / TOGO) - skip if merged
  if (!mergedKeys.has('orderType') && orderTypeEl.visible !== false && orderTypeEl.showInHeader !== false) {
    const orderType = (orderInfo.orderType || orderInfo.channel || 'DINE-IN').toUpperCase();
    content += ESCPOS.ALIGN_CENTER;
    if (orderTypeEl.inverse) content += ESCPOS.INVERT_ON;
    if (orderTypeEl.fontWeight === 'bold') content += ESCPOS.BOLD_ON;
    content += applyFontSize(orderTypeEl.fontSize || 20);
    content += ` ${orderType} `;
    content += ESCPOS.FEED_LINE;
    content += ESCPOS.NORMAL_SIZE;
    if (orderTypeEl.inverse) content += ESCPOS.INVERT_OFF;
    if (orderTypeEl.fontWeight === 'bold') content += ESCPOS.BOLD_OFF;
  }
  
  // Table Number - skip if merged
  if (!mergedKeys.has('tableNumber') && tableNumberEl.visible !== false && tableNumberEl.showInHeader !== false && orderInfo.table) {
    content += ESCPOS.ALIGN_CENTER;
    if (tableNumberEl.inverse) content += ESCPOS.INVERT_ON;
    if (tableNumberEl.fontWeight === 'bold') content += ESCPOS.BOLD_ON;
    content += applyFontSize(tableNumberEl.fontSize || 24);
    content += orderInfo.table.toUpperCase();
    content += ESCPOS.FEED_LINE;
    content += ESCPOS.NORMAL_SIZE;
    if (tableNumberEl.inverse) content += ESCPOS.INVERT_OFF;
    if (tableNumberEl.fontWeight === 'bold') content += ESCPOS.BOLD_OFF;
  }
  
  // POS Order Number - skip if merged
  if (!mergedKeys.has('posOrderNumber') && posOrderNumberEl.visible !== false && posOrderNumberEl.showInHeader !== false && orderInfo.orderNumber) {
    content += ESCPOS.ALIGN_CENTER;
    content += applyFontSize(posOrderNumberEl.fontSize || 14);
    content += `Order #: ${orderInfo.orderNumber}`;
    content += ESCPOS.FEED_LINE;
    content += ESCPOS.NORMAL_SIZE;
  }
  
  // External Order Number - skip if merged
  if (!mergedKeys.has('externalOrderNumber') && externalOrderNumberEl.visible !== false && externalOrderNumberEl.showInHeader !== false) {
    content += ESCPOS.ALIGN_CENTER;
    content += applyFontSize(externalOrderNumberEl.fontSize || 12);
    content += `Ext: ${orderInfo.externalOrderNumber || 'N/A'}`;
    content += ESCPOS.FEED_LINE;
    content += ESCPOS.NORMAL_SIZE;
  }
  
  // Server Name - skip if merged
  if (!mergedKeys.has('serverName') && serverNameEl.visible !== false && serverNameEl.showInHeader !== false && orderInfo.server) {
    content += ESCPOS.ALIGN_LEFT;
    content += applyFontSize(serverNameEl.fontSize || 12);
    content += orderInfo.server;
    content += ESCPOS.FEED_LINE;
    content += ESCPOS.NORMAL_SIZE;
  }
  
  // Date/Time - skip if merged
  if (!mergedKeys.has('dateTime') && dateTimeEl.visible !== false && dateTimeEl.showInHeader !== false) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    content += ESCPOS.ALIGN_CENTER;
    content += applyFontSize(dateTimeEl.fontSize || 12);
    content += timeStr;
    content += ESCPOS.FEED_LINE;
    content += ESCPOS.NORMAL_SIZE;
  }
  
  // Paid Status - skip if merged
  // Dine-in: 설정에 따라 출력, Take-out/Online: Server Ticket(Front)에서는 항상 출력
  const escOrderType = (orderInfo.orderType || orderInfo.channel || 'DINE-IN').toUpperCase();
  const escIsDineIn = escOrderType === 'DINE-IN' || escOrderType === 'DINEIN';
  const escShouldShowPaidStatus = !mergedKeys.has('paidStatus') && paidStatusEl.visible !== false && 
                                  (paidStatusEl.showInHeader !== false || (isServerTicket && !escIsDineIn));
  if (escShouldShowPaidStatus) {
    // Top spacing 적용 (lineSpacing 값에 따라 줄바꿈 추가)
    // lineSpacing 1.2 → 0줄, 3 → 1줄, 5 → 1줄, 10 → 2줄
    const escTopLines = Math.floor((paidStatusEl.lineSpacing || 1.2) / 4);
    for (let i = 0; i < escTopLines; i++) {
      content += ESCPOS.FEED_LINE;
    }
    
    const statusText = isPaid ? 'PAID' : 'UNPAID';
    content += ESCPOS.ALIGN_CENTER;
    if (paidStatusEl.inverse) content += ESCPOS.INVERT_ON;
    if (paidStatusEl.fontWeight === 'bold') content += ESCPOS.BOLD_ON;
    content += applyFontSize(paidStatusEl.fontSize || 16);
    content += ` ${statusText} `;
    content += ESCPOS.FEED_LINE;
    content += ESCPOS.NORMAL_SIZE;
    if (paidStatusEl.inverse) content += ESCPOS.INVERT_OFF;
    if (paidStatusEl.fontWeight === 'bold') content += ESCPOS.BOLD_OFF;
  }
  
  // Header separator (separator1)
  if (separator1.visible !== false) {
    content += getSeparatorLine(separator1.style) + ESCPOS.FEED_LINE;
  }
  
  // ===== BODY SECTION =====
  content += ESCPOS.ALIGN_LEFT;
  
  // Group items by guest
  const itemsByGuest = {};
  items.forEach(item => {
    const guestNum = item.guestNumber || 1;
    if (!itemsByGuest[guestNum]) itemsByGuest[guestNum] = [];
    itemsByGuest[guestNum].push(item);
  });
  // 각 게스트 내에서 아이템을 알파벳 오름차순으로 정렬
  Object.keys(itemsByGuest).forEach(guestNum => {
    itemsByGuest[guestNum].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  });
  
  const guestNumbers = Object.keys(itemsByGuest).map(Number).sort((a, b) => a - b);
  const hasMultipleGuests = guestNumbers.length > 1;
  
  guestNumbers.forEach((guestNum, guestIndex) => {
    // Guest separator with decorative dashes
    // 게스트가 2명 이상일 때만 표시 (1명일 때는 표시 안함)
    if (guestNumberEl.visible !== false && hasMultipleGuests) {
      if (guestIndex > 0 && splitSeparator.visible !== false) {
        content += getSeparatorLine(splitSeparator.style) + ESCPOS.FEED_LINE;
      }
      content += ESCPOS.ALIGN_CENTER;
      if (guestNumberEl.inverse) {
        content += ESCPOS.INVERT_ON;
        content += applyFontSize(guestNumberEl.fontSize || 16);
        content += ` GUEST ${guestNum} `;
        content += ESCPOS.INVERT_OFF;
      } else {
        // Decorative dashes: ------GUEST 1------
        content += applyFontSize(guestNumberEl.fontSize || 16);
        content += `------GUEST ${guestNum}------`;
      }
      content += ESCPOS.FEED_LINE;
      content += ESCPOS.NORMAL_SIZE;
      content += ESCPOS.ALIGN_LEFT;
    }
    
    // Items
    if (itemsEl.visible !== false) {
      itemsByGuest[guestNum].forEach(item => {
        const qty = item.qty || item.quantity || 1;
        const name = item.name || 'Unknown Item';
        
        content += applyFontSize(itemsEl.fontSize || 14);
        content += ESCPOS.BOLD_ON;
        content += `${qty}x ${name}`;
        content += ESCPOS.FEED_LINE;
        content += ESCPOS.BOLD_OFF;
        content += ESCPOS.NORMAL_SIZE;
        
        // Modifiers
        // 모디파이어 구조: { groupName, modifierNames: [], selectedEntries: [{ name, price_delta }] }
        if (modifiersEl.visible !== false && item.modifiers && Array.isArray(item.modifiers) && item.modifiers.length > 0) {
          const modPrefix = modifiersEl.prefix || '>>';
          item.modifiers.forEach(modGroup => {
            let modNames = [];
            
            if (modGroup.selectedEntries?.length) {
              modNames = modGroup.selectedEntries.map(e => e.name).filter(Boolean);
            } else if (modGroup.modifierNames?.length) {
              modNames = modGroup.modifierNames.filter(Boolean);
            } else if (modGroup.name) {
              modNames = [modGroup.name];
            } else if (typeof modGroup === 'string') {
              modNames = [modGroup];
            }
            
            modNames.forEach(modName => {
              if (modName) {
                content += applyFontSize(modifiersEl.fontSize || 12);
                content += `   ${modPrefix} ${modName}`;
                content += ESCPOS.FEED_LINE;
                content += ESCPOS.NORMAL_SIZE;
              }
            });
          });
        }
        
        // Notes/Memo
        if (itemNoteEl.visible !== false && item.memo) {
          const notePrefix = itemNoteEl.prefix || '->';
          const memoText = typeof item.memo === 'string' ? item.memo : (item.memo.text || '');
          if (memoText) {
            content += applyFontSize(itemNoteEl.fontSize || 12);
            content += `   ${notePrefix} ${memoText}`;
            content += ESCPOS.FEED_LINE;
            content += ESCPOS.NORMAL_SIZE;
          }
        }
      });
    }
  });
  
  // === KITCHEN NOTE === (Body 하단 고정)
  const kitchenNoteEl = layoutSettings.kitchenNote || { visible: true, fontSize: 14, fontWeight: 'bold' };
  console.log('🍳 [ESC Kitchen Note Debug] printerName:', printerName, 'isServerTicket:', isServerTicket);
  console.log('🍳 [ESC Kitchen Note Debug] layoutSettings.kitchenNote:', JSON.stringify(layoutSettings.kitchenNote));
  console.log('🍳 [ESC Kitchen Note Debug] kitchenNoteEl.visible:', kitchenNoteEl.visible);
  if (kitchenNoteEl.visible !== false && orderInfo.kitchenNote) {
    // Top spacing
    const escKitchenNoteLines = Math.floor((kitchenNoteEl.lineSpacing || 1.2) / 4);
    for (let i = 0; i < escKitchenNoteLines; i++) {
      content += ESCPOS.FEED_LINE;
    }
    
    content += ESCPOS.ALIGN_CENTER;
    if (kitchenNoteEl.inverse) content += ESCPOS.INVERT_ON;
    if (kitchenNoteEl.fontWeight === 'bold' || kitchenNoteEl.fontWeight === 'extrabold') content += ESCPOS.BOLD_ON;
    content += applyFontSize(kitchenNoteEl.fontSize || 14);
    content += `*** ${orderInfo.kitchenNote} ***`;
    content += ESCPOS.FEED_LINE;
    content += ESCPOS.NORMAL_SIZE;
    if (kitchenNoteEl.inverse) content += ESCPOS.INVERT_OFF;
    if (kitchenNoteEl.fontWeight === 'bold' || kitchenNoteEl.fontWeight === 'extrabold') content += ESCPOS.BOLD_OFF;
  }
  
  // Footer separator (separator2)
  if (separator2.visible !== false) {
    content += getSeparatorLine(separator2.style) + ESCPOS.FEED_LINE;
  }
  
  // === FOOTER SECTION ===
  
  // DateTime in Footer (if showInFooter is true)
  if (dateTimeEl.visible !== false && dateTimeEl.showInFooter) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    content += ESCPOS.ALIGN_CENTER;
    content += applyFontSize(dateTimeEl.fontSize || 12);
    content += timeStr;
    content += ESCPOS.FEED_LINE;
    content += ESCPOS.NORMAL_SIZE;
  }
  
  // Paid Status (PAID / UNPAID) in Footer - show if showInFooter is true
  if (paidStatusEl.visible !== false && paidStatusEl.showInFooter) {
    // Top spacing 적용
    const escFooterTopLines = Math.floor((paidStatusEl.lineSpacing || 1.2) / 4);
    for (let i = 0; i < escFooterTopLines; i++) {
      content += ESCPOS.FEED_LINE;
    }
    
    const statusText = isPaid ? 'PAID' : 'UNPAID';
    content += ESCPOS.ALIGN_CENTER;
    if (paidStatusEl.inverse) content += ESCPOS.INVERT_ON;
    if (paidStatusEl.fontWeight === 'bold') content += ESCPOS.BOLD_ON;
    content += applyFontSize(paidStatusEl.fontSize || 16);
    content += ` ${statusText} `;
    content += ESCPOS.FEED_LINE;
    content += ESCPOS.NORMAL_SIZE;
    if (paidStatusEl.inverse) content += ESCPOS.INVERT_OFF;
    if (paidStatusEl.fontWeight === 'bold') content += ESCPOS.BOLD_OFF;
  }
  
  // Special Instructions
  if (specialInstructionsEl.visible !== false && orderInfo.specialInstructions) {
    content += ESCPOS.ALIGN_CENTER;
    if (specialInstructionsEl.fontWeight === 'bold') content += ESCPOS.BOLD_ON;
    content += applyFontSize(specialInstructionsEl.fontSize || 12);
    content += orderInfo.specialInstructions;
    content += ESCPOS.FEED_LINE;
    content += ESCPOS.NORMAL_SIZE;
    if (specialInstructionsEl.fontWeight === 'bold') content += ESCPOS.BOLD_OFF;
  }
  
  // Feed and cut
  content += ESCPOS.FEED_LINES(3);
  content += ESCPOS.CUT;
  
  return content;
}

// Print ESC/POS content to Windows printer using file copy to printer port
async function printEscPosToWindows(printerName, escPosContent) {
  return new Promise((resolve, reject) => {
    const tempFile = path.join(os.tmpdir(), `escpos_${Date.now()}.prn`);
    
    try {
      // Write ESC/POS binary content to temp file using latin1 encoding
      // latin1 preserves byte values 0-255 exactly as-is
      const buffer = Buffer.from(escPosContent, 'latin1');
      fs.writeFileSync(tempFile, buffer);
      console.log(`[ESC/POS] Temp file created: ${tempFile}`);
      console.log(`[ESC/POS] Content length: ${buffer.length} bytes`);
      
      // Use PowerShell script file approach for reliability
      const psScriptFile = path.join(os.tmpdir(), `rawprint_${Date.now()}.ps1`);
      
      const psScript = `
# Read the binary file
$bytes = [System.IO.File]::ReadAllBytes("${tempFile.replace(/\\/g, '\\\\')}")
$printerName = "${printerName}"

# Define the raw printer class
$source = @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DOCINFOW {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int Level, ref DOCINFOW pDocInfo);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);

    public static bool SendBytesToPrinter(string printerName, byte[] bytes) {
        IntPtr hPrinter = IntPtr.Zero;
        DOCINFOW di = new DOCINFOW();
        di.pDocName = "ESC/POS Kitchen Ticket";
        di.pDataType = "RAW";

        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) {
            Console.WriteLine("OpenPrinter failed");
            return false;
        }
        if (!StartDocPrinter(hPrinter, 1, ref di)) {
            Console.WriteLine("StartDocPrinter failed");
            ClosePrinter(hPrinter);
            return false;
        }
        if (!StartPagePrinter(hPrinter)) {
            Console.WriteLine("StartPagePrinter failed");
            EndDocPrinter(hPrinter);
            ClosePrinter(hPrinter);
            return false;
        }
        
        int written = 0;
        bool success = WritePrinter(hPrinter, bytes, bytes.Length, out written);
        Console.WriteLine("WritePrinter: success=" + success + ", written=" + written + "/" + bytes.Length);
        
        EndPagePrinter(hPrinter);
        EndDocPrinter(hPrinter);
        ClosePrinter(hPrinter);
        
        return success && written == bytes.Length;
    }
}
"@

try {
    Add-Type -TypeDefinition $source -Language CSharp -ErrorAction SilentlyContinue
} catch {
    # Type might already exist from previous run
}

$result = [RawPrinterHelper]::SendBytesToPrinter($printerName, $bytes)
if ($result) {
    Write-Output "SUCCESS"
    exit 0
} else {
    Write-Output "FAILED"
    exit 1
}
`;
      
      fs.writeFileSync(psScriptFile, psScript, 'utf8');
      console.log(`[ESC/POS] PowerShell script created: ${psScriptFile}`);
      
      exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psScriptFile}"`, 
        { timeout: 20000 }, 
        (error, stdout, stderr) => {
          console.log(`[ESC/POS] PowerShell stdout: ${stdout.trim()}`);
          if (stderr) console.log(`[ESC/POS] PowerShell stderr: ${stderr.trim()}`);
          
          // Clean up temp files
          try { fs.unlinkSync(tempFile); } catch {}
          try { fs.unlinkSync(psScriptFile); } catch {}
          
          if (stdout.includes('SUCCESS')) {
            console.log('[ESC/POS] Print successful!');
            resolve(true);
          } else if (error) {
            console.error('[ESC/POS] Exec error:', error.message);
            reject(error);
          } else {
            console.error('[ESC/POS] Print failed:', stdout, stderr);
            reject(new Error('Print failed: ' + stdout + stderr));
          }
        }
      );
    } catch (err) {
      console.error('[ESC/POS] Exception:', err.message);
      try { fs.unlinkSync(tempFile); } catch {}
      reject(err);
    }
  });
}

// Create thermal printer instance (for network printers)
function createThermalPrinter(printerName, portType = 'WINDOWS_DIRECT', ip = null) {
  const config = {
    type: PrinterTypes.EPSON,
    characterSet: 'KOREA',
    removeSpecialCharacters: false,
    lineCharacter: '-',
    options: {
      timeout: 5000
    }
  };
  
  if (portType === 'NETWORK' && ip) {
    config.interface = `tcp://${ip}:9100`;
  } else {
    config.interface = `printer:${printerName}`;
  }
  
  return new ThermalPrinter(config);
}

// Windows 시스템 프린터 목록 가져오기
async function getWindowsPrinters() {
  console.log('getWindowsPrinters() called');
  
  // Method 1: PowerShell Get-Printer (Windows 10+)
  try {
    console.log('Method 1: Trying PowerShell Get-Printer...');
    const { stdout, stderr } = await execPromise(
      'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Printer | Select-Object Name, Default | ConvertTo-Json -Compress"',
      { timeout: 10000 }
    );
    
    if (stderr) console.log('PowerShell stderr:', stderr);
    
    if (stdout && stdout.trim()) {
      let printers = JSON.parse(stdout.trim());
      if (!Array.isArray(printers)) printers = [printers];
      
      const result = printers.map(p => ({
        name: p.Name,
        isDefault: p.Default || false
      }));
      console.log(`✅ Found ${result.length} printers via Get-Printer`);
      return result;
    }
  } catch (error) {
    console.log('Get-Printer failed:', error.message);
  }

  // Method 2: PowerShell WMI Query
  try {
    console.log('Method 2: Trying PowerShell WMI...');
    const { stdout } = await execPromise(
      'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-WmiObject -Class Win32_Printer | Select-Object Name, Default | ConvertTo-Json -Compress"',
      { timeout: 10000 }
    );
    
    if (stdout && stdout.trim()) {
      let printers = JSON.parse(stdout.trim());
      if (!Array.isArray(printers)) printers = [printers];
      
      const result = printers.map(p => ({
        name: p.Name,
        isDefault: p.Default || false
      }));
      console.log(`✅ Found ${result.length} printers via WMI`);
      return result;
    }
  } catch (error) {
    console.log('WMI failed:', error.message);
  }

  // Method 3: WMIC (Legacy)
  try {
    console.log('Method 3: Trying WMIC...');
    const { stdout } = await execPromise('wmic printer get name', { timeout: 10000 });
    const lines = stdout.split('\n')
      .map(line => line.trim())
      .filter(line => line && line !== 'Name');
    
    if (lines.length > 0) {
      const result = lines.map(name => ({ name, isDefault: false }));
      console.log(`✅ Found ${result.length} printers via WMIC`);
      return result;
    }
  } catch (error) {
    console.log('WMIC failed:', error.message);
  }

  // Method 4: Registry Query (Last resort)
  try {
    console.log('Method 4: Trying Registry...');
    const { stdout } = await execPromise(
      'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Print\\Printers" /s /v Name 2>nul || reg query "HKEY_CURRENT_USER\\Printers\\Connections" /s 2>nul',
      { timeout: 10000 }
    );
    
    const names = stdout.match(/Name\s+REG_SZ\s+(.+)/gi) || [];
    if (names.length > 0) {
      const result = names.map(line => {
        const match = line.match(/Name\s+REG_SZ\s+(.+)/i);
        return { name: match ? match[1].trim() : 'Unknown', isDefault: false };
      });
      console.log(`✅ Found ${result.length} printers via Registry`);
      return result;
    }
  } catch (error) {
    console.log('Registry failed:', error.message);
  }

  // No printers found
  console.log('❌ No printers found with any method');
  return [];
}

module.exports = (db) => {
  // Helper functions
  const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

  const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

  // ============ SYSTEM PRINTERS ============

  // GET /api/printers/system - Get Windows system printers
  router.get('/system', async (req, res) => {
    try {
      const printers = await getWindowsPrinters();
      res.json(printers);
    } catch (err) {
      console.error('Failed to get system printers:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/printers/open-drawer - Open cash drawer (Till)
  router.post('/open-drawer', async (req, res) => {
    try {
      console.log('🔓 Opening cash drawer...');
      
      // Get the front/receipt printer from database
      // Look for a printer with type 'receipt' or name containing 'front', 'receipt', 'counter'
      let printer = await dbGet(`
        SELECT id, name, selected_printer 
        FROM printers 
        WHERE is_active = 1 
          AND (
            LOWER(type) = 'receipt' 
            OR LOWER(name) LIKE '%front%' 
            OR LOWER(name) LIKE '%receipt%'
            OR LOWER(name) LIKE '%counter%'
          )
        LIMIT 1
      `);
      
      // If no receipt printer found, get any active printer
      if (!printer) {
        printer = await dbGet(`
          SELECT id, name, selected_printer 
          FROM printers 
          WHERE is_active = 1 AND selected_printer IS NOT NULL
          LIMIT 1
        `);
      }
      
      if (!printer || !printer.selected_printer) {
        console.error('❌ No printer configured for cash drawer');
        return res.status(400).json({ 
          success: false, 
          error: 'No printer configured. Please set up a receipt printer in Back Office.' 
        });
      }
      
      const printerName = printer.selected_printer;
      console.log(`🖨️ Using printer: ${printerName}`);
      
      // Send cash drawer kick command
      const drawerCommand = ESCPOS.INIT + ESCPOS.DRAWER_KICK;
      
      await printEscPosToWindows(printerName, drawerCommand);
      
      console.log('✅ Cash drawer opened successfully');
      res.json({ 
        success: true, 
        message: 'Cash drawer opened',
        printer: printerName 
      });
      
    } catch (err) {
      console.error('❌ Failed to open cash drawer:', err);
      res.status(500).json({ 
        success: false, 
        error: err.message || 'Failed to open cash drawer' 
      });
    }
  });

  // POST /api/printers/print-text - Print plain text to receipt printer
  router.post('/print-text', async (req, res) => {
    try {
      const { text, openDrawer = false } = req.body;
      
      if (!text) {
        return res.status(400).json({ success: false, error: 'Text is required' });
      }
      
      console.log('📝 Printing text report...');
      
      // Get the front/receipt printer
      let printer = await dbGet(`
        SELECT id, name, selected_printer 
        FROM printers 
        WHERE is_active = 1 
          AND (
            LOWER(type) = 'receipt' 
            OR LOWER(name) LIKE '%front%' 
            OR LOWER(name) LIKE '%receipt%'
            OR LOWER(name) LIKE '%counter%'
          )
        LIMIT 1
      `);
      
      if (!printer) {
        printer = await dbGet(`
          SELECT id, name, selected_printer 
          FROM printers 
          WHERE is_active = 1 AND selected_printer IS NOT NULL
          LIMIT 1
        `);
      }
      
      if (!printer || !printer.selected_printer) {
        console.error('❌ No printer configured');
        return res.status(400).json({ 
          success: false, 
          error: 'No printer configured' 
        });
      }
      
      const printerName = printer.selected_printer;
      console.log(`🖨️ Printing to: ${printerName}`);
      
      // Build ESC/POS content - pass through text with embedded ESC/POS commands
      let escPosContent = ESCPOS.INIT;
      escPosContent += text;  // Text may contain ESC/POS commands for formatting
      escPosContent += ESCPOS.CUT;
      
      if (openDrawer) {
        escPosContent += ESCPOS.DRAWER_KICK;
      }
      
      await printEscPosToWindows(printerName, escPosContent);
      
      console.log('✅ Text printed successfully');
      res.json({ 
        success: true, 
        message: 'Text printed',
        printer: printerName 
      });
      
    } catch (err) {
      console.error('❌ Print text error:', err);
      res.status(500).json({ 
        success: false, 
        error: err.message || 'Failed to print text' 
      });
    }
  });

  // ============ PRINTER LAYOUT SETTINGS ============

  // Initialize printer_layout_settings table
  db.run(`
    CREATE TABLE IF NOT EXISTS printer_layout_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      settings TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // GET /api/printers/layout-settings - Get printer layout settings
  router.get('/layout-settings', async (req, res) => {
    try {
      const row = await dbGet('SELECT settings FROM printer_layout_settings WHERE id = 1');
      if (row && row.settings) {
        res.json({ success: true, settings: JSON.parse(row.settings) });
      } else {
        res.json({ success: true, settings: null });
      }
    } catch (err) {
      console.error('Failed to get printer layout settings:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/printers/layout-settings - Save printer layout settings
  router.post('/layout-settings', async (req, res) => {
    try {
      const { settings } = req.body;
      const settingsJson = JSON.stringify(settings);
      
      // Upsert: insert or replace
      await dbRun(`
        INSERT INTO printer_layout_settings (id, settings, updated_at) 
        VALUES (1, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET settings = ?, updated_at = CURRENT_TIMESTAMP
      `, [settingsJson, settingsJson]);
      
      console.log('💾 Saved printer layout settings');
      res.json({ success: true });
    } catch (err) {
      console.error('Failed to save printer layout settings:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ============ PRINTERS ============

  // GET /api/printers - Get all printers
  router.get('/', async (req, res) => {
    try {
      const rows = await dbAll(
        'SELECT id, name, type, selected_printer as selectedPrinter, sort_order as sortOrder FROM printers WHERE is_active = 1 ORDER BY sort_order, id'
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/printers - Create new printer
  router.post('/', async (req, res) => {
    const { name, type, selectedPrinter, sortOrder } = req.body;
    try {
      const result = await dbRun(
        'INSERT INTO printers (name, type, selected_printer, sort_order, is_active) VALUES (?, ?, ?, ?, 1)',
        [name || '', type || '', selectedPrinter || '', sortOrder || 0]
      );
      res.json({ id: result.lastID, name, type, selectedPrinter, sortOrder });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/printers/:id - Update printer
  router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { name, type, selectedPrinter, sortOrder } = req.body;
    try {
      await dbRun(
        'UPDATE printers SET name = ?, type = ?, selected_printer = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [name || '', type || '', selectedPrinter || '', sortOrder || 0, id]
      );
      res.json({ success: true, id: parseInt(id), name, type, selectedPrinter, sortOrder });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/printers/:id - Delete printer (soft delete)
  router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
      await dbRun('UPDATE printers SET is_active = 0 WHERE id = ?', [id]);
      // Also remove from all groups
      await dbRun('DELETE FROM printer_group_links WHERE printer_id = ?', [id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/printers/batch - Save all printers at once
  router.post('/batch', async (req, res) => {
    const { printers } = req.body;
    console.log(`POST /api/printers/batch: ${printers?.length} printers`);

    if (!Array.isArray(printers)) {
      return res.status(400).json({ error: 'printers must be an array' });
    }
    try {
      // 1. 기존 데이터 완전 삭제 (하드 삭제)
      await dbRun('DELETE FROM printer_group_links'); // 외래키 제약 때문에 링크 먼저 삭제
      await dbRun('DELETE FROM printers');
      
      // 2. 새 데이터 삽입
      const results = [];
      for (const printer of printers) {
        // ID는 새로 생성되도록 둠 (기존 ID 무시) 또는 그대로 사용
        // 여기서는 안전하게 새로 생성
        const result = await dbRun(
          'INSERT INTO printers (name, type, selected_printer, sort_order, is_active) VALUES (?, ?, ?, ?, 1)',
          [printer.name || '', printer.type || '', printer.selectedPrinter || '', printer.sortOrder || 0]
        );
        results.push({ ...printer, id: result.lastID });
      }
      console.log('Batch save completed (Re-inserted all)');
      res.json(results);
    } catch (err) {
      console.error('Batch save error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ============ PRINTER GROUPS ============

  // GET /api/printers/groups - Get all printer groups
  router.get('/groups', async (req, res) => {
    try {
      const groups = await dbAll(
        'SELECT id, name FROM printer_groups WHERE is_active = 1 ORDER BY name'
      );
      
      // Get printer IDs for each group
      for (const group of groups) {
        const links = await dbAll(
          'SELECT printer_id FROM printer_group_links WHERE group_id = ?',
          [group.id]
        );
        group.printerIds = links.map(l => l.printer_id);
      }
      
      res.json(groups);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/printers/groups - Create new printer group
  router.post('/groups', async (req, res) => {
    const { name, printerIds } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    try {
      const result = await dbRun(
        'INSERT INTO printer_groups (name, is_active) VALUES (?, 1)',
        [name]
      );
      const groupId = result.lastID;
      
      // Link printers to group
      if (printerIds && Array.isArray(printerIds)) {
        for (const printerId of printerIds) {
        await dbRun(
            'INSERT OR IGNORE INTO printer_group_links (group_id, printer_id) VALUES (?, ?)',
            [groupId, printerId]
          );
        }
      }
      
      res.json({ id: groupId, name, printerIds: printerIds || [] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/printers/groups/:id - Update printer group
  router.put('/groups/:id', async (req, res) => {
    const { id } = req.params;
    const { name, printerIds } = req.body;
    try {
      if (name) {
        await dbRun(
          'UPDATE printer_groups SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [name, id]
        );
      }
      
      // Update printer links
      if (printerIds && Array.isArray(printerIds)) {
        // Remove existing links
        await dbRun('DELETE FROM printer_group_links WHERE group_id = ?', [id]);
        // Add new links
      for (const printerId of printerIds) {
          await dbRun(
            'INSERT INTO printer_group_links (group_id, printer_id) VALUES (?, ?)',
            [id, printerId]
          );
        }
      }
      
      res.json({ success: true, id: parseInt(id), name, printerIds });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/printers/groups/:id - Delete printer group (soft delete)
  router.delete('/groups/:id', async (req, res) => {
    const { id } = req.params;
    try {
      await dbRun('UPDATE printer_groups SET is_active = 0 WHERE id = ?', [id]);
      await dbRun('DELETE FROM printer_group_links WHERE group_id = ?', [id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/printers/groups/export - Export all printer groups with printer details (for cloud sync)
  router.get('/groups/export', async (req, res) => {
    try {
      // Get all printers
      const printers = await dbAll(
        'SELECT id, name, type, selected_printer as selectedPrinter FROM printers WHERE is_active = 1'
      );
      
      // Get all groups with their linked printers
      const groups = await dbAll(
        'SELECT id, name FROM printer_groups WHERE is_active = 1 ORDER BY name'
      );
      
      for (const group of groups) {
        const links = await dbAll(
          'SELECT printer_id FROM printer_group_links WHERE group_id = ?',
          [group.id]
        );
        // Get printer details for each linked printer
        group.printers = links.map(link => {
          const printer = printers.find(p => p.id === link.printer_id);
          return printer ? { name: printer.name, type: printer.type, selectedPrinter: printer.selectedPrinter } : null;
        }).filter(Boolean);
      }
      
      res.json({ 
        success: true, 
        groups,
        printers 
      });
    } catch (err) {
      console.error('Export printer groups error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/printers/groups/batch - Save all printer groups at once
  router.post('/groups/batch', async (req, res) => {
    const { groups } = req.body;
    console.log(`POST /api/printers/groups/batch: ${groups?.length} groups`);

    if (!Array.isArray(groups)) {
      return res.status(400).json({ error: 'groups must be an array' });
    }
    try {
      // 1. 기존 데이터 삭제
      await dbRun('DELETE FROM printer_group_links');
      await dbRun('DELETE FROM printer_groups');
      
      const results = [];
      for (const group of groups) {
        // 2. 그룹 삽입
        const result = await dbRun(
          'INSERT INTO printer_groups (name, is_active) VALUES (?, 1)',
          [group.name]
        );
        const groupId = result.lastID;
        
        // 3. 링크 삽입
        if (group.printerIds && Array.isArray(group.printerIds)) {
          for (const printerId of group.printerIds) {
            // printerId가 유효한지 체크하지 않고 넣으면 에러날 수 있으나, 
            // 외래키 제약이 있으면 에러나고 없으면 들어감.
            // 여기서는 무시하고 넣되 에러 로그만 찍음
            try {
                await dbRun(
                'INSERT INTO printer_group_links (group_id, printer_id) VALUES (?, ?)',
                [groupId, printerId]
                );
            } catch (e) {
                console.log(`Failed to link printer ${printerId} to group ${groupId}:`, e.message);
            }
          }
        }
        
        results.push({ ...group, id: groupId });
      }
      res.json(results);
    } catch (err) {
      console.error('Group batch save error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ============ PRINT ============

  // POST /api/printers/print - Print kitchen order items
  router.post('/print', async (req, res) => {
    try {
      const { printerGroupId, items } = req.body;
      
      if (!printerGroupId) {
        return res.status(400).json({ success: false, error: 'printerGroupId is required' });
      }
      
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, error: 'items array is required' });
      }

      // Get printer group ID by name or use as ID
      let groupId;
      if (typeof printerGroupId === 'string') {
        const group = await dbGet(
          'SELECT id FROM printer_groups WHERE name = ? AND is_active = 1',
          [printerGroupId]
        );
        if (group) {
          groupId = group.id;
        } else {
          // Try to parse as number
          groupId = parseInt(printerGroupId);
          if (isNaN(groupId)) {
            return res.status(404).json({ success: false, error: `Printer group "${printerGroupId}" not found` });
          }
        }
      } else {
        groupId = printerGroupId;
      }

      // Get printers in this group
      const links = await dbAll(
        'SELECT printer_id FROM printer_group_links WHERE group_id = ?',
        [groupId]
      );
      
      if (links.length === 0) {
        console.warn(`No printers found for group ${groupId}`);
        return res.json({ success: true, message: 'No printers configured for this group', printed: false });
      }

      const printerIds = links.map(l => l.printer_id);
      const printers = await dbAll(
        'SELECT id, name, type, selected_printer FROM printers WHERE id IN (' + printerIds.map(() => '?').join(',') + ') AND is_active = 1',
        printerIds
      );

      if (printers.length === 0) {
        return res.status(404).json({ success: false, error: 'No active printers found in group' });
      }

      // Load layout settings
      let layoutSettings = null;
      try {
        const settingsRow = await dbGet('SELECT settings FROM printer_layout_settings WHERE id = 1');
        if (settingsRow && settingsRow.settings) {
          layoutSettings = JSON.parse(settingsRow.settings);
        }
      } catch (e) {
        console.warn('Could not load layout settings:', e.message);
      }

      // Extract order info to determine which layout to use
      const orderInfo = req.body.orderInfo || {};
      const orderType = (orderInfo.orderType || orderInfo.channel || '').toUpperCase();
      const orderSource = (orderInfo.orderSource || '').toUpperCase();
      
      // ============ 디버그 로그 ============
      console.log('=== PRINT REQUEST DEBUG ===');
      console.log('orderInfo:', JSON.stringify(orderInfo));
      console.log('orderType:', orderType);
      console.log('orderSource:', orderSource);
      console.log('layoutSettings keys:', layoutSettings ? Object.keys(layoutSettings) : 'null');
      console.log('has externalKitchen:', !!layoutSettings?.externalKitchen);
      console.log('has dineInKitchen:', !!layoutSettings?.dineInKitchen);
      
      // ============ 프린터 레이아웃 선택 로직 ============
      // Kitchen Ticket (Dine-In): 매장 내 식사
      //   - DINE-IN, TABLE-ORDER, QR-ORDER, POS
      // Kitchen Ticket (Takeout): 매장 외
      //   - TOGO, ONLINE, KIOSK, DELIVERY, SKIPTHEDISHES, DOORDASH, UBEREATS 등
      
      const isTakeout = ['TOGO', 'TAKEOUT', 'TO-GO', 'ONLINE', 'KIOSK', 'DELIVERY', 
                         'SKIPTHEDISHES', 'SKIP', 'DOORDASH', 'UBEREATS', 'FANTUAN', 'GRUBHUB'].includes(orderType)
                     || ['TOGO', 'TAKEOUT', 'TO-GO', 'ONLINE', 'SKIPTHEDISHES', 'SKIP', 'DOORDASH', 'UBEREATS', 'FANTUAN', 'GRUBHUB', 'THEZONE'].includes(orderSource);
      
      console.log('isTakeout:', isTakeout);
      
      // 프린터별 레이아웃 선택 함수
      const getLayoutForPrinter = (printerName) => {
        const isServerTicket = (printerName || '').toLowerCase().includes('front');
        console.log(`📋 [getLayoutForPrinter] printerName: "${printerName}", isServerTicket: ${isServerTicket}, isTakeout: ${isTakeout}`);
        
        if (isTakeout) {
          if (isServerTicket) {
            console.log(`📋 [${printerName}] Using externalKitchen.waitressPrinter (Server Ticket)`);
            return layoutSettings?.externalKitchen?.waitressPrinter 
                || layoutSettings?.externalKitchen?.kitchenPrinter 
                || layoutSettings?.externalKitchen 
                || layoutSettings?.kitchenLayout 
                || {};
          } else {
            console.log(`📋 [${printerName}] Using externalKitchen.kitchenPrinter (Kitchen Ticket)`);
            return layoutSettings?.externalKitchen?.kitchenPrinter 
                || layoutSettings?.externalKitchen 
                || layoutSettings?.kitchenLayout 
                || {};
          }
        } else {
          if (isServerTicket) {
            console.log(`📋 [${printerName}] Using dineInKitchen.waitressPrinter (Server Ticket)`);
            return layoutSettings?.dineInKitchen?.waitressPrinter 
                || layoutSettings?.dineInKitchen?.kitchenPrinter 
                || layoutSettings?.dineInKitchen 
                || layoutSettings?.kitchenLayout 
                || {};
          } else {
            console.log(`📋 [${printerName}] Using dineInKitchen.kitchenPrinter (Kitchen Ticket)`);
            return layoutSettings?.dineInKitchen?.kitchenPrinter 
                || layoutSettings?.dineInKitchen 
                || layoutSettings?.kitchenLayout 
                || {};
          }
        }
      };
      
      // 기본 레이아웃 (fallback용)
      let kitchenLayout = isTakeout 
        ? (layoutSettings?.externalKitchen?.kitchenPrinter || layoutSettings?.externalKitchen || layoutSettings?.kitchenLayout || {})
        : (layoutSettings?.dineInKitchen?.kitchenPrinter || layoutSettings?.dineInKitchen || layoutSettings?.kitchenLayout || {});
      
      console.log('=== END DEBUG ===');
      
      // Element visibility and settings
      const orderTypeEl = kitchenLayout.orderType || { visible: true };
      const tableNumberEl = kitchenLayout.tableNumber || { visible: true };
      const posOrderNumberEl = kitchenLayout.posOrderNumber || { visible: true };
      const externalOrderNumberEl = kitchenLayout.externalOrderNumber || { visible: true };
      const serverNameEl = kitchenLayout.serverName || { visible: true };
      const dateTimeEl = kitchenLayout.dateTime || { visible: true };
      const paidStatusEl = kitchenLayout.paidStatus || { visible: true };
      const guestNumberEl = kitchenLayout.guestNumber || { visible: true };
      const itemsEl = kitchenLayout.items || { visible: true };
      const modifiersEl = kitchenLayout.modifiers || { visible: true, prefix: '>>' };
      const itemNoteEl = kitchenLayout.itemNote || { visible: true, prefix: '->' };
      const separator1 = kitchenLayout.separator1 || { visible: true, style: 'solid' };
      const separator2 = kitchenLayout.separator2 || { visible: true, style: 'solid' };

      // Extract additional print options from request
      // (orderInfo already extracted above for layout selection)
      const isAdditionalOrder = req.body.isAdditionalOrder || false;
      const isPaid = req.body.isPaid || false;
      const isReprint = req.body.isReprint || false;

      // Helper functions for text formatting
      const LINE_WIDTH = 32; // Standard 80mm thermal printer width
      const centerText = (text) => {
        const padding = Math.max(0, Math.floor((LINE_WIDTH - text.length) / 2));
        return ' '.repeat(padding) + text;
      };
      const inverseLine = (text) => {
        // For text printers, we'll use brackets to indicate inverse
        return `[${centerText(text).trim()}]`;
      };
      const getSeparator = (style) => {
        if (style === 'dashed') return '- - - - - - - - - - - - - - - -';
        if (style === 'dotted') return '. . . . . . . . . . . . . . . .';
        return '================================';
      };
      const guestSeparator = (guestNum) => {
        const text = `GUEST ${guestNum}`;
        const dashes = '-'.repeat(Math.floor((LINE_WIDTH - text.length - 2) / 2));
        return `${dashes} ${text} ${dashes}`;
      };

      // Format print content using Printer Settings layout
      let printContent = '\n';
      
      // ========== HEADER SECTION ==========
      
      // Reprint banner (inverse)
      if (isReprint) {
        printContent += getSeparator('solid') + '\n';
        printContent += inverseLine('** REPRINT **') + '\n';
        printContent += getSeparator('solid') + '\n';
      }
      
      // Additional order banner (inverse, 전체 너비)
      if (isAdditionalOrder) {
        printContent += getSeparator('solid') + '\n';
        printContent += inverseLine('++ ADDITIONAL ++') + '\n';
        printContent += getSeparator('solid') + '\n';
      }
      
      // Order Type (DINE-IN / TOGO / ONLINE) - inverse, centered
      if (orderTypeEl.visible !== false) {
        const orderType = orderInfo.orderType || orderInfo.channel || 'DINE-IN';
        printContent += inverseLine(orderType.toUpperCase()) + '\n';
      }
      
      // Table Number - large, bold, centered
      if (tableNumberEl.visible !== false && orderInfo.table) {
        printContent += centerText(orderInfo.table.toUpperCase()) + '\n';
      }
      
      // POS Order Number
      if (posOrderNumberEl.visible !== false && orderInfo.orderNumber) {
        printContent += centerText(`Order #: ${orderInfo.orderNumber}`) + '\n';
      }
      
      // External Order Number (for delivery apps)
      if (externalOrderNumberEl.visible !== false && orderInfo.externalOrderNumber) {
        printContent += centerText(`Ext: ${orderInfo.externalOrderNumber}`) + '\n';
      } else if (externalOrderNumberEl.visible !== false) {
        printContent += centerText('Ext: N/A') + '\n';
      }
      
      // Server Name
      if (serverNameEl.visible !== false && orderInfo.server) {
        printContent += `${orderInfo.server}\n`;
      }
      
      // Date/Time
      if (dateTimeEl.visible !== false) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        printContent += centerText(timeStr) + '\n';
      }
      
      // Paid Status (PAID / UNPAID) - inverse
      // Dine-in: showInHeader 설정에 따라 출력, Take-out/Online: 항상 출력
      const textIsDineIn = orderType === 'DINE-IN' || orderType === 'DINEIN' || orderType === '';
      if (paidStatusEl.visible !== false && (paidStatusEl.showInHeader || !textIsDineIn)) {
        const statusText = isPaid ? 'PAID' : 'UNPAID';
        printContent += inverseLine(statusText) + '\n';
      }
      
      // Header End Separator
      if (separator1.visible !== false) {
        printContent += getSeparator(separator1.style) + '\n';
      }
      
      // ========== BODY SECTION ==========
      
      // Group items by guest
      const itemsByGuest = {};
      items.forEach(item => {
        const guestNum = item.guestNumber || 1;
        if (!itemsByGuest[guestNum]) itemsByGuest[guestNum] = [];
        itemsByGuest[guestNum].push(item);
      });
      // 각 게스트 내에서 아이템을 알파벳 오름차순으로 정렬
      Object.keys(itemsByGuest).forEach(guestNum => {
        itemsByGuest[guestNum].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      });
      
      const guestNumbers = Object.keys(itemsByGuest).map(Number).sort((a, b) => a - b);
      const hasMultipleGuests = guestNumbers.length > 1;
      
      guestNumbers.forEach((guestNum, guestIndex) => {
        // Guest separator (only if multiple guests)
        if (hasMultipleGuests && guestNumberEl.visible !== false) {
          if (guestIndex > 0) {
            printContent += '\n';
          }
          printContent += guestSeparator(guestNum) + '\n';
        }
        
        // Items for this guest
        if (itemsEl.visible !== false) {
          itemsByGuest[guestNum].forEach(item => {
            const qty = item.qty || item.quantity || 1;
            const name = item.name || 'Unknown Item';
            printContent += `${qty}x ${name}\n`;
            
            // Modifiers
            if (modifiersEl.visible !== false && item.modifiers && Array.isArray(item.modifiers) && item.modifiers.length > 0) {
              const prefix = modifiersEl.prefix || '>>';
              item.modifiers.forEach(mod => {
                // Modifier 객체에서 이름 추출
                let modName = '';
                if (typeof mod === 'string') {
                  modName = mod;
                } else if (mod.name) {
                  modName = mod.name;
                } else if (mod.text) {
                  modName = mod.text;
                } else if (mod.modifierName) {
                  modName = mod.modifierName;
                } else if (mod.selectedEntries && Array.isArray(mod.selectedEntries)) {
                  modName = mod.selectedEntries.map(e => e.name || e).join(', ');
                } else if (mod.modifierNames && Array.isArray(mod.modifierNames)) {
                  modName = mod.modifierNames.join(', ');
                } else {
                  modName = '';
                }
                if (!modName) return;  // 빈 modifier는 건너뛰기
                printContent += `   ${prefix} ${modName}\n`;
              });
            }
            
            // Notes/Memo
            if (itemNoteEl.visible !== false && item.memo) {
              const prefix = itemNoteEl.prefix || '->';
              const memoText = typeof item.memo === 'string' ? item.memo : (item.memo.text || '');
              if (memoText) {
                printContent += `   ${prefix} ${memoText}\n`;
              }
            }
          });
        }
      });
      
      // Body End Separator
      if (separator2.visible !== false) {
        printContent += getSeparator(separator2.style) + '\n';
      }
      
      // ========== FOOTER SECTION ==========
      
      // DateTime in Footer (if showInFooter is true)
      if (dateTimeEl.visible !== false && dateTimeEl.showInFooter) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        printContent += centerText(timeStr) + '\n';
      }
      
      // Paid Status in Footer (PAID / UNPAID)
      if (paidStatusEl.visible !== false && paidStatusEl.showInFooter) {
        const statusText = isPaid ? 'PAID' : 'UNPAID';
        printContent += inverseLine(statusText) + '\n';
      }
      
      // Special Instructions in Footer
      const specialInstructionsEl = kitchenLayout.specialInstructions || { visible: true };
      if (specialInstructionsEl.visible !== false && orderInfo.specialInstructions) {
        printContent += centerText(orderInfo.specialInstructions) + '\n';
      }
      
      printContent += '\n';

      // Get print mode from layout settings (default: graphic)
      const printMode = kitchenLayout.printMode || 'graphic';
      
      // Print to all printers in the group
      const printPromises = printers.map(async (printer) => {
        const windowsPrinterName = printer.selected_printer || printer.name;
        const displayPrinterName = printer.name;  // 프린터 표시 이름 (Front, Sushi Bar, Kitchen 등)
        
        // 프린터별 레이아웃 선택 (Server Ticket vs Kitchen Ticket)
        const printerLayout = getLayoutForPrinter(displayPrinterName);
        const isServerTicket = (displayPrinterName || '').toLowerCase().includes('front');
        const printerPrintMode = printerLayout.printMode || 'graphic';
        
        console.log(`🖨️ Printing to ${windowsPrinterName} (display: ${displayPrinterName}, mode: ${printerPrintMode}, isServerTicket: ${isServerTicket})`);
        
        try {
          if (printerPrintMode === 'graphic') {
            // ========== ROLL GRAPHIC MODE ==========
            try {
              // Try image-based printing (high quality) using ESC * command
              const imageContent = buildImageKitchenTicket({
                orderInfo,
                items,
                layoutSettings: printerLayout,
                isAdditionalOrder,
                isPaid,
                isReprint,
                paperWidth: printerLayout.paperWidth || 80,
                printerName: displayPrinterName,  // 프린터 이름 전달
                isServerTicket  // Server Ticket 여부
              });
              
              if (imageContent) {
                console.log(`🖨️ Using IMAGE-BASED (ESC *) high quality mode for ${windowsPrinterName}`);
                console.log(`🖨️ Image data size: ${imageContent.length} bytes`);
                try {
                  await printEscPosToWindows(windowsPrinterName, imageContent);
                  console.log(`✅ Image-based print success: ${windowsPrinterName}`);
                  return { printer: windowsPrinterName, success: true, mode: 'image' };
                } catch (imgErr) {
                  console.warn(`⚠️ Image mode failed, falling back to text: ${imgErr.message}`);
                }
              }
              
              // Fallback to text-based ESC/POS
              console.log(`🖨️ Using ESC/POS text mode for ${windowsPrinterName}`);
              const escPosContent = buildEscPosKitchenTicket({
                orderInfo,
                items,
                layoutSettings: printerLayout,
                isAdditionalOrder,
                isPaid,
                isReprint,
                printerName: displayPrinterName,  // 프린터 이름 전달
                isServerTicket  // Server Ticket 여부
              });
              
              // Send to printer using RAW mode
              await printEscPosToWindows(windowsPrinterName, escPosContent);
              
              console.log(`✅ ESC/POS print success: ${windowsPrinterName}`);
              return { printer: windowsPrinterName, success: true, mode: 'graphic' };
              
            } catch (thermalErr) {
              console.error(`❌ ESC/POS print failed for ${windowsPrinterName}:`, thermalErr.message);
              // Fallback to text mode if ESC/POS fails
              console.log(`⚠️ Falling back to text mode for ${windowsPrinterName}`);
            }
          }
          
          // ========== TEXT MODE (Fallback or explicit) ==========
          if (process.platform === 'win32' && windowsPrinterName) {
            const tempFile = path.join(os.tmpdir(), `print_${Date.now()}.txt`);
            
            fs.writeFileSync(tempFile, printContent, 'utf8');
            
            try {
              await execPromise(
                `powershell -Command "Get-Content '${tempFile}' | Out-Printer -Name '${windowsPrinterName}'"`,
                { timeout: 10000 }
              );
              fs.unlinkSync(tempFile);
              return { printer: windowsPrinterName, success: true, mode: 'text' };
            } catch (printErr) {
              console.error(`Failed to print to ${windowsPrinterName}:`, printErr.message);
              try { fs.unlinkSync(tempFile); } catch {}
              return { printer: windowsPrinterName, success: false, error: printErr.message };
            }
          } else {
            console.log(`📝 Console output for ${windowsPrinterName}:\n${printContent}`);
            return { printer: windowsPrinterName, success: true, mode: 'console' };
          }
        } catch (err) {
          console.error(`Print error for ${windowsPrinterName}:`, err);
          return { printer: windowsPrinterName, success: false, error: err.message };
        }
      });

      const results = await Promise.all(printPromises);
      const successCount = results.filter(r => r.success).length;

      res.json({
        success: true,
        message: `Printed to ${successCount}/${printers.length} printers`,
        results,
        printed: successCount > 0
      });
    } catch (err) {
      console.error('Print error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ============ PRINT ORDER (통합 출력) ============
  // POST /api/printers/print-order - 전체 주문을 프린터별로 통합하여 출력
  router.post('/print-order', async (req, res) => {
    try {
      const { orderInfo = {}, items = [], isAdditionalOrder = false, isPaid = false, isReprint = false } = req.body;

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, error: 'items array is required' });
      }

      console.log('=== PRINT-ORDER REQUEST ===');
      console.log('orderInfo:', JSON.stringify(orderInfo));
      console.log('items count:', items.length);
      console.log('isReprint:', isReprint);

      // 1. 각 아이템의 프린터 그룹에서 실제 프린터 조회하여 프린터별로 그룹화
      const printerItemsMap = new Map(); // printerId -> { printer, items: [], printerGroupNames: Set }
      
      // ============ Front 프린터 (Server Ticket): 모든 아이템 출력 ============
      // Front 프린터를 먼저 찾아서 모든 아이템을 추가
      const allActivePrinters = await dbAll(
        `SELECT id, name, type, selected_printer FROM printers 
         WHERE is_active = 1 AND selected_printer IS NOT NULL AND selected_printer != ''`
      );
      
      for (const printer of allActivePrinters) {
        const isFrontPrinter = (printer.name || '').toLowerCase().includes('front');
        
        if (isFrontPrinter) {
          // Front 프린터에는 모든 아이템 추가
          console.log(`📋 Front 프린터 "${printer.name}" - 모든 아이템 (${items.length}개) 추가`);
          printerItemsMap.set(printer.id, {
            printer,
            items: items.map(item => ({
              ...item,
              guestNumber: item.guestNumber || 1,
              printerGroupName: 'All Items'
            })),
            printerGroupNames: new Set(['All Items'])
          });
        }
      }
      
      // ============ Kitchen/Bar 프린터: 프린터 그룹에 연결된 아이템만 출력 ============
      for (const item of items) {
        let printerGroupIds = Array.isArray(item.printerGroupIds) ? [...item.printerGroupIds] : 
                              Array.isArray(item.printer_groups) ? [...item.printer_groups] : [];
        
        // 1. 전달받은 printerGroupIds가 없고 item.id가 있으면 아이템 자체의 프린터 그룹 조회
        if (printerGroupIds.length === 0 && item.id && item.id !== 0) {
          const itemPrinterLinks = await dbAll(
            'SELECT printer_group_id FROM menu_printer_links WHERE item_id = ?',
            [item.id]
          );
          if (itemPrinterLinks && itemPrinterLinks.length > 0) {
            printerGroupIds = itemPrinterLinks.map(l => l.printer_group_id);
          }
        }
        
        // 2. 아직 없으면 카테고리에서 프린터 그룹 조회
        if (printerGroupIds.length === 0 && item.id && item.id !== 0) {
          const menuItem = await dbGet('SELECT category_id FROM menu_items WHERE item_id = ?', [item.id]);
          if (menuItem && menuItem.category_id) {
            const categoryPrinterLinks = await dbAll(
              'SELECT printer_group_id FROM category_printer_links WHERE category_id = ?',
              [menuItem.category_id]
            );
            if (categoryPrinterLinks && categoryPrinterLinks.length > 0) {
              printerGroupIds = categoryPrinterLinks.map(l => l.printer_group_id);
            }
          }
        }
        
        // 3. 그래도 없으면 (item.id가 0이거나 프린터 그룹 없음) Kitchen 기본 그룹 사용
        if (printerGroupIds.length === 0) {
          const defaultGroup = await dbGet("SELECT id FROM printer_groups WHERE name = 'Kitchen' AND is_active = 1");
          if (defaultGroup) {
            printerGroupIds.push(defaultGroup.id);
            console.log(`⚠️ 아이템 "${item.name}" (id: ${item.id}) - 프린터 그룹 없음, 기본 Kitchen 사용`);
          } else {
            // Kitchen도 없으면 첫 번째 활성 프린터 그룹 사용
            const anyGroup = await dbGet("SELECT id, name FROM printer_groups WHERE is_active = 1 LIMIT 1");
            if (anyGroup) {
              printerGroupIds.push(anyGroup.id);
              console.log(`⚠️ 아이템 "${item.name}" (id: ${item.id}) - 기본 프린터 그룹 "${anyGroup.name}" 사용`);
            }
          }
        }

        for (const groupId of printerGroupIds) {
          // 프린터 그룹 정보 조회
          const printerGroup = await dbGet('SELECT id, name FROM printer_groups WHERE id = ? AND is_active = 1', [groupId]);
          if (!printerGroup) continue;

          // 해당 그룹에 연결된 프린터들 조회
          const printerLinks = await dbAll('SELECT printer_id FROM printer_group_links WHERE group_id = ?', [groupId]);
          
          for (const link of printerLinks) {
            const printer = await dbGet(
              'SELECT id, name, type, selected_printer FROM printers WHERE id = ? AND is_active = 1',
              [link.printer_id]
            );
            if (!printer || !printer.selected_printer) continue;
            
            // Front 프린터는 이미 모든 아이템이 추가되었으므로 건너뜀
            const isFrontPrinter = (printer.name || '').toLowerCase().includes('front');
            if (isFrontPrinter) continue;

            // 프린터별로 아이템 그룹화 (Kitchen/Bar 등)
            if (!printerItemsMap.has(printer.id)) {
              printerItemsMap.set(printer.id, {
                printer,
                items: [],
                printerGroupNames: new Set()
              });
            }
            
            const printerData = printerItemsMap.get(printer.id);
            
            // 중복 아이템 체크 (같은 아이템이 여러 그룹에 속할 수 있음)
            const existingItem = printerData.items.find(i => 
              i.id === item.id && 
              i.guestNumber === (item.guestNumber || 1) &&
              JSON.stringify(i.modifiers || []) === JSON.stringify(item.modifiers || [])
            );
            
            if (!existingItem) {
              printerData.items.push({
                ...item,
                guestNumber: item.guestNumber || 1,
                printerGroupName: printerGroup.name // 정렬용
              });
            }
            
            printerData.printerGroupNames.add(printerGroup.name);
          }
        }
      }

      console.log('Printers to print:', Array.from(printerItemsMap.keys()).map(id => {
        const data = printerItemsMap.get(id);
        return `${data.printer.name} (${data.items.length} items)`;
      }));

      if (printerItemsMap.size === 0) {
        return res.json({ success: true, message: 'No printers configured', printed: false });
      }

      // 2. 게스트 유무 확인
      const hasMultipleGuests = items.some(item => (item.guestNumber || 1) > 1);
      console.log('hasMultipleGuests:', hasMultipleGuests);

      // 3. 각 프린터별로 아이템 정렬 및 출력
      const results = [];

      for (const [printerId, printerData] of printerItemsMap) {
        const { printer, items: printerItems } = printerData;
        
        // 정렬
        let sortedItems;
        if (hasMultipleGuests) {
          // 게스트 있을 때: 1) 게스트 번호 순서, 2) 게스트 내에서 아이템 이름 알파벳 오름차순
          sortedItems = [...printerItems].sort((a, b) => {
            const guestDiff = (a.guestNumber || 1) - (b.guestNumber || 1);
            if (guestDiff !== 0) return guestDiff;
            // 같은 게스트 내에서 아이템 이름 알파벳 순
            return (a.name || '').localeCompare(b.name || '');
          });
        } else {
          // 게스트 없을 때: 1) 프린터 그룹 이름 알파벳 순, 2) 그룹 내에서 아이템 이름 알파벳 순
          sortedItems = [...printerItems].sort((a, b) => {
            const groupDiff = (a.printerGroupName || '').localeCompare(b.printerGroupName || '');
            if (groupDiff !== 0) return groupDiff;
            // 같은 프린터 그룹 내에서 아이템 이름 알파벳 순
            return (a.name || '').localeCompare(b.name || '');
          });
        }

        console.log(`Printing to ${printer.name} (${printer.selected_printer}): ${sortedItems.length} items`);

        // 레이아웃 설정 로드
        let layoutSettings = null;
        try {
          const settingsRow = await dbGet('SELECT settings FROM printer_layout_settings WHERE id = 1');
          if (settingsRow && settingsRow.settings) {
            layoutSettings = JSON.parse(settingsRow.settings);
          }
        } catch (e) {
          console.warn('Could not load layout settings:', e.message);
        }

        // Dine-In/Takeout 구분
        const orderType = (orderInfo.orderType || orderInfo.channel || '').toUpperCase();
        const orderSource = (orderInfo.orderSource || '').toUpperCase();
        const isTakeout = ['TOGO', 'TAKEOUT', 'TO-GO', 'ONLINE', 'KIOSK', 'DELIVERY', 
                          'SKIPTHEDISHES', 'SKIP', 'DOORDASH', 'UBEREATS', 'FANTUAN', 'GRUBHUB'].includes(orderType)
                      || ['TOGO', 'TAKEOUT', 'TO-GO', 'ONLINE', 'SKIPTHEDISHES', 'SKIP', 'DOORDASH', 'UBEREATS', 'FANTUAN', 'GRUBHUB', 'THEZONE'].includes(orderSource);

        // Server Ticket 여부 판단 (Front 프린터 = Server Ticket)
        const isServerTicket = (printer.name || '').toLowerCase().includes('front');
        console.log(`📋 [group print] printer.name: "${printer.name}", isServerTicket: ${isServerTicket}, isTakeout: ${isTakeout}`);

        // 프린터 유형에 따라 적절한 레이아웃 설정 선택
        // Server Ticket (Front 프린터) → waitressPrinter 설정 사용
        // Kitchen Ticket → kitchenPrinter 설정 사용
        let kitchenLayout;
        if (isTakeout) {
          if (isServerTicket) {
            // Takeout Server Ticket → externalKitchen.waitressPrinter
            kitchenLayout = layoutSettings?.externalKitchen?.waitressPrinter 
                         || layoutSettings?.externalKitchen?.kitchenPrinter 
                         || layoutSettings?.externalKitchen 
                         || layoutSettings?.kitchenLayout 
                         || {};
            console.log('📋 Using externalKitchen.waitressPrinter (Server Ticket)');
          } else {
            // Takeout Kitchen Ticket → externalKitchen.kitchenPrinter
            kitchenLayout = layoutSettings?.externalKitchen?.kitchenPrinter 
                         || layoutSettings?.externalKitchen 
                         || layoutSettings?.kitchenLayout 
                         || {};
            console.log('📋 Using externalKitchen.kitchenPrinter (Kitchen Ticket)');
          }
        } else {
          if (isServerTicket) {
            // Dine-In Server Ticket → dineInKitchen.waitressPrinter
            kitchenLayout = layoutSettings?.dineInKitchen?.waitressPrinter 
                         || layoutSettings?.dineInKitchen?.kitchenPrinter 
                         || layoutSettings?.dineInKitchen 
                         || layoutSettings?.kitchenLayout 
                         || {};
            console.log('📋 Using dineInKitchen.waitressPrinter (Server Ticket)');
          } else {
            // Dine-In Kitchen Ticket → dineInKitchen.kitchenPrinter
            kitchenLayout = layoutSettings?.dineInKitchen?.kitchenPrinter 
                         || layoutSettings?.dineInKitchen 
                         || layoutSettings?.kitchenLayout 
                         || {};
            console.log('📋 Using dineInKitchen.kitchenPrinter (Kitchen Ticket)');
          }
        }
        
        console.log(`🍳 [group print] kitchenLayout.kitchenNote:`, JSON.stringify(kitchenLayout.kitchenNote));

        // 출력 모드 결정
        const printMode = kitchenLayout.printMode || 'graphic';

        try {
          let printResult;
          if (printMode === 'graphic') {
            // 이미지 모드 출력
            const ticketImage = buildImageKitchenTicket({
              orderInfo,
              items: sortedItems,
              layoutSettings: kitchenLayout,
              isAdditionalOrder,
              isPaid,
              isReprint,
              printerName: '',  // 프린터 이름 출력 안함
              showGuestSeparator: hasMultipleGuests,  // 게스트 구분 표시 여부
              isServerTicket  // Server Ticket 여부 (Front 프린터만 PAID/UNPAID 출력)
            });

            await printEscPosToWindows(printer.selected_printer, ticketImage);
            printResult = { printer: printer.selected_printer, success: true, mode: 'image' };
          } else {
            // 텍스트 모드 출력
            const escPosContent = buildEscPosKitchenTicket({
              orderInfo,
              items: sortedItems,
              layoutSettings: kitchenLayout,
              isAdditionalOrder,
              isPaid,
              isReprint,
              printerName: '',  // 프린터 이름 출력 안함
              isServerTicket  // Server Ticket 여부 (Front 프린터만 PAID/UNPAID 출력)
            });

            await printEscPosToWindows(printer.selected_printer, escPosContent);
            printResult = { printer: printer.selected_printer, success: true, mode: 'text' };
          }

          results.push(printResult);
        } catch (printError) {
          console.error(`Print error for ${printer.name}:`, printError);
          results.push({ printer: printer.selected_printer, success: false, error: printError.message });
        }
      }

      const successCount = results.filter(r => r.success).length;

      // ============ 배달 주문(Delivery) Bill + Receipt 자동 출력 ============
      // tryotter, Urban Piper를 통한 배달 주문 (UberEats, DoorDash, SkipTheDishes 등)
      // 이미 결제가 완료된 상태이므로 Bill과 Receipt를 함께 출력
      const deliveryChannels = ['DOORDASH', 'UBEREATS', 'SKIPTHEDISHES', 'SKIP', 'FANTUAN', 'GRUBHUB', 'DELIVERY'];
      const currentOrderSource = (orderInfo.orderSource || orderInfo.deliveryChannel || orderInfo.channel || '').toUpperCase();
      const currentOrderType = (orderInfo.orderType || '').toUpperCase();
      const isDeliveryOrder = deliveryChannels.includes(currentOrderSource) || 
                              deliveryChannels.includes(currentOrderType) ||
                              currentOrderType === 'DELIVERY';

      if (isDeliveryOrder && !isReprint) {
        console.log(`🚚 Delivery order detected (${currentOrderSource || currentOrderType}) - printing Bill and Receipt`);
        
        try {
          const http = require('http');
          
          // Bill/Receipt 데이터 구성
          const subtotal = items.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0);
          const taxLines = orderInfo.taxBreakdown || [];
          const taxTotal = orderInfo.tax || taxLines.reduce((sum, t) => sum + (t.amount || 0), 0);
          const total = orderInfo.total || (subtotal + taxTotal);

          const billData = {
            header: {
              orderNumber: orderInfo.orderNumber || orderInfo.externalOrderNumber || '',
              channel: currentOrderSource || currentOrderType || 'DELIVERY',
              tableName: currentOrderSource || 'DELIVERY',
              serverName: ''
            },
            orderInfo: {
              channel: currentOrderSource || currentOrderType || 'DELIVERY',
              tableName: currentOrderSource || 'DELIVERY',
              serverName: '',
              customerName: orderInfo.customerName || '',
              customerPhone: orderInfo.customerPhone || ''
            },
            items: items.map(item => ({
              name: item.name || 'Unknown',
              quantity: item.quantity || 1,
              price: item.price || 0,
              totalPrice: (item.price || 0) * (item.quantity || 1),
              modifiers: (item.modifiers || []).map(mod => ({
                name: mod.name || '',
                price: mod.price || 0
              }))
            })),
            guestSections: [],
            subtotal: subtotal,
            adjustments: [],
            taxLines: taxLines,
            taxesTotal: taxTotal,
            total: total,
            footer: {}
          };

          // Print Bill via internal API
          const billPrintData = JSON.stringify({ billData });
          const billReq = http.request({
            hostname: 'localhost',
            port: 3177,
            path: '/api/printers/print-bill',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(billPrintData)
            }
          }, (billRes) => {
            let responseData = '';
            billRes.on('data', chunk => { responseData += chunk; });
            billRes.on('end', () => {
              console.log(`🧾 Delivery Bill printed: ${orderInfo.orderNumber}`);
            });
          });
          billReq.on('error', (err) => {
            console.error('🧾 Delivery Bill print error:', err.message);
          });
          billReq.write(billPrintData);
          billReq.end();

          // Print Receipt via internal API (with payment info)
          const receiptData = {
            ...billData,
            payments: [{
              method: orderInfo.paymentMethod || 'Online Payment',
              amount: total
            }],
            change: 0
          };
          
          const receiptPrintData = JSON.stringify({ receiptData });
          const receiptReq = http.request({
            hostname: 'localhost',
            port: 3177,
            path: '/api/printers/print-receipt',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(receiptPrintData)
            }
          }, (receiptRes) => {
            let responseData = '';
            receiptRes.on('data', chunk => { responseData += chunk; });
            receiptRes.on('end', () => {
              console.log(`🧾 Delivery Receipt printed: ${orderInfo.orderNumber}`);
            });
          });
          receiptReq.on('error', (err) => {
            console.error('🧾 Delivery Receipt print error:', err.message);
          });
          receiptReq.write(receiptPrintData);
          receiptReq.end();

        } catch (deliveryPrintErr) {
          console.error('🧾 Delivery Bill/Receipt print error (ignored):', deliveryPrintErr.message);
        }
      }

      res.json({
        success: successCount > 0,
        message: `Printed to ${successCount}/${results.length} printers`,
        results,
        printed: successCount > 0
      });

    } catch (err) {
      console.error('Print-order error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ============ PRINT BILL ============
  
  // POST /api/printers/print-bill - Print bill/pre-bill using billLayout settings
  // copies: 출력 매수 (기본값 2장)
  router.post('/print-bill', async (req, res) => {
    try {
      const { billData, copies = 2 } = req.body;
      
      if (!billData) {
        return res.status(400).json({ success: false, error: 'billData is required' });
      }

      const numCopies = Math.max(1, Math.min(5, copies)); // 1~5장 제한
      console.log(`📄 Print Bill request received (${numCopies} copies)`);

      // Load layout settings
      let layoutSettings = null;
      try {
        const settingsRow = await dbGet('SELECT settings FROM printer_layout_settings WHERE id = 1');
        if (settingsRow && settingsRow.settings) {
          layoutSettings = JSON.parse(settingsRow.settings);
        }
      } catch (e) {
        console.warn('Could not load layout settings:', e.message);
      }

      const billLayout = layoutSettings?.billLayout || {};
      const printMode = billLayout.printMode || 'text';
      const paperWidth = billLayout.paperWidth || 80;

      // Get business profile from Back Office -> Business Info
      let businessProfile = null;
      try {
        businessProfile = await dbGet('SELECT * FROM business_profile WHERE id = 1');
      } catch (e) {
        console.warn('Could not load business profile:', e.message);
      }

      // Build store info from business profile (fallback to billLayout text if not set)
      const storeInfo = {
        name: businessProfile?.business_name || billLayout.storeName?.text || 'Restaurant',
        address: [
          businessProfile?.address_line1,
          businessProfile?.address_line2,
          businessProfile?.city,
          businessProfile?.state,
          businessProfile?.zip
        ].filter(Boolean).join(', ') || billLayout.storeAddress?.text || '',
        phone: businessProfile?.phone || billLayout.storePhone?.text || ''
      };

      console.log('📋 Store Info:', storeInfo);

      // Get receipt/front printer
      let printer = await dbGet(`
        SELECT id, name, selected_printer 
        FROM printers 
        WHERE is_active = 1 
          AND (
            LOWER(type) = 'receipt' 
            OR LOWER(name) LIKE '%front%' 
            OR LOWER(name) LIKE '%receipt%'
            OR LOWER(name) LIKE '%counter%'
          )
        LIMIT 1
      `);
      
      if (!printer) {
        printer = await dbGet(`
          SELECT id, name, selected_printer 
          FROM printers 
          WHERE is_active = 1 AND selected_printer IS NOT NULL
          LIMIT 1
        `);
      }
      
      if (!printer || !printer.selected_printer) {
        console.error('❌ No printer configured for bill printing');
        return res.status(400).json({ 
          success: false, 
          error: 'No printer configured. Please set up a receipt printer in Back Office.' 
        });
      }

      const printerName = printer.selected_printer;
      console.log(`🖨️ Using printer: ${printerName}`);

      // Extract bill data
      const {
        header = {},
        orderInfo = {},
        items = [],
        guestSections = [],
        subtotal = 0,
        adjustments = [],
        taxLines = [],
        taxesTotal = 0,
        total = 0,
        footer = {}
      } = billData;

      // Debug: Log adjustments received
      console.log(`🧾 [print-bill] Received billData - subtotal: $${subtotal}, total: $${total}`);
      console.log(`🧾 [print-bill] Adjustments received: ${JSON.stringify(adjustments)}`);
      console.log(`🧾 [print-bill] billLayout.discount settings: ${JSON.stringify(billLayout.discount)}`);
      if (adjustments.length === 0) {
        console.log(`⚠️ [print-bill] No adjustments in billData - discount line will not be printed`);
      }

      // Build ESC/POS content for text mode (or as fallback)
      // 80mm = 42 chars (normal), 58mm = 32 chars (normal)
      // DOUBLE_SIZE uses 2x width, so effective chars = LINE_WIDTH / 2
      const LINE_WIDTH = paperWidth === 80 ? 42 : 32;
      const buildTextBill = () => {
        let content = '';
        
        const centerText = (text, useDouble = false) => {
          const effectiveWidth = useDouble ? Math.floor(LINE_WIDTH / 2) : LINE_WIDTH;
          const truncatedText = text.length > effectiveWidth ? text.substring(0, effectiveWidth - 2) + '..' : text;
          const padding = Math.max(0, Math.floor((effectiveWidth - truncatedText.length) / 2));
          return ' '.repeat(padding) + truncatedText;
        };
        
        const leftRightText = (left, right, useDouble = false) => {
          const effectiveWidth = useDouble ? Math.floor(LINE_WIDTH / 2) : LINE_WIDTH;
          const rightLen = right.length;
          // Minimum 1 space between left and right
          const maxLeftLen = effectiveWidth - rightLen - 1;
          const truncatedLeft = left.length > maxLeftLen ? left.substring(0, maxLeftLen - 2) + '..' : left;
          // Use exactly 1 space between truncated left and right (no extra padding)
          const spaces = Math.max(1, effectiveWidth - truncatedLeft.length - rightLen);
          // Ensure we don't exceed effective width
          const totalLen = truncatedLeft.length + spaces + rightLen;
          const finalSpaces = totalLen > effectiveWidth ? 1 : spaces;
          return truncatedLeft + ' '.repeat(finalSpaces) + right;
        };
        
        const getSeparator = (style, useDouble = false) => {
          const width = useDouble ? Math.floor(LINE_WIDTH / 2) : LINE_WIDTH;
          if (style === 'dashed') return '-'.repeat(width);
          if (style === 'dotted') return '.'.repeat(width);
          return '='.repeat(width);
        };
        
        // Helper to apply font size/weight from billLayout
        // Returns { prefix, suffix, isDoubleWidth } to help with text width calculations
        const applyFontStyle = (element) => {
          let prefix = '';
          let suffix = '';
          let isDoubleWidth = false;
          const fontSize = element?.fontSize || 12;
          const fontWeight = element?.fontWeight || 'normal';
          
          // Use DOUBLE_SIZE for larger fonts (>= 14) - this doubles width
          if (fontSize >= 14) {
            prefix += ESCPOS.DOUBLE_SIZE;
            suffix = ESCPOS.NORMAL_SIZE + suffix;
            isDoubleWidth = true;
          } else if (fontSize >= 12) {
            // DOUBLE_HEIGHT only - width stays the same
            prefix += ESCPOS.DOUBLE_HEIGHT;
            suffix = ESCPOS.NORMAL_SIZE + suffix;
          }
          
          // Apply bold
          if (fontWeight === 'bold') {
            prefix += ESCPOS.BOLD_ON;
            suffix = ESCPOS.BOLD_OFF + suffix;
          }
          
          return { prefix, suffix, isDoubleWidth };
        };

        // Initialize
        content += ESCPOS.INIT;
        
        // Header - Store Info (from Business Profile) - use billLayout fontSize
        // Store Name이 길면 여러 줄로 분할 (공백 또는 문자 단위)
        if (billLayout.storeName?.visible !== false && storeInfo.name) {
          const style = applyFontStyle(billLayout.storeName);
          const effectiveWidth = style.isDoubleWidth ? Math.floor(LINE_WIDTH / 2) : LINE_WIDTH;
          content += ESCPOS.ALIGN_CENTER;
          content += style.prefix;
          
          if (storeInfo.name.length > effectiveWidth) {
            const text = storeInfo.name;
            const lines = [];
            let currentLine = '';
            
            // 먼저 공백 기준으로 분할 시도
            const words = text.split(' ');
            if (words.length > 1) {
              words.forEach(word => {
                const testLine = currentLine ? `${currentLine} ${word}` : word;
                if (testLine.length > effectiveWidth) {
                  if (currentLine) lines.push(currentLine);
                  // 단어 자체가 너무 길면 문자 단위로 분할
                  if (word.length > effectiveWidth) {
                    for (let i = 0; i < word.length; i += effectiveWidth) {
                      const chunk = word.substring(i, Math.min(i + effectiveWidth, word.length));
                      if (i + effectiveWidth < word.length) {
                        lines.push(chunk);
                      } else {
                        currentLine = chunk;
                      }
                    }
                  } else {
                    currentLine = word;
                  }
                } else {
                  currentLine = testLine;
                }
              });
            } else {
              // 공백 없는 긴 텍스트 - 문자 단위로 분할
              for (let i = 0; i < text.length; i += effectiveWidth) {
                lines.push(text.substring(i, Math.min(i + effectiveWidth, text.length)));
              }
              currentLine = '';
            }
            if (currentLine) lines.push(currentLine);
            
            lines.forEach(line => {
              content += centerText(line, style.isDoubleWidth) + '\n';
            });
          } else {
            content += centerText(storeInfo.name, style.isDoubleWidth) + '\n';
          }
          content += style.suffix;
        }
        
        if (billLayout.storeAddress?.visible !== false && storeInfo.address) {
          const style = applyFontStyle(billLayout.storeAddress);
          content += ESCPOS.ALIGN_CENTER;
          content += style.prefix;
          content += centerText(storeInfo.address, style.isDoubleWidth) + '\n';
          content += style.suffix;
        }
        
        if (billLayout.storePhone?.visible !== false && storeInfo.phone) {
          const style = applyFontStyle(billLayout.storePhone);
          content += ESCPOS.ALIGN_CENTER;
          content += style.prefix;
          content += centerText(storeInfo.phone, style.isDoubleWidth) + '\n';
          content += style.suffix;
        }
        
        // Separator 1
        if (billLayout.separator1?.visible !== false) {
          content += getSeparator(billLayout.separator1?.style || 'solid') + '\n';
        }
        
        content += ESCPOS.ALIGN_LEFT;
        
        // Order Info - use billLayout fontSize
        if (billLayout.orderNumber?.visible !== false && header.orderNumber) {
          const style = applyFontStyle(billLayout.orderNumber);
          content += style.prefix + `Order#: ${header.orderNumber}\n` + style.suffix;
        }
        
        if (billLayout.orderChannel?.visible !== false) {
          const style = applyFontStyle(billLayout.orderChannel);
          const channelInfo = orderInfo.channel || 'POS';
          const tableInfo = orderInfo.table ? ` / Table: ${orderInfo.table}` : '';
          content += style.prefix + `${channelInfo}${tableInfo}\n` + style.suffix;
        }
        
        if (billLayout.serverName?.visible !== false && orderInfo.server) {
          const style = applyFontStyle(billLayout.serverName);
          content += style.prefix + `Server: ${orderInfo.server}\n` + style.suffix;
        }
        
        if (billLayout.dateTime?.visible !== false) {
          const style = applyFontStyle(billLayout.dateTime);
          const now = header.dateTime ? new Date(header.dateTime) : new Date();
          content += style.prefix + `${now.toLocaleDateString()} ${now.toLocaleTimeString()}\n` + style.suffix;
        }
        
        // Separator 2
        if (billLayout.separator2?.visible !== false) {
          content += getSeparator(billLayout.separator2?.style || 'dashed') + '\n';
        }
        
        // Items - by guest sections if available - use billLayout fontSize
        const sectionsToRender = guestSections.length > 0 ? guestSections : [{ guestNumber: 1, items }];
        const itemsStyle = applyFontStyle(billLayout.items);
        const modifiersStyle = applyFontStyle(billLayout.modifiers);
        const itemNoteStyle = applyFontStyle(billLayout.itemNote);
        
        sectionsToRender.forEach((section, idx) => {
          if (sectionsToRender.length > 1) {
            // Guest 라벨: Item과 동일한 스타일 적용
            const guestLabel = `--- GUEST ${section.guestNumber} ---`;
            content += itemsStyle.prefix + centerText(guestLabel) + '\n' + itemsStyle.suffix;
          }
          
          (section.items || []).forEach(item => {
            const qty = item.qty || item.quantity || 1;
            const name = item.name || 'Unknown';
            const lineTotal = item.lineTotal || item.total || item.totalPrice || ((item.price || item.unitPrice || 0) * qty) || 0;
            const hasDiscount = item.discount && item.discount.amount > 0;
            const originalTotal = item.originalTotal || lineTotal;
            
            if (hasDiscount) {
              // Show original price first
              content += itemsStyle.prefix + leftRightText(`${qty}x ${name}`, `$${originalTotal.toFixed(2)}`, itemsStyle.isDoubleWidth) + '\n' + itemsStyle.suffix;
              
              // Show discount line (using billLayout.discount settings for italic)
              const discountStyle = applyFontStyle(billLayout.discount);
              const discountLabel = item.discount.type || 'Item Discount';
              const discountAmount = item.discount.amount || 0;
              content += discountStyle.prefix + leftRightText(`  - ${discountLabel}: -$${discountAmount.toFixed(2)}`, `$${lineTotal.toFixed(2)}`, discountStyle.isDoubleWidth) + '\n' + discountStyle.suffix;
            } else {
              // No discount - show normal price
              content += itemsStyle.prefix + leftRightText(`${qty}x ${name}`, `$${lineTotal.toFixed(2)}`, itemsStyle.isDoubleWidth) + '\n' + itemsStyle.suffix;
            }
            
            // Modifiers
            if (billLayout.modifiers?.visible !== false && item.modifiers && item.modifiers.length > 0) {
              const modPrefix = billLayout.modifiers?.prefix || '>>';
              item.modifiers.forEach(mod => {
                // Modifier 객체에서 이름 추출 - 여러 개면 각각 별도 줄에 출력
                const modNames = [];
                if (typeof mod === 'string') {
                  modNames.push(mod);
                } else if (mod.name) {
                  modNames.push(mod.name);
                } else if (mod.text) {
                  modNames.push(mod.text);
                } else if (mod.modifierName) {
                  modNames.push(mod.modifierName);
                } else if (mod.selectedEntries && Array.isArray(mod.selectedEntries)) {
                  mod.selectedEntries.forEach(e => modNames.push(e.name || e));
                } else if (mod.modifierNames && Array.isArray(mod.modifierNames)) {
                  mod.modifierNames.forEach(n => modNames.push(n));
                }
                // 각 modifier를 별도 줄에 출력
                modNames.forEach(modName => {
                  if (!modName) return;
                  const effectiveWidth = modifiersStyle.isDoubleWidth ? Math.floor(LINE_WIDTH / 2) : LINE_WIDTH;
                  const truncatedMod = modName.length > effectiveWidth - 4 ? modName.substring(0, effectiveWidth - 6) + '..' : modName;
                  content += modifiersStyle.prefix + `  ${modPrefix} ${truncatedMod}\n` + modifiersStyle.suffix;
                });
              });
            }
            
            // Item Note/Memo
            if (billLayout.itemNote?.visible !== false && item.memo) {
              const notePrefix = billLayout.itemNote?.prefix || '->';
              const memoText = typeof item.memo === 'string' ? item.memo : (item.memo.text || '');
              if (memoText) {
                const effectiveWidth = itemNoteStyle.isDoubleWidth ? Math.floor(LINE_WIDTH / 2) : LINE_WIDTH;
                const truncatedMemo = memoText.length > effectiveWidth - 4 ? memoText.substring(0, effectiveWidth - 6) + '..' : memoText;
                content += itemNoteStyle.prefix + `  ${notePrefix} ${truncatedMemo}\n` + itemNoteStyle.suffix;
              }
            }
          });
        });
        
        // Separator 3
        if (billLayout.separator3?.visible !== false) {
          content += getSeparator(billLayout.separator3?.style || 'solid') + '\n';
        }
        
        // Totals - use billLayout fontSize
        if (billLayout.subtotal?.visible !== false) {
          const style = applyFontStyle(billLayout.subtotal);
          content += style.prefix + leftRightText('Subtotal:', `$${subtotal.toFixed(2)}`, style.isDoubleWidth) + '\n' + style.suffix;
        }
        
        // Adjustments (discounts, fees) - use billLayout fontSize
        if (billLayout.discount?.visible !== false && adjustments.length > 0) {
          const style = applyFontStyle(billLayout.discount);
          adjustments.forEach(adj => {
            content += style.prefix + leftRightText(adj.label || 'Discount:', `$${adj.amount.toFixed(2)}`, style.isDoubleWidth) + '\n' + style.suffix;
          });
        }
        
        // Tax lines - use billLayout fontSize
        const taxStyle = applyFontStyle(billLayout.taxGST || billLayout.taxPST);
        taxLines.forEach(tax => {
          if (tax.name && (billLayout.taxGST?.visible !== false || billLayout.taxPST?.visible !== false)) {
            const taxLabel = tax.name.includes('%') ? tax.name : `${tax.name}:`;
            content += taxStyle.prefix + leftRightText(taxLabel, `$${(tax.amount || 0).toFixed(2)}`, taxStyle.isDoubleWidth) + '\n' + taxStyle.suffix;
          }
        });
        
        // Separator 4
        if (billLayout.separator4?.visible !== false) {
          content += getSeparator(billLayout.separator4?.style || 'solid') + '\n';
        }
        
        // Total - use billLayout fontSize
        if (billLayout.total?.visible !== false) {
          const style = applyFontStyle(billLayout.total);
          content += style.prefix + leftRightText('TOTAL:', `$${total.toFixed(2)}`, style.isDoubleWidth) + '\n' + style.suffix;
        }
        
        // Footer - use billLayout fontSize
        content += '\n';
        if (billLayout.greeting?.visible !== false) {
          const style = applyFontStyle(billLayout.greeting);
          content += ESCPOS.ALIGN_CENTER;
          content += style.prefix + centerText(billLayout.greeting?.text || footer.message || 'Thank you!', style.isDoubleWidth) + '\n' + style.suffix;
        }
        
        // Feed and cut
        content += ESCPOS.FEED_LINES(4);
        content += ESCPOS.CUT;
        
        return content;
      };

      // Render and print (multiple copies)
      let printedMode = 'text';
      for (let copyNum = 1; copyNum <= numCopies; copyNum++) {
        console.log(`📄 Printing Bill copy ${copyNum}/${numCopies}...`);
        
        if (printMode === 'graphic' && createCanvas) {
          try {
            // Build graphic bill using Canvas
            const billImage = renderBillImage(billData, billLayout, paperWidth, storeInfo);
            if (billImage) {
              await printEscPosToWindows(printerName, billImage);
              printedMode = 'graphic';
              continue; // Successfully printed this copy
            }
          } catch (graphicErr) {
            console.warn('Graphic mode failed, falling back to text:', graphicErr.message);
          }
        }

        // Text mode (or fallback)
        const textContent = buildTextBill();
        await printEscPosToWindows(printerName, textContent);
        printedMode = 'text';
      }
      
      console.log(`✅ Bill printed successfully (${numCopies} copies, ${printedMode} mode)`);
      res.json({ success: true, message: `Bill printed (${numCopies} copies)`, mode: printedMode, copies: numCopies });

    } catch (err) {
      console.error('❌ Print bill error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Helper function to render bill as image using Canvas
  function renderBillImage(billData, billLayout, paperWidth, storeInfo = {}) {
    if (!createCanvas) return null;

    const {
      header = {},
      orderInfo = {},
      items = [],
      guestSections = [],
      subtotal = 0,
      adjustments = [],
      taxLines = [],
      total = 0,
      footer = {}
    } = billData;

    // Font Scale: 프린터 DPI(203)와 화면 DPI(96) 차이 보정
    // 기본값 2.1 (203 / 96 ≈ 2.1) - 프리뷰와 동일한 시각적 크기로 출력
    const fontScale = billLayout.fontScale || 2.1;

    // 80mm = 576px, 58mm = 384px at 203 DPI
    const PAPER_WIDTH_PX = paperWidth === 80 ? 576 : 384;
    // Minimal margins to maximize content width - only 4px minimum
    const MARGIN = Math.max(4, Math.min(12, Math.round((billLayout.leftMargin || 0) * 2.835) + 4));
    const TOP_MARGIN = Math.round((billLayout.topMargin || 0) * 2.835) + 2;  // 상단 여백 최소화
    const BOTTOM_MARGIN = 2;  // 하단 여백 2px 고정 (용지 낭비 방지)
    const CONTENT_WIDTH = PAPER_WIDTH_PX - (MARGIN * 2);

    // Calculate height (apply fontScale to all height calculations)
    let totalHeight = TOP_MARGIN + Math.round(10 * fontScale);
    
    // Store info
    if (billLayout.storeName?.visible !== false) totalHeight += Math.round(35 * fontScale);
    if (billLayout.storeAddress?.visible !== false) totalHeight += Math.round(20 * fontScale);
    if (billLayout.storePhone?.visible !== false) totalHeight += Math.round(20 * fontScale);
    
    // Order info
    totalHeight += Math.round(100 * fontScale);
    
    // Items
    const sectionsToRender = guestSections.length > 0 ? guestSections : [{ guestNumber: 1, items }];
    const itemFontSizeForHeight = billLayout.items?.fontSize || 12;
    const discountFontSizeForHeight = billLayout.discount?.fontSize || 10;
    sectionsToRender.forEach(section => {
      if (sectionsToRender.length > 1) totalHeight += Math.round(itemFontSizeForHeight * fontScale) + (billLayout.items?.lineSpacing || 0);
      (section.items || []).forEach(item => {
        totalHeight += Math.round(itemFontSizeForHeight * fontScale) + (billLayout.items?.lineSpacing || 0);
        // Add height for item-level discount line if present
        if (item.discount && item.discount.amount > 0) {
          totalHeight += Math.round(discountFontSizeForHeight * fontScale) + (billLayout.discount?.lineSpacing || 0);
        }
        if (item.modifiers) totalHeight += item.modifiers.length * Math.round(18 * fontScale);
        if (item.memo) totalHeight += Math.round(18 * fontScale);
      });
    });
    
    // Totals + Greeting
    totalHeight += Math.round(50 * fontScale);
    
    // Footer (하단 여백)
    totalHeight += BOTTOM_MARGIN;

    const canvas = createCanvas(PAPER_WIDTH_PX, totalHeight);
    const ctx = canvas.getContext('2d');

    // White background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, PAPER_WIDTH_PX, totalHeight);

    // 첫 텍스트의 폰트 크기만큼 y 시작 위치를 아래로 조정 (텍스트 baseline 보정)
    const firstFontSize = Math.round((billLayout.storeName?.fontSize || 16) * fontScale);
    let y = TOP_MARGIN + firstFontSize;
    const centerX = PAPER_WIDTH_PX / 2;

    // Helper functions
    const drawText = (text, x, yPos, fontSize, fontWeight = 'normal', align = 'center', isItalic = false) => {
      const scaledFontSize = Math.round(fontSize * fontScale);
      const italicPrefix = isItalic ? 'italic ' : '';
      ctx.font = `${italicPrefix}${fontWeight} ${scaledFontSize}px Arial`;
      ctx.fillStyle = '#000000';
      ctx.textAlign = align;
      
      // Truncate text if it's too wide for the content area
      let displayText = text;
      const maxWidth = CONTENT_WIDTH - 10; // Leave some padding
      const textWidth = ctx.measureText(text).width;
      
      if (textWidth > maxWidth && align === 'center') {
        // Truncate center-aligned text
        while (ctx.measureText(displayText + '..').width > maxWidth && displayText.length > 5) {
          displayText = displayText.substring(0, displayText.length - 1);
        }
        displayText = displayText + '..';
      }
      
      ctx.fillText(displayText, x, yPos);
    };
    
    // Helper to draw left-right aligned text (for items with prices)
    // Minimized gap between left text and right amount
    const drawLeftRight = (leftText, rightText, yPos, fontSize, fontWeight = 'normal', isItalic = false) => {
      const scaledFontSize = Math.round(fontSize * fontScale);
      const italicPrefix = isItalic ? 'italic ' : '';
      ctx.font = `${italicPrefix}${fontWeight} ${scaledFontSize}px Arial`;
      ctx.fillStyle = '#000000';
      
      const rightWidth = ctx.measureText(rightText).width;
      // Only 2 pixel gap between left text and right amount
      const minGap = 2;
      const maxLeftWidth = CONTENT_WIDTH - rightWidth - minGap;
      
      // Truncate left text if needed
      let displayLeft = leftText;
      while (ctx.measureText(displayLeft).width > maxLeftWidth && displayLeft.length > 5) {
        displayLeft = displayLeft.substring(0, displayLeft.length - 1);
      }
      if (displayLeft !== leftText) {
        displayLeft = displayLeft + '..';
      }
      
      ctx.textAlign = 'left';
      ctx.fillText(displayLeft, MARGIN, yPos);
      ctx.textAlign = 'right';
      ctx.fillText(rightText, PAPER_WIDTH_PX - MARGIN - (CONTENT_WIDTH * 0.15), yPos);
    };

    const drawLine = (yPos, style = 'solid') => {
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1;
      if (style === 'dashed') {
        ctx.setLineDash([8, 4]);
      } else if (style === 'dotted') {
        ctx.setLineDash([2, 2]);
      } else {
        ctx.setLineDash([]);
      }
      ctx.beginPath();
      ctx.moveTo(MARGIN, yPos);
      ctx.lineTo(PAPER_WIDTH_PX - MARGIN, yPos);
      ctx.stroke();
      ctx.setLineDash([]);
    };

    // Header (from Business Profile) - use billLayout fontSize settings with fontScale
    // Store Name이 너무 길면 여러 줄로 표시
    if (billLayout.storeName?.visible !== false && storeInfo.name) {
      const fontSize = billLayout.storeName?.fontSize || 16;
      const lineSpacing = billLayout.storeName?.lineSpacing || 0;
      const fontWeight = billLayout.storeName?.fontWeight === 'bold' ? 'bold' : 'normal';
      const isItalic = billLayout.storeName?.isItalic || false;
      const scaledFontSize = Math.round(fontSize * fontScale);
      ctx.font = `${isItalic ? 'italic ' : ''}${fontWeight} ${scaledFontSize}px Arial`;
      const nameWidth = ctx.measureText(storeInfo.name).width;
      // 프린터 출력 시 실제 가용 폭은 캔버스보다 작음 - 80mm 용지 기준 약 72mm (90%)
      const maxWidth = CONTENT_WIDTH * 0.85; // 약 470px (80mm 용지 기준)
      
      console.log(`🏪 [Bill Store Name] nameWidth: ${nameWidth.toFixed(0)}px, maxWidth: ${maxWidth.toFixed(0)}px, split: ${nameWidth > maxWidth}`);
      
      if (nameWidth > maxWidth) {
        // 여러 줄로 분할 (공백 또는 문자 단위)
        const text = storeInfo.name;
        const lines = [];
        let currentLine = '';
        
        // 먼저 공백 기준으로 분할 시도
        const words = text.split(' ');
        if (words.length > 1) {
          words.forEach(word => {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            if (ctx.measureText(testLine).width > maxWidth) {
              if (currentLine) lines.push(currentLine);
              // 단어 자체가 너무 길면 문자 단위로 분할
              if (ctx.measureText(word).width > maxWidth) {
                let charLine = '';
                for (const char of word) {
                  if (ctx.measureText(charLine + char).width > maxWidth) {
                    if (charLine) lines.push(charLine);
                    charLine = char;
                  } else {
                    charLine += char;
                  }
                }
                currentLine = charLine;
              } else {
                currentLine = word;
              }
            } else {
              currentLine = testLine;
            }
          });
        } else {
          // 공백 없는 긴 텍스트 - 문자 단위로 분할
          for (const char of text) {
            if (ctx.measureText(currentLine + char).width > maxWidth) {
              if (currentLine) lines.push(currentLine);
              currentLine = char;
            } else {
              currentLine += char;
            }
          }
        }
        if (currentLine) lines.push(currentLine);
        
        console.log(`🏪 [Store Name] Split into ${lines.length} lines:`, lines);
        lines.forEach(line => {
          drawText(line, centerX, y, fontSize, fontWeight, 'center', isItalic);
          y += Math.round(fontSize * fontScale) + lineSpacing;
        });
      } else {
        drawText(storeInfo.name, centerX, y, fontSize, fontWeight, 'center', isItalic);
        y += Math.round(fontSize * fontScale) + lineSpacing;
      }
    }
    if (billLayout.storeAddress?.visible !== false && storeInfo.address) {
      const fontSize = billLayout.storeAddress?.fontSize || 10;
      const lineSpacing = billLayout.storeAddress?.lineSpacing || 0;
      const fontWeight = billLayout.storeAddress?.fontWeight === 'bold' ? 'bold' : 'normal';
      const isItalic = billLayout.storeAddress?.isItalic || false;
      drawText(storeInfo.address, centerX, y, fontSize, fontWeight, 'center', isItalic);
      y += Math.round(fontSize * fontScale) + lineSpacing;
    }
    if (billLayout.storePhone?.visible !== false && storeInfo.phone) {
      const fontSize = billLayout.storePhone?.fontSize || 10;
      const lineSpacing = billLayout.storePhone?.lineSpacing || 0;
      const fontWeight = billLayout.storePhone?.fontWeight === 'bold' ? 'bold' : 'normal';
      const isItalic = billLayout.storePhone?.isItalic || false;
      drawText(storeInfo.phone, centerX, y, fontSize, fontWeight, 'center', isItalic);
      y += Math.round(fontSize * fontScale) + lineSpacing;
    }

    // Separator 1
    if (billLayout.separator1?.visible !== false) {
      y += Math.round(4 * fontScale);
      drawLine(y, billLayout.separator1?.style || 'solid');
      y += Math.round(8 * fontScale);
    }

    // Order info - use billLayout fontSize settings with fontScale
    ctx.textAlign = 'left';
    if (billLayout.orderNumber?.visible !== false && header.orderNumber) {
      const fontSize = billLayout.orderNumber?.fontSize || 12;
      const lineSpacing = billLayout.orderNumber?.lineSpacing || 0;
      const fontWeight = billLayout.orderNumber?.fontWeight === 'bold' ? 'bold' : 'normal';
      const isItalic = billLayout.orderNumber?.isItalic || false;
      drawText(`Order#: ${header.orderNumber}`, MARGIN, y, fontSize, fontWeight, 'left', isItalic);
      y += Math.round(fontSize * fontScale) + lineSpacing;
    }
    if (billLayout.orderChannel?.visible !== false) {
      const fontSize = billLayout.orderChannel?.fontSize || 12;
      const lineSpacing = billLayout.orderChannel?.lineSpacing || 0;
      const fontWeight = billLayout.orderChannel?.fontWeight === 'bold' ? 'bold' : 'normal';
      const isItalic = billLayout.orderChannel?.isItalic || false;
      // header와 orderInfo 모두에서 channel/table 정보 확인
      const channelInfo = header.channel || orderInfo.channel || 'POS';
      const tableName = header.tableName || orderInfo.tableName || orderInfo.table || '';
      const tableInfo = tableName ? ` / ${tableName}` : '';
      drawText(`${channelInfo}${tableInfo}`, MARGIN, y, fontSize, fontWeight, 'left', isItalic);
      y += Math.round(fontSize * fontScale) + lineSpacing;
    }
    if (billLayout.serverName?.visible !== false && orderInfo.server) {
      const fontSize = billLayout.serverName?.fontSize || 11;
      const lineSpacing = billLayout.serverName?.lineSpacing || 0;
      const fontWeight = billLayout.serverName?.fontWeight === 'bold' ? 'bold' : 'normal';
      const isItalic = billLayout.serverName?.isItalic || false;
      drawText(`Server: ${orderInfo.server}`, MARGIN, y, fontSize, fontWeight, 'left', isItalic);
      y += Math.round(fontSize * fontScale) + lineSpacing;
    }
    if (billLayout.dateTime?.visible !== false) {
      const fontSize = billLayout.dateTime?.fontSize || 11;
      const lineSpacing = billLayout.dateTime?.lineSpacing || 0;
      const fontWeight = billLayout.dateTime?.fontWeight === 'bold' ? 'bold' : 'normal';
      const isItalic = billLayout.dateTime?.isItalic || false;
      const now = header.dateTime ? new Date(header.dateTime) : new Date();
      drawText(`${now.toLocaleDateString()} ${now.toLocaleTimeString()}`, MARGIN, y, fontSize, fontWeight, 'left', isItalic);
      y += Math.round(fontSize * fontScale) + lineSpacing;
    }

    // Separator 2
    if (billLayout.separator2?.visible !== false) {
      y += Math.round(4 * fontScale);
      drawLine(y, billLayout.separator2?.style || 'dashed');
      y += Math.round(8 * fontScale);
    }

    // Items - use billLayout fontSize settings with fontScale
    const itemsFontSize = billLayout.items?.fontSize || 12;
    const itemsLineSpacing = billLayout.items?.lineSpacing || 0;
    const itemsFontWeight = billLayout.items?.fontWeight === 'bold' ? 'bold' : 'normal';
    const itemsIsItalic = billLayout.items?.isItalic || false;
    const modifiersFontSize = billLayout.modifiers?.fontSize || 10;
    const modifiersLineSpacing = billLayout.modifiers?.lineSpacing || 0;
    const modifiersFontWeight = billLayout.modifiers?.fontWeight === 'bold' ? 'bold' : 'normal';
    const modifiersIsItalic = billLayout.modifiers?.isItalic || false;
    
    sectionsToRender.forEach(section => {
      if (sectionsToRender.length > 1) {
        // Guest 라벨: Item과 동일한 폰트 사이즈 사용
        drawText(`--- GUEST ${section.guestNumber} ---`, centerX, y, itemsFontSize, itemsFontWeight, 'center', itemsIsItalic);
        y += Math.round(itemsFontSize * fontScale) + itemsLineSpacing;
      }

      (section.items || []).forEach(item => {
        const qty = item.qty || item.quantity || 1;
        const name = item.name || 'Unknown';
        const lineTotal = item.lineTotal || item.total || item.totalPrice || ((item.price || item.unitPrice || 0) * qty) || 0;
        const hasDiscount = item.discount && item.discount.amount > 0;
        const originalTotal = item.originalTotal || lineTotal;

        // If item has discount, show original price first
        if (hasDiscount) {
          // Show original price with strikethrough effect (using lighter text)
          const origPriceStr = `$${originalTotal.toFixed(2)}`;
          drawLeftRight(`${qty}x ${name}`, origPriceStr, y, itemsFontSize, itemsFontWeight, itemsIsItalic);
          y += Math.round(itemsFontSize * fontScale) + itemsLineSpacing;
          
          // Show discount line (italic, using billLayout.discount settings)
          const discountFontSize = billLayout.discount?.fontSize || 10;
          const discountLineSpacing = billLayout.discount?.lineSpacing || 0;
          const discountIsItalic = billLayout.discount?.isItalic !== false; // Default to italic
          const discountLabel = item.discount.type || 'Item Discount';
          const discountAmount = item.discount.amount || 0;
          drawLeftRight(`  - ${discountLabel}: -$${discountAmount.toFixed(2)}`, `$${lineTotal.toFixed(2)}`, y, discountFontSize, 'normal', discountIsItalic);
          y += Math.round(discountFontSize * fontScale) + discountLineSpacing;
        } else {
          // No discount - show normal price
          drawLeftRight(`${qty}x ${name}`, `$${lineTotal.toFixed(2)}`, y, itemsFontSize, itemsFontWeight, itemsIsItalic);
          y += Math.round(itemsFontSize * fontScale) + itemsLineSpacing;
        }

        // Modifiers
        if (billLayout.modifiers?.visible !== false && item.modifiers) {
          const modPrefix = billLayout.modifiers?.prefix || '>>';
          item.modifiers.forEach(mod => {
            // Modifier 객체에서 이름 추출 - 여러 개면 각각 별도 줄에 출력
            const modNames = [];
            if (typeof mod === 'string') {
              modNames.push(mod);
            } else if (mod.name) {
              modNames.push(mod.name);
            } else if (mod.text) {
              modNames.push(mod.text);
            } else if (mod.modifierName) {
              modNames.push(mod.modifierName);
            } else if (mod.selectedEntries && Array.isArray(mod.selectedEntries)) {
              mod.selectedEntries.forEach(e => modNames.push(e.name || e));
            } else if (mod.modifierNames && Array.isArray(mod.modifierNames)) {
              mod.modifierNames.forEach(n => modNames.push(n));
            }
            // 각 modifier를 별도 줄에 출력
            modNames.forEach(modName => {
              if (!modName) return;
              drawText(`  ${modPrefix} ${modName}`, MARGIN, y, modifiersFontSize, modifiersFontWeight, 'left', modifiersIsItalic);
              y += Math.round(modifiersFontSize * fontScale) + modifiersLineSpacing;
            });
          });
        }
      });
    });

    // Separator 3
    if (billLayout.separator3?.visible !== false) {
      y += Math.round(4 * fontScale);
      drawLine(y, billLayout.separator3?.style || 'solid');
      y += Math.round(8 * fontScale);
    }

    // Totals - use billLayout fontSize settings with fontScale
    if (billLayout.subtotal?.visible !== false) {
      const fontSize = billLayout.subtotal?.fontSize || 12;
      const lineSpacing = billLayout.subtotal?.lineSpacing || 0;
      const fontWeight = billLayout.subtotal?.fontWeight === 'bold' ? 'bold' : 'normal';
      const isItalic = billLayout.subtotal?.isItalic || false;
      drawLeftRight('Subtotal:', `$${subtotal.toFixed(2)}`, y, fontSize, fontWeight, isItalic);
      y += Math.round(fontSize * fontScale) + lineSpacing;
    }

    // Adjustments (Discount)
    if (billLayout.discount?.visible !== false) {
      const fontSize = billLayout.discount?.fontSize || 11;
      const lineSpacing = billLayout.discount?.lineSpacing || 0;
      const fontWeight = billLayout.discount?.fontWeight === 'bold' ? 'bold' : 'normal';
      const isItalic = billLayout.discount?.isItalic || false;
      adjustments.forEach(adj => {
        drawLeftRight(adj.label || 'Discount:', `$${adj.amount.toFixed(2)}`, y, fontSize, fontWeight, isItalic);
        y += Math.round(fontSize * fontScale) + lineSpacing;
      });
    }

    // Tax - use billLayout fontSize settings with fontScale
    const taxFontSize = billLayout.taxGST?.fontSize || billLayout.taxPST?.fontSize || 11;
    const taxLineSpacing = billLayout.taxGST?.lineSpacing || billLayout.taxPST?.lineSpacing || 0;
    const taxFontWeight = (billLayout.taxGST?.fontWeight === 'bold' || billLayout.taxPST?.fontWeight === 'bold') ? 'bold' : 'normal';
    const taxIsItalic = billLayout.taxGST?.isItalic || billLayout.taxPST?.isItalic || false;
    taxLines.forEach(tax => {
      if (tax.name) {
        drawLeftRight(`${tax.name}:`, `$${(tax.amount || 0).toFixed(2)}`, y, taxFontSize, taxFontWeight, taxIsItalic);
        y += Math.round(taxFontSize * fontScale) + taxLineSpacing;
      }
    });

    // Separator 4
    if (billLayout.separator4?.visible !== false) {
      y += Math.round(4 * fontScale);
      drawLine(y, billLayout.separator4?.style || 'solid');
      y += Math.round(8 * fontScale);
    }

    // Total - use billLayout fontSize settings with fontScale
    if (billLayout.total?.visible !== false) {
      const fontSize = billLayout.total?.fontSize || 14;
      const lineSpacing = billLayout.total?.lineSpacing || 0;
      const fontWeight = billLayout.total?.fontWeight === 'bold' ? 'bold' : 'normal';
      const isItalic = billLayout.total?.isItalic || false;
      drawLeftRight('TOTAL:', `$${total.toFixed(2)}`, y, fontSize, fontWeight, isItalic);
      y += Math.round(fontSize * fontScale) + lineSpacing;
    }

    // Footer - use billLayout fontSize settings with fontScale
    y += Math.round(10 * fontScale);
    if (billLayout.greeting?.visible !== false) {
      const fontSize = billLayout.greeting?.fontSize || 11;
      const lineSpacing = billLayout.greeting?.lineSpacing || 0;
      const fontWeight = billLayout.greeting?.fontWeight === 'bold' ? 'bold' : 'normal';
      const isItalic = billLayout.greeting?.isItalic || false;
      drawText(billLayout.greeting?.text || footer.message || 'Thank you!', centerX, y, fontSize, fontWeight, 'center', isItalic);
      y += Math.round(fontSize * fontScale) + lineSpacing;
    }

    // Convert to ESC/POS
    return canvasToEscPosBitmap(canvas);
  }

  // ============ PRINT RECEIPT (결제 완료 후) ============
  
  // POST /api/printers/print-receipt - Print receipt after payment completion
  router.post('/print-receipt', async (req, res) => {
    try {
      const { receiptData, copies = 2 } = req.body;
      
      if (!receiptData) {
        return res.status(400).json({ success: false, error: 'receiptData is required' });
      }

      const numCopies = Math.max(1, Math.min(5, copies)); // 1~5장 제한
      console.log(`📄 Print Receipt request received (${numCopies} copies)`);

      // Load layout settings
      let layoutSettings = null;
      try {
        const row = await dbGet(`SELECT settings FROM printer_layout_settings WHERE id = 1`);
        if (row && row.settings) {
          layoutSettings = JSON.parse(row.settings);
        }
      } catch (e) {
        console.warn('Could not load layout settings:', e.message);
      }

      const receiptLayout = layoutSettings?.receiptLayout || {};
      const printMode = receiptLayout.printMode || 'graphic';
      const paperWidth = receiptLayout.paperWidth || 80;

      // Load business profile for store info
      let businessProfile = null;
      try {
        businessProfile = await dbGet('SELECT * FROM business_profile WHERE id = 1');
      } catch (e) {
        console.warn('Could not load business profile:', e.message);
      }

      const storeInfo = {
        name: businessProfile?.business_name || receiptLayout.storeName?.text || 'Restaurant',
        address: [
          businessProfile?.address_line1,
          businessProfile?.address_line2,
          businessProfile?.city,
          businessProfile?.state,
          businessProfile?.zip
        ].filter(Boolean).join(', ') || receiptLayout.storeAddress?.text || '',
        phone: businessProfile?.phone || receiptLayout.storePhone?.text || ''
      };

      // Find receipt printer
      let printer = await dbGet(`
        SELECT id, name, selected_printer 
        FROM printers 
        WHERE is_active = 1 
          AND (
            LOWER(type) = 'receipt' 
            OR LOWER(name) LIKE '%front%' 
            OR LOWER(name) LIKE '%receipt%'
            OR LOWER(name) LIKE '%counter%'
          )
        LIMIT 1
      `);
      
      if (!printer) {
        printer = await dbGet(`
          SELECT id, name, selected_printer 
          FROM printers 
          WHERE is_active = 1 AND selected_printer IS NOT NULL
          LIMIT 1
        `);
      }
      
      if (!printer || !printer.selected_printer) {
        console.error('❌ No printer configured for receipt printing');
        return res.status(400).json({ 
          success: false, 
          error: 'No printer configured. Please set up a receipt printer in Back Office.' 
        });
      }

      const printerName = printer.selected_printer;
      console.log(`🖨️ Using printer for receipt: ${printerName}`);

      // Extract receipt data
      const {
        header = {},
        orderInfo = {},
        items = [],
        guestSections = [],
        subtotal = 0,
        adjustments = [],
        taxLines = [],
        taxesTotal = 0,
        total = 0,
        payments = [],
        change = 0,
        footer = {}
      } = receiptData;

      // Build ESC/POS content for text mode
      const LINE_WIDTH = paperWidth === 80 ? 42 : 32;
      const buildTextReceipt = () => {
        let content = '';
        
        const centerText = (text, useDouble = false) => {
          const effectiveWidth = useDouble ? Math.floor(LINE_WIDTH / 2) : LINE_WIDTH;
          const truncatedText = text.length > effectiveWidth ? text.substring(0, effectiveWidth - 2) + '..' : text;
          const padding = Math.max(0, Math.floor((effectiveWidth - truncatedText.length) / 2));
          return ' '.repeat(padding) + truncatedText;
        };
        
        const leftRightText = (left, right, useDouble = false) => {
          const effectiveWidth = useDouble ? Math.floor(LINE_WIDTH / 2) : LINE_WIDTH;
          const rightLen = right.length;
          const maxLeftLen = effectiveWidth - rightLen - 1;
          const truncatedLeft = left.length > maxLeftLen ? left.substring(0, maxLeftLen - 2) + '..' : left;
          const spaces = Math.max(1, effectiveWidth - truncatedLeft.length - rightLen);
          const totalLen = truncatedLeft.length + spaces + rightLen;
          const finalSpaces = totalLen > effectiveWidth ? 1 : spaces;
          return truncatedLeft + ' '.repeat(finalSpaces) + right;
        };
        
        const getSeparator = (style, useDouble = false) => {
          const width = useDouble ? Math.floor(LINE_WIDTH / 2) : LINE_WIDTH;
          if (style === 'dashed') return '-'.repeat(width);
          if (style === 'dotted') return '.'.repeat(width);
          return '='.repeat(width);
        };
        
        const applyFontStyle = (element) => {
          let prefix = '';
          let suffix = '';
          let isDoubleWidth = false;
          const fontSize = element?.fontSize || 12;
          const fontWeight = element?.fontWeight || 'normal';
          
          if (fontSize >= 14) {
            prefix += ESCPOS.DOUBLE_SIZE;
            suffix = ESCPOS.NORMAL_SIZE + suffix;
            isDoubleWidth = true;
          } else if (fontSize >= 12) {
            prefix += ESCPOS.DOUBLE_HEIGHT;
            suffix = ESCPOS.NORMAL_SIZE + suffix;
          }
          
          if (fontWeight === 'bold') {
            prefix += ESCPOS.BOLD_ON;
            suffix = ESCPOS.BOLD_OFF + suffix;
          }
          
          return { prefix, suffix, isDoubleWidth };
        };

        // Initialize
        content += ESCPOS.INIT;
        
        // Header - Store Info - Store Name이 길면 여러 줄로 분할 (공백 또는 문자 단위)
        if (receiptLayout.storeName?.visible !== false && storeInfo.name) {
          const style = applyFontStyle(receiptLayout.storeName);
          const effectiveWidth = style.isDoubleWidth ? Math.floor(LINE_WIDTH / 2) : LINE_WIDTH;
          content += ESCPOS.ALIGN_CENTER;
          content += style.prefix;
          
          if (storeInfo.name.length > effectiveWidth) {
            const text = storeInfo.name;
            const lines = [];
            let currentLine = '';
            
            // 먼저 공백 기준으로 분할 시도
            const words = text.split(' ');
            if (words.length > 1) {
              words.forEach(word => {
                const testLine = currentLine ? `${currentLine} ${word}` : word;
                if (testLine.length > effectiveWidth) {
                  if (currentLine) lines.push(currentLine);
                  // 단어 자체가 너무 길면 문자 단위로 분할
                  if (word.length > effectiveWidth) {
                    for (let i = 0; i < word.length; i += effectiveWidth) {
                      const chunk = word.substring(i, Math.min(i + effectiveWidth, word.length));
                      if (i + effectiveWidth < word.length) {
                        lines.push(chunk);
                      } else {
                        currentLine = chunk;
                      }
                    }
                  } else {
                    currentLine = word;
                  }
                } else {
                  currentLine = testLine;
                }
              });
            } else {
              // 공백 없는 긴 텍스트 - 문자 단위로 분할
              for (let i = 0; i < text.length; i += effectiveWidth) {
                lines.push(text.substring(i, Math.min(i + effectiveWidth, text.length)));
              }
              currentLine = '';
            }
            if (currentLine) lines.push(currentLine);
            
            lines.forEach(line => {
              content += centerText(line, style.isDoubleWidth) + '\n';
            });
          } else {
            content += centerText(storeInfo.name, style.isDoubleWidth) + '\n';
          }
          content += style.suffix;
        }
        
        if (receiptLayout.storeAddress?.visible !== false && storeInfo.address) {
          const style = applyFontStyle(receiptLayout.storeAddress);
          content += ESCPOS.ALIGN_CENTER;
          content += style.prefix;
          content += centerText(storeInfo.address, style.isDoubleWidth) + '\n';
          content += style.suffix;
        }
        
        if (receiptLayout.storePhone?.visible !== false && storeInfo.phone) {
          const style = applyFontStyle(receiptLayout.storePhone);
          content += ESCPOS.ALIGN_CENTER;
          content += style.prefix;
          content += centerText(storeInfo.phone, style.isDoubleWidth) + '\n';
          content += style.suffix;
        }
        
        // Separator 1
        if (receiptLayout.separator1?.visible !== false) {
          content += getSeparator(receiptLayout.separator1?.style || 'solid') + '\n';
        }
        
        content += ESCPOS.ALIGN_LEFT;
        
        // Order Info
        if (receiptLayout.orderNumber?.visible !== false && header.orderNumber) {
          const style = applyFontStyle(receiptLayout.orderNumber);
          content += style.prefix + `Order#: ${header.orderNumber}\n` + style.suffix;
        }
        
        if (receiptLayout.orderChannel?.visible !== false) {
          const style = applyFontStyle(receiptLayout.orderChannel);
          const channelInfo = header.channel || orderInfo.channel || '';
          const tableInfo = header.tableName || orderInfo.tableName || '';
          if (channelInfo || tableInfo) {
            content += style.prefix + `${channelInfo}${tableInfo ? ' - ' + tableInfo : ''}\n` + style.suffix;
          }
        }
        
        if (receiptLayout.serverName?.visible !== false && (header.serverName || orderInfo.serverName)) {
          const style = applyFontStyle(receiptLayout.serverName);
          content += style.prefix + `Server: ${header.serverName || orderInfo.serverName}\n` + style.suffix;
        }
        
        if (receiptLayout.dateTime?.visible !== false) {
          const style = applyFontStyle(receiptLayout.dateTime);
          const now = new Date();
          const dateStr = now.toLocaleDateString('en-CA');
          const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
          content += style.prefix + `${dateStr} ${timeStr}\n` + style.suffix;
        }
        
        // Separator 2
        if (receiptLayout.separator2?.visible !== false) {
          content += getSeparator(receiptLayout.separator2?.style || 'dashed') + '\n';
        }
        
        // Items
        const sectionsToRender = guestSections.length > 0 ? guestSections : [{ guestNumber: 1, items }];
        sectionsToRender.forEach((section, sIdx) => {
          if (sectionsToRender.length > 1) {
            content += `--- Guest ${section.guestNumber || sIdx + 1} ---\n`;
          }
          (section.items || []).forEach(item => {
            if (receiptLayout.items?.visible !== false) {
              const style = applyFontStyle(receiptLayout.items);
              const qtyName = `${item.quantity || 1}x ${item.name}`;
              const price = `$${(item.totalPrice || item.price || 0).toFixed(2)}`;
              content += style.prefix + leftRightText(qtyName, price, style.isDoubleWidth) + '\n' + style.suffix;
            }
            
            if (receiptLayout.modifiers?.visible !== false && item.modifiers && item.modifiers.length > 0) {
              const style = applyFontStyle(receiptLayout.modifiers);
              const prefix = receiptLayout.modifiers?.prefix || '>>';
              item.modifiers.forEach(mod => {
                // Modifier 객체에서 이름 추출 - 여러 개면 각각 별도 줄에 출력
                const modNames = [];
                if (typeof mod === 'string') {
                  modNames.push(mod);
                } else if (mod.name) {
                  modNames.push(mod.name);
                } else if (mod.text) {
                  modNames.push(mod.text);
                } else if (mod.modifierName) {
                  modNames.push(mod.modifierName);
                } else if (mod.selectedEntries && Array.isArray(mod.selectedEntries)) {
                  mod.selectedEntries.forEach(e => modNames.push(e.name || e));
                } else if (mod.modifierNames && Array.isArray(mod.modifierNames)) {
                  mod.modifierNames.forEach(n => modNames.push(n));
                }
                // 각 modifier를 별도 줄에 출력
                modNames.forEach(modName => {
                  if (!modName) return;
                  const modText = `  ${prefix} ${modName}`;
                  const modPrice = mod.price ? `$${mod.price.toFixed(2)}` : '';
                  content += style.prefix + leftRightText(modText, modPrice, style.isDoubleWidth) + '\n' + style.suffix;
                });
              });
            }
            
            if (receiptLayout.itemNote?.visible !== false && item.memo) {
              const style = applyFontStyle(receiptLayout.itemNote);
              const prefix = receiptLayout.itemNote?.prefix || '->';
              content += style.prefix + `  ${prefix} ${item.memo.text || item.memo}\n` + style.suffix;
            }
          });
        });
        
        // Separator 3
        if (receiptLayout.separator3?.visible !== false) {
          content += getSeparator(receiptLayout.separator3?.style || 'solid') + '\n';
        }
        
        // Subtotal
        if (receiptLayout.subtotal?.visible !== false) {
          const style = applyFontStyle(receiptLayout.subtotal);
          content += style.prefix + leftRightText('Subtotal:', `$${subtotal.toFixed(2)}`, style.isDoubleWidth) + '\n' + style.suffix;
        }
        
        // Adjustments (Discount)
        if (receiptLayout.discount?.visible !== false && adjustments.length > 0) {
          const style = applyFontStyle(receiptLayout.discount);
          adjustments.forEach(adj => {
            content += style.prefix + leftRightText(adj.label || 'Discount:', `$${adj.amount.toFixed(2)}`, style.isDoubleWidth) + '\n' + style.suffix;
          });
        }
        
        // Tax
        taxLines.forEach(tax => {
          if (tax.name) {
            const style = applyFontStyle(receiptLayout.taxGST);
            content += style.prefix + leftRightText(`${tax.name}:`, `$${(tax.amount || 0).toFixed(2)}`, style.isDoubleWidth) + '\n' + style.suffix;
          }
        });
        
        // Separator 4
        if (receiptLayout.separator4?.visible !== false) {
          content += getSeparator(receiptLayout.separator4?.style || 'solid') + '\n';
        }
        
        // Total
        if (receiptLayout.total?.visible !== false) {
          const style = applyFontStyle(receiptLayout.total);
          content += style.prefix + leftRightText('TOTAL:', `$${total.toFixed(2)}`, style.isDoubleWidth) + '\n' + style.suffix;
        }
        
        content += '\n';
        
        // Payment Info (Receipt specific)
        if (receiptLayout.paymentMethod?.visible !== false && payments.length > 0) {
          const style = applyFontStyle(receiptLayout.paymentMethod);
          content += style.prefix + '--- Payment ---\n' + style.suffix;
          payments.forEach(p => {
            const method = p.method || 'Unknown';
            const amount = `$${(p.amount || 0).toFixed(2)}`;
            content += style.prefix + leftRightText(method, amount, style.isDoubleWidth) + '\n' + style.suffix;
          });
        }
        
        // Change
        if (receiptLayout.changeAmount?.visible !== false && change > 0) {
          const style = applyFontStyle(receiptLayout.changeAmount);
          content += style.prefix + leftRightText('Change:', `$${change.toFixed(2)}`, style.isDoubleWidth) + '\n' + style.suffix;
        }
        
        content += '\n';
        
        // Footer
        if (receiptLayout.greeting?.visible !== false) {
          const style = applyFontStyle(receiptLayout.greeting);
          content += ESCPOS.ALIGN_CENTER;
          content += style.prefix;
          content += centerText(receiptLayout.greeting?.text || footer.message || 'Thank you!', style.isDoubleWidth) + '\n';
          content += style.suffix;
        }
        
        if (receiptLayout.thankYouMessage?.visible !== false) {
          const style = applyFontStyle(receiptLayout.thankYouMessage);
          content += ESCPOS.ALIGN_CENTER;
          content += style.prefix;
          content += centerText(receiptLayout.thankYouMessage?.text || '*** THANK YOU ***', style.isDoubleWidth) + '\n';
          content += style.suffix;
        }
        
        content += '\n\n\n';
        content += ESCPOS.CUT;
        
        return content;
      };

      // Render receipt image for graphic mode
      function renderReceiptImage(receiptData, receiptLayout, paperWidth, storeInfo = {}, payments = [], change = 0) {
        const { header = {}, orderInfo = {}, items = [], guestSections = [], subtotal = 0, adjustments = [], taxLines = [], total = 0, footer = {} } = receiptData;

        // Font Scale: 프린터 DPI(203)와 화면 DPI(96) 차이 보정
        // 기본값 2.1 (203 / 96 ≈ 2.1) - 프리뷰와 동일한 시각적 크기로 출력
        const fontScale = receiptLayout.fontScale || 2.1;

        const PAPER_WIDTH_PX = paperWidth === 80 ? 576 : 384;
        const MARGIN = Math.max(4, Math.min(12, Math.round((receiptLayout.leftMargin || 0) * 2.835) + 4));
        const TOP_MARGIN = Math.round((receiptLayout.topMargin || 0) * 2.835) + 12;
        const CONTENT_WIDTH = PAPER_WIDTH_PX - (MARGIN * 2);

        // Calculate height (apply fontScale)
        let totalHeight = TOP_MARGIN + Math.round(40 * fontScale);
        if (receiptLayout.storeName?.visible !== false) totalHeight += Math.round(35 * fontScale);
        if (receiptLayout.storeAddress?.visible !== false) totalHeight += Math.round(20 * fontScale);
        if (receiptLayout.storePhone?.visible !== false) totalHeight += Math.round(20 * fontScale);
        totalHeight += Math.round(100 * fontScale); // Order info
        
        const sectionsToRender = guestSections.length > 0 ? guestSections : [{ guestNumber: 1, items }];
        sectionsToRender.forEach(section => {
          if (sectionsToRender.length > 1) totalHeight += Math.round(30 * fontScale);
          (section.items || []).forEach(item => {
            totalHeight += Math.round(25 * fontScale);
            if (item.modifiers) totalHeight += item.modifiers.length * Math.round(18 * fontScale);
            if (item.memo) totalHeight += Math.round(18 * fontScale);
          });
        });
        
        totalHeight += Math.round(150 * fontScale); // Subtotal, tax, total
        totalHeight += payments.length * Math.round(25 * fontScale) + Math.round(30 * fontScale); // Payment info
        // Footer 높이는 실제 렌더링에서 계산되므로 여기서는 최소화
        // 하단 여백 정확히 5mm = 40px @ 203 DPI (8px/mm)
        totalHeight += 40;

        const canvas = createCanvas(PAPER_WIDTH_PX, totalHeight);
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, PAPER_WIDTH_PX, totalHeight);

        // 첫 텍스트의 폰트 크기만큼 y 시작 위치 조정 (baseline 보정으로 상단 잘림 방지)
        const firstFontSize = Math.round((receiptLayout.storeName?.fontSize || 16) * fontScale);
        let y = TOP_MARGIN + firstFontSize;
        const centerX = PAPER_WIDTH_PX / 2;

        const drawText = (text, x, yPos, fontSize, fontWeight = 'normal', align = 'center', isItalic = false) => {
          const scaledFontSize = Math.round(fontSize * fontScale);
          const italicPrefix = isItalic ? 'italic ' : '';
          ctx.font = `${italicPrefix}${fontWeight} ${scaledFontSize}px Arial`;
          ctx.fillStyle = '#000000';
          ctx.textAlign = align;
          
          let displayText = text;
          if (align === 'center') {
            while (ctx.measureText(displayText).width > CONTENT_WIDTH && displayText.length > 5) {
              displayText = displayText.substring(0, displayText.length - 1);
            }
            if (displayText !== text) {
              displayText = displayText + '..';
            }
          }
          
          ctx.fillText(displayText, x, yPos);
        };
        
        const drawLeftRight = (leftText, rightText, yPos, fontSize, fontWeight = 'normal', isItalic = false) => {
          const scaledFontSize = Math.round(fontSize * fontScale);
          const italicPrefix = isItalic ? 'italic ' : '';
          ctx.font = `${italicPrefix}${fontWeight} ${scaledFontSize}px Arial`;
          ctx.fillStyle = '#000000';
          
          const rightWidth = ctx.measureText(rightText).width;
          const minGap = 2;
          const maxLeftWidth = CONTENT_WIDTH - rightWidth - minGap;
          
          let displayLeft = leftText;
          while (ctx.measureText(displayLeft).width > maxLeftWidth && displayLeft.length > 5) {
            displayLeft = displayLeft.substring(0, displayLeft.length - 1);
          }
          if (displayLeft !== leftText) {
            displayLeft = displayLeft + '..';
          }
          
          ctx.textAlign = 'left';
          ctx.fillText(displayLeft, MARGIN, yPos);
          ctx.textAlign = 'right';
          ctx.fillText(rightText, PAPER_WIDTH_PX - MARGIN - (CONTENT_WIDTH * 0.15), yPos);
        };

        const drawLine = (yPos, style = 'solid') => {
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 1;
          if (style === 'dashed') {
            ctx.setLineDash([8, 4]);
          } else if (style === 'dotted') {
            ctx.setLineDash([2, 2]);
          } else {
            ctx.setLineDash([]);
          }
          ctx.beginPath();
          ctx.moveTo(MARGIN, yPos);
          ctx.lineTo(PAPER_WIDTH_PX - MARGIN, yPos);
          ctx.stroke();
          ctx.setLineDash([]);
        };

        // Store Name (with fontScale) - 길면 여러 줄로 표시
        if (receiptLayout.storeName?.visible !== false && storeInfo.name) {
          const fontSize = receiptLayout.storeName?.fontSize || 16;
          const lineSpacing = receiptLayout.storeName?.lineSpacing || 0;
          const fontWeight = receiptLayout.storeName?.fontWeight === 'bold' ? 'bold' : 'normal';
          const scaledFontSize = Math.round(fontSize * fontScale);
          ctx.font = `${fontWeight} ${scaledFontSize}px Arial`;
          const nameWidth = ctx.measureText(storeInfo.name).width;
          // 프린터 출력 시 실제 가용 폭은 캔버스보다 작음 - 80mm 용지 기준 약 72mm (90%)
          const maxWidth = CONTENT_WIDTH * 0.85; // 약 470px (80mm 용지 기준)
          
          console.log(`🏪 [Receipt Store Name] nameWidth: ${nameWidth.toFixed(0)}px, maxWidth: ${maxWidth.toFixed(0)}px, split: ${nameWidth > maxWidth}`);
          
          if (nameWidth > maxWidth) {
            // 여러 줄로 분할 (공백 또는 문자 단위)
            const text = storeInfo.name;
            const lines = [];
            let currentLine = '';
            
            // 먼저 공백 기준으로 분할 시도
            const words = text.split(' ');
            if (words.length > 1) {
              words.forEach(word => {
                const testLine = currentLine ? `${currentLine} ${word}` : word;
                if (ctx.measureText(testLine).width > maxWidth) {
                  if (currentLine) lines.push(currentLine);
                  // 단어 자체가 너무 길면 문자 단위로 분할
                  if (ctx.measureText(word).width > maxWidth) {
                    let charLine = '';
                    for (const char of word) {
                      if (ctx.measureText(charLine + char).width > maxWidth) {
                        if (charLine) lines.push(charLine);
                        charLine = char;
                      } else {
                        charLine += char;
                      }
                    }
                    currentLine = charLine;
                  } else {
                    currentLine = word;
                  }
                } else {
                  currentLine = testLine;
                }
              });
            } else {
              // 공백 없는 긴 텍스트 - 문자 단위로 분할
              for (const char of text) {
                if (ctx.measureText(currentLine + char).width > maxWidth) {
                  if (currentLine) lines.push(currentLine);
                  currentLine = char;
                } else {
                  currentLine += char;
                }
              }
            }
            if (currentLine) lines.push(currentLine);
            
            console.log(`🏪 [Receipt Store Name] Split into ${lines.length} lines:`, lines);
            lines.forEach(line => {
              drawText(line, centerX, y, fontSize, fontWeight, 'center');
              y += Math.round(fontSize * fontScale) + lineSpacing;
            });
          } else {
            drawText(storeInfo.name, centerX, y, fontSize, fontWeight, 'center');
            y += Math.round(fontSize * fontScale) + lineSpacing;
          }
        }

        // Store Address (with fontScale)
        if (receiptLayout.storeAddress?.visible !== false && storeInfo.address) {
          const fontSize = receiptLayout.storeAddress?.fontSize || 10;
          const lineSpacing = receiptLayout.storeAddress?.lineSpacing || 0;
          drawText(storeInfo.address, centerX, y, fontSize, 'normal', 'center');
          y += Math.round(fontSize * fontScale) + lineSpacing;
        }

        // Store Phone (with fontScale)
        if (receiptLayout.storePhone?.visible !== false && storeInfo.phone) {
          const fontSize = receiptLayout.storePhone?.fontSize || 10;
          const lineSpacing = receiptLayout.storePhone?.lineSpacing || 0;
          drawText(storeInfo.phone, centerX, y, fontSize, 'normal', 'center');
          y += Math.round(fontSize * fontScale) + lineSpacing;
        }

        // Separator 1
        if (receiptLayout.separator1?.visible !== false) {
          y += Math.round(8 * fontScale);
          drawLine(y, receiptLayout.separator1?.style || 'solid');
          y += Math.round(12 * fontScale);
        }

        // Order Info (with fontScale)
        ctx.textAlign = 'left';
        if (receiptLayout.orderNumber?.visible !== false && header.orderNumber) {
          const fontSize = receiptLayout.orderNumber?.fontSize || 12;
          const lineSpacing = receiptLayout.orderNumber?.lineSpacing || 0;
          drawText(`Order#: ${header.orderNumber}`, MARGIN, y, fontSize, 'normal', 'left');
          y += Math.round(fontSize * fontScale) + lineSpacing;
        }

        if (receiptLayout.orderChannel?.visible !== false) {
          const fontSize = receiptLayout.orderChannel?.fontSize || 12;
          const lineSpacing = receiptLayout.orderChannel?.lineSpacing || 0;
          const channelInfo = header.channel || orderInfo.channel || '';
          const tableInfo = header.tableName || orderInfo.tableName || '';
          if (channelInfo || tableInfo) {
            drawText(`${channelInfo}${tableInfo ? ' - ' + tableInfo : ''}`, MARGIN, y, fontSize, 'normal', 'left');
            y += Math.round(fontSize * fontScale) + lineSpacing;
          }
        }

        if (receiptLayout.serverName?.visible !== false && (header.serverName || orderInfo.serverName)) {
          const fontSize = receiptLayout.serverName?.fontSize || 11;
          const lineSpacing = receiptLayout.serverName?.lineSpacing || 0;
          drawText(`Server: ${header.serverName || orderInfo.serverName}`, MARGIN, y, fontSize, 'normal', 'left');
          y += Math.round(fontSize * fontScale) + lineSpacing;
        }

        if (receiptLayout.dateTime?.visible !== false) {
          const fontSize = receiptLayout.dateTime?.fontSize || 11;
          const lineSpacing = receiptLayout.dateTime?.lineSpacing || 0;
          const now = new Date();
          const dateStr = now.toLocaleDateString('en-CA');
          const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
          drawText(`${dateStr} ${timeStr}`, MARGIN, y, fontSize, 'normal', 'left');
          y += Math.round(fontSize * fontScale) + lineSpacing;
        }

        // Separator 2
        if (receiptLayout.separator2?.visible !== false) {
          y += Math.round(8 * fontScale);
          drawLine(y, receiptLayout.separator2?.style || 'dashed');
          y += Math.round(12 * fontScale);
        }

        // Items (with fontScale)
        sectionsToRender.forEach((section, sIdx) => {
          if (sectionsToRender.length > 1) {
            const guestFontSize = 14;
            drawText(`--- Guest ${section.guestNumber || sIdx + 1} ---`, centerX, y, guestFontSize, 'bold', 'center');
            y += Math.round(20 * fontScale);
          }

          (section.items || []).forEach(item => {
            if (receiptLayout.items?.visible !== false) {
              const fontSize = receiptLayout.items?.fontSize || 12;
              const lineSpacing = receiptLayout.items?.lineSpacing || 0;
              const fontWeight = receiptLayout.items?.fontWeight === 'bold' ? 'bold' : 'normal';
              const qtyName = `${item.quantity || 1}x ${item.name}`;
              const price = `$${(item.totalPrice || item.price || 0).toFixed(2)}`;
              drawLeftRight(qtyName, price, y, fontSize, fontWeight);
              y += Math.round(fontSize * fontScale) + lineSpacing;
            }

            if (receiptLayout.modifiers?.visible !== false && item.modifiers && item.modifiers.length > 0) {
              const fontSize = receiptLayout.modifiers?.fontSize || 10;
              const lineSpacing = receiptLayout.modifiers?.lineSpacing || 0;
              const prefix = receiptLayout.modifiers?.prefix || '>>';
              item.modifiers.forEach(mod => {
                // Modifier 객체에서 이름 추출 - 여러 개면 각각 별도 줄에 출력
                const modNames = [];
                if (typeof mod === 'string') {
                  modNames.push(mod);
                } else if (mod.name) {
                  modNames.push(mod.name);
                } else if (mod.text) {
                  modNames.push(mod.text);
                } else if (mod.modifierName) {
                  modNames.push(mod.modifierName);
                } else if (mod.selectedEntries && Array.isArray(mod.selectedEntries)) {
                  mod.selectedEntries.forEach(e => modNames.push(e.name || e));
                } else if (mod.modifierNames && Array.isArray(mod.modifierNames)) {
                  mod.modifierNames.forEach(n => modNames.push(n));
                }
                // 각 modifier를 별도 줄에 출력
                modNames.forEach(modName => {
                  if (!modName) return;
                  const modText = `  ${prefix} ${modName}`;
                  const modPrice = mod.price ? `$${mod.price.toFixed(2)}` : '';
                  drawLeftRight(modText, modPrice, y, fontSize, 'normal');
                  y += Math.round(fontSize * fontScale) + lineSpacing;
                });
              });
            }

            if (receiptLayout.itemNote?.visible !== false && item.memo) {
              const fontSize = receiptLayout.itemNote?.fontSize || 10;
              const lineSpacing = receiptLayout.itemNote?.lineSpacing || 0;
              const prefix = receiptLayout.itemNote?.prefix || '->';
              drawText(`  ${prefix} ${item.memo.text || item.memo}`, MARGIN, y, fontSize, 'italic', 'left');
              y += Math.round(fontSize * fontScale) + lineSpacing;
            }
          });
        });

        // Separator 3
        if (receiptLayout.separator3?.visible !== false) {
          y += Math.round(8 * fontScale);
          drawLine(y, receiptLayout.separator3?.style || 'solid');
          y += Math.round(12 * fontScale);
        }

        // Subtotal (with fontScale)
        if (receiptLayout.subtotal?.visible !== false) {
          const fontSize = receiptLayout.subtotal?.fontSize || 12;
          const lineSpacing = receiptLayout.subtotal?.lineSpacing || 0;
          const fontWeight = receiptLayout.subtotal?.fontWeight === 'bold' ? 'bold' : 'normal';
          drawLeftRight('Subtotal:', `$${subtotal.toFixed(2)}`, y, fontSize, fontWeight);
          y += Math.round(fontSize * fontScale) + lineSpacing;
        }

        // Adjustments (with fontScale)
        if (receiptLayout.discount?.visible !== false) {
          const fontSize = receiptLayout.discount?.fontSize || 11;
          const lineSpacing = receiptLayout.discount?.lineSpacing || 0;
          adjustments.forEach(adj => {
            drawLeftRight(adj.label || 'Discount:', `$${adj.amount.toFixed(2)}`, y, fontSize, 'normal');
            y += Math.round(fontSize * fontScale) + lineSpacing;
          });
        }

        // Tax (with fontScale)
        const taxFontSize = receiptLayout.taxGST?.fontSize || 11;
        const taxLineSpacing = receiptLayout.taxGST?.lineSpacing || 0;
        taxLines.forEach(tax => {
          if (tax.name) {
            drawLeftRight(`${tax.name}:`, `$${(tax.amount || 0).toFixed(2)}`, y, taxFontSize, 'normal');
            y += Math.round(taxFontSize * fontScale) + taxLineSpacing;
          }
        });

        // Separator 4
        if (receiptLayout.separator4?.visible !== false) {
          y += Math.round(8 * fontScale);
          drawLine(y, receiptLayout.separator4?.style || 'solid');
          y += Math.round(12 * fontScale);
        }

        // Total (with fontScale)
        if (receiptLayout.total?.visible !== false) {
          const fontSize = receiptLayout.total?.fontSize || 14;
          const lineSpacing = receiptLayout.total?.lineSpacing || 0;
          const fontWeight = receiptLayout.total?.fontWeight === 'bold' ? 'bold' : 'normal';
          drawLeftRight('TOTAL:', `$${total.toFixed(2)}`, y, fontSize, fontWeight);
          y += Math.round(fontSize * fontScale) + lineSpacing;
        }

        y += Math.round(10 * fontScale);

        // Payment Info (with fontScale)
        if (receiptLayout.paymentMethod?.visible !== false && payments.length > 0) {
          const fontSize = receiptLayout.paymentMethod?.fontSize || 12;
          const lineSpacing = receiptLayout.paymentMethod?.lineSpacing || 0;
          drawText('--- Payment ---', centerX, y, fontSize, 'bold', 'center');
          y += Math.round(fontSize * fontScale) + lineSpacing;
          
          payments.forEach(p => {
            const method = p.method || 'Unknown';
            const amount = `$${(p.amount || 0).toFixed(2)}`;
            drawLeftRight(method, amount, y, fontSize, 'normal');
            y += Math.round(fontSize * fontScale) + lineSpacing;
          });
        }

        // Change (with fontScale)
        if (receiptLayout.changeAmount?.visible !== false && change > 0) {
          const fontSize = receiptLayout.changeAmount?.fontSize || 12;
          const lineSpacing = receiptLayout.changeAmount?.lineSpacing || 0;
          const fontWeight = receiptLayout.changeAmount?.fontWeight === 'bold' ? 'bold' : 'normal';
          drawLeftRight('Change:', `$${change.toFixed(2)}`, y, fontSize, fontWeight);
          y += Math.round(fontSize * fontScale) + lineSpacing;
        }

        y += Math.round(15 * fontScale);

        // Footer (with fontScale)
        if (receiptLayout.greeting?.visible !== false) {
          const fontSize = receiptLayout.greeting?.fontSize || 11;
          const lineSpacing = receiptLayout.greeting?.lineSpacing || 0;
          drawText(receiptLayout.greeting?.text || footer.message || 'Thank you!', centerX, y, fontSize, 'normal', 'center');
          y += Math.round(fontSize * fontScale) + lineSpacing;
        }

        if (receiptLayout.thankYouMessage?.visible !== false) {
          const fontSize = receiptLayout.thankYouMessage?.fontSize || 12;
          const lineSpacing = receiptLayout.thankYouMessage?.lineSpacing || 0;
          const fontWeight = receiptLayout.thankYouMessage?.fontWeight === 'bold' ? 'bold' : 'normal';
          drawText(receiptLayout.thankYouMessage?.text || '*** THANK YOU ***', centerX, y, fontSize, fontWeight, 'center');
          y += Math.round(fontSize * fontScale) + lineSpacing;
        }

        // 하단 여백 정확히 5mm (40px @ 203 DPI) - 캔버스 크롭
        const BOTTOM_MARGIN_5MM = 40;
        const finalHeight = y + BOTTOM_MARGIN_5MM;
        
        // 필요한 높이만큼만 새 캔버스 생성
        if (finalHeight < totalHeight) {
          const croppedCanvas = createCanvas(PAPER_WIDTH_PX, finalHeight);
          const croppedCtx = croppedCanvas.getContext('2d');
          croppedCtx.drawImage(canvas, 0, 0);
          return canvasToEscPosBitmap(croppedCanvas);
        }

        return canvasToEscPosBitmap(canvas);
      }

      // Print based on mode (multiple copies)
      for (let copyNum = 1; copyNum <= numCopies; copyNum++) {
        console.log(`📄 Printing Receipt copy ${copyNum}/${numCopies}...`);
        
        if (printMode === 'text') {
          const textContent = buildTextReceipt();
          await printEscPosToWindows(printerName, textContent);
        } else {
          const graphicContent = renderReceiptImage(receiptData, receiptLayout, paperWidth, storeInfo, payments, change);
          await printEscPosToWindows(printerName, graphicContent);
        }
      }

      console.log(`✅ Receipt printed successfully (${numCopies} copies)`);
      res.json({ success: true, message: `Receipt printed (${numCopies} copies)`, printer: printerName, copies: numCopies });

    } catch (err) {
      console.error('❌ Print-receipt error:', err);
      res.status(500).json({ success: false, error: err.message || 'Failed to print receipt' });
    }
  });

  return router;
};
