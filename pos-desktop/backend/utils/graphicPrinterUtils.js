/**
 * 그래픽 모드 프린터 유틸리티
 * 텍스트를 이미지로 렌더링하여 ESC/POS 비트맵으로 출력
 */

const { createCanvas, registerFont } = require('canvas');
const path = require('path');
const fs = require('fs');

// 프린터 설정 (폰트 사이즈 15% 증가 적용)
const PRINTER_CONFIG = {
  width: 576,           // 80mm 용지 기준 (203 DPI)
  dpi: 203,
  charWidth: 42,        // 42자 기준
  lineHeight: 28,       // 기본 줄 높이 (15% 증가)
  padding: 10,          // 좌우 여백
  fontSize: {
    small: 18,          // 16 * 1.15 = 18
    normal: 23,         // 20 * 1.15 = 23
    large: 32,          // 28 * 1.15 = 32
    xlarge: 41,         // 36 * 1.15 = 41
    xxlarge: 55         // 48 * 1.15 = 55
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
    extraBold = false,  // Extra bold: draw text multiple times
    box = false,        // 텍스트 주변에 박스(테두리) 그리기
    boxPaddingX = 20    // 박스 좌우 패딩
  } = block;
  
  const actualLineHeight = lineHeight || fontSize + paddingY * 2;
  const width = PRINTER_CONFIG.width;
  const padding = PRINTER_CONFIG.padding;
  
  // 폰트 설정
  ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px "Arial", "Malgun Gothic", sans-serif`;
  
  // 텍스트 크기 측정
  const textWidth = ctx.measureText(text).width;
  
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
  
  // 박스 그리기 (텍스트 주변에 테두리)
  if (box) {
    const boxX = textX - boxPaddingX;
    const boxY = y + 2;
    const boxWidth = textWidth + boxPaddingX * 2;
    const boxHeight = actualLineHeight - 4;
    
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
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
  // 먼저 필요한 높이 계산 (15% 증가된 폰트 사이즈 반영)
  let estimatedHeight = 230; // 기본 헤더/푸터 (200 * 1.15)
  const items = orderData.items || [];
  estimatedHeight += items.length * 92; // 각 아이템 (80 * 1.15)
  items.forEach(item => {
    if (item.modifiers) estimatedHeight += item.modifiers.length * 46; // 40 * 1.15
    if (item.memo || item.note) estimatedHeight += 46; // 40 * 1.15
  });
  // 게스트 구분선 높이 추가
  const guestCountForHeight = [...new Set(items.map(item => item.guestNumber || item.guest_number || 1))];
  if (guestCountForHeight.length > 1) {
    estimatedHeight += guestCountForHeight.length * 58; // 각 게스트 구분선 (50 * 1.15)
  }
  // 하단 여백 추가 (잘림 방지)
  estimatedHeight += 92; // 80 * 1.15
  estimatedHeight = Math.max(estimatedHeight, 345); // 300 * 1.15
  
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
  // table 또는 tableName 둘 다 지원 (프론트엔드에서 table로 보내는 경우 대응)
  const tableName = header.tableName || orderInfo.tableName || orderData.tableName || orderInfo.table || orderData.table || '';
  const customerName = orderInfo.customerName || orderData.customerName || '';
  const customerPhone = orderInfo.customerPhone || orderData.customerPhone || '';
  const pickupTime = orderInfo.pickupTime || orderData.pickupTime || '';
  const pickupMinutes = orderInfo.pickupMinutes || orderData.pickupMinutes || '';
  const isPaid = orderData.isPaid || false;
  const isReprint = orderData.isReprint || false;
  const isAdditionalOrder = orderData.isAdditionalOrder || false;
  
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
  let headerText = '';
  if (channel === 'TOGO' || channel === 'ONLINE' || channel === 'PICKUP' || channel === 'FOR HERE' || channel === 'FORHERE') {
    // FOR HERE는 공백 포함 형태로 표시
    const displayChannel = (channel === 'FORHERE') ? 'FOR HERE' : channel;
    headerText = `${displayChannel} #${String(orderNumber).replace('#', '')}`;
  } else if (tableName) {
    // DINE-IN 채널이고 테이블 이름이 있으면 "Dine in T3" 형식
    // 테이블오더, 핸드헬드POS, 서브POS 등 테이블 기반 주문
    if (channel === 'DINE-IN' || channel === 'TABLE' || channel === 'HANDHELD' || channel === 'SUBPOS') {
      headerText = `Dine in ${tableName}`;
    } else {
      headerText = tableName;
    }
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
  
  // PICKUP 시간 (TOGO, ONLINE, PICKUP, DELIVERY 채널에서 표시)
  // 헤더와 함께 검은 배경으로 묶어서 출력
  const showPickupTime = (channel === 'TOGO' || channel === 'ONLINE' || channel === 'PICKUP' || channel === 'DELIVERY') && (pickupTime || pickupMinutes);
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
  const showCustomerInfo = (channel === 'TOGO' || channel === 'ONLINE' || channel === 'DELIVERY') && (customerName || customerPhone);
  if (showCustomerInfo) {
    let customerDisplay = '';
    if (customerName && customerPhone) {
      customerDisplay = `${customerName} · ${customerPhone}`;
    } else if (customerName) {
      customerDisplay = customerName;
    } else if (customerPhone) {
      customerDisplay = customerPhone;
    }
    
    y = drawTextBlock(ctx, {
      text: customerDisplay,
      fontSize: PRINTER_CONFIG.fontSize.large,  // Guest 번호와 동일한 폰트 사이즈
      fontWeight: 'bold',
      align: 'center'
    }, y);
  }
  
  // 상태 표시 (Dine-in, Delivery는 PAID/UNPAID 표시 안함)
  // Online은 PAID/UNPAID 표시함
  // REPRINT/ADDITIONAL은 이미 헤더 위에 표시되었으므로 여기서는 PAID/UNPAID만 처리
  const hidePaidStatus = channel === 'DINE-IN' || channel === 'TABLE' || channel === 'HANDHELD' || channel === 'SUBPOS' || channel === 'DELIVERY';
  let paidStatusText = '';
  if (!isReprint && !isAdditionalOrder) {
    // REPRINT/ADDITIONAL이 아닌 경우에만 PAID/UNPAID 표시
    if (!hidePaidStatus && isPaid) paidStatusText = 'PAID';
    else if (!hidePaidStatus) paidStatusText = 'UNPAID';
  }
  
  // PAID/UNPAID 폰트 사이즈 (Header의 80%)
  const paidStatusFontSize = Math.round(PRINTER_CONFIG.fontSize.xxlarge * 0.8);
  
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
  const alreadyShowedCustomer = (channel === 'TOGO' || channel === 'ONLINE' || channel === 'DELIVERY');
  if (customerName && !alreadyShowedCustomer) {
    y = drawTextBlock(ctx, {
      text: `Customer: ${customerName}`,
      fontSize: PRINTER_CONFIG.fontSize.normal,
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
  
  // 푸터: 주문 시간 (Guest 번호와 같은 폰트 사이즈)
  y += 10;
  y = drawTextBlock(ctx, {
    text: new Date().toLocaleTimeString(),
    fontSize: PRINTER_CONFIG.fontSize.large,  // Guest 번호와 동일한 사이즈
    fontWeight: 'bold',
    align: 'right'
  }, y);
  
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
    
    // 팁 표시
    const totalTip = receiptData.payments.reduce((sum, p) => sum + Number(p.tip || 0), 0);
    if (totalTip > 0) {
      y = drawLeftRightText(ctx, 'Tip:', `$${totalTip.toFixed(2)}`, y, {
        fontSize: PRINTER_CONFIG.fontSize.normal,
        fontWeight: 'bold'
      });
    }
    
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
