import React, { useState, useEffect } from 'react';
import { Edit, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import PrintLayoutEditor from '../components/PrintLayoutEditor';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3177/api';

// 프린터 슬롯 타입
interface PrinterSlot {
  id: number;
  name: string;
  type: 'receipt' | 'kitchen' | 'label' | '';
  selectedPrinter: string;
  graphicScale?: number; // per-device graphic print scale (0.5 ~ 1.5)
}

// 프린터 그룹 내 프린터 정보
interface GroupPrinter {
  printer_id: number;
  name: string;
  type: string;
  ip_address: string;
  copies: number;
}

// 프린터 그룹 타입
interface PrinterGroup {
  id: number;
  name: string;
  printerIds: number[]; // PrinterSlot IDs
  printers?: GroupPrinter[]; // 프린터 상세 정보 (copies 포함)
  show_label?: boolean; // 라벨 출력 여부
  display_order?: number; // 출력 순서 (작을수록 먼저)
}

// 시스템 프린터 타입
interface SystemPrinter {
  name: string;
  status?: string;
  isDefault?: boolean;
}

// 개별 요소 스타일 설정
interface ElementStyle {
  fontFamily: string;
  fontSize: number;
  lineSpacing: number;
  fontWeight: 'regular' | 'bold' | 'extrabold';
  isItalic?: boolean;  // Bold와 Italic 동시 적용 가능
  visible: boolean;
  separatorStyle: 'none' | 'solid' | 'dashed' | 'dotted';
}

// 구분선 설정
interface SeparatorStyle {
  visible: boolean;
  style: 'solid' | 'dashed' | 'dotted' | 'none';
}

// Bill 레이아웃 설정
interface BillLayoutSettings {
  printMode: 'graphic' | 'text';
  paperWidth: number;
  topMargin: number;
  leftMargin: number;
  fontScale: number;  // 프린터 출력 시 폰트 스케일 (기본 1.0, 권장 2.0)
  // Safe right padding (px) for amount column in graphic mode
  rightPaddingPx?: number;
  // Header Elements
  storeName: ElementStyle & { text: string };
  storeAddress: ElementStyle & { text: string };
  storePhone: ElementStyle & { text: string };
  // Separators (4개)
  separator1: SeparatorStyle; // 헤더 아래
  separator2: SeparatorStyle; // 주문정보 아래
  separator3: SeparatorStyle; // 아이템 아래 (Totals 위)
  separator4: SeparatorStyle; // Total 위
  // Body Elements
  orderNumber: ElementStyle;
  orderChannel: ElementStyle; // Dine-in이면 테이블번호 포함
  serverName: ElementStyle;
  dateTime: ElementStyle;
  headerSeparator: ElementStyle;
  items: ElementStyle; // 아이템, 수량, 금액
  modifiers: ElementStyle & { prefix: string }; // 모디파이어 + 표시 기호
  itemNote: ElementStyle & { prefix: string };   // 아이템 메모
  itemDiscount: ElementStyle;
  subtotal: ElementStyle;
  discount: ElementStyle;  // Subtotal 바로 아래
  taxGST: ElementStyle;
  taxPST: ElementStyle;
  total: ElementStyle;
  totalSeparator: ElementStyle;
  // Footer Elements
  greeting: ElementStyle & { text: string };
}

// Receipt 레이아웃 설정 (Bill + 결제 정보)
interface ReceiptLayoutSettings {
  printMode: 'graphic' | 'text';
  paperWidth: number;
  topMargin: number;
  leftMargin: number;
  fontScale: number;  // 프린터 출력 시 폰트 스케일 (기본 1.0, 권장 2.0)
  // Safe right padding (px) for amount column in graphic mode
  rightPaddingPx?: number;
  // Header Elements
  storeName: ElementStyle & { text: string };
  storeAddress: ElementStyle & { text: string };
  storePhone: ElementStyle & { text: string };
  // Separators (4개)
  separator1: SeparatorStyle;
  separator2: SeparatorStyle;
  separator3: SeparatorStyle;
  separator4: SeparatorStyle;
  // Body Elements
  orderNumber: ElementStyle;
  orderChannel: ElementStyle;
  serverName: ElementStyle;
  dateTime: ElementStyle;
  items: ElementStyle;
  modifiers: ElementStyle & { prefix: string };
  itemNote: ElementStyle & { prefix: string };
  itemDiscount: ElementStyle;
  subtotal: ElementStyle;
  discount: ElementStyle;
  taxGST: ElementStyle;
  taxPST: ElementStyle;
  total: ElementStyle;
  // Payment Elements (Receipt only)
  paymentMethod: ElementStyle;
  paymentDetails: ElementStyle;
  changeAmount: ElementStyle & { inverse: boolean };
  // Footer Elements
  greeting: ElementStyle & { text: string };
  thankYouMessage: ElementStyle & { text: string };
}

// Kitchen Element with order and inverse
interface KitchenElementStyle extends ElementStyle {
  order: number;       // 요소 순서 (위아래 이동용)
  inverse: boolean;    // 반전 (흰 배경에 검은 글씨 ↔ 검은 배경에 흰 글씨)
  isItalic?: boolean;  // Italic 스타일 (Bold/ExtraBold와 함께 사용 가능)
  textAlign?: 'left' | 'center' | 'right';  // 텍스트 정렬 (Date/Time 등에 사용)
  showInHeader?: boolean;  // Header에 표시 (PAID, DateTime, Server 용)
  showInFooter?: boolean;  // Footer에 표시 (PAID, DateTime, Server 용)
  lineHeight?: number;  // 줄간격 px 단위 (12 ~ 60px)
}

// 병합된 요소 (두 요소를 한 줄에 표시)
interface MergedElementItem {
  key: string;                   // 요소 키 (예: 'orderType')
  fontSize: number;              // 개별 폰트 사이즈
  lineSpacing: number;           // 개별 Top 마진
  lineHeight?: number;           // 개별 줄간격 (px)
  fontWeight: 'regular' | 'bold' | 'extrabold';  // 개별 폰트 굵기
  isItalic: boolean;             // 개별 이탤릭
  inverse: boolean;              // 개별 INVERSE
}

interface MergedElement {
  id: string;                    // 고유 ID
  leftElement: MergedElementItem;   // 왼쪽 요소
  rightElement: MergedElementItem;  // 오른쪽 요소
  alignment: 'left-center' | 'left-right' | 'center-center' | 'center-right';
  verticalAlign: 'top' | 'center' | 'bottom';  // 수직 정렬
  gap: number;                   // 요소 간 간격 (px) - C/C 등에서 사용
  order: number;                 // 병합된 요소의 순서
  lineInverse?: boolean;         // 줄 전체 INVERSE (배경 검정, 글자 흰색)
}

// Kitchen 프린터 타입별 레이아웃 설정
interface KitchenPrinterLayout {
  enabled: boolean;                    // 프린터 활성화 여부
  printerName: string;                 // 할당된 프린터 이름
  printMode: 'graphic' | 'text';
  paperWidth: number;
  topMargin: number;
  leftMargin: number;
  fontScale?: number;                  // 폰트 스케일 (기본 1.0, Epson은 1.2 권장)
  // Header Elements
  orderType: KitchenElementStyle;      // DINE-IN / TOGO / ONLINE / DELIVERY / QSR (Eat In/Togo)
  tableNumber: KitchenElementStyle;    // 테이블번호 (Dine-in)
  posOrderNumber: KitchenElementStyle;      // POS 내부 순차번호 (001, 002...)
  externalOrderNumber: KitchenElementStyle; // 외부 주문번호 (딜리버리 채널 원본)
  guestNumber: KitchenElementStyle;    // 게스트번호 (Split 시)
  // Separators
  separator1: SeparatorStyle;          // 헤더 아래
  splitSeparator: SeparatorStyle;      // Split 게스트 구분선
  separator2: SeparatorStyle;          // 아이템 위
  // Body Elements  
  serverName: KitchenElementStyle;
  dateTime: KitchenElementStyle;
  items: KitchenElementStyle;
  modifiers: KitchenElementStyle & { prefix: string };
  itemNote: KitchenElementStyle & { prefix: string };
  kitchenTicketElements?: KitchenElementStyle & { prefix: string; visible?: boolean };
  // Kitchen Note (Body 하단 고정)
  kitchenNote: KitchenElementStyle;    // 주방용 메모 출력
  // Status
  paidStatus: KitchenElementStyle;     // PAID / UNPAID
  // Footer
  specialInstructions: KitchenElementStyle & { text: string };
  // 병합된 요소들
  mergedElements?: MergedElement[];
}

// External 전용 추가 필드
interface ExternalKitchenPrinterLayout extends KitchenPrinterLayout {
  pickupTime: KitchenElementStyle;     // 픽업/배달 시간
  deliveryChannel: KitchenElementStyle; // DoorDash, UberEats 등
  customerName: KitchenElementStyle;   // 고객명
  customerPhone: KitchenElementStyle;  // 고객 전화번호
  deliveryAddress: KitchenElementStyle; // 배달 주소
}

// Dine-In Kitchen 설정 (Kitchen + Waitress)
interface DineInKitchenSettings {
  kitchenPrinter: KitchenPrinterLayout;   // 주방 프린터
  waitressPrinter: KitchenPrinterLayout;  // 서버용 확인 티켓
}

// External Kitchen 설정 (Kitchen + Waitress)
// ThezoneOrder (온라인), Togo Order (배달 없는 경우)
interface ExternalKitchenSettings {
  kitchenPrinter: ExternalKitchenPrinterLayout;   // 주방 프린터
  waitressPrinter: ExternalKitchenPrinterLayout;  // 서버용 확인 티켓
}

// Delivery Kitchen 설정 (Kitchen + Waitress)
// Uber Eats, DoorDash, SkiptheDishes, Tryotter, Urban Pipe, ThezoneOrder/Togo 배달 주문
interface DeliveryKitchenSettings {
  kitchenPrinter: ExternalKitchenPrinterLayout;   // 주방 프린터
  waitressPrinter: ExternalKitchenPrinterLayout;  // 서버용 확인 티켓
}

// 기존 호환성을 위한 Kitchen 레이아웃 설정
interface KitchenLayoutSettings {
  printMode: 'graphic' | 'text';
  paperWidth: number;
  topMargin: number;
  leftMargin: number;
  fontScale?: number;                  // 폰트 스케일 (기본 1.0, Epson은 1.2 권장)
  // Header Elements
  orderType: KitchenElementStyle;      // DINE-IN / TOGO / ONLINE / DELIVERY / QSR (Eat In/Togo)
  tableNumber: KitchenElementStyle;    // 테이블번호 (Dine-in)
  posOrderNumber: KitchenElementStyle;      // POS 내부 순차번호 (001, 002...)
  externalOrderNumber: KitchenElementStyle; // 외부 주문번호 (딜리버리 채널 원본)
  guestNumber: KitchenElementStyle;    // 게스트번호 (Split 시)
  // Separators
  separator1: SeparatorStyle;          // 헤더 아래
  splitSeparator: SeparatorStyle;      // Split 게스트 구분선
  separator2: SeparatorStyle;          // 아이템 위
  // Body Elements  
  serverName: KitchenElementStyle;
  dateTime: KitchenElementStyle;
  items: KitchenElementStyle;
  modifiers: KitchenElementStyle & { prefix: string };
  itemNote: KitchenElementStyle & { prefix: string };
  kitchenTicketElements?: KitchenElementStyle & { prefix: string; visible?: boolean };
  // Online/Delivery specific
  pickupTime: KitchenElementStyle;     // 픽업/배달 시간
  deliveryChannel: KitchenElementStyle; // DoorDash, UberEats 등
  customerName: KitchenElementStyle;   // 고객명
  customerPhone: KitchenElementStyle;  // 고객 전화번호
  deliveryAddress: KitchenElementStyle; // 배달 주소
  // Status
  paidStatus: KitchenElementStyle;     // PAID / UNPAID
  // Footer
  specialInstructions: KitchenElementStyle & { text: string };
  // Kitchen Note (Body 하단 고정)
  kitchenNote?: KitchenElementStyle;
  // 병합된 요소들
  mergedElements?: MergedElement[];
}

// 공통 스타일 설정
interface StyleSettings {
  topMargin: number;           // mm
  leftMargin: number;          // mm
  headerFontSize: number;      // pt
  bodyFontSize: number;        // pt
  footerFontSize: number;      // pt
  headerBold: boolean;
  totalBold: boolean;
  // 줄간격 (소숫점 지원)
  headerLineSpacing: number;   // 배수 (1.0 ~ 2.0)
  bodyLineSpacing: number;     // 배수
  footerLineSpacing: number;   // 배수
  // Kitchen 전용 간격
  itemGap: number;             // px (아이템-아이템 간격)
  modifierGap: number;         // px (아이템-모디파이어 간격)
}

// 프린트 모드 타입
type PrintMode = 'graphic' | 'text';

// 프린트 레이아웃 설정 타입
interface PrintLayoutSettings {
  printMode: PrintMode;  // Roll Graphic or Text Mode
  fontFamily: string;
  headerFontSize: number;
  bodyFontSize: number;
  footerFontSize: number;
  lineSpacing: number;
  paperWidth: number;
  
  // New Bill Layout
  billLayout: BillLayoutSettings;
  
  // New Receipt Layout
  receiptLayout: ReceiptLayoutSettings;
  
  // New Kitchen Layout
  kitchenLayout: KitchenLayoutSettings;
  
  // Dine-In Kitchen (Kitchen + Waitress)
  dineInKitchen: DineInKitchenSettings;
  
  // External Kitchen (Kitchen + Waitress)
  // ThezoneOrder (온라인), Togo Order (배달 없는 경우)
  externalKitchen: ExternalKitchenSettings;
  
  // Delivery Kitchen (Kitchen + Waitress)
  // Uber Eats, DoorDash, SkiptheDishes, Tryotter, Urban Pipe, ThezoneOrder/Togo 배달 주문
  deliveryKitchen: DeliveryKitchenSettings;
  
  bill: StyleSettings & {
    showStoreName: boolean;
    showStoreAddress: boolean;
    showStorePhone: boolean;
    showOrderNumber: boolean;
    showTableNumber: boolean;
    showServerName: boolean;
    showDateTime: boolean;
    showItemModifiers: boolean;
    showSubtotal: boolean;
    showTax: boolean;
    showGrandTotal: boolean;
    showFooterMessage: boolean;
    footerMessage: string;
    headerText: string;
  };
  
  receipt: StyleSettings & {
    showStoreName: boolean;
    showStoreAddress: boolean;
    showStorePhone: boolean;
    showOrderNumber: boolean;
    showTableNumber: boolean;
    showServerName: boolean;
    showDateTime: boolean;
    showItemModifiers: boolean;
    showSubtotal: boolean;
    showTax: boolean;
    showGrandTotal: boolean;
    showPaymentMethod: boolean;
    showPaymentDetails: boolean;
    showChangeAmount: boolean;
    showFooterMessage: boolean;
    footerMessage: string;
    thankYouMessage: string;
  };
  
  kitchen: StyleSettings & {
    showOrderNumber: boolean;
    showTableNumber: boolean;
    showServerName: boolean;
    showDateTime: boolean;
    showGuestSeparator: boolean;
    showItemModifiers: boolean;
    showItemNotes: boolean;
    showAdditionalOrderBanner: boolean;
    additionalOrderText: string;
    itemFontSize: number;
    modifierFontSize: number;
    headerText: string;
    // Hardware Settings
    deviceType: 'ROLL-GRAPHIC' | 'TEXT';
    portType: 'WINDOWS_DIRECT' | 'NETWORK' | 'USB';
    ip: string;
    printerName: string;
    printWidth: string;
    options: string;
    altName: 'STORE_SETTING' | 'CUSTOM';
    autoCut: boolean;
    copies: number;
    fontSizeHw: number;
    fontStyle: 'NORMAL' | 'BOLD' | 'ITALIC';
    font: string;
    textMaxOffset: string;
    paperWidth: string;
    paperHeight: string;
    marginLeft: string;
    marginRight: string;
    lineSpacingHw: number;
    sendDelay: 'IMMEDIATELY' | '1SEC' | '2SEC' | '5SEC';
    // Status Check
    statusCheckMethod: 'DISABLED' | 'PING' | 'SNMP';
    statusCheckIp: string;
    statusCheckPort: string;
    statusCheckFrequency: '5SEC' | '10SEC' | '30SEC' | '60SEC';
    failover: 'DISABLED' | 'ENABLED';
  };
}

// 기본 요소 스타일 생성 함수
const createDefaultElementStyle = (fontSize: number = 12, visible: boolean = true): ElementStyle => ({
  fontFamily: 'Arial',
  fontSize,
  lineSpacing: 8,  // Top spacing in px (margin-top)
  fontWeight: 'regular',
  visible,
  separatorStyle: 'none',
});

// ============================================
// ESC/POS 프린터와 동일한 Preview 헬퍼 함수들
// ============================================

// ESC/POS 폰트 크기 변환 (printerUtils.js와 동일)
// fontSize → 배율 정보 (1x, 2x, 3x)
const getEscPosFontScale = (fontSize: number): { scaleX: number; scaleY: number } => {
  // ESC/POS 프린터: 배율 1x/2x/3x
  if (fontSize >= 24) {
    return { scaleX: 3, scaleY: 3 }; // 3배
  } else if (fontSize >= 20) {
    return { scaleX: 2, scaleY: 2 }; // 2배
  } else if (fontSize >= 16) {
    return { scaleX: 1, scaleY: 2 }; // 세로 2배
  } else if (fontSize >= 14) {
    return { scaleX: 2, scaleY: 1 }; // 가로 2배
  }
  return { scaleX: 1, scaleY: 1 }; // 1배 (기본)
};

// Preview용 폰트 크기 계산 (설정값 기반, fontScale 적용)
// fontSize 10 → 10px, fontSize 20 → 20px (직관적)
const getPreviewFontSize = (fontSize: number, fontScale: number = 1.0): number => {
  // 설정값을 그대로 사용하고 fontScale만 적용
  return fontSize * fontScale;
};

// Preview용 문자 너비 계산 (가로 배율 적용)
const getPreviewLetterSpacing = (fontSize: number): string => {
  const { scaleX, scaleY } = getEscPosFontScale(fontSize);
  // 가로가 세로보다 크면 letter-spacing 추가
  if (scaleX > scaleY) {
    return `${(scaleX - scaleY) * 2}px`;
  }
  return 'normal';
};

// ESC/POS 구분선 문자열 생성 (프린터와 동일)
const getEscPosSeparator = (style: string, charCount: number = 42): string => {
  switch (style) {
    case 'dashed': return '-'.repeat(charCount);
    case 'dotted': return '·'.repeat(charCount);
    case 'solid': return '━'.repeat(charCount);
    default: return '─'.repeat(charCount);
  }
};

// 80mm 용지 기준 문자 수 (42자), 58mm는 32자
const getPaperCharWidth = (paperWidth: number): number => {
  return paperWidth === 58 ? 32 : 42;
};

// Preview 스타일 객체 생성 (ESC/POS 기반)
const getPreviewStyle = (
  element: { fontSize: number; fontWeight: string; isItalic?: boolean; lineSpacing?: number; inverse?: boolean; textAlign?: string },
  fontScale: number = 1.0
): React.CSSProperties => {
  const previewFontSize = getPreviewFontSize(element.fontSize, fontScale);
  const letterSpacing = getPreviewLetterSpacing(element.fontSize);
  
  return {
    fontSize: `${previewFontSize}px`,
    lineHeight: `${previewFontSize * 1.2}px`,
    letterSpacing,
    fontWeight: element.fontWeight === 'bold' || element.fontWeight === 'extrabold' ? 'bold' : 'normal',
    fontStyle: element.isItalic ? 'italic' : 'normal',
    marginTop: `${element.lineSpacing || 0}px`,
    textAlign: (element.textAlign as 'left' | 'center' | 'right') || 'left',
    ...(element.inverse ? {
      backgroundColor: '#000',
      color: '#fff',
      padding: '2px 8px',
      display: 'inline-block',
    } : {}),
  };
};

// Preview 반전 스타일 (전체 줄)
const getPreviewInverseLineStyle = (inverse: boolean): React.CSSProperties => {
  if (!inverse) return {};
  return {
    backgroundColor: '#000',
    color: '#fff',
    padding: '4px 16px',
    marginLeft: '-16px',
    marginRight: '-16px',
    width: 'calc(100% + 32px)',
  };
};

const defaultLayoutSettings: PrintLayoutSettings = {
  printMode: 'graphic',  // 기본값: Roll Graphic
  fontFamily: 'Arial',
  headerFontSize: 14,
  bodyFontSize: 12,
  footerFontSize: 10,
  lineSpacing: 12,  // px
  paperWidth: 80,
  
  // New Bill Layout
  billLayout: {
    printMode: 'graphic',
    paperWidth: 80,
    topMargin: 5,
    leftMargin: 0,
    fontScale: 2.0,  // 프린터 출력 시 폰트 스케일 (권장 2.0)
    rightPaddingPx: 40,
    // Header
    storeName: { ...createDefaultElementStyle(16), fontWeight: 'bold', text: 'TheZone Restaurant' },
    storeAddress: { ...createDefaultElementStyle(10), text: '123 Main Street, Vancouver, BC' },
    storePhone: { ...createDefaultElementStyle(10), text: 'Tel: 778-123-4567', separatorStyle: 'solid' },
    // Separators (4개)
    separator1: { visible: true, style: 'solid' },   // 헤더 아래
    separator2: { visible: true, style: 'dashed' },  // 주문정보 아래
    separator3: { visible: true, style: 'solid' },   // 아이템 아래
    separator4: { visible: true, style: 'solid' },   // Total 위
    // Body
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
    discount: { ...createDefaultElementStyle(11) },  // Subtotal 바로 아래
    taxGST: { ...createDefaultElementStyle(11) },
    taxPST: { ...createDefaultElementStyle(11) },
    total: { ...createDefaultElementStyle(14), fontWeight: 'bold', separatorStyle: 'solid' },
    totalSeparator: { ...createDefaultElementStyle(12), separatorStyle: 'solid' },
    // Footer
    greeting: { ...createDefaultElementStyle(11), text: 'Thank you for dining with us!' },
  },
  
  // New Receipt Layout
  receiptLayout: {
    printMode: 'graphic',
    paperWidth: 80,
    topMargin: 5,
    leftMargin: 0,
    fontScale: 2.0,  // 프린터 출력 시 폰트 스케일 (권장 2.0)
    rightPaddingPx: 40,
    // Header
    storeName: { ...createDefaultElementStyle(16), fontWeight: 'bold', text: 'TheZone Restaurant' },
    storeAddress: { ...createDefaultElementStyle(10), text: '123 Main Street, Vancouver, BC' },
    storePhone: { ...createDefaultElementStyle(10), text: 'Tel: 778-123-4567' },
    // Separators
    separator1: { visible: true, style: 'solid' },
    separator2: { visible: true, style: 'dashed' },
    separator3: { visible: true, style: 'solid' },
    separator4: { visible: true, style: 'solid' },
    // Body
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
    // Payment (Receipt only)
    paymentMethod: { ...createDefaultElementStyle(12) },
    paymentDetails: { ...createDefaultElementStyle(11) },
    changeAmount: { ...createDefaultElementStyle(12), fontWeight: 'bold', inverse: false },
    // Footer
    greeting: { ...createDefaultElementStyle(11), text: 'Thank you! Please come again!' },
    thankYouMessage: { ...createDefaultElementStyle(12), fontWeight: 'bold', text: '*** THANK YOU ***' },
  },
  
  // New Kitchen Layout
  kitchenLayout: {
    printMode: 'graphic',
    paperWidth: 80,
    topMargin: 15,
    leftMargin: 0,
    // Header
    orderType: { ...createDefaultElementStyle(20), fontWeight: 'bold', order: 1, inverse: true },
    tableNumber: { ...createDefaultElementStyle(24), fontWeight: 'bold', order: 2, inverse: false },
    posOrderNumber: { ...createDefaultElementStyle(14), order: 3, inverse: false },       // POS 순차번호 (001, 002...)
    externalOrderNumber: { ...createDefaultElementStyle(12), order: 4, inverse: false },  // 외부 주문번호
    guestNumber: { ...createDefaultElementStyle(16), fontWeight: 'bold', order: 5, inverse: true },
    // Separators
    separator1: { visible: true, style: 'solid' },
    splitSeparator: { visible: false, style: 'dashed' },
    separator2: { visible: true, style: 'solid' },
    // Body
    serverName: { ...createDefaultElementStyle(12), order: 5, inverse: false },
    dateTime: { ...createDefaultElementStyle(12), order: 6, inverse: false },
    items: { ...createDefaultElementStyle(14), fontWeight: 'bold', order: 7, inverse: false },
    modifiers: { ...createDefaultElementStyle(12), prefix: '>>', order: 8, inverse: false },
    itemNote: { ...createDefaultElementStyle(12), prefix: '->', isItalic: true, order: 9, inverse: false },
    // Online/Delivery specific
    pickupTime: { ...createDefaultElementStyle(16), fontWeight: 'bold', order: 10, inverse: true },
    deliveryChannel: { ...createDefaultElementStyle(14), fontWeight: 'bold', order: 11, inverse: false },
    customerName: { ...createDefaultElementStyle(12), order: 12, inverse: false },
    customerPhone: { ...createDefaultElementStyle(12), order: 13, inverse: false },
    deliveryAddress: { ...createDefaultElementStyle(11), order: 14, inverse: false },
    // Status
    paidStatus: { ...createDefaultElementStyle(16), fontWeight: 'bold', order: 15, inverse: true },
    // Footer
    specialInstructions: { ...createDefaultElementStyle(12), fontWeight: 'bold', order: 16, inverse: false, text: '' },
    // 병합된 요소들
    mergedElements: [],
  },
  
  // Dine-In Kitchen Settings (Kitchen Printer + Waitress Printer)
  dineInKitchen: {
    kitchenPrinter: {
      enabled: true,
      printerName: '',
      printMode: 'graphic',
      paperWidth: 80,
      topMargin: 15,
      leftMargin: 0,
      fontScale: 1.0,
      orderType: { ...createDefaultElementStyle(20), fontWeight: 'bold', order: 1, inverse: true },
      tableNumber: { ...createDefaultElementStyle(24), fontWeight: 'bold', order: 2, inverse: false },
      posOrderNumber: { ...createDefaultElementStyle(14), order: 3, inverse: false },
      externalOrderNumber: { ...createDefaultElementStyle(12), order: 4, inverse: false },
      guestNumber: { ...createDefaultElementStyle(16), fontWeight: 'bold', order: 5, inverse: true },
      separator1: { visible: true, style: 'solid' },
      splitSeparator: { visible: false, style: 'dashed' },
      separator2: { visible: true, style: 'solid' },
      serverName: { ...createDefaultElementStyle(12), order: 6, inverse: false, showInHeader: true, showInFooter: true },
      dateTime: { ...createDefaultElementStyle(12), order: 7, inverse: false, showInHeader: true, showInFooter: true },
      items: { ...createDefaultElementStyle(14), fontWeight: 'bold', order: 8, inverse: false },
      modifiers: { ...createDefaultElementStyle(12), prefix: '>>', order: 9, inverse: false },
      itemNote: { ...createDefaultElementStyle(12), prefix: '->', isItalic: true, order: 10, inverse: false },
      kitchenTicketElements: { ...createDefaultElementStyle(12), prefix: '  - ', order: 10.5, inverse: false, visible: true },
      kitchenNote: { ...createDefaultElementStyle(14), fontWeight: 'bold', order: 150, inverse: false, visible: true },
      paidStatus: { ...createDefaultElementStyle(16), fontWeight: 'bold', order: 11, inverse: true, showInHeader: true, showInFooter: false },
      specialInstructions: { ...createDefaultElementStyle(12), fontWeight: 'bold', order: 200, inverse: false, visible: true, text: '' },
      mergedElements: [],
    },
    waitressPrinter: {
      enabled: false,
      printerName: '',
      printMode: 'graphic',
      paperWidth: 80,
      topMargin: 15,
      leftMargin: 0,
      fontScale: 1.0,
      orderType: { ...createDefaultElementStyle(16), fontWeight: 'bold', order: 1, inverse: false },
      tableNumber: { ...createDefaultElementStyle(20), fontWeight: 'bold', order: 2, inverse: false },
      posOrderNumber: { ...createDefaultElementStyle(12), order: 3, inverse: false },
      externalOrderNumber: { ...createDefaultElementStyle(10), order: 4, inverse: false },
      guestNumber: { ...createDefaultElementStyle(14), fontWeight: 'bold', order: 5, inverse: false },
      separator1: { visible: true, style: 'dashed' },
      splitSeparator: { visible: false, style: 'dashed' },
      separator2: { visible: true, style: 'dashed' },
      serverName: { ...createDefaultElementStyle(11), order: 6, inverse: false, showInHeader: true, showInFooter: true },
      dateTime: { ...createDefaultElementStyle(11), order: 7, inverse: false, showInHeader: true, showInFooter: true },
      items: { ...createDefaultElementStyle(12), order: 8, inverse: false },
      modifiers: { ...createDefaultElementStyle(10), prefix: '>>', order: 9, inverse: false },
      itemNote: { ...createDefaultElementStyle(10), prefix: '->', isItalic: true, order: 10, inverse: false },
      kitchenTicketElements: { ...createDefaultElementStyle(10), prefix: '  - ', order: 10.5, inverse: false, visible: true },
      kitchenNote: { ...createDefaultElementStyle(12), fontWeight: 'bold', order: 150, inverse: false, visible: true },
      paidStatus: { ...createDefaultElementStyle(14), fontWeight: 'bold', order: 11, inverse: false, showInHeader: true, showInFooter: false },
      specialInstructions: { ...createDefaultElementStyle(10), order: 200, inverse: false, visible: true, text: '' },
      mergedElements: [],
    },
  },
  
  // External Kitchen Settings - Ticket for Take-out
  // ThezoneOrder (온라인), Togo Order (배달 없는 경우)
  // ⚠️ paidStatus 기본값: UNPAID
  // Firebase에서 온라인 결제가 완료된 경우에만 PAID로 표시
  externalKitchen: {
    kitchenPrinter: {
      enabled: true,
      printerName: '',
      printMode: 'graphic',
      paperWidth: 80,
      topMargin: 15,
      leftMargin: 0,
      fontScale: 1.0,
      orderType: { ...createDefaultElementStyle(20), fontWeight: 'bold', order: 1, inverse: true, showInHeader: true, showInFooter: false },
      tableNumber: { ...createDefaultElementStyle(24), fontWeight: 'bold', order: 2, inverse: false, showInHeader: false, showInFooter: false },
      posOrderNumber: { ...createDefaultElementStyle(14), order: 3, inverse: false, showInHeader: true, showInFooter: false },
      externalOrderNumber: { ...createDefaultElementStyle(14), fontWeight: 'bold', order: 4, inverse: true, showInHeader: true, showInFooter: false },
      deliveryChannel: { ...createDefaultElementStyle(18), fontWeight: 'bold', order: 5, inverse: true, showInHeader: true, showInFooter: false },
      pickupTime: { ...createDefaultElementStyle(16), fontWeight: 'bold', order: 6, inverse: true, showInHeader: true, showInFooter: false },
      customerName: { ...createDefaultElementStyle(12), order: 7, inverse: false, showInHeader: true, showInFooter: false },
      customerPhone: { ...createDefaultElementStyle(12), order: 8, inverse: false, showInHeader: true, showInFooter: false },
      deliveryAddress: { ...createDefaultElementStyle(11), order: 9, inverse: false, showInHeader: true, showInFooter: false },
      serverName: { ...createDefaultElementStyle(12), order: 10, inverse: false, showInHeader: true, showInFooter: false },
      dateTime: { ...createDefaultElementStyle(12), order: 11, inverse: false, showInHeader: true, showInFooter: false },
      guestNumber: { ...createDefaultElementStyle(16), fontWeight: 'bold', order: 12, inverse: true },
      separator1: { visible: true, style: 'solid' },
      splitSeparator: { visible: false, style: 'dashed' },
      separator2: { visible: true, style: 'solid' },
      items: { ...createDefaultElementStyle(14), fontWeight: 'bold', order: 100, inverse: false },
      modifiers: { ...createDefaultElementStyle(12), prefix: '>>', order: 101, inverse: false },
      itemNote: { ...createDefaultElementStyle(12), prefix: '->', isItalic: true, order: 102, inverse: false },
      kitchenTicketElements: { ...createDefaultElementStyle(12), prefix: '  - ', order: 102.5, inverse: false, visible: true },
      kitchenNote: { ...createDefaultElementStyle(14), fontWeight: 'bold', order: 150, inverse: false, visible: true },
      paidStatus: { ...createDefaultElementStyle(16), fontWeight: 'bold', order: 13, inverse: true, showInHeader: true, showInFooter: false },
      specialInstructions: { ...createDefaultElementStyle(12), fontWeight: 'bold', order: 200, inverse: false, visible: true, text: '' },
      mergedElements: [],
    },
    waitressPrinter: {
      enabled: false,
      printerName: '',
      printMode: 'graphic',
      paperWidth: 80,
      topMargin: 15,
      leftMargin: 0,
      fontScale: 1.0,
      orderType: { ...createDefaultElementStyle(16), fontWeight: 'bold', order: 1, inverse: false, showInHeader: true, showInFooter: false },
      tableNumber: { ...createDefaultElementStyle(20), fontWeight: 'bold', order: 2, inverse: false, showInHeader: false, showInFooter: false },
      posOrderNumber: { ...createDefaultElementStyle(12), order: 3, inverse: false, showInHeader: true, showInFooter: false },
      externalOrderNumber: { ...createDefaultElementStyle(12), fontWeight: 'bold', order: 4, inverse: false, showInHeader: true, showInFooter: false },
      deliveryChannel: { ...createDefaultElementStyle(14), fontWeight: 'bold', order: 5, inverse: false, showInHeader: true, showInFooter: false },
      pickupTime: { ...createDefaultElementStyle(14), fontWeight: 'bold', order: 6, inverse: false, showInHeader: true, showInFooter: false },
      customerName: { ...createDefaultElementStyle(11), order: 7, inverse: false, showInHeader: true, showInFooter: false },
      customerPhone: { ...createDefaultElementStyle(11), order: 8, inverse: false, showInHeader: true, showInFooter: false },
      deliveryAddress: { ...createDefaultElementStyle(10), order: 9, inverse: false, showInHeader: true, showInFooter: false },
      serverName: { ...createDefaultElementStyle(11), order: 10, inverse: false, showInHeader: true, showInFooter: false },
      dateTime: { ...createDefaultElementStyle(11), order: 11, inverse: false, showInHeader: true, showInFooter: false },
      guestNumber: { ...createDefaultElementStyle(14), fontWeight: 'bold', order: 12, inverse: false },
      separator1: { visible: true, style: 'dashed' },
      splitSeparator: { visible: false, style: 'dashed' },
      separator2: { visible: true, style: 'dashed' },
      items: { ...createDefaultElementStyle(12), order: 100, inverse: false },
      modifiers: { ...createDefaultElementStyle(10), prefix: '>>', order: 101, inverse: false },
      itemNote: { ...createDefaultElementStyle(10), prefix: '->', isItalic: true, order: 102, inverse: false },
      kitchenTicketElements: { ...createDefaultElementStyle(10), prefix: '  - ', order: 102.5, inverse: false, visible: true },
      kitchenNote: { ...createDefaultElementStyle(12), fontWeight: 'bold', order: 150, inverse: false, visible: true },
      paidStatus: { ...createDefaultElementStyle(14), fontWeight: 'bold', order: 13, inverse: false, showInHeader: true, showInFooter: false },
      specialInstructions: { ...createDefaultElementStyle(10), order: 200, inverse: false, visible: true, text: '' },
      mergedElements: [],
    },
  },
  
  // Delivery Kitchen Settings - Ticket for Delivery
  // Uber Eats, DoorDash, SkiptheDishes, Tryotter, Urban Pipe, ThezoneOrder/Togo 배달
  // ⚠️ 3rd Party 배달앱: 대부분 이미 결제됨 (PAID)
  // ThezoneOrder/Togo 배달: 기본 UNPAID, Firebase 온라인결제 시에만 PAID
  deliveryKitchen: {
    kitchenPrinter: {
      enabled: true,
      printerName: '',
      printMode: 'graphic',
      paperWidth: 80,
      topMargin: 15,
      leftMargin: 0,
      fontScale: 1.0,
      orderType: { ...createDefaultElementStyle(20), fontWeight: 'bold', order: 1, inverse: true, showInHeader: true, showInFooter: false },
      tableNumber: { ...createDefaultElementStyle(24), fontWeight: 'bold', order: 2, inverse: false, showInHeader: false, showInFooter: false },
      posOrderNumber: { ...createDefaultElementStyle(14), order: 3, inverse: false, showInHeader: true, showInFooter: false },
      externalOrderNumber: { ...createDefaultElementStyle(14), fontWeight: 'bold', order: 4, inverse: true, showInHeader: true, showInFooter: false },
      deliveryChannel: { ...createDefaultElementStyle(18), fontWeight: 'bold', order: 5, inverse: true, showInHeader: true, showInFooter: false },
      pickupTime: { ...createDefaultElementStyle(16), fontWeight: 'bold', order: 6, inverse: true, showInHeader: true, showInFooter: false },
      customerName: { ...createDefaultElementStyle(12), order: 7, inverse: false, showInHeader: true, showInFooter: false },
      customerPhone: { ...createDefaultElementStyle(12), order: 8, inverse: false, showInHeader: true, showInFooter: false },
      deliveryAddress: { ...createDefaultElementStyle(11), order: 9, inverse: false, showInHeader: true, showInFooter: false },
      serverName: { ...createDefaultElementStyle(12), order: 10, inverse: false, showInHeader: true, showInFooter: false },
      dateTime: { ...createDefaultElementStyle(12), order: 11, inverse: false, showInHeader: true, showInFooter: false },
      guestNumber: { ...createDefaultElementStyle(16), fontWeight: 'bold', order: 12, inverse: true },
      separator1: { visible: true, style: 'solid' },
      splitSeparator: { visible: false, style: 'dashed' },
      separator2: { visible: true, style: 'solid' },
      items: { ...createDefaultElementStyle(14), fontWeight: 'bold', order: 100, inverse: false },
      modifiers: { ...createDefaultElementStyle(12), prefix: '>>', order: 101, inverse: false },
      itemNote: { ...createDefaultElementStyle(12), prefix: '->', isItalic: true, order: 102, inverse: false },
      kitchenTicketElements: { ...createDefaultElementStyle(12), prefix: '  - ', order: 102.5, inverse: false, visible: true },
      kitchenNote: { ...createDefaultElementStyle(14), fontWeight: 'bold', order: 150, inverse: false, visible: true },
      paidStatus: { ...createDefaultElementStyle(16), fontWeight: 'bold', order: 13, inverse: true, showInHeader: true, showInFooter: false },
      specialInstructions: { ...createDefaultElementStyle(12), fontWeight: 'bold', order: 200, inverse: false, visible: true, text: '' },
      mergedElements: [],
    },
    waitressPrinter: {
      enabled: false,
      printerName: '',
      printMode: 'graphic',
      paperWidth: 80,
      topMargin: 15,
      leftMargin: 0,
      fontScale: 1.0,
      orderType: { ...createDefaultElementStyle(16), fontWeight: 'bold', order: 1, inverse: false, showInHeader: true, showInFooter: false },
      tableNumber: { ...createDefaultElementStyle(20), fontWeight: 'bold', order: 2, inverse: false, showInHeader: false, showInFooter: false },
      posOrderNumber: { ...createDefaultElementStyle(12), order: 3, inverse: false, showInHeader: true, showInFooter: false },
      externalOrderNumber: { ...createDefaultElementStyle(12), fontWeight: 'bold', order: 4, inverse: false, showInHeader: true, showInFooter: false },
      deliveryChannel: { ...createDefaultElementStyle(14), fontWeight: 'bold', order: 5, inverse: false, showInHeader: true, showInFooter: false },
      pickupTime: { ...createDefaultElementStyle(14), fontWeight: 'bold', order: 6, inverse: false, showInHeader: true, showInFooter: false },
      customerName: { ...createDefaultElementStyle(11), order: 7, inverse: false, showInHeader: true, showInFooter: false },
      customerPhone: { ...createDefaultElementStyle(11), order: 8, inverse: false, showInHeader: true, showInFooter: false },
      deliveryAddress: { ...createDefaultElementStyle(10), order: 9, inverse: false, showInHeader: true, showInFooter: false },
      serverName: { ...createDefaultElementStyle(11), order: 10, inverse: false, showInHeader: true, showInFooter: false },
      dateTime: { ...createDefaultElementStyle(11), order: 11, inverse: false, showInHeader: true, showInFooter: false },
      guestNumber: { ...createDefaultElementStyle(14), fontWeight: 'bold', order: 12, inverse: false },
      separator1: { visible: true, style: 'dashed' },
      splitSeparator: { visible: false, style: 'dashed' },
      separator2: { visible: true, style: 'dashed' },
      items: { ...createDefaultElementStyle(12), order: 100, inverse: false },
      modifiers: { ...createDefaultElementStyle(10), prefix: '>>', order: 101, inverse: false },
      itemNote: { ...createDefaultElementStyle(10), prefix: '->', isItalic: true, order: 102, inverse: false },
      kitchenTicketElements: { ...createDefaultElementStyle(10), prefix: '  - ', order: 102.5, inverse: false, visible: true },
      kitchenNote: { ...createDefaultElementStyle(12), fontWeight: 'bold', order: 150, inverse: false, visible: true },
      paidStatus: { ...createDefaultElementStyle(14), fontWeight: 'bold', order: 13, inverse: false, showInHeader: true, showInFooter: false },
      specialInstructions: { ...createDefaultElementStyle(10), order: 200, inverse: false, visible: true, text: '' },
      mergedElements: [],
    },
  },
  
  bill: {
    // Style Settings
    topMargin: 5,
    leftMargin: 0,
    headerFontSize: 14,
    bodyFontSize: 12,
    footerFontSize: 10,
    headerBold: true,
    totalBold: true,
    headerLineSpacing: 12,  // px
    bodyLineSpacing: 12,  // px
    footerLineSpacing: 10,  // px
    itemGap: 2,
    modifierGap: 0,
    // Content Settings
    showStoreName: true,
    showStoreAddress: true,
    showStorePhone: true,
    showOrderNumber: true,
    showTableNumber: true,
    showServerName: true,
    showDateTime: true,
    showItemModifiers: true,
    showSubtotal: true,
    showTax: true,
    showGrandTotal: true,
    showFooterMessage: true,
    footerMessage: 'Thank you for dining with us!',
    headerText: '',
  },
  
  receipt: {
    // Style Settings
    topMargin: 5,
    leftMargin: 0,
    headerFontSize: 14,
    bodyFontSize: 12,
    footerFontSize: 10,
    headerBold: true,
    totalBold: true,
    headerLineSpacing: 12,  // px
    bodyLineSpacing: 12,  // px
    footerLineSpacing: 10,  // px
    itemGap: 2,
    modifierGap: 0,
    // Content Settings
    showStoreName: true,
    showStoreAddress: true,
    showStorePhone: true,
    showOrderNumber: true,
    showTableNumber: true,
    showServerName: true,
    showDateTime: true,
    showItemModifiers: true,
    showSubtotal: true,
    showTax: true,
    showGrandTotal: true,
    showPaymentMethod: true,
    showPaymentDetails: true,
    showChangeAmount: true,
    showFooterMessage: true,
    footerMessage: 'Thank you! Please come again!',
    thankYouMessage: '*** THANK YOU ***',
  },
  
  kitchen: {
    // Style Settings
    topMargin: 15,
    leftMargin: 0,
    headerFontSize: 16,
    bodyFontSize: 14,
    footerFontSize: 12,
    headerBold: true,
    totalBold: false,
    headerLineSpacing: 0,
    bodyLineSpacing: 0,
    footerLineSpacing: 0,
    itemGap: 4,
    modifierGap: 2,
    // Content Settings
    showOrderNumber: true,
    showTableNumber: true,
    showServerName: true,
    showDateTime: true,
    showGuestSeparator: true,
    showItemModifiers: true,
    showItemNotes: true,
    showAdditionalOrderBanner: true,
    additionalOrderText: '** ADDITIONAL ORDER **',
    itemFontSize: 14,
    modifierFontSize: 12,
    headerText: '',
    // Hardware Settings
    deviceType: 'ROLL-GRAPHIC',
    portType: 'WINDOWS_DIRECT',
    ip: '',
    printerName: '',
    printWidth: 'DEFAULT',
    options: '',
    altName: 'STORE_SETTING',
    autoCut: false,
    copies: 1,
    fontSizeHw: 1.4,
    fontStyle: 'NORMAL',
    font: 'DEFAULT',
    textMaxOffset: 'DEFAULT',
    paperWidth: 'DEFAULT',
    paperHeight: 'DEFAULT',
    marginLeft: 'DEFAULT',
    marginRight: 'DEFAULT',
    lineSpacingHw: 0,
    sendDelay: 'IMMEDIATELY',
    // Status Check
    statusCheckMethod: 'DISABLED',
    statusCheckIp: '',
    statusCheckPort: '',
    statusCheckFrequency: '10SEC',
    failover: 'DISABLED',
  },
};

// 초기 5개 프린터 슬롯 생성
const createInitialPrinterSlots = (): PrinterSlot[] => {
  return Array.from({ length: 5 }, (_, i) => ({
    id: i + 1,
    name: '',
    type: '' as const,
    selectedPrinter: '',
    graphicScale: 1.0
  }));
};

// Kitchen 요소 레이블 매핑 (컴포넌트 외부로 이동)
const kitchenElementLabels: Record<string, string> = {
  orderType: 'Order Type',
  tableNumber: 'Table Number',
  posOrderNumber: 'POS Order #',
  externalOrderNumber: 'External Order #',
  guestNumber: 'Guest Number',
  serverName: 'Server Name',
  dateTime: 'Date/Time',
  items: 'Items',
  modifiers: 'Modifiers',
  itemNote: 'Memo',
  kitchenTicketElements: 'Kitchen Ticket Elements (On/Off)',
  paidStatus: 'PAID/UNPAID Status',
  pickupTime: 'Pickup Time',
  deliveryChannel: 'Delivery Channel',
  customerName: 'Customer Name',
  customerPhone: 'Customer Phone',
  deliveryAddress: 'Delivery Address',
  specialInstructions: 'Special Instructions',
};


export default function PrinterPage() {
  const [activeTab, setActiveTab] = useState<'printers' | 'newPrinter'>('printers');
  
  // Kitchen 프린터 타입 (Kitchen vs Waitress)
  const [kitchenPrinterType, setKitchenPrinterType] = useState<'kitchen' | 'waitress'>('kitchen');
  
  // 프린터 슬롯 (기본 5개, 추가 가능)
  const [printerSlots, setPrinterSlots] = useState<PrinterSlot[]>(createInitialPrinterSlots());
  const [printerSlotsLoaded, setPrinterSlotsLoaded] = useState(false);
  
  // 프린터 그룹
  const [printerGroups, setPrinterGroups] = useState<PrinterGroup[]>([]);
  const [printerGroupsLoaded, setPrinterGroupsLoaded] = useState(false);
  
  // 프린터 저장 상태
  const [printerSaveStatus, setPrinterSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  
  // 시스템 프린터 목록
  const [systemPrinters, setSystemPrinters] = useState<SystemPrinter[]>([]);
  
  // 프린터 선택 모달
  const [showPrinterModal, setShowPrinterModal] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  
  // 그룹 프린터 선택 모달
  const [showGroupPrinterModal, setShowGroupPrinterModal] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  
  const normalizeMergedElements = (mergedElements: MergedElement[] = []) =>
    mergedElements.map((merged, index) => ({ ...merged, order: index + 1 }));

  // 새 그룹 입력
  const [newGroupName, setNewGroupName] = useState('');
  
  // 레이아웃 설정
  const [layoutSettings, setLayoutSettings] = useState<PrintLayoutSettings>(defaultLayoutSettings);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);

  // 현재 선택된 탭과 프린터 타입에 맞는 레이아웃 설정 반환
  const getCurrentLayoutSettings = () => {
    return layoutSettings.kitchenLayout;
  };

  // 현재 선택된 레이아웃 설정 업데이트
  const updateCurrentLayoutSettings = (updates: any) => {
    updateLayoutSettings({
      ...layoutSettings,
      kitchenLayout: { ...layoutSettings.kitchenLayout, ...updates }
    });
  };

  const currentLayout = getCurrentLayoutSettings() as any;

  // 시스템 프린터 불러오기
  useEffect(() => {
    fetchSystemPrinters();
    loadLayoutSettings();
  }, []);

  // 프린터 슬롯 및 그룹 로드 (from API)
  useEffect(() => {
    const loadPrinters = async () => {
      try {
        const response = await fetch(`${API_URL}/printers`);
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data) && data.length > 0) {
            // API에서 받은 프린터 + 최소 5개 유지
            const result: PrinterSlot[] = data.map((p: any) => ({
              id: p.id,
              name: p.name || '',
              type: (p.type || '') as PrinterSlot['type'],
              selectedPrinter: p.selectedPrinter || '',
              graphicScale: (() => {
                const raw = p.graphicScale ?? p.graphic_scale ?? 1.0;
                const n = Number(raw);
                if (!Number.isFinite(n)) return 1.0;
                return Math.min(1.5, Math.max(0.5, Number(n.toFixed(2))));
              })()
            }));
            const maxId = result.length > 0 ? Math.max(...result.map(s => s.id)) : 0;
            while (result.length < 5) {
              result.push({ id: maxId + result.length + 1, name: '', type: '' as const, selectedPrinter: '' });
            }
            setPrinterSlots(result);
          }
        }
      } catch (error) {
        console.error('Failed to load printers:', error);
      }
      setPrinterSlotsLoaded(true);
    };
    
    const loadPrinterGroups = async () => {
      try {
        const response = await fetch(`${API_URL}/printers/groups`);
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data)) {
            setPrinterGroups(data);
          }
        }
      } catch (error) {
        console.error('Failed to load printer groups:', error);
      }
      setPrinterGroupsLoaded(true);
    };
    
    loadPrinters();
    loadPrinterGroups();
  }, []);

  // 프린터 저장 함수
  // 프린터와 그룹 데이터 다시 로드
  const reloadPrintersAndGroups = async () => {
    try {
      const [printersRes, groupsRes] = await Promise.all([
        fetch(`${API_URL}/printers`).then(r => r.ok ? r.json() : []),
        fetch(`${API_URL}/printers/groups`).then(r => r.ok ? r.json() : [])
      ]);
      
      // 프린터 슬롯 업데이트 (기존 빈 슬롯 유지)
      const loadedPrinters = Array.isArray(printersRes) ? printersRes : [];
      const newSlots = loadedPrinters.map((p: any) => ({
        id: p.id,
        name: p.name || '',
        type: p.type || '',
        selectedPrinter: p.selectedPrinter || p.selected_printer || '',
        graphicScale: (() => {
          const raw = p.graphicScale ?? p.graphic_scale ?? 1.0;
          const n = Number(raw);
          if (!Number.isFinite(n)) return 1.0;
          return Math.min(1.5, Math.max(0.5, Number(n.toFixed(2))));
        })()
      }));
      // 최소 5개 슬롯 유지
      while (newSlots.length < 5) {
        newSlots.push({
          id: Date.now() + newSlots.length,
          name: '',
          type: '' as const,
          selectedPrinter: '',
          graphicScale: 1.0
        });
      }
      setPrinterSlots(newSlots);
      setPrinterGroups(Array.isArray(groupsRes) ? groupsRes : []);
    } catch (error) {
      console.error('Failed to reload printers:', error);
    }
  };

  const savePrintersToDatabase = async () => {
    setPrinterSaveStatus('saving');
    console.log('[Frontend] Saving printers...');
    
    try {
      const printersToSave = printerSlots.filter(s => s.name.trim() !== '');
      console.log('[Frontend] Printers to save:', printersToSave);
      
      // 1. 프린터 저장 (UPSERT — existing IDs are preserved by the backend)
      const res1 = await fetch(`${API_URL}/printers/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printers: printersToSave.map((p, idx) => ({ ...p, sortOrder: idx, graphicScale: (typeof p.graphicScale === 'number' ? p.graphicScale : 1.0) })) })
      });
      
      if (!res1.ok) {
        const err = await res1.text();
        alert('Printer save failed: ' + err);
        setPrinterSaveStatus('idle');
        return;
      }
      
      const savedPrinters = await res1.json();
      console.log('[Frontend] Saved printers:', savedPrinters);
      
      // 2. ID mapping for newly created printers only
      const idMap: Record<number, number> = {};
      printersToSave.forEach((oldPrinter, idx) => {
        if (savedPrinters[idx] && oldPrinter.id !== savedPrinters[idx].id) {
          idMap[oldPrinter.id] = savedPrinters[idx].id;
        }
      });
      const hasIdChanges = Object.keys(idMap).length > 0;
      console.log('[Frontend] ID mapping:', hasIdChanges ? idMap : '(no changes)');
      
      // 3. 그룹의 printerIds 및 printers 배열을 업데이트 (변경된 ID만 매핑)
      const savedPrinterIds = new Set(savedPrinters.map((p: any) => p.id));
      const updatedGroups = printerGroups.map(group => ({
        ...group,
        printerIds: group.printerIds
          .map(oldId => idMap[oldId] !== undefined ? idMap[oldId] : oldId)
          .filter(id => savedPrinterIds.has(id)),
        printers: (group.printers || []).map(p => ({
          ...p,
          printer_id: idMap[p.printer_id] !== undefined ? idMap[p.printer_id] : p.printer_id
        })).filter(p => savedPrinterIds.has(p.printer_id))
      }));
      console.log('[Frontend] Updated groups:', updatedGroups);
      
      // 4. 그룹 저장 (UPSERT — existing group IDs are preserved by the backend)
      const res2 = await fetch(`${API_URL}/printers/groups/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups: updatedGroups })
      });
      
      if (!res2.ok) {
        const err = await res2.text();
        alert('Printer groups save failed: ' + err);
        setPrinterSaveStatus('idle');
        return;
      }
      
      // 5. 저장 후 데이터 다시 로드
      await reloadPrintersAndGroups();
      
      setPrinterSaveStatus('saved');
      alert('Printers saved successfully!');
      setTimeout(() => setPrinterSaveStatus('idle'), 2000);
    } catch (error) {
      console.error('Failed to save printers:', error);
      alert('Failed to save printers: ' + (error as Error).message);
      setPrinterSaveStatus('idle');
    }
  };

  // 프린터 슬롯 자동 저장 비활성화 (Save 버튼으로만 저장)
  // useEffect(() => {
  //   if (!printerSlotsLoaded) return;
  //   
  //   setPrinterSaveStatus('saving');
  //   const saveTimeout = setTimeout(async () => {
  //     try {
  //       const printersToSave = printerSlots.filter(s => s.name.trim() !== '' || s.type || s.selectedPrinter);
  //       await fetch(`${API_URL}/printers/batch`, {
  //         method: 'POST',
  //         headers: { 'Content-Type': 'application/json' },
  //         body: JSON.stringify({ printers: printersToSave.map((p, idx) => ({ ...p, sortOrder: idx })) })
  //       });
  //       setPrinterSaveStatus('saved');
  //       setTimeout(() => setPrinterSaveStatus('idle'), 2000);
  //     } catch (error) {
  //       console.error('Failed to save printers:', error);
  //       setPrinterSaveStatus('idle');
  //     }
  //   }, 500);
  //   
  //   return () => clearTimeout(saveTimeout);
  // }, [printerSlots, printerSlotsLoaded]);

  // 프린터 그룹 자동 저장 비활성화 (Save 버튼으로만 저장)
  // useEffect(() => {
  //   if (!printerGroupsLoaded) return;
  //   
  //   setPrinterSaveStatus('saving');
  //   const saveTimeout = setTimeout(async () => {
  //     try {
  //       await fetch(`${API_URL}/printers/groups/batch`, {
  //         method: 'POST',
  //         headers: { 'Content-Type': 'application/json' },
  //         body: JSON.stringify({ groups: printerGroups })
  //       });
  //       setPrinterSaveStatus('saved');
  //       setTimeout(() => setPrinterSaveStatus('idle'), 2000);
  //     } catch (error) {
  //       console.error('Failed to save printer groups:', error);
  //       setPrinterSaveStatus('idle');
  //     }
  //   }, 500);
  //   
  //   return () => clearTimeout(saveTimeout);
  // }, [printerGroups, printerGroupsLoaded]);

  const [isLoadingPrinters, setIsLoadingPrinters] = useState(false);
  const [printerLoadError, setPrinterLoadError] = useState<string | null>(null);

  const fetchSystemPrinters = async () => {
    setIsLoadingPrinters(true);
    setPrinterLoadError(null);
    try {
      console.log('Fetching system printers from:', `${API_URL}/printers/system`);
      const response = await fetch(`${API_URL}/printers/system`);
      if (response.ok) {
        const data = await response.json();
        console.log('System printers received:', data);
        setSystemPrinters(data);
        if (data.length === 0) {
          setPrinterLoadError('No printers found. Make sure printers are installed on this computer.');
        }
      } else {
        const errorText = await response.text();
        console.error('Failed to fetch printers:', response.status, errorText);
        setPrinterLoadError(`Failed to load printers: ${response.status}`);
      }
    } catch (error: any) {
      console.error('Failed to fetch system printers:', error);
      setPrinterLoadError(`Connection error: ${error.message}`);
    } finally {
      setIsLoadingPrinters(false);
    }
  };

  // 레이아웃 설정 로드 (깊은 병합)
  const loadLayoutSettings = async () => {
    setIsLoadingSettings(true);
    try {
      const response = await fetch(`${API_URL}/printers/layout-settings`);
      if (response.ok) {
        const data = await response.json();
        // backend `/printers/layout-settings` returns the raw settings object (not wrapped)
        const savedSettings = (data && typeof data === 'object' && (data as any).settings)
          ? (data as any).settings
          : data;
        if (savedSettings) {
          // 깊은 병합 - billLayout과 kitchen 등 중첩 객체도 병합
          const merged = {
            ...defaultLayoutSettings,
            ...savedSettings,
            billLayout: {
              ...defaultLayoutSettings.billLayout,
              ...(savedSettings.billLayout || {}),
            },
            receiptLayout: {
              ...defaultLayoutSettings.receiptLayout,
              ...(savedSettings.receiptLayout || {}),
            },
            kitchenLayout: {
              ...defaultLayoutSettings.kitchenLayout,
              ...(savedSettings.kitchenLayout || {}),
            },
            dineInKitchen: {
              kitchenPrinter: {
                ...defaultLayoutSettings.dineInKitchen.kitchenPrinter,
                ...(savedSettings.dineInKitchen?.kitchenPrinter || {}),
                // 개별 요소 깊은 병합 (paidStatus, specialInstructions, dateTime 등)
                paidStatus: {
                  ...defaultLayoutSettings.dineInKitchen.kitchenPrinter.paidStatus,
                  ...(savedSettings.dineInKitchen?.kitchenPrinter?.paidStatus || {}),
                },
                specialInstructions: {
                  ...defaultLayoutSettings.dineInKitchen.kitchenPrinter.specialInstructions,
                  ...(savedSettings.dineInKitchen?.kitchenPrinter?.specialInstructions || {}),
                },
                dateTime: {
                  ...defaultLayoutSettings.dineInKitchen.kitchenPrinter.dateTime,
                  ...(savedSettings.dineInKitchen?.kitchenPrinter?.dateTime || {}),
                },
              },
              waitressPrinter: {
                ...defaultLayoutSettings.dineInKitchen.waitressPrinter,
                ...(savedSettings.dineInKitchen?.waitressPrinter || {}),
                paidStatus: {
                  ...defaultLayoutSettings.dineInKitchen.waitressPrinter.paidStatus,
                  ...(savedSettings.dineInKitchen?.waitressPrinter?.paidStatus || {}),
                },
                specialInstructions: {
                  ...defaultLayoutSettings.dineInKitchen.waitressPrinter.specialInstructions,
                  ...(savedSettings.dineInKitchen?.waitressPrinter?.specialInstructions || {}),
                },
                dateTime: {
                  ...defaultLayoutSettings.dineInKitchen.waitressPrinter.dateTime,
                  ...(savedSettings.dineInKitchen?.waitressPrinter?.dateTime || {}),
                },
              },
            },
            externalKitchen: {
              kitchenPrinter: {
                ...defaultLayoutSettings.externalKitchen.kitchenPrinter,
                ...(savedSettings.externalKitchen?.kitchenPrinter || {}),
                deliveryChannel: {
                  ...defaultLayoutSettings.externalKitchen.kitchenPrinter.deliveryChannel,
                  ...(savedSettings.externalKitchen?.kitchenPrinter?.deliveryChannel || {}),
                },
                externalOrderNumber: {
                  ...defaultLayoutSettings.externalKitchen.kitchenPrinter.externalOrderNumber,
                  ...(savedSettings.externalKitchen?.kitchenPrinter?.externalOrderNumber || {}),
                },
                pickupTime: {
                  ...defaultLayoutSettings.externalKitchen.kitchenPrinter.pickupTime,
                  ...(savedSettings.externalKitchen?.kitchenPrinter?.pickupTime || {}),
                },
                serverName: {
                  ...defaultLayoutSettings.externalKitchen.kitchenPrinter.serverName,
                  ...(savedSettings.externalKitchen?.kitchenPrinter?.serverName || {}),
                },
                paidStatus: {
                  ...defaultLayoutSettings.externalKitchen.kitchenPrinter.paidStatus,
                  ...(savedSettings.externalKitchen?.kitchenPrinter?.paidStatus || {}),
                },
                specialInstructions: {
                  ...defaultLayoutSettings.externalKitchen.kitchenPrinter.specialInstructions,
                  ...(savedSettings.externalKitchen?.kitchenPrinter?.specialInstructions || {}),
                },
                dateTime: {
                  ...defaultLayoutSettings.externalKitchen.kitchenPrinter.dateTime,
                  ...(savedSettings.externalKitchen?.kitchenPrinter?.dateTime || {}),
                },
              },
              waitressPrinter: {
                ...defaultLayoutSettings.externalKitchen.waitressPrinter,
                ...(savedSettings.externalKitchen?.waitressPrinter || {}),
                deliveryChannel: {
                  ...defaultLayoutSettings.externalKitchen.waitressPrinter.deliveryChannel,
                  ...(savedSettings.externalKitchen?.waitressPrinter?.deliveryChannel || {}),
                },
                externalOrderNumber: {
                  ...defaultLayoutSettings.externalKitchen.waitressPrinter.externalOrderNumber,
                  ...(savedSettings.externalKitchen?.waitressPrinter?.externalOrderNumber || {}),
                },
                pickupTime: {
                  ...defaultLayoutSettings.externalKitchen.waitressPrinter.pickupTime,
                  ...(savedSettings.externalKitchen?.waitressPrinter?.pickupTime || {}),
                },
                serverName: {
                  ...defaultLayoutSettings.externalKitchen.waitressPrinter.serverName,
                  ...(savedSettings.externalKitchen?.waitressPrinter?.serverName || {}),
                },
                paidStatus: {
                  ...defaultLayoutSettings.externalKitchen.waitressPrinter.paidStatus,
                  ...(savedSettings.externalKitchen?.waitressPrinter?.paidStatus || {}),
                },
                specialInstructions: {
                  ...defaultLayoutSettings.externalKitchen.waitressPrinter.specialInstructions,
                  ...(savedSettings.externalKitchen?.waitressPrinter?.specialInstructions || {}),
                },
                dateTime: {
                  ...defaultLayoutSettings.externalKitchen.waitressPrinter.dateTime,
                  ...(savedSettings.externalKitchen?.waitressPrinter?.dateTime || {}),
                },
              },
            },
            deliveryKitchen: {
              kitchenPrinter: {
                ...defaultLayoutSettings.deliveryKitchen.kitchenPrinter,
                ...(savedSettings.deliveryKitchen?.kitchenPrinter || {}),
                paidStatus: {
                  ...defaultLayoutSettings.deliveryKitchen.kitchenPrinter.paidStatus,
                  ...(savedSettings.deliveryKitchen?.kitchenPrinter?.paidStatus || {}),
                },
                specialInstructions: {
                  ...defaultLayoutSettings.deliveryKitchen.kitchenPrinter.specialInstructions,
                  ...(savedSettings.deliveryKitchen?.kitchenPrinter?.specialInstructions || {}),
                },
                dateTime: {
                  ...defaultLayoutSettings.deliveryKitchen.kitchenPrinter.dateTime,
                  ...(savedSettings.deliveryKitchen?.kitchenPrinter?.dateTime || {}),
                },
              },
              waitressPrinter: {
                ...defaultLayoutSettings.deliveryKitchen.waitressPrinter,
                ...(savedSettings.deliveryKitchen?.waitressPrinter || {}),
                paidStatus: {
                  ...defaultLayoutSettings.deliveryKitchen.waitressPrinter.paidStatus,
                  ...(savedSettings.deliveryKitchen?.waitressPrinter?.paidStatus || {}),
                },
                specialInstructions: {
                  ...defaultLayoutSettings.deliveryKitchen.waitressPrinter.specialInstructions,
                  ...(savedSettings.deliveryKitchen?.waitressPrinter?.specialInstructions || {}),
                },
                dateTime: {
                  ...defaultLayoutSettings.deliveryKitchen.waitressPrinter.dateTime,
                  ...(savedSettings.deliveryKitchen?.waitressPrinter?.dateTime || {}),
                },
              },
            },
            bill: {
              ...defaultLayoutSettings.bill,
              ...(savedSettings.bill || {}),
            },
            receipt: {
              ...defaultLayoutSettings.receipt,
              ...(savedSettings.receipt || {}),
            },
            kitchen: {
              ...defaultLayoutSettings.kitchen,
              ...(savedSettings.kitchen || {}),
            },
          };
          // Courier New는 더 이상 지원하지 않음 - Arial로 강제 변경
          if (merged.fontFamily === 'Courier New') {
            merged.fontFamily = 'Arial';
          }

          const normalizeMergedElementsForPrinter = (printer: any) => {
            if (!printer?.mergedElements) return;
            printer.mergedElements = normalizeMergedElements(printer.mergedElements);
          };
          normalizeMergedElementsForPrinter(merged.kitchenLayout);
          normalizeMergedElementsForPrinter(merged.dineInKitchen?.kitchenPrinter);
          normalizeMergedElementsForPrinter(merged.dineInKitchen?.waitressPrinter);
          normalizeMergedElementsForPrinter(merged.externalKitchen?.kitchenPrinter);
          normalizeMergedElementsForPrinter(merged.externalKitchen?.waitressPrinter);
          normalizeMergedElementsForPrinter(merged.deliveryKitchen?.kitchenPrinter);
          normalizeMergedElementsForPrinter(merged.deliveryKitchen?.waitressPrinter);
          
          // External Kitchen order 마이그레이션 - 배달 관련 요소를 헤더로 이동
          const migrateExternalKitchenOrder = (printer: any) => {
            if (!printer) return;
            // 배달 관련 요소가 아직 높은 order (> 10)에 있으면 새 order로 업데이트
            if (printer.deliveryChannel?.order > 10) printer.deliveryChannel.order = 5;
            if (printer.pickupTime?.order > 10) printer.pickupTime.order = 6;
            if (printer.customerName?.order > 10) printer.customerName.order = 7;
            if (printer.customerPhone?.order > 10) printer.customerPhone.order = 8;
            if (printer.deliveryAddress?.order > 10) printer.deliveryAddress.order = 9;
            if (printer.serverName?.order > 10) printer.serverName.order = 10;
            if (printer.dateTime?.order > 15) printer.dateTime.order = 11;
            // paidStatus는 Header에 위치 (order 12~13) - 필수 속성 보장
            if (!printer.paidStatus) {
              printer.paidStatus = { fontFamily: 'Arial', fontSize: 16, lineSpacing: 0, fontWeight: 'bold', separatorStyle: 'none', order: 13, inverse: true, visible: true, showInHeader: true, showInFooter: false };
            } else {
              if (typeof printer.paidStatus.order !== 'number') printer.paidStatus.order = 13;
              if (printer.paidStatus.showInHeader === undefined) printer.paidStatus.showInHeader = true;
              if (printer.paidStatus.visible === undefined) printer.paidStatus.visible = true;
              if (printer.paidStatus.fontSize === undefined) printer.paidStatus.fontSize = 16;
              if (printer.paidStatus.fontWeight === undefined) printer.paidStatus.fontWeight = 'bold';
              if (printer.paidStatus.lineSpacing === undefined) printer.paidStatus.lineSpacing = 0;
            }
            if (printer.guestNumber?.order < 12) printer.guestNumber.order = 13;
            // Body 요소들
            if (printer.items?.order < 100) printer.items.order = 100;
            if (printer.modifiers?.order < 100) printer.modifiers.order = 101;
            if (printer.itemNote?.order < 100) printer.itemNote.order = 102;
            // Footer 요소들 - specialInstructions 필수 속성 보장
            if (!printer.specialInstructions) {
              printer.specialInstructions = { fontFamily: 'Arial', fontSize: 12, lineSpacing: 0, fontWeight: 'bold', order: 200, visible: true, inverse: false, text: '' };
            } else {
              if (typeof printer.specialInstructions.order !== 'number' || printer.specialInstructions.order < 200) printer.specialInstructions.order = 200;
              if (printer.specialInstructions.visible === undefined) printer.specialInstructions.visible = true;
              if (printer.specialInstructions.fontSize === undefined) printer.specialInstructions.fontSize = 12;
              if (printer.specialInstructions.lineSpacing === undefined) printer.specialInstructions.lineSpacing = 0;
            }
            // dateTime 필수 속성 보장
            if (!printer.dateTime) {
              printer.dateTime = { fontFamily: 'Arial', fontSize: 12, lineSpacing: 0, fontWeight: 'normal', order: 7, visible: true, inverse: false, showInHeader: true, showInFooter: true };
            } else {
              if (typeof printer.dateTime.order !== 'number') printer.dateTime.order = 7;
              if (printer.dateTime.visible === undefined) printer.dateTime.visible = true;
              if (printer.dateTime.fontSize === undefined) printer.dateTime.fontSize = 12;
              if (printer.dateTime.showInHeader === undefined) printer.dateTime.showInHeader = true;
              if (printer.dateTime.showInFooter === undefined) printer.dateTime.showInFooter = true;
            }
          };
          // dineInKitchen paidStatus 마이그레이션
          console.log('[Migration] Before migration - dineIn kitchenPrinter paidStatus:', JSON.stringify(merged.dineInKitchen?.kitchenPrinter?.paidStatus));
          console.log('[Migration] Before migration - dineIn kitchenPrinter specialInstructions:', JSON.stringify(merged.dineInKitchen?.kitchenPrinter?.specialInstructions));
          if (merged.dineInKitchen) {
            migrateExternalKitchenOrder(merged.dineInKitchen.kitchenPrinter);
            migrateExternalKitchenOrder(merged.dineInKitchen.waitressPrinter);
          }
          console.log('[Migration] After migration - dineIn kitchenPrinter paidStatus:', JSON.stringify(merged.dineInKitchen?.kitchenPrinter?.paidStatus));
          console.log('[Migration] After migration - dineIn kitchenPrinter specialInstructions:', JSON.stringify(merged.dineInKitchen?.kitchenPrinter?.specialInstructions));
          if (merged.externalKitchen) {
            migrateExternalKitchenOrder(merged.externalKitchen.kitchenPrinter);
            migrateExternalKitchenOrder(merged.externalKitchen.waitressPrinter);
          }
          if (merged.deliveryKitchen) {
            migrateExternalKitchenOrder(merged.deliveryKitchen.kitchenPrinter);
            migrateExternalKitchenOrder(merged.deliveryKitchen.waitressPrinter);
          }
          
          setLayoutSettings(merged);
        }
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      setIsLoadingSettings(false);
    }
  };

  // 레이아웃 설정 업데이트 (저장하지 않음)
  const updateLayoutSettings = (newSettings: PrintLayoutSettings) => {
    setLayoutSettings(newSettings);
    setHasUnsavedChanges(true);
  };

  // 레이아웃 설정 저장 (버튼 클릭 시)
  const handleSaveLayoutSettings = async () => {
    setSaveStatus('saving');
    
    try {
      localStorage.setItem('printLayoutSettings', JSON.stringify(layoutSettings));
      await fetch(`${API_URL}/printers/layout-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: layoutSettings })
      });
      setSaveStatus('saved');
      setHasUnsavedChanges(false);
    } catch (error) {
      console.error('Failed to save to DB:', error);
      alert('Failed to save settings');
      setSaveStatus('idle');
    }
  };

  // 프린터 슬롯 이름 변경
  const handleSlotNameChange = (slotId: number, name: string) => {
    setPrinterSlots(prev => prev.map(slot => 
      slot.id === slotId ? { ...slot, name } : slot
    ));
  };

  // 프린터 슬롯 타입 변경
  const handleSlotTypeChange = (slotId: number, type: PrinterSlot['type']) => {
    setPrinterSlots(prev => prev.map(slot => 
      slot.id === slotId ? { ...slot, type } : slot
    ));
  };

  const handleSlotGraphicScaleChange = (slotId: number, raw: string) => {
    setPrinterSlots(prev => prev.map(slot => {
      if (slot.id !== slotId) return slot;
      const n = raw === '' ? 1.0 : Number(raw);
      const next = Number.isFinite(n) ? Math.min(1.5, Math.max(0.5, Number(n.toFixed(2)))) : 1.0;
      return { ...slot, graphicScale: next };
    }));
  };

  // 프린터 선택 모달 열기
  const openPrinterModal = (slotId: number) => {
    setSelectedSlotId(slotId);
    setShowPrinterModal(true);
  };

  // 프린터 선택
  const selectPrinter = (printerName: string) => {
    if (selectedSlotId !== null) {
      setPrinterSlots(prev => prev.map(slot => 
        slot.id === selectedSlotId ? { ...slot, selectedPrinter: printerName } : slot
      ));
    }
    setShowPrinterModal(false);
    setSelectedSlotId(null);
  };

  // 프린터 슬롯 초기화
  const clearSlot = (slotId: number) => {
    setPrinterSlots(prev => prev.map(slot => 
      slot.id === slotId ? { ...slot, name: '', type: '' as const, selectedPrinter: '', graphicScale: 1.0 } : slot
    ));
  };

  // 새 프린터 슬롯 추가
  const addPrinterSlot = () => {
    const maxId = printerSlots.length > 0 ? Math.max(...printerSlots.map(s => s.id)) : 0;
    setPrinterSlots(prev => [...prev, { id: maxId + 1, name: '', type: '' as const, selectedPrinter: '', graphicScale: 1.0 }]);
  };

  // 프린터 슬롯 삭제 (이름이 없는 슬롯만)
  const deleteSlot = (slotId: number) => {
    const slot = printerSlots.find(s => s.id === slotId);
    if (slot?.name) {
      if (!window.confirm(`Delete printer "${slot.name}"?`)) return;
    }
    // 최소 5개 유지
    if (printerSlots.length <= 5) {
      clearSlot(slotId);
      return;
    }
    setPrinterSlots(prev => prev.filter(s => s.id !== slotId));
  };

  // 설정된 프린터만 가져오기 (이름이 있는 것)
  const getConfiguredPrinters = () => {
    return printerSlots.filter(slot => slot.name.trim() !== '');
  };

  // 새 그룹 추가 (바로 프린터 선택 모달 열기)
  const addNewGroup = () => {
    if (!newGroupName.trim()) {
      alert('Please enter a group name');
      return;
    }
    
    const newId = Date.now();
    setPrinterGroups(prev => {
      const maxOrder = prev.reduce((m, g) => Math.max(m, g.display_order ?? 0), -1);
      const newGroup: PrinterGroup = {
        id: newId,
        name: newGroupName.trim(),
        printerIds: [],
        show_label: true,
        display_order: maxOrder + 1
      };
      return [...prev, newGroup];
    });
    setNewGroupName('');
    
    // 바로 프린터 선택 모달 열기
    setSelectedGroupId(newId);
    setShowGroupPrinterModal(true);
  };

  // 그룹 삭제
  const deleteGroup = (groupId: number) => {
    if (!window.confirm('Are you sure you want to delete this group?')) return;
    setPrinterGroups(prev => prev.filter(g => g.id !== groupId));
  };

  // 그룹 프린터 선택 모달 열기
  const openGroupPrinterModal = (groupId: number) => {
    setSelectedGroupId(groupId);
    setShowGroupPrinterModal(true);
  };

  // 그룹에 프린터 토글
  const togglePrinterInGroup = (printerId: number) => {
    if (selectedGroupId === null) return;
    
    setPrinterGroups(prev => prev.map(group => {
      if (group.id === selectedGroupId) {
        const hasIt = group.printerIds.includes(printerId);
        return {
          ...group,
          printerIds: hasIt 
            ? group.printerIds.filter(id => id !== printerId)
            : [...group.printerIds, printerId]
        };
      }
      return group;
    }));
  };

  // 현재 선택된 그룹
  const currentGroup = printerGroups.find(g => g.id === selectedGroupId);

  // 그룹 순서 변경 (display_order로 출력 순서 결정 - Sushi Bar / Roll Bar 등)
  const moveGroupUp = (groupId: number) => {
    const sorted = [...printerGroups].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
    const idx = sorted.findIndex(g => g.id === groupId);
    if (idx <= 0) return;
    const prev = sorted[idx - 1];
    const curr = sorted[idx];
    setPrinterGroups(prevGroups => {
      const next = prevGroups.map(g => {
        if (g.id === prev.id) return { ...g, display_order: curr.display_order ?? idx };
        if (g.id === curr.id) return { ...g, display_order: prev.display_order ?? idx - 1 };
        return g;
      });
      return next;
    });
  };
  const moveGroupDown = (groupId: number) => {
    const sorted = [...printerGroups].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
    const idx = sorted.findIndex(g => g.id === groupId);
    if (idx < 0 || idx >= sorted.length - 1) return;
    const curr = sorted[idx];
    const next = sorted[idx + 1];
    setPrinterGroups(prevGroups => {
      const result = prevGroups.map(g => {
        if (g.id === curr.id) return { ...g, display_order: next.display_order ?? idx + 1 };
        if (g.id === next.id) return { ...g, display_order: curr.display_order ?? idx };
        return g;
      });
      return result;
    });
  };

  // 토글 컴포넌트
  const Toggle = ({ checked, onChange, label, description }: { 
    checked: boolean; 
    onChange: (value: boolean) => void; 
    label: string;
    description?: string;
  }) => (
    <div className="flex items-center justify-between py-2 border-b border-gray-100">
      <div className="flex-1">
        <p className="text-sm font-medium text-gray-800">{label}</p>
        {description && <p className="text-xs text-gray-500">{description}</p>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-12 h-6 rounded-full transition-colors ${
          checked ? 'bg-blue-600' : 'bg-gray-300'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );

  // Kitchen Element Row 컴포넌트 (순서 이동 + Inverse 지원)
  const KitchenElementRow = ({
    label,
    element,
    onChange,
    onMoveUp,
    onMoveDown,
    showTextInput,
    textValue,
    onTextChange,
    showAlignment,
  }: {
    label: string;
    element: KitchenElementStyle;
    onChange: (updated: Partial<KitchenElementStyle>) => void;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    showTextInput?: boolean;
    textValue?: string;
    onTextChange?: (text: string) => void;
    showAlignment?: boolean;
  }) => (
    <div className="py-2 border-b border-gray-200 last:border-b-0">
      <div className="flex items-center gap-1.5">
        {/* 순서 이동 버튼 (함수가 제공될 때만 렌더링, 아니면 공간 유지) */}
        {(onMoveUp || onMoveDown) ? (
          <div className="flex flex-col gap-0.5">
            {onMoveUp && <button onClick={onMoveUp} className="w-5 h-5 bg-gray-200 hover:bg-gray-300 rounded text-xs flex items-center justify-center" title="Move Up">▲</button>}
            {onMoveDown && <button onClick={onMoveDown} className="w-5 h-5 bg-gray-200 hover:bg-gray-300 rounded text-xs flex items-center justify-center" title="Move Down">▼</button>}
          </div>
        ) : (
          /* 드래그 핸들 공간 맞춤 (25px) */
          <div className="w-[25px]" />
        )}
        
        {/* Visible toggle */}
        <button
          onClick={() => onChange({ visible: !element.visible })}
          className={`w-6 h-6 rounded flex items-center justify-center text-xs ${element.visible ? 'bg-green-500 text-white' : 'bg-gray-300 text-gray-600'}`}
          title={element.visible ? 'Visible' : 'Hidden'}
        >{element.visible ? '✓' : '–'}</button>
        
        {/* Inverse toggle */}
        <button
          onClick={() => onChange({ inverse: !element.inverse })}
          className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold ${element.inverse ? 'bg-black text-white' : 'bg-white text-black border border-gray-400'}`}
          title={element.inverse ? 'Inverse ON' : 'Inverse OFF'}
        >I</button>
        
        {/* Label */}
        <span className="text-sm font-medium text-gray-700 flex-1 truncate" title={label}>{label}</span>
        
        {/* Text Alignment (if showAlignment) */}
        {showAlignment && (
          <div className="flex gap-0.5">
            <button onClick={() => onChange({ textAlign: 'left' })} className={`px-1.5 py-1 text-xs rounded ${element.textAlign === 'left' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`} disabled={!element.visible} title="Left">L</button>
            <button onClick={() => onChange({ textAlign: 'center' })} className={`px-1.5 py-1 text-xs rounded ${(!element.textAlign || element.textAlign === 'center') ? 'bg-blue-600 text-white' : 'bg-gray-200'}`} disabled={!element.visible} title="Center">C</button>
            <button onClick={() => onChange({ textAlign: 'right' })} className={`px-1.5 py-1 text-xs rounded ${element.textAlign === 'right' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`} disabled={!element.visible} title="Right">R</button>
          </div>
        )}
        
        {/* Font Size */}
        <div className="flex items-center gap-1">
          <span className="text-sm text-gray-400">Size</span>
          <input type="number" value={element.fontSize} onChange={(e) => onChange({ fontSize: parseInt(e.target.value) || 12 })} className="w-12 p-1 border rounded text-sm text-center" min={8} max={32} disabled={!element.visible} />
        </div>
        
        {/* Top Spacing (margin-top in px) */}
        <div className="flex items-center gap-1">
          <span className="text-sm text-gray-400">Top</span>
          <input type="number" value={element.lineSpacing} onChange={(e) => onChange({ lineSpacing: parseInt(e.target.value) || 0 })} className="w-12 p-1 border rounded text-sm text-center" step={1} min={0} max={50} disabled={!element.visible} />
        </div>
        
        {/* R/B/B+/I Style */}
        <div className="flex gap-0.5">
          <button onClick={() => onChange({ fontWeight: 'regular' })} className={`px-1.5 py-1 text-xs rounded ${element.fontWeight === 'regular' ? 'bg-gray-700 text-white' : 'bg-gray-200'}`} disabled={!element.visible} title="Regular">R</button>
          <button onClick={() => onChange({ fontWeight: 'bold' })} className={`px-1.5 py-1 text-xs rounded font-bold ${element.fontWeight === 'bold' ? 'bg-gray-700 text-white' : 'bg-gray-200'}`} disabled={!element.visible} title="Bold">B</button>
          <button onClick={() => onChange({ fontWeight: 'extrabold' })} className={`px-1.5 py-1 text-xs rounded ${element.fontWeight === 'extrabold' ? 'bg-gray-700 text-white' : 'bg-gray-200'}`} disabled={!element.visible} title="Extra Bold" style={{ fontWeight: 900 }}>B+</button>
          <button onClick={() => onChange({ isItalic: !element.isItalic })} className={`px-1.5 py-1 text-xs rounded italic ${element.isItalic ? 'bg-blue-600 text-white' : 'bg-gray-200'}`} disabled={!element.visible} title="Italic (Toggle)">I</button>
        </div>
      </div>
      
      {/* Text input (if showTextInput) */}
      {showTextInput && element.visible && onTextChange && (
        <input type="text" value={textValue} onChange={(e) => onTextChange(e.target.value)} placeholder="Enter text..." className="w-full mt-1 p-1 border rounded text-xs" />
      )}
    </div>
  );

  // 드래그 중인 요소 상태
  const [draggedElement, setDraggedElement] = useState<string | null>(null);
  const [dropTargetElement, setDropTargetElement] = useState<string | null>(null);

  // 섹션별 요소 키 정의
  const KITCHEN_HEADER_KEYS = ['orderType', 'tableNumber', 'posOrderNumber', 'externalOrderNumber', 'serverName', 'dateTime', 'paidStatus'];
  const KITCHEN_BODY_KEYS = ['items', 'modifiers', 'itemNote', 'kitchenTicketElements'];
  const KITCHEN_FOOTER_KEYS = ['specialInstructions'];
  
  const EXTERNAL_HEADER_KEYS = ['orderType', 'tableNumber', 'posOrderNumber', 'externalOrderNumber', 'serverName', 'dateTime', 'deliveryChannel', 'pickupTime', 'customerName', 'customerPhone', 'deliveryAddress', 'paidStatus'];
  const EXTERNAL_BODY_KEYS = ['items', 'modifiers', 'itemNote', 'kitchenTicketElements'];
  const EXTERNAL_FOOTER_KEYS = ['specialInstructions'];

  // 요소를 order 순으로 정렬하여 렌더링하는 함수
  // 요소를 order 순으로 정렬하여 렌더링하는 함수
  const renderSortedElements = (keys: string[], targetLayout: 'kitchen' | 'external') => {
    const layout = getCurrentLayoutSettings() as any;
    
    // 키들을 order 값 기준으로 정렬
    const sortedKeys = [...keys].sort((a, b) => {
      const elA = layout[a] as KitchenElementStyle;
      const elB = layout[b] as KitchenElementStyle;
      return (elA?.order || 0) - (elB?.order || 0);
    });

    return sortedKeys.map(key => {
      const element = layout[key] as KitchenElementStyle;
      // 병합되어 숨겨진 요소는 렌더링하지 않음
      if (!element || element.visible === false && (layout.mergedElements || []).some((m: any) => m.leftElement.key === key || m.rightElement.key === key)) {
        return null; 
      }
      
      // Guest Number는 별도 처리하므로 여기서 제외
      if (key === 'guestNumber') return null;

      let label = kitchenElementLabels[key] || key;
      if (key === 'orderType') label = 'Order Type (DINE-IN/TOGO/ONLINE/QSR)';
      if (key === 'posOrderNumber') label = 'POS Order # (001-999)';
      
      return (
        <DraggableKitchenElementRow
          key={key}
          elementKey={key}
          label={label}
          element={element}
          onChange={(updated) => updateCurrentLayoutSettings({ [key]: { ...element, ...updated } })}
          targetLayout={targetLayout}
          showTextInput={key === 'specialInstructions'}
          showAlignment={true}
          textValue={(element as any).text}
          onTextChange={(text) => {
             if (key === 'specialInstructions') {
               updateCurrentLayoutSettings({ specialInstructions: { ...element, text } });
             }
          }}
        />
      );
    });
  };

  // Footer용 요소 렌더링 (showInFooter 사용, 드래그앤드롭 지원)
  const renderFooterElements = (keys: string[], targetLayout: 'kitchen' | 'external') => {
    const layout = getCurrentLayoutSettings() as any;
    
    // 키들을 order 값 기준으로 정렬
    const sortedKeys = [...keys].sort((a, b) => {
      const elA = layout[a] as KitchenElementStyle;
      const elB = layout[b] as KitchenElementStyle;
      return (elA?.order || 0) - (elB?.order || 0);
    });

    return sortedKeys.map(key => {
      const element = layout[key] as KitchenElementStyle;
      if (!element) return null;
      
      // Guest Number는 별도 처리
      if (key === 'guestNumber') return null;

      let label = kitchenElementLabels[key] || key;
      if (key === 'orderType') label = 'Order Type';
      if (key === 'posOrderNumber') label = 'POS Order #';
      if (key === 'paidStatus') label = 'PAID/UNPAID';
      
      return (
        <DraggableKitchenElementRow
          key={`footer-${key}`}
          elementKey={key}
          label={label}
          element={element}
          onChange={(updated) => updateCurrentLayoutSettings({ [key]: { ...element, ...updated } })}
          targetLayout={targetLayout}
          showAlignment={true}
          isFooter={true}
        />
      );
    });
  };

  // 병합 함수
  const handleMergeElements = (element1Key: string, element2Key: string, targetLayout: 'kitchen' | 'external') => {
    if (element1Key === element2Key) return;
    
    const layout = getCurrentLayoutSettings() as any;
    const element1 = layout[element1Key] as KitchenElementStyle;
    const element2 = layout[element2Key] as KitchenElementStyle;
    
    const currentMerged = layout.mergedElements || [];
    const normalizedMerged = normalizeMergedElements(currentMerged);
    const newMergedElement: MergedElement = {
      id: `merge-${Date.now()}`,
      leftElement: {
        key: element1Key,
        fontSize: element1?.fontSize || 14,
        lineSpacing: element1?.lineSpacing || 0,
        fontWeight: (element1?.fontWeight as 'regular' | 'bold' | 'extrabold') || 'regular',
        isItalic: element1?.isItalic || false,
        inverse: element1?.inverse || false,
      },
      rightElement: {
        key: element2Key,
        fontSize: element2?.fontSize || 14,
        lineSpacing: element2?.lineSpacing || 0,
        fontWeight: (element2?.fontWeight as 'regular' | 'bold' | 'extrabold') || 'regular',
        isItalic: element2?.isItalic || false,
        inverse: element2?.inverse || false,
      },
      alignment: 'left-right',
      verticalAlign: 'center',
      gap: 16,
      order: normalizedMerged.length + 1, // 병합된 요소는 추가 순서대로 유지
    };

    updateCurrentLayoutSettings({
      mergedElements: [...normalizedMerged, newMergedElement],
      [element1Key]: { ...element1, visible: false },
      [element2Key]: { ...element2, visible: false },
    });
    
    setDraggedElement(null);
    setDropTargetElement(null);
  };

  // 병합 해제 함수
  const handleUnmergeElements = (mergedId: string, targetLayout: 'kitchen' | 'external') => {
    const layout = getCurrentLayoutSettings() as any;
    const currentMerged = layout.mergedElements || [];
    const mergedToRemove = currentMerged.find((m: MergedElement) => m.id === mergedId);
    
    if (mergedToRemove) {
      updateCurrentLayoutSettings({
        mergedElements: currentMerged.filter((m: MergedElement) => m.id !== mergedId),
        [mergedToRemove.leftElement.key]: { ...layout[mergedToRemove.leftElement.key], visible: true },
        [mergedToRemove.rightElement.key]: { ...layout[mergedToRemove.rightElement.key], visible: true },
      });
    }
  };

  // 병합된 요소 업데이트 함수
  const updateMergedElement = (mergedId: string, updates: Partial<MergedElement>, targetLayout: 'kitchen' | 'external') => {
    const layout = getCurrentLayoutSettings() as any;
    const currentMerged = layout.mergedElements || [];
    updateCurrentLayoutSettings({
      mergedElements: currentMerged.map((m: MergedElement) => m.id === mergedId ? { ...m, ...updates } : m),
    });
  };

  // 요소 순서 변경 함수
  const handleReorderElement = (draggedKey: string, targetKey: string, position: 'top' | 'bottom', targetLayout: 'kitchen' | 'external') => {
    if (draggedKey === targetKey) return;
    
    // 대상 레이아웃 선택
    const layout = targetLayout === 'kitchen' ? layoutSettings.kitchenLayout : layoutSettings.externalKitchen.kitchenPrinter; // External은 구조가 다를 수 있음. 일단 KitchenLayout 기준으로 가정
    // Note: ExternalKitchen 구조에 따라 접근 경로가 다를 수 있음. 현재 코드에서는 kitchenLayout만 사용하는 것으로 보임 (PrinterPage.tsx 구조 상)
    // 실제로는 activeTab에 따라 layoutSettings.kitchenLayout 또는 layoutSettings.externalKitchen... 을 써야 하지만,
    // 현재 코드 컨텍스트상 DraggableKitchenElementRow는 kitchenLayout 객체 내의 필드들을 직접 수정하는 것으로 보임.
    // 따라서 targetLayout 인자는 현재 로직에서는 큰 의미가 없을 수 있으나, 확장성을 위해 유지.
    
    // 현재 레이아웃 가져오기
    const kl = getCurrentLayoutSettings() as any;
    
    // 드래그된 요소와 타겟 요소
    const draggedEl = kl[draggedKey];
    const targetEl = kl[targetKey];
    
    if (!draggedEl || !targetEl) return;

    // 전체 요소 리스트 (mergedElements 제외한 키들)
    const allKeys = Object.keys(kl).filter(key => {
      const val = kl[key as keyof KitchenLayoutSettings];
      return val && typeof val === 'object' && 'order' in val && key !== 'mergedElements';
    });

    // 현재 순서대로 정렬
    const sortedKeys = allKeys.sort((a, b) => {
      const elA = kl[a as keyof KitchenLayoutSettings] as KitchenElementStyle;
      const elB = kl[b as keyof KitchenLayoutSettings] as KitchenElementStyle;
      return elA.order - elB.order;
    });

    // 드래그된 요소를 배열에서 제거
    const currentIndex = sortedKeys.indexOf(draggedKey);
    sortedKeys.splice(currentIndex, 1);

    // 타겟 요소의 새 인덱스 찾기
    const targetIndex = sortedKeys.indexOf(targetKey);
    
    // 위치에 따라 삽입
    if (position === 'top') {
      sortedKeys.splice(targetIndex, 0, draggedKey);
    } else {
      sortedKeys.splice(targetIndex + 1, 0, draggedKey);
    }

    // 새로운 order 값 할당 (10단위로 재정렬)
    const updates: Record<string, any> = {};
    sortedKeys.forEach((key, index) => {
      if (kl[key]) {
        updates[key] = { ...kl[key], order: (index + 1) * 10 };
      }
    });

    updateCurrentLayoutSettings(updates);
  };

  // 드래그 가능한 Kitchen Element Row (간소화된 버전)
  const DraggableKitchenElementRow = ({
    elementKey,
    label,
    element,
    onChange,
    showTextInput,
    textValue,
    onTextChange,
    targetLayout,
    showAlignment,
    isFooter,
  }: {
    elementKey: string;
    label: string;
    element: KitchenElementStyle;
    onChange: (updated: Partial<KitchenElementStyle>) => void;
    showTextInput?: boolean;
    textValue?: string;
    onTextChange?: (text: string) => void;
    targetLayout: 'kitchen' | 'external';
    showAlignment?: boolean;
    isFooter?: boolean;
  }) => {
    const [localDropZone, setLocalDropZone] = useState<'top' | 'middle' | 'bottom' | null>(null);
    const isDragging = draggedElement === elementKey;
    const isDropTarget = dropTargetElement === elementKey;
    
    // Header: showInHeader 사용 (기본값 true), Footer: showInFooter 사용 (기본값 false)
    const isVisible = isFooter 
      ? (element.showInFooter || false) 
      : (element.showInHeader !== undefined ? element.showInHeader : true);
    
    const toggleVisibility = () => {
      if (isFooter) {
        onChange({ showInFooter: !element.showInFooter } as any);
      } else {
        // Header: showInHeader 토글 (기본값이 true이므로 undefined면 false로 설정)
        const currentValue = element.showInHeader !== undefined ? element.showInHeader : true;
        onChange({ showInHeader: !currentValue } as any);
      }
    };

    return (
      <div
        draggable="true"
        onDragStart={(e) => {
          // 드래그 데이터 설정
          e.dataTransfer.setData('text/plain', elementKey);
          e.dataTransfer.effectAllowed = 'move';
          
          // 드래그 이미지 설정 (선택사항)
          if (e.currentTarget instanceof HTMLElement) {
            e.dataTransfer.setDragImage(e.currentTarget, 10, 10);
          }
          
          // 상태 즉시 업데이트
          setDraggedElement(elementKey);
        }}
        onDragEnd={() => {
          setDraggedElement(null);
          setDropTargetElement(null);
          setLocalDropZone(null);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          
          // 드래그 중인 요소가 없거나 자기 자신이면 무시
          if (!draggedElement || draggedElement === elementKey) return;
          
          setDropTargetElement(elementKey);
          
          // 드롭 위치 계산
          const rect = e.currentTarget.getBoundingClientRect();
          const y = e.clientY - rect.top;
          const height = rect.height;
          
          if (y < height * 0.3) {
            setLocalDropZone('top');
          } else if (y > height * 0.7) {
            setLocalDropZone('bottom');
          } else {
            setLocalDropZone('middle');
          }
        }}
        onDragLeave={(e) => {
          const relatedTarget = e.relatedTarget as HTMLElement;
          if (e.currentTarget.contains(relatedTarget)) return;
          setLocalDropZone(null);
          if (dropTargetElement === elementKey) {
            setDropTargetElement(null);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          
          // 전역 상태에서 드래그 요소 가져오기
          const draggedKey = draggedElement;
          
          if (!draggedKey || draggedKey === elementKey) {
            setLocalDropZone(null);
            setDraggedElement(null);
            setDropTargetElement(null);
            return;
          }
          
          // 현재 드롭 위치 저장 (상태 초기화 전에)
          const currentDropZone = localDropZone;
          
          // 먼저 상태 초기화
          setLocalDropZone(null);
          setDraggedElement(null);
          setDropTargetElement(null);
          
          // 그 후에 동작 실행
          if (currentDropZone === 'middle') {
            handleMergeElements(draggedKey, elementKey, targetLayout);
          } else if (currentDropZone === 'top' || currentDropZone === 'bottom') {
            handleReorderElement(draggedKey, elementKey, currentDropZone, targetLayout);
          }
        }}
        className={`py-2 border-b border-gray-200 last:border-b-0 cursor-grab select-none ${
          isDragging ? 'opacity-40 bg-blue-100' : ''
        } ${isDropTarget && localDropZone === 'top' ? 'border-t-4 border-t-blue-500' : ''}
          ${isDropTarget && localDropZone === 'bottom' ? 'border-b-4 border-b-blue-500' : ''}
          ${isDropTarget && localDropZone === 'middle' ? 'bg-green-100 ring-2 ring-green-500 ring-dashed' : ''}`}
        style={{ touchAction: 'none' }}
      >
        <div className="flex items-center gap-1.5 pointer-events-none">
          {/* 드래그 핸들 */}
          <div className="flex items-center justify-center w-6 h-8 text-gray-400 cursor-grab pointer-events-auto" title="Drag to reorder or merge">
            ⋮⋮
          </div>
          
          {/* Visible toggle */}
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleVisibility(); }}
            className={`w-6 h-6 rounded flex items-center justify-center text-xs pointer-events-auto ${isVisible ? (isFooter ? 'bg-yellow-500' : 'bg-green-500') + ' text-white' : 'bg-gray-300 text-gray-600'}`}
            title={isVisible ? (isFooter ? 'Show in Footer' : 'Visible') : (isFooter ? 'Hidden from Footer' : 'Hidden')}
            draggable="false"
          >{isVisible ? '✓' : '–'}</button>
          
          {/* Inverse toggle */}
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange({ inverse: !element.inverse }); }}
            className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold pointer-events-auto ${element.inverse ? 'bg-black text-white' : 'bg-white text-black border border-gray-400'}`}
            title={element.inverse ? 'Inverse ON' : 'Inverse OFF'}
            draggable="false"
          >I</button>
          
          {/* Label */}
          <span className="text-sm font-medium text-gray-700 flex-1 truncate" title={label}>{label}</span>
          
          {/* Text Alignment (if showAlignment) */}
          {showAlignment && (
            <div className="flex gap-0.5 pointer-events-auto">
              <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange({ textAlign: 'left' }); }} className={`px-1.5 py-1 text-xs rounded ${element.textAlign === 'left' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`} disabled={!isVisible} title="Left" draggable="false">L</button>
              <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange({ textAlign: 'center' }); }} className={`px-1.5 py-1 text-xs rounded ${(!element.textAlign || element.textAlign === 'center') ? 'bg-blue-600 text-white' : 'bg-gray-200'}`} disabled={!isVisible} title="Center" draggable="false">C</button>
              <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange({ textAlign: 'right' }); }} className={`px-1.5 py-1 text-xs rounded ${element.textAlign === 'right' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`} disabled={!isVisible} title="Right" draggable="false">R</button>
            </div>
          )}
          
          {/* Font Size */}
          <div className="flex items-center gap-1 pointer-events-auto">
            <span className="text-sm text-gray-400">Size</span>
            <input type="number" value={element.fontSize} onChange={(e) => onChange({ fontSize: parseInt(e.target.value) || 12 })} onClick={(e) => { e.preventDefault(); e.stopPropagation(); }} className="w-12 p-1 border rounded text-sm text-center" min={8} max={32} disabled={!isVisible} draggable="false" />
          </div>
          
          {/* Top Spacing (margin-top in px) */}
          <div className="flex items-center gap-1 pointer-events-auto">
            <span className="text-sm text-gray-400">Line</span>
            <input type="number" value={element.lineSpacing} onChange={(e) => onChange({ lineSpacing: parseInt(e.target.value) || 0 })} onClick={(e) => { e.preventDefault(); e.stopPropagation(); }} className="w-12 p-1 border rounded text-sm text-center" step={1} min={0} max={50} disabled={!isVisible} draggable="false" />
          </div>
          
          
          
          {/* R/B/B+/I Style */}
          <div className="flex gap-0.5 pointer-events-auto">
            <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange({ fontWeight: 'regular' }); }} className={`px-1.5 py-1 text-xs rounded ${element.fontWeight === 'regular' ? 'bg-gray-700 text-white' : 'bg-gray-200'}`} disabled={!isVisible} title="Regular" draggable="false">R</button>
            <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange({ fontWeight: 'bold' }); }} className={`px-1.5 py-1 text-xs rounded font-bold ${element.fontWeight === 'bold' ? 'bg-gray-700 text-white' : 'bg-gray-200'}`} disabled={!isVisible} title="Bold" draggable="false">B</button>
            <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange({ fontWeight: 'extrabold' }); }} className={`px-1.5 py-1 text-xs rounded ${element.fontWeight === 'extrabold' ? 'bg-gray-700 text-white' : 'bg-gray-200'}`} disabled={!isVisible} title="Extra Bold" style={{ fontWeight: 900 }} draggable="false">B+</button>
            <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange({ isItalic: !element.isItalic }); }} className={`px-1.5 py-1 text-xs rounded italic ${element.isItalic ? 'bg-blue-600 text-white' : 'bg-gray-200'}`} disabled={!isVisible} title="Italic (Toggle)" draggable="false">I</button>
          </div>
        </div>
        
        {/* Drop hint when hovering */}
        {isDropTarget && localDropZone === 'middle' && (
          <div className="mt-1 text-xs text-green-700 font-medium text-center pointer-events-none">
            🔗 Drop here to merge
          </div>
        )}
        
        {/* Text input (if showTextInput) */}
        {showTextInput && element.visible && onTextChange && (
          <input type="text" value={textValue} onChange={(e) => onTextChange(e.target.value)} placeholder="Enter text..." className="w-full mt-1 p-1 border rounded text-xs" />
        )}
      </div>
    );
  };

  // 병합된 요소 행 컴포넌트
  const MergedElementRow = ({
    merged,
    onUpdate,
    onUnmerge,
  }: {
    merged: MergedElement;
    onUpdate: (updates: Partial<MergedElement>) => void;
    onUnmerge: () => void;
  }) => {
    const alignmentOptions = [
      { value: 'left-center' as const, label: 'L / C' },
      { value: 'left-right' as const, label: 'L / R' },
      { value: 'center-center' as const, label: 'C / C' },
      { value: 'center-right' as const, label: 'C / R' },
    ];

    const verticalAlignOptions = [
      { value: 'top' as const, label: '↑ Top' },
      { value: 'center' as const, label: '⬌ Center' },
      { value: 'bottom' as const, label: '↓ Bottom' },
    ];

    const updateLeftElement = (updates: Partial<MergedElementItem>) => {
      const scrollY = window.scrollY;
      onUpdate({ leftElement: { ...merged.leftElement, ...updates } });
      requestAnimationFrame(() => window.scrollTo(0, scrollY));
    };

    const updateRightElement = (updates: Partial<MergedElementItem>) => {
      const scrollY = window.scrollY;
      onUpdate({ rightElement: { ...merged.rightElement, ...updates } });
      requestAnimationFrame(() => window.scrollTo(0, scrollY));
    };

    // 좌우 스왑 함수
    const handleSwap = () => {
      onUpdate({
        leftElement: merged.rightElement,
        rightElement: merged.leftElement,
      });
    };

    return (
      <div className="py-2 border-b border-gray-200 bg-purple-50 rounded-lg mb-2 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-purple-700">🔗 MERGED</span>
            <span className="text-sm font-medium">
              {kitchenElementLabels[merged.leftElement.key] || merged.leftElement.key} + {kitchenElementLabels[merged.rightElement.key] || merged.rightElement.key}
            </span>
            {/* 스왑 버튼 */}
            <button
              onClick={handleSwap}
              className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
              title="Swap left/right"
            >
              ⇄ Swap
            </button>
          </div>
          <button
            onClick={onUnmerge}
            className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
            title="Unmerge elements"
          >
            Unmerge
          </button>
        </div>
        
        {/* Horizontal Alignment Options */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-gray-500">H-Align:</span>
          {alignmentOptions.map(opt => (
            <button
              key={opt.value}
              onClick={() => onUpdate({ alignment: opt.value })}
              className={`px-2 py-1 text-xs rounded ${merged.alignment === opt.value ? 'bg-purple-600 text-white' : 'bg-gray-200'}`}
            >
              {opt.label}
            </button>
          ))}
          {/* 줄 전체 INVERSE 버튼 */}
          <div className="ml-2 border-l pl-2">
            <button
              onClick={() => onUpdate({ lineInverse: !merged.lineInverse })}
              className={`px-2 py-1 text-xs rounded font-bold ${merged.lineInverse ? 'bg-black text-white' : 'bg-white text-black border border-gray-400'}`}
              title={merged.lineInverse ? 'Line Inverse ON' : 'Line Inverse OFF'}
            >
              LINE INV
            </button>
          </div>
        </div>
        
        {/* Vertical Alignment Options */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-gray-500">V-Align:</span>
          {verticalAlignOptions.map(opt => (
            <button
              key={opt.value}
              onClick={() => onUpdate({ verticalAlign: opt.value })}
              className={`px-2 py-1 text-xs rounded ${(merged.verticalAlign || 'center') === opt.value ? 'bg-green-600 text-white' : 'bg-gray-200'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        
        {/* Gap Control (for C/C alignment) */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-gray-500">Gap:</span>
          <input 
            type="number" 
            min={0} 
            max={100} 
            value={merged.gap || 16} 
            onChange={(e) => onUpdate({ gap: parseInt(e.target.value) || 0 })}
            className="w-14 p-1 border rounded text-sm text-center"
          />
          <span className="text-xs text-gray-400">px</span>
        </div>
        
        {/* Left Element Settings */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white p-2 rounded border">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium text-gray-600">← {kitchenElementLabels[merged.leftElement.key] || merged.leftElement.key}</span>
              {/* Left Inverse toggle */}
              <button
                onClick={() => updateLeftElement({ inverse: !merged.leftElement.inverse })}
                className={`w-5 h-5 rounded flex items-center justify-center text-xs font-bold ${merged.leftElement.inverse ? 'bg-black text-white' : 'bg-white text-black border border-gray-400'}`}
                title={merged.leftElement.inverse ? 'Inverse ON' : 'Inverse OFF'}
              >I</button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1">
                <span className="text-sm text-gray-400">Size</span>
                <input type="number" value={merged.leftElement.fontSize} onChange={(e) => updateLeftElement({ fontSize: parseInt(e.target.value) || 12 })} className="w-12 p-1 border rounded text-sm text-center" min={8} max={32} />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-sm text-gray-400">Line</span>
                <input type="number" value={merged.leftElement.lineSpacing} onChange={(e) => updateLeftElement({ lineSpacing: parseInt(e.target.value) || 0 })} className="w-12 p-1 border rounded text-sm text-center" step={1} min={0} max={50} />
              </div>
              
              <div className="flex gap-0.5">
                <button onClick={() => updateLeftElement({ fontWeight: 'regular' })} className={`px-1.5 py-1 text-xs rounded ${merged.leftElement.fontWeight === 'regular' ? 'bg-gray-700 text-white' : 'bg-gray-200'}`} title="Regular">R</button>
                <button onClick={() => updateLeftElement({ fontWeight: 'bold' })} className={`px-1.5 py-1 text-xs rounded font-bold ${merged.leftElement.fontWeight === 'bold' ? 'bg-gray-700 text-white' : 'bg-gray-200'}`} title="Bold">B</button>
                <button onClick={() => updateLeftElement({ fontWeight: 'extrabold' })} className={`px-1.5 py-1 text-xs rounded ${merged.leftElement.fontWeight === 'extrabold' ? 'bg-gray-700 text-white' : 'bg-gray-200'}`} title="Extra Bold" style={{ fontWeight: 900 }}>B+</button>
                <button onClick={() => updateLeftElement({ isItalic: !merged.leftElement.isItalic })} className={`px-1.5 py-1 text-xs rounded italic ${merged.leftElement.isItalic ? 'bg-blue-600 text-white' : 'bg-gray-200'}`} title="Italic">I</button>
              </div>
            </div>
          </div>
          
          {/* Right Element Settings */}
          <div className="bg-white p-2 rounded border">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium text-gray-600">{kitchenElementLabels[merged.rightElement.key] || merged.rightElement.key} →</span>
              {/* Right Inverse toggle */}
              <button
                onClick={() => updateRightElement({ inverse: !merged.rightElement.inverse })}
                className={`w-5 h-5 rounded flex items-center justify-center text-xs font-bold ${merged.rightElement.inverse ? 'bg-black text-white' : 'bg-white text-black border border-gray-400'}`}
                title={merged.rightElement.inverse ? 'Inverse ON' : 'Inverse OFF'}
              >I</button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1">
                <span className="text-sm text-gray-400">Size</span>
                <input type="number" value={merged.rightElement.fontSize} onChange={(e) => updateRightElement({ fontSize: parseInt(e.target.value) || 12 })} className="w-12 p-1 border rounded text-sm text-center" min={8} max={32} />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-sm text-gray-400">Line</span>
                <input type="number" value={merged.rightElement.lineSpacing} onChange={(e) => updateRightElement({ lineSpacing: parseInt(e.target.value) || 0 })} className="w-12 p-1 border rounded text-sm text-center" step={1} min={0} max={50} />
              </div>
              
              <div className="flex gap-0.5">
                <button onClick={() => updateRightElement({ fontWeight: 'regular' })} className={`px-1.5 py-1 text-xs rounded ${merged.rightElement.fontWeight === 'regular' ? 'bg-gray-700 text-white' : 'bg-gray-200'}`} title="Regular">R</button>
                <button onClick={() => updateRightElement({ fontWeight: 'bold' })} className={`px-1.5 py-1 text-xs rounded font-bold ${merged.rightElement.fontWeight === 'bold' ? 'bg-gray-700 text-white' : 'bg-gray-200'}`} title="Bold">B</button>
                <button onClick={() => updateRightElement({ fontWeight: 'extrabold' })} className={`px-1.5 py-1 text-xs rounded ${merged.rightElement.fontWeight === 'extrabold' ? 'bg-gray-700 text-white' : 'bg-gray-200'}`} title="Extra Bold" style={{ fontWeight: 900 }}>B+</button>
                <button onClick={() => updateRightElement({ isItalic: !merged.rightElement.isItalic })} className={`px-1.5 py-1 text-xs rounded italic ${merged.rightElement.isItalic ? 'bg-blue-600 text-white' : 'bg-gray-200'}`} title="Italic">I</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // 숫자 입력 컴포넌트
  const NumberInput = ({ value, onChange, label, min, max, unit }: {
    value: number;
    onChange: (value: number) => void;
    label: string;
    min?: number;
    max?: number;
    unit?: string;
  }) => (
    <div className="flex items-center justify-between py-2 border-b border-gray-100">
      <p className="text-sm font-medium text-gray-800">{label}</p>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-20 p-1 border rounded text-center text-sm"
        />
        {unit && <span className="text-xs text-gray-500">{unit}</span>}
      </div>
    </div>
  );

  // 요소별 스타일 설정 행 컴포넌트 (폰트는 전역 설정, 구분선 제거)
  const ElementStyleRow = ({ 
    label, 
    element, 
    onChange,
    showTextInput = false,
    textValue = '',
    onTextChange,
    isSeparatorOnly = false
  }: {
    label: string;
    element: ElementStyle;
    onChange: (updated: Partial<ElementStyle>) => void;
    showTextInput?: boolean;
    textValue?: string;
    onTextChange?: (text: string) => void;
    isSeparatorOnly?: boolean;
  }) => (
    <div className="py-2 border-b border-gray-200 last:border-b-0">
      <div className="flex items-center gap-2">
        {/* Visible toggle */}
        <button
          onClick={() => {
            const scrollY = window.scrollY;
            onChange({ visible: !element.visible });
            requestAnimationFrame(() => window.scrollTo(0, scrollY));
          }}
          className={`w-6 h-6 rounded flex items-center justify-center text-xs ${
            element.visible ? 'bg-green-500 text-white' : 'bg-gray-300 text-gray-600'
          }`}
          title={element.visible ? 'Visible' : 'Hidden'}
        >
          {element.visible ? '✓' : '–'}
        </button>
        
        {/* Label */}
        <span className="text-sm font-medium text-gray-700 flex-1 truncate" title={label}>{label}</span>
        
        {!isSeparatorOnly && (
          <>
            {/* Font Size */}
            <div className="flex items-center gap-1">
              <span className="text-sm text-gray-400">Size</span>
              <input
                type="number"
                value={element.fontSize}
                onChange={(e) => {
                  const scrollY = window.scrollY;
                  onChange({ fontSize: parseInt(e.target.value) || 12 });
                  requestAnimationFrame(() => window.scrollTo(0, scrollY));
                }}
                className="w-12 p-1 border rounded text-sm text-center"
                min={8}
                max={24}
                disabled={!element.visible}
              />
            </div>
            
            {/* Line Spacing */}
            <div className="flex items-center gap-1">
              <span className="text-sm text-gray-400">Line</span>
              <input
                type="number"
                value={element.lineSpacing}
                step={0.1}
                onChange={(e) => {
                  const scrollY = window.scrollY;
                  const nextValue = parseFloat(e.target.value);
                  onChange({ lineSpacing: Number.isFinite(nextValue) ? nextValue : 0 });
                  requestAnimationFrame(() => window.scrollTo(0, scrollY));
                }}
                className="w-12 p-1 border rounded text-sm text-center"
                min={0}
                max={60}
                disabled={!element.visible}
              />
            </div>
            
            {/* R/B Style + I Toggle */}
            <div className="flex gap-1">
              <button
                onClick={() => {
                  const scrollY = window.scrollY;
                  onChange({ fontWeight: 'regular' });
                  requestAnimationFrame(() => window.scrollTo(0, scrollY));
                }}
                className={`px-2 py-1 text-sm rounded ${element.fontWeight === 'regular' ? 'bg-gray-700 text-white' : 'bg-gray-200'}`}
                disabled={!element.visible}
              >R</button>
              <button
                onClick={() => {
                  const scrollY = window.scrollY;
                  onChange({ fontWeight: 'bold' });
                  requestAnimationFrame(() => window.scrollTo(0, scrollY));
                }}
                className={`px-2 py-1 text-sm rounded font-bold ${element.fontWeight === 'bold' ? 'bg-gray-700 text-white' : 'bg-gray-200'}`}
                disabled={!element.visible}
              >B</button>
              <button
                onClick={() => {
                  const scrollY = window.scrollY;
                  onChange({ isItalic: !element.isItalic });
                  requestAnimationFrame(() => window.scrollTo(0, scrollY));
                }}
                className={`px-2 py-1 text-sm rounded italic ${element.isItalic ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
                disabled={!element.visible}
              >I</button>
            </div>
          </>
        )}
      </div>
      
      {/* 텍스트 입력 (showTextInput이 true인 경우) */}
      {showTextInput && element.visible && onTextChange && (
        <input
          type="text"
          value={textValue}
          onChange={(e) => onTextChange(e.target.value)}
          className="w-full mt-1 p-1 border rounded text-xs"
          placeholder="텍스트 입력..."
        />
      )}
    </div>
  );

  // 새 Bill 미리보기 (billLayout 기반, ESC/POS 동일 렌더링)
  const BillPreviewNew = () => {
    const bl = layoutSettings.billLayout;
    const fontScale = bl.fontScale || 1.0;
    const charWidth = getPaperCharWidth(bl.paperWidth);

    // ESC/POS 구분선 렌더링
    const renderSeparator = (sep: SeparatorStyle) => {
      if (!sep.visible || sep.style === 'none') return null;
      return (
        <div className="text-gray-600 my-1 text-center overflow-hidden whitespace-nowrap" style={{ fontFamily: 'monospace', fontSize: '10px' }}>
          {getEscPosSeparator(sep.style, charWidth)}
        </div>
      );
    };

    return (
      <div 
        className="bg-white border-2 border-dashed border-gray-300 p-4 mx-auto shadow-lg overflow-hidden"
        style={{ 
          width: `${bl.paperWidth * 4.5}px`, 
          paddingTop: `${bl.topMargin * 2}px`, 
          paddingLeft: `${(bl.leftMargin || 0) * 2}px`,
          fontFamily: 'monospace',  // 고정폭 폰트 (프린터와 동일)
        }}
      >
        {/* ========== HEADER ========== */}
        {bl.storeName.visible && (
          <div className="text-center" style={getPreviewStyle({ ...bl.storeName, textAlign: 'center' }, fontScale)}>
            {bl.storeName.text || 'Restaurant Name'}
          </div>
        )}
        {bl.storeAddress.visible && (
          <div className="text-center" style={getPreviewStyle({ ...bl.storeAddress, textAlign: 'center' }, fontScale)}>
            {bl.storeAddress.text || 'Address'}
          </div>
        )}
        {bl.storePhone.visible && (
          <div className="text-center" style={getPreviewStyle({ ...bl.storePhone, textAlign: 'center' }, fontScale)}>
            {bl.storePhone.text || 'Phone'}
          </div>
        )}

        {/* ① Separator 1: 헤더 아래 */}
        {renderSeparator(bl.separator1)}

        {/* ========== BODY - Order Info ========== */}
        {bl.orderNumber.visible && (
          <div style={getPreviewStyle(bl.orderNumber, fontScale)}>
            Order#: ORD-20251212-001
          </div>
        )}
        {bl.orderChannel.visible && (
          <div style={getPreviewStyle(bl.orderChannel, fontScale)}>
            Dine-in / Table: 5
          </div>
        )}
        {bl.serverName.visible && (
          <div style={getPreviewStyle(bl.serverName, fontScale)}>
            Server: John
          </div>
        )}
        {bl.dateTime.visible && (
          <div style={getPreviewStyle(bl.dateTime, fontScale)}>
            2025-12-13 19:30
          </div>
        )}

        {/* ② Separator 2: 주문정보 아래 */}
        {renderSeparator(bl.separator2)}

        {/* ========== Items ========== */}
        {bl.items.visible && (
          <div style={getPreviewStyle(bl.items, fontScale)}>
            <div className="flex justify-between"><span>Salmon Sashimi x1</span><span>$18.99</span></div>
            {bl.modifiers.visible && (
              <div className="text-gray-600 ml-3 flex" style={getPreviewStyle(bl.modifiers, fontScale)}>
                <span className="inline-block w-6 text-right mr-1">{bl.modifiers.prefix || '>>'}</span>
                <span>Extra Ginger</span>
              </div>
            )}
            {bl.itemNote?.visible && (
              <div className="text-gray-800 ml-3 flex" style={getPreviewStyle(bl.itemNote, fontScale)}>
                <span className="inline-block w-6 text-right mr-1">{bl.itemNote.prefix || '->'}</span>
                <span>No wasabi please</span>
              </div>
            )}
            {bl.itemDiscount.visible && (
              <div className="text-red-600 ml-3 flex" style={getPreviewStyle(bl.itemDiscount, fontScale)}>
                <span className="inline-block w-6 text-right mr-1">-</span>
                <span>Item Discount: -$2.00</span>
              </div>
            )}
            <div className="flex justify-between mt-1"><span>Beef Teriyaki x2</span><span>$29.98</span></div>
            <div className="flex justify-between"><span>Miso Soup x2</span><span>$7.98</span></div>
          </div>
        )}

        {/* ③ Separator 3: 아이템 아래 */}
        {renderSeparator(bl.separator3)}

        {/* ========== Totals (순서: Subtotal → Discount → GST → PST → Total) ========== */}
        <div className="pt-1">
          {bl.subtotal.visible && (
            <div className="flex justify-between" style={getPreviewStyle(bl.subtotal, fontScale)}>
              <span>Subtotal:</span><span>$54.95</span>
            </div>
          )}
          {bl.discount.visible && (
            <div className="flex justify-between text-red-600" style={getPreviewStyle(bl.discount, fontScale)}>
              <span>Discount:</span><span>-$5.00</span>
            </div>
          )}
          {bl.taxGST.visible && (
            <div className="flex justify-between" style={getPreviewStyle(bl.taxGST, fontScale)}>
              <span>GST (5%):</span><span>$2.75</span>
            </div>
          )}
          {bl.taxPST.visible && (
            <div className="flex justify-between" style={getPreviewStyle(bl.taxPST, fontScale)}>
              <span>PST (7%):</span><span>$3.85</span>
            </div>
          )}
          {/* ④ Separator 4: Total 위 */}
          {renderSeparator(bl.separator4)}
          {bl.total.visible && (
            <div className="flex justify-between pt-1" style={getPreviewStyle(bl.total, fontScale)}>
              <span>TOTAL:</span><span>$56.55</span>
            </div>
          )}
        </div>

        {/* ========== FOOTER ========== */}
        {bl.greeting.visible && (
          <div className="text-center mt-4" style={getPreviewStyle({ ...bl.greeting, textAlign: 'center' }, fontScale)}>
            {bl.greeting.text || 'Thank you!'}
          </div>
        )}
      </div>
    );
  };

  // Bill 미리보기
  const BillPreview = () => (
    <div 
      className="bg-white border-2 border-dashed border-gray-300 p-6 font-mono text-sm mx-auto"
      style={{ 
        width: `${layoutSettings.paperWidth * 4.5}px`,
        fontFamily: layoutSettings.fontFamily,
        lineHeight: layoutSettings.bill.bodyLineSpacing
      }}
    >
      {layoutSettings.bill.headerText && (
        <div className="text-center mb-2" style={{ fontSize: layoutSettings.headerFontSize }}>
          {layoutSettings.bill.headerText}
        </div>
      )}
      {layoutSettings.bill.showStoreName && (
        <div className="text-center font-bold" style={{ fontSize: layoutSettings.headerFontSize }}>
          LUCKY HAN RESTAURANT
        </div>
      )}
      {layoutSettings.bill.showStoreAddress && (
        <div className="text-center" style={{ fontSize: layoutSettings.footerFontSize }}>
          123 Main Street, Vancouver, BC
        </div>
      )}
      {layoutSettings.bill.showStorePhone && (
        <div className="text-center mb-2" style={{ fontSize: layoutSettings.footerFontSize }}>
          Tel: 778-123-4567
        </div>
      )}
      
      <div className="border-t border-b border-gray-400 py-1 my-2" style={{ fontSize: layoutSettings.bodyFontSize }}>
        {layoutSettings.bill.showOrderNumber && <div>Order#: ORD-20251212-001</div>}
        {layoutSettings.bill.showTableNumber && <div>Table: 5</div>}
        {layoutSettings.bill.showServerName && <div>Server: John</div>}
        {layoutSettings.bill.showDateTime && <div>Date: 2025-12-12 19:30</div>}
      </div>
      
      <div className="py-1" style={{ fontSize: layoutSettings.bodyFontSize }}>
        <div className="flex justify-between"><span>Salmon Sashimi x1</span><span>$18.99</span></div>
        {layoutSettings.bill.showItemModifiers && (
          <div className="text-gray-500 ml-2" style={{ fontSize: layoutSettings.footerFontSize }}>+ Extra Ginger</div>
        )}
        <div className="flex justify-between"><span>Beef Teriyaki x2</span><span>$29.98</span></div>
        <div className="flex justify-between"><span>Miso Soup x2</span><span>$7.98</span></div>
      </div>
      
      <div className="border-t border-gray-400 pt-1 mt-2" style={{ fontSize: layoutSettings.bodyFontSize }}>
        {layoutSettings.bill.showSubtotal && <div className="flex justify-between"><span>Subtotal:</span><span>$56.95</span></div>}
        {layoutSettings.bill.showTax && <div className="flex justify-between"><span>Tax (5%):</span><span>$2.85</span></div>}
        {layoutSettings.bill.showGrandTotal && (
          <div className="flex justify-between font-bold border-t border-gray-400 pt-1 mt-1" style={{ fontSize: layoutSettings.headerFontSize }}>
            <span>TOTAL:</span><span>$59.80</span>
          </div>
        )}
      </div>
      
      {layoutSettings.bill.showFooterMessage && layoutSettings.bill.footerMessage && (
        <div className="text-center mt-3" style={{ fontSize: layoutSettings.footerFontSize }}>
          {layoutSettings.bill.footerMessage}
        </div>
      )}
    </div>
  );

  // Receipt 미리보기 (ESC/POS 동일 렌더링)
  const ReceiptPreviewNew = () => {
    const rl = layoutSettings.receiptLayout;
    const fontScale = rl.fontScale || 1.0;
    const charWidth = getPaperCharWidth(rl.paperWidth);

    // ESC/POS 구분선 렌더링
    const renderSeparator = (sep: SeparatorStyle) => {
      if (!sep.visible || sep.style === 'none') return null;
      return (
        <div className="text-gray-600 my-1 text-center overflow-hidden whitespace-nowrap" style={{ fontFamily: 'monospace', fontSize: '10px' }}>
          {getEscPosSeparator(sep.style, charWidth)}
        </div>
      );
    };

    return (
      <div 
        className="bg-white border-2 border-dashed border-gray-300 p-4 mx-auto overflow-hidden"
        style={{ 
          width: `${rl.paperWidth * 4.5}px`,
          fontFamily: 'monospace',
          paddingTop: `${rl.topMargin * 2}px`,
          paddingLeft: `${(rl.leftMargin || 0) * 2}px`
        }}
      >
        {/* ========== HEADER ========== */}
        <div className="text-center mb-3">
          {rl.storeName.visible && (
            <div style={getPreviewStyle({ ...rl.storeName, textAlign: 'center' }, fontScale)}>
              {rl.storeName.text}
            </div>
          )}
          {rl.storeAddress.visible && (
            <div style={getPreviewStyle({ ...rl.storeAddress, textAlign: 'center' }, fontScale)}>
              {rl.storeAddress.text}
            </div>
          )}
          {rl.storePhone.visible && (
            <div style={getPreviewStyle({ ...rl.storePhone, textAlign: 'center' }, fontScale)}>
              {rl.storePhone.text}
            </div>
          )}
        </div>

        {/* ① Separator 1: 헤더 아래 */}
        {renderSeparator(rl.separator1)}

        {/* ========== ORDER INFO ========== */}
        <div className="mb-2">
          {rl.orderNumber.visible && (
            <div className="flex justify-between" style={getPreviewStyle(rl.orderNumber, fontScale)}>
              <span>Order #:</span><span>ORD-2024-0042</span>
            </div>
          )}
          {rl.orderChannel.visible && (
            <div className="flex justify-between" style={getPreviewStyle(rl.orderChannel, fontScale)}>
              <span>Channel:</span><span>Dine-in (Table 5)</span>
            </div>
          )}
          {rl.serverName.visible && (
            <div className="flex justify-between" style={getPreviewStyle(rl.serverName, fontScale)}>
              <span>Server:</span><span>Sarah K.</span>
            </div>
          )}
          {rl.dateTime.visible && (
            <div className="flex justify-between" style={getPreviewStyle(rl.dateTime, fontScale)}>
              <span>Date:</span><span>Dec 14, 2024 3:45 PM</span>
            </div>
          )}
        </div>

        {/* ② Separator 2: 주문정보 아래 */}
        {renderSeparator(rl.separator2)}

        {/* ========== ITEMS ========== */}
        {rl.items.visible && (
          <div className="mb-2" style={getPreviewStyle(rl.items, fontScale)}>
            <div className="flex justify-between"><span>Salmon Sashimi x1</span><span>$18.99</span></div>
            {rl.modifiers.visible && (
              <div className="text-gray-600 ml-3 flex" style={getPreviewStyle(rl.modifiers, fontScale)}>
                <span className="inline-block w-6 text-right mr-1">{rl.modifiers.prefix || '>>'}</span>
                <span>Extra Ginger</span>
              </div>
            )}
            {rl.itemNote?.visible && (
              <div className="text-gray-800 ml-3 flex" style={getPreviewStyle(rl.itemNote, fontScale)}>
                <span className="inline-block w-6 text-right mr-1">{rl.itemNote.prefix || '->'}</span>
                <span>No wasabi please</span>
              </div>
            )}
            {rl.itemDiscount.visible && (
              <div className="text-red-600 ml-3 flex" style={getPreviewStyle(rl.itemDiscount, fontScale)}>
                <span className="inline-block w-6 text-right mr-1">-</span>
                <span>Item Discount: -$2.00</span>
              </div>
            )}
            <div className="flex justify-between mt-1"><span>Beef Teriyaki x2</span><span>$29.98</span></div>
            <div className="flex justify-between"><span>Miso Soup x2</span><span>$7.98</span></div>
          </div>
        )}

        {/* ③ Separator 3: 아이템 아래 */}
        {renderSeparator(rl.separator3)}

        {/* ========== TOTALS ========== */}
        <div className="pt-1">
          {rl.subtotal.visible && (
            <div className="flex justify-between" style={getPreviewStyle(rl.subtotal, fontScale)}>
              <span>Subtotal:</span><span>$54.95</span>
            </div>
          )}
          {rl.discount.visible && (
            <div className="flex justify-between text-red-600" style={getPreviewStyle(rl.discount, fontScale)}>
              <span>Discount:</span><span>-$5.00</span>
            </div>
          )}
          {rl.taxGST.visible && (
            <div className="flex justify-between" style={getPreviewStyle(rl.taxGST, fontScale)}>
              <span>GST (5%):</span><span>$2.75</span>
            </div>
          )}
          {rl.taxPST.visible && (
            <div className="flex justify-between" style={getPreviewStyle(rl.taxPST, fontScale)}>
              <span>PST (7%):</span><span>$3.85</span>
            </div>
          )}
          {/* ④ Separator 4: Total 위 */}
          {renderSeparator(rl.separator4)}
          {rl.total.visible && (
            <div className="flex justify-between pt-1" style={getPreviewStyle(rl.total, fontScale)}>
              <span>TOTAL:</span><span>$56.55</span>
            </div>
          )}
        </div>

        {/* ========== PAYMENT (Receipt only) ========== */}
        <div className="mt-3 pt-2 border-t border-gray-300">
          {rl.paymentMethod.visible && (
            <div className="flex justify-between" style={getPreviewStyle(rl.paymentMethod, fontScale)}>
              <span>Payment:</span><span>VISA ****4242</span>
            </div>
          )}
          {rl.paymentDetails.visible && (
            <div className="flex justify-between" style={getPreviewStyle(rl.paymentDetails, fontScale)}>
              <span>Tendered:</span><span>$60.00</span>
            </div>
          )}
          {rl.changeAmount.visible && (
            <div className="flex justify-between" style={getPreviewStyle({ ...rl.changeAmount, inverse: rl.changeAmount.inverse }, fontScale)}>
              <span>Change:</span><span>$3.45</span>
            </div>
          )}
        </div>

        {/* ========== FOOTER ========== */}
        <div className="text-center mt-4">
          {rl.thankYouMessage.visible && (
            <div style={getPreviewStyle({ ...rl.thankYouMessage, textAlign: 'center' }, fontScale)}>
              {rl.thankYouMessage.text}
            </div>
          )}
          {rl.greeting.visible && (
            <div style={getPreviewStyle({ ...rl.greeting, textAlign: 'center' }, fontScale)}>
              {rl.greeting.text}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Kitchen 미리보기 (Dine-in) - 새 구조 (ESC/POS 동일 렌더링)
  const KitchenPreviewDineInNew = () => {
    const kl = getCurrentLayoutSettings();
    const mergedElements = kl.mergedElements || [];
    const mergedKeys = new Set(mergedElements.flatMap(m => [m.leftElement.key, m.rightElement.key]));
    const fontScale = kl.fontScale || 1.0;
    const charWidth = getPaperCharWidth(kl.paperWidth || 80);

    const getFontWeight = (weight: string) => {
      if (weight === 'extrabold') return 900;
      if (weight === 'bold') return 700;
      return 400;
    };
    const getFontStyle = (element: any) => element?.isItalic ? 'italic' : 'normal';
    
    // ESC/POS 구분선 렌더링
    const renderSeparatorLine = (sep: SeparatorStyle | undefined) => {
      if (!sep || !sep.visible || sep.style === 'none') return null;
      return (
        <div className="text-gray-600 my-1 text-center overflow-hidden whitespace-nowrap" style={{ fontFamily: 'monospace', fontSize: '10px' }}>
          {getEscPosSeparator(sep.style, charWidth)}
        </div>
      );
    };
    
    // ESC/POS 스타일 적용
    const getKitchenPreviewStyle = (el: any): React.CSSProperties => {
      const previewFontSize = getPreviewFontSize(el.fontSize || 12, fontScale);
      return {
        fontSize: `${previewFontSize}px`,
        lineHeight: `${previewFontSize * 1.2}px`,
        letterSpacing: getPreviewLetterSpacing(el.fontSize || 12),
        marginTop: `${el.lineSpacing || 0}px`,
        fontWeight: getFontWeight(el.fontWeight || 'regular'),
        fontStyle: getFontStyle(el),
        ...(el.inverse ? { backgroundColor: '#000', color: '#fff', padding: '4px 16px', marginLeft: '-16px', marginRight: '-16px' } : {}),
      };
    };
    
    // 샘플 데이터
    const sampleData: Record<string, string> = {
      orderType: 'DINE-IN',
      tableNumber: 'TABLE 5',
      posOrderNumber: 'Order #: 042',
      externalOrderNumber: 'Ext: N/A',
      serverName: 'Sarah K.',
      dateTime: '3:45 PM',
      paidStatus: 'UNPAID',
      specialInstructions: 'No peanuts please',
    };

    const renderItemsList = () => {
      const itemParts = ['items', 'modifiers', 'itemNote', 'kitchenTicketElements'].sort((a, b) => {
        return ((kl as any)[a]?.order || 0) - ((kl as any)[b]?.order || 0);
      });

      const renderPart = (partKey: string, itemName: string, mods: React.ReactNode, note: React.ReactNode, kteElements?: React.ReactNode) => {
        const el = (kl as any)[partKey];
        if (!el || el.visible === false) return null;
        if (partKey === 'items') {
          return <div key="item" style={getKitchenPreviewStyle(el)}>{itemName}</div>;
        }
        if (partKey === 'modifiers' && mods) {
           return <div key="mod" className="ml-4 text-gray-600" style={getKitchenPreviewStyle(el)}>{mods}</div>;
        }
        if (partKey === 'itemNote' && note) {
           return <div key="note" className="ml-4 text-gray-800" style={getKitchenPreviewStyle(el)}>{note}</div>;
        }
        if (partKey === 'kitchenTicketElements' && kteElements) {
           return <div key="kte" className="ml-4 text-gray-700" style={getKitchenPreviewStyle(el)}>{kteElements}</div>;
        }
        return null;
      };

      const renderItemRow = (name: string, mods?: string, note?: string, kte?: React.ReactNode) => (
         <div className="mb-1">
            {itemParts.map(part => renderPart(part, name, mods && <>{kl.modifiers?.prefix || '>>'} {mods}</>, note && <>{kl.itemNote?.prefix || '->'} {note}</>, kte))}
         </div>
      );

      // ESC/POS Guest 구분선 (문자 기반)
      const guestSeparator = kl.guestNumber.visible ? getEscPosSeparator('dashed', Math.floor(charWidth / 3)) : '';

      const kteSample = kl.kitchenTicketElements?.visible ? (
        <><span>{kl.kitchenTicketElements?.prefix || '  - '}1 x California Roll</span><br/><span>{kl.kitchenTicketElements?.prefix || '  - '}2 x BC Roll</span></>
      ) : undefined;

      return (
        <div className="mt-2 text-left">
           {kl.guestNumber.visible && (
               <div className="text-center mb-1" style={getKitchenPreviewStyle(kl.guestNumber)}>{guestSeparator} GUEST 1 {guestSeparator}</div>
           )}
           {renderItemRow('1x Salmon Sashimi', 'Extra Ginger', 'No wasabi')}
           {renderItemRow('1x Miso Soup')}
           {kteSample && renderItemRow('1x Roll Combo A', undefined, undefined, kteSample)}
           {kl.guestNumber.visible && (
               <div className="text-center mb-1" style={getKitchenPreviewStyle(kl.guestNumber)}>{guestSeparator} GUEST 2 {guestSeparator}</div>
           )}
           {renderItemRow('2x Beef Teriyaki', 'Well Done')}
           {renderItemRow('1x Green Tea')}
        </div>
      );
    };

    const renderMergedElement = (merged: MergedElement) => {
      const getVerticalAlign = () => {
        switch(merged.verticalAlign) {
          case 'top': return 'items-start';
          case 'bottom': return 'items-end';
          default: return 'items-center';
        }
      };
      
      const getContainerStyle = (): React.CSSProperties => {
        const gap = merged.gap ?? 16;
        switch(merged.alignment) {
          case 'left-center': return { width: '100%', gap: `${gap}px` };
          case 'left-right': return { width: '100%', justifyContent: 'space-between', gap: `${gap}px` };
          case 'center-center': return { width: '100%', justifyContent: 'center', gap: `${gap}px` };
          case 'center-right': return { width: '100%', justifyContent: 'flex-end', gap: `${gap}px` };
          default: return { width: '100%', gap: `${gap}px` };
        }
      };
      
      const getLeftStyle = (): React.CSSProperties => {
        switch(merged.alignment) {
          case 'left-center': return { flex: '0 0 auto', textAlign: 'left' };
          case 'left-right': return { flex: '0 0 auto', textAlign: 'left' };
          case 'center-center': return { flex: '0 0 auto' };
          case 'center-right': return { flex: '0 0 auto', textAlign: 'center' };
          default: return { flex: '0 0 auto', textAlign: 'left' };
        }
      };
      
      const getRightStyle = (): React.CSSProperties => {
        switch(merged.alignment) {
          case 'left-center': return { flex: 1, textAlign: 'center' };
          case 'left-right': return { flex: '0 0 auto', textAlign: 'right' };
          case 'center-center': return { flex: '0 0 auto' };
          case 'center-right': return { flex: '0 0 auto', textAlign: 'right' };
          default: return { flex: 1, textAlign: 'right' };
        }
      };

      const getContent = (key: string) => {
        if (key === 'items') return renderItemsList();
        return sampleData[key] || kitchenElementLabels[key] || key;
      };

      const getLineInverseStyle = (): React.CSSProperties => merged.lineInverse 
        ? { backgroundColor: '#000', color: '#fff', padding: '4px 8px', marginLeft: '-8px', marginRight: '-8px', width: 'calc(100% + 16px)' } 
        : {};
      
      return (
        <div key={merged.id} className={`flex ${getVerticalAlign()}`} style={{ ...getContainerStyle(), ...getLineInverseStyle() }}>
          <div style={{ ...getLeftStyle(), fontSize: `${merged.leftElement.fontSize * fontScale}px`, lineHeight: `${(merged.leftElement.fontSize + (merged.leftElement.lineHeight ?? 0)) * fontScale}px`, marginTop: `${merged.leftElement.lineSpacing}px`, fontWeight: getFontWeight(merged.leftElement.fontWeight), fontStyle: merged.leftElement.isItalic ? 'italic' : 'normal', ...(!merged.lineInverse && merged.leftElement.inverse ? { backgroundColor: '#000', color: '#fff', padding: '4px 8px' } : {}) }}>
            {getContent(merged.leftElement.key)}
          </div>
          <div style={{ ...getRightStyle(), fontSize: `${merged.rightElement.fontSize * fontScale}px`, lineHeight: `${(merged.rightElement.fontSize + (merged.rightElement.lineHeight ?? 0)) * fontScale}px`, marginTop: `${merged.rightElement.lineSpacing}px`, fontWeight: getFontWeight(merged.rightElement.fontWeight), fontStyle: merged.rightElement.isItalic ? 'italic' : 'normal', ...(!merged.lineInverse && merged.rightElement.inverse ? { backgroundColor: '#000', color: '#fff', padding: '4px 8px' } : {}) }}>
            {getContent(merged.rightElement.key)}
          </div>
        </div>
      );
    };

    // 모든 레이아웃 요소 키 (비-요소 속성 제외)
    const allKeys = Object.keys(kl).filter(k => 
      k !== 'mergedElements' && k !== 'printMode' && k !== 'paperWidth' && k !== 'topMargin' && k !== 'leftMargin' && 
      k !== 'separator1' && k !== 'separator2' && k !== 'splitSeparator' && k !== 'enabled' && k !== 'printerName' && k !== 'fontScale' &&
      k !== 'fontFamily' && k !== 'lineSpacing' && k !== 'separatorStyle' && k !== 'kitchenNote'
    );
    
    // Header, Body, Footer 키 정의
    const HEADER_KEYS = ['orderType', 'tableNumber', 'posOrderNumber', 'externalOrderNumber', 'serverName', 'dateTime', 'deliveryChannel', 'pickupTime', 'customerName', 'customerPhone', 'deliveryAddress', 'paidStatus'];
    const BODY_KEYS = ['items', 'modifiers', 'itemNote', 'guestNumber'];
    const FOOTER_KEYS = ['specialInstructions'];
    
    const renderList: { order: number, type: 'single' | 'merged', key?: string, data?: MergedElement, section: 'header' | 'body' | 'footer' }[] = [];
    
    // 일반 요소 추가
    allKeys.forEach(key => {
      if (mergedKeys.has(key)) return;
      if (['modifiers', 'itemNote', 'guestNumber'].includes(key)) return;
      
      const el = (kl as any)[key] as KitchenElementStyle;
      // paidStatus와 specialInstructions는 항상 표시 (visible 기본값 true)
      const isVisible = el?.visible !== false;
      
      // DEBUG: paidStatus와 specialInstructions 확인
      if (key === 'paidStatus' || key === 'specialInstructions') {
        console.log(`[DineIn Preview] ${key}:`, JSON.stringify({ order: el?.order, visible: el?.visible, showInHeader: (el as any)?.showInHeader, fontSize: el?.fontSize }));
      }
      
      if (el && typeof el.order === 'number' && isVisible) {
        // 중복 표시 로직
        const isHeaderKey = HEADER_KEYS.includes(key);
        const isBodyKey = BODY_KEYS.includes(key);
        const isFooterKey = FOOTER_KEYS.includes(key);
        
        // Header/Footer 설정 가능한 요소들 (Kitchen Dine-In)
        const DUAL_DISPLAY_KEYS = ['orderType', 'tableNumber', 'posOrderNumber', 'externalOrderNumber', 'serverName', 'dateTime', 'paidStatus'];
        
        // showInHeader/showInFooter 로직 (undefined일 경우 Header만 기본 표시)
        if (DUAL_DISPLAY_KEYS.includes(key)) {
          const showInHeader = el.showInHeader !== undefined ? el.showInHeader : true;
          const showInFooter = el.showInFooter !== undefined ? el.showInFooter : false;
          
          if (showInHeader) {
            renderList.push({ order: el.order, type: 'single', key, section: 'header' });
          }
          if (showInFooter) {
            // Footer에 표시할 때는 order를 높게 설정
            renderList.push({ order: 300 + el.order, type: 'single', key, section: 'footer' });
          }
        } else {
          // 일반 요소
          let section: 'header' | 'body' | 'footer' = 'body';
          if (isHeaderKey) section = 'header';
          else if (isFooterKey) section = 'footer';
          
          renderList.push({ order: el.order, type: 'single', key, section });
        }
      }
    });
    
    // 병합된 요소 추가
    mergedElements.forEach(merged => {
      const leftKey = merged.leftElement.key;
      const rightKey = merged.rightElement.key;
      const isHeaderMerged = HEADER_KEYS.includes(leftKey) || HEADER_KEYS.includes(rightKey);
      renderList.push({ order: merged.order, type: 'merged', data: merged, section: isHeaderMerged ? 'header' : 'body' });
    });
    
    // 섹션별로 분리 후 각 섹션 내에서 order로 정렬
    const headerItems = renderList.filter(item => item.section === 'header').sort((a, b) => a.order - b.order);
    const bodyItems = renderList.filter(item => item.section === 'body').sort((a, b) => a.order - b.order);
    const footerItems = renderList.filter(item => item.section === 'footer').sort((a, b) => a.order - b.order);
    
    // DEBUG: 최종 렌더 리스트 확인
    console.log('[DineIn Preview] headerItems:', headerItems.map(i => i.key).join(', '));
    console.log('[DineIn Preview] footerItems:', footerItems.map(i => i.key).join(', '));
    
    // 렌더링 함수 (ESC/POS 스타일 적용)
    const renderItem = (item: typeof renderList[0]) => {
      if (item.type === 'single' && item.key) {
        if (item.key === 'items') return renderItemsList();
        const el = (kl as any)[item.key];
        if (!el) return null;
        
        return (
          <div style={getKitchenPreviewStyle(el)}>
            {sampleData[item.key] || kitchenElementLabels[item.key] || item.key}
          </div>
        );
      }
      if (item.type === 'merged' && item.data) {
        return renderMergedElement(item.data);
      }
      return null;
    };

    return (
      <div className="bg-white border-2 border-dashed border-gray-300 p-4 mx-auto overflow-hidden" style={{ width: `${kl.paperWidth * 4.5}px`, fontFamily: 'monospace', paddingTop: `${kl.topMargin + 16}px`, paddingLeft: `${16 + (kl.leftMargin || 0) * 2}px`, paddingRight: `${16 + (kl.leftMargin || 0) * 2}px`, boxSizing: 'border-box', wordBreak: 'break-word' }}>
        {/* Header Section */}
        {headerItems.map((item, index) => (
          <React.Fragment key={`header-${index}`}>{renderItem(item)}</React.Fragment>
        ))}
        
        {/* Header End Separator (ESC/POS 문자 기반) */}
        {headerItems.length > 0 && renderSeparatorLine(kl.separator1)}
        
        {/* Body Section */}
        {bodyItems.map((item, index) => (
          <React.Fragment key={`body-${index}`}>{renderItem(item)}</React.Fragment>
        ))}
        
        {/* Kitchen Memo (Body 하단 고정) */}
        {kl.kitchenNote?.visible && (
          <div className="text-center" style={getKitchenPreviewStyle(kl.kitchenNote)}>
            *** Kitchen Memo ***
          </div>
        )}
        
        {/* Body End Separator (ESC/POS 문자 기반) */}
        {bodyItems.length > 0 && renderSeparatorLine(kl.separator2)}
        
        {/* Footer Section */}
        {footerItems.map((item, index) => (
          <React.Fragment key={`footer-${index}`}>{renderItem(item)}</React.Fragment>
        ))}
      </div>
    );
  };

  const KitchenPreviewDineInNew_OLD = () => {
    const kl = layoutSettings.kitchenLayout;
    const fontScale = kl.fontScale || 1.0;
    const getFontWeight = (weight: string) => {
      if (weight === 'extrabold') return 900;
      if (weight === 'bold') return 700;
      return 400;
    };
    const getFontStyle = (element: any) => element?.isItalic ? 'italic' : 'normal';
    const getSeparatorClass = (style: string) => {
      switch(style) { case 'dashed': return 'border-dashed'; case 'dotted': return 'border-dotted'; default: return 'border-solid'; }
    };
    const getInverseStyle = (inverse: boolean) => inverse ? { backgroundColor: '#000', color: '#fff', padding: '4px 16px', marginLeft: '-16px', marginRight: '-16px' } : {};
    
    // 샘플 데이터
    const sampleData: Record<string, string> = {
      orderType: 'DINE-IN',
      tableNumber: 'TABLE 5',
      posOrderNumber: 'Order #: 042',
      externalOrderNumber: 'Ext: N/A',
      guestNumber: 'GUEST 1',
      serverName: 'Sarah K.',
      dateTime: '3:45 PM',
      paidStatus: 'UNPAID',
      pickupTime: 'PICKUP: 4:30 PM',
      deliveryChannel: 'DOORDASH',
      customerName: 'John Smith',
      customerPhone: '778-555-1234',
      deliveryAddress: '123 Main St',
    };

    // 병합된 요소 렌더링 함수
    const renderMergedElement = (merged: MergedElement) => {
      const getVerticalAlign = () => {
        switch(merged.verticalAlign) {
          case 'top': return 'items-start';
          case 'bottom': return 'items-end';
          default: return 'items-center';
        }
      };
      
      // 컨테이너 스타일 (정렬에 따라 다름)
      const getContainerStyle = (): React.CSSProperties => {
        const gap = merged.gap ?? 16;
        switch(merged.alignment) {
          case 'left-center': return { width: '100%', gap: `${gap}px` };
          case 'left-right': return { width: '100%', justifyContent: 'space-between', gap: `${gap}px` };
          case 'center-center': return { width: '100%', justifyContent: 'center', gap: `${gap}px` };
          case 'center-right': return { width: '100%', justifyContent: 'flex-end', gap: `${gap}px` };
          default: return { width: '100%', gap: `${gap}px` };
        }
      };
      
      // 정렬에 따른 스타일 계산
      const getLeftStyle = (): React.CSSProperties => {
        switch(merged.alignment) {
          case 'left-center': return { flex: '0 0 auto', textAlign: 'left' };
          case 'left-right': return { flex: '0 0 auto', textAlign: 'left' };
          case 'center-center': return { flex: '0 0 auto' };  // 가운데에서 붙음
          case 'center-right': return { flex: '0 0 auto' };
          default: return { flex: '0 0 auto', textAlign: 'left' };
        }
      };
      
      const getRightStyle = (): React.CSSProperties => {
        switch(merged.alignment) {
          case 'left-center': return { flex: 1, textAlign: 'center' };
          case 'left-right': return { flex: '0 0 auto', textAlign: 'right' };
          case 'center-center': return { flex: '0 0 auto' };  // 가운데에서 붙음
          case 'center-right': return { flex: '0 0 auto', textAlign: 'right' };
          default: return { flex: 1, textAlign: 'right' };
        }
      };

      const getLineInverseStyle = (): React.CSSProperties => merged.lineInverse 
        ? { backgroundColor: '#000', color: '#fff', padding: '4px 8px', marginLeft: '-8px', marginRight: '-8px', width: 'calc(100% + 16px)' } 
        : {};
      
      return (
        <div key={merged.id} className={`flex ${getVerticalAlign()}`} style={{ ...getContainerStyle(), ...getLineInverseStyle() }}>
          <span 
            style={{ 
              ...getLeftStyle(),
              fontSize: `${merged.leftElement.fontSize * fontScale}px`, 
              lineHeight: `${(merged.leftElement.lineHeight || merged.leftElement.fontSize) * fontScale}px`,
              marginTop: `${merged.leftElement.lineSpacing * 2}px`, 
              fontWeight: getFontWeight(merged.leftElement.fontWeight),
              fontStyle: merged.leftElement.isItalic ? 'italic' : 'normal',
              ...(!merged.lineInverse && merged.leftElement.inverse ? { backgroundColor: '#000', color: '#fff', padding: '4px 8px' } : {})
            }}
          >
            {sampleData[merged.leftElement.key] || merged.leftElement.key}
          </span>
          <span 
            style={{ 
              ...getRightStyle(),
              fontSize: `${merged.rightElement.fontSize * fontScale}px`, 
              lineHeight: `${(merged.rightElement.lineHeight || merged.rightElement.fontSize) * fontScale}px`,
              marginTop: `${merged.rightElement.lineSpacing * 2}px`, 
              fontWeight: getFontWeight(merged.rightElement.fontWeight),
              fontStyle: merged.rightElement.isItalic ? 'italic' : 'normal',
              ...(!merged.lineInverse && merged.rightElement.inverse ? { backgroundColor: '#000', color: '#fff', padding: '4px 8px' } : {})
            }}
          >
            {sampleData[merged.rightElement.key] || merged.rightElement.key}
          </span>
        </div>
      );
    };

    const mergedElements = kl.mergedElements || [];
    // 병합된 요소에 포함된 키들
    const mergedKeys = new Set(mergedElements.flatMap(m => [m.leftElement.key, m.rightElement.key]));
    
    return (
      <div className="bg-white border-2 border-dashed border-gray-300 p-4 font-mono text-sm mx-auto" style={{ width: `${kl.paperWidth * 4.5}px`, fontFamily: layoutSettings.fontFamily, paddingTop: `${kl.topMargin + 16}px`, paddingLeft: `${16 + (kl.leftMargin || 0) * 2}px` }}>
        {/* 병합된 요소들 먼저 렌더링 */}
        {mergedElements.map(merged => renderMergedElement(merged))}
        
        {/* Order Type */}
        {kl.orderType.visible && !mergedKeys.has('orderType') && (
          <div className="text-center font-bold" style={{ fontSize: `${kl.orderType.fontSize * fontScale}px`, marginTop: `${kl.orderType.lineSpacing * 2}px`, fontWeight: getFontWeight(kl.orderType.fontWeight), fontStyle: getFontStyle(kl.orderType), ...getInverseStyle(kl.orderType.inverse) }}>
            DINE-IN
          </div>
        )}
        {/* Table Number */}
        {kl.tableNumber.visible && !mergedKeys.has('tableNumber') && (
          <div className="text-center font-bold" style={{ fontSize: `${kl.tableNumber.fontSize * fontScale}px`, marginTop: `${kl.tableNumber.lineSpacing * 2}px`, fontWeight: getFontWeight(kl.tableNumber.fontWeight), fontStyle: getFontStyle(kl.tableNumber), ...getInverseStyle(kl.tableNumber.inverse) }}>
            TABLE 5
          </div>
        )}
        {/* POS Order Number - 내부 순차번호 */}
        {kl.posOrderNumber.visible && !mergedKeys.has('posOrderNumber') && (
          <div className="text-center" style={{ fontSize: `${kl.posOrderNumber.fontSize * fontScale}px`, marginTop: `${kl.posOrderNumber.lineSpacing * 2}px`, fontWeight: getFontWeight(kl.posOrderNumber.fontWeight), fontStyle: getFontStyle(kl.posOrderNumber), ...getInverseStyle(kl.posOrderNumber.inverse) }}>
            Order #: 042
          </div>
        )}
        {/* External Order Number - Dine-in에서는 보통 표시 안함 */}
        {kl.externalOrderNumber.visible && !mergedKeys.has('externalOrderNumber') && (
          <div className="text-center" style={{ fontSize: `${kl.externalOrderNumber.fontSize * fontScale}px`, marginTop: `${kl.externalOrderNumber.lineSpacing * 2}px`, fontWeight: getFontWeight(kl.externalOrderNumber.fontWeight), fontStyle: getFontStyle(kl.externalOrderNumber), ...getInverseStyle(kl.externalOrderNumber.inverse) }}>
            Ext: N/A
          </div>
        )}
        {/* Separator 1 */}
        {kl.separator1.visible && <div className={`border-b ${getSeparatorClass(kl.separator1.style)} border-gray-400 my-2`} />}
        {/* Server & DateTime */}
        {(kl.serverName.visible && !mergedKeys.has('serverName')) || (kl.dateTime.visible && !mergedKeys.has('dateTime')) ? (
          <div className="flex justify-between text-xs">
            {kl.serverName.visible && !mergedKeys.has('serverName') && <span style={{ fontSize: `${kl.serverName.fontSize * fontScale}px`, marginTop: `${kl.serverName.lineSpacing * 2}px`, fontWeight: getFontWeight(kl.serverName.fontWeight), ...getInverseStyle(kl.serverName.inverse) }}>Sarah K.</span>}
            {kl.dateTime.visible && !mergedKeys.has('dateTime') && <span style={{ fontSize: `${kl.dateTime.fontSize * fontScale}px`, marginTop: `${kl.dateTime.lineSpacing * 2}px`, fontWeight: getFontWeight(kl.dateTime.fontWeight), ...getInverseStyle(kl.dateTime.inverse) }}>3:45 PM</span>}
          </div>
        ) : null}
        {/* PAID Status */}
        {kl.paidStatus.visible && !mergedKeys.has('paidStatus') && (
          <div className="text-center mt-2" style={{ fontSize: `${kl.paidStatus.fontSize * fontScale}px`, marginTop: `${kl.paidStatus.lineSpacing * 2}px`, fontWeight: getFontWeight(kl.paidStatus.fontWeight), ...getInverseStyle(kl.paidStatus.inverse) }}>
            UNPAID
          </div>
        )}
        {/* Separator 2 */}
        {kl.separator2.visible && <div className={`border-b ${getSeparatorClass(kl.separator2.style)} border-gray-400 my-2`} />}
        {/* ===== GUEST 1 ===== */}
        {kl.guestNumber.visible && (
            <div className="text-center font-bold" style={{ fontSize: `${kl.guestNumber.fontSize * fontScale}px`, marginTop: `${kl.guestNumber.lineSpacing * 2}px`, fontWeight: getFontWeight(kl.guestNumber.fontWeight), ...getInverseStyle(kl.guestNumber.inverse) }}>
              -------------------- GUEST 1 --------------------
            </div>
        )}
        {/* Guest 1 Items */}
        {kl.items.visible && (
          <div className="mt-2">
            <div style={{ fontSize: `${kl.items.fontSize * fontScale}px`, marginTop: `${kl.items.lineSpacing * 2}px`, fontWeight: getFontWeight(kl.items.fontWeight), ...getInverseStyle(kl.items.inverse) }}>1x Salmon Sashimi</div>
            {kl.modifiers.visible && (
              <div className="ml-4 text-gray-600" style={{ fontSize: `${kl.modifiers.fontSize * fontScale}px`, marginTop: `${kl.modifiers.lineSpacing * 2}px`, fontWeight: getFontWeight(kl.modifiers.fontWeight) }}>
                {kl.modifiers.prefix} Extra Ginger
              </div>
            )}
            {kl.itemNote.visible && (
              <div className="ml-4 text-gray-800" style={{ fontSize: `${kl.itemNote.fontSize * fontScale}px`, marginTop: `${kl.itemNote.lineSpacing * 2}px`, fontWeight: getFontWeight(kl.itemNote.fontWeight), fontStyle: getFontStyle(kl.itemNote) }}>
                {kl.itemNote.prefix} No wasabi
              </div>
            )}
            <div style={{ fontSize: `${kl.items.fontSize * fontScale}px`, marginTop: `${kl.items.lineSpacing * 2}px`, fontWeight: getFontWeight(kl.items.fontWeight) }}>1x Miso Soup</div>
          </div>
        )}

        {/* ===== GUEST 2 ===== */}
        {kl.guestNumber.visible && (
            <div className="text-center font-bold" style={{ fontSize: `${kl.guestNumber.fontSize * fontScale}px`, marginTop: `${kl.guestNumber.lineSpacing * 2}px`, fontWeight: getFontWeight(kl.guestNumber.fontWeight), ...getInverseStyle(kl.guestNumber.inverse) }}>
              -------------------- GUEST 2 --------------------
            </div>
        )}
        {/* Guest 2 Items */}
        {kl.items.visible && kl.guestNumber.visible && (
          <div className="mt-2">
            <div style={{ fontSize: `${kl.items.fontSize * fontScale}px`, marginTop: `${kl.items.lineSpacing * 2}px`, fontWeight: getFontWeight(kl.items.fontWeight), ...getInverseStyle(kl.items.inverse) }}>2x Beef Teriyaki</div>
            {kl.modifiers.visible && (
              <div className="ml-4 text-gray-600" style={{ fontSize: `${kl.modifiers.fontSize * fontScale}px`, marginTop: `${kl.modifiers.lineSpacing * 2}px`, fontWeight: getFontWeight(kl.modifiers.fontWeight) }}>
                {kl.modifiers.prefix} Well Done
              </div>
            )}
            <div style={{ fontSize: `${kl.items.fontSize * fontScale}px`, marginTop: `${kl.items.lineSpacing * 2}px`, fontWeight: getFontWeight(kl.items.fontWeight) }}>1x Green Tea</div>
          </div>
        )}
      </div>
    );
  };

  // Kitchen 미리보기 (Online/Delivery) - ESC/POS 동일 렌더링
  const KitchenPreviewOnlineNew = () => {
    const kl = getCurrentLayoutSettings();
    const mergedElements = kl.mergedElements || [];
    const mergedKeys = new Set(mergedElements.flatMap((m: MergedElement) => [m.leftElement.key, m.rightElement.key]));
    const fontScale = kl.fontScale || 1.0;
    const charWidth = getPaperCharWidth(kl.paperWidth || 80);

    const getFontWeight = (weight: string) => {
      if (weight === 'extrabold') return 900;
      if (weight === 'bold') return 700;
      return 400;
    };
    const getFontStyle = (element: any) => element?.isItalic ? 'italic' : 'normal';
    
    // ESC/POS 구분선 렌더링
    const renderSeparatorLine = (sep: SeparatorStyle | undefined) => {
      if (!sep || !sep.visible || sep.style === 'none') return null;
      return (
        <div className="text-gray-600 my-1 text-center overflow-hidden whitespace-nowrap" style={{ fontFamily: 'monospace', fontSize: '10px' }}>
          {getEscPosSeparator(sep.style, charWidth)}
        </div>
      );
    };
    
    // ESC/POS 스타일 적용
    const getKitchenPreviewStyle = (el: any): React.CSSProperties => {
      const previewFontSize = getPreviewFontSize(el.fontSize || 12, fontScale);
      return {
        fontSize: `${previewFontSize}px`,
        lineHeight: `${previewFontSize * 1.2}px`,
        letterSpacing: getPreviewLetterSpacing(el.fontSize || 12),
        marginTop: `${el.lineSpacing || 0}px`,
        fontWeight: getFontWeight(el.fontWeight || 'regular'),
        fontStyle: getFontStyle(el),
        ...(el.inverse ? { backgroundColor: '#000', color: '#fff', padding: '4px 16px', marginLeft: '-16px', marginRight: '-16px' } : {}),
      };
    };
    
    // 샘플 데이터 (UNPAID 기본)
    const sampleData: Record<string, string> = {
      orderType: 'TOGO',
      tableNumber: 'N/A',
      posOrderNumber: 'Order #: 043',
      externalOrderNumber: '#TZ-12345',
      serverName: 'System',
      dateTime: '4:15 PM',
      paidStatus: 'UNPAID',
      pickupTime: 'PICKUP: 4:30 PM',
      deliveryChannel: 'THEZONE',
      customerName: 'John Smith',
      customerPhone: '778-555-1234',
      deliveryAddress: '',
      specialInstructions: 'Allergy: Peanuts',
    };

    const renderItemsList = () => {
      const itemParts = ['items', 'modifiers', 'itemNote', 'kitchenTicketElements'].sort((a, b) => {
        return ((kl as any)[a]?.order || 0) - ((kl as any)[b]?.order || 0);
      });

      const renderPart = (partKey: string, itemName: string, mods: React.ReactNode, note: React.ReactNode, kteElements?: React.ReactNode) => {
        const el = (kl as any)[partKey];
        if (!el || el.visible === false) return null;
        if (partKey === 'items') {
          return <div key="item" style={getKitchenPreviewStyle(el)}>{itemName}</div>;
        }
        if (partKey === 'modifiers' && mods) {
           return <div key="mod" className="ml-4 text-gray-600" style={getKitchenPreviewStyle(el)}>{mods}</div>;
        }
        if (partKey === 'itemNote' && note) {
           return <div key="note" className="ml-4 text-gray-800" style={getKitchenPreviewStyle(el)}>{note}</div>;
        }
        if (partKey === 'kitchenTicketElements' && kteElements) {
           return <div key="kte" className="ml-4 text-gray-700" style={getKitchenPreviewStyle(el)}>{kteElements}</div>;
        }
        return null;
      };

      const renderItemRow = (name: string, mods?: string, note?: string, kte?: React.ReactNode) => (
         <div className="mb-1">
            {itemParts.map(part => renderPart(part, name, mods && <>{kl.modifiers?.prefix || '>>'} {mods}</>, note && <>{kl.itemNote?.prefix || '->'} {note}</>, kte))}
         </div>
      );

      const kteSample = kl.kitchenTicketElements?.visible ? (
        <><span>{kl.kitchenTicketElements?.prefix || '  - '}1 x California Roll</span><br/><span>{kl.kitchenTicketElements?.prefix || '  - '}2 x BC Roll</span></>
      ) : undefined;

      return (
        <div className="mt-2 text-left">
           {renderItemRow('1x Spicy Tuna Roll', 'Extra Spicy')}
           {kteSample && renderItemRow('1x Roll Combo A', undefined, undefined, kteSample)}
           {renderItemRow('2x Chicken Katsu', undefined, 'Sauce on side')}
           {renderItemRow('1x Coke Zero')}
        </div>
      );
    };

    const renderMergedElement = (merged: MergedElement) => {
      const getVerticalAlign = () => {
        switch(merged.verticalAlign) {
          case 'top': return 'items-start';
          case 'bottom': return 'items-end';
          default: return 'items-center';
        }
      };
      
      const getContainerStyle = (): React.CSSProperties => {
        const gap = merged.gap ?? 16;
        switch(merged.alignment) {
          case 'left-center': return { width: '100%', gap: `${gap}px` };
          case 'left-right': return { width: '100%', justifyContent: 'space-between', gap: `${gap}px` };
          case 'center-center': return { width: '100%', justifyContent: 'center', gap: `${gap}px` };
          case 'center-right': return { width: '100%', justifyContent: 'flex-end', gap: `${gap}px` };
          default: return { width: '100%', gap: `${gap}px` };
        }
      };
      
      const getLeftStyle = (): React.CSSProperties => {
        switch(merged.alignment) {
          case 'left-center': return { flex: '0 0 auto', textAlign: 'left' };
          case 'left-right': return { flex: '0 0 auto', textAlign: 'left' };
          case 'center-center': return { flex: '0 0 auto' };
          case 'center-right': return { flex: '0 0 auto', textAlign: 'center' };
          default: return { flex: '0 0 auto', textAlign: 'left' };
        }
      };
      
      const getRightStyle = (): React.CSSProperties => {
        switch(merged.alignment) {
          case 'left-center': return { flex: 1, textAlign: 'center' };
          case 'left-right': return { flex: '0 0 auto', textAlign: 'right' };
          case 'center-center': return { flex: '0 0 auto' };
          case 'center-right': return { flex: '0 0 auto', textAlign: 'right' };
          default: return { flex: 1, textAlign: 'right' };
        }
      };

      const getContent = (key: string) => {
        if (key === 'items') return renderItemsList();
        return sampleData[key] || kitchenElementLabels[key] || key;
      };

      const getLineInverseStyle = (): React.CSSProperties => merged.lineInverse 
        ? { backgroundColor: '#000', color: '#fff', padding: '4px 8px', marginLeft: '-8px', marginRight: '-8px', width: 'calc(100% + 16px)' } 
        : {};
      
      return (
        <div key={merged.id} className={`flex ${getVerticalAlign()}`} style={{ ...getContainerStyle(), ...getLineInverseStyle() }}>
          <div style={{ ...getLeftStyle(), fontSize: `${merged.leftElement.fontSize * fontScale}px`, lineHeight: `${(merged.leftElement.fontSize + (merged.leftElement.lineHeight ?? 0)) * fontScale}px`, marginTop: `${merged.leftElement.lineSpacing}px`, fontWeight: getFontWeight(merged.leftElement.fontWeight), fontStyle: merged.leftElement.isItalic ? 'italic' : 'normal', ...(!merged.lineInverse && merged.leftElement.inverse ? { backgroundColor: '#000', color: '#fff', padding: '4px 8px' } : {}) }}>
            {getContent(merged.leftElement.key)}
          </div>
          <div style={{ ...getRightStyle(), fontSize: `${merged.rightElement.fontSize * fontScale}px`, lineHeight: `${(merged.rightElement.fontSize + (merged.rightElement.lineHeight ?? 0)) * fontScale}px`, marginTop: `${merged.rightElement.lineSpacing}px`, fontWeight: getFontWeight(merged.rightElement.fontWeight), fontStyle: merged.rightElement.isItalic ? 'italic' : 'normal', ...(!merged.lineInverse && merged.rightElement.inverse ? { backgroundColor: '#000', color: '#fff', padding: '4px 8px' } : {}) }}>
            {getContent(merged.rightElement.key)}
          </div>
        </div>
      );
    };

    // 모든 레이아웃 요소 키 (비-요소 속성 제외)
    const allKeys = Object.keys(kl).filter(k => 
      k !== 'mergedElements' && k !== 'printMode' && k !== 'paperWidth' && k !== 'topMargin' && k !== 'leftMargin' && 
      k !== 'separator1' && k !== 'separator2' && k !== 'splitSeparator' && k !== 'enabled' && k !== 'printerName' && k !== 'fontScale' &&
      k !== 'fontFamily' && k !== 'lineSpacing' && k !== 'separatorStyle' && k !== 'kitchenNote'
    );
    
    // Header, Body, Footer 키 정의
    const HEADER_KEYS = ['orderType', 'tableNumber', 'posOrderNumber', 'externalOrderNumber', 'serverName', 'dateTime', 'deliveryChannel', 'pickupTime', 'customerName', 'customerPhone', 'deliveryAddress', 'paidStatus'];
    const BODY_KEYS = ['items', 'modifiers', 'itemNote', 'guestNumber'];
    const FOOTER_KEYS = ['specialInstructions'];
    
    const renderList: { order: number, type: 'single' | 'merged', key?: string, data?: MergedElement, section: 'header' | 'body' | 'footer' }[] = [];
    
    // 일반 요소 추가
    allKeys.forEach(key => {
      if (mergedKeys.has(key)) return;
      if (['modifiers', 'itemNote', 'guestNumber'].includes(key)) return;
      
      const el = (kl as any)[key] as KitchenElementStyle;
      // paidStatus와 specialInstructions는 항상 표시 (visible 기본값 true)
      const isVisible = el?.visible !== false;
      
      // DEBUG: paidStatus와 specialInstructions 확인
      if (key === 'paidStatus' || key === 'specialInstructions') {
        console.log(`[Online Preview] ${key}:`, JSON.stringify({ order: el?.order, visible: el?.visible, showInHeader: (el as any)?.showInHeader, fontSize: el?.fontSize }));
      }
      
      if (el && typeof el.order === 'number' && isVisible) {
        // 중복 표시 로직
        const isHeaderKey = HEADER_KEYS.includes(key);
        const isBodyKey = BODY_KEYS.includes(key);
        const isFooterKey = FOOTER_KEYS.includes(key);
        
        // Header/Footer 설정 가능한 요소들 (External Kitchen)
        const DUAL_DISPLAY_KEYS = ['orderType', 'tableNumber', 'posOrderNumber', 'externalOrderNumber', 'deliveryChannel', 'pickupTime', 'serverName', 'dateTime', 'customerName', 'customerPhone', 'deliveryAddress', 'paidStatus'];
        
        // showInHeader/showInFooter 로직 (undefined일 경우 Header만 기본 표시)
        if (DUAL_DISPLAY_KEYS.includes(key)) {
          const showInHeader = el.showInHeader !== undefined ? el.showInHeader : true;
          const showInFooter = el.showInFooter !== undefined ? el.showInFooter : false;
          
          if (showInHeader) {
            renderList.push({ order: el.order, type: 'single', key, section: 'header' });
          }
          if (showInFooter) {
            // Footer에 표시할 때는 order를 높게 설정
            renderList.push({ order: 300 + el.order, type: 'single', key, section: 'footer' });
          }
        } else {
          // 일반 요소
          let section: 'header' | 'body' | 'footer' = 'body';
          if (isHeaderKey) section = 'header';
          else if (isFooterKey) section = 'footer';
          
          renderList.push({ order: el.order, type: 'single', key, section });
        }
      }
    });
    
    // 병합된 요소 추가
    mergedElements.forEach((merged: MergedElement) => {
      const leftKey = merged.leftElement.key;
      const rightKey = merged.rightElement.key;
      const isHeaderMerged = HEADER_KEYS.includes(leftKey) || HEADER_KEYS.includes(rightKey);
      renderList.push({ order: merged.order, type: 'merged', data: merged, section: isHeaderMerged ? 'header' : 'body' });
    });
    
    // 섹션별로 분리 후 각 섹션 내에서 order로 정렬
    const headerItems = renderList.filter(item => item.section === 'header').sort((a, b) => a.order - b.order);
    const bodyItems = renderList.filter(item => item.section === 'body').sort((a, b) => a.order - b.order);
    const footerItems = renderList.filter(item => item.section === 'footer').sort((a, b) => a.order - b.order);
    
    // DEBUG: 최종 렌더 리스트 확인
    console.log('[Online Preview] headerItems:', headerItems.map(i => i.key).join(', '));
    console.log('[Online Preview] footerItems:', footerItems.map(i => i.key).join(', '));
    
    // 렌더링 함수
    const renderItem = (item: typeof renderList[0]) => {
      if (item.type === 'single' && item.key) {
        if (item.key === 'items') return renderItemsList();
        const el = (kl as any)[item.key];
        if (!el) return null;
        
        return (
          <div style={getKitchenPreviewStyle(el)}>
            {sampleData[item.key] || kitchenElementLabels[item.key] || item.key}
          </div>
        );
      }
      if (item.type === 'merged' && item.data) {
        return renderMergedElement(item.data);
      }
      return null;
    };

    return (
      <div className="bg-white border-2 border-dashed border-gray-300 p-4 mx-auto overflow-hidden" style={{ width: `${kl.paperWidth * 4.5}px`, fontFamily: 'monospace', paddingTop: `${kl.topMargin + 16}px`, paddingLeft: `${16 + (kl.leftMargin || 0) * 2}px`, paddingRight: `${16 + (kl.leftMargin || 0) * 2}px`, boxSizing: 'border-box', wordBreak: 'break-word' }}>
        {/* Header Section */}
        {headerItems.map((item, index) => (
          <React.Fragment key={`header-${index}`}>{renderItem(item)}</React.Fragment>
        ))}
        
        {/* Header End Separator (ESC/POS 문자 기반) */}
        {headerItems.length > 0 && renderSeparatorLine(kl.separator1)}
        
        {/* Body Section */}
        {bodyItems.map((item, index) => (
          <React.Fragment key={`body-${index}`}>{renderItem(item)}</React.Fragment>
        ))}
        
        {/* Kitchen Memo (Body 하단 고정) */}
        {kl.kitchenNote?.visible && (
          <div className="text-center" style={getKitchenPreviewStyle(kl.kitchenNote)}>
            *** Kitchen Memo ***
          </div>
        )}
        
        {/* Body End Separator (ESC/POS 문자 기반) */}
        {bodyItems.length > 0 && renderSeparatorLine(kl.separator2)}
        
        {/* Footer Section */}
        {footerItems.map((item, index) => (
          <React.Fragment key={`footer-${index}`}>{renderItem(item)}</React.Fragment>
        ))}
      </div>
    );
  };

  const KitchenPreviewOnlineNew_OLD = () => {
    const kl = layoutSettings.kitchenLayout;
    const fontScale = kl.fontScale || 1.0;
    const getFontWeight = (weight: string) => {
      if (weight === 'extrabold') return 900;
      if (weight === 'bold') return 700;
      return 400;
    };
    const getFontStyle = (element: any) => element?.isItalic ? 'italic' : 'normal';
    const getSeparatorClass = (style: string) => {
      switch(style) { case 'dashed': return 'border-dashed'; case 'dotted': return 'border-dotted'; default: return 'border-solid'; }
    };
    const getInverseStyle = (inverse: boolean) => inverse ? { backgroundColor: '#000', color: '#fff', padding: '4px 16px', marginLeft: '-16px', marginRight: '-16px' } : {};
    
    // 샘플 데이터
    const sampleData: Record<string, string> = {
      orderType: 'DELIVERY',
      tableNumber: 'N/A',
      posOrderNumber: 'Order #: 043',
      externalOrderNumber: '#DD-78542',
      guestNumber: 'N/A',
      serverName: 'System',
      dateTime: '4:15 PM',
      paidStatus: 'UNPAID',  // 기본값: UNPAID (온라인결제 시에만 PAID)
      pickupTime: 'PICKUP: 4:30 PM',
      deliveryChannel: 'THEZONE',
      customerName: 'John Smith',
      customerPhone: '778-555-1234',
      deliveryAddress: '123 Main St, Vancouver',
    };

    // 병합된 요소 렌더링 함수
    const renderMergedElement = (merged: MergedElement) => {
      const getVerticalAlign = () => {
        switch(merged.verticalAlign) {
          case 'top': return 'items-start';
          case 'bottom': return 'items-end';
          default: return 'items-center';
        }
      };
      
      // 컨테이너 스타일 (정렬에 따라 다름)
      const getContainerStyle = (): React.CSSProperties => {
        const gap = merged.gap ?? 16;
        switch(merged.alignment) {
          case 'left-center': return { width: '100%', gap: `${gap}px` };
          case 'left-right': return { width: '100%', justifyContent: 'space-between', gap: `${gap}px` };
          case 'center-center': return { width: '100%', justifyContent: 'center', gap: `${gap}px` };
          case 'center-right': return { width: '100%', justifyContent: 'flex-end', gap: `${gap}px` };
          default: return { width: '100%', gap: `${gap}px` };
        }
      };
      
      // 정렬에 따른 스타일 계산
      const getLeftStyle = (): React.CSSProperties => {
        switch(merged.alignment) {
          case 'left-center': return { flex: '0 0 auto', textAlign: 'left' };
          case 'left-right': return { flex: '0 0 auto', textAlign: 'left' };
          case 'center-center': return { flex: '0 0 auto' };
          case 'center-right': return { flex: '0 0 auto' };
          default: return { flex: '0 0 auto', textAlign: 'left' };
        }
      };
      
      const getRightStyle = (): React.CSSProperties => {
        switch(merged.alignment) {
          case 'left-center': return { flex: 1, textAlign: 'center' };
          case 'left-right': return { flex: '0 0 auto', textAlign: 'right' };
          case 'center-center': return { flex: '0 0 auto' };
          case 'center-right': return { flex: '0 0 auto', textAlign: 'right' };
          default: return { flex: 1, textAlign: 'right' };
        }
      };

      const getLineInverseStyle = (): React.CSSProperties => merged.lineInverse 
        ? { backgroundColor: '#000', color: '#fff', padding: '4px 8px', marginLeft: '-8px', marginRight: '-8px', width: 'calc(100% + 16px)' } 
        : {};
      
      return (
        <div key={merged.id} className={`flex ${getVerticalAlign()}`} style={{ ...getContainerStyle(), ...getLineInverseStyle() }}>
          <span 
            style={{ 
              ...getLeftStyle(),
              fontSize: `${merged.leftElement.fontSize * fontScale}px`, 
              lineHeight: `${(merged.leftElement.lineHeight || merged.leftElement.fontSize) * fontScale}px`,
              marginTop: `${merged.leftElement.lineSpacing * 2}px`, 
              fontWeight: getFontWeight(merged.leftElement.fontWeight),
              fontStyle: merged.leftElement.isItalic ? 'italic' : 'normal',
              ...(!merged.lineInverse && merged.leftElement.inverse ? { backgroundColor: '#000', color: '#fff', padding: '4px 8px' } : {})
            }}
          >
            {sampleData[merged.leftElement.key] || merged.leftElement.key}
          </span>
          <span 
            style={{ 
              ...getRightStyle(),
              fontSize: `${merged.rightElement.fontSize * fontScale}px`, 
              lineHeight: `${(merged.rightElement.lineHeight || merged.rightElement.fontSize) * fontScale}px`,
              marginTop: `${merged.rightElement.lineSpacing * 2}px`, 
              fontWeight: getFontWeight(merged.rightElement.fontWeight),
              fontStyle: merged.rightElement.isItalic ? 'italic' : 'normal',
              ...(!merged.lineInverse && merged.rightElement.inverse ? { backgroundColor: '#000', color: '#fff', padding: '4px 8px' } : {})
            }}
          >
            {sampleData[merged.rightElement.key] || merged.rightElement.key}
          </span>
        </div>
      );
    };

    const mergedElements = kl.mergedElements || [];
    const mergedKeys = new Set(mergedElements.flatMap(m => [m.leftElement.key, m.rightElement.key]));
    
    return (
      <div className="bg-white border-2 border-dashed border-gray-300 p-4 font-mono text-sm mx-auto" style={{ width: `${kl.paperWidth * 4.5}px`, fontFamily: layoutSettings.fontFamily, paddingTop: `${kl.topMargin + 16}px`, paddingLeft: `${16 + (kl.leftMargin || 0) * 2}px` }}>
        {/* 병합된 요소들 먼저 렌더링 */}
        {mergedElements.map(merged => renderMergedElement(merged))}
        
        {/* Delivery Channel */}
        {kl.deliveryChannel.visible && !mergedKeys.has('deliveryChannel') && (
          <div className="text-center font-bold" style={{ fontSize: `${kl.deliveryChannel.fontSize * fontScale}px`, marginTop: `${kl.deliveryChannel.lineSpacing * 2}px`, fontWeight: getFontWeight(kl.deliveryChannel.fontWeight), ...getInverseStyle(kl.deliveryChannel.inverse) }}>
            DOORDASH
          </div>
        )}
        {/* Order Type */}
        {kl.orderType.visible && !mergedKeys.has('orderType') && (
          <div className="text-center font-bold" style={{ fontSize: `${kl.orderType.fontSize * fontScale}px`, marginTop: `${kl.orderType.lineSpacing * 2}px`, fontWeight: getFontWeight(kl.orderType.fontWeight), ...getInverseStyle(kl.orderType.inverse) }}>
            DELIVERY
          </div>
        )}
        {/* POS Order Number - 내부 순차번호 */}
        {kl.posOrderNumber.visible && !mergedKeys.has('posOrderNumber') && (
          <div className="text-center" style={{ fontSize: `${kl.posOrderNumber.fontSize * fontScale}px`, marginTop: `${kl.posOrderNumber.lineSpacing * 2}px`, fontWeight: getFontWeight(kl.posOrderNumber.fontWeight), fontStyle: getFontStyle(kl.posOrderNumber), ...getInverseStyle(kl.posOrderNumber.inverse) }}>
            Order #: 043
          </div>
        )}
        {/* External Order Number - 딜리버리 채널 원본 번호 */}
        {kl.externalOrderNumber.visible && !mergedKeys.has('externalOrderNumber') && (
          <div className="text-center" style={{ fontSize: `${kl.externalOrderNumber.fontSize * fontScale}px`, marginTop: `${kl.externalOrderNumber.lineSpacing * 2}px`, fontWeight: getFontWeight(kl.externalOrderNumber.fontWeight), fontStyle: getFontStyle(kl.externalOrderNumber), ...getInverseStyle(kl.externalOrderNumber.inverse) }}>
            #DD-78542
          </div>
        )}
        {/* Pickup Time */}
        {kl.pickupTime.visible && !mergedKeys.has('pickupTime') && (
          <div className="text-center mt-2" style={{ fontSize: `${kl.pickupTime.fontSize * fontScale}px`, marginTop: `${kl.pickupTime.lineSpacing * 2}px`, fontWeight: getFontWeight(kl.pickupTime.fontWeight), ...getInverseStyle(kl.pickupTime.inverse) }}>
            PICKUP: 4:30 PM
          </div>
        )}
        {/* Separator 1 */}
        {kl.separator1.visible && <div className={`border-b ${getSeparatorClass(kl.separator1.style)} border-gray-400 my-2`} />}
        {/* Customer Info */}
        {kl.customerName.visible && !mergedKeys.has('customerName') && (
          <div style={{ fontSize: `${kl.customerName.fontSize * fontScale}px`, marginTop: `${kl.customerName.lineSpacing * 2}px`, fontWeight: getFontWeight(kl.customerName.fontWeight), ...getInverseStyle(kl.customerName.inverse) }}>
            John Smith
          </div>
        )}
        {kl.customerPhone.visible && !mergedKeys.has('customerPhone') && (
          <div style={{ fontSize: `${kl.customerPhone.fontSize * fontScale}px`, marginTop: `${kl.customerPhone.lineSpacing * 2}px`, fontWeight: getFontWeight(kl.customerPhone.fontWeight), ...getInverseStyle(kl.customerPhone.inverse) }}>
            778-555-1234
          </div>
        )}
        {kl.deliveryAddress.visible && !mergedKeys.has('deliveryAddress') && (
          <div style={{ fontSize: `${kl.deliveryAddress.fontSize * fontScale}px`, marginTop: `${kl.deliveryAddress.lineSpacing * 2}px`, fontWeight: getFontWeight(kl.deliveryAddress.fontWeight), ...getInverseStyle(kl.deliveryAddress.inverse) }}>
            123 Main St, Vancouver
          </div>
        )}
        {/* PAID Status */}
        {kl.paidStatus.visible && !mergedKeys.has('paidStatus') && (
          <div className="text-center mt-2" style={{ fontSize: `${kl.paidStatus.fontSize * fontScale}px`, marginTop: `${kl.paidStatus.lineSpacing * 2}px`, fontWeight: getFontWeight(kl.paidStatus.fontWeight), ...getInverseStyle(kl.paidStatus.inverse) }}>
            PAID
          </div>
        )}
        {/* Separator 2 */}
        {kl.separator2.visible && <div className={`border-b ${getSeparatorClass(kl.separator2.style)} border-gray-400 my-2`} />}
        {/* Items */}
        {kl.items.visible && (
          <div className="mt-2">
            <div style={{ fontSize: `${kl.items.fontSize * fontScale}px`, marginTop: `${kl.items.lineSpacing * 2}px`, fontWeight: getFontWeight(kl.items.fontWeight) }}>1x Salmon Sashimi</div>
            {kl.modifiers.visible && (
              <div className="ml-4 text-gray-600" style={{ fontSize: `${kl.modifiers.fontSize * fontScale}px`, marginTop: `${kl.modifiers.lineSpacing * 2}px`, fontWeight: getFontWeight(kl.modifiers.fontWeight) }}>
                {kl.modifiers.prefix} Extra Ginger
              </div>
            )}
            {kl.itemNote.visible && (
              <div className="ml-4 text-gray-800" style={{ fontSize: `${kl.itemNote.fontSize * fontScale}px`, marginTop: `${kl.itemNote.lineSpacing * 2}px`, fontWeight: getFontWeight(kl.itemNote.fontWeight), fontStyle: getFontStyle(kl.itemNote) }}>
                {kl.itemNote.prefix} No wasabi
              </div>
            )}
            <div style={{ fontSize: `${kl.items.fontSize * fontScale}px`, marginTop: `${kl.items.lineSpacing * 2}px`, fontWeight: getFontWeight(kl.items.fontWeight) }}>2x Beef Teriyaki</div>
          </div>
        )}
        {/* Special Instructions */}
        {kl.specialInstructions.visible && kl.specialInstructions.text && (
          <div className="mt-2 p-2 bg-yellow-100 border border-yellow-400 rounded" style={{ fontSize: `${kl.specialInstructions.fontSize * fontScale}px`, marginTop: `${kl.specialInstructions.lineSpacing * 2}px`, fontWeight: getFontWeight(kl.specialInstructions.fontWeight) }}>
            ⚠️ {kl.specialInstructions.text}
          </div>
        )}
      </div>
    );
  };

  // Receipt 미리보기 (기존)
  const ReceiptPreview = () => (
    <div 
      className="bg-white border-2 border-dashed border-gray-300 p-6 font-mono text-sm mx-auto"
      style={{ 
        width: `${layoutSettings.paperWidth * 4.5}px`,
        fontFamily: layoutSettings.fontFamily,
        lineHeight: layoutSettings.receipt.bodyLineSpacing
      }}
    >
      {layoutSettings.receipt.showStoreName && (
        <div className="text-center font-bold" style={{ fontSize: layoutSettings.headerFontSize }}>LUCKY HAN RESTAURANT</div>
      )}
      {layoutSettings.receipt.showStoreAddress && (
        <div className="text-center" style={{ fontSize: layoutSettings.footerFontSize }}>123 Main Street, Vancouver, BC</div>
      )}
      {layoutSettings.receipt.showStorePhone && (
        <div className="text-center mb-2" style={{ fontSize: layoutSettings.footerFontSize }}>Tel: 778-123-4567</div>
      )}
      
      <div className="border-t border-b border-gray-400 py-1 my-2" style={{ fontSize: layoutSettings.bodyFontSize }}>
        {layoutSettings.receipt.showOrderNumber && <div>Order#: ORD-20251212-001</div>}
        {layoutSettings.receipt.showTableNumber && <div>Table: 5</div>}
        {layoutSettings.receipt.showServerName && <div>Server: John</div>}
        {layoutSettings.receipt.showDateTime && <div>Date: 2025-12-12 19:35</div>}
      </div>
      
      <div className="py-1" style={{ fontSize: layoutSettings.bodyFontSize }}>
        <div className="flex justify-between"><span>Salmon Sashimi x1</span><span>$18.99</span></div>
        {layoutSettings.receipt.showItemModifiers && (
          <div className="text-gray-500 ml-2" style={{ fontSize: layoutSettings.footerFontSize }}>+ Extra Ginger</div>
        )}
        <div className="flex justify-between"><span>Beef Teriyaki x2</span><span>$29.98</span></div>
        <div className="flex justify-between"><span>Miso Soup x2</span><span>$7.98</span></div>
      </div>
      
      <div className="border-t border-gray-400 pt-1 mt-2" style={{ fontSize: layoutSettings.bodyFontSize }}>
        {layoutSettings.receipt.showSubtotal && <div className="flex justify-between"><span>Subtotal:</span><span>$56.95</span></div>}
        {layoutSettings.receipt.showTax && <div className="flex justify-between"><span>Tax (5%):</span><span>$2.85</span></div>}
        {layoutSettings.receipt.showGrandTotal && (
          <div className="flex justify-between font-bold border-t border-gray-400 pt-1 mt-1" style={{ fontSize: layoutSettings.headerFontSize }}>
            <span>TOTAL:</span><span>$59.80</span>
          </div>
        )}
      </div>
      
      {layoutSettings.receipt.showPaymentMethod && (
        <div className="border-t border-gray-400 pt-1 mt-2" style={{ fontSize: layoutSettings.bodyFontSize }}>
          <div className="flex justify-between"><span>Payment:</span><span>VISA</span></div>
          {layoutSettings.receipt.showPaymentDetails && <div className="flex justify-between text-gray-600"><span>Card:</span><span>****1234</span></div>}
          {layoutSettings.receipt.showChangeAmount && <div className="flex justify-between"><span>Change:</span><span>$0.00</span></div>}
        </div>
      )}
      
      {layoutSettings.receipt.thankYouMessage && (
        <div className="text-center font-bold mt-3" style={{ fontSize: layoutSettings.bodyFontSize }}>{layoutSettings.receipt.thankYouMessage}</div>
      )}
      
      {layoutSettings.receipt.showFooterMessage && layoutSettings.receipt.footerMessage && (
        <div className="text-center mt-1" style={{ fontSize: layoutSettings.footerFontSize }}>{layoutSettings.receipt.footerMessage}</div>
      )}
    </div>
  );

  // Kitchen 미리보기 - Online/Delivery
  const KitchenPreviewOnline = () => (
    <div 
      className="bg-white border-2 border-dashed border-orange-400 p-4 font-mono text-sm"
      style={{ 
        width: `${layoutSettings.paperWidth * 3.75}px`,
        fontFamily: layoutSettings.fontFamily,
        paddingTop: `${layoutSettings.kitchen.topMargin * 2}px`,
        paddingLeft: `${(layoutSettings.kitchen.leftMargin || 0) * 2}px`
      }}
    >
      {/* Online Order 배너 */}
      <div className="text-center font-bold bg-orange-500 text-white py-1 mb-2" style={{ fontSize: layoutSettings.kitchen.headerFontSize, lineHeight: layoutSettings.kitchen.headerLineSpacing }}>
        🌐 ONLINE ORDER
      </div>
      
      {layoutSettings.kitchen.headerText && (
        <div className="text-center font-bold mb-1" style={{ fontSize: layoutSettings.kitchen.headerFontSize, lineHeight: layoutSettings.kitchen.headerLineSpacing }}>{layoutSettings.kitchen.headerText}</div>
      )}
      
      <div className="border-b border-gray-400 pb-1 mb-2" style={{ fontSize: layoutSettings.kitchen.bodyFontSize, lineHeight: layoutSettings.kitchen.bodyLineSpacing }}>
        {layoutSettings.kitchen.showOrderNumber && <div className="font-bold">Order#: ONL-20251212-001</div>}
        <div className="font-bold text-orange-600">📱 Pickup: 7:45 PM</div>
        <div>Customer: John Kim</div>
        <div>Phone: 778-123-4567</div>
        {layoutSettings.kitchen.showDateTime && <div className="text-gray-500">19:30:25</div>}
      </div>
      
      <div style={{ fontSize: layoutSettings.kitchen.itemFontSize, lineHeight: layoutSettings.kitchen.bodyLineSpacing }}>
        <div className="font-bold" style={{ marginBottom: `${layoutSettings.kitchen.itemGap}px` }}>
          1x Salmon Sashimi
          {layoutSettings.kitchen.showItemModifiers && <div className="ml-2" style={{ fontSize: layoutSettings.kitchen.modifierFontSize, marginTop: `${layoutSettings.kitchen.modifierGap}px` }}>+ Extra Ginger</div>}
          {layoutSettings.kitchen.showItemNotes && <div className="ml-2 italic" style={{ fontSize: layoutSettings.kitchen.modifierFontSize, marginTop: `${layoutSettings.kitchen.modifierGap}px` }}>Memo: No wasabi</div>}
        </div>
        <div className="font-bold" style={{ marginBottom: `${layoutSettings.kitchen.itemGap}px` }}>2x Beef Teriyaki</div>
        <div className="font-bold">1x Miso Soup</div>
      </div>
      
      <div className="border-t border-gray-400 mt-2 pt-1 text-center" style={{ fontSize: layoutSettings.kitchen.footerFontSize, lineHeight: layoutSettings.kitchen.footerLineSpacing }}>
        <div className="italic">Special: No plastic utensils</div>
      </div>
    </div>
  );

  // Kitchen 미리보기 - Dine-in/Togo/Kiosk
  const KitchenPreviewDineIn = () => (
    <div 
      className="bg-white border-2 border-dashed border-green-400 p-4 font-mono text-sm"
      style={{ 
        width: `${layoutSettings.paperWidth * 3.75}px`,
        fontFamily: layoutSettings.fontFamily,
        paddingTop: `${layoutSettings.kitchen.topMargin * 2}px`,
        paddingLeft: `${(layoutSettings.kitchen.leftMargin || 0) * 2}px`
      }}
    >
      {layoutSettings.kitchen.headerText && (
        <div className="text-center font-bold mb-1" style={{ fontSize: layoutSettings.kitchen.headerFontSize, lineHeight: layoutSettings.kitchen.headerLineSpacing }}>{layoutSettings.kitchen.headerText}</div>
      )}
      
      {layoutSettings.kitchen.showAdditionalOrderBanner && (
        <div className="text-center font-bold bg-gray-200 py-1 mb-2" style={{ fontSize: layoutSettings.kitchen.headerFontSize, lineHeight: layoutSettings.kitchen.headerLineSpacing }}>
          {layoutSettings.kitchen.additionalOrderText}
        </div>
      )}
      
      <div className="border-b border-gray-400 pb-1 mb-2" style={{ fontSize: layoutSettings.kitchen.bodyFontSize, lineHeight: layoutSettings.kitchen.bodyLineSpacing }}>
        {layoutSettings.kitchen.showOrderNumber && <div className="font-bold">Order#: ORD-20251212-001</div>}
        <div className="flex justify-between">
          {layoutSettings.kitchen.showTableNumber && <span className="font-bold text-green-600">Table: 5</span>}
          {layoutSettings.kitchen.showServerName && <span>Server: John</span>}
        </div>
        {layoutSettings.kitchen.showDateTime && <div>19:30:25</div>}
      </div>
      
      {layoutSettings.kitchen.showGuestSeparator ? (
        <div style={{ lineHeight: layoutSettings.kitchen.bodyLineSpacing }}>
          <div className="text-center py-1" style={{ fontSize: layoutSettings.kitchen.modifierFontSize }}>--------- 1 ---------</div>
          <div style={{ fontSize: layoutSettings.kitchen.itemFontSize }}>
            <div className="font-bold" style={{ marginBottom: `${layoutSettings.kitchen.itemGap}px` }}>
              1x Salmon Sashimi
              {layoutSettings.kitchen.showItemModifiers && <div className="ml-2" style={{ fontSize: layoutSettings.kitchen.modifierFontSize, marginTop: `${layoutSettings.kitchen.modifierGap}px` }}>+ Extra Ginger</div>}
              {layoutSettings.kitchen.showItemNotes && <div className="ml-2 italic" style={{ fontSize: layoutSettings.kitchen.modifierFontSize, marginTop: `${layoutSettings.kitchen.modifierGap}px` }}>Memo: No wasabi</div>}
            </div>
          </div>
          <div className="text-center py-1" style={{ fontSize: layoutSettings.kitchen.modifierFontSize }}>--------- 2 ---------</div>
          <div style={{ fontSize: layoutSettings.kitchen.itemFontSize }}>
            <div className="font-bold" style={{ marginBottom: `${layoutSettings.kitchen.itemGap}px` }}>2x Beef Teriyaki</div>
            <div className="font-bold">1x Miso Soup</div>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: layoutSettings.kitchen.itemFontSize, lineHeight: layoutSettings.kitchen.bodyLineSpacing }}>
          <div className="font-bold" style={{ marginBottom: `${layoutSettings.kitchen.itemGap}px` }}>
            1x Salmon Sashimi
            {layoutSettings.kitchen.showItemModifiers && <div className="ml-2" style={{ fontSize: layoutSettings.kitchen.modifierFontSize, marginTop: `${layoutSettings.kitchen.modifierGap}px` }}>+ Extra Ginger</div>}
            {layoutSettings.kitchen.showItemNotes && <div className="ml-2 italic" style={{ fontSize: layoutSettings.kitchen.modifierFontSize, marginTop: `${layoutSettings.kitchen.modifierGap}px` }}>Memo: No wasabi</div>}
          </div>
          <div className="font-bold" style={{ marginBottom: `${layoutSettings.kitchen.itemGap}px` }}>2x Beef Teriyaki</div>
          <div className="font-bold">1x Miso Soup</div>
        </div>
      )}
    </div>
  );

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">🖨️ Printer Settings</h1>
        <div className="flex items-center gap-3">
          {isLoadingSettings && <span className="text-gray-500 text-sm">Loading...</span>}
          {hasUnsavedChanges && saveStatus === 'idle' && (
            <span className="text-orange-600 text-sm">● Unsaved changes</span>
          )}
          {saveStatus === 'saving' && (
            <span className="text-blue-600 font-medium bg-blue-50 px-3 py-1 rounded-full">⏳ Saving...</span>
          )}
          {saveStatus === 'saved' && (
            <span className="text-green-600 font-medium bg-green-50 px-3 py-1 rounded-full">✓ Saved</span>
          )}
          <button
            onClick={handleSaveLayoutSettings}
            disabled={!hasUnsavedChanges || saveStatus === 'saving'}
            className={`px-6 py-2 rounded-lg font-medium transition-colors ${
              hasUnsavedChanges && saveStatus !== 'saving'
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            💾 Save
          </button>
        </div>
      </div>

      {/* 탭 네비게이션 */}
      <div className="flex gap-1 mb-6 border-b">
        {[
          { id: 'printers', label: 'Printers & Groups' },
          { id: 'newPrinter', label: 'New Printer' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`px-4 py-3 font-medium rounded-t-lg transition-colors ${
              activeTab === tab.id
                ? 'bg-blue-600 text-white'
                : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ===================== 프린터 & 그룹 탭 ===================== */}
      {activeTab === 'printers' && (
        <div className="grid grid-cols-2 gap-6 h-[calc(100vh-220px)]">
          {/* 왼쪽: 프린터 설정 */}
          <div className="bg-white rounded-lg shadow-md p-6 overflow-y-auto max-h-full">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-800">🖨️ Printers</h2>
              <div className="flex items-center gap-2">
                {printerSaveStatus === 'saving' && (
                  <span className="text-sm text-blue-600">💾 Saving...</span>
                )}
                {printerSaveStatus === 'saved' && (
                  <span className="text-sm text-green-600">✅ Saved</span>
                )}
                <button
                  onClick={fetchSystemPrinters}
                  className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded"
                >
                  🔄 Refresh
                </button>
                <button
                  onClick={savePrintersToDatabase}
                  className="px-4 py-1.5 text-sm rounded font-medium bg-blue-600 text-white hover:bg-blue-700"
                >
                  {printerSaveStatus === 'saving' ? '⏳ Saving...' : '💾 Save'}
                </button>
              </div>
            </div>

            <div className="space-y-1">
              {printerSlots.map((slot, index) => (
                <div 
                  key={slot.id} 
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${
                    slot.name ? 'bg-green-50 border-green-300' : 'bg-gray-50 border-gray-200'
                  }`}
                >
                  <span className="text-xs text-gray-400 w-5">{index + 1}.</span>
                  <input
                    type="text"
                    value={slot.name}
                    onChange={(e) => handleSlotNameChange(slot.id, e.target.value)}
                    placeholder="Printer Name"
                    className="w-32 p-2 border rounded text-sm font-bold bg-white"
                  />
                  <select
                    value={slot.type}
                    onChange={(e) => handleSlotTypeChange(slot.id, e.target.value as PrinterSlot['type'])}
                    className="w-28 p-2 border rounded text-sm bg-white"
                  >
                    <option value="">Type</option>
                    <option value="receipt">Receipt</option>
                    <option value="kitchen">Kitchen</option>
                    <option value="label">Label</option>
                  </select>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-500 font-semibold">Scale</span>
                    <input
                      type="number"
                      min={0.5}
                      max={1.5}
                      step={0.05}
                      value={typeof slot.graphicScale === 'number' ? slot.graphicScale : 1.0}
                      onChange={(e) => handleSlotGraphicScaleChange(slot.id, e.target.value)}
                      className="w-20 p-2 border rounded text-sm bg-white text-center font-bold"
                      title="Graphic Scale (0.5 ~ 1.5)"
                    />
                  </div>
                  <button
                    onClick={() => openPrinterModal(slot.id)}
                    className={`px-3 py-1.5 text-xs rounded max-w-[180px] truncate font-bold ${
                      slot.selectedPrinter 
                        ? 'bg-green-600 text-white' 
                        : 'bg-blue-500 text-white'
                    }`}
                    title={slot.selectedPrinter || 'Click to select printer'}
                  >
                    {slot.selectedPrinter || 'Select Printer'}
                  </button>
                  {/* 수정 버튼 - 프린터 선택됨 */}
                  {slot.selectedPrinter && (
                    <button
                      onClick={() => openPrinterModal(slot.id)}
                      className="p-2 hover:bg-gray-200 rounded-full transition-colors"
                      title="Change Printer"
                    >
                      <Edit size={20} className="text-gray-600" />
                    </button>
                  )}
                  {/* 삭제 버튼 - 이름이 있거나 5개 초과 */}
                  {(slot.name || slot.type || slot.selectedPrinter || printerSlots.length > 5) && (
                    <button
                      onClick={() => deleteSlot(slot.id)}
                      className="p-2 hover:bg-red-100 rounded-full transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={20} className="text-red-500" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Add Printer 버튼 */}
            <button
              onClick={addPrinterSlot}
              className="w-full mt-4 py-3 border-2 border-dashed border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50 font-medium"
            >
              + Add Printer
            </button>
          </div>

          {/* 오른쪽: 프린터 그룹 */}
          <div className="bg-white rounded-lg shadow-md p-6 overflow-y-auto max-h-full">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-800">📁 Printer Groups</h2>
              <button
                onClick={savePrintersToDatabase}
                className="px-4 py-1.5 text-sm rounded font-medium bg-green-600 text-white hover:bg-green-700"
              >
                {printerSaveStatus === 'saving' ? '⏳ Saving...' : '💾 Save'}
              </button>
            </div>

            {/* 새 그룹 추가 */}
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Group Name"
                className="flex-1 p-2 border rounded text-sm"
                autoComplete="off"
                onKeyDown={(e) => e.key === 'Enter' && addNewGroup()}
              />
              <button
                onClick={addNewGroup}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium"
              >
                + Add
              </button>
            </div>

            {/* 그룹 목록 (display_order로 정렬 - 위에 있는 그룹이 먼저 출력) */}
            <div className="space-y-1">
              {[...printerGroups].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0)).map((group) => {
                const groupPrinters = printerSlots.filter(s => group.printerIds.includes(s.id));
                return (
                  <div key={group.id} className="px-3 py-1.5 bg-gray-50 rounded-lg border">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {/* 순서 변경 (Sushibar 등 여러 그룹이 같은 프린터에 연결된 경우 출력 순서) */}
                        <div className="flex flex-col gap-0.5">
                          <button
                            onClick={() => moveGroupUp(group.id)}
                            disabled={[...printerGroups].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))[0]?.id === group.id}
                            className="w-6 h-5 bg-gray-200 hover:bg-gray-300 rounded text-xs flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                            title="위로 (먼저 출력)"
                          >
                            <ChevronUp size={14} />
                          </button>
                          <button
                            onClick={() => moveGroupDown(group.id)}
                            disabled={[...printerGroups].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0)).pop()?.id === group.id}
                            className="w-6 h-5 bg-gray-200 hover:bg-gray-300 rounded text-xs flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                            title="아래로 (나중에 출력)"
                          >
                            <ChevronDown size={14} />
                          </button>
                        </div>
                        <h3 className="font-bold text-sm">{group.name}</h3>
                        {/* 라벨 출력 토글 */}
                        <button
                          onClick={() => {
                            setPrinterGroups(prev => prev.map(g => 
                              g.id === group.id ? { ...g, show_label: !g.show_label } : g
                            ));
                          }}
                          className={`px-3 py-1 text-sm font-medium rounded-full transition-all ${
                            group.show_label !== false
                              ? 'bg-black text-white'
                              : 'bg-gray-200 text-gray-500'
                          }`}
                          title={group.show_label !== false ? 'Label ON - Click to turn off' : 'Label OFF - Click to turn on'}
                        >
                          {group.show_label !== false ? '🏷️ Label' : 'No Label'}
                        </button>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => openGroupPrinterModal(group.id)}
                          className="p-2 hover:bg-gray-200 rounded-full transition-colors"
                          title="Edit Group"
                        >
                          <Edit size={20} className="text-gray-600" />
                        </button>
                        <button
                          onClick={() => deleteGroup(group.id)}
                          className="p-2 hover:bg-red-100 rounded-full transition-colors"
                          title="Delete Group"
                        >
                          <Trash2 size={20} className="text-red-500" />
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {groupPrinters.length > 0 ? (
                        groupPrinters.map(printer => {
                          // group.printers에서 copies 정보 가져오기 (API에서 로드된 경우)
                          const printerInfo = group.printers?.find(p => p.printer_id === printer.id);
                          const copies = printerInfo?.copies || 1;
                          
                          return (
                            <div 
                              key={printer.id} 
                              className="flex items-center gap-2 px-3 py-1 bg-green-600 text-white text-sm font-medium rounded-full"
                            >
                              <span>{printer.name}</span>
                              {/* Copies 선택 */}
                              <select
                                value={copies}
                                onChange={(e) => {
                                  const newCopies = parseInt(e.target.value);
                                  setPrinterGroups(prev => prev.map(g => {
                                    if (g.id !== group.id) return g;
                                    // printers 배열 업데이트 또는 생성
                                    const existingPrinters = g.printers || groupPrinters.map(p => ({
                                      printer_id: p.id,
                                      name: p.name,
                                      type: p.type,
                                      ip_address: p.selectedPrinter,
                                      copies: 1
                                    }));
                                    return {
                                      ...g,
                                      printers: existingPrinters.map(p => 
                                        p.printer_id === printer.id 
                                          ? { ...p, copies: newCopies }
                                          : p
                                      )
                                    };
                                  }));
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="bg-green-700 text-white text-sm font-medium rounded px-2 py-0.5 border-0 cursor-pointer"
                                title="Number of copies"
                              >
                                <option value={1}>×1</option>
                                <option value={2}>×2</option>
                                <option value={3}>×3</option>
                              </select>
                            </div>
                          );
                        })
                      ) : (
                        <span className="text-gray-400 text-xs">No printers</span>
                      )}
                    </div>
                  </div>
                );
              })}
              
              {printerGroups.length === 0 && (
                <div className="text-center py-8 text-gray-400">
                  <p>No groups yet</p>
                  <p className="text-xs mt-1">Create a group above</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================== New Printer 탭 ===================== */}
      {activeTab === 'newPrinter' && (
        <div className="bg-white rounded-lg shadow-md p-6 h-[calc(100vh-220px)] overflow-y-auto">
          <PrintLayoutEditor />
        </div>
      )}


      {/* ===================== 프린터 선택 모달 ===================== */}
      {showPrinterModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-[500px] max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold">Select System Printer</h3>
              <button onClick={() => setShowPrinterModal(false)} className="text-2xl text-gray-500 hover:text-gray-700">×</button>
            </div>
            <p className="text-sm text-gray-500 mb-4">Slot #{selectedSlotId}: {printerSlots.find(s => s.id === selectedSlotId)?.name || 'No name'}</p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {isLoadingPrinters ? (
                <div className="text-center py-8">
                  <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-2"></div>
                  <p className="text-gray-500">Loading printers...</p>
                </div>
              ) : printerLoadError ? (
                <div className="text-center py-6">
                  <p className="text-red-500 mb-2">⚠️ {printerLoadError}</p>
                  <button 
                    onClick={fetchSystemPrinters} 
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600"
                  >
                    🔄 Try Again
                  </button>
                </div>
              ) : systemPrinters.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-gray-400 mb-2">No printers found</p>
                  <p className="text-xs text-gray-400">Make sure printers are installed on this computer</p>
                </div>
              ) : (
                systemPrinters.map((printer: SystemPrinter, idx: number) => (
                  <button
                    key={idx}
                    onClick={() => selectPrinter(printer.name)}
                    className="w-full p-3 text-left border rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-colors"
                  >
                    <span className="font-medium">{printer.name}</span>
                    {printer.isDefault && <span className="ml-2 text-xs text-green-600">✓ Default</span>}
                  </button>
                ))
              )}
            </div>
            
            <div className="mt-4 pt-3 border-t flex justify-between">
              <button 
                onClick={fetchSystemPrinters} 
                disabled={isLoadingPrinters}
                className={`px-3 py-2 rounded-lg text-sm ${isLoadingPrinters ? 'bg-gray-200 text-gray-400' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                {isLoadingPrinters ? '⏳ Loading...' : '🔄 Refresh'}
              </button>
              <button onClick={() => setShowPrinterModal(false)} className="px-4 py-2 bg-gray-600 text-white rounded-lg text-sm hover:bg-gray-700">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== 그룹 프린터 선택 모달 ===================== */}
      {showGroupPrinterModal && currentGroup && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-[500px] max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold">Edit Group</h3>
              <button
                onClick={() => setShowGroupPrinterModal(false)}
                className="text-2xl text-gray-500 hover:text-gray-700"
              >
                ×
              </button>
            </div>
            
            {/* 그룹 이름 수정 */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Group Name</label>
              <input
                type="text"
                value={currentGroup.name}
                onChange={(e) => {
                  const newName = e.target.value;
                  setPrinterGroups(prev => prev.map(g => 
                    g.id === currentGroup.id ? { ...g, name: newName } : g
                  ));
                }}
                className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter group name"
              />
            </div>
            
            <p className="text-sm text-gray-500 mb-4">
              Click to select/deselect printers for this group.
            </p>
            
            <div className="space-y-2">
              {getConfiguredPrinters().length > 0 ? (
                getConfiguredPrinters().map((printer) => {
                  const isSelected = currentGroup.printerIds.includes(printer.id);
                  return (
                    <button
                      key={printer.id}
                      onClick={() => togglePrinterInGroup(printer.id)}
                      className={`w-full p-3 text-left border rounded-lg transition-colors flex items-center justify-between ${
                        isSelected 
                          ? 'bg-green-100 border-green-500' 
                          : 'bg-gray-50 hover:bg-blue-50'
                      }`}
                    >
                      <div>
                        <div className="font-medium">{printer.name}</div>
                        <div className="text-xs text-gray-500">{printer.selectedPrinter || 'No system printer'}</div>
      </div>
                      {isSelected && (
                        <span className="text-green-600 text-xl">✓</span>
                      )}
                    </button>
                  );
                })
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <p>No printers configured</p>
                  <p className="text-sm mt-2">Go to the Printers tab to add printers first</p>
                </div>
              )}
            </div>
            
            <div className="mt-4 pt-4 border-t">
              <button
                onClick={() => setShowGroupPrinterModal(false)}
                className="w-full p-3 bg-blue-600 text-white hover:bg-blue-700 rounded-lg font-medium"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
