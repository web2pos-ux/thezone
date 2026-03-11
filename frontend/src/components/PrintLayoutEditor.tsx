import React, { useState, useEffect, useCallback } from 'react';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3177/api';

// Layout Types
type LayoutType = 'receipt' | 'bill' | 'dineIn' | 'togo' | 'delivery' | 'qsrEatIn' | 'qsrTakeOut';

interface ElementStyle {
  visible: boolean;
  order: number;
  fontSize: number;
  fontWeight: 'regular' | 'bold' | 'extrabold';
  isItalic: boolean;
  isUnderline: boolean;
  isStrikethrough: boolean;
  inverse: boolean;
  textAlign: 'left' | 'center' | 'right';
  prefix?: string;
  text?: string;
  showInHeader?: boolean;
  showInFooter?: boolean;
}

// Paired Row - two elements in one line
interface PairedRow {
  id: string;
  leftElement: string;  // element key
  rightElement: string; // element key
  enabled: boolean;
  inverse: boolean;     // full row black background
  order: number;        // display order (lower = higher position)
}

interface LayoutSettings {
  paperWidth: number;
  printMode: 'graphic' | 'text';
  topMargin: number; // 상단 마진 (컷팅~첫 인쇄 간격, mm 단위)
  leftMargin?: number; // 좌측 마진 (mm 단위)
  // Safe right padding (px) for amount column in graphic mode (prevents clipping on some printers)
  rightPaddingPx?: number;
  // Paired rows for kitchen layouts
  pairedRows?: PairedRow[];
  // Header elements
  storeName: ElementStyle & { text: string };
  storeAddress: ElementStyle & { text: string };
  storePhone: ElementStyle & { text: string };
  orderNumber: ElementStyle;
  orderType: ElementStyle;
  tableNumber: ElementStyle;
  serverName: ElementStyle;
  dateTime: ElementStyle;
  customerName: ElementStyle;
  customerPhone: ElementStyle;
  pickupTime: ElementStyle;
  deliveryAddress: ElementStyle;
  deliveryChannel: ElementStyle;
  guestNumber: ElementStyle;
  paidStatus: ElementStyle;
  // Body elements
  items: ElementStyle;
  modifiers: ElementStyle & { prefix: string };
  itemNote: ElementStyle & { prefix: string };
  itemPrice: ElementStyle;
  // Footer elements
  subtotal: ElementStyle;
  discount: ElementStyle;
  taxGST: ElementStyle;
  taxPST: ElementStyle;
  total: ElementStyle;
  paymentMethod: ElementStyle;
  changeAmount: ElementStyle;
  greeting: ElementStyle & { text: string };
  // Separators
  separator1: { visible: boolean; style: 'solid' | 'dashed' | 'dotted' | 'none' };
  separator2: { visible: boolean; style: 'solid' | 'dashed' | 'dotted' | 'none' };
  separator3: { visible: boolean; style: 'solid' | 'dashed' | 'dotted' | 'none' };
}

// Default element style
const defaultElementStyle: ElementStyle = {
  visible: true,
  order: 0,
  fontSize: 12,
  fontWeight: 'regular',
  isItalic: false,
  isUnderline: false,
  isStrikethrough: false,
  inverse: false,
  textAlign: 'left',
};

// Pairable elements for kitchen layouts (elements that can be combined in one row)
const pairableElements = [
  { key: 'orderType', label: 'Order Type' },
  { key: 'orderNumber', label: 'Order Number' },
  { key: 'tableNumber', label: 'Table Number' },
  { key: 'customerName', label: 'Customer Name' },
  { key: 'customerPhone', label: 'Customer Phone' },
  { key: 'pickupTime', label: 'Pickup Time' },
  { key: 'deliveryChannel', label: 'Delivery Channel' },
  { key: 'guestNumber', label: 'Guest Number' },
  { key: 'serverName', label: 'Server Name' },
  { key: 'dateTime', label: 'Date/Time' },
  { key: 'paidStatus', label: 'Paid Status' },
];

// Default paired rows for different layout types
const getDefaultPairedRows = (type: LayoutType): PairedRow[] => {
  switch (type) {
    case 'dineIn':
      return [
        { id: 'pair1', leftElement: 'orderType', rightElement: 'tableNumber', enabled: true, inverse: true, order: 1 },
        { id: 'pair2', leftElement: 'guestNumber', rightElement: 'serverName', enabled: false, inverse: false, order: 5 },
      ];
    case 'togo':
      return [
        { id: 'pair1', leftElement: 'orderType', rightElement: 'orderNumber', enabled: true, inverse: true, order: 1 },
        { id: 'pair2', leftElement: 'customerName', rightElement: 'customerPhone', enabled: true, inverse: false, order: 7 },
      ];
    case 'delivery':
      return [
        { id: 'pair1', leftElement: 'deliveryChannel', rightElement: 'orderNumber', enabled: true, inverse: true, order: 1 },
        { id: 'pair2', leftElement: 'customerName', rightElement: 'customerPhone', enabled: true, inverse: false, order: 8 },
      ];
    case 'qsrEatIn':
      return [
        { id: 'pair1', leftElement: 'orderType', rightElement: 'orderNumber', enabled: true, inverse: true, order: 1 },
      ];
    case 'qsrTakeOut':
      return [
        { id: 'pair1', leftElement: 'orderType', rightElement: 'orderNumber', enabled: true, inverse: true, order: 1 },
        { id: 'pair2', leftElement: 'customerName', rightElement: 'customerPhone', enabled: true, inverse: false, order: 7 },
      ];
    default:
      return [];
  }
};

