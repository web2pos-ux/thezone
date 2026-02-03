/**
 * API를 통해 기본 프린터 레이아웃 설정을 저장하는 스크립트
 */

const http = require('http');

// 기본 요소 스타일 생성 함수
const createDefaultElementStyle = (fontSize = 12, visible = true) => ({
  fontFamily: 'Arial',
  fontSize,
  lineSpacing: 8,
  fontWeight: 'regular',
  visible,
  separatorStyle: 'none',
});

// 기본 Kitchen 요소 스타일 생성 함수
const createKitchenElementStyle = (fontSize = 12, options = {}) => ({
  fontFamily: 'Arial',
  fontSize,
  lineSpacing: 8,
  fontWeight: options.fontWeight || 'regular',
  visible: options.visible !== false,
  separatorStyle: 'none',
  order: options.order || 0,
  inverse: options.inverse || false,
  isItalic: options.isItalic || false,
  textAlign: options.textAlign || 'left',
  showInHeader: options.showInHeader !== false,
  showInFooter: options.showInFooter || false,
  lineHeight: options.lineHeight || 0,
});

// 완전한 레이아웃 설정
const defaultLayoutSettings = {
  printMode: 'graphic',
  fontFamily: 'Arial',
  headerFontSize: 14,
  bodyFontSize: 12,
  footerFontSize: 10,
  lineSpacing: 12,
  paperWidth: 80,
  
  // Bill Layout
  billLayout: {
    printMode: 'graphic',
    paperWidth: 80,
    topMargin: 5,
    leftMargin: 0,
    fontScale: 2.0,
    storeName: { ...createDefaultElementStyle(16), fontWeight: 'bold', text: 'TheZone Restaurant' },
    storeAddress: { ...createDefaultElementStyle(10), text: '123 Main Street, Vancouver, BC' },
    storePhone: { ...createDefaultElementStyle(10), text: 'Tel: 778-123-4567', separatorStyle: 'solid' },
    separator1: { visible: true, style: 'solid' },
    separator2: { visible: true, style: 'dashed' },
    separator3: { visible: true, style: 'solid' },
    separator4: { visible: true, style: 'solid' },
    orderNumber: { ...createDefaultElementStyle(12) },
    orderChannel: { ...createDefaultElementStyle(12) },
    serverName: { ...createDefaultElementStyle(11) },
    dateTime: { ...createDefaultElementStyle(11), separatorStyle: 'dashed' },
    headerSeparator: { ...createDefaultElementStyle(12), separatorStyle: 'solid' },
    items: { ...createDefaultElementStyle(12) },
    modifiers: { ...createDefaultElementStyle(10), prefix: '>>' },
    itemNote: { ...createDefaultElementStyle(10), prefix: '->', isItalic: true },
    itemDiscount: { ...createDefaultElementStyle(10) },
    subtotal: { ...createDefaultElementStyle(12) },
    discount: { ...createDefaultElementStyle(11) },
    taxGST: { ...createDefaultElementStyle(11) },
    taxPST: { ...createDefaultElementStyle(11) },
    total: { ...createDefaultElementStyle(14), fontWeight: 'bold', separatorStyle: 'solid' },
    totalSeparator: { ...createDefaultElementStyle(12), separatorStyle: 'solid' },
    greeting: { ...createDefaultElementStyle(11), text: 'Thank you for dining with us!' },
  },
  
  // Receipt Layout
  receiptLayout: {
    printMode: 'graphic',
    paperWidth: 80,
    topMargin: 5,
    leftMargin: 0,
    fontScale: 2.0,
    storeName: { ...createDefaultElementStyle(16), fontWeight: 'bold', text: 'TheZone Restaurant' },
    storeAddress: { ...createDefaultElementStyle(10), text: '123 Main Street, Vancouver, BC' },
    storePhone: { ...createDefaultElementStyle(10), text: 'Tel: 778-123-4567' },
    separator1: { visible: true, style: 'solid' },
    separator2: { visible: true, style: 'dashed' },
    separator3: { visible: true, style: 'solid' },
    separator4: { visible: true, style: 'solid' },
    orderNumber: { ...createDefaultElementStyle(12) },
    orderChannel: { ...createDefaultElementStyle(12) },
    serverName: { ...createDefaultElementStyle(11) },
    dateTime: { ...createDefaultElementStyle(11) },
    items: { ...createDefaultElementStyle(12) },
    modifiers: { ...createDefaultElementStyle(10), prefix: '>>' },
    itemNote: { ...createDefaultElementStyle(10), prefix: '->', isItalic: true },
    itemDiscount: { ...createDefaultElementStyle(10) },
    subtotal: { ...createDefaultElementStyle(12) },
    discount: { ...createDefaultElementStyle(11) },
    taxGST: { ...createDefaultElementStyle(11) },
    taxPST: { ...createDefaultElementStyle(11) },
    total: { ...createDefaultElementStyle(14), fontWeight: 'bold' },
    paymentMethod: { ...createDefaultElementStyle(12) },
    paymentDetails: { ...createDefaultElementStyle(11) },
    changeAmount: { ...createDefaultElementStyle(12), fontWeight: 'bold', inverse: false },
    greeting: { ...createDefaultElementStyle(11), text: 'Thank you! Please come again!' },
    thankYouMessage: { ...createDefaultElementStyle(12), fontWeight: 'bold', text: '*** THANK YOU ***' },
  },
  
  // Kitchen Layout
  kitchenLayout: {
    printMode: 'graphic',
    paperWidth: 80,
    topMargin: 10,
    leftMargin: 0,
    fontScale: 1.0,
    orderType: createKitchenElementStyle(20, { fontWeight: 'bold', order: 1, inverse: true }),
    tableNumber: createKitchenElementStyle(24, { fontWeight: 'bold', order: 2, inverse: false }),
    posOrderNumber: createKitchenElementStyle(14, { order: 3, inverse: false }),
    externalOrderNumber: createKitchenElementStyle(12, { order: 4, inverse: false }),
    guestNumber: createKitchenElementStyle(16, { fontWeight: 'bold', order: 5, inverse: true }),
    separator1: { visible: true, style: 'solid' },
    splitSeparator: { visible: false, style: 'dashed' },
    separator2: { visible: true, style: 'solid' },
    serverName: createKitchenElementStyle(12, { order: 6, inverse: false }),
    dateTime: createKitchenElementStyle(12, { order: 7, inverse: false }),
    items: createKitchenElementStyle(14, { fontWeight: 'bold', order: 8, inverse: false }),
    modifiers: { ...createKitchenElementStyle(12, { order: 9, inverse: false }), prefix: '>>' },
    itemNote: { ...createKitchenElementStyle(12, { order: 10, inverse: false, isItalic: true }), prefix: '->' },
    pickupTime: createKitchenElementStyle(16, { fontWeight: 'bold', order: 11, inverse: true }),
    deliveryChannel: createKitchenElementStyle(14, { fontWeight: 'bold', order: 12, inverse: false }),
    customerName: createKitchenElementStyle(12, { order: 13, inverse: false }),
    customerPhone: createKitchenElementStyle(12, { order: 14, inverse: false }),
    deliveryAddress: createKitchenElementStyle(11, { order: 15, inverse: false }),
    paidStatus: createKitchenElementStyle(16, { fontWeight: 'bold', order: 16, inverse: true }),
    kitchenNote: createKitchenElementStyle(14, { fontWeight: 'bold', order: 150, inverse: false }),
    specialInstructions: { ...createKitchenElementStyle(12, { fontWeight: 'bold', order: 200, inverse: false }), text: '' },
    mergedElements: [],
  },
  
  // Dine-In Kitchen Settings
  dineInKitchen: {
    kitchenPrinter: {
      enabled: true,
      printerName: '',
      printMode: 'graphic',
      paperWidth: 80,
      topMargin: 10,
      leftMargin: 0,
      fontScale: 1.0,
      orderType: createKitchenElementStyle(20, { fontWeight: 'bold', order: 1, inverse: true }),
      tableNumber: createKitchenElementStyle(24, { fontWeight: 'bold', order: 2, inverse: false }),
      posOrderNumber: createKitchenElementStyle(14, { order: 3, inverse: false }),
      externalOrderNumber: createKitchenElementStyle(12, { order: 4, inverse: false }),
      guestNumber: createKitchenElementStyle(16, { fontWeight: 'bold', order: 5, inverse: true }),
      separator1: { visible: true, style: 'solid' },
      splitSeparator: { visible: false, style: 'dashed' },
      separator2: { visible: true, style: 'solid' },
      serverName: createKitchenElementStyle(12, { order: 6, inverse: false, showInHeader: true, showInFooter: true }),
      dateTime: createKitchenElementStyle(12, { order: 7, inverse: false, showInHeader: true, showInFooter: true }),
      items: createKitchenElementStyle(14, { fontWeight: 'bold', order: 8, inverse: false }),
      modifiers: { ...createKitchenElementStyle(12, { order: 9, inverse: false }), prefix: '>>' },
      itemNote: { ...createKitchenElementStyle(12, { order: 10, inverse: false, isItalic: true }), prefix: '->' },
      kitchenNote: createKitchenElementStyle(14, { fontWeight: 'bold', order: 150, inverse: false }),
      paidStatus: createKitchenElementStyle(16, { fontWeight: 'bold', order: 11, inverse: true, showInHeader: true, showInFooter: false }),
      specialInstructions: { ...createKitchenElementStyle(12, { fontWeight: 'bold', order: 200, inverse: false }), text: '' },
      mergedElements: [],
    },
    waitressPrinter: {
      enabled: false,
      printerName: '',
      printMode: 'graphic',
      paperWidth: 80,
      topMargin: 5,
      leftMargin: 0,
      fontScale: 1.0,
      orderType: createKitchenElementStyle(16, { fontWeight: 'bold', order: 1, inverse: false }),
      tableNumber: createKitchenElementStyle(20, { fontWeight: 'bold', order: 2, inverse: false }),
      posOrderNumber: createKitchenElementStyle(12, { order: 3, inverse: false }),
      externalOrderNumber: createKitchenElementStyle(10, { order: 4, inverse: false }),
      guestNumber: createKitchenElementStyle(14, { fontWeight: 'bold', order: 5, inverse: false }),
      separator1: { visible: true, style: 'dashed' },
      splitSeparator: { visible: false, style: 'dashed' },
      separator2: { visible: true, style: 'dashed' },
      serverName: createKitchenElementStyle(11, { order: 6, inverse: false, showInHeader: true, showInFooter: true }),
      dateTime: createKitchenElementStyle(11, { order: 7, inverse: false, showInHeader: true, showInFooter: true }),
      items: createKitchenElementStyle(12, { order: 8, inverse: false }),
      modifiers: { ...createKitchenElementStyle(10, { order: 9, inverse: false }), prefix: '>>' },
      itemNote: { ...createKitchenElementStyle(10, { order: 10, inverse: false, isItalic: true }), prefix: '->' },
      kitchenNote: createKitchenElementStyle(12, { fontWeight: 'bold', order: 150, inverse: false }),
      paidStatus: createKitchenElementStyle(14, { fontWeight: 'bold', order: 11, inverse: false, showInHeader: true, showInFooter: false }),
      specialInstructions: { ...createKitchenElementStyle(10, { order: 200, inverse: false }), text: '' },
      mergedElements: [],
    },
  },
  
  // External Kitchen Settings (Take-out)
  externalKitchen: {
    kitchenPrinter: {
      enabled: true,
      printerName: '',
      printMode: 'graphic',
      paperWidth: 80,
      topMargin: 10,
      leftMargin: 0,
      fontScale: 1.0,
      orderType: createKitchenElementStyle(20, { fontWeight: 'bold', order: 1, inverse: true }),
      tableNumber: createKitchenElementStyle(24, { fontWeight: 'bold', order: 2, inverse: false, showInHeader: false }),
      posOrderNumber: createKitchenElementStyle(14, { order: 3, inverse: false }),
      externalOrderNumber: createKitchenElementStyle(14, { fontWeight: 'bold', order: 4, inverse: true }),
      deliveryChannel: createKitchenElementStyle(18, { fontWeight: 'bold', order: 5, inverse: true }),
      pickupTime: createKitchenElementStyle(16, { fontWeight: 'bold', order: 6, inverse: true }),
      customerName: createKitchenElementStyle(12, { order: 7, inverse: false }),
      customerPhone: createKitchenElementStyle(12, { order: 8, inverse: false }),
      deliveryAddress: createKitchenElementStyle(11, { order: 9, inverse: false }),
      serverName: createKitchenElementStyle(12, { order: 10, inverse: false }),
      dateTime: createKitchenElementStyle(12, { order: 11, inverse: false }),
      guestNumber: createKitchenElementStyle(16, { fontWeight: 'bold', order: 12, inverse: true }),
      separator1: { visible: true, style: 'solid' },
      splitSeparator: { visible: false, style: 'dashed' },
      separator2: { visible: true, style: 'solid' },
      items: createKitchenElementStyle(14, { fontWeight: 'bold', order: 100, inverse: false }),
      modifiers: { ...createKitchenElementStyle(12, { order: 101, inverse: false }), prefix: '>>' },
      itemNote: { ...createKitchenElementStyle(12, { order: 102, inverse: false, isItalic: true }), prefix: '->' },
      kitchenNote: createKitchenElementStyle(14, { fontWeight: 'bold', order: 150, inverse: false }),
      paidStatus: createKitchenElementStyle(16, { fontWeight: 'bold', order: 13, inverse: true }),
      specialInstructions: { ...createKitchenElementStyle(12, { fontWeight: 'bold', order: 200, inverse: false }), text: '' },
      mergedElements: [],
    },
    waitressPrinter: {
      enabled: false,
      printerName: '',
      printMode: 'graphic',
      paperWidth: 80,
      topMargin: 5,
      leftMargin: 0,
      fontScale: 1.0,
      orderType: createKitchenElementStyle(16, { fontWeight: 'bold', order: 1, inverse: false }),
      tableNumber: createKitchenElementStyle(20, { fontWeight: 'bold', order: 2, inverse: false, showInHeader: false }),
      posOrderNumber: createKitchenElementStyle(12, { order: 3, inverse: false }),
      externalOrderNumber: createKitchenElementStyle(12, { fontWeight: 'bold', order: 4, inverse: false }),
      deliveryChannel: createKitchenElementStyle(14, { fontWeight: 'bold', order: 5, inverse: false }),
      pickupTime: createKitchenElementStyle(14, { fontWeight: 'bold', order: 6, inverse: false }),
      customerName: createKitchenElementStyle(11, { order: 7, inverse: false }),
      customerPhone: createKitchenElementStyle(11, { order: 8, inverse: false }),
      deliveryAddress: createKitchenElementStyle(10, { order: 9, inverse: false }),
      serverName: createKitchenElementStyle(11, { order: 10, inverse: false }),
      dateTime: createKitchenElementStyle(11, { order: 11, inverse: false }),
      guestNumber: createKitchenElementStyle(14, { fontWeight: 'bold', order: 12, inverse: false }),
      separator1: { visible: true, style: 'dashed' },
      splitSeparator: { visible: false, style: 'dashed' },
      separator2: { visible: true, style: 'dashed' },
      items: createKitchenElementStyle(12, { order: 100, inverse: false }),
      modifiers: { ...createKitchenElementStyle(10, { order: 101, inverse: false }), prefix: '>>' },
      itemNote: { ...createKitchenElementStyle(10, { order: 102, inverse: false, isItalic: true }), prefix: '->' },
      kitchenNote: createKitchenElementStyle(12, { fontWeight: 'bold', order: 150, inverse: false }),
      paidStatus: createKitchenElementStyle(14, { fontWeight: 'bold', order: 13, inverse: false }),
      specialInstructions: { ...createKitchenElementStyle(10, { order: 200, inverse: false }), text: '' },
      mergedElements: [],
    },
  },
  
  // Delivery Kitchen Settings
  deliveryKitchen: {
    kitchenPrinter: {
      enabled: true,
      printerName: '',
      printMode: 'graphic',
      paperWidth: 80,
      topMargin: 10,
      leftMargin: 0,
      fontScale: 1.0,
      orderType: createKitchenElementStyle(20, { fontWeight: 'bold', order: 1, inverse: true }),
      tableNumber: createKitchenElementStyle(24, { fontWeight: 'bold', order: 2, inverse: false, showInHeader: false }),
      posOrderNumber: createKitchenElementStyle(14, { order: 3, inverse: false }),
      externalOrderNumber: createKitchenElementStyle(14, { fontWeight: 'bold', order: 4, inverse: true }),
      deliveryChannel: createKitchenElementStyle(18, { fontWeight: 'bold', order: 5, inverse: true }),
      pickupTime: createKitchenElementStyle(16, { fontWeight: 'bold', order: 6, inverse: true }),
      customerName: createKitchenElementStyle(12, { order: 7, inverse: false }),
      customerPhone: createKitchenElementStyle(12, { order: 8, inverse: false }),
      deliveryAddress: createKitchenElementStyle(11, { order: 9, inverse: false }),
      serverName: createKitchenElementStyle(12, { order: 10, inverse: false }),
      dateTime: createKitchenElementStyle(12, { order: 11, inverse: false }),
      guestNumber: createKitchenElementStyle(16, { fontWeight: 'bold', order: 12, inverse: true }),
      separator1: { visible: true, style: 'solid' },
      splitSeparator: { visible: false, style: 'dashed' },
      separator2: { visible: true, style: 'solid' },
      items: createKitchenElementStyle(14, { fontWeight: 'bold', order: 100, inverse: false }),
      modifiers: { ...createKitchenElementStyle(12, { order: 101, inverse: false }), prefix: '>>' },
      itemNote: { ...createKitchenElementStyle(12, { order: 102, inverse: false, isItalic: true }), prefix: '->' },
      kitchenNote: createKitchenElementStyle(14, { fontWeight: 'bold', order: 150, inverse: false }),
      paidStatus: createKitchenElementStyle(16, { fontWeight: 'bold', order: 13, inverse: true }),
      specialInstructions: { ...createKitchenElementStyle(12, { fontWeight: 'bold', order: 200, inverse: false }), text: '' },
      mergedElements: [],
    },
    waitressPrinter: {
      enabled: false,
      printerName: '',
      printMode: 'graphic',
      paperWidth: 80,
      topMargin: 5,
      leftMargin: 0,
      fontScale: 1.0,
      orderType: createKitchenElementStyle(16, { fontWeight: 'bold', order: 1, inverse: false }),
      tableNumber: createKitchenElementStyle(20, { fontWeight: 'bold', order: 2, inverse: false, showInHeader: false }),
      posOrderNumber: createKitchenElementStyle(12, { order: 3, inverse: false }),
      externalOrderNumber: createKitchenElementStyle(12, { fontWeight: 'bold', order: 4, inverse: false }),
      deliveryChannel: createKitchenElementStyle(14, { fontWeight: 'bold', order: 5, inverse: false }),
      pickupTime: createKitchenElementStyle(14, { fontWeight: 'bold', order: 6, inverse: false }),
      customerName: createKitchenElementStyle(11, { order: 7, inverse: false }),
      customerPhone: createKitchenElementStyle(11, { order: 8, inverse: false }),
      deliveryAddress: createKitchenElementStyle(10, { order: 9, inverse: false }),
      serverName: createKitchenElementStyle(11, { order: 10, inverse: false }),
      dateTime: createKitchenElementStyle(11, { order: 11, inverse: false }),
      guestNumber: createKitchenElementStyle(14, { fontWeight: 'bold', order: 12, inverse: false }),
      separator1: { visible: true, style: 'dashed' },
      splitSeparator: { visible: false, style: 'dashed' },
      separator2: { visible: true, style: 'dashed' },
      items: createKitchenElementStyle(12, { order: 100, inverse: false }),
      modifiers: { ...createKitchenElementStyle(10, { order: 101, inverse: false }), prefix: '>>' },
      itemNote: { ...createKitchenElementStyle(10, { order: 102, inverse: false, isItalic: true }), prefix: '->' },
      kitchenNote: createKitchenElementStyle(12, { fontWeight: 'bold', order: 150, inverse: false }),
      paidStatus: createKitchenElementStyle(14, { fontWeight: 'bold', order: 13, inverse: false }),
      specialInstructions: { ...createKitchenElementStyle(10, { order: 200, inverse: false }), text: '' },
      mergedElements: [],
    },
  },
};

// API로 저장
const postData = JSON.stringify({ settings: defaultLayoutSettings });

const options = {
  hostname: 'localhost',
  port: 3177,
  path: '/api/printers/layout-settings',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData),
  },
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    if (res.statusCode === 200) {
      console.log('✅ 기본 레이아웃 설정이 데이터베이스에 저장되었습니다!');
      console.log('');
      console.log('저장된 레이아웃:');
      console.log('  - billLayout (Bill 레이아웃)');
      console.log('  - receiptLayout (Receipt 레이아웃)');
      console.log('  - kitchenLayout (Kitchen Ticket 기본 레이아웃)');
      console.log('  - dineInKitchen (Dine-In Kitchen Ticket)');
      console.log('  - externalKitchen (Take-out Kitchen Ticket)');
      console.log('  - deliveryKitchen (Delivery Kitchen Ticket)');
    } else {
      console.error('❌ 저장 실패:', res.statusCode, data);
    }
  });
});

req.on('error', (e) => {
  console.error('❌ API 요청 실패:', e.message);
  console.error('백엔드 서버가 실행 중인지 확인하세요.');
});

req.write(postData);
req.end();
