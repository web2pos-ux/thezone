/**
 * 그래픽 모드 프린터 유틸리티
 * 텍스트를 이미지로 렌더링하여 ESC/POS 비트맵으로 출력
 */

const { createCanvas, registerFont } = require('canvas');
const path = require('path');
const fs = require('fs');

// 프린터 설정
const PRINTER_CONFIG = {
  width: 576,           // 80mm 용지 기준 (203 DPI)
  dpi: 203,
  charWidth: 42,        // 42자 기준
  lineHeight: 24,       // 기본 줄 높이
  padding: 10,          // 좌우 여백
  fontSize: {
    small: 16,
    normal: 20,
    large: 28,
    xlarge: 36,
    xxlarge: 48
  }
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

/**
 * 이미지를 ESC/POS 래스터 비트맵으로 변환
 * @param {Buffer} imageData - RGBA 이미지 데이터
 * @param {number} width - 이미지 너비
 * @param {number} height - 이미지 높이
 * @returns {Buffer} ESC/POS 비트맵 데이터
 */
function imageToEscPosRaster(imageData, width, height) {
  // 너비를 8의 배수로 맞춤
  const alignedWidth = Math.ceil(width / 8) * 8;
  const bytesPerRow = alignedWidth / 8;
  
  const bitmapData = [];
  
  for (let y = 0; y < height; y++) {
    for (let byteX = 0; byteX < bytesPerRow; byteX++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = byteX * 8 + bit;
        if (x < width) {
          const idx = (y * width + x) * 4;
          const r = imageData[idx];
          const g = imageData[idx + 1];
          const b = imageData[idx + 2];
          const a = imageData[idx + 3];
          
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
  const header = ESC_POS.RASTER_BIT_IMAGE(alignedWidth, height);
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
    fontSize = PRINTER_CONFIG.fontSize.normal,
    fontWeight = 'normal',
    fontStyle = 'normal',
    align = 'left',
    inverse = false,
    lineHeight = null,
    paddingY = 4,
    extraBold = false  // Extra bold: draw text multiple times
  } = block;
  
  const actualLineHeight = lineHeight || fontSize + paddingY * 2;
  const width = PRINTER_CONFIG.width;
  const padding = PRINTER_CONFIG.padding;
  
  // 폰트 설정
  ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px "Arial", "Malgun Gothic", sans-serif`;
  
  if (inverse) {
    // 반전 모드: 검은 배경, 흰 글씨
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, y, width, actualLineHeight);
    ctx.fillStyle = '#FFFFFF';
  } else {
    ctx.fillStyle = '#000000';
  }
  
  // 텍스트 정렬
  let textX;
  const textWidth = ctx.measureText(text).width;
  
  switch (align) {
    case 'center':
      textX = (width - textWidth) / 2;
      break;
    case 'right':
      textX = width - textWidth - padding;
      break;
    default:
      textX = padding;
  }
  
  // 텍스트 그리기
  ctx.textBaseline = 'middle';
  const textY = y + actualLineHeight / 2;
  
  if (extraBold) {
    // Slightly bolder: draw text 3 times with small offset
    ctx.fillText(text, textX + 0.4, textY);
    ctx.fillText(text, textX - 0.4, textY);
  }
  ctx.fillText(text, textX, textY);
  
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
  const width = PRINTER_CONFIG.width;
  const padding = PRINTER_CONFIG.padding;
  const lineY = y + 8;
  
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = style === 'double' ? 2 : 1;
  
  if (style === 'dashed') {
    ctx.setLineDash([8, 4]);
  } else {
    ctx.setLineDash([]);
  }
  
  ctx.beginPath();
  ctx.moveTo(padding, lineY);
  ctx.lineTo(width - padding, lineY);
  ctx.stroke();
  
  if (style === 'double') {
    ctx.beginPath();
    ctx.moveTo(padding, lineY + 4);
    ctx.lineTo(width - padding, lineY + 4);
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
    fontSize = PRINTER_CONFIG.fontSize.normal,
    fontWeight = 'normal',
    inverse = false,
    lineHeight = null,
    paddingY = 4
  } = options;
  
  const actualLineHeight = lineHeight || fontSize + paddingY * 2;
  const width = PRINTER_CONFIG.width;
  const padding = PRINTER_CONFIG.padding;
  
  ctx.font = `${fontWeight} ${fontSize}px "Arial", "Malgun Gothic", sans-serif`;
  
  if (inverse) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, y, width, actualLineHeight);
    ctx.fillStyle = '#FFFFFF';
  } else {
    ctx.fillStyle = '#000000';
  }
  
  ctx.textBaseline = 'middle';
  const textY = y + actualLineHeight / 2;
  
  // 왼쪽 텍스트
  ctx.fillText(leftText, padding, textY);
  
  // 오른쪽 텍스트
  const rightWidth = ctx.measureText(rightText).width;
  ctx.fillText(rightText, width - rightWidth - padding, textY);
  
  return y + actualLineHeight;
}

/**
 * Kitchen Ticket 그래픽 렌더링
 * @param {Object} orderData - 주문 데이터
 * @returns {Buffer} ESC/POS 비트맵 데이터
 */
function renderKitchenTicketGraphic(orderData) {
  // 먼저 필요한 높이 계산
  let estimatedHeight = 200; // 기본 헤더/푸터
  const items = orderData.items || [];
  estimatedHeight += items.length * 80; // 각 아이템 (1.3x 크기 고려)
  items.forEach(item => {
    if (item.modifiers) estimatedHeight += item.modifiers.length * 40;
    if (item.memo || item.note) estimatedHeight += 40;
  });
  // 게스트 구분선 높이 추가
  const guestCountForHeight = [...new Set(items.map(item => item.guestNumber || item.guest_number || 1))];
  if (guestCountForHeight.length > 1) {
    estimatedHeight += guestCountForHeight.length * 50; // 각 게스트 구분선
  }
  // 하단 여백 추가 (잘림 방지)
  estimatedHeight += 80;
  estimatedHeight = Math.max(estimatedHeight, 300);
  
  // 캔버스 생성
  const canvas = createCanvas(PRINTER_CONFIG.width, estimatedHeight);
  const ctx = canvas.getContext('2d');
  
  // 배경 흰색
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, PRINTER_CONFIG.width, estimatedHeight);
  
  let y = 10;
  
  // 주문 정보 추출
  const header = orderData.header || {};
  const orderInfo = orderData.orderInfo || orderData;
  const orderNumber = header.orderNumber || orderInfo.orderNumber || orderData.orderNumber || '';
  const channel = (header.channel || orderInfo.channel || orderData.channel || orderInfo.orderType || orderData.orderType || 'DINE-IN').toUpperCase();
  const tableName = header.tableName || orderInfo.tableName || orderData.tableName || '';
  const customerName = orderInfo.customerName || orderData.customerName || '';
  const pickupTime = orderInfo.pickupTime || orderData.pickupTime || '';
  const pickupMinutes = orderInfo.pickupMinutes || orderData.pickupMinutes || '';
  const isPaid = orderData.isPaid || false;
  const isReprint = orderData.isReprint || false;
  const isAdditionalOrder = orderData.isAdditionalOrder || false;
  
  // === 헤더 (반전 + 큰 글씨) ===
  let headerText = '';
  if (channel === 'TOGO' || channel === 'ONLINE' || channel === 'PICKUP' || channel === 'FOR HERE' || channel === 'FORHERE') {
    // FOR HERE는 공백 포함 형태로 표시
    const displayChannel = (channel === 'FORHERE') ? 'FOR HERE' : channel;
    headerText = `${displayChannel} #${String(orderNumber).replace('#', '')}`;
  } else if (tableName) {
    headerText = tableName;
  } else {
    headerText = `#${String(orderNumber).replace('#', '')}`;
  }
  
  y = drawTextBlock(ctx, {
    text: headerText,
    fontSize: PRINTER_CONFIG.fontSize.xxlarge,
    fontWeight: 'bold',
    align: 'center',
    inverse: true
  }, y);
  
  // PICKUP 시간
  if (pickupTime || pickupMinutes) {
    const pickupDisplay = pickupTime || `${pickupMinutes} min`;
    y = drawTextBlock(ctx, {
      text: `PICKUP: ${pickupDisplay}`,
      fontSize: PRINTER_CONFIG.fontSize.large,
      fontWeight: 'bold',
      align: 'center'
    }, y);
  }
  
  // 상태 표시
  let statusText = '';
  if (isReprint) statusText = '** REPRINT **';
  else if (isAdditionalOrder) statusText = '** ADDITIONAL **';
  else if (isPaid) statusText = 'PAID';
  else statusText = 'UNPAID';
  
  y = drawTextBlock(ctx, {
    text: statusText,
    fontSize: PRINTER_CONFIG.fontSize.large,
    fontWeight: 'bold',
    align: 'center',
    inverse: !isPaid && !isReprint
  }, y);
  
  // 고객 이름
  if (customerName) {
    y = drawTextBlock(ctx, {
      text: `Customer: ${customerName}`,
      fontSize: PRINTER_CONFIG.fontSize.normal,
      align: 'center'
    }, y);
  }
  
  // 시간
  y = drawTextBlock(ctx, {
    text: new Date().toLocaleTimeString(),
    fontSize: PRINTER_CONFIG.fontSize.normal,
    align: 'center'
  }, y);
  
  // 구분선
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
    // Multiple guests - show guest separators
    guestNumbers.forEach((guestNum, guestIdx) => {
      const guestItems = items.filter(item => (item.guestNumber || item.guest_number || 1) === guestNum);
      
      if (guestItems.length > 0) {
        // Guest separator line
        y = drawTextBlock(ctx, {
          text: `---------- Guest ${guestNum} ----------`,
          fontSize: PRINTER_CONFIG.fontSize.large,
          fontWeight: 'bold',
          align: 'center'
        }, y);
        y += 5;
        
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
  
  // 구분선
  y = drawSeparator(ctx, y, 'solid');
  
  // 여백
  y += 30;
  
  // 실제 사용된 높이로 이미지 추출
  const imageData = ctx.getImageData(0, 0, PRINTER_CONFIG.width, y);
  
  return imageToEscPosRaster(imageData.data, PRINTER_CONFIG.width, y);
}

/**
 * Receipt 그래픽 렌더링
 * @param {Object} receiptData - 영수증 데이터
 * @returns {Buffer} ESC/POS 비트맵 데이터
 */
function renderReceiptGraphic(receiptData) {
  // 높이 추정
  let estimatedHeight = 400;
  const items = receiptData.items || [];
  const guestSections = receiptData.guestSections || [];
  
  if (guestSections.length > 0) {
    guestSections.forEach(section => {
      estimatedHeight += (section.items?.length || 0) * 40;
    });
  } else {
    estimatedHeight += items.length * 40;
  }
  estimatedHeight = Math.max(estimatedHeight, 500);
  
  const canvas = createCanvas(PRINTER_CONFIG.width, estimatedHeight);
  const ctx = canvas.getContext('2d');
  
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, PRINTER_CONFIG.width, estimatedHeight);
  
  let y = 10;
  
  // 데이터 추출
  const header = receiptData.header || {};
  const orderInfo = receiptData.orderInfo || receiptData;
  const storeName = header.storeName || receiptData.storeName || 'Restaurant';
  const storeAddress = header.storeAddress || receiptData.storeAddress || '';
  const storePhone = header.storePhone || receiptData.storePhone || '';
  const orderNumber = header.orderNumber || orderInfo.orderNumber || receiptData.orderNumber || '';
  const channel = (header.channel || orderInfo.channel || receiptData.channel || '').toUpperCase();
  const tableName = header.tableName || orderInfo.tableName || receiptData.tableName || '';
  const serverName = header.serverName || orderInfo.serverName || receiptData.serverName || '';
  
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
  let orderTypeText = channel || 'ORDER';
  if (tableName && !channel) orderTypeText = tableName;
  
  y = drawTextBlock(ctx, {
    text: `${orderTypeText} #${String(orderNumber).replace('#', '')}`,
    fontSize: PRINTER_CONFIG.fontSize.large,
    fontWeight: 'bold',
    align: 'center',
    inverse: true
  }, y);
  
  // 서버, 날짜
  if (serverName) {
    y = drawTextBlock(ctx, {
      text: `Server: ${serverName}`,
      fontSize: PRINTER_CONFIG.fontSize.small,
      align: 'left'
    }, y);
  }
  
  y = drawTextBlock(ctx, {
    text: `Date: ${new Date().toLocaleString()}`,
    fontSize: PRINTER_CONFIG.fontSize.small,
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
    } else {
      const itemName = entry.name || entry.itemName || '';
      const quantity = entry.quantity || entry.qty || 1;
      const price = Number(entry.price || entry.itemPrice || 0);
      const total = price * quantity;
      
      y = drawLeftRightText(ctx, `${quantity}x ${itemName}`, `$${total.toFixed(2)}`, y, {
        fontSize: PRINTER_CONFIG.fontSize.normal
      });
      
      // Modifiers
      const modifiers = entry.modifiers || [];
      modifiers.forEach(mod => {
        const modName = typeof mod === 'object' ? mod.name : mod;
        const modPrice = typeof mod === 'object' ? Number(mod.price || 0) : 0;
        if (modName) {
          const priceText = modPrice > 0 ? `$${modPrice.toFixed(2)}` : '';
          y = drawLeftRightText(ctx, `  + ${modName}`, priceText, y, {
            fontSize: PRINTER_CONFIG.fontSize.small
          });
        }
      });
    }
  });
  
  y = drawSeparator(ctx, y, 'dashed');
  
  // === 소계, 세금, 할인 ===
  if (receiptData.subtotal != null) {
    y = drawLeftRightText(ctx, 'Subtotal:', `$${Number(receiptData.subtotal).toFixed(2)}`, y, {
      fontSize: PRINTER_CONFIG.fontSize.normal
    });
  }
  
  // 세금
  if (receiptData.taxLines && receiptData.taxLines.length > 0) {
    receiptData.taxLines.forEach(tax => {
      y = drawLeftRightText(ctx, `${tax.name}:`, `$${Number(tax.amount).toFixed(2)}`, y, {
        fontSize: PRINTER_CONFIG.fontSize.normal
      });
    });
  }
  
  // 할인
  if (receiptData.adjustments && receiptData.adjustments.length > 0) {
    receiptData.adjustments.forEach(adj => {
      const amount = Number(adj.amount || 0);
      const label = adj.label || adj.name || 'Discount';
      const sign = amount < 0 ? '-' : '';
      y = drawLeftRightText(ctx, `${label}:`, `${sign}$${Math.abs(amount).toFixed(2)}`, y, {
        fontSize: PRINTER_CONFIG.fontSize.normal
      });
    });
  }
  
  y = drawSeparator(ctx, y, 'double');
  
  // === TOTAL (반전 + 큰 글씨) ===
  if (receiptData.total != null) {
    y = drawTextBlock(ctx, {
      text: `TOTAL: $${Number(receiptData.total).toFixed(2)}`,
      fontSize: PRINTER_CONFIG.fontSize.xlarge,
      fontWeight: 'bold',
      align: 'center',
      inverse: true
    }, y);
  }
  
  y = drawSeparator(ctx, y, 'solid');
  
  // === 결제 정보 ===
  if (receiptData.payments && receiptData.payments.length > 0) {
    y = drawTextBlock(ctx, {
      text: 'Payment',
      fontSize: PRINTER_CONFIG.fontSize.normal,
      fontWeight: 'bold',
      align: 'left'
    }, y);
    
    receiptData.payments.forEach(p => {
      y = drawLeftRightText(ctx, `  ${p.method}:`, `$${Number(p.amount).toFixed(2)}`, y, {
        fontSize: PRINTER_CONFIG.fontSize.normal
      });
    });
    
    // 거스름돈
    if (receiptData.change && Number(receiptData.change) > 0) {
      y = drawTextBlock(ctx, {
        text: `CHANGE: $${Number(receiptData.change).toFixed(2)}`,
        fontSize: PRINTER_CONFIG.fontSize.large,
        fontWeight: 'bold',
        align: 'center',
        inverse: true
      }, y);
    }
  }
  
  // === Footer ===
  y += 10;
  const footerMessage = receiptData.footer?.message || 'Thank you! Please come again!';
  y = drawTextBlock(ctx, {
    text: footerMessage,
    fontSize: PRINTER_CONFIG.fontSize.normal,
    fontWeight: 'bold',
    align: 'center',
    inverse: true
  }, y);
  
  y += 30;
  
  const imageData = ctx.getImageData(0, 0, PRINTER_CONFIG.width, y);
  return imageToEscPosRaster(imageData.data, PRINTER_CONFIG.width, y);
}

/**
 * Bill 그래픽 렌더링 (Receipt와 유사하지만 결제 정보 없음)
 * @param {Object} billData - Bill 데이터
 * @returns {Buffer} ESC/POS 비트맵 데이터
 */
function renderBillGraphic(billData) {
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

module.exports = {
  PRINTER_CONFIG,
  ESC_POS,
  imageToEscPosRaster,
  renderKitchenTicketGraphic,
  renderReceiptGraphic,
  renderBillGraphic,
  buildGraphicKitchenTicket,
  buildGraphicReceipt,
  buildGraphicBill
};
