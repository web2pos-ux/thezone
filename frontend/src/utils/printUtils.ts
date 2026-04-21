/**
 * 공통 프린트 유틸리티 (FSR/QSR 공유)
 * Sub POS 모드에서는 app_settings의 sub_pos_print_enabled 설정에 따라 출력 여부 결정
 */

import { API_URL } from '../config/constants';

/** Sales 투고/온라인 패널 Unpaid → 결제 모달: 이 구간에서는 Kitchen(print-order) 금지 */
const PANEL_TOGO_PAY_SUPPRESS_KITCHEN_UNTIL_KEY = 'panelTogoPaySuppressKitchenUntil';

const SUB_POS_MODE_KEY = 'sub-pos-mode-active';

export function armPanelTogoPayKitchenSuppress(durationMs = 10 * 60 * 1000): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(PANEL_TOGO_PAY_SUPPRESS_KITCHEN_UNTIL_KEY, String(Date.now() + Math.max(60_000, durationMs)));
  } catch {}
}

export function disarmPanelTogoPayKitchenSuppress(): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.removeItem(PANEL_TOGO_PAY_SUPPRESS_KITCHEN_UNTIL_KEY);
  } catch {}
}

export function isPanelTogoPayKitchenSuppressActive(): boolean {
  try {
    if (typeof sessionStorage === 'undefined') return false;
    const raw = sessionStorage.getItem(PANEL_TOGO_PAY_SUPPRESS_KITCHEN_UNTIL_KEY);
    if (!raw) return false;
    const until = Number(raw);
    if (!Number.isFinite(until) || until <= Date.now()) {
      sessionStorage.removeItem(PANEL_TOGO_PAY_SUPPRESS_KITCHEN_UNTIL_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

let _subPosPrintAllowed: boolean | null = null;
let _subPosPrintCheckedAt = 0;

function isSubPosMode(): boolean {
  try {
    const raw = localStorage.getItem(SUB_POS_MODE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return parsed.active === true;
  } catch { return false; }
}

async function isSubPosPrintEnabled(): Promise<boolean> {
  if (!isSubPosMode()) return true;

  const now = Date.now();
  if (_subPosPrintAllowed !== null && now - _subPosPrintCheckedAt < 30000) {
    return _subPosPrintAllowed;
  }

  try {
    const resp = await fetch(`${API_URL}/app-settings/sub_pos_print_enabled`);
    if (resp.ok) {
      const data = await resp.json();
      _subPosPrintAllowed = data.value === 'true' || data.value === '1';
    } else {
      _subPosPrintAllowed = false;
    }
  } catch {
    _subPosPrintAllowed = false;
  }
  _subPosPrintCheckedAt = now;
  return _subPosPrintAllowed;
}

export interface PrintItem {
  name: string;
  quantity?: number;
  qty?: number;
  price?: number;
  totalPrice?: number;
  lineTotal?: number;
  originalTotal?: number;
  discount?: {
    type: string;
    value: number;
    amount: number;
  } | any;
  modifiers?: any[];  // 유연한 타입 - 다양한 modifier 구조 허용
  memo?: any;
  guestNumber?: number;
  id?: any;
}

export interface TaxLine {
  name: string;
  amount: number;
}

export interface Payment {
  method: string;
  amount: number;
}

export interface GuestSection {
  guestNumber: number;
  items: PrintItem[];
}

export interface ReceiptData {
  header?: {
    orderNumber?: string | number;
    channel?: string;
    tableName?: string;
    serverName?: string;
    title?: string;
    guestNumber?: number;
  };
  orderInfo?: {
    orderNumber?: string | number;
    orderType?: string;
    channel?: string;
    tableName?: string;
    serverName?: string;
    customerName?: string;
    customerPhone?: string;
    guestNumber?: number;
  };
  storeName?: string;
  orderNumber?: string | number;
  orderType?: string;
  channel?: string;
  tableName?: string;
  customerName?: string;
  customerPhone?: string;
  pickupTime?: string;
  serverName?: string;
  items?: any[];  // 유연한 타입 - 다양한 아이템 구조 허용
  guestSections?: any[];  // 유연한 타입
  subtotal?: number;
  adjustments?: any[];
  taxLines?: any[];
  taxesTotal?: number;
  total?: number;
  payments?: any[];
  change?: number;
  cashTendered?: number;
  footer?: any;
}

export interface KitchenTicketData {
  header?: {
    orderNumber?: string | number;
    channel?: string;
    tableName?: string;
    serverName?: string;
  };
  orderInfo?: {
    orderNumber?: string | number;
    orderType?: string;
    channel?: string;
    tableName?: string;
    serverName?: string;
    customerName?: string | null;
    customerPhone?: string;
    /** Online: modal Order Number for kitchen ticket quoted id */
    onlineOrderNumber?: string;
    orderId?: any;
    orderSource?: string;
    readyTime?: string;
    pickupTime?: string;
    table?: string;
    server?: string;
    /** Bistro: kitchen 머지 행 — tableNumber 슬롯에 고객명, orderType 슬롯에 | T1 */
    fromBistro?: boolean;
    bistroTableSpot?: string;
  };
  items?: any[];  // 유연한 타입
  guestSections?: GuestSection[];
}

/**
 * Receipt 출력 (FSR/QSR 공통)
 */
export async function printReceipt(data: ReceiptData, copies: number = 2): Promise<void> {
  if (!(await isSubPosPrintEnabled())) {
    console.log('ℹ️ Sub POS print disabled — skipping receipt');
    return;
  }
  try {
    const response = await fetch(`${API_URL}/printers/print-receipt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receiptData: data, copies })
    });
    
    if (!response.ok) {
      throw new Error(`Print receipt failed: ${response.statusText}`);
    }
    
    console.log(`✅ Receipt printed (${copies} copies)`);
  } catch (error) {
    console.error('Receipt print error:', error);
    throw error;
  }
}

/**
 * Kitchen Ticket 출력 (FSR/QSR 공통)
 */
export async function printKitchenTicket(data: KitchenTicketData, copies: number = 1): Promise<void> {
  if (isPanelTogoPayKitchenSuppressActive()) {
    console.log('ℹ️ Kitchen ticket suppressed (Sales panel togo/online payment flow)');
    return;
  }
  if (!(await isSubPosPrintEnabled())) {
    console.log('ℹ️ Sub POS print disabled — skipping kitchen ticket');
    return;
  }
  try {
    const response = await fetch(`${API_URL}/printers/print-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderData: data, copies })
    });
    
    if (!response.ok) {
      throw new Error(`Print kitchen ticket failed: ${response.statusText}`);
    }
    
    console.log(`✅ Kitchen ticket printed (${copies} copies)`);
  } catch (error) {
    console.error('Kitchen ticket print error:', error);
    throw error;
  }
}

/**
 * Bill 출력 (FSR/QSR 공통)
 */
export async function printBill(data: ReceiptData, copies: number = 1): Promise<void> {
  if (!(await isSubPosPrintEnabled())) {
    console.log('ℹ️ Sub POS print disabled — skipping bill');
    return;
  }
  try {
    const response = await fetch(`${API_URL}/printers/print-bill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ billData: data, copies })
    });
    
    if (!response.ok) {
      throw new Error(`Print bill failed: ${response.statusText}`);
    }
    
    console.log(`✅ Bill printed (${copies} copies)`);
  } catch (error) {
    console.error('Bill print error:', error);
    throw error;
  }
}

/**
 * Cash Drawer 열기
 */
export async function openCashDrawer(): Promise<void> {
  try {
    const response = await fetch(`${API_URL}/printers/open-drawer`, {
      method: 'POST'
    });
    
    if (!response.ok) {
      throw new Error(`Open cash drawer failed: ${response.statusText}`);
    }
    
    console.log('✅ Cash drawer opened');
  } catch (error) {
    console.error('Cash drawer open error:', error);
    throw error;
  }
}

/**
 * ReceiptData 생성 헬퍼 (주문 데이터로부터)
 */
export function buildReceiptData(params: {
  orderNumber: string | number;
  orderType: string;
  tableName?: string;
  serverName?: string;
  customerName?: string;
  customerPhone?: string;
  items: PrintItem[];
  guestSections?: GuestSection[];
  subtotal: number;
  adjustments?: Array<{ label: string; amount: number }>;
  taxLines: TaxLine[];
  total: number;
  payments: Payment[];
  change?: number;
}): ReceiptData {
  return {
    header: {
      orderNumber: params.orderNumber,
      channel: params.orderType,
      tableName: params.tableName,
      serverName: params.serverName
    },
    orderInfo: {
      orderNumber: params.orderNumber,
      orderType: params.orderType,
      channel: params.orderType,
      tableName: params.tableName,
      serverName: params.serverName,
      customerName: params.customerName,
      customerPhone: params.customerPhone
    },
    items: params.items,
    guestSections: params.guestSections,
    subtotal: params.subtotal,
    adjustments: params.adjustments || [],
    taxLines: params.taxLines,
    taxesTotal: params.taxLines.reduce((sum, t) => sum + t.amount, 0),
    total: params.total,
    payments: params.payments,
    change: params.change || 0,
    footer: { message: 'Thank you!' }
  };
}

/**
 * KitchenTicketData 생성 헬퍼 (주문 데이터로부터)
 */
export function buildKitchenTicketData(params: {
  orderNumber: string | number;
  orderType: string;
  tableName?: string;
  serverName?: string;
  customerName?: string;
  items: PrintItem[];
  guestSections?: GuestSection[];
}): KitchenTicketData {
  return {
    header: {
      orderNumber: params.orderNumber,
      channel: params.orderType,
      tableName: params.tableName,
      serverName: params.serverName
    },
    orderInfo: {
      orderNumber: params.orderNumber,
      orderType: params.orderType,
      channel: params.orderType,
      tableName: params.tableName,
      serverName: params.serverName,
      customerName: params.customerName
    },
    items: params.items,
    guestSections: params.guestSections
  };
}
