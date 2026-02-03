/**
 * 공통 프린트 유틸리티 (FSR/QSR 공유)
 */

import { API_URL } from '../config/constants';

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
    orderId?: any;
    orderSource?: string;
    readyTime?: string;
    pickupTime?: string;
    table?: string;
    server?: string;
  };
  items?: any[];  // 유연한 타입
  guestSections?: GuestSection[];
}

/**
 * Receipt 출력 (FSR/QSR 공통)
 */
export async function printReceipt(data: ReceiptData, copies: number = 2): Promise<void> {
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