// Default layouts for each type
const getDefaultLayout = (type: LayoutType): LayoutSettings => {
  const base: LayoutSettings = {
    paperWidth: 80,
    printMode: 'graphic',
    topMargin: 5, // 기본 상단 마진 5mm
    pairedRows: getDefaultPairedRows(type),
    storeName: { ...defaultElementStyle, fontSize: 16, fontWeight: 'bold', textAlign: 'center', text: 'Restaurant Name', order: 1 },
    storeAddress: { ...defaultElementStyle, fontSize: 10, textAlign: 'center', text: '123 Main St, City', order: 2 },
    storePhone: { ...defaultElementStyle, fontSize: 10, textAlign: 'center', text: 'Tel: 604-123-4567', order: 3 },
    orderNumber: { ...defaultElementStyle, fontSize: 14, fontWeight: 'bold', order: 4 },
    orderType: { ...defaultElementStyle, fontSize: 20, fontWeight: 'bold', inverse: true, textAlign: 'center', order: 1 },
    tableNumber: { ...defaultElementStyle, fontSize: 24, fontWeight: 'bold', textAlign: 'center', order: 2 },
    serverName: { ...defaultElementStyle, fontSize: 10, order: 5 },
    dateTime: { ...defaultElementStyle, fontSize: 10, order: 6, showInFooter: true },
    customerName: { ...defaultElementStyle, fontSize: 12, fontWeight: 'bold', order: 7, visible: false },
    customerPhone: { ...defaultElementStyle, fontSize: 12, order: 8, visible: false },
    pickupTime: { ...defaultElementStyle, fontSize: 20, fontWeight: 'bold', inverse: true, order: 3, visible: false },
    deliveryAddress: { ...defaultElementStyle, fontSize: 11, order: 9, visible: false },
    deliveryChannel: { ...defaultElementStyle, fontSize: 16, fontWeight: 'bold', inverse: true, order: 4, visible: false },
    guestNumber: { ...defaultElementStyle, fontSize: 14, fontWeight: 'bold', order: 5, visible: false },
    paidStatus: { ...defaultElementStyle, fontSize: 18, fontWeight: 'bold', inverse: true, order: 10, visible: false },
    items: { ...defaultElementStyle, fontSize: 20, fontWeight: 'bold', order: 100 },
    modifiers: { ...defaultElementStyle, fontSize: 18, fontWeight: 'bold', isItalic: true, order: 101, prefix: '>>' },
    itemNote: { ...defaultElementStyle, fontSize: 18, fontWeight: 'bold', isItalic: true, order: 102, prefix: '->' },
    itemPrice: { ...defaultElementStyle, fontSize: 12, textAlign: 'right', order: 103, visible: false },
    subtotal: { ...defaultElementStyle, fontSize: 12, order: 200, visible: false },
    discount: { ...defaultElementStyle, fontSize: 12, order: 201, visible: false },
    taxGST: { ...defaultElementStyle, fontSize: 12, order: 202, visible: false },
    taxPST: { ...defaultElementStyle, fontSize: 12, order: 203, visible: false },
    total: { ...defaultElementStyle, fontSize: 16, fontWeight: 'bold', order: 204, visible: false },
    paymentMethod: { ...defaultElementStyle, fontSize: 12, order: 205, visible: false },
    changeAmount: { ...defaultElementStyle, fontSize: 14, fontWeight: 'bold', inverse: true, order: 206, visible: false },
    greeting: { ...defaultElementStyle, fontSize: 12, textAlign: 'center', order: 300, text: 'Thank you!', visible: false },
    separator1: { visible: true, style: 'solid' },
    separator2: { visible: true, style: 'dashed' },
    separator3: { visible: true, style: 'solid' },
  };

  // Customize based on type
  switch (type) {
    case 'receipt':
    case 'bill':
      return {
        ...base,
        storeName: { ...base.storeName, visible: true },
        storeAddress: { ...base.storeAddress, visible: true },
        storePhone: { ...base.storePhone, visible: true },
        orderType: { ...base.orderType, visible: false },
        tableNumber: { ...base.tableNumber, fontSize: 12, visible: true },
        itemPrice: { ...base.itemPrice, visible: true },
        subtotal: { ...base.subtotal, visible: true },
        taxGST: { ...base.taxGST, visible: true },
        taxPST: { ...base.taxPST, visible: true },
        total: { ...base.total, visible: true },
        paymentMethod: { ...base.paymentMethod, visible: type === 'receipt' },
        changeAmount: { ...base.changeAmount, visible: type === 'receipt' },
        greeting: { ...base.greeting, visible: true },
        paidStatus: { ...base.paidStatus, visible: false },
      };
    case 'dineIn':
      return {
        ...base,
        storeName: { ...base.storeName, visible: false },
        storeAddress: { ...base.storeAddress, visible: false },
        storePhone: { ...base.storePhone, visible: false },
        tableNumber: { ...base.tableNumber, visible: true },
        guestNumber: { ...base.guestNumber, visible: true },
        paidStatus: { ...base.paidStatus, visible: true },
      };
    case 'togo':
      return {
        ...base,
        storeName: { ...base.storeName, visible: false },
        storeAddress: { ...base.storeAddress, visible: false },
        storePhone: { ...base.storePhone, visible: false },
        orderType: { ...base.orderType, visible: true },
        tableNumber: { ...base.tableNumber, visible: false },
        customerName: { ...base.customerName, visible: true },
        customerPhone: { ...base.customerPhone, visible: true },
        pickupTime: { ...base.pickupTime, visible: true },
        paidStatus: { ...base.paidStatus, visible: true },
      };
    case 'delivery':
      return {
        ...base,
        storeName: { ...base.storeName, visible: false },
        storeAddress: { ...base.storeAddress, visible: false },
        storePhone: { ...base.storePhone, visible: false },
        orderType: { ...base.orderType, visible: true },
        tableNumber: { ...base.tableNumber, visible: false },
        customerName: { ...base.customerName, visible: true },
        customerPhone: { ...base.customerPhone, visible: true },
        pickupTime: { ...base.pickupTime, visible: true },
        deliveryAddress: { ...base.deliveryAddress, visible: true },
        deliveryChannel: { ...base.deliveryChannel, visible: true },
        paidStatus: { ...base.paidStatus, visible: true },
      };
    case 'qsrEatIn':
      return {
        ...base,
        storeName: { ...base.storeName, visible: false },
        storeAddress: { ...base.storeAddress, visible: false },
        storePhone: { ...base.storePhone, visible: false },
        orderType: { ...base.orderType, visible: true, text: 'EAT IN' },
        tableNumber: { ...base.tableNumber, visible: false },
        paidStatus: { ...base.paidStatus, visible: true },
      };
    case 'qsrTakeOut':
      return {
        ...base,
        storeName: { ...base.storeName, visible: false },
        storeAddress: { ...base.storeAddress, visible: false },
        storePhone: { ...base.storePhone, visible: false },
        orderType: { ...base.orderType, visible: true, text: 'TAKE OUT' },
        tableNumber: { ...base.tableNumber, visible: false },
        customerName: { ...base.customerName, visible: true },
        customerPhone: { ...base.customerPhone, visible: true },
        pickupTime: { ...base.pickupTime, visible: true },
        paidStatus: { ...base.paidStatus, visible: true },
      };
    default:
      return base;
  }
};

// Layout type configuration
const layoutTypes: { id: LayoutType; label: string; icon: string }[] = [
  { id: 'receipt', label: 'Receipt', icon: '🧾' },
  { id: 'bill', label: 'Bill', icon: '📃' },
  { id: 'dineIn', label: 'Dine-In', icon: '🍽️' },
  { id: 'togo', label: 'Togo/Online', icon: '🥡' },
  { id: 'delivery', label: 'Delivery', icon: '🚗' },
  { id: 'qsrEatIn', label: 'QSR Eat-In', icon: '🍔' },
  { id: 'qsrTakeOut', label: 'QSR Take-Out', icon: '🥤' },
];

// Element configuration for each section
const headerElements = [
  { key: 'storeName', label: 'Store Name', forTypes: ['receipt', 'bill'] },
  { key: 'storeAddress', label: 'Store Address', forTypes: ['receipt', 'bill'] },
  { key: 'storePhone', label: 'Store Phone', forTypes: ['receipt', 'bill'] },
  { key: 'orderType', label: 'Order Type', forTypes: ['dineIn', 'togo', 'delivery', 'qsrEatIn', 'qsrTakeOut'] },
  { key: 'orderNumber', label: 'Order Number', forTypes: ['all'] },
  { key: 'tableNumber', label: 'Table Number', forTypes: ['receipt', 'bill', 'dineIn'] },
  { key: 'serverName', label: 'Server Name', forTypes: ['receipt', 'bill', 'dineIn'] },
  { key: 'dateTime', label: 'Date/Time', forTypes: ['all'] },
  { key: 'customerName', label: 'Customer Name', forTypes: ['togo', 'delivery', 'qsrTakeOut'] },
  { key: 'customerPhone', label: 'Customer Phone', forTypes: ['togo', 'delivery', 'qsrTakeOut'] },
  { key: 'pickupTime', label: 'Pickup Time', forTypes: ['togo', 'delivery', 'qsrTakeOut'] },
  { key: 'deliveryAddress', label: 'Delivery Address', forTypes: ['delivery'] },
  { key: 'deliveryChannel', label: 'Delivery Channel', forTypes: ['delivery'] },
  { key: 'guestNumber', label: 'Guest Number', forTypes: ['dineIn'] },
  { key: 'paidStatus', label: 'Paid Status', forTypes: ['dineIn', 'togo', 'delivery', 'qsrEatIn', 'qsrTakeOut'] },
];

const bodyElements = [
  { key: 'items', label: 'Menu Items', forTypes: ['all'] },
  { key: 'modifiers', label: 'Modifiers', forTypes: ['all'] },
  { key: 'itemNote', label: 'Item Memo', forTypes: ['all'] },
  { key: 'itemPrice', label: 'Item Price', forTypes: ['receipt', 'bill'] },
];

const footerElements = [
  { key: 'subtotal', label: 'Subtotal', forTypes: ['receipt', 'bill'] },
  { key: 'discount', label: 'Discount', forTypes: ['receipt', 'bill'] },
  { key: 'taxGST', label: 'Tax (GST)', forTypes: ['receipt', 'bill'] },
  { key: 'taxPST', label: 'Tax (PST)', forTypes: ['receipt', 'bill'] },
  { key: 'total', label: 'Total', forTypes: ['receipt', 'bill'] },
  { key: 'paymentMethod', label: 'Payment Method', forTypes: ['receipt'] },
  { key: 'changeAmount', label: 'Change', forTypes: ['receipt'] },
  { key: 'greeting', label: 'Greeting Message', forTypes: ['receipt', 'bill'] },
];

const fontSizes = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32];
const prefixOptions = ['>>', '->', '*', '+', '•', ''];

// Paired Row Editor Component
const PairedRowEditor: React.FC<{
  pairedRows: PairedRow[];
  layoutType: LayoutType;
  onChange: (rows: PairedRow[]) => void;
}> = ({ pairedRows, layoutType, onChange }) => {
  const isKitchenType = ['dineIn', 'togo', 'delivery', 'qsrEatIn', 'qsrTakeOut'].includes(layoutType);
  
  if (!isKitchenType) return null;

  const handleToggle = (id: string) => {
    const updated = pairedRows.map(row => 
      row.id === id ? { ...row, enabled: !row.enabled } : row
    );
    onChange(updated);
  };

  const handleElementChange = (id: string, side: 'left' | 'right', value: string) => {
    const updated = pairedRows.map(row => 
      row.id === id 
        ? { ...row, [side === 'left' ? 'leftElement' : 'rightElement']: value }
        : row
    );
    onChange(updated);
  };

  const handleAddRow = () => {
    const newId = `pair${pairedRows.length + 1}`;
    const maxOrder = pairedRows.length > 0 ? Math.max(...pairedRows.map(r => r.order || 0)) : 0;
    onChange([...pairedRows, { id: newId, leftElement: 'orderNumber', rightElement: 'dateTime', enabled: true, inverse: false, order: maxOrder + 1 }]);
  };

  const handleInverseToggle = (id: string) => {
    const updated = pairedRows.map(row => 
      row.id === id ? { ...row, inverse: !row.inverse } : row
    );
    onChange(updated);
  };

  const handleOrderChange = (id: string, order: number) => {
    const updated = pairedRows.map(row => 
      row.id === id ? { ...row, order } : row
    );
    onChange(updated);
  };

  const handleRemoveRow = (id: string) => {
    onChange(pairedRows.filter(row => row.id !== id));
  };

  return (
    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-gray-800 flex items-center gap-2">
          <span>↔️</span>
          Paired Rows (Two elements in one line)
        </h4>
        <button
          onClick={handleAddRow}
          className="px-3 py-1 bg-yellow-500 text-white text-sm rounded-lg hover:bg-yellow-600 transition-all"
        >
          + Add Pair
        </button>
      </div>
      
      {pairedRows.length === 0 ? (
        <p className="text-gray-500 text-sm">No paired rows. Click "Add Pair" to combine two elements in one line.</p>
      ) : (
        <div className="space-y-2">
          {pairedRows.map((row, idx) => (
            <div key={row.id} className="flex items-center gap-2 bg-white p-2 rounded-lg border">
              {/* Enable/Disable Toggle */}
              <button
                onClick={() => handleToggle(row.id)}
                className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 ${
                  row.enabled ? 'bg-green-600 border-green-600 text-white' : 'border-gray-300'
                }`}
              >
                {row.enabled && <span className="text-xs">✓</span>}
              </button>
              
              {/* Order Input */}
              <input
                type="number"
                value={row.order || 0}
                onChange={(e) => handleOrderChange(row.id, parseInt(e.target.value) || 0)}
                className="w-12 px-1 py-1 text-xs border rounded text-center"
                disabled={!row.enabled}
                title="Display order (lower = higher position)"
                min={0}
              />
              
              {/* Left Element */}
              <select
                value={row.leftElement}
                onChange={(e) => handleElementChange(row.id, 'left', e.target.value)}
                className="flex-1 px-2 py-1 text-sm border rounded"
                disabled={!row.enabled}
              >
                {pairableElements.map(el => (
                  <option key={el.key} value={el.key}>{el.label}</option>
                ))}
              </select>
              
              {/* Divider */}
              <span className="text-gray-400 font-bold">|</span>
              
              {/* Right Element */}
              <select
                value={row.rightElement}
                onChange={(e) => handleElementChange(row.id, 'right', e.target.value)}
                className="flex-1 px-2 py-1 text-sm border rounded"
                disabled={!row.enabled}
              >
                {pairableElements.map(el => (
                  <option key={el.key} value={el.key}>{el.label}</option>
                ))}
              </select>
              
              {/* Inverse Button (Black Background) */}
              <button
                onClick={() => handleInverseToggle(row.id)}
                className={`w-8 h-6 rounded flex items-center justify-center transition-all flex-shrink-0 text-xs font-bold ${
                  row.inverse 
                    ? 'bg-black text-white border border-black' 
                    : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-100'
                }`}
                disabled={!row.enabled}
                title="Toggle black background (inverse)"
              >
                ▣
              </button>

              {/* Remove Button */}
              <button
                onClick={() => handleRemoveRow(row.id)}
                className="w-6 h-6 bg-red-100 text-red-600 rounded flex items-center justify-center hover:bg-red-200 transition-all flex-shrink-0"
                title="Remove pair"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      
      <p className="text-xs text-gray-500 mt-2">
        Enabled pairs will display both elements side-by-side on the same line. 
        Use the order number to control position (lower = higher). Click ▣ for black background.
      </p>
    </div>
  );
};

// Element Editor Component
const ElementEditor: React.FC<{
  elementKey: string;
  label: string;
  style: ElementStyle;
  onChange: (key: string, updates: Partial<ElementStyle>) => void;
  showPrefix?: boolean;
  showText?: boolean;
}> = ({ elementKey, label, style, onChange, showPrefix, showText }) => {
  return (
    <div className="border border-gray-200 rounded-lg p-3 mb-2 bg-white">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onChange(elementKey, { visible: !style.visible })}
            className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
              style.visible ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-300'
            }`}
          >
            {style.visible && <span className="text-xs">✓</span>}
          </button>
          <span className={`font-medium ${!style.visible ? 'text-gray-400' : 'text-gray-800'}`}>{label}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500">Order:</span>
          <input
            type="number"
            value={style.order}
            onChange={(e) => onChange(elementKey, { order: parseInt(e.target.value) || 0 })}
            className="w-12 px-1 py-0.5 text-xs border rounded text-center"
            disabled={!style.visible}
          />
        </div>
      </div>

      {style.visible && (
        <div className="grid grid-cols-2 gap-2 mt-2">
          {/* Font Size */}
          <div>
            <label className="text-xs text-gray-500">Size</label>
            <select
              value={style.fontSize}
              onChange={(e) => onChange(elementKey, { fontSize: parseInt(e.target.value) })}
              className="w-full px-2 py-1 text-sm border rounded"
            >
              {fontSizes.map(size => (
                <option key={size} value={size}>{size}px</option>
              ))}
            </select>
          </div>

          {/* Font Weight */}
          <div>
            <label className="text-xs text-gray-500">Weight</label>
            <select
              value={style.fontWeight}
              onChange={(e) => onChange(elementKey, { fontWeight: e.target.value as any })}
              className="w-full px-2 py-1 text-sm border rounded"
            >
              <option value="regular">Regular</option>
              <option value="bold">Bold</option>
              <option value="extrabold">Extra Bold</option>
            </select>
          </div>

          {/* Text Align */}
          <div>
            <label className="text-xs text-gray-500">Align</label>
            <div className="flex gap-1">
              {(['left', 'center', 'right'] as const).map(align => (
                <button
                  key={align}
                  onClick={() => onChange(elementKey, { textAlign: align })}
                  className={`flex-1 px-2 py-1 text-xs border rounded ${
                    style.textAlign === align ? 'bg-blue-600 text-white' : 'bg-white'
                  }`}
                >
                  {align === 'left' ? '◀' : align === 'center' ? '◆' : '▶'}
                </button>
              ))}
            </div>
          </div>

          {/* Style Buttons */}
          <div>
            <label className="text-xs text-gray-500">Style</label>
            <div className="flex gap-1">
              <button
                onClick={() => onChange(elementKey, { isItalic: !style.isItalic })}
                className={`px-2 py-1 text-xs border rounded italic ${style.isItalic ? 'bg-blue-600 text-white' : 'bg-white'}`}
              >
                I
              </button>
              <button
                onClick={() => onChange(elementKey, { isUnderline: !style.isUnderline })}
                className={`px-2 py-1 text-xs border rounded underline ${style.isUnderline ? 'bg-blue-600 text-white' : 'bg-white'}`}
              >
                U
              </button>
              <button
                onClick={() => onChange(elementKey, { isStrikethrough: !style.isStrikethrough })}
                className={`px-2 py-1 text-xs border rounded line-through ${style.isStrikethrough ? 'bg-blue-600 text-white' : 'bg-white'}`}
              >
                S
              </button>
              <button
                onClick={() => onChange(elementKey, { inverse: !style.inverse })}
                className={`px-2 py-1 text-xs border rounded ${style.inverse ? 'bg-black text-white' : 'bg-white'}`}
                title="Inverse (white on black)"
              >
                ▣
              </button>
            </div>
          </div>

          {/* Prefix (for modifiers/notes) */}
          {showPrefix && (
            <div className="col-span-2">
              <label className="text-xs text-gray-500">Prefix</label>
              <select
                value={(style as any).prefix || '>>'}
                onChange={(e) => onChange(elementKey, { prefix: e.target.value } as any)}
                className="w-full px-2 py-1 text-sm border rounded"
              >
                {prefixOptions.map(p => (
                  <option key={p} value={p}>{p || '(none)'}</option>
                ))}
              </select>
            </div>
          )}

          {/* Custom Text (for greeting, etc.) */}
          {showText && (
            <div className="col-span-2">
              <label className="text-xs text-gray-500">Text</label>
              <input
                type="text"
                value={(style as any).text || ''}
                onChange={(e) => onChange(elementKey, { text: e.target.value } as any)}
                className="w-full px-2 py-1 text-sm border rounded"
                placeholder="Enter text..."
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Preview Component
const PrintPreview: React.FC<{ layout: LayoutSettings; layoutType: LayoutType }> = ({ layout, layoutType }) => {
  const isKitchen = ['dineIn', 'togo', 'delivery', 'qsrEatIn', 'qsrTakeOut'].includes(layoutType);
  
  const getStyleClass = (style: ElementStyle) => {
    let classes = '';
    if (style.fontWeight === 'bold') classes += 'font-bold ';
    if (style.fontWeight === 'extrabold') classes += 'font-extrabold ';
    if (style.isItalic) classes += 'italic ';
    if (style.isUnderline) classes += 'underline ';
    if (style.isStrikethrough) classes += 'line-through ';
    if (style.textAlign === 'center') classes += 'text-center ';
    if (style.textAlign === 'right') classes += 'text-right ';
    return classes;
  };

  const getFontSize = (size: number) => {
    // Scale down for preview
    const scale = 0.6;
    return Math.max(8, Math.round(size * scale));
  };

  // Get sample content for element
  const getSampleContent = (key: string): string => {
    const samples: Record<string, string> = {
      orderType: layoutType === 'togo' ? 'TOGO' : layoutType === 'delivery' ? 'DELIVERY' : layoutType === 'qsrEatIn' ? 'EAT IN' : layoutType === 'qsrTakeOut' ? 'TAKE OUT' : 'DINE-IN',
      orderNumber: '#1001',
      tableNumber: 'Table 5',
      customerName: 'John Smith',
      customerPhone: '604-555-1234',
      pickupTime: '04:30PM',
      deliveryChannel: 'DoorDash',
      guestNumber: 'Guest 1',
      serverName: 'Emily',
      dateTime: '02/11 3:45PM',
      paidStatus: 'UNPAID',
    };
    return samples[key] || key;
  };

  const renderElement = (key: string, style: ElementStyle, content: string) => {
    if (!style.visible) return null;
    
    return (
      <div
        key={key}
        className={`${getStyleClass(style)} ${style.inverse ? 'bg-black text-white px-2' : ''}`}
        style={{ fontSize: `${getFontSize(style.fontSize)}px`, lineHeight: 1.3 }}
      >
        {content}
      </div>
    );
  };

  // Render paired row (two elements side by side)
  const renderPairedRow = (row: PairedRow) => {
    if (!row.enabled) return null;
    
    const leftStyle = (layout as any)[row.leftElement] as ElementStyle;
    const rightStyle = (layout as any)[row.rightElement] as ElementStyle;
    
    if (!leftStyle || !rightStyle) return null;
    
    const leftContent = getSampleContent(row.leftElement);
    const rightContent = getSampleContent(row.rightElement);
    
    // Use the larger font size for the row
    const fontSize = Math.max(leftStyle.fontSize, rightStyle.fontSize);
    
    // If row has inverse, apply black background to entire row
    const rowInverse = row.inverse;
    
    return (
      <div
        key={row.id}
        className={`flex justify-between items-center ${rowInverse ? 'bg-black text-white px-2 py-0.5' : ''}`}
        style={{ fontSize: `${getFontSize(fontSize)}px`, lineHeight: 1.3 }}
      >
        <span className={`${getStyleClass(leftStyle)} ${!rowInverse && leftStyle.inverse ? 'bg-black text-white px-1' : ''}`}>
          {leftContent}
        </span>
        <span className={`${getStyleClass(rightStyle)} ${!rowInverse && rightStyle.inverse ? 'bg-black text-white px-1' : ''}`}>
          {rightContent}
        </span>
      </div>
    );
  };

  // Get elements that are NOT in any enabled paired row
  const getPairedElementKeys = (): Set<string> => {
    const paired = new Set<string>();
    (layout.pairedRows || []).forEach(row => {
      if (row.enabled) {
        paired.add(row.leftElement);
        paired.add(row.rightElement);
      }
    });
    return paired;
  };

  const pairedKeys = getPairedElementKeys();

  // Render single element only if not paired
  const renderSingleElement = (key: string, style: ElementStyle, content: string) => {
    if (pairedKeys.has(key)) return null;
    return renderElement(key, style, content);
  };

  return (
    <div className="bg-white border-2 border-gray-300 rounded-lg font-mono text-black" style={{ width: '280px', minHeight: '400px' }}>
      {/* Top Margin Indicator */}
      {(layout.topMargin || 5) > 0 && (
        <div 
          className="bg-gray-100 border-b border-dashed border-gray-300 flex items-end justify-center"
          style={{ height: `${Math.max(8, (layout.topMargin || 5) * 2)}px` }}
        >
          <span className="text-[8px] text-gray-400">↑ {layout.topMargin || 5}mm</span>
        </div>
      )}
      <div className="p-4">
      {/* Header Section */}
      <div className="mb-2">
        {layout.storeName.visible && renderElement('storeName', layout.storeName, layout.storeName.text || 'Restaurant Name')}
        {layout.storeAddress.visible && renderElement('storeAddress', layout.storeAddress, layout.storeAddress.text || '123 Main St')}
        {layout.storePhone.visible && renderElement('storePhone', layout.storePhone, layout.storePhone.text || 'Tel: 604-123-4567')}
        
        {/* Separator */}
        {layout.separator1.visible && layout.separator1.style !== 'none' && (
          <div className={`border-t my-1 ${layout.separator1.style === 'dashed' ? 'border-dashed' : layout.separator1.style === 'dotted' ? 'border-dotted' : ''}`}></div>
        )}

        {/* Render all elements sorted by order */}
        {(() => {
          // Define all renderable items with their order
          type RenderItem = { type: 'paired' | 'single'; order: number; render: () => React.ReactNode };
          const items: RenderItem[] = [];

          // Add paired rows
          (layout.pairedRows || []).forEach(row => {
            if (row.enabled) {
              items.push({
                type: 'paired',
                order: row.order || 0,
                render: () => renderPairedRow(row)
              });
            }
          });

          // Add single elements (not paired)
          const singleElements = [
            { key: 'orderType', content: isKitchen ? getSampleContent('orderType') : '' },
            { key: 'tableNumber', content: 'Table 5' },
            { key: 'orderNumber', content: 'Order #1001' },
            { key: 'pickupTime', content: 'Pickup: 04:30PM' },
            { key: 'customerName', content: 'John Smith' },
            { key: 'customerPhone', content: '604-555-1234' },
            { key: 'deliveryChannel', content: 'DoorDash' },
            { key: 'deliveryAddress', content: '456 Oak Ave, Vancouver' },
            { key: 'serverName', content: 'Server: Emily' },
            { key: 'guestNumber', content: '--- Guest 1 ---' },
            { key: 'paidStatus', content: 'UNPAID' },
          ];

          singleElements.forEach(el => {
            if (!pairedKeys.has(el.key)) {
              const style = (layout as any)[el.key] as ElementStyle;
              if (style && style.visible) {
                items.push({
                  type: 'single',
                  order: style.order || 0,
                  render: () => renderElement(el.key, style, el.content)
                });
              }
            }
          });

          // Sort by order and render
          return items
            .sort((a, b) => a.order - b.order)
            .map((item, idx) => <React.Fragment key={idx}>{item.render()}</React.Fragment>);
        })()}
      </div>

      {/* Separator */}
      {layout.separator2.visible && layout.separator2.style !== 'none' && (
        <div className={`border-t my-2 ${layout.separator2.style === 'dashed' ? 'border-dashed' : layout.separator2.style === 'dotted' ? 'border-dotted' : ''}`}></div>
      )}

      {/* Body Section - Items */}
      <div className="mb-2">
        {layout.items.visible && (
          <>
            <div className={getStyleClass(layout.items)} style={{ fontSize: `${getFontSize(layout.items.fontSize)}px` }}>
              2x Salmon Sashimi {layout.itemPrice.visible && <span className="float-right">$24.00</span>}
            </div>
            {layout.modifiers.visible && (
              <div className={`pl-3 ${getStyleClass(layout.modifiers)}`} style={{ fontSize: `${getFontSize(layout.modifiers.fontSize)}px` }}>
                {(layout.modifiers as any).prefix || '>>'} Extra Wasabi
              </div>
            )}
            {layout.itemNote.visible && (
              <div className={`pl-3 ${getStyleClass(layout.itemNote)}`} style={{ fontSize: `${getFontSize(layout.itemNote.fontSize)}px` }}>
                {(layout.itemNote as any).prefix || '->'} Make it fresh
              </div>
            )}
            <div className={getStyleClass(layout.items)} style={{ fontSize: `${getFontSize(layout.items.fontSize)}px` }}>
              1x Spicy Tuna Roll {layout.itemPrice.visible && <span className="float-right">$15.00</span>}
            </div>
            {layout.modifiers.visible && (
              <div className={`pl-3 ${getStyleClass(layout.modifiers)}`} style={{ fontSize: `${getFontSize(layout.modifiers.fontSize)}px` }}>
                {(layout.modifiers as any).prefix || '>>'} Extra Spicy
              </div>
            )}
          </>
        )}
      </div>

      {/* Separator */}
      {layout.separator3.visible && layout.separator3.style !== 'none' && (
        <div className={`border-t my-2 ${layout.separator3.style === 'dashed' ? 'border-dashed' : layout.separator3.style === 'dotted' ? 'border-dotted' : ''}`}></div>
      )}

      {/* Footer Section */}
      <div>
        {layout.subtotal.visible && (
          <div className={`flex justify-between ${getStyleClass(layout.subtotal)}`} style={{ fontSize: `${getFontSize(layout.subtotal.fontSize)}px` }}>
            <span>Subtotal:</span><span>$39.00</span>
          </div>
        )}
        {layout.discount.visible && (
          <div className={`flex justify-between ${getStyleClass(layout.discount)}`} style={{ fontSize: `${getFontSize(layout.discount.fontSize)}px` }}>
            <span>Discount:</span><span>-$5.00</span>
          </div>
        )}
        {layout.taxGST.visible && (
          <div className={`flex justify-between ${getStyleClass(layout.taxGST)}`} style={{ fontSize: `${getFontSize(layout.taxGST.fontSize)}px` }}>
            <span>GST (5%):</span><span>$1.70</span>
          </div>
        )}
        {layout.taxPST.visible && (
          <div className={`flex justify-between ${getStyleClass(layout.taxPST)}`} style={{ fontSize: `${getFontSize(layout.taxPST.fontSize)}px` }}>
            <span>PST (7%):</span><span>$2.38</span>
          </div>
        )}
        {layout.total.visible && (
          <div className={`flex justify-between mt-1 ${getStyleClass(layout.total)} ${layout.total.inverse ? 'bg-black text-white px-1' : ''}`} style={{ fontSize: `${getFontSize(layout.total.fontSize)}px` }}>
            <span>TOTAL:</span><span>$38.08</span>
          </div>
        )}
        {layout.paymentMethod.visible && (
          <div className={`flex justify-between mt-2 ${getStyleClass(layout.paymentMethod)}`} style={{ fontSize: `${getFontSize(layout.paymentMethod.fontSize)}px` }}>
            <span>Visa:</span><span>$50.00</span>
          </div>
        )}
        {layout.changeAmount.visible && (
          <div className={`flex justify-between ${getStyleClass(layout.changeAmount)} ${layout.changeAmount.inverse ? 'bg-black text-white px-1' : ''}`} style={{ fontSize: `${getFontSize(layout.changeAmount.fontSize)}px` }}>
            <span>Change:</span><span>$11.92</span>
          </div>
        )}
        {layout.dateTime.visible && layout.dateTime.showInFooter && (
          <div className={`mt-2 ${getStyleClass(layout.dateTime)}`} style={{ fontSize: `${getFontSize(layout.dateTime.fontSize)}px` }}>
            {new Date().toLocaleString()}
          </div>
        )}
        {layout.greeting.visible && (
          <div className={`mt-2 ${getStyleClass(layout.greeting)}`} style={{ fontSize: `${getFontSize(layout.greeting.fontSize)}px` }}>
            {layout.greeting.text || 'Thank you!'}
          </div>
        )}
      </div>
      </div>
    </div>
  );
};

// Main Component
const PrintLayoutEditor: React.FC = () => {
  const [activeLayoutType, setActiveLayoutType] = useState<LayoutType>('receipt');
  const [layouts, setLayouts] = useState<Record<LayoutType, LayoutSettings>>(() => {
    const initial: Record<LayoutType, LayoutSettings> = {} as any;
    layoutTypes.forEach(lt => {
      initial[lt.id] = getDefaultLayout(lt.id);
    });
    return initial;
  });
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [testPrintStatus, setTestPrintStatus] = useState<'idle' | 'printing' | 'success' | 'error'>('idle');
  const [expandedSection, setExpandedSection] = useState<'header' | 'body' | 'footer'>('header');

  // Load settings from API
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await fetch(`${API_URL}/printers/layout-settings`);
        if (response.ok) {
          const data = await response.json();
          if (data && Object.keys(data).length > 0) {
            // Merge loaded settings with defaults
            const merged: Record<LayoutType, LayoutSettings> = {} as any;
            layoutTypes.forEach(lt => {
              merged[lt.id] = { ...getDefaultLayout(lt.id), ...data[lt.id] };
            });
            setLayouts(merged);
          }
        }
      } catch (error) {
        console.error('Failed to load layout settings:', error);
      }
    };
    loadSettings();
  }, []);

  // Handle element change
  const handleElementChange = useCallback((elementKey: string, updates: Partial<ElementStyle>) => {
    setLayouts(prev => ({
      ...prev,
      [activeLayoutType]: {
        ...prev[activeLayoutType],
        [elementKey]: {
          ...(prev[activeLayoutType] as any)[elementKey],
          ...updates,
        },
      },
    }));
  }, [activeLayoutType]);

  // Handle paired rows change
  const handlePairedRowsChange = useCallback((rows: PairedRow[]) => {
    setLayouts(prev => ({
      ...prev,
      [activeLayoutType]: {
        ...prev[activeLayoutType],
        pairedRows: rows,
      },
    }));
  }, [activeLayoutType]);

  // Save settings
  const handleSave = async () => {
    setSaveStatus('saving');
    try {
      const response = await fetch(`${API_URL}/printers/layout-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: layouts }),
      });
      if (response.ok) {
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } else {
        setSaveStatus('error');
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
      setSaveStatus('error');
    }
  };

  // Reset to default
  const handleReset = () => {
    if (window.confirm('Reset this layout to default? All changes will be lost.')) {
      setLayouts(prev => ({
        ...prev,
        [activeLayoutType]: getDefaultLayout(activeLayoutType),
      }));
    }
  };

  // Test print
  const handleTestPrint = async () => {
    setTestPrintStatus('printing');
    try {
      const isKitchen = ['dineIn', 'togo', 'delivery', 'qsrEatIn', 'qsrTakeOut'].includes(activeLayoutType);
      const endpoint = isKitchen ? '/printers/print-order' : activeLayoutType === 'bill' ? '/printers/print-bill' : '/printers/print-receipt';
      
      const kitchenTestItems = [
        { name: 'Test Item 1', quantity: 2, modifiers: [{ name: 'Test Modifier' }], memo: 'Test memo' },
        { name: 'Test Item 2', quantity: 1 },
      ];

      // Dine-in Test Print: send to ALL configured devices
      // - Kitchen printers: Kitchen ticket
      // - Receipt/Front printers: Bill
      if (activeLayoutType === 'dineIn') {
        type PrinterRow = { id: number; name: string; type?: string; selectedPrinter?: string; selected_printer?: string };
        let printers: PrinterRow[] = [];
        try {
          const pr = await fetch(`${API_URL}/printers`);
          if (pr.ok) {
            const data = await pr.json();
            printers = Array.isArray(data) ? data : [];
          }
        } catch {}

        const configured = printers
          .map(p => ({
            ...p,
            selected: (p.selectedPrinter || (p as any).selected_printer || '').toString().trim(),
            typeNorm: (p.type || '').toString().toLowerCase(),
            nameNorm: (p.name || '').toString().toLowerCase(),
          }))
          .filter(p => p.selected);

        const kitchenTargets = configured
          .filter(p => p.typeNorm === 'kitchen' || p.typeNorm === 'label' || p.nameNorm.includes('kitchen'))
          .map(p => p.selected);

        const receiptTargets = configured
          .filter(p => p.typeNorm === 'receipt' || p.nameNorm.includes('front') || p.nameNorm.includes('receipt'))
          .map(p => p.selected);

        let okCount = 0;
        let failCount = 0;

        const kitchenPayloadBase = {
          items: kitchenTestItems,
          orderInfo: {
            orderNumber: '9999',
            channel: 'DINE-IN',
            tableName: 'Test Table',
            customerName: 'Test Customer',
            customerPhone: '604-555-0000',
            pickupTime: '05:00PM',
            deliveryAddress: '123 Test St',
            deliveryChannel: 'TestDash',
            isPaid: false,
            // Per-device scale only (layout scale removed)
            graphicScale: 1.0,
          },
          orderData: {
            orderNumber: '9999',
            channel: 'DINE-IN',
            tableName: 'Test Table',
            customerName: 'Test Customer',
            customerPhone: '604-555-0000',
            pickupTime: '05:00PM',
            deliveryAddress: '123 Test St',
            deliveryChannel: 'TestDash',
            isPaid: false,
            graphicScale: 1.0,
            items: kitchenTestItems,
          },
          printMode: 'graphic' as const,
        };

        const billLayout = (layouts as any)?.bill || (layouts as any)?.billLayout || null;
        const billGraphicScale = 1.0;
        const billPaperWidth = (billLayout && typeof billLayout.paperWidth === 'number') ? billLayout.paperWidth : 80;
        const billRightPaddingPx = (billLayout && typeof billLayout.rightPaddingPx === 'number') ? billLayout.rightPaddingPx : undefined;
        const billPayloadBase = {
          billData: {
            orderNumber: '9999',
            channel: 'DINE-IN',
            tableName: 'Test Table',
            serverName: 'Test Server',
            paperWidth: billPaperWidth,
            rightPaddingPx: billRightPaddingPx,
            graphicScale: billGraphicScale,
            items: [
              { name: 'Test Item 1', quantity: 2, price: 15.0, modifiers: [{ name: 'Modifier', price: 1.0 }] },
              { name: 'Test Item 2', quantity: 1, price: 12.0 },
            ],
            subtotal: 43.0,
            taxLines: [
              { name: 'GST (5%)', rate: 5, amount: 2.15 },
              { name: 'PST (7%)', rate: 7, amount: 3.01 },
            ],
            total: 48.16,
          },
          printMode: 'graphic' as const,
        };

        // 1) Kitchen ticket to ALL kitchen devices
        for (const targetPrinter of kitchenTargets) {
          try {
            const resp = await fetch(`${API_URL}/printers/print-order`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...kitchenPayloadBase, printerName: targetPrinter }),
            });
            if (resp.ok) okCount += 1;
            else failCount += 1;
          } catch {
            failCount += 1;
          }
        }

        // 2) Bill to ALL receipt/front devices
        for (const targetPrinter of receiptTargets) {
          try {
            const resp = await fetch(`${API_URL}/printers/print-bill`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...billPayloadBase, printerName: targetPrinter }),
            });
            if (resp.ok) okCount += 1;
            else failCount += 1;
          } catch {
            failCount += 1;
          }
        }

        // Fallback: if no devices were configured, run the existing single-endpoint test.
        if (kitchenTargets.length === 0 && receiptTargets.length === 0) {
          const response = await fetch(`${API_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(kitchenPayloadBase),
          });
          if (response.ok) okCount += 1;
          else failCount += 1;
        }

        if (okCount > 0) {
          setTestPrintStatus('success');
          setTimeout(() => setTestPrintStatus('idle'), 3000);
        } else {
          setTestPrintStatus('error');
        }
        return;
      }

      const testData = isKitchen ? {
        // IMPORTANT: backend `/printers/print-order` expects top-level `items`
        items: kitchenTestItems,
        orderInfo: {
          orderNumber: '9999',
          channel: activeLayoutType === 'togo' ? 'TOGO' : activeLayoutType === 'delivery' ? 'DELIVERY' : activeLayoutType === 'qsrEatIn' ? 'EAT-IN' : 'TAKE-OUT',
          tableName: 'Test Table',
          customerName: 'Test Customer',
          customerPhone: '604-555-0000',
          pickupTime: '05:00PM',
          deliveryAddress: '123 Test St',
          deliveryChannel: 'TestDash',
          isPaid: false,
            graphicScale: 1.0,
        },
        // keep orderData for compatibility with older branches/handlers
        orderData: {
          orderNumber: '9999',
          channel: activeLayoutType === 'togo' ? 'TOGO' : activeLayoutType === 'delivery' ? 'DELIVERY' : activeLayoutType === 'qsrEatIn' ? 'EAT-IN' : 'TAKE-OUT',
          tableName: 'Test Table',
          customerName: 'Test Customer',
          customerPhone: '604-555-0000',
          pickupTime: '05:00PM',
          deliveryAddress: '123 Test St',
          deliveryChannel: 'TestDash',
          isPaid: false,
          graphicScale: 1.0,
          items: kitchenTestItems,
        },
        printMode: 'graphic',
      } : {
        [activeLayoutType === 'bill' ? 'billData' : 'receiptData']: {
          orderNumber: '9999',
          channel: 'DINE-IN',
          tableName: 'Test Table',
          serverName: 'Test Server',
          paperWidth: currentLayout.paperWidth || 80,
          topMargin: currentLayout.topMargin ?? 0,
          leftMargin: currentLayout.leftMargin ?? 0,
          rightPaddingPx: currentLayout.rightPaddingPx,
          graphicScale: 1.0,
          items: [
            { name: 'Test Item 1', quantity: 2, price: 15.00, modifiers: [{ name: 'Modifier', price: 1.00 }] },
            { name: 'Test Item 2', quantity: 1, price: 12.00 },
          ],
          subtotal: 43.00,
          taxLines: [
            { name: 'GST (5%)', rate: 5, amount: 2.15 },
            { name: 'PST (7%)', rate: 7, amount: 3.01 },
          ],
          total: 48.16,
          payments: activeLayoutType === 'receipt' ? [{ method: 'Cash', amount: 50.00 }] : undefined,
          change: activeLayoutType === 'receipt' ? 1.84 : undefined,
        },
        // backend `/printers/print-receipt|print-bill` reads topMargin from the root too
        topMargin: currentLayout.topMargin ?? 0,
        printMode: 'graphic',
      };

      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testData),
      });

      if (response.ok) {
        setTestPrintStatus('success');
        setTimeout(() => setTestPrintStatus('idle'), 3000);
      } else {
        setTestPrintStatus('error');
      }
    } catch (error) {
      console.error('Test print failed:', error);
      setTestPrintStatus('error');
    }
  };

  const currentLayout = layouts[activeLayoutType];

  // Filter elements based on layout type
  const filterElements = (elements: typeof headerElements) => {
    return elements.filter(el => 
      el.forTypes.includes('all') || el.forTypes.includes(activeLayoutType)
    );
  };

  return (
    <div className="h-full flex flex-col">
      {/* Layout Type Tabs */}
      <div className="flex gap-1 mb-4 flex-wrap">
        {layoutTypes.map(lt => (
          <button
            key={lt.id}
            onClick={() => setActiveLayoutType(lt.id)}
            className={`px-3 py-2 rounded-lg font-medium text-sm flex items-center gap-1.5 transition-all ${
              activeLayoutType === lt.id
                ? 'bg-blue-600 text-white shadow-md'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <span>{lt.icon}</span>
            <span>{lt.label}</span>
          </button>
        ))}
      </div>

      {/* Print Settings (Top Margin) */}
      <div className="flex flex-wrap items-center gap-4 mb-4 p-3 bg-gray-50 rounded-lg border">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">🧾 Paper Width:</span>
          <select
            value={currentLayout.paperWidth || 80}
            onChange={(e) => {
              const value = parseInt(e.target.value) || 80;
              setLayouts(prev => ({
                ...prev,
                [activeLayoutType]: {
                  ...prev[activeLayoutType],
                  paperWidth: value === 58 ? 58 : 80,
                }
              }));
            }}
            className="px-2 py-1 text-sm border rounded"
          >
            <option value={80}>80mm</option>
            <option value={58}>58mm</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">📏 Top Margin:</span>
          <input
            type="number"
            min={0}
            max={120}
            value={currentLayout.topMargin || 5}
            onChange={(e) => {
              const value = parseInt(e.target.value) || 0;
              setLayouts(prev => ({
                ...prev,
                [activeLayoutType]: {
                  ...prev[activeLayoutType],
                  topMargin: Math.min(120, Math.max(0, value))
                }
              }));
            }}
            className="w-16 px-2 py-1 text-sm border rounded text-center"
          />
          <span className="text-sm text-gray-500">mm</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">➡️ Right Padding:</span>
          <input
            type="number"
            min={0}
            max={260}
            value={typeof currentLayout.rightPaddingPx === 'number' ? currentLayout.rightPaddingPx : ''}
            onChange={(e) => {
              const raw = e.target.value;
              const n = raw === '' ? null : Number(raw);
              setLayouts(prev => ({
                ...prev,
                [activeLayoutType]: {
                  ...prev[activeLayoutType],
                  rightPaddingPx: (n == null || !Number.isFinite(n)) ? undefined : Math.min(260, Math.max(0, Math.round(n)))
                }
              }));
            }}
            className="w-20 px-2 py-1 text-sm border rounded text-center"
            placeholder="auto"
          />
          <span className="text-sm text-gray-500">px</span>
          <span className="text-xs text-gray-400">(POSBANK A-11 권장: 140)</span>
        </div>
        <span className="text-xs text-gray-400">(Space between cut line and first print)</span>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* Left Panel - Settings (55%) */}
        <div className="w-[55%] overflow-y-auto pr-2">
          {/* Paired Rows Section (Kitchen layouts only) */}
          {['dineIn', 'togo', 'delivery', 'qsrEatIn', 'qsrTakeOut'].includes(activeLayoutType) && (
            <PairedRowEditor
              pairedRows={currentLayout.pairedRows || []}
              layoutType={activeLayoutType}
              onChange={handlePairedRowsChange}
            />
          )}

          {/* Header Section */}
          <div className="mb-4">
            <button
              onClick={() => setExpandedSection(expandedSection === 'header' ? 'body' : 'header')}
              className="w-full flex items-center justify-between px-4 py-2 bg-gray-100 rounded-lg font-semibold text-gray-800"
            >
              <span>📋 Header Section</span>
              <span>{expandedSection === 'header' ? '▼' : '▶'}</span>
            </button>
            {expandedSection === 'header' && (
              <div className="mt-2 space-y-1">
                {filterElements(headerElements).map(el => (
                  <ElementEditor
                    key={el.key}
                    elementKey={el.key}
                    label={el.label}
                    style={(currentLayout as any)[el.key]}
                    onChange={handleElementChange}
                    showText={['storeName', 'storeAddress', 'storePhone'].includes(el.key)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Body Section */}
          <div className="mb-4">
            <button
              onClick={() => setExpandedSection(expandedSection === 'body' ? 'header' : 'body')}
              className="w-full flex items-center justify-between px-4 py-2 bg-gray-100 rounded-lg font-semibold text-gray-800"
            >
              <span>🍽️ Body Section (Items)</span>
              <span>{expandedSection === 'body' ? '▼' : '▶'}</span>
            </button>
            {expandedSection === 'body' && (
              <div className="mt-2 space-y-1">
                {filterElements(bodyElements).map(el => (
                  <ElementEditor
                    key={el.key}
                    elementKey={el.key}
                    label={el.label}
                    style={(currentLayout as any)[el.key]}
                    onChange={handleElementChange}
                    showPrefix={['modifiers', 'itemNote'].includes(el.key)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer Section */}
          <div className="mb-4">
            <button
              onClick={() => setExpandedSection(expandedSection === 'footer' ? 'header' : 'footer')}
              className="w-full flex items-center justify-between px-4 py-2 bg-gray-100 rounded-lg font-semibold text-gray-800"
            >
              <span>📝 Footer Section</span>
              <span>{expandedSection === 'footer' ? '▼' : '▶'}</span>
            </button>
            {expandedSection === 'footer' && (
              <div className="mt-2 space-y-1">
                {filterElements(footerElements).map(el => (
                  <ElementEditor
                    key={el.key}
                    elementKey={el.key}
                    label={el.label}
                    style={(currentLayout as any)[el.key]}
                    onChange={handleElementChange}
                    showText={el.key === 'greeting'}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - Preview (45%) */}
        <div className="w-[45%] flex-shrink-0 flex flex-col">
          <div className="text-center mb-2 font-semibold text-gray-700">Preview</div>
          <div className="flex-1 overflow-y-auto bg-gray-100 rounded-lg p-4 flex justify-center">
            <PrintPreview layout={currentLayout} layoutType={activeLayoutType} />
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-between pt-4 mt-4 border-t">
        <button
          onClick={handleReset}
          className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 transition-all"
        >
          Reset to Default
        </button>
        <div className="flex items-center gap-3">
          {saveStatus === 'saved' && <span className="text-green-600 font-medium">✓ Saved</span>}
          {saveStatus === 'error' && <span className="text-red-600 font-medium">Error saving</span>}
          {testPrintStatus === 'success' && <span className="text-green-600 font-medium">✓ Printed</span>}
          {testPrintStatus === 'error' && <span className="text-red-600 font-medium">Print failed</span>}
          <button
            onClick={handleTestPrint}
            disabled={testPrintStatus === 'printing'}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:bg-gray-400 transition-all flex items-center gap-2"
          >
            {testPrintStatus === 'printing' ? '🖨️ Printing...' : '🖨️ Test Print'}
          </button>
          <button
            onClick={handleSave}
            disabled={saveStatus === 'saving'}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-400 transition-all"
          >
            {saveStatus === 'saving' ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PrintLayoutEditor;
